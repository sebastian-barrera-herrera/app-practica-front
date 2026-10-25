/** Valores de SQL: comparación, coerciones, aritmética, LIKE y formato. */
import type { TypeName } from './ast';
import { runtimeError, typeError, type SqlType, type Value } from './types';
import { isValidDate, normalizeDate, normalizeTimestamp } from './dates';

export const isNull = (v: Value): v is null => v === null;

/** Orden de los tipos al comparar valores distintos: NULL < número < texto. (Solo se usa si no hay conversión posible.) */
const rank = (v: Value): number => (v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : 3);

const NUM_RE = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;
export const looksNumeric = (s: string): boolean => NUM_RE.test(s);

/**
 * Compara dos valores no nulos: <0, 0, >0.
 * Números con números, textos con textos. Un texto contra un número se compara como número si parece uno
 * (así `edad = '30'` funciona) y, si no, como texto.
 */
export function compareValues(a: Value, b: Value): number {
  if (a === b) return 0;
  const ta = typeof a;
  const tb = typeof b;
  if (ta === 'number' && tb === 'number') return (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
  if (ta === 'string' && tb === 'string') return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ta === 'boolean' && tb === 'boolean') return Number(a) - Number(b);
  if (ta === 'boolean' || tb === 'boolean') return compareValues(toNum(a), toNum(b));
  // número contra texto
  if (ta === 'number' && tb === 'string') return looksNumeric(b as string) ? compareValues(a, Number(b)) : compareValues(String(a), b);
  if (ta === 'string' && tb === 'number') return looksNumeric(a as string) ? compareValues(Number(a), b) : compareValues(a, String(b));
  return rank(a) - rank(b);
}

function toNum(v: Value): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

/** Orden total para ORDER BY: los NULL cuentan como lo más grande (como en PostgreSQL). */
export function sortCompare(a: Value, b: Value): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  return compareValues(a, b);
}

/** Clave de texto para agrupar / DISTINCT / hash (los NULL se agrupan juntos, 1 y 1.0 son lo mismo). */
export function keyOf(v: Value): string {
  if (v === null) return '\u0000n';
  if (typeof v === 'number') return `\u0000#${v}`;
  if (typeof v === 'boolean') return `\u0000#${v ? 1 : 0}`;
  return `s${v}`;
}

export const rowKey = (vals: Value[]): string => vals.map(keyOf).join('\u0001');

// ───────────────────────── lógica de tres valores ─────────────────────────

/** ¿El valor cuenta como verdadero en un WHERE/HAVING/ON? (NULL y falso → no) */
export function truthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v !== '' && v.toLowerCase() !== 'false' && v.toLowerCase() !== 'f' && v !== '0';
}

/** Verdadero/falso/NULL como booleano de 3 valores. */
export function toBool3(v: Value): boolean | null {
  if (v === null) return null;
  return truthy(v);
}

export const and3 = (a: boolean | null, b: boolean | null): boolean | null => (a === false || b === false ? false : a === null || b === null ? null : true);
export const or3 = (a: boolean | null, b: boolean | null): boolean | null => (a === true || b === true ? true : a === null || b === null ? null : false);

// ───────────────────────── aritmética ─────────────────────────

const MAX_INT = Number.MAX_SAFE_INTEGER;

export function arith(op: string, a: Value, b: Value, ta: SqlType, tb: SqlType): Value {
  if (a === null || b === null) return null;
  const x = numberOf(a, op);
  const y = numberOf(b, op);
  // la división y las sumas entre enteros se quedan enteras
  const bothInt = isIntLike(ta, x) && isIntLike(tb, y);
  switch (op) {
    case '+': {
      const r = x + y;
      return checkInt(r, bothInt);
    }
    case '-': {
      const r = x - y;
      return checkInt(r, bothInt);
    }
    case '*': {
      const r = x * y;
      return checkInt(r, bothInt);
    }
    case '/':
      if (y === 0) throw runtimeError('División por cero', 'Comprueba el divisor, o usa NULLIF(divisor, 0) para evitar el error');
      return bothInt ? Math.trunc(x / y) : x / y;
    case '%':
      if (y === 0) throw runtimeError('División por cero', 'Comprueba el divisor, o usa NULLIF(divisor, 0) para evitar el error');
      return x % y;
  }
  throw runtimeError(`Operador desconocido «${op}»`);
}

function isIntLike(t: SqlType, v: number): boolean {
  if (t === 'int') return true;
  if (t === 'real') return false;
  return Number.isInteger(v);
}

function checkInt(r: number, bothInt: boolean): number {
  if (bothInt && Math.abs(r) > MAX_INT) throw runtimeError('El entero se sale de rango (desbordamiento)', 'Usa números decimales (REAL) para valores tan grandes');
  return r;
}

export function numberOf(v: Value, op = ''): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    if (looksNumeric(v)) return Number(v);
    throw typeError(`No se puede usar el texto «${v.length > 24 ? v.slice(0, 24) + '…' : v}» como número${op ? ` con el operador ${op}` : ''}`, 'Convierte el texto con CAST(columna AS INTEGER), o usa || para unir textos');
  }
  return 0;
}

// ───────────────────────── tipos y conversiones ─────────────────────────

export function typeLabel(t: SqlType): string {
  return { int: 'entero', real: 'decimal', text: 'texto', bool: 'booleano', date: 'fecha', timestamp: 'fecha y hora', null: 'NULL', any: 'valor' }[t];
}

/** Tipo del resultado al mezclar dos tipos (CASE, UNION, COALESCE…). */
export function unifyTypes(a: SqlType, b: SqlType): SqlType {
  if (a === b) return a;
  if (a === 'null') return b;
  if (b === 'null') return a;
  if ((a === 'int' && b === 'real') || (a === 'real' && b === 'int')) return 'real';
  if ((a === 'date' && b === 'timestamp') || (a === 'timestamp' && b === 'date')) return 'timestamp';
  return 'any';
}

/** El tipo de un valor suelto (para columnas de tipo `any`). */
export function typeOfValue(v: Value): SqlType {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'real';
  return 'text';
}

const TRUE_WORDS = new Set(['true', 't', 'yes', 'y', 'on', '1']);
const FALSE_WORDS = new Set(['false', 'f', 'no', 'n', 'off', '0']);

/** Convierte un valor al tipo pedido (CAST y asignación a columnas). `label` ayuda a escribir el error. */
export function castValue(v: Value, to: TypeName, label?: string): Value {
  if (v === null) return null;
  const where = label ? ` (columna «${label}»)` : '';
  switch (to.base) {
    case 'int': {
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return Math.round(v) === v ? v : roundHalfAway(v, 0);
      const s = String(v).trim();
      if (!looksNumeric(s)) throw typeError(`Sintaxis de entrada no válida para tipo ${to.raw.toUpperCase() || 'INTEGER'}: «${String(v)}»${where}`, 'Un entero solo lleva dígitos (y un signo): 42, -7');
      return roundHalfAway(Number(s), 0);
    }
    case 'real': {
      if (typeof v === 'boolean') return v ? 1 : 0;
      let n: number;
      if (typeof v === 'number') n = v;
      else {
        const s = String(v).trim();
        if (!looksNumeric(s)) throw typeError(`Sintaxis de entrada no válida para tipo ${to.raw.toUpperCase() || 'REAL'}: «${String(v)}»${where}`, 'Un decimal lleva dígitos y un punto: 3.14');
        n = Number(s);
      }
      return to.scale != null ? roundHalfAway(n, to.scale) : n;
    }
    case 'text': {
      const s = typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 'int' : 'real') : v;
      if (to.len != null && s.length > to.len) {
        throw typeError(`El valor es demasiado largo para el tipo ${to.raw.toUpperCase()}(${to.len})${where}`, `Tiene ${s.length} caracteres y el máximo es ${to.len}`);
      }
      return s;
    }
    case 'bool': {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = v.trim().toLowerCase();
      if (TRUE_WORDS.has(s)) return true;
      if (FALSE_WORDS.has(s)) return false;
      throw typeError(`Sintaxis de entrada no válida para tipo BOOLEAN: «${v}»${where}`, 'Usa TRUE o FALSE');
    }
    case 'date': {
      const s = String(v);
      const d = normalizeDate(s);
      if (d === null) throw typeError(`Fecha no válida: «${s}»${where}`, isValidDate(s.slice(0, 10)) ? undefined : "Las fechas se escriben 'AAAA-MM-DD', por ejemplo '2024-03-15'");
      return d;
    }
    case 'timestamp': {
      const s = String(v);
      const d = normalizeTimestamp(s);
      if (d === null) throw typeError(`Fecha y hora no válidas: «${s}»${where}`, "Usa 'AAAA-MM-DD HH:MM:SS', por ejemplo '2024-03-15 18:30:00'");
      return d;
    }
    case 'null':
    case 'any':
      return v;
  }
}

/** Redondeo «hacia fuera» (2,5 → 3 y −2,5 → −3), como hace SQL. */
export function roundHalfAway(x: number, digits: number): number {
  if (!isFinite(x)) return x;
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const f = 10 ** digits;
  // la conversión por texto evita errores como 1.005 * 100 = 100.49999999999999
  const r = digits >= 0 ? Number(`${Math.round(Number(`${a}e${digits}`))}e-${digits}`) : Math.round(a * f) / f;
  return sign * (isNaN(r) ? Math.round(a * f) / f : r);
}

// ───────────────────────── formato ─────────────────────────

export function formatNumber(v: number, type: SqlType): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  if (type === 'real' || (type === 'any' && !Number.isInteger(v))) {
    // 15 cifras significativas: 0.1 + 0.2 se ve como 0.3, no 0.30000000000000004
    const t = Number(v.toPrecision(15));
    const s = String(t);
    if (s.includes('e')) return s;
    return Number.isInteger(t) ? `${s}.0` : s;
  }
  return String(v);
}

/** Texto con el que se enseña un valor en una tabla de resultados. */
export function formatValue(v: Value, type: SqlType): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return formatNumber(v, type);
  return v;
}

// ───────────────────────── LIKE ─────────────────────────

const likeCache = new Map<string, RegExp>();

/** LIKE de SQL: % = cualquier texto, _ = un carácter. */
export function likeToRegExp(pattern: string, esc: string | undefined, ci: boolean): RegExp {
  const key = `${ci ? 'i' : 's'}|${esc ?? ''}|${pattern}`;
  const hit = likeCache.get(key);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (esc && c === esc && i + 1 < pattern.length) {
      re += escapeRe(pattern[++i]);
    } else if (c === '%') re += '[\\s\\S]*';
    else if (c === '_') re += '[\\s\\S]';
    else re += escapeRe(c);
  }
  const r = new RegExp(`^${re}$`, ci ? 'i' : '');
  if (likeCache.size > 500) likeCache.clear();
  likeCache.set(key, r);
  return r;
}

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** GLOB (estilo SQLite): * y ? con mayúsculas y minúsculas distintas. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '[\\s\\S]*';
    else if (c === '?') re += '[\\s\\S]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end > i) {
        re += `[${pattern.slice(i + 1, end).replace(/^\^/, '^')}]`;
        i = end;
      } else re += '\\[';
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}
