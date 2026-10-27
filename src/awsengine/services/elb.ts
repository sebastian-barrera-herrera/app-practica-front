/** Elastic Load Balancing (elbv2): balanceadores ALB y NLB, grupos de destino, oyentes, reglas y salud de los destinos. */
import { md5 } from '../../engine/commands/hash';
import type { Fetched } from '../../engine/commands/internet';
import { regional } from '../account';
import { instancePage } from '../hosting';
import { bestRoute, naclDecision, naclFor, routeTableFor, sgAllows } from '../net';
import { AwsError, op, type OpCtx } from '../registry';
import { tick, tickers } from '../tick';
import type { Account, Ec2Instance, Ec2Region, ElbState, LbAction, LbCondition, LbListener, LbRule, LoadBalancer, TargetGroup, Tag, TgTarget } from '../types';
import { iso, mergeTags, newId, parseCidr, intToIp, toArr, wildcard } from '../util';
import { refreshEc2 } from './ec2';

export const elb = (a: Account, region: string): ElbState => {
  const r = regional(a, region);
  return (r.elb ??= { lbs: {}, tgs: {} });
};

const PROVISION_MS = 150000;

const E = {
  lb: (x: string) => new AwsError('LoadBalancerNotFound', `Load balancers '[${x}]' not found`, 400),
  tg: (x: string) => new AwsError('TargetGroupNotFound', `Target groups '[${x}]' not found`, 400),
  listener: (x: string) => new AwsError('ListenerNotFound', `Listeners '[${x}]' not found`, 400),
  rule: (x: string) => new AwsError('RuleNotFound', `Rules '[${x}]' not found`, 400),
  val: (m: string) => new AwsError('ValidationError', m, 400),
};

// ───────────────────────── identificadores ─────────────────────────

const TYPE_SEG = { application: 'app', network: 'net', gateway: 'gwy' } as const;
const HOSTED_ZONE: Record<string, string> = { 'us-east-1': 'Z35SXDOTRQ7X7K', 'us-east-2': 'Z3AADJGX6KTTL2', 'us-west-1': 'Z368ELLRRE2KJ0', 'us-west-2': 'Z1H1FL5HABSF5', 'eu-west-1': 'Z32O12XQLNTSW2', 'eu-central-1': 'Z215JYRZR1TBD5', 'eu-west-2': 'ZHURV8PSTC4K8' };

const lbDns = (region: string, name: string, type: string, scheme: string, key: string) => {
  const h = md5(key);
  if (type === 'network') return `${name}-${h.slice(0, 16)}.elb.${region}.amazonaws.com`;
  const digits = String(parseInt(h.slice(0, 8), 16) % 1_000_000_000).padStart(9, '0');
  return `${scheme === 'internal' ? 'internal-' : ''}${name}-${digits}.${region}.elb.amazonaws.com`;
};

const lbSuffix = (lb: LoadBalancer) => lb.LoadBalancerArn.split('loadbalancer/')[1]; // app/nombre/hex
const hex = (a: Account, kind: string, n = 16) => newId(a, kind, '', n, 'hex');

// ───────────────────────── búsqueda ─────────────────────────

export function findLb(a: Account, region: string, ref: string): LoadBalancer {
  const s = elb(a, region);
  const lb = s.lbs[ref] ?? Object.values(s.lbs).find((x) => x.LoadBalancerName === ref);
  if (!lb) throw E.lb(ref);
  return lb;
}

export function findTg(a: Account, region: string, arn: string): TargetGroup {
  const tg = elb(a, region).tgs[arn];
  if (!tg) throw E.tg(arn);
  return tg;
}

/** Todos los balanceadores de la cuenta cuyo DNS coincide (para `curl` y Route 53). */
export function lbByDns(a: Account, host: string): { lb: LoadBalancer; region: string } | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  for (const region of Object.keys(a.regions)) {
    const hit = Object.values(a.regions[region].elb?.lbs ?? {}).find((l) => l.DNSName.toLowerCase() === h);
    if (hit) return { lb: hit, region };
  }
  return null;
}

export const lbState = (a: Account, lb: LoadBalancer): 'provisioning' | 'active' => (a.clock - lb.createdAt >= PROVISION_MS ? 'active' : 'provisioning');

const allActions = (lb: LoadBalancer): LbAction[] => Object.values(lb.listeners).flatMap((l) => l.rules.flatMap((r) => r.Actions));
const actionTgs = (act: LbAction): string[] => (act.Type !== 'forward' ? [] : act.ForwardConfig ? act.ForwardConfig.TargetGroups.map((t) => t.TargetGroupArn) : act.TargetGroupArn ? [act.TargetGroupArn] : []);

/** Balanceadores que mandan tráfico a un grupo de destino. */
/** Peticiones por segundo que aguanta una tarea de ECS según su CPU (256 = 30 rps); `undefined` si la IP no es de una tarea. */
export function ecsTaskCapacity(a: Account, region: string, ip: string): number | undefined {
  const t = Object.values(a.regions[region]?.ecs?.tasks ?? {}).find((x) => x.privateIp === ip && x.desiredStatus === 'RUNNING' && x.stoppedAt === undefined);
  return t ? Math.max(10, (Number(t.cpu) / 1024) * 120) : undefined;
}

export function lbsUsing(a: Account, region: string, tgArn: string): LoadBalancer[] {
  return Object.values(elb(a, region).lbs).filter((lb) => allActions(lb).some((act) => actionTgs(act).includes(tgArn)));
}

// ───────────────────────── salud de los destinos ─────────────────────────

export interface TargetHealthInfo {
  state: 'initial' | 'healthy' | 'unhealthy' | 'unused' | 'draining' | 'unavailable';
  reason?: string;
  description?: string;
}

const PENDING_MS = 10000;
const upSince = (i: Ec2Instance) => {
  const launch = Date.parse(i.LaunchTime);
  return i.stateAt < launch ? launch : launch + PENDING_MS;
};

/** Una IP de cada subred del balanceador, desde la que «sale» el tráfico de las comprobaciones. */
const nodeIps = (r: Ec2Region, lb: LoadBalancer): string[] =>
  lb.subnetIds.map((id) => {
    const c = parseCidr(r.subnets[id]?.CidrBlock ?? '10.0.0.0/24')!;
    return intToIp(c.base + 10);
  });

/** ¿Llega el tráfico del balanceador a una interfaz (grupos de seguridad y NACL de su subred) por el puerto dado? */
function nodeReachesEni(r: Ec2Region, lb: LoadBalancer, sgIds: string[], subnetId: string, port: number): boolean {
  const groups = sgIds.map((id) => r.securityGroups[id]).filter(Boolean);
  const acl = naclFor(r, subnetId);
  return nodeIps(r, lb).some((ip) => sgAllows(groups, false, 'tcp', port, ip, lb.SecurityGroups) && naclDecision(acl, false, 'tcp', ip, port).allowed);
}

/** ¿Llega el tráfico del balanceador a la instancia por el puerto dado? (grupo de seguridad y NACL del destino) */
function nodeReaches(r: Ec2Region, lb: LoadBalancer, inst: Ec2Instance, port: number): boolean {
  return nodeReachesEni(r, lb, inst.SecurityGroupIds, inst.SubnetId, port);
}

/** Un destino de tipo `ip`: la interfaz de red de una tarea de ECS (lo resuelve el servicio que la creó). */
export interface IpTargetInfo {
  up: boolean;
  state: string;
  subnetId: string;
  az: string;
  sgIds: string[];
  /** Instante en que pasó a estar en marcha. */
  since: number;
  /** Atiende una petición HTTP en ese puerto del contenedor. `refused`: nadie escucha (o solo en 127.0.0.1). */
  http: (port: number, method: string, path: string, probe?: boolean) => { refused?: boolean; status?: number; type?: string; body?: string; headers?: Record<string, string> };
}
export const ipTargets: { resolve?: (a: Account, region: string, ip: string) => IpTargetInfo | undefined } = {};
const isIpId = (id: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(id);

/** Estados que no dependen de las comprobaciones (el destino no está en uso, se está retirando, la instancia no corre…). */
function directState(a: Account, region: string, tg: TargetGroup, t: { Id: string; Port: number; registeredAt: number; deregisteredAt?: number }): TargetHealthInfo | null {
  const r = regional(a, region).ec2;
  if (t.deregisteredAt !== undefined) return { state: 'draining', reason: 'Target.DeregistrationInProgress', description: 'Target deregistration is in progress' };
  const lbs = lbsUsing(a, region, tg.TargetGroupArn);
  if (!lbs.length) return { state: 'unused', reason: 'Target.NotInUse', description: 'Target group is not configured to receive traffic from the load balancer' };
  if (isIpId(t.Id)) {
    const ip = ipTargets.resolve?.(a, region, t.Id);
    if (!ip) return { state: 'unused', reason: 'Target.InvalidState', description: 'Target is in the stopped state' };
    if (!ip.up) return { state: ip.state === 'STOPPED' || ip.state === 'DEPROVISIONING' ? 'unused' : 'initial', reason: ip.state === 'STOPPED' || ip.state === 'DEPROVISIONING' ? 'Target.InvalidState' : 'Elb.RegistrationInProgress', description: ip.state === 'STOPPED' || ip.state === 'DEPROVISIONING' ? 'Target is in the stopped state' : 'Target registration is in progress' };
    if (!lbs[0].subnetIds.map((id) => r.subnets[id]?.AvailabilityZone).includes(ip.az)) return { state: 'unused', reason: 'Target.NotInUse', description: 'Target is in an Availability Zone that is not enabled for the load balancer' };
    return null;
  }
  const inst = r.instances[t.Id];
  if (!inst || inst.state === 'terminated' || inst.state === 'shutting-down') return { state: 'unused', reason: 'Target.InvalidState', description: 'Target is in the terminated state' };
  if (inst.state === 'stopped' || inst.state === 'stopping') return { state: 'unused', reason: 'Target.InvalidState', description: `Target is in the ${inst.state} state` };
  if (inst.state === 'pending') return { state: 'initial', reason: 'Elb.RegistrationInProgress', description: 'Target registration is in progress' };
  const azs = lbs[0].subnetIds.map((id) => r.subnets[id]?.AvailabilityZone);
  if (!azs.includes(inst.AvailabilityZone)) return { state: 'unused', reason: 'Target.NotInUse', description: 'Target is in an Availability Zone that is not enabled for the load balancer' };
  return null;
}

/** Lo que verían ahora mismo las comprobaciones de salud del balanceador contra el destino. */
function probeTarget(a: Account, region: string, tg: TargetGroup, t: { Id: string; Port: number }): { ok: boolean; reason?: string; description?: string } {
  const r = regional(a, region).ec2;
  const lb = lbsUsing(a, region, tg.TargetGroupArn)[0];
  const hcPort = tg.HealthCheckPort === 'traffic-port' ? t.Port : Number(tg.HealthCheckPort);
  if (isIpId(t.Id)) {
    const ip = ipTargets.resolve!(a, region, t.Id)!;
    if (!nodeReachesEni(r, lb, ip.sgIds, ip.subnetId, hcPort)) return { ok: false, reason: 'Target.Timeout', description: 'Request timed out' };
    if (tg.HealthCheckProtocol === 'TCP' || tg.Protocol === 'TCP' || tg.Protocol === 'TLS') {
      const res = ip.http(hcPort, 'GET', '/', true);
      return res.refused ? { ok: false, reason: 'Target.FailedHealthChecks', description: 'Health checks failed' } : { ok: true };
    }
    const res = ip.http(hcPort, 'GET', tg.HealthCheckPath, true);
    if (res.refused || res.status === undefined) return { ok: false, reason: 'Target.FailedHealthChecks', description: 'Health checks failed' };
    if (!matchesCodes(tg.Matcher.HttpCode, res.status)) return { ok: false, reason: 'Target.ResponseCodeMismatch', description: `Health checks failed with these codes: [${res.status}]` };
    return { ok: true };
  }
  const inst = r.instances[t.Id];
  if (!nodeReaches(r, lb, inst, hcPort)) return { ok: false, reason: 'Target.Timeout', description: 'Request timed out' };
  if (tg.HealthCheckProtocol === 'TCP' || tg.Protocol === 'TCP' || tg.Protocol === 'TLS') {
    return /(httpd|nginx|apache2|http\.server)/.test(inst.UserData ?? '') && hcPort === 80 ? { ok: true } : { ok: false, reason: 'Target.FailedHealthChecks', description: 'Health checks failed' };
  }
  const page = hcPort === 80 ? instancePage(inst, tg.HealthCheckPath) : null;
  if (!page) return { ok: false, reason: 'Target.FailedHealthChecks', description: 'Health checks failed' };
  if (!matchesCodes(tg.Matcher.HttpCode, page.status)) return { ok: false, reason: 'Target.ResponseCodeMismatch', description: `Health checks failed with these codes: [${page.status}]` };
  return { ok: true };
}

const INITIAL = { state: 'initial' as const, reason: 'Elb.InitialHealthChecking', description: 'Initial health checking in progress' };

/** Estado de salud de un destino. Pasa a «healthy» tras N comprobaciones buenas seguidas y a «unhealthy» tras M malas seguidas. */
export function targetHealth(a: Account, region: string, tg: TargetGroup, t: TgTarget): TargetHealthInfo {
  const direct = directState(a, region, tg, t);
  if (direct) {
    t.hs = undefined;
    return direct;
  }
  const inst = regional(a, region).ec2.instances[t.Id];
  const probe = probeTarget(a, region, tg, t);
  const interval = tg.HealthCheckIntervalSeconds * 1000;
  const since0 = isIpId(t.Id) ? Math.max(t.registeredAt, ipTargets.resolve?.(a, region, t.Id)?.since ?? 0) : Math.max(t.registeredAt, upSince(inst));
  const hs = (t.hs ??= { ok: probe.ok, since: since0, state: 'initial', lastEval: a.clock });
  if (hs.ok !== probe.ok) {
    hs.ok = probe.ok;
    hs.since = hs.lastEval;
  }
  const elapsed = a.clock - hs.since;
  if (probe.ok && elapsed >= interval * tg.HealthyThresholdCount) hs.state = 'healthy';
  else if (!probe.ok && elapsed >= interval * tg.UnhealthyThresholdCount) hs.state = 'unhealthy';
  hs.lastEval = a.clock;
  if (!probe.ok) {
    hs.reason = probe.reason;
    hs.description = probe.description;
  }
  if (hs.state === 'healthy') return { state: 'healthy' };
  if (hs.state === 'unhealthy') return { state: 'unhealthy', reason: hs.reason, description: hs.description };
  return INITIAL;
}

const matchesCodes = (spec: string, code: number): boolean =>
  spec.split(',').some((p) => {
    const m = /^\s*(\d{3})(?:-(\d{3}))?\s*$/.exec(p);
    if (!m) return false;
    return m[2] ? code >= Number(m[1]) && code <= Number(m[2]) : code === Number(m[1]);
  });

/** Destinos que atienden ahora mismo (en buen estado). */
export function healthyTargets(a: Account, region: string, tg: TargetGroup) {
  return tg.targets.filter((t) => targetHealth(a, region, tg, t).state === 'healthy');
}

/** ¿Tiene el balanceador al menos un destino sano en alguno de sus grupos? (lo usa Route 53 con «evaluar la salud») */
export function lbHasHealthy(a: Account, region: string, lb: LoadBalancer): boolean {
  if (lbState(a, lb) !== 'active') return false;
  const arns = new Set(allActions(lb).flatMap(actionTgs));
  return [...arns].some((arn) => {
    const tg = elb(a, region).tgs[arn];
    return !!tg && healthyTargets(a, region, tg).length > 0;
  });
}

// ───────────────────────── atender peticiones ─────────────────────────

export interface LbRequest {
  port: number;
  scheme: string;
  method: string;
  host: string;
  path: string;
  query: string;
  srcIp: string;
}

const errPage = (code: number, title: string): Fetched => ({
  ok: true,
  status: code,
  type: 'text/html',
  body: `<html>\r\n<head><title>${code} ${title}</title></head>\r\n<body>\r\n<center><h1>${code} ${title}</h1></center>\r\n</body>\r\n</html>\r\n`,
  headers: { Server: 'awselb/2.0' },
});

/** ¿Llega una petición de internet hasta los nodos del balanceador? */
export function lbFromInternet(a: Account, region: string, lb: LoadBalancer, port: number, srcIp: string): { ok: boolean; why?: string } {
  const r = regional(a, region).ec2;
  if (lb.Scheme !== 'internet-facing') return { ok: false, why: 'El balanceador es interno: solo tiene IP privadas.' };
  const igw = Object.values(r.internetGateways).find((g) => g.VpcId === lb.VpcId);
  if (!igw) return { ok: false, why: 'La VPC no tiene internet gateway.' };
  const publicSubnets = lb.subnetIds.filter((id) => {
    const rt = routeTableFor(r, id);
    const rr = rt ? bestRoute(r, rt, srcIp) : undefined;
    return rr?.target === igw.InternetGatewayId;
  });
  if (!publicSubnets.length) return { ok: false, why: 'Ninguna subred del balanceador tiene ruta a la internet gateway.' };
  if (lb.SecurityGroups.length) {
    const groups = lb.SecurityGroups.map((id) => r.securityGroups[id]).filter(Boolean);
    if (!sgAllows(groups, false, 'tcp', port, srcIp)) return { ok: false, why: `El security group del balanceador no permite el puerto ${port}.` };
  }
  if (!publicSubnets.some((id) => naclDecision(naclFor(r, id), false, 'tcp', srcIp, port).allowed)) return { ok: false, why: 'La NACL de la subred bloquea la entrada.' };
  return { ok: true };
}

const hash = (s: string) => parseInt(md5(s).slice(0, 8), 16);

const condMatches = (c: LbCondition, q: LbRequest): boolean => {
  const vals = c.Values ?? c.PathPatternConfig?.Values ?? c.HostHeaderConfig?.Values ?? c.HttpRequestMethodConfig?.Values ?? [];
  if (c.Field === 'path-pattern') return vals.some((p) => wildcard(p, q.path.split('?')[0]));
  if (c.Field === 'host-header') return vals.some((p) => wildcard(p, q.host, true));
  if (c.Field === 'http-request-method') return vals.some((p) => p.toUpperCase() === q.method.toUpperCase());
  if (c.Field === 'source-ip') return vals.some((p) => parseCidr(p) !== null && q.srcIp !== '' && wildcard('*', q.srcIp));
  return false;
};

const ruleOrder = (l: LbListener): LbRule[] => [...l.rules].sort((x, y) => (x.IsDefault ? 1 : y.IsDefault ? -1 : Number(x.Priority) - Number(y.Priority)));

function redirect(act: LbAction, q: LbRequest): Fetched {
  const c = act.RedirectConfig!;
  const sub = (t: string | undefined, d: string) =>
    (t ?? d)
      .replace(/#\{host\}/g, q.host)
      .replace(/#\{path\}/g, q.path.split('?')[0])
      .replace(/#\{port\}/g, String(q.port))
      .replace(/#\{protocol\}/g, q.scheme)
      .replace(/#\{query\}/g, q.query);
  const proto = sub(c.Protocol, '#{protocol}').toLowerCase();
  const port = sub(c.Port, '#{port}');
  const host = sub(c.Host, '#{host}');
  const path = sub(c.Path, '#{path}');
  const query = c.Query !== undefined ? sub(c.Query, '#{query}') : q.query;
  const defPort = proto === 'https' ? '443' : '80';
  const url = `${proto}://${host}${port === defPort ? '' : ':' + port}${path.startsWith('/') ? path : '/' + path}${query ? '?' + query : ''}`;
  const code = c.StatusCode === 'HTTP_301' ? 301 : 302;
  return { ok: true, status: code, type: 'text/html', body: `<html>\r\n<head><title>${code} ${code === 301 ? 'Moved Permanently' : 'Found'}</title></head>\r\n<body>\r\n<center><h1>${code} ${code === 301 ? 'Moved Permanently' : 'Found'}</h1></center>\r\n</body>\r\n</html>\r\n`, headers: { Server: 'awselb/2.0', Location: url } };
}

function forward(a: Account, region: string, lb: LoadBalancer, act: LbAction, q: LbRequest): Fetched {
  const r = regional(a, region).ec2;
  const groups = act.ForwardConfig ? act.ForwardConfig.TargetGroups : act.TargetGroupArn ? [{ TargetGroupArn: act.TargetGroupArn, Weight: 1 }] : [];
  const live = groups.filter((g) => elb(a, region).tgs[g.TargetGroupArn]);
  const total = live.reduce((n, g) => n + (g.Weight ?? 1), 0);
  if (!live.length || total === 0) return errPage(503, 'Service Temporarily Unavailable');
  let pick = hash(`${lb.LoadBalancerArn}:${lb.served}`) % total;
  let chosen = live[0];
  for (const g of live) {
    if ((g.Weight ?? 1) > pick) {
      chosen = g;
      break;
    }
    pick -= g.Weight ?? 1;
  }
  const tg = elb(a, region).tgs[chosen.TargetGroupArn];
  const registered = tg.targets.filter((t) => t.deregisteredAt === undefined);
  let pool = healthyTargets(a, region, tg);
  // sin ningún destino sano, el balanceador reparte entre todos los registrados («fail open»)
  if (!pool.length) pool = registered;
  if (!pool.length) return errPage(503, 'Service Temporarily Unavailable');
  const t = pool[lb.served % pool.length];
  if (isIpId(t.Id)) {
    const ip = ipTargets.resolve?.(a, region, t.Id);
    if (!ip || !ip.up) return errPage(502, 'Bad Gateway');
    if (!nodeReachesEni(r, lb, ip.sgIds, ip.subnetId, t.Port)) return errPage(504, 'Gateway Time-out');
    const res = ip.http(t.Port, q.method, q.path + (q.query ? '?' + q.query : ''));
    if (res.refused || res.status === undefined) return errPage(502, 'Bad Gateway');
    return { ok: true, status: res.status, type: res.type ?? 'text/html', body: res.body ?? '', headers: { ...(res.headers ?? {}), Server: 'awselb/2.0' } };
  }
  const inst = r.instances[t.Id];
  if (!inst || inst.state !== 'running') return errPage(502, 'Bad Gateway');
  const reach = lb.Type === 'network' ? sgAllows(inst.SecurityGroupIds.map((id) => r.securityGroups[id]).filter(Boolean), false, 'tcp', t.Port, q.srcIp) : nodeReaches(r, lb, inst, t.Port);
  if (!reach) return errPage(504, 'Gateway Time-out');
  const page = t.Port === 80 ? instancePage(inst, q.path) : null;
  if (!page) return errPage(502, 'Bad Gateway');
  const stick = tg.attributes['stickiness.enabled'] === 'true';
  return { ok: true, status: page.status, type: page.type, body: page.body, headers: { ...page.headers, Server: lb.Type === 'network' ? page.headers.Server : 'awselb/2.0', ...(stick ? { 'Set-Cookie': `AWSALB=${md5(inst.InstanceId).slice(0, 24)}; Expires=${new Date(a.clock + 7 * 86400000).toUTCString()}; Path=/` } : {}) } };
}

/** El balanceador atiende una petición ya llegada a sus nodos. */
export function lbHandle(a: Account, region: string, lb: LoadBalancer, q: LbRequest): Fetched {
  tick(a);
  const l = Object.values(lb.listeners).find((x) => x.Port === q.port && ((x.Protocol === 'HTTP' && q.scheme === 'http') || (x.Protocol === 'HTTPS' && q.scheme === 'https') || x.Protocol === 'TCP' || x.Protocol === 'TCP_UDP' || x.Protocol === 'TLS'));
  if (!l) return { ok: false, curlCode: 7, error: `Failed to connect to ${lb.DNSName} port ${q.port} after 41 ms: Couldn't connect to server` };
  lb.served++;
  const rule = ruleOrder(l).find((r) => r.IsDefault || r.Conditions.every((c) => condMatches(c, q)));
  const act = [...(rule?.Actions ?? [])].sort((x, y) => (x.Order ?? 0) - (y.Order ?? 0))[0];
  if (!act) return errPage(503, 'Service Temporarily Unavailable');
  if (act.Type === 'redirect') return redirect(act, q);
  if (act.Type === 'fixed-response') {
    const f = act.FixedResponseConfig!;
    return { ok: true, status: Number(f.StatusCode), type: f.ContentType ?? 'text/plain', body: f.MessageBody ?? '', headers: { Server: 'awselb/2.0' } };
  }
  return forward(a, region, lb, act, q);
}

// ───────────────────────── carga de trabajo (para Auto Scaling y métricas) ─────────────────────────

/** Peticiones por segundo que recibe el balanceador en el instante `t` por las pruebas de carga. */
export function rpsAt(a: Account, lbArn: string, t: number): number {
  return (a.loads ?? []).filter((l) => l.lbArn === lbArn && t >= l.from && t < l.until).reduce((n, l) => n + l.rps, 0);
}

// ───────────────────────── vistas ─────────────────────────

const lbArn = (c: Pick<OpCtx, 'acct' | 'region'>, type: keyof typeof TYPE_SEG, name: string, id: string) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:loadbalancer/${TYPE_SEG[type]}/${name}/${id}`;

const lbView = (c: OpCtx, lb: LoadBalancer) => {
  const r = regional(c.acct, c.region).ec2;
  return {
    LoadBalancerArn: lb.LoadBalancerArn,
    DNSName: lb.DNSName,
    CanonicalHostedZoneId: lb.CanonicalHostedZoneId,
    CreatedTime: iso(lb.createdAt),
    LoadBalancerName: lb.LoadBalancerName,
    Scheme: lb.Scheme,
    VpcId: lb.VpcId,
    State: { Code: lbState(c.acct, lb) },
    Type: lb.Type,
    AvailabilityZones: lb.subnetIds.map((id) => ({ ZoneName: r.subnets[id]?.AvailabilityZone, SubnetId: id, LoadBalancerAddresses: [] as unknown[] })),
    ...(lb.Type !== 'gateway' ? { SecurityGroups: lb.SecurityGroups } : {}),
    IpAddressType: lb.IpAddressType,
  };
};

const tgView = (a: Account, region: string, tg: TargetGroup) => ({
  TargetGroupArn: tg.TargetGroupArn,
  TargetGroupName: tg.TargetGroupName,
  Protocol: tg.Protocol,
  Port: tg.Port,
  VpcId: tg.VpcId,
  HealthCheckProtocol: tg.HealthCheckProtocol,
  HealthCheckPort: tg.HealthCheckPort,
  HealthCheckEnabled: true,
  HealthCheckIntervalSeconds: tg.HealthCheckIntervalSeconds,
  HealthCheckTimeoutSeconds: tg.HealthCheckTimeoutSeconds,
  HealthyThresholdCount: tg.HealthyThresholdCount,
  UnhealthyThresholdCount: tg.UnhealthyThresholdCount,
  ...(tg.Protocol.startsWith('HTTP') ? { HealthCheckPath: tg.HealthCheckPath } : {}),
  Matcher: tg.Matcher,
  LoadBalancerArns: lbsUsing(a, region, tg.TargetGroupArn).map((l) => l.LoadBalancerArn),
  TargetType: tg.TargetType,
  ProtocolVersion: tg.Protocol.startsWith('HTTP') ? 'HTTP1' : undefined,
  IpAddressType: 'ipv4',
});

const listenerView = (l: LbListener) => ({
  ListenerArn: l.ListenerArn,
  LoadBalancerArn: l.LoadBalancerArn,
  Port: l.Port,
  Protocol: l.Protocol,
  ...(l.Certificates ? { Certificates: l.Certificates } : {}),
  ...(l.SslPolicy ? { SslPolicy: l.SslPolicy } : {}),
  DefaultActions: (l.rules.find((r) => r.IsDefault)?.Actions ?? []).map(actionView),
});

function actionView(act: LbAction) {
  if (act.Type === 'forward') {
    const groups = act.ForwardConfig ? act.ForwardConfig.TargetGroups.map((g) => ({ TargetGroupArn: g.TargetGroupArn, Weight: g.Weight ?? 1 })) : [{ TargetGroupArn: act.TargetGroupArn!, Weight: 1 }];
    return { Type: 'forward', ...(act.TargetGroupArn ? { TargetGroupArn: act.TargetGroupArn } : {}), ForwardConfig: { TargetGroups: groups, TargetGroupStickinessConfig: { Enabled: act.ForwardConfig?.TargetGroupStickinessConfig?.Enabled ?? false } }, Order: act.Order ?? 1 };
  }
  return { ...act, Order: act.Order ?? 1 };
}

const ruleView = (r: LbRule) => ({ RuleArn: r.RuleArn, Priority: r.Priority, Conditions: r.Conditions.map(condView), Actions: r.Actions.map(actionView), IsDefault: r.IsDefault });
const condView = (c: LbCondition) => {
  const v = c.Values ?? c.PathPatternConfig?.Values ?? c.HostHeaderConfig?.Values ?? c.HttpRequestMethodConfig?.Values ?? [];
  const cfg = c.Field === 'path-pattern' ? 'PathPatternConfig' : c.Field === 'host-header' ? 'HostHeaderConfig' : c.Field === 'http-request-method' ? 'HttpRequestMethodConfig' : null;
  return { Field: c.Field, Values: v, ...(cfg ? { [cfg]: { Values: v } } : {}) };
};

// ───────────────────────── validación de acciones ─────────────────────────

function normActions(c: OpCtx, lb: LoadBalancer, raw: unknown): LbAction[] {
  const list = (Array.isArray(raw) ? raw : []) as Record<string, any>[];
  if (!list.length) throw E.val("Default actions are required");
  return list.map((x, i) => {
    const type = String(x.Type);
    if (!['forward', 'redirect', 'fixed-response'].includes(type)) throw E.val(`1 validation error detected: Value '${type}' at 'defaultActions.${i + 1}.member.type' failed to satisfy constraint: Member must satisfy enum value set: [forward, authenticate-oidc, redirect, fixed-response, authenticate-cognito]`);
    const act: LbAction = { Type: type as LbAction['Type'], ...(x.Order !== undefined ? { Order: Number(x.Order) } : {}) };
    if (type === 'forward') {
      const arns: string[] = x.ForwardConfig?.TargetGroups ? x.ForwardConfig.TargetGroups.map((t: any) => t.TargetGroupArn) : x.TargetGroupArn ? [x.TargetGroupArn] : [];
      if (!arns.length) throw E.val("A target group ARN must be specified for forward actions.");
      for (const arn of arns) {
        const tg = elb(c.acct, c.region).tgs[arn];
        if (!tg) throw E.tg(arn);
        if (tg.VpcId !== lb.VpcId) throw E.val(`Target group '${arn}' is not in the same VPC as the load balancer`);
      }
      if (x.ForwardConfig) act.ForwardConfig = { TargetGroups: x.ForwardConfig.TargetGroups.map((t: any) => ({ TargetGroupArn: t.TargetGroupArn, Weight: t.Weight !== undefined ? Number(t.Weight) : 1 })), ...(x.ForwardConfig.TargetGroupStickinessConfig ? { TargetGroupStickinessConfig: x.ForwardConfig.TargetGroupStickinessConfig } : {}) };
      else act.TargetGroupArn = x.TargetGroupArn;
    } else if (type === 'redirect') {
      if (!x.RedirectConfig?.StatusCode) throw E.val('RedirectConfig.StatusCode is required for redirect actions.');
      act.RedirectConfig = x.RedirectConfig;
    } else {
      if (!x.FixedResponseConfig?.StatusCode) throw E.val('FixedResponseConfig.StatusCode is required for fixed-response actions.');
      act.FixedResponseConfig = x.FixedResponseConfig;
    }
    return act;
  });
}

function normConditions(raw: unknown): LbCondition[] {
  const list = (Array.isArray(raw) ? raw : []) as Record<string, any>[];
  if (!list.length) throw E.val('Conditions are required');
  return list.map((x) => {
    const field = String(x.Field);
    if (!['path-pattern', 'host-header', 'http-request-method', 'source-ip', 'http-header', 'query-string'].includes(field)) throw E.val(`Condition field '${field}' is not valid`);
    const vals: string[] = toArr<string>(x.Values ?? x.PathPatternConfig?.Values ?? x.HostHeaderConfig?.Values ?? x.HttpRequestMethodConfig?.Values);
    if (!vals.length) throw E.val(`Condition value for field '${field}' is required`);
    return { Field: field, Values: vals };
  });
}

// ───────────────────────── operaciones: balanceadores ─────────────────────────

const lbRes = (c: OpCtx) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:loadbalancer/*`;
const tgRes = (c: OpCtx) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:targetgroup/*`;
const LB_ATTRS = (type: string): Record<string, string> =>
  type === 'application'
    ? { 'deletion_protection.enabled': 'false', 'access_logs.s3.enabled': 'false', 'idle_timeout.timeout_seconds': '60', 'routing.http.drop_invalid_header_fields.enabled': 'false', 'routing.http2.enabled': 'true', 'load_balancing.cross_zone.enabled': 'true', 'routing.http.desync_mitigation_mode': 'defensive' }
    : { 'deletion_protection.enabled': 'false', 'access_logs.s3.enabled': 'false', 'load_balancing.cross_zone.enabled': 'false' };

export function elbCreateLb(a: Account, region: string, o: { name: string; type?: 'application' | 'network'; scheme?: 'internet-facing' | 'internal'; subnets: string[]; sgs?: string[]; tags?: Tag[]; age?: number }): LoadBalancer {
  const r = regional(a, region).ec2;
  const type = o.type ?? 'application';
  const scheme = o.scheme ?? 'internet-facing';
  const vpcId = r.subnets[o.subnets[0]].VpcId;
  const id = hex(a, 'elbid');
  const arn = lbArn({ acct: a, region }, type, o.name, id);
  const lb: LoadBalancer = {
    LoadBalancerArn: arn,
    DNSName: lbDns(region, o.name, type, scheme, arn),
    CanonicalHostedZoneId: HOSTED_ZONE[region] ?? 'Z' + md5(region).slice(0, 12).toUpperCase(),
    LoadBalancerName: o.name,
    Scheme: scheme,
    Type: type,
    VpcId: vpcId,
    subnetIds: o.subnets,
    SecurityGroups: o.sgs ?? [],
    IpAddressType: 'ipv4',
    attributes: LB_ATTRS(type),
    listeners: {},
    createdAt: a.clock - (o.age ?? 0),
    Tags: o.tags ?? [],
    served: 0,
  };
  elb(a, region).lbs[arn] = lb;
  return lb;
}

op('elbv2', 'create-load-balancer', 'name:s! subnets:l subnet-mappings:f security-groups:l scheme:s tags:t type:s ip-address-type:s', 'Crea un balanceador de carga (ALB por defecto, o NLB con --type network).', { res: lbRes }, (c) => {
  const name = String(c.p.Name);
  if (name.length > 32) throw E.val(`Load balancer name '${name}' cannot be longer than '32' characters`);
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(name) || name.startsWith('internal-')) throw E.val(`Load balancer name '${name}' can only contain characters that are alphanumeric characters or hyphens(-)\n`);
  const type = (c.p.Type ?? 'application') as 'application' | 'network' | 'gateway';
  if (!['application', 'network', 'gateway'].includes(type)) throw E.val(`1 validation error detected: Value '${type}' at 'type' failed to satisfy constraint: Member must satisfy enum value set: [application, network, gateway]`);
  const scheme = (c.p.Scheme ?? 'internet-facing') as 'internet-facing' | 'internal';
  if (!['internet-facing', 'internal'].includes(scheme)) throw E.val(`1 validation error detected: Value '${scheme}' at 'scheme' failed to satisfy constraint: Member must satisfy enum value set: [internal, internet-facing]`);
  const r = regional(c.acct, c.region).ec2;
  const subnets: string[] = c.p.Subnets ?? (c.p.SubnetMappings ?? []).map((m: any) => m.SubnetId);
  if (!subnets.length) throw E.val('At least two subnets in two different Availability Zones must be specified');
  for (const s of subnets) if (!r.subnets[s]) throw new AwsError('SubnetNotFound', `The subnet ID '${s}' does not exist`, 400);
  const azs = new Set(subnets.map((s) => r.subnets[s].AvailabilityZone));
  if (type === 'application' && azs.size < 2) throw E.val('At least two subnets in two different Availability Zones must be specified');
  if (azs.size < subnets.length) throw E.val(`A load balancer cannot be attached to multiple subnets in the same Availability Zone`);
  const vpcs = new Set(subnets.map((s) => r.subnets[s].VpcId));
  if (vpcs.size > 1) throw E.val('Subnets must belong to the same VPC');
  const vpcId = [...vpcs][0];
  const sgs: string[] = c.p.SecurityGroups ?? [];
  for (const g of sgs) {
    const sg = r.securityGroups[g];
    if (!sg) throw new AwsError('InvalidConfigurationRequest', `The security group '${g}' does not exist`, 400);
    if (sg.VpcId !== vpcId) throw new AwsError('InvalidConfigurationRequest', `The security group '${g}' does not belong to VPC '${vpcId}'`, 400);
  }
  if (type === 'application' && !sgs.length) {
    const def = Object.values(r.securityGroups).find((g) => g.VpcId === vpcId && g.GroupName === 'default');
    if (def) sgs.push(def.GroupId);
  }
  if (scheme === 'internet-facing' && !Object.values(r.internetGateways).some((g) => g.VpcId === vpcId)) throw E.val(`VPC ${vpcId} has no internet gateway`);
  const existing = Object.values(elb(c.acct, c.region).lbs).find((l) => l.LoadBalancerName === name);
  if (existing) {
    const same = existing.Type === type && existing.Scheme === scheme && existing.subnetIds.slice().sort().join() === subnets.slice().sort().join();
    if (!same) throw new AwsError('DuplicateLoadBalancerName', 'A load balancer with the same name \'' + name + '\' exists, but with different settings', 400);
    return { LoadBalancers: [lbView(c, existing)] };
  }
  const lb = elbCreateLb(c.acct, c.region, { name, type: type as 'application' | 'network', scheme, subnets, sgs, tags: c.p.Tags });
  return { LoadBalancers: [lbView(c, lb)] };
});

op('elbv2', 'describe-load-balancers', 'load-balancer-arns:l names:l', 'Lista los balanceadores de la región.', { paginate: 'LoadBalancers', res: lbRes }, (c) => {
  const s = elb(c.acct, c.region);
  let list = Object.values(s.lbs);
  if (c.p.LoadBalancerArns) list = (c.p.LoadBalancerArns as string[]).map((x) => s.lbs[x] ?? (() => { throw E.lb(x); })());
  if (c.p.Names) list = (c.p.Names as string[]).map((n) => list.find((l) => l.LoadBalancerName === n) ?? (() => { throw E.lb(n); })());
  return { LoadBalancers: list.map((l) => lbView(c, l)) };
});

op('elbv2', 'delete-load-balancer', 'load-balancer-arn:s!', 'Borra un balanceador (y sus oyentes).', { res: (c) => c.p.LoadBalancerArn }, (c) => {
  const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
  if (lb.attributes['deletion_protection.enabled'] === 'true') throw new AwsError('OperationNotPermitted', `Load balancer '${lb.LoadBalancerArn}' cannot be deleted because deletion protection is enabled`, 400);
  delete elb(c.acct, c.region).lbs[lb.LoadBalancerArn];
  return {};
});

op('elbv2', 'describe-load-balancer-attributes', 'load-balancer-arn:s!', 'Atributos de un balanceador (tiempo de espera, protección contra borrado, zonas cruzadas…).', { res: (c) => c.p.LoadBalancerArn }, (c) => ({ Attributes: Object.entries(findLb(c.acct, c.region, c.p.LoadBalancerArn).attributes).map(([Key, Value]) => ({ Key, Value })) }));

op('elbv2', 'modify-load-balancer-attributes', 'load-balancer-arn:s! attributes:f!', 'Cambia atributos de un balanceador.', { res: (c) => c.p.LoadBalancerArn }, (c) => {
  const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
  for (const a of c.p.Attributes as { Key: string; Value: string }[]) {
    if (!(a.Key in lb.attributes)) throw E.val(`Load balancer attribute key '${a.Key}' is not recognized`);
    lb.attributes[a.Key] = String(a.Value);
  }
  return { Attributes: Object.entries(lb.attributes).map(([Key, Value]) => ({ Key, Value })) };
});

op('elbv2', 'set-security-groups', 'load-balancer-arn:s! security-groups:l!', 'Cambia los grupos de seguridad de un ALB.', { res: (c) => c.p.LoadBalancerArn }, (c) => {
  const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
  if (lb.Type === 'gateway') throw E.val('Security groups are not supported for gateway load balancers');
  const r = regional(c.acct, c.region).ec2;
  for (const g of c.p.SecurityGroups as string[]) if (!r.securityGroups[g]) throw new AwsError('InvalidConfigurationRequest', `The security group '${g}' does not exist`, 400);
  lb.SecurityGroups = c.p.SecurityGroups;
  return { SecurityGroupIds: lb.SecurityGroups };
});

op('elbv2', 'set-subnets', 'load-balancer-arn:s! subnets:l! subnet-mappings:f', 'Cambia las subredes (zonas) de un balanceador.', { res: (c) => c.p.LoadBalancerArn }, (c) => {
  const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
  const r = regional(c.acct, c.region).ec2;
  const subnets = c.p.Subnets as string[];
  for (const s of subnets) if (!r.subnets[s]) throw new AwsError('SubnetNotFound', `The subnet ID '${s}' does not exist`, 400);
  if (lb.Type === 'application' && new Set(subnets.map((s) => r.subnets[s].AvailabilityZone)).size < 2) throw E.val('At least two subnets in two different Availability Zones must be specified');
  lb.subnetIds = subnets;
  return { AvailabilityZones: subnets.map((id) => ({ ZoneName: r.subnets[id].AvailabilityZone, SubnetId: id, LoadBalancerAddresses: [] })) };
});

// ───────────────────────── operaciones: grupos de destino ─────────────────────────

const HC_DEFAULT = (protocol: string) => (['TCP', 'TLS', 'UDP', 'TCP_UDP'].includes(protocol) ? { path: '', interval: 30, timeout: 10, healthy: 3, unhealthy: 3, hcProtocol: 'TCP', matcher: '' } : { path: '/', interval: 30, timeout: 5, healthy: 5, unhealthy: 2, hcProtocol: protocol, matcher: '200' });

export function elbCreateTg(a: Account, region: string, o: { name: string; protocol?: string; port?: number; vpcId: string; path?: string; interval?: number; healthy?: number; unhealthy?: number; targets?: string[] }): TargetGroup {
  const protocol = o.protocol ?? 'HTTP';
  const d = HC_DEFAULT(protocol);
  const arn = `arn:aws:elasticloadbalancing:${region}:${a.id}:targetgroup/${o.name}/${hex(a, 'tgid')}`;
  const tg: TargetGroup = {
    TargetGroupArn: arn,
    TargetGroupName: o.name,
    Protocol: protocol,
    Port: o.port ?? 80,
    VpcId: o.vpcId,
    TargetType: 'instance',
    HealthCheckProtocol: d.hcProtocol,
    HealthCheckPort: 'traffic-port',
    HealthCheckPath: o.path ?? d.path,
    HealthCheckIntervalSeconds: o.interval ?? d.interval,
    HealthCheckTimeoutSeconds: d.timeout,
    HealthyThresholdCount: o.healthy ?? d.healthy,
    UnhealthyThresholdCount: o.unhealthy ?? d.unhealthy,
    Matcher: { HttpCode: d.matcher },
    targets: (o.targets ?? []).map((Id) => ({ Id, Port: o.port ?? 80, registeredAt: a.clock - 600000 })),
    attributes: { 'deregistration_delay.timeout_seconds': '300', 'stickiness.enabled': 'false', 'stickiness.type': 'lb_cookie', 'load_balancing.algorithm.type': 'round_robin', 'slow_start.duration_seconds': '0' },
    Tags: [],
  };
  elb(a, region).tgs[arn] = tg;
  return tg;
}

op('elbv2', 'create-target-group', 'name:s! protocol:s port:i vpc-id:s health-check-protocol:s health-check-port:s health-check-enabled:b health-check-path:s health-check-interval-seconds:i health-check-timeout-seconds:i healthy-threshold-count:i unhealthy-threshold-count:i matcher:j target-type:s tags:t', 'Crea un grupo de destino: el conjunto de servidores a los que reparte un balanceador.', { res: tgRes }, (c) => {
  const name = String(c.p.Name);
  if (name.length > 32) throw E.val(`Target group name '${name}' cannot be longer than '32' characters`);
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(name)) throw E.val(`Target group name '${name}' can only contain characters that are alphanumeric characters or hyphens(-)`);
  const protocol = String(c.p.Protocol ?? 'HTTP');
  if (!['HTTP', 'HTTPS', 'TCP', 'TLS', 'UDP', 'TCP_UDP', 'GENEVE'].includes(protocol)) throw E.val(`1 validation error detected: Value '${protocol}' at 'protocol' failed to satisfy constraint: Member must satisfy enum value set: [TCP, TLS, UDP, TCP_UDP, HTTP, HTTPS, GENEVE]`);
  const type = (c.p.TargetType ?? 'instance') as TargetGroup['TargetType'];
  if (!['instance', 'ip', 'lambda'].includes(type)) throw E.val(`1 validation error detected: Value '${type}' at 'targetType' failed to satisfy constraint: Member must satisfy enum value set: [instance, ip, lambda, alb]`);
  if (type !== 'lambda') {
    if (!c.p.VpcId) throw new AwsError('ValidationError', "A VPC ID must be specified for target groups with target type 'instance'", 400);
    if (!c.p.Port) throw new AwsError('ValidationError', 'A port must be specified', 400);
    if (!regional(c.acct, c.region).ec2.vpcs[c.p.VpcId]) throw new AwsError('InvalidConfigurationRequest', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  }
  const prev = Object.values(elb(c.acct, c.region).tgs).find((t) => t.TargetGroupName === name);
  const want = { path: c.p.HealthCheckPath, port: c.p.Port, vpc: c.p.VpcId };
  if (prev) {
    if (prev.Port === want.port && prev.VpcId === want.vpc && prev.Protocol === protocol && (want.path === undefined || want.path === prev.HealthCheckPath)) return { TargetGroups: [tgView(c.acct, c.region, prev)] };
    throw new AwsError('DuplicateTargetGroupName', `A target group with the same name '${name}' exists, but with different settings`, 400);
  }
  const tg = elbCreateTg(c.acct, c.region, { name, protocol, port: c.p.Port, vpcId: c.p.VpcId ?? '', path: c.p.HealthCheckPath, interval: c.p.HealthCheckIntervalSeconds, healthy: c.p.HealthyThresholdCount, unhealthy: c.p.UnhealthyThresholdCount });
  tg.TargetType = type;
  if (c.p.HealthCheckProtocol) tg.HealthCheckProtocol = String(c.p.HealthCheckProtocol).toUpperCase();
  if (c.p.HealthCheckPort) tg.HealthCheckPort = String(c.p.HealthCheckPort);
  if (c.p.HealthCheckTimeoutSeconds) tg.HealthCheckTimeoutSeconds = c.p.HealthCheckTimeoutSeconds;
  if (c.p.Matcher?.HttpCode) tg.Matcher = { HttpCode: String(c.p.Matcher.HttpCode) };
  if (tg.HealthCheckTimeoutSeconds >= tg.HealthCheckIntervalSeconds && tg.Protocol.startsWith('HTTP')) {
    delete elb(c.acct, c.region).tgs[tg.TargetGroupArn];
    throw E.val(`Health check timeout '${tg.HealthCheckTimeoutSeconds}' must be smaller than the interval '${tg.HealthCheckIntervalSeconds}'`);
  }
  tg.Tags = c.p.Tags ?? [];
  return { TargetGroups: [tgView(c.acct, c.region, tg)] };
});

op('elbv2', 'describe-target-groups', 'load-balancer-arn:s target-group-arns:l names:l', 'Lista los grupos de destino.', { paginate: 'TargetGroups', res: tgRes }, (c) => {
  const s = elb(c.acct, c.region);
  let list = Object.values(s.tgs);
  if (c.p.TargetGroupArns) list = (c.p.TargetGroupArns as string[]).map((x) => s.tgs[x] ?? (() => { throw E.tg(x); })());
  if (c.p.Names) list = (c.p.Names as string[]).map((n) => list.find((t) => t.TargetGroupName === n) ?? (() => { throw E.tg(n); })());
  if (c.p.LoadBalancerArn) {
    const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
    const arns = new Set(allActions(lb).flatMap(actionTgs));
    list = list.filter((t) => arns.has(t.TargetGroupArn));
  }
  return { TargetGroups: list.map((t) => tgView(c.acct, c.region, t)) };
});

op('elbv2', 'modify-target-group', 'target-group-arn:s! health-check-protocol:s health-check-port:s health-check-path:s health-check-enabled:b health-check-interval-seconds:i health-check-timeout-seconds:i healthy-threshold-count:i unhealthy-threshold-count:i matcher:j', 'Cambia la comprobación de salud de un grupo de destino.', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  if (c.p.HealthCheckProtocol) tg.HealthCheckProtocol = String(c.p.HealthCheckProtocol).toUpperCase();
  if (c.p.HealthCheckPort) tg.HealthCheckPort = String(c.p.HealthCheckPort);
  if (c.p.HealthCheckPath) tg.HealthCheckPath = c.p.HealthCheckPath;
  if (c.p.HealthCheckIntervalSeconds) tg.HealthCheckIntervalSeconds = c.p.HealthCheckIntervalSeconds;
  if (c.p.HealthCheckTimeoutSeconds) tg.HealthCheckTimeoutSeconds = c.p.HealthCheckTimeoutSeconds;
  if (c.p.HealthyThresholdCount) tg.HealthyThresholdCount = c.p.HealthyThresholdCount;
  if (c.p.UnhealthyThresholdCount) tg.UnhealthyThresholdCount = c.p.UnhealthyThresholdCount;
  if (c.p.Matcher?.HttpCode) tg.Matcher = { HttpCode: String(c.p.Matcher.HttpCode) };
  if (tg.Protocol.startsWith('HTTP') && tg.HealthCheckTimeoutSeconds >= tg.HealthCheckIntervalSeconds) throw E.val(`Health check timeout '${tg.HealthCheckTimeoutSeconds}' must be smaller than the interval '${tg.HealthCheckIntervalSeconds}'`);
  return { TargetGroups: [tgView(c.acct, c.region, tg)] };
});

op('elbv2', 'describe-target-group-attributes', 'target-group-arn:s!', 'Atributos de un grupo de destino (drenaje, afinidad, algoritmo…).', { res: (c) => c.p.TargetGroupArn }, (c) => ({ Attributes: Object.entries(findTg(c.acct, c.region, c.p.TargetGroupArn).attributes).map(([Key, Value]) => ({ Key, Value })) }));

op('elbv2', 'modify-target-group-attributes', 'target-group-arn:s! attributes:f!', 'Cambia atributos de un grupo de destino.', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  for (const a of c.p.Attributes as { Key: string; Value: string }[]) {
    if (!(a.Key in tg.attributes)) throw E.val(`Target group attribute key '${a.Key}' is not recognized`);
    if (a.Key === 'load_balancing.algorithm.type' && !['round_robin', 'least_outstanding_requests'].includes(a.Value)) throw E.val(`Invalid value for attribute ${a.Key}: ${a.Value}`);
    tg.attributes[a.Key] = String(a.Value);
  }
  return { Attributes: Object.entries(tg.attributes).map(([Key, Value]) => ({ Key, Value })) };
});

op('elbv2', 'delete-target-group', 'target-group-arn:s!', 'Borra un grupo de destino (no puede estar en uso).', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  if (lbsUsing(c.acct, c.region, tg.TargetGroupArn).length) throw new AwsError('ResourceInUse', `Target group '${tg.TargetGroupArn}' is currently in use by a listener or a rule`, 400);
  delete elb(c.acct, c.region).tgs[tg.TargetGroupArn];
  return {};
});

const targetsOf = (c: OpCtx): { Id: string; Port?: number }[] => c.p.Targets as { Id: string; Port?: number }[];

op('elbv2', 'register-targets', 'target-group-arn:s! targets:f!', 'Añade servidores (instancias) a un grupo de destino.', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  const r = refreshEc2(c.acct, c.region);
  for (const t of targetsOf(c)) {
    if (tg.TargetType === 'instance') {
      const i = r.instances[t.Id];
      if (!i || i.state === 'terminated') throw new AwsError('InvalidTarget', `The following targets are not valid: '${t.Id}'`, 400);
      if (i.VpcId !== tg.VpcId) throw new AwsError('InvalidTarget', `The following targets are not in the target group's VPC: '${t.Id}'`, 400);
    }
    const port = t.Port ?? tg.Port;
    const cur = tg.targets.find((x) => x.Id === t.Id && x.Port === port);
    if (cur) cur.deregisteredAt = undefined;
    else tg.targets.push({ Id: t.Id, Port: port, registeredAt: c.acct.clock });
  }
  return {};
});

export function deregister(a: Account, tg: TargetGroup, id: string, port?: number): void {
  const t = tg.targets.find((x) => x.Id === id && (port === undefined || x.Port === port));
  if (!t) return;
  const delay = Number(tg.attributes['deregistration_delay.timeout_seconds'] ?? 300) * 1000;
  if (delay === 0) tg.targets = tg.targets.filter((x) => x !== t);
  else t.deregisteredAt = a.clock;
}

op('elbv2', 'deregister-targets', 'target-group-arn:s! targets:f!', 'Quita servidores de un grupo de destino (con drenaje de conexiones).', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  for (const t of targetsOf(c)) deregister(c.acct, tg, t.Id, t.Port);
  return {};
});

export const healthDescription = (a: Account, region: string, tg: TargetGroup) =>
  tg.targets.map((t) => {
    const h = targetHealth(a, region, tg, t);
    return {
      Target: { Id: t.Id, Port: t.Port },
      HealthCheckPort: tg.HealthCheckPort === 'traffic-port' ? String(t.Port) : tg.HealthCheckPort,
      TargetHealth: { State: h.state, ...(h.reason ? { Reason: h.reason, Description: h.description } : {}) },
    };
  });

op('elbv2', 'describe-target-health', 'target-group-arn:s! targets:f', 'Estado de salud de cada servidor del grupo.', { res: (c) => c.p.TargetGroupArn }, (c) => {
  const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
  const all = healthDescription(c.acct, c.region, tg);
  const want = c.p.Targets as { Id: string }[] | undefined;
  return { TargetHealthDescriptions: want ? all.filter((d) => want.some((w) => w.Id === d.Target.Id)) : all };
});

// ───────────────────────── operaciones: oyentes y reglas ─────────────────────────

const LISTENER_PROTOCOLS: Record<string, string[]> = { application: ['HTTP', 'HTTPS'], network: ['TCP', 'TLS', 'UDP', 'TCP_UDP'], gateway: ['GENEVE'] };
const lsnRes = (c: OpCtx) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:listener/*`;

export function elbCreateListener(a: Account, region: string, lb: LoadBalancer, o: { port: number; protocol: string; actions: LbAction[]; certs?: { CertificateArn: string }[] }): LbListener {
  const lid = hex(a, 'lsnid');
  const arn = `arn:aws:elasticloadbalancing:${region}:${a.id}:listener/${lbSuffix(lb)}/${lid}`;
  const l: LbListener = {
    ListenerArn: arn,
    LoadBalancerArn: lb.LoadBalancerArn,
    Port: o.port,
    Protocol: o.protocol,
    ...(o.certs ? { Certificates: o.certs, SslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06' } : {}),
    rules: [{ RuleArn: `arn:aws:elasticloadbalancing:${region}:${a.id}:listener-rule/${lbSuffix(lb)}/${lid}/${hex(a, 'ruleid')}`, Priority: 'default', Conditions: [], Actions: o.actions, IsDefault: true }],
  };
  lb.listeners[arn] = l;
  return l;
}

export function findListener(a: Account, region: string, arn: string): { lb: LoadBalancer; l: LbListener } {
  for (const lb of Object.values(elb(a, region).lbs)) if (lb.listeners[arn]) return { lb, l: lb.listeners[arn] };
  throw E.listener(arn);
}

op('elbv2', 'create-listener', 'load-balancer-arn:s! protocol:s port:i ssl-policy:s certificates:f default-actions:f! tags:t', 'Crea un oyente: el puerto y protocolo en el que el balanceador escucha, y qué hace con lo que llega.', { res: lsnRes }, (c) => {
  const lb = findLb(c.acct, c.region, c.p.LoadBalancerArn);
  const protocol = String(c.p.Protocol ?? '').toUpperCase();
  if (!protocol) throw E.val('Protocol must be specified');
  if (!LISTENER_PROTOCOLS[lb.Type].includes(protocol)) throw E.val(`Protocol '${protocol}' is not supported by this load balancer type`);
  const port = c.p.Port;
  if (!port || port < 1 || port > 65535) throw E.val(`Port '${port}' is not valid`);
  if (Object.values(lb.listeners).some((l) => l.Port === port)) throw new AwsError('DuplicateListener', 'A listener already exists on this port for this load balancer \'' + lb.LoadBalancerArn + '\'', 400);
  if ((protocol === 'HTTPS' || protocol === 'TLS') && !c.p.Certificates?.length) throw new AwsError('CertificateNotFound', 'A certificate must be specified for HTTPS listeners', 400);
  const actions = normActions(c, lb, c.p.DefaultActions);
  const l = elbCreateListener(c.acct, c.region, lb, { port, protocol, actions, certs: c.p.Certificates });
  return { Listeners: [listenerView(l)] };
});

op('elbv2', 'describe-listeners', 'load-balancer-arn:s listener-arns:l', 'Lista los oyentes de un balanceador.', { paginate: 'Listeners', res: lsnRes }, (c) => {
  if (c.p.ListenerArns) return { Listeners: (c.p.ListenerArns as string[]).map((x) => listenerView(findListener(c.acct, c.region, x).l)) };
  if (!c.p.LoadBalancerArn) throw E.val('You must specify either listener ARNs or a load balancer ARN');
  return { Listeners: Object.values(findLb(c.acct, c.region, c.p.LoadBalancerArn).listeners).map(listenerView) };
});

op('elbv2', 'modify-listener', 'listener-arn:s! port:i protocol:s ssl-policy:s certificates:f default-actions:f', 'Cambia el puerto, el protocolo o la acción por defecto de un oyente.', { res: (c) => c.p.ListenerArn }, (c) => {
  const { lb, l } = findListener(c.acct, c.region, c.p.ListenerArn);
  if (c.p.Port) l.Port = c.p.Port;
  if (c.p.Protocol) l.Protocol = String(c.p.Protocol).toUpperCase();
  if (c.p.Certificates) l.Certificates = c.p.Certificates;
  if (c.p.DefaultActions) l.rules.find((r) => r.IsDefault)!.Actions = normActions(c, lb, c.p.DefaultActions);
  return { Listeners: [listenerView(l)] };
});

op('elbv2', 'delete-listener', 'listener-arn:s!', 'Borra un oyente y sus reglas.', { res: (c) => c.p.ListenerArn }, (c) => {
  const { lb, l } = findListener(c.acct, c.region, c.p.ListenerArn);
  delete lb.listeners[l.ListenerArn];
  return {};
});

op('elbv2', 'create-rule', 'listener-arn:s! conditions:f! priority:i! actions:f! tags:t', 'Añade una regla a un oyente (p. ej. /api/* → otro grupo de destino).', { res: (c) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:listener-rule/*` }, (c) => {
  const { lb, l } = findListener(c.acct, c.region, c.p.ListenerArn);
  const prio = c.p.Priority;
  if (prio < 1 || prio > 50000) throw E.val(`Priority '${prio}' must be between 1 and 50000`);
  if (l.rules.some((r) => r.Priority === String(prio))) throw new AwsError('PriorityInUse', `The provided priority '${prio}' is already in use`, 400);
  const parts = l.ListenerArn.split('listener/')[1];
  const rule: LbRule = { RuleArn: `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:listener-rule/${parts}/${hex(c.acct, 'ruleid')}`, Priority: String(prio), Conditions: normConditions(c.p.Conditions), Actions: normActions(c, lb, c.p.Actions), IsDefault: false };
  l.rules.push(rule);
  return { Rules: [ruleView(rule)] };
});

op('elbv2', 'describe-rules', 'listener-arn:s rule-arns:l', 'Lista las reglas de un oyente.', { paginate: 'Rules', res: (c) => `arn:aws:elasticloadbalancing:${c.region}:${c.acct.id}:listener-rule/*` }, (c) => {
  if (c.p.RuleArns) {
    const out: LbRule[] = [];
    for (const lb of Object.values(elb(c.acct, c.region).lbs)) for (const l of Object.values(lb.listeners)) out.push(...l.rules.filter((r) => (c.p.RuleArns as string[]).includes(r.RuleArn)));
    return { Rules: out.map(ruleView) };
  }
  if (!c.p.ListenerArn) throw E.val('You must specify either listener ARN or rule ARNs');
  return { Rules: ruleOrder(findListener(c.acct, c.region, c.p.ListenerArn).l).map(ruleView) };
});

op('elbv2', 'delete-rule', 'rule-arn:s!', 'Borra una regla.', { res: (c) => c.p.RuleArn }, (c) => {
  for (const lb of Object.values(elb(c.acct, c.region).lbs)) for (const l of Object.values(lb.listeners)) {
    const r = l.rules.find((x) => x.RuleArn === c.p.RuleArn);
    if (r) {
      if (r.IsDefault) throw new AwsError('OperationNotPermitted', 'Default rule is not modifiable', 400);
      l.rules = l.rules.filter((x) => x !== r);
      return {};
    }
  }
  throw E.rule(c.p.RuleArn);
});

op('elbv2', 'modify-rule', 'rule-arn:s! conditions:f actions:f', 'Cambia las condiciones o acciones de una regla.', { res: (c) => c.p.RuleArn }, (c) => {
  for (const lb of Object.values(elb(c.acct, c.region).lbs)) for (const l of Object.values(lb.listeners)) {
    const r = l.rules.find((x) => x.RuleArn === c.p.RuleArn);
    if (r) {
      if (r.IsDefault) throw new AwsError('OperationNotPermitted', 'Default rule is not modifiable', 400);
      if (c.p.Conditions) r.Conditions = normConditions(c.p.Conditions);
      if (c.p.Actions) r.Actions = normActions(c, lb, c.p.Actions);
      return { Rules: [ruleView(r)] };
    }
  }
  throw E.rule(c.p.RuleArn);
});

op('elbv2', 'add-tags', 'resource-arns:l! tags:t!', 'Pone etiquetas a balanceadores o grupos de destino.', { res: (c) => c.p.ResourceArns }, (c) => {
  for (const arn of c.p.ResourceArns as string[]) {
    const s = elb(c.acct, c.region);
    const t = s.lbs[arn] ?? s.tgs[arn];
    if (!t) throw E.lb(arn);
    t.Tags = mergeTags(t.Tags, c.p.Tags);
  }
  return {};
});

op('elbv2', 'describe-tags', 'resource-arns:l!', 'Etiquetas de balanceadores o grupos de destino.', { res: (c) => c.p.ResourceArns }, (c) => ({
  TagDescriptions: (c.p.ResourceArns as string[]).map((arn) => {
    const s = elb(c.acct, c.region);
    const t = s.lbs[arn] ?? s.tgs[arn];
    if (!t) throw E.lb(arn);
    return { ResourceArn: arn, Tags: t.Tags };
  }),
}));

// ───────────────────────── esperas ─────────────────────────

op('elbv2', 'wait', 'waiter:s! load-balancer-arns:l names:l target-group-arn:s targets:f', 'Espera a que se cumpla una condición (load-balancer-available, target-in-service, target-deregistered…).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const waiter = String(c.p.Waiter);
  const check = (): boolean => {
    const s = elb(c.acct, c.region);
    if (waiter === 'load-balancer-available' || waiter === 'load-balancer-exists') {
      const list = c.p.LoadBalancerArns ? (c.p.LoadBalancerArns as string[]).map((x) => s.lbs[x]) : (c.p.Names as string[] ?? []).map((n) => Object.values(s.lbs).find((l) => l.LoadBalancerName === n));
      if (!list.length || list.some((l) => !l)) return false;
      return waiter === 'load-balancer-exists' || list.every((l) => lbState(c.acct, l!) === 'active');
    }
    if (waiter === 'load-balancers-deleted') return !(c.p.LoadBalancerArns as string[] ?? []).some((x) => s.lbs[x]);
    if (waiter === 'target-in-service' || waiter === 'target-deregistered') {
      if (!c.p.TargetGroupArn) throw new AwsError('MissingParameter', 'The request must contain the parameter TargetGroupArn');
      const tg = findTg(c.acct, c.region, c.p.TargetGroupArn);
      const want = (c.p.Targets as { Id: string }[] | undefined)?.map((t) => t.Id) ?? tg.targets.map((t) => t.Id);
      if (waiter === 'target-in-service') return want.length > 0 && want.every((id) => tg.targets.some((t) => t.Id === id && targetHealth(c.acct, c.region, tg, t).state === 'healthy'));
      return want.every((id) => !tg.targets.some((t) => t.Id === id));
    }
    throw new AwsError('InvalidWaiter', `Invalid choice: '${waiter}', valid choices are: load-balancer-available, load-balancer-exists, load-balancers-deleted, target-in-service, target-deregistered`);
  };
  for (let k = 0; k < 40; k++) {
    tick(c.acct);
    if (check()) return undefined;
    c.acct.clock += 15000;
  }
  throw new AwsError('WaiterError', `Waiter ${waiter} failed: Max attempts exceeded`);
});

// ───────────────────────── paso del tiempo ─────────────────────────

tickers.push((a) => {
  for (const reg of Object.keys(a.regions)) {
    const s = a.regions[reg].elb;
    if (!s) continue;
    for (const tg of Object.values(s.tgs)) {
      const delay = Number(tg.attributes['deregistration_delay.timeout_seconds'] ?? 300) * 1000;
      tg.targets = tg.targets.filter((t) => t.deregisteredAt === undefined || a.clock - t.deregisteredAt < delay);
    }
  }
});
