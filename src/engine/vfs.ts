/**
 * Sistema de archivos virtual en memoria con permisos estilo UNIX,
 * enlaces simbólicos y enlaces duros. Es lo que hace que "chmod", "ls -l",
 * "Permission denied", etc. se comporten como en Linux de verdad.
 */
import { basename, dirname, normalize, split } from './path';

export type Kind = 'file' | 'dir' | 'symlink';

export interface FsNode {
  kind: Kind;
  ino: number;
  mode: number; // bits de permisos, ej. 0o644
  uid: string;
  gid: string;
  mtime: number; // ms (reloj virtual)
  nlink: number;
  content: string;
  children: Map<string, FsNode> | null;
  target: string;
  size?: number; // tamaño forzado (archivos "binarios" simulados)
}

export type FsErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'EINVAL'
  | 'ELOOP'
  | 'EPERM'
  | 'EBUSY'
  | 'EXDEV';

const MESSAGES: Record<FsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EACCES: 'Permission denied',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EINVAL: 'Invalid argument',
  ELOOP: 'Too many levels of symbolic links',
  EPERM: 'Operation not permitted',
  EBUSY: 'Device or resource busy',
  EXDEV: 'Invalid cross-device link',
};

export class FsError extends Error {
  code: FsErrorCode;
  path: string;
  constructor(code: FsErrorCode, path: string) {
    super(MESSAGES[code]);
    this.code = code;
    this.path = path;
  }
}

/** Credenciales con las que se hacen las comprobaciones de permisos. */
export interface Cred {
  name: string;
  groups: string[]; // incluye el grupo primario
}

export const ROOT: Cred = { name: 'root', groups: ['root'] };

export interface Clock {
  now: number;
}

export type Perm = 'r' | 'w' | 'x';

let inoCounter = 1000;

export function newIno(): number {
  return ++inoCounter;
}

export class VFS {
  root: FsNode;
  clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
    this.root = this.makeNode('dir', 0o755, 'root', 'root');
  }

  makeNode(kind: Kind, mode: number, uid: string, gid: string): FsNode {
    return {
      kind,
      ino: newIno(),
      mode,
      uid,
      gid,
      mtime: this.clock.now,
      nlink: kind === 'dir' ? 2 : 1,
      content: '',
      children: kind === 'dir' ? new Map() : null,
      target: '',
    };
  }

  // ───────────────────────── permisos ─────────────────────────

  can(node: FsNode, cred: Cred | null, perm: Perm): boolean {
    if (!cred) return true;
    if (cred.name === 'root') {
      if (perm === 'x' && node.kind === 'file') return (node.mode & 0o111) !== 0;
      return true;
    }
    const shift = node.uid === cred.name ? 6 : cred.groups.includes(node.gid) ? 3 : 0;
    const bit = perm === 'r' ? 4 : perm === 'w' ? 2 : 1;
    return ((node.mode >> shift) & bit) !== 0;
  }

  // ───────────────────────── resolución de rutas ─────────────────────────

  /**
   * Recorre `abs` (ruta absoluta). Devuelve el nodo (o null si no existe el
   * último componente) junto con su padre. Lanza ENOENT/ENOTDIR/EACCES para
   * los componentes intermedios.
   */
  walk(
    abs: string,
    opts: { follow?: boolean; cred?: Cred | null; depth?: number } = {},
  ): { node: FsNode | null; parent: FsNode | null; name: string; path: string } {
    const follow = opts.follow !== false;
    const cred = opts.cred ?? null;
    const depth = opts.depth ?? 0;
    if (depth > 30) throw new FsError('ELOOP', abs);
    const comps = split(normalize(abs));
    if (comps.length === 0) return { node: this.root, parent: null, name: '', path: '/' };
    let cur = this.root;
    let curPath = '';
    for (let i = 0; i < comps.length; i++) {
      const name = comps[i];
      const isLast = i === comps.length - 1;
      if (cur.kind !== 'dir') throw new FsError('ENOTDIR', abs);
      if (!this.can(cur, cred, 'x')) throw new FsError('EACCES', abs);
      const child = cur.children!.get(name);
      if (!child) {
        if (isLast) return { node: null, parent: cur, name, path: curPath + '/' + name };
        throw new FsError('ENOENT', abs);
      }
      if (child.kind === 'symlink' && (!isLast || follow)) {
        const base = curPath === '' ? '/' : curPath;
        const t = child.target.startsWith('/') ? child.target : base + '/' + child.target;
        const rest = comps.slice(i + 1);
        const next = rest.length ? normalize(t + '/' + rest.join('/')) : normalize(t);
        return this.walk(next, { follow, cred, depth: depth + 1 });
      }
      if (isLast) return { node: child, parent: cur, name, path: curPath + '/' + name };
      cur = child;
      curPath += '/' + name;
    }
    throw new FsError('ENOENT', abs);
  }

  /** Nodo existente o ENOENT. */
  lookup(abs: string, cred: Cred | null = null, follow = true): FsNode {
    const r = this.walk(abs, { follow, cred });
    if (!r.node) throw new FsError('ENOENT', abs);
    return r.node;
  }

  stat(abs: string, cred: Cred | null = null): FsNode | null {
    try {
      return this.walk(abs, { cred }).node;
    } catch {
      return null;
    }
  }

  lstat(abs: string, cred: Cred | null = null): FsNode | null {
    try {
      return this.walk(abs, { cred, follow: false }).node;
    } catch {
      return null;
    }
  }

  exists(abs: string): boolean {
    return this.stat(abs) !== null;
  }

  isDir(abs: string): boolean {
    return this.stat(abs)?.kind === 'dir';
  }

  isFile(abs: string): boolean {
    return this.stat(abs)?.kind === 'file';
  }

  // ───────────────────────── operaciones ─────────────────────────

  private touchDir(dir: FsNode) {
    dir.mtime = this.clock.now;
  }

  mkdir(abs: string, mode = 0o755, cred: Cred | null = null, owner?: Cred): FsNode {
    const r = this.walk(abs, { cred, follow: false });
    if (r.node) throw new FsError('EEXIST', abs);
    if (!r.parent) throw new FsError('EEXIST', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    const who = owner ?? cred ?? ROOT;
    const n = this.makeNode('dir', mode, who.name, who.groups[0] ?? who.name);
    r.parent.children!.set(r.name, n);
    r.parent.nlink++;
    this.touchDir(r.parent);
    return n;
  }

  /** mkdir -p */
  mkdirp(abs: string, mode = 0o755, cred: Cred | null = null): FsNode {
    const comps = split(normalize(abs));
    let cur = '';
    let node = this.root;
    for (const c of comps) {
      cur += '/' + c;
      const ex = this.stat(cur, cred);
      if (ex) {
        if (ex.kind !== 'dir') throw new FsError('ENOTDIR', cur);
        node = ex;
      } else node = this.mkdir(cur, mode, cred);
    }
    return node;
  }

  readFile(abs: string, cred: Cred | null = null): string {
    const n = this.lookup(abs, cred);
    if (n.kind === 'dir') throw new FsError('EISDIR', abs);
    if (!this.can(n, cred, 'r')) throw new FsError('EACCES', abs);
    return n.content;
  }

  writeFile(
    abs: string,
    data: string,
    opts: { append?: boolean; cred?: Cred | null; mode?: number; owner?: Cred } = {},
  ): FsNode {
    const cred = opts.cred ?? null;
    const r = this.walk(abs, { cred });
    if (r.node) {
      if (r.node.kind === 'dir') throw new FsError('EISDIR', abs);
      if (!this.can(r.node, cred, 'w')) throw new FsError('EACCES', abs);
      r.node.content = opts.append ? r.node.content + data : data;
      r.node.size = undefined;
      r.node.mtime = this.clock.now;
      return r.node;
    }
    if (!r.parent) throw new FsError('EISDIR', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    const who = opts.owner ?? cred ?? ROOT;
    const n = this.makeNode('file', opts.mode ?? 0o644, who.name, who.groups[0] ?? who.name);
    n.content = data;
    r.parent.children!.set(r.name, n);
    this.touchDir(r.parent);
    return n;
  }

  /** `touch`: crea vacío o actualiza mtime. */
  touch(abs: string, cred: Cred | null = null, mtime?: number): FsNode {
    const r = this.walk(abs, { cred });
    if (r.node) {
      if (!this.can(r.node, cred, 'w') && cred && cred.name !== r.node.uid)
        throw new FsError('EACCES', abs);
      r.node.mtime = mtime ?? this.clock.now;
      return r.node;
    }
    const n = this.writeFile(abs, '', { cred });
    if (mtime !== undefined) n.mtime = mtime;
    return n;
  }

  readdir(abs: string, cred: Cred | null = null): string[] {
    const n = this.lookup(abs, cred);
    if (n.kind !== 'dir') throw new FsError('ENOTDIR', abs);
    if (!this.can(n, cred, 'r')) throw new FsError('EACCES', abs);
    return [...n.children!.keys()].sort(collate);
  }

  unlink(abs: string, cred: Cred | null = null): void {
    const r = this.walk(abs, { cred, follow: false });
    if (!r.node || !r.parent) throw new FsError('ENOENT', abs);
    if (r.node.kind === 'dir') throw new FsError('EISDIR', abs);
    if (!this.can(r.parent, cred, 'w') || !this.can(r.parent, cred, 'x'))
      throw new FsError('EACCES', abs);
    r.parent.children!.delete(r.name);
    r.node.nlink--;
    this.touchDir(r.parent);
  }

  rmdir(abs: string, cred: Cred | null = null): void {
    const r = this.walk(abs, { cred, follow: false });
    if (!r.node || !r.parent) throw new FsError(r.parent ? 'ENOENT' : 'EBUSY', abs);
    if (r.node.kind !== 'dir') throw new FsError('ENOTDIR', abs);
    if (r.node.children!.size > 0) throw new FsError('ENOTEMPTY', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    r.parent.children!.delete(r.name);
    r.parent.nlink--;
    this.touchDir(r.parent);
  }

  /** rm -r */
  removeTree(abs: string, cred: Cred | null = null): void {
    const r = this.walk(abs, { cred, follow: false });
    if (!r.node || !r.parent) throw new FsError(r.parent ? 'ENOENT' : 'EBUSY', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    if (r.node.kind === 'dir') {
      for (const name of [...r.node.children!.keys()]) {
        this.removeTree(abs.replace(/\/$/, '') + '/' + name, cred);
      }
      r.parent.nlink--;
    } else r.node.nlink--;
    r.parent.children!.delete(r.name);
    this.touchDir(r.parent);
  }

  symlink(target: string, abs: string, cred: Cred | null = null): FsNode {
    const r = this.walk(abs, { cred, follow: false });
    if (r.node) throw new FsError('EEXIST', abs);
    if (!r.parent) throw new FsError('EEXIST', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    const who = cred ?? ROOT;
    const n = this.makeNode('symlink', 0o777, who.name, who.groups[0] ?? who.name);
    n.target = target;
    r.parent.children!.set(r.name, n);
    this.touchDir(r.parent);
    return n;
  }

  /** Enlace duro: misma instancia de nodo con dos nombres. */
  link(existing: string, abs: string, cred: Cred | null = null): void {
    const src = this.lookup(existing, cred);
    if (src.kind === 'dir') throw new FsError('EPERM', existing);
    const r = this.walk(abs, { cred, follow: false });
    if (r.node) throw new FsError('EEXIST', abs);
    if (!r.parent) throw new FsError('EEXIST', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    r.parent.children!.set(r.name, src);
    src.nlink++;
    this.touchDir(r.parent);
  }

  /** Copia profunda de un nodo (nuevo inode). */
  cloneNode(n: FsNode, owner?: Cred): FsNode {
    const c: FsNode = {
      ...n,
      ino: newIno(),
      nlink: n.kind === 'dir' ? 2 : 1,
      mtime: this.clock.now,
      children: n.kind === 'dir' ? new Map() : null,
    };
    if (owner) {
      c.uid = owner.name;
      c.gid = owner.groups[0] ?? owner.name;
    }
    if (n.kind === 'dir') {
      for (const [k, v] of n.children!) {
        const cc = this.cloneNode(v, owner);
        c.children!.set(k, cc);
        if (cc.kind === 'dir') c.nlink++;
      }
    }
    return c;
  }

  /** Inserta un nodo ya construido en `abs`. */
  attach(abs: string, node: FsNode, cred: Cred | null = null): void {
    const r = this.walk(abs, { cred, follow: false });
    if (!r.parent) throw new FsError('EEXIST', abs);
    if (!this.can(r.parent, cred, 'w')) throw new FsError('EACCES', abs);
    if (r.node) {
      if (r.node.kind === 'dir' && node.kind !== 'dir') throw new FsError('EISDIR', abs);
      if (r.node.kind !== 'dir' && node.kind === 'dir') throw new FsError('ENOTDIR', abs);
      if (r.node.kind === 'dir' && r.node.children!.size > 0) throw new FsError('ENOTEMPTY', abs);
    }
    r.parent.children!.set(r.name, node);
    if (node.kind === 'dir' && !r.node) r.parent.nlink++;
    this.touchDir(r.parent);
  }

  /** mv: mueve/renombra el nodo. */
  rename(src: string, dst: string, cred: Cred | null = null): void {
    const a = this.walk(src, { cred, follow: false });
    if (!a.node || !a.parent) throw new FsError('ENOENT', src);
    if (!this.can(a.parent, cred, 'w')) throw new FsError('EACCES', src);
    const nsrc = normalize(src);
    const ndst = normalize(dst);
    if (a.node.kind === 'dir' && (ndst === nsrc || ndst.startsWith(nsrc + '/')))
      throw new FsError('EINVAL', dst);
    const b = this.walk(dst, { cred, follow: false });
    if (!b.parent) throw new FsError('EBUSY', dst);
    if (!this.can(b.parent, cred, 'w')) throw new FsError('EACCES', dst);
    if (b.node === a.node) return;
    if (b.node) {
      if (b.node.kind === 'dir' && a.node.kind !== 'dir') throw new FsError('EISDIR', dst);
      if (b.node.kind !== 'dir' && a.node.kind === 'dir') throw new FsError('ENOTDIR', dst);
      if (b.node.kind === 'dir' && b.node.children!.size > 0) throw new FsError('ENOTEMPTY', dst);
    }
    a.parent.children!.delete(a.name);
    b.parent.children!.set(b.name, a.node);
    if (a.node.kind === 'dir') {
      a.parent.nlink--;
      if (!b.node) b.parent.nlink++;
    }
    this.touchDir(a.parent);
    this.touchDir(b.parent);
  }

  chmod(abs: string, mode: number, cred: Cred | null = null): void {
    const n = this.lookup(abs, cred);
    if (cred && cred.name !== 'root' && cred.name !== n.uid) throw new FsError('EPERM', abs);
    n.mode = mode & 0o7777;
    n.mtime = this.clock.now;
  }

  chown(abs: string, owner: string | null, group: string | null, cred: Cred | null = null): void {
    const n = this.lookup(abs, cred);
    if (cred && cred.name !== 'root') throw new FsError('EPERM', abs);
    if (owner) n.uid = owner;
    if (group) n.gid = group;
  }

  // ───────────────────────── utilidades ─────────────────────────

  /** Recorre recursivamente (primero el directorio, luego su contenido). */
  walkTree(
    abs: string,
    fn: (path: string, node: FsNode, depth: number) => boolean | void,
    cred: Cred | null = null,
    depth = 0,
    followLinks = false,
  ): void {
    const node = this.lstat(abs, cred);
    if (!node) return;
    const cont = fn(abs, node, depth);
    if (cont === false) return;
    let dirNode: FsNode | null = node;
    if (node.kind === 'symlink' && followLinks) dirNode = this.stat(abs, cred);
    if (dirNode && dirNode.kind === 'dir') {
      if (!this.can(dirNode, cred, 'r') || !this.can(dirNode, cred, 'x')) return;
      const names = [...dirNode.children!.keys()].sort(collate);
      for (const name of names) {
        this.walkTree(
          (abs === '/' ? '' : abs) + '/' + name,
          fn,
          cred,
          depth + 1,
          followLinks,
        );
      }
    }
  }

  sizeOf(n: FsNode): number {
    if (n.kind === 'dir') return 4096;
    if (n.kind === 'symlink') return n.target.length;
    return n.size ?? utf8Length(n.content);
  }

  /** Espacio usado (en bytes) por un árbol, como `du`. */
  diskUsage(abs: string): number {
    let total = 0;
    this.walkTree(abs, (_p, n) => {
      total += n.kind === 'dir' ? 4096 : Math.max(4096, Math.ceil(this.sizeOf(n) / 4096) * 4096);
    });
    return total;
  }

  // ───────────────────────── (de)serialización ─────────────────────────

  toJSON(): unknown {
    const ser = (n: FsNode): unknown => ({
      k: n.kind,
      m: n.mode,
      u: n.uid,
      g: n.gid,
      t: n.mtime,
      c: n.kind === 'file' ? n.content : undefined,
      l: n.kind === 'symlink' ? n.target : undefined,
      s: n.size,
      ch: n.children
        ? Object.fromEntries([...n.children].map(([k, v]) => [k, ser(v)]))
        : undefined,
    });
    return ser(this.root);
  }

  static fromJSON(data: any, clock: Clock): VFS {
    const fs = new VFS(clock);
    const de = (d: any): FsNode => {
      const n = fs.makeNode(d.k, d.m, d.u, d.g);
      n.mtime = d.t;
      if (d.c !== undefined) n.content = d.c;
      if (d.l !== undefined) n.target = d.l;
      if (d.s !== undefined) n.size = d.s;
      if (d.ch) {
        for (const [k, v] of Object.entries(d.ch)) {
          const c = de(v);
          n.children!.set(k, c);
          if (c.kind === 'dir') n.nlink++;
        }
      }
      return n;
    };
    fs.root = de(data);
    return fs;
  }
}

/** Orden de nombres como en `ls` con locale: sin distinguir mayúsculas, ignorando puntos iniciales. */
export function collate(a: string, b: string): number {
  const ka = a.replace(/^\.+/, '').toLowerCase();
  const kb = b.replace(/^\.+/, '').toLowerCase();
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export { basename, dirname };
