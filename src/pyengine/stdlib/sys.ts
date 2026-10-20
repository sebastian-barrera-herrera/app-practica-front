/**
 * Módulo `sys` y los flujos estándar (stdin/stdout/stderr).
 */
import { simpleNamespaceType } from '../runtime/t_namespace';
import { PyBaseException, PyDict, PyFloat, PyList, PyObject, PyProperty, PyTuple, PyModule, PyType } from '../runtime/objects';
import { newNativeType, objectType, propertyType, tupleType, typeOf } from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { makeExc, runtimeError, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn, mtype } from './helpers';
import { tupleArr } from '../runtime/util';
import { tracebackOf } from '../runtime/rt';
import { activeOrNull } from '../runtime/state';

// ───────────────────────── flujos estándar ─────────────────────────

class PyStream extends PyObject {
  closed = false;
  constructor(cls: PyType, public kind: 'out' | 'err' | 'in', public name: string) {
    super(cls);
  }
}

const streamType = newNativeType('TextIOWrapper', '_io', [objectType]);

function stdinRead(I: Interp, n: number): string {
  let out = '';
  while (I.stdinPos < I.stdinLines.length) {
    const l = I.stdinLines[I.stdinPos++];
    if (l === null) break;
    out += l + '\n';
    if (n >= 0 && out.length >= n) break;
  }
  return out;
}

const NS = (x: any): PyStream => {
  if (!(x instanceof PyStream)) throw typeError('descriptor requires a stream object');
  return x;
};

function installStreamMethods(): void {
  const defs: Record<string, [string, (...a: any[]) => any]> = {
    write: ['self, s', (self: any, s: any) => {
      const st = NS(self);
      if (!ops.isStr(s)) throw typeError(`write() argument must be str, not ${typeOf(s).name}`);
      if (st.kind === 'in') throw makeExc(E.OSError, ['not writable']);
      const text = ops.strValue(s);
      activeOrNull()!.write(text, st.kind === 'err');
      return Array.from(text).length;
    }],
    writelines: ['self, lines', (self: any, lines: any) => {
      const st = NS(self);
      for (const l of ops.iterToArray(lines)) activeOrNull()!.write(ops.strValue(l), st.kind === 'err');
      return null;
    }],
    flush: ['self', () => null],
    isatty: ['self', () => false],
    fileno: ['self', (self: any) => (NS(self).kind === 'in' ? 0 : NS(self).kind === 'out' ? 1 : 2)],
    readable: ['self', (self: any) => NS(self).kind === 'in'],
    writable: ['self', (self: any) => NS(self).kind !== 'in'],
    seekable: ['self', () => false],
    close: ['self', () => null],
    readline: ['self, size=', (self: any) => {
      const I = activeOrNull()!;
      if (NS(self).kind !== 'in') throw makeExc(E.OSError, ['not readable']);
      if (I.stdinPos >= I.stdinLines.length) {
        if (I.needInput) {
          const l = I.needInput('');
          return String(l) + '\n';
        }
        return '';
      }
      const l = I.stdinLines[I.stdinPos++];
      return l === null ? '' : l + '\n';
    }],
    read: ['self, size=', (self: any, size?: any) => {
      const I = activeOrNull()!;
      if (NS(self).kind !== 'in') throw makeExc(E.OSError, ['not readable']);
      return stdinRead(I, size === undefined || size === null ? -1 : Number(ops.toIndex(size)));
    }],
    readlines: ['self, hint=', (self: any) => {
      const I = activeOrNull()!;
      if (NS(self).kind !== 'in') throw makeExc(E.OSError, ['not readable']);
      const out: any[] = [];
      while (I.stdinPos < I.stdinLines.length) {
        const l = I.stdinLines[I.stdinPos++];
        if (l === null) break;
        out.push(l + '\n');
      }
      return new PyList(out);
    }],
    __iter__: ['self', (self: any) => self],
    __next__: ['self', (self: any) => {
      const I = activeOrNull()!;
      if (I.stdinPos >= I.stdinLines.length) throw makeExc(E.StopIteration, []);
      const l = I.stdinLines[I.stdinPos++];
      if (l === null) throw makeExc(E.StopIteration, []);
      return l + '\n';
    }],
    __enter__: ['self', (self: any) => self],
    __exit__: ['self, *a', () => false],
    __repr__: ['self', (self: any) => `<_io.TextIOWrapper name='${NS(self).name}' mode='${NS(self).kind === 'in' ? 'r' : 'w'}' encoding='utf-8'>`],
  };
  for (const k of Object.keys(defs)) {
    const [sig, impl] = defs[k];
    streamType.dict!.set(k, mkNative(k, sig, impl, { method: true, owner: 'TextIOWrapper' }));
  }
  const ro = (name: string, get: (s: PyStream) => any): void => {
    const p = new PyProperty(propertyType);
    p.name = name;
    p.fget = mkNative(name, 'self', (s: any) => get(NS(s)), { method: true });
    streamType.dict!.set(name, p);
  };
  ro('name', (s) => s.name);
  ro('encoding', () => 'utf-8');
  ro('errors', () => 'strict');
  ro('closed', (s) => s.closed);
  ro('mode', (s) => (s.kind === 'in' ? 'r' : 'w'));
  ro('line_buffering', () => true);
  ro('buffer', (s) => s);
}
installStreamMethods();

// ───────────────────────── version_info ─────────────────────────

const versionInfoType = newNativeType('version_info', 'sys', [tupleType]);
['major', 'minor', 'micro', 'releaselevel', 'serial'].forEach((n, i) => {
  const p = new PyProperty(propertyType);
  p.name = n;
  p.fget = mkNative(n, 'self', (s: any) => s.a[i], { method: true });
  versionInfoType.dict!.set(n, p);
});
versionInfoType.dict!.set('__repr__', mkNative('__repr__', 'self', (s: any) => `sys.version_info(major=${s.a[0]}, minor=${s.a[1]}, micro=${s.a[2]}, releaselevel=${ops.repr(s.a[3])}, serial=${s.a[4]})`, { method: true }));

function makeNamespace(fields: [string, any][]): PyObject {
  const o = new PyObject(simpleNamespaceType);
  o.dict = new PyDict();
  for (const [k, v] of fields) o.dict.set(k, v);
  return o;
}

function structSeq(name: string, fields: [string, any][]): PyObject {
  const t = newNativeType(name, 'sys', [objectType]);
  const o = new PyObject(t);
  o.dict = new PyDict();
  for (const [k, v] of fields) o.dict.set(k, v);
  t.dict!.set('__repr__', mkNative('__repr__', 'self', (s: any) => `sys.${name}(${fields.map(([k]) => `${k}=${ops.repr(s.dict.get(k))}`).join(', ')})`, { method: true }));
  return o;
}

// ───────────────────────── módulo ─────────────────────────

export const PY_VERSION = '3.13.0';

registerNative('sys', (I: Interp, m: PyModule) => {
  I.sysModule = m;
  const out = new PyStream(streamType, 'out', '<stdout>');
  const err = new PyStream(streamType, 'err', '<stderr>');
  const inp = new PyStream(streamType, 'in', '<stdin>');
  I.extraFlags.stdoutObj = out;
  I.extraFlags.stderrObj = err;
  I.extraFlags.stdinObj = inp;
  mconst(m, {
    stdout: out, stderr: err, stdin: inp, __stdout__: out, __stderr__: err, __stdin__: inp,
    argv: new PyList(I.argv.slice()),
    path: new PyList([I.vfs.cwd]),
    modules: I.modules,
    platform: 'linux',
    byteorder: 'little',
    maxsize: 9223372036854775807n,
    maxunicode: 0x10ffff,
    version: `${PY_VERSION} (main, Jan  1 2025, 00:00:00) [Dev Dojo]`,
    version_info: new PyTuple([3, 13, 0, 'final', 0], versionInfoType),
    hexversion: 0x030d00f0,
    executable: '/usr/bin/python3',
    prefix: '/usr',
    base_prefix: '/usr',
    exec_prefix: '/usr',
    copyright: 'Copyright (c) 2001-2025 Python Software Foundation.',
    dont_write_bytecode: true,
    meta_path: new PyList([]),
    path_hooks: new PyList([]),
    path_importer_cache: new PyDict(),
    warnoptions: new PyList([]),
    builtin_module_names: new PyTuple(['_io', '_random', '_thread', '_weakref', 'atexit', 'builtins', 'errno', 'gc', 'itertools', 'math', 'posix', 'sys', 'time', 'unicodedata'].map((x) => x)),
    stdlib_module_names: new PyList([]),
    float_info: structSeq('float_info', [
      ['max', new PyFloat(Number.MAX_VALUE)], ['max_exp', 1024], ['max_10_exp', 308], ['min', new PyFloat(2.2250738585072014e-308)],
      ['min_exp', -1021], ['min_10_exp', -307], ['dig', 15], ['mant_dig', 53], ['epsilon', new PyFloat(Number.EPSILON)], ['radix', 2], ['rounds', 1],
    ]),
    int_info: structSeq('int_info', [['bits_per_digit', 30], ['sizeof_digit', 4], ['default_max_str_digits', 4300], ['str_digits_check_threshold', 640]]),
    implementation: makeNamespace([['name', 'cpython'], ['cache_tag', 'cpython-313'], ['version', new PyTuple([3, 13, 0, 'final', 0], versionInfoType)], ['hexversion', 0x030d00f0], ['_multiarch', 'x86_64-linux-gnu']]),
    flags: structSeq('flags', [['debug', 0], ['inspect', 0], ['interactive', 0], ['optimize', 0], ['dont_write_bytecode', 0], ['no_user_site', 0], ['no_site', 0], ['ignore_environment', 0], ['verbose', 0], ['bytes_warning', 0], ['quiet', 0], ['hash_randomization', 1], ['isolated', 0], ['dev_mode', false], ['utf8_mode', 1], ['warn_default_encoding', 0], ['safe_path', false], ['int_max_str_digits', 4300]]),
    hash_info: structSeq('hash_info', [['width', 64], ['modulus', 2305843009213693951n], ['inf', 314159], ['nan', 0], ['imag', 1000003], ['algorithm', 'siphash13'], ['hash_bits', 64], ['seed_bits', 128], ['cutoff', 0]]),
    thread_info: structSeq('thread_info', [['name', 'pthread'], ['lock', 'mutex+cond'], ['version', null]]),
  });
  mfn(m, 'exit', 'status=, /', (status?: any) => {
    throw makeExc(E.SystemExit, status === undefined ? [] : [status]);
  });
  mfn(m, 'getrecursionlimit', '', () => I.recursionLimit);
  mfn(m, 'setrecursionlimit', 'limit, /', (n: any) => {
    const v = Number(ops.toIndex(n));
    if (v < 1) throw valueError('recursion limit must be greater or equal than 1');
    I.recursionLimit = v;
    return null;
  });
  mfn(m, 'getsizeof', 'object, default=', (o: any, d?: any) => {
    const f = typeOf(o).lookup('__sizeof__');
    if (f === undefined) {
      if (d !== undefined) return d;
      throw typeError(`Type ${typeOf(o).name} doesn't define __sizeof__ method`);
    }
    const n = callObj(f, [o]);
    return Number(ops.intValue(n)!) + 16;
  });
  mfn(m, 'getrefcount', 'object, /', () => 2);
  mfn(m, 'getdefaultencoding', '', () => 'utf-8');
  mfn(m, 'getfilesystemencoding', '', () => 'utf-8');
  mfn(m, 'getfilesystemencodeerrors', '', () => 'surrogateescape');
  mfn(m, 'intern', 'string, /', (s: any) => s);
  mfn(m, 'is_finalizing', '', () => false);
  mfn(m, 'exc_info', '', () => {
    const e = I.curExc;
    if (e === null) return new PyTuple([null, null, null]);
    return new PyTuple([e.cls, e, tracebackOf(e)]);
  });
  mfn(m, 'exception', '', () => I.curExc);
  mfn(m, 'settrace', 'f, /', () => null);
  mfn(m, 'gettrace', '', () => null);
  mfn(m, 'setprofile', 'f, /', () => null);
  mfn(m, 'setswitchinterval', 'interval, /', () => null);
  mfn(m, 'getswitchinterval', '', () => new PyFloat(0.005));
  mfn(m, 'audit', 'event, *args', () => null);
  mfn(m, 'addaudithook', 'hook', () => null);
  mfn(m, '_getframe', 'depth=', (depth?: any) => {
    let f = I.frame;
    let d = depth === undefined ? 0 : Number(depth);
    while (d > 0 && f) { f = f.back; d--; }
    if (!f) throw valueError('call stack is not deep enough');
    return (require('../runtime/t_func') as typeof import('../runtime/t_func')).makeFrameObject(f);
  });
  mfn(m, 'excepthook', 'type, value, traceback, /', (_t: any, v: any) => {
    const { formatException } = require('../runtime/traceback') as typeof import('../runtime/traceback');
    if (v instanceof PyBaseException) I.write(formatException(I, v), true);
    return null;
  });
  mfn(m, 'displayhook', 'value, /', (v: any) => {
    if (v !== null) {
      I.builtins.set('_', null);
      const text = ops.repr(v) + '\n';
      const out = m.dict!.get('stdout');
      if (out === undefined) throw runtimeError('lost sys.stdout');
      if (out === I.extraFlags.stdoutObj) I.write(text, false);
      else ops.callMethod(out, 'write', [text]);
      I.builtins.set('_', v);
    }
    return null;
  });
  m.dict!.set('__excepthook__', m.dict!.get('excepthook'));
  m.dict!.set('__displayhook__', m.dict!.get('displayhook'));
  const hooksT = newNativeType('asyncgen_hooks', 'sys', [tupleType]);
  hooksT.dict!.set('firstiter', (() => { const pr = new PyProperty(propertyType); pr.name = 'firstiter'; pr.fget = mkNative('firstiter', 'self', (t: any) => t.a[0], { method: true }); return pr; })());
  hooksT.dict!.set('finalizer', (() => { const pr = new PyProperty(propertyType); pr.name = 'finalizer'; pr.fget = mkNative('finalizer', 'self', (t: any) => t.a[1], { method: true }); return pr; })());
  hooksT.dict!.set('__repr__', mkNative('__repr__', 'self', (t: any) => `asyncgen_hooks(firstiter=${ops.repr(t.a[0])}, finalizer=${ops.repr(t.a[1])})`, { method: true }));
  I.extraFlags.agenHooks = [null, null];
  mfn(m, 'get_asyncgen_hooks', '', () => new PyTuple([I.extraFlags.agenHooks[0], I.extraFlags.agenHooks[1]], hooksT));
  mfn(m, 'set_asyncgen_hooks', 'firstiter=, finalizer=', (f?: any, g?: any) => {
    if (f !== undefined && f !== null && !ops.isCallable(f)) throw typeError(`callable firstiter expected, got ${typeOf(f).name}`);
    if (g !== undefined && g !== null && !ops.isCallable(g)) throw typeError(`callable finalizer expected, got ${typeOf(g).name}`);
    if (f !== undefined) I.extraFlags.agenHooks[0] = f;
    if (g !== undefined) I.extraFlags.agenHooks[1] = g;
    return null;
  });
  mfn(m, 'breakpointhook', '*args, **kw', () => null);
  m.dict!.set('__breakpointhook__', m.dict!.get('breakpointhook'));
  mfn(m, '_getsource', 'filename', (fn: any) => {
    const lines = I.sources.get(ops.strValue(fn));
    if (!lines) return null;
    const out = lines.map((l) => l + '\n');
    if (out.length > 0 && out[out.length - 1] === '\n') out.pop();
    return new PyList(out);
  });
  mfn(m, '_getframemodulename', 'depth=', (depth?: any) => {
    let f = I.frame;
    let d = depth === undefined ? 0 : Number(depth);
    while (d > 0 && f) { f = f.back; d--; }
    return f ? (f.g.get('__name__') ?? null) : null;
  });
  mfn(m, 'get_int_max_str_digits', '', () => 4300);
  mfn(m, 'set_int_max_str_digits', 'maxdigits', () => null);
  void mtype;
  void tupleArr;
});
