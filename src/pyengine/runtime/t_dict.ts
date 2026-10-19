/**
 * `dict`, sus vistas (`keys()`, `values()`, `items()`) y `mappingproxy`.
 */
import { PyBox, PyDict, PyList, PyObject, PySet, PyTuple, PyType, PyClassMethod, type DEntry } from './objects';
import {
  NotImplemented, classMethodType, dictItemsType, dictKeysType, dictType, dictValuesType, mappingProxyType, typeOf,
} from './builtin_types';
import { keyError, makeExc, typeError, valueError } from './errors';
import { E } from './exc_types';
import { callObj } from './call';
import * as ops from './ops';
import { defMethods, mkNative } from './native';
import { kwMap } from './util';
import { ckey } from './hash';

const D = dictType;
D.alloc = (cls) => new PyDict(cls);

const reprGuard = new Set<any>();

function da(x: any): PyDict {
  if (x instanceof PyDict) return x;
  throw typeError(`descriptor requires a 'dict' object but received a '${typeOf(x).name}'`);
}

/** d.update(other) con la semántica de CPython (mapping con keys(), o iterable de pares) */
export function dictUpdate(d: PyDict, other: any, label = 'dict'): void {
  if (other instanceof PyDict) {
    if (other === d) return;
    for (const e of [...other.m.values()]) d.set(e.k, e.v);
    return;
  }
  const t = typeOf(other);
  const keys = t.lookup('keys');
  if (keys !== undefined) {
    for (const k of ops.iterToArray(callObj(keys, [other]))) d.set(k, ops.getitem(other, k));
    return;
  }
  let i = 0;
  const it = ops.getIter(other);
  for (;;) {
    const item = it.next();
    if (item === undefined) break;
    let pair: any[];
    try {
      pair = item instanceof PyTuple || item instanceof PyList ? item.a : ops.iterToArray(item);
    } catch (e) {
      if (e instanceof Error) throw e;
      throw typeError(`cannot convert dictionary update sequence element #${i} to a sequence`);
    }
    if (pair.length !== 2) throw valueError(`dictionary update sequence element #${i} has length ${pair.length}; 2 is required`);
    d.set(pair[0], pair[1]);
    i++;
  }
  void label;
}

D.dict!.set('__init__', mkNative('__init__', 'self, *args, **kwargs', (self: any, args: any, kw: any) => {
  const a = args instanceof PyTuple ? args.a : [];
  if (a.length > 1) throw typeError(`dict expected at most 1 argument, got ${a.length}`);
  const d = self as PyDict;
  if (a.length === 1) dictUpdate(d, a[0]);
  if (kw instanceof PyDict) for (const e of kw.m.values()) d.set(e.k, e.v);
  return null;
}, { method: true, owner: 'dict' }));

function dictLookup(d: PyDict, k: any): DEntry | undefined {
  return d.m.get(typeof k === 'string' ? k : ckey(k));
}

class DictView extends PyObject {
  constructor(cls: PyType, public d: PyDict) {
    super(cls);
  }
}

function viewItems(v: DictView): any[] {
  const out: any[] = [];
  const kind = v.cls === dictKeysType ? 0 : v.cls === dictValuesType ? 1 : 2;
  for (const e of v.d.m.values()) out.push(kind === 0 ? e.k : kind === 1 ? e.v : new PyTuple([e.k, e.v]));
  return out;
}

defMethods(D, {
  __repr__: ['self', (d: any) => {
    const x = da(d);
    if (reprGuard.has(x)) return '{...}';
    reprGuard.add(x);
    try {
      const parts: string[] = [];
      for (const e of x.m.values()) parts.push(ops.repr(e.k) + ': ' + ops.repr(e.v));
      return '{' + parts.join(', ') + '}';
    } finally {
      reprGuard.delete(x);
    }
  }],
  __len__: ['self', (d: any) => da(d).m.size],
  __bool__: ['self', (d: any) => da(d).m.size > 0],
  __contains__: ['self, key', (d: any, k: any) => da(d).has(k)],
  __iter__: ['self', (d: any) => new ops.DictIter(da(d), 0)],
  __reversed__: ['self', (d: any) => {
    const keys = da(d).keys().reverse();
    return new ops.ListIter(new PyList(keys));
  }],
  __getitem__: ['self, key', (d: any, k: any) => {
    const x = da(d);
    const e = dictLookup(x, k);
    if (e !== undefined) return e.v;
    if (x.cls !== dictType) {
      const miss = x.cls.lookup('__missing__');
      if (miss !== undefined) return callObj(miss, [x, k]);
    }
    throw keyError(k);
  }],
  __setitem__: ['self, key, value', (d: any, k: any, v: any) => { da(d).set(k, v); return null; }],
  __delitem__: ['self, key', (d: any, k: any) => {
    if (!da(d).delete(k)) throw keyError(k);
    return null;
  }],
  __eq__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyDict)) return NotImplemented;
    const x = da(a);
    if (x.m.size !== b.m.size) return false;
    for (const e of x.m.values()) {
      const o = dictLookup(b, e.k);
      if (o === undefined) return false;
      if (o.v !== e.v && !ops.eqOp(e.v, o.v)) return false;
    }
    return true;
  }],
  __ne__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyDict)) return NotImplemented;
    const r = callObj(D.lookup('__eq__'), [a, b]);
    return !r;
  }],
  __or__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyDict)) return NotImplemented;
    const r = new PyDict();
    da(a).copyInto(r);
    dictUpdate(r, b);
    return r;
  }],
  __ror__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyDict)) return NotImplemented;
    const r = new PyDict();
    b.copyInto(r);
    dictUpdate(r, a);
    return r;
  }],
  __ior__: ['self, other', (a: any, b: any) => {
    dictUpdate(da(a), b);
    return a;
  }],
  __sizeof__: ['self', (d: any) => 64 + 24 * da(d).m.size],
  keys: ['self', (d: any) => new DictView(dictKeysType, da(d))],
  values: ['self', (d: any) => new DictView(dictValuesType, da(d))],
  items: ['self', (d: any) => new DictView(dictItemsType, da(d))],
  get: ['self, key, default=', (d: any, k: any, dflt?: any) => {
    const e = dictLookup(da(d), k);
    return e !== undefined ? e.v : dflt === undefined ? null : dflt;
  }],
  setdefault: ['self, key, default=', (d: any, k: any, dflt?: any) => {
    const x = da(d);
    const e = dictLookup(x, k);
    if (e !== undefined) return e.v;
    const v = dflt === undefined ? null : dflt;
    x.set(k, v);
    return v;
  }],
  pop: ['self, key, default=', (d: any, k: any, dflt?: any) => {
    const x = da(d);
    const e = dictLookup(x, k);
    if (e !== undefined) {
      x.delete(k);
      return e.v;
    }
    if (dflt === undefined) throw keyError(k);
    return dflt;
  }],
  popitem: ['self', (d: any) => {
    const x = da(d);
    if (x.m.size === 0) throw makeExc(E.KeyError, ['popitem(): dictionary is empty']);
    let last: DEntry | undefined;
    for (const e of x.m.values()) last = e;
    x.delete(last!.k);
    return new PyTuple([last!.k, last!.v]);
  }],
  update: ['self, *args, **kwargs', (d: any, args: any, kw: any) => {
    const a = args instanceof PyTuple ? args.a : [];
    if (a.length > 1) throw typeError(`update expected at most 1 argument, got ${a.length}`);
    const x = da(d);
    if (a.length === 1) dictUpdate(x, a[0]);
    if (kw instanceof PyDict) for (const e of kw.m.values()) x.set(e.k, e.v);
    return null;
  }],
  clear: ['self', (d: any) => { da(d).clear(); return null; }],
  copy: ['self', (d: any) => {
    const r = new PyDict();
    da(d).copyInto(r);
    return r;
  }],
});
D.dict!.set('__hash__', null);
D.dict!.set('fromkeys', new PyClassMethod(classMethodType, mkNative('fromkeys', 'cls, iterable, value=', (cls: any, it: any, v?: any) => {
  const r = cls === dictType ? new PyDict() : ops.typeCall(cls, [], null);
  const val = v === undefined ? null : v;
  for (const k of ops.iterToArray(it)) ops.setitem(r, k, val);
  return r;
}, { owner: 'dict' })));
D.dict!.set('__doc__', "dict() -> new empty dictionary");

// ───────────────────────── vistas ─────────────────────────

const VIEW_NAMES = new Map<PyType, string>([[dictKeysType, 'dict_keys'], [dictValuesType, 'dict_values'], [dictItemsType, 'dict_items']]);

function viewRepr(v: any): string {
  const items = viewItems(v);
  return `${VIEW_NAMES.get(v.cls)}([${items.map(ops.repr).join(', ')}])`;
}

function viewContains(v: DictView, x: any): boolean {
  if (v.cls === dictKeysType) return v.d.has(x);
  if (v.cls === dictItemsType) {
    if (!(x instanceof PyTuple) || x.a.length !== 2) return false;
    const e = dictLookup(v.d, x.a[0]);
    return e !== undefined && (e.v === x.a[1] || ops.eqOp(e.v, x.a[1]));
  }
  for (const e of v.d.m.values()) if (e.v === x || ops.eqOp(e.v, x)) return true;
  return false;
}

function asSetLike(x: any): PySet | undefined {
  if (x instanceof PySet) return x;
  if (x instanceof DictView && x.cls !== dictValuesType) {
    const s = new PySet(false);
    for (const i of viewItems(x)) s.add(i);
    return s;
  }
  return undefined;
}

function setOpOnViews(op: string, a: any, b: any): any {
  const x = asSetLike(a);
  let y = asSetLike(b);
  if (x === undefined) return NotImplemented;
  if (y === undefined) {
    if (b instanceof PyObject && typeOf(b).lookup('__iter__') !== undefined) {
      y = new PySet(false);
      for (const i of ops.iterToArray(b)) y.add(i);
    } else return NotImplemented;
  }
  const out = new PySet(false);
  if (op === '&') for (const i of x.items()) { if (y.has(i)) out.add(i); }
  else if (op === '|') { for (const i of x.items()) out.add(i); for (const i of y.items()) out.add(i); }
  else if (op === '-') { for (const i of x.items()) if (!y.has(i)) out.add(i); }
  else { for (const i of x.items()) if (!y.has(i)) out.add(i); for (const i of y.items()) if (!x.has(i)) out.add(i); }
  return out;
}

for (const t of [dictKeysType, dictValuesType, dictItemsType]) {
  defMethods(t, {
    __repr__: ['self', viewRepr],
    __len__: ['self', (v: any) => v.d.m.size],
    __bool__: ['self', (v: any) => v.d.m.size > 0],
    __iter__: ['self', (v: any) => new ops.DictIter(v.d, v.cls === dictKeysType ? 0 : v.cls === dictValuesType ? 1 : 2)],
    __reversed__: ['self', (v: any) => new ops.ListIter(new PyList(viewItems(v).reverse()))],
    __contains__: ['self, x', (v: any, x: any) => viewContains(v, x)],
  });
}
for (const t of [dictKeysType, dictItemsType]) {
  defMethods(t, {
    __and__: ['self, other', (a: any, b: any) => setOpOnViews('&', a, b)],
    __rand__: ['self, other', (a: any, b: any) => setOpOnViews('&', b, a)],
    __or__: ['self, other', (a: any, b: any) => setOpOnViews('|', a, b)],
    __ror__: ['self, other', (a: any, b: any) => setOpOnViews('|', b, a)],
    __sub__: ['self, other', (a: any, b: any) => setOpOnViews('-', a, b)],
    __rsub__: ['self, other', (a: any, b: any) => setOpOnViews('-', b, a)],
    __xor__: ['self, other', (a: any, b: any) => setOpOnViews('^', a, b)],
    __rxor__: ['self, other', (a: any, b: any) => setOpOnViews('^', b, a)],
    __eq__: ['self, other', (a: any, b: any) => {
      const x = asSetLike(a);
      const y = asSetLike(b);
      if (!x || !y) return NotImplemented;
      if (x.size !== y.size) return false;
      return x.items().every((i: any) => y.has(i));
    }],
    isdisjoint: ['self, other', (a: any, b: any) => {
      const y = ops.iterToArray(b);
      return !y.some((i: any) => viewContains(a, i));
    }],
  });
}
dictKeysType.dict!.set('__hash__', null);
dictItemsType.dict!.set('__hash__', null);
dictValuesType.dict!.set('__hash__', null);
for (const t of [dictKeysType, dictValuesType, dictItemsType]) {
  defMethods(t, {
    __class_getitem__: ['cls, item', (c: any) => c],
  });
}
{
  const mk = (t: PyType) => defMethods(t, {
    mapping: ['self', (v: any) => { const mp = new PyObject(mappingProxyType); (mp as any).target = v.d; return mp; }],
  });
  void mk;
}

// ───────────────────────── mappingproxy ─────────────────────────

const tgt = (x: any): PyDict => (x as any).target as PyDict;
defMethods(mappingProxyType, {
  __repr__: ['self', (m: any) => `mappingproxy(${ops.repr(tgt(m))})`],
  __len__: ['self', (m: any) => tgt(m).m.size],
  __contains__: ['self, k', (m: any, k: any) => tgt(m).has(k)],
  __iter__: ['self', (m: any) => new ops.DictIter(tgt(m), 0)],
  __getitem__: ['self, k', (m: any, k: any) => {
    const e = dictLookup(tgt(m), k);
    if (e === undefined) throw keyError(k);
    return e.v;
  }],
  get: ['self, key, default=', (m: any, k: any, d?: any) => {
    const e = dictLookup(tgt(m), k);
    return e !== undefined ? e.v : d === undefined ? null : d;
  }],
  keys: ['self', (m: any) => new DictView(dictKeysType, tgt(m))],
  values: ['self', (m: any) => new DictView(dictValuesType, tgt(m))],
  items: ['self', (m: any) => new DictView(dictItemsType, tgt(m))],
  copy: ['self', (m: any) => { const r = new PyDict(); tgt(m).copyInto(r); return r; }],
  __eq__: ['self, other', (a: any, b: any) => ops.richCompare('==', tgt(a), b instanceof PyObject && b.cls === mappingProxyType ? tgt(b) : b)],
});

void [PyBox, queueMicrotask];
export { DictView, dictLookup, viewItems };
