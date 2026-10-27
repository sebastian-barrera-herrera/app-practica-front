/**
 * Application Auto Scaling para los servicios de ECS: objetivos escalables (mínimo y máximo), seguimiento de objetivo
 * (CPU, memoria o peticiones por tarea), políticas por pasos, acciones programadas y el historial de lo que hizo.
 * También las métricas `AWS/ECS` (y las de Container Insights) con las que se alimentan las alarmas.
 */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Alarm } from '../types';
import type { AasActivity, AasPolicy, AasScheduled, AasTarget, EcsService } from '../types-containers';
import { iso, newId } from '../util';
import { cronMatches } from './autoscaling';
import { advanceEcs, ecsHooks, ecsOf, findTaskDef, isLive, taskStatus } from './ecs';
import { lbsUsing, rpsAt } from './elb';
import { evalAlarm, metricProviders, metricSeries, type Point } from './metrics';

const MIN = 60000;
const NAMESPACES = ['appstream', 'cassandra', 'comprehend', 'custom-resource', 'dynamodb', 'ec2', 'ecs', 'elasticache', 'elasticmapreduce', 'kafka', 'lambda', 'neptune', 'rds', 'sagemaker'];
const DIMENSION = 'ecs:service:DesiredCount';
const AWS_ERR = {
  val: (m: string) => new AwsError('ValidationException', m, 400),
  nf: (m: string) => new AwsError('ObjectNotFoundException', m, 400),
};

const aasOf = (a: Account, region: string) => (regional(a, region).aas ??= { targets: {} });
const keyOf = (ns: string, rid: string, dim: string) => `${ns}|${rid}|${dim}`;
const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// ───────────────────────── carga de un servicio ─────────────────────────

export interface EcsLoad {
  /** Tareas en marcha y sirviendo. */
  serving: number;
  /** Tareas vivas (en marcha o arrancando). */
  live: number;
  rps: number;
  cpu: number;
  mem: number;
  /** Peticiones por minuto y por tarea (`ALBRequestCountPerTarget`). */
  perTargetMin: number;
}

function taskCpuUnits(a: Account, region: string, svc: EcsService): number {
  const prim = svc.deployments.find((d) => d.status === 'PRIMARY');
  try {
    const td = findTaskDef(a, region, prim?.taskDefinition ?? '');
    const n = Number(td.cpu ?? td.containerDefinitions.reduce((s, c) => s + (c.cpu ?? 0), 0));
    return n > 0 ? n : 256;
  } catch {
    return 256;
  }
}

function lbArnsOf(a: Account, region: string, svc: EcsService): string[] {
  const out = new Set<string>();
  for (const l of svc.loadBalancers) for (const lb of lbsUsing(a, region, l.targetGroupArn)) out.add(lb.LoadBalancerArn);
  return [...out];
}

/** Cómo va un servicio en el minuto `t`: tareas que sirven, carga repartida y el CPU/memoria que se ve desde fuera. */
export function ecsLoad(a: Account, region: string, svc: EcsService, t: number): EcsLoad {
  const tasks = Object.values(ecsOf(a, region).tasks).filter((x) => x.cluster === svc.cluster && x.serviceName === svc.name);
  const serving = tasks.filter((x) => taskStatus(x, t) === 'RUNNING').length;
  const live = tasks.filter((x) => isLive(x, t)).length;
  const rps = lbArnsOf(a, region, svc).reduce((n, arn) => n + rpsAt(a, arn, t), 0);
  const per = serving ? rps / serving : 0;
  const cap = Math.max(10, (taskCpuUnits(a, region, svc) / 1024) * 120);
  const cpu = serving ? Math.min(100, Math.round((2 + (per / cap) * 100) * 10) / 10) : 0;
  const mem = serving ? Math.min(100, Math.round((20 + (per / cap) * 60) * 10) / 10) : 0;
  return { serving, live, rps, cpu, mem, perTargetMin: per * 60 };
}

const svcOfDims = (a: Account, region: string, dims: Record<string, string>): EcsService | undefined => ecsOf(a, region).services[`${dims.ClusterName}/${dims.ServiceName}`];

metricProviders.push((a, region, q): Point[] | null => {
  if (q.ns === 'AWS/ECS') {
    if (!['CPUUtilization', 'MemoryUtilization'].includes(q.metric)) return null;
    const svc = svcOfDims(a, region, q.dims);
    if (!svc || svc.status === 'INACTIVE') return [];
    const now = Math.floor(a.clock / MIN) * MIN;
    const pts: Point[] = [];
    for (let t = Math.ceil(Math.max(svc.createdAt, now - 180 * MIN) / MIN) * MIN; t <= now; t += MIN) {
      const l = ecsLoad(a, region, svc, t);
      if (l.serving) pts.push({ t, v: q.metric === 'CPUUtilization' ? l.cpu : l.mem });
    }
    return pts;
  }
  if (q.ns === 'ECS/ContainerInsights') {
    const cl = ecsOf(a, region).clusters[q.dims.ClusterName];
    if (!cl || !cl.insights) return [];
    const now = Math.floor(a.clock / MIN) * MIN;
    const svc = q.dims.ServiceName ? svcOfDims(a, region, q.dims) : undefined;
    if (q.dims.ServiceName && !svc) return [];
    const pts: Point[] = [];
    for (let t = Math.ceil(Math.max(cl.created, now - 180 * MIN) / MIN) * MIN; t <= now; t += MIN) {
      const tasks = Object.values(ecsOf(a, region).tasks).filter((x) => x.cluster === cl.name && (!svc || x.serviceName === svc.name));
      if (q.metric === 'RunningTaskCount') pts.push({ t, v: tasks.filter((x) => taskStatus(x, t) === 'RUNNING').length });
      else if (q.metric === 'PendingTaskCount') pts.push({ t, v: tasks.filter((x) => ['PROVISIONING', 'PENDING', 'ACTIVATING'].includes(taskStatus(x, t))).length });
      else if (q.metric === 'DesiredTaskCount' && svc) pts.push({ t, v: svc.desiredCount });
      else if (q.metric === 'ServiceCount' && !svc) pts.push({ t, v: Object.values(ecsOf(a, region).services).filter((s) => s.cluster === cl.name && s.status === 'ACTIVE').length });
      else return null;
    }
    return pts;
  }
  return null;
});

// ───────────────────────── búsqueda y validación ─────────────────────────

function checkTargetRef(a: Account, region: string, ns: string, rid: string, dim: string): EcsService {
  if (!NAMESPACES.includes(ns)) throw AWS_ERR.val(`1 validation error detected: Value '${ns}' at 'serviceNamespace' failed to satisfy constraint: Member must satisfy enum value set: [${NAMESPACES.join(', ')}]`);
  if (ns !== 'ecs') throw AWS_ERR.val(`Application Auto Scaling for '${ns}' is not available in this simulator. Use --service-namespace ecs.`);
  if (dim !== DIMENSION) throw AWS_ERR.val('Unsupported service namespace, resource type or scalable dimension');
  const m = /^service\/([^/]+)\/([^/]+)$/.exec(rid);
  if (!m) throw AWS_ERR.val(`ECS resource ID is invalid: ${rid}. Expected service/<cluster-name>/<service-name>.`);
  const svc = ecsOf(a, region).services[`${m[1]}/${m[2]}`];
  if (!svc || svc.status === 'INACTIVE') throw AWS_ERR.val(`ECS service doesn't exist: ${rid}`);
  return svc;
}

function findTarget(a: Account, region: string, ns: string, rid: string, dim: string): AasTarget {
  const t = aasOf(a, region).targets[keyOf(ns, rid, dim)];
  if (!t) throw AWS_ERR.nf(`No scalable target registered for service namespace: ${ns}, resource ID: ${rid}, scalable dimension: ${dim}`);
  return t;
}

const targetArn = (a: Account, region: string, key: string) => `arn:aws:application-autoscaling:${region}:${a.id}:scalable-target/${md5(key).slice(0, 32)}`;

function targetView(t: AasTarget) {
  return {
    ServiceNamespace: t.ns,
    ResourceId: t.resourceId,
    ScalableDimension: t.dimension,
    MinCapacity: t.min,
    MaxCapacity: t.max,
    RoleARN: t.roleArn,
    CreationTime: iso(t.created),
    SuspendedState: t.suspended,
    ScalableTargetARN: t.arn,
  };
}

const opRes = (c: OpCtx) => `arn:aws:application-autoscaling:${c.region}:${c.acct.id}:scalable-target/*`;

// ───────────────────────── objetivos escalables ─────────────────────────

op('application-autoscaling', 'register-scalable-target', 'service-namespace:s! resource-id:s! scalable-dimension:s! min-capacity:i max-capacity:i role-arn:s suspended-state:j', 'Registra un servicio como «escalable»: dentro de qué mínimo y máximo de tareas puede moverse Application Auto Scaling. Es el primer paso antes de crear ninguna política.', { res: opRes }, (c) => {
  const ns = String(c.p.ServiceNamespace);
  const rid = String(c.p.ResourceId);
  const dim = String(c.p.ScalableDimension);
  const svc = checkTargetRef(c.acct, c.region, ns, rid, dim);
  const st = aasOf(c.acct, c.region);
  const key = keyOf(ns, rid, dim);
  const cur = st.targets[key];
  if (!cur && (c.p.MinCapacity === undefined || c.p.MaxCapacity === undefined)) throw AWS_ERR.val('MinCapacity and MaxCapacity are required when you register a scalable target for the first time.');
  const min = c.p.MinCapacity ?? cur.min;
  const max = c.p.MaxCapacity ?? cur.max;
  if (min < 0 || max < 0) throw AWS_ERR.val('MinCapacity and MaxCapacity must be greater than or equal to 0.');
  if (min > max) throw AWS_ERR.val('MinCapacity cannot be greater than MaxCapacity.');
  const role = String(c.p.RoleArn ?? cur?.roleArn ?? `arn:aws:iam::${c.acct.id}:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService`);
  const ss = (c.p.SuspendedState ?? {}) as Record<string, unknown>;
  const flag = (k: string, old: boolean | undefined) => (ss[k] === undefined ? !!old : ss[k] === true || ss[k] === 'true');
  const t: AasTarget = cur ?? { ns, resourceId: rid, dimension: dim, min, max, roleArn: role, arn: targetArn(c.acct, c.region, key), created: c.acct.clock, suspended: { DynamicScalingInSuspended: false, DynamicScalingOutSuspended: false, ScheduledScalingSuspended: false }, policies: {}, scheduled: {}, activities: [], lastEval: c.acct.clock, lastOut: 0, lastIn: 0, lowMinutes: 0 };
  t.min = min;
  t.max = max;
  t.roleArn = role;
  t.suspended = { DynamicScalingInSuspended: flag('DynamicScalingInSuspended', t.suspended.DynamicScalingInSuspended), DynamicScalingOutSuspended: flag('DynamicScalingOutSuspended', t.suspended.DynamicScalingOutSuspended), ScheduledScalingSuspended: flag('ScheduledScalingSuspended', t.suspended.ScheduledScalingSuspended) };
  st.targets[key] = t;
  // si el número deseado queda fuera del rango, se corrige enseguida
  clampDesired(c.acct, c.region, t, svc, c.acct.clock, 'a user request modified the minimum or maximum capacity');
  return { ScalableTargetARN: t.arn };
});

op('application-autoscaling', 'describe-scalable-targets', 'service-namespace:s! resource-ids:l scalable-dimension:s max-results:i', 'Lista los objetivos escalables registrados.', { res: opRes, paginate: 'ScalableTargets' }, (c) => {
  const ns = String(c.p.ServiceNamespace);
  if (!NAMESPACES.includes(ns)) throw AWS_ERR.val(`1 validation error detected: Value '${ns}' at 'serviceNamespace' failed to satisfy constraint: Member must satisfy enum value set: [${NAMESPACES.join(', ')}]`);
  const ids = c.p.ResourceIds as string[] | undefined;
  return { ScalableTargets: Object.values(aasOf(c.acct, c.region).targets).filter((t) => t.ns === ns && (!ids || ids.includes(t.resourceId)) && (!c.p.ScalableDimension || t.dimension === c.p.ScalableDimension)).map(targetView) };
});

function dropTarget(a: Account, region: string, t: AasTarget) {
  const reg = regional(a, region);
  for (const p of Object.values(t.policies)) for (const al of p.alarms) delete reg.alarms[al.AlarmName];
  delete aasOf(a, region).targets[keyOf(t.ns, t.resourceId, t.dimension)];
}

op('application-autoscaling', 'deregister-scalable-target', 'service-namespace:s! resource-id:s! scalable-dimension:s!', 'Deja de gestionar el escalado del servicio (borra sus políticas y acciones programadas).', { res: opRes }, (c) => {
  const t = findTarget(c.acct, c.region, String(c.p.ServiceNamespace), String(c.p.ResourceId), String(c.p.ScalableDimension));
  dropTarget(c.acct, c.region, t);
  return undefined;
});

// ───────────────────────── políticas ─────────────────────────

const PREDEFINED = ['ECSServiceAverageCPUUtilization', 'ECSServiceAverageMemoryUtilization', 'ALBRequestCountPerTarget'];

const policyArn = (a: Account, region: string, rid: string, name: string) => `arn:aws:autoscaling:${region}:${a.id}:scalingPolicy:${md5(`${rid}|${name}`).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5')}:resource/ecs/${rid}:policyName/${name}`;

/** Etiqueta que identifica al balanceador y su grupo de destino: `app/nombre/id/targetgroup/nombre/id`. */
export function albLabel(a: Account, region: string, svc: EcsService): string | undefined {
  const l = svc.loadBalancers[0];
  if (!l) return undefined;
  const lb = lbsUsing(a, region, l.targetGroupArn)[0];
  if (!lb) return undefined;
  return `${lb.LoadBalancerArn.split('loadbalancer/')[1]}/${l.targetGroupArn.split(':').pop()}`;
}

const ttDims = (a: Account, region: string, svc: EcsService, kind: string): { ns: string; metric: string; dims: { Name: string; Value: string }[] } => {
  if (kind === 'ALBRequestCountPerTarget') {
    const l = svc.loadBalancers[0];
    const lb = l ? lbsUsing(a, region, l.targetGroupArn)[0] : undefined;
    return { ns: 'AWS/ApplicationELB', metric: 'RequestCountPerTarget', dims: [{ Name: 'TargetGroup', Value: l ? l.targetGroupArn.split(':').pop()! : '' }, { Name: 'LoadBalancer', Value: lb ? lb.LoadBalancerArn.split('loadbalancer/')[1] : '' }] };
  }
  return { ns: 'AWS/ECS', metric: kind === 'ECSServiceAverageMemoryUtilization' ? 'MemoryUtilization' : 'CPUUtilization', dims: [{ Name: 'ClusterName', Value: svc.cluster }, { Name: 'ServiceName', Value: svc.name }] };
};

op('application-autoscaling', 'put-scaling-policy', 'policy-name:s! service-namespace:s! resource-id:s! scalable-dimension:s! policy-type:s step-scaling-policy-configuration:j target-tracking-scaling-policy-configuration:j', 'Crea o actualiza una política de escalado: seguimiento de objetivo (mantener la CPU al 50 %…) o por pasos (si la alarma salta, suma tantas tareas).', { res: opRes }, (c) => {
  const ns = String(c.p.ServiceNamespace);
  const rid = String(c.p.ResourceId);
  const dim = String(c.p.ScalableDimension);
  const svc = checkTargetRef(c.acct, c.region, ns, rid, dim);
  const t = findTarget(c.acct, c.region, ns, rid, dim);
  const type = String(c.p.PolicyType ?? 'StepScaling');
  if (!['TargetTrackingScaling', 'StepScaling'].includes(type)) throw AWS_ERR.val(`1 validation error detected: Value '${type}' at 'policyType' failed to satisfy constraint: Member must satisfy enum value set: [TargetTrackingScaling, StepScaling]`);
  const name = String(c.p.PolicyName);
  const reg = regional(c.acct, c.region);
  const old = t.policies[name];
  if (old) for (const al of old.alarms) delete reg.alarms[al.AlarmName];
  const p: AasPolicy = { name, arn: old?.arn ?? policyArn(c.acct, c.region, rid, name), type: type as AasPolicy['type'], created: old?.created ?? c.acct.clock, alarms: [] };
  if (type === 'TargetTrackingScaling') {
    const cfg = c.p.TargetTrackingScalingPolicyConfiguration as Record<string, any> | undefined;
    if (!cfg) throw AWS_ERR.val('TargetTrackingScalingPolicyConfiguration is required when PolicyType is TargetTrackingScaling.');
    if (cfg.TargetValue === undefined || Number.isNaN(Number(cfg.TargetValue))) throw AWS_ERR.val("1 validation error detected: Value null at 'targetTrackingScalingPolicyConfiguration.targetValue' failed to satisfy constraint: Member must not be null");
    const target = Number(cfg.TargetValue);
    if (target <= 0) throw AWS_ERR.val('TargetValue must be greater than 0.');
    const pre = cfg.PredefinedMetricSpecification as { PredefinedMetricType?: string; ResourceLabel?: string } | undefined;
    if (!pre?.PredefinedMetricType) throw AWS_ERR.val('PredefinedMetricSpecification is required in this simulator (ECSServiceAverageCPUUtilization, ECSServiceAverageMemoryUtilization or ALBRequestCountPerTarget).');
    if (!PREDEFINED.includes(pre.PredefinedMetricType)) throw AWS_ERR.val(`Unsupported predefined metric type: ${pre.PredefinedMetricType}. Valid for ECS: ${PREDEFINED.join(', ')}`);
    if (pre.PredefinedMetricType === 'ALBRequestCountPerTarget' && !pre.ResourceLabel) throw AWS_ERR.val('ResourceLabel is required for ALBRequestCountPerTarget (app/<lb-name>/<id>/targetgroup/<tg-name>/<id>).');
    p.tt = { TargetValue: target, PredefinedMetricSpecification: { PredefinedMetricType: pre.PredefinedMetricType, ...(pre.ResourceLabel ? { ResourceLabel: pre.ResourceLabel } : {}) }, ScaleInCooldown: Number(cfg.ScaleInCooldown ?? 300), ScaleOutCooldown: Number(cfg.ScaleOutCooldown ?? 300), DisableScaleIn: cfg.DisableScaleIn === true || cfg.DisableScaleIn === 'true' };
    const m = ttDims(c.acct, c.region, svc, pre.PredefinedMetricType);
    const tag = `${md5(p.arn).slice(0, 8)}-${md5(p.arn).slice(8, 12)}-${md5(p.arn).slice(12, 16)}`;
    for (const [suffix, periods, cmp, mult, act] of [['AlarmHigh', 3, 'GreaterThanThreshold', 1, [p.arn]], ['AlarmLow', 15, 'LessThanThreshold', 0.9, []]] as const) {
      const alName = `TargetTracking-${rid}-${suffix}-${tag}`;
      const al: Alarm = { AlarmName: alName, Namespace: m.ns, MetricName: m.metric, Statistic: 'Average', Period: 60, EvaluationPeriods: periods, Threshold: target * mult, ComparisonOperator: cmp, AlarmActions: [...act], Dimensions: m.dims, AlarmDescription: `DO NOT EDIT OR DELETE. For TargetTrackingScaling policy ${p.arn}.`, TreatMissingData: 'missing', StateValue: 'OK' };
      reg.alarms[alName] = al;
      p.alarms.push({ AlarmName: alName, AlarmARN: `arn:aws:cloudwatch:${c.region}:${c.acct.id}:alarm:${alName}` });
    }
  } else {
    const cfg = c.p.StepScalingPolicyConfiguration as Record<string, any> | undefined;
    if (!cfg) throw AWS_ERR.val('StepScalingPolicyConfiguration is required when PolicyType is StepScaling.');
    if (!['ChangeInCapacity', 'PercentChangeInCapacity', 'ExactCapacity'].includes(String(cfg.AdjustmentType))) throw AWS_ERR.val('AdjustmentType must be ChangeInCapacity, PercentChangeInCapacity or ExactCapacity.');
    const steps = cfg.StepAdjustments;
    if (!Array.isArray(steps) || !steps.length) throw AWS_ERR.val('StepAdjustments must contain at least one step.');
    p.step = { AdjustmentType: cfg.AdjustmentType, StepAdjustments: steps.map((s: any) => ({ ...(s.MetricIntervalLowerBound !== undefined ? { MetricIntervalLowerBound: Number(s.MetricIntervalLowerBound) } : {}), ...(s.MetricIntervalUpperBound !== undefined ? { MetricIntervalUpperBound: Number(s.MetricIntervalUpperBound) } : {}), ScalingAdjustment: Number(s.ScalingAdjustment) })), Cooldown: Number(cfg.Cooldown ?? 300), MetricAggregationType: String(cfg.MetricAggregationType ?? 'Average') };
  }
  t.policies[name] = p;
  return { PolicyARN: p.arn, Alarms: p.alarms };
});

function policyView(t: AasTarget, p: AasPolicy) {
  return {
    PolicyARN: p.arn,
    PolicyName: p.name,
    ServiceNamespace: t.ns,
    ResourceId: t.resourceId,
    ScalableDimension: t.dimension,
    PolicyType: p.type,
    ...(p.tt ? { TargetTrackingScalingPolicyConfiguration: { TargetValue: p.tt.TargetValue, PredefinedMetricSpecification: p.tt.PredefinedMetricSpecification, ScaleOutCooldown: p.tt.ScaleOutCooldown, ScaleInCooldown: p.tt.ScaleInCooldown, DisableScaleIn: p.tt.DisableScaleIn } } : {}),
    ...(p.step ? { StepScalingPolicyConfiguration: { AdjustmentType: p.step.AdjustmentType, StepAdjustments: p.step.StepAdjustments, Cooldown: p.step.Cooldown, MetricAggregationType: p.step.MetricAggregationType } } : {}),
    Alarms: p.alarms,
    CreationTime: iso(p.created),
  };
}

op('application-autoscaling', 'describe-scaling-policies', 'service-namespace:s! policy-names:l resource-id:s scalable-dimension:s max-results:i', 'Lista las políticas de escalado (y las alarmas que Application Auto Scaling creó para ellas).', { res: opRes, paginate: 'ScalingPolicies' }, (c) => {
  const ns = String(c.p.ServiceNamespace);
  if (!NAMESPACES.includes(ns)) throw AWS_ERR.val(`1 validation error detected: Value '${ns}' at 'serviceNamespace' failed to satisfy constraint: Member must satisfy enum value set: [${NAMESPACES.join(', ')}]`);
  const names = c.p.PolicyNames as string[] | undefined;
  return { ScalingPolicies: Object.values(aasOf(c.acct, c.region).targets).filter((t) => t.ns === ns && (!c.p.ResourceId || t.resourceId === c.p.ResourceId) && (!c.p.ScalableDimension || t.dimension === c.p.ScalableDimension)).flatMap((t) => Object.values(t.policies).filter((p) => !names || names.includes(p.name)).map((p) => policyView(t, p))) };
});

op('application-autoscaling', 'delete-scaling-policy', 'policy-name:s! service-namespace:s! resource-id:s! scalable-dimension:s!', 'Borra una política (y sus alarmas).', { res: opRes }, (c) => {
  const t = findTarget(c.acct, c.region, String(c.p.ServiceNamespace), String(c.p.ResourceId), String(c.p.ScalableDimension));
  const p = t.policies[String(c.p.PolicyName)];
  if (!p) throw AWS_ERR.nf(`No scaling policy found for service namespace: ${t.ns}, resource ID: ${t.resourceId}, scalable dimension: ${t.dimension}, policy name: ${c.p.PolicyName}`);
  for (const al of p.alarms) delete regional(c.acct, c.region).alarms[al.AlarmName];
  delete t.policies[p.name];
  return undefined;
});

// ───────────────────────── acciones programadas ─────────────────────────

/** `at(2026-10-30T09:00:00)`, `rate(5 minutes)` o `cron(min hora díaMes mes díaSemana año)` (los de AWS). */
export function scheduleOk(expr: string): boolean {
  return /^at\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\)$/.test(expr) || /^rate\(\d+ (minute|minutes|hour|hours|day|days)\)$/.test(expr) || /^cron\(\S+ \S+ \S+ \S+ \S+ \S+\)$/.test(expr);
}

const DOW: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function dueAt(s: AasScheduled, t: number): boolean {
  if (s.start && Date.parse(s.start.endsWith('Z') ? s.start : s.start + 'Z') > t) return false;
  if (s.end && Date.parse(s.end.endsWith('Z') ? s.end : s.end + 'Z') <= t) return false;
  const at = /^at\((.+)\)$/.exec(s.schedule);
  if (at) return !s.lastRun && Date.parse(at[1] + 'Z') <= t;
  const rate = /^rate\((\d+) (\w+)\)$/.exec(s.schedule);
  if (rate) {
    const step = Number(rate[1]) * (rate[2].startsWith('minute') ? MIN : rate[2].startsWith('hour') ? 60 * MIN : 1440 * MIN);
    return t - (s.lastRun ?? s.created) >= step;
  }
  const cron = /^cron\((.+)\)$/.exec(s.schedule);
  if (cron) {
    const f = cron[1].split(/\s+/);
    // en AWS el domingo es 1 (o SUN); en el cron clásico, 0
    const dow = f[4] === '?' ? '*' : /[A-Za-z]/.test(f[4]) ? f[4].replace(/[A-Za-z]{3}/g, (m) => String(DOW[m.toUpperCase()] ?? m)) : f[4].replace(/\d/g, (d) => String((Number(d) + 6) % 7));
    const five = [f[0], f[1], f[2] === '?' ? '*' : f[2], f[3], dow].join(' ');
    return s.lastRun !== t && cronMatches(five, t);
  }
  return false;
}

op('application-autoscaling', 'put-scheduled-action', 'service-namespace:s! schedule:s scheduled-action-name:s! resource-id:s! scalable-dimension:s! start-time:s end-time:s scalable-target-action:j timezone:s', 'Cambia el mínimo y el máximo del servicio a una hora fija (at, rate o cron): subir antes del pico, bajar por la noche.', { res: opRes }, (c) => {
  const t = findTarget(c.acct, c.region, String(c.p.ServiceNamespace), String(c.p.ResourceId), String(c.p.ScalableDimension));
  const name = String(c.p.ScheduledActionName);
  const schedule = String(c.p.Schedule ?? '');
  if (!scheduleOk(schedule)) throw AWS_ERR.val(`Schedule is invalid: '${schedule}'. Use at(yyyy-mm-ddThh:mm:ss), rate(value unit) or cron(minutes hours day-of-month month day-of-week year).`);
  const act = (c.p.ScalableTargetAction ?? {}) as Record<string, number>;
  if (act.MinCapacity === undefined && act.MaxCapacity === undefined) throw AWS_ERR.val('ScalableTargetAction must set MinCapacity, MaxCapacity or both.');
  const tz = String(c.p.Timezone ?? 'UTC');
  if (tz !== 'UTC') throw AWS_ERR.val(`Timezone '${tz}' is not supported in this simulator; use UTC.`);
  t.scheduled[name] = { name, arn: `arn:aws:autoscaling:${c.region}:${c.acct.id}:scheduledAction:${md5(`${t.resourceId}|${name}`).slice(0, 8)}:resource/ecs/${t.resourceId}:scheduledActionName/${name}`, schedule, timezone: tz, ...(c.p.StartTime ? { start: String(c.p.StartTime).replace(/Z$/, '') } : {}), ...(c.p.EndTime ? { end: String(c.p.EndTime).replace(/Z$/, '') } : {}), action: { ...(act.MinCapacity !== undefined ? { MinCapacity: Number(act.MinCapacity) } : {}), ...(act.MaxCapacity !== undefined ? { MaxCapacity: Number(act.MaxCapacity) } : {}) }, created: t.scheduled[name]?.created ?? c.acct.clock };
  return undefined;
});

op('application-autoscaling', 'describe-scheduled-actions', 'service-namespace:s! scheduled-action-names:l resource-id:s scalable-dimension:s max-results:i', 'Lista las acciones programadas.', { res: opRes, paginate: 'ScheduledActions' }, (c) => {
  const names = c.p.ScheduledActionNames as string[] | undefined;
  return {
    ScheduledActions: Object.values(aasOf(c.acct, c.region).targets)
      .filter((t) => t.ns === c.p.ServiceNamespace && (!c.p.ResourceId || t.resourceId === c.p.ResourceId))
      .flatMap((t) => Object.values(t.scheduled).filter((s) => !names || names.includes(s.name)).map((s) => ({ ScheduledActionName: s.name, ScheduledActionARN: s.arn, ServiceNamespace: t.ns, Schedule: s.schedule, Timezone: s.timezone, ResourceId: t.resourceId, ScalableDimension: t.dimension, ...(s.start ? { StartTime: s.start } : {}), ...(s.end ? { EndTime: s.end } : {}), ScalableTargetAction: s.action, CreationTime: iso(s.created) }))),
  };
});

op('application-autoscaling', 'delete-scheduled-action', 'service-namespace:s! scheduled-action-name:s! resource-id:s! scalable-dimension:s!', 'Borra una acción programada.', { res: opRes }, (c) => {
  const t = findTarget(c.acct, c.region, String(c.p.ServiceNamespace), String(c.p.ResourceId), String(c.p.ScalableDimension));
  if (!t.scheduled[String(c.p.ScheduledActionName)]) throw AWS_ERR.nf(`No scheduled action called ${c.p.ScheduledActionName} found for service namespace: ${t.ns}, resource ID: ${t.resourceId}, scalable dimension: ${t.dimension}`);
  delete t.scheduled[String(c.p.ScheduledActionName)];
  return undefined;
});

// ───────────────────────── historial ─────────────────────────

op('application-autoscaling', 'describe-scaling-activities', 'service-namespace:s! resource-id:s scalable-dimension:s max-results:i include-not-scaled-activities:b', 'Historial de lo que ha hecho Application Auto Scaling y por qué (la causa es la alarma o la acción programada).', { res: opRes, paginate: 'ScalingActivities' }, (c) => {
  const acts = Object.values(aasOf(c.acct, c.region).targets)
    .filter((t) => t.ns === c.p.ServiceNamespace && (!c.p.ResourceId || t.resourceId === c.p.ResourceId) && (!c.p.ScalableDimension || t.dimension === c.p.ScalableDimension))
    .flatMap((t) => t.activities.map((x) => ({ ActivityId: x.id, ServiceNamespace: t.ns, ResourceId: t.resourceId, ScalableDimension: t.dimension, Description: x.description, Cause: x.cause, StartTime: iso(x.start), EndTime: iso(x.end), StatusCode: x.status, StatusMessage: x.message, _t: x.start })))
    .sort((p, q) => q._t - p._t);
  return { ScalingActivities: acts.map(({ _t, ...rest }) => rest) };
});

// ───────────────────────── simulación minuto a minuto ─────────────────────────

function record(a: Account, t: AasTarget, at: number, description: string, cause: string, message: string, status: AasActivity['status'] = 'Successful') {
  t.activities.unshift({ id: uuid(a, 'aasact'), start: at, end: at + 20000, description, cause, status, message });
  if (t.activities.length > 100) t.activities.length = 100;
}

function setCount(a: Account, t: AasTarget, svc: EcsService, n: number, at: number, cause: string): boolean {
  const next = Math.max(t.min, Math.min(t.max, n));
  if (next === svc.desiredCount) return false;
  svc.desiredCount = next;
  svc.steady = false;
  const prim = svc.deployments.find((d) => d.status === 'PRIMARY');
  if (prim) prim.desiredCount = next;
  record(a, t, at, `Setting desired count to ${next}.`, cause, `Successfully set desired count to ${next}. Change successfully fulfilled by ecs.`);
  return true;
}

function clampDesired(a: Account, region: string, t: AasTarget, svc: EcsService, at: number, why: string) {
  if (svc.desiredCount < t.min) setCount(a, t, svc, t.min, at, why);
  else if (svc.desiredCount > t.max) setCount(a, t, svc, t.max, at, why);
}

function stepTarget(a: Account, region: string, t: AasTarget, at: number) {
  const svc = ecsOf(a, region).services[t.resourceId.replace(/^service\//, '')];
  if (!svc || svc.status !== 'ACTIVE') return;
  // 1. acciones programadas
  if (!t.suspended.ScheduledScalingSuspended) {
    for (const s of Object.values(t.scheduled)) {
      if (!dueAt(s, at)) continue;
      s.lastRun = at;
      if (s.action.MinCapacity !== undefined) t.min = s.action.MinCapacity;
      if (s.action.MaxCapacity !== undefined) t.max = s.action.MaxCapacity;
      if (t.min > t.max) t.max = t.min;
      record(a, t, at, `Setting min capacity to ${t.min} and max capacity to ${t.max}`, `maximum capacity was set to ${t.max} and minimum capacity was set to ${t.min} by scheduled action ${s.name}`, `Successfully set min capacity to ${t.min} and max capacity to ${t.max}`);
      clampDesired(a, region, t, svc, at, `scheduled action ${s.name} changed the capacity limits`);
    }
  }
  clampDesired(a, region, t, svc, at, 'the desired count was outside the minimum and maximum capacity');
  const load = ecsLoad(a, region, svc, at);
  const launching = load.live > load.serving;
  for (const p of Object.values(t.policies)) {
    if (p.tt) {
      const kind = p.tt.PredefinedMetricSpecification?.PredefinedMetricType;
      if (kind === 'ALBRequestCountPerTarget' && p.tt.PredefinedMetricSpecification?.ResourceLabel !== albLabel(a, region, svc)) continue; // la etiqueta no encaja: la métrica no tiene datos
      const metric = kind === 'ALBRequestCountPerTarget' ? load.perTargetMin : kind === 'ECSServiceAverageMemoryUtilization' ? load.mem : load.cpu;
      const T = p.tt.TargetValue;
      if (!load.serving) continue;
      const alarmName = p.alarms[0]?.AlarmName ?? p.name;
      if (metric > T) {
        t.lowMinutes = 0;
        const want = Math.ceil((load.serving * metric) / T);
        if (!t.suspended.DynamicScalingOutSuspended && !launching && want > svc.desiredCount && at - t.lastOut >= p.tt.ScaleOutCooldown * 1000) {
          if (setCount(a, t, svc, want, at, `monitor alarm ${alarmName} in state ALARM triggered policy ${p.name}`)) t.lastOut = at;
        }
      } else if (metric < T * 0.9 && !p.tt.DisableScaleIn) {
        t.lowMinutes++;
        if (t.lowMinutes >= 15) {
          const want = Math.max(t.min, Math.ceil((load.serving * metric) / T));
          if (!t.suspended.DynamicScalingInSuspended && want < svc.desiredCount && at - Math.max(t.lastIn, t.lastOut) >= p.tt.ScaleInCooldown * 1000) {
            if (setCount(a, t, svc, want, at, `monitor alarm ${p.alarms[1]?.AlarmName ?? p.name} in state ALARM triggered policy ${p.name}`)) t.lastIn = at;
          }
          t.lowMinutes = 0;
        }
      } else t.lowMinutes = 0;
    } else if (p.step) {
      for (const al of Object.values(regional(a, region).alarms)) {
        if (!al.AlarmActions.includes(p.arn)) continue;
        const pts = metricSeries(a, region, { ns: al.Namespace, metric: al.MetricName, dims: Object.fromEntries((al.Dimensions as { Name: string; Value: string }[]).map((d) => [d.Name, d.Value])) });
        if (!pts || evalAlarm(al, pts, at) !== 'ALARM') continue;
        const val = pts.length ? pts[pts.length - 1].v : al.Threshold;
        const breach = val - al.Threshold;
        const s = p.step.StepAdjustments.find((x) => (x.MetricIntervalLowerBound === undefined || breach >= x.MetricIntervalLowerBound) && (x.MetricIntervalUpperBound === undefined || breach < x.MetricIntervalUpperBound));
        if (!s) continue;
        const dir = s.ScalingAdjustment >= 0 ? 'out' : 'in';
        if ((dir === 'out' && t.suspended.DynamicScalingOutSuspended) || (dir === 'in' && t.suspended.DynamicScalingInSuspended)) continue;
        if (at - Math.max(t.lastIn, t.lastOut) < p.step.Cooldown * 1000) continue;
        const cur = svc.desiredCount;
        const adj = s.ScalingAdjustment;
        const next = p.step.AdjustmentType === 'PercentChangeInCapacity' ? cur + (adj >= 0 ? Math.max(1, Math.ceil((cur * adj) / 100)) : -Math.max(1, Math.ceil((cur * -adj) / 100))) : p.step.AdjustmentType === 'ExactCapacity' ? adj : cur + adj;
        if (setCount(a, t, svc, next, at, `monitor alarm ${al.AlarmName} in state ALARM triggered policy ${p.name}`)) {
          if (dir === 'out') t.lastOut = at;
          else t.lastIn = at;
        }
        break;
      }
    }
  }
}

function tickAas(a: Account) {
  for (const [region, r] of Object.entries(a.regions)) {
    const targets = r.aas?.targets;
    if (!targets) continue;
    for (const tg of Object.values(targets)) {
      let at = Math.max(tg.lastEval, a.clock - 720 * MIN);
      for (;;) {
        const next = (Math.floor(at / MIN) + 1) * MIN;
        if (next > a.clock) break;
        at = next;
        advanceEcs(a, at);
        stepTarget(a, region, tg, at);
      }
      tg.lastEval = Math.max(tg.lastEval, at);
    }
  }
}

ecsHooks.push(tickAas);
