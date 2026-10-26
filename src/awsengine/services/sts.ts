/** AWS STS: quién soy y credenciales temporales. */
import type { Context } from '../policy';
import { evaluate, principalPolicies, validatePolicy } from '../policy';
import { AwsError, op, type Caller } from '../registry';
import type { Account, AssumedSession, PolicyDoc, Tag } from '../types';
import { isoZ, iso, secretFor, sessionTokenFor, tempKeyId } from '../util';
import { b64decode } from '../../engine/commands/hash';

export interface AssumeIn {
  roleArn: string;
  sessionName: string;
  durationSeconds: number;
  /** El que llama presentó un código MFA válido. */
  mfa: boolean;
  externalId?: string;
  policy?: PolicyDoc;
  tags?: Tag[];
  baseCtx: Context;
}

export interface TempCreds {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
  Expiration: string;
  AssumedRoleUser: { AssumedRoleId: string; Arn: string };
}

const denied = (caller: Caller, action: string, resource: string) => new AwsError('AccessDenied', `User: ${caller.arn} is not authorized to perform: ${action} on resource: ${resource}`, 403);

/** Valida el nombre de sesión como lo hace STS. */
function checkSessionName(name: string): void {
  if (name.length < 2) throw new AwsError('ValidationError', `1 validation error detected: Value '${name}' at 'roleSessionName' failed to satisfy constraint: Member must have length greater than or equal to 2`);
  if (!/^[\w+=,.@-]*$/.test(name)) throw new AwsError('ValidationError', `1 validation error detected: Value '${name}' at 'roleSessionName' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\w+=,.@-]*`);
}

/** Asume un rol: comprueba la política de confianza y crea la sesión. */
export function assumeRoleCore(acct: Account, caller: Caller, a: AssumeIn): TempCreds {
  checkSessionName(a.sessionName);
  const m = /^arn:aws:iam::(\d+):role\/(?:.*\/)?([\w+=,.@-]+)$/.exec(a.roleArn);
  if (!m) throw new AwsError('ValidationError', `Invalid ARN: ${a.roleArn}`);
  const role = m[1] === acct.id ? acct.iam.roles[m[2]] : undefined;
  if (!role) throw denied(caller, 'sts:AssumeRole', a.roleArn);
  if (a.durationSeconds < 900) throw new AwsError('ValidationError', `1 validation error detected: Value '${a.durationSeconds}' at 'durationSeconds' failed to satisfy constraint: Member must have value greater than or equal to 900`);
  if (a.durationSeconds > role.MaxSessionDuration) throw new AwsError('ValidationError', `The requested DurationSeconds exceeds the MaxSessionDuration set for this role.`);

  const ctx: Context = { ...a.baseCtx, 'sts:RoleSessionName': a.sessionName };
  if (a.externalId) ctx['sts:ExternalId'] = a.externalId;
  if (a.mfa) {
    ctx['aws:MultiFactorAuthPresent'] = true;
    ctx['aws:MultiFactorAuthAge'] = 30;
  }
  for (const t of a.tags ?? []) ctx[`aws:RequestTag/${t.Key}`] = t.Value;
  const pp = principalPolicies(acct, caller.arn);
  const res = evaluate({
    action: 'sts:AssumeRole',
    resource: a.roleArn,
    principalArn: caller.arn,
    principalAccount: caller.account,
    context: ctx,
    policies: [...(pp?.policies.filter((p) => p.kind === 'identity') ?? []), { name: 'AssumeRolePolicyDocument', kind: 'resource', doc: role.AssumeRolePolicyDocument }],
    root: false,
  });
  // la política de confianza tiene que permitirlo (un Allow en la identidad no basta, ni siquiera a un administrador)
  if (res.decision !== 'allowed' || !res.matched.some((m) => m.kind === 'resource' && m.effect === 'Allow')) throw denied(caller, 'sts:AssumeRole', a.roleArn);

  const akid = tempKeyId(acct);
  const s: AssumedSession = { AccessKeyId: akid, roleArn: a.roleArn, roleSessionName: a.sessionName, source: caller.arn, expires: acct.clock + a.durationSeconds * 1000, mfa: a.mfa, policy: a.policy, tags: a.tags ?? [] };
  acct.sessions[akid] = s;
  return {
    AccessKeyId: akid,
    SecretAccessKey: secretFor(akid),
    SessionToken: sessionTokenFor(akid),
    Expiration: iso(s.expires),
    AssumedRoleUser: { AssumedRoleId: `${role.RoleId}:${a.sessionName}`, Arn: `arn:aws:sts::${acct.id}:assumed-role/${role.RoleName}/${a.sessionName}` },
  };
}

/** Comprueba la pareja MFA (número de serie del usuario + código de 6 dígitos). */
export function checkMfa(acct: Account, caller: Caller, serial: string | undefined, code: string | undefined): boolean {
  if (!serial && !code) return false;
  if (!serial || !code) throw new AwsError('ValidationError', 'Both serial number and token code are required when using MFA.');
  if (!/^\d{6}$/.test(code)) throw new AwsError('ValidationError', `1 validation error detected: Value '${code}' at 'tokenCode' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\d]*`);
  const u = caller.userName ? acct.iam.users[caller.userName] : undefined;
  const ok = !!u && u.mfa.includes(serial) && code !== '000000';
  if (!ok) throw new AwsError('AccessDenied', 'MultiFactorAuthentication failed with invalid MFA one time pass code(s).', 403);
  return true;
}

function policyParam(raw: unknown): PolicyDoc | undefined {
  if (raw === undefined) return undefined;
  let doc: unknown;
  try {
    doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new AwsError('MalformedPolicyDocument', 'Syntax errors in policy.');
  }
  const err = validatePolicy(doc);
  if (err) throw new AwsError('MalformedPolicyDocument', err);
  return doc as PolicyDoc;
}

op('sts', 'get-caller-identity', '', 'Devuelve la identidad (usuario, rol o root) con la que firmas las peticiones.', { authz: false, global: true }, (c) => ({
  UserId: c.caller.userId,
  Account: c.caller.account,
  Arn: c.caller.arn,
}));

op('sts', 'assume-role', 'role-arn:s! role-session-name:s! policy:s duration-seconds:i external-id:s serial-number:s token-code:s tags:t source-identity:s', 'Asume un rol y devuelve credenciales temporales.', { authz: false, global: true }, (c) => {
  const mfa = checkMfa(c.acct, c.caller, c.p.SerialNumber, c.p.TokenCode) || c.caller.mfa;
  const r = assumeRoleCore(c.acct, c.caller, {
    roleArn: c.p.RoleArn,
    sessionName: c.p.RoleSessionName,
    durationSeconds: c.p.DurationSeconds ?? 3600,
    mfa,
    externalId: c.p.ExternalId,
    policy: policyParam(c.p.Policy),
    tags: c.p.Tags,
    baseCtx: {
      'aws:PrincipalArn': c.caller.arn,
      'aws:PrincipalAccount': c.caller.account,
      'aws:SourceIp': c.acct.sourceIp,
      'aws:CurrentTime': isoZ(c.acct.clock),
      'aws:SecureTransport': true,
      ...(c.caller.userName ? { 'aws:username': c.caller.userName } : {}),
    },
  });
  return {
    Credentials: { AccessKeyId: r.AccessKeyId, SecretAccessKey: r.SecretAccessKey, SessionToken: r.SessionToken, Expiration: r.Expiration },
    AssumedRoleUser: r.AssumedRoleUser,
  };
});

op('sts', 'get-session-token', 'duration-seconds:i serial-number:s token-code:s', 'Credenciales temporales para un usuario de IAM (típicamente para usar MFA).', { authz: false, global: true }, (c) => {
  if (c.caller.type === 'AssumedRole') throw new AwsError('AccessDenied', `Cannot call GetSessionToken with session credentials`, 403);
  const dur = c.p.DurationSeconds ?? 43200;
  if (dur < 900 || dur > 129600) throw new AwsError('ValidationError', `1 validation error detected: Value '${dur}' at 'durationSeconds' failed to satisfy constraint: Member must have value ${dur < 900 ? 'greater than or equal to 900' : 'less than or equal to 129600'}`);
  const mfa = checkMfa(c.acct, c.caller, c.p.SerialNumber, c.p.TokenCode);
  const akid = tempKeyId(c.acct);
  const expires = c.acct.clock + dur * 1000;
  c.acct.sessions[akid] = { AccessKeyId: akid, roleArn: '', roleSessionName: '', source: c.caller.arn, expires, mfa, tags: [] };
  return { Credentials: { AccessKeyId: akid, SecretAccessKey: secretFor(akid), SessionToken: sessionTokenFor(akid), Expiration: iso(expires) } };
});

op('sts', 'get-access-key-info', 'access-key-id:s!', 'Devuelve la cuenta a la que pertenece una clave de acceso.', { authz: false, global: true }, (c) => ({ Account: c.acct.id }));

op('sts', 'decode-authorization-message', 'encoded-message:s!', 'Descifra el mensaje largo de un error «not authorized» (hace falta permiso sts:DecodeAuthorizationMessage).', { global: true}, (c) => {
  let info: { p: string; a: string; r: string; d: string } | null = null;
  try {
    const pad = c.p.EncodedMessage + '='.repeat((4 - (c.p.EncodedMessage.length % 4)) % 4);
    info = JSON.parse(b64decode(pad) ?? '');
  } catch {
    info = null;
  }
  if (!info) throw new AwsError('InvalidAuthorizationMessageException', 'Invalid encoded message');
  return {
    DecodedMessage: JSON.stringify({
      allowed: false,
      explicitDeny: info.d === 'explicitDeny',
      matchedStatements: { items: [] },
      failures: { items: [] },
      context: { principal: { id: c.caller.userId, arn: info.p }, action: info.a, resource: info.r, conditions: { items: [] } },
    }),
  };
});
