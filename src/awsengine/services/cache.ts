/** Amazon ElastiCache (Redis/Valkey y Memcached): grupos de replicación, conmutación por error, red y un almacén de claves real para el cliente `redis` de Python. */
import { regional } from '../account';
import { sgAllows } from '../net';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, CacheCluster, CacheGroup, CacheNode, CacheState, CacheSubnetGroup, Tag } from '../types';
import { iso, mergeTags, mkArn, stableId, toArr } from '../util';

const CREATING_MS = 6 * 60000;
const MODIFYING_MS = 90000;
const FAILOVER_MS = 30000;

export const NODE_TYPES: Record<string, { vcpu: number; memGiB: number; price: number }> = {
  'cache.t4g.micro': { vcpu: 2, memGiB: 0.5, price: 0.016 },
  'cache.t4g.small': { vcpu: 2, memGiB: 1.37, price: 0.032 },
  'cache.t4g.medium': { vcpu: 2, memGiB: 3.09, price: 0.065 },
  'cache.t3.micro': { vcpu: 2, memGiB: 0.5, price: 0.017 },
  'cache.m6g.large': { vcpu: 2, memGiB: 6.38, price: 0.149 },
  'cache.m6g.xlarge': { vcpu: 4, memGiB: 12.93, price: 0.298 },
  'cache.r6g.large': { vcpu: 2, memGiB: 13.07, price: 0.206 },
  'cache.r6g.xlarge': { vcpu: 4, memGiB: 26.32, price: 0.411 },
};

const cacheOf = (a: Account, region: string): CacheState => {
  const r = regional(a, region);
  r.elasticache ??= { groups: {}, clusters: {}, subnetGroups: {}, data: {} };
  return r.elasticache;
};

const code = (a: Account, id: string) => stableId(`ec:${a.id}:${id}`, '', 6, 'hex');
const shortRegion = (region: string) => {
  const [a, mid, n] = region.split('-');
  return a + (/^(north|south)/.test(mid) ? mid[0] + mid.slice(5)[0] : mid[0]) + n;
};

const hostOf = (a: Account, region: string, id: string, kind: 'primary' | 'reader' | 'node' | 'config' | 'cluster', shard = '0001') => {
  const c = code(a, id);
  const s = shortRegion(region);
  return kind === 'primary' ? `${id}.${c}.ng.${shard}.${s}.cache.amazonaws.com` : kind === 'reader' ? `${id}-ro.${c}.ng.${shard}.${s}.cache.amazonaws.com` : kind === 'config' ? `clustercfg.${id}.${c}.${s}.cache.amazonaws.com` : kind === 'cluster' ? `${id}.${c}.cfg.${s}.cache.amazonaws.com` : `${id}.${c}.${shard}.${s}.cache.amazonaws.com`;
};

// ───────────────────────── estado en el tiempo ─────────────────────────

export function refreshCache(a: Account, region: string): CacheState {
  const s = cacheOf(a, region);
  for (const g of Object.values(s.groups)) {
    const age = a.clock - g.stateAt;
    if (g.status === 'creating' && age >= CREATING_MS) g.status = 'available';
    else if (g.status === 'modifying' && age >= MODIFYING_MS) g.status = 'available';
    else if (g.status === 'deleting' && age >= 60000) {
      delete s.groups[g.id];
      delete s.data[g.id];
    }
  }
  for (const k of Object.values(s.clusters)) {
    const age = a.clock - k.stateAt;
    if (k.status === 'creating' && age >= CREATING_MS) k.status = 'available';
    else if (k.status === 'modifying' && age >= MODIFYING_MS) k.status = 'available';
    else if (k.status === 'deleting' && age >= 60000) {
      delete s.clusters[k.id];
      delete s.data[k.id];
    }
  }
  return s;
}
tickers.push((a) => {
  for (const region of Object.keys(a.regions)) if (a.regions[region].elasticache) refreshCache(a, region);
});

// ───────────────────────── vistas ─────────────────────────

const cacheErr = {
  group: (id: string) => new AwsError('ReplicationGroupNotFoundFault', `ReplicationGroup ${id} not found.`, 404),
  cluster: (id: string) => new AwsError('CacheClusterNotFound', `CacheCluster not found: ${id}`, 404),
  subnet: (id: string) => new AwsError('CacheSubnetGroupNotFoundFault', `Cache subnet group ${id} not found.`, 404),
  invalid: (m: string) => new AwsError('InvalidParameterValue', m, 400),
  combo: (m: string) => new AwsError('InvalidParameterCombination', m, 400),
  state: (m: string) => new AwsError('InvalidReplicationGroupState', m, 400),
};

const gArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('elasticache', c.region, c.acct.id, `replicationgroup:${id}`);
const kArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('elasticache', c.region, c.acct.id, `cluster:${id}`);

const groupView = (c: Pick<OpCtx, 'acct' | 'region'>, g: CacheGroup) => {
  const ready = g.status !== 'creating';
  return {
    ReplicationGroupId: g.id,
    Description: g.description,
    GlobalReplicationGroupInfo: {},
    Status: g.status,
    PendingModifiedValues: {},
    MemberClusters: g.shards.flatMap((s) => s.nodes.map((n) => n.id)),
    NodeGroups: g.shards.map((s) => ({
      NodeGroupId: s.id,
      Status: g.status,
      ...(!g.clusterMode && ready ? { PrimaryEndpoint: { Address: hostOf(c.acct, c.region, g.id, 'primary', s.id), Port: g.port }, ReaderEndpoint: { Address: hostOf(c.acct, c.region, g.id, 'reader', s.id), Port: g.port } } : {}),
      NodeGroupMembers: s.nodes.map((n) => ({ CacheClusterId: n.id, CacheNodeId: '0001', ...(ready && !g.clusterMode ? { ReadEndpoint: { Address: hostOf(c.acct, c.region, n.id, 'node', s.id), Port: g.port } } : {}), PreferredAvailabilityZone: n.az, CurrentRole: n.role })),
    })),
    ...(g.clusterMode && ready ? { ConfigurationEndpoint: { Address: hostOf(c.acct, c.region, g.id, 'config'), Port: g.port } } : {}),
    SnapshotRetentionLimit: 0,
    SnapshotWindow: '05:00-06:00',
    ClusterEnabled: g.clusterMode,
    CacheNodeType: g.nodeType,
    AuthTokenEnabled: !!g.authToken,
    TransitEncryptionEnabled: g.transit,
    AtRestEncryptionEnabled: g.atRest,
    ARN: gArn(c, g.id),
    LogDeliveryConfigurations: [],
    ReplicationGroupCreateTime: iso(g.created),
    DataTiering: 'disabled',
    AutomaticFailover: g.automaticFailover ? 'enabled' : 'disabled',
    MultiAZ: g.multiAz ? 'enabled' : 'disabled',
    Engine: g.engine,
    EngineVersion: g.engineVersion,
  };
};

const clusterView = (c: Pick<OpCtx, 'acct' | 'region'>, k: CacheCluster, g?: CacheGroup, node?: CacheNode, shard?: string) => {
  const memcached = k.engine === 'memcached';
  return {
    CacheClusterId: k.id,
    ...(k.status !== 'creating' ? (memcached ? { ConfigurationEndpoint: { Address: hostOf(c.acct, c.region, k.id, 'cluster'), Port: k.port } } : g ? {} : { ConfigurationEndpoint: undefined }) : {}),
    ClientDownloadLandingPage: 'https://console.aws.amazon.com/elasticache/home#client-download:',
    CacheNodeType: k.nodeType,
    Engine: k.engine,
    EngineVersion: memcached ? '1.6.22' : '7.1.0',
    CacheClusterStatus: k.status === 'available' ? 'available' : k.status === 'deleting' ? 'deleting' : k.status === 'modifying' ? 'modifying' : 'creating',
    NumCacheNodes: k.numNodes,
    PreferredAvailabilityZone: node?.az ?? k.az,
    CacheClusterCreateTime: iso(k.created),
    PreferredMaintenanceWindow: 'sat:07:00-sat:08:00',
    CacheSubnetGroupName: g?.subnetGroup ?? k.subnetGroup,
    AutoMinorVersionUpgrade: true,
    SecurityGroups: (g?.sgIds ?? k.sgIds).map((id) => ({ SecurityGroupId: id, Status: 'active' })),
    ...(g ? { ReplicationGroupId: g.id, ReplicationGroupLogDeliveryEnabled: false, AtRestEncryptionEnabled: g.atRest, TransitEncryptionEnabled: g.transit } : {}),
    ...(shard ? {} : {}),
    ARN: kArn(c, k.id),
  };
};

// ───────────────────────── grupos de subredes ─────────────────────────

function subnetGroup(c: OpCtx, name: string | undefined): CacheSubnetGroup {
  const s = cacheOf(c.acct, c.region);
  if (!name || name === 'default') {
    const r = regional(c.acct, c.region).ec2;
    const vpc = Object.values(r.vpcs).find((v) => v.IsDefault);
    if (!vpc) throw cacheErr.subnet('default');
    return { name: 'default', description: 'Default CacheSubnetGroup', vpcId: vpc.VpcId, subnetIds: Object.values(r.subnets).filter((x) => x.VpcId === vpc.VpcId).map((x) => x.SubnetId) };
  }
  const g = s.subnetGroups[name];
  if (!g) throw cacheErr.subnet(name);
  return g;
}

const sgView = (c: OpCtx, g: CacheSubnetGroup) => {
  const r = regional(c.acct, c.region).ec2;
  return { CacheSubnetGroupName: g.name, CacheSubnetGroupDescription: g.description, VpcId: g.vpcId, Subnets: g.subnetIds.map((id) => ({ SubnetIdentifier: id, SubnetAvailabilityZone: { Name: r.subnets[id]?.AvailabilityZone } })), ARN: mkArn('elasticache', c.region, c.acct.id, `subnetgroup:${g.name}`) };
};

op('elasticache', 'create-cache-subnet-group', 'cache-subnet-group-name:s! cache-subnet-group-description:s! subnet-ids:l!', 'Crea un grupo de subredes donde ElastiCache puede poner los nodos (determina la VPC).', { res: () => '*' }, (c) => {
  const s = cacheOf(c.acct, c.region);
  const name = String(c.p.CacheSubnetGroupName);
  if (s.subnetGroups[name]) throw new AwsError('CacheSubnetGroupAlreadyExists', `Cache subnet group ${name} already exists.`, 400);
  const r = regional(c.acct, c.region).ec2;
  const ids = toArr<string>(c.p.SubnetIds);
  for (const id of ids) if (!r.subnets[id]) throw new AwsError('InvalidSubnet', `The subnet ID '${id}' is not valid`, 400);
  const vpcs = new Set(ids.map((id) => r.subnets[id].VpcId));
  if (vpcs.size > 1) throw new AwsError('InvalidSubnet', 'Subnets in a cache subnet group must belong to the same VPC.', 400);
  const g: CacheSubnetGroup = { name, description: c.p.CacheSubnetGroupDescription, vpcId: [...vpcs][0], subnetIds: ids };
  s.subnetGroups[name] = g;
  return { CacheSubnetGroup: sgView(c, g) };
});

op('elasticache', 'describe-cache-subnet-groups', 'cache-subnet-group-name:s', 'Lista los grupos de subredes de ElastiCache.', { res: () => '*', paginate: 'CacheSubnetGroups' }, (c) => {
  const s = cacheOf(c.acct, c.region);
  if (c.p.CacheSubnetGroupName && !s.subnetGroups[c.p.CacheSubnetGroupName]) throw cacheErr.subnet(c.p.CacheSubnetGroupName);
  return { CacheSubnetGroups: Object.values(s.subnetGroups).filter((g) => !c.p.CacheSubnetGroupName || g.name === c.p.CacheSubnetGroupName).map((g) => sgView(c, g)) };
});

op('elasticache', 'delete-cache-subnet-group', 'cache-subnet-group-name:s!', 'Borra un grupo de subredes que ningún clúster use.', { res: () => '*' }, (c) => {
  const s = cacheOf(c.acct, c.region);
  if (!s.subnetGroups[c.p.CacheSubnetGroupName]) throw cacheErr.subnet(c.p.CacheSubnetGroupName);
  if (Object.values(s.groups).some((g) => g.subnetGroup === c.p.CacheSubnetGroupName) || Object.values(s.clusters).some((k) => k.subnetGroup === c.p.CacheSubnetGroupName)) throw new AwsError('CacheSubnetGroupInUse', `Cache subnet group ${c.p.CacheSubnetGroupName} is currently in use by a cache cluster.`, 400);
  delete s.subnetGroups[c.p.CacheSubnetGroupName];
  return undefined;
});

// ───────────────────────── grupos de replicación (Redis / Valkey) ─────────────────────────

const azsOfGroup = (c: OpCtx, sg: CacheSubnetGroup) => {
  const r = regional(c.acct, c.region).ec2;
  return [...new Set(sg.subnetIds.map((id) => r.subnets[id]?.AvailabilityZone).filter(Boolean))].sort();
};

function buildShards(id: string, shards: number, nodes: number, azs: string[], clusterMode: boolean): CacheGroup['shards'] {
  return Array.from({ length: shards }, (_, s) => {
    const sid = String(s + 1).padStart(4, '0');
    return {
      id: sid,
      nodes: Array.from({ length: nodes }, (_, n) => ({ id: clusterMode ? `${id}-${String(s + 1).padStart(4, '0')}-${String(n + 1).padStart(3, '0')}` : `${id}-${String(n + 1).padStart(3, '0')}`, az: azs[(s + n) % azs.length], role: n === 0 ? ('primary' as const) : ('replica' as const) })),
    };
  });
}

const findGroup = (c: OpCtx, id: string): CacheGroup => {
  const g = refreshCache(c.acct, c.region).groups[id];
  if (!g) throw cacheErr.group(id);
  return g;
};

op(
  'elasticache',
  'create-replication-group',
  'replication-group-id:s! replication-group-description:s! engine:s engine-version:s cache-node-type:s num-cache-clusters:i num-node-groups:i replicas-per-node-group:i automatic-failover-enabled:b multi-az-enabled:b cache-subnet-group-name:s security-group-ids:l at-rest-encryption-enabled:b transit-encryption-enabled:b auth-token:s port:i tags:t',
  'Crea un grupo de replicación: un nodo primario (escritura) con réplicas (lectura y reserva). Con varios fragmentos (`--num-node-groups`) funciona en modo clúster.',
  { res: (c) => gArn(c, c.p.ReplicationGroupId) },
  (c) => {
    const s = refreshCache(c.acct, c.region);
    const id = String(c.p.ReplicationGroupId);
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || id.endsWith('-') || id.includes('--')) throw cacheErr.invalid(`The parameter ReplicationGroupId is not a valid identifier: ${id}`);
    if (s.groups[id]) throw new AwsError('ReplicationGroupAlreadyExists', `Replication group ${id} already exists.`, 400);
    const engine = (c.p.Engine ?? 'redis') as 'redis' | 'valkey';
    if (engine !== 'redis' && engine !== 'valkey') throw cacheErr.invalid(`Replication groups support the redis and valkey engines, not ${engine}.`);
    const nodeType = c.p.CacheNodeType ?? 'cache.t4g.micro';
    if (!NODE_TYPES[nodeType]) throw cacheErr.invalid(`Invalid cache node type: ${nodeType}`);
    const clusterMode = c.p.NumNodeGroups !== undefined && Number(c.p.NumNodeGroups) > 1;
    const shardsN = Number(c.p.NumNodeGroups ?? 1);
    if (c.p.NumCacheClusters !== undefined && c.p.NumNodeGroups !== undefined) throw cacheErr.combo('Specify either NumCacheClusters or NumNodeGroups/ReplicasPerNodeGroup, not both.');
    const replicas = c.p.ReplicasPerNodeGroup ?? (c.p.NumCacheClusters !== undefined ? Number(c.p.NumCacheClusters) - 1 : 1);
    if (replicas < 0 || replicas > 5) throw cacheErr.invalid('The number of replicas per shard must be between 0 and 5.');
    if (shardsN < 1 || shardsN > 500) throw cacheErr.invalid('NumNodeGroups must be between 1 and 500.');
    const failover = !!c.p.AutomaticFailoverEnabled;
    const multiAz = !!c.p.MultiAzEnabled;
    if (failover && replicas < 1) throw cacheErr.combo('Automatic failover requires at least one replica (NumCacheClusters >= 2).');
    if (multiAz && !failover) throw cacheErr.combo('Multi-AZ requires automatic failover to be enabled (--automatic-failover-enabled).');
    if (clusterMode && !failover && replicas > 0) throw cacheErr.combo('A cluster-mode-enabled replication group with replicas requires --automatic-failover-enabled.');
    const transit = !!c.p.TransitEncryptionEnabled;
    if (c.p.AuthToken !== undefined) {
      if (!transit) throw cacheErr.combo('AuthToken can only be set when in-transit encryption is enabled (--transit-encryption-enabled).');
      if (String(c.p.AuthToken).length < 16 || String(c.p.AuthToken).length > 128) throw cacheErr.invalid('The AuthToken must be between 16 and 128 printable characters.');
    }
    const sg = subnetGroup(c, c.p.CacheSubnetGroupName);
    const azs = azsOfGroup(c, sg);
    if (multiAz && azs.length < 2) throw cacheErr.invalid('Multi-AZ needs a subnet group with subnets in at least 2 Availability Zones.');
    const ec2 = regional(c.acct, c.region).ec2;
    const sgIds = toArr<string>(c.p.SecurityGroupIds);
    for (const g of sgIds) if (!ec2.securityGroups[g]) throw new AwsError('InvalidParameterValue', `Invalid security group, groupId=${g}`, 400);
    const defaultSg = Object.values(ec2.securityGroups).find((x) => x.VpcId === sg.vpcId && x.GroupName === 'default')?.GroupId;
    const g: CacheGroup = {
      id,
      description: c.p.ReplicationGroupDescription,
      engine,
      engineVersion: engine === 'valkey' ? '8.0' : '7.1.0',
      nodeType,
      status: 'creating',
      stateAt: c.acct.clock,
      shards: buildShards(id, shardsN, replicas + 1, azs, clusterMode),
      clusterMode,
      automaticFailover: failover,
      multiAz,
      subnetGroup: sg.name,
      sgIds: sgIds.length ? sgIds : defaultSg ? [defaultSg] : [],
      atRest: !!c.p.AtRestEncryptionEnabled,
      transit,
      ...(c.p.AuthToken !== undefined ? { authToken: String(c.p.AuthToken) } : {}),
      port: c.p.Port ?? 6379,
      created: c.acct.clock,
      Tags: (c.p.Tags as Tag[]) ?? [],
    };
    s.groups[id] = g;
    s.data[id] = {};
    return { ReplicationGroup: groupView(c, g) };
  },
);

op('elasticache', 'describe-replication-groups', 'replication-group-id:s', 'Lista los grupos de replicación con sus endpoints (primario, lector o de configuración).', { res: () => '*', paginate: 'ReplicationGroups' }, (c) => {
  const s = refreshCache(c.acct, c.region);
  if (c.p.ReplicationGroupId && !s.groups[c.p.ReplicationGroupId]) throw cacheErr.group(c.p.ReplicationGroupId);
  return { ReplicationGroups: Object.values(s.groups).filter((g) => !c.p.ReplicationGroupId || g.id === c.p.ReplicationGroupId).map((g) => groupView(c, g)) };
});

op('elasticache', 'modify-replication-group', 'replication-group-id:s! replication-group-description:s apply-immediately:b automatic-failover-enabled:b multi-az-enabled:b cache-node-type:s security-group-ids:l auth-token:s', 'Cambia el tipo de nodo, la conmutación automática o el Multi-AZ de un grupo. Los endpoints no cambian.', { res: (c) => gArn(c, c.p.ReplicationGroupId) }, (c) => {
  const g = findGroup(c, c.p.ReplicationGroupId);
  if (g.status !== 'available') throw cacheErr.state(`Replication group ${g.id} is not in available state.`);
  if (c.p.ReplicationGroupDescription !== undefined) g.description = c.p.ReplicationGroupDescription;
  const nodes = g.shards[0].nodes.length;
  const failover = c.p.AutomaticFailoverEnabled ?? g.automaticFailover;
  const multiAz = c.p.MultiAzEnabled ?? g.multiAz;
  if (failover && nodes < 2) throw cacheErr.combo('Automatic failover requires at least one replica (add one with increase-replica-count first).');
  if (multiAz && !failover) throw cacheErr.combo('Multi-AZ requires automatic failover to be enabled.');
  g.automaticFailover = failover;
  g.multiAz = multiAz;
  if (c.p.CacheNodeType) {
    if (!NODE_TYPES[c.p.CacheNodeType]) throw cacheErr.invalid(`Invalid cache node type: ${c.p.CacheNodeType}`);
    g.nodeType = c.p.CacheNodeType;
    g.status = 'modifying';
    g.stateAt = c.acct.clock;
  }
  if (c.p.SecurityGroupIds) g.sgIds = toArr<string>(c.p.SecurityGroupIds);
  if (c.p.AuthToken !== undefined) {
    if (!g.transit) throw cacheErr.combo('AuthToken requires in-transit encryption.');
    g.authToken = String(c.p.AuthToken);
  }
  return { ReplicationGroup: groupView(c, g) };
});

function setReplicas(c: OpCtx, g: CacheGroup, count: number): void {
  const sg = subnetGroup(c, g.subnetGroup);
  const azs = azsOfGroup(c, sg);
  for (const [si, s] of g.shards.entries()) {
    while (s.nodes.length - 1 < count) {
      const n = s.nodes.length;
      s.nodes.push({ id: g.clusterMode ? `${g.id}-${s.id}-${String(n + 1).padStart(3, '0')}` : `${g.id}-${String(n + 1).padStart(3, '0')}`, az: azs[(si + n) % azs.length], role: 'replica' });
    }
    while (s.nodes.length - 1 > count) s.nodes.pop();
  }
  g.status = 'modifying';
  g.stateAt = c.acct.clock;
}

op('elasticache', 'increase-replica-count', 'replication-group-id:s! new-replica-count:i apply-immediately:b', 'Añade réplicas a cada fragmento (hasta 5).', { res: (c) => gArn(c, c.p.ReplicationGroupId) }, (c) => {
  const g = findGroup(c, c.p.ReplicationGroupId);
  const cur = g.shards[0].nodes.length - 1;
  if (c.p.NewReplicaCount <= cur || c.p.NewReplicaCount > 5) throw cacheErr.invalid(`NewReplicaCount must be greater than the current ${cur} and at most 5.`);
  setReplicas(c, g, c.p.NewReplicaCount);
  return { ReplicationGroup: groupView(c, g) };
});

op('elasticache', 'decrease-replica-count', 'replication-group-id:s! new-replica-count:i apply-immediately:b', 'Quita réplicas de cada fragmento. Con conmutación automática hace falta dejar al menos una.', { res: (c) => gArn(c, c.p.ReplicationGroupId) }, (c) => {
  const g = findGroup(c, c.p.ReplicationGroupId);
  const cur = g.shards[0].nodes.length - 1;
  if (c.p.NewReplicaCount >= cur || c.p.NewReplicaCount < 0) throw cacheErr.invalid(`NewReplicaCount must be lower than the current ${cur}.`);
  if (g.automaticFailover && c.p.NewReplicaCount < 1) throw cacheErr.combo('Automatic failover requires at least one replica: disable it first or keep one replica.');
  setReplicas(c, g, c.p.NewReplicaCount);
  return { ReplicationGroup: groupView(c, g) };
});

op('elasticache', 'test-failover', 'replication-group-id:s! node-group-id:s!', 'Simula la caída del nodo primario: una réplica pasa a primaria y los endpoints siguen siendo los mismos (la aplicación solo ve una breve reconexión).', { res: (c) => gArn(c, c.p.ReplicationGroupId) }, (c) => {
  const g = findGroup(c, c.p.ReplicationGroupId);
  if (g.status !== 'available') throw cacheErr.state(`Replication group ${g.id} is not in available state.`);
  const shard = g.shards.find((x) => x.id === c.p.NodeGroupId);
  if (!shard) throw cacheErr.invalid(`Node group ${c.p.NodeGroupId} not found in ${g.id}.`);
  if (shard.nodes.length < 2) throw cacheErr.state('The node group has no replica to promote: failover needs at least one replica.');
  if (!g.automaticFailover) throw cacheErr.state('Automatic failover is disabled for this replication group.');
  const old = shard.nodes.findIndex((n) => n.role === 'primary');
  const next = (old + 1) % shard.nodes.length;
  shard.nodes[old].role = 'replica';
  shard.nodes[next].role = 'primary';
  g.status = 'modifying';
  g.stateAt = c.acct.clock - (MODIFYING_MS - FAILOVER_MS);
  return { ReplicationGroup: groupView(c, g) };
});

op('elasticache', 'delete-replication-group', 'replication-group-id:s! retain-primary-cluster:b', 'Borra el grupo de replicación y todos sus nodos (los datos se pierden salvo que hagas antes una copia).', { res: (c) => gArn(c, c.p.ReplicationGroupId) }, (c) => {
  const g = findGroup(c, c.p.ReplicationGroupId);
  g.status = 'deleting';
  g.stateAt = c.acct.clock;
  return { ReplicationGroup: groupView(c, g) };
});

// ───────────────────────── clústeres (Memcached y Redis de un solo nodo) ─────────────────────────

op('elasticache', 'create-cache-cluster', 'cache-cluster-id:s! engine:s! cache-node-type:s num-cache-nodes:i cache-subnet-group-name:s security-group-ids:l port:i tags:t', 'Crea un clúster de Memcached (nodos independientes: el cliente reparte las claves) o un Redis de un solo nodo.', { res: (c) => kArn(c, c.p.CacheClusterId) }, (c) => {
  const s = refreshCache(c.acct, c.region);
  const id = String(c.p.CacheClusterId);
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(id)) throw cacheErr.invalid(`The parameter CacheClusterId is not a valid identifier: ${id}`);
  if (s.clusters[id] || Object.values(s.groups).some((g) => g.shards.some((sh) => sh.nodes.some((n) => n.id === id)))) throw new AwsError('CacheClusterAlreadyExists', `Cache cluster ${id} already exists.`, 400);
  const engine = c.p.Engine as 'memcached' | 'redis';
  if (engine !== 'memcached' && engine !== 'redis') throw cacheErr.invalid(`Invalid engine ${engine}: use memcached or redis (replication groups: create-replication-group).`);
  const nodeType = c.p.CacheNodeType ?? 'cache.t4g.micro';
  if (!NODE_TYPES[nodeType]) throw cacheErr.invalid(`Invalid cache node type: ${nodeType}`);
  const nodes = c.p.NumCacheNodes ?? 1;
  if (engine === 'redis' && nodes !== 1) throw cacheErr.combo('A standalone Redis cluster has exactly one node: use a replication group for replicas.');
  if (nodes < 1 || nodes > 40) throw cacheErr.invalid('NumCacheNodes must be between 1 and 40.');
  const sg = subnetGroup(c, c.p.CacheSubnetGroupName);
  const ec2 = regional(c.acct, c.region).ec2;
  const ids = toArr<string>(c.p.SecurityGroupIds);
  const defaultSg = Object.values(ec2.securityGroups).find((x) => x.VpcId === sg.vpcId && x.GroupName === 'default')?.GroupId;
  const k: CacheCluster = { id, engine, nodeType, numNodes: nodes, status: 'creating', stateAt: c.acct.clock, az: azsOfGroup(c, sg)[0], subnetGroup: sg.name, sgIds: ids.length ? ids : defaultSg ? [defaultSg] : [], port: c.p.Port ?? (engine === 'memcached' ? 11211 : 6379), created: c.acct.clock, Tags: (c.p.Tags as Tag[]) ?? [] };
  s.clusters[id] = k;
  s.data[id] = {};
  return { CacheCluster: clusterView(c, k) };
});

op('elasticache', 'describe-cache-clusters', 'cache-cluster-id:s show-cache-node-info:b', 'Lista los clústeres y los nodos de los grupos de replicación.', { res: () => '*', paginate: 'CacheClusters' }, (c) => {
  const s = refreshCache(c.acct, c.region);
  const out = [
    ...Object.values(s.clusters).map((k) => clusterView(c, k)),
    ...Object.values(s.groups).flatMap((g) => g.shards.flatMap((sh) => sh.nodes.map((n) => clusterView(c, { id: n.id, engine: 'redis', nodeType: g.nodeType, numNodes: 1, status: g.status, stateAt: g.stateAt, az: n.az, subnetGroup: g.subnetGroup, sgIds: g.sgIds, port: g.port, created: g.created, Tags: [] }, g, n, sh.id)))),
  ].filter((x) => !c.p.CacheClusterId || x.CacheClusterId === c.p.CacheClusterId);
  if (c.p.CacheClusterId && !out.length) throw cacheErr.cluster(c.p.CacheClusterId);
  return { CacheClusters: out };
});

op('elasticache', 'modify-cache-cluster', 'cache-cluster-id:s! num-cache-nodes:i apply-immediately:b', 'Cambia el número de nodos de un clúster de Memcached (añadir o quitar nodos cambia a qué nodo va cada clave).', { res: (c) => kArn(c, c.p.CacheClusterId) }, (c) => {
  const k = refreshCache(c.acct, c.region).clusters[c.p.CacheClusterId];
  if (!k) throw cacheErr.cluster(c.p.CacheClusterId);
  if (k.engine !== 'memcached') throw cacheErr.combo('Only Memcached clusters can change their number of nodes.');
  if (c.p.NumCacheNodes !== undefined) {
    if (c.p.NumCacheNodes < 1 || c.p.NumCacheNodes > 40) throw cacheErr.invalid('NumCacheNodes must be between 1 and 40.');
    k.numNodes = c.p.NumCacheNodes;
    k.status = 'modifying';
    k.stateAt = c.acct.clock;
  }
  return { CacheCluster: clusterView(c, k) };
});

op('elasticache', 'delete-cache-cluster', 'cache-cluster-id:s!', 'Borra un clúster.', { res: (c) => kArn(c, c.p.CacheClusterId) }, (c) => {
  const k = refreshCache(c.acct, c.region).clusters[c.p.CacheClusterId];
  if (!k) throw cacheErr.cluster(c.p.CacheClusterId);
  k.status = 'deleting';
  k.stateAt = c.acct.clock;
  return { CacheCluster: clusterView(c, k) };
});

op('elasticache', 'add-tags-to-resource', 'resource-name:s! tags:t!', 'Etiqueta un grupo o clúster por su ARN.', { res: (c) => c.p.ResourceName }, (c) => {
  const id = String(c.p.ResourceName).split(':').pop()!;
  const s = refreshCache(c.acct, c.region);
  const t = s.groups[id] ?? s.clusters[id];
  if (!t) throw cacheErr.cluster(id);
  t.Tags = mergeTags(t.Tags, c.p.Tags);
  return { TagList: t.Tags };
});

// ───────────────────────── conexión desde una función Lambda ─────────────────────────

interface Target {
  region: string;
  storeId: string;
  group?: CacheGroup;
  cluster?: CacheCluster;
}

function resolveHost(a: Account, host: string): Target | null {
  for (const region of Object.keys(a.regions)) {
    const s = a.regions[region].elasticache;
    if (!s) continue;
    for (const g of Object.values(s.groups)) {
      const hosts = [g.clusterMode ? hostOf(a, region, g.id, 'config') : '', ...g.shards.flatMap((sh) => [hostOf(a, region, g.id, 'primary', sh.id), hostOf(a, region, g.id, 'reader', sh.id), ...sh.nodes.map((n) => hostOf(a, region, n.id, 'node', sh.id))])];
      if (hosts.includes(host)) return { region, storeId: g.id, group: g };
    }
    for (const k of Object.values(s.clusters)) if (host === hostOf(a, region, k.id, 'cluster')) return { region, storeId: k.id, cluster: k };
  }
  return null;
}

const subnetProbeIp = (cidr: string) => {
  const p = cidr.split('/')[0].split('.').map(Number);
  return `${p[0]}.${p[1]}.${p[2]}.${Math.min(250, p[3] + 4)}`;
};

/** `connect`: ¿llega esta función a ese nodo? Devuelve el almacén o el error que vería el cliente `redis` de Python. */
function connect(a: Account, region: string, vpc: { SubnetIds: string[]; SecurityGroupIds: string[]; VpcId: string } | undefined, p: { host: string; port: number; ssl?: boolean; password?: string; timeout?: number }): Record<string, unknown> {
  const t = resolveHost(a, p.host);
  const cfg = (code: string, message: string, delay = 0) => ({ __error: { Code: code, Message: message }, ...(delay ? { __delay: delay } : {}) });
  if (!t) return cfg('DnsFailure', `Error -2 connecting to ${p.host}:${p.port}. Name or service not known.`);
  const g = t.group;
  const k = t.cluster;
  const sgIds = g?.sgIds ?? k!.sgIds;
  const port = g?.port ?? k!.port;
  const stuck = (why: string) => cfg('Timeout', `Timeout connecting to server (${why})`, p.timeout ? Math.round(p.timeout * 1000) : 600000);
  if ((g?.status ?? k!.status) === 'creating') return cfg('ConnectionError', `Error 111 connecting to ${p.host}:${p.port}. Connection refused.`);
  if (!vpc) return stuck('la función no está conectada a la VPC del caché');
  const ec2 = regional(a, t.region).ec2;
  const sg = subnetGroupOf(a, t.region, g?.subnetGroup ?? k!.subnetGroup);
  if (!sg || vpc.VpcId !== sg.vpcId) return stuck('la función y el caché están en VPC distintas');
  if (p.port !== port) return stuck(`el puerto ${p.port} no es el del caché (${port})`);
  const groups = sgIds.map((id) => ec2.securityGroups[id]).filter(Boolean);
  const ok = vpc.SubnetIds.some((id) => {
    const cidr = ec2.subnets[id]?.CidrBlock;
    return cidr ? sgAllows(groups, false, 'tcp', port, subnetProbeIp(cidr), vpc.SecurityGroupIds) : false;
  });
  if (!ok) return stuck(`el grupo de seguridad del caché no admite el puerto ${port} desde la función`);
  if (g) {
    if (g.transit && !p.ssl) return cfg('ConnectionError', 'Connection closed by server.');
    if (!g.transit && p.ssl) return cfg('ConnectionError', `Error 1 connecting to ${p.host}:${p.port}. [SSL: WRONG_VERSION_NUMBER] wrong version number (the cache has no in-transit encryption: use ssl=False).`);
    if (g.authToken && !p.password) return cfg('ResponseError', 'NOAUTH Authentication required.');
    if (g.authToken && p.password !== g.authToken) return cfg('AuthenticationError', 'WRONGPASS invalid username-password pair or user is disabled.');
  }
  return { store: t.storeId, region: t.region };
}

// ───────────────────────── almacén de claves ─────────────────────────

type Entry = { t: 's' | 'h' | 'l' | 'set'; v: unknown; exp?: number };

function entry(s: CacheState, store: string, key: string, now: number): Entry | undefined {
  const d = (s.data[store] ??= {});
  const e = d[key];
  if (e && e.exp !== undefined && e.exp <= now) {
    delete d[key];
    return undefined;
  }
  return e;
}

const wrongType = () => ({ __error: { Code: 'ResponseError', Message: 'WRONGTYPE Operation against a key holding the wrong kind of value' } });
const glob = (pat: string) => new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^') + '$');

function command(a: Account, region: string, p: { store: string; args: unknown[]; now: number }, cmd: string): Record<string, unknown> {
  const s = cacheOf(a, region);
  const d = (s.data[p.store] ??= {});
  const args = p.args;
  const now = p.now;
  const str = (i: number) => String(args[i]);
  const num = (i: number) => Number(args[i]);
  const ex = (key: string) => entry(s, p.store, key, now);
  const ok = (r: unknown) => ({ r });
  switch (cmd) {
    case 'ping':
      return ok(true);
    case 'set': {
      const key = str(0);
      const opts = (args[2] ?? {}) as { ex?: number; px?: number; nx?: boolean; xx?: boolean; keepttl?: boolean };
      const cur = ex(key);
      if ((opts.nx && cur) || (opts.xx && !cur)) return ok(null);
      d[key] = { t: 's', v: str(1), ...(opts.ex ? { exp: now + opts.ex * 1000 } : opts.px ? { exp: now + opts.px } : opts.keepttl && cur?.exp ? { exp: cur.exp } : {}) };
      return ok(true);
    }
    case 'get': {
      const e = ex(str(0));
      if (!e) return ok(null);
      return e.t === 's' ? ok(e.v) : wrongType();
    }
    case 'mget':
      return ok((args as string[]).map((k) => { const e = ex(String(k)); return e && e.t === 's' ? e.v : null; }));
    case 'delete': {
      let n = 0;
      for (const k of args as string[]) if (ex(String(k))) { delete d[String(k)]; n++; }
      return ok(n);
    }
    case 'exists':
      return ok((args as string[]).filter((k) => ex(String(k))).length);
    case 'expire': {
      const e = ex(str(0));
      if (!e) return ok(false);
      e.exp = now + num(1) * 1000;
      return ok(true);
    }
    case 'persist': {
      const e = ex(str(0));
      if (!e || e.exp === undefined) return ok(false);
      e.exp = undefined;
      return ok(true);
    }
    case 'ttl': {
      const e = ex(str(0));
      return ok(!e ? -2 : e.exp === undefined ? -1 : Math.max(0, Math.round((e.exp - now) / 1000)));
    }
    case 'incrby': {
      const e = ex(str(0));
      const cur = e ? (e.t === 's' && /^-?\d+$/.test(String(e.v)) ? Number(e.v) : NaN) : 0;
      if (Number.isNaN(cur)) return { __error: { Code: 'ResponseError', Message: 'value is not an integer or out of range' } };
      d[str(0)] = { t: 's', v: String(cur + num(1)), ...(e?.exp !== undefined ? { exp: e.exp } : {}) };
      return ok(cur + num(1));
    }
    case 'hset': {
      let e = ex(str(0));
      if (e && e.t !== 'h') return wrongType();
      if (!e) e = d[str(0)] = { t: 'h', v: {} };
      const h = e.v as Record<string, string>;
      let added = 0;
      for (const [f, v] of Object.entries((args[1] ?? {}) as Record<string, unknown>)) {
        if (!(f in h)) added++;
        h[f] = String(v);
      }
      return ok(added);
    }
    case 'hget': {
      const e = ex(str(0));
      if (!e) return ok(null);
      return e.t === 'h' ? ok((e.v as Record<string, string>)[str(1)] ?? null) : wrongType();
    }
    case 'hgetall': {
      const e = ex(str(0));
      return e ? (e.t === 'h' ? ok(e.v) : wrongType()) : ok({});
    }
    case 'hdel': {
      const e = ex(str(0));
      if (!e || e.t !== 'h') return ok(0);
      let n = 0;
      for (const f of args.slice(1) as string[]) if (String(f) in (e.v as object)) { delete (e.v as Record<string, string>)[String(f)]; n++; }
      return ok(n);
    }
    case 'push': {
      let e = ex(str(0));
      if (e && e.t !== 'l') return wrongType();
      if (!e) e = d[str(0)] = { t: 'l', v: [] };
      const list = e.v as string[];
      const vals = (args.slice(2) as string[]).map(String);
      if (args[1] === 'left') list.unshift(...vals.reverse());
      else list.push(...vals);
      return ok(list.length);
    }
    case 'pop': {
      const e = ex(str(0));
      if (!e) return ok(null);
      if (e.t !== 'l') return wrongType();
      const list = e.v as string[];
      const v = args[1] === 'left' ? list.shift() : list.pop();
      if (!list.length) delete d[str(0)];
      return ok(v ?? null);
    }
    case 'lrange': {
      const e = ex(str(0));
      if (!e) return ok([]);
      if (e.t !== 'l') return wrongType();
      const list = e.v as string[];
      const a0 = num(1) < 0 ? list.length + num(1) : num(1);
      const b0 = num(2) < 0 ? list.length + num(2) : num(2);
      return ok(list.slice(Math.max(0, a0), b0 + 1));
    }
    case 'llen': {
      const e = ex(str(0));
      return e ? (e.t === 'l' ? ok((e.v as string[]).length) : wrongType()) : ok(0);
    }
    case 'sadd': {
      let e = ex(str(0));
      if (e && e.t !== 'set') return wrongType();
      if (!e) e = d[str(0)] = { t: 'set', v: [] };
      const set = e.v as string[];
      let n = 0;
      for (const m of args.slice(1) as string[]) if (!set.includes(String(m))) { set.push(String(m)); n++; }
      return ok(n);
    }
    case 'smembers': {
      const e = ex(str(0));
      return e ? (e.t === 'set' ? ok(e.v) : wrongType()) : ok([]);
    }
    case 'sismember': {
      const e = ex(str(0));
      return ok(!!e && e.t === 'set' && (e.v as string[]).includes(str(1)));
    }
    case 'keys': {
      const re = glob(str(0));
      return ok(Object.keys(d).filter((k) => ex(k) && re.test(k)).sort());
    }
    case 'type': {
      const e = ex(str(0));
      return ok(!e ? 'none' : e.t === 's' ? 'string' : e.t === 'h' ? 'hash' : e.t === 'l' ? 'list' : 'set');
    }
    case 'dbsize':
      return ok(Object.keys(d).filter((k) => ex(k)).length);
    case 'flushall':
      s.data[p.store] = {};
      return ok(true);
    default:
      return { __error: { Code: 'ResponseError', Message: `unknown command '${cmd}'` } };
  }
}

const subnetGroupOf = (a: Account, region: string, name: string): CacheSubnetGroup | undefined => {
  const s = cacheOf(a, region);
  if (s.subnetGroups[name]) return s.subnetGroups[name];
  if (name === 'default') {
    const r = regional(a, region).ec2;
    const vpc = Object.values(r.vpcs).find((v) => v.IsDefault);
    return vpc ? { name: 'default', description: 'Default CacheSubnetGroup', vpcId: vpc.VpcId, subnetIds: Object.values(r.subnets).filter((x) => x.VpcId === vpc.VpcId).map((x) => x.SubnetId) } : undefined;
  }
  return undefined;
};

/** Lo llama el puente de Lambda: `__net/connect` (red) y `__cache/<orden>` (datos). */
export function cacheBridge(a: Account, region: string, vpc: { SubnetIds: string[]; SecurityGroupIds: string[]; VpcId: string } | undefined, service: string, opName: string, params: Record<string, unknown>): string {
  refreshCache(a, region);
  if (service === '__net') return JSON.stringify(connect(a, region, vpc, params as never));
  const p = params as { store: string; args: unknown[]; now: number; region?: string };
  const t = Object.keys(a.regions).find((r) => a.regions[r].elasticache?.data[p.store]);
  if (!t) return JSON.stringify({ __error: { Code: 'ConnectionError', Message: 'The cache no longer exists.' } });
  return JSON.stringify(command(a, t, p, opName));
}

const WAITERS: Record<string, (c: OpCtx, s: CacheState) => boolean> = {
  'replication-group-available': (c, s) => {
    const g = s.groups[c.p.ReplicationGroupId];
    if (!g) throw cacheErr.group(c.p.ReplicationGroupId);
    return g.status === 'available';
  },
  'replication-group-deleted': (c, s) => !s.groups[c.p.ReplicationGroupId],
  'cache-cluster-available': (c, s) => {
    const k = s.clusters[c.p.CacheClusterId];
    if (!k) throw cacheErr.cluster(c.p.CacheClusterId);
    return k.status === 'available';
  },
  'cache-cluster-deleted': (c, s) => !s.clusters[c.p.CacheClusterId],
};

op('elasticache', 'wait', 'waiter:s! replication-group-id:s cache-cluster-id:s', 'Espera a que se cumpla una condición (replication-group-available, cache-cluster-available, replication-group-deleted…).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = WAITERS[c.p.Waiter];
  if (!w) throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: ${Object.keys(WAITERS).join(', ')}`);
  for (let k = 0; k < 60; k++) {
    if (w(c, refreshCache(c.acct, c.region))) return undefined;
    c.acct.clock += 15000;
  }
  throw new AwsError('WaiterError', `Waiter ${c.p.Waiter} failed: Max attempts exceeded`);
});
