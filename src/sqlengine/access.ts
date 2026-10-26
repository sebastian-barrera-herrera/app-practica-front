/**
 * Acceso a una tabla: decide si hace falta recorrerla entera o si un índice (clave primaria, UNIQUE o CREATE INDEX)
 * permite ir directo a las filas del WHERE. Es lo que se ve con EXPLAIN y en «filas leídas».
 */
import type { Expr } from './ast';
import type { Row, Table } from './catalog';
import { normalizeDate } from './dates';
import { printExpr } from './print';
import type { CE, Env, Runtime } from './rt';
import type { Value } from './types';
import { compareValues, looksNumeric, rowKey } from './values';

export interface Access {
  rows: (env?: Env) => Row[];
  /** Línea del plan (EXPLAIN). */
  plan: string;
  /** Nombre del índice usado. */
  index?: string;
}

function andList(e: Expr | undefined, out: Expr[] = []): Expr[] {
  if (!e) return out;
  if (e.k === 'bin' && e.op === 'and') {
    andList(e.l, out);
    andList(e.r, out);
  } else out.push(e);
  return out;
}

/** Todas las referencias a columnas de una expresión (sin entrar en subconsultas). Devuelve null si contiene subconsultas. */
export function columnRefs(e: Expr, out: Extract<Expr, { k: 'col' }>[] = []): Extract<Expr, { k: 'col' }>[] | null {
  let ok = true;
  const walk = (x: Expr) => {
    switch (x.k) {
      case 'col': out.push(x); break;
      case 'un': walk(x.e); break;
      case 'bin': walk(x.l); walk(x.r); break;
      case 'isnull': case 'istruth': case 'cast': case 'extract': walk(x.e); break;
      case 'distinct': walk(x.l); walk(x.r); break;
      case 'between': walk(x.e); walk(x.lo); walk(x.hi); break;
      case 'in': walk(x.e); x.list.forEach(walk); break;
      case 'like': walk(x.e); walk(x.pat); if (x.esc) walk(x.esc); break;
      case 'case': if (x.operand) walk(x.operand); x.whens.forEach(([c, r]) => { walk(c); walk(r); }); if (x.else) walk(x.else); break;
      case 'fn': x.args.forEach(walk); if (x.filter) walk(x.filter); if (x.over) ok = false; break;
      case 'rowv': x.items.forEach(walk); break;
      case 'insub': case 'exists': case 'subq': case 'quant': ok = false; break;
      default: break;
    }
  };
  walk(e);
  return ok ? out : null;
}

type Range = { lo?: { v: CE; incl: boolean; text: string }; hi?: { v: CE; incl: boolean; text: string } };

export function planAccess(
  tbl: Table,
  alias: string,
  where: Expr | undefined,
  compileValue: (e: Expr) => CE | null,
  rt: Runtime,
): Access {
  const name = tbl.name;
  const full: Access = {
    rows: () => {
      rt.stats.rowsRead += tbl.rows.length;
      return tbl.rows;
    },
    plan: `Escaneo completo de «${name}»${alias.toLowerCase() !== name.toLowerCase() ? ` (alias ${alias})` : ''} (${tbl.rows.length} fila${tbl.rows.length === 1 ? '' : 's'})`,
  };
  if (!where || tbl.rows.length === 0) return full;

  const lalias = alias.toLowerCase();
  const lname = name.toLowerCase();
  const colOf = (e: Expr): number | null => {
    if (e.k !== 'col') return null;
    if (e.table && e.table.toLowerCase() !== lalias && e.table.toLowerCase() !== lname) return null;
    const i = tbl.colIndex(e.name);
    return i >= 0 ? i : null;
  };
  /** Un valor que no depende de esta tabla (constante o columna de la consulta exterior). */
  const valueOf = (e: Expr): CE | null => {
    const refs = columnRefs(e);
    if (!refs) return null;
    for (const r of refs) {
      if (r.table ? r.table.toLowerCase() === lalias || r.table.toLowerCase() === lname : tbl.colIndex(r.name) >= 0) return null;
    }
    return compileValue(e);
  };

  const eq = new Map<number, { v: CE; text: string }>();
  const inl = new Map<number, { vs: CE[]; text: string }>();
  const ranges = new Map<number, Range>();
  const addRange = (c: number, side: 'lo' | 'hi', v: CE, incl: boolean, text: string) => {
    const r = ranges.get(c) ?? {};
    r[side] = { v, incl, text };
    ranges.set(c, r);
  };

  for (const c of andList(where)) {
    if (c.k === 'bin' && ['=', '<', '<=', '>', '>='].includes(c.op)) {
      let ci = colOf(c.l);
      let ve: Expr = c.r;
      let op = c.op;
      if (ci === null) {
        ci = colOf(c.r);
        ve = c.l;
        op = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' }[c.op]!;
      }
      if (ci === null) continue;
      const v = valueOf(ve);
      if (!v) continue;
      const text = `${tbl.cols[ci].name} ${op} ${printExpr(ve)}`;
      if (op === '=') eq.set(ci, { v, text });
      else if (op === '>' || op === '>=') addRange(ci, 'lo', v, op === '>=', text);
      else addRange(ci, 'hi', v, op === '<=', text);
    } else if (c.k === 'in' && !c.not) {
      const ci = colOf(c.e);
      if (ci === null) continue;
      const vs = c.list.map(valueOf);
      if (vs.some((v) => !v)) continue;
      inl.set(ci, { vs: vs as CE[], text: `${tbl.cols[ci].name} IN (${c.list.map(printExpr).join(', ')})` });
    } else if (c.k === 'between' && !c.not) {
      const ci = colOf(c.e);
      if (ci === null) continue;
      const lo = valueOf(c.lo);
      const hi = valueOf(c.hi);
      if (!lo || !hi) continue;
      addRange(ci, 'lo', lo, true, `${tbl.cols[ci].name} >= ${printExpr(c.lo)}`);
      addRange(ci, 'hi', hi, true, `${tbl.cols[ci].name} <= ${printExpr(c.hi)}`);
    }
  }
  if (!eq.size && !inl.size && !ranges.size) return full;

  /** Convierte el valor de la consulta al tipo de la columna para buscar en el índice (null = no se puede, escaneo completo). */
  const coerce = (ci: number, v: Value): { ok: boolean; v: Value } => {
    if (v === null) return { ok: true, v: null };
    const t = tbl.cols[ci].type.base;
    if (t === 'int' || t === 'real') {
      if (typeof v === 'number') return { ok: true, v };
      if (typeof v === 'string' && looksNumeric(v)) return { ok: true, v: Number(v) };
      return { ok: false, v };
    }
    if (t === 'text') return typeof v === 'string' ? { ok: true, v } : { ok: false, v };
    if (t === 'date') {
      const d = typeof v === 'string' ? normalizeDate(v) : null;
      return d ? { ok: true, v: d } : { ok: false, v };
    }
    if (t === 'bool') return typeof v === 'boolean' ? { ok: true, v } : { ok: false, v };
    return { ok: false, v };
  };

  // índices candidatos (listas de columnas)
  const defs: { name: string; cols: number[] }[] = [];
  const pk = tbl.primary;
  if (pk) defs.push({ name: `${name}_pkey`, cols: pk.cols });
  for (const u of tbl.uniques) if (!u.primary) defs.push({ name: u.name ?? `${name}_${u.cols.map((c) => tbl.cols[c].name).join('_')}_key`, cols: u.cols });
  for (const ix of tbl.indexes) if (!ix.where && ix.exprs.length === 0) defs.push({ name: ix.name, cols: ix.cols });

  // 1. igualdad sobre el comienzo de un índice
  let best: { def: { name: string; cols: number[] }; len: number } | null = null;
  for (const d of defs) {
    let len = 0;
    while (len < d.cols.length && (eq.has(d.cols[len]) || (len === 0 && inl.has(d.cols[0])))) len++;
    if (len > 0 && (!best || len > best.len)) best = { def: d, len };
  }
  if (best) {
    const { def, len } = best;
    const prefix = def.cols.slice(0, len);
    const usedEq = prefix.map((c) => eq.get(c)).filter(Boolean) as { v: CE; text: string }[];
    const inFirst = !eq.has(prefix[0]) ? inl.get(prefix[0]) : undefined;
    // tras las igualdades, un rango sobre la siguiente columna del índice también se resuelve dentro del índice
    const nextCol = !inFirst && len < def.cols.length ? def.cols[len] : undefined;
    const nextRange = nextCol !== undefined ? ranges.get(nextCol) : undefined;
    const rangeText = nextRange ? [nextRange.lo?.text, nextRange.hi?.text].filter(Boolean).join(' AND ') : '';
    const text = [inFirst ? inFirst.text : usedEq.map((x) => x.text).join(' AND '), rangeText].filter(Boolean).join(' AND ');
    return {
      index: def.name,
      plan: `Búsqueda en el índice «${def.name}» de «${name}» (${text})`,
      rows: (env) => {
        // las expresiones de búsqueda solo ven la fila exterior (subconsultas correlacionadas): un nivel por encima
        const e: Env = { row: [], parent: env };
        const sets: Value[][] = [];
        if (inFirst) {
          for (const ce of inFirst.vs) {
            const c = coerce(prefix[0], ce.ev(e));
            if (!c.ok) return scanAll(tbl, rt);
            if (c.v !== null) sets.push([c.v]);
          }
        } else {
          const vals: Value[] = [];
          for (let i = 0; i < prefix.length; i++) {
            const c = coerce(prefix[i], eq.get(prefix[i])!.v.ev(e));
            if (!c.ok) return scanAll(tbl, rt);
            if (c.v === null) return []; // x = NULL nunca es verdadero
            vals.push(c.v);
          }
          sets.push(vals);
        }
        const map = tbl.hash(prefix);
        const out: Row[] = [];
        const seen = new Set<string>();
        for (const vals of sets) {
          const k = rowKey(vals);
          if (seen.has(k)) continue;
          seen.add(k);
          const hit = map.get(k);
          if (hit) out.push(...hit);
        }
        // las filas deben salir en el orden de la tabla
        let res = out;
        if (nextRange && nextCol !== undefined) {
          const lo = nextRange.lo ? coerce(nextCol, nextRange.lo.v.ev(e)) : undefined;
          const hi = nextRange.hi ? coerce(nextCol, nextRange.hi.v.ev(e)) : undefined;
          if ((!lo || lo.ok) && (!hi || hi.ok)) {
            res = out.filter((r) => {
              const v = r[nextCol];
              if (v === null) return false;
              if (lo) {
                if (lo.v === null) return false;
                const c = compareValues(v, lo.v);
                if (c < 0 || (c === 0 && !nextRange.lo!.incl)) return false;
              }
              if (hi) {
                if (hi.v === null) return false;
                const c = compareValues(v, hi.v);
                if (c > 0 || (c === 0 && !nextRange.hi!.incl)) return false;
              }
              return true;
            });
          }
        }
        if (res.length > 1) inTableOrder(tbl, res);
        rt.stats.rowsRead += res.length;
        if (!rt.stats.indexes.includes(def.name)) rt.stats.indexes.push(def.name);
        return res;
      },
    };
  }

  // 2. rangos sobre la primera columna de un índice
  for (const d of defs) {
    const c0 = d.cols[0];
    const r = ranges.get(c0);
    if (!r) continue;
    const text = [r.lo?.text, r.hi?.text].filter(Boolean).join(' AND ');
    return {
      index: d.name,
      plan: `Búsqueda por rango en el índice «${d.name}» de «${name}» (${text})`,
      rows: (env) => {
        // las expresiones de búsqueda solo ven la fila exterior (subconsultas correlacionadas): un nivel por encima
        const e: Env = { row: [], parent: env };
        let lo: { v: Value; incl: boolean } | undefined;
        let hi: { v: Value; incl: boolean } | undefined;
        if (r.lo) {
          const c = coerce(c0, r.lo.v.ev(e));
          if (!c.ok) return scanAll(tbl, rt);
          if (c.v === null) return [];
          lo = { v: c.v, incl: r.lo.incl };
        }
        if (r.hi) {
          const c = coerce(c0, r.hi.v.ev(e));
          if (!c.ok) return scanAll(tbl, rt);
          if (c.v === null) return [];
          hi = { v: c.v, incl: r.hi.incl };
        }
        const list = tbl.sorted(c0, compareValues);
        // búsqueda binaria del primer elemento admitido por `lo` y del último por `hi`
        let a = 0;
        let b = list.length;
        if (lo) {
          let l = 0;
          let h = list.length;
          while (l < h) {
            const m = (l + h) >> 1;
            const c = compareValues(list[m].key, lo.v);
            if (c < 0 || (c === 0 && !lo.incl)) l = m + 1;
            else h = m;
          }
          a = l;
        }
        if (hi) {
          let l = a;
          let h = list.length;
          while (l < h) {
            const m = (l + h) >> 1;
            const c = compareValues(list[m].key, hi.v);
            if (c < 0 || (c === 0 && hi.incl)) l = m + 1;
            else h = m;
          }
          b = l;
        }
        const out = list.slice(a, b).map((x) => x.row);
        if (out.length > 1) inTableOrder(tbl, out);
        rt.stats.rowsRead += out.length;
        if (!rt.stats.indexes.includes(d.name)) rt.stats.indexes.push(d.name);
        return out;
      },
    };
  }
  return full;
}

function inTableOrder(tbl: Table, rows: Row[]): void {
  const pos = new Map<Row, number>();
  tbl.rows.forEach((r, i) => pos.set(r, i));
  rows.sort((a, b) => pos.get(a)! - pos.get(b)!);
}

function scanAll(tbl: Table, rt: Runtime): Row[] {
  rt.stats.rowsRead += tbl.rows.length;
  return tbl.rows;
}
