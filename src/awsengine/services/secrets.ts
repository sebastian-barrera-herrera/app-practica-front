/** AWS Secrets Manager: guardar credenciales fuera del código, con versiones y borrado con ventana de recuperación. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Secret, Tag } from '../types';
import { mergeTags, mkArn, stableId } from '../util';

const DAY = 86400000;

export const secretsOf = (a: Account, region: string): Record<string, Secret> => (regional(a, region).secrets ??= {});

const arnFor = (a: Account, region: string, name: string) => mkArn('secretsmanager', region, a.id, `secret:${name}-${stableId(`secret:${a.id}:${name}`, '', 6)}`);

/** Busca un secreto por nombre o por ARN (completo o sin el sufijo aleatorio). */
export function findSecret(a: Account, region: string, id: string): Secret | undefined {
  const all = Object.values(secretsOf(a, region));
  return all.find((s) => s.Name === id || s.ARN === id || (id.startsWith('arn:') && s.ARN.startsWith(id + '-')));
}

const notFound = () => new AwsError('ResourceNotFoundException', "Secrets Manager can't find the specified secret.", 400);
const resourceOf = (c: OpCtx) => findSecret(c.acct, c.region, String(c.p.SecretId))?.ARN ?? '*';

const current = (s: Secret) => s.versions.find((v) => v.stages.includes('AWSCURRENT'));

function addVersion(a: Account, s: Secret, value: string, binary: boolean, token?: string): string {
  const id = token ?? [8, 4, 4, 4, 12].map((n, k) => stableId(`sv:${s.ARN}:${s.versions.length}:${a.clock}:${k}`, '', n)).join('-').toLowerCase();
  for (const v of s.versions) {
    if (v.stages.includes('AWSPREVIOUS')) v.stages = v.stages.filter((x) => x !== 'AWSPREVIOUS');
    if (v.stages.includes('AWSCURRENT')) v.stages = ['AWSPREVIOUS'];
  }
  s.versions.push({ id, value, binary, created: a.clock, stages: ['AWSCURRENT'] });
  // solo se conservan las versiones con alguna etiqueta
  s.versions = s.versions.filter((v) => v.stages.length);
  return id;
}

const notDeleted = (s: Secret) => {
  if (s.deletedAt !== undefined) throw new AwsError('InvalidRequestException', "You can't perform this operation on the secret because it was marked for deletion.", 400);
  return s;
};

op('secretsmanager', 'create-secret', 'name:s! description:s secret-string:s secret-binary:s kms-key-id:s tags:t client-request-token:s', 'Guarda un secreto (normalmente un JSON con usuario y contraseña) cifrado en reposo y versionado.', { res: (c) => arnFor(c.acct, c.region, c.p.Name) }, (c) => {
  const name = String(c.p.Name);
  if (!/^[A-Za-z0-9/_+=.@-]{1,512}$/.test(name)) throw new AwsError('ValidationException', `1 validation error detected: Value '${name}' at 'name' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\p{L}\\p{N}/_+=.@-]+`, 400);
  if (c.p.SecretString === undefined && c.p.SecretBinary === undefined) throw new AwsError('InvalidParameterException', 'You must provide either SecretString or SecretBinary.', 400);
  const all = secretsOf(c.acct, c.region);
  if (all[name]) throw new AwsError('ResourceExistsException', `The operation failed because the secret ${name} already exists.`, 400);
  const s: Secret = { Name: name, ARN: arnFor(c.acct, c.region, name), Description: c.p.Description ?? '', created: c.acct.clock, versions: [], Tags: (c.p.Tags as Tag[]) ?? [] };
  const v = addVersion(c.acct, s, c.p.SecretString ?? c.p.SecretBinary, c.p.SecretString === undefined, c.p.ClientRequestToken);
  all[name] = s;
  return { ARN: s.ARN, Name: s.Name, VersionId: v };
});

op('secretsmanager', 'get-secret-value', 'secret-id:s! version-id:s version-stage:s', 'Lee el valor de un secreto (por defecto la versión `AWSCURRENT`). Necesita `secretsmanager:GetSecretValue` sobre ese secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  const v = c.p.VersionId ? s.versions.find((x) => x.id === c.p.VersionId) : s.versions.find((x) => x.stages.includes(c.p.VersionStage ?? 'AWSCURRENT'));
  if (!v) throw new AwsError('ResourceNotFoundException', "Secrets Manager can't find the specified secret value for VersionId/VersionStage.", 400);
  return { ARN: s.ARN, Name: s.Name, VersionId: v.id, ...(v.binary ? { SecretBinary: v.value } : { SecretString: v.value }), VersionStages: v.stages, CreatedDate: v.created / 1000 };
});

op('secretsmanager', 'put-secret-value', 'secret-id:s! secret-string:s secret-binary:s client-request-token:s', 'Guarda una versión nueva del secreto (la anterior pasa a `AWSPREVIOUS`).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  if (c.p.SecretString === undefined && c.p.SecretBinary === undefined) throw new AwsError('InvalidParameterException', 'You must provide either SecretString or SecretBinary.', 400);
  const v = addVersion(c.acct, s, c.p.SecretString ?? c.p.SecretBinary, c.p.SecretString === undefined, c.p.ClientRequestToken);
  return { ARN: s.ARN, Name: s.Name, VersionId: v, VersionStages: ['AWSCURRENT'] };
});

op('secretsmanager', 'update-secret', 'secret-id:s! description:s secret-string:s kms-key-id:s', 'Cambia la descripción o el valor del secreto (crea una versión nueva).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  if (c.p.Description !== undefined) s.Description = c.p.Description;
  const v = c.p.SecretString !== undefined ? addVersion(c.acct, s, c.p.SecretString, false) : current(s)?.id;
  return { ARN: s.ARN, Name: s.Name, VersionId: v };
});

const describe = (s: Secret) => ({
  ARN: s.ARN,
  Name: s.Name,
  ...(s.Description ? { Description: s.Description } : {}),
  LastChangedDate: (current(s)?.created ?? s.created) / 1000,
  CreatedDate: s.created / 1000,
  ...(s.Tags.length ? { Tags: s.Tags } : {}),
  VersionIdsToStages: Object.fromEntries(s.versions.map((v) => [v.id, v.stages])),
  ...(s.deletedAt !== undefined ? { DeletedDate: s.deletedAt / 1000 } : {}),
});

op('secretsmanager', 'describe-secret', 'secret-id:s!', 'Datos del secreto (sin su valor): versiones, etiquetas y fecha de borrado si está programado.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  return describe(s);
});

op('secretsmanager', 'list-secrets', 'max-results:i', 'Lista los secretos de la región.', { res: () => '*', paginate: 'SecretList' }, (c) => ({ SecretList: Object.values(secretsOf(c.acct, c.region)).map(describe) }));

op('secretsmanager', 'delete-secret', 'secret-id:s! recovery-window-in-days:i force-delete-without-recovery:b', 'Programa el borrado del secreto: se puede recuperar durante 7–30 días (30 por defecto) salvo que fuerces el borrado inmediato.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  if (c.p.ForceDeleteWithoutRecovery && c.p.RecoveryWindowInDays !== undefined) throw new AwsError('InvalidParameterException', 'You can’t use ForceDeleteWithoutRecovery in conjunction with RecoveryWindowInDays.', 400);
  const days = c.p.RecoveryWindowInDays ?? 30;
  if (!c.p.ForceDeleteWithoutRecovery && (days < 7 || days > 30)) throw new AwsError('InvalidParameterException', 'RecoveryWindowInDays value must be between 7 and 30 days (inclusive).', 400);
  if (c.p.ForceDeleteWithoutRecovery) {
    delete secretsOf(c.acct, c.region)[s.Name];
    return { ARN: s.ARN, Name: s.Name, DeletionDate: c.acct.clock / 1000 };
  }
  s.deletedAt = c.acct.clock;
  s.recoveryDays = days;
  return { ARN: s.ARN, Name: s.Name, DeletionDate: (c.acct.clock + days * DAY) / 1000 };
});

op('secretsmanager', 'restore-secret', 'secret-id:s!', 'Cancela el borrado programado de un secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  s.deletedAt = undefined;
  s.recoveryDays = undefined;
  return { ARN: s.ARN, Name: s.Name };
});

op('secretsmanager', 'tag-resource', 'secret-id:s! tags:t!', 'Etiqueta un secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  s.Tags = mergeTags(s.Tags, c.p.Tags);
  return undefined;
});

op('secretsmanager', 'get-random-password', 'password-length:i exclude-characters:s exclude-numbers:b exclude-punctuation:b exclude-uppercase:b exclude-lowercase:b include-space:b require-each-included-type:b', 'Genera una contraseña aleatoria (para crear usuarios de bases de datos sin inventarla).', { res: () => '*', action: 'secretsmanager:GetRandomPassword' }, (c) => {
  const len = c.p.PasswordLength ?? 32;
  if (len < 1 || len > 4096) throw new AwsError('InvalidParameterException', 'PasswordLength must be between 1 and 4096.', 400);
  const excl = String(c.p.ExcludeCharacters ?? '');
  let set = '';
  if (!c.p.ExcludeLowercase) set += 'abcdefghijklmnopqrstuvwxyz';
  if (!c.p.ExcludeUppercase) set += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (!c.p.ExcludeNumbers) set += '0123456789';
  if (!c.p.ExcludePunctuation) set += '!#$%&()*+,-.:;<=>?[]^_{|}~';
  if (c.p.IncludeSpace) set += ' ';
  set = [...set].filter((ch) => !excl.includes(ch)).join('');
  if (!set) throw new AwsError('InvalidParameterException', 'The excluded characters leave nothing to build a password from.', 400);
  let out = '';
  for (let i = 0; i < len; i++) out += set[parseInt(stableId(`rp:${c.acct.clock}:${i}`, '', 4, 'hex'), 16) % set.length];
  c.acct.clock += 1;
  return { RandomPassword: out };
});

// el secreto con ventana de recuperación vencida desaparece
tickers.push((a) => {
  for (const r of Object.values(a.regions)) {
    for (const [k, s] of Object.entries(r.secrets ?? {})) if (s.deletedAt !== undefined && a.clock >= s.deletedAt + (s.recoveryDays ?? 30) * DAY) delete r.secrets![k];
  }
});

