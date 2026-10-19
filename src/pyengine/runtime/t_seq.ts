/**
 * `list`, `tuple`, `range`, `slice` y los iteradores nativos (`enumerate`, `zip`, `map`, `filter`, `reversed`…).
 */
import {
  PyBaseException, PyBox, PyDict, PyFloat, PyGenerator, PyIter, PyList, PyObject, PyProperty, PyRange, PySlice, PyTuple, PyType, type Kw,
} from './objects';
import {
  NotImplemented, enumerateType, filterType, listIterType, listRevIterType, listType, mapType, propertyType, rangeIterType, rangeType,
  reversedType, sliceType, tupleIterType, tupleType, typeOf, zipType, strIterType, dictKeyIterType, dictValueIterType, dictItemIterType,
  setIterType, bytesIterType, callableIterType,
} from './builtin_types';
import { E } from './exc_types';
import { indexError, makeExc, overflowError, stopIteration, typeError, valueError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { cmpStr, strHash } from './pystr';
import { intAdd, intCmp, intMul, intSign, intSub, normBig, toBig, type PyInt } from './numeric';
import { defMethods, mkNative } from './native';
import { asIdx, kwMap, tupleArr } from './util';
import { interp } from './state';

// ───────────────────────── ordenación ─────────────────────────

type Lt = (a: any, b: any) => boolean;

function pickLt(a: any[]): Lt {
  if (a.length === 0) return ops.lt;
  const t0 = typeof a[0];
  if (t0 === 'number' && a.every((x) => typeof x === 'number')) return (x, y) => x < y;
  if (t0 === 'string' && a.every((x) => typeof x === 'string')) return (x, y) => cmpStr(x, y) < 0;
  if (a[0] instanceof PyFloat && a.every((x) => x instanceof PyFloat)) return (x, y) => x.v < y.v;
  return ops.lt;
}

function binarySort(a: any[], lo: number, hi: number, start: number, lt: Lt): void {
  if (lo === start) start++;
  for (; start < hi; start++) {
    const pivot = a[start];
    let l = lo;
    let r = start;
    while (l < r) {
      const p = l + ((r - l) >> 1);
      if (lt(pivot, a[p])) r = p;
      else l = p + 1;
    }
    for (let p = start; p > l; p--) a[p] = a[p - 1];
    a[l] = pivot;
  }
}

function countRun(a: any[], lo: number, hi: number, lt: Lt): number {
  let n = 1;
  if (lo + 1 === hi) return 1;
  let i = lo + 1;
  if (lt(a[i], a[lo])) {
    for (i = lo + 2; i < hi; i++, n++) if (!lt(a[i], a[i - 1])) break;
    n++;
    // invertir [lo, lo+n)
    for (let x = lo, y = lo + n - 1; x < y; x++, y--) { const t = a[x]; a[x] = a[y]; a[y] = t; }
  } else {
    for (i = lo + 2; i < hi; i++, n++) if (lt(a[i], a[i - 1])) break;
    n++;
  }
  return n;
}

function mergeSortRange(a: any[], lo: number, hi: number, lt: Lt, tmp: any[]): void {
  const n = hi - lo;
  if (n < 2) return;
  if (n <= 64) {
    const run = countRun(a, lo, hi, lt);
    binarySort(a, lo, hi, lo + run, lt);
    return;
  }
  const mid = lo + (n >> 1);
  mergeSortRange(a, lo, mid, lt, tmp);
  mergeSortRange(a, mid, hi, lt, tmp);
  if (!lt(a[mid], a[mid - 1])) return;
  let i = lo;
  let j = mid;
  let k = 0;
  while (i < mid && j < hi) tmp[k++] = lt(a[j], a[i]) ? a[j++] : a[i++];
  while (i < mid) tmp[k++] = a[i++];
  while (j < hi) tmp[k++] = a[j++];
  for (let x = 0; x < k; x++) a[lo + x] = tmp[x];
}

/** ordena `items` (estable) con `key` opcional; modifica el array recibido */
export function sortItems(items: any[], key: any, reverse: boolean): any[] {
  const n = items.length;
  if (n < 2) return items;
  let keys: any[] = items;
  if (key !== null && key !== undefined) {
    keys = new Array(n);
    for (let i = 0; i < n; i++) keys[i] = callObj(key, [items[i]]);
  }
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  // ordenar los índices por clave: para mantener la estabilidad y los mensajes de error, ordenamos pares
  const lt0 = pickLt(keys);
  const pairs: { k: any; v: any }[] = new Array(n);
  for (let i = 0; i < n; i++) pairs[i] = { k: keys[i], v: items[i] };
  if (reverse) pairs.reverse();
  const lt: Lt = (x, y) => lt0(x.k, y.k);
  mergeSortRange(pairs, 0, n, lt, new Array(n));
  if (reverse) pairs.reverse();
  for (let i = 0; i < n; i++) items[i] = pairs[i].v;
  return items;
}

// ───────────────────────── repr recursivo ─────────────────────────

const reprStack = new Set<any>();
function guardedRepr(o: any, f: () => string, rec: string): string {
  if (reprStack.has(o)) return rec;
  reprStack.add(o);
  try {
    return f();
  } finally {
    reprStack.delete(o);
  }
}

// ───────────────────────── comparación de secuencias ─────────────────────────

function seqCompare(op: string, a: any[], b: any[]): boolean {
  const n = Math.min(a.length, b.length);
  let i = 0;
  for (; i < n; i++) {
    if (a[i] === b[i]) continue;
    if (!ops.eqOp(a[i], b[i])) break;
  }
  if (i >= n) {
    const c = a.length - b.length;
    switch (op) {
      case '==': return c === 0;
      case '!=': return c !== 0;
      case '<': return c < 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      default: return c >= 0;
    }
  }
  if (op === '==') return false;
  if (op === '!=') return true;
  return ops.cmpBool(op, a[i], b[i]);
}

// ───────────────────────── list ─────────────────────────

const L = listType;
L.alloc = (cls) => new PyList([], cls);

function la(x: any): any[] {
  if (x instanceof PyList) return x.a;
  throw typeError(`descriptor requires a 'list' object but received a '${typeOf(x).name}'`);
}

function listIndex(l: PyList, k: any, what: string): number {
  const iv = ops.toIndex(k, `list indices must be integers or slices, not ${typeOf(k).name}`);
  void what;
  return typeof iv === 'bigint' ? (iv < 0n ? -Infinity : Infinity) : iv;
}

function repeatArr(a: any[], n: PyInt): any[] {
  const k = typeof n === 'bigint' ? (n < 0n ? 0 : Infinity) : n;
  if (k <= 0 || a.length === 0) return [];
  if (!isFinite(k) || a.length * k > 2 ** 28) throw makeExc(E.MemoryError, []);
  const out: any[] = [];
  for (let i = 0; i < k; i++) for (const x of a) out.push(x);
  return out;
}

function multiplier(n: any): PyInt | undefined {
  const iv = ops.intValue(n);
  if (iv !== undefined) return iv;
  if (typeOf(n).lookup('__index__') !== undefined) return ops.toIndex(n);
  return undefined;
}

function setSliceAssign(l: PyList, s: PySlice, v: any): void {
  const a = l.a;
  const [start, stop, step] = ops.sliceIndices(s, a.length);
  const items = v instanceof PyList ? v.a.slice() : ops.iterToArray(v);
  if (step === 1) {
    const end = Math.max(start, stop);
    a.splice(start, end - start, ...items);
    return;
  }
  const len = ops.sliceLength(start, stop, step);
  if (items.length !== len) throw valueError(`attempt to assign sequence of size ${items.length} to extended slice of size ${len}`);
  let k = 0;
  if (step > 0) for (let i = start; i < stop; i += step) a[i] = items[k++];
  else for (let i = start; i > stop; i += step) a[i] = items[k++];
}

function delSlice(l: PyList, s: PySlice): void {
  const a = l.a;
  const [start, stop, step] = ops.sliceIndices(s, a.length);
  if (step === 1) {
    if (stop > start) a.splice(start, stop - start);
    return;
  }
  const idxs: number[] = [];
  if (step > 0) for (let i = start; i < stop; i += step) idxs.push(i);
  else for (let i = start; i > stop; i += step) idxs.push(i);
  idxs.sort((x, y) => y - x);
  for (const i of idxs) a.splice(i, 1);
}

defMethods(L, {
  __init__: ['self, iterable=', (self: any, it?: any) => {
    const l = self as PyList;
    if (it === undefined) { l.a.length = 0; return null; }
    const items = it instanceof PyList && it !== l ? it.a.slice() : ops.iterToArray(it);
    l.a = items;
    return null;
  }],
  __repr__: ['self', (l: any) => guardedRepr(l, () => '[' + la(l).map(ops.repr).join(', ') + ']', '[...]')],
  __len__: ['self', (l: any) => la(l).length],
  __bool__: ['self', (l: any) => la(l).length > 0],
  __iter__: ['self', (l: any) => new ops.ListIter(l)],
  __reversed__: ['self', (l: any) => new ListRevIter(l)],
  __contains__: ['self, x', (l: any, x: any) => {
    const a = la(l);
    for (let i = 0; i < a.length; i++) if (a[i] === x || ops.eqOp(a[i], x)) return true;
    return false;
  }],
  __getitem__: ['self, key', (l: any, k: any) => {
    const a = la(l);
    if (k instanceof PySlice) return new PyList(ops.sliceList(a, k));
    const i = listIndex(l, k, 'index');
    const j = i < 0 ? i + a.length : i;
    if (j < 0 || j >= a.length) throw indexError('list index out of range');
    return a[j];
  }],
  __setitem__: ['self, key, value', (l: any, k: any, v: any) => {
    const a = la(l);
    if (k instanceof PySlice) { setSliceAssign(l, k, v); return null; }
    const i = listIndex(l, k, 'index');
    const j = i < 0 ? i + a.length : i;
    if (j < 0 || j >= a.length) throw indexError('list assignment index out of range');
    a[j] = v;
    return null;
  }],
  __delitem__: ['self, key', (l: any, k: any) => {
    const a = la(l);
    if (k instanceof PySlice) { delSlice(l, k); return null; }
    const i = listIndex(l, k, 'index');
    const j = i < 0 ? i + a.length : i;
    if (j < 0 || j >= a.length) throw indexError('list assignment index out of range');
    a.splice(j, 1);
    return null;
  }],
  __add__: ['self, other', (l: any, o: any) => {
    if (!(o instanceof PyList)) throw typeError(`can only concatenate list (not "${typeOf(o).name}") to list`);
    return new PyList(la(l).concat(o.a));
  }],
  __iadd__: ['self, other', (l: any, o: any) => {
    const a = la(l);
    const items = o instanceof PyList ? o.a.slice() : ops.iterToArray(o);
    for (const x of items) a.push(x);
    return l;
  }],
  __mul__: ['self, n', (l: any, n: any) => {
    const k = multiplier(n);
    if (k === undefined) return NotImplemented;
    return new PyList(repeatArr(la(l), k));
  }],
  __rmul__: ['self, n', (l: any, n: any) => {
    const k = multiplier(n);
    if (k === undefined) return NotImplemented;
    return new PyList(repeatArr(la(l), k));
  }],
  __imul__: ['self, n', (l: any, n: any) => {
    const k = multiplier(n);
    if (k === undefined) return NotImplemented;
    l.a = repeatArr(la(l), k);
    return l;
  }],
  __eq__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('==', a.a, b.a) : NotImplemented)],
  __ne__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('!=', a.a, b.a) : NotImplemented)],
  __lt__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('<', a.a, b.a) : NotImplemented)],
  __le__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('<=', a.a, b.a) : NotImplemented)],
  __gt__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('>', a.a, b.a) : NotImplemented)],
  __ge__: ['self, other', (a: any, b: any) => (b instanceof PyList ? seqCompare('>=', a.a, b.a) : NotImplemented)],
  __sizeof__: ['self', (l: any) => 56 + 8 * la(l).length],
  append: ['self, object', (l: any, x: any) => { la(l).push(x); return null; }],
  extend: ['self, iterable', (l: any, it: any) => {
    const a = la(l);
    const items = it instanceof PyList ? it.a.slice() : ops.iterToArray(it);
    for (let i = 0; i < items.length; i++) a.push(items[i]);
    return null;
  }],
  insert: ['self, index, object', (l: any, i: any, x: any) => {
    const a = la(l);
    let k = asIdx(i);
    if (k < 0) { k += a.length; if (k < 0) k = 0; }
    if (k > a.length) k = a.length;
    a.splice(k, 0, x);
    return null;
  }],
  pop: ['self, index=', (l: any, i?: any) => {
    const a = la(l);
    if (a.length === 0) throw indexError('pop from empty list');
    if (i === undefined) return a.pop();
    let k = asIdx(i);
    if (k < 0) k += a.length;
    if (k < 0 || k >= a.length) throw indexError('pop index out of range');
    return a.splice(k, 1)[0];
  }],
  remove: ['self, value', (l: any, x: any) => {
    const a = la(l);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === x || ops.eqOp(a[i], x)) { a.splice(i, 1); return null; }
    }
    throw valueError('list.remove(x): x not in list');
  }],
  clear: ['self', (l: any) => { la(l).length = 0; return null; }],
  copy: ['self', (l: any) => new PyList(la(l).slice())],
  count: ['self, value', (l: any, x: any) => {
    let n = 0;
    for (const y of la(l)) if (y === x || ops.eqOp(y, x)) n++;
    return n;
  }],
  index: ['self, value, start=, stop=', (l: any, x: any, s?: any, e?: any) => {
    const a = la(l);
    let st = s === undefined ? 0 : asIdx(s);
    let en = e === undefined ? a.length : asIdx(e);
    if (st < 0) { st += a.length; if (st < 0) st = 0; }
    if (en < 0) en += a.length;
    if (en > a.length) en = a.length;
    for (let i = st; i < en; i++) if (a[i] === x || ops.eqOp(a[i], x)) return i;
    throw valueError(`${ops.repr(x)} is not in list`);
  }],
  reverse: ['self', (l: any) => { la(l).reverse(); return null; }],
  sort: ['self, *, key=, reverse=', (l: any, key?: any, rev?: any) => {
    const lst = l as PyList;
    const items = lst.a.slice();
    lst.a = [];
    try {
      sortItems(items, key, rev !== undefined && ops.truthy(rev));
    } finally {
      const mod = lst.a.length > 0;
      lst.a = items;
      if (mod) throw valueError('list modified during sort');
    }
    return null;
  }],
});
L.dict!.set('__hash__', null);
L.dict!.set('__doc__', 'Built-in mutable sequence.');

class ListRevIter extends PyIter {
  i: number;
  constructor(public l: PyList) {
    super(listRevIterType);
    this.i = l.a.length - 1;
  }
  next(): any {
    if (this.i >= 0 && this.i < this.l.a.length) return this.l.a[this.i--];
    this.i = -1;
    return undefined;
  }
}

// ───────────────────────── tuple ─────────────────────────

const T = tupleType;

const M64 = (1n << 64n) - 1n;
const XXP1 = 11400714785074694791n;
const XXP2 = 14029467366897019727n;
const XXP5 = 2870177450012600261n;

export function tupleHash(items: any[]): number {
  let acc = XXP5;
  for (const x of items) {
    const h = ops.hashOf(x);
    const lane = BigInt.asUintN(64, BigInt(h));
    acc = (acc + lane * XXP2) & M64;
    acc = ((acc << 31n) | (acc >> 33n)) & M64;
    acc = (acc * XXP1) & M64;
  }
  acc = (acc + (BigInt(items.length) ^ (XXP5 ^ 3527539n))) & M64;
  if (acc === M64) return 1546275796;
  return Number(BigInt.asIntN(64, acc));
}

function ta(x: any): any[] {
  if (x instanceof PyTuple) return x.a;
  throw typeError(`descriptor requires a 'tuple' object but received a '${typeOf(x).name}'`);
}

T.dict!.set('__new__', mkNative('__new__', 'cls, iterable=', (cls: any, it?: any) => {
  const items = it === undefined ? [] : it instanceof PyTuple && it.cls === tupleType ? it.a : ops.iterToArray(it);
  if (cls === tupleType) {
    if (it instanceof PyTuple && it.cls === tupleType) return it;
    return new PyTuple(items);
  }
  return new PyTuple(items.slice(), cls);
}, { owner: 'tuple' }));

defMethods(T, {
  __repr__: ['self', (t: any) => guardedRepr(t, () => {
    const a = ta(t);
    if (a.length === 0) return '()';
    if (a.length === 1) return '(' + ops.repr(a[0]) + ',)';
    return '(' + a.map(ops.repr).join(', ') + ')';
  }, '(...)')],
  __len__: ['self', (t: any) => ta(t).length],
  __bool__: ['self', (t: any) => ta(t).length > 0],
  __hash__: ['self', (t: any) => tupleHash(ta(t))],
  __iter__: ['self', (t: any) => new ops.TupleIter(ta(t))],
  __contains__: ['self, x', (t: any, x: any) => {
    for (const y of ta(t)) if (y === x || ops.eqOp(y, x)) return true;
    return false;
  }],
  __getitem__: ['self, key', (t: any, k: any) => {
    const a = ta(t);
    if (k instanceof PySlice) return new PyTuple(ops.sliceList(a, k));
    const iv = ops.toIndex(k, `tuple indices must be integers or slices, not ${typeOf(k).name}`);
    const i = ops.normIndex(iv, a.length, 'tuple index out of range');
    return a[i];
  }],
  __add__: ['self, other', (t: any, o: any) => {
    if (!(o instanceof PyTuple)) throw typeError(`can only concatenate tuple (not "${typeOf(o).name}") to tuple`);
    return new PyTuple(ta(t).concat(o.a));
  }],
  __mul__: ['self, n', (t: any, n: any) => {
    const k = multiplier(n);
    if (k === undefined) return NotImplemented;
    return new PyTuple(repeatArr(ta(t), k));
  }],
  __rmul__: ['self, n', (t: any, n: any) => {
    const k = multiplier(n);
    if (k === undefined) return NotImplemented;
    return new PyTuple(repeatArr(ta(t), k));
  }],
  __eq__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('==', a.a, b.a) : NotImplemented)],
  __ne__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('!=', a.a, b.a) : NotImplemented)],
  __lt__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('<', a.a, b.a) : NotImplemented)],
  __le__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('<=', a.a, b.a) : NotImplemented)],
  __gt__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('>', a.a, b.a) : NotImplemented)],
  __ge__: ['self, other', (a: any, b: any) => (b instanceof PyTuple ? seqCompare('>=', a.a, b.a) : NotImplemented)],
  __getnewargs__: ['self', (t: any) => new PyTuple([new PyTuple(ta(t).slice())])],
  __sizeof__: ['self', (t: any) => 40 + 8 * ta(t).length],
  count: ['self, value', (t: any, x: any) => {
    let n = 0;
    for (const y of ta(t)) if (y === x || ops.eqOp(y, x)) n++;
    return n;
  }],
  index: ['self, value, start=, stop=', (t: any, x: any, s?: any, e?: any) => {
    const a = ta(t);
    let st = s === undefined ? 0 : asIdx(s);
    let en = e === undefined ? a.length : asIdx(e);
    if (st < 0) { st += a.length; if (st < 0) st = 0; }
    if (en < 0) en += a.length;
    if (en > a.length) en = a.length;
    for (let i = st; i < en; i++) if (a[i] === x || ops.eqOp(a[i], x)) return i;
    throw valueError('tuple.index(x): x not in tuple');
  }],
});

// ───────────────────────── range ─────────────────────────

const R = rangeType;

function rangeLen(r: PyRange): PyInt {
  const { start, stop, step } = r;
  if (typeof start === 'number' && typeof stop === 'number' && typeof step === 'number') {
    if (step > 0) return start < stop ? Math.floor((stop - start - 1) / step) + 1 : 0;
    return stop < start ? Math.floor((start - stop - 1) / -step) + 1 : 0;
  }
  const s = toBig(start);
  const e = toBig(stop);
  const st = toBig(step);
  if (st > 0n) return s < e ? normBig((e - s - 1n) / st + 1n) : 0;
  return e < s ? normBig((s - e - 1n) / -st + 1n) : 0;
}

function rangeItem(r: PyRange, i: PyInt): PyInt {
  return intAdd(r.start, intMul(i, r.step));
}

function rv(x: any): PyRange {
  if (x instanceof PyRange) return x;
  throw typeError(`descriptor requires a 'range' object but received a '${typeOf(x).name}'`);
}

R.dict!.set('__new__', mkNative('__new__', 'cls, a, b=, c=', (cls: any, a: any, b?: any, c?: any) => {
  const conv = (x: any): PyInt => ops.toIndex(x, `'${typeOf(x).name}' object cannot be interpreted as an integer`);
  let start: PyInt = 0;
  let stop: PyInt;
  let step: PyInt = 1;
  if (b === undefined) stop = conv(a);
  else {
    start = conv(a);
    stop = conv(b);
    if (c !== undefined) step = conv(c);
  }
  if (intSign(step) === 0) throw valueError('range() arg 3 must not be zero');
  return new PyRange(start, stop, step, cls);
}, { owner: 'range' }));

function rangeContains(r: PyRange, x: any): boolean {
  const iv = ops.intValue(x);
  if (iv === undefined) {
    // comparación elemento a elemento (floats, etc.)
    const it = new ops.RangeIter(r.start, r.stop, r.step);
    for (;;) {
      const v = it.next();
      if (v === undefined) return false;
      if (ops.eqOp(v, x)) return true;
    }
  }
  const { start, stop, step } = r;
  if (intSign(step) > 0 ? !(intCmp(iv, start) >= 0 && intCmp(iv, stop) < 0) : !(intCmp(iv, start) <= 0 && intCmp(iv, stop) > 0)) return false;
  const d = toBig(intSub(iv, start));
  return d % toBig(step) === 0n;
}

defMethods(R, {
  __repr__: ['self', (r: any) => {
    const x = rv(r);
    return intCmp(x.step, 1) === 0 ? `range(${x.start}, ${x.stop})` : `range(${x.start}, ${x.stop}, ${x.step})`;
  }],
  __len__: ['self', (r: any) => {
    const n = rangeLen(rv(r));
    if (typeof n === 'bigint') throw overflowError('Python int too large to convert to C ssize_t');
    return n;
  }],
  __bool__: ['self', (r: any) => intSign(rangeLen(rv(r))) !== 0],
  __iter__: ['self', (r: any) => new ops.RangeIter(rv(r).start, rv(r).stop, rv(r).step)],
  __reversed__: ['self', (r: any) => {
    const x = rv(r);
    const n = rangeLen(x);
    if (intSign(n) === 0) return new ops.RangeIter(0, 0, 1);
    const last = rangeItem(x, intSub(n, 1));
    return new ops.RangeIter(last, intSub(x.start, intSign(x.step) > 0 ? 1 : -1), ops.unaryNeg(x.step));
  }],
  __contains__: ['self, x', (r: any, x: any) => rangeContains(rv(r), x)],
  __getitem__: ['self, key', (r: any, k: any) => {
    const x = rv(r);
    const n = rangeLen(x);
    if (k instanceof PySlice) {
      const len = typeof n === 'bigint' ? Number.MAX_SAFE_INTEGER : n;
      const [st, sp, step] = ops.sliceIndices(k, len);
      const newStart = rangeItem(x, st);
      const newStop = rangeItem(x, sp);
      const newStep = intMul(x.step, step);
      return new PyRange(newStart, newStop, newStep, rangeType);
    }
    const iv = ops.toIndex(k, `range indices must be integers or slices, not ${typeOf(k).name}`);
    let i = iv;
    if (intSign(i) < 0) i = intAdd(i, n);
    if (intSign(i) < 0 || intCmp(i, n) >= 0) throw indexError('range object index out of range');
    return rangeItem(x, i);
  }],
  __eq__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyRange)) return NotImplemented;
    const la1 = rangeLen(a);
    const lb1 = rangeLen(b);
    if (intCmp(la1, lb1) !== 0) return false;
    if (intSign(la1) === 0) return true;
    if (intCmp(a.start, b.start) !== 0) return false;
    if (intCmp(la1, 1) === 0) return true;
    return intCmp(a.step, b.step) === 0;
  }],
  __hash__: ['self', (r: any) => {
    const x = rv(r);
    const n = rangeLen(x);
    const parts = intSign(n) === 0 ? [n, null, null] : intCmp(n, 1) === 0 ? [n, x.start, null] : [n, x.start, x.step];
    return tupleHash(parts);
  }],
  count: ['self, value', (r: any, x: any) => (rangeContains(rv(r), x) ? 1 : 0)],
  index: ['self, value', (r: any, x: any) => {
    const rr = rv(r);
    if (!rangeContains(rr, x)) throw valueError(`${ops.repr(x)} is not in range`);
    const iv = ops.intValue(x)!;
    return normBig(toBig(intSub(iv, rr.start)) / toBig(rr.step));
  }],
});
function rprop(name: string, get: (r: PyRange) => any): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', (r: any) => get(rv(r)), { method: true });
  R.dict!.set(name, p);
}
rprop('start', (r) => r.start);
rprop('stop', (r) => r.stop);
rprop('step', (r) => r.step);

// ───────────────────────── slice ─────────────────────────

const SL = sliceType;
SL.dict!.set('__new__', mkNative('__new__', 'cls, a, b=, c=', (cls: any, a: any, b?: any, c?: any) => {
  if (b === undefined) return new PySlice(null, a, null, cls);
  return new PySlice(a, b, c === undefined ? null : c, cls);
}, { owner: 'slice' }));
const sl = (x: any): PySlice => x as PySlice;
defMethods(SL, {
  __repr__: ['self', (s: any) => `slice(${ops.repr(sl(s).start)}, ${ops.repr(sl(s).stop)}, ${ops.repr(sl(s).step)})`],
  __eq__: ['self, other', (a: any, b: any) => (b instanceof PySlice ? ops.eqOp(new PyTuple([a.start, a.stop, a.step]), new PyTuple([b.start, b.stop, b.step])) : NotImplemented)],
  __hash__: ['self', () => { throw typeError("unhashable type: 'slice'"); }],
  indices: ['self, length', (s: any, n: any) => {
    const len = asIdx(n);
    if (len < 0) throw valueError('length should not be negative');
    const [a, b, c] = ops.sliceIndices(s, len);
    return new PyTuple([a, b, c]);
  }],
});
for (const nm of ['start', 'stop', 'step'] as const) {
  const p = new PyProperty(propertyType);
  p.name = nm;
  p.fget = mkNative(nm, 'self', (s: any) => s[nm], { method: true });
  SL.dict!.set(nm, p);
}
SL.dict!.set('__hash__', null);

// ───────────────────────── iteradores nativos ─────────────────────────

function iterDunders(t: PyType): void {
  defMethods(t, {
    __iter__: ['self', (it: any) => it],
    __next__: ['self', (it: any) => {
      const v = (it as PyIter).next();
      if (v === undefined) throw stopIteration();
      return v;
    }],
  });
}
for (const t of [listIterType, listRevIterType, tupleIterType, strIterType, dictKeyIterType, dictValueIterType, dictItemIterType, setIterType, rangeIterType, bytesIterType, callableIterType]) iterDunders(t);
defMethods(listIterType, {
  __length_hint__: ['self', (it: any) => Math.max(0, it.a.a.length - it.i)],
});

function jsIterOf(x: any): ops.JsIter {
  return ops.getIter(x);
}

export class PyEnumerate extends PyIter {
  idx: PyInt;
  constructor(cls: PyType, public it: ops.JsIter, start: PyInt) {
    super(cls);
    this.idx = start;
  }
  next(): any {
    const v = this.it.next();
    if (v === undefined) return undefined;
    const i = this.idx;
    this.idx = intAdd(i, 1);
    return new PyTuple([i, v]);
  }
}
enumerateType.dict!.set('__new__', mkNative('__new__', 'cls, iterable, start=', (cls: any, it: any, start?: any) => {
  return new PyEnumerate(cls, jsIterOf(it), start === undefined ? 0 : ops.toIndex(start));
}, { owner: 'enumerate' }));
iterDunders(enumerateType);

export class PyZip extends PyIter {
  done = false;
  constructor(cls: PyType, public its: ops.JsIter[], public strict: boolean) {
    super(cls);
  }
  next(): any {
    if (this.done || this.its.length === 0) return undefined;
    const out: any[] = new Array(this.its.length);
    for (let i = 0; i < this.its.length; i++) {
      const v = this.its[i].next();
      if (v === undefined) {
        this.done = true;
        if (this.strict) {
          if (i > 0) throw valueError(`zip() argument ${i + 1} is shorter than argument${i === 1 ? ' 1' : `s 1-${i}`}`);
          for (let j = 1; j < this.its.length; j++) {
            if (this.its[j].next() !== undefined) throw valueError(`zip() argument ${j + 1} is longer than argument${j === 1 ? ' 1' : `s 1-${j}`}`);
          }
        }
        return undefined;
      }
      out[i] = v;
    }
    return new PyTuple(out);
  }
}
zipType.dict!.set('__new__', mkNative('__new__', 'cls, *iterables, strict=', (cls: any, its: any, strict?: any) => {
  return new PyZip(cls, tupleArr(its).map(jsIterOf), strict !== undefined && ops.truthy(strict));
}, { owner: 'zip' }));
iterDunders(zipType);

export class PyMap extends PyIter {
  constructor(cls: PyType, public f: any, public its: ops.JsIter[]) {
    super(cls);
  }
  next(): any {
    const args: any[] = new Array(this.its.length);
    for (let i = 0; i < this.its.length; i++) {
      const v = this.its[i].next();
      if (v === undefined) return undefined;
      args[i] = v;
    }
    return callObj(this.f, args);
  }
}
mapType.dict!.set('__new__', mkNative('__new__', 'cls, func, *iterables', (cls: any, f: any, its: any) => {
  const a = tupleArr(its);
  if (a.length === 0) throw typeError('map() must have at least two arguments.');
  return new PyMap(cls, f, a.map(jsIterOf));
}, { owner: 'map' }));
iterDunders(mapType);

export class PyFilter extends PyIter {
  constructor(cls: PyType, public f: any, public it: ops.JsIter) {
    super(cls);
  }
  next(): any {
    for (;;) {
      const v = this.it.next();
      if (v === undefined) return undefined;
      if (this.f === null) { if (ops.truthy(v)) return v; }
      else if (ops.truthy(callObj(this.f, [v]))) return v;
    }
  }
}
filterType.dict!.set('__new__', mkNative('__new__', 'cls, function, iterable', (cls: any, f: any, it: any) => new PyFilter(cls, f, jsIterOf(it)), { owner: 'filter' }));
iterDunders(filterType);

export class PyReversed extends PyIter {
  i: number;
  constructor(cls: PyType, public seq: any, public n: number) {
    super(cls);
    this.i = n - 1;
  }
  next(): any {
    if (this.i < 0) return undefined;
    const v = ops.getitem(this.seq, this.i--);
    return v;
  }
}
reversedType.dict!.set('__new__', mkNative('__new__', 'cls, sequence', (cls: any, s: any) => {
  const t = typeOf(s);
  const rv0 = t.lookup('__reversed__');
  if (rv0 !== undefined && cls === reversedType) return callObj(rv0, [s]);
  if (t.lookup('__getitem__') === undefined || t.lookup('__len__') === undefined || s instanceof PyDict) {
    throw typeError(`'${t.name}' object is not reversible`);
  }
  return new PyReversed(cls, s, ops.lenOf(s));
}, { owner: 'reversed' }));
iterDunders(reversedType);

/** Iterador creado por iter(callable, sentinel) */
export class CallableIter extends PyIter {
  done = false;
  constructor(public f: any, public sentinel: any) {
    super(callableIterType);
  }
  next(): any {
    if (this.done) return undefined;
    const v = callObj(this.f, []);
    if (v === this.sentinel || ops.eqOp(v, this.sentinel)) { this.done = true; return undefined; }
    return v;
  }
}

void [PyBox, PyObject, PyBaseException, PyGenerator, interp, strHash, kwMap, mkNative, E];
export type { Kw };
export { jsIterOf, rangeLen };
