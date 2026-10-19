/**
 * Sistema de archivos virtual en memoria (rutas POSIX).
 */
import { E } from './exc_types';
import { osError } from './errors';
import type { PyBaseException } from './objects';

export interface VNode {
  kind: 'file' | 'dir';
  data: Uint8Array;
  mtime: number; // segundos (virtual)
  mode: number;
}

const ENOENT = 2;
const EACCES = 13;
const EEXIST = 17;
const ENOTDIR = 20;
const EISDIR = 21;
const EINVAL = 22;
const ENOTEMPTY = 39;

export const ERRNO_MSG: Record<number, string> = {
  [ENOENT]: 'No such file or directory',
  [EACCES]: 'Permission denied',
  [EEXIST]: 'File exists',
  [ENOTDIR]: 'Not a directory',
  [EISDIR]: 'Is a directory',
  [EINVAL]: 'Invalid argument',
  [ENOTEMPTY]: 'Directory not empty',
};

export function fsError(errno: number, path?: string, path2?: string): PyBaseException {
  const t = errno === ENOENT ? E.FileNotFoundError : errno === EEXIST ? E.FileExistsError : errno === EISDIR ? E.IsADirectoryError
    : errno === ENOTDIR ? E.NotADirectoryError : errno === EACCES ? E.PermissionError : E.OSError;
  return osError(t, errno, ERRNO_MSG[errno] ?? 'Unknown error', path, path2);
}

export function normPath(p: string, cwd: string): string {
  if (!p.startsWith('/')) p = cwd + '/' + p;
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

export function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export class VFS {
  nodes = new Map<string, VNode>();
  cwd: string;
  now: () => number;
  constructor(cwd: string, now: () => number) {
    this.cwd = cwd;
    this.now = now;
    this.nodes.set('/', { kind: 'dir', data: new Uint8Array(0), mtime: now() / 1000, mode: 0o755 });
    this.mkdirs(cwd);
  }

  abs(p: string): string {
    return normPath(p, this.cwd);
  }

  get(p: string): VNode | undefined {
    return this.nodes.get(p);
  }

  mkdirs(p: string): void {
    const parts = p.split('/').filter((x) => x);
    let cur = '';
    for (const s of parts) {
      cur += '/' + s;
      if (!this.nodes.has(cur)) this.nodes.set(cur, { kind: 'dir', data: new Uint8Array(0), mtime: this.now() / 1000, mode: 0o755 });
    }
  }

  exists(p: string): boolean {
    return this.nodes.has(this.abs(p));
  }
  isFile(p: string): boolean {
    return this.nodes.get(this.abs(p))?.kind === 'file';
  }
  isDir(p: string): boolean {
    return this.nodes.get(this.abs(p))?.kind === 'dir';
  }

  /** escribe un archivo (crea o reemplaza). Lanza errores de FS de Python. */
  writeFile(path: string, data: Uint8Array, append = false, shown = path): void {
    const a = this.abs(path);
    const parent = dirnameOf(a);
    const pn = this.nodes.get(parent);
    if (!pn) throw fsError(ENOENT, shown);
    if (pn.kind !== 'dir') throw fsError(ENOTDIR, shown);
    const ex = this.nodes.get(a);
    if (ex && ex.kind === 'dir') throw fsError(EISDIR, shown);
    if (ex && append) {
      const merged = new Uint8Array(ex.data.length + data.length);
      merged.set(ex.data, 0);
      merged.set(data, ex.data.length);
      ex.data = merged;
      ex.mtime = this.now() / 1000;
    } else if (ex) {
      ex.data = data;
      ex.mtime = this.now() / 1000;
    } else {
      this.nodes.set(a, { kind: 'file', data, mtime: this.now() / 1000, mode: 0o644 });
    }
  }

  readFile(path: string, shown = path): Uint8Array {
    const a = this.abs(path);
    const n = this.nodes.get(a);
    if (!n) throw fsError(ENOENT, shown);
    if (n.kind === 'dir') throw fsError(EISDIR, shown);
    return n.data;
  }

  mkdir(path: string, parents = false, existOk = false, shown = path): void {
    const a = this.abs(path);
    const ex = this.nodes.get(a);
    if (ex) {
      if (existOk && ex.kind === 'dir') return;
      throw fsError(EEXIST, shown);
    }
    const parent = dirnameOf(a);
    const pn = this.nodes.get(parent);
    if (!pn) {
      if (!parents) throw fsError(ENOENT, shown);
      this.mkdirs(a);
      return;
    }
    if (pn.kind !== 'dir') throw fsError(ENOTDIR, shown);
    this.nodes.set(a, { kind: 'dir', data: new Uint8Array(0), mtime: this.now() / 1000, mode: 0o755 });
  }

  listdir(path: string, shown = path): string[] {
    const a = this.abs(path);
    const n = this.nodes.get(a);
    if (!n) throw fsError(ENOENT, shown);
    if (n.kind !== 'dir') throw fsError(ENOTDIR, shown);
    const prefix = a === '/' ? '/' : a + '/';
    const out: string[] = [];
    for (const k of this.nodes.keys()) {
      if (k.length > prefix.length && k.startsWith(prefix) && k.indexOf('/', prefix.length) < 0) out.push(k.slice(prefix.length));
    }
    return out;
  }

  remove(path: string, shown = path): void {
    const a = this.abs(path);
    const n = this.nodes.get(a);
    if (!n) throw fsError(ENOENT, shown);
    if (n.kind === 'dir') throw fsError(EISDIR, shown);
    this.nodes.delete(a);
  }

  rmdir(path: string, shown = path): void {
    const a = this.abs(path);
    const n = this.nodes.get(a);
    if (!n) throw fsError(ENOENT, shown);
    if (n.kind !== 'dir') throw fsError(ENOTDIR, shown);
    if (this.listdir(a).length > 0) throw fsError(ENOTEMPTY, shown);
    if (a === '/') throw fsError(EACCES, shown);
    this.nodes.delete(a);
  }

  rename(src: string, dst: string, shownSrc = src, shownDst = dst): void {
    const a = this.abs(src);
    const b = this.abs(dst);
    const n = this.nodes.get(a);
    if (!n) throw fsError(ENOENT, shownSrc, shownDst);
    const pb = this.nodes.get(dirnameOf(b));
    if (!pb || pb.kind !== 'dir') throw fsError(ENOENT, shownSrc, shownDst);
    const exB = this.nodes.get(b);
    if (exB && exB.kind === 'dir' && n.kind === 'file') throw fsError(EISDIR, shownSrc, shownDst);
    if (n.kind === 'dir') {
      const prefix = a + '/';
      const moves: [string, VNode][] = [];
      for (const [k, v] of this.nodes) if (k === a || k.startsWith(prefix)) moves.push([k, v]);
      for (const [k] of moves) this.nodes.delete(k);
      for (const [k, v] of moves) this.nodes.set(b + k.slice(a.length), v);
    } else {
      this.nodes.delete(a);
      this.nodes.set(b, n);
    }
  }

  /** carga archivos iniciales: ruta → contenido (rutas terminadas en "/" crean directorios) */
  load(files: Record<string, string>, encode: (s: string) => Uint8Array): void {
    for (const key of Object.keys(files)) {
      const isDir = key.endsWith('/');
      const a = this.abs(key);
      if (isDir) {
        this.mkdirs(a);
        continue;
      }
      this.mkdirs(dirnameOf(a));
      this.nodes.set(a, { kind: 'file', data: encode(files[key]), mtime: this.now() / 1000, mode: 0o644 });
    }
  }

  snapshot(decode: (b: Uint8Array) => string): Record<string, string> {
    const out: Record<string, string> = {};
    const keys = Array.from(this.nodes.keys()).sort();
    for (const k of keys) {
      if (k === '/') continue;
      const n = this.nodes.get(k)!;
      if (n.kind === 'dir') out[k + '/'] = '';
      else out[k] = decode(n.data);
    }
    return out;
  }
}
