/**
 * CloudWatch: métricas de lo que simula la cuenta (CPU de los grupos de Auto Scaling, peticiones de los balanceadores)
 * y evaluación de las alarmas que las vigilan. Otros servicios añaden proveedores con `metricProviders`.
 */
import { regional } from '../account';
import { AwsError, op } from '../registry';
import { tickers } from '../tick';
import type { Account, Alarm } from '../types';
import { iso, parseDate } from '../util';
import { cwFind, cwOf } from './cwdata';
import { elb, rpsAt, healthyTargets } from './elb';

export interface Point {
  /** Minuto (ms de reloj virtual). */
  t: number;
  v: number;
  /** Solo en las métricas propias: varias muestras agrupadas (suma, cuántas, mínimo y máximo). */
  sum?: number;
  n?: number;
  min?: number;
  max?: number;
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
  // una métrica propia (espacio de nombres que no empieza por «AWS/») sin datos es una serie vacía, no una métrica desconocida
  return q.ns.startsWith('AWS/') ? null : [];
}

// ───────────────────────── métricas propias (put-metric-data) y las que registran los servicios ─────────────────────────

metricProviders.push((a, region, q) => {
  const m = cwFind(a, region, q.ns, q.metric, q.dims);
  if (!m) return null;
  return m.samples.map((x) => ({ t: x.t, v: x.n ? x.sum / x.n : 0, sum: x.sum, n: x.n, min: x.min, max: x.max }));
});

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

/** Percentil `p` (0–100) de las muestras, ponderadas por cuántas representa cada punto. */
function percentile(inside: Point[], p: number): number {
  const items = inside.map((x) => ({ v: x.n && x.n > 1 && x.min !== undefined && x.max !== undefined && x.min !== x.max ? (x.sum ?? x.v * x.n) / x.n : x.v, w: x.n ?? 1 })).sort((x, y) => x.v - y.v);
  const total = items.reduce((n, x) => n + x.w, 0);
  const rank = (p / 100) * total;
  let acc = 0;
  for (const it of items) {
    acc += it.w;
    if (acc >= rank) return it.v;
  }
  return items[items.length - 1].v;
}

export function aggregate(pts: Point[], stat: string, from: number, to: number): number | undefined {
  const inside = pts.filter((p) => p.t >= from && p.t < to);
  if (!inside.length) return undefined;
  const count = (x: Point) => x.n ?? 1;
  const sum = (x: Point) => x.sum ?? x.v;
  if (stat === 'Sum') return inside.reduce((n, x) => n + sum(x), 0);
  if (stat === 'Maximum') return Math.max(...inside.map((x) => x.max ?? x.v));
  if (stat === 'Minimum') return Math.min(...inside.map((x) => x.min ?? x.v));
  if (stat === 'SampleCount') return inside.reduce((n, x) => n + count(x), 0);
  const pc = /^p(\d+(?:\.\d+)?)$/.exec(stat);
  if (pc) return percentile(inside, Number(pc[1]));
  return inside.reduce((n, x) => n + sum(x), 0) / inside.reduce((n, x) => n + count(x), 0);
}

const breaches = (op_: string, v: number, th: number) => (op_ === 'GreaterThanThreshold' ? v > th : op_ === 'GreaterThanOrEqualToThreshold' ? v >= th : op_ === 'LessThanThreshold' ? v < th : v <= th);

export interface AlarmEval {
  state: Alarm['StateValue'];
  /** Valor de cada periodo evaluado, del más reciente al más antiguo (`undefined` = sin datos). */
  values: (number | undefined)[];
  breaching: number;
  missing: number;
  /** Hay que dejar la alarma como está (`TreatMissingData: ignore` sin datos suficientes). */
  keep?: boolean;
}

/** Evaluación detallada de una alarma en el instante `t` según la serie de su métrica. */
export function evalAlarmDetail(al: Pick<Alarm, 'Statistic' | 'Period' | 'EvaluationPeriods' | 'Threshold' | 'ComparisonOperator' | 'TreatMissingData'> & { DatapointsToAlarm?: number; ExtendedStatistic?: string }, pts: Point[], t: number, cur?: Alarm['StateValue']): AlarmEval {
  const period = Math.max(1, al.Period) * 1000;
  const need = Math.min(al.DatapointsToAlarm ?? al.EvaluationPeriods, al.EvaluationPeriods);
  const stat = al.ExtendedStatistic ?? al.Statistic;
  const values: (number | undefined)[] = [];
  let breaching = 0;
  let missing = 0;
  for (let k = 0; k < al.EvaluationPeriods; k++) {
    const to = t + MIN - k * period;
    const v = aggregate(pts, stat, to - period, to);
    values.push(v);
    if (v === undefined) missing++;
    else if (breaches(al.ComparisonOperator, v, al.Threshold)) breaching++;
  }
  const policy = al.TreatMissingData ?? 'missing';
  const breachingTotal = breaching + (policy === 'breaching' ? missing : 0);
  const okTotal = al.EvaluationPeriods - breaching - missing + (policy === 'notBreaching' ? missing : 0);
  let state: Alarm['StateValue'];
  if (breachingTotal >= need) state = 'ALARM';
  else if (missing === al.EvaluationPeriods && policy !== 'notBreaching' && policy !== 'breaching') {
    // sin ningún dato: «missing» → INSUFFICIENT_DATA; «ignore» → se mantiene el estado
    if (policy === 'ignore' && cur) return { state: cur, values, breaching, missing, keep: true };
    state = 'INSUFFICIENT_DATA';
  } else if (okTotal > 0 || policy === 'notBreaching') state = 'OK';
  else if (policy === 'ignore' && cur) return { state: cur, values, breaching, missing, keep: true };
  else state = 'OK';
  return { state, values, breaching, missing };
}

/** Estado de una alarma en el instante `t` según la serie de su métrica. */
export function evalAlarm(al: Parameters<typeof evalAlarmDetail>[0], pts: Point[], t: number, cur?: Alarm['StateValue']): Alarm['StateValue'] {
  return evalAlarmDetail(al, pts, t, cur).state;
}

/** Alarmas con una lógica propia (la de facturación mira el gasto estimado, no una serie): devuelven el estado o null. */
export const alarmStateHooks: ((a: Account, region: string, al: Alarm) => Alarm['StateValue'] | null)[] = [];

/** Estado actual de una alarma cuya métrica sabe calcular el simulador (o null si no). */
export function liveAlarmState(a: Account, region: string, al: Alarm): Alarm['StateValue'] | null {
  for (const h of alarmStateHooks) {
    const st = h(a, region, al);
    if (st) return st;
  }
  const pts = metricSeries(a, region, { ns: al.Namespace, metric: al.MetricName, dims: dimsOf(al.Dimensions as { Name: string; Value: string }[]) });
  if (!pts) return null;
  return evalAlarm(al, pts, Math.floor(a.clock / MIN) * MIN, al.StateValue);
}

// ───────────────────────── operaciones ─────────────────────────

const STATS = ['Average', 'Sum', 'SampleCount', 'Maximum', 'Minimum'];
const UNIT: Record<string, string> = { CPUUtilization: 'Percent', RequestCount: 'Count', HealthyHostCount: 'Count', UnHealthyHostCount: 'Count', TargetResponseTime: 'Seconds', RequestCountPerTarget: 'Count' };

op('cloudwatch', 'get-metric-statistics', 'namespace:s! metric-name:s! dimensions:f start-time:s! end-time:s! period:i! statistics:l extended-statistics:l unit:s', 'Valores de una métrica agrupados por periodos (CPU de un grupo de Auto Scaling, peticiones de un balanceador, tus métricas propias…).', { res: () => '*', action: 'cloudwatch:GetMetricStatistics' }, (c) => {
  const start = parseDate(String(c.p.StartTime));
  const end = parseDate(String(c.p.EndTime));
  if (Number.isNaN(start) || Number.isNaN(end)) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be a valid timestamp.', 400);
  if (end <= start) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be less than the parameter EndTime.', 400);
  const period = c.p.Period as number;
  if (period < 1 || period % 60 !== 0) throw new AwsError('InvalidParameterCombination', 'Period must be a multiple of 60', 400);
  const stats: string[] = c.p.Statistics ?? [];
  const ext: string[] = c.p.ExtendedStatistics ?? [];
  if (!stats.length && !ext.length) throw new AwsError('MissingParameter', 'The parameter Statistics or ExtendedStatistics is required.', 400);
  if (stats.length && ext.length) throw new AwsError('InvalidParameterCombination', 'The parameters Statistics and ExtendedStatistics are mutually exclusive.', 400);
  for (const s of stats) if (!STATS.includes(s)) throw new AwsError('InvalidParameterValue', `Invalid statistic: ${s}`, 400);
  for (const s of ext) if (!/^p\d+(\.\d+)?$/.test(s)) throw new AwsError('InvalidParameterValue', `Invalid extended statistic: ${s}`, 400);
  if ((end - start) / (period * 1000) > 1440) throw new AwsError('InvalidParameterCombination', `You have requested up to ${Math.ceil((end - start) / (period * 1000))} datapoints, which exceeds the limit of 1440. You may reduce the datapoints requested by increasing Period, or decreasing the time range.`, 400);
  const pts = metricSeries(c.acct, c.region, { ns: c.p.Namespace, metric: c.p.MetricName, dims: dimsOf(c.p.Dimensions) }) ?? [];
  const out: Record<string, unknown>[] = [];
  const first = Math.floor(start / (period * 1000)) * period * 1000;
  const unit = c.p.Unit ?? cwFind(c.acct, c.region, c.p.Namespace, c.p.MetricName, dimsOf(c.p.Dimensions))?.unit ?? UNIT[c.p.MetricName] ?? 'None';
  for (let t = first; t < end; t += period * 1000) {
    const row: Record<string, unknown> = {};
    for (const s of stats) {
      const v = aggregate(pts, s, t, t + period * 1000);
      if (v !== undefined) row[s] = Math.round(v * 1000) / 1000;
    }
    if (ext.length) {
      const e: Record<string, number> = {};
      for (const s of ext) {
        const v = aggregate(pts, s, t, t + period * 1000);
        if (v !== undefined) e[s] = Math.round(v * 1000) / 1000;
      }
      if (Object.keys(e).length) row.ExtendedStatistics = e;
    }
    if (Object.keys(row).length) out.push({ Timestamp: iso(t), ...row, Unit: unit });
  }
  return { Label: c.p.MetricName, Datapoints: out };
});

op('cloudwatch', 'list-metrics', 'namespace:s metric-name:s dimensions:f', 'Lista las métricas disponibles (las de EC2, Auto Scaling, balanceadores y las que publicas tú).', { paginate: 'Metrics', res: () => '*', action: 'cloudwatch:ListMetrics' }, (c) => {
  const out: { Namespace: string; MetricName: string; Dimensions: { Name: string; Value: string }[] }[] = [];
  const r = regional(c.acct, c.region);
  for (const g of Object.values(r.asg?.groups ?? {})) out.push({ Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'AutoScalingGroupName', Value: g.AutoScalingGroupName }] });
  for (const i of Object.values(r.ec2.instances)) if (i.state === 'running') out.push({ Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'InstanceId', Value: i.InstanceId }] });
  for (const lb of Object.values(r.elb?.lbs ?? {})) {
    const seg = lb.LoadBalancerArn.split('loadbalancer/')[1];
    for (const m of ['RequestCount', 'TargetResponseTime', 'ProcessedBytes']) out.push({ Namespace: lb.Type === 'network' ? 'AWS/NetworkELB' : 'AWS/ApplicationELB', MetricName: m, Dimensions: [{ Name: 'LoadBalancer', Value: seg }] });
  }
  for (const m of Object.values(cwOf(c.acct, c.region).metrics)) out.push({ Namespace: m.ns, MetricName: m.name, Dimensions: Object.entries(m.dims).map(([Name, Value]) => ({ Name, Value })) });
  const want = c.p.Dimensions as { Name: string; Value?: string }[] | undefined;
  return {
    Metrics: out.filter(
      (m) =>
        (!c.p.Namespace || m.Namespace === c.p.Namespace) &&
        (!c.p.MetricName || m.MetricName === c.p.MetricName) &&
        (!want || want.every((d) => m.Dimensions.some((x) => x.Name === d.Name && (d.Value === undefined || x.Value === d.Value)))),
    ),
  };
});

// ───────────────────────── alarmas: estado y acciones ─────────────────────────

/** El motor de alarmas (estados, historial y acciones) lo aporta `cwalarms.ts`; se engancha aquí para conservar el orden de los tickers. */
export const alarmEngine: { tick: (a: Account) => void; before: ((a: Account) => void)[] } = { tick: () => undefined, before: [] };
tickers.push((a) => {
  // primero los muestreos (colas de SQS…), para que las alarmas vean los datos de este minuto
  for (const f of alarmEngine.before) f(a);
  alarmEngine.tick(a);
});
