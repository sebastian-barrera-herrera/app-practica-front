/**
 * Conversión de expresiones regulares POSIX (BRE / ERE, con extensiones GNU)
 * a RegExp de JavaScript, y utilidades de glob / llaves.
 */

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  punct: '!-\\/:-@\\[-`{-~',
  xdigit: '0-9A-Fa-f',
  word: '\\w',
  cntrl: '\\x00-\\x1f\\x7f',
  print: '\\x20-\\x7e',
  graph: '\\x21-\\x7e',
};

/** Convierte una expresión entre corchetes `[...]` a clase JS. Devuelve [js, nuevoÍndice]. */
function convertBracket(p: string, start: number): [string, number] | null {
  let i = start + 1;
  let out = '[';
  if (p[i] === '^' || p[i] === '!') {
    out += '^';
    i++;
  }
  let first = true;
  while (i < p.length) {
    const c = p[i];
    if (c === ']' && !first) return [out + ']', i + 1];
    first = false;
    if (c === '[' && p[i + 1] === ':') {
      const end = p.indexOf(':]', i + 2);
      if (end > 0) {
        const name = p.slice(i + 2, end);
        out += POSIX_CLASSES[name] ?? '';
        i = end + 2;
        continue;
      }
    }
    if (c === '\\') out += '\\\\';
    else if (c === ']' || c === '[' || c === '^') out += '\\' + c;
    else out += c;
    i++;
  }
  return null; // sin cerrar: se trata como literal
}

export function posixToJs(pattern: string, extended: boolean): string {
  let out = '';
  let i = 0;
  const n = pattern.length;
  let atStart = true; // inicio de expresión (para '*' literal en BRE)
  while (i < n) {
    const c = pattern[i];
    if (c === '\\') {
      const d = pattern[i + 1];
      if (d === undefined) {
        out += '\\\\';
        i++;
        continue;
      }
      i += 2;
      if (!extended) {
        if (d === '(') {
          out += '(';
          atStart = true;
          continue;
        }
        if (d === ')') {
          out += ')';
          atStart = false;
          continue;
        }
        if (d === '{') {
          const end = pattern.indexOf('\\}', i);
          if (end > 0) {
            out += '{' + pattern.slice(i, end) + '}';
            i = end + 2;
            atStart = false;
            continue;
          }
          out += '\\{';
          continue;
        }
        if (d === '|') {
          out += '|';
          atStart = true;
          continue;
        }
        if (d === '+' || d === '?') {
          out += d;
          atStart = false;
          continue;
        }
      }
      if (d === '<') out += '\\b(?=\\w)';
      else if (d === '>') out += '\\b(?<=\\w)';
      else if ('wWsSbB'.includes(d)) out += '\\' + d;
      else if (/[1-9]/.test(d)) out += '\\' + d;
      else if (d === 'n') out += '\\n';
      else if (d === 't') out += '\\t';
      else if (/[A-Za-z0-9]/.test(d)) out += d;
      else out += '\\' + d;
      atStart = false;
      continue;
    }
    if (c === '[') {
      const r = convertBracket(pattern, i);
      if (r) {
        out += r[0];
        i = r[1];
        atStart = false;
        continue;
      }
      out += '\\[';
      i++;
      atStart = false;
      continue;
    }
    if (extended) {
      if (c === '{') {
        const m = /^\{(\d*)(,?)(\d*)\}/.exec(pattern.slice(i));
        if (m && (m[1] || m[3])) {
          out += m[0];
          i += m[0].length;
          atStart = false;
          continue;
        }
        out += '\\{';
        i++;
        atStart = false;
        continue;
      }
      if (c === '(') {
        out += '(';
        atStart = true;
        i++;
        continue;
      }
      if (c === '|') {
        out += '|';
        atStart = true;
        i++;
        continue;
      }
      if (c === '*' || c === '+' || c === '?') {
        out += atStart ? '\\' + c : c;
        i++;
        atStart = false;
        continue;
      }
      if (c === ')') {
        out += ')';
        i++;
        atStart = false;
        continue;
      }
    } else {
      if ('(){}|+?'.includes(c)) {
        out += '\\' + c;
        i++;
        atStart = false;
        continue;
      }
      if (c === '*') {
        out += atStart ? '\\*' : '*';
        i++;
        atStart = false;
        continue;
      }
    }
    if (c === '^') {
      out += atStart ? '^' : '\\^';
      i++;
      continue; // '^' no cambia atStart
    }
    if (c === '$') {
      const rest = pattern.slice(i + 1);
      const isEnd = rest === '' || (extended ? /^[)|]/.test(rest) : /^\\[)|]/.test(rest));
      out += isEnd ? '$' : '\\$';
      i++;
      atStart = false;
      continue;
    }
    if (c === '.') {
      out += '.';
      i++;
      atStart = false;
      continue;
    }
    out += /[\\^$.*+?()[\]{}|\/]/.test(c) ? '\\' + c : c;
    i++;
    atStart = false;
  }
  return out;
}

export function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|\/]/g, '\\$&');
}

export interface RegexOpts {
  extended?: boolean;
  fixed?: boolean;
  ignoreCase?: boolean;
  wholeWord?: boolean;
  wholeLine?: boolean;
  global?: boolean;
}

export function makeRegex(pattern: string, o: RegexOpts = {}): RegExp {
  let src = o.fixed ? escapeRegex(pattern) : posixToJs(pattern, !!o.extended);
  if (o.wholeWord) src = `(?<![\\w])(?:${src})(?![\\w])`;
  if (o.wholeLine) src = `^(?:${src})$`;
  return new RegExp(src, (o.ignoreCase ? 'i' : '') + (o.global ? 'g' : ''));
}

// ───────────────────────── glob ─────────────────────────

/** Convierte un patrón glob de un componente (sin '/') a RegExp anclada. */
export function globToRegex(pat: string): RegExp {
  let out = '^';
  let i = 0;
  while (i < pat.length) {
    const c = pat[i];
    if (c === '*') {
      out += '.*';
      i++;
    } else if (c === '?') {
      out += '.';
      i++;
    } else if (c === '[') {
      const r = convertBracket(pat, i);
      if (r) {
        out += r[0];
        i = r[1];
      } else {
        out += '\\[';
        i++;
      }
    } else if (c === '\\' && i + 1 < pat.length) {
      out += escapeRegex(pat[i + 1]);
      i += 2;
    } else {
      out += escapeRegex(c);
      i++;
    }
  }
  return new RegExp(out + '$', 's');
}

export function hasGlobChars(s: string): boolean {
  return /[*?[]/.test(s);
}

/** Coincidencia glob con un nombre (usado por find -name, case, [[ ]]). */
export function globMatch(pat: string, s: string, ignoreCase = false): boolean {
  const re = globToRegex(pat);
  return ignoreCase ? new RegExp(re.source, 'is').test(s) : re.test(s);
}

// ───────────────────────── llaves {a,b} {1..5} ─────────────────────────

export function expandBraces(word: string): string[] {
  // Busca la primera '{' no escapada con su '}' correspondiente.
  let depth = 0;
  let start = -1;
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) {
        const pre = word.slice(0, start);
        const body = word.slice(start + 1, i);
        const post = word.slice(i + 1);
        const items = splitTopLevel(body);
        let alts: string[] | null = null;
        if (items.length > 1) alts = items.flatMap((it) => expandBraces(it));
        else {
          const rg = expandRange(body);
          if (rg) alts = rg;
        }
        if (!alts) {
          // No es una expansión válida: literal y seguir con el resto
          return expandBraces(post).map((p) => pre + '{' + body + '}' + p);
        }
        const tails = expandBraces(post);
        const res: string[] = [];
        for (const a of alts) for (const t of tails) res.push(pre + a + t);
        return res;
      }
    }
  }
  return [word];
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      cur += c + (body[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

function expandRange(body: string): string[] | null {
  const m = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
  if (!m) return null;
  const [, a, b, st] = m;
  const out: string[] = [];
  if (/^-?\d+$/.test(a) && /^-?\d+$/.test(b)) {
    const x = parseInt(a, 10);
    const y = parseInt(b, 10);
    let step = Math.abs(st ? parseInt(st, 10) : 1) || 1;
    const pad = (a.replace('-', '').length > 1 && a.startsWith('0')) || (b.replace('-', '').length > 1 && b.startsWith('0'));
    const width = Math.max(a.length, b.length);
    if (x <= y) for (let v = x; v <= y; v += step) out.push(pad ? String(v).padStart(width, '0') : String(v));
    else for (let v = x; v >= y; v -= step) out.push(pad ? String(v).padStart(width, '0') : String(v));
    return out;
  }
  if (/^[a-zA-Z]$/.test(a) && /^[a-zA-Z]$/.test(b)) {
    const x = a.charCodeAt(0);
    const y = b.charCodeAt(0);
    const step = Math.abs(st ? parseInt(st, 10) : 1) || 1;
    if (x <= y) for (let v = x; v <= y; v += step) out.push(String.fromCharCode(v));
    else for (let v = x; v >= y; v -= step) out.push(String.fromCharCode(v));
    return out;
  }
  return null;
}
