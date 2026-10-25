/** Funciones escalares de SQL (texto, números, fechas…). */
import { addDays, addInterval, applyModifier, dateTrunc, diffDays, extractField, fromMs, hasTime, julianDay, normalizeDate, normalizeTimestamp, parseInterval, strftime, toChar, toMs } from './dates';
import { constraintError, runtimeError, typeError, type SqlType, type Value } from './types';
import { compareValues, formatNumber, globToRegExp, roundHalfAway, typeOfValue, unifyTypes } from './values';

export interface FnCtx {
  now: string;
  rand: () => number;
}

export interface FnDef {
  min: number;
  max?: number;
  /** Tipo del resultado según los tipos de los argumentos. */
  ret: SqlType | ((t: SqlType[]) => SqlType);
  /** true = el resultado es NULL si algún argumento es NULL (lo habitual). */
  strict?: boolean;
  impl: (a: Value[], c: FnCtx, t: SqlType[]) => Value;
}

const str = (v: Value): string => (typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 'int' : 'real') : '');
const num = (v: Value, fn: string): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    if (v.trim() !== '' && !Number.isNaN(n)) return n;
    throw typeError(`${fn.toUpperCase()}() necesita un número y recibió el texto «${v.length > 20 ? v.slice(0, 20) + '…' : v}»`, 'Convierte con CAST(valor AS INTEGER) si hace falta');
  }
  return 0;
};
const int = (v: Value, fn: string): number => Math.trunc(num(v, fn));

const same = (t: SqlType[]): SqlType => t.reduce((a, b) => unifyTypes(a, b), 'null' as SqlType);
const numeric = (t: SqlType[]): SqlType => (t[0] === 'int' ? 'int' : t[0] === 'real' ? 'real' : 'any');

const dateOrTs = (t: SqlType[]): SqlType => (t[0] === 'date' ? 'date' : t[0] === 'timestamp' ? 'timestamp' : 'any');

function initcap(s: string): string {
  return s.toLowerCase().replace(/(^|[^a-záéíóúñü0-9])([a-záéíóúñü])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

function pad(s: string, n: number, fill: string, left: boolean): string {
  if (n <= 0) return '';
  if (s.length >= n) return s.slice(0, n);
  if (!fill) return s;
  let p = '';
  while (p.length < n - s.length) p += fill;
  p = p.slice(0, n - s.length);
  return left ? p + s : s + p;
}

function trimChars(s: string, chars: string, left: boolean, right: boolean): string {
  let a = 0;
  let b = s.length;
  if (left) while (a < b && chars.includes(s[a])) a++;
  if (right) while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function substr(s: string, start: number, len?: number): string {
  // SQL cuenta desde 1; un inicio ≤ 0 «se come» parte de la longitud (como PostgreSQL)
  let from = start;
  let to = len === undefined ? s.length + 1 : start + len;
  if (len !== undefined && len < 0) throw runtimeError('La longitud de SUBSTRING no puede ser negativa');
  from = Math.max(1, from);
  to = Math.min(s.length + 1, to);
  return to <= from ? '' : s.slice(from - 1, to - 1);
}

function formatPrintf(fmt: string, args: Value[]): string {
  let i = 0;
  return fmt.replace(/%(-?\d*)(?:\.(\d+))?([sdfi%])/g, (_m, w: string, p: string | undefined, c: string) => {
    if (c === '%') return '%';
    const v = args[i++] ?? null;
    let out: string;
    if (c === 's') out = v === null ? '' : str(v);
    else if (c === 'd' || c === 'i') out = v === null ? '' : String(Math.trunc(Number(v)));
    else out = v === null ? '' : p !== undefined ? Number(v).toFixed(Number(p)) : String(Number(v));
    const width = Number(w.replace('-', '') || 0);
    return out.length >= width ? out : w.startsWith('-') ? out.padEnd(width) : out.padStart(width);
  });
}

const D = (s: Value): string => String(s);

export const SCALARS: Record<string, FnDef> = {
  // ───── texto ─────
  upper: { min: 1, max: 1, ret: 'text', strict: true, impl: ([s]) => str(s).toUpperCase() },
  lower: { min: 1, max: 1, ret: 'text', strict: true, impl: ([s]) => str(s).toLowerCase() },
  length: { min: 1, max: 1, ret: 'int', strict: true, impl: ([s]) => str(s).length },
  char_length: { min: 1, max: 1, ret: 'int', strict: true, impl: ([s]) => str(s).length },
  character_length: { min: 1, max: 1, ret: 'int', strict: true, impl: ([s]) => str(s).length },
  octet_length: { min: 1, max: 1, ret: 'int', strict: true, impl: ([s]) => unescape(encodeURIComponent(str(s))).length },
  substr: { min: 2, max: 3, ret: 'text', strict: true, impl: ([s, a, b]) => substr(str(s), int(a, 'substr'), b === undefined ? undefined : int(b, 'substr')) },
  substring: { min: 2, max: 3, ret: 'text', strict: true, impl: ([s, a, b]) => substr(str(s), int(a, 'substring'), b === undefined ? undefined : int(b, 'substring')) },
  trim: { min: 1, max: 2, ret: 'text', strict: true, impl: ([s, c]) => trimChars(str(s), c === undefined ? ' \t\n\r' : str(c), true, true) },
  ltrim: { min: 1, max: 2, ret: 'text', strict: true, impl: ([s, c]) => trimChars(str(s), c === undefined ? ' \t\n\r' : str(c), true, false) },
  rtrim: { min: 1, max: 2, ret: 'text', strict: true, impl: ([s, c]) => trimChars(str(s), c === undefined ? ' \t\n\r' : str(c), false, true) },
  replace: { min: 3, max: 3, ret: 'text', strict: true, impl: ([s, a, b]) => (str(a) === '' ? str(s) : str(s).split(str(a)).join(str(b))) },
  instr: { min: 2, max: 2, ret: 'int', strict: true, impl: ([s, sub]) => str(s).indexOf(str(sub)) + 1 },
  strpos: { min: 2, max: 2, ret: 'int', strict: true, impl: ([s, sub]) => str(s).indexOf(str(sub)) + 1 },
  position: { min: 2, max: 2, ret: 'int', strict: true, impl: ([s, sub]) => str(s).indexOf(str(sub)) + 1 },
  concat: { min: 1, ret: 'text', impl: (a) => a.map((v) => (v === null ? '' : str(v))).join('') },
  concat_ws: { min: 2, ret: 'text', impl: ([sep, ...rest]) => (sep === null ? null : rest.filter((v) => v !== null).map(str).join(str(sep))) },
  left: { min: 2, max: 2, ret: 'text', strict: true, impl: ([s, n]) => (int(n, 'left') >= 0 ? str(s).slice(0, int(n, 'left')) : str(s).slice(0, Math.max(0, str(s).length + int(n, 'left')))) },
  right: { min: 2, max: 2, ret: 'text', strict: true, impl: ([s, n]) => (int(n, 'right') >= 0 ? str(s).slice(Math.max(0, str(s).length - int(n, 'right'))) : str(s).slice(-int(n, 'right'))) },
  reverse: { min: 1, max: 1, ret: 'text', strict: true, impl: ([s]) => [...str(s)].reverse().join('') },
  repeat: { min: 2, max: 2, ret: 'text', strict: true, impl: ([s, n]) => str(s).repeat(Math.max(0, Math.min(1000, int(n, 'repeat')))) },
  lpad: { min: 2, max: 3, ret: 'text', strict: true, impl: ([s, n, f]) => pad(str(s), int(n, 'lpad'), f === undefined ? ' ' : str(f), true) },
  rpad: { min: 2, max: 3, ret: 'text', strict: true, impl: ([s, n, f]) => pad(str(s), int(n, 'rpad'), f === undefined ? ' ' : str(f), false) },
  initcap: { min: 1, max: 1, ret: 'text', strict: true, impl: ([s]) => initcap(str(s)) },
  split_part: {
    min: 3,
    max: 3,
    ret: 'text',
    strict: true,
    impl: ([s, d, n]) => {
      const k = int(n, 'split_part');
      if (k === 0) throw runtimeError('SPLIT_PART: la posición no puede ser 0 (empieza en 1)');
      const parts = str(s).split(str(d));
      return (k > 0 ? parts[k - 1] : parts[parts.length + k]) ?? '';
    },
  },
  ascii: { min: 1, max: 1, ret: 'int', strict: true, impl: ([s]) => str(s).charCodeAt(0) || 0 },
  chr: { min: 1, max: 1, ret: 'text', strict: true, impl: ([n]) => String.fromCodePoint(int(n, 'chr')) },
  starts_with: { min: 2, max: 2, ret: 'bool', strict: true, impl: ([s, p]) => str(s).startsWith(str(p)) },
  ends_with: { min: 2, max: 2, ret: 'bool', strict: true, impl: ([s, p]) => str(s).endsWith(str(p)) },
  format: { min: 1, ret: 'text', impl: ([f, ...rest]) => (f === null ? null : formatPrintf(str(f), rest)) },
  printf: { min: 1, ret: 'text', impl: ([f, ...rest]) => (f === null ? null : formatPrintf(str(f), rest)) },
  regexp_replace: {
    min: 3,
    max: 4,
    ret: 'text',
    strict: true,
    impl: ([s, p, r, f]) => {
      try {
        const flags = f === undefined ? '' : str(f);
        return str(s).replace(new RegExp(str(p), flags.includes('g') ? (flags.includes('i') ? 'gi' : 'g') : flags.includes('i') ? 'i' : ''), str(r).replace(/\\(\d)/g, '$$$1'));
      } catch {
        throw runtimeError(`Expresión regular no válida: «${str(p)}»`);
      }
    },
  },
  regexp_like: {
    min: 2,
    max: 3,
    ret: 'bool',
    strict: true,
    impl: ([s, p, f]) => {
      try {
        return new RegExp(str(p), f !== undefined && str(f).includes('i') ? 'i' : '').test(str(s));
      } catch {
        throw runtimeError(`Expresión regular no válida: «${str(p)}»`);
      }
    },
  },
  translate: {
    min: 3,
    max: 3,
    ret: 'text',
    strict: true,
    impl: ([s, from, to]) => {
      const f = str(from);
      const t = str(to);
      return [...str(s)].map((c) => { const i = f.indexOf(c); return i < 0 ? c : t[i] ?? ''; }).join('');
    },
  },

  // ───── números ─────
  abs: { min: 1, max: 1, ret: numeric, strict: true, impl: ([x]) => Math.abs(num(x, 'abs')) },
  sign: { min: 1, max: 1, ret: 'int', strict: true, impl: ([x]) => Math.sign(num(x, 'sign')) },
  round: {
    min: 1,
    max: 2,
    ret: (t) => (t[0] === 'int' && t.length < 2 ? 'int' : t[0] === 'int' ? 'int' : 'real'),
    strict: true,
    impl: ([x, d]) => roundHalfAway(num(x, 'round'), d === undefined ? 0 : int(d, 'round')),
  },
  ceil: { min: 1, max: 1, ret: (t) => (t[0] === 'int' ? 'int' : 'real'), strict: true, impl: ([x]) => Math.ceil(num(x, 'ceil')) },
  ceiling: { min: 1, max: 1, ret: (t) => (t[0] === 'int' ? 'int' : 'real'), strict: true, impl: ([x]) => Math.ceil(num(x, 'ceiling')) },
  floor: { min: 1, max: 1, ret: (t) => (t[0] === 'int' ? 'int' : 'real'), strict: true, impl: ([x]) => Math.floor(num(x, 'floor')) },
  trunc: {
    min: 1,
    max: 2,
    ret: (t) => (t[0] === 'int' ? 'int' : 'real'),
    strict: true,
    impl: ([x, d]) => {
      const n = d === undefined ? 0 : int(d, 'trunc');
      const f = 10 ** n;
      return Math.trunc(num(x, 'trunc') * f) / f;
    },
  },
  truncate: {
    min: 1,
    max: 2,
    ret: (t) => (t[0] === 'int' ? 'int' : 'real'),
    strict: true,
    impl: ([x, d]) => {
      const f = 10 ** (d === undefined ? 0 : int(d, 'truncate'));
      return Math.trunc(num(x, 'truncate') * f) / f;
    },
  },
  sqrt: {
    min: 1,
    max: 1,
    ret: 'real',
    strict: true,
    impl: ([x]) => {
      const n = num(x, 'sqrt');
      if (n < 0) throw runtimeError('No se puede calcular la raíz cuadrada de un número negativo');
      return Math.sqrt(n);
    },
  },
  power: { min: 2, max: 2, ret: 'real', strict: true, impl: ([a, b]) => num(a, 'power') ** num(b, 'power') },
  pow: { min: 2, max: 2, ret: 'real', strict: true, impl: ([a, b]) => num(a, 'pow') ** num(b, 'pow') },
  mod: {
    min: 2,
    max: 2,
    ret: same,
    strict: true,
    impl: ([a, b]) => {
      if (num(b, 'mod') === 0) throw runtimeError('División por cero');
      return num(a, 'mod') % num(b, 'mod');
    },
  },
  exp: { min: 1, max: 1, ret: 'real', strict: true, impl: ([x]) => Math.exp(num(x, 'exp')) },
  ln: { min: 1, max: 1, ret: 'real', strict: true, impl: ([x]) => Math.log(num(x, 'ln')) },
  log: { min: 1, max: 2, ret: 'real', strict: true, impl: ([a, b]) => (b === undefined ? Math.log10(num(a, 'log')) : Math.log(num(b, 'log')) / Math.log(num(a, 'log'))) },
  log10: { min: 1, max: 1, ret: 'real', strict: true, impl: ([x]) => Math.log10(num(x, 'log10')) },
  pi: { min: 0, max: 0, ret: 'real', impl: () => Math.PI },
  random: { min: 0, max: 0, ret: 'real', impl: (_a, c) => c.rand() },
  greatest: {
    min: 1,
    ret: same,
    impl: (a) => a.filter((v) => v !== null).reduce<Value>((m, v) => (m === null || compareValues(v, m) > 0 ? v : m), null),
  },
  least: {
    min: 1,
    ret: same,
    impl: (a) => a.filter((v) => v !== null).reduce<Value>((m, v) => (m === null || compareValues(v, m) < 0 ? v : m), null),
  },

  // ───── nulos y condiciones ─────
  coalesce: { min: 1, ret: same, impl: (a) => a.find((v) => v !== null) ?? null },
  ifnull: { min: 2, max: 2, ret: same, impl: ([a, b]) => a ?? b },
  nvl: { min: 2, max: 2, ret: same, impl: ([a, b]) => a ?? b },
  nullif: { min: 2, max: 2, ret: (t) => t[0], impl: ([a, b]) => (a !== null && b !== null && compareValues(a, b) === 0 ? null : a) },
  iif: { min: 3, max: 3, ret: (t) => unifyTypes(t[1], t[2]), impl: ([c, a, b]) => (c !== null && c !== false && c !== 0 ? a : b) },
  typeof: { min: 1, max: 1, ret: 'text', impl: ([v]) => ({ null: 'null', int: 'integer', real: 'real', text: 'text', bool: 'integer', any: 'text', date: 'text', timestamp: 'text' })[typeOfValue(v)] },
  pg_typeof: { min: 1, max: 1, ret: 'text', impl: ([v], _c, t) => ({ int: 'integer', real: 'double precision', text: 'text', bool: 'boolean', date: 'date', timestamp: 'timestamp', null: 'unknown', any: typeOfValue(v) === 'int' ? 'integer' : typeOfValue(v) })[t[0] === 'any' ? typeOfValue(v) : t[0]] ?? 'text' },
  raise: {
    min: 2,
    max: 2,
    ret: 'null',
    impl: ([kind, msg]) => {
      const k = str(kind).toUpperCase();
      if (k === 'IGNORE') return null;
      throw constraintError(str(msg));
    },
  },

  // ───── fechas ─────
  current_date: { min: 0, max: 0, ret: 'date', impl: (_a, c) => c.now.slice(0, 10) },
  current_timestamp: { min: 0, max: 0, ret: 'timestamp', impl: (_a, c) => c.now },
  localtimestamp: { min: 0, max: 0, ret: 'timestamp', impl: (_a, c) => c.now },
  current_time: { min: 0, max: 0, ret: 'text', impl: (_a, c) => c.now.slice(11) },
  now: { min: 0, max: 0, ret: 'timestamp', impl: (_a, c) => c.now },
  date: {
    min: 1,
    ret: 'date',
    strict: true,
    impl: ([x, ...mods], c) => {
      const base = D(x) === 'now' ? c.now : normalizeTimestamp(D(x));
      if (!base) return null;
      return mods.reduce<string>((acc, m) => applyModifier(acc, D(m)), base).slice(0, 10);
    },
  },
  datetime: {
    min: 1,
    ret: 'timestamp',
    strict: true,
    impl: ([x, ...mods], c) => {
      const base = D(x) === 'now' ? c.now : normalizeTimestamp(D(x));
      if (!base) return null;
      const out = mods.reduce<string>((acc, m) => applyModifier(acc, D(m)), base);
      return out.length === 10 ? `${out} 00:00:00` : out;
    },
  },
  time: { min: 1, ret: 'text', strict: true, impl: ([x], c) => (D(x) === 'now' ? c.now : normalizeTimestamp(D(x)) ?? '').slice(11) || null },
  strftime: { min: 2, ret: 'text', strict: true, impl: ([f, x, ...mods], c) => { const base = D(x) === 'now' ? c.now : normalizeTimestamp(D(x)); return base ? strftime(D(f), mods.reduce<string>((a, m) => applyModifier(a, D(m)), base)) : null; } },
  julianday: { min: 1, max: 1, ret: 'real', strict: true, impl: ([x], c) => julianDay(D(x) === 'now' ? c.now : normalizeTimestamp(D(x)) ?? D(x)) },
  to_char: { min: 2, max: 2, ret: 'text', strict: true, impl: ([x, f]) => toChar(D(x), D(f)) },
  date_part: { min: 2, max: 2, ret: 'int', strict: true, impl: ([f, x]) => extractField(D(f), D(x)) },
  date_trunc: { min: 2, max: 2, ret: (t) => (t[1] === 'date' ? 'date' : 'timestamp'), strict: true, impl: ([u, x]) => dateTrunc(D(u), D(x)) },
  datediff: { min: 2, max: 2, ret: 'int', strict: true, impl: ([a, b]) => diffDays(D(a), D(b)) },
  date_add: { min: 2, max: 2, ret: dateOrTs, strict: true, impl: ([a, n]) => addDays(D(a), int(n, 'date_add')) },
  make_date: {
    min: 3,
    max: 3,
    ret: 'date',
    strict: true,
    impl: ([y, m, d]) => {
      const out = normalizeDate(`${int(y, 'make_date')}-${int(m, 'make_date')}-${int(d, 'make_date')}`);
      if (!out) throw runtimeError('make_date: fecha no válida');
      return out;
    },
  },
  age_days: { min: 2, max: 2, ret: 'int', strict: true, impl: ([a, b]) => diffDays(D(a), D(b)) },
  __interval: { min: 1, max: 1, ret: 'text', strict: true, impl: ([s]) => `interval:${D(s)}` },
  __glob: { min: 2, max: 2, ret: 'bool', strict: true, impl: ([s, p]) => globMatch(str(s), str(p)) },
  __not_glob: { min: 2, max: 2, ret: 'bool', strict: true, impl: ([s, p]) => !globMatch(str(s), str(p)) },
};

function globMatch(s: string, p: string): boolean {
  return globToRegExp(p).test(s);
}

/** Suma/resta de fechas con enteros e intervalos: fecha ± días, fecha ± INTERVAL, fecha − fecha. */
export function dateArith(op: '+' | '-', a: Value, b: Value, ta: SqlType, tb: SqlType): { v: Value; type: SqlType } | null {
  const isDateT = (t: SqlType) => t === 'date' || t === 'timestamp';
  const interval = (v: Value) => typeof v === 'string' && v.startsWith('interval:');
  if (isDateT(ta) && interval(b)) {
    if (a === null) return { v: null, type: ta };
    return { v: addInterval(String(a), parseInterval(String(b).slice(9)), op === '+' ? 1 : -1), type: ta === 'date' && !/hour|minute|second/i.test(String(b)) ? 'date' : 'timestamp' };
  }
  if (op === '+' && interval(a) && isDateT(tb)) return dateArith('+', b, a, tb, ta);
  if (isDateT(ta) && (tb === 'int' || tb === 'real')) {
    if (a === null || b === null) return { v: null, type: ta };
    return { v: addDays(String(a), (op === '+' ? 1 : -1) * Number(b)), type: ta };
  }
  if (op === '+' && (ta === 'int' || ta === 'real') && isDateT(tb)) return dateArith('+', b, a, tb, ta);
  if (op === '-' && isDateT(ta) && isDateT(tb)) {
    if (a === null || b === null) return { v: null, type: 'int' };
    return { v: diffDays(String(a), String(b)), type: 'int' };
  }
  return null;
}

export { fromMs, hasTime, toMs };
