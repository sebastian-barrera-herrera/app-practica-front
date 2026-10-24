/**
 * Salidas ya calculadas de las preguntas «¿qué imprime este código?» de Python.
 *
 * El intérprete de Python se ejecuta en el mismo hilo que la interfaz: al importar módulos como `dataclasses`, `enum`
 * o `statistics` tarda varios segundos en un móvil y la app queda congelada (sin poder tocar las opciones). Como el
 * código de estas preguntas es fijo, su salida se calcula una vez y se guarda en `pyoutAnswers.generated.ts`; un test
 * comprueba que sigue siendo la que produce el intérprete (y explica cómo regenerarla).
 */
import type { PyOptions } from '@/pyengine/types';
import { PYOUT } from './pyoutAnswers.generated';

/** Hash FNV-1a de 32 bits, en hexadecimal. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const pyoutKey = (code: string, setup?: PyOptions): string => fnv1a(`${code}\u0000${setup ? JSON.stringify(setup) : ''}`);

/** La salida precalculada de este código, si la hay. */
export const knownPyout = (code: string, setup?: PyOptions): string | undefined => PYOUT[pyoutKey(code, setup)];
