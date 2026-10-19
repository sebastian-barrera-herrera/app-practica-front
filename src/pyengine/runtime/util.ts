/**
 * Utilidades comunes para escribir métodos nativos.
 */
import { PyBox, PyDict, PyFloat, PyList, PyObject, PySet, PyTuple, type Kw } from './objects';
import { typeOf } from './builtin_types';
import { typeError } from './errors';
import * as ops from './ops';
import { type PyInt } from './numeric';

/** `*args` recibido como PyTuple → array */
export const tupleArr = (t: any): any[] => (t instanceof PyTuple ? t.a : []);

/** `**kw` recibido como PyDict → Map (claves str) */
export function kwMap(d: any): Kw | null {
  if (!(d instanceof PyDict) || d.size === 0) return null;
  const m: Kw = new Map();
  for (const e of d.m.values()) m.set(String(e.k), e.v);
  return m;
}

export function mapToDict(m: Kw | null): PyDict {
  const d = new PyDict();
  if (m) for (const [k, v] of m) d.set(k, v);
  return d;
}

export function isNone(x: any): boolean {
  return x === null || x === undefined;
}

/** entero de Python (cualquier objeto con __index__) → PyInt, con el mensaje de CPython */
export function asInt(x: any, msg?: string): PyInt {
  return ops.toIndex(x, msg);
}

/** entero acotado a `number` (para índices y cantidades) */
export function asIdx(x: any, msg?: string): number {
  const v = ops.toIndex(x, msg);
  if (typeof v === 'bigint') return v < 0n ? -Infinity : Infinity;
  return v;
}

/** cadena de Python (str o subclase) → string; TypeError si no lo es */
export function asStr(x: any, what = 'str'): string {
  if (typeof x === 'string') return x;
  if (x instanceof PyBox && typeof x.value === 'string') return x.value;
  throw typeError(`${what} must be str, not ${typeOf(x).name}`);
}

export function asFloat(x: any, what?: string): number {
  if (x instanceof PyFloat) return x.v;
  const i = ops.intValue(x);
  if (i !== undefined) {
    return typeof i === 'bigint' ? Number(i) : i;
  }
  const f = ops.floatValue(x);
  if (f !== undefined) return f;
  const t = typeOf(x);
  const m = t.lookup('__float__');
  if (m !== undefined) {
    const r = ops.callObj(m, [x]);
    if (r instanceof PyFloat) return r.v;
    throw typeError(`${t.name}.__float__ returned non-float (type ${typeOf(r).name})`);
  }
  const ix = t.lookup('__index__');
  if (ix !== undefined) {
    const v = ops.toIndex(x);
    return typeof v === 'bigint' ? Number(v) : v;
  }
  throw typeError(what ?? `must be real number, not ${t.name}`);
}

export const F = (v: number): PyFloat => new PyFloat(v);

export function newList(a: any[]): PyList {
  return new PyList(a);
}
export function newTuple(a: any[]): PyTuple {
  return new PyTuple(a);
}
export function newSet(items: Iterable<any>, frozen = false): PySet {
  const s = new PySet(frozen);
  for (const x of items) s.add(x);
  return s;
}

/** valor de un objeto "PyBox" o primitivo */
export function unbox(x: any): any {
  return x instanceof PyBox ? x.value : x;
}

export function isPyObj(x: any): x is PyObject {
  return x instanceof PyObject;
}

/** Clasifica x como "tipo con nombre" para los mensajes de error */
export function tname(x: any): string {
  return typeOf(x).name;
}
