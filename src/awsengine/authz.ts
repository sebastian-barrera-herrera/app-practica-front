/** Autorización de peticiones: contexto de condiciones y evaluación contra las políticas del que llama. */
import { b64encode } from '../engine/commands/hash';
import { denialReason, evaluate, principalPolicies, type Context, type PolicySource } from './policy';
import { AwsError, type AuthzTarget, type Caller, type OpCtx } from './registry';
import type { Account } from './types';

export function baseContext(acct: Account, caller: Caller, region: string): Context {
  const ctx: Context = {
    'aws:PrincipalArn': caller.arn,
    'aws:PrincipalAccount': caller.account,
    'aws:PrincipalType': caller.type,
    'aws:userid': caller.userId,
    'aws:CurrentTime': new Date(acct.clock).toISOString().replace(/\.\d+Z$/, 'Z'),
    'aws:EpochTime': Math.floor(acct.clock / 1000),
    'aws:SourceIp': acct.sourceIp,
    'aws:SecureTransport': true,
    'aws:RequestedRegion': region,
    'aws:ResourceAccount': acct.id,
  };
  if (caller.userName) ctx['aws:username'] = caller.userName;
  // solo las sesiones que usaron MFA llevan esta clave (con claves de larga duración ni existe)
  if (caller.mfa) {
    ctx['aws:MultiFactorAuthPresent'] = true;
    ctx['aws:MultiFactorAuthAge'] = 600;
  }
  const u = caller.userName ? acct.iam.users[caller.userName] : undefined;
  const r = caller.roleName ? acct.iam.roles[caller.roleName] : undefined;
  for (const t of u?.Tags ?? r?.Tags ?? []) ctx[`aws:PrincipalTag/${t.Key}`] = t.Value;
  return ctx;
}

/** Mensaje de error cifrado (como el de EC2): se puede abrir con `aws sts decode-authorization-message`. */
const encodeAuth = (principal: string, t: AuthzTarget, decision: string) => b64encode(JSON.stringify({ p: principal, a: t.action, r: t.resource, d: decision })).replace(/=+$/, '');

/** Política del bucket que corresponde a un ARN de S3. */
function bucketPolicy(acct: Account, resource: string): PolicySource[] {
  const m = /^arn:aws:s3:::([^/]+)/.exec(resource);
  const b = m ? acct.s3.buckets[m[1]] : undefined;
  return b?.policy ? [{ name: 'bucket-policy', kind: 'resource', doc: b.policy }] : [];
}

/** Comprueba los permisos del que llama. Lanza AwsError como lo haría el servicio si se deniega. */
export function authorize(c: Pick<OpCtx, 'acct' | 'caller' | 'region' | 'service'>, targets: AuthzTarget[], api?: string): void {
  void api;
  const { acct, caller } = c;
  const pp = principalPolicies(acct, caller.arn);
  const root = caller.root || !!pp?.root;
  const own = pp?.policies ?? [];
  for (const t of targets) {
    const ctx = { ...baseContext(acct, caller, c.region), ...(t.context ?? {}) };
    const r = evaluate({ action: t.action, resource: t.resource, principalArn: caller.arn, principalAccount: caller.account, context: ctx, policies: [...own, ...bucketPolicy(acct, t.resource)], root });
    if (r.decision === 'allowed') continue;
    const reason = denialReason(r, caller.arn, t.action, t.resource);
    if (c.service === 'ec2') throw new AwsError('UnauthorizedOperation', `You are not authorized to perform this operation. User: ${reason.slice(6)}. Encoded authorization failure message: ${encodeAuth(caller.arn, t, r.decision)}`, 403);
    if (c.service === 's3' || c.service === 's3api') throw new AwsError('AccessDenied', 'Access Denied', 403);
    const code = c.service === 'iam' || c.service === 'sts' || c.service === 'cloudwatch' ? 'AccessDenied' : c.service === 'sns' ? 'AuthorizationError' : 'AccessDeniedException';
    throw new AwsError(code, reason, 403);
  }
}
