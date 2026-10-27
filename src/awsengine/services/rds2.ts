/** RDS y Aurora a fondo: grupos de parámetros (con reinicio pendiente), Aurora Serverless v2, RDS Proxy y recuperación a un momento dado. */
import { regional } from '../account';
import { sgAllows } from '../net';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, DbInstance, DbParamGroup, DbProxy, Tag } from '../types';
import { iso, toArr } from '../util';
import { roleCan, roleTrusts } from './flowlogs';
import { DB_CLASSES, E, arnOf, checkId, checkScaling, clusterView, endpointHost, instanceView, rdsOf, refreshRds } from './rds';
import { findSecret } from './secrets';

const PROXY_CREATING_MS = 180000;

// ───────────────────────── parámetros ─────────────────────────

interface ParamDef {
  name: string;
  /** Valor por defecto: número o fórmula que depende de la memoria de la clase. */
  def: string | ((memBytes: number) => number);
  apply: 'static' | 'dynamic';
  type: 'integer' | 'boolean' | 'string';
  desc: string;
}

const MYSQL: ParamDef[] = [
  { name: 'max_connections', def: (m) => Math.floor(m / 12582880), apply: 'dynamic', type: 'integer', desc: 'Número máximo de conexiones simultáneas permitidas.' },
  { name: 'slow_query_log', def: '0', apply: 'dynamic', type: 'boolean', desc: 'Registra las consultas lentas.' },
  { name: 'long_query_time', def: '10', apply: 'dynamic', type: 'integer', desc: 'Segundos a partir de los cuales una consulta es «lenta».' },
  { name: 'general_log', def: '0', apply: 'dynamic', type: 'boolean', desc: 'Registra todas las consultas (cuidado con el rendimiento).' },
  { name: 'character_set_server', def: 'utf8mb4', apply: 'dynamic', type: 'string', desc: 'Juego de caracteres del servidor.' },
  { name: 'time_zone', def: 'UTC', apply: 'dynamic', type: 'string', desc: 'Zona horaria de la base de datos.' },
  { name: 'wait_timeout', def: '28800', apply: 'dynamic', type: 'integer', desc: 'Segundos que espera el servidor a una conexión inactiva.' },
  { name: 'max_allowed_packet', def: '67108864', apply: 'dynamic', type: 'integer', desc: 'Tamaño máximo de un paquete.' },
  { name: 'innodb_buffer_pool_size', def: (m) => Math.floor((m * 3) / 4), apply: 'dynamic', type: 'integer', desc: 'Memoria para la caché de datos e índices de InnoDB.' },
  { name: 'binlog_format', def: 'MIXED', apply: 'dynamic', type: 'string', desc: 'Formato del registro binario (necesario para las réplicas).' },
  { name: 'performance_schema', def: '0', apply: 'static', type: 'boolean', desc: 'Activa el esquema de rendimiento (hay que reiniciar).' },
  { name: 'skip_name_resolve', def: '1', apply: 'static', type: 'boolean', desc: 'No resuelve nombres de host de los clientes.' },
  { name: 'log_bin_trust_function_creators', def: '0', apply: 'dynamic', type: 'boolean', desc: 'Permite crear funciones y disparadores sin privilegio SUPER.' },
];

const POSTGRES: ParamDef[] = [
  { name: 'max_connections', def: (m) => Math.min(Math.floor(m / 9531392), 5000), apply: 'static', type: 'integer', desc: 'Número máximo de conexiones simultáneas (estático: exige reiniciar).' },
  { name: 'shared_buffers', def: (m) => Math.floor(m / 32768), apply: 'static', type: 'integer', desc: 'Memoria compartida para caché de páginas (en bloques de 8 KB).' },
  { name: 'work_mem', def: '4096', apply: 'dynamic', type: 'integer', desc: 'Memoria (KB) por operación de ordenación o hash.' },
  { name: 'log_min_duration_statement', def: '-1', apply: 'dynamic', type: 'integer', desc: 'Registra las consultas que tardan más de estos milisegundos (-1 = desactivado).' },
  { name: 'log_statement', def: 'none', apply: 'dynamic', type: 'string', desc: 'Qué sentencias se registran (none, ddl, mod, all).' },
  { name: 'statement_timeout', def: '0', apply: 'dynamic', type: 'integer', desc: 'Milisegundos máximos por sentencia (0 = sin límite).' },
  { name: 'idle_in_transaction_session_timeout', def: '0', apply: 'dynamic', type: 'integer', desc: 'Cierra sesiones paradas con una transacción abierta.' },
  { name: 'rds.force_ssl', def: '0', apply: 'dynamic', type: 'boolean', desc: 'Obliga a conectar con TLS.' },
  { name: 'rds.logical_replication', def: '0', apply: 'static', type: 'boolean', desc: 'Activa la replicación lógica (necesaria para CDC con DMS). Estático: exige reiniciar.' },
  { name: 'shared_preload_libraries', def: 'pg_stat_statements', apply: 'static', type: 'string', desc: 'Extensiones cargadas al arrancar (estático).' },
];

const catalogFor = (family: string): ParamDef[] => (family.includes('postgres') ? POSTGRES : MYSQL);
const FAMILIES = ['mysql8.0', 'mariadb10.11', 'postgres16', 'aurora-mysql8.0', 'aurora-postgresql16'];

const memOf = (cls: string) => (DB_CLASSES[cls]?.memGiB ?? 1) * 1024 ** 3;
const familyOfEngine = (i: DbInstance) => (i.Engine.startsWith('aurora') ? (i.Engine === 'aurora-postgresql' ? 'aurora-postgresql16' : 'aurora-mysql8.0') : i.Engine === 'postgres' ? 'postgres16' : i.Engine === 'mariadb' ? 'mariadb10.11' : 'mysql8.0');

/** Valor que tiene en este momento una instancia para un parámetro (el aplicado, o el de fábrica). */
export function effectiveParam(a: Account, region: string, i: DbInstance, name: string): { value: string; source: 'grupo' | 'fábrica'; pending?: string } | undefined {
  const def = catalogFor(familyOfEngine(i)).find((p) => p.name === name);
  if (!def) return undefined;
  const factory = String(typeof def.def === 'function' ? def.def(memOf(i.DBInstanceClass)) : def.def);
  const group = i.paramGroup ? rdsOf(a, region).paramGroups?.[i.paramGroup]?.params[name] : undefined;
  const applied = i.applied?.[name];
  const value = applied ?? factory;
  return { value, source: applied !== undefined ? 'grupo' : 'fábrica', ...(group && group.value !== value ? { pending: group.value } : {}) };
}

const groupsOf = (a: Account, region: string) => (rdsOf(a, region).paramGroups ??= {});

const pgView = (c: OpCtx, name: string, family: string, description: string) => ({ DBParameterGroupName: name, DBParameterGroupFamily: family, Description: description, DBParameterGroupArn: arnOf(c, 'pg', name) });

op('rds', 'create-db-parameter-group', 'db-parameter-group-name:s! db-parameter-group-family:s! description:s! tags:t', 'Crea un grupo de parámetros propio (los `default.*` no se pueden modificar). Para usarlo hay que asociarlo a la instancia.', { res: (c) => arnOf(c, 'pg', c.p.DbParameterGroupName) }, (c) => {
  const name = String(c.p.DbParameterGroupName);
  checkId(name, 'DB Parameter Group');
  if (name.startsWith('default.')) throw E.invalid('The name default.* is reserved for the default parameter groups.');
  if (!FAMILIES.includes(c.p.DbParameterGroupFamily)) throw E.invalid(`Parameter group family ${c.p.DbParameterGroupFamily} is not valid. Valid families: ${FAMILIES.join(', ')}.`);
  const all = groupsOf(c.acct, c.region);
  if (all[name]) throw new AwsError('DBParameterGroupAlreadyExists', `Parameter group ${name} already exists`, 400);
  all[name] = { name, family: c.p.DbParameterGroupFamily, description: c.p.Description, params: {} };
  return { DBParameterGroup: pgView(c, name, c.p.DbParameterGroupFamily, c.p.Description) };
});

op('rds', 'describe-db-parameter-groups', 'db-parameter-group-name:s', 'Lista los grupos de parámetros (los de fábrica `default.*` y los tuyos).', { res: () => 'arn:aws:rds:*:*:pg:*', paginate: 'DBParameterGroups' }, (c) => {
  const mine = Object.values(groupsOf(c.acct, c.region)).map((g) => pgView(c, g.name, g.family, g.description));
  const defaults = FAMILIES.map((f) => pgView(c, `default.${f}`, f, `Default parameter group for ${f}`));
  const all = [...defaults, ...mine];
  if (c.p.DbParameterGroupName && !all.some((g) => g.DBParameterGroupName === c.p.DbParameterGroupName)) throw new AwsError('DBParameterGroupNotFound', `DBParameterGroup not found: ${c.p.DbParameterGroupName}`, 404);
  return { DBParameterGroups: all.filter((g) => !c.p.DbParameterGroupName || g.DBParameterGroupName === c.p.DbParameterGroupName) };
});

const findGroup = (c: OpCtx, name: string): DbParamGroup => {
  if (name.startsWith('default.')) throw new AwsError('InvalidDBParameterGroupState', `You cannot modify the default parameter group ${name}.`, 400);
  const g = groupsOf(c.acct, c.region)[name];
  if (!g) throw new AwsError('DBParameterGroupNotFound', `DBParameterGroup not found: ${name}`, 404);
  return g;
};

op('rds', 'modify-db-parameter-group', 'db-parameter-group-name:s! parameters:f!', 'Cambia parámetros de un grupo. Los dinámicos se pueden aplicar ya (`ApplyMethod=immediate`); los estáticos exigen `pending-reboot` y un reinicio de la instancia.', { res: (c) => arnOf(c, 'pg', c.p.DbParameterGroupName) }, (c) => {
  const g = findGroup(c, String(c.p.DbParameterGroupName));
  const catalog = catalogFor(g.family);
  const list = toArr<{ ParameterName: string; ParameterValue: string; ApplyMethod: string }>(c.p.Parameters);
  for (const p of list) {
    const def = catalog.find((x) => x.name === p.ParameterName);
    if (!def) throw E.invalid(`Could not find parameter with name: ${p.ParameterName}`);
    if (p.ParameterValue === undefined || p.ApplyMethod === undefined) throw E.invalid('Each parameter needs ParameterName, ParameterValue and ApplyMethod (immediate or pending-reboot).');
    if (!['immediate', 'pending-reboot'].includes(p.ApplyMethod)) throw E.invalid(`Invalid ApplyMethod ${p.ApplyMethod}: use immediate or pending-reboot.`);
    if (p.ApplyMethod === 'immediate' && def.apply === 'static') throw E.combo("Only parameters with ApplyType of 'dynamic' can be applied immediately.");
    if (def.type === 'integer' && !/^-?\d+$/.test(String(p.ParameterValue))) throw E.invalid(`Invalid value for parameter ${p.ParameterName}: ${p.ParameterValue} (expected an integer).`);
    if (def.type === 'boolean' && !['0', '1'].includes(String(p.ParameterValue))) throw E.invalid(`Invalid value for parameter ${p.ParameterName}: ${p.ParameterValue} (expected 0 or 1).`);
  }
  const s = rdsOf(c.acct, c.region);
  for (const p of list) {
    g.params[p.ParameterName] = { value: String(p.ParameterValue), apply: p.ApplyMethod as 'immediate' | 'pending-reboot' };
    if (p.ApplyMethod === 'immediate') for (const i of Object.values(s.instances)) if (i.paramGroup === g.name) (i.applied ??= {})[p.ParameterName] = String(p.ParameterValue);
  }
  return { DBParameterGroupName: g.name };
});

op('rds', 'describe-db-parameters', 'db-parameter-group-name:s! source:s', 'Muestra los parámetros de un grupo: valor, si es estático o dinámico y de dónde viene el valor (`user` o `engine-default`).', { res: () => 'arn:aws:rds:*:*:pg:*', paginate: 'Parameters' }, (c) => {
  const name = String(c.p.DbParameterGroupName);
  const g = name.startsWith('default.') ? undefined : groupsOf(c.acct, c.region)[name];
  const family = name.startsWith('default.') ? name.slice(8) : g?.family;
  if (!family || (!name.startsWith('default.') && !g)) throw new AwsError('DBParameterGroupNotFound', `DBParameterGroup not found: ${name}`, 404);
  const out = catalogFor(family).map((d) => {
    const u = g?.params[d.name];
    return {
      ParameterName: d.name,
      ParameterValue: u?.value ?? (typeof d.def === 'function' ? (d.name === 'max_connections' ? (family.includes('postgres') ? 'LEAST({DBInstanceClassMemory/9531392},5000)' : '{DBInstanceClassMemory/12582880}') : d.name === 'shared_buffers' ? '{DBInstanceClassMemory/32768}' : '{DBInstanceClassMemory*3/4}') : d.def),
      Description: d.desc,
      Source: u ? 'user' : 'engine-default',
      ApplyType: d.apply,
      DataType: d.type,
      IsModifiable: true,
      ...(u ? { ApplyMethod: u.apply } : {}),
    };
  });
  return { Parameters: out.filter((x) => !c.p.Source || x.Source === c.p.Source) };
});

op('rds', 'reset-db-parameter-group', 'db-parameter-group-name:s! reset-all-parameters:b parameters:f', 'Devuelve parámetros a su valor de fábrica.', { res: (c) => arnOf(c, 'pg', c.p.DbParameterGroupName) }, (c) => {
  const g = findGroup(c, String(c.p.DbParameterGroupName));
  if (c.p.ResetAllParameters) g.params = {};
  else for (const p of toArr<{ ParameterName: string }>(c.p.Parameters)) delete g.params[p.ParameterName];
  return { DBParameterGroupName: g.name };
});

op('rds', 'delete-db-parameter-group', 'db-parameter-group-name:s!', 'Borra un grupo de parámetros que ninguna instancia use.', { res: (c) => arnOf(c, 'pg', c.p.DbParameterGroupName) }, (c) => {
  const g = findGroup(c, String(c.p.DbParameterGroupName));
  if (Object.values(rdsOf(c.acct, c.region).instances).some((i) => i.paramGroup === g.name)) throw new AwsError('InvalidDBParameterGroupState', 'One or more database instances are still members of this parameter group, so the group cannot be deleted.', 400);
  delete groupsOf(c.acct, c.region)[g.name];
  return undefined;
});

/** `_check dbparam --instance db --name max_connections`: valor que tiene aplicado la instancia (y el pendiente de reinicio, si lo hay). */
op('_check', 'dbparam', 'instance:s! name:s!', 'Valor aplicado de un parámetro en una instancia de RDS (y el pendiente de reinicio).', { global: true, authz: false, anon: true }, (c) => {
  for (const region of Object.keys(c.acct.regions)) {
    const i = rdsOf(c.acct, region).instances[c.p.Instance];
    if (!i) continue;
    const v = effectiveParam(c.acct, region, i, c.p.Name);
    if (!v) throw new AwsError('InvalidParameterValue', `Parámetro desconocido: ${c.p.Name}`);
    return { Value: v.value, Source: v.source, Pending: v.pending ?? null };
  }
  throw E.inst(c.p.Instance);
});

// ───────────────────────── Aurora ─────────────────────────

op('rds', 'modify-db-cluster', 'db-cluster-identifier:s! serverless-v2-scaling-configuration:j backup-retention-period:i deletion-protection:b master-user-password:s apply-immediately:b vpc-security-group-ids:l', 'Cambia un clúster de Aurora: capacidad de Serverless v2 (ACU mínima y máxima), copias, protección contra borrado…', { res: (c) => arnOf(c, 'cluster', c.p.DbClusterIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const k = s.clusters[c.p.DbClusterIdentifier];
  if (!k) throw E.cluster(c.p.DbClusterIdentifier);
  if (c.p.ServerlessV2ScalingConfiguration) k.scaling = checkScaling(c.p.ServerlessV2ScalingConfiguration);
  if (c.p.BackupRetentionPeriod !== undefined) {
    if (c.p.BackupRetentionPeriod < 1 || c.p.BackupRetentionPeriod > 35) throw E.invalid('Invalid backup retention period for an Aurora cluster. Must be a value between 1 and 35.');
    k.BackupRetentionPeriod = c.p.BackupRetentionPeriod;
  }
  if (c.p.DeletionProtection !== undefined) k.DeletionProtection = c.p.DeletionProtection;
  if (c.p.MasterUserPassword) k.pw = c.p.MasterUserPassword;
  return { DBCluster: clusterView(c, k) };
});

// ───────────────────────── recuperación a un momento dado ─────────────────────────

op('rds', 'restore-db-instance-to-point-in-time', 'source-db-instance-identifier:s! target-db-instance-identifier:s! restore-time:s use-latest-restorable-time:b db-instance-class:s multi-az:b publicly-accessible:b', 'Crea una instancia NUEVA con el estado que tenía la original en un segundo concreto (hace falta que tenga copias automáticas). Nunca sobrescribe la original.', { res: (c) => arnOf(c, 'db', c.p.SourceDbInstanceIdentifier) }, (c) => {
  const s = refreshRds(c.acct, c.region);
  const src = s.instances[c.p.SourceDbInstanceIdentifier];
  if (!src) throw E.inst(c.p.SourceDbInstanceIdentifier);
  if (src.BackupRetentionPeriod === 0) throw new AwsError('PITRNotEnabled', 'Backups are not enabled for this DB instance (BackupRetentionPeriod is 0): there is nothing to restore from. Enable automated backups first.', 400);
  const id = String(c.p.TargetDbInstanceIdentifier);
  checkId(id);
  if (s.instances[id]) throw new AwsError('DBInstanceAlreadyExists', 'DB instance already exists');
  const latest = c.acct.clock - 300000;
  const earliest = c.acct.clock - src.BackupRetentionPeriod * 86400000;
  let at = latest;
  if (!c.p.UseLatestRestorableTime) {
    if (!c.p.RestoreTime) throw E.combo('Either RestoreTime or UseLatestRestorableTime must be specified.');
    at = Date.parse(String(c.p.RestoreTime));
    if (Number.isNaN(at)) throw E.invalid(`Invalid RestoreTime: ${c.p.RestoreTime}`);
    if (at > latest) throw new AwsError('InvalidRestoreFault', `Cannot restore to a time later than the latest restorable time (${iso(latest)}).`, 400);
    if (at < earliest) throw new AwsError('InvalidRestoreFault', `Cannot restore to a time earlier than the earliest restorable time (${iso(earliest)}): the backup retention period is ${src.BackupRetentionPeriod} day(s).`, 400);
  }
  const cls = c.p.DbInstanceClass ?? src.DBInstanceClass;
  if (!DB_CLASSES[cls]) throw E.invalid(`Invalid DB Instance class: ${cls}`);
  const inst: DbInstance = { ...src, DBInstanceIdentifier: id, DBInstanceClass: cls, MultiAZ: !!c.p.MultiAz, SecondaryAvailabilityZone: undefined, PubliclyAccessible: c.p.PubliclyAccessible ?? src.PubliclyAccessible, ReadReplicaSourceDBInstanceIdentifier: undefined, DBClusterIdentifier: undefined, status: 'creating', stateAt: c.acct.clock, InstanceCreateTime: iso(c.acct.clock), pending: undefined, paramGroup: undefined, applied: undefined, Tags: [] };
  s.instances[id] = inst;
  return { DBInstance: instanceView(c, inst) };
});

// ───────────────────────── RDS Proxy ─────────────────────────

const proxies = (a: Account, region: string) => (rdsOf(a, region).proxies ??= {});
const proxyArn = (c: Pick<OpCtx, 'acct' | 'region'>, name: string) => arnOf(c, 'db-proxy', `prx-${name}`);
const FAMILY_ENGINES: Record<string, string[]> = { MYSQL: ['mysql', 'mariadb', 'aurora-mysql'], POSTGRESQL: ['postgres', 'aurora-postgresql'], SQLSERVER: [] };

function subnetIp(cidr: string): string {
  const [ip] = cidr.split('/');
  const p = ip.split('.').map(Number);
  return `${p[0]}.${p[1]}.${p[2]}.${Math.min(250, p[3] + 4)}`;
}

/** Estado de salud de un destino: ¿puede el proxy autenticarse y llegar a la base de datos? */
function targetHealth(a: Account, region: string, px: DbProxy, t: DbProxy['targets'][number]): { State: string; Reason?: string; Description?: string } {
  if (px.status === 'creating') return { State: 'REGISTERING', Reason: 'PENDING_PROXY_CAPACITY', Description: 'DBProxy Target is waiting for proxy to scale to desired capacity' };
  const s = rdsOf(a, region);
  const r = regional(a, region).ec2;
  const inst = t.type === 'RDS_INSTANCE' ? s.instances[t.id] : s.instances[s.clusters[t.id]?.members.find((m) => m.writer)?.id ?? ''];
  if (!inst) return { State: 'UNAVAILABLE', Reason: 'CONNECTION_FAILED', Description: 'The database is not reachable.' };
  if (inst.status !== 'available') return { State: 'UNAVAILABLE', Reason: 'UNREACHABLE', Description: `The database instance is ${inst.status}.` };
  // 1. credenciales: el rol debe poder leer los secretos y alguno debe coincidir con el usuario maestro
  const secrets = px.secretArns.map((x) => findSecret(a, region, x));
  if (!px.secretArns.every((x) => roleCan(a, px.roleArn, ['secretsmanager:GetSecretValue'], x))) return { State: 'UNAVAILABLE', Reason: 'AUTH_FAILURE', Description: 'Proxy does not have permission to retrieve the secret: the proxy role needs secretsmanager:GetSecretValue on it.' };
  const creds = secrets.map((x) => {
    try {
      const v = JSON.parse(x?.versions.find((y) => y.stages.includes('AWSCURRENT'))?.value ?? '{}') as { username?: string; password?: string };
      return v;
    } catch {
      return {};
    }
  });
  const cluster = inst.DBClusterIdentifier ? s.clusters[inst.DBClusterIdentifier] : undefined;
  const master = cluster?.MasterUsername ?? inst.MasterUsername;
  const pw = cluster?.pw ?? inst.pw;
  if (!creds.some((x) => x.username === master && (pw === undefined || x.password === pw))) return { State: 'UNAVAILABLE', Reason: 'AUTH_FAILURE', Description: `Access denied for user '${master}': the secret does not contain the database user and current password.` };
  // 2. red: el grupo de seguridad de la base de datos debe admitir al proxy
  const dbSgs = (cluster?.VpcSecurityGroupIds.length ? cluster.VpcSecurityGroupIds : inst.VpcSecurityGroupIds).map((id) => r.securityGroups[id]).filter(Boolean);
  const subnetCidrs = px.subnetIds.map((id) => r.subnets[id]?.CidrBlock).filter(Boolean) as string[];
  if (!subnetCidrs.some((cidr) => sgAllows(dbSgs, false, 'tcp', inst.Port, subnetIp(cidr), px.sgIds))) return { State: 'UNAVAILABLE', Reason: 'CONNECTION_FAILED', Description: `Connection to the database timed out: the database security group does not allow the proxy (port ${inst.Port}).` };
  return { State: 'AVAILABLE' };
}

const proxyView = (c: Pick<OpCtx, 'acct' | 'region'>, p: DbProxy) => ({
  DBProxyName: p.name,
  DBProxyArn: proxyArn(c, p.name),
  Status: p.status,
  EngineFamily: p.engineFamily,
  VpcId: p.vpcId,
  VpcSecurityGroupIds: p.sgIds,
  VpcSubnetIds: p.subnetIds,
  Auth: p.secretArns.map((SecretArn) => ({ AuthScheme: 'SECRETS', SecretArn, IAMAuth: 'DISABLED' })),
  RoleArn: p.roleArn,
  Endpoint: endpointHost(c.acct, c.region, p.name, 'proxy-'),
  RequireTLS: p.requireTls,
  IdleClientTimeout: p.idleTimeout,
  DebugLogging: false,
  CreatedDate: iso(p.created),
  UpdatedDate: iso(p.stateAt),
});

function refreshProxies(a: Account, region: string): void {
  for (const p of Object.values(proxies(a, region))) {
    if (p.status === 'creating' && a.clock - p.stateAt >= PROXY_CREATING_MS) p.status = 'available';
    if (p.status === 'deleting' && a.clock - p.stateAt >= 30000) delete proxies(a, region)[p.name];
  }
}
tickers.push((a) => {
  for (const region of Object.keys(a.regions)) if (a.regions[region].rds?.proxies) refreshProxies(a, region);
});

const findProxy = (c: OpCtx, name: string): DbProxy => {
  refreshProxies(c.acct, c.region);
  const p = proxies(c.acct, c.region)[name];
  if (!p) throw new AwsError('DBProxyNotFoundFault', `The specified proxy name ${name} doesn't correspond to a proxy owned by your Amazon Web Services account in the specified Amazon Web Services Region.`, 404);
  return p;
};

op('rds', 'create-db-proxy', 'db-proxy-name:s! engine-family:s! auth:j! role-arn:s! vpc-subnet-ids:l! vpc-security-group-ids:l require-tls:b idle-client-timeout:i debug-logging:b tags:t', 'Crea un RDS Proxy: un intermediario que mantiene un conjunto de conexiones abiertas con la base de datos y las comparte entre tus clientes (ideal para Lambda).', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const name = String(c.p.DbProxyName);
  checkId(name, 'DB Proxy');
  const all = proxies(c.acct, c.region);
  if (all[name]) throw new AwsError('DBProxyAlreadyExistsFault', `The proxy name ${name} is already in use.`, 400);
  const family = String(c.p.EngineFamily);
  if (!(family in FAMILY_ENGINES)) throw E.invalid(`Invalid EngineFamily ${family}: use MYSQL, POSTGRESQL or SQLSERVER.`);
  const auth = toArr<{ AuthScheme?: string; SecretArn?: string; IAMAuth?: string }>(c.p.Auth);
  if (!auth.length || auth.some((x) => !x.SecretArn)) throw E.invalid('Auth must list at least one SecretArn (AuthScheme=SECRETS).');
  for (const x of auth) if (!findSecret(c.acct, c.region, x.SecretArn!)) throw E.invalid(`Secret ${x.SecretArn} could not be found in Secrets Manager.`);
  if (!roleTrusts(c.acct, String(c.p.RoleArn), 'rds.amazonaws.com')) throw E.invalid(`The role ${c.p.RoleArn} cannot be assumed by RDS: its trust policy must allow rds.amazonaws.com.`);
  const r = regional(c.acct, c.region).ec2;
  const ids = toArr<string>(c.p.VpcSubnetIds);
  for (const id of ids) if (!r.subnets[id]) throw new AwsError('InvalidSubnet', `The subnet ID '${id}' is not valid`, 400);
  if (new Set(ids.map((id) => r.subnets[id].AvailabilityZone)).size < 2) throw E.invalid('A proxy needs subnets in at least 2 Availability Zones.');
  if (new Set(ids.map((id) => r.subnets[id].VpcId)).size > 1) throw E.invalid('All proxy subnets must belong to the same VPC.');
  const vpcId = r.subnets[ids[0]].VpcId;
  const sgs = toArr<string>(c.p.VpcSecurityGroupIds);
  const sgIds = sgs.length ? sgs : [Object.values(r.securityGroups).find((g) => g.VpcId === vpcId && g.GroupName === 'default')!.GroupId];
  const p: DbProxy = { name, arn: proxyArn(c, name), engineFamily: family, roleArn: String(c.p.RoleArn), secretArns: auth.map((x) => findSecret(c.acct, c.region, x.SecretArn!)!.ARN), subnetIds: ids, sgIds, vpcId, requireTls: !!c.p.RequireTls, idleTimeout: c.p.IdleClientTimeout ?? 1800, status: 'creating', stateAt: c.acct.clock, created: c.acct.clock, targets: [], pool: { MaxConnectionsPercent: 100, MaxIdleConnectionsPercent: 50, ConnectionBorrowTimeout: 120 }, Tags: (c.p.Tags as Tag[]) ?? [] };
  all[name] = p;
  return { DBProxy: proxyView(c, p) };
});

op('rds', 'describe-db-proxies', 'db-proxy-name:s', 'Lista los proxies con su endpoint y estado.', { res: () => 'arn:aws:rds:*:*:db-proxy:*', paginate: 'DBProxies' }, (c) => {
  refreshProxies(c.acct, c.region);
  if (c.p.DbProxyName) findProxy(c, c.p.DbProxyName);
  return { DBProxies: Object.values(proxies(c.acct, c.region)).filter((p) => !c.p.DbProxyName || p.name === c.p.DbProxyName).map((p) => proxyView(c, p)) };
});

op('rds', 'register-db-proxy-targets', 'db-proxy-name:s! target-group-name:s db-instance-identifiers:l db-cluster-identifiers:l', 'Conecta el proxy con una instancia o un clúster de Aurora. Después comprueba su salud con `describe-db-proxy-targets`.', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const p = findProxy(c, c.p.DbProxyName);
  const s = rdsOf(c.acct, c.region);
  const add: DbProxy['targets'] = [...toArr<string>(c.p.DbInstanceIdentifiers).map((id) => ({ type: 'RDS_INSTANCE' as const, id })), ...toArr<string>(c.p.DbClusterIdentifiers).map((id) => ({ type: 'TRACKED_CLUSTER' as const, id }))];
  if (!add.length) throw E.combo('Specify DBInstanceIdentifiers or DBClusterIdentifiers.');
  for (const t of add) {
    const inst = t.type === 'RDS_INSTANCE' ? s.instances[t.id] : s.clusters[t.id];
    if (!inst) throw t.type === 'RDS_INSTANCE' ? E.inst(t.id) : E.cluster(t.id);
    if (!FAMILY_ENGINES[p.engineFamily].includes(inst.Engine)) throw E.invalid(`Engine ${inst.Engine} is not compatible with the proxy engine family ${p.engineFamily}.`);
    if (t.type === 'RDS_INSTANCE' && (inst as DbInstance).DBClusterIdentifier) throw E.invalid(`${t.id} belongs to an Aurora cluster: register the cluster (--db-cluster-identifiers), not its instances.`);
    if (p.targets.some((x) => x.id === t.id)) throw new AwsError('DBProxyTargetAlreadyRegisteredFault', `${t.id} is already registered.`, 400);
    p.targets.push(t);
  }
  return { DBProxyTargets: p.targets.map((t) => targetView(c, p, t)) };
});

const targetView = (c: OpCtx, p: DbProxy, t: DbProxy['targets'][number]) => {
  const s = rdsOf(c.acct, c.region);
  const inst = t.type === 'RDS_INSTANCE' ? s.instances[t.id] : s.instances[s.clusters[t.id]?.members.find((m) => m.writer)?.id ?? ''];
  return {
    ...(t.type === 'RDS_INSTANCE' && inst ? { Endpoint: endpointHost(c.acct, c.region, t.id) } : {}),
    ...(t.type === 'TRACKED_CLUSTER' ? { TrackedClusterId: t.id } : {}),
    RdsResourceId: t.id,
    Port: inst?.Port ?? 3306,
    Type: t.type,
    Role: 'READ_WRITE',
    TargetHealth: targetHealth(c.acct, c.region, p, t),
  };
};

op('rds', 'describe-db-proxy-targets', 'db-proxy-name:s! target-group-name:s', 'Estado de salud de cada destino del proxy: `AVAILABLE`, o `UNAVAILABLE` con el motivo (`AUTH_FAILURE`, `CONNECTION_FAILED`…).', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const p = findProxy(c, c.p.DbProxyName);
  return { Targets: p.targets.map((t) => targetView(c, p, t)) };
});

op('rds', 'modify-db-proxy-target-group', 'target-group-name:s! db-proxy-name:s! connection-pool-config:j', 'Ajusta el conjunto de conexiones: qué porcentaje de `max_connections` puede usar el proxy y cuántas conexiones inactivas conserva.', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const p = findProxy(c, c.p.DbProxyName);
  const cfg = (c.p.ConnectionPoolConfig ?? {}) as Partial<DbProxy['pool']>;
  const n = (v: unknown, d: number) => (v === undefined ? d : Number(v));
  const next = { MaxConnectionsPercent: n(cfg.MaxConnectionsPercent, p.pool.MaxConnectionsPercent), MaxIdleConnectionsPercent: n(cfg.MaxIdleConnectionsPercent, p.pool.MaxIdleConnectionsPercent), ConnectionBorrowTimeout: n(cfg.ConnectionBorrowTimeout, p.pool.ConnectionBorrowTimeout) };
  if (next.MaxConnectionsPercent < 1 || next.MaxConnectionsPercent > 100) throw E.invalid('MaxConnectionsPercent must be between 1 and 100.');
  if (next.MaxIdleConnectionsPercent > next.MaxConnectionsPercent) throw E.invalid('MaxIdleConnectionsPercent cannot be greater than MaxConnectionsPercent.');
  p.pool = next;
  return { TargetGroup: { DBProxyName: p.name, TargetGroupName: 'default', IsDefault: true, Status: 'available', ConnectionPoolConfig: { ...next, SessionPinningFilters: [] } } };
});

op('rds', 'describe-db-proxy-target-groups', 'db-proxy-name:s! target-group-name:s', 'El grupo de destinos del proxy y su configuración del conjunto de conexiones.', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const p = findProxy(c, c.p.DbProxyName);
  return { TargetGroups: [{ DBProxyName: p.name, TargetGroupName: 'default', IsDefault: true, Status: 'available', ConnectionPoolConfig: { ...p.pool, SessionPinningFilters: [] } }] };
});

op('rds', 'delete-db-proxy', 'db-proxy-name:s!', 'Borra un proxy.', { res: (c) => proxyArn(c, c.p.DbProxyName) }, (c) => {
  const p = findProxy(c, c.p.DbProxyName);
  p.status = 'deleting';
  p.stateAt = c.acct.clock;
  return { DBProxy: proxyView(c, p) };
});

