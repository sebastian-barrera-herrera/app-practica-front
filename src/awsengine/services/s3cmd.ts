/** `aws s3 …`: los comandos de alto nivel (mb, rb, ls, cp, mv, rm, sync, presign, website). */
import { sha256 } from '../../engine/commands/hash';
import { authorize } from '../authz';
import { AwsError, Raw, op, type AuthzTarget, type OpCtx } from '../registry';
import { iso, s3Date, secretFor, wildcard } from '../util';
import { arnB, arnO, getBucket, guessType, s3Current, s3Delete, s3Keys, s3MakeBucket, s3Put, s3Sse, s3SseRead } from './s3';

const URI = /^s3:\/\/([^/]+)(?:\/(.*))?$/s;

interface S3Uri {
  bucket: string;
  key: string;
}

function parseUri(p: string): S3Uri | null {
  const m = URI.exec(p);
  return m ? { bucket: m[1], key: m[2] ?? '' } : null;
}

const uriOf = (u: S3Uri) => `s3://${u.bucket}${u.key || u.bucket ? '/' : ''}${u.key}`;

/** Ruta tal y como la enseña la CLI: relativa al directorio actual (`./a.txt`, `fotos/b.jpg`). */
function show(c: OpCtx, abs: string): string {
  const cwd = c.io.cwd.replace(/\/$/, '');
  if (abs.startsWith(cwd + '/')) {
    const rest = abs.slice(cwd.length + 1);
    return rest.includes('/') ? rest : './' + rest;
  }
  const a = abs.split('/').filter(Boolean);
  const b = cwd.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...Array(b.length - i).fill('..'), ...a.slice(i)].join('/');
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? p;

function humanSize(n: number): string {
  if (n < 1024) return `${n} Bytes`;
  const u = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
}

/** Aplica --exclude / --include (los include vuelven a admitir lo excluido). */
function included(c: OpCtx, rel: string): boolean {
  let ok = true;
  for (const p of (c.p.Exclude as string[] | undefined) ?? []) if (wildcard(p, rel)) ok = false;
  for (const p of (c.p.Include as string[] | undefined) ?? []) if (wildcard(p, rel)) ok = true;
  return ok;
}

const allow = (c: OpCtx, targets: AuthzTarget[]) => authorize(c, targets);

/** Convierte un AwsError en la línea «… failed: … An error occurred» de la CLI. */
function failLine(verb: string, what: string, api: string, e: AwsError): string {
  return `${verb} failed: ${what} An error occurred (${e.code}) when calling the ${api} operation: ${e.message}`;
}

interface Out {
  lines: string[];
  errors: string[];
  code: number;
  /** Salida sin salto de línea (cuando el destino es «-»). */
  raw?: string;
}

const quiet = (c: OpCtx) => !!c.p.Quiet || !!c.p.OnlyShowErrors;
const dry = (c: OpCtx) => (c.p.Dryrun ? '(dryrun) ' : '');

function finish(c: OpCtx, o: Out): Raw {
  return new Raw((quiet(c) ? '' : o.lines.map((l) => l + '\n').join('')) + (o.raw ?? ''), o.errors.map((l) => l + '\n').join(''), o.code);
}

// ───────────────────────── mb / rb ─────────────────────────

op('s3', 'mb', 'paths:l! region:s', 'Crea un bucket (s3://nombre).', { positional: ['paths'], authz: false }, (c) => {
  const u = parseUri(c.p.Paths[0]);
  if (!u || u.key) return new Raw('', `\n"${c.p.Paths[0]}" is not a valid bucket name.\n`, 252);
  const region = c.p.Region ?? c.region;
  try {
    allow(c, [{ action: 's3:CreateBucket', resource: arnB(u.bucket) }]);
    s3MakeBucket(c.acct, u.bucket, region, region === 'us-east-1' ? undefined : region);
  } catch (e) {
    if (e instanceof AwsError) return new Raw('', failLine('make_bucket', `s3://${u.bucket}`, 'CreateBucket', e) + '\n', 1);
    throw e;
  }
  return new Raw(`make_bucket: ${u.bucket}\n`);
});

op('s3', 'rb', 'paths:l! force:b', 'Borra un bucket vacío (con --force lo vacía antes).', { positional: ['paths'], authz: false }, (c) => {
  const u = parseUri(c.p.Paths[0]);
  if (!u || u.key) return new Raw('', `\n"${c.p.Paths[0]}" is not a valid bucket name.\n`, 252);
  const out: Out = { lines: [], errors: [], code: 0 };
  try {
    const b = getBucket(c.acct, u.bucket);
    if (c.p.Force) {
      allow(c, [{ action: 's3:ListBucket', resource: arnB(u.bucket) }]);
      for (const k of Object.keys(b.objects)) {
        allow(c, [{ action: 's3:DeleteObject', resource: arnO(u.bucket, k) }]);
        delete b.objects[k];
        out.lines.push(`delete: s3://${u.bucket}/${k}`);
      }
    }
    allow(c, [{ action: 's3:DeleteBucket', resource: arnB(u.bucket) }]);
    if (Object.keys(b.objects).length) throw new AwsError('BucketNotEmpty', 'The bucket you tried to delete is not empty', 409);
    delete c.acct.s3.buckets[u.bucket];
    out.lines.push(`remove_bucket: ${u.bucket}`);
  } catch (e) {
    if (e instanceof AwsError) {
      out.errors.push(failLine('remove_bucket', `s3://${u.bucket}`, 'DeleteBucket', e));
      out.code = 1;
    } else throw e;
  }
  return finish(c, out);
});

// ───────────────────────── ls ─────────────────────────

op('s3', 'ls', 'paths:l recursive:b human-readable:b summarize:b page-size:i request-payer:s', 'Lista buckets u objetos.', { positional: ['paths'], authz: false }, (c) => {
  const path = (c.p.Paths as string[] | undefined)?.[0];
  const lines: string[] = [];
  try {
    if (!path) {
      allow(c, [{ action: 's3:ListAllMyBuckets', resource: '*' }]);
      for (const b of Object.values(c.acct.s3.buckets).sort((x, y) => (x.name < y.name ? -1 : 1))) lines.push(`${s3Date(Date.parse(b.created))} ${b.name}`);
      return new Raw(lines.map((l) => l + '\n').join(''));
    }
    const u = parseUri(path) ?? { bucket: path.replace(/\/.*$/, ''), key: path.includes('/') ? path.slice(path.indexOf('/') + 1) : '' };
    const bucket = getBucket(c.acct, u.bucket);
    allow(c, [{ action: 's3:ListBucket', resource: arnB(u.bucket), context: { 's3:prefix': u.key, ...(c.p.Recursive ? {} : { 's3:delimiter': '/' }) } }]);
    const keys = s3Keys(bucket).filter((k) => k.startsWith(u.key));
    const dirPrefix = u.key.slice(0, u.key.lastIndexOf('/') + 1);
    const prefixes: string[] = [];
    let total = 0;
    let size = 0;
    const fmtSize = (n: number) => (c.p.HumanReadable ? humanSize(n) : String(n)).padStart(c.p.HumanReadable ? 10 : 10, ' ');
    for (const k of keys) {
      if (!c.p.Recursive) {
        const rest = k.slice(u.key.length);
        const j = rest.indexOf('/');
        if (j >= 0) {
          const pre = u.key + rest.slice(0, j + 1);
          if (!prefixes.includes(pre)) {
            prefixes.push(pre);
            lines.push(`${'PRE'.padStart(30, ' ')} ${pre.slice(dirPrefix.length)}`);
          }
          continue;
        }
      }
      const v = s3Current(bucket, k)!;
      total++;
      size += v.size;
      lines.push(`${s3Date(Date.parse(v.lastModified))} ${fmtSize(v.size)} ${c.p.Recursive ? k : k.slice(dirPrefix.length)}`);
    }
    let text = lines.map((l) => l + '\n').join('');
    if (c.p.Summarize) text += `\nTotal Objects: ${total}\n   Total Size: ${c.p.HumanReadable ? humanSize(size) : size}\n`;
    return new Raw(text, '', !lines.length && u.key ? 1 : 0);
  } catch (e) {
    if (e instanceof AwsError) return new Raw('', `\nAn error occurred (${e.code}) when calling the ${path ? 'ListObjectsV2' : 'ListBuckets'} operation: ${e.message}\n`, 254);
    throw e;
  }
});

// ───────────────────────── rm ─────────────────────────

op('s3', 'rm', 'paths:l! recursive:b exclude:r include:r dryrun:b quiet:b only-show-errors:b', 'Borra objetos.', { positional: ['paths'], authz: false }, (c) => {
  const u = parseUri(c.p.Paths[0]);
  if (!u) return new Raw('', `\n"${c.p.Paths[0]}" is not a valid S3 path.\n`, 252);
  const out: Out = { lines: [], errors: [], code: 0 };
  try {
    const b = getBucket(c.acct, u.bucket);
    const keys = c.p.Recursive ? s3Keys(b).filter((k) => k.startsWith(u.key) && included(c, k.slice(u.key.length))) : [u.key];
    if (c.p.Recursive) allow(c, [{ action: 's3:ListBucket', resource: arnB(u.bucket) }]);
    if (!c.p.Recursive && !u.key) return new Raw('', `\nfatal error: Expected a key to delete (use --recursive to delete a whole prefix)\n`, 252);
    for (const k of keys) {
      allow(c, [{ action: 's3:DeleteObject', resource: arnO(u.bucket, k) }]);
      if (!c.p.Dryrun) s3Delete(c.acct, b, k);
      out.lines.push(`${dry(c)}delete: s3://${u.bucket}/${k}`);
    }
  } catch (e) {
    if (e instanceof AwsError) {
      out.errors.push(failLine('delete', uriOf(u), 'DeleteObject', e));
      out.code = 1;
    } else throw e;
  }
  return finish(c, out);
});

// ───────────────────────── cp / mv / sync ─────────────────────────

interface Item {
  /** Origen: ruta local absoluta o clave. */
  from: { local?: string; bucket?: string; key?: string };
  to: { local?: string; bucket?: string; key?: string };
  rel: string;
}

const GLACIER = ['GLACIER', 'DEEP_ARCHIVE'];

function dispFrom(c: OpCtx, f: Item['from']) {
  return f.local !== undefined ? show(c, f.local) : `s3://${f.bucket}/${f.key}`;
}
function dispTo(c: OpCtx, t: Item['to']) {
  return t.local !== undefined ? show(c, t.local) : `s3://${t.bucket}/${t.key}`;
}

/** Ejecuta una transferencia individual. Devuelve la línea de éxito o lanza AwsError. */
function transferOne(c: OpCtx, it: Item, verb: string, out: Out): void {
  const label = `${dry(c)}${verb}: ${dispFrom(c, it.from)} to ${dispTo(c, it.to)}`;
  try {
    if (it.from.local !== undefined && it.to.bucket !== undefined) {
      // subir
      const path = it.from.local;
      const body = it.from.local === '-' ? '' : c.io.readFile(path) ?? '';
      allow(c, [{ action: 's3:PutObject', resource: arnO(it.to.bucket, it.to.key!), context: { ...(c.p.Sse ? { 's3:x-amz-server-side-encryption': c.p.Sse } : {}), ...(c.p.StorageClass ? { 's3:x-amz-storage-class': c.p.StorageClass } : {}) } }]);
      const b = getBucket(c.acct, it.to.bucket);
      if (c.p.Acl) throw new AwsError('AccessControlListNotSupported', 'The bucket does not allow ACLs', 400);
      const enc = s3Sse(c, b, { sse: c.p.Sse, keyId: c.p.SseKmsKeyId, objectArn: arnO(it.to.bucket, it.to.key!) });
      if (!c.p.Dryrun) s3Put(c.acct, b, it.to.key!, body, { size: c.io.size(path) ?? undefined, contentType: c.p.ContentType ?? guessType(it.to.key!), storageClass: c.p.StorageClass, sse: enc.sse, kmsKeyId: enc.kmsKeyId, metadata: c.p.Metadata });
    } else if (it.from.bucket !== undefined && it.to.local !== undefined) {
      // bajar
      allow(c, [{ action: 's3:GetObject', resource: arnO(it.from.bucket, it.from.key!) }]);
      const v = s3Current(getBucket(c.acct, it.from.bucket), it.from.key!);
      if (!v) throw new AwsError('404', `Key "${it.from.key}" does not exist`, 404);
      s3SseRead(c, v, arnO(it.from.bucket, it.from.key!));
      if (GLACIER.includes(v.storageClass)) {
        out.errors.push(`warning: Skipping file s3://${it.from.bucket}/${it.from.key}. Object is of storage class ${v.storageClass}. Unable to perform download operations on ${v.storageClass} objects. You must restore the object to be able to perform the operation. See aws s3 download help for additional parameter options to ignore or force these transfers.`);
        out.code = Math.max(out.code, 2);
        return;
      }
      if (!c.p.Dryrun) {
        if (it.to.local === '-') {
          out.raw = (out.raw ?? '') + v.body;
          return;
        }
        c.io.writeFile(it.to.local, v.body);
      }
    } else if (it.from.bucket !== undefined && it.to.bucket !== undefined) {
      // copiar dentro de S3
      allow(c, [{ action: 's3:GetObject', resource: arnO(it.from.bucket, it.from.key!) }, { action: 's3:PutObject', resource: arnO(it.to.bucket, it.to.key!) }]);
      const v = s3Current(getBucket(c.acct, it.from.bucket), it.from.key!);
      if (!v) throw new AwsError('404', `Key "${it.from.key}" does not exist`, 404);
      if (GLACIER.includes(v.storageClass)) {
        out.errors.push(`warning: Skipping file s3://${it.from.bucket}/${it.from.key}. Object is of storage class ${v.storageClass}. Unable to perform copy operations on ${v.storageClass} objects. You must restore the object to be able to perform the operation. See aws s3 copy help for additional parameter options to ignore or force these transfers.`);
        out.code = Math.max(out.code, 2);
        return;
      }
      s3SseRead(c, v, arnO(it.from.bucket, it.from.key!));
      const dst = getBucket(c.acct, it.to.bucket);
      const enc = s3Sse(c, dst, { sse: c.p.Sse, keyId: c.p.SseKmsKeyId, objectArn: arnO(it.to.bucket, it.to.key!) });
      if (!c.p.Dryrun) s3Put(c.acct, dst, it.to.key!, v.body, { size: v.size, contentType: v.contentType, storageClass: c.p.StorageClass ?? undefined, metadata: v.metadata, tags: v.tags, event: 'ObjectCreated:Copy', sse: enc.sse, kmsKeyId: enc.kmsKeyId });
    }
    out.lines.push(label);
  } catch (e) {
    if (!(e instanceof AwsError)) throw e;
    const api = e.code === '404' ? 'HeadObject' : it.from.local !== undefined ? 'PutObject' : it.to.bucket !== undefined ? 'CopyObject' : 'GetObject';
    out.errors.push(it.from.local !== undefined ? failLine(verb === 'move' ? 'move' : 'upload', `${dispFrom(c, it.from)} to ${dispTo(c, it.to)}`, api, e) : e.code === '404' ? `fatal error: An error occurred (404) when calling the HeadObject operation: ${e.message}` : failLine(verb === 'move' ? 'move' : it.to.bucket !== undefined ? 'copy' : 'download', `${dispFrom(c, it.from)} to ${dispTo(c, it.to)}`, api, e));
    out.code = Math.max(out.code, 1);
  }
}

/** Reúne los elementos que hay que transferir para cp/mv. */
function planCopy(c: OpCtx, src: string, dst: string, out: Out): Item[] | null {
  const su = parseUri(src);
  const du = parseUri(dst);
  const recursive = !!c.p.Recursive;
  const items: Item[] = [];
  const dstDirLike = (p: string) => p.endsWith('/') || c.io.isDir(c.io.abs(p));
  if (!su && !du) {
    out.errors.push('\nfatal error: Error: Invalid argument type');
    out.code = 252;
    return null;
  }
  if (!su) {
    // local → S3
    const du2 = du!;
    if (src === '-') return [{ from: { local: '-' }, to: { bucket: du2.bucket, key: du2.key.endsWith('/') || !du2.key ? du2.key + 'stdin' : du2.key }, rel: '' }];
    const abs = c.io.abs(src);
    if (recursive) {
      const files = c.io.listFiles(abs);
      if (!files) {
        if (c.io.readFile(abs) === null) {
          out.errors.push(`The user-provided path ${src} does not exist.`);
          out.code = 255;
          return null;
        }
      } else {
        for (const f of files.sort((x, y) => (x.rel < y.rel ? -1 : 1))) {
          if (!included(c, f.rel)) continue;
          const base = du2.key && !du2.key.endsWith('/') ? du2.key + '/' : du2.key;
          items.push({ from: { local: `${abs.replace(/\/$/, '')}/${f.rel}` }, to: { bucket: du2.bucket, key: base + f.rel }, rel: f.rel });
        }
        return items;
      }
    }
    if (c.io.isDir(abs)) {
      out.errors.push(`upload failed: ${show(c, abs)} to s3://${du2.bucket}/${du2.key} [Errno 21] Is a directory: '${abs}'`);
      out.code = 1;
      return null;
    }
    if (c.io.readFile(abs) === null) {
      out.errors.push(`The user-provided path ${src} does not exist.`);
      out.code = 255;
      return null;
    }
    if (!included(c, basename(src))) return [];
    const key = !du2.key || du2.key.endsWith('/') ? du2.key + basename(src) : du2.key;
    return [{ from: { local: abs }, to: { bucket: du2.bucket, key }, rel: basename(src) }];
  }
  if (!du) {
    // S3 → local
    const b = getBucket(c.acct, su.bucket);
    if (dst === '-') return [{ from: { bucket: su.bucket, key: su.key }, to: { local: '-' }, rel: '' }];
    if (recursive) {
      const pre = su.key && !su.key.endsWith('/') ? su.key + '/' : su.key;
      for (const k of s3Keys(b).filter((x) => x.startsWith(pre))) {
        const rel = k.slice(pre.length);
        if (!included(c, rel)) continue;
        items.push({ from: { bucket: su.bucket, key: k }, to: { local: `${c.io.abs(dst).replace(/\/$/, '')}/${rel}` }, rel });
      }
      return items;
    }
    if (!included(c, basename(su.key))) return [];
    const target = dstDirLike(dst) ? `${c.io.abs(dst).replace(/\/$/, '')}/${basename(su.key)}` : c.io.abs(dst);
    return [{ from: { bucket: su.bucket, key: su.key }, to: { local: target }, rel: basename(su.key) }];
  }
  // S3 → S3
  const b = getBucket(c.acct, su.bucket);
  if (recursive) {
    const pre = su.key && !su.key.endsWith('/') ? su.key + '/' : su.key;
    for (const k of s3Keys(b).filter((x) => x.startsWith(pre))) {
      const rel = k.slice(pre.length);
      if (!included(c, rel)) continue;
      const base = du.key && !du.key.endsWith('/') ? du.key + '/' : du.key;
      items.push({ from: { bucket: su.bucket, key: k }, to: { bucket: du.bucket, key: base + rel }, rel });
    }
    return items;
  }
  const key = !du.key || du.key.endsWith('/') ? du.key + basename(su.key) : du.key;
  return [{ from: { bucket: su.bucket, key: su.key }, to: { bucket: du.bucket, key }, rel: basename(su.key) }];
}

const TRANSFER_PARAMS = 'paths:l! recursive:b exclude:r include:r dryrun:b quiet:b only-show-errors:b no-progress:b acl:s storage-class:s sse:s sse-kms-key-id:s content-type:s metadata:j cache-control:s expires:s follow-symlinks:b no-follow-symlinks:b';

function runTransfer(c: OpCtx, mv: boolean): Raw {
  const [src, dst] = c.p.Paths as string[];
  if (!dst) return new Raw('', `usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\n\naws: error: the following arguments are required: dest\n`, 252);
  const out: Out = { lines: [], errors: [], code: 0 };
  let items: Item[] | null;
  try {
    items = planCopy(c, src, dst, out);
  } catch (e) {
    if (e instanceof AwsError) {
      out.errors.push(`fatal error: An error occurred (${e.code}) when calling the ListObjectsV2 operation: ${e.message}`);
      out.code = 1;
      return finish(c, out);
    }
    throw e;
  }
  if (!items) return finish(c, out);
  if (!items.length && (parseUri(src) && c.p.Recursive)) {
    out.code = 1;
    out.errors.push('');
  }
  for (const it of items) {
    const before = out.errors.length;
    transferOne(c, it, mv ? 'move' : parseUri(src) ? (parseUri(dst) ? 'copy' : 'download') : 'upload', out);
    // mv: tras una copia correcta se borra el origen
    if (mv && out.errors.length === before && !c.p.Dryrun) {
      if (it.from.local !== undefined) c.io.removeFile(it.from.local);
      else if (it.from.bucket !== undefined) {
        try {
          allow(c, [{ action: 's3:DeleteObject', resource: arnO(it.from.bucket, it.from.key!) }]);
          s3Delete(c.acct, getBucket(c.acct, it.from.bucket), it.from.key!);
        } catch (e) {
          if (e instanceof AwsError) {
            out.errors.push(failLine('move', `${dispFrom(c, it.from)} to ${dispTo(c, it.to)}`, 'DeleteObject', e));
            out.code = 1;
          } else throw e;
        }
      }
    }
  }
  return finish(c, out);
}

op('s3', 'cp', TRANSFER_PARAMS, 'Copia archivos entre tu equipo y S3 (o entre buckets).', { positional: ['paths'], authz: false }, (c) => runTransfer(c, false));
op('s3', 'mv', TRANSFER_PARAMS, 'Mueve archivos (copia y borra el origen).', { positional: ['paths'], authz: false }, (c) => runTransfer(c, true));

op('s3', 'sync', 'paths:l! delete:b exclude:r include:r dryrun:b quiet:b only-show-errors:b no-progress:b size-only:b exact-timestamps:b acl:s storage-class:s sse:s content-type:s', 'Sincroniza un directorio con un prefijo de S3 (solo transfiere lo nuevo o cambiado).', { positional: ['paths'], authz: false }, (c) => {
  const [src, dst] = c.p.Paths as string[];
  const out: Out = { lines: [], errors: [], code: 0 };
  if (!dst) return new Raw('', `usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\n\naws: error: the following arguments are required: dest\n`, 252);
  const su = parseUri(src);
  const du = parseUri(dst);
  if (!su && !du) return new Raw('', '\nfatal error: Error: Invalid argument type\n', 252);
  try {
    const norm = (k: string) => (k && !k.endsWith('/') ? k + '/' : k);
    interface Ent { rel: string; size: number; mtime: number }
    const listLocal = (p: string): Ent[] | null => {
      const abs = c.io.abs(p);
      const f = c.io.listFiles(abs);
      if (f === null) return c.io.isDir(abs) ? [] : null;
      return f.map((x) => ({ rel: x.rel, size: x.size, mtime: x.mtime }));
    };
    const listS3 = (u: S3Uri): Ent[] => {
      const b = getBucket(c.acct, u.bucket);
      allow(c, [{ action: 's3:ListBucket', resource: arnB(u.bucket) }]);
      const pre = norm(u.key);
      return s3Keys(b).filter((k) => k.startsWith(pre)).map((k) => ({ rel: k.slice(pre.length), size: s3Current(b, k)!.size, mtime: Date.parse(s3Current(b, k)!.lastModified) }));
    };
    let from: Ent[];
    let to: Ent[];
    if (!su) {
      const l = listLocal(src);
      if (l === null) return new Raw('', `\nfatal error: The user-provided path ${src} does not exist.\n`, 255);
      from = l;
      to = listS3(du!);
    } else if (!du) {
      from = listS3(su);
      to = listLocal(dst) ?? [];
    } else {
      from = listS3(su);
      to = listS3(du);
    }
    const toMap = new Map(to.map((e) => [e.rel, e]));
    from = from.filter((e) => included(c, e.rel));
    for (const e of from.sort((x, y) => (x.rel < y.rel ? -1 : 1))) {
      const t = toMap.get(e.rel);
      const same = t && t.size === e.size && (c.p.SizeOnly || e.mtime <= t.mtime);
      if (same) continue;
      const it: Item = !su
        ? { from: { local: `${c.io.abs(src).replace(/\/$/, '')}/${e.rel}` }, to: { bucket: du!.bucket, key: norm(du!.key) + e.rel }, rel: e.rel }
        : !du
          ? { from: { bucket: su.bucket, key: norm(su.key) + e.rel }, to: { local: `${c.io.abs(dst).replace(/\/$/, '')}/${e.rel}` }, rel: e.rel }
          : { from: { bucket: su.bucket, key: norm(su.key) + e.rel }, to: { bucket: du.bucket, key: norm(du.key) + e.rel }, rel: e.rel };
      transferOne(c, it, !su ? 'upload' : !du ? 'download' : 'copy', out);
    }
    if (c.p.Delete) {
      const fromSet = new Set(from.map((e) => e.rel));
      for (const t of to.filter((e) => included(c, e.rel) && !fromSet.has(e.rel))) {
        if (du) {
          const b = getBucket(c.acct, du.bucket);
          allow(c, [{ action: 's3:DeleteObject', resource: arnO(du.bucket, norm(du.key) + t.rel) }]);
          if (!c.p.Dryrun) s3Delete(c.acct, b, norm(du.key) + t.rel);
          out.lines.push(`${dry(c)}delete: s3://${du.bucket}/${norm(du.key)}${t.rel}`);
        } else {
          const p = `${c.io.abs(dst).replace(/\/$/, '')}/${t.rel}`;
          if (!c.p.Dryrun) c.io.removeFile(p);
          out.lines.push(`${dry(c)}delete: ${show(c, p)}`);
        }
      }
    }
  } catch (e) {
    if (e instanceof AwsError) {
      out.errors.push(`\nAn error occurred (${e.code}) when calling the ListObjectsV2 operation: ${e.message}`);
      out.code = 1;
    } else throw e;
  }
  return finish(c, out);
});

// ───────────────────────── presign / website ─────────────────────────

/** Firma simulada de una URL prefirmada (la comprueba `verifyPresigned`). */
export function signUrl(secret: string, bucket: string, key: string, date: string, expires: number): string {
  return sha256(`${secret}\n${bucket}\n${key}\n${date}\n${expires}`);
}

op('s3', 'presign', 'paths:l! expires-in:i', 'Genera una URL temporal para leer un objeto privado.', { positional: ['paths'], authz: false }, (c) => {
  const u = parseUri(c.p.Paths[0]);
  if (!u || !u.key) return new Raw('', `\n"${c.p.Paths[0]}" is not a valid S3 object path.\n`, 252);
  const exp = c.p.ExpiresIn ?? 3600;
  const b = c.acct.s3.buckets[u.bucket];
  const region = b?.region ?? c.region;
  const stamp = iso(c.acct.clock).replace(/[-:]/g, '').replace('+0000', 'Z');
  const date = stamp.slice(0, 8);
  const akid = c.caller.accessKeyId;
  const sig = signUrl(secretFor(akid), u.bucket, u.key, stamp, exp);
  const host = region === 'us-east-1' ? `${u.bucket}.s3.amazonaws.com` : `${u.bucket}.s3.${region}.amazonaws.com`;
  const token = akid.startsWith('ASIA') ? '&X-Amz-Security-Token=' + encodeURIComponent(c.io.env.AWS_SESSION_TOKEN ?? '') : '';
  const url = `https://${host}/${u.key.split('/').map(encodeURIComponent).join('/')}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${akid}%2F${date}%2F${region}%2Fs3%2Faws4_request&X-Amz-Date=${stamp}&X-Amz-Expires=${exp}&X-Amz-SignedHeaders=host${token}&X-Amz-Signature=${sig}`;
  return new Raw(url + '\n');
});

op('s3', 'website', 'paths:l! index-document:s error-document:s', 'Activa el alojamiento de sitio web estático en un bucket.', { positional: ['paths'], authz: false }, (c) => {
  const u = parseUri(c.p.Paths[0]);
  if (!u) return new Raw('', `\n"${c.p.Paths[0]}" is not a valid bucket name.\n`, 252);
  try {
    allow(c, [{ action: 's3:PutBucketWebsite', resource: arnB(u.bucket) }]);
    const b = getBucket(c.acct, u.bucket);
    if (!c.p.IndexDocument) throw new AwsError('InvalidArgument', 'A value for IndexDocument Suffix must be provided if RedirectAllRequestsTo is empty', 400);
    b.website = { IndexDocument: { Suffix: c.p.IndexDocument }, ...(c.p.ErrorDocument ? { ErrorDocument: { Key: c.p.ErrorDocument } } : {}) };
  } catch (e) {
    if (e instanceof AwsError) return new Raw('', `\nAn error occurred (${e.code}) when calling the PutBucketWebsite operation: ${e.message}\n`, 254);
    throw e;
  }
  return new Raw('');
});
