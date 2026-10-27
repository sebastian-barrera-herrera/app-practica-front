/** Lógica pura (sin pantalla) de las ilustraciones de «Observabilidad y operaciones»: así se puede probar. */

// ───────────────────────── alarmas ─────────────────────────

export type MissingData = 'missing' | 'notBreaching' | 'breaching' | 'ignore';
export type AlarmState = 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';

export interface AlarmSetup {
  threshold: number;
  /** Periodos que mira (EvaluationPeriods). */
  periods: number;
  /** Cuántos de ellos tienen que incumplir (DatapointsToAlarm). */
  datapoints: number;
  missing: MissingData;
}

/**
 * Estado de la alarma tras cada periodo de la serie (`null` = no llegó ningún dato en ese minuto).
 * Modelo sencillo: mira los últimos `periods` puntos; los que faltan cuentan según `missing`.
 */
export function alarmTimeline(values: (number | null)[], s: AlarmSetup): AlarmState[] {
  const out: AlarmState[] = [];
  let prev: AlarmState = 'INSUFFICIENT_DATA';
  for (let i = 0; i < values.length; i++) {
    const win: (number | null)[] = [];
    for (let k = i - s.periods + 1; k <= i; k++) win.push(k < 0 ? null : values[k]);
    let next: AlarmState;
    if (s.missing === 'ignore' && win.some((v) => v === null)) next = prev;
    else {
      const cells = win.map((v) => (v === null ? (s.missing === 'breaching' ? 'B' : s.missing === 'notBreaching' ? 'G' : 'M') : v > s.threshold ? 'B' : 'G'));
      if (cells.every((c) => c === 'M')) next = 'INSUFFICIENT_DATA';
      else next = cells.filter((c) => c === 'B').length >= Math.min(s.datapoints, s.periods) ? 'ALARM' : 'OK';
    }
    out.push(next);
    prev = next;
  }
  return out;
}

/** Los minutos que la alarma pasó en ALARM y cuántas veces cambió de estado. */
export function alarmSummary(tl: AlarmState[]): { alarmMinutes: number; changes: number; last: AlarmState } {
  let changes = 0;
  for (let i = 1; i < tl.length; i++) if (tl[i] !== tl[i - 1]) changes++;
  return { alarmMinutes: tl.filter((s) => s === 'ALARM').length, changes, last: tl[tl.length - 1] };
}

// ───────────────────────── patrones de filtro de registros ─────────────────────────

/** ¿Cumple la línea el patrón? Soporta texto (`ERROR`, `"frase"`, `?A ?B`, `-X`) y JSON (`{ $.campo >= 5 && … }`). */
export function logMatches(pattern: string, line: string): boolean {
  const p = pattern.trim();
  if (!p) return true;
  if (p.startsWith('{') && p.endsWith('}')) return jsonMatches(p.slice(1, -1), line);
  const terms = [...p.matchAll(/(-?\??)("([^"]*)"|\S+)/g)].map((m) => ({ mod: m[1], text: m[3] ?? m[2] }));
  const any = terms.filter((t) => t.mod === '?');
  const must = terms.filter((t) => t.mod === '');
  const not = terms.filter((t) => t.mod === '-');
  if (must.some((t) => !line.includes(t.text))) return false;
  if (any.length && !any.some((t) => line.includes(t.text))) return false;
  return !not.some((t) => line.includes(t.text));
}

function jsonMatches(expr: string, line: string): boolean {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return false;
  }
  const test = (cond: string): boolean => {
    const m = /^\s*\$\.(\w+)\s*(>=|<=|!=|=|>|<)\s*(".*"|-?\d+(?:\.\d+)?)\s*$/.exec(cond);
    if (!m) return false;
    const have = obj[m[1]];
    if (have === undefined) return false;
    const want = m[3].startsWith('"') ? m[3].slice(1, -1) : Number(m[3]);
    switch (m[2]) {
      case '=':
        return have === want;
      case '!=':
        return have !== want;
      case '>':
        return typeof have === 'number' && typeof want === 'number' && have > want;
      case '<':
        return typeof have === 'number' && typeof want === 'number' && have < want;
      case '>=':
        return typeof have === 'number' && typeof want === 'number' && have >= want;
      default:
        return typeof have === 'number' && typeof want === 'number' && have <= want;
    }
  };
  // `||` separa alternativas y `&&` las condiciones de cada una
  return expr.split('||').some((alt) => alt.split('&&').every(test));
}

// ───────────────────────── eventos de CloudTrail ─────────────────────────

export interface TrailEvent {
  id: string;
  time: string;
  user: string;
  name: string;
  resource: string;
  readOnly: boolean;
  error?: string;
  ip: string;
  agent: string;
  detail: string;
}

export const TRAIL_EVENTS: TrailEvent[] = [
  { id: 'e1', time: '08:02', user: 'ana', name: 'CreateSecurityGroup', resource: 'web-sg', readOnly: false, ip: '203.0.113.20', agent: 'aws-cli', detail: 'GroupName=web-sg · «Servidor web de la tienda»' },
  { id: 'e2', time: '08:07', user: 'ana', name: 'AuthorizeSecurityGroupIngress', resource: 'web-sg', readOnly: false, ip: '203.0.113.20', agent: 'aws-cli', detail: 'tcp 80 desde 0.0.0.0/0 (la web)' },
  { id: 'e3', time: '11:07', user: 'ana', name: 'DescribeInstances', resource: '—', readOnly: true, ip: '203.0.113.20', agent: 'console', detail: 'Consulta del listado de instancias' },
  { id: 'e4', time: '11:09', user: 'lucia', name: 'DescribeSecurityGroups', resource: '—', readOnly: true, ip: '198.51.100.7', agent: 'console', detail: 'Consulta de grupos de seguridad' },
  { id: 'e5', time: '11:11', user: 'lucia', name: 'DeleteSecurityGroup', resource: 'web-sg', readOnly: false, error: 'UnauthorizedOperation', ip: '198.51.100.7', agent: 'console', detail: 'Intento de borrar web-sg: denegado por permisos' },
  { id: 'e6', time: '13:12', user: 'carlos', name: 'AuthorizeSecurityGroupIngress', resource: 'web-sg', readOnly: false, ip: '192.0.2.44', agent: 'aws-cli', detail: 'tcp 22 desde 0.0.0.0/0 · «solo un momento»' },
  { id: 'e7', time: '14:41', user: 'ana', name: 'DescribeInstances', resource: '—', readOnly: true, ip: '203.0.113.20', agent: 'console', detail: 'Consulta del listado de instancias' },
  { id: 'e8', time: '14:43', user: 'carlos', name: 'DescribeSecurityGroups', resource: '—', readOnly: true, ip: '192.0.2.44', agent: 'aws-cli', detail: 'Consulta de grupos de seguridad' },
  { id: 'e9', time: '14:44', user: 'carlos', name: 'GetCallerIdentity', resource: '—', readOnly: true, ip: '192.0.2.44', agent: 'aws-cli', detail: 'sts get-caller-identity' },
];

export function filterEvents(events: TrailEvent[], f: { user?: string; name?: string; writeOnly?: boolean }): TrailEvent[] {
  return events.filter((e) => (!f.user || e.user === f.user) && (!f.name || e.name === f.name) && (!f.writeOnly || !e.readOnly));
}

// ───────────────────────── Systems Manager ─────────────────────────

export interface FleetSetup {
  role: boolean;
  agent: boolean;
  /** Salida a internet (IP pública o NAT). */
  internet: boolean;
  /** Los tres endpoints de VPC (ssm, ssmmessages, ec2messages) con DNS privado. */
  endpoints: boolean;
}

export type FleetReason = 'ok' | 'no-role' | 'no-agent' | 'no-network';

export function fleetStatus(s: FleetSetup): { online: boolean; reason: FleetReason } {
  if (!s.agent) return { online: false, reason: 'no-agent' };
  if (!s.role) return { online: false, reason: 'no-role' };
  if (!s.internet && !s.endpoints) return { online: false, reason: 'no-network' };
  return { online: true, reason: 'ok' };
}

// ───────────────────────── trazas de X-Ray ─────────────────────────

export interface TraceSeg {
  name: string;
  start: number;
  dur: number;
  /** Tiempo propio: lo que dura menos lo que espera a sus llamadas. */
  self: number;
  fault: boolean;
  depth: number;
}

/** Una petición: cliente → checkout → (inventario, DynamoDB). Devuelve los segmentos, la duración total y el cuello de botella. */
export function traceModel(o: { inventarioMs: number; ddbFault: boolean; retry: boolean }): { segs: TraceSeg[]; total: number; bottleneck: string } {
  const ownCheckout = 30;
  const ddb = 8;
  const inv = Math.max(1, o.inventarioMs);
  const calls: { name: string; dur: number; fault: boolean }[] = [{ name: 'inventario', dur: inv, fault: false }];
  if (o.retry) calls.push({ name: 'inventario (reintento)', dur: inv, fault: false });
  calls.push({ name: 'DynamoDB', dur: ddb, fault: o.ddbFault });
  const segs: TraceSeg[] = [];
  let t = ownCheckout / 2;
  const waiting = calls.reduce((s, c) => s + c.dur, 0);
  for (const c of calls) {
    segs.push({ name: c.name, start: t, dur: c.dur, self: c.dur, fault: c.fault, depth: 1 });
    t += c.dur;
  }
  const total = ownCheckout + waiting;
  segs.unshift({ name: 'checkout', start: 0, dur: total, self: ownCheckout, fault: o.ddbFault, depth: 0 });
  const bottleneck = [...segs].sort((a, b) => b.self - a.self)[0].name.replace(' (reintento)', '');
  return { segs, total, bottleneck };
}
