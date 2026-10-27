/** CloudWatch Logs, segunda parte: filtros de métricas, Logs Insights (`start-query`) y `aws logs tail`. */
import { AwsError, op, Raw, type OpCtx } from '../registry';
import type { Account, LogGroup } from '../types';
import type { LogQuery, MetricFilter } from '../types-ops';
import { newId } from '../util';
import { cwPut } from './cwdata';
import { runInsights, parseQuery, type RawEvent } from './insights';
import { ingestHooks, logsOf } from './logs';
import { checkPattern, matchFilter, metricValueOf } from './logpattern';

const group = (c: Pick<OpCtx, 'acct' | 'region'>, name: string): LogGroup => {
  const g = logsOf(c.acct, c.region).groups[name];
  if (!g) throw new AwsError('ResourceNotFoundException', 'The specified log group does not exist.', 400);
  return g;
};

// ───────────────────────── filtros de métricas ─────────────────────────

/** Cada registro nuevo que cumple un filtro suma un valor a la métrica del filtro (no actúa sobre lo ya guardado). */
ingestHooks.push((a, region, g, _stream, ev) => {
  const filters = g.metricFilters;
  if (!filters) return;
  for (const f of Object.values(filters)) {
    if (ev.timestamp < f.creationTime - 0) continue;
    let m;
    try {
      m = matchFilter(f.filterPattern, ev.message);
    } catch {
      continue;
    }
    if (!m.ok) continue;
    for (const t of f.metricTransformations) {
      const v = metricValueOf(t.metricValue, m, ev.message);
      if (v === null) continue;
      cwPut(a, region, t.metricNamespace, t.metricName, t.dimensions ?? {}, { t: ev.timestamp, value: v, unit: t.unit });
    }
  }
});

const mfView = (f: MetricFilter) => ({
  filterName: f.filterName,
  filterPattern: f.filterPattern,
  metricTransformations: f.metricTransformations.map((t) => ({ metricName: t.metricName, metricNamespace: t.metricNamespace, metricValue: t.metricValue, ...(t.defaultValue !== undefined ? { defaultValue: t.defaultValue } : {}), ...(t.unit ? { unit: t.unit } : {}) })),
  creationTime: f.creationTime,
  logGroupName: f.logGroupName,
});

op('logs', 'put-metric-filter', 'log-group-name:s! filter-name:s! filter-pattern:s! metric-transformations:f!', 'Convierte registros que cumplen un patrón en una métrica de CloudWatch (errores por minuto, latencias, accesos denegados…).', { res: (c) => `arn:aws:logs:${c.region}:${c.acct.id}:log-group:${c.p.LogGroupName}:*` }, (c) => {
  const g = group(c, c.p.LogGroupName);
  const name = String(c.p.FilterName);
  if (!/^[^:*]{1,512}$/.test(name)) throw new AwsError('InvalidParameterException', `1 validation error detected: Value '${name}' at 'filterName' failed to satisfy constraint: Member must satisfy regular expression pattern: [^:*]*`, 400);
  checkPattern(c.p.FilterPattern);
  const ts = (c.p.MetricTransformations ?? []) as Record<string, any>[];
  if (ts.length !== 1) throw new AwsError('InvalidParameterException', 'Exactly one metric transformation is supported per metric filter.', 400);
  const t = ts[0];
  for (const k of ['metricName', 'metricNamespace', 'metricValue']) if (t[k] === undefined || t[k] === '') throw new AwsError('InvalidParameterException', `Metric transformation: ${k} is required.`, 400);
  if (String(t.metricNamespace).startsWith('AWS/')) throw new AwsError('InvalidParameterException', 'Metric namespaces starting with AWS/ are reserved for AWS services.', 400);
  const filters = (g.metricFilters ??= {});
  if (!filters[name] && Object.keys(filters).length >= 100) throw new AwsError('LimitExceededException', 'Resource limit exceeded.', 400);
  filters[name] = {
    filterName: name,
    filterPattern: String(c.p.FilterPattern),
    logGroupName: g.logGroupName,
    creationTime: c.acct.clock,
    metricTransformations: [{ metricName: String(t.metricName), metricNamespace: String(t.metricNamespace), metricValue: String(t.metricValue), ...(t.defaultValue !== undefined ? { defaultValue: Number(t.defaultValue) } : {}), ...(t.unit ? { unit: String(t.unit) } : {}) }],
  };
  return undefined;
});

op('logs', 'describe-metric-filters', 'log-group-name:s filter-name-prefix:s metric-name:s metric-namespace:s', 'Lista los filtros de métricas (de un grupo o de todos).', { paginate: 'metricFilters', res: () => '*', action: 'logs:DescribeMetricFilters' }, (c) => {
  const groups = c.p.LogGroupName ? [group(c, c.p.LogGroupName)] : Object.values(logsOf(c.acct, c.region).groups);
  const out = groups.flatMap((g) => Object.values(g.metricFilters ?? {})).filter((f) => (!c.p.FilterNamePrefix || f.filterName.startsWith(c.p.FilterNamePrefix)) && (!c.p.MetricName || f.metricTransformations.some((t) => t.metricName === c.p.MetricName)) && (!c.p.MetricNamespace || f.metricTransformations.some((t) => t.metricNamespace === c.p.MetricNamespace)));
  return { metricFilters: out.map(mfView) };
});

op('logs', 'delete-metric-filter', 'log-group-name:s! filter-name:s!', 'Borra un filtro de métricas (la métrica y sus datos ya publicados se quedan).', { res: (c) => `arn:aws:logs:${c.region}:${c.acct.id}:log-group:${c.p.LogGroupName}:*` }, (c) => {
  const g = group(c, c.p.LogGroupName);
  if (!g.metricFilters?.[c.p.FilterName]) throw new AwsError('ResourceNotFoundException', 'The specified metric filter does not exist.', 400);
  delete g.metricFilters[c.p.FilterName];
  return undefined;
});

op('logs', 'test-metric-filter', 'filter-pattern:s! log-event-messages:l!', 'Prueba un patrón de filtro contra mensajes de ejemplo sin crear nada.', { res: () => '*', action: 'logs:TestMetricFilter' }, (c) => {
  checkPattern(c.p.FilterPattern);
  const msgs = c.p.LogEventMessages as string[];
  const matches: Record<string, unknown>[] = [];
  msgs.forEach((m, i) => {
    const r = matchFilter(c.p.FilterPattern, m);
    if (r.ok) matches.push({ eventNumber: i + 1, eventMessage: m, extractedValues: Object.fromEntries(Object.entries(r.vars).map(([k, v]) => [`$${k}`, String(v)])) });
  });
  return { matches };
});

// ───────────────────────── Logs Insights ─────────────────────────

const queriesOf = (a: Account, region: string): Record<string, LogQuery> => {
  const l = logsOf(a, region);
  return (l.queries ??= {});
};

const groupName = (ref: string) => ref.replace(/^arn:aws:logs:[^:]+:\d+:log-group:/, '').replace(/:\*$/, '');

op('logs', 'start-query', 'log-group-name:s log-group-names:l log-group-identifiers:l start-time:i! end-time:i! query-string:s! limit:i', 'Lanza una consulta de Logs Insights sobre uno o varios grupos y un intervalo (en segundos desde 1970).', { res: () => '*', action: 'logs:StartQuery' }, (c) => {
  const names = [...(c.p.LogGroupName ? [c.p.LogGroupName] : []), ...((c.p.LogGroupNames as string[]) ?? []), ...((c.p.LogGroupIdentifiers as string[]) ?? []).map(groupName)];
  if (!names.length) throw new AwsError('InvalidParameterException', 'Either logGroupName, logGroupNames or logGroupIdentifiers must be specified.', 400);
  if (c.p.LogGroupName && (c.p.LogGroupNames || c.p.LogGroupIdentifiers)) throw new AwsError('InvalidParameterException', 'LogGroupName cannot be combined with logGroupNames or logGroupIdentifiers.', 400);
  const limit = c.p.Limit ?? 1000;
  if (limit < 1 || limit > 10000) throw new AwsError('InvalidParameterException', '1 validation error detected: Value at \'limit\' failed to satisfy constraint: Member must have value between 1 and 10000', 400);
  if (c.p.EndTime < c.p.StartTime) throw new AwsError('InvalidParameterException', 'End time must be greater than or equal to start time.', 400);
  const gs = names.map((n) => group(c, n));
  parseQuery(String(c.p.QueryString));
  const start = c.p.StartTime * 1000;
  const end = c.p.EndTime * 1000;
  const events: RawEvent[] = [];
  for (const g of gs) for (const s of Object.values(g.streams)) for (const e of s.events) if (e.timestamp >= start && e.timestamp <= end) events.push({ timestamp: e.timestamp, message: e.message, ingestionTime: e.ingestionTime, stream: s.logStreamName, group: g.logGroupName });
  const id = newId(c.acct, 'insq', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');
  const q: LogQuery = { queryId: id, logGroups: names, queryString: String(c.p.QueryString), start, end, limit, createdAt: c.acct.clock, completesAt: c.acct.clock + 400 + events.length * 3 };
  const r = runInsights(q.queryString, events, c.acct.id, limit);
  q.results = r.rows;
  q.stats = { recordsMatched: r.matched, recordsScanned: r.scanned, bytesScanned: r.bytes };
  queriesOf(c.acct, c.region)[id] = q;
  return { queryId: id };
});

op('logs', 'get-query-results', 'query-id:s!', 'Resultado de una consulta de Insights (si dice `Running`, vuelve a pedirlo).', { res: () => '*', action: 'logs:GetQueryResults' }, (c) => {
  const q = queriesOf(c.acct, c.region)[c.p.QueryId];
  if (!q) throw new AwsError('ResourceNotFoundException', 'The specified query does not exist.', 400);
  const status = q.cancelled ? 'Cancelled' : c.acct.clock >= q.completesAt ? 'Complete' : 'Running';
  const done = status === 'Complete';
  return { results: done ? q.results : [], statistics: done ? q.stats : { recordsMatched: 0, recordsScanned: 0, bytesScanned: 0 }, status };
});

op('logs', 'stop-query', 'query-id:s!', 'Cancela una consulta que sigue en marcha.', { res: () => '*', action: 'logs:StopQuery' }, (c) => {
  const q = queriesOf(c.acct, c.region)[c.p.QueryId];
  if (!q) throw new AwsError('ResourceNotFoundException', 'The specified query does not exist.', 400);
  if (c.acct.clock >= q.completesAt || q.cancelled) return { success: false };
  q.cancelled = true;
  return { success: true };
});

op('logs', 'describe-queries', 'log-group-name:s status:s', 'Consultas de Insights recientes.', { res: () => '*', action: 'logs:DescribeQueries' }, (c) => ({
  queries: Object.values(queriesOf(c.acct, c.region))
    .map((q) => ({ queryId: q.queryId, queryString: q.queryString, status: q.cancelled ? 'Cancelled' : c.acct.clock >= q.completesAt ? 'Complete' : 'Running', createTime: q.createdAt, logGroupName: q.logGroups[0] }))
    .filter((q) => (!c.p.Status || q.status === c.p.Status) && (!c.p.LogGroupName || q.logGroupName === c.p.LogGroupName)),
}));

// ───────────────────────── aws logs tail ─────────────────────────

const sinceMs = (s: string, now: number): number => {
  const m = /^(\d+)\s*(s|m|h|d|w)$/.exec(s.trim());
  if (m) return now - Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2] as 's'];
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new AwsError('ValidationError', `Invalid value for --since: ${s}`, 252);
  return t;
};

op('logs', 'tail', 'log-group-name:s! since:s follow:b format:s filter-pattern:s log-stream-names:l log-stream-name-prefix:s', 'Muestra los últimos registros de un grupo (`--since 1h`, `--filter-pattern ERROR`, `--format short`).', { positional: ['log-group-name'], res: () => '*', action: 'logs:FilterLogEvents' }, (c) => {
  const g = group(c, String(c.p.LogGroupName).replace(/^arn:aws:logs:[^:]+:\d+:log-group:/, '').replace(/:\*$/, ''));
  const from = sinceMs(c.p.Since ?? '10m', c.acct.clock);
  const fmt = c.p.Format ?? 'detailed';
  if (!['detailed', 'short', 'json'].includes(fmt)) throw new AwsError('ValidationError', `argument --format: Invalid choice, valid choices are:\n\ndetailed | short | json`, 252);
  checkPattern(c.p.FilterPattern);
  const rows: { t: number; stream: string; msg: string }[] = [];
  for (const s of Object.values(g.streams)) {
    if (c.p.LogStreamNames && !(c.p.LogStreamNames as string[]).includes(s.logStreamName)) continue;
    if (c.p.LogStreamNamePrefix && !s.logStreamName.startsWith(c.p.LogStreamNamePrefix)) continue;
    for (const e of s.events) if (e.timestamp >= from && matchFilter(c.p.FilterPattern, e.message).ok) rows.push({ t: e.timestamp, stream: s.logStreamName, msg: e.message });
  }
  rows.sort((x, y) => x.t - y.t);
  const full = (t: number) => new Date(t).toISOString().replace('Z', '000+00:00');
  const lines = rows.map((r) => (fmt === 'json' ? JSON.stringify({ timestamp: r.t, message: r.msg, logStreamName: r.stream }) : fmt === 'short' ? `${new Date(r.t).toISOString().slice(0, 19)} ${r.msg.replace(/\n$/, '')}` : `${full(r.t)} ${r.stream} ${r.msg.replace(/\n$/, '')}`));
  return new Raw(lines.join('\n') + (lines.length ? '\n' : ''));
});
