/**
 * Claves canónicas para diccionarios y conjuntos.
 *
 * Los valores "simples" (str, int, float, bool, None, tuplas de simples…) se identifican por valor con una
 * clave primitiva de JS; los objetos con `__hash__`/`__eq__` propios se representan por el primer objeto
 * "igual" ya presente (se consulta `__eq__`), y el resto de objetos por identidad.
 */
import { PyBox, PyComplex, PyFloat, PyObject, PyTuple, PySet, PyBytes, PyType, PyFunction, NativeFunction } from './objects';
import { interp } from './state';
import * as ops from './ops';

/** escapa el prefijo reservado de las claves compuestas */
const SENT = '';

let ID_COUNTER = 0;
const OBJ_IDS = new WeakMap<object, number>();
/** identificador estable por objeto (solo para claves compuestas) */
function objId(o: object): number {
  let id = OBJ_IDS.get(o);
  if (id === undefined) {
    id = ++ID_COUNTER;
    OBJ_IDS.set(o, id);
  }
  return id;
}

function floatKey(v: number): any {
  if (Number.isInteger(v)) {
    if (Number.isSafeInteger(v)) return v === 0 ? 0 : v;
    return BigInt(v);
  }
  return v; // no entero (incluye inf/-inf); NaN se trata aparte
}

/** ¿el tipo usa __hash__/__eq__ de object (identidad)? */
function identityHashed(t: PyType): boolean {
  const eq = t.lookup('__eq__');
  const h = t.lookup('__hash__');
  return (eq === undefined || eq === OBJECT_EQ.f) && (h === undefined || h === OBJECT_HASH.f);
}
export const OBJECT_EQ: { f: any } = { f: undefined };
export const OBJECT_HASH: { f: any } = { f: undefined };

/** Devuelve la clave canónica de `k` para usarla en un Map de JS. */
export function ckey(k: any): any {
  switch (typeof k) {
    case 'string':
      return k.length > 0 && k.charCodeAt(0) === 0xe000 ? SENT + 'S' + k : k;
    case 'number':
    case 'bigint':
      return k;
    case 'boolean':
      return k ? 1 : 0;
    case 'object':
      break;
    default:
      throw new Error('clave inválida: ' + typeof k);
  }
  if (k === null) return null;
  if (k instanceof PyFloat) {
    if (k.v !== k.v) return k; // NaN: por identidad
    return floatKey(k.v);
  }
  if (k instanceof PyTuple) return tupleKey(k);
  if (k instanceof PyBox) {
    const t = k.cls;
    if (identityHashed(t)) return k;
    const eqf = t.lookup('__eq__');
    const hf = t.lookup('__hash__');
    // subclase de int/str/float sin sobrecargar __eq__/__hash__ nativos: se comporta como su valor
    if (isNativeSlot(eqf) && isNativeSlot(hf)) return ckey(k.value);
    return userKey(k);
  }
  if (k instanceof PyObject) {
    const t = k.cls;
    if (k instanceof PyType || k instanceof PyFunction || k instanceof NativeFunction) {
      if (t.lookup('__hash__') === OBJECT_HASH.f || t === t.mro[0]) return k;
    }
    if (identityHashed(t)) return k;
    const hf = t.lookup('__hash__');
    if (hf === null || hf === undefined) {
      // __hash__ = None → no hashable
    }
    if (k instanceof PySet && k.frozen) return frozensetKey(k);
    if (k instanceof PyBytes && isNativeSlot(t.lookup('__eq__')) && isNativeSlot(hf)) return bytesKey(k);
    return userKey(k);
  }
  if (k instanceof PyComplex) return SENT + 'C' + k.re + ',' + k.im;
  return k;
}

function isNativeSlot(f: any): boolean {
  return f instanceof NativeFunction;
}

function bytesKey(b: PyBytes): string {
  let s = SENT + 'B';
  for (let i = 0; i < b.b.length; i++) s += String.fromCharCode(b.b[i]);
  return s;
}

/** código de un elemento dentro de una clave compuesta (sin ambigüedades) */
function partKey(k: any): string | null {
  switch (typeof k) {
    case 'string': return 's' + k.length + ':' + k;
    case 'number': return 'i' + k;
    case 'bigint': return 'i' + k.toString();
    case 'boolean': return k ? 'i1' : 'i0';
    case 'object': {
      if (k === null) return 'N';
      const c = ckey(k);
      switch (typeof c) {
        case 'string': return c.charCodeAt(0) === 0xe000 && c.length > 1 && c[1] !== 'S' ? 'c' + c.length + ':' + c : 's' + c.length + ':' + c;
        case 'number': return Number.isInteger(c) ? 'i' + c : 'f' + c;
        case 'bigint': return 'i' + c.toString();
        case 'object': return c === null ? 'N' : 'o' + objId(c);
        default: return null;
      }
    }
    default: return null;
  }
}

function tupleKey(t: PyTuple): any {
  if (t.cls !== t.cls.mro[0] && false) return t;
  let s = SENT + 'T' + t.a.length + '(';
  for (let i = 0; i < t.a.length; i++) {
    const p = partKey(t.a[i]);
    if (p === null) return userKey(t);
    s += p + ';';
  }
  return s;
}

function frozensetKey(st: PySet): any {
  const parts: string[] = [];
  for (const x of st.m.values()) {
    const p = partKey(x);
    if (p === null) return userKey(st);
    parts.push(p);
  }
  parts.sort();
  return SENT + 'F' + parts.length + '{' + parts.join(';') + '}';
}

/**
 * Objetos con __hash__/__eq__ definidos por el usuario: se busca en el cubo de hash un objeto igual ya
 * registrado (por `==`) y se usa como clave; si no hay, el propio objeto.
 */
function userKey(o: any): any {
  const I = interp();
  const h = ops.hashOf(o);
  let bucket = I.hashBuckets.get(h);
  if (bucket === undefined) {
    bucket = [];
    I.hashBuckets.set(h, bucket);
  }
  for (let i = 0; i < bucket.length; i++) {
    const c = bucket[i];
    if (c === o || ops.eqId(c, o)) return c;
  }
  bucket.push(o);
  return o;
}
