/** find, tree, locate y herramientas de búsqueda de archivos. */
import { C, color, lsDate, modeString, humanSize } from '../format';
import { basename, dirname } from '../path';
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { globMatch, makeRegex } from '../regex';
import { type FsNode, collate } from '../vfs';
import { sizeSuffix } from './util';

// ───────────────────────── find ─────────────────────────

type Pred = (ctx: FindCtx) => boolean | Promise<boolean>;

interface FindCtx {
  path: string;
  node: FsNode;
  depth: number;
  startArg: string;
  prune: boolean;
  quit: boolean;
}

interface Expr {
  eval: Pred;
  hasAction: boolean;
}

function isTestArg(a: string) {
  return a.startsWith('-') || a === '(' || a === '!' || a === ')';
}

function parseFind(c: Ctx, args: string[], gl: { maxdepth: number; mindepth: number; depthFirst: boolean }): Expr {
  let i = 0;
  const now = c.sh.sys.clock.now;
  const peek = () => args[i];
  const next = () => args[i++];
  const need = (what: string): string => {
    if (i >= args.length) throw new Error(`missing argument to \`${what}'`);
    return next();
  };

  const numCmp = (spec: string, value: number, scale = 1): boolean => {
    const m = /^([+-]?)(\d+(?:\.\d+)?)$/.exec(spec);
    if (!m) throw new Error(`invalid argument \`${spec}'`);
    const n = parseFloat(m[2]);
    if (m[1] === '+') return value / scale > n;
    if (m[1] === '-') return value / scale < n;
    return Math.ceil(value / scale) === n || Math.floor(value / scale) === n;
  };

  function primary(): Expr {
    const t = next();
    switch (t) {
      case '(': {
        const e = orExpr();
        if (next() !== ')') throw new Error('unmatched ( ');
        return e;
      }
      case '-name': { const p = need(t); return t_((x) => globMatch(p, basename(x.path) || x.path)); }
      case '-iname': { const p = need(t); return t_((x) => globMatch(p, basename(x.path) || x.path, true)); }
      case '-path': case '-wholename': { const p = need(t); return t_((x) => globMatch(p, x.path)); }
      case '-ipath': { const p = need(t); return t_((x) => globMatch(p, x.path, true)); }
      case '-regex': { const p = need(t); const re = makeRegex(p, { extended: true, wholeLine: true }); return t_((x) => re.test(x.path)); }
      case '-iregex': { const p = need(t); const re = makeRegex(p, { extended: true, wholeLine: true, ignoreCase: true }); return t_((x) => re.test(x.path)); }
      case '-type': {
        const p = need(t);
        const set = new Set(p.split(','));
        return t_((x) => (set.has('f') && x.node.kind === 'file') || (set.has('d') && x.node.kind === 'dir') || (set.has('l') && x.node.kind === 'symlink'));
      }
      case '-size': {
        const p = need(t);
        const m = /^([+-]?)(\d+)([cwbkKMGT]?)$/.exec(p);
        if (!m) throw new Error(`invalid argument \`${p}' to \`-size'`);
        const unit = m[3] === 'c' ? 1 : m[3] === 'w' ? 2 : m[3] === 'k' || m[3] === 'K' ? 1024 : m[3] === 'M' ? 1048576 : m[3] === 'G' ? 1073741824 : 512;
        return t_((x) => {
          const sz = c.fs.sizeOf(x.node);
          const units = Math.ceil(sz / unit);
          const n = parseInt(m[2], 10);
          return m[1] === '+' ? units > n : m[1] === '-' ? units < n : units === n;
        });
      }
      case '-mtime': case '-atime': case '-ctime': { const p = need(t); return t_((x) => numCmp(p, Math.floor((now - x.node.mtime) / 86400000) + (/^\+/.test(p) ? 0 : 0), 1)); }
      case '-mmin': case '-amin': case '-cmin': { const p = need(t); return t_((x) => numCmp(p, (now - x.node.mtime) / 60000, 1)); }
      case '-newer': {
        const p = need(t);
        const ref = c.fs.stat(c.abs(p), c.cred);
        if (!ref) throw new Error(`\`${p}': No such file or directory`);
        return t_((x) => x.node.mtime > ref.mtime);
      }
      case '-perm': {
        const p = need(t);
        const m = /^([-/]?)([0-7]+)$/.exec(p);
        if (!m) throw new Error(`invalid mode \`${p}'`);
        const want = parseInt(m[2], 8);
        return t_((x) => {
          const mode = x.node.mode & 0o7777;
          if (m[1] === '-') return (mode & want) === want;
          if (m[1] === '/') return (mode & want) !== 0;
          return mode === want;
        });
      }
      case '-user': { const p = need(t); return t_((x) => x.node.uid === p || String(c.sh.sys.user(x.node.uid)?.uid) === p); }
      case '-group': { const p = need(t); return t_((x) => x.node.gid === p); }
      case '-uid': { const p = need(t); return t_((x) => String(c.sh.sys.user(x.node.uid)?.uid) === p); }
      case '-empty': return t_((x) => (x.node.kind === 'file' && c.fs.sizeOf(x.node) === 0) || (x.node.kind === 'dir' && x.node.children!.size === 0));
      case '-readable': return t_((x) => c.fs.can(x.node, c.cred, 'r'));
      case '-writable': return t_((x) => c.fs.can(x.node, c.cred, 'w'));
      case '-executable': return t_((x) => c.fs.can(x.node, c.cred, 'x'));
      case '-true': return t_(() => true);
      case '-false': return t_(() => false);
      case '-maxdepth': gl.maxdepth = parseInt(need(t), 10); return t_(() => true);
      case '-mindepth': gl.mindepth = parseInt(need(t), 10); return t_(() => true);
      case '-depth': gl.depthFirst = true; return t_(() => true);
      case '-mount': case '-xdev': case '-noleaf': case '-follow': return t_(() => true);
      case '-prune': return { hasAction: false, eval: (x) => { x.prune = true; return true; } };
      case '-quit': return { hasAction: true, eval: (x) => { x.quit = true; return true; } };
      case '-print': return act(async (x) => { c.out(x.path + '\n'); return true; });
      case '-print0': return act(async (x) => { c.out(x.path + '\0'); return true; });
      case '-ls': return act(async (x) => {
        const n = x.node;
        c.out(`${String(n.ino).padStart(8)} ${String(Math.ceil(c.fs.sizeOf(n) / 1024)).padStart(4)} ${modeString(n.kind, n.mode)} ${String(n.nlink).padStart(2)} ${n.uid.padEnd(8)} ${n.gid.padEnd(8)} ${String(c.fs.sizeOf(n)).padStart(8)} ${lsDate(n.mtime, now)} ${x.path}\n`);
        return true;
      });
      case '-delete': return act(async (x) => {
        gl.depthFirst = true;
        try {
          if (x.node.kind === 'dir') c.fs.rmdir(c.abs(x.path), c.cred);
          else c.fs.unlink(c.abs(x.path), c.cred);
          return true;
        } catch (e) {
          c.err(`find: cannot delete ‘${x.path}’: ${(e as Error).message}\n`);
          return false;
        }
      });
      case '-exec': case '-execdir': case '-ok': case '-okdir': {
        const cmd: string[] = [];
        let plus = false;
        for (;;) {
          if (i >= args.length) throw new Error(`missing argument to \`${t}'`);
          const a = next();
          if (a === ';') break;
          if (a === '+' && cmd[cmd.length - 1] === '{}') {
            plus = true;
            break;
          }
          cmd.push(a);
        }
        if (plus) {
          const batch: string[] = [];
          batches.push({ cmd: cmd.slice(0, -1), paths: batch });
          return act(async (x) => { batch.push(x.path); return true; });
        }
        return act(async (x) => {
          const argv = cmd.map((a) => a.split('{}').join(x.path));
          if (t === '-ok' || t === '-okdir') {
            c.err(`< ${argv.join(' ')} ... ${x.path} > ? `);
            const line = await c.stdin.readLine();
            if (line === null || !/^y/i.test(line)) return false;
          }
          const st = await c.sh.runArgv(argv, { ...c.io, tty: false });
          return st === 0;
        });
      }
      default:
        throw new Error(`unknown predicate \`${t}'`);
    }
  }

  const batches: { cmd: string[]; paths: string[] }[] = [];
  (parseFind as any).batches = batches;

  function t_(fn: (x: FindCtx) => boolean): Expr {
    return { hasAction: false, eval: fn };
  }
  function act(fn: Pred): Expr {
    return { hasAction: true, eval: fn };
  }

  function notExpr(): Expr {
    const p = peek();
    if (p === '!' || p === '-not') {
      next();
      const e = notExpr();
      return { hasAction: e.hasAction, eval: async (x) => !(await e.eval(x)) };
    }
    return primary();
  }
  function andExpr(): Expr {
    let left = notExpr();
    for (;;) {
      const p = peek();
      if (p === undefined || p === ')' || p === '-o' || p === '-or') break;
      if (p === '-a' || p === '-and') next();
      const right = notExpr();
      const l = left;
      left = { hasAction: l.hasAction || right.hasAction, eval: async (x) => (await l.eval(x)) && (await right.eval(x)) };
    }
    return left;
  }
  function orExpr(): Expr {
    let left = andExpr();
    while (peek() === '-o' || peek() === '-or') {
      next();
      const right = andExpr();
      const l = left;
      left = { hasAction: l.hasAction || right.hasAction, eval: async (x) => (await l.eval(x)) || (await right.eval(x)) };
    }
    return left;
  }

  if (args.length === 0) return { hasAction: false, eval: () => true };
  const e = orExpr();
  if (i < args.length) throw new Error(`paths must precede expression: \`${args[i]}'`);
  (e as any).batches = batches;
  return e;
}

defineCommand('find', {
  summary: 'Busca archivos y directorios por nombre, tipo, tamaño, fecha, permisos…',
  usage: 'find [RUTA...] [EXPRESIÓN]',
  category: 'busqueda',
  level: 2,
  options: [
    ['-name PATRÓN', 'Por nombre (usa comillas: "*.txt")'],
    ['-iname PATRÓN', 'Por nombre sin distinguir mayúsculas'],
    ['-type f|d|l', 'Archivo, directorio o enlace'],
    ['-size +10M', 'Más grande de 10 MB (+ mayor, - menor)'],
    ['-mtime -7', 'Modificado en los últimos 7 días'],
    ['-mmin -30', 'Modificado en los últimos 30 minutos'],
    ['-perm 644', 'Con esos permisos exactos'],
    ['-user NOMBRE', 'Perteneciente a un usuario'],
    ['-empty', 'Archivos o directorios vacíos'],
    ['-maxdepth N', 'Limita la profundidad'],
    ['-exec CMD {} \\;', 'Ejecuta un comando por cada resultado'],
    ['-delete', 'Borra lo encontrado'],
  ],
  examples: [
    ['find . -name "*.txt"', 'Todos los .txt desde el directorio actual'],
    ['find /var/log -type f -size +1M', 'Logs de más de 1 MB'],
    ['find . -name "*.tmp" -delete', 'Borra los .tmp'],
    ['find . -type f -exec grep -l "error" {} \\;', 'Archivos que contienen "error"'],
  ],
}, async (c) => {
  const args = [...c.args];
  const paths: string[] = [];
  while (args.length && !isTestArg(args[0])) paths.push(args.shift()!);
  if (!paths.length) paths.push('.');
  const gl = { maxdepth: Infinity, mindepth: 0, depthFirst: false };
  let expr: Expr;
  try {
    expr = parseFind(c, args, gl);
  } catch (e) {
    c.err(`find: ${(e as Error).message}\n`);
    return 1;
  }
  const implicit = !expr.hasAction;
  const batches: { cmd: string[]; paths: string[] }[] = (expr as any).batches ?? [];
  let status = 0;
  let quit = false;

  const visit = async (path: string, shown: string, depth: number, startArg: string): Promise<void> => {
    if (quit) return;
    const node = c.fs.lstat(path, c.cred);
    if (!node) return;
    const fc: FindCtx = { path: shown, node, depth, startArg, prune: false, quit: false };
    const process = async () => {
      if (depth < gl.mindepth) return;
      const r = await expr.eval(fc);
      if (r && implicit) c.out(shown + '\n');
      if (fc.quit) quit = true;
    };
    if (!gl.depthFirst) await process();
    if (node.kind === 'dir' && depth < gl.maxdepth && !fc.prune && !quit) {
      let names: string[] = [];
      try {
        names = c.fs.readdir(path, c.cred);
      } catch (e) {
        c.err(`find: ‘${shown}’: ${(e as Error).message}\n`);
        status = 1;
      }
      for (const n of names) {
        await visit(path.replace(/\/$/, '') + '/' + n, shown.replace(/\/$/, '') + '/' + n, depth + 1, startArg);
      }
    }
    if (gl.depthFirst) await process();
  };

  for (const p of paths) {
    const abs = c.abs(p);
    try {
      c.fs.walk(abs, { cred: c.cred });
    } catch (e) {
      c.err(`find: ‘${p}’: ${(e as Error).message}\n`);
      status = 1;
      continue;
    }
    if (!c.fs.lstat(abs, c.cred)) {
      c.err(`find: ‘${p}’: No such file or directory\n`);
      status = 1;
      continue;
    }
    await visit(abs, p, 0, p);
  }
  for (const b of batches) {
    if (b.paths.length) {
      const st = await c.sh.runArgv([...b.cmd, ...b.paths], { ...c.io, tty: false });
      if (st !== 0) status = st;
    }
  }
  return status;
});

// ───────────────────────── tree ─────────────────────────

defineCommand('tree', {
  summary: 'Muestra el contenido de un directorio en forma de árbol',
  usage: 'tree [-adfLCI] [DIRECTORIO]...',
  category: 'archivos',
  package: 'tree',
  level: 1,
  options: [['-a', 'Incluye ocultos'], ['-d', 'Solo directorios'], ['-L N', 'Profundidad máxima'], ['-f', 'Ruta completa'], ['-I PATRÓN', 'Excluye patrón'], ['-h', 'Tamaños legibles']],
  examples: [['tree', 'Árbol del directorio actual'], ['tree -L 2 ~', 'Solo dos niveles de tu home'], ['tree -a -I ".git"', 'Con ocultos excepto .git']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'adfCnhpDu', values: 'LI' });
  const maxDepth = o.val('L') ? parseInt(o.val('L')!, 10) : Infinity;
  const ignore = o.val('I');
  const targets = o.rest.length ? o.rest : ['.'];
  let dirs = 0;
  let files = 0;
  let status = 0;
  const useColor = c.tty && !o.has('n');
  const label = (name: string, n: FsNode, full: string) => {
    let s = o.has('f') ? full : name;
    if (useColor) {
      const col = n.kind === 'dir' ? C.dir : n.kind === 'symlink' ? C.link : n.mode & 0o111 ? C.exec : '';
      if (col) s = color(col, s);
    }
    if (n.kind === 'symlink') s += ' -> ' + n.target;
    if (o.has('h')) s = `[${humanSize(c.fs.sizeOf(n)).padStart(4)}]  ${s}`;
    return s;
  };
  const lines: string[] = [];
  const rec = (path: string, shown: string, prefix: string, depth: number) => {
    let names: string[];
    try {
      names = c.fs.readdir(path, c.cred);
    } catch {
      lines[lines.length - 1] += '  [error opening dir]';
      status = 2;
      return;
    }
    names = names.filter((n) => (o.has('a') || !n.startsWith('.')) && !(ignore && ignore.split('|').some((p) => globMatch(p, n))));
    const entries = names
      .map((n) => ({ n, node: c.fs.lstat(path.replace(/\/$/, '') + '/' + n, c.cred)! }))
      .filter((e) => !!e.node && (!o.has('d') || e.node.kind === 'dir'));
    entries.forEach((e, idx) => {
      const last = idx === entries.length - 1;
      const full = shown.replace(/\/$/, '') + '/' + e.n;
      lines.push(prefix + (last ? '└── ' : '├── ') + label(e.n, e.node, full));
      if (e.node.kind === 'dir') {
        dirs++;
        if (depth < maxDepth) rec(path.replace(/\/$/, '') + '/' + e.n, full, prefix + (last ? '    ' : '│   '), depth + 1);
      } else files++;
    });
  };
  for (const t of targets) {
    const abs = c.abs(t);
    const node = c.fs.lstat(abs, c.cred);
    if (!node) {
      lines.push(`${t} [error opening dir]`);
      status = 2;
      continue;
    }
    lines.push(useColor && node.kind === 'dir' ? color(C.dir, t) : t);
    if (node.kind === 'dir') rec(abs, t, '', 1);
  }
  c.out(lines.join('\n') + `\n\n${dirs} director${dirs === 1 ? 'y' : 'ies'}${o.has('d') ? '' : `, ${files} file${files === 1 ? '' : 's'}`}\n`);
  return status;
});

// ───────────────────────── locate ─────────────────────────

defineCommand('updatedb', { summary: 'Actualiza la base de datos de locate', usage: 'sudo updatedb', category: 'busqueda', sbin: true, level: 3 }, (c) => {
  if (c.cred.name !== 'root') return c.fail('can not open a temporary file for `/var/lib/plocate/plocate.db\'', 1);
  const all: string[] = [];
  c.fs.walkTree('/', (p) => {
    if (p.startsWith('/proc') || p.startsWith('/sys') || p.startsWith('/dev')) return false;
    all.push(p);
  });
  c.fs.writeFile('/var/lib/plocate.db', all.join('\n') + '\n', { cred: null });
});

defineCommand(['locate', 'plocate'], {
  summary: 'Busca archivos por nombre usando una base de datos rápida',
  usage: 'locate [-i] [-c] PATRÓN...',
  category: 'busqueda',
  level: 2,
  options: [['-i', 'Ignora mayúsculas'], ['-c', 'Solo cuenta coincidencias'], ['-n N', 'Máximo N resultados']],
  examples: [['locate passwd', 'Todas las rutas con "passwd"'], ['sudo updatedb', 'Actualiza la base antes de buscar']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'icbewSq', values: 'nr' });
  if (!o.rest.length) return c.fail('no pattern to search for specified');
  let db: string;
  try {
    db = c.fs.readFile('/var/lib/plocate.db', null);
  } catch {
    // base ausente: se genera al vuelo
    const all: string[] = [];
    c.fs.walkTree('/', (p) => {
      if (p.startsWith('/proc') || p.startsWith('/sys') || p.startsWith('/dev') || p.startsWith('/root')) return false;
      all.push(p);
    });
    db = all.join('\n');
  }
  const limit = o.val('n') ? parseInt(o.val('n')!, 10) : Infinity;
  let count = 0;
  for (const line of db.split('\n').filter(Boolean)) {
    const match = o.rest.some((pat) => {
      if (/[*?[]/.test(pat)) return globMatch(pat, line, o.has('i'));
      return o.has('i') ? line.toLowerCase().includes(pat.toLowerCase()) : line.includes(pat);
    });
    if (!match) continue;
    // solo si el usuario puede ver la ruta
    if (!c.fs.lstat(line, c.cred)) continue;
    if (++count > limit) break;
    if (!o.has('c')) c.out(line + '\n');
  }
  if (o.has('c')) c.out(count + '\n');
  return count > 0 ? 0 : 1;
});

export { collate, dirname };
