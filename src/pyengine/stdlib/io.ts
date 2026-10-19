/**
 * Módulo `io` y la función `open()` sobre el sistema de archivos virtual.
 */
import {
  PyBytes, PyByteArray, PyList, PyModule, PyObject, PyProperty, PyTuple, PyType, F_BASETYPE, F_INSTDICT,
} from '../runtime/objects';
import {
  NotImplemented, bytesType, newNativeType, objectType, propertyType, typeOf,
} from '../runtime/builtin_types';
import { E, excTypes } from '../runtime/exc_types';
import { makeExc, osError, stopIteration, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { decodeUtf8, encodeUtf8 } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { asIdx, asStr } from '../runtime/util';
import { decodeBytes, encodeStr } from '../runtime/t_str';
import { activeOrNull } from '../runtime/state';
import { PyIter } from '../runtime/objects';
import { fsError } from '../runtime/vfs';

// ───────────────────────── objetos ─────────────────────────

abstract class IOObj extends PyObject {
  closed = false;
  abstract binary: boolean;
}

class TextObj extends IOObj {
  flushNow(): void {
    flushStream(this);
  }
  binary = false;
  text = '';
  pos = 0;
  canRead = true;
  canWrite = true;
  append = false;
  /** archivos: ruta y modo */
  path: string | null = null;
  shown = '';
  modeStr = 'r+';
  encoding = 'utf-8';
  errors = 'strict';
  dirty = false;
  newline: string | null = '\n';
  lastLineEnding = false;
}

class BytesObj extends IOObj {
  flushNow(): void {
    flushStream(this);
  }
  binary = true;
  buf = new Uint8Array(64);
  len = 0;
  pos = 0;
  canRead = true;
  canWrite = true;
  append = false;
  path: string | null = null;
  shown = '';
  modeStr = 'rb';
  dirty = false;
}

type Stream = TextObj | BytesObj;

function I_(): Interp {
  return activeOrNull()!;
}

function flushStream(s: Stream): void {
  if (s.path === null || !s.dirty) return;
  const I = I_();
  const data = s instanceof TextObj ? encodeStr(s.text, s.encoding, s.errors) : s.buf.slice(0, s.len);
  I.vfs.writeFile(s.path, data, false, s.shown);
  s.dirty = false;
}

function checkOpen(s: IOObj, what = 'I/O operation on closed file.'): void {
  if (s.closed) throw valueError(what);
}

// ───────────────────────── métodos de texto ─────────────────────────

function unsupported(msg: string): never {
  throw makeExc(UnsupportedOperation, [msg]);
}
let UnsupportedOperation: PyType;

function textReadSize(s: TextObj, size: any): string {
  checkOpen(s);
  if (!s.canRead) unsupported('not readable');
  const n = size === undefined || size === null ? -1 : asIdx(size);
  const rest = s.text.slice(s.pos);
  const out = n < 0 ? rest : Array.from(rest).slice(0, n).join('');
  s.pos += out.length;
  return out;
}

function textReadline(s: TextObj, size?: any): string {
  checkOpen(s);
  if (!s.canRead) unsupported('not readable');
  const lim = size === undefined || size === null ? -1 : asIdx(size);
  const t = s.text;
  let i = s.pos;
  if (i >= t.length) return '';
  let j = t.indexOf('\n', i);
  if (s.newline === '\r' || s.newline === null) {
    const k = t.indexOf('\r', i);
    if (s.newline === '\r') j = k;
    else if (k >= 0 && (j < 0 || k < j)) j = k;
  }
  let end = j < 0 ? t.length : j + 1;
  if (s.newline === null && t[end - 1] === '\r' && t[end] === '\n') end++;
  if (lim >= 0 && end - i > lim) end = i + lim;
  const line = t.slice(i, end);
  s.pos = end;
  i = end;
  return line;
}

function normNewlines(s: string, nl: string | null): string {
  if (nl === null) return s.replace(/\r\n?/g, '\n');
  return s;
}

function textWrite(s: TextObj, x: any): number {
  checkOpen(s);
  if (!s.canWrite) unsupported('not writable');
  if (!ops.isStr(x)) throw typeError(`write() argument must be str, not ${typeOf(x).name}`);
  const str = normNewlines(ops.strValue(x), s.path === null ? s.newline : null);
  if (s.append) s.pos = s.text.length;
  if (s.pos === s.text.length) s.text += str;
  else {
    if (s.pos > s.text.length) s.text = s.text + '\0'.repeat(s.pos - s.text.length);
    s.text = s.text.slice(0, s.pos) + str + s.text.slice(s.pos + str.length);
  }
  s.pos += str.length;
  s.dirty = true;
  return Array.from(ops.strValue(x)).length;
}

function seekCommon(cur: number, end: number, off: any, whence: any): number {
  const w = whence === undefined ? 0 : asIdx(whence);
  const o = asIdx(off);
  let p: number;
  if (w === 0) p = o;
  else if (w === 1) p = cur + o;
  else if (w === 2) p = end + o;
  else throw valueError(`invalid whence (${w}, should be 0, 1 or 2)`);
  if (p < 0) throw valueError(`negative seek position ${p}`);
  return p;
}

const TEXT_METHODS: Record<string, [string, (...a: any[]) => any]> = {
  read: ['self, size=', (s: TextObj, n?: any) => textReadSize(s, n)],
  readline: ['self, size=', (s: TextObj, n?: any) => textReadline(s, n)],
  readlines: ['self, hint=', (s: TextObj) => {
    const out: string[] = [];
    for (;;) {
      const l = textReadline(s);
      if (l === '') break;
      out.push(l);
    }
    return new PyList(out);
  }],
  write: ['self, s', (s: TextObj, x: any) => textWrite(s, x)],
  writelines: ['self, lines', (s: TextObj, ls: any) => {
    checkOpen(s);
    for (const l of ops.iterToArray(ls)) textWrite(s, l);
    return null;
  }],
  seek: ['self, offset, whence=', (s: TextObj, o: any, w?: any) => {
    checkOpen(s);
    s.pos = seekCommon(s.pos, s.text.length, o, w);
    return s.pos;
  }],
  tell: ['self', (s: TextObj) => { checkOpen(s); return s.pos; }],
  truncate: ['self, size=', (s: TextObj, n?: any) => {
    checkOpen(s);
    if (!s.canWrite) unsupported('not writable');
    const size = n === undefined || n === null ? s.pos : asIdx(n);
    s.text = s.text.length > size ? s.text.slice(0, size) : s.text;
    s.dirty = true;
    return size;
  }],
  flush: ['self', (s: TextObj) => { checkOpen(s); flushStream(s); return null; }],
  close: ['self', (s: TextObj) => { if (!s.closed) { flushStream(s); s.closed = true; I_().openFiles.delete(s as any); } return null; }],
  readable: ['self', (s: TextObj) => { checkOpen(s); return s.canRead; }],
  writable: ['self', (s: TextObj) => { checkOpen(s); return s.canWrite; }],
  seekable: ['self', (s: TextObj) => { checkOpen(s); return true; }],
  isatty: ['self', () => false],
  fileno: ['self', (s: TextObj) => { if (s.path === null) unsupported('fileno'); return 3; }],
  getvalue: ['self', (s: TextObj) => { checkOpen(s); return s.text; }],
  detach: ['self', (s: TextObj) => s],
  __iter__: ['self', (s: TextObj) => { checkOpen(s); return s; }],
  __next__: ['self', (s: TextObj) => {
    const l = textReadline(s);
    if (l === '') throw stopIteration();
    return l;
  }],
  __enter__: ['self', (s: TextObj) => { checkOpen(s); return s; }],
  __exit__: ['self, *a', (s: TextObj) => { if (!s.closed) { flushStream(s); s.closed = true; I_().openFiles.delete(s as any); } return null; }],
  __del__: ['self', () => null],
};

// ───────────────────────── métodos binarios ─────────────────────────

function ensureCap(b: BytesObj, n: number): void {
  if (n <= b.buf.length) return;
  let c = b.buf.length;
  while (c < n) c *= 2;
  const nb = new Uint8Array(c);
  nb.set(b.buf.subarray(0, b.len));
  b.buf = nb;
}

function bytesRead(b: BytesObj, size: any): PyBytes {
  checkOpen(b);
  if (!b.canRead) unsupported('read');
  const n = size === undefined || size === null ? -1 : asIdx(size);
  const end = n < 0 ? b.len : Math.min(b.len, b.pos + n);
  const out = b.buf.slice(b.pos, Math.max(b.pos, end));
  b.pos = Math.max(b.pos, end);
  return new PyBytes(out, bytesType);
}

function bytesReadline(b: BytesObj, size?: any): PyBytes {
  checkOpen(b);
  if (!b.canRead) unsupported('read');
  const lim = size === undefined || size === null ? -1 : asIdx(size);
  let i = b.pos;
  while (i < b.len && b.buf[i] !== 10) i++;
  let end = Math.min(b.len, i + 1);
  if (lim >= 0 && end - b.pos > lim) end = b.pos + lim;
  const out = b.buf.slice(b.pos, end);
  b.pos = end;
  return new PyBytes(out, bytesType);
}

function bytesWrite(b: BytesObj, x: any): number {
  checkOpen(b);
  if (!b.canWrite) unsupported('write');
  let data: ArrayLike<number>;
  if (x instanceof PyBytes) data = x.b;
  else if (x instanceof PyByteArray) data = x.b;
  else if (x instanceof PyObject && (x as any).src) data = (x as any).src;
  else throw typeError(`a bytes-like object is required, not '${typeOf(x).name}'`);
  if (b.append) b.pos = b.len;
  ensureCap(b, b.pos + data.length);
  if (b.pos > b.len) b.buf.fill(0, b.len, b.pos);
  for (let i = 0; i < data.length; i++) b.buf[b.pos + i] = data[i];
  b.pos += data.length;
  if (b.pos > b.len) b.len = b.pos;
  b.dirty = true;
  return data.length;
}

const BYTES_METHODS: Record<string, [string, (...a: any[]) => any]> = {
  read: ['self, size=', (b: BytesObj, n?: any) => bytesRead(b, n)],
  read1: ['self, size=', (b: BytesObj, n?: any) => bytesRead(b, n)],
  readline: ['self, size=', (b: BytesObj, n?: any) => bytesReadline(b, n)],
  readlines: ['self, hint=', (b: BytesObj) => {
    const out: PyBytes[] = [];
    for (;;) {
      const l = bytesReadline(b);
      if (l.b.length === 0) break;
      out.push(l);
    }
    return new PyList(out);
  }],
  readinto: ['self, buffer', (b: BytesObj, buf: any) => {
    const data = bytesRead(b, buf.b.length).b;
    for (let i = 0; i < data.length; i++) buf.b[i] = data[i];
    return data.length;
  }],
  write: ['self, b', (b: BytesObj, x: any) => bytesWrite(b, x)],
  writelines: ['self, lines', (b: BytesObj, ls: any) => { for (const l of ops.iterToArray(ls)) bytesWrite(b, l); return null; }],
  seek: ['self, offset, whence=', (b: BytesObj, o: any, w?: any) => { checkOpen(b); b.pos = seekCommon(b.pos, b.len, o, w); return b.pos; }],
  tell: ['self', (b: BytesObj) => { checkOpen(b); return b.pos; }],
  truncate: ['self, size=', (b: BytesObj, n?: any) => {
    checkOpen(b);
    const size = n === undefined || n === null ? b.pos : asIdx(n);
    if (size < b.len) b.len = size;
    b.dirty = true;
    return size;
  }],
  flush: ['self', (b: BytesObj) => { checkOpen(b); flushStream(b); return null; }],
  close: ['self', (b: BytesObj) => { if (!b.closed) { flushStream(b); b.closed = true; I_().openFiles.delete(b as any); } return null; }],
  readable: ['self', (b: BytesObj) => { checkOpen(b); return b.canRead; }],
  writable: ['self', (b: BytesObj) => { checkOpen(b); return b.canWrite; }],
  seekable: ['self', (b: BytesObj) => { checkOpen(b); return true; }],
  isatty: ['self', () => false],
  fileno: ['self', (b: BytesObj) => { if (b.path === null) unsupported('fileno'); return 3; }],
  getvalue: ['self', (b: BytesObj) => { checkOpen(b); return new PyBytes(b.buf.slice(0, b.len), bytesType); }],
  getbuffer: ['self', (b: BytesObj) => { const m = new PyObject(require('../runtime/builtin_types').memoryViewType); (m as any).src = b.buf.slice(0, b.len); return m; }],
  detach: ['self', (b: BytesObj) => b],
  __iter__: ['self', (b: BytesObj) => { checkOpen(b); return b; }],
  __next__: ['self', (b: BytesObj) => {
    const l = bytesReadline(b);
    if (l.b.length === 0) throw stopIteration();
    return l;
  }],
  __enter__: ['self', (b: BytesObj) => { checkOpen(b); return b; }],
  __exit__: ['self, *a', (b: BytesObj) => { if (!b.closed) { flushStream(b); b.closed = true; I_().openFiles.delete(b as any); } return null; }],
};

// ───────────────────────── open() ─────────────────────────

export function openFile(I: Interp, file: any, mode: string, encoding: string | null, errors: string, newline: any): IOObj {
  // fspath
  let target = file;
  if (!ops.isStr(target) && !(target instanceof PyBytes) && typeof ops.intValue(target) !== 'number') {
    const f = typeOf(target).lookup('__fspath__');
    if (f === undefined) throw typeError(`expected str, bytes or os.PathLike object, not ${typeOf(file).name}`);
    target = callObj(f, [target]);
  }
  const fd = ops.intValue(target);
  if (typeof fd === 'number' && !(typeof target === 'boolean')) {
    const so = I.sysModule!.dict!;
    const stream = fd === 0 ? so.get('stdin') : fd === 1 ? so.get('stdout') : fd === 2 ? so.get('stderr') : undefined;
    if (stream === undefined) throw osError(E.OSError, 9, 'Bad file descriptor');
    return stream;
  }
  const path = target instanceof PyBytes ? decodeUtf8(target.b) : ops.strValue(target);
  const shown = ops.repr(target).slice(1, -1) === path ? path : path;
  // validar modo
  const m = mode;
  if (!/^[rwxabt+]+$/.test(m) || new Set(m).size !== m.length || (m.includes('b') && m.includes('t'))) throw valueError(`invalid mode: '${m}'`);
  const kinds = ['r', 'w', 'x', 'a'].filter((c) => m.includes(c));
  if (kinds.length !== 1) throw valueError('must have exactly one of create/read/write/append mode');
  const kind = kinds[0];
  const plus = m.includes('+');
  const binary = m.includes('b');
  if (binary && encoding !== null) throw valueError("binary mode doesn't take an encoding argument");
  const abs = I.vfs.abs(path);
  I.flushFiles();
  const exists = I.vfs.exists(path);
  if (I.vfs.isDir(path)) throw fsError(21, shown);
  let content: Uint8Array = new Uint8Array(0);
  if (kind === 'r') {
    content = I.vfs.readFile(path, shown);
  } else if (kind === 'x') {
    if (exists) throw fsError(17, shown);
    I.vfs.writeFile(path, new Uint8Array(0), false, shown);
  } else if (kind === 'w') {
    I.vfs.writeFile(path, new Uint8Array(0), false, shown);
  } else {
    if (exists) content = I.vfs.readFile(path, shown);
    else I.vfs.writeFile(path, new Uint8Array(0), false, shown);
  }
  const canRead = kind === 'r' || plus;
  const canWrite = kind !== 'r' || plus;
  if (binary) {
    const b = new BytesObj(bytesIOType);
    b.buf = new Uint8Array(Math.max(64, content.length));
    b.buf.set(content);
    b.len = content.length;
    b.pos = kind === 'a' ? b.len : 0;
    b.canRead = canRead;
    b.canWrite = canWrite;
    b.append = kind === 'a';
    b.path = abs;
    b.shown = shown;
    b.modeStr = m;
    b.cls = bufferedType;
    I.openFiles.add(b);
    return b;
  }
  const enc = encoding ?? 'utf-8';
  // validar codec
  encodeStr('', enc, 'strict');
  const t = new TextObj(fileTextType);
  t.text = normNewlines(decodeBytes(content, enc, errors), newline === undefined || newline === null ? null : '\n');
  t.pos = kind === 'a' ? t.text.length : 0;
  t.canRead = canRead;
  t.canWrite = canWrite;
  t.append = kind === 'a';
  t.path = abs;
  t.shown = shown;
  t.modeStr = m;
  t.encoding = enc.toLowerCase().replace(/_/g, '-') === 'utf8' ? 'utf-8' : enc;
  t.errors = errors;
  t.newline = newline === undefined || newline === null ? null : String(newline);
  if (t.newline === '') t.newline = '\n';
  I.openFiles.add(t);
  return t;
}

let bytesIOType: PyType;
let bufferedType: PyType;
let fileTextType: PyType;

// ───────────────────────── registro del módulo ─────────────────────────

function installIO(I: Interp, m: PyModule): void {
  const mkBase = (name: string, bases: PyType[] = [objectType]): PyType => {
    const t = newNativeType(name, 'io', bases, F_BASETYPE);
    t.flags |= F_INSTDICT;
    t.computeMro();
    m.dict!.set(name, t);
    return t;
  };
  const IOBase = mkBase('_IOBase');
  m.dict!.set('IOBase', IOBase);
  IOBase.name = 'IOBase';
  IOBase.qualname = 'IOBase';
  const RawIOBase = mkBase('RawIOBase', [IOBase]);
  const BufferedIOBase = mkBase('BufferedIOBase', [IOBase]);
  const TextIOBase = mkBase('TextIOBase', [IOBase]);
  // métodos genéricos para subclases escritas en Python (IOBase)
  const base: Record<string, [string, (...a: any[]) => any]> = {
    close: ['self', (s: any) => { s.dict ??= new (require('../runtime/objects').PyDict)(); s.dict.set('__closed', true); return null; }],
    flush: ['self', () => null],
    readable: ['self', () => false],
    writable: ['self', () => false],
    seekable: ['self', () => false],
    isatty: ['self', () => false],
    fileno: ['self', () => unsupported('fileno')],
    __enter__: ['self', (s: any) => s],
    __exit__: ['self, *a', (s: any) => { callObj(ops.getAttr(s, 'close'), []); return null; }],
    __iter__: ['self', (s: any) => s],
    __next__: ['self', (s: any) => {
      const l = callObj(ops.getAttr(s, 'readline'), []);
      if (ops.lenOf(l) === 0) throw stopIteration();
      return l;
    }],
    readlines: ['self, hint=', (s: any) => {
      const out: any[] = [];
      for (;;) {
        const l = callObj(ops.getAttr(s, 'readline'), []);
        if (ops.lenOf(l) === 0) break;
        out.push(l);
      }
      return new PyList(out);
    }],
    writelines: ['self, lines', (s: any, ls: any) => { for (const l of ops.iterToArray(ls)) callObj(ops.getAttr(s, 'write'), [l]); return null; }],
  };
  for (const k of Object.keys(base)) IOBase.dict!.set(k, mkNative(k, base[k][0], base[k][1], { method: true, owner: 'IOBase' }));
  const closedProp = new PyProperty(propertyType);
  closedProp.name = 'closed';
  closedProp.fget = mkNative('closed', 'self', (s: any) => !!(s.dict && s.dict.get('__closed')) || !!s.closed, { method: true });
  IOBase.dict!.set('closed', closedProp);

  const unsupT = newNativeType('UnsupportedOperation', 'io', [E.OSError, E.ValueError]);
  unsupT.flags |= F_BASETYPE;
  UnsupportedOperation = unsupT;
  m.dict!.set('UnsupportedOperation', unsupT);

  const mkStream = (name: string, bases: PyType[], methods: Record<string, [string, (...a: any[]) => any]>): PyType => {
    const t = newNativeType(name, 'io', bases, F_BASETYPE);
    for (const k of Object.keys(methods)) t.dict!.set(k, mkNative(k, methods[k][0], methods[k][1], { method: true, owner: name }));
    const p = (nm: string, get: (s: any) => any): void => {
      const pr = new PyProperty(propertyType);
      pr.name = nm;
      pr.fget = mkNative(nm, 'self', get, { method: true });
      t.dict!.set(nm, pr);
    };
    p('closed', (s: IOObj) => s.closed);
    return t;
  };

  // StringIO
  const stringIO = mkStream('StringIO', [TextIOBase], TEXT_METHODS);
  stringIO.alloc = (cls) => new TextObj(cls);
  stringIO.dict!.set('__init__', mkNative('__init__', 'self, initial_value=, newline=', (s: TextObj, init?: any, nl?: any) => {
    s.newline = nl === undefined ? '\n' : nl === null ? null : String(nl);
    s.text = init === undefined || init === null ? '' : normNewlines(asStr(init, 'initial_value must be str or None, not ' + typeOf(init).name), s.newline);
    s.pos = 0;
    s.canRead = true;
    s.canWrite = true;
    return null;
  }, { method: true, owner: 'StringIO' }));
  const sprop = (nm: string, get: (s: any) => any): void => {
    const pr = new PyProperty(propertyType);
    pr.name = nm;
    pr.fget = mkNative(nm, 'self', get, { method: true });
    stringIO.dict!.set(nm, pr);
  };
  sprop('line_buffering', () => false);
  sprop('newlines', () => null);
  sprop('encoding', () => null);
  sprop('errors', () => null);
  m.dict!.set('StringIO', stringIO);

  // BytesIO
  const bytesIO = mkStream('BytesIO', [BufferedIOBase], BYTES_METHODS);
  bytesIO.alloc = (cls) => new BytesObj(cls);
  bytesIO.dict!.set('__init__', mkNative('__init__', 'self, initial_bytes=', (s: BytesObj, init?: any) => {
    s.len = 0;
    s.pos = 0;
    if (init !== undefined && init !== null) bytesWrite(s, init);
    s.pos = 0;
    s.dirty = false;
    return null;
  }, { method: true, owner: 'BytesIO' }));
  m.dict!.set('BytesIO', bytesIO);
  bytesIOType = bytesIO;

  // objetos de archivo
  const textFile = mkStream('TextIOWrapper', [TextIOBase], TEXT_METHODS);
  textFile.alloc = (cls) => new TextObj(cls);
  const fprop = (t: PyType, nm: string, get: (s: any) => any): void => {
    const pr = new PyProperty(propertyType);
    pr.name = nm;
    pr.fget = mkNative(nm, 'self', get, { method: true });
    t.dict!.set(nm, pr);
  };
  fprop(textFile, 'name', (s: TextObj) => s.shown);
  fprop(textFile, 'mode', (s: TextObj) => s.modeStr);
  fprop(textFile, 'encoding', (s: TextObj) => s.encoding);
  fprop(textFile, 'errors', (s: TextObj) => s.errors);
  fprop(textFile, 'line_buffering', () => false);
  fprop(textFile, 'newlines', () => null);
  fprop(textFile, 'buffer', (s: TextObj) => s);
  textFile.dict!.set('__repr__', mkNative('__repr__', 'self', (s: TextObj) => `<_io.TextIOWrapper name=${ops.repr(s.shown)} mode='${s.modeStr}' encoding='${s.encoding}'>`, { method: true }));
  m.dict!.set('TextIOWrapper', textFile);
  fileTextType = textFile;
  const buffered = mkStream('BufferedReader', [BufferedIOBase], BYTES_METHODS);
  buffered.alloc = (cls) => new BytesObj(cls);
  fprop(buffered, 'name', (s: BytesObj) => s.shown);
  fprop(buffered, 'mode', (s: BytesObj) => s.modeStr);
  buffered.dict!.set('__repr__', mkNative('__repr__', 'self', (s: BytesObj) => `<_io.${s.canWrite && !s.canRead ? 'BufferedWriter' : 'BufferedReader'} name=${ops.repr(s.shown)}>`, { method: true }));
  m.dict!.set('BufferedReader', buffered);
  m.dict!.set('BufferedWriter', buffered);
  m.dict!.set('BufferedRandom', buffered);
  m.dict!.set('FileIO', buffered);
  bufferedType = buffered;

  mfn(m, 'open', 'file, mode="r", buffering=-1, encoding=None, errors=None, newline=None, closefd=True, opener=None', (file: any, mode?: any, _buf?: any, enc?: any, errs?: any, nl?: any) =>
    openFile(I, file, mode === undefined ? 'r' : asStr(mode), enc === undefined || enc === null ? null : asStr(enc), errs === undefined || errs === null ? 'strict' : asStr(errs), nl));
  m.dict!.set('open_code', m.dict!.get('open'));
  mfn(m, 'text_encoding', 'encoding, stacklevel=', (e: any) => (e === null || e === undefined ? 'utf-8' : e));
  mconst(m, { SEEK_SET: 0, SEEK_CUR: 1, SEEK_END: 2, DEFAULT_BUFFER_SIZE: 8192, BlockingIOError: excTypes.BlockingIOError });
  void [NotImplemented, PyTuple, PyIter, encodeUtf8, RawIOBase];
}

registerNative('io', installIO);
registerNative('_io', (I: Interp, m: PyModule) => {
  const { importModule } = require('../runtime/modules') as typeof import('../runtime/modules');
  const io = importModule(I, 'io');
  for (const k of io.dict!.keys()) m.dict!.set(k, io.dict!.get(k));
});
