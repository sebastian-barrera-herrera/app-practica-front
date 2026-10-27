/**
 * El Kubernetes que corre dentro de un clúster de EKS: nodos (las instancias de los grupos administrados y los de Fargate),
 * deployments con actualización gradual, pods (programación, descarga de imagen, arranque, caídas y reinicios) y servicios,
 * incluidos los de tipo LoadBalancer, que crean un balanceador de red en AWS.
 */
import { md5 } from '../engine/commands/hash';
import { regional } from './account';
import { baseAsImage, findBase } from './containers/catalog';
import { containerHttp, runContainer, type RunOpts } from './containers/runtime';
import { instanceType } from './catalog';
import { sdkCall } from './sdk';
import type { Account } from './types';
import type { EksCluster, ImageData, K8sContainer, K8sDeployment, K8sPod, K8sService } from './types-containers';
import { stableId } from './util';
import { ecrPullAs } from './services/ecr';
import { allocIp, memoryNeed, roleDenied } from './services/ecs';
import { deregister, elb, elbCreateLb, elbCreateListener, elbCreateTg, ipTargets, lbState } from './services/elb';
import { logsPut } from './services/logs';
import './services/eks';
import { tickers } from './tick';

const SUFFIX = 'bcdfghjklmnpqrstvwxz2456789';

export const hashOf = (containers: K8sContainer[], extra = '') => {
  const h = md5(JSON.stringify(containers) + extra);
  let out = '';
  for (let i = 0; i < 10; i++) out += SUFFIX[parseInt(h.slice(i * 2, i * 2 + 2), 16) % SUFFIX.length];
  return out;
};
const suffix = (seed: string, n: number) => {
  const h = stableId(seed, '', n * 2, 'hex');
  let out = '';
  for (let i = 0; i < n; i++) out += SUFFIX[parseInt(h.slice(i * 2, i * 2 + 2), 16) % SUFFIX.length];
  return out;
};

// ───────────────────────── nodos ─────────────────────────

export interface K8sNode {
  name: string;
  instanceId?: string;
  ng: string;
  az: string;
  subnetId: string;
  ip: string;
  publicIp?: string;
  type: string;
  createdAt: number;
  readyAt: number;
  /** Milicores y MiB que se pueden repartir entre pods. */
  cpu: number;
  mem: number;
  maxPods: number;
  role: string;
  arch: 'amd64' | 'arm64';
  fargate?: boolean;
}

const MAX_PODS: Record<string, number> = { 't3.nano': 4, 't3.micro': 4, 't3.small': 11, 't3.medium': 17, 't3.large': 35, 't3.xlarge': 58, 't3.2xlarge': 58, 't4g.micro': 4, 't4g.small': 11, 't4g.medium': 17, 't4g.large': 35, 'm5.large': 29, 'm5.xlarge': 58, 'm6g.large': 29, 'c5.large': 29, 'c6g.large': 29 };

export const nodeName = (region: string, ip: string) => `ip-${ip.replace(/\./g, '-')}.${region === 'us-east-1' ? 'ec2.internal' : region + '.compute.internal'}`;

/** Los nodos de los grupos administrados que ya se han unido al clúster (aunque aún no estén `Ready`). */
export function clusterNodes(a: Account, region: string, cl: EksCluster): K8sNode[] {
  const r = regional(a, region).ec2;
  const out: K8sNode[] = [];
  for (const ng of Object.values(cl.nodegroups)) {
    if (ng.joinFail || ng.status === 'DELETING') continue;
    for (const id of ng.instanceIds) {
      const i = r.instances[id];
      if (!i || i.state !== 'running') continue;
      const info = instanceType(i.InstanceType);
      const launch = Date.parse(i.LaunchTime);
      out.push({ name: nodeName(region, i.PrivateIpAddress), instanceId: id, ng: ng.name, az: i.AvailabilityZone, subnetId: i.SubnetId, ip: i.PrivateIpAddress, publicIp: i.PublicIpAddress, type: i.InstanceType, createdAt: launch, readyAt: launch + 75000, cpu: (info?.vcpu ?? 2) * 1000 - 70, mem: Math.round((info?.mem ?? 4096) * 0.88 - 255), maxPods: MAX_PODS[i.InstanceType] ?? 29, role: ng.nodeRole, arch: info?.arch === 'arm64' ? 'arm64' : 'amd64' });
    }
  }
  return out;
}

/** Los «nodos» de Fargate: uno por pod que se ejecuta allí. */
export function fargateNodes(cl: EksCluster, now: number): K8sNode[] {
  return Object.values(cl.k8s.pods)
    .filter((p) => p.fargate && p.node && p.ip && !(p.deletedAt !== undefined && now >= p.deletedAt))
    .map((p) => ({ name: p.node!, ng: 'fargate', az: '', subnetId: p.subnetId ?? '', ip: p.ip!, type: 'fargate', createdAt: p.scheduledAt ?? p.created, readyAt: p.startedAt ?? p.created, cpu: 0, mem: 0, maxPods: 1, role: '', arch: 'amd64' as const, fargate: true }));
}

const fargateMatch = (cl: EksCluster, pod: K8sPod, now: number) =>
  Object.values(cl.fargateProfiles).find((fp) => fp.deleting === undefined && now >= fp.activeAt && fp.selectors.some((s) => s.namespace === pod.ns && Object.entries(s.labels ?? {}).every(([k, v]) => pod.labels[k] === v)));

// ───────────────────────── pods ─────────────────────────

const BACKOFF = [10000, 20000, 40000, 80000, 160000, 300000];

/** Instantes en que arranca cada ejecución del contenedor de un pod que se cae (la primera es el arranque normal). */
export function runStarts(pod: K8sPod, now: number): number[] {
  if (pod.startedAt === undefined) return [];
  const out = [pod.startedAt];
  if (pod.failure?.kind !== 'Crash') return out;
  for (let k = 0; k < 80; k++) {
    const next = out[k] + 1000 + BACKOFF[Math.min(k, BACKOFF.length - 1)];
    if (next > now) break;
    out.push(next);
  }
  return out;
}

export interface PodStatus {
  status: string;
  ready: string;
  restarts: number;
  lastRestart?: number;
  running: boolean;
}

export function podStatus(pod: K8sPod, now: number): PodStatus {
  const n = pod.containers.length;
  const none = (status: string, running = false): PodStatus => ({ status, ready: `0/${n}`, restarts: 0, running });
  if (pod.terminatingAt !== undefined && now >= pod.terminatingAt) return { ...none('Terminating'), restarts: 0 };
  if (!pod.node) return none('Pending');
  if (pod.failure?.kind === 'ImagePull') {
    if (now < (pod.scheduledAt ?? now) + 3000) return none('ContainerCreating');
    // cada intento fallido muestra ErrImagePull unos segundos; entre intentos, ImagePullBackOff
    const last = (pod.retryAt ?? now + 60000) - 57000;
    return none(now < last + 12000 ? 'ErrImagePull' : 'ImagePullBackOff');
  }
  if (pod.pullDoneAt !== undefined && now < pod.pullDoneAt) return none('ContainerCreating');
  if (pod.startedAt === undefined || now < pod.startedAt) return none('ContainerCreating');
  if (pod.failure?.kind === 'Crash') {
    const starts = runStarts(pod, now);
    const k = starts.length - 1;
    const crashAt = starts[k] + 1000;
    const restarts = k;
    if (now < crashAt) return { status: 'Running', ready: `${n}/${n}`, restarts, lastRestart: k > 0 ? starts[k] : undefined, running: true };
    const reason = pod.failure.reason;
    return { status: now - crashAt < 3000 ? reason : 'CrashLoopBackOff', ready: `0/${n}`, restarts, lastRestart: k > 0 ? starts[k] : undefined, running: false };
  }
  return { status: 'Running', ready: `${n}/${n}`, restarts: 0, running: true };
}

export const podReady = (pod: K8sPod, now: number) => {
  const s = podStatus(pod, now);
  return s.status === 'Running' && s.ready.startsWith(`${pod.containers.length}/`);
};

const matches = (selector: Record<string, string>, labels: Record<string, string>) => Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels[k] === v);

const ev = (pod: K8sPod, t: number, type: 'Normal' | 'Warning', reason: string, message: string) => pod.events.push({ t, type, reason, message });

function usedPodIps(cl: EksCluster, subnetId: string): Set<string> {
  const s = new Set<string>();
  for (const p of Object.values(cl.k8s.pods)) if (p.subnetId === subnetId && p.ip) s.add(p.ip);
  return s;
}

export function newPod(cl: EksCluster, o: { name?: string; ns: string; labels: Record<string, string>; containers: K8sContainer[]; owner?: string; hash: string; system?: boolean }, t: number): K8sPod {
  const k = cl.k8s;
  k.counter++;
  const name = o.name ?? `${o.owner}-${o.hash}-${suffix(`pod:${cl.arn}:${k.counter}`, 5)}`;
  const pod: K8sPod = { name, ns: o.ns, labels: { ...o.labels, ...(o.owner ? { 'pod-template-hash': o.hash } : {}) }, owner: o.owner, hash: o.hash, containers: o.containers, created: t, lines: [], events: [], ...(o.system ? { system: true, ownerRef: `ReplicaSet/${o.owner}-${o.hash}` } : {}), uid: stableId(`uid:${cl.arn}:${k.counter}`, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5') };
  k.pods[`${o.ns}/${name}`] = pod;
  return pod;
}

const CPU_FMT = (m: number) => `${m}m`;

/** Elige dónde se ejecuta el pod: Fargate si algún perfil lo recoge; si no, el nodo con sitio y menos pods. */
function schedule(a: Account, region: string, cl: EksCluster, pod: K8sPod, t: number): void {
  const fp = fargateMatch(cl, pod, t);
  if (fp) {
    const subnet = fp.subnets[Object.keys(cl.k8s.pods).length % fp.subnets.length];
    const ip = allocIp(a, region, subnet, usedPodIps(cl, subnet));
    pod.fargate = true;
    pod.subnetId = subnet;
    pod.ip = ip;
    pod.node = `fargate-${nodeName(region, ip)}`;
    ev(pod, t, 'Normal', 'Scheduled', `Successfully assigned ${pod.ns}/${pod.name} to ${pod.node}`);
    startPod(a, region, cl, pod, fp.podExecutionRoleArn, 'amd64', t, 45000);
    return;
  }
  const nodes = clusterNodes(a, region, cl).filter((n) => t >= n.readyAt);
  const load = (n: K8sNode) => {
    const mine = Object.values(cl.k8s.pods).filter((p) => p.node === n.name && !p.fargate && !(p.deletedAt !== undefined && t >= p.deletedAt));
    return { pods: mine.length, cpu: mine.reduce((s, p) => s + p.containers.reduce((x, c) => x + c.cpu, 0), 0), mem: mine.reduce((s, p) => s + p.containers.reduce((x, c) => x + c.mem, 0), 0) };
  };
  const needCpu = pod.containers.reduce((s, c) => s + c.cpu, 0);
  const needMem = pod.containers.reduce((s, c) => s + c.mem, 0);
  const reasons: Record<string, number> = {};
  const fits = nodes.filter((n) => {
    const l = load(n);
    if (l.pods >= n.maxPods) return void (reasons['Too many pods'] = (reasons['Too many pods'] ?? 0) + 1);
    if (l.cpu + needCpu > n.cpu) return void (reasons['Insufficient cpu'] = (reasons['Insufficient cpu'] ?? 0) + 1);
    if (l.mem + needMem > n.mem) return void (reasons['Insufficient memory'] = (reasons['Insufficient memory'] ?? 0) + 1);
    return true;
  });
  if (!fits.length) {
    const total = nodes.length;
    const msg = total === 0 ? 'no nodes available to schedule pods' : `0/${total} nodes are available: ${Object.entries(reasons).map(([r, c]) => `${c} ${r}`).join(', ')}. preemption: 0/${total} nodes are available: ${total} No preemption victims found for incoming pod.`;
    if (pod.failure?.message !== msg) {
      pod.failure = { kind: 'Unschedulable', reason: 'Unschedulable', message: msg };
      ev(pod, t, 'Warning', 'FailedScheduling', msg);
    }
    return;
  }
  const best = fits.sort((x, y) => load(x).pods - load(y).pods || x.name.localeCompare(y.name))[0];
  pod.failure = undefined;
  pod.node = best.name;
  pod.nodeInstance = best.instanceId;
  pod.subnetId = best.subnetId;
  pod.ip = allocIp(a, region, best.subnetId, usedPodIps(cl, best.subnetId));
  ev(pod, t, 'Normal', 'Scheduled', `Successfully assigned ${pod.ns}/${pod.name} to ${best.name}`);
  startPod(a, region, cl, pod, best.role, best.arch, t, 0);
}

const pullFailMsg = (ref: string, why: 'denied' | 'no-image' | 'no-repo') => {
  const host = ref.split('/')[0];
  const tag = ref.includes(':') ? ref.split(':').pop() : 'latest';
  if (why === 'denied') return `rpc error: code = Unknown desc = failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": pulling from host ${host} failed with status code [manifests ${tag}]: 401 Unauthorized`;
  if (why === 'no-repo') return `rpc error: code = Unknown desc = failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": pulling from host ${host} failed with status code [manifests ${tag}]: 404 Not Found`;
  return `rpc error: code = NotFound desc = failed to pull and unpack image "${ref}": failed to resolve reference "${ref}": ${ref}: not found`;
};

/** Descarga la imagen y ejecuta el contenedor: de una vez se sabe si arranca, si se cae y qué escribe. */
function startPod(a: Account, region: string, cl: EksCluster, pod: K8sPod, role: string, arch: 'amd64' | 'arm64', t: number, extraDelay: number): void {
  const c = pod.containers[0];
  pod.scheduledAt ??= t;
  pod.retryAt = undefined;
  if (pod.system) {
    pod.pullDoneAt = t + 6000;
    pod.startedAt = t + 12000;
    pod.lines = [`[INFO] ${c.name} started`];
    return;
  }
  ev(pod, t + 500, 'Normal', 'Pulling', `Pulling image "${c.image}"`);
  let img: ImageData | undefined;
  const failPull = (why: 'denied' | 'no-image' | 'no-repo') => {
    const m = pullFailMsg(c.image, why);
    pod.failure = { kind: 'ImagePull', reason: 'ImagePullBackOff', message: m };
    pod.retryAt = t + 60000;
    ev(pod, t + 3000, 'Warning', 'Failed', `Failed to pull image "${c.image}": ${m}`);
    ev(pod, t + 3000, 'Warning', 'Failed', 'Error: ErrImagePull');
    ev(pod, t + 20000, 'Normal', 'BackOff', `Back-off pulling image "${c.image}"`);
    ev(pod, t + 20000, 'Warning', 'Failed', 'Error: ImagePullBackOff');
  };
  if (/\.dkr\.ecr\./.test(c.image)) {
    if (roleDenied(a, region, role, 'ecr:GetAuthorizationToken', '*')) return failPull('denied');
    const r = ecrPullAs(a, region, role, c.image);
    if (r.fail || !r.image) return failPull(r.fail?.reason ?? 'no-image');
    img = r.image;
  } else {
    const base = findBase(c.image);
    if (!base) return failPull('no-image');
    img = baseAsImage(base, t);
  }
  pod.failure = undefined;
  const pull = 1200 + Math.round(img.size / 1e6) * 18;
  pod.pullDoneAt = t + extraDelay + 3000 + pull;
  pod.startedAt = pod.pullDoneAt + 800;
  ev(pod, pod.pullDoneAt, 'Normal', 'Pulled', `Successfully pulled image "${c.image}" in ${(pull / 1000).toFixed(3)}s (${(pull / 1000).toFixed(3)}s including waiting). Image size: ${Math.round(img.size)} bytes.`);
  ev(pod, pod.pullDoneAt + 300, 'Normal', 'Created', `Created container ${c.name}`);
  ev(pod, pod.startedAt, 'Normal', 'Started', `Started container ${c.name}`);
  const runImg = c.command?.length ? { ...img, config: { ...img.config, entrypoint: c.command } } : img;
  const ro: RunOpts = { acct: a, region, env: Object.fromEntries(c.env.map((e) => [e.name, e.value])), args: c.command?.length ? c.args ?? [] : c.args ?? null, hostArch: arch, caller: null, now: pod.startedAt };
  let res = runContainer(runImg, ro);
  if (res.code === 0 && c.memLimit !== undefined && memoryNeed(img) > c.memLimit) res = { code: 137, lines: [] };
  pod.img = runImg;
  pod.lines = res.lines.slice();
  if (res.server) pod.server = res.server;
  else if (!res.idle) {
    const oom = res.code === 137;
    pod.failure = { kind: 'Crash', reason: oom ? 'OOMKilled' : res.code === 0 ? 'Completed' : 'Error', message: oom ? 'OOMKilled' : res.code === 0 ? 'Completed' : 'Error', code: res.code };
    ev(pod, pod.startedAt + 1500, 'Warning', 'BackOff', `Back-off restarting failed container ${c.name} in pod ${pod.name}_${pod.ns}(${pod.uid})`);
  }
}

function terminate(pod: K8sPod, t: number, grace = 8000) {
  if (pod.terminatingAt !== undefined) return;
  pod.terminatingAt = t;
  pod.deletedAt = t + grace;
}

// ───────────────────────── tráfico HTTP hacia un pod ─────────────────────────

const probeCache = new Map<string, { at: number; res: ReturnType<typeof podHttp> }>();

export function podHttp(a: Account, region: string, cl: EksCluster, pod: K8sPod, port: number, method: string, path: string, o: { probe?: boolean; body?: string; headers?: Record<string, string> } = {}): { refused: true } | { refused?: undefined; status?: number; type: string; body: string; headers?: Record<string, string> } {
  if (!pod.server || !pod.img || !podReady(pod, a.clock)) return { refused: true as const };
  const ck = `${pod.uid}|${port}|${method}|${path}`;
  if (o.probe) {
    const hit = probeCache.get(ck);
    if (hit && a.clock - hit.at < 600000 && a.clock >= hit.at) return hit.res;
  }
  const c = pod.containers[0];
  const ro: RunOpts = { acct: a, region, env: Object.fromEntries(c.env.map((e) => [e.name, e.value])), args: c.args ?? null, hostArch: 'amd64', caller: null, now: a.clock };
  const res = containerHttp(pod.img, ro, pod.server, port, { method, path, body: o.body, headers: o.headers }, true);
  if (res.refused) return { refused: true as const };
  if (res.log && !o.probe) for (const l of res.log.split('\n')) if (l) pod.lines.push(l);
  if (pod.lines.length > 300) pod.lines.splice(0, pod.lines.length - 300);
  const result = { status: res.status, type: res.headers?.['Content-Type'] ?? 'text/html', body: res.body ?? '', headers: res.headers };
  if (o.probe) probeCache.set(ck, { at: a.clock, res: result });
  return result;
}

ipTargets.resolvers.push((a, region, ip) => {
  const st = a.regions[region]?.eks;
  if (!st) return undefined;
  for (const cl of Object.values(st.clusters)) {
    for (const pod of Object.values(cl.k8s.pods)) {
      if (pod.ip !== ip || (pod.deletedAt !== undefined && a.clock >= pod.deletedAt)) continue;
      const sub = regional(a, region).ec2.subnets[pod.subnetId ?? ''];
      if (!sub) continue;
      const s = podStatus(pod, a.clock);
      return { up: podReady(pod, a.clock), state: s.status === 'Terminating' ? 'DEPROVISIONING' : s.running ? 'RUNNING' : 'PENDING', subnetId: sub.SubnetId, az: sub.AvailabilityZone, sgIds: [cl.clusterSg], since: pod.startedAt ?? pod.created, http: (port, method, path, probe) => podHttp(a, region, cl, pod, port, method, path, { probe }) };
    }
  }
  return undefined;
});

// ───────────────────────── controladores ─────────────────────────

const livePods = (cl: EksCluster, t: number, pred: (p: K8sPod) => boolean) => Object.values(cl.k8s.pods).filter((p) => pred(p) && !(p.terminatingAt !== undefined && t >= p.terminatingAt));

function reconcileDeployment(a: Account, region: string, cl: EksCluster, d: K8sDeployment, t: number) {
  const mine = livePods(cl, t, (p) => p.ns === d.ns && p.owner === d.name);
  const cur = mine.filter((p) => p.hash === d.hash);
  const old = mine.filter((p) => p.hash !== d.hash);
  const ready = (p: K8sPod) => podReady(p, t);
  const maxTotal = d.replicas + d.maxSurge;
  // más pods de la versión nueva
  if (cur.length < d.replicas) {
    const n = Math.min(d.replicas - cur.length, Math.max(0, maxTotal - mine.length));
    for (let k = 0; k < n; k++) newPod(cl, { ns: d.ns, labels: d.selector, containers: d.containers, owner: d.name, hash: d.hash, system: d.system }, t);
  } else if (cur.length > d.replicas) {
    for (const p of [...cur].sort((x, y) => Number(ready(x)) - Number(ready(y)) || y.created - x.created).slice(0, cur.length - d.replicas)) terminate(p, t);
  }
  // menos pods de la versión vieja, sin bajar del mínimo disponible
  let canKill = mine.filter(ready).length - (d.replicas - d.maxUnavailable);
  for (const p of [...old].sort((x, y) => Number(ready(x)) - Number(ready(y)) || x.created - y.created)) {
    if (!ready(p)) terminate(p, t);
    else if (canKill > 0 || d.replicas === 0) {
      terminate(p, t);
      canKill--;
    }
  }
}

function ensureLb(a: Account, region: string, cl: EksCluster, s: K8sService, t: number) {
  if (s.lb || s.lbError) return;
  const r = regional(a, region).ec2;
  const internal = /internal/.test(s.annotations['service.beta.kubernetes.io/aws-load-balancer-scheme'] ?? '') || s.annotations['service.beta.kubernetes.io/aws-load-balancer-internal'] === 'true';
  const isPublic = (id: string) => !!r.subnets[id]?.MapPublicIpOnLaunch;
  const subnets = cl.subnetIds.filter((id) => (internal ? !isPublic(id) : isPublic(id)));
  s.events.push({ t, type: 'Normal', reason: 'EnsuringLoadBalancer', message: 'Ensuring load balancer' });
  if (!subnets.length) {
    s.lbError = `could not find any suitable subnets for creating the ELB`;
    s.events.push({ t: t + 2000, type: 'Warning', reason: 'SyncLoadBalancerFailed', message: `Error syncing load balancer: failed to ensure load balancer: ${s.lbError}` });
    return;
  }
  const tag = md5(`${cl.arn}/${s.ns}/${s.name}`).slice(0, 10);
  const lbName = `k8s-${s.ns}-${s.name}-${tag}`.slice(0, 32).replace(/-+$/, '');
  const tp = s.ports[0];
  const lb = elbCreateLb(a, region, { name: lbName, type: 'network', scheme: internal ? 'internal' : 'internet-facing', subnets, tags: [{ Key: 'elbv2.k8s.aws/cluster', Value: cl.name }, { Key: 'service.k8s.aws/stack', Value: `${s.ns}/${s.name}` }, { Key: 'service.k8s.aws/resource', Value: 'LoadBalancer' }] });
  const tg = elbCreateTg(a, region, { name: `k8s-${s.ns}-${s.name}-${tag}`.slice(0, 32).replace(/-+$/, ''), protocol: 'TCP', port: tp.targetPort, vpcId: cl.vpcId });
  tg.TargetType = 'ip';
  tg.HealthCheckProtocol = 'TCP';
  tg.HealthCheckIntervalSeconds = 10;
  tg.HealthyThresholdCount = 2;
  tg.UnhealthyThresholdCount = 2;
  elbCreateListener(a, region, lb, { port: tp.port, protocol: 'TCP', actions: [{ Type: 'forward', TargetGroupArn: tg.TargetGroupArn }] });
  // el controlador abre el puerto de los pods en el grupo de seguridad del clúster
  sdkCall(a, region, null, 'ec2', 'authorize-security-group-ingress', { GroupId: cl.clusterSg, IpPermissions: [{ IpProtocol: 'tcp', FromPort: tp.targetPort, ToPort: tp.targetPort, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: `elbv2.k8s.aws/targetGroupBinding=shared` }] }] });
  s.lb = { arn: lb.LoadBalancerArn, dns: lb.DNSName, tgArn: tg.TargetGroupArn, readyAt: t + 150000 };
  s.events.push({ t: t + 5000, type: 'Normal', reason: 'EnsuredLoadBalancer', message: 'Ensured load balancer' });
}

function reconcileService(a: Account, region: string, cl: EksCluster, s: K8sService, t: number) {
  if (s.type !== 'LoadBalancer') return;
  ensureLb(a, region, cl, s, t);
  if (!s.lb) return;
  const tg = elb(a, region).tgs[s.lb.tgArn];
  if (!tg) return;
  const port = s.ports[0].targetPort;
  const want = livePods(cl, t, (p) => p.ns === s.ns && matches(s.selector, p.labels) && !!p.ip && podReady(p, t));
  for (const p of want) if (!tg.targets.some((x) => x.Id === p.ip && x.Port === port && x.deregisteredAt === undefined)) tg.targets.push({ Id: p.ip!, Port: port, registeredAt: t });
  for (const x of [...tg.targets]) if (x.deregisteredAt === undefined && !want.some((p) => p.ip === x.Id)) deregister(a, tg, x.Id, x.Port);
}

const SYSTEM_DS = [
  { name: 'aws-node', image: '602401143452.dkr.ecr.us-west-2.amazonaws.com/amazon-k8s-cni:v1.19.2-eksbuild.1', cpu: 25 },
  { name: 'kube-proxy', image: '602401143452.dkr.ecr.us-west-2.amazonaws.com/eks/kube-proxy:v1.32.0-minimal-eksbuild.2', cpu: 100 },
];

/** Los pods que EKS pone en cada nodo (red de pods y kube-proxy) y el DNS interno (CoreDNS). */
function ensureSystem(a: Account, region: string, cl: EksCluster, t: number) {
  const k = cl.k8s;
  const nodes = clusterNodes(a, region, cl);
  if (!nodes.length) return;
  for (const n of nodes) {
    for (const ds of SYSTEM_DS) {
      if (Object.values(k.pods).some((p) => p.system && p.node === n.name && p.name.startsWith(ds.name + '-') && p.terminatingAt === undefined)) continue;
      const hash = hashOf([], ds.name);
      const pod = newPod(cl, { name: `${ds.name}-${suffix(`ds:${cl.arn}:${n.name}:${ds.name}:${k.counter}`, 5)}`, ns: 'kube-system', labels: { 'k8s-app': ds.name }, containers: [{ name: ds.name, image: ds.image, env: [], ports: [], cpu: ds.cpu, mem: 0 }], hash, system: true }, Math.max(t, n.readyAt));
      pod.ownerRef = `DaemonSet/${ds.name}`;
      pod.node = n.name;
      pod.nodeInstance = n.instanceId;
      pod.subnetId = n.subnetId;
      pod.ip = n.ip;
      ev(pod, pod.created, 'Normal', 'Scheduled', `Successfully assigned kube-system/${pod.name} to ${n.name}`);
      startPod(a, region, cl, pod, n.role, n.arch, pod.created, 0);
    }
  }
  if (!k.deployments['kube-system/coredns']) {
    const containers: K8sContainer[] = [{ name: 'coredns', image: '602401143452.dkr.ecr.us-west-2.amazonaws.com/eks/coredns:v1.11.4-eksbuild.2', env: [], ports: [53], cpu: 100, mem: 70 }];
    k.deployments['kube-system/coredns'] = { name: 'coredns', ns: 'kube-system', labels: { 'k8s-app': 'kube-dns' }, selector: { 'k8s-app': 'kube-dns' }, replicas: 2, containers, hash: hashOf(containers), revision: 1, history: [], created: t, generation: 1, simAt: t, maxSurge: 1, maxUnavailable: 1, system: true };
  }
}

let busy = false;

/** Hace avanzar el clúster hasta `until`: los controladores trabajan a pasos de pocos segundos. */
export function k8sSync(a: Account, region: string, cl: EksCluster, until: number): void {
  const k = cl.k8s;
  if (busy || k.simAt >= until) return;
  busy = true;
  const real = a.clock;
  try {
    const span = until - k.simAt;
    const step = Math.max(5000, Math.ceil(span / 500 / 1000) * 1000);
    let t = k.simAt;
    while (t < until) {
      t = Math.min(t + step, until);
      a.clock = t;
      // nodos que desaparecen: sus pods se evacuan
      const nodes = new Set(clusterNodes(a, region, cl).map((n) => n.name));
      for (const p of Object.values(k.pods)) if (p.node && !p.fargate && !nodes.has(p.node) && p.terminatingAt === undefined) terminate(p, t, 0);
      for (const [key, p] of Object.entries(k.pods)) if (p.deletedAt !== undefined && t >= p.deletedAt) delete k.pods[key];
      ensureSystem(a, region, cl, t);
      for (const d of Object.values(k.deployments)) reconcileDeployment(a, region, cl, d, t);
      for (const p of Object.values(k.pods)) {
        if (p.terminatingAt !== undefined) continue;
        if (!p.node) schedule(a, region, cl, p, t);
        else if (p.failure?.kind === 'ImagePull' && p.retryAt !== undefined && t >= p.retryAt) {
          const role = p.fargate ? Object.values(cl.fargateProfiles)[0]?.podExecutionRoleArn ?? '' : clusterNodes(a, region, cl).find((n) => n.name === p.node)?.role ?? '';
          startPod(a, region, cl, p, role, 'amd64', t, 0);
        }
      }
      for (const s of Object.values(k.services)) reconcileService(a, region, cl, s, t);
      // el registro del contenedor se copia a CloudWatch Logs solo si hay un agente: aquí no
      void logsPut;
    }
    k.simAt = until;
  } finally {
    a.clock = real;
    busy = false;
  }
}

/** El balanceador de un servicio está listo cuando ha pasado el aprovisionamiento. */
export const lbHostname = (a: Account, region: string, s: K8sService): string | undefined => {
  if (!s.lb || a.clock < s.lb.readyAt) return undefined;
  const lb = elb(a, region).lbs[s.lb.arn];
  return lb && lbState(a, lb) === 'active' ? s.lb.dns : undefined;
};

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    for (const cl of Object.values(a.regions[region].eks?.clusters ?? {})) if (cl.status === 'ACTIVE') k8sSync(a, region, cl, a.clock);
  }
});

export { matches, terminate, CPU_FMT };
