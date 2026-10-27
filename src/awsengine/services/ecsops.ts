/** Operaciones de Amazon ECS: clústeres, definiciones de tarea, tareas, servicios y esperas. */
import { regional } from '../account';
import { instanceType } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, Rec, Tag } from '../types';
import type { EcsCluster, EcsContainerDef, EcsDeployment, EcsNet, EcsService, EcsTask, EcsTaskDef } from '../types-containers';
import { mergeTags, mkArn, stableId } from '../util';
import { roleCan } from './flowlogs';
import { refreshEc2 } from './ec2';
import { findTg, lbsUsing } from './elb';
import { E, advanceEcs, clusterArn, depId, ecsOf, fargateValid, findCluster, findTaskDef, launchTask, nameOf, parseCpu, parseMem, reconcileNow, serviceArn, stopTask, taskArn, taskStatus, tdArn, type TaskStatus } from './ecs';

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const arr = <T>(v: unknown): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? (v as T[]) : [v as T]);

// ───────────────────────── definiciones de tarea ─────────────────────────

function parseContainer(raw: Rec, i: number): EcsContainerDef {
  const name = String(raw.name ?? '');
  if (!name) throw E.client(`Container.name should not be null or empty. (container index ${i})`);
  const image = String(raw.image ?? '');
  if (!image) throw E.client('Container.image should not be null or empty.');
  const logCfg = raw.logConfiguration as { logDriver?: string; options?: Record<string, string> } | undefined;
  if (logCfg?.logDriver === 'awslogs') {
    const missing = ['awslogs-group', 'awslogs-region'].filter((k) => !(logCfg.options ?? {})[k]);
    if (missing.length) throw E.client(`Log driver awslogs requires options: ${missing.join(', ')}`);
  }
  const hc = raw.healthCheck as { command?: string[] | string; interval?: unknown; timeout?: unknown; retries?: unknown; startPeriod?: unknown } | undefined;
  return {
    name,
    image,
    ...(num(raw.cpu) !== undefined ? { cpu: num(raw.cpu) } : {}),
    ...(num(raw.memory) !== undefined ? { memory: num(raw.memory) } : {}),
    ...(num(raw.memoryReservation) !== undefined ? { memoryReservation: num(raw.memoryReservation) } : {}),
    essential: raw.essential === undefined ? true : bool(raw.essential),
    portMappings: arr<Rec>(raw.portMappings).map((p) => ({ containerPort: Number(p.containerPort), ...(num(p.hostPort) !== undefined ? { hostPort: num(p.hostPort) } : {}), protocol: String(p.protocol ?? 'tcp') })),
    environment: arr<Rec>(raw.environment).map((e) => ({ name: String(e.name), value: String(e.value ?? '') })),
    secrets: arr<Rec>(raw.secrets).map((e) => ({ name: String(e.name), valueFrom: String(e.valueFrom) })),
    ...(raw.command ? { command: arr<string>(raw.command).map(String) } : {}),
    ...(raw.entryPoint ? { entryPoint: arr<string>(raw.entryPoint).map(String) } : {}),
    ...(raw.workingDirectory ? { workingDirectory: String(raw.workingDirectory) } : {}),
    ...(logCfg ? { logConfiguration: { logDriver: String(logCfg.logDriver), options: logCfg.options ?? {} } } : {}),
    ...(hc ? { healthCheck: { command: arr<string>(hc.command).map(String), ...(num(hc.interval) !== undefined ? { interval: num(hc.interval) } : {}), ...(num(hc.timeout) !== undefined ? { timeout: num(hc.timeout) } : {}), ...(num(hc.retries) !== undefined ? { retries: num(hc.retries) } : {}), ...(num(hc.startPeriod) !== undefined ? { startPeriod: num(hc.startPeriod) } : {}) } } : {}),
  };
}

const containerView = (d: EcsContainerDef) => ({
  name: d.name,
  image: d.image,
  cpu: d.cpu ?? 0,
  ...(d.memory !== undefined ? { memory: d.memory } : {}),
  ...(d.memoryReservation !== undefined ? { memoryReservation: d.memoryReservation } : {}),
  portMappings: d.portMappings.map((p) => ({ containerPort: p.containerPort, hostPort: p.hostPort ?? p.containerPort, protocol: p.protocol ?? 'tcp' })),
  essential: d.essential,
  environment: d.environment,
  mountPoints: [],
  volumesFrom: [],
  ...(d.secrets.length ? { secrets: d.secrets } : {}),
  ...(d.command ? { command: d.command } : {}),
  ...(d.entryPoint ? { entryPoint: d.entryPoint } : {}),
  ...(d.logConfiguration ? { logConfiguration: d.logConfiguration } : {}),
  ...(d.healthCheck ? { healthCheck: d.healthCheck } : {}),
  systemControls: [],
});

const tdView = (td: EcsTaskDef) => ({
  taskDefinitionArn: td.arn,
  containerDefinitions: td.containerDefinitions.map(containerView),
  family: td.family,
  ...(td.taskRoleArn ? { taskRoleArn: td.taskRoleArn } : {}),
  ...(td.executionRoleArn ? { executionRoleArn: td.executionRoleArn } : {}),
  networkMode: td.networkMode,
  revision: td.revision,
  volumes: [],
  status: td.status,
  requiresAttributes: [{ name: 'com.amazonaws.ecs.capability.docker-remote-api.1.18' }],
  placementConstraints: [],
  compatibilities: td.requiresCompatibilities.includes('FARGATE') ? ['EC2', 'FARGATE'] : ['EC2'],
  ...(td.runtimePlatform ? { runtimePlatform: td.runtimePlatform } : {}),
  requiresCompatibilities: td.requiresCompatibilities,
  ...(td.cpu ? { cpu: td.cpu } : {}),
  ...(td.memory ? { memory: td.memory } : {}),
  registeredAt: td.registeredAt / 1000,
  ...(td.deregisteredAt ? { deregisteredAt: td.deregisteredAt / 1000 } : {}),
  registeredBy: 'arn:aws:iam::123456789012:user/alumno',
});

op('ecs', 'register-task-definition', 'family:s! container-definitions:f! cpu:s memory:s network-mode:s requires-compatibilities:l execution-role-arn:s task-role-arn:s runtime-platform:j volumes:f tags:t placement-constraints:f', 'Registra una definición de tarea (una revisión nueva de la familia): qué contenedores, con qué imagen, CPU, memoria, puertos y registros.', { res: () => '*' }, (c) => {
  const family = String(c.p.Family);
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(family)) throw E.client('Family should satisfy the regular expression pattern: [a-zA-Z0-9_-]+');
  const defs = arr<Rec>(c.p.ContainerDefinitions).map(parseContainer);
  if (!defs.length) throw E.client('Container list cannot be empty.');
  if (new Set(defs.map((d) => d.name)).size !== defs.length) throw E.client('Duplicate container name.');
  if (!defs.some((d) => d.essential)) throw E.client('Task definition does not have any essential container.');
  const compat = arr<string>(c.p.RequiresCompatibilities);
  const mode = (c.p.NetworkMode ?? (compat.includes('FARGATE') ? 'awsvpc' : 'bridge')) as EcsTaskDef['networkMode'];
  if (!['awsvpc', 'bridge', 'host', 'none'].includes(mode)) throw E.client(`Invalid network mode '${mode}'.`);
  let cpu = c.p.Cpu as string | undefined;
  let memory = c.p.Memory as string | undefined;
  if (compat.includes('FARGATE')) {
    if (mode !== 'awsvpc') throw E.client("Fargate only supports network mode 'awsvpc'.");
    if (!cpu || !memory) throw E.client('Task definition must specify cpu and memory at the task level when using Fargate.');
    const cu = parseCpu(cpu);
    const mu = parseMem(memory);
    if (cu === undefined || mu === undefined || !fargateValid(cu, mu)) throw E.client('No Fargate configuration exists for given values.');
    cpu = String(cu);
    memory = String(mu);
    const needRole = defs.some((d) => /\.dkr\.ecr\./.test(d.image) || d.logConfiguration?.logDriver === 'awslogs');
    if (needRole && !c.p.ExecutionRoleArn) throw E.client(`Fargate requires task definition to have execution role ARN to support ${defs.some((d) => /\.dkr\.ecr\./.test(d.image)) ? 'ECR images' : 'log driver awslogs'}.`);
  }
  for (const d of defs) {
    for (const p of d.portMappings) {
      if (!(p.containerPort >= 1 && p.containerPort <= 65535)) throw E.client(`Invalid port mapping: containerPort ${p.containerPort} is out of range.`);
      if (mode === 'awsvpc' && p.hostPort !== undefined && p.hostPort !== p.containerPort) throw E.client("When networkMode=awsvpc, the host ports and container ports in port mappings must match.");
    }
  }
  const st = ecsOf(c.acct, c.region);
  const rev = (st.families[family] ?? 0) + 1;
  st.families[family] = rev;
  const rp = c.p.RuntimePlatform as { cpuArchitecture?: string; operatingSystemFamily?: string } | undefined;
  const td: EcsTaskDef = {
    family,
    revision: rev,
    arn: tdArn(c.acct, c.region, family, rev),
    containerDefinitions: defs,
    ...(cpu ? { cpu } : {}),
    ...(memory ? { memory } : {}),
    networkMode: mode,
    requiresCompatibilities: compat.length ? compat : ['EC2'],
    ...(c.p.ExecutionRoleArn ? { executionRoleArn: String(c.p.ExecutionRoleArn) } : {}),
    ...(c.p.TaskRoleArn ? { taskRoleArn: String(c.p.TaskRoleArn) } : {}),
    ...(rp ? { runtimePlatform: { cpuArchitecture: (rp.cpuArchitecture ?? 'X86_64') as 'X86_64' | 'ARM64', operatingSystemFamily: rp.operatingSystemFamily ?? 'LINUX' } } : {}),
    status: 'ACTIVE',
    registeredAt: c.acct.clock,
    tags: (c.p.Tags as Tag[]) ?? [],
  };
  st.taskDefs[`${family}:${rev}`] = td;
  return { taskDefinition: tdView(td), tags: td.tags };
});

op('ecs', 'describe-task-definition', 'task-definition:s! include:l', 'Muestra una definición de tarea (`familia`, `familia:revisión` o ARN).', { res: () => '*' }, (c) => {
  const td = findTaskDef(c.acct, c.region, String(c.p.TaskDefinition));
  return { taskDefinition: tdView(td), tags: td.tags };
});

op('ecs', 'list-task-definitions', 'family-prefix:s status:s sort:s max-results:i', 'Lista las ARN de las definiciones de tarea.', { res: () => '*', paginate: 'taskDefinitionArns' }, (c) => {
  const st = ecsOf(c.acct, c.region);
  const status = String(c.p.Status ?? 'ACTIVE');
  const list = Object.values(st.taskDefs).filter((t) => t.status === status && (!c.p.FamilyPrefix || t.family.startsWith(String(c.p.FamilyPrefix))));
  list.sort((x, y) => (c.p.Sort === 'DESC' ? y.registeredAt - x.registeredAt || y.revision - x.revision : x.registeredAt - y.registeredAt || x.revision - y.revision));
  return { taskDefinitionArns: list.map((t) => t.arn) };
});

op('ecs', 'list-task-definition-families', 'family-prefix:s status:s max-results:i', 'Lista las familias de definiciones de tarea.', { res: () => '*', paginate: 'families' }, (c) => {
  const st = ecsOf(c.acct, c.region);
  const status = String(c.p.Status ?? 'ACTIVE');
  const fams = [...new Set(Object.values(st.taskDefs).filter((t) => status === 'ALL' || t.status === status).map((t) => t.family))].filter((f) => !c.p.FamilyPrefix || f.startsWith(String(c.p.FamilyPrefix)));
  return { families: fams };
});

op('ecs', 'deregister-task-definition', 'task-definition:s!', 'Marca una revisión como INACTIVE: no se pueden lanzar tareas nuevas con ella (las que corren siguen).', { res: () => '*' }, (c) => {
  const td = findTaskDef(c.acct, c.region, String(c.p.TaskDefinition));
  if (!/:\d+$/.test(nameOf(String(c.p.TaskDefinition)))) throw E.client('Revision is missing.');
  td.status = 'INACTIVE';
  td.deregisteredAt = c.acct.clock;
  return { taskDefinition: tdView(td) };
});

// ───────────────────────── clústeres ─────────────────────────

const clusterStats = (a: Account, region: string, cl: EcsCluster) => {
  const st = ecsOf(a, region);
  const tasks = Object.values(st.tasks).filter((t) => t.cluster === cl.name);
  const running = tasks.filter((t) => taskStatus(t, a.clock) === 'RUNNING').length;
  const pending = tasks.filter((t) => ['PROVISIONING', 'PENDING', 'ACTIVATING'].includes(taskStatus(t, a.clock)) && t.desiredStatus === 'RUNNING').length;
  const services = Object.values(st.services).filter((s) => s.cluster === cl.name && s.status === 'ACTIVE').length;
  return { running, pending, services, instances: containerInstances(a, region, cl.name).length };
};

const clusterView = (a: Account, region: string, cl: EcsCluster) => {
  const s = clusterStats(a, region, cl);
  return {
    clusterArn: cl.arn,
    clusterName: cl.name,
    status: cl.status,
    registeredContainerInstancesCount: s.instances,
    runningTasksCount: s.running,
    pendingTasksCount: s.pending,
    activeServicesCount: s.services,
    statistics: [],
    tags: cl.tags,
    settings: [{ name: 'containerInsights', value: cl.insights ? 'enabled' : 'disabled' }],
    capacityProviders: cl.capacityProviders,
    defaultCapacityProviderStrategy: cl.defaultStrategy,
  };
};

const strategyOf = (v: unknown) => arr<Rec>(v).map((s) => ({ capacityProvider: String(s.capacityProvider), ...(num(s.weight) !== undefined ? { weight: num(s.weight) } : {}), ...(num(s.base) !== undefined ? { base: num(s.base) } : {}) }));

function checkProviders(strategy: { capacityProvider: string }[], providers: string[]) {
  for (const s of strategy) {
    if (!['FARGATE', 'FARGATE_SPOT'].includes(s.capacityProvider)) throw E.param(`The specified capacity provider ${s.capacityProvider} was not found.`);
    if (!providers.includes(s.capacityProvider)) throw E.param(`The specified capacity provider '${s.capacityProvider}' is not associated with the cluster.`);
  }
}

op('ecs', 'create-cluster', 'cluster-name:s settings:f capacity-providers:l default-capacity-provider-strategy:f tags:t', 'Crea un clúster (una agrupación lógica de tareas y servicios). Es idempotente: si ya existe, lo devuelve.', { res: () => '*' }, (c) => {
  const name = String(c.p.ClusterName ?? 'default');
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(name)) throw E.param('Cluster name can only contain letters, numbers, hyphens and underscores.');
  const st = ecsOf(c.acct, c.region);
  let cl = st.clusters[name];
  if (!cl || cl.status === 'INACTIVE') {
    cl = { name, arn: clusterArn(c.acct, c.region, name), status: 'ACTIVE', created: c.acct.clock, insights: false, capacityProviders: [], defaultStrategy: [], tags: (c.p.Tags as Tag[]) ?? [] };
    st.clusters[name] = cl;
  }
  for (const s of arr<Rec>(c.p.Settings)) if (s.name === 'containerInsights') cl.insights = s.value === 'enabled';
  if (c.p.CapacityProviders) cl.capacityProviders = arr<string>(c.p.CapacityProviders);
  if (c.p.DefaultCapacityProviderStrategy) {
    const strat = strategyOf(c.p.DefaultCapacityProviderStrategy);
    checkProviders(strat, cl.capacityProviders);
    cl.defaultStrategy = strat;
  }
  return { cluster: clusterView(c.acct, c.region, cl) };
});

op('ecs', 'describe-clusters', 'clusters:l include:l', 'Muestra clústeres: servicios activos, tareas en marcha y pendientes, instancias registradas.', { res: () => '*' }, (c) => {
  const st = ecsOf(c.acct, c.region);
  const refs = c.p.Clusters ? arr<string>(c.p.Clusters).map(nameOf) : ['default'];
  const clusters: unknown[] = [];
  const failures: unknown[] = [];
  for (const r of refs) {
    const cl = st.clusters[r];
    if (cl) clusters.push(clusterView(c.acct, c.region, cl));
    else failures.push({ arn: clusterArn(c.acct, c.region, r), reason: 'MISSING' });
  }
  return { clusters, failures };
});

op('ecs', 'list-clusters', 'max-results:i', 'Lista las ARN de los clústeres.', { res: () => '*', paginate: 'clusterArns' }, (c) => ({ clusterArns: Object.values(ecsOf(c.acct, c.region).clusters).filter((x) => x.status === 'ACTIVE').map((x) => x.arn) }));

op('ecs', 'delete-cluster', 'cluster:s!', 'Borra un clúster vacío (sin servicios activos ni tareas).', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.Cluster));
  const s = clusterStats(c.acct, c.region, cl);
  if (s.services) throw new AwsError('ClusterContainsServicesException', 'The Cluster cannot be deleted while Services are active.', 400);
  if (s.running + s.pending) throw new AwsError('ClusterContainsTasksException', 'The Cluster cannot be deleted while Tasks are active.', 400);
  if (s.instances) throw new AwsError('ClusterContainsContainerInstancesException', 'The Cluster cannot be deleted while Container Instances are active or draining.', 400);
  cl.status = 'INACTIVE';
  return { cluster: { ...clusterView(c.acct, c.region, cl), status: 'INACTIVE' } };
});

op('ecs', 'update-cluster-settings', 'cluster:s! settings:f!', 'Activa o desactiva Container Insights en el clúster.', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.Cluster));
  for (const s of arr<Rec>(c.p.Settings)) if (s.name === 'containerInsights') cl.insights = s.value === 'enabled' || s.value === 'enhanced';
  return { cluster: clusterView(c.acct, c.region, cl) };
});

op('ecs', 'put-cluster-capacity-providers', 'cluster:s! capacity-providers:l! default-capacity-provider-strategy:f!', 'Asocia proveedores de capacidad (FARGATE, FARGATE_SPOT) al clúster y fija su estrategia por defecto.', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, String(c.p.Cluster));
  const providers = arr<string>(c.p.CapacityProviders);
  for (const p of providers) if (!['FARGATE', 'FARGATE_SPOT'].includes(p)) throw E.param(`The specified capacity provider ${p} was not found.`);
  const strat = strategyOf(c.p.DefaultCapacityProviderStrategy);
  checkProviders(strat, providers);
  cl.capacityProviders = providers;
  cl.defaultStrategy = strat;
  return { cluster: clusterView(c.acct, c.region, cl) };
});

op('ecs', 'describe-capacity-providers', 'capacity-providers:l', 'Los proveedores de capacidad disponibles: FARGATE y FARGATE_SPOT.', { res: () => '*' }, (c) => ({
  capacityProviders: ['FARGATE', 'FARGATE_SPOT'].filter((n) => !c.p.CapacityProviders || arr<string>(c.p.CapacityProviders).includes(n)).map((n) => ({ capacityProviderArn: mkArn('ecs', c.region, c.acct.id, `capacity-provider/${n}`), name: n, status: 'ACTIVE', tags: [] })),
}));

// ───────────────────────── instancias de contenedores (EC2) ─────────────────────────

interface CInst {
  id: string;
  arn: string;
  instanceId: string;
  cpu: number;
  mem: number;
  registeredAt: number;
  az: string;
  ip: string;
}

/** Instancias EC2 que se han unido al clúster: agente en marcha, `ECS_CLUSTER` en los datos de usuario y un rol que permita registrarse. */
export function containerInstances(a: Account, region: string, cluster: string): CInst[] {
  const r = refreshEc2(a, region);
  const out: CInst[] = [];
  for (const i of Object.values(r.instances)) {
    if (i.state !== 'running' || !new RegExp(`ECS_CLUSTER=${cluster}(\\s|$)`, 'm').test(i.UserData ?? '')) continue;
    const prof = i.IamInstanceProfile ? a.iam.instanceProfiles[i.IamInstanceProfile] : undefined;
    const role = prof?.roles[0] ? a.iam.roles[prof.roles[0]] : undefined;
    if (!role || !roleCan(a, role.Arn, ['ecs:RegisterContainerInstance', 'ecs:DiscoverPollEndpoint'])) continue;
    const reg = Date.parse(i.LaunchTime) + 90000;
    if (a.clock < Math.max(reg, i.stateAt + 60000)) continue;
    const info = instanceType(i.InstanceType);
    const id = stableId(`ci:${i.InstanceId}`, '', 32, 'hex');
    out.push({ id, arn: mkArn('ecs', region, a.id, `container-instance/${cluster}/${id}`), instanceId: i.InstanceId, cpu: (info?.vcpu ?? 1) * 1024, mem: Math.round((info?.mem ?? 1024) * 0.94), registeredAt: reg, az: i.AvailabilityZone, ip: i.PrivateIpAddress });
  }
  return out;
}

const taskNeeds = (t: EcsTask) => ({ cpu: Number(t.cpu), mem: Number(t.memory) });

/** Reserva en una instancia con hueco; devuelve el motivo si no cabe. */
function place(a: Account, region: string, cluster: string, cpu: number, mem: number): { inst?: CInst; reason?: string } {
  const list = containerInstances(a, region, cluster);
  if (!list.length) return { reason: 'No Container Instances were found in your cluster.' };
  const st = ecsOf(a, region);
  for (const ci of list) {
    const used = Object.values(st.tasks).filter((t) => t.containerInstance === ci.instanceId && t.desiredStatus === 'RUNNING' && (t.stoppedAt === undefined || a.clock < t.stoppedAt));
    const uc = used.reduce((n, t) => n + taskNeeds(t).cpu, 0);
    const um = used.reduce((n, t) => n + taskNeeds(t).mem, 0);
    if (ci.cpu - uc >= cpu && ci.mem - um >= mem) return { inst: ci };
  }
  const first = list[0];
  const st2 = Object.values(st.tasks).filter((t) => t.containerInstance === first.instanceId && t.desiredStatus === 'RUNNING');
  return { reason: st2.reduce((n, t) => n + taskNeeds(t).mem, 0) + mem > first.mem ? 'RESOURCE:MEMORY' : 'RESOURCE:CPU' };
}

op('ecs', 'list-container-instances', 'cluster:s max-results:i', 'Lista las instancias EC2 registradas en el clúster.', { res: () => '*', paginate: 'containerInstanceArns' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  return { containerInstanceArns: containerInstances(c.acct, c.region, cl.name).map((x) => x.arn) };
});

op('ecs', 'describe-container-instances', 'cluster:s container-instances:l!', 'Muestra la capacidad total y libre de cada instancia del clúster.', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const st = ecsOf(c.acct, c.region);
  const list = containerInstances(c.acct, c.region, cl.name);
  const want = arr<string>(c.p.ContainerInstances).map(nameOf);
  const out = list
    .filter((x) => want.includes(x.id))
    .map((x) => {
      const used = Object.values(st.tasks).filter((t) => t.containerInstance === x.instanceId && t.desiredStatus === 'RUNNING' && (t.stoppedAt === undefined || c.acct.clock < t.stoppedAt));
      const uc = used.reduce((n, t) => n + taskNeeds(t).cpu, 0);
      const um = used.reduce((n, t) => n + taskNeeds(t).mem, 0);
      const res = (cpu: number, mem: number) => [{ name: 'CPU', type: 'INTEGER', integerValue: cpu }, { name: 'MEMORY', type: 'INTEGER', integerValue: mem }];
      return { containerInstanceArn: x.arn, ec2InstanceId: x.instanceId, status: 'ACTIVE', agentConnected: true, runningTasksCount: used.length, pendingTasksCount: 0, registeredAt: x.registeredAt / 1000, remainingResources: res(x.cpu - uc, x.mem - um), registeredResources: res(x.cpu, x.mem), versionInfo: { agentVersion: '1.79.2' } };
    });
  return { containerInstances: out, failures: want.filter((w) => !list.some((x) => x.id === w)).map((w) => ({ arn: w, reason: 'MISSING' })) };
});

// ───────────────────────── tareas ─────────────────────────

const isoSec = (ms: number | undefined) => (ms === undefined ? undefined : ms / 1000);

export function taskView(a: Account, region: string, t: EcsTask) {
  const now = a.clock;
  const status = taskStatus(t, now);
  const td = ecsOf(a, region).taskDefs[t.taskDef];
  const eni = t.eniId ? ecsOf(a, region).enis[t.eniId] : undefined;
  const started = t.runningAt !== undefined && now >= t.runningAt;
  const exited = (cn: EcsTask['containers'][number]) => cn.exitCode !== undefined && started && t.stoppedAt !== undefined && now >= (t.stopRequestedAt ?? t.stoppedAt);
  const cstatus = (cn: EcsTask['containers'][number]) => (status === 'STOPPED' || exited(cn) ? 'STOPPED' : status === 'RUNNING' ? 'RUNNING' : status === 'ACTIVATING' ? 'PENDING' : 'PENDING');
  return {
    taskArn: t.arn,
    clusterArn: clusterArn(a, region, t.cluster),
    taskDefinitionArn: td?.arn ?? tdArn(a, region, t.taskDef.split(':')[0], Number(t.taskDef.split(':')[1])),
    ...(t.containerInstance ? { containerInstanceArn: mkArn('ecs', region, a.id, `container-instance/${t.cluster}/${stableId(`ci:${t.containerInstance}`, '', 32, 'hex')}`) } : {}),
    overrides: { containerOverrides: td?.containerDefinitions.map((d) => ({ name: d.name })) ?? [], inferenceAcceleratorOverrides: [] },
    lastStatus: status,
    desiredStatus: status === 'STOPPED' ? 'STOPPED' : t.desiredStatus,
    cpu: t.cpu,
    memory: t.memory,
    containers: t.containers.map((cn) => ({
      containerArn: mkArn('ecs', region, a.id, `container/${t.cluster}/${t.id}/${stableId(`ctr:${t.id}:${cn.name}`, '', 8, 'hex')}`),
      taskArn: t.arn,
      name: cn.name,
      image: cn.image,
      ...(cn.imageDigest ? { imageDigest: cn.imageDigest } : {}),
      runtimeId: `${t.id}-${stableId('rt:' + cn.name, '', 10, 'hex')}`,
      lastStatus: cstatus(cn),
      ...(cn.exitCode !== undefined && cstatus(cn) === 'STOPPED' ? { exitCode: cn.exitCode } : {}),
      ...(cn.reason && cstatus(cn) === 'STOPPED' ? { reason: cn.reason } : {}),
      networkBindings: [],
      networkInterfaces: t.privateIp ? [{ attachmentId: stableId(`att:${t.id}`, '', 8, 'hex') + '-' + stableId(`att2:${t.id}`, '', 4, 'hex'), privateIpv4Address: t.privateIp }] : [],
      healthStatus: t.unhealthyAt !== undefined && now >= t.unhealthyAt ? 'UNHEALTHY' : cn.health,
      cpu: '0',
    })),
    ...(t.startedBy ? { startedBy: t.startedBy } : {}),
    version: 3,
    connectivity: t.privateIp ? 'CONNECTED' : undefined,
    ...(t.privateIp ? { connectivityAt: t.pendingAt / 1000 } : {}),
    ...(t.pendingAt ? { pullStartedAt: t.pendingAt / 1000 + 1 } : {}),
    ...(t.pullDoneAt ? { pullStoppedAt: t.pullDoneAt / 1000 } : {}),
    createdAt: t.createdAt / 1000,
    ...(started ? { startedAt: t.runningAt! / 1000 } : {}),
    ...(t.stopRequestedAt !== undefined && now >= t.stopRequestedAt ? { stoppingAt: t.stopRequestedAt / 1000 } : {}),
    ...(status === 'STOPPED' ? { stoppedAt: isoSec(t.stoppedAt), stoppedReason: t.stoppedReason, stopCode: t.stopCode, executionStoppedAt: isoSec(t.stoppedAt) } : {}),
    launchType: t.launchType,
    ...(t.capacity ? { capacityProviderName: t.capacity } : {}),
    platformVersion: t.launchType === 'FARGATE' ? '1.4.0' : undefined,
    platformFamily: t.launchType === 'FARGATE' ? 'Linux' : undefined,
    group: t.group,
    attachments: eni
      ? [{ id: stableId(`att:${t.id}`, '', 8, 'hex') + '-' + stableId(`att2:${t.id}`, '', 4, 'hex'), type: 'ElasticNetworkInterface', status: status === 'STOPPED' ? 'DELETED' : 'ATTACHED', details: [{ name: 'subnetId', value: eni.subnetId }, { name: 'networkInterfaceId', value: eni.id }, { name: 'macAddress', value: '0a:' + stableId(`mac:${eni.id}`, '', 10, 'hex').replace(/(..)/g, '$1:').slice(0, 14) }, { name: 'privateDnsName', value: `ip-${eni.privateIp.replace(/\./g, '-')}.ec2.internal` }, { name: 'privateIPv4Address', value: eni.privateIp }] }]
      : [],
    ...(t.az ? { availabilityZone: t.az } : {}),
    enableExecuteCommand: false,
    healthStatus: t.unhealthyAt !== undefined && now >= t.unhealthyAt ? 'UNHEALTHY' : t.containers.some((x) => x.health === 'HEALTHY') ? 'HEALTHY' : 'UNKNOWN',
    tags: t.tags,
  };
}

const netOf = (v: unknown): EcsNet | undefined => {
  const cfg = (v as { awsvpcConfiguration?: Rec } | undefined)?.awsvpcConfiguration;
  if (!cfg) return undefined;
  return { subnets: arr<string>(cfg.subnets).map(String), securityGroups: arr<string>(cfg.securityGroups).map(String), assignPublicIp: String(cfg.assignPublicIp ?? 'DISABLED') as 'ENABLED' | 'DISABLED' };
};

function checkNet(a: Account, region: string, net: EcsNet | undefined, td: EcsTaskDef): EcsNet | undefined {
  if (td.networkMode !== 'awsvpc') return undefined;
  if (!net) throw E.param("Network Configuration must be provided when networkMode 'awsvpc' is specified.");
  if (!net.subnets.length) throw E.param('subnets can not be empty.');
  const r = regional(a, region).ec2;
  for (const s of net.subnets) if (!r.subnets[s]) throw E.param(`The subnet ID '${s}' does not exist`);
  const vpcs = new Set(net.subnets.map((s) => r.subnets[s].VpcId));
  if (vpcs.size > 1) throw E.param('The subnets specified belong to different VPCs.');
  for (const g of net.securityGroups) if (!r.securityGroups[g]) throw E.param(`The security group '${g}' does not exist`);
  for (const g of net.securityGroups) if (r.securityGroups[g].VpcId !== [...vpcs][0]) throw E.param(`The security group '${g}' does not belong to the same VPC as the subnets.`);
  return net;
}

const passRoleTargets = (c: OpCtx, td: EcsTaskDef | undefined) =>
  [td?.executionRoleArn, td?.taskRoleArn].filter(Boolean).map((arn) => ({ action: 'iam:PassRole', resource: arn as string, context: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } }));

const tdFor = (c: OpCtx): EcsTaskDef | undefined => {
  try {
    return c.p.TaskDefinition ? findTaskDef(c.acct, c.region, String(c.p.TaskDefinition)) : undefined;
  } catch {
    return undefined;
  }
};

op('ecs', 'run-task', 'cluster:s task-definition:s! count:i launch-type:s capacity-provider-strategy:f platform-version:s network-configuration:j overrides:j started-by:s group:s tags:t enable-execute-command:b', 'Lanza tareas sueltas (una sola vez, sin servicio que las mantenga): trabajos, migraciones, pruebas.', {
  res: () => '*',
  authz: (c) => [{ action: 'ecs:RunTask', resource: '*' }, ...passRoleTargets(c, tdFor(c))],
}, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const td = findTaskDef(c.acct, c.region, String(c.p.TaskDefinition));
  if (td.status !== 'ACTIVE') throw E.client('TaskDefinition is inactive');
  const count = num(c.p.Count) ?? 1;
  if (count < 1 || count > 10) throw E.param('Count must be between 1 and 10.');
  const strat = strategyOf(c.p.CapacityProviderStrategy);
  let launchType = (c.p.LaunchType as 'FARGATE' | 'EC2' | undefined) ?? (strat.length ? 'FARGATE' : cl.defaultStrategy.length ? 'FARGATE' : 'EC2');
  if (!['FARGATE', 'EC2'].includes(launchType)) throw E.param(`Unsupported launch type '${launchType}'.`);
  if (launchType === 'FARGATE' && !td.requiresCompatibilities.includes('FARGATE')) throw E.param('Task definition does not support launch_type FARGATE.');
  if (strat.length) checkProviders(strat, cl.capacityProviders);
  const effective = strat.length ? strat : cl.defaultStrategy;
  if (!c.p.LaunchType && !strat.length && cl.defaultStrategy.length) launchType = 'FARGATE';
  const net = checkNet(c.acct, c.region, netOf(c.p.NetworkConfiguration), td);
  const overrides = arr<Rec>((c.p.Overrides as { containerOverrides?: Rec[] } | undefined)?.containerOverrides).map((o) => ({ name: String(o.name), ...(o.command ? { command: arr<string>(o.command).map(String) } : {}), ...(o.environment ? { environment: arr<Rec>(o.environment).map((e) => ({ name: String(e.name), value: String(e.value) })) } : {}) }));
  const tasks: unknown[] = [];
  const failures: unknown[] = [];
  const mem = parseMem(td.memory) ?? td.containerDefinitions.reduce((n, d) => n + (d.memory ?? d.memoryReservation ?? 0), 0);
  const cpu = parseCpu(td.cpu) ?? td.containerDefinitions.reduce((n, d) => n + (d.cpu ?? 0), 0);
  for (let k = 0; k < count; k++) {
    let host: string | undefined;
    if (launchType === 'EC2') {
      const p = place(c.acct, c.region, cl.name, cpu, mem);
      if (!p.inst) {
        failures.push({ arn: '', reason: p.reason });
        continue;
      }
      host = p.inst.instanceId;
    }
    const capacity = launchType === 'FARGATE' && effective.length ? (effective.find((s) => (s.weight ?? 1) > 0)?.capacityProvider as 'FARGATE' | 'FARGATE_SPOT') : launchType === 'FARGATE' ? 'FARGATE' : undefined;
    const t = launchTask(c.acct, c.region, cl, { taskDef: td, launchType, capacity, net, startedBy: c.p.StartedBy as string | undefined, group: String(c.p.Group ?? `family:${td.family}`), overrides, tags: (c.p.Tags as Tag[]) ?? [] }, c.acct.clock);
    if (host) {
      t.containerInstance = host;
      const inst = refreshEc2(c.acct, c.region).instances[host];
      t.privateIp ??= inst?.PrivateIpAddress;
    }
    tasks.push(taskView(c.acct, c.region, t));
  }
  return { tasks, failures };
});

const findTasks = (c: OpCtx, cl: EcsCluster, refs: string[]) => {
  const st = ecsOf(c.acct, c.region);
  const tasks: EcsTask[] = [];
  const failures: unknown[] = [];
  for (const r of refs) {
    const id = nameOf(r);
    const t = st.tasks[id];
    if (t && t.cluster === cl.name) tasks.push(t);
    else failures.push({ arn: r.startsWith('arn:') ? r : taskArn(c.acct, c.region, cl.name, id), reason: 'MISSING' });
  }
  return { tasks, failures };
};

op('ecs', 'describe-tasks', 'cluster:s tasks:l! include:l', 'Estado de las tareas: estado actual (`lastStatus`), IP, contenedores, código de salida y por qué se detuvieron (`stoppedReason`).', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const r = findTasks(c, cl, arr<string>(c.p.Tasks));
  return { tasks: r.tasks.map((t) => taskView(c.acct, c.region, t)), failures: r.failures };
});

op('ecs', 'list-tasks', 'cluster:s container-instance:s family:s started-by:s service-name:s desired-status:s launch-type:s max-results:i', 'Lista las ARN de las tareas (por defecto las que deben estar en marcha).', { res: () => '*', paginate: 'taskArns' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const st = ecsOf(c.acct, c.region);
  const want = String(c.p.DesiredStatus ?? 'RUNNING');
  const list = Object.values(st.tasks).filter((t) => {
    if (t.cluster !== cl.name) return false;
    const status = taskStatus(t, c.acct.clock);
    if (want === 'RUNNING' ? status === 'STOPPED' : status !== 'STOPPED') return false;
    if (c.p.Family && !t.taskDef.startsWith(c.p.Family + ':')) return false;
    if (c.p.ServiceName && t.serviceName !== c.p.ServiceName) return false;
    if (c.p.StartedBy && t.startedBy !== c.p.StartedBy) return false;
    if (c.p.LaunchType && t.launchType !== c.p.LaunchType) return false;
    return true;
  });
  list.sort((x, y) => y.createdAt - x.createdAt);
  return { taskArns: list.map((t) => t.arn) };
});

op('ecs', 'stop-task', 'cluster:s task:s! reason:s', 'Detiene una tarea. Si es de un servicio, el servicio lanzará otra para sustituirla.', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const r = findTasks(c, cl, [String(c.p.Task)]);
  if (!r.tasks.length) throw new AwsError('InvalidParameterException', 'The referenced task was not found.', 400);
  const t = r.tasks[0];
  if (taskStatus(t, c.acct.clock) !== 'STOPPED') stopTask(t, c.acct.clock, 'UserInitiated', String(c.p.Reason ?? 'Task stopped by user'));
  return { task: taskView(c.acct, c.region, t) };
});

// ───────────────────────── servicios ─────────────────────────

const depView = (d: EcsDeployment, a: Account, region: string, svc: EcsService) => {
  const ts = Object.values(ecsOf(a, region).tasks).filter((t) => t.serviceName === svc.name && t.cluster === svc.cluster && t.deploymentId === d.id);
  const live = ts.filter((t) => t.desiredStatus === 'RUNNING' && taskStatus(t, a.clock) !== 'STOPPED');
  const running = live.filter((t) => taskStatus(t, a.clock) === 'RUNNING').length;
  return {
    id: d.id,
    status: d.status,
    taskDefinition: tdArn(a, region, d.taskDefinition.split(':')[0], Number(d.taskDefinition.split(':')[1])),
    desiredCount: d.status === 'PRIMARY' ? svc.desiredCount : 0,
    pendingCount: live.length - running,
    runningCount: running,
    failedTasks: d.failedTasks,
    createdAt: d.createdAt / 1000,
    updatedAt: d.updatedAt / 1000,
    ...(d.launchType ? { launchType: d.launchType } : {}),
    platformVersion: svc.platformVersion,
    platformFamily: 'Linux',
    ...(svc.net ? { networkConfiguration: { awsvpcConfiguration: svc.net } } : {}),
    rolloutState: d.rolloutState,
    rolloutStateReason: d.rolloutStateReason,
  };
};

export function serviceView(a: Account, region: string, svc: EcsService) {
  const live = Object.values(ecsOf(a, region).tasks).filter((t) => t.serviceName === svc.name && t.cluster === svc.cluster && t.desiredStatus === 'RUNNING' && taskStatus(t, a.clock) !== 'STOPPED');
  const running = live.filter((t) => taskStatus(t, a.clock) === 'RUNNING').length;
  return {
    serviceArn: svc.arn,
    serviceName: svc.name,
    clusterArn: clusterArn(a, region, svc.cluster),
    loadBalancers: svc.loadBalancers,
    serviceRegistries: [],
    status: svc.status,
    desiredCount: svc.desiredCount,
    runningCount: running,
    pendingCount: live.length - running,
    ...(svc.launchType ? { launchType: svc.launchType } : {}),
    ...(svc.capacityProviderStrategy ? { capacityProviderStrategy: svc.capacityProviderStrategy.map((x) => ({ capacityProvider: x.capacityProvider, weight: x.weight ?? 0, base: x.base ?? 0 })) } : {}),
    platformVersion: svc.platformVersion,
    platformFamily: 'Linux',
    taskDefinition: tdArn(a, region, (svc.deployments.find((d) => d.status === 'PRIMARY') ?? svc.deployments[0])?.taskDefinition.split(':')[0] ?? '', Number((svc.deployments.find((d) => d.status === 'PRIMARY') ?? svc.deployments[0])?.taskDefinition.split(':')[1] ?? 1)),
    deploymentConfiguration: { deploymentCircuitBreaker: { enable: svc.circuitBreaker.enable, rollback: svc.circuitBreaker.rollback }, maximumPercent: svc.maxPercent, minimumHealthyPercent: svc.minHealthyPercent },
    deployments: svc.deployments.map((d) => depView(d, a, region, svc)),
    ...(svc.roleArn ? { roleArn: svc.roleArn } : {}),
    events: svc.events.map((e) => ({ id: e.id, createdAt: e.createdAt / 1000, message: e.message })),
    createdAt: svc.createdAt / 1000,
    placementConstraints: [],
    placementStrategy: [],
    ...(svc.net ? { networkConfiguration: { awsvpcConfiguration: svc.net } } : {}),
    healthCheckGracePeriodSeconds: svc.healthCheckGracePeriodSeconds,
    schedulingStrategy: 'REPLICA',
    deploymentController: { type: 'ECS' },
    createdBy: 'arn:aws:iam::123456789012:user/alumno',
    enableECSManagedTags: false,
    propagateTags: 'NONE',
    enableExecuteCommand: !!svc.enableExecuteCommand,
    tags: svc.tags,
  };
}

const findSvc = (c: OpCtx, cl: EcsCluster, ref: string): EcsService => {
  const s = ecsOf(c.acct, c.region).services[`${cl.name}/${nameOf(ref)}`];
  if (!s || s.status === 'INACTIVE') throw E.service();
  return s;
};

function parseDeploymentConfig(v: unknown, svc: Pick<EcsService, 'minHealthyPercent' | 'maxPercent' | 'circuitBreaker'>) {
  const d = v as { maximumPercent?: unknown; minimumHealthyPercent?: unknown; deploymentCircuitBreaker?: { enable?: unknown; rollback?: unknown } } | undefined;
  if (!d) return;
  if (num(d.maximumPercent) !== undefined) svc.maxPercent = num(d.maximumPercent)!;
  if (num(d.minimumHealthyPercent) !== undefined) svc.minHealthyPercent = num(d.minimumHealthyPercent)!;
  if (d.deploymentCircuitBreaker) svc.circuitBreaker = { enable: bool(d.deploymentCircuitBreaker.enable), rollback: bool(d.deploymentCircuitBreaker.rollback) };
  if (svc.maxPercent < svc.minHealthyPercent) throw E.param('maximumPercent should be greater than or equal to minimumHealthyPercent.');
}

function checkLoadBalancers(a: Account, region: string, lbs: EcsService['loadBalancers'], td: EcsTaskDef) {
  for (const lb of lbs) {
    let tg;
    try {
      tg = findTg(a, region, lb.targetGroupArn);
    } catch {
      throw E.param(`The target group with targetGroupArn ${lb.targetGroupArn} does not exist.`);
    }
    if (!lbsUsing(a, region, tg.TargetGroupArn).length) throw E.param(`The target group with targetGroupArn ${lb.targetGroupArn} does not have an associated load balancer.`);
    if (td.networkMode === 'awsvpc' && tg.TargetType !== 'ip') throw E.param(`The provided target group ${lb.targetGroupArn} has target type ${tg.TargetType}, which is incompatible with the awsvpc network mode specified in the task definition.`);
    if (td.networkMode !== 'awsvpc') throw E.param('Load balancers are only supported in this simulator for tasks with the awsvpc network mode.');
    const def = td.containerDefinitions.find((d) => d.name === lb.containerName);
    if (!def) throw E.param(`The container ${lb.containerName} does not exist in the task definition.`);
    if (!def.portMappings.some((p) => p.containerPort === lb.containerPort)) throw E.param(`The container ${lb.containerName} did not have a container port ${lb.containerPort} defined.`);
  }
}

op('ecs', 'create-service', 'cluster:s service-name:s! task-definition:s desired-count:i client-token:s launch-type:s capacity-provider-strategy:f platform-version:s role:s load-balancers:f network-configuration:j deployment-configuration:j health-check-grace-period-seconds:i scheduling-strategy:s deployment-controller:j tags:t enable-execute-command:b propagate-tags:s enable-ecs-managed-tags:b', 'Crea un servicio: mantiene en marcha el número de tareas que pides, las sustituye si fallan, despliega versiones nuevas por tandas y las registra en un balanceador.', {
  res: () => '*',
  authz: (c) => [{ action: 'ecs:CreateService', resource: '*' }, ...passRoleTargets(c, tdFor(c))],
}, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const name = String(c.p.ServiceName);
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(name)) throw E.param('Service name can only contain letters, numbers, hyphens and underscores.');
  const st = ecsOf(c.acct, c.region);
  const old = st.services[`${cl.name}/${name}`];
  if (old && old.status === 'ACTIVE') throw E.param('Creation of service was not idempotent.');
  if (!c.p.TaskDefinition) throw E.param('Task definition is required.');
  const td = findTaskDef(c.acct, c.region, String(c.p.TaskDefinition));
  if (td.status !== 'ACTIVE') throw E.client('TaskDefinition is inactive');
  const strat = strategyOf(c.p.CapacityProviderStrategy);
  if (strat.length) checkProviders(strat, cl.capacityProviders);
  const effective = strat.length ? strat : c.p.LaunchType ? [] : cl.defaultStrategy;
  const launchType = (c.p.LaunchType as 'FARGATE' | 'EC2' | undefined) ?? (effective.length ? 'FARGATE' : 'EC2');
  if (launchType === 'FARGATE' && !td.requiresCompatibilities.includes('FARGATE')) throw E.param('Task definition does not support launch_type FARGATE.');
  const net = checkNet(c.acct, c.region, netOf(c.p.NetworkConfiguration), td);
  const lbs = arr<Rec>(c.p.LoadBalancers).map((l) => ({ targetGroupArn: String(l.targetGroupArn), containerName: String(l.containerName), containerPort: Number(l.containerPort) }));
  checkLoadBalancers(c.acct, c.region, lbs, td);
  const svc: EcsService = {
    name,
    arn: serviceArn(c.acct, c.region, cl.name, name),
    cluster: cl.name,
    status: 'ACTIVE',
    desiredCount: num(c.p.DesiredCount) ?? 1,
    ...(effective.length ? { capacityProviderStrategy: effective } : { launchType }),
    platformVersion: String(c.p.PlatformVersion ?? 'LATEST'),
    loadBalancers: lbs,
    ...(net ? { net } : {}),
    minHealthyPercent: 100,
    maxPercent: 200,
    circuitBreaker: { enable: false, rollback: false },
    healthCheckGracePeriodSeconds: num(c.p.HealthCheckGracePeriodSeconds) ?? 0,
    deployments: [],
    events: [],
    createdAt: c.acct.clock,
    ...(c.p.Role ? { roleArn: String(c.p.Role) } : {}),
    tags: (c.p.Tags as Tag[]) ?? [],
    simAt: c.acct.clock,
    holdUntil: 0,
    enableExecuteCommand: bool(c.p.EnableExecuteCommand),
  };
  if (lbs.length && num(c.p.HealthCheckGracePeriodSeconds) === undefined) svc.healthCheckGracePeriodSeconds = 0;
  parseDeploymentConfig(c.p.DeploymentConfiguration, svc);
  svc.deployments.push({ id: depId(c.acct, svc, 1), status: 'PRIMARY', taskDefinition: `${td.family}:${td.revision}`, desiredCount: svc.desiredCount, createdAt: c.acct.clock, updatedAt: c.acct.clock, failedTasks: 0, consecutiveFails: 0, rolloutState: 'IN_PROGRESS', rolloutStateReason: 'ECS deployment in progress.', launchType: svc.launchType });
  st.services[`${cl.name}/${name}`] = svc;
  reconcileNow(c.acct, c.region, svc);
  return { service: serviceView(c.acct, c.region, svc) };
});

op('ecs', 'describe-services', 'cluster:s services:l! include:l', 'Estado de los servicios: despliegues, número de tareas, y los eventos recientes (la primera pista cuando algo no arranca).', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const services: unknown[] = [];
  const failures: unknown[] = [];
  for (const r of arr<string>(c.p.Services)) {
    const s = ecsOf(c.acct, c.region).services[`${cl.name}/${nameOf(r)}`];
    if (s) services.push(serviceView(c.acct, c.region, s));
    else failures.push({ arn: serviceArn(c.acct, c.region, cl.name, nameOf(r)), reason: 'MISSING' });
  }
  return { services, failures };
});

op('ecs', 'list-services', 'cluster:s launch-type:s scheduling-strategy:s max-results:i', 'Lista las ARN de los servicios del clúster.', { res: () => '*', paginate: 'serviceArns' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  return { serviceArns: Object.values(ecsOf(c.acct, c.region).services).filter((s) => s.cluster === cl.name && s.status === 'ACTIVE' && (!c.p.LaunchType || s.launchType === c.p.LaunchType)).map((s) => s.arn) };
});

op('ecs', 'update-service', 'cluster:s service:s! desired-count:i task-definition:s capacity-provider-strategy:f deployment-configuration:j network-configuration:j platform-version:s force-new-deployment:b health-check-grace-period-seconds:i load-balancers:f enable-execute-command:b', 'Cambia el servicio: número de tareas, versión de la definición de tarea (despliegue por tandas), red o configuración de despliegue.', {
  res: () => '*',
  authz: (c) => [{ action: 'ecs:UpdateService', resource: '*' }, ...passRoleTargets(c, tdFor(c))],
}, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const svc = findSvc(c, cl, String(c.p.Service));
  const prim = svc.deployments.find((d) => d.status === 'PRIMARY')!;
  let td = findTaskDef(c.acct, c.region, prim.taskDefinition);
  let newDep = bool(c.p.ForceNewDeployment);
  if (c.p.TaskDefinition) {
    td = findTaskDef(c.acct, c.region, String(c.p.TaskDefinition));
    if (td.status !== 'ACTIVE') throw E.client('TaskDefinition is inactive');
    if (`${td.family}:${td.revision}` !== prim.taskDefinition) newDep = true;
  }
  if (num(c.p.DesiredCount) !== undefined) svc.desiredCount = num(c.p.DesiredCount)!;
  if (c.p.NetworkConfiguration) {
    svc.net = checkNet(c.acct, c.region, netOf(c.p.NetworkConfiguration), td);
    newDep = true;
  }
  if (c.p.CapacityProviderStrategy) {
    const strat = strategyOf(c.p.CapacityProviderStrategy);
    checkProviders(strat, cl.capacityProviders);
    svc.capacityProviderStrategy = strat;
    svc.launchType = undefined;
    newDep = true;
  }
  if (c.p.LoadBalancers) {
    const lbs = arr<Rec>(c.p.LoadBalancers).map((l) => ({ targetGroupArn: String(l.targetGroupArn), containerName: String(l.containerName), containerPort: Number(l.containerPort) }));
    checkLoadBalancers(c.acct, c.region, lbs, td);
    svc.loadBalancers = lbs;
    newDep = true;
  }
  if (num(c.p.HealthCheckGracePeriodSeconds) !== undefined) svc.healthCheckGracePeriodSeconds = num(c.p.HealthCheckGracePeriodSeconds)!;
  if (c.p.EnableExecuteCommand !== undefined) svc.enableExecuteCommand = bool(c.p.EnableExecuteCommand);
  parseDeploymentConfig(c.p.DeploymentConfiguration, svc);
  if (newDep) {
    prim.status = 'ACTIVE';
    svc.deployments.unshift({ id: depId(c.acct, svc, svc.deployments.length + 2 + Object.keys(ecsOf(c.acct, c.region).tasks).length), status: 'PRIMARY', taskDefinition: `${td.family}:${td.revision}`, desiredCount: svc.desiredCount, createdAt: c.acct.clock, updatedAt: c.acct.clock, failedTasks: 0, consecutiveFails: 0, rolloutState: 'IN_PROGRESS', rolloutStateReason: 'ECS deployment in progress.', launchType: svc.launchType });
    svc.holdUntil = 0;
    svc.steady = false;
  } else prim.desiredCount = svc.desiredCount;
  reconcileNow(c.acct, c.region, svc);
  return { service: serviceView(c.acct, c.region, svc) };
});

op('ecs', 'delete-service', 'cluster:s service:s! force:b', 'Borra un servicio. Con tareas deseadas hace falta `--force` (o bajar antes el número a 0).', { res: () => '*' }, (c) => {
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const svc = findSvc(c, cl, String(c.p.Service));
  if (svc.desiredCount > 0 && !bool(c.p.Force)) throw E.param('The service cannot be stopped while it is scaled above 0.');
  svc.desiredCount = 0;
  svc.status = 'DRAINING';
  reconcileNow(c.acct, c.region, svc);
  return { service: serviceView(c.acct, c.region, svc) };
});

// ───────────────────────── etiquetas ─────────────────────────

const taggable = (c: OpCtx, arnStr: string): { tags: Tag[]; set: (t: Tag[]) => void } => {
  const st = ecsOf(c.acct, c.region);
  const cl = Object.values(st.clusters).find((x) => x.arn === arnStr);
  if (cl) return { tags: cl.tags, set: (t) => (cl.tags = t) };
  const sv = Object.values(st.services).find((x) => x.arn === arnStr);
  if (sv) return { tags: sv.tags, set: (t) => (sv.tags = t) };
  const td = Object.values(st.taskDefs).find((x) => x.arn === arnStr);
  if (td) return { tags: td.tags, set: (t) => (td.tags = t) };
  const tk = Object.values(st.tasks).find((x) => x.arn === arnStr);
  if (tk) return { tags: tk.tags, set: (t) => (tk.tags = t) };
  throw E.param('The specified resource was not found.');
};

op('ecs', 'tag-resource', 'resource-arn:s! tags:t!', 'Añade etiquetas a un clúster, servicio, definición de tarea o tarea.', { res: (c) => c.p.ResourceArn }, (c) => {
  const x = taggable(c, String(c.p.ResourceArn));
  x.set(mergeTags(x.tags, c.p.Tags as Tag[]));
  return {};
});
op('ecs', 'untag-resource', 'resource-arn:s! tag-keys:l!', 'Quita etiquetas.', { res: (c) => c.p.ResourceArn }, (c) => {
  const x = taggable(c, String(c.p.ResourceArn));
  x.set(x.tags.filter((t) => !arr<string>(c.p.TagKeys).includes(t.Key)));
  return {};
});
op('ecs', 'list-tags-for-resource', 'resource-arn:s!', 'Lista las etiquetas.', { res: (c) => c.p.ResourceArn }, (c) => ({ tags: taggable(c, String(c.p.ResourceArn)).tags.map((t) => ({ key: t.Key, value: t.Value })) }));

// ───────────────────────── esperas ─────────────────────────

const WAITERS: Record<string, string> = { 'services-stable': 'ServicesStable', 'services-inactive': 'ServicesInactive', 'tasks-running': 'TasksRunning', 'tasks-stopped': 'TasksStopped' };

op('ecs', 'wait', 'waiter:s! cluster:s services:l tasks:l', 'Espera a que se cumpla algo: `services-stable` (el despliegue terminó), `services-inactive`, `tasks-running`, `tasks-stopped`.', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = String(c.p.Waiter);
  if (!WAITERS[w]) throw new AwsError('InvalidWaiter', `Invalid choice: '${w}', valid choices are: ${Object.keys(WAITERS).join(' | ')}`, 252);
  const cl = findCluster(c.acct, c.region, c.p.Cluster as string | undefined);
  const st = ecsOf(c.acct, c.region);
  const fail = (m: string) => new AwsError('WaiterError', `Waiter ${WAITERS[w]} failed: ${m}`, 255);
  const maxAttempts = w.startsWith('services') ? 40 : 100;
  for (let k = 0; k < maxAttempts; k++) {
    advanceEcs(c.acct, c.acct.clock);
    if (w === 'services-stable' || w === 'services-inactive') {
      const names = arr<string>(c.p.Services).map(nameOf);
      const svcs = names.map((n) => st.services[`${cl.name}/${n}`]);
      if (svcs.some((s) => !s)) throw fail('Waiter encountered a terminal failure state: For expression "failures[].reason" we matched expected path: "MISSING"');
      if (w === 'services-inactive' ? svcs.every((s) => s.status === 'INACTIVE') : svcs.every((s) => { const v = serviceView(c.acct, c.region, s); return s.status === 'ACTIVE' && v.deployments.length === 1 && v.desiredCount === v.runningCount; })) return undefined;
    } else {
      const ids = arr<string>(c.p.Tasks).map(nameOf);
      const tasks = ids.map((i) => st.tasks[i]);
      if (tasks.some((t) => !t)) throw fail('Waiter encountered a terminal failure state: For expression "failures[].reason" we matched expected path: "MISSING"');
      const status = tasks.map((t) => taskStatus(t, c.acct.clock) as TaskStatus);
      if (w === 'tasks-running') {
        if (status.some((s) => s === 'STOPPED')) throw fail('Waiter encountered a terminal failure state: For expression "tasks[].lastStatus" we matched expected path: "STOPPED"');
        if (status.every((s) => s === 'RUNNING')) return undefined;
      } else if (status.every((s) => s === 'STOPPED')) return undefined;
    }
    c.acct.clock += 15000;
  }
  throw fail('Max attempts exceeded');
});

// ───────────────────────── limpieza ─────────────────────────

tickers.push((a) => {
  for (const r of Object.values(a.regions)) {
    const st = r.ecs;
    if (!st) continue;
    for (const [id, t] of Object.entries(st.tasks)) {
      if (t.stoppedAt !== undefined && a.clock - t.stoppedAt > 3600000) {
        if (t.eniId) delete st.enis[t.eniId];
        delete st.tasks[id];
      }
    }
  }
});

