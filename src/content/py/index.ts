import type { WorldDef } from '../types';

/**
 * Mundos del curso de Python. Mientras se escriben, cada archivo `wN.ts` se carga si existe (Metro trata los
 * `require` dentro de `try` como opcionales). Un archivo ausente se ignora; un error DENTRO de él NO se oculta.
 */
function rethrowUnlessMissing(e: unknown, file: string) {
  const err = e as { code?: string; message?: string };
  const missing = (err.code === 'MODULE_NOT_FOUND' || /Cannot find module|Unable to resolve|Requiring unknown module/.test(String(err.message))) && String(err.message).includes(file);
  if (!missing) throw e;
}

function loadWorlds(): WorldDef[] {
  const mods: Record<string, WorldDef>[] = [];
  try {
    mods.push(require('./w1'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w1');
  }
  try {
    mods.push(require('./w2'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w2');
  }
  try {
    mods.push(require('./w3'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w3');
  }
  try {
    mods.push(require('./w4'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w4');
  }
  try {
    mods.push(require('./w5'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w5');
  }
  try {
    mods.push(require('./w6'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w6');
  }
  try {
    mods.push(require('./w7'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w7');
  }
  try {
    mods.push(require('./w8'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w8');
  }
  try {
    mods.push(require('./w9'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w9');
  }
  try {
    mods.push(require('./w10'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w10');
  }
  try {
    mods.push(require('./w11'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w11');
  }
  try {
    mods.push(require('./w12'));
  } catch (e) {
    rethrowUnlessMissing(e, 'w12');
  }
  return mods.flatMap((m) => Object.values(m));
}

export const PY_WORLDS: WorldDef[] = loadWorlds();
