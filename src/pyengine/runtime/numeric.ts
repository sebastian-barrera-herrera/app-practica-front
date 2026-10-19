/**
 * Aritmética de enteros (number seguro o bigint) y floats con la semántica de Python.
 */
import { PyFloat } from './objects';
import { overflowError, valueError, zeroDivision } from './errors';

export type PyInt = number | bigint;

export const MAXS = Number.MAX_SAFE_INTEGER;

export function normBig(b: bigint): PyInt {
  if (b >= -9007199254740991n && b <= 9007199254740991n) return Number(b);
  return b;
}
export function toBig(x: PyInt): bigint {
  return typeof x === 'bigint' ? x : BigInt(x);
}

export function intAdd(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a + b;
    if (r >= -MAXS && r <= MAXS) return r;
  }
  return normBig(toBig(a) + toBig(b));
}
export function intSub(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a - b;
    if (r >= -MAXS && r <= MAXS) return r;
  }
  return normBig(toBig(a) - toBig(b));
}
export function intMul(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a * b;
    if (r >= -MAXS && r <= MAXS) return r === 0 ? 0 : r;
  }
  return normBig(toBig(a) * toBig(b));
}
export function intNeg(a: PyInt): PyInt {
  if (typeof a === 'number') return a === 0 ? 0 : -a;
  return normBig(-a);
}
export function intFloorDiv(a: PyInt, b: PyInt): PyInt {
  if (typeof b === 'number' ? b === 0 : b === 0n) throw zeroDivision('integer division or modulo by zero');
  if (typeof a === 'number' && typeof b === 'number' && a <= 4503599627370496 && a >= -4503599627370496) {
    const q = Math.floor(a / b);
    return q === 0 ? 0 : q;
  }
  const x = toBig(a);
  const y = toBig(b);
  let q = x / y;
  if ((x % y !== 0n) && ((x < 0n) !== (y < 0n))) q -= 1n;
  return normBig(q);
}
export function intMod(a: PyInt, b: PyInt): PyInt {
  if (typeof b === 'number' ? b === 0 : b === 0n) throw zeroDivision('integer modulo by zero');
  if (typeof a === 'number' && typeof b === 'number') {
    let r = a % b;
    if (r !== 0 && (r < 0) !== (b < 0)) r += b;
    return r === 0 ? 0 : r;
  }
  const x = toBig(a);
  const y = toBig(b);
  let r = x % y;
  if (r !== 0n && (r < 0n) !== (y < 0n)) r += y;
  return normBig(r);
}
export function intDivmod(a: PyInt, b: PyInt): [PyInt, PyInt] {
  return [intFloorDiv(a, b), intMod(a, b)];
}

const MAX_POW_BITS = 64 * 1024 * 1024;
export function intPow(a: PyInt, b: PyInt): PyInt | PyFloat {
  if (typeof b === 'bigint' ? b < 0n : b < 0) {
    // exponente negativo → float
    const af = intToFloat(a);
    if (af === 0) throw zeroDivision('0.0 cannot be raised to a negative power');
    return new PyFloat(floatPow(af, intToFloat(b)));
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (b === 0) return 1;
    if (a === 0) return 0;
    if (a === 1) return 1;
    if (a === -1) return b % 2 === 0 ? 1 : -1;
    const r = Math.pow(a, b);
    if (r >= -MAXS && r <= MAXS) return r === 0 ? 0 : r;
    // estimar tamaño
    if (b * Math.log2(Math.abs(a)) > MAX_POW_BITS) throw overflowError('exponent too large');
    return normBig(BigInt(a) ** BigInt(b));
  }
  const x = toBig(a);
  const y = toBig(b);
  if (x === 0n || x === 1n) return normBig(y === 0n ? 1n : x);
  if (x === -1n) return y % 2n === 0n ? 1 : -1;
  if (y > 100000000n) throw overflowError('exponent too large');
  const bits = Number(y) * x.toString(2).length;
  if (bits > MAX_POW_BITS) throw overflowError('exponent too large');
  return normBig(x ** y);
}
export function intPowMod(a: PyInt, b: PyInt, m: PyInt): PyInt {
  const mm = toBig(m);
  if (mm === 0n) throw valueError('pow() 3rd argument cannot be 0');
  const am = mm < 0n ? -mm : mm;
  let base = toBig(a);
  let e = toBig(b);
  if (e < 0n) {
    const inv = modInverse(base, am);
    if (inv === null) throw valueError('base is not invertible for the given modulus');
    base = inv;
    e = -e;
  }
  base = ((base % am) + am) % am;
  let result = 1n % am;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % am;
    e >>= 1n;
    base = (base * base) % am;
  }
  if (mm < 0n && result !== 0n) result += mm;
  return normBig(result);
}
function modInverse(a: bigint, m: bigint): bigint | null {
  const mm = m < 0n ? -m : m;
  let [old_r, r] = [((a % mm) + mm) % mm, mm];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) return null;
  return ((old_s % mm) + mm) % mm;
}

export function intLshift(a: PyInt, b: PyInt): PyInt {
  if (typeof b === 'bigint' ? b < 0n : b < 0) throw valueError('negative shift count');
  if (typeof b === 'bigint' || b > 1 << 26) {
    if (a === 0 || a === 0n) return 0;
    throw overflowError('too many digits in integer');
  }
  if (typeof a === 'number' && b < 31 && a >= -1073741824 && a <= 1073741823) return a * 2 ** b;
  return normBig(toBig(a) << BigInt(b));
}
export function intRshift(a: PyInt, b: PyInt): PyInt {
  if (typeof b === 'bigint' ? b < 0n : b < 0) throw valueError('negative shift count');
  if (typeof b === 'bigint') return (typeof a === 'bigint' ? a < 0n : a < 0) ? -1 : 0;
  if (typeof a === 'number') {
    if (b >= 53) return a < 0 ? -1 : 0;
    return Math.floor(a / 2 ** b);
  }
  return normBig(a >> BigInt(b));
}
export function intAnd(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number' && a >= -2147483648 && a <= 2147483647 && b >= -2147483648 && b <= 2147483647) return a & b;
  return normBig(toBig(a) & toBig(b));
}
export function intOr(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number' && a >= -2147483648 && a <= 2147483647 && b >= -2147483648 && b <= 2147483647) return a | b;
  return normBig(toBig(a) | toBig(b));
}
export function intXor(a: PyInt, b: PyInt): PyInt {
  if (typeof a === 'number' && typeof b === 'number' && a >= -2147483648 && a <= 2147483647 && b >= -2147483648 && b <= 2147483647) return a ^ b;
  return normBig(toBig(a) ^ toBig(b));
}
export function intInvert(a: PyInt): PyInt {
  if (typeof a === 'number') return -a - 1;
  return normBig(~a);
}
export function intCmp(a: PyInt, b: PyInt): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const x = toBig(a);
  const y = toBig(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function intSign(a: PyInt): number {
  return typeof a === 'bigint' ? (a < 0n ? -1 : a > 0n ? 1 : 0) : a < 0 ? -1 : a > 0 ? 1 : 0;
}
export function intAbs(a: PyInt): PyInt {
  return typeof a === 'number' ? Math.abs(a) : normBig(a < 0n ? -a : a);
}
export function intBitLength(a: PyInt): number {
  const x = toBig(a < 0 ? intNeg(a) : a);
  if (x === 0n) return 0;
  return x.toString(2).length;
}

// ───────────────────────── conversión int ↔ float ─────────────────────────

export function intToFloat(a: PyInt): number {
  if (typeof a === 'number') return a;
  const d = Number(a);
  if (!isFinite(d)) throw overflowError('int too large to convert to float');
  return d;
}

/** a / b (true division) con redondeo correcto */
export function intTrueDiv(a: PyInt, b: PyInt): number {
  if (typeof b === 'number' ? b === 0 : b === 0n) throw zeroDivision('division by zero');
  if (typeof a === 'number' && typeof b === 'number') return a / b;
  const x = toBig(a);
  const y = toBig(b);
  const neg = (x < 0n) !== (y < 0n);
  const ax = x < 0n ? -x : x;
  const ay = y < 0n ? -y : y;
  if (ax === 0n) return neg ? -0 : 0;
  // escalar para obtener al menos 64 bits de cociente
  const la = ax.toString(2).length;
  const lb = ay.toString(2).length;
  const shift = 66 - (la - lb);
  let num = ax;
  let den = ay;
  if (shift > 0) num <<= BigInt(shift);
  else den <<= BigInt(-shift);
  let q = num / den;
  const rem = num - q * den;
  if (rem !== 0n) q |= 1n; // bit pegajoso
  let r = Number(q);
  // multiplicar por 2^-shift sin perder precisión (en dos pasos para evitar subdesbordamientos intermedios)
  let s = -shift;
  while (s > 1000) { r *= 2 ** 1000; s -= 1000; }
  while (s < -1000) { r *= 2 ** -1000; s += 1000; }
  r *= 2 ** s;
  return neg ? -r : r;
}

// ───────────────────────── floats ─────────────────────────

export function floatMod(a: number, b: number): number {
  if (b === 0) throw zeroDivision('float modulo by zero');
  if (!isFinite(b) && isFinite(a)) {
    if ((a < 0) !== (b < 0) && a !== 0) return b;
    return a;
  }
  let m = a % b;
  if (m !== 0) {
    if ((b < 0) !== (m < 0)) m += b;
  } else {
    m = b < 0 ? -0 : 0;
  }
  return m;
}
export function floatFloorDiv(a: number, b: number): number {
  if (b === 0) throw zeroDivision('float floor division by zero');
  const mod = a % b;
  let div = (a - mod) / b;
  let m = mod;
  if (m !== 0) {
    if ((b < 0) !== (m < 0)) {
      m += b;
      div -= 1;
    }
  }
  let fd: number;
  if (div !== 0) {
    fd = Math.floor(div);
    if (div - fd > 0.5) fd += 1;
  } else {
    fd = (a / b) < 0 || Object.is(a / b, -0) ? -0 : 0;
  }
  return fd;
}
export function floatPow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a === 1) return 1;
  if (a !== a || b !== b) return NaN;
  if (a === 0 && b < 0) throw zeroDivision('0.0 cannot be raised to a negative power');
  const r = Math.pow(a, b);
  if (!isFinite(r) && isFinite(a) && isFinite(b) && a !== 0) {
    throw overflowError('(34, \'Numerical result out of range\')');
  }
  return r;
}

/** comparación exacta int-float: devuelve -1/0/1 (o NaN si f es NaN) */
export function cmpIntFloat(i: PyInt, f: number): number {
  if (f !== f) return NaN;
  if (f === Infinity) return -1;
  if (f === -Infinity) return 1;
  if (typeof i === 'number') {
    return i < f ? -1 : i > f ? 1 : 0;
  }
  const fl = Math.floor(f);
  const bf = BigInt(fl);
  if (i < bf) return -1;
  if (i > bf) return 1;
  return f > fl ? -1 : 0;
}

/** hash de Python para enteros (módulo 2^61 - 1) */
const P61 = 2305843009213693951n;
export function hashInt(a: PyInt): number {
  if (typeof a === 'number') {
    if (a >= 0 && a < 2305843009213693951) return a;
    if (a < 0 && a > -2305843009213693951) return a === -1 ? -2 : a;
  }
  const b = toBig(a);
  const neg = b < 0n;
  let r = (neg ? -b : b) % P61;
  if (neg) r = -r;
  if (r === -1n) r = -2n;
  return Number(r);
}

export function hashFloat(x: number): number {
  if (x !== x) return 0;
  if (x === Infinity) return 314159;
  if (x === -Infinity) return -314159;
  if (Number.isInteger(x)) {
    if (Math.abs(x) < 9007199254740992) return hashInt(x);
    return hashInt(BigInt(x));
  }
  // algoritmo de _Py_HashDouble para no enteros
  const mod = 2305843009213693951;
  let m = Math.abs(x);
  let e = 0;
  // frexp
  if (m !== 0) {
    e = Math.max(-1023, Math.floor(Math.log2(m)) + 1);
    let mant = m / 2 ** e;
    while (mant < 0.5) { mant *= 2; e--; }
    while (mant >= 1) { mant /= 2; e++; }
    m = mant;
  }
  let acc = 0n;
  const M = BigInt(mod);
  let mm = m;
  let ee = e;
  while (mm !== 0) {
    acc = ((acc << 28n) & M) | (acc >> BigInt(61 - 28));
    mm *= 268435456; // 2^28
    ee -= 28;
    const y = Math.floor(mm);
    mm -= y;
    acc += BigInt(y);
    if (acc >= M) acc -= M;
  }
  // ajustar exponente
  ee = ee >= 0 ? ee % 61 : 61 - 1 - ((-1 - ee) % 61);
  acc = ((acc << BigInt(ee)) & M) | (acc >> BigInt(61 - ee));
  let r = Number(acc);
  if (x < 0) r = -r;
  if (r === -1) r = -2;
  return r;
}
