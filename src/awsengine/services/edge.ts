/** Red de borde: CloudFront (CDN) y Global Accelerator (IP anycast hacia tus regiones). */
import { md5 } from '../../engine/commands/hash';
import type { Fetched } from '../../engine/commands/internet';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Accelerator, CfDistribution, CfOac, CfOrigin, CloudFrontState, PolicyStatement, S3Bucket } from '../types';
import { fakeIp, iso, newId, stableId, toArr, wildcard } from '../util';
import { tick } from '../tick';
import { elb, lbFromInternet, lbHandle, lbHasHealthy, lbState } from './elb';
import { latencyMs } from './route53';
import { wafOf } from './waf';

export const cf = (a: Account): CloudFrontState => (a.cloudfront ??= { distributions: {}, oacs: {} });
export const gas = (a: Account): Record<string, Accelerator> => (a.accelerators ??= {});

const DEPLOY_MS = 240000;
const E = {
  dist: (id: string) => new AwsError('NoSuchDistribution', `The specified distribution does not exist.`, 404),
  oac: () => new AwsError('NoSuchOriginAccessControl', 'The specified origin access control does not exist.', 404),
  pre: () => new AwsError('PreconditionFailed', 'The If-Match version is missing or not valid for the resource.', 412),
};
void E.dist;

const distId = (a: Account) => ('E' + newId(a, 'cfid', '', 13, 'up')).slice(0, 14);
const etagOf = (d: CfDistribution) => 'E' + md5(d.Id + d.LastModifiedTime + JSON.stringify(d.Origins) + d.Enabled + JSON.stringify(d.DefaultCacheBehavior) + (d.WebACLId ?? '')).slice(0, 13).toUpperCase();

export const cfByDomain = (a: Account, host: string): CfDistribution | undefined => Object.values(cf(a).distributions).find((d) => d.DomainName === host.toLowerCase() || d.Aliases.includes(host.toLowerCase()));

export const cfStatus = (a: Account, d: CfDistribution): 'InProgress' | 'Deployed' => (a.clock >= d.deployedAt ? 'Deployed' : 'InProgress');

// ───────────────────────── vistas ─────────────────────────

const originView = (o: CfOrigin) => ({
  Id: o.Id,
  DomainName: o.DomainName,
  OriginPath: o.OriginPath ?? '',
  CustomHeaders: { Quantity: 0 },
  ...(o.S3 ? { S3OriginConfig: { OriginAccessIdentity: '' } } : { CustomOriginConfig: o.CustomOriginConfig ?? { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'match-viewer' } }),
  ConnectionAttempts: 3,
  ConnectionTimeout: 10,
  OriginShield: { Enabled: false },
  OriginAccessControlId: o.OriginAccessControlId ?? '',
});

const configView = (d: CfDistribution) => ({
  CallerReference: stableId('cfref:' + d.Id, 'ref-', 12),
  Aliases: { Quantity: d.Aliases.length, ...(d.Aliases.length ? { Items: d.Aliases } : {}) },
  DefaultRootObject: d.DefaultRootObject,
  Origins: { Quantity: d.Origins.length, Items: d.Origins.map(originView) },
  DefaultCacheBehavior: {
    TargetOriginId: d.DefaultCacheBehavior.TargetOriginId,
    ViewerProtocolPolicy: d.DefaultCacheBehavior.ViewerProtocolPolicy,
    AllowedMethods: { Quantity: d.DefaultCacheBehavior.AllowedMethods.length, Items: d.DefaultCacheBehavior.AllowedMethods },
    Compress: d.DefaultCacheBehavior.Compress,
    MinTTL: d.DefaultCacheBehavior.MinTTL,
    DefaultTTL: d.DefaultCacheBehavior.DefaultTTL,
    MaxTTL: d.DefaultCacheBehavior.MaxTTL,
  },
  Comment: d.Comment,
  PriceClass: d.PriceClass,
  Enabled: d.Enabled,
  WebACLId: d.WebACLId ?? '',
});

const distView = (a: Account, d: CfDistribution) => ({ Id: d.Id, ARN: d.ARN, Status: cfStatus(a, d) === 'Deployed' ? 'Deployed' : 'InProgress', LastModifiedTime: d.LastModifiedTime, InProgressInvalidationBatches: 0, DomainName: d.DomainName, DistributionConfig: configView(d) });

const summary = (a: Account, d: CfDistribution) => ({
  Id: d.Id,
  ARN: d.ARN,
  Status: cfStatus(a, d),
  LastModifiedTime: d.LastModifiedTime,
  DomainName: d.DomainName,
  Aliases: { Quantity: d.Aliases.length, ...(d.Aliases.length ? { Items: d.Aliases } : {}) },
  Origins: { Quantity: d.Origins.length, Items: d.Origins.map(originView) },
  DefaultCacheBehavior: configView(d).DefaultCacheBehavior,
  Comment: d.Comment,
  PriceClass: d.PriceClass,
  Enabled: d.Enabled,
  WebACLId: d.WebACLId ?? '',
});

// ───────────────────────── creación ─────────────────────────

const S3_REST = /^([a-z0-9][a-z0-9.-]*)\.s3(?:[.-]([a-z0-9-]+))?\.amazonaws\.com$/;

function buildOrigin(a: Account, raw: Record<string, any>): CfOrigin {
  const domain = String(raw.DomainName ?? '').toLowerCase();
  if (!domain) throw new AwsError('MissingRequiredParameter', 'Origin DomainName is required.', 400);
  const s3 = S3_REST.exec(domain);
  if (s3 && !a.s3.buckets[s3[1]]) throw new AwsError('InvalidOrigin', 'The specified origin server does not exist or is not valid. (S3 bucket)', 400);
  const o: CfOrigin = { Id: String(raw.Id ?? domain), DomainName: domain, OriginPath: raw.OriginPath || undefined, S3: !!s3 };
  if (raw.OriginAccessControlId) {
    if (!cf(a).oacs[raw.OriginAccessControlId]) throw E.oac();
    o.OriginAccessControlId = raw.OriginAccessControlId;
  }
  if (!s3) o.CustomOriginConfig = raw.CustomOriginConfig ?? { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'match-viewer' };
  return o;
}

/** El `WebACLId` de una distribución es el ARN de una ACL web de ámbito CLOUDFRONT (que vive en us-east-1). */
function checkWebAcl(a: Account, id: unknown): string | undefined {
  if (!id) return undefined;
  if (!Object.values(wafOf(a, 'us-east-1').acls).some((x) => x.ARN === id && x.Scope === 'CLOUDFRONT')) throw new AwsError('InvalidWebACLId', 'The specified web ACL does not exist.', 400);
  return String(id);
}

export function cfCreate(a: Account, cfg: Record<string, any>, tags = []): CfDistribution {
  const origins = ((cfg.Origins?.Items ?? cfg.Origins ?? []) as Record<string, any>[]).map((o) => buildOrigin(a, o));
  if (!origins.length) throw new AwsError('InvalidArgument', 'The parameter Origins is required.', 400);
  const beh = (cfg.DefaultCacheBehavior ?? {}) as Record<string, any>;
  const target = beh.TargetOriginId ?? origins[0].Id;
  if (!origins.some((o) => o.Id === target)) throw new AwsError('InvalidArgument', `The default cache behavior references an origin (${target}) that does not exist.`, 400);
  const id = distId(a);
  const d: CfDistribution = {
    Id: id,
    ARN: `arn:aws:cloudfront::${a.id}:distribution/${id}`,
    DomainName: `d${md5(id).slice(0, 13)}.cloudfront.net`,
    Status: 'InProgress',
    deployedAt: a.clock + DEPLOY_MS,
    LastModifiedTime: iso(a.clock),
    Enabled: cfg.Enabled === undefined ? true : cfg.Enabled === true || cfg.Enabled === 'true',
    Comment: cfg.Comment ?? '',
    DefaultRootObject: cfg.DefaultRootObject ?? '',
    Origins: origins,
    DefaultCacheBehavior: {
      TargetOriginId: target,
      ViewerProtocolPolicy: beh.ViewerProtocolPolicy ?? 'allow-all',
      MinTTL: Number(beh.MinTTL ?? 0),
      DefaultTTL: Number(beh.DefaultTTL ?? 86400),
      MaxTTL: Number(beh.MaxTTL ?? 31536000),
      Compress: beh.Compress === true || beh.Compress === 'true',
      AllowedMethods: toArr(beh.AllowedMethods?.Items ?? ['GET', 'HEAD']),
    },
    PriceClass: cfg.PriceClass ?? 'PriceClass_All',
    Aliases: toArr(cfg.Aliases?.Items ?? []).map((x: string) => x.toLowerCase()),
    WebACLId: checkWebAcl(a, cfg.WebACLId),
    ETag: '',
    Tags: tags,
    cache: {},
    invalidations: [],
  };
  if (!['allow-all', 'redirect-to-https', 'https-only'].includes(d.DefaultCacheBehavior.ViewerProtocolPolicy)) throw new AwsError('InvalidViewerProtocolPolicy', `The ViewerProtocolPolicy ${d.DefaultCacheBehavior.ViewerProtocolPolicy} is not valid.`, 400);
  d.ETag = etagOf(d);
  cf(a).distributions[id] = d;
  return d;
}

op('cloudfront', 'create-distribution', 'origin-domain-name:s default-root-object:s distribution-config:j', 'Crea una distribución de CloudFront: una copia en caché de tu contenido repartida por el mundo.', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/*` }, (c) => {
  let cfg = c.p.DistributionConfig as Record<string, any> | undefined;
  if (!cfg) {
    if (!c.p.OriginDomainName) throw new AwsError('MissingRequiredParameter', 'Either --origin-domain-name or --distribution-config is required.', 400);
    cfg = { Origins: [{ Id: String(c.p.OriginDomainName), DomainName: c.p.OriginDomainName }], DefaultCacheBehavior: {}, DefaultRootObject: c.p.DefaultRootObject, Enabled: true };
  }
  const d = cfCreate(c.acct, cfg);
  return { Location: `https://cloudfront.amazonaws.com/2020-05-31/distribution/${d.Id}`, ETag: d.ETag, Distribution: distView(c.acct, d) };
});

const find = (a: Account, id: string): CfDistribution => {
  const d = cf(a).distributions[id];
  if (!d) throw new AwsError('NoSuchDistribution', `The specified distribution does not exist.`, 404);
  return d;
};

op('cloudfront', 'list-distributions', '', 'Lista las distribuciones de CloudFront.', { global: true, res: () => '*' }, (c) => {
  const list = Object.values(cf(c.acct).distributions);
  return { DistributionList: { Marker: '', MaxItems: 100, IsTruncated: false, Quantity: list.length, ...(list.length ? { Items: list.map((d) => summary(c.acct, d)) } : {}) } };
});

op('cloudfront', 'list-distributions-by-web-acl-id', 'web-acl-id:s!', 'Distribuciones protegidas por una ACL web.', { global: true, res: () => '*' }, (c) => {
  const list = Object.values(cf(c.acct).distributions).filter((d) => d.WebACLId === c.p.WebAclId);
  return { DistributionList: { Marker: '', MaxItems: 100, IsTruncated: false, Quantity: list.length, ...(list.length ? { Items: list.map((d) => summary(c.acct, d)) } : {}) } };
});

op('cloudfront', 'get-distribution', 'id:s!', 'Datos y estado de una distribución.', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.Id}` }, (c) => {
  const d = find(c.acct, c.p.Id);
  return { ETag: d.ETag, Distribution: distView(c.acct, d) };
});

op('cloudfront', 'get-distribution-config', 'id:s!', 'Configuración de una distribución (con su ETag, necesario para modificarla).', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.Id}` }, (c) => {
  const d = find(c.acct, c.p.Id);
  return { ETag: d.ETag, DistributionConfig: configView(d) };
});

op('cloudfront', 'update-distribution', 'id:s! if-match:s distribution-config:j!', 'Cambia la configuración (pide el ETag actual con --if-match).', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.Id}` }, (c) => {
  const d = find(c.acct, c.p.Id);
  if (!c.p.IfMatch || c.p.IfMatch !== d.ETag) throw E.pre();
  const cfg = c.p.DistributionConfig as Record<string, any>;
  const origins = ((cfg.Origins?.Items ?? []) as Record<string, any>[]).map((o) => buildOrigin(c.acct, o));
  if (!origins.length) throw new AwsError('InvalidArgument', 'The parameter Origins is required.', 400);
  const beh = (cfg.DefaultCacheBehavior ?? {}) as Record<string, any>;
  d.Origins = origins;
  d.Enabled = cfg.Enabled === true || cfg.Enabled === 'true';
  d.Comment = cfg.Comment ?? d.Comment;
  d.DefaultRootObject = cfg.DefaultRootObject ?? '';
  d.PriceClass = cfg.PriceClass ?? d.PriceClass;
  d.Aliases = toArr(cfg.Aliases?.Items ?? []).map((x: string) => x.toLowerCase());
  // update-distribution sustituye toda la configuración: sin WebACLId, la distribución se queda sin WAF
  d.WebACLId = checkWebAcl(c.acct, cfg.WebACLId);
  d.DefaultCacheBehavior = { ...d.DefaultCacheBehavior, TargetOriginId: beh.TargetOriginId ?? origins[0].Id, ViewerProtocolPolicy: beh.ViewerProtocolPolicy ?? d.DefaultCacheBehavior.ViewerProtocolPolicy, MinTTL: Number(beh.MinTTL ?? d.DefaultCacheBehavior.MinTTL), DefaultTTL: Number(beh.DefaultTTL ?? d.DefaultCacheBehavior.DefaultTTL), MaxTTL: Number(beh.MaxTTL ?? d.DefaultCacheBehavior.MaxTTL), Compress: beh.Compress === true || beh.Compress === 'true' };
  d.LastModifiedTime = iso(c.acct.clock);
  d.deployedAt = c.acct.clock + DEPLOY_MS;
  d.ETag = etagOf(d);
  return { ETag: d.ETag, Distribution: distView(c.acct, d) };
});

op('cloudfront', 'delete-distribution', 'id:s! if-match:s', 'Borra una distribución (antes hay que desactivarla y esperar a que termine de desplegarse).', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.Id}` }, (c) => {
  const d = find(c.acct, c.p.Id);
  if (!c.p.IfMatch || c.p.IfMatch !== d.ETag) throw E.pre();
  if (d.Enabled) throw new AwsError('DistributionNotDisabled', 'The distribution you are trying to delete has not been disabled.', 409);
  if (cfStatus(c.acct, d) !== 'Deployed') throw new AwsError('DistributionNotDisabled', 'The distribution you are trying to delete has not been disabled (still deploying).', 409);
  delete cf(c.acct).distributions[d.Id];
  return undefined;
});

op('cloudfront', 'create-invalidation', 'distribution-id:s! paths:l invalidation-batch:j', 'Borra de la caché de borde las rutas indicadas (cuesta si pasas de 1000 al mes).', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.DistributionId}` }, (c) => {
  const d = find(c.acct, c.p.DistributionId);
  const paths: string[] = c.p.Paths ?? c.p.InvalidationBatch?.Paths?.Items ?? [];
  if (!paths.length) throw new AwsError('MissingRequiredParameter', 'Either --paths or --invalidation-batch is required.', 400);
  for (const p of paths) if (!p.startsWith('/')) throw new AwsError('InvalidArgument', `Your request contains invalid invalidation path: ${p} (paths must start with /)`, 400);
  for (const key of Object.keys(d.cache)) if (paths.some((p) => wildcard(p, key))) delete d.cache[key];
  const inv = { Id: 'I' + newId(c.acct, 'cfinv', '', 13, 'up').slice(0, 13), Paths: paths, CreateTime: iso(c.acct.clock), Status: 'InProgress' };
  d.invalidations.unshift(inv);
  return { Location: `https://cloudfront.amazonaws.com/2020-05-31/distribution/${d.Id}/invalidation/${inv.Id}`, Invalidation: { Id: inv.Id, Status: 'InProgress', CreateTime: inv.CreateTime, InvalidationBatch: { Paths: { Quantity: paths.length, Items: paths }, CallerReference: stableId(inv.Id, 'ref-', 10) } } };
});

op('cloudfront', 'list-invalidations', 'distribution-id:s!', 'Invalidaciones de una distribución.', { global: true, res: (c) => `arn:aws:cloudfront::${c.acct.id}:distribution/${c.p.DistributionId}` }, (c) => {
  const d = find(c.acct, c.p.DistributionId);
  return { InvalidationList: { Marker: '', MaxItems: 100, IsTruncated: false, Quantity: d.invalidations.length, ...(d.invalidations.length ? { Items: d.invalidations.map((i) => ({ Id: i.Id, CreateTime: i.CreateTime, Status: c.acct.clock - Date.parse(i.CreateTime) > 30000 ? 'Completed' : 'InProgress' })) } : {}) } };
});

op('cloudfront', 'create-origin-access-control', 'origin-access-control-config:j!', 'Crea un OAC: la identidad con la que CloudFront firma sus peticiones a un bucket privado.', { global: true, res: () => '*' }, (c) => {
  const cfg = c.p.OriginAccessControlConfig as Record<string, any>;
  if (!cfg?.Name) throw new AwsError('MissingRequiredParameter', 'OriginAccessControlConfig.Name is required.', 400);
  if (Object.values(cf(c.acct).oacs).some((o) => o.Name === cfg.Name)) throw new AwsError('OriginAccessControlAlreadyExists', 'An origin access control with the same name already exists.', 409);
  if (!['s3', 'mediastore', 'lambda', 'mediapackagev2'].includes(cfg.OriginAccessControlOriginType)) throw new AwsError('InvalidArgument', 'OriginAccessControlOriginType must be one of s3, mediastore, lambda, mediapackagev2', 400);
  const id = 'E' + newId(c.acct, 'cfoac', '', 13, 'up');
  const o: CfOac = { Id: id, Name: cfg.Name, OriginAccessControlOriginType: cfg.OriginAccessControlOriginType, SigningBehavior: cfg.SigningBehavior ?? 'always', SigningProtocol: cfg.SigningProtocol ?? 'sigv4' };
  cf(c.acct).oacs[id] = o;
  return { Location: `https://cloudfront.amazonaws.com/2020-05-31/origin-access-control/${id}`, ETag: 'E' + md5(id).slice(0, 13).toUpperCase(), OriginAccessControl: { Id: id, OriginAccessControlConfig: { Name: o.Name, SigningProtocol: o.SigningProtocol, SigningBehavior: o.SigningBehavior, OriginAccessControlOriginType: o.OriginAccessControlOriginType } } };
});

op('cloudfront', 'list-origin-access-controls', '', 'Lista los OAC.', { global: true, res: () => '*' }, (c) => {
  const list = Object.values(cf(c.acct).oacs);
  return { OriginAccessControlList: { Marker: '', MaxItems: 100, IsTruncated: false, Quantity: list.length, ...(list.length ? { Items: list.map((o) => ({ Id: o.Id, Description: '', Name: o.Name, SigningProtocol: o.SigningProtocol, SigningBehavior: o.SigningBehavior, OriginAccessControlOriginType: o.OriginAccessControlOriginType })) } : {}) } };
});

op('cloudfront', 'wait', 'waiter:s! id:s distribution-id:s', 'Espera a que se cumpla una condición (distribution-deployed).', { global: true, positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  if (c.p.Waiter !== 'distribution-deployed' && c.p.Waiter !== 'invalidation-completed') throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: distribution-deployed, invalidation-completed`, 400);
  const d = find(c.acct, c.p.Id ?? c.p.DistributionId);
  for (let k = 0; k < 60; k++) {
    if (cfStatus(c.acct, d) === 'Deployed') return undefined;
    c.acct.clock += 30000;
  }
  throw new AwsError('WaiterError', 'Waiter DistributionDeployed failed: Max attempts exceeded', 255);
});

// ───────────────────────── servir peticiones ─────────────────────────

const POP: Record<string, string> = { ES: 'MAD53-P2', US: 'IAD89-C1', JP: 'NRT57-P1', BR: 'GRU3-P4', AU: 'SYD62-C1' };
const popFor = (country: string) => POP[country] ?? 'FRA56-P4';

const s3Err = (status: number, code: string, msg: string): Fetched => ({ ok: true, status, type: 'application/xml', body: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${msg}</Message></Error>`, headers: { Server: 'AmazonS3' } });

/** ¿Deja la política del bucket leer a CloudFront (OAC)? */
function bucketAllowsCloudFront(b: S3Bucket, d: CfDistribution, action: string, key: string): boolean {
  const doc = b.policy;
  if (!doc) return false;
  const stmts = toArr(doc.Statement) as PolicyStatement[];
  return stmts.some((s) => {
    if (s.Effect !== 'Allow') return false;
    const svc = typeof s.Principal === 'object' && s.Principal ? toArr(s.Principal.Service) : [];
    if (!svc.includes('cloudfront.amazonaws.com')) return false;
    if (!toArr(s.Action).some((x) => wildcard(String(x), action, true))) return false;
    const res = `arn:aws:s3:::${b.name}${key ? '/' + key : ''}`;
    if (!toArr(s.Resource).some((x) => wildcard(String(x), res))) return false;
    const cond = s.Condition?.StringEquals?.['AWS:SourceArn'] ?? s.Condition?.ArnLike?.['AWS:SourceArn'] ?? s.Condition?.ArnEquals?.['AWS:SourceArn'];
    return cond === undefined || toArr(cond as string | string[]).some((x) => wildcard(String(x), d.ARN));
  });
}

function originResponse(a: Account, d: CfDistribution, o: CfOrigin, path: string, publicRead: (b: S3Bucket, key: string) => boolean, viaLb: (host: string, path: string) => Fetched | null): Fetched {
  const full = (o.OriginPath ?? '') + path;
  if (o.S3) {
    const bucket = a.s3.buckets[S3_REST.exec(o.DomainName)![1]];
    if (!bucket) return s3Err(502, 'NoSuchBucket', 'The specified bucket does not exist');
    const key = decodeURIComponent(full.replace(/^\//, ''));
    const l = bucket.objects[key];
    const v = l?.[l.length - 1];
    const exists = !!v && !v.deleteMarker;
    const viaOac = !!o.OriginAccessControlId && bucketAllowsCloudFront(bucket, d, 's3:GetObject', key);
    const open = publicRead(bucket, key);
    if (!viaOac && !open) return s3Err(403, 'AccessDenied', 'Access Denied');
    if (!exists) {
      const canList = (o.OriginAccessControlId && bucketAllowsCloudFront(bucket, d, 's3:ListBucket', '')) || false;
      return canList ? s3Err(404, 'NoSuchKey', 'The specified key does not exist.') : s3Err(403, 'AccessDenied', 'Access Denied');
    }
    return { ok: true, status: 200, type: v!.contentType || 'binary/octet-stream', body: v!.body, headers: { ETag: `"${v!.etag}"`, 'Last-Modified': new Date(Date.parse(v!.lastModified)).toUTCString(), Server: 'AmazonS3' } };
  }
  const r = viaLb(o.DomainName, full);
  return r ?? { ok: true, status: 502, type: 'text/html', body: '<html><body><h1>502 ERROR</h1><p>The request could not be satisfied.</p><p>CloudFront wasn\'t able to connect to the origin.</p></body></html>', headers: { Server: 'CloudFront' } };
}

export function cfServe(a: Account, d: CfDistribution, req: { scheme: string; method: string; path: string; host: string }, ctx: { publicRead: (b: S3Bucket, key: string) => boolean; viaLb: (host: string, path: string) => Fetched | null; country: string }): Fetched {
  if (cfStatus(a, d) !== 'Deployed') return { ok: false, curlCode: 6, error: `Could not resolve host: ${req.host}` };
  const via = `1.1 ${md5(d.Id).slice(0, 32)}.cloudfront.net (CloudFront)`;
  const base = { Via: via, 'X-Amz-Cf-Pop': popFor(ctx.country), 'X-Amz-Cf-Id': stableId(`cfid:${d.Id}:${a.clock}`, '', 44, 'b64') };
  const hdr = (h: Record<string, string>) => ({ ...base, ...h });
  if (!d.Enabled) return { ok: true, status: 403, type: 'text/html', body: '<html><body><h1>403 ERROR</h1><p>The request could not be satisfied.</p><p>Bad request. We can\'t connect to the server for this app or website at this time.</p></body></html>', headers: hdr({ Server: 'CloudFront', 'X-Cache': 'Error from cloudfront' }) };
  const pol = d.DefaultCacheBehavior.ViewerProtocolPolicy;
  if (req.scheme === 'http' && pol === 'redirect-to-https') return { ok: true, status: 301, type: 'text/html', body: '<html><head><title>301 Moved Permanently</title></head><body><h1>301 Moved Permanently</h1></body></html>', headers: hdr({ Server: 'CloudFront', Location: `https://${req.host}${req.path}`, 'X-Cache': 'Redirect from cloudfront' }) };
  if (req.scheme === 'http' && pol === 'https-only') return { ok: true, status: 403, type: 'text/html', body: '<html><body><h1>403 Forbidden</h1><p>The request could not be satisfied.</p><p>Forbidden: HTTP is not allowed for this distribution.</p></body></html>', headers: hdr({ Server: 'CloudFront', 'X-Cache': 'Error from cloudfront' }) };
  if (!d.DefaultCacheBehavior.AllowedMethods.includes(req.method.toUpperCase())) return { ok: true, status: 403, type: 'text/html', body: '<html><body><h1>403 ERROR</h1><p>The request could not be satisfied.</p><p>Request blocked.</p></body></html>', headers: hdr({ Server: 'CloudFront', 'X-Cache': 'Error from cloudfront', Allow: 'GET, HEAD' }) };
  let path = req.path;
  if (path === '/' && d.DefaultRootObject) path = '/' + d.DefaultRootObject;
  const key = path;
  const stored = d.cache[key];
  const ttl = d.DefaultCacheBehavior.DefaultTTL * 1000;
  if (stored && a.clock - stored.at < ttl) {
    return { ok: true, status: stored.status, type: stored.type, body: stored.body, headers: hdr({ ...stored.headers, 'X-Cache': 'Hit from cloudfront', Age: String(Math.floor((a.clock - stored.at) / 1000)) }) };
  }
  const origin = d.Origins.find((x) => x.Id === d.DefaultCacheBehavior.TargetOriginId)!;
  const r = originResponse(a, d, origin, path, ctx.publicRead, ctx.viaLb);
  if (r.ok && r.status === 200) d.cache[key] = { at: a.clock, status: 200, type: r.type ?? 'text/html', body: r.body ?? '', headers: r.headers ?? {} };
  return { ...r, headers: hdr({ ...(r.headers ?? {}), 'X-Cache': (r.status ?? 0) >= 400 ? 'Error from cloudfront' : 'Miss from cloudfront' }) };
}

// ───────────────────────── Global Accelerator ─────────────────────────

const gaArn = (c: OpCtx, name: string) => `arn:aws:globalaccelerator::${c.acct.id}:accelerator/${stableId(`ga:${c.acct.id}:${name}`, '', 8)}-${stableId(`ga2:${name}`, '', 4)}-${stableId(`ga3:${name}`, '', 4)}`;

const accView = (a: Accelerator) => ({ AcceleratorArn: a.AcceleratorArn, Name: a.Name, IpAddressType: a.IpAddressType, Enabled: a.Enabled, IpSets: a.IpSets, DnsName: a.DnsName, Status: a.Status, CreatedTime: a.CreatedTime });

const findAcc = (a: Account, arn: string): Accelerator => {
  const x = gas(a)[arn];
  if (!x) throw new AwsError('AcceleratorNotFoundException', 'Accelerator not found', 400);
  return x;
};

op('globalaccelerator', 'create-accelerator', 'name:s! ip-address-type:s enabled:b tags:t', 'Crea un acelerador: dos IP estáticas anycast que entran por la red de AWS y llegan a tus regiones.', { global: true, res: () => '*' }, (c) => {
  const name = String(c.p.Name);
  const arn = gaArn(c, name);
  const dns = `a${md5(arn).slice(0, 16)}.awsglobalaccelerator.com`;
  const acc: Accelerator = { AcceleratorArn: arn, Name: name, IpAddressType: c.p.IpAddressType ?? 'IPV4', Enabled: c.p.Enabled !== false, IpSets: [{ IpFamily: 'IPv4', IpAddresses: [fakeIp(dns, 'g1'), fakeIp(dns, 'g2')] }], DnsName: dns, Status: 'IN_PROGRESS', CreatedTime: iso(c.acct.clock), listeners: [] };
  gas(c.acct)[arn] = acc;
  return { Accelerator: accView(acc) };
});
op('globalaccelerator', 'list-accelerators', '', 'Lista los aceleradores.', { global: true, res: () => '*' }, (c) => ({ Accelerators: Object.values(gas(c.acct)).map(accView) }));
op('globalaccelerator', 'describe-accelerator', 'accelerator-arn:s!', 'Datos de un acelerador.', { global: true, res: (c) => c.p.AcceleratorArn }, (c) => ({ Accelerator: accView(findAcc(c.acct, c.p.AcceleratorArn)) }));
op('globalaccelerator', 'update-accelerator', 'accelerator-arn:s! name:s enabled:b', 'Activa, desactiva o renombra un acelerador.', { global: true, res: (c) => c.p.AcceleratorArn }, (c) => {
  const a = findAcc(c.acct, c.p.AcceleratorArn);
  if (c.p.Name) a.Name = c.p.Name;
  if (c.p.Enabled !== undefined) a.Enabled = c.p.Enabled;
  return { Accelerator: accView(a) };
});
op('globalaccelerator', 'delete-accelerator', 'accelerator-arn:s!', 'Borra un acelerador (desactívalo antes y quita sus oyentes).', { global: true, res: (c) => c.p.AcceleratorArn }, (c) => {
  const a = findAcc(c.acct, c.p.AcceleratorArn);
  if (a.Enabled) throw new AwsError('AcceleratorNotDisabledException', 'The accelerator must be disabled before it can be deleted.', 400);
  if (a.listeners.length) throw new AwsError('AssociatedListenerFoundException', 'The accelerator has listeners. Delete them first.', 400);
  delete gas(c.acct)[a.AcceleratorArn];
  return undefined;
});
op('globalaccelerator', 'create-listener', 'accelerator-arn:s! port-ranges:f! protocol:s!', 'Crea un oyente (puertos y protocolo) en un acelerador.', { global: true, res: (c) => c.p.AcceleratorArn }, (c) => {
  const a = findAcc(c.acct, c.p.AcceleratorArn);
  if (!['TCP', 'UDP'].includes(c.p.Protocol)) throw new AwsError('InvalidArgumentException', 'Protocol must be TCP or UDP', 400);
  const l = { ListenerArn: `${a.AcceleratorArn}/listener/${stableId(`gal:${a.AcceleratorArn}:${a.listeners.length}`, '', 8)}`, Protocol: c.p.Protocol as string, PortRanges: (c.p.PortRanges as { FromPort: number; ToPort: number }[]).map((p) => ({ FromPort: Number(p.FromPort), ToPort: Number(p.ToPort) })), endpointGroups: [] };
  a.listeners.push(l);
  return { Listener: { ListenerArn: l.ListenerArn, PortRanges: l.PortRanges, Protocol: l.Protocol, ClientAffinity: 'NONE' } };
});
op('globalaccelerator', 'list-listeners', 'accelerator-arn:s!', 'Lista los oyentes de un acelerador.', { global: true, res: (c) => c.p.AcceleratorArn }, (c) => ({ Listeners: findAcc(c.acct, c.p.AcceleratorArn).listeners.map((l) => ({ ListenerArn: l.ListenerArn, PortRanges: l.PortRanges, Protocol: l.Protocol, ClientAffinity: 'NONE' })) }));
op('globalaccelerator', 'create-endpoint-group', 'listener-arn:s! endpoint-group-region:s! endpoint-configurations:f traffic-dial-percentage:n', 'Crea un grupo de destinos en una región (balanceadores, instancias o IP elásticas).', { global: true, res: () => '*' }, (c) => {
  for (const a of Object.values(gas(c.acct))) {
    const l = a.listeners.find((x) => x.ListenerArn === c.p.ListenerArn);
    if (!l) continue;
    if (l.endpointGroups.some((g) => g.EndpointGroupRegion === c.p.EndpointGroupRegion)) throw new AwsError('EndpointGroupAlreadyExistsException', 'An endpoint group already exists for this region.', 400);
    const g = { EndpointGroupArn: `${l.ListenerArn}/endpoint-group/${stableId(`gae:${l.ListenerArn}:${c.p.EndpointGroupRegion}`, '', 12)}`, EndpointGroupRegion: String(c.p.EndpointGroupRegion), EndpointConfigurations: ((c.p.EndpointConfigurations ?? []) as { EndpointId: string; Weight?: number }[]).map((e) => ({ EndpointId: e.EndpointId, Weight: Number(e.Weight ?? 128) })), TrafficDialPercentage: Number(c.p.TrafficDialPercentage ?? 100) };
    l.endpointGroups.push(g);
    return { EndpointGroup: { EndpointGroupArn: g.EndpointGroupArn, EndpointGroupRegion: g.EndpointGroupRegion, EndpointDescriptions: g.EndpointConfigurations.map((e) => ({ EndpointId: e.EndpointId, Weight: e.Weight, HealthState: 'HEALTHY' })), TrafficDialPercentage: g.TrafficDialPercentage, HealthCheckPort: 80, HealthCheckProtocol: 'TCP', HealthCheckIntervalSeconds: 30, ThresholdCount: 3 } };
  }
  throw new AwsError('ListenerNotFoundException', 'The listener does not exist.', 400);
});
op('globalaccelerator', 'list-endpoint-groups', 'listener-arn:s!', 'Lista los grupos de destinos de un oyente.', { global: true, res: () => '*' }, (c) => {
  for (const a of Object.values(gas(c.acct))) {
    const l = a.listeners.find((x) => x.ListenerArn === c.p.ListenerArn);
    if (l) return { EndpointGroups: l.endpointGroups.map((g) => ({ EndpointGroupArn: g.EndpointGroupArn, EndpointGroupRegion: g.EndpointGroupRegion, EndpointDescriptions: g.EndpointConfigurations.map((e) => ({ EndpointId: e.EndpointId, Weight: e.Weight, HealthState: 'HEALTHY' })), TrafficDialPercentage: g.TrafficDialPercentage })) };
  }
  throw new AwsError('ListenerNotFoundException', 'The listener does not exist.', 400);
});

/** Atiende una petición que llega a un acelerador: el grupo sano más cercano al cliente. */
export function gaServe(a: Account, acc: Accelerator, req: { port: number; path: string; host: string; srcIp: string; geo: { lat: number; lon: number; continent: string; country: string } }): Fetched | null {
  tick(a);
  if (!acc.Enabled) return { ok: false, curlCode: 28, error: `Failed to connect to ${req.host} port ${req.port} after 130312 ms: Couldn't connect to server` };
  const l = acc.listeners.find((x) => x.PortRanges.some((p) => req.port >= p.FromPort && req.port <= p.ToPort));
  if (!l) return { ok: false, curlCode: 28, error: `Failed to connect to ${req.host} port ${req.port} after 130312 ms: Couldn't connect to server` };
  const groups = l.endpointGroups.filter((g) => g.TrafficDialPercentage > 0).sort((x, y) => latencyMs(req.geo, x.EndpointGroupRegion) - latencyMs(req.geo, y.EndpointGroupRegion));
  for (const g of groups) {
    for (const e of g.EndpointConfigurations) {
      const lb = Object.values(elb(a, g.EndpointGroupRegion).lbs).find((x) => x.LoadBalancerArn === e.EndpointId);
      if (lb && lbState(a, lb) === 'active' && lbHasHealthy(a, g.EndpointGroupRegion, lb) && lbFromInternet(a, g.EndpointGroupRegion, lb, req.port, req.srcIp).ok) {
        const r = lbHandle(a, g.EndpointGroupRegion, lb, { port: req.port, scheme: 'http', method: 'GET', host: req.host, path: req.path, query: '', srcIp: req.srcIp });
        return { ...r, headers: { ...(r.headers ?? {}), 'x-amz-ga-region': g.EndpointGroupRegion } };
      }
    }
  }
  return { ok: true, status: 503, type: 'text/html', body: '<html><body><h1>503 Service Unavailable</h1></body></html>', headers: { Server: 'AWS Global Accelerator' } };
}

