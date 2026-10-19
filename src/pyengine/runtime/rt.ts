/**
 * Soporte en tiempo de ejecución para el código compilado: raise, with, clases, super, patrones…
 */
import {
  BoundMethod, Cell, Frame, NativeFunction, PyBaseException, PyBox, PyBytes, PyByteArray, PyClassMethod, PyDict, PyFunction, PyList,
  PyObject, PySuper, PyTuple, PyType, PyTraceback, PyStaticMethod, PyRange, PySet, type Code, type Kw,
} from './objects';
import {
  boundMethodType, dictType, listType, objectType, strType, superType, tracebackType, tupleType, typeOf, typeType, bytesType, byteArrayType,
  boolType, floatType, intType, setType, frozenSetType,
} from './builtin_types';
import { E } from './exc_types';
import { attributeError, makeExc, nameError, runtimeError, typeError, valueError } from './errors';
import { callObj, toPyExc } from './call';
import * as ops from './ops';
import { interp } from './state';

export function unboundLocal(name: string): PyBaseException {
  const e = makeExc(E.UnboundLocalError, [`cannot access local variable '${name}' where it is not associated with a value`]);
  e.extra = { name };
  return e;
}
export function unboundFree(name: string): PyBaseException {
  const e = makeExc(E.NameError, [`cannot access free variable '${name}' where it is not associated with a value in enclosing scope`]);
  e.extra = { name };
  return e;
}
export { nameError };

// ───────────────────────── raise ─────────────────────────

function asException(x: any, what: string): PyBaseException {
  if (x instanceof PyType) {
    if (!x.isSubtype(E.BaseException)) throw typeError(what);
    const inst = ops.typeCall(x, [], null);
    if (!(inst instanceof PyBaseException)) {
      throw typeError(`calling ${x.name} should have returned an instance of BaseException, not ${typeOf(inst).name}`);
    }
    return inst;
  }
  if (x instanceof PyBaseException) return x;
  throw typeError(what);
}

export function doRaise(exc: any, cause: any, hasCause: boolean): never {
  const e = asException(exc, 'exceptions must derive from BaseException');
  if (hasCause) {
    if (cause === null) {
      e.cause = null;
      e.suppressContext = true;
    } else {
      const c = asException(cause, 'exception causes must derive from BaseException');
      e.cause = c;
      e.suppressContext = true;
    }
  }
  const I = interp();
  const cur = I.curExc;
  if (cur !== null && cur !== e) {
    // evitar ciclos en la cadena de contexto
    let o: PyBaseException | null = cur;
    let cycle = false;
    while (o !== null) {
      if (o === e) { cycle = true; break; }
      o = o.context;
    }
    if (!cycle) e.context = cur;
    else {
      // cortar el ciclo
      let p: PyBaseException = cur;
      while (p.context !== null && p.context !== e) p = p.context;
      p.context = null;
      e.context = cur;
    }
  }
  e.lastFrame = null;
  throw e;
}

export function doReraise(): never {
  const I = interp();
  const cur = I.curExc;
  if (cur === null) throw runtimeError('No active exception to reraise');
  throw cur;
}

/** ¿la excepción `e` coincide con la especificación de `except`? */
export function exceptMatch(e: PyBaseException, spec: any): boolean {
  if (spec instanceof PyType) {
    if (!spec.isSubtype(E.BaseException)) throw typeError('catching classes that do not inherit from BaseException is not allowed');
    return e.cls.isSubtype(spec);
  }
  if (spec instanceof PyTuple) {
    for (const s of spec.a) if (exceptMatch(e, s)) return true;
    return false;
  }
  throw typeError('catching classes that do not inherit from BaseException is not allowed');
}

/** convierte un valor lanzado por JS en excepción de Python (o null si es una señal interna) */
export function asPyExc(e: unknown): PyBaseException | null {
  return toPyExc(e);
}

// ───────────────────────── with ─────────────────────────

export interface WithCtx {
  exit: any;
  mgr: any;
}

export function withEnter(mgr: any, isAsync: boolean): { ctx: WithCtx; value: any } {
  const t = typeOf(mgr);
  const enterName = isAsync ? '__aenter__' : '__enter__';
  const exitName = isAsync ? '__aexit__' : '__exit__';
  const enter = t.lookup(enterName);
  if (enter === undefined) {
    const pre = isAsync ? "'async with' received an object from __aenter__ that does not implement __await__" : '';
    void pre;
    throw typeError(`'${t.name}' object does not support the ${isAsync ? 'asynchronous ' : ''}context manager protocol`);
  }
  const exit = t.lookup(exitName);
  if (exit === undefined) {
    throw typeError(`'${t.name}' object does not support the ${isAsync ? 'asynchronous ' : ''}context manager protocol (missed ${exitName} method)`);
  }
  const value = callObj(enter, [mgr]);
  return { ctx: { exit, mgr }, value };
}

export function tracebackOf(e: PyBaseException): any {
  if (e.tb.length === 0) return null;
  // la lista está de lo más interno a lo más externo; la cadena empieza por el marco más externo
  let next: PyTraceback | null = null;
  for (let i = 0; i < e.tb.length; i++) {
    next = new PyTraceback(tracebackType, e.tb[i], next);
  }
  return next;
}

export function withExit(ctx: WithCtx, e: PyBaseException | null): any {
  if (e === null) return callObj(ctx.exit, [ctx.mgr, null, null, null]);
  return callObj(ctx.exit, [ctx.mgr, e.cls, e, tracebackOf(e)]);
}

// ───────────────────────── clases ─────────────────────────

export function calculateMeta(meta: any, bases: any[]): any {
  let winner: PyType | null = meta instanceof PyType ? meta : null;
  if (winner === null) return meta; // metaclase invocable
  for (const b of bases) {
    const bt = typeOf(b);
    if (winner.isSubtype(bt)) continue;
    if (bt.isSubtype(winner)) { winner = bt; continue; }
    throw typeError('metaclass conflict: the metaclass of a derived class must be a (non-strict) subclass of the metaclasses of all its bases');
  }
  return winner;
}

export function buildClass(f: Frame, name: string, qualname: string, body: Code, bodyFn: (cf: Frame) => number | undefined, closure: Cell[] | null, bases: any[], kw: Kw | null): any {
  const I = interp();
  // __mro_entries__ (typing.Generic[T], etc.)
  let realBases = bases;
  let origBases: any[] | null = null;
  for (let i = 0; i < bases.length; i++) {
    const b = bases[i];
    if (!(b instanceof PyType) && b instanceof PyObject) {
      const me = typeOf(b).lookup('__mro_entries__');
      if (me !== undefined) {
        if (origBases === null) { origBases = bases.slice(); realBases = bases.slice(0, i); }
        const r = callObj(me, [b, new PyTuple(bases)]);
        if (!(r instanceof PyTuple)) throw typeError('__mro_entries__ must return a tuple');
        for (const x of r.a) realBases.push(x);
        continue;
      }
    }
    if (origBases !== null) realBases.push(b);
  }
  let meta: any = null;
  let kwr = kw;
  if (kw !== null && kw.has('metaclass')) {
    meta = kw.get('metaclass');
    kwr = new Map(kw);
    kwr.delete('metaclass');
  }
  if (meta === null) meta = realBases.length > 0 ? typeOf(realBases[0]) : typeType;
  meta = calculateMeta(meta, realBases);
  // __prepare__
  let ns: PyDict;
  if (meta instanceof PyType) {
    const prep = ops.getAttrOpt(meta, '__prepare__');
    if (prep !== undefined) {
      const r = callObj(prep, [name, new PyTuple(realBases)], kwr === null ? null : new Map(kwr));
      if (!(r instanceof PyDict)) throw typeError(`${meta.name}.__prepare__() must return a mapping, not ${typeOf(r).name}`);
      ns = r;
    } else ns = new PyDict();
  } else ns = new PyDict();
  const g = f.g;
  const modName = g.get('__name__');
  ns.set('__module__', modName === undefined ? '__main__' : modName);
  ns.set('__qualname__', qualname);
  const l = new Array(body.nlocals);
  const cf = new Frame(body, l, g, f.b, I.frame, closure, null, ns);
  let cell: Cell | null = null;
  if (body.classCellSlot >= 0) {
    cell = new Cell();
    l[body.classCellSlot] = cell;
  }
  I.depth++;
  const prev = I.frame;
  cf.back = prev;
  I.frame = cf;
  try {
    bodyFn(cf);
  } catch (e) {
    if (e instanceof PyBaseException) {
      if (e.lastFrame !== cf) { e.tb.push({ code: body, pos: cf.pos, frame: cf }); e.lastFrame = cf; }
    } else {
      const pe = toPyExc(e);
      if (pe !== null) { pe.tb.push({ code: body, pos: cf.pos, frame: cf }); pe.lastFrame = cf; throw pe; }
    }
    throw e;
  } finally {
    I.depth--;
    I.frame = prev;
  }
  if (origBases !== null) ns.set('__orig_bases__', new PyTuple(origBases));
  if (cell !== null) ns.set('__classcell__', cell);
  const cls = callObj(meta, [name, new PyTuple(realBases), ns], kwr === null ? null : new Map(kwr));
  return cls;
}

// ───────────────────────── super ─────────────────────────

export function makeSuper(cls: any, obj: any): PySuper {
  return superNew(cls, obj);
}

export function superNew(cls: PyType, obj: any): PySuper {
  let objType: PyType;
  if (obj instanceof PyType && obj.isSubtype(cls)) objType = obj;
  else {
    const t = typeOf(obj);
    if (t.isSubtype(cls)) objType = t;
    else if (obj instanceof PyObject && obj.dict && obj.dict.get('__class__') instanceof PyType && (obj.dict.get('__class__') as PyType).isSubtype(cls)) objType = obj.dict.get('__class__');
    else throw typeError('super(type, obj): obj must be an instance or subtype of type');
  }
  return new PySuper(superType, cls, obj, objType);
}

export function superGetattr(s: PySuper, name: string): any {
  const mro = s.objType.mro;
  let i = mro.indexOf(s.thisClass);
  if (i < 0) i = -1;
  if (name !== '__class__') {
    for (let k = i + 1; k < mro.length; k++) {
      const e = mro[k].dict!.m.get(name);
      if (e !== undefined) {
        const d = e.v;
        const bindObj = s.obj === s.objType ? undefined : s.obj;
        return superBind(d, bindObj, s.objType);
      }
    }
  }
  // atributos propios de super y de object
  const own = superType.lookup(name);
  if (own !== undefined) return ops.descrGet(own, s, superType);
  throw attributeError(`'super' object has no attribute '${name}'`, name, s);
}

function superBind(d: any, obj: any, objType: PyType): any {
  if (d instanceof PyFunction) return obj === undefined ? d : new BoundMethod(boundMethodType, d, obj);
  if (d instanceof NativeFunction) return d.isMethod && obj !== undefined ? new BoundMethod(boundMethodType, d, obj) : d;
  if (d instanceof PyClassMethod) return new BoundMethod(boundMethodType, d.fn, objType);
  if (d instanceof PyStaticMethod) return d.fn;
  if (d instanceof PyObject) {
    const g = d.cls.lookup('__get__');
    if (g !== undefined) return callObj(g, [d, obj === undefined ? null : obj, objType]);
    if (d.cls.lookup('__set__') !== undefined) { /* descriptor de datos sin __get__ */ }
  }
  return d;
}

// ───────────────────────── argumentos de llamada ─────────────────────────

export function describeCallee(fn: any): string {
  if (fn instanceof PyFunction) return fn.qualname + '()';
  if (fn instanceof NativeFunction) return fn.qualname + '()';
  if (fn instanceof BoundMethod) return describeCallee(fn.fn);
  if (fn instanceof PyType) return fn.name + '()';
  return typeOf(fn).name + ' object';
}

/** expande `*x` en argumentos posicionales */
export function starArgs(x: any, fn: any): any[] {
  if (x instanceof PyTuple || x instanceof PyList) return x.a;
  try {
    return ops.iterToArray(x);
  } catch (e) {
    if (e instanceof PyBaseException && ops.isInstance(e, E.TypeError) && typeOf(x).lookup('__iter__') === undefined && typeOf(x).lookup('__getitem__') === undefined) {
      throw typeError(`${describeCallee(fn)} argument after * must be an iterable, not ${typeOf(x).name}`);
    }
    throw e;
  }
}

/** añade los pares de un mapping a kw (para `**x`) */
export function starKw(kw: Kw, x: any, fn: any): void {
  if (x instanceof PyDict) {
    for (const e of x.m.values()) {
      if (typeof e.k !== 'string') {
        if (!(e.k instanceof PyBox && typeof e.k.value === 'string')) throw typeError(`${describeCallee(fn)} keywords must be strings`);
      }
      const k = typeof e.k === 'string' ? e.k : e.k.value;
      if (kw.has(k)) throw typeError(`${describeCallee(fn)} got multiple values for keyword argument '${k}'`);
      kw.set(k, e.v);
    }
    return;
  }
  const t = typeOf(x);
  const keysf = t.lookup('keys');
  if (keysf === undefined) throw typeError(`${describeCallee(fn)} argument after ** must be a mapping, not ${t.name}`);
  const keys = ops.iterToArray(callObj(keysf, [x]));
  for (const k of keys) {
    if (typeof k !== 'string') throw typeError(`${describeCallee(fn)} keywords must be strings`);
    if (kw.has(k)) throw typeError(`${describeCallee(fn)} got multiple values for keyword argument '${k}'`);
    kw.set(k, ops.getitem(x, k));
  }
}

// ───────────────────────── patrones (match) ─────────────────────────

const MATCH_SELF_TYPES = new Set<PyType>([boolType, bytesType, byteArrayType, dictType, floatType, frozenSetType, intType, listType, setType, strType, tupleType]);

export function isMatchSequence(x: any): boolean {
  if (typeof x === 'string' || x instanceof PyBytes || x instanceof PyByteArray) return false;
  if (x instanceof PyList || x instanceof PyTuple || x instanceof PyRange) return true;
  if (x instanceof PyObject) {
    const t = x.cls;
    const flag = t.isSubtypeByName('collections.abc.Sequence');
    return flag;
  }
  return false;
}
export function isMatchMapping(x: any): boolean {
  if (x instanceof PyDict) return true;
  if (x instanceof PyObject) return x.cls.isSubtypeByName('collections.abc.Mapping');
  return false;
}

export function matchClassAttrs(subject: any, cls: any, nPos: number, kwNames: string[]): any[] | null {
  if (!(cls instanceof PyType)) throw typeError('called match pattern must be a class');
  if (!ops.isinstanceCheck(subject, cls)) return null;
  const out: any[] = [];
  if (nPos > 0) {
    let names: string[] | null = null;
    const ma = cls.lookup('__match_args__');
    if (ma instanceof PyTuple) names = ma.a.map((x) => String(x));
    if (names === null) {
      if (nPos === 1 && MATCH_SELF_TYPES.has(findBuiltinBase(cls))) {
        out.push(subject);
        // continuar con keywords
        return finishKw(subject, out, kwNames);
      }
      if (ma === undefined && nPos > 0) throw typeError(`${cls.name}() accepts 0 positional sub-patterns (${nPos} given)`);
    }
    if (names !== null) {
      if (nPos > names.length) throw typeError(`${cls.name}() accepts ${names.length} positional sub-pattern${names.length === 1 ? '' : 's'} (${nPos} given)`);
      for (let i = 0; i < nPos; i++) {
        const v = ops.getAttrOpt(subject, names[i]);
        if (v === undefined) return null;
        out.push(v);
      }
    }
  }
  return finishKw(subject, out, kwNames);
}
function finishKw(subject: any, out: any[], kwNames: string[]): any[] | null {
  for (const n of kwNames) {
    const v = ops.getAttrOpt(subject, n);
    if (v === undefined) return null;
    out.push(v);
  }
  return out;
}
function findBuiltinBase(t: PyType): PyType {
  for (const b of t.mro) if (MATCH_SELF_TYPES.has(b)) return b;
  return objectType;
}

export function valueErrorFor(msg: string): PyBaseException {
  return valueError(msg);
}
export { strType, tupleType, listType };
void PySet;
