/**
 * Parser de Python 3.13 (descenso recursivo) → AST con posiciones.
 * Reproduce los mensajes de error más habituales de CPython (`invalid syntax`, `expected ':'`, ...).
 */
import type {
  Alias, Arg, Arguments, BinOpName, CmpOpName, Comprehension, Constant, Expr, ExceptHandler, FunctionDef, Keyword, Match,
  MatchCase, Module, Name, Pattern, Pos, Stmt, TypeParam, WithItem, Ctx, JoinedStr, FormattedValue, Slice, TupleExpr,
} from './ast';
import {
  KEYWORDS, LineTable, PySyntaxErr, normalizeNewlines, scanFParts, tokenize,
  type FStrPart, type LexResult, type Token,
} from './lexer';

export type ParseMode = 'exec' | 'single' | 'eval';

export interface ParseWarning {
  msg: string;
  line: number;
  col: number;
  category: string;
}

export interface ParseResult {
  module: Module;
  src: string;
  table: LineTable;
  warnings: ParseWarning[];
}

type AnyNode = Pos & { k?: string; [key: string]: any };

interface LitAcc {
  text: string;
  start: number;
  end: number;
  tok: Token;
}

const AUG_OPS: Record<string, BinOpName> = {
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '%=': '%', '**=': '**', '@=': '@', '&=': '&', '|=': '|', '^=': '^', '<<=': '<<', '>>=': '>>',
};
const CMP_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const SHIFT_OPS = new Set(['<<', '>>']);
const SUM_OPS = new Set(['+', '-']);
const TERM_OPS = new Set(['*', '/', '//', '%', '@']);

/** nombre de un tipo de expresión para los mensajes "cannot assign to X" */
export function exprName(e: Expr): string {
  switch (e.k) {
    case 'Attribute': return 'attribute';
    case 'Subscript': return 'subscript';
    case 'Starred': return 'starred';
    case 'Name': return 'name';
    case 'List': return 'list';
    case 'Tuple': return 'tuple';
    case 'Lambda': return 'lambda';
    case 'Call': return 'function call';
    case 'BoolOp': case 'BinOp': case 'UnaryOp': return 'expression';
    case 'GeneratorExp': return 'generator expression';
    case 'Yield': case 'YieldFrom': return 'yield expression';
    case 'Await': return 'await expression';
    case 'ListComp': return 'list comprehension';
    case 'SetComp': return 'set comprehension';
    case 'DictComp': return 'dict comprehension';
    case 'Dict': return 'dict literal';
    case 'Set': return 'set display';
    case 'JoinedStr': case 'FormattedValue': return 'f-string expression';
    case 'Constant':
      if (e.vt === 'none') return 'None';
      if (e.vt === 'bool') return e.value ? 'True' : 'False';
      if (e.vt === 'ellipsis') return 'ellipsis';
      return 'literal';
    case 'Compare': return 'comparison';
    case 'IfExp': return 'conditional expression';
    case 'NamedExpr': return 'named expression';
    default: return 'expression';
  }
}

class Parser {
  toks: Token[];
  p = 0;
  /** final (línea/columna) del último token consumido que no es de estructura */
  pl = 1;
  pc = 0;
  lv = 0; // profundidad de corchetes en el análisis
  furthest = 0;
  lastDisj: Expr | null = null;
  warnings: ParseWarning[] = [];
  /** estamos analizando una f-string anidada o una expresión de f-string */
  inFString = 0;
  noInvalid = 0;
  lexErrToken: Token | null = null;

  constructor(
    public src: string,
    public table: LineTable,
    public lex: LexResult,
    toks?: Token[],
  ) {
    this.toks = toks ?? lex.tokens;
    if (!toks && lex.error) {
      const e = lex.error;
      this.toks = lex.tokens.concat([{ type: 'ERROR', value: 'lexerror', line: e.line, col: e.col, endLine: e.endLine, endCol: e.endCol, start: src.length, end: src.length }]);
    }
  }

  // ───────────── utilidades de tokens ─────────────

  tok(): Token {
    const t = this.toks[this.p];
    if (t.type === 'ERROR') this.throwTokErr(t);
    if (this.p > this.furthest) this.furthest = this.p;
    return t;
  }
  peekAt(n: number): Token {
    const t = this.toks[Math.min(this.p + n, this.toks.length - 1)];
    return t;
  }
  throwTokErr(t: Token): never {
    if (t.value === 'lexerror' && this.lex.error) {
      const e = this.lex.error;
      const err = new PySyntaxErr(e.kind, e.msg, e.line, e.col, e.endLine, e.endCol, e.eof);
      (err as any).fromLexer = true;
      throw err;
    }
    const err = new PySyntaxErr('SyntaxError', `'${this.lex.open.length ? this.lex.open[this.lex.open.length - 1].ch : '('}' was never closed`, t.line, t.col, t.line, -1, true);
    (err as any).fromLexer = true;
    throw err;
  }
  next(): Token {
    const t = this.tok();
    this.p++;
    if (t.type !== 'NEWLINE' && t.type !== 'INDENT' && t.type !== 'DEDENT' && t.type !== 'EOF') {
      this.pl = t.endLine;
      this.pc = t.endCol;
    }
    return t;
  }
  isOp(v: string): boolean {
    const t = this.tok();
    return t.type === 'OP' && t.value === v;
  }
  isKw(v: string): boolean {
    const t = this.tok();
    return t.type === 'NAME' && t.value === v;
  }
  isName(): boolean {
    const t = this.tok();
    return t.type === 'NAME' && !KEYWORDS.has(t.value);
  }
  eatOp(v: string): boolean {
    if (this.isOp(v)) { this.next(); return true; }
    return false;
  }
  eatKw(v: string): boolean {
    if (this.isKw(v)) { this.next(); return true; }
    return false;
  }
  err(msg: string, a: Pos | Token, kind: 'SyntaxError' | 'IndentationError' = 'SyntaxError'): never {
    throw new PySyntaxErr(kind, msg, a.line, a.col, a.endLine, a.endCol);
  }
  errRange(msg: string, a: Pos | Token, b: Pos | Token): never {
    throw new PySyntaxErr('SyntaxError', msg, a.line, a.col, b.endLine, b.endCol);
  }
  /** "invalid syntax" en el token actual */
  fail(msg = 'invalid syntax'): never {
    const t = this.tok();
    if (t.type === 'INDENT') throw new PySyntaxErr('IndentationError', 'unexpected indent', t.line, t.endCol - 1, t.line, -2);
    if (t.type === 'DEDENT') throw new PySyntaxErr('IndentationError', 'unexpected unindent', t.line, t.col, t.endLine, t.endCol);
    throw new PySyntaxErr('SyntaxError', msg, t.line, t.col, t.endLine, t.endCol);
  }
  expectOp(v: string): Token {
    if (!this.isOp(v)) this.fail();
    return this.next();
  }
  /** token forzado (`&&'('` en la gramática): el error es `expected 'X'` en el token actual */
  forceOp(v: string): Token {
    if (!this.isOp(v)) {
      const t = this.tok();
      if (t.type === 'INDENT' || t.type === 'DEDENT') this.fail();
      throw new PySyntaxErr('SyntaxError', `expected '${v}'`, t.line, t.col, t.endLine, t.endCol);
    }
    return this.next();
  }
  expectKw(v: string): Token {
    if (!this.isKw(v)) this.fail();
    return this.next();
  }
  expectName(): Token {
    if (!this.isName()) this.fail();
    return this.next();
  }
  mk<T extends AnyNode>(start: { line: number; col: number }, node: T): T {
    node.line = start.line;
    node.col = start.col;
    node.endLine = this.pl;
    node.endCol = this.pc;
    return node;
  }

  // ───────────── módulo ─────────────

  parseModule(mode: ParseMode): Module {
    const body: Stmt[] = [];
    if (mode === 'eval') {
      const e = this.starExpressionsOnly();
      while (this.tok().type === 'NEWLINE') this.next();
      if (this.tok().type !== 'EOF') this.fail();
      return { k: 'Module', body: [{ k: 'Expr', value: e, line: e.line, col: e.col, endLine: e.endLine, endCol: e.endCol }] };
    }
    if (mode === 'single') {
      while (this.tok().type === 'NEWLINE') this.next();
      if (this.tok().type !== 'EOF') {
        this.statement(body);
        while (this.tok().type === 'NEWLINE') this.next();
        if (this.tok().type !== 'EOF') this.fail();
      }
      return { k: 'Module', body };
    }
    while (this.tok().type !== 'EOF') {
      if (this.tok().type === 'NEWLINE') { this.next(); continue; }
      this.statement(body);
    }
    return { k: 'Module', body };
  }

  starExpressionsOnly(): Expr {
    return this.starExpressions();
  }

  // ───────────── sentencias ─────────────

  statement(out: Stmt[]): void {
    const t = this.tok();
    if (t.type === 'INDENT') this.fail();
    if (t.type === 'NAME') {
      switch (t.value) {
        case 'if': out.push(this.ifStmt()); return;
        case 'while': out.push(this.whileStmt()); return;
        case 'for': out.push(this.forStmt(false, t)); return;
        case 'try': out.push(this.tryStmt()); return;
        case 'with': out.push(this.withStmt(false, t)); return;
        case 'def': out.push(this.funcDef([], false, t)); return;
        case 'class': out.push(this.classDef([])); return;
        case 'async': {
          const n = this.peekAt(1);
          if (n.type === 'NAME') {
            if (n.value === 'def') { this.next(); out.push(this.funcDef([], true, t)); return; }
            if (n.value === 'for') { this.next(); out.push(this.forStmt(true, t)); return; }
            if (n.value === 'with') { this.next(); out.push(this.withStmt(true, t)); return; }
          }
          this.next();
          this.fail();
          return;
        }
        case 'match': {
          const m = this.tryMatchStmt();
          if (m) { out.push(m); return; }
          break;
        }
        default: break;
      }
    }
    if (t.type === 'OP' && t.value === '@') { out.push(this.decorated()); return; }
    this.simpleStmts(out);
  }

  simpleStmts(out: Stmt[]): void {
    for (;;) {
      out.push(this.simpleStmt());
      if (this.isOp(';')) {
        this.next();
        if (this.tok().type === 'NEWLINE') { this.next(); return; }
        continue;
      }
      break;
    }
    const t = this.tok();
    if (t.type === 'NEWLINE') { this.next(); return; }
    if (t.type === 'EOF') return;
    this.fail();
  }

  simpleStmt(): Stmt {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    if (t.type === 'NAME') {
      switch (t.value) {
        case 'pass': this.next(); return this.mk(start, { k: 'Pass' } as any);
        case 'break': this.next(); return this.mk(start, { k: 'Break' } as any);
        case 'continue': this.next(); return this.mk(start, { k: 'Continue' } as any);
        case 'return': {
          this.next();
          let value: Expr | null = null;
          if (!this.atStmtEnd()) value = this.starExpressions();
          return this.mk(start, { k: 'Return', value } as any);
        }
        case 'raise': {
          this.next();
          let exc: Expr | null = null;
          let cause: Expr | null = null;
          if (!this.atStmtEnd()) {
            exc = this.expression();
            if (this.eatKw('from')) cause = this.expression();
          }
          return this.mk(start, { k: 'Raise', exc, cause } as any);
        }
        case 'global': case 'nonlocal': {
          this.next();
          const names: string[] = [this.expectName().value];
          while (this.eatOp(',')) names.push(this.expectName().value);
          return this.mk(start, { k: t.value === 'global' ? 'Global' : 'Nonlocal', names } as any);
        }
        case 'del': return this.delStmt(start);
        case 'assert': {
          this.next();
          const test = this.expression();
          let msg: Expr | null = null;
          if (this.eatOp(',')) msg = this.expression();
          return this.mk(start, { k: 'Assert', test, msg } as any);
        }
        case 'import': return this.importStmt(start);
        case 'from': return this.importFrom(start);
        case 'type': {
          const n1 = this.peekAt(1);
          const n2 = this.peekAt(2);
          if (n1.type === 'NAME' && !KEYWORDS.has(n1.value) && n2.type === 'OP' && (n2.value === '=' || n2.value === '[')) return this.typeAlias(start);
          break;
        }
        default: break;
      }
    }
    return this.exprStmt(start);
  }

  atStmtEnd(): boolean {
    const t = this.tok();
    return t.type === 'NEWLINE' || t.type === 'EOF' || (t.type === 'OP' && t.value === ';');
  }

  typeAlias(start: { line: number; col: number }): Stmt {
    this.next();
    const nameTok = this.expectName();
    const name = this.mk({ line: nameTok.line, col: nameTok.col }, { k: 'Name', id: nameTok.value, ctx: 'Store' } as any) as Name;
    name.endLine = nameTok.endLine; name.endCol = nameTok.endCol;
    const typeParams = this.isOp('[') ? this.typeParams() : [];
    this.expectOp('=');
    const value = this.expression();
    return this.mk(start, { k: 'TypeAlias', name, typeParams, value } as any);
  }

  typeParams(): TypeParam[] {
    this.expectOp('[');
    this.lv++;
    const out: TypeParam[] = [];
    while (!this.isOp(']')) {
      const t = this.tok();
      const start = { line: t.line, col: t.col };
      let k: TypeParam['k'] = 'TypeVar';
      if (this.eatOp('*')) k = 'TypeVarTuple';
      else if (this.eatOp('**')) k = 'ParamSpec';
      const name = this.expectName().value;
      let bound: Expr | null = null;
      let defaultValue: Expr | null = null;
      if (k === 'TypeVar' && this.eatOp(':')) bound = this.expression();
      if (this.eatOp('=')) defaultValue = k === 'TypeVarTuple' && this.isOp('*') ? this.starExpression() : this.expression();
      out.push(this.mk(start, { k, name, bound, defaultValue } as any));
      if (!this.eatOp(',')) break;
    }
    this.expectOp(']');
    this.lv--;
    return out;
  }

  delStmt(start: { line: number; col: number }): Stmt {
    this.next();
    const targets: Expr[] = [];
    for (;;) {
      const e = this.bitwiseOrTarget();
      targets.push(this.toDel(e));
      if (!this.eatOp(',')) break;
      if (this.atStmtEnd()) break;
    }
    return this.mk(start, { k: 'Delete', targets } as any);
  }

  importStmt(start: { line: number; col: number }): Stmt {
    this.next();
    const names: Alias[] = [];
    if (this.atStmtEnd()) { const t = this.tok(); throw new PySyntaxErr('SyntaxError', "Expected one or more names after 'import'", t.line, t.col, t.line, t.col); }
    for (;;) {
      const t = this.tok();
      const s = { line: t.line, col: t.col };
      const name = this.dottedName();
      let asname: string | null = null;
      if (this.eatKw('as')) asname = this.expectName().value;
      names.push(this.mk(s, { name, asname } as any));
      if (!this.eatOp(',')) break;
    }
    if (this.isKw('from')) {
      // import a from b
      const t = this.tok();
      void t;
      let e = this.p;
      while (this.toks[e].type !== 'NEWLINE' && this.toks[e].type !== 'EOF' && this.toks[e].type !== 'ERROR') e++;
      const lastT = this.toks[e - 1];
      throw new PySyntaxErr('SyntaxError', "Did you mean to use 'from ... import ...' instead?", start.line, start.col, lastT.endLine, lastT.endCol);
    }
    return this.mk(start, { k: 'Import', names } as any);
  }

  dottedName(): string {
    let name = this.expectName().value;
    while (this.isOp('.')) {
      this.next();
      name += '.' + this.expectName().value;
    }
    return name;
  }

  importFrom(start: { line: number; col: number }): Stmt {
    this.next();
    let level = 0;
    for (;;) {
      if (this.isOp('.')) { level++; this.next(); } else if (this.isOp('...')) { level += 3; this.next(); } else break;
    }
    let module: string | null = null;
    if (!this.isKw('import')) module = this.dottedName();
    else if (level === 0) this.fail();
    this.expectKw('import');
    const names: Alias[] = [];
    if (this.isOp('*')) {
      const t = this.next();
      names.push({ name: '*', asname: null, line: t.line, col: t.col, endLine: t.endLine, endCol: t.endCol });
    } else {
      const paren = this.eatOp('(');
      if (paren) this.lv++;
      if (!paren && this.atStmtEnd()) { const t = this.tok(); throw new PySyntaxErr('SyntaxError', "Expected one or more names after 'import'", t.line, t.col, t.line, t.col); }
      for (;;) {
        const t = this.tok();
        const s = { line: t.line, col: t.col };
        const name = this.expectName().value;
        let asname: string | null = null;
        if (this.eatKw('as')) asname = this.expectName().value;
        names.push(this.mk(s, { name, asname } as any));
        if (!this.eatOp(',')) break;
        if (paren && this.isOp(')')) break;
        if (!paren && this.atStmtEnd()) {
          const tt = this.tok();
          throw new PySyntaxErr('SyntaxError', 'trailing comma not allowed without surrounding parentheses', tt.line, tt.col, tt.endLine, tt.endCol);
        }
      }
      if (paren) { this.expectOp(')'); this.lv--; }
    }
    return this.mk(start, { k: 'ImportFrom', module, names, level } as any);
  }

  // ── asignaciones y expresiones ──

  exprStmt(start: { line: number; col: number }): Stmt {
    const t0 = this.tok();
    // sentencia `yield`
    let first: Expr;
    if (t0.type === 'NAME' && t0.value === 'yield') first = this.yieldExpr();
    else first = this.starExpressions();
    const t = this.tok();
    if (t.type === 'OP') {
      if (t.value === '=') {
        const targets: Expr[] = [first];
        let value: Expr = first;
        while (this.isOp('=')) {
          this.next();
          if (this.isKw('yield')) value = this.yieldExpr();
          else value = this.starExpressions();
          targets.push(value);
        }
        targets.pop();
        const tg = targets.map((e, idx) => this.toStore(e, 'assign', idx === 0));
        return this.mk(start, { k: 'Assign', targets: tg, value } as any);
      }
      if (AUG_OPS[t.value]) {
        const op = AUG_OPS[t.value];
        if (!(first.k === 'Name' || first.k === 'Attribute' || first.k === 'Subscript') || (first.paren && first.k !== 'Name' && false)) {
          this.err(`'${exprName(first)}' is an illegal expression for augmented assignment`, first);
        }
        this.next();
        const value = this.isKw('yield') ? this.yieldExpr() : this.starExpressions();
        this.setCtx(first, 'Store');
        return this.mk(start, { k: 'AugAssign', target: first, op, value } as any);
      }
      if (t.value === ':') {
        // anotación: x: int = 1
        if (first.k === 'Tuple') this.err('only single target (not tuple) can be annotated', first.paren ? first : first.elts[0]);
        if (first.k === 'List') this.err('only single target (not list) can be annotated', first);
        if (!(first.k === 'Name' || first.k === 'Attribute' || first.k === 'Subscript')) this.err('illegal target for annotation', first);
        this.next();
        const annotation = this.expression();
        let value: Expr | null = null;
        if (this.eatOp('=')) value = this.isKw('yield') ? this.yieldExpr() : this.starExpressions();
        this.setCtx(first, 'Store');
        const simple = first.k === 'Name' && !first.paren;
        return this.mk(start, { k: 'AnnAssign', target: first, annotation, value, simple } as any);
      }
    }
    // expresión suelta
    if (first.k === 'Name' && (first.id === 'print' || first.id === 'exec') && !this.atStmtEnd() && t.type !== 'OP') {
      // print "hola"  →  mensaje clásico
      return this.legacyPrint(first);
    }
    return this.mk(start, { k: 'Expr', value: first } as any);
  }

  legacyPrint(first: Name): never {
    const save = this.p;
    try {
      const b = this.starExpressions();
      this.errRange(`Missing parentheses in call to '${first.id}'. Did you mean ${first.id}(...)?`, first, b);
    } catch (e) {
      if (e instanceof PySyntaxErr && e.msg.startsWith('Missing parentheses')) throw e;
      this.p = save;
      this.fail();
    }
    return undefined as never;
  }

  /** prepara un nodo como destino de asignación */
  toStore(e: Expr, ctx: 'assign' | 'for' | 'with' | 'comp' = 'assign', first = false): Expr {
    const bad = this.invalidTarget(e);
    if (bad) {
      const special = bad.k === 'Constant' && (bad.vt === 'none' || bad.vt === 'bool');
      const bracketed = e.k === 'List' || (e.k === 'Tuple' && e.paren) || e.k === 'GeneratorExp';
      if (ctx === 'assign' && first && !special && !bracketed && e.k !== 'Starred') {
        // "cannot assign to X here. Maybe you meant '==' instead of '='?"
        this.err(`cannot assign to ${exprName(bad)} here. Maybe you meant '==' instead of '='?`, bad);
      }
      this.err(`cannot assign to ${exprName(bad)}`, bad);
    }
    this.setCtx(e, 'Store');
    return e;
  }
  toDel(e: Expr): Expr {
    const bad = this.invalidDelTarget(e);
    if (bad) this.err(`cannot delete ${exprName(bad)}`, bad);
    this.setCtx(e, 'Del');
    return e;
  }
  invalidTarget(e: Expr): Expr | null {
    switch (e.k) {
      case 'Name': case 'Attribute': case 'Subscript': return null;
      case 'Starred': return this.invalidTarget(e.value);
      case 'List': case 'Tuple':
        for (const x of e.elts) { const b = this.invalidTarget(x); if (b) return b; }
        return null;
      default: return e;
    }
  }
  invalidDelTarget(e: Expr): Expr | null {
    switch (e.k) {
      case 'Name': case 'Attribute': case 'Subscript': return null;
      case 'List': case 'Tuple':
        for (const x of e.elts) { const b = this.invalidDelTarget(x); if (b) return b; }
        return null;
      default: return e;
    }
  }
  setCtx(e: Expr, ctx: Ctx): void {
    switch (e.k) {
      case 'Name': case 'Attribute': case 'Subscript': e.ctx = ctx; break;
      case 'Starred': e.ctx = ctx; this.setCtx(e.value, ctx); break;
      case 'List': case 'Tuple': e.ctx = ctx; for (const x of e.elts) this.setCtx(x, ctx); break;
      default: break;
    }
  }

  // ── bloques ──

  /** Analiza `':' block`. `what` describe la sentencia para el mensaje de sangría. */
  block(what: string, kwTok: Token, forced = true): Stmt[] {
    if (forced) this.forceOp(':'); else this.expectOp(':');
    return this.blockBody(what, kwTok);
  }

  blockBody(what: string, kwTok: Token): Stmt[] {
    const body: Stmt[] = [];
    if (this.tok().type === 'NEWLINE') {
      this.next();
      const t = this.tok();
      if (t.type !== 'INDENT') {
        throw new PySyntaxErr('IndentationError', `expected an indented block after ${what} on line ${kwTok.line}`, t.line, t.col, t.endLine, t.endCol);
      }
      this.next();
      while (this.tok().type !== 'DEDENT' && this.tok().type !== 'EOF') {
        if (this.tok().type === 'NEWLINE') { this.next(); continue; }
        this.statement(body);
      }
      if (this.tok().type === 'DEDENT') this.next();
      return body;
    }
    this.simpleStmts(body);
    return body;
  }

  ifStmt(): Stmt {
    const kw = this.next(); // if / elif
    const start = { line: kw.line, col: kw.col };
    const test = this.namedExpression();
    this.colonCheck();
    const body = this.block(`'${kw.value}' statement`, kw, false);
    let orelse: Stmt[] = [];
    if (this.isKw('elif')) orelse = [this.ifStmt()];
    else if (this.isKw('else')) {
      const e = this.next();
      orelse = this.block("'else' statement", e);
    }
    return this.mk(start, { k: 'If', test, body, orelse } as any);
  }

  /** `if x` NEWLINE → expected ':' (como CPython: solo cuando lo que sigue es el fin de línea) */
  colonCheck(): void {
    if (!this.isOp(':')) {
      const t = this.tok();
      if (t.type === 'NEWLINE') throw new PySyntaxErr('SyntaxError', "expected ':'", t.line, t.col, t.endLine, t.endCol);
      this.fail();
    }
  }

  whileStmt(): Stmt {
    const kw = this.next();
    const start = { line: kw.line, col: kw.col };
    const test = this.namedExpression();
    this.colonCheck();
    const body = this.block("'while' statement", kw, false);
    let orelse: Stmt[] = [];
    if (this.isKw('else')) {
      const e = this.next();
      orelse = this.block("'else' statement", e);
    }
    return this.mk(start, { k: 'While', test, body, orelse } as any);
  }

  forStmt(isAsync: boolean, first: Token): Stmt {
    const kw = this.next(); // for
    const start = { line: first.line, col: first.col };
    const tgt = this.targetList();
    const target = this.toStore(tgt, 'for');
    this.expectKw('in');
    const iter = this.starExpressions();
    this.colonCheck();
    const body = this.block("'for' statement", kw, false);
    let orelse: Stmt[] = [];
    if (this.isKw('else')) {
      const e = this.next();
      orelse = this.block("'else' statement", e);
    }
    return this.mk(start, { k: isAsync ? 'AsyncFor' : 'For', target, iter, body, orelse } as any);
  }

  /** lista de destinos de `for` (`a, (b, c), *d`) sin consumir `in` */
  targetList(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.starTarget();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isKw('in') || this.isOp('=') ) break;
      elts.push(this.starTarget());
    }
    return this.mk(start, { k: 'Tuple', elts, ctx: 'Store' } as any);
  }
  starTarget(): Expr {
    const t = this.tok();
    if (t.type === 'OP' && t.value === '*') {
      this.next();
      const v = this.bitwiseOrTarget();
      return this.mk({ line: t.line, col: t.col }, { k: 'Starred', value: v, ctx: 'Store' } as any);
    }
    return this.bitwiseOrTarget();
  }
  bitwiseOrTarget(): Expr {
    return this.bitOr();
  }

  tryStmt(): Stmt {
    const kw = this.next();
    const start = { line: kw.line, col: kw.col };
    const body = this.block("'try' statement", kw);
    const handlers: ExceptHandler[] = [];
    let orelse: Stmt[] = [];
    let finalbody: Stmt[] = [];
    let star: boolean | null = null;
    while (this.isKw('except')) {
      const ek = this.next();
      const s = { line: ek.line, col: ek.col };
      let isStar = false;
      if (this.isOp('*')) { this.next(); isStar = true; }
      if (star === null) star = isStar;
      else if (star !== isStar) this.err("cannot have both 'except' and 'except*' on the same 'try'", ek);
      let type: Expr | null = null;
      let name: string | null = null;
      if (!this.isOp(':')) {
        type = this.expression();
        if (this.isOp(',')) {
          // except A, B:
          const first = type;
          const save = this.p;
          try {
            let last: Expr = first;
            while (this.eatOp(',')) last = this.expression();
            if (this.isOp(':') || this.isKw('as')) this.errRange('multiple exception types must be parenthesized', first, last);
          } finally { void save; }
        }
        if (this.eatKw('as')) name = this.expectName().value;
      } else if (isStar) {
        this.err('expected one or more exception types', this.tok());
      }
      if (!this.isOp(':')) {
        const t = this.tok();
        if (t.type === 'NEWLINE') throw new PySyntaxErr('SyntaxError', "expected ':'", t.line, t.col, t.endLine, t.endCol);
        this.fail();
      }
      const hbody = this.block(isStar ? "'except*' statement" : "'except' statement", ek, false);
      handlers.push(this.mk(s, { type, name, body: hbody } as any));
    }
    if (handlers.length > 0 && this.isKw('else')) {
      const e = this.next();
      orelse = this.block("'else' statement", e);
    }
    if (this.isKw('finally')) {
      const f = this.next();
      finalbody = this.block("'finally' statement", f);
    }
    if (handlers.length === 0 && finalbody.length === 0) {
      const t = this.tok();
      throw new PySyntaxErr('SyntaxError', "expected 'except' or 'finally' block", t.line, t.col, t.endLine, t.endCol);
    }
    return this.mk(start, { k: star ? 'TryStar' : 'Try', body, handlers, orelse, finalbody } as any);
  }

  withStmt(isAsync: boolean, first: Token): Stmt {
    const kw = this.next();
    const start = { line: first.line, col: first.col };
    let items: WithItem[] | null = null;
    if (this.isOp('(')) {
      // forma con paréntesis: with (a as b, c as d):
      const save = this.p;
      const sp = [this.pl, this.pc, this.lv];
      try {
        this.next();
        this.lv++;
        const its: WithItem[] = [];
        for (;;) {
          its.push(this.withItem());
          if (!this.eatOp(',')) break;
          if (this.isOp(')')) break;
        }
        this.expectOp(')');
        this.lv--;
        if (this.isOp(':')) items = its;
        else throw new PySyntaxErr('SyntaxError', 'x', 0, 0, 0, 0);
      } catch (e) {
        if (!(e instanceof PySyntaxErr)) throw e;
        this.p = save; this.pl = sp[0]; this.pc = sp[1]; this.lv = sp[2];
        items = null;
      }
    }
    if (!items) {
      items = [];
      for (;;) {
        items.push(this.withItem());
        if (!this.eatOp(',')) break;
      }
    }
    this.colonCheck();
    const body = this.block("'with' statement", kw, false);
    return this.mk(start, { k: isAsync ? 'AsyncWith' : 'With', items, body } as any);
  }

  withItem(): WithItem {
    const contextExpr = this.expression();
    let optionalVars: Expr | null = null;
    if (this.eatKw('as')) {
      const t = this.starTarget();
      optionalVars = this.toStore(t, 'with');
    }
    return { contextExpr, optionalVars };
  }

  decorated(): Stmt {
    const decorators: Expr[] = [];
    while (this.isOp('@')) {
      this.next();
      decorators.push(this.namedExpression());
      if (this.tok().type !== 'NEWLINE') this.fail();
      this.next();
    }
    const t = this.tok();
    if (t.type === 'NAME') {
      if (t.value === 'def') return this.funcDef(decorators, false, t);
      if (t.value === 'class') return this.classDef(decorators);
      if (t.value === 'async' && this.peekAt(1).value === 'def') { this.next(); return this.funcDef(decorators, true, t); }
    }
    this.fail();
  }

  funcDef(decorators: Expr[], isAsync: boolean, first: Token): Stmt {
    const kw = this.next(); // def
    const start = { line: first.line, col: first.col };
    const name = this.expectName().value;
    const typeParams = this.isOp('[') ? this.typeParams() : [];
    this.forceOp('(');
    this.lv++;
    const args = this.parameters(')', true);
    this.expectOp(')');
    this.lv--;
    let returns: Expr | null = null;
    if (this.isOp('->')) {
      const arrow = this.next();
      const save = this.p;
      try {
        returns = this.expression();
      } catch (e) {
        if (!(e instanceof PySyntaxErr) || (e as any).fromLexer) throw e;
        this.p = save;
        throw new PySyntaxErr('SyntaxError', "expected ':'", arrow.line, arrow.col, arrow.endLine, arrow.endCol);
      }
    }
    const body = this.block('function definition', kw);
    return this.mk(start, { k: isAsync ? 'AsyncFunctionDef' : 'FunctionDef', name, args, body, decorators, returns, typeParams } as any) as FunctionDef;
  }

  classDef(decorators: Expr[]): Stmt {
    const kw = this.next();
    const start = { line: kw.line, col: kw.col };
    const name = this.expectName().value;
    const typeParams = this.isOp('[') ? this.typeParams() : [];
    let bases: Expr[] = [];
    let keywords: Keyword[] = [];
    if (this.isOp('(')) {
      this.next();
      this.lv++;
      const r = this.callArgs();
      bases = r.args;
      keywords = r.keywords;
      this.expectOp(')');
      this.lv--;
    }
    this.colonCheck();
    const body = this.block('class definition', kw, false);
    return this.mk(start, { k: 'ClassDef', name, bases, keywords, body, decorators, typeParams } as any);
  }

  /** Parámetros de def (`close` = ')') o de lambda (`close` = ':') */
  parameters(close: string, annotations: boolean): Arguments {
    const a: Arguments = { posonlyargs: [], args: [], vararg: null, kwonlyargs: [], kwDefaults: [], kwarg: null, defaults: [] };
    let seenStar = false;
    let seenSlash = false;
    let seenDefault = false;
    let starTok: Token | null = null;
    const parseArg = (): Arg => {
      const t = this.expectName();
      let annotation: Expr | null = null;
      if (annotations && this.eatOp(':')) {
        annotation = this.isOp('*') ? this.starExpression() : this.expression();
      }
      return this.mk({ line: t.line, col: t.col }, { arg: t.value, annotation } as any);
    };
    while (!this.isOp(close)) {
      const t = this.tok();
      if (t.type === 'OP' && t.value === '/') {
        if (seenSlash) this.err('/ may appear only once', t);
        if (seenStar) this.err('/ must be ahead of *', t);
        if (a.args.length === 0) this.err('at least one argument must precede /', t);
        this.next();
        seenSlash = true;
        a.posonlyargs = a.args;
        a.args = [];
      } else if (t.type === 'OP' && t.value === '*') {
        if (seenStar) this.err('* argument may appear only once', t);
        starTok = t;
        this.next();
        seenStar = true;
        if (this.isOp(',') ) {
          // `*` solo: marca keyword-only
          const nx = this.peekAt(1);
          if (nx.type === 'OP' && (nx.value === close || nx.value === '**')) this.err('named arguments must follow bare *', t);
        } else if (this.isOp(close)) {
          this.err('named arguments must follow bare *', t);
        } else {
          a.vararg = parseArg();
          if (this.isOp('=')) this.err('var-positional argument cannot have default value', this.tok());
        }
      } else if (t.type === 'OP' && t.value === '**') {
        this.next();
        a.kwarg = parseArg();
        if (this.isOp('=')) this.err('var-keyword argument cannot have default value', this.tok());
        if (this.isOp(',')) this.next();
        if (!this.isOp(close)) this.err('arguments cannot follow var-keyword argument', this.tok());
        break;
      } else {
        const arg = parseArg();
        let def: Expr | null = null;
        if (this.eatOp('=')) def = this.expression();
        if (seenStar) {
          a.kwonlyargs.push(arg);
          a.kwDefaults.push(def);
        } else {
          if (def) { a.defaults.push(def); seenDefault = true; }
          else if (seenDefault) this.err('parameter without a default follows parameter with a default', arg);
          a.args.push(arg);
        }
      }
      if (!this.eatOp(',')) break;
    }
    void starTok;
    if (a.posonlyargs.length === 0 && seenSlash) { /* ya validado */ }
    return a;
  }

  // ───────────── match ─────────────

  tryMatchStmt(): Stmt | null {
    // `match` es una palabra clave blanda: solo es sentencia si tiene la forma `match <expr>:` NEWLINE INDENT case
    const save = this.p;
    const sp = [this.pl, this.pc, this.lv];
    const kw = this.tok();
    const n1 = this.peekAt(1);
    // descartes rápidos: match = ..., match(...), match.x, match[...], match, ..., match:
    if (n1.type === 'OP' && ['=', '.', ',', ':', ')', ']', '}', ';', '+=', '-=', '*=', '/=', '==', '!=', '<', '>', '<=', '>=', '|', '&', '^', '%', '//', '**', '<<', '>>', '@', '->', ':='].includes(n1.value)) return null;
    if (n1.type === 'NEWLINE' || n1.type === 'EOF') return null;
    if (n1.type === 'NAME' && ['in', 'is', 'and', 'or', 'if', 'else', 'as', 'for', 'from'].includes(n1.value)) return null;
    try {
      this.next();
      const start = { line: kw.line, col: kw.col };
      const subject = this.matchSubject();
      if (!this.isOp(':')) {
        const t = this.tok();
        if (t.type === 'NEWLINE') {
          // `match x` + NEWLINE → es match mal formado solo si luego viene un bloque con `case`
          const n2 = this.peekAt(1);
          const n3 = this.peekAt(2);
          if (n2.type === 'INDENT' && n3.type === 'NAME' && n3.value === 'case') throw new PySyntaxErr('SyntaxError', "expected ':'", t.line, t.col, t.endLine, t.endCol);
        }
        throw new PySyntaxErr('SyntaxError', 'x', 0, 0, 0, 0);
      }
      this.next();
      if (this.tok().type !== 'NEWLINE') throw new PySyntaxErr('SyntaxError', 'x', 0, 0, 0, 0);
      this.next();
      if (this.tok().type !== 'INDENT') {
        const t = this.tok();
        throw new PySyntaxErr('IndentationError', `expected an indented block after 'match' statement on line ${kw.line}`, t.line, t.col, t.endLine, t.endCol);
      }
      this.next();
      const cases: MatchCase[] = [];
      while (this.isKw('case')) cases.push(this.caseBlock());
      if (cases.length === 0) this.fail();
      if (this.tok().type !== 'DEDENT' && this.tok().type !== 'EOF') this.fail();
      if (this.tok().type === 'DEDENT') this.next();
      return this.mk(start, { k: 'Match', subject, cases } as any) as Match;
    } catch (e) {
      if (!(e instanceof PySyntaxErr)) throw e;
      if (e.msg === "expected ':'" || e.kind === 'IndentationError' || (e as any).fromLexer || (e as any).definite) throw e;
      if (e.msg !== 'x' && this.p > save + 1 && this.matchCommitted) throw e;
      this.p = save; this.pl = sp[0]; this.pc = sp[1]; this.lv = sp[2];
      this.matchCommitted = false;
      return null;
    }
  }
  matchCommitted = false;
  noEq = false;

  matchSubject(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.starNamedExpression();
    if (this.isOp(',')) {
      const elts = [first];
      while (this.eatOp(',')) {
        if (this.isOp(':')) break;
        elts.push(this.starNamedExpression());
      }
      return this.mk(start, { k: 'Tuple', elts, ctx: 'Load' } as any);
    }
    if (first.k === 'Starred') this.err("can't use starred expression here", first);
    return first;
  }

  caseBlock(): MatchCase {
    const kw = this.next(); // case
    this.matchCommitted = true;
    const pattern = this.patterns();
    let guard: Expr | null = null;
    if (this.eatKw('if')) guard = this.namedExpression();
    this.colonCheck();
    const body = this.block("'case' statement", kw, false);
    return { pattern, guard, body };
  }

  patterns(): Pattern {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.maybeStarPattern();
    if (this.isOp(',')) {
      const ps = [first];
      while (this.eatOp(',')) {
        if (this.isOp(':') || this.isKw('if')) break;
        ps.push(this.maybeStarPattern());
      }
      return this.mk(start, { k: 'MatchSequence', patterns: ps } as any);
    }
    if (first.k === 'MatchStar') return this.mk(start, { k: 'MatchSequence', patterns: [first] } as any);
    return first;
  }

  maybeStarPattern(): Pattern {
    const t = this.tok();
    if (t.type === 'OP' && t.value === '*') {
      this.next();
      const n = this.expectName();
      return this.mk({ line: t.line, col: t.col }, { k: 'MatchStar', name: n.value === '_' ? null : n.value } as any);
    }
    return this.asPattern();
  }

  asPattern(): Pattern {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const p = this.orPattern();
    if (this.isKw('as')) {
      this.next();
      const n = this.tok();
      if (n.type === 'NAME' && !KEYWORDS.has(n.value)) {
        if (n.value === '_') this.err("cannot use '_' as a target", n);
        this.next();
        return this.mk(start, { k: 'MatchAs', pattern: p, name: n.value } as any);
      }
      this.err('invalid pattern target', n);
    }
    return p;
  }

  orPattern(): Pattern {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.closedPattern();
    if (!this.isOp('|')) return first;
    const ps = [first];
    while (this.eatOp('|')) ps.push(this.closedPattern());
    return this.mk(start, { k: 'MatchOr', patterns: ps } as any);
  }

  closedPattern(): Pattern {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    if (t.type === 'NUMBER' || (t.type === 'OP' && t.value === '-')) {
      const e = this.signedNumber();
      return this.mk(start, { k: 'MatchValue', value: e } as any);
    }
    if (t.type === 'STRING') {
      const e = this.strings();
      return this.mk(start, { k: 'MatchValue', value: e } as any);
    }
    if (t.type === 'NAME') {
      if (t.value === 'None' || t.value === 'True' || t.value === 'False') {
        this.next();
        return this.mk(start, { k: 'MatchSingleton', value: t.value === 'None' ? null : t.value === 'True' } as any);
      }
      if (KEYWORDS.has(t.value)) this.fail();
      // nombre: captura, comodín, valor (a.b) o clase (Nombre(...))
      this.next();
      if (this.isOp('.') || this.isOp('(')) {
        let e: Expr = this.mk(start, { k: 'Name', id: t.value, ctx: 'Load' } as any);
        while (this.isOp('.')) {
          this.next();
          const a = this.expectName();
          e = this.mk(start, { k: 'Attribute', value: e, attr: a.value, ctx: 'Load' } as any);
        }
        if (this.isOp('(')) return this.classPattern(e, start);
        return this.mk(start, { k: 'MatchValue', value: e } as any);
      }
      if (t.value === '_') return this.mk(start, { k: 'MatchAs', pattern: null, name: null } as any);
      return this.mk(start, { k: 'MatchAs', pattern: null, name: t.value } as any);
    }
    if (t.type === 'OP') {
      if (t.value === '(') {
        this.next();
        this.lv++;
        if (this.isOp(')')) { this.next(); this.lv--; return this.mk(start, { k: 'MatchSequence', patterns: [] } as any); }
        const first = this.maybeStarPattern();
        if (this.isOp(',')) {
          const ps = [first];
          while (this.eatOp(',')) {
            if (this.isOp(')')) break;
            ps.push(this.maybeStarPattern());
          }
          this.expectOp(')');
          this.lv--;
          return this.mk(start, { k: 'MatchSequence', patterns: ps } as any);
        }
        this.expectOp(')');
        this.lv--;
        if (first.k === 'MatchStar') return this.mk(start, { k: 'MatchSequence', patterns: [first] } as any);
        return first;
      }
      if (t.value === '[') {
        this.next();
        this.lv++;
        const ps: Pattern[] = [];
        while (!this.isOp(']')) {
          ps.push(this.maybeStarPattern());
          if (!this.eatOp(',')) break;
        }
        this.expectOp(']');
        this.lv--;
        return this.mk(start, { k: 'MatchSequence', patterns: ps } as any);
      }
      if (t.value === '{') return this.mappingPattern(start);
    }
    this.fail();
  }

  signedNumber(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let neg = false;
    if (t.type === 'OP' && t.value === '-') { this.next(); neg = true; }
    const nt = this.tok();
    if (nt.type !== 'NUMBER') this.fail();
    let e: Expr = this.atom();
    if (neg) e = this.mk(start, { k: 'UnaryOp', op: '-', operand: e } as any);
    // complejos: 1+2j, 1-2j
    if (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value as BinOpName;
      const rt = this.tok();
      if (rt.type !== 'NUMBER') this.fail();
      const r = this.atom();
      e = this.mk(start, { k: 'BinOp', left: e, op, right: r } as any);
    }
    return e;
  }

  mappingPattern(start: { line: number; col: number }): Pattern {
    this.next();
    this.lv++;
    const keys: Expr[] = [];
    const patterns: Pattern[] = [];
    let rest: string | null = null;
    while (!this.isOp('}')) {
      if (this.isOp('**')) {
        this.next();
        rest = this.expectName().value;
        if (this.eatOp(',') && !this.isOp('}')) this.fail();
        break;
      } else {
        const t = this.tok();
        const ks = { line: t.line, col: t.col };
        let key: Expr;
        if (t.type === 'NUMBER' || (t.type === 'OP' && t.value === '-')) key = this.signedNumber();
        else if (t.type === 'STRING') key = this.strings();
        else if (t.type === 'NAME' && (t.value === 'None' || t.value === 'True' || t.value === 'False')) key = this.atom();
        else if (t.type === 'NAME' && !KEYWORDS.has(t.value)) {
          this.next();
          key = this.mk(ks, { k: 'Name', id: t.value, ctx: 'Load' } as any);
          if (!this.isOp('.')) this.fail();
          while (this.isOp('.')) {
            this.next();
            const a = this.expectName();
            key = this.mk(ks, { k: 'Attribute', value: key, attr: a.value, ctx: 'Load' } as any);
          }
        } else this.fail();
        this.expectOp(':');
        keys.push(key);
        patterns.push(this.asPattern());
      }
      if (!this.eatOp(',')) break;
    }
    this.expectOp('}');
    this.lv--;
    return this.mk(start, { k: 'MatchMapping', keys, patterns, rest } as any);
  }

  classPattern(cls: Expr, start: { line: number; col: number }): Pattern {
    this.expectOp('(');
    this.lv++;
    const patterns: Pattern[] = [];
    const kwdAttrs: string[] = [];
    const kwdPatterns: Pattern[] = [];
    while (!this.isOp(')')) {
      const t = this.tok();
      if (t.type === 'NAME' && !KEYWORDS.has(t.value) && this.peekAt(1).type === 'OP' && this.peekAt(1).value === '=') {
        this.next(); this.next();
        kwdAttrs.push(t.value);
        kwdPatterns.push(this.asPattern());
      } else {
        if (kwdAttrs.length > 0) this.err('positional patterns follow keyword patterns', t);
        patterns.push(this.asPattern());
      }
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    this.lv--;
    return this.mk(start, { k: 'MatchClass', cls, patterns, kwdAttrs, kwdPatterns } as any);
  }

  // ───────────── expresiones ─────────────

  /** star_expressions: `a, b, *c` (tupla sin paréntesis) */
  starExpressions(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.starExpression();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.exprEnds()) break;
      elts.push(this.starExpression());
    }
    return this.mk(start, { k: 'Tuple', elts, ctx: 'Load' } as any);
  }

  /** el token actual no puede iniciar una expresión (fin de una lista con coma final) */
  exprEnds(): boolean {
    const t = this.tok();
    if (t.type === 'NEWLINE' || t.type === 'EOF') return true;
    if (t.type === 'OP') return !['(', '[', '{', '-', '+', '~', '*', '...', '**'].includes(t.value) || false;
    if (t.type === 'NAME') return ['in', 'is', 'and', 'or', 'if', 'else', 'as', 'for', 'from', 'import', 'while', 'async'].includes(t.value) && !(t.value === 'async' && false) ? true : (t.value === 'as');
    return false;
  }

  starExpression(): Expr {
    const t = this.tok();
    if (t.type === 'OP' && t.value === '*') {
      this.next();
      const v = this.bitOr();
      return this.mk({ line: t.line, col: t.col }, { k: 'Starred', value: v, ctx: 'Load' } as any);
    }
    return this.expression();
  }

  starNamedExpression(): Expr {
    const t = this.tok();
    if (t.type === 'OP' && t.value === '*') {
      this.next();
      const v = this.bitOr();
      return this.mk({ line: t.line, col: t.col }, { k: 'Starred', value: v, ctx: 'Load' } as any);
    }
    return this.namedExpression();
  }

  namedExpression(): Expr {
    const t = this.tok();
    if (t.type === 'NAME' && !KEYWORDS.has(t.value)) {
      const n = this.peekAt(1);
      if (n.type === 'OP' && n.value === ':=') {
        this.next(); this.next();
        const target = this.mk({ line: t.line, col: t.col }, { k: 'Name', id: t.value, ctx: 'Store' } as any) as Name;
        target.endLine = t.endLine; target.endCol = t.endCol;
        const value = this.expression();
        return this.mk({ line: t.line, col: t.col }, { k: 'NamedExpr', target, value } as any);
      }
    }
    const e = this.expression();
    if (this.isOp(':=')) {
      this.err(`cannot use assignment expressions with ${exprName(e)}`, e);
    }
    if (this.isOp('=') && !this.noEq) this.assignHint(e);
    return e;
  }

  /** `if x = 3:` → sugerencia de CPython (invalid_named_expression) */
  assignHint(e: Expr): void {
    const save = this.p;
    const sp = [this.pl, this.pc, this.lv];
    let b: Expr | null = null;
    try {
      this.next();
      b = this.bitOr();
      if (this.isOp('=') || this.isOp(':=')) b = null;
    } catch (err) {
      if (!(err instanceof PySyntaxErr)) throw err;
      b = null;
    }
    this.p = save; this.pl = sp[0]; this.pc = sp[1]; this.lv = sp[2];
    if (!b) return;
    if (e.k === 'Name') {
      const er = new PySyntaxErr('SyntaxError', "invalid syntax. Maybe you meant '==' or ':=' instead of '='?", e.line, e.col, b.endLine, b.endCol);
      (er as any).definite = true;
      throw er;
    }
    const brack = e.k === 'List' || e.k === 'Tuple' || e.k === 'GeneratorExp' || (e.k === 'Constant' && (e.vt === 'none' || e.vt === 'bool'));
    if (!brack) {
      const er = new PySyntaxErr('SyntaxError', `cannot assign to ${exprName(e)} here. Maybe you meant '==' instead of '='?`, e.line, e.col, e.endLine, e.endCol);
      (er as any).definite = true;
      throw er;
    }
  }

  expression(): Expr {
    const t = this.tok();
    if (t.type === 'NAME' && t.value === 'lambda') return this.lambdef();
    const start = { line: t.line, col: t.col };
    const body = this.disjunction();
    if (this.isKw('if')) {
      this.next();
      const test = this.disjunction();
      if (!this.isKw('else')) {
        // a if b  (sin else)
        const nt = this.tok();
        if (nt.type !== 'OP' || nt.value !== ':') {
          throw new PySyntaxErr('SyntaxError', "expected 'else' after 'if' expression", body.line, body.col, test.endLine, test.endCol);
        }
        this.fail();
      }
      this.next();
      const orelse = this.expression();
      return this.mk(start, { k: 'IfExp', test, body, orelse } as any);
    }
    return body;
  }

  lambdef(): Expr {
    const kw = this.next();
    const start = { line: kw.line, col: kw.col };
    const args = this.parameters(':', false);
    this.expectOp(':');
    const body = this.expression();
    return this.mk(start, { k: 'Lambda', args, body } as any);
  }

  disjunction(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.conjunction();
    let r = first;
    if (this.isKw('or')) {
      const values = [first];
      while (this.eatKw('or')) values.push(this.conjunction());
      r = this.mk(start, { k: 'BoolOp', op: 'or', values } as any);
    }
    this.lastDisj = r;
    return r;
  }
  conjunction(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.inversion();
    if (!this.isKw('and')) return first;
    const values = [first];
    while (this.eatKw('and')) values.push(this.inversion());
    return this.mk(start, { k: 'BoolOp', op: 'and', values } as any);
  }
  inversion(): Expr {
    const t = this.tok();
    if (t.type === 'NAME' && t.value === 'not') {
      this.next();
      const operand = this.inversion();
      return this.mk({ line: t.line, col: t.col }, { k: 'UnaryOp', op: 'not', operand } as any);
    }
    return this.comparison();
  }

  comparison(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const left = this.bitOr();
    let ops: CmpOpName[] | null = null;
    let comparators: Expr[] | null = null;
    for (;;) {
      const c = this.tok();
      let op: CmpOpName | null = null;
      if (c.type === 'OP') {
        if (CMP_OPS.has(c.value)) { op = c.value as CmpOpName; this.next(); }
        else if (c.value === '<>') {
          throw new PySyntaxErr('SyntaxError', "invalid syntax.  Maybe you meant '!=' instead of '<>'?", c.line, c.col, c.endLine, c.endCol);
        }
      } else if (c.type === 'NAME') {
        if (c.value === 'in') { op = 'in'; this.next(); }
        else if (c.value === 'is') {
          this.next();
          if (this.isKw('not')) { this.next(); op = 'is not'; } else op = 'is';
        } else if (c.value === 'not') {
          const n = this.peekAt(1);
          if (n.type === 'NAME' && n.value === 'in') { this.next(); this.next(); op = 'not in'; }
        }
      }
      if (!op) break;
      if (!ops) { ops = []; comparators = []; }
      ops.push(op);
      comparators!.push(this.bitOr());
    }
    if (!ops) return left;
    return this.mk(start, { k: 'Compare', left, ops, comparators } as any);
  }

  bitOr(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.bitXor();
    while (this.isOp('|')) {
      this.next();
      const right = this.bitXor();
      left = this.mk(start, { k: 'BinOp', left, op: '|', right } as any);
    }
    return left;
  }
  bitXor(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.bitAnd();
    while (this.isOp('^')) {
      this.next();
      const right = this.bitAnd();
      left = this.mk(start, { k: 'BinOp', left, op: '^', right } as any);
    }
    return left;
  }
  bitAnd(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.shift();
    while (this.isOp('&')) {
      this.next();
      const right = this.shift();
      left = this.mk(start, { k: 'BinOp', left, op: '&', right } as any);
    }
    return left;
  }
  shift(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.sum();
    for (;;) {
      const c = this.tok();
      if (c.type === 'OP' && SHIFT_OPS.has(c.value)) {
        this.next();
        const right = this.sum();
        left = this.mk(start, { k: 'BinOp', left, op: c.value, right } as any);
      } else break;
    }
    return left;
  }
  sum(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.term();
    for (;;) {
      const c = this.tok();
      if (c.type === 'OP' && SUM_OPS.has(c.value)) {
        this.next();
        const right = this.term();
        left = this.mk(start, { k: 'BinOp', left, op: c.value, right } as any);
      } else break;
    }
    return left;
  }
  term(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let left = this.factor();
    for (;;) {
      const c = this.tok();
      if (c.type === 'OP' && TERM_OPS.has(c.value)) {
        this.next();
        const right = this.factor();
        left = this.mk(start, { k: 'BinOp', left, op: c.value, right } as any);
      } else break;
    }
    return left;
  }
  factor(): Expr {
    const t = this.tok();
    if (t.type === 'OP' && (t.value === '-' || t.value === '+' || t.value === '~')) {
      this.next();
      const operand = this.factor();
      return this.mk({ line: t.line, col: t.col }, { k: 'UnaryOp', op: t.value, operand } as any);
    }
    return this.power();
  }
  power(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const left = this.awaitPrimary();
    if (this.isOp('**')) {
      this.next();
      const right = this.factor();
      return this.mk(start, { k: 'BinOp', left, op: '**', right } as any);
    }
    return left;
  }
  awaitPrimary(): Expr {
    const t = this.tok();
    if (t.type === 'NAME' && t.value === 'await') {
      this.next();
      const value = this.primary();
      return this.mk({ line: t.line, col: t.col }, { k: 'Await', value } as any);
    }
    return this.primary();
  }

  primary(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    let e = this.atom();
    for (;;) {
      const c = this.tok();
      if (c.type !== 'OP') break;
      if (c.value === '.') {
        this.next();
        const n = this.tok();
        if (n.type !== 'NAME' || KEYWORDS.has(n.value)) this.fail();
        this.next();
        e = this.mk(start, { k: 'Attribute', value: e, attr: n.value, ctx: 'Load' } as any);
      } else if (c.value === '(') {
        this.next();
        this.lv++;
        const { args, keywords } = this.callArgs();
        this.expectOp(')');
        this.lv--;
        if (args.length === 1 && args[0].k === 'GeneratorExp' && !args[0].paren) {
          const g = args[0];
          g.line = c.line; g.col = c.col; g.endLine = this.pl; g.endCol = this.pc;
        }
        e = this.mk(start, { k: 'Call', func: e, args, keywords } as any);
      } else if (c.value === '[') {
        this.next();
        this.lv++;
        const slice = this.slices();
        this.expectOp(']');
        this.lv--;
        e = this.mk(start, { k: 'Subscript', value: e, slice, ctx: 'Load' } as any);
      } else break;
    }
    return e;
  }

  slices(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    const first = this.sliceItem();
    if (!this.isOp(',')) return first;
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isOp(']')) break;
      elts.push(this.sliceItem());
    }
    return this.mk(start, { k: 'Tuple', elts, ctx: 'Load' } as any);
  }

  sliceItem(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    if (t.type === 'OP' && t.value === '*') return this.starNamedExpression();
    let lower: Expr | null = null;
    if (!this.isOp(':')) {
      lower = this.namedExpression();
      if (!this.isOp(':')) return lower;
    }
    this.expectOp(':');
    let upper: Expr | null = null;
    let step: Expr | null = null;
    if (!this.isOp(':') && !this.isOp(',') && !this.isOp(']')) upper = this.expression();
    if (this.eatOp(':')) {
      if (!this.isOp(',') && !this.isOp(']')) step = this.expression();
    }
    return this.mk(start, { k: 'Slice', lower, upper, step } as any) as Slice;
  }

  callArgs(): { args: Expr[]; keywords: Keyword[] } {
    const args: Expr[] = [];
    const keywords: Keyword[] = [];
    let sawKw = false;
    let sawKwUnpack = false;
    let pending: { msg: string; from?: { line: number; col: number }; end?: { line: number; col: number } } | null = null;
    const savedNoEq = this.noEq;
    this.noEq = true;
    while (!this.isOp(')')) {
      const t = this.tok();
      const start = { line: t.line, col: t.col };
      if (t.type === 'OP' && t.value === '**') {
        this.next();
        const value = this.expression();
        keywords.push(this.mk(start, { arg: null, value } as any));
        sawKwUnpack = true;
      } else if (t.type === 'OP' && t.value === '*') {
        const comma = this.toks[this.p - 1];
        this.next();
        const value = this.expression();
        const st = this.mk(start, { k: 'Starred', value, ctx: 'Load' } as any);
        if (sawKwUnpack && !pending) pending = { msg: 'iterable argument unpacking follows keyword argument unpacking', from: { line: comma.line, col: comma.col }, end: { line: st.endLine, col: st.endCol } };
        args.push(st);
      } else if (t.type === 'NAME' && !KEYWORDS.has(t.value) && this.peekAt(1).type === 'OP' && this.peekAt(1).value === '=') {
        this.next(); this.next();
        const value = this.expression();
        if (keywords.some((k) => k.arg === t.value)) {
          this.err(`keyword argument repeated: ${t.value}`, this.mk(start, { k: 'Name', id: t.value, ctx: 'Load' } as any));
        }
        keywords.push(this.mk(start, { arg: t.value, value } as any));
        sawKw = true;
      } else {
        let e = this.namedExpression();
        if (this.isOp('=')) {
          const eq = this.tok();
          if (e.k === 'Name') this.fail();
          const isKwConst = e.k === 'Constant' && (e.vt === 'none' || e.vt === 'bool');
          const msg = isKwConst ? `cannot assign to ${exprName(e)}` : 'expression cannot contain assignment, perhaps you meant "=="?';
          throw new PySyntaxErr('SyntaxError', msg, e.line, e.col, eq.endLine, eq.endCol);
        }
        if (this.isKw('for') || (this.isKw('async') && this.peekAt(1).value === 'for')) {
          // generador como único argumento
          const generators = this.compFor();
          e = this.mk(start, { k: 'GeneratorExp', elt: e, generators } as any);
          if (args.length > 0 || keywords.length > 0 || this.isOp(',')) {
            this.err('Generator expression must be parenthesized', e);
          }
        }
        if (!pending && sawKwUnpack) pending = { msg: 'positional argument follows keyword argument unpacking' };
        else if (!pending && sawKw) pending = { msg: 'positional argument follows keyword argument' };
        args.push(e);
      }
      if (!this.isOp(',')) {
        if (!this.isOp(')')) this.missingComma();
        break;
      }
      this.next();
    }
    this.noEq = savedNoEq;
    if (pending) {
      const t = this.tok();
      throw new PySyntaxErr('SyntaxError', pending.msg, pending.from ? pending.from.line : t.line, pending.from ? pending.from.col : t.col, pending.end ? pending.end.line : t.endLine, pending.end ? pending.end.col : t.endCol);
    }
    return { args, keywords };
  }

  /** `foo(a b)` → "invalid syntax. Perhaps you forgot a comma?" */
  missingComma(): never {
    const prev = this.lastDisj;
    const save = this.p;
    const sp = [this.pl, this.pc, this.lv];
    const t = this.tok();
    if (prev && this.lv > 0 && this.canStartExpr(t)) {
      const prevTok = this.toks[this.p - 1];
      // `NAME STRING` y palabras clave blandas no cuentan
      const isNameString = prev.k === 'Name' && t.type === 'STRING';
      if (!isNameString) {
        try {
          this.noInvalid++;
          const b = this.expression();
          this.noInvalid--;
          if (this.lv > 0 && prevTok) {
            throw new PySyntaxErr('SyntaxError', 'invalid syntax. Perhaps you forgot a comma?', prev.line, prev.col, b.endLine, b.endCol);
          }
        } catch (e) {
          if (e instanceof PySyntaxErr && e.msg.startsWith('invalid syntax. Perhaps')) throw e;
          this.noInvalid = 0;
          this.p = save; this.pl = sp[0]; this.pc = sp[1]; this.lv = sp[2];
        }
      }
    }
    this.fail();
  }

  canStartExpr(t: Token): boolean {
    if (t.type === 'NUMBER' || t.type === 'STRING') return true;
    if (t.type === 'NAME') return !KEYWORDS.has(t.value) || ['None', 'True', 'False', 'not', 'lambda', 'await', 'yield'].includes(t.value);
    if (t.type === 'OP') return ['(', '[', '{', '-', '+', '~', '...'].includes(t.value);
    return false;
  }

  compFor(): Comprehension[] {
    const out: Comprehension[] = [];
    for (;;) {
      let isAsync = false;
      if (this.isKw('async') && this.peekAt(1).value === 'for') { this.next(); isAsync = true; }
      if (!this.isKw('for')) break;
      this.next();
      const tg = this.targetList();
      const target = this.toStore(tg, 'comp');
      this.expectKw('in');
      const iter = this.disjunction();
      const ifs: Expr[] = [];
      while (this.isKw('if')) {
        this.next();
        ifs.push(this.disjunction());
      }
      out.push({ target, iter, ifs, isAsync });
    }
    return out;
  }

  yieldExpr(): Expr {
    const kw = this.next(); // yield
    const start = { line: kw.line, col: kw.col };
    if (this.isKw('from')) {
      this.next();
      const value = this.expression();
      return this.mk(start, { k: 'YieldFrom', value } as any);
    }
    let value: Expr | null = null;
    if (!this.yieldEnds()) value = this.starExpressions();
    return this.mk(start, { k: 'Yield', value } as any);
  }
  yieldEnds(): boolean {
    const t = this.tok();
    if (t.type === 'NEWLINE' || t.type === 'EOF') return true;
    if (t.type === 'OP') return t.value === ')' || t.value === ']' || t.value === '}' || t.value === ';' || t.value === '=' || t.value === ':' || t.value === ',';
    return false;
  }

  atom(): Expr {
    const t = this.tok();
    const start = { line: t.line, col: t.col };
    switch (t.type) {
      case 'NAME': {
        if (KEYWORDS.has(t.value)) {
          if (t.value === 'None') { this.next(); return this.mk(start, { k: 'Constant', vt: 'none', value: null } as any); }
          if (t.value === 'True') { this.next(); return this.mk(start, { k: 'Constant', vt: 'bool', value: true } as any); }
          if (t.value === 'False') { this.next(); return this.mk(start, { k: 'Constant', vt: 'bool', value: false } as any); }
          this.fail();
        }
        this.next();
        return this.mk(start, { k: 'Name', id: t.value, ctx: 'Load' } as any);
      }
      case 'NUMBER': this.next(); return this.number(t);
      case 'STRING': return this.strings();
      case 'OP': break;
      default: this.fail();
    }
    switch (t.value) {
      case '(': return this.parenAtom(start);
      case '[': return this.listAtom(start);
      case '{': return this.braceAtom(start);
      case '...': this.next(); return this.mk(start, { k: 'Constant', vt: 'ellipsis', value: null } as any);
      default: this.fail();
    }
  }

  number(t: Token): Constant {
    const text = t.value.replace(/_/g, '');
    const start = { line: t.line, col: t.col };
    const last = text[text.length - 1];
    if (last === 'j' || last === 'J') {
      return this.mk(start, { k: 'Constant', vt: 'complex', value: parseFloat(text.slice(0, -1)) } as any);
    }
    const low = text.toLowerCase();
    if (low.startsWith('0x') || low.startsWith('0o') || low.startsWith('0b')) {
      const v = BigInt(low);
      return this.mk(start, { k: 'Constant', vt: 'int', value: normBig(v) } as any);
    }
    if (/[.eE]/.test(text)) {
      return this.mk(start, { k: 'Constant', vt: 'float', value: parseFloat(text) } as any);
    }
    if (text.length <= 15) return this.mk(start, { k: 'Constant', vt: 'int', value: parseInt(text, 10) } as any);
    return this.mk(start, { k: 'Constant', vt: 'int', value: normBig(BigInt(text)) } as any);
  }

  parenAtom(start: { line: number; col: number }): Expr {
    this.next(); // (
    this.lv++;
    if (this.isOp(')')) {
      this.next(); this.lv--;
      return this.mk(start, { k: 'Tuple', elts: [], ctx: 'Load', paren: true } as any);
    }
    if (this.isKw('yield')) {
      const y = this.yieldExpr();
      this.expectOp(')');
      this.lv--;
      y.paren = true;
      return y;
    }
    const first = this.starNamedExpression();
    // generador
    if (this.isKw('for') || (this.isKw('async') && this.peekAt(1).value === 'for')) {
      if (first.k === 'Starred') this.err("iterable unpacking cannot be used in comprehension", first);
      const generators = this.compFor();
      this.expectOp(')');
      this.lv--;
      return this.mk(start, { k: 'GeneratorExp', elt: first, generators, paren: true } as any);
    }
    if (this.isOp(',')) {
      const elts = [first];
      while (this.eatOp(',')) {
        if (this.isOp(')')) break;
        elts.push(this.starNamedExpression());
      }
      if (!this.isOp(')')) this.missingComma();
      this.expectOp(')');
      this.lv--;
      return this.mk(start, { k: 'Tuple', elts, ctx: 'Load', paren: true } as any);
    }
    if (!this.isOp(')')) this.missingComma();
    this.expectOp(')');
    this.lv--;
    if (first.k === 'Starred') this.err("cannot use starred expression here", first);
    first.paren = true;
    return first;
  }

  listAtom(start: { line: number; col: number }): Expr {
    this.next();
    this.lv++;
    if (this.isOp(']')) { this.next(); this.lv--; return this.mk(start, { k: 'List', elts: [], ctx: 'Load' } as any); }
    const first = this.starNamedExpression();
    if (this.isKw('for') || (this.isKw('async') && this.peekAt(1).value === 'for')) {
      if (first.k === 'Starred') this.err('iterable unpacking cannot be used in comprehension', first);
      const generators = this.compFor();
      this.expectOp(']');
      this.lv--;
      return this.mk(start, { k: 'ListComp', elt: first, generators } as any);
    }
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isOp(']')) break;
      elts.push(this.starNamedExpression());
    }
    if (!this.isOp(']')) this.missingComma();
    this.expectOp(']');
    this.lv--;
    return this.mk(start, { k: 'List', elts, ctx: 'Load' } as any);
  }

  braceAtom(start: { line: number; col: number }): Expr {
    this.next();
    this.lv++;
    if (this.isOp('}')) { this.next(); this.lv--; return this.mk(start, { k: 'Dict', keys: [], values: [] } as any); }
    // diccionario o conjunto
    if (this.isOp('**')) {
      return this.dictRest(start, [], [], true);
    }
    const first = this.starNamedExpression();
    if (this.isOp(':') && first.k !== 'Starred') {
      const colon = this.next();
      if (this.isOp('}') || this.isOp(',')) {
        throw new PySyntaxErr('SyntaxError', "expression expected after dictionary key and ':'", colon.line, colon.col, colon.endLine, colon.endCol);
      }
      const value = this.expression();
      if (this.isKw('for') || (this.isKw('async') && this.peekAt(1).value === 'for')) {
        const generators = this.compFor();
        this.expectOp('}');
        this.lv--;
        return this.mk(start, { k: 'DictComp', key: first, value, generators } as any);
      }
      return this.dictRest(start, [first], [value], this.eatOp(','));
    }
    // conjunto
    if (this.isKw('for') || (this.isKw('async') && this.peekAt(1).value === 'for')) {
      if (first.k === 'Starred') this.err('iterable unpacking cannot be used in comprehension', first);
      const generators = this.compFor();
      this.expectOp('}');
      this.lv--;
      return this.mk(start, { k: 'SetComp', elt: first, generators } as any);
    }
    const elts = [first];
    while (this.eatOp(',')) {
      if (this.isOp('}')) break;
      elts.push(this.starNamedExpression());
    }
    if (!this.isOp('}')) this.missingComma();
    this.expectOp('}');
    this.lv--;
    return this.mk(start, { k: 'Set', elts } as any);
  }

  dictRest(start: { line: number; col: number }, keys: (Expr | null)[], values: Expr[], afterComma: boolean): Expr {
    if (afterComma || keys.length === 0) {
      while (!this.isOp('}')) {
        if (this.isOp('**')) {
          this.next();
          keys.push(null);
          values.push(this.bitOr());
        } else {
          const k = this.expression();
          if (!this.isOp(':')) {
            if (this.isOp(',') || this.isOp('}')) {
              // clave sin valor: `{1: 2, 3}`
              throw new PySyntaxErr('SyntaxError', "':' expected after dictionary key", k.line, k.col, k.endLine, -1);
            }
            this.missingComma();
          }
          this.next();
          if (this.isOp('}') || this.isOp(',')) {
            const colon = this.toks[this.p - 1];
            throw new PySyntaxErr('SyntaxError', "expression expected after dictionary key and ':'", colon.line, colon.col, colon.endLine, colon.endCol);
          }
          keys.push(k);
          values.push(this.expression());
        }
        if (!this.eatOp(',')) break;
      }
    }
    if (!this.isOp('}')) this.missingComma();
    this.expectOp('}');
    this.lv--;
    return this.mk(start, { k: 'Dict', keys, values } as any);
  }

  // ───────────── cadenas y f-strings ─────────────

  strings(): Expr {
    const first = this.tok();
    const start = { line: first.line, col: first.col };
    const toks: Token[] = [];
    while (this.tok().type === 'STRING') toks.push(this.next());
    let anyBytes = false;
    let anyStr = false;
    let anyF = false;
    const infos = toks.map((t) => {
      const m = /^([a-zA-Z]*)('''|"""|'|")/.exec(t.value)!;
      const prefix = m[1].toLowerCase();
      const q = m[2];
      const isBytes = prefix.includes('b');
      if (isBytes) anyBytes = true; else anyStr = true;
      if (prefix.includes('f')) anyF = true;
      return { t, prefix, q, bodyStart: t.start + m[1].length + q.length, bodyEnd: t.end - q.length, raw: prefix.includes('r'), isBytes, isF: prefix.includes('f') };
    });
    if (anyBytes && anyStr) {
      const nt = this.tok();
      throw new PySyntaxErr('SyntaxError', 'cannot mix bytes and nonbytes literals', nt.line, nt.col, nt.endLine, nt.endCol);
    }
    if (anyBytes) {
      const parts: number[] = [];
      for (const inf of infos) {
        const body = this.src.slice(inf.bodyStart, inf.bodyEnd);
        for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) > 127) this.err('bytes can only contain ASCII literal characters', inf.t);
        const bytes = this.decodeBytes(body, inf.raw, inf.t);
        for (const b of bytes) parts.push(b);
      }
      return this.mk(start, { k: 'Constant', vt: 'bytes', value: Uint8Array.from(parts) } as any);
    }
    if (!anyF) {
      let s = '';
      for (const inf of infos) s += this.decodeStr(this.src.slice(inf.bodyStart, inf.bodyEnd), inf.raw, inf.t);
      return this.mk(start, { k: 'Constant', vt: 'str', value: s } as any);
    }
    // f-strings (posiblemente mezcladas con literales)
    const values: Expr[] = [];
    const acc: LitAcc = { text: '', start: -1, end: -1, tok: toks[0] };
    for (const inf of infos) {
      acc.tok = inf.t;
      if (!inf.isF) {
        acc.text += this.decodeStr(this.src.slice(inf.bodyStart, inf.bodyEnd), inf.raw, inf.t);
        if (acc.start < 0) acc.start = inf.t.start;
        acc.end = inf.t.end;
        continue;
      }
      const q = inf.q[0];
      const r = scanFParts(this.src, inf.bodyStart, inf.bodyEnd, q, inf.q.length === 3, inf.raw, false);
      if (r.err && r.err !== 'unterminated') {
        const pos = r.errPos ?? inf.t.start;
        const line = this.table.lineOf(pos);
        const col = this.table.colOf(pos);
        throw new PySyntaxErr('SyntaxError', r.err, line, col, line, col + 1);
      }
      this.fparts(r.parts, inf.raw, inf.t, values, acc);
    }
    this.flushLit(values, acc);
    return this.mk(start, { k: 'JoinedStr', values } as any);
  }

  flushLit(values: Expr[], acc: LitAcc): void {
    if (acc.text === '') { acc.start = -1; return; }
    const sl = this.table.lineOf(acc.start);
    const sc = this.table.colOf(acc.start);
    const el = this.table.lineOf(acc.end);
    const ec = this.table.colOf(acc.end);
    values.push({ k: 'Constant', vt: 'str', value: acc.text, line: sl, col: sc, endLine: el, endCol: ec } as Constant);
    acc.text = '';
    acc.start = -1;
    acc.end = -1;
  }

  fparts(parts: FStrPart[], raw: boolean, tok: Token, values: Expr[], acc: LitAcc): void {
    for (const part of parts) {
      if (part.kind === 'lit') {
        acc.text += this.decodeStr(part.text!, raw, tok, true);
        if (acc.start < 0) acc.start = part.start;
        acc.end = part.end;
        continue;
      }
      if (part.selfDoc !== undefined) {
        acc.text += part.selfDoc;
        if (acc.start < 0) acc.start = part.start + 1;
        acc.end = part.start + 1 + part.selfDoc.length;
      }
      this.flushLit(values, acc);
      const value = this.fexpr(part);
      let conversion = -1;
      if (part.conv) conversion = part.conv.charCodeAt(0);
      else if (part.selfDoc !== undefined && !part.spec) conversion = 114;
      let formatSpec: JoinedStr | null = null;
      if (part.spec) {
        const sv: Expr[] = [];
        const sacc: LitAcc = { text: '', start: -1, end: -1, tok };
        this.fparts(part.spec, raw, tok, sv, sacc);
        this.flushLit(sv, sacc);
        const sp = part.specStart!;
        formatSpec = { k: 'JoinedStr', values: sv, line: this.table.lineOf(sp - 1), col: this.table.colOf(sp - 1), endLine: this.table.lineOf(part.end - 1), endCol: this.table.colOf(part.end - 1) } as JoinedStr;
      }
      const fv: FormattedValue = {
        k: 'FormattedValue', value, conversion, formatSpec,
        line: this.table.lineOf(part.start), col: this.table.colOf(part.start),
        endLine: this.table.lineOf(part.end - 1), endCol: this.table.colOf(part.end - 1) + 1,
      };
      values.push(fv);
    }
  }

  fexpr(part: FStrPart): Expr {
    const s = part.exprStart!;
    const e = part.exprEnd!;
    if (this.src.slice(s, e).trim() === '') {
      const ch = this.src[e] === '=' ? '=' : this.src[e] === '!' ? '!' : this.src[e] === ':' ? ':' : '}';
      const line = this.table.lineOf(e);
      const col = this.table.colOf(e);
      throw new PySyntaxErr('SyntaxError', `f-string: valid expression required before '${ch}'`, line, col, line, col + 1);
    }
    const sub = tokenize(this.src, this.table, { start: s, end: e, nested: true });
    if (sub.error) throw new PySyntaxErr(sub.error.kind, sub.error.msg, sub.error.line, sub.error.col, sub.error.endLine, sub.error.endCol);
    const sp = new Parser(this.src, this.table, sub);
    sp.inFString = this.inFString + 1;
    sp.lv = 1;
    sp.warnings = this.warnings;
    let ex: Expr;
    try {
      if (sp.isKw('yield')) ex = sp.yieldExpr();
      else ex = sp.starExpressions();
    } catch (err) {
      if (err instanceof PySyntaxErr && err.msg === 'invalid syntax') {
        // la expresión no se pudo completar: CPython informa en el primer token sobrante
        const idx = Math.max(0, sp.p - (sp.toks[sp.p].type === 'EOF' ? 1 : 0));
        const t = sp.toks[Math.min(idx, sp.toks.length - 1)];
        if (sp.p === 0) {
          throw new PySyntaxErr('SyntaxError', "f-string: expecting a valid expression after '{'", t.line, t.col, t.endLine, t.endCol);
        }
        throw new PySyntaxErr('SyntaxError', "f-string: expecting '=', or '!', or ':', or '}'", t.line, t.col, t.endLine, t.endCol);
      }
      throw err;
    }
    const t = sp.tok();
    if (t.type !== 'EOF') {
      if (sp.lastDisj && sp.canStartExpr(t)) sp.missingComma();
      throw new PySyntaxErr('SyntaxError', "f-string: expecting '=', or '!', or ':', or '}'", t.line, t.col, t.endLine, t.endCol);
    }
    return ex;
  }

  decodeStr(body: string, raw: boolean, tok: Token, inF = false): string {
    if (raw || body.indexOf('\\') < 0) return body;
    let out = '';
    const n = body.length;
    for (let i = 0; i < n; i++) {
      const c = body[i];
      if (c !== '\\') { out += c; continue; }
      i++;
      if (i >= n) { out += '\\'; break; }
      const d = body[i];
      switch (d) {
        case '\n': break;
        case '\\': out += '\\'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case 'a': out += '\x07'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'v': out += '\v'; break;
        case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
          let j = i;
          let v = 0;
          let cnt = 0;
          while (j < n && cnt < 3 && body[j] >= '0' && body[j] <= '7') { v = v * 8 + (body.charCodeAt(j) - 48); j++; cnt++; }
          if (v > 255 && false) { /* sin aviso */ }
          out += String.fromCharCode(v);
          i = j - 1;
          break;
        }
        case 'x': case 'u': case 'U': {
          const len = d === 'x' ? 2 : d === 'u' ? 4 : 8;
          const hex = body.slice(i + 1, i + 1 + len);
          if (hex.length < len || !/^[0-9a-fA-F]+$/.test(hex)) {
            const bad = hex.match(/^[0-9a-fA-F]*/)![0].length;
            const endPos = i - 1 + 1 + bad; // posición del último dígito válido
            const startPos = i - 1;
            this.unicodeErr(`(unicode error) 'unicodeescape' codec can't decode bytes in position ${startPos}-${endPos}: truncated \\${d === 'x' ? 'xXX' : d === 'u' ? 'uXXXX' : 'UXXXXXXXX'} escape`, tok);
          }
          const cp = parseInt(hex, 16);
          if (cp > 0x10ffff) this.unicodeErr(`(unicode error) 'unicodeescape' codec can't decode bytes in position ${i - 1}-${i + len}: illegal Unicode character`, tok);
          out += String.fromCodePoint(cp);
          i += len;
          break;
        }
        case 'N': {
          const m = /^\{([^}]*)\}/.exec(body.slice(i + 1));
          if (!m) this.unicodeErr(`(unicode error) 'unicodeescape' codec can't decode bytes in position ${i - 1}-${i}: malformed \\N character escape`, tok);
          const cp = unicodeByName(m![1]);
          if (cp === null) this.unicodeErr(`(unicode error) 'unicodeescape' codec can't decode bytes in position ${i - 1}-${i + m![0].length}: unknown Unicode character name`, tok);
          out += String.fromCodePoint(cp!);
          i += m![0].length;
          break;
        }
        default:
          out += '\\' + d;
          this.warnings.push({ msg: `invalid escape sequence '\\${d}'`, line: tok.line, col: tok.col, category: 'SyntaxWarning' });
          break;
      }
    }
    void inF;
    return out;
  }

  unicodeErr(msg: string, tok: Token): never {
    throw new PySyntaxErr('SyntaxError', msg, tok.line, tok.col, tok.endLine, tok.endCol);
  }

  decodeBytes(body: string, raw: boolean, tok: Token): number[] {
    const out: number[] = [];
    const n = body.length;
    for (let i = 0; i < n; i++) {
      const c = body[i];
      if (c !== '\\' || raw) { out.push(body.charCodeAt(i)); continue; }
      i++;
      if (i >= n) { out.push(92); break; }
      const d = body[i];
      switch (d) {
        case '\n': break;
        case '\\': out.push(92); break;
        case "'": out.push(39); break;
        case '"': out.push(34); break;
        case 'a': out.push(7); break;
        case 'b': out.push(8); break;
        case 'f': out.push(12); break;
        case 'n': out.push(10); break;
        case 'r': out.push(13); break;
        case 't': out.push(9); break;
        case 'v': out.push(11); break;
        case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
          let j = i; let v = 0; let cnt = 0;
          while (j < n && cnt < 3 && body[j] >= '0' && body[j] <= '7') { v = v * 8 + (body.charCodeAt(j) - 48); j++; cnt++; }
          out.push(v & 255);
          i = j - 1;
          break;
        }
        case 'x': {
          const hex = body.slice(i + 1, i + 3);
          if (hex.length < 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
            throw new PySyntaxErr('SyntaxError', `(value error) invalid \\x escape at position ${i - 1}`, tok.line, tok.col, tok.endLine, tok.endCol);
          }
          out.push(parseInt(hex, 16));
          i += 2;
          break;
        }
        default:
          out.push(92, d.charCodeAt(0));
          this.warnings.push({ msg: `invalid escape sequence '\\${d}'`, line: tok.line, col: tok.col, category: 'SyntaxWarning' });
          break;
      }
    }
    return out;
  }
}

export function normBig(v: bigint): number | bigint {
  if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v;
}

/** Nombres Unicode más comunes para `\N{...}` (no se incluye la base de datos completa). */
const UNI_NAMES: Record<string, number> = {
  'LATIN SMALL LETTER A WITH ACUTE': 0xe1, 'LATIN SMALL LETTER E WITH ACUTE': 0xe9, 'LATIN SMALL LETTER I WITH ACUTE': 0xed,
  'LATIN SMALL LETTER O WITH ACUTE': 0xf3, 'LATIN SMALL LETTER U WITH ACUTE': 0xfa, 'LATIN SMALL LETTER N WITH TILDE': 0xf1,
  'LATIN CAPITAL LETTER N WITH TILDE': 0xd1, 'GREEK SMALL LETTER ALPHA': 0x3b1, 'GREEK SMALL LETTER BETA': 0x3b2,
  'GREEK SMALL LETTER GAMMA': 0x3b3, 'GREEK SMALL LETTER DELTA': 0x3b4, 'GREEK SMALL LETTER PI': 0x3c0,
  'GREEK CAPITAL LETTER OMEGA': 0x3a9, 'GREEK SMALL LETTER OMEGA': 0x3c9, 'GREEK CAPITAL LETTER SIGMA': 0x3a3,
  'GREEK SMALL LETTER SIGMA': 0x3c3, 'GREEK SMALL LETTER MU': 0x3bc, 'GREEK CAPITAL LETTER DELTA': 0x394,
  'EURO SIGN': 0x20ac, 'POUND SIGN': 0xa3, 'YEN SIGN': 0xa5, 'COPYRIGHT SIGN': 0xa9, 'REGISTERED SIGN': 0xae,
  'DEGREE SIGN': 0xb0, 'PLUS-MINUS SIGN': 0xb1, 'MICRO SIGN': 0xb5, 'MULTIPLICATION SIGN': 0xd7, 'DIVISION SIGN': 0xf7,
  'BULLET': 0x2022, 'EM DASH': 0x2014, 'EN DASH': 0x2013, 'HORIZONTAL ELLIPSIS': 0x2026, 'RIGHTWARDS ARROW': 0x2192,
  'LEFTWARDS ARROW': 0x2190, 'UPWARDS ARROW': 0x2191, 'DOWNWARDS ARROW': 0x2193, 'CHECK MARK': 0x2713,
  'HEAVY CHECK MARK': 0x2714, 'BALLOT X': 0x2717, 'INFINITY': 0x221e, 'SQUARE ROOT': 0x221a, 'SNOWMAN': 0x2603,
  'BLACK HEART SUIT': 0x2665, 'WHITE SMILING FACE': 0x263a, 'GRINNING FACE': 0x1f600, 'SMILING FACE WITH SMILING EYES': 0x1f60a,
  'PILE OF POO': 0x1f4a9, 'SNAKE': 0x1f40d, 'ROCKET': 0x1f680, 'THUMBS UP SIGN': 0x1f44d, 'FIRE': 0x1f525,
  'SPACE': 0x20, 'NO-BREAK SPACE': 0xa0, 'LATIN SMALL LETTER SHARP S': 0xdf, 'LATIN SMALL LETTER E WITH GRAVE': 0xe8,
  'LATIN SMALL LETTER U WITH DIAERESIS': 0xfc, 'LATIN SMALL LETTER O WITH DIAERESIS': 0xf6, 'LATIN SMALL LETTER A WITH DIAERESIS': 0xe4,
  'NULL': 0, 'LINE FEED': 10, 'CARRIAGE RETURN': 13, 'CHARACTER TABULATION': 9, 'DIGIT ZERO': 0x30, 'LATIN CAPITAL LETTER A': 0x41,
  'LATIN SMALL LETTER A': 0x61, 'LATIN SMALL LETTER E': 0x65,
};
export function unicodeByName(name: string): number | null {
  const v = UNI_NAMES[name.toUpperCase()];
  return v === undefined ? null : v;
}

// ───────────── punto de entrada ─────────────

export function parseSource(source: string, mode: ParseMode = 'exec'): ParseResult {
  const src = normalizeNewlines(source);
  const table = new LineTable(src);
  const lex = tokenize(src, table);
  const parser = new Parser(src, table, lex);
  let module: Module;
  try {
    module = parser.parseModule(mode);
  } catch (e) {
    if (e instanceof PySyntaxErr) throw finalizeError(e, parser, lex);
    throw e;
  }
  return { module, src, table, warnings: parser.warnings };
}

/** Reglas de CPython tras un error del parser: los errores léxicos posteriores y los paréntesis sin cerrar tienen prioridad. */
function finalizeError(e: PySyntaxErr, parser: Parser, lex: LexResult): PySyntaxErr {
  if ((e as any).fromLexer) return e;
  if (lex.error) {
    const le = lex.error;
    const r = new PySyntaxErr(le.kind, le.msg, le.line, le.col, le.endLine, le.endCol, le.eof);
    return r;
  }
  if (lex.open.length > 0) {
    const inner = lex.open[0];
    const lastTok = parser.toks[Math.min(parser.furthest, parser.toks.length - 1)];
    const errLine = lastTok ? lastTok.line : e.line;
    if (errLine > inner.line) {
      return new PySyntaxErr('SyntaxError', `'${inner.ch}' was never closed`, inner.line, inner.col, inner.line, -1, true);
    }
  }
  return e;
}
