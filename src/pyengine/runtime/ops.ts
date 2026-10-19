/**
 * Protocolos básicos del modelo de objetos: atributos, llamadas, operadores, comparaciones, iteración,
 * contenedores, repr/str/hash. Los métodos de los tipos nativos viven en los módulos `t_*.ts`.
 */
import type { BinOpName } from '../ast';
import {
  BoundMethod, F_BUILTIN, NativeFunction, PyBaseException, PyBox, PyByteArray, PyBytes, PyClassMethod, PyComplex, PyDict, PyFloat, PyFunction,
  PyGenerator, PyList, PyModule, PyObject, PyProperty, PyRange, PySet, PySlice, PyStaticMethod, PySuper, PyTuple, PyType,
  PyIter, type Kw,
} from './objects';
import {
  NotImplemented, boolType, boundMethodType, classMethodType, dictType, floatType, functionType, intType, listType, moduleType,
  noneType, objectType, propertyType, staticMethodType, strType, superType, tupleType, typeOf, typeType, Ellipsis, setType, frozenSetType,
  bytesType, byteArrayType, rangeType, sliceType, complexType, listIterType, tupleIterType, strIterType, rangeIterType, dictKeyIterType,
  dictValueIterType, dictItemIterType, setIterType, bytesIterType,
} from './builtin_types';
import { E } from './exc_types';
import {
  attributeError, indexError, keyError, makeExc, overflowError, stopIteration, typeError, valueError, zeroDivision,
} from './errors';
import { callObj, callFunction } from './call';
import { interp } from './state';
import {
  MAXS, cmpIntFloat, floatFloorDiv, floatMod, floatPow, hashFloat, hashInt, intAdd, intAnd, intCmp, intDivmod, intFloorDiv, intInvert,
  intLshift, intMod, intMul, intNeg, intOr, intPow, intRshift, intSub, intToFloat, intTrueDiv, intXor, normBig, toBig, type PyInt,
} from './numeric';
import { bytesRepr, floatRepr, strRepr, asciiOf, formatFloat, formatInt, formatStr } from './fmt';
import { cmpStr, strAt, strHash, strLen, strSlice, chars, hasAstral } from './pystr';

export { typeOf, callObj };
export { NotImplemented };

// ───────────────────────── utilidades de tipo ─────────────────────────

export function typeNameOf(x: any): string {
  return typeOf(x).name;
}

export function isInt(x: any): boolean {
  return typeof x === 'number' || typeof x === 'bigint' || typeof x === 'boolean';
}

/** ¿es un objeto "str" (incluye subclases)? */
export function isStr(x: any): boolean {
  return typeof x === 'string' || (x instanceof PyBox && typeof x.value === 'string');
}
export function strValue(x: any): string {
  return typeof x === 'string' ? x : x.value;
}

/** Valor primitivo de un int/bool/subclase (o undefined si no es entero) */
export function intValue(x: any): PyInt | undefined {
  if (typeof x === 'number' || typeof x === 'bigint') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (x instanceof PyBox) {
    const v = x.value;
    if (typeof v === 'number' || typeof v === 'bigint') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
  }
  return undefined;
}
export function floatValue(x: any): number | undefined {
  if (x instanceof PyFloat) return x.v;
  if (x instanceof PyBox && x.value instanceof PyFloat) return x.value.v;
  return undefined;
}

export function isInstance(x: any, t: PyType): boolean {
  return typeOf(x).isSubtype(t);
}

export function isCallable(x: any): boolean {
  if (x instanceof PyFunction || x instanceof NativeFunction || x instanceof BoundMethod || x instanceof PyType) return true;
  return typeOf(x).lookup('__call__') !== undefined;
}

// ───────────────────────── llamadas ─────────────────────────

export function callMethod(o: any, name: string, args: any[], kw: Kw | null = null): any {
  const f = getAttr(o, name);
  return callObj(f, args, kw);
}

/** Llama al método especial `name` buscado en el tipo de `o` (no en la instancia). */
export function callSpecial(o: any, name: string, args: any[] = []): any {
  const t = typeOf(o);
  const f = t.lookup(name);
  if (f === undefined) throw typeError(`'${t.name}' object has no attribute '${name}'`);
  args.unshift(o);
  return callObj(f, args);
}

export function lookupSpecial(o: any, name: string): any {
  return typeOf(o).lookup(name);
}

/** instancia nueva de `t` según su disposición nativa */
export function newObject(t: PyType): any {
  if (t.alloc !== null) return t.alloc(t);
  return new PyObject(t);
}

export function typeCall(t: PyType, args: any[], kw: Kw | null): any {
  const meta = t.cls;
  if (meta !== typeType) {
    const mc = meta.lookup('__call__');
    if (mc !== undefined && mc !== TYPE_CALL.f) {
      args.unshift(t);
      return callObj(mc, args, kw);
    }
  }
  if (t === typeType && args.length === 1 && kw === null) return typeOf(args[0]);
  const newf = t.lookup('__new__');
  let obj: any;
  if (newf === OBJECT_NEW.f) {
    if ((args.length > 0 || kw !== null && kw.size > 0)) {
      if (t.lookup('__init__') === OBJECT_INIT.f) throw typeError(`${t.name}() takes no arguments`);
    }
    const am = t.dict!.m.get('__abstractmethods__');
    if (am !== undefined && am.v instanceof PySet && am.v.size > 0) throw abstractError(t, am.v);
    obj = t.alloc !== null ? t.alloc(t) : new PyObject(t);
  } else {
    args.unshift(t);
    // staticmethod __new__: la función ya está sin enlazar
    const nf = newf instanceof PyStaticMethod ? newf.fn : newf;
    const copy = args.slice(1);
    obj = callObj(nf, args, kw);
    args = copy;
  }
  const ot = typeOf(obj);
  if (ot.isSubtype(t)) {
    const initf = ot.lookup('__init__');
    if (initf !== undefined && initf !== OBJECT_INIT.f) {
      args.unshift(obj);
      const r = callObj(initf, args, kw);
      if (r !== null) throw typeError(`__init__() should return None, not '${typeOf(r).name}'`);
    } else if (initf === OBJECT_INIT.f && newf !== OBJECT_NEW.f && (args.length > 0 || (kw !== null && kw.size > 0))) {
      // new personalizado, init de object: se ignoran los argumentos
    }
  }
  return obj;
}

function abstractError(t: PyType, am: PySet): PyBaseException {
  const names = am.items().map((x) => String(x)).sort();
  const q = names.map((n) => `'${n}'`);
  const word = names.length === 1 ? 'method' : 'methods';
  let list: string;
  if (q.length === 1) list = q[0];
  else if (q.length === 2) list = `${q[0]} and ${q[1]}`;
  else list = q.slice(0, -1).join(', ') + ', and ' + q[q.length - 1];
  return typeError(`Can't instantiate abstract class ${t.name} without an implementation for abstract ${word} ${list}`);
}

export const TYPE_CALL: { f: any } = { f: undefined };
export const OBJECT_NEW: { f: any } = { f: undefined };
export const OBJECT_INIT: { f: any } = { f: undefined };

// ───────────────────────── atributos ─────────────────────────

function isDataDescr(d: any): boolean {
  if (d instanceof PyProperty) return true;
  if (d instanceof PyFunction || d instanceof NativeFunction || d instanceof PyClassMethod || d instanceof PyStaticMethod || d instanceof BoundMethod) return false;
  if (!(d instanceof PyObject)) return false;
  const t = d.cls;
  return t.lookup('__set__') !== undefined || t.lookup('__delete__') !== undefined;
}

/** protocolo de descriptor `__get__` */
export function descrGet(d: any, obj: any, t: PyType): any {
  if (d instanceof PyFunction) return obj === undefined ? d : new BoundMethod(boundMethodType, d, obj);
  if (d instanceof NativeFunction) {
    if (d.isMethod && obj !== undefined) return new BoundMethod(boundMethodType, d, obj);
    return d;
  }
  if (d instanceof PyProperty) {
    if (obj === undefined) return d;
    if (d.fget === null) throw attributeError(`property ${d.doc !== null && false ? '' : ''}of '${typeOf(obj).name}' object has no getter`);
    return callObj(d.fget, [obj]);
  }
  if (d instanceof PyClassMethod) {
    const target = t;
    const fn = d.fn;
    if (fn instanceof PyObject && !(fn instanceof PyFunction) && !(fn instanceof NativeFunction)) {
      const g = typeOf(fn).lookup('__get__');
      if (g !== undefined) return callObj(g, [fn, target, typeOf(target)]);
    }
    return new BoundMethod(boundMethodType, fn, target);
  }
  if (d instanceof PyStaticMethod) return d.fn;
  if (d instanceof PyObject) {
    const g = d.cls.lookup('__get__');
    if (g !== undefined) return callObj(g, [d, obj === undefined ? null : obj, t]);
  }
  return d;
}

export function getAttrOpt(o: any, name: string): any {
  const t = typeOf(o);
  if (t.getattro !== null) return t.getattro(o, name);
  // 1. descriptor de datos en el tipo
  const d = t.lookup(name);
  if (d !== undefined && isDataDescr(d)) return descrGet(d, o, t);
  // 2. diccionario de la instancia
  if (o instanceof PyObject) {
    const dict = o.dict;
    if (dict !== null) {
      const e = dict.m.get(name);
      if (e !== undefined) return e.v;
    }
  }
  if (d !== undefined) return descrGet(d, o, t);
  return undefined;
}

export function attrError(o: any, name: string): PyBaseException {
  const t = typeOf(o);
  let msg: string;
  if (o instanceof PyType) msg = `type object '${o.name}' has no attribute '${name}'`;
  else if (o instanceof PyModule) msg = `module '${o.name}' has no attribute '${name}'`;
  else msg = `'${t.name}' object has no attribute '${name}'`;
  return attributeError(msg, name, o);
}

export function getAttr(o: any, name: string): any {
  const t = typeOf(o);
  if (t.special.getattribute) {
    const ga = t.lookup('__getattribute__');
    try {
      return callObj(ga, [o, name]);
    } catch (e) {
      if (e instanceof PyBaseException && isInstance(e, E.AttributeError) && t.special.getattr) {
        return callObj(t.lookup('__getattr__'), [o, name]);
      }
      throw e;
    }
  }
  const v = getAttrOpt(o, name);
  if (v !== undefined) return v;
  if (t.special.getattr) return callObj(t.lookup('__getattr__'), [o, name]);
  throw attrError(o, name);
}

export function hasAttr(o: any, name: string): boolean {
  try {
    getAttr(o, name);
    return true;
  } catch (e) {
    if (e instanceof PyBaseException && isInstance(e, E.AttributeError)) return false;
    throw e;
  }
}

export function setAttr(o: any, name: string, v: any): void {
  const t = typeOf(o);
  if (t.special.setattr) {
    callObj(t.lookup('__setattr__'), [o, name, v]);
    return;
  }
  genericSetAttr(o, name, v);
}

export function genericSetAttr(o: any, name: string, v: any): void {
  const t = typeOf(o);
  if (t.setattro !== null) { t.setattro(o, name, v); return; }
  const d = t.lookup(name);
  if (d !== undefined) {
    if (d instanceof PyProperty) {
      if (d.fset === null) throw attributeError(`property '${d.name ?? name}' of '${t.name}' object has no setter`, name, o);
      callObj(d.fset, [o, v]);
      return;
    }
    if (d instanceof PyObject && !(d instanceof PyFunction) && !(d instanceof NativeFunction)) {
      const s = d.cls.lookup('__set__');
      if (s !== undefined) { callObj(s, [d, o, v]); return; }
    }
  }
  if (o instanceof PyObject && t.instDict) {
    if (t.slots !== null && !t.slots.has(name) && !(t.slots.has('__dict__'))) {
      throw attributeError(`'${t.name}' object has no attribute '${name}'`, name, o);
    }
    if (o.dict === null) o.dict = new PyDict();
    o.dict.set(name, v);
    return;
  }
  if (o instanceof PyObject && t.slots !== null && t.slots.has(name)) {
    if (o.dict === null) o.dict = new PyDict();
    o.dict.set(name, v);
    return;
  }
  if (d === undefined || !(o instanceof PyObject)) {
    throw attributeError(`'${t.name}' object has no attribute '${name}' and no __dict__ for setting new attributes`, name, o);
  }
  throw attributeError(`'${t.name}' object attribute '${name}' is read-only`, name, o);
}

export function delAttr(o: any, name: string): void {
  const t = typeOf(o);
  if (t.special.delattr) {
    callObj(t.lookup('__delattr__'), [o, name]);
    return;
  }
  genericDelAttr(o, name);
}

export function genericDelAttr(o: any, name: string): void {
  const t = typeOf(o);
  if (t.delattro !== null) { t.delattro(o, name); return; }
  const d = t.lookup(name);
  if (d !== undefined) {
    if (d instanceof PyProperty) {
      if (d.fdel === null) throw attributeError(`property '${d.name ?? name}' of '${t.name}' object has no deleter`, name, o);
      callObj(d.fdel, [o]);
      return;
    }
    if (d instanceof PyObject && !(d instanceof PyFunction) && !(d instanceof NativeFunction)) {
      const s = d.cls.lookup('__delete__');
      if (s !== undefined) { callObj(s, [d, o]); return; }
    }
  }
  if (o instanceof PyObject && o.dict !== null && o.dict.delete(name)) return;
  throw attrError(o, name);
}

// ───────────────────────── verdad ─────────────────────────

export function truthy(x: any): boolean {
  switch (typeof x) {
    case 'boolean': return x;
    case 'number': return x !== 0;
    case 'string': return x.length !== 0;
    case 'bigint': return x !== 0n;
    case 'object': break;
    default: return false;
  }
  if (x === null) return false;
  if (x instanceof PyFloat) return x.v !== 0;
  const t = x.cls;
  if (x instanceof PyList) { if (t === listType) return x.a.length > 0; }
  else if (x instanceof PyTuple) { if (t === tupleType) return x.a.length > 0; }
  else if (x instanceof PyDict) { if (t === dictType) return x.m.size > 0; }
  const b = t.lookup('__bool__');
  if (b !== undefined) {
    const r = callObj(b, [x]);
    if (typeof r !== 'boolean') throw typeError(`__bool__ should return bool, returned ${typeOf(r).name}`);
    return r;
  }
  const l = t.lookup('__len__');
  if (l !== undefined) {
    const r = callObj(l, [x]);
    const n = intValue(r);
    if (n === undefined) throw typeError(`'${typeOf(r).name}' object cannot be interpreted as an integer`);
    if (intCmp(n, 0) < 0) throw valueError('__len__() should return >= 0');
    return intCmp(n, 0) !== 0;
  }
  return true;
}

// ───────────────────────── comparaciones ─────────────────────────

const CMP_NAME: Record<string, string> = { '==': '__eq__', '!=': '__ne__', '<': '__lt__', '<=': '__le__', '>': '__gt__', '>=': '__ge__' };
const CMP_REFL: Record<string, string> = { '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

export function eqOp(a: any, b: any): boolean {
  const r = richCompare('==', a, b);
  return r === true || (r !== false && truthy(r));
}
/** igualdad de contenedores: identidad o == */
export function eqId(a: any, b: any): boolean {
  if (a === b) return true;
  return eqOp(a, b);
}

function cmpNumbers(op: string, c: number): boolean {
  switch (op) {
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '==': return c === 0;
    default: return c !== 0;
  }
}

/** comparación entre valores numéricos nativos (int/bool/float); undefined si alguno no lo es */
function numCompare(op: string, a: any, b: any): boolean | undefined {
  const ia = typeof a === 'boolean' ? (a ? 1 : 0) : typeof a === 'number' || typeof a === 'bigint' ? a : undefined;
  const ib = typeof b === 'boolean' ? (b ? 1 : 0) : typeof b === 'number' || typeof b === 'bigint' ? b : undefined;
  const fa = a instanceof PyFloat ? a.v : undefined;
  const fb = b instanceof PyFloat ? b.v : undefined;
  let c: number;
  if (ia !== undefined && ib !== undefined) c = intCmp(ia, ib);
  else if (fa !== undefined && fb !== undefined) {
    if (fa !== fa || fb !== fb) return op === '!=';
    c = fa < fb ? -1 : fa > fb ? 1 : 0;
  } else if (ia !== undefined && fb !== undefined) {
    c = cmpIntFloat(ia, fb);
    if (c !== c) return op === '!=';
  } else if (fa !== undefined && ib !== undefined) {
    c = cmpIntFloat(ib, fa);
    if (c !== c) return op === '!=';
    c = -c;
  } else return undefined;
  return cmpNumbers(op, c);
}

export function richCompare(op: string, a: any, b: any): any {
  const ta = typeof a;
  // caminos rápidos
  if (ta === 'number' && typeof b === 'number') {
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      default: return a >= b;
    }
  }
  if (ta === 'string' && typeof b === 'string') {
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      default: return cmpNumbers(op, cmpStr(a, b));
    }
  }
  const n = numCompare(op, a, b);
  if (n !== undefined) return n;
  if (a === null || b === null) {
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
  }
  return richCompareSlow(op, a, b);
}

function richCompareSlow(op: string, a: any, b: any): any {
  const ta = typeOf(a);
  const tb = typeOf(b);
  const name = CMP_NAME[op];
  const rname = CMP_NAME[CMP_REFL[op]];
  let r: any;
  let tried = false;
  if (tb !== ta && tb.isSubtype(ta)) {
    const g = tb.lookup(rname);
    if (g !== undefined && g !== ta.lookup(rname)) {
      r = callObj(g, [b, a]);
      if (r !== NotImplemented) return r;
      tried = true;
    }
  }
  const f = ta.lookup(name);
  if (f !== undefined) {
    r = callObj(f, [a, b]);
    if (r !== NotImplemented) return r;
  }
  if (!tried && (tb !== ta || f === undefined)) {
    const g = tb.lookup(rname);
    if (g !== undefined) {
      r = callObj(g, [b, a]);
      if (r !== NotImplemented) return r;
    }
  }
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  throw typeError(`'${op}' not supported between instances of '${ta.name}' and '${tb.name}'`);
}

export function lt(a: any, b: any): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  const r = richCompare('<', a, b);
  return r === true || (r !== false && truthy(r));
}

export function cmpBool(op: string, a: any, b: any): boolean {
  const r = richCompare(op, a, b);
  return r === true || (r !== false && truthy(r));
}

// ───────────────────────── aritmética ─────────────────────────

const BIN_NAMES: Record<string, [string, string, string]> = {
  '+': ['__add__', '__radd__', '__iadd__'],
  '-': ['__sub__', '__rsub__', '__isub__'],
  '*': ['__mul__', '__rmul__', '__imul__'],
  '/': ['__truediv__', '__rtruediv__', '__itruediv__'],
  '//': ['__floordiv__', '__rfloordiv__', '__ifloordiv__'],
  '%': ['__mod__', '__rmod__', '__imod__'],
  '**': ['__pow__', '__rpow__', '__ipow__'],
  '@': ['__matmul__', '__rmatmul__', '__imatmul__'],
  '&': ['__and__', '__rand__', '__iand__'],
  '|': ['__or__', '__ror__', '__ior__'],
  '^': ['__xor__', '__rxor__', '__ixor__'],
  '<<': ['__lshift__', '__rlshift__', '__ilshift__'],
  '>>': ['__rshift__', '__rrshift__', '__irshift__'],
};

export function binopNames(op: string): [string, string, string] {
  return BIN_NAMES[op];
}

type Num = number | bigint | PyFloat;

function asNum(x: any): Num | undefined {
  switch (typeof x) {
    case 'number': case 'bigint': return x;
    case 'boolean': return x ? 1 : 0;
    case 'object':
      if (x instanceof PyFloat) return x;
      if (x instanceof PyBox) {
        const v = x.value;
        if (typeof v === 'number' || typeof v === 'bigint') return v;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (v instanceof PyFloat) return v;
      }
      return undefined;
    default: return undefined;
  }
}

/** Aritmética entre int/bool/float nativos. Devuelve undefined si algún operando no es numérico. */
export function numericBinop(op: string, a: any, b: any): any {
  const x = asNum(a);
  if (x === undefined) return undefined;
  const y = asNum(b);
  if (y === undefined) return undefined;
  const xf = x instanceof PyFloat;
  const yf = y instanceof PyFloat;
  if (!xf && !yf) {
    const p = x as PyInt;
    const q = y as PyInt;
    switch (op) {
      case '+': return intAdd(p, q);
      case '-': return intSub(p, q);
      case '*': return intMul(p, q);
      case '/': return new PyFloat(intTrueDiv(p, q));
      case '//': return intFloorDiv(p, q);
      case '%': return intMod(p, q);
      case '**': return intPow(p, q);
      case '&': return intAnd(p, q);
      case '|': return intOr(p, q);
      case '^': return intXor(p, q);
      case '<<': return intLshift(p, q);
      case '>>': return intRshift(p, q);
      default: return undefined;
    }
  }
  // al menos un float
  let u: number;
  let v: number;
  if (xf) u = (x as PyFloat).v; else u = intToFloat(x as PyInt);
  if (yf) v = (y as PyFloat).v; else v = intToFloat(y as PyInt);
  switch (op) {
    case '+': return new PyFloat(u + v);
    case '-': return new PyFloat(u - v);
    case '*': return new PyFloat(u * v);
    case '/':
      if (v === 0) throw zeroDivision('float division by zero');
      return new PyFloat(u / v);
    case '//': return new PyFloat(floatFloorDiv(u, v));
    case '%': return new PyFloat(floatMod(u, v));
    case '**': {
      if (u < 0 && isFinite(u) && isFinite(v) && !Number.isInteger(v)) {
        // resultado complejo
        return complexPow(u, v);
      }
      return new PyFloat(floatPow(u, v));
    }
    default: return undefined;
  }
}

function complexPow(base: number, exp: number): PyComplex {
  const r = Math.pow(-base, exp);
  const ang = Math.PI * exp;
  return new PyComplex(r * Math.cos(ang), r * Math.sin(ang));
}

function binopError(op: string, a: any, b: any): PyBaseException {
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (op === '+' && (a instanceof PyList || typeof a === 'string' || a instanceof PyTuple || a instanceof PyBytes || a instanceof PyByteArray) && !(b instanceof PyObject && b.cls.lookup('__radd__'))) {
    if (a instanceof PyBytes || a instanceof PyByteArray) return typeError(`can't concat ${tb.name} to ${ta.name}`);
    return typeError(`can only concatenate ${ta.name} (not "${tb.name}") to ${ta.name}`);
  }
  if (op === '*') {
    const seqA = typeof a === 'string' || a instanceof PyList || a instanceof PyTuple || a instanceof PyBytes || a instanceof PyByteArray;
    const seqB = typeof b === 'string' || b instanceof PyList || b instanceof PyTuple || b instanceof PyBytes || b instanceof PyByteArray;
    if (seqA && !isIndexLike(b)) return typeError(`can't multiply sequence by non-int of type '${tb.name}'`);
    if (seqB && !isIndexLike(a)) return typeError(`can't multiply sequence by non-int of type '${ta.name}'`);
  }
  const shown = op === '**' ? '** or pow()' : op;
  return typeError(`unsupported operand type(s) for ${shown}: '${ta.name}' and '${tb.name}'`);
}

function isIndexLike(x: any): boolean {
  return intValue(x) !== undefined || typeOf(x).lookup('__index__') !== undefined;
}

export function binopSlow(op: string, a: any, b: any): any {
  const nr = numericBinop(op, a, b);
  if (nr !== undefined) {
    // ¿hay sobrescritura en subclase? (PyBox con __add__ propio)
    if (!(a instanceof PyBox) && !(b instanceof PyBox)) return nr;
  }
  const ta = typeOf(a);
  const tb = typeOf(b);
  const [name, rname] = BIN_NAMES[op];
  let r: any;
  let triedRefl = false;
  if (tb !== ta && tb.isSubtype(ta)) {
    const g = tb.lookup(rname);
    if (g !== undefined && g !== ta.lookup(rname)) {
      r = callObj(g, [b, a]);
      if (r !== NotImplemented) return r;
      triedRefl = true;
    }
  }
  const f = ta.lookup(name);
  if (f !== undefined) {
    r = callObj(f, [a, b]);
    if (r !== NotImplemented) return r;
  }
  if (!triedRefl && tb !== ta) {
    const g = tb.lookup(rname);
    if (g !== undefined) {
      r = callObj(g, [b, a]);
      if (r !== NotImplemented) return r;
    }
  }
  throw binopError(op, a, b);
}

export function opAdd(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a + b;
    if (r <= MAXS && r >= -MAXS) return r;
    return normBig(BigInt(a) + BigInt(b));
  }
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (a instanceof PyFloat) {
    if (b instanceof PyFloat) return new PyFloat(a.v + b.v);
    if (typeof b === 'number') return new PyFloat(a.v + b);
  } else if (b instanceof PyFloat && typeof a === 'number') return new PyFloat(a + b.v);
  return binopSlow('+', a, b);
}
export function opSub(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a - b;
    if (r <= MAXS && r >= -MAXS) return r;
    return normBig(BigInt(a) - BigInt(b));
  }
  if (a instanceof PyFloat) {
    if (b instanceof PyFloat) return new PyFloat(a.v - b.v);
    if (typeof b === 'number') return new PyFloat(a.v - b);
  } else if (b instanceof PyFloat && typeof a === 'number') return new PyFloat(a - b.v);
  return binopSlow('-', a, b);
}
export function opMul(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    const r = a * b;
    if (r <= MAXS && r >= -MAXS) return r === 0 ? 0 : r;
    return normBig(BigInt(a) * BigInt(b));
  }
  if (a instanceof PyFloat) {
    if (b instanceof PyFloat) return new PyFloat(a.v * b.v);
    if (typeof b === 'number') return new PyFloat(a.v * b);
  } else if (b instanceof PyFloat && typeof a === 'number') return new PyFloat(a * b.v);
  return binopSlow('*', a, b);
}
export function opDiv(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') {
    if (b === 0) throw zeroDivision('division by zero');
    return new PyFloat(a / b);
  }
  if (a instanceof PyFloat && b instanceof PyFloat) {
    if (b.v === 0) throw zeroDivision('float division by zero');
    return new PyFloat(a.v / b.v);
  }
  return binopSlow('/', a, b);
}
export function opFloorDiv(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number' && b !== 0 && a <= 4503599627370496 && a >= -4503599627370496) {
    const q = Math.floor(a / b);
    return q === 0 ? 0 : q;
  }
  return binopSlow('//', a, b);
}
export function opMod(a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number' && b !== 0) {
    let r = a % b;
    if (r !== 0 && (r < 0) !== (b < 0)) r += b;
    return r === 0 ? 0 : r;
  }
  if (typeof a === 'string') return strPercent(a, b);
  return binopSlow('%', a, b);
}

let strPercentImpl: ((s: string, args: any) => string) | null = null;
export function setStrPercent(f: (s: string, args: any) => string): void {
  strPercentImpl = f;
}
function strPercent(a: string, b: any): any {
  return strPercentImpl!(a, b);
}

export const BINOPS: Record<BinOpName, (a: any, b: any) => any> = {
  '+': opAdd,
  '-': opSub,
  '*': opMul,
  '/': opDiv,
  '//': opFloorDiv,
  '%': opMod,
  '**': (a, b) => binopSlow('**', a, b),
  '@': (a, b) => binopSlow('@', a, b),
  '&': (a, b) => (typeof a === 'number' && typeof b === 'number' ? intAnd(a, b) : binopSlow('&', a, b)),
  '|': (a, b) => (typeof a === 'number' && typeof b === 'number' ? intOr(a, b) : binopSlow('|', a, b)),
  '^': (a, b) => (typeof a === 'number' && typeof b === 'number' ? intXor(a, b) : binopSlow('^', a, b)),
  '<<': (a, b) => binopSlow('<<', a, b),
  '>>': (a, b) => binopSlow('>>', a, b),
};

/** operadores in situ (`+=` …): prueba `__iadd__` antes del operador normal */
export function inplaceop(op: BinOpName, a: any, b: any): any {
  if (typeof a === 'number' && typeof b === 'number') return BINOPS[op](a, b);
  if (typeof a === 'string' && typeof b === 'string' && op === '+') return a + b;
  if (a instanceof PyObject && !(a instanceof PyBox)) {
    const f = a.cls.lookup(BIN_NAMES[op][2]);
    if (f !== undefined) {
      const r = callObj(f, [a, b]);
      if (r !== NotImplemented) return r;
    }
  }
  return BINOPS[op](a, b);
}

export function unaryNeg(a: any): any {
  if (typeof a === 'number') return a === 0 ? 0 : -a;
  if (a instanceof PyFloat) return new PyFloat(-a.v);
  if (typeof a === 'bigint') return intNeg(a);
  if (typeof a === 'boolean') return a ? -1 : 0;
  return unarySlow('-', '__neg__', a);
}
export function unaryPos(a: any): any {
  if (typeof a === 'number' || typeof a === 'bigint' || a instanceof PyFloat) return a;
  if (typeof a === 'boolean') return a ? 1 : 0;
  return unarySlow('+', '__pos__', a);
}
export function unaryInvert(a: any): any {
  if (typeof a === 'number' || typeof a === 'bigint') return intInvert(a);
  if (typeof a === 'boolean') return a ? -2 : -1;
  return unarySlow('~', '__invert__', a);
}
function unarySlow(sym: string, name: string, a: any): any {
  const t = typeOf(a);
  const f = t.lookup(name);
  if (f === undefined) throw typeError(`bad operand type for unary ${sym}: '${t.name}'`);
  return callObj(f, [a]);
}

// ───────────────────────── enteros ─────────────────────────

/** Conversión `__index__` */
export function toIndex(x: any, what?: string): PyInt {
  const v = intValue(x);
  if (v !== undefined) return v;
  const t = typeOf(x);
  const f = t.lookup('__index__');
  if (f !== undefined) {
    const r = callObj(f, [x]);
    const rv = intValue(r);
    if (rv === undefined) throw typeError(`__index__ returned non-int (type ${typeOf(r).name})`);
    return rv;
  }
  throw typeError(what ?? `'${t.name}' object cannot be interpreted as an integer`);
}

/** índice entero acotado a number (para índices de secuencia) */
export function toIndexNum(x: any, errMsg?: string): number {
  const v = toIndex(x, errMsg);
  if (typeof v === 'bigint') {
    // fuera de rango: se satura
    return v < 0n ? -Infinity : Infinity;
  }
  return v;
}

// ───────────────────────── hash ─────────────────────────

const NONE_HASH = 0xfca86420;
export function hashOf(x: any): number {
  switch (typeof x) {
    case 'string': return strHash(x);
    case 'number': return x >= 0 && x < 2305843009213693951 ? x : hashInt(x);
    case 'bigint': return hashInt(x);
    case 'boolean': return x ? 1 : 0;
    case 'object': break;
    default: throw new Error('hash de valor interno');
  }
  if (x === null) return NONE_HASH;
  if (x instanceof PyFloat) return hashFloat(x.v);
  const t = x.cls;
  const h = t.lookup('__hash__');
  if (h === undefined || h === null) throw typeError(`unhashable type: '${t.name}'`);
  const r = callObj(h, [x]);
  const rv = intValue(r);
  if (rv === undefined) throw typeError('__hash__ method should return an integer');
  const n = typeof rv === 'bigint' ? hashInt(rv) : rv;
  return n === -1 ? -2 : n;
}

// ───────────────────────── repr / str ─────────────────────────

export function repr(x: any): string {
  switch (typeof x) {
    case 'string': return strRepr(x);
    case 'number': return String(x);
    case 'bigint': return x.toString();
    case 'boolean': return x ? 'True' : 'False';
    case 'object': break;
    default: return String(x);
  }
  if (x === null) return 'None';
  if (x instanceof PyFloat) return floatRepr(x.v);
  const t = x.cls;
  const f = t.lookup('__repr__');
  if (f === undefined) return `<${t.name} object>`;
  const r = callObj(f, [x]);
  if (typeof r === 'string') return r;
  if (r instanceof PyBox && typeof r.value === 'string') return r.value;
  throw typeError(`__repr__ returned non-string (type ${typeOf(r).name})`);
}

export function str(x: any): string {
  switch (typeof x) {
    case 'string': return x;
    case 'number': return String(x);
    case 'bigint': return x.toString();
    case 'boolean': return x ? 'True' : 'False';
    case 'object': break;
    default: return String(x);
  }
  if (x === null) return 'None';
  if (x instanceof PyFloat) return floatRepr(x.v);
  const t = x.cls;
  const f = t.lookup('__str__');
  if (f === undefined || f === OBJECT_STR.f) return repr(x);
  const r = callObj(f, [x]);
  if (typeof r === 'string') return r;
  if (r instanceof PyBox && typeof r.value === 'string') return r.value;
  throw typeError(`__str__ returned non-string (type ${typeOf(r).name})`);
}
export const OBJECT_STR: { f: any } = { f: undefined };

export function ascii(x: any): string {
  return asciiOf(repr(x));
}

// ───────────────────────── format ─────────────────────────

export function formatValue(x: any, spec: string): string {
  if (typeof x === 'string') return formatStr(x, spec);
  if (typeof x === 'number' || typeof x === 'bigint') return spec === '' ? String(x) : formatInt(x, spec);
  if (x instanceof PyFloat) return spec === '' ? floatRepr(x.v) : formatFloat(x.v, spec);
  if (typeof x === 'boolean') return spec === '' ? (x ? 'True' : 'False') : formatInt(x ? 1 : 0, spec, 'bool');
  const t = typeOf(x);
  const f = t.lookup('__format__');
  if (f === undefined) return spec === '' ? str(x) : (() => { throw typeError(`unsupported format string passed to ${t.name}.__format__`); })();
  const r = callObj(f, [x, spec]);
  if (typeof r !== 'string') {
    if (r instanceof PyBox && typeof r.value === 'string') return r.value;
    throw typeError(`__format__ must return a str, not ${typeOf(r).name}`);
  }
  return r;
}

// ───────────────────────── longitud / índices ─────────────────────────

export function lenOf(x: any): number {
  if (typeof x === 'string') return strLen(x);
  if (x instanceof PyList) { if (x.cls === listType) return x.a.length; }
  else if (x instanceof PyTuple) { if (x.cls === tupleType) return x.a.length; }
  else if (x instanceof PyDict) { if (x.cls === dictType) return x.m.size; }
  const t = typeOf(x);
  const f = t.lookup('__len__');
  if (f === undefined) throw typeError(`object of type '${t.name}' has no len()`);
  const r = callObj(f, [x]);
  const n = intValue(r);
  if (n === undefined) throw typeError(`'${typeOf(r).name}' object cannot be interpreted as an integer`);
  if (intCmp(n, 0) < 0) throw valueError('__len__() should return >= 0');
  if (typeof n === 'bigint') throw overflowError("cannot fit 'int' into an index-sized integer");
  return n;
}

/** índices normalizados de un slice sobre una secuencia de longitud n */
export function sliceIndices(s: PySlice, n: number): [number, number, number] {
  let step = 1;
  if (s.step !== null) {
    const st = toIndex(s.step, 'slice indices must be integers or None or have an __index__ method');
    if (intCmp(st, 0) === 0) throw valueError('slice step cannot be zero');
    step = typeof st === 'bigint' ? (st < 0n ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER) : st;
  }
  const clamp = (v: any, def: number, lo: number, hi: number): number => {
    if (v === null) return def;
    const iv = toIndex(v, 'slice indices must be integers or None or have an __index__ method');
    let x = typeof iv === 'bigint' ? (iv < 0n ? -Infinity : Infinity) : iv;
    if (x < 0) {
      x += n;
      if (x < lo) x = lo;
    } else if (x > hi) x = hi;
    return x;
  };
  let start: number;
  let stop: number;
  if (step > 0) {
    start = clamp(s.start, 0, 0, n);
    stop = clamp(s.stop, n, 0, n);
  } else {
    start = clamp(s.start, n - 1, -1, n - 1);
    stop = clamp(s.stop, -1, -1, n - 1);
  }
  return [start, stop, step];
}

export function sliceLength(start: number, stop: number, step: number): number {
  if (step > 0) return start < stop ? Math.floor((stop - start - 1) / step) + 1 : 0;
  return stop < start ? Math.floor((start - stop - 1) / -step) + 1 : 0;
}

export function sliceList(a: any[], s: PySlice): any[] {
  const [start, stop, step] = sliceIndices(s, a.length);
  if (step === 1) return start < stop ? a.slice(start, stop) : [];
  const out: any[] = [];
  if (step > 0) for (let i = start; i < stop; i += step) out.push(a[i]);
  else for (let i = start; i > stop; i += step) out.push(a[i]);
  return out;
}

export function normIndex(i: PyInt, n: number, msg: string): number {
  if (typeof i === 'bigint') throw indexError(msg);
  const k = i < 0 ? i + n : i;
  if (k < 0 || k >= n) throw indexError(msg);
  return k;
}

export function getitem(o: any, k: any): any {
  if (o instanceof PyList) {
    if (typeof k === 'number' && o.cls === listType) {
      const a = o.a;
      const i = k < 0 ? k + a.length : k;
      if (i < 0 || i >= a.length) throw indexError('list index out of range');
      return a[i];
    }
  } else if (typeof o === 'string') {
    if (typeof k === 'number') {
      if (!hasAstral(o)) {
        const i = k < 0 ? k + o.length : k;
        if (i < 0 || i >= o.length) throw indexError('string index out of range');
        return o[i];
      }
      const cs = chars(o);
      const i = k < 0 ? k + cs.length : k;
      if (i < 0 || i >= cs.length) throw indexError('string index out of range');
      return cs[i];
    }
  } else if (o instanceof PyDict) {
    if (o.cls === dictType) {
      const e = o.m.get(typeof k === 'string' ? k : ckeyOf(k));
      if (e !== undefined) return e.v;
      throw keyError(k);
    }
  } else if (o instanceof PyTuple) {
    if (typeof k === 'number' && o.cls === tupleType) {
      const a = o.a;
      const i = k < 0 ? k + a.length : k;
      if (i < 0 || i >= a.length) throw indexError('tuple index out of range');
      return a[i];
    }
  }
  return getitemSlow(o, k);
}

import { ckey as ckeyOf } from './hash';

function getitemSlow(o: any, k: any): any {
  const t = typeOf(o);
  const f = t.lookup('__getitem__');
  if (f === undefined) {
    if (o instanceof PyType) {
      const cg = o.lookup('__class_getitem__');
      if (cg !== undefined) return callObj(cg instanceof PyClassMethod ? new BoundMethod(boundMethodType, cg.fn, o) : cg, [k]);
      throw typeError(`type '${o.name}' is not subscriptable`);
    }
    throw typeError(`'${t.name}' object is not subscriptable`);
  }
  return callObj(f, [o, k]);
}

export function setitem(o: any, k: any, v: any): void {
  if (o instanceof PyList) {
    if (typeof k === 'number' && o.cls === listType) {
      const a = o.a;
      const i = k < 0 ? k + a.length : k;
      if (i < 0 || i >= a.length) throw indexError('list assignment index out of range');
      a[i] = v;
      return;
    }
  } else if (o instanceof PyDict && o.cls === dictType) {
    o.set(k, v);
    return;
  }
  const t = typeOf(o);
  const f = t.lookup('__setitem__');
  if (f === undefined) throw typeError(`'${t.name}' object does not support item assignment`);
  callObj(f, [o, k, v]);
}

export function delitem(o: any, k: any): void {
  const t = typeOf(o);
  const f = t.lookup('__delitem__');
  if (f === undefined) throw typeError(`'${t.name}' object doesn't support item deletion`);
  callObj(f, [o, k]);
}

export function contains(container: any, x: any): boolean {
  if (typeof container === 'string') {
    if (typeof x === 'string') return container.indexOf(x) >= 0;
    if (x instanceof PyBox && typeof x.value === 'string') return container.indexOf(x.value) >= 0;
    throw typeError(`'in <string>' requires string as left operand, not ${typeOf(x).name}`);
  }
  if (container instanceof PyList && container.cls === listType) {
    const a = container.a;
    for (let i = 0; i < a.length; i++) {
      const y = a[i];
      if (y === x || eqOp(y, x)) return true;
    }
    return false;
  }
  if (container instanceof PyDict && container.cls === dictType) return container.has(x);
  const t = typeOf(container);
  const f = t.lookup('__contains__');
  if (f !== undefined) return truthy(callObj(f, [container, x]));
  // iteración
  const it = getIter(container);
  for (;;) {
    const v = it.next();
    if (v === undefined) return false;
    if (v === x || eqOp(v, x)) return true;
  }
}

// ───────────────────────── iteración ─────────────────────────

export interface JsIter {
  next(): any;
}

class UserIter implements JsIter {
  private nextf: any;
  constructor(public it: any, nextf: any) {
    this.nextf = nextf;
  }
  next(): any {
    try {
      return callObj(this.nextf, [this.it]);
    } catch (e) {
      if (e instanceof PyBaseException && isInstance(e, E.StopIteration)) return undefined;
      throw e;
    }
  }
}

class SeqIter implements JsIter {
  private i = 0;
  constructor(private o: any, private getf: any) {}
  next(): any {
    try {
      return callObj(this.getf, [this.o, this.i++]);
    } catch (e) {
      if (e instanceof PyBaseException && (isInstance(e, E.IndexError) || isInstance(e, E.StopIteration))) return undefined;
      throw e;
    }
  }
}

export class ListIter extends PyIter {
  i = 0;
  constructor(public a: PyList) {
    super(listIterType);
  }
  next(): any {
    const arr = this.a.a;
    return this.i < arr.length ? arr[this.i++] : (this.i = Infinity, undefined);
  }
}
export class TupleIter extends PyIter {
  i = 0;
  constructor(public a: any[]) {
    super(tupleIterType);
  }
  next(): any {
    return this.i < this.a.length ? this.a[this.i++] : undefined;
  }
}
export class StrIter extends PyIter {
  i = 0;
  cs: string[] | null = null;
  constructor(public s: string) {
    super(strIterType);
    if (hasAstral(s)) this.cs = chars(s);
  }
  next(): any {
    if (this.cs !== null) return this.i < this.cs.length ? this.cs[this.i++] : undefined;
    return this.i < this.s.length ? this.s[this.i++] : undefined;
  }
}
export class RangeIter extends PyIter {
  cur: any;
  constructor(public start: any, public stop: any, public step: any) {
    super(rangeIterType);
    this.cur = start;
  }
  next(): any {
    const c = this.cur;
    if (typeof c === 'number' && typeof this.stop === 'number' && typeof this.step === 'number') {
      if (this.step > 0 ? c >= this.stop : c <= this.stop) return undefined;
      this.cur = c + this.step;
      return c;
    }
    const cb = toBig(c);
    const sb = toBig(this.stop);
    const st = toBig(this.step);
    if (st > 0n ? cb >= sb : cb <= sb) return undefined;
    this.cur = normBig(cb + st);
    return c;
  }
}
export class DictIter extends PyIter {
  it: Iterator<any>;
  size: number;
  constructor(public d: PyDict, public kind: 0 | 1 | 2) {
    super(kind === 0 ? dictKeyIterType : kind === 1 ? dictValueIterType : dictItemIterType);
    this.it = d.m.values();
    this.size = d.m.size;
  }
  next(): any {
    if (this.d.m.size !== this.size) {
      this.size = -1;
      throw makeExc(E.RuntimeError, ['dictionary changed size during iteration']);
    }
    const r = this.it.next();
    if (r.done) return undefined;
    const e = r.value;
    return this.kind === 0 ? e.k : this.kind === 1 ? e.v : new PyTuple([e.k, e.v]);
  }
}
export class SetIter extends PyIter {
  items: any[];
  i = 0;
  size: number;
  constructor(public s: PySet) {
    super(setIterType);
    this.items = s.items();
    this.size = s.size;
  }
  next(): any {
    if (this.s.size !== this.size) {
      this.size = -1;
      throw makeExc(E.RuntimeError, ['Set changed size during iteration']);
    }
    return this.i < this.items.length ? this.items[this.i++] : undefined;
  }
}
export class BytesIter extends PyIter {
  i = 0;
  constructor(public b: ArrayLike<number>) {
    super(bytesIterType);
  }
  next(): any {
    return this.i < this.b.length ? this.b[this.i++] : undefined;
  }
}

export function getIter(x: any): JsIter {
  if (x instanceof PyObject) {
    const t = x.cls;
    if (x instanceof PyList) { if (t === listType) return new ListIter(x); }
    else if (x instanceof PyTuple) { if (t === tupleType) return new TupleIter(x.a); }
    else if (x instanceof PyDict) { if (t === dictType) return new DictIter(x, 0); }
    else if (x instanceof PyRange) { return new RangeIter(x.start, x.stop, x.step); }
    else if (x instanceof PyIter) return x;
    else if (x instanceof PyGenerator) return x as any;
    const f = t.lookup('__iter__');
    if (f !== undefined && f !== null) {
      const r = callObj(f, [x]);
      return iterOf(r);
    }
    const g = t.lookup('__getitem__');
    if (g !== undefined) return new SeqIter(x, g);
    throw typeError(`'${t.name}' object is not iterable`);
  }
  if (typeof x === 'string') return new StrIter(x);
  throw typeError(`'${typeOf(x).name}' object is not iterable`);
}

/** el valor devuelto por __iter__ debe ser un iterador */
function iterOf(r: any): JsIter {
  if (r instanceof PyIter) return r;
  if (r instanceof PyGenerator) return r as any;
  const t = typeOf(r);
  const nf = t.lookup('__next__');
  if (nf === undefined) throw typeError(`iter() returned non-iterator of type '${t.name}'`);
  return new UserIter(r, nf);
}

/** iter(x) del lenguaje: devuelve el objeto iterador de Python */
export function pyIter(x: any): any {
  if (x instanceof PyIter || x instanceof PyGenerator) return x;
  if (x instanceof PyObject) {
    const t = x.cls;
    if (x instanceof PyList && t === listType) return new ListIter(x);
    if (x instanceof PyTuple && t === tupleType) return new TupleIter(x.a);
    if (x instanceof PyDict && t === dictType) return new DictIter(x, 0);
    if (x instanceof PyRange) return new RangeIter(x.start, x.stop, x.step);
    const f = t.lookup('__iter__');
    if (f !== undefined && f !== null) {
      const r = callObj(f, [x]);
      const rt = typeOf(r);
      if (rt.lookup('__next__') === undefined) throw typeError(`iter() returned non-iterator of type '${rt.name}'`);
      return r;
    }
    const g = t.lookup('__getitem__');
    if (g !== undefined) return new SeqIterObj(x, g);
    throw typeError(`'${t.name}' object is not iterable`);
  }
  if (typeof x === 'string') return new StrIter(x);
  throw typeError(`'${typeOf(x).name}' object is not iterable`);
}

export class SeqIterObj extends PyIter {
  i = 0;
  constructor(private o: any, private getf: any) {
    super(callableIterTypeRef.t);
  }
  next(): any {
    try {
      return callObj(this.getf, [this.o, this.i++]);
    } catch (e) {
      if (e instanceof PyBaseException && (isInstance(e, E.IndexError) || isInstance(e, E.StopIteration))) return undefined;
      throw e;
    }
  }
}
const callableIterTypeRef: { t: PyType } = { t: listIterType };

/** next(it) del lenguaje: lanza StopIteration al terminar */
export function pyNext(it: any): any {
  if (it instanceof PyIter || it instanceof PyGenerator) {
    const v = (it as any).next();
    if (v === undefined) {
      if (it instanceof PyGenerator) throw stopIteration(it.retValue);
      throw stopIteration();
    }
    return v;
  }
  const t = typeOf(it);
  const f = t.lookup('__next__');
  if (f === undefined) throw typeError(`'${t.name}' object is not an iterator`);
  return callObj(f, [it]);
}

/** convierte cualquier iterable en array de JS */
export function iterToArray(x: any): any[] {
  if (x instanceof PyList) { if (x.cls === listType) return x.a.slice(); }
  else if (x instanceof PyTuple) { if (x.cls === tupleType) return x.a.slice(); }
  else if (typeof x === 'string') return hasAstral(x) ? chars(x).slice() : x.split('');
  const it = getIter(x);
  const out: any[] = [];
  for (;;) {
    const v = it.next();
    if (v === undefined) return out;
    out.push(v);
  }
}

/** desempaquetado `a, b = x` */
export function unpack(x: any, n: number): any[] {
  if (x instanceof PyTuple || x instanceof PyList) {
    const a = x.a;
    if (a.length === n) return a.slice();
    if (a.length < n) throw valueError(`not enough values to unpack (expected ${n}, got ${a.length})`);
    throw valueError(`too many values to unpack (expected ${n})`);
  }
  let it: JsIter;
  try {
    it = getIter(x);
  } catch (e) {
    if (e instanceof PyBaseException && isInstance(e, E.TypeError) && typeOf(x).lookup('__iter__') === undefined && typeOf(x).lookup('__getitem__') === undefined) {
      throw typeError(`cannot unpack non-iterable ${typeOf(x).name} object`);
    }
    throw e;
  }
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    const v = it.next();
    if (v === undefined) throw valueError(`not enough values to unpack (expected ${n}, got ${i})`);
    out.push(v);
  }
  if (it.next() !== undefined) throw valueError(`too many values to unpack (expected ${n})`);
  return out;
}

/** desempaquetado con estrella: antes + *resto + después */
export function unpackEx(x: any, before: number, after: number): any[][] {
  const items = (() => {
    try {
      return iterToArray(x);
    } catch (e) {
      if (e instanceof PyBaseException && isInstance(e, E.TypeError) && typeOf(x).lookup('__iter__') === undefined && typeOf(x).lookup('__getitem__') === undefined) {
        throw typeError(`cannot unpack non-iterable ${typeOf(x).name} object`);
      }
      throw e;
    }
  })();
  if (items.length < before + after) {
    throw valueError(`not enough values to unpack (expected at least ${before + after}, got ${items.length})`);
  }
  return [items.slice(0, before), items.slice(before, items.length - after), items.slice(items.length - after)];
}

// ───────────────────────── isinstance / issubclass ─────────────────────────

export function isinstanceCheck(x: any, c: any): boolean {
  if (c instanceof PyType) {
    const meta = c.cls;
    if (meta !== typeType) {
      const ic = meta.lookup('__instancecheck__');
      if (ic !== undefined && ic !== TYPE_INSTANCECHECK.f) return truthy(callObj(ic, [c, x]));
    }
    const t = typeOf(x);
    if (t.isSubtype(c)) return true;
    // __class__ sobrescrito
    if (x instanceof PyObject && x.dict !== null) {
      const cc = x.dict.get('__class__');
      if (cc instanceof PyType) return cc.isSubtype(c);
    }
    return false;
  }
  if (c instanceof PyTuple) {
    for (const k of c.a) if (isinstanceCheck(x, k)) return true;
    return false;
  }
  if (c instanceof PyObject) {
    // typing.Union / X | Y
    if (c.cls === unionTypeRef.t) {
      const args = c.dict?.get('__args__');
      if (args instanceof PyTuple) {
        for (const k of args.a) if (isinstanceCheck(x, k)) return true;
        return false;
      }
    }
    const ic = c.cls.lookup('__instancecheck__');
    if (ic !== undefined) return truthy(callObj(ic, [c, x]));
  }
  throw typeError('isinstance() arg 2 must be a type, a tuple of types, or a union');
}
export const TYPE_INSTANCECHECK: { f: any } = { f: undefined };
export const TYPE_SUBCLASSCHECK: { f: any } = { f: undefined };
export const unionTypeRef: { t: PyType } = { t: undefined as any };

export function issubclassCheck(c: any, t: any): boolean {
  if (!(c instanceof PyType) && !(c instanceof PyObject && c.cls.lookup('__subclasscheck__') === undefined && false)) {
    if (!(c instanceof PyType)) throw typeError('issubclass() arg 1 must be a class');
  }
  if (t instanceof PyType) {
    const meta = t.cls;
    if (meta !== typeType) {
      const sc = meta.lookup('__subclasscheck__');
      if (sc !== undefined && sc !== TYPE_SUBCLASSCHECK.f) return truthy(callObj(sc, [t, c]));
    }
    return (c as PyType).isSubtype(t);
  }
  if (t instanceof PyTuple) {
    for (const k of t.a) if (issubclassCheck(c, k)) return true;
    return false;
  }
  if (t instanceof PyObject) {
    if (t.cls === unionTypeRef.t) {
      const args = t.dict?.get('__args__');
      if (args instanceof PyTuple) {
        for (const k of args.a) if (issubclassCheck(c, k)) return true;
        return false;
      }
    }
    const sc = t.cls.lookup('__subclasscheck__');
    if (sc !== undefined) return truthy(callObj(sc, [t, c]));
  }
  throw typeError('issubclass() arg 2 must be a class, a tuple of classes, or a union');
}

// ───────────────────────── varios ─────────────────────────

export function mkTuple(a: any[]): PyTuple {
  return new PyTuple(a);
}
export function mkList(a: any[]): PyList {
  return new PyList(a);
}

export function makeSlice(start: any, stop: any, step: any): PySlice {
  return new PySlice(start, stop, step, sliceType);
}

export { Ellipsis, objectType, noneType, strType, intType, floatType, boolType, functionType, moduleType, propertyType, classMethodType, staticMethodType, superType, tupleType, listType, dictType, setType, frozenSetType, bytesType, byteArrayType, rangeType, complexType };
export { F_BUILTIN, PySuper, callFunction, indexError, overflowError, intDivmod, strAt, strSlice };
