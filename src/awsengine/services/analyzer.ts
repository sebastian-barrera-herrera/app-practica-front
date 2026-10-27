/**
 * IAM Access Analyzer: revisa las políticas de recursos (S3, roles de IAM, claves de KMS, secretos, colas, temas, funciones) y abre un
 * hallazgo por cada entidad externa a la cuenta que puede usarlos; y valida políticas escritas a mano antes de aplicarlas.
 */
import { regional } from '../account';
import { AwsError, OPS, iamAction, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, PolicyDoc, PolicyStatement } from '../types';
import type { Analyzer, AnalyzerFinding } from '../types-sec';
import { isoZ, mkArn, stableId, toArr } from '../util';
import { externalGrantees, granteesOf, isPublicStatement, statementsOf } from './secshared';

export const analyzerOf = (a: Account, region: string): Record<string, Analyzer> => (regional(a, region).analyzer ??= { analyzers: {} }).analyzers;

const val = (msg: string) => new AwsError('ValidationException', msg, 400);
const arnOf = (a: Account, region: string, name: string) => mkArn('access-analyzer', region, a.id, `analyzer/${name}`);

// ───────────────────────── recursos analizados ─────────────────────────

interface Source {
  type: string;
  arn: string;
  doc?: PolicyDoc;
  /** Entidades concedidas por otro mecanismo (concesiones de KMS). */
  extra?: { raw: string; account: string }[];
}

const parse = (s: string | undefined): PolicyDoc | undefined => {
  try {
    return s ? (JSON.parse(s) as PolicyDoc) : undefined;
  } catch {
    return undefined;
  }
};

function sources(a: Account, region: string): Source[] {
  const r = regional(a, region);
  const out: Source[] = [];
  for (const b of Object.values(a.s3.buckets)) if (b.region === region) out.push({ type: 'AWS::S3::Bucket', arn: `arn:aws:s3:::${b.name}`, doc: b.policy });
  for (const ro of Object.values(a.iam.roles)) out.push({ type: 'AWS::IAM::Role', arn: ro.Arn, doc: ro.AssumeRolePolicyDocument });
  for (const k of Object.values(r.kms?.keys ?? {})) if (k.manager === 'CUSTOMER') out.push({ type: 'AWS::KMS::Key', arn: k.Arn, doc: k.policy, extra: k.grants.map((g) => ({ raw: g.GranteePrincipal, account: /:(\d{12}):/.exec(g.GranteePrincipal)?.[1] ?? '' })).filter((g) => g.account && g.account !== a.id) });
  for (const s of Object.values(r.secrets ?? {})) if (s.deletedAt === undefined) out.push({ type: 'AWS::SecretsManager::Secret', arn: s.ARN, doc: parse(s.policy) });
  for (const q of Object.values(r.sqs ?? {})) out.push({ type: 'AWS::SQS::Queue', arn: mkArn('sqs', region, a.id, q.name), doc: parse(q.attrs.Policy) });
  for (const t of Object.values(r.sns ?? {})) out.push({ type: 'AWS::SNS::Topic', arn: t.TopicArn, doc: parse(t.attrs?.Policy) });
  for (const f of Object.values(r.lambda?.functions ?? {})) {
    const stmts: PolicyStatement[] = f.policy.map((p) => ({ Sid: p.Sid, Effect: 'Allow', Principal: typeof p.Principal === 'string' ? (p.Principal === '*' ? '*' : { AWS: p.Principal }) : p.Principal, Action: p.Action, Resource: p.Resource, ...(p.Condition ? { Condition: p.Condition } : {}) }));
    out.push({ type: 'AWS::Lambda::Function', arn: f.FunctionArn, doc: stmts.length ? { Version: '2012-10-17', Statement: stmts } : undefined });
  }
  return out;
}

const principalMap = (raw: string, type: string): Record<string, string> => (type === 'public' ? { AWS: '*' } : type === 'federated' ? { Federated: raw } : { AWS: raw.replace(/^arn:aws[a-z-]*:iam::(\d{12}):.*$/, '$1') });

type Calc = Omit<AnalyzerFinding, 'id' | 'status' | 'createdAt' | 'analyzedAt' | 'updatedAt'>;

function compute(a: Account, region: string): Calc[] {
  const out: Calc[] = [];
  for (const src of sources(a, region)) {
    for (const s of statementsOf(src.doc)) {
      const cond = s.Condition ? (s.Condition as Record<string, unknown>) : {};
      const actions = toArr<string>(s.Action as string | string[]);
      const pub = isPublicStatement(s);
      for (const g of externalGrantees(a, s)) {
        const principal = principalMap(g.raw, g.type);
        const key = `${src.arn}|${JSON.stringify(principal)}|${JSON.stringify(cond)}`;
        const prev = out.find((x) => x.key === key);
        if (prev) {
          prev.action = [...new Set([...prev.action, ...actions])];
          continue;
        }
        out.push({ key, resourceType: src.type, resource: src.arn, principal, action: actions, condition: cond, isPublic: g.type === 'public' && pub });
      }
    }
    for (const x of src.extra ?? []) out.push({ key: `${src.arn}|grant|${x.raw}`, resourceType: src.type, resource: src.arn, principal: { AWS: x.account }, action: ['kms:Decrypt'], condition: {}, isPublic: false });
  }
  return out;
}

// ───────────────────────── filtros y reglas de archivo ─────────────────────────

function attr(f: AnalyzerFinding, name: string): string[] {
  const m: Record<string, unknown> = { resourceType: f.resourceType, resource: f.resource, status: f.status, isPublic: String(f.isPublic), 'principal.AWS': f.principal.AWS, 'principal.Federated': f.principal.Federated, id: f.id, action: f.action, resourceOwnerAccount: f.resource.split(':')[4] || '' };
  const v = m[name];
  return v === undefined ? [] : toArr(v as string | string[]).map(String);
}

export function analyzerMatches(f: AnalyzerFinding, filter: Record<string, { eq?: string[]; neq?: string[]; contains?: string[]; exists?: boolean }> | undefined): boolean {
  return Object.entries(filter ?? {}).every(([name, c]) => {
    const have = attr(f, name);
    if (c.exists !== undefined) return c.exists === have.length > 0;
    if (c.eq && !c.eq.some((x) => have.includes(String(x)))) return false;
    if (c.neq && c.neq.some((x) => have.includes(String(x)))) return false;
    if (c.contains && !c.contains.some((x) => have.some((h) => h.includes(String(x))))) return false;
    return true;
  });
}

/** Pone al día los hallazgos del analizador: abre los nuevos, resuelve los que ya no existen y aplica las reglas de archivo. */
export function scan(a: Account, region: string, an: Analyzer): void {
  const live = compute(a, region);
  const keys = new Set(live.map((x) => x.key));
  for (const c of live) {
    const id = stableId(`aa:${an.arn}:${c.key}`, '', 36, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
    const prev = an.findings[id];
    if (prev) {
      prev.analyzedAt = a.clock;
      if (prev.status === 'RESOLVED') {
        prev.status = 'ACTIVE';
        prev.updatedAt = a.clock;
      }
      prev.action = c.action;
      continue;
    }
    const f: AnalyzerFinding = { ...c, id, status: 'ACTIVE', createdAt: a.clock, analyzedAt: a.clock, updatedAt: a.clock };
    if (Object.values(an.archiveRules).some((r) => analyzerMatches(f, r.filter as never))) f.status = 'ARCHIVED';
    an.findings[id] = f;
  }
  for (const f of Object.values(an.findings)) if (!keys.has(f.key) && f.status !== 'RESOLVED') {
    f.status = 'RESOLVED';
    f.updatedAt = a.clock;
  }
}

tickers.push((a) => {
  for (const [region, rs] of Object.entries(a.regions)) for (const an of Object.values(rs.analyzer?.analyzers ?? {})) if (a.clock - (lastScan.get(an) ?? -1e12) >= 30000) {
    lastScan.set(an, a.clock);
    scan(a, region, an);
  }
});
const lastScan = new WeakMap<Analyzer, number>();

// ───────────────────────── analizadores ─────────────────────────

const anView = (a: Account, x: Analyzer) => ({ arn: x.arn, name: x.name, type: x.type, createdAt: isoZ(x.created), lastResourceAnalyzed: Object.values(x.findings).sort((p, q) => q.analyzedAt - p.analyzedAt)[0]?.resource, lastResourceAnalyzedAt: isoZ(a.clock), status: 'ACTIVE', tags: x.tags });

function analyzer(c: Pick<OpCtx, 'acct' | 'region' | 'p'>, key = 'AnalyzerArn'): Analyzer {
  const arn = String(c.p[key] ?? '');
  const x = Object.values(analyzerOf(c.acct, c.region)).find((y) => y.arn === arn || y.name === arn);
  if (!x) throw new AwsError('ResourceNotFoundException', `Analyzer ${arn} not found.`, 404);
  return x;
}

const tags = (t: unknown): Record<string, string> => Object.assign({}, ...toArr<Record<string, string>>(t as Record<string, string>[])) as Record<string, string>;

op('accessanalyzer', 'create-analyzer', 'analyzer-name:s! type:s! archive-rules:j tags:j client-token:s', 'Crea un analizador (uno de cuenta gratis por región) que revisa quién de fuera puede usar tus recursos.', { res: () => '*' }, (c) => {
  const all = analyzerOf(c.acct, c.region);
  const type = String(c.p.Type);
  if (!['ACCOUNT', 'ORGANIZATION'].includes(type)) throw val(`1 validation error detected: Value '${type}' at 'type' failed to satisfy constraint: Member must satisfy enum value set: [ACCOUNT, ORGANIZATION]`);
  if (type === 'ORGANIZATION' && !c.acct.org) throw new AwsError('ValidationException', 'The account is not a member of an organization: an ORGANIZATION analyzer needs AWS Organizations.', 400);
  if (Object.values(all).some((x) => x.name === c.p.AnalyzerName)) throw new AwsError('ConflictException', `Analyzer with name ${c.p.AnalyzerName} already exists.`, 409);
  if (Object.values(all).some((x) => x.type === type)) throw new AwsError('ServiceQuotaExceededException', `You have reached the maximum number of ${type} analyzers in this region (1).`, 402);
  const name = String(c.p.AnalyzerName);
  const x: Analyzer = { arn: arnOf(c.acct, c.region, name), name, type: type as 'ACCOUNT' | 'ORGANIZATION', created: c.acct.clock, archiveRules: {}, findings: {}, tags: tags(c.p.Tags) };
  for (const r of toArr<{ ruleName: string; filter: Record<string, unknown> }>(c.p.ArchiveRules)) x.archiveRules[r.ruleName] = { ruleName: r.ruleName, filter: r.filter, created: c.acct.clock };
  all[name] = x;
  scan(c.acct, c.region, x);
  return { arn: x.arn };
});
op('accessanalyzer', 'list-analyzers', 'type:s max-results:i next-token:s', 'Los analizadores de la región.', { res: () => '*' }, (c) => ({ analyzers: Object.values(analyzerOf(c.acct, c.region)).filter((x) => !c.p.Type || x.type === c.p.Type).map((x) => anView(c.acct, x)) }));
op('accessanalyzer', 'get-analyzer', 'analyzer-name:s!', 'Un analizador.', { res: () => '*' }, (c) => {
  const x = analyzerOf(c.acct, c.region)[String(c.p.AnalyzerName)];
  if (!x) throw new AwsError('ResourceNotFoundException', `Analyzer ${c.p.AnalyzerName} not found.`, 404);
  return { analyzer: anView(c.acct, x) };
});
op('accessanalyzer', 'delete-analyzer', 'analyzer-name:s! client-token:s', 'Borra un analizador y sus hallazgos.', { res: () => '*' }, (c) => {
  const all = analyzerOf(c.acct, c.region);
  if (!all[String(c.p.AnalyzerName)]) throw new AwsError('ResourceNotFoundException', `Analyzer ${c.p.AnalyzerName} not found.`, 404);
  delete all[String(c.p.AnalyzerName)];
  return undefined;
});

// ───────────────────────── hallazgos ─────────────────────────

const fView = (a: Account, f: AnalyzerFinding) => ({ id: f.id, resourceType: f.resourceType, resource: f.resource, resourceOwnerAccount: a.id, status: f.status, principal: f.principal, action: f.action, condition: f.condition, isPublic: f.isPublic, createdAt: isoZ(f.createdAt), analyzedAt: isoZ(f.analyzedAt), updatedAt: isoZ(f.updatedAt) });

op('accessanalyzer', 'list-findings', 'analyzer-arn:s! filter:j sort:j max-results:i next-token:s', 'Los hallazgos de un analizador (recursos accesibles desde fuera de la cuenta).', { res: () => '*' }, (c) => {
  const an = analyzer(c);
  scan(c.acct, c.region, an);
  const list = Object.values(an.findings).filter((f) => analyzerMatches(f, c.p.Filter as never)).sort((x, y) => y.updatedAt - x.updatedAt);
  return { findings: list.slice(0, Number(c.p.MaxResults ?? 100)).map((f) => fView(c.acct, f)) };
});
op('accessanalyzer', 'get-finding', 'analyzer-arn:s! id:s!', 'Detalle de un hallazgo.', { res: () => '*' }, (c) => {
  const an = analyzer(c);
  scan(c.acct, c.region, an);
  const f = an.findings[String(c.p.Id)];
  if (!f) throw new AwsError('ResourceNotFoundException', `Finding ${c.p.Id} not found.`, 404);
  return { finding: fView(c.acct, f) };
});
op('accessanalyzer', 'update-findings', 'analyzer-arn:s! status:s! ids:l resource-arn:s client-token:s', 'Archiva (ARCHIVED) o reactiva (ACTIVE) hallazgos, por id o por recurso.', { res: () => '*' }, (c) => {
  const an = analyzer(c);
  const st = String(c.p.Status);
  if (!['ARCHIVED', 'ACTIVE'].includes(st)) throw val("Status must be ARCHIVED or ACTIVE");
  const ids = c.p.Ids ? toArr<string>(c.p.Ids) : Object.values(an.findings).filter((f) => f.resource === c.p.ResourceArn).map((f) => f.id);
  for (const id of ids) if (an.findings[id]) {
    an.findings[id].status = st as 'ARCHIVED' | 'ACTIVE';
    an.findings[id].updatedAt = c.acct.clock;
  }
  return undefined;
});
op('accessanalyzer', 'start-resource-scan', 'analyzer-arn:s! resource-arn:s! resource-owner-account:s', 'Pide un análisis inmediato de un recurso.', { res: () => '*' }, (c) => {
  scan(c.acct, c.region, analyzer(c));
  return undefined;
});
op('accessanalyzer', 'list-analyzed-resources', 'analyzer-arn:s! resource-type:s max-results:i next-token:s', 'Recursos que revisa el analizador.', { res: () => '*' }, (c) => {
  analyzer(c);
  return { analyzedResources: sources(c.acct, c.region).filter((s) => !c.p.ResourceType || s.type === c.p.ResourceType).map((s) => ({ resourceArn: s.arn, resourceType: s.type, resourceOwnerAccount: c.acct.id })) };
});

op('accessanalyzer', 'create-archive-rule', 'analyzer-name:s! rule-name:s! filter:j! client-token:s', 'Crea una regla que archiva sola los hallazgos que coinciden (accesos esperados).', { res: () => '*' }, (c) => {
  const an = analyzerOf(c.acct, c.region)[String(c.p.AnalyzerName)];
  if (!an) throw new AwsError('ResourceNotFoundException', `Analyzer ${c.p.AnalyzerName} not found.`, 404);
  if (an.archiveRules[String(c.p.RuleName)]) throw new AwsError('ConflictException', 'An archive rule with that name already exists.', 409);
  an.archiveRules[String(c.p.RuleName)] = { ruleName: String(c.p.RuleName), filter: c.p.Filter as Record<string, unknown>, created: c.acct.clock };
  for (const f of Object.values(an.findings)) if (f.status === 'ACTIVE' && analyzerMatches(f, c.p.Filter as never)) f.status = 'ARCHIVED';
  return undefined;
});
op('accessanalyzer', 'list-archive-rules', 'analyzer-name:s! max-results:i next-token:s', 'Las reglas de archivo de un analizador.', { res: () => '*' }, (c) => {
  const an = analyzerOf(c.acct, c.region)[String(c.p.AnalyzerName)];
  if (!an) throw new AwsError('ResourceNotFoundException', `Analyzer ${c.p.AnalyzerName} not found.`, 404);
  return { archiveRules: Object.values(an.archiveRules).map((r) => ({ ruleName: r.ruleName, filter: r.filter, createdAt: isoZ(r.created), updatedAt: isoZ(r.created) })) };
});
op('accessanalyzer', 'delete-archive-rule', 'analyzer-name:s! rule-name:s! client-token:s', 'Borra una regla de archivo.', { res: () => '*' }, (c) => {
  const an = analyzerOf(c.acct, c.region)[String(c.p.AnalyzerName)];
  if (!an?.archiveRules[String(c.p.RuleName)]) throw new AwsError('ResourceNotFoundException', 'Archive rule not found.', 404);
  delete an.archiveRules[String(c.p.RuleName)];
  return undefined;
});

// ───────────────────────── validación de políticas ─────────────────────────

const EXTRA_ACTIONS = new Set(['iam:passrole', 'iam:createservicelinkedrole', 'sts:assumerole', 's3:getobject', 's3:putobject', 's3:deleteobject', 's3:listbucket']);

function lev(x: string, y: string): number {
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)] as number[]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length];
}

let known: Set<string> | undefined;
let prefixes: Set<string> | undefined;
function actionSets() {
  if (!known) {
    known = new Set();
    prefixes = new Set();
    for (const o of OPS.values()) {
      if (o.service.startsWith('_')) continue;
      const act = (o.action ?? iamAction(o.service, o.api)).toLowerCase();
      known.add(act);
      prefixes.add(act.split(':')[0]);
    }
  }
  return { known, prefixes: prefixes! };
}

interface Issue {
  findingDetails: string;
  findingType: 'ERROR' | 'SECURITY_WARNING' | 'SUGGESTION' | 'WARNING';
  issueCode: string;
  learnMoreLink: string;
  locations: { path: ({ value: string } | { index: number })[]; span: { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number } } }[];
}

const loc = (...path: (string | number)[]): Issue['locations'] => [{ path: path.map((p) => (typeof p === 'number' ? { index: p } : { value: p })), span: { start: { line: 1, column: 0, offset: 0 }, end: { line: 1, column: 0, offset: 0 } } }];
const link = (code: string) => `https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-reference-policy-checks.html#access-analyzer-reference-policy-checks-${code.toLowerCase().replace(/_/g, '-')}`;
const issue = (findingType: Issue['findingType'], issueCode: string, findingDetails: string, ...path: (string | number)[]): Issue => ({ findingDetails, findingType, issueCode, learnMoreLink: link(issueCode), locations: loc(...path) });

const ELEMENTS = ['Sid', 'Effect', 'Principal', 'NotPrincipal', 'Action', 'NotAction', 'Resource', 'NotResource', 'Condition'];

export function validatePolicy(text: string, type: string): Issue[] {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw val('The policy document is not valid JSON.');
  }
  const out: Issue[] = [];
  if (!doc || typeof doc !== 'object' || !doc.Statement) {
    out.push(issue('ERROR', 'MISSING_STATEMENT', 'The policy has no "Statement" element.', 'Statement'));
    return out;
  }
  if (doc.Version === undefined) out.push(issue('WARNING', 'MISSING_VERSION', 'The policy element "Version" is missing. Without it, policy variables such as ${aws:username} are not supported; add "Version": "2012-10-17".', 'Version'));
  else if (!['2012-10-17', '2008-10-17'].includes(String(doc.Version))) out.push(issue('ERROR', 'INVALID_VERSION', `The policy version ${String(doc.Version)} is not valid: use 2012-10-17.`, 'Version'));
  const { known: kn, prefixes: pf } = actionSets();
  toArr(doc.Statement as Record<string, unknown> | Record<string, unknown>[]).forEach((s, i) => {
    for (const k of Object.keys(s)) if (!ELEMENTS.includes(k)) out.push(issue('ERROR', 'UNSUPPORTED_ELEMENT', `The element "${k}" is not supported in a policy statement.`, 'Statement', i, k));
    if (s.Effect !== 'Allow' && s.Effect !== 'Deny') out.push(issue('ERROR', 'INVALID_EFFECT', `The Effect "${String(s.Effect)}" is not valid: use "Allow" or "Deny".`, 'Statement', i, 'Effect'));
    if (s.Action === undefined && s.NotAction === undefined) out.push(issue('ERROR', 'MISSING_ACTION', 'The statement has no Action or NotAction.', 'Statement', i));
    if (type === 'IDENTITY_POLICY' && s.Resource === undefined && s.NotResource === undefined) out.push(issue('ERROR', 'MISSING_RESOURCE', 'The statement has no Resource or NotResource: an identity policy statement needs one.', 'Statement', i));
    if (type === 'RESOURCE_POLICY' && s.Principal === undefined && s.NotPrincipal === undefined) out.push(issue('ERROR', 'MISSING_PRINCIPAL', 'A resource policy statement needs a Principal.', 'Statement', i));
    if (type === 'IDENTITY_POLICY' && (s.Principal !== undefined || s.NotPrincipal !== undefined)) out.push(issue('ERROR', 'UNSUPPORTED_ELEMENT', 'An identity policy cannot have a Principal element: the principal is who it is attached to.', 'Statement', i, 'Principal'));
    const actions = toArr<string>(s.Action as string | string[]);
    actions.forEach((act, j) => {
      const a = String(act).toLowerCase();
      if (a === '*' || !a.includes(':')) return;
      const [svc, name] = a.split(':');
      if (!pf.has(svc) || name.includes('*') || name.includes('?') || EXTRA_ACTIONS.has(a)) return;
      // solo se marca como inexistente lo que se parece a una acción conocida del servicio (una errata): no todas las acciones de AWS están simuladas
      const near = [...kn].some((k) => k.startsWith(svc + ':') && lev(k.split(':')[1], name) <= 2);
      if (!kn.has(a) && near) out.push(issue('ERROR', 'INVALID_ACTION', `The action ${String(act)} does not exist in the service ${svc}.`, 'Statement', i, 'Action', j));
    });
    if (s.Effect === 'Allow') {
      const res = toArr<string>(s.Resource as string | string[]);
      const passes = actions.some((a) => ['iam:passrole', 'iam:*', '*'].includes(String(a).toLowerCase()));
      if (passes && res.includes('*')) out.push(issue('SECURITY_WARNING', 'PASS_ROLE_WITH_STAR_IN_RESOURCE', 'Using iam:PassRole with "Resource": "*" lets the principal pass any role to any service, which can lead to privilege escalation. Restrict Resource to the roles that are needed.', 'Statement', i, 'Resource'));
      if (s.NotAction !== undefined) out.push(issue('SECURITY_WARNING', 'ALLOW_WITH_NOT_ACTION', 'Allow with NotAction grants every action except the ones listed, including future ones. Prefer listing the allowed actions.', 'Statement', i, 'NotAction'));
      if (s.NotPrincipal !== undefined) out.push(issue('SECURITY_WARNING', 'ALLOW_WITH_NOT_PRINCIPAL', 'Allow with NotPrincipal grants access to everyone except the principals listed. Prefer listing who is allowed.', 'Statement', i, 'NotPrincipal'));
      if (actions.includes('*') && res.includes('*')) out.push(issue('SECURITY_WARNING', 'FULL_ACCESS', 'The statement allows every action on every resource (administrator access). Grant only what is needed.', 'Statement', i));
      const lower = actions.map((x) => String(x).toLowerCase());
      for (const act of lower) {
        const svc = act.split(':')[0];
        if (act.endsWith(':*') || lower.includes('*')) continue;
        if (lower.includes(`${svc}:*`) && !act.endsWith('*')) out.push(issue('SUGGESTION', 'REDUNDANT_ACTION', `The action ${act} is already included by ${svc}:*.`, 'Statement', i, 'Action', lower.indexOf(act)));
      }
    }
  });
  return out;
}

op('accessanalyzer', 'validate-policy', 'policy-document:s! policy-type:s! locale:s validate-policy-resource-type:s max-results:i next-token:s', 'Revisa una política antes de usarla: errores, avisos de seguridad y sugerencias.', { res: () => '*' }, (c) => {
  const type = String(c.p.PolicyType);
  if (!['IDENTITY_POLICY', 'RESOURCE_POLICY', 'SERVICE_CONTROL_POLICY'].includes(type)) throw val(`1 validation error detected: Value '${type}' at 'policyType' failed to satisfy constraint: Member must satisfy enum value set: [IDENTITY_POLICY, RESOURCE_POLICY, SERVICE_CONTROL_POLICY]`);
  return { findings: validatePolicy(String(c.p.PolicyDocument), type) };
});

void granteesOf;
