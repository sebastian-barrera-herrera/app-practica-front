/**
 * Lexer + parser de un subconjunto amplio de bash:
 * pipes, listas (; && || &), redirecciones, heredocs, comillas, $(...),
 * ${...}, $((...)), if / for / while / until / case, funciones, { } y ( ).
 */

// ───────────────────────── AST ─────────────────────────

export type DqPart =
  | { t: 'lit'; s: string }
  | { t: 'param'; name: string; op?: string; arg?: Word }
  | { t: 'cmd'; src: string }
  | { t: 'arith'; expr: string };

export type Part =
  | { t: 'lit'; s: string } // sin comillas (sujeto a glob y separación)
  | { t: 'sq'; s: string } // literal protegido
  | { t: 'dq'; parts: DqPart[] }
  | { t: 'param'; name: string; op?: string; arg?: Word }
  | { t: 'cmd'; src: string }
  | { t: 'psub'; src: string } // <( comando )
  | { t: 'arith'; expr: string }
  | { t: 'tilde'; user: string }
  | { t: 'arr'; words: Word[] };

export type Word = Part[];

export interface Redir {
  fd: number | null;
  op: string; // < > >> >& <& << <<< &> &>> >|
  target: Word;
  heredoc?: { body: string; quoted: boolean; strip: boolean };
}

export interface Assign {
  name: string;
  /** Subíndice de array: a[2]=x → "2" */
  sub: string | null;
  value: Word;
  append: boolean;
}

export type Node =
  | { type: 'simple'; assigns: Assign[]; words: Word[]; redirs: Redir[]; line: string }
  | { type: 'pipeline'; negate: boolean; cmds: Node[] }
  | { type: 'andor'; first: Node; rest: { op: '&&' | '||'; p: Node }[] }
  | { type: 'list'; items: { cmd: Node; bg: boolean; text: string }[] }
  | { type: 'if'; conds: { cond: Node; body: Node }[]; else: Node | null; redirs: Redir[] }
  | { type: 'for'; name: string; words: Word[] | null; body: Node; redirs: Redir[] }
  | { type: 'cfor'; init: string; cond: string; step: string; body: Node; redirs: Redir[] }
  | { type: 'while'; cond: Node; body: Node; until: boolean; redirs: Redir[] }
  | { type: 'case'; word: Word; clauses: { patterns: Word[]; body: Node }[]; redirs: Redir[] }
  | { type: 'group'; body: Node; subshell: boolean; redirs: Redir[] }
  | { type: 'func'; name: string; body: Node }
  | { type: 'arith'; expr: string; redirs: Redir[] }
  | { type: 'dbracket'; words: Word[]; redirs: Redir[] };

export class ParseError extends Error {
  incomplete: boolean;
  constructor(msg: string, incomplete = false) {
    super(msg);
    this.incomplete = incomplete;
  }
}

// ───────────────────────── tokens ─────────────────────────

type Token =
  | { k: 'word'; w: Word; raw: string; quoted: boolean }
  | { k: 'op'; v: string; heredoc?: { delim: string; quoted: boolean; strip: boolean; body: string } }
  | { k: 'io'; n: number }
  | { k: 'nl' }
  | { k: 'arith'; expr: string };

const META = new Set([' ', '\t', '\n', '|', '&', ';', '(', ')', '<', '>']);
const RESERVED_CMD_START = new Set([
  'do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', '!', 'in',
]);

function findMatching(src: string, start: number, open: string, close: string): number {
  // `start` apunta justo después del carácter de apertura. Devuelve el índice del cierre.
  let depth = 1;
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", i + 1);
      if (e < 0) return -1;
      i = e + 1;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

class Lexer {
  src: string;
  i = 0;
  tokens: Token[] = [];
  pending: Extract<Token, { k: 'op' }>[] = [];

  constructor(src: string) {
    this.src = src;
  }

  run(): Token[] {
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === ' ' || c === '\t') {
        this.i++;
        continue;
      }
      if (c === '\\' && s[this.i + 1] === '\n') {
        this.i += 2;
        continue;
      }
      if (c === '#' ) {
        while (this.i < s.length && s[this.i] !== '\n') this.i++;
        continue;
      }
      if (c === '\n') {
        this.i++;
        this.tokens.push({ k: 'nl' });
        this.flushHeredocs();
        continue;
      }
      if (this.lexOperator()) continue;
      this.lexWordToken();
    }
    if (this.pending.length) throw new ParseError('heredoc sin cerrar', true);
    return this.tokens;
  }

  private atCommandStart(): boolean {
    const last = this.tokens[this.tokens.length - 1];
    if (!last) return true;
    if (last.k === 'nl') return true;
    if (last.k === 'op') return ['|', '||', '&&', ';', '&', '(', ';;'].includes(last.v);
    if (last.k === 'word' && !last.quoted) return RESERVED_CMD_START.has(last.raw);
    return false;
  }

  private lexOperator(): boolean {
    const s = this.src;
    const c = s[this.i];
    const three = s.slice(this.i, this.i + 3);
    const two = s.slice(this.i, this.i + 2);
    if (c === '(' && s[this.i + 1] === '(') {
      const last = this.tokens[this.tokens.length - 1];
      const afterFor = last && last.k === 'word' && last.raw === 'for';
      if (this.atCommandStart() || afterFor) {
        const end = findDoubleParen(s, this.i + 2);
        if (end < 0) throw new ParseError('falta ))', true);
        this.tokens.push({ k: 'arith', expr: s.slice(this.i + 2, end) });
        this.i = end + 2;
        return true;
      }
    }
    // <( … ) es sustitución de procesos: lo lee el lexer de palabras
    if (c === '<' && s[this.i + 1] === '(') return false;
    if (three === '<<<') return this.op('<<<', 3);
    if (three === '&>>') return this.op('&>>', 3);
    if (three === '<<-') return this.heredocOp(true, 3);
    if (two === '<<') return this.heredocOp(false, 2);
    for (const o of ['&&', '||', ';;', '>>', '>&', '<&', '&>', '>|', '<>']) {
      if (two === o) return this.op(o, 2);
    }
    if ('|&;()<>'.includes(c)) {
      // número de descriptor antes de < o >
      return this.op(c, 1);
    }
    return false;
  }

  private op(v: string, len: number): boolean {
    // io number: palabra compuesta solo de dígitos justo antes
    if ((v[0] === '<' || v[0] === '>') && this.tokens.length) {
      const last = this.tokens[this.tokens.length - 1];
      if (
        last.k === 'word' &&
        /^\d+$/.test(last.raw) &&
        !last.quoted &&
        this.i > 0 &&
        !' \t\n'.includes(this.src[this.i - 1])
      ) {
        this.tokens.pop();
        this.tokens.push({ k: 'io', n: parseInt(last.raw, 10) });
      }
    }
    this.tokens.push({ k: 'op', v });
    this.i += len;
    return true;
  }

  private heredocOp(strip: boolean, len: number): boolean {
    this.op('<<', 0);
    const tok = this.tokens[this.tokens.length - 1] as Extract<Token, { k: 'op' }>;
    this.i += len;
    while (this.src[this.i] === ' ' || this.src[this.i] === '\t') this.i++;
    // delimitador (cruda)
    let delim = '';
    let quoted = false;
    while (this.i < this.src.length && !META.has(this.src[this.i])) {
      const c = this.src[this.i];
      if (c === "'" || c === '"') {
        quoted = true;
        const e = this.src.indexOf(c, this.i + 1);
        if (e < 0) throw new ParseError('comilla sin cerrar', true);
        delim += this.src.slice(this.i + 1, e);
        this.i = e + 1;
      } else if (c === '\\') {
        quoted = true;
        delim += this.src[this.i + 1] ?? '';
        this.i += 2;
      } else {
        delim += c;
        this.i++;
      }
    }
    if (!delim) throw new ParseError('syntax error near unexpected token `newline\'');
    tok.heredoc = { delim, quoted, strip, body: '' };
    this.pending.push(tok);
    return true;
  }

  private flushHeredocs() {
    while (this.pending.length) {
      const tok = this.pending.shift()!;
      const h = tok.heredoc!;
      const lines: string[] = [];
      let found = false;
      while (this.i < this.src.length) {
        let e = this.src.indexOf('\n', this.i);
        if (e < 0) e = this.src.length;
        let line = this.src.slice(this.i, e);
        this.i = Math.min(e + 1, this.src.length);
        const cmp = h.strip ? line.replace(/^\t+/, '') : line;
        if (cmp === h.delim) {
          found = true;
          break;
        }
        lines.push(h.strip ? cmp : line);
        if (e >= this.src.length) break;
      }
      if (!found) throw new ParseError('heredoc sin cerrar', true);
      h.body = lines.length ? lines.join('\n') + '\n' : '';
    }
  }

  private lexWordToken() {
    const start = this.i;
    const parts: Word = [];
    let lit = '';
    let quoted = false;
    const flush = () => {
      if (lit) {
        parts.push({ t: 'lit', s: lit });
        lit = '';
      }
    };
    const s = this.src;
    while (this.i < s.length) {
      const c = s[this.i];
      if (
        c === '(' &&
        parts.length === 0 &&
        /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=$/.test(lit)
      ) {
        const e = findMatching(s, this.i + 1, '(', ')');
        if (e < 0) throw new ParseError('paréntesis sin cerrar', true);
        const inner = s.slice(this.i + 1, e);
        const words = new Lexer(inner)
          .run()
          .filter((t): t is Extract<Token, { k: 'word' }> => t.k === 'word')
          .map((t) => t.w);
        parts.push({ t: 'lit', s: lit });
        lit = '';
        parts.push({ t: 'arr', words });
        this.i = e + 1;
        break;
      }
      if (c === '<' && s[this.i + 1] === '(') {
        const e = findMatching(s, this.i + 2, '(', ')');
        if (e < 0) throw new ParseError('paréntesis sin cerrar', true);
        flush();
        parts.push({ t: 'psub', src: s.slice(this.i + 2, e) });
        this.i = e + 1;
        continue;
      }
      if (META.has(c)) break;
      if (c === '\\') {
        if (s[this.i + 1] === '\n') {
          this.i += 2;
          continue;
        }
        if (this.i + 1 >= s.length) {
          throw new ParseError('barra invertida al final', true);
        }
        flush();
        parts.push({ t: 'sq', s: s[this.i + 1] });
        quoted = true;
        this.i += 2;
        continue;
      }
      if (c === "'") {
        const e = s.indexOf("'", this.i + 1);
        if (e < 0) throw new ParseError("comilla simple sin cerrar", true);
        flush();
        parts.push({ t: 'sq', s: s.slice(this.i + 1, e) });
        quoted = true;
        this.i = e + 1;
        continue;
      }
      if (c === '"') {
        flush();
        parts.push(this.lexDouble());
        quoted = true;
        continue;
      }
      if (c === '$') {
        if (s[this.i + 1] === "'") {
          const e = findAnsiEnd(s, this.i + 2);
          if (e < 0) throw new ParseError('comilla sin cerrar', true);
          flush();
          parts.push({ t: 'sq', s: decodeAnsiC(s.slice(this.i + 2, e)) });
          quoted = true;
          this.i = e + 1;
          continue;
        }
        const p = this.lexDollar(false);
        if (p) {
          flush();
          parts.push(p);
          continue;
        }
        lit += '$';
        this.i++;
        continue;
      }
      if (c === '`') {
        const e = s.indexOf('`', this.i + 1);
        if (e < 0) throw new ParseError('backtick sin cerrar', true);
        flush();
        parts.push({ t: 'cmd', src: s.slice(this.i + 1, e).replace(/\\`/g, '`') });
        this.i = e + 1;
        continue;
      }
      if (c === '~' && this.i === start) {
        let j = this.i + 1;
        while (j < s.length && /[A-Za-z0-9_.-]/.test(s[j])) j++;
        if (j >= s.length || s[j] === '/' || META.has(s[j]) || s[j] === ':') {
          parts.push({ t: 'tilde', user: s.slice(this.i + 1, j) });
          this.i = j;
          continue;
        }
      }
      if (c === '#' && this.i === start) break;
      lit += c;
      this.i++;
    }
    flush();
    if (parts.length === 0) {
      // carácter inesperado (no debería ocurrir)
      this.i++;
      return;
    }
    const raw = s.slice(start, this.i);
    this.tokens.push({ k: 'word', w: parts, raw, quoted });
  }

  private lexDouble(): Part {
    const s = this.src;
    this.i++; // abre "
    const parts: DqPart[] = [];
    let lit = '';
    const flush = () => {
      if (lit) {
        parts.push({ t: 'lit', s: lit });
        lit = '';
      }
    };
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '"') {
        flush();
        this.i++;
        return { t: 'dq', parts };
      }
      if (c === '\\') {
        const d = s[this.i + 1];
        if (d === undefined) throw new ParseError('comilla sin cerrar', true);
        if (d === '$' || d === '`' || d === '"' || d === '\\') {
          lit += d;
          this.i += 2;
        } else if (d === '\n') {
          this.i += 2;
        } else {
          lit += '\\';
          this.i++;
        }
        continue;
      }
      if (c === '$') {
        const p = this.lexDollar(true);
        if (p) {
          flush();
          parts.push(p as DqPart);
          continue;
        }
        lit += '$';
        this.i++;
        continue;
      }
      if (c === '`') {
        const e = s.indexOf('`', this.i + 1);
        if (e < 0) throw new ParseError('backtick sin cerrar', true);
        flush();
        parts.push({ t: 'cmd', src: s.slice(this.i + 1, e) });
        this.i = e + 1;
        continue;
      }
      lit += c;
      this.i++;
    }
    throw new ParseError('comilla doble sin cerrar', true);
  }

  /** Lee una expansión que empieza en '$'. Devuelve null si el '$' es literal. */
  private lexDollar(inDq: boolean): Part | null {
    const s = this.src;
    const n = s[this.i + 1];
    if (n === '(') {
      if (s[this.i + 2] === '(') {
        const end = findDoubleParen(s, this.i + 3);
        if (end >= 0) {
          const expr = s.slice(this.i + 3, end);
          this.i = end + 2;
          return { t: 'arith', expr };
        }
      }
      const e = findMatching(s, this.i + 2, '(', ')');
      if (e < 0) throw new ParseError('paréntesis sin cerrar', true);
      const src = s.slice(this.i + 2, e);
      this.i = e + 1;
      return { t: 'cmd', src };
    }
    if (n === '{') {
      const e = findMatching(s, this.i + 2, '{', '}');
      if (e < 0) throw new ParseError('llave sin cerrar', true);
      const inner = s.slice(this.i + 2, e);
      this.i = e + 1;
      return parseBraceParam(inner, inDq);
    }
    if (n !== undefined && /[A-Za-z_]/.test(n)) {
      let j = this.i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(this.i + 1, j);
      this.i = j;
      return { t: 'param', name };
    }
    if (n !== undefined && /[0-9?@*#$!\-]/.test(n)) {
      this.i += 2;
      return { t: 'param', name: n };
    }
    return null;
  }
}

function findDoubleParen(s: string, from: number): number {
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      if (depth === 0) return s[i + 1] === ')' ? i : -1;
      depth--;
    }
  }
  return -1;
}

function findAnsiEnd(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === "'") return i;
  }
  return -1;
}

export function decodeAnsiC(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_m, g: string) => {
    switch (g[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'a': return '\x07';
      case 'e': case 'E': return '\x1b';
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'x': return String.fromCharCode(parseInt(g.slice(1), 16));
      default:
        return /^[0-7]+$/.test(g) ? String.fromCharCode(parseInt(g, 8)) : '\\' + g;
    }
  });
}

/** Parsea el contenido de ${...}. */
function parseBraceParam(inner: string, inDq: boolean): Part {
  // ${#name}
  let m = /^#([A-Za-z_][A-Za-z0-9_]*|[0-9@*])$/.exec(inner);
  if (m) return { t: 'param', name: m[1], op: '#len' };
  m = /^!([A-Za-z_][A-Za-z0-9_]*)$/.exec(inner);
  if (m) return { t: 'param', name: m[1], op: '!indirect' };
  m = /^!([A-Za-z_][A-Za-z0-9_]*\[[@*]\])$/.exec(inner);
  if (m) return { t: 'param', name: m[1], op: '!keys' };
  m = /^#([A-Za-z_][A-Za-z0-9_]*\[[^\]]*\])$/.exec(inner);
  if (m) return { t: 'param', name: m[1], op: '#len' };
  m = /^([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?|[0-9]+|[@*#?$!])(.*)$/s.exec(inner);
  if (!m) return { t: 'lit', s: '${' + inner + '}' } as Part;
  const name = m[1];
  const rest = m[2];
  if (rest === '') return { t: 'param', name };
  const ops = [':-', ':=', ':?', ':+', '##', '%%', '//', '/#', '/%', '^^', ',,', '#', '%', '/', '^', ',', '-', '=', '?', '+'];
  for (const op of ops) {
    if (rest.startsWith(op)) {
      const argSrc = rest.slice(op.length);
      return { t: 'param', name, op, arg: lexFragment(argSrc, inDq) };
    }
  }
  if (rest.startsWith(':')) {
    return { t: 'param', name, op: ':offset', arg: lexFragment(rest.slice(1), inDq) };
  }
  return { t: 'param', name };
}

/** Parte un fragmento (argumento de ${...}) en una Word. */
function lexFragment(src: string, _inDq: boolean): Word {
  const lx = new Lexer(src);
  const parts: Word = [];
  let lit = '';
  const flush = () => {
    if (lit) {
      parts.push({ t: 'lit', s: lit });
      lit = '';
    }
  };
  while (lx.i < src.length) {
    const c = src[lx.i];
    if (c === '$') {
      const p = (lx as any).lexDollar(false);
      if (p) {
        flush();
        parts.push(p);
        continue;
      }
    }
    if (c === '"') {
      flush();
      parts.push((lx as any).lexDouble());
      continue;
    }
    if (c === "'") {
      const e = src.indexOf("'", lx.i + 1);
      if (e > 0) {
        flush();
        parts.push({ t: 'sq', s: src.slice(lx.i + 1, e) });
        lx.i = e + 1;
        continue;
      }
    }
    if (c === '\\' && lx.i + 1 < src.length) {
      flush();
      parts.push({ t: 'sq', s: src[lx.i + 1] });
      lx.i += 2;
      continue;
    }
    lit += c;
    lx.i++;
  }
  flush();
  return parts;
}

// ───────────────────────── parser ─────────────────────────

const CLOSERS = new Set(['fi', 'done', 'esac', 'else', 'elif', 'then', 'do', '}', ')', ';;']);

class Parser {
  toks: Token[];
  p = 0;
  src: string;

  constructor(toks: Token[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  peek(): Token | undefined {
    return this.toks[this.p];
  }

  eof(): boolean {
    return this.p >= this.toks.length;
  }

  isWord(raw: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'word' && !t.quoted && t.raw === raw;
  }

  isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'op' && t.v === v;
  }

  skipNl() {
    while (this.peek()?.k === 'nl') this.p++;
  }

  skipSeps() {
    for (;;) {
      const t = this.peek();
      if (t && (t.k === 'nl' || (t.k === 'op' && t.v === ';'))) this.p++;
      else break;
    }
  }

  expectWord(raw: string) {
    if (!this.isWord(raw)) {
      if (this.eof()) throw new ParseError(`se esperaba '${raw}'`, true);
      throw new ParseError(`syntax error near unexpected token \`${tokText(this.peek()!)}'`);
    }
    this.p++;
  }

  parseProgram(): Node {
    const list = this.parseList();
    if (!this.eof()) {
      throw new ParseError(`syntax error near unexpected token \`${tokText(this.peek()!)}'`);
    }
    return list;
  }

  /** Lista de comandos separados por ; & saltos de línea, hasta un cierre. */
  parseList(): Node {
    const items: { cmd: Node; bg: boolean; text: string }[] = [];
    this.skipSeps();
    while (!this.eof() && !this.atCloser()) {
      const startTok = this.p;
      const cmd = this.parseAndOr();
      let bg = false;
      const t = this.peek();
      if (t && t.k === 'op' && t.v === '&') {
        bg = true;
        this.p++;
      } else if (t && t.k === 'op' && t.v === ';') {
        this.p++;
      } else if (t && t.k === 'nl') {
        this.p++;
      } else if (t && !this.atCloser()) {
        throw new ParseError(`syntax error near unexpected token \`${tokText(t)}'`);
      }
      items.push({ cmd, bg, text: this.textOf(startTok, this.p) });
      this.skipSeps();
    }
    return { type: 'list', items };
  }

  private textOf(a: number, b: number): string {
    const parts: string[] = [];
    for (let i = a; i < b; i++) {
      const t = this.toks[i];
      if (t.k === 'word') parts.push(t.raw);
      else if (t.k === 'op') parts.push(t.v);
      else if (t.k === 'io') parts.push(String(t.n));
      else if (t.k === 'arith') parts.push(`((${t.expr}))`);
    }
    return parts.join(' ').replace(/ ?([;&|]) ?$/, '').replace(/ (>|<|>>|2>|&>) /g, ' $1 ');
  }

  atCloser(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === 'word' && !t.quoted && CLOSERS.has(t.raw)) return true;
    if (t.k === 'op' && (t.v === ')' || t.v === ';;')) return true;
    return false;
  }

  parseAndOr(): Node {
    const first = this.parsePipeline();
    const rest: { op: '&&' | '||'; p: Node }[] = [];
    for (;;) {
      const t = this.peek();
      if (t && t.k === 'op' && (t.v === '&&' || t.v === '||')) {
        this.p++;
        this.skipNl();
        if (this.eof()) throw new ParseError('falta comando tras ' + t.v, true);
        rest.push({ op: t.v, p: this.parsePipeline() });
      } else break;
    }
    return rest.length ? { type: 'andor', first, rest } : first;
  }

  parsePipeline(): Node {
    let negate = false;
    while (this.isWord('!')) {
      negate = !negate;
      this.p++;
    }
    const cmds: Node[] = [this.parseCommand()];
    while (this.isOp('|')) {
      this.p++;
      this.skipNl();
      if (this.eof()) throw new ParseError('falta comando tras |', true);
      cmds.push(this.parseCommand());
    }
    if (cmds.length === 1 && !negate) return cmds[0];
    return { type: 'pipeline', negate, cmds };
  }

  parseRedirs(): Redir[] {
    const redirs: Redir[] = [];
    for (;;) {
      const r = this.tryRedir();
      if (!r) break;
      redirs.push(r);
    }
    return redirs;
  }

  tryRedir(): Redir | null {
    let fd: number | null = null;
    const save = this.p;
    const t = this.peek();
    if (!t) return null;
    if (t.k === 'io') {
      fd = t.n;
      this.p++;
    }
    const o = this.peek();
    if (o && o.k === 'op' && ['<', '>', '>>', '>&', '<&', '<<', '<<<', '&>', '&>>', '>|', '<>'].includes(o.v)) {
      this.p++;
      if (o.v === '<<') {
        const h = o.heredoc!;
        return {
          fd,
          op: '<<',
          target: [],
          heredoc: { body: h.body, quoted: h.quoted, strip: h.strip },
        };
      }
      const w = this.peek();
      if (!w || w.k !== 'word') {
        if (!w) throw new ParseError("syntax error near unexpected token `newline'");
        throw new ParseError(`syntax error near unexpected token \`${tokText(w)}'`);
      }
      this.p++;
      return { fd, op: o.v, target: w.w };
    }
    this.p = save;
    return null;
  }

  parseCommand(): Node {
    const t = this.peek();
    if (!t) throw new ParseError('comando esperado', true);
    if (t.k === 'arith') {
      this.p++;
      return { type: 'arith', expr: t.expr, redirs: this.parseRedirs() };
    }
    if (t.k === 'op' && t.v === '(') {
      this.p++;
      const body = this.parseList();
      if (!this.isOp(')')) {
        if (this.eof()) throw new ParseError('falta )', true);
        throw new ParseError(`syntax error near unexpected token \`${tokText(this.peek()!)}'`);
      }
      this.p++;
      return { type: 'group', body, subshell: true, redirs: this.parseRedirs() };
    }
    if (t.k === 'word' && !t.quoted) {
      switch (t.raw) {
        case 'if': return this.parseIf();
        case 'for': return this.parseFor();
        case 'while': return this.parseWhile(false);
        case 'until': return this.parseWhile(true);
        case 'case': return this.parseCase();
        case '{': {
          this.p++;
          const body = this.parseList();
          this.expectWord('}');
          return { type: 'group', body, subshell: false, redirs: this.parseRedirs() };
        }
        case 'function': return this.parseFunction();
        case '[[': return this.parseDbracket();
      }
      // name() { ... }
      const n1 = this.toks[this.p + 1];
      const n2 = this.toks[this.p + 2];
      if (
        /^[A-Za-z_][A-Za-z0-9_-]*$/.test(t.raw) &&
        n1 && n1.k === 'op' && n1.v === '(' &&
        n2 && n2.k === 'op' && n2.v === ')'
      ) {
        this.p += 3;
        this.skipNl();
        const body = this.parseCommand();
        return { type: 'func', name: t.raw, body };
      }
      if (CLOSERS.has(t.raw) && t.raw !== '}') {
        throw new ParseError(`syntax error near unexpected token \`${t.raw}'`);
      }
    }
    return this.parseSimple();
  }

  parseSimple(): Node {
    const startTok = this.p;
    const assigns: Assign[] = [];
    const words: Word[] = [];
    const redirs: Redir[] = [];
    let seenWord = false;
    for (;;) {
      const r = this.tryRedir();
      if (r) {
        redirs.push(r);
        continue;
      }
      const t = this.peek();
      if (!t || t.k !== 'word') break;
      if (!seenWord) {
        const a = asAssignment(t.w);
        if (a) {
          assigns.push(a);
          this.p++;
          continue;
        }
      }
      seenWord = true;
      words.push(t.w);
      this.p++;
    }
    if (!assigns.length && !words.length && !redirs.length) {
      const t = this.peek();
      if (!t) throw new ParseError('comando esperado', true);
      throw new ParseError(`syntax error near unexpected token \`${tokText(t)}'`);
    }
    return { type: 'simple', assigns, words, redirs, line: this.textOf(startTok, this.p) };
  }

  parseIf(): Node {
    this.p++; // if
    const conds: { cond: Node; body: Node }[] = [];
    let elseBody: Node | null = null;
    const cond = this.parseList();
    this.expectWord('then');
    const body = this.parseList();
    conds.push({ cond, body });
    for (;;) {
      if (this.isWord('elif')) {
        this.p++;
        const c = this.parseList();
        this.expectWord('then');
        const b = this.parseList();
        conds.push({ cond: c, body: b });
      } else if (this.isWord('else')) {
        this.p++;
        elseBody = this.parseList();
      } else break;
    }
    this.expectWord('fi');
    return { type: 'if', conds, else: elseBody, redirs: this.parseRedirs() };
  }

  parseFor(): Node {
    this.p++; // for
    const t = this.peek();
    if (t && t.k === 'arith') {
      this.p++;
      const parts = splitSemi(t.expr);
      this.skipSeps();
      this.expectWord('do');
      const body = this.parseList();
      this.expectWord('done');
      return {
        type: 'cfor',
        init: parts[0] ?? '',
        cond: parts[1] ?? '',
        step: parts[2] ?? '',
        body,
        redirs: this.parseRedirs(),
      };
    }
    if (!t) throw new ParseError('falta variable', true);
    if (t.k !== 'word') throw new ParseError(`syntax error near unexpected token \`${tokText(t)}'`);
    const name = t.raw;
    this.p++;
    let words: Word[] | null = null;
    this.skipNl();
    if (this.isWord('in')) {
      this.p++;
      words = [];
      for (;;) {
        const w = this.peek();
        if (w && w.k === 'word' && !(w.raw === 'do' && !w.quoted)) {
          words.push(w.w);
          this.p++;
        } else break;
      }
    }
    this.skipSeps();
    this.expectWord('do');
    const body = this.parseList();
    this.expectWord('done');
    return { type: 'for', name, words, body, redirs: this.parseRedirs() };
  }

  parseWhile(until: boolean): Node {
    this.p++;
    const cond = this.parseList();
    this.expectWord('do');
    const body = this.parseList();
    this.expectWord('done');
    return { type: 'while', cond, body, until, redirs: this.parseRedirs() };
  }

  parseCase(): Node {
    this.p++; // case
    const w = this.peek();
    if (!w) throw new ParseError('falta palabra', true);
    if (w.k !== 'word') throw new ParseError(`syntax error near unexpected token \`${tokText(w)}'`);
    this.p++;
    this.skipNl();
    this.expectWord('in');
    this.skipSeps();
    const clauses: { patterns: Word[]; body: Node }[] = [];
    while (!this.isWord('esac')) {
      if (this.eof()) throw new ParseError('falta esac', true);
      if (this.isOp('(')) this.p++;
      const patterns: Word[] = [];
      for (;;) {
        const pt = this.peek();
        if (!pt || pt.k !== 'word') throw new ParseError('patrón esperado', this.eof());
        patterns.push(pt.w);
        this.p++;
        if (this.isOp('|')) this.p++;
        else break;
      }
      if (!this.isOp(')')) throw new ParseError("falta ')' en case", this.eof());
      this.p++;
      const body = this.parseList();
      clauses.push({ patterns, body });
      if (this.isOp(';;')) this.p++;
      this.skipSeps();
    }
    this.expectWord('esac');
    return { type: 'case', word: w.w, clauses, redirs: this.parseRedirs() };
  }

  parseFunction(): Node {
    this.p++; // function
    const t = this.peek();
    if (!t || t.k !== 'word') throw new ParseError('nombre de función esperado', true);
    this.p++;
    if (this.isOp('(')) {
      this.p++;
      if (!this.isOp(')')) throw new ParseError("falta ')'");
      this.p++;
    }
    this.skipNl();
    const body = this.parseCommand();
    return { type: 'func', name: t.raw, body };
  }

  parseDbracket(): Node {
    this.p++; // [[
    const words: Word[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) throw new ParseError("falta ']]'", true);
      if (t.k === 'word' && !t.quoted && t.raw === ']]') {
        this.p++;
        break;
      }
      if (t.k === 'word') words.push(t.w);
      else if (t.k === 'op') words.push([{ t: 'lit', s: t.v }]);
      else if (t.k === 'nl') {
        /* ignorar */
      }
      this.p++;
    }
    return { type: 'dbracket', words, redirs: this.parseRedirs() };
  }
}

function splitSemi(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ';' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function tokText(t: Token): string {
  if (t.k === 'word') return t.raw;
  if (t.k === 'op') return t.v;
  if (t.k === 'nl') return 'newline';
  if (t.k === 'io') return String(t.n);
  return '((';
}

/** ¿La palabra es NOMBRE=valor o NOMBRE+=valor? */
function asAssignment(w: Word): Assign | null {
  const first = w[0];
  if (!first || first.t !== 'lit') return null;
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(\+?)=/.exec(first.s);
  if (!m) return null;
  const rest: Word = [];
  const afterEq = first.s.slice(m[0].length);
  if (afterEq) rest.push({ t: 'lit', s: afterEq });
  for (let i = 1; i < w.length; i++) rest.push(w[i]);
  // ~ al principio del valor
  if (rest[0] && rest[0].t === 'lit' && rest[0].s.startsWith('~')) {
    const m2 = /^~([A-Za-z0-9_.-]*)/.exec(rest[0].s)!;
    const tail = rest[0].s.slice(m2[0].length);
    if (tail === '' || tail.startsWith('/')) {
      const repl: Word = [{ t: 'tilde', user: m2[1] }];
      if (tail) repl.push({ t: 'lit', s: tail });
      rest.splice(0, 1, ...repl);
    }
  }
  return { name: m[1], sub: m[2] ?? null, value: rest, append: m[3] === '+' };
}

export function parse(src: string): Node {
  const toks = new Lexer(src).run();
  const parser = new Parser(toks, src);
  return parser.parseProgram();
}

/** ¿Falta más entrada (comilla abierta, if sin fi, etc.)? */
export function isIncomplete(src: string): boolean {
  try {
    parse(src);
    return false;
  } catch (e) {
    return e instanceof ParseError && e.incomplete;
  }
}

/** Lex solo palabras (para el parser de alias y completado). */
export function wordToString(w: Word): string {
  return w
    .map((p) => {
      if (p.t === 'lit' || p.t === 'sq') return p.s;
      if (p.t === 'dq') return p.parts.map((q) => (q.t === 'lit' ? q.s : '')).join('');
      return '';
    })
    .join('');
}
