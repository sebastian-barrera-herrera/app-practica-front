/** Comandos de archivos y directorios. */
import {
  C, color, columns, humanSize, isoFull, lsDate, modeString, padStart, padEnd, table, dateString,
  visibleLength,
} from '../format';
import { basename, dirname, join, normalize, relative, resolve } from '../path';
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { type FsNode, collate, FsError, utf8Length } from '../vfs';
import { applyMode, joinLines, readInputs, splitLines } from './util';
import { hash32 } from '../format';
import { globMatch } from '../regex';

// ───────────────────────── ls ─────────────────────────

interface LsEntry {
  name: string;
  path: string;
  node: FsNode;
  target?: FsNode | null;
}

function nameColor(name: string, n: FsNode): string {
  if (n.kind === 'dir') {
    if (n.mode & 0o002) return n.mode & 0o1000 ? '\x1b[30;42m' : '\x1b[34;42m';
    return C.dir;
  }
  if (n.kind === 'symlink') return C.link;
  if (/\.(tar|tgz|gz|bz2|xz|zip|7z|deb|rpm)$/i.test(name)) return C.archive;
  if (/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(name)) return '\x1b[1;35m';
  if (n.mode & 0o111) return C.exec;
  return '';
}

function blocksOf(fs: Ctx['fs'], n: FsNode): number {
  if (n.kind === 'dir') return 4;
  if (n.kind === 'symlink') return 0;
  const size = fs.sizeOf(n);
  return size === 0 ? 0 : Math.ceil(size / 4096) * 4;
}

defineCommand('ls', {
  summary: 'Lista el contenido de directorios',
  usage: 'ls [OPCIÓN]... [ARCHIVO]...',
  category: 'archivos',
  level: 1,
  options: [
    ['-l', 'Formato largo: permisos, dueño, tamaño, fecha'],
    ['-a', 'Incluye archivos ocultos (que empiezan por .)'],
    ['-A', 'Como -a pero sin . ni ..'],
    ['-h', 'Tamaños legibles (1K, 2M) junto con -l'],
    ['-R', 'Recursivo: entra en los subdirectorios'],
    ['-t', 'Ordena por fecha de modificación (más nuevo primero)'],
    ['-r', 'Invierte el orden'],
    ['-S', 'Ordena por tamaño (más grande primero)'],
    ['-1', 'Un elemento por línea'],
    ['-d', 'Muestra el directorio en sí, no su contenido'],
    ['-F', 'Añade / a directorios, * a ejecutables, @ a enlaces'],
    ['-i', 'Muestra el número de inodo'],
  ],
  examples: [
    ['ls -la', 'Todo, con detalles, incluyendo ocultos'],
    ['ls -lh /var/log', 'Tamaños legibles'],
    ['ls -lt | head', 'Los archivos modificados más recientemente'],
    ['ls *.txt', 'Solo los archivos .txt (el shell expande el *)'],
  ],
}, (c) => {
  const colorArg = c.args.find((a) => a.startsWith('--color'));
  const args = c.args.filter((a) => !a.startsWith('--color'));
  const o = parseOpts(c, args, {
    flags: 'aAlhRtrS1dFipsXUnGLkmqbcf',
    long: {
      '--all': 'a', '--almost-all': 'A', '--human-readable': 'h', '--recursive': 'R', '--reverse': 'r',
      '--classify': 'F', '--directory': 'd', '--inode': 'i', '--size': 's', '--dereference': 'L',
      '--group-directories-first': 'G', '--numeric-uid-gid': 'n', '--sort': 'U',
    },
  });
  const useColor = colorArg
    ? !/=(never|no|none)$/.test(colorArg)
    : c.tty;
  const long = o.has('l') || o.has('n');
  const showAll = o.has('a') || o.has('f');
  const almost = o.has('A');
  const now = c.sh.sys.clock.now;
  const fs = c.fs;
  const home = c.sh.sys.clock.now;
  void home;

  const mkEntry = (name: string, path: string, follow = false): LsEntry | null => {
    const l = fs.lstat(path, c.cred);
    if (!l) return null;
    const e: LsEntry = { name, path, node: l };
    if (l.kind === 'symlink') {
      e.target = fs.stat(path, c.cred);
      if (follow && e.target) e.node = e.target;
    }
    return e;
  };

  const sortEntries = (list: LsEntry[]): LsEntry[] => {
    const l = [...list];
    if (o.has('U') || o.has('f')) return l;
    if (o.has('t')) l.sort((a, b) => b.node.mtime - a.node.mtime || collate(a.name, b.name));
    else if (o.has('S')) l.sort((a, b) => fs.sizeOf(b.node) - fs.sizeOf(a.node) || collate(a.name, b.name));
    else if (o.has('X'))
      l.sort((a, b) => {
        const ea = a.name.includes('.') ? a.name.slice(a.name.lastIndexOf('.')) : '';
        const eb = b.name.includes('.') ? b.name.slice(b.name.lastIndexOf('.')) : '';
        return collate(ea, eb) || collate(a.name, b.name);
      });
    else l.sort((a, b) => collate(a.name, b.name));
    if (o.has('G')) l.sort((a, b) => (a.node.kind === 'dir' ? 0 : 1) - (b.node.kind === 'dir' ? 0 : 1));
    if (o.has('r')) l.reverse();
    return l;
  };

  const display = (e: LsEntry): string => {
    let n = e.name;
    const col = useColor ? nameColor(e.name, e.node) : '';
    let suffix = '';
    if (o.has('F') || o.has('p')) {
      if (e.node.kind === 'dir') suffix = '/';
      else if (o.has('F')) {
        if (e.node.kind === 'symlink') suffix = '@';
        else if (e.node.mode & 0o111) suffix = '*';
      }
    }
    n = col ? color(col, n) + suffix : n + suffix;
    return n;
  };

  const longLines = (list: LsEntry[], withTotal: boolean, total: number): string => {
    const rows: string[][] = [];
    for (const e of list) {
      const n = e.node;
      const sz = fs.sizeOf(n);
      let nm = display(e);
      if (n.kind === 'symlink') {
        const tgt = e.target
          ? useColor ? color(nameColor(basename(n.target), e.target), n.target) : n.target
          : useColor ? color('\x1b[40;31;01m', n.target) : n.target;
        nm += ' -> ' + tgt;
      }
      const row: string[] = [];
      if (o.has('i')) row.push(String(n.ino));
      if (o.has('s')) row.push(String(blocksOf(fs, n)));
      row.push(modeString(n.kind, n.mode));
      row.push(String(n.nlink));
      if (o.has('n')) {
        row.push(String(c.sh.sys.user(n.uid)?.uid ?? n.uid));
        row.push(String(c.sh.sys.groups.get(n.gid)?.gid ?? n.gid));
      } else {
        row.push(n.uid);
        row.push(n.gid);
      }
      row.push(o.has('h') ? humanSize(sz) : String(sz));
      row.push(lsDate(n.mtime, now));
      row.push(nm);
      rows.push(row);
    }
    const nCols = rows[0]?.length ?? 0;
    const widths = Array(nCols).fill(0);
    for (const r of rows) r.forEach((x, i) => { if (i < nCols - 1) widths[i] = Math.max(widths[i], visibleLength(x)); });
    const numericCol = (i: number) => {
      const base = (o.has('i') ? 1 : 0) + (o.has('s') ? 1 : 0);
      return i === base + 1 || i === base + 4 || (o.has('i') && i === 0) || (o.has('s') && i === (o.has('i') ? 1 : 0));
    };
    const out = rows.map((r) =>
      r
        .map((x, i) => {
          if (i === nCols - 1) return x;
          return numericCol(i) ? padStart(x, widths[i]) : padEnd(x, widths[i]);
        })
        .join(' '),
    );
    const totalStr = o.has('h') ? humanSize(total * 1024) : String(total);
    return (withTotal ? `total ${totalStr}\n` : '') + (out.length ? out.join('\n') + '\n' : '');
  };

  const shortLines = (list: LsEntry[]): string => {
    const items = list.map((e) => {
      let s = display(e);
      if (o.has('i')) s = `${e.node.ino} ${s}`;
      if (o.has('s')) s = `${blocksOf(fs, e.node)} ${s}`;
      return s;
    });
    if (o.has('m')) return items.join(', ') + '\n';
    if (c.tty && !o.has('1')) return columns(items, c.cols);
    return items.length ? items.join('\n') + '\n' : '';
  };

  const renderList = (list: LsEntry[], withTotal: boolean): string => {
    if (!list.length) return withTotal && long ? 'total 0\n' : '';
    if (long) {
      const total = list.reduce((s, e) => s + blocksOf(fs, e.node), 0);
      return longLines(list, withTotal, total);
    }
    return shortLines(list);
  };

  let status = 0;
  const targets = o.rest.length ? o.rest : ['.'];
  const fileEntries: LsEntry[] = [];
  const dirTargets: { arg: string; path: string }[] = [];
  for (const t of targets) {
    const abs = c.abs(t);
    let e: LsEntry | null;
    try {
      // intermedios con permisos
      fs.walk(abs, { cred: c.cred });
      e = mkEntry(t, abs, o.has('L'));
    } catch (err) {
      c.err(`ls: cannot access '${t}': ${(err as Error).message}\n`);
      status = 2;
      continue;
    }
    if (!e) {
      c.err(`ls: cannot access '${t}': No such file or directory\n`);
      status = 2;
      continue;
    }
    const isDirLike = e.node.kind === 'dir' || (e.node.kind === 'symlink' && e.target?.kind === 'dir' && !long) || (e.node.kind === 'symlink' && e.target?.kind === 'dir' && o.rest.length > 0 && t.endsWith('/'));
    if (isDirLike && !o.has('d')) dirTargets.push({ arg: t, path: e.node.kind === 'symlink' ? abs : abs });
    else fileEntries.push(e);
  }

  let out = '';
  const sortedFiles = sortEntries(fileEntries);
  if (sortedFiles.length) out += renderList(sortedFiles, false);

  const listDir = (arg: string, path: string, header: boolean, first: boolean) => {
    let names: string[];
    try {
      names = fs.readdir(path, c.cred);
    } catch (e) {
      c.err(`ls: cannot open directory '${arg}': ${(e as Error).message}\n`);
      status = status || 2;
      return;
    }
    if (!first || sortedFiles.length) out += '\n';
    if (header) out += `${arg}:\n`;
    const list: LsEntry[] = [];
    if (showAll) {
      const self = mkEntry('.', path);
      const parent = mkEntry('..', dirname(path));
      if (self) list.push(self);
      if (parent) list.push(parent);
    }
    for (const nm of names) {
      if (nm.startsWith('.') && !showAll && !almost) continue;
      const e = mkEntry(nm, path === '/' ? '/' + nm : path + '/' + nm, o.has('L'));
      if (e) list.push(e);
    }
    const sorted = o.has('f') ? list : sortEntries(list);
    // . y .. siempre primero cuando -a
    if (showAll && !o.has('t') && !o.has('S')) {
      const dots = sorted.filter((e) => e.name === '.' || e.name === '..');
      const rest = sorted.filter((e) => e.name !== '.' && e.name !== '..');
      sorted.length = 0;
      sorted.push(...dots, ...rest);
    }
    out += renderList(sorted, long);
    if (o.has('R')) {
      for (const e of sorted) {
        if (e.name === '.' || e.name === '..') continue;
        if (e.node.kind === 'dir') listDir(arg === '.' ? './' + e.name : arg.replace(/\/$/, '') + '/' + e.name, e.path, true, false);
      }
    }
  };

  const multi = targets.length > 1 || o.has('R');
  dirTargets.sort((a, b) => collate(a.arg, b.arg));
  let first = true;
  for (const d of dirTargets) {
    listDir(d.arg, d.path, multi, first);
    first = false;
  }
  c.out(out.replace(/^\n/, sortedFiles.length ? '\n' : ''));
  return status;
});

// ───────────────────────── cat ─────────────────────────

defineCommand('cat', {
  summary: 'Muestra el contenido de archivos (o concatena varios)',
  usage: 'cat [OPCIÓN]... [ARCHIVO]...',
  category: 'archivos',
  level: 1,
  options: [['-n', 'Numera todas las líneas'], ['-b', 'Numera solo las líneas no vacías'], ['-A', 'Muestra caracteres invisibles ($ al final, ^I tabulador)'], ['-s', 'Comprime líneas vacías repetidas']],
  examples: [['cat notas.txt', 'Muestra el archivo'], ['cat a.txt b.txt > todo.txt', 'Une dos archivos'], ['cat -n script.sh', 'Con números de línea']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'nbAEsTvu', long: { '--number': 'n', '--show-all': 'A', '--squeeze-blank': 's', '--number-nonblank': 'b' } });
  const { inputs, failed } = await readInputs(c, o.rest);
  let n = 1;
  for (const inp of inputs) {
    let lines = inp.text === '' ? [] : inp.text.split('\n');
    const endsNl = inp.text.endsWith('\n');
    if (endsNl) lines.pop();
    if (o.has('s')) {
      const res: string[] = [];
      let prevBlank = false;
      for (const l of lines) {
        const blank = l === '';
        if (blank && prevBlank) continue;
        res.push(l);
        prevBlank = blank;
      }
      lines = res;
    }
    const out = lines.map((l) => {
      let t = l;
      if (o.has('A') || o.has('T')) t = t.replace(/\t/g, '^I');
      if (o.has('A') || o.has('E')) t += '$';
      if (o.has('b')) return l === '' ? t : `${String(n++).padStart(6)}\t${t}`;
      if (o.has('n')) return `${String(n++).padStart(6)}\t${t}`;
      return t;
    });
    c.out(out.join('\n') + (lines.length ? (endsNl || o.has('A') || o.has('E') ? '\n' : '') : ''));
    if (!endsNl && lines.length && !o.has('A') && !o.has('E') && !o.has('n') && !o.has('b')) {
      /* sin salto final: se respeta */
    }
  }
  return failed ? 1 : 0;
});

defineCommand(['less', 'more'], {
  summary: 'Muestra un archivo página a página (en el simulador, lo imprime entero)',
  usage: 'less ARCHIVO',
  category: 'archivos',
  level: 1,
  options: [['q', 'Salir (en Linux real)'], ['/texto', 'Buscar hacia delante'], ['espacio / b', 'Página siguiente / anterior']],
  examples: [['less /var/log/syslog', 'Navega por un log largo']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'NSXRFiMmceFns', values: 'pP', lenient: true });
  const { inputs, failed } = await readInputs(c, o.rest);
  for (const inp of inputs) c.out(inp.text);
  return failed ? 1 : 0;
});

// ───────────────────────── touch / mkdir / rmdir ─────────────────────────

function parseTouchDate(s: string, now: number): number | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  m = /^(\d+)\s+(day|hour|minute|week)s?\s+ago$/.exec(s);
  if (m) return now - +m[1] * { day: 86400000, hour: 3600000, minute: 60000, week: 604800000 }[m[2] as 'day'];
  if (s === 'yesterday') return now - 86400000;
  if (s === 'now') return now;
  return null;
}

defineCommand('touch', {
  summary: 'Crea archivos vacíos o actualiza su fecha de modificación',
  usage: 'touch [OPCIÓN]... ARCHIVO...',
  category: 'archivos',
  level: 1,
  options: [['-c', 'No crea el archivo si no existe'], ['-d FECHA', 'Usa esa fecha (ej. "2026-01-31")'], ['-t', 'Fecha en formato [[CC]YY]MMDDhhmm'], ['-r REF', 'Copia la fecha de otro archivo'], ['-a / -m', 'Cambia solo acceso / modificación']],
  examples: [['touch a.txt b.txt', 'Crea dos archivos vacíos'], ['touch -d "2026-01-01" viejo.txt', 'Con fecha antigua']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'camh', values: 'dtr', long: { '--no-create': 'c', '--date': 'd', '--reference': 'r' } });
  if (!o.rest.length) return c.fail('missing file operand\nTry \'touch --help\' for more information.');
  let mtime: number | undefined;
  if (o.val('d')) {
    const t = parseTouchDate(o.val('d')!, c.sh.sys.clock.now);
    if (t === null) return c.fail(`invalid date format '${o.val('d')}'`);
    mtime = t;
  }
  if (o.val('r')) {
    const ref = c.fs.stat(c.abs(o.val('r')!), c.cred);
    if (!ref) return c.fail(`failed to get attributes of '${o.val('r')}': No such file or directory`);
    mtime = ref.mtime;
  }
  if (o.val('t')) {
    const m = /^(?:(\d{2})?(\d{2}))?(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{2}))?$/.exec(o.val('t')!);
    if (m) {
      const yr = m[2] ? (m[1] ? +m[1] * 100 + +m[2] : 2000 + +m[2]) : new Date(c.sh.sys.clock.now).getUTCFullYear();
      mtime = Date.UTC(yr, +m[3] - 1, +m[4], +m[5], +m[6], +(m[7] ?? 0));
    }
  }
  let st = 0;
  for (const f of o.rest) {
    const abs = c.abs(f);
    try {
      if (o.has('c') && !c.fs.stat(abs, c.cred)) continue;
      const created = !c.fs.stat(abs, c.cred);
      const n = c.fs.touch(abs, c.cred, mtime);
      if (created) n.mode = 0o666 & ~c.sh.umask;
    } catch (e) {
      c.err(`touch: cannot touch '${f}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('mkdir', {
  summary: 'Crea directorios',
  usage: 'mkdir [OPCIÓN]... DIRECTORIO...',
  category: 'archivos',
  level: 1,
  options: [['-p', 'Crea también los directorios padre; no falla si ya existe'], ['-v', 'Explica lo que hace'], ['-m MODO', 'Permisos del directorio']],
  examples: [['mkdir proyectos', 'Crea un directorio'], ['mkdir -p a/b/c', 'Crea la cadena completa'], ['mkdir -m 700 privado', 'Con permisos 700']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'pv', values: 'm', long: { '--parents': 'p', '--verbose': 'v', '--mode': 'm' } });
  if (!o.rest.length) return c.fail("missing operand\nTry 'mkdir --help' for more information.");
  let st = 0;
  let mode = 0o777 & ~c.sh.umask;
  if (o.val('m')) {
    const m = applyMode(o.val('m')!, 0o777 & ~c.sh.umask, true);
    if (m === null) return c.fail(`invalid mode '${o.val('m')}'`);
    mode = m;
  }
  for (const d of o.rest) {
    const abs = c.abs(d);
    try {
      if (o.has('p')) {
        const comps = abs.split('/').filter(Boolean);
        let cur = '';
        for (let i = 0; i < comps.length; i++) {
          cur += '/' + comps[i];
          const ex = c.fs.stat(cur, c.cred);
          if (ex) {
            if (ex.kind !== 'dir') throw new FsError('ENOTDIR', cur);
            continue;
          }
          c.fs.mkdir(cur, i === comps.length - 1 ? mode : 0o777 & ~c.sh.umask, c.cred);
          if (o.has('v')) c.out(`mkdir: created directory '${d}'\n`);
        }
      } else {
        c.fs.mkdir(abs, mode, c.cred);
        if (o.has('v')) c.out(`mkdir: created directory '${d}'\n`);
      }
    } catch (e) {
      c.err(`mkdir: cannot create directory '${d}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('rmdir', {
  summary: 'Elimina directorios vacíos',
  usage: 'rmdir [-p] DIRECTORIO...',
  category: 'archivos',
  level: 1,
  options: [['-p', 'Elimina también los padres si quedan vacíos'], ['-v', 'Explica lo que hace']],
  examples: [['rmdir vacio', 'Borra un directorio vacío (falla si tiene contenido)']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'pv', long: { '--parents': 'p' } });
  if (!o.rest.length) return c.fail("missing operand\nTry 'rmdir --help' for more information.");
  let st = 0;
  for (const d of o.rest) {
    let abs = c.abs(d);
    try {
      c.fs.rmdir(abs, c.cred);
      if (o.has('v')) c.out(`rmdir: removing directory, '${d}'\n`);
      if (o.has('p')) {
        let p = dirname(abs);
        while (p !== '/' && p !== c.sh.cwd) {
          try {
            c.fs.rmdir(p, c.cred);
          } catch {
            break;
          }
          p = dirname(p);
        }
      }
    } catch (e) {
      c.err(`rmdir: failed to remove '${d}': ${(e as Error).message}\n`);
      st = 1;
    }
    abs = '';
  }
  return st;
});

// ───────────────────────── rm / cp / mv / ln ─────────────────────────

defineCommand('rm', {
  summary: 'Elimina archivos y directorios',
  usage: 'rm [OPCIÓN]... ARCHIVO...',
  category: 'archivos',
  level: 1,
  options: [['-r', 'Recursivo: borra directorios y su contenido'], ['-f', 'Fuerza: no pregunta ni se queja si no existe'], ['-i', 'Pregunta antes de cada borrado'], ['-v', 'Muestra lo que borra'], ['-d', 'Borra directorios vacíos']],
  examples: [['rm viejo.txt', 'Borra un archivo (¡no hay papelera!)'], ['rm -r carpeta', 'Borra una carpeta entera'], ['rm -i *.log', 'Pregunta uno por uno']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'rRfivdI', long: { '--recursive': 'r', '--force': 'f', '--interactive': 'i', '--verbose': 'v', '--dir': 'd', '--no-preserve-root': 'N' } });
  const rec = o.has('r') || o.has('R');
  if (!o.rest.length) {
    if (o.has('f')) return 0;
    return c.fail("missing operand\nTry 'rm --help' for more information.");
  }
  let st = 0;
  const confirm = async (msg: string) => {
    c.err(msg);
    const line = await c.stdin.readLine();
    return line !== null && /^y/i.test(line);
  };
  const del = async (path: string, shown: string): Promise<boolean> => {
    const l = c.fs.lstat(path, c.cred);
    if (!l) {
      if (!o.has('f')) {
        c.err(`rm: cannot remove '${shown}': No such file or directory\n`);
        st = 1;
      }
      return false;
    }
    if (l.kind === 'dir') {
      if (!rec && !o.has('d')) {
        c.err(`rm: cannot remove '${shown}': Is a directory\n`);
        st = 1;
        return false;
      }
      if (!rec && o.has('d')) {
        try {
          c.fs.rmdir(path, c.cred);
          if (o.has('v')) c.out(`removed directory '${shown}'\n`);
        } catch (e) {
          c.err(`rm: cannot remove '${shown}': ${(e as Error).message}\n`);
          st = 1;
        }
        return true;
      }
      if (o.has('i') && !(await confirm(`rm: descend into directory '${shown}'? `))) return false;
      let names: string[] = [];
      try {
        names = c.fs.readdir(path, c.cred);
      } catch (e) {
        c.err(`rm: cannot remove '${shown}': ${(e as Error).message}\n`);
        st = 1;
        return false;
      }
      let allGone = true;
      for (const n of names) {
        const ok = await del(path.replace(/\/$/, '') + '/' + n, shown.replace(/\/$/, '') + '/' + n);
        if (!ok) allGone = false;
      }
      if (!allGone) return false;
      if (o.has('i') && !(await confirm(`rm: remove directory '${shown}'? `))) return false;
      try {
        c.fs.rmdir(path, c.cred);
        if (o.has('v')) c.out(`removed directory '${shown}'\n`);
      } catch (e) {
        c.err(`rm: cannot remove '${shown}': ${(e as Error).message}\n`);
        st = 1;
        return false;
      }
      return true;
    }
    if (o.has('i') && !(await confirm(`rm: remove ${l.size === 0 && l.content === '' ? 'regular empty file' : l.kind === 'symlink' ? 'symbolic link' : 'regular file'} '${shown}'? `))) return false;
    try {
      c.fs.unlink(path, c.cred);
      if (o.has('v')) c.out(`removed '${shown}'\n`);
    } catch (e) {
      c.err(`rm: cannot remove '${shown}': ${(e as Error).message}\n`);
      st = 1;
      return false;
    }
    return true;
  };
  for (const f of o.rest) {
    const abs = c.abs(f);
    if (basename(f) === '.' || basename(f) === '..') {
      c.err(`rm: refusing to remove '.' or '..' directory: skipping '${f}'\n`);
      st = 1;
      continue;
    }
    if (abs === '/' && rec && !o.has('N')) {
      c.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      st = 1;
      continue;
    }
    await del(abs, f);
  }
  return st;
});

function copyTree(
  c: Ctx,
  src: string,
  dst: string,
  opts: { rec: boolean; preserve: boolean; verbose: boolean; shownSrc: string; shownDst: string; noClobber: boolean; update: boolean },
): number {
  const s = c.fs.lstat(src, c.cred);
  if (!s) {
    c.err(`cp: cannot stat '${opts.shownSrc}': No such file or directory\n`);
    return 1;
  }
  const follow = s.kind === 'symlink' && !opts.preserve ? c.fs.stat(src, c.cred) : null;
  const node = follow ?? s;
  if (node.kind === 'dir') {
    if (!opts.rec) {
      c.err(`cp: -r not specified; omitting directory '${opts.shownSrc}'\n`);
      return 1;
    }
    const nsrc = normalize(src);
    const ndst = normalize(dst);
    if (ndst === nsrc || ndst.startsWith(nsrc + '/')) {
      c.err(`cp: cannot copy a directory, '${opts.shownSrc}', into itself, '${opts.shownDst}'\n`);
      return 1;
    }
    try {
      if (!c.fs.stat(dst, c.cred)) {
        c.fs.mkdir(dst, node.mode & ~0o000, c.cred);
        const d = c.fs.stat(dst, c.cred)!;
        d.mode = opts.preserve ? node.mode : node.mode & ~c.sh.umask;
        if (opts.preserve) d.mtime = node.mtime;
      }
    } catch (e) {
      c.err(`cp: cannot create directory '${opts.shownDst}': ${(e as Error).message}\n`);
      return 1;
    }
    if (opts.verbose) c.out(`'${opts.shownSrc}' -> '${opts.shownDst}'\n`);
    let st = 0;
    let names: string[] = [];
    try {
      names = c.fs.readdir(src, c.cred);
    } catch (e) {
      c.err(`cp: cannot open directory '${opts.shownSrc}' for reading: ${(e as Error).message}\n`);
      return 1;
    }
    for (const n of names) {
      st |= copyTree(c, src.replace(/\/$/, '') + '/' + n, dst.replace(/\/$/, '') + '/' + n, {
        ...opts,
        shownSrc: opts.shownSrc.replace(/\/$/, '') + '/' + n,
        shownDst: opts.shownDst.replace(/\/$/, '') + '/' + n,
      });
    }
    return st;
  }
  // archivo / enlace
  const existing = c.fs.lstat(dst, c.cred);
  if (existing && opts.noClobber) return 0;
  if (existing && opts.update && existing.mtime >= node.mtime) return 0;
  try {
    if (!c.fs.can(node, c.cred, 'r') && node.kind === 'file') throw new FsError('EACCES', src);
    const clone = c.fs.cloneNode(node);
    if (opts.preserve) {
      clone.mtime = node.mtime;
      if (c.cred.name === 'root') {
        clone.uid = node.uid;
        clone.gid = node.gid;
      } else {
        clone.uid = c.cred.name;
        clone.gid = c.cred.groups[0];
      }
    } else {
      clone.uid = c.cred.name;
      clone.gid = c.cred.groups[0];
      clone.mode = node.mode & ~c.sh.umask & 0o777;
      clone.mtime = c.sh.sys.clock.now;
    }
    if (existing && existing.kind === 'file') {
      // sobrescribir manteniendo inodo/permisos del destino
      if (!c.fs.can(existing, c.cred, 'w')) throw new FsError('EACCES', dst);
      existing.content = clone.content;
      existing.size = clone.size;
      existing.mtime = clone.mtime;
    } else {
      if (existing) c.fs.unlink(dst, c.cred);
      c.fs.attach(dst, clone, c.cred);
    }
    if (opts.verbose) c.out(`'${opts.shownSrc}' -> '${opts.shownDst}'\n`);
  } catch (e) {
    c.err(`cp: cannot create regular file '${opts.shownDst}': ${(e as Error).message}\n`);
    return 1;
  }
  return 0;
}

defineCommand('cp', {
  summary: 'Copia archivos y directorios',
  usage: 'cp [OPCIÓN]... ORIGEN... DESTINO',
  category: 'archivos',
  level: 1,
  options: [['-r', 'Recursivo (necesario para directorios)'], ['-a', 'Archivo: -r conservando permisos, fechas y enlaces'], ['-p', 'Conserva permisos y fechas'], ['-i', 'Pregunta antes de sobrescribir'], ['-n', 'No sobrescribe'], ['-v', 'Muestra lo que copia'], ['-u', 'Copia solo si el origen es más nuevo']],
  examples: [['cp a.txt b.txt', 'Copia a.txt como b.txt'], ['cp -r carpeta/ respaldo/', 'Copia una carpeta'], ['cp *.txt ~/Documents/', 'Copia varios archivos a un directorio']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'rRaipnvufTdP', values: 't', long: { '--recursive': 'r', '--archive': 'a', '--verbose': 'v', '--interactive': 'i', '--no-clobber': 'n', '--update': 'u', '--preserve': 'p', '--force': 'f', '--target-directory': 't' } });
  let srcs = [...o.rest];
  let dest: string | undefined;
  if (o.val('t')) dest = o.val('t');
  else dest = srcs.pop();
  if (!dest || !srcs.length) {
    if (!dest) return c.fail("missing file operand\nTry 'cp --help' for more information.");
    return c.fail(`missing destination file operand after '${dest}'\nTry 'cp --help' for more information.`);
  }
  const dAbs = c.abs(dest);
  const dNode = c.fs.stat(dAbs, c.cred);
  const destIsDir = !!dNode && dNode.kind === 'dir';
  if (srcs.length > 1 && !destIsDir) return c.fail(`target '${dest}' is not a directory`);
  let st = 0;
  for (const s of srcs) {
    const sAbs = c.abs(s);
    let target = dAbs;
    let shownDst = dest;
    if (destIsDir && !o.has('T')) {
      target = dAbs.replace(/\/$/, '') + '/' + basename(s);
      shownDst = dest.replace(/\/$/, '') + '/' + basename(s);
    }
    if (normalize(sAbs) === normalize(target) || (c.fs.stat(sAbs, c.cred) && c.fs.stat(sAbs, c.cred) === c.fs.stat(target, c.cred))) {
      c.err(`cp: '${s}' and '${shownDst}' are the same file\n`);
      st = 1;
      continue;
    }
    if (o.has('i') && c.fs.lstat(target, c.cred)) {
      c.err(`cp: overwrite '${shownDst}'? `);
      const line = await c.stdin.readLine();
      if (line === null || !/^y/i.test(line)) continue;
    }
    st |= copyTree(c, sAbs, target, {
      rec: o.has('r') || o.has('R') || o.has('a'),
      preserve: o.has('a') || o.has('p'),
      verbose: o.has('v'),
      shownSrc: s,
      shownDst,
      noClobber: o.has('n'),
      update: o.has('u'),
    });
  }
  return st;
});

defineCommand('mv', {
  summary: 'Mueve o renombra archivos y directorios',
  usage: 'mv [OPCIÓN]... ORIGEN... DESTINO',
  category: 'archivos',
  level: 1,
  options: [['-i', 'Pregunta antes de sobrescribir'], ['-n', 'No sobrescribe'], ['-v', 'Muestra lo que mueve'], ['-f', 'Sobrescribe sin preguntar'], ['-u', 'Solo si el origen es más nuevo']],
  examples: [['mv viejo.txt nuevo.txt', 'Renombra'], ['mv *.jpg ~/Pictures/', 'Mueve varios archivos'], ['mv carpeta/ /tmp/', 'Mueve un directorio']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'invfuT', values: 't', long: { '--verbose': 'v', '--interactive': 'i', '--no-clobber': 'n', '--force': 'f', '--target-directory': 't' } });
  const srcs = [...o.rest];
  const dest = o.val('t') ?? srcs.pop();
  if (!dest || !srcs.length) {
    if (!dest) return c.fail("missing file operand\nTry 'mv --help' for more information.");
    return c.fail(`missing destination file operand after '${dest}'\nTry 'mv --help' for more information.`);
  }
  const dAbs = c.abs(dest);
  const dNode = c.fs.stat(dAbs, c.cred);
  const destIsDir = !!dNode && dNode.kind === 'dir';
  if (srcs.length > 1 && !destIsDir) return c.fail(`target '${dest}' is not a directory`);
  let st = 0;
  for (const s of srcs) {
    const sAbs = c.abs(s);
    const sNode = c.fs.lstat(sAbs, c.cred);
    if (!sNode) {
      c.err(`mv: cannot stat '${s}': No such file or directory\n`);
      st = 1;
      continue;
    }
    let target = dAbs;
    let shown = dest;
    if (destIsDir && !o.has('T')) {
      target = dAbs.replace(/\/$/, '') + '/' + basename(s);
      shown = dest.replace(/\/$/, '') + '/' + basename(s);
    }
    if (dest.endsWith('/') && !destIsDir) {
      c.err(`mv: cannot move '${s}' to '${dest}': Not a directory\n`);
      st = 1;
      continue;
    }
    if (normalize(sAbs) === normalize(target) || (c.fs.lstat(target, c.cred) === sNode)) {
      c.err(`mv: '${s}' and '${shown}' are the same file\n`);
      st = 1;
      continue;
    }
    const ex = c.fs.lstat(target, c.cred);
    if (ex && o.has('n')) continue;
    if (ex && o.has('u') && ex.mtime >= sNode.mtime) continue;
    if (ex && o.has('i') && !o.has('f')) {
      c.err(`mv: overwrite '${shown}'? `);
      const line = await c.stdin.readLine();
      if (line === null || !/^y/i.test(line)) continue;
    }
    try {
      c.fs.rename(sAbs, target, c.cred);
      if (o.has('v')) c.out(`renamed '${s}' -> '${shown}'\n`);
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT') c.err(`mv: cannot move '${s}' to '${shown}': No such file or directory\n`);
      else c.err(`mv: cannot move '${s}' to '${shown}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('ln', {
  summary: 'Crea enlaces (duros o simbólicos) entre archivos',
  usage: 'ln [-s] [-f] ORIGEN [ENLACE]',
  category: 'archivos',
  level: 3,
  options: [['-s', 'Enlace simbólico (acceso directo)'], ['-f', 'Sobrescribe el destino'], ['-v', 'Muestra lo que hace']],
  examples: [['ln -s /var/log/syslog ~/syslog', 'Crea un acceso directo'], ['ln original.txt copia-dura.txt', 'Enlace duro: mismo contenido, dos nombres']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'sfvnT', long: { '--symbolic': 's', '--force': 'f', '--verbose': 'v' } });
  if (!o.rest.length) return c.fail("missing file operand\nTry 'ln --help' for more information.");
  const target = o.rest[0];
  let link = o.rest[1] ?? basename(target);
  let abs = c.abs(link);
  const ex = c.fs.stat(abs, c.cred);
  if (ex && ex.kind === 'dir' && !o.has('T')) {
    abs = abs.replace(/\/$/, '') + '/' + basename(target);
    link = link.replace(/\/$/, '') + '/' + basename(target);
  }
  try {
    if (c.fs.lstat(abs, c.cred)) {
      if (!o.has('f')) {
        c.err(`ln: failed to create ${o.has('s') ? 'symbolic' : 'hard'} link '${link}': File exists\n`);
        return 1;
      }
      c.fs.unlink(abs, c.cred);
    }
    if (o.has('s')) c.fs.symlink(target, abs, c.cred);
    else c.fs.link(c.abs(target), abs, c.cred);
    if (o.has('v')) c.out(`'${link}' ${o.has('s') ? '->' : '=>'} '${target}'\n`);
  } catch (e) {
    if (!o.has('s') && e instanceof FsError && e.code === 'ENOENT')
      c.err(`ln: failed to access '${target}': No such file or directory\n`);
    else if (!o.has('s') && e instanceof FsError && e.code === 'EPERM')
      c.err(`ln: ${target}: hard link not allowed for directory\n`);
    else c.err(`ln: failed to create ${o.has('s') ? 'symbolic' : 'hard'} link '${link}': ${(e as Error).message}\n`);
    return 1;
  }
  return 0;
});

// ───────────────────────── stat / file ─────────────────────────

function kindName(n: FsNode): string {
  if (n.kind === 'dir') return 'directory';
  if (n.kind === 'symlink') return 'symbolic link';
  return n.content === '' && !n.size ? 'regular empty file' : 'regular file';
}

defineCommand('stat', {
  summary: 'Muestra información detallada de un archivo',
  usage: 'stat [OPCIÓN]... ARCHIVO...',
  category: 'archivos',
  level: 2,
  options: [['-c FORMATO', 'Formato propio: %n nombre, %s tamaño, %a permisos octales, %U dueño, %y modificación']],
  examples: [['stat notas.txt', 'Tamaño, inodo, permisos y fechas'], ['stat -c "%a %n" *', 'Permisos octales de cada archivo']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'Lft', values: 'c', long: { '--format': 'c', '--dereference': 'L' } });
  if (!o.rest.length) return c.fail("missing operand\nTry 'stat --help' for more information.");
  let st = 0;
  for (const f of o.rest) {
    const abs = c.abs(f);
    let n: FsNode | null;
    try {
      n = o.has('L') ? c.fs.stat(abs, c.cred) : c.fs.lstat(abs, c.cred);
    } catch (e) {
      c.err(`stat: cannot statx '${f}': ${(e as Error).message}\n`);
      st = 1;
      continue;
    }
    if (!n) {
      c.err(`stat: cannot statx '${f}': No such file or directory\n`);
      st = 1;
      continue;
    }
    const size = c.fs.sizeOf(n);
    const fmt = o.val('c');
    if (fmt) {
      c.out(
        fmt.replace(/%([a-zA-Z%])/g, (_m, ch: string) => {
          switch (ch) {
            case 'n': return f;
            case 'N': return n!.kind === 'symlink' ? `'${f}' -> '${n!.target}'` : `'${f}'`;
            case 's': return String(size);
            case 'a': return (n!.mode & 0o7777).toString(8);
            case 'A': return modeString(n!.kind, n!.mode);
            case 'U': return n!.uid;
            case 'G': return n!.gid;
            case 'u': return String(c.sh.sys.user(n!.uid)?.uid ?? 0);
            case 'g': return String(c.sh.sys.groups.get(n!.gid)?.gid ?? 0);
            case 'F': return kindName(n!);
            case 'i': return String(n!.ino);
            case 'h': return String(n!.nlink);
            case 'y': return isoFull(n!.mtime) + '.000000000 +0000';
            case 'Y': return String(Math.floor(n!.mtime / 1000));
            case 'b': return String(Math.ceil(size / 512));
            case '%': return '%';
          }
          return '%' + ch;
        }) + '\n',
      );
      continue;
    }
    const ts = isoFull(n.mtime) + '.000000000 +0000';
    const uid = c.sh.sys.user(n.uid)?.uid ?? 0;
    const gid = c.sh.sys.groups.get(n.gid)?.gid ?? 0;
    c.out(
      `  File: ${f}${n.kind === 'symlink' ? ' -> ' + n.target : ''}\n` +
      `  Size: ${String(size).padEnd(10)} Blocks: ${String(Math.ceil(size / 512)).padEnd(10)} IO Block: 4096   ${kindName(n)}\n` +
      `Device: 801h/2049d\tInode: ${String(n.ino).padEnd(10)} Links: ${n.nlink}\n` +
      `Access: (${(n.mode & 0o7777).toString(8).padStart(4, '0')}/${modeString(n.kind, n.mode)})  Uid: (${String(uid).padStart(5)}/${n.uid.padStart(8)})   Gid: (${String(gid).padStart(5)}/${n.gid.padStart(8)})\n` +
      `Access: ${ts}\nModify: ${ts}\nChange: ${ts}\n Birth: ${ts}\n`,
    );
  }
  return st;
});

export function describeFile(c: Ctx, abs: string): string {
  const l = c.fs.lstat(abs, c.cred);
  if (!l) return 'cannot open (No such file or directory)';
  if (l.kind === 'symlink') {
    const t = c.fs.stat(abs, c.cred);
    return t ? `symbolic link to ${l.target}` : `broken symbolic link to ${l.target}`;
  }
  if (l.kind === 'dir') return 'directory';
  const content = l.content;
  if (content === '' && !l.size) return 'empty';
  if (content.startsWith('\x7fELF')) return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=' + hash32(abs).toString(16).padStart(8, '0') + 'a1b2c3d4e5f6, for GNU/Linux 3.2.0, stripped';
  if (content.startsWith('\x1f\x8b')) return 'gzip compressed data, from Unix, original size modulo 2^32 ' + (l.size ?? 0);
  if (content.startsWith('BZh')) return 'bzip2 compressed data, block size = 900k';
  if (content.startsWith('\xfd7zXZ')) return 'XZ compressed data, checksum CRC64';
  if (content.startsWith('ustar')) return 'POSIX tar archive (GNU)';
  if (content.startsWith('PK')) return 'Zip archive data, at least v2.0 to extract';
  if (content.startsWith('\xff\xd8\xff')) return 'JPEG image data, JFIF standard 1.01, resolution (DPI), density 72x72, segment length 16, baseline, precision 8, 1920x1080, components 3';
  if (content.startsWith('\x89PNG')) return 'PNG image data, 800 x 600, 8-bit/color RGBA, non-interlaced';
  if (content.startsWith('%PDF')) return 'PDF document, version 1.7';
  const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(content);
  if (shebang) {
    const interp = basename(shebang[1] === '/usr/bin/env' && shebang[2] ? shebang[2] : shebang[1]);
    const x = l.mode & 0o111 ? ' executable' : '';
    if (interp === 'bash') return `Bourne-Again shell script, ASCII text${x}`;
    if (interp === 'sh') return `POSIX shell script, ASCII text${x}`;
    if (interp.startsWith('python')) return `Python script, ASCII text${x}`;
    return `script, ASCII text${x}`;
  }
  const nonAscii = /[^\x00-\x7f]/.test(content);
  const txt = nonAscii ? 'Unicode text, UTF-8 text' : 'ASCII text';
  if (/^<!DOCTYPE html|^<html/i.test(content)) return 'HTML document, ' + txt;
  if (/^\s*[{[]/.test(content) && /[}\]]\s*$/.test(content)) {
    try {
      JSON.parse(content);
      return 'JSON text data';
    } catch {
      /* texto */
    }
  }
  if (/^<\?xml/.test(content)) return 'XML 1.0 document, ' + txt;
  const lines = content.split('\n').filter(Boolean);
  if (lines.length > 1 && lines.every((x) => (x.match(/,/g) ?? []).length === (lines[0].match(/,/g) ?? []).length) && (lines[0].match(/,/g) ?? []).length > 0) return 'CSV ' + txt;
  const longLine = content.split('\n').some((x) => x.length > 300);
  const crlf = content.includes('\r\n');
  return txt + (longLine ? ', with very long lines (' + Math.max(...content.split('\n').map((x) => x.length)) + ')' : '') + (crlf ? ', with CRLF line terminators' : '');
}

defineCommand('file', {
  summary: 'Determina el tipo de un archivo',
  usage: 'file [-bi] ARCHIVO...',
  category: 'archivos',
  level: 2,
  options: [['-b', 'Breve: no muestra el nombre'], ['-i', 'Muestra el tipo MIME']],
  examples: [['file foto.jpg', 'JPEG image data…'], ['file /bin/ls', 'ELF 64-bit LSB executable…']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'biLs', long: { '--brief': 'b', '--mime': 'i', '--mime-type': 'i' } });
  if (!o.rest.length) return c.fail('Usage: file [-bi] FILE...');
  for (const f of o.rest) {
    let d = describeFile(c, c.abs(f));
    if (o.has('i')) {
      const l = c.fs.stat(c.abs(f), c.cred);
      if (!l) d = 'cannot open (No such file or directory)';
      else if (l.kind === 'dir') d = 'inode/directory; charset=binary';
      else if (/script/.test(d)) d = 'text/x-shellscript; charset=us-ascii';
      else if (/^ASCII|^Unicode|CSV|HTML|JSON/.test(d)) d = (/HTML/.test(d) ? 'text/html' : /JSON/.test(d) ? 'application/json' : 'text/plain') + '; charset=' + (/Unicode/.test(d) ? 'utf-8' : 'us-ascii');
      else if (/empty/.test(d)) d = 'inode/x-empty; charset=binary';
      else if (/JPEG/.test(d)) d = 'image/jpeg; charset=binary';
      else if (/gzip/.test(d)) d = 'application/gzip; charset=binary';
      else d = 'application/octet-stream; charset=binary';
    }
    c.out(o.has('b') ? d + '\n' : `${f}: ${d}\n`);
  }
});

// ───────────────────────── nombres de ruta ─────────────────────────

defineCommand('basename', {
  summary: 'Extrae el nombre de archivo de una ruta',
  usage: 'basename RUTA [SUFIJO]',
  category: 'archivos',
  level: 2,
  examples: [['basename /var/log/syslog', 'syslog'], ['basename informe.txt .txt', 'informe']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'az', values: 's' });
  if (!o.rest.length) return c.fail("missing operand\nTry 'basename --help' for more information.");
  if (o.has('a') || o.val('s')) {
    for (const p of o.rest) c.out(basename(p, o.val('s')) + '\n');
  } else c.out(basename(o.rest[0], o.rest[1]) + '\n');
});

defineCommand('dirname', {
  summary: 'Extrae el directorio de una ruta',
  usage: 'dirname RUTA...',
  category: 'archivos',
  level: 2,
  examples: [['dirname /var/log/syslog', '/var/log']],
}, (c) => {
  if (!c.args.length) return c.fail("missing operand\nTry 'dirname --help' for more information.");
  for (const p of c.args) c.out(dirname(p) + '\n');
});

defineCommand(['realpath', 'readlink'], {
  summary: 'Resuelve una ruta a su forma absoluta canónica',
  usage: 'realpath [-m] RUTA...  |  readlink [-f] ENLACE',
  category: 'archivos',
  level: 3,
  examples: [['realpath ../docs', 'Ruta absoluta'], ['readlink -f ~/syslog', 'Destino final de un enlace']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'fmesnq', long: { '--canonicalize': 'f' } });
  let st = 0;
  for (const p of o.rest) {
    const abs = c.abs(p);
    if (c.name === 'readlink' && !o.has('f') && !o.has('m') && !o.has('e')) {
      const l = c.fs.lstat(abs, c.cred);
      if (l && l.kind === 'symlink') c.out(l.target + '\n');
      else st = 1;
      continue;
    }
    try {
      const r = c.fs.walk(abs, { cred: c.cred });
      if (!r.node && !o.has('m') && c.name === 'realpath' && !o.has('f')) {
        c.err(`realpath: ${p}: No such file or directory\n`);
        st = 1;
        continue;
      }
      c.out(r.path + '\n');
    } catch (e) {
      if (o.has('m')) c.out(abs + '\n');
      else {
        c.err(`${c.name}: ${p}: ${(e as Error).message}\n`);
        st = 1;
      }
    }
  }
  return st;
});

defineCommand('mktemp', {
  summary: 'Crea un archivo o directorio temporal único',
  usage: 'mktemp [-d] [PLANTILLA]',
  category: 'archivos',
  level: 3,
  options: [['-d', 'Crea un directorio en lugar de un archivo']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'dqu', values: 'p' });
  const tpl = o.rest[0] ?? 'tmp.XXXXXXXXXX';
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const name = tpl.replace(/X+$/, (m) => Array.from(m, () => chars[Math.floor(c.sh.rt.random() * chars.length)]).join(''));
  const dir = o.val('p') ?? (tpl.includes('/') ? '' : '/tmp');
  const path = dir ? `${dir}/${name}` : name;
  try {
    if (o.has('d')) c.fs.mkdir(c.abs(path), 0o700, c.cred);
    else c.fs.writeFile(c.abs(path), '', { cred: c.cred, mode: 0o600 });
  } catch (e) {
    return c.fail(`failed to create ${o.has('d') ? 'directory' : 'file'} via template '${tpl}': ${(e as Error).message}`);
  }
  c.out(path + '\n');
});

defineCommand('truncate', { summary: 'Cambia el tamaño de un archivo', usage: 'truncate -s TAMAÑO ARCHIVO', category: 'archivos', level: 4 }, (c) => {
  const o = parseOpts(c, c.args, { flags: 'c', values: 's' });
  const sz = parseInt(o.val('s') ?? '0', 10);
  for (const f of o.rest) {
    try {
      const cur = c.fs.stat(c.abs(f), c.cred)?.content ?? '';
      c.fs.writeFile(c.abs(f), cur.slice(0, sz).padEnd(sz, '\0'), { cred: c.cred });
    } catch (e) {
      return c.fsfail(e, f);
    }
  }
});

// ───────────────────────── du / df ─────────────────────────

defineCommand('du', {
  summary: 'Muestra el espacio en disco usado por archivos y directorios',
  usage: 'du [OPCIÓN]... [ARCHIVO]...',
  category: 'sistema',
  level: 2,
  options: [['-h', 'Tamaños legibles'], ['-s', 'Solo el total de cada argumento'], ['-a', 'Incluye archivos, no solo directorios'], ['-c', 'Añade un total general'], ['-d N', 'Profundidad máxima N'], ['--max-depth=N', 'Igual que -d N']],
  examples: [['du -sh ~/Downloads', 'Tamaño total de Descargas'], ['du -h --max-depth=1 /var', 'Qué carpetas de /var pesan más']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'hsackmbxL', values: 'd', long: { '--human-readable': 'h', '--summarize': 's', '--all': 'a', '--total': 'c', '--max-depth': 'd', '--apparent-size': 'b' } });
  const targets = o.rest.length ? o.rest : ['.'];
  const maxDepth = o.val('d') !== undefined ? parseInt(o.val('d')!, 10) : o.has('s') ? 0 : Infinity;
  let grand = 0;
  const fmt = (bytes: number) => {
    if (o.has('b')) return String(bytes);
    if (o.has('h')) return humanSize(bytes);
    if (o.has('m')) return String(Math.ceil(bytes / 1048576));
    return String(Math.ceil(bytes / 1024));
  };
  let st = 0;
  for (const t of targets) {
    const abs = c.abs(t);
    const root = c.fs.lstat(abs, c.cred);
    if (!root) {
      c.err(`du: cannot access '${t}': No such file or directory\n`);
      st = 1;
      continue;
    }
    const lines: string[] = [];
    const walk = (path: string, shown: string, node: FsNode, depth: number): number => {
      let size = o.has('b') ? c.fs.sizeOf(node) : node.kind === 'dir' ? 4096 : Math.max(0, Math.ceil(c.fs.sizeOf(node) / 4096) * 4096);
      if (node.kind === 'dir') {
        let names: string[] = [];
        try {
          names = c.fs.readdir(path, c.cred);
        } catch {
          c.err(`du: cannot read directory '${shown}': Permission denied\n`);
          st = 1;
        }
        for (const n of names) {
          const childPath = path.replace(/\/$/, '') + '/' + n;
          const cn = c.fs.lstat(childPath, c.cred);
          if (!cn) continue;
          size += walk(childPath, shown.replace(/\/$/, '') + '/' + n, cn, depth + 1);
        }
        if (depth <= maxDepth) lines.push(`${fmt(size)}\t${shown}`);
      } else if (o.has('a') && depth <= maxDepth) lines.push(`${fmt(size)}\t${shown}`);
      return size;
    };
    const total = walk(abs, t, root, 0);
    grand += total;
    // para un archivo suelto, mostrarlo siempre
    if (root.kind !== 'dir' && !o.has('a')) lines.push(`${fmt(total)}\t${t}`);
    if (lines.length) c.out(lines.join('\n') + '\n');
  }
  if (o.has('c')) c.out(`${fmt(grand)}\ttotal\n`);
  return st;
});

defineCommand('df', {
  summary: 'Muestra el espacio libre y usado de los sistemas de archivos',
  usage: 'df [OPCIÓN]... [ARCHIVO]...',
  category: 'sistema',
  level: 2,
  options: [['-h', 'Tamaños legibles'], ['-T', 'Muestra el tipo de sistema de archivos'], ['-i', 'Muestra inodos en vez de bloques']],
  examples: [['df -h', 'Uso de disco legible'], ['df -h /home', 'Solo el disco que contiene /home']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'hTikHxla', long: { '--human-readable': 'h' } });
  const rows: [string, string, number, number, string][] = [
    ['tmpfs', 'tmpfs', 805306368, 1572864, '/run'],
    ['/dev/vda1', 'ext4', 53687091200, 19327352832, '/'],
    ['tmpfs', 'tmpfs', 4294967296, 0, '/dev/shm'],
    ['tmpfs', 'tmpfs', 5242880, 4096, '/run/lock'],
    ['/dev/vda15', 'vfat', 109395456, 6422528, '/boot/efi'],
  ];
  const wanted = o.rest.length ? o.rest.map((f) => c.abs(f)) : null;
  let list = rows;
  if (wanted) {
    const sel: typeof rows = [];
    for (const w of wanted) {
      if (!c.fs.exists(w)) {
        c.err(`df: ${o.rest[wanted.indexOf(w)]}: No such file or directory\n`);
        return 1;
      }
      let best = rows[1];
      for (const r of rows) if ((w === r[4] || w.startsWith(r[4] + '/')) && r[4].length > best[4].length) best = r;
      sel.push(best);
    }
    list = sel;
  }
  const fmt = (b: number) => (o.has('h') ? humanSize(b) : String(Math.ceil(b / 1024)));
  const head = [o.has('i') ? 'Filesystem' : 'Filesystem'];
  const t: string[][] = [];
  if (o.has('i')) {
    t.push(['Filesystem', 'Inodes', 'IUsed', 'IFree', 'IUse%', 'Mounted on']);
    for (const [fsn, , size, used, mnt] of list) {
      const inodes = Math.floor(size / 16384);
      const iu = Math.floor(used / 65536) + 120;
      t.push([fsn, humanSize(inodes), humanSize(iu), humanSize(inodes - iu), Math.ceil((iu / inodes) * 100) + '%', mnt]);
    }
  } else {
    t.push(o.has('T') ? ['Filesystem', 'Type', o.has('h') ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on'] : ['Filesystem', o.has('h') ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on']);
    for (const [fsn, type, size, used, mnt] of list) {
      const avail = size - used - Math.floor(size * 0.04);
      const row = [fsn, ...(o.has('T') ? [type] : []), fmt(size), fmt(used), fmt(avail), Math.ceil((used / (used + avail)) * 100) + '%', mnt];
      t.push(row);
    }
  }
  void head;
  const align: ('l' | 'r')[] = o.has('T') ? ['l', 'l', 'r', 'r', 'r', 'r', 'l'] : ['l', 'r', 'r', 'r', 'r', 'l'];
  c.out(table(t, align));
});

export { splitLines, joinLines, utf8Length, resolve, join, relative, dateString, globMatch };
