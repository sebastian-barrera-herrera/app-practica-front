/** AWS CloudFormation: plantillas (JSON/YAML), pilas, eventos, actualizaciones con retroceso, conjuntos de cambios, deriva y conjuntos de pilas. */
import { regional } from '../account';
import { roleTrusts } from './flowlogs';
import { AwsError, op, type OpCtx } from '../registry';
import { roleCaller } from '../sdk';
import { tickers } from '../tick';
import type { Account, CfnChange, CfnChangeSet, CfnDriftItem, CfnEvent, CfnResource, CfnStack, CfnStackSet, CfnState, Rec } from '../types';
import { isObj, iso, stableId, toArr } from '../util';
import { parseTemplate, YamlError } from '../yaml';
import { CfnFail, RESOURCE_TYPES, genName, makeCall, type RCtx, type RType } from './cfnres';
import { expandSam, SAM_TRANSFORM } from './sam';
import { paramsOf } from './ssmparams';

export const STACK_TYPE = 'AWS::CloudFormation::Stack';

const validation = (m: string) => new AwsError('ValidationError', m, 400);
const tplError = (m: string) => validation(`Template format error: ${m}`);

export const cfnOf = (a: Account, region: string): CfnState => {
  const r = regional(a, region);
  r.cfn ??= { stacks: {}, changeSets: {}, stackSets: {} };
  return r.cfn;
};

const uuid = (seed: string) => {
  const h = stableId(seed, '', 32, 'hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

/** Atributos que admite `Fn::GetAtt` en cada tipo (para detectar erratas en la plantilla antes de crear nada). */
const ATTRS: Record<string, string[]> = {
  'AWS::S3::Bucket': ['Arn', 'DomainName', 'RegionalDomainName', 'WebsiteURL'],
  'AWS::DynamoDB::Table': ['Arn', 'StreamArn'],
  'AWS::SQS::Queue': ['Arn', 'QueueName', 'QueueUrl'],
  'AWS::SNS::Topic': ['TopicName', 'TopicArn'],
  'AWS::Lambda::Function': ['Arn'],
  'AWS::Lambda::Version': ['Version'],
  'AWS::IAM::Role': ['Arn', 'RoleId'],
  'AWS::EC2::VPC': ['CidrBlock', 'VpcId'],
  'AWS::EC2::Subnet': ['AvailabilityZone'],
  'AWS::EC2::SecurityGroup': ['GroupId', 'VpcId'],
  'AWS::EC2::Instance': ['PrivateIp', 'PublicIp', 'AvailabilityZone', 'PublicDnsName', 'PrivateDnsName'],
  'AWS::Logs::LogGroup': ['Arn'],
  'AWS::ApiGatewayV2::Api': ['ApiEndpoint', 'ApiId'],
};

// ───────────────────────── plantilla ─────────────────────────

export interface ParamDef {
  Type: string;
  Default?: unknown;
  AllowedValues?: unknown[];
  AllowedPattern?: string;
  MinLength?: number;
  MaxLength?: number;
  MinValue?: number;
  MaxValue?: number;
  NoEcho?: boolean | string;
  Description?: string;
  ConstraintDescription?: string;
}

export interface Loaded {
  tpl: Rec;
  text: string;
  isJson: boolean;
}

export function loadTemplate(text: string): Loaded {
  try {
    return { tpl: parseTemplate(text), text, isJson: text.trim().startsWith('{') };
  } catch (e) {
    if (e instanceof YamlError) throw tplError(text.trim().startsWith('{') ? `JSON not well-formed. (${e.message})` : `YAML not well-formed. (${e.message})`);
    throw e;
  }
}

/** Texto de la plantilla a partir de `--template-body` o `--template-url` (una URL de un objeto de S3 de la cuenta). */
export function templateText(c: OpCtx, body: unknown, url: unknown): string {
  if (body && url) throw validation('Specify exactly one of TemplateBody or TemplateURL.');
  if (body) return String(body);
  if (url) {
    const m = /^https:\/\/(?:([^./]+)\.s3[.-][^/]*amazonaws\.com|s3[.-][^/]*amazonaws\.com\/([^/]+))\/(.+)$/.exec(String(url));
    if (!m) throw validation(`S3 error: Invalid TemplateURL: ${url}`);
    const bucket = m[1] ?? m[2];
    const key = decodeURIComponent(m[3]);
    const b = c.acct.s3.buckets[bucket];
    const v = b?.objects[key];
    if (!b || !v?.length) throw validation(`S3 error: Access Denied. For more information check http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html`);
    return v[v.length - 1].body;
  }
  throw validation('Either Template URL or Template Body must be specified.');
}

const paramDefs = (tpl: Rec): Record<string, ParamDef> => (isObj(tpl.Parameters) ? (tpl.Parameters as Record<string, ParamDef>) : {});

/** Valores finales de los parámetros: los indicados, los anteriores o el valor por defecto; con sus restricciones. */
export function finalParams(tpl: Rec, given: Record<string, string>, prev?: Record<string, string>, usePrevious: string[] = []): Record<string, string> {
  const defs = paramDefs(tpl);
  const unknown = Object.keys(given).filter((k) => !(k in defs));
  if (unknown.length) throw validation(`Parameters: [${unknown.join(',')}] do not exist in the template`);
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const [k, d] of Object.entries(defs)) {
    let v: string | undefined = given[k];
    if (v === undefined && usePrevious.includes(k)) v = prev?.[k];
    if (v === undefined && d.Default !== undefined) v = String(d.Default);
    if (v === undefined) {
      missing.push(k);
      continue;
    }
    const bad = (why: string) => validation(`Parameter validation failed: parameter value ${v} for parameter name ${k} ${why}`);
    if (d.AllowedValues && !d.AllowedValues.map(String).includes(v)) throw bad('is not an allowed value (allowedValues)');
    if (d.AllowedPattern && !new RegExp(`^(?:${d.AllowedPattern})$`).test(v)) throw bad(`does not match the allowed pattern ${d.AllowedPattern}`);
    if (d.MinLength !== undefined && v.length < Number(d.MinLength)) throw bad(`is shorter than the minimum length ${d.MinLength}`);
    if (d.MaxLength !== undefined && v.length > Number(d.MaxLength)) throw bad(`is longer than the maximum length ${d.MaxLength}`);
    if (d.Type === 'Number') {
      if (v.trim() === '' || Number.isNaN(Number(v))) throw bad('is not a number');
      if (d.MinValue !== undefined && Number(v) < Number(d.MinValue)) throw bad(`is lower than the minimum value ${d.MinValue}`);
      if (d.MaxValue !== undefined && Number(v) > Number(d.MaxValue)) throw bad(`is higher than the maximum value ${d.MaxValue}`);
    }
    out[k] = v;
  }
  if (missing.length) throw validation(`Parameters: [${missing.join(',')}] must have values`);
  return out;
}

// ───────────────────────── funciones intrínsecas ─────────────────────────

const NOVALUE = Symbol('NoValue');

export interface Env {
  a: Account;
  region: string;
  stackName: string;
  stackId: string;
  params: Record<string, string>;
  tpl: Rec;
  conds: Record<string, boolean>;
  /** Recursos ya creados (o existentes): nombre físico y atributos. */
  res: Record<string, { type: string; id: string; attrs: Record<string, string> }>;
  /** En un plan (sin crear nada): los recursos nuevos o sustituidos no tienen nombre todavía. */
  planning?: boolean;
  importValue(name: string): string;
}

const AZ_SUFFIX = ['a', 'b', 'c'];

/** Referencias dinámicas: `{{resolve:ssm:/ruta:versión}}`, `{{resolve:ssm-secure:…}}` y `{{resolve:secretsmanager:id:SecretString:clave}}`. */
function dynamicRefs(s: string, env: Env): string {
  return s.replace(/\{\{resolve:([a-z-]+):([^}]+)\}\}/g, (m, kind: string, body: string) => {
    if (kind === 'ssm' || kind === 'ssm-secure') {
      const [name, ver] = body.split(/:(?=\d+$)/);
      const p = paramsOf(env.a, env.region)[name];
      if (!p) throw new CfnFail(`Unable to fetch parameters [${name}] from parameter store for this account.`);
      if (kind === 'ssm' && p.Type === 'SecureString') throw new CfnFail(`The parameter ${name} is a SecureString: use {{resolve:ssm-secure:${name}:VERSION}}.`);
      if (kind === 'ssm-secure' && p.Type !== 'SecureString') throw new CfnFail(`The parameter ${name} is not a SecureString: use {{resolve:ssm:${name}}}.`);
      const v = ver ? p.history.find((h) => h.Version === Number(ver)) : p.history[p.history.length - 1];
      if (!v) throw new CfnFail(`Unable to fetch parameters [${name}:${ver}] from parameter store for this account.`);
      return v.Value;
    }
    if (kind === 'secretsmanager') {
      const [id, , key] = body.split(':');
      const sec = Object.values(regional(env.a, env.region).secrets ?? {}).find((x) => x.Name === id || x.ARN === id);
      if (!sec) throw new CfnFail(`Secrets Manager can't find the specified secret: ${id}.`);
      const cur = (sec.versions.find((v) => v.stages.includes('AWSCURRENT')) ?? sec.versions[sec.versions.length - 1])?.value ?? '';
      if (!key) return cur;
      try {
        return String((JSON.parse(cur) as Record<string, unknown>)[key]);
      } catch {
        throw new CfnFail(`The secret ${id} is not JSON: cannot read the key ${key}.`);
      }
    }
    return m;
  });
}

function resolve(v: unknown, env: Env): unknown {
  if (typeof v === 'string' && v.includes('{{resolve:')) return dynamicRefs(v, env);
  if (Array.isArray(v)) return v.map((x) => resolve(x, env)).filter((x) => x !== NOVALUE);
  if (!isObj(v)) return v;
  const keys = Object.keys(v);
  if (keys.length === 1) {
    const k = keys[0];
    const arg = v[k];
    switch (k) {
      case 'Ref':
        return ref(String(arg), env);
      case 'Fn::GetAtt': {
        const parts = Array.isArray(arg) ? arg.map(String) : String(arg).split('.');
        return getAtt(parts[0], parts.slice(1).join('.'), env);
      }
      case 'Fn::Join': {
        const [d, list] = arg as [string, unknown[]];
        return (resolve(list, env) as unknown[]).map(String).join(String(d));
      }
      case 'Fn::Sub': {
        const [s, vars] = Array.isArray(arg) ? (arg as [string, Rec]) : [String(arg), {} as Rec];
        const local: Record<string, unknown> = {};
        for (const [n, x] of Object.entries(vars ?? {})) local[n] = resolve(x, env);
        return s.replace(/\$\{([^}]*)\}/g, (_m, name: string) => {
          if (name.startsWith('!')) return '${' + name.slice(1) + '}';
          if (name in local) return String(local[name]);
          const dot = name.indexOf('.');
          return String(dot < 0 ? ref(name, env) : getAtt(name.slice(0, dot), name.slice(dot + 1), env));
        });
      }
      case 'Fn::Select': {
        const [i, list] = arg as [unknown, unknown];
        const l = resolve(list, env) as unknown[];
        const idx = Number(resolve(i, env));
        if (!Array.isArray(l) || idx >= l.length) throw new CfnFail(`Template error: Fn::Select cannot select nonexistent value at index ${idx}`);
        return l[idx];
      }
      case 'Fn::Split': {
        const [d, s] = arg as [string, unknown];
        return String(resolve(s, env)).split(String(d));
      }
      case 'Fn::If': {
        const [name, a, b] = arg as [string, unknown, unknown];
        return resolve(env.conds[name] ? a : b, env);
      }
      case 'Fn::FindInMap': {
        const [m, k1, k2] = (arg as unknown[]).map((x) => resolve(x, env)) as string[];
        const val = ((env.tpl.Mappings as Rec | undefined)?.[m] as Rec | undefined)?.[k1] as Rec | undefined;
        if (!val || val[k2] === undefined) throw new CfnFail(`Template error: Unable to get mapping for ${m}::${k1}::${k2}`);
        return val[k2];
      }
      case 'Fn::ImportValue':
        return env.importValue(String(resolve(arg, env)));
      case 'Fn::Base64':
        return btoa(String(resolve(arg, env)));
      case 'Fn::GetAZs':
        return AZ_SUFFIX.map((s) => `${String(resolve(arg, env) || env.region)}${s}`);
      case 'Fn::Length':
        return (resolve(arg, env) as unknown[]).length;
      case 'Fn::ToJsonString':
        return JSON.stringify(resolve(arg, env));
      case 'Fn::Equals':
      case 'Fn::Not':
      case 'Fn::And':
      case 'Fn::Or':
      case 'Condition':
        return evalCond(v, env);
    }
  }
  const out: Rec = {};
  for (const [k, x] of Object.entries(v)) {
    const r = resolve(x, env);
    if (r !== NOVALUE) out[k] = r;
  }
  return out;
}

function ref(name: string, env: Env): unknown {
  switch (name) {
    case 'AWS::Region':
      return env.region;
    case 'AWS::AccountId':
      return env.a.id;
    case 'AWS::StackName':
      return env.stackName;
    case 'AWS::StackId':
      return env.stackId;
    case 'AWS::Partition':
      return 'aws';
    case 'AWS::URLSuffix':
      return 'amazonaws.com';
    case 'AWS::NoValue':
      return NOVALUE;
    case 'AWS::NotificationARNs':
      return [];
  }
  if (name in env.params) {
    const def = paramDefs(env.tpl)[name];
    const raw = env.params[name];
    return def && /^(CommaDelimitedList|List<)/.test(def.Type) ? raw.split(',').map((s) => s.trim()) : raw;
  }
  const r = env.res[name];
  if (r) return r.id;
  if (env.planning && (env.tpl.Resources as Rec)?.[name]) return `{{${name}}}`;
  throw new CfnFail(`Template format error: Unresolved resource dependencies [${name}] in the Resources block of the template`);
}

function getAtt(logical: string, attr: string, env: Env): string {
  const r = env.res[logical];
  if (!r) {
    if (env.planning) return `{{${logical}.${attr}}}`;
    throw new CfnFail(`Template format error: Unresolved resource dependencies [${logical}] in the Resources block of the template`);
  }
  const v = r.attrs[attr];
  if (v === undefined) throw new CfnFail(`Template error: resource ${logical} does not support attribute type ${attr} in Fn::GetAtt`);
  return v;
}

function evalCond(v: unknown, env: Env): boolean {
  if (!isObj(v)) return Boolean(v);
  const [k] = Object.keys(v);
  const arg = v[k];
  const val = (x: unknown): unknown => (isObj(x) && ('Condition' in x || ['Fn::Equals', 'Fn::Not', 'Fn::And', 'Fn::Or'].some((f) => f in x)) ? evalCond(x, env) : resolve(x, env));
  switch (k) {
    case 'Fn::Equals': {
      const [x, y] = (arg as unknown[]).map(val);
      return String(x) === String(y);
    }
    case 'Fn::Not':
      return !val((arg as unknown[])[0]);
    case 'Fn::And':
      return (arg as unknown[]).every((x) => Boolean(val(x)));
    case 'Fn::Or':
      return (arg as unknown[]).some((x) => Boolean(val(x)));
    case 'Condition':
      if (!(String(arg) in env.conds)) throw tplError(`Unresolved condition dependencies [${arg}] in the Resources block of the template`);
      return env.conds[String(arg)];
    default:
      return Boolean(resolve(v, env));
  }
}

function evalConditions(tpl: Rec, env: Env): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const defs = (tpl.Conditions ?? {}) as Rec;
  env.conds = out;
  for (const [n, d] of Object.entries(defs)) out[n] = evalCond(d, env);
  return out;
}

// ───────────────────────── análisis ─────────────────────────

/** Nombres a los que se refiere un valor (Ref, GetAtt y ${…} de Sub). */
function refsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => refsIn(x, out));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'Ref' && typeof x === 'string') out.add(x);
      else if (k === 'Fn::GetAtt') out.add(String(Array.isArray(x) ? x[0] : String(x).split('.')[0]));
      else if (k === 'Fn::Sub') {
        const s = Array.isArray(x) ? String(x[0]) : String(x);
        const local = Array.isArray(x) && isObj(x[1]) ? Object.keys(x[1] as Rec) : [];
        for (const m of s.matchAll(/\$\{([^}!][^}]*)\}/g)) if (!local.includes(m[1])) out.add(m[1].split('.')[0]);
        if (Array.isArray(x)) refsIn(x[1], out);
      } else if (k === 'Fn::If' && Array.isArray(x)) refsIn(x.slice(1), out);
      else refsIn(x, out);
    }
  }
  return out;
}

export interface Analysis {
  resources: Record<string, Rec>;
  order: string[];
  deps: Record<string, string[]>;
  needsIam: boolean;
  needsNamedIam: boolean;
}

export function analyze(tpl: Rec): Analysis {
  const res = tpl.Resources;
  if (!isObj(res) || !Object.keys(res).length) throw tplError('At least one Resources member must be defined.');
  const resources = res as Record<string, Rec>;
  const pseudo = (n: string) => n.startsWith('AWS::');
  const params = paramDefs(tpl);
  const unrecognized: string[] = [];
  let needsIam = false;
  let needsNamedIam = false;
  for (const [id, r] of Object.entries(resources)) {
    if (!isObj(r) || typeof r.Type !== 'string') throw tplError(`[/Resources/${id}] Every Resources object must contain a Type member.`);
    const t = RESOURCE_TYPES[r.Type] ?? (r.Type.startsWith('AWS::Serverless::') ? undefined : null);
    if (t === null) unrecognized.push(r.Type);
    if (t?.iam) {
      needsIam = true;
      if (t.nameProp && isObj(r.Properties) && (r.Properties as Rec)[t.nameProp] !== undefined) needsNamedIam = true;
    }
  }
  if (unrecognized.length) throw tplError(`Unrecognized resource types: [${[...new Set(unrecognized)].join(', ')}]`);
  const deps: Record<string, string[]> = {};
  const unresolved = new Set<string>();
  for (const [id, r] of Object.entries(resources)) {
    const refs = refsIn(r.Properties);
    for (const d of toArr<string>(r.DependsOn as string | string[] | undefined)) refs.add(d);
    for (const x of refs) if (!pseudo(x) && !(x in params) && !(x in resources)) unresolved.add(x);
    deps[id] = [...refs].filter((x) => x in resources && x !== id);
    for (const g of refsGetAtt(r.Properties)) {
      const t = (resources[g.logical] as Rec | undefined)?.Type as string | undefined;
      if (t && ATTRS[t] && !ATTRS[t].includes(g.attr)) throw tplError(`Template error: resource ${g.logical} does not support attribute type ${g.attr} in Fn::GetAtt`);
    }
  }
  if (unresolved.size) throw tplError(`Unresolved resource dependencies [${[...unresolved].join(', ')}] in the Resources block of the template`);
  const outUnresolved = new Set<string>();
  for (const o of Object.values(isObj(tpl.Outputs) ? (tpl.Outputs as Record<string, Rec>) : {})) {
    if (isObj(o)) for (const x of refsIn(o.Value)) if (!pseudo(x) && !(x in params) && !(x in resources)) outUnresolved.add(x);
  }
  if (outUnresolved.size) throw tplError(`Unresolved resource dependencies [${[...outUnresolved].join(', ')}] in the Outputs block of the template`);
  // orden topológico estable
  const order: string[] = [];
  const state: Record<string, 0 | 1 | 2> = {};
  const visit = (n: string, path: string[]) => {
    if (state[n] === 2) return;
    if (state[n] === 1) throw validation(`Circular dependency between resources: [${[...path.slice(path.indexOf(n)), n].join(', ')}]`);
    state[n] = 1;
    for (const d of deps[n]) visit(d, [...path, n]);
    state[n] = 2;
    order.push(n);
  };
  for (const n of Object.keys(resources)) visit(n, []);
  return { resources, order, deps, needsIam, needsNamedIam };
}

function refsGetAtt(v: unknown, out: { logical: string; attr: string }[] = []): { logical: string; attr: string }[] {
  if (Array.isArray(v)) v.forEach((x) => refsGetAtt(x, out));
  else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'Fn::GetAtt') {
        const p = Array.isArray(x) ? x.map(String) : String(x).split('.');
        out.push({ logical: p[0], attr: p.slice(1).join('.') });
      } else refsGetAtt(x, out);
    }
  }
  return out;
}

function checkCapabilities(an: Analysis, caps: string[], expand: boolean): void {
  const need: string[] = [];
  if (expand && !caps.includes('CAPABILITY_AUTO_EXPAND')) need.push('CAPABILITY_AUTO_EXPAND');
  if (an.needsNamedIam) {
    if (!caps.includes('CAPABILITY_NAMED_IAM')) need.push('CAPABILITY_NAMED_IAM');
  } else if (an.needsIam && !caps.includes('CAPABILITY_IAM') && !caps.includes('CAPABILITY_NAMED_IAM')) need.push('CAPABILITY_IAM');
  if (need.length) throw new AwsError('InsufficientCapabilitiesException', `Requires capabilities : [${need.join(', ')}]`, 400);
}

/** Aplica las transformaciones (SAM) y devuelve la plantilla procesada. */
function processTemplate(l: Loaded, caps?: string[]): { tpl: Rec; expand: boolean } {
  const t = l.tpl.Transform;
  const names = toArr<unknown>(t).map((x) => (isObj(x) ? String(x.Name) : String(x)));
  if (names.includes(SAM_TRANSFORM)) {
    if (caps && !caps.includes('CAPABILITY_AUTO_EXPAND')) throw new AwsError('InsufficientCapabilitiesException', 'Requires capabilities : [CAPABILITY_AUTO_EXPAND]', 400);
    return { tpl: expandSam(l.tpl), expand: true };
  }
  const bad = names.filter((n) => n !== SAM_TRANSFORM && n !== 'AWS::Include');
  if (bad.length) throw validation(`Template format error: unsupported transform ${bad[0]}`);
  return { tpl: l.tpl, expand: false };
}

// ───────────────────────── estado de las pilas ─────────────────────────

export const stackArn = (a: Account, region: string, name: string, id: string) => `arn:aws:cloudformation:${region}:${a.id}:stack/${name}/${uuid(`${a.id}:${name}:${id}`)}`;

/** Estado de la pila en este instante, según los eventos ya ocurridos. */
export function stackStatus(a: Account, s: CfnStack): { status: string; reason?: string } {
  let last: CfnEvent | undefined;
  for (const e of s.events) if (e.type === STACK_TYPE && e.logicalId === s.name && e.at <= a.clock && (!last || e.at >= last.at)) last = e;
  if (s.deleted !== undefined && s.deleted <= a.clock && last?.status !== 'DELETE_FAILED') return { status: 'DELETE_COMPLETE', reason: undefined };
  return { status: last?.status ?? 'CREATE_IN_PROGRESS', reason: last?.reason };
}

const inProgress = (st: string) => st.endsWith('_IN_PROGRESS') && st !== 'REVIEW_IN_PROGRESS';

function resourceStatus(a: Account, s: CfnStack, r: CfnResource): { status: string; reason?: string; at: number } {
  let last: CfnEvent | undefined;
  for (const e of s.events) if (e.type !== STACK_TYPE && e.logicalId === r.logicalId && e.at <= a.clock && (!last || e.at >= last.at)) last = e;
  return { status: r.stuck ?? last?.status ?? 'CREATE_IN_PROGRESS', reason: last?.reason, at: last?.at ?? s.created };
}

let eventSeq = 0;
function emit(s: CfnStack, at: number, logicalId: string, physicalId: string | undefined, type: string, status: string, reason?: string): void {
  s.events.push({ id: `${status.toLowerCase().replace(/_/g, '-')}-${(++eventSeq).toString(16).padStart(8, '0')}`, at, logicalId, physicalId, type, status, reason });
}

/** Pilas activas (no borradas) de la región. */
export const activeStacks = (a: Account, region: string): CfnStack[] => Object.values(cfnOf(a, region).stacks).filter((s) => s.deleted === undefined || s.deleted > a.clock || stackStatus(a, s).status === 'DELETE_FAILED');

function findStack(c: Pick<OpCtx, 'acct' | 'region'>, nameOrId: string, includeDeleted = false): CfnStack {
  const s = cfnOf(c.acct, c.region);
  const byId = s.stacks[nameOrId];
  if (byId) return byId;
  const live = activeStacks(c.acct, c.region).find((x) => x.name === nameOrId);
  if (live) return live;
  if (includeDeleted) {
    const dead = Object.values(s.stacks).filter((x) => x.name === nameOrId).sort((x, y) => y.created - x.created)[0];
    if (dead) return dead;
  }
  throw validation(`Stack with id ${nameOrId} does not exist`);
}

function exportsOf(a: Account, region: string, except?: string): Record<string, { stack: string; value: string }> {
  const out: Record<string, { stack: string; value: string }> = {};
  for (const s of activeStacks(a, region)) {
    if (s.name === except) continue;
    for (const o of s.outputs) if (o.ExportName) out[o.ExportName] = { stack: s.name, value: o.Value };
  }
  return out;
}

// ───────────────────────── ejecución ─────────────────────────

interface Run {
  c: OpCtx;
  stack: CfnStack;
  call: RCtx['call'];
  caller: ReturnType<typeof callerFor>;
  /** Instante (ms) en que empieza la operación. */
  t0: number;
  /** Instante en que termina cada recurso (para las dependencias). */
  finish: Record<string, number>;
  /** Fin del último evento. */
  end: number;
}

function callerFor(c: OpCtx, roleArn: string | undefined) {
  if (!roleArn) return c.caller;
  const name = roleArn.split('/').pop() ?? '';
  const role = c.acct.iam.roles[name];
  if (!role || !roleTrusts(c.acct, roleArn, 'cloudformation.amazonaws.com')) throw validation(`Role ${roleArn} is invalid or cannot be assumed`);
  return roleCaller(c.acct, roleArn, 'AWSCloudFormation');
}

const mkEnv = (c: OpCtx, stack: CfnStack, tpl: Rec, params: Record<string, string>, res: Env['res'], planning = false): Env => {
  const env: Env = {
    a: c.acct,
    region: c.region,
    stackName: stack.name,
    stackId: stack.id,
    params,
    tpl,
    conds: {},
    res,
    planning,
    importValue(name) {
      const e = exportsOf(c.acct, c.region, stack.name)[name];
      if (!e) throw validation(`No export named ${name} found.`);
      return e.value;
    },
  };
  evalConditions(tpl, env);
  return env;
};

function typeOf(t: string): RType {
  const r = RESOURCE_TYPES[t];
  if (!r) throw tplError(`Unrecognized resource types: [${t}]`);
  return r;
}

function checkProps(t: RType, props: Rec): void {
  for (const k of Object.keys(props)) if (!t.allowed.includes(k)) throw new CfnFail(`Encountered unsupported property ${k}`);
}

const rctx = (run: Run, logicalId: string): RCtx => ({ a: run.c.acct, region: run.c.region, caller: run.caller, stackName: run.stack.name, logicalId, call: run.call });

/** Resuelve las propiedades de un recurso de la plantilla. */
function propsOf(def: Rec, env: Env): Rec {
  const p = isObj(def.Properties) ? (def.Properties as Rec) : {};
  return resolve(p, env) as Rec;
}

/** Crea un recurso; devuelve el recurso o lanza `CfnFail`. */
function createOne(run: Run, logicalId: string, def: Rec, env: Env, start: number): CfnResource {
  const type = String(def.Type);
  const t = typeOf(type);
  const props = propsOf(def, env);
  checkProps(t, props);
  const given = t.nameProp ? props[t.nameProp] : undefined;
  const name = given !== undefined ? String(given) : t.nameProp ? genName(run.stack.name, logicalId, { max: t.nameMax, lower: t.lower }) : '';
  const out = t.create(rctx(run, logicalId), props, name);
  const res: CfnResource = {
    logicalId,
    type,
    physicalId: out.id,
    props,
    attrs: { ...(out.attrs ?? {}) },
    deletionPolicy: def.DeletionPolicy ? String(def.DeletionPolicy) : undefined,
    autoNamed: t.nameProp ? given === undefined : false,
  };
  void start;
  return res;
}

function deleteOne(run: Run, r: CfnResource): void {
  typeOf(r.type).delete(rctx(run, r.logicalId), r.physicalId, r.props);
}

function failMessage(e: unknown): string {
  if (e instanceof CfnFail) return e.message;
  if (e instanceof AwsError) return `${e.message} (Service: ${e.code}; Status Code: ${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

const ms = (secs: number) => secs * 1000;

/** Programa los eventos de «creando» y «creado» de un recurso y devuelve el instante en que termina. */
function schedule(run: Run, logicalId: string, deps: string[], secs: number, mode: 'CREATE' | 'UPDATE' | 'DELETE'): { start: number; end: number } {
  const start = Math.max(run.t0 + 1500, ...deps.map((d) => run.finish[d] ?? 0)) + 500;
  const end = start + ms(secs);
  run.finish[logicalId] = end;
  run.end = Math.max(run.end, end);
  void mode;
  return { start, end };
}

function evalOutputs(c: OpCtx, stack: CfnStack, env: Env, tpl: Rec): void {
  const outs: CfnStack['outputs'] = [];
  for (const [k, o] of Object.entries((tpl.Outputs ?? {}) as Record<string, Rec>)) {
    if (o.Condition && !env.conds[String(o.Condition)]) continue;
    const exp = isObj(o.Export) ? String(resolve((o.Export as Rec).Name, env)) : undefined;
    outs.push({ Key: k, Value: String(resolve(o.Value, env)), ...(o.Description ? { Description: String(o.Description) } : {}), ...(exp ? { ExportName: exp } : {}) });
  }
  const taken = exportsOf(c.acct, c.region, stack.name);
  for (const o of outs) if (o.ExportName && taken[o.ExportName]) throw validation(`Export with name ${o.ExportName} is already exported by stack ${taken[o.ExportName].stack}`);
  stack.outputs = outs;
}

function newStack(c: OpCtx, name: string, l: Loaded, tpl: Rec, params: Record<string, string>, caps: string[], tags: CfnStack['tags']): CfnStack {
  const state = cfnOf(c.acct, c.region);
  const seq = Object.keys(state.stacks).length + 1;
  const id = stackArn(c.acct, c.region, name, String(seq));
  const s: CfnStack = {
    id,
    name,
    template: tpl,
    originalText: l.text,
    originalIsJson: l.isJson,
    params,
    caps,
    tags,
    resources: {},
    outputs: [],
    events: [],
    created: c.acct.clock,
    termProtection: false,
    disableRollback: false,
    description: typeof tpl.Description === 'string' ? tpl.Description : undefined,
    changeSets: [],
  };
  state.stacks[id] = s;
  return s;
}

function mkRun(c: OpCtx, stack: CfnStack): Run {
  const caller = callerFor(c, stack.roleArn);
  const t0 = c.acct.clock;
  return { c, stack, caller, call: makeCall(c.acct, c.region, caller), t0, finish: {}, end: t0 };
}

/** Crea los recursos de una plantilla en la pila (creación o ejecución de un conjunto de cambios de tipo CREATE). */
function runCreate(c: OpCtx, stack: CfnStack, an: Analysis, tpl: Rec): void {
  const run = mkRun(c, stack);
  const t0 = run.t0;
  emit(stack, t0, stack.name, stack.id, STACK_TYPE, 'CREATE_IN_PROGRESS', 'User Initiated');
  const env = mkEnv(c, stack, tpl, stack.params, {});
  const created: CfnResource[] = [];
  let failed: { id: string; reason: string } | undefined;
  for (const id of an.order) {
    const def = an.resources[id];
    if (def.Condition && !env.conds[String(def.Condition)]) continue;
    const t = typeOf(String(def.Type));
    const { start, end } = schedule(run, id, an.deps[id], t.secs, 'CREATE');
    emit(stack, start, id, undefined, String(def.Type), 'CREATE_IN_PROGRESS');
    try {
      const r = createOne(run, id, def, env, start);
      created.push(r);
      stack.resources[id] = r;
      env.res[id] = { type: r.type, id: r.physicalId, attrs: r.attrs };
      emit(stack, end, id, r.physicalId, r.type, 'CREATE_COMPLETE');
    } catch (e) {
      failed = { id, reason: failMessage(e) };
      emit(stack, start + 800, id, undefined, String(def.Type), 'CREATE_FAILED', failed.reason);
      run.end = Math.max(run.end, start + 800);
      break;
    }
  }
  if (!failed) {
    try {
      evalOutputs(c, stack, env, tpl);
    } catch (e) {
      failed = { id: stack.name, reason: failMessage(e) };
    }
  }
  if (!failed) {
    emit(stack, run.end + 1500, stack.name, stack.id, STACK_TYPE, 'CREATE_COMPLETE');
    return;
  }
  const mode = stack.disableRollback ? 'DO_NOTHING' : (stack.onFailure ?? 'ROLLBACK');
  if (mode === 'DO_NOTHING') {
    emit(stack, run.end + 1500, stack.name, stack.id, STACK_TYPE, 'CREATE_FAILED', `The following resource(s) failed to create: [${failed.id}]. `);
    return;
  }
  let t = run.end + 1000;
  emit(stack, t, stack.name, stack.id, STACK_TYPE, 'ROLLBACK_IN_PROGRESS', `The following resource(s) failed to create: [${failed.id}]. Rollback requested by user.`);
  let rollbackFailed = false;
  for (const r of created.reverse()) {
    t += 500;
    emit(stack, t, r.logicalId, r.physicalId, r.type, 'DELETE_IN_PROGRESS');
    try {
      if (r.deletionPolicy !== 'Retain') deleteOne(run, r);
      t += ms(typeOf(r.type).secs / 2);
      emit(stack, t, r.logicalId, r.physicalId, r.type, r.deletionPolicy === 'Retain' ? 'DELETE_SKIPPED' : 'DELETE_COMPLETE');
      delete stack.resources[r.logicalId];
    } catch (e) {
      rollbackFailed = true;
      emit(stack, t + 500, r.logicalId, r.physicalId, r.type, 'DELETE_FAILED', failMessage(e));
    }
  }
  t += 1500;
  if (rollbackFailed) emit(stack, t, stack.name, stack.id, STACK_TYPE, 'ROLLBACK_FAILED', 'The following resource(s) failed to delete. Rollback requested by user.');
  else {
    emit(stack, t, stack.name, stack.id, STACK_TYPE, 'ROLLBACK_COMPLETE');
    if (mode === 'DELETE') {
      emit(stack, t + 2000, stack.name, stack.id, STACK_TYPE, 'DELETE_COMPLETE');
      stack.deleted = t + 2000;
    }
  }
}

// ───────────────────────── plan de cambios ─────────────────────────

interface PlanRow {
  id: string;
  action: 'Add' | 'Modify' | 'Remove' | 'Keep';
  type: string;
  replace: boolean;
  /** Propiedades distintas y si cada una obliga a sustituir. */
  diffs: { prop: string; recreate: boolean; dynamic: boolean }[];
}

function sameJson(x: unknown, y: unknown) {
  return JSON.stringify(x) === JSON.stringify(y);
}

/** Qué cambiaría al pasar de la pila actual a otra plantilla (sin tocar la cuenta). */
function planChanges(c: OpCtx, stack: CfnStack, an: Analysis, tpl: Rec, params: Record<string, string>): { rows: PlanRow[]; env: Env } {
  const old = stack.resources;
  // los recursos existentes mantienen su nombre; los demás aparecen como `{{Nombre}}` hasta que se creen
  const res: Env['res'] = {};
  for (const r of Object.values(old)) res[r.logicalId] = { type: r.type, id: r.physicalId, attrs: r.attrs };
  const env = mkEnv(c, stack, tpl, params, res, true);
  const rows: PlanRow[] = [];
  const replaced = new Set<string>();
  for (const id of an.order) {
    const def = an.resources[id];
    if (def.Condition && !env.conds[String(def.Condition)]) continue;
    const type = String(def.Type);
    const t = typeOf(type);
    const prev = old[id];
    if (!prev) {
      rows.push({ id, action: 'Add', type, replace: false, diffs: [] });
      delete env.res[id];
      continue;
    }
    if (prev.type !== type) {
      rows.push({ id, action: 'Modify', type, replace: true, diffs: [{ prop: 'Type', recreate: true, dynamic: false }] });
      replaced.add(id);
      delete env.res[id];
      continue;
    }
    const next = propsOf(def, env);
    const diffs: PlanRow['diffs'] = [];
    for (const k of new Set([...Object.keys(prev.props), ...Object.keys(next)])) {
      if (sameJson(prev.props[k], next[k])) continue;
      const refsReplaced = refsIn((def.Properties as Rec | undefined)?.[k]);
      const dynamic = [...refsReplaced].some((x) => replaced.has(x));
      diffs.push({ prop: k, recreate: !t.mutable.includes(k), dynamic });
    }
    if (!diffs.length) {
      rows.push({ id, action: 'Keep', type, replace: false, diffs: [] });
      continue;
    }
    const replace = diffs.some((d) => d.recreate);
    rows.push({ id, action: 'Modify', type, replace, diffs });
    if (replace) {
      replaced.add(id);
      delete env.res[id];
    }
  }
  for (const r of Object.values(old)) if (!(r.logicalId in an.resources) || (an.resources[r.logicalId].Condition && !env.conds[String(an.resources[r.logicalId].Condition)])) rows.push({ id: r.logicalId, action: 'Remove', type: r.type, replace: false, diffs: [] });
  return { rows, env };
}

function changesFrom(rows: PlanRow[], stack: CfnStack): CfnChange[] {
  const out: CfnChange[] = [];
  for (const r of rows) {
    if (r.action === 'Keep') continue;
    const prev = stack.resources[r.id];
    out.push({
      Action: r.action,
      LogicalResourceId: r.id,
      ...(prev ? { PhysicalResourceId: prev.physicalId } : {}),
      ResourceType: r.type,
      ...(r.action === 'Modify' ? { Replacement: r.replace ? 'True' : 'False' } : {}),
      Scope: r.action === 'Modify' ? ['Properties'] : [],
      Details: r.diffs.map((d) => ({ Target: { Attribute: d.prop === 'Type' ? 'Type' : 'Properties', ...(d.prop === 'Type' ? {} : { Name: d.prop }), RequiresRecreation: d.recreate ? 'Always' : 'Never' }, Evaluation: d.dynamic ? 'Dynamic' : 'Static', ChangeSource: d.dynamic ? 'ResourceReference' : 'DirectModification' })),
    });
  }
  return out;
}

/** Ejecuta una actualización sobre una pila existente. Si algo falla, deshace lo hecho. */
function runUpdate(c: OpCtx, stack: CfnStack, an: Analysis, tpl: Rec, params: Record<string, string>, caps: string[], text: Loaded): void {
  const run = mkRun(c, stack);
  emit(stack, run.t0, stack.name, stack.id, STACK_TYPE, 'UPDATE_IN_PROGRESS', 'User Initiated');
  const oldRes = stack.resources;
  const { rows } = planChanges(c, stack, an, tpl, params);
  const res: Env['res'] = {};
  for (const r of Object.values(oldRes)) res[r.logicalId] = { type: r.type, id: r.physicalId, attrs: r.attrs };
  const env = mkEnv(c, stack, tpl, params, res);
  const draft: Record<string, CfnResource> = { ...oldRes };
  const undo: (() => void)[] = [];
  const cleanup: CfnResource[] = [];
  let failed: { id: string; reason: string } | undefined;
  const rowOf = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const id of an.order) {
    const row = rowOf[id];
    if (!row || row.action === 'Keep' || row.action === 'Remove') continue;
    const def = an.resources[id];
    const t = typeOf(row.type);
    const prev = oldRes[id];
    const { start, end } = schedule(run, id, an.deps[id], t.secs, row.action === 'Add' ? 'CREATE' : 'UPDATE');
    try {
      if (row.action === 'Add' || row.replace) {
        emit(stack, start, id, undefined, row.type, row.action === 'Add' ? 'CREATE_IN_PROGRESS' : 'UPDATE_IN_PROGRESS');
        if (row.replace && prev && !prev.autoNamed && t.nameProp && propsOf(def, env)[t.nameProp] === prev.props[t.nameProp]) {
          throw new CfnFail(`CloudFormation cannot update a stack when a custom-named resource requires replacing. Rename ${String(prev.props[t.nameProp])} and update the stack again.`);
        }
        const r = createOne(run, id, def, env, start);
        undo.push(() => deleteOne(run, r));
        draft[id] = r;
        env.res[id] = { type: r.type, id: r.physicalId, attrs: r.attrs };
        if (prev) cleanup.push(prev);
        emit(stack, end, id, r.physicalId, r.type, row.action === 'Add' ? 'CREATE_COMPLETE' : 'UPDATE_COMPLETE');
      } else if (prev) {
        emit(stack, start, id, prev.physicalId, row.type, 'UPDATE_IN_PROGRESS');
        const next = propsOf(def, env);
        checkProps(t, next);
        t.update?.(rctx(run, id), prev.physicalId, prev.props, next);
        undo.push(() => t.update?.(rctx(run, id), prev.physicalId, next, prev.props));
        draft[id] = { ...prev, props: next, deletionPolicy: def.DeletionPolicy ? String(def.DeletionPolicy) : prev.deletionPolicy };
        emit(stack, end, id, prev.physicalId, row.type, 'UPDATE_COMPLETE');
      }
    } catch (e) {
      failed = { id, reason: failMessage(e) };
      emit(stack, start + 800, id, prev?.physicalId, row.type, 'UPDATE_FAILED', failed.reason);
      run.end = Math.max(run.end, start + 800);
      break;
    }
  }
  if (!failed) {
    // las salidas se calculan con los recursos nuevos
    const keep = stack.outputs;
    try {
      evalOutputs(c, stack, env, tpl);
    } catch (e) {
      failed = { id: stack.name, reason: failMessage(e) };
      stack.outputs = keep;
    }
  }
  if (failed) {
    let t = run.end + 1000;
    emit(stack, t, stack.name, stack.id, STACK_TYPE, 'UPDATE_ROLLBACK_IN_PROGRESS', failed.reason);
    for (const u of undo.reverse()) {
      try {
        u();
      } catch {
        /* lo mejor posible */
      }
    }
    t += 4000;
    emit(stack, t, stack.name, stack.id, STACK_TYPE, 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS');
    emit(stack, t + 2000, stack.name, stack.id, STACK_TYPE, 'UPDATE_ROLLBACK_COMPLETE');
    return;
  }
  // confirma: recursos nuevos y plantilla
  const gone = Object.values(oldRes).filter((r) => rowOf[r.logicalId]?.action === 'Remove');
  let t = run.end + 1000;
  emit(stack, t, stack.name, stack.id, STACK_TYPE, 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS');
  for (const r of [...cleanup, ...gone]) {
    t += 500;
    if (r.deletionPolicy === 'Retain') {
      emit(stack, t, r.logicalId + (gone.includes(r) ? '' : ''), r.physicalId, r.type, 'DELETE_SKIPPED');
    } else {
      emit(stack, t, r.logicalId, r.physicalId, r.type, 'DELETE_IN_PROGRESS');
      try {
        deleteOne(run, r);
        emit(stack, t + 1500, r.logicalId, r.physicalId, r.type, 'DELETE_COMPLETE');
      } catch (e) {
        emit(stack, t + 1500, r.logicalId, r.physicalId, r.type, 'DELETE_FAILED', failMessage(e));
      }
    }
    if (gone.includes(r)) delete draft[r.logicalId];
  }
  stack.resources = draft;
  stack.template = tpl;
  stack.originalText = text.text;
  stack.originalIsJson = text.isJson;
  stack.params = params;
  stack.caps = caps;
  stack.updated = t;
  stack.description = typeof tpl.Description === 'string' ? tpl.Description : undefined;
  stack.drift = undefined;
  emit(stack, t + 2000, stack.name, stack.id, STACK_TYPE, 'UPDATE_COMPLETE');
}

function runDelete(c: OpCtx, stack: CfnStack, retain: string[]): void {
  const run = mkRun(c, stack);
  emit(stack, run.t0, stack.name, stack.id, STACK_TYPE, 'DELETE_IN_PROGRESS', 'User Initiated');
  let t = run.t0;
  let failedAny = false;
  const order = Object.values(stack.resources).reverse();
  for (const r of order) {
    t += 500;
    if (r.deletionPolicy === 'Retain' || retain.includes(r.logicalId)) {
      emit(stack, t, r.logicalId, r.physicalId, r.type, 'DELETE_SKIPPED');
      delete stack.resources[r.logicalId];
      continue;
    }
    emit(stack, t, r.logicalId, r.physicalId, r.type, 'DELETE_IN_PROGRESS');
    try {
      deleteOne(run, r);
      t += ms(typeOf(r.type).secs / 2);
      emit(stack, t, r.logicalId, r.physicalId, r.type, 'DELETE_COMPLETE');
      delete stack.resources[r.logicalId];
    } catch (e) {
      failedAny = true;
      emit(stack, t + 500, r.logicalId, r.physicalId, r.type, 'DELETE_FAILED', failMessage(e));
      r.stuck = 'DELETE_FAILED';
    }
  }
  t += 1500;
  if (failedAny) {
    const names = Object.values(stack.resources).filter((r) => r.stuck).map((r) => r.logicalId);
    emit(stack, t, stack.name, stack.id, STACK_TYPE, 'DELETE_FAILED', `The following resource(s) failed to delete: [${names.join(', ')}]. `);
  } else {
    emit(stack, t, stack.name, stack.id, STACK_TYPE, 'DELETE_COMPLETE');
    stack.deleted = t;
  }
}

// ───────────────────────── vistas ─────────────────────────

const ts = (ms_: number) => iso(ms_);

function stackView(a: Account, s: CfnStack) {
  const st = stackStatus(a, s);
  const noEcho = new Set(Object.entries(paramDefs(s.template)).filter(([, d]) => d.NoEcho === true || d.NoEcho === 'true').map(([k]) => k));
  return {
    StackId: s.id,
    StackName: s.name,
    ...(s.description ? { Description: s.description } : {}),
    Parameters: Object.entries(s.params).map(([k, v]) => ({ ParameterKey: k, ParameterValue: noEcho.has(k) ? '****' : v })),
    CreationTime: ts(s.created),
    ...(s.updated !== undefined ? { LastUpdatedTime: ts(s.updated) } : {}),
    RollbackConfiguration: {},
    StackStatus: st.status,
    ...(st.reason ? { StackStatusReason: st.reason } : {}),
    DisableRollback: s.disableRollback,
    NotificationARNs: [],
    Capabilities: s.caps,
    ...(st.status.endsWith('_COMPLETE') || st.status === 'UPDATE_ROLLBACK_COMPLETE' ? { Outputs: s.outputs.map((o) => ({ OutputKey: o.Key, OutputValue: o.Value, ...(o.Description ? { Description: o.Description } : {}), ...(o.ExportName ? { ExportName: o.ExportName } : {}) })) } : {}),
    ...(s.roleArn ? { RoleARN: s.roleArn } : {}),
    Tags: s.tags,
    EnableTerminationProtection: s.termProtection,
    DriftInformation: { StackDriftStatus: s.drift?.status ?? 'NOT_CHECKED', ...(s.drift ? { LastCheckTimestamp: ts(s.drift.at) } : {}) },
  };
}

const resView = (a: Account, s: CfnStack, r: CfnResource) => {
  const st = resourceStatus(a, s, r);
  const d = s.drift?.items.find((x) => x.logicalId === r.logicalId);
  return { StackName: s.name, StackId: s.id, LogicalResourceId: r.logicalId, PhysicalResourceId: r.physicalId, ResourceType: r.type, Timestamp: ts(st.at), ResourceStatus: st.status, ...(st.reason ? { ResourceStatusReason: st.reason } : {}), DriftInformation: { StackResourceDriftStatus: d?.status ?? 'NOT_CHECKED' } };
};

const parseParams = (p: unknown): { map: Record<string, string>; prev: string[] } => {
  const map: Record<string, string> = {};
  const prev: string[] = [];
  for (const x of toArr<Rec>(p as Rec[])) {
    const k = String(x.ParameterKey);
    if (x.UsePreviousValue === true || x.UsePreviousValue === 'true') prev.push(k);
    else if (x.ParameterValue !== undefined) map[k] = String(x.ParameterValue);
  }
  return { map, prev };
};

const tagsOf = (t: unknown): CfnStack['tags'] => toArr<Rec>(t as Rec[]).map((x) => ({ Key: String(x.Key), Value: String(x.Value) }));

const guardState = (a: Account, s: CfnStack, what: string) => {
  const st = stackStatus(a, s).status;
  if (inProgress(st)) throw validation(`Stack:${s.id} is in ${st} state and can not be ${what}.`);
  return st;
};

// ───────────────────────── operaciones ─────────────────────────

op('cloudformation', 'create-stack', 'stack-name:s! template-body:s template-url:s parameters:f capabilities:l tags:t disable-rollback:b on-failure:s role-arn:s enable-termination-protection:b timeout-in-minutes:i notification-arns:l', 'Crea una pila: CloudFormation lee la plantilla, crea los recursos en orden de dependencias y, si algo falla, deshace todo (rollback).', { res: () => '*' }, (c) => {
  const name = String(c.p.StackName);
  if (!/^[a-zA-Z][-a-zA-Z0-9]{0,127}$/.test(name)) throw validation(`1 validation error detected: Value '${name}' at 'stackName' failed to satisfy constraint: Member must satisfy regular expression pattern: [a-zA-Z][-a-zA-Z0-9]*`);
  if (activeStacks(c.acct, c.region).some((x) => x.name === name)) throw new AwsError('AlreadyExistsException', `Stack [${name}] already exists`, 400);
  if (c.p.OnFailure && c.p.DisableRollback) throw validation('DisableRollback and OnFailure cannot both be specified.');
  if (c.p.OnFailure && !['ROLLBACK', 'DO_NOTHING', 'DELETE'].includes(c.p.OnFailure)) throw validation(`1 validation error detected: Value '${c.p.OnFailure}' at 'onFailure' failed to satisfy constraint: Member must satisfy enum value set: [ROLLBACK, DO_NOTHING, DELETE]`);
  const l = loadTemplate(templateText(c, c.p.TemplateBody, c.p.TemplateUrl));
  const caps = toArr<string>(c.p.Capabilities);
  const { tpl, expand } = processTemplate(l, caps);
  const an = analyze(tpl);
  checkCapabilities(an, caps, expand);
  const { map } = parseParams(c.p.Parameters);
  const params = finalParams(tpl, map);
  callerFor(c, c.p.RoleArn);
  const s = newStack(c, name, l, tpl, params, caps, tagsOf(c.p.Tags));
  s.disableRollback = !!c.p.DisableRollback;
  s.onFailure = c.p.OnFailure;
  s.roleArn = c.p.RoleArn;
  s.termProtection = !!c.p.EnableTerminationProtection;
  runCreate(c, s, an, tpl);
  return { StackId: s.id };
});

op('cloudformation', 'describe-stacks', 'stack-name:s', 'Estado, parámetros y salidas de una pila (o de todas).', { res: () => '*', paginate: 'Stacks' }, (c) => {
  if (c.p.StackName) return { Stacks: [stackView(c.acct, findStack(c, c.p.StackName))] };
  return { Stacks: activeStacks(c.acct, c.region).filter((s) => stackStatus(c.acct, s).status !== 'DELETE_COMPLETE').map((s) => stackView(c.acct, s)) };
});

op('cloudformation', 'list-stacks', 'stack-status-filter:l', 'Lista las pilas (incluidas las borradas en los últimos 90 días).', { res: () => '*', paginate: 'StackSummaries' }, (c) => {
  const f = toArr<string>(c.p.StackStatusFilter);
  return {
    StackSummaries: Object.values(cfnOf(c.acct, c.region).stacks)
      .map((s) => ({ s, st: stackStatus(c.acct, s) }))
      .filter((x) => !f.length || f.includes(x.st.status))
      .map(({ s, st }) => ({ StackId: s.id, StackName: s.name, CreationTime: ts(s.created), ...(s.updated !== undefined ? { LastUpdatedTime: ts(s.updated) } : {}), ...(s.deleted !== undefined && st.status === 'DELETE_COMPLETE' ? { DeletionTime: ts(s.deleted) } : {}), StackStatus: st.status, ...(st.reason ? { StackStatusReason: st.reason } : {}), DriftInformation: { StackDriftStatus: s.drift?.status ?? 'NOT_CHECKED' } })),
  };
});

op('cloudformation', 'describe-stack-events', 'stack-name:s!', 'Eventos de la pila, del más reciente al más antiguo: qué recurso se creó, actualizó o falló y por qué.', { res: () => '*', paginate: 'StackEvents' }, (c) => {
  const s = findStack(c, c.p.StackName, true);
  return {
    StackEvents: s.events
      .filter((e) => e.at <= c.acct.clock)
      .map((e, i) => ({ e, i }))
      .sort((x, y) => y.e.at - x.e.at || y.i - x.i)
      .map(({ e }) => ({ StackId: s.id, EventId: e.id, StackName: s.name, LogicalResourceId: e.logicalId, ...(e.physicalId ? { PhysicalResourceId: e.physicalId } : {}), ResourceType: e.type, Timestamp: ts(e.at), ResourceStatus: e.status, ...(e.reason ? { ResourceStatusReason: e.reason } : {}) })),
  };
});

const resourcesOf = (c: OpCtx, s: CfnStack) => {
  const seen = new Set(s.events.filter((e) => e.type !== STACK_TYPE && e.at <= c.acct.clock).map((e) => e.logicalId));
  return Object.values(s.resources).filter((r) => seen.has(r.logicalId));
};

op('cloudformation', 'describe-stack-resources', 'stack-name:s logical-resource-id:s physical-resource-id:s', 'Recursos de una pila con su nombre físico y estado.', { res: () => '*' }, (c) => {
  const s = c.p.StackName ? findStack(c, c.p.StackName, true) : activeStacks(c.acct, c.region).find((x) => Object.values(x.resources).some((r) => r.physicalId === c.p.PhysicalResourceId));
  if (!s) throw validation(`Stack for ${c.p.PhysicalResourceId} does not exist`);
  return { StackResources: resourcesOf(c, s).filter((r) => (!c.p.LogicalResourceId || r.logicalId === c.p.LogicalResourceId) && (!c.p.PhysicalResourceId || r.physicalId === c.p.PhysicalResourceId)).map((r) => resView(c.acct, s, r)) };
});

op('cloudformation', 'list-stack-resources', 'stack-name:s!', 'Resumen de los recursos de la pila.', { res: () => '*', paginate: 'StackResourceSummaries' }, (c) => {
  const s = findStack(c, c.p.StackName, true);
  return { StackResourceSummaries: resourcesOf(c, s).map((r) => { const v = resView(c.acct, s, r); return { LogicalResourceId: v.LogicalResourceId, PhysicalResourceId: v.PhysicalResourceId, ResourceType: v.ResourceType, LastUpdatedTimestamp: v.Timestamp, ResourceStatus: v.ResourceStatus, ...(v.ResourceStatusReason ? { ResourceStatusReason: v.ResourceStatusReason } : {}), DriftInformation: v.DriftInformation }; }) };
});

op('cloudformation', 'describe-stack-resource', 'stack-name:s! logical-resource-id:s!', 'Un recurso de la pila.', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName, true);
  const r = s.resources[c.p.LogicalResourceId];
  if (!r) throw validation(`Resource ${c.p.LogicalResourceId} does not exist for stack ${s.name}`);
  const v = resView(c.acct, s, r);
  return { StackResourceDetail: { StackName: s.name, StackId: s.id, LogicalResourceId: r.logicalId, PhysicalResourceId: r.physicalId, ResourceType: r.type, LastUpdatedTimestamp: v.Timestamp, ResourceStatus: v.ResourceStatus, DriftInformation: v.DriftInformation } };
});

op('cloudformation', 'delete-stack', 'stack-name:s! retain-resources:l role-arn:s', 'Borra la pila y sus recursos (salvo los `DeletionPolicy: Retain`). Un bucket con objetos falla al borrarse.', { res: () => '*' }, (c) => {
  const s = (() => {
    try {
      return findStack(c, c.p.StackName);
    } catch {
      return undefined;
    }
  })();
  if (!s) return undefined;
  const st = guardState(c.acct, s, 'deleted');
  if (st === 'DELETE_COMPLETE') return undefined;
  if (s.termProtection) throw validation(`Stack [${s.name}] cannot be deleted while TerminationProtection is enabled`);
  const retain = toArr<string>(c.p.RetainResources);
  if (retain.length && st !== 'DELETE_FAILED') throw validation('Specifying RetainResources is only valid for stacks in the DELETE_FAILED state.');
  for (const o of s.outputs) {
    if (!o.ExportName) continue;
    const user = activeStacks(c.acct, c.region).find((x) => x.name !== s.name && JSON.stringify(x.template.Resources).includes(`"${o.ExportName}"`));
    if (user) throw validation(`Export ${o.ExportName} cannot be deleted as it is in use by ${user.name}`);
  }
  if (c.p.RoleArn) s.roleArn = c.p.RoleArn;
  for (const r of Object.values(s.resources)) r.stuck = undefined;
  runDelete(c, s, retain);
  return undefined;
});

op('cloudformation', 'update-stack', 'stack-name:s! template-body:s template-url:s use-previous-template:b parameters:f capabilities:l tags:t role-arn:s', 'Actualiza la pila con una plantilla nueva (o con otros parámetros). Si falla, deshace los cambios.', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName);
  const st = guardState(c.acct, s, 'updated');
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(st)) throw validation(`Stack:${s.id} is in ${st} state and can not be updated.`);
  const prevTpl = c.p.UsePreviousTemplate;
  const l = prevTpl ? { tpl: s.template, text: s.originalText, isJson: s.originalIsJson } : loadTemplate(templateText(c, c.p.TemplateBody, c.p.TemplateUrl));
  const caps = toArr<string>(c.p.Capabilities);
  const { tpl, expand } = prevTpl ? { tpl: s.template, expand: false } : processTemplate(l, caps);
  const an = analyze(tpl);
  if (!prevTpl) checkCapabilities(an, caps, expand);
  const { map, prev } = parseParams(c.p.Parameters);
  const params = finalParams(tpl, map, s.params, prev);
  if (c.p.RoleArn) s.roleArn = c.p.RoleArn;
  const { rows } = planChanges(c, s, an, tpl, params);
  if (!rows.some((r) => r.action !== 'Keep') && JSON.stringify(tpl.Outputs ?? {}) === JSON.stringify(s.template.Outputs ?? {})) throw validation('No updates are to be performed.');
  if (c.p.Tags) s.tags = tagsOf(c.p.Tags);
  runUpdate(c, s, an, tpl, params, caps.length ? caps : s.caps, l);
  return { StackId: s.id };
});

op('cloudformation', 'update-termination-protection', 'enable-termination-protection:b stack-name:s!', 'Activa o desactiva la protección contra borrado de la pila.', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName);
  s.termProtection = !!c.p.EnableTerminationProtection;
  return { StackId: s.id };
});

op('cloudformation', 'get-template', 'stack-name:s change-set-name:s template-stage:s', 'La plantilla de una pila (`Original` o `Processed`, con las transformaciones aplicadas).', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName, true);
  const processed = c.p.TemplateStage === 'Processed';
  return { TemplateBody: processed ? s.template : s.originalIsJson ? JSON.parse(s.originalText) : s.originalText, StagesAvailable: ['Original', 'Processed'] };
});

function summaryOf(tpl: Rec, an: Analysis, expand: boolean) {
  const defs = paramDefs(tpl);
  const caps = [...(an.needsNamedIam ? ['CAPABILITY_NAMED_IAM'] : an.needsIam ? ['CAPABILITY_IAM'] : []), ...(expand ? ['CAPABILITY_AUTO_EXPAND'] : [])];
  return {
    Parameters: Object.entries(defs).map(([k, d]) => ({ ParameterKey: k, ...(d.Default !== undefined ? { DefaultValue: String(d.Default) } : {}), ParameterType: d.Type, NoEcho: d.NoEcho === true || d.NoEcho === 'true', ...(d.Description ? { Description: d.Description } : {}), ParameterConstraints: { ...(d.AllowedValues ? { AllowedValues: d.AllowedValues.map(String) } : {}) } })),
    ...(typeof tpl.Description === 'string' ? { Description: tpl.Description } : {}),
    Capabilities: caps,
    ...(caps.length ? { CapabilitiesReason: 'The following resource(s) require capabilities: [' + an.order.filter((id) => RESOURCE_TYPES[String(an.resources[id].Type)]?.iam).join(', ') + ']' } : {}),
    ResourceTypes: [...new Set(an.order.map((id) => String(an.resources[id].Type)))],
    Version: String(tpl.AWSTemplateFormatVersion ?? '2010-09-09'),
    ...(isObj(tpl.Metadata) ? { Metadata: JSON.stringify(tpl.Metadata) } : {}),
  };
}

op('cloudformation', 'get-template-summary', 'template-body:s template-url:s stack-name:s', 'Resumen de una plantilla: parámetros, tipos de recurso y capacidades que exige.', { res: () => '*' }, (c) => {
  if (c.p.StackName && !c.p.TemplateBody && !c.p.TemplateUrl) {
    const s = findStack(c, c.p.StackName);
    return summaryOf(s.template, analyze(s.template), false);
  }
  const l = loadTemplate(templateText(c, c.p.TemplateBody, c.p.TemplateUrl));
  const { tpl, expand } = processTemplate(l);
  return summaryOf(tpl, analyze(tpl), expand);
});

op('cloudformation', 'validate-template', 'template-body:s template-url:s', 'Comprueba que la plantilla está bien formada: sintaxis, tipos de recurso, referencias y dependencias circulares.', { res: () => '*' }, (c) => {
  const l = loadTemplate(templateText(c, c.p.TemplateBody, c.p.TemplateUrl));
  const { tpl, expand } = processTemplate(l);
  const s = summaryOf(tpl, analyze(tpl), expand);
  return { Parameters: s.Parameters.map(({ ParameterKey, DefaultValue, NoEcho, Description }) => ({ ParameterKey, ...(DefaultValue !== undefined ? { DefaultValue } : {}), NoEcho, ...(Description ? { Description } : {}) })), ...(s.Description ? { Description: s.Description } : {}), Capabilities: s.Capabilities, ...(s.CapabilitiesReason ? { CapabilitiesReason: s.CapabilitiesReason } : {}) };
});

// ───────────────────────── conjuntos de cambios ─────────────────────────

const csArn = (a: Account, region: string, name: string, stackName: string) => `arn:aws:cloudformation:${region}:${a.id}:changeSet/${name}/${uuid(`${a.id}:cs:${stackName}:${name}`)}`;

export function createChangeSet(c: OpCtx, o: { stackName: string; name: string; text: string; params: Record<string, string>; prevParams: string[]; caps: string[]; type: 'CREATE' | 'UPDATE'; usePrevious?: boolean; description?: string; tags?: CfnStack['tags'] }): CfnChangeSet {
  const state = cfnOf(c.acct, c.region);
  let stack: CfnStack | undefined;
  try {
    stack = findStack(c, o.stackName);
  } catch {
    stack = undefined;
  }
  if (o.type === 'CREATE' && stack && stackStatus(c.acct, stack).status !== 'REVIEW_IN_PROGRESS') throw new AwsError('AlreadyExistsException', `Stack [${o.stackName}] already exists and cannot be created again with the changeSet [${o.name}].`, 400);
  if (o.type === 'UPDATE' && !stack) throw validation(`Stack [${o.stackName}] does not exist`);
  if (stack) {
    const dup = stack.changeSets.map((id) => state.changeSets[id]).find((x) => x && x.name === o.name && x.status !== 'DELETE_COMPLETE');
    if (dup) throw new AwsError('AlreadyExistsException', `ChangeSet [${o.name}] already exists`, 400);
  }
  const l = o.usePrevious && stack ? { tpl: stack.template, text: stack.originalText, isJson: stack.originalIsJson } : loadTemplate(o.text);
  const { tpl, expand } = o.usePrevious && stack ? { tpl: stack.template, expand: false } : processTemplate(l, o.caps);
  const an = analyze(tpl);
  checkCapabilities(an, o.caps, expand);
  const params = finalParams(tpl, o.params, stack?.params, o.prevParams);
  if (!stack) {
    stack = newStack(c, o.stackName, l, tpl, params, o.caps, o.tags ?? []);
    stack.review = true;
    emit(stack, c.acct.clock, stack.name, stack.id, STACK_TYPE, 'REVIEW_IN_PROGRESS', 'User Initiated');
  }
  let changes: CfnChange[];
  let status: CfnChangeSet['status'] = 'CREATE_COMPLETE';
  let statusReason: string | undefined;
  if (o.type === 'CREATE') {
    const env = mkEnv(c, stack, tpl, params, {}, true);
    changes = an.order.filter((id) => !(an.resources[id].Condition && !env.conds[String(an.resources[id].Condition)])).map((id) => ({ Action: 'Add' as const, LogicalResourceId: id, ResourceType: String(an.resources[id].Type), Scope: [], Details: [] }));
  } else {
    const plan = planChanges(c, stack, an, tpl, params);
    changes = changesFrom(plan.rows, stack);
    if (!changes.length && JSON.stringify(tpl.Outputs ?? {}) === JSON.stringify(stack.template.Outputs ?? {})) {
      status = 'FAILED';
      statusReason = "The submitted information didn't contain changes. Submit different information to create a change set.";
    }
  }
  const cs: CfnChangeSet = { id: csArn(c.acct, c.region, o.name, o.stackName), name: o.name, stackId: stack.id, stackName: stack.name, type: o.type, templateText: l.text, templateIsJson: l.isJson, params, caps: o.caps, changes: status === 'FAILED' ? [] : changes, created: c.acct.clock, status, statusReason, execution: status === 'FAILED' ? 'UNAVAILABLE' : 'AVAILABLE', description: o.description };
  state.changeSets[cs.id] = cs;
  stack.changeSets.push(cs.id);
  return cs;
}

function findChangeSet(c: OpCtx, name: string, stackName?: string): CfnChangeSet {
  const state = cfnOf(c.acct, c.region);
  const byArn = state.changeSets[name];
  if (byArn) return byArn;
  if (stackName) {
    const s = findStack(c, stackName);
    const cs = s.changeSets.map((id) => state.changeSets[id]).find((x) => x && x.name === name && x.status !== 'DELETE_COMPLETE');
    if (cs) return cs;
  }
  throw new AwsError('ChangeSetNotFound', `ChangeSet [${name}] does not exist`, 404);
}

op('cloudformation', 'create-change-set', 'stack-name:s! change-set-name:s! template-body:s template-url:s use-previous-template:b parameters:f capabilities:l change-set-type:s tags:t description:s', 'Calcula qué cambiaría al aplicar una plantilla a una pila, sin tocar nada: añade, modifica (¿sustituye?) o borra recursos.', { res: () => '*' }, (c) => {
  const type = (c.p.ChangeSetType ?? 'UPDATE') as 'CREATE' | 'UPDATE';
  if (type !== 'CREATE' && type !== 'UPDATE') throw validation(`1 validation error detected: Value '${type}' at 'changeSetType' failed to satisfy constraint: Member must satisfy enum value set: [CREATE, UPDATE, IMPORT]`);
  const { map, prev } = parseParams(c.p.Parameters);
  const text = c.p.UsePreviousTemplate ? '' : templateText(c, c.p.TemplateBody, c.p.TemplateUrl);
  const cs = createChangeSet(c, { stackName: c.p.StackName, name: c.p.ChangeSetName, text, params: map, prevParams: prev, caps: toArr<string>(c.p.Capabilities), type, usePrevious: !!c.p.UsePreviousTemplate, description: c.p.Description, tags: tagsOf(c.p.Tags) });
  return { Id: cs.id, StackId: cs.stackId };
});

const csView = (c: OpCtx, cs: CfnChangeSet) => {
  const s = cfnOf(c.acct, c.region).stacks[cs.stackId];
  const ready = c.acct.clock - cs.created >= 3000;
  return {
    ChangeSetName: cs.name,
    ChangeSetId: cs.id,
    StackId: cs.stackId,
    StackName: cs.stackName,
    ...(cs.description ? { Description: cs.description } : {}),
    Parameters: Object.entries(cs.params).map(([k, v]) => ({ ParameterKey: k, ParameterValue: v })),
    CreationTime: ts(cs.created),
    ExecutionStatus: ready ? cs.execution : 'UNAVAILABLE',
    Status: ready ? cs.status : 'CREATE_IN_PROGRESS',
    ...(ready && cs.statusReason ? { StatusReason: cs.statusReason } : {}),
    NotificationARNs: [],
    RollbackConfiguration: {},
    Capabilities: cs.caps,
    Tags: [],
    Changes: ready ? cs.changes.map((ch) => ({ Type: 'Resource', ResourceChange: ch })) : [],
    IncludeNestedStacks: false,
    ...(s ? {} : {}),
  };
};

op('cloudformation', 'describe-change-set', 'change-set-name:s! stack-name:s', 'Los cambios previstos: acción (`Add`, `Modify`, `Remove`) y, al modificar, si el recurso se **sustituye** (`Replacement`).', { res: () => '*' }, (c) => csView(c, findChangeSet(c, c.p.ChangeSetName, c.p.StackName)));

op('cloudformation', 'list-change-sets', 'stack-name:s!', 'Lista los conjuntos de cambios de la pila.', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName);
  const state = cfnOf(c.acct, c.region);
  return { Summaries: s.changeSets.map((id) => state.changeSets[id]).filter((x) => x && x.status !== 'DELETE_COMPLETE').map((cs) => ({ StackId: cs.stackId, StackName: cs.stackName, ChangeSetId: cs.id, ChangeSetName: cs.name, ExecutionStatus: cs.execution, Status: cs.status, CreationTime: ts(cs.created) })) };
});

export function executeChangeSet(c: OpCtx, cs: CfnChangeSet, roleArn?: string): void {
  const s = cfnOf(c.acct, c.region).stacks[cs.stackId];
  if (!s) throw validation(`Stack [${cs.stackName}] does not exist`);
  if (cs.status === 'FAILED') throw new AwsError('InvalidChangeSetStatus', `ChangeSet [${cs.id}] cannot be executed in its current status of [FAILED]`, 400);
  if (cs.execution !== 'AVAILABLE') throw new AwsError('InvalidChangeSetStatus', `ChangeSet [${cs.id}] cannot be executed in its current execution status of [${cs.execution}]`, 400);
  const l = { tpl: parseTemplate(cs.templateText), text: cs.templateText, isJson: cs.templateIsJson };
  const { tpl, expand } = processTemplate(l);
  const an = analyze(tpl);
  checkCapabilities(an, cs.caps, expand);
  if (roleArn) s.roleArn = roleArn;
  if (cs.type === 'CREATE') {
    s.review = false;
    s.params = cs.params;
    s.template = tpl;
    s.originalText = cs.templateText;
    s.originalIsJson = cs.templateIsJson;
    s.caps = cs.caps;
    s.created = c.acct.clock;
    s.description = typeof tpl.Description === 'string' ? tpl.Description : undefined;
    runCreate(c, s, an, tpl);
  } else {
    const st = guardState(c.acct, s, 'updated');
    if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(st)) throw validation(`Stack:${s.id} is in ${st} state and can not be updated.`);
    runUpdate(c, s, an, tpl, cs.params, cs.caps.length ? cs.caps : s.caps, l);
  }
  cs.execution = 'EXECUTE_COMPLETE';
  for (const id of s.changeSets) {
    const o = cfnOf(c.acct, c.region).changeSets[id];
    if (o && o !== cs && o.execution === 'AVAILABLE') o.execution = 'OBSOLETE';
  }
}

op('cloudformation', 'execute-change-set', 'change-set-name:s! stack-name:s', 'Aplica el conjunto de cambios a la pila.', { res: () => '*' }, (c) => {
  executeChangeSet(c, findChangeSet(c, c.p.ChangeSetName, c.p.StackName));
  return undefined;
});

op('cloudformation', 'delete-change-set', 'change-set-name:s! stack-name:s', 'Descarta un conjunto de cambios.', { res: () => '*' }, (c) => {
  const cs = findChangeSet(c, c.p.ChangeSetName, c.p.StackName);
  cs.status = 'DELETE_COMPLETE';
  return undefined;
});

// ───────────────────────── exportaciones ─────────────────────────

op('cloudformation', 'list-exports', '', 'Valores que las pilas exportan para que otras los importen con `Fn::ImportValue`.', { res: () => '*', paginate: 'Exports' }, (c) => ({ Exports: Object.entries(exportsOf(c.acct, c.region)).map(([n, e]) => ({ ExportingStackId: activeStacks(c.acct, c.region).find((s) => s.name === e.stack)!.id, Name: n, Value: e.value })) }));

op('cloudformation', 'list-imports', 'export-name:s!', 'Pilas que importan un valor exportado.', { res: () => '*', paginate: 'Imports' }, (c) => {
  const ex = exportsOf(c.acct, c.region)[c.p.ExportName];
  if (!ex) throw validation(`Export '${c.p.ExportName}' does not exist.`);
  return { Imports: activeStacks(c.acct, c.region).filter((s) => s.name !== ex.stack && JSON.stringify(s.template.Resources).includes(`"${c.p.ExportName}"`)).map((s) => s.name) };
});

// ───────────────────────── deriva ─────────────────────────

const jsonEq = (x: unknown, y: unknown) => JSON.stringify(canon(x)) === JSON.stringify(canon(y));
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
}

function diffProps(expected: Rec, actual: Rec): CfnDriftItem['differences'] {
  const out: CfnDriftItem['differences'] = [];
  const walk = (path: string, e: unknown, a: unknown) => {
    if (isObj(e) && isObj(a)) {
      for (const k of new Set([...Object.keys(e), ...Object.keys(a)])) walk(`${path}/${k}`, e[k], a[k]);
      return;
    }
    if (jsonEq(e, a)) return;
    out.push({ PropertyPath: path, ExpectedValue: JSON.stringify(e ?? null), ActualValue: JSON.stringify(a ?? null), DifferenceType: e === undefined ? 'ADD' : a === undefined ? 'REMOVE' : 'NOT_EQUAL' });
  };
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) walk(`/${k}`, expected[k], actual[k]);
  return out;
}

/** Compara lo que dice la plantilla con lo que hay ahora en la cuenta. */
export function detectDrift(c: OpCtx, s: CfnStack): void {
  const run = mkRun(c, s);
  const items: CfnDriftItem[] = [];
  for (const r of Object.values(s.resources)) {
    const t = typeOf(r.type);
    if (!t.actual) continue;
    const act = t.actual(rctx(run, r.logicalId), r.physicalId, r.props);
    if (act === null) {
      items.push({ logicalId: r.logicalId, physicalId: r.physicalId, type: r.type, status: 'DELETED', expected: {}, actual: {}, differences: [] });
      continue;
    }
    const expected: Rec = {};
    for (const k of Object.keys(act)) expected[k] = r.props[k];
    const differences = diffProps(expected, act);
    items.push({ logicalId: r.logicalId, physicalId: r.physicalId, type: r.type, status: differences.length ? 'MODIFIED' : 'IN_SYNC', expected, actual: act, differences });
  }
  const drifted = items.some((i) => i.status !== 'IN_SYNC');
  s.drift = { status: drifted ? 'DRIFTED' : 'IN_SYNC', at: c.acct.clock, detectionId: uuid(`drift:${s.id}:${c.acct.clock}`), items };
}

op('cloudformation', 'detect-stack-drift', 'stack-name:s! logical-resource-ids:l', 'Comprueba si alguien cambió a mano los recursos de la pila (deriva).', { res: () => '*' }, (c) => {
  const s = findStack(c, c.p.StackName);
  guardState(c.acct, s, 'checked for drift');
  detectDrift(c, s);
  return { StackDriftDetectionId: s.drift!.detectionId };
});

op('cloudformation', 'describe-stack-drift-detection-status', 'stack-drift-detection-id:s!', 'Resultado de la comprobación de deriva.', { res: () => '*' }, (c) => {
  const s = activeStacks(c.acct, c.region).find((x) => x.drift?.detectionId === c.p.StackDriftDetectionId);
  if (!s?.drift) throw validation(`StackDriftDetectionId ${c.p.StackDriftDetectionId} does not exist`);
  return { StackId: s.id, StackDriftDetectionId: s.drift.detectionId, StackDriftStatus: s.drift.status, DetectionStatus: 'DETECTION_COMPLETE', DriftedStackResourceCount: s.drift.items.filter((i) => i.status !== 'IN_SYNC').length, Timestamp: ts(s.drift.at) };
});

op('cloudformation', 'describe-stack-resource-drifts', 'stack-name:s! stack-resource-drift-status-filters:l', 'Recursos con deriva: valores esperados (plantilla) frente a los reales y las diferencias.', { res: () => '*', paginate: 'StackResourceDrifts' }, (c) => {
  const s = findStack(c, c.p.StackName);
  if (!s.drift) return { StackResourceDrifts: [] };
  const f = toArr<string>(c.p.StackResourceDriftStatusFilters);
  return {
    StackResourceDrifts: s.drift.items
      .filter((i) => !f.length || f.includes(i.status))
      .map((i) => ({ StackId: s.id, LogicalResourceId: i.logicalId, PhysicalResourceId: i.physicalId, ResourceType: i.type, ExpectedProperties: JSON.stringify(i.expected), ActualProperties: JSON.stringify(i.actual), PropertyDifferences: i.differences, StackResourceDriftStatus: i.status, Timestamp: ts(s.drift!.at) })),
  };
});

// ───────────────────────── esperas ─────────────────────────

const WAITS: Record<string, { ok: (st: string) => boolean; bad: (st: string) => boolean; gone?: boolean }> = {
  'stack-create-complete': { ok: (s) => s === 'CREATE_COMPLETE', bad: (s) => ['CREATE_FAILED', 'DELETE_COMPLETE', 'DELETE_FAILED', 'ROLLBACK_FAILED', 'ROLLBACK_COMPLETE'].includes(s) },
  'stack-update-complete': { ok: (s) => s === 'UPDATE_COMPLETE', bad: (s) => ['UPDATE_FAILED', 'UPDATE_ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE'].includes(s) },
  'stack-delete-complete': { ok: (s) => s === 'DELETE_COMPLETE', bad: (s) => s === 'DELETE_FAILED', gone: true },
  'stack-exists': { ok: (s) => s !== 'DELETE_COMPLETE', bad: () => false },
};

op('cloudformation', 'wait', 'waiter:s! stack-name:s change-set-name:s', 'Espera a que la pila llegue a un estado (stack-create-complete, stack-update-complete, stack-delete-complete, stack-exists, change-set-create-complete).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  if (c.p.Waiter === 'change-set-create-complete') {
    const cs = findChangeSet(c, c.p.ChangeSetName, c.p.StackName);
    c.acct.clock += Math.max(0, 3000 - (c.acct.clock - cs.created));
    if (cs.status === 'FAILED') throw new AwsError('WaiterError', `Waiter ChangeSetCreateComplete failed: Waiter encountered a terminal failure state: For expression "Status" we matched expected path: "FAILED"`, 255);
    return undefined;
  }
  const w = WAITS[c.p.Waiter];
  if (!w) throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: ${[...Object.keys(WAITS), 'change-set-create-complete'].join(', ')}`);
  for (let k = 0; k < 120; k++) {
    let st: string;
    let pending = false;
    try {
      const sk = findStack(c, c.p.StackName, true);
      st = stackStatus(c.acct, sk).status;
      pending = sk.events.some((ev) => ev.at > c.acct.clock);
    } catch {
      if (w.gone) return undefined;
      throw new AwsError('WaiterError', `Waiter ${c.p.Waiter} failed: Waiter encountered a terminal failure state: Stack with id ${c.p.StackName} does not exist`, 255);
    }
    if (w.ok(st) && !pending) return undefined;
    if (w.bad(st)) throw new AwsError('WaiterError', `Waiter ${pascalWaiter(c.p.Waiter)} failed: Waiter encountered a terminal failure state: For expression "Stacks[].StackStatus" we matched expected path: "${st}" at least once`, 255);
    c.acct.clock += 15000;
  }
  throw new AwsError('WaiterError', `Waiter ${pascalWaiter(c.p.Waiter)} failed: Max attempts exceeded`, 255);
});

const pascalWaiter = (w: string) => w.split('-').map((x) => x[0].toUpperCase() + x.slice(1)).join('');

// ───────────────────────── conjuntos de pilas ─────────────────────────

const ADMIN_ROLE = 'AWSCloudFormationStackSetAdministrationRole';
const EXEC_ROLE = 'AWSCloudFormationStackSetExecutionRole';

function findSet(c: OpCtx, name: string): CfnStackSet {
  const set = Object.values(cfnOf(c.acct, c.region).stackSets).find((x) => x.name === name && x.status === 'ACTIVE');
  if (!set) throw new AwsError('StackSetNotFoundException', `StackSet ${name} not found`, 404);
  return set;
}

const setView = (s: CfnStackSet) => ({ StackSetName: s.name, StackSetId: `${s.name}:${s.id}`, ...(s.description ? { Description: s.description } : {}), Status: s.status, TemplateBody: s.templateText, Parameters: Object.entries(s.params).map(([k, v]) => ({ ParameterKey: k, ParameterValue: v })), Capabilities: s.caps, Tags: [], StackSetARN: `arn:aws:cloudformation:us-east-1:123456789012:stackset/${s.name}:${s.id}`, ...(s.adminRole ? { AdministrationRoleARN: s.adminRole } : {}), ExecutionRoleName: s.execRole, PermissionModel: 'SELF_MANAGED', StackSetDriftDetectionDetails: { DriftStatus: 'NOT_CHECKED' } });

op('cloudformation', 'create-stack-set', 'stack-set-name:s! description:s template-body:s template-url:s parameters:f capabilities:l administration-role-arn:s execution-role-name:s permission-model:s', 'Crea un conjunto de pilas: una plantilla que se despliega después en varias regiones o cuentas con `create-stack-instances`.', { res: () => '*' }, (c) => {
  const state = cfnOf(c.acct, c.region);
  const name = String(c.p.StackSetName);
  if (Object.values(state.stackSets).some((x) => x.name === name && x.status === 'ACTIVE')) throw new AwsError('NameAlreadyExistsException', `StackSet [${name}] already exists`, 400);
  if (c.p.PermissionModel === 'SERVICE_MANAGED') throw validation('SERVICE_MANAGED stack sets require AWS Organizations with trusted access enabled for CloudFormation StackSets (not available in this account).');
  const l = loadTemplate(templateText(c, c.p.TemplateBody, c.p.TemplateUrl));
  const caps = toArr<string>(c.p.Capabilities);
  const { tpl, expand } = processTemplate(l, caps);
  const an = analyze(tpl);
  checkCapabilities(an, caps, expand);
  const { map } = parseParams(c.p.Parameters);
  finalParams(tpl, map);
  const id = uuid(`set:${c.acct.id}:${name}`);
  state.stackSets[id] = { id, name, templateText: l.text, templateIsJson: l.isJson, params: map, caps, adminRole: c.p.AdministrationRoleArn, execRole: c.p.ExecutionRoleName ?? EXEC_ROLE, status: 'ACTIVE', instances: {}, operations: [], description: c.p.Description };
  return { StackSetId: `${name}:${id}` };
});

op('cloudformation', 'describe-stack-set', 'stack-set-name:s!', 'Datos de un conjunto de pilas.', { res: () => '*' }, (c) => ({ StackSet: setView(findSet(c, c.p.StackSetName)) }));
op('cloudformation', 'list-stack-sets', 'status:s', 'Lista los conjuntos de pilas.', { res: () => '*', paginate: 'Summaries' }, (c) => ({ Summaries: Object.values(cfnOf(c.acct, c.region).stackSets).filter((s) => s.status === (c.p.Status ?? 'ACTIVE')).map((s) => ({ StackSetName: s.name, StackSetId: `${s.name}:${s.id}`, Status: s.status, PermissionModel: 'SELF_MANAGED', DriftStatus: 'NOT_CHECKED' })) }));

function checkSetRoles(c: OpCtx, set: CfnStackSet): void {
  const admin = c.acct.iam.roles[ADMIN_ROLE];
  const adminArn = set.adminRole ?? `arn:aws:iam::${c.acct.id}:role/${ADMIN_ROLE}`;
  if (!c.acct.iam.roles[adminArn.split('/').pop() ?? ''] || (!admin && !set.adminRole)) throw validation(`Role ${adminArn} is invalid or cannot be assumed (create the administration role ${ADMIN_ROLE}, trusted by cloudformation.amazonaws.com)`);
  if (!roleTrusts(c.acct, adminArn, 'cloudformation.amazonaws.com')) throw validation(`Role ${adminArn} is invalid or cannot be assumed`);
  const exec = c.acct.iam.roles[set.execRole];
  if (!exec) throw new AwsError('StackSetOperationFailed', `Account ${c.acct.id} should have '${set.execRole}' role with trust relationship to Role '${adminArn.split('/').pop()}'.`, 400);
  const principals = JSON.stringify(exec.AssumeRolePolicyDocument);
  if (!principals.includes(adminArn) && !principals.includes(`arn:aws:iam::${c.acct.id}:root`)) throw new AwsError('StackSetOperationFailed', `Account ${c.acct.id} should have '${set.execRole}' role with trust relationship to Role '${adminArn.split('/').pop()}'.`, 400);
}

op('cloudformation', 'create-stack-instances', 'stack-set-name:s! accounts:l regions:l! parameter-overrides:f operation-preferences:j', 'Despliega el conjunto en esas regiones (y cuentas): crea una pila `StackSet-…` en cada una. Necesita el rol de administración y el de ejecución.', { res: () => '*' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  const accounts = toArr<string>(c.p.Accounts);
  if (!accounts.length) throw validation('Either Accounts or DeploymentTargets must be specified.');
  for (const a of accounts) if (a !== c.acct.id) throw new AwsError('StackSetOperationFailed', `Account ${a} should have '${set.execRole}' role with trust relationship to Role '${(set.adminRole ?? ADMIN_ROLE).split('/').pop()}'.`, 400);
  checkSetRoles(c, set);
  const l = { tpl: parseTemplate(set.templateText), text: set.templateText, isJson: set.templateIsJson };
  const opId = uuid(`op:${set.id}:${c.acct.clock}`);
  const results: string[] = [];
  for (const region of toArr<string>(c.p.Regions)) {
    if (set.instances[region]) throw validation(`Stack instance for ${c.acct.id} in ${region} already exists in StackSet ${set.name}`);
    const rc: OpCtx = { ...c, region };
    const { tpl, expand } = processTemplate(l);
    const an = analyze(tpl);
    void expand;
    const overrides = parseParams(c.p.ParameterOverrides).map;
    const params = finalParams(tpl, { ...set.params, ...overrides });
    const name = `StackSet-${set.name}-${uuid(`inst:${set.id}:${region}`)}`;
    const s = newStack(rc, name, l, tpl, params, set.caps, []);
    s.stackSet = `${set.name}:${set.id}`;
    runCreate(rc, s, an, tpl);
    set.instances[region] = { account: c.acct.id, region, stackId: s.id };
    results.push(region);
  }
  set.operations.push({ id: opId, action: 'CREATE', at: c.acct.clock, status: 'SUCCEEDED' });
  return { OperationId: opId };
});

op('cloudformation', 'list-stack-instances', 'stack-set-name:s! stack-instance-account:s stack-instance-region:s', 'Dónde está desplegado el conjunto.', { res: () => '*', paginate: 'Summaries' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  return { Summaries: Object.values(set.instances).filter((i) => (!c.p.StackInstanceRegion || i.region === c.p.StackInstanceRegion) && (!c.p.StackInstanceAccount || i.account === c.p.StackInstanceAccount)).map((i) => ({ StackSetId: `${set.name}:${set.id}`, Region: i.region, Account: i.account, StackId: i.stackId, Status: 'CURRENT', StackInstanceStatus: { DetailedStatus: 'SUCCEEDED' }, DriftStatus: 'NOT_CHECKED' })) };
});

op('cloudformation', 'update-stack-set', 'stack-set-name:s! template-body:s template-url:s use-previous-template:b parameters:f capabilities:l description:s', 'Cambia la plantilla del conjunto y la propaga a todas las instancias.', { res: () => '*' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  checkSetRoles(c, set);
  const prev = !!c.p.UsePreviousTemplate;
  const text = prev ? set.templateText : templateText(c, c.p.TemplateBody, c.p.TemplateUrl);
  const l = loadTemplate(text);
  const { tpl, expand } = processTemplate(l);
  const an = analyze(tpl);
  const caps = toArr<string>(c.p.Capabilities);
  checkCapabilities(an, caps.length ? caps : set.caps, expand);
  const params = finalParams(tpl, { ...set.params, ...parseParams(c.p.Parameters).map });
  const opId = uuid(`op:${set.id}:upd:${c.acct.clock}`);
  for (const inst of Object.values(set.instances)) {
    const rc: OpCtx = { ...c, region: inst.region };
    const s = cfnOf(c.acct, inst.region).stacks[inst.stackId];
    if (!s) continue;
    const t = processTemplate(l).tpl;
    const a2 = analyze(t);
    const { rows } = planChanges(rc, s, a2, t, params);
    if (rows.some((r) => r.action !== 'Keep')) runUpdate(rc, s, a2, t, params, caps.length ? caps : s.caps, l);
  }
  set.templateText = l.text;
  set.templateIsJson = l.isJson;
  set.params = params;
  if (caps.length) set.caps = caps;
  set.operations.push({ id: opId, action: 'UPDATE', at: c.acct.clock, status: 'SUCCEEDED' });
  return { OperationId: opId };
});

op('cloudformation', 'delete-stack-instances', 'stack-set-name:s! accounts:l regions:l! retain-stacks:b', 'Quita el conjunto de esas regiones (borra sus pilas).', { res: () => '*' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  const opId = uuid(`op:${set.id}:del:${c.acct.clock}`);
  for (const region of toArr<string>(c.p.Regions)) {
    const inst = set.instances[region];
    if (!inst) continue;
    const s = cfnOf(c.acct, region).stacks[inst.stackId];
    if (s && !c.p.RetainStacks) runDelete({ ...c, region }, s, []);
    delete set.instances[region];
  }
  set.operations.push({ id: opId, action: 'DELETE', at: c.acct.clock, status: 'SUCCEEDED' });
  return { OperationId: opId };
});

op('cloudformation', 'describe-stack-set-operation', 'stack-set-name:s! operation-id:s!', 'Estado de una operación sobre el conjunto.', { res: () => '*' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  const o = set.operations.find((x) => x.id === c.p.OperationId);
  if (!o) throw new AwsError('OperationNotFoundException', `Operation ${c.p.OperationId} not found`, 404);
  return { StackSetOperation: { OperationId: o.id, StackSetId: `${set.name}:${set.id}`, Action: o.action, Status: o.status, CreationTimestamp: ts(o.at), EndTimestamp: ts(o.at + 20000) } };
});

op('cloudformation', 'delete-stack-set', 'stack-set-name:s!', 'Borra un conjunto de pilas (sin instancias).', { res: () => '*' }, (c) => {
  const set = findSet(c, c.p.StackSetName);
  if (Object.keys(set.instances).length) throw new AwsError('StackSetNotEmptyException', 'StackSet is not empty: delete its stack instances first.', 400);
  set.status = 'DELETED';
  return undefined;
});

// ───────────────────────── tiempo ─────────────────────────

tickers.push(() => {
  /* el estado de las pilas se deduce de sus eventos: no hace falta avanzar nada */
});
