/** Lenguaje de consultas de CloudWatch Logs Insights: `fields`, `filter`, `stats … by`, `sort`, `limit`, `parse`, `dedup`, `display`. */
import { AwsError } from '../registry';
import { jsonPath } from './logpattern';

export type V = string | number | boolean | null | undefined;
export type Rec = Map<string, V>;

export interface InsightsRow {
  field: string;
  value: string;
}

export interface InsightsResult {
  rows: InsightsRow[][];
  matched: number;
  scanned: number;
  bytes: number;
}

export interface RawEvent {
  timestamp: number;
  message: string;
  ingestionTime: number;
  stream: string;
  group: string;
}

// ───────────────────────── léxico ─────────────────────────

type Tok = { k: 'num' | 'str' | 're' | 'id' | 'op' | 'pipe' | 'comma' | 'lp' | 'rp' | 'lb' | 'rb'; v: string; pos: number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const prevIsValue = () => {
    const p = out[out.length - 1];
    return !!p && (p.k === 'num' || p.k === 'id' || p.k === 'str' || p.k === 'rp' || p.k === 'rb');
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const pos = i;
    const single: Record<string, Tok['k']> = { '|': 'pipe', ',': 'comma', '(': 'lp', ')': 'rp', '[': 'lb', ']': 'rb' };
    if (single[ch]) {
      out.push({ k: single[ch], v: ch, pos });
      i++;
    }
    else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1] === 'n' ? '\n' : src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw malformed('unterminated string', src, pos);
      out.push({ k: 'str', v: s, pos });
      i = j + 1;
    } else if (ch === '`') {
      const j = src.indexOf('`', i + 1);
      if (j < 0) throw malformed('unterminated backtick', src, pos);
      out.push({ k: 'id', v: src.slice(i + 1, j), pos });
      i = j + 1;
    } else if (ch === '/' && !prevIsValue()) {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '/') {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j] + src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw malformed('unterminated regular expression', src, pos);
      out.push({ k: 're', v: s, pos });
      i = j + 1;
    } else if (/\d/.test(ch)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      out.push({ k: 'num', v: m[0], pos });
      i += m[0].length;
    } else if (/[@\p{L}_]/u.test(ch)) {
      const m = /^[@\p{L}_][\w.@\p{L}]*/u.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], pos });
      i += m[0].length;
    } else {
      const m = /^(=~|!=|>=|<=|=|>|<|\+|-|\*|\/|%)/.exec(src.slice(i));
      if (!m) throw malformed(`unexpected symbol found ${ch}`, src, pos);
      out.push({ k: 'op', v: m[0], pos });
      i += m[0].length;
    }
  }
  return out;
}

function malformed(msg: string, src: string, pos: number): AwsError {
  const before = src.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return new AwsError('MalformedQueryException', `${msg} at line ${line} and position ${col}`, 400);
}

// ───────────────────────── expresiones ─────────────────────────

type Ex =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 're'; v: string }
  | { t: 'f'; name: string }
  | { t: 'call'; name: string; args: Ex[] }
  | { t: 'bin'; op: string; l: Ex; r: Ex }
  | { t: 'not'; e: Ex }
  | { t: 'neg'; e: Ex }
  | { t: 'in'; e: Ex; list: Ex[]; neg: boolean }
  | { t: 'like'; e: Ex; pat: Ex; neg: boolean };

class Parser {
  i = 0;
  constructor(public toks: Tok[], public src: string) {}
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new AwsError('MalformedQueryException', 'unexpected end of query', 400);
    return t;
  }
  err(t: Tok | undefined, what?: string): AwsError {
    return t ? malformed(`unexpected symbol found ${t.v}${what ? ` (${what})` : ''}`, this.src, t.pos) : new AwsError('MalformedQueryException', 'unexpected end of query', 400);
  }
  isWord(w: string): boolean {
    const t = this.peek();
    return !!t && t.k === 'id' && t.v.toLowerCase() === w;
  }
  expr(): Ex {
    return this.or();
  }
  or(): Ex {
    let l = this.and();
    while (this.isWord('or')) {
      this.next();
      l = { t: 'bin', op: 'or', l, r: this.and() };
    }
    return l;
  }
  and(): Ex {
    let l = this.not();
    while (this.isWord('and')) {
      this.next();
      l = { t: 'bin', op: 'and', l, r: this.not() };
    }
    return l;
  }
  not(): Ex {
    if (this.isWord('not') && !(this.toks[this.i + 1]?.k === 'id' && ['like', 'in'].includes(this.toks[this.i + 1].v.toLowerCase()))) {
      this.next();
      return { t: 'not', e: this.not() };
    }
    return this.cmp();
  }
  cmp(): Ex {
    const l = this.add();
    const t = this.peek();
    if (!t) return l;
    if (t.k === 'op' && ['=', '!=', '<', '<=', '>', '>=', '=~'].includes(t.v)) {
      this.next();
      return { t: 'bin', op: t.v, l, r: this.add() };
    }
    let neg = false;
    if (this.isWord('not')) {
      neg = true;
      this.next();
    }
    if (this.isWord('like')) {
      this.next();
      return { t: 'like', e: l, pat: this.add(), neg };
    }
    if (this.isWord('in')) {
      this.next();
      const lb = this.next();
      if (lb.k !== 'lb' && lb.k !== 'lp') throw this.err(lb);
      const list: Ex[] = [];
      while (this.peek() && this.peek()!.k !== 'rb' && this.peek()!.k !== 'rp') {
        list.push(this.add());
        if (this.peek()?.k === 'comma') this.next();
      }
      this.next();
      return { t: 'in', e: l, list, neg };
    }
    if (neg) throw this.err(this.peek());
    return l;
  }
  add(): Ex {
    let l = this.mul();
    while (this.peek()?.k === 'op' && (this.peek()!.v === '+' || this.peek()!.v === '-')) {
      const op = this.next().v;
      l = { t: 'bin', op, l, r: this.mul() };
    }
    return l;
  }
  mul(): Ex {
    let l = this.unary();
    while (this.peek()?.k === 'op' && ['*', '/', '%'].includes(this.peek()!.v)) {
      const op = this.next().v;
      l = { t: 'bin', op, l, r: this.unary() };
    }
    return l;
  }
  unary(): Ex {
    if (this.peek()?.k === 'op' && this.peek()!.v === '-') {
      this.next();
      return { t: 'neg', e: this.unary() };
    }
    return this.primary();
  }
  primary(): Ex {
    const t = this.next();
    if (t.k === 'num') {
      let n = Number(t.v);
      const u = this.peek();
      // 5m, 1h… como duración en milisegundos solo dentro de bin()/datefloor(): se resuelve allí
      if (u && u.k === 'id' && /^(ms|s|m|h|d|w)$/.test(u.v) && u.pos === t.pos + t.v.length) {
        this.next();
        return { t: 'str', v: t.v + u.v };
      }
      return { t: 'num', v: n };
    }
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 're') return { t: 're', v: t.v };
    if (t.k === 'lp') {
      const e = this.expr();
      if (this.next().k !== 'rp') throw this.err(this.toks[this.i - 1]);
      return e;
    }
    if (t.k === 'id') {
      if (this.peek()?.k === 'lp') {
        this.next();
        const args: Ex[] = [];
        while (this.peek() && this.peek()!.k !== 'rp') {
          if (this.peek()!.k === 'op' && this.peek()!.v === '*') {
            this.next();
            args.push({ t: 'f', name: '*' });
          } else args.push(this.expr());
          if (this.peek()?.k === 'comma') this.next();
        }
        if (this.next().k !== 'rp') throw this.err(this.toks[this.i - 1]);
        return { t: 'call', name: t.v.toLowerCase(), args };
      }
      return { t: 'f', name: t.v };
    }
    throw this.err(t);
  }
}

const DUR: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
const durOf = (v: V): number => {
  const m = /^(\d+)\s*(ms|s|m|h|d|w)$/.exec(String(v));
  return m ? Number(m[1]) * DUR[m[2]] : NaN;
};

const asNum = (v: V): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
};
const asStr = (v: V): string | null => (v === undefined || v === null ? null : typeof v === 'string' ? v : String(v));

function cmpValues(op: string, l: V, r: V): boolean {
  if (l === undefined || l === null || r === undefined || r === null) return op === '!=' ? l !== r : false;
  const ln = asNum(l);
  const rn = asNum(r);
  if (ln !== null && rn !== null && (typeof l === 'number' || typeof r === 'number')) {
    return op === '=' ? ln === rn : op === '!=' ? ln !== rn : op === '<' ? ln < rn : op === '<=' ? ln <= rn : op === '>' ? ln > rn : ln >= rn;
  }
  const a = String(l);
  const b = String(r);
  return op === '=' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
}

const re = (v: string): RegExp => {
  try {
    return new RegExp(v);
  } catch {
    throw new AwsError('MalformedQueryException', `invalid regular expression /${v}/`, 400);
  }
};

function ev(e: Ex, r: Rec): V {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'str':
      return e.v;
    case 're':
      return e.v;
    case 'f':
      return r.get(e.name);
    case 'neg': {
      const n = asNum(ev(e.e, r));
      return n === null ? undefined : -n;
    }
    case 'not':
      return !ev(e.e, r);
    case 'in': {
      const v = ev(e.e, r);
      const hit = e.list.some((x) => cmpValues('=', v, ev(x, r)));
      return e.neg ? !hit : hit;
    }
    case 'like': {
      const v = asStr(ev(e.e, r));
      if (v === null) return false;
      const hit = e.pat.t === 're' ? re(e.pat.v).test(v) : v.includes(String(ev(e.pat, r)));
      return e.neg ? !hit : hit;
    }
    case 'bin': {
      if (e.op === 'and') return !!ev(e.l, r) && !!ev(e.r, r);
      if (e.op === 'or') return !!ev(e.l, r) || !!ev(e.r, r);
      if (e.op === '=~') {
        const s = asStr(ev(e.l, r));
        return s !== null && re(e.r.t === 're' || e.r.t === 'str' ? (e.r as { v: string }).v : String(ev(e.r, r))).test(s);
      }
      const l = ev(e.l, r);
      const rr = ev(e.r, r);
      if (['=', '!=', '<', '<=', '>', '>='].includes(e.op)) return cmpValues(e.op, l, rr);
      const a = asNum(l);
      const b = asNum(rr);
      if (a === null || b === null) return e.op === '+' && (typeof l === 'string' || typeof rr === 'string') ? undefined : undefined;
      return e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : e.op === '/' ? (b === 0 ? undefined : a / b) : b === 0 ? undefined : a % b;
    }
    case 'call':
      return callFn(e, r);
  }
}

function callFn(e: Extract<Ex, { t: 'call' }>, r: Rec): V {
  const a = e.args.map((x) => ev(x, r));
  const s = (i: number) => asStr(a[i]);
  const n = (i: number) => asNum(a[i]);
  switch (e.name) {
    case 'ispresent':
      return a[0] !== undefined && a[0] !== null;
    case 'isblank':
      return a[0] === undefined || a[0] === null || a[0] === '';
    case 'isempty':
      return a[0] === undefined || a[0] === null || a[0] === '';
    case 'strlen':
      return s(0)?.length;
    case 'toupper':
      return s(0)?.toUpperCase();
    case 'tolower':
      return s(0)?.toLowerCase();
    case 'trim':
      return s(0)?.trim();
    case 'ltrim':
      return s(0)?.replace(/^\s+/, '');
    case 'rtrim':
      return s(0)?.replace(/\s+$/, '');
    case 'substr': {
      const x = s(0);
      const from = n(1);
      if (x === null || from === null) return undefined;
      const len = n(2);
      return len === null ? x.slice(from) : x.slice(from, from + len);
    }
    case 'replace':
      return s(0)?.split(s(1) ?? '').join(s(2) ?? '');
    case 'strcontains':
      return s(0) !== null && s(0)!.includes(s(1) ?? '');
    case 'concat':
      return a.map((x) => asStr(x) ?? '').join('');
    case 'coalesce':
      return a.find((x) => x !== undefined && x !== null && x !== '');
    case 'abs':
      return n(0) === null ? undefined : Math.abs(n(0)!);
    case 'ceil':
      return n(0) === null ? undefined : Math.ceil(n(0)!);
    case 'floor':
      return n(0) === null ? undefined : Math.floor(n(0)!);
    case 'sqrt':
      return n(0) === null ? undefined : Math.sqrt(n(0)!);
    case 'log':
      return n(0) === null ? undefined : Math.log(n(0)!);
    case 'exp':
      return n(0) === null ? undefined : Math.exp(n(0)!);
    case 'greatest':
      return Math.max(...a.map(asNum).filter((x): x is number => x !== null));
    case 'least':
      return Math.min(...a.map(asNum).filter((x): x is number => x !== null));
    case 'tomillis':
      return typeof a[0] === 'number' ? a[0] : Date.parse(String(a[0]));
    case 'frommillis':
      return n(0) === null ? undefined : fmtTs(n(0)!);
    case 'datefloor':
    case 'bin': {
      const bucket = e.name === 'bin' ? durOf(a[a.length - 1]) : durOf(a[1]);
      const t = e.name === 'bin' && a.length < 2 ? asNum(r.get('@timestamp')) : n(0);
      if (t === null || Number.isNaN(bucket)) return undefined;
      return Math.floor(t / bucket) * bucket;
    }
    case 'dateceil': {
      const bucket = durOf(a[1]);
      const t = n(0);
      if (t === null || Number.isNaN(bucket)) return undefined;
      return Math.ceil(t / bucket) * bucket;
    }
    default:
      throw new AwsError('MalformedQueryException', `unknown function ${e.name}`, 400);
  }
}

const fmtTs = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

// ───────────────────────── comandos ─────────────────────────

type Agg = { fn: string; arg?: Ex; p?: number; name: string };
type Cmd =
  | { c: 'fields'; items: { e: Ex; as: string }[] }
  | { c: 'display'; names: string[] }
  | { c: 'filter'; e: Ex }
  | { c: 'stats'; aggs: Agg[]; by: { e: Ex; as: string }[] }
  | { c: 'sort'; keys: { e: Ex; desc: boolean }[] }
  | { c: 'limit'; n: number }
  | { c: 'parse'; field: string; glob?: string; regex?: string; names: string[] }
  | { c: 'dedup'; fields: string[] };

const AGGS = new Set(['count', 'count_distinct', 'avg', 'sum', 'min', 'max', 'pct', 'stddev', 'earliest', 'latest', 'sortsfirst', 'sortslast']);

function label(e: Ex): string {
  switch (e.t) {
    case 'f':
      return e.name;
    case 'num':
      return String(e.v);
    case 'str':
      return /^\d+(ms|s|m|h|d|w)$/.test(e.v) ? e.v : `"${e.v}"`;
    case 're':
      return `/${e.v}/`;
    case 'call':
      return `${e.name}(${e.args.map(label).join(', ')})`;
    case 'bin':
      return `${label(e.l)} ${e.op} ${label(e.r)}`;
    case 'not':
      return `not ${label(e.e)}`;
    case 'neg':
      return `-${label(e.e)}`;
    case 'in':
      return `${label(e.e)} ${e.neg ? 'not ' : ''}in [${e.list.map(label).join(', ')}]`;
    case 'like':
      return `${label(e.e)} ${e.neg ? 'not ' : ''}like ${label(e.pat)}`;
  }
}

export function parseQuery(src: string): Cmd[] {
  if (!src.trim()) throw new AwsError('MalformedQueryException', 'The query string is empty.', 400);
  const toks = lex(src);
  const cmds: Cmd[] = [];
  const groups: Tok[][] = [[]];
  for (const t of toks) {
    if (t.k === 'pipe') groups.push([]);
    else groups[groups.length - 1].push(t);
  }
  for (const g of groups) {
    if (!g.length) throw new AwsError('MalformedQueryException', 'Empty command between pipes.', 400);
    const head = g[0];
    if (head.k !== 'id') throw malformed(`unexpected symbol found ${head.v}`, src, head.pos);
    const word = head.v.toLowerCase();
    const p = new Parser(g.slice(1), src);
    const list = <T,>(item: () => T): T[] => {
      const out = [item()];
      while (p.peek()?.k === 'comma') {
        p.next();
        out.push(item());
      }
      if (p.peek()) throw p.err(p.peek());
      return out;
    };
    const aliased = () => {
      const e = p.expr();
      let as = label(e);
      if (p.isWord('as')) {
        p.next();
        as = p.next().v;
      }
      return { e, as };
    };
    switch (word) {
      case 'fields':
        cmds.push({ c: 'fields', items: list(aliased) });
        break;
      case 'display':
        cmds.push({ c: 'display', names: list(() => label(p.expr())) });
        break;
      case 'filter': {
        const e = p.expr();
        if (p.peek()) throw p.err(p.peek());
        cmds.push({ c: 'filter', e });
        break;
      }
      case 'limit': {
        const t = p.next();
        if (t.k !== 'num') throw p.err(t);
        cmds.push({ c: 'limit', n: Number(t.v) });
        break;
      }
      case 'sort':
        cmds.push({
          c: 'sort',
          keys: list(() => {
            const e = p.expr();
            let desc = false;
            if (p.isWord('desc')) {
              desc = true;
              p.next();
            } else if (p.isWord('asc')) p.next();
            return { e, desc };
          }),
        });
        break;
      case 'dedup':
        cmds.push({ c: 'dedup', fields: list(() => label(p.expr())) });
        break;
      case 'parse': {
        let field = '@message';
        if (p.peek()?.k === 'id') field = p.next().v;
        const pat = p.next();
        if (pat.k !== 'str' && pat.k !== 're') throw p.err(pat, 'expected a pattern');
        if (!p.isWord('as')) throw p.err(p.peek(), 'expected "as"');
        p.next();
        const names = list(() => p.next().v);
        cmds.push({ c: 'parse', field, ...(pat.k === 'str' ? { glob: pat.v } : { regex: pat.v }), names });
        break;
      }
      case 'stats': {
        const aggs: Agg[] = [];
        const agg = () => {
          const e = p.expr();
          if (e.t !== 'call' || !AGGS.has(e.name)) throw new AwsError('MalformedQueryException', `stats needs an aggregate function (count, sum, avg, min, max, pct, stddev, count_distinct, earliest, latest), found ${label(e)}`, 400);
          let as = label(e).replace(/^(\w+)\(/, (_m, f: string) => `${f}(`);
          if (p.isWord('as')) {
            p.next();
            as = p.next().v;
          }
          const a0: Agg = { fn: e.name, name: as };
          if (e.name === 'pct') {
            a0.arg = e.args[0];
            a0.p = e.args[1]?.t === 'num' ? e.args[1].v : 50;
          } else if (e.args.length && !(e.args[0].t === 'f' && e.args[0].name === '*')) a0.arg = e.args[0];
          return a0;
        };
        aggs.push(agg());
        while (p.peek()?.k === 'comma') {
          p.next();
          aggs.push(agg());
        }
        const by: { e: Ex; as: string }[] = [];
        if (p.isWord('by')) {
          p.next();
          by.push(...list(aliased));
        } else if (p.peek()) throw p.err(p.peek());
        cmds.push({ c: 'stats', aggs, by });
        break;
      }
      default:
        throw malformed(`unexpected symbol found ${head.v}`, src, head.pos);
    }
  }
  return cmds;
}

// ───────────────────────── datos ─────────────────────────

function flatten(prefix: string, v: unknown, out: Rec): void {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) v.forEach((x, i) => flatten(prefix ? `${prefix}.${i}` : String(i), x, out));
  else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
  else out.set(prefix, v as V);
}

function toRecord(e: RawEvent, acct: string): Rec {
  const r: Rec = new Map();
  r.set('@timestamp', e.timestamp);
  r.set('@message', e.message);
  r.set('@logStream', e.stream);
  r.set('@log', `${acct}:${e.group}`);
  r.set('@ingestionTime', e.ingestionTime);
  const m = e.message.trim();
  if (m.startsWith('{')) {
    try {
      flatten('', JSON.parse(m), r);
    } catch {
      /* no es JSON */
    }
  }
  const rep = /^REPORT RequestId: (\S+)\s+Duration: ([\d.]+) ms\s+Billed Duration: (\d+) ms\s+Memory Size: (\d+) MB\s+Max Memory Used: (\d+) MB(?:\s+Init Duration: ([\d.]+) ms)?/.exec(m);
  if (rep) {
    r.set('@type', 'REPORT');
    r.set('@requestId', rep[1]);
    r.set('@duration', Number(rep[2]));
    r.set('@billedDuration', Number(rep[3]));
    r.set('@memorySize', Number(rep[4]) * 1048576);
    r.set('@maxMemoryUsed', Number(rep[5]) * 1048576);
    if (rep[6]) r.set('@initDuration', Number(rep[6]));
  }
  return r;
}

// ───────────────────────── ejecución ─────────────────────────

const show = (v: V, name = ''): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') {
    if (name === '@timestamp' || name.startsWith('bin(') || name.startsWith('datefloor(') || name.startsWith('dateceil(')) return fmtTs(v);
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
};

function globToRegex(glob: string, names: string[]): RegExp {
  // cada «*» captura un fragmento; el resto es literal
  const parts = glob.split('*');
  let src = '';
  parts.forEach((p, i) => {
    src += p.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    if (i < parts.length - 1) src += i === parts.length - 2 && parts[parts.length - 1] === '' ? '(.*)' : '(.*?)';
  });
  void names;
  return new RegExp(src, 's');
}

function aggregate(fn: string, vals: V[], all: number, p?: number): V {
  const nums = vals.map(asNum).filter((x): x is number => x !== null);
  switch (fn) {
    case 'count':
      return vals.length ? vals.filter((x) => x !== undefined && x !== null).length : all;
    case 'count_distinct':
      return new Set(vals.filter((x) => x !== undefined && x !== null).map(String)).size;
    case 'avg':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined;
    case 'sum':
      return nums.length ? nums.reduce((a, b) => a + b, 0) : undefined;
    case 'min':
      return nums.length ? Math.min(...nums) : undefined;
    case 'max':
      return nums.length ? Math.max(...nums) : undefined;
    case 'stddev': {
      if (!nums.length) return undefined;
      const m = nums.reduce((a, b) => a + b, 0) / nums.length;
      return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length);
    }
    case 'pct': {
      if (!nums.length) return undefined;
      const s = [...nums].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.max(0, Math.ceil(((p ?? 50) / 100) * s.length) - 1))];
    }
    default:
      return undefined;
  }
}

export function runInsights(src: string, events: RawEvent[], acct: string, limit: number): InsightsResult {
  const cmds = parseQuery(src);
  let recs: Rec[] = events.map((e) => toRecord(e, acct));
  const scanned = recs.length;
  const bytes = events.reduce((n, e) => n + e.message.length + 26, 0);
  let matched = recs.length;
  let shown: string[] | null = null;
  let isStats = false;
  let statRows: { names: string[]; vals: V[] }[] = [];
  let sorted = false;

  for (const cmd of cmds) {
    switch (cmd.c) {
      case 'filter':
        recs = recs.filter((r) => !!ev(cmd.e, r));
        matched = recs.length;
        break;
      case 'fields':
        for (const r of recs) for (const it of cmd.items) if (it.e.t !== 'f' || it.as !== it.e.name) r.set(it.as, ev(it.e, r));
        shown = cmd.items.map((it) => it.as);
        break;
      case 'display':
        shown = cmd.names;
        break;
      case 'parse':
        for (const r of recs) {
          const text = asStr(r.get(cmd.field));
          if (text === null) continue;
          const rx = cmd.glob !== undefined ? globToRegex(cmd.glob, cmd.names) : re(cmd.regex!);
          const m = rx.exec(text);
          if (!m) continue;
          if (cmd.regex !== undefined && m.groups) for (const [k, v] of Object.entries(m.groups)) r.set(k, v);
          else cmd.names.forEach((n, i) => r.set(n, m[i + 1]));
        }
        if (cmd.glob !== undefined || !/\(\?<\w+>/.test(cmd.regex ?? '')) recs = recs.filter((r) => cmd.names.every((n) => r.has(n)));
        matched = recs.length;
        break;
      case 'dedup': {
        const seen = new Set<string>();
        recs = recs.filter((r) => {
          const k = cmd.fields.map((f) => String(r.get(f))).join('\u0001');
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        break;
      }
      case 'sort': {
        recs = [...recs].sort((x, y) => {
          for (const k of cmd.keys) {
            const a = ev(k.e, x);
            const b = ev(k.e, y);
            if (a === b) continue;
            if (a === undefined || a === null) return 1;
            if (b === undefined || b === null) return -1;
            const an = asNum(a);
            const bn = asNum(b);
            const c = an !== null && bn !== null && typeof a === 'number' && typeof b === 'number' ? an - bn : String(a) < String(b) ? -1 : 1;
            if (c !== 0) return k.desc ? -c : c;
          }
          return 0;
        });
        if (isStats) {
          const key = cmd.keys[0];
          const nameOf = key.e.t === 'f' ? key.e.name : label(key.e);
          statRows.sort((x, y) => {
            const ix = x.names.indexOf(nameOf);
            const a = x.vals[ix];
            const b = y.vals[ix];
            const an = asNum(a);
            const bn = asNum(b);
            const c = an !== null && bn !== null ? an - bn : String(a ?? '') < String(b ?? '') ? -1 : String(a ?? '') > String(b ?? '') ? 1 : 0;
            return key.desc ? -c : c;
          });
        }
        sorted = true;
        break;
      }
      case 'limit':
        if (isStats) statRows = statRows.slice(0, cmd.n);
        else recs = recs.slice(0, cmd.n);
        break;
      case 'stats': {
        isStats = true;
        const groups = new Map<string, { key: V[]; recs: Rec[] }>();
        for (const r of recs) {
          const key = cmd.by.map((b) => ev(b.e, r));
          const k = key.map((x) => String(x)).join('\u0001');
          if (!groups.has(k)) groups.set(k, { key, recs: [] });
          groups.get(k)!.recs.push(r);
        }
        if (!cmd.by.length && !groups.size) groups.set('', { key: [], recs: [] });
        statRows = [...groups.values()].map((g) => ({
          names: [...cmd.by.map((b) => b.as), ...cmd.aggs.map((a) => a.name)],
          vals: [
            ...g.key,
            ...cmd.aggs.map((a) => {
              if (a.fn === 'earliest' || a.fn === 'latest') {
                const rs = [...g.recs].sort((x, y) => (asNum(x.get('@timestamp')) ?? 0) - (asNum(y.get('@timestamp')) ?? 0));
                const pick = a.fn === 'earliest' ? rs[0] : rs[rs.length - 1];
                return pick && a.arg ? ev(a.arg, pick) : undefined;
              }
              const vals = a.arg ? g.recs.map((r) => ev(a.arg!, r)) : [];
              return aggregate(a.fn, vals, g.recs.length, a.p);
            }),
          ],
        }));
        // sin ordenar: por la primera clave de agrupación
        if (cmd.by.length) statRows.sort((x, y) => (asNum(x.vals[0]) !== null && asNum(y.vals[0]) !== null ? asNum(x.vals[0])! - asNum(y.vals[0])! : String(x.vals[0] ?? '') < String(y.vals[0] ?? '') ? -1 : 1));
        matched = recs.length;
        break;
      }
    }
  }

  const rows: InsightsRow[][] = [];
  if (isStats) {
    for (const s of statRows.slice(0, limit)) rows.push(s.names.map((n, i) => ({ field: n, value: show(s.vals[i], n) })));
  } else {
    if (!sorted) recs = [...recs].sort((x, y) => (asNum(y.get('@timestamp')) ?? 0) - (asNum(x.get('@timestamp')) ?? 0));
    const cols = shown ?? ['@timestamp', '@message'];
    recs.slice(0, limit).forEach((r, i) => {
      const row = cols.filter((c) => r.has(c) || shown === null || c === '@timestamp' || c === '@message').map((c) => ({ field: c, value: show(r.get(c), c) }));
      row.push({ field: '@ptr', value: `CmcKGgwKCjAxMjM0NTY3ODkwEAAiHBIKAAAAAAAAAAAAFgAAAAAAAAAAAAAAAAAAAAAAAAAA${String(i).padStart(4, '0')}` });
      rows.push(row.filter((x) => x.value !== '' || x.field === '@ptr'));
    });
  }
  return { rows, matched, scanned, bytes };
}

export { jsonPath };
