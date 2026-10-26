/**
 * El «internet» de AWS visto desde la terminal: lo que responden `curl` y `wget` cuando apuntas a un bucket de S3
 * (público, privado, URL prefirmada, sitio web estático) o a una instancia EC2 (según su grupo de seguridad).
 */
import { hostResolvers, httpHandlers, type Fetched } from '../engine/commands/internet';
import type { System } from '../engine/sys';
import { evaluate, principalPolicies, type PolicySource } from './policy';
import { awsAccountOf } from './state';
import { anonymousAllowed, anonymousCanRead } from './services/s3';
import { signUrl } from './services/s3cmd';
import type { Account, S3Bucket } from './types';
import { cidrContainsIp, secretFor, stableId } from './util';
import { md5 } from '../engine/commands/hash';

const S3_WEBSITE = /^([a-z0-9][a-z0-9.-]*)\.s3-website[.-]([a-z0-9-]+)\.amazonaws\.com$/;
const S3_VIRTUAL = /^([a-z0-9][a-z0-9.-]*)\.s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/;
const S3_PATH = /^s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/;
const EC2_DNS = /^ec2-(\d+)-(\d+)-(\d+)-(\d+)\.(?:compute-1|[a-z0-9-]+\.compute)\.amazonaws\.com$/;

const anonCtx = (a: Account) => ({ 'aws:SourceIp': a.sourceIp, 'aws:SecureTransport': true, 'aws:CurrentTime': new Date(a.clock).toISOString().replace(/\.\d+Z$/, 'Z') });

const requestId = (seed: string) => stableId('req:' + seed, '', 16, 'up');

const xml = (code: string, message: string, extra = '', seed = code) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message>${extra}<RequestId>${requestId(seed)}</RequestId><HostId>${stableId('host:' + seed, '', 60, 'b64')}=</HostId></Error>`;

const resp = (status: number, type: string, body: string, headers: Record<string, string> = {}): Fetched => ({
  ok: true,
  status,
  type,
  body,
  size: body.length,
  headers: { 'x-amz-request-id': requestId(body.slice(0, 20)), Server: 'AmazonS3', ...headers },
});

const stampMs = (s: string): number => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};

function objectResponse(b: S3Bucket, key: string, status = 200): Fetched {
  const l = b.objects[key];
  const v = l?.[l.length - 1];
  if (!v || v.deleteMarker) return resp(404, 'application/xml', xml('NoSuchKey', 'The specified key does not exist.', `<Key>${key}</Key>`, key));
  return resp(status, v.contentType || 'binary/octet-stream', v.body, { ETag: `"${v.etag}"`, 'Last-Modified': new Date(Date.parse(v.lastModified)).toUTCString(), 'Content-Length': String(v.size), ...(v.sse ? { 'x-amz-server-side-encryption': v.sse } : {}) });
}

/** Quién firmó una URL prefirmada y si todavía puede leer ese objeto. */
function presigned(a: Account, b: S3Bucket, key: string, q: URLSearchParams): Fetched {
  const cred = q.get('X-Amz-Credential') ?? '';
  const akid = cred.split('/')[0];
  const stamp = q.get('X-Amz-Date') ?? '';
  const exp = Number(q.get('X-Amz-Expires') ?? '0');
  const sig = q.get('X-Amz-Signature') ?? '';
  if (!akid || !stamp || !sig) return resp(400, 'application/xml', xml('AuthorizationQueryParametersError', 'Query-string authentication version 4 requires the X-Amz-Algorithm, X-Amz-Credential, X-Amz-Signature, X-Amz-Date, X-Amz-SignedHeaders, and X-Amz-Expires parameters.', '', 'q'));
  if (sig !== signUrl(secretFor(akid), b.name, key, stamp, exp)) return resp(403, 'application/xml', xml('SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided. Check your key and signing method.', `<AWSAccessKeyId>${akid}</AWSAccessKeyId>`, 'sig'));
  const start = stampMs(stamp);
  if (a.clock > start + exp * 1000) return resp(403, 'application/xml', xml('AccessDenied', 'Request has expired', `<X-Amz-Expires>${exp}</X-Amz-Expires><Expires>${new Date(start + exp * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}</Expires><ServerTime>${new Date(a.clock).toISOString().replace(/\.\d+Z$/, 'Z')}</ServerTime>`, 'exp'));
  // el firmante tiene que seguir existiendo y poder leer el objeto
  let arn = '';
  let session = a.sessions[akid];
  if (akid.startsWith('ASIA')) {
    if (!session) return resp(403, 'application/xml', xml('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.', `<AWSAccessKeyId>${akid}</AWSAccessKeyId>`, 'k'));
    if (session.expires <= a.clock) return resp(400, 'application/xml', xml('ExpiredToken', 'The provided token has expired.', '', 'tok'));
    arn = session.roleArn ? `arn:aws:sts::${a.id}:assumed-role/${session.roleArn.split('/').pop()}/${session.roleSessionName}` : session.source;
    session = undefined as never;
  } else {
    const u = Object.values(a.iam.users).find((x) => x.accessKeys.some((k) => k.AccessKeyId === akid && k.Status === 'Active'));
    if (u) arn = u.Arn;
    else if (a.iam.rootKeys.some((k) => k.AccessKeyId === akid && k.Status === 'Active')) arn = `arn:aws:iam::${a.id}:root`;
    else return resp(403, 'application/xml', xml('InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.', `<AWSAccessKeyId>${akid}</AWSAccessKeyId>`, 'k'));
  }
  const pp = principalPolicies(a, arn);
  const pol: PolicySource[] = [...(pp?.policies ?? []), ...(b.policy ? [{ name: 'bucket-policy', kind: 'resource' as const, doc: b.policy }] : [])];
  const r = evaluate({ action: 's3:GetObject', resource: `arn:aws:s3:::${b.name}/${key}`, principalArn: arn, principalAccount: a.id, policies: pol, root: !!pp?.root });
  if (r.decision !== 'allowed') return resp(403, 'application/xml', xml('AccessDenied', 'Access Denied', '', 'deny'));
  return objectResponse(b, key);
}

function s3Request(a: Account, bucketName: string, key: string, query: string, method: string): Fetched {
  const b = a.s3.buckets[bucketName];
  if (!b) return resp(404, 'application/xml', xml('NoSuchBucket', 'The specified bucket does not exist', `<BucketName>${bucketName}</BucketName>`, bucketName));
  if (!key) return resp(403, 'application/xml', xml('AccessDenied', 'Access Denied', '', 'list'));
  if (method !== 'GET' && method !== 'HEAD') return resp(403, 'application/xml', xml('AccessDenied', 'Access Denied', '', 'put'));
  const q = new URLSearchParams(query);
  if (q.has('X-Amz-Signature')) return presigned(a, b, key, q);
  if (!anonymousCanRead(b, key, anonCtx(a))) return resp(403, 'application/xml', xml('AccessDenied', 'Access Denied', '', key));
  // si el objeto no existe, S3 solo dice «404» a quien puede listar el bucket; al resto le contesta 403
  const l = b.objects[key];
  const exists = !!l?.length && !l[l.length - 1].deleteMarker;
  if (!exists && !anonymousAllowed(b, 's3:ListBucket', `arn:aws:s3:::${b.name}`, anonCtx(a))) return resp(403, 'application/xml', xml('AccessDenied', 'Access Denied', '', key));
  return objectResponse(b, key);
}

const websiteError = (status: number, title: string, code: string, message: string, extra = ''): Fetched => resp(status, 'text/html', `<html>\n<head><title>${status} ${title}</title></head>\n<body>\n<h1>${status} ${title}</h1>\n<ul>\n<li>Code: ${code}</li>\n<li>Message: ${message}</li>\n${extra}<li>RequestId: ${requestId(code)}</li>\n<li>HostId: ${stableId('host:' + code, '', 60, 'b64')}=</li>\n</ul>\n<hr/>\n</body>\n</html>\n`);

function websiteRequest(a: Account, bucketName: string, path: string): Fetched {
  const b = a.s3.buckets[bucketName];
  if (!b) return websiteError(404, 'Not Found', 'NoSuchBucket', 'The specified bucket does not exist', `<li>BucketName: ${bucketName}</li>\n`);
  if (!b.website) return websiteError(404, 'Not Found', 'NoSuchWebsiteConfiguration', 'The specified bucket does not have a website configuration', `<li>BucketName: ${bucketName}</li>\n`);
  let key = decodeURIComponent(path.replace(/^\//, ''));
  if (key === '' || key.endsWith('/')) key += b.website.IndexDocument.Suffix;
  if (!anonymousCanRead(b, key, anonCtx(a))) return websiteError(403, 'Forbidden', 'AccessDenied', 'Access Denied', `<li>Resource: ${key}</li>\n`);
  const l = b.objects[key];
  const v = l?.[l.length - 1];
  if (!v || v.deleteMarker) {
    if (!anonymousAllowed(b, 's3:ListBucket', `arn:aws:s3:::${b.name}`, anonCtx(a))) return websiteError(403, 'Forbidden', 'AccessDenied', 'Access Denied', `<li>Resource: ${key}</li>\n`);
    const err = b.website.ErrorDocument?.Key;
    if (err && anonymousCanRead(b, err, anonCtx(a)) && b.objects[err]) {
      const e = objectResponse(b, err);
      return { ...e, status: 404 };
    }
    return websiteError(404, 'Not Found', 'NoSuchKey', 'The specified key does not exist.', `<li>Key: ${key}</li>\n`);
  }
  return objectResponse(b, key);
}

// ───────────────────────── EC2 ─────────────────────────

function ec2Request(a: Account, host: string, port: number, scheme: string, path: string): Fetched | null {
  let ip: string | null = null;
  const m = EC2_DNS.exec(host);
  if (m) ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) ip = host;
  if (!ip) return null;
  for (const reg of Object.values(a.regions)) {
    for (const i of Object.values(reg.ec2.instances)) {
      if (i.PublicIpAddress !== ip) continue;
      const timeout: Fetched = { ok: false, curlCode: 28, error: `Failed to connect to ${host} port ${port} after 130312 ms: Couldn't connect to server` };
      if (i.state !== 'running') return timeout;
      const open = i.SecurityGroupIds.some((id) => reg.ec2.securityGroups[id]?.IpPermissions.some((p) => (p.IpProtocol === '-1' || (p.IpProtocol === 'tcp' && (p.FromPort ?? 0) <= port && (p.ToPort ?? 65535) >= port)) && p.IpRanges.some((r) => cidrContainsIp(r.CidrIp, a.sourceIp))));
      if (!open) return timeout;
      const ud = i.UserData ?? '';
      const web = /(httpd|nginx|apache2)/.test(ud) && /(install|systemctl|service)/.test(ud);
      if (!web || (scheme === 'https' && port === 443)) return { ok: false, curlCode: 7, error: `Failed to connect to ${host} port ${port} after 38 ms: Couldn't connect to server` };
      const echo = /echo\s+(?:"([^"]*)"|'([^']*)')\s*>\s*\/var\/www\/html\/index\.html/.exec(ud);
      const body = echo ? (echo[1] ?? echo[2]) + '\n' : '<html><body><h1>It works!</h1></body></html>\n';
      if (path !== '/' && path !== '/index.html') return { ok: true, status: 404, type: 'text/html', body: '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>\n', ip, headers: { Server: 'Apache/2.4.62 (Amazon Linux)' } };
      return { ok: true, status: 200, type: 'text/html; charset=UTF-8', body, ip, headers: { Server: 'Apache/2.4.62 (Amazon Linux)' } };
    }
  }
  return null;
}

// ───────────────────────── registro ─────────────────────────

const fakeIp = (host: string) => {
  const h = md5(host);
  return `52.${parseInt(h.slice(0, 2), 16) % 100 + 150}.${parseInt(h.slice(2, 4), 16)}.${parseInt(h.slice(4, 6), 16) % 250 + 2}`;
};

hostResolvers.push((sys: System, name: string) => {
  const e = EC2_DNS.exec(name);
  if (e) return { ip: `${e[1]}.${e[2]}.${e[3]}.${e[4]}` };
  if (S3_WEBSITE.test(name) || S3_VIRTUAL.test(name) || S3_PATH.test(name)) return { ip: fakeIp(name) };
  void sys;
  return null;
});

httpHandlers.push((req) => {
  const a = awsAccountOf(req.sys);
  if (!a) return null;
  a.clock = Math.max(a.clock, req.sys.clock.now);
  const w = S3_WEBSITE.exec(req.host);
  if (w) {
    if (req.scheme === 'https') return { ok: false, curlCode: 35, error: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ${req.host}:443` };
    return websiteRequest(a, w[1], req.path);
  }
  const p = S3_PATH.exec(req.host);
  if (p) {
    const parts = req.path.replace(/^\//, '').split('/');
    const bucket = parts.shift() ?? '';
    return s3Request(a, bucket, decodeURIComponent(parts.join('/')), req.query, req.method);
  }
  const v = S3_VIRTUAL.exec(req.host);
  if (v) return s3Request(a, v[1], decodeURIComponent(req.path.replace(/^\//, '')), req.query, req.method);
  return ec2Request(a, req.host, req.port, req.scheme, req.path);
});
