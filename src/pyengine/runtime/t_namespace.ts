/**
 * `types.SimpleNamespace`: objeto con atributos arbitrarios (también es el tipo de `sys.implementation`).
 */
import { F_BASETYPE, F_INSTDICT, PyDict, PyObject, PyTuple } from './objects';
import { NotImplemented, newNativeType, objectType, typeOf } from './builtin_types';
import { typeError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { mkNative } from './native';

export const simpleNamespaceType = newNativeType('SimpleNamespace', 'types', [objectType], F_BASETYPE | F_INSTDICT);
const NS = simpleNamespaceType;

function dictOf(o: any): PyDict {
  if (o.dict === null) o.dict = new PyDict();
  return o.dict;
}

const reprGuard = new Set<any>();

NS.dict!.set('__init__', mkNative('__init__', 'self, mapping_or_iterable=, /, **kwargs', (self: any, arg?: any, kw?: any) => {
  const d = dictOf(self);
  if (arg !== undefined) {
    const tmp = callObj(require('./builtin_types').dictType, [arg]) as PyDict;
    for (const e of tmp.m.values()) {
      const k = e.k;
      const v = e.v;
      if (!ops.isStr(k)) throw typeError(`keywords must be strings, not '${typeOf(k).name}'`);
      d.set(k, v);
    }
  }
  if (kw instanceof PyDict) for (const e of kw.m.values()) d.set(e.k, e.v);
  return null;
}, { method: true, owner: 'SimpleNamespace' }));

NS.dict!.set('__repr__', mkNative('__repr__', 'self', (self: any) => {
  const name = typeOf(self) === NS ? 'namespace' : typeOf(self).name;
  if (reprGuard.has(self)) return `${name}(...)`;
  reprGuard.add(self);
  try {
    const parts: string[] = [];
    for (const e of dictOf(self).m.values()) parts.push(`${ops.strValue(e.k)}=${ops.repr(e.v)}`);
    return `${name}(${parts.join(', ')})`;
  } finally {
    reprGuard.delete(self);
  }
}, { method: true, owner: 'SimpleNamespace' }));

NS.dict!.set('__eq__', mkNative('__eq__', 'self, other', (a: any, b: any) => {
  if (!(b instanceof PyObject) || !typeOf(b).isSubtype(NS)) return NotImplemented;
  return ops.eqOp(dictOf(a), dictOf(b));
}, { method: true, owner: 'SimpleNamespace' }));
NS.dict!.set('__hash__', null);

NS.dict!.set('__reduce__', mkNative('__reduce__', 'self', (self: any) => new PyTuple([typeOf(self), new PyTuple([]), dictOf(self)]), { method: true, owner: 'SimpleNamespace' }));

NS.dict!.set('__replace__', mkNative('__replace__', 'self, **changes', (self: any, ch?: any) => {
  const n = ops.newObject(typeOf(self)) as PyObject;
  const d = dictOf(n);
  for (const e of dictOf(self).m.values()) d.set(e.k, e.v);
  if (ch instanceof PyDict) for (const e of ch.m.values()) d.set(e.k, e.v);
  return n;
}, { method: true, owner: 'SimpleNamespace' }));
NS.computeMro();
