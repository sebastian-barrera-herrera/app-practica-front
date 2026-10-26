/** Facturación: Cost Explorer (historial y previsión), etiquetas de asignación de costes y la herramienta de comprobación del gasto. */
import { hash32 } from '../../engine/format';
import { AwsError, op } from '../registry';
import { monthlyBurn, totalBurn } from '../pricing';
import type { Account, BillLine, BillingState } from '../types';
import { isObj, toArr } from '../util';

export const billingOf = (a: Account): BillingState => (a.billing ??= { lines: [], activeTags: [] });

const DAY = 86400000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (s: string) => Date.parse(s + 'T00:00:00Z');

/** Genera `days` días de historial con el gasto de los recursos que hay ahora (como si hubieran estado siempre). */
export function seedBilling(a: Account, days = 45, extra: { service: string; usageType: string; monthly: number; tags?: Record<string, string> }[] = []): void {
  const b = billingOf(a);
  const today = dayMs(ymd(a.clock));
  const items = [...monthlyBurn(a).map((x) => ({ service: x.service, usageType: x.usageType, monthly: x.monthly, region: x.region, tags: x.tags })), ...extra.map((x) => ({ ...x, region: 'global', tags: x.tags ?? {} }))];
  for (let d = days; d >= 1; d--) {
    const date = ymd(today - d * DAY);
    for (const it of items) {
      // pequeñas variaciones deterministas para que no salgan cifras planas
      const wobble = /Bytes|Data/.test(it.usageType) ? 0.3 : 0.04;
      const k = 1 + ((hash32(`${date}:${it.service}:${it.usageType}:${it.region}`) % 1000) / 1000 - 0.5) * 2 * wobble;
      b.lines.push({ date, service: it.service, usageType: it.usageType, region: it.region, usd: (it.monthly / 30.4) * k, tags: it.tags, account: a.id });
    }
  }
}

// ───────────────────────── Cost Explorer ─────────────────────────

interface Filter {
  Dimensions?: { Key: string; Values: string[] };
  Tags?: { Key: string; Values?: string[] };
  And?: Filter[];
  Or?: Filter[];
  Not?: Filter;
}

const DIMENSIONS: Record<string, (l: BillLine) => string> = {
  SERVICE: (l) => l.service,
  USAGE_TYPE: (l) => l.usageType,
  REGION: (l) => l.region,
  LINKED_ACCOUNT: (l) => l.account,
};

function matches(f: Filter | undefined, l: BillLine): boolean {
  if (!f) return true;
  if (f.And) return f.And.every((x) => matches(x, l));
  if (f.Or) return f.Or.some((x) => matches(x, l));
  if (f.Not) return !matches(f.Not, l);
  if (f.Dimensions) {
    const get = DIMENSIONS[f.Dimensions.Key];
    if (!get) throw new AwsError('ValidationException', `Invalid dimension key: ${f.Dimensions.Key}`);
    return f.Dimensions.Values.includes(get(l));
  }
  if (f.Tags) return !f.Tags.Values?.length || f.Tags.Values.includes(l.tags[f.Tags.Key] ?? '');
  return true;
}

const METRICS = ['UnblendedCost', 'BlendedCost', 'AmortizedCost', 'NetUnblendedCost', 'NetAmortizedCost'];
const amount = (n: number) => ({ Amount: n.toFixed(10), Unit: 'USD' });

function periods(start: string, end: string, gran: string): { Start: string; End: string }[] {
  const out: { Start: string; End: string }[] = [];
  const s = dayMs(start);
  const e = dayMs(end);
  if (gran === 'DAILY') {
    for (let t = s; t < e; t += DAY) out.push({ Start: ymd(t), End: ymd(t + DAY) });
    return out;
  }
  let cur = s;
  while (cur < e) {
    const d = new Date(cur);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    out.push({ Start: ymd(cur), End: ymd(Math.min(next, e)) });
    cur = next;
  }
  return out;
}

op('ce', 'get-cost-and-usage', 'time-period:j! granularity:s! metrics:l! group-by:f filter:j next-page-token:s', 'Gasto de la cuenta por periodo, agrupado por servicio, región, etiqueta… (precios ilustrativos).', { global: true, res: () => '*', action: 'ce:GetCostAndUsage' }, (c) => {
  const tp = c.p.TimePeriod as { Start?: string; End?: string };
  if (!tp?.Start || !tp?.End || !/^\d{4}-\d{2}-\d{2}$/.test(tp.Start) || !/^\d{4}-\d{2}-\d{2}$/.test(tp.End)) throw new AwsError('ValidationException', 'Start date and End date must be given as YYYY-MM-DD');
  if (dayMs(tp.Start) >= dayMs(tp.End)) throw new AwsError('ValidationException', 'Start date (and hour) should be before end date (and hour)');
  const gran = String(c.p.Granularity);
  if (gran !== 'DAILY' && gran !== 'MONTHLY') throw new AwsError('ValidationException', `Granularity ${gran} is not supported in this simulator: use DAILY or MONTHLY`);
  const metrics = c.p.Metrics as string[];
  for (const m of metrics) if (!METRICS.includes(m)) throw new AwsError('ValidationException', `Invalid metric: ${m}`);
  const groups = (c.p.GroupBy as { Type: string; Key: string }[]) ?? [];
  if (groups.length > 2) throw new AwsError('ValidationException', 'Cost Explorer supports up to 2 GroupBy values');
  for (const g of groups) if (g.Type === 'DIMENSION' && !DIMENSIONS[g.Key]) throw new AwsError('ValidationException', `Invalid dimension key: ${g.Key}`);
  const b = billingOf(c.acct);
  const filter = c.p.Filter as Filter | undefined;
  const today = ymd(c.acct.clock);
  const keyOf = (l: BillLine) => groups.map((g) => (g.Type === 'DIMENSION' ? DIMENSIONS[g.Key](l) : `${g.Key}$${b.activeTags.includes(g.Key) ? l.tags[g.Key] ?? '' : ''}`));
  const results = periods(tp.Start, tp.End, gran).map((p) => {
    const lines = b.lines.filter((l) => l.date >= p.Start && l.date < p.End && matches(filter, l));
    const sum = (ls: BillLine[]) => Object.fromEntries(metrics.map((m) => [m, amount(ls.reduce((n, l) => n + l.usd, 0))]));
    if (!groups.length) return { TimePeriod: p, Total: sum(lines), Groups: [], Estimated: p.End > today };
    const by = new Map<string, { keys: string[]; lines: BillLine[] }>();
    for (const l of lines) {
      const k = keyOf(l);
      const id = k.join('\u0001');
      if (!by.has(id)) by.set(id, { keys: k, lines: [] });
      by.get(id)!.lines.push(l);
    }
    return { TimePeriod: p, Total: {}, Groups: [...by.values()].sort((x, y) => (x.keys.join() < y.keys.join() ? -1 : 1)).map((g) => ({ Keys: g.keys, Metrics: sum(g.lines) })), Estimated: p.End > today };
  });
  return { ...(groups.length ? { GroupDefinitions: groups } : {}), ResultsByTime: results, DimensionValueAttributes: [] };
});

op('ce', 'get-cost-forecast', 'time-period:j! metric:s! granularity:s! filter:j prediction-interval-level:i', 'Previsión del gasto según lo que tienes encendido ahora.', { global: true, res: () => '*', action: 'ce:GetCostForecast' }, (c) => {
  const tp = c.p.TimePeriod as { Start?: string; End?: string };
  if (!tp?.Start || !tp?.End) throw new AwsError('ValidationException', 'Start date and End date must be given as YYYY-MM-DD');
  const today = dayMs(ymd(c.acct.clock));
  if (dayMs(tp.Start) < today) throw new AwsError('DataUnavailableException', 'Start date for the forecast must be today or in the future');
  if (dayMs(tp.Start) >= dayMs(tp.End)) throw new AwsError('ValidationException', 'Start date (and hour) should be before end date (and hour)');
  const metric = String(c.p.Metric);
  if (!['UNBLENDED_COST', 'BLENDED_COST', 'AMORTIZED_COST', 'NET_UNBLENDED_COST'].includes(metric)) throw new AwsError('ValidationException', `Invalid metric: ${metric}`);
  const daily = totalBurn(c.acct) / 30.4;
  const days = (dayMs(tp.End) - dayMs(tp.Start)) / DAY;
  const total = daily * days;
  const rows = periods(tp.Start, tp.End, String(c.p.Granularity)).map((p) => {
    const d = (dayMs(p.End) - dayMs(p.Start)) / DAY;
    return { TimePeriod: p, MeanValue: (daily * d).toFixed(10) };
  });
  return { Total: { Amount: total.toFixed(10), Unit: 'USD' }, ForecastResultsByTime: rows };
});

op('ce', 'list-cost-allocation-tags', 'status:s tag-keys:l', 'Etiquetas que se pueden activar para repartir costes (solo aparecen las que ya has usado).', { global: true, res: () => '*', action: 'ce:ListCostAllocationTags' }, (c) => {
  const b = billingOf(c.acct);
  const keys = new Set<string>();
  for (const l of b.lines) for (const k of Object.keys(l.tags)) keys.add(k);
  const list = [...keys].sort().map((k) => ({ TagKey: k, Type: 'UserDefined', Status: b.activeTags.includes(k) ? 'Active' : 'Inactive', LastUpdatedDate: '2026-03-01T00:00:00Z' }));
  return { CostAllocationTags: list.filter((t) => !c.p.Status || t.Status === c.p.Status) };
});

op('ce', 'update-cost-allocation-tags-status', 'cost-allocation-tags-status:f!', 'Activa o desactiva etiquetas de asignación de costes (tardan en aplicarse en la factura real).', { global: true, res: () => '*', action: 'ce:UpdateCostAllocationTagsStatus' }, (c) => {
  const b = billingOf(c.acct);
  for (const t of c.p.CostAllocationTagsStatus as { TagKey: string; Status: string }[]) {
    if (t.Status !== 'Active' && t.Status !== 'Inactive') throw new AwsError('ValidationException', `Invalid status: ${t.Status}`);
    b.activeTags = b.activeTags.filter((k) => k !== t.TagKey);
    if (t.Status === 'Active') b.activeTags.push(t.TagKey);
  }
  return { Errors: [] };
});

// ───────────────────────── comprobación interna ─────────────────────────

/** `_check burn --max 40`: ¿cuesta al mes menos de esto lo que hay encendido? Devuelve Monthly y Ok. */
op('_check', 'burn', 'max:n service:s tag:s', 'Gasto mensual estimado de los recursos actuales (y si está por debajo de un máximo).', { global: true, authz: false, anon: true }, (c) => {
  const items = monthlyBurn(c.acct).filter((x) => (!c.p.Service || x.service === c.p.Service) && (!c.p.Tag || x.tags[String(c.p.Tag).split('=')[0]] === String(c.p.Tag).split('=')[1]));
  const monthly = Math.round(items.reduce((n, x) => n + x.monthly, 0) * 100) / 100;
  return { Monthly: monthly, Ok: c.p.Max === undefined ? true : monthly <= c.p.Max, Items: items.length };
});

void isObj;
void toArr;
