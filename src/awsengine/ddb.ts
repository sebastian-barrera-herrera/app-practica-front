/** Lógica de DynamoDB: valores tipados, expresiones (condición, clave, actualización, proyección) y tamaño de los elementos. */
import { AwsError } from './registry';

export interface AV {
  S?: string;
  N?: string;
  B?: string;
  BOOL?: boolean;
  NULL?: boolean;
  L?: AV[];
  M?: Record<string, AV>;
  SS?: string[];
  NS?: string[];
  BS?: string[];
}
export type Item = Record<string, AV>;

const val = (code: string, msg: string) => new AwsError(code, msg);
export const validation = (msg: string) => val('ValidationException', msg);

// ───────────────────────── valores ─────────────────────────

const TYPES = ['S', 'N', 'B', 'BOOL', 'NULL', 'L', 'M', 'SS', 'NS', 'BS'] as const;
export const typeOf = (v: AV): string | undefined => TYPES.find((t) => (v as Record<string, unknown>)[t] !== undefined);

/** Comprueba que un valor tenga exactamente un tipo y sea coherente (los números lo son de verdad). */
export function checkValue(v: unknown): AV {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw validation('Supplied AttributeValue is empty, must contain exactly one of the supported datatypes');
  const have = TYPES.filter((t) => (v as Record<string, unknown>)[t] !== undefined);
  if (have.length === 0) throw validation('Supplied AttributeValue is empty, must contain exactly one of the supported datatypes');
  if (have.length > 1) throw validation('Supplied AttributeValue has more than one datatypes set, must contain exactly one of the supported datatypes');
  const av = v as AV;
  const t = have[0];
  if (t === 'N' && (typeof av.N !== 'string' || av.N.trim() === '' || Number.isNaN(Number(av.N)))) throw validation(`The parameter cannot be converted to a numeric value: ${String(av.N)}`);
  if (t === 'S' && typeof av.S !== 'string') throw validation('One or more parameter values were invalid: Wrong value type for S');
  if (t === 'L') (av.L ?? []).forEach(checkValue);
  if (t === 'M') for (const x of Object.values(av.M ?? {})) checkValue(x);
  if (t === 'NS') for (const n of av.NS ?? []) if (Number.isNaN(Number(n))) throw validation(`The parameter cannot be converted to a numeric value: ${n}`);
  return av;
}

export const checkItem = (it: unknown): Item => {
  if (typeof it !== 'object' || it === null || Array.isArray(it)) throw validation('Item must be a map of attribute names to values');
  for (const v of Object.values(it)) checkValue(v);
  return it as Item;
};

const num = (v: AV) => Number(v.N);

/** Compara dos valores del mismo tipo; null si no son comparables. */
export function compare(a: AV, b: AV): number | null {
  if (a.N !== undefined && b.N !== undefined) return num(a) - num(b);
  if (a.S !== undefined && b.S !== undefined) return a.S < b.S ? -1 : a.S > b.S ? 1 : 0;
  if (a.B !== undefined && b.B !== undefined) return a.B < b.B ? -1 : a.B > b.B ? 1 : 0;
  return null;
}

export function equal(a: AV | undefined, b: AV | undefined): boolean {
  if (!a || !b) return false;
  return canon(a) === canon(b);
}

export function canon(v: AV): string {
  const t = typeOf(v) ?? '?';
  switch (t) {
    case 'N': return `N:${num(v)}`;
    case 'L': return `L:[${(v.L ?? []).map(canon).join(',')}]`;
    case 'M': return `M:{${Object.keys(v.M ?? {}).sort().map((k) => `${k}=${canon(v.M![k])}`).join(',')}}`;
    case 'SS': case 'BS': return `${t}:${[...((v as Record<string, string[]>)[t] ?? [])].sort().join('|')}`;
    case 'NS': return `NS:${[...(v.NS ?? [])].map(Number).sort((x, y) => x - y).join('|')}`;
    default: return `${t}:${JSON.stringify((v as Record<string, unknown>)[t])}`;
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** Tamaño aproximado de un valor en bytes, con las reglas de DynamoDB. */
function valueSize(v: AV): number {
  const t = typeOf(v);
  switch (t) {
    case 'S': return utf8(v.S ?? '');
    case 'N': return Math.ceil(String(Math.abs(num(v))).replace(/[.\-e+]/g, '').length / 2) + 1;
    case 'B': return Math.floor(((v.B ?? '').length * 3) / 4);
    case 'BOOL': case 'NULL': return 1;
    case 'L': return 3 + (v.L ?? []).reduce((n, x) => n + 1 + valueSize(x), 0);
    case 'M': return 3 + Object.entries(v.M ?? {}).reduce((n, [k, x]) => n + utf8(k) + 1 + valueSize(x), 0);
    case 'SS': return (v.SS ?? []).reduce((n, s) => n + utf8(s), 0);
    case 'NS': return (v.NS ?? []).reduce((n, s) => n + Math.ceil(s.replace(/[.\-]/g, '').length / 2) + 1, 0);
    default: return 1;
  }
}

export const itemSize = (it: Item): number => Object.entries(it).reduce((n, [k, v]) => n + utf8(k) + valueSize(v), 0);

// ───────────────────────── expresiones: léxico ─────────────────────────

type Tok = { t: 'op' | 'val' | 'path' | 'kw' | 'eof'; v: string };

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'SET', 'REMOVE', 'ADD', 'DELETE']);

/** Palabras reservadas más comunes: usarlas como nombre de atributo exige `#nombre`. */
const RESERVED = new Set(
  'ABORT ABSOLUTE ACTION ADD AFTER AGENT ALL ALLOCATE ALTER ANALYZE AND ANY ARE ARRAY AS ASC ATTRIBUTE AUTHORIZATION AVG BACKUP BEFORE BEGIN BETWEEN BIGINT BINARY BIT BLOB BOOLEAN BOTH BY BYTE CALL CASCADE CASE CAST CATALOG CHAR CHARACTER CHECK CLASS CLOSE CLUSTER COLLATE COLLECTION COLUMN COMMENT COMMIT CONNECT CONNECTION CONSTRAINT CONTINUE COPY COUNT CREATE CROSS CURRENT CURSOR DATA DATABASE DATE DATETIME DAY DEC DECIMAL DEFAULT DELETE DESC DESCRIBE DISTINCT DOMAIN DOUBLE DROP EACH ELSE END ESCAPE EXCEPT EXISTS EXPLAIN FALSE FETCH FILE FILTER FIRST FLOAT FOR FOREIGN FROM FULL FUNCTION GENERAL GET GLOBAL GO GRANT GROUP HASH HAVING HOUR IDENTIFIED IDENTITY IF IGNORE IMMEDIATE IN INDEX INDEXES INNER INSERT INT INTEGER INTERVAL INTO IS ITEM ITEMS JOIN KEY KEYS LANGUAGE LAST LEADING LEFT LEVEL LIKE LIMIT LIST LOCAL LOCK LONG LOOP MAP MATCH MAX MEMBER MERGE MIN MINUTE MODE MODIFY MONTH NAME NAMES NATIONAL NATURAL NEW NEXT NO NONE NOT NULL NUMBER NUMERIC OBJECT OF OFFSET OLD ON ONLY OPEN OPTION OR ORDER OUTER OUTPUT OVER OWNER PARTITION PASSWORD PATH PLAN PRECISION PRIMARY PRIOR PRIVILEGES PUBLIC RANGE READ REAL REF REFERENCES REGION RELATIVE REMOVE RENAME REPLACE RESOURCE RESTRICT RETURN RETURNS REVOKE RIGHT ROLE ROLLBACK ROW ROWS SCAN SCHEMA SCROLL SECOND SECTION SELECT SEQUENCE SESSION SET SIZE SMALLINT SOURCE SPACE START STATE STATUS STORAGE STRING STRUCT SUM TABLE TEMPORARY TEXT THEN TIME TIMESTAMP TO TOP TOTAL TRANSACTION TRIGGER TRUE TYPE UNION UNIQUE UPDATE USAGE USE USER USERS USING VALUE VALUES VARCHAR VIEW WHEN WHERE WHILE WITH WORK WRITE YEAR ZONE'.split(' '),
);

const TOKEN = /\s*(?:(<>|<=|>=|=|<|>|\(|\)|,|\+|-)|(:[A-Za-z0-9_]+)|((?:#?[A-Za-z_][A-Za-z0-9_]*)(?:\[\d+\])*(?:\.(?:#?[A-Za-z_][A-Za-z0-9_]*)(?:\[\d+\])*)*))/y;

function lex(src: string, kind: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  TOKEN.lastIndex = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw validation(`Invalid ${kind}: Syntax error; token: "${src.slice(i).trim().split(/\s/)[0]}", near: "${src.slice(i).trim().slice(0, 20)}"`);
    i = TOKEN.lastIndex;
    if (m[1]) out.push({ t: 'op', v: m[1] });
    else if (m[2]) out.push({ t: 'val', v: m[2] });
    else if (KEYWORDS.has(m[3].toUpperCase())) out.push({ t: 'kw', v: m[3].toUpperCase() });
    else out.push({ t: 'path', v: m[3] });
  }
  out.push({ t: 'eof', v: '' });
  return out;
}

// ───────────────────────── expresiones: AST ─────────────────────────

export interface Env {
  names: Record<string, string>;
  values: Record<string, AV>;
  kind: string;
  used: Set<string>;
}

export const mkEnv = (names: unknown, values: unknown, kind: string): Env => ({ names: (names ?? {}) as Record<string, string>, values: (values ?? {}) as Record<string, AV>, kind, used: new Set() });

type Seg = string | number;
type Operand = { k: 'path'; path: Seg[] } | { k: 'val'; v: AV } | { k: 'size'; path: Seg[] } | { k: 'if'; path: Seg[]; v: Operand } | { k: 'append'; a: Operand; b: Operand } | { k: 'arith'; a: Operand; op: '+' | '-'; b: Operand };
type Node =
  | { k: 'and' | 'or'; a: Node; b: Node }
  | { k: 'not'; a: Node }
  | { k: 'cmp'; op: string; a: Operand; b: Operand }
  | { k: 'between'; a: Operand; lo: Operand; hi: Operand }
  | { k: 'in'; a: Operand; list: Operand[] }
  | { k: 'fn'; name: string; args: Operand[] };

class Parser {
  i = 0;
  constructor(private toks: Tok[], private env: Env) {}
  get cur() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  err(): never {
    throw validation(`Invalid ${this.env.kind}: Syntax error; token: "${this.cur.v}", near: "${this.cur.v}"`);
  }
  eat(t: Tok['t'], v?: string): Tok {
    if (this.cur.t !== t || (v !== undefined && this.cur.v.toUpperCase() !== v)) this.err();
    return this.next();
  }
  isOp(v: string) { return this.cur.t === 'op' && this.cur.v === v; }

  path(raw: string): Seg[] {
    const segs: Seg[] = [];
    for (const part of raw.split('.')) {
      const m = /^(#?[A-Za-z_][A-Za-z0-9_]*)((?:\[\d+\])*)$/.exec(part)!;
      let name = m[1];
      if (name.startsWith('#')) {
        this.env.used.add(name);
        if (!(name in this.env.names)) throw validation(`An expression attribute name used in the document path is not defined; attribute name: ${name}`);
        name = this.env.names[name];
      } else if (RESERVED.has(name.toUpperCase())) {
        throw validation(`Invalid ${this.env.kind}: Attribute name is a reserved keyword; reserved keyword: ${name}`);
      }
      segs.push(name);
      for (const ix of m[2].matchAll(/\[(\d+)\]/g)) segs.push(Number(ix[1]));
    }
    return segs;
  }

  operand(): Operand {
    const t = this.cur;
    if (t.t === 'val') {
      this.next();
      this.env.used.add(t.v);
      if (!(t.v in this.env.values)) throw validation(`An expression attribute value used in expression is not defined; attribute value: ${t.v}`);
      return { k: 'val', v: checkValue(this.env.values[t.v]) };
    }
    if (t.t === 'path') {
      const low = t.v.toLowerCase();
      if (/^[a-z_]+$/.test(t.v) && this.toks[this.i + 1]?.v === '(' && ['size', 'if_not_exists', 'list_append'].includes(low)) {
        this.next();
        this.eat('op', '(');
        if (low === 'size') {
          const p = this.path(this.eat('path').v);
          this.eat('op', ')');
          return { k: 'size', path: p };
        }
        if (low === 'if_not_exists') {
          const p = this.path(this.eat('path').v);
          this.eat('op', ',');
          const v = this.operand();
          this.eat('op', ')');
          return { k: 'if', path: p, v };
        }
        const a = this.operand();
        this.eat('op', ',');
        const b = this.operand();
        this.eat('op', ')');
        return { k: 'append', a, b };
      }
      this.next();
      return { k: 'path', path: this.path(t.v) };
    }
    return this.err();
  }

  /** Operando de una acción SET: admite `a + b` y `a - b`. */
  setValue(): Operand {
    const a = this.operand();
    if (this.isOp('+') || this.isOp('-')) {
      const op = this.next().v as '+' | '-';
      return { k: 'arith', a, op, b: this.operand() };
    }
    return a;
  }

  or(): Node {
    let a = this.and();
    while (this.cur.t === 'kw' && this.cur.v === 'OR') {
      this.next();
      a = { k: 'or', a, b: this.and() };
    }
    return a;
  }
  and(): Node {
    let a = this.not();
    while (this.cur.t === 'kw' && this.cur.v === 'AND') {
      this.next();
      a = { k: 'and', a, b: this.not() };
    }
    return a;
  }
  not(): Node {
    if (this.cur.t === 'kw' && this.cur.v === 'NOT') {
      this.next();
      return { k: 'not', a: this.not() };
    }
    return this.primary();
  }
  primary(): Node {
    if (this.isOp('(')) {
      this.next();
      const n = this.or();
      this.eat('op', ')');
      return n;
    }
    const t = this.cur;
    const low = t.v.toLowerCase();
    if (t.t === 'path' && this.toks[this.i + 1]?.v === '(' && ['attribute_exists', 'attribute_not_exists', 'attribute_type', 'begins_with', 'contains'].includes(low)) {
      this.next();
      this.eat('op', '(');
      const args: Operand[] = [{ k: 'path', path: this.path(this.eat('path').v) }];
      while (this.isOp(',')) {
        this.next();
        args.push(this.operand());
      }
      this.eat('op', ')');
      return { k: 'fn', name: low, args };
    }
    const a = this.operand();
    if (this.cur.t === 'kw' && this.cur.v === 'BETWEEN') {
      this.next();
      const lo = this.operand();
      this.eat('kw', 'AND');
      return { k: 'between', a, lo, hi: this.operand() };
    }
    if (this.cur.t === 'kw' && this.cur.v === 'IN') {
      this.next();
      this.eat('op', '(');
      const list = [this.operand()];
      while (this.isOp(',')) {
        this.next();
        list.push(this.operand());
      }
      this.eat('op', ')');
      return { k: 'in', a, list };
    }
    if (this.cur.t === 'op' && ['=', '<>', '<', '<=', '>', '>='].includes(this.cur.v)) {
      const op = this.next().v;
      return { k: 'cmp', op, a, b: this.operand() };
    }
    return this.err();
  }
}

export function parseCondition(src: string, env: Env): Node {
  const p = new Parser(lex(src, env.kind), env);
  const n = p.or();
  if (p.cur.t !== 'eof') p.err();
  return n;
}

// ───────────────────────── evaluación ─────────────────────────

export function getPath(it: Item, path: Seg[]): AV | undefined {
  let cur: AV | undefined = { M: it };
  for (const s of path) {
    if (!cur) return undefined;
    if (typeof s === 'number') cur = cur.L?.[s];
    else cur = cur.M?.[s];
  }
  return cur;
}

function resolve(o: Operand, it: Item): AV | undefined {
  switch (o.k) {
    case 'val': return o.v;
    case 'path': return getPath(it, o.path);
    case 'size': {
      const v = getPath(it, o.path);
      if (!v) return undefined;
      const t = typeOf(v);
      const n = t === 'S' ? (v.S ?? '').length : t === 'L' ? (v.L ?? []).length : t === 'M' ? Object.keys(v.M ?? {}).length : t === 'SS' ? (v.SS ?? []).length : t === 'NS' ? (v.NS ?? []).length : t === 'B' ? valueSize(v) : 0;
      return { N: String(n) };
    }
    case 'if': return getPath(it, o.path) ?? resolve(o.v, it);
    case 'append': {
      const a = resolve(o.a, it);
      const b = resolve(o.b, it);
      if (!a?.L || !b?.L) throw validation('An operand in the update expression has an incorrect data type');
      return { L: [...a.L, ...b.L] };
    }
    case 'arith': {
      const a = resolve(o.a, it);
      const b = resolve(o.b, it);
      if (a?.N === undefined || b?.N === undefined) throw validation('An operand in the update expression has an incorrect data type');
      return { N: String(o.op === '+' ? num(a) + num(b) : num(a) - num(b)) };
    }
  }
}

export function evalCond(n: Node, it: Item): boolean {
  switch (n.k) {
    case 'and': return evalCond(n.a, it) && evalCond(n.b, it);
    case 'or': return evalCond(n.a, it) || evalCond(n.b, it);
    case 'not': return !evalCond(n.a, it);
    case 'cmp': {
      const a = resolve(n.a, it);
      const b = resolve(n.b, it);
      if (!a || !b) return n.op === '<>' ? !!(a || b) && !(a && b && equal(a, b)) : false;
      if (n.op === '=') return equal(a, b);
      if (n.op === '<>') return !equal(a, b);
      const c = compare(a, b);
      if (c === null) return false;
      return n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
    }
    case 'between': {
      const a = resolve(n.a, it);
      const lo = resolve(n.lo, it);
      const hi = resolve(n.hi, it);
      if (!a || !lo || !hi) return false;
      const x = compare(a, lo);
      const y = compare(a, hi);
      return x !== null && y !== null && x >= 0 && y <= 0;
    }
    case 'in': {
      const a = resolve(n.a, it);
      return !!a && n.list.some((o) => equal(a, resolve(o, it)));
    }
    case 'fn': {
      const v = resolve(n.args[0], it);
      const arg = n.args[1] ? resolve(n.args[1], it) : undefined;
      switch (n.name) {
        case 'attribute_exists': return v !== undefined;
        case 'attribute_not_exists': return v === undefined;
        case 'attribute_type': return !!v && !!arg?.S && typeOf(v) === arg.S;
        case 'begins_with': return v?.S !== undefined && arg?.S !== undefined && v.S.startsWith(arg.S);
        case 'contains': {
          if (!v || !arg) return false;
          if (v.S !== undefined && arg.S !== undefined) return v.S.includes(arg.S);
          if (v.SS && arg.S !== undefined) return v.SS.includes(arg.S);
          if (v.NS && arg.N !== undefined) return v.NS.map(Number).includes(Number(arg.N));
          if (v.L) return v.L.some((x) => equal(x, arg));
          return false;
        }
      }
    }
  }
  return false;
}

/** Comprueba que todos los marcadores `#x` y `:v` declarados se hayan usado. */
export function checkUnused(env: Env): void {
  const unusedN = Object.keys(env.names).filter((k) => !env.used.has(k));
  if (unusedN.length) throw validation(`Value provided in ExpressionAttributeNames unused in expressions: keys: {${unusedN.join(', ')}}`);
  const unusedV = Object.keys(env.values).filter((k) => !env.used.has(k));
  if (unusedV.length) throw validation(`Value provided in ExpressionAttributeValues unused in expressions: keys: {${unusedV.join(', ')}}`);
}

// ───────────────────────── condición de clave ─────────────────────────

/** Analiza una `KeyConditionExpression` y devuelve el valor de la clave de partición y el árbol completo. */
export function parseKeyCondition(src: string, env: Env, pk: string, sk: string | undefined): { pkValue: AV; node: Node } {
  const node = parseCondition(src, env);
  const terms: Node[] = [];
  const flat = (n: Node): void => {
    if (n.k === 'and') {
      flat(n.a);
      flat(n.b);
    } else terms.push(n);
  };
  flat(node);
  const nameOf = (o: Operand) => (o.k === 'path' && o.path.length === 1 ? String(o.path[0]) : undefined);
  const eq = terms.find((t): t is Extract<Node, { k: 'cmp' }> => t.k === 'cmp' && t.op === '=' && (nameOf(t.a) === pk || nameOf(t.b) === pk));
  if (!eq) throw validation(`Query condition missed key schema element: ${pk}`);
  const pkValue = (nameOf(eq.a) === pk ? eq.b : eq.a) as Operand;
  if (pkValue.k !== 'val') throw validation('Invalid KeyConditionExpression: Syntax error; the partition key must be compared with a value');
  const rest = terms.filter((t) => t !== eq);
  if (rest.length > 1) throw validation('Invalid KeyConditionExpression: Syntax error; too many conditions');
  if (rest[0]) {
    const r = rest[0];
    const attrs = r.k === 'cmp' ? [nameOf(r.a), nameOf(r.b)] : r.k === 'between' ? [nameOf(r.a)] : r.k === 'fn' ? [nameOf(r.args[0])] : [];
    if (!sk || !attrs.includes(sk) || (r.k === 'cmp' && r.op === '<>') || (r.k === 'fn' && r.name !== 'begins_with') || r.k === 'in' || r.k === 'or' || r.k === 'not') {
      throw validation(`Query key condition not supported`);
    }
  }
  return { pkValue: pkValue.v, node };
}

// ───────────────────────── actualizaciones ─────────────────────────

type Action = { op: 'SET'; path: Seg[]; v: Operand } | { op: 'REMOVE'; path: Seg[] } | { op: 'ADD' | 'DELETE'; path: Seg[]; v: Operand };

export function parseUpdate(src: string, env: Env): Action[] {
  const p = new Parser(lex(src, env.kind), env);
  const acts: Action[] = [];
  while (p.cur.t !== 'eof') {
    const kw = p.eat('kw');
    if (!['SET', 'REMOVE', 'ADD', 'DELETE'].includes(kw.v)) p.err();
    for (;;) {
      const path = p.path(p.eat('path').v);
      if (kw.v === 'SET') {
        p.eat('op', '=');
        acts.push({ op: 'SET', path, v: p.setValue() });
      } else if (kw.v === 'REMOVE') acts.push({ op: 'REMOVE', path });
      else acts.push({ op: kw.v as 'ADD' | 'DELETE', path, v: p.operand() });
      if (p.isOp(',')) {
        p.next();
        continue;
      }
      break;
    }
  }
  if (!acts.length) throw validation(`Invalid ${env.kind}: The expression can not be empty;`);
  return acts;
}

function setPath(it: Item, path: Seg[], v: AV): void {
  let cur: { M?: Record<string, AV>; L?: AV[] } = { M: it };
  for (let i = 0; i < path.length; i++) {
    const s = path[i];
    const last = i === path.length - 1;
    if (typeof s === 'number') {
      if (!cur.L) throw validation('The document path provided in the update expression is invalid for update');
      if (last) cur.L[s] = v;
      else cur = cur.L[s] as typeof cur;
    } else {
      if (!cur.M) throw validation('The document path provided in the update expression is invalid for update');
      if (last) cur.M[s] = v;
      else {
        if (!cur.M[s]) throw validation('The document path provided in the update expression is invalid for update');
        cur = cur.M[s] as typeof cur;
      }
    }
  }
}

function removePath(it: Item, path: Seg[]): void {
  const parent = path.length === 1 ? { M: it } : getPath(it, path.slice(0, -1));
  const last = path[path.length - 1];
  if (!parent) return;
  if (typeof last === 'number') parent.L?.splice(last, 1);
  else if (parent.M) delete parent.M[last];
}

/** Aplica las acciones y devuelve los nombres de atributo de primer nivel que cambian. */
export function applyUpdate(acts: Action[], it: Item): string[] {
  const touched = new Set<string>();
  for (const a of acts) {
    touched.add(String(a.path[0]));
    if (a.op === 'SET') {
      const v = resolve(a.v, it);
      if (!v) throw validation('The provided expression refers to an attribute that does not exist in the item');
      setPath(it, a.path, structuredClone(v));
    } else if (a.op === 'REMOVE') removePath(it, a.path);
    else {
      const v = resolve(a.v, it)!;
      const cur = getPath(it, a.path);
      if (a.op === 'ADD') {
        if (v.N !== undefined) {
          if (cur && cur.N === undefined) throw validation('An operand in the update expression has an incorrect data type');
          setPath(it, a.path, { N: String((cur ? num(cur) : 0) + num(v)) });
        } else if (v.SS || v.NS) {
          const key = v.SS ? 'SS' : 'NS';
          const have = ((cur as Record<string, string[]> | undefined)?.[key] ?? []) as string[];
          setPath(it, a.path, { [key]: [...new Set([...have, ...((v as Record<string, string[]>)[key] ?? [])])] } as AV);
        } else throw validation('An operand in the update expression has an incorrect data type');
      } else if (cur) {
        const key = v.SS ? 'SS' : 'NS';
        const left = ((cur as Record<string, string[]>)[key] ?? []).filter((x) => !((v as Record<string, string[]>)[key] ?? []).includes(x));
        if (left.length) setPath(it, a.path, { [key]: left } as AV);
        else removePath(it, a.path);
      }
    }
  }
  return [...touched];
}

// ───────────────────────── proyección ─────────────────────────

export function project(it: Item, src: string | undefined, env: Env): Item {
  if (!src) return it;
  const out: Item = {};
  for (const raw of src.split(',')) {
    const p = new Parser(lex(raw.trim(), env.kind), env);
    const path = p.path(p.eat('path').v);
    const v = getPath(it, path);
    if (v) setNested(out, path, v);
  }
  return out;
}

function setNested(out: Item, path: Seg[], v: AV): void {
  let cur = out;
  for (let i = 0; i < path.length - 1; i++) {
    const s = String(path[i]);
    cur[s] ??= { M: {} };
    cur = cur[s].M ??= {};
  }
  cur[String(path[path.length - 1])] = v;
}
