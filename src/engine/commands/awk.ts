/** awk: intérprete de un subconjunto amplio de AWK (POSIX + algunas extensiones GNU). */
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { makeRegex } from '../regex';
import { formatPrintf, readInputs } from './util';

// ───────────────────────── valores ─────────────────────────

class StrNum {
  constructor(public s: string) {}
}
type Val = number | string | StrNum;

const looksNumeric = (s: string) => /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s);

function toNum(v: Val): number {
  if (typeof v === 'number') return v;
  const s = typeof v === 'string' ? v : v.s;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(s);
  if (m) return parseFloat(m[1]);
  const h = /^\s*([-+]?)0[xX][0-9a-fA-F]+/.test(s);
  void h;
  return 0;
}

function numToStr(n: number, fmt = '%.6g'): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n);
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : n < 0 ? '-inf' : 'nan';
  void fmt;
  let s = Number(n.toPrecision(6)).toString();
  if (/e/.test(s)) s = s.replace(/e([+-])(\d)$/, 'e$10$2');
  return s;
}

function toStr(v: Val): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numToStr(v);
  return v.s;
}

function isNumericVal(v: Val): boolean {
  return typeof v === 'number' || (v instanceof StrNum && looksNumeric(v.s));
}

function toBool(v: Val): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return looksNumeric(v.s) ? parseFloat(v.s) !== 0 : v.s !== '';
}

// ───────────────────────── lexer ─────────────────────────

type Tok = { t: string; v?: string; nl?: boolean; pos: number };

const KEYWORDS = new Set(['BEGIN', 'END', 'function', 'func', 'if', 'else', 'while', 'for', 'do', 'break', 'continue', 'next', 'exit', 'return', 'delete', 'in', 'getline', 'print', 'printf']);
const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt', 'int', 'rand', 'srand', 'tolower', 'toupper', 'system', 'close', 'fflush']);

class AwkError extends Error {}

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const canRegex = () => {
    const last = toks[toks.length - 1];
    if (!last) return true;
    return ['(', ',', '{', '}', ';', 'nl', '!', '&&', '||', '~', '!~', '==', '!=', '<', '>', '<=', '>=', '+', '-', '*', '%', '?', ':', '=', '+=', '-=', '*=', '/=', '%=', '^=', 'kw'].includes(last.t) && !(last.t === 'kw' && !['print', 'printf', 'return', 'in'].includes(last.v!));
  };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '\n') { toks.push({ t: 'nl', pos: i }); i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const w = m[0];
      i += w.length;
      if (KEYWORDS.has(w)) toks.push({ t: 'kw', v: w === 'func' ? 'function' : w, pos: i });
      else if (BUILTINS.has(w)) toks.push({ t: 'builtin', v: w, pos: i });
      else if (src[i] === '(') toks.push({ t: 'funcname', v: w, pos: i });
      else toks.push({ t: 'id', v: w, pos: i });
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          const n = src[++i];
          switch (n) {
            case 'n': s += '\n'; break;
            case 't': s += '\t'; break;
            case 'r': s += '\r'; break;
            case '\\': s += '\\'; break;
            case '"': s += '"'; break;
            case '/': s += '/'; break;
            case 'a': s += '\x07'; break;
            case '\n': break;
            default:
              if (/[0-7]/.test(n)) {
                let o = n;
                while (o.length < 3 && /[0-7]/.test(src[i + 1] ?? '')) o += src[++i];
                s += String.fromCharCode(parseInt(o, 8));
              } else s += '\\' + n;
          }
          i++;
        } else s += src[i++];
      }
      if (i >= src.length) throw new AwkError('non-terminated string');
      i++;
      toks.push({ t: 'str', v: s, pos: i });
      continue;
    }
    if (c === '/' && canRegex()) {
      let s = '';
      i++;
      let inBr = false;
      while (i < src.length && (src[i] !== '/' || inBr)) {
        if (src[i] === '\n') throw new AwkError('non-terminated regular expression');
        if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; continue; }
        if (src[i] === '\\') { s += src[i] + src[i + 1]; i += 2; continue; }
        if (src[i] === '[') inBr = true;
        if (src[i] === ']') inBr = false;
        s += src[i++];
      }
      i++;
      toks.push({ t: 'regex', v: s, pos: i });
      continue;
    }
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (['**='].includes(three)) { toks.push({ t: '^=', pos: i }); i += 3; continue; }
    if (two === '**') { toks.push({ t: '^', pos: i }); i += 2; continue; }
    if (['&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '++', '--', '!~', '>>'].includes(two)) {
      toks.push({ t: two, pos: i });
      i += 2;
      continue;
    }
    toks.push({ t: c, pos: i });
    i++;
  }
  toks.push({ t: 'eof', pos: i });
  return toks;
}

// ───────────────────────── AST ─────────────────────────

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'regex'; re: RegExp }
  | { k: 'var'; name: string }
  | { k: 'field'; e: Expr }
  | { k: 'index'; name: string; subs: Expr[] }
  | { k: 'assign'; op: string; target: Expr; e: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'bin'; op: string; a: Expr; b: Expr }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'incdec'; op: '++' | '--'; prefix: boolean; target: Expr }
  | { k: 'match'; neg: boolean; a: Expr; re: Expr }
  | { k: 'in'; subs: Expr[]; name: string }
  | { k: 'concat'; a: Expr; b: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'builtin'; name: string; args: Expr[] }
  | { k: 'getline'; target: Expr | null; file: Expr | null }
  | { k: 'group'; e: Expr };

type Stmt =
  | { k: 'expr'; e: Expr }
  | { k: 'print'; args: Expr[]; redir: { op: string; target: Expr } | null }
  | { k: 'printf'; args: Expr[]; redir: { op: string; target: Expr } | null }
  | { k: 'if'; c: Expr; a: Stmt; b: Stmt | null }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'for'; init: Stmt | null; c: Expr | null; step: Stmt | null; body: Stmt }
  | { k: 'forin'; v: string; arr: string; body: Stmt }
  | { k: 'block'; body: Stmt[] }
  | { k: 'next' }
  | { k: 'exit'; e: Expr | null }
  | { k: 'return'; e: Expr | null }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'delete'; name: string; subs: Expr[] | null };

interface Rule {
  kind: 'begin' | 'end' | 'main';
  pattern: Expr | null;
  pattern2: Expr | null;
  body: Stmt | null;
  inRange?: boolean;
}

interface Program {
  rules: Rule[];
  funcs: Map<string, { params: string[]; body: Stmt }>;
}

// ───────────────────────── parser ─────────────────────────

function parseProgram(src: string): Program {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const is = (t: string, v?: string) => toks[p].t === t && (v === undefined || toks[p].v === v);
  const isKw = (v: string) => toks[p].t === 'kw' && toks[p].v === v;
  const skipNl = () => { while (toks[p].t === 'nl' || toks[p].t === ';') p++; };
  const skipOnlyNl = () => { while (toks[p].t === 'nl') p++; };
  const expect = (t: string) => {
    if (toks[p].t !== t) throw new AwkError(`syntax error at source line 1: expected ${t} near ${toks[p].t}${toks[p].v ? ' ' + toks[p].v : ''}`);
    return toks[p++];
  };
  const prog: Program = { rules: [], funcs: new Map() };

  // ── expresiones ──
  let noIn = 0;
  let noGt = 0;

  function parseExpr(): Expr { return parseTernary(); }

  function parseTernary(): Expr {
    const c = parseOr();
    if (is('?')) {
      p++;
      skipOnlyNl();
      const a = parseTernary();
      skipOnlyNl();
      expect(':');
      skipOnlyNl();
      const b = parseTernary();
      return { k: 'cond', c, a, b };
    }
    // asignación (derecha-asociativa) sobre lvalue
    if (['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(peek().t) && isLvalue(c)) {
      const op = next().t;
      skipOnlyNl();
      const e = parseTernary();
      return { k: 'assign', op, target: c, e };
    }
    return c;
  }
  function isLvalue(e: Expr) { return e.k === 'var' || e.k === 'field' || e.k === 'index'; }

  function parseOr(): Expr {
    let l = parseAnd();
    while (is('||')) { p++; skipOnlyNl(); l = { k: 'bin', op: '||', a: l, b: parseAnd() }; }
    return l;
  }
  function parseAnd(): Expr {
    let l = parseIn();
    while (is('&&')) { p++; skipOnlyNl(); l = { k: 'bin', op: '&&', a: l, b: parseIn() }; }
    return l;
  }
  function parseIn(): Expr {
    let l = parseMatch();
    while (isKw('in') && !noIn) {
      p++;
      const name = expect('id').v!;
      l = { k: 'in', subs: l.k === 'group' && false ? [] : [l], name };
    }
    return l;
  }
  function parseMatch(): Expr {
    let l = parseCmp();
    while (is('~') || is('!~')) {
      const neg = next().t === '!~';
      const r = parseCmp();
      l = { k: 'match', neg, a: l, re: r };
    }
    return l;
  }
  function parseCmp(): Expr {
    let l = parseConcat();
    for (;;) {
      const t = peek().t;
      if (['<', '<=', '==', '!=', '>='].includes(t) || (t === '>' && !noGt)) {
        p++;
        l = { k: 'bin', op: t, a: l, b: parseConcat() };
      } else break;
    }
    return l;
  }
  const startsOperand = () => {
    const t = peek();
    if (['num', 'str', 'regex', 'id', 'funcname', 'builtin', '$', '(', '!', '-', '+', '++', '--'].includes(t.t)) {
      return !(t.t === 'regex') ;
    }
    return false;
  };
  function parseConcat(): Expr {
    let l = parseAdd();
    for (;;) {
      const t = peek();
      if (['num', 'str', 'id', 'funcname', 'builtin', '$', '(', '!', '++', '--'].includes(t.t) || (t.t === '-' && false) || (t.t === 'kw' && t.v === 'getline' && false)) {
        if (t.t === '(' && l.k === 'var' && false) break;
        l = { k: 'concat', a: l, b: parseAdd() };
      } else if ((t.t === '-' || t.t === '+') && false) {
        break;
      } else break;
    }
    void startsOperand;
    return l;
  }
  function parseAdd(): Expr {
    let l = parseMul();
    while (is('+') || is('-')) { const op = next().t; l = { k: 'bin', op, a: l, b: parseMul() }; }
    return l;
  }
  function parseMul(): Expr {
    let l = parseUnary();
    while (is('*') || is('/') || is('%')) { const op = next().t; l = { k: 'bin', op, a: l, b: parseUnary() }; }
    return l;
  }
  function parseUnary(): Expr {
    if (is('!')) { p++; return { k: 'un', op: '!', e: parseUnary() }; }
    if (is('-')) { p++; return { k: 'un', op: '-', e: parseUnary() }; }
    if (is('+')) { p++; return { k: 'un', op: '+', e: parseUnary() }; }
    return parsePow();
  }
  function parsePow(): Expr {
    const base = parsePostfix();
    if (is('^')) { p++; return { k: 'bin', op: '^', a: base, b: parseUnaryPow() }; }
    return base;
  }
  function parseUnaryPow(): Expr {
    if (is('-')) { p++; return { k: 'un', op: '-', e: parseUnaryPow() }; }
    if (is('+')) { p++; return parseUnaryPow(); }
    return parsePow();
  }
  function parsePostfix(): Expr {
    if (is('++') || is('--')) {
      const op = next().t as '++' | '--';
      const target = parsePostfix();
      return { k: 'incdec', op, prefix: true, target };
    }
    const e = parsePrimary();
    if ((is('++') || is('--')) && isLvalue(e)) {
      const op = next().t as '++' | '--';
      return { k: 'incdec', op, prefix: false, target: e };
    }
    return e;
  }
  function parsePrimary(): Expr {
    const t = next();
    switch (t.t) {
      case 'num': return { k: 'num', v: t.v!.startsWith('0x') || t.v!.startsWith('0X') ? parseInt(t.v!, 16) : parseFloat(t.v!) };
      case 'str': return { k: 'str', v: t.v! };
      case 'regex': return { k: 'regex', re: makeRegex(t.v!, { extended: true }) };
      case '$': {
        const e = parseIncDecOperand();
        return { k: 'field', e };
      }
      case '(': {
        const save = noIn; const saveGt = noGt;
        noIn = 0; noGt = 0;
        const e = parseExpr();
        // (i,j) in arr
        if (is(',')) {
          const subs = [e];
          while (is(',')) { p++; subs.push(parseExpr()); }
          expect(')');
          noIn = save; noGt = saveGt;
          if (!isKw('in')) throw new AwkError('syntax error: expected in');
          p++;
          const name = expect('id').v!;
          return { k: 'in', subs, name };
        }
        expect(')');
        noIn = save; noGt = saveGt;
        return { k: 'group', e };
      }
      case 'id': {
        if (is('[')) {
          p++;
          const subs = [parseExpr()];
          while (is(',')) { p++; subs.push(parseExpr()); }
          expect(']');
          return { k: 'index', name: t.v!, subs };
        }
        return { k: 'var', name: t.v! };
      }
      case 'funcname': {
        expect('(');
        const args: Expr[] = [];
        skipOnlyNl();
        if (!is(')')) {
          args.push(parseExpr());
          while (is(',')) { p++; skipOnlyNl(); args.push(parseExpr()); }
        }
        expect(')');
        return { k: 'call', name: t.v!, args };
      }
      case 'builtin': {
        const args: Expr[] = [];
        if (is('(')) {
          p++;
          skipOnlyNl();
          if (!is(')')) {
            const save = noIn; noIn = 0;
            args.push(parseExpr());
            while (is(',')) { p++; skipOnlyNl(); args.push(parseExpr()); }
            noIn = save;
          }
          expect(')');
        } else if (t.v !== 'length') throw new AwkError('syntax error: ( expected after ' + t.v);
        return { k: 'builtin', name: t.v!, args };
      }
      case 'kw': {
        if (t.v === 'getline') {
          let target: Expr | null = null;
          if (is('id') || is('$')) target = parsePostfix();
          let file: Expr | null = null;
          if (is('<')) { p++; file = parsePrimary(); }
          return { k: 'getline', target, file };
        }
        break;
      }
      case '-': return { k: 'un', op: '-', e: parseUnary() };
      case '+': return { k: 'un', op: '+', e: parseUnary() };
      case '!': return { k: 'un', op: '!', e: parseUnary() };
    }
    throw new AwkError(`syntax error at source line 1 near ${t.t}${t.v ? ' ' + t.v : ''}`);
  }
  function parseIncDecOperand(): Expr {
    if (is('++') || is('--')) return parsePostfix();
    if (is('-')) { p++; return { k: 'un', op: '-', e: parseIncDecOperand() }; }
    return parsePrimary();
  }

  // ── sentencias ──
  function endOfSimple() {
    if (is(';') || is('nl')) { p++; return; }
    if (is('}') || is('eof')) return;
    throw new AwkError(`syntax error at source line 1 near ${peek().t}${peek().v ? ' ' + peek().v : ''}`);
  }

  function parseSimple(): Stmt {
    if (isKw('print') || isKw('printf')) {
      const isPrintf = next().v === 'printf';
      let args: Expr[] = [];
      let parsedParens = false;
      if (is('(')) {
        // print (a, b) > "f"   |   printf("%s\n", x)
        const save = p;
        const saveGt = noGt;
        noGt = 0;
        try {
          p++;
          const list: Expr[] = [];
          skipOnlyNl();
          if (!is(')')) {
            list.push(parseExpr());
            while (is(',')) { p++; skipOnlyNl(); list.push(parseExpr()); }
          }
          expect(')');
          if (is(';') || is('nl') || is('}') || is('>') || is('>>') || is('|') || is('eof')) {
            args = list;
            parsedParens = true;
          } else p = save;
        } catch {
          p = save;
        }
        noGt = saveGt;
      }
      if (!parsedParens) {
        noGt++;
        if (!(is(';') || is('nl') || is('}') || is('>') || is('>>') || is('|'))) {
          args.push(parseExpr());
          while (is(',')) { p++; skipOnlyNl(); args.push(parseExpr()); }
        }
        noGt--;
      }
      const a = args;
      let redir: { op: string; target: Expr } | null = null;
      if (is('>') || is('>>')) {
        const op = next().t;
        redir = { op, target: parseConcat() };
      }
      return isPrintf ? { k: 'printf', args: a, redir } : { k: 'print', args: a, redir };
    }
    if (isKw('delete')) {
      p++;
      const name = expect('id').v!;
      if (is('[')) {
        p++;
        const subs = [parseExpr()];
        while (is(',')) { p++; subs.push(parseExpr()); }
        expect(']');
        return { k: 'delete', name, subs };
      }
      return { k: 'delete', name, subs: null };
    }
    if (isKw('next')) { p++; return { k: 'next' }; }
    if (isKw('break')) { p++; return { k: 'break' }; }
    if (isKw('continue')) { p++; return { k: 'continue' }; }
    if (isKw('exit')) {
      p++;
      return { k: 'exit', e: is(';') || is('nl') || is('}') || is('eof') ? null : parseExpr() };
    }
    if (isKw('return')) {
      p++;
      return { k: 'return', e: is(';') || is('nl') || is('}') ? null : parseExpr() };
    }
    return { k: 'expr', e: parseExpr() };
  }

  function parseStmt(): Stmt {
    skipNl();
    if (is('{')) return parseBlock();
    if (isKw('if')) {
      p++;
      expect('(');
      const c = parseExpr();
      expect(')');
      skipOnlyNl();
      const a = parseStmt();
      const save = p;
      skipNl();
      if (isKw('else')) {
        p++;
        skipOnlyNl();
        return { k: 'if', c, a, b: parseStmt() };
      }
      p = save;
      return { k: 'if', c, a, b: null };
    }
    if (isKw('while')) {
      p++;
      expect('(');
      const c = parseExpr();
      expect(')');
      if (is(';')) { p++; return { k: 'while', c, body: { k: 'block', body: [] } }; }
      skipOnlyNl();
      return { k: 'while', c, body: parseStmt() };
    }
    if (isKw('do')) {
      p++;
      skipOnlyNl();
      const body = parseStmt();
      skipNl();
      if (!isKw('while')) throw new AwkError('syntax error: expected while');
      p++;
      expect('(');
      const c = parseExpr();
      expect(')');
      endOfSimple();
      return { k: 'do', body, c };
    }
    if (isKw('for')) {
      p++;
      expect('(');
      // for (k in arr)
      if (is('id') && toks[p + 1].t === 'kw' && toks[p + 1].v === 'in' && toks[p + 2].t === 'id' && toks[p + 3].t === ')') {
        const v = next().v!;
        p++;
        const arr = next().v!;
        p++;
        skipOnlyNl();
        return { k: 'forin', v, arr, body: parseStmt() };
      }
      let init: Stmt | null = null;
      if (!is(';')) init = parseSimple();
      expect(';');
      skipOnlyNl();
      let c: Expr | null = null;
      if (!is(';')) c = parseExpr();
      expect(';');
      skipOnlyNl();
      let step: Stmt | null = null;
      if (!is(')')) step = parseSimple();
      expect(')');
      if (is(';')) { p++; return { k: 'for', init, c, step, body: { k: 'block', body: [] } }; }
      skipOnlyNl();
      return { k: 'for', init, c, step, body: parseStmt() };
    }
    const s = parseSimple();
    endOfSimple();
    return s;
  }

  function parseBlock(): Stmt {
    expect('{');
    const body: Stmt[] = [];
    skipNl();
    while (!is('}')) {
      if (is('eof')) throw new AwkError('syntax error: unexpected end of program, missing }');
      body.push(parseStmt());
      skipNl();
    }
    expect('}');
    return { k: 'block', body };
  }

  skipNl();
  while (!is('eof')) {
    if (isKw('function')) {
      p++;
      const name = (is('funcname') || is('id') ? next() : null)?.v;
      if (!name) throw new AwkError('syntax error: function name expected');
      expect('(');
      const params: string[] = [];
      while (!is(')')) {
        params.push(expect('id').v!);
        if (is(',')) p++;
        skipOnlyNl();
      }
      expect(')');
      skipOnlyNl();
      prog.funcs.set(name, { params, body: parseBlock() });
    } else if (isKw('BEGIN')) {
      p++;
      skipOnlyNl();
      prog.rules.push({ kind: 'begin', pattern: null, pattern2: null, body: parseBlock() });
    } else if (isKw('END')) {
      p++;
      skipOnlyNl();
      prog.rules.push({ kind: 'end', pattern: null, pattern2: null, body: parseBlock() });
    } else {
      let pattern: Expr | null = null;
      let pattern2: Expr | null = null;
      if (!is('{')) {
        pattern = parseExpr();
        if (is(',')) { p++; skipOnlyNl(); pattern2 = parseExpr(); }
      }
      let body: Stmt | null = null;
      if (is('{')) body = parseBlock();
      prog.rules.push({ kind: 'main', pattern, pattern2, body });
    }
    skipNl();
  }
  return prog;
}

// ───────────────────────── intérprete ─────────────────────────

class NextEx {}
class ExitEx { constructor(public code: number) {} }
class BreakEx {}
class ContinueEx {}
class ReturnEx { constructor(public v: Val) {} }

type Arr = Map<string, Val>;

class Interp {
  vars = new Map<string, Val>();
  arrays = new Map<string, Arr>();
  fields: string[] = [];
  record = '';
  nf = 0;
  frames: Map<string, Val | Arr>[] = [];
  out: string[] = [];
  files = new Map<string, string>();
  reCache = new Map<string, RegExp>();
  records: string[] = [];
  recIdx = 0;
  randSeed = 1;
  exited = false;

  constructor(public c: Ctx, public prog: Program) {
    for (const [k, v] of Object.entries({ FS: ' ', OFS: ' ', ORS: '\n', RS: '\n', NR: 0, NF: 0, FNR: 0, FILENAME: '', SUBSEP: '\x1c', RSTART: 0, RLENGTH: -1, CONVFMT: '%.6g', OFMT: '%.6g' }))
      this.vars.set(k, v as Val);
    const env: Arr = new Map();
    for (const [k, v] of c.sh.exportedEnv()) env.set(k, new StrNum(v));
    this.arrays.set('ENVIRON', env);
  }

  fs() { return toStr(this.vars.get('FS') ?? ' '); }

  setRecord(line: string) {
    this.record = line;
    this.splitRecord();
  }

  splitRecord() {
    const fs = this.fs();
    let parts: string[];
    if (this.record === '') parts = [];
    else if (fs === ' ') parts = this.record.split(/[ \t\n]+/).filter((x) => x !== '');
    else if (fs === '\t' || (fs.length === 1 && fs !== '\\')) parts = this.record.split(fs);
    else parts = this.record.split(this.regex(fs));
    this.fields = parts;
    this.nf = parts.length;
    this.vars.set('NF', this.nf);
  }

  rebuildRecord() {
    this.record = this.fields.join(toStr(this.vars.get('OFS') ?? ' '));
  }

  getField(n: number): Val {
    if (n === 0) return new StrNum(this.record);
    if (n < 0) throw new AwkError(`attempt to access field ${n}`);
    return new StrNum(this.fields[n - 1] ?? '');
  }

  setField(n: number, v: string) {
    if (n === 0) {
      this.setRecord(v);
      return;
    }
    while (this.fields.length < n) this.fields.push('');
    this.fields[n - 1] = v;
    this.nf = this.fields.length;
    this.vars.set('NF', this.nf);
    this.rebuildRecord();
  }

  regex(src: string): RegExp {
    let re = this.reCache.get(src);
    if (!re) {
      re = makeRegex(src, { extended: true });
      this.reCache.set(src, re);
    }
    return re;
  }

  arrayOf(name: string): Arr {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.has(name)) {
        const v = f.get(name);
        if (v instanceof Map) return v;
        const a: Arr = new Map();
        f.set(name, a);
        return a;
      }
    }
    let a = this.arrays.get(name);
    if (!a) {
      a = new Map();
      this.arrays.set(name, a);
    }
    return a;
  }

  getVar(name: string): Val {
    if (name === 'NF') return this.nf;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.has(name)) {
        const v = f.get(name)!;
        return v instanceof Map ? '' : v;
      }
    }
    return this.vars.get(name) ?? new StrNum('');
  }

  setVar(name: string, v: Val) {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.has(name)) {
        f.set(name, v);
        return;
      }
    }
    if (name === 'NF') {
      const n = Math.max(0, Math.trunc(toNum(v)));
      while (this.fields.length < n) this.fields.push('');
      this.fields.length = n;
      this.nf = n;
      this.vars.set('NF', n);
      this.rebuildRecord();
      return;
    }
    this.vars.set(name, v);
    if (name === 'FS') this.reCache.clear();
  }

  subKey(subs: Val[]): string {
    return subs.map(toStr).join(toStr(this.vars.get('SUBSEP') ?? '\x1c'));
  }

  compare(a: Val, b: Val): number {
    if (isNumericVal(a) && isNumericVal(b)) {
      const x = toNum(a), y = toNum(b);
      return x < y ? -1 : x > y ? 1 : 0;
    }
    const x = toStr(a), y = toStr(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  evalRegexArg(e: Expr): RegExp {
    if (e.k === 'regex') return e.re;
    return this.regex(toStr(this.eval(e)));
  }

  assignTo(target: Expr, v: Val) {
    switch (target.k) {
      case 'var': this.setVar(target.name, v); break;
      case 'field': this.setField(Math.trunc(toNum(this.eval(target.e))), toStr(v)); break;
      case 'index': this.arrayOf(target.name).set(this.subKey(target.subs.map((s) => this.eval(s))), v); break;
      default: throw new AwkError('invalid assignment target');
    }
  }

  eval(e: Expr): Val {
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'regex': return e.re.test(this.record) ? 1 : 0;
      case 'group': return this.eval(e.e);
      case 'var': return this.getVar(e.name);
      case 'field': return this.getField(Math.trunc(toNum(this.eval(e.e))));
      case 'index': {
        const a = this.arrayOf(e.name);
        const key = this.subKey(e.subs.map((s) => this.eval(s)));
        if (!a.has(key)) a.set(key, new StrNum(''));
        return a.get(key)!;
      }
      case 'assign': {
        let v: Val;
        if (e.op === '=') v = this.eval(e.e);
        else {
          const cur = toNum(this.eval(e.target));
          const r = toNum(this.eval(e.e));
          switch (e.op) {
            case '+=': v = cur + r; break;
            case '-=': v = cur - r; break;
            case '*=': v = cur * r; break;
            case '/=': if (r === 0) throw new AwkError('division by zero in /='); v = cur / r; break;
            case '%=': if (r === 0) throw new AwkError('division by zero in %='); v = cur % r; break;
            default: v = Math.pow(cur, r);
          }
        }
        if (v instanceof StrNum && e.target.k !== 'field') v = new StrNum(v.s);
        this.assignTo(e.target, v);
        return v;
      }
      case 'cond': return toBool(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case 'bin': return this.evalBin(e);
      case 'un': {
        const v = this.eval(e.e);
        if (e.op === '!') return toBool(v) ? 0 : 1;
        if (e.op === '-') return -toNum(v);
        return toNum(v);
      }
      case 'incdec': {
        const old = toNum(this.eval(e.target));
        const nv = old + (e.op === '++' ? 1 : -1);
        this.assignTo(e.target, nv);
        return e.prefix ? nv : old;
      }
      case 'match': {
        const s = toStr(this.eval(e.a));
        const re = this.evalRegexArg(e.re);
        const r = re.test(s);
        return (e.neg ? !r : r) ? 1 : 0;
      }
      case 'in': return this.arrayOf(e.name).has(this.subKey(e.subs.map((s) => this.eval(s)))) ? 1 : 0;
      case 'concat': return toStr(this.eval(e.a)) + toStr(this.eval(e.b));
      case 'call': return this.callUser(e.name, e.args);
      case 'builtin': return this.callBuiltin(e.name, e.args);
      case 'getline': return this.doGetline(e);
    }
  }

  doGetline(e: Extract<Expr, { k: 'getline' }>): Val {
    if (e.file) {
      const name = toStr(this.eval(e.file));
      let text = this.files.get('<' + name);
      if (text === undefined) {
        try {
          text = this.c.fs.readFile(this.c.abs(name), this.c.cred);
        } catch {
          return -1;
        }
        this.files.set('<' + name, text);
      }
      const lines = text.split('\n');
      const pos = parseInt(this.files.get('#' + name) ?? '0', 10);
      if (pos >= lines.length - (text.endsWith('\n') ? 1 : 0)) return 0;
      this.files.set('#' + name, String(pos + 1));
      if (e.target) this.assignTo(e.target, new StrNum(lines[pos]));
      else this.setRecord(lines[pos]);
      return 1;
    }
    if (this.recIdx >= this.records.length) return 0;
    const line = this.records[this.recIdx++];
    this.vars.set('NR', toNum(this.getVar('NR')) + 1);
    if (e.target) this.assignTo(e.target, new StrNum(line));
    else this.setRecord(line);
    return 1;
  }

  evalBin(e: Extract<Expr, { k: 'bin' }>): Val {
    if (e.op === '&&') return toBool(this.eval(e.a)) && toBool(this.eval(e.b)) ? 1 : 0;
    if (e.op === '||') return toBool(this.eval(e.a)) || toBool(this.eval(e.b)) ? 1 : 0;
    const a = this.eval(e.a);
    const b = this.eval(e.b);
    switch (e.op) {
      case '+': return toNum(a) + toNum(b);
      case '-': return toNum(a) - toNum(b);
      case '*': return toNum(a) * toNum(b);
      case '/': { const d = toNum(b); if (d === 0) throw new AwkError('division by zero'); return toNum(a) / d; }
      case '%': { const d = toNum(b); if (d === 0) throw new AwkError('division by zero in %'); return toNum(a) % d; }
      case '^': return Math.pow(toNum(a), toNum(b));
      case '<': return this.compare(a, b) < 0 ? 1 : 0;
      case '<=': return this.compare(a, b) <= 0 ? 1 : 0;
      case '>': return this.compare(a, b) > 0 ? 1 : 0;
      case '>=': return this.compare(a, b) >= 0 ? 1 : 0;
      case '==': return this.compare(a, b) === 0 ? 1 : 0;
      case '!=': return this.compare(a, b) !== 0 ? 1 : 0;
    }
    return 0;
  }

  callUser(name: string, args: Expr[]): Val {
    const fn = this.prog.funcs.get(name);
    if (!fn) throw new AwkError(`calling undefined function ${name}`);
    const frame = new Map<string, Val | Arr>();
    fn.params.forEach((p, i) => {
      const a = args[i];
      if (a === undefined) frame.set(p, new StrNum(''));
      else if (a.k === 'var' && (this.arrays.has(a.name) || this.isArrayLocal(a.name))) frame.set(p, this.arrayOf(a.name));
      else frame.set(p, this.eval(a));
    });
    if (this.frames.length > 200) throw new AwkError('function call nesting too deep');
    this.frames.push(frame);
    try {
      this.exec(fn.body);
    } catch (e) {
      if (e instanceof ReturnEx) return e.v;
      throw e;
    } finally {
      this.frames.pop();
    }
    return new StrNum('');
  }

  isArrayLocal(name: string) {
    for (let i = this.frames.length - 1; i >= 0; i--) if (this.frames[i].get(name) instanceof Map) return true;
    return false;
  }

  callBuiltin(name: string, args: Expr[]): Val {
    const sv = (i: number) => toStr(this.eval(args[i]));
    const nv = (i: number) => toNum(this.eval(args[i]));
    switch (name) {
      case 'length': {
        if (args.length === 0) return this.record.length;
        if (args[0].k === 'var' && (this.arrays.has(args[0].name) || this.isArrayLocal(args[0].name))) return this.arrayOf(args[0].name).size;
        return [...sv(0)].length;
      }
      case 'substr': {
        const s = sv(0);
        let start = Math.round(nv(1));
        let len = args.length > 2 ? Math.round(nv(2)) : Infinity;
        if (start < 1) { len = len === Infinity ? len : len + start - 1; start = 1; }
        if (len <= 0) return '';
        return s.substr(start - 1, len === Infinity ? undefined : len);
      }
      case 'index': return sv(0).indexOf(sv(1)) + 1;
      case 'split': {
        const s = sv(0);
        const target = args[1];
        if (target.k !== 'var') throw new AwkError('split: second argument must be an array');
        const arr = this.arrayOf(target.name);
        arr.clear();
        let parts: string[];
        const sep = args.length > 2 ? (args[2].k === 'regex' ? args[2].re : toStr(this.eval(args[2]))) : this.fs();
        if (s === '') parts = [];
        else if (sep === ' ') parts = s.split(/[ \t\n]+/).filter((x) => x !== '');
        else if (sep instanceof RegExp) parts = s.split(sep);
        else if (sep.length === 1) parts = s.split(sep);
        else parts = s.split(this.regex(sep));
        parts.forEach((p, i) => arr.set(String(i + 1), new StrNum(p)));
        return parts.length;
      }
      case 'sub': case 'gsub': {
        const re0 = this.evalRegexArg(args[0]);
        const re = new RegExp(re0.source, re0.flags.replace('g', '') + (name === 'gsub' ? 'g' : ''));
        const repl = sv(1);
        const targetExpr: Expr = args[2] ?? { k: 'field', e: { k: 'num', v: 0 } };
        const cur = toStr(this.eval(targetExpr));
        let count = 0;
        const res = cur.replace(re, (m, ...rest) => {
          count++;
          let out = '';
          for (let i = 0; i < repl.length; i++) {
            if (repl[i] === '\\' && repl[i + 1] === '&') { out += '&'; i++; }
            else if (repl[i] === '\\' && repl[i + 1] === '\\') { out += '\\'; i++; }
            else if (repl[i] === '&') out += m;
            else out += repl[i];
          }
          void rest;
          return out;
        });
        if (count > 0) this.assignTo(targetExpr, res);
        return count;
      }
      case 'match': {
        const s = sv(0);
        const re = this.evalRegexArg(args[1]);
        const m = re.exec(s);
        if (m) {
          this.vars.set('RSTART', m.index + 1);
          this.vars.set('RLENGTH', m[0].length);
          if (args[2] && args[2].k === 'var') {
            const arr = this.arrayOf(args[2].name);
            arr.clear();
            m.forEach((g, i) => arr.set(String(i), new StrNum(g ?? '')));
          }
          return m.index + 1;
        }
        this.vars.set('RSTART', 0);
        this.vars.set('RLENGTH', -1);
        return 0;
      }
      case 'sprintf': {
        const vals = args.slice(1).map((a) => toStr(this.eval(a)));
        return formatPrintf(sv(0), vals).out;
      }
      case 'sin': return Math.sin(nv(0));
      case 'cos': return Math.cos(nv(0));
      case 'atan2': return Math.atan2(nv(0), nv(1));
      case 'exp': return Math.exp(nv(0));
      case 'log': return Math.log(nv(0));
      case 'sqrt': return Math.sqrt(nv(0));
      case 'int': return Math.trunc(nv(0));
      case 'rand': return this.c.sh.rt.random();
      case 'srand': { const old = this.randSeed; this.randSeed = args.length ? nv(0) : 0; return old; }
      case 'tolower': return sv(0).toLowerCase();
      case 'toupper': return sv(0).toUpperCase();
      case 'system': return 0;
      case 'close': case 'fflush': return 0;
    }
    return 0;
  }

  write(redir: { op: string; target: Expr } | null, text: string) {
    if (!redir) {
      this.out.push(text);
      return;
    }
    const name = toStr(this.eval(redir.target));
    if (name === '/dev/stdout') { this.out.push(text); return; }
    if (name === '/dev/stderr') { this.c.err(text); return; }
    const key = '>' + name;
    const first = !this.files.has(key);
    this.files.set(key, '1');
    try {
      this.c.fs.writeFile(this.c.abs(name), text, { append: redir.op === '>>' || !first, cred: this.c.cred });
    } catch (e) {
      throw new AwkError(`can't redirect to \`${name}' (${(e as Error).message})`);
    }
  }

  exec(s: Stmt) {
    switch (s.k) {
      case 'expr': this.eval(s.e); return;
      case 'block': for (const st of s.body) this.exec(st); return;
      case 'print': {
        const ofs = toStr(this.vars.get('OFS') ?? ' ');
        const ors = toStr(this.vars.get('ORS') ?? '\n');
        const text = s.args.length ? s.args.map((a) => {
          const v = this.eval(a);
          return typeof v === 'number' && !Number.isInteger(v) ? numToStr(v, toStr(this.vars.get('OFMT') ?? '%.6g')) : toStr(v);
        }).join(ofs) : this.record;
        this.write(s.redir, text + ors);
        return;
      }
      case 'printf': {
        if (!s.args.length) throw new AwkError('printf: no format');
        const fmt = toStr(this.eval(s.args[0]));
        const vals = s.args.slice(1).map((a) => {
          const v = this.eval(a);
          return typeof v === 'number' ? String(v) : toStr(v);
        });
        this.write(s.redir, formatPrintf(fmt, vals).out);
        return;
      }
      case 'if':
        if (toBool(this.eval(s.c))) this.exec(s.a);
        else if (s.b) this.exec(s.b);
        return;
      case 'while': {
        let guard = 0;
        while (toBool(this.eval(s.c))) {
          if (++guard > 1e6) throw new AwkError('loop limit exceeded');
          try { this.exec(s.body); } catch (e) { if (e instanceof BreakEx) break; if (e instanceof ContinueEx) continue; throw e; }
        }
        return;
      }
      case 'do': {
        let guard = 0;
        do {
          if (++guard > 1e6) throw new AwkError('loop limit exceeded');
          try { this.exec(s.body); } catch (e) { if (e instanceof BreakEx) break; if (e instanceof ContinueEx) continue; throw e; }
        } while (toBool(this.eval(s.c)));
        return;
      }
      case 'for': {
        if (s.init) this.exec(s.init);
        let guard = 0;
        while (!s.c || toBool(this.eval(s.c))) {
          if (++guard > 1e6) throw new AwkError('loop limit exceeded');
          try { this.exec(s.body); } catch (e) { if (e instanceof BreakEx) break; if (!(e instanceof ContinueEx)) throw e; }
          if (s.step) this.exec(s.step);
        }
        return;
      }
      case 'forin': {
        const arr = this.arrayOf(s.arr);
        const keys = [...arr.keys()].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? parseInt(a, 10) - parseInt(b, 10) : 0));
        for (const k of keys) {
          if (!arr.has(k)) continue;
          this.setVar(s.v, new StrNum(k));
          try { this.exec(s.body); } catch (e) { if (e instanceof BreakEx) break; if (e instanceof ContinueEx) continue; throw e; }
        }
        return;
      }
      case 'next': throw new NextEx();
      case 'exit': throw new ExitEx(s.e ? Math.trunc(toNum(this.eval(s.e))) : -1);
      case 'return': throw new ReturnEx(s.e ? this.eval(s.e) : new StrNum(''));
      case 'break': throw new BreakEx();
      case 'continue': throw new ContinueEx();
      case 'delete':
        if (s.subs) this.arrayOf(s.name).delete(this.subKey(s.subs.map((x) => this.eval(x))));
        else this.arrayOf(s.name).clear();
        return;
    }
  }

  run(texts: { name: string; text: string }[]): number {
    let code = 0;
    const flushOut = () => {
      if (this.out.length) this.c.out(this.out.join(''));
      this.out = [];
    };
    try {
      for (const r of this.prog.rules) {
        if (r.kind === 'begin') {
          try {
            this.exec(r.body!);
          } catch (e) {
            if (e instanceof NextEx) throw new AwkError('next used in BEGIN');
            throw e;
          }
        }
      }
      const mains = this.prog.rules.filter((r) => r.kind === 'main');
      const ends = this.prog.rules.filter((r) => r.kind === 'end');
      if (mains.length || ends.length) {
        for (const src of texts) {
          this.vars.set('FILENAME', src.name === '-' ? '' : src.name);
          this.vars.set('FNR', 0);
          const rs = toStr(this.vars.get('RS') ?? '\n');
          let recs: string[];
          if (rs === '\n') {
            recs = src.text === '' ? [] : src.text.split('\n');
            if (src.text.endsWith('\n')) recs.pop();
          } else if (rs === '') {
            recs = src.text.split(/\n{2,}/).filter((x) => x !== '').map((x) => x.replace(/\n$/, ''));
          } else {
            recs = src.text.split(rs.length === 1 ? rs : this.regex(rs));
            if (recs[recs.length - 1] === '' || recs[recs.length - 1] === '\n') recs.pop();
          }
          this.records = recs;
          this.recIdx = 0;
          while (this.recIdx < this.records.length) {
            const line = this.records[this.recIdx++];
            this.vars.set('NR', toNum(this.getVar('NR')) + 1);
            this.vars.set('FNR', toNum(this.getVar('FNR')) + 1);
            this.setRecord(line);
            try {
              for (const r of mains) {
                if (this.matches(r)) {
                  if (r.body) this.exec(r.body);
                  else this.out.push(this.record + toStr(this.vars.get('ORS') ?? '\n'));
                }
              }
            } catch (e) {
              if (e instanceof NextEx) continue;
              throw e;
            }
          }
        }
      }
      for (const r of ends) this.exec(r.body!);
    } catch (e) {
      if (e instanceof ExitEx) {
        code = e.code < 0 ? 0 : e.code;
        if (!this.exited) {
          this.exited = true;
          // exit en la fase principal ejecuta END
          for (const r of this.prog.rules) {
            if (r.kind === 'end' && e.code !== -2) {
              try { this.exec(r.body!); } catch (e2) { if (!(e2 instanceof ExitEx)) throw e2; }
            }
          }
        }
      } else if (e instanceof AwkError) {
        flushOut();
        this.c.err(`awk: ${e.message}\n`);
        return 2;
      } else throw e;
    }
    flushOut();
    return code;
  }

  matches(r: Rule): boolean {
    if (!r.pattern) return true;
    if (!r.pattern2) return toBool(this.eval(r.pattern));
    if (!r.inRange) {
      if (toBool(this.eval(r.pattern))) {
        r.inRange = !toBool(this.eval(r.pattern2));
        return true;
      }
      return false;
    }
    if (toBool(this.eval(r.pattern2))) r.inRange = false;
    return true;
  }
}

defineCommand(['awk', 'gawk', 'mawk'], {
  summary: 'Lenguaje para procesar texto por campos y patrones',
  usage: "awk [-F SEP] [-v var=valor] 'PROGRAMA' [ARCHIVO]...",
  category: 'texto',
  level: 3,
  options: [['-F SEP', 'Separador de campos'], ['-v var=val', 'Define una variable'], ['$1, $2, $NF', 'Campos de la línea ($0 = línea completa)'], ['NR / NF', 'Número de línea / número de campos'], ['BEGIN{…} END{…}', 'Bloques antes y después de leer'], ['patrón {acción}', 'Ejecuta la acción solo en líneas que coinciden']],
  examples: [
    ["awk '{print $1}' archivo", 'Primera columna'],
    ["awk -F: '{print $1, $3}' /etc/passwd", 'Usuario y UID'],
    ["awk '$3 > 100 {print $1}' datos", 'Filtra por condición numérica'],
    ["awk '{s+=$2} END {print s}' ventas", 'Suma una columna'],
    ["awk 'NR==2,NR==4' archivo", 'Líneas 2 a 4'],
  ],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'Vh', values: 'Ffv', stopAtOperand: false, long: { '--field-separator': 'F', '--assign': 'v', '--file': 'f' } });
  let operands = [...o.rest];
  let progText: string;
  if (o.all('f').length) {
    try {
      progText = o.all('f').map((f) => c.fs.readFile(c.abs(f), c.cred)).join('\n');
    } catch (e) {
      return c.fsfail(e, o.all('f')[0]);
    }
  } else {
    if (!operands.length) {
      c.err('Usage: awk [POSIX or GNU style options] -f progfile [--] file ...\nUsage: awk [POSIX or GNU style options] [--] \'program\' file ...\n');
      return 2;
    }
    progText = operands.shift()!;
  }
  let prog: Program;
  try {
    prog = parseProgram(progText);
  } catch (e) {
    c.err(`awk: ${(e as Error).message}\nawk: ${(e as Error).message.includes('syntax') ? 'fatal: parse error' : ''}\n`);
    return 2;
  }
  const it = new Interp(c, prog);
  const fsOpt = o.val('F');
  if (fsOpt !== undefined) it.vars.set('FS', fsOpt === 't' ? '\t' : fsOpt.replace(/\\t/g, '\t'));
  const assign = (spec: string) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(spec);
    if (!m) return false;
    const val = m[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    it.vars.set(m[1], looksNumeric(val) ? new StrNum(val) : val);
    return true;
  };
  for (const v of o.all('v')) assign(v);
  const files: string[] = [];
  const pendingAssigns: string[] = [];
  for (const f of operands) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(f) && !c.fs.stat(c.abs(f), c.cred)) pendingAssigns.push(f);
    else files.push(f);
  }
  for (const a of pendingAssigns) assign(a);
  const hasMain = prog.rules.some((r) => r.kind === 'main' || r.kind === 'end');
  let texts: { name: string; text: string }[] = [];
  if (hasMain) {
    const r = await readInputs(c, files);
    texts = r.inputs;
    if (r.failed && !texts.length) return 2;
    it.vars.set('ARGC', files.length + 1);
  }
  return it.run(texts);
});
