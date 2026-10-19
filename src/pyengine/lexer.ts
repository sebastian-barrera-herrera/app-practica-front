/**
 * Analizador léxico de Python 3.13 (indentación, continuación de línea, cadenas, números, operadores).
 * Los errores léxicos no se lanzan: se devuelven junto a los tokens leídos hasta ese punto,
 * para que el parser pueda decidir qué error informar (como hace CPython, que tokeniza bajo demanda).
 */

export type TokType = 'NAME' | 'NUMBER' | 'STRING' | 'OP' | 'NEWLINE' | 'INDENT' | 'DEDENT' | 'EOF' | 'ERROR';

export interface Token {
  type: TokType;
  value: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** desplazamientos absolutos en el texto fuente */
  start: number;
  end: number;
}

export type ErrKind = 'SyntaxError' | 'IndentationError' | 'TabError';

/** Error de sintaxis interno (posición 0-based en columnas). */
export class PySyntaxErr {
  constructor(
    public kind: ErrKind,
    public msg: string,
    public line: number,
    public col: number,
    public endLine: number,
    public endCol: number,
    /** el error ocurrió al final del texto sin cerrar (útil para el REPL) */
    public eof = false,
  ) {}
}

export interface OpenParen {
  ch: string;
  line: number;
  col: number;
}

export interface LexResult {
  tokens: Token[];
  error?: PySyntaxErr;
  /** paréntesis aún abiertos al llegar al final del texto (de dentro hacia fuera) */
  open: OpenParen[];
  /** el texto terminó dentro de una cadena triple sin cerrar */
  eofInTriple?: boolean;
}

export const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

let idStartRe: RegExp | null = null;
let idContRe: RegExp | null = null;
try {
  idStartRe = new RegExp('[\\p{L}\\p{Nl}_\\u2118\\u212E\\u309B\\u309C]', 'u');
  idContRe = new RegExp('[\\p{L}\\p{Nl}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}_\\u00B7\\u0387\\u1369-\\u1371\\u19DA\\u2118\\u212E\\u309B\\u309C]', 'u');
} catch {
  idStartRe = null;
  idContRe = null;
}

export function isIdStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
  if (idStartRe) return idStartRe.test(ch);
  return c >= 0xc0 && c !== 0xd7 && c !== 0xf7;
}
export function isIdCont(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || (c >= 48 && c <= 57);
  if (idContRe) return idContRe.test(ch);
  return c >= 0xc0 && c !== 0xd7 && c !== 0xf7;
}

/** Tabla línea/columna a partir de desplazamientos. */
export class LineTable {
  starts: number[] = [0];
  constructor(public src: string) {
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  /** línea (1-based) del desplazamiento */
  lineOf(off: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  colOf(off: number): number {
    return off - this.starts[this.lineOf(off) - 1];
  }
  lineText(line: number): string {
    const s = this.starts[line - 1];
    if (s === undefined) return '';
    let e = this.src.indexOf('\n', s);
    if (e < 0) e = this.src.length;
    return this.src.slice(s, e);
  }
  get lineCount(): number {
    return this.starts.length;
  }
}

export function normalizeNewlines(s: string): string {
  if (s.indexOf('\r') < 0) return s;
  return s.replace(/\r\n?/g, '\n');
}

const OPS3 = new Set(['**=', '//=', '>>=', '<<=', '...']);
const OPS2 = new Set(['<>', '**', '//', '<<', '>>', '<=', '>=', '==', '!=', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', ':=']);
const OPS1 = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '@', '=', '!', '$', '?', '`']);

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}
function isHex(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

export interface LexOptions {
  /** analizar solo el rango [start, end) del texto (expresiones dentro de f-strings) */
  start?: number;
  end?: number;
  /** dentro de paréntesis desde el principio (no genera NEWLINE/INDENT) */
  nested?: boolean;
}

export function tokenize(src: string, table: LineTable, o: LexOptions = {}): LexResult {
  const tokens: Token[] = [];
  const n = o.end ?? src.length;
  let i = o.start ?? 0;
  const nested = !!o.nested;
  let line = table.lineOf(i);
  let lineStart = table.starts[line - 1];
  const indents: number[] = [0];
  const altIndents: number[] = [0];
  const parens: OpenParen[] = [];
  let atLineStart = !nested;
  let error: PySyntaxErr | undefined;
  let eofInTriple = false;

  const push = (type: TokType, start: number, end: number, value?: string, sLine?: number, sCol?: number) => {
    const eLine = table.lineOf(end > start ? end - 1 : end);
    // fin: columna siguiente al último carácter
    const eCol = type === 'NEWLINE'
      ? table.colOf(start) + 1
      : type === 'EOF' || type === 'INDENT' || type === 'DEDENT'
        ? table.colOf(end)
        : table.colOf(end - 1) + 1;
    const l0 = sLine ?? table.lineOf(start);
    tokens.push({
      type,
      value: value ?? src.slice(start, end),
      line: l0,
      col: sCol ?? table.colOf(start),
      endLine: type === 'NEWLINE' || type === 'EOF' || type === 'INDENT' || type === 'DEDENT' ? l0 : eLine,
      endCol: eCol,
      start,
      end,
    });
  };
  const fail = (kind: ErrKind, msg: string, sLine: number, sCol: number, eLine = sLine, eCol = sCol, eof = false) => {
    error = new PySyntaxErr(kind, msg, sLine, sCol, eLine, eCol, eof);
  };

  outer: while (i < n) {
    // ── inicio de línea lógica: indentación ──
    if (atLineStart && parens.length === 0) {
      let col = 0;
      let alt = 0;
      let j = i;
      for (;;) {
        const c = src.charCodeAt(j);
        if (c === 32) { col++; alt++; j++; }
        else if (c === 9) { col = (Math.floor(col / 8) + 1) * 8; alt++; j++; }
        else if (c === 12) { col = 0; alt = 0; j++; }
        else break;
      }
      const c = j < n ? src.charCodeAt(j) : -1;
      if (c === -1) { i = j; break; }
      if (c === 10) { // línea en blanco
        i = j + 1; line++; lineStart = i; continue;
      }
      if (c === 35) { // comentario solo
        while (j < n && src.charCodeAt(j) !== 10) j++;
        i = j + 1; line++; lineStart = i; continue;
      }
      if (c === 92 && src.charCodeAt(j + 1) === 10 && false) { /* continuación en línea en blanco: se trata como código */ }
      // comparar con la pila de indentación
      const top = indents[indents.length - 1];
      if (col === top) {
        if (alt !== altIndents[altIndents.length - 1]) {
          fail('TabError', 'inconsistent use of tabs and spaces in indentation', line, 0, line, -1);
          break;
        }
      } else if (col > top) {
        if (alt <= altIndents[altIndents.length - 1]) {
          fail('TabError', 'inconsistent use of tabs and spaces in indentation', line, 0, line, -1);
          break;
        }
        indents.push(col);
        altIndents.push(alt);
        tokens.push({ type: 'INDENT', value: '', line, col: 0, endLine: line, endCol: j - lineStart, start: i, end: j });
      } else {
        while (indents.length > 1 && col < indents[indents.length - 1]) {
          indents.pop();
          altIndents.pop();
          tokens.push({ type: 'DEDENT', value: '', line, col: j - lineStart, endLine: line, endCol: j - lineStart, start: j, end: j });
        }
        if (col !== indents[indents.length - 1]) {
          let e = src.indexOf('\n', j);
          if (e < 0 || e > n) e = n;
          fail('IndentationError', 'unindent does not match any outer indentation level', line, e - lineStart, line, -2);
          break;
        }
        if (alt !== altIndents[altIndents.length - 1]) {
          fail('TabError', 'inconsistent use of tabs and spaces in indentation', line, 0, line, -1);
          break;
        }
      }
      i = j;
      atLineStart = false;
    }

    // ── espacios y comentarios ──
    const ch = src.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 12) { i++; continue; }
    if (ch === 35) { // comentario
      while (i < n && src.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (ch === 10) {
      if (parens.length > 0 || nested) { i++; line++; lineStart = i; continue; }
      // fin de línea lógica
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== 'NEWLINE' && tokens[tokens.length - 1].type !== 'INDENT' && tokens[tokens.length - 1].type !== 'DEDENT') {
        push('NEWLINE', i, i + 1, '\n');
        tokens[tokens.length - 1].end = i + 1;
      }
      i++; line++; lineStart = i; atLineStart = true;
      continue;
    }
    if (ch === 92) { // barra invertida: continuación de línea
      const nx = src.charCodeAt(i + 1);
      if (nx === 10) {
        i += 2; line++; lineStart = i;
        if (i >= n) {
          fail('SyntaxError', 'unexpected EOF while parsing', line - 1, i - 1 - table.starts[line - 2], line - 1, -2, true);
          break;
        }
        continue;
      }
      if (i + 1 >= n) {
        fail('SyntaxError', 'unexpected EOF while parsing', line, i - lineStart + 1, line, -2, true);
        break;
      }
      fail('SyntaxError', 'unexpected character after line continuation character', line, i - lineStart + 1, line, -1);
      break;
    }

    const startCol = i - lineStart;
    const sc = src[i];

    // ── identificadores / palabras clave / prefijos de cadena ──
    if (isIdStart(sc) || (sc >= '\ud800' && sc <= '\udbff' && idStartRe && idStartRe.test(src.slice(i, i + 2)))) {
      let j = i;
      while (j < n) {
        const cj = src[j];
        if (cj >= '\ud800' && cj <= '\udbff') {
          if (idContRe && idContRe.test(src.slice(j, j + 2))) { j += 2; continue; }
          break;
        }
        if (isIdCont(cj)) j++;
        else break;
      }
      const word = src.slice(i, j);
      const q = src[j];
      if ((q === '"' || q === "'") && j - i <= 2 && /^(?:[rRbBuUfF]|[rR][bBfF]|[bBfF][rR])$/.test(word)) {
        // cadena con prefijo
        const r = scanString(src, table, i, j - i, n);
        if (r.error) { error = r.error; break; }
        push('STRING', i, r.end);
        line = table.lineOf(r.end - 1);
        lineStart = table.starts[line - 1];
        i = r.end;
        continue;
      }
      let value = word;
      if (/[^\x00-\x7f]/.test(word)) value = word.normalize('NFKC');
      push('NAME', i, j, value);
      i = j;
      continue;
    }

    // ── números ──
    if (isDigit(src.charCodeAt(i)) || (sc === '.' && isDigit(src.charCodeAt(i + 1)))) {
      const r = scanNumber(src, i, n);
      if (r.error) {
        const ec = (r.errCol !== undefined ? r.errCol : i) - lineStart;
        fail('SyntaxError', r.error, line, ec, line, r.errEnd !== undefined ? r.errEnd - lineStart : ec);
        break;
      }
      push('NUMBER', i, r.end);
      i = r.end;
      continue;
    }

    // ── cadenas ──
    if (sc === '"' || sc === "'") {
      const r = scanString(src, table, i, 0, n);
      if (r.error) { error = r.error; break; }
      push('STRING', i, r.end);
      line = table.lineOf(r.end - 1);
      lineStart = table.starts[line - 1];
      i = r.end;
      continue;
    }

    // ── operadores y delimitadores ──
    let op = '';
    const s3 = src.substr(i, 3);
    if (OPS3.has(s3)) op = s3;
    else {
      const s2 = s3.slice(0, 2);
      if (OPS2.has(s2)) op = s2;
      else if (OPS1.has(sc)) op = sc;
    }
    if (op === '') {
      const cp = src.codePointAt(i)!;
      if (cp < 32 || cp === 0x7f || (cp >= 0x80 && cp <= 0xa0) || cp === 0xad || (cp >= 0x2000 && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202f) || cp === 0x3000 || cp === 0xfeff) {
        const hex = cp.toString(16).toUpperCase().padStart(4, '0');
        fail('SyntaxError', `invalid non-printable character U+${hex}`, line, startCol);
      } else {
        const chs = String.fromCodePoint(cp);
        fail('SyntaxError', `invalid character '${chs}' (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`, line, startCol);
      }
      break;
    }
    if (op === '(' || op === '[' || op === '{') {
      if (parens.length >= 200) { fail('SyntaxError', 'too many nested parentheses', line, startCol); break; }
      parens.push({ ch: op, line, col: startCol });
    } else if (op === ')' || op === ']' || op === '}') {
      if (parens.length === 0) {
        if (nested) { // llave de cierre de f-string: la gestiona el scanner de f-strings
          push('OP', i, i + 1);
          i++;
          continue;
        }
        fail('SyntaxError', `unmatched '${op}'`, line, startCol);
        break;
      }
      const top = parens[parens.length - 1];
      if (top.ch !== CLOSERS[op]) {
        if (top.line !== line) fail('SyntaxError', `closing parenthesis '${op}' does not match opening parenthesis '${top.ch}' on line ${top.line}`, line, startCol);
        else fail('SyntaxError', `closing parenthesis '${op}' does not match opening parenthesis '${top.ch}'`, line, startCol);
        break;
      }
      parens.pop();
    }
    push('OP', i, i + op.length);
    i += op.length;
  }

  if (!error) {
    if (nested) {
      push('EOF', n, n);
    } else {
      // fin del texto
      if (parens.length > 0) {
        const p = parens[parens.length - 1];
        eofInTriple = false;
        tokens.push({ type: 'ERROR', value: 'unclosed', line: p.line, col: p.col, endLine: p.line, endCol: p.col + 1, start: n, end: n });
      } else {
        const last = tokens[tokens.length - 1];
        // posición del fin de entrada: última línea del texto, tras su último carácter (como el ENDMARKER de CPython)
        const eofLine = src.length === 0 ? 1 : src.endsWith('\n') ? table.lineCount - 1 : table.lineCount;
        const eofCol = table.lineText(eofLine).length;
        if (last && last.type !== 'NEWLINE' && last.type !== 'INDENT' && last.type !== 'DEDENT') {
          tokens.push({ type: 'NEWLINE', value: '', line: eofLine, col: eofCol, endLine: eofLine, endCol: eofCol + 1, start: n, end: n });
        }
        while (indents.length > 1) {
          indents.pop();
          tokens.push({ type: 'DEDENT', value: '', line: eofLine, col: eofCol, endLine: eofLine, endCol: -2, start: n, end: n });
        }
        tokens.push({ type: 'EOF', value: '', line: eofLine, col: eofCol, endLine: eofLine, endCol: -2, start: n, end: n });
      }
    }
  } else {
    const e = error as PySyntaxErr;
    if (e.msg.startsWith('unterminated triple-quoted')) eofInTriple = true;
  }
  return { tokens, error, open: parens.slice().reverse(), eofInTriple };
}

// ───────────────────────── números ─────────────────────────

interface NumResult {
  end: number;
  error?: string;
  /** desplazamiento (absoluto) del carácter donde se informa el error */
  errCol?: number;
  errEnd?: number;
}

/** Réplica de la lógica de números del tokenizador de CPython (mismos mensajes y posiciones). */
function scanNumber(src: string, start: number, n: number): NumResult {
  const ch = (k: number): string => (k < n ? src[k] : '');
  const isD = (c: string) => c >= '0' && c <= '9' && c !== '';
  const isX = (c: string) => c !== '' && isHex(c.charCodeAt(0));
  const isIdChar = (c: string) => c !== '' && (/[A-Za-z0-9_]/.test(c) || c.charCodeAt(0) >= 128);
  let i = start;
  const err = (msg: string, at: number): NumResult => ({ end: i, error: msg, errCol: at });

  /** verify_end_of_number: `k` es el índice del carácter que sigue al número, `lastIdx` el último del número */
  const verifyEnd = (k: number, kind: string): NumResult | null => {
    const c = ch(k);
    if (c === '') return null;
    // palabras clave pegadas permitidas (`1if x else 2`)
    const kw = ['and', 'else', 'for', 'if', 'in', 'is', 'not', 'or'];
    for (const w of kw) {
      if (src.startsWith(w, k) && (w === 'and' || w === 'else' || w === 'for' || w === 'if' || w === 'in' || w === 'is' || w === 'not' || w === 'or')) {
        // lookahead de CPython: solo comprueba el resto de la palabra
        if (w[0] === c) return null;
      }
    }
    if (c.charCodeAt(0) < 128 && isIdChar(c)) return err(`invalid ${kind} literal`, k - 1);
    if (c.charCodeAt(0) >= 128 && isIdChar(c)) return err(`invalid ${kind} literal`, k - 1);
    return null;
  };
  /** tok_decimal_tail: avanza sobre dígitos con '_' (devuelve null si hay error) */
  const decTail = (): NumResult | null => {
    for (;;) {
      while (isD(ch(i))) i++;
      if (ch(i) !== '_') return null;
      i++;
      if (!isD(ch(i))) return err('invalid decimal literal', i - 1);
    }
  };

  const c0 = ch(i);
  let isFrac = false;
  if (c0 === '.') {
    // `.5`
    isFrac = true;
    i++;
    const e = decTail();
    if (e) return e;
  } else if (c0 === '0') {
    i++;
    const t = ch(i).toLowerCase();
    if (t === 'x') {
      i++;
      do {
        if (ch(i) === '_') i++;
        if (!isX(ch(i))) return err('invalid hexadecimal literal', i - 1);
        do i++; while (isX(ch(i)));
      } while (ch(i) === '_');
      return verifyEnd(i, 'hexadecimal') ?? { end: i };
    }
    if (t === 'o' || t === 'b') {
      const isOct = t === 'o';
      const kind = isOct ? 'octal' : 'binary';
      const okd = (c: string) => (isOct ? c >= '0' && c <= '7' && c !== '' : c === '0' || c === '1');
      i++;
      do {
        if (ch(i) === '_') i++;
        if (!okd(ch(i))) {
          if (isD(ch(i))) return err(`invalid digit '${ch(i)}' in ${kind} literal`, i);
          return err(`invalid ${kind} literal`, i - 1);
        }
        do i++; while (okd(ch(i)));
      } while (ch(i) === '_');
      if (isD(ch(i))) return err(`invalid digit '${ch(i)}' in ${kind} literal`, i);
      return verifyEnd(i, kind) ?? { end: i };
    }
    // decimal que empieza por 0
    let nonzero = false;
    for (;;) {
      if (ch(i) === '_') {
        i++;
        if (!isD(ch(i))) return err('invalid decimal literal', i - 1);
      }
      if (ch(i) !== '0') break;
      i++;
    }
    const zerosEnd = i + 1;
    if (isD(ch(i))) {
      nonzero = true;
      const e = decTail();
      if (e) return e;
    }
    const c = ch(i);
    if (c === '.') { isFrac = true; i++; if (isD(ch(i))) { const e = decTail(); if (e) return e; } }
    else if (c === 'e' || c === 'E' || c === 'j' || c === 'J') { /* sigue abajo */ }
    else if (nonzero) {
      return { end: i, error: 'leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers', errCol: start, errEnd: zerosEnd - 1 };
    } else {
      return verifyEnd(i, 'decimal') ?? { end: i };
    }
  } else {
    const e = decTail();
    if (e) return e;
    if (ch(i) === '.') { isFrac = true; i++; if (isD(ch(i))) { const e2 = decTail(); if (e2) return e2; } }
  }
  void isFrac;
  // exponente
  if (ch(i) === 'e' || ch(i) === 'E') {
    const eIdx = i;
    let k = i + 1;
    if (ch(k) === '+' || ch(k) === '-') {
      k++;
      if (!isD(ch(k))) return err('invalid decimal literal', k - 1);
      i = k;
      const e = decTail();
      if (e) return e;
    } else if (!isD(ch(k))) {
      // `1else`: palabra clave pegada; en otro caso error
      const v = verifyEnd(eIdx, 'decimal');
      if (v) return v;
      return { end: eIdx };
    } else {
      i = k;
      const e = decTail();
      if (e) return e;
    }
  }
  if (ch(i) === 'j' || ch(i) === 'J') {
    i++;
    return verifyEnd(i, 'imaginary') ?? { end: i };
  }
  return verifyEnd(i, 'decimal') ?? { end: i };
}

// ───────────────────────── cadenas ─────────────────────────

/**
 * Escanea una cadena que empieza en `start` (con `prefixLen` caracteres de prefijo antes de la comilla).
 * Devuelve el desplazamiento del final (exclusivo) o un error.
 */
function scanString(src: string, table: LineTable, start: number, prefixLen: number, n: number): { end: number; error?: PySyntaxErr } {
  const prefix = src.slice(start, start + prefixLen).toLowerCase();
  const isF = prefix.includes('f');
  const raw = prefix.includes('r');
  let i = start + prefixLen;
  const q = src[i];
  const triple = src[i + 1] === q && src[i + 2] === q;
  const openLine = table.lineOf(start);
  const openCol = table.colOf(start);
  const kindName = isF ? 'f-string' : 'string';
  const unterminated = (): PySyntaxErr => {
    const lastLine = table.lineOf(Math.max(0, n - 1));
    const detected = triple ? (src.endsWith('\n') && n > 0 ? lastLine : lastLine) : table.lineOf(Math.min(i, n - 1 < 0 ? 0 : i));
    if (triple) return new PySyntaxErr('SyntaxError', `unterminated triple-quoted ${kindName} literal (detected at line ${detected})`, openLine, openCol, openLine, openCol, true);
    return new PySyntaxErr('SyntaxError', `unterminated ${kindName} literal (detected at line ${openLine})`, openLine, openCol, openLine, openCol);
  };
  i += triple ? 3 : 1;
  if (isF) {
    const r = scanFStringBody(src, i, q, triple, raw, n);
    if (r.err === 'unterminated') return { end: n, error: unterminated() };
    if (r.err) {
      const pos = r.errPos ?? start;
      const ln = table.lineOf(pos);
      const cl = table.colOf(pos);
      const w = r.errW === undefined ? 0 : r.errW;
      return { end: n, error: new PySyntaxErr('SyntaxError', r.err, ln, cl, ln, w === -1 ? -1 : cl + w, r.err.includes('never closed')) };
    }
    return { end: r.end };
  }
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === q) {
      if (!triple) return { end: i + 1 };
      if (src[i + 1] === q && src[i + 2] === q) return { end: i + 3 };
    } else if (c === '\n' && !triple) {
      return { end: i, error: unterminated() };
    }
    i++;
  }
  return { end: n, error: unterminated() };
}

export interface FStrPart {
  kind: 'lit' | 'expr';
  /** lit: texto crudo (sin procesar escapes ni llaves dobles) */
  text?: string;
  start: number;
  end: number;
  /** expr: rango del texto de la expresión */
  exprStart?: number;
  exprEnd?: number;
  /** conversión: 's' | 'r' | 'a' | undefined */
  conv?: string;
  convPos?: number;
  /** '=' de autodocumentación: texto literal que se antepone (incluye la expresión y el '=') */
  selfDoc?: string;
  spec?: FStrPart[];
  specStart?: number;
}

interface FScan {
  end: number;
  parts: FStrPart[];
  err?: string;
  errPos?: number;
  /** ancho del error: 0 (por defecto), 1, o -1 (end_offset 0 como "was never closed") */
  errW?: number;
}

/** Encuentra el final de una f-string a partir del contenido (tras la comilla de apertura). */
export function scanFStringBody(src: string, from: number, q: string, triple: boolean, raw: boolean, n: number): FScan {
  return scanFParts(src, from, n, q, triple, raw, false);
}

/**
 * Escanea literal + campos de reemplazo. `inSpec`: dentro de un especificador de formato
 * (termina en `}` sin consumir; la comilla de cierre de la f-string es un error).
 */
export function scanFParts(src: string, from: number, n: number, q: string, triple: boolean, raw: boolean, inSpec: boolean): FScan {
  const parts: FStrPart[] = [];
  let i = from;
  let litStart = i;
  const flushLit = (end: number, posEnd = end) => {
    if (end > litStart) parts.push({ kind: 'lit', text: src.slice(litStart, end), start: litStart, end: posEnd });
  };
  const closesHere = (k: number) => src[k] === q && (!triple || (src[k + 1] === q && src[k + 2] === q));
  while (i < n) {
    const c = src[i];
    if (closesHere(i)) {
      if (inSpec) return { end: i, parts, err: "f-string: expecting '}', or format specs", errPos: i, errW: 1 };
      flushLit(i);
      return { end: i + (triple ? 3 : 1), parts };
    }
    if (c === '\n' && !triple && !inSpec) {
      return { end: i, parts, err: 'unterminated' };
    }
    if (c === '\\' && !raw) {
      // escape: salta el siguiente (\N{...} es un escape completo)
      if (src[i + 1] === 'N' && src[i + 2] === '{') {
        const close = src.indexOf('}', i + 3);
        if (close > 0) { i = close + 1; continue; }
      }
      i += 2;
      continue;
    }
    if (c === '\\' && raw) {
      if (src[i + 1] === q || src[i + 1] === '\\') { i += 2; continue; }
      i++;
      continue;
    }
    if (c === '{') {
      if (!inSpec && src[i + 1] === '{') { flushLit(i + 1, i + 2); i += 2; litStart = i; continue; }
      flushLit(i);
      const r = scanReplacementField(src, i, n, q, triple, raw);
      if (r.err) return { end: r.end, parts, err: r.err, errPos: r.errPos, errW: r.errW };
      parts.push(r.part!);
      i = r.end;
      litStart = i;
      continue;
    }
    if (c === '}') {
      if (inSpec) { flushLit(i); return { end: i, parts }; }
      if (src[i + 1] === '}') { flushLit(i + 1, i + 2); i += 2; litStart = i; continue; }
      return { end: i, parts, err: "f-string: single '}' is not allowed", errPos: i };
    }
    i++;
  }
  flushLit(n);
  return { end: n, parts, err: 'unterminated' };
}

function scanReplacementField(src: string, open: number, n: number, q: string, triple: boolean, raw: boolean): { end: number; part?: FStrPart; err?: string; errPos?: number; errW?: number } {
  let i = open + 1;
  const exprStart = i;
  const stack: string[] = [];
  let exprEnd = -1;
  const closesHere = (k: number) => src[k] === q && (!triple || (src[k + 1] === q && src[k + 2] === q));
  // buscar el final de la expresión
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n' && !triple && stack.length === 0 && false) { /* las f-strings simples pueden tener saltos dentro de la expresión desde 3.12 */ }
    if (c === '"' || c === "'") {
      let ps = i;
      while (ps > exprStart && /[rRbBuUfF]/.test(src[ps - 1]) && i - ps < 2) ps--;
      const prefix = src.slice(ps, i).toLowerCase();
      const isTriple = src[i + 1] === c && src[i + 2] === c;
      const r = skipPlainOrFString(src, i, c, isTriple, prefix.includes('f'), prefix.includes('r'), n);
      if (r < 0) {
        if (c === q && isTriple === triple) return { end: n, err: "f-string: expecting '}'", errPos: i };
        return { end: n, err: 'unterminated' };
      }
      i = r;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (stack.length === 0) {
        if (c === '}') { exprEnd = i; break; }
        return { end: i, err: `f-string: unmatched '${c}'`, errPos: i };
      }
      const top = stack.pop()!;
      if ((top === '(' && c !== ')') || (top === '[' && c !== ']') || (top === '{' && c !== '}')) {
        return { end: i, err: `closing parenthesis '${c}' does not match opening parenthesis '${top}'`, errPos: i };
      }
      i++;
      continue;
    }
    if (stack.length === 0) {
      if (c === '!' && src[i + 1] !== '=') { exprEnd = i; break; }
      if (c === ':') { exprEnd = i; break; }
      if (c === '=') {
        const prev = src[i - 1];
        const next = src[i + 1];
        if (next === '=') { i += 2; continue; }
        if (prev === '=' || prev === '!' || prev === '<' || prev === '>') { i++; continue; }
        exprEnd = i;
        break;
      }
    }
    i++;
  }
  if (exprEnd < 0) return { end: n, err: "'{' was never closed", errPos: open, errW: -1 };
  const part: FStrPart = { kind: 'expr', start: open, end: -1, exprStart, exprEnd };
  i = exprEnd;
  if (src[i] === '=') {
    i++;
    while (i < n && /\s/.test(src[i])) i++;
    part.selfDoc = src.slice(open + 1, i);
    const nx = src[i];
    if (nx !== '!' && nx !== ':' && nx !== '}') {
      if (closesHere(i) || i >= n) return { end: i, err: "f-string: expecting '}'", errPos: Math.min(i, n) };
      return { end: i, err: "f-string: expecting '!', or ':', or '}'", errPos: i, errW: 1 };
    }
  }
  if (src[i] === '!') {
    part.convPos = i + 1;
    const cv = src[i + 1];
    if (cv === 's' || cv === 'r' || cv === 'a') {
      part.conv = cv;
      i += 2;
      if (src[i] !== ':' && src[i] !== '}') {
        if (closesHere(i) || i >= n) return { end: i, err: "f-string: expecting '}'", errPos: Math.min(i, n) };
        return { end: i, err: "f-string: expecting ':' or '}'", errPos: i, errW: 1 };
      }
    } else if (cv === '}' || cv === ':') {
      return { end: i, err: 'f-string: missing conversion character', errPos: i + 1, errW: 1 };
    } else if (cv === undefined || closesHere(i + 1)) {
      return { end: i, err: "f-string: expecting '}'", errPos: Math.min(i + 1, n) };
    } else {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i + 1, i + 40));
      return { end: i, err: `f-string: invalid conversion character '${m ? m[0] : cv}': expected 's', 'r', or 'a'`, errPos: i + 1, errW: 1 };
    }
  }
  if (src[i] === ':') {
    part.specStart = i + 1;
    const r = scanFParts(src, i + 1, n, q, triple, raw, true);
    if (r.err) return { end: r.end, err: r.err, errPos: r.errPos ?? Math.min(r.end, n), errW: r.errW ?? 1 };
    part.spec = r.parts;
    i = r.end;
  }
  if (src[i] !== '}') {
    if (i >= n) return { end: n, err: "f-string: expecting '}'", errPos: n };
    return { end: i, err: "f-string: expecting '}'", errPos: i };
  }
  part.end = i + 1;
  return { end: i + 1, part };
}

/** Salta una cadena (posiblemente f-string) que empieza en `i` (en la comilla). Devuelve el final o -1. */
function skipPlainOrFString(src: string, i: number, q: string, triple: boolean, isF: boolean, raw: boolean, n: number): number {
  let k = i + (triple ? 3 : 1);
  if (isF) {
    const r = scanFParts(src, k, n, q, triple, raw, false);
    if (r.err) return -1;
    return r.end;
  }
  while (k < n) {
    const c = src[k];
    if (c === '\\') { k += 2; continue; }
    if (c === q) {
      if (!triple) return k + 1;
      if (src[k + 1] === q && src[k + 2] === q) return k + 3;
    } else if (c === '\n' && !triple) return -1;
    k++;
  }
  return -1;
}
