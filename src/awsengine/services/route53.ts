/** Amazon Route 53: zonas alojadas y registros DNS (y la resolución de nombres desde la terminal). */
import { AwsError, op } from '../registry';
import { instancePage } from '../hosting';
import { traceFromInternet } from '../net';
import { tickers } from '../tick';
import type { Account, HealthCheck, HostedZone, RecordSet } from '../types';
import { md5 } from '../../engine/commands/hash';
import { isObj, iso, newId, stableId, toArr } from '../util';
import { lbByDns, lbFromInternet, lbHandle, lbHasHealthy, lbState } from './elb';

const dot = (n: string) => (n.endsWith('.') ? n : n + '.').toLowerCase();
const undot = (n: string) => n.replace(/\.$/, '');
const zoneId = (id: string) => id.replace(/^\/hostedzone\//, '');

export const r53 = (a: Account) => (a.route53 ??= { zones: {} });

/** Servidores de nombres de una zona (cuatro, derivados del id). */
export function nameServers(z: { Id: string }): string[] {
  return [0, 1, 2, 3].map((i) => {
    const n = parseInt(stableId(`ns:${z.Id}:${i}`, '', 4), 16);
    return `ns-${(n % 1900) + 100 + i}.awsdns-${(n % 60) + 10}.${['com', 'net', 'org', 'co.uk'][i]}.`;
  });
}

export function r53CreateZone(a: Account, name: string, o: { comment?: string; private?: boolean } = {}): HostedZone {
  const id = newId(a, 'r53zone', 'Z', 13);
  const z: HostedZone = { Id: id, Name: dot(name), CallerReference: stableId(id, 'ref-', 8), Comment: o.comment, Private: !!o.private, records: [] };
  z.records.push({ Name: z.Name, Type: 'NS', TTL: 172800, ResourceRecords: nameServers(z).map((Value) => ({ Value })) });
  z.records.push({ Name: z.Name, Type: 'SOA', TTL: 900, ResourceRecords: [{ Value: `${nameServers(z)[0]} awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400` }] });
  r53(a).zones[id] = z;
  return z;
}

/** Añade o reemplaza un registro (para escenarios). `value` puede ser un texto o varios. */
export function r53Put(a: Account, zone: string, name: string, type: string, value: string | string[], ttl = 300): void {
  const z = Object.values(r53(a).zones).find((x) => x.Name === dot(zone))!;
  z.records = z.records.filter((x) => !(x.Name === dot(name) && x.Type === type));
  z.records.push({ Name: dot(name), Type: type, TTL: ttl, ResourceRecords: toArr(value).map((Value) => ({ Value })) });
}

// ───────────────────────── políticas de enrutamiento ─────────────────────────

export interface DnsCtx {
  /** Desde dónde pregunta el cliente (por defecto, la IP del alumno). */
  clientIp?: string;
}

export interface Geo {
  continent: string;
  country: string;
  lat: number;
  lon: number;
}

/** Ubicación de ejemplo según rangos de documentación (así los retos son reproducibles). */
export function clientGeo(ip: string): Geo {
  const o = ip.split('.').map(Number);
  if (o[0] === 203 && o[1] === 0 && o[2] === 113) return { continent: 'EU', country: 'ES', lat: 40.4, lon: -3.7 };
  if (o[0] === 198 && o[1] === 51 && o[2] === 100) return { continent: 'NA', country: 'US', lat: 39, lon: -98 };
  if (o[0] === 192 && o[1] === 0 && o[2] === 2) return { continent: 'AS', country: 'JP', lat: 35.7, lon: 139.7 };
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return { continent: 'SA', country: 'BR', lat: -23.5, lon: -46.6 };
  if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return { continent: 'OC', country: 'AU', lat: -33.9, lon: 151.2 };
  return { continent: '', country: '', lat: 0, lon: 0 };
}

const REGION_POS: Record<string, [number, number]> = {
  'us-east-1': [38.9, -77.4],
  'us-east-2': [40, -83],
  'us-west-1': [37.4, -121.9],
  'us-west-2': [45.8, -119.7],
  'ca-central-1': [45.5, -73.6],
  'sa-east-1': [-23.5, -46.6],
  'eu-west-1': [53.3, -6.3],
  'eu-west-2': [51.5, -0.1],
  'eu-west-3': [48.9, 2.4],
  'eu-central-1': [50.1, 8.7],
  'eu-north-1': [59.3, 18.1],
  'ap-south-1': [19.1, 72.9],
  'ap-southeast-1': [1.3, 103.8],
  'ap-southeast-2': [-33.9, 151.2],
  'ap-northeast-1': [35.7, 139.7],
  'ap-northeast-2': [37.6, 127],
};

/** Latencias medias (ms) de un cliente de cada continente a cada región: las rutas submarinas no siguen la línea recta. */
const LATENCY: Record<string, Record<string, number>> = {
  EU: { 'eu-west-3': 25, 'eu-west-1': 30, 'eu-west-2': 32, 'eu-central-1': 35, 'eu-north-1': 55, 'us-east-1': 90, 'ca-central-1': 100, 'us-east-2': 105, 'ap-south-1': 130, 'us-west-1': 150, 'us-west-2': 160, 'ap-southeast-1': 170, 'sa-east-1': 190, 'ap-northeast-1': 230, 'ap-northeast-2': 240, 'ap-southeast-2': 290 },
  NA: { 'us-east-2': 20, 'us-east-1': 25, 'ca-central-1': 30, 'us-west-2': 55, 'us-west-1': 60, 'eu-west-1': 85, 'eu-west-2': 90, 'eu-west-3': 95, 'eu-central-1': 100, 'eu-north-1': 110, 'sa-east-1': 120, 'ap-northeast-1': 130, 'ap-northeast-2': 140, 'ap-southeast-2': 160, 'ap-southeast-1': 190, 'ap-south-1': 200 },
  AS: { 'ap-northeast-1': 10, 'ap-northeast-2': 35, 'ap-southeast-1': 70, 'us-west-2': 100, 'us-west-1': 105, 'ap-southeast-2': 110, 'ap-south-1': 120, 'us-east-1': 150, 'us-east-2': 160, 'ca-central-1': 160, 'eu-west-1': 220, 'eu-west-2': 225, 'eu-central-1': 230, 'eu-west-3': 230, 'eu-north-1': 240, 'sa-east-1': 260 },
  SA: { 'sa-east-1': 15, 'us-east-1': 120, 'us-east-2': 130, 'ca-central-1': 140, 'us-west-1': 175, 'us-west-2': 180, 'eu-west-1': 190, 'eu-west-2': 195, 'eu-central-1': 200, 'eu-west-3': 200, 'eu-north-1': 215, 'ap-northeast-1': 270, 'ap-southeast-1': 330, 'ap-southeast-2': 310, 'ap-south-1': 300, 'ap-northeast-2': 280 },
  OC: { 'ap-southeast-2': 10, 'ap-southeast-1': 95, 'ap-northeast-1': 105, 'ap-northeast-2': 130, 'us-west-1': 140, 'us-west-2': 150, 'ap-south-1': 150, 'us-east-1': 220, 'us-east-2': 215, 'ca-central-1': 225, 'eu-west-1': 270, 'eu-west-2': 275, 'eu-central-1': 280, 'eu-west-3': 280, 'eu-north-1': 290, 'sa-east-1': 300 },
};

/** Latencia aproximada (ms) entre un cliente y una región. */
export function latencyMs(g: Geo, region: string): number {
  const known = LATENCY[g.continent]?.[region] ?? LATENCY.NA[region];
  if (known !== undefined) return known;
  const p = REGION_POS[region] ?? [0, 0];
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(p[0] - g.lat) / 2) ** 2 + Math.cos(rad(g.lat)) * Math.cos(rad(p[0])) * Math.sin(rad(p[1] - g.lon) / 2) ** 2;
  return Math.round(8 + (2 * 6371 * Math.asin(Math.sqrt(h))) / 65);
}

/** ¿Está sano el destino de este registro? (comprobación de salud asociada o «evaluar la salud del destino» de un alias) */
function recordHealthy(a: Account, r: RecordSet, depth = 0): boolean {
  if (r.HealthCheckId) {
    const hc = r53(a).healthChecks?.[r.HealthCheckId];
    if (hc && !hcReported(a, hc)) return false;
  }
  if (r.AliasTarget?.EvaluateTargetHealth) {
    const t = r.AliasTarget.DNSName.replace(/\.$/, '');
    const hit = lbByDns(a, t);
    if (hit) return lbHasHealthy(a, hit.region, hit.lb);
    if (depth < 4 && !t.endsWith('.amazonaws.com') && !t.endsWith('.cloudfront.net')) {
      const inner = r53Lookup(a, t, r.Type, depth + 1);
      if (inner && !inner.nxdomain) return inner.answers.length > 0;
    }
  }
  return true;
}

/** Elige qué registros contesta Route 53 entre los que comparten nombre y tipo (según su política). */
function chooseRecords(a: Account, group: RecordSet[], ctx: DnsCtx): RecordSet[] {
  if (group.length === 1 && !group[0].SetIdentifier) return group;
  const healthy = group.filter((r) => recordHealthy(a, r));
  const cands = healthy.length ? healthy : group;
  const client = clientGeo(ctx.clientIp ?? a.sourceIp);
  if (group.some((r) => r.Failover)) {
    const primary = group.find((r) => r.Failover === 'PRIMARY');
    const secondary = group.find((r) => r.Failover === 'SECONDARY');
    if (primary && recordHealthy(a, primary)) return [primary];
    if (secondary && recordHealthy(a, secondary)) return [secondary];
    return primary ? [primary] : secondary ? [secondary] : [];
  }
  if (group.some((r) => r.MultiValueAnswer)) return healthy.slice(0, 8);
  if (group.some((r) => r.GeoLocation)) {
    const by = (f: (r: RecordSet) => boolean) => cands.find(f);
    const hit = by((r) => !!r.GeoLocation?.CountryCode && r.GeoLocation.CountryCode === client.country) ?? by((r) => !!r.GeoLocation?.ContinentCode && r.GeoLocation.ContinentCode === client.continent) ?? by((r) => r.GeoLocation?.CountryCode === '*');
    return hit ? [hit] : [];
  }
  if (group.some((r) => r.Region)) {
    const withGeo = client.continent ? client : { ...client, lat: 38.9, lon: -77.4 };
    return [[...cands].sort((x, y) => latencyMs(withGeo, x.Region ?? '') - latencyMs(withGeo, y.Region ?? ''))[0]];
  }
  if (group.some((r) => r.Weight !== undefined)) {
    const pos = cands.filter((r) => (r.Weight ?? 0) > 0);
    if (!pos.length) return cands;
    a.counters.r53w = (a.counters.r53w ?? 0) + 1;
    const total = pos.reduce((n, r) => n + (r.Weight ?? 0), 0);
    let pick = parseInt(md5(`w:${a.id}:${a.counters.r53w}`).slice(0, 8), 16) % total;
    for (const r of pos) {
      if ((r.Weight ?? 0) > pick) return [r];
      pick -= r.Weight ?? 0;
    }
  }
  return [cands[0]];
}

// ───────────────────────── comprobaciones de salud ─────────────────────────

const CHECKERS = [
  { region: 'us-east-1', ip: '54.243.31.192' },
  { region: 'eu-west-1', ip: '54.228.16.0' },
  { region: 'ap-southeast-1', ip: '54.251.31.128' },
];

export const hcs = (a: Account) => (r53(a).healthChecks ??= {});

interface Probe {
  ok: boolean;
  report: string;
}

/** Lo que verían los comprobadores de Route 53 ahora mismo contra el destino de la comprobación. */
function probe(a: Account, hc: HealthCheck, from: string, depth = 0): Probe {
  const cfg = hc.HealthCheckConfig;
  const fail = (m: string): Probe => ({ ok: false, report: `Failure: ${m}` });
  if (cfg.Type === 'CALCULATED') {
    const kids = (cfg.ChildHealthChecks ?? []).map((id) => hcs(a)[id]).filter(Boolean);
    const good = kids.filter((k) => hcReported(a, k)).length;
    return good >= (cfg.HealthThreshold ?? kids.length) ? { ok: true, report: `Success: ${good} of ${kids.length} child health checks are healthy` } : fail(`${good} of ${kids.length} child health checks are healthy`);
  }
  if (cfg.Type === 'CLOUDWATCH_METRIC') {
    const al = cfg.AlarmIdentifier && a.regions[cfg.AlarmIdentifier.Region]?.alarms[cfg.AlarmIdentifier.Name];
    return !al || al.StateValue !== 'ALARM' ? { ok: true, report: 'Success: the CloudWatch alarm is not in ALARM' } : fail('the CloudWatch alarm is in ALARM');
  }
  const port = cfg.Port ?? (cfg.Type.startsWith('HTTPS') ? 443 : 80);
  const path = cfg.ResourcePath ?? '/';
  const str = cfg.Type.endsWith('_STR_MATCH');
  const http = cfg.Type !== 'TCP';
  const host = cfg.IPAddress ?? cfg.FullyQualifiedDomainName ?? '';
  const timeout = fail('Connection timed out. The endpoint or the Route 53 health checker might be unreachable');
  const judge = (status: number, body: string): Probe => {
    if (status >= 400) return fail(`HTTP Status Code ${status}. Resource not found`.replace('Resource not found', status === 404 ? 'Not Found' : status === 503 ? 'Service Unavailable' : 'Error'));
    return { ok: true, report: `Success: HTTP Status Code ${status}, ${status === 200 ? 'OK' : 'Found'}${str ? ` (string matched in ${body.length} bytes)` : ''}` };
  };
  if (depth > 3) return timeout;
  const lb = lbByDns(a, host);
  if (lb) {
    if (lbState(a, lb.lb) !== 'active' || !lbFromInternet(a, lb.region, lb.lb, port, from).ok) return timeout;
    if (!http) return { ok: true, report: 'Success: TCP connection successful' };
    const res = lbHandle(a, lb.region, lb.lb, { port, scheme: 'http', method: 'GET', host, path, query: '', srcIp: from });
    return res.ok && res.status ? judge(res.status, res.body ?? '') : timeout;
  }
  let ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : '';
  if (!ip) {
    const ans = r53Address(a, host);
    if (ans?.lb) return probe(a, { ...hc, HealthCheckConfig: { ...cfg, FullyQualifiedDomainName: ans.lb, IPAddress: undefined } }, from, depth + 1);
    ip = ans?.ip ?? '';
    const m = /^ec2-(\d+)-(\d+)-(\d+)-(\d+)\./.exec(host);
    if (!ip && m) ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  }
  if (!ip) return fail('DNS resolution failed: the name could not be resolved');
  for (const reg of Object.values(a.regions)) {
    for (const i of Object.values(reg.ec2.instances)) {
      if (i.PublicIpAddress !== ip) continue;
      if (!traceFromInternet(a, reg.ec2, i, 'tcp', port, from).reachable) return timeout;
      const page = port === 80 ? instancePage(i, path) : null;
      if (!page) return fail('Connection refused');
      return http ? judge(page.status, page.body) : { ok: true, report: 'Success: TCP connection successful' };
    }
  }
  return timeout;
}

/** Estado que Route 53 comunica: tarda en pasar a «malo» (intervalo × umbral de fallos) y en recuperarse. */
export function hcReported(a: Account, hc: HealthCheck): boolean {
  if (hc.HealthCheckConfig.Disabled) return true;
  const inv = !!hc.HealthCheckConfig.Inverted;
  const st = hc.state;
  const base = st ? st.reported : true;
  return inv ? !base : base;
}

function hcEvaluate(a: Account, hc: HealthCheck): void {
  const ok = CHECKERS.filter((c) => probe(a, hc, c.ip).ok).length >= 2;
  const interval = hc.HealthCheckConfig.RequestInterval * 1000;
  const st = hc.state ?? (hc.state = { probe: ok, reported: ok, since: a.clock, lastEval: a.clock });
  if (st.probe !== ok) {
    st.probe = ok;
    st.since = st.lastEval;
  }
  const need = ok ? interval : interval * hc.HealthCheckConfig.FailureThreshold;
  if (st.reported !== ok && a.clock - st.since >= need) st.reported = ok;
  st.lastEval = a.clock;
}

tickers.push((a) => {
  for (const hc of Object.values(hcs(a))) hcEvaluate(a, hc);
});

// ───────────────────────── resolución ─────────────────────────

export interface DnsAnswer {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

const S3_WEBSITE_DNS = /^([a-z0-9][a-z0-9.-]*)\.s3-website[.-]([a-z0-9-]+)\.amazonaws\.com\.?$/;

/** La zona pública más específica que contiene el nombre. */
export function zoneFor(a: Account, name: string): HostedZone | undefined {
  const n = dot(name);
  return Object.values(r53(a).zones)
    .filter((z) => !z.Private && (n === z.Name || n.endsWith('.' + z.Name)))
    .sort((x, y) => y.Name.length - x.Name.length)[0];
}

/** Resuelve un nombre de una zona alojada (sigue los CNAME y los alias). */
export function r53Lookup(a: Account, name: string, type: string, depth = 0, ctx: DnsCtx = {}): { answers: DnsAnswer[]; nxdomain: boolean } | null {
  const z = zoneFor(a, name);
  if (!z || depth > 8) return null;
  const n = dot(name);
  const here = z.records.filter((r) => r.Name === n);
  if (!here.length) return { answers: [], nxdomain: true };
  const exact = here.find((r) => r.Type === type);
  const answers: DnsAnswer[] = [];
  const push = (r: RecordSet) => {
    if (r.AliasTarget) {
      const t = dot(r.AliasTarget.DNSName);
      const s3 = S3_WEBSITE_DNS.exec(t);
      const lb = lbByDns(a, t);
      if (s3 && type === 'A') answers.push({ name: n, type: 'A', ttl: 60, data: `s3-website:${t}` });
      else if (lb && (type === 'A' || type === 'AAAA')) {
        if (type === 'A') for (const salt of ['a', 'b']) answers.push({ name: n, type: 'A', ttl: 60, data: `lb:${t.replace(/\.$/, '')}:${salt}` });
      } else if ((t.endsWith('.cloudfront.net.') || t.endsWith('.awsglobalaccelerator.com.')) && type === 'A') {
        answers.push({ name: n, type: 'A', ttl: 60, data: `edge:${t.replace(/\.$/, '')}` });
      } else {
        const inner = r53Lookup(a, t, type, depth + 1, ctx);
        if (inner) answers.push(...inner.answers.map((x) => ({ ...x, name: n, ttl: 60 })));
        else if (type === 'A') answers.push({ name: n, type: 'A', ttl: 60, data: `alias:${t}` });
      }
    } else for (const v of r.ResourceRecords ?? []) answers.push({ name: n, type: r.Type, ttl: r.TTL ?? 300, data: r.Type === 'CNAME' ? dot(v.Value) : v.Value });
  };
  if (exact) {
    const same = here.filter((r) => r.Type === type);
    for (const pick of chooseRecords(a, same, ctx)) push(pick);
    return { answers, nxdomain: false };
  }
  const cname = here.find((r) => r.Type === 'CNAME');
  if (cname && type !== 'CNAME') {
    const target = cname.ResourceRecords?.[0]?.Value ?? '';
    answers.push({ name: n, type: 'CNAME', ttl: cname.TTL ?? 300, data: dot(target) });
    const inner = r53Lookup(a, target, type, depth + 1, ctx);
    if (inner) answers.push(...inner.answers);
    return { answers, nxdomain: false };
  }
  const alias = here.find((r) => r.AliasTarget && (type === 'A' || type === 'AAAA') && r.Type === type);
  if (alias) push(alias);
  return { answers, nxdomain: false };
}

/** Una IPv4 para el nombre (para `curl`): sigue CNAME y alias; devuelve también a qué tipo de destino apunta. */
export function r53Address(a: Account, name: string): { ip?: string; s3Website?: string; lb?: string; edge?: string } | null {
  const r = r53Lookup(a, name, 'A');
  if (!r) return null;
  for (const x of r.answers) {
    if (x.type !== 'A') continue;
    if (x.data.startsWith('s3-website:')) return { s3Website: x.data.slice('s3-website:'.length) };
    if (x.data.startsWith('lb:')) return { lb: x.data.split(':')[1] };
    if (x.data.startsWith('edge:')) return { edge: x.data.slice(5) };
    if (/^\d+\.\d+\.\d+\.\d+$/.test(x.data)) return { ip: x.data };
  }
  return null;
}

// ───────────────────────── operaciones ─────────────────────────

const zoneArn = (id: string) => `arn:aws:route53:::hostedzone/${id}`;

function getZone(a: Account, id: string): HostedZone {
  const z = r53(a).zones[zoneId(id)];
  if (!z) throw new AwsError('NoSuchHostedZone', `No hosted zone found with ID: ${zoneId(id)}`, 404);
  return z;
}

const zoneView = (z: HostedZone) => ({ Id: `/hostedzone/${z.Id}`, Name: z.Name, CallerReference: z.CallerReference, Config: { ...(z.Comment ? { Comment: z.Comment } : {}), PrivateZone: z.Private }, ResourceRecordSetCount: z.records.length });
const changeInfo = (a: Account, seed: string) => ({ Id: `/change/${stableId('chg:' + seed, 'C', 13, 'up')}`, Status: 'PENDING', SubmittedAt: iso(a.clock) });

op('route53', 'create-hosted-zone', 'name:s! caller-reference:s! hosted-zone-config:j vpc:j', 'Crea una zona alojada (el «directorio» de los registros DNS de un dominio).', { global: true, res: () => 'arn:aws:route53:::hostedzone/*' }, (c) => {
  const name = dot(c.p.Name as string);
  if (!/^([a-z0-9_-]+\.)+[a-z]{2,}\.$/.test(name)) throw new AwsError('InvalidDomainName', `${undot(name)} is not a valid DNS domain name`);
  if (Object.values(r53(c.acct).zones).some((z) => z.CallerReference === c.p.CallerReference)) throw new AwsError('HostedZoneAlreadyExists', 'A hosted zone has already been created with the specified caller reference.', 409);
  const priv = c.p.HostedZoneConfig?.PrivateZone === true || c.p.HostedZoneConfig?.PrivateZone === 'true';
  if (priv && !c.p.Vpc) throw new AwsError('InvalidInput', 'When creating private hosted zone, either VPCId or VPCRegion is required.');
  const z = r53CreateZone(c.acct, name, { comment: c.p.HostedZoneConfig?.Comment, private: priv });
  z.CallerReference = c.p.CallerReference;
  const { Id: _id, ...rest } = zoneView(z);
  void _id;
  return { Location: `https://route53.amazonaws.com/2013-04-01/hostedzone/${z.Id}`, HostedZone: { Id: `/hostedzone/${z.Id}`, ...rest }, ChangeInfo: changeInfo(c.acct, z.Id), DelegationSet: { NameServers: nameServers(z).map(undot) } };
});

op('route53', 'list-hosted-zones', 'max-items:i', 'Lista las zonas alojadas de la cuenta.', { global: true, paginate: 'HostedZones', res: () => '*' }, (c) => ({ HostedZones: Object.values(r53(c.acct).zones).map(zoneView) }));

op('route53', 'list-hosted-zones-by-name', 'dns-name:s hosted-zone-id:s max-items:i', 'Lista las zonas ordenadas por nombre, empezando por `--dns-name` (sirve para encontrar el id de una zona por su nombre).', { global: true, paginate: 'HostedZones', res: () => '*' }, (c) => {
  const from = c.p.DnsName ? dot(c.p.DnsName as string) : '';
  const key = (n: string) => n.split('.').filter(Boolean).reverse().join('.');
  const zones = Object.values(r53(c.acct).zones)
    .filter((z) => !from || key(z.Name) >= key(from))
    .sort((x, y) => (key(x.Name) < key(y.Name) ? -1 : 1));
  return { HostedZones: zones.map(zoneView), ...(from ? { DNSName: from } : {}), IsTruncated: false, MaxItems: '100' };
});

op('route53', 'get-hosted-zone', 'id:s!', 'Datos de una zona y sus servidores de nombres.', { global: true, res: (c) => zoneArn(zoneId(c.p.Id)) }, (c) => {
  const z = getZone(c.acct, c.p.Id);
  return { HostedZone: zoneView(z), DelegationSet: { NameServers: nameServers(z).map(undot) } };
});

op('route53', 'delete-hosted-zone', 'id:s!', 'Borra una zona (solo debe quedar con sus registros NS y SOA).', { global: true, res: (c) => zoneArn(zoneId(c.p.Id)) }, (c) => {
  const z = getZone(c.acct, c.p.Id);
  if (z.records.some((r) => !(r.Name === z.Name && (r.Type === 'NS' || r.Type === 'SOA')))) throw new AwsError('HostedZoneNotEmpty', 'The specified hosted zone contains non-required resource record sets and so cannot be deleted.', 400);
  delete r53(c.acct).zones[z.Id];
  return { ChangeInfo: changeInfo(c.acct, z.Id + 'del') };
});

op('route53', 'list-resource-record-sets', 'hosted-zone-id:s! max-items:i', 'Lista los registros de una zona.', { global: true, paginate: 'ResourceRecordSets', action: 'route53:ListResourceRecordSets', res: (c) => zoneArn(zoneId(c.p.HostedZoneId)) }, (c) => {
  const z = getZone(c.acct, c.p.HostedZoneId);
  return { ResourceRecordSets: z.records.map((r) => ({ ...r })) };
});

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SPF', 'SRV', 'TXT', 'CAA'];
const rrId = (r: RecordSet) => `[name='${r.Name}', type='${r.Type}'${r.SetIdentifier ? `, set-identifier='${r.SetIdentifier}'` : ''}]`;
const sameRr = (x: RecordSet, y: RecordSet) => x.Name === y.Name && x.Type === y.Type && (x.SetIdentifier ?? '') === (y.SetIdentifier ?? '');

op('route53', 'change-resource-record-sets', 'hosted-zone-id:s! change-batch:j!', 'Crea, cambia (UPSERT) o borra registros DNS en una zona.', { global: true, res: (c) => zoneArn(zoneId(c.p.HostedZoneId)) }, (c) => {
  const z = getZone(c.acct, c.p.HostedZoneId);
  const changes = c.p.ChangeBatch?.Changes;
  if (!Array.isArray(changes) || !changes.length) throw new AwsError('InvalidInput', 'Invalid XML ; cvc-complex-type.2.4.b: The content of element \'Changes\' is not complete.', 400);
  const next = z.records.map((r) => ({ ...r }));
  for (const ch of changes) {
    const action = String(ch.Action);
    const rs = ch.ResourceRecordSet as Record<string, unknown> | undefined;
    if (!['CREATE', 'DELETE', 'UPSERT'].includes(action) || !isObj(rs)) throw new AwsError('InvalidInput', `Invalid change: Action must be CREATE, DELETE or UPSERT`, 400);
    const name = dot(String(rs.Name ?? ''));
    const type = String(rs.Type ?? '');
    if (!TYPES.includes(type)) throw new AwsError('InvalidInput', `Invalid XML ; cvc-enumeration-valid: Value '${type}' is not facet-valid with respect to enumeration ${JSON.stringify(TYPES)}`, 400);
    if (!(name === z.Name || name.endsWith('.' + z.Name))) throw new AwsError('InvalidChangeBatch', `[RRSet with DNS name ${undot(name)} is not permitted in zone ${undot(z.Name)}.]`, 400);
    const alias = rs.AliasTarget as RecordSet['AliasTarget'] | undefined;
    const values = (rs.ResourceRecords as { Value: string }[] | undefined) ?? [];
    const rec: RecordSet = { Name: name, Type: type, ...(rs.TTL !== undefined ? { TTL: Number(rs.TTL) } : {}), ...(alias ? { AliasTarget: { HostedZoneId: alias.HostedZoneId, DNSName: alias.DNSName, EvaluateTargetHealth: !!alias.EvaluateTargetHealth } } : { ResourceRecords: values }), ...(rs.SetIdentifier ? { SetIdentifier: String(rs.SetIdentifier) } : {}), ...(rs.Weight !== undefined ? { Weight: Number(rs.Weight) } : {}), ...(rs.Region ? { Region: String(rs.Region) } : {}), ...(rs.Failover ? { Failover: rs.Failover as 'PRIMARY' | 'SECONDARY' } : {}), ...(rs.HealthCheckId ? { HealthCheckId: String(rs.HealthCheckId) } : {}), ...(isObj(rs.GeoLocation) ? { GeoLocation: rs.GeoLocation as RecordSet['GeoLocation'] } : {}), ...(rs.MultiValueAnswer !== undefined ? { MultiValueAnswer: rs.MultiValueAnswer === true || rs.MultiValueAnswer === 'true' } : {}) };
    if (action !== 'DELETE') {
      const policy = rec.Weight !== undefined || rec.Region || rec.Failover || rec.GeoLocation || rec.MultiValueAnswer;
      if (policy && !rec.SetIdentifier) throw new AwsError('InvalidChangeBatch', `[Invalid request: Missing field 'SetIdentifier' in Change with [Action=${action}, Name=${undot(name)}, Type=${type}, SetIdentifier=null]]`, 400);
      if (rec.SetIdentifier && !policy) throw new AwsError('InvalidChangeBatch', `[Invalid request: Expected exactly one of [Weight, Region, Failover, GeoLocation, MultiValueAnswer...] for a record with SetIdentifier in Change with [Action=${action}, Name=${undot(name)}, Type=${type}, SetIdentifier=${rec.SetIdentifier}]]`, 400);
      if (rec.Weight !== undefined && (rec.Weight < 0 || rec.Weight > 255)) throw new AwsError('InvalidInput', `Invalid XML ; cvc-minInclusive-valid: Value '${rec.Weight}' is not facet-valid with respect to minInclusive '0' for type 'ResourceRecordSetWeight'`, 400);
      if (rec.Region && !(rec.Region in REGION_POS) && !/^[a-z]{2}-[a-z]+-\d$/.test(rec.Region)) throw new AwsError('InvalidInput', `Invalid XML ; cvc-enumeration-valid: Value '${rec.Region}' is not facet-valid with respect to enumeration for type 'ResourceRecordSetRegion'`, 400);
      if (rec.HealthCheckId && !hcs(c.acct)[rec.HealthCheckId]) throw new AwsError('NoSuchHealthCheck', `No health check exists with the ID: ${rec.HealthCheckId}`, 404);
      const kind = (r: RecordSet) => (r.Failover ? 'failover' : r.Region ? 'latency' : r.GeoLocation ? 'geo' : r.Weight !== undefined ? 'weighted' : r.MultiValueAnswer ? 'multivalue' : '');
      const other = next.find((r) => r.Name === name && r.Type === type && !sameRr(r, rec) && kind(r) !== kind(rec));
      if (other) throw new AwsError('InvalidChangeBatch', `[Tried to create resource record set ${rrId(rec)} but a record with the same name and type uses a different routing policy (${kind(other) || 'simple'})]`, 400);
      if (alias && values.length) throw new AwsError('InvalidChangeBatch', `[Alias resource record sets cannot have values (ResourceRecords) ${rrId(rec)}]`, 400);
      if (!alias && !values.length) throw new AwsError('InvalidChangeBatch', `[Invalid Resource Record: FATAL problem: ARRDATAIllegalIPv4Address (Value is not a valid IPv4 address) encountered with ''] `.trim(), 400);
      if (!alias && rec.TTL === undefined) throw new AwsError('InvalidChangeBatch', `[Invalid request: Expected exactly one of [AliasTarget, all of [TTL, and ResourceRecords], or TrafficPolicyInstanceId], but found none in Change with [Action=${action}, Name=${undot(name)}, Type=${type}, SetIdentifier=${rec.SetIdentifier ?? 'null'}]]`, 400);
      if (type === 'A') for (const v of values) if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v.Value) || v.Value.split('.').some((x) => Number(x) > 255)) throw new AwsError('InvalidChangeBatch', `[Invalid Resource Record: FATAL problem: ARRDATAIllegalIPv4Address (Value is not a valid IPv4 address) encountered with '${v.Value}']`, 400);
      if (type === 'CNAME' && name === z.Name) throw new AwsError('InvalidChangeBatch', `[Tried to create a CNAME at the zone apex ${undot(name)}; use an alias record instead]`, 400);
      if (type === 'CNAME' && next.some((r) => r.Name === name && r.Type !== 'CNAME' && !sameRr(r, rec))) throw new AwsError('InvalidChangeBatch', `[RRSet of type CNAME with DNS name ${undot(name)} is not permitted as it conflicts with other records with the same DNS name in zone ${undot(z.Name)}]`, 400);
      if (type !== 'CNAME' && next.some((r) => r.Name === name && r.Type === 'CNAME')) throw new AwsError('InvalidChangeBatch', `[RRSet of type ${type} with DNS name ${undot(name)} is not permitted as it conflicts with other records with the same DNS name in zone ${undot(z.Name)}]`, 400);
    }
    const i = next.findIndex((r) => sameRr(r, rec));
    if (action === 'CREATE') {
      if (i >= 0) throw new AwsError('InvalidChangeBatch', `[Tried to create resource record set ${rrId(rec)} but it already exists]`, 400);
      next.push(rec);
    } else if (action === 'UPSERT') {
      if (i >= 0) next[i] = rec;
      else next.push(rec);
    } else {
      if (i < 0) throw new AwsError('InvalidChangeBatch', `[Tried to delete resource record set ${rrId(rec)} but it was not found]`, 400);
      if (z.records[i].Type === 'NS' || z.records[i].Type === 'SOA') if (next[i].Name === z.Name) throw new AwsError('InvalidChangeBatch', `[Tried to delete resource record set ${rrId(rec)} but it is required]`, 400);
      next.splice(i, 1);
    }
  }
  z.records = next;
  return { ChangeInfo: { ...changeInfo(c.acct, z.Id + c.acct.clock + JSON.stringify(changes).length), ...(c.p.ChangeBatch.Comment ? { Comment: c.p.ChangeBatch.Comment } : {}) } };
});

op('route53', 'get-change', 'id:s!', 'Estado de un cambio de DNS (PENDING o INSYNC).', { global: true, res: () => 'arn:aws:route53:::change/*' }, (c) => ({ ChangeInfo: { Id: `/change/${String(c.p.Id).replace(/^\/change\//, '')}`, Status: 'INSYNC', SubmittedAt: iso(c.acct.clock - 60000) } }));

op('route53', 'test-dns-answer', 'hosted-zone-id:s! record-name:s! record-type:s! resolver-ip:s edns0-client-subnet-ip:s', 'Pregunta a los servidores de la zona qué contestarían a un nombre.', { global: true, res: (c) => zoneArn(zoneId(c.p.HostedZoneId)) }, (c) => {
  const z = getZone(c.acct, c.p.HostedZoneId);
  const type = String(c.p.RecordType);
  const res = r53Lookup(c.acct, c.p.RecordName, type, 0, { clientIp: c.p.Edns0ClientSubnetIp });
  return { Nameserver: undot(nameServers(z)[0]), RecordName: undot(dot(c.p.RecordName)), RecordType: type, RecordData: (res?.answers ?? []).filter((x) => x.type === type || (x.type === 'CNAME' && type !== 'CNAME')).map((x) => (x.data.startsWith('s3-website:') ? x.data.slice(11) : x.type === 'CNAME' ? undot(x.data) : x.data)), ResponseCode: res?.nxdomain || !res ? 'NXDOMAIN' : 'NOERROR', Protocol: 'UDP' };
});

// ───────────────────────── operaciones: comprobaciones de salud ─────────────────────────

const HC_TYPES = ['HTTP', 'HTTPS', 'HTTP_STR_MATCH', 'HTTPS_STR_MATCH', 'TCP', 'CALCULATED', 'CLOUDWATCH_METRIC'];
const hcArn = (id: string) => `arn:aws:route53:::healthcheck/${id}`;

const hcView = (hc: HealthCheck) => ({ Id: hc.Id, CallerReference: hc.CallerReference, HealthCheckConfig: { ...(hc.HealthCheckConfig.IPAddress ? { IPAddress: hc.HealthCheckConfig.IPAddress } : {}), ...(hc.HealthCheckConfig.Port !== undefined ? { Port: hc.HealthCheckConfig.Port } : {}), Type: hc.HealthCheckConfig.Type, ...(hc.HealthCheckConfig.ResourcePath ? { ResourcePath: hc.HealthCheckConfig.ResourcePath } : {}), ...(hc.HealthCheckConfig.FullyQualifiedDomainName ? { FullyQualifiedDomainName: hc.HealthCheckConfig.FullyQualifiedDomainName } : {}), RequestInterval: hc.HealthCheckConfig.RequestInterval, FailureThreshold: hc.HealthCheckConfig.FailureThreshold, MeasureLatency: false, Inverted: !!hc.HealthCheckConfig.Inverted, Disabled: !!hc.HealthCheckConfig.Disabled, EnableSNI: !!hc.HealthCheckConfig.EnableSNI, ...(hc.HealthCheckConfig.ChildHealthChecks ? { ChildHealthChecks: hc.HealthCheckConfig.ChildHealthChecks, HealthThreshold: hc.HealthCheckConfig.HealthThreshold } : {}) }, HealthCheckVersion: hc.HealthCheckVersion });

op('route53', 'create-health-check', 'caller-reference:s! health-check-config:j!', 'Crea una comprobación de salud: Route 53 prueba un destino cada 10 o 30 segundos y avisa de si responde.', { global: true, res: () => 'arn:aws:route53:::healthcheck/*' }, (c) => {
  const cfg = c.p.HealthCheckConfig as Record<string, any>;
  const type = String(cfg.Type ?? '');
  if (!HC_TYPES.includes(type)) throw new AwsError('InvalidInput', `Invalid XML ; cvc-enumeration-valid: Value '${type}' is not facet-valid with respect to enumeration [HTTP, HTTPS, HTTP_STR_MATCH, HTTPS_STR_MATCH, TCP, CALCULATED, CLOUDWATCH_METRIC]`, 400);
  if (Object.values(hcs(c.acct)).some((h) => h.CallerReference === c.p.CallerReference)) throw new AwsError('HealthCheckAlreadyExists', 'A health check with the same caller reference already exists.', 409);
  if (['HTTP', 'HTTPS', 'HTTP_STR_MATCH', 'HTTPS_STR_MATCH', 'TCP'].includes(type) && !cfg.IPAddress && !cfg.FullyQualifiedDomainName) throw new AwsError('InvalidInput', 'Either IPAddress or FullyQualifiedDomainName must be specified.', 400);
  if (cfg.IPAddress && !/^\d{1,3}(\.\d{1,3}){3}$/.test(String(cfg.IPAddress))) throw new AwsError('InvalidInput', `Invalid XML ; cvc-pattern-valid: Value '${cfg.IPAddress}' is not facet-valid with respect to pattern for type 'IPAddress'`, 400);
  if (type === 'CALCULATED') for (const id of cfg.ChildHealthChecks ?? []) if (!hcs(c.acct)[id]) throw new AwsError('NoSuchHealthCheck', `No health check exists with the ID: ${id}`, 404);
  const interval = Number(cfg.RequestInterval ?? 30);
  if (![10, 30].includes(interval)) throw new AwsError('InvalidInput', `Invalid XML ; cvc-enumeration-valid: Value '${interval}' is not facet-valid with respect to RequestInterval (10 or 30)`, 400);
  const id = newId(c.acct, 'r53hc', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const hc: HealthCheck = {
    Id: id,
    CallerReference: c.p.CallerReference,
    HealthCheckConfig: { Type: type, IPAddress: cfg.IPAddress, FullyQualifiedDomainName: cfg.FullyQualifiedDomainName, Port: cfg.Port !== undefined ? Number(cfg.Port) : type === 'CALCULATED' || type === 'CLOUDWATCH_METRIC' ? undefined : type.startsWith('HTTPS') ? 443 : type === 'TCP' ? 80 : 80, ResourcePath: cfg.ResourcePath ?? (type.startsWith('HTTP') ? '/' : undefined), RequestInterval: interval, FailureThreshold: Number(cfg.FailureThreshold ?? 3), Inverted: cfg.Inverted === true || cfg.Inverted === 'true', Disabled: cfg.Disabled === true || cfg.Disabled === 'true', ChildHealthChecks: cfg.ChildHealthChecks, HealthThreshold: cfg.HealthThreshold !== undefined ? Number(cfg.HealthThreshold) : undefined, AlarmIdentifier: cfg.AlarmIdentifier },
    HealthCheckVersion: 1,
    Tags: [],
  };
  hcs(c.acct)[id] = hc;
  hcEvaluate(c.acct, hc);
  return { Location: `https://route53.amazonaws.com/2013-04-01/healthcheck/${id}`, HealthCheck: hcView(hc) };
});

op('route53', 'list-health-checks', 'max-items:i', 'Lista las comprobaciones de salud.', { global: true, paginate: 'HealthChecks', res: () => '*' }, (c) => ({ HealthChecks: Object.values(hcs(c.acct)).map(hcView), Marker: '', IsTruncated: false, MaxItems: '100' }));

const getHc = (a: Account, id: string): HealthCheck => {
  const hc = hcs(a)[id];
  if (!hc) throw new AwsError('NoSuchHealthCheck', `No health check exists with the ID: ${id}`, 404);
  return hc;
};

op('route53', 'get-health-check', 'health-check-id:s!', 'Configuración de una comprobación de salud.', { global: true, res: (c) => hcArn(c.p.HealthCheckId) }, (c) => ({ HealthCheck: hcView(getHc(c.acct, c.p.HealthCheckId)) }));

op('route53', 'get-health-check-status', 'health-check-id:s!', 'Lo que han visto los comprobadores de Route 53 en cada región.', { global: true, res: (c) => hcArn(c.p.HealthCheckId) }, (c) => {
  const hc = getHc(c.acct, c.p.HealthCheckId);
  return { HealthCheckObservations: CHECKERS.map((ch) => ({ Region: ch.region, IPAddress: ch.ip, StatusReport: { Status: probe(c.acct, hc, ch.ip).report, CheckedTime: iso(c.acct.clock - 7000) } })) };
});

op('route53', 'update-health-check', 'health-check-id:s! ip-address:s port:i resource-path:s fully-qualified-domain-name:s failure-threshold:i inverted:b disabled:b', 'Cambia una comprobación de salud.', { global: true, res: (c) => hcArn(c.p.HealthCheckId) }, (c) => {
  const hc = getHc(c.acct, c.p.HealthCheckId);
  const cfg = hc.HealthCheckConfig;
  if (c.p.IpAddress) cfg.IPAddress = c.p.IpAddress;
  if (c.p.Port !== undefined) cfg.Port = c.p.Port;
  if (c.p.ResourcePath) cfg.ResourcePath = c.p.ResourcePath;
  if (c.p.FullyQualifiedDomainName) cfg.FullyQualifiedDomainName = c.p.FullyQualifiedDomainName;
  if (c.p.FailureThreshold !== undefined) cfg.FailureThreshold = c.p.FailureThreshold;
  if (c.p.Inverted !== undefined) cfg.Inverted = c.p.Inverted;
  if (c.p.Disabled !== undefined) cfg.Disabled = c.p.Disabled;
  hc.HealthCheckVersion++;
  return { HealthCheck: hcView(hc) };
});

op('route53', 'delete-health-check', 'health-check-id:s!', 'Borra una comprobación de salud (no puede estar asociada a un registro).', { global: true, res: (c) => hcArn(c.p.HealthCheckId) }, (c) => {
  const hc = getHc(c.acct, c.p.HealthCheckId);
  for (const z of Object.values(r53(c.acct).zones)) if (z.records.some((r) => r.HealthCheckId === hc.Id)) throw new AwsError('HealthCheckInUse', 'This health check is still associated with a resource record set.', 400);
  delete hcs(c.acct)[hc.Id];
  return {};
});
