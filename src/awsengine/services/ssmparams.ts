/** Systems Manager Parameter Store: parámetros (String, StringList, SecureString), versiones, etiquetas y jerarquías. */
import { sha256 } from '../../engine/commands/hash';
import { IMAGES, imageId } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account } from '../types';
import type { SsmParam } from '../types-ops';
import { iso, mkArn, toArr } from '../util';
import { refreshEc2 } from './ec2';
import { kmsHooks } from './kmshooks';
import { ssmOf } from './ssm';

export const paramsOf = (a: Account, region: string): Record<string, SsmParam> => (ssmOf(a, region).params ??= {});

const paramArn = (c: { acct: Account; region: string }, name: string) => mkArn('ssm', c.region, c.acct.id, `parameter${name.startsWith('/') ? '' : '/'}${name}`);
const DEFAULT_KEY = 'alias/aws/ssm';
const MAX_VERSIONS = 100;

function validName(name: string): void {
  if (!name || name.length > 2048) throw new AwsError('ValidationException', "1 validation error detected: Value at 'name' failed to satisfy constraint: Member must have length less than or equal to 2048", 400);
  if (!/^[a-zA-Z0-9_.\-/]+$/.test(name)) throw new AwsError('ValidationException', `Parameter name: can't contain characters other than letters, numbers and the symbols _ . - /: ${name}`, 400);
  if (/^\/?(aws|ssm)/i.test(name) && !name.startsWith('/aws/service/')) throw new AwsError('ValidationException', 'Parameter name: can\'t be prefixed with "ssm" or "aws" (case-insensitive).', 400);
  if (name.includes('/') && !name.startsWith('/')) throw new AwsError('ValidationException', 'Parameter name: a hierarchy must start with a slash, for example /Example/param1.', 400);
  if (name.endsWith('/')) throw new AwsError('ValidationException', 'Parameter name: a parameter name can\'t end with a slash.', 400);
  if (name.split('/').length - 1 > 15) throw new AwsError('ValidationException', 'Parameter name: a hierarchy can have a maximum of 15 levels.', 400);
}

/** Texto cifrado (de mentira pero estable) que devuelve `get-parameter` sin `--with-decryption`. */
const blob = (p: { Name: string; Value: string; KeyId?: string }) => 'AQICAHh' + btoa(sha256(`${p.KeyId ?? DEFAULT_KEY}:${p.Name}:${p.Value}`).slice(0, 48)).replace(/=+$/, '');

function shown(c: OpCtx, p: SsmParam, decrypt: boolean | undefined): string {
  if (p.Type !== 'SecureString') return p.Value;
  if (!decrypt) return blob({ Name: p.Name, Value: p.Value, KeyId: p.KeyId });
  if (p.KeyId && p.KeyId !== DEFAULT_KEY) kmsHooks.requireDecrypt?.(c, p.KeyId, { PARAMETER_ARN: paramArn(c, p.Name) });
  return p.Value;
}

const fmt = (c: OpCtx, p: SsmParam, o: { decrypt?: boolean; value?: boolean; selector?: string } = {}) => ({
  Name: p.Name,
  Type: p.Type,
  ...(o.value === false ? {} : { Value: shown(c, p, o.decrypt) }),
  Version: p.Version,
  ...(o.selector ? { Selector: o.selector } : {}),
  LastModifiedDate: iso(p.modified),
  ARN: paramArn(c, p.Name),
  DataType: p.DataType,
});

/** `nombre`, `nombre:3` (versión) o `nombre:etiqueta`. */
function lookup(c: OpCtx, raw: string): { p: SsmParam; ver: SsmParam['history'][number]; selector?: string } {
  let name = raw;
  let sel: string | undefined;
  const i = raw.lastIndexOf(':');
  if (i > 0) {
    name = raw.slice(0, i);
    sel = raw.slice(i + 1);
  }
  const p = paramsOf(c.acct, c.region)[name];
  if (!p) throw new AwsError('ParameterNotFound', '', 400);
  if (sel === undefined) return { p, ver: p.history[p.history.length - 1] };
  const v = /^\d+$/.test(sel) ? p.history.find((h) => h.Version === Number(sel)) : p.history.find((h) => h.Labels.includes(sel!));
  if (!v) throw new AwsError('ParameterVersionNotFound', "Systems Manager can't find the specified parameter version.", 400);
  return { p, ver: v, selector: `:${sel}` };
}

/** Parámetro (con una versión concreta) tal como lo ve quien lee. */
function view(c: OpCtx, raw: string, decrypt: boolean | undefined) {
  const { p, ver, selector } = lookup(c, raw);
  const at: SsmParam = { ...p, Value: ver.Value, Version: ver.Version, modified: ver.modified, KeyId: ver.KeyId };
  return fmt(c, at, { decrypt, selector: selector ? raw.slice(p.Name.length) : undefined });
}

// ───────────────────────── escritura ─────────────────────────

op(
  'ssm',
  'put-parameter',
  'name:s! description:s value:s! type:s key-id:s overwrite:b allowed-pattern:s tags:f tier:s policies:s data-type:s',
  'Crea o actualiza un parámetro: configuración (`String`, `StringList`) o secreto cifrado con KMS (`SecureString`).',
  { action: 'ssm:PutParameter', res: (c) => paramArn(c, String(c.p.Name)) },
  (c) => {
    const name = String(c.p.Name);
    validName(name);
    const type = (c.p.Type as string | undefined) ?? 'String';
    if (!['String', 'StringList', 'SecureString'].includes(type)) throw new AwsError('ValidationException', `1 validation error detected: Value '${type}' at 'type' failed to satisfy constraint: Member must satisfy enum value set: [SecureString, StringList, String]`, 400);
    const tier = (c.p.Tier as string | undefined) ?? 'Standard';
    if (!['Standard', 'Advanced', 'Intelligent-Tiering'].includes(tier)) throw new AwsError('ValidationException', `Invalid tier: ${tier}`, 400);
    const value = String(c.p.Value);
    const limit = tier === 'Standard' ? 4096 : 8192;
    if (new TextEncoder().encode(value).length > limit) throw new AwsError('ValidationException', `Standard tier parameters have a maximum value size of 4096 characters. Use the Advanced tier for values up to 8 KB.`, 400);
    if (c.p.KeyId && type !== 'SecureString') throw new AwsError('ValidationException', 'KeyId can only be used with the SecureString type.', 400);
    if (c.p.AllowedPattern) {
      let re: RegExp;
      try {
        re = new RegExp(String(c.p.AllowedPattern));
      } catch {
        throw new AwsError('ValidationException', 'AllowedPattern is not a valid regular expression.', 400);
      }
      if (!new RegExp(`^(?:${re.source})$`).test(value)) throw new AwsError('ParameterPatternMismatchException', `Parameter value, ${value}, does not match the allowed pattern ${c.p.AllowedPattern}.`, 400);
    }
    if (type === 'StringList' && !value.length) throw new AwsError('ValidationException', 'A StringList value must have at least one item.', 400);
    let keyId: string | undefined;
    if (type === 'SecureString') {
      keyId = (c.p.KeyId as string | undefined) ?? DEFAULT_KEY;
      if (keyId !== DEFAULT_KEY) {
        if (kmsHooks.resolve && !kmsHooks.resolve(c.acct, c.region, keyId)) throw new AwsError('ValidationException', `Invalid keyId '${keyId}'. Please verify the key exists and is enabled.`, 400);
        kmsHooks.requireEncrypt?.(c, keyId, { PARAMETER_ARN: paramArn(c, name) });
      }
    }
    const all = paramsOf(c.acct, c.region);
    const old = all[name];
    if (old && !c.p.Overwrite) throw new AwsError('ParameterAlreadyExists', 'The parameter already exists. To overwrite this value, set the overwrite option in the request to true.', 400);
    if (old && c.p.Tags) throw new AwsError('ValidationException', 'Invalid request: tags and overwrite can\'t be used together. To create a parameter with tags, please remove overwrite. To update tags for an existing parameter, please use AddTagsToResource or RemoveTagsFromResource.', 400);
    if (old && type !== old.Type) throw new AwsError('HierarchyTypeMismatchException', `The parameter type of ${name} is ${old.Type}: it can't be changed to ${type}.`, 400);
    if (!old && Object.keys(all).length >= 10000) throw new AwsError('ParameterLimitExceeded', 'You have exceeded the number of parameters for this AWS account.', 400);
    const version = (old?.Version ?? 0) + 1;
    const who = c.caller.arn;
    const entry = { Version: version, Value: value, modified: c.acct.clock, modifiedBy: who, Labels: [] as string[], Description: c.p.Description ?? old?.Description, KeyId: keyId, Tier: tier, Type: type };
    const p: SsmParam = old ?? { Name: name, Type: type as SsmParam['Type'], Value: value, Tier: tier as SsmParam['Tier'], DataType: 'text', Version: 0, modified: 0, modifiedBy: who, history: [], tags: {} };
    p.Value = value;
    p.Version = version;
    p.modified = c.acct.clock;
    p.modifiedBy = who;
    p.Type = type as SsmParam['Type'];
    p.KeyId = keyId;
    p.Tier = (old && old.Tier === 'Advanced' ? 'Advanced' : tier) as SsmParam['Tier'];
    p.DataType = (c.p.DataType as string | undefined) ?? p.DataType;
    if (c.p.Description !== undefined) p.Description = c.p.Description;
    if (c.p.AllowedPattern) p.AllowedPattern = c.p.AllowedPattern;
    p.history.push(entry);
    if (p.history.length > MAX_VERSIONS) p.history.shift();
    for (const t of toArr<{ Key: string; Value: string }>(c.p.Tags)) p.tags[t.Key] = t.Value;
    all[name] = p;
    return { Version: version, Tier: p.Tier };
  },
);

op('ssm', 'delete-parameter', 'name:s!', 'Borra un parámetro y todas sus versiones.', { action: 'ssm:DeleteParameter', res: (c) => paramArn(c, String(c.p.Name)) }, (c) => {
  const all = paramsOf(c.acct, c.region);
  if (!all[c.p.Name]) throw new AwsError('ParameterNotFound', '', 400);
  delete all[c.p.Name];
  return {};
});

op('ssm', 'delete-parameters', 'names:l!', 'Borra varios parámetros a la vez.', { action: 'ssm:DeleteParameters', res: (c) => (c.p.Names as string[]).map((n) => paramArn(c, n)) }, (c) => {
  const all = paramsOf(c.acct, c.region);
  const deleted: string[] = [];
  const invalid: string[] = [];
  for (const n of c.p.Names as string[]) {
    if (all[n]) {
      delete all[n];
      deleted.push(n);
    } else invalid.push(n);
  }
  return { DeletedParameters: deleted, InvalidParameters: invalid };
});

// ───────────────────────── lectura ─────────────────────────

op('ssm', 'get-parameter', 'name:s! with-decryption:b', 'Lee un parámetro (también los públicos de AWS, como el último ID de AMI). `--with-decryption` descifra los SecureString.', { action: 'ssm:GetParameter', res: (c) => paramArn(c, String(c.p.Name).split(':')[0]) }, (c) => {
  const raw = String(c.p.Name);
  if (!paramsOf(c.acct, c.region)[raw.split(':')[0]]) {
    const img = IMAGES.find((i) => i.ssm === raw);
    if (!img) throw new AwsError('ParameterNotFound', '', 400);
    refreshEc2(c.acct, c.region);
    return { Parameter: { Name: raw, Type: 'String', Value: imageId(c.region, img.key), Version: 12, LastModifiedDate: img.created, ARN: mkArn('ssm', c.region, '', `parameter${raw}`), DataType: 'aws:ec2:image' } };
  }
  return { Parameter: view(c, raw, c.p.WithDecryption) };
});

op('ssm', 'get-parameters', 'names:l! with-decryption:b', 'Lee hasta 10 parámetros de una vez; los que no existen salen en `InvalidParameters`.', { action: 'ssm:GetParameters', res: (c) => (c.p.Names as string[]).map((n) => paramArn(c, n.split(':')[0])) }, (c) => {
  const names = c.p.Names as string[];
  if (names.length > 10) throw new AwsError('ValidationException', "1 validation error detected: Value at 'names' failed to satisfy constraint: Member must have length less than or equal to 10", 400);
  const ok: unknown[] = [];
  const bad: string[] = [];
  for (const n of names) {
    try {
      ok.push(view(c, n, c.p.WithDecryption));
    } catch (e) {
      if (e instanceof AwsError && (e.code === 'ParameterNotFound' || e.code === 'ParameterVersionNotFound')) bad.push(n);
      else throw e;
    }
  }
  return { Parameters: ok, InvalidParameters: bad };
});

op('ssm', 'get-parameters-by-path', 'path:s! recursive:b parameter-filters:f with-decryption:b max-results:i', 'Lee todos los parámetros que cuelgan de una ruta (`/app/prod`), con o sin sus subniveles (`--recursive`).', { paginate: 'Parameters', action: 'ssm:GetParametersByPath', res: (c) => paramArn(c, String(c.p.Path).replace(/\/$/, '') + '/*') }, (c) => {
  const path = String(c.p.Path).replace(/\/+$/, '');
  if (!String(c.p.Path).startsWith('/')) throw new AwsError('ValidationException', 'The parameter doesn\'t meet the parameter name requirements. The parameter path must begin with a forward slash.', 400);
  const list = Object.values(paramsOf(c.acct, c.region))
    .filter((p) => p.Name.startsWith(path + '/') && (c.p.Recursive || !p.Name.slice(path.length + 1).includes('/')))
    .sort((x, y) => (x.Name < y.Name ? -1 : 1));
  const dec = c.p.WithDecryption as boolean | undefined;
  return { Parameters: list.map((p) => fmt(c, p, { decrypt: dec })) };
});

op('ssm', 'get-parameter-history', 'name:s! with-decryption:b max-results:i', 'Todas las versiones de un parámetro, con quién y cuándo las cambió.', { paginate: 'Parameters', action: 'ssm:GetParameterHistory', res: (c) => paramArn(c, String(c.p.Name)) }, (c) => {
  const p = paramsOf(c.acct, c.region)[c.p.Name];
  if (!p) throw new AwsError('ParameterNotFound', '', 400);
  return {
    Parameters: p.history.map((h) => ({
      Name: p.Name,
      Type: h.Type,
      ...(h.KeyId ? { KeyId: h.KeyId } : {}),
      LastModifiedDate: iso(h.modified),
      LastModifiedUser: h.modifiedBy,
      ...(h.Description ? { Description: h.Description } : {}),
      Value: h.Type === 'SecureString' && !c.p.WithDecryption ? blob({ Name: p.Name, Value: h.Value, KeyId: h.KeyId }) : h.Value,
      Version: h.Version,
      Labels: h.Labels,
      Tier: h.Tier,
      Policies: [],
      DataType: p.DataType,
    })),
  };
});

op('ssm', 'describe-parameters', 'parameter-filters:f filters:f max-results:i', 'Lista los parámetros sin sus valores (nombre, tipo, versión…); admite filtros por nombre, tipo o ruta.', { paginate: 'Parameters', action: 'ssm:DescribeParameters', res: () => '*' }, (c) => {
  const fl = [...toArr<{ Key: string; Option?: string; Values?: string[] }>(c.p.ParameterFilters), ...toArr<{ Key: string; Values?: string[] }>(c.p.Filters)];
  const list = Object.values(paramsOf(c.acct, c.region)).filter((p) =>
    fl.every((f) => {
      const vs = toArr<string>(f.Values as string | string[] | undefined);
      const opt = (f as { Option?: string }).Option ?? 'Equals';
      if (f.Key === 'Name') return vs.some((v) => (opt === 'BeginsWith' ? p.Name.startsWith(v) : opt === 'Contains' ? p.Name.includes(v) : p.Name === v || p.Name === '/' + v));
      if (f.Key === 'Type') return vs.includes(p.Type);
      if (f.Key === 'KeyId') return vs.includes(p.KeyId ?? '');
      if (f.Key === 'Tier') return vs.includes(p.Tier);
      if (f.Key === 'Path') {
        const base = vs[0].replace(/\/$/, '');
        return p.Name.startsWith(base + '/') && (opt === 'Recursive' || !p.Name.slice(base.length + 1).includes('/'));
      }
      if (f.Key.startsWith('tag:')) return vs.includes(p.tags[f.Key.slice(4)]);
      return true;
    }),
  );
  return { Parameters: list.sort((x, y) => (x.Name < y.Name ? -1 : 1)).map((p) => ({ Name: p.Name, Type: p.Type, ...(p.KeyId ? { KeyId: p.KeyId } : {}), LastModifiedDate: iso(p.modified), LastModifiedUser: p.modifiedBy, ...(p.Description ? { Description: p.Description } : {}), ...(p.AllowedPattern ? { AllowedPattern: p.AllowedPattern } : {}), Version: p.Version, Tier: p.Tier, Policies: [], DataType: p.DataType })) };
});

op('ssm', 'label-parameter-version', 'name:s! parameter-version:i labels:l!', 'Pone una etiqueta (`prod`, `estable`) a una versión: así puedes leer `nombre:prod` sin saber el número.', { action: 'ssm:LabelParameterVersion', res: (c) => paramArn(c, String(c.p.Name)) }, (c) => {
  const p = paramsOf(c.acct, c.region)[c.p.Name];
  if (!p) throw new AwsError('ParameterNotFound', '', 400);
  const v = c.p.ParameterVersion === undefined ? p.history[p.history.length - 1] : p.history.find((h) => h.Version === c.p.ParameterVersion);
  if (!v) throw new AwsError('ParameterVersionNotFound', "Systems Manager can't find the specified parameter version.", 400);
  const bad: string[] = [];
  for (const l of c.p.Labels as string[]) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(l) || /^[0-9]/.test(l) || /^(aws|ssm)/i.test(l)) bad.push(l);
    else {
      for (const h of p.history) h.Labels = h.Labels.filter((x) => x !== l);
      if (v.Labels.length >= 10) throw new AwsError('ParameterVersionLabelLimitExceeded', 'A parameter version can have up to 10 labels.', 400);
      v.Labels.push(l);
    }
  }
  return { InvalidLabels: bad, ParameterVersion: v.Version };
});

// ───────────────────────── etiquetas ─────────────────────────

const tagTarget = (c: OpCtx): Record<string, string> => {
  const t = String(c.p.ResourceType);
  const id = String(c.p.ResourceId);
  if (t === 'Parameter') {
    const p = paramsOf(c.acct, c.region)[id];
    if (!p) throw new AwsError('InvalidResourceId', 'Invalid resource ID.', 400);
    return p.tags;
  }
  const hook = tagHooks[t]?.(c, id);
  if (hook) return hook;
  throw new AwsError('InvalidResourceType', `Invalid resource type ${t}.`, 400);
};
/** Otros módulos de SSM (documentos, ventanas…) aportan sus etiquetas. */
export const tagHooks: Record<string, (c: OpCtx, id: string) => Record<string, string> | undefined> = {};

op('ssm', 'add-tags-to-resource', 'resource-type:s! resource-id:s! tags:f!', 'Etiqueta un parámetro, documento o ventana de mantenimiento.', { action: 'ssm:AddTagsToResource', res: () => '*' }, (c) => {
  const tags = tagTarget(c);
  for (const t of c.p.Tags as { Key: string; Value: string }[]) tags[t.Key] = t.Value;
  return {};
});
op('ssm', 'remove-tags-from-resource', 'resource-type:s! resource-id:s! tag-keys:l!', 'Quita etiquetas.', { action: 'ssm:RemoveTagsFromResource', res: () => '*' }, (c) => {
  const tags = tagTarget(c);
  for (const k of c.p.TagKeys as string[]) delete tags[k];
  return {};
});
op('ssm', 'list-tags-for-resource', 'resource-type:s! resource-id:s!', 'Etiquetas de un recurso de Systems Manager.', { action: 'ssm:ListTagsForResource', res: () => '*' }, (c) => ({ TagList: Object.entries(tagTarget(c)).map(([Key, Value]) => ({ Key, Value })) }));

