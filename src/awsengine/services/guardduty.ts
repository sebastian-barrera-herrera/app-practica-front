/**
 * Amazon GuardDuty: un detector por región que lee CloudTrail y la red de la cuenta y levanta hallazgos con tipo, gravedad y recurso.
 * En el simulador los hallazgos salen de la actividad real de la cuenta (root usado, CloudTrail apagado, un bucket que se hace público,
 * un puerto de administración abierto al mundo…), de hallazgos de ejemplo y de ataques que inyecta el corrector.
 */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Ec2Instance } from '../types';
import type { GdDetector, GdFilter, GdFinding, GdListSet, GdState } from '../types-sec';
import { cidrContainsIp, iso, isoZ, mkArn, newId, toArr } from '../util';
import { traceFromInternet } from '../net';
import { ctOf } from './cloudtrail';
import { putEvent } from './events';
import { anonymousAllowed, getBucket, s3Current, s3Put } from './s3';
import { REPUTATION_CIDRS } from './wafeval';

export const gdOf = (a: Account, region: string): GdState => (regional(a, region).guardduty ??= { detectors: {} });

const MIN = 60000;
const FREQ_MS: Record<string, number> = { FIFTEEN_MINUTES: 15 * MIN, ONE_HOUR: 60 * MIN, SIX_HOURS: 360 * MIN };
const DEFAULT_FEATURES: Record<string, 'ENABLED' | 'DISABLED'> = { S3_DATA_EVENTS: 'ENABLED', EKS_AUDIT_LOGS: 'DISABLED', EBS_MALWARE_PROTECTION: 'ENABLED', RDS_LOGIN_EVENTS: 'DISABLED', LAMBDA_NETWORK_LOGS: 'DISABLED', RUNTIME_MONITORING: 'DISABLED' };

const bad = (msg: string) => new AwsError('BadRequestException', msg, 400);

// ───────────────────────── catálogo de tipos de hallazgo ─────────────────────────

type Kind = 'instance' | 'key' | 's3';

interface FindingType {
  sev: number;
  kind: Kind;
  title: string;
  desc: string;
  action: 'AWS_API_CALL' | 'NETWORK_CONNECTION' | 'DNS_REQUEST' | 'PORT_PROBE';
  /** El hallazgo se basa en eventos de datos de S3 y exige tener activada la protección de S3. */
  s3Data?: boolean;
}

const T: Record<string, FindingType> = {
  'Backdoor:EC2/C&CActivity.B!DNS': { sev: 8, kind: 'instance', title: 'EC2 instance {r} is querying a domain name associated with a known Command & Control server.', desc: 'EC2 instance {r} is querying a domain name that is associated with a known Command & Control server.', action: 'DNS_REQUEST' },
  'CryptoCurrency:EC2/BitcoinTool.B!DNS': { sev: 8, kind: 'instance', title: 'EC2 instance {r} is querying a domain name associated with Bitcoin-related activity.', desc: 'EC2 instance {r} is querying a domain name that is associated with Bitcoin-related activity.', action: 'DNS_REQUEST' },
  'Trojan:EC2/DNSDataExfiltration': { sev: 8, kind: 'instance', title: 'EC2 instance {r} is exfiltrating data through DNS queries.', desc: 'EC2 instance {r} is running malware that uses DNS queries for outbound data transfer.', action: 'DNS_REQUEST' },
  'Trojan:EC2/BlackholeTraffic': { sev: 8, kind: 'instance', title: 'EC2 instance {r} is trying to communicate with a black hole IP address.', desc: 'EC2 instance {r} is attempting to communicate with an IP address of a remote host that is a known black hole.', action: 'NETWORK_CONNECTION' },
  'UnauthorizedAccess:EC2/SSHBruteForce': { sev: 2, kind: 'instance', title: 'SSH brute force attacks against {r}.', desc: 'EC2 instance {r} has been involved in SSH brute force attacks as the target of an attack.', action: 'NETWORK_CONNECTION' },
  'UnauthorizedAccess:EC2/RDPBruteForce': { sev: 2, kind: 'instance', title: 'RDP brute force attacks against {r}.', desc: 'EC2 instance {r} has been involved in RDP brute force attacks as the target of an attack.', action: 'NETWORK_CONNECTION' },
  'UnauthorizedAccess:EC2/TorClient': { sev: 8, kind: 'instance', title: 'EC2 instance {r} is making connections to a Tor Guard or an Authority node.', desc: 'EC2 instance {r} is making connections to a Tor Guard or an Authority node. Tor is software for enabling anonymous communication.', action: 'NETWORK_CONNECTION' },
  'UnauthorizedAccess:EC2/MaliciousIPCaller.Custom': { sev: 2, kind: 'instance', title: 'EC2 instance {r} is communicating with an IP address on a custom threat list.', desc: 'EC2 instance {r} is communicating with an IP address included on a threat list that you uploaded.', action: 'NETWORK_CONNECTION' },
  'Recon:EC2/PortProbeUnprotectedPort': { sev: 2, kind: 'instance', title: 'Unprotected port on EC2 instance {r} is being probed.', desc: 'EC2 instance {r} has an unprotected port which is being probed by a known malicious host.', action: 'PORT_PROBE' },
  'Recon:EC2/Portscan': { sev: 5, kind: 'instance', title: 'EC2 instance {r} is performing outbound port scans.', desc: 'EC2 instance {r} is performing outbound port scans against a remote host.', action: 'NETWORK_CONNECTION' },
  'Recon:IAMUser/ResourcePermissions': { sev: 5, kind: 'key', title: 'Principal {r} is invoking an API commonly used to discover resources and the calls were denied.', desc: 'Principal {r} invoked an API commonly used to discover the resources in an AWS environment. The calls failed with access denied.', action: 'AWS_API_CALL' },
  'Stealth:IAMUser/CloudTrailLoggingDisabled': { sev: 5, kind: 'key', title: 'AWS CloudTrail logging was disabled.', desc: 'AWS CloudTrail trail {r} was disabled. This can be an attempt to disable logging to hide unauthorized activity.', action: 'AWS_API_CALL' },
  'Policy:IAMUser/RootCredentialUsage': { sev: 5, kind: 'key', title: 'API {r} was invoked using root credentials.', desc: 'API {r} was invoked using root credentials.', action: 'AWS_API_CALL' },
  'PrivilegeEscalation:IAMUser/AdministrativePermissions': { sev: 5, kind: 'key', title: 'Principal {r} has granted administrative permissions.', desc: 'Principal {r} attempted to assign a highly permissive policy to itself or another principal.', action: 'AWS_API_CALL' },
  'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS': { sev: 8, kind: 'key', title: 'Credentials created exclusively for an EC2 instance through an Instance launch role are being used from an external IP address.', desc: 'Credentials that were created exclusively for an EC2 instance through an Instance launch role {r} are being used from an external IP address.', action: 'AWS_API_CALL' },
  'UnauthorizedAccess:IAMUser/TorIPCaller': { sev: 5, kind: 'key', title: 'API {r} was invoked from a Tor exit node IP address.', desc: 'An API was invoked from a Tor exit node IP address.', action: 'AWS_API_CALL' },
  'UnauthorizedAccess:IAMUser/MaliciousIPCaller.Custom': { sev: 5, kind: 'key', title: 'API {r} was invoked from an IP address on a custom threat list.', desc: 'An API was invoked from an IP address that is included on a threat list that you uploaded.', action: 'AWS_API_CALL' },
  'Persistence:IAMUser/UserPermissions': { sev: 5, kind: 'key', title: 'Principal {r} anomalously invoked an API used to change user permissions.', desc: 'Principal {r} anomalously invoked an API commonly used to change permissions of IAM users.', action: 'AWS_API_CALL' },
  'Policy:S3/BucketAnonymousAccessGranted': { sev: 5, kind: 's3', title: 'S3 bucket {r} has been made publicly accessible.', desc: 'S3 bucket {r} was made public by changing its policy or ACL.', action: 'AWS_API_CALL' },
  'Policy:S3/BucketBlockPublicAccessDisabled': { sev: 2, kind: 's3', title: 'Block Public Access was disabled for S3 bucket {r}.', desc: 'Block Public Access settings were disabled for S3 bucket {r}.', action: 'AWS_API_CALL' },
  'Stealth:S3/ServerAccessLoggingDisabled': { sev: 2, kind: 's3', title: 'S3 server access logging was disabled for bucket {r}.', desc: 'S3 server access logging was disabled for bucket {r}.', action: 'AWS_API_CALL' },
  'Exfiltration:S3/ObjectRead.Unusual': { sev: 5, kind: 's3', title: 'An IAM entity invoked an S3 API in a suspicious way against bucket {r}.', desc: 'An IAM entity invoked an S3 API in a way that is unusual for it, against bucket {r}.', action: 'AWS_API_CALL', s3Data: true },
  'Discovery:S3/MaliciousIPCaller': { sev: 5, kind: 's3', title: 'A known malicious IP address invoked an S3 API against bucket {r}.', desc: 'An S3 API operation was invoked from a known malicious IP address.', action: 'AWS_API_CALL', s3Data: true },
  'Impact:S3/ObjectDelete.Unusual': { sev: 5, kind: 's3', title: 'An IAM entity invoked an S3 API used to delete data in bucket {r}.', desc: 'An IAM entity invoked an S3 API used to delete objects, in a way that is unusual for it.', action: 'AWS_API_CALL', s3Data: true },
};

export const GD_TYPES = Object.keys(T);

// ───────────────────────── recursos y hallazgos ─────────────────────────

export function findInstance(a: Account, ref: string): { inst: Ec2Instance; region: string } | undefined {
  for (const [region, rs] of Object.entries(a.regions)) {
    const hit = Object.values(rs.ec2.instances).find((i) => i.state !== 'terminated' && (i.InstanceId === ref || i.Tags.some((t) => t.Key === 'Name' && t.Value === ref)));
    if (hit) return { inst: hit, region };
  }
  return undefined;
}

function instanceResource(a: Account, region: string, i: Ec2Instance) {
  const sgs = regional(a, region).ec2.securityGroups;
  return {
    ResourceType: 'Instance',
    InstanceDetails: {
      InstanceId: i.InstanceId,
      InstanceType: i.InstanceType,
      InstanceState: i.state,
      ImageId: i.ImageId,
      LaunchTime: i.LaunchTime,
      AvailabilityZone: i.AvailabilityZone,
      Platform: null,
      IamInstanceProfile: i.IamInstanceProfile ? { Arn: i.IamInstanceProfile } : null,
      NetworkInterfaces: [{ PrivateIpAddress: i.PrivateIpAddress, PublicIp: i.PublicIpAddress ?? null, SubnetId: i.SubnetId, VpcId: i.VpcId, SecurityGroups: i.SecurityGroupIds.map((g) => ({ GroupId: g, GroupName: sgs[g]?.GroupName ?? g })) }],
      Tags: i.Tags.map((t) => ({ Key: t.Key, Value: t.Value })),
    },
  };
}

const keyResource = (a: Account, user: string, type = 'IAMUser', keyId?: string) => ({
  ResourceType: 'AccessKey',
  AccessKeyDetails: { AccessKeyId: keyId ?? (type === 'Root' ? 'ASIA' + newId(a, 'gdkey', '', 16, 'up') : 'AKIA' + newId(a, 'gdkey', '', 16, 'up')), PrincipalId: 'AIDA' + newId(a, 'gdpid', '', 17, 'up'), UserType: type, UserName: user },
});

const s3Resource = (a: Account, bucket: string) => ({ ResourceType: 'S3Bucket', S3BucketDetails: [{ Arn: `arn:aws:s3:::${bucket}`, Name: bucket, Type: 'Destination', CreatedAt: iso(a.clock), Owner: { Id: a.id }, DefaultServerSideEncryption: null, PublicAccess: { EffectivePermission: 'NOT_PUBLIC' } }] });

interface Emit {
  type: string;
  /** Texto que sustituye a `{r}` en el título y la descripción. */
  subject: string;
  resource: Record<string, any>;
  /** Identifica el mismo hallazgo para acumularlo (recurso + detalle). */
  key: string;
  action?: Record<string, any>;
  sample?: boolean;
  info?: Record<string, any>;
  at?: number;
}

const actionFor = (kind: FindingType['action'], a: Account, o: Emit): Record<string, any> => {
  if (o.action) return o.action;
  const ip = '198.51.100.66';
  switch (kind) {
    case 'DNS_REQUEST':
      return { ActionType: 'DNS_REQUEST', DnsRequestAction: { Domain: o.type.includes('Bitcoin') ? 'pool.minexmr.example' : 'c2.malware-domain.example', Protocol: 'UDP', Blocked: false } };
    case 'PORT_PROBE':
      return { ActionType: 'PORT_PROBE', PortProbeAction: { Blocked: false, PortProbeDetails: [{ LocalPortDetails: { Port: 22, PortName: 'SSH' }, RemoteIpDetails: { IpAddressV4: ip, Country: { CountryName: 'United States' }, Organization: { Asn: '64500', Org: 'Example ISP' } } }] } };
    case 'NETWORK_CONNECTION':
      return { ActionType: 'NETWORK_CONNECTION', NetworkConnectionAction: { Blocked: false, ConnectionDirection: 'INBOUND', LocalPortDetails: { Port: 22, PortName: 'SSH' }, Protocol: 'TCP', RemoteIpDetails: { IpAddressV4: ip, Country: { CountryName: 'United States' } }, RemotePortDetails: { Port: 49152 + (a.clock % 1000), PortName: 'Unknown' } } };
    default:
      return { ActionType: 'AWS_API_CALL', AwsApiCallAction: { Api: 'ListBuckets', ServiceName: 'iam.amazonaws.com', CallerType: 'Remote IP', RemoteIpDetails: { IpAddressV4: ip, Country: { CountryName: 'Russia' } }, AffectedResources: {} } };
  }
};

const criterionValue = (f: GdFinding, name: string): (string | number)[] => {
  const r = f.Resource;
  const act = f.Service.Action;
  const map: Record<string, unknown> = {
    id: f.Id,
    type: f.Type,
    severity: f.Severity,
    title: f.Title,
    region: f.Arn.split(':')[3],
    accountId: f.Arn.split(':')[4],
    updatedAt: Date.parse(f.UpdatedAt),
    createdAt: Date.parse(f.CreatedAt),
    'resource.resourceType': r.ResourceType,
    'resource.instanceDetails.instanceId': r.InstanceDetails?.InstanceId,
    'resource.instanceDetails.tags.key': r.InstanceDetails?.Tags?.map((t: { Key: string }) => t.Key),
    'resource.instanceDetails.tags.value': r.InstanceDetails?.Tags?.map((t: { Value: string }) => t.Value),
    'resource.accessKeyDetails.userName': r.AccessKeyDetails?.UserName,
    'resource.accessKeyDetails.accessKeyId': r.AccessKeyDetails?.AccessKeyId,
    'resource.s3BucketDetails.name': r.S3BucketDetails?.map((b: { Name: string }) => b.Name),
    'service.archived': String(f.Service.Archived),
    'service.action.actionType': act.ActionType,
    'service.action.awsApiCallAction.api': act.AwsApiCallAction?.Api,
    'service.count': f.Service.Count,
    'service.eventFirstSeen': Date.parse(f.Service.EventFirstSeen),
    'service.eventLastSeen': Date.parse(f.Service.EventLastSeen),
    'service.additionalInfo.sample': String(!!f.sample),
  };
  const v = map[name];
  return v === undefined || v === null ? [] : toArr(v as string | number | (string | number)[]);
};

/** ¿Cumple el hallazgo todos los criterios de un filtro? */
export function gdMatches(f: GdFinding, criteria: GdFilter['FindingCriteria'] | undefined): boolean {
  const crit = criteria?.Criterion ?? {};
  return Object.entries(crit).every(([name, cond]) => {
    const have = criterionValue(f, name);
    const eq = (cond.Eq ?? cond.Equals) as (string | number)[] | undefined;
    const neq = (cond.Neq ?? cond.NotEquals) as (string | number)[] | undefined;
    const num = (k: string, k2: string) => (cond[k] ?? cond[k2]) as number | undefined;
    const has = (x: string | number) => have.some((h) => String(h) === String(x));
    if (eq && !eq.some(has)) return false;
    if (neq && neq.some(has)) return false;
    const [gt, gte, lt, lte] = [num('Gt', 'GreaterThan'), num('Gte', 'GreaterThanOrEqual'), num('Lt', 'LessThan'), num('Lte', 'LessThanOrEqual')];
    if (gt !== undefined && !have.some((h) => Number(h) > gt)) return false;
    if (gte !== undefined && !have.some((h) => Number(h) >= gte)) return false;
    if (lt !== undefined && !have.some((h) => Number(h) < lt)) return false;
    if (lte !== undefined && !have.some((h) => Number(h) <= lte)) return false;
    return true;
  });
}

const eventShape = (a: Account, region: string, f: GdFinding) => ({
  schemaVersion: '2.0',
  accountId: a.id,
  region,
  partition: 'aws',
  id: f.Id,
  arn: f.Arn,
  type: f.Type,
  resource: f.Resource,
  service: f.Service,
  severity: f.Severity,
  createdAt: f.CreatedAt,
  updatedAt: f.UpdatedAt,
  title: f.Title,
  description: f.Description,
});

/** Crea el hallazgo (o acumula una repetición en el que ya existe) y avisa a EventBridge. */
function emit(a: Account, region: string, d: GdDetector, o: Emit): GdFinding | undefined {
  const def = T[o.type];
  if (!def) return undefined;
  if (def.s3Data && d.Features.S3_DATA_EVENTS !== 'ENABLED' && !o.sample) return undefined;
  const now = o.at ?? a.clock;
  const key = `${o.type}|${o.key}`;
  const prev = Object.values(d.findings).find((f) => f.key === key && !!f.sample === !!o.sample);
  const freq = FREQ_MS[d.Frequency] ?? 360 * MIN;
  if (prev) {
    prev.Service.Count += 1;
    prev.Service.EventLastSeen = isoZ(now);
    prev.UpdatedAt = isoZ(now);
    // las actualizaciones solo se publican con la frecuencia del detector
    if (now - (prev.sentAt ?? 0) >= freq) publish(a, region, prev);
    return prev;
  }
  const id = newId(a, 'gdfinding', '', 32, 'hex');
  const f: GdFinding = {
    Id: id,
    Arn: mkArn('guardduty', region, a.id, `detector/${d.Id}/finding/${id}`),
    Type: o.type,
    Severity: def.sev,
    Title: (o.sample ? '[SAMPLE] ' : '') + def.title.replace('{r}', o.subject),
    Description: def.desc.replace('{r}', o.subject),
    Resource: o.resource,
    Service: { Action: actionFor(def.action, a, o), Archived: false, Count: 1, DetectorId: d.Id, EventFirstSeen: isoZ(now), EventLastSeen: isoZ(now), ResourceRole: 'TARGET', ServiceName: 'guardduty', AdditionalInfo: { ...(o.sample ? { Sample: true } : {}), ...(o.info ?? {}) } },
    CreatedAt: isoZ(now),
    UpdatedAt: isoZ(now),
    key,
    ...(o.sample ? { sample: true } : {}),
  };
  // un filtro de tipo ARCHIVE archiva el hallazgo nada más nacer
  const rule = Object.values(d.filters)
    .filter((x) => x.Action === 'ARCHIVE')
    .sort((x, y) => x.Rank - y.Rank)
    .find((x) => gdMatches(f, x.FindingCriteria));
  if (rule) f.Service.Archived = true;
  d.findings[id] = f;
  if (!f.Service.Archived) publish(a, region, f);
  exportFinding(a, region, d, f);
  return f;
}

function publish(a: Account, region: string, f: GdFinding): void {
  f.sentAt = a.clock;
  try {
    putEvent(a, region, 'default', { source: 'aws.guardduty', detailType: 'GuardDuty Finding', resources: [], detail: eventShape(a, region, f) });
  } catch {
    /* sin reglas */
  }
}

/** Exportación a S3 si hay un destino configurado. */
function exportFinding(a: Account, region: string, d: GdDetector, f: GdFinding): void {
  const dest = Object.values(d.destinations)[0];
  if (!dest) return;
  const bucket = a.s3.buckets[dest.DestinationArn.replace(/^arn:aws:s3:::/, '').split('/')[0]];
  if (!bucket) return;
  const t = new Date(a.clock);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const key = `AWSLogs/${a.id}/GuardDuty/${region}/${t.getUTCFullYear()}/${p2(t.getUTCMonth() + 1)}/${p2(t.getUTCDate())}/${f.Id}.jsonl`;
  s3Put(a, bucket, key, JSON.stringify(eventShape(a, region, f)) + '\n', { sse: 'aws:kms', kmsKeyId: dest.KmsKeyArn });
}

// ───────────────────────── detección a partir de la actividad ─────────────────────────

const DENIED = new Set(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation', 'Client.UnauthorizedOperation', 'UnauthorizedAccess']);
const ADMIN_POLICY = /(^|\/)AdministratorAccess$/;

function scanEvents(a: Account, region: string, d: GdDetector): void {
  const events = ctOf(a).events.filter((e) => (e.t > d.scanned || (e.t === d.scanned && !d.boundary.includes(e.id))) && e.t <= a.clock);
  const denials: Record<string, number> = {};
  for (const ev of events) {
    const rec = ev.record as { userIdentity?: { type?: string; accessKeyId?: string }; requestParameters?: Record<string, unknown> | null; errorCode?: string; sourceIPAddress?: string };
    const failed = !!rec.errorCode;
    const who = ev.user || 'desconocido';
    const type = rec.userIdentity?.type === 'Root' || ev.user === 'root' ? 'Root' : 'IAMUser';
    const key = keyResource(a, who, type, ev.accessKeyId);
    const base = { resource: key, at: ev.t };
    if (!failed && (ev.name === 'StopLogging' || ev.name === 'DeleteTrail')) {
      const trail = String(rec.requestParameters?.name ?? 'trail');
      emit(a, region, d, { type: 'Stealth:IAMUser/CloudTrailLoggingDisabled', subject: trail, key: `${who}|${trail}`, ...base });
    }
    if (type === 'Root' && ev.source !== 'guardduty.amazonaws.com') emit(a, region, d, { type: 'Policy:IAMUser/RootCredentialUsage', subject: ev.name, key: ev.name, ...base });
    if (!failed && ['AttachUserPolicy', 'AttachRolePolicy', 'AttachGroupPolicy'].includes(ev.name) && type !== 'Root' && ADMIN_POLICY.test(String(rec.requestParameters?.policyArn ?? ''))) emit(a, region, d, { type: 'PrivilegeEscalation:IAMUser/AdministrativePermissions', subject: who, key: `${who}|${JSON.stringify(rec.requestParameters)}`, ...base });
    if (failed && DENIED.has(String(rec.errorCode))) denials[who] = (denials[who] ?? 0) + 1;
    const bucket = String(rec.requestParameters?.bucketName ?? '');
    const b = bucket ? a.s3.buckets[bucket] : undefined;
    if (!failed && b) {
      const pab = b.publicAccessBlock;
      if (['PutBucketPolicy', 'PutBucketAcl', 'DeletePublicAccessBlock', 'PutPublicAccessBlock'].includes(ev.name) && anonymousAllowed(b, 's3:GetObject', `arn:aws:s3:::${bucket}/x`)) emit(a, region, d, { type: 'Policy:S3/BucketAnonymousAccessGranted', subject: bucket, resource: s3Resource(a, bucket), key: bucket, at: ev.t });
      if (['DeletePublicAccessBlock', 'PutPublicAccessBlock'].includes(ev.name) && (!pab || !(pab.BlockPublicAcls && pab.IgnorePublicAcls && pab.BlockPublicPolicy && pab.RestrictPublicBuckets))) emit(a, region, d, { type: 'Policy:S3/BucketBlockPublicAccessDisabled', subject: bucket, resource: s3Resource(a, bucket), key: bucket, at: ev.t });
      if (ev.name === 'DeleteBucketLogging' || (ev.name === 'PutBucketLogging' && !b.logging)) emit(a, region, d, { type: 'Stealth:S3/ServerAccessLoggingDisabled', subject: bucket, resource: s3Resource(a, bucket), key: bucket, at: ev.t });
    }
  }
  for (const [who, n] of Object.entries(denials)) if (n >= 5) emit(a, region, d, { type: 'Recon:IAMUser/ResourcePermissions', subject: who, resource: keyResource(a, who), key: who });
  d.scanned = a.clock;
  d.boundary = ctOf(a).events.filter((e) => e.t === a.clock).map((e) => e.id);
}

/** Puertos de administración abiertos al mundo: con el tiempo, internet los sondea y los ataca. */
function scanExposure(a: Account, region: string, d: GdDetector): void {
  const r = regional(a, region).ec2;
  const seen = new Set<string>();
  for (const inst of Object.values(r.instances)) {
    if (inst.state !== 'running' || !inst.PublicIpAddress) continue;
    for (const [port, name, brute] of [[22, 'SSH', 'UnauthorizedAccess:EC2/SSHBruteForce'], [3389, 'RDP', 'UnauthorizedAccess:EC2/RDPBruteForce']] as const) {
      const k = `${inst.InstanceId}|${port}`;
      if (!traceFromInternet(a, r, inst, 'tcp', port, '198.51.100.66').reachable) continue;
      seen.add(k);
      d.exposed[k] ??= a.clock;
      const open = a.clock - d.exposed[k];
      const subject = inst.Tags.find((t) => t.Key === 'Name')?.Value ?? inst.InstanceId;
      const res = instanceResource(a, region, inst);
      const probe = { ActionType: 'PORT_PROBE', PortProbeAction: { Blocked: false, PortProbeDetails: [{ LocalPortDetails: { Port: port, PortName: name }, RemoteIpDetails: { IpAddressV4: '198.51.100.66', Country: { CountryName: 'United States' } } }] } };
      if (open >= 20 * MIN) emit(a, region, d, { type: 'Recon:EC2/PortProbeUnprotectedPort', subject, resource: res, key: `${inst.InstanceId}|${port}`, action: probe, at: d.exposed[k] + 20 * MIN });
      if (open >= 60 * MIN) emit(a, region, d, { type: brute, subject, resource: res, key: `${inst.InstanceId}|${port}`, at: d.exposed[k] + 60 * MIN });
    }
  }
  for (const k of Object.keys(d.exposed)) if (!seen.has(k)) delete d.exposed[k];
}

tickers.push((a) => {
  for (const [region, rs] of Object.entries(a.regions)) {
    for (const d of Object.values(rs.guardduty?.detectors ?? {})) {
      if (d.Status !== 'ENABLED') {
        d.scanned = a.clock;
        d.boundary = ctOf(a).events.filter((e) => e.t === a.clock).map((e) => e.id);
        continue;
      }
      scanEvents(a, region, d);
      scanExposure(a, region, d);
    }
  }
});

// ───────────────────────── detector ─────────────────────────

const detector = (c: Pick<OpCtx, 'acct' | 'region'>, id: unknown): GdDetector => {
  const d = gdOf(c.acct, c.region).detectors[String(id)];
  if (!d) throw bad('The request is rejected because the input detectorId is not owned by the current account.');
  return d;
};

const resDet = (c: OpCtx) => mkArn('guardduty', c.region, c.acct.id, `detector/${c.p.DetectorId ?? '*'}`);

const tagMap = (t: unknown): Record<string, string> => {
  const x = Object.assign({}, ...toArr<Record<string, string>>(t as Record<string, string>[]));
  return x as Record<string, string>;
};

const dView = (a: Account, d: GdDetector) => ({
  CreatedAt: isoZ(d.created),
  FindingPublishingFrequency: d.Frequency,
  ServiceRole: `arn:aws:iam::${a.id}:role/aws-service-role/guardduty.amazonaws.com/AWSServiceRoleForAmazonGuardDuty`,
  Status: d.Status,
  UpdatedAt: isoZ(d.updated),
  DataSources: { CloudTrail: { Status: 'ENABLED' }, DNSLogs: { Status: 'ENABLED' }, FlowLogs: { Status: 'ENABLED' }, S3Logs: { Status: d.Features.S3_DATA_EVENTS }, Kubernetes: { AuditLogs: { Status: d.Features.EKS_AUDIT_LOGS } }, MalwareProtection: { ScanEc2InstanceWithFindings: { EbsVolumes: { Status: d.Features.EBS_MALWARE_PROTECTION } }, ServiceRole: null } },
  Tags: d.Tags,
  Features: Object.entries(d.Features).map(([Name, Status]) => ({ Name, Status, UpdatedAt: isoZ(d.updated) })),
});

function applyFeatures(d: GdDetector, raw: unknown): void {
  for (const f of toArr<{ Name: string; Status: string }>(raw as { Name: string; Status: string }[])) {
    if (!(f.Name in DEFAULT_FEATURES)) throw bad(`The request is rejected because the feature name ${f.Name} is not valid.`);
    if (!['ENABLED', 'DISABLED'].includes(f.Status)) throw bad('The request is rejected because the feature status must be ENABLED or DISABLED.');
    d.Features[f.Name] = f.Status as 'ENABLED' | 'DISABLED';
  }
}

op('guardduty', 'create-detector', 'enable:b finding-publishing-frequency:s data-sources:j tags:j features:f client-token:s', 'Activa GuardDuty en esta región (un detector por cuenta y región).', { res: (c) => mkArn('guardduty', c.region, c.acct.id, 'detector/*') }, (c) => {
  const st = gdOf(c.acct, c.region);
  if (Object.keys(st.detectors).length) throw bad('The request is rejected because a detector already exists for the current account.');
  const freq = String(c.p.FindingPublishingFrequency ?? 'SIX_HOURS');
  if (!FREQ_MS[freq]) throw bad(`The request is rejected because the findingPublishingFrequency ${freq} is not valid.`);
  const id = newId(c.acct, 'gddet', '', 32, 'hex');
  const d: GdDetector = { Id: id, Status: c.p.Enable === false ? 'DISABLED' : 'ENABLED', created: c.acct.clock, updated: c.acct.clock, Frequency: freq, Features: { ...DEFAULT_FEATURES }, Tags: tagMap(c.p.Tags), findings: {}, filters: {}, sets: {}, destinations: {}, scanned: c.acct.clock, boundary: ctOf(c.acct).events.filter((e) => e.t === c.acct.clock).map((e) => e.id), exposed: {} };
  if (c.p.Features) applyFeatures(d, c.p.Features);
  st.detectors[id] = d;
  return { DetectorId: id };
});

op('guardduty', 'list-detectors', 'max-results:i next-token:s', 'Los detectores de la región.', { res: () => '*' }, (c) => ({ DetectorIds: Object.keys(gdOf(c.acct, c.region).detectors) }));
op('guardduty', 'get-detector', 'detector-id:s!', 'Estado de un detector y de sus fuentes de datos.', { res: resDet }, (c) => dView(c.acct, detector(c, c.p.DetectorId)));
op('guardduty', 'update-detector', 'detector-id:s! enable:b finding-publishing-frequency:s data-sources:j features:f', 'Activa o suspende el detector y cambia con qué frecuencia publica las actualizaciones.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  if (c.p.Enable !== undefined) d.Status = c.p.Enable ? 'ENABLED' : 'DISABLED';
  if (c.p.FindingPublishingFrequency) {
    if (!FREQ_MS[String(c.p.FindingPublishingFrequency)]) throw bad(`The request is rejected because the findingPublishingFrequency ${c.p.FindingPublishingFrequency} is not valid.`);
    d.Frequency = String(c.p.FindingPublishingFrequency);
  }
  if (c.p.Features) applyFeatures(d, c.p.Features);
  d.updated = c.acct.clock;
  return {};
});
op('guardduty', 'delete-detector', 'detector-id:s!', 'Desactiva GuardDuty y borra los hallazgos del detector.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  delete gdOf(c.acct, c.region).detectors[d.Id];
  return {};
});

// ───────────────────────── hallazgos ─────────────────────────

function findings(c: OpCtx, d: GdDetector): GdFinding[] {
  const crit = c.p.FindingCriteria as GdFilter['FindingCriteria'] | undefined;
  let list = Object.values(d.findings).filter((f) => gdMatches(f, crit));
  const sort = c.p.SortCriteria as { AttributeName?: string; OrderBy?: string } | undefined;
  const attr = sort?.AttributeName ?? 'updatedAt';
  const dir = sort?.OrderBy === 'ASC' ? 1 : -1;
  list = list.sort((x, y) => {
    const a = criterionValue(x, attr)[0];
    const b = criterionValue(y, attr)[0];
    return dir * (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
  });
  return list;
}

op('guardduty', 'list-findings', 'detector-id:s! finding-criteria:j sort-criteria:j max-results:i next-token:s', 'Los ids de los hallazgos que cumplen unos criterios (`service.archived`, `severity`, `type`…).', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  const max = Number(c.p.MaxResults ?? 50);
  return { FindingIds: findings(c, d).slice(0, max).map((f) => f.Id) };
});

const view = (a: Account, region: string, f: GdFinding) => ({ AccountId: a.id, Arn: f.Arn, CreatedAt: f.CreatedAt, Description: f.Description, Id: f.Id, Partition: 'aws', Region: region, Resource: f.Resource, SchemaVersion: '2.0', Service: f.Service, Severity: f.Severity, Title: f.Title, Type: f.Type, UpdatedAt: f.UpdatedAt });

op('guardduty', 'get-findings', 'detector-id:s! finding-ids:l! sort-criteria:j', 'Detalle de uno o varios hallazgos.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  return { Findings: toArr<string>(c.p.FindingIds).map((i) => d.findings[i]).filter((f): f is GdFinding => !!f).map((f) => view(c.acct, c.region, f)) };
});

const setArchived = (flag: boolean) => (c: OpCtx) => {
  const d = detector(c, c.p.DetectorId);
  for (const id of toArr<string>(c.p.FindingIds)) if (d.findings[id]) d.findings[id].Service.Archived = flag;
  return {};
};
op('guardduty', 'archive-findings', 'detector-id:s! finding-ids:l!', 'Archiva hallazgos (dejan de aparecer en la lista de «actuales»).', { res: resDet }, setArchived(true));
op('guardduty', 'unarchive-findings', 'detector-id:s! finding-ids:l!', 'Saca hallazgos del archivo.', { res: resDet }, setArchived(false));

op('guardduty', 'update-findings-feedback', 'detector-id:s! finding-ids:l! feedback:s! comments:s', 'Marca hallazgos como útiles (USEFUL) o no (NOT_USEFUL).', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  if (!['USEFUL', 'NOT_USEFUL'].includes(String(c.p.Feedback))) throw bad('The request is rejected because the feedback must be USEFUL or NOT_USEFUL.');
  for (const id of toArr<string>(c.p.FindingIds)) if (d.findings[id]) d.findings[id].Service.Feedback = String(c.p.Feedback);
  return {};
});

op('guardduty', 'get-findings-statistics', 'detector-id:s! finding-statistic-types:l! finding-criteria:j', 'Cuenta los hallazgos por gravedad.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  const by: Record<string, number> = {};
  for (const f of findings(c, d)) by[String(f.Severity)] = (by[String(f.Severity)] ?? 0) + 1;
  return { FindingStatistics: { CountBySeverity: by } };
});

op('guardduty', 'create-sample-findings', 'detector-id:s! finding-types:l', 'Crea hallazgos de ejemplo (con el prefijo [SAMPLE]) para probar alertas y automatizaciones.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  const types = c.p.FindingTypes ? toArr<string>(c.p.FindingTypes) : GD_TYPES;
  for (const t of types) if (!T[t]) throw bad(`The request is rejected because the finding type ${t} is not valid.`);
  const first = Object.values(regional(c.acct, c.region).ec2.instances).find((i) => i.state !== 'terminated');
  for (const t of types) {
    const def = T[t];
    const resource = def.kind === 'instance' ? (first ? instanceResource(c.acct, c.region, first) : { ResourceType: 'Instance', InstanceDetails: { InstanceId: 'i-99999999', InstanceType: 'm3.xlarge', Tags: [] } }) : def.kind === 'key' ? keyResource(c.acct, 'GeneratedFindingUserName') : s3Resource(c.acct, 'bucket-ejemplo');
    emit(c.acct, c.region, d, { type: t, subject: def.kind === 'instance' ? (first?.InstanceId ?? 'i-99999999') : def.kind === 's3' ? 'bucket-ejemplo' : 'GeneratedFindingUserName', resource, key: 'sample|' + t, sample: true });
  }
  return {};
});

// ───────────────────────── filtros ─────────────────────────

const fView = (f: GdFilter) => ({ Name: f.Name, Description: f.Description, Action: f.Action, Rank: f.Rank, FindingCriteria: f.FindingCriteria, Tags: f.Tags });
const filter = (d: GdDetector, name: unknown): GdFilter => {
  const f = d.filters[String(name)];
  if (!f) throw bad('The request is rejected because the input filter name does not exist.');
  return f;
};

op('guardduty', 'create-filter', 'detector-id:s! name:s! action:s description:s rank:i finding-criteria:j! tags:j', 'Crea un filtro: con la acción ARCHIVE archiva solos los hallazgos que cumplan los criterios (supresión).', { res: (c) => mkArn('guardduty', c.region, c.acct.id, `detector/${c.p.DetectorId}/filter/${c.p.Name}`) }, (c) => {
  const d = detector(c, c.p.DetectorId);
  const name = String(c.p.Name);
  if (d.filters[name]) throw bad('The request is rejected because a filter with the same name already exists.');
  const action = String(c.p.Action ?? 'NOOP');
  if (!['ARCHIVE', 'NOOP'].includes(action)) throw bad('The request is rejected because the action must be ARCHIVE or NOOP.');
  const crit = c.p.FindingCriteria as GdFilter['FindingCriteria'];
  if (!crit?.Criterion || !Object.keys(crit.Criterion).length) throw bad('The request is rejected because the findingCriteria must contain at least one criterion.');
  d.filters[name] = { Name: name, Description: c.p.Description ?? '', Action: action as 'ARCHIVE' | 'NOOP', Rank: Number(c.p.Rank ?? 1), FindingCriteria: crit, Tags: tagMap(c.p.Tags) };
  // un filtro nuevo también archiva los hallazgos que ya existen y coinciden
  if (action === 'ARCHIVE') for (const f of Object.values(d.findings)) if (gdMatches(f, crit)) f.Service.Archived = true;
  return { Name: name };
});
op('guardduty', 'get-filter', 'detector-id:s! filter-name:s!', 'Un filtro.', { res: resDet }, (c) => fView(filter(detector(c, c.p.DetectorId), c.p.FilterName)));
op('guardduty', 'list-filters', 'detector-id:s! max-results:i next-token:s', 'Nombres de los filtros.', { res: resDet }, (c) => ({ FilterNames: Object.keys(detector(c, c.p.DetectorId).filters) }));
op('guardduty', 'update-filter', 'detector-id:s! filter-name:s! action:s description:s rank:i finding-criteria:j', 'Cambia un filtro.', { res: resDet }, (c) => {
  const f = filter(detector(c, c.p.DetectorId), c.p.FilterName);
  if (c.p.Action) f.Action = c.p.Action;
  if (c.p.Description !== undefined) f.Description = c.p.Description;
  if (c.p.Rank !== undefined) f.Rank = Number(c.p.Rank);
  if (c.p.FindingCriteria) f.FindingCriteria = c.p.FindingCriteria;
  return { Name: f.Name };
});
op('guardduty', 'delete-filter', 'detector-id:s! filter-name:s!', 'Borra un filtro (los hallazgos ya archivados siguen archivados).', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  filter(d, c.p.FilterName);
  delete d.filters[String(c.p.FilterName)];
  return {};
});

// ───────────────────────── listas de IP de confianza y de amenazas ─────────────────────────

function locationOk(a: Account, loc: string): boolean {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(loc) ?? /^https:\/\/s3[.-][a-z0-9-]*\.?amazonaws\.com\/([^/]+)\/(.+)$/.exec(loc);
  if (!m) return false;
  const b = a.s3.buckets[m[1]];
  return !!b && !!s3Current(b, m[2]);
}

function setOps(kind: 'ip' | 'threat') {
  const noun = kind === 'ip' ? 'ip-set' : 'threat-intel-set';
  const api = kind === 'ip' ? 'IPSet' : 'ThreatIntelSet';
  const label = kind === 'ip' ? 'lista de IP de confianza' : 'lista de amenazas';
  const idKey = kind === 'ip' ? 'IpSetId' : 'ThreatIntelSetId';
  const sets = (d: GdDetector) => Object.values(d.sets).filter((s) => s.Kind === kind);
  const find = (d: GdDetector, id: unknown): GdListSet => {
    const s = d.sets[String(id)];
    if (!s || s.Kind !== kind) throw bad(`The request is rejected because the input ${kind === 'ip' ? 'ipSetId' : 'threatIntelSetId'} does not exist.`);
    return s;
  };
  const sv = (s: GdListSet) => ({ Name: s.Name, Format: s.Format, Location: s.Location, Status: s.Activate ? 'ACTIVE' : 'INACTIVE', Tags: s.Tags });
  op('guardduty', `create-${noun}`, 'detector-id:s! name:s! format:s! location:s! activate:b tags:j', `Crea una ${label} a partir de un archivo de S3 (una IP o CIDR por línea).`, { api: `Create${api}`, res: resDet }, (c) => {
    const d = detector(c, c.p.DetectorId);
    if (sets(d).length >= 6) throw new AwsError('LimitExceededException', 'The request is rejected because you have reached the limit of lists for this detector.', 400);
    if (!['TXT', 'STIX', 'OTX_CSV', 'ALIEN_VAULT', 'PROOF_POINT', 'FIRE_EYE'].includes(String(c.p.Format))) throw bad('The request is rejected because the format is not valid.');
    if (!locationOk(c.acct, String(c.p.Location))) throw bad('The request is rejected because the S3 location does not exist or is not readable. Upload the file first and use s3://bucket/key.');
    const id = newId(c.acct, 'gdset', '', 32, 'hex');
    d.sets[id] = { Id: id, Name: String(c.p.Name), Format: String(c.p.Format), Location: String(c.p.Location), Activate: !!c.p.Activate, Kind: kind, Tags: tagMap(c.p.Tags) };
    return { [idKey]: id };
  });
  op('guardduty', `list-${noun}s`, 'detector-id:s! max-results:i next-token:s', `Ids de las ${label}s.`, { api: `List${api}s`, res: resDet }, (c) => ({ [`${idKey}s`]: sets(detector(c, c.p.DetectorId)).map((s) => s.Id) }));
  op('guardduty', `get-${noun}`, `detector-id:s! ${kind === 'ip' ? 'ip-set-id' : 'threat-intel-set-id'}:s!`, `Una ${label}.`, { api: `Get${api}`, res: resDet }, (c) => sv(find(detector(c, c.p.DetectorId), c.p[idKey])));
  op('guardduty', `update-${noun}`, `detector-id:s! ${kind === 'ip' ? 'ip-set-id' : 'threat-intel-set-id'}:s! name:s location:s activate:b`, `Cambia o (des)activa una ${label}.`, { api: `Update${api}`, res: resDet }, (c) => {
    const s = find(detector(c, c.p.DetectorId), c.p[idKey]);
    if (c.p.Name) s.Name = c.p.Name;
    if (c.p.Location) {
      if (!locationOk(c.acct, String(c.p.Location))) throw bad('The request is rejected because the S3 location does not exist or is not readable.');
      s.Location = c.p.Location;
    }
    if (c.p.Activate !== undefined) s.Activate = !!c.p.Activate;
    return {};
  });
  op('guardduty', `delete-${noun}`, `detector-id:s! ${kind === 'ip' ? 'ip-set-id' : 'threat-intel-set-id'}:s!`, `Borra una ${label}.`, { api: `Delete${api}`, res: resDet }, (c) => {
    const d = detector(c, c.p.DetectorId);
    delete d.sets[find(d, c.p[idKey]).Id];
    return {};
  });
}
setOps('ip');
setOps('threat');

/** ¿Está la IP en alguna lista activa de ese tipo? Lee el archivo de S3 cada vez (así se ve el efecto de editarlo). */
function inList(a: Account, d: GdDetector, kind: 'ip' | 'threat', ip: string): boolean {
  for (const s of Object.values(d.sets)) {
    if (s.Kind !== kind || !s.Activate) continue;
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(s.Location);
    const body = m ? s3Current(a.s3.buckets[m[1]] ?? ({ objects: {} } as never), m[2])?.body ?? '' : '';
    if (body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).some((l) => (l.includes('/') ? cidrContainsIp(l, ip) : l === ip))) return true;
  }
  return false;
}

// ───────────────────────── destino de publicación (S3 + KMS) ─────────────────────────

const allowsGuardDuty = (doc: unknown, actions: string[]): boolean =>
  toArr<Record<string, any>>((doc as { Statement?: Record<string, any>[] } | undefined)?.Statement as Record<string, any>[]).some((s) => {
    if (s.Effect !== 'Allow') return false;
    const svc = toArr<string>(s.Principal?.Service);
    const acts = toArr<string>(s.Action).map((x) => x.toLowerCase());
    return svc.includes('guardduty.amazonaws.com') && actions.every((x) => acts.includes(x.toLowerCase()) || acts.includes(x.split(':')[0].toLowerCase() + ':*') || acts.includes('*'));
  });

op('guardduty', 'create-publishing-destination', 'detector-id:s! destination-type:s! destination-properties:f! client-token:s', 'Exporta los hallazgos a un bucket de S3 cifrado con una clave de KMS (los dos tienen que dejar escribir a GuardDuty).', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  if (c.p.DestinationType !== 'S3') throw bad('The request is rejected because the destination type must be S3.');
  const props = Object.assign({}, ...toArr<Record<string, string>>(c.p.DestinationProperties)) as { DestinationArn?: string; KmsKeyArn?: string };
  const bname = String(props.DestinationArn ?? '').replace(/^arn:aws:s3:::/, '').split('/')[0];
  const bucket = getBucket(c.acct, bname);
  if (!props.KmsKeyArn) throw bad('The request is rejected because a KMS key is required to publish findings.');
  if (!allowsGuardDuty(bucket.policy, ['s3:PutObject']) || !allowsGuardDuty(bucket.policy, ['s3:GetBucketLocation'])) throw bad(`The request is rejected because the bucket policy of ${bname} does not allow GuardDuty (guardduty.amazonaws.com) to call s3:PutObject and s3:GetBucketLocation.`);
  const key = Object.values(regional(c.acct, c.region).kms?.keys ?? {}).find((k) => k.Arn === props.KmsKeyArn);
  if (!key) throw bad('The request is rejected because the KMS key does not exist in this region.');
  if (!allowsGuardDuty(key.policy, ['kms:GenerateDataKey'])) throw bad('The request is rejected because the key policy does not allow GuardDuty (guardduty.amazonaws.com) to call kms:GenerateDataKey.');
  const id = newId(c.acct, 'gddest', '', 32, 'hex');
  d.destinations[id] = { DestinationId: id, DestinationArn: String(props.DestinationArn), KmsKeyArn: props.KmsKeyArn };
  return { DestinationId: id };
});
op('guardduty', 'list-publishing-destinations', 'detector-id:s! max-results:i next-token:s', 'Los destinos de exportación.', { res: resDet }, (c) => ({ Destinations: Object.values(detector(c, c.p.DetectorId).destinations).map((x) => ({ DestinationId: x.DestinationId, DestinationType: 'S3', Status: 'PUBLISHING' })) }));
op('guardduty', 'describe-publishing-destination', 'detector-id:s! destination-id:s!', 'Un destino de exportación.', { res: resDet }, (c) => {
  const x = detector(c, c.p.DetectorId).destinations[String(c.p.DestinationId)];
  if (!x) throw bad('The request is rejected because the input destinationId does not exist.');
  return { DestinationId: x.DestinationId, DestinationType: 'S3', Status: 'PUBLISHING', PublishingFailureStartTimestamp: 0, DestinationProperties: { DestinationArn: x.DestinationArn, KmsKeyArn: x.KmsKeyArn } };
});
op('guardduty', 'delete-publishing-destination', 'detector-id:s! destination-id:s!', 'Quita un destino de exportación.', { res: resDet }, (c) => {
  const d = detector(c, c.p.DetectorId);
  if (!d.destinations[String(c.p.DestinationId)]) throw bad('The request is rejected because the input destinationId does not exist.');
  delete d.destinations[String(c.p.DestinationId)];
  return {};
});

// ───────────────────────── ataques del corrector ─────────────────────────

/**
 * `_check attack --kind cryptominer --instance web`: provoca la actividad hostil para que el detector (si está encendido) la vea.
 * Tipos: cryptominer, c2, dns-exfil, tor-client, inbound (con --from-ip), brute-force, credential-exfil (--role), tor-login (--user), s3-exfil (--bucket).
 */
op('_check', 'attack', 'kind:s! instance:s role:s user:s bucket:s from-ip:s', 'Provoca una actividad hostil (minero, C2, robo de credenciales…) para ver si GuardDuty la detecta.', { global: true, authz: false, anon: true }, (c) => {
  const kind = String(c.p.Kind);
  const ip = String(c.p.FromIp ?? '198.51.100.66');
  const inst = () => {
    const h = findInstance(c.acct, String(c.p.Instance ?? ''));
    if (!h) throw new AwsError('InvalidInstanceID.NotFound', `La instancia «${c.p.Instance}» no existe`);
    return h;
  };
  const det = (region: string) => Object.values(gdOf(c.acct, region).detectors).find((x) => x.Status === 'ENABLED');
  const out = (n: number, why?: string) => ({ Injected: kind, Findings: n, ...(why ? { Note: why } : {}) });
  const onInstance = (type: string) => {
    const { inst: i, region } = inst();
    const d = det(region);
    if (!d) return out(0, 'GuardDuty no está activado en la región');
    if (inList(c.acct, d, 'ip', ip)) return out(0, 'La IP está en la lista de confianza');
    const f = emit(c.acct, region, d, { type, subject: i.Tags.find((t) => t.Key === 'Name')?.Value ?? i.InstanceId, resource: instanceResource(c.acct, region, i), key: i.InstanceId });
    return out(f ? 1 : 0);
  };
  switch (kind) {
    case 'cryptominer':
      return onInstance('CryptoCurrency:EC2/BitcoinTool.B!DNS');
    case 'c2':
      return onInstance('Backdoor:EC2/C&CActivity.B!DNS');
    case 'dns-exfil':
      return onInstance('Trojan:EC2/DNSDataExfiltration');
    case 'tor-client':
      return onInstance('UnauthorizedAccess:EC2/TorClient');
    case 'brute-force':
      return onInstance('UnauthorizedAccess:EC2/SSHBruteForce');
    case 'inbound': {
      const { inst: i, region } = inst();
      const d = det(region);
      if (!d) return out(0, 'GuardDuty no está activado en la región');
      if (inList(c.acct, d, 'ip', ip)) return out(0, 'La IP está en la lista de confianza');
      let n = 0;
      if (inList(c.acct, d, 'threat', ip) && emit(c.acct, region, d, { type: 'UnauthorizedAccess:EC2/MaliciousIPCaller.Custom', subject: i.InstanceId, resource: instanceResource(c.acct, region, i), key: `${i.InstanceId}|${ip}` })) n++;
      else if (REPUTATION_CIDRS.some((x) => cidrContainsIp(x, ip)) && emit(c.acct, region, d, { type: 'Recon:EC2/PortProbeUnprotectedPort', subject: i.InstanceId, resource: instanceResource(c.acct, region, i), key: `${i.InstanceId}|${ip}` })) n++;
      return out(n, n ? undefined : 'La IP no está en ninguna lista de amenazas');
    }
    case 'credential-exfil': {
      const role = String(c.p.Role ?? '');
      let n = 0;
      for (const [region, rs] of Object.entries(c.acct.regions)) {
        const d = Object.values(rs.guardduty?.detectors ?? {}).find((x) => x.Status === 'ENABLED');
        if (d && inList(c.acct, d, 'ip', ip)) return out(0, 'La IP está en la lista de confianza');
        if (d && emit(c.acct, region, d, { type: 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS', subject: role, resource: keyResource(c.acct, role, 'AssumedRole', 'ASIA' + newId(c.acct, 'gdexf', '', 16, 'up')), key: role })) n++;
      }
      return out(n);
    }
    case 'tor-login': {
      const user = String(c.p.User ?? 'ana');
      let n = 0;
      for (const [region, rs] of Object.entries(c.acct.regions)) {
        const d = Object.values(rs.guardduty?.detectors ?? {}).find((x) => x.Status === 'ENABLED');
        if (d && emit(c.acct, region, d, { type: 'UnauthorizedAccess:IAMUser/TorIPCaller', subject: 'ConsoleLogin', resource: keyResource(c.acct, user), key: user })) n++;
      }
      return out(n);
    }
    case 's3-exfil': {
      const bucket = String(c.p.Bucket ?? '');
      const b = c.acct.s3.buckets[bucket];
      if (!b) throw new AwsError('NoSuchBucket', `El bucket «${bucket}» no existe`);
      const d = det(b.region);
      if (!d) return out(0, 'GuardDuty no está activado en la región del bucket');
      const f = emit(c.acct, b.region, d, { type: 'Exfiltration:S3/ObjectRead.Unusual', subject: bucket, resource: s3Resource(c.acct, bucket), key: bucket });
      return out(f ? 1 : 0, f ? undefined : 'La protección de S3 de GuardDuty está desactivada');
    }
    default:
      throw new AwsError('InvalidParameterValue', `Tipo de ataque desconocido: ${kind}`);
  }
});

/** `_check guardduty`: resumen de los detectores y de los hallazgos activos (para el corrector). */
op('_check', 'guardduty', 'region:s', 'Resumen de GuardDuty: detectores, hallazgos activos, filtros y destinos.', { global: true, authz: false, anon: true }, (c) => {
  const out: Record<string, unknown> = {};
  for (const [region, rs] of Object.entries(c.acct.regions)) {
    if (c.p.Region && c.p.Region !== region) continue;
    for (const d of Object.values(rs.guardduty?.detectors ?? {})) {
      const active = Object.values(d.findings).filter((f) => !f.Service.Archived);
      out[region] = { Status: d.Status, Active: active.length, Archived: Object.values(d.findings).length - active.length, Types: [...new Set(active.map((f) => f.Type))].sort(), Filters: Object.keys(d.filters), Destinations: Object.keys(d.destinations).length, Frequency: d.Frequency };
    }
  }
  return out;
});
