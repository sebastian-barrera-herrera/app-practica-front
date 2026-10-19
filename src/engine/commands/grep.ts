/** grep / egrep / fgrep. */
import { C, color } from '../format';
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { globMatch, makeRegex } from '../regex';
import { splitLines } from './util';
import { basename } from '../path';

interface Src {
  name: string;
  text: string;
}

function collectRecursive(c: Ctx, root: string, shownRoot: string, includes: string[], excludes: string[], excludeDirs: string[], out: Src[], deref: boolean) {
  const node = c.fs.stat(c.abs(root), c.cred);
  if (!node) return;
  if (node.kind !== 'dir') {
    out.push({ name: shownRoot, text: c.fs.readFile(c.abs(root), c.cred) });
    return;
  }
  let names: string[];
  try {
    names = c.fs.readdir(c.abs(root), c.cred);
  } catch (e) {
    c.err(`grep: ${shownRoot}: ${(e as Error).message}\n`);
    return;
  }
  for (const n of names) {
    const p = (root === '.' && shownRoot === '' ? '' : root.replace(/\/$/, '') + '/') + n;
    const shown = (shownRoot === '' ? '' : shownRoot.replace(/\/$/, '') + '/') + n;
    const l = c.fs.lstat(c.abs(p), c.cred);
    if (!l) continue;
    if (l.kind === 'symlink' && !deref) continue;
    const t = c.fs.stat(c.abs(p), c.cred);
    if (!t) continue;
    if (t.kind === 'dir') {
      if (excludeDirs.some((g) => globMatch(g, n))) continue;
      collectRecursive(c, p, shown, includes, excludes, excludeDirs, out, deref);
    } else {
      if (includes.length && !includes.some((g) => globMatch(g, n))) continue;
      if (excludes.some((g) => globMatch(g, n))) continue;
      try {
        out.push({ name: shown, text: c.fs.readFile(c.abs(p), c.cred) });
      } catch (e) {
        c.err(`grep: ${shown}: ${(e as Error).message}\n`);
      }
    }
  }
}

defineCommand(['grep', 'egrep', 'fgrep'], {
  summary: 'Busca líneas que coinciden con un patrón',
  usage: 'grep [OPCIÓN]... PATRÓN [ARCHIVO]...',
  category: 'busqueda',
  level: 1,
  options: [
    ['-i', 'Ignora mayúsculas/minúsculas'],
    ['-v', 'Invierte: líneas que NO coinciden'],
    ['-n', 'Muestra el número de línea'],
    ['-c', 'Solo cuenta las líneas que coinciden'],
    ['-r', 'Busca recursivamente en directorios'],
    ['-l', 'Solo nombres de archivos con coincidencias'],
    ['-w', 'Palabra completa'],
    ['-E', 'Expresiones regulares extendidas (|, +, ?, {})'],
    ['-F', 'Texto literal, sin regex'],
    ['-o', 'Imprime solo la parte que coincide'],
    ['-A N / -B N / -C N', 'N líneas de contexto después / antes / alrededor'],
    ['--include=GLOB', 'Con -r, solo archivos que coincidan'],
  ],
  examples: [
    ['grep error log.txt', 'Líneas con "error"'],
    ['grep -in "warning" app.log', 'Sin distinguir mayúsculas y con número de línea'],
    ['grep -rn "TODO" .', 'Busca en todo el proyecto'],
    ['ps aux | grep nginx', 'Filtra la salida de otro comando'],
    ['grep -E "^(ERROR|WARN)" app.log', 'Alternativas con regex extendida'],
  ],
}, async (c) => {
  const o = parseOpts(c, c.args.filter((a) => !/^--(include|exclude|exclude-dir|color|colour)(=|$)/.test(a)), {
    flags: 'ivncloLwxEFrRhHqsoPaZzTUbVyI',
    values: 'eAfBCmd',
    numeric: true,
    long: {
      '--ignore-case': 'i', '--invert-match': 'v', '--line-number': 'n', '--count': 'c',
      '--files-with-matches': 'l', '--files-without-match': 'L', '--word-regexp': 'w', '--line-regexp': 'x',
      '--extended-regexp': 'E', '--fixed-strings': 'F', '--recursive': 'r', '--dereference-recursive': 'R',
      '--no-filename': 'h', '--with-filename': 'H', '--quiet': 'q', '--silent': 'q', '--no-messages': 's',
      '--only-matching': 'o', '--perl-regexp': 'P', '--regexp': 'e', '--file': 'f', '--max-count': 'm',
      '--after-context': 'A', '--before-context': 'B', '--context': 'C', '--text': 'a',
    },
    lenient: false,
  });
  // opciones largas con valor que el parser no soporta de forma genérica
  const extra = c.args.filter((a) => /^--(include|exclude|exclude-dir|color|colour)(=|$)/.test(a));
  const includes: string[] = [];
  const excludes: string[] = [];
  const excludeDirs: string[] = [];
  let colorMode: 'auto' | 'always' | 'never' = 'auto';
  for (const a of extra) {
    const [k, v = ''] = a.split('=');
    if (k === '--include') includes.push(v);
    else if (k === '--exclude') excludes.push(v);
    else if (k === '--exclude-dir') excludeDirs.push(v);
    else colorMode = v === 'always' || v === 'yes' || v === '' ? (v === '' ? 'auto' : 'always') : v === 'never' || v === 'no' ? 'never' : 'auto';
  }
  void extra;

  let patterns = o.all('e');
  let operands = o.rest.filter((a) => !/^--(include|exclude|exclude-dir|color|colour)(=|$)/.test(a));
  if (o.all('f').length) {
    for (const f of o.all('f')) {
      try {
        patterns.push(...splitLines(c.fs.readFile(c.abs(f), c.cred)));
      } catch (e) {
        return c.fsfail(e, f);
      }
    }
  }
  if (!patterns.length) {
    if (!operands.length) {
      c.err('Usage: grep [OPTION]... PATTERNS [FILE]...\nTry \'grep --help\' for more information.\n');
      return 2;
    }
    patterns = [operands.shift()!];
  }
  patterns = patterns.flatMap((p) => p.split('\n'));
  const ext = o.has('E') || c.name === 'egrep';
  const fixed = o.has('F') || c.name === 'fgrep';
  let regexes: RegExp[];
  try {
    regexes = patterns.map((p) => {
      if (o.has('P')) {
        return new RegExp(o.has('w') ? `\\b(?:${p})\\b` : o.has('x') ? `^(?:${p})$` : p, (o.has('i') ? 'i' : '') + 'g');
      }
      return makeRegex(p, { extended: ext, fixed, ignoreCase: o.has('i'), wholeWord: o.has('w'), wholeLine: o.has('x'), global: true });
    });
  } catch {
    c.err('grep: Invalid regular expression\n');
    return 2;
  }
  const emptyPattern = patterns.some((p) => p === '');

  const rec = o.has('r') || o.has('R');
  const sources: Src[] = [];
  let status = 0;
  if (rec) {
    const roots = operands.length ? operands : ['.'];
    for (const r of roots) {
      const abs = c.abs(r);
      if (!c.fs.stat(abs, c.cred)) {
        if (!o.has('s')) c.err(`grep: ${r}: No such file or directory\n`);
        status = 2;
        continue;
      }
      collectRecursive(c, r, operands.length ? r : '', includes, excludes, excludeDirs, sources, o.has('R'));
    }
  } else if (operands.length === 0) {
    sources.push({ name: '(standard input)', text: await c.stdin.readAll() });
  } else {
    for (const f of operands) {
      if (f === '-') {
        sources.push({ name: '(standard input)', text: await c.stdin.readAll() });
        continue;
      }
      try {
        const n = c.fs.lookup(c.abs(f), c.cred);
        if (n.kind === 'dir') {
          if (!o.has('s')) c.err(`grep: ${f}: Is a directory\n`);
          continue;
        }
        if (includes.length && !includes.some((g) => globMatch(g, basename(f)))) continue;
        sources.push({ name: f, text: c.fs.readFile(c.abs(f), c.cred) });
      } catch (e) {
        if (!o.has('s')) c.err(`grep: ${f}: ${(e as Error).message}\n`);
        status = 2;
      }
    }
  }

  const useColor = colorMode === 'always' || (colorMode === 'auto' && c.tty);
  const withName = o.has('H') || (!o.has('h') && (sources.length > 1 || rec));
  const after = o.val('A') ? parseInt(o.val('A')!, 10) : o.val('C') ? parseInt(o.val('C')!, 10) : o.numeric ? parseInt(o.numeric, 10) : 0;
  const before = o.val('B') ? parseInt(o.val('B')!, 10) : o.val('C') ? parseInt(o.val('C')!, 10) : o.numeric ? parseInt(o.numeric, 10) : 0;
  const maxCount = o.val('m') ? parseInt(o.val('m')!, 10) : Infinity;
  const invert = o.has('v');
  const hasCtx = after > 0 || before > 0;

  const matchLine = (line: string): [number, number][] | null => {
    if (emptyPattern && !o.has('x') && !o.has('w')) return [[0, 0]];
    const spans: [number, number][] = [];
    for (const re of regexes) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        spans.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) re.lastIndex++;
        if (!re.global) break;
      }
    }
    return spans.length ? spans : null;
  };

  const sep = (s: string) => (useColor ? color(C.cyan, s) : s);
  let any = false;
  let printedGroup = false;

  for (const src of sources) {
    const lines = src.text === '' ? [] : src.text.split('\n');
    if (src.text.endsWith('\n')) lines.pop();
    let count = 0;
    let lastPrinted = -1;
    let pendingAfter = 0;
    const out: string[] = [];
    const prefix = (n: number, sepch: string) => {
      let p = '';
      if (withName) p += (useColor ? color('\x1b[35m', src.name) : src.name) + sep(sepch);
      if (o.has('n')) p += (useColor ? color('\x1b[32m', String(n + 1)) : String(n + 1)) + sep(sepch);
      return p;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const spans = matchLine(line);
      const selected = invert ? spans === null : spans !== null;
      if (selected) {
        count++;
        any = true;
        if (o.has('q')) return 0;
        if (o.has('l') || o.has('L')) break;
        if (!o.has('c')) {
          // contexto previo
          if (hasCtx) {
            const from = Math.max(lastPrinted + 1, i - before);
            if (printedGroup && from > lastPrinted + 1 && lastPrinted >= -1 && (out.length || printedGroup)) {
              if (from > lastPrinted + 1 || lastPrinted === -1) out.push(sep('--'));
            }
            for (let k = from; k < i; k++) out.push(prefix(k, '-') + lines[k]);
          }
          if (o.has('o') && !invert) {
            for (const [s, e] of spans!) if (e > s) out.push(prefix(i, ':') + (useColor ? color(C.match, line.slice(s, e)) : line.slice(s, e)));
          } else {
            let text = line;
            if (useColor && !invert && spans) {
              const merged: [number, number][] = [];
              for (const sp of [...spans].sort((a, b) => a[0] - b[0])) {
                const last = merged[merged.length - 1];
                if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
                else merged.push([...sp]);
              }
              let res = '';
              let pos = 0;
              for (const [s, e] of merged) {
                if (e === s) continue;
                res += line.slice(pos, s) + color(C.match, line.slice(s, e));
                pos = e;
              }
              text = res + line.slice(pos);
            }
            out.push(prefix(i, ':') + text);
          }
          lastPrinted = i;
          printedGroup = true;
          pendingAfter = after;
        }
        if (count >= maxCount) {
          // imprimir contexto posterior pendiente
          for (let k = i + 1; k < lines.length && pendingAfter > 0; k++, pendingAfter--) {
            out.push(prefix(k, '-') + lines[k]);
            lastPrinted = k;
          }
          break;
        }
      } else if (pendingAfter > 0 && !o.has('c')) {
        out.push(prefix(i, '-') + line);
        lastPrinted = i;
        pendingAfter--;
      }
    }
    if (o.has('c')) {
      c.out((withName ? (useColor ? color('\x1b[35m', src.name) : src.name) + sep(':') : '') + count + '\n');
    } else if (o.has('l')) {
      if (count > 0) c.out((useColor ? color('\x1b[35m', src.name) : src.name) + '\n');
    } else if (o.has('L')) {
      if (count === 0) c.out(src.name + '\n');
    } else if (out.length) c.out(out.join('\n') + '\n');
    void lastPrinted;
  }
  if (status === 2) return 2;
  return any ? 0 : 1;
});
