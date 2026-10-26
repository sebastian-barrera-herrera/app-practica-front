/** Credenciales y perfiles: ~/.aws/credentials, ~/.aws/config, variables de entorno y autenticación contra la cuenta. */
import { AwsError, type AwsIO, type Caller } from './registry';
import type { Account } from './types';
import { secretFor, sessionTokenFor } from './util';

// ───────────────────────── archivos INI ─────────────────────────

export type Ini = Record<string, Record<string, string>>;

export function parseIni(text: string): Ini {
  const out: Ini = {};
  let cur: Record<string, string> | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.+)]$/.exec(line);
    if (sec) {
      cur = out[sec[1].trim()] ??= {};
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && cur) cur[kv[1].trim().toLowerCase()] = kv[2].trim();
  }
  return out;
}

export function stringifyIni(ini: Ini): string {
  return Object.entries(ini)
    .map(([sec, kv]) => `[${sec}]\n${Object.entries(kv).map(([k, v]) => `${k} = ${v}`).join('\n')}\n`)
    .join('\n');
}

export const credsPath = (io: AwsIO) => io.env.AWS_SHARED_CREDENTIALS_FILE || `${io.home}/.aws/credentials`;
export const configPath = (io: AwsIO) => io.env.AWS_CONFIG_FILE || `${io.home}/.aws/config`;

export function readCredsFile(io: AwsIO): Ini {
  return parseIni(io.readFile(credsPath(io)) ?? '');
}
export function readConfigFile(io: AwsIO): Ini {
  return parseIni(io.readFile(configPath(io)) ?? '');
}

/** En `config` los perfiles se llaman `[profile x]` (salvo `[default]`). */
export const configSection = (profile: string) => (profile === 'default' ? 'default' : `profile ${profile}`);

export function profileNames(io: AwsIO): string[] {
  const names = new Set<string>(Object.keys(readCredsFile(io)));
  for (const s of Object.keys(readConfigFile(io))) names.add(s === 'default' ? 'default' : s.replace(/^profile\s+/, ''));
  return [...names];
}

// ───────────────────────── resolución ─────────────────────────

export interface Resolved {
  akid: string;
  secret: string;
  token?: string;
  region?: string;
  output?: string;
  profile: string;
  /** De dónde salen las credenciales (para `aws configure list`). */
  source: 'env' | 'shared-credentials-file' | 'config-file' | 'assume-role' | 'none';
}

/** Error al localizar credenciales o perfiles (mensajes literales de la CLI). */
export class CredError extends Error {
  constructor(message: string, public code = 255) {
    super(message);
  }
}

type AssumeFn = (acct: Account, caller: Caller, roleArn: string, session: string, mfa: boolean) => { AccessKeyId: string; token: string };

export interface ResolveOpts {
  /** `--profile` explícito */
  profile?: string;
  /** Cómo asumir un rol (de services/sts) */
  assume?: AssumeFn;
  /** Autentica unas credenciales (para encadenar roles) */
  auth?: (r: Resolved) => Caller;
}

export function resolveRegion(io: AwsIO, flag: string | undefined, profile: string): string | undefined {
  if (flag) return flag;
  const env = io.env.AWS_REGION || io.env.AWS_DEFAULT_REGION;
  if (env) return env;
  const cfg = readConfigFile(io)[configSection(profile)];
  return cfg?.region || undefined;
}

export function resolveCredentials(io: AwsIO, o: ResolveOpts = {}): Resolved {
  const explicit = o.profile;
  const envProfile = io.env.AWS_PROFILE || io.env.AWS_DEFAULT_PROFILE;
  const profile = explicit ?? envProfile ?? 'default';
  const cfgAll = readConfigFile(io);
  const cfg = cfgAll[configSection(profile)] ?? {};
  const common = { profile, region: cfg.region, output: cfg.output };

  if (!explicit && io.env.AWS_ACCESS_KEY_ID && io.env.AWS_SECRET_ACCESS_KEY)
    return { ...common, akid: io.env.AWS_ACCESS_KEY_ID, secret: io.env.AWS_SECRET_ACCESS_KEY, token: io.env.AWS_SESSION_TOKEN || undefined, source: 'env' };

  const credsAll = readCredsFile(io);
  const exists = profile in credsAll || configSection(profile) in cfgAll;
  if (!exists && (explicit || envProfile) && !(profile === 'default')) throw new CredError(`The config profile (${profile}) could not be found`);

  const cr = credsAll[profile] ?? {};
  // perfil que asume un rol a partir de otro
  const roleArn = cfg.role_arn ?? cr.role_arn;
  const sourceProfile = cfg.source_profile ?? cr.source_profile;
  if (roleArn && sourceProfile && o.assume && o.auth) {
    const src = resolveCredentials(io, { ...o, profile: sourceProfile });
    const caller = o.auth(src);
    const session = cfg.role_session_name ?? `botocore-session-${io.acct.clock / 1000}`;
    const got = o.assume(io.acct, caller, roleArn, session, !!cfg.mfa_serial);
    return { ...common, akid: got.AccessKeyId, secret: secretFor(got.AccessKeyId), token: got.token, source: 'assume-role' };
  }
  const akid = cr.aws_access_key_id ?? cfg.aws_access_key_id;
  const secret = cr.aws_secret_access_key ?? cfg.aws_secret_access_key;
  if (akid && secret) return { ...common, akid, secret, token: cr.aws_session_token ?? cfg.aws_session_token, source: cr.aws_access_key_id ? 'shared-credentials-file' : 'config-file' };
  throw new CredError('Unable to locate credentials. You can configure credentials by running "aws configure".');
}

// ───────────────────────── autenticación ─────────────────────────

/** Mensajes de error de credenciales: cambian según el servicio (S3 usa otros códigos). */
function authError(kind: 'unknown' | 'signature' | 'expired', service: string): AwsError {
  const s3 = service === 's3' || service === 's3api';
  if (kind === 'unknown') return s3 ? new AwsError('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.', 403) : new AwsError('InvalidClientTokenId', 'The security token included in the request is invalid.', 403);
  if (kind === 'expired') return s3 ? new AwsError('ExpiredToken', 'The provided token has expired.', 400) : new AwsError('ExpiredToken', 'The security token included in the request is expired', 403);
  return s3
    ? new AwsError('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided. Check your key and signing method.', 403)
    : new AwsError('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided. Check your AWS Secret Access Key and signing method. Consult the service documentation for details.', 403);
}

/** Identifica quién hace la petición. Lanza AwsError como lo haría AWS. */
export function authenticate(acct: Account, r: Resolved, service: string): Caller {
  const k = r.akid;
  if (k.startsWith('ASIA')) {
    const s = acct.sessions[k];
    if (!s) throw authError('unknown', service);
    if (r.secret !== secretFor(k)) throw authError('signature', service);
    if (r.token !== sessionTokenFor(k)) throw new AwsError('InvalidClientTokenId', 'The security token included in the request is invalid.', 403);
    if (s.expires <= acct.clock) throw authError('expired', service);
    if (s.roleArn) {
      const name = s.roleArn.split('/').pop()!;
      const role = acct.iam.roles[name];
      return { arn: `arn:aws:sts::${acct.id}:assumed-role/${name}/${s.roleSessionName}`, account: acct.id, type: 'AssumedRole', userId: `${role?.RoleId ?? 'AROAXXXXXXXXXXXXXXXXX'}:${s.roleSessionName}`, root: false, mfa: s.mfa, accessKeyId: k, roleName: name, sessionName: s.roleSessionName };
    }
    const u = acct.iam.users[s.source.split('/').pop()!];
    if (!u) throw authError('unknown', service);
    return { arn: u.Arn, account: acct.id, type: 'User', userName: u.UserName, userId: u.UserId, root: false, mfa: s.mfa, accessKeyId: k };
  }
  if (r.secret !== secretFor(k) && (acct.iam.rootKeys.some((x) => x.AccessKeyId === k) || Object.values(acct.iam.users).some((u) => u.accessKeys.some((x) => x.AccessKeyId === k)))) throw authError('signature', service);
  const rk = acct.iam.rootKeys.find((x) => x.AccessKeyId === k);
  if (rk) {
    if (rk.Status !== 'Active') throw authError('unknown', service);
    return { arn: `arn:aws:iam::${acct.id}:root`, account: acct.id, type: 'Account', userId: acct.id, root: true, mfa: acct.iam.rootMfa, accessKeyId: k };
  }
  for (const u of Object.values(acct.iam.users)) {
    const key = u.accessKeys.find((x) => x.AccessKeyId === k);
    if (!key) continue;
    if (key.Status !== 'Active') throw authError('unknown', service);
    return { arn: u.Arn, account: acct.id, type: 'User', userName: u.UserName, userId: u.UserId, root: false, mfa: false, accessKeyId: k };
  }
  throw authError('unknown', service);
}
