/**
 * Funciones y constantes del módulo `builtins`.
 */
import {
  BoundMethod, NativeFunction, PyBaseException, PyBox, PyByteArray, PyBytes, PyDict, PyFloat, PyFunction, PyGenerator, PyList, PyModule,
  PyObject, PyTuple, PyType, type Kw,
} from './objects';
import {
  Ellipsis, NotImplemented, allBuiltinTypes, boundMethodType, moduleType, objectType, typeOf, typeType, strType, intType, floatType,
  boolType, listType, tupleType, dictType, setType, frozenSetType, rangeType, sliceType, bytesType, byteArrayType, enumerateType, zipType,
  mapType, filterType, reversedType, propertyType, classMethodType, staticMethodType, superType, complexType, memoryViewType,
} from './builtin_types';
import { E, excTypes } from './exc_types';
import { eofError, makeExc, NeedInput, overflowError, typeError, valueError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { interp } from './state';
import { fn as nativeFn, mkNative } from './native';
import { asIdx, asStr, kwMap, tupleArr } from './util';
import { sortItems, CallableIter, PyEnumerate } from './t_seq';
import { toFloatValue } from './t_num';
import { bigAbs } from './fmt';
import { PyIter } from './objects';
import { compileSource, runCode } from '../compile';
import { PySyntaxErr } from '../lexer';
import { syntaxErrToExc, emitWarnings } from './traceback';
import { intAdd, intCmp, intSign, toBig, normBig, type PyInt } from './numeric';
import { decodeUtf8 } from './interp';

type Builtin = NativeFunction;
export const BUILTIN_FUNCS: Record<string, Builtin> = {};

function def(name: string, sig: string, impl: (...a: any[]) => any): void {
  BUILTIN_FUNCS[name] = nativeFn(name, sig, impl, { module: 'builtins' });
}

// ───────────────────────── salida / entrada ─────────────────────────

export function writeOut(text: string, isErr = false): void {
  const I = interp();
  I.write(text, isErr);
}

function stdStream(name: 'stdout' | 'stderr' | 'stdin'): any {
  const I = interp();
  const sys = I.sysModule;
  return sys ? sys.dict!.get(name) : undefined;
}

def('print', '*args, sep=, end=, file=, flush=', (args: any, sep?: any, end?: any, file?: any) => {
  const a = tupleArr(args);
  const s = sep === undefined || sep === null ? ' ' : asSepStr(sep, 'sep');
  const e = end === undefined || end === null ? '\n' : asSepStr(end, 'end');
  let text = '';
  for (let i = 0; i < a.length; i++) {
    if (i > 0) text += s;
    text += ops.str(a[i]);
  }
  text += e;
  const I = interp();
  let target = file;
  if (target === undefined || target === null) target = stdStream('stdout');
  if (target === undefined || target === null) return null;
  if (target === I.extraFlags.stdoutObj) I.write(text, false);
  else if (target === I.extraFlags.stderrObj) I.write(text, true);
  else ops.callMethod(target, 'write', [text]);
  return null;
});
function asSepStr(x: any, name: string): string {
  if (ops.isStr(x)) return ops.strValue(x);
  throw typeError(`${name} must be None or a string, not ${typeOf(x).name}`);
}

def('input', 'prompt=', (prompt?: any) => {
  const I = interp();
  const p = prompt === undefined ? '' : ops.str(prompt);
  const stdin = stdStream('stdin');
  if (stdin !== undefined && stdin !== I.extraFlags.stdinObj && stdin !== null) {
    if (p) {
      const so = stdStream('stdout');
      if (so === I.extraFlags.stdoutObj) I.write(p, false);
      else ops.callMethod(so, 'write', [p]);
    }
    const line = ops.callMethod(stdin, 'readline', []);
    const s = ops.strValue(line);
    if (s === '') throw eofError('EOF when reading a line');
    return s.endsWith('\n') ? s.slice(0, -1) : s;
  }
  if (I.stdinPos < I.stdinLines.length) {
    if (p) I.write(p, false);
    const line = I.stdinLines[I.stdinPos++];
    if (line === null) throw eofError('EOF when reading a line');
    return line;
  }
  if (I.needInput) return I.needInput(p);
  if (p) I.write(p, false);
  throw eofError('EOF when reading a line');
});
void NeedInput;

// ───────────────────────── conversiones y consultas básicas ─────────────────────────

def('len', 'obj, /', (x: any) => ops.lenOf(x));
def('repr', 'obj, /', (x: any) => ops.repr(x));
def('ascii', 'obj, /', (x: any) => ops.ascii(x));
def('abs', 'x, /', (x: any) => {
  if (typeof x === 'number') return x < 0 ? -x : x === 0 ? 0 : x;
  if (x instanceof PyFloat) return new PyFloat(Math.abs(x.v));
  if (typeof x === 'bigint') return bigAbs(x);
  if (typeof x === 'boolean') return x ? 1 : 0;
  const t = typeOf(x);
  const f = t.lookup('__abs__');
  if (f === undefined) throw typeError(`bad operand type for abs(): '${t.name}'`);
  return callObj(f, [x]);
});
def('callable', 'obj, /', (x: any) => ops.isCallable(x));
def('chr', 'i, /', (x: any) => {
  const iv = ops.toIndex(x, `'${typeOf(x).name}' object cannot be interpreted as an integer`);
  if (typeof iv === 'bigint' || iv < 0 || iv > 0x10ffff) throw valueError('chr() arg not in range(0x110000)');
  return String.fromCodePoint(iv);
});
def('ord', 'c, /', (c: any) => {
  if (ops.isStr(c)) {
    const s = ops.strValue(c);
    const cs = Array.from(s);
    if (cs.length !== 1) throw typeError(`ord() expected a character, but string of length ${cs.length} found`);
    return cs[0].codePointAt(0)!;
  }
  if (c instanceof PyBytes || c instanceof PyByteArray) {
    if (c.b.length !== 1) throw typeError(`ord() expected a character, but string of length ${c.b.length} found`);
    return c.b[0];
  }
  throw typeError(`ord() expected string of length 1, but ${typeOf(c).name} found`);
});
function baseStr(x: any, base: number, prefix: string): string {
  const v = ops.toIndex(x, `'${typeOf(x).name}' object cannot be interpreted as an integer`);
  const neg = intSign(v) < 0;
  const abs = typeof v === 'bigint' ? bigAbs(v) : Math.abs(v);
  return (neg ? '-' : '') + prefix + abs.toString(base);
}
def('bin', 'number, /', (x: any) => baseStr(x, 2, '0b'));
def('oct', 'number, /', (x: any) => baseStr(x, 8, '0o'));
def('hex', 'number, /', (x: any) => baseStr(x, 16, '0x'));
def('hash', 'obj, /', (x: any) => ops.hashOf(x));
def('id', 'obj, /', (x: any) => interp().idOf(x));
def('isinstance', 'obj, class_or_tuple, /', (x: any, c: any) => ops.isinstanceCheck(x, c));
def('issubclass', 'cls, class_or_tuple, /', (c: any, t: any) => ops.issubclassCheck(c, t));
def('format', 'value, format_spec=, /', (v: any, spec?: any) => {
  const s = spec === undefined ? '' : asStr(spec, 'format() argument 2');
  return ops.formatValue(v, s);
});
def('getattr', 'object, name, default=, /', (o: any, name: any, d?: any) => {
  const n = asStr(name, 'getattr(): attribute name');
  if (d === undefined) return ops.getAttr(o, n);
  try {
    return ops.getAttr(o, n);
  } catch (e) {
    if (e instanceof PyBaseException && ops.isInstance(e, E.AttributeError)) return d;
    throw e;
  }
});
def('setattr', 'obj, name, value, /', (o: any, name: any, v: any) => { ops.setAttr(o, asStr(name, 'setattr(): attribute name'), v); return null; });
def('delattr', 'obj, name, /', (o: any, name: any) => { ops.delAttr(o, asStr(name, 'delattr(): attribute name')); return null; });
def('hasattr', 'obj, name, /', (o: any, name: any) => ops.hasAttr(o, asStr(name, 'hasattr(): attribute name')));

def('iter', 'object, sentinel=, /', (o: any, sentinel?: any) => {
  if (sentinel === undefined) return ops.pyIter(o);
  if (!ops.isCallable(o)) throw typeError('iter(v, w): v must be callable');
  return new CallableIter(o, sentinel);
});
def('next', 'iterator, default=, /', (it: any, d?: any) => {
  if (d === undefined) return ops.pyNext(it);
  try {
    return ops.pyNext(it);
  } catch (e) {
    if (e instanceof PyBaseException && ops.isInstance(e, E.StopIteration)) return d;
    throw e;
  }
});
def('aiter', 'async_iterable, /', (o: any) => {
  const f = typeOf(o).lookup('__aiter__');
  if (f === undefined) throw typeError(`'${typeOf(o).name}' object is not an async iterable`);
  return callObj(f, [o]);
});
def('anext', 'async_iterator, default=, /', (o: any, d?: any) => {
  const f = typeOf(o).lookup('__anext__');
  if (f === undefined) throw typeError(`'${typeOf(o).name}' object is not an async iterator`);
  void d;
  return callObj(f, [o]);
});

def('all', 'iterable, /', (it: any) => {
  const i = ops.getIter(it);
  for (;;) {
    const v = i.next();
    if (v === undefined) return true;
    if (!ops.truthy(v)) return false;
  }
});
def('any', 'iterable, /', (it: any) => {
  const i = ops.getIter(it);
  for (;;) {
    const v = i.next();
    if (v === undefined) return false;
    if (ops.truthy(v)) return true;
  }
});

def('sorted', 'iterable, /, *, key=, reverse=', (it: any, key?: any, rev?: any) => {
  const items = ops.iterToArray(it);
  sortItems(items, key, rev !== undefined && ops.truthy(rev));
  return new PyList(items);
});

// ───────────────────────── min / max / sum ─────────────────────────

function minmax(name: 'min' | 'max', args: any, key?: any, dflt?: any): any {
  const a = tupleArr(args);
  if (a.length === 0) throw typeError(`${name} expected at least 1 argument, got 0`);
  let items: any[];
  if (a.length === 1) items = ops.iterToArray(a[0]);
  else {
    if (dflt !== undefined) throw typeError(`Cannot specify a default for ${name}() with multiple positional arguments`);
    items = a;
  }
  if (items.length === 0) {
    if (dflt !== undefined) return dflt;
    throw valueError(`${name}() iterable argument is empty`);
  }
  const op = name === 'max' ? '>' : '<';
  const hasKey = key !== undefined && key !== null;
  let best = items[0];
  let bestK = hasKey ? callObj(key, [best]) : best;
  for (let i = 1; i < items.length; i++) {
    const v = items[i];
    const k = hasKey ? callObj(key, [v]) : v;
    if (ops.cmpBool(op, k, bestK)) { best = v; bestK = k; }
  }
  return best;
}
def('min', '*args, key=, default=', (args: any, key?: any, d?: any) => minmax('min', args, key, d));
def('max', '*args, key=, default=', (args: any, key?: any, d?: any) => minmax('max', args, key, d));

def('sum', 'iterable, /, start=', (it: any, start?: any) => {
  const iter = ops.getIter(it);
  let result: any = start === undefined ? 0 : start;
  if (ops.isStr(result) && start !== undefined) throw typeError("sum() can't sum strings [use ''.join(seq) instead]");
  if (result instanceof PyBytes) throw typeError("sum() can't sum bytes [use b''.join(seq) instead]");
  if (result instanceof PyByteArray) throw typeError("sum() can't sum bytearray [use b''.join(seq) instead]");
  let v = iter.next();
  // camino entero
  if (typeof result === 'number' || typeof result === 'bigint') {
    while (v !== undefined && (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean')) {
      result = intAdd(result, typeof v === 'boolean' ? (v ? 1 : 0) : v);
      v = iter.next();
    }
  }
  // camino float con compensación de Neumaier (Python ≥ 3.12)
  if (result instanceof PyFloat || (typeof result === 'number' && v instanceof PyFloat)) {
    let f = result instanceof PyFloat ? result.v : Number(result);
    let c = 0;
    while (v !== undefined) {
      let x: number;
      if (v instanceof PyFloat) x = v.v;
      else if (typeof v === 'number') x = v;
      else if (typeof v === 'boolean') x = v ? 1 : 0;
      else break;
      const t = f + x;
      if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
      else c += (x - t) + f;
      f = t;
      v = iter.next();
    }
    if (c !== 0 && isFinite(c)) f += c;
    result = new PyFloat(f);
  }
  while (v !== undefined) {
    result = ops.opAdd(result, v);
    v = iter.next();
  }
  return result;
});

// ───────────────────────── aritmética ─────────────────────────

def('divmod', 'x, y, /', (a: any, b: any) => {
  const ta = typeOf(a);
  const tb = typeOf(b);
  const ia = ops.intValue(a);
  const ib = ops.intValue(b);
  if (ia !== undefined && ib !== undefined && !(a instanceof PyBox) && !(b instanceof PyBox)) {
    return callObj(intType.lookup('__divmod__'), [a, b]);
  }
  let f = ta.lookup('__divmod__');
  if (f !== undefined) {
    const r = callObj(f, [a, b]);
    if (r !== NotImplemented) return r;
  }
  f = tb.lookup('__rdivmod__');
  if (f !== undefined) {
    const r = callObj(f, [b, a]);
    if (r !== NotImplemented) return r;
  }
  throw typeError(`unsupported operand type(s) for divmod(): '${ta.name}' and '${tb.name}'`);
});
def('pow', 'base, exp, mod=', (a: any, b: any, m?: any) => {
  if (m === undefined || m === null) return ops.BINOPS['**'](a, b);
  const ta = typeOf(a);
  const f = ta.lookup('__pow__');
  if (f === undefined) throw typeError(`unsupported operand type(s) for pow(): '${ta.name}', '${typeOf(b).name}', '${typeOf(m).name}'`);
  const r = callObj(f, [a, b, m]);
  if (r === NotImplemented) throw typeError(`unsupported operand type(s) for pow(): '${ta.name}', '${typeOf(b).name}', '${typeOf(m).name}'`);
  return r;
});
def('round', 'number, ndigits=', (x: any, nd?: any) => {
  const t = typeOf(x);
  const f = t.lookup('__round__');
  if (f === undefined) throw typeError(`type ${t.name} doesn't define __round__ method`);
  return nd === undefined || nd === null ? callObj(f, [x]) : callObj(f, [x, nd]);
});

// ───────────────────────── introspección ─────────────────────────

def('dir', 'object=, /', (o?: any) => {
  const I = interp();
  let names: string[];
  if (o === undefined) {
    const f = I.frame;
    const d = f ? (f.ns ?? f.g) : I.mainGlobals;
    if (f && !f.ns && f.code.kind !== 'module') {
      names = f.code.varnames.filter((n, i) => f.l[i] !== undefined);
    } else names = (d ? d.keys() : []).map(String);
  } else {
    const f = typeOf(o).lookup('__dir__');
    const r = callObj(f, [o]);
    names = ops.iterToArray(r).map((x: any) => String(x));
  }
  return new PyList([...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});
def('globals', '', () => {
  const f = interp().frame;
  return f ? f.g : interp().mainGlobals;
});
def('locals', '', () => {
  const f = interp().frame;
  if (!f) return interp().mainGlobals;
  if (f.ns) return f.ns;
  const d = new PyDict();
  f.code.varnames.forEach((n, i) => {
    let v = f.l[i];
    if (v && (v as any).constructor && (v as any).constructor.name === 'Cell') v = (v as any).v;
    if (v !== undefined) d.set(n, v);
  });
  return d;
});
def('vars', 'object=, /', (o?: any) => {
  if (o === undefined) {
    const f = interp().frame;
    return f ? (f.ns ?? f.g) : interp().mainGlobals;
  }
  if (o instanceof PyType) {
    const mp = new PyObject(require('./builtin_types').mappingProxyType);
    (mp as any).target = o.dict;
    return mp;
  }
  if (o instanceof PyObject && o.dict) return o.dict;
  if (o instanceof PyModule) return o.dict;
  throw typeError('vars() argument must have __dict__ attribute');
});

// ───────────────────────── eval / exec / compile ─────────────────────────

function srcOf(x: any, fn: string): string {
  if (ops.isStr(x)) return ops.strValue(x);
  if (x instanceof PyBytes || x instanceof PyByteArray) return decodeUtf8(Uint8Array.from(x.b as any));
  throw typeError(`${fn}() arg 1 must be a string, bytes or code object`);
}

function runSource(fnName: 'eval' | 'exec', src: any, g?: any, l?: any): any {
  const I = interp();
  const f = I.frame;
  let gd: PyDict;
  let ld: PyDict | null;
  if (g === undefined || g === null) {
    gd = f ? f.g : I.mainGlobals!;
    ld = f ? (f.ns ?? (f.code.kind === 'module' ? f.g : localsDict(f))) : gd;
  } else {
    if (!(g instanceof PyDict)) throw typeError(`${fnName}() globals must be a dict, not ${typeOf(g).name}`);
    gd = g;
    ld = l === undefined || l === null ? gd : (l as PyDict);
  }
  if (!gd.has('__builtins__')) gd.set('__builtins__', I.builtins);
  if (src instanceof PyObject && (src as any).code) {
    return runCode(I, (src as any).code, gd, ld);
  }
  const text = srcOf(src, fnName);
  const filename = '<string>';
  try {
    const unit = compileSource(I, fnName === 'eval' ? text.trim() : text, { filename, mode: fnName === 'eval' ? 'eval' : 'exec' });
    emitWarnings(I, unit.warnings, filename, unit.lines);
    return runCode(I, unit.code, gd, ld);
  } catch (e) {
    if (e instanceof PySyntaxErr) throw syntaxErrToExc(e, filename, text);
    throw e;
  }
}
function localsDict(f: any): PyDict {
  const d = new PyDict();
  f.code.varnames.forEach((n: string, i: number) => {
    let v = f.l[i];
    if (v && v.constructor && v.constructor.name === 'Cell') v = v.v;
    if (v !== undefined) d.set(n, v);
  });
  return d;
}
def('eval', 'source, globals=, locals=, /', (s: any, g?: any, l?: any) => runSource('eval', s, g, l));
def('exec', 'source, globals=, locals=, /, *, closure=', (s: any, g?: any, l?: any) => { runSource('exec', s, g, l); return null; });
def('compile', 'source, filename, mode, flags=, dont_inherit=, optimize=', (src: any, filename: any, mode: any) => {
  const I = interp();
  const text = srcOf(src, 'compile');
  const fname = asStr(filename);
  const m = asStr(mode);
  if (m !== 'exec' && m !== 'eval' && m !== 'single') throw valueError("compile() mode must be 'exec', 'eval' or 'single'");
  try {
    const unit = compileSource(I, text, { filename: fname, mode: m === 'eval' ? 'eval' : 'exec' });
    const o = new PyObject(require('./builtin_types').codeType);
    (o as any).code = unit.code;
    return o;
  } catch (e) {
    if (e instanceof PySyntaxErr) throw syntaxErrToExc(e, fname, text);
    throw e;
  }
});

// ───────────────────────── import ─────────────────────────

def('__import__', 'name, globals=, locals=, fromlist=, level=', (name: any, g?: any, l?: any, fl?: any, level?: any) => {
  const { importName } = require('./modules') as typeof import('./modules');
  const I = interp();
  const lv = level === undefined ? 0 : asIdx(level);
  const from = fl === undefined || fl === null ? null : ops.iterToArray(fl).map(String);
  return importName(I, asStr(name), from && from.length ? from : null, lv, g instanceof PyDict ? g : null, false);
});

// ───────────────────────── salir ─────────────────────────

function exitFn(name: string): void {
  def(name, 'code=', (code?: any) => {
    const e = makeExc(E.SystemExit, code === undefined ? [] : [code]);
    throw e;
  });
}
exitFn('exit');
exitFn('quit');
def('help', 'request=', (o?: any) => {
  const I = interp();
  if (o === undefined) {
    I.write('Welcome to Python! Usa help(objeto) para ver la documentación de un objeto.\n', false);
    return null;
  }
  let name = typeof o === 'string' ? o : o instanceof PyType ? o.name : o instanceof PyFunction ? o.name : o instanceof PyModule ? o.name : typeOf(o).name;
  const doc = ops.getAttrOpt(o, '__doc__');
  I.write(`Help on ${o instanceof PyType ? 'class' : o instanceof PyModule ? 'module' : o instanceof PyFunction ? 'function' : 'object'} ${name}:\n\n`, false);
  if (typeof doc === 'string') I.write(doc + '\n', false);
  name = '';
  return null;
});
def('breakpoint', '*args, **kw', () => null);

// ───────────────────────── tipos y excepciones como globales ─────────────────────────

export const BUILTIN_TYPES: Record<string, any> = {
  object: objectType, type: typeType, str: strType, int: intType, float: floatType, bool: boolType, list: listType, tuple: tupleType,
  dict: dictType, set: setType, frozenset: frozenSetType, range: rangeType, slice: sliceType, bytes: bytesType, bytearray: byteArrayType,
  enumerate: enumerateType, zip: zipType, map: mapType, filter: filterType, reversed: reversedType, property: propertyType,
  classmethod: classMethodType, staticmethod: staticMethodType, super: superType, complex: complexType, memoryview: memoryViewType,
};

export function installBuiltins(d: PyDict): void {
  for (const [k, v] of Object.entries(BUILTIN_FUNCS)) d.set(k, v);
  for (const [k, v] of Object.entries(BUILTIN_TYPES)) d.set(k, v);
  for (const [k, v] of Object.entries(excTypes)) d.set(k, v);
  d.set('None', null);
  d.set('True', true);
  d.set('False', false);
  d.set('Ellipsis', Ellipsis);
  d.set('NotImplemented', NotImplemented);
  d.set('__debug__', true);
  d.set('__name__', 'builtins');
  d.set('__doc__', 'Built-in functions, types, exceptions, and other objects.');
  d.set('__build_class__', nativeFn('__build_class__', '*args, **kw', () => { throw typeError('__build_class__ no está disponible'); }));
  d.set('EnvironmentError', E.OSError);
  d.set('IOError', E.OSError);
}

void [BoundMethod, boundMethodType, moduleType, allBuiltinTypes, PyGenerator, PyIter, PyEnumerate, PyTuple, toFloatValue, mkNative, kwMap, overflowError, intCmp, toBig, normBig, ops.mkList];
export type { Kw, PyInt };
