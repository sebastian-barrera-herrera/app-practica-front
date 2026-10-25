/** Compilador de expresiones: de árbol sintáctico a funciones que se evalúan sobre una fila. */
import type { Expr, OrderItem, WindowSpec } from './ast';
import { closestWord } from './parser';
import { SCALARS, dateArith } from './funcs';
import { exprKey, printExpr } from './print';
import type { AggSpec, CE, Ctx, Env, Ev, FrameB, Scope, ScopeCol, WinSpec } from './rt';
import { nameError, runtimeError, SqlError, syntaxError, typeError, type SqlType, type Value } from './types';
import {
  and3, arith, castValue, compareValues, formatNumber, likeToRegExp, or3, toBool3, truthy, typeLabel, unifyTypes,
} from './values';

export const AGG_NAMES = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat', 'string_agg', 'bool_and', 'bool_or', 'every', 'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp', 'median',
]);

export const WIN_ONLY = new Set(['row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);

const isAgg = (name: string) => AGG_NAMES.has(name);

// ───────────────────────── resolución de columnas ─────────────────────────

interface Found {
  depth: number;
  idx: number;
  col: ScopeCol;
}

function allTables(scope: Scope | undefined): string[] {
  const out = new Set<string>();
  for (let s = scope; s; s = s.parent) for (const c of s.cols) if (c.table) out.add(c.table);
  return [...out];
}

function allColumns(scope: Scope | undefined): string[] {
  const out: string[] = [];
  for (let s = scope; s; s = s.parent) for (const c of s.cols) if (!c.hidden && !out.includes(c.name)) out.push(c.name);
  return out;
}

export function resolveColumn(scope: Scope, e: Extract<Expr, { k: 'col' }>, aliases?: string[]): Found {
  const lname = e.name.toLowerCase();
  const ltable = e.table?.toLowerCase();
  let depth = 0;
  for (let s: Scope | undefined = scope; s; s = s.parent, depth++) {
    const hits: Found[] = [];
    s.cols.forEach((c, idx) => {
      if (c.name.toLowerCase() !== lname) return;
      if (ltable ? c.table?.toLowerCase() === ltable : !c.hidden) hits.push({ depth, idx, col: c });
    });
    if (hits.length > 1) {
      const tabs = [...new Set(hits.map((h) => h.col.table ?? '?'))];
      throw nameError(`La columna «${e.name}» es ambigua`, `Existe en ${tabs.join(' y ')}. Indica de cuál hablas: ${tabs[0]}.${e.name}`, e.pos);
    }
    if (hits.length === 1) {
      // la consulta interior usa algo del bloque exterior: queda correlacionada
      let mark: Scope | undefined = scope;
      for (let i = 0; i < depth && mark; i++, mark = mark.parent) mark.usedOuter = true;
      return hits[0];
    }
  }
  // no se encontró
  if (e.table) {
    const tables = allTables(scope);
    const exists = tables.some((t) => t.toLowerCase() === ltable);
    if (!exists) {
      const near = closestWord(e.table, tables, 2);
      throw nameError(`No hay ninguna tabla o alias «${e.table}» en esta consulta`, near ? `¿Quisiste decir «${near}»?` : tables.length ? `Tablas disponibles aquí: ${tables.join(', ')}` : undefined, e.pos);
    }
    const cols: string[] = [];
    for (let s: Scope | undefined = scope; s; s = s.parent) for (const c of s.cols) if (c.table?.toLowerCase() === ltable) cols.push(c.name);
    const near = closestWord(e.name, cols, 2);
    throw nameError(`La tabla «${e.table}» no tiene ninguna columna «${e.name}»`, near ? `¿Quisiste decir «${near}»?` : `Columnas de ${e.table}: ${cols.join(', ')}`, e.pos);
  }
  const cols = allColumns(scope);
  const near = closestWord(e.name, cols, 2);
  let hint: string | undefined;
  if (e.quoted) hint = `Las comillas dobles ("…") se usan para nombres de columnas y tablas. Si «${e.name}» es un texto, escríbelo con comillas simples: '${e.name}'`;
  else if (aliases?.some((a) => a.toLowerCase() === lname)) hint = `«${e.name}» es un alias del SELECT: aquí todavía no existe (el WHERE se evalúa antes que el SELECT). Repite la expresión, o usa una subconsulta`;
  else if (near) hint = `¿Quisiste decir «${near}»?`;
  else if (cols.length) hint = `Columnas disponibles: ${cols.slice(0, 12).join(', ')}${cols.length > 12 ? '…' : ''}`;
  throw nameError(`No existe la columna «${e.name}»`, hint, e.pos);
}

// ───────────────────────── utilidades ─────────────────────────

const toText = (v: Value): string => (typeof v === 'string' ? v : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 'int' : 'real') : '');

export function evalConst(ce: CE, what = 'valor'): Value {
  try {
    return ce.ev({ row: [] });
  } catch (err) {
    if (err instanceof SqlError) throw err;
    throw runtimeError(`El ${what} debe ser una constante`);
  }
}

const dateLike = (t: SqlType) => t === 'date' || t === 'timestamp';

function arithType(op: string, ta: SqlType, tb: SqlType): SqlType {
  if (ta === 'null' || tb === 'null') return ta === 'null' ? (tb === 'null' ? 'null' : tb) : ta;
  if (op === '/' && ta === 'int' && tb === 'int') return 'int';
  if (ta === 'int' && tb === 'int') return 'int';
  if (ta === 'real' || tb === 'real') return 'real';
  return 'any';
}

function aggNotAllowed(ctx: Ctx, name: string): SqlError {
  const where: Record<string, string> = { where: 'el WHERE', group: 'el GROUP BY', on: 'el ON de un JOIN', values: 'VALUES', other: 'este lugar' };
  const w = where[ctx.clause] ?? 'este lugar';
  return syntaxError(`No se puede usar ${name.toUpperCase()}() en ${w}`, undefined, ctx.clause === 'where' ? 'El WHERE filtra filas ANTES de agrupar. Para filtrar por un resultado agregado usa HAVING, o una subconsulta.' : 'Las funciones de agregación solo van en SELECT, HAVING y ORDER BY.');
}

// ───────────────────────── compilador ─────────────────────────

export function compileExpr(e: Expr, ctx: Ctx): CE {
  // en un SELECT agrupado, una expresión idéntica a la del GROUP BY se lee del grupo
  if (ctx.mode === 'group' && !ctx.inAgg && ctx.group && e.k !== 'lit') {
    const gi = ctx.group.keys.indexOf(exprKey(e));
    if (gi >= 0) {
      const gtype = ctx.group.exprs[gi].type;
      return { ev: (env) => env.keys![gi], type: gtype };
    }
  }
  switch (e.k) {
    case 'lit':
      return { ev: () => e.v, type: e.t };
    case 'col':
      return compileColumn(e, ctx);
    case 'star':
      throw syntaxError(`El «${e.table ? `${e.table}.*` : '*'}» solo se puede usar en la lista del SELECT o dentro de COUNT(*)`, e.pos);
    case 'un': {
      const a = compileExpr(e.e, ctx);
      if (e.op === 'not') return { ev: (env) => { const v = toBool3(a.ev(env)); return v === null ? null : !v; }, type: 'bool' };
      if (e.op === '+') return a;
      return { ev: (env) => { const v = a.ev(env); return v === null ? null : -(typeof v === 'number' ? v : Number(v)); }, type: a.type };
    }
    case 'bin':
      return compileBinary(e, ctx);
    case 'isnull': {
      const a = compileExpr(e.e, ctx);
      return { ev: (env) => (a.ev(env) === null) !== e.not, type: 'bool' };
    }
    case 'istruth': {
      const a = compileExpr(e.e, ctx);
      return {
        ev: (env) => {
          const v = toBool3(a.ev(env));
          const r = v === e.v;
          return e.not ? !r : r;
        },
        type: 'bool',
      };
    }
    case 'distinct': {
      const l = compileExpr(e.l, ctx);
      const r = compileExpr(e.r, ctx);
      return {
        ev: (env) => {
          const a = l.ev(env);
          const b = r.ev(env);
          const eq = a === null || b === null ? a === b : compareValues(a, b) === 0;
          return e.not ? eq : !eq;
        },
        type: 'bool',
      };
    }
    case 'between': {
      const a = compileExpr(e.e, ctx);
      const lo = compileExpr(e.lo, ctx);
      const hi = compileExpr(e.hi, ctx);
      return {
        ev: (env) => {
          const v = a.ev(env);
          const l = lo.ev(env);
          const h = hi.ev(env);
          const r = and3(v === null || l === null ? null : compareValues(v, l) >= 0, v === null || h === null ? null : compareValues(v, h) <= 0);
          return e.not && r !== null ? !r : r;
        },
        type: 'bool',
      };
    }
    case 'in':
      return compileIn(e, ctx);
    case 'insub': {
      const a = compileExpr(e.e, ctx);
      const cq = ctx.compileQuery(e.q, ctx.scope, ctx.ctes, ctx.rt);
      if (cq.cols.length !== 1) throw syntaxError('La subconsulta de IN debe devolver una sola columna', e.pos, `Ahora devuelve ${cq.cols.length}. Deja una sola columna en su SELECT`);
      let cache: Row1[] | undefined;
      const get = (env: Env) => (cq.correlated ? cq.run(env) : (cache ??= cq.run(env)));
      return {
        ev: (env) => {
          const v = a.ev(env);
          const rows = get(env);
          if (rows.length === 0) return e.not;
          if (v === null) return null;
          let sawNull = false;
          for (const r of rows) {
            const x = r[0];
            if (x === null) sawNull = true;
            else if (compareValues(v, x) === 0) return !e.not;
          }
          return sawNull ? null : e.not;
        },
        type: 'bool',
      };
    }
    case 'like': {
      const a = compileExpr(e.e, ctx);
      const p = compileExpr(e.pat, ctx);
      const esc = e.esc ? compileExpr(e.esc, ctx) : undefined;
      return {
        ev: (env) => {
          const v = a.ev(env);
          const pat = p.ev(env);
          if (v === null || pat === null) return null;
          const ec = esc?.ev(env);
          const re = likeToRegExp(toText(pat), ec == null ? undefined : toText(ec), e.ci);
          const r = re.test(toText(v));
          return e.not ? !r : r;
        },
        type: 'bool',
      };
    }
    case 'exists': {
      const cq = ctx.compileQuery(e.q, ctx.scope, ctx.ctes, ctx.rt);
      let cache: boolean | undefined;
      return {
        ev: (env) => {
          if (!cq.correlated && cache !== undefined) return cache !== e.not;
          const has = cq.run(env).length > 0;
          if (!cq.correlated) cache = has;
          return has !== e.not;
        },
        type: 'bool',
      };
    }
    case 'subq': {
      const cq = ctx.compileQuery(e.q, ctx.scope, ctx.ctes, ctx.rt);
      if (cq.cols.length !== 1) throw syntaxError('Una subconsulta usada como valor debe devolver una sola columna', e.pos, `Ahora devuelve ${cq.cols.length}. Deja una sola columna en su SELECT`);
      let cache: { v: Value } | undefined;
      return {
        ev: (env) => {
          if (!cq.correlated && cache) return cache.v;
          const rows = cq.run(env);
          if (rows.length > 1) throw runtimeError('Una subconsulta usada como valor devolvió más de una fila', 'Usa LIMIT 1, una función de agregación (MAX, MIN…) o IN si esperas varias filas');
          const v = rows.length ? rows[0][0] : null;
          if (!cq.correlated) cache = { v };
          return v;
        },
        type: cq.cols[0].type,
      };
    }
    case 'quant': {
      const a = compileExpr(e.e, ctx);
      const cq = ctx.compileQuery(e.q, ctx.scope, ctx.ctes, ctx.rt);
      if (cq.cols.length !== 1) throw syntaxError(`La subconsulta de ${e.kind.toUpperCase()} debe devolver una sola columna`, e.pos);
      return {
        ev: (env) => {
          const v = a.ev(env);
          const rows = cq.run(env);
          let acc: boolean | null = e.kind === 'all';
          for (const r of rows) {
            const x = r[0];
            const c = v === null || x === null ? null : cmp(e.op, v, x);
            acc = e.kind === 'any' ? or3(acc, c) : and3(acc, c);
          }
          return acc;
        },
        type: 'bool',
      };
    }
    case 'case': {
      const operand = e.operand ? compileExpr(e.operand, ctx) : undefined;
      const whens = e.whens.map(([c, r]) => [compileExpr(c, ctx), compileExpr(r, ctx)] as const);
      const els = e.else ? compileExpr(e.else, ctx) : undefined;
      let type: SqlType = els ? els.type : 'null';
      for (const [, r] of whens) type = unifyTypes(type, r.type);
      return {
        ev: (env) => {
          const base = operand ? operand.ev(env) : undefined;
          for (const [c, r] of whens) {
            const cv = c.ev(env);
            const hit = operand ? base !== null && cv !== null && compareValues(base as Value, cv) === 0 : truthy(cv);
            if (hit) return r.ev(env);
          }
          return els ? els.ev(env) : null;
        },
        type,
      };
    }
    case 'cast': {
      const a = compileExpr(e.e, ctx);
      return { ev: (env) => castValue(a.ev(env), e.type), type: e.type.base };
    }
    case 'extract': {
      const a = compileExpr(e.e, ctx);
      const f = SCALARS.date_part;
      return { ev: (env) => { const v = a.ev(env); return v === null ? null : f.impl([e.field, v], { now: ctx.rt.now, rand: ctx.rt.rand }, ['text', a.type]); }, type: 'int' };
    }
    case 'rowv':
      throw syntaxError('Un grupo de valores (a, b) solo se puede usar con IN o con una comparación', e.pos);
    case 'fn':
      return compileFn(e, ctx);
  }
}

type Row1 = Value[];

function compileColumn(e: Extract<Expr, { k: 'col' }>, ctx: Ctx): CE {
  const f = resolveColumn(ctx.scope, e, ctx.aliases);
  const { depth, idx, col } = f;
  if (depth === 0 && ctx.mode === 'group' && !ctx.inAgg && ctx.group) {
    const tbl = col.tbl;
    const pk = tbl?.primary;
    const covered = !!pk && !!tbl && pk.cols.every((pc) => ctx.group!.cols.some((g) => g.tbl === tbl && g.ci === pc));
    if (!covered) {
      throw syntaxError(
        `La columna «${e.table ? `${e.table}.` : ''}${e.name}» debe aparecer en la cláusula GROUP BY o usarse dentro de una función de agregación`,
        e.pos,
        `Añade ${e.name} al GROUP BY, o resúmela con una función como MAX(${e.name}), MIN(${e.name}), COUNT(${e.name})…`,
      );
    }
  }
  if (depth === 0) {
    const alt = col.alt;
    return alt === undefined ? { ev: (env) => env.row[idx], type: col.type } : { ev: (env) => env.row[idx] ?? env.row[alt], type: col.type };
  }
  return {
    ev: (env) => {
      let x: Env = env;
      for (let i = 0; i < depth; i++) x = x.parent!;
      return x.row[idx];
    },
    type: col.type,
  };
}

function cmp(op: string, a: Value, b: Value): boolean {
  const c = compareValues(a, b);
  switch (op) {
    case '=': return c === 0;
    case '<>': return c !== 0;
    case '<': return c < 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    default: return c >= 0;
  }
}

const CMP_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

function compileBinary(e: Extract<Expr, { k: 'bin' }>, ctx: Ctx): CE {
  if (e.op === 'and' || e.op === 'or') {
    const l = compileExpr(e.l, ctx);
    const r = compileExpr(e.r, ctx);
    if (e.op === 'and') {
      return {
        ev: (env) => {
          const a = toBool3(l.ev(env));
          if (a === false) return false;
          return and3(a, toBool3(r.ev(env)));
        },
        type: 'bool',
      };
    }
    return {
      ev: (env) => {
        const a = toBool3(l.ev(env));
        if (a === true) return true;
        return or3(a, toBool3(r.ev(env)));
      },
      type: 'bool',
    };
  }
  if (CMP_OPS.has(e.op) || e.op === '<=>') {
    if (e.l.k === 'rowv' || e.r.k === 'rowv') return compileRowCompare(e, ctx);
    const l = compileExpr(e.l, ctx);
    const r = compileExpr(e.r, ctx);
    if (e.op === '<=>') return { ev: (env) => { const a = l.ev(env); const b = r.ev(env); return a === null || b === null ? a === b : compareValues(a, b) === 0; }, type: 'bool' };
    const op = e.op;
    return {
      ev: (env) => {
        const a = l.ev(env);
        const b = r.ev(env);
        return a === null || b === null ? null : cmp(op, a, b);
      },
      type: 'bool',
    };
  }
  const l = compileExpr(e.l, ctx);
  const r = compileExpr(e.r, ctx);
  if (e.op === '||') {
    return { ev: (env) => { const a = l.ev(env); const b = r.ev(env); return a === null || b === null ? null : toText(a) + toText(b); }, type: 'text' };
  }
  if (e.op === '~' || e.op === '~*' || e.op === '!~') {
    const ci = e.op === '~*';
    const neg = e.op === '!~';
    return {
      ev: (env) => {
        const a = l.ev(env);
        const p = r.ev(env);
        if (a === null || p === null) return null;
        try {
          const m = new RegExp(toText(p), ci ? 'i' : '').test(toText(a));
          return neg ? !m : m;
        } catch {
          throw runtimeError(`Expresión regular no válida: «${toText(p)}»`);
        }
      },
      type: 'bool',
    };
  }
  // aritmética (y fechas)
  const op = e.op;
  const dates = (dateLike(l.type) || dateLike(r.type) || (e.l.k === 'fn' && e.l.name === '__interval') || (e.r.k === 'fn' && e.r.name === '__interval')) && (op === '+' || op === '-');
  if (dates) {
    return {
      ev: (env) => {
        const a = l.ev(env);
        const b = r.ev(env);
        if (a === null || b === null) return null;
        const d = dateArith(op as '+' | '-', a, b, l.type, r.type);
        if (!d) throw typeError(`No se pueden ${op === '+' ? 'sumar' : 'restar'} un valor de tipo ${typeLabel(l.type)} y otro de tipo ${typeLabel(r.type)}`, 'Con fechas puedes sumar o restar días (fecha + 7) o intervalos (fecha - INTERVAL \'1 month\')');
        return d.v;
      },
      type: dateLike(l.type) && dateLike(r.type) ? 'int' : dateLike(l.type) ? l.type : r.type,
    };
  }
  const type = arithType(op, l.type, r.type);
  const lt = l.type;
  const rt = r.type;
  return {
    ev: (env) => {
      const a = l.ev(env);
      const b = r.ev(env);
      return arith(op, a, b, lt, rt);
    },
    type,
  };
}

function compileRowCompare(e: Extract<Expr, { k: 'bin' }>, ctx: Ctx): CE {
  if (e.l.k !== 'rowv' || e.r.k !== 'rowv' || e.l.items.length !== e.r.items.length) throw syntaxError('Los dos lados de la comparación deben ser grupos de valores con el mismo número de elementos', e.pos);
  const ls = e.l.items.map((x) => compileExpr(x, ctx));
  const rs = e.r.items.map((x) => compileExpr(x, ctx));
  const op = e.op;
  return {
    ev: (env) => {
      let allEq: boolean | null = true;
      for (let i = 0; i < ls.length; i++) {
        const a = ls[i].ev(env);
        const b = rs[i].ev(env);
        if (op === '=' || op === '<>') {
          allEq = and3(allEq, a === null || b === null ? null : compareValues(a, b) === 0);
        } else {
          if (a === null || b === null) return null;
          const c = compareValues(a, b);
          if (c !== 0) return cmp(op, a, b);
        }
      }
      if (op === '=') return allEq;
      if (op === '<>') return allEq === null ? null : !allEq;
      return op === '<=' || op === '>=';
    },
    type: 'bool',
  };
}

function compileIn(e: Extract<Expr, { k: 'in' }>, ctx: Ctx): CE {
  if (e.e.k === 'rowv') {
    const lefts = e.e.items.map((x) => compileExpr(x, ctx));
    const rows = e.list.map((x) => {
      if (x.k !== 'rowv' || x.items.length !== lefts.length) throw syntaxError('Cada elemento de la lista debe ser un grupo de valores con el mismo número de elementos', e.pos);
      return x.items.map((y) => compileExpr(y, ctx));
    });
    return {
      ev: (env) => {
        const lv = lefts.map((l) => l.ev(env));
        let result: boolean | null = false;
        for (const r of rows) {
          let eq: boolean | null = true;
          r.forEach((c, i) => {
            const b = c.ev(env);
            eq = and3(eq, lv[i] === null || b === null ? null : compareValues(lv[i] as Value, b) === 0);
          });
          result = or3(result, eq);
          if (result === true) break;
        }
        return result === null ? null : result !== e.not;
      },
      type: 'bool',
    };
  }
  const a = compileExpr(e.e, ctx);
  const list = e.list.map((x) => compileExpr(x, ctx));
  return {
    ev: (env) => {
      const v = a.ev(env);
      if (list.length === 0) return e.not;
      if (v === null) return null;
      let sawNull = false;
      for (const c of list) {
        const x = c.ev(env);
        if (x === null) sawNull = true;
        else if (compareValues(v, x) === 0) return !e.not;
      }
      return sawNull ? null : e.not;
    },
    type: 'bool',
  };
}

// ───────────────────────── funciones ─────────────────────────

function compileFn(e: Extract<Expr, { k: 'fn' }>, ctx: Ctx): CE {
  const name = e.name;
  if (name === '__default') throw syntaxError('DEFAULT solo se puede usar en INSERT y UPDATE', e.pos);
  if (name === 'grouping') {
    const arg = e.args[0];
    if (!ctx.group || !arg) throw syntaxError('GROUPING() solo se puede usar en un SELECT con GROUP BY ROLLUP/CUBE/GROUPING SETS', e.pos);
    const gi = ctx.group.keys.indexOf(exprKey(arg));
    if (gi < 0) throw syntaxError('El argumento de GROUPING() debe ser una expresión del GROUP BY', e.pos);
    return { ev: (env) => (env.gset && !env.gset.has(gi) ? 1 : 0), type: 'int' };
  }
  if (e.over !== undefined) return compileWindow(e, ctx);
  if (WIN_ONLY.has(name)) throw syntaxError(`${name.toUpperCase()}() es una función de ventana: necesita la cláusula OVER (…)`, e.pos, `Por ejemplo: ${name.toUpperCase()}() OVER (ORDER BY columna)`);
  if (isAgg(name)) return compileAgg(e, ctx);

  const def = SCALARS[name];
  if (!def) {
    const near = closestWord(name, [...Object.keys(SCALARS).filter((n) => !n.startsWith('__')), ...AGG_NAMES, ...WIN_ONLY], 2);
    throw nameError(`No existe la función «${name}»`, near ? `¿Quisiste decir ${near.toUpperCase()}()?` : undefined, e.pos);
  }
  if (e.star || e.distinct) throw syntaxError(`${name.toUpperCase()}() no admite ${e.star ? '*' : 'DISTINCT'}`, e.pos);
  if (e.args.length < def.min || (def.max !== undefined && e.args.length > def.max)) {
    const range = def.max === undefined ? `al menos ${def.min}` : def.min === def.max ? `${def.min}` : `entre ${def.min} y ${def.max}`;
    throw syntaxError(`${name.toUpperCase()}() necesita ${range} argumento${def.min === 1 && def.max === 1 ? '' : 's'} y recibió ${e.args.length}`, e.pos);
  }
  // RAISE(ABORT, 'mensaje'): ABORT/FAIL/IGNORE son palabras, no columnas
  const rawArgs = name === 'raise' && e.args[0]?.k === 'col' ? [{ k: 'lit' as const, v: e.args[0].name, t: 'text' as const, pos: e.pos }, ...e.args.slice(1)] : e.args;
  const args = rawArgs.map((a) => compileExpr(a, ctx));
  const types = args.map((a) => a.type);
  const type = typeof def.ret === 'function' ? def.ret(types) : def.ret;
  const fc = { now: ctx.rt.now, rand: ctx.rt.rand };
  const strict = def.strict;
  const impl = def.impl;
  return {
    ev: (env) => {
      const vals = args.map((a) => a.ev(env));
      if (strict && vals.some((v) => v === null)) return null;
      return impl(vals, fc, types);
    },
    type,
  };
}

function aggType(name: string, argType: SqlType | undefined): SqlType {
  switch (name) {
    case 'count': return 'int';
    case 'sum': return argType === 'int' ? 'int' : argType === 'real' ? 'real' : 'any';
    case 'avg': case 'total': case 'stddev': case 'stddev_pop': case 'stddev_samp': case 'variance': case 'var_pop': case 'var_samp': case 'median': return 'real';
    case 'min': case 'max': return argType ?? 'any';
    case 'group_concat': case 'string_agg': return 'text';
    default: return 'bool';
  }
}

function compileAgg(e: Extract<Expr, { k: 'fn' }>, ctx: Ctx): CE {
  if (!ctx.aggs || ctx.mode !== 'group' || ctx.clause === 'where' || ctx.clause === 'group' || ctx.clause === 'on') throw aggNotAllowed(ctx, e.name);
  if (ctx.inAgg) throw syntaxError(`No se puede usar una función de agregación dentro de otra (${e.name.toUpperCase()})`, e.pos, 'Calcula primero el agregado interior en una subconsulta');
  const key = exprKey(e);
  let slot = ctx.aggs.keys.indexOf(key);
  if (slot < 0) {
    const inner: Ctx = { ...ctx, mode: 'row', inAgg: true, group: undefined, aggs: undefined, wins: undefined };
    const name = e.name;
    if (e.star && name !== 'count') throw syntaxError(`${name.toUpperCase()}(*) no existe: solo COUNT(*) admite el *`, e.pos);
    if (!e.star && e.args.length === 0) throw syntaxError(`${name.toUpperCase()}() necesita un argumento`, e.pos, name === 'count' ? 'Usa COUNT(*) para contar filas' : undefined);
    const expected = name === 'group_concat' || name === 'string_agg' ? [1, 2] : [1, 1];
    if (!e.star && (e.args.length < expected[0] || e.args.length > expected[1])) throw syntaxError(`${name.toUpperCase()}() recibió ${e.args.length} argumentos y espera ${expected[0] === expected[1] ? expected[0] : `${expected[0]} o ${expected[1]}`}`, e.pos);
    const args = e.args.map((a) => compileExpr(a, inner));
    const spec: AggSpec = {
      name,
      args,
      distinct: e.distinct,
      star: e.star,
      filter: e.filter ? compileExpr(e.filter, inner) : undefined,
      order: e.order?.map((o) => ({ ce: compileExpr(o.e, inner), desc: o.desc, nullsFirst: o.nullsFirst })),
      type: aggType(name, args[0]?.type),
    };
    slot = ctx.aggs.list.push(spec) - 1;
    ctx.aggs.keys.push(key);
  }
  const spec = ctx.aggs.list[slot];
  const s = slot;
  return { ev: (env) => env.aggs![s], type: spec.type };
}

function orderSpecs(items: OrderItem[], ctx: Ctx) {
  return items.map((o) => ({ ce: compileExpr(o.e, ctx), desc: o.desc, nullsFirst: o.nullsFirst }));
}

function frameBound(b: NonNullable<WindowSpec['frame']>['start'], ctx: Ctx): FrameB {
  if (!b.n) return { kind: b.kind };
  const v = evalConst(compileExpr(b.n, ctx), 'valor del marco de la ventana');
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw runtimeError('El desplazamiento de un marco de ventana debe ser un número no negativo');
  return { kind: b.kind, n };
}

function compileWindow(e: Extract<Expr, { k: 'fn' }>, ctx: Ctx): CE {
  if (!ctx.wins || ctx.clause === 'where' || ctx.clause === 'group' || ctx.clause === 'having' || ctx.clause === 'on') {
    throw syntaxError(`No se puede usar la función de ventana ${e.name.toUpperCase()}() aquí`, e.pos, 'Las funciones de ventana solo van en la lista del SELECT y en el ORDER BY. Para filtrar por su resultado, usa una subconsulta.');
  }
  if (ctx.inWin) throw syntaxError('No se puede anidar una función de ventana dentro de otra', e.pos);
  const key = exprKey(e);
  let slot = ctx.wins.keys.indexOf(key);
  if (slot < 0) {
    let spec: WindowSpec | undefined;
    if (typeof e.over === 'string') {
      spec = ctx.namedWindows?.[e.over];
      if (!spec) throw nameError(`No existe la ventana «${e.over}»`, 'Defínela con WINDOW nombre AS (…) después del HAVING', e.pos);
    } else spec = e.over;
    if (spec?.base) {
      const base = ctx.namedWindows?.[spec.base];
      if (!base) throw nameError(`No existe la ventana «${spec.base}»`, undefined, e.pos);
      spec = { partition: spec.partition.length ? spec.partition : base.partition, order: spec.order.length ? spec.order : base.order, frame: spec.frame ?? base.frame };
    }
    const inner: Ctx = { ...ctx, inWin: true };
    const isAggFn = isAgg(e.name);
    if (!isAggFn && !WIN_ONLY.has(e.name)) throw syntaxError(`${e.name.toUpperCase()}() no se puede usar con OVER`, e.pos, 'Con OVER solo funcionan los agregados (SUM, AVG, COUNT, MIN, MAX) y las funciones de ventana (ROW_NUMBER, RANK, LAG…)');
    const args = e.args.map((a) => compileExpr(a, inner));
    const w: WinSpec = {
      name: e.name,
      args,
      star: e.star,
      distinct: e.distinct,
      partition: (spec?.partition ?? []).map((p) => compileExpr(p, inner)),
      order: orderSpecs(spec?.order ?? [], inner),
      frame: spec?.frame ? { mode: spec.frame.mode, start: frameBound(spec.frame.start, inner), end: frameBound(spec.frame.end, inner) } : undefined,
      type: winType(e.name, args),
    };
    slot = ctx.wins.list.push(w) - 1;
    ctx.wins.keys.push(key);
  }
  const s = slot;
  return { ev: (env) => env.wins![s], type: ctx.wins.list[slot].type };
}

function winType(name: string, args: CE[]): SqlType {
  switch (name) {
    case 'row_number': case 'rank': case 'dense_rank': case 'ntile': return 'int';
    case 'percent_rank': case 'cume_dist': return 'real';
    case 'lag': case 'lead': case 'first_value': case 'last_value': case 'nth_value': return args[0]?.type ?? 'any';
    default: return aggType(name, args[0]?.type);
  }
}

export { printExpr };
export type { Ev };
