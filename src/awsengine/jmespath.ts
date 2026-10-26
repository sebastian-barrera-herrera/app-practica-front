/**
 * JMESPath completo (lo que usa `aws … --query`): proyecciones, filtros, slices, pipes,
 * multiselect, funciones. Sin dependencias.
 */
import type { Json } from './types';

export class JmesError extends Error {
  constructor(msg: string, public pos = 0) {
    super(msg);
  }
}

type Tok = { t: string; v?: unknown; pos: number };

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function tokenize(expr: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const c = expr[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT.test(expr[j])) j++;
      out.push({ t: 'ident', v: expr.slice(i, j), pos: i });
      i = j;
    } else if (c === '-' ? DIGIT.test(expr[i + 1] ?? '') : DIGIT.test(c)) {
      let j = i + 1;
      while (j < n && DIGIT.test(expr[j])) j++;
      out.push({ t: 'number', v: parseInt(expr.slice(i, j), 10), pos: i });
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && expr[j] !== '"') j += expr[j] === '\\' ? 2 : 1;
      if (j >= n) throw new JmesError('Unterminated quoted identifier', i);
      let v: unknown;
      try {
        v = JSON.parse(expr.slice(i, j + 1));
      } catch {
        throw new JmesError('Invalid quoted identifier', i);
      }
      out.push({ t: 'quoted', v, pos: i });
      i = j + 1;
    } else if (c === "'") {
      let j = i + 1;
      let s = '';
      while (j < n && expr[j] !== "'") {
        if (expr[j] === '\\' && expr[j + 1] === "'") {
          s += "'";
          j += 2;
        } else s += expr[j++];
      }
      if (j >= n) throw new JmesError('Unterminated raw string', i);
      out.push({ t: 'literal', v: s, pos: i });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let s = '';
      while (j < n && expr[j] !== '`') {
        if (expr[j] === '\\' && expr[j + 1] === '`') {
          s += '`';
          j += 2;
        } else s += expr[j++];
      }
      if (j >= n) throw new JmesError('Unterminated literal', i);
      let v: unknown;
      try {
        v = JSON.parse(s);
      } catch {
        try {
          v = JSON.parse('"' + s.trim() + '"');
        } catch {
          throw new JmesError('Invalid JSON literal', i);
        }
      }
      out.push({ t: 'literal', v, pos: i });
      i = j + 1;
    } else {
      const two = expr.slice(i, i + 2);
      const TWO: Record<string, string> = { '[]': 'flatten', '[?': 'filter', '||': 'or', '&&': 'and', '==': 'eq', '!=': 'ne', '<=': 'lte', '>=': 'gte' };
      if (TWO[two]) {
        out.push({ t: TWO[two], pos: i });
        i += 2;
      }
      else {
        const single: Record<string, string> = { '.': 'dot', '*': 'star', '[': 'lbracket', ']': 'rbracket', '{': 'lbrace', '}': 'rbrace', '(': 'lparen', ')': 'rparen', ',': 'comma', ':': 'colon', '|': 'pipe', '&': 'expref', '!': 'not', '<': 'lt', '>': 'gt', '@': 'current' };
        const t = single[c];
        if (!t) throw new JmesError(`Unknown token '${c}'`, i);
        out.push({ t, pos: i });
        i++;
      }
    }
  }
  out.push({ t: 'eof', pos: n });
  return out;
}

const BP: Record<string, number> = {
  eof: 0, ident: 0, quoted: 0, literal: 0, rbracket: 0, rparen: 0, comma: 0, rbrace: 0, number: 0, current: 0, expref: 0, colon: 0,
  pipe: 1, or: 2, and: 3, eq: 5, gt: 5, lt: 5, gte: 5, lte: 5, ne: 5, flatten: 9, star: 20, filter: 21, dot: 40, not: 45, lbrace: 50, lbracket: 55, lparen: 60,
};

type Node =
  | { k: 'field'; name: string }
  | { k: 'identity' }
  | { k: 'literal'; v: unknown }
  | { k: 'sub'; l: Node; r: Node }
  | { k: 'index'; l: Node; i: number }
  | { k: 'slice'; l: Node; a: number | null; b: number | null; s: number | null }
  | { k: 'proj'; l: Node; r: Node }
  | { k: 'vproj'; l: Node; r: Node }
  | { k: 'fproj'; l: Node; r: Node; c: Node }
  | { k: 'flatten'; c: Node }
  | { k: 'pipe'; l: Node; r: Node }
  | { k: 'or'; l: Node; r: Node }
  | { k: 'and'; l: Node; r: Node }
  | { k: 'not'; c: Node }
  | { k: 'cmp'; op: string; l: Node; r: Node }
  | { k: 'mlist'; items: Node[] }
  | { k: 'mhash'; items: [string, Node][] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'expref'; c: Node };

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private get tok() {
    return this.toks[this.p];
  }
  private look(n = 1) {
    return this.toks[Math.min(this.p + n, this.toks.length - 1)];
  }
  private adv() {
    this.p++;
  }
  private expect(t: string) {
    if (this.tok.t !== t) throw new JmesError(`Expected ${t}, got ${this.tok.t}`, this.tok.pos);
    this.adv();
  }

  parseAll(): Node {
    const n = this.expr(0);
    if (this.tok.t !== 'eof') throw new JmesError(`Unexpected token ${this.tok.t}`, this.tok.pos);
    return n;
  }

  expr(rbp: number): Node {
    const t = this.tok;
    this.adv();
    let left = this.nud(t);
    while (rbp < BP[this.tok.t]) {
      const lt = this.tok;
      this.adv();
      left = this.led(lt, left);
    }
    return left;
  }

  private nud(t: Tok): Node {
    switch (t.t) {
      case 'literal': return { k: 'literal', v: t.v };
      case 'ident': return { k: 'field', name: t.v as string };
      case 'quoted':
        if (this.tok.t === 'lparen') throw new JmesError('Quoted identifier not allowed for function names', t.pos);
        return { k: 'field', name: t.v as string };
      case 'star': {
        const left: Node = { k: 'identity' };
        return { k: 'vproj', l: left, r: this.projRhs(BP.star) };
      }
      case 'filter': return this.filterLed({ k: 'identity' });
      case 'lbrace': return this.mhash();
      case 'flatten': return { k: 'proj', l: { k: 'flatten', c: { k: 'identity' } }, r: this.projRhs(BP.flatten) };
      case 'not': return { k: 'not', c: this.expr(BP.not) };
      case 'lparen': {
        const e = this.expr(0);
        this.expect('rparen');
        return e;
      }
      case 'current': return { k: 'identity' };
      case 'expref': return { k: 'expref', c: this.expr(BP.expref) };
      case 'lbracket': {
        if (this.tok.t === 'number' || this.tok.t === 'colon') return this.indexOrSlice({ k: 'identity' });
        if (this.tok.t === 'star' && this.look().t === 'rbracket') {
          this.adv();
          this.adv();
          return { k: 'proj', l: { k: 'identity' }, r: this.projRhs(BP.star) };
        }
        return this.mlist();
      }
      default:
        throw new JmesError(`Invalid expression: unexpected ${t.t}`, t.pos);
    }
  }

  private led(t: Tok, left: Node): Node {
    switch (t.t) {
      case 'dot': {
        if (this.tok.t === 'star') {
          this.adv();
          return { k: 'vproj', l: left, r: this.projRhs(BP.dot) };
        }
        return { k: 'sub', l: left, r: this.dotRhs(BP.dot) };
      }
      case 'pipe': return { k: 'pipe', l: left, r: this.expr(BP.pipe) };
      case 'or': return { k: 'or', l: left, r: this.expr(BP.or) };
      case 'and': return { k: 'and', l: left, r: this.expr(BP.and) };
      case 'lparen': {
        if (left.k !== 'field') throw new JmesError('Invalid function call', t.pos);
        const args: Node[] = [];
        while (this.tok.t !== 'rparen') {
          args.push(this.expr(0));
          if (this.tok.t === 'comma') this.adv();
        }
        this.expect('rparen');
        return { k: 'call', name: left.name, args };
      }
      case 'filter': return this.filterLed(left);
      case 'flatten': return { k: 'proj', l: { k: 'flatten', c: left }, r: this.projRhs(BP.flatten) };
      case 'eq': case 'ne': case 'gt': case 'gte': case 'lt': case 'lte':
        return { k: 'cmp', op: t.t, l: left, r: this.expr(BP[t.t]) };
      case 'lbracket': {
        if (this.tok.t === 'number' || this.tok.t === 'colon') return this.indexOrSlice(left);
        this.expect('star');
        this.expect('rbracket');
        return { k: 'proj', l: left, r: this.projRhs(BP.star) };
      }
      default:
        throw new JmesError(`Unexpected token ${t.t}`, t.pos);
    }
  }

  private filterLed(left: Node): Node {
    const c = this.expr(0);
    this.expect('rbracket');
    return { k: 'fproj', l: left, c, r: this.projRhs(BP.filter) };
  }

  private indexOrSlice(left: Node): Node {
    const parts: (number | null)[] = [null, null, null];
    let colons = 0;
    let idx = 0;
    while (this.tok.t !== 'rbracket') {
      if (this.tok.t === 'number') {
        parts[idx] = this.tok.v as number;
        this.adv();
      } else if (this.tok.t === 'colon') {
        colons++;
        idx++;
        if (colons > 2) throw new JmesError('Too many colons in slice', this.tok.pos);
        this.adv();
      } else throw new JmesError(`Unexpected token ${this.tok.t} in index`, this.tok.pos);
    }
    this.expect('rbracket');
    if (colons === 0) return { k: 'index', l: left, i: parts[0] as number };
    if (parts[2] === 0) throw new JmesError('Invalid slice: step cannot be 0', this.tok.pos);
    return { k: 'slice', l: left, a: parts[0], b: parts[1], s: parts[2] };
  }

  private projRhs(bp: number): Node {
    const t = this.tok.t;
    if (BP[t] < 10) return { k: 'identity' };
    if (t === 'dot') {
      this.adv();
      return this.dotRhs(bp);
    }
    if (t === 'lbracket' || t === 'filter') return this.expr(bp);
    throw new JmesError(`Syntax error after projection: ${t}`, this.tok.pos);
  }

  private dotRhs(bp: number): Node {
    const t = this.tok.t;
    if (t === 'ident' || t === 'quoted' || t === 'star') return this.expr(bp);
    if (t === 'lbracket') {
      this.adv();
      return this.mlist();
    }
    if (t === 'lbrace') {
      this.adv();
      return this.mhash();
    }
    throw new JmesError(`Expected identifier after '.', got ${t}`, this.tok.pos);
  }

  private mlist(): Node {
    const items: Node[] = [];
    for (;;) {
      items.push(this.expr(0));
      if (this.tok.t === 'comma') {
        this.adv();
        continue;
      }
      this.expect('rbracket');
      break;
    }
    return { k: 'mlist', items };
  }

  private mhash(): Node {
    const items: [string, Node][] = [];
    for (;;) {
      const kt = this.tok;
      if (kt.t !== 'ident' && kt.t !== 'quoted') throw new JmesError('Expected key in multiselect hash', kt.pos);
      this.adv();
      this.expect('colon');
      items.push([kt.v as string, this.expr(0)]);
      if (this.tok.t === 'comma') {
        this.adv();
        continue;
      }
      this.expect('rbrace');
      break;
    }
    return { k: 'mhash', items };
  }
}

// ───────────────────────── intérprete ─────────────────────────

const truthy = (v: unknown): boolean => !(v === null || v === undefined || v === false || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEq(a[k], b[k]));
  }
  return false;
}

const typeOf = (v: unknown): string => (v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);

type Fn = (args: unknown[], interp: Interp) => unknown;
interface Closure {
  expref: Node;
}

function visitSlice(len: number, a: number | null, b: number | null, s: number | null): number[] {
  const step = s ?? 1;
  const norm = (x: number | null, dflt: number, lo: number, hi: number) => {
    if (x === null) return dflt;
    let y = x < 0 ? x + len : x;
    if (y < lo) y = lo;
    if (y > hi) y = hi;
    return y;
  };
  const idx: number[] = [];
  if (step > 0) {
    const start = norm(a, 0, 0, len);
    const stop = norm(b, len, 0, len);
    for (let i = start; i < stop; i += step) idx.push(i);
  } else {
    const start = norm(a, len - 1, -1, len - 1);
    const stop = norm(b, -1, -1, len - 1);
    for (let i = start; i > stop; i += step) idx.push(i);
  }
  return idx;
}

class Interp {
  visit(n: Node, v: unknown): unknown {
    switch (n.k) {
      case 'field':
        return isObject(v) && n.name in v ? (v[n.name] === undefined ? null : v[n.name]) : null;
      case 'identity': return v;
      case 'literal': return n.v;
      case 'sub': {
        const l = this.visit(n.l, v);
        return l === null ? null : this.visit(n.r, l);
      }
      case 'index': {
        const l = this.visit(n.l, v);
        if (!Array.isArray(l)) return null;
        const i = n.i < 0 ? l.length + n.i : n.i;
        return i >= 0 && i < l.length ? l[i] : null;
      }
      case 'slice': {
        const l = this.visit(n.l, v);
        if (!Array.isArray(l)) return null;
        return visitSlice(l.length, n.a, n.b, n.s).map((i) => l[i]);
      }
      case 'proj': {
        const base = this.visit(n.l, v);
        if (!Array.isArray(base)) return null;
        const out: unknown[] = [];
        for (const el of base) {
          const r = this.visit(n.r, el);
          if (r !== null) out.push(r);
        }
        return out;
      }
      case 'vproj': {
        const base = this.visit(n.l, v);
        if (!isObject(base)) return null;
        const out: unknown[] = [];
        for (const el of Object.values(base)) {
          const r = this.visit(n.r, el);
          if (r !== null) out.push(r);
        }
        return out;
      }
      case 'fproj': {
        const base = this.visit(n.l, v);
        if (!Array.isArray(base)) return null;
        const out: unknown[] = [];
        for (const el of base) {
          if (!truthy(this.visit(n.c, el))) continue;
          const r = this.visit(n.r, el);
          if (r !== null) out.push(r);
        }
        return out;
      }
      case 'flatten': {
        const base = this.visit(n.c, v);
        if (!Array.isArray(base)) return null;
        const out: unknown[] = [];
        for (const el of base) {
          if (Array.isArray(el)) out.push(...el);
          else out.push(el);
        }
        return out;
      }
      case 'pipe': return this.visit(n.r, this.visit(n.l, v));
      case 'or': {
        const l = this.visit(n.l, v);
        return truthy(l) ? l : this.visit(n.r, v);
      }
      case 'and': {
        const l = this.visit(n.l, v);
        return truthy(l) ? this.visit(n.r, v) : l;
      }
      case 'not': return !truthy(this.visit(n.c, v));
      case 'cmp': {
        const a = this.visit(n.l, v);
        const b = this.visit(n.r, v);
        if (n.op === 'eq') return deepEq(a, b);
        if (n.op === 'ne') return !deepEq(a, b);
        if (typeof a !== 'number' || typeof b !== 'number') return null;
        return n.op === 'gt' ? a > b : n.op === 'gte' ? a >= b : n.op === 'lt' ? a < b : a <= b;
      }
      case 'mlist': return v === null ? null : n.items.map((i) => this.visit(i, v));
      case 'mhash': {
        if (v === null) return null;
        const o: Record<string, unknown> = {};
        for (const [k, e] of n.items) o[k] = this.visit(e, v);
        return o;
      }
      case 'expref': return { expref: n.c } as Closure;
      case 'call': {
        const f = FUNCS[n.name];
        if (!f) throw new JmesError(`Unknown function: ${n.name}()`);
        return f(n.args.map((a) => this.visit(a, v)), this);
      }
    }
  }

  call(c: unknown, v: unknown): unknown {
    return this.visit((c as Closure).expref, v);
  }
}

const isClosure = (x: unknown): x is Closure => isObject(x) && 'expref' in x;

function need(name: string, args: unknown[], n: number) {
  if (args.length !== n) throw new JmesError(`ArgumentError: ${name}() takes ${n} argument${n === 1 ? '' : 's'} but received ${args.length}`);
}

function expectType(name: string, v: unknown, ...types: string[]) {
  if (!types.includes(typeOf(v))) throw new JmesError(`TypeError: ${name}() expected argument to be type ${types.join(' or ')}, received ${typeOf(v)}`);
}

function cmpVals(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const FUNCS: Record<string, Fn> = {
  abs: (a) => (need('abs', a, 1), expectType('abs', a[0], 'number'), Math.abs(a[0] as number)),
  avg: (a) => {
    need('avg', a, 1);
    expectType('avg', a[0], 'array');
    const l = a[0] as number[];
    return l.length ? l.reduce((s, x) => s + x, 0) / l.length : null;
  },
  ceil: (a) => (need('ceil', a, 1), expectType('ceil', a[0], 'number'), Math.ceil(a[0] as number)),
  floor: (a) => (need('floor', a, 1), expectType('floor', a[0], 'number'), Math.floor(a[0] as number)),
  contains: (a) => {
    need('contains', a, 2);
    expectType('contains', a[0], 'array', 'string');
    return typeof a[0] === 'string' ? (a[0] as string).includes(String(a[1])) : (a[0] as unknown[]).some((x) => deepEq(x, a[1]));
  },
  ends_with: (a) => (need('ends_with', a, 2), expectType('ends_with', a[0], 'string'), expectType('ends_with', a[1], 'string'), (a[0] as string).endsWith(a[1] as string)),
  starts_with: (a) => (need('starts_with', a, 2), expectType('starts_with', a[0], 'string'), expectType('starts_with', a[1], 'string'), (a[0] as string).startsWith(a[1] as string)),
  join: (a) => {
    need('join', a, 2);
    expectType('join', a[0], 'string');
    expectType('join', a[1], 'array');
    const l = a[1] as unknown[];
    if (l.some((x) => typeof x !== 'string')) throw new JmesError('TypeError: join() expected array of strings');
    return l.join(a[0] as string);
  },
  keys: (a) => (need('keys', a, 1), expectType('keys', a[0], 'object'), Object.keys(a[0] as object)),
  values: (a) => (need('values', a, 1), expectType('values', a[0], 'object'), Object.values(a[0] as object)),
  length: (a) => {
    need('length', a, 1);
    expectType('length', a[0], 'string', 'array', 'object');
    return typeof a[0] === 'string' ? [...a[0]].length : Array.isArray(a[0]) ? a[0].length : Object.keys(a[0] as object).length;
  },
  map: (a, it) => {
    need('map', a, 2);
    if (!isClosure(a[0])) throw new JmesError('TypeError: map() expected an expression reference');
    expectType('map', a[1], 'array');
    return (a[1] as unknown[]).map((x) => it.call(a[0], x));
  },
  max: (a) => {
    need('max', a, 1);
    expectType('max', a[0], 'array');
    const l = a[0] as unknown[];
    return l.length ? l.reduce((m, x) => (cmpVals(x, m) > 0 ? x : m)) : null;
  },
  min: (a) => {
    need('min', a, 1);
    expectType('min', a[0], 'array');
    const l = a[0] as unknown[];
    return l.length ? l.reduce((m, x) => (cmpVals(x, m) < 0 ? x : m)) : null;
  },
  max_by: (a, it) => {
    need('max_by', a, 2);
    expectType('max_by', a[0], 'array');
    const l = a[0] as unknown[];
    if (!l.length) return null;
    return l.reduce((m, x) => (cmpVals(it.call(a[1], x), it.call(a[1], m)) > 0 ? x : m));
  },
  min_by: (a, it) => {
    need('min_by', a, 2);
    expectType('min_by', a[0], 'array');
    const l = a[0] as unknown[];
    if (!l.length) return null;
    return l.reduce((m, x) => (cmpVals(it.call(a[1], x), it.call(a[1], m)) < 0 ? x : m));
  },
  merge: (a) => Object.assign({}, ...a.map((x) => (isObject(x) ? x : {}))),
  not_null: (a) => {
    for (const x of a) if (x !== null && x !== undefined) return x;
    return null;
  },
  reverse: (a) => {
    need('reverse', a, 1);
    expectType('reverse', a[0], 'array', 'string');
    return typeof a[0] === 'string' ? [...(a[0] as string)].reverse().join('') : [...(a[0] as unknown[])].reverse();
  },
  sort: (a) => {
    need('sort', a, 1);
    expectType('sort', a[0], 'array');
    return [...(a[0] as unknown[])].sort(cmpVals);
  },
  sort_by: (a, it) => {
    need('sort_by', a, 2);
    expectType('sort_by', a[0], 'array');
    const l = (a[0] as unknown[]).map((x) => [it.call(a[1], x), x] as const);
    return l.sort((x, y) => cmpVals(x[0], y[0])).map((x) => x[1]);
  },
  sum: (a) => (need('sum', a, 1), expectType('sum', a[0], 'array'), (a[0] as number[]).reduce((s, x) => s + x, 0)),
  to_array: (a) => (need('to_array', a, 1), Array.isArray(a[0]) ? a[0] : [a[0]]),
  to_string: (a) => (need('to_string', a, 1), typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0])),
  to_number: (a) => {
    need('to_number', a, 1);
    if (typeof a[0] === 'number') return a[0];
    if (typeof a[0] === 'string' && a[0].trim() !== '' && !Number.isNaN(Number(a[0]))) return Number(a[0]);
    return null;
  },
  type: (a) => (need('type', a, 1), typeOf(a[0])),
};

const cache = new Map<string, Node>();

/** Aplica una expresión JMESPath a un valor. Lanza `JmesError` si la expresión no es válida. */
export function search(expr: string, data: unknown): Json {
  let ast = cache.get(expr);
  if (!ast) {
    ast = new Parser(tokenize(expr)).parseAll();
    if (cache.size > 200) cache.clear();
    cache.set(expr, ast);
  }
  const r = new Interp().visit(ast, data);
  return (r === undefined ? null : r) as Json;
}
