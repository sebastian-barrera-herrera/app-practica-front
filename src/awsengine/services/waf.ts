/**
 * AWS WAF (wafv2): ACL web con reglas propias y grupos gestionados, límite de tasa, conjuntos de IP, asociación a un balanceador
 * (o a CloudFront), registros y muestras de peticiones. La capa HTTP del simulador (web.ts) le pasa cada petición a `wafGate`.
 */
import { regional } from '../account';
import { clientGeo } from './route53';
import type { Fetched } from '../../engine/commands/internet';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account } from '../types';
import type { WafAcl, WafIpSet, WafRule, WafSample, WafScope, WafState, WafVisibility } from '../types-sec';
import { iso, mkArn, newId, toArr } from '../util';
import { cwPut } from './cwdata';
import { elb } from './elb';
import { logsOf, logsPut } from './logs';
import { getBucket, s3Current, s3Put } from './s3';
import { check, isManaged, managedGroup, MANAGED, matches, validCidr, WafInvalid, type EvalCx, type Statement, type WafReq } from './wafeval';

const MAX_CAPACITY = 5000;
const MAX_ACLS = 100;
const MAX_SAMPLES = 500;

export const wafOf = (a: Account, region: string): WafState => (regional(a, region).wafv2 ??= { acls: {}, ipSets: {}, associations: {}, logging: {}, samples: [], rate: {} });

const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

const err = (code: string, msg: string) => new AwsError(code, msg, 400);
const missing = () => err('WAFNonexistentItemException', 'AWS WAF couldn’t perform the operation because your resource doesn’t exist.');
const invalid = (reason: string, field: string, param: string) => err('WAFInvalidParameterException', `Error reason: ${reason}, field: ${field}, parameter: ${param}`);
const lockErr = () => err('WAFOptimisticLockException', 'AWS WAF couldn’t save your changes because someone changed the resource after you started to edit it. Reapply your changes.');
const inUse = () => err('WAFAssociatedItemException', 'AWS WAF couldn’t perform the operation because your resource is being used by another resource or it’s associated with another resource.');
const dupe = () => err('WAFDuplicateItemException', 'AWS WAF couldn’t perform the operation because the resource that you tried to save is a duplicate of an existing one.');

/** Las ACL de ámbito `CLOUDFRONT` viven en us-east-1; las `REGIONAL`, en la región de la llamada. */
function scopeOf(c: Pick<OpCtx, 'p' | 'region'>): { scope: WafScope; region: string } {
  const s = String(c.p.Scope ?? '').toUpperCase();
  if (s !== 'REGIONAL' && s !== 'CLOUDFRONT') throw invalid('The scope is not valid.', 'SCOPE_VALUE', String(c.p.Scope));
  if (s === 'CLOUDFRONT' && c.region !== 'us-east-1') throw invalid('The scope is not valid.', 'SCOPE_VALUE', 'CLOUDFRONT');
  return { scope: s, region: c.region };
}

const seg = (scope: WafScope) => (scope === 'CLOUDFRONT' ? 'global' : 'regional');
const aclArn = (a: Account, scope: WafScope, region: string, name: string, id: string) => mkArn('wafv2', region, a.id, `${seg(scope)}/webacl/${name}/${id}`);
const ipArn = (a: Account, scope: WafScope, region: string, name: string, id: string) => mkArn('wafv2', region, a.id, `${seg(scope)}/ipset/${name}/${id}`);

const NAME_RE = /^[\w-]{1,128}$/;
const METRIC_RE = /^[\w#:./-]{1,128}$/;

const bool = (v: unknown) => v === true || v === 'true';

function visibility(v: Statement | undefined, what: string): WafVisibility {
  if (!v || typeof v !== 'object') throw invalid('VisibilityConfig is required', 'VISIBILITY_CONFIG', what);
  const metric = String(v.MetricName ?? '');
  if (!METRIC_RE.test(metric)) throw invalid('The metric name must contain only letters, numbers and the characters # : . - /', 'METRIC_NAME', metric);
  return { SampledRequestsEnabled: bool(v.SampledRequestsEnabled), CloudWatchMetricsEnabled: bool(v.CloudWatchMetricsEnabled), MetricName: metric };
}

/** Los números que llegan como texto desde la sintaxis abreviada (`Limit=100`) pasan a ser números. */
function numbers(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(numbers);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ['Limit', 'Size', 'EvaluationWindowSec', 'Priority', 'ResponseCode'].includes(k) && typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : numbers(v)]));
  return x;
}

const ACTIONS = ['Allow', 'Block', 'Count', 'Captcha', 'Challenge'];
const actionOf = (node: Statement | undefined): string | undefined => ACTIONS.find((k) => node?.[k] !== undefined);

const ipSetsIn = (a: Account, region: string) => wafOf(a, region).ipSets;

function prepRules(a: Account, region: string, raw: unknown, bodies: Statement | undefined): { rules: WafRule[]; capacity: number } {
  const list = toArr<Statement>(raw as Statement[]);
  const names = new Set<string>();
  const prios = new Set<number>();
  let capacity = 0;
  const rules: WafRule[] = [];
  for (const r0 of list) {
    const r = numbers(r0) as Statement;
    const name = String(r.Name ?? '');
    if (!NAME_RE.test(name)) throw invalid('The rule name is not valid', 'RULE_NAME', name);
    if (names.has(name)) throw dupe();
    names.add(name);
    const pr = Number(r.Priority);
    if (!Number.isInteger(pr) || pr < 0) throw invalid('Priority must be a non-negative integer', 'PRIORITY', String(r.Priority));
    if (prios.has(pr)) throw invalid('Two rules cannot have the same priority', 'PRIORITY', String(pr));
    prios.add(pr);
    if (!r.Statement) throw invalid('A rule needs a statement', 'STATEMENT', name);
    const managed = isManaged(r.Statement);
    if (managed) {
      if (!r.OverrideAction || !['None', 'Count'].some((k) => r.OverrideAction[k] !== undefined)) throw invalid('Rule groups need OverrideAction (None or Count), not Action', 'OVERRIDE_ACTION', name);
      if (r.Action) throw invalid('A rule group statement cannot have Action; use OverrideAction', 'ACTION', name);
    } else {
      if (r.OverrideAction) throw invalid('OverrideAction is only for rule groups; use Action', 'OVERRIDE_ACTION', name);
      if (!actionOf(r.Action)) throw invalid('A rule needs an Action (Allow, Block, Count, Captcha or Challenge)', 'ACTION', name);
    }
    // una respuesta personalizada tiene que apuntar a un cuerpo definido en la ACL
    const key = r.Action?.Block?.CustomResponse?.CustomResponseBodyKey;
    if (key && !bodies?.[key]) throw invalid('The custom response body key is not defined in CustomResponseBodies', 'CUSTOM_RESPONSE_BODY', String(key));
    let cap: number;
    try {
      cap = check(r.Statement, { ipSetExists: (arn) => Object.values(ipSetsIn(a, region)).some((i) => i.ARN === arn) });
    } catch (e) {
      if (e instanceof WafInvalid) {
        if (e.field === 'ARN' || e.field === 'MANAGED_RULE_GROUP') throw missing();
        throw invalid(e.reason, e.field, e.param);
      }
      throw e;
    }
    capacity += cap;
    rules.push({ Name: name, Priority: pr, Statement: r.Statement, ...(r.Action ? { Action: r.Action } : {}), ...(r.OverrideAction ? { OverrideAction: r.OverrideAction } : {}), VisibilityConfig: visibility(r.VisibilityConfig, name) });
  }
  if (capacity > MAX_CAPACITY) throw err('WAFLimitsExceededException', 'AWS WAF couldn’t perform the operation because you exceeded your resource limit. For example, the maximum number of WebACL objects that you can create for an AWS account. For more information, see Limits in the AWS WAF Developer Guide.');
  return { rules, capacity };
}

function checkDefault(d: Statement | undefined): Statement {
  if (!d || (d.Allow === undefined) === (d.Block === undefined)) throw invalid('Exactly one of Allow or Block must be specified for the default action', 'DEFAULT_ACTION', JSON.stringify(d ?? {}));
  return d;
}

const tagList = (t: unknown) => toArr<{ Key: string; Value?: string }>(t as { Key: string; Value?: string }[]).map((x) => ({ Key: x.Key, Value: x.Value ?? '' }));

const aclView = (a: Account, x: WafAcl) => ({
  Name: x.Name,
  Id: x.Id,
  ARN: x.ARN,
  DefaultAction: x.DefaultAction,
  ...(x.Description ? { Description: x.Description } : {}),
  Rules: x.Rules,
  VisibilityConfig: x.VisibilityConfig,
  Capacity: x.Capacity,
  ManagedByFirewallManager: false,
  LabelNamespace: `awswaf:${a.id}:webacl:${x.Name}:`,
  ...(x.CustomResponseBodies ? { CustomResponseBodies: x.CustomResponseBodies } : {}),
});
const aclSummary = (x: WafAcl) => ({ Name: x.Name, Id: x.Id, Description: x.Description, LockToken: x.LockToken, ARN: x.ARN });

function findAcl(a: Account, region: string, scope: WafScope, name: string, id: string): WafAcl {
  const x = wafOf(a, region).acls[id];
  if (!x || x.Name !== name || x.Scope !== scope) throw missing();
  return x;
}

const aclRes = (c: OpCtx) => {
  const s = String(c.p.Scope ?? '').toUpperCase() === 'CLOUDFRONT' ? 'CLOUDFRONT' : 'REGIONAL';
  return mkArn('wafv2', s === 'CLOUDFRONT' ? 'us-east-1' : c.region, c.acct.id, `${seg(s)}/webacl/${c.p.Name ?? '*'}/${c.p.Id ?? '*'}`);
};
const ipRes = (c: OpCtx) => {
  const s = String(c.p.Scope ?? '').toUpperCase() === 'CLOUDFRONT' ? 'CLOUDFRONT' : 'REGIONAL';
  return mkArn('wafv2', s === 'CLOUDFRONT' ? 'us-east-1' : c.region, c.acct.id, `${seg(s)}/ipset/${c.p.Name ?? '*'}/${c.p.Id ?? '*'}`);
};

// ───────────────────────── ACL ─────────────────────────

op('wafv2', 'create-web-acl', 'name:s! scope:s! default-action:j! rules:j visibility-config:j! description:s tags:f custom-response-bodies:j captcha-config:j challenge-config:j token-domains:l association-config:j', 'Crea una ACL web: reglas que dejan pasar, cuentan o bloquean las peticiones HTTP, y qué hacer con las que no encajan en ninguna.', { api: 'CreateWebACL', res: aclRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const st = wafOf(c.acct, region);
  const name = String(c.p.Name);
  if (!NAME_RE.test(name)) throw invalid('The name is not valid (letters, numbers, - and _)', 'NAME', name);
  if (Object.values(st.acls).some((x) => x.Name === name && x.Scope === scope)) throw dupe();
  if (Object.values(st.acls).filter((x) => x.Scope === scope).length >= MAX_ACLS) throw err('WAFLimitsExceededException', 'AWS WAF couldn’t perform the operation because you exceeded your resource limit. For example, the maximum number of WebACL objects that you can create for an AWS account. For more information, see Limits in the AWS WAF Developer Guide.');
  const bodies = c.p.CustomResponseBodies as Record<string, { ContentType: string; Content: string }> | undefined;
  const def = checkDefault(numbers(c.p.DefaultAction) as Statement);
  const { rules, capacity } = prepRules(c.acct, region, c.p.Rules, bodies);
  const id = uuid(c.acct, 'wafacl');
  const x: WafAcl = { Id: id, Name: name, ARN: aclArn(c.acct, scope, region, name, id), Scope: scope, Description: c.p.Description ?? '', DefaultAction: def, Rules: rules, VisibilityConfig: visibility(c.p.VisibilityConfig, name), Capacity: capacity, LockToken: uuid(c.acct, 'waflock'), ...(bodies ? { CustomResponseBodies: bodies } : {}), Tags: tagList(c.p.Tags), created: c.acct.clock };
  st.acls[id] = x;
  return { Summary: aclSummary(x) };
});

op('wafv2', 'get-web-acl', 'name:s! scope:s! id:s! ', 'Muestra una ACL web con sus reglas y el LockToken (necesario para modificarla).', { api: 'GetWebACL', res: aclRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findAcl(c.acct, region, scope, c.p.Name, c.p.Id);
  return { WebACL: aclView(c.acct, x), LockToken: x.LockToken };
});

op('wafv2', 'list-web-acls', 'scope:s! limit:i next-marker:s', 'Lista las ACL web de la región (o las globales con `--scope CLOUDFRONT` en us-east-1).', { api: 'ListWebACLs', res: () => '*' }, (c) => {
  const { scope, region } = scopeOf(c);
  return { WebACLs: Object.values(wafOf(c.acct, region).acls).filter((x) => x.Scope === scope).map(aclSummary) };
});

op('wafv2', 'update-web-acl', 'name:s! scope:s! id:s! default-action:j! rules:j visibility-config:j! lock-token:s! description:s custom-response-bodies:j captcha-config:j challenge-config:j token-domains:l association-config:j', 'Sustituye la configuración de una ACL (lo que no envíes se pierde: reglas incluidas) usando el LockToken.', { api: 'UpdateWebACL', res: aclRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findAcl(c.acct, region, scope, c.p.Name, c.p.Id);
  if (c.p.LockToken !== x.LockToken) throw lockErr();
  const bodies = c.p.CustomResponseBodies as Record<string, { ContentType: string; Content: string }> | undefined;
  const def = checkDefault(numbers(c.p.DefaultAction) as Statement);
  const { rules, capacity } = prepRules(c.acct, region, c.p.Rules, bodies);
  x.DefaultAction = def;
  x.Rules = rules;
  x.Capacity = capacity;
  x.VisibilityConfig = visibility(c.p.VisibilityConfig, x.Name);
  x.Description = c.p.Description ?? '';
  if (bodies) x.CustomResponseBodies = bodies;
  else delete x.CustomResponseBodies;
  x.LockToken = uuid(c.acct, 'waflock');
  return { NextLockToken: x.LockToken };
});

op('wafv2', 'delete-web-acl', 'name:s! scope:s! id:s! lock-token:s!', 'Borra una ACL web (tiene que estar desasociada).', { api: 'DeleteWebACL', res: aclRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findAcl(c.acct, region, scope, c.p.Name, c.p.Id);
  if (c.p.LockToken !== x.LockToken) throw lockErr();
  const st = wafOf(c.acct, region);
  if (Object.values(st.associations).includes(x.ARN) || Object.values(c.acct.cloudfront?.distributions ?? {}).some((d) => d.WebACLId === x.ARN)) throw inUse();
  delete st.acls[x.Id];
  delete st.logging[x.ARN];
  return {};
});

op('wafv2', 'check-capacity', 'scope:s! rules:j!', 'Calcula las unidades de capacidad (WCU) que consumirían unas reglas, sin crear nada.', { api: 'CheckCapacity', res: () => '*' }, (c) => {
  const { region } = scopeOf(c);
  return { Capacity: prepRules(c.acct, region, c.p.Rules, undefined).capacity };
});

op('wafv2', 'list-available-managed-rule-groups', 'scope:s! limit:i next-marker:s', 'Grupos de reglas gestionados por AWS que puedes añadir a una ACL.', { api: 'ListAvailableManagedRuleGroups', res: () => '*' }, (c) => {
  scopeOf(c);
  return { ManagedRuleGroups: MANAGED.map((g) => ({ VendorName: 'AWS', Name: g.name, Description: g.description })) };
});

op('wafv2', 'describe-managed-rule-group', 'vendor-name:s! name:s! scope:s! version-name:s', 'Reglas, acción por defecto y capacidad de un grupo gestionado.', { api: 'DescribeManagedRuleGroup', res: () => '*' }, (c) => {
  scopeOf(c);
  const g = managedGroup(c.p.VendorName, c.p.Name);
  if (!g) throw missing();
  return { Capacity: g.capacity, Rules: g.rules.map((r) => ({ Name: r.name, Action: { [r.action]: {} } })), LabelNamespace: `awswaf:managed:aws:${g.name.replace('AWSManagedRules', '').replace(/RuleSet|List$/, '').toLowerCase()}:`, AvailableLabels: [], ConsumedLabels: [] };
});

// ───────────────────────── conjuntos de IP ─────────────────────────

const ipSummary = (x: WafIpSet) => ({ Name: x.Name, Id: x.Id, Description: x.Description, LockToken: x.LockToken, ARN: x.ARN });

function checkAddresses(list: string[], version: 'IPV4' | 'IPV6'): string[] {
  const out = list.map((s) => String(s).trim());
  for (const v of out) if (!validCidr(v, version)) throw invalid('You specified an invalid IP address or CIDR (always include the mask, for example /32 for one address)', 'IP_ADDRESS', v);
  return out;
}

function findIp(a: Account, region: string, scope: WafScope, name: string, id: string): WafIpSet {
  const x = wafOf(a, region).ipSets[id];
  if (!x || x.Name !== name || x.Scope !== scope) throw missing();
  return x;
}

op('wafv2', 'create-ip-set', 'name:s! scope:s! ip-address-version:s! addresses:l! description:s tags:f', 'Crea un conjunto de IP (en notación CIDR) que las reglas pueden usar para permitir o bloquear.', { api: 'CreateIPSet', res: ipRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const st = wafOf(c.acct, region);
  const name = String(c.p.Name);
  if (!NAME_RE.test(name)) throw invalid('The name is not valid (letters, numbers, - and _)', 'NAME', name);
  const ver = String(c.p.IpAddressVersion).toUpperCase();
  if (ver !== 'IPV4' && ver !== 'IPV6') throw invalid('IPAddressVersion must be IPV4 or IPV6', 'IP_ADDRESS_VERSION', String(c.p.IpAddressVersion));
  if (Object.values(st.ipSets).some((x) => x.Name === name && x.Scope === scope)) throw dupe();
  const id = uuid(c.acct, 'wafip');
  const x: WafIpSet = { Id: id, Name: name, ARN: ipArn(c.acct, scope, region, name, id), Scope: scope, Description: c.p.Description ?? '', IPAddressVersion: ver, Addresses: checkAddresses(toArr<string>(c.p.Addresses), ver), LockToken: uuid(c.acct, 'waflock'), Tags: tagList(c.p.Tags) };
  st.ipSets[id] = x;
  return { Summary: ipSummary(x) };
});

op('wafv2', 'get-ip-set', 'name:s! scope:s! id:s!', 'Direcciones de un conjunto de IP y su LockToken.', { api: 'GetIPSet', res: ipRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findIp(c.acct, region, scope, c.p.Name, c.p.Id);
  return { IPSet: { Name: x.Name, Id: x.Id, ARN: x.ARN, Description: x.Description, IPAddressVersion: x.IPAddressVersion, Addresses: x.Addresses }, LockToken: x.LockToken };
});

op('wafv2', 'list-ip-sets', 'scope:s! limit:i next-marker:s', 'Lista los conjuntos de IP.', { api: 'ListIPSets', res: () => '*' }, (c) => {
  const { scope, region } = scopeOf(c);
  return { IPSets: Object.values(wafOf(c.acct, region).ipSets).filter((x) => x.Scope === scope).map(ipSummary) };
});

op('wafv2', 'update-ip-set', 'name:s! scope:s! id:s! addresses:l! lock-token:s! description:s', 'Sustituye las direcciones de un conjunto de IP (envía la lista completa).', { api: 'UpdateIPSet', res: ipRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findIp(c.acct, region, scope, c.p.Name, c.p.Id);
  if (c.p.LockToken !== x.LockToken) throw lockErr();
  x.Addresses = checkAddresses(toArr<string>(c.p.Addresses), x.IPAddressVersion);
  x.Description = c.p.Description ?? x.Description;
  x.LockToken = uuid(c.acct, 'waflock');
  return { NextLockToken: x.LockToken };
});

op('wafv2', 'delete-ip-set', 'name:s! scope:s! id:s! lock-token:s!', 'Borra un conjunto de IP (ninguna regla puede usarlo).', { api: 'DeleteIPSet', res: ipRes }, (c) => {
  const { scope, region } = scopeOf(c);
  const x = findIp(c.acct, region, scope, c.p.Name, c.p.Id);
  if (c.p.LockToken !== x.LockToken) throw lockErr();
  const used = (s: Statement): boolean => !!s && (s.IPSetReferenceStatement?.ARN === x.ARN || [s.AndStatement?.Statements, s.OrStatement?.Statements].some((l: Statement[] | undefined) => l?.some(used)) || (s.NotStatement ? used(s.NotStatement.Statement) : false) || (s.RateBasedStatement?.ScopeDownStatement ? used(s.RateBasedStatement.ScopeDownStatement) : false));
  if (Object.values(wafOf(c.acct, region).acls).some((acl) => acl.Rules.some((r) => used(r.Statement)))) throw inUse();
  delete wafOf(c.acct, region).ipSets[x.Id];
  return {};
});

// ───────────────────────── asociación ─────────────────────────

type Target = { kind: 'ALB' | 'COGNITO'; arn: string };

/** A qué tipo de recurso apunta el ARN y si existe en la región. */
function targetOf(a: Account, region: string, arn: string): Target {
  if (!/^arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{12}:.+/.test(arn)) throw invalid('The ARN isn’t valid. A valid ARN begins with arn: and includes other information separated by colons or slashes.', 'RESOURCE_ARN', arn);
  if (arn.includes(':loadbalancer/app/')) {
    if (!elb(a, region).lbs[arn]) throw missing();
    return { kind: 'ALB', arn };
  }
  if (arn.includes(':loadbalancer/')) throw invalid('Only Application Load Balancers can be protected by AWS WAF', 'RESOURCE_ARN', arn);
  const up = /:userpool\/([\w-]+)$/.exec(arn);
  if (up && arn.startsWith('arn:aws:cognito-idp:')) {
    if (!regional(a, region).cognito?.pools[up[1]]) throw missing();
    return { kind: 'COGNITO', arn };
  }
  if (arn.includes('/restapis/') || arn.includes(':appsync:') || arn.includes(':apprunner:') || arn.includes(':verified-access')) throw missing();
  throw invalid('The resource type is not supported by AWS WAF', 'RESOURCE_ARN', arn);
}

const setWebAcl = (action: string) => (c: OpCtx) => {
  const lbArn = String(c.p.ResourceArn ?? '');
  return [{ action: 'wafv2:AssociateWebACL', resource: c.p.WebAclArn ?? '*' }, ...(lbArn.includes(':loadbalancer/') ? [{ action, resource: lbArn }] : [])];
};

op('wafv2', 'associate-web-acl', 'web-acl-arn:s! resource-arn:s!', 'Asocia una ACL web regional a un balanceador de carga (ALB) o a un grupo de usuarios de Cognito. Para CloudFront se usa `--web-acl-id` de la distribución.', { api: 'AssociateWebACL', authz: setWebAcl('elasticloadbalancing:SetWebAcl') }, (c) => {
  const acl = Object.values(wafOf(c.acct, c.region).acls).find((x) => x.ARN === c.p.WebAclArn);
  if (!acl) {
    if (/:global\/webacl\//.test(String(c.p.WebAclArn))) throw invalid('A CloudFront web ACL can’t be associated with this API; set the WebACLId of the distribution instead', 'WEB_ACL_ARN', String(c.p.WebAclArn));
    throw missing();
  }
  const t = targetOf(c.acct, c.region, String(c.p.ResourceArn));
  wafOf(c.acct, c.region).associations[t.arn] = acl.ARN;
  return {};
});

op('wafv2', 'disassociate-web-acl', 'resource-arn:s!', 'Quita la ACL web de un recurso (deja de estar protegido).', { api: 'DisassociateWebACL', authz: (c) => [{ action: 'wafv2:DisassociateWebACL', resource: '*' }, ...(String(c.p.ResourceArn).includes(':loadbalancer/') ? [{ action: 'elasticloadbalancing:SetWebAcl', resource: String(c.p.ResourceArn) }] : [])] }, (c) => {
  const t = targetOf(c.acct, c.region, String(c.p.ResourceArn));
  delete wafOf(c.acct, c.region).associations[t.arn];
  return {};
});

op('wafv2', 'get-web-acl-for-resource', 'resource-arn:s!', 'Qué ACL web protege un recurso.', { api: 'GetWebACLForResource', res: () => '*' }, (c) => {
  const t = targetOf(c.acct, c.region, String(c.p.ResourceArn));
  const st = wafOf(c.acct, c.region);
  const acl = st.acls[Object.values(st.acls).find((x) => x.ARN === st.associations[t.arn])?.Id ?? ''];
  return acl ? { WebACL: aclView(c.acct, acl) } : {};
});

op('wafv2', 'list-resources-for-web-acl', 'web-acl-arn:s! resource-type:s', 'Recursos protegidos por una ACL web.', { api: 'ListResourcesForWebACL', res: () => '*' }, (c) => {
  const st = wafOf(c.acct, c.region);
  if (!Object.values(st.acls).some((x) => x.ARN === c.p.WebAclArn)) throw missing();
  const want = String(c.p.ResourceType ?? 'APPLICATION_LOAD_BALANCER');
  return { ResourceArns: Object.entries(st.associations).filter(([r, w]) => w === c.p.WebAclArn && (want === 'COGNITO_USER_POOL' ? r.includes(':userpool/') : want === 'APPLICATION_LOAD_BALANCER' ? r.includes(':loadbalancer/') : false)).map(([r]) => r) };
});

// ───────────────────────── registros ─────────────────────────

function checkDestination(a: Account, region: string, arn: string): void {
  const logs = /^arn:aws:logs:[a-z0-9-]+:\d{12}:log-group:(aws-waf-logs-[\w./#-]*)(?::\*)?$/.exec(arn);
  if (logs) {
    if (!logsOf(a, region).groups[logs[1]]) throw err('WAFNonexistentItemException', 'AWS WAF couldn’t perform the operation because your resource doesn’t exist.');
    return;
  }
  const s3 = /^arn:aws:s3:::(aws-waf-logs-[a-z0-9.-]+)(?:\/.*)?$/.exec(arn);
  if (s3) {
    getBucket(a, s3[1]);
    return;
  }
  if (/^arn:aws:firehose:[a-z0-9-]+:\d{12}:deliverystream\/aws-waf-logs-[\w.-]+$/.test(arn)) return;
  throw invalid('The log destination must be a CloudWatch Logs log group, an S3 bucket or a Firehose stream whose name starts with aws-waf-logs-', 'LOG_DESTINATION', arn);
}

op('wafv2', 'put-logging-configuration', 'logging-configuration:j!', 'Activa los registros de una ACL (grupo de CloudWatch Logs o bucket cuyo nombre empiece por `aws-waf-logs-`).', { api: 'PutLoggingConfiguration', res: () => '*' }, (c) => {
  const cfg = c.p.LoggingConfiguration as Statement;
  const st = wafOf(c.acct, c.region);
  const acl = Object.values(st.acls).find((x) => x.ARN === cfg.ResourceArn);
  if (!acl) throw missing();
  const dest = toArr<string>(cfg.LogDestinationConfigs);
  if (dest.length !== 1) throw invalid('Exactly one log destination must be specified', 'LOG_DESTINATION', dest.join(','));
  checkDestination(c.acct, c.region, dest[0]);
  const f = cfg.LoggingFilter as Statement | undefined;
  if (f && !['KEEP', 'DROP'].includes(String(f.DefaultBehavior))) throw invalid('DefaultBehavior must be KEEP or DROP', 'LOGGING_FILTER', String(f.DefaultBehavior));
  st.logging[acl.ARN] = { ResourceArn: acl.ARN, LogDestinationConfigs: dest, ...(cfg.RedactedFields ? { RedactedFields: toArr(cfg.RedactedFields) } : {}), ...(f ? { LoggingFilter: f } : {}) };
  return { LoggingConfiguration: { ...st.logging[acl.ARN], ManagedByFirewallManager: false } };
});

op('wafv2', 'get-logging-configuration', 'resource-arn:s!', 'Configuración de registros de una ACL.', { api: 'GetLoggingConfiguration', res: () => '*' }, (c) => {
  const l = wafOf(c.acct, c.region).logging[String(c.p.ResourceArn)];
  if (!l) throw missing();
  return { LoggingConfiguration: { ...l, ManagedByFirewallManager: false } };
});

op('wafv2', 'delete-logging-configuration', 'resource-arn:s!', 'Desactiva los registros de una ACL.', { api: 'DeleteLoggingConfiguration', res: () => '*' }, (c) => {
  const st = wafOf(c.acct, c.region);
  if (!st.logging[String(c.p.ResourceArn)]) throw missing();
  delete st.logging[String(c.p.ResourceArn)];
  return {};
});

op('wafv2', 'list-logging-configurations', 'scope:s! limit:i next-marker:s', 'Lista las configuraciones de registros.', { api: 'ListLoggingConfigurations', res: () => '*' }, (c) => {
  const { region } = scopeOf(c);
  return { LoggingConfigurations: Object.values(wafOf(c.acct, region).logging).map((l) => ({ ...l, ManagedByFirewallManager: false })) };
});

// ───────────────────────── muestras ─────────────────────────

const when = (v: unknown): number => {
  if (typeof v === 'number') return v * (v < 1e11 ? 1000 : 1);
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n * (n < 1e11 ? 1000 : 1) : Date.parse(String(v));
};

op('wafv2', 'get-sampled-requests', 'web-acl-arn:s! rule-metric-name:s! scope:s! time-window:j! max-items:i', 'Hasta 500 peticiones recientes que evaluó una regla (hay que activar el muestreo en su VisibilityConfig).', { api: 'GetSampledRequests', res: () => '*' }, (c) => {
  const { region } = scopeOf(c);
  const st = wafOf(c.acct, region);
  if (!Object.values(st.acls).some((x) => x.ARN === c.p.WebAclArn)) throw missing();
  const w = c.p.TimeWindow as { StartTime: unknown; EndTime: unknown };
  const from = when(w.StartTime);
  const to = when(w.EndTime);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw invalid('The time window is not valid', 'TIME_WINDOW', JSON.stringify(w));
  // `--max-items` es también una opción global de la CLI: llega en `opts`
  const max = Math.min(Number(c.p.MaxItems ?? c.opts.maxItems ?? 100), MAX_SAMPLES);
  const hits = [...st.samples].reverse().filter((s) => s.acl === c.p.WebAclArn && (c.p.RuleMetricName === 'ALL' || s.metric === c.p.RuleMetricName) && s.t >= from && s.t <= to).sort((x, y) => y.t - x.t);
  return {
    SampledRequests: hits.slice(0, max).map((s) => ({ Request: { ClientIP: s.ip, Country: s.country || undefined, URI: s.uri, Method: s.method, HTTPVersion: 'HTTP/1.1', Headers: s.headers }, Weight: 1, Timestamp: iso(s.t), Action: s.action, RuleNameWithinRuleGroup: s.rule })),
    PopulationSize: hits.length,
    TimeWindow: { StartTime: iso(from), EndTime: iso(to) },
  };
});

// ───────────────────────── etiquetas ─────────────────────────

function taggable(a: Account, region: string, arn: string): { Tags: { Key: string; Value: string }[] } {
  const st = wafOf(a, region);
  const x = Object.values(st.acls).find((i) => i.ARN === arn) ?? Object.values(st.ipSets).find((i) => i.ARN === arn);
  if (!x) throw missing();
  return x;
}
op('wafv2', 'tag-resource', 'resource-arn:s! tags:f!', 'Etiqueta una ACL o un conjunto de IP.', { api: 'TagResource', res: (c) => String(c.p.ResourceArn) }, (c) => {
  const x = taggable(c.acct, c.region, c.p.ResourceArn);
  for (const t of tagList(c.p.Tags)) x.Tags = [...x.Tags.filter((y) => y.Key !== t.Key), t];
  return {};
});
op('wafv2', 'untag-resource', 'resource-arn:s! tag-keys:l!', 'Quita etiquetas.', { api: 'UntagResource', res: (c) => String(c.p.ResourceArn) }, (c) => {
  const x = taggable(c.acct, c.region, c.p.ResourceArn);
  const del = new Set(toArr<string>(c.p.TagKeys));
  x.Tags = x.Tags.filter((t) => !del.has(t.Key));
  return {};
});
op('wafv2', 'list-tags-for-resource', 'resource-arn:s! limit:i next-marker:s', 'Etiquetas de una ACL o de un conjunto de IP.', { api: 'ListTagsForResource', res: (c) => String(c.p.ResourceArn) }, (c) => ({ TagInfoForResource: { ResourceARN: c.p.ResourceArn, TagList: taggable(c.acct, c.region, c.p.ResourceArn).Tags } }));

// ───────────────────────── evaluación de peticiones ─────────────────────────

export interface WafRequest {
  method: string;
  path: string;
  query: string;
  headers?: Record<string, string>;
  body?: string;
  srcIp: string;
  host: string;
}

export interface WafOutcome {
  action: 'ALLOW' | 'BLOCK';
  /** Regla que decidió (`Default_Action` si ninguna). */
  rule: string;
  response?: { status: number; contentType: string; body: string; headers: Record<string, string> };
}

interface Hit {
  rule: WafRule | undefined;
  /** Nombre dentro del grupo gestionado, si lo hay. */
  sub?: string;
  group?: string;
  action: string;
}

const CAPTCHA_PAGE = '<html><body><h1>Verifica que eres una persona</h1></body></html>';

function customResponse(acl: WafAcl, node: Statement | undefined, def: { status: number; contentType: string; body: string }): NonNullable<WafOutcome['response']> {
  const cr = node?.CustomResponse as Statement | undefined;
  if (!cr) return { ...def, headers: {} };
  const key = cr.CustomResponseBodyKey as string | undefined;
  const body = key ? acl.CustomResponseBodies?.[key] : undefined;
  return {
    status: Number(cr.ResponseCode ?? def.status),
    contentType: body ? (body.ContentType === 'APPLICATION_JSON' ? 'application/json' : body.ContentType === 'TEXT_HTML' ? 'text/html' : 'text/plain') : def.contentType,
    body: body?.Content ?? '',
    headers: Object.fromEntries(toArr<{ Name: string; Value: string }>(cr.ResponseHeaders).map((h) => [h.Name, h.Value])),
  };
}

/** Evalúa la petición contra una ACL: cada regla por orden de prioridad hasta que una permite o bloquea. */
function evaluateAcl(a: Account, acl: WafAcl, st: WafState, req: WafReq): { hits: Hit[]; verdict: Hit } {
  const hits: Hit[] = [];
  const cx = (rule: WafRule): EvalCx => ({
    req,
    ipSet: (arn) => Object.values(st.ipSets).find((i) => i.ARN === arn)?.Addresses,
    rate: (key, win) => {
      const k = `${acl.Id}|${key}`;
      const cut = a.clock - win * 1000;
      const list = (st.rate[k] ??= []).filter((t) => t > cut);
      list.push(a.clock);
      st.rate[k] = list.length > 20000 ? list.slice(-20000) : list;
      return list.length;
    },
    ruleKey: rule.Name,
  });
  for (const rule of [...acl.Rules].sort((x, y) => x.Priority - y.Priority)) {
    const s = rule.Statement;
    if (s.ManagedRuleGroupStatement) {
      const m = s.ManagedRuleGroupStatement as Statement;
      const g = managedGroup(m.VendorName, m.Name);
      if (!g || (m.ScopeDownStatement && !matches(m.ScopeDownStatement, cx(rule)))) continue;
      const excluded = new Set(toArr<{ Name: string }>(m.ExcludedRules).map((x) => x.Name));
      const over = new Map(toArr<{ Name: string; ActionToUse: Statement }>(m.RuleActionOverrides).map((x) => [x.Name, actionOf(x.ActionToUse) ?? 'Count']));
      for (const r of g.rules) {
        if (!r.test(req)) continue;
        const action = rule.OverrideAction?.Count !== undefined || excluded.has(r.name) ? 'Count' : over.get(r.name) ?? r.action;
        const hit: Hit = { rule, group: g.name, sub: r.name, action };
        hits.push(hit);
        if (action === 'Allow' || action === 'Block' || action === 'Captcha' || action === 'Challenge') return { hits, verdict: hit };
      }
      continue;
    }
    if (!matches(s, cx(rule))) continue;
    const action = actionOf(rule.Action) ?? 'Count';
    const hit: Hit = { rule, action };
    hits.push(hit);
    if (action !== 'Count') return { hits, verdict: hit };
  }
  const def: Hit = { rule: undefined, action: actionOf(acl.DefaultAction) ?? 'Allow' };
  hits.push(def);
  return { hits, verdict: def };
}

const sourceName: Record<string, string> = { ALB: 'ALB', CF: 'CF' };

function redact(rq: WafRequest, fields: Statement[] | undefined): { headers: { name: string; value: string }[]; uri: string; args: string; method: string } {
  const hdr = Object.entries({ host: rq.host, ...(rq.headers ?? {}) }).map(([k, v]) => ({ name: k, value: v }));
  let uri = rq.path;
  let args = rq.query;
  let method = rq.method;
  for (const f of fields ?? []) {
    if (f.SingleHeader) for (const h of hdr) if (h.name === String(f.SingleHeader.Name).toLowerCase()) h.value = 'REDACTED';
    if (f.UriPath) uri = 'REDACTED';
    if (f.QueryString) args = 'REDACTED';
    if (f.Method) method = 'REDACTED';
  }
  return { headers: hdr, uri, args, method };
}

/** ¿Pasa el filtro de registros? */
function keptByFilter(f: Statement | undefined, action: string): boolean {
  if (!f) return true;
  const act = action.toUpperCase();
  for (const flt of toArr<Statement>(f.Filters)) {
    const conds = toArr<Statement>(flt.Conditions).map((cnd) => (cnd.ActionCondition ? String(cnd.ActionCondition.Action).toUpperCase() === act : false));
    const ok = flt.Requirement === 'MEETS_ANY' ? conds.some(Boolean) : conds.every(Boolean);
    if (ok) return flt.Behavior === 'KEEP';
  }
  return f.DefaultBehavior === 'KEEP';
}

function writeLog(a: Account, region: string, acl: WafAcl, st: WafState, line: string, action: string, stamp: number): void {
  const cfg = st.logging[acl.ARN];
  if (!cfg || !keptByFilter(cfg.LoggingFilter, action)) return;
  const dest = cfg.LogDestinationConfigs[0];
  const lg = /log-group:([^:]+)/.exec(dest);
  if (lg) {
    logsPut(a, region, lg[1], `${region}_${acl.Name}_0`, line, stamp);
    return;
  }
  const s3 = /^arn:aws:s3:::([^/]+)\/?(.*)$/.exec(dest);
  if (s3) {
    const d = new Date(stamp);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const key = `${s3[2] ? s3[2].replace(/\/?$/, '/') : ''}AWSLogs/${a.id}/WAFLogs/${region}/${acl.Name}/${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${p2(d.getUTCHours())}/${p2(d.getUTCMinutes())}/${a.id}_waflogs_${region}_${acl.Name}_${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z_0000.log`;
    const bucket = a.s3.buckets[s3[1]];
    if (bucket) s3Put(a, bucket, key, (s3Current(bucket, key)?.body ?? '') + line + '\n');
  }
}

/**
 * Pasa una petición por la ACL asociada al recurso. `region` es donde está la ACL (us-east-1 para CloudFront).
 * Devuelve null si el recurso no tiene ACL; si la tiene, qué hace con ella (y deja métricas, muestras y registros).
 */
export function wafInspect(a: Account, region: string, aclArnOrNull: string | undefined, src: { kind: 'ALB' | 'CF'; id: string }, rq: WafRequest): WafOutcome | null {
  if (!aclArnOrNull) return null;
  const st = wafOf(a, region);
  const acl = Object.values(st.acls).find((x) => x.ARN === aclArnOrNull);
  if (!acl) return null;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rq.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host ??= rq.host;
  // curl siempre se presenta, salvo que le quiten la cabecera a propósito (`-H "User-Agent:"`)
  headers['user-agent'] ??= 'curl/8.5.0';
  const req: WafReq = { method: rq.method.toUpperCase(), uri: rq.path, query: rq.query, headers, body: rq.body ?? '', ip: rq.srcIp, country: clientGeo(rq.srcIp).country };
  const { hits, verdict } = evaluateAcl(a, acl, st, req);
  const decided = verdict.action;
  const outcomeAction: 'ALLOW' | 'BLOCK' = decided === 'Allow' ? 'ALLOW' : 'BLOCK';
  const global = acl.Scope === 'CLOUDFRONT';
  const dims = (rule: string) => ({ WebACL: acl.Name, Rule: rule, Region: global ? 'Global' : region });
  const stamp = a.clock;
  const metricName = (h: Hit) => (h.rule ? h.rule.VisibilityConfig.MetricName : acl.VisibilityConfig.MetricName);
  for (const h of hits) {
    const kind = h.action === 'Allow' ? 'ALLOW' : h.action === 'Count' ? 'COUNT' : 'BLOCK';
    const vis = h.rule ? h.rule.VisibilityConfig : acl.VisibilityConfig;
    if (vis.CloudWatchMetricsEnabled && (h.rule || h === verdict)) cwPut(a, region, 'AWS/WAFV2', kind === 'ALLOW' ? 'AllowedRequests' : kind === 'COUNT' ? 'CountedRequests' : 'BlockedRequests', dims(metricName(h)), { value: 1, unit: 'Count' });
    if (vis.SampledRequestsEnabled) {
      const s: WafSample = { t: stamp, acl: acl.ARN, rule: h.sub ?? h.rule?.Name ?? 'Default_Action', metric: metricName(h), action: kind, ip: req.ip, country: req.country, uri: req.uri, args: req.query, method: req.method, headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) };
      st.samples.push(s);
    }
  }
  if (st.samples.length > MAX_SAMPLES * 4) st.samples.splice(0, st.samples.length - MAX_SAMPLES * 4);
  if (acl.VisibilityConfig.CloudWatchMetricsEnabled) cwPut(a, region, 'AWS/WAFV2', outcomeAction === 'ALLOW' ? 'AllowedRequests' : 'BlockedRequests', dims('ALL'), { value: 1, unit: 'Count' });
  // registro
  const red = redact(rq, st.logging[acl.ARN]?.RedactedFields);
  const counted = hits.filter((h) => h.action === 'Count' && h.rule).map((h) => ({ ruleId: h.sub ?? h.rule!.Name, action: 'COUNT' }));
  const line = JSON.stringify({
    timestamp: stamp,
    formatVersion: 1,
    webaclId: acl.ARN,
    terminatingRuleId: verdict.group ? verdict.group : verdict.rule ? verdict.rule.Name : 'Default_Action',
    terminatingRuleType: verdict.group ? 'MANAGED_RULE_GROUP' : verdict.rule?.Statement.RateBasedStatement ? 'RATE_BASED' : verdict.rule ? 'REGULAR' : 'REGULAR',
    action: decided === 'Allow' ? 'ALLOW' : decided === 'Count' ? 'COUNT' : decided.toUpperCase(),
    terminatingRuleMatchDetails: [],
    httpSourceName: sourceName[src.kind],
    httpSourceId: src.id,
    ruleGroupList: verdict.group ? [{ ruleGroupId: verdict.group, terminatingRule: { ruleId: verdict.sub, action: 'BLOCK' }, nonTerminatingMatchingRules: [], excludedRules: null }] : [],
    rateBasedRuleList: verdict.rule?.Statement.RateBasedStatement ? [{ rateBasedRuleId: verdict.rule.Name, rateBasedRuleName: verdict.rule.Name, limitKey: 'IP', maxRateAllowed: verdict.rule.Statement.RateBasedStatement.Limit }] : [],
    nonTerminatingMatchingRules: counted,
    requestHeadersInserted: null,
    responseCodeSent: null,
    httpRequest: { clientIp: req.ip, country: req.country || '-', headers: red.headers, uri: red.uri, args: red.args, httpVersion: 'HTTP/1.1', httpMethod: red.method, requestId: newId(a, 'wafreq', '', 20, 'b64').replace(/[+/]/g, 'x') },
    labels: [],
  });
  writeLog(a, region, acl, st, line, decided === 'Allow' ? 'ALLOW' : decided === 'Count' ? 'COUNT' : 'BLOCK', stamp);

  const name = verdict.rule ? verdict.rule.Name : 'Default_Action';
  if (decided === 'Allow') return { action: 'ALLOW', rule: name };
  const node = verdict.rule ? (verdict.group ? undefined : verdict.rule.Action) : acl.DefaultAction;
  if (decided === 'Captcha') return { action: 'BLOCK', rule: name, response: { status: 405, contentType: 'text/html', body: CAPTCHA_PAGE, headers: { 'x-amzn-waf-action': 'captcha' } } };
  if (decided === 'Challenge') return { action: 'BLOCK', rule: name, response: { status: 202, contentType: 'text/html', body: CAPTCHA_PAGE, headers: { 'x-amzn-waf-action': 'challenge' } } };
  const blockNode = node?.Block as Statement | undefined;
  return { action: 'BLOCK', rule: name, response: customResponse(acl, blockNode, { status: 403, contentType: 'text/html', body: '' }) };
}

/** La respuesta de bloqueo tal como la ve el cliente (la del balanceador o la de CloudFront). */
export function blockPage(kind: 'ALB' | 'CF', o: WafOutcome): Fetched {
  const r = o.response!;
  if (r.body) return { ok: true, status: r.status, type: r.contentType, body: r.body, headers: { Server: kind === 'ALB' ? 'awselb/2.0' : 'CloudFront', ...r.headers } };
  if (r.status !== 403) return { ok: true, status: r.status, type: r.contentType, body: '', headers: { Server: kind === 'ALB' ? 'awselb/2.0' : 'CloudFront', ...r.headers } };
  return kind === 'ALB'
    ? { ok: true, status: 403, type: 'text/html', body: '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>\r\n', headers: { Server: 'awselb/2.0', ...r.headers } }
    : { ok: true, status: 403, type: 'text/html', body: '<html><body><h1>403 ERROR</h1><p>The request could not be satisfied.</p><p>Request blocked. We can\'t connect to the server for this app or website at this time. There might be too much traffic or a configuration error.</p></body></html>', headers: { Server: 'CloudFront', 'X-Cache': 'Error from cloudfront', ...r.headers } };
}

/** El ARN de la ACL que protege un balanceador. */
export const aclOfResource = (a: Account, region: string, resourceArn: string): string | undefined => regional(a, region).wafv2?.associations[resourceArn];

// los contadores por tasa no necesitan avanzar con el reloj, pero no deben crecer sin fin
tickers.push((a) => {
  for (const r of Object.values(a.regions)) {
    const st = r.wafv2;
    if (!st) continue;
    for (const k of Object.keys(st.rate)) if (!st.rate[k].length || st.rate[k][st.rate[k].length - 1] < a.clock - 600000) delete st.rate[k];
  }
});
