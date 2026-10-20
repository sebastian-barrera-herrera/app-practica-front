/**
 * Comportamiento de las excepciones: `args`, `__str__`, `__repr__`, atributos específicos (`OSError`, `KeyError`,
 * `StopIteration`, `SyntaxError`, `ImportError`…), notas, encadenado y grupos de excepciones.
 */
import { F_INSTDICT, PyBaseException, PyDict, PyList, PyObject, PyProperty, PyTuple, PyType } from './objects';
import { NotImplemented, propertyType, typeOf } from './builtin_types';
import { E, excTypes } from './exc_types';
import { attributeError, typeError, valueError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import * as rt from './rt';
import { defMethods, mkNative } from './native';
import { asStr, kwMap, tupleArr } from './util';
import { strRepr } from './fmt';

const B = E.BaseException;

for (const t of Object.values(excTypes)) {
  if (t === B) { t.flags |= F_INSTDICT; t.alloc = (cls) => new PyBaseException(cls); }
  t.computeMro();
}

function ex(x: any): PyBaseException {
  if (x instanceof PyBaseException) return x;
  throw typeError(`descriptor requires a 'BaseException' object but received a '${typeOf(x).name}'`);
}
const extra = (e: PyBaseException): Record<string, any> => (e.extra ??= {});

function prop(t: PyType, name: string, get: (e: PyBaseException) => any, set?: (e: PyBaseException, v: any) => void): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', (e: any) => get(ex(e)), { method: true });
  if (set) p.fset = mkNative(name, 'self, value', (e: any, v: any) => { set(ex(e), v); return null; }, { method: true });
  p.owner = t;
  t.dict!.set(name, p);
}

// ───────────────────────── BaseException ─────────────────────────

B.dict!.set('__new__', mkNative('__new__', 'cls, *args, **kw', (cls: any, args: any) => {
  const e = ops.newObject(cls) as PyBaseException;
  e.args = tupleArr(args).slice();
  const I = (require('./state') as typeof import('./state')).activeOrNull();
  if (I !== null && I.curExc !== null) e.context = I.curExc;
  return e;
}, { owner: 'BaseException' }));
B.dict!.set('__init__', mkNative('__init__', 'self, *args, **kw', (self: any, args: any, kw: any) => {
  if (kw instanceof PyDict && kw.size > 0) throw typeError(`${typeOf(self).name}() takes no keyword arguments`);
  ex(self).args = tupleArr(args).slice();
  return null;
}, { method: true, owner: 'BaseException' }));

function excStrDefault(e: PyBaseException): string {
  switch (e.args.length) {
    case 0: return '';
    case 1: return ops.str(e.args[0]);
    default: return ops.repr(new PyTuple(e.args));
  }
}

defMethods(B, {
  __str__: ['self', (e: any) => excStrDefault(ex(e))],
  __repr__: ['self', (e: any) => {
    const x = ex(e);
    const name = typeOf(x).name;
    if (x.args.length === 1) return `${name}(${ops.repr(x.args[0])})`;
    return `${name}(${x.args.map(ops.repr).join(', ')})`;
  }],
  with_traceback: ['self, tb', (e: any, tb: any) => { extra(ex(e)).tbOverride = tb; return e; }],
  add_note: ['self, note', (e: any, n: any) => {
    const x = ex(e);
    if (!ops.isStr(n)) throw typeError('note must be a str, not ' + typeOf(n).name);
    let notes = x.dict ? x.dict.get('__notes__') : undefined;
    if (notes === undefined) {
      notes = new PyList([]);
      if (!x.dict) x.dict = new PyDict();
      x.dict.set('__notes__', notes);
    }
    (notes as PyList).a.push(n);
    return null;
  }],
  __reduce__: ['self', (e: any) => {
    const x = ex(e);
    return new PyTuple([typeOf(x), new PyTuple(x.args.slice()), x.dict && x.dict.size > 0 ? x.dict : null]);
  }],
  __setstate__: ['self, state', (e: any, st: any) => {
    const x = ex(e);
    if (st instanceof PyDict) {
      if (!x.dict) x.dict = new PyDict();
      for (const en of st.m.values()) x.dict.set(en.k, en.v);
    }
    return null;
  }],
});
prop(B, 'args', (e) => new PyTuple(e.args.slice()), (e, v) => { e.args = ops.iterToArray(v); });
prop(B, '__traceback__', (e) => {
  const o = e.extra ? e.extra.tbOverride : undefined;
  if (o !== undefined) return o;
  return rt.tracebackOf(e);
}, (e, v) => { extra(e).tbOverride = v; });
prop(B, '__cause__', (e) => e.cause, (e, v) => {
  if (v !== null && !(v instanceof PyBaseException)) throw typeError('exception cause must be None or derive from BaseException');
  e.cause = v;
  e.suppressContext = true;
});
prop(B, '__context__', (e) => e.context, (e, v) => {
  if (v !== null && !(v instanceof PyBaseException)) throw typeError('exception context must be None or derive from BaseException');
  e.context = v;
});
prop(B, '__suppress_context__', (e) => e.suppressContext, (e, v) => { e.suppressContext = ops.truthy(v); });

// ───────────────────────── KeyError ─────────────────────────

defMethods(E.KeyError, {
  __str__: ['self', (e: any) => {
    const x = ex(e);
    if (x.args.length === 1) return ops.repr(x.args[0]);
    return excStrDefault(x);
  }],
});

// ───────────────────────── StopIteration / SystemExit ─────────────────────────

E.StopIteration.dict!.set('__init__', mkNative('__init__', 'self, *args', (self: any, args: any) => {
  const x = ex(self);
  x.args = tupleArr(args).slice();
  extra(x).value = x.args.length > 0 ? x.args[0] : null;
  return null;
}, { method: true, owner: 'StopIteration' }));
prop(E.StopIteration, 'value', (e) => {
  const v = extra(e).value;
  if (v !== undefined) return v;
  return e.args.length > 0 ? e.args[0] : null;
}, (e, v) => { extra(e).value = v; });
prop(E.StopAsyncIteration, 'value', (e) => (e.args.length > 0 ? e.args[0] : null));

prop(E.SystemExit, 'code', (e) => {
  if (e.extra && e.extra.code !== undefined) return e.extra.code;
  return e.args.length === 0 ? null : e.args.length === 1 ? e.args[0] : new PyTuple(e.args);
}, (e, v) => { extra(e).code = v; });

// ───────────────────────── AttributeError / NameError / ImportError ─────────────────────────

E.AttributeError.dict!.set('__init__', mkNative('__init__', 'self, *args, name=, obj=', (self: any, args: any, name?: any, obj?: any) => {
  const x = ex(self);
  x.args = tupleArr(args).slice();
  if (name !== undefined) extra(x).name = name;
  if (obj !== undefined) extra(x).obj = obj;
  return null;
}, { method: true, owner: 'AttributeError' }));
prop(E.AttributeError, 'name', (e) => (e.extra && e.extra.name !== undefined ? e.extra.name : null), (e, v) => { extra(e).name = v; });
prop(E.AttributeError, 'obj', (e) => (e.extra && e.extra.obj !== undefined ? e.extra.obj : null), (e, v) => { extra(e).obj = v; });

E.NameError.dict!.set('__init__', mkNative('__init__', 'self, *args, name=', (self: any, args: any, name?: any) => {
  const x = ex(self);
  x.args = tupleArr(args).slice();
  if (name !== undefined) extra(x).name = name;
  return null;
}, { method: true, owner: 'NameError' }));
prop(E.NameError, 'name', (e) => (e.extra && e.extra.name !== undefined ? e.extra.name : null), (e, v) => { extra(e).name = v; });

E.ImportError.dict!.set('__init__', mkNative('__init__', 'self, *args, name=, path=', (self: any, args: any, name?: any, path?: any) => {
  const x = ex(self);
  x.args = tupleArr(args).slice();
  const ex_ = extra(x);
  if (name !== undefined) ex_.name = name;
  if (path !== undefined) ex_.path = path;
  ex_.msg = x.args.length > 0 ? x.args[0] : null;
  return null;
}, { method: true, owner: 'ImportError' }));
prop(E.ImportError, 'name', (e) => (e.extra && e.extra.name !== undefined ? e.extra.name : null), (e, v) => { extra(e).name = v; });
prop(E.ImportError, 'path', (e) => (e.extra && e.extra.path !== undefined ? e.extra.path : null), (e, v) => { extra(e).path = v; });
prop(E.ImportError, 'msg', (e) => (e.extra && e.extra.msg !== undefined ? e.extra.msg : e.args.length > 0 ? e.args[0] : null), (e, v) => { extra(e).msg = v; });

// ───────────────────────── OSError ─────────────────────────

const ERRNO_CLASS: Record<number, string> = {
  1: 'PermissionError', 2: 'FileNotFoundError', 3: 'ProcessLookupError', 4: 'InterruptedError', 5: 'OSError', 9: 'OSError',
  10: 'ChildProcessError', 11: 'BlockingIOError', 13: 'PermissionError', 17: 'FileExistsError', 20: 'NotADirectoryError',
  21: 'IsADirectoryError', 32: 'BrokenPipeError', 103: 'ConnectionAbortedError', 104: 'ConnectionResetError', 111: 'ConnectionRefusedError',
  110: 'TimeoutError',
};

E.OSError.dict!.set('__new__', mkNative('__new__', 'cls, *args, **kw', (cls: any, args: any) => {
  const a = tupleArr(args);
  let c: PyType = cls;
  if (c === E.OSError && a.length >= 2) {
    const en = ops.intValue(a[0]);
    if (en !== undefined && typeof en === 'number' && ERRNO_CLASS[en]) c = excTypes[ERRNO_CLASS[en]];
  }
  const e = ops.newObject(c) as PyBaseException;
  e.args = a.slice();
  const x = extra(e);
  if (a.length >= 2) {
    x.errno = a[0];
    x.strerror = a[1];
    if (a.length >= 3) x.filename = a[2];
    if (a.length >= 5) x.filename2 = a[4];
    if (a.length > 2) e.args = a.slice(0, 2);
  }
  const I = (require('./state') as typeof import('./state')).activeOrNull();
  if (I !== null && I.curExc !== null) e.context = I.curExc;
  return e;
}, { owner: 'OSError' }));
E.OSError.dict!.set('__init__', mkNative('__init__', 'self, *args, **kw', () => null, { method: true, owner: 'OSError' }));
for (const k of ['errno', 'strerror', 'filename', 'filename2']) {
  prop(E.OSError, k, (e) => (e.extra && e.extra[k] !== undefined && e.extra[k] !== null ? e.extra[k] : null), (e, v) => { extra(e)[k] = v; });
}
prop(E.OSError, 'characters_written', (e) => (e.extra && e.extra.characters_written) ?? 0);
defMethods(E.OSError, {
  __str__: ['self', (e: any) => {
    const x = ex(e);
    const d = x.extra ?? {};
    if (d.filename !== undefined && d.filename !== null) {
      if (d.filename2 !== undefined && d.filename2 !== null) return `[Errno ${ops.str(d.errno)}] ${ops.str(d.strerror)}: ${ops.repr(d.filename)} -> ${ops.repr(d.filename2)}`;
      return `[Errno ${ops.str(d.errno)}] ${ops.str(d.strerror)}: ${ops.repr(d.filename)}`;
    }
    if (d.errno !== undefined && d.strerror !== undefined) return `[Errno ${ops.str(d.errno)}] ${ops.str(d.strerror)}`;
    return excStrDefault(x);
  }],
});

// ───────────────────────── SyntaxError ─────────────────────────

E.SyntaxError.dict!.set('__init__', mkNative('__init__', 'self, *args', (self: any, args: any) => {
  const x = ex(self);
  const a = tupleArr(args).slice();
  x.args = a;
  const d = extra(x);
  d.msg = a.length > 0 ? a[0] : null;
  if (a.length >= 2 && a[1] instanceof PyTuple) {
    const det = a[1].a;
    d.filename = det[0] ?? null;
    d.lineno = det[1] ?? null;
    d.offset = det[2] ?? null;
    d.text = det[3] ?? null;
    d.end_lineno = det[4] ?? null;
    d.end_offset = det[5] ?? null;
  }
  d.syntax = true;
  return null;
}, { method: true, owner: 'SyntaxError' }));
for (const k of ['msg', 'filename', 'lineno', 'offset', 'text', 'end_lineno', 'end_offset']) {
  prop(E.SyntaxError, k, (e) => (e.extra && e.extra[k] !== undefined ? e.extra[k] : null), (e, v) => { extra(e)[k] = v; });
}
prop(E.SyntaxError, 'print_file_and_line', (e) => (e.extra && e.extra.print_file_and_line) ?? null);
defMethods(E.SyntaxError, {
  __str__: ['self', (e: any) => {
    const x = ex(e);
    const d = x.extra ?? {};
    const msg = d.msg !== undefined && d.msg !== null ? ops.str(d.msg) : excStrDefault(x);
    const file = typeof d.filename === 'string' ? d.filename.replace(/^.*\//, '') : null;
    if (file && typeof d.lineno === 'number') return `${msg} (${file}, line ${d.lineno})`;
    if (file) return `${msg} (${file})`;
    if (typeof d.lineno === 'number') return `${msg} (line ${d.lineno})`;
    return msg;
  }],
});

// ───────────────────────── Unicode*Error ─────────────────────────

for (const t of [E.UnicodeDecodeError, E.UnicodeEncodeError]) {
  const names = ['encoding', 'object', 'start', 'end', 'reason'];
  names.forEach((k, i) => prop(t, k, (e) => e.args[i] ?? null, (e, v) => { e.args[i] = v; }));
  t.dict!.set('__init__', mkNative('__init__', 'self, *args', (self: any, args: any) => {
    ex(self).args = tupleArr(args).slice();
    return null;
  }, { method: true, owner: t.name }));
}
defMethods(E.UnicodeDecodeError, {
  __str__: ['self', (e: any) => {
    const x = ex(e);
    if (x.extra && x.extra.custom) return x.extra.custom;
    const [enc, obj, start, end, reason] = x.args;
    const o = obj && obj.b ? obj.b : [];
    if (typeof start === 'number' && typeof end === 'number' && start < o.length && end === start + 1) return `'${enc}' codec can't decode byte 0x${(o[start] ?? 0).toString(16).padStart(2, '0')} in position ${start}: ${reason}`;
    return `'${enc}' codec can't decode bytes in position ${start}-${end - 1}: ${reason}`;
  }],
});
defMethods(E.UnicodeEncodeError, {
  __str__: ['self', (e: any) => {
    const x = ex(e);
    if (x.extra && x.extra.custom) return x.extra.custom;
    const [enc, obj, start, end, reason] = x.args;
    if (typeof start === 'number' && typeof end === 'number' && ops.isStr(obj) && start < ops.lenOf(obj) && end === start + 1) {
      const cp = Array.from(ops.strValue(obj))[start].codePointAt(0)!;
      const ch = cp < 0x100 ? '\\x' + cp.toString(16).padStart(2, '0') : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0') : '\\U' + cp.toString(16).padStart(8, '0');
      return `'${enc}' codec can't encode character '${ch}' in position ${start}: ${reason}`;
    }
    return `'${enc}' codec can't encode characters in position ${start}-${end - 1}: ${reason}`;
  }],
});

// ───────────────────────── ExceptionGroup ─────────────────────────

const BEG = E.BaseExceptionGroup;
BEG.dict!.set('__new__', mkNative('__new__', 'cls, message, exceptions', (cls: any, msg: any, excs: any) => {
  if (!ops.isStr(msg)) throw typeError('argument 1 must be str, not ' + typeOf(msg).name);
  if (!(excs instanceof PyTuple || excs instanceof PyList)) throw typeError('second argument (exceptions) must be a sequence');
  const items = excs.a.slice();
  if (items.length === 0) throw valueError('second argument (exceptions) must be a non-empty sequence');
  let c: PyType = cls;
  if (c === E.BaseExceptionGroup && items.every((x) => x instanceof PyBaseException && x.cls.isSubtype(E.Exception))) c = E.ExceptionGroup;
  if (c === E.ExceptionGroup && !items.every((x) => x instanceof PyBaseException && x.cls.isSubtype(E.Exception))) {
    throw typeError('Cannot nest BaseExceptions in an ExceptionGroup');
  }
  const e = ops.newObject(c) as PyBaseException;
  e.args = [msg, excs];
  extra(e).group = { message: msg, exceptions: items };
  return e;
}, { owner: 'BaseExceptionGroup' }));
BEG.dict!.set('__init__', mkNative('__init__', 'self, *args, **kw', () => null, { method: true, owner: 'BaseExceptionGroup' }));
prop(BEG, 'message', (e) => extra(e).group.message);
prop(BEG, 'exceptions', (e) => new PyTuple(extra(e).group.exceptions.slice()));
defMethods(BEG, {
  __str__: ['self', (e: any) => {
    const g = extra(ex(e)).group;
    const n = g.exceptions.length;
    return `${ops.str(g.message)} (${n} sub-exception${n === 1 ? '' : 's'})`;
  }],
  subgroup: ['self, condition', (e: any, cond: any) => splitGroup(ex(e), cond)[0]],
  split: ['self, condition', (e: any, cond: any) => new PyTuple(splitGroup(ex(e), cond))],
  derive: ['self, excs', (e: any, excs: any) => deriveGroup(ex(e), excs)],
});

function deriveGroup(e: PyBaseException, excs: any): PyBaseException {
  const g = extra(e).group;
  const items = ops.iterToArray(excs);
  const r = ops.newObject(typeOf(e)) as PyBaseException;
  r.args = [g.message, excs];
  extra(r).group = { message: g.message, exceptions: items };
  return r;
}

/** coincidencia de una excepción con una condición (tipo, tupla de tipos o función) */
function matches(e: PyBaseException, cond: any): boolean {
  if (cond instanceof PyType || cond instanceof PyTuple) return rt.exceptMatch(e, cond);
  return ops.truthy(callObj(cond, [e]));
}

export function splitGroup(e: PyBaseException, cond: any): [any, any] {
  if (matches(e, cond)) return [e, null];
  const g = extra(e).group;
  if (!g) return [null, e];
  const m: any[] = [];
  const r: any[] = [];
  for (const x of g.exceptions) {
    if (x instanceof PyBaseException && extra(x).group) {
      const [a, b] = splitGroup(x, cond);
      if (a !== null) m.push(a);
      if (b !== null) r.push(b);
    } else if (matches(x, cond)) m.push(x);
    else r.push(x);
  }
  const mk = (items: any[]): any => (items.length === 0 ? null : copyGroupMeta(e, deriveGroup(e, new PyList(items))));
  return [mk(m), mk(r)];
}

/** divide un grupo según un predicado sobre las hojas (excepciones que no son grupos) */
function splitByLeaf(e: PyBaseException, pred: (leaf: PyBaseException) => boolean): [any, any] {
  const g = extra(e).group;
  if (!g) return pred(e) ? [e, null] : [null, e];
  const m: any[] = [];
  const r: any[] = [];
  for (const x of g.exceptions) {
    const [a, b] = splitByLeaf(x, pred);
    if (a !== null) m.push(a);
    if (b !== null) r.push(b);
  }
  const mk = (items: any[], same: boolean): any => {
    if (items.length === 0) return null;
    if (same) return e;
    return copyGroupMeta(e, deriveGroup(e, new PyList(items)));
  };
  return [mk(m, r.length === 0), mk(r, m.length === 0)];
}

function copyGroupMeta(from: PyBaseException, to: PyBaseException): PyBaseException {
  to.cause = from.cause;
  to.context = from.context;
  to.suppressContext = from.suppressContext;
  to.tb = from.tb.slice();
  const notes = from.dict ? from.dict.get('__notes__') : undefined;
  if (notes !== undefined) {
    if (!to.dict) to.dict = new PyDict();
    to.dict.set('__notes__', notes);
  }
  return to;
}

function leavesOf(e: PyBaseException, out: Set<PyBaseException>): void {
  const g = extra(e).group;
  if (!g) { out.add(e); return; }
  for (const x of g.exceptions) leavesOf(x, out);
}

function sameMeta(a: PyBaseException, b: PyBaseException): boolean {
  if (a === b) return true;
  if (a.cause !== b.cause || a.context !== b.context) return false;
  const na = a.dict ? a.dict.get('__notes__') : undefined;
  const nb = b.dict ? b.dict.get('__notes__') : undefined;
  if (na !== nb) return false;
  if (a.tb.length !== b.tb.length) return false;
  for (let i = 0; i < a.tb.length; i++) if (a.tb[i] !== b.tb[i]) return false;
  return true;
}

/**
 * Estado de un `try ... except*` (equivalente a `_PyExc_PrepReraiseStar` de CPython):
 * reparte la excepción entre los manejadores y calcula la que hay que relanzar al final.
 */
export class StarTry {
  private isGroup: boolean;
  private remaining: PyBaseException | null;
  private excs: PyBaseException[] = [];
  constructor(private orig: PyBaseException) {
    this.isGroup = ops.isInstance(orig, E.BaseExceptionGroup);
    this.remaining = orig;
  }

  get exhausted(): boolean {
    return this.remaining === null;
  }

  /** parte de la excepción que coincide con `spec` (null si ninguna o ya no quedan excepciones) */
  match(spec: any): PyBaseException | null {
    if (this.remaining === null) return null;
    const checkType = (t: any): void => {
      if (t instanceof PyType && t.isSubtype(E.BaseException)) {
        if (t.isSubtype(E.BaseExceptionGroup)) throw typeError('catching ExceptionGroup with except* is not allowed. Use except instead.');
      } else throw typeError('catching classes that do not inherit from BaseException is not allowed');
    };
    if (spec instanceof PyTuple) spec.a.forEach(checkType);
    else checkType(spec);
    const cur = this.remaining;
    if (!ops.isInstance(cur, E.BaseExceptionGroup)) {
      if (rt.exceptMatch(cur, spec)) {
        // excepción suelta que coincide: se entrega envuelta en un grupo
        this.remaining = null;
        return callObj(E.ExceptionGroup, ['', new PyTuple([cur])]) as PyBaseException;
      }
      return null;
    }
    const r = splitGroup(cur, spec);
    this.remaining = r[1];
    return r[0];
  }

  /** excepción lanzada (o relanzada) por un manejador */
  raised(e: PyBaseException): void {
    this.excs.push(e);
  }

  /** excepción que sigue propagándose al terminar los manejadores (null = ninguna) */
  finish(): PyBaseException | null {
    if (this.remaining !== null) this.excs.push(this.remaining);
    if (!this.isGroup) return this.excs.length === 0 ? null : this.excs[0];
    const raised: PyBaseException[] = [];
    const reraised: PyBaseException[] = [];
    for (const e of this.excs) (sameMeta(e, this.orig) ? reraised : raised).push(e);
    let reraisedEg: PyBaseException | null = null;
    if (reraised.length > 0) {
      const keep = new Set<PyBaseException>();
      for (const e of reraised) leavesOf(e, keep);
      reraisedEg = splitByLeaf(this.orig, (leaf) => keep.has(leaf))[0];
    }
    if (raised.length === 0) return reraisedEg;
    if (reraisedEg !== null) raised.push(reraisedEg);
    if (raised.length === 1) return raised[0];
    return callObj(E.ExceptionGroup, ['', new PyList(raised)]) as PyBaseException;
  }
}

void [strRepr, asStr, kwMap, PyObject, attributeError, NotImplemented];
