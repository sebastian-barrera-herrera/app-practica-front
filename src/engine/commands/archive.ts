/** tar, gzip, bzip2, xz, zip y unzip sobre archivos simulados. */
import { isoFull, modeString, padStart } from '../format';
import { basename, dirname, normalize } from '../path';
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { globMatch } from '../regex';
import { FsError, type FsNode } from '../vfs';
import { readInputs } from './util';

export const GZ = '\x1f\x8b\x08\x00@@GZ@@';
export const BZ = 'BZh91AY&SY@@BZ@@';
export const XZ = '\xfd7zXZ\x00@@XZ@@';
export const TAR = 'ustar  \x00@@TAR@@';
export const ZIP = 'PK\x03\x04@@ZIP@@';

interface Entry {
  path: string;
  kind: 'file' | 'dir' | 'symlink';
  mode: number;
  mtime: number;
  uid: string;
  gid: string;
  content?: string;
  target?: string;
  size?: number;
}

type Comp = 'gz' | 'bz2' | 'xz' | null;

const MARK: Record<string, string> = { gz: GZ, bz2: BZ, xz: XZ };
const RATIO: Record<string, number> = { gz: 0.4, bz2: 0.35, xz: 0.3 };

function compOf(content: string): Comp {
  if (content.startsWith(GZ)) return 'gz';
  if (content.startsWith(BZ)) return 'bz2';
  if (content.startsWith(XZ)) return 'xz';
  return null;
}

function innerSizeOf(content: string, size?: number): number {
  return size ?? content.length;
}

function wrap(content: string, comp: Comp, innerSize: number): { content: string; size: number } {
  if (!comp) return { content, size: Math.max(10240, Math.ceil(innerSize / 10240) * 10240) };
  return { content: MARK[comp] + content, size: Math.max(32, Math.floor(innerSize * RATIO[comp]) + 24) };
}

function unwrap(content: string): { comp: Comp; inner: string } {
  const c = compOf(content);
  if (!c) return { comp: null, inner: content };
  return { comp: c, inner: content.slice(MARK[c].length) };
}

function entriesOf(inner: string): Entry[] | null {
  const m = inner.startsWith(TAR) ? TAR : inner.startsWith(ZIP) ? ZIP : null;
  if (!m) return null;
  try {
    return JSON.parse(inner.slice(m.length)) as Entry[];
  } catch {
    return null;
  }
}

function nodeSize(n: Entry): number {
  return n.kind === 'dir' ? 0 : (n.size ?? n.content?.length ?? 0);
}

function collect(c: Ctx, abs: string, name: string, out: Entry[], skip: Set<string>, exclude: string[], errors: { n: number }) {
  const l = c.fs.lstat(abs, c.cred);
  if (!l) {
    c.err(`${c.name}: ${name}: Cannot stat: No such file or directory\n`);
    errors.n++;
    return;
  }
  if (skip.has(normalize(abs))) return;
  if (exclude.some((p) => globMatch(p, basename(abs)) || globMatch(p, name))) return;
  const e: Entry = { path: name, kind: l.kind, mode: l.mode, mtime: l.mtime, uid: l.uid, gid: l.gid };
  if (l.kind === 'file') {
    if (!c.fs.can(l, c.cred, 'r')) {
      c.err(`${c.name}: ${name}: Cannot open: Permission denied\n`);
      errors.n++;
      return;
    }
    e.content = l.content;
    e.size = c.fs.sizeOf(l);
  } else if (l.kind === 'symlink') e.target = l.target;
  out.push(e);
  if (l.kind === 'dir') {
    let names: string[] = [];
    try {
      names = c.fs.readdir(abs, c.cred);
    } catch {
      c.err(`${c.name}: ${name}: Cannot open: Permission denied\n`);
      errors.n++;
      return;
    }
    for (const n of names) collect(c, abs.replace(/\/$/, '') + '/' + n, name.replace(/\/$/, '') + '/' + n, out, skip, exclude, errors);
  }
}

function extractEntries(c: Ctx, entries: Entry[], base: string, opts: { strip: number; verbose: boolean; preserve: boolean; keepOld: boolean; filter: string[]; logName: (e: Entry) => void; stdout: boolean }): number {
  let st = 0;
  const root = c.cred.name === 'root';
  for (const e of entries) {
    let parts = e.path.split('/').filter(Boolean);
    if (opts.strip) parts = parts.slice(opts.strip);
    if (!parts.length) continue;
    if (opts.filter.length && !opts.filter.some((f) => e.path === f || e.path.startsWith(f.replace(/\/$/, '') + '/'))) continue;
    const dest = base.replace(/\/$/, '') + '/' + parts.join('/');
    opts.logName(e);
    if (opts.stdout) {
      if (e.kind === 'file') c.out(e.content ?? '');
      continue;
    }
    try {
      c.fs.mkdirp(dirname(dest), 0o755, c.cred);
      const ex = c.fs.lstat(dest, c.cred);
      if (e.kind === 'dir') {
        if (!ex) c.fs.mkdir(dest, e.mode, c.cred);
        const n = c.fs.stat(dest, c.cred);
        if (n) {
          n.mode = opts.preserve || root ? e.mode : e.mode & ~c.sh.umask;
          n.mtime = e.mtime;
          if (root) { n.uid = e.uid; n.gid = e.gid; }
        }
      } else if (e.kind === 'symlink') {
        if (ex) c.fs.unlink(dest, c.cred);
        c.fs.symlink(e.target ?? '', dest, c.cred);
      } else {
        if (ex && opts.keepOld) {
          c.err(`tar: ${parts.join('/')}: Cannot open: File exists\n`);
          st = 2;
          continue;
        }
        if (ex && ex.kind === 'dir') throw new FsError('EISDIR', dest);
        const n = c.fs.writeFile(dest, e.content ?? '', { cred: c.cred, mode: opts.preserve || root ? e.mode : e.mode & ~c.sh.umask });
        n.mode = opts.preserve || root ? e.mode : e.mode & ~c.sh.umask;
        n.mtime = e.mtime;
        if (e.size && e.size !== (e.content?.length ?? 0)) n.size = e.size;
        if (root) { n.uid = e.uid; n.gid = e.gid; }
      }
    } catch (err) {
      c.err(`tar: ${parts.join('/')}: Cannot open: ${(err as Error).message}\n`);
      st = 2;
    }
  }
  return st;
}

defineCommand('tar', {
  summary: 'Empaqueta y desempaqueta archivos (.tar, .tar.gz, .tgz)',
  usage: 'tar -c|-x|-t [-z|-j|-J] [-v] -f ARCHIVO [-C DIR] [ARCHIVOS...]',
  category: 'compresion',
  noHelp: true,
  level: 2,
  options: [['-c', 'Crear un archivo'], ['-x', 'Extraer'], ['-t', 'Listar el contenido'], ['-z', 'Comprimir con gzip (.tar.gz)'], ['-j', 'bzip2 (.tar.bz2)'], ['-J', 'xz (.tar.xz)'], ['-v', 'Detallado: muestra los archivos'], ['-f ARCH', 'Nombre del archivo (siempre antes del nombre)'], ['-C DIR', 'Cambia al directorio DIR'], ['--exclude=PAT', 'Excluye archivos'], ['--strip-components=N', 'Quita N niveles al extraer']],
  examples: [['tar -czvf backup.tar.gz proyecto/', 'Crea un backup comprimido'], ['tar -xzvf backup.tar.gz', 'Lo extrae'], ['tar -tf backup.tar.gz', 'Lista sin extraer'], ['tar -xf datos.tar -C /tmp', 'Extrae en /tmp'], ['Recordatorio: c=crear x=extraer t=listar z=gzip v=verbose f=file', 'Mnemotecnia: "eXtraer Ziped Verbose File"']],
}, async (c) => {
  if (c.args[0] === '--help') {
    c.out('Uso: tar [OPCIÓN...] [ARCHIVO]...\nGuarda y restaura archivos en un archivo tar.\nEjemplos:\n  tar -cvf archivo.tar foo bar  # Crea archivo.tar con foo y bar\n  tar -tvf archivo.tar          # Lista archivos\n  tar -xf archivo.tar           # Extrae\n');
    return 0;
  }
  const args = [...c.args];
  if (args[0] && !args[0].startsWith('-') && /^[a-zA-Z]+$/.test(args[0])) args[0] = '-' + args[0];
  const strip = args.find((a) => a.startsWith('--strip-components='))?.split('=')[1] ?? args.find((a) => a.startsWith('--strip='))?.split('=')[1];
  const excludes = args.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice(10));
  const filtered = args.filter((a) => !a.startsWith('--strip') && !a.startsWith('--exclude='));
  const o = parseOpts(c, filtered, { flags: 'cxtrAuzjJvpkhaOwWSm', values: 'fCTX', long: { '--create': 'c', '--extract': 'x', '--get': 'x', '--list': 't', '--gzip': 'z', '--bzip2': 'j', '--xz': 'J', '--verbose': 'v', '--file': 'f', '--directory': 'C', '--preserve-permissions': 'p', '--keep-old-files': 'k', '--to-stdout': 'O' } });
  const mode = o.has('c') ? 'c' : o.has('x') ? 'x' : o.has('t') ? 't' : o.has('r') ? 'r' : null;
  if (!mode) {
    c.err('tar: You must specify one of the \'-Acdtrux\', \'--delete\' or  \'--test-label\' options\nTry \'tar --help\' or \'tar --usage\' for more information.\n');
    return 2;
  }
  const file = o.val('f');
  if (!file && mode === 'c') {
    c.err('tar: Refusing to write archive contents to terminal (missing -f option?)\ntar: Error is not recoverable: exiting now\n');
    return 2;
  }
  const dir = o.val('C') ? c.abs(o.val('C')!) : c.sh.cwd;
  const asComp: Comp = o.has('z') ? 'gz' : o.has('j') ? 'bz2' : o.has('J') ? 'xz' : null;

  if (mode === 'c') {
    const operands = o.rest;
    if (!operands.length) {
      c.err('tar: Cowardly refusing to create an empty archive\nTry \'tar --help\' or \'tar --usage\' for more information.\n');
      return 2;
    }
    const entries: Entry[] = [];
    const errors = { n: 0 };
    const archAbs = file && file !== '-' ? c.abs(file) : '';
    const skip = new Set<string>(archAbs ? [normalize(archAbs)] : []);
    let stripped = false;
    for (const op of operands) {
      const abs = dir === c.sh.cwd ? c.abs(op) : normalize(dir + '/' + op);
      let name = op;
      if (name.startsWith('/')) {
        name = name.replace(/^\/+/, '');
        stripped = true;
      }
      name = name.replace(/\/+$/, '') || '.';
      if (name.startsWith('./') && false) name = name.slice(2);
      collect(c, abs, name, entries, skip, excludes, errors);
    }
    if (stripped) c.err("tar: Removing leading `/' from member names\n");
    if (o.has('v')) for (const e of entries) c.out(e.path + (e.kind === 'dir' ? '/' : '') + '\n');
    const total = entries.reduce((s, e) => s + nodeSize(e), 0);
    const inner = TAR + JSON.stringify(entries);
    const w = wrap(inner, asComp ?? (file && /\.(tar\.gz|tgz)$/.test(file) && false ? 'gz' : null), total + 512 * entries.length);
    if (file === '-') {
      c.out(w.content);
    } else {
      try {
        const n = c.fs.writeFile(archAbs, w.content, { cred: c.cred });
        n.size = w.size;
      } catch (e) {
        c.err(`tar: ${file}: Cannot open: ${(e as Error).message}\ntar: Error is not recoverable: exiting now\n`);
        return 2;
      }
    }
    if (errors.n) {
      c.err('tar: Exiting with failure status due to previous errors\n');
      return 2;
    }
    return 0;
  }

  // x / t
  let data: string;
  if (!file || file === '-') data = await c.stdin.readAll();
  else {
    try {
      data = c.fs.readFile(c.abs(file), c.cred);
    } catch (e) {
      c.err(`tar: ${file}: Cannot open: ${(e as Error).message}\ntar: Error is not recoverable: exiting now\n`);
      return 2;
    }
  }
  const u = unwrap(data);
  if (asComp && u.comp !== asComp) {
    const tool = asComp === 'gz' ? 'gzip' : asComp === 'bz2' ? 'bzip2' : 'xz';
    c.err(`${tool}: stdin: not in ${tool} format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }
  const entries = entriesOf(u.inner);
  if (!entries) {
    c.err('tar: This does not look like a tar archive\ntar: Skipping to next header\ntar: Exiting with failure status due to previous errors\n');
    return 2;
  }
  if (mode === 't') {
    const now = c.sh.sys.clock.now;
    for (const e of entries) {
      if (o.rest.length && !o.rest.some((f) => e.path === f || e.path.startsWith(f.replace(/\/$/, '') + '/'))) continue;
      if (o.has('v')) c.out(`${modeString(e.kind, e.mode)} ${e.uid}/${e.gid} ${padStart(String(nodeSize(e)), 9)} ${isoFull(e.mtime).slice(0, 16)} ${e.path}${e.kind === 'dir' ? '/' : ''}${e.kind === 'symlink' ? ' -> ' + e.target : ''}\n`);
      else c.out(e.path + (e.kind === 'dir' ? '/' : '') + '\n');
    }
    void now;
    return 0;
  }
  if (!c.fs.isDir(dir)) {
    c.err(`tar: ${o.val('C')}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now\n`);
    return 2;
  }
  return extractEntries(c, entries, dir, {
    strip: strip ? parseInt(strip, 10) : 0,
    verbose: o.has('v'),
    preserve: o.has('p'),
    keepOld: o.has('k'),
    filter: o.rest,
    stdout: o.has('O'),
    logName: (e) => {
      if (o.has('v')) c.out(e.path + (e.kind === 'dir' ? '/' : '') + '\n');
    },
  });
});

// ───────────────────────── gzip / bzip2 / xz ─────────────────────────

function makeCompressor(name: string, comp: Exclude<Comp, null>, ext: string, undo: string[], summary: string) {
  defineCommand([name, ...undo], {
    summary,
    usage: `${name} [-dkcvf] ARCHIVO...`,
    category: 'compresion',
    level: 2,
    options: [['-d', 'Descomprimir'], ['-k', 'Conservar el original'], ['-c', 'Escribir en la salida estándar'], ['-v', 'Detallado'], ['-f', 'Forzar'], ['-l', 'Listar información (gzip)'], ['-1…-9', 'Nivel de compresión']],
    examples: [[`${name} datos.txt`, `Crea datos.txt${ext} y borra el original`], [`${name} -k datos.txt`, 'Conserva el original'], [`${name} -d datos.txt${ext}`, 'Descomprime']],
  }, async (c) => {
    const decompress = c.name !== name || c.args.some((a) => /^-[a-zA-Z0-9]*d/.test(a)) || c.name.startsWith('un') || c.name === 'zcat' || c.name === 'bzcat' || c.name === 'xzcat';
    const toStdout = c.name === 'zcat' || c.name === 'bzcat' || c.name === 'xzcat';
    const o = parseOpts(c, c.args, { flags: 'dkcvflrtqn123456789T', long: { '--decompress': 'd', '--uncompress': 'd', '--keep': 'k', '--stdout': 'c', '--verbose': 'v', '--force': 'f', '--list': 'l', '--to-stdout': 'c' } });
    if (!o.rest.length) {
      if (decompress || !c.io.tty) {
        const text = await c.stdin.readAll();
        if (decompress) {
          const u = unwrap(text);
          if (u.comp !== comp) return c.fail('stdin: not in ' + name + ' format');
          c.out(u.inner);
        } else c.out(MARK[comp] + text);
        return 0;
      }
      c.err(`${name}: compressed data not written to a terminal. Use -f to force compression.\nFor help, type: '${name} -h'.\n`);
      return 1;
    }
    let st = 0;
    for (const f of o.rest) {
      const abs = c.abs(f);
      const node = c.fs.stat(abs, c.cred);
      if (!node) {
        c.err(`${name}: ${f}: No such file or directory\n`);
        st = 1;
        continue;
      }
      if (node.kind === 'dir') {
        c.err(`${name}: ${f} is a directory -- ignored\n`);
        st = 1;
        continue;
      }
      if (o.has('l') && !decompress) {
        const u = unwrap(node.content);
        const comps = c.fs.sizeOf(node);
        const unc = u.comp ? innerSizeOf(u.inner) : comps;
        c.out(`         compressed        uncompressed  ratio uncompressed_name\n${padStart(String(comps), 19)} ${padStart(String(unc), 19)} ${padStart(((1 - comps / Math.max(1, unc)) * 100).toFixed(1) + '%', 6)} ${f.replace(new RegExp(ext.replace('.', '\\.') + '$'), '')}\n`);
        continue;
      }
      if (decompress) {
        const u = unwrap(node.content);
        if (u.comp !== comp) {
          c.err(`${name}: ${f}: not in ${name} format\n`);
          st = 1;
          continue;
        }
        if (toStdout || o.has('c')) {
          c.out(u.inner);
          continue;
        }
        const re = new RegExp(`(${ext.replace('.', '\\.')}|\\.t${ext.slice(1, 2)}z)$`);
        if (!re.test(f)) {
          c.err(`${name}: ${f}: unknown suffix -- ignored\n`);
          st = 1;
          continue;
        }
        const outName = f.replace(/\.tgz$/, '.tar').replace(/\.tbz2?$/, '.tar').replace(/\.txz$/, '.tar').replace(new RegExp(ext.replace('.', '\\.') + '$'), '');
        const outAbs = c.abs(outName);
        if (c.fs.exists(outAbs) && !o.has('f')) {
          c.err(`${name}: ${outName} already exists; do you wish to overwrite (y or n)? not overwritten\n`);
          st = 2;
          continue;
        }
        try {
          const n = c.fs.writeFile(outAbs, u.inner, { cred: c.cred, mode: node.mode });
          n.mtime = node.mtime;
          if (node.size && u.inner.length < node.size / RATIO[comp]) n.size = undefined;
          if (!o.has('k')) c.fs.unlink(abs, c.cred);
          if (o.has('v')) c.out(`${f}:\t -- replaced with ${outName}\n`);
        } catch (e) {
          c.err(`${name}: ${outName}: ${(e as Error).message}\n`);
          st = 1;
        }
        continue;
      }
      // comprimir
      if (node.content.startsWith(MARK[comp]) && !o.has('f')) {
        c.err(`${name}: ${f} already has ${ext} suffix -- unchanged\n`);
        st = 2;
        continue;
      }
      if (o.has('c')) {
        c.out(MARK[comp] + node.content);
        continue;
      }
      const outAbs = abs + ext;
      if (c.fs.exists(outAbs) && !o.has('f')) {
        c.err(`${name}: ${f}${ext} already exists; do you wish to overwrite (y or n)? not overwritten\n`);
        st = 2;
        continue;
      }
      try {
        const inner = c.fs.sizeOf(node);
        const w = wrap(node.content, comp, inner);
        const n = c.fs.writeFile(outAbs, w.content, { cred: c.cred, mode: node.mode });
        n.size = w.size;
        n.mtime = node.mtime;
        if (!o.has('k')) c.fs.unlink(abs, c.cred);
        if (o.has('v')) c.out(`${f}:\t${(100 - (w.size / Math.max(1, inner)) * 100).toFixed(1)}% -- replaced with ${f}${ext}\n`);
      } catch (e) {
        c.err(`${name}: ${f}${ext}: ${(e as Error).message}\n`);
        st = 1;
      }
    }
    return st;
  });
}

makeCompressor('gzip', 'gz', '.gz', ['gunzip', 'zcat'], 'Comprime o descomprime archivos con gzip');
makeCompressor('bzip2', 'bz2', '.bz2', ['bunzip2', 'bzcat'], 'Comprime o descomprime archivos con bzip2');
makeCompressor('xz', 'xz', '.xz', ['unxz', 'xzcat'], 'Comprime o descomprime archivos con xz');

// ───────────────────────── zip / unzip ─────────────────────────

defineCommand('zip', {
  summary: 'Crea archivos .zip',
  usage: 'zip [-r] ARCHIVO.zip ARCHIVOS...',
  category: 'compresion',
  package: 'zip',
  level: 2,
  options: [['-r', 'Recursivo (directorios)'], ['-q', 'Silencioso'], ['-e', 'Cifrar con contraseña'], ['-x PAT', 'Excluir']],
  examples: [['zip -r proyecto.zip proyecto/', 'Comprime una carpeta'], ['zip docs.zip a.txt b.txt', 'Varios archivos']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'rqev9', values: 'x' });
  if (o.rest.length < 2) {
    c.err('zip error: Nothing to do!\n');
    return 12;
  }
  let [zname, ...files] = o.rest;
  if (!/\.zip$/i.test(zname)) zname += '.zip';
  const entries: Entry[] = [];
  const errors = { n: 0 };
  const archAbs = c.abs(zname);
  const existing = c.fs.stat(archAbs, c.cred);
  if (existing) {
    const prev = entriesOf(existing.content.replace(ZIP, ZIP));
    if (prev) entries.push(...prev);
  }
  const skip = new Set([normalize(archAbs)]);
  const fresh: Entry[] = [];
  for (const f of files) {
    if (!o.has('r') && c.fs.isDir(c.abs(f))) {
      if (!o.has('q')) c.out(`  adding: ${f.replace(/\/+$/, '')}/ (stored 0%)\n`);
      fresh.push({ path: f.replace(/\/+$/, '') + '/', kind: 'dir', mode: 0o755, mtime: c.sh.sys.clock.now, uid: c.sh.user, gid: c.sh.user });
      continue;
    }
    collect(c, c.abs(f), f.replace(/\/+$/, ''), fresh, skip, o.all('x'), errors);
  }
  if (!fresh.length) {
    c.err(`\tzip warning: name not matched: ${files[0]}\n\nzip error: Nothing to do! (${zname})\n`);
    return 12;
  }
  for (const e of fresh) {
    if (!o.has('q')) {
      const sz = nodeSize(e);
      c.out(`  adding: ${e.path}${e.kind === 'dir' && !e.path.endsWith('/') ? '/' : ''} (${e.kind === 'dir' ? 'stored 0%' : sz === 0 ? 'stored 0%' : `deflated ${Math.min(90, 20 + (sz % 50))}%`})\n`);
    }
    const i = entries.findIndex((x) => x.path === e.path);
    if (i >= 0) entries[i] = e;
    else entries.push(e);
  }
  const total = entries.reduce((s, e) => s + nodeSize(e), 0);
  try {
    const n = c.fs.writeFile(archAbs, ZIP + JSON.stringify(entries), { cred: c.cred });
    n.size = Math.max(22, Math.floor(total * 0.45) + 100 * entries.length);
  } catch (e) {
    c.err(`zip error: Could not create output file (${zname}): ${(e as Error).message}\n`);
    return 15;
  }
  return errors.n ? 18 : 0;
});

defineCommand('unzip', {
  summary: 'Extrae archivos .zip',
  usage: 'unzip [-l] [-d DIR] ARCHIVO.zip',
  category: 'compresion',
  package: 'unzip',
  level: 2,
  options: [['-l', 'Lista el contenido'], ['-d DIR', 'Extrae en DIR'], ['-o', 'Sobrescribe sin preguntar'], ['-q', 'Silencioso']],
  examples: [['unzip proyecto.zip', 'Extrae aquí'], ['unzip -l proyecto.zip', 'Lista'], ['unzip datos.zip -d /tmp/datos', 'En otra carpeta']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'loqnvtp', values: 'dx' });
  const f = o.rest[0];
  if (!f) {
    c.out('UnZip 6.00 of 20 April 2009, by Debian. Original by Info-ZIP.\n\nUsage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]\n');
    return 0;
  }
  let abs = c.abs(f);
  if (!c.fs.exists(abs) && c.fs.exists(abs + '.zip')) abs += '.zip';
  let data: string;
  try {
    data = c.fs.readFile(abs, c.cred);
  } catch {
    c.err(`unzip:  cannot find or open ${f}, ${f}.zip or ${f}.ZIP.\n`);
    return 9;
  }
  const entries = data.startsWith(ZIP) ? entriesOf(data) : null;
  if (!entries) {
    c.err(`Archive:  ${f}\n  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.\n`);
    return 9;
  }
  if (o.has('l')) {
    let total = 0;
    const lines = entries.map((e) => {
      total += nodeSize(e);
      return `${padStart(String(nodeSize(e)), 9)}  ${isoFull(e.mtime).slice(0, 16)}   ${e.path}${e.kind === 'dir' && !e.path.endsWith('/') ? '/' : ''}`;
    });
    c.out(`Archive:  ${f}\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n${lines.join('\n')}\n---------                     -------\n${padStart(String(total), 9)}                     ${entries.length} file${entries.length === 1 ? '' : 's'}\n`);
    return 0;
  }
  const base = o.val('d') ? c.abs(o.val('d')!) : c.sh.cwd;
  if (o.val('d')) {
    try {
      c.fs.mkdirp(base, 0o755, c.cred);
    } catch (e) {
      c.err(`unzip: cannot create extraction directory: ${o.val('d')}\n`);
      void e;
      return 50;
    }
  }
  if (!o.has('q')) c.out(`Archive:  ${f}\n`);
  return extractEntries(c, entries, base, {
    strip: 0,
    verbose: false,
    preserve: false,
    keepOld: false,
    filter: [],
    stdout: false,
    logName: (e) => {
      if (!o.has('q')) c.out(e.kind === 'dir' ? `   creating: ${e.path}${e.path.endsWith('/') ? '' : '/'}\n` : `  inflating: ${e.path}\n`);
    },
  });
});

export type { FsNode };
export { readInputs };
