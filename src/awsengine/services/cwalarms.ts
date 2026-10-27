/**
 * CloudWatch: alarmas. Evaluación (también con matemática de métricas), estados, historial, acciones (SNS, EC2, Auto Scaling),
 * alarmas compuestas y los eventos «CloudWatch Alarm State Change» que reciben las reglas de EventBridge.
 */
import { regional } from '../account';
import { REGIONS } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import { sdkCall } from '../sdk';
import type { Account, Alarm } from '../types';
import type { CwComposite, CwHistory } from '../types-ops';
import { iso, mkArn } from '../util';
import { cwOf } from './cwdata';
import { evalQueries, type MQuery } from './cwmath';
import { putEvent } from './events';
import { alarmEngine, alarmStateHooks, evalAlarmDetail, metricSeries, type AlarmEval, type Point } from './metrics';
import { estimatedCharges } from './misc';
import { snsPublish } from './sns';

const MIN = 60000;
const COMPARATORS = ['GreaterThanOrEqualToThreshold', 'GreaterThanThreshold', 'LessThanThreshold', 'LessThanOrEqualToThreshold', 'LessThanLowerOrGreaterThanUpperThreshold', 'LessThanLowerThreshold', 'GreaterThanUpperThreshold'];
const PHRASE: Record<string, [string, string]> = {
  GreaterThanThreshold: ['greater than', 'not greater than'],
  GreaterThanOrEqualToThreshold: ['greater than or equal to', 'not greater than or equal to'],
  LessThanThreshold: ['less than', 'not less than'],
  LessThanOrEqualToThreshold: ['less than or equal to', 'not less than or equal to'],
};

const dimsOf = (list: { Name: string; Value: string }[] | undefined): Record<string, string> => Object.fromEntries((list ?? []).map((d) => [d.Name, d.Value]));
const alarmArn = (acct: Account, region: string, name: string) => mkArn('cloudwatch', region, acct.id, `alarm:${name}`);
const regionName = (code: string) => REGIONS.find((r) => r.code === code)?.name ?? code;

/** `27/10/26 11:03:00` (el formato de los motivos de estado). */
const stamp = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCFullYear() % 100)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

// ───────────────────────── evaluación ─────────────────────────

alarmStateHooks.push((a, region, al) => {
  if (al.Namespace !== 'AWS/Billing' || al.MetricName !== 'EstimatedCharges') return null;
  if (region !== 'us-east-1') return 'INSUFFICIENT_DATA';
  return estimatedCharges(a) > al.Threshold ? 'ALARM' : 'OK';
});

/** La consulta que decide una alarma de matemática de métricas (la que devuelve datos). */
const returnQuery = (al: Alarm): NonNullable<Alarm['Metrics']>[number] | undefined => al.Metrics?.find((q) => q.ReturnData !== false && (q.Expression || q.MetricStat)) ?? al.Metrics?.[0];

/** Serie que mira la alarma: la de su métrica o el resultado de su expresión. `null` = el simulador no conoce esa métrica. */
function alarmSeries(a: Account, region: string, al: Alarm, t: number): Point[] | null {
  if (al.Metrics?.length) {
    const rq = returnQuery(al)!;
    const period = (rq.MetricStat?.Period ?? rq.Period ?? al.Period ?? 60) * 1000;
    const end = t + MIN;
    const start = end - (al.EvaluationPeriods + 1) * period;
    const res = evalQueries({ a, region, start, end, anchor: end, period: period / 1000 }, al.Metrics as MQuery[]);
    const r = res.get(rq.Id);
    if (!r) return [];
    return r.Series.ts.map((tt, i) => ({ t: tt, v: r.Series.vs[i] }));
  }
  return metricSeries(a, region, { ns: al.Namespace, metric: al.MetricName, dims: dimsOf(al.Dimensions as { Name: string; Value: string }[]) });
}

interface Verdict {
  state: Alarm['StateValue'];
  reason: string;
  data?: string;
}

/** Estado que corresponde ahora a una alarma (o null si el simulador no sabe calcularlo y se queda como está). */
function judge(a: Account, region: string, al: Alarm): Verdict | null {
  const t = Math.floor(a.clock / MIN) * MIN;
  for (const h of alarmStateHooks) {
    const st = h(a, region, al);
    if (st) return { state: st, reason: st === 'INSUFFICIENT_DATA' ? 'Insufficient Data: 1 datapoint was unknown.' : `Threshold Crossed: 1 datapoint [${estimatedCharges(a).toFixed(2)} (${stamp(t)})] was ${st === 'ALARM' ? 'greater' : 'not greater'} than the threshold (${al.Threshold}).` };
  }
  const pts = alarmSeries(a, region, al, t);
  if (!pts) return null;
  const ev = evalAlarmDetail({ ...al, Period: al.Period ?? 60 }, pts, t, al.StateValue);
  if (ev.keep) return null;
  return { state: ev.state, ...explain(al, ev, t) };
}

function explain(al: Alarm, ev: AlarmEval, t: number): { reason: string; data?: string } {
  const period = Math.max(1, al.Period ?? 60) * 1000;
  const N = al.EvaluationPeriods;
  const M = Math.min(al.DatapointsToAlarm ?? N, N);
  if (ev.state === 'INSUFFICIENT_DATA') return { reason: `Insufficient Data: ${N} datapoint${N === 1 ? '' : 's'} ${N === 1 ? 'was' : 'were'} unknown.` };
  const [yes, no] = PHRASE[al.ComparisonOperator] ?? PHRASE.GreaterThanThreshold;
  const rows = ev.values.map((v, k) => ({ v, at: t + MIN - (k + 1) * period })).filter((x) => x.v !== undefined) as { v: number; at: number }[];
  const picked = ev.state === 'ALARM' ? rows.filter((x) => (al.ComparisonOperator === 'GreaterThanThreshold' ? x.v > al.Threshold : al.ComparisonOperator === 'GreaterThanOrEqualToThreshold' ? x.v >= al.Threshold : al.ComparisonOperator === 'LessThanThreshold' ? x.v < al.Threshold : x.v <= al.Threshold)) : rows;
  const count = ev.state === 'ALARM' ? ev.breaching : rows.length - ev.breaching;
  const list = picked.map((x) => `${Number.isInteger(x.v) ? x.v.toFixed(1) : String(Math.round(x.v * 1000) / 1000)} (${stamp(x.at)})`).join(', ');
  const verb = picked.length === 1 ? 'was' : 'were';
  const reason =
    ev.state === 'ALARM'
      ? `Threshold Crossed: ${count} out of the last ${N} datapoints [${list}] ${verb} ${yes} the threshold (${al.Threshold.toFixed(1)}) (minimum ${M} datapoint${M === 1 ? '' : 's'} for OK -> ALARM transition).`
      : `Threshold Crossed: ${count} out of the last ${N} datapoints [${list}] ${verb} ${no} the threshold (${al.Threshold.toFixed(1)}) (minimum ${M} datapoint${M === 1 ? '' : 's'} for ALARM -> OK transition).`;
  const data = JSON.stringify({ version: '1.0', queryDate: iso(t + MIN).replace('+00:00', '.000+0000'), startDate: iso(t + MIN - N * period).replace('+00:00', '.000+0000'), statistic: al.ExtendedStatistic ?? al.Statistic, period: al.Period, recentDatapoints: rows.map((x) => x.v).reverse(), threshold: al.Threshold, evaluatedDatapoints: rows.reverse().map((x) => ({ timestamp: iso(x.at).replace('+00:00', '.000+0000'), value: x.v })) });
  return { reason, data };
}

// ───────────────────────── historial ─────────────────────────

function history(a: Account, region: string, alarm: string, type: CwHistory['type'], item: CwHistory['item'], summary: string, data: unknown): void {
  const h = cwOf(a, region).history;
  h.push({ alarm, type, t: a.clock, item, summary, data: JSON.stringify(data) });
  if (h.length > 2000) h.splice(0, h.length - 2000);
}

// ───────────────────────── acciones ─────────────────────────

interface Notifiable {
  AlarmName: string;
  AlarmDescription?: string;
  AlarmActions: string[];
  OKActions?: string[];
  InsufficientDataActions?: string[];
}

function runAction(a: Account, region: string, name: string, type: CwHistory['type'], action: string, al: Alarm | undefined, view: Notifiable, from: string, to: Alarm['StateValue'], reason: string, reasonData?: string): void {
  const ok = (extra: Record<string, unknown> = {}) => history(a, region, name, type, 'Action', `Successfully executed action ${action}`, { actionState: 'Succeeded', notificationResource: action, ...extra });
  const fail = (why: string) => history(a, region, name, type, 'Action', `Failed to execute action ${action}. Received error: "${why}"`, { actionState: 'Failed', notificationResource: action });
  const at = action.split(':');
  if (action.startsWith('arn:aws:sns:')) {
    const topic = regional(a, at[3]).sns[action];
    if (!topic) return fail(`Topic does not exist (Service: AmazonSNS; Status Code: 404; Error Code: NotFound)`);
    const body = {
      AlarmName: name,
      AlarmDescription: view.AlarmDescription ?? null,
      AWSAccountId: a.id,
      AlarmConfigurationUpdatedTimestamp: iso(a.clock).replace('+00:00', '.000+0000'),
      NewStateValue: to,
      NewStateReason: reason,
      StateChangeTime: iso(a.clock).replace('+00:00', '.000+0000'),
      Region: regionName(region),
      AlarmArn: alarmArn(a, region, name),
      OldStateValue: from,
      OKActions: view.OKActions ?? [],
      AlarmActions: view.AlarmActions,
      InsufficientDataActions: view.InsufficientDataActions ?? [],
      ...(al
        ? { Trigger: { MetricName: al.MetricName, Namespace: al.Namespace, StatisticType: al.ExtendedStatistic ? 'ExtendedStatistic' : 'Statistic', Statistic: (al.ExtendedStatistic ?? al.Statistic).toUpperCase(), Unit: al.Unit ?? null, Dimensions: al.Dimensions, Period: al.Period, EvaluationPeriods: al.EvaluationPeriods, ComparisonOperator: al.ComparisonOperator, Threshold: al.Threshold, TreatMissingData: al.TreatMissingData ?? 'missing', EvaluateLowSampleCountPercentile: '' } }
        : {}),
      ...(reasonData ? { NewStateReasonData: reasonData } : {}),
    };
    snsPublish(a, at[3], topic, JSON.stringify(body), { subject: `${to === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT DATA' : to}: "${name}" in ${regionName(region)}` });
    return ok();
  }
  const auto = /^arn:aws:automate:([^:]+):ec2:(stop|terminate|reboot|recover)$/.exec(action);
  if (auto) {
    const id = (al?.Dimensions as { Name: string; Value: string }[] | undefined)?.find((d) => d.Name === 'InstanceId')?.Value;
    if (!id) return fail('The alarm has no InstanceId dimension');
    const api = auto[2] === 'stop' ? 'stop-instances' : auto[2] === 'terminate' ? 'terminate-instances' : 'reboot-instances';
    const r = sdkCall(a, auto[1], null, 'ec2', api, { InstanceIds: [id] });
    return r.ok ? ok() : fail(r.error?.Message ?? 'error');
  }
  if (action.startsWith('arn:aws:autoscaling:') || action.startsWith('arn:aws:application-autoscaling:') || action.startsWith('arn:aws:ssm:') || action.startsWith('arn:aws:ssm-incidents:')) return ok();
  fail(`Unsupported action: ${action}`);
}

function runActions(a: Account, region: string, name: string, type: CwHistory['type'], al: Alarm | undefined, view: Notifiable & { ActionsEnabled?: boolean }, from: string, to: Alarm['StateValue'], reason: string, reasonData?: string): void {
  if (view.ActionsEnabled === false) return;
  const list = to === 'ALARM' ? view.AlarmActions : to === 'OK' ? view.OKActions ?? [] : view.InsufficientDataActions ?? [];
  for (const act of list) runAction(a, region, name, type, act, al, view, from, to, reason, reasonData);
}

/** EventBridge recibe cada cambio de estado de una alarma en el bus por defecto. */
function stateEvent(a: Account, region: string, name: string, from: { v: string; reason: string; t: number }, to: { v: string; reason: string; data?: string }, config: Record<string, unknown>): void {
  try {
    putEvent(a, region, 'default', {
      source: 'aws.cloudwatch',
      detailType: 'CloudWatch Alarm State Change',
      resources: [alarmArn(a, region, name)],
      detail: { alarmName: name, state: { value: to.v, reason: to.reason, ...(to.data ? { reasonData: to.data } : {}), timestamp: iso(a.clock).replace('+00:00', '.000+0000') }, previousState: { value: from.v, reason: from.reason, timestamp: iso(from.t).replace('+00:00', '.000+0000') }, configuration: config },
    });
  } catch {
    /* sin reglas o destino inalcanzable */
  }
}

const configOf = (al: Alarm) => ({
  ...(al.AlarmDescription ? { description: al.AlarmDescription } : {}),
  metrics: al.Metrics?.length
    ? al.Metrics.map((q) => ({ id: q.Id, ...(q.Expression ? { expression: q.Expression } : {}), ...(q.MetricStat ? { metricStat: { metric: { namespace: q.MetricStat.Metric.Namespace, name: q.MetricStat.Metric.MetricName, dimensions: dimsOf(q.MetricStat.Metric.Dimensions) }, period: q.MetricStat.Period, stat: q.MetricStat.Stat } } : {}), returnData: q.ReturnData !== false }))
    : [{ id: 'metric1', metricStat: { metric: { namespace: al.Namespace, name: al.MetricName, dimensions: dimsOf(al.Dimensions as { Name: string; Value: string }[]) }, period: al.Period, stat: al.ExtendedStatistic ?? al.Statistic }, returnData: true }],
});

function transition(a: Account, region: string, al: Alarm, to: Alarm['StateValue'], reason: string, data?: string): void {
  const from = al.StateValue;
  const fromReason = al.StateReason ?? '';
  const fromAt = al.StateUpdated ?? a.clock;
  al.StateValue = to;
  al.StateReason = reason;
  al.StateReasonData = data;
  al.StateUpdated = a.clock;
  history(a, region, al.AlarmName, 'MetricAlarm', 'StateUpdate', `Alarm updated from ${from} to ${to}`, { version: '1.0', oldState: { stateValue: from, stateReason: fromReason }, newState: { stateValue: to, stateReason: reason, ...(data ? { stateReasonData: JSON.parse(data) } : {}) } });
  runActions(a, region, al.AlarmName, 'MetricAlarm', al, { ...al, ActionsEnabled: al.ActionsEnabled }, from, to, reason, data);
  stateEvent(a, region, al.AlarmName, { v: from, reason: fromReason, t: fromAt }, { v: to, reason, data }, configOf(al));
}

// ───────────────────────── alarmas compuestas ─────────────────────────

type Rule = { t: 'state'; state: string; name: string } | { t: 'lit'; v: boolean } | { t: 'not'; e: Rule } | { t: 'and' | 'or'; l: Rule; r: Rule };

function parseRule(src: string): Rule {
  const toks = src.match(/ALARM|OK|INSUFFICIENT_DATA|TRUE|FALSE|AND|OR|NOT|\(|\)|"[^"]*"|'[^']*'|[^\s()"']+/g) ?? [];
  let i = 0;
  const fail = (m: string): never => {
    throw new AwsError('ValidationError', `Invalid AlarmRule '${src}': ${m}`, 400);
  };
  function or(): Rule {
    let l = and();
    while (toks[i] === 'OR') {
      i++;
      l = { t: 'or', l, r: and() };
    }
    return l;
  }
  function and(): Rule {
    let l = not();
    while (toks[i] === 'AND') {
      i++;
      l = { t: 'and', l, r: not() };
    }
    return l;
  }
  function not(): Rule {
    if (toks[i] === 'NOT') {
      i++;
      return { t: 'not', e: not() };
    }
    return atom();
  }
  function atom(): Rule {
    const tk = toks[i++];
    if (tk === '(') {
      const e = or();
      if (toks[i++] !== ')') fail('expected ")"');
      return e;
    }
    if (tk === 'TRUE' || tk === 'FALSE') return { t: 'lit', v: tk === 'TRUE' };
    if (tk === 'ALARM' || tk === 'OK' || tk === 'INSUFFICIENT_DATA') {
      if (toks[i++] !== '(') fail(`expected "(" after ${tk}`);
      const n = (toks[i++] ?? '').replace(/^["']|["']$/g, '');
      if (toks[i++] !== ')') fail('expected ")"');
      return { t: 'state', state: tk, name: n.startsWith('arn:') ? n.split(':alarm:')[1] : n };
    }
    return fail(`unexpected "${tk ?? 'end of rule'}"`);
  }
  const r = or();
  if (i < toks.length) fail(`unexpected "${toks[i]}"`);
  return r;
}

const ruleRefs = (r: Rule): string[] => (r.t === 'state' ? [r.name] : r.t === 'not' ? ruleRefs(r.e) : r.t === 'lit' ? [] : [...ruleRefs(r.l), ...ruleRefs(r.r)]);

function ruleHolds(r: Rule, state: (n: string) => string | undefined): boolean {
  if (r.t === 'lit') return r.v;
  if (r.t === 'state') return state(r.name) === r.state;
  if (r.t === 'not') return !ruleHolds(r.e, state);
  return r.t === 'and' ? ruleHolds(r.l, state) && ruleHolds(r.r, state) : ruleHolds(r.l, state) || ruleHolds(r.r, state);
}

function tickComposites(a: Account, region: string): void {
  const st = cwOf(a, region);
  const r = regional(a, region);
  const stateOf = (n: string) => r.alarms[n]?.StateValue ?? st.composites[n]?.StateValue;
  for (const c of Object.values(st.composites)) {
    let rule: Rule;
    try {
      rule = parseRule(c.AlarmRule);
    } catch {
      continue;
    }
    const known = ruleRefs(rule).every((n) => stateOf(n) !== undefined);
    const to: Alarm['StateValue'] = !known ? 'INSUFFICIENT_DATA' : ruleHolds(rule, stateOf) ? 'ALARM' : 'OK';
    if (to === c.StateValue) continue;
    const from = c.StateValue;
    const fromReason = c.StateReason;
    const fromAt = c.StateUpdated;
    const why = to === 'ALARM' ? `arn:aws:cloudwatch:${region}:${a.id}:alarm:${c.AlarmName} triggered: ${c.AlarmRule}` : `The rule ${c.AlarmRule} is no longer true.`;
    c.StateValue = to;
    c.StateReason = why;
    c.StateUpdated = a.clock;
    history(a, region, c.AlarmName, 'CompositeAlarm', 'StateUpdate', `Alarm updated from ${from} to ${to}`, { version: '1.0', oldState: { stateValue: from, stateReason: fromReason }, newState: { stateValue: to, stateReason: why } });
    runActions(a, region, c.AlarmName, 'CompositeAlarm', undefined, c, from, to, why);
    stateEvent(a, region, c.AlarmName, { v: from, reason: fromReason, t: fromAt }, { v: to, reason: why }, { alarmRule: c.AlarmRule, ...(c.AlarmDescription ? { description: c.AlarmDescription } : {}) });
  }
}

// ───────────────────────── el motor, cada minuto ─────────────────────────

/** Alarmas forzadas con `set-alarm-state`: no se reevalúan hasta que cambia el minuto (como en AWS, que tarda en volver a mirar). */
const forced = new WeakMap<Alarm, number>();

alarmEngine.tick = (a: Account) => {
  const minute = Math.floor(a.clock / MIN);
  for (const region of Object.keys(a.regions)) {
    const r = a.regions[region];
    for (const al of Object.values(r.alarms)) {
      if (forced.get(al) === minute) continue;
      const v = judge(a, region, al);
      if (!v || v.state === al.StateValue) continue;
      transition(a, region, al, v.state, v.reason, v.data);
    }
    if (a.regions[region].cw?.composites) tickComposites(a, region);
  }
};

// ───────────────────────── vistas ─────────────────────────

const alarmView = (c: Pick<OpCtx, 'acct' | 'region'>, al: Alarm) => ({
  AlarmName: al.AlarmName,
  AlarmArn: alarmArn(c.acct, c.region, al.AlarmName),
  ...(al.AlarmDescription ? { AlarmDescription: al.AlarmDescription } : {}),
  AlarmConfigurationUpdatedTimestamp: iso(al.ConfigUpdated ?? c.acct.clock),
  ActionsEnabled: al.ActionsEnabled !== false,
  OKActions: al.OKActions ?? [],
  AlarmActions: al.AlarmActions,
  InsufficientDataActions: al.InsufficientDataActions ?? [],
  StateValue: al.StateValue,
  StateReason: al.StateReason ?? 'Unchecked: Initial alarm creation',
  ...(al.StateReasonData ? { StateReasonData: al.StateReasonData } : {}),
  StateUpdatedTimestamp: iso(al.StateUpdated ?? c.acct.clock),
  ...(al.Metrics?.length
    ? {}
    : { MetricName: al.MetricName, Namespace: al.Namespace, ...(al.ExtendedStatistic ? { ExtendedStatistic: al.ExtendedStatistic } : { Statistic: al.Statistic }), Dimensions: al.Dimensions, Period: al.Period }),
  ...(al.Unit ? { Unit: al.Unit } : {}),
  EvaluationPeriods: al.EvaluationPeriods,
  ...(al.DatapointsToAlarm ? { DatapointsToAlarm: al.DatapointsToAlarm } : {}),
  Threshold: al.Threshold,
  ComparisonOperator: al.ComparisonOperator,
  ...(al.TreatMissingData ? { TreatMissingData: al.TreatMissingData } : {}),
  ...(al.Metrics?.length ? { Metrics: al.Metrics } : {}),
  StateTransitionedTimestamp: iso(al.StateUpdated ?? c.acct.clock),
});

const compositeView = (c: Pick<OpCtx, 'acct' | 'region'>, x: CwComposite) => ({
  AlarmName: x.AlarmName,
  AlarmArn: alarmArn(c.acct, c.region, x.AlarmName),
  ...(x.AlarmDescription ? { AlarmDescription: x.AlarmDescription } : {}),
  AlarmConfigurationUpdatedTimestamp: iso(x.created),
  ActionsEnabled: x.ActionsEnabled,
  AlarmActions: x.AlarmActions,
  OKActions: x.OKActions,
  InsufficientDataActions: x.InsufficientDataActions,
  StateValue: x.StateValue,
  StateReason: x.StateReason,
  StateUpdatedTimestamp: iso(x.StateUpdated),
  AlarmRule: x.AlarmRule,
  StateTransitionedTimestamp: iso(x.StateUpdated),
});

// ───────────────────────── operaciones ─────────────────────────

const validActions = (list: string[] | undefined) => {
  for (const x of list ?? []) if (!/^arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d*:?[\w:/#=.-]*$/.test(x)) throw new AwsError('ValidationError', `1 validation error detected: Value '[${x}]' at 'alarmActions' failed to satisfy constraint: Member must satisfy constraint: [Member must have length less than or equal to 1024, Member must have length greater than or equal to 1, Member must satisfy regular expression pattern: ^arn:aws:[a-z0-9]+:.*]`, 400);
};

op(
  'cloudwatch',
  'put-metric-alarm',
  'alarm-name:s! alarm-description:s actions-enabled:b ok-actions:l alarm-actions:l insufficient-data-actions:l metric-name:s namespace:s statistic:s extended-statistic:s dimensions:f period:i unit:s evaluation-periods:i! datapoints-to-alarm:i threshold:n comparison-operator:s! treat-missing-data:s metrics:f tags:f',
  'Crea o actualiza una alarma que vigila una métrica (o una expresión de métricas) y avisa o actúa al cambiar de estado.',
  { res: (c) => alarmArn(c.acct, c.region, c.p.AlarmName), action: 'cloudwatch:PutMetricAlarm' },
  (c) => {
    const p = c.p;
    if (!COMPARATORS.includes(p.ComparisonOperator)) throw new AwsError('ValidationError', `1 validation error detected: Value '${p.ComparisonOperator}' at 'comparisonOperator' failed to satisfy constraint: Member must satisfy enum value set: [${COMPARATORS.join(', ')}]`, 400);
    const math = Array.isArray(p.Metrics) && p.Metrics.length > 0;
    if (math && (p.MetricName || p.Namespace || p.Statistic || p.Dimensions)) throw new AwsError('ValidationError', 'Metrics and MetricName/Namespace/Statistic/Dimensions are mutually exclusive: use either Metrics or the single-metric parameters.', 400);
    if (!math) {
      if (!p.MetricName || !p.Namespace) throw new AwsError('ValidationError', 'Either MetricName and Namespace, or Metrics, must be specified.', 400);
      if (!p.Statistic && !p.ExtendedStatistic) throw new AwsError('ValidationError', 'Exactly one of Statistic or ExtendedStatistic must be specified.', 400);
      if (p.Statistic && p.ExtendedStatistic) throw new AwsError('ValidationError', 'Exactly one of Statistic or ExtendedStatistic must be specified.', 400);
      if (p.Period === undefined) throw new AwsError('ValidationError', 'Period is required when MetricName is specified.', 400);
      if (p.Statistic && !['SampleCount', 'Average', 'Sum', 'Minimum', 'Maximum'].includes(p.Statistic)) throw new AwsError('ValidationError', `1 validation error detected: Value '${p.Statistic}' at 'statistic' failed to satisfy constraint: Member must satisfy enum value set: [SampleCount, Average, Sum, Minimum, Maximum]`, 400);
      if (p.Period !== 10 && p.Period !== 30 && (p.Period < 60 || p.Period % 60)) throw new AwsError('ValidationError', 'Period must be 10, 30, or a multiple of 60 seconds.', 400);
    } else {
      const ids = new Set<string>();
      for (const q of p.Metrics as { Id: string; Expression?: string; MetricStat?: unknown }[]) {
        if (!q.Id) throw new AwsError('ValidationError', 'Each entry of Metrics needs an Id.', 400);
        if (ids.has(q.Id)) throw new AwsError('ValidationError', `Duplicate metric Id: ${q.Id}`, 400);
        ids.add(q.Id);
        if (!q.Expression && !q.MetricStat) throw new AwsError('ValidationError', `The entry ${q.Id} of Metrics needs either Expression or MetricStat.`, 400);
      }
      if (!(p.Metrics as { ReturnData?: boolean }[]).some((q) => q.ReturnData !== false)) throw new AwsError('ValidationError', 'Exactly one metric in Metrics must have ReturnData set to true.', 400);
    }
    if (p.Threshold === undefined) throw new AwsError('ValidationError', 'Threshold is required.', 400);
    if (p.EvaluationPeriods < 1) throw new AwsError('ValidationError', 'EvaluationPeriods must be greater than or equal to 1.', 400);
    if (p.DatapointsToAlarm !== undefined && (p.DatapointsToAlarm < 1 || p.DatapointsToAlarm > p.EvaluationPeriods)) throw new AwsError('ValidationError', `DatapointsToAlarm must be between 1 and EvaluationPeriods (${p.EvaluationPeriods}).`, 400);
    if (p.TreatMissingData && !['breaching', 'notBreaching', 'ignore', 'missing'].includes(p.TreatMissingData)) throw new AwsError('ValidationError', `1 validation error detected: Value '${p.TreatMissingData}' at 'treatMissingData' failed to satisfy constraint: Member must satisfy regular expression pattern: ^(breaching|notBreaching|ignore|missing)$`, 400);
    for (const k of ['AlarmActions', 'OKActions', 'InsufficientDataActions']) validActions(p[k]);
    const r = regional(c.acct, c.region);
    const old = r.alarms[p.AlarmName];
    const al: Alarm = {
      AlarmName: p.AlarmName,
      Namespace: p.Namespace ?? '',
      MetricName: p.MetricName ?? '',
      Statistic: p.Statistic ?? 'Average',
      ...(p.ExtendedStatistic ? { ExtendedStatistic: p.ExtendedStatistic } : {}),
      Period: p.Period ?? (math ? ((p.Metrics as { MetricStat?: { Period: number } }[]).find((q) => q.MetricStat)?.MetricStat?.Period ?? 60) : 60),
      EvaluationPeriods: p.EvaluationPeriods,
      ...(p.DatapointsToAlarm ? { DatapointsToAlarm: p.DatapointsToAlarm } : {}),
      Threshold: p.Threshold,
      ComparisonOperator: p.ComparisonOperator,
      AlarmActions: p.AlarmActions ?? [],
      OKActions: p.OkActions ?? [],
      InsufficientDataActions: p.InsufficientDataActions ?? [],
      ActionsEnabled: p.ActionsEnabled !== false,
      Dimensions: p.Dimensions ?? [],
      AlarmDescription: p.AlarmDescription,
      TreatMissingData: p.TreatMissingData,
      ...(p.Unit ? { Unit: p.Unit } : {}),
      ...(math ? { Metrics: p.Metrics } : {}),
      StateValue: old?.StateValue ?? 'INSUFFICIENT_DATA',
      StateReason: old?.StateReason ?? 'Unchecked: Initial alarm creation',
      StateReasonData: old?.StateReasonData,
      StateUpdated: old?.StateUpdated ?? c.acct.clock,
      ConfigUpdated: c.acct.clock,
    };
    r.alarms[p.AlarmName] = al;
    history(c.acct, c.region, p.AlarmName, 'MetricAlarm', 'ConfigurationUpdate', old ? `Alarm "${p.AlarmName}" updated` : `Alarm "${p.AlarmName}" created`, { version: '1.0', type: 'Update', updatedAlarm: alarmView(c, al), ...(old ? { originalAlarm: alarmView(c, old) } : {}) });
    return undefined;
  },
);

op('cloudwatch', 'describe-alarms', 'alarm-names:l alarm-name-prefix:s alarm-types:l children-of-alarm-name:s parents-of-alarm-name:s state-value:s action-prefix:s max-records:i', 'Lista las alarmas de la región (solo las de métricas, salvo que pidas `--alarm-types CompositeAlarm`).', { paginate: 'MetricAlarms', res: () => '*', action: 'cloudwatch:DescribeAlarms' }, (c) => {
  const types: string[] = c.p.AlarmTypes ?? ['MetricAlarm'];
  const r = regional(c.acct, c.region);
  const st = cwOf(c.acct, c.region);
  const keep = (name: string, state: string, actions: string[]) =>
    (!c.p.AlarmNames || c.p.AlarmNames.includes(name)) && (!c.p.AlarmNamePrefix || name.startsWith(c.p.AlarmNamePrefix)) && (!c.p.StateValue || state === c.p.StateValue) && (!c.p.ActionPrefix || actions.some((x: string) => x.startsWith(c.p.ActionPrefix)));
  if (c.p.StateValue && !['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(c.p.StateValue)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.StateValue}' at 'stateValue' failed to satisfy constraint: Member must satisfy enum value set: [INSUFFICIENT_DATA, ALARM, OK]`, 400);
  const metric = types.includes('MetricAlarm') ? Object.values(r.alarms).filter((al) => keep(al.AlarmName, al.StateValue, [...al.AlarmActions, ...(al.OKActions ?? []), ...(al.InsufficientDataActions ?? [])])).sort((x, y) => (x.AlarmName < y.AlarmName ? -1 : 1)) : [];
  const comp = types.includes('CompositeAlarm') ? Object.values(st.composites).filter((x) => keep(x.AlarmName, x.StateValue, [...x.AlarmActions, ...x.OKActions, ...x.InsufficientDataActions])) : [];
  return { CompositeAlarms: comp.map((x) => compositeView(c, x)), MetricAlarms: metric.map((al) => alarmView(c, al)) };
});

op('cloudwatch', 'describe-alarms-for-metric', 'metric-name:s! namespace:s! statistic:s extended-statistic:s dimensions:f period:i unit:s', 'Alarmas que vigilan una métrica concreta.', { res: () => '*', action: 'cloudwatch:DescribeAlarmsForMetric' }, (c) => {
  const dims = dimsOf(c.p.Dimensions);
  const list = Object.values(regional(c.acct, c.region).alarms).filter((al) => al.MetricName === c.p.MetricName && al.Namespace === c.p.Namespace && (!c.p.Statistic || al.Statistic === c.p.Statistic) && (c.p.Period === undefined || al.Period === c.p.Period) && (!c.p.Dimensions || JSON.stringify(Object.entries(dimsOf(al.Dimensions as { Name: string; Value: string }[])).sort()) === JSON.stringify(Object.entries(dims).sort())));
  return { MetricAlarms: list.map((al) => alarmView(c, al)) };
});

op('cloudwatch', 'describe-alarm-history', 'alarm-name:s alarm-types:l history-item-type:s start-date:s end-date:s max-records:i scan-by:s', 'Historial de una alarma: cambios de configuración, de estado y acciones ejecutadas.', { paginate: 'AlarmHistoryItems', res: () => '*', action: 'cloudwatch:DescribeAlarmHistory' }, (c) => {
  if (c.p.HistoryItemType && !['ConfigurationUpdate', 'StateUpdate', 'Action'].includes(c.p.HistoryItemType)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.HistoryItemType}' at 'historyItemType' failed to satisfy constraint: Member must satisfy enum value set: [Action, StateUpdate, ConfigurationUpdate]`, 400);
  const from = c.p.StartDate ? Date.parse(String(c.p.StartDate)) : -Infinity;
  const to = c.p.EndDate ? Date.parse(String(c.p.EndDate)) : Infinity;
  const types: string[] = c.p.AlarmTypes ?? ['MetricAlarm'];
  let list = cwOf(c.acct, c.region).history.filter((h) => (!c.p.AlarmName || h.alarm === c.p.AlarmName) && (!c.p.HistoryItemType || h.item === c.p.HistoryItemType) && h.t >= from && h.t <= to && (c.p.AlarmName || types.includes(h.type)));
  list = c.p.ScanBy === 'TimestampAscending' ? list : [...list].reverse();
  return { AlarmHistoryItems: list.slice(0, c.p.MaxRecords ?? 100).map((h) => ({ AlarmName: h.alarm, AlarmType: h.type, Timestamp: iso(h.t), HistoryItemType: h.item, HistorySummary: h.summary, HistoryData: h.data })) };
});

op('cloudwatch', 'delete-alarms', 'alarm-names:l!', 'Borra alarmas (de métricas o compuestas; una compuesta debe borrarse antes que las que usa).', { res: (c) => (c.p.AlarmNames as string[]).map((n) => alarmArn(c.acct, c.region, n)), action: 'cloudwatch:DeleteAlarms' }, (c) => {
  const r = regional(c.acct, c.region);
  const st = cwOf(c.acct, c.region);
  const names = c.p.AlarmNames as string[];
  const missing = names.filter((n) => !r.alarms[n] && !st.composites[n]);
  if (missing.length === names.length && missing.length) throw new AwsError('ResourceNotFound', `Alarm ${missing[0]} not found`, 404);
  for (const n of names) {
    if (!r.alarms[n]) continue;
    const user = Object.values(st.composites).find((x) => !names.includes(x.AlarmName) && ruleRefs(parseRule(x.AlarmRule)).includes(n));
    if (user) throw new AwsError('ValidationError', `Alarm ${n} cannot be deleted: the composite alarm ${user.AlarmName} depends on it. Delete or update ${user.AlarmName} first.`, 400);
  }
  for (const n of names) {
    delete r.alarms[n];
    delete st.composites[n];
  }
  return undefined;
});

op('cloudwatch', 'set-alarm-state', 'alarm-name:s! state-value:s! state-reason:s! state-reason-data:s', 'Cambia a mano el estado de una alarma (para probar sus acciones; vuelve a su valor real al reevaluarse).', { res: (c) => alarmArn(c.acct, c.region, c.p.AlarmName), action: 'cloudwatch:SetAlarmState' }, (c) => {
  if (!['OK', 'ALARM', 'INSUFFICIENT_DATA'].includes(c.p.StateValue)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.StateValue}' at 'stateValue' failed to satisfy constraint: Member must satisfy enum value set: [INSUFFICIENT_DATA, ALARM, OK]`, 400);
  const al = regional(c.acct, c.region).alarms[c.p.AlarmName];
  const comp = cwOf(c.acct, c.region).composites[c.p.AlarmName];
  if (!al && !comp) throw new AwsError('ResourceNotFound', `Alarm ${c.p.AlarmName} not found`, 404);
  if (comp) throw new AwsError('ValidationError', `${c.p.AlarmName} is a composite alarm: its state is decided by its rule and cannot be set.`, 400);
  if (c.p.StateReasonData) {
    try {
      JSON.parse(c.p.StateReasonData);
    } catch {
      throw new AwsError('InvalidFormat', 'StateReasonData must be valid JSON.', 400);
    }
  }
  if (al.StateValue !== c.p.StateValue) transition(c.acct, c.region, al, c.p.StateValue, c.p.StateReason, c.p.StateReasonData);
  else al.StateReason = c.p.StateReason;
  forced.set(al, Math.floor(c.acct.clock / MIN));
  return undefined;
});

op('cloudwatch', 'enable-alarm-actions', 'alarm-names:l!', 'Activa las acciones de las alarmas.', { res: (c) => (c.p.AlarmNames as string[]).map((n) => alarmArn(c.acct, c.region, n)), action: 'cloudwatch:EnableAlarmActions' }, (c) => {
  for (const n of c.p.AlarmNames as string[]) {
    const al = regional(c.acct, c.region).alarms[n];
    if (al) al.ActionsEnabled = true;
    const cp = cwOf(c.acct, c.region).composites[n];
    if (cp) cp.ActionsEnabled = true;
  }
  return undefined;
});

op('cloudwatch', 'disable-alarm-actions', 'alarm-names:l!', 'Desactiva las acciones de las alarmas (siguen cambiando de estado, pero no avisan ni actúan).', { res: (c) => (c.p.AlarmNames as string[]).map((n) => alarmArn(c.acct, c.region, n)), action: 'cloudwatch:DisableAlarmActions' }, (c) => {
  for (const n of c.p.AlarmNames as string[]) {
    const al = regional(c.acct, c.region).alarms[n];
    if (al) al.ActionsEnabled = false;
    const cp = cwOf(c.acct, c.region).composites[n];
    if (cp) cp.ActionsEnabled = false;
  }
  return undefined;
});

op('cloudwatch', 'put-composite-alarm', 'alarm-name:s! alarm-description:s actions-enabled:b alarm-actions:l alarm-rule:s! insufficient-data-actions:l ok-actions:l tags:f', 'Crea una alarma compuesta: combina otras alarmas con `ALARM("a") AND NOT OK("b")`… para avisar una sola vez.', { res: (c) => alarmArn(c.acct, c.region, c.p.AlarmName), action: 'cloudwatch:PutCompositeAlarm' }, (c) => {
  const rule = parseRule(String(c.p.AlarmRule));
  const r = regional(c.acct, c.region);
  const st = cwOf(c.acct, c.region);
  for (const n of ruleRefs(rule)) if (!r.alarms[n] && !st.composites[n]) throw new AwsError('ValidationError', `Alarm '${n}' referenced in the rule does not exist.`, 400);
  if (r.alarms[c.p.AlarmName]) throw new AwsError('ValidationError', `${c.p.AlarmName} already exists as a metric alarm: choose another name.`, 400);
  for (const k of ['AlarmActions', 'OKActions', 'InsufficientDataActions']) validActions(c.p[k]);
  const old = st.composites[c.p.AlarmName];
  st.composites[c.p.AlarmName] = {
    AlarmName: c.p.AlarmName,
    AlarmRule: c.p.AlarmRule,
    AlarmDescription: c.p.AlarmDescription,
    AlarmActions: c.p.AlarmActions ?? [],
    OKActions: c.p.OkActions ?? [],
    InsufficientDataActions: c.p.InsufficientDataActions ?? [],
    ActionsEnabled: c.p.ActionsEnabled !== false,
    StateValue: old?.StateValue ?? 'INSUFFICIENT_DATA',
    StateReason: old?.StateReason ?? 'Unchecked: Initial alarm creation',
    StateUpdated: old?.StateUpdated ?? c.acct.clock,
    created: c.acct.clock,
  };
  history(c.acct, c.region, c.p.AlarmName, 'CompositeAlarm', 'ConfigurationUpdate', old ? `Composite alarm "${c.p.AlarmName}" updated` : `Composite alarm "${c.p.AlarmName}" created`, { version: '1.0', type: 'Update', updatedAlarm: compositeView(c, st.composites[c.p.AlarmName]) });
  return undefined;
});
