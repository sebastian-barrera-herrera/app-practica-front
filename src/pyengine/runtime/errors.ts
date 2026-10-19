/**
 * Creación de excepciones de Python desde código nativo: `throw typeError("…")`.
 */
import { PyBaseException, PyType } from './objects';
import { E } from './exc_types';
import { activeOrNull } from './state';

/** crea una instancia de excepción (sin llamar a __init__) con los argumentos dados */
export function makeExc(type: PyType, args: any[]): PyBaseException {
  const e = new PyBaseException(type);
  e.args = args;
  const I = activeOrNull();
  if (I !== null && I.curExc !== null) e.context = I.curExc;
  return e;
}

const mk = (t: () => PyType) => (msg: string): PyBaseException => makeExc(t(), [msg]);

export const typeError = mk(() => E.TypeError);
export const valueError = mk(() => E.ValueError);
export const indexError = mk(() => E.IndexError);
export const runtimeError = mk(() => E.RuntimeError);
export const overflowError = mk(() => E.OverflowError);
export const zeroDivision = mk(() => E.ZeroDivisionError);
export const notImplementedError = mk(() => E.NotImplementedError);
export const assertionError = mk(() => E.AssertionError);
export const eofError = mk(() => E.EOFError);
export const systemError = mk(() => E.SystemError);
export const lookupError = mk(() => E.LookupError);
export const unicodeError = mk(() => E.UnicodeError);
export const arithmeticError = mk(() => E.ArithmeticError);
export const memoryError = mk(() => E.MemoryError);

export function keyError(key: any): PyBaseException {
  return makeExc(E.KeyError, [key]);
}

export function attributeError(msg: string, name?: string, obj?: any): PyBaseException {
  const e = makeExc(E.AttributeError, [msg]);
  if (name !== undefined) {
    e.extra = { name, obj };
  }
  return e;
}

export function nameError(name: string): PyBaseException {
  const e = makeExc(E.NameError, [`name '${name}' is not defined`]);
  e.extra = { name };
  return e;
}

export function stopIteration(value?: any): PyBaseException {
  const e = makeExc(E.StopIteration, value === undefined || value === null ? [] : [value]);
  e.extra = { value: value === undefined ? null : value };
  return e;
}

export function osError(type: PyType, errno: number, strerror: string, filename?: string, filename2?: string): PyBaseException {
  const args: any[] = [errno, strerror];
  if (filename !== undefined) args.push(filename);
  const e = makeExc(type, args);
  e.extra = { errno, strerror, filename: filename ?? null, filename2: filename2 ?? null };
  return e;
}

export function importError(msg: string, name: string | null, type: PyType = E.ImportError): PyBaseException {
  const e = makeExc(type, [msg]);
  e.extra = { name, path: null };
  return e;
}

/** señal interna: el programa pidió una línea de entrada y no hay (se reejecuta tras obtenerla) */
export class NeedInput {
  constructor(public prompt: string) {}
}

/** señal interna: se agotó el presupuesto de pasos */
export class StepLimit {
  line: number | undefined;
  fn: string | undefined;
  constructor() {
    const I = activeOrNull();
    const f = I ? I.frame : null;
    if (f) {
      this.line = f.pos ? f.pos.line : undefined;
      this.fn = f.code.name;
    }
  }
}

/** señal interna: la ejecución fue abortada desde fuera */
export class Aborted {}

/** señal interna: sys.exit() fuera de excepciones Python (no se usa; SystemExit es una excepción normal) */
export class InternalError extends Error {}
