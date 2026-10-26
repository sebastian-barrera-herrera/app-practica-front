/**
 * Precios ILUSTRATIVOS (USD, región us-east-1, cifras redondeadas) para estimar costes en el simulador.
 * No son los precios oficiales: cambian con frecuencia y por región. Sirven para razonar (qué pesa más en la factura).
 */
import { regional } from './account';
import { instanceType } from './catalog';
import { DB_CLASSES } from './services/rds';
import type { Account, Tag } from './types';

export const HOURS_MONTH = 730;

export const PRICE = {
  ebsGbMonth: { gp3: 0.08, gp2: 0.1, io1: 0.125, io2: 0.125, st1: 0.045, sc1: 0.015, standard: 0.05 } as Record<string, number>,
  snapshotGbMonth: 0.05,
  publicIpv4Hour: 0.005,
  natHour: 0.045,
  natGb: 0.045,
  /** GB al mes que se supone que procesa un NAT cuando no hay datos reales. */
  natGbAssumed: 100,
  spotFactor: 0.35,
  rdsStorageGbMonth: 0.115,
  rdsSnapshotGbMonth: 0.095,
  dynamoRcuHour: 0.00013,
  dynamoWcuHour: 0.00065,
  dynamoGbMonth: 0.25,
  route53ZoneMonth: 0.5,
  alarmMonth: 0.1,
  dataTransferOutGb: 0.09,
  s3GbMonth: { STANDARD: 0.023, INTELLIGENT_TIERING: 0.023, STANDARD_IA: 0.0125, ONEZONE_IA: 0.01, GLACIER_IR: 0.004, GLACIER: 0.0036, DEEP_ARCHIVE: 0.00099 } as Record<string, number>,
};

export interface BurnItem {
  service: string;
  usageType: string;
  /** Recurso que lo genera (id o nombre). */
  resource: string;
  /** USD al mes. */
  monthly: number;
  region: string;
  tags: Record<string, string>;
  /** Frase que explica el coste. */
  note: string;
}

const tagMap = (t: Tag[] | undefined): Record<string, string> => Object.fromEntries((t ?? []).map((x) => [x.Key, x.Value]));
const nameOf = (t: Tag[] | undefined, id: string) => (t ?? []).find((x) => x.Key === 'Name')?.Value ?? id;

export const SERVICE = {
  ec2: 'Amazon Elastic Compute Cloud - Compute',
  ec2Other: 'EC2 - Other',
  vpc: 'Amazon Virtual Private Cloud',
  rds: 'Amazon Relational Database Service',
  s3: 'Amazon Simple Storage Service',
  dynamo: 'Amazon DynamoDB',
  r53: 'Amazon Route 53',
  cw: 'AmazonCloudWatch',
};

/** Lo que cuestan al mes los recursos que existen ahora mismo en la cuenta. */
export function monthlyBurn(a: Account): BurnItem[] {
  const out: BurnItem[] = [];
  const add = (service: string, usageType: string, resource: string, monthly: number, region: string, tags: Record<string, string>, note: string) => {
    if (monthly > 0) out.push({ service, usageType, resource, monthly: Math.round(monthly * 100) / 100, region, tags, note });
  };
  for (const [region, rs] of Object.entries(a.regions)) {
    const e = rs.ec2;
    for (const i of Object.values(e.instances)) {
      const t = tagMap(i.Tags);
      const n = nameOf(i.Tags, i.InstanceId);
      if (i.state === 'running' || i.state === 'pending' || i.state === 'stopping') {
        const hr = (instanceType(i.InstanceType)?.price ?? 0.05) * (i.market === 'spot' ? PRICE.spotFactor : 1);
        add(SERVICE.ec2, `BoxUsage:${i.InstanceType}`, n, hr * HOURS_MONTH, region, t, `${i.InstanceType} encendida las 24 h: ${(hr * HOURS_MONTH).toFixed(2)} $/mes`);
        if (i.PublicIpAddress) add(SERVICE.vpc, 'PublicIPv4:InUseAddress', n, PRICE.publicIpv4Hour * HOURS_MONTH, region, t, 'Desde 2024 toda IPv4 pública se cobra por hora');
      }
    }
    for (const v of Object.values(e.volumes)) {
      const price = PRICE.ebsGbMonth[v.VolumeType] ?? 0.08;
      add(SERVICE.ec2Other, `EBS:VolumeUsage.${v.VolumeType}`, nameOf(v.Tags, v.VolumeId), v.Size * price, region, tagMap(v.Tags), `${v.Size} GB de ${v.VolumeType}${v.state === 'available' ? ' SIN conectar (se paga igual)' : ''}`);
    }
    for (const s of Object.values(e.snapshots)) add(SERVICE.ec2Other, 'EBS:SnapshotUsage', nameOf(s.Tags, s.SnapshotId), s.VolumeSize * PRICE.snapshotGbMonth, region, tagMap(s.Tags), `${s.VolumeSize} GB de snapshot`);
    for (const ad of Object.values(e.addresses)) {
      if (!ad.InstanceId && !ad.AssociationId) add(SERVICE.vpc, 'PublicIPv4:IdleAddress', nameOf(ad.Tags, ad.AllocationId), PRICE.publicIpv4Hour * HOURS_MONTH, region, tagMap(ad.Tags), 'IP elástica sin usar');
    }
    for (const n of Object.values(e.natGateways)) {
      if (n.state === 'deleted' || n.state === 'deleting') continue;
      add(SERVICE.ec2Other, 'NatGateway-Hours', nameOf(n.Tags, n.NatGatewayId), PRICE.natHour * HOURS_MONTH, region, tagMap(n.Tags), 'Cada NAT gateway cobra por hora, haga o no tráfico');
      add(SERVICE.ec2Other, 'NatGateway-Bytes', nameOf(n.Tags, n.NatGatewayId), PRICE.natGbAssumed * PRICE.natGb, region, tagMap(n.Tags), `Procesamiento de datos (supuesto ${PRICE.natGbAssumed} GB/mes)`);
    }
    for (const t of Object.values(rs.ddb ?? {})) {
      if (t.deleting !== undefined) continue;
      const tags = tagMap(t.Tags);
      if (t.BillingMode === 'PROVISIONED' && t.ProvisionedThroughput) add(SERVICE.dynamo, 'ReadCapacityUnit-Hrs', t.TableName, (t.ProvisionedThroughput.ReadCapacityUnits * PRICE.dynamoRcuHour + t.ProvisionedThroughput.WriteCapacityUnits * PRICE.dynamoWcuHour) * HOURS_MONTH, region, tags, 'Capacidad aprovisionada (se paga aunque no se use)');
      const bytes = Object.values(t.items).reduce((n, it) => n + JSON.stringify(it).length, 0);
      add(SERVICE.dynamo, 'TimedStorage-ByteHrs', t.TableName, (bytes / 1e9) * PRICE.dynamoGbMonth, region, tags, 'Almacenamiento');
    }
    const rds = rs.rds;
    for (const i of Object.values(rds?.instances ?? {})) {
      if (i.status === 'deleting') continue;
      const cls = DB_CLASSES[i.DBInstanceClass];
      const factor = i.MultiAZ ? 2 : 1;
      const tags = tagMap(i.Tags);
      if (i.status !== 'stopped') add(SERVICE.rds, `InstanceUsage:${i.DBInstanceClass}${i.MultiAZ ? ':Multi-AZ' : ''}`, i.DBInstanceIdentifier, (cls?.price ?? 0.1) * HOURS_MONTH * factor, region, tags, `${i.DBInstanceClass}${i.MultiAZ ? ' en Multi-AZ (doble)' : ''}`);
      if (!i.DBClusterIdentifier) add(SERVICE.rds, 'RDS:GP3-Storage', i.DBInstanceIdentifier, i.AllocatedStorage * PRICE.rdsStorageGbMonth * factor, region, tags, `${i.AllocatedStorage} GB de disco`);
    }
    for (const s of Object.values(rds?.snapshots ?? {})) if (s.SnapshotType === 'manual') add(SERVICE.rds, 'RDS:ChargedBackupUsage', s.DBSnapshotIdentifier, s.AllocatedStorage * PRICE.rdsSnapshotGbMonth, region, tagMap(s.Tags), `Copia manual de ${s.AllocatedStorage} GB`);
    for (const al of Object.values(rs.alarms)) add(SERVICE.cw, 'AlarmMonitorUsage', al.AlarmName, PRICE.alarmMonth, region, {}, 'Alarma estándar');
  }
  for (const b of Object.values(a.s3.buckets)) {
    const by: Record<string, number> = {};
    for (const versions of Object.values(b.objects)) for (const v of versions) if (!v.deleteMarker) by[v.storageClass] = (by[v.storageClass] ?? 0) + v.size;
    for (const [cls, bytes] of Object.entries(by)) add(SERVICE.s3, `TimedStorage-${cls}`, b.name, (bytes / 1e9) * (PRICE.s3GbMonth[cls] ?? PRICE.s3GbMonth.STANDARD), b.region, tagMap(b.tags), `${(bytes / 1e9).toFixed(1)} GB en ${cls}`);
  }
  for (const z of Object.values(a.route53?.zones ?? {})) add(SERVICE.r53, 'HostedZone', z.Name.replace(/\.$/, ''), PRICE.route53ZoneMonth, 'global', {}, 'Zona alojada');
  return out;
}

export const totalBurn = (a: Account) => Math.round(monthlyBurn(a).reduce((n, x) => n + x.monthly, 0) * 100) / 100;

void regional;
