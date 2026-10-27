/** AWS X-Ray: segmentos, trazas, grafo de servicios y reglas de muestreo. Lambda con `Active` tracing envía sus trazas aquí. */
import { sha256 } from '../../engine/commands/hash';
import { regional } from '../account';
import { AwsError, op } from '../registry';
import type { Account } from '../types';
import type { XrayState, XraySegment, XraySamplingRule } from '../types-ops';
import { iso, mkArn, newId, parseDate, toArr, wildcard } from '../util';
import { roleCan } from './flowlogs';
import { lambdaHooks } from './lambda';

type Doc = Record<string, any>;

export const xrayOf = (a: Account, region: string): XrayState => {
  const r = regional(a, region);
  r.xray ??= { segments: [], rules: {}, groups: {} };
  r.xray.rules.Default ??= { RuleName: 'Default', RuleARN: mkArn('xray', region, a.id, 'sampling-rule/Default'), ResourceARN: '*', Priority: 10000, FixedRate: 0.05, ReservoirSize: 1, ServiceName: '*', ServiceType: '*', Host: '*', HTTPMethod: '*', URLPath: '*', Version: 1 };
  r.xray.groups.Default ??= { GroupName: 'Default', GroupARN: mkArn('xray', region, a.id, 'group/Default/ABCDEFGHIJKLMNOPQRSTUVWXYZ'), FilterExpression: '' };
  return r.xray;
};

const MAX_SEGMENTS = 1500;
const hex = (a: Account, kind: string, n: number) => newId(a, kind, '', n, 'hex');
const secs = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = String(v);
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : parseDate(s) / 1000;
};

// ───────────────────────── trazas ─────────────────────────

const flag = (d: Doc, k: 'error' | 'fault' | 'throttle'): boolean => {
  if (d[k]) return true;
  return toArr<Doc>(d.subsegments).some((s) => flag(s, k));
};

function store(a: Account, region: string, d: Doc): XraySegment {
  const st = xrayOf(a, region);
  const seg: XraySegment = { id: String(d.id), traceId: String(d.trace_id), doc: d, name: String(d.name), start: Number(d.start_time) * 1000, end: (d.end_time !== undefined ? Number(d.end_time) : Number(d.start_time)) * 1000, error: flag(d, 'error'), fault: flag(d, 'fault'), throttle: flag(d, 'throttle'), origin: d.origin };
  st.segments.push(seg);
  if (st.segments.length > MAX_SEGMENTS) st.segments.splice(0, st.segments.length - MAX_SEGMENTS);
  return seg;
}

op('xray', 'put-trace-segments', 'trace-segment-documents:l!', 'Envía segmentos de traza (documentos JSON con `trace_id`, `id`, `name`, `start_time` y `end_time`).', { action: 'xray:PutTraceSegments', res: () => '*' }, (c) => {
  const bad: { Id?: string; ErrorCode: string; Message: string }[] = [];
  for (const raw of c.p.TraceSegmentDocuments as string[]) {
    let d: Doc;
    try {
      d = JSON.parse(raw);
    } catch {
      bad.push({ ErrorCode: 'ParseError', Message: 'Invalid JSON' });
      continue;
    }
    const missing = ['id', 'trace_id', 'name', 'start_time'].filter((k) => d[k] === undefined);
    if (d.end_time === undefined && !d.in_progress) missing.push('end_time');
    if (missing.length) {
      bad.push({ Id: d.id, ErrorCode: 'MissingRequiredFields', Message: `Missing required fields: ${missing.join(', ')}` });
      continue;
    }
    if (!/^[0-9a-f]{16}$/.test(String(d.id))) {
      bad.push({ Id: d.id, ErrorCode: 'InvalidSegmentId', Message: 'Segment id must be 16 hexadecimal digits.' });
      continue;
    }
    if (!/^1-[0-9a-f]{8}-[0-9a-f]{24}$/.test(String(d.trace_id))) {
      bad.push({ Id: d.id, ErrorCode: 'InvalidTraceId', Message: 'Trace id must look like 1-5759e988-bd862e3fe1be46a994272793.' });
      continue;
    }
    if (d.in_progress) continue;
    store(c.acct, c.region, d);
  }
  return { UnprocessedTraceSegments: bad };
});

function traceDocs(st: XrayState, id: string): XraySegment[] {
  return st.segments.filter((s) => s.traceId === id).sort((x, y) => x.start - y.start);
}

const traceIds = (st: XrayState) => [...new Set(st.segments.map((s) => s.traceId))];

op('xray', 'batch-get-traces', 'trace-ids:l!', 'Trae los documentos completos de unas trazas.', { action: 'xray:BatchGetTraces', res: () => '*' }, (c) => {
  const st = xrayOf(c.acct, c.region);
  const traces: unknown[] = [];
  const missing: string[] = [];
  for (const id of c.p.TraceIds as string[]) {
    const segs = traceDocs(st, id);
    if (!segs.length) {
      missing.push(id);
      continue;
    }
    const start = Math.min(...segs.map((s) => s.start));
    const end = Math.max(...segs.map((s) => s.end));
    const root = segs.find((s) => !s.doc.parent_id) ?? segs[0];
    traces.push({ Id: id, Duration: Math.round(((end - start) / 1000) * 1000) / 1000, ResponseTime: Math.round(((root.end - root.start) / 1000) * 1000) / 1000, LimitExceeded: false, Segments: segs.map((s) => ({ Id: s.id, Document: JSON.stringify(s.doc) })) });
  }
  return { Traces: traces, UnprocessedTraceIds: missing };
});

// ───────────────────────── resumen de trazas ─────────────────────────

interface Info {
  id: string;
  start: number;
  duration: number;
  response: number;
  fault: boolean;
  error: boolean;
  throttle: boolean;
  services: { Name: string; Type: string }[];
  status?: number;
  method?: string;
  url?: string;
  annotations: Record<string, unknown>;
  user?: string;
  arns: string[];
}

const nodeOf = (d: Doc): { Name: string; Type: string } => ({ Name: String(d.name), Type: d.origin ?? (d.namespace === 'aws' ? `AWS::${d.name}` : d.namespace === 'remote' ? 'remote' : 'client') });

function walk(d: Doc, f: (x: Doc) => void): void {
  f(d);
  for (const s of toArr<Doc>(d.subsegments)) walk(s, f);
}

function infoOf(st: XrayState, id: string): Info {
  const segs = traceDocs(st, id);
  const start = Math.min(...segs.map((s) => s.start));
  const end = Math.max(...segs.map((s) => s.end));
  const root = segs.find((s) => !s.doc.parent_id) ?? segs[0];
  const services = new Map<string, { Name: string; Type: string }>();
  const annotations: Record<string, unknown> = {};
  const arns = new Set<string>();
  for (const s of segs) {
    const top = nodeOf(s.doc);
    services.set(`${top.Name}|${top.Type}`, top);
    walk(s.doc, (x) => {
      if (x !== s.doc && (x.namespace === 'aws' || x.namespace === 'remote')) {
        const n = nodeOf(x);
        services.set(`${n.Name}|${n.Type}`, n);
      }
      Object.assign(annotations, x.annotations ?? {});
    });
    const fnArn = (s.doc.aws as { function_arn?: string } | undefined)?.function_arn;
    if (fnArn) arns.add(fnArn);
  }
  const http = root.doc.http as Doc | undefined;
  return {
    id,
    start,
    duration: (end - start) / 1000,
    response: (root.end - root.start) / 1000,
    fault: segs.some((s) => s.fault),
    error: segs.some((s) => s.error),
    throttle: segs.some((s) => s.throttle),
    services: [...services.values()],
    status: http?.response?.status,
    method: http?.request?.method,
    url: http?.request?.url,
    annotations,
    user: root.doc.user as string | undefined,
    arns: [...arns],
  };
}

// Expresiones de filtro: service("x"), responsetime > 2, duration, http.status = 500, annotation.k = "v", error, fault, throttle, ok, AND / OR / paréntesis
function compileFilter(expr: string | undefined): (i: Info) => boolean {
  if (!expr?.trim()) return () => true;
  const toks = expr.match(/"[^"]*"|\(|\)|!=|>=|<=|=|>|<|[^\s()=!<>"]+/g) ?? [];
  let p = 0;
  const bad = (m: string): never => {
    throw new AwsError('InvalidRequestException', `Invalid filter expression: ${m}`, 400);
  };
  const lit = (t: string | undefined): string | number | boolean => {
    if (t === undefined) return bad('missing value');
    if (t.startsWith('"')) return t.slice(1, -1);
    if (t === 'true' || t === 'false') return t === 'true';
    return Number.isNaN(Number(t)) ? t : Number(t);
  };
  function or(): (i: Info) => boolean {
    let l = and();
    while (toks[p]?.toUpperCase() === 'OR') {
      p++;
      const a = l;
      const b = and();
      l = (i) => a(i) || b(i);
    }
    return l;
  }
  function and(): (i: Info) => boolean {
    let l = atom();
    while (toks[p]?.toUpperCase() === 'AND') {
      p++;
      const a = l;
      const b = atom();
      l = (i) => a(i) && b(i);
    }
    return l;
  }
  function atom(): (i: Info) => boolean {
    const t = toks[p++];
    if (t === undefined) return bad('unexpected end');
    if (t === '(') {
      const e = or();
      if (toks[p++] !== ')') bad('expected )');
      return e;
    }
    const lower = t.toLowerCase();
    if (lower === 'error') return (i) => i.error;
    if (lower === 'fault') return (i) => i.fault;
    if (lower === 'throttle') return (i) => i.throttle;
    if (lower === 'ok') return (i) => !i.error && !i.fault && !i.throttle;
    if (lower === 'service' || lower === 'edge') {
      if (toks[p++] !== '(') return bad('expected (');
      const names: string[] = [];
      while (toks[p] && toks[p] !== ')') names.push(String(lit(toks[p++])));
      p++;
      return lower === 'service' ? (i) => i.services.some((s) => wildcard(names[0], s.Name)) : (i) => names.length === 2 && i.services.some((s) => s.Name === names[0]) && i.services.some((s) => s.Name === names[1]);
    }
    const opTok = toks[p++];
    const cmp = (a: unknown, b: unknown): boolean => {
      const o = opTok.toUpperCase();
      if (o === 'BEGINSWITH') return String(a).startsWith(String(b));
      if (o === 'ENDSWITH') return String(a).endsWith(String(b));
      if (o === 'CONTAINS') return String(a).includes(String(b));
      if (a === undefined) return o === '!=';
      if (o === '=') return typeof b === 'string' && b.includes('*') ? wildcard(b, String(a)) : a === b || String(a) === String(b);
      if (o === '!=') return String(a) !== String(b);
      const x = Number(a);
      const y = Number(b);
      return o === '>' ? x > y : o === '<' ? x < y : o === '>=' ? x >= y : o === '<=' ? x <= y : bad(`unknown operator ${opTok}`);
    };
    const val = lit(toks[p++]);
    if (lower === 'responsetime') return (i) => cmp(i.response, val);
    if (lower === 'duration') return (i) => cmp(i.duration, val);
    if (lower === 'http.status') return (i) => cmp(i.status, val);
    if (lower === 'http.method') return (i) => cmp(i.method, val);
    if (lower === 'http.url') return (i) => cmp(i.url, val);
    if (lower === 'user') return (i) => cmp(i.user, val);
    if (lower.startsWith('annotation.')) return (i) => cmp(i.annotations[t.slice(11)], val);
    return bad(`unknown field ${t}`);
  }
  const f = or();
  if (p < toks.length) bad(`unexpected ${toks[p]}`);
  return f;
}

op('xray', 'get-trace-summaries', 'start-time:s! end-time:s! time-range-type:s sampling:b sampling-strategy:j filter-expression:s next-token:s', 'Lista las trazas de un intervalo, con filtros (`service("api")`, `responsetime > 2`, `fault`, `annotation.cliente = "ana"`).', { paginate: 'TraceSummaries', action: 'xray:GetTraceSummaries', res: () => '*' }, (c) => {
  const from = secs(c.p.StartTime) * 1000;
  const to = secs(c.p.EndTime) * 1000;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new AwsError('InvalidRequestException', 'EndTime must be after StartTime.', 400);
  const st = xrayOf(c.acct, c.region);
  const keep = compileFilter(c.p.FilterExpression);
  const infos = traceIds(st).map((id) => infoOf(st, id)).filter((i) => i.start >= from && i.start <= to && keep(i));
  return {
    TraceSummaries: infos
      .sort((x, y) => y.start - x.start)
      .map((i) => ({
        Id: i.id,
        Duration: Math.round(i.duration * 1000) / 1000,
        ResponseTime: Math.round(i.response * 1000) / 1000,
        HasFault: i.fault,
        HasError: i.error,
        HasThrottle: i.throttle,
        IsPartial: false,
        Http: { ...(i.url ? { HttpURL: i.url } : {}), ...(i.status ? { HttpStatus: i.status } : {}), ...(i.method ? { HttpMethod: i.method } : {}) },
        Annotations: Object.fromEntries(Object.entries(i.annotations).map(([k, v]) => [k, [{ AnnotationValue: typeof v === 'number' ? { NumberValue: v } : typeof v === 'boolean' ? { BooleanValue: v } : { StringValue: String(v) }, ServiceIds: i.services.slice(0, 1).map((s) => ({ Name: s.Name, Names: [s.Name], AccountId: c.acct.id, Type: s.Type })) }]])),
        Users: i.user ? [{ UserName: i.user, ServiceIds: [] }] : [],
        ServiceIds: i.services.map((s) => ({ Name: s.Name, Names: [s.Name], AccountId: c.acct.id, Type: s.Type })),
        ResourceARNs: i.arns.map((A) => ({ ARN: A })),
        InstanceIds: [],
        AvailabilityZones: [],
        EntryPoint: { Name: i.services[0]?.Name, Names: [i.services[0]?.Name], AccountId: c.acct.id, Type: i.services[0]?.Type },
        FaultRootCauses: [],
        ErrorRootCauses: [],
        ResponseTimeRootCauses: [],
        Revision: 1,
        MatchedEventTime: iso(i.start),
      })),
    ApproximateTime: iso(c.acct.clock),
    TracesProcessedCount: infos.length,
  };
});

// ───────────────────────── grafo de servicios ─────────────────────────

interface Stat {
  total: number;
  ok: number;
  errOther: number;
  errThrottle: number;
  fault: number;
  time: number;
}
const newStat = (): Stat => ({ total: 0, ok: 0, errOther: 0, errThrottle: 0, fault: 0, time: 0 });
function bump(s: Stat, d: Doc): void {
  s.total++;
  if (d.fault) s.fault++;
  else if (d.throttle) s.errThrottle++;
  else if (d.error) s.errOther++;
  else s.ok++;
  s.time += (Number(d.end_time ?? d.start_time) - Number(d.start_time)) || 0;
}
const statView = (s: Stat) => ({ OkCount: s.ok, ErrorStatistics: { ThrottleCount: s.errThrottle, OtherCount: s.errOther, TotalCount: s.errThrottle + s.errOther }, FaultStatistics: { OtherCount: s.fault, TotalCount: s.fault }, TotalCount: s.total, TotalResponseTime: Math.round(s.time * 1000) / 1000 });

op('xray', 'get-service-graph', 'start-time:s! end-time:s! group-name:s group-arn:s next-token:s', 'El mapa de servicios: qué servicios intervienen, cuántas peticiones pasan entre ellos y cuántas fallan.', { action: 'xray:GetServiceGraph', res: () => '*' }, (c) => {
  const from = secs(c.p.StartTime) * 1000;
  const to = secs(c.p.EndTime) * 1000;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new AwsError('InvalidRequestException', 'EndTime must be after StartTime.', 400);
  const st = xrayOf(c.acct, c.region);
  const nodes = new Map<string, { Name: string; Type: string; stat: Stat; edges: Map<string, Stat>; first: number; last: number }>();
  const get = (n: { Name: string; Type: string }, t: number) => {
    const k = `${n.Name}|${n.Type}`;
    if (!nodes.has(k)) nodes.set(k, { ...n, stat: newStat(), edges: new Map(), first: t, last: t });
    const x = nodes.get(k)!;
    x.first = Math.min(x.first, t);
    x.last = Math.max(x.last, t);
    return x;
  };
  const group = c.p.GroupName ? st.groups[c.p.GroupName] : undefined;
  const keep = compileFilter(group?.FilterExpression);
  for (const id of traceIds(st)) {
    const i = infoOf(st, id);
    if (i.start < from || i.start > to || !keep(i)) continue;
    const segs = traceDocs(st, id);
    const byId = new Map(segs.map((s) => [s.id, s]));
    for (const s of segs) {
      const n = get(nodeOf(s.doc), s.start);
      bump(n.stat, s.doc);
      const parent = s.doc.parent_id ? byId.get(String(s.doc.parent_id)) : undefined;
      const from_ = parent ? get(nodeOf(parent.doc), parent.start) : s.doc.origin ? get({ Name: 'client', Type: 'client' }, s.start) : undefined;
      if (from_) {
        const k = `${n.Name}|${n.Type}`;
        const e = from_.edges.get(k) ?? newStat();
        bump(e, s.doc);
        from_.edges.set(k, e);
      }
      walk(s.doc, (x) => {
        if (x === s.doc || (x.namespace !== 'aws' && x.namespace !== 'remote')) return;
        const dn = get(nodeOf(x), s.start);
        bump(dn.stat, x);
        const k = `${dn.Name}|${dn.Type}`;
        const e = n.edges.get(k) ?? newStat();
        bump(e, x);
        n.edges.set(k, e);
      });
    }
  }
  const order = [...nodes.keys()];
  return {
    StartTime: iso(from),
    EndTime: iso(to),
    Services: [...nodes.values()].map((n, idx) => ({
      ReferenceId: idx,
      Name: n.Name,
      Names: [n.Name],
      ...(n.Type === 'client' ? { Root: true } : {}),
      AccountId: c.acct.id,
      Type: n.Type,
      State: 'active',
      StartTime: iso(n.first),
      EndTime: iso(n.last),
      Edges: [...n.edges.entries()].map(([ek, es]) => ({ ReferenceId: order.indexOf(ek), StartTime: iso(n.first), EndTime: iso(n.last), SummaryStatistics: statView(es), ResponseTimeHistogram: [], Aliases: [] })),
      SummaryStatistics: statView(n.stat),
      DurationHistogram: [],
      ResponseTimeHistogram: [],
    })),
    ContainsOldGroupVersions: false,
  };
});

// ───────────────────────── reglas de muestreo y grupos ─────────────────────────

const ruleView = (r: XraySamplingRule) => ({ SamplingRule: { RuleName: r.RuleName, RuleARN: r.RuleARN, ResourceARN: r.ResourceARN, Priority: r.Priority, FixedRate: r.FixedRate, ReservoirSize: r.ReservoirSize, ServiceName: r.ServiceName, ServiceType: r.ServiceType, Host: r.Host, HTTPMethod: r.HTTPMethod, URLPath: r.URLPath, Version: r.Version, Attributes: {} }, CreatedAt: iso(0), ModifiedAt: iso(0) });

function checkRule(r: Record<string, any>): void {
  if (r.FixedRate === undefined || r.FixedRate < 0 || r.FixedRate > 1) throw new AwsError('InvalidRequestException', 'FixedRate must be between 0 and 1.', 400);
  if (r.Priority === undefined || r.Priority < 1 || r.Priority > 9999) throw new AwsError('InvalidRequestException', 'Priority must be between 1 and 9999.', 400);
  if (r.ReservoirSize === undefined || r.ReservoirSize < 0) throw new AwsError('InvalidRequestException', 'ReservoirSize must be zero or greater.', 400);
  if (r.Version !== 1) throw new AwsError('InvalidRequestException', 'Version must be 1.', 400);
}

op('xray', 'create-sampling-rule', 'sampling-rule:j! tags:f', 'Crea una regla de muestreo: qué porcentaje de las peticiones se trazan (y cuántas por segundo seguro).', { action: 'xray:CreateSamplingRule', res: () => '*' }, (c) => {
  const r = c.p.SamplingRule as Record<string, any>;
  const st = xrayOf(c.acct, c.region);
  if (!r?.RuleName) throw new AwsError('InvalidRequestException', 'RuleName is required.', 400);
  checkRule(r);
  if (st.rules[r.RuleName]) throw new AwsError('RuleLimitExceededException', `A sampling rule named ${r.RuleName} already exists.`, 400);
  const rule: XraySamplingRule = { RuleName: r.RuleName, RuleARN: mkArn('xray', c.region, c.acct.id, `sampling-rule/${r.RuleName}`), ResourceARN: r.ResourceARN ?? '*', Priority: r.Priority, FixedRate: Number(r.FixedRate), ReservoirSize: r.ReservoirSize, ServiceName: r.ServiceName ?? '*', ServiceType: r.ServiceType ?? '*', Host: r.Host ?? '*', HTTPMethod: r.HTTPMethod ?? '*', URLPath: r.URLPath ?? '*', Version: 1 };
  st.rules[r.RuleName] = rule;
  return { SamplingRuleRecord: ruleView(rule) };
});

op('xray', 'get-sampling-rules', '', 'Reglas de muestreo (siempre existe `Default`: 1 por segundo y el 5 % del resto).', { paginate: 'SamplingRuleRecords', action: 'xray:GetSamplingRules', res: () => '*' }, (c) => ({ SamplingRuleRecords: Object.values(xrayOf(c.acct, c.region).rules).sort((x, y) => x.Priority - y.Priority).map(ruleView) }));

op('xray', 'delete-sampling-rule', 'rule-name:s rule-arn:s', 'Borra una regla de muestreo (la `Default` no se puede borrar).', { action: 'xray:DeleteSamplingRule', res: () => '*' }, (c) => {
  const st = xrayOf(c.acct, c.region);
  const name = c.p.RuleName ?? String(c.p.RuleARN).split('/').pop();
  if (name === 'Default') throw new AwsError('InvalidRequestException', 'The Default sampling rule cannot be deleted.', 400);
  const r = st.rules[name];
  if (!r) throw new AwsError('InvalidRequestException', `Sampling rule ${name} was not found.`, 400);
  delete st.rules[name];
  return { SamplingRuleRecord: ruleView(r) };
});

op('xray', 'update-sampling-rule', 'sampling-rule-update:j!', 'Cambia una regla de muestreo.', { action: 'xray:UpdateSamplingRule', res: () => '*' }, (c) => {
  const u = c.p.SamplingRuleUpdate as Record<string, any>;
  const st = xrayOf(c.acct, c.region);
  const r = st.rules[u.RuleName ?? String(u.RuleARN).split('/').pop()];
  if (!r) throw new AwsError('InvalidRequestException', 'Sampling rule was not found.', 400);
  const merged = { ...r, ...u, Version: 1 };
  checkRule(merged);
  Object.assign(r, { Priority: merged.Priority, FixedRate: Number(merged.FixedRate), ReservoirSize: merged.ReservoirSize, ServiceName: merged.ServiceName, Host: merged.Host, HTTPMethod: merged.HTTPMethod, URLPath: merged.URLPath, ResourceARN: merged.ResourceARN });
  return { SamplingRuleRecord: ruleView(r) };
});

op('xray', 'create-group', 'group-name:s! filter-expression:s insights-configuration:j tags:f', 'Crea un grupo: un filtro guardado de trazas (con su propio mapa de servicios).', { action: 'xray:CreateGroup', res: () => '*' }, (c) => {
  const st = xrayOf(c.acct, c.region);
  const name = String(c.p.GroupName);
  if (st.groups[name]) throw new AwsError('InvalidRequestException', `A group named ${name} already exists.`, 400);
  compileFilter(c.p.FilterExpression);
  st.groups[name] = { GroupName: name, GroupARN: mkArn('xray', c.region, c.acct.id, `group/${name}/${hex(c.acct, 'xg', 26).toUpperCase()}`), FilterExpression: c.p.FilterExpression ?? '' };
  return { Group: { ...st.groups[name], InsightsConfiguration: { InsightsEnabled: false, NotificationsEnabled: false } } };
});

op('xray', 'get-groups', '', 'Lista los grupos.', { paginate: 'Groups', action: 'xray:GetGroups', res: () => '*' }, (c) => ({ Groups: Object.values(xrayOf(c.acct, c.region).groups).map((g) => ({ ...g, InsightsConfiguration: { InsightsEnabled: false, NotificationsEnabled: false } })) }));

op('xray', 'delete-group', 'group-name:s group-arn:s', 'Borra un grupo.', { action: 'xray:DeleteGroup', res: () => '*' }, (c) => {
  const st = xrayOf(c.acct, c.region);
  const name = c.p.GroupName ?? String(c.p.GroupARN).split('/')[1];
  if (name === 'Default') throw new AwsError('InvalidRequestException', 'The Default group cannot be deleted.', 400);
  if (!st.groups[name]) throw new AwsError('InvalidRequestException', `Group ${name} was not found.`, 400);
  delete st.groups[name];
  return {};
});

// ───────────────────────── Lambda con Active tracing ─────────────────────────

const XNAME: Record<string, string> = { dynamodb: 'DynamoDB', s3: 'S3', sqs: 'SQS', sns: 'SNS', lambda: 'Lambda', ssm: 'SSM', secretsmanager: 'Secrets Manager', events: 'EventBridge', states: 'SFN', logs: 'CloudWatch Logs', kms: 'KMS', rds: 'RDS', ec2: 'EC2', sts: 'STS', iam: 'IAM', cloudwatch: 'CloudWatch', stepfunctions: 'SFN' };
const pascal = (kebab: string) => kebab.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join('');

const reservoir = new WeakMap<Account, { sec: number; used: Map<string, number> }>();

/** ¿Se traza esta invocación? Mismo criterio que X-Ray: la reserva de cada regla por segundo y, después, el porcentaje fijo. */
function sampled(a: Account, region: string, fnName: string, requestId: string): boolean {
  const st = xrayOf(a, region);
  const rule = Object.values(st.rules).sort((x, y) => x.Priority - y.Priority).find((r) => wildcard(r.ServiceName, fnName) && (r.ServiceType === '*' || r.ServiceType === 'AWS::Lambda::Function'));
  if (!rule) return false;
  const sec = Math.floor(a.clock / 1000);
  let r = reservoir.get(a);
  if (!r || r.sec !== sec) {
    r = { sec, used: new Map() };
    reservoir.set(a, r);
  }
  const used = r.used.get(rule.RuleName) ?? 0;
  if (used < rule.ReservoirSize) {
    r.used.set(rule.RuleName, used + 1);
    return true;
  }
  const h = parseInt(sha256(requestId).slice(0, 8), 16) / 0xffffffff;
  return h < rule.FixedRate;
}

lambdaHooks.push((a, region, fn, _q, out, calls) => {
  if (fn.TracingMode !== 'Active' || out.statusCode === 429) return;
  if (!roleCan(a, fn.Role, ['xray:PutTraceSegments'])) return;
  if (!sampled(a, region, fn.FunctionName, out.requestId)) return;
  const t0 = a.clock / 1000;
  const init = (out.initMs ?? 0) / 1000;
  const dur = out.durationMs / 1000;
  const traceId = `1-${Math.floor(t0).toString(16).padStart(8, '0')}-${sha256(out.requestId).slice(0, 24)}`;
  const id = (k: string) => sha256(out.requestId + k).slice(0, 16);
  const failed = !!out.functionError;
  let err: Doc | undefined;
  if (failed) {
    try {
      err = JSON.parse(out.payload);
    } catch {
      err = { errorMessage: out.payload };
    }
  }
  const xr = out.xray ? (JSON.parse(out.xray) as { patched: boolean; annotations: Record<string, unknown>; metadata: Record<string, unknown>; subs: Doc[] }) : undefined;
  const invStart = t0 + init;
  let cursor = invStart + 0.002;
  const downstream: Doc[] = xr?.patched
    ? calls.map((cl, i) => {
        const len = cl.ms / 1000;
        const sub: Doc = { id: id('call' + i), name: XNAME[cl.service] ?? cl.service, start_time: cursor, end_time: cursor + len, namespace: 'aws', http: { response: { status: cl.ok ? 200 : 400 } }, aws: { operation: pascal(cl.op), region, request_id: id('rq' + i) } };
        if (!cl.ok) sub.error = true;
        cursor += len + 0.001;
        return sub;
      })
    : [];
  const subs: Doc[] = [...(xr?.subs.map((s, i) => withIds(s, id('u' + i))) ?? []), ...downstream];
  const fnDoc: Doc = {
    id: id('fn'),
    trace_id: traceId,
    parent_id: id('svc'),
    name: fn.FunctionName,
    start_time: t0,
    end_time: invStart + dur + 0.002,
    origin: 'AWS::Lambda::Function',
    aws: { account_id: a.id, function_arn: fn.FunctionArn, resource_names: [fn.FunctionName], request_id: out.requestId },
    ...(xr && Object.keys(xr.annotations).length ? { annotations: xr.annotations } : {}),
    ...(xr && Object.keys(xr.metadata).length ? { metadata: xr.metadata } : {}),
    subsegments: [
      ...(init > 0 ? [{ id: id('init'), name: 'Initialization', start_time: t0, end_time: invStart, namespace: 'local' }] : []),
      { id: id('inv'), name: 'Invocation', start_time: invStart, end_time: invStart + dur, subsegments: subs },
      { id: id('ovh'), name: 'Overhead', start_time: invStart + dur, end_time: invStart + dur + 0.002 },
    ],
  };
  if (failed) {
    fnDoc.fault = true;
    fnDoc.cause = { working_directory: '/var/task', exceptions: [{ message: String(err?.errorMessage ?? ''), type: String(err?.errorType ?? 'Error') }] };
  }
  const svcDoc: Doc = { id: id('svc'), trace_id: traceId, name: fn.FunctionName, start_time: t0, end_time: invStart + dur + 0.002, origin: 'AWS::Lambda', aws: { account_id: a.id, function_arn: fn.FunctionArn, resource_names: [fn.FunctionName] }, ...(failed ? { fault: true } : {}) };
  store(a, region, svcDoc);
  store(a, region, fnDoc);
});

function withIds(s: Doc, base: string): Doc {
  return { id: sha256(base + s.name + s.start_time).slice(0, 16), ...s, subsegments: s.subsegments?.map((x: Doc, i: number) => withIds(x, base + i)) };
}
