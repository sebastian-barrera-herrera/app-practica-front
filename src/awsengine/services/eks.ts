/**
 * Amazon EKS: el plano de control de Kubernetes que gestiona AWS (clústeres), los grupos de nodos administrados (instancias de EC2),
 * los perfiles de Fargate, los permisos de acceso (access entries) y el kubeconfig que usa `kubectl`.
 * Lo que corre dentro del clúster (pods, deployments, servicios) está en `k8s.ts`.
 */
import { b64decode, b64encode } from '../../engine/commands/hash';
import { regional } from '../account';
import { instanceType } from '../catalog';
import { bestRoute, routeTableFor } from '../net';
import { AwsError, op, Raw, type Caller, type OpCtx } from '../registry';
import { sdkCall } from '../sdk';
import { tickers } from '../tick';
import type { Account, Tag } from '../types';
import type { EksAccessEntry, EksCluster, EksFargateProfile, EksNodegroup, EksState, K8sState } from '../types-containers';
import { mkArn, stableId } from '../util';
import { parseTemplate } from '../yaml';
import { ec2Launch, ec2Terminate, refreshEc2 } from './ec2';
import { callerFromArn } from './ecr';
import { taskReach } from './ecs';
import { roleTrusts } from './flowlogs';

const MIN = 60000;
export const eksOf = (a: Account, region: string): EksState => (regional(a, region).eks ??= { clusters: {}, counter: 0 });

const E = {
  invalid: (m: string) => new AwsError('InvalidParameterException', m, 400),
  inUse: (m: string) => new AwsError('ResourceInUseException', m, 409),
  nf: (m: string, extra = '') => new AwsError('ResourceNotFoundException', m + extra, 404),
};

export const clusterArn = (a: Account, region: string, name: string) => mkArn('eks', region, a.id, `cluster/${name}`);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v === undefined || v === null || v === '' ? [] : String(v).includes(',') ? (String(v).split(',') as unknown as T[]) : ([v] as T[]));

const VERSIONS = ['1.29', '1.30', '1.31', '1.32', '1.33'];
const DEFAULT_VERSION = '1.32';
export const REQUIRED_NODE_POLICIES = ['AmazonEKSWorkerNodePolicy', 'AmazonEKS_CNI_Policy'];

/** El principal de IAM con el que Kubernetes reconoce a quien llama: los roles asumidos se reducen al rol. */
export function principalOf(a: Account, arn: string): string {
  const m = /^arn:aws:sts::(\d+):assumed-role\/([^/]+)\/.+$/.exec(arn);
  return m ? a.iam.roles[m[2]]?.Arn ?? `arn:aws:iam::${m[1]}:role/${m[2]}` : arn;
}

export function findCluster(a: Account, region: string, name: string): EksCluster {
  const c = eksOf(a, region).clusters[name];
  if (!c) throw E.nf(`No cluster found for name: ${name}.`);
  return c;
}

const emptyK8s = (now: number): K8sState => ({
  namespaces: ['default', 'kube-system', 'kube-public', 'kube-node-lease'],
  deployments: {},
  pods: {},
  services: {
    'default/kubernetes': { name: 'kubernetes', ns: 'default', type: 'ClusterIP', selector: {}, ports: [{ port: 443, targetPort: 443 }], clusterIp: '172.20.0.1', created: now, annotations: {}, events: [] },
    'kube-system/kube-dns': { name: 'kube-dns', ns: 'kube-system', type: 'ClusterIP', selector: { 'k8s-app': 'kube-dns' }, ports: [{ port: 53, targetPort: 53 }], clusterIp: '172.20.0.10', created: now, annotations: {}, events: [] },
  },
  counter: 0,
  simAt: now,
});

// ───────────────────────── estado en el tiempo ─────────────────────────

const CLUSTER_MS = 9.5 * MIN;
const NODEGROUP_MS = 4 * MIN;
const NODEGROUP_FAIL_MS = 22 * MIN;
const FARGATE_MS = 90000;

function dropNodes(a: Account, region: string, ng: EksNodegroup) {
  const r = regional(a, region).ec2;
  for (const id of ng.instanceIds) if (r.instances[id]) ec2Terminate(a, r, r.instances[id]);
  ng.instanceIds = [];
}

const isLive = (a: Account, region: string, id: string) => {
  const i = regional(a, region).ec2.instances[id];
  return !!i && i.state !== 'terminated' && i.state !== 'shutting-down' && i.state !== 'stopping' && i.state !== 'stopped';
};

function launchNode(a: Account, region: string, cl: EksCluster, ng: EksNodegroup) {
  const r = regional(a, region).ec2;
  const counts: Record<string, number> = {};
  for (const id of ng.instanceIds) {
    const s = r.instances[id]?.SubnetId;
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  const subnet = [...ng.subnets].sort((x, y) => (counts[x] ?? 0) - (counts[y] ?? 0) || ng.subnets.indexOf(x) - ng.subnets.indexOf(y))[0];
  const type = ng.instanceTypes[ng.instanceIds.length % ng.instanceTypes.length];
  const arm = instanceType(type)?.arch === 'arm64';
  const inst = ec2Launch(a, region, { imageKey: arm ? 'al2023-arm' : 'al2023-x86', type, subnetId: subnet, sgIds: [cl.clusterSg], size: ng.diskSize, tags: [{ Key: 'Name', Value: `${cl.name}-${ng.name}-Node` }, { Key: 'eks:cluster-name', Value: cl.name }, { Key: 'eks:nodegroup-name', Value: ng.name }, { Key: `kubernetes.io/cluster/${cl.name}`, Value: 'owned' }, ...ng.tags] });
  inst.state = 'pending';
  inst.stateAt = a.clock;
  ng.instanceIds.push(inst.InstanceId);
}

/** Lleva el EKS de la región al instante actual: clústeres que terminan de crearse, grupos de nodos que se rellenan o se borran. */
export function settleEks(a: Account, region: string, now: number): void {
  const st = regional(a, region).eks;
  if (!st) return;
  for (const cl of Object.values(st.clusters)) {
    if (cl.status === 'CREATING' && now >= cl.activeAt) cl.status = cl.failure ? 'FAILED' : 'ACTIVE';
    for (const ng of Object.values(cl.nodegroups)) {
      if (ng.status === 'DELETING' && ng.deleteAt !== undefined && now >= ng.deleteAt) {
        dropNodes(a, region, ng);
        delete cl.nodegroups[ng.name];
        continue;
      }
      if (ng.status === 'CREATING' && now >= ng.activeAt) {
        if (ng.joinFail) {
          ng.status = 'CREATE_FAILED';
          dropNodes(a, region, ng);
        } else ng.status = 'ACTIVE';
      }
      if (ng.status === 'UPDATING' && now >= ng.activeAt) ng.status = 'ACTIVE';
      if (ng.status === 'ACTIVE' || ng.status === 'CREATING' || ng.status === 'UPDATING') {
        // los grupos administrados reponen lo que se pierda y ajustan al tamaño deseado
        ng.instanceIds = ng.instanceIds.filter((id) => isLive(a, region, id));
        while (ng.instanceIds.length < ng.desired) launchNode(a, region, cl, ng);
        while (ng.instanceIds.length > ng.desired) {
          const id = ng.instanceIds.pop()!;
          const r = regional(a, region).ec2;
          if (r.instances[id]) ec2Terminate(a, r, r.instances[id]);
        }
      }
    }
    for (const fp of Object.values(cl.fargateProfiles)) if (fp.deleting !== undefined && now >= fp.deleting) delete cl.fargateProfiles[fp.name];
    if (cl.status === 'DELETING' && cl.deleteAt !== undefined && now >= cl.deleteAt) {
      delete regional(a, region).ec2.securityGroups[cl.clusterSg];
      delete st.clusters[cl.name];
    }
  }
}

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    if (!a.regions[region].eks || !Object.keys(a.regions[region].eks!.clusters).length) continue;
    refreshEc2(a, region);
    settleEks(a, region, a.clock);
  }
});

// ───────────────────────── vistas ─────────────────────────

const t = (ms: number) => ms / 1000;
const tags = (list: Tag[]) => Object.fromEntries(list.map((x) => [x.Key, x.Value]));

function clusterView(a: Account, region: string, cl: EksCluster) {
  const active = cl.status === 'ACTIVE';
  return {
    name: cl.name,
    arn: cl.arn,
    createdAt: t(cl.created),
    version: cl.version,
    ...(active ? { endpoint: cl.endpoint } : {}),
    roleArn: cl.roleArn,
    resourcesVpcConfig: { subnetIds: cl.subnetIds, securityGroupIds: cl.securityGroupIds, clusterSecurityGroupId: cl.clusterSg, vpcId: cl.vpcId, endpointPublicAccess: cl.publicAccess, endpointPrivateAccess: cl.privateAccess, publicAccessCidrs: ['0.0.0.0/0'] },
    kubernetesNetworkConfig: { serviceIpv4Cidr: '172.20.0.0/16', ipFamily: 'ipv4' },
    logging: { clusterLogging: [{ types: ['api', 'audit', 'authenticator', 'controllerManager', 'scheduler'], enabled: false }, ...(cl.logging.length ? [{ types: cl.logging, enabled: true }] : [])] },
    identity: { oidc: { issuer: `https://oidc.eks.${region}.amazonaws.com/id/${cl.endpoint.slice(8, 40)}` } },
    status: cl.status,
    ...(active ? { certificateAuthority: { data: cl.ca } } : {}),
    platformVersion: 'eks.5',
    tags: tags(cl.tags),
    health: { issues: cl.failure ? [{ code: cl.failure.Code, message: cl.failure.Message, resourceIds: [cl.roleArn] }] : [] },
    accessConfig: { authenticationMode: 'API_AND_CONFIG_MAP' },
  };
}

function ngView(a: Account, region: string, cl: EksCluster, ng: EksNodegroup) {
  return {
    nodegroupName: ng.name,
    nodegroupArn: ng.arn,
    clusterName: cl.name,
    version: ng.version,
    releaseVersion: `${ng.version}.9-20250610`,
    createdAt: t(ng.created),
    modifiedAt: t(ng.status === 'CREATING' ? ng.created : Math.min(a.clock, ng.activeAt)),
    status: ng.status,
    capacityType: ng.capacityType,
    scalingConfig: { minSize: ng.min, maxSize: ng.max, desiredSize: ng.desired },
    instanceTypes: ng.instanceTypes,
    subnets: ng.subnets,
    amiType: ng.amiType,
    nodeRole: ng.nodeRole,
    labels: ng.labels,
    resources: { autoScalingGroups: [{ name: `eks-${ng.name}-${stableId(`asg:${ng.arn}`, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')}` }] },
    diskSize: ng.diskSize,
    health: { issues: ng.status === 'CREATE_FAILED' && ng.joinFail ? [{ code: ng.joinFail.Code, message: ng.joinFail.Message, resourceIds: ng.failedIds ?? [] }] : [] },
    updateConfig: { maxUnavailable: 1 },
    tags: tags(ng.tags),
  };
}

const fpView = (a: Account, cl: EksCluster, fp: EksFargateProfile) => ({
  fargateProfileName: fp.name,
  fargateProfileArn: fp.arn,
  clusterName: cl.name,
  createdAt: t(fp.created),
  podExecutionRoleArn: fp.podExecutionRoleArn,
  subnets: fp.subnets,
  selectors: fp.selectors,
  status: fp.deleting !== undefined ? 'DELETING' : a.clock >= fp.activeAt ? 'ACTIVE' : 'CREATING',
  tags: tags(fp.tags),
});

const aeView = (e: EksAccessEntry, cl: EksCluster) => ({ clusterName: cl.name, principalArn: e.principalArn, kubernetesGroups: e.kubernetesGroups, accessEntryArn: e.arn, createdAt: t(e.created), modifiedAt: t(e.created), tags: {}, username: e.principalArn, type: e.type });

// ───────────────────────── clústeres ─────────────────────────

const clRes = (c: OpCtx) => mkArn('eks', c.region, c.acct.id, `cluster/${c.p.Name ?? c.p.ClusterName ?? '*'}`);
const NAME = /^[0-9A-Za-z][A-Za-z0-9\-_]{0,99}$/;

function subnetIsPrivate(a: Account, region: string, subnetId: string): boolean {
  const r = regional(a, region).ec2;
  const rt = routeTableFor(r, subnetId);
  const def = rt ? bestRoute(r, rt, '93.184.216.34') : undefined;
  return !def?.target.startsWith('igw-');
}

op('eks', 'create-cluster', 'name:s! kubernetes-version:s role-arn:s! resources-vpc-config:j! kubernetes-network-config:j logging:j tags:t access-config:j', 'Crea un clúster de Kubernetes: AWS gestiona y mantiene el plano de control (tarda unos 10 minutos). Los nodos se añaden después con un grupo de nodos o con Fargate.', { res: clRes }, (c) => {
  const name = String(c.p.Name);
  if (!NAME.test(name)) throw E.invalid(`Invalid cluster name: ${name}. The name must start with a letter or number and contain only letters, numbers, hyphens and underscores (max 100 characters).`);
  const st = eksOf(c.acct, c.region);
  if (st.clusters[name]) throw E.inUse(`Cluster already exists with name: ${name}`);
  const version = String(c.p.KubernetesVersion ?? DEFAULT_VERSION);
  if (!VERSIONS.includes(version)) throw E.invalid(`unsupported Kubernetes version ${version}. Supported versions: ${VERSIONS.join(', ')}.`);
  const vpc = (c.p.ResourcesVpcConfig ?? {}) as Record<string, any>;
  const subnets = arr<string>(vpc.subnetIds);
  const r = regional(c.acct, c.region).ec2;
  if (!subnets.length) throw E.invalid('subnetIds must be specified in resourcesVpcConfig.');
  for (const s of subnets) if (!r.subnets[s]) throw E.invalid(`The subnet ID '${s}' does not exist`);
  if (new Set(subnets.map((s) => r.subnets[s].AvailabilityZone)).size < 2) throw E.invalid('Subnets specified must be in at least two different AZs');
  if (new Set(subnets.map((s) => r.subnets[s].VpcId)).size > 1) throw E.invalid('Subnets specified must be in the same VPC.');
  const sgs = arr<string>(vpc.securityGroupIds);
  for (const g of sgs) if (!r.securityGroups[g]) throw E.invalid(`The security group '${g}' does not exist`);
  const roleArn = String(c.p.RoleArn);
  const roleName = roleArn.split('/').pop() ?? '';
  if (!c.acct.iam.roles[roleName] || !roleTrusts(c.acct, roleArn, 'eks.amazonaws.com')) throw E.invalid(`Role with arn: ${roleArn} could not be assumed because it does not exist or the trusted entity is not correct`);
  st.counter++;
  const now = c.acct.clock;
  const vpcId = r.subnets[subnets[0]].VpcId;
  const idHex = stableId(`eks:${c.acct.id}:${name}:${st.counter}`, '', 32, 'hex').toUpperCase();
  const mk = sdkCall(c.acct, c.region, null, 'ec2', 'create-security-group', { GroupName: `eks-cluster-sg-${name}-${stableId(`sg:${name}:${st.counter}`, '', 10, 'hex').replace(/[a-f]/g, (x) => String(x.charCodeAt(0) % 10))}`, Description: 'EKS created security group applied to ENI that is attached to EKS Control Plane master nodes, as well as any managed workloads.', VpcId: vpcId });
  if (!mk.ok || !mk.data) throw E.invalid(mk.error?.Message ?? 'Could not create the cluster security group.');
  const csg = { GroupId: String(mk.data.GroupId) };
  sdkCall(c.acct, c.region, null, 'ec2', 'authorize-security-group-ingress', { GroupId: csg.GroupId, IpPermissions: [{ IpProtocol: '-1', UserIdGroupPairs: [{ GroupId: csg.GroupId }] }] });
  const missingPolicy = !c.acct.iam.roles[roleName].attached.some((p) => p.endsWith('/AmazonEKSClusterPolicy'));
  const cl: EksCluster = {
    name,
    arn: clusterArn(c.acct, c.region, name),
    version,
    roleArn,
    status: 'CREATING',
    created: now,
    activeAt: now + (missingPolicy ? 3 * MIN : CLUSTER_MS),
    endpoint: `https://${idHex}.gr7.${c.region}.eks.amazonaws.com`,
    ca: b64encode(`-----BEGIN CERTIFICATE-----\n${stableId(`ca:${name}`, '', 64, 'b64')}\n-----END CERTIFICATE-----\n`),
    vpcId,
    subnetIds: subnets,
    securityGroupIds: sgs,
    clusterSg: csg.GroupId,
    publicAccess: vpc.endpointPublicAccess === undefined ? true : vpc.endpointPublicAccess === true || vpc.endpointPublicAccess === 'true',
    privateAccess: vpc.endpointPrivateAccess === true || vpc.endpointPrivateAccess === 'true',
    creator: principalOf(c.acct, c.caller.arn),
    accessEntries: {},
    nodegroups: {},
    fargateProfiles: {},
    logging: [],
    tags: Object.entries((c.p.Tags ?? {}) as Record<string, string>).map(([Key, Value]) => ({ Key, Value })),
    k8s: emptyK8s(now),
    ...(missingPolicy ? { failure: { Code: 'AccessDenied', Message: `Amazon EKS can't use the cluster role ${roleArn}: the policy AmazonEKSClusterPolicy is not attached to it.` } } : {}),
  };
  const me = cl.creator;
  cl.accessEntries[me] = { principalArn: me, arn: mkArn('eks', c.region, c.acct.id, `access-entry/${name}/${me.includes(':user/') ? 'user' : 'role'}/${c.acct.id}/${me.split('/').pop()}/${stableId(`ae:${name}:${me}`, '', 8, 'hex')}`), type: 'STANDARD', kubernetesGroups: [], policies: [{ policyArn: 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy', accessScope: { type: 'cluster' } }], created: now };
  st.clusters[name] = cl;
  return { cluster: clusterView(c.acct, c.region, cl) };
});

op('eks', 'describe-cluster', 'name:s!', 'Estado de un clúster: versión, endpoint de la API, red, certificado y si está creándose, activo o ha fallado.', { res: clRes }, (c) => ({ cluster: clusterView(c.acct, c.region, findCluster(c.acct, c.region, String(c.p.Name))) }));

op('eks', 'list-clusters', 'max-results:i', 'Lista los nombres de los clústeres.', { res: () => '*', paginate: 'clusters' }, (c) => ({ clusters: Object.keys(eksOf(c.acct, c.region).clusters) }));

op('eks', 'delete-cluster', 'name:s!', 'Borra un clúster (antes hay que borrar sus grupos de nodos y perfiles de Fargate).', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.Name));
  if (Object.keys(cl.nodegroups).length) throw E.inUse(`Cluster has nodegroups attached`);
  if (Object.keys(cl.fargateProfiles).length) throw E.inUse(`Cluster has Fargate profiles attached`);
  cl.status = 'DELETING';
  cl.deleteAt = c.acct.clock + 3 * MIN;
  for (const s of Object.values(cl.k8s.services)) void s;
  return { cluster: clusterView(c.acct, c.region, cl) };
});

// ───────────────────────── grupos de nodos ─────────────────────────

const ngRes = (c: OpCtx) => mkArn('eks', c.region, c.acct.id, `nodegroup/${c.p.ClusterName ?? '*'}/${c.p.NodegroupName ?? '*'}/*`);

function findNg(cl: EksCluster, name: string): EksNodegroup {
  const ng = cl.nodegroups[name];
  if (!ng) throw E.nf(`No node group found for name: ${name}.`);
  return ng;
}

/** Por qué los nodos no llegarían a unirse al clúster (o null si todo está bien). */
function joinProblem(a: Account, region: string, cl: EksCluster, nodeRole: string, subnets: string[]): { Code: string; Message: string } | null {
  const role = a.iam.roles[nodeRole.split('/').pop() ?? ''];
  const missing = REQUIRED_NODE_POLICIES.filter((p) => !role?.attached.some((x) => x.endsWith('/' + p)));
  if (missing.length) return { Code: 'NodeCreationFailure', Message: `Instances failed to join the kubernetes cluster. The node role is missing the managed policies: ${missing.join(', ')}.` };
  const r = regional(a, region).ec2;
  for (const s of subnets) {
    const net = { subnets: [s], securityGroups: [cl.clusterSg], assignPublicIp: (r.subnets[s].MapPublicIpOnLaunch ? 'ENABLED' : 'DISABLED') as 'ENABLED' | 'DISABLED' };
    const reach = taskReach(a, region, net, !!r.subnets[s].MapPublicIpOnLaunch, 'ecr.api');
    if (!reach.ok) return { Code: 'NodeCreationFailure', Message: `Instances failed to join the kubernetes cluster. The subnet ${s} has no route to reach the cluster endpoint (needs a public IP with an internet gateway, a NAT gateway or VPC endpoints).` };
  }
  return null;
}

op('eks', 'create-nodegroup', 'cluster-name:s! nodegroup-name:s! scaling-config:j disk-size:i subnets:l! instance-types:l ami-type:s node-role:s! labels:j tags:t capacity-type:s kubernetes-version:s', 'Crea un grupo de nodos administrado: instancias de EC2 que EKS lanza, actualiza y repone por ti, y que se unen solas al clúster.', { res: ngRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  if (cl.status !== 'ACTIVE') throw E.inUse(`Cluster ${cl.name} is not in ACTIVE status (current: ${cl.status}). Wait until it is ACTIVE.`);
  const name = String(c.p.NodegroupName);
  if (!NAME.test(name)) throw E.invalid(`Invalid nodegroup name: ${name}.`);
  if (cl.nodegroups[name]) throw E.inUse(`NodeGroup already exists with name ${name} and cluster name ${cl.name}`);
  const r = regional(c.acct, c.region).ec2;
  const subnets = arr<string>(c.p.Subnets);
  for (const s of subnets) {
    if (!r.subnets[s]) throw E.invalid(`The subnet ID '${s}' does not exist`);
    if (r.subnets[s].VpcId !== cl.vpcId) throw E.invalid(`The subnet ${s} does not belong to the VPC of the cluster (${cl.vpcId}).`);
  }
  const roleArn = String(c.p.NodeRole);
  if (!c.acct.iam.roles[roleArn.split('/').pop() ?? ''] || !roleTrusts(c.acct, roleArn, 'ec2.amazonaws.com')) throw E.invalid(`The role with arn: ${roleArn} could not be assumed because it does not exist or the trusted entity is not correct (it must trust ec2.amazonaws.com).`);
  const types = arr<string>(c.p.InstanceTypes);
  const itypes = types.length ? types : ['t3.medium'];
  for (const x of itypes) if (!instanceType(x)) throw E.invalid(`The specified instance type ${x} is not valid.`);
  const arm = itypes.some((x) => instanceType(x)?.arch === 'arm64');
  const ami = String(c.p.AmiType ?? (arm ? 'AL2023_ARM_64_STANDARD' : 'AL2023_x86_64_STANDARD'));
  if (!['AL2023_x86_64_STANDARD', 'AL2023_ARM_64_STANDARD', 'AL2_x86_64', 'AL2_ARM_64', 'BOTTLEROCKET_x86_64', 'BOTTLEROCKET_ARM_64'].includes(ami)) throw E.invalid(`Invalid AMI type ${ami}.`);
  if (/ARM/.test(ami) !== arm) throw E.invalid(`The AMI type ${ami} is not compatible with the instance types ${itypes.join(', ')}.`);
  const sc = (c.p.ScalingConfig ?? {}) as Record<string, any>;
  const min = Number(sc.minSize ?? 1);
  const max = Number(sc.maxSize ?? 2);
  const desired = Number(sc.desiredSize ?? min);
  if (min > max) throw E.invalid('Minimum capacity cannot be greater than maximum capacity.');
  if (desired < min || desired > max) throw E.invalid(`Desired capacity ${desired} must be between the minimum (${min}) and maximum (${max}) capacity.`);
  if (max < 1) throw E.invalid('Maximum capacity must be at least 1.');
  const now = c.acct.clock;
  const problem = joinProblem(c.acct, c.region, cl, roleArn, subnets);
  const ng: EksNodegroup = {
    name,
    arn: mkArn('eks', c.region, c.acct.id, `nodegroup/${cl.name}/${name}/${stableId(`ng:${cl.arn}:${name}`, '', 8, 'hex')}-${stableId(`ng2:${cl.arn}:${name}`, '', 4, 'hex')}-${stableId(`ng3:${name}`, '', 4, 'hex')}-${stableId(`ng4:${name}`, '', 4, 'hex')}-${stableId(`ng5:${cl.arn}:${name}`, '', 12, 'hex')}`),
    status: 'CREATING',
    instanceTypes: itypes,
    amiType: ami,
    capacityType: String(c.p.CapacityType ?? 'ON_DEMAND') === 'SPOT' ? 'SPOT' : 'ON_DEMAND',
    diskSize: Number(c.p.DiskSize ?? 20),
    min,
    max,
    desired,
    subnets,
    nodeRole: roleArn,
    labels: (c.p.Labels?.labels ?? c.p.Labels ?? {}) as Record<string, string>,
    created: now,
    activeAt: now + (problem ? NODEGROUP_FAIL_MS : NODEGROUP_MS),
    ...(problem ? { joinFail: problem } : {}),
    instanceIds: [],
    version: cl.version,
    tags: Object.entries((c.p.Tags ?? {}) as Record<string, string>).map(([Key, Value]) => ({ Key, Value })),
  };
  cl.nodegroups[name] = ng;
  for (let k = 0; k < desired; k++) launchNode(c.acct, c.region, cl, ng);
  ng.failedIds = problem ? [...ng.instanceIds] : undefined;
  return { nodegroup: ngView(c.acct, c.region, cl, ng) };
});

op('eks', 'describe-nodegroup', 'cluster-name:s! nodegroup-name:s!', 'Estado de un grupo de nodos: tamaño, tipos de instancia, rol y problemas de salud.', { res: ngRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  return { nodegroup: ngView(c.acct, c.region, cl, findNg(cl, String(c.p.NodegroupName))) };
});

op('eks', 'list-nodegroups', 'cluster-name:s! max-results:i', 'Lista los grupos de nodos del clúster.', { res: ngRes, paginate: 'nodegroups' }, (c) => ({ nodegroups: Object.keys(findCluster(c.acct, c.region, String(c.p.ClusterName)).nodegroups) }));

op('eks', 'update-nodegroup-config', 'cluster-name:s! nodegroup-name:s! labels:j scaling-config:j', 'Cambia el tamaño mínimo, máximo y deseado del grupo de nodos.', { res: ngRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const ng = findNg(cl, String(c.p.NodegroupName));
  if (ng.status !== 'ACTIVE') throw E.inUse(`Nodegroup ${ng.name} is not in ACTIVE status (current: ${ng.status}).`);
  const sc = (c.p.ScalingConfig ?? {}) as Record<string, any>;
  const min = Number(sc.minSize ?? ng.min);
  const max = Number(sc.maxSize ?? ng.max);
  const desired = Number(sc.desiredSize ?? Math.max(min, Math.min(max, ng.desired)));
  if (min > max) throw E.invalid('Minimum capacity cannot be greater than maximum capacity.');
  if (desired < min || desired > max) throw E.invalid(`Desired capacity ${desired} must be between the minimum (${min}) and maximum (${max}) capacity.`);
  ng.min = min;
  ng.max = max;
  ng.desired = desired;
  ng.status = 'UPDATING';
  ng.activeAt = c.acct.clock + 40000;
  settleEks(c.acct, c.region, c.acct.clock);
  return { update: { id: stableId(`upd:${ng.arn}:${c.acct.clock}`, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'), status: 'InProgress', type: 'ConfigUpdate', params: [{ type: 'MinSize', value: String(min) }, { type: 'MaxSize', value: String(max) }, { type: 'DesiredSize', value: String(desired) }], createdAt: t(c.acct.clock), errors: [] } };
});

op('eks', 'delete-nodegroup', 'cluster-name:s! nodegroup-name:s!', 'Borra el grupo de nodos y termina sus instancias.', { res: ngRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const ng = findNg(cl, String(c.p.NodegroupName));
  if (ng.status === 'DELETING') throw E.inUse(`Nodegroup ${ng.name} is already being deleted.`);
  ng.status = 'DELETING';
  ng.deleteAt = c.acct.clock + 2 * MIN;
  return { nodegroup: ngView(c.acct, c.region, cl, ng) };
});

// ───────────────────────── Fargate ─────────────────────────

const fpRes = (c: OpCtx) => mkArn('eks', c.region, c.acct.id, `fargateprofile/${c.p.ClusterName ?? '*'}/*`);

op('eks', 'create-fargate-profile', 'fargate-profile-name:s! cluster-name:s! pod-execution-role-arn:s! subnets:l selectors:f tags:t', 'Crea un perfil de Fargate: los pods cuyo namespace (y etiquetas) coincidan se ejecutan en Fargate, sin nodos que gestionar.', { res: fpRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const name = String(c.p.FargateProfileName);
  if (cl.fargateProfiles[name]) throw E.inUse(`Fargate profile ${name} already exists in cluster ${cl.name}`);
  const role = String(c.p.PodExecutionRoleArn);
  if (!c.acct.iam.roles[role.split('/').pop() ?? ''] || !roleTrusts(c.acct, role, 'eks-fargate-pods.amazonaws.com')) throw E.invalid(`The role with arn: ${role} could not be assumed because it does not exist or the trusted entity is not correct (it must trust eks-fargate-pods.amazonaws.com).`);
  const subnets = arr<string>(c.p.Subnets);
  if (!subnets.length) throw E.invalid('Subnets must be specified.');
  for (const s of subnets) {
    if (!regional(c.acct, c.region).ec2.subnets[s]) throw E.invalid(`The subnet ID '${s}' does not exist`);
    if (!subnetIsPrivate(c.acct, c.region, s)) throw E.invalid(`Subnet ${s} is a public subnet (its route table has a route to an internet gateway). Fargate profiles only support private subnets.`);
  }
  const selectors = ((c.p.Selectors ?? []) as { namespace?: string; labels?: Record<string, string> }[]).filter((x) => x.namespace).map((x) => ({ namespace: String(x.namespace), ...(x.labels ? { labels: x.labels } : {}) }));
  if (!selectors.length) throw E.invalid('At least one selector with a namespace is required.');
  const now = c.acct.clock;
  const fp: EksFargateProfile = { name, arn: mkArn('eks', c.region, c.acct.id, `fargateprofile/${cl.name}/${name}/${stableId(`fp:${cl.arn}:${name}`, '', 8, 'hex')}-${stableId(`fp2:${name}`, '', 4, 'hex')}-${stableId(`fp3:${name}`, '', 4, 'hex')}-${stableId(`fp4:${name}`, '', 4, 'hex')}-${stableId(`fp5:${cl.arn}:${name}`, '', 12, 'hex')}`), podExecutionRoleArn: role, subnets, selectors, created: now, activeAt: now + FARGATE_MS, tags: Object.entries((c.p.Tags ?? {}) as Record<string, string>).map(([Key, Value]) => ({ Key, Value })) };
  cl.fargateProfiles[name] = fp;
  return { fargateProfile: fpView(c.acct, cl, fp) };
});

op('eks', 'describe-fargate-profile', 'cluster-name:s! fargate-profile-name:s!', 'Detalle de un perfil de Fargate.', { res: fpRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const fp = cl.fargateProfiles[String(c.p.FargateProfileName)];
  if (!fp) throw E.nf(`No Fargate Profile found with name: ${c.p.FargateProfileName}.`);
  return { fargateProfile: fpView(c.acct, cl, fp) };
});

op('eks', 'list-fargate-profiles', 'cluster-name:s! max-results:i', 'Lista los perfiles de Fargate del clúster.', { res: fpRes, paginate: 'fargateProfileNames' }, (c) => ({ fargateProfileNames: Object.keys(findCluster(c.acct, c.region, String(c.p.ClusterName)).fargateProfiles) }));

op('eks', 'delete-fargate-profile', 'cluster-name:s! fargate-profile-name:s!', 'Borra un perfil de Fargate.', { res: fpRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const fp = cl.fargateProfiles[String(c.p.FargateProfileName)];
  if (!fp) throw E.nf(`No Fargate Profile found with name: ${c.p.FargateProfileName}.`);
  fp.deleting = c.acct.clock + 60000;
  return { fargateProfile: fpView(c.acct, cl, fp) };
});

// ───────────────────────── acceso ─────────────────────────

const POLICIES = ['AmazonEKSClusterAdminPolicy', 'AmazonEKSAdminPolicy', 'AmazonEKSEditPolicy', 'AmazonEKSViewPolicy'];

op('eks', 'create-access-entry', 'cluster-name:s! principal-arn:s! kubernetes-groups:l tags:t type:s username:s', 'Da acceso a Kubernetes a un usuario o rol de IAM (después se le asocia una política de acceso).', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const p = String(c.p.PrincipalArn);
  const m = /^arn:aws:iam::(\d+):(user|role)\/(.+)$/.exec(p);
  if (!m || m[1] !== c.acct.id || !(m[2] === 'user' ? c.acct.iam.users[m[3].split('/').pop()!] : c.acct.iam.roles[m[3].split('/').pop()!])) throw E.invalid(`The specified principal ARN is invalid: ${p}`);
  if (cl.accessEntries[p]) throw E.inUse(`The specified access entry resource is already in use on this cluster.`);
  const e: EksAccessEntry = { principalArn: p, arn: mkArn('eks', c.region, c.acct.id, `access-entry/${cl.name}/${m[2]}/${c.acct.id}/${m[3].split('/').pop()}/${stableId(`ae:${cl.name}:${p}`, '', 8, 'hex')}`), type: String(c.p.Type ?? 'STANDARD'), kubernetesGroups: arr<string>(c.p.KubernetesGroups), policies: [], created: c.acct.clock };
  cl.accessEntries[p] = e;
  return { accessEntry: aeView(e, cl) };
});

op('eks', 'list-access-entries', 'cluster-name:s! associated-policy-arn:s max-results:i', 'Lista quién tiene acceso al clúster.', { res: clRes, paginate: 'accessEntries' }, (c) => ({ accessEntries: Object.keys(findCluster(c.acct, c.region, String(c.p.ClusterName)).accessEntries) }));

op('eks', 'describe-access-entry', 'cluster-name:s! principal-arn:s!', 'Detalle de un acceso.', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const e = cl.accessEntries[String(c.p.PrincipalArn)];
  if (!e) throw E.nf('The specified access entry resource could not be found.');
  return { accessEntry: aeView(e, cl) };
});

op('eks', 'delete-access-entry', 'cluster-name:s! principal-arn:s!', 'Quita el acceso de un usuario o rol al clúster.', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  if (!cl.accessEntries[String(c.p.PrincipalArn)]) throw E.nf('The specified access entry resource could not be found.');
  delete cl.accessEntries[String(c.p.PrincipalArn)];
  return undefined;
});

op('eks', 'associate-access-policy', 'cluster-name:s! principal-arn:s! policy-arn:s! access-scope:j!', 'Asocia a un acceso una política de Kubernetes (administrador, edición o solo lectura) en todo el clúster o en ciertos namespaces.', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const e = cl.accessEntries[String(c.p.PrincipalArn)];
  if (!e) throw E.nf('The specified access entry resource could not be found.');
  const pol = String(c.p.PolicyArn);
  if (!POLICIES.some((x) => pol === `arn:aws:eks::aws:cluster-access-policy/${x}`)) throw E.invalid(`The specified policy ARN is invalid: ${pol}. Valid: ${POLICIES.map((x) => `arn:aws:eks::aws:cluster-access-policy/${x}`).join(', ')}`);
  const sc = (c.p.AccessScope ?? {}) as { type?: string; namespaces?: unknown };
  const type = sc.type === 'namespace' ? 'namespace' : 'cluster';
  const ns = arr<string>(sc.namespaces);
  if (type === 'namespace' && !ns.length) throw E.invalid('namespaces must be provided when the access scope type is namespace.');
  e.policies = e.policies.filter((x) => x.policyArn !== pol);
  e.policies.push({ policyArn: pol, accessScope: { type, ...(type === 'namespace' ? { namespaces: ns } : {}) } });
  return { clusterName: cl.name, principalArn: e.principalArn, associatedAccessPolicy: { policyArn: pol, accessScope: e.policies[e.policies.length - 1].accessScope, associatedAt: t(c.acct.clock), modifiedAt: t(c.acct.clock) } };
});

op('eks', 'list-associated-access-policies', 'cluster-name:s! principal-arn:s! max-results:i', 'Políticas de acceso asociadas a un acceso.', { res: clRes }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.ClusterName));
  const e = cl.accessEntries[String(c.p.PrincipalArn)];
  if (!e) throw E.nf('The specified access entry resource could not be found.');
  return { clusterName: cl.name, principalArn: e.principalArn, associatedAccessPolicies: e.policies.map((x) => ({ policyArn: x.policyArn, accessScope: x.accessScope, associatedAt: t(e.created), modifiedAt: t(e.created) })) };
});

/** Lo que puede hacer una identidad en Kubernetes: nivel (admin/edit/view) por namespace, o null si no tiene acceso. */
export function k8sAccess(cl: EksCluster, principal: string): { level: 'admin' | 'edit' | 'view'; namespaces: string[] | null }[] | null {
  const e = cl.accessEntries[principal];
  if (!e) return null;
  return e.policies.map((p) => ({ level: /Admin/.test(p.policyArn) ? 'admin' : /Edit/.test(p.policyArn) ? 'edit' : 'view', namespaces: p.accessScope.type === 'cluster' ? null : p.accessScope.namespaces ?? [] }));
}

// ───────────────────────── token y kubeconfig ─────────────────────────

const urlSafe = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/');

export function makeEksToken(a: Account, caller: Caller, cluster: string): string {
  return 'k8s-aws-v1.' + urlSafe(b64encode(JSON.stringify({ p: caller.arn, c: cluster, a: a.id, t: a.clock, k: stableId(`ek:${caller.arn}:${a.clock}`, '', 8, 'hex') })));
}

export function parseEksToken(a: Account, token: string): { caller: Caller; cluster: string; issuedAt: number } | null {
  if (!token.startsWith('k8s-aws-v1.')) return null;
  try {
    const raw = b64decode(fromUrlSafe(token.slice(11)));
    if (raw === null) return null;
    const j = JSON.parse(raw) as { p: string; c: string; a: string; t: number };
    if (j.a !== a.id) return null;
    return { caller: callerFromArn(a, j.p), cluster: j.c, issuedAt: j.t };
  } catch {
    return null;
  }
}

op('eks', 'get-token', 'cluster-name:s name:s role-arn:s', 'Genera el token temporal (válido 15 minutos) con el que `kubectl` demuestra quién eres; lo usa el kubeconfig automáticamente.', { res: () => '*', authz: false }, (c) => {
  const name = String(c.p.ClusterName ?? c.p.Name ?? '');
  if (!name) throw new AwsError('ValidationError', 'Error: Argument --cluster-name is required.', 255);
  const token = makeEksToken(c.acct, c.caller, name);
  const exp = new Date(c.acct.clock + 15 * MIN).toISOString().replace(/\.\d+Z$/, 'Z');
  return new Raw(JSON.stringify({ kind: 'ExecCredential', apiVersion: 'client.authentication.k8s.io/v1beta1', spec: {}, status: { expirationTimestamp: exp, token } }, null, 4) + '\n');
});

interface KubeEntry {
  cluster: { server: string; ca: string };
  user: { region: string; name: string };
}

function dumpKube(clusters: Record<string, KubeEntry>, current: string): string {
  const names = Object.keys(clusters);
  let y = 'apiVersion: v1\nclusters:\n';
  for (const n of names) y += `- cluster:\n    certificate-authority-data: ${clusters[n].cluster.ca}\n    server: ${clusters[n].cluster.server}\n  name: ${n}\n`;
  y += 'contexts:\n';
  for (const n of names) y += `- context:\n    cluster: ${n}\n    user: ${n}\n  name: ${n}\n`;
  y += `current-context: ${current}\nkind: Config\npreferences: {}\nusers:\n`;
  for (const n of names) y += `- name: ${n}\n  user:\n    exec:\n      apiVersion: client.authentication.k8s.io/v1beta1\n      args:\n      - --region\n      - ${clusters[n].user.region}\n      - eks\n      - get-token\n      - --cluster-name\n      - ${clusters[n].user.name}\n      - --output\n      - json\n      command: aws\n`;
  return y;
}

export interface Kubeconfig {
  current: string;
  contexts: Record<string, { cluster: string; region: string; server: string }>;
}

/** Lee `~/.kube/config` (solo lo que escribe `update-kubeconfig`). */
export function readKubeconfig(text: string | null): Kubeconfig | null {
  if (!text) return null;
  try {
    const doc = parseTemplate(text) as { clusters?: { name: string; cluster: { server: string } }[]; contexts?: { name: string; context: { cluster: string; user: string } }[]; users?: { name: string; user?: { exec?: { args?: string[] } } }[]; 'current-context'?: string };
    const out: Kubeconfig = { current: String(doc['current-context'] ?? ''), contexts: {} };
    for (const ctx of doc.contexts ?? []) {
      const cl = (doc.clusters ?? []).find((x) => x.name === ctx.context.cluster);
      const user = (doc.users ?? []).find((x) => x.name === ctx.context.user);
      const args = user?.user?.exec?.args ?? [];
      const region = args[args.indexOf('--region') + 1] ?? 'us-east-1';
      const cname = args[args.indexOf('--cluster-name') + 1] ?? ctx.name.split('/').pop() ?? '';
      out.contexts[ctx.name] = { cluster: cname, region, server: cl?.cluster.server ?? '' };
    }
    return out;
  } catch {
    return null;
  }
}

op('eks', 'update-kubeconfig', 'name:s! kubeconfig:s role-arn:s dry-run:b verbose:b alias:s user-alias:s', 'Escribe en ~/.kube/config cómo conectarse al clúster (dirección, certificado y cómo pedir el token); luego `kubectl` ya sabe adónde ir.', { res: () => '*', authz: false }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.Name));
  if (cl.status !== 'ACTIVE') return new Raw('', '\nCluster status is ' + cl.status + '\n', 255);
  const path = String(c.p.Kubeconfig ?? `${c.io.home}/.kube/config`);
  const ctxName = String(c.p.Alias ?? cl.arn);
  const existing = c.io.readFile(path);
  const cfg = readKubeconfig(existing);
  const clusters: Record<string, KubeEntry> = {};
  let doc: { clusters?: { name: string; cluster: { server: string; 'certificate-authority-data': string } }[] } = {};
  if (existing) {
    try {
      doc = parseTemplate(existing) as typeof doc;
    } catch {
      doc = {};
    }
  }
  for (const [n, v] of Object.entries(cfg?.contexts ?? {})) {
    const ca = doc.clusters?.find((x) => x.name === n)?.cluster['certificate-authority-data'] ?? '';
    clusters[n] = { cluster: { server: v.server, ca }, user: { region: v.region, name: v.cluster } };
  }
  const replaced = !!clusters[ctxName];
  clusters[ctxName] = { cluster: { server: cl.endpoint, ca: cl.ca }, user: { region: c.region, name: cl.name } };
  if (!c.p.DryRun && !c.io.writeFile(path, dumpKube(clusters, ctxName))) return new Raw('', `\n[Errno 13] Permission denied: '${path}'\n`, 255);
  return new Raw(`${replaced ? 'Updated' : 'Added new'} context ${ctxName} ${replaced ? 'in' : 'to'} ${path}\n`);
});

// ───────────────────────── esperas ─────────────────────────

const WAITERS: Record<string, [string, number, number]> = { 'cluster-active': ['ClusterActive', 30, 40], 'cluster-deleted': ['ClusterDeleted', 30, 40], 'nodegroup-active': ['NodegroupActive', 30, 80], 'nodegroup-deleted': ['NodegroupDeleted', 30, 40], 'fargate-profile-active': ['FargateProfileActive', 10, 60], 'fargate-profile-deleted': ['FargateProfileDeleted', 30, 60] };

op('eks', 'wait', 'waiter:s! name:s cluster-name:s nodegroup-name:s fargate-profile-name:s', 'Espera a que algo termine: `cluster-active`, `nodegroup-active`, `fargate-profile-active` o sus versiones `-deleted`.', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = String(c.p.Waiter);
  const def = WAITERS[w];
  if (!def) throw new AwsError('InvalidWaiter', `Invalid choice: '${w}', valid choices are: ${Object.keys(WAITERS).join(' | ')}`, 252);
  const fail = (m: string) => new AwsError('WaiterError', `Waiter ${def[0]} failed: ${m}`, 255);
  const clusterName = String(c.p.Name ?? c.p.ClusterName ?? '');
  for (let k = 0; k < def[2]; k++) {
    refreshEc2(c.acct, c.region);
    settleEks(c.acct, c.region, c.acct.clock);
    const cl = eksOf(c.acct, c.region).clusters[clusterName];
    if (w.startsWith('cluster')) {
      if (w === 'cluster-deleted' ? !cl : cl?.status === 'ACTIVE') return undefined;
      if (w === 'cluster-active' && !cl) throw fail('Waiter encountered a terminal failure state: For expression "cluster.status" we matched expected path: "MISSING"');
      if (w === 'cluster-active' && cl?.status === 'FAILED') throw fail('Waiter encountered a terminal failure state: For expression "cluster.status" we matched expected path: "FAILED"');
    } else if (w.startsWith('nodegroup')) {
      const ng = cl?.nodegroups[String(c.p.NodegroupName ?? '')];
      if (w === 'nodegroup-deleted' ? !ng : ng?.status === 'ACTIVE') return undefined;
      if (w === 'nodegroup-active' && ng?.status === 'CREATE_FAILED') throw fail('Waiter encountered a terminal failure state: For expression "nodegroup.status" we matched expected path: "CREATE_FAILED"');
    } else {
      const fp = cl?.fargateProfiles[String(c.p.FargateProfileName ?? '')];
      if (w === 'fargate-profile-deleted' ? !fp : fp && fpView(c.acct, cl, fp).status === 'ACTIVE') return undefined;
    }
    c.acct.clock += def[1] * 1000;
  }
  throw fail('Max attempts exceeded');
});

