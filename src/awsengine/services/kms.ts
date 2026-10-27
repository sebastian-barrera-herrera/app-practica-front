/**
 * AWS KMS: claves, alias, políticas de clave, concesiones (grants), cifrado y cifrado de sobre, rotación y borrado programado.
 * El cifrado es simulado pero coherente: un texto cifrado solo se abre con su clave, la misma versión de material y el mismo
 * contexto de cifrado, y las claves deshabilitadas o pendientes de borrado dejan de servir.
 */
import { b64decode, b64encode, sha256, utf8Bytes } from '../../engine/commands/hash';
import { regional } from '../account';
import { baseContext } from '../authz';
import { evaluate, principalPolicies, resourcePolicyGrant, validatePolicy, type Context } from '../policy';
import { AwsError, op, SERVICE_PREFIX, UsageErr, type Caller, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, PolicyDoc, Tag } from '../types';
import type { KmsGrant, KmsKey, KmsState } from '../types-sec';
import { iso, mkArn, newId, toArr } from '../util';
import { kmsHooks } from './kmshooks';

SERVICE_PREFIX.kms = 'kms';

const DAY = 86400000;
const MAGIC = 'KMSv1|';

export const kmsOf = (a: Account, region: string): KmsState => {
  const r = regional(a, region);
  return (r.kms ??= { keys: {}, aliases: {} });
};

const keyArn = (a: Account, region: string, id: string) => mkArn('kms', region, a.id, `key/${id}`);
const aliasArn = (a: Account, region: string, name: string) => mkArn('kms', region, a.id, name);
const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** Política por defecto de una clave nueva: la cuenta delega en IAM («Enable IAM User Permissions»). */
export const defaultKeyPolicy = (a: Account): PolicyDoc => ({ Version: '2012-10-17', Id: 'key-default-1', Statement: [{ Sid: 'Enable IAM User Permissions', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${a.id}:root` }, Action: 'kms:*', Resource: '*' }] as never });

// ───────────────────────── autorización ─────────────────────────

const ALG: Record<string, string[]> = { SYMMETRIC_DEFAULT: ['SYMMETRIC_DEFAULT'], RSA_2048: ['RSAES_OAEP_SHA_1', 'RSAES_OAEP_SHA_256'], HMAC_256: [] };

/** Operaciones de KMS que pueden darse en una concesión. */
const GRANT_OPS = ['Decrypt', 'Encrypt', 'GenerateDataKey', 'GenerateDataKeyWithoutPlaintext', 'ReEncryptFrom', 'ReEncryptTo', 'Sign', 'Verify', 'GetPublicKey', 'CreateGrant', 'RetireGrant', 'DescribeKey', 'GenerateDataKeyPairWithoutPlaintext', 'GenerateDataKeyPair', 'GenerateMac', 'VerifyMac'];

function grantAllows(key: KmsKey, caller: Caller, action: string, enc: Record<string, string>): boolean {
  const api = action.replace(/^kms:/, '');
  const names = new Set([caller.arn, caller.roleName ? `arn:aws:iam::${caller.account}:role/${caller.roleName}` : '']);
  return key.grants.some((g) => {
    if (!names.has(g.GranteePrincipal) || !g.Operations.includes(api)) return false;
    const eq = g.Constraints?.EncryptionContextEquals;
    const sub = g.Constraints?.EncryptionContextSubset;
    if (eq && JSON.stringify(Object.entries(eq).sort()) !== JSON.stringify(Object.entries(enc).sort())) return false;
    if (sub && !Object.entries(sub).every(([k, v]) => enc[k] === v)) return false;
    return true;
  });
}

/**
 * Comprueba que quien llama puede hacer `action` con la clave. La **política de la clave** manda: o nombra a quien llama, o delega en
 * IAM (cuenta `root`) y entonces hace falta además un permiso de identidad; una concesión (grant) también basta.
 */
export function kmsAuthorize(c: Pick<OpCtx, 'acct' | 'caller' | 'region'>, key: KmsKey, action: string, o: { enc?: Record<string, string>; via?: string } = {}): void {
  const { acct, caller } = c;
  const enc = o.enc ?? {};
  const ctx: Context = { ...baseContext(acct, caller, c.region), 'kms:CallerAccount': caller.account };
  if (o.via) ctx['kms:ViaService'] = o.via;
  for (const [k, v] of Object.entries(enc)) ctx[`kms:EncryptionContext:${k}`] = v;
  ctx['kms:EncryptionContextKeys'] = Object.keys(enc);
  const deny = (why: string) => {
    throw new AwsError('AccessDeniedException', `User: ${caller.arn} is not authorized to perform: ${action} on resource: ${key.Arn} ${why}`, 400);
  };
  // las claves administradas por AWS solo se usan a través del servicio, por quien tiene acceso a él
  if (key.manager === 'AWS') {
    if (o.via || action === 'kms:DescribeKey') return;
    deny('because this is an AWS managed key: it can only be used through the AWS service that created it');
  }
  const own = principalPolicies(acct, caller.arn)?.policies ?? [];
  const asResource = [{ name: 'key-policy', kind: 'resource' as const, doc: key.policy }];
  const r = evaluate({ action, resource: key.Arn, principalArn: caller.arn, principalAccount: caller.account, context: ctx, policies: [...own, ...asResource], root: false });
  if (r.decision === 'explicitDeny') deny(`with an explicit deny in ${r.by === 'resource' ? 'a resource-based' : r.by === 'scp' ? 'a service control' : 'an identity-based'} policy`);
  if (grantAllows(key, caller, action, enc)) return;
  const grant = resourcePolicyGrant(key.policy, { action, resource: key.Arn, principalArn: caller.arn, principalAccount: caller.account, context: ctx });
  if (grant === 'direct') return;
  if (grant === 'account') {
    if (caller.root) return;
    const idOnly = evaluate({ action, resource: key.Arn, principalArn: caller.arn, principalAccount: caller.account, context: ctx, policies: own, root: false });
    if (idOnly.decision === 'allowed') return;
    deny(`because no identity-based policy allows the ${action} action`);
  }
  deny(`because no resource-based policy allows the ${action} action`);
}

// ───────────────────────── búsqueda ─────────────────────────

/** Claves administradas por AWS (`alias/aws/s3`, `alias/aws/ssm`…): se crean la primera vez que se usan. */
export function awsManagedKey(a: Account, region: string, service: string): KmsKey {
  const st = kmsOf(a, region);
  const name = `alias/aws/${service}`;
  const have = st.aliases[name];
  if (have) return st.keys[have.target];
  const id = uuid(a, 'kmsaws');
  const key: KmsKey = {
    KeyId: id,
    Arn: keyArn(a, region, id),
    Description: `Default key that protects my ${service.toUpperCase()} data when no other key is defined`,
    Usage: 'ENCRYPT_DECRYPT',
    Spec: 'SYMMETRIC_DEFAULT',
    State: 'Enabled',
    manager: 'AWS',
    created: a.clock,
    policy: { Version: '2012-10-17', Id: `auto-${service}`, Statement: [{ Sid: 'Allow access through service for all principals in the account', Effect: 'Allow', Principal: { AWS: '*' }, Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:CreateGrant', 'kms:DescribeKey'], Resource: '*', Condition: { StringEquals: { 'kms:CallerAccount': a.id } } }] as never },
    grants: [],
    rotation: { enabled: true, days: 365, versions: 1, last: a.clock, next: a.clock + 365 * DAY },
    Tags: [],
  };
  st.keys[id] = key;
  st.aliases[name] = { target: id, created: a.clock };
  return key;
}

/** Busca una clave por id, ARN, alias (`alias/x`) o ARN de alias. */
export function findKey(a: Account, region: string, ref: string, o: { anyRegion?: boolean } = {}): KmsKey {
  const st = kmsOf(a, region);
  const m = /^arn:aws:kms:([^:]+):(\d+):(key|alias)\/(.+)$/.exec(ref);
  let id = ref;
  let alias: string | undefined;
  if (m) {
    if (m[1] !== region && !o.anyRegion) throw new AwsError('NotFoundException', `Key '${ref}' does not exist`, 400);
    if (m[3] === 'alias') alias = `alias/${m[4]}`;
    else id = m[4];
  } else if (ref.startsWith('alias/')) alias = ref;
  if (alias) {
    const al = st.aliases[alias];
    if (!al) throw new AwsError('NotFoundException', `Alias ${aliasArn(a, region, alias)} is not found.`, 400);
    id = al.target;
  }
  const key = st.keys[id];
  if (!key) throw new AwsError('NotFoundException', `Key '${keyArn(a, region, id)}' does not exist`, 400);
  return key;
}

/** La clave tiene que poder usarse para cifrar o descifrar. */
function usable(key: KmsKey): void {
  if (key.State === 'Disabled') throw new AwsError('DisabledException', `${key.Arn} is disabled.`, 400);
  if (key.State === 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${key.Arn} is pending deletion.`, 400);
}

const view = (a: Account, key: KmsKey) => ({
  AWSAccountId: a.id,
  KeyId: key.KeyId,
  Arn: key.Arn,
  CreationDate: iso(key.created),
  Enabled: key.State === 'Enabled',
  Description: key.Description,
  KeyUsage: key.Usage,
  KeyState: key.State,
  ...(key.deletion ? { DeletionDate: iso(key.deletion) } : {}),
  Origin: 'AWS_KMS',
  KeyManager: key.manager,
  CustomerMasterKeySpec: key.Spec,
  KeySpec: key.Spec,
  ...(key.Usage === 'ENCRYPT_DECRYPT' ? { EncryptionAlgorithms: ALG[key.Spec] ?? [] } : {}),
  ...(key.Usage === 'SIGN_VERIFY' ? { SigningAlgorithms: key.Spec.startsWith('RSA') ? ['RSASSA_PKCS1_V1_5_SHA_256', 'RSASSA_PSS_SHA_256'] : ['ECDSA_SHA_256'] } : {}),
  MultiRegion: !!key.multiRegion,
});

// ───────────────────────── cifrado simulado ─────────────────────────

const secret = (a: Account, key: KmsKey, version: number) => sha256(`${a.seed}:${key.KeyId}:v${version}`);
const ctxHash = (enc: Record<string, string>) => sha256(JSON.stringify(Object.entries(enc).sort())).slice(0, 8);

function xor(text: string, sec: string): string {
  const bytes = utf8Bytes(text);
  let ks = '';
  for (let i = 0; ks.length < bytes.length * 2; i++) ks += sha256(`${sec}:${i}`);
  return bytes.map((b, i) => (b ^ parseInt(ks.slice(i * 2, i * 2 + 2), 16)).toString(16).padStart(2, '0')).join('');
}

function unxor(hex: string, sec: string): string {
  const n = hex.length / 2;
  let ks = '';
  for (let i = 0; ks.length < n * 2; i++) ks += sha256(`${sec}:${i}`);
  const bytes: number[] = [];
  for (let i = 0; i < n; i++) bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16) ^ parseInt(ks.slice(i * 2, i * 2 + 2), 16));
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    else if (c < 0xf0) out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else out += String.fromCodePoint(((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
  }
  return out;
}

/** Cifra y devuelve el «blob» en bruto (el que la CLI muestra en base64). */
export function kmsSeal(a: Account, key: KmsKey, plain: string, enc: Record<string, string> = {}): string {
  const v = key.rotation.versions;
  return `${MAGIC}${key.KeyId}|${v}|${ctxHash(enc)}|${xor(plain, secret(a, key, v))}`;
}

interface Opened {
  key: KmsKey;
  version: number;
  ctx: string;
  hex: string;
}

/** Acepta el blob en bruto o en base64 (como sale de `--query CiphertextBlob`). */
function parseBlob(a: Account, region: string, blobIn: string): Opened {
  let raw = blobIn.trim();
  if (!raw.startsWith(MAGIC)) {
    const d = b64decode(raw);
    if (d && d.startsWith(MAGIC)) raw = d;
  }
  if (!raw.startsWith(MAGIC)) throw new AwsError('InvalidCiphertextException', '', 400);
  const [, id, ver, ctx, hex] = raw.split('|');
  const st = kmsOf(a, region);
  const key = st.keys[id];
  if (!key) throw new AwsError('NotFoundException', `Key '${keyArn(a, region, id)}' does not exist`, 400);
  return { key, version: Number(ver), ctx, hex };
}

/** Abre un blob (comprobando el contexto de cifrado). */
function unseal(a: Account, o: Opened, enc: Record<string, string>): string {
  if (o.ctx !== ctxHash(enc)) throw new AwsError('InvalidCiphertextException', '', 400);
  return unxor(o.hex, secret(a, o.key, o.version));
}

// ───────────────────────── entrada y salida binaria ─────────────────────────

/** `--plaintext`: con `raw-in-base64-out` (o `fileb://`) es el texto; si no, base64. */
function inText(c: OpCtx, v: unknown, flag: string): string {
  const s = String(v);
  if (c.opts.binaryFormat === 'raw-in-base64-out') return s;
  const d = /\s/.test(s) ? null : b64decode(s);
  if (d === null) throw new UsageErr(`Invalid base64: "${s}"`, 252, false);
  void flag;
  return d;
}

/** La CLI entrega las estructuras de la sintaxis abreviada dentro de una lista: se unen en un solo objeto. */
const one = (v: unknown): Record<string, any> => (Array.isArray(v) ? Object.assign({}, ...v) : ((v ?? {}) as Record<string, any>));
const asCtx = (v: unknown): Record<string, string> => Object.fromEntries(Object.entries(one(v)).map(([k, x]) => [k, String(x)]));

const keyRes = (c: OpCtx) => {
  try {
    return findKey(c.acct, c.region, String(c.p.KeyId)).Arn;
  } catch {
    return '*';
  }
};

// ───────────────────────── claves ─────────────────────────

const SPECS = ['SYMMETRIC_DEFAULT', 'RSA_2048', 'RSA_3072', 'RSA_4096', 'ECC_NIST_P256', 'ECC_NIST_P384', 'ECC_SECG_P256K1', 'HMAC_224', 'HMAC_256', 'HMAC_384', 'HMAC_512'];

op('kms', 'create-key', 'policy:s description:s key-usage:s customer-master-key-spec:s key-spec:s origin:s bypass-policy-lockout-safety-check:b tags:f multi-region:b', 'Crea una clave de KMS (por defecto simétrica, para cifrar y descifrar) con su política.', { authz: (c) => [{ action: 'kms:CreateKey', resource: '*' }] }, (c) => {
  const spec = String(c.p.KeySpec ?? c.p.CustomerMasterKeySpec ?? 'SYMMETRIC_DEFAULT');
  if (!SPECS.includes(spec)) throw new AwsError('ValidationException', `1 validation error detected: Value '${spec}' at 'keySpec' failed to satisfy constraint: Member must satisfy enum value set: [${SPECS.join(', ')}]`, 400);
  const usage = String(c.p.KeyUsage ?? (spec.startsWith('HMAC') ? 'GENERATE_VERIFY_MAC' : 'ENCRYPT_DECRYPT')) as KmsKey['Usage'];
  if (!['ENCRYPT_DECRYPT', 'SIGN_VERIFY', 'GENERATE_VERIFY_MAC'].includes(usage)) throw new AwsError('ValidationException', `Value '${usage}' at 'keyUsage' failed to satisfy constraint`, 400);
  if (spec === 'SYMMETRIC_DEFAULT' && usage !== 'ENCRYPT_DECRYPT') throw new AwsError('ValidationException', `KeyUsage ${usage} is incompatible with key spec SYMMETRIC_DEFAULT.`, 400);
  if (spec.startsWith('HMAC') && usage !== 'GENERATE_VERIFY_MAC') throw new AwsError('ValidationException', `KeyUsage ${usage} is incompatible with key spec ${spec}.`, 400);
  let policy = defaultKeyPolicy(c.acct);
  if (c.p.Policy !== undefined) {
    let doc: PolicyDoc;
    try {
      doc = JSON.parse(String(c.p.Policy)) as PolicyDoc;
    } catch {
      throw new AwsError('MalformedPolicyDocumentException', 'Policy contains a statement with one or more invalid principals or is not valid JSON.', 400);
    }
    const bad = validatePolicy(doc, 'resource');
    if (bad) throw new AwsError('MalformedPolicyDocumentException', bad, 400);
    policy = doc;
  }
  const id = uuid(c.acct, 'kms');
  const key: KmsKey = { KeyId: id, Arn: keyArn(c.acct, c.region, id), Description: c.p.Description ?? '', Usage: usage, Spec: spec, State: 'Enabled', manager: 'CUSTOMER', created: c.acct.clock, policy, grants: [], rotation: { enabled: false, days: 365, versions: 1 }, Tags: toArr<{ TagKey: string; TagValue: string }>(c.p.Tags).map((t) => ({ Key: t.TagKey, Value: t.TagValue })), multiRegion: c.p.MultiRegion === true };
  // sin la opción de saltarse la comprobación, la política tiene que dejar a quien la crea administrar la clave
  if (c.p.Policy !== undefined && !c.p.BypassPolicyLockoutSafetyCheck) lockoutCheck(c, key, policy);
  kmsOf(c.acct, c.region).keys[id] = key;
  return { KeyMetadata: view(c.acct, key) };
});

/** Una política que deja sin acceso a administrar la clave a quien la escribe se rechaza (salvo que se pida lo contrario). */
function lockoutCheck(c: OpCtx, key: KmsKey, policy: PolicyDoc): void {
  const probe = { ...key, policy };
  try {
    kmsAuthorize(c, probe, 'kms:PutKeyPolicy');
  } catch {
    throw new AwsError('MalformedPolicyDocumentException', 'The new key policy will not allow you to update the key policy in the future.', 400);
  }
}

/** Resuelve el parámetro `--key-id` y comprueba el permiso. */
function keyFor(c: OpCtx, action: string, o: { enc?: Record<string, string>; state?: boolean } = {}): KmsKey {
  const key = findKey(c.acct, c.region, String(c.p.KeyId));
  kmsAuthorize(c, key, action, { enc: o.enc });
  if (o.state !== false) usable(key);
  return key;
}

op('kms', 'describe-key', 'key-id:s! grant-tokens:l', 'Los datos de una clave: estado, uso, administrador (cliente o AWS) y fechas.', { authz: false }, (c) => {
  const key = findKey(c.acct, c.region, String(c.p.KeyId));
  kmsAuthorize(c, key, 'kms:DescribeKey');
  return { KeyMetadata: view(c.acct, key) };
});

op('kms', 'list-keys', 'limit:i marker:s', 'Lista las claves de la región (id y ARN).', { paginate: 'Keys', res: () => '*' }, (c) => ({ Keys: Object.values(kmsOf(c.acct, c.region).keys).map((k) => ({ KeyId: k.KeyId, KeyArn: k.Arn })) }));

op('kms', 'update-key-description', 'key-id:s! description:s!', 'Cambia la descripción de una clave.', { authz: false }, (c) => {
  keyFor(c, 'kms:UpdateKeyDescription', { state: false }).Description = String(c.p.Description);
  return {};
});

op('kms', 'enable-key', 'key-id:s!', 'Vuelve a habilitar una clave deshabilitada.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:EnableKey', { state: false });
  if (k.State === 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${k.Arn} is pending deletion.`, 400);
  k.State = 'Enabled';
  return {};
});

op('kms', 'disable-key', 'key-id:s!', 'Deshabilita una clave: no se puede usar para cifrar ni descifrar hasta que se vuelva a habilitar.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:DisableKey', { state: false });
  if (k.State === 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${k.Arn} is pending deletion.`, 400);
  if (k.manager === 'AWS') throw new AwsError('UnsupportedOperationException', `${k.Arn} is an AWS managed key and can't be disabled.`, 400);
  k.State = 'Disabled';
  return {};
});

op('kms', 'schedule-key-deletion', 'key-id:s! pending-window-in-days:i', 'Programa el borrado de una clave (entre 7 y 30 días de espera). Todo lo cifrado con ella dejará de poder abrirse.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:ScheduleKeyDeletion', { state: false });
  const days = c.p.PendingWindowInDays ?? 30;
  if (days < 7 || days > 30) throw new AwsError('ValidationException', `1 validation error detected: Value '${days}' at 'pendingWindowInDays' failed to satisfy constraint: Member must have value greater than or equal to 7 and less than or equal to 30`, 400);
  if (k.manager === 'AWS') throw new AwsError('UnsupportedOperationException', `${k.Arn} is an AWS managed key and can't be deleted.`, 400);
  if (k.State === 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${k.Arn} is pending deletion.`, 400);
  k.State = 'PendingDeletion';
  k.deletionWindow = days;
  k.deletion = c.acct.clock + days * DAY;
  return { KeyId: k.Arn, DeletionDate: iso(k.deletion), KeyState: k.State, PendingWindowInDays: days };
});

op('kms', 'cancel-key-deletion', 'key-id:s!', 'Cancela el borrado programado (la clave queda deshabilitada).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:CancelKeyDeletion', { state: false });
  if (k.State !== 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${k.Arn} is not pending deletion.`, 400);
  k.State = 'Disabled';
  k.deletion = undefined;
  k.deletionWindow = undefined;
  return { KeyId: k.Arn };
});

// ───────────────────────── alias ─────────────────────────

const aliasName = (n: string): string => {
  if (!n.startsWith('alias/')) throw new AwsError('ValidationException', `Alias must start with the prefix "alias/". Please see https://docs.aws.amazon.com/kms/latest/developerguide/kms-alias.html`, 400);
  if (n.startsWith('alias/aws/')) throw new AwsError('NotFoundException', `Alias names cannot begin with alias/aws/. Alias names that begin with "alias/aws/" are reserved for AWS managed keys.`, 400);
  if (!/^alias\/[a-zA-Z0-9/_-]{1,250}$/.test(n)) throw new AwsError('ValidationException', `1 validation error detected: Value '${n}' at 'aliasName' failed to satisfy constraint: Member must satisfy regular expression pattern: ^alias/[a-zA-Z0-9/_-]+$`, 400);
  return n;
};

op('kms', 'create-alias', 'alias-name:s! target-key-id:s!', 'Pone un nombre fácil (`alias/mi-clave`) a una clave. Los alias se pueden mover de una clave a otra.', { authz: (c) => [{ action: 'kms:CreateAlias', resource: aliasArn(c.acct, c.region, String(c.p.AliasName)) }, { action: 'kms:CreateAlias', resource: keyRes({ ...c, p: { KeyId: c.p.TargetKeyId } } as OpCtx) }] }, (c) => {
  const n = aliasName(String(c.p.AliasName));
  const st = kmsOf(c.acct, c.region);
  if (st.aliases[n]) throw new AwsError('AlreadyExistsException', `An alias with the name ${aliasArn(c.acct, c.region, n)} already exists`, 400);
  const k = findKey(c.acct, c.region, String(c.p.TargetKeyId));
  if (k.State === 'PendingDeletion') throw new AwsError('KMSInvalidStateException', `${k.Arn} is pending deletion.`, 400);
  st.aliases[n] = { target: k.KeyId, created: c.acct.clock };
  return {};
});

op('kms', 'update-alias', 'alias-name:s! target-key-id:s!', 'Apunta un alias a otra clave (así se cambia de clave sin tocar las aplicaciones).', { res: (c) => aliasArn(c.acct, c.region, String(c.p.AliasName)) }, (c) => {
  const n = aliasName(String(c.p.AliasName));
  const st = kmsOf(c.acct, c.region);
  if (!st.aliases[n]) throw new AwsError('NotFoundException', `Alias ${aliasArn(c.acct, c.region, n)} is not found.`, 400);
  st.aliases[n].target = findKey(c.acct, c.region, String(c.p.TargetKeyId)).KeyId;
  return {};
});

op('kms', 'delete-alias', 'alias-name:s!', 'Borra un alias (la clave no se toca).', { res: (c) => aliasArn(c.acct, c.region, String(c.p.AliasName)) }, (c) => {
  const n = aliasName(String(c.p.AliasName));
  const st = kmsOf(c.acct, c.region);
  if (!st.aliases[n]) throw new AwsError('NotFoundException', `Alias ${aliasArn(c.acct, c.region, n)} is not found.`, 400);
  delete st.aliases[n];
  return {};
});

op('kms', 'list-aliases', 'key-id:s limit:i marker:s', 'Lista los alias (los de las claves administradas por AWS empiezan por `alias/aws/`).', { paginate: 'Aliases', res: () => '*' }, (c) => {
  const st = kmsOf(c.acct, c.region);
  const want = c.p.KeyId ? findKey(c.acct, c.region, String(c.p.KeyId)).KeyId : undefined;
  return { Aliases: Object.entries(st.aliases).filter(([, v]) => !want || v.target === want).map(([n, v]) => ({ AliasName: n, AliasArn: aliasArn(c.acct, c.region, n), TargetKeyId: v.target, CreationDate: iso(v.created) })) };
});

// ───────────────────────── política de la clave ─────────────────────────

op('kms', 'get-key-policy', 'key-id:s! policy-name:s', 'Lee la política de la clave (el nombre es siempre `default`).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:GetKeyPolicy', { state: false });
  return { Policy: JSON.stringify(k.policy, null, 2), PolicyName: 'default' };
});

op('kms', 'list-key-policies', 'key-id:s!', 'Lista los nombres de política de la clave (solo existe `default`).', { authz: false }, (c) => {
  keyFor(c, 'kms:ListKeyPolicies', { state: false });
  return { PolicyNames: ['default'], Truncated: false };
});

op('kms', 'put-key-policy', 'key-id:s! policy-name:s! policy:s! bypass-policy-lockout-safety-check:b', 'Cambia la política de la clave. Se rechaza si dejaría a quien la cambia sin poder administrarla.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:PutKeyPolicy', { state: false });
  if (c.p.PolicyName !== 'default') throw new AwsError('InvalidParameterException', "The only valid policy name is 'default'.", 400);
  let doc: PolicyDoc;
  try {
    doc = JSON.parse(String(c.p.Policy)) as PolicyDoc;
  } catch {
    throw new AwsError('MalformedPolicyDocumentException', 'Policy contains a statement with one or more invalid principals or is not valid JSON.', 400);
  }
  const bad = validatePolicy(doc, 'resource');
  if (bad) throw new AwsError('MalformedPolicyDocumentException', bad, 400);
  if (!c.p.BypassPolicyLockoutSafetyCheck) lockoutCheck(c, k, doc);
  k.policy = doc;
  return {};
});

// ───────────────────────── etiquetas ─────────────────────────

op('kms', 'tag-resource', 'key-id:s! tags:f!', 'Etiqueta una clave (`TagKey=…,TagValue=…`).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:TagResource', { state: false });
  for (const t of toArr<{ TagKey: string; TagValue: string }>(c.p.Tags)) {
    k.Tags = k.Tags.filter((x) => x.Key !== t.TagKey);
    k.Tags.push({ Key: t.TagKey, Value: t.TagValue });
  }
  return {};
});

op('kms', 'untag-resource', 'key-id:s! tag-keys:l!', 'Quita etiquetas de una clave.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:UntagResource', { state: false });
  const del = new Set(toArr<string>(c.p.TagKeys));
  k.Tags = k.Tags.filter((t: Tag) => !del.has(t.Key));
  return {};
});

op('kms', 'list-resource-tags', 'key-id:s! limit:i marker:s', 'Lista las etiquetas de una clave.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:ListResourceTags', { state: false });
  return { Tags: k.Tags.map((t) => ({ TagKey: t.Key, TagValue: t.Value })), Truncated: false };
});

// ───────────────────────── rotación ─────────────────────────

function rotationOk(k: KmsKey): void {
  if (k.Spec !== 'SYMMETRIC_DEFAULT') throw new AwsError('UnsupportedOperationException', `${k.Arn} key spec ${k.Spec} is not supported for rotation. Only symmetric encryption keys can be rotated.`, 400);
  if (k.manager === 'AWS') throw new AwsError('UnsupportedOperationException', `${k.Arn} is an AWS managed key: AWS rotates it for you.`, 400);
}

op('kms', 'enable-key-rotation', 'key-id:s! rotation-period-in-days:i', 'Activa la rotación automática del material de la clave (cada año por defecto, o entre 90 y 2560 días). Lo ya cifrado se sigue abriendo.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:EnableKeyRotation');
  rotationOk(k);
  const days = c.p.RotationPeriodInDays ?? 365;
  if (days < 90 || days > 2560) throw new AwsError('InvalidArnException', 'RotationPeriodInDays must be between 90 and 2560.', 400);
  k.rotation.enabled = true;
  k.rotation.days = days;
  k.rotation.last = k.rotation.last ?? c.acct.clock;
  k.rotation.next = (k.rotation.last ?? c.acct.clock) + days * DAY;
  return {};
});

op('kms', 'disable-key-rotation', 'key-id:s!', 'Desactiva la rotación automática.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:DisableKeyRotation');
  rotationOk(k);
  k.rotation.enabled = false;
  k.rotation.next = undefined;
  return {};
});

op('kms', 'get-key-rotation-status', 'key-id:s!', 'Dice si la rotación automática está activa, cada cuántos días y cuándo toca la próxima.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:GetKeyRotationStatus', { state: false });
  if (k.Spec !== 'SYMMETRIC_DEFAULT') throw new AwsError('UnsupportedOperationException', `${k.Arn} key spec ${k.Spec} is not supported for rotation.`, 400);
  return { KeyRotationEnabled: k.rotation.enabled, KeyId: k.KeyId, ...(k.rotation.enabled ? { RotationPeriodInDays: k.rotation.days, NextRotationDate: iso(k.rotation.next ?? 0) } : {}), ...(k.rotation.onDemand ? { OnDemandRotationStartDate: iso(k.rotation.onDemand) } : {}) };
});

op('kms', 'rotate-key-on-demand', 'key-id:s!', 'Rota ahora el material de la clave (hasta 10 veces).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:RotateKeyOnDemand');
  rotationOk(k);
  if (k.rotation.versions >= 11) throw new AwsError('LimitExceededException', 'The on-demand rotation limit has been reached for this KMS key.', 400);
  k.rotation.versions++;
  k.rotation.onDemand = c.acct.clock;
  k.rotation.last = c.acct.clock;
  if (k.rotation.enabled) k.rotation.next = c.acct.clock + k.rotation.days * DAY;
  return { KeyId: k.Arn };
});

// ───────────────────────── cifrar y descifrar ─────────────────────────

const b64 = (s: string) => b64encode(s);

op('kms', 'encrypt', 'key-id:s! plaintext:s! encryption-context:f grant-tokens:l encryption-algorithm:s', 'Cifra hasta 4 KB con una clave de KMS. Con un contexto de cifrado, solo se abre con ese mismo contexto.', { authz: false }, (c) => {
  const enc = asCtx(c.p.EncryptionContext);
  const k = keyFor(c, 'kms:Encrypt', { enc });
  if (k.Usage !== 'ENCRYPT_DECRYPT') throw new AwsError('InvalidKeyUsageException', `You can't perform this operation on a key with KeyUsage ${k.Usage}.`, 400);
  const plain = inText(c, c.p.Plaintext, 'plaintext');
  if (utf8Bytes(plain).length > 4096) throw new AwsError('ValidationException', "1 validation error detected: Value at 'plaintext' failed to satisfy constraint: Member must have length less than or equal to 4096", 400);
  return { CiphertextBlob: b64(kmsSeal(c.acct, k, plain, enc)), KeyId: k.Arn, EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' };
});

op('kms', 'decrypt', 'ciphertext-blob:s! encryption-context:f grant-tokens:l key-id:s encryption-algorithm:s', 'Descifra un texto cifrado con KMS (no hace falta decir con qué clave en las simétricas: el texto lo lleva dentro).', { authz: false }, (c) => {
  const o = parseBlob(c.acct, c.region, String(c.p.CiphertextBlob));
  if (c.p.KeyId) {
    const want = findKey(c.acct, c.region, String(c.p.KeyId));
    if (want.KeyId !== o.key.KeyId) throw new AwsError('IncorrectKeyException', 'The key ID in the request does not identify a CMK that can perform this operation.', 400);
  }
  const enc = asCtx(c.p.EncryptionContext);
  kmsAuthorize(c, o.key, 'kms:Decrypt', { enc });
  usable(o.key);
  return { KeyId: o.key.Arn, Plaintext: b64(unseal(c.acct, o, enc)), EncryptionAlgorithm: 'SYMMETRIC_DEFAULT' };
});

op('kms', 're-encrypt', 'ciphertext-blob:s! source-encryption-context:f source-key-id:s destination-key-id:s! destination-encryption-context:f grant-tokens:l', 'Pasa un texto cifrado de una clave a otra sin que el texto en claro salga de KMS.', { authz: false }, (c) => {
  const o = parseBlob(c.acct, c.region, String(c.p.CiphertextBlob));
  const src = asCtx(c.p.SourceEncryptionContext);
  const dst = asCtx(c.p.DestinationEncryptionContext);
  kmsAuthorize(c, o.key, 'kms:ReEncryptFrom', { enc: src });
  usable(o.key);
  const plain = unseal(c.acct, o, src);
  const to = findKey(c.acct, c.region, String(c.p.DestinationKeyId));
  kmsAuthorize(c, to, 'kms:ReEncryptTo', { enc: dst });
  usable(to);
  return { CiphertextBlob: b64(kmsSeal(c.acct, to, plain, dst)), SourceKeyId: o.key.Arn, KeyId: to.Arn, SourceEncryptionAlgorithm: 'SYMMETRIC_DEFAULT', DestinationEncryptionAlgorithm: 'SYMMETRIC_DEFAULT' };
});

/** Bytes aleatorios (simulados): cadena hexadecimal. */
const randomBytes = (a: Account, kind: string, n: number): string => newId(a, kind, '', n, 'hex').slice(0, n);

function dataKey(c: OpCtx, withPlain: boolean) {
  const enc = asCtx(c.p.EncryptionContext);
  const k = keyFor(c, withPlain ? 'kms:GenerateDataKey' : 'kms:GenerateDataKeyWithoutPlaintext', { enc });
  if (k.Usage !== 'ENCRYPT_DECRYPT') throw new AwsError('InvalidKeyUsageException', `You can't perform this operation on a key with KeyUsage ${k.Usage}.`, 400);
  let n = c.p.NumberOfBytes as number | undefined;
  if (c.p.KeySpec) {
    if (n !== undefined) throw new AwsError('ValidationException', 'KeySpec and NumberOfBytes cannot be specified together.', 400);
    if (c.p.KeySpec === 'AES_256') n = 32;
    else if (c.p.KeySpec === 'AES_128') n = 16;
    else throw new AwsError('ValidationException', `1 validation error detected: Value '${c.p.KeySpec}' at 'keySpec' failed to satisfy constraint: Member must satisfy enum value set: [AES_256, AES_128]`, 400);
  }
  if (n === undefined) throw new AwsError('ValidationException', 'Either KeySpec or NumberOfBytes must be specified.', 400);
  if (n < 1 || n > 1024) throw new AwsError('ValidationException', "1 validation error detected: Value at 'numberOfBytes' failed to satisfy constraint: Member must have value between 1 and 1024", 400);
  const plain = randomBytes(c.acct, 'kmsdk', n);
  c.acct.clock += 0;
  return { plain, k, enc };
}

op('kms', 'generate-data-key', 'key-id:s! encryption-context:f number-of-bytes:i key-spec:s grant-tokens:l', 'Cifrado de sobre: devuelve una clave de datos en claro (para cifrar tus datos y tirarla) y la misma cifrada con la clave de KMS (para guardarla junto a ellos).', { authz: false }, (c) => {
  const { plain, k, enc } = dataKey(c, true);
  return { CiphertextBlob: b64(kmsSeal(c.acct, k, plain, enc)), Plaintext: b64(plain), KeyId: k.Arn };
});

op('kms', 'generate-data-key-without-plaintext', 'key-id:s! encryption-context:f key-spec:s number-of-bytes:i grant-tokens:l', 'Lo mismo, pero solo la clave de datos cifrada (para descifrarla más tarde, cuando haga falta).', { authz: false }, (c) => {
  const { plain, k, enc } = dataKey(c, false);
  return { CiphertextBlob: b64(kmsSeal(c.acct, k, plain, enc)), KeyId: k.Arn };
});

op('kms', 'generate-random', 'number-of-bytes:i', 'Genera bytes aleatorios (en base64).', { res: () => '*' }, (c) => {
  const n = (c.p.NumberOfBytes as number | undefined) ?? 32;
  if (n < 1 || n > 1024) throw new AwsError('ValidationException', "1 validation error detected: Value at 'numberOfBytes' failed to satisfy constraint: Member must have value between 1 and 1024", 400);
  return { Plaintext: b64(randomBytes(c.acct, 'kmsrand', n)) };
});

// ───────────────────────── firmas ─────────────────────────

const sigOf = (a: Account, k: KmsKey, msg: string, alg: string) => sha256(`${secret(a, k, 1)}:${alg}:${msg}`);

op('kms', 'sign', 'key-id:s! message:s! message-type:s grant-tokens:l signing-algorithm:s!', 'Firma un mensaje con una clave asimétrica (la clave privada nunca sale de KMS).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:Sign');
  if (k.Usage !== 'SIGN_VERIFY') throw new AwsError('InvalidKeyUsageException', `You can't perform this operation on a key with KeyUsage ${k.Usage}.`, 400);
  const msg = inText(c, c.p.Message, 'message');
  return { KeyId: k.Arn, Signature: b64(sigOf(c.acct, k, msg, String(c.p.SigningAlgorithm))), SigningAlgorithm: c.p.SigningAlgorithm };
});

op('kms', 'verify', 'key-id:s! message:s! message-type:s signature:s! signing-algorithm:s! grant-tokens:l', 'Comprueba una firma (si no es válida, falla con `KMSInvalidSignatureException`).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:Verify');
  const msg = inText(c, c.p.Message, 'message');
  const good = b64(sigOf(c.acct, k, msg, String(c.p.SigningAlgorithm)));
  if (String(c.p.Signature).trim() !== good) throw new AwsError('KMSInvalidSignatureException', 'The signature is not valid for the specified message and key.', 400);
  return { KeyId: k.Arn, SignatureValid: true, SigningAlgorithm: c.p.SigningAlgorithm };
});

// ───────────────────────── concesiones (grants) ─────────────────────────

op('kms', 'create-grant', 'key-id:s! grantee-principal:s! retiring-principal:s operations:l! constraints:f grant-tokens:l name:s', 'Da permiso temporal y concreto sobre una clave a una identidad (o a un servicio), sin tocar su política.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:CreateGrant');
  const ops = toArr<string>(c.p.Operations);
  for (const o of ops) if (!GRANT_OPS.includes(o)) throw new AwsError('ValidationException', `1 validation error detected: Value '[${o}]' at 'operations' failed to satisfy constraint: Member must satisfy enum value set`, 400);
  const id = [64].map((n) => newId(c.acct, 'kmsgrant', '', n, 'hex'))[0];
  const g: KmsGrant = { GrantId: id, Name: c.p.Name, GranteePrincipal: String(c.p.GranteePrincipal), RetiringPrincipal: c.p.RetiringPrincipal, IssuingAccount: `arn:aws:iam::${c.acct.id}:root`, Operations: ops, Constraints: c.p.Constraints ? { EncryptionContextSubset: one(c.p.Constraints).EncryptionContextSubset ? asCtx(one(c.p.Constraints).EncryptionContextSubset) : undefined, EncryptionContextEquals: one(c.p.Constraints).EncryptionContextEquals ? asCtx(one(c.p.Constraints).EncryptionContextEquals) : undefined } : undefined, created: c.acct.clock };
  if (g.Name && k.grants.some((x) => x.Name === g.Name && x.GranteePrincipal === g.GranteePrincipal)) return { GrantToken: `${g.Name}-token`, GrantId: k.grants.find((x) => x.Name === g.Name)!.GrantId };
  k.grants.push(g);
  return { GrantToken: `AQpA${id.slice(0, 40)}`, GrantId: id };
});

const grantView = (k: KmsKey, g: KmsGrant) => ({ KeyId: k.Arn, GrantId: g.GrantId, ...(g.Name ? { Name: g.Name } : {}), CreationDate: iso(g.created), GranteePrincipal: g.GranteePrincipal, ...(g.RetiringPrincipal ? { RetiringPrincipal: g.RetiringPrincipal } : {}), IssuingAccount: g.IssuingAccount, Operations: g.Operations, ...(g.Constraints ? { Constraints: g.Constraints } : {}) });

op('kms', 'list-grants', 'key-id:s! grant-id:s grantee-principal:s limit:i marker:s', 'Lista las concesiones de una clave.', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:ListGrants', { state: false });
  return { Grants: k.grants.filter((g) => (!c.p.GrantId || g.GrantId === c.p.GrantId) && (!c.p.GranteePrincipal || g.GranteePrincipal === c.p.GranteePrincipal)).map((g) => grantView(k, g)), Truncated: false };
});

op('kms', 'list-retirable-grants', 'retiring-principal:s! limit:i marker:s', 'Lista las concesiones que una identidad puede retirar.', { res: () => '*' }, (c) => {
  const out: Record<string, unknown>[] = [];
  for (const k of Object.values(kmsOf(c.acct, c.region).keys)) for (const g of k.grants) if (g.RetiringPrincipal === c.p.RetiringPrincipal) out.push(grantView(k, g));
  return { Grants: out, Truncated: false };
});

op('kms', 'revoke-grant', 'key-id:s! grant-id:s!', 'Revoca una concesión (la política de la clave puede hacerlo siempre).', { authz: false }, (c) => {
  const k = keyFor(c, 'kms:RevokeGrant', { state: false });
  if (!k.grants.some((g) => g.GrantId === c.p.GrantId)) throw new AwsError('InvalidGrantIdException', `Grant ID ${c.p.GrantId} not found`, 400);
  k.grants = k.grants.filter((g) => g.GrantId !== c.p.GrantId);
  return {};
});

op('kms', 'retire-grant', 'grant-token:s key-id:s grant-id:s', 'Retira una concesión (la hace quien la recibió o su «retiring principal»).', { res: () => '*' }, (c) => {
  const keys = c.p.KeyId ? [findKey(c.acct, c.region, String(c.p.KeyId))] : Object.values(kmsOf(c.acct, c.region).keys);
  for (const k of keys) {
    const g = k.grants.find((x) => (c.p.GrantId && x.GrantId === c.p.GrantId) || (c.p.GrantToken && `AQpA${x.GrantId.slice(0, 40)}` === c.p.GrantToken));
    if (g) {
      k.grants = k.grants.filter((x) => x !== g);
      return {};
    }
  }
  throw new AwsError('InvalidGrantTokenException', 'The grant token is not valid or the grant was not found.', 400);
});

// ───────────────────────── tiempo: rotación y borrado ─────────────────────────

tickers.push((a) => {
  for (const r of Object.values(a.regions)) {
    const st = r.kms;
    if (!st) continue;
    for (const k of Object.values(st.keys)) {
      if (k.State === 'PendingDeletion' && k.deletion && a.clock >= k.deletion) {
        delete st.keys[k.KeyId];
        for (const [n, al] of Object.entries(st.aliases)) if (al.target === k.KeyId) delete st.aliases[n];
        continue;
      }
      // rotación automática: un material nuevo cada periodo (los textos cifrados antes se siguen abriendo)
      if (k.rotation.enabled && k.State === 'Enabled' && k.rotation.next && a.clock >= k.rotation.next) {
        const due = Math.floor((a.clock - k.rotation.next) / (k.rotation.days * DAY)) + 1;
        k.rotation.versions += due;
        k.rotation.last = k.rotation.next + (due - 1) * k.rotation.days * DAY;
        k.rotation.next = k.rotation.last + k.rotation.days * DAY;
      }
    }
  }
});

// ───────────────────────── enganches con otros servicios ─────────────────────────

kmsHooks.resolve = (a, region, keyId) => {
  try {
    const k = findKey(a, region, keyId);
    return k.State === 'Enabled' ? k.Arn : null;
  } catch {
    return null;
  }
};

kmsHooks.encrypt = (a, region, keyId, plain, context) => kmsSeal(a, findKey(a, region, keyId), plain, context ?? {});

kmsHooks.requireEncrypt = (c, keyId, context) => {
  const k = findKey(c.acct, c.region, keyId);
  kmsAuthorize(c, k, c.service === 'ssm' ? 'kms:Encrypt' : 'kms:GenerateDataKey', { enc: context, via: `${c.service === 's3api' || c.service === 's3' ? 's3' : c.service === 'secretsmanager' ? 'secretsmanager' : c.service}.${c.region}.amazonaws.com` });
  usable(k);
};

kmsHooks.requireDecrypt = (c, keyId, context) => {
  const k = findKey(c.acct, c.region, keyId);
  kmsAuthorize(c, k, 'kms:Decrypt', { enc: context, via: `${c.service === 's3api' || c.service === 's3' ? 's3' : c.service}.${c.region}.amazonaws.com` });
  usable(k);
};

/** S3 devuelve los errores de KMS con el prefijo `KMS.` (y `AccessDenied`). */
function s3Fail(e: unknown): never {
  if (e instanceof AwsError) {
    const map: Record<string, string> = { AccessDeniedException: 'AccessDenied', DisabledException: 'KMS.DisabledException', NotFoundException: 'KMS.NotFoundException', KMSInvalidStateException: 'KMS.KMSInvalidStateException' };
    throw new AwsError(map[e.code] ?? e.code, e.message, e.code === 'AccessDeniedException' ? 403 : 400);
  }
  throw e;
}

kmsHooks.s3Write = (c, keyId, bucketRegion, objectArn) => {
  try {
    if (!keyId) return awsManagedKey(c.acct, bucketRegion, 's3').Arn;
    const k = findKey(c.acct, bucketRegion, keyId);
    kmsAuthorize(c, k, 'kms:GenerateDataKey', { enc: { 'aws:s3:arn': objectArn }, via: `s3.${bucketRegion}.amazonaws.com` });
    usable(k);
    return k.Arn;
  } catch (e) {
    return s3Fail(e);
  }
};

kmsHooks.s3Read = (c, keyArn, objectArn) => {
  try {
    const region = keyArn.split(':')[3] ?? c.region;
    const k = findKey(c.acct, region, keyArn);
    kmsAuthorize(c, k, 'kms:Decrypt', { enc: { 'aws:s3:arn': objectArn }, via: `s3.${region}.amazonaws.com` });
    usable(k);
  } catch (e) {
    s3Fail(e);
  }
};
