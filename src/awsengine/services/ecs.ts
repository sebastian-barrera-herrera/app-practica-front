/** Amazon ECS: el modelo (clústeres, definiciones de tarea, servicios, tareas), cómo arranca una tarea y el planificador de los servicios. */
import { regional } from '../account';
import { authorize } from '../authz';
import { baseAsImage, findBase } from '../containers/catalog';
import { containerHttp, runContainer, type RunOpts } from '../containers/runtime';
import { lambdaAwsReach } from '../lambdanet';
import { bestRoute, routeTableFor } from '../net';
import { AwsError } from '../registry';
import { roleCaller } from '../sdk';
import { tickers } from '../tick';
import type { Account, Ec2Region } from '../types';
import type { EcsCluster, EcsContainerDef, EcsDeployment, EcsEni, EcsNet, EcsService, EcsState, EcsTask, EcsTaskDef, ImageData } from '../types-containers';
import { fakeIp, intToIp, mkArn, parseCidr, stableId } from '../util';
import { roleTrusts } from './flowlogs';
import { deregister, findTg, ipTargets, targetHealth } from './elb';
import { logsCreateGroup, logsPut } from './logs';
import { ecrPullAs } from './ecr';
import { findSecret } from './secrets';

export const ecsOf = (a: Account, region: string): EcsState => (regional(a, region).ecs ??= { clusters: {}, taskDefs: {}, families: {}, services: {}, tasks: {}, enis: {}, counter: 0 });

export const clusterArn = (a: Account, region: string, name: string) => mkArn('ecs', region, a.id, `cluster/${name}`);
export const tdArn = (a: Account, region: string, family: string, rev: number) => mkArn('ecs', region, a.id, `task-definition/${family}:${rev}`);
export const serviceArn = (a: Account, region: string, cluster: string, name: string) => mkArn('ecs', region, a.id, `service/${cluster}/${name}`);
export const taskArn = (a: Account, region: string, cluster: string, id: string) => mkArn('ecs', region, a.id, `task/${cluster}/${id}`);

export const E = {
  client: (m: string) => new AwsError('ClientException', m, 400),
  param: (m: string) => new AwsError('InvalidParameterException', m, 400),
  cluster: () => new AwsError('ClusterNotFoundException', 'Cluster not found.', 400),
  service: () => new AwsError('ServiceNotFoundException', 'Service not found.', 400),
};

export const nameOf = (ref: string) => (ref.includes('/') ? ref.split('/').pop()! : ref);

export function findCluster(a: Account, region: string, ref?: string): EcsCluster {
  const name = nameOf(ref ?? 'default');
  const c = ecsOf(a, region).clusters[name];
  if (!c || c.status === 'INACTIVE') throw E.cluster();
  return c;
}

/** `family`, `family:revision` o ARN → definición de tarea. */
export function findTaskDef(a: Account, region: string, ref: string): EcsTaskDef {
  const st = ecsOf(a, region);
  const key = nameOf(ref);
  if (st.taskDefs[key]) return st.taskDefs[key];
  const latest = st.families[key];
  const td = latest ? Object.values(st.taskDefs).filter((t) => t.family === key && t.status === 'ACTIVE').sort((x, y) => y.revision - x.revision)[0] : undefined;
  if (td) return td;
  throw E.client('Unable to describe task definition.');
}

// ───────────────────────── Fargate: combinaciones válidas ─────────────────────────

const GB = 1024;
const steps = (from: number, to: number, by = GB) => {
  const out: number[] = [];
  for (let m = from; m <= to; m += by) out.push(m);
  return out;
};
const FARGATE_MEM: Record<number, number[]> = {
  256: [512, 1 * GB, 2 * GB],
  512: steps(1 * GB, 4 * GB),
  1024: steps(2 * GB, 8 * GB),
  2048: steps(4 * GB, 16 * GB),
  4096: steps(8 * GB, 30 * GB),
  8192: steps(16 * GB, 60 * GB, 4 * GB),
  16384: steps(32 * GB, 120 * GB, 8 * GB),
};

/** `"1024"`, `"1 vCPU"`, `"0.25 vCPU"` → unidades de CPU. */
export function parseCpu(v: string | number | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const s = String(v).toLowerCase().trim();
  const m = /^([\d.]+)\s*(vcpu|v?cpus?)?$/.exec(s);
  if (!m) return undefined;
  return m[2] ? Math.round(Number(m[1]) * 1024) : Number(m[1]);
}

/** `"2048"`, `"2GB"`, `"2 GB"` → MiB. */
export function parseMem(v: string | number | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const s = String(v).toLowerCase().trim();
  const m = /^([\d.]+)\s*(gb|gib)?$/.exec(s);
  if (!m) return undefined;
  return m[2] ? Math.round(Number(m[1]) * 1024) : Number(m[1]);
}

export const fargateValid = (cpu: number, mem: number) => (FARGATE_MEM[cpu] ?? []).includes(mem);

// ───────────────────────── red de las tareas ─────────────────────────

const VPC_OF = (r: Ec2Region, subnetId: string) => r.subnets[subnetId]?.VpcId ?? '';

/** Siguiente IP libre de una subred (se evitan las cuatro primeras, las de los balanceadores y las que ya se usan). */
export function allocIp(a: Account, region: string, subnetId: string, extraUsed: Set<string> = new Set()): string {
  const r = regional(a, region).ec2;
  const c = parseCidr(r.subnets[subnetId]?.CidrBlock ?? '10.0.0.0/24')!;
  const used = new Set<string>(extraUsed);
  for (const i of Object.values(r.instances)) if (i.SubnetId === subnetId) used.add(i.PrivateIpAddress);
  for (const e of Object.values(r.endpoints ?? {})) for (const [sub, ip] of Object.entries(e.ips)) if (sub === subnetId) used.add(ip);
  for (const e of Object.values(ecsOf(a, region).enis)) if (e.subnetId === subnetId) used.add(e.privateIp);
  const size = 2 ** (32 - c.bits);
  for (let k = 20; k < size - 1; k++) {
    const ip = intToIp(c.base + k);
    if (!used.has(ip)) return ip;
  }
  throw E.client('There are no free IP addresses in the subnet.');
}

const defaultSg = (r: Ec2Region, vpcId: string) => Object.values(r.securityGroups).find((g) => g.VpcId === vpcId && g.GroupName === 'default')?.GroupId;

/** Tipos de salida que necesita una tarea para arrancar (qué servicios de AWS tiene que alcanzar). */
export function taskReach(a: Account, region: string, net: EcsNet, publicIp: boolean, service: string): { ok: boolean; why?: string } {
  const r = regional(a, region).ec2;
  const subnetId = net.subnets[0];
  const vpcId = VPC_OF(r, subnetId);
  if (publicIp && service !== 'internet-only') {
    const rt = routeTableFor(r, subnetId);
    const def = rt ? bestRoute(r, rt, '93.184.216.34') : undefined;
    if (def?.target.startsWith('igw-')) return { ok: true };
  }
  return lambdaAwsReach(a, region, { SubnetIds: net.subnets, SecurityGroupIds: net.securityGroups, VpcId: vpcId }, service);
}

function newEni(a: Account, region: string, taskArnStr: string, net: EcsNet, subnetId: string): EcsEni {
  const r = regional(a, region).ec2;
  const sub = r.subnets[subnetId];
  const sgIds = net.securityGroups.length ? net.securityGroups : [defaultSg(r, sub.VpcId) ?? ''].filter(Boolean);
  const id = stableId(`ecs-eni:${taskArnStr}`, 'eni-', 17);
  const eni: EcsEni = { id, subnetId, vpcId: sub.VpcId, az: sub.AvailabilityZone, privateIp: allocIp(a, region, subnetId), sgIds, taskArn: taskArnStr, ...(net.assignPublicIp === 'ENABLED' ? { publicIp: fakeIp(id) } : {}) };
  ecsOf(a, region).enis[id] = eni;
  return eni;
}

// ───────────────────────── permisos ─────────────────────────

/** Mensaje de denegación (o null) de una acción para un rol. */
export function roleDenied(a: Account, region: string, roleArn: string, action: string, resource: string): string | null {
  try {
    authorize({ acct: a, caller: roleCaller(a, roleArn, 'ecs-tasks'), region, service: 'ecs' }, [{ action, resource }]);
    return null;
  } catch (e) {
    return e instanceof AwsError ? e.message : String(e);
  }
}

// ───────────────────────── planificación de una tarea ─────────────────────────

const PULL_FAIL_MS = 6000;
const NET_FAIL_MS = 100000;

/** Memoria que necesita el programa del contenedor (MiB): lo que ocupa el intérprete y los paquetes más pesados. */
export function memoryNeed(img: ImageData): number {
  let m = img.runtime === 'nginx' ? 12 : 38;
  for (const p of img.pkgs) m += p.name === 'numpy' ? 60 : p.name === 'pandas' ? 110 : p.name === 'boto3' || p.name === 'botocore' ? 12 : p.name === 'flask' ? 6 : 1;
  return m;
}

const logCfg = (d: EcsContainerDef) => (d.logConfiguration?.logDriver === 'awslogs' ? d.logConfiguration.options ?? {} : undefined);

export interface Launch {
  taskDef: EcsTaskDef;
  launchType: 'FARGATE' | 'EC2';
  capacity?: 'FARGATE' | 'FARGATE_SPOT';
  net?: EcsNet;
  startedBy?: string;
  group: string;
  serviceName?: string;
  deploymentId?: string;
  overrides?: { name: string; command?: string[]; environment?: { name: string; value: string }[] }[];
  tags?: { Key: string; Value: string }[];
}

/** Crea una tarea y calcula de una vez todo lo que le va a pasar: si descarga la imagen, si arranca y qué hace el contenedor. */
export function launchTask(a: Account, region: string, cluster: EcsCluster, o: Launch, t: number): EcsTask {
  const st = ecsOf(a, region);
  st.counter++;
  const id = stableId(`ecs-task:${a.id}:${cluster.name}:${st.counter}`, '', 32, 'hex');
  const arn = taskArn(a, region, cluster.name, id);
  const td = o.taskDef;
  const cpu = td.cpu ?? String(td.containerDefinitions.reduce((n, c) => n + (c.cpu ?? 0), 0) || 256);
  const mem = td.memory ?? String(td.containerDefinitions.reduce((n, c) => n + (c.memory ?? c.memoryReservation ?? 0), 0) || 512);
  const task: EcsTask = {
    id,
    arn,
    cluster: cluster.name,
    taskDef: `${td.family}:${td.revision}`,
    group: o.group,
    ...(o.startedBy ? { startedBy: o.startedBy } : {}),
    ...(o.serviceName ? { serviceName: o.serviceName, deploymentId: o.deploymentId } : {}),
    launchType: o.launchType,
    ...(o.capacity ? { capacity: o.capacity } : {}),
    createdAt: t,
    pendingAt: t + 2000,
    desiredStatus: 'RUNNING',
    cpu,
    memory: mem,
    containers: td.containerDefinitions.map((d) => ({ name: d.name, image: d.image, health: d.healthCheck ? 'UNKNOWN' : 'UNKNOWN' })),
    env: {},
    tags: o.tags ?? [],
    pendingLogs: [],
  };
  st.tasks[id] = task;
  // red (awsvpc): una interfaz de red por tarea
  if (td.networkMode === 'awsvpc' && o.net) {
    const per = Object.values(st.tasks).filter((x) => x.serviceName === o.serviceName && x.subnetId && x.stoppedAt === undefined && x !== task);
    const subnet = [...o.net.subnets].sort((x, y) => per.filter((p) => p.subnetId === x).length - per.filter((p) => p.subnetId === y).length || o.net!.subnets.indexOf(x) - o.net!.subnets.indexOf(y))[0];
    const eni = newEni(a, region, arn, o.net, subnet);
    task.net = o.net;
    task.eniId = eni.id;
    task.privateIp = eni.privateIp;
    task.publicIp = eni.publicIp;
    task.subnetId = eni.subnetId;
    task.az = eni.az;
  }
  const fail = (reason: string, after: number) => {
    task.stoppedAt = task.pendingAt + after;
    task.stopCode = 'TaskFailedToStart';
    task.stoppedReason = reason;
    task.desiredStatus = 'STOPPED';
    return task;
  };

  const execRole = td.executionRoleArn;
  const taskRole = td.taskRoleArn;
  const images = td.containerDefinitions.map((d) => d.image);
  const usesEcr = images.some((i) => /\.dkr\.ecr\./.test(i));
  const awslogs = td.containerDefinitions.some((d) => logCfg(d));
  const secrets = td.containerDefinitions.flatMap((d) => d.secrets);
  const needsRole = o.launchType === 'FARGATE' && (usesEcr || awslogs || secrets.length > 0);
  const reachOf = (svc: string) => (task.net ? taskReach(a, region, task.net, task.net.assignPublicIp === 'ENABLED', svc) : { ok: true });

  // 1. el rol de ejecución
  if (execRole && !roleTrusts(a, execRole, 'ecs-tasks.amazonaws.com')) return fail(`ECS was unable to assume the role '${execRole}' that was provided for this task. Please verify that the role being passed has the proper trust relationship and permissions and that your IAM user has permissions to pass this role.`, 3000);
  if (taskRole && !roleTrusts(a, taskRole, 'ecs-tasks.amazonaws.com')) return fail(`ECS was unable to assume the role '${taskRole}' that was provided for this task. Please verify that the role being passed has the proper trust relationship and permissions and that your IAM user has permissions to pass this role.`, 3000);
  const assumeFail = (code: string) => `ResourceInitializationError: ${code}`;

  // 2. red: ECR y registros
  let pulledAt = task.pendingAt + 3000;
  const imgData: Record<string, ImageData> = {};
  const needInternet = images.some((i) => !/\.dkr\.ecr\./.test(i));
  if (task.net) {
    if (usesEcr) {
      for (const svc of ['ecr.api', 'ecr.dkr', 's3']) {
        const r = reachOf(svc);
        if (!r.ok) return fail(svc === 'ecr.dkr' ? `CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref ${images.find((i) => /\.dkr\.ecr\./.test(i))}: failed to do request: Head "https://${a.id}.dkr.ecr.${region}.amazonaws.com/v2/": dial tcp 3.${(parseInt(stableId(svc, '', 2, 'hex'), 16) % 200) + 20}.4.9:443: i/o timeout` : assumeFail(`unable to pull secrets or registry auth: The task cannot pull registry auth from Amazon ECR: There is a connection issue between the task and Amazon ECR. Check your task network configuration. RequestError: send request failed caused by: Post "https://api.ecr.${region}.amazonaws.com/": dial tcp 3.${(parseInt(stableId(svc, '', 2, 'hex'), 16) % 200) + 20}.4.9:443: i/o timeout`), NET_FAIL_MS);
      }
    }
    if (needInternet && !reachOf('registry-1').ok) {
      const bad = images.find((i) => !/\.dkr\.ecr\./.test(i)) ?? '';
      return fail(`CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref docker.io/library/${bad.replace(/^docker\.io\/library\//, '')}: failed to do request: Head "https://registry-1.docker.io/v2/library/${bad.split(':')[0]}/manifests/${bad.split(':')[1] ?? 'latest'}": dial tcp 44.208.254.194:443: i/o timeout`, NET_FAIL_MS);
    }
    if (awslogs) {
      const r = reachOf('logs');
      if (!r.ok) return fail(assumeFail(`failed to validate logger args: create stream has been retried 1 times: failed to create Cloudwatch log stream: RequestError: send request failed caused by: Post "https://logs.${region}.amazonaws.com/": dial tcp 3.5.5.5:443: i/o timeout : exit status 1`), NET_FAIL_MS);
    }
  }

  // 3. permisos de descarga
  if (needsRole && execRole) {
    if (usesEcr) {
      const d = roleDenied(a, region, execRole, 'ecr:GetAuthorizationToken', '*');
      if (d) return fail(assumeFail(`unable to pull secrets or registry auth: execution resource retrieval failed: unable to retrieve ecr registry auth: service call has been retried 3 time(s): AccessDeniedException: ${d}`), PULL_FAIL_MS);
    }
  }
  for (const def of td.containerDefinitions) {
    const ref = def.image;
    if (/\.dkr\.ecr\./.test(ref)) {
      const res = ecrPullAs(a, region, execRole, ref, { skipAuth: o.launchType === 'EC2' && !execRole });
      if (res.fail) {
        const m = res.fail.message;
        return fail(res.fail.reason === 'denied' ? `CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref ${ref}: pull access denied, repository does not exist or may require authorization: authorization failed: ${m}` : `CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref ${ref}: ${res.fail.reason === 'no-repo' ? m : `${ref}: not found`}`, PULL_FAIL_MS);
      }
      imgData[def.name] = res.image!;
    } else {
      const base = findBase(ref);
      if (!base) return fail(`CannotPullContainerError: pull image manifest has been retried 5 time(s): failed to resolve ref docker.io/library/${ref.includes(':') ? ref : ref + ':latest'}: docker.io/library/${ref.includes(':') ? ref : ref + ':latest'}: not found`, PULL_FAIL_MS);
      imgData[def.name] = baseAsImage(base, t);
    }
    pulledAt += 2000 + Math.round(imgData[def.name].size / 1e6) * 25;
  }

  // 4. registros y secretos
  const secretEnv: Record<string, string> = {};
  for (const def of td.containerDefinitions) {
    const lg = logCfg(def);
    if (!lg) continue;
    const group = lg['awslogs-group'];
    const region2 = lg['awslogs-region'] ?? region;
    const exists = !!regional(a, region2).logs?.groups[group];
    const canCreate = lg['awslogs-create-group'] === 'true' && !!execRole && !roleDenied(a, region, execRole, 'logs:CreateLogGroup', '*');
    if (!exists && !canCreate) return fail(assumeFail(`failed to validate logger args: create stream has been retried 1 times: failed to create Cloudwatch log stream: ResourceNotFoundException: The specified log group does not exist. : exit status 1`), PULL_FAIL_MS);
    if (execRole) {
      const d = roleDenied(a, region, execRole, 'logs:CreateLogStream', mkArn('logs', region2, a.id, `log-group:${group}:log-stream:x`));
      if (d) return fail(assumeFail(`failed to validate logger args: create stream has been retried 1 times: failed to create Cloudwatch log stream: AccessDeniedException: ${d} : exit status 1`), PULL_FAIL_MS);
    }
    if (!exists) logsCreateGroup(a, region2, group);
  }
  for (const s of secrets) {
    const sec = findSecret(a, region, s.valueFrom.replace(/:[^:]*:[^:]*:[^:]*$/, '').replace(/^.*:secret:/, ''));
    const byArn = findSecret(a, region, s.valueFrom);
    const secret = byArn ?? sec;
    if (!secret) return fail(assumeFail(`unable to pull secrets or registry auth: execution resource retrieval failed: unable to retrieve secret from asm: service call has been retried 1 time(s): failed to fetch secret ${s.valueFrom} from secrets manager: ResourceNotFoundException: Secrets Manager can't find the specified secret.`), PULL_FAIL_MS);
    if (execRole) {
      const d = roleDenied(a, region, execRole, 'secretsmanager:GetSecretValue', secret.ARN);
      if (d) return fail(assumeFail(`unable to pull secrets or registry auth: execution resource retrieval failed: unable to retrieve secret from asm: service call has been retried 1 time(s): failed to fetch secret ${secret.ARN} from secrets manager: AccessDeniedException: ${d}`), PULL_FAIL_MS);
    }
    const cur = secret.versions.find((v) => v.stages.includes('AWSCURRENT'));
    secretEnv[s.name] = cur?.value ?? '';
  }

  // 5. el contenedor
  task.pullDoneAt = pulledAt;
  task.runningAt = pulledAt + 3000;
  const runAt = task.runningAt;
  const hostArch = td.runtimePlatform?.cpuArchitecture === 'ARM64' ? 'arm64' : 'amd64';
  const taskCaller = taskRole ? roleCaller(a, taskRole, id) : null;
  let anyExit: { code: number; at: number; name: string } | undefined;
  for (const def of td.containerDefinitions) {
    const ov = o.overrides?.find((x) => x.name === def.name);
    let img = imgData[def.name];
    if (def.entryPoint?.length) img = { ...img, config: { ...img.config, entrypoint: def.entryPoint } };
    const env: Record<string, string> = { ...Object.fromEntries(def.environment.map((e) => [e.name, e.value])), ...secretEnv, ...Object.fromEntries((ov?.environment ?? []).map((e) => [e.name, e.value])), ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/' + id.slice(0, 8), AWS_EXECUTION_ENV: o.launchType === 'FARGATE' ? 'AWS_ECS_FARGATE' : 'AWS_ECS_EC2' };
    task.env = { ...task.env, ...env };
    const ro: RunOpts = { acct: a, region, env, args: ov?.command ?? def.command ?? null, hostArch, caller: taskCaller, now: runAt };
    const limit = def.memory ?? parseMem(td.memory) ?? Infinity;
    let res = runContainer(img, ro);
    if (res.code === 0 && memoryNeed(img) > limit) res = { code: 137, lines: ['Out of memory: Killed process 1 (python) total-vm:2204kB, anon-rss:1030kB, file-rss:0kB'] };
    const cs = task.containers.find((x) => x.name === def.name)!;
    cs.imageDigest = 'sha256:' + stableId(`dig:${img.id}`, '', 64, 'hex');
    const lg = logCfg(def);
    if (lg) {
      task.logGroup = lg['awslogs-group'];
      task.logStream = `${lg['awslogs-stream-prefix'] ?? 'ecs'}/${def.name}/${id}`;
      res.lines.forEach((l, k) => task.pendingLogs!.push({ ts: runAt + 500 + k * 5, msg: l }));
    }
    if (res.server) {
      task.server = res.server;
      task.containerName = def.name;
      if (def.healthCheck) {
        const cmd = def.healthCheck.command.join(' ');
        const m = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/[^\s"']*)?/.exec(cmd);
        const hc = def.healthCheck;
        if (m) {
          const probe = containerHttp(img, ro, res.server, Number(m[1]), { method: 'GET', path: m[2] ?? '/' }, false);
          const ok = !probe.refused && (probe.status ?? 500) < 400;
          if (!ok) task.unhealthyAt = runAt + (hc.startPeriod ?? 0) * 1000 + (hc.interval ?? 30) * 1000 * (hc.retries ?? 3);
          cs.health = ok ? 'HEALTHY' : 'UNKNOWN';
        } else cs.health = 'HEALTHY';
      }
    } else if (!res.idle) {
      cs.exitCode = res.code;
      cs.reason = res.code === 137 ? 'OutOfMemoryError: Container killed due to memory usage' : undefined;
      const at = runAt + 1500;
      if (def.essential && (!anyExit || at < anyExit.at)) anyExit = { code: res.code, at, name: def.name };
    }
    imgData[def.name] = img;
  }
  task.imageRef = imgData[td.containerDefinitions[0].name];
  if (anyExit) {
    task.stopRequestedAt = anyExit.at;
    task.stoppedAt = anyExit.at + 2000;
    task.stopCode = 'EssentialContainerExited';
    task.stoppedReason = anyExit.code === 137 ? 'OutOfMemoryError: Container killed due to memory usage' : 'Essential container in task exited';
    task.desiredStatus = 'STOPPED';
  } else if (task.unhealthyAt !== undefined) {
    // el contenedor se marca como no sano y ECS detiene la tarea
    task.containers.forEach((c) => {
      if (c.health === 'UNKNOWN') c.health = 'UNKNOWN';
    });
  }
  return task;
}

// ───────────────────────── estado de una tarea ─────────────────────────

export type TaskStatus = 'PROVISIONING' | 'PENDING' | 'ACTIVATING' | 'RUNNING' | 'DEACTIVATING' | 'STOPPING' | 'DEPROVISIONING' | 'STOPPED';

export function taskStatus(task: EcsTask, now: number): TaskStatus {
  if (task.stoppedAt !== undefined && now >= task.stoppedAt) return 'STOPPED';
  if (task.stopRequestedAt !== undefined && now >= task.stopRequestedAt) {
    const span = (task.stoppedAt ?? task.stopRequestedAt + 20000) - task.stopRequestedAt;
    const k = (now - task.stopRequestedAt) / Math.max(1, span);
    return k < 0.2 ? 'DEACTIVATING' : k < 0.6 ? 'STOPPING' : 'DEPROVISIONING';
  }
  if (now < task.pendingAt) return 'PROVISIONING';
  if (task.runningAt === undefined) return 'PENDING';
  if (task.pullDoneAt !== undefined && now < task.pullDoneAt) return 'PENDING';
  if (now < task.runningAt) return 'ACTIVATING';
  return 'RUNNING';
}

export const isLive = (task: EcsTask, now: number) => task.desiredStatus === 'RUNNING' && (task.stoppedAt === undefined || now < task.stoppedAt) && task.stopRequestedAt === undefined;

export function stopTask(task: EcsTask, now: number, code: string, reason: string, after = 25000) {
  if (task.stoppedAt !== undefined && task.stoppedAt <= now) return;
  task.stopRequestedAt = now;
  task.stoppedAt = now + after;
  task.stopCode = code;
  task.stoppedReason = reason;
  task.desiredStatus = 'STOPPED';
}

// ───────────────────────── tráfico HTTP hacia una tarea ─────────────────────────

const probeCache = new Map<string, { at: number; res: ReturnType<typeof taskHttp>; log: string }>();

export function taskHttp(a: Account, region: string, task: EcsTask, port: number, method: string, path: string, o: { probe?: boolean; body?: string } = {}): { refused: true } | { refused?: undefined; status?: number; type: string; body: string; headers?: Record<string, string> } {
  if (!task.server || !task.imageRef) return { refused: true as const };
  const writeLog = (log: string) => {
    if (!task.logGroup || !task.logStream || !log || (o.probe && a.clock - (task.lastProbeLog ?? 0) < 30000)) return;
    if (o.probe) task.lastProbeLog = a.clock;
    for (const l of log.split('\n')) if (l) logsPut(a, region, task.logGroup, task.logStream, l, a.clock);
  };
  // las comprobaciones de salud se repiten sin cambios: se reutiliza la respuesta (ahorra volver a ejecutar el programa cada pocos segundos)
  const ck = `${task.id}|${port}|${method}|${path}`;
  if (o.probe) {
    const hit = probeCache.get(ck);
    if (hit && a.clock - hit.at < 600000 && a.clock >= hit.at) {
      writeLog(hit.log);
      return hit.res;
    }
  }
  const td = ecsOf(a, region).taskDefs[task.taskDef];
  const def = td?.containerDefinitions.find((d) => d.name === task.containerName) ?? td?.containerDefinitions[0];
  let img = task.imageRef;
  if (def?.entryPoint?.length) img = { ...img, config: { ...img.config, entrypoint: def.entryPoint } };
  const ro: RunOpts = { acct: a, region, env: task.env, args: def?.command ?? null, hostArch: td?.runtimePlatform?.cpuArchitecture === 'ARM64' ? 'arm64' : 'amd64', caller: td?.taskRoleArn ? roleCaller(a, td.taskRoleArn, task.id) : null, now: a.clock };
  const res = containerHttp(img, ro, task.server, port, { method, path, body: o.body }, true);
  if (res.refused) return { refused: true as const };
  writeLog(res.log ?? '');
  const result = { status: res.status, type: res.headers?.['Content-Type'] ?? 'text/html', body: res.body ?? '', headers: res.headers };
  if (o.probe) probeCache.set(ck, { at: a.clock, res: result, log: res.log ?? '' });
  return result;
}

/** Un destino `ip` de un balanceador: la tarea de ECS que tiene esa IP. */
ipTargets.resolvers.push((a, region, ip) => {
  const st = regional(a, region).ecs;
  if (!st) return undefined;
  const eni = Object.values(st.enis).find((e) => e.privateIp === ip);
  const task = eni ? Object.values(st.tasks).find((t) => t.eniId === eni.id) : undefined;
  if (!eni || !task) return undefined;
  const status = taskStatus(task, a.clock);
  return {
    up: status === 'RUNNING',
    state: status,
    subnetId: eni.subnetId,
    az: eni.az,
    sgIds: eni.sgIds,
    since: task.runningAt ?? task.createdAt,
    http: (port, method, path, probe) => taskHttp(a, region, task, port, method, path, { probe }),
  };
});

// ───────────────────────── planificador de servicios ─────────────────────────

const shortId = (t: EcsTask) => t.id;
const dep = (svc: EcsService, status: EcsDeployment['status']) => svc.deployments.find((d) => d.status === status);
const eventId = (a: Account, svc: EcsService, k: number) => stableId(`ecs-ev:${svc.arn}:${svc.events.length}:${k}`, '', 8, 'hex') + '-' + stableId(`ecs-ev2:${svc.arn}:${svc.events.length}`, '', 4, 'hex');

function event(a: Account, svc: EcsService, t: number, message: string) {
  svc.events.unshift({ id: eventId(a, svc, t % 1000), createdAt: t, message });
  if (svc.events.length > 100) svc.events.length = 100;
}

export const depId = (a: Account, svc: EcsService, n: number) => `ecs-svc/${stableId(`dep:${svc.arn}:${n}`, '', 19, 'hex').replace(/[a-f]/g, (ch) => String(ch.charCodeAt(0) % 10))}`;

const svcLabel = (svc: EcsService) => `(service ${svc.name})`;

function tasksOf(a: Account, region: string, svc: EcsService): EcsTask[] {
  return Object.values(ecsOf(a, region).tasks).filter((t) => t.cluster === svc.cluster && t.serviceName === svc.name);
}

function tgFor(a: Account, region: string, svc: EcsService) {
  const lb = svc.loadBalancers[0];
  if (!lb) return undefined;
  try {
    return { tg: findTg(a, region, lb.targetGroupArn), lb };
  } catch {
    return undefined;
  }
}

function healthyEnough(a: Account, region: string, svc: EcsService, task: EcsTask, t: number): boolean {
  if (taskStatus(task, t) !== 'RUNNING') return false;
  if (task.unhealthyAt !== undefined && t >= task.unhealthyAt) return false;
  const x = tgFor(a, region, svc);
  if (!x || !task.privateIp) return true;
  const tg = x.tg;
  const tgt = tg.targets.find((y) => y.Id === task.privateIp && y.Port === x.lb.containerPort && y.deregisteredAt === undefined);
  return !!tgt && targetHealth(a, region, tg, tgt).state === 'healthy';
}

function pickCapacity(svc: EcsService, live: EcsTask[]): { launchType: 'FARGATE' | 'EC2'; capacity?: 'FARGATE' | 'FARGATE_SPOT' } {
  const strat = svc.capacityProviderStrategy;
  if (!strat?.length) return { launchType: svc.launchType ?? 'FARGATE' };
  const count = (p: string) => live.filter((x) => x.capacity === p).length;
  let best = strat[0];
  let score = Infinity;
  const baseLeft = strat.find((s) => (s.base ?? 0) > count(s.capacityProvider));
  if (baseLeft) best = baseLeft;
  else
    for (const s of strat) {
      const sc = (count(s.capacityProvider) + 1) / Math.max(0.0001, s.weight ?? 1);
      if ((s.weight ?? 1) > 0 && sc < score) {
        score = sc;
        best = s;
      }
    }
  return { launchType: 'FARGATE', capacity: best.capacityProvider as 'FARGATE' | 'FARGATE_SPOT' };
}

function reconcile(a: Account, region: string, svc: EcsService, t: number) {
  const st = ecsOf(a, region);
  const cluster = st.clusters[svc.cluster];
  if (!cluster) return;
  const all = tasksOf(a, region, svc);
  // registros pendientes
  for (const task of Object.values(st.tasks)) {
    if (!task.pendingLogs?.length || !task.logGroup || !task.logStream) continue;
    const due = task.pendingLogs.filter((l) => l.ts <= t);
    if (!due.length) continue;
    task.pendingLogs = task.pendingLogs.filter((l) => l.ts > t);
    for (const l of due) logsPut(a, region, task.logGroup, task.logStream, l.msg, l.ts);
  }
  const prim = dep(svc, 'PRIMARY');
  if (svc.status === 'DRAINING') {
    for (const task of all) if (isLive(task, t)) stopTask(task, t, 'ServiceSchedulerInitiated', 'Service deleted: tasks stopped');
    if (all.every((x) => taskStatus(x, t) === 'STOPPED')) svc.status = 'INACTIVE';
  }
  if (svc.status !== 'ACTIVE' || !prim) return;
  const x = tgFor(a, region, svc);
  // contabilizar fallos y retirar destinos
  for (const task of all) {
    const status = taskStatus(task, t);
    const d = svc.deployments.find((y) => y.id === task.deploymentId);
    if (task.registered && (task.stopRequestedAt !== undefined || status === 'STOPPED') && x) {
      deregister(a, x.tg, task.privateIp ?? '', task.registered.port);
      event(a, svc, t, `${svcLabel(svc)} deregistered 1 targets in (target-group ${x.lb.targetGroupArn})`);
      task.registered = undefined;
    }
    if (!task.counted && (status === 'STOPPED' || task.stopRequestedAt !== undefined) && task.stopCode && !['ServiceSchedulerInitiated', 'UserInitiated'].includes(task.stopCode) && d) {
      task.counted = true;
      d.failedTasks++;
      d.consecutiveFails++;
      svc.holdUntil = Math.max(svc.holdUntil, t + Math.min(30000 * d.consecutiveFails, 300000));
      svc.steady = false;
    }
    if (!task.counted && task.stopCode === 'ServiceSchedulerInitiated' && /health checks/.test(task.stoppedReason ?? '') && d) {
      task.counted = true;
      d.failedTasks++;
      d.consecutiveFails++;
      svc.holdUntil = Math.max(svc.holdUntil, t + Math.min(30000 * d.consecutiveFails, 300000));
    }
    // tarea estable un minuto: se reinicia el contador de fallos
    if (d && status === 'RUNNING' && task.runningAt !== undefined && t - task.runningAt >= 60000 && healthyEnough(a, region, svc, task, t) && d.consecutiveFails > 0 && task.stopRequestedAt === undefined) d.consecutiveFails = 0;
  }
  // registrar tareas en marcha en el balanceador y vigilar su salud
  if (x) {
    for (const task of all) {
      if (!task.privateIp) continue;
      const status = taskStatus(task, t);
      if (status === 'RUNNING' && !task.registered && task.stopRequestedAt === undefined && x.lb.containerName === (task.containerName ?? x.lb.containerName)) {
        const cur = x.tg.targets.find((y) => y.Id === task.privateIp && y.Port === x.lb.containerPort);
        if (cur) cur.deregisteredAt = undefined;
        else x.tg.targets.push({ Id: task.privateIp, Port: x.lb.containerPort, registeredAt: t });
        task.registered = { targetGroupArn: x.lb.targetGroupArn, port: x.lb.containerPort };
        event(a, svc, t, `${svcLabel(svc)} registered 1 targets in (target-group ${x.lb.targetGroupArn})`);
      }
      if (task.registered && status === 'RUNNING' && task.stopRequestedAt === undefined) {
        const tgt = x.tg.targets.find((y) => y.Id === task.privateIp && y.Port === x.lb.containerPort && y.deregisteredAt === undefined);
        const h = tgt ? targetHealth(a, region, x.tg, tgt) : undefined;
        if (h?.state === 'unhealthy' && t >= (task.runningAt ?? 0) + svc.healthCheckGracePeriodSeconds * 1000) {
          if (!task.noticed) {
            event(a, svc, t, `${svcLabel(svc)} (port ${x.lb.containerPort}) is unhealthy in (target-group ${x.lb.targetGroupArn}) due to (reason ${h.description ?? h.reason}).`);
            task.noticed = true;
          }
          stopTask(task, t, 'ServiceSchedulerInitiated', `Task failed ELB health checks in (target-group ${x.lb.targetGroupArn})`);
          event(a, svc, t, `${svcLabel(svc)} has stopped 1 running tasks: (task ${shortId(task)}).`);
        }
      }
    }
  }
  // healthcheck del contenedor
  for (const task of all) {
    if (task.unhealthyAt !== undefined && t >= task.unhealthyAt && isLive(task, t)) {
      stopTask(task, t, 'EssentialContainerExited', 'Task failed container health checks');
      task.containers.forEach((c) => (c.health = 'UNHEALTHY'));
      event(a, svc, t, `${svcLabel(svc)} (task ${shortId(task)}) failed container health checks.`);
    }
  }
  // interruptor automático
  const threshold = Math.max(3, Math.min(200, Math.ceil(prim.desiredCount * 0.5)));
  if (svc.circuitBreaker.enable && prim.rolloutState === 'IN_PROGRESS' && prim.consecutiveFails >= threshold) {
    prim.rolloutState = 'FAILED';
    prim.rolloutStateReason = 'ECS deployment circuit breaker: tasks failed to start.';
    event(a, svc, t, `${svcLabel(svc)} (deployment ${prim.id}) deployment failed: tasks failed to start.`);
    if (svc.circuitBreaker.rollback && svc.lastGood && svc.lastGood.taskDefinition !== prim.taskDefinition) {
      prim.status = 'ACTIVE';
      const back: EcsDeployment = { id: depId(a, svc, svc.deployments.length + 7), status: 'PRIMARY', taskDefinition: svc.lastGood.taskDefinition, desiredCount: svc.desiredCount, createdAt: t, updatedAt: t, failedTasks: 0, consecutiveFails: 0, rolloutState: 'IN_PROGRESS', rolloutStateReason: 'ECS deployment circuit breaker: rolling back to deployment ' + prim.id + '.', ...(svc.launchType ? { launchType: svc.launchType } : {}), rollback: true };
      svc.deployments.unshift(back);
      event(a, svc, t, `${svcLabel(svc)} rolling back to deployment ${back.id}.`);
      return;
    }
  }
  const cur = dep(svc, 'PRIMARY')!;
  const live = all.filter((x2) => isLive(x2, t));
  const primLive = live.filter((x2) => x2.deploymentId === cur.id);
  const oldLive = live.filter((x2) => x2.deploymentId !== cur.id);
  const desired = svc.desiredCount;
  const maxTotal = Math.floor((desired * svc.maxPercent) / 100);
  const minHealthy = Math.ceil((desired * svc.minHealthyPercent) / 100);
  // lanzar tareas
  if (cur.rolloutState !== 'FAILED' && t >= svc.holdUntil) {
    const need = desired - primLive.length;
    const room = Math.max(0, maxTotal - live.length);
    const n = Math.min(need, room, 10);
    if (n > 0) {
      const started: string[] = [];
      for (let k = 0; k < n; k++) {
        const td = findTaskDef(a, region, cur.taskDefinition);
        const cap = pickCapacity(svc, [...live, ...started.map((id) => st.tasks[id])]);
        const task = launchTask(a, region, cluster, { taskDef: td, launchType: cap.launchType, capacity: cap.capacity, net: svc.net, startedBy: cur.id, group: `service:${svc.name}`, serviceName: svc.name, deploymentId: cur.id }, t);
        started.push(task.id);
      }
      event(a, svc, t, `${svcLabel(svc)} has started ${n} tasks: ${started.map((id) => `(task ${id})`).join(' ')}.`);
      svc.steady = false;
      return;
    }
  }
  // retirar tareas sobrantes
  const healthyPrim = primLive.filter((x2) => healthyEnough(a, region, svc, x2, t));
  if (desired > 0 && healthyPrim.length >= desired && cur.rolloutState !== 'FAILED') svc.lastGood = { taskDefinition: cur.taskDefinition, desiredCount: desired };
  let canStop = live.length - minHealthy;
  if (healthyPrim.length >= desired) canStop = oldLive.length;
  if (oldLive.length) {
    const order = [...oldLive].sort((p, q) => q.createdAt - p.createdAt);
    for (const task of order.slice(0, Math.max(0, Math.min(canStop, oldLive.length)))) {
      stopTask(task, t, 'ServiceSchedulerInitiated', `Scaling activity initiated by (deployment ${cur.id})`, 45000);
      event(a, svc, t, `${svcLabel(svc)} has begun draining connections on 1 tasks.`);
      event(a, svc, t, `${svcLabel(svc)} has stopped 1 running tasks: (task ${shortId(task)}).`);
    }
  } else if (primLive.length > desired) {
    for (const task of [...primLive].sort((p, q) => q.createdAt - p.createdAt).slice(0, primLive.length - desired)) {
      stopTask(task, t, 'ServiceSchedulerInitiated', 'Scaling activity initiated by (deployment ' + cur.id + ')', 45000);
      event(a, svc, t, `${svcLabel(svc)} has stopped 1 running tasks: (task ${shortId(task)}).`);
    }
  }
  // despliegue completado
  const stillOld = all.filter((x2) => x2.deploymentId !== cur.id && taskStatus(x2, t) !== 'STOPPED').length;
  if (cur.rolloutState === 'IN_PROGRESS' && !stillOld && healthyPrim.length >= desired && primLive.length === desired) {
    cur.rolloutState = 'COMPLETED';
    cur.rolloutStateReason = cur.rollback ? 'ECS deployment circuit breaker: rollback completed.' : 'ECS deployment completed successfully.';
    cur.updatedAt = t;
    svc.lastGood = { taskDefinition: cur.taskDefinition, desiredCount: desired };
    svc.deployments = svc.deployments.filter((d) => d === cur || (d.status === 'ACTIVE' && all.some((x2) => x2.deploymentId === d.id && taskStatus(x2, t) !== 'STOPPED')));
    svc.deployments = svc.deployments.filter((d) => d === cur);
  }
  if (cur.rolloutState === 'COMPLETED' && !svc.steady && primLive.length === desired && !stillOld && healthyPrim.length >= desired) {
    svc.steady = true;
    event(a, svc, t, `${svcLabel(svc)} has reached a steady state.`);
  }
  // las demás implementaciones sin tareas desaparecen
  svc.deployments = svc.deployments.filter((d) => d.status === 'PRIMARY' || all.some((x2) => x2.deploymentId === d.id && taskStatus(x2, t) !== 'STOPPED'));
  void stillOld;
  cur.desiredCount = desired;
  cur.updatedAt = Math.max(cur.updatedAt, 0);
}

/** Un paso inmediato del planificador (al crear o cambiar un servicio). */
export function reconcileNow(a: Account, region: string, svc: EcsService): void {
  reconcile(a, region, svc, a.clock);
  svc.simAt = Math.max(svc.simAt, a.clock);
}

let busy = false;

/** Avanza el planificador de todos los servicios hasta `until` (el reloj de la cuenta). */
export function advanceEcs(a: Account, until: number): void {
  if (busy) return;
  busy = true;
  const real = a.clock;
  try {
    for (const [region, r] of Object.entries(a.regions)) {
      const st = r.ecs;
      if (!st) continue;
      for (const svc of Object.values(st.services)) {
        if (svc.status === 'INACTIVE') continue;
        let t = svc.simAt;
        if (t >= until) continue;
        const span = until - t;
        const step = Math.max(5000, Math.ceil(span / 1200 / 1000) * 1000);
        while (t < until) {
          t = Math.min(t + step, until);
          a.clock = t;
          reconcile(a, region, svc, t);
        }
        svc.simAt = until;
      }
      // tareas sueltas: solo hay que volcar sus registros
      a.clock = until;
      for (const task of Object.values(st.tasks)) {
        if (task.serviceName || !task.pendingLogs?.length || !task.logGroup || !task.logStream) continue;
        const due = task.pendingLogs.filter((l) => l.ts <= until);
        task.pendingLogs = task.pendingLogs.filter((l) => l.ts > until);
        for (const l of due) logsPut(a, region, task.logGroup, task.logStream, l.msg, l.ts);
      }
    }
  } finally {
    a.clock = real;
    busy = false;
  }
}

/** Otros servicios (Application Auto Scaling) que deciden cosas minuto a minuto antes de que el planificador alcance el reloj. */
export const ecsHooks: ((a: Account) => void)[] = [];

tickers.push((a) => {
  for (const h of ecsHooks) h(a);
  advanceEcs(a, a.clock);
});

