/** CloudWatch: publicar métricas propias (`put-metric-data`), consultarlas con matemática (`get-metric-data`) y los paneles. */
import { AwsError, op } from '../registry';
import { iso, mkArn, parseDate } from '../util';
import { cwOf, cwPut } from './cwdata';
import { evalQueries, type MQuery } from './cwmath';

const MIN = 60000;
const UNITS = new Set(['Seconds', 'Microseconds', 'Milliseconds', 'Bytes', 'Kilobytes', 'Megabytes', 'Gigabytes', 'Terabytes', 'Bits', 'Kilobits', 'Megabits', 'Gigabits', 'Terabits', 'Percent', 'Count', 'Bytes/Second', 'Kilobytes/Second', 'Megabytes/Second', 'Gigabytes/Second', 'Terabytes/Second', 'Bits/Second', 'Kilobits/Second', 'Megabits/Second', 'Gigabits/Second', 'Terabits/Second', 'Count/Second', 'None']);

const dimMap = (raw: unknown): Record<string, string> => {
  if (!raw) return {};
  if (Array.isArray(raw)) return Object.fromEntries((raw as { Name: string; Value: string }[]).map((d) => [d.Name, String(d.Value)]));
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
};

op(
  'cloudwatch',
  'put-metric-data',
  'namespace:s! metric-data:f metric-name:s timestamp:s unit:s value:n dimensions:j statistic-values:j storage-resolution:i',
  'Publica tus propias métricas (de tu aplicación): un nombre, un valor, una unidad y hasta 30 dimensiones.',
  { res: () => '*', action: 'cloudwatch:PutMetricData', ctx: (c) => ({ 'cloudwatch:namespace': String(c.p.Namespace) }) },
  (c) => {
    const ns = String(c.p.Namespace);
    if (!/^[A-Za-z0-9._#:/-]{1,255}$/.test(ns)) throw new AwsError('InvalidParameterValue', `The value ${ns} for parameter Namespace is invalid.`, 400);
    if (ns.startsWith('AWS/')) throw new AwsError('InvalidParameterValue', `The value ${ns} for parameter Namespace is invalid.`, 400);
    let data = (c.p.MetricData ?? []) as Record<string, any>[];
    if (c.p.MetricName) {
      const stat = c.p.StatisticValues as Record<string, number> | undefined;
      data = [
        ...data,
        {
          MetricName: c.p.MetricName,
          Timestamp: c.p.Timestamp,
          Unit: c.p.Unit,
          Dimensions: c.p.Dimensions ? Object.entries(dimMap(c.p.Dimensions)).map(([Name, Value]) => ({ Name, Value })) : [],
          ...(c.p.Value !== undefined ? { Value: c.p.Value } : {}),
          ...(stat ? { StatisticValues: { SampleCount: Number(stat.SampleCount), Sum: Number(stat.Sum), Minimum: Number(stat.Minimum), Maximum: Number(stat.Maximum) } } : {}),
        },
      ];
    }
    if (!data.length) throw new AwsError('MissingParameter', 'The parameter MetricData is required.', 400);
    if (data.length > 1000) throw new AwsError('InvalidParameterValue', 'The collection MetricData must not have a size greater than 1000.', 400);
    data.forEach((d, i) => {
      const at = `MetricData.member.${i + 1}`;
      if (!d.MetricName) throw new AwsError('MissingParameter', `The parameter ${at}.MetricName is required.`, 400);
      if (d.Unit && !UNITS.has(d.Unit)) throw new AwsError('InvalidParameterValue', `The parameter ${at}.Unit must be a valid unit (for example Count, Bytes, Seconds, Percent, None).`, 400);
      const dims = dimMap(d.Dimensions);
      if (Object.keys(dims).length > 30) throw new AwsError('InvalidParameterValue', `The parameter ${at}.Dimensions must have at most 30 entries.`, 400);
      const t = d.Timestamp !== undefined ? parseDate(String(d.Timestamp)) : c.acct.clock;
      if (Number.isNaN(t)) throw new AwsError('InvalidParameterValue', `The parameter ${at}.Timestamp is not a valid timestamp.`, 400);
      if (t < c.acct.clock - 14 * 86400000 || t > c.acct.clock + 2 * 3600000) throw new AwsError('InvalidParameterValue', `The parameter ${at}.Timestamp must specify a time within the past two weeks and no more than two hours in the future.`, 400);
      const hasValue = d.Value !== undefined;
      const hasValues = Array.isArray(d.Values) && d.Values.length > 0;
      const hasStat = d.StatisticValues !== undefined;
      if (!hasValue && !hasValues && !hasStat) throw new AwsError('InvalidParameterCombination', `At least one of the parameters ${at}.Value, ${at}.Values or ${at}.StatisticValues must be specified.`, 400);
      if (hasValue && (hasValues || hasStat)) throw new AwsError('InvalidParameterCombination', `The parameters ${at}.Value, ${at}.Values and ${at}.StatisticValues are mutually exclusive.`, 400);
      if (hasValues && d.Counts && d.Counts.length !== d.Values.length) throw new AwsError('InvalidParameterValue', `The parameters ${at}.Values and ${at}.Counts must have the same number of entries.`, 400);
      const nums = hasValue ? [Number(d.Value)] : hasValues ? d.Values.map(Number) : [];
      for (const v of nums) if (!Number.isFinite(v)) throw new AwsError('InvalidParameterValue', `The value ${v} for parameter ${at}.Value is invalid.`, 400);
      if (hasStat) {
        const s = d.StatisticValues;
        for (const k of ['SampleCount', 'Sum', 'Minimum', 'Maximum']) if (s[k] === undefined || !Number.isFinite(Number(s[k]))) throw new AwsError('MissingParameter', `The parameter ${at}.StatisticValues.${k} is required.`, 400);
        if (Number(s.Minimum) > Number(s.Maximum)) throw new AwsError('InvalidParameterValue', `The parameter ${at}.StatisticValues.Minimum must not be greater than Maximum.`, 400);
      }
    });
    for (const d of data) {
      const dims = dimMap(d.Dimensions);
      const t = d.Timestamp !== undefined ? parseDate(String(d.Timestamp)) : c.acct.clock;
      const unit = d.Unit && d.Unit !== 'None' ? d.Unit : undefined;
      if (d.StatisticValues) {
        const s = d.StatisticValues;
        cwPut(c.acct, c.region, ns, d.MetricName, dims, { t, sum: Number(s.Sum), n: Number(s.SampleCount), min: Number(s.Minimum), max: Number(s.Maximum), unit });
      } else if (Array.isArray(d.Values)) {
        d.Values.forEach((v: number, i: number) => cwPut(c.acct, c.region, ns, d.MetricName, dims, { t, value: Number(v), n: d.Counts?.[i] ?? 1, unit }));
      } else cwPut(c.acct, c.region, ns, d.MetricName, dims, { t, value: Number(d.Value), unit });
    }
    return undefined;
  },
);

op(
  'cloudwatch',
  'get-metric-data',
  'metric-data-queries:f! start-time:s! end-time:s! next-token:s max-datapoints:i scan-by:s',
  'Consulta varias métricas a la vez y combínalas con fórmulas (`m1/m2*100`, `SUM(METRICS())`, `FILL`, `RATE`…).',
  { res: () => '*', action: 'cloudwatch:GetMetricData' },
  (c) => {
    const start = parseDate(String(c.p.StartTime));
    const end = parseDate(String(c.p.EndTime));
    if (Number.isNaN(start) || Number.isNaN(end)) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be a valid timestamp.', 400);
    if (end <= start) throw new AwsError('InvalidParameterValue', 'The parameter StartTime must be less than the parameter EndTime.', 400);
    if (c.p.ScanBy && !['TimestampDescending', 'TimestampAscending'].includes(c.p.ScanBy)) throw new AwsError('ValidationError', `1 validation error detected: Value '${c.p.ScanBy}' at 'scanBy' failed to satisfy constraint: Member must satisfy enum value set: [TimestampAscending, TimestampDescending]`, 400);
    const queries = c.p.MetricDataQueries as MQuery[];
    for (const q of queries) {
      if (!q.Id || !/^[a-z][A-Za-z0-9_]*$/.test(q.Id)) throw new AwsError('ValidationError', `The Id "${q.Id ?? ''}" is not valid: it must start with a lowercase letter and contain only letters, digits and underscores.`, 400);
      if (q.MetricStat && q.Expression) throw new AwsError('ValidationError', `The query ${q.Id} must have either MetricStat or Expression, not both.`, 400);
      if (q.MetricStat) {
        const p = q.MetricStat.Period;
        if (!p || (p !== 1 && p !== 5 && p !== 10 && p !== 30 && p % 60)) throw new AwsError('ValidationError', `The Period of ${q.Id} must be 1, 5, 10, 30 or a multiple of 60.`, 400);
        if (!q.MetricStat.Stat) throw new AwsError('ValidationError', `The MetricStat of ${q.Id} needs a Stat.`, 400);
      }
    }
    const res = evalQueries({ a: c.acct, region: c.region, start, end, anchor: 0, period: 60 }, queries);
    const asc = c.p.ScanBy === 'TimestampAscending';
    const out = queries
      .filter((q) => q.ReturnData !== false)
      .map((q) => {
        const r = res.get(q.Id)!;
        const idx = r.Series.ts.map((_, i) => i);
        if (!asc) idx.reverse();
        return { Id: q.Id, Label: r.Label, Timestamps: idx.map((i) => iso(r.Series.ts[i])), Values: idx.map((i) => Math.round(r.Series.vs[i] * 1e6) / 1e6), StatusCode: 'Complete' };
      });
    return { MetricDataResults: out, Messages: [] };
  },
);

// ───────────────────────── paneles ─────────────────────────

const WIDGETS = new Set(['metric', 'text', 'log', 'alarm', 'explorer', 'custom', 'alarmstatus']);

function checkDashboard(body: string): void {
  const bad = (errs: { dataPath: string; message: string }[]) => {
    throw new AwsError('InvalidParameterInput', `The dashboard body is invalid, there are ${errs.length} validation errors:\n${JSON.stringify(errs, null, 2)}`, 400);
  };
  let j: unknown;
  try {
    j = JSON.parse(body);
  } catch (e) {
    return bad([{ dataPath: '/', message: `Invalid JSON: ${(e as Error).message}` }]);
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return bad([{ dataPath: '/', message: 'Should be object' }]);
  const o = j as { widgets?: unknown };
  if (o.widgets === undefined) return;
  if (!Array.isArray(o.widgets)) return bad([{ dataPath: '/widgets', message: 'Should be array' }]);
  const errs: { dataPath: string; message: string }[] = [];
  o.widgets.forEach((w: Record<string, any>, i) => {
    const at = `/widgets/${i}`;
    if (!w || typeof w !== 'object') return errs.push({ dataPath: at, message: 'Should be object' });
    if (!WIDGETS.has(w.type)) errs.push({ dataPath: `${at}/type`, message: `Should be equal to one of the allowed values: ${[...WIDGETS].join(', ')}` });
    if (!w.properties || typeof w.properties !== 'object') errs.push({ dataPath: at, message: "Should have required property 'properties'" });
    else if (w.type === 'metric' && !w.properties.metrics && !w.properties.view) errs.push({ dataPath: `${at}/properties`, message: "Should have required property 'metrics'" });
    else if (w.type === 'metric' && Array.isArray(w.properties.metrics) && w.properties.metrics.length === 0) errs.push({ dataPath: `${at}/properties/metrics`, message: 'Should NOT have fewer than 1 items' });
    else if (w.type === 'text' && typeof w.properties.markdown !== 'string') errs.push({ dataPath: `${at}/properties`, message: "Should have required property 'markdown'" });
    else if (w.type === 'log' && typeof w.properties.query !== 'string') errs.push({ dataPath: `${at}/properties`, message: "Should have required property 'query'" });
    for (const k of ['x', 'y', 'width', 'height']) if (w[k] !== undefined && typeof w[k] !== 'number') errs.push({ dataPath: `${at}/${k}`, message: 'Should be number' });
    if (typeof w.width === 'number' && (w.width < 1 || w.width > 24)) errs.push({ dataPath: `${at}/width`, message: 'Should be <= 24' });
  });
  if (errs.length) bad(errs);
}

const dashArn = (c: { acct: { id: string } }, name: string) => mkArn('cloudwatch', '', c.acct.id, `dashboard/${name}`);
/** Los paneles son globales: no dependen de la región. */
const dashboards = (c: { acct: import('../types').Account }) => cwOf(c.acct, 'us-east-1').dashboards;

op('cloudwatch', 'put-dashboard', 'dashboard-name:s! dashboard-body:s!', 'Crea o reemplaza un panel (un JSON con widgets de métricas, texto, registros o alarmas).', { global: true, res: (c) => dashArn(c, String(c.p.DashboardName)), action: 'cloudwatch:PutDashboard' }, (c) => {
  const n = String(c.p.DashboardName);
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(n)) throw new AwsError('InvalidParameterValue', `The value ${n} for parameter DashboardName is invalid. Use only letters, numbers, dashes and underscores.`, 400);
  checkDashboard(String(c.p.DashboardBody));
  dashboards(c)[n] = { name: n, body: String(c.p.DashboardBody), modified: c.acct.clock };
  return { DashboardValidationMessages: [] };
});

op('cloudwatch', 'get-dashboard', 'dashboard-name:s!', 'Contenido de un panel.', { global: true, res: (c) => dashArn(c, String(c.p.DashboardName)), action: 'cloudwatch:GetDashboard' }, (c) => {
  const d = dashboards(c)[c.p.DashboardName];
  if (!d) throw new AwsError('ResourceNotFound', `Dashboard ${c.p.DashboardName} does not exist.`, 404);
  return { DashboardArn: dashArn(c, d.name), DashboardBody: d.body, DashboardName: d.name };
});

op('cloudwatch', 'list-dashboards', 'dashboard-name-prefix:s', 'Lista los paneles.', { global: true, paginate: 'DashboardEntries', res: () => '*', action: 'cloudwatch:ListDashboards' }, (c) => ({
  DashboardEntries: Object.values(dashboards(c))
    .filter((d) => !c.p.DashboardNamePrefix || d.name.startsWith(c.p.DashboardNamePrefix))
    .sort((x, y) => (x.name < y.name ? -1 : 1))
    .map((d) => ({ DashboardName: d.name, DashboardArn: dashArn(c, d.name), LastModified: iso(d.modified), Size: d.body.length })),
}));

op('cloudwatch', 'delete-dashboards', 'dashboard-names:l!', 'Borra paneles.', { global: true, res: (c) => (c.p.DashboardNames as string[]).map((n) => dashArn(c, n)), action: 'cloudwatch:DeleteDashboards' }, (c) => {
  const st = dashboards(c);
  const missing = (c.p.DashboardNames as string[]).filter((n) => !st[n]);
  if (missing.length) throw new AwsError('DashboardNotFoundError', `The specified dashboard does not exist: ${missing.join(', ')}`, 404);
  for (const n of c.p.DashboardNames as string[]) delete st[n];
  return {};
});

void MIN;
