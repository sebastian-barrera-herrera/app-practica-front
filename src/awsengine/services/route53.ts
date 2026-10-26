/** Amazon Route 53: zonas alojadas y registros DNS (y la resolución de nombres desde la terminal). */
import { AwsError, op } from '../registry';
import type { Account, HostedZone, RecordSet } from '../types';
import { isObj, iso, newId, stableId, toArr } from '../util';

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
export function r53Lookup(a: Account, name: string, type: string, depth = 0): { answers: DnsAnswer[]; nxdomain: boolean } | null {
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
      if (s3 && type === 'A') answers.push({ name: n, type: 'A', ttl: 60, data: `s3-website:${t}` });
      else {
        const inner = r53Lookup(a, t, type, depth + 1);
        if (inner) answers.push(...inner.answers.map((x) => ({ ...x, name: n, ttl: 60 })));
        else if (type === 'A') answers.push({ name: n, type: 'A', ttl: 60, data: `alias:${t}` });
      }
    } else for (const v of r.ResourceRecords ?? []) answers.push({ name: n, type: r.Type, ttl: r.TTL ?? 300, data: r.Type === 'CNAME' ? dot(v.Value) : v.Value });
  };
  if (exact) {
    // con política ponderada o de failover se elige uno (determinista: el de más peso / el primario)
    const same = here.filter((r) => r.Type === type);
    const pick = same.length > 1 ? [...same].sort((x, y) => (y.Weight ?? 0) - (x.Weight ?? 0) || (x.Failover === 'PRIMARY' ? -1 : 1))[0] : exact;
    push(pick);
    return { answers, nxdomain: false };
  }
  const cname = here.find((r) => r.Type === 'CNAME');
  if (cname && type !== 'CNAME') {
    const target = cname.ResourceRecords?.[0]?.Value ?? '';
    answers.push({ name: n, type: 'CNAME', ttl: cname.TTL ?? 300, data: dot(target) });
    const inner = r53Lookup(a, target, type, depth + 1);
    if (inner) answers.push(...inner.answers);
    return { answers, nxdomain: false };
  }
  const alias = here.find((r) => r.AliasTarget && (type === 'A' || type === 'AAAA') && r.Type === type);
  if (alias) push(alias);
  return { answers, nxdomain: false };
}

/** Una IPv4 para el nombre (para `curl`): sigue CNAME y alias; devuelve también a qué tipo de destino apunta. */
export function r53Address(a: Account, name: string): { ip?: string; s3Website?: string } | null {
  const r = r53Lookup(a, name, 'A');
  if (!r) return null;
  for (const x of r.answers) {
    if (x.type !== 'A') continue;
    if (x.data.startsWith('s3-website:')) return { s3Website: x.data.slice('s3-website:'.length) };
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
    const rec: RecordSet = { Name: name, Type: type, ...(rs.TTL !== undefined ? { TTL: Number(rs.TTL) } : {}), ...(alias ? { AliasTarget: { HostedZoneId: alias.HostedZoneId, DNSName: alias.DNSName, EvaluateTargetHealth: !!alias.EvaluateTargetHealth } } : { ResourceRecords: values }), ...(rs.SetIdentifier ? { SetIdentifier: String(rs.SetIdentifier) } : {}), ...(rs.Weight !== undefined ? { Weight: Number(rs.Weight) } : {}), ...(rs.Region ? { Region: String(rs.Region) } : {}), ...(rs.Failover ? { Failover: rs.Failover as 'PRIMARY' | 'SECONDARY' } : {}), ...(rs.HealthCheckId ? { HealthCheckId: String(rs.HealthCheckId) } : {}) };
    if (action !== 'DELETE') {
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
  const res = r53Lookup(c.acct, c.p.RecordName, type);
  return { Nameserver: undot(nameServers(z)[0]), RecordName: undot(dot(c.p.RecordName)), RecordType: type, RecordData: (res?.answers ?? []).filter((x) => x.type === type || (x.type === 'CNAME' && type !== 'CNAME')).map((x) => (x.data.startsWith('s3-website:') ? x.data.slice(11) : x.type === 'CNAME' ? undot(x.data) : x.data)), ResponseCode: res?.nxdomain || !res ? 'NXDOMAIN' : 'NOERROR', Protocol: 'UDP' };
});
