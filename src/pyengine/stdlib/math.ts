/**
 * Módulo `math`.
 */
import { PyFloat, PyModule, PyTuple } from '../runtime/objects';
import type { Interp } from '../runtime/interp';
import { overflowError, typeError, valueError } from '../runtime/errors';
import * as ops from '../runtime/ops';
import { typeOf } from '../runtime/builtin_types';
import { callObj } from '../runtime/call';
import { intAbs, intBitLength, intCmp, intMul, intSign, normBig, toBig, type PyInt } from '../runtime/numeric';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { toFloatValue } from '../runtime/t_num';

const F = (v: number): PyFloat => new PyFloat(v);

function fl(x: any): number {
  if (x instanceof PyFloat) return x.v;
  const i = ops.intValue(x);
  if (i !== undefined) {
    if (typeof i === 'bigint') {
      const d = Number(i);
      if (!isFinite(d)) throw overflowError('int too large to convert to float');
      return d;
    }
    return i;
  }
  const f = ops.floatValue(x);
  if (f !== undefined) return f;
  const t = typeOf(x);
  if (t.lookup('__float__') !== undefined || t.lookup('__index__') !== undefined) return toFloatValue(x);
  throw typeError(`must be real number, not ${t.name}`);
}

const domain = (): never => {
  throw valueError('math domain error');
};
const range = (): never => {
  throw overflowError('math range error');
};

function check1(f: (x: number) => number, dom?: (x: number) => boolean): (x: any) => PyFloat {
  return (a) => {
    const x = fl(a);
    if (dom && !dom(x) && x === x) domain();
    const r = f(x);
    if (r !== r && x === x) domain();
    if (!isFinite(r) && isFinite(x)) range();
    return F(r);
  };
}

function toInt(x: any, name: string): PyInt {
  const v = ops.intValue(x);
  if (v !== undefined) return v;
  if (x instanceof PyFloat) throw typeError(`'float' object cannot be interpreted as an integer`);
  return ops.toIndex(x, `'${typeOf(x).name}' object cannot be interpreted as an integer`);
  void name;
}

function gcd2(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function isqrtBig(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y === x || y === x + 1n && y * y > n) break;
    if (y >= x && x * x <= n && (x + 1n) * (x + 1n) > n) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

function factorial(n: bigint): bigint {
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

/** suma exacta de Shewchuk (math.fsum) */
function fsum(xs: number[]): number {
  const partials: number[] = [];
  let special = 0;
  for (let x of xs) {
    if (!isFinite(x)) { special += x; continue; }
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  if (special !== 0 || xs.some((x) => !isFinite(x))) return special === 0 && xs.some((x) => x !== x) ? NaN : special || xs.reduce((a, b) => a + b, 0);
  let hi = 0;
  let n = partials.length;
  if (n > 0) {
    hi = partials[--n];
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n];
      hi = x + y;
      const yr = hi - x;
      lo = y - yr;
      if (lo) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
      const y = lo * 2;
      const x = hi + y;
      const yr = x - hi;
      if (y === yr) hi = x;
    }
  }
  return hi;
}

function lgamma(x: number): number {
  if (x <= 0 && Number.isInteger(x)) return Infinity;
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26 refinada con serie para |x| pequeño
  const ax = Math.abs(x);
  if (ax < 2.5) {
    let sum = ax;
    let term = ax;
    for (let n = 1; n < 100; n++) {
      term *= -ax * ax / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17) break;
    }
    return Math.sign(x) * (2 / Math.sqrt(Math.PI)) * sum;
  }
  // fracción continua para colas
  let f = 0;
  for (let k = 60; k >= 1; k--) f = k / 2 / (ax + f);
  const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  return Math.sign(x) * (1 - erfc);
}

registerNative('math', (I: Interp, m: PyModule) => {
  mconst(m, { pi: F(Math.PI), e: F(Math.E), tau: F(2 * Math.PI), inf: F(Infinity), nan: F(NaN) });
  mfn(m, 'sqrt', 'x, /', (a: any) => {
    const x = fl(a);
    if (x < 0) domain();
    return F(Math.sqrt(x));
  });
  mfn(m, 'cbrt', 'x, /', (a: any) => F(Math.cbrt(fl(a))));
  mfn(m, 'exp', 'x, /', check1(Math.exp));
  mfn(m, 'exp2', 'x, /', check1((x) => Math.pow(2, x)));
  mfn(m, 'expm1', 'x, /', check1(Math.expm1));
  mfn(m, 'sin', 'x, /', check1(Math.sin, (x) => isFinite(x)));
  mfn(m, 'cos', 'x, /', check1(Math.cos, (x) => isFinite(x)));
  mfn(m, 'tan', 'x, /', check1(Math.tan, (x) => isFinite(x)));
  mfn(m, 'asin', 'x, /', check1(Math.asin, (x) => x >= -1 && x <= 1));
  mfn(m, 'acos', 'x, /', check1(Math.acos, (x) => x >= -1 && x <= 1));
  mfn(m, 'atan', 'x, /', check1(Math.atan));
  mfn(m, 'sinh', 'x, /', check1(Math.sinh));
  mfn(m, 'cosh', 'x, /', check1(Math.cosh));
  mfn(m, 'tanh', 'x, /', check1(Math.tanh));
  mfn(m, 'asinh', 'x, /', check1(Math.asinh));
  mfn(m, 'acosh', 'x, /', check1(Math.acosh, (x) => x >= 1));
  mfn(m, 'atanh', 'x, /', check1(Math.atanh, (x) => x > -1 && x < 1));
  mfn(m, 'atan2', 'y, x, /', (y: any, x: any) => F(Math.atan2(fl(y), fl(x))));
  mfn(m, 'fabs', 'x, /', (x: any) => F(Math.abs(fl(x))));
  mfn(m, 'degrees', 'x, /', (x: any) => F(fl(x) * 180 / Math.PI));
  mfn(m, 'radians', 'x, /', (x: any) => F(fl(x) * Math.PI / 180));
  mfn(m, 'log1p', 'x, /', check1(Math.log1p, (x) => x > -1));
  mfn(m, 'log2', 'x, /', (a: any) => {
    const v = ops.intValue(a);
    if (v !== undefined && typeof v === 'bigint' && v > 0n) {
      const bl = intBitLength(v);
      const sh = bl > 1000 ? bl - 1000 : 0;
      return F(sh + Math.log2(Number(v >> BigInt(sh))));
    }
    const x = fl(a);
    if (x <= 0) domain();
    return F(Math.log2(x));
  });
  mfn(m, 'log10', 'x, /', (a: any) => {
    const v = ops.intValue(a);
    if (v !== undefined && typeof v === 'bigint' && v > 0n) {
      const bl = intBitLength(v);
      const sh = bl > 1000 ? bl - 1000 : 0;
      return F(sh * Math.LOG10E * Math.LN2 + Math.log10(Number(v >> BigInt(sh))));
    }
    const x = fl(a);
    if (x <= 0) domain();
    return F(Math.log10(x));
  });
  mfn(m, 'log', 'x, base=, /', (a: any, base?: any) => {
    const ln = (v: any): number => {
      const iv = ops.intValue(v);
      if (iv !== undefined && typeof iv === 'bigint') {
        if (iv <= 0n) domain();
        const bl = intBitLength(iv);
        const sh = bl > 1000 ? bl - 1000 : 0;
        return sh * Math.LN2 + Math.log(Number(iv >> BigInt(sh)));
      }
      const x = fl(v);
      if (x <= 0) domain();
      return Math.log(x);
    };
    if (base === undefined) return F(ln(a));
    const d = ln(base);
    if (d === 0) throw (require('../runtime/errors') as typeof import('../runtime/errors')).zeroDivision('float division by zero');
    return F(ln(a) / d);
  });
  mfn(m, 'pow', 'x, y, /', (a: any, b: any) => {
    const x = fl(a);
    const y = fl(b);
    if ((x === 0 && y < 0 && isFinite(y)) || (x < 0 && isFinite(x) && isFinite(y) && !Number.isInteger(y))) domain();
    const r = Math.pow(x, y);
    if (!isFinite(r) && isFinite(x) && isFinite(y)) range();
    return F(x === 1 || y === 0 ? 1 : r);
  });
  mfn(m, 'floor', 'x, /', (a: any) => {
    const iv = ops.intValue(a);
    if (iv !== undefined) return iv;
    const t = typeOf(a).lookup('__floor__');
    if (t !== undefined && !(a instanceof PyFloat)) return callObj(t, [a]);
    const x = fl(a);
    if (x !== x) throw valueError('cannot convert float NaN to integer');
    if (!isFinite(x)) throw overflowError('cannot convert float infinity to integer');
    const r = Math.floor(x);
    return Number.isSafeInteger(r) ? (r === 0 ? 0 : r) : BigInt(r);
  });
  mfn(m, 'ceil', 'x, /', (a: any) => {
    const iv = ops.intValue(a);
    if (iv !== undefined) return iv;
    const t = typeOf(a).lookup('__ceil__');
    if (t !== undefined && !(a instanceof PyFloat)) return callObj(t, [a]);
    const x = fl(a);
    if (x !== x) throw valueError('cannot convert float NaN to integer');
    if (!isFinite(x)) throw overflowError('cannot convert float infinity to integer');
    const r = Math.ceil(x);
    return Number.isSafeInteger(r) ? (r === 0 ? 0 : r) : BigInt(r);
  });
  mfn(m, 'trunc', 'x, /', (a: any) => {
    const iv = ops.intValue(a);
    if (iv !== undefined) return iv;
    const t = typeOf(a).lookup('__trunc__');
    if (t !== undefined) return callObj(t, [a]);
    const x = fl(a);
    if (x !== x) throw valueError('cannot convert float NaN to integer');
    if (!isFinite(x)) throw overflowError('cannot convert float infinity to integer');
    const r = Math.trunc(x);
    return Number.isSafeInteger(r) ? (r === 0 ? 0 : r) : BigInt(r);
  });
  mfn(m, 'isnan', 'x, /', (a: any) => Number.isNaN(fl(a)));
  mfn(m, 'isinf', 'x, /', (a: any) => { const x = fl(a); return x === Infinity || x === -Infinity; });
  mfn(m, 'isfinite', 'x, /', (a: any) => Number.isFinite(fl(a)));
  mfn(m, 'copysign', 'x, y, /', (a: any, b: any) => {
    const x = Math.abs(fl(a));
    const y = fl(b);
    return F(y < 0 || Object.is(y, -0) ? -x : x);
  });
  mfn(m, 'fmod', 'x, y, /', (a: any, b: any) => {
    const x = fl(a);
    const y = fl(b);
    if (y === 0 || !isFinite(x)) { if (x === x && y === y) domain(); }
    return F(x % y);
  });
  mfn(m, 'modf', 'x, /', (a: any) => {
    const x = fl(a);
    if (!isFinite(x)) return new PyTuple([F(x !== x ? x : 0 * Math.sign(x)), F(x)]);
    const i = Math.trunc(x);
    return new PyTuple([F(x - i === 0 && Object.is(x, -0) ? -0 : x - i), F(i)]);
  });
  mfn(m, 'frexp', 'x, /', (a: any) => {
    const x = fl(a);
    if (x === 0 || !isFinite(x)) return new PyTuple([F(x), 0]);
    let e = Math.max(-1023, Math.floor(Math.log2(Math.abs(x))) + 1);
    let mant = x * Math.pow(2, -e);
    while (Math.abs(mant) < 0.5) { mant *= 2; e--; }
    while (Math.abs(mant) >= 1) { mant /= 2; e++; }
    return new PyTuple([F(mant), e]);
  });
  mfn(m, 'ldexp', 'x, i, /', (a: any, b: any) => {
    const r = fl(a) * Math.pow(2, Number(ops.toIndex(b)));
    if (!isFinite(r) && isFinite(fl(a))) range();
    return F(r);
  });
  mfn(m, 'hypot', '*coordinates', (c: any) => F(Math.hypot(...c.a.map(fl))));
  mfn(m, 'dist', 'p, q, /', (p: any, q: any) => {
    const a = ops.iterToArray(p).map(fl);
    const b = ops.iterToArray(q).map(fl);
    if (a.length !== b.length) throw valueError('both points must have the same number of dimensions');
    return F(Math.hypot(...a.map((x, i) => x - b[i])));
  });
  mfn(m, 'isclose', 'a, b, *, rel_tol=, abs_tol=', (a: any, b: any, rt?: any, at?: any) => {
    const x = fl(a);
    const y = fl(b);
    const rel = rt === undefined ? 1e-9 : fl(rt);
    const abs = at === undefined ? 0 : fl(at);
    if (rel < 0 || abs < 0) throw valueError('tolerances must be non-negative');
    if (x === y) return true;
    if (!isFinite(x) || !isFinite(y)) return false;
    const diff = Math.abs(y - x);
    return diff <= Math.abs(rel * y) || diff <= Math.abs(rel * x) || diff <= abs;
  });
  mfn(m, 'fsum', 'seq, /', (s: any) => F(fsum(ops.iterToArray(s).map(fl))));
  mfn(m, 'prod', 'iterable, /, *, start=', (it: any, start?: any) => {
    let r: any = start === undefined ? 1 : start;
    for (const x of ops.iterToArray(it)) r = ops.BINOPS['*'](r, x);
    return r;
  });
  mfn(m, 'gcd', '*integers', (ints: any) => {
    let g = 0n;
    for (const x of ints.a) g = gcd2(g, toBig(toInt(x, 'gcd')));
    return normBig(g);
  });
  mfn(m, 'lcm', '*integers', (ints: any) => {
    let l = 1n;
    for (const x of ints.a) {
      const v = toBig(toInt(x, 'lcm'));
      if (v === 0n) return 0;
      const g = gcd2(l, v);
      l = (l / g) * (v < 0n ? -v : v);
    }
    return normBig(l < 0n ? -l : l);
  });
  mfn(m, 'isqrt', 'n, /', (n: any) => {
    const v = toInt(n, 'isqrt');
    if (intSign(v) < 0) throw valueError('isqrt() argument must be nonnegative');
    return normBig(isqrtBig(toBig(v)));
  });
  mfn(m, 'factorial', 'n, /', (n: any) => {
    if (n instanceof PyFloat) throw typeError("'float' object cannot be interpreted as an integer");
    const v = toInt(n, 'factorial');
    if (intSign(v) < 0) throw valueError('factorial() not defined for negative values');
    if (intCmp(v, 100000) > 0) throw overflowError(`factorial() argument should not exceed ${Number.MAX_SAFE_INTEGER}`);
    return normBig(factorial(toBig(v)));
  });
  mfn(m, 'comb', 'n, k, /', (n: any, k: any) => {
    const nn = toBig(toInt(n, 'comb'));
    let kk = toBig(toInt(k, 'comb'));
    if (nn < 0n) throw valueError('n must be a non-negative integer');
    if (kk < 0n) throw valueError('k must be a non-negative integer');
    if (kk > nn) return 0;
    if (kk > nn - kk) kk = nn - kk;
    let r = 1n;
    for (let i = 1n; i <= kk; i++) r = (r * (nn - kk + i)) / i;
    return normBig(r);
  });
  mfn(m, 'perm', 'n, k=, /', (n: any, k?: any) => {
    const nn = toBig(toInt(n, 'perm'));
    if (nn < 0n) throw valueError('n must be a non-negative integer');
    if (k === undefined || k === null) return normBig(factorial(nn));
    const kk = toBig(toInt(k, 'perm'));
    if (kk < 0n) throw valueError('k must be a non-negative integer');
    if (kk > nn) return 0;
    let r = 1n;
    for (let i = 0n; i < kk; i++) r *= nn - i;
    return normBig(r);
  });
  mfn(m, 'gamma', 'x, /', (a: any) => {
    const x = fl(a);
    if (x <= 0 && Number.isInteger(x)) domain();
    if (Number.isInteger(x) && x < 171) { let r = 1; for (let i = 2; i < x; i++) r *= i; return F(r); }
    const r = x < 0.5 ? Math.PI / (Math.sin(Math.PI * x) * Math.exp(lgamma(1 - x))) : Math.exp(lgamma(x));
    if (!isFinite(r)) range();
    return F(r);
  });
  mfn(m, 'lgamma', 'x, /', (a: any) => F(lgamma(fl(a))));
  mfn(m, 'erf', 'x, /', (a: any) => F(erf(fl(a))));
  mfn(m, 'erfc', 'x, /', (a: any) => F(1 - erf(fl(a))));
  mfn(m, 'nextafter', 'x, y, /', (a: any, b: any) => {
    const x = fl(a);
    const y = fl(b);
    if (x !== x || y !== y) return F(NaN);
    if (x === y) return F(y);
    if (x === 0) return F(y > 0 ? 5e-324 : -5e-324);
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    let bits = buf.getBigInt64(0);
    bits += (y > x) === (x > 0) ? 1n : -1n;
    buf.setBigInt64(0, bits);
    return F(buf.getFloat64(0));
  });
  mfn(m, 'ulp', 'x, /', (a: any) => {
    const x = Math.abs(fl(a));
    if (!isFinite(x)) return F(x);
    if (x === 0) return F(5e-324);
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    const bits = buf.getBigInt64(0);
    buf.setBigInt64(0, bits + 1n);
    return F(buf.getFloat64(0) - x);
  });
  mfn(m, 'sumprod', 'p, q, /', (p: any, q: any) => {
    const a = ops.iterToArray(p);
    const b = ops.iterToArray(q);
    if (a.length !== b.length) throw valueError('Inputs are not the same length');
    let r: any = 0;
    for (let i = 0; i < a.length; i++) r = ops.opAdd(r, ops.opMul(a[i], b[i]));
    return r;
  });
  void I;
  void intAbs;
  void intMul;
});
