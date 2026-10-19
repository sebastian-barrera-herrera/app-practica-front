/**
 * Intérprete activo. La ejecución es síncrona entre `await`s, así que basta una referencia "actual"
 * que `Interp.activate()` fija mientras corre código de la sesión (no hay estado compartido entre sesiones
 * fuera de esa ventana síncrona).
 */
import type { Interp } from './interp';

let ACTIVE_INTERP: Interp | null = null;

export function setActive(i: Interp | null): Interp | null {
  const prev = ACTIVE_INTERP;
  ACTIVE_INTERP = i;
  return prev;
}

export function interp(): Interp {
  if (ACTIVE_INTERP === null) throw new Error('No hay un intérprete activo');
  return ACTIVE_INTERP;
}

export function activeOrNull(): Interp | null {
  return ACTIVE_INTERP;
}
