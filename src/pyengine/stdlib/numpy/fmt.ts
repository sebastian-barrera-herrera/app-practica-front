/**
 * Impresión de arrays igual que NumPy (`repr` y `str`): precisión de 8 decimales, alineación,
 * notación científica, resumen con `...` a partir de 1000 elementos y ajuste a 75 columnas.
 */
import { flatNum, flatStr, NdArray, type DType } from './nd';

export interface PrintOpts {
  precision: number;
  threshold: number;
  edgeitems: number;
  linewidth: number;
  suppress: boolean;
}

export const PRINT: PrintOpts = { precision: 8, threshold: 1000, edgeitems: 3, linewidth: 75, suppress: false };

// ───────────────────────── números ─────────────────────────

/** dígitos significativos más cortos que identifican a `x` y su exponente decimal: x = d.ddd × 10^e */
function sci(x: number): { d: string; e: number } {
  const s = Math.abs(x).toExponential();
  const [m, ex] = s.split('e');
  return { d: m.replace('.', ''), e: parseInt(ex, 10) };
}

/** forma posicional con a lo sumo `precision` decimales, sin ceros finales ("1." si no hay decimales) */
function positional(x: number, precision: number): { int: string; frac: string } {
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let int: string;
  let frac: string;
  if (ax === 0) {
    int = '0';
    frac = '';
  } else {
    const { d, e } = sci(ax);
    const fracDigits = Math.max(0, d.length - 1 - e);
    if (fracDigits > precision) {
      const f = ax.toFixed(precision);
      const [i, fr] = f.split('.');
      int = i;
      frac = (fr ?? '').replace(/0+$/, '');
    } else if (e >= 0) {
      int = d.slice(0, e + 1).padEnd(e + 1, '0');
      frac = d.slice(e + 1);
    } else {
      int = '0';
      frac = '0'.repeat(-e - 1) + d;
    }
  }
  return { int: (neg ? '-' : '') + int, frac };
}

function scientific(x: number, precision: number, fixedFrac?: number, expDigits = 2): string {
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let mant: string;
  let e: number;
  if (ax === 0) {
    mant = fixedFrac !== undefined ? '0.' + '0'.repeat(fixedFrac) : '0.';
    e = 0;
  } else {
    const { d, e: ex } = sci(ax);
    e = ex;
    let digits = d;
    if (digits.length - 1 > precision) {
      const [m2, ex2] = ax.toExponential(precision).split('e');
      digits = m2.replace('.', '').replace(/0+$/, '') || '0';
      e = parseInt(ex2, 10);
    }
    if (fixedFrac !== undefined) digits = digits.padEnd(fixedFrac + 1, '0').slice(0, fixedFrac + 1);
    mant = digits[0] + '.' + digits.slice(1);
  }
  const es = Math.abs(e).toString().padStart(expDigits, '0');
  return (neg ? '-' : '') + mant + 'e' + (e < 0 ? '-' : '+') + es;
}

type Fmt = (v: number) => string;

function floatFormatter(vals: Float64Array, opts: PrintOpts): Fmt {
  const finite = Array.from(vals).filter((v) => Number.isFinite(v));
  const nonZero = finite.filter((v) => v !== 0).map(Math.abs);
  let useExp = false;
  if (nonZero.length > 0) {
    const mx = Math.max(...nonZero);
    const mn = Math.min(...nonZero);
    if (mx >= 1e8 || (!opts.suppress && (mn < 0.0001 || mx / mn > 1000))) useExp = true;
  }
  let padLeft = 0;
  let padRight = 0;
  let precisionExp = 0;
  let expSize = 2;
  if (finite.length > 0) {
    if (useExp) {
      const parts = finite.map((v) => scientific(v, opts.precision));
      const fr = parts.map((s) => s.split('e')[0].split('.')[1].length);
      precisionExp = Math.max(...fr);
      expSize = Math.max(...parts.map((s) => s.split('e')[1].length - 1));
      padLeft = Math.max(...parts.map((s) => s.split('.')[0].length));
      padRight = expSize + 2 + precisionExp;
    } else {
      const parts = finite.map((v) => positional(v, opts.precision));
      padLeft = Math.max(...parts.map((p) => p.int.length));
      padRight = Math.max(...parts.map((p) => p.frac.length));
    }
  }
  if (finite.length !== vals.length) {
    const hasNegInf = Array.from(vals).some((v) => v === -Infinity);
    const offset = padRight + 1;
    padLeft = Math.max(padLeft, 3 - offset, 3 + (hasNegInf ? 1 : 0) - offset);
  }
  return (x: number): string => {
    if (!Number.isFinite(x)) {
      const ret = Number.isNaN(x) ? 'nan' : x < 0 ? '-inf' : 'inf';
      return ' '.repeat(Math.max(0, padLeft + padRight + 1 - ret.length)) + ret;
    }
    if (useExp) {
      const s = scientific(x, opts.precision, precisionExp, expSize);
      return ' '.repeat(Math.max(0, padLeft - s.split('.')[0].length)) + s;
    }
    const p = positional(x, opts.precision);
    return ' '.repeat(Math.max(0, padLeft - p.int.length)) + p.int + '.' + p.frac + ' '.repeat(padRight - p.frac.length);
  };
}

function formatterFor(a: NdArray, data: NdArray, opts: PrintOpts): Fmt {
  if (a.dtype === 'str') return (v) => pyReprStr(String(v));
  const vals = flatNum(data);
  if (a.dtype === 'bool') {
    const t = a.ndim === 0 ? 'True' : ' True';
    return (v) => (v ? t : 'False');
  }
  if (a.dtype === 'int64') {
    let w = 0;
    for (const v of vals) w = Math.max(w, String(v).length);
    return (v) => String(v).padStart(w);
  }
  return floatFormatter(vals, opts);
}

export function pyReprStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else out += ch;
  }
  return out + q;
}

// ───────────────────────── estructura ─────────────────────────

/** elementos iniciales y finales de cada eje, para calcular los anchos al resumir */
function leadingTrailing(a: NdArray, edge: number): NdArray {
  const take = (arr: NdArray, axis: number): NdArray => {
    if (axis >= arr.ndim) return arr;
    const n = arr.shape[axis];
    if (n > 2 * edge) {
      const keep = [...Array.from({ length: edge }, (_, i) => i), ...Array.from({ length: edge }, (_, i) => n - edge + i)];
      const shape = arr.shape.slice();
      shape[axis] = keep.length;
      const flatArr = arr.dtype === 'str' ? flatStr(arr) : flatNum(arr);
      const outer = arr.shape.slice(0, axis).reduce((p, s) => p * s, 1);
      const inner = arr.shape.slice(axis + 1).reduce((p, s) => p * s, 1);
      const out: any = arr.dtype === 'str' ? new Array<string>(outer * keep.length * inner) : new Float64Array(outer * keep.length * inner);
      for (let o = 0; o < outer; o++) for (let k = 0; k < keep.length; k++) for (let i = 0; i < inner; i++) out[(o * keep.length + k) * inner + i] = (flatArr as any)[(o * n + keep[k]) * inner + i];
      const res = new NdArray(out, shape, shape.reduceRight<number[]>((acc, _, i) => (i === shape.length - 1 ? [1] : [acc[0] * shape[i + 1], ...acc]), []), 0, arr.dtype);
      return take(res, axis + 1);
    }
    return take(arr, axis + 1);
  };
  return take(a, 0);
}

function extendLine(s: string, line: string, word: string, width: number, prefix: string): [string, string] {
  let wrap = line.length + word.length > width;
  if (line.length <= prefix.length) wrap = false;
  if (wrap) {
    s += line.replace(/\s+$/, '') + '\n';
    line = prefix;
  }
  line += word;
  return [s, line];
}

function formatArray(a: NdArray, fmt: Fmt, lineWidth: number, nextLinePrefix: string, separator: string, edge: number, summary: string): string {
  const flat: any = a.dtype === 'str' ? flatStr(a) : flatNum(a);
  const stride = a.shape.reduceRight<number[]>((acc, _, i) => (i === a.shape.length - 1 ? [1] : [acc[0] * a.shape[i + 1], ...acc]), []);
  const get = (index: number[]): string => {
    let p = 0;
    index.forEach((ix, d) => (p += (ix < 0 ? ix + a.shape[d] : ix) * stride[d]));
    return fmt(flat[p]);
  };
  const recurse = (index: number[], hanging: string, curWidth: number): string => {
    const axis = index.length;
    const axesLeft = a.ndim - axis;
    if (axesLeft === 0) return get(index);
    const nextHanging = hanging + ' ';
    const nextWidth = curWidth - 1;
    const len = a.shape[axis];
    const showSummary = summary !== '' && 2 * edge < len;
    const leading = showSummary ? edge : 0;
    const trailing = showSummary ? edge : len;
    let s = '';
    if (axesLeft === 1) {
      const elemWidth = curWidth - Math.max(separator.replace(/\s+$/, '').length, 1);
      let line = hanging;
      for (let i = 0; i < leading; i++) {
        const word = recurse([...index, i], nextHanging, nextWidth);
        [s, line] = extendLine(s, line, word, elemWidth, hanging);
        line += separator;
      }
      if (showSummary) {
        [s, line] = extendLine(s, line, summary, elemWidth, hanging);
        line += separator;
      }
      for (let i = trailing; i > 1; i--) {
        const word = recurse([...index, -i], nextHanging, nextWidth);
        [s, line] = extendLine(s, line, word, elemWidth, hanging);
        line += separator;
      }
      const word = recurse([...index, -1], nextHanging, nextWidth);
      [s, line] = extendLine(s, line, word, curWidth - Math.max(separator.replace(/\s+$/, '').length, 1), hanging);
      s += line;
    } else {
      const lineSep = separator.replace(/\s+$/, '') + '\n'.repeat(axesLeft - 1);
      for (let i = 0; i < leading; i++) s += hanging + recurse([...index, i], nextHanging, nextWidth) + lineSep;
      if (showSummary) s += hanging + summary + lineSep;
      for (let i = trailing; i > 1; i--) s += hanging + recurse([...index, -i], nextHanging, nextWidth) + lineSep;
      s += hanging + recurse([...index, -1], nextHanging, nextWidth);
    }
    return '[' + s.slice(hanging.length) + ']';
  };
  return recurse([], nextLinePrefix, lineWidth);
}

export function array2string(a: NdArray, separator: string, prefix: string, suffix: string, opts: PrintOpts = PRINT): string {
  const summary = a.size > opts.threshold ? '...' : '';
  const data = summary ? leadingTrailing(a, opts.edgeitems) : a;
  if (a.size === 0 && a.ndim > 0) return '[]';
  const fmt = formatterFor(a, data, opts);
  if (a.ndim === 0) return fmt(a.dtype === 'str' ? (flatStr(a)[0] as any) : flatNum(a)[0]);
  return formatArray(a, fmt, opts.linewidth - suffix.length, ' ' + ' '.repeat(prefix.length), separator, opts.edgeitems, summary);
}

export function dtypeName(d: DType, a?: NdArray): string {
  if (d === 'str') {
    const w = a ? Math.max(1, ...flatStr(a).map((s) => [...s].length)) : 1;
    return `<U${w}`;
  }
  return d;
}

export function arrayRepr(a: NdArray): string {
  const implied = a.dtype !== 'str';
  const dt = a.dtype === 'str' ? `dtype='${dtypeName(a.dtype, a)}'` : `dtype=${a.dtype}`;
  let lst: string;
  if (a.size > 0 || (a.ndim === 1 && a.shape[0] === 0)) lst = array2string(a, ', ', 'array(', ')');
  else lst = `[], shape=(${a.shape.join(', ')}${a.shape.length === 1 ? ',' : ''})`;
  const arrStr = 'array(' + lst;
  if (implied && a.size > 0) return arrStr + ')';
  const lastLine = lst.length - (lst.lastIndexOf('\n') + 1);
  const spacer = lastLine + dt.length + 1 > PRINT.linewidth ? '\n' + ' '.repeat('array('.length) : ' ';
  return arrStr + ',' + spacer + dt + ')';
}

export function arrayStr(a: NdArray): string {
  if (a.ndim === 0) {
    return a.dtype === 'str' ? flatStr(a)[0] : a.dtype === 'bool' ? (flatNum(a)[0] ? 'True' : 'False') : a.dtype === 'int64' ? String(flatNum(a)[0]) : floatScalarStr(flatNum(a)[0]);
  }
  return array2string(a, ' ', '', '');
}

/** `str(np.float64(x))`: el repr más corto del número, como el `float` de Python */
export function floatScalarStr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return Object.is(x, -0) ? '-0.0' : x.toFixed(1);
  const ax = Math.abs(x);
  if (ax >= 1e16 || ax < 1e-4) {
    const { d, e } = sci(ax);
    return (x < 0 ? '-' : '') + d[0] + (d.length > 1 ? '.' + d.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + Math.abs(e).toString().padStart(2, '0');
  }
  return String(x);
}
