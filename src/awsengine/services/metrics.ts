/**
 * CloudWatch: métricas de lo que simula la cuenta (CPU de los grupos de Auto Scaling, peticiones de los balanceadores)
 * y evaluación de las alarmas que las vigilan. Otros servicios añaden proveedores con `metricProviders`.
 */
import { regional } from '../account';
import { AwsError, op } from '../registry';
import { tickers } from '../tick';
import type { Account, Alarm } from '../types';
import { iso, isoZ, mkArn, parseDate } from '../util';
import { elb, rpsAt, healthyTargets } from './elb';

export interface Point {
  /** Minuto (ms de reloj virtual). */
  t: number;
  v: number;
}

export interface MetricQuery {
  ns: string;
  metric: string;
  dims: Record<string, string>;
}

/** Cada proveedor devuelve la serie por minuto (de más antiguo a más reciente) o null si no es su métrica. */
export const metricProviders: ((a: Account, region: string, q: MetricQuery) => Point[] | null)[] = [];

const MIN = 60000;
const dimsOf = (list: { Name: string; Value: string }[] | undefined): Record<string, string> => Object.fromEntries((list ?? []).map((d) => [d.Name, d.Value]));

export function metricSeries(a: Account, region: string, q: MetricQuery): Point[] | null {
  for (const p of metricProviders) {
    const s = p(a, region, q);
    if (s) return s;
  }
  return null;
}

// ───────────────────────── proveedores: EC2 y ELB ─────────────────────────

metricProviders.push((a, region, q) => {
  const now = Math.floor(a.clock / MIN) * MIN;
  const asgs = Object.values(regional(a, region).asg?.groups ?? {});
  if (q.ns === 'AWS/EC2' && q.metric === 'CPUUtilization') {
    const g = q.dims.AutoScalingGroupName ? asgs.find((x) => x.AutoScalingGroupName === q.dims.AutoScalingGroupName) : q.dims.InstanceId ? asgs.find((x) => x.instances.some((i) => i.InstanceId === q.dims.InstanceId)) : undefined;
    if (g) return g.history.map((h) => ({ t: h.t, v: h.cpu }));
    if (q.dims.InstanceId) {
      const i = regional(a, region).ec2.instances[q.dims.InstanceId];
      if (!i) return [];
      const start = Math.max(Date.parse(i.LaunchTime), now - 60 * MIN);
      const pts: Point[] = [];
      for (let t = Math.ceil(start / MIN) * MIN; t <= now && i.state === 'running'; t += MIN) pts.push({ t, v: 2 + ((t / MIN) % 5) * 0.4 });
      return pts;
    }
    return [];
  }
  if (q.ns === 'AWS/ApplicationELB' || q.ns === 'AWS/NetworkELB') {
    const lb = Object.values(elb(a, region).lbs).find((l) => l.LoadBalancerArn.endsWith(q.dims.LoadBalancer ?? '\u0000'));
    if (!lb) return [];
    const tg = q.dims.TargetGroup ? Object.values(elb(a, region).tgs).find((t) => t.TargetGroupArn.endsWith(q.dims.TargetGroup)) : undefined;
    const pts: Point[] = [];
    const from = Math.max(lb.createdAt, now - 180 * MIN);
    for (let t = Math.ceil(from / MIN) * MIN; t <= now; t += MIN) {
      if (q.metric === 'RequestCount' || q.metric === 'ProcessedBytes') pts.push({ t, v: rpsAt(a, lb.LoadBalancerArn, t) * 60 });
      else if (q.metric === 'HealthyHostCount' && tg) pts.push({ t, v: healthyTargets(a, region, tg).length });
      else if (q.metric === 'UnHealthyHostCount' && tg) pts.push({ t, v: tg.targets.length - healthyTargets(a, region, tg).length });
      else if (q.metric === 'TargetResponseTime') pts.push({ t, v: 0.012 + Math.min(1.5, rpsAt(a, lb.LoadBalancerArn, t) / 4000) });
      else if (q.metric === 'RequestCountPerTarget' && tg) pts.push({ t, v: (rpsAt(a, lb.LoadBalancerArn, t) * 60) / Math.max(1, tg.targets.length) });
      else return null;
    }
    return pts;
  }
  return null;
});

// ───────────────────────── agregación y alarmas ─────────────────────────

export function aggregate(pts: Point[], stat: string, from: number, to: number): number | undefined {
  const inside = pts.filter((p) => p.t >= from && p.t < to);
  if (!inside.length) return undefined;
  const vs = inside.map((p) => p.v);
  if (stat === 'Sum') return vs.reduce((x, y) => x + y, 0);
  if (stat === 'Maximum') return Math.max(...vs);
  if (stat === 'Minimum') return Math.min(...vs);
  if (stat === 'SampleCount') return vs.length;
  return vs.reduce((x, y) => x + y, 0) / vs.length;
}

const breaches = (op_: string, v: number, th: number) => (op_ === 'GreaterThanThreshold' ? v > th : op_ === 'GreaterThanOrEqualToThreshold' ? v >= th : op_ === 'LessThanThreshold' ? v < th : v <= th);

/** Estado de una alarma en el instante `t` según la serie de su métrica. */
export function evalAlarm(al: Pick<Alarm, 'Statistic' | 'Period' | 'EvaluationPeriods' | 'Threshold' | 'ComparisonOperator' | 'TreatMissingData'>, pts: Point[], t: number): Alarm['StateValue'] {
  const period = Math.max(1, al.Period) * 1000;
  let breaching = 0;
  let missing = 0;
  for (let k = 0; k < al.EvaluationPeriods; k++) {
    const to = t + MIN - k * period;
    const v = aggregate(pts, al.Statistic, to - period, to);
    if (v === undefined) missing++;
    else if (breaches(al.ComparisonOperator, v, al.Threshold)) breaching++;
  }
  if (breaching === al.EvaluationPeriods) return 'ALARM';
  if (missing === al.EvaluationPeriods && al.TreatMissingData !== 'notBreaching') return 'INSUFFICIENT_DATA';
  if (al.TreatMissingData === 'breaching' && breaching + missing === al.EvaluationPeriods) return 'ALARM';
  return 'OK';
}

/** Estado actual de una alarma cuya métrica sabe calcular el simulador (o null si no). */
export function liveAlarmState(a: Account, region: string, al: Alarm): Alarm['StateValue'] | null {
  const pts = metricSeries(a, region, { ns: al.Namespace, metric: al.MetricName, dims: dimsOf(al.Dimensions as { Name: string; Value: string }[]) });
  if (!pts) return null;
  return evalAlarm(al, pts, Math.floor(a.clock / MIN) * MIN);
}

// ───────────────────────── operaciones ─────────────────────────

const STATS = ['Average', 'Sum', 'SampleCount', 'Maximum', 'Minimum'];
const UNIT: Record<string, string> = { CPUUtilization: 'Percent', RequestCount: 'Count', HealthyHostCount: 'Count', UnHealthyHostCount: 'Count', TargetResponseTime: 'Seconds', RequestCountPerTarget: 'Count' };

op('cloudwatch', 'get-metric-statistics', 'namespace:s! metric-name:s! dimensions:f start-time:s! end-time:s! period:i! statistics:l extended-statistics:l unit:s', 'Valores de una métrica agrupados por periodos (CPU de un grupo de Auto Scaling, peticiones de un balanceador…).', { res: () => '*', action: 'cloudwatch:GetMetricStatistics' }, (c) => {
  const start = parseDate(String(c.p.StartTime));
  const end = parseDate(String(c.p.EndTime));
  if (Number.isNaN(start) || Number.isNaN(end)) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be a valid timestamp.', 400);
  if (end <= start) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be less than the parameter EndTime.', 400);
  const period = c.p.Period as number;
  if (period < 1 || period % 60 !== 0) throw new AwsError('InvalidParameterCombination', 'Period must be a multiple of 60', 400);
  const stats: string[] = c.p.Statistics ?? [];
  if (!stats.length && !c.p.ExtendedStatistics) throw new AwsError('InvalidParameterCombination', 'The parameter Statistics or ExtendedStatistics is required.', 400);
  for (const s of stats) if (!STATS.includes(s)) throw new AwsError('InvalidParameterValue', `Invalid statistic: ${s}`, 400);
  const pts = metricSeries(c.acct, c.region, { ns: c.p.Namespace, metric: c.p.MetricName, dims: dimsOf(c.p.Dimensions) }) ?? [];
  const out: Record<string, unknown>[] = [];
  const first = Math.floor(start / (period * 1000)) * period * 1000;
  for (let t = first; t < end; t += period * 1000) {
    const row: Record<string, unknown> = {};
    for (const s of stats) {
      const v = aggregate(pts, s, t, t + period * 1000);
      if (v !== undefined) row[s] = Math.round(v * 1000) / 1000;
    }
    if (Object.keys(row).length) out.push({ Timestamp: iso(t), ...row, Unit: c.p.Unit ?? UNIT[c.p.MetricName] ?? 'None' });
  }
  return { Label: c.p.MetricName, Datapoints: out };
});

op('cloudwatch', 'list-metrics', 'namespace:s metric-name:s dimensions:f', 'Lista las métricas disponibles (las de EC2, Auto Scaling y balanceadores).', { paginate: 'Metrics', res: () => '*', action: 'cloudwatch:ListMetrics' }, (c) => {
  const out: { Namespace: string; MetricName: string; Dimensions: { Name: string; Value: string }[] }[] = [];
  const r = regional(c.acct, c.region);
  for (const g of Object.values(r.asg?.groups ?? {})) out.push({ Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'AutoScalingGroupName', Value: g.AutoScalingGroupName }] });
  for (const i of Object.values(r.ec2.instances)) if (i.state === 'running') out.push({ Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'InstanceId', Value: i.InstanceId }] });
  for (const lb of Object.values(r.elb?.lbs ?? {})) {
    const seg = lb.LoadBalancerArn.split('loadbalancer/')[1];
    for (const m of ['RequestCount', 'TargetResponseTime', 'ProcessedBytes']) out.push({ Namespace: lb.Type === 'network' ? 'AWS/NetworkELB' : 'AWS/ApplicationELB', MetricName: m, Dimensions: [{ Name: 'LoadBalancer', Value: seg }] });
  }
  return { Metrics: out.filter((m) => (!c.p.Namespace || m.Namespace === c.p.Namespace) && (!c.p.MetricName || m.MetricName === c.p.MetricName)) };
});

// ───────────────────────── alarmas: estado y acciones ─────────────────────────

/** Cada minuto de reloj virtual se revisa el estado de las alarmas; al cambiar a ALARM se avisa a los temas SNS. */
tickers.push((a) => {
  for (const reg of Object.keys(a.regions)) {
    const r = a.regions[reg];
    for (const al of Object.values(r.alarms)) {
      const st = liveAlarmState(a, reg, al);
      if (!st || st === al.StateValue) continue;
      const before = al.StateValue;
      al.StateValue = st;
      if (st !== 'ALARM') continue;
      for (const act of al.AlarmActions) {
        const topic = r.sns[act];
        if (topic) topic.messages.push(JSON.stringify({ AlarmName: al.AlarmName, NewStateValue: st, OldStateValue: before, NewStateReason: 'Threshold Crossed', StateChangeTime: isoZ(a.clock), Region: reg, AWSAccountId: a.id, AlarmArn: mkArn('cloudwatch', reg, a.id, `alarm:${al.AlarmName}`) }));
      }
    }
  }
});
