/** AWS Secrets Manager: guardar credenciales fuera del código, con versiones y borrado con ventana de recuperación. */
import { regional } from '../account';
import { resourcePolicyProviders } from '../authz';
import { validatePolicy } from '../policy';
import { AwsError, op, type OpCtx } from '../registry';
import { invokeSync, lambdaAllows, resolveFn } from './lambda';
import { kmsHooks } from './kmshooks';
import { tickers } from '../tick';
import type { Account, Secret, Tag } from '../types';
import { iso, mergeTags, mkArn, newId, stableId, toArr } from '../util';

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

function addVersion(a: Account, s: Secret, value: string, binary: boolean, token?: string, stages?: string[]): string {
  const id = token ?? [8, 4, 4, 4, 12].map((n, k) => stableId(`sv:${s.ARN}:${s.versions.length}:${a.clock}:${k}`, '', n)).join('-').toLowerCase();
  // una versión con etapas propias (p. ej. `AWSPENDING` durante una rotación) no mueve `AWSCURRENT`
  if (stages && !stages.includes('AWSCURRENT')) {
    const old = s.versions.find((v) => v.id === id);
    if (old) {
      old.value = value;
      old.empty = undefined;
      old.binary = binary;
      for (const st of stages) if (!old.stages.includes(st)) old.stages.push(st);
    } else s.versions.push({ id, value, binary, created: a.clock, stages: [...stages] });
    return id;
  }
  for (const v of s.versions) {
    if (v.stages.includes('AWSPREVIOUS')) v.stages = v.stages.filter((x) => x !== 'AWSPREVIOUS');
    if (v.stages.includes('AWSCURRENT')) v.stages = ['AWSPREVIOUS'];
  }
  s.versions.push({ id, value, binary, created: a.clock, stages: ['AWSCURRENT'] });
  // solo se conservan las versiones con alguna etiqueta
  s.versions = s.versions.filter((v) => v.stages.length);
  return id;
}

/** Usa la clave de KMS del secreto (leer = descifrar; escribir = generar la clave de datos). Devuelve el ARN de la clave. */
function useKey(c: OpCtx, keyId: string, s: Secret, mode: 'read' | 'write'): string {
  const arn = kmsHooks.resolve?.(c.acct, c.region, keyId);
  if (mode === 'write' && kmsHooks.resolve && !arn) throw new AwsError('InvalidRequestException', `The KMS key ${keyId} was not found or is not enabled.`, 400);
  try {
    if (mode === 'read') kmsHooks.requireDecrypt?.(c, keyId, { SecretARN: s.ARN });
    else kmsHooks.requireEncrypt?.(c, keyId, { SecretARN: s.ARN });
  } catch (e) {
    if (e instanceof AwsError && (e.code === 'DisabledException' || e.code === 'KMSInvalidStateException')) throw new AwsError('DecryptionFailure', "Secrets Manager can't decrypt the protected secret text using the provided KMS key. Check the key and try again.", 400);
    throw e;
  }
  return arn ?? keyId;
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
  if (c.p.KmsKeyId) s.KmsKeyId = useKey(c, String(c.p.KmsKeyId), s, 'write');
  const v = addVersion(c.acct, s, c.p.SecretString ?? c.p.SecretBinary, c.p.SecretString === undefined, c.p.ClientRequestToken);
  all[name] = s;
  return { ARN: s.ARN, Name: s.Name, VersionId: v };
});

op('secretsmanager', 'get-secret-value', 'secret-id:s! version-id:s version-stage:s', 'Lee el valor de un secreto (por defecto la versión `AWSCURRENT`). Necesita `secretsmanager:GetSecretValue` sobre ese secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  const v = c.p.VersionId ? s.versions.find((x) => x.id === c.p.VersionId && (!c.p.VersionStage || x.stages.includes(c.p.VersionStage))) : s.versions.find((x) => x.stages.includes(c.p.VersionStage ?? 'AWSCURRENT'));
  if (!v || v.empty) throw new AwsError('ResourceNotFoundException', "Secrets Manager can't find the specified secret value for VersionId/VersionStage.", 400);
  if (s.KmsKeyId) useKey(c, s.KmsKeyId, s, 'read');
  return { ARN: s.ARN, Name: s.Name, VersionId: v.id, ...(v.binary ? { SecretBinary: v.value } : { SecretString: v.value }), VersionStages: v.stages, CreatedDate: v.created / 1000 };
});

op('secretsmanager', 'put-secret-value', 'secret-id:s! secret-string:s secret-binary:s client-request-token:s version-stages:l', 'Guarda una versión nueva del secreto (la anterior pasa a `AWSPREVIOUS`).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  if (c.p.SecretString === undefined && c.p.SecretBinary === undefined) throw new AwsError('InvalidParameterException', 'You must provide either SecretString or SecretBinary.', 400);
  if (s.KmsKeyId) useKey(c, s.KmsKeyId, s, 'write');
  const stages = c.p.VersionStages ? toArr<string>(c.p.VersionStages) : undefined;
  const v = addVersion(c.acct, s, c.p.SecretString ?? c.p.SecretBinary, c.p.SecretString === undefined, c.p.ClientRequestToken, stages);
  return { ARN: s.ARN, Name: s.Name, VersionId: v, VersionStages: stages ?? ['AWSCURRENT'] };
});

op('secretsmanager', 'update-secret', 'secret-id:s! description:s secret-string:s kms-key-id:s', 'Cambia la descripción o el valor del secreto (crea una versión nueva).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  if (c.p.Description !== undefined) s.Description = c.p.Description;
  if (c.p.KmsKeyId) s.KmsKeyId = useKey(c, String(c.p.KmsKeyId), s, 'write');
  if (c.p.SecretString !== undefined && s.KmsKeyId) useKey(c, s.KmsKeyId, s, 'write');
  const v = c.p.SecretString !== undefined ? addVersion(c.acct, s, c.p.SecretString, false) : current(s)?.id;
  return { ARN: s.ARN, Name: s.Name, VersionId: v };
});

const describe = (s: Secret) => ({
  ARN: s.ARN,
  Name: s.Name,
  ...(s.Description ? { Description: s.Description } : {}),
  LastChangedDate: (current(s)?.created ?? s.created) / 1000,
  CreatedDate: s.created / 1000,
  ...(s.KmsKeyId ? { KmsKeyId: s.KmsKeyId } : {}),
  RotationEnabled: !!s.rotation?.enabled,
  ...(s.rotation ? { RotationLambdaARN: s.rotation.lambda, RotationRules: { AutomaticallyAfterDays: s.rotation.days } } : {}),
  ...(s.rotation?.last ? { LastRotatedDate: s.rotation.last / 1000 } : {}),
  ...(s.rotation?.enabled && s.rotation.next ? { NextRotationDate: s.rotation.next / 1000 } : {}),
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


// ───────────────────────── etapas de las versiones ─────────────────────────

op('secretsmanager', 'update-secret-version-stage', 'secret-id:s! version-stage:s! remove-from-version-id:s move-to-version-id:s', 'Mueve una etiqueta de versión (`AWSCURRENT`, `AWSPENDING`…) de una versión a otra. Es el último paso de una rotación.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  const stage = String(c.p.VersionStage);
  const from = c.p.RemoveFromVersionId ? s.versions.find((v) => v.id === c.p.RemoveFromVersionId) : undefined;
  const to = c.p.MoveToVersionId ? s.versions.find((v) => v.id === c.p.MoveToVersionId) : undefined;
  if ((c.p.RemoveFromVersionId && !from) || (c.p.MoveToVersionId && !to)) throw new AwsError('ResourceNotFoundException', "Secrets Manager can't find the specified secret version.", 400);
  if (from && !from.stages.includes(stage)) throw new AwsError('InvalidParameterException', `The staging label ${stage} is not attached to version ${from.id}.`, 400);
  if (from) from.stages = from.stages.filter((x) => x !== stage);
  if (to && !to.stages.includes(stage)) {
    // al pasar AWSCURRENT a otra versión, la que lo tenía se queda con AWSPREVIOUS y la nueva deja de estar «pendiente»
    if (stage === 'AWSCURRENT') {
      for (const v of s.versions) if (v.stages.includes('AWSPREVIOUS')) v.stages = v.stages.filter((x) => x !== 'AWSPREVIOUS');
      if (from) from.stages = [...new Set([...from.stages, 'AWSPREVIOUS'])];
      to.stages = to.stages.filter((x) => x !== 'AWSPENDING');
    }
    to.stages.push(stage);
  }
  s.versions = s.versions.filter((v) => v.stages.length);
  return { ARN: s.ARN, Name: s.Name };
});

op('secretsmanager', 'list-secret-version-ids', 'secret-id:s! max-results:i include-deprecated:b', 'Lista las versiones del secreto y sus etiquetas.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  return { ARN: s.ARN, Name: s.Name, Versions: s.versions.map((v) => ({ VersionId: v.id, VersionStages: v.stages, CreatedDate: v.created / 1000 })) };
});

// ───────────────────────── rotación ─────────────────────────

const uuidOf = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** Ejecuta los cuatro pasos de la función de rotación. Si falla, la versión nueva se queda `AWSPENDING` y el secreto sin cambios. */
function rotate(a: Account, region: string, s: Secret, token: string): { ok: boolean; error?: string } {
  const rot = s.rotation!;
  // una rotación que se quedó a medias se abandona: su etiqueta `AWSPENDING` desaparece
  for (const v of s.versions) if (v.id !== token) v.stages = v.stages.filter((x) => x !== 'AWSPENDING');
  s.versions = s.versions.filter((v) => v.stages.length);
  // Secrets Manager reserva la versión nueva (`AWSPENDING`, todavía sin valor) antes de llamar a la función
  if (!s.versions.some((v) => v.id === token)) s.versions.push({ id: token, value: '', created: a.clock, stages: ['AWSPENDING'], empty: true });
  for (const step of ['createSecret', 'setSecret', 'testSecret', 'finishSecret']) {
    const out = invokeSync(a, region, rot.lambda, { Step: step, SecretId: s.ARN, ClientRequestToken: token }, { service: 'secretsmanager.amazonaws.com', sourceArn: s.ARN });
    if (out.functionError) return { ok: false, error: `${step}: ${out.functionError}` };
  }
  rot.last = a.clock;
  rot.next = rot.days ? a.clock + rot.days * DAY : undefined;
  return { ok: true };
}

const ruleDays = (v: unknown): number | undefined => {
  const r = (Array.isArray(v) ? Object.assign({}, ...v) : (v ?? {})) as { AutomaticallyAfterDays?: number | string; ScheduleExpression?: string };
  if (r.AutomaticallyAfterDays !== undefined) {
    const d = Number(r.AutomaticallyAfterDays);
    if (!Number.isInteger(d) || d < 1 || d > 1000) throw new AwsError('InvalidParameterException', 'AutomaticallyAfterDays must be between 1 and 1000.', 400);
    return d;
  }
  const m = /^rate\((\d+) days?\)$/.exec(r.ScheduleExpression ?? '');
  return m ? Number(m[1]) : undefined;
};

op('secretsmanager', 'rotate-secret', 'secret-id:s! client-request-token:s rotation-lambda-arn:s rotation-rules:f rotate-immediately:b', 'Configura la rotación (una función Lambda cambia la contraseña cada N días) y, salvo que digas lo contrario, la ejecuta ya.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  const lambda = (c.p.RotationLambdaArn as string | undefined) ?? s.rotation?.lambda;
  if (!lambda) throw new AwsError('InvalidRequestException', 'You must specify a rotation Lambda function (RotationLambdaARN) the first time you configure rotation.', 400);
  const days = ruleDays(c.p.RotationRules) ?? s.rotation?.days ?? 0;
  const token = (c.p.ClientRequestToken as string | undefined) ?? uuidOf(c.acct, 'sectoken');
  // si Secrets Manager no puede invocar la función, se rechaza en el momento
  try {
    const { fn } = resolveFn(c.acct, c.region, lambda);
    if (!lambdaAllows(fn, 'secretsmanager.amazonaws.com', s.ARN)) throw new AwsError('AccessDeniedException', 'no permission', 403);
  } catch (e) {
    if (e instanceof AwsError && e.code === 'AccessDeniedException') throw new AwsError('InvalidRequestException', 'Secrets Manager cannot invoke the specified Lambda function. Ensure that the function policy grants access to the principal secretsmanager.amazonaws.com.', 400);
    if (e instanceof AwsError && e.code === 'ResourceNotFoundException') throw new AwsError('InvalidRequestException', `The specified Lambda function does not exist: ${lambda}`, 400);
    throw e;
  }
  s.rotation = { lambda, days, enabled: true, last: s.rotation?.last, next: days ? c.acct.clock + days * DAY : undefined };
  if (c.p.RotateImmediately !== false) {
    const r = rotate(c.acct, c.region, s, token);
    if (!r.ok) s.rotation.next = days ? c.acct.clock + 60 * 1000 : undefined;
  }
  return { ARN: s.ARN, Name: s.Name, VersionId: token };
});

op('secretsmanager', 'cancel-rotate-secret', 'secret-id:s!', 'Desactiva la rotación automática (la configuración de la función se conserva).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  notDeleted(s);
  if (!s.rotation?.enabled) throw new AwsError('InvalidRequestException', 'The secret does not have rotation enabled.', 400);
  s.rotation.enabled = false;
  s.rotation.next = undefined;
  return { ARN: s.ARN, Name: s.Name };
});

// la rotación programada se ejecuta sola cuando toca
tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) {
    for (const s of Object.values(r.secrets ?? {})) {
      const rot = s.rotation;
      if (!rot?.enabled || !rot.next || a.clock < rot.next || s.deletedAt !== undefined) continue;
      rot.next = a.clock + (rot.days || 1) * DAY;
      try {
        rotate(a, region, s, uuidOf(a, 'sectoken'));
      } catch {
        /* la función no existe o no tiene permiso: la rotación no se hace */
      }
    }
  }
});

// ───────────────────────── política de recurso ─────────────────────────

resourcePolicyProviders.push((a, arn) => {
  if (!arn.startsWith('arn:aws:secretsmanager:')) return [];
  const region = arn.split(':')[3];
  const s = Object.values(secretsOf(a, region)).find((x) => x.ARN === arn || (x.ARN.startsWith(arn.replace(/-\?\*$/, '')) && arn.endsWith('*')));
  if (!s?.policy) return [];
  try {
    return [{ name: 'secret-resource-policy', kind: 'resource' as const, doc: JSON.parse(s.policy) }];
  } catch {
    return [];
  }
});

function parsePolicy(text: string) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new AwsError('MalformedPolicyDocumentException', 'This resource policy contains an invalid JSON document.', 400);
  }
  const bad = validatePolicy(doc, 'resource');
  if (bad) throw new AwsError('MalformedPolicyDocumentException', bad, 400);
  return doc;
}

op('secretsmanager', 'put-resource-policy', 'secret-id:s! resource-policy:s! block-public-policy:b', 'Adjunta al secreto una política de recurso (p. ej. para dar acceso a otra cuenta o denegarlo fuera de tu red).', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  const doc = parsePolicy(String(c.p.ResourcePolicy));
  if (c.p.BlockPublicPolicy !== false) {
    const open = (Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]).some((st: { Effect?: string; Principal?: unknown }) => st.Effect === 'Allow' && (st.Principal === '*' || (st.Principal as { AWS?: string })?.AWS === '*'));
    if (open) throw new AwsError('MalformedPolicyDocumentException', 'This resource policy contains an unbounded principal. Provide a more restrictive policy, or set BlockPublicPolicy to false.', 400);
  }
  s.policy = JSON.stringify(doc);
  return { ARN: s.ARN, Name: s.Name };
});

op('secretsmanager', 'get-resource-policy', 'secret-id:s!', 'Lee la política de recurso del secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  return { ARN: s.ARN, Name: s.Name, ...(s.policy ? { ResourcePolicy: JSON.stringify(JSON.parse(s.policy), null, 2) } : {}) };
});

op('secretsmanager', 'delete-resource-policy', 'secret-id:s!', 'Quita la política de recurso del secreto.', { res: resourceOf }, (c) => {
  const s = findSecret(c.acct, c.region, String(c.p.SecretId));
  if (!s) throw notFound();
  s.policy = undefined;
  return { ARN: s.ARN, Name: s.Name };
});

op('secretsmanager', 'validate-resource-policy', 'secret-id:s resource-policy:s!', 'Comprueba una política de recurso antes de aplicarla (avisa de las que dejarían el secreto abierto).', { res: () => '*' }, (c) => {
  const errors: { CheckName: string; ErrorMessage: string }[] = [];
  try {
    const doc = parsePolicy(String(c.p.ResourcePolicy));
    const open = (Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement]).some((st: { Effect?: string; Principal?: unknown }) => st.Effect === 'Allow' && (st.Principal === '*' || (st.Principal as { AWS?: string })?.AWS === '*'));
    if (open) errors.push({ CheckName: 'PublicPolicy', ErrorMessage: 'The resource policy grants access to everyone (unbounded principal).' });
  } catch (e) {
    errors.push({ CheckName: 'SyntaxError', ErrorMessage: (e as Error).message });
  }
  return { PolicyValidationPassed: errors.length === 0, ValidationErrors: errors };
});

void iso;
