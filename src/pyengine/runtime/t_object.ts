/**
 * `object`, `type`, `NoneType`, `NotImplemented`, `Ellipsis`, uniones (`int | str`) y alias genéricos (`list[int]`).
 */
import {
  BoundMethod, Cell, F_BASETYPE, F_BUILTIN, F_HEAP, F_INSTDICT, NativeFunction, PyBaseException, PyBox, PyClassMethod, PyDict, PyFunction,
  PyList, PyModule, PyObject, PyProperty, PySet, PyStaticMethod, PyTuple, PyType, bumpTypeVersion, type Kw,
} from './objects';
import {
  Ellipsis, NotImplemented, boundMethodType, classMethodType, dictType, ellipsisType, genericAliasType, mappingProxyType, noneType,
  notImplementedType, objectType, propertyType, staticMethodType, typeOf, typeType, unionType, listType, tupleType, setType, frozenSetType,
} from './builtin_types';
import { E } from './exc_types';
import { attributeError, makeExc, typeError, valueError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { OBJECT_EQ, OBJECT_HASH } from './hash';
import { interp } from './state';
import { defGetter, defMethods, fn as nativeFn, mkNative } from './native';
import { asStr, kwMap, mapToDict, tupleArr } from './util';
import { strRepr } from './fmt';

const O = objectType;
const T = typeType;

// ───────────────────────── object ─────────────────────────

function excessArgs(args: any[], kw: any): boolean {
  return args.length > 0 || (kw instanceof PyDict && kw.size > 0);
}

const objectNew = mkNative('__new__', 'cls, *args, **kw', (cls: any, args: any, kw: any) => {
  if (!(cls instanceof PyType)) throw typeError(`object.__new__(X): X is not a type object (${typeOf(cls).name})`);
  const a = tupleArr(args);
  if (excessArgs(a, kw)) {
    if (cls.lookup('__new__') !== objectNew) throw typeError('object.__new__() takes exactly one argument (the type to instantiate)');
    if (cls.lookup('__init__') === objectInit) throw typeError(`${cls.name}() takes no arguments`);
  }
  const am = cls.dict!.m.get('__abstractmethods__');
  if (am !== undefined && am.v instanceof PySet && am.v.size > 0) {
    // mismo mensaje que typeCall
    return ops.typeCall(cls, [], null);
  }
  return ops.newObject(cls);
}, { owner: 'object' });
ops.OBJECT_NEW.f = objectNew;

const objectInit = mkNative('__init__', 'self, *args, **kw', (self: any, args: any, kw: any) => {
  const a = tupleArr(args);
  if (excessArgs(a, kw)) {
    const t = typeOf(self);
    if (t.lookup('__init__') !== objectInit) throw typeError('object.__init__() takes exactly one argument (the instance to initialize)');
    if (t.lookup('__new__') === objectNew) throw typeError(`${t.name}() takes no arguments`);
  }
  return null;
}, { method: true, owner: 'object' });
ops.OBJECT_INIT.f = objectInit;

function objectRepr(self: any): string {
  const t = typeOf(self);
  const mod = t.module;
  const I = interp();
  const q = t.qualname;
  const name = mod === 'builtins' ? q : `${mod}.${q}`;
  return `<${name} object at ${I.hexId(self)}>`;
}

const objectStr = mkNative('__str__', 'self', (self: any) => ops.repr(self), { method: true, owner: 'object' });
ops.OBJECT_STR.f = objectStr;

const objectEq = mkNative('__eq__', 'self, other', (a: any, b: any) => (a === b ? true : NotImplemented), { method: true, owner: 'object' });
OBJECT_EQ.f = objectEq;
const objectHash = mkNative('__hash__', 'self', (a: any) => {
  const id = interp().idOf(a);
  return Math.floor(id / 16) % 2305843009213693951;
}, { method: true, owner: 'object' });
OBJECT_HASH.f = objectHash;

function genericGetattribute(o: any, name: any): any {
  const n = asStr(name, 'attribute name');
  const v = ops.getAttrOpt(o, n);
  if (v === undefined) throw ops.attrError(o, n);
  return v;
}

function dirOf(o: any): string[] {
  const names = new Set<string>();
  const t = typeOf(o);
  if (o instanceof PyObject && o.dict) for (const k of o.dict.keys()) if (typeof k === 'string') names.add(k);
  if (o instanceof PyType) {
    for (const b of o.mro) for (const k of b.dict!.keys()) if (typeof k === 'string') names.add(k);
  } else {
    for (const b of t.mro) for (const k of b.dict!.keys()) if (typeof k === 'string') names.add(k);
  }
  return [...names];
}

defMethods(O, {
  __repr__: ['self', objectRepr],
  __ne__: ['self, other', (a: any, b: any) => {
    const f = typeOf(a).lookup('__eq__');
    const r = callObj(f, [a, b]);
    if (r === NotImplemented) return r;
    return !ops.truthy(r);
  }],
  __lt__: ['self, other', () => NotImplemented],
  __le__: ['self, other', () => NotImplemented],
  __gt__: ['self, other', () => NotImplemented],
  __ge__: ['self, other', () => NotImplemented],
  __format__: ['self, spec', (self: any, spec: any) => {
    const s = asStr(spec, 'format_spec');
    if (s !== '') throw typeError(`unsupported format string passed to ${typeOf(self).name}.__format__`);
    return ops.str(self);
  }],
  __getattribute__: ['self, name', genericGetattribute],
  __setattr__: ['self, name, value', (o: any, name: any, v: any) => { ops.genericSetAttr(o, asStr(name, 'attribute name'), v); return null; }],
  __delattr__: ['self, name', (o: any, name: any) => { ops.genericDelAttr(o, asStr(name, 'attribute name')); return null; }],
  __dir__: ['self', (o: any) => new PyList(dirOf(o))],
  __sizeof__: ['self', () => 16],
  __getstate__: ['self', (o: any) => (o instanceof PyObject && o.dict && o.dict.size > 0 ? o.dict : null)],
  __reduce_ex__: ['self, protocol=', (o: any) => objectReduce(o)],
  __reduce__: ['self', (o: any) => objectReduce(o)],
});
O.dict!.set('__new__', objectNew);
O.dict!.set('__init__', objectInit);
O.dict!.set('__str__', objectStr);
O.dict!.set('__eq__', objectEq);
O.dict!.set('__hash__', objectHash);
O.dict!.set('__doc__', 'The base class of the class hierarchy.');
O.dict!.set(
  '__init_subclass__',
  new PyClassMethod(classMethodType, mkNative('__init_subclass__', 'cls, **kw', (cls: any, kw: any) => {
    if (kw instanceof PyDict && kw.size > 0) throw typeError(`${cls.name}.__init_subclass__() takes no keyword arguments`);
    return null;
  }, { owner: 'object' })),
);
O.dict!.set(
  '__subclasshook__',
  new PyClassMethod(classMethodType, mkNative('__subclasshook__', 'cls, subclass', () => NotImplemented, { owner: 'object' })),
);

function objectReduce(o: any): any {
  // copyreg.__newobj__ simplificado: (callable, args, state)
  const cls = typeOf(o);
  const state = o instanceof PyObject && o.dict && o.dict.size > 0 ? o.dict : null;
  const rec = mkNative('__newobj__', 'cls', (c: any) => ops.newObject(c));
  return new PyTuple([rec, new PyTuple([cls]), state]);
}

const classProp = new PyProperty(propertyType);
classProp.fget = mkNative('__class__', 'self', (o: any) => {
  if (o instanceof PyObject && o.dict && o.dict.get('__class__') instanceof PyType && false) return o.dict.get('__class__');
  return typeOf(o);
}, { method: true });
classProp.fset = mkNative('__class__', 'self, value', (o: any, v: any) => {
  if (!(v instanceof PyType)) throw typeError(`__class__ must be set to a class, not '${typeOf(v).name}' object`);
  const old = typeOf(o);
  if (!(o instanceof PyObject) || (old.flags & F_BUILTIN && !(old === objectType)) || (v.flags & F_BUILTIN)) {
    throw typeError(`__class__ assignment only supported for mutable types or ModuleType subclasses`);
  }
  o.cls = v;
  return null;
}, { method: true });
classProp.name = '__class__';
O.dict!.set('__class__', classProp);

// `__dict__` de instancias
const dictProp = new PyProperty(classProp.cls);
dictProp.name = '__dict__';
dictProp.fget = mkNative('__dict__', 'self', (o: any) => {
  if (o instanceof PyObject && (typeOf(o).instDict || o.dict !== null)) {
    if (o.dict === null) o.dict = new PyDict();
    return o.dict;
  }
  throw attributeError(`'${typeOf(o).name}' object has no attribute '__dict__'`, '__dict__', o);
}, { method: true });
dictProp.fset = mkNative('__dict__', 'self, value', (o: any, v: any) => {
  if (!(v instanceof PyDict)) throw typeError(`__dict__ must be set to a dictionary, not a '${typeOf(v).name}'`);
  if (!(o instanceof PyObject)) throw attributeError(`'${typeOf(o).name}' object has no attribute '__dict__'`);
  o.dict = v;
  return null;
}, { method: true });

dictProp.owner = O;
O.dict!.set('__dict__', dictProp);

// ───────────────────────── type ─────────────────────────

const SPECIAL_ATTRS = new Set(['__getattr__', '__getattribute__', '__setattr__', '__delattr__', '__slots__']);

function typeRepr(t: PyType): string {
  const mod = t.dict!.get('__module__');
  const m = typeof mod === 'string' ? mod : t.module;
  const kind = 'class';
  return m === 'builtins' ? `<${kind} '${t.qualname}'>` : `<${kind} '${m}.${t.qualname}'>`;
}

function typeGetattro(o: any, name: string): any {
  const t = o as PyType;
  const meta = t.cls;
  const metaAttr = meta.lookup(name);
  if (metaAttr !== undefined) {
    const isData = metaAttr instanceof PyProperty || (metaAttr instanceof PyObject && !(metaAttr instanceof NativeFunction) && !(metaAttr instanceof PyFunction) && metaAttr.cls.lookup('__set__') !== undefined);
    if (isData) return ops.descrGet(metaAttr, t, meta);
  }
  const attr = t.lookup(name);
  if (attr !== undefined) return ops.descrGet(attr, undefined, t);
  if (metaAttr !== undefined) return ops.descrGet(metaAttr, t, meta);
  return undefined;
}

function recomputeSubtree(t: PyType): void {
  t.computeMro();
  for (const s of t.subclasses) recomputeSubtree(s);
}

function typeSetattro(o: any, name: string, v: any): void {
  const t = o as PyType;
  if (t.flags & F_BUILTIN) throw typeError(`cannot set '${name}' attribute of immutable type '${t.name}'`);
  // descriptores de datos de la metaclase
  const ma = t.cls.lookup(name);
  if (ma instanceof PyProperty) {
    if (ma.fset === null) throw attributeError(`attribute '${name}' of '${t.cls.name}' objects is not writable`);
    callObj(ma.fset, [t, v]);
    return;
  }
  if (name === '__eq__' && !t.dict!.has('__hash__')) { /* CPython no recalcula __hash__ aquí */ }
  t.dict!.set(name, v);
  bumpTypeVersion();
  if (SPECIAL_ATTRS.has(name)) recomputeSubtree(t);
  // __set_name__ no se llama al asignar después de crear la clase (igual que CPython)
}

function typeDelattro(o: any, name: string): void {
  const t = o as PyType;
  if (t.flags & F_BUILTIN) throw typeError(`cannot delete '${name}' attribute of immutable type '${t.name}'`);
  if (!t.dict!.delete(name)) throw attributeError(`type object '${t.name}' has no attribute '${name}'`, name, t);
  bumpTypeVersion();
  if (SPECIAL_ATTRS.has(name)) recomputeSubtree(t);
}

T.ownGetattro = typeGetattro;
T.ownSetattro = typeSetattro;
T.ownDelattro = typeDelattro;
T.computeMro();

function mroErrorMsg(bases: PyType[]): string {
  return 'Cannot create a consistent method resolution order (MRO) for bases ' + bases.map((b) => b.name).join(', ');
}

function winnerMeta(meta: PyType, bases: PyType[]): PyType {
  let winner = meta;
  for (const b of bases) {
    const bt = b.cls;
    if (winner.isSubtype(bt)) continue;
    if (bt.isSubtype(winner)) { winner = bt; continue; }
    throw typeError('metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases');
  }
  return winner;
}

function typeNew(metaArg: any, name: any, basesArg: any, nsArg: any, kwArg: any): any {
  const meta = metaArg as PyType;
  const kw = kwMap(kwArg);
  if (basesArg === undefined) {
    throw typeError('type() takes 1 or 3 arguments');
  }
  if (typeof name !== 'string' && !(name instanceof PyBox && typeof name.value === 'string')) {
    throw typeError(`type.__new__() argument 1 must be str, not ${typeOf(name).name}`);
  }
  const nm = asStr(name);
  if (!(basesArg instanceof PyTuple)) throw typeError(`type.__new__() argument 2 must be tuple, not ${typeOf(basesArg).name}`);
  if (!(nsArg instanceof PyDict)) throw typeError(`type.__new__() argument 3 must be dict, not ${typeOf(nsArg).name}`);
  let bases: PyType[] = [];
  for (const b of basesArg.a) {
    if (!(b instanceof PyType)) throw typeError('bases must be types');
    bases.push(b);
  }
  // metaclase ganadora
  const winner = winnerMeta(meta, bases);
  if (winner !== meta) {
    const nf = winner.lookup('__new__');
    if (nf !== undefined && nf !== typeNewFn) {
      const args: any[] = [winner, name, basesArg, nsArg];
      return callObj(nf instanceof PyStaticMethod ? nf.fn : nf, args, kw);
    }
  }
  if (bases.length === 0) bases = [objectType];
  for (const b of bases) {
    if (!(b.flags & F_BASETYPE)) throw typeError(`type '${b.name}' is not an acceptable base type`);
  }
  const ns = nsArg;
  const t = new PyType(nm, bases, undefined, winner);
  t.flags = F_HEAP | F_BASETYPE;
  // copia el espacio de nombres
  const slotsV = ns.get('__slots__');
  for (const e of ns.m.values()) {
    const k = e.k;
    if (typeof k !== 'string') continue;
    if (k === '__qualname__' || k === '__classcell__') continue;
    t.dict!.set(k, e.v);
  }
  const qn = ns.get('__qualname__');
  t.qualname = typeof qn === 'string' ? qn : nm;
  const mod = ns.get('__module__');
  if (typeof mod === 'string') t.module = mod;
  else {
    const f = interp().frame;
    const gm = f ? f.g.get('__name__') : undefined;
    t.module = typeof gm === 'string' ? gm : '__main__';
    t.dict!.set('__module__', t.module);
  }
  if (!t.dict!.has('__doc__')) t.dict!.set('__doc__', null);
  // __slots__
  if (slotsV !== undefined) {
    const names: string[] = [];
    if (typeof slotsV === 'string') names.push(slotsV);
    else for (const s of ops.iterToArray(slotsV)) names.push(asStr(s, '__slots__ items'));
    t.ownSlots = new Set(names);
  }
  // métodos estáticos implícitos
  const nw = t.dict!.get('__new__');
  if (nw instanceof PyFunction) t.dict!.set('__new__', new PyStaticMethod(staticMethodType, nw));
  const ics = t.dict!.get('__init_subclass__');
  if (ics instanceof PyFunction) t.dict!.set('__init_subclass__', new PyClassMethod(classMethodType, ics));
  const cgi = t.dict!.get('__class_getitem__');
  if (cgi instanceof PyFunction) t.dict!.set('__class_getitem__', new PyClassMethod(classMethodType, cgi));
  // __eq__ sin __hash__ ⇒ no hashable
  if (t.dict!.has('__eq__') && !t.dict!.has('__hash__')) t.dict!.set('__hash__', null);
  try {
    t.computeMro();
  } catch (e) {
    if ((e as any).mroError !== undefined) throw typeError(mroErrorMsg(bases));
    throw e;
  }
  // layout: no se pueden combinar dos tipos nativos con disposición distinta
  for (const b of bases) b.subclasses.push(t);
  if (t.slots !== null || t.ownSlots) { /* instDict calculado en computeMro */ }
  // __classcell__
  const cc = ns.get('__classcell__');
  if (cc instanceof Cell) cc.v = t;
  // __set_name__
  for (const e of [...t.dict!.m.values()]) {
    const v = e.v;
    if (v instanceof PyObject && !(v instanceof PyType) && !(v instanceof PyFunction) && !(v instanceof NativeFunction)) {
      const sn = v.cls.lookup('__set_name__');
      if (sn !== undefined) {
        try {
          callObj(sn, [v, t, e.k]);
        } catch (err) {
          if (err instanceof PyBaseException) {
            const msg = `Error calling __set_name__ on '${typeOf(v).name}' instance '${String(e.k)}' in '${t.name}'`;
            (err.notes ??= []).push(msg);
          }
          throw err;
        }
      }
    }
  }
  // __init_subclass__
  const sup = findInitSubclass(t);
  if (sup !== undefined) {
    callObj(sup, [], kw ? new Map(kw) : null);
  }
  return t;
}

function findInitSubclass(t: PyType): any {
  for (let i = 1; i < t.mro.length; i++) {
    const e = t.mro[i].dict!.m.get('__init_subclass__');
    if (e !== undefined) {
      const d = e.v;
      if (d instanceof PyClassMethod) return new BoundMethod(boundMethodType, d.fn, t);
      return d;
    }
  }
  return undefined;
}

const typeNewFn = mkNative('__new__', 'meta, name, bases=, ns=, **kw', typeNew, { owner: 'type' });
T.dict!.set('__new__', typeNewFn);
T.dict!.set('__init__', mkNative('__init__', 'self, *args, **kw', () => null, { method: true, owner: 'type' }));
const typeCallFn = mkNative('__call__', 'self, *args, **kw', (self: any, args: any, kw: any) => ops.typeCall(self, [...tupleArr(args)], kwMap(kw), true), { method: true, owner: 'type' });
T.dict!.set('__call__', typeCallFn);
ops.TYPE_CALL.f = typeCallFn;

const tInst = mkNative('__instancecheck__', 'self, instance', (self: any, x: any) => {
  const t = typeOf(x);
  if (t.isSubtype(self)) return true;
  if (x instanceof PyObject && x.dict) {
    const cc = x.dict.get('__class__');
    if (cc instanceof PyType) return cc.isSubtype(self);
  }
  return false;
}, { method: true, owner: 'type' });
const tSub = mkNative('__subclasscheck__', 'self, subclass', (self: any, c: any) => {
  if (!(c instanceof PyType)) throw typeError('issubclass() arg 1 must be a class');
  return c.isSubtype(self);
}, { method: true, owner: 'type' });
T.dict!.set('__instancecheck__', tInst);
T.dict!.set('__subclasscheck__', tSub);
ops.TYPE_INSTANCECHECK.f = tInst;
ops.TYPE_SUBCLASSCHECK.f = tSub;

defMethods(T, {
  __repr__: ['self', typeRepr],
  mro: ['self', (t: any) => new PyList(t.mro.slice())],
  __subclasses__: ['self', (t: any) => new PyList(t.subclasses.slice())],
  __dir__: ['self', (t: any) => new PyList(dirOf(t))],
  __sizeof__: ['self', () => 900],
  __or__: ['self, other', (a: any, b: any) => makeUnion(a, b)],
  __ror__: ['self, other', (a: any, b: any) => makeUnion(b, a)],
});
T.dict!.set('__prepare__', new PyClassMethod(classMethodType, mkNative('__prepare__', 'cls, name, bases, **kw', () => new PyDict(), { owner: 'type' })));

const propT = classProp.cls;
function tprop(name: string, get: (t: PyType) => any, set?: (t: PyType, v: any) => void): void {
  const p = new PyProperty(propT);
  p.name = name;
  p.fget = mkNative(name, 'self', get, { method: true });
  if (set) p.fset = mkNative(name, 'self, value', (t: any, v: any) => { set(t, v); return null; }, { method: true });
  p.owner = T;
  T.dict!.set(name, p);
}
tprop('__name__', (t) => t.name, (t, v) => {
  if (t.flags & F_BUILTIN) throw typeError(`cannot set '__name__' attribute of immutable type '${t.name}'`);
  if (typeof v !== 'string') throw typeError(`can only assign string to ${t.name}.__name__, not '${typeOf(v).name}'`);
  t.name = v;
});
tprop('__qualname__', (t) => t.qualname, (t, v) => {
  if (t.flags & F_BUILTIN) throw typeError(`cannot set '__qualname__' attribute of immutable type '${t.name}'`);
  if (typeof v !== 'string') throw typeError(`can only assign string to ${t.name}.__qualname__, not '${typeOf(v).name}'`);
  t.qualname = v;
});
tprop('__module__', (t) => {
  const m = t.dict!.get('__module__');
  return m !== undefined ? m : t.module;
}, (t, v) => { t.dict!.set('__module__', v); t.module = typeof v === 'string' ? v : t.module; bumpTypeVersion(); });
tprop('__bases__', (t) => new PyTuple(t.bases.slice()), (t, v) => {
  if (t.flags & F_BUILTIN) throw typeError(`cannot set '__bases__' attribute of immutable type '${t.name}'`);
  if (!(v instanceof PyTuple)) throw typeError(`can only assign tuple to ${t.name}.__bases__, not ${typeOf(v).name}`);
  if (v.a.length === 0) throw typeError(`can only assign non-empty tuple to ${t.name}.__bases__, not ()`);
  for (const b of v.a) {
    if (!(b instanceof PyType)) throw typeError(`${t.name}.__bases__ must be tuple of classes, not '${typeOf(b).name}'`);
    if (b.isSubtype(t)) throw typeError('a __bases__ item causes an inheritance cycle');
  }
  const old = t.bases;
  for (const b of old) { const i = b.subclasses.indexOf(t); if (i >= 0) b.subclasses.splice(i, 1); }
  t.bases = v.a.slice();
  try { recomputeSubtree(t); } catch (e) {
    t.bases = old;
    for (const b of old) b.subclasses.push(t);
    recomputeSubtree(t);
    throw e;
  }
  for (const b of t.bases) b.subclasses.push(t);
  bumpTypeVersion();
});
tprop('__base__', (t) => (t.bases.length ? t.mro[1] ?? null : null));
tprop('__mro__', (t) => new PyTuple(t.mro.slice()));
tprop('__dict__', (t) => {
  const mp = new PyObject(mappingProxyType);
  (mp as any).target = t.dict;
  return mp;
});
tprop('__doc__', (t) => {
  const d = t.dict!.get('__doc__');
  return d === undefined ? (t.doc ?? null) : d;
}, (t, v) => { t.dict!.set('__doc__', v); });
tprop('__abstractmethods__', (t) => {
  const e = t.dict!.m.get('__abstractmethods__');
  if (e === undefined) throw attributeError('__abstractmethods__', '__abstractmethods__', t);
  return e.v;
}, (t, v) => { t.dict!.set('__abstractmethods__', v); bumpTypeVersion(); });
tprop('__type_params__', (t) => t.dict!.get('__type_params__') ?? new PyTuple([]), (t, v) => {
  if (!(v instanceof PyTuple)) throw typeError(`__type_params__ must be set to a tuple, not ${typeOf(v).name}`);
  t.dict!.set('__type_params__', v);
});
tprop('__annotations__', (t) => {
  let a = t.dict!.get('__annotations__');
  if (a === undefined) { a = new PyDict(); t.dict!.set('__annotations__', a); }
  return a;
}, (t, v) => { t.dict!.set('__annotations__', v); });
tprop('__text_signature__', () => null);

// ───────────────────────── uniones ─────────────────────────

function unionArgs(x: any): any[] {
  if (x instanceof PyObject && x.cls === unionType) return (x.dict!.get('__args__') as PyTuple).a;
  return [x];
}

function typeOrNone(x: any): boolean {
  return x === null || x instanceof PyType || (x instanceof PyObject && (x.cls === unionType || x.cls === genericAliasType)) || (x instanceof PyObject && x.cls.name === 'TypeVar') || x instanceof PyObject && x.cls.name === '_SpecialForm';
}

export function makeUnion(a: any, b: any): any {
  if (!typeOrNone(a) || !typeOrNone(b)) return NotImplemented;
  const items: any[] = [];
  for (const x of [...unionArgs(a), ...unionArgs(b)]) {
    const v = x === null ? noneType : x;
    if (!items.some((y) => y === v)) items.push(v);
  }
  if (items.length === 1) return items[0];
  const u = new PyObject(unionType);
  u.dict = new PyDict();
  u.dict.set('__args__', new PyTuple(items));
  return u;
}

ops.unionTypeRef.t = unionType;

function reprArg(x: any): string {
  if (x === Ellipsis) return '...';
  if (x === noneType) return 'None';
  if (x instanceof PyType) {
    const m = x.dict!.get('__module__') ?? x.module;
    return m === 'builtins' ? x.qualname : `${m}.${x.qualname}`;
  }
  if (x instanceof PyList) return '[' + x.a.map(reprArg).join(', ') + ']';
  return ops.repr(x);
}

defMethods(unionType, {
  __repr__: ['self', (u: any) => (u.dict.get('__args__') as PyTuple).a.map(reprArg).join(' | ')],
  __or__: ['self, other', (a: any, b: any) => makeUnion(a, b)],
  __ror__: ['self, other', (a: any, b: any) => makeUnion(b, a)],
  __eq__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyObject) || b.cls !== unionType) return NotImplemented;
    const x = (a.dict.get('__args__') as PyTuple).a;
    const y = (b.dict!.get('__args__') as PyTuple).a;
    return x.length === y.length && x.every((v: any) => y.includes(v));
  }],
  __hash__: ['self', (a: any) => (a.dict.get('__args__') as PyTuple).a.length],
  __instancecheck__: ['self, x', (u: any, x: any) => ops.isinstanceCheck(x, u)],
  __subclasscheck__: ['self, x', (u: any, x: any) => ops.issubclassCheck(x, u)],
});
defGetter(unionType, '__args__', (u: any) => u.dict.get('__args__'));

// ───────────────────────── alias genéricos: list[int] ─────────────────────────

export function makeGenericAlias(origin: any, args: any, cls: PyType = genericAliasType): any {
  const g = new PyObject(cls);
  g.dict = new PyDict();
  g.dict.set('__origin__', origin);
  g.dict.set('__args__', args instanceof PyTuple ? args : new PyTuple([args]));
  return g;
}

genericAliasType.dict!.set('__new__', mkNative('__new__', 'cls, origin, args', (cls: any, origin: any, args: any) => makeGenericAlias(origin, args, cls), { owner: 'GenericAlias' }));
genericAliasType.dict!.set('__init__', mkNative('__init__', 'self, *a, **k', () => null, { method: true, owner: 'GenericAlias' }));
defMethods(genericAliasType, {
  __repr__: ['self', (g: any) => {
    const o = g.dict.get('__origin__');
    const a = (g.dict!.get('__args__') as PyTuple).a;
    const on = o instanceof PyType ? ((o.dict!.get('__module__') ?? o.module) === 'builtins' ? o.qualname : `${o.module}.${o.qualname}`) : ops.repr(o);
    return `${on}[${a.length === 0 ? '()' : a.map(reprArg).join(', ')}]`;
  }],
  __call__: ['self, *args, **kw', (g: any, args: any, kw: any) => {
    const o = g.dict.get('__origin__');
    const r = callObj(o, [...tupleArr(args)], kwMap(kw));
    try { ops.setAttr(r, '__orig_class__', g); } catch { /* inmutable */ }
    return r;
  }],
  __getitem__: ['self, i', (g: any, i: any) => makeGenericAlias(g.dict.get('__origin__'), i)],
  __or__: ['self, other', (a: any, b: any) => makeUnion(a, b)],
  __ror__: ['self, other', (a: any, b: any) => makeUnion(b, a)],
  __eq__: ['self, other', (a: any, b: any) => {
    if (!(b instanceof PyObject) || !b.cls.isSubtype(genericAliasType)) return NotImplemented;
    return a.dict.get('__origin__') === b.dict!.get('__origin__') && ops.eqOp(a.dict.get('__args__'), b.dict!.get('__args__'));
  }],
  __hash__: ['self', (g: any) => ops.hashOf(g.dict!.get('__args__'))],
  __mro_entries__: ['self, bases', (g: any) => new PyTuple([g.dict.get('__origin__')])],
  __instancecheck__: ['self, x', () => { throw typeError('isinstance() argument 2 cannot be a parameterized generic'); }],
  __subclasscheck__: ['self, x', () => { throw typeError('issubclass() argument 2 cannot be a parameterized generic'); }],
});
genericAliasType.ownGetattro = (o: any, name: string): any => {
  const e = o.dict.m.get(name);
  if (e !== undefined) return e.v;
  const own = genericAliasType.lookup(name);
  if (own !== undefined) return ops.descrGet(own, o, genericAliasType);
  // el resto de atributos se delega al origen (list[int].append → list.append)
  const origin = o.dict.get('__origin__');
  if (!name.startsWith('__') || name === '__name__' || name === '__qualname__' || name === '__doc__') {
    return ops.getAttrOpt(origin, name);
  }
  return undefined;
};
genericAliasType.computeMro();

const classGetItem = new PyClassMethod(classMethodType, mkNative('__class_getitem__', 'cls, item', (cls: any, item: any) => makeGenericAlias(cls, item), { owner: 'type' }));
for (const t of [listType, dictType, setType, frozenSetType, tupleType, typeType]) t.dict!.set('__class_getitem__', classGetItem);

// ───────────────────────── NoneType, NotImplemented, Ellipsis ─────────────────────────

defMethods(noneType, {
  __repr__: ['self', () => 'None'],
  __bool__: ['self', () => false],
  __hash__: ['self', () => ops.hashOf(null)],
  __eq__: ['self, other', (a: any, b: any) => (b === null ? true : NotImplemented)],
});
noneType.dict!.set('__new__', mkNative('__new__', 'cls, *args', () => null, { owner: 'NoneType' }));
defMethods(notImplementedType, {
  __repr__: ['self', () => 'NotImplemented'],
  __bool__: ['self', () => { throw typeError('NotImplemented should not be used in a boolean context'); }],
});
defMethods(ellipsisType, {
  __repr__: ['self', () => 'Ellipsis'],
});

// atributos de módulo/funciones que usan dict de instancia
for (const t of [PyModule]) void t;

export { objectNew, objectInit, typeRepr, dirOf, typeGetattro, makeExc, valueError, nativeFn, mapToDict, strRepr };
void F_INSTDICT;
void dictProp;
void E;
export type { Kw };
