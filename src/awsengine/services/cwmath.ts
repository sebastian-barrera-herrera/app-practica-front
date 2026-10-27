/** Matemática de métricas de CloudWatch: `get-metric-data` y alarmas con `--metrics`. */
import { AwsError } from '../registry';
import type { Account } from '../types';
import { aggregate, metricSeries } from './metrics';

export interface MetricStatQ {
  Metric: { Namespace: string; MetricName: string; Dimensions?: { Name: string; Value: string }[] };
  Period: number;
  Stat: string;
  Unit?: string;
}

export interface MQuery {
  Id: string;
  Expression?: string;
  MetricStat?: MetricStatQ;
  Label?: string;
  ReturnData?: boolean;
  Period?: number;
}

export interface Series {
  ts: number[];
  vs: number[];
}

type Val = { k: 's'; v: number } | { k: 't'; s: Series } | { k: 'm'; list: Series[] };

export interface MResult {
  Id: string;
  Label: string;
  Series: Series;
  /** Periodo (s) con el que se calculó. */
  Period: number;
}

// ───────────────────────── análisis ─────────────────────────

type Node = { t: 'num'; v: number } | { t: 'id'; name: string } | { t: 'str'; v: string } | { t: 'un'; e: Node } | { t: 'bin'; op: string; l: Node; r: Node } | { t: 'fn'; name: string; args: Node[] } | { t: 'list'; items: Node[] };

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|("[^"]*"|'[^']*')|(>=|<=|==|!=|&&|\|\||[-+*/(),><\[\]!]))/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) {
      if (/^\s*$/.test(src.slice(i))) break;
      throw new AwsError('ValidationError', `Error in expression: unexpected character near "${src.slice(i, i + 6).trim()}"`, 400);
    }
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
    i = re.lastIndex;
  }
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const fail = (what: string): never => {
    throw new AwsError('ValidationError', `Error in expression '${src}': ${what}`, 400);
  };
  const expect = (t: string) => {
    if (next() !== t) fail(`expected "${t}"`);
  };
  function cmp(): Node {
    let l = or();
    while (['>', '<', '>=', '<=', '==', '!='].includes(peek())) {
      const op = next();
      l = { t: 'bin', op, l, r: or() };
    }
    return l;
  }
  function or(): Node {
    let l = add();
    while (peek() === '||') {
      next();
      l = { t: 'bin', op: '||', l, r: add() };
    }
    return l;
  }
  function add(): Node {
    let l = mul();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      l = { t: 'bin', op, l, r: mul() };
    }
    return l;
  }
  function mul(): Node {
    let l = unary();
    while (peek() === '*' || peek() === '/' || peek() === '&&') {
      const op = next();
      l = { t: 'bin', op, l, r: unary() };
    }
    return l;
  }
  function unary(): Node {
    if (peek() === '-') {
      next();
      return { t: 'un', e: unary() };
    }
    return primary();
  }
  function primary(): Node {
    const tk = next();
    if (tk === undefined) return fail('unexpected end');
    if (/^\d/.test(tk)) return { t: 'num', v: Number(tk) };
    if (tk[0] === '"' || tk[0] === "'") return { t: 'str', v: tk.slice(1, -1) };
    if (tk === '(') {
      const e = cmp();
      expect(')');
      return e;
    }
    if (tk === '[') {
      const items: Node[] = [];
      if (peek() !== ']') {
        items.push(cmp());
        while (peek() === ',') {
          next();
          items.push(cmp());
        }
      }
      expect(']');
      return { t: 'list', items };
    }
    if (/^[A-Za-z_]/.test(tk)) {
      if (peek() === '(') {
        next();
        const args: Node[] = [];
        if (peek() !== ')') {
          args.push(cmp());
          while (peek() === ',') {
            next();
            args.push(cmp());
          }
        }
        expect(')');
        return { t: 'fn', name: tk.toUpperCase(), args };
      }
      return { t: 'id', name: tk };
    }
    return fail(`unexpected "${tk}"`);
  }
  const e = cmp();
  if (i < toks.length) fail(`unexpected "${toks[i]}"`);
  return e;
}

// ───────────────────────── evaluación ─────────────────────────

const bucketsFrom = (start: number, end: number, period: number, anchor: number): number[] => {
  const out: number[] = [];
  for (let t = anchor + Math.floor((start - anchor) / period) * period; t < end; t += period) out.push(t);
  return out;
};

const lift1 = (v: Val, f: (x: number) => number): Val => {
  if (v.k === 's') return { k: 's', v: f(v.v) };
  if (v.k === 't') return { k: 't', s: { ts: v.s.ts, vs: v.s.vs.map(f) } };
  return { k: 'm', list: v.list.map((s) => ({ ts: s.ts, vs: s.vs.map(f) })) };
};

function lift2(l: Val, r: Val, f: (x: number, y: number) => number | null): Val {
  if (l.k === 'm' || r.k === 'm') throw new AwsError('ValidationError', 'Arithmetic is not supported on a list of time series; aggregate it first (SUM, AVG…).', 400);
  if (l.k === 's' && r.k === 's') {
    const v = f(l.v, r.v);
    return { k: 's', v: v === null ? NaN : v };
  }
  if (l.k === 's' && r.k === 't') return lift2({ k: 't', s: { ts: r.s.ts, vs: r.s.ts.map(() => (l as { v: number }).v) } }, r, f);
  if (l.k === 't' && r.k === 's') return lift2(l, { k: 't', s: { ts: l.s.ts, vs: l.s.ts.map(() => (r as { v: number }).v) } }, f);
  const ls = (l as { s: Series }).s;
  const rs = (r as { s: Series }).s;
  const idx = new Map(rs.ts.map((t, i) => [t, rs.vs[i]]));
  const out: Series = { ts: [], vs: [] };
  ls.ts.forEach((t, i) => {
    if (!idx.has(t)) return;
    const v = f(ls.vs[i], idx.get(t)!);
    if (v !== null && Number.isFinite(v)) {
      out.ts.push(t);
      out.vs.push(v);
    }
  });
  return { k: 't', s: out };
}

const asSeriesList = (v: Val): Series[] | null => (v.k === 'm' ? v.list : v.k === 't' ? [v.s] : null);

function reduceAcross(list: Series[], f: (xs: number[]) => number): Series {
  const all = new Set<number>();
  for (const s of list) for (const t of s.ts) all.add(t);
  const ts = [...all].sort((x, y) => x - y);
  const vs = ts.map((t) => f(list.flatMap((s) => (s.ts.indexOf(t) >= 0 ? [s.vs[s.ts.indexOf(t)]] : []))));
  return { ts, vs };
}

const STAT_FNS: Record<string, (xs: number[]) => number> = {
  SUM: (xs) => xs.reduce((n, x) => n + x, 0),
  AVG: (xs) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length),
  MIN: (xs) => Math.min(...xs),
  MAX: (xs) => Math.max(...xs),
  STDDEV: (xs) => {
    const m = xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
    return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / Math.max(1, xs.length));
  },
};

export interface MathCtx {
  a: Account;
  region: string;
  start: number;
  end: number;
  /** Los buckets se alinean respecto a este instante (0 = múltiplos del periodo; en las alarmas, el final del minuto actual). */
  anchor: number;
  /** Periodo (s) por defecto de las expresiones. */
  period: number;
}

/** Evalúa todas las consultas; devuelve una serie por `Id`. */
export function evalQueries(ctx: MathCtx, queries: MQuery[]): Map<string, MResult> {
  const byId = new Map(queries.map((q) => [q.Id, q]));
  if (byId.size !== queries.length) throw new AwsError('ValidationError', 'Duplicate query Id in MetricDataQueries.', 400);
  const memo = new Map<string, MResult>();
  const busy = new Set<string>();

  function metricStat(q: MQuery): MResult {
    const ms = q.MetricStat!;
    const P = ms.Period * 1000;
    const dims = Object.fromEntries((ms.Metric.Dimensions ?? []).map((d) => [d.Name, d.Value]));
    const pts = metricSeries(ctx.a, ctx.region, { ns: ms.Metric.Namespace, metric: ms.Metric.MetricName, dims }) ?? [];
    const s: Series = { ts: [], vs: [] };
    for (const t of bucketsFrom(ctx.start, ctx.end, P, ctx.anchor)) {
      const v = aggregate(pts, ms.Stat, t, t + P);
      if (v !== undefined) {
        s.ts.push(t);
        s.vs.push(Math.round(v * 1e6) / 1e6);
      }
    }
    return { Id: q.Id, Label: q.Label ?? ms.Metric.MetricName, Series: s, Period: ms.Period };
  }

  function grid(period: number): number[] {
    return bucketsFrom(ctx.start, ctx.end, period * 1000, ctx.anchor);
  }

  function evalNode(n: Node, period: { p: number }): Val {
    switch (n.t) {
      case 'num':
        return { k: 's', v: n.v };
      case 'str':
        throw new AwsError('ValidationError', `Unexpected string "${n.v}" in expression.`, 400);
      case 'id': {
        const r = result(n.name);
        period.p = r.Period;
        return { k: 't', s: r.Series };
      }
      case 'un':
        return lift1(evalNode(n.e, period), (x) => -x);
      case 'list':
        return { k: 'm', list: n.items.flatMap((it) => asSeriesList(evalNode(it, period)) ?? []) };
      case 'bin': {
        const l = evalNode(n.l, period);
        const r = evalNode(n.r, period);
        const ops: Record<string, (x: number, y: number) => number | null> = {
          '+': (x, y) => x + y,
          '-': (x, y) => x - y,
          '*': (x, y) => x * y,
          '/': (x, y) => (y === 0 ? null : x / y),
          '>': (x, y) => (x > y ? 1 : 0),
          '<': (x, y) => (x < y ? 1 : 0),
          '>=': (x, y) => (x >= y ? 1 : 0),
          '<=': (x, y) => (x <= y ? 1 : 0),
          '==': (x, y) => (x === y ? 1 : 0),
          '!=': (x, y) => (x !== y ? 1 : 0),
          '&&': (x, y) => (x && y ? 1 : 0),
          '||': (x, y) => (x || y ? 1 : 0),
        };
        return lift2(l, r, ops[n.op]);
      }
      case 'fn':
        return call(n, period);
    }
  }

  function call(n: Extract<Node, { t: 'fn' }>, period: { p: number }): Val {
    const arg = (i: number) => evalNode(n.args[i] ?? { t: 'num', v: 0 }, period);
    const need = (min: number, max = min) => {
      if (n.args.length < min || n.args.length > max) throw new AwsError('ValidationError', `Error in expression: wrong number of arguments for ${n.name}.`, 400);
    };
    switch (n.name) {
      case 'ABS':
        need(1);
        return lift1(arg(0), Math.abs);
      case 'CEIL':
        need(1);
        return lift1(arg(0), Math.ceil);
      case 'FLOOR':
        need(1);
        return lift1(arg(0), Math.floor);
      case 'LOG':
        need(1);
        return lift1(arg(0), Math.log);
      case 'LOG10':
        need(1);
        return lift1(arg(0), Math.log10);
      case 'SUM':
      case 'AVG':
      case 'MIN':
      case 'MAX':
      case 'STDDEV': {
        need(1);
        const v = arg(0);
        const f = STAT_FNS[n.name];
        if (v.k === 's') return v;
        if (v.k === 'm') return { k: 't', s: reduceAcross(v.list, f) };
        return { k: 's', v: v.s.vs.length ? f(v.s.vs) : NaN };
      }
      case 'METRICS': {
        const filter = n.args[0]?.t === 'str' ? (n.args[0] as { v: string }).v : undefined;
        const list = queries.filter((q) => q.MetricStat && (!filter || q.Id.startsWith(filter.replace(/^Id\s*=\s*/, '').replace(/\*$/, '')))).map((q) => result(q.Id).Series);
        return { k: 'm', list };
      }
      case 'RATE':
      case 'DIFF': {
        need(1);
        const v = arg(0);
        const s = v.k === 't' ? v.s : null;
        if (!s) throw new AwsError('ValidationError', `${n.name} needs a time series.`, 400);
        const out: Series = { ts: [], vs: [] };
        for (let i = 1; i < s.ts.length; i++) {
          out.ts.push(s.ts[i]);
          out.vs.push(n.name === 'RATE' ? (s.vs[i] - s.vs[i - 1]) / ((s.ts[i] - s.ts[i - 1]) / 1000) : s.vs[i] - s.vs[i - 1]);
        }
        return { k: 't', s: out };
      }
      case 'RUNNING_SUM': {
        need(1);
        const v = arg(0);
        if (v.k !== 't') throw new AwsError('ValidationError', 'RUNNING_SUM needs a time series.', 400);
        let acc = 0;
        return { k: 't', s: { ts: v.s.ts, vs: v.s.vs.map((x) => (acc += x)) } };
      }
      case 'PERIOD': {
        need(1);
        arg(0);
        return { k: 's', v: period.p };
      }
      case 'TIME_SERIES': {
        need(1);
        const v = arg(0);
        if (v.k !== 's') throw new AwsError('ValidationError', 'TIME_SERIES needs a number.', 400);
        const g = grid(period.p);
        return { k: 't', s: { ts: g, vs: g.map(() => v.v) } };
      }
      case 'FILL': {
        need(2);
        const v = arg(0);
        if (v.k !== 't') throw new AwsError('ValidationError', 'FILL needs a time series.', 400);
        const mode = n.args[1].t === 'id' ? n.args[1].name.toUpperCase() : undefined;
        const fill = mode ? undefined : arg(1);
        const idx = new Map(v.s.ts.map((t, i) => [t, v.s.vs[i]]));
        const g = grid(period.p);
        const out: Series = { ts: [], vs: [] };
        let last: number | undefined;
        for (const t of g) {
          if (idx.has(t)) {
            last = idx.get(t)!;
            out.ts.push(t);
            out.vs.push(last);
          } else if (mode === 'REPEAT') {
            if (last !== undefined) {
              out.ts.push(t);
              out.vs.push(last);
            }
          } else if (fill && fill.k === 's') {
            out.ts.push(t);
            out.vs.push(fill.v);
          }
        }
        return { k: 't', s: out };
      }
      case 'IF': {
        need(3);
        const c = arg(0);
        const x = arg(1);
        const y = arg(2);
        if (c.k === 's') return c.v ? x : y;
        if (c.k !== 't') throw new AwsError('ValidationError', 'IF needs a condition.', 400);
        const pick = (v: Val, t: number, i: number): number | undefined => (v.k === 's' ? v.v : v.k === 't' ? v.s.vs[v.s.ts.indexOf(t)] : undefined) ?? (i < 0 ? undefined : undefined);
        const out: Series = { ts: [], vs: [] };
        c.s.ts.forEach((t, i) => {
          const v = pick(c.s.vs[i] ? x : y, t, i);
          if (v !== undefined) {
            out.ts.push(t);
            out.vs.push(v);
          }
        });
        return { k: 't', s: out };
      }
      case 'REMOVE_EMPTY': {
        need(1);
        const v = arg(0);
        return v.k === 'm' ? { k: 'm', list: v.list.filter((s) => s.ts.length) } : v;
      }
      default:
        throw new AwsError('ValidationError', `Error in expression: the function ${n.name} is not supported by this simulator.`, 400);
    }
  }

  function result(id: string): MResult {
    const hit = memo.get(id);
    if (hit) return hit;
    const q = byId.get(id);
    if (!q) throw new AwsError('ValidationError', `Error in expression: the identifier "${id}" does not match any query Id.`, 400);
    if (busy.has(id)) throw new AwsError('ValidationError', `Error in expression '${q.Expression}': circular reference to "${id}".`, 400);
    busy.add(id);
    let r: MResult;
    if (q.MetricStat) r = metricStat(q);
    else if (q.Expression) {
      const period = { p: q.Period ?? ctx.period };
      const v = evalNode(parse(q.Expression), period);
      let s: Series;
      if (v.k === 's') {
        const g = grid(period.p);
        s = { ts: g, vs: g.map(() => v.v) };
      } else if (v.k === 't') s = v.s;
      else s = v.list[0] ?? { ts: [], vs: [] };
      r = { Id: id, Label: q.Label ?? q.Expression, Series: s, Period: period.p };
    } else throw new AwsError('ValidationError', `The query ${id} must have either MetricStat or Expression.`, 400);
    busy.delete(id);
    memo.set(id, r);
    return r;
  }

  for (const q of queries) result(q.Id);
  return memo;
}
