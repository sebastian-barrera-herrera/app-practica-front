/**
 * Fechas de SQL. Una fecha es el texto «AAAA-MM-DD» y una fecha con hora «AAAA-MM-DD HH:MM:SS» (siempre en UTC,
 * así los resultados son iguales en cualquier móvil y en los tests).
 */
import { runtimeError } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const TS_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function validYMD(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) && y >= 1 && y <= 9999;
}

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  return !!m && validYMD(+m[1], +m[2], +m[3]);
}

export function normalizeDate(s: string): string | null {
  const t = s.trim();
  const m = DATE_RE.exec(t) ?? DATE_RE.exec(t.slice(0, 10));
  if (!m || !validYMD(+m[1], +m[2], +m[3])) return null;
  return `${pad(+m[1], 4)}-${pad(+m[2])}-${pad(+m[3])}`;
}

export function normalizeTimestamp(s: string): string | null {
  const t = s.trim();
  const d = normalizeDate(t);
  if (d && t.length <= 10) return `${d} 00:00:00`;
  const m = TS_RE.exec(t);
  if (!m || !validYMD(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +(m[6] ?? 0) > 59) return null;
  return `${pad(+m[1], 4)}-${pad(+m[2])}-${pad(+m[3])} ${pad(+m[4])}:${pad(+m[5])}:${pad(+(m[6] ?? 0))}`;
}

/** Milisegundos desde 1970 (UTC) de una fecha o fecha con hora. */
export function toMs(s: string): number | null {
  const ts = normalizeTimestamp(s);
  if (!ts) return null;
  return Date.UTC(+ts.slice(0, 4), +ts.slice(5, 7) - 1, +ts.slice(8, 10), +ts.slice(11, 13), +ts.slice(14, 16), +ts.slice(17, 19));
}

export function fromMs(ms: number, withTime: boolean): string {
  const d = new Date(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : date;
}

export const hasTime = (s: string) => s.length > 10;

function need(s: string): number {
  const ms = toMs(s);
  if (ms === null) throw runtimeError(`Fecha no válida: «${s}»`, "Usa el formato 'AAAA-MM-DD'");
  return ms;
}

// ───────────────────────── intervalos y modificadores ─────────────────────────

export interface Interval {
  months: number;
  days: number;
  seconds: number;
}

const UNIT = /^(year|month|week|day|hour|minute|min|second|sec|mon|yr|y|d|h|m|s)s?$/i;

/** «3 days», «1 year 2 months», «-1 day», «2 hours 30 minutes». */
export function parseInterval(text: string): Interval {
  const out: Interval = { months: 0, days: 0, seconds: 0 };
  const parts = text.trim().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) throw runtimeError(`Intervalo no válido: «${text}»`, "Por ejemplo: INTERVAL '3 days' o INTERVAL '1 month'");
  for (let i = 0; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const unit = parts[i + 1];
    if (Number.isNaN(n) || !unit || !UNIT.test(unit)) throw runtimeError(`Intervalo no válido: «${text}»`, "Por ejemplo: INTERVAL '3 days' o INTERVAL '1 month'");
    const u = unit.toLowerCase().replace(/s$/, '');
    if (u === 'year' || u === 'yr' || u === 'y') out.months += n * 12;
    else if (u === 'month' || u === 'mon') out.months += n;
    else if (u === 'week') out.days += n * 7;
    else if (u === 'day' || u === 'd') out.days += n;
    else if (u === 'hour' || u === 'h') out.seconds += n * 3600;
    else if (u === 'minute' || u === 'min' || u === 'm') out.seconds += n * 60;
    else out.seconds += n;
  }
  return out;
}

/** Suma un intervalo a una fecha (los meses respetan el fin de mes: 31 ene + 1 mes = 28/29 feb). */
export function addInterval(s: string, iv: Interval, sign = 1): string {
  const ms = need(s);
  const d = new Date(ms);
  let y = d.getUTCFullYear();
  let mo = d.getUTCMonth() + sign * iv.months;
  y += Math.floor(mo / 12);
  mo = ((mo % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(y, mo + 1));
  let t = Date.UTC(y, mo, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  t += sign * (iv.days * 86400000 + iv.seconds * 1000);
  const withTime = hasTime(s) || iv.seconds % 86400 !== 0;
  return fromMs(t, withTime);
}

export function addDays(s: string, n: number): string {
  return fromMs(need(s) + n * 86400000, hasTime(s));
}

/** Días enteros de a − b. */
export function diffDays(a: string, b: string): number {
  return Math.floor((need(a) - need(b)) / 86400000);
}

/** Modificadores al estilo SQLite: '+1 day', '-3 months', 'start of month', 'weekday 1'… Devuelve el nuevo valor. */
export function applyModifier(s: string, mod: string): string {
  const m = mod.trim().toLowerCase();
  if (m === 'start of day') return fromMs(Math.floor(need(s) / 86400000) * 86400000, hasTime(s));
  if (m === 'start of month') {
    const d = new Date(need(s));
    return fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), hasTime(s));
  }
  if (m === 'start of year') {
    const d = new Date(need(s));
    return fromMs(Date.UTC(d.getUTCFullYear(), 0, 1), hasTime(s));
  }
  if (m === 'localtime' || m === 'utc' || m === 'unixepoch' || m === 'auto') return s;
  const w = /^weekday\s+([0-6])$/.exec(m);
  if (w) {
    const ms = need(s);
    const dow = new Date(ms).getUTCDay();
    const add = (Number(w[1]) - dow + 7) % 7;
    return fromMs(ms + add * 86400000, hasTime(s));
  }
  const num = /^([+-]?\s*\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(m);
  if (num) return addInterval(s, parseInterval(`${num[1].replace(/\s+/g, '')} ${num[2]}`));
  throw runtimeError(`Modificador de fecha no válido: «${mod}»`, "Prueba con '+1 day', '-3 months', 'start of month'…");
}

// ───────────────────────── extraer y formatear ─────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);

/** Semana ISO (1–53). */
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}

export function extractField(field: string, s: string): number {
  const d = new Date(need(s));
  switch (field.toLowerCase()) {
    case 'year': case 'years': return d.getUTCFullYear();
    case 'month': case 'months': return d.getUTCMonth() + 1;
    case 'day': case 'days': return d.getUTCDate();
    case 'hour': case 'hours': return d.getUTCHours();
    case 'minute': case 'minutes': return d.getUTCMinutes();
    case 'second': case 'seconds': return d.getUTCSeconds();
    case 'dow': return d.getUTCDay();
    case 'isodow': return d.getUTCDay() || 7;
    case 'doy': return dayOfYear(d);
    case 'week': return isoWeek(d);
    case 'quarter': return Math.floor(d.getUTCMonth() / 3) + 1;
    case 'epoch': return Math.floor(d.getTime() / 1000);
    case 'decade': return Math.floor(d.getUTCFullYear() / 10);
    case 'century': return Math.ceil(d.getUTCFullYear() / 100);
  }
  throw runtimeError(`Campo de fecha no reconocido: «${field}»`, 'Usa year, month, day, hour, minute, second, dow, doy, week, quarter o epoch');
}

export function dateTrunc(unit: string, s: string): string {
  const d = new Date(need(s));
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  switch (unit.toLowerCase()) {
    case 'year': return fromMs(Date.UTC(y, 0, 1), hasTime(s));
    case 'quarter': return fromMs(Date.UTC(y, Math.floor(mo / 3) * 3, 1), hasTime(s));
    case 'month': return fromMs(Date.UTC(y, mo, 1), hasTime(s));
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
      return fromMs(Date.UTC(y, mo, d.getUTCDate() - dow), hasTime(s));
    }
    case 'day': return fromMs(Date.UTC(y, mo, d.getUTCDate()), hasTime(s));
    case 'hour': return fromMs(Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours()), true);
    case 'minute': return fromMs(Date.UTC(y, mo, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()), true);
  }
  throw runtimeError(`Unidad no reconocida: «${unit}»`, 'Usa year, quarter, month, week, day, hour o minute');
}

export function julianDay(s: string): number {
  return need(s) / 86400000 + 2440587.5;
}

/** strftime al estilo SQLite. */
export function strftime(fmt: string, s: string): string {
  const d = new Date(need(s));
  return fmt.replace(/%([a-zA-Z%])/g, (_m, c: string) => {
    switch (c) {
      case 'Y': return pad(d.getUTCFullYear(), 4);
      case 'y': return pad(d.getUTCFullYear() % 100);
      case 'm': return pad(d.getUTCMonth() + 1);
      case 'd': return pad(d.getUTCDate());
      case 'e': return String(d.getUTCDate());
      case 'H': return pad(d.getUTCHours());
      case 'M': return pad(d.getUTCMinutes());
      case 'S': return pad(d.getUTCSeconds());
      case 'j': return pad(dayOfYear(d), 3);
      case 'w': return String(d.getUTCDay());
      case 'W': return pad(Math.floor((dayOfYear(d) + 6 - ((d.getUTCDay() + 6) % 7)) / 7));
      case 'u': return String(d.getUTCDay() || 7);
      case 'a': return DAYS[d.getUTCDay()].slice(0, 3);
      case 'A': return DAYS[d.getUTCDay()];
      case 'b': return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'B': return MONTHS[d.getUTCMonth()];
      case 's': return String(Math.floor(d.getTime() / 1000));
      case 'F': return fromMs(d.getTime(), false);
      case 'T': return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      case 'J': return String(julianDay(s));
      case '%': return '%';
    }
    return `%${c}`;
  });
}

/** to_char al estilo PostgreSQL (los patrones más usados). */
export function toChar(s: string, fmt: string): string {
  const d = new Date(need(s));
  return fmt.replace(/YYYY|YY|MM|DD|DDD|HH24|HH12|HH|MI|SS|Month|Mon|Day|Dy|Q|AM|PM|am|pm/g, (p) => {
    switch (p) {
      case 'YYYY': return pad(d.getUTCFullYear(), 4);
      case 'YY': return pad(d.getUTCFullYear() % 100);
      case 'MM': return pad(d.getUTCMonth() + 1);
      case 'DD': return pad(d.getUTCDate());
      case 'DDD': return pad(dayOfYear(d), 3);
      case 'HH24': return pad(d.getUTCHours());
      case 'HH12':
      case 'HH': return pad(d.getUTCHours() % 12 || 12);
      case 'MI': return pad(d.getUTCMinutes());
      case 'SS': return pad(d.getUTCSeconds());
      case 'Month': return MONTHS[d.getUTCMonth()];
      case 'Mon': return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'Day': return DAYS[d.getUTCDay()];
      case 'Dy': return DAYS[d.getUTCDay()].slice(0, 3);
      case 'Q': return String(Math.floor(d.getUTCMonth() / 3) + 1);
      case 'AM':
      case 'PM': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      default: return d.getUTCHours() < 12 ? 'am' : 'pm';
    }
  });
}
