/** Migración: AWS Database Migration Service (DMS) y AWS DataSync. */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { sgAllows } from '../net';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, DataSyncState, DmsConnection, DmsEndpoint, DmsInstance, DmsState, DmsTask, DsExecution, DsLocation, DsTask } from '../types';
import { iso, mkArn, toArr } from '../util';
import { roleCan, roleTrusts } from './flowlogs';
import { effectiveParam } from './rds2';
import { endpointHost, rdsOf } from './rds';
import { s3Current, s3Delete, s3Put, s3Keys, getBucket } from './s3';
import { ddbCommit, tablesOf } from './dynamodb';

const CREATING_MS = 5 * 60000;
const TEST_MS = 20000;

const dmsOf = (a: Account, region: string): DmsState => {
  const r = regional(a, region);
  r.dms ??= { subnetGroups: {}, instances: {}, endpoints: {}, connections: [], tasks: {} };
  return r.dms;
};
const dsOf = (a: Account, region: string): DataSyncState => {
  const r = regional(a, region);
  r.datasync ??= { agents: {}, locations: {}, tasks: {}, executions: {} };
  return r.datasync;
};

const dmsErr = {
  invalid: (m: string) => new AwsError('InvalidParameterValueException', m, 400),
  notFound: (what: string, id: string) => new AwsError('ResourceNotFoundFault', `${what} '${id}' not found.`, 400),
  state: (m: string) => new AwsError('InvalidResourceStateFault', m, 400),
};

const probeIp = (cidr: string) => {
  const p = cidr.split('/')[0].split('.').map(Number);
  return `${p[0]}.${p[1]}.${p[2]}.${Math.min(250, p[3] + 4)}`;
};

// ───────────────────────── DMS: instancias de replicación ─────────────────────────

const DMS_CLASSES = ['dms.t3.micro', 'dms.t3.small', 'dms.t3.medium', 'dms.t3.large', 'dms.r5.large', 'dms.r5.xlarge', 'dms.c5.large'];
const instArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('dms', c.region, c.acct.id, `rep:${id}`);
const epArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('dms', c.region, c.acct.id, `endpoint:${id}`);
const taskArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('dms', c.region, c.acct.id, `task:${id}`);

export function refreshDms(a: Account, region: string): DmsState {
  const s = dmsOf(a, region);
  for (const i of Object.values(s.instances)) {
    if (i.status === 'creating' && a.clock - i.stateAt >= CREATING_MS) i.status = 'available';
    if (i.status === 'deleting' && a.clock - i.stateAt >= 60000) delete s.instances[i.id];
  }
  for (const k of s.connections) if (k.status === 'testing' && a.clock - k.at >= TEST_MS) Object.assign(k, evaluateConnection(a, region, k));
  for (const t of Object.values(s.tasks)) advanceTask(a, region, t);
  return s;
}
tickers.push((a) => {
  for (const region of Object.keys(a.regions)) if (a.regions[region].dms) refreshDms(a, region);
});

const instView = (c: Pick<OpCtx, 'acct' | 'region'>, i: DmsInstance) => ({
  ReplicationInstanceIdentifier: i.id,
  ReplicationInstanceClass: i.cls,
  ReplicationInstanceStatus: i.status,
  AllocatedStorage: i.storage,
  InstanceCreateTime: iso(i.created) as string,
  VpcSecurityGroups: i.sgIds.map((id) => ({ VpcSecurityGroupId: id, Status: 'active' })),
  AvailabilityZone: i.az,
  ReplicationSubnetGroup: { ReplicationSubnetGroupIdentifier: i.subnetGroup, VpcId: i.vpcId, SubnetGroupStatus: 'Complete' },
  PreferredMaintenanceWindow: 'sat:04:30-sat:05:00',
  PendingModifiedValues: {},
  MultiAZ: i.multiAz,
  EngineVersion: '3.5.4',
  AutoMinorVersionUpgrade: true,
  ReplicationInstanceArn: instArn(c, i.id),
  ...(i.status !== 'creating' ? { ReplicationInstancePrivateIpAddresses: [`10.0.${Math.abs(md5(i.id).charCodeAt(0)) % 200}.${10 + (md5(i.id).charCodeAt(1) % 200)}`] } : {}),
  PubliclyAccessible: i.publiclyAccessible,
});

op('dms', 'create-replication-subnet-group', 'replication-subnet-group-identifier:s! replication-subnet-group-description:s! subnet-ids:l!', 'Crea el grupo de subredes donde DMS pondrá la instancia de replicación. Exige el rol `dms-vpc-role` (con `AmazonDMSVPCManagementRole`).', { res: () => '*' }, (c) => {
  const s = dmsOf(c.acct, c.region);
  const role = c.acct.iam.roles['dms-vpc-role'];
  const rarn = `arn:aws:iam::${c.acct.id}:role/dms-vpc-role`;
  if (!role || !roleTrusts(c.acct, rarn, 'dms.amazonaws.com') || !c.acct.iam.roles['dms-vpc-role'].attached.some((p) => p.endsWith('/AmazonDMSVPCManagementRole')))
    throw new AwsError('AccessDeniedFault', `The IAM Role ${rarn} is not configured properly. It must exist, trust dms.amazonaws.com and have the AmazonDMSVPCManagementRole policy attached.`, 400);
  const id = String(c.p.ReplicationSubnetGroupIdentifier);
  if (s.subnetGroups[id]) throw new AwsError('ResourceAlreadyExistsFault', `The subnet group ${id} already exists.`, 400);
  const r = regional(c.acct, c.region).ec2;
  const ids = toArr<string>(c.p.SubnetIds);
  for (const x of ids) if (!r.subnets[x]) throw new AwsError('InvalidSubnet', `The subnet ID '${x}' is not valid`, 400);
  if (new Set(ids.map((x) => r.subnets[x].AvailabilityZone)).size < 2) throw dmsErr.invalid('The replication subnet group needs subnets in at least 2 Availability Zones.');
  const vpcId = r.subnets[ids[0]].VpcId;
  s.subnetGroups[id] = { id, description: c.p.ReplicationSubnetGroupDescription, vpcId, subnetIds: ids };
  return { ReplicationSubnetGroup: { ReplicationSubnetGroupIdentifier: id, ReplicationSubnetGroupDescription: c.p.ReplicationSubnetGroupDescription, VpcId: vpcId, SubnetGroupStatus: 'Complete', Subnets: ids.map((x) => ({ SubnetIdentifier: x, SubnetAvailabilityZone: { Name: r.subnets[x].AvailabilityZone }, SubnetStatus: 'Active' })) } };
});

op('dms', 'create-replication-instance', 'replication-instance-identifier:s! replication-instance-class:s! allocated-storage:i vpc-security-group-ids:l replication-subnet-group-identifier:s multi-az:b publicly-accessible:b', 'Crea la instancia (un servidor gestionado) que ejecutará las tareas de migración: lee del origen y escribe en el destino.', { res: (c) => instArn(c, c.p.ReplicationInstanceIdentifier) }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const id = String(c.p.ReplicationInstanceIdentifier);
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(id)) throw dmsErr.invalid(`Invalid replication instance identifier: ${id}`);
  if (s.instances[id]) throw new AwsError('ResourceAlreadyExistsFault', `The replication instance ${id} already exists.`, 400);
  if (!DMS_CLASSES.includes(c.p.ReplicationInstanceClass)) throw dmsErr.invalid(`Invalid replication instance class ${c.p.ReplicationInstanceClass}. Valid: ${DMS_CLASSES.join(', ')}.`);
  const r = regional(c.acct, c.region).ec2;
  const sg = c.p.ReplicationSubnetGroupIdentifier ? s.subnetGroups[c.p.ReplicationSubnetGroupIdentifier] : undefined;
  if (c.p.ReplicationSubnetGroupIdentifier && !sg) throw dmsErr.notFound('Replication subnet group', c.p.ReplicationSubnetGroupIdentifier);
  const vpc = sg?.vpcId ?? Object.values(r.vpcs).find((v) => v.IsDefault)?.VpcId;
  if (!vpc) throw dmsErr.invalid('There is no default VPC: create a replication subnet group.');
  const sgs = toArr<string>(c.p.VpcSecurityGroupIds);
  for (const g of sgs) if (!r.securityGroups[g]) throw new AwsError('InvalidParameterValue', `Invalid security group, groupId=${g}`, 400);
  const defaultSg = Object.values(r.securityGroups).find((x) => x.VpcId === vpc && x.GroupName === 'default')?.GroupId;
  const subnets = sg?.subnetIds ?? Object.values(r.subnets).filter((x) => x.VpcId === vpc).map((x) => x.SubnetId);
  const i: DmsInstance = { id, arn: instArn(c, id), cls: c.p.ReplicationInstanceClass, storage: c.p.AllocatedStorage ?? 50, sgIds: sgs.length ? sgs : defaultSg ? [defaultSg] : [], subnetGroup: sg?.id ?? 'default', multiAz: !!c.p.MultiAz, publiclyAccessible: c.p.PubliclyAccessible !== false, vpcId: vpc, az: r.subnets[subnets[0]].AvailabilityZone, status: 'creating', stateAt: c.acct.clock, created: c.acct.clock };
  s.instances[id] = i;
  return { ReplicationInstance: instView(c, i) };
});

op('dms', 'describe-replication-instances', 'filters:f', 'Lista las instancias de replicación de DMS.', { res: () => '*', paginate: 'ReplicationInstances' }, (c) => ({ ReplicationInstances: Object.values(refreshDms(c.acct, c.region).instances).map((i) => instView(c, i)) }));

op('dms', 'delete-replication-instance', 'replication-instance-arn:s!', 'Borra una instancia de replicación (sin tareas asociadas).', { res: (c) => c.p.ReplicationInstanceArn }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const i = Object.values(s.instances).find((x) => x.arn === c.p.ReplicationInstanceArn);
  if (!i) throw dmsErr.notFound('Replication instance', c.p.ReplicationInstanceArn);
  if (Object.values(s.tasks).some((t) => t.instArn === i.arn)) throw dmsErr.state('The replication instance still has tasks: delete them first.');
  i.status = 'deleting';
  i.stateAt = c.acct.clock;
  return { ReplicationInstance: instView(c, i) };
});

// ───────────────────────── DMS: endpoints y conexiones ─────────────────────────

const DB_ENGINES = ['mysql', 'postgres', 'mariadb', 'aurora', 'aurora-postgresql', 'oracle', 'sqlserver', 'mongodb'];
const epView = (e: DmsEndpoint) => ({
  EndpointIdentifier: e.id,
  EndpointType: e.type.toUpperCase(),
  EngineName: e.engine,
  EngineDisplayName: e.engine,
  ...(e.username ? { Username: e.username } : {}),
  ...(e.server ? { ServerName: e.server, Port: e.port } : {}),
  ...(e.database ? { DatabaseName: e.database } : {}),
  Status: 'active',
  EndpointArn: e.arn,
  ...(e.s3 ? { S3Settings: { ServiceAccessRoleArn: e.s3.ServiceAccessRoleArn, BucketName: e.s3.BucketName, ...(e.s3.BucketFolder ? { BucketFolder: e.s3.BucketFolder } : {}) } } : {}),
  ...(e.ddbRole ? { DynamoDbSettings: { ServiceAccessRoleArn: e.ddbRole } } : {}),
});

op('dms', 'create-endpoint', 'endpoint-identifier:s! endpoint-type:s! engine-name:s! username:s password:s server-name:s port:i database-name:s s3-settings:j dynamo-db-settings:j', 'Define un origen o un destino de la migración: una base de datos (servidor, puerto y credenciales), un bucket de S3 o una tabla de DynamoDB (con el rol que usa DMS).', { res: (c) => epArn(c, c.p.EndpointIdentifier) }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const id = String(c.p.EndpointIdentifier);
  if (Object.values(s.endpoints).some((x) => x.id === id)) throw new AwsError('ResourceAlreadyExistsFault', `The endpoint ${id} already exists.`, 400);
  const type = String(c.p.EndpointType).toLowerCase();
  if (type !== 'source' && type !== 'target') throw dmsErr.invalid('EndpointType must be source or target.');
  const engine = String(c.p.EngineName);
  const e: DmsEndpoint = { id, arn: epArn(c, id), type, engine, created: c.acct.clock };
  if (DB_ENGINES.includes(engine)) {
    if (!c.p.ServerName || !c.p.Username || !c.p.Password) throw dmsErr.invalid(`A ${engine} endpoint needs --server-name, --username and --password.`);
    Object.assign(e, { server: c.p.ServerName, port: c.p.Port ?? 3306, username: c.p.Username, password: c.p.Password, database: c.p.DatabaseName });
  } else if (engine === 's3') {
    if (type === 'source') throw dmsErr.invalid('The simulator supports S3 only as a target.');
    const st = c.p.S3Settings as { BucketName?: string; ServiceAccessRoleArn?: string; BucketFolder?: string } | undefined;
    if (!st?.BucketName || !st.ServiceAccessRoleArn) throw dmsErr.invalid('An S3 endpoint needs --s3-settings BucketName=...,ServiceAccessRoleArn=...');
    e.s3 = { BucketName: st.BucketName, ServiceAccessRoleArn: st.ServiceAccessRoleArn, BucketFolder: st.BucketFolder };
  } else if (engine === 'dynamodb') {
    if (type === 'source') throw dmsErr.invalid('DynamoDB can only be a target.');
    const st = c.p.DynamoDbSettings as { ServiceAccessRoleArn?: string } | undefined;
    if (!st?.ServiceAccessRoleArn) throw dmsErr.invalid('A DynamoDB endpoint needs --dynamo-db-settings ServiceAccessRoleArn=...');
    e.ddbRole = st.ServiceAccessRoleArn;
  } else throw dmsErr.invalid(`Unsupported engine ${engine}. Valid: ${[...DB_ENGINES, 's3', 'dynamodb'].join(', ')}.`);
  s.endpoints[id] = e;
  return { Endpoint: epView(e) };
});

op('dms', 'describe-endpoints', 'filters:f', 'Lista los endpoints definidos.', { res: () => '*', paginate: 'Endpoints' }, (c) => ({ Endpoints: Object.values(refreshDms(c.acct, c.region).endpoints).map(epView) }));

const rdsByServer = (a: Account, region: string, server: string) => Object.values(rdsOf(a, region).instances).find((i) => endpointHost(a, region, i.DBInstanceIdentifier) === server);

function evaluateConnection(a: Account, region: string, k: DmsConnection): Partial<DmsConnection> {
  const s = dmsOf(a, region);
  const inst = Object.values(s.instances).find((i) => i.arn === k.instArn);
  const e = Object.values(s.endpoints).find((x) => x.arn === k.endpointArn);
  const fail = (m: string) => ({ status: 'failed' as const, failure: m });
  if (!inst || !e) return fail('Replication instance or endpoint no longer exists.');
  if (inst.status !== 'available') return fail('The replication instance is not available.');
  const ec2 = regional(a, region).ec2;
  if (e.s3) {
    if (!a.s3.buckets[e.s3.BucketName]) return fail(`Failed to connect to the bucket: ${e.s3.BucketName} does not exist.`);
    if (!roleTrusts(a, e.s3.ServiceAccessRoleArn, 'dms.amazonaws.com')) return fail(`The role ${e.s3.ServiceAccessRoleArn} cannot be assumed by dms.amazonaws.com.`);
    if (!roleCan(a, e.s3.ServiceAccessRoleArn, ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'], `arn:aws:s3:::${e.s3.BucketName}/x`)) return fail(`Access denied: the role needs s3:PutObject, s3:DeleteObject and s3:ListBucket on ${e.s3.BucketName}.`);
    return { status: 'successful' };
  }
  if (e.ddbRole) {
    if (!roleTrusts(a, e.ddbRole, 'dms.amazonaws.com')) return fail(`The role ${e.ddbRole} cannot be assumed by dms.amazonaws.com.`);
    if (!roleCan(a, e.ddbRole, ['dynamodb:PutItem', 'dynamodb:CreateTable', 'dynamodb:DescribeTable'], `arn:aws:dynamodb:${region}:${a.id}:table/x`)) return fail('Access denied: the role needs dynamodb:PutItem, CreateTable and DescribeTable.');
    return { status: 'successful' };
  }
  const db = rdsByServer(a, region, e.server ?? '');
  if (!db) return fail(`Failed to connect to the database at ${e.server}:${e.port}. Network error: the server is not reachable from the replication instance.`);
  const dbSgs = db.VpcSecurityGroupIds.map((id) => ec2.securityGroups[id]).filter(Boolean);
  const subnets = Object.values(ec2.subnets).filter((x) => x.VpcId === inst.vpcId);
  if (!subnets.some((x) => sgAllows(dbSgs, false, 'tcp', db.Port, probeIp(x.CidrBlock), inst.sgIds))) return fail(`Failed to connect to database. Connection timed out: the security group of ${db.DBInstanceIdentifier} does not allow the replication instance on port ${db.Port}.`);
  if (e.username !== db.MasterUsername || (db.pw !== undefined && e.password !== db.pw)) return fail(`Failed to connect to database. Access denied for user '${e.username}'.`);
  if (e.port !== undefined && e.port !== db.Port) return fail(`Failed to connect to the database at port ${e.port}: the database listens on ${db.Port}.`);
  return { status: 'successful' };
}

op('dms', 'test-connection', 'replication-instance-arn:s! endpoint-arn:s!', 'Comprueba (en unos segundos) que la instancia de replicación llega al endpoint: red, credenciales y permisos. Mira el resultado con `describe-connections`.', { res: () => '*' }, (c) => {
  const s = refreshDms(c.acct, c.region);
  if (!Object.values(s.instances).some((i) => i.arn === c.p.ReplicationInstanceArn)) throw dmsErr.notFound('Replication instance', c.p.ReplicationInstanceArn);
  if (!Object.values(s.endpoints).some((e) => e.arn === c.p.EndpointArn)) throw dmsErr.notFound('Endpoint', c.p.EndpointArn);
  s.connections = s.connections.filter((k) => !(k.instArn === c.p.ReplicationInstanceArn && k.endpointArn === c.p.EndpointArn));
  const k: DmsConnection = { instArn: c.p.ReplicationInstanceArn, endpointArn: c.p.EndpointArn, status: 'testing', at: c.acct.clock };
  s.connections.push(k);
  return { Connection: connView(s, k) };
});

const connView = (s: DmsState, k: DmsConnection) => {
  const e = Object.values(s.endpoints).find((x) => x.arn === k.endpointArn);
  return { ReplicationInstanceArn: k.instArn, EndpointArn: k.endpointArn, Status: k.status, ...(k.failure ? { LastFailureMessage: k.failure } : {}), EndpointIdentifier: e?.id, ReplicationInstanceIdentifier: Object.values(s.instances).find((i) => i.arn === k.instArn)?.id };
};

op('dms', 'describe-connections', 'filters:f', 'Resultado de las pruebas de conexión: `testing`, `successful` o `failed` (con el motivo).', { res: () => '*', paginate: 'Connections' }, (c) => {
  const s = refreshDms(c.acct, c.region);
  return { Connections: s.connections.map((k) => connView(s, k)) };
});

// ───────────────────────── DMS: tareas ─────────────────────────

const wildcard = (p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');

function mappedTables(db: { tables?: { schema: string; name: string; rows: number }[] }, mappings: string): DmsTask['tables'] {
  let rules: { 'rule-type': string; 'rule-action'?: string; 'object-locator'?: { 'schema-name': string; 'table-name': string } }[] = [];
  try {
    rules = (JSON.parse(mappings) as { rules?: typeof rules }).rules ?? [];
  } catch {
    return [];
  }
  const out: DmsTask['tables'] = [];
  for (const t of db.tables ?? []) {
    let included = false;
    for (const r of rules) {
      if (r['rule-type'] !== 'selection' || !r['object-locator']) continue;
      if (wildcard(r['object-locator']['schema-name']).test(t.schema) && wildcard(r['object-locator']['table-name']).test(t.name)) included = r['rule-action'] !== 'exclude';
    }
    if (included) out.push({ schema: t.schema, table: t.name, rows: t.rows });
  }
  return out;
}

const taskView = (s: DmsState, a: Account, t: DmsTask) => {
  const total = t.tables.reduce((n, x) => n + x.rows, 0);
  const loaded = t.startedAt !== undefined && t.type !== 'cdc' ? Math.min(total, Math.floor(((a.clock - t.startedAt - 30000) / 1000) * 400)) : 0;
  const pct = total ? Math.round((Math.max(0, loaded) / total) * 100) : 100;
  return {
    ReplicationTaskIdentifier: t.id,
    SourceEndpointArn: t.sourceArn,
    TargetEndpointArn: t.targetArn,
    ReplicationInstanceArn: t.instArn,
    MigrationType: t.type,
    TableMappings: t.mappings,
    Status: t.status,
    ...(t.stopReason ? { StopReason: t.stopReason } : {}),
    ...(t.lastFailure ? { LastFailureMessage: t.lastFailure } : {}),
    ReplicationTaskCreationDate: iso(t.created),
    ...(t.startedAt !== undefined ? { ReplicationTaskStartDate: iso(t.startedAt) } : {}),
    ReplicationTaskArn: t.arn,
    ReplicationTaskStats: { FullLoadProgressPercent: t.type === 'cdc' ? 0 : t.loaded ? 100 : pct, ElapsedTimeMillis: t.startedAt !== undefined ? a.clock - t.startedAt : 0, TablesLoaded: t.loaded ? t.tables.length : 0, TablesLoading: t.status === 'running' && !t.loaded && t.type !== 'cdc' ? t.tables.length : 0, TablesQueued: 0, TablesErrored: 0 },
  };
};

op('dms', 'create-replication-task', 'replication-task-identifier:s! source-endpoint-arn:s! target-endpoint-arn:s! replication-instance-arn:s! migration-type:s! table-mappings:s! replication-task-settings:s', 'Crea la tarea que mueve los datos: carga completa (`full-load`), solo cambios (`cdc`) o ambas (`full-load-and-cdc`). Las reglas de `--table-mappings` eligen qué tablas.', { res: (c) => taskArn(c, c.p.ReplicationTaskIdentifier) }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const id = String(c.p.ReplicationTaskIdentifier);
  if (s.tasks[id]) throw new AwsError('ResourceAlreadyExistsFault', `The task ${id} already exists.`, 400);
  const src = Object.values(s.endpoints).find((e) => e.arn === c.p.SourceEndpointArn);
  const dst = Object.values(s.endpoints).find((e) => e.arn === c.p.TargetEndpointArn);
  if (!src) throw dmsErr.notFound('Source endpoint', c.p.SourceEndpointArn);
  if (!dst) throw dmsErr.notFound('Target endpoint', c.p.TargetEndpointArn);
  if (src.type !== 'source' || dst.type !== 'target') throw dmsErr.invalid('The first endpoint must be a source and the second a target.');
  if (!Object.values(s.instances).some((i) => i.arn === c.p.ReplicationInstanceArn)) throw dmsErr.notFound('Replication instance', c.p.ReplicationInstanceArn);
  const type = String(c.p.MigrationType);
  if (!['full-load', 'cdc', 'full-load-and-cdc'].includes(type)) throw dmsErr.invalid('MigrationType must be full-load, cdc or full-load-and-cdc.');
  try {
    const m = JSON.parse(c.p.TableMappings) as { rules?: unknown[] };
    if (!Array.isArray(m.rules) || !m.rules.length) throw new Error('no rules');
  } catch {
    throw dmsErr.invalid('Invalid TableMappings: it must be a JSON document with at least one rule ({"rules":[{"rule-type":"selection",...}]}).');
  }
  const db = rdsByServer(c.acct, c.region, src.server ?? '');
  const t: DmsTask = { id, arn: taskArn(c, id), type: type as DmsTask['type'], sourceArn: src.arn, targetArn: dst.arn, instArn: c.p.ReplicationInstanceArn, mappings: c.p.TableMappings, status: 'ready', stateAt: c.acct.clock, tables: db ? mappedTables(db, c.p.TableMappings) : [], created: c.acct.clock };
  s.tasks[id] = t;
  return { ReplicationTask: taskView(s, c.acct, t) };
});

function failTask(a: Account, t: DmsTask, why: string): void {
  t.status = 'failed';
  t.lastFailure = why;
  t.stateAt = a.clock;
}

/** Comprobaciones al arrancar y progreso con el reloj virtual. */
function advanceTask(a: Account, region: string, t: DmsTask): void {
  if (t.status === 'starting' && a.clock - t.stateAt >= 30000) {
    t.status = 'running';
    t.stateAt = a.clock;
  }
  if (t.status === 'running' && t.startedAt !== undefined) {
    const total = t.tables.reduce((n, x) => n + x.rows, 0);
    const doneAt = t.startedAt + 30000 + Math.ceil(total / 400) * 1000;
    if (t.type !== 'cdc' && !t.loaded && a.clock >= doneAt) {
      t.loaded = true;
      landData(a, region, t);
      if (t.type === 'full-load') {
        t.status = 'stopped';
        t.stopReason = 'Stop Reason FULL_LOAD_ONLY_FINISHED';
        t.stateAt = a.clock;
      }
    }
  }
}

function landData(a: Account, region: string, t: DmsTask): void {
  const s = dmsOf(a, region);
  const dst = Object.values(s.endpoints).find((e) => e.arn === t.targetArn);
  if (!dst) return;
  for (const tb of t.tables) {
    const sample = Math.min(tb.rows, 5);
    if (dst.s3 && a.s3.buckets[dst.s3.BucketName]) {
      const key = `${dst.s3.BucketFolder ? dst.s3.BucketFolder.replace(/\/$/, '') + '/' : ''}${tb.schema}/${tb.table}/LOAD00000001.csv`;
      s3Put(a, getBucket(a, dst.s3.BucketName), key, Array.from({ length: sample }, (_, i) => `${i + 1},${tb.table}-${i + 1}`).join('\n') + '\n');
    } else if (dst.ddbRole) {
      const tables = tablesOf(a, region);
      if (!tables[tb.table]) {
        tables[tb.table] = { TableName: tb.table, KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], BillingMode: 'PAY_PER_REQUEST', GlobalSecondaryIndexes: [], LocalSecondaryIndexes: [], items: {}, created: a.clock - 60000, DeletionProtectionEnabled: false, Tags: [] };
      }
      const table = tables[tb.table];
      for (let i = 1; i <= sample; i++) {
        const item = { id: { S: String(i) }, origen: { S: `${tb.schema}.${tb.table}` } };
        ddbCommit(a, region, table, JSON.stringify([item.id]), undefined, item);
      }
    }
  }
}

op('dms', 'start-replication-task', 'replication-task-arn:s! start-replication-task-type:s!', 'Arranca la tarea. Antes comprueba las conexiones y, para CDC, que el origen registra los cambios (MySQL: `binlog_format=ROW` y copias automáticas; PostgreSQL: `rds.logical_replication=1`).', { res: (c) => c.p.ReplicationTaskArn }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn);
  if (!t) throw dmsErr.notFound('Replication task', c.p.ReplicationTaskArn);
  if (!['start-replication', 'resume-processing', 'reload-target'].includes(c.p.StartReplicationTaskType)) throw dmsErr.invalid('StartReplicationTaskType must be start-replication, resume-processing or reload-target.');
  if (t.status === 'running' || t.status === 'starting') throw dmsErr.state(`The task is already ${t.status}.`);
  t.loaded = false;
  t.lastFailure = undefined;
  t.stopReason = undefined;
  t.startedAt = c.acct.clock;
  t.stateAt = c.acct.clock;
  t.status = 'starting';
  const okConn = (arn: string) => s.connections.find((k) => k.instArn === t.instArn && k.endpointArn === arn)?.status === 'successful';
  const src = Object.values(s.endpoints).find((e) => e.arn === t.sourceArn);
  if (!okConn(t.sourceArn) || !okConn(t.targetArn)) {
    failTask(c.acct, t, `Task failed: the connection of the ${okConn(t.sourceArn) ? 'target' : 'source'} endpoint has not been tested successfully with this replication instance (run test-connection and check describe-connections).`);
    return { ReplicationTask: taskView(s, c.acct, t) };
  }
  if (t.type !== 'full-load' && src) {
    const db = rdsByServer(c.acct, c.region, src.server ?? '');
    if (db) {
      const mysql = db.Engine.includes('mysql') || db.Engine === 'mariadb';
      if (db.BackupRetentionPeriod === 0) failTask(c.acct, t, 'Task failed: change data capture needs automated backups on the source (BackupRetentionPeriod > 0) so that the database keeps its binary logs.');
      else if (mysql && effectiveParam(c.acct, c.region, db, 'binlog_format')?.value !== 'ROW') failTask(c.acct, t, `Task failed: the source must use binlog_format=ROW for CDC (it is ${effectiveParam(c.acct, c.region, db, 'binlog_format')?.value}). Change it in the parameter group and reboot if needed.`);
      else if (!mysql && effectiveParam(c.acct, c.region, db, 'rds.logical_replication')?.value !== '1') failTask(c.acct, t, 'Task failed: PostgreSQL CDC needs rds.logical_replication=1 (a static parameter: reboot the instance after changing it).');
    }
  }
  return { ReplicationTask: taskView(s, c.acct, t) };
});

op('dms', 'stop-replication-task', 'replication-task-arn:s!', 'Para la tarea (sin borrarla).', { res: (c) => c.p.ReplicationTaskArn }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn);
  if (!t) throw dmsErr.notFound('Replication task', c.p.ReplicationTaskArn);
  if (t.status !== 'running' && t.status !== 'starting') throw dmsErr.state(`The task is ${t.status}: only a running task can be stopped.`);
  t.status = 'stopped';
  t.stopReason = 'Stop Reason USER_REQUEST';
  t.stateAt = c.acct.clock;
  return { ReplicationTask: taskView(s, c.acct, t) };
});

op('dms', 'describe-replication-tasks', 'filters:f', 'Estado y progreso de las tareas (`ready`, `starting`, `running`, `stopped`, `failed`) y la causa del fallo si lo hay.', { res: () => '*', paginate: 'ReplicationTasks' }, (c) => {
  const s = refreshDms(c.acct, c.region);
  return { ReplicationTasks: Object.values(s.tasks).map((t) => taskView(s, c.acct, t)) };
});

op('dms', 'describe-table-statistics', 'replication-task-arn:s!', 'Filas cargadas por cada tabla de la tarea.', { res: (c) => c.p.ReplicationTaskArn }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn);
  if (!t) throw dmsErr.notFound('Replication task', c.p.ReplicationTaskArn);
  return { ReplicationTaskArn: t.arn, TableStatistics: t.tables.map((x) => ({ SchemaName: x.schema, TableName: x.table, Inserts: t.loaded ? x.rows : 0, Deletes: 0, Updates: 0, Ddls: 0, FullLoadRows: t.loaded ? x.rows : 0, TableState: t.loaded ? 'Table completed' : t.status === 'running' ? 'Table loading' : 'Before load' })) };
});

op('dms', 'delete-replication-task', 'replication-task-arn:s!', 'Borra una tarea parada.', { res: (c) => c.p.ReplicationTaskArn }, (c) => {
  const s = refreshDms(c.acct, c.region);
  const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn);
  if (!t) throw dmsErr.notFound('Replication task', c.p.ReplicationTaskArn);
  if (t.status === 'running' || t.status === 'starting') throw dmsErr.state('Stop the task before deleting it.');
  delete s.tasks[t.id];
  return { ReplicationTask: taskView(s, c.acct, t) };
});

const WAITERS: Record<string, (c: OpCtx, s: DmsState) => boolean> = {
  'replication-instance-available': (_c, s) => Object.values(s.instances).length > 0 && Object.values(s.instances).every((x) => x.status === 'available'),
  'test-connection-succeeds': (c, s) => {
    const k = s.connections.find((x) => (!c.p.ReplicationInstanceArn || x.instArn === c.p.ReplicationInstanceArn) && (!c.p.EndpointArn || x.endpointArn === c.p.EndpointArn));
    if (!k) throw dmsErr.notFound('Connection', c.p.EndpointArn ?? '');
    if (k.status === 'failed') throw new AwsError('WaiterError', `Waiter TestConnectionSucceeds failed: ${k.failure}`, 255);
    return k.status === 'successful';
  },
  'replication-task-ready': (_c, s) => Object.values(s.tasks).every((t) => t.status === 'ready'),
  'replication-task-running': (c, s) => {
    const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn || !c.p.ReplicationTaskArn);
    if (t?.status === 'failed') throw new AwsError('WaiterError', `Waiter ReplicationTaskRunning failed: ${t.lastFailure}`, 255);
    return t?.status === 'running';
  },
  'replication-task-stopped': (c, s) => {
    const t = Object.values(s.tasks).find((x) => x.arn === c.p.ReplicationTaskArn || !c.p.ReplicationTaskArn);
    if (t?.status === 'failed') throw new AwsError('WaiterError', `Waiter ReplicationTaskStopped failed: ${t.lastFailure}`, 255);
    return t?.status === 'stopped';
  },
};

op('dms', 'wait', 'waiter:s! replication-instance-arn:s endpoint-arn:s replication-task-arn:s filters:f', 'Espera a una condición (replication-instance-available, test-connection-succeeds, replication-task-running, replication-task-stopped…).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = WAITERS[c.p.Waiter];
  if (!w) throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: ${Object.keys(WAITERS).join(', ')}`);
  for (let k = 0; k < 90; k++) {
    if (w(c, refreshDms(c.acct, c.region))) return undefined;
    c.acct.clock += 10000;
  }
  throw new AwsError('WaiterError', `Waiter ${c.p.Waiter} failed: Max attempts exceeded`);
});

// ───────────────────────── DataSync ─────────────────────────

const dsArn = (c: Pick<OpCtx, 'acct' | 'region'>, kind: string, id: string) => mkArn('datasync', c.region, c.acct.id, `${kind}/${id}`);
const dsId = (a: Account, k: string, n = 17) => md5(`${a.id}:${k}`).slice(0, n);
const dsErr = (m: string) => new AwsError('InvalidRequestException', m, 400);

op('datasync', 'list-agents', 'max-results:i', 'Lista los agentes (máquinas virtuales que instalas en tu centro de datos para leer y escribir en tus almacenamientos locales).', { res: () => '*', paginate: 'Agents' }, (c) => ({ Agents: Object.values(dsOf(c.acct, c.region).agents).map((x) => ({ AgentArn: x.arn, Name: x.name, Status: x.status })) }));

function locationTest(c: OpCtx, bucket: string, prefix: string, role: string): void {
  const b = c.acct.s3.buckets[bucket];
  if (!b) throw dsErr(`DataSync location access test failed: the bucket ${bucket} does not exist.`);
  if (!roleTrusts(c.acct, role, 'datasync.amazonaws.com')) throw dsErr(`DataSync location access test failed: the role ${role} cannot be assumed by datasync.amazonaws.com.`);
  for (const [a, r] of [['s3:ListBucket', `arn:aws:s3:::${bucket}`], ['s3:GetBucketLocation', `arn:aws:s3:::${bucket}`], ['s3:PutObject', `arn:aws:s3:::${bucket}/${prefix}x`], ['s3:GetObject', `arn:aws:s3:::${bucket}/${prefix}x`]] as const)
    if (!roleCan(c.acct, role, [a], r)) throw dsErr(`DataSync location access test failed: could not perform ${a} on ${r}. Access denied. Ensure the bucket access role has ${a} permission.`);
}

op('datasync', 'create-location-s3', 's3-bucket-arn:s! s3-config:j! subdirectory:s s3-storage-class:s', 'Crea una ubicación en S3. DataSync comprueba al momento que el rol (`BucketAccessRoleArn`, con confianza en `datasync.amazonaws.com`) puede listar, leer y escribir en el bucket.', { res: () => '*' }, (c) => {
  const bucket = String(c.p.S3BucketArn).replace('arn:aws:s3:::', '').split('/')[0];
  const role = (c.p.S3Config as { BucketAccessRoleArn?: string } | undefined)?.BucketAccessRoleArn;
  if (!role) throw dsErr('S3Config needs BucketAccessRoleArn=...');
  const prefix = String(c.p.Subdirectory ?? '').replace(/^\/+|\/+$/g, '');
  locationTest(c, bucket, prefix ? prefix + '/' : '', role);
  const arn = dsArn(c, 'location', 'loc-' + dsId(c.acct, `s3:${bucket}:${prefix}`));
  const l: DsLocation = { arn, kind: 's3', uri: `s3://${bucket}/${prefix}`, bucket, prefix, roleArn: role };
  dsOf(c.acct, c.region).locations[arn] = l;
  return { LocationArn: arn };
});

op('datasync', 'create-location-nfs', 'server-hostname:s! subdirectory:s! on-prem-config:j!', 'Crea una ubicación NFS de tu oficina; un agente ONLINE se encarga de leerla.', { res: () => '*' }, (c) => {
  const s = dsOf(c.acct, c.region);
  const agents = toArr<string>((c.p.OnPremConfig as { AgentArns?: string | string[] } | undefined)?.AgentArns);
  if (!agents.length) throw dsErr('OnPremConfig needs AgentArns=...');
  for (const a of agents) {
    const ag = s.agents[a];
    if (!ag) throw dsErr(`Agent ${a} was not found.`);
    if (ag.status !== 'ONLINE') throw dsErr(`Agent ${a} is not ONLINE: check that the virtual machine is running and can reach AWS.`);
  }
  const key = `${c.p.ServerHostname}:${c.p.Subdirectory}`;
  const arn = dsArn(c, 'location', 'loc-' + dsId(c.acct, `nfs:${key}`));
  s.locations[arn] = { arn, kind: 'nfs', uri: `nfs://${c.p.ServerHostname}${c.p.Subdirectory}`, agentArns: agents, server: c.p.ServerHostname, subdir: c.p.Subdirectory };
  return { LocationArn: arn };
});

op('datasync', 'list-locations', 'max-results:i', 'Lista las ubicaciones.', { res: () => '*', paginate: 'Locations' }, (c) => ({ Locations: Object.values(dsOf(c.acct, c.region).locations).map((l) => ({ LocationArn: l.arn, LocationUri: l.uri })) }));

op('datasync', 'create-task', 'source-location-arn:s! destination-location-arn:s! name:s options:j includes:f excludes:f schedule:j', 'Crea la tarea de copia entre dos ubicaciones. `--options` (`OverwriteMode`, `TransferMode`, `PreserveDeletedFiles`, `VerifyMode`) y `--includes`/`--excludes` (`FilterType=SIMPLE_PATTERN,Value=/ventas*|/logs*`) controlan qué y cómo.', { res: () => '*' }, (c) => {
  const s = dsOf(c.acct, c.region);
  if (!s.locations[c.p.SourceLocationArn]) throw dsErr(`Location ${c.p.SourceLocationArn} was not found.`);
  if (!s.locations[c.p.DestinationLocationArn]) throw dsErr(`Location ${c.p.DestinationLocationArn} was not found.`);
  if (s.locations[c.p.DestinationLocationArn].kind !== 's3') throw dsErr('The simulator supports S3 as the destination.');
  const arn = dsArn(c, 'task', 'task-' + dsId(c.acct, `task:${c.p.SourceLocationArn}:${c.p.DestinationLocationArn}:${c.p.Name ?? ''}`));
  const split = (l: unknown) => toArr<{ FilterType?: string; Value?: string }>(l as never).flatMap((f) => String(f.Value ?? '').split('|'));
  const opts = { OverwriteMode: 'ALWAYS', TransferMode: 'CHANGED', PreserveDeletedFiles: 'PRESERVE', VerifyMode: 'POINT_IN_TIME_CONSISTENT', ...((c.p.Options ?? {}) as Record<string, string>) };
  for (const [k, ok] of [['OverwriteMode', ['ALWAYS', 'NEVER']], ['TransferMode', ['CHANGED', 'ALL']], ['PreserveDeletedFiles', ['PRESERVE', 'REMOVE']]] as const) if (!ok.includes(opts[k] as never)) throw dsErr(`Invalid ${k} ${opts[k]}: use ${ok.join(' or ')}.`);
  const t: DsTask = { arn, name: c.p.Name ?? arn.split('/').pop()!, src: c.p.SourceLocationArn, dst: c.p.DestinationLocationArn, options: opts, includes: split(c.p.Includes), excludes: split(c.p.Excludes), ...(c.p.Schedule ? { schedule: (c.p.Schedule as { ScheduleExpression?: string }).ScheduleExpression } : {}) };
  s.tasks[arn] = t;
  return { TaskArn: arn };
});

const matchesFilter = (patterns: string[], path: string) => patterns.some((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test('/' + path));

/** Lo que hay en el origen: archivos (ruta relativa → contenido). */
function sourceFiles(c: Pick<OpCtx, 'acct'>, l: DsLocation): Record<string, string> {
  if (l.kind === 'nfs') return { ...(c.acct.onpremShares?.[`${l.server}:${l.subdir}`] ?? {}) };
  const b = c.acct.s3.buckets[l.bucket!];
  const out: Record<string, string> = {};
  if (b) for (const k of s3Keys(b)) if (k.startsWith(l.prefix ? l.prefix + '/' : '')) out[k.slice(l.prefix ? l.prefix.length + 1 : 0)] = s3Current(b, k)!.body;
  return out;
}

op('datasync', 'start-task-execution', 'task-arn:s! override-options:j', 'Lanza la copia. Pasa por `LAUNCHING`, `PREPARING`, `TRANSFERRING` y `VERIFYING` hasta `SUCCESS` (o `ERROR`).', { res: () => '*' }, (c) => {
  const s = dsOf(c.acct, c.region);
  const t = s.tasks[c.p.TaskArn];
  if (!t) throw dsErr(`Task ${c.p.TaskArn} was not found.`);
  const src = s.locations[t.src];
  const dst = s.locations[t.dst];
  const arn = dsArn(c, `task/${t.arn.split('/').pop()}/execution`, 'exec-' + dsId(c.acct, `exec:${t.arn}:${c.acct.clock}`));
  const ex: DsExecution = { arn, taskArn: t.arn, startedAt: c.acct.clock, status: 'LAUNCHING', files: 0, bytes: 0 };
  s.executions[arn] = ex;
  const opts = { ...t.options, ...((c.p.OverrideOptions ?? {}) as Record<string, string>) };
  const agentOnline = src.kind !== 'nfs' || (src.agentArns ?? []).some((a) => s.agents[a]?.status === 'ONLINE');
  if (!agentOnline) {
    ex.status = 'ERROR';
    ex.error = 'The agent is offline: DataSync cannot read the NFS share.';
    return { TaskExecutionArn: arn };
  }
  try {
    locationTest(c, dst.bucket!, dst.prefix ? dst.prefix + '/' : '', dst.roleArn!);
    if (src.kind === 's3') locationTest(c, src.bucket!, src.prefix ? src.prefix + '/' : '', src.roleArn!);
  } catch (e) {
    ex.status = 'ERROR';
    ex.error = (e as AwsError).message;
    return { TaskExecutionArn: arn };
  }
  const files = sourceFiles(c, src);
  const dstBucket = getBucket(c.acct, dst.bucket!);
  const dpre = dst.prefix ? dst.prefix + '/' : '';
  for (const [path, body] of Object.entries(files)) {
    if (t.includes.length && !matchesFilter(t.includes, path)) continue;
    if (matchesFilter(t.excludes, path)) continue;
    const cur = s3Current(dstBucket, dpre + path);
    if (cur && opts.OverwriteMode === 'NEVER') continue;
    if (cur && opts.TransferMode === 'CHANGED' && cur.body === body) continue;
    s3Put(c.acct, dstBucket, dpre + path, body);
    ex.files++;
    ex.bytes += body.length;
  }
  if (opts.PreserveDeletedFiles === 'REMOVE') for (const k of s3Keys(dstBucket)) if (k.startsWith(dpre) && !(k.slice(dpre.length) in files)) s3Delete(c.acct, dstBucket, k);
  ex.status = 'SUCCESS';
  return { TaskExecutionArn: arn };
});

op('datasync', 'describe-task-execution', 'task-execution-arn:s!', 'Estado y estadísticas de una ejecución: archivos y bytes copiados.', { res: () => '*' }, (c) => {
  const ex = dsOf(c.acct, c.region).executions[c.p.TaskExecutionArn];
  if (!ex) throw dsErr(`Task execution ${c.p.TaskExecutionArn} was not found.`);
  const age = c.acct.clock - ex.startedAt;
  const status = ex.status === 'SUCCESS' && age < 60000 ? (age < 15000 ? 'LAUNCHING' : age < 30000 ? 'PREPARING' : age < 45000 ? 'TRANSFERRING' : 'VERIFYING') : ex.status;
  return { TaskExecutionArn: ex.arn, Status: status, EstimatedFilesToTransfer: ex.files, EstimatedBytesToTransfer: ex.bytes, FilesTransferred: status === 'SUCCESS' ? ex.files : 0, BytesTransferred: status === 'SUCCESS' ? ex.bytes : 0, StartTime: ex.startedAt / 1000, ...(ex.error ? { Result: { ErrorCode: 'AccessDenied', ErrorDetail: ex.error } } : {}) };
});

op('datasync', 'list-task-executions', 'task-arn:s max-results:i', 'Lista las ejecuciones de una tarea.', { res: () => '*', paginate: 'TaskExecutions' }, (c) => ({ TaskExecutions: Object.values(dsOf(c.acct, c.region).executions).filter((x) => !c.p.TaskArn || x.taskArn === c.p.TaskArn).map((x) => ({ TaskExecutionArn: x.arn, Status: x.status })) }));

op('datasync', 'list-tasks', 'max-results:i', 'Lista las tareas de copia.', { res: () => '*', paginate: 'Tasks' }, (c) => ({ Tasks: Object.values(dsOf(c.acct, c.region).tasks).map((t) => ({ TaskArn: t.arn, Name: t.name, Status: 'AVAILABLE' })) }));
