/**
 * Llamadas: funciones de Python (enlace de argumentos), métodos enlazados, funciones nativas, tipos y
 * generadores. Convención: el que llama cede la propiedad del array `args` (el callee puede reutilizarlo).
 */
import {
  BoundMethod, Cell, Frame, NativeFunction, PyBaseException, PyDict, PyFunction, PyGenerator, PyObject, PyTuple, PyType,
  SIG_RETURN, type Kw, type Code,
} from './objects';
import { asyncGeneratorType, coroutineType, generatorType, typeOf } from './builtin_types';
import { E } from './exc_types';
import { makeExc, typeError, stopIteration, StepLimit, valueError, runtimeError } from './errors';
import { interp } from './state';
import * as ops from './ops';

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

function listNames(names: string[]): string {
  const q = names.map((n) => `'${n}'`);
  if (q.length === 1) return q[0];
  if (q.length === 2) return `${q[0]} and ${q[1]}`;
  return q.slice(0, -1).join(', ') + ', and ' + q[q.length - 1];
}

export function bindError(fn: PyFunction, kind: string, extra: string): PyBaseException {
  return typeError(`${fn.qualname}() ${kind}${extra}`);
}

/** Enlaza args/kw a las ranuras locales; devuelve el array de locales listo. */
function bindArgs(fn: PyFunction, args: any[], kw: Kw | null): any[] {
  const code = fn.code;
  const nargs = args.length;
  const argcount = code.argcount;
  const total = argcount + code.kwonlyCount;
  const l = args;
  // 1. posicionales sobrantes
  if (nargs > argcount) {
    if (code.varargsSlot >= 0) {
      const rest = args.slice(argcount);
      l.length = argcount;
      l.length = code.nlocals;
      l[code.varargsSlot] = new PyTuple(rest);
    } else {
      const defs = fn.defaults ? fn.defaults.length : 0;
      const sig = defs > 0 ? `from ${argcount - defs} to ${argcount}` : String(argcount);
      const sigPlural = defs > 0 || argcount !== 1 ? 's' : '';
      let kwonlyGiven = 0;
      if (kw) for (let i = argcount; i < total; i++) if (kw.has(code.paramNames[i])) kwonlyGiven++;
      let msg: string;
      if (kwonlyGiven > 0) {
        msg = `takes ${sig} positional argument${sigPlural} but ${nargs} positional argument${nargs === 1 ? '' : 's'} (and ${kwonlyGiven} keyword-only argument${kwonlyGiven === 1 ? '' : 's'}) were given`;
      } else {
        msg = `takes ${sig} positional argument${sigPlural} but ${nargs} ${nargs === 1 ? 'was' : 'were'} given`;
      }
      throw typeError(`${fn.qualname}() ${msg}`);
    }
  } else {
    l.length = code.nlocals;
    if (code.varargsSlot >= 0) l[code.varargsSlot] = new PyTuple([]);
  }
  // 2. argumentos con nombre
  let kwdict: PyDict | null = null;
  if (code.varkwSlot >= 0) {
    kwdict = new PyDict();
    l[code.varkwSlot] = kwdict;
  }
  if (kw !== null) {
    const names = code.paramNames;
    for (const [name, value] of kw) {
      let idx = -1;
      for (let i = code.posonlyCount; i < total; i++) {
        if (names[i] === name) { idx = i; break; }
      }
      if (idx < 0) {
        if (kwdict !== null) {
          kwdict.set(name, value);
          continue;
        }
        // ¿es un parámetro solo posicional?
        for (let i = 0; i < code.posonlyCount; i++) {
          if (names[i] === name) {
            const po = kw ? Array.from(kw.keys()).filter((k) => names.indexOf(k) >= 0 && names.indexOf(k) < code.posonlyCount) : [];
            throw typeError(`${fn.qualname}() got some positional-only arguments passed as keyword arguments: '${po.join("', '")}'`);
          }
        }
        throw typeError(`${fn.qualname}() got an unexpected keyword argument '${name}'`);
      }
      if (l[idx] !== undefined) {
        throw typeError(`${fn.qualname}() got multiple values for argument '${name}'`);
      }
      l[idx] = value;
    }
  }
  // 3. valores por defecto de posicionales
  if (nargs < argcount) {
    const defs = fn.defaults;
    const ndef = defs ? defs.length : 0;
    const firstDef = argcount - ndef;
    let missing: string[] | null = null;
    for (let i = nargs; i < argcount; i++) {
      if (l[i] === undefined) {
        if (i >= firstDef) l[i] = defs![i - firstDef];
        else (missing ??= []).push(code.paramNames[i]);
      }
    }
    if (missing) {
      throw typeError(`${fn.qualname}() missing ${missing.length} required positional argument${plural(missing.length)}: ${listNames(missing)}`);
    }
  }
  // 4. keyword-only
  if (code.kwonlyCount > 0) {
    let missing: string[] | null = null;
    for (let i = argcount; i < total; i++) {
      if (l[i] === undefined) {
        const d = fn.kwdefaults ? fn.kwdefaults.get(code.paramNames[i]) : undefined;
        if (d !== undefined) l[i] = d;
        else (missing ??= []).push(code.paramNames[i]);
      }
    }
    if (missing) {
      throw typeError(`${fn.qualname}() missing ${missing.length} required keyword-only argument${plural(missing.length)}: ${listNames(missing)}`);
    }
  }
  return l;
}

/** convierte errores internos de JS en excepciones de Python (RangeError → RecursionError) */
export function toPyExc(e: unknown): PyBaseException | null {
  if (e instanceof PyBaseException) return e;
  if (e instanceof RangeError && /call stack|Maximum/i.test(e.message)) {
    return makeExc(E.RecursionError, ['maximum recursion depth exceeded']);
  }
  return null;
}

export function addTb(e: PyBaseException, f: Frame): void {
  if (e.lastFrame !== f) {
    e.tb.push({ code: f.code, pos: f.pos, frame: f });
    e.lastFrame = f;
  }
}

/** Llama a una función de Python */
export function callFunction(fn: PyFunction, args: any[], kw: Kw | null): any {
  const code = fn.code;
  const I = interp();
  let l: any[];
  if (code.simple && kw === null && args.length === code.argcount) {
    l = args;
    l.length = code.nlocals;
  } else {
    l = bindArgs(fn, args, kw);
  }
  if (code.cellParams.length > 0) {
    for (const s of code.cellParams) {
      const c = new Cell();
      c.v = l[s];
      l[s] = c;
    }
  }
  if (code.cellVars.length > 0) {
    for (const s of code.cellVars) l[s] = new Cell();
  }
  const f = new Frame(code, l, fn.globals, fn.builtins, I.frame, fn.closure, fn);
  if (code.isGenerator) return makeGenerator(f, fn);
  if (++I.steps > I.maxSteps) throw new StepLimit();
  if (++I.depth > I.recursionLimit) {
    I.depth--;
    f.pos = I.frame ? I.frame.pos : null;
    const e = makeExc(E.RecursionError, ['maximum recursion depth exceeded']);
    throw e;
  }
  I.frame = f;
  try {
    const r = code.body!(f);
    return r === SIG_RETURN ? f.ret : null;
  } catch (e) {
    if (e instanceof PyBaseException) {
      if (e.lastFrame !== f) { e.tb.push({ code, pos: f.pos, frame: f }); e.lastFrame = f; }
    } else {
      const pe = toPyExc(e);
      if (pe !== null) {
        pe.tb.push({ code, pos: f.pos, frame: f });
        pe.lastFrame = f;
        throw pe;
      }
    }
    throw e;
  } finally {
    I.depth--;
    I.frame = f.back;
  }
}

/** Ejecuta un cuerpo de módulo/clase/exec con un marco ya preparado */
export function runFrame(f: Frame, body: (f: Frame) => number | undefined): any {
  const I = interp();
  f.back = I.frame;
  if (++I.depth > I.recursionLimit) {
    I.depth--;
    throw makeExc(E.RecursionError, ['maximum recursion depth exceeded']);
  }
  I.frame = f;
  try {
    const r = body(f);
    return r === SIG_RETURN ? f.ret : null;
  } catch (e) {
    if (e instanceof PyBaseException) {
      if (e.lastFrame !== f) { e.tb.push({ code: f.code, pos: f.pos, frame: f }); e.lastFrame = f; }
    } else {
      const pe = toPyExc(e);
      if (pe !== null) {
        pe.tb.push({ code: f.code, pos: f.pos, frame: f });
        pe.lastFrame = f;
        throw pe;
      }
    }
    throw e;
  } finally {
    I.depth--;
    I.frame = f.back;
  }
}

// ───────────────────────── llamada genérica ─────────────────────────

export function callObj(fn: any, args: any[], kw: Kw | null = null): any {
  if (fn instanceof PyFunction) return callFunction(fn, args, kw);
  if (fn instanceof NativeFunction) {
    if (fn.self !== undefined) args.unshift(fn.self);
    return fn.call(args, kw);
  }
  if (fn instanceof BoundMethod) {
    const f = fn.fn;
    args.unshift(fn.self);
    if (f instanceof PyFunction) return callFunction(f, args, kw);
    if (f instanceof NativeFunction) return f.call(args, kw);
    return callObj(f, args, kw);
  }
  if (fn instanceof PyType) return ops.typeCall(fn, args, kw);
  // objeto con __call__
  const t = typeOf(fn);
  const c = t.lookup('__call__');
  if (c === undefined) throw typeError(`'${t.name}' object is not callable`);
  if (c instanceof PyFunction || c instanceof NativeFunction) {
    args.unshift(fn);
    return callObj(c, args, kw);
  }
  return callObj(ops.descrGet(c, fn, t), args, kw);
}

// ───────────────────────── generadores ─────────────────────────

function makeGenerator(f: Frame, fn: PyFunction): PyGenerator {
  const code = fn.code;
  const tp = code.isAsyncGen ? asyncGeneratorType : code.isCoroutine ? coroutineType : generatorType;
  const g = new PyGenerator(tp, f, code.name, fn.qualname);
  f.gen = g;
  return g;
}

export const DONE = Symbol('done');

export interface GenStep {
  done: boolean;
  value: any;
}

/**
 * Reanuda un generador. mode: 0 = next/send(valor), 1 = throw(exc). Devuelve el valor cedido o lanza StopIteration.
 * `retBox` recibe el valor de retorno cuando el generador termina.
 */
export function genResume(g: PyGenerator, mode: 0 | 1, val: any, finished: { done: boolean; value: any }): any {
  const I = interp();
  finished.done = false;
  if (g.state === 2) throw valueError(`${g.cls === coroutineType ? 'coroutine' : g.cls === asyncGeneratorType ? 'async generator' : 'generator'} already executing`);
  if (g.state === 3) {
    if (mode === 1) throw val;
    finished.done = true;
    finished.value = null;
    return undefined;
  }
  const f = g.frame;
  if (g.state === 0) {
    if (mode === 0 && val !== null && val !== undefined) {
      throw typeError("can't send non-None value to a just-started " + (g.cls === coroutineType ? 'coroutine' : 'generator'));
    }
    if (mode === 1) {
      g.state = 3;
      throw val;
    }
    g.js = f.code.genBody!(f);
  }
  const prevFrame = I.frame;
  f.back = prevFrame;
  if (++I.depth > I.recursionLimit) {
    I.depth--;
    throw makeExc(E.RecursionError, ['maximum recursion depth exceeded']);
  }
  I.frame = f;
  g.state = 2;
  const prevExc = I.curExc;
  try {
    const r = mode === 0 ? g.js!.next(val === undefined ? null : val) : g.js!.throw(val);
    if (r.done) {
      g.state = 3;
      finished.done = true;
      finished.value = r.value === undefined ? null : r.value;
      g.retValue = finished.value;
      return undefined;
    }
    g.state = 1;
    return r.value;
  } catch (e) {
    g.state = 3;
    if (e instanceof PyBaseException) {
      if (e.lastFrame !== f) { e.tb.push({ code: f.code, pos: f.pos, frame: f }); e.lastFrame = f; }
    } else {
      const pe = toPyExc(e);
      if (pe !== null) { pe.tb.push({ code: f.code, pos: f.pos, frame: f }); pe.lastFrame = f; throw pe; }
    }
    throw e;
  } finally {
    I.depth--;
    I.frame = prevFrame;
    I.curExc = prevExc;
  }
}

/** next(g) interno para el protocolo de iteración: devuelve undefined al terminar */
export function genNext(g: PyGenerator): any {
  const fin = { done: false, value: null as any };
  const v = genResume(g, 0, null, fin);
  if (fin.done) return undefined;
  return v;
}

/** usado por `yield from` y `send`: devuelve [valorCedido | undefined, retorno] */
export function genSend(g: PyGenerator, val: any, fin: { done: boolean; value: any }): any {
  return genResume(g, 0, val, fin);
}

export function genThrow(g: PyGenerator, exc: PyBaseException, fin: { done: boolean; value: any }): any {
  return genResume(g, 1, exc, fin);
}

export function genClose(g: PyGenerator): void {
  if (g.state === 0) { g.state = 3; return; }
  if (g.state === 3) return;
  if (g.state === 2) throw valueError('generator already executing');
  const fin = { done: false, value: null as any };
  const exc = makeExc(E.GeneratorExit, []);
  try {
    genResume(g, 1, exc, fin);
  } catch (e) {
    if (e instanceof PyBaseException && (ops.isInstance(e, E.GeneratorExit) || ops.isInstance(e, E.StopIteration))) return;
    throw e;
  }
  if (!fin.done) throw runtimeError('generator ignored GeneratorExit');
}

(PyGenerator.prototype as any).next = function (this: PyGenerator): any {
  return genNext(this);
};

export function stopIterationFrom(value: any): PyBaseException {
  return stopIteration(value);
}
export type { Code, PyObject };
