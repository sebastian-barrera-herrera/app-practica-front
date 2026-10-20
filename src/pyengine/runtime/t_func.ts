/**
 * Funciones, métodos, funciones nativas, `property`, `classmethod`, `staticmethod`, `super`, módulos, celdas,
 * marcos, códigos, trazas y generadores/corrutinas.
 */
import {
  BoundMethod, Cell, F_INSTDICT, Frame, NativeFunction, PyBaseException, PyClassMethod, PyDict, PyFunction, PyGenerator, PyIter, PyList,
  PyModule, PyObject, PyProperty, PyStaticMethod, PySuper, PyTraceback, PyTuple, PyType, type Code, type Kw,
} from './objects';
import {
  NotImplemented, asyncGeneratorType, boundMethodType, cellType, classMethodType, codeType, coroutineType, frameType, functionType,
  generatorType, getSetDescrType, methodDescriptorType, moduleType, nativeFunctionType, noneType, objectType, propertyType, staticMethodType,
  superType, tracebackType, typeOf, wrapperDescrType,
} from './builtin_types';
import type { Pos } from '../ast';
import { E } from './exc_types';
import { AGYield } from './objects';
import { newNativeType } from './builtin_types';
import { attributeError, makeExc, stopIteration, typeError, valueError } from './errors';
import { callObj, genClose, genResume, genThrow } from './call';
import * as ops from './ops';
import * as rt from './rt';
import { interp } from './state';
import { defMethods, mkNative } from './native';
import { asStr, kwMap, tupleArr } from './util';
import { excStr } from './traceback';

function prop(t: PyType, name: string, get: (x: any) => any, set?: (x: any, v: any) => void, del?: (x: any) => void): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', get, { method: true });
  if (set) p.fset = mkNative(name, 'self, value', (x: any, v: any) => { set(x, v); return null; }, { method: true });
  if (del) p.fdel = mkNative(name, 'self', (x: any) => { del(x); return null; }, { method: true });
  p.owner = t;
  t.dict!.set(name, p);
}

// ───────────────────────── function ─────────────────────────

const FN = functionType;
FN.flags |= F_INSTDICT;
FN.computeMro();

function fnRepr(f: PyFunction): string {
  return `<function ${f.qualname} at ${interp().hexId(f)}>`;
}

defMethods(FN, {
  __repr__: ['self', fnRepr],
  __call__: ['self, *args, **kw', (f: any, args: any, kw: any) => callObj(f, [...tupleArr(args)], kwMap(kw))],
  __get__: ['self, obj, type=', (f: any, obj: any) => (obj === null || obj === undefined ? f : new BoundMethod(boundMethodType, f, obj))],
});
prop(FN, '__name__', (f: PyFunction) => f.name, (f: PyFunction, v) => {
  if (typeof v !== 'string') throw typeError('__name__ must be set to a string object');
  f.name = v;
});
prop(FN, '__qualname__', (f: PyFunction) => f.qualname, (f: PyFunction, v) => {
  if (typeof v !== 'string') throw typeError('__qualname__ must be set to a string object');
  f.qualname = v;
});
prop(FN, '__module__', (f: PyFunction) => {
  if (f.module !== null) return f.module;
  const m = f.globals.get('__name__');
  return m === undefined ? null : m;
}, (f: PyFunction, v) => { f.module = v; });
prop(FN, '__doc__', (f: PyFunction) => (f.doc !== null ? f.doc : f.code.doc), (f: PyFunction, v) => { f.doc = v; });
prop(FN, '__defaults__', (f: PyFunction) => (f.defaults && f.defaults.length ? new PyTuple(f.defaults.slice()) : null), (f: PyFunction, v) => {
  f.defaults = v === null ? null : (v as PyTuple).a.slice();
});
prop(FN, '__kwdefaults__', (f: PyFunction) => {
  if (!f.kwdefaults || f.kwdefaults.size === 0) return null;
  const d = new PyDict();
  for (const [k, v] of f.kwdefaults) d.set(k, v);
  return d;
}, (f: PyFunction, v) => {
  if (v === null) f.kwdefaults = null;
  else {
    f.kwdefaults = new Map();
    for (const e of (v as PyDict).m.values()) f.kwdefaults.set(String(e.k), e.v);
  }
});
prop(FN, '__globals__', (f: PyFunction) => f.globals);
prop(FN, '__closure__', (f: PyFunction) => (f.closure && f.closure.length ? new PyTuple(f.closure.slice()) : null));
prop(FN, '__annotations__', (f: PyFunction) => {
  if (f.annotations === null) f.annotations = new PyDict();
  return f.annotations;
}, (f: PyFunction, v) => { f.annotations = v; });
prop(FN, '__code__', (f: PyFunction) => makeCodeObject(f.code), (f: PyFunction, v: any) => {
  if (!(v instanceof PyObject) || v.cls !== codeType) throw typeError('__code__ must be set to a code object');
  f.code = (v as any).code;
});
prop(FN, '__builtins__', (f: PyFunction) => f.builtins);
prop(FN, '__type_params__', (f: PyFunction) => (f.dict && f.dict.get('__type_params__')) || new PyTuple([]), (f: PyFunction, v) => {
  if (!f.dict) f.dict = new PyDict();
  f.dict.set('__type_params__', v);
});

// ───────────────────────── code ─────────────────────────

function makeCodeObject(c: Code): PyObject {
  const o = new PyObject(codeType);
  (o as any).code = c;
  return o;
}
const cod = (x: any): Code => (x as any).code;
prop(codeType, 'co_name', (c) => cod(c).name);
prop(codeType, 'co_qualname', (c) => cod(c).qualname);
prop(codeType, 'co_filename', (c) => cod(c).filename);
prop(codeType, 'co_firstlineno', (c) => cod(c).firstLine);
prop(codeType, 'co_argcount', (c) => cod(c).argcount);
prop(codeType, 'co_posonlyargcount', (c) => cod(c).posonlyCount);
prop(codeType, 'co_kwonlyargcount', (c) => cod(c).kwonlyCount);
prop(codeType, 'co_nlocals', (c) => cod(c).nlocals);
prop(codeType, 'co_varnames', (c) => new PyTuple(cod(c).varnames.slice()));
prop(codeType, 'co_freevars', (c) => new PyTuple(cod(c).freeNames.slice()));
prop(codeType, 'co_flags', (c) => {
  const k = cod(c);
  let fl = 0;
  if (k.varargsSlot >= 0) fl |= 4;
  if (k.varkwSlot >= 0) fl |= 8;
  if (k.isGenerator && !k.isCoroutine && !k.isAsyncGen) fl |= 32;
  if (k.isCoroutine) fl |= 128;
  if (k.isAsyncGen) fl |= 512;
  if (k.iterCoro) fl |= 256;
  return fl;
});
prop(codeType, 'co_code', () => new (require('./objects').PyBytes)(new Uint8Array(0), require('./builtin_types').bytesType));
prop(codeType, 'co_consts', () => new PyTuple([]));
prop(codeType, 'co_names', () => new PyTuple([]));
/** índice de una posición en la tabla de la función (se usa como «instrucción» en tb_lasti y co_positions) */
function internPos(c: Code, pos: Pos | null): number {
  if (pos === null) return 0;
  if (c.plist === undefined) { c.plist = [null]; c.pmap = new Map(); }
  let i = c.pmap!.get(pos);
  if (i === undefined) { i = c.plist.length; c.plist.push(pos); c.pmap!.set(pos, i); }
  return i;
}

/** columna UTF-8 (bytes) de una columna UTF-16 */
function utf8Col(line: string | undefined, col: number): number {
  if (line === undefined) return col;
  let b = 0;
  const n = Math.min(col, line.length);
  for (let i = 0; i < n; i++) {
    const ch = line.charCodeAt(i);
    if (ch < 0x80) b += 1;
    else if (ch < 0x800) b += 2;
    else if (ch >= 0xd800 && ch < 0xdc00) { b += 4; i++; } else b += 3;
  }
  return b + Math.max(0, col - line.length);
}

defMethods(codeType, {
  replace: ['self, **kw', (c: any, kw: any) => {
    const k = { ...cod(c) } as Code;
    delete k.plist;
    delete k.pmap;
    if (kw instanceof PyDict) {
      for (const e of kw.m.values()) {
        const key = ops.strValue(e.k);
        if (key === 'co_flags') k.iterCoro = (Number(e.v) & 256) !== 0;
        else if (key === 'co_name') k.name = ops.strValue(e.v);
        else if (key === 'co_qualname') k.qualname = ops.strValue(e.v);
        else if (key === 'co_filename') k.filename = ops.strValue(e.v);
        else if (key === 'co_firstlineno') k.firstLine = Number(e.v);
      }
    }
    return makeCodeObject(k);
  }],
  co_positions: ['self', (c: any) => {
    const k = cod(c);
    const lines = interp().sources.get(k.filename);
    const out: any[] = [];
    for (const p of k.plist ?? [null]) {
      if (p === null) out.push(new PyTuple([null, null, null, null]));
      else out.push(new PyTuple([p.line, p.endLine, utf8Col(lines?.[p.line - 1], p.col), utf8Col(lines?.[p.endLine - 1], p.endCol)]));
    }
    return ops.getIter(new PyList(out));
  }],
  __repr__: ['self', (c: any) => `<code object ${cod(c).name} at ${interp().hexId(c)}, file "${cod(c).filename}", line ${cod(c).firstLine}>`],
});

// ───────────────────────── method ─────────────────────────

const BM = boundMethodType;
const bm = (x: any): BoundMethod => x as BoundMethod;

function callableName(f: any): string {
  if (f instanceof PyFunction) return f.qualname;
  if (f instanceof NativeFunction) return f.qualname;
  return ops.getAttrOpt(f, '__qualname__') ?? ops.getAttrOpt(f, '__name__') ?? typeOf(f).name;
}

defMethods(BM, {
  __repr__: ['self', (m: any) => `<bound method ${callableName(bm(m).fn)} of ${ops.repr(bm(m).self)}>`],
  __call__: ['self, *args, **kw', (m: any, args: any, kw: any) => callObj(m, [...tupleArr(args)], kwMap(kw))],
  __eq__: ['self, other', (a: any, b: any) => (b instanceof BoundMethod ? a.fn === b.fn && a.self === b.self : NotImplemented)],
  __hash__: ['self', (m: any) => ops.hashOf(interp().idOf(bm(m).fn)) ^ ops.hashOf(interp().idOf(bm(m).self))],
  __get__: ['self, obj, type=', (m: any) => m],
});
prop(BM, '__self__', (m) => bm(m).self);
prop(BM, '__func__', (m) => bm(m).fn);
BM.ownGetattro = (m: any, name: string): any => {
  const own = BM.lookup(name);
  if (own !== undefined) return ops.descrGet(own, m, BM);
  return ops.getAttrOpt(bm(m).fn, name);
};
BM.computeMro();
prop(BM, '__name__', (m) => ops.getAttr(bm(m).fn, '__name__'));
prop(BM, '__qualname__', (m) => ops.getAttr(bm(m).fn, '__qualname__'));
prop(BM, '__doc__', (m) => ops.getAttr(bm(m).fn, '__doc__'));
prop(BM, '__module__', (m) => ops.getAttrOpt(bm(m).fn, '__module__') ?? null);

// ───────────────────────── builtin_function_or_method ─────────────────────────

const NF = nativeFunctionType;
defMethods(NF, {
  __reduce__: ['self', (f: any) => (f.name !== undefined ? f.name : ops.getAttr(f, '__name__'))],
  __repr__: ['self', (f: any) => {
    const n = f as NativeFunction;
    if (n.isMethod) {
      const owner = n.qualname.includes('.') ? n.qualname.slice(0, n.qualname.lastIndexOf('.')) : '';
      return `<method '${n.name}' of '${owner}' objects>`;
    }
    if (n.self !== undefined) return `<built-in method ${n.name} of ${typeOf(n.self).name} object at ${interp().hexId(n.self)}>`;
    return `<built-in function ${n.name}>`;
  }],
  __call__: ['self, *args, **kw', (f: any, args: any, kw: any) => callObj(f, [...tupleArr(args)], kwMap(kw))],
  __get__: ['self, obj, type=', (f: any, obj: any, t: any) => {
    const n = f as NativeFunction;
    if (n.isMethod) return obj === null || obj === undefined ? f : new BoundMethod(boundMethodType, f, obj);
    void t;
    return f;
  }],
});
prop(NF, '__name__', (f: NativeFunction) => f.name);
prop(NF, '__qualname__', (f: NativeFunction) => f.qualname);
prop(NF, '__doc__', (f: NativeFunction) => f.doc);
prop(NF, '__module__', (f: NativeFunction) => f.module);
prop(NF, '__self__', (f: NativeFunction) => (f.self !== undefined ? f.self : null));
prop(NF, '__text_signature__', (f: NativeFunction) => (f.text ? `(${f.text})` : null));
void [methodDescriptorType, wrapperDescrType, getSetDescrType];

// ───────────────────────── property ─────────────────────────

const PR = propertyType;
PR.alloc = (cls) => new PyProperty(cls);
const pp = (x: any): PyProperty => x as PyProperty;

PR.dict!.set('__init__', mkNative('__init__', 'self, fget=, fset=, fdel=, doc=', (self: any, fget?: any, fset?: any, fdel?: any, doc?: any) => {
  const p = pp(self);
  p.fget = fget === undefined ? null : fget;
  p.fset = fset === undefined ? null : fset;
  p.fdel = fdel === undefined ? null : fdel;
  p.doc = doc === undefined ? null : doc;
  if (p.doc === null && p.fget !== null) {
    try {
      const d = ops.getAttrOpt(p.fget, '__doc__');
      if (d !== undefined) p.doc = d;
    } catch { /* nada */ }
  }
  if (p.fget !== null) {
    const n = ops.getAttrOpt(p.fget, '__name__');
    if (typeof n === 'string') p.name = n;
  }
  return null;
}, { method: true, owner: 'property' }));

function propCopy(p: PyProperty, fget: any, fset: any, fdel: any): PyProperty {
  const n = new PyProperty(p.cls);
  n.fget = fget;
  n.fset = fset;
  n.fdel = fdel;
  n.doc = p.doc;
  n.name = p.name;
  if (p.cls !== propertyType) n.dict = p.dict ? p.dict : null;
  return n;
}

defMethods(PR, {
  getter: ['self, fget', (p: any, f: any) => propCopy(pp(p), f, pp(p).fset, pp(p).fdel)],
  setter: ['self, fset', (p: any, f: any) => propCopy(pp(p), pp(p).fget, f, pp(p).fdel)],
  deleter: ['self, fdel', (p: any, f: any) => propCopy(pp(p), pp(p).fget, pp(p).fset, f)],
  __get__: ['self, obj, type=', (p: any, obj: any) => {
    if (obj === null || obj === undefined) return p;
    if (pp(p).fget === null) throw attributeError(`property '${pp(p).name ?? ''}' of '${typeOf(obj).name}' object has no getter`);
    return callObj(pp(p).fget, [obj]);
  }],
  __set__: ['self, obj, value', (p: any, obj: any, v: any) => {
    if (pp(p).fset === null) throw attributeError(`property '${pp(p).name ?? ''}' of '${typeOf(obj).name}' object has no setter`);
    callObj(pp(p).fset, [obj, v]);
    return null;
  }],
  __delete__: ['self, obj', (p: any, obj: any) => {
    if (pp(p).fdel === null) throw attributeError(`property '${pp(p).name ?? ''}' of '${typeOf(obj).name}' object has no deleter`);
    callObj(pp(p).fdel, [obj]);
    return null;
  }],
  __set_name__: ['self, owner, name', (p: any, _o: any, n: any) => { pp(p).name = n; return null; }],
});
prop(PR, '__objclass__', (p) => {
  if (pp(p).owner) return pp(p).owner;
  throw attributeError("'property' object has no attribute '__objclass__'");
});
prop(PR, 'fget', (p) => pp(p).fget);
prop(PR, 'fset', (p) => pp(p).fset);
prop(PR, 'fdel', (p) => pp(p).fdel);
prop(PR, '__doc__', (p) => pp(p).doc, (p, v) => { pp(p).doc = v; });
prop(PR, '__name__', (p) => {
  if (pp(p).name !== null) return pp(p).name;
  throw attributeError("'property' object has no attribute '__name__'");
}, (p, v) => { pp(p).name = v; });
prop(PR, '__isabstractmethod__', (p) => {
  for (const f of [pp(p).fget, pp(p).fset, pp(p).fdel]) {
    if (f !== null && ops.truthy(ops.getAttrOpt(f, '__isabstractmethod__') ?? false)) return true;
  }
  return false;
});

// ───────────────────────── classmethod / staticmethod ─────────────────────────

classMethodType.alloc = (cls) => new PyClassMethod(cls, null);
staticMethodType.alloc = (cls) => new PyStaticMethod(cls, null);
for (const [t, name] of [[classMethodType, 'classmethod'], [staticMethodType, 'staticmethod']] as const) {
  t.dict!.set('__init__', mkNative('__init__', 'self, f', (self: any, f: any) => {
    self.fn = f;
    return null;
  }, { method: true, owner: name }));
  prop(t, '__func__', (x) => x.fn);
  prop(t, '__wrapped__', (x) => x.fn);
  prop(t, '__isabstractmethod__', (x) => ops.truthy(ops.getAttrOpt(x.fn, '__isabstractmethod__') ?? false));
  prop(t, '__doc__', (x) => ops.getAttrOpt(x.fn, '__doc__') ?? null);
  prop(t, '__name__', (x) => ops.getAttr(x.fn, '__name__'));
  t.flags |= F_INSTDICT;
  t.computeMro();
}
defMethods(classMethodType, {
  __get__: ['self, obj, type=', (c: any, obj: any, t: any) => {
    const target = t === undefined || t === null ? typeOf(obj) : t;
    return new BoundMethod(boundMethodType, c.fn, target);
  }],
});
defMethods(staticMethodType, {
  __get__: ['self, obj, type=', (c: any) => c.fn],
  __call__: ['self, *args, **kw', (c: any, args: any, kw: any) => callObj(c.fn, [...tupleArr(args)], kwMap(kw))],
});

// ───────────────────────── super ─────────────────────────

superType.dict!.set('__new__', mkNative('__new__', 'cls, type=, obj=', (cls: any, t?: any, o?: any) => {
  if (t === undefined) {
    // super() sin argumentos: toma __class__ y el primer argumento del marco actual
    const f = interp().frame;
    if (!f) throw makeExc(E.RuntimeError, ['super(): no arguments']);
    const code = f.code;
    if (code.argcount === 0 && code.varargsSlot < 0) throw makeExc(E.RuntimeError, ['super(): no arguments']);
    const idx = code.freeNames.indexOf('__class__');
    if (idx < 0 || !f.free) throw makeExc(E.RuntimeError, ['super(): __class__ cell not found']);
    const cl = f.free[idx].v;
    if (cl === undefined) throw makeExc(E.RuntimeError, ['super(): empty __class__ cell']);
    let first = f.l[0];
    if (first instanceof Cell) first = first.v;
    if (first === undefined) throw makeExc(E.RuntimeError, ['super(): arg[0] deleted']);
    return rt.superNew(cl, first);
  }
  if (!(t instanceof PyType)) throw typeError('super() argument 1 must be a type, not ' + typeOf(t).name);
  if (o === undefined) return new PySuper(superType, t, null, t);
  return rt.superNew(t, o);
}, { owner: 'super' }));
defMethods(superType, {
  __init__: ['self, *args, **kw', () => null],
  __repr__: ['self', (s: any) => {
    const x = s as PySuper;
    const tn = x.thisClass.name;
    return x.obj === null ? `<super: <class '${tn}'>, NULL>` : `<super: <class '${tn}'>, <${x.objType.name} object>>`;
  }],
  __get__: ['self, obj, type=', (s: any, obj: any) => (obj === null || obj === undefined ? s : rt.superNew((s as PySuper).thisClass, obj))],
});
prop(superType, '__thisclass__', (s) => s.thisClass);
prop(superType, '__self__', (s) => s.obj);
prop(superType, '__self_class__', (s) => s.objType);
superType.ownGetattro = (s: any, name: string) => rt.superGetattr(s as PySuper, name);
superType.computeMro();

// ───────────────────────── module ─────────────────────────

moduleType.flags |= F_INSTDICT;
moduleType.alloc = (cls) => new PyModule(cls, '');
moduleType.ownGetattro = (o: any, name: string): any => {
  const d = (o as PyModule).dict!;
  const e = d.m.get(name);
  if (e !== undefined) return e.v;
  const own = moduleType.lookup(name);
  if (own !== undefined) return ops.descrGet(own, o, moduleType);
  const ga = d.get('__getattr__');
  if (ga !== undefined) return callObj(ga, [name]);
  return undefined;
};
moduleType.computeMro();
moduleType.dict!.set('__init__', mkNative('__init__', 'self, name, doc=', (self: any, name: any, doc?: any) => {
  const m = self as PyModule;
  m.name = asStr(name, 'module name');
  m.dict!.set('__name__', m.name);
  m.dict!.set('__doc__', doc === undefined ? null : doc);
  m.dict!.set('__package__', null);
  m.dict!.set('__loader__', null);
  m.dict!.set('__spec__', null);
  return null;
}, { method: true, owner: 'module' }));
defMethods(moduleType, {
  __repr__: ['self', (m: any) => {
    const x = m as PyModule;
    const file = x.dict!.get('__file__');
    if (typeof file === 'string') return `<module '${x.name}' from '${file}'>`;
    return `<module '${x.name}' (built-in)>`;
  }],
  __dir__: ['self', (m: any) => {
    const d = (m as PyModule).dict!;
    const dr = d.get('__dir__');
    if (dr !== undefined) return callObj(dr, []);
    return new PyList(d.keys().filter((k: any) => typeof k === 'string').sort());
  }],
  __setattr__: ['self, name, value', (m: any, n: any, v: any) => { (m as PyModule).dict!.set(asStr(n), v); return null; }],
  __delattr__: ['self, name', (m: any, n: any) => {
    if (!(m as PyModule).dict!.delete(asStr(n))) throw attributeError(`module '${(m as PyModule).name}' has no attribute '${n}'`, n, m);
    return null;
  }],
});
// `module.__dict__`
prop(moduleType, '__dict__', (m) => (m as PyModule).dict);

// ───────────────────────── cell, frame, traceback ─────────────────────────

prop(cellType, 'cell_contents', (c: Cell) => {
  if (c.v === undefined) throw valueError('Cell is empty');
  return c.v;
}, (c: Cell, v) => { c.v = v; });
defMethods(cellType, {
  __repr__: ['self', (c: any) => (c.v === undefined ? `<cell at ${interp().hexId(c)}: empty>` : `<cell at ${interp().hexId(c)}: ${typeOf(c.v).name} object at ${interp().hexId(c.v)}>`)],
});

const fr = (x: any): Frame => (x as any).frame as Frame;
export function makeFrameObject(f: Frame): PyObject {
  const o = new PyObject(frameType);
  (o as any).frame = f;
  return o;
}
prop(frameType, 'f_code', (o) => makeCodeObject(fr(o).code));
prop(frameType, 'f_globals', (o) => fr(o).g);
prop(frameType, 'f_builtins', (o) => fr(o).b);
prop(frameType, 'f_lineno', (o) => (fr(o).pos ? fr(o).pos!.line : fr(o).code.firstLine));
prop(frameType, 'f_back', (o) => (fr(o).back ? makeFrameObject(fr(o).back!) : null));
prop(frameType, 'f_locals', (o) => {
  const f = fr(o);
  if (f.ns) return f.ns;
  const d = new PyDict();
  f.code.varnames.forEach((n, i) => {
    let v = f.l[i];
    if (v instanceof Cell) v = v.v;
    if (v !== undefined) d.set(n, v);
  });
  return d;
});
defMethods(frameType, {
  clear: ['self', (o: any) => {
    const f = fr(o);
    for (let x: any = interp().frame; x; x = x.back) if (x === f) throw makeExc(E.RuntimeError, ['cannot clear an executing frame']);
    for (let i = 0; i < f.l.length; i++) f.l[i] = undefined;
    return null;
  }],
  __repr__: ['self', (o: any) => `<frame at ${interp().hexId(o)}, file '${fr(o).code.filename}', line ${fr(o).pos ? fr(o).pos!.line : fr(o).code.firstLine}, code ${fr(o).code.name}>`],
});

const tbo = (x: any): PyTraceback => x as PyTraceback;
prop(tracebackType, 'tb_frame', (t) => (tbo(t).entry.frame ? makeFrameObject(tbo(t).entry.frame!) : null));
prop(tracebackType, 'tb_lineno', (t) => (tbo(t).entry.pos ? tbo(t).entry.pos!.line : tbo(t).entry.code.firstLine));
prop(tracebackType, 'tb_next', (t) => tbo(t).nextTb, (t, v) => {
  if (v !== null && !(v instanceof PyTraceback)) throw typeError('expected traceback object or None, got \'' + typeOf(v).name + '\'');
  for (let x: PyTraceback | null = v; x !== null; x = x.nextTb) if (x === t) throw valueError('traceback loop detected');
  tbo(t).nextTb = v;
});
prop(tracebackType, 'tb_lasti', (t) => 2 * internPos(tbo(t).entry.code, tbo(t).entry.pos));

// ───────────────────────── generadores y corrutinas ─────────────────────────

const GEN_KINDS: [PyType, string][] = [[generatorType, 'generator'], [coroutineType, 'coroutine'], [asyncGeneratorType, 'async_generator']];

const gen = (x: any): PyGenerator => x as PyGenerator;

function sendTo(g: PyGenerator, v: any): any {
  const fin = { done: false, value: null as any };
  const r = genResume(g, 0, v, fin);
  if (fin.done) throw stopIteration(fin.value);
  return r;
}

function makeThrowable(type: any, value: any, tb: any): PyBaseException {
  void tb;
  if (type instanceof PyBaseException) return type;
  if (type instanceof PyType && type.isSubtype(E.BaseException)) {
    if (value === undefined || value === null) return ops.typeCall(type, [], null);
    if (value instanceof PyBaseException) return value;
    return ops.typeCall(type, value instanceof PyTuple ? value.a.slice() : [value], null);
  }
  throw typeError('exceptions must be classes or instances deriving from BaseException, not ' + typeOf(type).name);
}

for (const [t, kind] of GEN_KINDS) {
  if (t === asyncGeneratorType) continue;
  defMethods(t, {
    __repr__: ['self', (g: any) => `<${kind} object ${gen(g).qualname} at ${interp().hexId(g)}>`],
    send: ['self, value', (g: any, v: any) => sendTo(gen(g), v)],
    throw: ['self, type, value=, traceback=', (g: any, ty: any, v?: any, tb?: any) => {
      const fin = { done: false, value: null as any };
      const exc = makeThrowable(ty, v, tb);
      const r = genThrow(gen(g), exc, fin);
      if (fin.done) throw stopIteration(fin.value);
      return r;
    }],
    close: ['self', (g: any) => { genClose(gen(g)); return null; }],
  });
  prop(t, '__name__', (g: PyGenerator) => g.name, (g: PyGenerator, v) => { g.name = v; });
  prop(t, '__qualname__', (g: PyGenerator) => g.qualname, (g: PyGenerator, v) => { g.qualname = v; });
}
for (const [t, pre] of [[generatorType, 'gi'], [coroutineType, 'cr']] as const) {
  prop(t, `${pre}_running`, (g: PyGenerator) => g.state === 2);
  prop(t, `${pre}_frame`, (g: PyGenerator) => (g.state === 3 ? null : makeFrameObject(g.frame)));
  prop(t, `${pre}_code`, (g: PyGenerator) => makeCodeObject(g.frame.code));
  prop(t, `${pre}_suspended`, (g: PyGenerator) => g.state === 1);
}
defMethods(generatorType, {
  __iter__: ['self', (g: any) => g],
  __next__: ['self', (g: any) => sendTo(gen(g), null)],
});
defMethods(coroutineType, {
  __await__: ['self', (g: any) => new CoroWrapper(g)],
});

/** Objeto devuelto por coro.__await__(): iterador que reenvía a la corrutina */
export class CoroWrapper extends PyIter {
  constructor(public coro: PyGenerator) {
    super(objectType);
  }
  next(): any {
    const fin = { done: false, value: null as any };
    const r = genResume(this.coro, 0, null, fin);
    if (fin.done) return undefined;
    return r;
  }
}

// ───────────────────────── generadores asíncronos ─────────────────────────

const agAwaitableType = newNativeType('async_generator_asend', 'builtins', [objectType], 0);
const agAthrowType = newNativeType('async_generator_athrow', 'builtins', [objectType], 0);

class AGAwait extends PyObject {
  state = 0;
  constructor(cls: PyType, public g: PyGenerator, public kind: 'send' | 'throw' | 'close', public arg: any) {
    super(cls);
  }
}

function agInitHooks(g: PyGenerator): void {
  const gg = g as any;
  if (gg.hooksInit) return;
  gg.hooksInit = true;
  const hooks = interp().extraFlags.agenHooks as any[] | undefined;
  if (hooks && hooks[0] !== null && hooks[0] !== undefined) callObj(hooks[0], [g]);
}

function agStep(a: AGAwait, mode: 0 | 1, val: any): any {
  const g = a.g;
  if (a.state === 2) throw makeExc(E.RuntimeError, ['cannot reuse already awaited __anext__()/asend()']);
  if (a.state === 0) {
    a.state = 1;
    if (a.kind === 'send') { mode = 0; val = a.arg; }
    else if (a.kind === 'throw') { mode = 1; val = a.arg; }
    else { mode = 1; val = makeExc(E.GeneratorExit, []); }
  }
  const fin = { done: false, value: null as any };
  let y: any;
  try {
    y = genResume(g, mode, val, fin);
  } catch (e) {
    a.state = 2;
    if (e instanceof PyBaseException) {
      if (a.kind === 'close' && (ops.isInstance(e, E.GeneratorExit) || ops.isInstance(e, E.StopAsyncIteration))) throw stopIteration(null);
      if (ops.isInstance(e, E.StopIteration) || ops.isInstance(e, E.StopAsyncIteration)) {
        const r = makeExc(E.RuntimeError, [`async generator raised ${e.cls.name}`]);
        r.cause = e;
        r.context = e;
        r.suppressContext = true;
        throw r;
      }
    }
    throw e;
  }
  if (fin.done) {
    a.state = 2;
    if (a.kind === 'close') throw stopIteration(null);
    throw makeExc(E.StopAsyncIteration, []);
  }
  if (y instanceof AGYield) {
    a.state = 2;
    if (a.kind === 'close') throw makeExc(E.RuntimeError, ['async generator ignored GeneratorExit']);
    throw stopIteration(y.v);
  }
  return y;
}

for (const t of [agAwaitableType, agAthrowType]) {
  defMethods(t, {
    __await__: ['self', (a: any) => a],
    __iter__: ['self', (a: any) => a],
    __next__: ['self', (a: any) => agStep(a, 0, null)],
    send: ['self, value', (a: any, v: any) => agStep(a, 0, v)],
    throw: ['self, type, value=, traceback=', (a: any, ty: any, v?: any, tb?: any) => agStep(a, 1, makeThrowable(ty, v, tb))],
    close: ['self', (a: any) => { (a as AGAwait).state = 2; return null; }],
  });
}

defMethods(asyncGeneratorType, {
  __repr__: ['self', (g: any) => `<async_generator object ${gen(g).qualname} at ${interp().hexId(g)}>`],
  __aiter__: ['self', (g: any) => g],
  __anext__: ['self', (g: any) => { agInitHooks(gen(g)); return new AGAwait(agAwaitableType, gen(g), 'send', null); }],
  asend: ['self, value', (g: any, v: any) => { agInitHooks(gen(g)); return new AGAwait(agAwaitableType, gen(g), 'send', v); }],
  athrow: ['self, type, value=, traceback=', (g: any, ty: any, v?: any, tb?: any) => {
    agInitHooks(gen(g));
    return new AGAwait(agAthrowType, gen(g), 'throw', makeThrowable(ty, v, tb));
  }],
  aclose: ['self', (g: any) => { agInitHooks(gen(g)); return new AGAwait(agAthrowType, gen(g), 'close', null); }],
});
prop(asyncGeneratorType, '__name__', (g: PyGenerator) => g.name, (g: PyGenerator, v) => { g.name = v; });
prop(asyncGeneratorType, '__qualname__', (g: PyGenerator) => g.qualname, (g: PyGenerator, v) => { g.qualname = v; });
prop(asyncGeneratorType, 'ag_running', (g: PyGenerator) => g.state === 2);
prop(asyncGeneratorType, 'ag_frame', (g: PyGenerator) => (g.state === 3 ? null : makeFrameObject(g.frame)));
prop(asyncGeneratorType, 'ag_code', (g: PyGenerator) => makeCodeObject(g.frame.code));
prop(asyncGeneratorType, 'ag_await', () => null);

void [noneType, Cell, excStr, Kw0()];
function Kw0(): null { return null; }
export type { Kw };
export { makeCodeObject, prop as defProp };
