/**
 * `int`, `bool`, `float` y `complex`.
 */
import { PyBox, PyBytes, PyByteArray, PyComplex, PyFloat, PyObject, PyProperty, PyTuple, PyType, PyClassMethod, F_BASETYPE, type Kw } from './objects';
import {
  NotImplemented, boolType, classMethodType, complexType, floatType, intType, propertyType, typeOf, bytesType, byteArrayType,
} from './builtin_types';
import { overflowError, typeError, valueError, zeroDivision } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import {
  cmpIntFloat, hashFloat, hashInt, intBitLength, intCmp, intDivmod, intFloorDiv, intMod, intPowMod, intSign, intToFloat, normBig, toBig,
  floatFloorDiv, floatMod, type PyInt,
} from './numeric';
import { floatRepr, formatFloat, formatInt, scaledRound, decompose, expStr } from './fmt';
import { defGetter, defMethods, mkNative } from './native';
import { asStr } from './util';

// ───────────────────────── utilidades ─────────────────────────

type Num = PyInt | PyFloat;

function numOf(x: any): Num | undefined {
  const i = ops.intValue(x);
  if (i !== undefined) return i;
  const f = ops.floatValue(x);
  if (f !== undefined) return new PyFloat(f);
  return undefined;
}

/** comparación numérica: -1/0/1, NaN si hay un NaN, undefined si no son números */
function cmpNum(a: any, b: any): number | undefined {
  const x = numOf(a);
  const y = numOf(b);
  if (x === undefined || y === undefined) return undefined;
  const xf = x instanceof PyFloat;
  const yf = y instanceof PyFloat;
  if (!xf && !yf) return intCmp(x as PyInt, y as PyInt);
  if (xf && yf) {
    const p = (x as PyFloat).v;
    const q = (y as PyFloat).v;
    if (p !== p || q !== q) return NaN;
    return p < q ? -1 : p > q ? 1 : 0;
  }
  if (xf) {
    const c = cmpIntFloat(y as PyInt, (x as PyFloat).v);
    return c !== c ? NaN : -c;
  }
  return cmpIntFloat(x as PyInt, (y as PyFloat).v);
}

function cmpMethod(op: string): (a: any, b: any) => any {
  return (a, b) => {
    const c = cmpNum(a, b);
    if (c === undefined) return NotImplemented;
    if (c !== c) return op === '!=';
    switch (op) {
      case '==': return c === 0;
      case '!=': return c !== 0;
      case '<': return c < 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      default: return c >= 0;
    }
  };
}

const ARITH: [string, string][] = [
  ['add', '+'], ['sub', '-'], ['mul', '*'], ['truediv', '/'], ['floordiv', '//'], ['mod', '%'], ['pow', '**'],
];
const BITS: [string, string][] = [['and', '&'], ['or', '|'], ['xor', '^'], ['lshift', '<<'], ['rshift', '>>']];

function isIntLike(x: any): boolean {
  return ops.intValue(x) !== undefined;
}

// ───────────────────────── int ─────────────────────────

const WS = /^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g;

function digitVal(c: string): number {
  const k = c.charCodeAt(0);
  if (k >= 48 && k <= 57) return k - 48;
  if (k >= 97 && k <= 122) return k - 87;
  if (k >= 65 && k <= 90) return k - 55;
  return 99;
}

function parseIntText(orig: string, base: number, shown: string): PyInt {
  const bad = (): never => {
    throw valueError(`invalid literal for int() with base ${base}: ${shown}`);
  };
  let s = orig.replace(WS, '');
  let neg = false;
  if (s[0] === '+' || s[0] === '-') {
    neg = s[0] === '-';
    s = s.slice(1);
  }
  let b = base;
  if (s.length >= 2 && s[0] === '0') {
    const p = s[1].toLowerCase();
    const pb = p === 'x' ? 16 : p === 'o' ? 8 : p === 'b' ? 2 : 0;
    if (pb !== 0 && (b === 0 || b === pb)) {
      b = pb;
      s = s.slice(2);
      if (s[0] === '_') s = s.slice(1);
    }
  }
  if (b === 0) {
    b = 10;
    if (s.length > 1 && s[0] === '0' && /[^0_]/.test(s)) bad();
  }
  if (s === '' || s[0] === '_' || s[s.length - 1] === '_' || s.includes('__')) bad();
  const t = s.replace(/_/g, '');
  if (t === '') bad();
  let v: bigint;
  if (b === 10) {
    if (!/^[0-9]+$/.test(t)) bad();
    if (t.length < 16) {
      const n = Number(t);
      return neg ? (n === 0 ? 0 : -n) : n;
    }
    v = BigInt(t);
  } else {
    v = 0n;
    const bb = BigInt(b);
    for (const c of t) {
      const d = digitVal(c);
      if (d >= b) bad();
      v = v * bb + BigInt(d);
    }
  }
  return normBig(neg ? -v : v);
}

function floatToInt(x: number): PyInt {
  if (x !== x) throw valueError('cannot convert float NaN to integer');
  if (!isFinite(x)) throw overflowError('cannot convert float infinity to integer');
  const t = Math.trunc(x);
  if (Math.abs(t) <= Number.MAX_SAFE_INTEGER) return t === 0 ? 0 : t;
  return BigInt(t);
}

function toIntFromObject(x: any): PyInt {
  const t = typeOf(x);
  let f = t.lookup('__int__');
  if (f !== undefined) {
    const r = callObj(f, [x]);
    const v = ops.intValue(r);
    if (v === undefined) throw typeError(`__int__ returned non-int (type ${typeOf(r).name})`);
    return v;
  }
  f = t.lookup('__index__');
  if (f !== undefined) return ops.toIndex(x);
  f = t.lookup('__trunc__');
  if (f !== undefined) {
    const r = callObj(f, [x]);
    const v = ops.intValue(r);
    if (v !== undefined) return v;
    return ops.toIndex(r);
  }
  throw typeError(`int() argument must be a string, a bytes-like object or a real number, not '${t.name}'`);
}

export function bytesToText(x: any): string | undefined {
  if (x instanceof PyBytes) return String.fromCharCode(...x.b);
  if (x instanceof PyByteArray) return String.fromCharCode(...x.b);
  return undefined;
}

function intNew(cls: any, x?: any, base?: any): any {
  let v: PyInt;
  if (x === undefined) {
    if (base !== undefined) throw typeError("int() missing string argument");
    v = 0;
  } else if (base !== undefined) {
    const b = ops.toIndexNum(base, `'${typeOf(base).name}' object cannot be interpreted as an integer`);
    if (b !== 0 && (b < 2 || b > 36)) throw valueError('int() base must be >= 2 and <= 36, or 0');
    if (ops.isStr(x)) v = parseIntText(ops.strValue(x), b, ops.repr(x));
    else {
      const bt = bytesToText(x);
      if (bt === undefined) throw typeError("int() can't convert non-string with explicit base");
      v = parseIntText(bt, b, ops.repr(x));
    }
  } else if (ops.isStr(x)) {
    v = parseIntText(ops.strValue(x), 10, ops.repr(x));
  } else if (x instanceof PyFloat) v = floatToInt(x.v);
  else if (ops.intValue(x) !== undefined) v = ops.intValue(x)!;
  else if (x instanceof PyBox && x.value instanceof PyFloat) v = floatToInt(x.value.v);
  else {
    const bt = bytesToText(x);
    v = bt !== undefined ? parseIntText(bt, 10, ops.repr(x)) : toIntFromObject(x);
  }
  if (cls === intType) return v;
  return new PyBox(cls, v);
}

intType.dict!.set('__new__', mkNative('__new__', 'cls, x=, base=', intNew, { owner: 'int' }));

function iv(x: any): PyInt {
  const v = ops.intValue(x);
  if (v === undefined) throw typeError(`descriptor requires an 'int' object but received a '${typeOf(x).name}'`);
  return v;
}

function intArith(name: string, op: string): void {
  intType.dict!.set(`__${name}__`, mkNative(`__${name}__`, name === 'pow' ? 'self, other, mod=' : 'self, other', (a: any, b: any, m?: any) => {
    const x = ops.intValue(a);
    const y = ops.intValue(b);
    if (x === undefined) throw typeError(`descriptor '__${name}__' requires a 'int' object but received a '${typeOf(a).name}'`);
    if (y === undefined) return NotImplemented;
    if (name === 'pow' && m !== undefined && m !== null) {
      const mm = ops.intValue(m);
      if (mm === undefined) return NotImplemented;
      if (intSign(y) < 0) {
        // pow con exponente negativo y módulo: inverso modular
        return intPowMod(x, y, mm);
      }
      return intPowMod(x, y, mm);
    }
    return ops.numericBinop(op, x, y);
  }, { method: true, owner: 'int' }));
  intType.dict!.set(`__r${name}__`, mkNative(`__r${name}__`, name === 'pow' ? 'self, other, mod=' : 'self, other', (a: any, b: any) => {
    const x = ops.intValue(a);
    const y = ops.intValue(b);
    if (x === undefined) throw typeError(`descriptor '__r${name}__' requires a 'int' object but received a '${typeOf(a).name}'`);
    if (y === undefined) return NotImplemented;
    return ops.numericBinop(op, y, x);
  }, { method: true, owner: 'int' }));
}
for (const [n, o] of [...ARITH, ...BITS]) intArith(n, o);

defMethods(intType, {
  __repr__: ['self', (a: any) => String(iv(a))],
  __str__: ['self', (a: any) => String(iv(a))],
  __hash__: ['self', (a: any) => hashInt(iv(a))],
  __bool__: ['self', (a: any) => intSign(iv(a)) !== 0],
  __int__: ['self', (a: any) => iv(a)],
  __index__: ['self', (a: any) => iv(a)],
  __float__: ['self', (a: any) => new PyFloat(intToFloat(iv(a)))],
  __trunc__: ['self', (a: any) => iv(a)],
  __floor__: ['self', (a: any) => iv(a)],
  __ceil__: ['self', (a: any) => iv(a)],
  __neg__: ['self', (a: any) => ops.unaryNeg(iv(a))],
  __pos__: ['self', (a: any) => iv(a)],
  __abs__: ['self', (a: any) => { const v = iv(a); return intSign(v) < 0 ? ops.unaryNeg(v) : v; }],
  __invert__: ['self', (a: any) => ops.unaryInvert(iv(a))],
  __eq__: ['self, other', cmpMethod('==')],
  __ne__: ['self, other', cmpMethod('!=')],
  __lt__: ['self, other', cmpMethod('<')],
  __le__: ['self, other', cmpMethod('<=')],
  __gt__: ['self, other', cmpMethod('>')],
  __ge__: ['self, other', cmpMethod('>=')],
  __divmod__: ['self, other', (a: any, b: any) => {
    const y = ops.intValue(b);
    if (y === undefined) return NotImplemented;
    const [q, r] = intDivmod(iv(a), y);
    return new PyTuple([q, r]);
  }],
  __rdivmod__: ['self, other', (a: any, b: any) => {
    const y = ops.intValue(b);
    if (y === undefined) return NotImplemented;
    const [q, r] = intDivmod(y, iv(a));
    return new PyTuple([q, r]);
  }],
  __round__: ['self, ndigits=', (a: any, nd?: any) => {
    const v = iv(a);
    if (nd === undefined || nd === null) return v;
    const n = ops.toIndexNum(nd);
    if (n >= 0) return v;
    const p = 10n ** BigInt(-n);
    const bv = toBig(v);
    let q = bv / p;
    const r = bv - q * p;
    const twice = (r < 0n ? -r : r) * 2n;
    const neg = bv < 0n;
    if (twice > p || (twice === p && (q % 2n !== 0n))) q += neg ? -1n : 1n;
    return normBig(q * p);
  }],
  __format__: ['self, spec', (a: any, spec: any) => {
    const s = asStr(spec, 'format_spec');
    const v = iv(a);
    if (typeof a === 'boolean' || (a instanceof PyBox && typeof a.value === 'boolean')) return s === '' ? (v ? 'True' : 'False') : formatInt(v, s, 'bool');
    return s === '' ? String(v) : formatInt(v, s);
  }],
  __sizeof__: ['self', () => 28],
  __getnewargs__: ['self', (a: any) => new PyTuple([iv(a)])],
  bit_length: ['self', (a: any) => intBitLength(iv(a))],
  bit_count: ['self', (a: any) => {
    let b = toBig(iv(a));
    if (b < 0n) b = -b;
    let c = 0;
    while (b > 0n) { if (b & 1n) c++; b >>= 1n; }
    return c;
  }],
  conjugate: ['self', (a: any) => iv(a)],
  is_integer: ['self', () => true],
  as_integer_ratio: ['self', (a: any) => new PyTuple([iv(a), 1])],
  to_bytes: ['self, length=1, byteorder="big", *, signed=', (a: any, length: any, order: any, signed: any) => {
    length = length === undefined ? 1 : length;
    order = order === undefined ? 'big' : order;
    const len = ops.toIndexNum(length);
    if (len < 0) throw valueError('length argument must be non-negative');
    const big = order === 'big';
    if (!big && order !== 'little') throw valueError("byteorder must be either 'little' or 'big'");
    let v = toBig(iv(a));
    const sg = signed !== undefined && ops.truthy(signed);
    if (v < 0n && !sg) throw overflowError("can't convert negative int to unsigned");
    const lim = 1n << BigInt(8 * len);
    if (sg) {
      if (v >= lim / 2n || v < -lim / 2n) throw overflowError('int too big to convert');
      if (v < 0n) v += lim;
    } else if (v >= lim) throw overflowError('int too big to convert');
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[big ? len - 1 - i : i] = Number(v & 255n);
      v >>= 8n;
    }
    return new PyBytes(out, bytesType);
  }],
});
intType.dict!.set('__doc__', 'int([x]) -> integer\nint(x, base=10) -> integer');
intType.dict!.set('from_bytes', new PyClassMethod(classMethodType, mkNative('from_bytes', 'cls, bytes, byteorder="big", *, signed=', (cls: any, bs: any, order: any, signed: any) => {
  order = order === undefined ? 'big' : order;
  let arr: ArrayLike<number>;
  if (bs instanceof PyBytes) arr = bs.b;
  else if (bs instanceof PyByteArray) arr = bs.b;
  else arr = ops.iterToArray(bs).map((x: any) => Number(ops.toIndex(x)));
  const big = order === 'big';
  if (!big && order !== 'little') throw valueError("byteorder must be either 'little' or 'big'");
  let v = 0n;
  const n = arr.length;
  for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(arr[big ? i : n - 1 - i]);
  if (signed !== undefined && ops.truthy(signed) && n > 0 && (arr[big ? 0 : n - 1] & 128)) v -= 1n << BigInt(8 * n);
  const r = normBig(v);
  return cls === intType ? r : new PyBox(cls, r);
}, { owner: 'int' })));
function prop(t: PyType, name: string, get: (x: any) => any): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', get, { method: true });
  t.dict!.set(name, p);
}
prop(intType, 'real', (a) => iv(a));
prop(intType, 'imag', () => 0);
prop(intType, 'numerator', (a) => iv(a));
prop(intType, 'denominator', () => 1);

// ───────────────────────── bool ─────────────────────────

boolType.dict!.set('__new__', mkNative('__new__', 'cls, x=', (cls: any, x?: any) => {
  if (cls !== boolType) throw typeError("type 'bool' is not an acceptable base type");
  return x === undefined ? false : ops.truthy(x);
}, { owner: 'bool' }));
defMethods(boolType, {
  __repr__: ['self', (a: any) => (iv(a) ? 'True' : 'False')],
  __str__: ['self', (a: any) => (iv(a) ? 'True' : 'False')],
});
for (const [n, o] of [['and', '&'], ['or', '|'], ['xor', '^']] as const) {
  for (const pre of ['', 'r']) {
    boolType.dict!.set(`__${pre}${n}__`, mkNative(`__${pre}${n}__`, 'self, other', (a: any, b: any) => {
      const x = ops.intValue(a);
      const y = ops.intValue(b);
      if (y === undefined) return NotImplemented;
      if (typeof a === 'boolean' && typeof b === 'boolean') return ops.numericBinop(o, a, b);
      return pre ? ops.numericBinop(o, y, x!) : ops.numericBinop(o, x!, y);
    }, { method: true, owner: 'bool' }));
  }
}

// ───────────────────────── float ─────────────────────────

const FLOAT_RE = /^[+-]?(?:(?:\d+(?:_\d+)*)?\.?(?:\d+(?:_\d+)*)?)(?:[eE][+-]?\d+(?:_\d+)*)?$/;

export function parseFloatText(orig: string): number | undefined {
  const s = orig.replace(WS, '');
  const low = s.toLowerCase();
  const m = /^([+-]?)(inf|infinity|nan)$/.exec(low);
  if (m) return m[2] === 'nan' ? NaN : m[1] === '-' ? -Infinity : Infinity;
  if (!FLOAT_RE.test(s) || !/\d/.test(s.split(/[eE]/)[0])) return undefined;
  return Number(s.replace(/_/g, ''));
}

function toFloatValue(x: any): number {
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
  if (ops.isStr(x)) {
    const v = parseFloatText(ops.strValue(x));
    if (v === undefined) throw valueError(`could not convert string to float: ${ops.repr(x)}`);
    return v;
  }
  const bt = bytesToText(x);
  if (bt !== undefined) {
    const v = parseFloatText(bt);
    if (v === undefined) throw valueError(`could not convert string to float: ${ops.repr(x)}`);
    return v;
  }
  const t = typeOf(x);
  let f2 = t.lookup('__float__');
  if (f2 !== undefined) {
    const r = callObj(f2, [x]);
    if (r instanceof PyFloat) return r.v;
    const rv = ops.floatValue(r);
    if (rv !== undefined) return rv;
    throw typeError(`${t.name}.__float__ returned non-float (type ${typeOf(r).name})`);
  }
  f2 = t.lookup('__index__');
  if (f2 !== undefined) {
    const v = ops.toIndex(x);
    return typeof v === 'bigint' ? Number(v) : v;
  }
  throw typeError(`float() argument must be a string or a real number, not '${t.name}'`);
}

floatType.dict!.set('__new__', mkNative('__new__', 'cls, x=', (cls: any, x?: any) => {
  const v = new PyFloat(x === undefined ? 0 : toFloatValue(x));
  if (cls === floatType) return v;
  return new PyBox(cls, v);
}, { owner: 'float' }));

function fv(x: any): number {
  const f = ops.floatValue(x);
  if (f === undefined) throw typeError(`descriptor requires a 'float' object but received a '${typeOf(x).name}'`);
  return f;
}

function floatArith(name: string, op: string): void {
  floatType.dict!.set(`__${name}__`, mkNative(`__${name}__`, name === 'pow' ? 'self, other, mod=' : 'self, other', (a: any, b: any, m?: any) => {
    const x = new PyFloat(fv(a));
    const y = numOf(b);
    if (y === undefined) return NotImplemented;
    if (m !== undefined && m !== null) throw typeError('pow() 3rd argument not allowed unless all arguments are integers');
    return ops.numericBinop(op, x, y);
  }, { method: true, owner: 'float' }));
  floatType.dict!.set(`__r${name}__`, mkNative(`__r${name}__`, name === 'pow' ? 'self, other, mod=' : 'self, other', (a: any, b: any) => {
    const x = new PyFloat(fv(a));
    const y = numOf(b);
    if (y === undefined) return NotImplemented;
    return ops.numericBinop(op, y, x);
  }, { method: true, owner: 'float' }));
}
for (const [n, o] of ARITH) floatArith(n, o);

/** round-half-even de un float a entero exacto */
function roundHalfEvenToInt(x: number): PyInt {
  if (x !== x) throw valueError('cannot convert float NaN to integer');
  if (!isFinite(x)) throw overflowError('cannot convert float infinity to integer');
  const n = scaledRound(Math.abs(x), 0);
  const v = normBig(x < 0 ? -n : n);
  return v;
}

export function roundFloat(x: number, nd: number): number {
  if (!isFinite(x) || x === 0) return x;
  if (nd > 323) return x;
  if (nd < -308) return x < 0 ? -0 : 0;
  const neg = x < 0;
  const ax = Math.abs(x);
  let r: number;
  if (nd >= 0) r = Number(fixedFromScaled(ax, nd));
  else {
    const q = scaledRound(ax, nd); // round(x / 10^-nd)
    r = Number(q * 10n ** BigInt(-nd));
  }
  if (!isFinite(r)) throw overflowError('rounded value too large to represent');
  return neg ? -r : r;
}
function fixedFromScaled(ax: number, nd: number): string {
  const n = scaledRound(ax, nd);
  let s = n.toString();
  if (nd === 0) return s;
  if (s.length <= nd) s = '0'.repeat(nd - s.length + 1) + s;
  return s.slice(0, s.length - nd) + '.' + s.slice(s.length - nd);
}

defMethods(floatType, {
  __repr__: ['self', (a: any) => floatRepr(fv(a))],
  __str__: ['self', (a: any) => floatRepr(fv(a))],
  __hash__: ['self', (a: any) => hashFloat(fv(a))],
  __bool__: ['self', (a: any) => fv(a) !== 0],
  __int__: ['self', (a: any) => floatToInt(fv(a))],
  __float__: ['self', (a: any) => new PyFloat(fv(a))],
  __trunc__: ['self', (a: any) => floatToInt(fv(a))],
  __floor__: ['self', (a: any) => floatToInt(Math.floor(fv(a)))],
  __ceil__: ['self', (a: any) => floatToInt(Math.ceil(fv(a)))],
  __neg__: ['self', (a: any) => new PyFloat(-fv(a))],
  __pos__: ['self', (a: any) => new PyFloat(fv(a))],
  __abs__: ['self', (a: any) => new PyFloat(Math.abs(fv(a)))],
  __eq__: ['self, other', cmpMethod('==')],
  __ne__: ['self, other', cmpMethod('!=')],
  __lt__: ['self, other', cmpMethod('<')],
  __le__: ['self, other', cmpMethod('<=')],
  __gt__: ['self, other', cmpMethod('>')],
  __ge__: ['self, other', cmpMethod('>=')],
  __divmod__: ['self, other', (a: any, b: any) => floatDivmod(fv(a), b, false)],
  __rdivmod__: ['self, other', (a: any, b: any) => floatDivmod(fv(a), b, true)],
  __round__: ['self, ndigits=', (a: any, nd?: any) => {
    const x = fv(a);
    if (nd === undefined || nd === null) return roundHalfEvenToInt(x);
    return new PyFloat(roundFloat(x, ops.toIndexNum(nd)));
  }],
  __format__: ['self, spec', (a: any, spec: any) => {
    const s = asStr(spec, 'format_spec');
    return s === '' ? floatRepr(fv(a)) : formatFloat(fv(a), s);
  }],
  __getnewargs__: ['self', (a: any) => new PyTuple([new PyFloat(fv(a))])],
  conjugate: ['self', (a: any) => new PyFloat(fv(a))],
  is_integer: ['self', (a: any) => { const x = fv(a); return isFinite(x) && Math.floor(x) === x; }],
  as_integer_ratio: ['self', (a: any) => {
    const x = fv(a);
    if (x !== x) throw valueError('cannot convert NaN to integer ratio');
    if (!isFinite(x)) throw overflowError('cannot convert Infinity to integer ratio');
    if (x === 0) return new PyTuple([0, 1]);
    const { m, e } = decompose(Math.abs(x));
    let num = m;
    let den = 1n;
    if (e >= 0) num <<= BigInt(e);
    else den <<= BigInt(-e);
    // reducir
    let g = num;
    let h = den;
    while (h > 0n) [g, h] = [h, g % h];
    num /= g;
    den /= g;
    return new PyTuple([normBig(x < 0 ? -num : num), normBig(den)]);
  }],
  hex: ['self', (a: any) => floatHex(fv(a))],
});
floatType.dict!.set('fromhex', new PyClassMethod(classMethodType, mkNative('fromhex', 'cls, s', (cls: any, s: any) => {
  const t = asStr(s).trim().toLowerCase();
  const m = /^([+-]?)0x([0-9a-f]*)\.?([0-9a-f]*)(?:p([+-]?\d+))?$/.exec(t);
  if (!m) {
    const f = parseFloatText(t);
    if (f === undefined) throw valueError('invalid hexadecimal floating-point string');
    return new PyFloat(f);
  }
  const intPart = m[2] === '' ? 0n : BigInt('0x' + m[2]);
  const frac = m[3];
  let mant = intPart;
  for (const c of frac) mant = mant * 16n + BigInt(parseInt(c, 16));
  const exp = (m[4] ? parseInt(m[4], 10) : 0) - 4 * frac.length;
  const v = Number(mant) * Math.pow(2, exp);
  const r = new PyFloat(m[1] === '-' ? -v : v);
  return cls === floatType ? r : new PyBox(cls, r);
}, { owner: 'float' })));
prop(floatType, 'real', (a) => new PyFloat(fv(a)));
prop(floatType, 'imag', () => new PyFloat(0));
floatType.dict!.set('__doc__', 'Convert a string or number to a floating-point number, if possible.');

function floatHex(x: number): string {
  if (x !== x) return 'nan';
  if (!isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0x0.0p+0' : '0x0.0p+0';
  const { m, e } = decompose(Math.abs(x));
  let mant = m;
  let ex = e + 52;
  // normaliza: 1.xxxxx
  const bl = mant.toString(2).length;
  if (bl < 53) { mant <<= BigInt(53 - bl); ex -= 53 - bl; }
  const frac = (mant & ((1n << 52n) - 1n)).toString(16).padStart(13, '0').replace(/0+$/, '') || '0';
  return `${x < 0 ? '-' : ''}0x1.${frac}p${ex >= 0 ? '+' : ''}${ex}`;
}

function floatDivmod(a: number, b: any, rev: boolean): any {
  const y = numOf(b);
  if (y === undefined) return NotImplemented;
  const bb = y instanceof PyFloat ? y.v : intToFloat(y);
  const [p, q] = rev ? [bb, a] : [a, bb];
  if (q === 0) throw zeroDivision('float divmod()');
  return new PyTuple([new PyFloat(floatFloorDiv(p, q)), new PyFloat(floatMod(p, q))]);
}

// ───────────────────────── complex ─────────────────────────

function cx(x: any): PyComplex | undefined {
  if (x instanceof PyComplex) return x;
  if (x instanceof PyBox && x.value instanceof PyComplex) return x.value;
  const n = numOf(x);
  if (n === undefined) return undefined;
  return new PyComplex(n instanceof PyFloat ? n.v : intToFloat(n), 0);
}

function fmtCxPart(v: number): string {
  if (v !== v) return 'nan';
  if (!isFinite(v)) return v < 0 ? '-inf' : 'inf';
  const s = floatRepr(v);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function complexRepr(c: PyComplex): string {
  const reZero = c.re === 0 && !Object.is(c.re, -0);
  const imSign = c.im < 0 || Object.is(c.im, -0) ? '-' : '+';
  const imAbs = fmtCxPart(Math.abs(c.im));
  if (reZero) return `${fmtCxPart(c.im)}j`;
  const real = fmtCxPart(c.re);
  const imag = c.im !== c.im ? 'nan' : imAbs;
  return `(${real}${imSign}${imag}j)`;
}

function cdiv(a: PyComplex, b: PyComplex): PyComplex {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) throw zeroDivision('division by zero');
  return new PyComplex((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}

function cpow(a: PyComplex, b: PyComplex): PyComplex {
  if (b.re === 0 && b.im === 0) return new PyComplex(1, 0);
  if (a.re === 0 && a.im === 0) {
    if (b.im !== 0 || b.re < 0) throw zeroDivision('zero to a negative or complex power');
    return new PyComplex(0, 0);
  }
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 100) {
    let n = Math.abs(b.re);
    let r = new PyComplex(1, 0);
    let base = a;
    while (n > 0) {
      if (n & 1) r = new PyComplex(r.re * base.re - r.im * base.im, r.re * base.im + r.im * base.re);
      base = new PyComplex(base.re * base.re - base.im * base.im, 2 * base.re * base.im);
      n >>= 1;
    }
    return b.re < 0 ? cdiv(new PyComplex(1, 0), r) : r;
  }
  const vabs = Math.hypot(a.re, a.im);
  let len = Math.pow(vabs, b.re);
  const at = Math.atan2(a.im, a.re);
  let phase = at * b.re;
  if (b.im !== 0) {
    len /= Math.exp(at * b.im);
    phase += b.im * Math.log(vabs);
  }
  return new PyComplex(len * Math.cos(phase), len * Math.sin(phase));
}

complexType.dict!.set('__new__', mkNative('__new__', 'cls, real=, imag=', (cls: any, re?: any, im?: any) => {
  let a: PyComplex;
  if (re !== undefined && ops.isStr(re)) {
    if (im !== undefined) throw typeError("complex() can't take second arg if first is a string");
    const s = ops.strValue(re).replace(/\s+/g, '').replace(/^\((.*)\)$/, '$1');
    const m = /^([+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf|nan|infinity))?(?:([+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf|nan|infinity)?)[jJ])?$/i.exec(s);
    if (!m || s === '') throw valueError('complex() arg is a malformed string');
    const p = (t: string | undefined): number => (t === undefined || t === '' ? 0 : t === '+' ? 1 : t === '-' ? -1 : Number(t.toLowerCase().replace('infinity', 'Infinity').replace('inf', 'Infinity').replace('nan', 'NaN')));
    if (m[2] !== undefined && s.toLowerCase().endsWith('j')) a = new PyComplex(p(m[1]), p(m[2]) || (m[2] === '' || m[2] === '+' ? 1 : m[2] === '-' ? -1 : 0));
    else a = new PyComplex(p(m[1]), 0);
    if (m[1] !== undefined && m[2] === undefined && /j$/i.test(s)) a = new PyComplex(0, p(m[1]));
  } else {
    const r1 = re === undefined ? new PyComplex(0, 0) : cx(re);
    if (r1 === undefined) {
      const t = typeOf(re);
      const f = t.lookup('__complex__');
      if (f !== undefined) {
        const rr = callObj(f, [re]);
        if (!(rr instanceof PyComplex)) throw typeError(`__complex__ returned non-complex (type ${typeOf(rr).name})`);
        a = rr;
      } else throw typeError(`complex() first argument must be a string or a number, not '${t.name}'`);
    } else a = r1;
    if (im !== undefined) {
      const i2 = cx(im);
      if (i2 === undefined) throw typeError(`complex() second argument must be a number, not '${typeOf(im).name}'`);
      a = new PyComplex(a.re - i2.im, a.im + i2.re);
    }
  }
  return cls === complexType ? a : new PyBox(cls, a);
}, { owner: 'complex' }));

function cArith(name: string, f: (a: PyComplex, b: PyComplex) => PyComplex): void {
  complexType.dict!.set(`__${name}__`, mkNative(`__${name}__`, 'self, other', (a: any, b: any) => {
    const x = cx(a);
    const y = cx(b);
    if (!x || !y) return NotImplemented;
    return f(x, y);
  }, { method: true, owner: 'complex' }));
  complexType.dict!.set(`__r${name}__`, mkNative(`__r${name}__`, 'self, other', (a: any, b: any) => {
    const x = cx(a);
    const y = cx(b);
    if (!x || !y) return NotImplemented;
    return f(y, x);
  }, { method: true, owner: 'complex' }));
}
cArith('add', (a, b) => new PyComplex(a.re + b.re, a.im + b.im));
cArith('sub', (a, b) => new PyComplex(a.re - b.re, a.im - b.im));
cArith('mul', (a, b) => new PyComplex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re));
cArith('truediv', cdiv);
cArith('pow', cpow);
defMethods(complexType, {
  __repr__: ['self', (a: any) => complexRepr(cx(a)!)],
  __str__: ['self', (a: any) => complexRepr(cx(a)!)],
  __neg__: ['self', (a: any) => { const c = cx(a)!; return new PyComplex(-c.re, -c.im); }],
  __pos__: ['self', (a: any) => cx(a)!],
  __abs__: ['self', (a: any) => { const c = cx(a)!; return new PyFloat(Math.hypot(c.re, c.im)); }],
  __bool__: ['self', (a: any) => { const c = cx(a)!; return c.re !== 0 || c.im !== 0; }],
  __eq__: ['self, other', (a: any, b: any) => {
    const x = cx(a);
    const y = cx(b);
    if (!x || !y) return NotImplemented;
    return x.re === y.re && x.im === y.im;
  }],
  __hash__: ['self', (a: any) => { const c = cx(a)!; return (hashFloat(c.re) + 1000003 * hashFloat(c.im)) % 2305843009213693951; }],
  conjugate: ['self', (a: any) => { const c = cx(a)!; return new PyComplex(c.re, -c.im); }],
  __format__: ['self, spec', (a: any, spec: any) => {
    const s = asStr(spec, 'format_spec');
    const c = cx(a)!;
    if (s === '') return complexRepr(c);
    const re = formatFloat(c.re, s);
    const im = formatFloat(Math.abs(c.im), s);
    return `${re}${c.im < 0 || Object.is(c.im, -0) ? '-' : '+'}${im}j`;
  }],
  __complex__: ['self', (a: any) => cx(a)!],
  __getnewargs__: ['self', (a: any) => { const c = cx(a)!; return new PyTuple([new PyFloat(c.re), new PyFloat(c.im)]); }],
});
prop(complexType, 'real', (a) => new PyFloat(cx(a)!.re));
prop(complexType, 'imag', (a) => new PyFloat(cx(a)!.im));
void [expStr, intFloorDiv, intMod, isIntLike, defGetter, PyObject, F_BASETYPE, byteArrayType];
export type { Kw, PyType };
export { floatToInt, toFloatValue, parseIntText, complexRepr };
