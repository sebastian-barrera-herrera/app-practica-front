/**
 * Módulo `posix` (base de `os`) sobre el sistema de archivos virtual en memoria.
 */
import { PyBytes, PyDict, PyFloat, PyList, PyModule, PyObject, PyProperty, PyTuple, PyType } from '../runtime/objects';
import { bytesType, newNativeType, objectType, propertyType, tupleType, typeOf } from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { makeExc, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { decodeUtf8, encodeUtf8 } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { ERRNO_MSG, fsError, normPath } from '../runtime/vfs';
import { asIdx, asStr } from '../runtime/util';
import { PyStaticMethod } from '../runtime/objects';
import { openFile } from './io';

/** crea un tipo tipo `namedtuple` nativo (como las structseq de CPython) */
export function structSeqType(name: string, module: string, fields: string[], nVisible = fields.length): PyType {
  const t = newNativeType(name, module, [tupleType]);
  fields.forEach((f, i) => {
    const p = new PyProperty(propertyType);
    p.name = f;
    p.fget = mkNative(f, 'self', (s: any) => s.a[i], { method: true });
    t.dict!.set(f, p);
  });
  t.dict!.set('__new__', mkNative('__new__', 'cls, sequence', (cls: any, seq: any) => {
    const a = ops.iterToArray(seq);
    while (a.length < fields.length) a.push(null);
    return new PyTuple(a, cls);
  }, { owner: name }));
  t.dict!.set('__repr__', mkNative('__repr__', 'self', (s: any) => `${module}.${name}(${fields.slice(0, nVisible).map((f, i) => `${f}=${ops.repr(s.a[i])}`).join(', ')})`, { method: true }));
  t.dict!.set('__len__', mkNative('__len__', 'self', () => nVisible, { method: true }));
  t.dict!.set('__iter__', mkNative('__iter__', 'self', (s: any) => new ops.TupleIter(s.a.slice(0, nVisible)), { method: true }));
  t.dict!.set('__reduce__', mkNative('__reduce__', 'self', (s: any) => new PyTuple([t, new PyTuple([new PyTuple(s.a.slice())])]), { method: true }));
  return t;
}

const MODE_DIR = 0o040000;
const MODE_REG = 0o100000;

registerNative('posix', (I: Interp, m: PyModule) => {
  const statT = structSeqType('stat_result', 'os', ['st_mode', 'st_ino', 'st_dev', 'st_nlink', 'st_uid', 'st_gid', 'st_size', '_st_atime_i', '_st_mtime_i', '_st_ctime_i', 'st_atime', 'st_mtime', 'st_ctime', 'st_atime_ns', 'st_mtime_ns', 'st_ctime_ns', 'st_blksize', 'st_blocks', 'st_rdev'], 10);
  const termT = structSeqType('terminal_size', 'os', ['columns', 'lines']);
  const unameT = structSeqType('uname_result', 'posix', ['sysname', 'nodename', 'release', 'version', 'machine']);
  m.dict!.set('stat_result', statT);
  m.dict!.set('terminal_size', termT);
  m.dict!.set('uname_result', unameT);
  m.dict!.set('error', E.OSError);

  // rutas
  const fspath = (x: any): string => {
    if (ops.isStr(x)) return ops.strValue(x);
    if (x instanceof PyBytes) return decodeUtf8(x.b);
    const f = typeOf(x).lookup('__fspath__');
    if (f !== undefined) {
      const r = callObj(f, [x]);
      if (ops.isStr(r)) return ops.strValue(r);
      if (r instanceof PyBytes) return decodeUtf8(r.b);
      throw typeError(`expected ${typeOf(x).name}.__fspath__() to return str or bytes, not ${typeOf(r).name}`);
    }
    throw typeError(`expected str, bytes or os.PathLike object, not ${typeOf(x).name}`);
  };
  const shown = (x: any): string => (x instanceof PyBytes ? decodeUtf8(x.b) : fspath(x));
  const isBytesArg = (x: any): boolean => x instanceof PyBytes;
  const ret = (x: any, s: string): any => (isBytesArg(x) ? new PyBytes(Uint8Array.from(encodeUtf8(s)), bytesType) : s);

  mfn(m, 'fspath', 'path', (x: any) => (ops.isStr(x) || x instanceof PyBytes ? x : ops.str(fspath(x))));
  mfn(m, 'getcwd', '', () => I.vfs.cwd);
  mfn(m, 'getcwdb', '', () => new PyBytes(Uint8Array.from(encodeUtf8(I.vfs.cwd)), bytesType));
  mfn(m, 'chdir', 'path', (p: any) => {
    I.flushFiles();
    const a = I.vfs.abs(fspath(p));
    const n = I.vfs.get(a);
    if (!n) throw fsError(2, shown(p));
    if (n.kind !== 'dir') throw fsError(20, shown(p));
    I.vfs.cwd = a;
    return null;
  });
  mfn(m, 'listdir', 'path=', (p?: any) => {
    I.flushFiles();
    const path = p === undefined || p === null ? '.' : fspath(p);
    const names = I.vfs.listdir(path, shown(p ?? '.')).slice().sort();
    return new PyList(names.map((n) => (p instanceof PyBytes ? ret(p, n) : n)));
  });
  mfn(m, 'mkdir', 'path, mode=, *, dir_fd=', (p: any) => { I.flushFiles(); I.vfs.mkdir(fspath(p), false, false, shown(p)); return null; });
  mfn(m, 'rmdir', 'path, *, dir_fd=', (p: any) => { I.flushFiles(); I.vfs.rmdir(fspath(p), shown(p)); return null; });
  for (const nm of ['remove', 'unlink']) mfn(m, nm, 'path, *, dir_fd=', (p: any) => { I.flushFiles(); I.vfs.remove(fspath(p), shown(p)); return null; });
  for (const nm of ['rename', 'replace']) {
    mfn(m, nm, 'src, dst, *, src_dir_fd=, dst_dir_fd=', (a: any, b: any) => { I.flushFiles(); I.vfs.rename(fspath(a), fspath(b), shown(a), shown(b)); return null; });
  }
  const mkStat = (p: any): any => {
    I.flushFiles();
    const a = I.vfs.abs(fspath(p));
    const n = I.vfs.get(a);
    if (!n) throw fsError(2, shown(p));
    const isDir = n.kind === 'dir';
    const size = isDir ? 4096 : n.data.length;
    const mt = n.mtime;
    const ino = 1000 + Array.from(a).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const mode = (isDir ? MODE_DIR : MODE_REG) | (n.mode & 0o7777);
    const F = (v: number): PyFloat => new PyFloat(v);
    const ns = (v: number): any => BigInt(Math.round(v * 1e9));
    return new PyTuple([mode, ino, 2049, 1, 1000, 1000, size, Math.floor(mt), Math.floor(mt), Math.floor(mt), F(mt), F(mt), F(mt), ns(mt), ns(mt), ns(mt), 4096, Math.ceil(size / 512), 0], statT);
  };
  mfn(m, 'stat', 'path, *, dir_fd=, follow_symlinks=', mkStat);
  mfn(m, 'lstat', 'path, *, dir_fd=', mkStat);
  mfn(m, 'access', 'path, mode, *, dir_fd=, effective_ids=, follow_symlinks=', (p: any) => { I.flushFiles(); return I.vfs.exists(fspath(p)); });
  mfn(m, 'chmod', 'path, mode, *, dir_fd=, follow_symlinks=', (p: any, mode: any) => {
    const n = I.vfs.get(I.vfs.abs(fspath(p)));
    if (!n) throw fsError(2, shown(p));
    n.mode = Number(ops.toIndex(mode));
    return null;
  });
  mfn(m, 'utime', 'path, times=, *, ns=, dir_fd=, follow_symlinks=', (p: any, times?: any) => {
    const n = I.vfs.get(I.vfs.abs(fspath(p)));
    if (!n) throw fsError(2, shown(p));
    if (times instanceof PyTuple) n.mtime = Number(ops.floatValue(times.a[1]) ?? ops.intValue(times.a[1]) ?? n.mtime);
    else n.mtime = I.nowMs() / 1000;
    return null;
  });
  // scandir
  const entryT = newNativeType('DirEntry', 'posix', [objectType]);
  const E_ = (x: any): { name: string; path: string; abs: string; raw: any } => x as any;
  const eprops: Record<string, (e: any) => any> = {
    name: (e) => ret(e.raw, e.name),
    path: (e) => ret(e.raw, e.path),
  };
  for (const k of Object.keys(eprops)) {
    const pr = new PyProperty(propertyType);
    pr.name = k;
    pr.fget = mkNative(k, 'self', eprops[k], { method: true });
    entryT.dict!.set(k, pr);
  }
  const em: Record<string, [string, (...a: any[]) => any]> = {
    is_dir: ['self, *, follow_symlinks=', (e: any) => I.vfs.isDir(E_(e).abs)],
    is_file: ['self, *, follow_symlinks=', (e: any) => I.vfs.isFile(E_(e).abs)],
    is_symlink: ['self', () => false],
    is_junction: ['self', () => false],
    stat: ['self, *, follow_symlinks=', (e: any) => mkStat(E_(e).abs)],
    inode: ['self', (e: any) => ops.intValue(ops.getitem(mkStat(E_(e).abs), 1))],
    __fspath__: ['self', (e: any) => E_(e).path],
    __repr__: ['self', (e: any) => `<DirEntry ${ops.repr(E_(e).name)}>`],
  };
  for (const k of Object.keys(em)) entryT.dict!.set(k, mkNative(k, em[k][0], em[k][1], { method: true, owner: 'DirEntry' }));
  const scanT = newNativeType('ScandirIterator', 'posix', [objectType]);
  scanT.dict!.set('__iter__', mkNative('__iter__', 'self', (s: any) => s, { method: true }));
  scanT.dict!.set('__next__', mkNative('__next__', 'self', (s: any) => {
    if (s.i >= s.entries.length) throw makeExc(E.StopIteration, []);
    return s.entries[s.i++];
  }, { method: true }));
  scanT.dict!.set('__enter__', mkNative('__enter__', 'self', (s: any) => s, { method: true }));
  scanT.dict!.set('__exit__', mkNative('__exit__', 'self, *a', () => null, { method: true }));
  scanT.dict!.set('close', mkNative('close', 'self', () => null, { method: true }));
  mfn(m, 'scandir', 'path=', (p?: any) => {
    I.flushFiles();
    const base = p === undefined || p === null ? '.' : fspath(p);
    const names = I.vfs.listdir(base, shown(p ?? '.')).slice().sort();
    const s = new PyObject(scanT);
    (s as any).i = 0;
    (s as any).entries = names.map((n) => {
      const e = new PyObject(entryT);
      const pth = base === '.' && (p === undefined || p === null) ? n : base.endsWith('/') ? base + n : base + '/' + n;
      Object.assign(e, { name: n, path: pth, abs: I.vfs.abs(pth), raw: p ?? null });
      return e;
    });
    return s;
  });
  m.dict!.set('DirEntry', entryT);

  // descriptores de archivo (tabla propia a partir del 3)
  const fds = new Map<number, any>();
  let nextFd = 3;
  mfn(m, 'open', 'path, flags, mode=, *, dir_fd=', (p: any, flags: any) => {
    const fl = Number(ops.toIndex(flags));
    const acc = fl & 3;
    let mode: string;
    if (fl & 1024) mode = acc === 2 ? 'ab+' : 'ab';
    else if (fl & 512) mode = acc === 2 ? 'wb+' : 'wb';
    else if (acc === 0) mode = 'rb';
    else if (fl & 64 && fl & 128) mode = acc === 2 ? 'xb+' : 'xb';
    else mode = acc === 2 ? 'r+b' : 'r+b';
    const path = fspath(p);
    if ((fl & 64) && !I.vfs.exists(path) && mode.startsWith('r')) I.vfs.writeFile(path, new Uint8Array(0), false, shown(p));
    const f = openFile(I, p, mode, null, 'strict', undefined);
    const fd = nextFd++;
    fds.set(fd, f);
    return fd;
  });
  const fdObj = (fd: any): any => {
    const f = fds.get(Number(ops.toIndex(fd)));
    if (!f) throw fsError(9);
    return f;
  };
  mfn(m, 'close', 'fd', (fd: any) => { const f = fdObj(fd); ops.callMethod(f, 'close', []); fds.delete(Number(ops.toIndex(fd))); return null; });
  mfn(m, 'read', 'fd, length, /', (fd: any, n: any) => ops.callMethod(fdObj(fd), 'read', [n]));
  mfn(m, 'write', 'fd, data, /', (fd: any, d: any) => ops.callMethod(fdObj(fd), 'write', [d]));
  mfn(m, 'lseek', 'fd, position, whence, /', (fd: any, p: any, w: any) => ops.callMethod(fdObj(fd), 'seek', [p, w]));
  mfn(m, 'fsync', 'fd', (fd: any) => { ops.callMethod(fdObj(fd), 'flush', []); return null; });
  mfn(m, 'ftruncate', 'fd, length, /', (fd: any, n: any) => { ops.callMethod(fdObj(fd), 'truncate', [n]); return null; });
  mfn(m, 'fstat', 'fd', (fd: any) => { const f = fdObj(fd); ops.callMethod(f, 'flush', []); return mkStat(ops.getAttr(f, 'name')); });
  mfn(m, 'dup', 'fd, /', (fd: any) => { const f = fdObj(fd); const n = nextFd++; fds.set(n, f); return n; });
  mfn(m, 'pipe', '', () => { throw makeExc(E.OSError, [38, 'Function not implemented']); });

  // proceso / entorno
  const env = new PyDict();
  const mkb = (s: string): PyBytes => new PyBytes(Uint8Array.from(encodeUtf8(s)), bytesType);
  for (const [k, v] of Object.entries({ HOME: '/home/alumno', USER: 'alumno', LOGNAME: 'alumno', PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', SHELL: '/bin/bash', PWD: I.vfs.cwd })) env.set(mkb(k), mkb(v));
  m.dict!.set('environ', env);
  mfn(m, 'putenv', 'name, value, /', (k: any, v: any) => { env.set(k, v); return null; });
  mfn(m, 'unsetenv', 'name, /', (k: any) => { env.delete(k); return null; });
  mfn(m, 'getpid', '', () => 4242);
  mfn(m, 'getppid', '', () => 4241);
  for (const n of ['getuid', 'geteuid', 'getgid', 'getegid']) mfn(m, n, '', () => 1000);
  mfn(m, 'getlogin', '', () => 'alumno');
  mfn(m, 'cpu_count', '', () => 4);
  mfn(m, 'strerror', 'code, /', (c: any) => ERRNO_MSG[Number(ops.toIndex(c))] ?? `Unknown error ${ops.str(c)}`);
  mfn(m, 'urandom', 'size, /', (n: any) => {
    const k = Number(ops.toIndex(n));
    if (k < 0) throw valueError('negative argument not allowed');
    const out = new Uint8Array(k);
    let x = (I.seed ^ 0x9e3779b9) >>> 0;
    const st = ((I.extraFlags.urand as number | undefined) ?? 0) + 1;
    I.extraFlags.urand = st;
    x = (x + Math.imul(st, 2654435761)) >>> 0;
    for (let i = 0; i < k; i++) {
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      out[i] = x & 255;
    }
    return new PyBytes(out, bytesType);
  });
  mfn(m, 'uname', '', () => new PyTuple(['Linux', 'devdojo', '6.0', '#1 SMP', 'x86_64'], unameT));
  mfn(m, 'get_terminal_size', 'fd=', () => new PyTuple([80, 24], termT));
  mfn(m, 'isatty', 'fd, /', () => false);
  mfn(m, 'device_encoding', 'fd', () => null);
  mfn(m, 'getpgrp', '', () => 4242);
  mfn(m, 'umask', 'mask, /', () => 0o022);
  mfn(m, 'kill', 'pid, sig, /', () => { throw makeExc(E.ProcessLookupError ?? E.OSError, [3, 'No such process']); });
  mfn(m, 'system', 'command', () => 127);
  mfn(m, '_exit', 'status', (s: any) => { throw makeExc(E.SystemExit, [s]); });
  mfn(m, 'times', '', () => new PyTuple([new PyFloat(0), new PyFloat(0), new PyFloat(0), new PyFloat(0), new PyFloat(0)]));
  mfn(m, 'getloadavg', '', () => new PyTuple([new PyFloat(0.1), new PyFloat(0.1), new PyFloat(0.1)]));
  m.dict!.set('_have_functions', new PyList([]));
  mconst(m, {
    F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_APPEND: 1024, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512,
    EX_OK: 0, WNOHANG: 1, SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2, P_NOWAIT: 1, P_WAIT: 0,
  });
  void [PyStaticMethod, asIdx, asStr, normPath, ops.truthy];
});
