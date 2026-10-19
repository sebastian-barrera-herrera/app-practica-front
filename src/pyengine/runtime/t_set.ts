/**
 * `set` y `frozenset`, con la misma disposición de tabla que CPython (el orden de iteración coincide para enteros).
 */
import { PyDict, PyList, PyObject, PySet, PyTuple, PyType } from './objects';
import { NotImplemented, frozenSetType, setType, typeOf } from './builtin_types';
import { keyError, typeError } from './errors';
import { E } from './exc_types';
import * as ops from './ops';
import { ckey } from './hash';
import { defMethods, mkNative } from './native';

const S = setType;
const FS = frozenSetType;
S.alloc = (cls) => new PySet(false, cls);
FS.alloc = (cls) => new PySet(true, cls);

function sa(x: any): PySet {
  if (x instanceof PySet) return x;
  throw typeError(`descriptor requires a 'set' object but received a '${typeOf(x).name}'`);
}

const ck = (x: any): any => (typeof x === 'string' ? x : ckey(x));

/** inserta con un hash ya conocido si el elemento no está */
function addHashed(s: PySet, h: number, key: any, val: any): void {
  if (s.m.has(key)) return;
  s.m.set(key, val);
  s.tbl.insert(h, key, val);
}

function makeLike(base: PySet, frozen = base.frozen): PySet {
  // resultado del tipo base (set o frozenset), no de la subclase
  return new PySet(frozen);
}

/** CPython `set_merge`: copia con la disposición de tabla original cuando es posible */
function setMerge(so: PySet, other: PySet): void {
  const t = so.tbl;
  const o = other.tbl;
  if (o.used === 0) return;
  if ((t.fill + o.used) * 5 >= t.mask * 3) t.resize((t.used + o.used) * 2);
  if (t.fill === 0 && t.mask === o.mask && o.fill === o.used) {
    t.cloneFrom(o);
    for (const [, key, val] of o.entries()) so.m.set(key, val);
    return;
  }
  if (t.fill === 0) {
    for (const [h, key, val] of o.entries()) {
      t.insertClean(h, key, val);
      so.m.set(key, val);
    }
    t.fill = o.used;
    t.used = o.used;
    return;
  }
  for (const [h, key, val] of o.entries()) addHashed(so, h, key, val);
}

function updateInternal(so: PySet, other: any): void {
  if (other instanceof PySet) {
    if (other === so) return;
    setMerge(so, other);
    return;
  }
  if (other instanceof PyDict) {
    const n = other.m.size;
    if ((so.tbl.fill + n) * 5 >= so.tbl.mask * 3) so.tbl.resize((so.tbl.used + n) * 2);
    for (const e of [...other.m.values()]) so.add(e.k);
    return;
  }
  const arr = other instanceof PyList || other instanceof PyTuple ? other.a : null;
  if (arr) {
    for (let i = 0; i < arr.length; i++) so.add(arr[i]);
    return;
  }
  const it = ops.getIter(other);
  for (;;) {
    const v = it.next();
    if (v === undefined) break;
    so.add(v);
  }
}

function copyOf(s: PySet, frozen = s.frozen): PySet {
  const r = makeLike(s, frozen);
  setMerge(r, s);
  return r;
}

function asSet(x: any): PySet {
  if (x instanceof PySet) return x;
  const r = new PySet(false);
  updateInternal(r, x);
  return r;
}

function union(a: PySet, others: any[]): PySet {
  const r = copyOf(a, a.frozen);
  for (const o of others) updateInternal(r, o);
  return r;
}

function intersection(a: PySet, other: any): PySet {
  const r = makeLike(a);
  if (other instanceof PySet) {
    let x = a;
    let y = other;
    if (y.size > x.size) [x, y] = [y, x];
    for (const [h, key, val] of y.tbl.entries()) if (x.m.has(key)) addHashed(r, h, key, val);
    return r;
  }
  const it = ops.getIter(other);
  for (;;) {
    const v = it.next();
    if (v === undefined) break;
    if (a.has(v)) r.add(v);
  }
  return r;
}

function difference(a: PySet, other: any): PySet {
  const osize = other instanceof PySet ? other.size : other instanceof PyDict ? other.size : -1;
  if (osize >= 0 && (osize >> 2) > a.size || osize < 0) {
    const r = copyOf(a);
    differenceUpdate(r, other);
    return r;
  }
  const r = makeLike(a);
  for (const [h, key, val] of a.tbl.entries()) {
    const inOther = other instanceof PySet ? other.m.has(key) : other.has(val);
    if (!inOther) addHashed(r, h, key, val);
  }
  return r;
}

function differenceUpdate(a: PySet, other: any): void {
  if (other === a) { a.clear(); return; }
  if (other instanceof PySet) {
    for (const [, key, val] of other.tbl.entries()) { if (a.m.has(key)) a.delete(val); }
    return;
  }
  const it = ops.getIter(other);
  for (;;) {
    const v = it.next();
    if (v === undefined) break;
    a.delete(v);
  }
}

function symDiffUpdate(a: PySet, other: PySet): void {
  if (other === a) { a.clear(); return; }
  for (const [, key, val] of other.tbl.entries()) {
    if (a.m.has(key)) a.delete(val);
    else a.add(val);
  }
}

function symDiff(a: PySet, other: any): PySet {
  const o = copyOfFrom(other, a.frozen);
  symDiffUpdate(o, a);
  return o;
}
function copyOfFrom(x: any, frozen: boolean): PySet {
  const r = new PySet(frozen);
  updateInternal(r, x);
  return r;
}

function isSubset(a: PySet, b: PySet): boolean {
  if (a.size > b.size) return false;
  for (const [, key] of a.tbl.entries()) if (!b.m.has(key)) return false;
  return true;
}

const reprGuard = new Set<any>();
function setRepr(s: PySet): string {
  const name = s.cls === setType ? '' : s.cls.name;
  const fz = s.frozen;
  if (s.size === 0) return s.cls === setType ? 'set()' : `${s.cls.name}()`;
  if (reprGuard.has(s)) return fz || s.cls !== setType ? `${s.cls.name}(...)` : '{...}';
  reprGuard.add(s);
  try {
    const body = '{' + s.items().map(ops.repr).join(', ') + '}';
    if (fz || name) return `${s.cls.name}(${body})`;
    return body;
  } finally {
    reprGuard.delete(s);
  }
}

const M64 = (1n << 64n) - 1n;
function shuffle(h: bigint): bigint {
  return (((h ^ 89869747n) ^ (h << 16n)) * 3644798167n) & M64;
}
function frozensetHash(s: PySet): number {
  let hash = 0n;
  for (const [h] of s.tbl.entries()) hash ^= shuffle(BigInt.asUintN(64, BigInt(Math.trunc(h))));
  const t = s.tbl;
  if (((t.mask + 1 - t.fill) & 1) !== 0) hash ^= shuffle(0n);
  if (((t.fill - t.used) & 1) !== 0) hash ^= shuffle(M64);
  hash ^= ((BigInt(s.size) + 1n) * 1927868237n) & M64;
  hash ^= (hash >> 11n) ^ (hash >> 25n);
  hash = (hash * 69069n + 907133923n) & M64;
  if (hash === M64) hash = 590923713n;
  return Number(BigInt.asIntN(64, hash));
}

function otherSet(b: any): PySet | undefined {
  return b instanceof PySet ? b : undefined;
}

function binop(name: string, f: (a: PySet, b: PySet) => PySet): [string, (a: any, b: any) => any] {
  return ['self, other', (a: any, b: any) => {
    const o = otherSet(b);
    if (o === undefined) return NotImplemented;
    const r = f(sa(a), o);
    return r;
  }];
  void name;
}

const common = {
  __repr__: ['self', (s: any) => setRepr(sa(s))],
  __len__: ['self', (s: any) => sa(s).size],
  __bool__: ['self', (s: any) => sa(s).size > 0],
  __contains__: ['self, x', (s: any, x: any) => {
    const st = sa(s);
    if (x instanceof PySet && !x.frozen) return st.has(copyOf(x, true));
    return st.has(x);
  }],
  __iter__: ['self', (s: any) => new ops.SetIter(sa(s))],
  __eq__: ['self, other', (a: any, b: any) => (b instanceof PySet ? sa(a).size === b.size && isSubset(sa(a), b) : NotImplemented)],
  __ne__: ['self, other', (a: any, b: any) => (b instanceof PySet ? !(sa(a).size === b.size && isSubset(sa(a), b)) : NotImplemented)],
  __le__: ['self, other', (a: any, b: any) => (b instanceof PySet ? isSubset(sa(a), b) : NotImplemented)],
  __lt__: ['self, other', (a: any, b: any) => (b instanceof PySet ? sa(a).size < b.size && isSubset(sa(a), b) : NotImplemented)],
  __ge__: ['self, other', (a: any, b: any) => (b instanceof PySet ? isSubset(b, sa(a)) : NotImplemented)],
  __gt__: ['self, other', (a: any, b: any) => (b instanceof PySet ? sa(a).size > b.size && isSubset(b, sa(a)) : NotImplemented)],
  __and__: binop('and', (a, b) => intersection(a, b)),
  __rand__: binop('and', (a, b) => intersection(b, a)),
  __or__: binop('or', (a, b) => union(a, [b])),
  __ror__: binop('or', (a, b) => union(b, [a])),
  __sub__: binop('sub', (a, b) => difference(a, b)),
  __rsub__: binop('sub', (a, b) => difference(b, a)),
  __xor__: binop('xor', (a, b) => symDiff(a, b)),
  __rxor__: binop('xor', (a, b) => symDiff(b, a)),
  __sizeof__: ['self', (s: any) => 200 + 8 * sa(s).tbl.keys.length],
  copy: ['self', (s: any) => {
    const st = sa(s);
    if (st.frozen && st.cls === frozenSetType) return st;
    return copyOf(st);
  }],
  union: ['self, *others', (s: any, others: any) => union(sa(s), others.a)],
  intersection: ['self, *others', (s: any, others: any) => {
    let r = sa(s);
    if (others.a.length === 0) return copyOf(r);
    for (const o of others.a) r = intersection(r, o);
    return r;
  }],
  difference: ['self, *others', (s: any, others: any) => {
    let r = sa(s);
    if (others.a.length === 0) return copyOf(r);
    for (const o of others.a) r = difference(r, o);
    return r;
  }],
  symmetric_difference: ['self, other', (s: any, o: any) => symDiff(sa(s), o)],
  issubset: ['self, other', (s: any, o: any) => isSubset(sa(s), asSet(o))],
  issuperset: ['self, other', (s: any, o: any) => {
    const b = asSet(o);
    return isSubset(b, sa(s));
  }],
  isdisjoint: ['self, other', (s: any, o: any) => {
    const st = sa(s);
    for (const v of ops.iterToArray(o)) if (st.has(v)) return false;
    return true;
  }],
} as Record<string, [string, (...a: any[]) => any]>;

defMethods(S, {
  ...common,
  __init__: ['self, iterable=', (s: any, it?: any) => {
    const st = sa(s);
    st.clear();
    if (it !== undefined) updateInternal(st, it);
    return null;
  }],
  __hash__: ['self', () => { throw typeError("unhashable type: 'set'"); }],
  __ior__: ['self, other', (a: any, b: any) => { if (!(b instanceof PySet)) return NotImplemented; updateInternal(sa(a), b); return a; }],
  __iand__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PySet)) return NotImplemented;
    const r = intersection(sa(a), b);
    sa(a).clear();
    setMerge(sa(a), r);
    return a;
  }],
  __isub__: ['self, other', (a: any, b: any) => { if (!(b instanceof PySet)) return NotImplemented; differenceUpdate(sa(a), b); return a; }],
  __ixor__: ['self, other', (a: any, b: any) => { if (!(b instanceof PySet)) return NotImplemented; symDiffUpdate(sa(a), b); return a; }],
  add: ['self, elem', (s: any, x: any) => { sa(s).add(x); return null; }],
  discard: ['self, elem', (s: any, x: any) => {
    const st = sa(s);
    if (x instanceof PySet && !x.frozen) { st.delete(copyOf(x, true)); return null; }
    st.delete(x);
    return null;
  }],
  remove: ['self, elem', (s: any, x: any) => {
    const st = sa(s);
    const key = x instanceof PySet && !x.frozen ? copyOf(x, true) : x;
    if (!st.delete(key)) throw keyError(x);
    return null;
  }],
  pop: ['self', (s: any) => {
    const st = sa(s);
    const items = st.items();
    if (items.length === 0) throw keyError('pop from an empty set');
    const x = items[0];
    st.delete(x);
    return x;
  }],
  clear: ['self', (s: any) => { sa(s).clear(); return null; }],
  update: ['self, *others', (s: any, others: any) => { for (const o of others.a) updateInternal(sa(s), o); return null; }],
  intersection_update: ['self, *others', (s: any, others: any) => {
    const st = sa(s);
    let r: PySet = st;
    for (const o of others.a) r = intersection(r, o);
    if (r !== st) { st.clear(); setMerge(st, r); }
    return null;
  }],
  difference_update: ['self, *others', (s: any, others: any) => { for (const o of others.a) differenceUpdate(sa(s), o); return null; }],
  symmetric_difference_update: ['self, other', (s: any, o: any) => { symDiffUpdate(sa(s), asSet(o)); return null; }],
});
S.dict!.set('__doc__', 'Build an unordered collection of unique elements.');

FS.dict!.set('__new__', mkNative('__new__', 'cls, iterable=', (cls: any, it?: any) => {
  if (cls === frozenSetType && it instanceof PySet && it.frozen && it.cls === frozenSetType) return it;
  const r = new PySet(true, cls);
  if (it !== undefined) updateInternal(r, it);
  return r;
}, { owner: 'frozenset' }));
defMethods(FS, {
  ...common,
  __hash__: ['self', (s: any) => {
    const st = sa(s);
    if (st.hash === undefined) st.hash = frozensetHash(st);
    return st.hash;
  }],
});

void [PyObject, PyType, E, ck];
export { updateInternal, setMerge, copyOf };
