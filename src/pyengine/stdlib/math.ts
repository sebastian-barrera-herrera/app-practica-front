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

// gamma y lgamma: misma aproximación de Lanczos que mathmodule.c de CPython (N=13, g=6.0246800407767296)
const LANCZOS_G = 6.024680040776729583740234375;
const LANCZOS_GMH = 5.524680040776729583740234375;
const LANCZOS_NUM = [23531376880.410759688572007674451636754734846804940, 42919803642.649098768957899047001988850926355848959,
  35711959237.355668049440185451547166705960488635843, 17921034426.037209699919755754458931112671403265390,
  6039542586.3520280050642916443072979210699388420708, 1439720407.3117216736632230727949123939715485786772,
  248874557.86205415651146038641322942321632125127801, 31426415.585400194380614231628318205362874684987640,
  2876370.6289353724412254090516208496135991145378768, 186056.26539522349504029498971604569928220784236328,
  8071.6720023658162106380029022722506138218516325024, 210.82427775157934587250973392071336271166969580291,
  2.5066282746310002701649081771338373386264310793408];
const LANCZOS_DEN = [0, 39916800, 120543840, 150917976, 105258076, 45995730, 13339535, 2637558, 357423, 32670, 1925, 66, 1];
const LOGPI = 1.144729885849400174143427351353058711647294812915311571513623071472137769884826079783623270275489708;
const GAMMA_INTEGRAL = [1.0, 1.0, 2.0, 6.0, 24.0, 120.0, 720.0, 5040.0, 40320.0, 362880.0, 3628800.0, 39916800.0, 479001600.0,
  6227020800.0, 87178291200.0, 1307674368000.0, 20922789888000.0, 355687428096000.0, 6402373705728000.0,
  121645100408832000.0, 2432902008176640000.0, 51090942171709440000.0, 1124000727777607680000.0];

function lanczosSum(x: number): number {
  let num = 0;
  let den = 0;
  if (x < 5) {
    for (let i = 12; i >= 0; i--) {
      num = num * x + LANCZOS_NUM[i];
      den = den * x + LANCZOS_DEN[i];
    }
  } else {
    for (let i = 0; i < 13; i++) {
      num = num / x + LANCZOS_NUM[i];
      den = den / x + LANCZOS_DEN[i];
    }
  }
  return num / den;
}

function sinpi(x: number): number {
  const y = Math.abs(x) % 2;
  const n = Math.round(3 * y);
  let r: number;
  switch (n) {
    case 0: r = Math.sin(Math.PI * y); break;
    case 1: r = Math.cos(Math.PI * (0.5 - y)); break;
    case 2: r = Math.sin(Math.PI * (1 - y)); break;
    case 3: r = -Math.cos(Math.PI * (y - 1.5)); break;
    default: r = Math.sin(Math.PI * (y - 2)); break;
  }
  return (x < 0 || Object.is(x, -0) ? -1 : 1) * r;
}

/** Devuelve NaN con `err` = 'domain' o 'range' para que el llamador lance el error de Python. */
function tgamma(x: number): { v: number; err?: 'domain' | 'range' } {
  if (!isFinite(x)) return x !== x || x > 0 ? { v: x } : { v: NaN, err: 'domain' };
  if (x === 0) return { v: Object.is(x, -0) ? -Infinity : Infinity, err: 'domain' };
  if (x === Math.floor(x)) {
    if (x < 0) return { v: NaN, err: 'domain' };
    if (x <= 23) return { v: GAMMA_INTEGRAL[x - 1] };
  }
  const absx = Math.abs(x);
  if (absx < 1e-20) {
    const r = 1 / x;
    return isFinite(r) ? { v: r } : { v: r, err: 'range' };
  }
  if (absx > 200) {
    if (x < 0) return { v: 0 / sinpi(x) };
    return { v: Infinity, err: 'range' };
  }
  const y = absx + LANCZOS_GMH;
  let z: number;
  if (absx > LANCZOS_GMH) {
    const q = y - absx;
    z = q - LANCZOS_GMH;
  } else {
    const q = y - LANCZOS_GMH;
    z = q - absx;
  }
  z = z * LANCZOS_G / y;
  let r: number;
  if (x < 0) {
    r = -Math.PI / sinpi(absx) / absx * Math.exp(y) / lanczosSum(absx);
    r -= z * r;
    if (absx < 140) r /= Math.pow(y, absx - 0.5);
    else {
      const sp = Math.pow(y, absx / 2 - 0.25);
      r /= sp;
      r /= sp;
    }
  } else {
    r = lanczosSum(absx) / Math.exp(y);
    r += z * r;
    if (absx < 140) r *= Math.pow(y, absx - 0.5);
    else {
      const sp = Math.pow(y, absx / 2 - 0.25);
      r *= sp;
      r *= sp;
    }
  }
  return isFinite(r) ? { v: r } : { v: r, err: 'range' };
}

function lgammaC(x: number): { v: number; err?: 'domain' | 'range' } {
  if (!isFinite(x)) return x !== x ? { v: x } : { v: Infinity };
  if (x === Math.floor(x) && x <= 2) {
    if (x <= 0) return { v: Infinity, err: 'domain' };
    return { v: 0 };
  }
  const absx = Math.abs(x);
  if (absx < 1e-20) return { v: -Math.log(absx) };
  let r = Math.log(lanczosSum(absx)) - LANCZOS_G;
  r += (absx - 0.5) * (Math.log(absx + LANCZOS_GMH) - 1);
  if (x < 0) r = LOGPI - Math.log(Math.abs(sinpi(absx))) - Math.log(absx) - r;
  return isFinite(r) ? { v: r } : { v: r, err: 'range' };
}

// erf/erfc: algoritmo de fdlibm (s_erf.c), el mismo que usa la libm de Linux
const ERX = 8.45062911510467529297e-01;
const EFX = 1.28379167095512586316e-01;
const EFX8 = 1.02703333676410069053e+00;
const PP = [1.28379167095512558561e-01, -3.25042107247001499370e-01, -2.84817495755985104766e-02, -5.77027029648944159157e-03, -2.37630166566501626084e-05];
const QQ = [1, 3.97917223959155352819e-01, 6.50222499887672944485e-02, 5.08130628187576562776e-03, 1.32494738004321644526e-04, -3.96022827877536812320e-06];
const PA = [-2.36211856075265944077e-03, 4.14856118683748331666e-01, -3.72207876035701323847e-01, 3.18346619901161753674e-01, -1.10894694282396677476e-01, 3.54783043256182359371e-02, -2.16637559486879084300e-03];
const QA = [1, 1.06420880400844228286e-01, 5.40397917702171048937e-01, 7.18286544141962662868e-02, 1.26171219808761642112e-01, 1.36370839120290507362e-02, 1.19844998467991074170e-02];
const RA = [-9.86494403484714822705e-03, -6.93858572707181764372e-01, -1.05586262253232909814e+01, -6.23753324503260060396e+01, -1.62396669462573470355e+02, -1.84605092906711035994e+02, -8.12874355063065934246e+01, -9.81432934416914548592e+00];
const SA = [1, 1.96512716674392571292e+01, 1.37657754143519042600e+02, 4.34565877475229228821e+02, 6.45387271733267880336e+02, 4.29008140027567833386e+02, 1.08635005541779435134e+02, 6.57024977031928170135e+00, -6.04244152148580987438e-02];
const RB = [-9.86494292470009928597e-03, -7.99283237680523006574e-01, -1.77579549177547519889e+01, -1.60636384855821916062e+02, -6.37566443368389627722e+02, -1.02509513161107724954e+03, -4.83519191608651397019e+02];
const SB = [1, 3.03380607434824582924e+01, 3.25792512996573918826e+02, 1.53672958608443695994e+03, 3.19985821950859553908e+03, 2.55305040643316442583e+03, 4.74528541206955367215e+02, -2.24409524465858183362e+01];

function poly(c: number[], x: number): number {
  let r = c[c.length - 1];
  for (let i = c.length - 2; i >= 0; i--) r = c[i] + x * r;
  return r;
}

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
function hiWord(x: number): number {
  F64[0] = x;
  return U32[1] | 0;
}
function lowZero(x: number): number {
  F64[0] = x;
  U32[0] = 0;
  return F64[0];
}

function erfTail(ax: number, hi: number, lowCut: number): number {
  const s = 1 / (ax * ax);
  let R: number;
  let S: number;
  if (hi < lowCut) { R = poly(RA, s); S = poly(SA, s); } else { R = poly(RB, s); S = poly(SB, s); }
  const z = lowZero(ax);
  return Math.exp(-z * z - 0.5625) * Math.exp((z - ax) * (z + ax) + R / S);
}

function erf(x: number): number {
  if (x !== x) return x;
  if (!isFinite(x)) return x > 0 ? 1 : -1;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3feb0000) {
    if (ix < 0x3e300000) {
      if (ix < 0x00800000) return 0.125 * (8.0 * x + EFX8 * x);
      return x + EFX * x;
    }
    const z = x * x;
    return x + x * (poly(PP, z) / poly(QQ, z));
  }
  if (ix < 0x3ff40000) {
    const s = Math.abs(x) - 1;
    const pq = poly(PA, s) / poly(QA, s);
    return hx >= 0 ? ERX + pq : -ERX - pq;
  }
  if (ix >= 0x40180000) return hx >= 0 ? 1 - 1e-300 : 1e-300 - 1;
  const ax = Math.abs(x);
  const r = erfTail(ax, ix, 0x4006db6e);
  return hx >= 0 ? 1 - r / ax : r / ax - 1;
}

function erfc(x: number): number {
  if (x !== x) return x;
  if (!isFinite(x)) return x > 0 ? 0 : 2;
  const hx = hiWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x3feb0000) {
    if (ix < 0x3c700000) return 1 - x;
    const z = x * x;
    const y = poly(PP, z) / poly(QQ, z);
    if (hx < 0x3fd00000) return 1 - (x + x * y);
    return 0.5 - (x * y + (x - 0.5));
  }
  if (ix < 0x3ff40000) {
    const s = Math.abs(x) - 1;
    const pq = poly(PA, s) / poly(QA, s);
    return hx >= 0 ? 1 - ERX - pq : 1 + (ERX + pq);
  }
  if (ix < 0x403c0000) {
    const ax = Math.abs(x);
    if (hx < 0 && ix >= 0x40180000) return 2 - 1e-300;
    const r = erfTail(ax, ix, 0x4006db6d);
    return hx > 0 ? r / ax : 2 - r / ax;
  }
  return hx > 0 ? 0 : 2 - 1e-300;
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
    const r = tgamma(fl(a));
    if (r.err === 'domain') domain();
    if (r.err === 'range') range();
    return F(r.v);
  });
  mfn(m, 'lgamma', 'x, /', (a: any) => {
    const r = lgammaC(fl(a));
    if (r.err === 'domain') domain();
    if (r.err === 'range') range();
    return F(r.v);
  });
  mfn(m, 'erf', 'x, /', (a: any) => F(erf(fl(a))));
  mfn(m, 'erfc', 'x, /', (a: any) => F(erfc(fl(a))));
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
