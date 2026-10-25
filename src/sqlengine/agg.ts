/** Funciones de agregación y de ventana. */
import type { AggSpec, Env, WinSpec } from './rt';
import { runtimeError, type Value } from './types';
import { compareValues, keyOf, numberOf, sortCompare, truthy } from './values';

const text = (v: Value): string => (typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

/** Calcula un agregado sobre una lista de valores ya filtrada y ordenada (los NULL se descartan aquí). */
export function aggregateValues(name: string, raw: Value[], o: { distinct?: boolean; star?: boolean; rowCount: number; sep?: Value }): Value {
  if (name === 'count' && o.star) return o.rowCount;
  let vals = raw.filter((v) => v !== null);
  if (o.distinct) {
    const seen = new Set<string>();
    vals = vals.filter((v) => {
      const k = keyOf(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  switch (name) {
    case 'count':
      return vals.length;
    case 'sum': {
      if (!vals.length) return null;
      return vals.reduce<number>((a, v) => a + numberOf(v, 'SUM'), 0);
    }
    case 'total':
      return vals.reduce<number>((a, v) => a + numberOf(v, 'TOTAL'), 0);
    case 'avg': {
      if (!vals.length) return null;
      return vals.reduce<number>((a, v) => a + numberOf(v, 'AVG'), 0) / vals.length;
    }
    case 'min':
      return vals.length ? vals.reduce((m, v) => (compareValues(v, m) < 0 ? v : m)) : null;
    case 'max':
      return vals.length ? vals.reduce((m, v) => (compareValues(v, m) > 0 ? v : m)) : null;
    case 'group_concat':
    case 'string_agg':
      return vals.length ? vals.map(text).join(o.sep === undefined || o.sep === null ? ',' : text(o.sep)) : null;
    case 'bool_and':
    case 'every':
      return vals.length ? vals.every(truthy) : null;
    case 'bool_or':
      return vals.length ? vals.some(truthy) : null;
    case 'median': {
      if (!vals.length) return null;
      const s = vals.map((v) => numberOf(v, 'MEDIAN')).sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case 'stddev':
    case 'stddev_samp':
    case 'stddev_pop':
    case 'variance':
    case 'var_samp':
    case 'var_pop': {
      const n = vals.length;
      const pop = name.endsWith('_pop');
      if (n === 0 || (!pop && n < 2)) return null;
      const xs = vals.map((v) => numberOf(v, name.toUpperCase()));
      const mean = xs.reduce((a, b) => a + b, 0) / n;
      const ss = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
      const variance = ss / (pop ? n : n - 1);
      return name.startsWith('stddev') ? Math.sqrt(variance) : variance;
    }
  }
  throw runtimeError(`Función de agregación desconocida: ${name}`);
}

/** Orden de filas por varias claves (para ORDER BY y para el ORDER BY dentro de los agregados). */
export function compareKeys(a: Value[], b: Value[], dirs: { desc: boolean; nullsFirst?: boolean }[]): number {
  for (let i = 0; i < dirs.length; i++) {
    const x = a[i];
    const y = b[i];
    const d = dirs[i];
    let c: number;
    if (x === null || y === null) {
      if (x === null && y === null) c = 0;
      else {
        // por defecto los NULL cuentan como lo más grande: van al final con ASC y al principio con DESC
        const nullsFirst = d.nullsFirst ?? d.desc;
        c = x === null ? (nullsFirst ? -1 : 1) : nullsFirst ? 1 : -1;
        if (c !== 0) return c;
      }
    } else c = d.desc ? sortCompare(y, x) : sortCompare(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

export function runAgg(spec: AggSpec, envs: Env[]): Value {
  let rows = spec.filter ? envs.filter((e) => truthy(spec.filter!.ev(e))) : envs;
  if (spec.order?.length) {
    const keyed = rows.map((e) => ({ e, k: spec.order!.map((o) => o.ce.ev(e)) }));
    keyed.sort((a, b) => compareKeys(a.k, b.k, spec.order!));
    rows = keyed.map((x) => x.e);
  }
  if (spec.star) return rows.length;
  const first = spec.args[0];
  const vals = rows.map((e) => first.ev(e));
  const sep = spec.args[1] && rows.length ? spec.args[1].ev(rows[0]) : undefined;
  return aggregateValues(spec.name, vals, { distinct: spec.distinct, star: spec.star, rowCount: rows.length, sep });
}

// ───────────────────────── ventanas ─────────────────────────

/** Calcula todas las funciones de ventana sobre las filas y deja el resultado en `env.wins`. */
export function computeWindows(specs: WinSpec[], envs: Env[]): void {
  if (!specs.length) return;
  for (const e of envs) e.wins = new Array<Value>(specs.length).fill(null);
  specs.forEach((spec, slot) => {
    // 1. particiones
    const parts = new Map<string, Env[]>();
    for (const e of envs) {
      const k = spec.partition.length ? spec.partition.map((p) => keyOf(p.ev(e))).join('\u0001') : '';
      const list = parts.get(k);
      if (list) list.push(e);
      else parts.set(k, [e]);
    }
    for (const part of parts.values()) windowPartition(spec, slot, part);
  });
}

function windowPartition(spec: WinSpec, slot: number, part: Env[]): void {
  const n = part.length;
  // 2. orden dentro de la partición (estable)
  const keyed = part.map((env, i) => ({ env, i, k: spec.order.map((o) => o.ce.ev(env)) }));
  if (spec.order.length) keyed.sort((a, b) => compareKeys(a.k, b.k, spec.order) || a.i - b.i);
  const envs = keyed.map((x) => x.env);
  const keys = keyed.map((x) => x.k);
  const dirs = spec.order;
  const samePeer = (i: number, j: number) => compareKeys(keys[i], keys[j], dirs) === 0;

  // inicio y fin del grupo de pares de cada fila
  const peerStart: number[] = new Array(n);
  const peerEnd: number[] = new Array(n);
  for (let i = 0; i < n; i++) peerStart[i] = i > 0 && spec.order.length && samePeer(i, i - 1) ? peerStart[i - 1] : i;
  for (let i = n - 1; i >= 0; i--) peerEnd[i] = i < n - 1 && spec.order.length && samePeer(i, i + 1) ? peerEnd[i + 1] : i;
  if (!spec.order.length) {
    // sin ORDER BY todas las filas son «pares»
    for (let i = 0; i < n; i++) {
      peerStart[i] = 0;
      peerEnd[i] = n - 1;
    }
  }
  const set = (i: number, v: Value) => {
    envs[i].wins![slot] = v;
  };
  const arg = (i: number, k = 0): Value => spec.args[k].ev(envs[i]);

  switch (spec.name) {
    case 'row_number':
      for (let i = 0; i < n; i++) set(i, i + 1);
      return;
    case 'rank':
      for (let i = 0; i < n; i++) set(i, peerStart[i] + 1);
      return;
    case 'dense_rank': {
      let d = 0;
      for (let i = 0; i < n; i++) {
        if (peerStart[i] === i) d++;
        set(i, d);
      }
      return;
    }
    case 'percent_rank':
      for (let i = 0; i < n; i++) set(i, n === 1 ? 0 : peerStart[i] / (n - 1));
      return;
    case 'cume_dist':
      for (let i = 0; i < n; i++) set(i, (peerEnd[i] + 1) / n);
      return;
    case 'ntile': {
      const k = Number(arg(0, 0));
      if (!Number.isInteger(k) || k <= 0) throw runtimeError('NTILE necesita un número entero positivo de grupos');
      const base = Math.floor(n / k);
      const extra = n % k;
      let row = 0;
      for (let b = 0; b < k && row < n; b++) {
        const size = base + (b < extra ? 1 : 0);
        for (let j = 0; j < size; j++) set(row++, b + 1);
      }
      return;
    }
    case 'lag':
    case 'lead': {
      const off = spec.args[1] ? Number(arg(0, 1)) : 1;
      const dflt = spec.args[2];
      for (let i = 0; i < n; i++) {
        const j = spec.name === 'lag' ? i - off : i + off;
        set(i, j >= 0 && j < n ? arg(j) : dflt ? dflt.ev(envs[i]) : null);
      }
      return;
    }
  }

  // funciones que usan el marco: first/last/nth_value y los agregados
  const frameOf = (i: number): [number, number] => {
    const f = spec.frame;
    if (!f) return spec.order.length ? [0, peerEnd[i]] : [0, n - 1];
    const bound = (b: typeof f.start, isStart: boolean): number => {
      switch (b.kind) {
        case 'unbounded_preceding': return 0;
        case 'unbounded_following': return n - 1;
        case 'current':
          return f.mode === 'rows' ? i : isStart ? peerStart[i] : peerEnd[i];
        case 'preceding':
        case 'following': {
          const k = b.n ?? 0;
          const sign = b.kind === 'preceding' ? -1 : 1;
          if (f.mode === 'rows') return i + sign * k;
          if (f.mode === 'groups') {
            // desplazamiento en grupos de pares
            let g = i;
            for (let s = 0; s < k; s++) g = sign < 0 ? Math.max(0, peerStart[g] - 1) : Math.min(n - 1, peerEnd[g] + 1);
            return isStart ? peerStart[g] : peerEnd[g];
          }
          // RANGE con desplazamiento: sobre el valor de la única clave de ordenación
          const cur = keys[i][0];
          if (typeof cur !== 'number') return isStart ? peerStart[i] : peerEnd[i];
          const target = cur + sign * k * (dirs[0].desc ? -1 : 1);
          if (isStart) {
            let j = 0;
            while (j < n && (dirs[0].desc ? (keys[j][0] as number) > target : (keys[j][0] as number) < target)) j++;
            return j;
          }
          let j = n - 1;
          while (j >= 0 && (dirs[0].desc ? (keys[j][0] as number) < target : (keys[j][0] as number) > target)) j--;
          return j;
        }
      }
    };
    return [bound(f.start, true), bound(f.end, false)];
  };

  for (let i = 0; i < n; i++) {
    let [lo, hi] = frameOf(i);
    lo = Math.max(0, lo);
    hi = Math.min(n - 1, hi);
    const empty = hi < lo;
    switch (spec.name) {
      case 'first_value':
        set(i, empty ? null : arg(lo));
        break;
      case 'last_value':
        set(i, empty ? null : arg(hi));
        break;
      case 'nth_value': {
        const k = Number(arg(i, 1));
        set(i, !empty && lo + k - 1 <= hi && k >= 1 ? arg(lo + k - 1) : null);
        break;
      }
      default: {
        const vals: Value[] = [];
        if (!empty) for (let j = lo; j <= hi; j++) vals.push(spec.star ? 1 : arg(j));
        const sep = spec.args[1] && !empty ? arg(i, 1) : undefined;
        set(i, aggregateValues(spec.name, vals, { distinct: spec.distinct, star: spec.star, rowCount: vals.length, sep }));
      }
    }
  }
}
