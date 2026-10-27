/**
 * AWS App Runner: de una imagen de ECR a una URL HTTPS sin tocar servidores, balanceadores ni clústeres. El servicio tarda unos
 * minutos en crearse, comprueba que el contenedor escucha en el puerto configurado y despliega versiones nuevas sin cortes.
 */
import { regional } from '../account';
import { baseAsImage, findBase } from '../containers/catalog';
import { containerHttp, runContainer, type RunOpts, type ServerInfo } from '../containers/runtime';
import { AwsError, op, type OpCtx } from '../registry';
import { roleCaller } from '../sdk';
import { tickers } from '../tick';
import type { Account } from '../types';
import type { ArAutoScaling, ArOperation, ArService, ArState, ImageData } from '../types-containers';
import { iso, mkArn, stableId } from '../util';
import { roleDenied } from './ecs';
import { ecrFind, ecrPullAs } from './ecr';
import { roleTrusts } from './flowlogs';
import { logsCreateGroup, logsPut } from './logs';
import { findSecret } from './secrets';
import type { Fetched } from '../../engine/commands/internet';

const MIN = 60000;
const arOf = (a: Account, region: string): ArState => (regional(a, region).apprunner ??= { services: {}, scaling: {}, counter: 0 });
const E = {
  invalid: (m: string) => new AwsError('InvalidRequestException', m, 400),
  nf: (m: string) => new AwsError('ResourceNotFoundException', m, 400),
};

const uuid = (key: string) => stableId(key, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const arn = (a: Account, region: string, resource: string) => mkArn('apprunner', region, a.id, resource);

// ───────────────────────── configuración de la instancia ─────────────────────────

const CPU: Record<string, string> = { '256': '256', '0.25 vCPU': '256', '512': '512', '0.5 vCPU': '512', '1024': '1024', '1 vCPU': '1024', '2048': '2048', '2 vCPU': '2048', '4096': '4096', '4 vCPU': '4096' };
const MEM: Record<string, string> = { '512': '512', '0.5 GB': '512', '1024': '1024', '1 GB': '1024', '2048': '2048', '2 GB': '2048', '3072': '3072', '3 GB': '3072', '4096': '4096', '4 GB': '4096', '6144': '6144', '6 GB': '6144', '8192': '8192', '8 GB': '8192', '10240': '10240', '10 GB': '10240', '12288': '12288', '12 GB': '12288' };
const COMBOS: Record<string, string[]> = { '256': ['512', '1024'], '512': ['1024'], '1024': ['2048', '3072', '4096'], '2048': ['4096', '6144'], '4096': ['8192', '10240', '12288'] };

function instanceCfg(p: Record<string, any> | undefined, old?: { cpu: string; memory: string; role?: string }) {
  const cpu = p?.Cpu !== undefined ? CPU[String(p.Cpu)] : old?.cpu ?? '1024';
  const mem = p?.Memory !== undefined ? MEM[String(p.Memory)] : old?.memory ?? '2048';
  if (!cpu) throw E.invalid(`Invalid Cpu value '${p?.Cpu}'. Valid values are 256, 512, 1024, 2048, 4096 (or 0.25 vCPU, 0.5 vCPU, 1 vCPU, 2 vCPU, 4 vCPU).`);
  if (!mem) throw E.invalid(`Invalid Memory value '${p?.Memory}'. Valid values are 512, 1024, 2048, 3072, 4096, 6144, 8192, 10240, 12288 (MB).`);
  if (!COMBOS[cpu].includes(mem)) throw E.invalid(`Invalid combination of Cpu (${cpu}) and Memory (${mem}). With ${cpu} CPU units the memory must be one of: ${COMBOS[cpu].join(', ')}.`);
  return { cpu, memory: mem, role: p?.InstanceRoleArn ?? old?.role };
}

function healthCfg(p: Record<string, any> | undefined, old?: ArService['health']): ArService['health'] {
  const protocol = String(p?.Protocol ?? old?.Protocol ?? 'TCP').toUpperCase();
  if (!['TCP', 'HTTP'].includes(protocol)) throw E.invalid(`Invalid health check protocol '${p?.Protocol}'. Valid values are TCP and HTTP.`);
  return {
    Protocol: protocol as 'TCP' | 'HTTP',
    Path: String(p?.Path ?? old?.Path ?? '/'),
    Interval: Number(p?.Interval ?? old?.Interval ?? 5),
    Timeout: Number(p?.Timeout ?? old?.Timeout ?? 2),
    HealthyThreshold: Number(p?.HealthyThreshold ?? old?.HealthyThreshold ?? 1),
    UnhealthyThreshold: Number(p?.UnhealthyThreshold ?? old?.UnhealthyThreshold ?? 5),
  };
}

// ───────────────────────── escalado ─────────────────────────

const DEFAULT_SCALING = 'DefaultConfiguration';

function scalingOf(a: Account, region: string): Record<string, ArAutoScaling> {
  const st = arOf(a, region);
  st.scaling.default ??= { name: DEFAULT_SCALING, arn: arn(a, region, `autoscalingconfiguration/${DEFAULT_SCALING}/1/${uuid(`${a.id}:default`).replace(/-/g, '')}`), revision: 1, latest: true, maxConcurrency: 100, minSize: 1, maxSize: 25, created: 0, active: true };
  return st.scaling;
}

const scalingView = (s: ArAutoScaling) => ({ AutoScalingConfigurationArn: s.arn, AutoScalingConfigurationName: s.name, AutoScalingConfigurationRevision: s.revision, Latest: s.latest, Status: s.active ? 'active' : 'inactive', MaxConcurrency: s.maxConcurrency, MinSize: s.minSize, MaxSize: s.maxSize, CreatedAt: iso(s.created) });

// ───────────────────────── vista y búsqueda ─────────────────────────

const svcRes = (c: OpCtx) => arn(c.acct, c.region, 'service/*');

function view(a: Account, region: string, s: ArService) {
  const sc = Object.values(scalingOf(a, region)).find((x) => x.arn === s.scalingArn);
  return {
    ServiceName: s.name,
    ServiceId: s.id,
    ServiceArn: s.arn,
    ServiceUrl: s.url,
    CreatedAt: iso(s.created),
    UpdatedAt: iso(s.updated),
    ...(s.deleted ? { DeletedAt: iso(s.deleted) } : {}),
    Status: s.status,
    SourceConfiguration: {
      ImageRepository: { ImageIdentifier: s.image, ImageConfiguration: { ...(Object.keys(s.env).length ? { RuntimeEnvironmentVariables: s.env } : {}), ...(s.startCommand ? { StartCommand: s.startCommand } : {}), Port: s.port }, ImageRepositoryType: s.imageType },
      ...(s.accessRoleArn ? { AuthenticationConfiguration: { AccessRoleArn: s.accessRoleArn } } : {}),
      AutoDeploymentsEnabled: s.autoDeploy,
    },
    InstanceConfiguration: { Cpu: s.cpu, Memory: s.memory, ...(s.instanceRoleArn ? { InstanceRoleArn: s.instanceRoleArn } : {}) },
    EncryptionConfiguration: { KmsKey: `arn:aws:kms:${region}:${a.id}:key/AWS_OWNED_KMS_KEY` },
    HealthCheckConfiguration: s.health,
    AutoScalingConfigurationSummary: sc ? { AutoScalingConfigurationArn: sc.arn, AutoScalingConfigurationName: sc.name, AutoScalingConfigurationRevision: sc.revision, Status: 'ACTIVE', CreatedAt: iso(sc.created), HasAssociatedService: true, IsDefault: sc.name === DEFAULT_SCALING } : undefined,
    NetworkConfiguration: { EgressConfiguration: { EgressType: 'DEFAULT' }, IngressConfiguration: { IsPubliclyAccessible: true }, IpAddressType: 'IPV4' },
    ObservabilityConfiguration: { ObservabilityEnabled: false },
  };
}

function findSvc(a: Account, region: string, ref: string): ArService {
  const s = Object.values(arOf(a, region).services).find((x) => x.arn === ref && x.status !== 'DELETED');
  if (!s) throw E.nf(`Service ${ref} not found.`);
  return s;
}

const opView = (o: ArOperation) => ({ Id: o.Id, Type: o.Type, Status: o.Status, TargetArn: o.TargetArn, StartedAt: iso(o.StartedAt), ...(o.EndedAt ? { EndedAt: iso(o.EndedAt) } : {}), UpdatedAt: iso(o.EndedAt ?? o.StartedAt) });

// ───────────────────────── despliegue de una imagen ─────────────────────────

const logGroup = (s: ArService, kind: 'service' | 'application') => `/aws/apprunner/${s.name}/${s.id}/${kind}`;
const slog = (s: ArService, ts: number, msg: string, stream: 'service' | 'application' = 'service') => s.pendingLogs.push({ ts, msg: stream === 'service' ? `[AppRunner] ${msg}` : msg, stream });

const digestOf = (img: ImageData) => 'sha256:' + stableId(`dig:${img.id}`, '', 64, 'hex');

/** Qué le pasa a una imagen al desplegarla: la descarga, arranca el contenedor y comprueba la salud. */
function deployPlan(a: Account, region: string, s: ArService, start: number, verb: string): { settleAt: number; ok: boolean; reason?: string; live?: ArService['live'] } {
  const log = (t: number, m: string) => slog(s, t, m);
  log(start, `${verb} started.`);
  // 1. descargar la imagen
  let img: ImageData | undefined;
  if (s.imageType === 'ECR') {
    const role = s.accessRoleArn;
    const r = ecrPullAs(a, region, role, s.image);
    if (r.fail || !r.image) {
      const why = r.fail?.reason === 'denied' ? `Access denied: ${r.fail.message}` : r.fail?.message ?? 'image not found';
      log(start + 20000, `Failed to pull your application image. Be sure you configured your service role correctly. For more information, read the documentation. (${why})`);
      return { settleAt: start + 25000, ok: false, reason: 'Failed to pull your application image.' };
    }
    img = r.image;
    log(start + 15000, 'Successfully pulled your application image from ECR.');
  } else {
    const base = findBase(s.image.replace(/^public\.ecr\.aws\/[^/]+\//, ''));
    if (!base) {
      log(start + 20000, `Failed to pull your application image. The image ${s.image} was not found.`);
      return { settleAt: start + 25000, ok: false, reason: 'Failed to pull your application image.' };
    }
    img = baseAsImage(base, start);
    log(start + 15000, 'Successfully pulled your application image from ECR Public.');
  }
  // 2. secretos y variables
  const env: Record<string, string> = { ...s.env };
  for (const [k, v] of Object.entries(s.secretsMap ?? {})) {
    const sec = findSecret(a, region, v);
    if (!sec) {
      log(start + 30000, `Failed to retrieve secret ${v}: the secret was not found.`);
      return { settleAt: start + 35000, ok: false, reason: 'Failed to retrieve secrets.' };
    }
    const d = s.instanceRoleArn ? roleDenied(a, region, s.instanceRoleArn, 'secretsmanager:GetSecretValue', sec.ARN) : 'no instance role';
    if (d) {
      log(start + 30000, `Failed to retrieve secret ${v}: ${d}`);
      return { settleAt: start + 35000, ok: false, reason: 'Failed to retrieve secrets.' };
    }
    env[k] = sec.versions.find((x) => x.stages.includes('AWSCURRENT'))?.value ?? '';
  }
  // 3. arrancar el contenedor
  log(start + 40000, 'Provisioning instances and deploying image for privately accessible service.');
  const runAt = start + 60000;
  const args = s.startCommand ? s.startCommand.split(/\s+/).filter(Boolean) : null;
  const ro: RunOpts = { acct: a, region, env: { PORT: s.port, ...env }, args, hostArch: 'amd64', caller: s.instanceRoleArn ? roleCaller(a, s.instanceRoleArn, 'apprunner') : null, now: runAt };
  const res = runContainer(img, ro);
  res.lines.forEach((l, k) => slog(s, runAt + 200 + k * 5, l, 'application'));
  const port = Number(s.port);
  log(runAt + 10000, `Performing health check on port '${port}'.`);
  const fail = (why: string) => {
    log(runAt + 25000, `Health check failed on port '${port}'. Check your configured port number. For more information, read the application logs.`);
    log(runAt + 26000, `${verb} failed. Failure reason: ${why}`);
    return { settleAt: runAt + 30000, ok: false, reason: why };
  };
  if (!res.server) return fail(res.code !== 0 ? 'Application exited with a non-zero exit code.' : 'Health check failed.');
  const server: ServerInfo = res.server;
  if (server.port !== port || !server.bindAll) return fail('Health check failed.');
  if (s.health.Protocol === 'HTTP') {
    const probe = containerHttp(img, ro, server, port, { method: 'GET', path: s.health.Path }, false);
    if (probe.refused || (probe.status ?? 500) >= 400) {
      log(runAt + 25000, `Health check failed on protocol \`HTTP\`[Path: '${s.health.Path}'], [Port: '${port}']. Check your configured port number. For more information, read the application logs.`);
      log(runAt + 26000, `${verb} failed. Failure reason: Health check failed.`);
      return { settleAt: runAt + 30000, ok: false, reason: 'Health check failed.' };
    }
  }
  log(runAt + 20000, `Health check succeeded on port '${port}'.`);
  log(runAt + 25000, `${verb === 'Service creation' ? 'Service created' : 'Deployment completed'} successfully.`);
  log(runAt + 26000, 'Service status is set to RUNNING.');
  return { settleAt: runAt + 30000, ok: true, live: { img, digest: digestOf(img), since: runAt + 30000, env: ro.env, args, role: s.instanceRoleArn, server } };
}

function beginOp(a: Account, region: string, s: ArService, type: ArOperation['Type'], now: number): ArOperation {
  const st = arOf(a, region);
  st.counter++;
  const o: ArOperation = { Id: uuid(`op:${s.arn}:${st.counter}`), Type: type, Status: 'IN_PROGRESS', TargetArn: s.arn, StartedAt: now };
  s.operations.unshift(o);
  s.updated = now;
  return o;
}

function startDeploy(a: Account, region: string, s: ArService, now: number, type: ArOperation['Type']): ArOperation {
  const o = beginOp(a, region, s, type, now);
  const plan = deployPlan(a, region, s, now, type === 'CREATE_SERVICE' ? 'Service creation' : 'Deployment');
  s.status = 'OPERATION_IN_PROGRESS';
  s.pending = { op: o.Id, settleAt: plan.settleAt, ok: plan.ok, reason: plan.reason, next: plan.live, nextStatus: plan.ok ? 'RUNNING' : type === 'CREATE_SERVICE' ? 'CREATE_FAILED' : 'RUNNING' };
  return o;
}

/** Lleva el servicio al instante `now`: termina la operación en curso, vuelca los registros y relanza si hay despliegue automático. */
function settle(a: Account, region: string, s: ArService, now: number): void {
  if (s.pending && now >= s.pending.settleAt) {
    const p = s.pending;
    const o = s.operations.find((x) => x.Id === p.op);
    if (o) {
      o.Status = p.ok ? 'SUCCEEDED' : 'FAILED';
      o.EndedAt = p.settleAt;
    }
    if (p.next) s.live = p.next;
    s.status = p.nextStatus;
    s.updated = p.settleAt;
    if (s.status === 'DELETED') s.deleted = p.settleAt;
    s.pending = undefined;
  }
  if (s.pendingLogs.length) {
    const due = s.pendingLogs.filter((l) => l.ts <= now);
    if (due.length) {
      s.pendingLogs = s.pendingLogs.filter((l) => l.ts > now);
      for (const l of due) {
        const g = logGroup(s, l.stream);
        logsCreateGroup(a, region, g);
        logsPut(a, region, g, l.stream === 'service' ? 'events' : `instance/${s.id.slice(0, 8)}`, l.msg, l.ts);
      }
    }
  }
  if (s.status === 'RUNNING' && s.autoDeploy && s.live && s.imageType === 'ECR') {
    const m = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([^:@]+)(?::(.+))?$/.exec(s.image);
    const repo = m ? regional(a, m[2]).ecr?.repos[m[3]] : undefined;
    const cur = repo ? ecrFind(repo, m![4] ?? 'latest') : undefined;
    if (cur && digestOf(cur.image) !== s.live.digest) startDeploy(a, region, s, now, 'START_DEPLOYMENT');
  }
}

tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) {
    const st = r.apprunner;
    if (!st) continue;
    for (const s of Object.values(st.services)) {
      settle(a, region, s, a.clock);
      if (s.status === 'DELETED' && s.deleted !== undefined && a.clock - s.deleted > 5 * MIN) delete st.services[s.arn];
    }
  }
});

// ───────────────────────── operaciones ─────────────────────────

const NAME = /^[A-Za-z0-9][A-Za-z0-9-_]{3,39}$/;
const ECR_URI = /^\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/[^:@]+(:[^@]+)?$/;

function parseSource(src: Record<string, any>, old?: ArService) {
  const repo = src.ImageRepository as Record<string, any> | undefined;
  if (!repo && !old) throw E.invalid('SourceConfiguration must include ImageRepository (the code-repository source is not available in this simulator).');
  const out = {
    image: String(repo?.ImageIdentifier ?? old?.image ?? ''),
    imageType: (repo?.ImageRepositoryType ?? old?.imageType ?? 'ECR') as ArService['imageType'],
    accessRoleArn: (src.AuthenticationConfiguration?.AccessRoleArn ?? old?.accessRoleArn) as string | undefined,
    autoDeploy: src.AutoDeploymentsEnabled !== undefined ? src.AutoDeploymentsEnabled === true || src.AutoDeploymentsEnabled === 'true' : old?.autoDeploy ?? false,
    port: String(repo?.ImageConfiguration?.Port ?? old?.port ?? '8080'),
    startCommand: (repo?.ImageConfiguration?.StartCommand ?? old?.startCommand) as string | undefined,
    env: (repo?.ImageConfiguration?.RuntimeEnvironmentVariables ?? old?.env ?? {}) as Record<string, string>,
    secrets: (repo?.ImageConfiguration?.RuntimeEnvironmentSecrets ?? old?.secretsMap ?? {}) as Record<string, string>,
  };
  if (!['ECR', 'ECR_PUBLIC'].includes(out.imageType)) throw E.invalid(`Invalid ImageRepositoryType '${out.imageType}'. Valid values are ECR and ECR_PUBLIC.`);
  if (!out.image) throw E.invalid('ImageIdentifier is required.');
  if (out.imageType === 'ECR' && !ECR_URI.test(out.image)) throw E.invalid(`ImageIdentifier '${out.image}' is not a valid private ECR image URI (<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>).`);
  if (!/^\d+$/.test(out.port) || Number(out.port) < 1 || Number(out.port) > 65535) throw E.invalid(`Invalid Port '${out.port}'.`);
  return out;
}

function checkRoles(a: Account, accessRole: string | undefined, instanceRole: string | undefined, type: string) {
  if (type === 'ECR' && !accessRole) throw E.invalid('Authentication configuration with an access role is required for a private ECR image repository.');
  if (accessRole && !roleTrusts(a, accessRole, 'build.apprunner.amazonaws.com')) throw E.invalid(`Error in assuming access role ${accessRole}`);
  if (instanceRole && !roleTrusts(a, instanceRole, 'tasks.apprunner.amazonaws.com')) throw E.invalid(`Error in assuming instance role ${instanceRole}`);
}

op('apprunner', 'create-service', 'service-name:s! source-configuration:j! instance-configuration:j health-check-configuration:j auto-scaling-configuration-arn:s network-configuration:j observability-configuration:j encryption-configuration:j tags:f', 'Crea un servicio de App Runner a partir de una imagen de ECR: te da una URL HTTPS, balanceo y escalado sin gestionar servidores.', { res: svcRes }, (c) => {
  const name = String(c.p.ServiceName);
  if (!NAME.test(name)) throw new AwsError('ValidationException', `1 validation error detected: Value '${name}' at 'serviceName' failed to satisfy constraint: Member must satisfy regular expression pattern: [A-Za-z0-9][A-Za-z0-9-_]{3,39}`, 400);
  const st = arOf(c.acct, c.region);
  if (Object.values(st.services).some((x) => x.name === name && x.status !== 'DELETED')) throw E.invalid('Service with the provided name already exists.');
  const src = parseSource(c.p.SourceConfiguration);
  const inst = instanceCfg(c.p.InstanceConfiguration);
  checkRoles(c.acct, src.accessRoleArn, inst.role, src.imageType);
  const health = healthCfg(c.p.HealthCheckConfiguration);
  const scaling = scalingOf(c.acct, c.region);
  const scalingArn = String(c.p.AutoScalingConfigurationArn ?? scaling.default.arn);
  if (!Object.values(scaling).some((x) => x.arn === scalingArn)) throw E.nf(`AutoScalingConfiguration ${scalingArn} not found.`);
  st.counter++;
  const id = stableId(`ar:${c.acct.id}:${name}:${st.counter}`, '', 32, 'hex');
  const urlId = stableId(`ar-url:${c.acct.id}:${name}:${st.counter}`, '', 10, 'hex').replace(/[a-f]/g, (ch) => String.fromCharCode(103 + (ch.charCodeAt(0) - 97)));
  const now = c.acct.clock;
  const s: ArService = {
    name,
    id,
    arn: arn(c.acct, c.region, `service/${name}/${id}`),
    url: `${urlId}.${c.region}.awsapprunner.com`,
    status: 'OPERATION_IN_PROGRESS',
    created: now,
    updated: now,
    image: src.image,
    imageType: src.imageType,
    accessRoleArn: src.accessRoleArn,
    instanceRoleArn: inst.role,
    autoDeploy: src.autoDeploy,
    port: src.port,
    startCommand: src.startCommand,
    env: src.env,
    secretsMap: src.secrets,
    cpu: inst.cpu,
    memory: inst.memory,
    health,
    scalingArn,
    operations: [],
    pendingLogs: [],
    tags: ((c.p.Tags ?? []) as { Key: string; Value: string }[]).map((t) => ({ Key: t.Key, Value: t.Value })),
  };
  st.services[s.arn] = s;
  logsCreateGroup(c.acct, c.region, logGroup(s, 'service'));
  logsCreateGroup(c.acct, c.region, logGroup(s, 'application'));
  const o = startDeploy(c.acct, c.region, s, now, 'CREATE_SERVICE');
  return { Service: view(c.acct, c.region, s), OperationId: o.Id };
});

op('apprunner', 'describe-service', 'service-arn:s!', 'Estado de un servicio: URL, configuración y si está en marcha, desplegando o ha fallado.', { res: svcRes }, (c) => ({ Service: view(c.acct, c.region, findSvc(c.acct, c.region, String(c.p.ServiceArn))) }));

op('apprunner', 'list-services', 'max-results:i', 'Lista los servicios de App Runner.', { res: svcRes, paginate: 'ServiceSummaryList' }, (c) => ({
  ServiceSummaryList: Object.values(arOf(c.acct, c.region).services)
    .filter((s) => s.status !== 'DELETED')
    .map((s) => ({ ServiceName: s.name, ServiceId: s.id, ServiceArn: s.arn, ServiceUrl: s.url, CreatedAt: iso(s.created), UpdatedAt: iso(s.updated), Status: s.status })),
}));

op('apprunner', 'list-operations', 'service-arn:s! max-results:i', 'Historial de operaciones del servicio (creación, despliegues, pausas…) y si salieron bien.', { res: svcRes, paginate: 'OperationSummaryList' }, (c) => ({ OperationSummaryList: findSvc(c.acct, c.region, String(c.p.ServiceArn)).operations.map(opView) }));

op('apprunner', 'update-service', 'service-arn:s! source-configuration:j instance-configuration:j health-check-configuration:j auto-scaling-configuration-arn:s network-configuration:j observability-configuration:j', 'Cambia la configuración del servicio (imagen, puerto, CPU/memoria, comprobación de salud o escalado); la versión anterior sigue atendiendo hasta que la nueva está sana.', { res: svcRes }, (c) => {
  const s = findSvc(c.acct, c.region, String(c.p.ServiceArn));
  if (s.status === 'OPERATION_IN_PROGRESS') throw E.invalid(`Service cannot be updated in the current state: ${s.status}`);
  if (s.status === 'PAUSED') throw E.invalid(`Service cannot be updated in the current state: ${s.status}`);
  const src = c.p.SourceConfiguration ? parseSource(c.p.SourceConfiguration, s) : undefined;
  const inst = c.p.InstanceConfiguration ? instanceCfg(c.p.InstanceConfiguration, { cpu: s.cpu, memory: s.memory, role: s.instanceRoleArn }) : undefined;
  checkRoles(c.acct, src?.accessRoleArn ?? s.accessRoleArn, inst?.role ?? s.instanceRoleArn, src?.imageType ?? s.imageType);
  const before = JSON.stringify([s.image, s.imageType, s.accessRoleArn, s.port, s.startCommand, s.env, s.secretsMap, s.cpu, s.memory, s.instanceRoleArn, s.health]);
  if (src) Object.assign(s, { image: src.image, imageType: src.imageType, accessRoleArn: src.accessRoleArn, autoDeploy: src.autoDeploy, port: src.port, startCommand: src.startCommand, env: src.env, secretsMap: src.secrets });
  if (inst) Object.assign(s, { cpu: inst.cpu, memory: inst.memory, instanceRoleArn: inst.role });
  if (c.p.HealthCheckConfiguration) s.health = healthCfg(c.p.HealthCheckConfiguration, s.health);
  if (c.p.AutoScalingConfigurationArn) {
    const arnIn = String(c.p.AutoScalingConfigurationArn);
    if (!Object.values(scalingOf(c.acct, c.region)).some((x) => x.arn === arnIn)) throw E.nf(`AutoScalingConfiguration ${arnIn} not found.`);
    s.scalingArn = arnIn;
  }
  const after = JSON.stringify([s.image, s.imageType, s.accessRoleArn, s.port, s.startCommand, s.env, s.secretsMap, s.cpu, s.memory, s.instanceRoleArn, s.health]);
  const o = after !== before ? startDeploy(c.acct, c.region, s, c.acct.clock, 'UPDATE_SERVICE') : beginInstant(c.acct, c.region, s, 'UPDATE_SERVICE');
  return { Service: view(c.acct, c.region, s), OperationId: o.Id };
});

/** Una operación que no necesita redesplegar (p. ej. solo cambia el escalado). */
function beginInstant(a: Account, region: string, s: ArService, type: ArOperation['Type']): ArOperation {
  const o = beginOp(a, region, s, type, a.clock);
  o.Status = 'SUCCEEDED';
  o.EndedAt = a.clock + 5000;
  return o;
}

op('apprunner', 'start-deployment', 'service-arn:s!', 'Vuelve a descargar la imagen (la etiqueta puede apuntar a una versión nueva) y la despliega sin cortes.', { res: svcRes }, (c) => {
  const s = findSvc(c.acct, c.region, String(c.p.ServiceArn));
  if (s.status !== 'RUNNING') throw E.invalid(`Service cannot be deployed in the current state: ${s.status}`);
  const o = startDeploy(c.acct, c.region, s, c.acct.clock, 'START_DEPLOYMENT');
  return { OperationId: o.Id };
});

op('apprunner', 'pause-service', 'service-arn:s!', 'Pausa el servicio: no cuesta cómputo, pero deja de responder.', { res: svcRes }, (c) => {
  const s = findSvc(c.acct, c.region, String(c.p.ServiceArn));
  if (s.status !== 'RUNNING') throw E.invalid(`Service cannot be paused in the current state: ${s.status}`);
  const o = beginOp(c.acct, c.region, s, 'PAUSE_SERVICE', c.acct.clock);
  s.status = 'OPERATION_IN_PROGRESS';
  s.pending = { op: o.Id, settleAt: c.acct.clock + 20000, ok: true, nextStatus: 'PAUSED' };
  slog(s, c.acct.clock + 15000, 'Service paused successfully.');
  return { Service: view(c.acct, c.region, s), OperationId: o.Id };
});

op('apprunner', 'resume-service', 'service-arn:s!', 'Reanuda un servicio pausado.', { res: svcRes }, (c) => {
  const s = findSvc(c.acct, c.region, String(c.p.ServiceArn));
  if (s.status !== 'PAUSED') throw E.invalid(`Service cannot be resumed in the current state: ${s.status}`);
  const o = beginOp(c.acct, c.region, s, 'RESUME_SERVICE', c.acct.clock);
  s.status = 'OPERATION_IN_PROGRESS';
  s.pending = { op: o.Id, settleAt: c.acct.clock + 45000, ok: true, nextStatus: 'RUNNING' };
  slog(s, c.acct.clock + 40000, 'Service resumed successfully.');
  return { Service: view(c.acct, c.region, s), OperationId: o.Id };
});

op('apprunner', 'delete-service', 'service-arn:s!', 'Borra el servicio y su URL.', { res: svcRes }, (c) => {
  const s = findSvc(c.acct, c.region, String(c.p.ServiceArn));
  if (s.status === 'OPERATION_IN_PROGRESS') throw E.invalid(`Service cannot be deleted in the current state: ${s.status}`);
  const o = beginOp(c.acct, c.region, s, 'DELETE_SERVICE', c.acct.clock);
  s.status = 'OPERATION_IN_PROGRESS';
  s.live = undefined;
  s.pending = { op: o.Id, settleAt: c.acct.clock + 60000, ok: true, nextStatus: 'DELETED' };
  return { Service: view(c.acct, c.region, s), OperationId: o.Id };
});

op('apprunner', 'create-auto-scaling-configuration', 'auto-scaling-configuration-name:s! max-concurrency:i min-size:i max-size:i tags:f', 'Crea una configuración de escalado: cuántas peticiones simultáneas aguanta una instancia y entre cuántas instancias se mueve el servicio.', { res: () => '*' }, (c) => {
  const name = String(c.p.AutoScalingConfigurationName);
  if (!/^[A-Za-z0-9][A-Za-z0-9-_]{3,31}$/.test(name)) throw new AwsError('ValidationException', `1 validation error detected: Value '${name}' at 'autoScalingConfigurationName' failed to satisfy constraint: Member must satisfy regular expression pattern: [A-Za-z0-9][A-Za-z0-9-_]{3,31}`, 400);
  const max = Number(c.p.MaxConcurrency ?? 100);
  const minSize = Number(c.p.MinSize ?? 1);
  const maxSize = Number(c.p.MaxSize ?? 25);
  if (max < 1 || max > 200) throw E.invalid('MaxConcurrency must be between 1 and 200.');
  if (minSize < 1 || minSize > 25) throw E.invalid('MinSize must be between 1 and 25.');
  if (maxSize < minSize || maxSize > 25) throw E.invalid('MaxSize must be between MinSize and 25.');
  const all = scalingOf(c.acct, c.region);
  const prev = Object.values(all).filter((x) => x.name === name);
  prev.forEach((x) => (x.latest = false));
  const revision = prev.length + 1;
  const s: ArAutoScaling = { name, arn: arn(c.acct, c.region, `autoscalingconfiguration/${name}/${revision}/${uuid(`as:${c.acct.id}:${name}:${revision}`).replace(/-/g, '')}`), revision, latest: true, maxConcurrency: max, minSize, maxSize, created: c.acct.clock, active: true };
  all[s.arn] = s;
  return { AutoScalingConfiguration: scalingView(s) };
});

op('apprunner', 'list-auto-scaling-configurations', 'auto-scaling-configuration-name:s latest-only:b max-results:i', 'Lista las configuraciones de escalado.', { res: () => '*', paginate: 'AutoScalingConfigurationSummaryList' }, (c) => ({
  AutoScalingConfigurationSummaryList: Object.values(scalingOf(c.acct, c.region))
    .filter((x) => x.active && (!c.p.AutoScalingConfigurationName || x.name === c.p.AutoScalingConfigurationName) && (!c.p.LatestOnly || x.latest))
    .map((x) => ({ AutoScalingConfigurationArn: x.arn, AutoScalingConfigurationName: x.name, AutoScalingConfigurationRevision: x.revision, Status: 'ACTIVE', CreatedAt: iso(x.created), HasAssociatedService: Object.values(arOf(c.acct, c.region).services).some((s) => s.scalingArn === x.arn), IsDefault: x.name === DEFAULT_SCALING })),
}));

op('apprunner', 'describe-auto-scaling-configuration', 'auto-scaling-configuration-arn:s!', 'Detalle de una configuración de escalado.', { res: () => '*' }, (c) => {
  const x = Object.values(scalingOf(c.acct, c.region)).find((y) => y.arn === c.p.AutoScalingConfigurationArn);
  if (!x) throw E.nf(`AutoScalingConfiguration ${c.p.AutoScalingConfigurationArn} not found.`);
  return { AutoScalingConfiguration: scalingView(x) };
});

op('apprunner', 'delete-auto-scaling-configuration', 'auto-scaling-configuration-arn:s! delete-all-revisions:b', 'Borra una configuración de escalado (si ningún servicio la usa).', { res: () => '*' }, (c) => {
  const all = scalingOf(c.acct, c.region);
  const x = Object.values(all).find((y) => y.arn === c.p.AutoScalingConfigurationArn);
  if (!x) throw E.nf(`AutoScalingConfiguration ${c.p.AutoScalingConfigurationArn} not found.`);
  if (x.name === DEFAULT_SCALING) throw E.invalid('The default auto scaling configuration cannot be deleted.');
  if (Object.values(arOf(c.acct, c.region).services).some((s) => s.scalingArn === x.arn && s.status !== 'DELETED')) throw E.invalid('The auto scaling configuration is in use by a service.');
  x.active = false;
  return { AutoScalingConfiguration: { ...scalingView(x), Status: 'inactive', DeletedAt: iso(c.acct.clock) } };
});

// ───────────────────────── peticiones a la URL del servicio ─────────────────────────

/** Atiende `https://<id>.<región>.awsapprunner.com/…`; devuelve null si el nombre no es de un servicio. */
export function appRunnerRequest(a: Account, req: { host: string; port: number; scheme: string; path: string; query: string; method: string; body?: string; headers?: Record<string, string> }): Fetched | null {
  const m = /^([a-z0-9]{10})\.([a-z0-9-]+)\.awsapprunner\.com$/.exec(req.host.toLowerCase());
  if (!m) return null;
  const region = m[2];
  const s = Object.values(a.regions[region]?.apprunner?.services ?? {}).find((x) => x.url === req.host.toLowerCase() && x.status !== 'DELETED');
  if (!s || s.status === 'CREATE_FAILED') return { ok: false, curlCode: 6, error: `Could not resolve host: ${req.host}` };
  settle(a, region, s, a.clock);
  if (req.scheme !== 'https' || req.port === 80) return { ok: false, curlCode: 7, error: `Failed to connect to ${req.host} port ${req.port} after 14 ms: Couldn't connect to server` };
  if (s.status === 'PAUSED') return { ok: true, status: 503, type: 'text/plain', body: 'Service Unavailable', size: 19, headers: { Server: 'envoy' } };
  if (!s.live) return { ok: false, curlCode: 6, error: `Could not resolve host: ${req.host}` };
  const ro: RunOpts = { acct: a, region, env: s.live.env, args: s.live.args, hostArch: 'amd64', caller: s.live.role ? roleCaller(a, s.live.role, 'apprunner') : null, now: a.clock };
  const res = containerHttp(s.live.img, ro, s.live.server, s.live.server.port, { method: req.method, path: req.path + (req.query ? '?' + req.query : ''), body: req.body, headers: req.headers }, true);
  if (res.refused) return { ok: true, status: 502, type: 'text/plain', body: 'upstream connect error or disconnect/reset before headers', size: 56, headers: { Server: 'envoy' } };
  if (res.log) for (const l of res.log.split('\n')) if (l) logsPut(a, region, logGroup(s, 'application'), `instance/${s.id.slice(0, 8)}`, l, a.clock);
  const body = res.body ?? '';
  return { ok: true, status: res.status, type: res.headers?.['Content-Type'] ?? 'text/html', body, size: body.length, headers: { ...res.headers, Server: 'envoy' } };
}
