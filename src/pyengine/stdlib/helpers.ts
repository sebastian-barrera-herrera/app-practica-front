/**
 * Utilidades para escribir módulos nativos de la biblioteca estándar.
 */
import { PyDict, PyModule, PyType, type Kw } from '../runtime/objects';
import { fn as nativeFn, mkNative } from '../runtime/native';
import { newNativeType, objectType } from '../runtime/builtin_types';

export type Impl = (...a: any[]) => any;

/** define una función en un módulo: `fn(m, 'sqrt', 'x, /', impl)` */
export function mfn(m: PyModule, name: string, sig: string, impl: Impl): void {
  m.dict!.set(name, nativeFn(name, sig, impl, { module: m.name }));
}

/** define varias constantes */
export function mconst(m: PyModule, values: Record<string, any>): void {
  for (const [k, v] of Object.entries(values)) m.dict!.set(k, v);
}

/** crea un tipo nativo con métodos `spec[nombre] = [firma, impl]` y lo registra en el módulo */
export function mtype(m: PyModule, name: string, methods: Record<string, [string, Impl]>, bases: PyType[] = [objectType], flags?: number): PyType {
  const t = newNativeType(name, m.name, bases, flags);
  for (const k of Object.keys(methods)) {
    const [sig, impl] = methods[k];
    t.dict!.set(k, mkNative(k, sig, impl, { method: true, owner: name }));
  }
  m.dict!.set(name, t);
  return t;
}

export type { Kw, PyDict };
