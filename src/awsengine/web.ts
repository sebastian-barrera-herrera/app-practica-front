/**
 * El «internet» de AWS visto desde la terminal: lo que responden `curl` y `wget` cuando apuntas a un bucket de S3
 * (público, privado, URL prefirmada, sitio web estático) o a una instancia EC2 (según su grupo de seguridad).
 */
import { dnsResolvers, hostResolvers, httpHandlers, loadHandlers, type Fetched } from '../engine/commands/internet';
import type { System } from '../engine/sys';
import { evaluate, principalPolicies, type PolicySource } from './policy';
import { acmHooks } from './services/acmhooks';
import { awsAccountOf } from './state';
import { anonymousAllowed, anonymousCanRead } from './services/s3';
import { signUrl } from './services/s3cmd';
import type { Account, LoadBalancer, S3Bucket } from './types';
import { instancePage } from './hosting';
import { traceFromInternet } from './net';
import { apiRequest } from './services/apigw';
import { appRunnerRequest } from './services/apprunner';
import { emitFlow } from './services/flowlogs';
import { clientGeo, r53Address, r53Lookup } from './services/route53';
import { cfByDomain, cfServe, cfStatus, gas, gaServe } from './services/edge';
import { aclOfResource, blockPage, wafInspect } from './services/waf';
import { ecsTaskCapacity, elb, healthyTargets, lbByDns, lbFromInternet, lbHandle, lbState } from './services/elb';
import { instanceType } from './catalog';
import { tick } from './tick';
import { fakeIp, secretFor, stableId } from './util';

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
  for (const [region, reg] of Object.entries(a.regions)) {
    for (const i of Object.values(reg.ec2.instances)) {
      if (i.PublicIpAddress !== ip) continue;
      const timeout: Fetched = { ok: false, curlCode: 28, error: `Failed to connect to ${host} port ${port} after 130312 ms: Couldn't connect to server` };
      if (i.state !== 'running') return timeout;
      // el paquete tiene que atravesar IGW, tabla de rutas, NACL y grupo de seguridad (si algo lo corta, curl se queda esperando)
      const t = traceFromInternet(a, reg.ec2, i, 'tcp', port);
      // el flow log anota lo que llega a la interfaz de red: lo que acepta o rechaza el security group o la NACL
      if (t.reachable || t.blocker === 'sg' || t.blocker === 'nacl') emitFlow(a, region, { inst: i, srcIp: a.sourceIp, dstIp: i.PrivateIpAddress, srcPort: 40000 + (a.clock % 20000), dstPort: port, proto: 6, accepted: t.reachable, direction: 'ingress' });
      if (!t.reachable) return timeout;
      const page = instancePage(i, path);
      if (!page || (scheme === 'https' && port === 443) || port !== 80) return { ok: false, curlCode: 7, error: `Failed to connect to ${host} port ${port} after 38 ms: Couldn't connect to server` };
      return { ok: true, status: page.status, type: page.type, body: page.body, ip, headers: page.headers };
    }
  }
  return null;
}

// ───────────────────────── registro ─────────────────────────

dnsResolvers.push((sys: System, name: string, type: string) => {
  const a = awsAccountOf(sys);
  const r = a ? r53Lookup(a, name, type) : null;
  if (!r) return null;
  return {
    nxdomain: r.nxdomain,
    records: r.answers.map((x) => ({ ...x, data: x.data.startsWith('s3-website:') ? fakeIp(x.data.slice(11)) : x.data.startsWith('lb:') ? fakeIp(x.data.split(':')[1], x.data.split(':')[2]) : x.data.startsWith('edge:') ? fakeIp(x.data.slice(5)) : x.data })),
  };
});

/** Los nombres propios de AWS (balanceadores, CloudFront, aceleradores) que no están en ninguna zona tuya. */
dnsResolvers.push((sys: System, name: string, type: string) => {
  const a = awsAccountOf(sys);
  if (!a || type !== 'A') return null;
  const n = name.toLowerCase().replace(/\.$/, '');
  const lb = lbByDns(a, n);
  if (lb) return lbState(a, lb.lb) === 'active' ? { nxdomain: false, records: ['a', 'b'].map((salt) => ({ name: n + '.', type: 'A', ttl: 60, data: fakeIp(n, salt) })) } : { nxdomain: true, records: [] };
  if (cfByDomain(a, n)?.DomainName === n) return { nxdomain: false, records: [0, 1, 2, 3].map((k) => ({ name: n + '.', type: 'A', ttl: 60, data: fakeIp(n, 'cf' + k) })) };
  const acc = Object.values(gas(a)).find((x) => x.DnsName === n);
  if (acc) return { nxdomain: false, records: acc.IpSets[0].IpAddresses.map((ip) => ({ name: n + '.', type: 'A', ttl: 300, data: ip })) };
  return null;
});

hostResolvers.push((sys: System, name: string) => {
  const own = awsAccountOf(sys);
  const hit = own ? r53Address(own, name) : null;
  if (hit?.ip) return { ip: hit.ip };
  if (hit?.s3Website) return { ip: fakeIp(hit.s3Website) };
  if (hit?.lb || hit?.edge) return { ip: fakeIp(hit.lb ?? hit.edge ?? name) };
  const n = name.toLowerCase();
  const lbHit = own ? lbByDns(own, n) : null;
  if (lbHit) return lbState(own!, lbHit.lb) === 'active' ? { ip: fakeIp(n, 'a') } : null;
  if (own && (cfByDomain(own, n)?.DomainName === n || Object.values(gas(own)).some((x) => x.DnsName === n))) return { ip: fakeIp(n) };
  const e = EC2_DNS.exec(name);
  if (e) return { ip: `${e[1]}.${e[2]}.${e[3]}.${e[4]}` };
  if (S3_WEBSITE.test(name) || S3_VIRTUAL.test(name) || S3_PATH.test(name)) return { ip: fakeIp(name) };
  void sys;
  return null;
});

const timeoutFor = (host: string, port: number): Fetched => ({ ok: false, curlCode: 28, error: `Failed to connect to ${host} port ${port} after 130312 ms: Couldn't connect to server` });

/** Una petición a un balanceador de carga (desde internet o desde CloudFront). */
function lbRequest(a: Account, hit: { lb: LoadBalancer; region: string }, req: { host: string; port: number; scheme: string; method: string; path: string; query: string; insecure?: boolean; headers?: Record<string, string>; body?: string }, hostHeader: string, srcIp = a.sourceIp): Fetched {
  if (lbState(a, hit.lb) !== 'active') return { ok: false, curlCode: 6, error: `Could not resolve host: ${req.host}` };
  if (!lbFromInternet(a, hit.region, hit.lb, req.port, srcIp).ok) return timeoutFor(req.host, req.port);
  // TLS: el certificado del oyente tiene que cubrir el nombre al que se conecta el cliente (curl -k lo ignora)
  if (req.scheme === 'https' && !req.insecure) {
    const l = Object.values(hit.lb.listeners).find((x) => x.Port === req.port && (x.Protocol === 'HTTPS' || x.Protocol === 'TLS'));
    if (l?.Certificates?.length && !l.Certificates.some((x) => acmHooks.covers?.(a, hit.region, x.CertificateArn, req.host))) return { ok: false, curlCode: 60, error: `SSL: no alternative certificate subject name matches target host name '${req.host}'` };
  }
  // AWS WAF: la ACL asociada al balanceador decide antes de que la petición llegue a ningún destino
  const waf = wafInspect(a, hit.region, aclOfResource(a, hit.region, hit.lb.LoadBalancerArn), { kind: 'ALB', id: `${a.id}-${hit.lb.LoadBalancerArn.split('loadbalancer/')[1]}` }, { method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body, srcIp, host: hostHeader });
  if (waf?.action === 'BLOCK') return blockPage('ALB', waf);
  return lbHandle(a, hit.region, hit.lb, { port: req.port, scheme: req.scheme, method: req.method, host: hostHeader, path: req.path, query: req.query, srcIp });
}

/** CloudFront: la caché de borde delante de un bucket o de un balanceador. */
function cloudfrontRequest(a: Account, d: NonNullable<ReturnType<typeof cfByDomain>>, req: { host: string; scheme: string; method: string; path: string; query: string; port: number; headers?: Record<string, string>; body?: string; srcIp?: string }): Fetched {
  const src = req.srcIp ?? a.sourceIp;
  const geo = clientGeo(src);
  // AWS WAF en el borde: se evalúa antes de mirar la caché
  if (d.WebACLId && cfStatus(a, d) === 'Deployed' && d.Enabled) {
    const waf = wafInspect(a, 'us-east-1', d.WebACLId, { kind: 'CF', id: d.Id }, { method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body, srcIp: src, host: req.host });
    if (waf?.action === 'BLOCK') {
      const page = blockPage('CF', waf);
      return { ...page, headers: { ...(page.headers ?? {}), Via: `1.1 ${d.Id.toLowerCase()}.cloudfront.net (CloudFront)`, 'X-Cache': 'Error from cloudfront' } };
    }
  }
  return cfServe(a, d, { scheme: req.scheme, method: req.method, path: req.path + (req.query ? '?' + req.query : ''), host: req.host }, {
    country: geo.country,
    publicRead: (b, key) => anonymousCanRead(b, key, anonCtx(a)),
    viaLb: (host, path) => {
      const w = S3_WEBSITE.exec(host);
      if (w) return websiteRequest(a, w[1], path);
      const hit = lbByDns(a, host);
      if (hit) return lbRequest(a, hit, { host, port: 80, scheme: 'http', method: 'GET', path, query: '' }, host, '130.176.0.10');
      return ec2Request(a, host, 80, 'http', path);
    },
  });
}

/** Cuánto aguanta (peticiones por segundo) un balanceador con lo que tiene sano ahora mismo. */
function lbCapacity(a: Account, region: string, lbArn: string): number {
  const s = elb(a, region);
  const lb = s.lbs[lbArn];
  if (!lb) return 0;
  const r = a.regions[region].ec2;
  const tgs = new Set<string>();
  for (const l of Object.values(lb.listeners)) for (const rule of l.rules) for (const act of rule.Actions) for (const g of act.ForwardConfig?.TargetGroups.map((x) => x.TargetGroupArn) ?? (act.TargetGroupArn ? [act.TargetGroupArn] : [])) tgs.add(g);
  let cap = 0;
  for (const arn of tgs) for (const t of healthyTargets(a, region, s.tgs[arn])) cap += ecsTaskCapacity(a, region, t.Id) ?? (instanceType(r.instances[t.Id]?.InstanceType ?? 't3.micro')?.vcpu ?? 2) * 60;
  return cap;
}

export interface WebReq {
  /** `curl -k`: no comprobar el certificado. */
  insecure?: boolean;
  /** Desde qué dirección llega (por defecto, la IP del alumno). */
  srcIp?: string;
  host: string;
  port: number;
  scheme: string;
  path: string;
  query: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
}

/** Lo que responde «internet» (la cuenta de AWS) a una petición web, o null si el nombre no es de ella. */
export function awsHttp(a: Account, reqIn: WebReq): Fetched | null {
  tick(a);
  // `curl -k` llega como una cabecera interna
  const insecure = reqIn.headers?.['x-curl-insecure'] === '1';
  const { 'x-curl-insecure': _k, ...rest } = reqIn.headers ?? {};
  void _k;
  const req: WebReq = { ...reqIn, headers: rest, insecure };
  const gw = apiRequest(a, req);
  if (gw) return gw;
  const ar = appRunnerRequest(a, req);
  if (ar) return ar;
  const lbDirect = lbByDns(a, req.host);
  if (lbDirect) return lbRequest(a, lbDirect, req, req.host, req.srcIp);
  const dist = cfByDomain(a, req.host);
  if (dist && dist.DomainName === req.host.toLowerCase()) return cloudfrontRequest(a, dist, req);
  const acc = Object.values(gas(a)).find((x) => x.DnsName === req.host.toLowerCase() || x.IpSets.some((s) => s.IpAddresses.includes(req.host)));
  if (acc) return gaServe(a, acc, { port: req.port, path: req.path, host: req.host, srcIp: req.srcIp ?? a.sourceIp, geo: clientGeo(req.srcIp ?? a.sourceIp) });
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
  // un nombre de una zona de Route 53: apunta a un sitio web de S3 (el bucket se llama igual que el dominio) o a una IP
  const dns = r53Address(a, req.host);
  if (dns?.lb) {
    const hit = lbByDns(a, dns.lb);
    if (hit) return lbRequest(a, hit, req, req.host, req.srcIp);
  }
  if (dns?.edge) {
    const d = cfByDomain(a, dns.edge);
    if (d) return cloudfrontRequest(a, d, req);
    const ga = Object.values(gas(a)).find((x) => x.DnsName === dns.edge);
    if (ga) return gaServe(a, ga, { port: req.port, path: req.path, host: req.host, srcIp: req.srcIp ?? a.sourceIp, geo: clientGeo(req.srcIp ?? a.sourceIp) });
  }
  if (dns?.s3Website) {
    if (req.scheme === 'https') return { ok: false, curlCode: 35, error: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ${req.host}:443` };
    return websiteRequest(a, req.host, req.path);
  }
  if (dns?.ip) return ec2Request(a, dns.ip, req.port, req.scheme, req.path);
  return ec2Request(a, req.host, req.port, req.scheme, req.path);
}

httpHandlers.push((req) => {
  const a = awsAccountOf(req.sys);
  if (!a) return null;
  a.clock = Math.max(a.clock, req.sys.clock.now);
  return awsHttp(a, req);
});

/** Para el corrector: una petición `GET` a una URL desde fuera de AWS. */
export function fetchFromInternet(a: Account, url: string, o: { method?: string; body?: string; headers?: Record<string, string>; srcIp?: string } = {}): Fetched {
  const m = /^(?:(https?):\/\/)?([^/:?#]+)(?::(\d+))?(\/[^?#]*)?(?:\?([^#]*))?/.exec(url);
  if (!m) return { ok: false, curlCode: 3, error: 'URL using bad/illegal format' };
  const scheme = m[1] ?? 'http';
  return awsHttp(a, { host: m[2], port: m[3] ? Number(m[3]) : scheme === 'https' ? 443 : 80, scheme, path: m[4] ?? '/', query: m[5] ?? '', method: o.method ?? 'GET', body: o.body, headers: o.headers, srcIp: o.srcIp }) ?? { ok: false, curlCode: 6, error: `Could not resolve host: ${m[2]}` };
}

/** `ab`: la carga se aplica al balanceador al que llegue el nombre. Las instancias que atienden son las que están sanas. */
loadHandlers.push((req) => {
  const a = awsAccountOf(req.sys);
  if (!a) return null;
  a.clock = Math.max(a.clock, req.sys.clock.now);
  tick(a);
  let hit = lbByDns(a, req.host);
  if (!hit) {
    const dns = r53Address(a, req.host);
    if (dns?.lb) hit = lbByDns(a, dns.lb);
  }
  if (!hit) return null;
  const first = lbRequest(a, hit, { host: req.host, port: req.port, scheme: req.scheme, method: 'GET', path: req.path, query: '' }, req.host);
  if (!first.ok) return { ok: false, error: first.curlCode === 28 ? 'apr_pollset_poll: The timeout specified has expired (70007)' : 'apr_socket_connect(): Connection refused (111)', completed: 0, failed: 0, non2xx: 0, duration: 0, rps: 0 };
  const cap = lbCapacity(a, hit.region, hit.lb.LoadBalancerArn);
  const potential = req.concurrency / 0.02;
  const good = (first.status ?? 500) < 400 && cap > 0;
  const rps = good ? Math.min(potential, cap) : potential;
  const completed = Math.max(1, Math.min(req.requests, req.seconds > 0 ? Math.round(rps * req.seconds) : req.requests));
  const duration = Math.max(0.05, completed / rps);
  // con una ACL de WAF delante, cada petición de la ráfaga pasa por ella (las reglas por tasa se activan)
  let blocked = 0;
  const aclArn = aclOfResource(a, hit.region, hit.lb.LoadBalancerArn);
  if (aclArn && good) {
    for (let i = 1; i < Math.min(completed, 5000); i++) if (wafInspect(a, hit.region, aclArn, { kind: 'ALB', id: `${a.id}-${hit.lb.LoadBalancerArn.split('loadbalancer/')[1]}` }, { method: 'GET', path: req.path, query: '', srcIp: a.sourceIp, host: req.host })?.action === 'BLOCK') blocked++;
  }
  a.loads = [...(a.loads ?? []).filter((l) => l.until > a.clock - 7200000), { lbArn: hit.lb.LoadBalancerArn, region: hit.region, rps: potential, from: a.clock, until: a.clock + Math.round(duration * 1000) }];
  return { ok: true, status: first.status, server: first.headers?.Server, bodyLength: first.body?.length ?? 0, completed, failed: 0, non2xx: good ? blocked : completed, duration, rps };
});
