/** Utilidades comunes para implementar comandos. */
import type { Ctx } from '../registry';
import { FsError } from '../vfs';

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function joinLines(lines: string[]): string {
  return lines.length ? lines.join('\n') + '\n' : '';
}

export interface Input {
  name: string;
  text: string;
}

/**
 * Lee las entradas de un comando de texto: archivos (con errores en stderr) o
 * stdin si no hay archivos o el archivo es "-".
 */
export async function readInputs(
  c: Ctx,
  files: string[],
  opts: { quiet?: boolean } = {},
): Promise<{ inputs: Input[]; failed: boolean }> {
  const inputs: Input[] = [];
  let failed = false;
  if (files.length === 0) {
    return { inputs: [{ name: '-', text: await c.stdin.readAll() }], failed };
  }
  for (const f of files) {
    if (f === '-') {
      inputs.push({ name: '-', text: await c.stdin.readAll() });
      continue;
    }
    try {
      const abs = c.abs(f);
      const n = c.fs.lookup(abs, c.cred);
      if (n.kind === 'dir') throw new FsError('EISDIR', abs);
      inputs.push({ name: f, text: c.fs.readFile(abs, c.cred) });
    } catch (e) {
      failed = true;
      if (!opts.quiet) c.err(`${c.name}: ${f}: ${(e as Error).message}\n`);
    }
  }
  return { inputs, failed };
}

/** Escapa secuencias \n \t etc. (echo -e, printf). Devuelve [texto, cortado por \c]. */
export function unescapeC(s: string): [string, boolean] {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\' || i === s.length - 1) {
      out += ch;
      continue;
    }
    const n = s[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case 'e': case 'E': out += '\x1b'; break;
      case '\\': out += '\\'; break;
      case '"': out += '"'; break;
      case "'": out += "'"; break;
      case 'c': return [out, true];
      case '0': {
        let o = '';
        while (o.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) o += s[++i];
        out += String.fromCharCode(o ? parseInt(o, 8) : 0);
        break;
      }
      case 'x': {
        let h = '';
        while (h.length < 2 && /[0-9a-fA-F]/.test(s[i + 1] ?? '')) h += s[++i];
        out += h ? String.fromCharCode(parseInt(h, 16)) : '\\x';
        break;
      }
      case 'u': {
        let h = '';
        while (h.length < 4 && /[0-9a-fA-F]/.test(s[i + 1] ?? '')) h += s[++i];
        out += h ? String.fromCharCode(parseInt(h, 16)) : '\\u';
        break;
      }
      default:
        if (/[1-7]/.test(n)) {
          let o = n;
          while (o.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) o += s[++i];
          out += String.fromCharCode(parseInt(o, 8));
        } else out += '\\' + n;
    }
  }
  return [out, false];
}

/** printf al estilo C/bash. */
export function formatPrintf(fmt: string, args: string[]): { out: string; error?: string } {
  let out = '';
  let argi = 0;
  let error: string | undefined;
  const hasSpecs = /%[^%]/.test(fmt.replace(/%%/g, ''));
  const next = () => (argi < args.length ? args[argi++] : undefined);
  const run = () => {
    let i = 0;
    let consumed = false;
    while (i < fmt.length) {
      const ch = fmt[i];
      if (ch === '\\') {
        const m = /^\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/.exec(fmt.slice(i));
        if (m) {
          const [t, stop] = unescapeC(m[0]);
          out += t;
          i += m[0].length;
          if (stop) return { stop: true, consumed };
          continue;
        }
      }
      if (ch !== '%') {
        out += ch;
        i++;
        continue;
      }
      const m = /^%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfgGcsb%])/.exec(fmt.slice(i));
      if (!m) {
        out += ch;
        i++;
        continue;
      }
      i += m[0].length;
      const [, flags, wS, pS, conv] = m;
      if (conv === '%') {
        out += '%';
        continue;
      }
      let width = wS === '*' ? parseInt(next() ?? '0', 10) : wS ? parseInt(wS, 10) : 0;
      const prec = pS === '*' ? parseInt(next() ?? '0', 10) : pS !== undefined ? parseInt(pS, 10) : undefined;
      const arg = next();
      consumed = consumed || arg !== undefined;
      let body = '';
      const num = (a: string | undefined) => {
        if (a === undefined || a === '') return 0;
        if (/^['"]./.test(a)) return a.charCodeAt(1);
        const n = /^0[xX]/.test(a) ? parseInt(a, 16) : /^0[0-7]+$/.test(a) ? parseInt(a, 8) : Number(a);
        if (Number.isNaN(n)) {
          error = `printf: ${a}: invalid number`;
          return 0;
        }
        return n;
      };
      switch (conv) {
        case 's': body = arg ?? ''; if (prec !== undefined) body = body.slice(0, prec); break;
        case 'b': body = unescapeC(arg ?? '')[0]; break;
        case 'c': body = (arg ?? '').charAt(0); break;
        case 'd': case 'i': {
          const n = Math.trunc(num(arg));
          body = String(Math.abs(n));
          if (prec !== undefined) body = body.padStart(prec, '0');
          const sign = n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
          body = sign + body;
          break;
        }
        case 'u': body = String(Math.abs(Math.trunc(num(arg)))); break;
        case 'o': body = (Math.trunc(num(arg)) >>> 0).toString(8); if (flags.includes('#')) body = '0' + body; break;
        case 'x': body = (Math.trunc(num(arg)) >>> 0).toString(16); if (flags.includes('#')) body = '0x' + body; break;
        case 'X': body = (Math.trunc(num(arg)) >>> 0).toString(16).toUpperCase(); if (flags.includes('#')) body = '0X' + body; break;
        case 'f': {
          const n = num(arg);
          body = n.toFixed(prec ?? 6);
          if (n >= 0 && flags.includes('+')) body = '+' + body;
          break;
        }
        case 'e': case 'E': {
          body = num(arg).toExponential(prec ?? 6).replace(/e([+-])(\d)$/, 'e$10$2');
          if (conv === 'E') body = body.toUpperCase();
          break;
        }
        case 'g': case 'G': body = String(Number(num(arg).toPrecision(prec ?? 6))); break;
      }
      if (width < 0) {
        width = -width;
      }
      if (body.length < width) {
        if (flags.includes('-')) body = body.padEnd(width);
        else if (flags.includes('0') && 'diouxXeEfgG'.includes(conv)) {
          const neg = /^[-+ ]/.test(body) ? body[0] : '';
          body = neg + body.slice(neg.length).padStart(width - neg.length, '0');
        } else body = body.padStart(width);
      }
      out += body;
    }
    return { stop: false, consumed };
  };
  // el formato se reutiliza mientras queden argumentos
  let r = run();
  while (!r.stop && hasSpecs && argi < args.length && r.consumed) r = run();
  return { out, error };
}

/** Une errores del VFS con el nombre del comando. */
export function fsErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Convierte bytes → texto "N bytes" legible por tipo. */
export function sizeSuffix(arg: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([kKmMgGtTcwb]?)$/.exec(arg);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'c': case '': return n;
    case 'w': return n * 2;
    case 'b': return n * 512;
    case 'k': case 'K': return n * 1024;
    case 'm': case 'M': return n * 1024 * 1024;
    case 'g': case 'G': return n * 1024 * 1024 * 1024;
    case 't': case 'T': return n * 1024 ** 4;
  }
  return null;
}

/** Parsea modo octal o simbólico (chmod / mkdir -m). Devuelve nuevo modo. */
export function applyMode(spec: string, current: number, isDir: boolean, umask = 0o022): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let mode = current;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)(([-+=])([rwxXst]*|[ugo]))+$/.exec(clause);
    if (!m) return null;
    const who = m[1] || 'a';
    const re = /([-+=])([rwxXst]*|[ugo])/g;
    const first = /^[ugoa]*/.exec(clause)![0];
    const rest = clause.slice(first.length);
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(rest))) {
      const op = mm[1];
      const perms = mm[2];
      let bits = 0;
      const shifts: number[] = [];
      const wh = who === 'a' || who === '' ? 'ugo' : who;
      if (wh.includes('u')) shifts.push(6);
      if (wh.includes('g')) shifts.push(3);
      if (wh.includes('o')) shifts.push(0);
      let special = 0;
      for (const sh of shifts) {
        let b = 0;
        if (/^[ugo]$/.test(perms)) {
          const srcShift = perms === 'u' ? 6 : perms === 'g' ? 3 : 0;
          b = (mode >> srcShift) & 7;
        } else {
          if (perms.includes('r')) b |= 4;
          if (perms.includes('w')) b |= 2;
          if (perms.includes('x')) b |= 1;
          if (perms.includes('X') && (isDir || (mode & 0o111) !== 0)) b |= 1;
        }
        bits |= b << sh;
      }
      if (perms.includes('s')) {
        if (wh.includes('u')) special |= 0o4000;
        if (wh.includes('g')) special |= 0o2000;
      }
      if (perms.includes('t')) special |= 0o1000;
      const all = bits | special;
      let mask = 0;
      for (const sh of shifts) mask |= 7 << sh;
      if (perms.includes('s')) {
        if (wh.includes('u')) mask |= 0o4000;
        if (wh.includes('g')) mask |= 0o2000;
      }
      if (perms.includes('t')) mask |= 0o1000;
      if (op === '+') mode |= all;
      else if (op === '-') mode &= ~all;
      else mode = (mode & ~mask) | all;
    }
  }
  void umask;
  return mode;
}

export function pad(n: number | string, w: number): string {
  return String(n).padStart(w, ' ');
}

/** Elimina comillas ASCII / ayuda para mensajes. */
export const q = (s: string) => `'${s}'`;
