/** sed: editor de flujo (s, d, p, a, i, c, y, q, =, n, hold space, bloques, rangos). */
import { defineCommand, parseOpts } from '../registry';
import { makeRegex } from '../regex';
import { readInputs, splitLines } from './util';

type Addr =
  | { t: 'line'; n: number }
  | { t: 'last' }
  | { t: 're'; re: RegExp }
  | { t: 'step'; first: number; step: number }
  | { t: 'rel'; n: number };

interface Cmd {
  a1: Addr | null;
  a2: Addr | null;
  neg: boolean;
  op: string;
  // s
  re?: RegExp;
  repl?: string;
  gflag?: boolean;
  pflag?: boolean;
  nth?: number;
  wfile?: string;
  text?: string;
  ymap?: Map<string, string>;
  block?: Cmd[];
  arg?: string;
  // estado de rango
  active?: boolean;
  endLine?: number;
}

class SedError extends Error {}

function parseScript(script: string, ere: boolean): Cmd[] {
  let i = 0;
  const s = script;
  const skipWs = () => {
    while (i < s.length && /[ \t]/.test(s[i])) i++;
  };
  const readDelimited = (delim: string): string => {
    let out = '';
    while (i < s.length && s[i] !== delim) {
      if (s[i] === '\\' && i + 1 < s.length) {
        if (s[i + 1] === delim) {
          out += delim === '/' ? '\\/' : delim;
          i += 2;
          continue;
        }
        out += s[i] + s[i + 1];
        i += 2;
        continue;
      }
      out += s[i++];
    }
    if (i >= s.length) throw new SedError('unterminated `s\' command');
    i++;
    return out;
  };
  const parseAddr = (): Addr | null => {
    skipWs();
    if (i >= s.length) return null;
    if (/\d/.test(s[i])) {
      let n = '';
      while (/\d/.test(s[i] ?? '')) n += s[i++];
      if (s[i] === '~') {
        i++;
        let st = '';
        while (/\d/.test(s[i] ?? '')) st += s[i++];
        return { t: 'step', first: parseInt(n, 10), step: parseInt(st || '0', 10) };
      }
      return { t: 'line', n: parseInt(n, 10) };
    }
    if (s[i] === '$') {
      i++;
      return { t: 'last' };
    }
    if (s[i] === '/' || s[i] === '\\') {
      let delim = '/';
      if (s[i] === '\\') {
        i++;
        delim = s[i];
      }
      i++;
      const pat = readDelimited(delim);
      let flags = '';
      while (s[i] === 'I' || s[i] === 'M') flags += s[i++];
      return { t: 're', re: makeRegex(pat.replace(/\\\//g, '/'), { extended: ere, ignoreCase: flags.includes('I') }) };
    }
    return null;
  };

  const parseList = (inBlock: boolean): Cmd[] => {
    const cmds: Cmd[] = [];
    for (;;) {
      while (i < s.length && /[\s;]/.test(s[i])) i++;
      if (i >= s.length) {
        if (inBlock) throw new SedError('unmatched `{\'');
        break;
      }
      if (s[i] === '}') {
        if (!inBlock) throw new SedError('unexpected `}\'');
        i++;
        break;
      }
      if (s[i] === '#') {
        while (i < s.length && s[i] !== '\n') i++;
        continue;
      }
      const a1 = parseAddr();
      let a2: Addr | null = null;
      if (a1) {
        skipWs();
        if (s[i] === ',') {
          i++;
          skipWs();
          if (s[i] === '+') {
            i++;
            let n = '';
            while (/\d/.test(s[i] ?? '')) n += s[i++];
            a2 = { t: 'rel', n: parseInt(n, 10) };
          } else a2 = parseAddr();
        }
      }
      skipWs();
      let neg = false;
      while (s[i] === '!') {
        neg = !neg;
        i++;
        skipWs();
      }
      const op = s[i++];
      if (op === undefined) throw new SedError('missing command');
      const cmd: Cmd = { a1, a2, neg, op };
      switch (op) {
        case '{':
          cmd.block = parseList(true);
          break;
        case 's': {
          const delim = s[i++];
          const pat = readDelimited(delim);
          // reemplazo: puede contener \delim
          let repl = '';
          while (i < s.length && s[i] !== delim) {
            if (s[i] === '\\' && i + 1 < s.length) {
              if (s[i + 1] === delim && delim !== '&') { repl += delim; i += 2; continue; }
              repl += s[i] + s[i + 1];
              i += 2;
              continue;
            }
            repl += s[i++];
          }
          if (i >= s.length) throw new SedError('unterminated `s\' command');
          i++;
          let flags = '';
          while (i < s.length && /[gpiImMe0-9w]/.test(s[i])) {
            if (s[i] === 'w') {
              i++;
              skipWs();
              let f = '';
              while (i < s.length && s[i] !== '\n' && s[i] !== ';') f += s[i++];
              cmd.wfile = f.trim();
              break;
            }
            flags += s[i++];
          }
          cmd.gflag = flags.includes('g');
          cmd.pflag = flags.includes('p');
          const nm = /\d+/.exec(flags);
          if (nm) cmd.nth = parseInt(nm[0], 10);
          const src = pat === '' ? '(?:)' : null;
          cmd.re = makeRegex(src ? '' : pat, { extended: ere, ignoreCase: /[iI]/.test(flags), global: true });
          cmd.repl = repl;
          break;
        }
        case 'y': {
          const delim = s[i++];
          const a = readDelimited(delim);
          const b = readDelimited(delim);
          const un = (x: string) => x.replace(/\\(.)/g, (_m, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
          const A = [...un(a)];
          const B = [...un(b)];
          if (A.length !== B.length) throw new SedError('strings for `y\' command are different lengths');
          cmd.ymap = new Map(A.map((ch, k) => [ch, B[k]]));
          break;
        }
        case 'a': case 'i': case 'c': {
          skipWs();
          if (s[i] === '\\') {
            i++;
            skipWs();
            if (s[i] === '\n') i++;
          }
          let t = '';
          while (i < s.length && s[i] !== '\n') {
            if (s[i] === '\\' && s[i + 1] === '\n') { t += '\n'; i += 2; continue; }
            if (s[i] === '\\' && i + 1 < s.length) { t += s[i + 1]; i += 2; continue; }
            t += s[i++];
          }
          cmd.text = t;
          break;
        }
        case 'r': case 'w': {
          skipWs();
          let f = '';
          while (i < s.length && s[i] !== '\n') f += s[i++];
          cmd.arg = f.trim();
          break;
        }
        case 'q': case 'Q': {
          skipWs();
          let n = '';
          while (/\d/.test(s[i] ?? '')) n += s[i++];
          cmd.arg = n;
          break;
        }
        case 'b': case 't': case 'T': case ':': {
          skipWs();
          let l = '';
          while (i < s.length && s[i] !== '\n' && s[i] !== ';') l += s[i++];
          cmd.arg = l.trim();
          break;
        }
        case 'd': case 'D': case 'p': case 'P': case 'n': case 'N': case 'h': case 'H': case 'g': case 'G': case 'x': case '=': case 'l': case 'z':
          break;
        default:
          throw new SedError(`unknown command: \`${op}'`);
      }
      cmds.push(cmd);
    }
    return cmds;
  };
  return parseList(false);
}

function expandRepl(repl: string, m: RegExpExecArray): string {
  let out = '';
  let caseMode: '' | 'U' | 'L' = '';
  let once: '' | 'u' | 'l' = '';
  const push = (txt: string) => {
    let t = txt;
    if (caseMode === 'U') t = t.toUpperCase();
    else if (caseMode === 'L') t = t.toLowerCase();
    if (once && t) {
      t = (once === 'u' ? t[0].toUpperCase() : t[0].toLowerCase()) + t.slice(1);
      once = '';
    }
    out += t;
  };
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i];
    if (ch === '&') push(m[0]);
    else if (ch === '\\' && i + 1 < repl.length) {
      const n = repl[++i];
      if (/[0-9]/.test(n)) push(m[parseInt(n, 10)] ?? '');
      else if (n === 'n') push('\n');
      else if (n === 't') push('\t');
      else if (n === 'U') caseMode = 'U';
      else if (n === 'L') caseMode = 'L';
      else if (n === 'E') caseMode = '';
      else if (n === 'u') once = 'u';
      else if (n === 'l') once = 'l';
      else push(n);
    } else push(ch);
  }
  return out;
}

function runSed(cmds: Cmd[], lines: string[], opts: { quiet: boolean; separate?: boolean; files?: Map<string, string> }): { out: string; writes: Map<string, string> } {
  const writes = new Map<string, string>();
  let out = '';
  let hold = '';
  let quit = false;
  const labels = new Map<string, number>();
  const flat: Cmd[] = [];
  const flatten = (list: Cmd[]) => {
    for (const c of list) {
      flat.push(c);
      if (c.op === ':') labels.set(c.arg!, flat.length - 1);
    }
  };
  flatten(cmds);
  let i = 0;
  const total = lines.length;
  let appendQueue: string[] = [];
  let lineIdx = 0;
  let pattern = '';
  let substituted = false;

  const matchAddr = (a: Addr, ln: number): boolean => {
    switch (a.t) {
      case 'line': return ln === a.n;
      case 'last': return ln === total;
      case 're': return a.re.test(pattern);
      case 'step': return a.step === 0 ? ln === a.first : ln >= a.first && (ln - a.first) % a.step === 0;
      case 'rel': return false;
    }
  };
  const selected = (c: Cmd, ln: number): boolean => {
    let sel: boolean;
    if (!c.a1) sel = true;
    else if (!c.a2) sel = matchAddr(c.a1, ln);
    else {
      if (c.active) {
        if (c.a2.t === 'line') {
          if (ln >= c.a2.n) c.active = false;
          sel = true;
          if (ln > c.a2.n) { c.active = false; sel = matchAddr(c.a1, ln) ? (c.active = true, true) : false; }
        } else if (c.a2.t === 'rel') {
          sel = true;
          if (ln >= c.endLine!) c.active = false;
        } else {
          sel = true;
          if (matchAddr(c.a2, ln)) c.active = false;
        }
      } else if (matchAddr(c.a1, ln)) {
        sel = true;
        if (c.a2.t === 'line') c.active = c.a2.n > ln;
        else if (c.a2.t === 'rel') {
          c.endLine = ln + c.a2.n;
          c.active = c.a2.n > 0;
        } else c.active = true;
      } else sel = false;
    }
    return c.neg ? !sel : sel;
  };

  const flush = () => {
    out += appendQueue.join('');
    appendQueue = [];
  };

  while (lineIdx < total && !quit) {
    pattern = lines[lineIdx++];
    substituted = false;
    let deleted = false;
    let restart = false;
    i = 0;
    let guard = 0;
    const execList = (list: Cmd[]): 'next' | 'del' | 'quit' | void => {
      for (let k = 0; k < list.length; k++) {
        const c = list[k];
        if (++guard > 100000) return 'quit';
        if (c.op === ':' ) continue;
        if (!selected(c, lineIdx)) {
          continue;
        }
        switch (c.op) {
          case '{': {
            const r = execList(c.block!);
            if (r) return r;
            break;
          }
          case 's': {
            let count = 0;
            let did = false;
            c.re!.lastIndex = 0;
            const res = pattern.replace(c.re!, (...args) => {
              const m = args as unknown as RegExpExecArray;
              const groups = args.slice(0, args.length - (typeof args[args.length - 1] === 'object' ? 3 : 2));
              count++;
              if (c.nth && count < c.nth) return groups[0];
              if (!c.gflag && did) return groups[0];
              if (c.nth && !c.gflag && count > c.nth) return groups[0];
              did = true;
              const mm = Object.assign([...groups], { index: 0 }) as unknown as RegExpExecArray;
              void m;
              return expandRepl(c.repl!, mm);
            });
            if (did) {
              pattern = res;
              substituted = true;
              if (c.pflag) out += pattern + '\n';
              if (c.wfile) writes.set(c.wfile, (writes.get(c.wfile) ?? '') + pattern + '\n');
            }
            break;
          }
          case 'y':
            pattern = [...pattern].map((ch) => c.ymap!.get(ch) ?? ch).join('');
            break;
          case 'd':
            return 'del';
          case 'D': {
            const nl = pattern.indexOf('\n');
            if (nl < 0) return 'del';
            pattern = pattern.slice(nl + 1);
            restart = true;
            return 'del';
          }
          case 'p': out += pattern + '\n'; break;
          case 'P': out += pattern.split('\n')[0] + '\n'; break;
          case '=': out += lineIdx + '\n'; break;
          case 'a': appendQueue.push(c.text + '\n'); break;
          case 'i': out += c.text + '\n'; break;
          case 'c':
            if (!c.a2 || !c.active) out += c.text + '\n';
            return 'del';
          case 'r': {
            const f = opts.files?.get(c.arg!);
            if (f !== undefined) appendQueue.push(f);
            break;
          }
          case 'w': writes.set(c.arg!, (writes.get(c.arg!) ?? '') + pattern + '\n'); break;
          case 'n':
            if (lineIdx >= total) {
              if (!opts.quiet) out += pattern + '\n';
              flush();
              return 'quit';
            }
            if (!opts.quiet) out += pattern + '\n';
            flush();
            pattern = lines[lineIdx++];
            break;
          case 'N':
            if (lineIdx >= total) {
              if (!opts.quiet) out += pattern + '\n';
              return 'quit';
            }
            pattern += '\n' + lines[lineIdx++];
            break;
          case 'h': hold = pattern; break;
          case 'H': hold += '\n' + pattern; break;
          case 'g': pattern = hold; break;
          case 'G': pattern += '\n' + hold; break;
          case 'x': { const t = pattern; pattern = hold; hold = t; break; }
          case 'l': out += pattern.replace(/\\/g, '\\\\').replace(/\t/g, '\\t') + '$\n'; break;
          case 'z': pattern = ''; break;
          case 'q':
            if (!opts.quiet) out += pattern + '\n';
            flush();
            quit = true;
            return 'quit';
          case 'Q':
            quit = true;
            return 'quit';
          case 'b': case 't': case 'T': {
            const take = c.op === 'b' || (c.op === 't' && substituted) || (c.op === 'T' && !substituted);
            if (c.op === 't') substituted = false;
            if (take) {
              if (!c.arg) return 'next';
              const target = labels.get(c.arg);
              if (target === undefined) return 'next';
              k = flat.indexOf(flat[target]) - 1;
              // saltar dentro de la lista plana solo es válido en el nivel superior
              if (list !== flat) return 'next';
            }
            break;
          }
        }
      }
    };
    do {
      restart = false;
      const r = execList(flat.filter((c) => cmds.includes(c) || true).length && cmds === flat ? flat : cmds);
      if (r === 'del') deleted = true;
      if (r === 'quit' && !quit) quit = true;
      if (deleted && restart) {
        deleted = false;
        flush();
        continue;
      }
    } while (restart);
    if (!deleted && !(quit && false) && !opts.quiet) out += pattern + '\n';
    flush();
  }
  return { out, writes };
}

defineCommand('sed', {
  summary: 'Editor de flujo: busca y reemplaza, borra o imprime líneas',
  usage: "sed [OPCIÓN]... 'SCRIPT' [ARCHIVO]...",
  category: 'texto',
  level: 2,
  options: [['s/viejo/nuevo/', 'Sustituye la primera coincidencia de cada línea'], ['s/viejo/nuevo/g', 'Sustituye todas las coincidencias'], ['-n', 'No imprime automáticamente (usa p)'], ['-i', 'Edita el archivo en el sitio'], ['-E', 'Regex extendida'], ['Nd / N,Md', 'Borra línea N / de N a M'], ['/re/d', 'Borra líneas que coinciden']],
  examples: [["sed 's/gato/perro/g' texto.txt", 'Reemplaza en toda la salida'], ["sed -i 's/foo/bar/' config.ini", 'Cambia el archivo directamente'], ["sed -n '5,10p' archivo", 'Imprime las líneas 5 a 10'], ["sed '/^#/d' conf", 'Quita los comentarios']],
}, async (c) => {
  // -i admite un sufijo pegado (-i.bak) pero nunca separado: se extrae antes de parsear
  let inPlace = false;
  let suffix = '';
  const pre: string[] = [];
  for (const a of c.args) {
    const m = /^-i(.*)$/.exec(a);
    const m2 = /^--in-place(?:=(.*))?$/.exec(a);
    if (m && !a.startsWith('--')) {
      inPlace = true;
      suffix = m[1];
    } else if (m2) {
      inPlace = true;
      suffix = m2[1] ?? '';
    } else pre.push(a);
  }
  const o = parseOpts(c, pre, { flags: 'nErsuz', values: 'ef', long: { '--quiet': 'n', '--silent': 'n', '--expression': 'e', '--file': 'f', '--regexp-extended': 'E', '--separate': 's' } });
  const scripts = [...o.all('e')];
  for (const f of o.all('f')) {
    try {
      scripts.push(c.fs.readFile(c.abs(f), c.cred));
    } catch (e) {
      return c.fsfail(e, f);
    }
  }
  let files = o.rest;
  if (!scripts.length) {
    if (!files.length) {
      c.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n');
      return 1;
    }
    scripts.push(files[0]);
    files = files.slice(1);
  }
  let cmds: Cmd[];
  try {
    cmds = parseScript(scripts.join('\n'), o.has('E') || o.has('r'));
  } catch (e) {
    c.err(`sed: -e expression #1, char ${scripts.join('\n').length}: ${(e as Error).message}\n`);
    return 1;
  }
  const rfiles = new Map<string, string>();
  const collectR = (list: Cmd[]) => {
    for (const cm of list) {
      if (cm.op === 'r' && cm.arg) {
        try {
          rfiles.set(cm.arg, c.fs.readFile(c.abs(cm.arg), c.cred));
        } catch {
          /* ignorar */
        }
      }
      if (cm.block) collectR(cm.block);
    }
  };
  collectR(cmds);
  const applyWrites = (w: Map<string, string>) => {
    for (const [f, t] of w) {
      try {
        c.fs.writeFile(c.abs(f), t, { cred: c.cred });
      } catch (e) {
        c.err(`sed: couldn't open file ${f}: ${(e as Error).message}\n`);
      }
    }
  };
  if (inPlace) {
    if (!files.length) return c.fail('no input files');
    let st = 0;
    for (const f of files) {
      let text: string;
      try {
        text = c.fs.readFile(c.abs(f), c.cred);
      } catch (e) {
        c.err(`sed: can't read ${f}: ${(e as Error).message}\n`);
        st = 4;
        continue;
      }
      // reiniciar estado de rangos
      for (const cm of cmds) { cm.active = false; }
      const r = runSed(cmds, splitLines(text), { quiet: o.has('n'), files: rfiles });
      try {
        if (suffix) c.fs.writeFile(c.abs(f + suffix), text, { cred: c.cred });
        c.fs.writeFile(c.abs(f), r.out, { cred: c.cred });
      } catch (e) {
        c.err(`sed: couldn't open temporary file ${f}: ${(e as Error).message}\n`);
        st = 4;
      }
      applyWrites(r.writes);
    }
    return st;
  }
  const { inputs, failed } = await readInputs(c, files, { quiet: true });
  if (failed) {
    for (const f of files) if (!c.fs.stat(c.abs(f), c.cred)) c.err(`sed: can't read ${f}: No such file or directory\n`);
  }
  const lines = o.has('s') ? null : inputs.flatMap((i) => splitLines(i.text));
  if (lines) {
    const r = runSed(cmds, lines, { quiet: o.has('n'), files: rfiles });
    c.out(r.out);
    applyWrites(r.writes);
  } else {
    for (const inp of inputs) {
      for (const cm of cmds) cm.active = false;
      const r = runSed(cmds, splitLines(inp.text), { quiet: o.has('n'), files: rfiles });
      c.out(r.out);
    }
  }
  return failed ? 2 : 0;
});
