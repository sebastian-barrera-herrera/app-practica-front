/** Amazon RDS y Aurora: instancias, copias, réplicas, Multi-AZ, grupos de subredes y clústeres. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, DbCluster, DbInstance, DbSnapshot, DbSubnetGroup, RdsState, Tag } from '../types';
import { iso, mergeTags, stableId } from '../util';

// ───────────────────────── catálogo ─────────────────────────

export const DB_ENGINES: Record<string, { version: string; port: number; aurora: boolean; minStorage: number }> = {
  mysql: { version: '8.0.40', port: 3306, aurora: false, minStorage: 20 },
  postgres: { version: '16.4', port: 5432, aurora: false, minStorage: 20 },
  mariadb: { version: '10.11.9', port: 3306, aurora: false, minStorage: 20 },
  'aurora-mysql': { version: '8.0.mysql_aurora.3.07.1', port: 3306, aurora: true, minStorage: 1 },
  'aurora-postgresql': { version: '16.4', port: 5432, aurora: true, minStorage: 1 },
};

/** Clases de instancia y su precio orientativo por hora (USD, solo para estimar). */
export const DB_CLASSES: Record<string, { vcpu: number; memGiB: number; price: number }> = {
  'db.t3.micro': { vcpu: 2, memGiB: 1, price: 0.017 },
  'db.t3.small': { vcpu: 2, memGiB: 2, price: 0.034 },
  'db.t3.medium': { vcpu: 2, memGiB: 4, price: 0.068 },
  'db.t3.large': { vcpu: 2, memGiB: 8, price: 0.136 },
  'db.t4g.micro': { vcpu: 2, memGiB: 1, price: 0.016 },
  'db.t4g.small': { vcpu: 2, memGiB: 2, price: 0.032 },
  'db.t4g.medium': { vcpu: 2, memGiB: 4, price: 0.065 },
  'db.m5.large': { vcpu: 2, memGiB: 8, price: 0.171 },
  'db.m5.xlarge': { vcpu: 4, memGiB: 16, price: 0.342 },
  'db.m6g.large': { vcpu: 2, memGiB: 8, price: 0.152 },
  'db.r5.large': { vcpu: 2, memGiB: 16, price: 0.24 },
  'db.r5.xlarge': { vcpu: 4, memGiB: 32, price: 0.48 },
  'db.r6g.large': { vcpu: 2, memGiB: 16, price: 0.216 },
};

const CREATING_MS = 30000;
const MODIFYING_MS = 20000;
const REBOOT_MS = 10000;
const STOP_MS = 10000;
const START_MS = 20000;
const DELETING_MS = 20000;
const SNAP_MS = 15000;

const REGION_CODE = (a: Account, region: string) => stableId(`rdsep:${a.id}:${region}`, 'c', 11);

export function rdsOf(a: Account, region: string): RdsState {
  const r = regional(a, region);
  const first = !r.rds;
  r.rds ??= { instances: {}, snapshots: {}, subnetGroups: {}, clusters: {} };
  if (first || !r.rds.subnetGroups.default) {
    const vpc = Object.values(r.ec2.vpcs).find((v) => v.IsDefault);
    if (vpc) r.rds.subnetGroups.default = { DBSubnetGroupName: 'default', DBSubnetGroupDescription: 'default', VpcId: vpc.VpcId, SubnetIds: Object.values(r.ec2.subnets).filter((s) => s.VpcId === vpc.VpcId).map((s) => s.SubnetId) };
  }
  return r.rds;
}

/** Hace avanzar los estados transitorios según el reloj virtual. */
export function refreshRds(a: Account, region: string): RdsState {
  const s = rdsOf(a, region);
  for (const i of Object.values(s.instances)) {
    const age = a.clock - i.stateAt;
    if (i.status === 'creating' && age >= CREATING_MS) done(i, a);
    else if (i.status === 'modifying' && age >= MODIFYING_MS) {
      Object.assign(i, i.pending ?? {});
      i.pending = undefined;
      done(i, a);
    } else if (i.status === 'rebooting' && age >= REBOOT_MS) done(i, a);
    else if (i.status === 'stopping' && age >= STOP_MS) {
      i.status = 'stopped';
      i.stateAt = a.clock;
    } else if (i.status === 'starting' && age >= START_MS) done(i, a);
    else if (i.status === 'deleting' && age >= DELETING_MS) {
      delete s.instances[i.DBInstanceIdentifier];
      for (const o of Object.values(s.instances)) if (o.ReadReplicaSourceDBInstanceIdentifier === i.DBInstanceIdentifier) o.ReadReplicaSourceDBInstanceIdentifier = undefined;
      for (const c of Object.values(s.clusters)) c.members = c.members.filter((m) => m.id !== i.DBInstanceIdentifier);
    }
  }
  for (const sn of Object.values(s.snapshots)) if (sn.status === 'creating' && a.clock - sn.stateAt >= SNAP_MS) sn.status = 'available';
  for (const c of Object.values(s.clusters)) {
    if (c.status === 'creating' && a.clock - c.stateAt >= CREATING_MS) c.status = 'available';
    else if (c.status === 'deleting' && a.clock - c.stateAt >= DELETING_MS) delete s.clusters[c.DBClusterIdentifier];
  }
  return s;
}

function done(i: DbInstance, a: Account) {
  i.status = 'available';
  i.stateAt = a.clock;
}

/** Deja asentadas todas las transiciones (para comprobar el estado final de un reto). */
export function settleRds(a: Account): void {
  for (const reg of Object.keys(a.regions)) {
    if (!a.regions[reg].rds) continue;
    a.clock += 600000;
    refreshRds(a, reg);
  }
}

const arnOf = (c: Pick<OpCtx, 'acct' | 'region'>, kind: string, id: string) => `arn:aws:rds:${c.region}:${c.acct.id}:${kind}:${id}`;
const E = {
  inst: (id: string) => new AwsError('DBInstanceNotFound', `DBInstance ${id} not found.`, 404),
  snap: (id: string) => new AwsError('DBSnapshotNotFound', `DBSnapshot not found: ${id}`, 404),
  sub: (id: string) => new AwsError('DBSubnetGroupNotFoundFault', `DB subnet group '${id}' does not exist.`, 404),
  cluster: (id: string) => new AwsError('DBClusterNotFoundFault', `DBCluster ${id} not found.`, 404),
  state: (id: string) => new AwsError('InvalidDBInstanceState', `Instance ${id} is not in available state.`),
  invalid: (m: string) => new AwsError('InvalidParameterValue', m),
  combo: (m: string) => new AwsError('InvalidParameterCombination', m),
};

// ───────────────────────── vistas ─────────────────────────

const subnetGroupView = (c: Pick<OpCtx, 'acct' | 'region'>, g: DbSubnetGroup) => {
  const r = regional(c.acct, c.region).ec2;
  return {
    DBSubnetGroupName: g.DBSubnetGroupName,
    DBSubnetGroupDescription: g.DBSubnetGroupDescription,
    VpcId: g.VpcId,
    SubnetGroupStatus: 'Complete',
    Subnets: g.SubnetIds.map((id) => ({ SubnetIdentifier: id, SubnetAvailabilityZone: { Name: r.subnets[id]?.AvailabilityZone }, SubnetOutpost: {}, SubnetStatus: 'Active' })),
    DBSubnetGroupArn: arnOf(c, 'subgrp', g.DBSubnetGroupName),
    SupportedNetworkTypes: ['IPV4'],
  };
};

const endpointHost = (a: Account, region: string, id: string, kind = '') => `${id}.${kind}${REGION_CODE(a, region)}.${region}.rds.amazonaws.com`;

function instanceView(c: Pick<OpCtx, 'acct' | 'region'>, i: DbInstance) {
  const s = rdsOf(c.acct, c.region);
  const replicas = Object.values(s.instances).filter((x) => x.ReadReplicaSourceDBInstanceIdentifier === i.DBInstanceIdentifier).map((x) => x.DBInstanceIdentifier);
  const g = s.subnetGroups[i.DBSubnetGroupName];
  const hasEndpoint = i.status !== 'creating' && !i.DBClusterIdentifier;
  const family = i.Engine.startsWith('aurora') ? i.Engine : `${i.Engine}${i.EngineVersion.split('.').slice(0, i.Engine === 'postgres' ? 1 : 2).join('.')}`;
  return {
    DBInstanceIdentifier: i.DBInstanceIdentifier,
    DBInstanceClass: i.DBInstanceClass,
    Engine: i.Engine,
    DBInstanceStatus: i.status,
    MasterUsername: i.MasterUsername,
    ...(i.DBName ? { DBName: i.DBName } : {}),
    ...(hasEndpoint ? { Endpoint: { Address: endpointHost(c.acct, c.region, i.DBInstanceIdentifier), Port: i.Port, HostedZoneId: 'Z2R2ITUGPM61AM' } } : {}),
    AllocatedStorage: i.AllocatedStorage,
    InstanceCreateTime: i.InstanceCreateTime,
    PreferredBackupWindow: '03:12-03:42',
    BackupRetentionPeriod: i.BackupRetentionPeriod,
    DBSecurityGroups: [],
    VpcSecurityGroups: i.VpcSecurityGroupIds.map((id) => ({ VpcSecurityGroupId: id, Status: 'active' })),
    DBParameterGroups: [{ DBParameterGroupName: `default.${family}`, ParameterApplyStatus: 'in-sync' }],
    AvailabilityZone: i.AvailabilityZone,
    DBSubnetGroup: g ? subnetGroupView(c, g) : undefined,
    PreferredMaintenanceWindow: 'sat:08:18-sat:08:48',
    PendingModifiedValues: i.pending ?? {},
    MultiAZ: i.MultiAZ,
    EngineVersion: i.EngineVersion,
    AutoMinorVersionUpgrade: true,
    ...(i.ReadReplicaSourceDBInstanceIdentifier ? { ReadReplicaSourceDBInstanceIdentifier: i.ReadReplicaSourceDBInstanceIdentifier } : {}),
    ReadReplicaDBInstanceIdentifiers: replicas,
    LicenseModel: i.Engine === 'postgres' ? 'postgresql-license' : i.Engine === 'mariadb' ? 'general-public-license' : 'general-public-license',
    OptionGroupMemberships: [{ OptionGroupName: `default:${family.replace(/(\d)$/, '-$1').replace(/\.(\d)/, '-$1')}`, Status: 'in-sync' }],
    PubliclyAccessible: i.PubliclyAccessible,
    StorageType: i.StorageType,
    DbInstancePort: 0,
    StorageEncrypted: i.StorageEncrypted,
    DbiResourceId: 'db-' + stableId('dbi:' + i.DBInstanceIdentifier, '', 26, 'up'),
    CACertificateIdentifier: 'rds-ca-rsa2048-g1',
    DomainMemberships: [],
    CopyTagsToSnapshot: false,
    MonitoringInterval: 0,
    DBInstanceArn: arnOf(c, 'db', i.DBInstanceIdentifier),
    IAMDatabaseAuthenticationEnabled: false,
    PerformanceInsightsEnabled: false,
    DeletionProtection: i.DeletionProtection,
    AssociatedRoles: [],
    TagList: i.Tags,
    ...(i.SecondaryAvailabilityZone && i.MultiAZ ? { SecondaryAvailabilityZone: i.SecondaryAvailabilityZone } : {}),
    ...(i.DBClusterIdentifier ? { DBClusterIdentifier: i.DBClusterIdentifier } : {}),
    CustomerOwnedIpEnabled: false,
    BackupTarget: 'region',
    NetworkType: 'IPV4',
  };
}

const snapView = (c: Pick<OpCtx, 'acct' | 'region'>, sn: DbSnapshot) => {
  const s = rdsOf(c.acct, c.region);
  const src = s.instances[sn.DBInstanceIdentifier];
  const vpc = src ? s.subnetGroups[src.DBSubnetGroupName]?.VpcId : undefined;
  return {
    DBSnapshotIdentifier: sn.DBSnapshotIdentifier,
    DBInstanceIdentifier: sn.DBInstanceIdentifier,
    SnapshotCreateTime: sn.SnapshotCreateTime,
    Engine: sn.Engine,
    AllocatedStorage: sn.AllocatedStorage,
    Status: sn.status,
    Port: sn.Port,
    AvailabilityZone: src?.AvailabilityZone,
    VpcId: vpc,
    MasterUsername: sn.MasterUsername,
    EngineVersion: sn.EngineVersion,
    LicenseModel: 'general-public-license',
    SnapshotType: sn.SnapshotType,
    StorageType: sn.StorageType,
    Encrypted: sn.Encrypted,
    DBSnapshotArn: arnOf(c, 'snapshot', sn.DBSnapshotIdentifier),
    PercentProgress: sn.status === 'available' ? 100 : 40,
    TagList: sn.Tags,
  };
};

// ───────────────────────── validaciones ─────────────────────────

const checkId = (id: string, what = 'DB Instance') => {
  if (!/^[a-z](?:-?[a-z0-9])*$/i.test(id) || id.length > 63) throw E.invalid(`Invalid ${what} identifier: ${id}`);
};

function checkPassword(p: string | undefined) {
  if (!p) throw E.combo('The parameter MasterUserPassword must be provided and must not be blank.');
  if (p.length < 8) throw E.invalid('The parameter MasterUserPassword is not a valid password because it is shorter than 8 characters.');
  if (/[/@" ]/.test(p)) throw E.invalid("The parameter MasterUserPassword is not a valid password. Only printable ASCII characters besides '/', '@', '\"', ' ' may be used.");
}

function groupFor(c: OpCtx, name: string | undefined): DbSubnetGroup {
  const s = rdsOf(c.acct, c.region);
  const g = s.subnetGroups[name ?? 'default'];
  if (!g) throw E.sub(name ?? 'default');
  return g;
}

function azsOf(c: OpCtx, g: DbSubnetGroup): string[] {
  const r = regional(c.acct, c.region).ec2;
  return [...new Set(g.SubnetIds.map((id) => r.subnets[id]?.AvailabilityZone).filter(Boolean))].sort();
}

function sgsFor(c: OpCtx, g: DbSubnetGroup, ids: string[] | undefined): string[] {
  const r = regional(c.acct, c.region).ec2;
  if (!ids?.length) return [Object.values(r.securityGroups).find((x) => x.VpcId === g.VpcId && x.GroupName === 'default')!.GroupId];
  for (const id of ids) {
    const sg = r.securityGroups[id];
    if (!sg) throw new AwsError('InvalidParameterValue', `Invalid security group , groupId= ${id},  groupName=.`);
    if (sg.VpcId !== g.VpcId) throw new AwsError('InvalidParameterValue', `The security group ${id} does not belong to the VPC ${g.VpcId} of the DB subnet group.`);
  }
  return ids;
}

// ───────────────────────── creación (también para escenarios) ─────────────────────────

export interface DbOpts {
  cls?: string;
  engine?: string;
  storage?: number;
  user?: string;
  multiAz?: boolean;
  public?: boolean;
  backup?: number;
  sgIds?: string[];
  tags?: Tag[];
  status?: string;
  encrypted?: boolean;
  deletionProtection?: boolean;
  cluster?: string;
  dbName?: string;
}

export function rdsCreate(a: Account, region: string, id: string, o: DbOpts = {}): DbInstance {
  const s = rdsOf(a, region);
  const g = s.subnetGroups.default;
  const r = regional(a, region).ec2;
  const engine = o.engine ?? 'mysql';
  const azs = [...new Set(g.SubnetIds.map((x) => r.subnets[x].AvailabilityZone))].sort();
  const sg = o.sgIds ?? [Object.values(r.securityGroups).find((x) => x.VpcId === g.VpcId && x.GroupName === 'default')!.GroupId];
  const inst: DbInstance = {
    DBInstanceIdentifier: id,
    DBInstanceClass: o.cls ?? 'db.t3.micro',
    Engine: engine,
    EngineVersion: DB_ENGINES[engine].version,
    AllocatedStorage: o.storage ?? 20,
    StorageType: 'gp3',
    MasterUsername: o.user ?? 'admin',
    ...(o.dbName ? { DBName: o.dbName } : {}),
    MultiAZ: !!o.multiAz,
    AvailabilityZone: azs[0],
    ...(o.multiAz ? { SecondaryAvailabilityZone: azs[1] } : {}),
    PubliclyAccessible: !!o.public,
    VpcSecurityGroupIds: sg,
    DBSubnetGroupName: 'default',
    BackupRetentionPeriod: o.backup ?? 1,
    StorageEncrypted: !!o.encrypted,
    DeletionProtection: !!o.deletionProtection,
    Port: DB_ENGINES[engine].port,
    InstanceCreateTime: iso(a.clock - 3600000),
    status: o.status ?? 'available',
    stateAt: a.clock - 3600000,
    DBClusterIdentifier: o.cluster,
    Tags: o.tags ?? [],
  };
  s.instances[id] = inst;
  return inst;
}

// ───────────────────────── instancias ─────────────────────────

const CREATE = 'db-instance-identifier:s! db-instance-class:s! engine:s! master-username:s master-user-password:s allocated-storage:i db-name:s multi-az:b availability-zone:s db-subnet-group-name:s vpc-security-group-ids:l publicly-accessible:b backup-retention-period:i storage-type:s storage-encrypted:b port:i deletion-protection:b engine-version:s tags:t db-cluster-identifier:s';

op('rds', 'create-db-instance', CREATE, 'Crea una base de datos relacional gestionada (MySQL, PostgreSQL, MariaDB, Aurora).', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const id = c.p.DbInstanceIdentifier as string;
  checkId(id);
  if (s.instances[id]) throw new AwsError('DBInstanceAlreadyExists', 'DB instance already exists');
  const engine = c.p.Engine as string;
  const eng = DB_ENGINES[engine];
  if (!eng) throw E.invalid(`Invalid DB engine: ${engine}`);
  const cls = c.p.DbInstanceClass as string;
  if (!DB_CLASSES[cls]) throw E.invalid(`RDS does not support creating a DB instance with the following combination: DBInstanceClass=${cls}, Engine=${engine}, EngineVersion=${eng.version}, LicenseModel=general-public-license. For supported combinations of instance class and database engine version, see the documentation.`);
  const cluster = c.p.DbClusterIdentifier ? s.clusters[c.p.DbClusterIdentifier] : undefined;
  if (c.p.DbClusterIdentifier && !cluster) throw E.cluster(c.p.DbClusterIdentifier);
  if (eng.aurora && !cluster) throw E.combo(`DB cluster identifier is required for engine ${engine}. Create a cluster first with create-db-cluster.`);
  if (!eng.aurora) {
    if (c.p.AllocatedStorage === undefined) throw E.combo('The parameter AllocatedStorage must be provided and must not be blank for engine ' + engine + '.');
    if (c.p.AllocatedStorage < eng.minStorage || c.p.AllocatedStorage > 65536) throw E.invalid(`Invalid storage size for engine name ${engine} and storage type ${c.p.StorageType ?? 'gp3'}: ${c.p.AllocatedStorage}`);
    if (!c.p.MasterUsername) throw E.combo('The parameter MasterUsername must be provided and must not be blank.');
    checkPassword(c.p.MasterUserPassword);
  }
  if (engine === 'postgres' && c.p.MasterUsername === 'admin') throw E.invalid('MasterUsername admin cannot be used as it is a reserved word used by the engine');
  const g = groupFor(c, c.p.DbSubnetGroupName ?? (cluster ? cluster.DBSubnetGroup : undefined));
  const azs = azsOf(c, g);
  if (c.p.MultiAz && azs.length < 2) throw E.invalid(`DB subnet group ${g.DBSubnetGroupName} doesn't meet Availability Zone (AZ) coverage requirement for Multi-AZ. Current AZ coverage: ${azs.join(',')}. Add subnets to cover at least 2 AZs.`);
  if (c.p.AvailabilityZone && !azs.includes(c.p.AvailabilityZone)) throw E.invalid(`Invalid AZ: ${c.p.AvailabilityZone}. The DB subnet group does not include a subnet in that zone.`);
  if (cluster && c.p.MultiAz) throw E.combo('Multi-AZ is not supported for instances that belong to an Aurora cluster (the cluster already spans several AZs).');
  const sgIds = sgsFor(c, g, c.p.VpcSecurityGroupIds);
  const az = c.p.AvailabilityZone ?? azs[(Object.keys(s.instances).length) % azs.length];
  const defaultVpc = regional(c.acct, c.region).ec2.vpcs[g.VpcId]?.IsDefault;
  const inst: DbInstance = {
    DBInstanceIdentifier: id,
    DBInstanceClass: cls,
    Engine: engine,
    EngineVersion: c.p.EngineVersion ?? eng.version,
    AllocatedStorage: eng.aurora ? 1 : c.p.AllocatedStorage,
    StorageType: eng.aurora ? 'aurora' : c.p.StorageType ?? 'gp3',
    MasterUsername: cluster?.MasterUsername ?? c.p.MasterUsername,
    ...(c.p.DbName ? { DBName: c.p.DbName } : {}),
    MultiAZ: !!c.p.MultiAz,
    AvailabilityZone: az,
    ...(c.p.MultiAz ? { SecondaryAvailabilityZone: azs.find((x) => x !== az) } : {}),
    PubliclyAccessible: c.p.PubliclyAccessible ?? (!c.p.DbSubnetGroupName && !!defaultVpc),
    VpcSecurityGroupIds: sgIdsOrCluster(sgIds, cluster),
    DBSubnetGroupName: g.DBSubnetGroupName,
    BackupRetentionPeriod: c.p.BackupRetentionPeriod ?? 1,
    StorageEncrypted: !!c.p.StorageEncrypted || !!cluster?.StorageEncrypted,
    DeletionProtection: !!c.p.DeletionProtection,
    Port: c.p.Port ?? eng.port,
    InstanceCreateTime: iso(c.acct.clock),
    status: 'creating',
    stateAt: c.acct.clock,
    ...(cluster ? { DBClusterIdentifier: cluster.DBClusterIdentifier } : {}),
    Tags: (c.p.Tags as Tag[]) ?? [],
  };
  s.instances[id] = inst;
  if (cluster) cluster.members.push({ id, writer: !cluster.members.length });
  return { DBInstance: instanceView(c, inst) };
});

const sgIdsOrCluster = (ids: string[], cluster: DbCluster | undefined) => (cluster?.VpcSecurityGroupIds.length ? cluster.VpcSecurityGroupIds : ids);

op('rds', 'describe-db-instances', 'db-instance-identifier:s filters:f max-records:i', 'Lista las instancias de base de datos (o una) con su estado y endpoint.', { res: (c) => (c.p.DbInstanceIdentifier ? arnOf(c, 'db', c.p.DbInstanceIdentifier) : `arn:aws:rds:${c.region}:${c.acct.id}:db:*`), paginate: 'DBInstances' }, (c) => {
  const s = refreshRds(c.acct, c.region);
  if (c.p.DbInstanceIdentifier && !s.instances[c.p.DbInstanceIdentifier]) throw E.inst(c.p.DbInstanceIdentifier);
  const list = Object.values(s.instances).filter((i) => (!c.p.DbInstanceIdentifier || i.DBInstanceIdentifier === c.p.DbInstanceIdentifier) && ((c.p.Filters as { Name: string; Values: string[] }[]) ?? []).every((f) => {
    const have = f.Name === 'engine' ? [i.Engine] : f.Name === 'db-instance-id' ? [i.DBInstanceIdentifier] : f.Name === 'db-cluster-id' ? (i.DBClusterIdentifier ? [i.DBClusterIdentifier] : []) : [];
    return have.some((h) => f.Values.includes(h));
  }));
  return { DBInstances: list.map((i) => instanceView(c, i)) };
});

const MODIFY = 'db-instance-identifier:s! db-instance-class:s allocated-storage:i multi-az:b backup-retention-period:i apply-immediately:b master-user-password:s deletion-protection:b vpc-security-group-ids:l publicly-accessible:b storage-type:s engine-version:s';

op('rds', 'modify-db-instance', MODIFY, 'Cambia la clase, el disco, Multi-AZ, las copias… (con `--apply-immediately` o en la próxima ventana de mantenimiento).', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.status !== 'available' && i.status !== 'stopped') throw E.state(i.DBInstanceIdentifier);
  const change: Record<string, unknown> = {};
  if (c.p.DbInstanceClass) {
    if (!DB_CLASSES[c.p.DbInstanceClass]) throw E.invalid(`Invalid DB Instance class: ${c.p.DbInstanceClass}`);
    if (c.p.DbInstanceClass !== i.DBInstanceClass) change.DBInstanceClass = c.p.DbInstanceClass;
  }
  if (c.p.AllocatedStorage !== undefined && c.p.AllocatedStorage !== i.AllocatedStorage) {
    if (c.p.AllocatedStorage < i.AllocatedStorage) throw E.invalid(`Invalid storage size for engine name ${i.Engine} and storage type ${i.StorageType}: ${c.p.AllocatedStorage}. The new allocated storage must be larger than the current one (${i.AllocatedStorage} GiB); storage can't be reduced.`);
    change.AllocatedStorage = c.p.AllocatedStorage;
  }
  if (c.p.MultiAz !== undefined && c.p.MultiAz !== i.MultiAZ) {
    const azs = azsOf(c, groupFor(c, i.DBSubnetGroupName));
    if (c.p.MultiAz && azs.length < 2) throw E.invalid(`DB subnet group ${i.DBSubnetGroupName} doesn't meet Availability Zone (AZ) coverage requirement for Multi-AZ.`);
    change.MultiAZ = c.p.MultiAz;
    change.SecondaryAvailabilityZone = c.p.MultiAz ? azs.find((x) => x !== i.AvailabilityZone) : undefined;
  }
  if (c.p.BackupRetentionPeriod !== undefined && c.p.BackupRetentionPeriod !== i.BackupRetentionPeriod) {
    if (c.p.BackupRetentionPeriod < 0 || c.p.BackupRetentionPeriod > 35) throw E.invalid('Invalid backup retention period. Must be a value between 0 and 35.');
    if (c.p.BackupRetentionPeriod === 0 && Object.values(s.instances).some((x) => x.ReadReplicaSourceDBInstanceIdentifier === i.DBInstanceIdentifier)) throw E.combo('Backup retention period can not be set to 0 while the instance has read replicas.');
    change.BackupRetentionPeriod = c.p.BackupRetentionPeriod;
  }
  if (c.p.StorageType) change.StorageType = c.p.StorageType;
  if (c.p.PubliclyAccessible !== undefined) change.PubliclyAccessible = c.p.PubliclyAccessible;
  if (c.p.VpcSecurityGroupIds) change.VpcSecurityGroupIds = sgsFor(c, groupFor(c, i.DBSubnetGroupName), c.p.VpcSecurityGroupIds);
  if (c.p.EngineVersion) change.EngineVersion = c.p.EngineVersion;
  if (c.p.DeletionProtection !== undefined) i.DeletionProtection = c.p.DeletionProtection;
  if (c.p.MasterUserPassword) checkPassword(c.p.MasterUserPassword);
  if (Object.keys(change).length) {
    i.pending = { ...(i.pending ?? {}), ...change };
  }
  // con `--apply-immediately` se aplican también los cambios que ya estaban pendientes
  if (c.p.ApplyImmediately && i.pending) {
    i.status = 'modifying';
    i.stateAt = c.acct.clock;
  }
  return { DBInstance: instanceView(c, i) };
});

op('rds', 'reboot-db-instance', 'db-instance-identifier:s! force-failover:b', 'Reinicia la instancia; con `--force-failover` (Multi-AZ) fuerza el cambio a la zona de reserva.', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.status !== 'available') throw E.state(i.DBInstanceIdentifier);
  if (c.p.ForceFailover) {
    if (!i.MultiAZ) throw E.combo('Cannot failover a Non-MultiAZ instance');
    [i.AvailabilityZone, i.SecondaryAvailabilityZone] = [i.SecondaryAvailabilityZone!, i.AvailabilityZone];
  }
  if (i.pending) {
    Object.assign(i, i.pending);
    i.pending = undefined;
  }
  i.status = 'rebooting';
  i.stateAt = c.acct.clock;
  return { DBInstance: instanceView(c, i) };
});

op('rds', 'stop-db-instance', 'db-instance-identifier:s! db-snapshot-identifier:s', 'Para la instancia (se sigue pagando el disco; AWS la vuelve a encender a los 7 días).', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.status !== 'available') throw E.state(i.DBInstanceIdentifier);
  if (i.ReadReplicaSourceDBInstanceIdentifier || Object.values(s.instances).some((x) => x.ReadReplicaSourceDBInstanceIdentifier === i.DBInstanceIdentifier)) throw E.combo('Instance is a read replica or has read replicas: it cannot be stopped.');
  i.status = 'stopping';
  i.stateAt = c.acct.clock;
  return { DBInstance: instanceView(c, i) };
});

op('rds', 'start-db-instance', 'db-instance-identifier:s!', 'Arranca una instancia parada.', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.status !== 'stopped') throw new AwsError('InvalidDBInstanceState', `Instance ${i.DBInstanceIdentifier} is not stopped.`);
  i.status = 'starting';
  i.stateAt = c.acct.clock;
  return { DBInstance: instanceView(c, i) };
});

op('rds', 'delete-db-instance', 'db-instance-identifier:s! skip-final-snapshot:b final-db-snapshot-identifier:s delete-automated-backups:b', 'Borra la instancia. Hay que elegir: copia final (`--final-db-snapshot-identifier`) o `--skip-final-snapshot`.', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.DeletionProtection) throw E.combo('Cannot delete protected DB Instance, please disable deletion protection and try again.');
  if (i.status === 'deleting') throw new AwsError('InvalidDBInstanceState', `Instance ${i.DBInstanceIdentifier} is already being deleted.`);
  const skip = c.p.SkipFinalSnapshot === true;
  const finalId = c.p.FinalDbSnapshotIdentifier as string | undefined;
  if (!skip && !finalId) throw E.combo('FinalDBSnapshotIdentifier is required unless SkipFinalSnapshot is specified.');
  if (skip && finalId) throw E.combo('FinalDBSnapshotIdentifier can not be specified when delete-skip-final-snapshot is enabled.');
  if (finalId && !i.ReadReplicaSourceDBInstanceIdentifier) {
    checkId(finalId, 'DB Snapshot');
    if (s.snapshots[finalId]) throw new AwsError('DBSnapshotAlreadyExists', `Cannot create the snapshot because a snapshot with the identifier ${finalId} already exists.`);
    makeSnapshot(c.acct, s, i, finalId, 'manual', []);
  }
  i.status = 'deleting';
  i.stateAt = c.acct.clock;
  return { DBInstance: instanceView(c, i) };
});

// ───────────────────────── copias, restauración y réplicas ─────────────────────────

function makeSnapshot(a: Account, s: RdsState, i: DbInstance, id: string, type: 'manual' | 'automated', tags: Tag[]): DbSnapshot {
  const sn: DbSnapshot = { DBSnapshotIdentifier: id, DBInstanceIdentifier: i.DBInstanceIdentifier, SnapshotCreateTime: iso(a.clock), Engine: i.Engine, EngineVersion: i.EngineVersion, AllocatedStorage: i.AllocatedStorage, MasterUsername: i.MasterUsername, DBInstanceClass: i.DBInstanceClass, StorageType: i.StorageType, Encrypted: i.StorageEncrypted, SnapshotType: type, Port: i.Port, status: 'creating', stateAt: a.clock, Tags: tags };
  s.snapshots[id] = sn;
  return sn;
}

op('rds', 'create-db-snapshot', 'db-snapshot-identifier:s! db-instance-identifier:s! tags:t', 'Hace una copia manual de la base de datos (no caduca hasta que la borres).', { res: (c) => arnOf(c, 'snapshot', c.p.DbSnapshotIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (i.status !== 'available') throw E.state(i.DBInstanceIdentifier);
  const id = c.p.DbSnapshotIdentifier as string;
  checkId(id, 'DB Snapshot');
  if (s.snapshots[id]) throw new AwsError('DBSnapshotAlreadyExists', `Cannot create the snapshot because a snapshot with the identifier ${id} already exists.`);
  return { DBSnapshot: snapView(c, makeSnapshot(c.acct, s, i, id, 'manual', (c.p.Tags as Tag[]) ?? [])) };
});

op('rds', 'describe-db-snapshots', 'db-instance-identifier:s db-snapshot-identifier:s snapshot-type:s', 'Lista las copias de las bases de datos.', { res: () => `arn:aws:rds:*:*:snapshot:*`, paginate: 'DBSnapshots' }, (c) => {
  const s = refreshRds(c.acct, c.region);
  if (c.p.DbSnapshotIdentifier && !s.snapshots[c.p.DbSnapshotIdentifier]) throw E.snap(c.p.DbSnapshotIdentifier);
  return { DBSnapshots: Object.values(s.snapshots).filter((x) => (!c.p.DbInstanceIdentifier || x.DBInstanceIdentifier === c.p.DbInstanceIdentifier) && (!c.p.DbSnapshotIdentifier || x.DBSnapshotIdentifier === c.p.DbSnapshotIdentifier) && (!c.p.SnapshotType || x.SnapshotType === c.p.SnapshotType)).map((x) => snapView(c, x)) };
});

op('rds', 'delete-db-snapshot', 'db-snapshot-identifier:s!', 'Borra una copia manual.', { res: (c) => arnOf(c, 'snapshot', c.p.DbSnapshotIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const sn = s.snapshots[c.p.DbSnapshotIdentifier];
  if (!sn) throw E.snap(c.p.DbSnapshotIdentifier);
  delete s.snapshots[sn.DBSnapshotIdentifier];
  return { DBSnapshot: snapView(c, sn) };
});

op('rds', 'restore-db-instance-from-db-snapshot', 'db-instance-identifier:s! db-snapshot-identifier:s! db-instance-class:s multi-az:b publicly-accessible:b db-subnet-group-name:s vpc-security-group-ids:l', 'Crea una instancia NUEVA a partir de una copia (la original no se toca).', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const sn = s.snapshots[c.p.DbSnapshotIdentifier];
  if (!sn) throw E.snap(c.p.DbSnapshotIdentifier);
  if (sn.status !== 'available') throw new AwsError('InvalidDBSnapshotState', `Cannot restore from snapshot ${sn.DBSnapshotIdentifier}: it is ${sn.status}.`);
  const id = c.p.DbInstanceIdentifier as string;
  checkId(id);
  if (s.instances[id]) throw new AwsError('DBInstanceAlreadyExists', 'DB instance already exists');
  const src = s.instances[sn.DBInstanceIdentifier];
  const g = groupFor(c, c.p.DbSubnetGroupName ?? src?.DBSubnetGroupName);
  const azs = azsOf(c, g);
  const cls = c.p.DbInstanceClass ?? sn.DBInstanceClass;
  if (!DB_CLASSES[cls]) throw E.invalid(`Invalid DB Instance class: ${cls}`);
  const inst: DbInstance = { DBInstanceIdentifier: id, DBInstanceClass: cls, Engine: sn.Engine, EngineVersion: sn.EngineVersion, AllocatedStorage: sn.AllocatedStorage, StorageType: sn.StorageType, MasterUsername: sn.MasterUsername, MultiAZ: !!c.p.MultiAz, AvailabilityZone: azs[0], ...(c.p.MultiAz ? { SecondaryAvailabilityZone: azs[1] } : {}), PubliclyAccessible: c.p.PubliclyAccessible ?? src?.PubliclyAccessible ?? false, VpcSecurityGroupIds: sgsFor(c, g, c.p.VpcSecurityGroupIds), DBSubnetGroupName: g.DBSubnetGroupName, BackupRetentionPeriod: 1, StorageEncrypted: sn.Encrypted, DeletionProtection: false, Port: sn.Port, InstanceCreateTime: iso(c.acct.clock), status: 'creating', stateAt: c.acct.clock, Tags: [] };
  s.instances[id] = inst;
  return { DBInstance: instanceView(c, inst) };
});

op('rds', 'create-db-instance-read-replica', 'db-instance-identifier:s! source-db-instance-identifier:s! db-instance-class:s availability-zone:s publicly-accessible:b tags:t', 'Crea una réplica de lectura asíncrona para repartir consultas SELECT.', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const src = s.instances[c.p.SourceDbInstanceIdentifier];
  if (!src) throw E.inst(c.p.SourceDbInstanceIdentifier);
  const id = c.p.DbInstanceIdentifier as string;
  checkId(id);
  if (s.instances[id]) throw new AwsError('DBInstanceAlreadyExists', 'DB instance already exists');
  if (src.DBClusterIdentifier) throw E.combo('Read replicas of Aurora instances are added to the cluster with create-db-instance --db-cluster-identifier.');
  if (src.ReadReplicaSourceDBInstanceIdentifier) throw E.combo('Cannot create a read replica of a read replica in this setup.');
  if (src.BackupRetentionPeriod === 0) throw new AwsError('InvalidDBInstanceState', 'Automated backups are not enabled for this database instance. To enable automated backups, use ModifyDBInstance to set the backup retention period to a non-zero value.');
  if (src.status !== 'available') throw E.state(src.DBInstanceIdentifier);
  const cls = c.p.DbInstanceClass ?? src.DBInstanceClass;
  if (!DB_CLASSES[cls]) throw E.invalid(`Invalid DB Instance class: ${cls}`);
  const azs = azsOf(c, groupFor(c, src.DBSubnetGroupName));
  const inst: DbInstance = { ...src, DBInstanceIdentifier: id, DBInstanceClass: cls, MultiAZ: false, SecondaryAvailabilityZone: undefined, AvailabilityZone: c.p.AvailabilityZone ?? azs[(azs.indexOf(src.AvailabilityZone) + 1) % azs.length], PubliclyAccessible: c.p.PubliclyAccessible ?? src.PubliclyAccessible, BackupRetentionPeriod: 0, DeletionProtection: false, ReadReplicaSourceDBInstanceIdentifier: src.DBInstanceIdentifier, InstanceCreateTime: iso(c.acct.clock), status: 'creating', stateAt: c.acct.clock, pending: undefined, Tags: (c.p.Tags as Tag[]) ?? [] };
  s.instances[id] = inst;
  return { DBInstance: instanceView(c, inst) };
});

op('rds', 'promote-read-replica', 'db-instance-identifier:s! backup-retention-period:i', 'Convierte una réplica en una base de datos independiente (con escritura).', { res: (c) => arnOf(c, 'db', c.p.DbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const i = s.instances[c.p.DbInstanceIdentifier];
  if (!i) throw E.inst(c.p.DbInstanceIdentifier);
  if (!i.ReadReplicaSourceDBInstanceIdentifier) throw new AwsError('InvalidDBInstanceState', `DB Instance ${i.DBInstanceIdentifier} is not a read replica.`);
  i.ReadReplicaSourceDBInstanceIdentifier = undefined;
  i.BackupRetentionPeriod = c.p.BackupRetentionPeriod ?? 1;
  i.status = 'modifying';
  i.stateAt = c.acct.clock;
  return { DBInstance: instanceView(c, i) };
});

// ───────────────────────── grupos de subredes ─────────────────────────

op('rds', 'create-db-subnet-group', 'db-subnet-group-name:s! db-subnet-group-description:s! subnet-ids:l! tags:t', 'Crea un grupo de subredes (de al menos 2 zonas) donde RDS puede poner la base de datos.', { res: (c) => arnOf(c, 'subgrp', c.p.DbSubnetGroupName) }, (c) => {
  const s = rdsOf(c.acct, c.region);
  const r = regional(c.acct, c.region).ec2;
  const name = c.p.DbSubnetGroupName as string;
  if (s.subnetGroups[name]) throw new AwsError('DBSubnetGroupAlreadyExists', `DB subnet group '${name}' already exists.`);
  const ids = c.p.SubnetIds as string[];
  for (const id of ids) if (!r.subnets[id]) throw new AwsError('InvalidSubnet', `The subnet ID '${id}' is not valid`);
  const vpcs = new Set(ids.map((id) => r.subnets[id].VpcId));
  if (vpcs.size > 1) throw new AwsError('InvalidSubnet', 'Subnets in a DB subnet group must belong to the same VPC.');
  const azs = new Set(ids.map((id) => r.subnets[id].AvailabilityZone));
  if (azs.size < 2) throw new AwsError('DBSubnetGroupDoesNotCoverEnoughAZs', `The DB subnet group doesn't meet Availability Zone (AZ) coverage requirement. Current AZ coverage: ${[...azs].join(',')}. Add subnets to cover at least 2 AZs.`);
  const g: DbSubnetGroup = { DBSubnetGroupName: name, DBSubnetGroupDescription: c.p.DbSubnetGroupDescription, VpcId: [...vpcs][0], SubnetIds: ids };
  s.subnetGroups[name] = g;
  return { DBSubnetGroup: subnetGroupView(c, g) };
});

op('rds', 'describe-db-subnet-groups', 'db-subnet-group-name:s', 'Lista los grupos de subredes.', { res: () => `arn:aws:rds:*:*:subgrp:*`, paginate: 'DBSubnetGroups' }, (c) => {
  const s = rdsOf(c.acct, c.region);
  if (c.p.DbSubnetGroupName && !s.subnetGroups[c.p.DbSubnetGroupName]) throw E.sub(c.p.DbSubnetGroupName);
  return { DBSubnetGroups: Object.values(s.subnetGroups).filter((g) => !c.p.DbSubnetGroupName || g.DBSubnetGroupName === c.p.DbSubnetGroupName).map((g) => subnetGroupView(c, g)) };
});

op('rds', 'delete-db-subnet-group', 'db-subnet-group-name:s!', 'Borra un grupo de subredes que no use ninguna base de datos.', { res: (c) => arnOf(c, 'subgrp', c.p.DbSubnetGroupName) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  if (!s.subnetGroups[c.p.DbSubnetGroupName]) throw E.sub(c.p.DbSubnetGroupName);
  if (c.p.DbSubnetGroupName === 'default') throw new AwsError('InvalidDBSubnetGroupStateFault', 'The default DB subnet group cannot be deleted.');
  if (Object.values(s.instances).some((i) => i.DBSubnetGroupName === c.p.DbSubnetGroupName)) throw new AwsError('InvalidDBSubnetGroupStateFault', `Cannot delete the subnet group '${c.p.DbSubnetGroupName}' because at least one database instance is still using it.`);
  delete s.subnetGroups[c.p.DbSubnetGroupName];
  return undefined;
});

// ───────────────────────── Aurora: clústeres ─────────────────────────

const clusterView = (c: Pick<OpCtx, 'acct' | 'region'>, k: DbCluster) => {
  const s = rdsOf(c.acct, c.region);
  return {
    AllocatedStorage: 1,
    AvailabilityZones: azsOf(c as OpCtx, s.subnetGroups[k.DBSubnetGroup]),
    BackupRetentionPeriod: k.BackupRetentionPeriod,
    ...(k.DatabaseName ? { DatabaseName: k.DatabaseName } : {}),
    DBClusterIdentifier: k.DBClusterIdentifier,
    DBClusterParameterGroup: `default.${k.Engine}8.0`,
    DBSubnetGroup: k.DBSubnetGroup,
    Status: k.status,
    ...(k.status !== 'creating' ? { Endpoint: endpointHost(c.acct, c.region, k.DBClusterIdentifier, 'cluster-'), ReaderEndpoint: endpointHost(c.acct, c.region, k.DBClusterIdentifier, 'cluster-ro-') } : {}),
    MultiAZ: k.members.length > 1,
    Engine: k.Engine,
    EngineVersion: k.EngineVersion,
    Port: k.Port,
    MasterUsername: k.MasterUsername,
    DBClusterMembers: k.members.map((m) => ({ DBInstanceIdentifier: m.id, IsClusterWriter: m.writer, DBClusterParameterGroupStatus: 'in-sync', PromotionTier: m.writer ? 0 : 1 })),
    VpcSecurityGroups: k.VpcSecurityGroupIds.map((id) => ({ VpcSecurityGroupId: id, Status: 'active' })),
    StorageEncrypted: k.StorageEncrypted,
    DeletionProtection: k.DeletionProtection,
    DBClusterArn: arnOf(c, 'cluster', k.DBClusterIdentifier),
    ClusterCreateTime: k.ClusterCreateTime,
    TagList: k.Tags,
  };
};

op('rds', 'create-db-cluster', 'db-cluster-identifier:s! engine:s! master-username:s! master-user-password:s! database-name:s db-subnet-group-name:s vpc-security-group-ids:l storage-encrypted:b backup-retention-period:i deletion-protection:b tags:t', 'Crea un clúster de Aurora (almacenamiento compartido en 3 zonas); después se le añaden instancias.', { res: (c) => arnOf(c, 'cluster', c.p.DbClusterIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const id = c.p.DbClusterIdentifier as string;
  checkId(id, 'DB Cluster');
  if (s.clusters[id]) throw new AwsError('DBClusterAlreadyExistsFault', `DB Cluster already exists`);
  const eng = DB_ENGINES[c.p.Engine];
  if (!eng?.aurora) throw E.invalid(`Invalid DB engine: ${c.p.Engine}. DB clusters use engine aurora-mysql or aurora-postgresql.`);
  checkPassword(c.p.MasterUserPassword);
  const g = groupFor(c, c.p.DbSubnetGroupName);
  const k: DbCluster = { DBClusterIdentifier: id, Engine: c.p.Engine, EngineVersion: eng.version, MasterUsername: c.p.MasterUsername, ...(c.p.DatabaseName ? { DatabaseName: c.p.DatabaseName } : {}), Port: eng.port, status: 'creating', stateAt: c.acct.clock, members: [], DBSubnetGroup: g.DBSubnetGroupName, VpcSecurityGroupIds: sgsFor(c, g, c.p.VpcSecurityGroupIds), StorageEncrypted: c.p.StorageEncrypted !== false, BackupRetentionPeriod: c.p.BackupRetentionPeriod ?? 1, DeletionProtection: !!c.p.DeletionProtection, ClusterCreateTime: iso(c.acct.clock), Tags: (c.p.Tags as Tag[]) ?? [] };
  s.clusters[id] = k;
  return { DBCluster: clusterView(c, k) };
});

op('rds', 'describe-db-clusters', 'db-cluster-identifier:s', 'Lista los clústeres de Aurora con su endpoint de escritura y de lectura.', { res: () => `arn:aws:rds:*:*:cluster:*`, paginate: 'DBClusters' }, (c) => {
  const s = refreshRds(c.acct, c.region);
  if (c.p.DbClusterIdentifier && !s.clusters[c.p.DbClusterIdentifier]) throw E.cluster(c.p.DbClusterIdentifier);
  return { DBClusters: Object.values(s.clusters).filter((k) => !c.p.DbClusterIdentifier || k.DBClusterIdentifier === c.p.DbClusterIdentifier).map((k) => clusterView(c, k)) };
});

op('rds', 'failover-db-cluster', 'db-cluster-identifier:s! target-db-instance-identifier:s', 'Promociona una instancia lectora a escritora (conmutación por error de Aurora).', { res: (c) => arnOf(c, 'cluster', c.p.DbClusterIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const k = s.clusters[c.p.DbClusterIdentifier];
  if (!k) throw E.cluster(c.p.DbClusterIdentifier);
  if (k.members.length < 2) throw new AwsError('InvalidDBClusterStateFault', 'Cluster has only one instance: there is no reader to promote.');
  const target = c.p.TargetDbInstanceIdentifier ?? k.members.find((m) => !m.writer)!.id;
  if (!k.members.some((m) => m.id === target)) throw E.inst(target);
  for (const m of k.members) m.writer = m.id === target;
  return { DBCluster: clusterView(c, k) };
});

op('rds', 'delete-db-cluster', 'db-cluster-identifier:s! skip-final-snapshot:b final-db-snapshot-identifier:s', 'Borra el clúster (antes hay que borrar sus instancias).', { res: (c) => arnOf(c, 'cluster', c.p.DbClusterIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const k = s.clusters[c.p.DbClusterIdentifier];
  if (!k) throw E.cluster(c.p.DbClusterIdentifier);
  if (k.DeletionProtection) throw new AwsError('InvalidParameterCombination', 'Cannot delete protected Cluster, please disable deletion protection and try again.');
  if (k.members.some((m) => s.instances[m.id] && s.instances[m.id].status !== 'deleting')) throw new AwsError('InvalidDBClusterStateFault', 'Cluster cannot be deleted, it still contains DB instances in non-deleting state.');
  if (!c.p.SkipFinalSnapshot && !c.p.FinalDbSnapshotIdentifier) throw E.combo('FinalDBSnapshotIdentifier is required unless SkipFinalSnapshot is specified.');
  k.status = 'deleting';
  k.stateAt = c.acct.clock;
  return { DBCluster: clusterView(c, k) };
});

// ───────────────────────── etiquetas y esperas ─────────────────────────

function taggedByArn(c: OpCtx, arn: string): { Tags: Tag[] } | undefined {
  const s = refreshRds(c.acct, c.region);
  const id = arn.split(':').pop()!;
  const kind = arn.split(':')[5];
  const t = kind === 'db' ? s.instances[id] : kind === 'snapshot' ? s.snapshots[id] : kind === 'cluster' ? s.clusters[id] : undefined;
  return t as { Tags: Tag[] } | undefined;
}

op('rds', 'add-tags-to-resource', 'resource-name:s! tags:t!', 'Etiqueta una instancia, copia o clúster (por su ARN).', { res: (c) => c.p.ResourceName }, (c) => {
  const t = taggedByArn(c, c.p.ResourceName);
  if (!t) throw E.inst(String(c.p.ResourceName).split(':').pop()!);
  t.Tags = mergeTags(t.Tags, c.p.Tags);
  return undefined;
});

op('rds', 'list-tags-for-resource', 'resource-name:s!', 'Etiquetas de un recurso de RDS.', { res: (c) => c.p.ResourceName }, (c) => {
  const t = taggedByArn(c, c.p.ResourceName);
  if (!t) throw E.inst(String(c.p.ResourceName).split(':').pop()!);
  return { TagList: t.Tags };
});

const WAITERS: Record<string, (c: OpCtx, s: RdsState) => boolean> = {
  'db-instance-available': (c, s) => {
    const i = s.instances[c.p.DbInstanceIdentifier];
    if (!i) throw E.inst(c.p.DbInstanceIdentifier);
    return i.status === 'available';
  },
  'db-instance-deleted': (c, s) => !s.instances[c.p.DbInstanceIdentifier],
  'db-snapshot-available': (c, s) => {
    const sn = s.snapshots[c.p.DbSnapshotIdentifier];
    if (!sn) throw E.snap(c.p.DbSnapshotIdentifier);
    return sn.status === 'available';
  },
  'db-cluster-available': (c, s) => {
    const k = s.clusters[c.p.DbClusterIdentifier];
    if (!k) throw E.cluster(c.p.DbClusterIdentifier);
    return k.status === 'available';
  },
};

op('rds', 'wait', 'waiter:s! db-instance-identifier:s db-snapshot-identifier:s db-cluster-identifier:s', 'Espera a que se cumpla una condición (db-instance-available, db-instance-deleted, db-snapshot-available…).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = WAITERS[c.p.Waiter];
  if (!w) throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: ${Object.keys(WAITERS).join(', ')}`);
  for (let k = 0; k < 60; k++) {
    const s = refreshRds(c.acct, c.region);
    if (w(c, s)) return undefined;
    c.acct.clock += 30000;
  }
  throw new AwsError('WaiterError', `Waiter ${c.p.Waiter} failed: Max attempts exceeded`);
});
