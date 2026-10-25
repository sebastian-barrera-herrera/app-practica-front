/** Analizador sintáctico de SQL (descenso recursivo). Los errores salen en español, con pista cuando se puede. */
import type {
  AlterAction, Assignment, ColumnDef, Cte, Expr, FrameBound, FromItem, OnConflict, OrderItem, Query, QueryBody, RefAction, SelItem, Select, Stmt, TableConstraint, TypeName, WindowSpec,
} from './ast';
import { tokenize, type Token } from './lexer';
import { syntaxError, type SqlType } from './types';

/** Palabras que no pueden ser un alias ni un nombre sin comillas. */
const RESERVED = new Set(
  `ALL AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLLATE CONSTRAINT CREATE CROSS CURRENT DEFAULT DELETE DESC DISTINCT DROP ELSE END EXCEPT EXISTS FALSE FETCH FILTER FOR FOREIGN FROM FULL GROUP HAVING IN INNER INSERT INTERSECT INTO IS JOIN LEFT LIKE LIMIT NATURAL NOT NULL OFFSET ON OR ORDER OUTER OVER PARTITION PRIMARY REFERENCES RETURNING RIGHT SELECT SET SOME TABLE THEN TO TRUE UNION UNIQUE UPDATE USING VALUES WHEN WHERE WINDOW WITH`.split(/\s+/),
);

/** Palabras clave que se pueden confundir con una errata (para sugerir «¿quisiste escribir…?»). */
const SUGGEST_WORDS = [
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'ON', 'USING', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'DISTINCT', 'UNION', 'INTERSECT', 'EXCEPT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DROP', 'ALTER',
  'INDEX', 'VIEW', 'WITH', 'OVER', 'PARTITION', 'EXISTS', 'ASC', 'DESC', 'RETURNING', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'UNIQUE', 'CHECK', 'BEGIN', 'COMMIT', 'ROLLBACK',
];

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 9;
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n];
}

/** La palabra clave más parecida a `word` (si hay una razonablemente cercana). */
export function closestWord(word: string, words: string[], max = 2): string | undefined {
  const w = word.toUpperCase();
  let best: string | undefined;
  let bestD = max + 1;
  for (const c of words) {
    const cu = c.toUpperCase();
    // una palabra que empieza por la otra (UPPERCASE → UPPER) también se considera parecida
    const d = cu !== w && w.length >= 4 && cu.length >= 4 && (w.startsWith(cu) || cu.startsWith(w)) ? 1 : editDistance(w, cu);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const TYPE_MAP: Record<string, SqlType> = {
  int: 'int', integer: 'int', bigint: 'int', smallint: 'int', tinyint: 'int', serial: 'int', bigserial: 'int', int2: 'int', int4: 'int', int8: 'int', mediumint: 'int',
  real: 'real', float: 'real', float4: 'real', float8: 'real', double: 'real', numeric: 'real', decimal: 'real', money: 'real',
  text: 'text', varchar: 'text', char: 'text', character: 'text', string: 'text', nvarchar: 'text', nchar: 'text', clob: 'text', uuid: 'text', json: 'text', jsonb: 'text',
  boolean: 'bool', bool: 'bool',
  date: 'date',
  timestamp: 'timestamp', datetime: 'timestamp', timestamptz: 'timestamp', time: 'text',
};

export interface ParsedStatement {
  stmt: Stmt;
  /** Texto de la sentencia tal como la escribió el alumno. */
  sql: string;
  pos: number;
}

class Parser {
  toks: Token[];
  i = 0;
  constructor(public src: string) {
    this.toks = tokenize(src);
  }

  // ───────── utilidades ─────────
  get t(): Token {
    return this.toks[this.i];
  }
  peekAt(n: number): Token {
    return this.toks[Math.min(this.toks.length - 1, this.i + n)];
  }
  next(): Token {
    const t = this.toks[this.i];
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  isKw(name: string, t: Token = this.t): boolean {
    return t.kind === 'id' && t.text.toUpperCase() === name;
  }
  isOp(op: string, t: Token = this.t): boolean {
    return t.kind === 'op' && t.text === op;
  }
  acceptKw(name: string): boolean {
    if (this.isKw(name)) {
      this.next();
      return true;
    }
    return false;
  }
  acceptOp(op: string): boolean {
    if (this.isOp(op)) {
      this.next();
      return true;
    }
    return false;
  }
  show(t: Token = this.t): string {
    return t.kind === 'eof' ? 'el final de la consulta' : `«${this.src.slice(t.pos, t.end)}»`;
  }
  fail(expected: string, hint?: string): never {
    const t = this.t;
    let h = hint;
    if (!h && t.kind === 'id') {
      const near = closestWord(t.text, SUGGEST_WORDS);
      if (near && near !== t.text.toUpperCase()) h = `¿Quisiste escribir ${near}?`;
    }
    throw syntaxError(`Error de sintaxis: se esperaba ${expected} pero aparece ${this.show(t)}`, t.pos, h);
  }
  expectKw(name: string, ctx?: string): void {
    if (!this.acceptKw(name)) this.fail(ctx ?? name);
  }
  expectOp(op: string, what?: string): void {
    if (!this.acceptOp(op)) {
      let hint: string | undefined;
      if (op === ')' && this.t.kind !== 'eof') hint = 'Revisa que cada paréntesis abierto tenga su cierre';
      if (op === ')' && this.t.kind === 'eof') hint = 'Falta cerrar un paréntesis';
      this.fail(what ?? `«${op}»`, hint);
    }
  }
  /** Identificador (con o sin comillas) que no sea una palabra reservada. */
  ident(what = 'un nombre'): string {
    const t = this.t;
    if (t.kind === 'qid') {
      this.next();
      return t.text;
    }
    if (t.kind === 'id' && !RESERVED.has(t.text.toUpperCase())) {
      this.next();
      return t.text;
    }
    if (t.kind === 'id') throw syntaxError(`${this.show(t)} es una palabra reservada de SQL y no se puede usar como nombre`, t.pos, `Ponla entre comillas dobles ("${t.text}") o elige otro nombre`);
    return this.fail(what);
  }
  /** Nombre que puede ser cualquier palabra (después de un punto, etc.). */
  anyName(what = 'un nombre'): string {
    const t = this.t;
    if (t.kind === 'qid' || t.kind === 'id') {
      this.next();
      return t.text;
    }
    return this.fail(what);
  }
  /** Nombre posiblemente calificado (esquema.tabla): se queda con la última parte. */
  tableName(): string {
    let n = this.ident('el nombre de una tabla');
    while (this.isOp('.') && (this.peekAt(1).kind === 'id' || this.peekAt(1).kind === 'qid')) {
      this.next();
      n = this.anyName();
    }
    return n;
  }
  isEof(): boolean {
    return this.t.kind === 'eof';
  }

  // ───────── script ─────────
  script(): ParsedStatement[] {
    const out: ParsedStatement[] = [];
    for (;;) {
      while (this.acceptOp(';'));
      if (this.isEof()) break;
      const start = this.t.pos;
      const stmt = this.statement();
      const end = this.toks[this.i - 1]?.end ?? this.t.pos;
      out.push({ stmt, sql: this.src.slice(start, end), pos: start });
      if (!this.isEof() && !this.isOp(';')) {
        this.fail('el final de la sentencia (;)', this.looksLikeMissingComma());
      }
    }
    return out;
  }

  /** Si la palabra anterior parece una palabra clave mal escrita (FORM por FROM), lo dice. */
  looksLikeMissingComma(): string | undefined {
    const prev = this.toks[this.i - 1];
    if (prev && prev.kind === 'id') {
      const near = closestWord(prev.text, SUGGEST_WORDS);
      if (near && near !== prev.text.toUpperCase() && prev.text.length > 2) return `¿Escribiste «${prev.text}» en vez de ${near}?`;
    }
    return undefined;
  }

  statement(): Stmt {
    const t = this.t;
    if (this.isOp('.') && this.peekAt(1).kind === 'id') {
      this.next();
      const cmd = this.next().text.toLowerCase();
      const arg = this.t.kind === 'id' || this.t.kind === 'qid' ? this.next().text : undefined;
      return { k: 'meta', cmd, arg };
    }
    if (t.kind !== 'id' && !this.isOp('(')) this.fail('el comienzo de una sentencia (SELECT, INSERT, UPDATE, DELETE, CREATE…)');
    const w = t.kind === 'id' ? t.text.toUpperCase() : '(';
    switch (w) {
      case 'SELECT':
      case 'WITH':
      case 'VALUES':
      case '(':
        return { k: 'query', q: this.query() };
      case 'INSERT':
      case 'REPLACE':
        return this.insert();
      case 'UPDATE':
        return this.update();
      case 'DELETE':
        return this.delete();
      case 'CREATE':
        return this.create();
      case 'DROP':
        return this.drop();
      case 'ALTER':
        return this.alter();
      case 'TRUNCATE': {
        const pos = this.next().pos;
        this.acceptKw('TABLE');
        return { k: 'truncate', table: this.tableName(), pos };
      }
      case 'BEGIN':
      case 'START': {
        this.next();
        this.acceptKw('TRANSACTION') || this.acceptKw('WORK') || this.acceptKw('DEFERRED') || this.acceptKw('IMMEDIATE') || this.acceptKw('EXCLUSIVE');
        if (this.isKw('TRANSACTION')) this.next();
        return { k: 'tx', op: 'begin' };
      }
      case 'COMMIT':
      case 'END': {
        this.next();
        this.acceptKw('TRANSACTION') || this.acceptKw('WORK');
        return { k: 'tx', op: 'commit' };
      }
      case 'ROLLBACK': {
        this.next();
        this.acceptKw('TRANSACTION') || this.acceptKw('WORK');
        if (this.acceptKw('TO')) {
          this.acceptKw('SAVEPOINT');
          return { k: 'tx', op: 'rollback_to', name: this.ident('el nombre del punto de guardado') };
        }
        return { k: 'tx', op: 'rollback' };
      }
      case 'SAVEPOINT':
        this.next();
        return { k: 'tx', op: 'savepoint', name: this.ident('el nombre del punto de guardado') };
      case 'RELEASE':
        this.next();
        this.acceptKw('SAVEPOINT');
        return { k: 'tx', op: 'release', name: this.ident('el nombre del punto de guardado') };
      case 'EXPLAIN': {
        this.next();
        let analyze = false;
        if (this.acceptKw('QUERY')) this.expectKw('PLAN');
        if (this.acceptKw('ANALYZE')) analyze = true;
        return { k: 'explain', stmt: this.statement(), analyze };
      }
      case 'PRAGMA': {
        this.next();
        const name = this.anyName().toLowerCase();
        let arg: string | undefined;
        if (this.acceptOp('(')) {
          arg = this.anyName();
          this.expectOp(')');
        } else if (this.acceptOp('=')) arg = this.next().text;
        return { k: 'pragma', name, arg };
      }
      case 'SHOW': {
        this.next();
        const what = this.anyName().toLowerCase();
        return { k: 'meta', cmd: what === 'tables' ? 'tables' : what, arg: undefined };
      }
      case 'DESCRIBE':
      case 'DESC': {
        this.next();
        return { k: 'meta', cmd: 'schema', arg: this.tableName() };
      }
      default: {
        const near = closestWord(t.text, ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'WITH', 'BEGIN', 'COMMIT', 'ROLLBACK', 'EXPLAIN', 'TRUNCATE', 'VALUES']);
        throw syntaxError(`Sentencia no reconocida: ${this.show(t)}`, t.pos, near ? `¿Quisiste escribir ${near}?` : 'Una sentencia empieza por SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER…');
      }
    }
  }

  // ───────── consultas ─────────
  query(): Query {
    let withClause: Query['with'];
    if (this.isKw('WITH')) {
      this.next();
      const recursive = this.acceptKw('RECURSIVE');
      const ctes: Cte[] = [];
      do {
        const name = this.ident('el nombre de la CTE');
        let cols: string[] | undefined;
        if (this.acceptOp('(')) {
          cols = [];
          do cols.push(this.ident('el nombre de una columna'));
          while (this.acceptOp(','));
          this.expectOp(')');
        }
        this.expectKw('AS');
        if (this.acceptKw('NOT')) this.expectKw('MATERIALIZED');
        else this.acceptKw('MATERIALIZED');
        this.expectOp('(');
        const q = this.query();
        this.expectOp(')');
        ctes.push({ name, cols, q });
      } while (this.acceptOp(','));
      withClause = { recursive, ctes };
    }
    const body = this.setExpr();
    const q: Query = { with: withClause, body };
    if (this.isKw('ORDER')) {
      this.next();
      this.expectKw('BY');
      q.order = this.orderList();
    }
    // LIMIT / OFFSET / FETCH en cualquier orden
    for (;;) {
      if (this.isKw('LIMIT')) {
        this.next();
        if (this.acceptKw('ALL')) continue;
        const first = this.expr();
        if (this.acceptOp(',')) {
          // LIMIT desplazamiento, cantidad (MySQL/SQLite)
          q.offset = first;
          q.limit = this.expr();
        } else q.limit = first;
      } else if (this.isKw('OFFSET')) {
        this.next();
        q.offset = this.expr();
        this.acceptKw('ROWS') || this.acceptKw('ROW');
      } else if (this.isKw('FETCH')) {
        this.next();
        this.acceptKw('FIRST') || this.acceptKw('NEXT');
        q.limit = this.isKw('ROW') || this.isKw('ROWS') ? { k: 'lit', v: 1, t: 'int', pos: this.t.pos } : this.expr();
        this.acceptKw('ROWS') || this.acceptKw('ROW');
        this.expectKw('ONLY');
      } else break;
    }
    return q;
  }

  /** UNION / EXCEPT (misma precedencia, de izquierda a derecha); INTERSECT une más fuerte. */
  setExpr(): QueryBody {
    let left = this.intersectExpr();
    while (this.isKw('UNION') || this.isKw('EXCEPT')) {
      const op = this.next().text.toLowerCase() as 'union' | 'except';
      const all = this.acceptKw('ALL');
      if (!all) this.acceptKw('DISTINCT');
      const right = this.intersectExpr();
      left = { k: 'set', op, all, l: left, r: right };
    }
    return left;
  }

  intersectExpr(): QueryBody {
    let left = this.selectPrimary();
    while (this.isKw('INTERSECT')) {
      this.next();
      const all = this.acceptKw('ALL');
      if (!all) this.acceptKw('DISTINCT');
      const right = this.selectPrimary();
      left = { k: 'set', op: 'intersect', all, l: left, r: right };
    }
    return left;
  }

  selectPrimary(): QueryBody {
    if (this.isOp('(')) {
      this.next();
      const q = this.query();
      this.expectOp(')');
      return { k: 'sub', q };
    }
    if (this.isKw('VALUES')) {
      this.next();
      return { k: 'values', rows: this.valuesRows() };
    }
    return this.select();
  }

  valuesRows(): Expr[][] {
    const rows: Expr[][] = [];
    do {
      this.expectOp('(');
      const row: Expr[] = [];
      do row.push(this.exprOrDefault());
      while (this.acceptOp(','));
      this.expectOp(')');
      rows.push(row);
    } while (this.acceptOp(','));
    return rows;
  }

  exprOrDefault(): Expr {
    if (this.isKw('DEFAULT')) {
      const pos = this.next().pos;
      return { k: 'fn', name: '__default', args: [], distinct: false, star: false, pos };
    }
    return this.expr();
  }

  select(): Select {
    if (!this.isKw('SELECT')) this.fail('SELECT', this.t.kind === 'id' ? undefined : undefined);
    const pos = this.next().pos;
    let distinct: Select['distinct'] = false;
    if (this.acceptKw('DISTINCT')) {
      distinct = true;
      if (this.acceptKw('ON')) {
        this.expectOp('(');
        const on: Expr[] = [];
        do on.push(this.expr());
        while (this.acceptOp(','));
        this.expectOp(')');
        distinct = on;
      }
    } else this.acceptKw('ALL');
    const items = this.selectItems();
    const s: Select = { k: 'select', distinct, items, pos };
    if (this.acceptKw('FROM')) s.from = this.fromList();
    if (this.acceptKw('WHERE')) s.where = this.expr();
    if (this.isKw('GROUP')) {
      this.next();
      this.expectKw('BY');
      this.groupBy(s);
    }
    if (this.acceptKw('HAVING')) s.having = this.expr();
    if (this.isKw('WINDOW')) {
      this.next();
      s.windows = {};
      do {
        const name = this.ident('el nombre de la ventana');
        this.expectKw('AS');
        s.windows[name.toLowerCase()] = this.windowSpec();
      } while (this.acceptOp(','));
    }
    return s;
  }

  selectItems(): SelItem[] {
    const items: SelItem[] = [];
    do {
      if (this.isKw('FROM') && items.length > 0) {
        throw syntaxError('Error de sintaxis: sobra una coma antes de FROM', this.toks[this.i - 1].pos, 'Quita la última coma de la lista de columnas');
      }
      if (this.isOp('*')) {
        const pos = this.next().pos;
        items.push({ e: { k: 'star', pos } });
        continue;
      }
      const e = this.expr();
      let alias: string | undefined;
      if (this.acceptKw('AS')) {
        alias = this.t.kind === 'str' ? this.next().text : this.anyName('el alias de la columna');
      } else if (this.t.kind === 'qid' || (this.t.kind === 'id' && !RESERVED.has(this.t.text.toUpperCase()) && !this.isClauseStart())) {
        alias = this.next().text;
      } else if (this.t.kind === 'str') {
        alias = this.next().text;
      }
      items.push({ e, alias });
    } while (this.acceptOp(','));
    return items;
  }

  /** Palabras que empiezan la siguiente cláusula (nunca son un alias). */
  isClauseStart(): boolean {
    const t = this.t;
    if (t.kind !== 'id') return false;
    const u = t.text.toUpperCase();
    return ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'FETCH', 'RETURNING', 'ON', 'USING', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'SET', 'WHEN', 'THEN', 'ELSE', 'END'].includes(u);
  }

  groupBy(s: Select): void {
    const exprs: Expr[] = [];
    const keyOf = (e: Expr) => JSON.stringify(e, (k, v) => (k === 'pos' ? undefined : v));
    const indexOf = (e: Expr): number => {
      const key = keyOf(e);
      const at = exprs.findIndex((x) => keyOf(x) === key);
      if (at >= 0) return at;
      exprs.push(e);
      return exprs.length - 1;
    };
    // ROLLUP(a,b) → {a,b} {a} {} ; CUBE(a,b) → todas las combinaciones ; GROUPING SETS ((a),(b),())
    const sets: number[][] = [];
    let special = false;
    const parseOne = (): number[][] => {
      if (this.isKw('ROLLUP') || this.isKw('CUBE')) {
        special = true;
        const cube = this.next().text.toUpperCase() === 'CUBE';
        this.expectOp('(');
        const idx: number[] = [];
        do idx.push(indexOf(this.expr()));
        while (this.acceptOp(','));
        this.expectOp(')');
        if (!cube) return Array.from({ length: idx.length + 1 }, (_, n) => idx.slice(0, idx.length - n));
        const all: number[][] = [];
        for (let m = (1 << idx.length) - 1; m >= 0; m--) all.push(idx.filter((_, b) => m & (1 << (idx.length - 1 - b))));
        return all;
      }
      if (this.isKw('GROUPING') && this.isKw('SETS', this.peekAt(1))) {
        special = true;
        this.next();
        this.next();
        this.expectOp('(');
        const out: number[][] = [];
        do {
          if (this.acceptOp('(')) {
            const g: number[] = [];
            if (!this.isOp(')')) {
              do g.push(indexOf(this.expr()));
              while (this.acceptOp(','));
            }
            this.expectOp(')');
            out.push(g);
          } else out.push([indexOf(this.expr())]);
        } while (this.acceptOp(','));
        this.expectOp(')');
        return out;
      }
      const e = this.expr();
      const i = indexOf(e);
      return [[i]];
    };
    let product: number[][] = [[]];
    do {
      const part = parseOne();
      // producto cartesiano de los distintos elementos del GROUP BY
      const next: number[][] = [];
      for (const a of product) for (const b of part) next.push([...a, ...b.filter((x) => !a.includes(x))]);
      product = next;
    } while (this.acceptOp(','));
    sets.push(...product);
    s.groupBy = exprs;
    if (special) s.groupingSets = sets;
  }

  orderList(): OrderItem[] {
    const out: OrderItem[] = [];
    do {
      const e = this.expr();
      let desc = false;
      if (this.acceptKw('DESC')) desc = true;
      else this.acceptKw('ASC');
      let nullsFirst: boolean | undefined;
      if (this.acceptKw('NULLS')) {
        if (this.acceptKw('FIRST')) nullsFirst = true;
        else if (this.acceptKw('LAST')) nullsFirst = false;
        else this.fail('FIRST o LAST');
      }
      out.push({ e, desc, nullsFirst });
    } while (this.acceptOp(','));
    return out;
  }

  // ───────── FROM ─────────
  fromList(): FromItem {
    let left = this.joinChain();
    while (this.acceptOp(',')) {
      const right = this.joinChain();
      left = { k: 'join', type: 'cross', l: left, r: right, natural: false };
    }
    return left;
  }

  joinChain(): FromItem {
    let left = this.tableFactor();
    for (;;) {
      let natural = false;
      let type: 'inner' | 'left' | 'right' | 'full' | 'cross' | null = null;
      const save = this.i;
      if (this.acceptKw('NATURAL')) natural = true;
      if (this.acceptKw('CROSS')) type = 'cross';
      else if (this.acceptKw('INNER')) type = 'inner';
      else if (this.acceptKw('LEFT')) type = 'left';
      else if (this.acceptKw('RIGHT')) type = 'right';
      else if (this.acceptKw('FULL')) type = 'full';
      if (type === 'left' || type === 'right' || type === 'full') this.acceptKw('OUTER');
      if (this.isKw('JOIN')) {
        this.next();
        type = type ?? 'inner';
      } else if (type !== null || natural) {
        this.i = save;
        this.fail('JOIN', type ? `Después de ${type.toUpperCase()} va la palabra JOIN` : undefined);
      } else break;
      const right = this.tableFactor();
      let on: Expr | undefined;
      let using: string[] | undefined;
      if (type !== 'cross' && !natural) {
        if (this.acceptKw('ON')) on = this.expr();
        else if (this.acceptKw('USING')) {
          this.expectOp('(');
          using = [];
          do using.push(this.ident('el nombre de una columna'));
          while (this.acceptOp(','));
          this.expectOp(')');
        } else {
          throw syntaxError(`Error de sintaxis: el ${type!.toUpperCase()} JOIN necesita una condición`, this.t.pos, 'Añade ON tabla1.columna = tabla2.columna (o USING (columna))');
        }
      }
      left = { k: 'join', type, l: left, r: right, on, using, natural };
    }
    return left;
  }

  tableAlias(): { alias?: string; cols?: string[] } {
    let alias: string | undefined;
    if (this.acceptKw('AS')) alias = this.anyName('el alias de la tabla');
    else if (this.t.kind === 'qid' || (this.t.kind === 'id' && !RESERVED.has(this.t.text.toUpperCase()) && !this.isClauseStart())) alias = this.next().text;
    let cols: string[] | undefined;
    if (alias && this.isOp('(')) {
      this.next();
      cols = [];
      do cols.push(this.ident('el nombre de una columna'));
      while (this.acceptOp(','));
      this.expectOp(')');
    }
    return { alias, cols };
  }

  tableFactor(): FromItem {
    if (this.isOp('(')) {
      this.next();
      if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES') || this.isOp('(')) {
        const q = this.query();
        this.expectOp(')');
        const { alias, cols } = this.tableAlias();
        if (!alias) throw syntaxError('Error de sintaxis: una subconsulta en FROM necesita un alias', this.t.pos, 'Añade un nombre después del paréntesis: (SELECT …) AS nombre');
        return { k: 'sub', q, alias, cols };
      }
      const inner = this.fromList();
      this.expectOp(')');
      return inner;
    }
    if (this.isKw('VALUES')) {
      this.next();
      const rows = this.valuesRows();
      const { alias, cols } = this.tableAlias();
      return { k: 'values', rows, alias: alias ?? 'valores', cols };
    }
    const pos = this.t.pos;
    const name = this.tableName();
    if (this.isOp('(')) {
      // función de tabla: generate_series(1, 10)
      this.next();
      const args: Expr[] = [];
      if (!this.isOp(')')) {
        do args.push(this.expr());
        while (this.acceptOp(','));
      }
      this.expectOp(')');
      const { alias, cols } = this.tableAlias();
      return { k: 'func', name: name.toLowerCase(), args, alias, cols, pos };
    }
    const { alias } = this.tableAlias();
    return { k: 'table', name, alias, pos };
  }

  // ───────── ventanas ─────────
  windowSpec(): WindowSpec {
    this.expectOp('(');
    const spec: WindowSpec = { partition: [], order: [] };
    if (this.t.kind === 'id' && !this.isKw('PARTITION') && !this.isKw('ORDER') && !this.isKw('ROWS') && !this.isKw('RANGE') && !this.isKw('GROUPS') && !RESERVED.has(this.t.text.toUpperCase())) spec.base = this.next().text.toLowerCase();
    if (this.acceptKw('PARTITION')) {
      this.expectKw('BY');
      do spec.partition.push(this.expr());
      while (this.acceptOp(','));
    }
    if (this.acceptKw('ORDER')) {
      this.expectKw('BY');
      spec.order = this.orderList();
    }
    if (this.isKw('ROWS') || this.isKw('RANGE') || this.isKw('GROUPS')) {
      const mode = this.next().text.toLowerCase() as 'rows' | 'range' | 'groups';
      let start: FrameBound;
      let end: FrameBound;
      if (this.acceptKw('BETWEEN')) {
        start = this.frameBound();
        this.expectKw('AND');
        end = this.frameBound();
      } else {
        start = this.frameBound();
        end = { kind: 'current' };
      }
      spec.frame = { mode, start, end };
    }
    this.expectOp(')');
    return spec;
  }

  frameBound(): FrameBound {
    if (this.acceptKw('UNBOUNDED')) {
      if (this.acceptKw('PRECEDING')) return { kind: 'unbounded_preceding' };
      this.expectKw('FOLLOWING');
      return { kind: 'unbounded_following' };
    }
    if (this.acceptKw('CURRENT')) {
      this.expectKw('ROW');
      return { kind: 'current' };
    }
    const n = this.unary();
    if (this.acceptKw('PRECEDING')) return { kind: 'preceding', n };
    this.expectKw('FOLLOWING');
    return { kind: 'following', n };
  }

  // ───────── expresiones ─────────
  expr(): Expr {
    return this.orExpr();
  }

  orExpr(): Expr {
    let l = this.andExpr();
    while (this.isKw('OR')) {
      const pos = this.next().pos;
      l = { k: 'bin', op: 'or', l, r: this.andExpr(), pos };
    }
    return l;
  }

  andExpr(): Expr {
    let l = this.notExpr();
    while (this.isKw('AND')) {
      const pos = this.next().pos;
      l = { k: 'bin', op: 'and', l, r: this.notExpr(), pos };
    }
    return l;
  }

  notExpr(): Expr {
    if (this.isKw('NOT') && !this.isKw('EXISTS', this.peekAt(1))) {
      const pos = this.next().pos;
      return { k: 'un', op: 'not', e: this.notExpr(), pos };
    }
    return this.isExpr();
  }

  /** IS [NOT] NULL / TRUE / FALSE / DISTINCT FROM */
  isExpr(): Expr {
    let l = this.cmpExpr();
    for (;;) {
      if (this.isKw('IS')) {
        const pos = this.next().pos;
        const not = this.acceptKw('NOT');
        if (this.acceptKw('NULL')) l = { k: 'isnull', e: l, not, pos };
        else if (this.acceptKw('TRUE')) l = { k: 'istruth', e: l, v: true, not, pos };
        else if (this.acceptKw('FALSE')) l = { k: 'istruth', e: l, v: false, not, pos };
        else if (this.acceptKw('DISTINCT')) {
          this.expectKw('FROM');
          l = { k: 'distinct', l, r: this.cmpExpr(), not, pos };
        } else this.fail('NULL, TRUE, FALSE o DISTINCT FROM después de IS');
      } else if (this.isKw('ISNULL')) {
        const pos = this.next().pos;
        l = { k: 'isnull', e: l, not: false, pos };
      } else if (this.isKw('NOTNULL')) {
        const pos = this.next().pos;
        l = { k: 'isnull', e: l, not: true, pos };
      } else break;
    }
    return l;
  }

  cmpExpr(): Expr {
    let l = this.predExpr();
    for (;;) {
      const t = this.t;
      if (t.kind === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>=', '<=>', '~', '~*', '!~'].includes(t.text)) {
        this.next();
        const op = t.text === '!=' ? '<>' : t.text;
        // = ANY (subconsulta) / = ALL (subconsulta)
        if (this.isKw('ANY') || this.isKw('ALL') || this.isKw('SOME')) {
          const w = this.t.text.toUpperCase();
          if (this.isOp('(', this.peekAt(1))) {
            this.next();
            this.next();
            const q = this.query();
            this.expectOp(')');
            l = { k: 'quant', op, kind: w === 'ALL' ? 'all' : 'any', e: l, q, pos: t.pos };
            continue;
          }
        }
        if (this.isOp('=') && t.text === '=') {
          throw syntaxError('Error de sintaxis: «==» no existe en SQL', this.t.pos, 'En SQL la igualdad se escribe con un solo =');
        }
        l = { k: 'bin', op, l, r: this.predExpr(), pos: t.pos };
      } else break;
    }
    return l;
  }

  /** BETWEEN / IN / LIKE / ILIKE (con NOT opcional delante) */
  predExpr(): Expr {
    let l = this.concatExpr();
    for (;;) {
      const save = this.i;
      const posTok = this.t;
      let not = false;
      if (this.isKw('NOT') && (this.isKw('BETWEEN', this.peekAt(1)) || this.isKw('IN', this.peekAt(1)) || this.isKw('LIKE', this.peekAt(1)) || this.isKw('ILIKE', this.peekAt(1)) || this.isKw('GLOB', this.peekAt(1)))) {
        this.next();
        not = true;
      }
      if (this.isKw('BETWEEN')) {
        this.next();
        this.acceptKw('SYMMETRIC');
        const lo = this.concatExpr();
        this.expectKw('AND', 'AND (BETWEEN a AND b)');
        const hi = this.concatExpr();
        l = { k: 'between', e: l, lo, hi, not, pos: posTok.pos };
      } else if (this.isKw('IN')) {
        this.next();
        this.expectOp('(', '«(» después de IN');
        if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES')) {
          const q = this.query();
          this.expectOp(')');
          l = { k: 'insub', e: l, q, not, pos: posTok.pos };
        } else {
          const list: Expr[] = [];
          if (!this.isOp(')')) {
            do list.push(this.expr());
            while (this.acceptOp(','));
          }
          this.expectOp(')');
          l = { k: 'in', e: l, list, not, pos: posTok.pos };
        }
      } else if (this.isKw('LIKE') || this.isKw('ILIKE') || this.isKw('GLOB')) {
        const w = this.next().text.toUpperCase();
        const pat = this.concatExpr();
        let esc: Expr | undefined;
        if (this.acceptKw('ESCAPE')) esc = this.concatExpr();
        l = w === 'GLOB' ? { k: 'fn', name: not ? '__not_glob' : '__glob', args: [l, pat], distinct: false, star: false, pos: posTok.pos } : { k: 'like', e: l, pat, esc, not, ci: w === 'ILIKE', pos: posTok.pos };
      } else {
        this.i = save;
        break;
      }
    }
    return l;
  }

  concatExpr(): Expr {
    let l = this.addExpr();
    while (this.isOp('||')) {
      const pos = this.next().pos;
      l = { k: 'bin', op: '||', l, r: this.addExpr(), pos };
    }
    return l;
  }

  addExpr(): Expr {
    let l = this.mulExpr();
    while (this.isOp('+') || this.isOp('-')) {
      const t = this.next();
      l = { k: 'bin', op: t.text, l, r: this.mulExpr(), pos: t.pos };
    }
    return l;
  }

  mulExpr(): Expr {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const t = this.next();
      l = { k: 'bin', op: t.text, l, r: this.unary(), pos: t.pos };
    }
    return l;
  }

  unary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const t = this.next();
      const e = this.unary();
      if (t.text === '-' && e.k === 'lit' && typeof e.v === 'number') return { k: 'lit', v: -e.v, t: e.t, pos: t.pos };
      return { k: 'un', op: t.text as '-' | '+', e, pos: t.pos };
    }
    return this.postfix();
  }

  postfix(): Expr {
    let e = this.primary();
    while (this.isOp('::')) {
      const pos = this.next().pos;
      e = { k: 'cast', e, type: this.typeName(), pos };
    }
    return e;
  }

  typeName(): TypeName {
    const first = this.anyName('un tipo de dato');
    let raw = first.toLowerCase();
    // DOUBLE PRECISION, CHARACTER VARYING, TIMESTAMP WITH(OUT) TIME ZONE
    if (raw === 'double' && this.acceptKw('PRECISION')) raw = 'double';
    if (raw === 'character' && this.acceptKw('VARYING')) raw = 'varchar';
    if ((raw === 'timestamp' || raw === 'time') && (this.isKw('WITH') || this.isKw('WITHOUT')) && this.isKw('TIME', this.peekAt(1))) {
      this.next();
      this.next();
      this.expectKw('ZONE');
    }
    const base = TYPE_MAP[raw];
    if (!base) {
      const near = closestWord(raw, Object.keys(TYPE_MAP), 2);
      throw syntaxError(`Tipo de dato desconocido: «${first}»`, this.toks[this.i - 1].pos, near ? `¿Quisiste decir ${near.toUpperCase()}?` : 'Tipos habituales: INTEGER, REAL, TEXT, VARCHAR(n), BOOLEAN, DATE, TIMESTAMP');
    }
    let len: number | undefined;
    let scale: number | undefined;
    if (this.isOp('(')) {
      this.next();
      const a = this.next();
      len = Number(a.text);
      if (this.acceptOp(',')) scale = Number(this.next().text);
      this.expectOp(')');
    }
    return { base, raw, len: base === 'text' ? len : undefined, scale: base === 'real' ? scale : undefined };
  }

  primary(): Expr {
    const t = this.t;
    switch (t.kind) {
      case 'num': {
        this.next();
        const isReal = /[.eE]/.test(t.text);
        return { k: 'lit', v: Number(t.text), t: isReal ? 'real' : 'int', pos: t.pos };
      }
      case 'str': {
        this.next();
        return { k: 'lit', v: t.text, t: 'text', pos: t.pos };
      }
      case 'qid': {
        this.next();
        return this.columnRest(t.text, t.pos, true);
      }
      case 'op': {
        if (t.text === '(') {
          this.next();
          if (this.isKw('SELECT') || this.isKw('WITH') || this.isKw('VALUES')) {
            const q = this.query();
            this.expectOp(')');
            return { k: 'subq', q, pos: t.pos };
          }
          const first = this.expr();
          if (this.acceptOp(',')) {
            const items = [first];
            do items.push(this.expr());
            while (this.acceptOp(','));
            this.expectOp(')');
            return { k: 'rowv', items, pos: t.pos };
          }
          this.expectOp(')');
          return first;
        }
        if (t.text === '*') this.fail('una expresión', 'El * solo se usa en SELECT * o COUNT(*)');
        return this.fail('una expresión', t.text === ',' || t.text === ')' ? 'Falta un valor o sobra una coma' : undefined);
      }
      case 'eof':
        return this.fail('una expresión', 'La consulta termina antes de tiempo: ¿falta algo?');
      case 'id':
        return this.primaryWord(t);
    }
    return this.fail('una expresión');
  }

  columnRest(first: string, pos: number, quoted: boolean): Expr {
    if (this.isOp('.')) {
      this.next();
      if (this.isOp('*')) {
        this.next();
        return { k: 'star', table: first, pos };
      }
      const name = this.anyName('el nombre de una columna');
      // esquema.tabla.columna → se queda con tabla.columna
      if (this.isOp('.') && (this.peekAt(1).kind === 'id' || this.peekAt(1).kind === 'qid')) {
        this.next();
        const col = this.anyName();
        return { k: 'col', table: name, name: col, quoted, pos };
      }
      return { k: 'col', table: first, name, quoted, pos };
    }
    return { k: 'col', name: first, quoted, pos };
  }

  primaryWord(t: Token): Expr {
    const w = t.text.toUpperCase();
    switch (w) {
      case 'NULL':
        this.next();
        return { k: 'lit', v: null, t: 'null', pos: t.pos };
      case 'TRUE':
        this.next();
        return { k: 'lit', v: true, t: 'bool', pos: t.pos };
      case 'FALSE':
        this.next();
        return { k: 'lit', v: false, t: 'bool', pos: t.pos };
      case 'CASE':
        return this.caseExpr();
      case 'CAST': {
        this.next();
        this.expectOp('(');
        const e = this.expr();
        this.expectKw('AS');
        const type = this.typeName();
        this.expectOp(')');
        return { k: 'cast', e, type, pos: t.pos };
      }
      case 'EXISTS': {
        this.next();
        this.expectOp('(');
        const q = this.query();
        this.expectOp(')');
        return { k: 'exists', q, not: false, pos: t.pos };
      }
      case 'NOT':
        if (this.isKw('EXISTS', this.peekAt(1))) {
          this.next();
          this.next();
          this.expectOp('(');
          const q = this.query();
          this.expectOp(')');
          return { k: 'exists', q, not: true, pos: t.pos };
        }
        break;
      case 'EXTRACT': {
        if (!this.isOp('(', this.peekAt(1))) break;
        this.next();
        this.next();
        const field = this.anyName('el campo (year, month, day…)').toLowerCase();
        this.expectKw('FROM');
        const e = this.expr();
        this.expectOp(')');
        return { k: 'extract', field, e, pos: t.pos };
      }
      case 'INTERVAL': {
        if (this.peekAt(1).kind !== 'str') break;
        this.next();
        const s = this.next();
        let text = s.text;
        // INTERVAL '3' DAY
        if (this.t.kind === 'id' && /^(year|month|day|hour|minute|second|week)s?$/i.test(this.t.text)) text += ` ${this.next().text}`;
        return { k: 'fn', name: '__interval', args: [{ k: 'lit', v: text, t: 'text', pos: s.pos }], distinct: false, star: false, pos: t.pos };
      }
      case 'DATE':
      case 'TIMESTAMP':
      case 'TIME':
        // DATE '2024-01-31'
        if (this.peekAt(1).kind === 'str') {
          this.next();
          const s = this.next();
          const base: SqlType = w === 'DATE' ? 'date' : w === 'TIMESTAMP' ? 'timestamp' : 'text';
          return { k: 'cast', e: { k: 'lit', v: s.text, t: 'text', pos: s.pos }, type: { base, raw: w.toLowerCase() }, pos: t.pos };
        }
        break;
      case 'CURRENT_DATE':
      case 'CURRENT_TIMESTAMP':
      case 'CURRENT_TIME':
      case 'LOCALTIMESTAMP':
        this.next();
        if (this.isOp('(') && this.isOp(')', this.peekAt(1))) {
          this.next();
          this.next();
        }
        return { k: 'fn', name: w.toLowerCase(), args: [], distinct: false, star: false, pos: t.pos };
      default:
        break;
    }
    if (RESERVED.has(w) && !this.isOp('(', this.peekAt(1))) {
      return this.fail('una expresión', w === 'FROM' ? 'Falta una columna o expresión antes de FROM' : w === 'WHERE' || w === 'GROUP' || w === 'ORDER' ? `Falta una expresión antes de ${w}` : undefined);
    }
    // llamada a función
    if (this.isOp('(', this.peekAt(1))) return this.functionCall();
    this.next();
    return this.columnRest(t.text, t.pos, false);
  }

  caseExpr(): Expr {
    const pos = this.next().pos;
    let operand: Expr | undefined;
    if (!this.isKw('WHEN')) operand = this.expr();
    const whens: [Expr, Expr][] = [];
    while (this.acceptKw('WHEN')) {
      const c = this.expr();
      this.expectKw('THEN');
      whens.push([c, this.expr()]);
    }
    if (whens.length === 0) this.fail('WHEN', 'CASE necesita al menos un WHEN … THEN …');
    let els: Expr | undefined;
    if (this.acceptKw('ELSE')) els = this.expr();
    this.expectKw('END', 'END (cierra el CASE)');
    return { k: 'case', operand, whens, else: els, pos };
  }

  functionCall(): Expr {
    const nameTok = this.next();
    const name = nameTok.text.toLowerCase();
    this.expectOp('(');
    const f: Extract<Expr, { k: 'fn' }> = { k: 'fn', name, args: [], distinct: false, star: false, pos: nameTok.pos };
    if (this.isOp('*') && this.isOp(')', this.peekAt(1))) {
      this.next();
      f.star = true;
    } else if (!this.isOp(')')) {
      if (this.acceptKw('DISTINCT')) f.distinct = true;
      else this.acceptKw('ALL');
      if (name === 'substring' || name === 'substr') {
        // SUBSTRING(x FROM a FOR b)
        f.args.push(this.expr());
        if (this.acceptKw('FROM')) {
          f.args.push(this.expr());
          if (this.acceptKw('FOR')) f.args.push(this.expr());
        } else {
          while (this.acceptOp(',')) f.args.push(this.expr());
        }
      } else if (name === 'trim' || name === 'ltrim' || name === 'rtrim') {
        // TRIM([LEADING|TRAILING|BOTH] [chars] FROM x)
        let side: string | undefined;
        if (this.isKw('LEADING') || this.isKw('TRAILING') || this.isKw('BOTH')) side = this.next().text.toLowerCase();
        if (side || this.isKw('FROM')) {
          let chars: Expr | undefined;
          if (!this.isKw('FROM')) chars = this.expr();
          this.expectKw('FROM');
          f.args.push(this.expr());
          if (chars) f.args.push(chars);
          if (side) f.name = side === 'leading' ? 'ltrim' : side === 'trailing' ? 'rtrim' : 'trim';
        } else {
          f.args.push(this.expr());
          if (this.acceptKw('FROM')) {
            const x = this.expr();
            f.args = [x, f.args[0]];
          } else while (this.acceptOp(',')) f.args.push(this.expr());
        }
      } else if (name === 'position') {
        // POSITION(sub IN texto)
        const sub = this.concatExpr();
        if (this.acceptKw('IN')) f.args.push(this.expr(), sub);
        else {
          f.args.push(sub);
          while (this.acceptOp(',')) f.args.push(this.expr());
        }
      } else {
        do f.args.push(this.exprOrDefault());
        while (this.acceptOp(','));
      }
      // string_agg(x, ',' ORDER BY y)
      if (this.isKw('ORDER')) {
        this.next();
        this.expectKw('BY');
        f.order = this.orderList();
      }
    }
    this.expectOp(')');
    if (this.isKw('FILTER') && this.isOp('(', this.peekAt(1))) {
      this.next();
      this.next();
      this.expectKw('WHERE');
      f.filter = this.expr();
      this.expectOp(')');
    }
    if (this.acceptKw('OVER')) {
      if (this.isOp('(')) f.over = this.windowSpec();
      else f.over = this.ident('el nombre de la ventana').toLowerCase();
    }
    return f;
  }

  // ───────── DML ─────────
  returning(): SelItem[] | undefined {
    if (!this.acceptKw('RETURNING')) return undefined;
    return this.selectItems();
  }

  insert(): Stmt {
    const pos = this.t.pos;
    let orAction: 'replace' | 'ignore' | undefined;
    if (this.acceptKw('REPLACE')) orAction = 'replace';
    else {
      this.next();
      if (this.acceptKw('OR')) {
        if (this.acceptKw('REPLACE')) orAction = 'replace';
        else if (this.acceptKw('IGNORE')) orAction = 'ignore';
        else this.fail('REPLACE o IGNORE');
      }
    }
    this.expectKw('INTO', 'INTO (INSERT INTO tabla …)');
    const table = this.tableName();
    let cols: string[] | undefined;
    if (this.isOp('(') && !this.isKw('SELECT', this.peekAt(1)) && !this.isKw('WITH', this.peekAt(1))) {
      this.next();
      cols = [];
      do cols.push(this.ident('el nombre de una columna'));
      while (this.acceptOp(','));
      this.expectOp(')');
    }
    let source: Extract<Stmt, { k: 'insert' }>['source'];
    if (this.isKw('VALUES')) {
      this.next();
      source = { k: 'values', rows: this.valuesRows() };
    } else if (this.isKw('DEFAULT') && this.isKw('VALUES', this.peekAt(1))) {
      this.next();
      this.next();
      source = { k: 'default' };
    } else if (this.isKw('SELECT') || this.isKw('WITH') || this.isOp('(')) {
      source = { k: 'query', q: this.query() };
    } else this.fail('VALUES o SELECT', 'INSERT INTO tabla (columnas) VALUES (valores)');
    let conflict: OnConflict | undefined;
    if (this.isKw('ON') && this.isKw('CONFLICT', this.peekAt(1))) {
      this.next();
      this.next();
      const ccols: string[] = [];
      if (this.acceptOp('(')) {
        do ccols.push(this.ident('el nombre de una columna'));
        while (this.acceptOp(','));
        this.expectOp(')');
      }
      this.expectKw('DO');
      if (this.acceptKw('NOTHING')) conflict = { cols: ccols, action: 'nothing' };
      else {
        this.expectKw('UPDATE');
        this.expectKw('SET');
        const sets = this.assignments();
        let where: Expr | undefined;
        if (this.acceptKw('WHERE')) where = this.expr();
        conflict = { cols: ccols, action: 'update', sets, where };
      }
    }
    return { k: 'insert', table, cols, source, conflict, orAction, returning: this.returning(), pos };
  }

  assignments(): Assignment[] {
    const out: Assignment[] = [];
    do {
      const col = this.ident('el nombre de la columna');
      if (this.isOp('.')) {
        // tabla.columna = … → columna
        this.next();
        out.push({ col: this.ident('el nombre de la columna'), e: (this.expectOp('='), this.exprOrDefault()) });
        continue;
      }
      this.expectOp('=', '«=» (columna = valor)');
      out.push({ col, e: this.exprOrDefault() });
    } while (this.acceptOp(','));
    return out;
  }

  update(): Stmt {
    const pos = this.next().pos;
    const table = this.tableName();
    let alias: string | undefined;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.t.kind === 'id' && !this.isKw('SET')) alias = this.ident();
    this.expectKw('SET', 'SET (UPDATE tabla SET columna = valor)');
    const sets = this.assignments();
    let from: FromItem | undefined;
    if (this.acceptKw('FROM')) from = this.fromList();
    let where: Expr | undefined;
    if (this.acceptKw('WHERE')) where = this.expr();
    return { k: 'update', table, alias, sets, from, where, returning: this.returning(), pos };
  }

  delete(): Stmt {
    const pos = this.next().pos;
    this.expectKw('FROM', 'FROM (DELETE FROM tabla)');
    const table = this.tableName();
    let alias: string | undefined;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.t.kind === 'id' && !RESERVED.has(this.t.text.toUpperCase()) && !this.isKw('USING')) alias = this.ident();
    let using: FromItem | undefined;
    if (this.acceptKw('USING')) using = this.fromList();
    let where: Expr | undefined;
    if (this.acceptKw('WHERE')) where = this.expr();
    return { k: 'delete', table, alias, using, where, returning: this.returning(), pos };
  }

  // ───────── DDL ─────────
  refAction(): RefAction {
    if (this.acceptKw('CASCADE')) return 'cascade';
    if (this.acceptKw('RESTRICT')) return 'restrict';
    if (this.acceptKw('SET')) {
      if (this.acceptKw('NULL')) return 'set null';
      this.expectKw('DEFAULT');
      return 'set default';
    }
    this.expectKw('NO');
    this.expectKw('ACTION');
    return 'no action';
  }

  colList(): string[] {
    this.expectOp('(');
    const cols: string[] = [];
    do cols.push(this.ident('el nombre de una columna'));
    while (this.acceptOp(','));
    this.expectOp(')');
    return cols;
  }

  referencesClause(): NonNullable<ColumnDef['refs']> {
    const table = this.tableName();
    let column: string | undefined;
    if (this.isOp('(')) column = this.colList()[0];
    let onDelete: RefAction = 'no action';
    let onUpdate: RefAction = 'no action';
    while (this.isKw('ON')) {
      this.next();
      if (this.acceptKw('DELETE')) onDelete = this.refAction();
      else {
        this.expectKw('UPDATE');
        onUpdate = this.refAction();
      }
    }
    return { table, column, onDelete, onUpdate };
  }

  columnDef(): ColumnDef {
    const name = this.ident('el nombre de la columna');
    const type: TypeName = this.isOp(',') || this.isOp(')') ? { base: 'any', raw: '' } : this.typeName();
    const col: ColumnDef = { name, type, notNull: false, primary: false, unique: false, autoinc: false };
    const lower = type.raw.toLowerCase();
    if (lower === 'serial' || lower === 'bigserial') col.autoinc = true;
    for (;;) {
      if (this.acceptKw('CONSTRAINT')) {
        this.ident('el nombre de la restricción');
        continue;
      }
      if (this.isKw('NOT') && this.isKw('NULL', this.peekAt(1))) {
        this.next();
        this.next();
        col.notNull = true;
      } else if (this.acceptKw('NULL')) {
        // permitido (la columna admite NULL)
      } else if (this.isKw('PRIMARY')) {
        this.next();
        this.expectKw('KEY');
        col.primary = true;
        col.notNull = true;
        this.acceptKw('ASC') || this.acceptKw('DESC');
        if (this.acceptKw('AUTOINCREMENT')) col.autoinc = true;
      } else if (this.acceptKw('AUTOINCREMENT') || this.acceptKw('AUTO_INCREMENT')) {
        col.autoinc = true;
      } else if (this.acceptKw('UNIQUE')) col.unique = true;
      else if (this.acceptKw('DEFAULT')) col.default = this.unary();
      else if (this.acceptKw('CHECK')) {
        this.expectOp('(');
        col.check = this.expr();
        this.expectOp(')');
      } else if (this.acceptKw('REFERENCES')) col.refs = this.referencesClause();
      else if (this.acceptKw('COLLATE')) this.anyName();
      else if (this.isKw('GENERATED')) {
        this.next();
        if (!this.acceptKw('ALWAYS') && this.acceptKw('BY')) this.expectKw('DEFAULT');
        this.expectKw('AS');
        if (this.acceptKw('IDENTITY')) {
          col.autoinc = true;
          if (this.acceptOp('(')) {
            let depth = 1;
            while (depth > 0 && this.t.kind !== 'eof') {
              if (this.isOp('(')) depth++;
              if (this.isOp(')')) depth--;
              this.next();
            }
          }
        } else {
          this.expectOp('(');
          col.generated = this.expr();
          this.expectOp(')');
          this.acceptKw('STORED') || this.acceptKw('VIRTUAL');
        }
      } else break;
    }
    return col;
  }

  tableConstraint(): TableConstraint | null {
    let name: string | undefined;
    if (this.isKw('CONSTRAINT')) {
      this.next();
      name = this.ident('el nombre de la restricción');
    }
    if (this.isKw('PRIMARY')) {
      this.next();
      this.expectKw('KEY');
      return { k: 'primary', cols: this.colList(), name };
    }
    if (this.isKw('UNIQUE')) {
      this.next();
      return { k: 'unique', cols: this.colList(), name };
    }
    if (this.isKw('CHECK')) {
      this.next();
      this.expectOp('(');
      const e = this.expr();
      this.expectOp(')');
      return { k: 'check', e, name };
    }
    if (this.isKw('FOREIGN')) {
      this.next();
      this.expectKw('KEY');
      const cols = this.colList();
      this.expectKw('REFERENCES');
      const table = this.tableName();
      let refCols: string[] | undefined;
      if (this.isOp('(')) refCols = this.colList();
      let onDelete: RefAction = 'no action';
      let onUpdate: RefAction = 'no action';
      while (this.isKw('ON')) {
        this.next();
        if (this.acceptKw('DELETE')) onDelete = this.refAction();
        else {
          this.expectKw('UPDATE');
          onUpdate = this.refAction();
        }
      }
      return { k: 'foreign', cols, table, refCols, onDelete, onUpdate, name };
    }
    if (name) this.fail('PRIMARY KEY, UNIQUE, CHECK o FOREIGN KEY');
    return null;
  }

  create(): Stmt {
    const pos = this.next().pos;
    let orReplace = false;
    if (this.isKw('OR') && this.isKw('REPLACE', this.peekAt(1))) {
      this.next();
      this.next();
      orReplace = true;
    }
    const temp = this.acceptKw('TEMP') || this.acceptKw('TEMPORARY');
    const unique = this.acceptKw('UNIQUE');
    if (this.acceptKw('TABLE')) {
      let ifNotExists = false;
      if (this.isKw('IF')) {
        this.next();
        this.expectKw('NOT');
        this.expectKw('EXISTS');
        ifNotExists = true;
      }
      const name = this.tableName();
      if (this.isKw('AS')) {
        this.next();
        return { k: 'create_table', name, ifNotExists, temp, cols: [], constraints: [], as: this.query(), pos };
      }
      this.expectOp('(', '«(» con las columnas de la tabla');
      const cols: ColumnDef[] = [];
      const constraints: TableConstraint[] = [];
      do {
        if (this.isOp(')')) break;
        const c = this.tableConstraint();
        if (c) constraints.push(c);
        else cols.push(this.columnDef());
      } while (this.acceptOp(','));
      this.expectOp(')');
      if (cols.length === 0) throw syntaxError('Una tabla necesita al menos una columna', pos);
      return { k: 'create_table', name, ifNotExists, temp, cols, constraints, pos };
    }
    if (this.acceptKw('INDEX')) {
      let ifNotExists = false;
      if (this.isKw('IF')) {
        this.next();
        this.expectKw('NOT');
        this.expectKw('EXISTS');
        ifNotExists = true;
      }
      const name = this.ident('el nombre del índice');
      this.expectKw('ON');
      const table = this.tableName();
      this.expectOp('(');
      const cols: { e: Expr; desc: boolean }[] = [];
      do {
        const e = this.expr();
        let desc = false;
        if (this.acceptKw('DESC')) desc = true;
        else this.acceptKw('ASC');
        cols.push({ e, desc });
      } while (this.acceptOp(','));
      this.expectOp(')');
      let where: Expr | undefined;
      if (this.acceptKw('WHERE')) where = this.expr();
      return { k: 'create_index', name, table, cols, unique, ifNotExists, where, pos };
    }
    if (this.acceptKw('VIEW')) {
      let ifNotExists = false;
      if (this.isKw('IF')) {
        this.next();
        this.expectKw('NOT');
        this.expectKw('EXISTS');
        ifNotExists = true;
      }
      const name = this.tableName();
      let cols: string[] | undefined;
      if (this.isOp('(')) cols = this.colList();
      this.expectKw('AS');
      const start = this.t.pos;
      const q = this.query();
      const sql = this.src.slice(start, this.toks[this.i - 1].end);
      return { k: 'create_view', name, cols, q, ifNotExists, orReplace, sql, pos };
    }
    if (this.acceptKw('TRIGGER')) {
      let ifNotExists = false;
      if (this.isKw('IF')) {
        this.next();
        this.expectKw('NOT');
        this.expectKw('EXISTS');
        ifNotExists = true;
      }
      const name = this.ident('el nombre del disparador');
      let timing: 'before' | 'after' | 'instead' = 'after';
      if (this.acceptKw('BEFORE')) timing = 'before';
      else if (this.acceptKw('AFTER')) timing = 'after';
      else if (this.acceptKw('INSTEAD')) {
        this.expectKw('OF');
        timing = 'instead';
      } else this.fail('BEFORE, AFTER o INSTEAD OF');
      let event: 'insert' | 'update' | 'delete';
      if (this.acceptKw('INSERT')) event = 'insert';
      else if (this.acceptKw('UPDATE')) {
        event = 'update';
        if (this.acceptKw('OF')) {
          do this.ident();
          while (this.acceptOp(','));
        }
      } else if (this.acceptKw('DELETE')) event = 'delete';
      else return this.fail('INSERT, UPDATE o DELETE');
      this.expectKw('ON');
      const table = this.tableName();
      if (this.acceptKw('FOR')) {
        this.expectKw('EACH');
        this.expectKw('ROW');
      }
      let when: Expr | undefined;
      if (this.acceptKw('WHEN')) {
        this.acceptOp('(');
        when = this.expr();
        this.acceptOp(')');
      }
      this.expectKw('BEGIN');
      const body: Stmt[] = [];
      while (!this.isKw('END')) {
        if (this.t.kind === 'eof') this.fail('END (cierra el BEGIN del disparador)');
        body.push(this.statement());
        this.expectOp(';', '«;» al final de cada sentencia del disparador');
      }
      this.expectKw('END');
      return { k: 'create_trigger', name, timing, event, table, when, body, ifNotExists, pos };
    }
    const near = closestWord(this.t.text, ['TABLE', 'INDEX', 'VIEW', 'TRIGGER', 'UNIQUE', 'TEMP']);
    return this.fail('TABLE, INDEX, VIEW o TRIGGER después de CREATE', near ? `¿Quisiste escribir ${near}?` : undefined);
  }

  drop(): Stmt {
    const pos = this.next().pos;
    let what: 'table' | 'index' | 'view' | 'trigger';
    if (this.acceptKw('TABLE')) what = 'table';
    else if (this.acceptKw('INDEX')) what = 'index';
    else if (this.acceptKw('VIEW')) what = 'view';
    else if (this.acceptKw('TRIGGER')) what = 'trigger';
    else return this.fail('TABLE, INDEX, VIEW o TRIGGER después de DROP');
    let ifExists = false;
    if (this.isKw('IF')) {
      this.next();
      this.expectKw('EXISTS');
      ifExists = true;
    }
    const name = this.tableName();
    let cascade = false;
    if (this.acceptKw('CASCADE')) cascade = true;
    else this.acceptKw('RESTRICT');
    return { k: 'drop', what, name, ifExists, cascade, pos };
  }

  alter(): Stmt {
    const pos = this.next().pos;
    this.expectKw('TABLE');
    const table = this.tableName();
    let action: AlterAction;
    if (this.acceptKw('ADD')) {
      const c = this.tableConstraint();
      if (c) action = { op: 'add_constraint', c };
      else {
        this.acceptKw('COLUMN');
        action = { op: 'add_column', col: this.columnDef() };
      }
    } else if (this.acceptKw('DROP')) {
      this.acceptKw('COLUMN');
      let ifExists = false;
      if (this.isKw('IF')) {
        this.next();
        this.expectKw('EXISTS');
        ifExists = true;
      }
      action = { op: 'drop_column', name: this.ident('el nombre de la columna'), ifExists };
    } else if (this.acceptKw('RENAME')) {
      if (this.acceptKw('TO')) action = { op: 'rename_to', name: this.ident('el nuevo nombre') };
      else {
        this.acceptKw('COLUMN');
        const from = this.ident('el nombre de la columna');
        this.expectKw('TO');
        action = { op: 'rename_column', from, to: this.ident('el nuevo nombre') };
      }
    } else if (this.acceptKw('ALTER')) {
      this.acceptKw('COLUMN');
      const col = this.ident('el nombre de la columna');
      if (this.acceptKw('SET')) {
        if (this.acceptKw('DEFAULT')) action = { op: 'set_default', col, e: this.unary() };
        else {
          this.expectKw('NOT');
          this.expectKw('NULL');
          action = { op: 'set_not_null', col, on: true };
        }
      } else if (this.acceptKw('DROP')) {
        if (this.acceptKw('DEFAULT')) action = { op: 'set_default', col };
        else {
          this.expectKw('NOT');
          this.expectKw('NULL');
          action = { op: 'set_not_null', col, on: false };
        }
      } else {
        this.acceptKw('SET') && this.acceptKw('DATA');
        this.expectKw('TYPE');
        action = { op: 'alter_type', col, type: this.typeName() };
      }
    } else return this.fail('ADD, DROP, RENAME o ALTER después de ALTER TABLE');
    return { k: 'alter', table, action, pos };
  }
}

/** Analiza un texto con una o varias sentencias separadas por «;». */
export function parseScript(sql: string): ParsedStatement[] {
  return new Parser(sql).script();
}

/** Analiza una única expresión (para columnas generadas, restricciones guardadas, etc.). */
export function parseExpression(sql: string): Expr {
  const p = new Parser(sql);
  const e = p.expr();
  if (!p.isEof()) p.fail('el final de la expresión');
  return e;
}
