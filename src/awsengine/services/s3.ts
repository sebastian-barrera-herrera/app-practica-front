/** Amazon S3 (API completa: `aws s3api …`) y las funciones de datos que comparten los comandos de alto nivel. */
import { md5, utf8Bytes } from '../../engine/commands/hash';
import { evaluate, validatePolicy, type Context, type PolicySource } from '../policy';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, LifecycleRule, PolicyDoc, PublicAccessBlock, S3Bucket, S3Version, Tag } from '../types';
import { isRegion } from '../catalog';
import { clone, iso, newId, sortBy, toArr } from '../util';

export const ownerId = (a: Account) => md5('owner:' + a.id) + md5('id:' + a.id);

// ───────────────────────── funciones de datos ─────────────────────────

export const utf8Len = (s: string): number => utf8Bytes(s).length;

export function validBucketName(n: string): boolean {
  if (n.length < 3 || n.length > 63) return false;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(n)) return false;
  if (/\.\./.test(n) || /^\d+\.\d+\.\d+\.\d+$/.test(n)) return false;
  if (/^(xn--|sthree-)/.test(n) || /(-s3alias|--ol-s3)$/.test(n)) return false;
  return true;
}

export function s3CreateBucket(a: Account, name: string, region: string, o: { versioning?: '' | 'Enabled' | 'Suspended'; publicAccessBlock?: PublicAccessBlock | null } = {}): S3Bucket {
  const b: S3Bucket = {
    name,
    region,
    created: iso(a.clock),
    versioning: o.versioning ?? '',
    objects: {},
    publicAccessBlock: o.publicAccessBlock === null ? undefined : o.publicAccessBlock ?? { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    encryption: { SSEAlgorithm: 'AES256', BucketKeyEnabled: true },
    tags: [],
  };
  a.s3.buckets[name] = b;
  return b;
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', log: 'text/plain', sh: 'application/x-sh', yaml: 'application/yaml', yml: 'application/yaml',
};
export function guessType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return key.includes('.') ? MIME[ext] ?? 'binary/octet-stream' : 'binary/octet-stream';
}

export interface PutOpts {
  contentType?: string;
  storageClass?: string;
  sse?: string;
  tags?: Tag[];
  metadata?: Record<string, string>;
  size?: number;
  mtime?: number;
  /** Nombre del evento de notificación (`ObjectCreated:Put` por defecto; `Copy`, `CompleteMultipartUpload`…). */
  event?: string;
}

/** Gancho de las notificaciones de eventos: lo instala `s3events.ts` para que este módulo no dependa de Lambda, SQS ni SNS. */
export const s3Hooks: { emit?: (a: Account, bucket: S3Bucket, event: string, key: string, v?: S3Version) => void } = {};

/** Guarda un objeto respetando el versionado del bucket. Devuelve la versión creada. */
export function s3Put(a: Account, bucket: S3Bucket, key: string, body: string, o: PutOpts = {}): S3Version {
  const versioned = bucket.versioning === 'Enabled';
  const v: S3Version = {
    versionId: versioned ? newId(a, 's3ver', '', 32, 'b64').replace(/[+/]/g, 'x') : 'null',
    deleteMarker: false,
    size: o.size ?? utf8Len(body),
    etag: md5(body),
    lastModified: iso(o.mtime ?? a.clock),
    storageClass: o.storageClass ?? 'STANDARD',
    body,
    sse: o.sse ?? bucket.encryption.SSEAlgorithm,
    contentType: o.contentType ?? guessType(key),
    tags: o.tags ?? [],
    metadata: o.metadata ?? {},
  };
  const cur = bucket.objects[key] ?? [];
  // sin versionado (o suspendido) la versión «null» se sobrescribe; las versiones reales anteriores se conservan
  bucket.objects[key] = versioned ? [...cur, v] : [...cur.filter((x) => x.versionId !== 'null'), v];
  if (bucket.notifications) s3Hooks.emit?.(a, bucket, o.event ?? 'ObjectCreated:Put', key, v);
  return v;
}

/** Versión actual (la más reciente) o undefined si no existe o es un marcador de borrado. */
export function s3Current(bucket: S3Bucket, key: string): S3Version | undefined {
  const l = bucket.objects[key];
  const v = l?.[l.length - 1];
  return v && !v.deleteMarker ? v : undefined;
}

export function s3Delete(a: Account, bucket: S3Bucket, key: string, versionId?: string): { marker?: boolean; versionId?: string } {
  const l = bucket.objects[key];
  if (versionId) {
    if (!l) return {};
    const i = l.findIndex((v) => v.versionId === versionId);
    if (i < 0) return {};
    const wasMarker = l[i].deleteMarker;
    l.splice(i, 1);
    if (!l.length) delete bucket.objects[key];
    if (bucket.notifications) s3Hooks.emit?.(a, bucket, 'ObjectRemoved:Delete', key);
    return { marker: wasMarker, versionId };
  }
  if (bucket.versioning === 'Enabled') {
    const id = newId(a, 's3ver', '', 32, 'b64').replace(/[+/]/g, 'x');
    (bucket.objects[key] ??= []).push({ versionId: id, deleteMarker: true, size: 0, etag: '', lastModified: iso(a.clock), storageClass: 'STANDARD', body: '', contentType: '', tags: [], metadata: {} });
    if (bucket.notifications) s3Hooks.emit?.(a, bucket, 'ObjectRemoved:DeleteMarkerCreated', key);
    return { marker: true, versionId: id };
  }
  const existed = !!l;
  delete bucket.objects[key];
  if (existed && bucket.notifications) s3Hooks.emit?.(a, bucket, 'ObjectRemoved:Delete', key);
  return {};
}

/** Claves actuales (no borradas) ordenadas como S3: por orden binario UTF-8. */
export function s3Keys(bucket: S3Bucket): string[] {
  return Object.keys(bucket.objects)
    .filter((k) => s3Current(bucket, k))
    .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/** Crea un bucket aplicando todas las reglas de AWS (nombre, región, nombres únicos en todo el mundo). */
export function s3MakeBucket(a: Account, name: string, region: string, locationConstraint?: string): S3Bucket {
  if (!validBucketName(name)) throw new AwsError('InvalidBucketName', 'The specified bucket is not valid.', 400);
  if (!isRegion(region)) throw new AwsError('InvalidLocationConstraint', 'The specified location-constraint is not valid', 400);
  if (region !== 'us-east-1' && !locationConstraint) throw new AwsError('IllegalLocationConstraintException', 'The unspecified location constraint is incompatible for the region specific endpoint this request was sent to.', 400);
  if (locationConstraint && locationConstraint !== region) throw new AwsError('IllegalLocationConstraintException', `The ${locationConstraint} location constraint is incompatible for the region specific endpoint this request was sent to.`, 400);
  if (a.s3.buckets[name]) throw new AwsError('BucketAlreadyOwnedByYou', 'Your previous request to create the named bucket succeeded and you already own it.', 409);
  if (a.s3.taken.includes(name)) throw new AwsError('BucketAlreadyExists', 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.', 409);
  return s3CreateBucket(a, name, region);
}

export const quotedEtag = (v: S3Version) => `"${v.etag}"`;

export function getBucket(a: Account, name: string): S3Bucket {
  const b = a.s3.buckets[name];
  if (!b) throw new AwsError('NoSuchBucket', 'The specified bucket does not exist', 404);
  return b;
}

/** ¿Una política concede acceso público (Principal "*") sin condiciones que lo restrinjan? */
export function isPublicPolicy(doc: PolicyDoc): boolean {
  const sts = toArr(doc.Statement);
  return sts.some((s) => {
    if (s.Effect !== 'Allow') return false;
    const p = s.Principal;
    const pub = p === '*' || (typeof p === 'object' && toArr(p.AWS).includes('*'));
    if (!pub) return false;
    const restricting = ['aws:principalorgid', 'aws:sourcevpc', 'aws:sourcevpce', 'aws:principalaccount', 'aws:sourceaccount', 'aws:sourcearn', 'aws:userid', 'aws:principalarn'];
    for (const block of Object.values(s.Condition ?? {})) for (const k of Object.keys(block)) if (restricting.includes(k.toLowerCase())) return false;
    return true;
  });
}

/** ¿Puede alguien sin credenciales hacer `action` sobre `resource`? (política de bucket pública y Block Public Access). */
export function anonymousAllowed(b: S3Bucket, action: string, resource: string, context: Context = {}): boolean {
  if (b.publicAccessBlock?.RestrictPublicBuckets) return false;
  if (!b.policy) return false;
  const pols: PolicySource[] = [{ name: 'bucket-policy', kind: 'resource', doc: b.policy }];
  const r = evaluate({ action, resource, principalArn: 'anonymous', principalAccount: 'anonymous', context, policies: pols });
  return r.decision === 'allowed';
}

export const anonymousCanRead = (b: S3Bucket, key: string, context: Context = {}) => anonymousAllowed(b, 's3:GetObject', `arn:aws:s3:::${b.name}/${key}`, context);

// ───────────────────────── manejadores comunes ─────────────────────────

const arnB = (b: string) => `arn:aws:s3:::${b}`;
const arnO = (b: string, k: string) => `arn:aws:s3:::${b}/${k}`;

const noPolicy = () => new AwsError('NoSuchBucketPolicy', 'The bucket policy does not exist', 404);

function bucketOf(c: OpCtx): S3Bucket {
  return getBucket(c.acct, c.p.Bucket);
}

/** Etiquetas desde `a=b&c=d`. */
function tagsFromQuery(s: string): Tag[] {
  return s.split('&').filter(Boolean).map((kv) => {
    const [k, v = ''] = kv.split('=');
    return { Key: decodeURIComponent(k), Value: decodeURIComponent(v) };
  });
}

function objectView(v: S3Version, key: string, size = true) {
  return { Key: key, LastModified: v.lastModified, ETag: quotedEtag(v), ...(size ? { Size: v.size } : {}), StorageClass: v.storageClass };
}

function putObjectCore(c: OpCtx, bucket: S3Bucket, key: string, body: string, extra: PutOpts = {}) {
  if (c.p.Acl) throw new AwsError('AccessControlListNotSupported', 'The bucket does not allow ACLs', 400);
  const v = s3Put(c.acct, bucket, key, body, {
    contentType: c.p.ContentType,
    storageClass: c.p.StorageClass,
    sse: c.p.ServerSideEncryption,
    tags: c.p.Tagging ? tagsFromQuery(c.p.Tagging) : [],
    metadata: c.p.Metadata,
    ...extra,
  });
  return v;
}

// ───────────────────────── buckets ─────────────────────────

op('s3api', 'list-buckets', '', 'Lista los buckets de la cuenta.', { action: 's3:ListAllMyBuckets', paginate: 'Buckets' }, (c) => ({
  Buckets: sortBy(Object.values(c.acct.s3.buckets), (b) => b.name).map((b) => ({ Name: b.name, CreationDate: b.created })),
  Owner: { DisplayName: 'alumno', ID: ownerId(c.acct) },
}));

op('s3api', 'create-bucket', 'bucket:s! acl:s create-bucket-configuration:j object-ownership:s', 'Crea un bucket. Fuera de us-east-1 hay que indicar la región con LocationConstraint.', {
  res: (c) => arnB(c.p.Bucket),
}, (c) => {
  if (c.p.Acl && c.p.Acl !== 'private') throw new AwsError('InvalidBucketAclWithObjectOwnership', 'Bucket cannot have ACLs set with ObjectOwnership\'s BucketOwnerEnforced setting', 400);
  s3MakeBucket(c.acct, c.p.Bucket, c.region, c.p.CreateBucketConfiguration?.LocationConstraint);
  return { Location: c.region === 'us-east-1' ? `/${c.p.Bucket}` : `http://${c.p.Bucket}.s3.amazonaws.com/` };
});

op('s3api', 'head-bucket', 'bucket:s!', 'Comprueba que el bucket existe y que tienes acceso.', { action: 's3:ListBucket', res: (c) => arnB(c.p.Bucket) }, (c) => {
  if (!c.acct.s3.buckets[c.p.Bucket]) throw new AwsError('404', 'Not Found', 404);
  return undefined;
});

op('s3api', 'delete-bucket', 'bucket:s!', 'Borra un bucket (tiene que estar vacío, incluidas versiones).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (Object.keys(b.objects).length) throw new AwsError('BucketNotEmpty', 'The bucket you tried to delete is not empty', 409);
  delete c.acct.s3.buckets[b.name];
  return undefined;
});

op('s3api', 'get-bucket-location', 'bucket:s!', 'Región en la que está el bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => ({ LocationConstraint: bucketOf(c).region === 'us-east-1' ? null : bucketOf(c).region }));

// ───────────────────────── objetos ─────────────────────────

op('s3api', 'put-object', 'bucket:s! key:s! body:s acl:s content-type:s storage-class:s server-side-encryption:s ssekms-key-id:s tagging:s metadata:j cache-control:s website-redirect-location:s', 'Sube un objeto (--body es un archivo local).', {
  res: (c) => arnO(c.p.Bucket, c.p.Key),
  ctx: (c) => ({ ...(c.p.ServerSideEncryption ? { 's3:x-amz-server-side-encryption': c.p.ServerSideEncryption } : {}), ...(c.p.Acl ? { 's3:x-amz-acl': c.p.Acl } : {}), ...(c.p.StorageClass ? { 's3:x-amz-storage-class': c.p.StorageClass } : {}) }),
}, (c) => {
  const b = bucketOf(c);
  let body = '';
  let size: number | undefined;
  if (c.p.Body !== undefined) {
    const path = c.io.abs(c.p.Body);
    const t = c.io.readFile(path);
    if (t === null) throw new AwsError('ValidationError', `Could not open file ${c.p.Body}`);
    body = t;
    size = c.io.size(path) ?? undefined;
  }
  const v = putObjectCore(c, b, c.p.Key, body, { size, contentType: c.p.ContentType ?? 'binary/octet-stream' });
  const kms = c.p.ServerSideEncryption === 'aws:kms';
  return {
    ETag: quotedEtag(v),
    ServerSideEncryption: c.p.ServerSideEncryption ?? b.encryption.SSEAlgorithm,
    ...(kms ? { SSEKMSKeyId: c.p.SsekmsKeyId ?? 'arn:aws:kms:' + b.region + ':' + c.acct.id + ':alias/aws/s3' } : {}),
    ...(v.versionId !== 'null' ? { VersionId: v.versionId } : {}),
  };
});

op('s3api', 'get-object', 'bucket:s! key:s! outfile:s! version-id:s range:s', 'Descarga un objeto a un archivo local (usa /dev/stdout para verlo).', {
  res: (c) => arnO(c.p.Bucket, c.p.Key),
  action: 's3:GetObject',
  positional: ['outfile'],
}, (c) => {
  const b = bucketOf(c);
  const key = c.p.Key as string;
  let v: S3Version | undefined;
  if (c.p.VersionId) {
    v = b.objects[key]?.find((x) => x.versionId === c.p.VersionId);
    if (!v) throw new AwsError('NoSuchVersion', 'The specified version does not exist.', 404);
    if (v.deleteMarker) throw new AwsError('MethodNotAllowed', 'The specified method is not allowed against this resource.', 405);
  } else {
    v = s3Current(b, key);
    if (!v) throw new AwsError('NoSuchKey', 'The specified key does not exist.', 404);
  }
  if (v.storageClass === 'GLACIER' || v.storageClass === 'DEEP_ARCHIVE') throw new AwsError('InvalidObjectState', 'The operation is not valid for the object\'s storage class', 403);
  const meta = {
    AcceptRanges: 'bytes',
    LastModified: v.lastModified,
    ContentLength: v.size,
    ETag: quotedEtag(v),
    ...(v.versionId !== 'null' ? { VersionId: v.versionId } : {}),
    ContentType: v.contentType || 'binary/octet-stream',
    ServerSideEncryption: v.sse ?? 'AES256',
    Metadata: v.metadata,
  };
  const out = c.p.Outfile as string;
  if (out === '/dev/stdout' || out === '-') return { __stdout: v.body, ...meta };
  c.io.writeFile(c.io.abs(out), v.body);
  return meta;
});

op('s3api', 'head-object', 'bucket:s! key:s! version-id:s', 'Metadatos de un objeto sin descargarlo.', { res: (c) => arnO(c.p.Bucket, c.p.Key), action: 's3:GetObject' }, (c) => {
  const b = bucketOf(c);
  const v = c.p.VersionId ? b.objects[c.p.Key]?.find((x) => x.versionId === c.p.VersionId) : s3Current(b, c.p.Key);
  if (!v || v.deleteMarker) throw new AwsError('404', 'Not Found', 404);
  return {
    AcceptRanges: 'bytes',
    LastModified: v.lastModified,
    ContentLength: v.size,
    ETag: quotedEtag(v),
    ...(v.versionId !== 'null' ? { VersionId: v.versionId } : {}),
    ContentType: v.contentType || 'binary/octet-stream',
    ServerSideEncryption: v.sse ?? 'AES256',
    Metadata: v.metadata,
    ...(v.storageClass !== 'STANDARD' ? { StorageClass: v.storageClass } : {}),
  };
});

op('s3api', 'delete-object', 'bucket:s! key:s! version-id:s', 'Borra un objeto (con versionado crea un marcador de borrado).', {
  res: (c) => arnO(c.p.Bucket, c.p.Key),
  action: 's3:DeleteObject',
  authz: (c) => [{ action: c.p.VersionId ? 's3:DeleteObjectVersion' : 's3:DeleteObject', resource: arnO(c.p.Bucket, c.p.Key) }],
}, (c) => {
  const b = bucketOf(c);
  const r = s3Delete(c.acct, b, c.p.Key, c.p.VersionId);
  if (r.versionId) return { ...(r.marker ? { DeleteMarker: true } : {}), VersionId: r.versionId };
  return {};
});

op('s3api', 'delete-objects', 'bucket:s! delete:j!', 'Borra hasta 1000 objetos de una vez.', { res: (c) => arnB(c.p.Bucket), action: 's3:DeleteObject', authz: (c) => (c.p.Delete?.Objects ?? []).map((o: any) => ({ action: o.VersionId ? 's3:DeleteObjectVersion' : 's3:DeleteObject', resource: arnO(c.p.Bucket, o.Key) })) }, (c) => {
  const b = bucketOf(c);
  const out: any[] = [];
  for (const o of c.p.Delete?.Objects ?? []) {
    const r = s3Delete(c.acct, b, o.Key, o.VersionId);
    out.push({ Key: o.Key, ...(r.versionId ? { VersionId: r.versionId } : {}), ...(r.marker ? { DeleteMarker: true, DeleteMarkerVersionId: r.versionId } : {}) });
  }
  return c.p.Delete?.Quiet === 'true' || c.p.Delete?.Quiet === true ? {} : { Deleted: out };
});

op('s3api', 'copy-object', 'bucket:s! key:s! copy-source:s! storage-class:s server-side-encryption:s acl:s', 'Copia un objeto dentro de S3.', {
  res: (c) => arnO(c.p.Bucket, c.p.Key),
  action: 's3:PutObject',
}, (c) => {
  const src = String(c.p.CopySource).replace(/^\//, '');
  const i = src.indexOf('/');
  if (i < 0) throw new AwsError('InvalidArgument', 'Copy Source must mention the source bucket and key: sourcebucket/sourcekey', 400);
  const sb = getBucket(c.acct, src.slice(0, i));
  const sk = decodeURIComponent(src.slice(i + 1).split('?')[0]);
  const v = s3Current(sb, sk);
  if (!v) throw new AwsError('NoSuchKey', 'The specified key does not exist.', 404);
  const nv = putObjectCore(c, bucketOf(c), c.p.Key, v.body, { size: v.size, contentType: v.contentType, metadata: v.metadata, tags: v.tags, event: 'ObjectCreated:Copy' });
  return { CopyObjectResult: { ETag: quotedEtag(nv), LastModified: nv.lastModified } };
});

function listCore(c: OpCtx, v2: boolean) {
  const b = bucketOf(c);
  const prefix = (c.p.Prefix as string | undefined) ?? '';
  const delim = c.p.Delimiter as string | undefined;
  const start = (v2 ? c.p.StartAfter : c.p.Marker) as string | undefined;
  const keys = s3Keys(b).filter((k) => k.startsWith(prefix) && (!start || k > start));
  const contents: unknown[] = [];
  const prefixes: string[] = [];
  for (const k of keys) {
    if (delim) {
      const rest = k.slice(prefix.length);
      const j = rest.indexOf(delim);
      if (j >= 0) {
        const p = prefix + rest.slice(0, j + delim.length);
        if (!prefixes.includes(p)) prefixes.push(p);
        continue;
      }
    }
    contents.push(objectView(s3Current(b, k)!, k));
  }
  const out: Record<string, unknown> = {};
  if (contents.length) out.Contents = contents;
  if (prefixes.length) out.CommonPrefixes = prefixes.map((Prefix) => ({ Prefix }));
  out.RequestCharged = null;
  out.Prefix = prefix;
  return out;
}

op('s3api', 'list-objects-v2', 'bucket:s! prefix:s delimiter:s max-keys:i start-after:s', 'Lista los objetos de un bucket (con prefijo y delimitador).', { res: (c) => arnB(c.p.Bucket), action: 's3:ListBucket', paginate: 'Contents' }, (c) => {
  const out = listCore(c, true);
  if (c.p.MaxKeys !== undefined) {
    const all = (out.Contents as unknown[] | undefined) ?? [];
    const cut = all.slice(0, c.p.MaxKeys);
    return { ...out, Contents: cut.length ? cut : undefined, KeyCount: cut.length, MaxKeys: c.p.MaxKeys, IsTruncated: all.length > cut.length, Name: c.p.Bucket };
  }
  return out;
});
op('s3api', 'list-objects', 'bucket:s! prefix:s delimiter:s max-keys:i marker:s', 'Lista los objetos de un bucket (versión antigua de la API).', { res: (c) => arnB(c.p.Bucket), action: 's3:ListBucket', paginate: 'Contents' }, (c) => listCore(c, false));

op('s3api', 'list-object-versions', 'bucket:s! prefix:s', 'Lista todas las versiones y marcadores de borrado.', { res: (c) => arnB(c.p.Bucket), action: 's3:ListBucketVersions', paginate: 'Versions' }, (c) => {
  const b = bucketOf(c);
  const versions: unknown[] = [];
  const markers: unknown[] = [];
  const owner = { DisplayName: 'alumno', ID: ownerId(c.acct) };
  for (const k of Object.keys(b.objects).sort()) {
    if (c.p.Prefix && !k.startsWith(c.p.Prefix)) continue;
    const l = b.objects[k];
    [...l].reverse().forEach((v, i) => {
      if (v.deleteMarker) markers.push({ Owner: owner, Key: k, VersionId: v.versionId, IsLatest: i === 0, LastModified: v.lastModified });
      else versions.push({ ETag: quotedEtag(v), Size: v.size, StorageClass: v.storageClass, Key: k, VersionId: v.versionId, IsLatest: i === 0, LastModified: v.lastModified, Owner: owner });
    });
  }
  return { ...(versions.length ? { Versions: versions } : {}), ...(markers.length ? { DeleteMarkers: markers } : {}), RequestCharged: null, Prefix: c.p.Prefix ?? '' };
});

op('s3api', 'put-object-tagging', 'bucket:s! key:s! tagging:j!', 'Pone etiquetas a un objeto.', { res: (c) => arnO(c.p.Bucket, c.p.Key) }, (c) => {
  const v = s3Current(bucketOf(c), c.p.Key);
  if (!v) throw new AwsError('NoSuchKey', 'The specified key does not exist.', 404);
  v.tags = toArr(c.p.Tagging?.TagSet);
  return {};
});
op('s3api', 'get-object-tagging', 'bucket:s! key:s!', 'Lee las etiquetas de un objeto.', { res: (c) => arnO(c.p.Bucket, c.p.Key) }, (c) => {
  const v = s3Current(bucketOf(c), c.p.Key);
  if (!v) throw new AwsError('NoSuchKey', 'The specified key does not exist.', 404);
  return { TagSet: v.tags };
});

// ───────────────────────── configuración del bucket ─────────────────────────

op('s3api', 'put-bucket-versioning', 'bucket:s! versioning-configuration:j! mfa:s', 'Activa o suspende el versionado (Status=Enabled|Suspended).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  const st = c.p.VersioningConfiguration?.Status;
  if (st !== 'Enabled' && st !== 'Suspended') throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
  b.versioning = st;
  return undefined;
});
op('s3api', 'get-bucket-versioning', 'bucket:s!', 'Estado del versionado (vacío si nunca se activó).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  return b.versioning ? { Status: b.versioning } : {};
});

op('s3api', 'put-bucket-policy', 'bucket:s! policy:s! confirm-remove-self-bucket-access:b', 'Pone la política del bucket (JSON).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  let doc: unknown;
  try {
    doc = JSON.parse(c.p.Policy);
  } catch {
    throw new AwsError('MalformedPolicy', 'Policies must be valid JSON and the first byte must be \'{\'', 400);
  }
  const err = validatePolicy(doc, 'resource');
  if (err) throw new AwsError('MalformedPolicy', err.startsWith('Policy statement must contain resources') ? 'Policy has invalid resource' : err, 400);
  const d = doc as PolicyDoc;
  // los recursos tienen que ser del bucket
  for (const st of toArr(d.Statement)) for (const r of toArr(st.Resource)) if (r !== '*' && !r.startsWith(arnB(b.name))) throw new AwsError('MalformedPolicy', 'Policy has invalid resource', 400);
  if (b.publicAccessBlock?.BlockPublicPolicy && isPublicPolicy(d)) throw new AwsError('AccessDenied', 'User: ' + c.caller.arn + ' is not authorized to perform: s3:PutBucketPolicy on resource: "' + arnB(b.name) + '" because public policies are blocked by the BlockPublicPolicy block public access setting.', 403);
  b.policy = d;
  return undefined;
});
op('s3api', 'get-bucket-policy', 'bucket:s!', 'Lee la política del bucket (como texto JSON).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.policy) throw noPolicy();
  return { Policy: JSON.stringify(b.policy) };
});
op('s3api', 'delete-bucket-policy', 'bucket:s!', 'Borra la política del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).policy = undefined;
  return undefined;
});
op('s3api', 'get-bucket-policy-status', 'bucket:s!', '¿Es público el bucket según su política?', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.policy) throw noPolicy();
  return { PolicyStatus: { IsPublic: isPublicPolicy(b.policy) && !b.publicAccessBlock?.RestrictPublicBuckets } };
});

const PAB_KEYS: (keyof PublicAccessBlock)[] = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];
op('s3api', 'put-public-access-block', 'bucket:s! public-access-block-configuration:j!', 'Configura Block Public Access del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  const cfg = c.p.PublicAccessBlockConfiguration as Record<string, unknown>;
  const out = {} as PublicAccessBlock;
  for (const k of PAB_KEYS) out[k] = cfg[k] === true || cfg[k] === 'true';
  b.publicAccessBlock = out;
  return undefined;
});
op('s3api', 'get-public-access-block', 'bucket:s!', 'Lee Block Public Access del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.publicAccessBlock) throw new AwsError('NoSuchPublicAccessBlockConfiguration', 'The public access block configuration was not found', 404);
  return { PublicAccessBlockConfiguration: b.publicAccessBlock };
});
op('s3api', 'delete-public-access-block', 'bucket:s!', 'Quita Block Public Access del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).publicAccessBlock = undefined;
  return undefined;
});

op('s3api', 'put-bucket-encryption', 'bucket:s! server-side-encryption-configuration:j!', 'Cambia el cifrado por defecto del bucket (AES256 o aws:kms).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  const rule = c.p.ServerSideEncryptionConfiguration?.Rules?.[0];
  const d = rule?.ApplyServerSideEncryptionByDefault;
  if (!d?.SSEAlgorithm || !['AES256', 'aws:kms', 'aws:kms:dsse'].includes(d.SSEAlgorithm)) throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
  b.encryption = { SSEAlgorithm: d.SSEAlgorithm, KMSMasterKeyID: d.KMSMasterKeyID, BucketKeyEnabled: rule.BucketKeyEnabled === true || rule.BucketKeyEnabled === 'true' };
  return undefined;
});
op('s3api', 'get-bucket-encryption', 'bucket:s!', 'Lee el cifrado por defecto del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const e = bucketOf(c).encryption;
  return {
    ServerSideEncryptionConfiguration: {
      Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: e.SSEAlgorithm, ...(e.KMSMasterKeyID ? { KMSMasterKeyID: e.KMSMasterKeyID } : {}) }, BucketKeyEnabled: !!e.BucketKeyEnabled }],
    },
  };
});

const STORAGE_CLASSES = ['STANDARD', 'STANDARD_IA', 'ONEZONE_IA', 'INTELLIGENT_TIERING', 'GLACIER', 'GLACIER_IR', 'DEEP_ARCHIVE'];
function checkLifecycle(rules: LifecycleRule[]): void {
  if (!rules.length) throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
  for (const r of rules) {
    if (r.Status !== 'Enabled' && r.Status !== 'Disabled') throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
    if (!r.Filter && r.Prefix === undefined) throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
    for (const t of r.Transitions ?? []) {
      if (!STORAGE_CLASSES.includes(t.StorageClass)) throw new AwsError('MalformedXML', 'The XML you provided was not well-formed or did not validate against our published schema', 400);
      const d = Number(t.Days ?? 0);
      if ((t.StorageClass === 'STANDARD_IA' || t.StorageClass === 'ONEZONE_IA') && t.Days !== undefined && d < 30) throw new AwsError('InvalidArgument', `'Days' in the Transition action for StorageClass '${t.StorageClass}' for filter '(prefix=)' must be 30 days or more`, 400);
    }
    const trs = (r.Transitions ?? []).filter((t) => t.Days !== undefined).map((t) => Number(t.Days));
    if (r.Expiration?.Days !== undefined && trs.some((d) => d >= Number(r.Expiration!.Days))) throw new AwsError('InvalidArgument', "'Days' in the Expiration action must be greater than 'Days' in the Transition action", 400);
  }
}
op('s3api', 'put-bucket-lifecycle-configuration', 'bucket:s! lifecycle-configuration:j!', 'Define reglas de ciclo de vida (transiciones y expiración).', { res: (c) => arnB(c.p.Bucket), action: 's3:PutLifecycleConfiguration' }, (c) => {
  const b = bucketOf(c);
  const rules = toArr<LifecycleRule>(c.p.LifecycleConfiguration?.Rules);
  checkLifecycle(rules);
  b.lifecycle = rules.map((r, i) => ({ ...r, ID: r.ID ?? `rule-${i + 1}` }));
  return undefined;
});
op('s3api', 'get-bucket-lifecycle-configuration', 'bucket:s!', 'Lee las reglas de ciclo de vida.', { res: (c) => arnB(c.p.Bucket), action: 's3:GetLifecycleConfiguration' }, (c) => {
  const b = bucketOf(c);
  if (!b.lifecycle) throw new AwsError('NoSuchLifecycleConfiguration', 'The lifecycle configuration does not exist', 404);
  return { Rules: b.lifecycle };
});
op('s3api', 'delete-bucket-lifecycle', 'bucket:s!', 'Borra las reglas de ciclo de vida.', { res: (c) => arnB(c.p.Bucket), action: 's3:PutLifecycleConfiguration' }, (c) => {
  bucketOf(c).lifecycle = undefined;
  return undefined;
});

op('s3api', 'put-bucket-tagging', 'bucket:s! tagging:j!', 'Pone etiquetas al bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).tags = toArr(c.p.Tagging?.TagSet);
  return undefined;
});
op('s3api', 'get-bucket-tagging', 'bucket:s!', 'Lee las etiquetas del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.tags.length) throw new AwsError('NoSuchTagSet', 'The TagSet does not exist', 404);
  return { TagSet: b.tags };
});
op('s3api', 'delete-bucket-tagging', 'bucket:s!', 'Quita las etiquetas del bucket.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).tags = [];
  return undefined;
});

op('s3api', 'put-bucket-website', 'bucket:s! website-configuration:j!', 'Convierte el bucket en un sitio web estático.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const w = c.p.WebsiteConfiguration;
  if (!w?.IndexDocument?.Suffix) throw new AwsError('InvalidArgument', 'A value for IndexDocument Suffix must be provided if RedirectAllRequestsTo is empty', 400);
  bucketOf(c).website = { IndexDocument: { Suffix: w.IndexDocument.Suffix }, ...(w.ErrorDocument?.Key ? { ErrorDocument: { Key: w.ErrorDocument.Key } } : {}) };
  return undefined;
});
op('s3api', 'get-bucket-website', 'bucket:s!', 'Lee la configuración de sitio web.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.website) throw new AwsError('NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration', 404);
  return b.website;
});
op('s3api', 'delete-bucket-website', 'bucket:s!', 'Quita la configuración de sitio web.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).website = undefined;
  return undefined;
});

op('s3api', 'get-bucket-acl', 'bucket:s!', 'ACL del bucket (con ACL desactivadas solo aparece el propietario).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c);
  return { Owner: { DisplayName: 'alumno', ID: ownerId(c.acct) }, Grants: [{ Grantee: { DisplayName: 'alumno', ID: ownerId(c.acct), Type: 'CanonicalUser' }, Permission: 'FULL_CONTROL' }] };
});
op('s3api', 'put-bucket-acl', 'bucket:s! acl:s', 'Cambia la ACL del bucket (en buckets nuevos las ACL están desactivadas).', { res: (c) => arnB(c.p.Bucket) }, () => {
  throw new AwsError('AccessControlListNotSupported', 'The bucket does not allow ACLs', 400);
});
op('s3api', 'get-bucket-ownership-controls', 'bucket:s!', 'Propiedad de objetos (BucketOwnerEnforced = ACL desactivadas).', { res: (c) => arnB(c.p.Bucket) }, (c) => (bucketOf(c), { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } }));

op('s3api', 'put-bucket-cors', 'bucket:s! cors-configuration:j!', 'Define las reglas CORS.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  bucketOf(c).cors = toArr(c.p.CorsConfiguration?.CORSRules);
  return undefined;
});
op('s3api', 'get-bucket-cors', 'bucket:s!', 'Lee las reglas CORS.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.cors) throw new AwsError('NoSuchCORSConfiguration', 'The CORS configuration does not exist', 404);
  return { CORSRules: b.cors };
});

op('s3api', 'put-bucket-replication', 'bucket:s! replication-configuration:j!', 'Configura la replicación (hace falta versionado en origen y destino).', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (b.versioning !== 'Enabled') throw new AwsError('InvalidRequest', "Versioning must be 'Enabled' on the bucket to apply a replication configuration", 400);
  const rules = toArr<Record<string, any>>(c.p.ReplicationConfiguration?.Rules);
  for (const r of rules) {
    const dest = String(r.Destination?.Bucket ?? '').replace('arn:aws:s3:::', '');
    const db = c.acct.s3.buckets[dest];
    if (!db) throw new AwsError('InvalidRequest', 'Destination bucket must exist.', 400);
    if (db.versioning !== 'Enabled') throw new AwsError('InvalidRequest', 'Destination bucket must have versioning enabled.', 400);
  }
  b.replication = clone(c.p.ReplicationConfiguration);
  return undefined;
});
op('s3api', 'get-bucket-replication', 'bucket:s!', 'Lee la configuración de replicación.', { res: (c) => arnB(c.p.Bucket) }, (c) => {
  const b = bucketOf(c);
  if (!b.replication) throw new AwsError('ReplicationConfigurationNotFoundError', 'The replication configuration was not found', 404);
  return { ReplicationConfiguration: b.replication };
});

export { arnB, arnO };
