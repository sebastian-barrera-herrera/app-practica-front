/**
 * Evaluador de políticas de IAM (lógica real simplificada):
 *   1. Un Deny explícito en cualquier política gana siempre.
 *   2. Si no, hace falta un Allow (identidad, o recurso si es la misma cuenta y nombra al principal).
 *   3. Los límites de permisos y las políticas de sesión recortan lo que concede la identidad.
 *   4. Sin Allow → denegado por defecto (implícito).
 */
import type { Account, PolicyDoc, PolicyStatement } from './types';
import { cidrContainsIp, parseArn, parseDate, toArr, wildcard } from './util';

export type CtxValue = string | number | boolean | string[];
export type Context = Record<string, CtxValue>;

export interface PolicySource {
  /** Nombre que se enseña en las trazas (p. ej. `AmazonS3ReadOnlyAccess` o `inline:permisos`). */
  name: string;
  kind: 'identity' | 'resource' | 'boundary' | 'session' | 'scp';
  doc: PolicyDoc;
}

export interface EvalRequest {
  action: string;
  resource: string;
  /** ARN del principal (usuario, rol o sesión de rol). */
  principalArn: string;
  principalAccount: string;
  /** Cuenta dueña del recurso (por defecto, la del principal). */
  resourceAccount?: string;
  principalType?: 'User' | 'AssumedRole' | 'Account';
  context?: Context;
  policies: PolicySource[];
  /** La identidad es el usuario root (no necesita políticas, solo puede frenarla una SCP). */
  root?: boolean;
}

export interface MatchedStatement {
  source: string;
  kind: PolicySource['kind'];
  sid?: string;
  effect: 'Allow' | 'Deny';
  /** Posición (nº de sentencia, desde 1) dentro de la política. */
  index: number;
}

export type Decision = 'allowed' | 'explicitDeny' | 'implicitDeny';

export interface EvalResult {
  decision: Decision;
  matched: MatchedStatement[];
  /** Qué tipo de política lo decidió (para el mensaje de error). */
  by?: PolicySource['kind'];
  /** Valores de contexto que las condiciones necesitaban y no estaban. */
  missingContext: string[];
}

export const statements = (doc: PolicyDoc): PolicyStatement[] => toArr(doc.Statement);

// ───────────────────────── validación de políticas ─────────────────────────

const KNOWN_ELEMENTS = new Set(['Sid', 'Effect', 'Action', 'NotAction', 'Resource', 'NotResource', 'Principal', 'NotPrincipal', 'Condition']);

/** Errores de sintaxis de una política (como `MalformedPolicyDocument`). `kind` indica el tipo de documento. */
export function validatePolicy(doc: unknown, kind: 'identity' | 'resource' | 'trust' = 'identity'): string | null {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return 'Syntax errors in policy.';
  const d = doc as PolicyDoc;
  if (d.Version !== undefined && d.Version !== '2012-10-17' && d.Version !== '2008-10-17') return `The policy failed legacy parsing`;
  if (d.Statement === undefined) return 'Syntax errors in policy.';
  const sts = statements(d);
  if (!sts.length) return 'Syntax errors in policy.';
  for (const s of sts) {
    if (typeof s !== 'object' || s === null) return 'Syntax errors in policy.';
    for (const k of Object.keys(s)) if (!KNOWN_ELEMENTS.has(k)) return 'Syntax errors in policy.';
    if (s.Effect !== 'Allow' && s.Effect !== 'Deny') return 'Syntax errors in policy.';
    if (s.Action === undefined && s.NotAction === undefined) return 'Policy statement must contain actions.';
    if (kind === 'identity') {
      if (s.Resource === undefined && s.NotResource === undefined) return 'Policy statement must contain resources.';
      if (s.Principal !== undefined) return 'Policy document should not specify a principal.';
    } else if (s.Principal === undefined) return kind === 'trust' ? 'Policy document must contain a principal.' : 'Missing required field Principal';
  }
  return null;
}

// ───────────────────────── condiciones ─────────────────────────

function expandVars(s: string, ctx: Context): string {
  if (!s.includes('${')) return s;
  return s.replace(/\$\{([^}]+)\}/g, (m, key: string) => {
    if (key === '*' || key === '?' || key === '$') return key;
    const v = ctx[key.toLowerCase()];
    if (v === undefined) return m;
    return Array.isArray(v) ? v[0] ?? '' : String(v);
  });
}

type Pos = (c: string, p: string) => boolean;

const num = (x: string) => Number(x);

const POS: Record<string, Pos> = {
  stringequals: (c, p) => c === p,
  stringequalsignorecase: (c, p) => c.toLowerCase() === p.toLowerCase(),
  stringlike: (c, p) => wildcard(p, c),
  numericequals: (c, p) => num(c) === num(p),
  numericlessthan: (c, p) => num(c) < num(p),
  numericlessthanequals: (c, p) => num(c) <= num(p),
  numericgreaterthan: (c, p) => num(c) > num(p),
  numericgreaterthanequals: (c, p) => num(c) >= num(p),
  dateequals: (c, p) => parseDate(c) === parseDate(p),
  datelessthan: (c, p) => parseDate(c) < parseDate(p),
  datelessthanequals: (c, p) => parseDate(c) <= parseDate(p),
  dategreaterthan: (c, p) => parseDate(c) > parseDate(p),
  dategreaterthanequals: (c, p) => parseDate(c) >= parseDate(p),
  bool: (c, p) => c.toLowerCase() === p.toLowerCase(),
  ipaddress: (c, p) => cidrContainsIp(p.includes('/') ? p : p + '/32', c),
  arnequals: (c, p) => wildcard(p, c),
  arnlike: (c, p) => wildcard(p, c),
};

const NEG: Record<string, string> = {
  stringnotequals: 'stringequals',
  stringnotequalsignorecase: 'stringequalsignorecase',
  stringnotlike: 'stringlike',
  numericnotequals: 'numericequals',
  datenotequals: 'dateequals',
  notipaddress: 'ipaddress',
  arnnotequals: 'arnequals',
  arnnotlike: 'arnlike',
};

/** ¿Se cumple este bloque de condición `op: { clave: valores }`? */
function condHolds(opRaw: string, block: Record<string, unknown>, ctx: Context, missing: string[]): boolean {
  let op = opRaw.toLowerCase();
  let setOp: 'all' | 'any' | null = null;
  if (op.startsWith('forallvalues:')) {
    setOp = 'all';
    op = op.slice(13);
  } else if (op.startsWith('foranyvalue:')) {
    setOp = 'any';
    op = op.slice(12);
  }
  let ifExists = false;
  if (op.endsWith('ifexists')) {
    ifExists = true;
    op = op.slice(0, -8);
  }

  for (const [key, rawVals] of Object.entries(block)) {
    const vals = toArr(rawVals as string | string[]).map((v) => expandVars(String(v), ctx));
    const present = ctx[key.toLowerCase()];
    if (op === 'null') {
      const wantMissing = vals[0]?.toLowerCase() === 'true';
      if ((present === undefined) !== wantMissing) return false;
      continue;
    }
    const negated = op in NEG;
    const base = negated ? NEG[op] : op;
    const fn = POS[base];
    if (!fn) return false;
    if (present === undefined) {
      if (ifExists) continue;
      missing.push(key);
      if (setOp === 'all') continue;
      if (negated) continue;
      return false;
    }
    const cvals = (Array.isArray(present) ? present : [present]).map((x) => String(x));
    const hit = (c: string) => vals.some((p) => fn(c, p));
    let ok: boolean;
    if (setOp === 'all') ok = negated ? cvals.every((c) => !hit(c)) : cvals.every(hit);
    else if (setOp === 'any') ok = negated ? cvals.some((c) => !hit(c)) : cvals.some(hit);
    else ok = negated ? cvals.every((c) => !hit(c)) : cvals.some(hit);
    if (!ok) return false;
  }
  return true;
}

function conditionsHold(st: PolicyStatement, ctx: Context, missing: string[]): boolean {
  if (!st.Condition) return true;
  for (const [op, block] of Object.entries(st.Condition)) if (!condHolds(op, block as Record<string, unknown>, ctx, missing)) return false;
  return true;
}

// ───────────────────────── coincidencias ─────────────────────────

function actionMatches(st: PolicyStatement, action: string): boolean {
  if (st.Action !== undefined) return toArr(st.Action).some((p) => wildcard(p, action, true));
  if (st.NotAction !== undefined) return !toArr(st.NotAction).some((p) => wildcard(p, action, true));
  return false;
}

function resourceMatches(st: PolicyStatement, resource: string, ctx: Context, noResourceMeansAny: boolean): boolean {
  if (st.Resource === undefined && st.NotResource === undefined) return noResourceMeansAny;
  if (st.Resource !== undefined) return toArr(st.Resource).some((p) => wildcard(expandVars(p, ctx), resource));
  if (st.NotResource !== undefined) return !toArr(st.NotResource).some((p) => wildcard(expandVars(p, ctx), resource));
  return false;
}

/** ¿El principal de la sentencia incluye a este principal? Devuelve 'direct' si lo nombra por su ARN (no por la cuenta). */
function principalMatch(st: PolicyStatement, arn: string, account: string): false | 'direct' | 'account' {
  const p = st.Principal;
  if (p === undefined) return false;
  if (p === '*') return 'direct';
  const aws = toArr(p.AWS);
  let res: false | 'direct' | 'account' = false;
  for (const a of aws) {
    if (a === '*') return 'direct';
    if (a === account || a === `arn:aws:iam::${account}:root`) res = res || 'account';
    else if (wildcard(a, arn)) return 'direct';
    else {
      // un rol asumido se puede nombrar por el ARN del rol
      const m = /^arn:aws:sts::(\d+):assumed-role\/([^/]+)\//.exec(arn);
      if (m && wildcard(a, `arn:aws:iam::${m[1]}:role/${m[2]}`)) return 'direct';
    }
  }
  return res;
}

interface Hit {
  src: PolicySource;
  st: PolicyStatement;
  index: number;
  principal?: 'direct' | 'account';
}

/** Evalúa una petición. */
export function evaluate(req: EvalRequest): EvalResult {
  const ctx: Context = {};
  for (const [k, v] of Object.entries(req.context ?? {})) ctx[k.toLowerCase()] = v;
  const missing: string[] = [];
  const hits: Hit[] = [];
  for (const src of req.policies) {
    statements(src.doc).forEach((st, i) => {
      if (!actionMatches(st, req.action)) return;
      if (!resourceMatches(st, req.resource, ctx, src.kind === 'resource')) return;
      let principal: Hit['principal'];
      if (src.kind === 'resource') {
        const pm = principalMatch(st, req.principalArn, req.principalAccount);
        if (!pm) return;
        principal = pm;
      }
      if (!conditionsHold(st, ctx, missing)) return;
      hits.push({ src, st, index: i + 1, principal });
    });
  }
  const mk = (h: Hit): MatchedStatement => ({ source: h.src.name, kind: h.src.kind, sid: h.st.Sid, effect: h.st.Effect, index: h.index });
  const finish = (decision: Decision, matched: Hit[], by?: PolicySource['kind']): EvalResult => ({ decision, matched: matched.map(mk), by, missingContext: [...new Set(missing)] });

  const denies = hits.filter((h) => h.st.Effect === 'Deny');
  if (denies.length) return finish('explicitDeny', denies, denies[0].src.kind);

  if (req.root) return finish('allowed', []);

  const hasKind = (k: PolicySource['kind']) => req.policies.some((p) => p.kind === k);
  const allows = (k: PolicySource['kind']) => hits.filter((h) => h.src.kind === k && h.st.Effect === 'Allow');

  // SCP: si la cuenta tiene, tiene que permitirlo
  if (hasKind('scp') && !allows('scp').length) return finish('implicitDeny', [], 'scp');

  const idAllow = allows('identity');
  const resAllow = allows('resource');
  const sameAccount = (req.resourceAccount ?? req.principalAccount) === req.principalAccount;

  const identityOk = idAllow.length > 0 && (!hasKind('boundary') || allows('boundary').length > 0) && (!hasKind('session') || allows('session').length > 0);

  if (sameAccount) {
    // una política de recurso que nombra al principal concede por sí sola (y no la limita el boundary)
    const direct = resAllow.filter((h) => h.principal === 'direct');
    if (direct.length) return finish('allowed', direct, 'resource');
    if (identityOk) return finish('allowed', [...idAllow, ...allows('boundary'), ...allows('session'), ...resAllow], 'identity');
    if (idAllow.length && hasKind('boundary') && !allows('boundary').length) return finish('implicitDeny', idAllow, 'boundary');
    if (idAllow.length && hasKind('session') && !allows('session').length) return finish('implicitDeny', idAllow, 'session');
    return finish('implicitDeny', [], 'identity');
  }
  // entre cuentas: hacen falta las dos
  if (identityOk && resAllow.length) return finish('allowed', [...idAllow, ...resAllow], 'identity');
  return finish('implicitDeny', [], resAllow.length ? 'identity' : 'resource');
}

// ───────────────────────── políticas de un principal ─────────────────────────

export function principalPolicies(acct: Account, arn: string): { policies: PolicySource[]; root: boolean; account: string } | null {
  const a = parseArn(arn);
  if (!a) return null;
  const ids = acct.iam;
  const managed = (names: string[]): PolicySource[] =>
    names.flatMap((pa) => {
      const m = ids.policies[pa];
      return m ? [{ name: m.PolicyName, kind: 'identity' as const, doc: m.document }] : [];
    });
  const inline = (o: Record<string, PolicyDoc>): PolicySource[] => Object.entries(o).map(([n, doc]) => ({ name: n, kind: 'identity' as const, doc }));
  const boundaryOf = (b?: string): PolicySource[] => (b && ids.policies[b] ? [{ name: ids.policies[b].PolicyName, kind: 'boundary' as const, doc: ids.policies[b].document }] : []);

  if (a.service === 'iam' && a.resource === 'root') return { policies: [], root: true, account: a.account };
  if (a.service === 'iam' && a.resource.startsWith('user/')) {
    const name = a.resource.split('/').pop()!;
    const u = ids.users[name];
    if (!u) return null;
    const groups = u.groups.map((g) => ids.groups[g]).filter(Boolean);
    return {
      account: a.account,
      root: false,
      policies: [...managed(u.attached), ...inline(u.inline), ...groups.flatMap((g) => [...managed(g.attached), ...inline(g.inline)]), ...boundaryOf(u.boundary)],
    };
  }
  if (a.service === 'iam' && a.resource.startsWith('role/')) {
    const name = a.resource.split('/').pop()!;
    const r = ids.roles[name];
    if (!r) return null;
    return { account: a.account, root: false, policies: [...managed(r.attached), ...inline(r.inline), ...boundaryOf(r.boundary)] };
  }
  const m = /^assumed-role\/([^/]+)\//.exec(a.resource);
  if (a.service === 'sts' && m) {
    const r = ids.roles[m[1]];
    if (!r) return null;
    const sess = Object.values(acct.sessions).find((s) => s.roleArn && `arn:aws:sts::${acct.id}:assumed-role/${m[1]}/${s.roleSessionName}` === arn);
    const pol: PolicySource[] = [...managed(r.attached), ...inline(r.inline), ...boundaryOf(r.boundary)];
    if (sess?.policy) pol.push({ name: 'session-policy', kind: 'session', doc: sess.policy });
    return { account: a.account, root: false, policies: pol };
  }
  return null;
}

// ───────────────────────── mensajes de error ─────────────────────────

/** Texto de `AccessDenied` como lo da AWS (con el motivo). */
export function denialReason(r: EvalResult, principalArn: string, action: string, resource: string): string {
  const base = `User: ${principalArn} is not authorized to perform: ${action}`;
  const on = resource && resource !== '*' ? ` on resource: ${resource}` : '';
  if (r.decision === 'explicitDeny') {
    const k = r.by === 'resource' ? 'a resource-based policy' : r.by === 'boundary' ? 'a permissions boundary' : r.by === 'scp' ? 'a service control policy' : r.by === 'session' ? 'a session policy' : 'an identity-based policy';
    return `${base}${on} with an explicit deny in ${k}`;
  }
  const k = r.by === 'boundary' ? 'permissions boundary' : r.by === 'scp' ? 'service control policy' : r.by === 'session' ? 'session policy' : r.by === 'resource' ? 'resource-based policy' : 'identity-based policy';
  return `${base}${on} because no ${k} allows the ${action} action`;
}
