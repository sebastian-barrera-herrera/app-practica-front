/**
 * Operaciones de NumPy sobre `NdArray`: aritmética con reglas de tipos, funciones universales, producto matricial,
 * einsum, concatenación, unicidad, histogramas, percentiles… (funciones puras de TypeScript; el pegamento con Python
 * está en `module.ts`).
 */
import { valueError, typeError } from '../../runtime/errors';
import {
  accumulate, argReduce, astype, broadcastShapes, broadcastTo, cmpNum, copyOf, cStrides, ewBinary, ewUnary, flatNum, flatStr, mkNum, mkStr,
  normAxis, NdArray, offsetsOf, promote, reduceAxes, reshapeTo, scalarArray, shapeStr, sizeOf, sortAxis, transposeAxes, type DType,
} from './nd';

// ───────────────────────── aritmética ─────────────────────────

export type ArithOp = 'add' | 'sub' | 'mul' | 'div' | 'floordiv' | 'mod' | 'pow' | 'max' | 'min' | 'arctan2' | 'hypot';

const pyMod = (x: number, y: number): number => {
  if (y === 0) return NaN;
  const r = x % y;
  return r !== 0 && r < 0 !== y < 0 ? r + y : r;
};
const pyFloorDiv = (x: number, y: number): number => (y === 0 ? (x === 0 || x !== x ? NaN : x > 0 ? Infinity : -Infinity) : Math.floor(x / y));

const ARITH: Record<ArithOp, (x: number, y: number) => number> = {
  add: (x, y) => x + y,
  sub: (x, y) => x - y,
  mul: (x, y) => x * y,
  div: (x, y) => x / y,
  floordiv: pyFloorDiv,
  mod: pyMod,
  pow: (x, y) => Math.pow(x, y),
  max: (x, y) => (x !== x || y !== y ? NaN : x > y ? x : y),
  min: (x, y) => (x !== x || y !== y ? NaN : x < y ? x : y),
  arctan2: Math.atan2,
  hypot: Math.hypot,
};

export function arith(op: ArithOp, a: NdArray, b: NdArray): NdArray {
  if (a.dtype === 'str' || b.dtype === 'str') {
    if (op === 'add' && a.dtype === 'str' && b.dtype === 'str') {
      const shape = broadcastShapes(a.shape, b.shape);
      const A = flatStr(broadcastTo(a, shape));
      const B = flatStr(broadcastTo(b, shape));
      return mkStr(A.map((s, i) => s + B[i]), shape);
    }
    throw typeError(`ufunc '${op === 'add' ? 'add' : op}' did not contain a loop with signature matching types`);
  }
  let out = promote(a.dtype, b.dtype);
  if (op === 'div') out = 'float64';
  if (op === 'sub' && a.dtype === 'bool' && b.dtype === 'bool') throw typeError('numpy boolean subtract, the `-` operator, is not supported, use the bitwise_xor, the `^` operator, or the logical_xor function instead.');
  if (out === 'bool' && op !== 'add' && op !== 'mul' && op !== 'max' && op !== 'min') out = 'int64';
  if (op === 'arctan2' || op === 'hypot') out = 'float64';
  if (op === 'pow' && out === 'int64') {
    const bd = flatNum(b);
    for (let i = 0; i < bd.length; i++) if (bd[i] < 0) throw valueError('Integers to negative integer powers are not allowed.');
  }
  let f = ARITH[op];
  if (out === 'bool' && op === 'add') f = (x, y) => (x !== 0 || y !== 0 ? 1 : 0);
  if (out === 'bool' && op === 'mul') f = (x, y) => (x !== 0 && y !== 0 ? 1 : 0);
  if (out === 'int64' && (op === 'floordiv' || op === 'mod')) {
    const g = f;
    f = (x, y) => (y === 0 ? 0 : g(x, y));
  }
  return ewBinary(a, b, f, out);
}

export type CmpOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
const CMP: Record<CmpOp, (x: number, y: number) => number> = {
  eq: (x, y) => (x === y ? 1 : 0),
  ne: (x, y) => (x !== y ? 1 : 0),
  lt: (x, y) => (x < y ? 1 : 0),
  le: (x, y) => (x <= y ? 1 : 0),
  gt: (x, y) => (x > y ? 1 : 0),
  ge: (x, y) => (x >= y ? 1 : 0),
};

export function compare(op: CmpOp, a: NdArray, b: NdArray): NdArray {
  if (a.dtype === 'str' || b.dtype === 'str') {
    if (a.dtype !== 'str' || b.dtype !== 'str') {
      const shape = broadcastShapes(a.shape, b.shape);
      return mkNum(new Float64Array(sizeOf(shape)).fill(op === 'ne' ? 1 : 0), shape, 'bool');
    }
    const shape = broadcastShapes(a.shape, b.shape);
    const A = flatStr(broadcastTo(a, shape));
    const B = flatStr(broadcastTo(b, shape));
    const f: Record<CmpOp, (x: string, y: string) => boolean> = { eq: (x, y) => x === y, ne: (x, y) => x !== y, lt: (x, y) => x < y, le: (x, y) => x <= y, gt: (x, y) => x > y, ge: (x, y) => x >= y };
    return mkNum(Float64Array.from(A, (s, i) => (f[op](s, B[i]) ? 1 : 0)), shape, 'bool');
  }
  return ewBinary(a, b, CMP[op], 'bool');
}

export function logical(op: 'and' | 'or' | 'xor', a: NdArray, b: NdArray): NdArray {
  const f = { and: (x: number, y: number) => (x !== 0 && y !== 0 ? 1 : 0), or: (x: number, y: number) => (x !== 0 || y !== 0 ? 1 : 0), xor: (x: number, y: number) => ((x !== 0) !== (y !== 0) ? 1 : 0) }[op];
  return ewBinary(a, b, f, 'bool');
}

/** & | ^ de NumPy: lógicos con booleanos, bit a bit con enteros */
export function bitwise(op: 'and' | 'or' | 'xor', a: NdArray, b: NdArray): NdArray {
  if (a.dtype === 'bool' && b.dtype === 'bool') return logical(op, a, b);
  if (a.dtype === 'float64' || b.dtype === 'float64' || a.dtype === 'str' || b.dtype === 'str') throw typeError(`ufunc 'bitwise_${op}' not supported for the input types, and the inputs could not be safely coerced to any supported types according to the casting rule ''safe''`);
  const f = { and: (x: number, y: number) => Number(BigInt(x) & BigInt(y)), or: (x: number, y: number) => Number(BigInt(x) | BigInt(y)), xor: (x: number, y: number) => Number(BigInt(x) ^ BigInt(y)) }[op];
  return ewBinary(a, b, f, 'int64');
}

export function invert(a: NdArray): NdArray {
  if (a.dtype === 'bool') return ewUnary(a, (x) => (x ? 0 : 1), 'bool');
  if (a.dtype === 'int64') return ewUnary(a, (x) => -x - 1, 'int64');
  throw typeError(`ufunc 'invert' not supported for the input types, and the inputs could not be safely coerced to any supported types according to the casting rule ''safe''`);
}

export function negate(a: NdArray): NdArray {
  if (a.dtype === 'bool') throw typeError('The numpy boolean negative, the `-` operator, is not supported, use the `~` operator or the logical_not function instead.');
  if (a.dtype === 'str') throw typeError(`ufunc 'negative' did not contain a loop with signature matching types`);
  return ewUnary(a, (x) => -x, a.dtype);
}

// ───────────────────────── funciones universales ─────────────────────────

export type UFunc = 'sqrt' | 'exp' | 'expm1' | 'log' | 'log1p' | 'log2' | 'log10' | 'sin' | 'cos' | 'tan' | 'arcsin' | 'arccos' | 'arctan' | 'sinh' | 'cosh' | 'tanh' | 'arcsinh' | 'arccosh' | 'arctanh' | 'floor' | 'ceil' | 'trunc' | 'rint' | 'square' | 'abs' | 'sign' | 'cbrt' | 'reciprocal' | 'degrees' | 'radians' | 'isnan' | 'isinf' | 'isfinite' | 'signbit';

const rint = (x: number): number => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

const UF: Record<UFunc, [(x: number) => number, DType | 'same' | 'float']> = {
  sqrt: [Math.sqrt, 'float'], exp: [Math.exp, 'float'], expm1: [Math.expm1, 'float'], log: [Math.log, 'float'], log1p: [Math.log1p, 'float'], log2: [Math.log2, 'float'], log10: [Math.log10, 'float'],
  sin: [Math.sin, 'float'], cos: [Math.cos, 'float'], tan: [Math.tan, 'float'], arcsin: [Math.asin, 'float'], arccos: [Math.acos, 'float'], arctan: [Math.atan, 'float'],
  sinh: [Math.sinh, 'float'], cosh: [Math.cosh, 'float'], tanh: [Math.tanh, 'float'], arcsinh: [Math.asinh, 'float'], arccosh: [Math.acosh, 'float'], arctanh: [Math.atanh, 'float'],
  floor: [Math.floor, 'float'], ceil: [Math.ceil, 'float'], trunc: [Math.trunc, 'float'], rint: [rint, 'float'], square: [(x) => x * x, 'same'], abs: [Math.abs, 'same'],
  sign: [(x) => (x !== x ? NaN : Math.sign(x)), 'same'], cbrt: [Math.cbrt, 'float'], reciprocal: [(x) => 1 / x, 'float'], degrees: [(x) => (x * 180) / Math.PI, 'float'], radians: [(x) => (x * Math.PI) / 180, 'float'],
  isnan: [(x) => (x !== x ? 1 : 0), 'bool'], isinf: [(x) => (x === Infinity || x === -Infinity ? 1 : 0), 'bool'], isfinite: [(x) => (Number.isFinite(x) ? 1 : 0), 'bool'], signbit: [(x) => (x < 0 || Object.is(x, -0) ? 1 : 0), 'bool'],
};

export function ufunc(name: UFunc, a: NdArray): NdArray {
  if (a.dtype === 'str') throw typeError(`ufunc '${name}' did not contain a loop with signature matching types`);
  const [f, kind] = UF[name];
  const out: DType = kind === 'same' ? (a.dtype === 'bool' ? 'bool' : a.dtype) : kind === 'float' ? 'float64' : kind;
  if (name === 'abs' && a.dtype === 'bool') return copyOf(a);
  return ewUnary(a, f, out);
}

export function roundTo(a: NdArray, decimals: number): NdArray {
  if (a.dtype === 'int64' && decimals >= 0) return copyOf(a);
  const p = Math.pow(10, decimals);
  return ewUnary(a, (x) => (Number.isFinite(x) ? rint(x * p) / p : x), a.dtype === 'int64' ? 'int64' : 'float64');
}

export function clip(a: NdArray, lo: NdArray | null, hi: NdArray | null): NdArray {
  let r = a;
  if (lo) r = arith('max', r, lo);
  if (hi) r = arith('min', r, hi);
  return r === a ? copyOf(a) : r;
}

export function where3(cond: NdArray, x: NdArray, y: NdArray): NdArray {
  const shape = broadcastShapes(broadcastShapes(cond.shape, x.shape), y.shape);
  const C = flatNum(broadcastTo(cond, shape));
  const dt = promote(x.dtype, y.dtype);
  if (dt === 'str') {
    const X = flatStr(broadcastTo(x, shape));
    const Y = flatStr(broadcastTo(y, shape));
    return mkStr(Array.from(C, (c, i) => (c !== 0 ? X[i] : Y[i])), shape);
  }
  const X = flatNum(broadcastTo(x, shape));
  const Y = flatNum(broadcastTo(y, shape));
  const out = new Float64Array(C.length);
  for (let i = 0; i < C.length; i++) out[i] = C[i] !== 0 ? X[i] : Y[i];
  return mkNum(out, shape, dt);
}

// ───────────────────────── reducciones concretas ─────────────────────────

const sumDtype = (d: DType): DType => (d === 'float64' ? 'float64' : 'int64');

/**
 * ¿Se reducen solo los ejes finales (los de zancada más pequeña)? Entonces NumPy suma por pares cada grupo contiguo;
 * si se reduce otro eje (p. ej. `axis=0` de una matriz), suma fila a fila en secuencia. Los ejes de longitud 1 no cuentan.
 */
function reducesTrailing(a: NdArray, axes: number[] | null): boolean {
  if (axes === null) return true;
  const ax = axes.map((x) => normAxis(x, a.ndim));
  let seenReduced = false;
  for (let i = 0; i < a.ndim; i++) {
    if (a.shape[i] <= 1) continue;
    if (ax.includes(i)) seenReduced = true;
    else if (seenReduced) return false;
  }
  return true;
}

const seqSum = (v: Float64Array): number => {
  let r = 0;
  for (let i = 0; i < v.length; i++) r += v[i];
  return r;
};

export function sum(a: NdArray, axes: number[] | null, keepdims: boolean): NdArray {
  if (a.dtype === 'str') throw typeError(`cannot perform reduce with flexible type`);
  if (a.dtype === 'float64') {
    const f = reducesTrailing(a, axes) ? sumPairwise : seqSum;
    return reduceAxes(a, axes, { group: (v) => f(v) }, 'float64', keepdims);
  }
  return reduceAxes(a, axes, { init: 0, step: (acc, v) => acc + v }, sumDtype(a.dtype), keepdims);
}

export function prod(a: NdArray, axes: number[] | null, keepdims: boolean): NdArray {
  return reduceAxes(a, axes, { init: 1, step: (acc, v) => acc * v }, sumDtype(a.dtype), keepdims);
}

export function mean(a: NdArray, axes: number[] | null, keepdims: boolean): NdArray {
  const f = reducesTrailing(a, axes) ? sumPairwise : seqSum;
  return reduceAxes(a, axes, { group: (v) => (v.length === 0 ? NaN : f(v) / v.length) }, 'float64', keepdims);
}

/** suma por pares (como NumPy) para que los redondeos coincidan en vectores largos */
export function sumPairwise(v: Float64Array, lo = 0, hi = v.length): number {
  const n = hi - lo;
  if (n < 8) {
    let r = 0;
    for (let i = lo; i < hi; i++) r += v[i];
    return r;
  }
  if (n <= 128) {
    const r = [0, 0, 0, 0, 0, 0, 0, 0];
    let i = lo;
    for (; i < lo + n - (n % 8); i += 8) for (let k = 0; k < 8; k++) r[k] += v[i + k];
    let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
    for (; i < hi; i++) res += v[i];
    return res;
  }
  let n2 = n >> 1;
  n2 -= n2 % 8;
  return sumPairwise(v, lo, lo + n2) + sumPairwise(v, lo + n2, hi);
}

export function variance(a: NdArray, axes: number[] | null, ddof: number, keepdims: boolean): NdArray {
  const f = reducesTrailing(a, axes) ? sumPairwise : seqSum;
  return reduceAxes(
    a,
    axes,
    {
      group: (v) => {
        const n = v.length;
        if (n - ddof <= 0) return NaN;
        const m = f(v) / n;
        const d = new Float64Array(n);
        for (let i = 0; i < n; i++) d[i] = (v[i] - m) * (v[i] - m);
        return f(d) / (n - ddof);
      },
    },
    'float64',
    keepdims,
  );
}

export function std(a: NdArray, axes: number[] | null, ddof: number, keepdims: boolean): NdArray {
  const v = variance(a, axes, ddof, keepdims);
  return ewUnary(v, Math.sqrt, 'float64');
}

export function minmax(a: NdArray, axes: number[] | null, keepdims: boolean, isMax: boolean): NdArray {
  if (a.size === 0) throw valueError(`zero-size array to reduction operation ${isMax ? 'maximum' : 'minimum'} which has no identity`);
  if (a.dtype === 'str') {
    const d = flatStr(a);
    const best = d.reduce((m, v) => (isMax ? (v > m ? v : m) : v < m ? v : m));
    return mkStr([best], []);
  }
  return reduceAxes(a, axes, { init: isMax ? -Infinity : Infinity, step: isMax ? (acc, v) => (acc !== acc || v !== v ? NaN : v > acc ? v : acc) : (acc, v) => (acc !== acc || v !== v ? NaN : v < acc ? v : acc) }, a.dtype, keepdims);
}

export const argmax = (a: NdArray, axis: number | null): NdArray | number => argReduce(a, axis, (x, best) => x > best || (x !== x && best === best));
export const argmin = (a: NdArray, axis: number | null): NdArray | number => argReduce(a, axis, (x, best) => x < best || (x !== x && best === best));

export function anyAll(a: NdArray, axes: number[] | null, keepdims: boolean, isAll: boolean): NdArray {
  return reduceAxes(a, axes, { init: isAll ? 1 : 0, step: isAll ? (acc, v) => (acc !== 0 && v !== 0 ? 1 : 0) : (acc, v) => (acc !== 0 || v !== 0 ? 1 : 0) }, 'bool', keepdims);
}

export function median(a: NdArray, axes: number[] | null, keepdims: boolean): NdArray {
  return percentileImpl(a, axes, [50], keepdims, 'linear', true);
}

/** percentiles (q en 0..100) con interpolación; devuelve forma (len(q),)+resto si hay varios q */
export function percentileImpl(a: NdArray, axes: number[] | null, qs: number[], keepdims: boolean, method: string, scalarQ: boolean): NdArray {
  const calc = (v: Float64Array, q: number): number => {
    const s = Float64Array.from(v).sort((x, y) => cmpNum(x, y));
    const n = s.length;
    if (n === 0) return NaN;
    for (let i = 0; i < n; i++) if (s[i] !== s[i]) return NaN;
    const pos = (q / 100) * (n - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    switch (method) {
      case 'lower': return s[lo];
      case 'higher': return s[hi];
      case 'nearest': return s[rint(pos)];
      case 'midpoint': return (s[lo] + s[hi]) / 2;
      default: {
        // numpy: lerp con el mismo orden de operaciones
        const a0 = s[lo];
        const b0 = s[hi];
        const diff = b0 - a0;
        return frac >= 0.5 ? b0 - diff * (1 - frac) : a0 + diff * frac;
      }
    }
  };
  const parts = qs.map((q) => reduceAxes(a, axes, { group: (v) => calc(v, q) }, 'float64', keepdims));
  if (scalarQ) return parts[0];
  return stack(parts, 0);
}

export function cumsum(a: NdArray, axis: number | null): NdArray {
  return accumulate(a, axis, (acc, v) => acc + v, sumDtype(a.dtype));
}
export function cumprod(a: NdArray, axis: number | null): NdArray {
  return accumulate(a, axis, (acc, v) => acc * v, sumDtype(a.dtype));
}

// ───────────────────────── formas ─────────────────────────

export function concatenate(arrs: NdArray[], axis: number | null): NdArray {
  if (arrs.length === 0) throw valueError('need at least one array to concatenate');
  const parts = axis === null ? arrs.map((x) => reshapeTo(x, [x.size])) : arrs;
  const ax0 = axis === null ? 0 : axis;
  const nd = parts[0].ndim;
  if (nd === 0) throw valueError('zero-dimensional arrays cannot be concatenated');
  const ax = normAxis(ax0, nd);
  for (const p of parts) {
    if (p.ndim !== nd) throw valueError(`all the input array dimensions except for the concatenation axis must match exactly, but along dimension 0, the array at index 0 has ${nd} dimension(s) and the array at index ${parts.indexOf(p)} has ${p.ndim} dimension(s)`);
    for (let d = 0; d < nd; d++) if (d !== ax && p.shape[d] !== parts[0].shape[d]) throw valueError(`all the input array dimensions except for the concatenation axis must match exactly, but along dimension ${d}, the array at index 0 has size ${parts[0].shape[d]} and the array at index ${parts.indexOf(p)} has size ${p.shape[d]}`);
  }
  const dt = parts.map((p) => p.dtype).reduce((x, y) => promote(x, y));
  const shape = parts[0].shape.slice();
  shape[ax] = parts.reduce((s, p) => s + p.shape[ax], 0);
  const outer = shape.slice(0, ax).reduce((p, s) => p * s, 1);
  const inner = shape.slice(ax + 1).reduce((p, s) => p * s, 1);
  if (dt === 'str') {
    const out = new Array<string>(sizeOf(shape));
    let pos = 0;
    const flats = parts.map((p) => flatStr(astype(p, 'str')));
    for (let o = 0; o < outer; o++) parts.forEach((p, k) => {
      const blk = p.shape[ax] * inner;
      for (let i = 0; i < blk; i++) out[pos++] = flats[k][o * blk + i];
    });
    return mkStr(out, shape);
  }
  const out = new Float64Array(sizeOf(shape));
  let pos = 0;
  const flats = parts.map((p) => flatNum(p));
  for (let o = 0; o < outer; o++) parts.forEach((p, k) => {
    const blk = p.shape[ax] * inner;
    for (let i = 0; i < blk; i++) out[pos++] = flats[k][o * blk + i];
  });
  return mkNum(out, shape, dt);
}

export function expandDims(a: NdArray, axis: number): NdArray {
  const nd = a.ndim + 1;
  const ax = normAxis(axis, nd);
  const shape = a.shape.slice();
  const strides = a.strides.slice();
  shape.splice(ax, 0, 1);
  strides.splice(ax, 0, 0);
  return new NdArray(a.buf, shape, strides, a.offset, a.dtype, a.base ?? a);
}

export function stack(arrs: NdArray[], axis: number): NdArray {
  if (arrs.length === 0) throw valueError('need at least one array to stack');
  const s0 = arrs[0].shape;
  for (const p of arrs) if (p.shape.length !== s0.length || p.shape.some((x, i) => x !== s0[i])) throw valueError('all input arrays must have the same shape');
  const ax = normAxis(axis, s0.length + 1);
  return concatenate(arrs.map((x) => expandDims(x, ax)), ax);
}

export function squeeze(a: NdArray, axis: number[] | null): NdArray {
  const drop = (axis === null ? a.shape.map((s, i) => (s === 1 ? i : -1)).filter((i) => i >= 0) : axis.map((x) => normAxis(x, a.ndim)));
  for (const d of drop) if (a.shape[d] !== 1) throw valueError('cannot select an axis to squeeze out which has size not equal to one');
  return new NdArray(a.buf, a.shape.filter((_, i) => !drop.includes(i)), a.strides.filter((_, i) => !drop.includes(i)), a.offset, a.dtype, a.base ?? a);
}

export function flip(a: NdArray, axes: number[] | null): NdArray {
  const ax = axes === null ? a.shape.map((_, i) => i) : axes.map((x) => normAxis(x, a.ndim));
  let off = a.offset;
  const strides = a.strides.slice();
  for (const d of ax) {
    if (a.shape[d] > 0) off += (a.shape[d] - 1) * a.strides[d];
    strides[d] = -a.strides[d];
  }
  return new NdArray(a.buf, a.shape.slice(), strides, off, a.dtype, a.base ?? a);
}

export function roll(a: NdArray, shift: number, axis: number | null): NdArray {
  if (axis === null) {
    const f = reshapeTo(a, [a.size]);
    return reshapeTo(roll(f, shift, 0), a.shape);
  }
  const ax = normAxis(axis, a.ndim);
  const n = a.shape[ax];
  if (n === 0) return copyOf(a);
  const s = ((shift % n) + n) % n;
  if (s === 0) return copyOf(a);
  const idx = Array.from({ length: n }, (_, i) => (i - s + n) % n);
  return takeAxis(a, Float64Array.from(idx), ax);
}

/** a.take(indices, axis) con índices ya normalizados en rango */
export function takeAxis(a: NdArray, idx: Float64Array, axis: number): NdArray {
  const ax = normAxis(axis, a.ndim);
  const shape = a.shape.slice();
  shape[ax] = idx.length;
  const outer = a.shape.slice(0, ax).reduce((p, s) => p * s, 1);
  const inner = a.shape.slice(ax + 1).reduce((p, s) => p * s, 1);
  const n = a.shape[ax];
  if (a.dtype === 'str') {
    const src = flatStr(a);
    const out = new Array<string>(sizeOf(shape));
    let p = 0;
    for (let o = 0; o < outer; o++) for (let k = 0; k < idx.length; k++) for (let i = 0; i < inner; i++) out[p++] = src[(o * n + idx[k]) * inner + i];
    return mkStr(out, shape);
  }
  const src = flatNum(a);
  const out = new Float64Array(sizeOf(shape));
  let p = 0;
  for (let o = 0; o < outer; o++) for (let k = 0; k < idx.length; k++) for (let i = 0; i < inner; i++) out[p++] = src[(o * n + idx[k]) * inner + i];
  return mkNum(out, shape, a.dtype);
}

export function tile(a: NdArray, reps: number[]): NdArray {
  const nd = Math.max(a.ndim, reps.length);
  const shape = [...new Array(nd - a.ndim).fill(1), ...a.shape];
  const r = [...new Array(nd - reps.length).fill(1), ...reps];
  let cur = reshapeTo(a, shape);
  for (let d = 0; d < nd; d++) if (r[d] !== 1) cur = concatenate(new Array(r[d]).fill(cur), d);
  return r.every((x) => x === 1) ? copyOf(cur) : cur;
}

export function repeat(a: NdArray, reps: number[], axis: number | null): NdArray {
  const src = axis === null ? reshapeTo(a, [a.size]) : a;
  const ax = axis === null ? 0 : normAxis(axis, a.ndim);
  const n = src.shape[ax];
  const counts = reps.length === 1 ? new Array(n).fill(reps[0]) : reps;
  if (counts.length !== n) throw valueError(`operands could not be broadcast together with shape (${n},) (${counts.length},)`);
  const idx: number[] = [];
  counts.forEach((c, i) => {
    for (let k = 0; k < c; k++) idx.push(i);
  });
  return takeAxis(src, Float64Array.from(idx), ax);
}

// ───────────────────────── producto matricial ─────────────────────────

function matmul2(A: Float64Array, B: Float64Array, n: number, k: number, m: number, out: Float64Array, oOff = 0, aOff = 0, bOff = 0): void {
  for (let i = 0; i < n; i++) {
    const ro = oOff + i * m;
    for (let p = 0; p < k; p++) {
      const av = A[aOff + i * k + p];
      if (av === 0) continue;
      const bo = bOff + p * m;
      for (let j = 0; j < m; j++) out[ro + j] += av * B[bo + j];
    }
  }
}

export function matmul(a: NdArray, b: NdArray): NdArray {
  if (a.ndim === 0 || b.ndim === 0) throw valueError("matmul: Input operand does not have enough dimensions (has 0, gufunc core with signature (n?,k),(k,m?)->(n?,m?) requires 1)");
  if (a.dtype === 'str' || b.dtype === 'str') throw typeError(`ufunc 'matmul' did not contain a loop with signature matching types`);
  const dt: DType = promote(a.dtype, b.dtype) === 'float64' ? 'float64' : 'int64';
  const a2 = a.ndim === 1 ? reshapeTo(a, [1, a.shape[0]]) : a;
  const b2 = b.ndim === 1 ? reshapeTo(b, [b.shape[0], 1]) : b;
  const n = a2.shape[a2.ndim - 2];
  const k = a2.shape[a2.ndim - 1];
  const k2 = b2.shape[b2.ndim - 2];
  const m = b2.shape[b2.ndim - 1];
  if (k !== k2) throw valueError(`matmul: Input operand 1 has a mismatch in its core dimension 0, with gufunc signature (n?,k),(k,m?)->(n?,m?) (size ${k2} is different from ${k})`);
  const batchA = a2.shape.slice(0, -2);
  const batchB = b2.shape.slice(0, -2);
  const batch = broadcastShapes(batchA, batchB);
  const nb = sizeOf(batch);
  const A = flatNum(broadcastTo(a2, [...batch, n, k]));
  const B = flatNum(broadcastTo(b2, [...batch, k, m]));
  const out = new Float64Array(nb * n * m);
  for (let t = 0; t < nb; t++) matmul2(A, B, n, k, m, out, t * n * m, t * n * k, t * k * m);
  let shape = [...batch, n, m];
  if (a.ndim === 1) shape = shape.filter((_, i) => i !== shape.length - 2);
  if (b.ndim === 1) shape = shape.slice(0, -1);
  return mkNum(out, shape, dt);
}

/** np.dot: para N-D suma sobre el último eje de `a` y el penúltimo de `b` */
export function dot(a: NdArray, b: NdArray): NdArray {
  if (a.ndim === 0 || b.ndim === 0) return arith('mul', a, b);
  if (a.ndim <= 2 && b.ndim <= 2) return matmul(a, b);
  if (b.ndim === 1) return matmul(a, b);
  // dot(a, b)[i, j, k, m] = sum(a[i, j, :] * b[k, :, m])
  const k = a.shape[a.ndim - 1];
  const kb = b.shape[b.ndim - 2];
  if (k !== kb) throw valueError(`shapes ${shapeStr(a.shape)} and ${shapeStr(b.shape)} not aligned: ${k} (dim ${a.ndim - 1}) != ${kb} (dim ${b.ndim - 2})`);
  const a2 = reshapeTo(a, [-1, k]);
  const bm = transposeAxes(b, [b.ndim - 2, ...b.shape.map((_, i) => i).filter((i) => i !== b.ndim - 2)]);
  const b2 = reshapeTo(copyOf(bm), [k, -1]);
  const r = matmul(a2, b2);
  const restB = b.shape.filter((_, i) => i !== b.ndim - 2);
  return reshapeTo(r, [...a.shape.slice(0, -1), ...restB]);
}

export function outer(a: NdArray, b: NdArray): NdArray {
  return arith('mul', reshapeTo(a, [a.size, 1]), reshapeTo(b, [1, b.size]));
}

export function trace(a: NdArray): number {
  const n = Math.min(a.shape[0], a.shape[1]);
  const d = flatNum(a);
  let s = 0;
  for (let i = 0; i < n; i++) s += d[i * a.shape[1] + i];
  return s;
}

// ───────────────────────── einsum ─────────────────────────

export function einsum(spec: string, operands: NdArray[]): NdArray {
  const s = spec.replace(/\s+/g, '');
  const [lhs, rhsIn] = s.split('->');
  const ins = lhs.split(',');
  if (ins.length !== operands.length) throw valueError('more operands provided to einstein sum function than specified in the subscripts string');
  const sizes: Record<string, number> = {};
  ins.forEach((sub, i) => {
    // «...» no soportado: se avisa
    if (sub.includes('.')) throw valueError('einsum con «...» no está soportado en este entorno');
    if (sub.length !== operands[i].ndim) throw valueError(`einstein sum subscripts string contains too many subscripts for operand ${i}`);
    [...sub].forEach((c, d) => {
      const n = operands[i].shape[d];
      if (sizes[c] !== undefined && sizes[c] !== n && n !== 1 && sizes[c] !== 1) throw valueError(`operands could not be broadcast together with remapped shapes [original->remapped]`);
      sizes[c] = Math.max(sizes[c] ?? 1, n);
    });
  });
  const letters = Object.keys(sizes);
  let rhs: string;
  if (rhsIn !== undefined) rhs = rhsIn;
  else {
    const counts: Record<string, number> = {};
    for (const c of lhs.replace(/,/g, '')) counts[c] = (counts[c] ?? 0) + 1;
    rhs = Object.keys(counts).filter((c) => counts[c] === 1).sort().join('');
  }
  const outShape = [...rhs].map((c) => sizes[c]);
  const sumLetters = letters.filter((c) => !rhs.includes(c));
  const all = [...rhs, ...sumLetters];
  const dims = all.map((c) => sizes[c]);
  const total = sizeOf(dims);
  const outSize = sizeOf(outShape);
  const dt: DType = operands.map((o) => o.dtype).reduce((x, y) => promote(x, y)) === 'float64' ? 'float64' : 'int64';
  const datas = operands.map((o) => flatNum(o));
  const strideMaps = ins.map((sub, i) => {
    const st = cStrides(operands[i].shape);
    return all.map((c) => {
      const d = sub.indexOf(c);
      return d < 0 || operands[i].shape[d] === 1 ? 0 : st[d];
    });
  });
  const out = new Float64Array(outSize);
  const idx = new Array<number>(all.length).fill(0);
  const outStr = cStrides(outShape);
  for (let t = 0; t < total; t++) {
    let prod = 1;
    for (let o = 0; o < datas.length; o++) {
      let p = 0;
      for (let d = 0; d < all.length; d++) p += idx[d] * strideMaps[o][d];
      prod *= datas[o][p];
    }
    let op = 0;
    for (let d = 0; d < rhs.length; d++) op += idx[d] * outStr[d];
    out[op] += prod;
    for (let d = all.length - 1; d >= 0; d--) {
      idx[d]++;
      if (idx[d] < dims[d]) break;
      idx[d] = 0;
    }
  }
  return mkNum(out, outShape, dt);
}

// ───────────────────────── unicidad, recuentos, histogramas ─────────────────────────

export function unique(a: NdArray): { values: NdArray; index: number[]; inverse: number[]; counts: number[] } {
  const n = a.size;
  const isStr = a.dtype === 'str';
  const data: any = isStr ? flatStr(a) : flatNum(a);
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => (isStr ? (data[i] < data[j] ? -1 : data[i] > data[j] ? 1 : 0) : cmpNum(data[i], data[j])) || i - j);
  const vals: any[] = [];
  const index: number[] = [];
  const counts: number[] = [];
  const inverse = new Array<number>(n);
  for (const i of order) {
    const v = data[i];
    const last = vals.length - 1;
    if (last >= 0 && (vals[last] === v || (v !== v && vals[last] !== vals[last] && !isStr))) {
      counts[last]++;
    } else {
      vals.push(v);
      index.push(i);
      counts.push(1);
    }
    inverse[i] = vals.length - 1;
  }
  return { values: isStr ? mkStr(vals, [vals.length]) : mkNum(Float64Array.from(vals), [vals.length], a.dtype), index, inverse, counts };
}

export function bincount(x: NdArray, weights: NdArray | null, minlength: number): NdArray {
  if (x.dtype === 'float64') throw typeError("Cannot cast array data from dtype('float64') to dtype('int64') according to the rule 'safe'");
  const d = flatNum(x);
  let mx = -1;
  for (const v of d) {
    if (v < 0) throw valueError("'list' argument must have no negative elements");
    mx = Math.max(mx, v);
  }
  const out = new Float64Array(Math.max(mx + 1, minlength));
  const w = weights ? flatNum(weights) : null;
  for (let i = 0; i < d.length; i++) out[d[i]] += w ? w[i] : 1;
  return mkNum(out, [out.length], w ? 'float64' : 'int64');
}

export function histogram(a: NdArray, edges: Float64Array, weights: NdArray | null, density: boolean): [NdArray, NdArray] {
  const d = flatNum(a);
  const nb = edges.length - 1;
  const counts = new Float64Array(nb);
  const w = weights ? flatNum(weights) : null;
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if (v !== v || v < edges[0] || v > edges[nb]) continue;
    let lo = 0;
    let hi = nb;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (v >= edges[mid]) lo = mid;
      else hi = mid - 1;
    }
    counts[Math.min(lo, nb - 1)] += w ? w[i] : 1;
  }
  let res = counts;
  if (density) {
    const tot = counts.reduce((s, v) => s + v, 0);
    res = counts.map((c, i) => c / tot / (edges[i + 1] - edges[i]));
  }
  return [mkNum(res, [nb], density || w ? 'float64' : 'int64'), mkNum(edges, [edges.length], 'float64')];
}

export function searchsorted(a: NdArray, v: NdArray, right: boolean): NdArray {
  const A = flatNum(a);
  const V = flatNum(v);
  const out = new Float64Array(V.length);
  for (let i = 0; i < V.length; i++) {
    let lo = 0;
    let hi = A.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (right ? A[mid] <= V[i] : A[mid] < V[i]) lo = mid + 1;
      else hi = mid;
    }
    out[i] = lo;
  }
  return mkNum(out, v.shape.slice(), 'int64');
}

export function diff(a: NdArray, n: number, axis: number): NdArray {
  let cur = a;
  const ax = normAxis(axis, a.ndim);
  for (let k = 0; k < n; k++) {
    const len = cur.shape[ax];
    if (len === 0) break;
    const lo = takeAxis(cur, Float64Array.from({ length: len - 1 }, (_, i) => i + 1), ax);
    const hi = takeAxis(cur, Float64Array.from({ length: len - 1 }, (_, i) => i), ax);
    cur = arith('sub', lo, hi);
  }
  return cur;
}

// ───────────────────────── covarianza ─────────────────────────

export function cov(m: NdArray, rowvar: boolean, ddof: number): NdArray {
  const X = m.ndim === 1 ? reshapeTo(m, [1, m.size]) : rowvar ? m : copyOf(transposeAxes(m, [1, 0]));
  const rows = X.shape[0];
  const n = X.shape[1];
  const d = flatNum(X);
  const means = new Float64Array(rows);
  for (let i = 0; i < rows; i++) means[i] = sumPairwise(d, i * n, (i + 1) * n) / n;
  const out = new Float64Array(rows * rows);
  for (let i = 0; i < rows; i++)
    for (let j = i; j < rows; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += (d[i * n + k] - means[i]) * (d[j * n + k] - means[j]);
      out[i * rows + j] = out[j * rows + i] = s / (n - ddof);
    }
  return mkNum(out, rows === 1 && m.ndim === 1 ? [] : [rows, rows], 'float64');
}

export { offsetsOf, sortAxis, scalarArray };
