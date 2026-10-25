/** Consultas: FROM, JOIN, WHERE, GROUP BY, HAVING, ventanas, DISTINCT, ORDER BY, LIMIT, operaciones de conjuntos y CTE. */
import type { Cte, Expr, FromItem, OrderItem, Query, QueryBody, Select } from './ast';
import { planAccess, columnRefs } from './access';
import { computeWindows, compareKeys, runAgg } from './agg';
import type { Row } from './catalog';
import { AGG_NAMES, compileExpr, evalConst, resolveColumn } from './expr';
import { closestWord } from './parser';
import { addInterval, normalizeDate, normalizeTimestamp, parseInterval, toMs } from './dates';
import { columnName, exprKey, printExpr } from './print';
import type { AggRegistry, CE, CompiledQuery, CteDef, CteScope, Ctx, Env, Runtime, Scope, ScopeCol, WinRegistry } from './rt';
import { LIMITS, nameError, runtimeError, syntaxError, type SqlType, type Value } from './types';
import { rowKey, truthy, unifyTypes } from './values';

const note = (rt: Runtime, text: string, extra = 0) => {
  rt.plan?.push(`${'   '.repeat(rt.depth + extra)}${text}`);
};

function makeCtx(rt: Runtime, scope: Scope, ctes: CteScope | undefined, clause: Ctx['clause'], extra: Partial<Ctx> = {}): Ctx {
  return { rt, scope, ctes, mode: 'row', clause, compileQuery, ...extra };
}

function tick(rt: Runtime, n: number): void {
  rt.budget -= n;
  if (rt.budget < 0) throw runtimeError('La consulta procesa demasiadas filas y se ha cortado', 'Quizá falta una condición de unión (ON) y se están combinando todas las filas con todas');
}

// ───────────────────────── recorridos del árbol ─────────────────────────

/** ¿La expresión contiene una función de agregación (fuera de ventanas y de subconsultas)? */
function hasAggregate(e: Expr): boolean {
  switch (e.k) {
    case 'fn':
      if (!e.over && AGG_NAMES.has(e.name)) return true;
      return e.args.some(hasAggregate) || (e.over !== undefined && typeof e.over !== 'string' && (e.over.partition.some(hasAggregate) || e.over.order.some((o) => hasAggregate(o.e))));
    case 'un': case 'isnull': case 'istruth': case 'cast': case 'extract': return hasAggregate(e.e);
    case 'bin': return hasAggregate(e.l) || hasAggregate(e.r);
    case 'distinct': return hasAggregate(e.l) || hasAggregate(e.r);
    case 'between': return hasAggregate(e.e) || hasAggregate(e.lo) || hasAggregate(e.hi);
    case 'in': return hasAggregate(e.e) || e.list.some(hasAggregate);
    case 'insub': case 'quant': return hasAggregate(e.e);
    case 'like': return hasAggregate(e.e) || hasAggregate(e.pat);
    case 'case': return (e.operand ? hasAggregate(e.operand) : false) || e.whens.some(([c, r]) => hasAggregate(c) || hasAggregate(r)) || (e.else ? hasAggregate(e.else) : false);
    case 'rowv': return e.items.some(hasAggregate);
    default: return false;
  }
}

function splitAnd(e: Expr | undefined, out: Expr[] = []): Expr[] {
  if (!e) return out;
  if (e.k === 'bin' && e.op === 'and') {
    splitAnd(e.l, out);
    splitAnd(e.r, out);
  } else out.push(e);
  return out;
}

const mentionsTable = (body: unknown, name: string): boolean => new RegExp(`"k":"table","name":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(JSON.stringify(body));

// ───────────────────────── consulta completa ─────────────────────────

export function compileQuery(q: Query, parentScope: Scope | undefined, ctesIn: CteScope | undefined, rt: Runtime): CompiledQuery {
  let ctes = ctesIn;
  if (q.with) {
    ctes = { defs: new Map(), parent: ctesIn };
    for (const c of q.with.ctes) ctes.defs.set(c.name.toLowerCase(), { def: { name: c.name, q: c.q, cols: c.cols, recursive: q.with.recursive } });
  }
  if (q.body.k === 'select') return compileSelect(q.body, q, parentScope, ctes, rt);
  const body = compileBody(q.body, parentScope, ctes, rt);
  if (!q.order && !q.limit && !q.offset) return { cols: body.cols, run: body.run, correlated: body.correlated };
  // ORDER BY de una operación de conjuntos: solo columnas del resultado
  const order = q.order?.map((o) => {
    let idx = -1;
    if (o.e.k === 'lit' && typeof o.e.v === 'number') idx = o.e.v - 1;
    else if (o.e.k === 'col' && !o.e.table) idx = body.cols.findIndex((c) => c.name.toLowerCase() === (o.e as { name: string }).name.toLowerCase());
    if (idx < 0 || idx >= body.cols.length) throw syntaxError('En una consulta con UNION/INTERSECT/EXCEPT el ORDER BY solo puede usar columnas del resultado (por nombre o por posición)', undefined, `Columnas: ${body.cols.map((c) => c.name).join(', ')}`);
    return { idx, desc: o.desc, nullsFirst: o.nullsFirst };
  });
  const limit = q.limit ? compileExpr(q.limit, makeCtx(rt, { cols: [], parent: parentScope }, ctes, 'other')) : undefined;
  const offset = q.offset ? compileExpr(q.offset, makeCtx(rt, { cols: [], parent: parentScope }, ctes, 'other')) : undefined;
  return {
    cols: body.cols,
    correlated: body.correlated,
    run: (env) => {
      let rows = body.run(env);
      if (order) {
        const keyed = rows.map((r) => ({ r, k: order.map((o) => r[o.idx]) }));
        keyed.sort((a, b) => compareKeys(a.k, b.k, order));
        rows = keyed.map((x) => x.r);
      }
      return slice(rows, limit, offset, env);
    },
  };
}

function slice(rows: Row[], limit: CE | undefined, offset: CE | undefined, env: Env | undefined): Row[] {
  if (!limit && !offset) return rows;
  const e = env ?? { row: [] };
  const off = offset ? num(offset.ev(e), 'OFFSET') : 0;
  const lim = limit ? num(limit.ev(e), 'LIMIT') : Infinity;
  return rows.slice(off, off + lim);
}

function num(v: Value, what: string): number {
  if (v === null) return what === 'LIMIT' ? Infinity : 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw runtimeError(`${what} debe ser un número entero no negativo (recibió ${String(v)})`);
  return n;
}

interface BodyC {
  cols: ScopeCol[];
  run: (env?: Env) => Row[];
  correlated: boolean;
}

function compileBody(body: QueryBody, parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime): BodyC {
  switch (body.k) {
    case 'select':
      return compileSelect(body, {}, parentScope, ctes, rt);
    case 'sub':
      return compileQuery(body.q, parentScope, ctes, rt);
    case 'values':
      return compileValuesBody(body.rows, parentScope, ctes, rt);
    case 'set': {
      const opName = { union: 'UNION', intersect: 'INTERSECT', except: 'EXCEPT' }[body.op];
      note(rt, `${opName}${body.all ? ' ALL' : ''}`);
      rt.depth++;
      const l = compileBody(body.l, parentScope, ctes, rt);
      const r = compileBody(body.r, parentScope, ctes, rt);
      rt.depth--;
      if (l.cols.length !== r.cols.length) {
        throw syntaxError(`Las dos partes de ${opName} deben tener el mismo número de columnas (${l.cols.length} frente a ${r.cols.length})`, undefined, 'Ajusta las listas de columnas de los dos SELECT');
      }
      const cols = l.cols.map((c, i) => ({ name: c.name, type: unifyTypes(c.type, r.cols[i].type) }));
      return {
        cols,
        correlated: l.correlated || r.correlated,
        run: (env) => {
          const a = l.run(env);
          const b = r.run(env);
          tick(rt, a.length + b.length);
          if (body.op === 'union') {
            if (body.all) return [...a, ...b];
            return dedupe([...a, ...b]);
          }
          const counts = new Map<string, number>();
          for (const row of b) counts.set(rowKey(row), (counts.get(rowKey(row)) ?? 0) + 1);
          const out: Row[] = [];
          if (body.op === 'intersect') {
            const seen = new Set<string>();
            for (const row of a) {
              const k = rowKey(row);
              const have = counts.get(k) ?? 0;
              if (have > 0) {
                if (body.all) {
                  out.push(row);
                  counts.set(k, have - 1);
                } else if (!seen.has(k)) {
                  seen.add(k);
                  out.push(row);
                }
              }
            }
            return out;
          }
          // EXCEPT
          const seen = new Set<string>();
          for (const row of a) {
            const k = rowKey(row);
            const have = counts.get(k) ?? 0;
            if (body.all) {
              if (have > 0) counts.set(k, have - 1);
              else out.push(row);
            } else if (have === 0 && !seen.has(k)) {
              seen.add(k);
              out.push(row);
            }
          }
          return out;
        },
      };
    }
  }
}

function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const k = rowKey(r);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function compileValuesBody(rows: Expr[][], parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime): BodyC {
  const scope: Scope = { cols: [], parent: parentScope };
  const ctx = makeCtx(rt, scope, ctes, 'values');
  const n = rows[0]?.length ?? 0;
  const compiled = rows.map((r) => {
    if (r.length !== n) throw syntaxError('Todas las filas de VALUES deben tener el mismo número de valores', undefined, `La primera fila tiene ${n} y otra tiene ${r.length}`);
    return r.map((e) => compileExpr(e, ctx));
  });
  const cols: ScopeCol[] = Array.from({ length: n }, (_, i) => ({ name: `column${i + 1}`, type: compiled.reduce<SqlType>((t, r) => unifyTypes(t, r[i].type), 'null') }));
  note(rt, `Valores (${rows.length} fila${rows.length === 1 ? '' : 's'})`);
  return { cols, correlated: !!scope.usedOuter, run: (env) => compiled.map((r) => r.map((c) => c.ev(env ?? { row: [] }))) };
}

// ───────────────────────── SELECT ─────────────────────────

interface OutItem {
  ce: CE;
  name: string;
  /** Posición de columna de origen si viene de un * (para conservar tabla/tipo). */
  src?: ScopeCol;
}

function compileSelect(s: Select, q: Pick<Query, 'order' | 'limit' | 'offset'>, parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime): BodyC {
  // plan (de arriba abajo)
  const mark = rt.depth;
  const down = (text: string) => {
    note(rt, text);
    rt.depth++;
  };
  if (q.limit) down(`Límite${q.offset ? ' + desplazamiento' : ''}`);
  if (q.order?.length) down(`Ordenar por ${q.order.map((o) => `${printExpr(o.e)}${o.desc ? ' DESC' : ''}`).join(', ')}`);
  if (s.distinct) down('Eliminar duplicados (DISTINCT)');

  // FROM
  const itemsHaveAgg = s.items.some((i) => hasAggregate(i.e)) || (s.having ? hasAggregate(s.having) : false) || !!q.order?.some((o) => hasAggregate(o.e));
  const grouped = s.groupBy !== undefined || itemsHaveAgg;
  if (grouped) down(s.groupBy?.length ? `Agrupar por ${s.groupBy.map(printExpr).join(', ')}${s.groupingSets ? ' (con subtotales)' : ''}` : 'Agregar (un solo grupo)');
  if (s.where) down(`Filtrar: ${printExpr(s.where)}`);
  const fromPlan: FromPlan = s.from
    ? compileFromItem(s.from, parentScope, ctes, rt, s.from.k === 'table' ? s.where : undefined)
    : { cols: [], run: () => [[]], correlated: false };
  rt.depth = mark;

  const scope: Scope = { cols: fromPlan.cols, parent: parentScope };
  const aliases = s.items.map((i) => i.alias).filter(Boolean) as string[];
  const base = (clause: Ctx['clause'], extra: Partial<Ctx> = {}): Ctx => makeCtx(rt, scope, ctes, clause, { aliases, namedWindows: s.windows, ...extra });

  // lista del SELECT con los * expandidos
  const raw: { e: Expr; alias?: string; src?: ScopeCol }[] = [];
  for (const it of s.items) {
    if (it.e.k === 'star') {
      const t = it.e.table?.toLowerCase();
      const cols = fromPlan.cols.filter((c) => !c.hidden && (!t || c.table?.toLowerCase() === t));
      if (t && !fromPlan.cols.some((c) => c.table?.toLowerCase() === t)) {
        const tabs = [...new Set(fromPlan.cols.map((c) => c.table).filter(Boolean))] as string[];
        throw nameError(`No hay ninguna tabla o alias «${it.e.table}» en esta consulta`, tabs.length ? `Tablas disponibles aquí: ${tabs.join(', ')}` : undefined, it.e.pos);
      }
      if (!cols.length) throw syntaxError('SELECT * necesita una cláusula FROM con tablas', it.e.pos, 'Escribe SELECT * FROM nombre_de_tabla');
      for (const c of cols) raw.push({ e: { k: 'col', table: c.table, name: c.name, pos: it.e.pos }, src: c });
    } else raw.push({ e: it.e, alias: it.alias });
  }

  // WHERE
  const whereCE = s.where ? compileExpr(s.where, base('where')) : undefined;

  // GROUP BY: expresiones (por posición o por alias del SELECT)
  let groupCtx: Ctx['group'];
  let groupExprAst: Expr[] = [];
  if (grouped) {
    groupExprAst = (s.groupBy ?? []).map((g) => {
      if (g.k === 'lit' && typeof g.v === 'number' && g.t === 'int') {
        const it = raw[g.v - 1];
        if (!it) throw syntaxError(`GROUP BY ${g.v} no existe: la lista del SELECT tiene ${raw.length} columna${raw.length === 1 ? '' : 's'}`, g.pos);
        return it.e;
      }
      if (g.k === 'col' && !g.table) {
        const al = raw.find((it) => it.alias && it.alias.toLowerCase() === g.name.toLowerCase());
        const inScope = fromPlan.cols.some((c) => !c.hidden && c.name.toLowerCase() === g.name.toLowerCase());
        if (al && !inScope) return al.e;
      }
      return g;
    });
    const gctx = base('group');
    const exprs = groupExprAst.map((g) => compileExpr(g, gctx));
    groupCtx = {
      keys: groupExprAst.map(exprKey),
      exprs,
      cols: groupExprAst.map((g) => {
        if (g.k !== 'col') return {};
        const f = resolveColumn(scope, g);
        return f.depth === 0 ? { tbl: f.col.tbl, ci: f.col.ci } : {};
      }),
    };
  }
  const aggs: AggRegistry = { list: [], keys: [] };
  const wins: WinRegistry = { list: [], keys: [] };
  const mode: Ctx['mode'] = grouped ? 'group' : 'row';
  const withGroup = (clause: Ctx['clause']): Ctx => base(clause, { mode, group: groupCtx, aggs: grouped ? aggs : undefined, wins });

  // SELECT
  const outs: OutItem[] = raw.map((it) => {
    const ctx = withGroup('select');
    const ce = compileExpr(it.e, ctx);
    return { ce, name: it.alias ?? it.src?.name ?? columnName(it.e), src: it.src };
  });

  // HAVING
  let havingCE: CE | undefined;
  if (s.having) {
    if (!grouped) throw syntaxError('HAVING solo se puede usar con GROUP BY o con funciones de agregación', undefined, 'Para filtrar filas sin agrupar usa WHERE');
    havingCE = compileExpr(s.having, withGroup('having'));
  }

  // ORDER BY
  const order = (q.order ?? []).map((o) => compileOrder(o, outs, raw, withGroup('order')));

  // DISTINCT ON
  const distinctOn = Array.isArray(s.distinct) ? s.distinct.map((d) => compileExpr(d, withGroup('select'))) : undefined;

  const cols: ScopeCol[] = outs.map((o) => ({ name: o.name, type: o.ce.type, table: o.src?.table, tbl: undefined }));
  const limit = q.limit ? compileExpr(q.limit, makeCtx(rt, { cols: [], parent: parentScope }, ctes, 'other')) : undefined;
  const offset = q.offset ? compileExpr(q.offset, makeCtx(rt, { cols: [], parent: parentScope }, ctes, 'other')) : undefined;

  const groupSets = s.groupingSets ?? [groupExprAst.map((_, i) => i)];
  const correlated = !!scope.usedOuter || fromPlan.correlated;

  const run = (outer?: Env): Row[] => {
    tick(rt, 1);
    const input = fromPlan.run(outer);
    tick(rt, input.length);
    let envs: Env[] = new Array(input.length);
    for (let i = 0; i < input.length; i++) envs[i] = { row: input[i], parent: outer };
    if (whereCE) envs = envs.filter((e) => truthy(whereCE.ev(e)));

    if (grouped) {
      const out: Env[] = [];
      const nullRow: Row = new Array(fromPlan.cols.length).fill(null);
      for (const set of groupSets) {
        const inSet = new Set(set);
        const groups = new Map<string, Env[]>();
        for (const e of envs) {
          const k = set.length ? rowKey(set.map((i) => groupCtx!.exprs[i].ev(e))) : '';
          const g = groups.get(k);
          if (g) g.push(e);
          else groups.set(k, [e]);
        }
        // sin GROUP BY (o con el conjunto vacío) siempre hay un grupo, aunque no haya filas
        if (groups.size === 0 && set.length === 0) groups.set('', []);
        for (const members of groups.values()) {
          const rep = members[0];
          const genv: Env = {
            row: rep ? rep.row : nullRow,
            parent: outer,
            keys: groupExprAst.map((_, i) => (inSet.has(i) && rep ? groupCtx!.exprs[i].ev(rep) : null)),
            gset: inSet,
          };
          genv.aggs = aggs.list.map((a) => runAgg(a, members));
          out.push(genv);
        }
      }
      envs = out;
      if (havingCE) envs = envs.filter((e) => truthy(havingCE.ev(e)));
    }

    computeWindows(wins.list, envs);

    // proyección + claves de ordenación
    let proj = envs.map((e) => {
      const row = outs.map((o) => o.ce.ev(e));
      const keys = order.map((o) => (o.out !== undefined ? row[o.out] : o.ce!.ev(e)));
      const on = distinctOn ? distinctOn.map((d) => d.ev(e)) : undefined;
      return { row, keys, on };
    });
    if (s.distinct === true) {
      const seen = new Set<string>();
      proj = proj.filter((p) => {
        const k = rowKey(p.row);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    if (order.length) proj.sort((a, b) => compareKeys(a.keys, b.keys, order));
    if (distinctOn) {
      const seen = new Set<string>();
      proj = proj.filter((p) => {
        const k = rowKey(p.on!);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return slice(
      proj.map((p) => p.row),
      limit,
      offset,
      outer,
    );
  };
  return { cols, run, correlated };
}

interface OrderC {
  desc: boolean;
  nullsFirst?: boolean;
  /** Posición de una columna del resultado… */
  out?: number;
  /** …o una expresión sobre las filas de origen. */
  ce?: CE;
}

function compileOrder(o: OrderItem, outs: OutItem[], raw: { e: Expr; alias?: string }[], ctx: Ctx): OrderC {
  const e = o.e;
  if (e.k === 'lit' && typeof e.v === 'number' && e.t === 'int') {
    if (e.v < 1 || e.v > outs.length) throw syntaxError(`ORDER BY ${e.v} no existe: la lista del SELECT tiene ${outs.length} columna${outs.length === 1 ? '' : 's'}`, e.pos);
    return { desc: o.desc, nullsFirst: o.nullsFirst, out: e.v - 1 };
  }
  if (e.k === 'col' && !e.table) {
    const i = outs.findIndex((x, idx) => x.name.toLowerCase() === e.name.toLowerCase() && (raw[idx].alias?.toLowerCase() === e.name.toLowerCase() || raw[idx].e.k === 'col' || true));
    if (i >= 0) {
      // un alias gana al nombre de una columna de origen
      const aliasHit = raw.findIndex((r) => r.alias && r.alias.toLowerCase() === e.name.toLowerCase());
      return { desc: o.desc, nullsFirst: o.nullsFirst, out: aliasHit >= 0 ? aliasHit : i };
    }
  }
  return { desc: o.desc, nullsFirst: o.nullsFirst, ce: compileExpr(e, ctx) };
}

// ───────────────────────── FROM ─────────────────────────

interface FromPlan {
  cols: ScopeCol[];
  run: (env?: Env) => Row[];
  correlated: boolean;
}

function findCte(ctes: CteScope | undefined, name: string) {
  const l = name.toLowerCase();
  for (let c = ctes; c; c = c.parent) {
    const e = c.defs.get(l);
    if (e) return { entry: e, scope: c };
  }
  return undefined;
}

function relationNames(rt: Runtime, ctes: CteScope | undefined): string[] {
  const out = [...[...rt.db.tables.values()].map((t) => t.name), ...[...rt.db.views.values()].map((v) => v.name)];
  for (let c = ctes; c; c = c.parent) for (const e of c.defs.values()) out.push(e.def.name);
  return out;
}

function compileFromItem(item: FromItem, parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime, where?: Expr): FromPlan {
  switch (item.k) {
    case 'table': {
      const alias = item.alias ?? item.name;
      const cte = findCte(ctes, item.name);
      if (cte) return fromCte(cte.entry, cte.scope, alias, item.alias !== undefined, parentScope, rt);
      const tbl = rt.db.table(item.name);
      if (tbl) {
        const cols: ScopeCol[] = tbl.cols.map((c, ci) => ({ name: c.name, table: alias, type: c.type.base, tbl, ci }));
        const valueScope: Scope = { cols: [], parent: parentScope };
        const access = planAccess(
          tbl,
          alias,
          where,
          (e) => {
            try {
              const sc: Scope = { cols: [], parent: parentScope };
              const ce = compileExpr(e, makeCtx(rt, sc, ctes, 'where'));
              void valueScope;
              return ce;
            } catch {
              return null;
            }
          },
          rt,
        );
        note(rt, access.plan);
        return { cols, run: (env) => access.rows(env), correlated: false };
      }
      const view = rt.db.view(item.name);
      if (view) {
        if (rt.nest > 12) throw runtimeError(`La vista «${view.name}» se refiere a sí misma (recursión de vistas)`);
        note(rt, `Vista «${view.name}»`);
        rt.depth++;
        rt.nest++;
        const cq = compileQuery(view.q, undefined, undefined, rt);
        rt.nest--;
        rt.depth--;
        const cols = cq.cols.map((c, i) => ({ ...c, name: view.cols?.[i] ?? c.name, table: alias, tbl: undefined }));
        return { cols, run: (env) => cq.run(env), correlated: false };
      }
      const near = closestWord(item.name, relationNames(rt, ctes), 2);
      const all = [...rt.db.tables.values()].map((t) => t.name);
      throw nameError(`No existe la tabla «${item.name}»`, near ? `¿Quisiste decir «${near}»?` : all.length ? `Tablas disponibles: ${all.join(', ')}` : 'La base de datos aún no tiene tablas: créalas con CREATE TABLE', item.pos);
    }
    case 'sub': {
      note(rt, `Subconsulta «${item.alias}»`);
      rt.depth++;
      const cq = compileQuery(item.q, parentScope, ctes, rt);
      rt.depth--;
      if (item.cols && item.cols.length > cq.cols.length) throw syntaxError(`El alias «${item.alias}» nombra ${item.cols.length} columnas pero la subconsulta devuelve ${cq.cols.length}`);
      const cols = cq.cols.map((c, i) => ({ name: item.cols?.[i] ?? c.name, table: item.alias, type: c.type }));
      return { cols, run: (env) => cq.run(env), correlated: cq.correlated };
    }
    case 'values': {
      const b = compileValuesBody(item.rows, parentScope, ctes, rt);
      const cols = b.cols.map((c, i) => ({ name: item.cols?.[i] ?? c.name, table: item.alias, type: c.type }));
      return { cols, run: b.run, correlated: b.correlated };
    }
    case 'func':
      return compileTableFunction(item, parentScope, ctes, rt);
    case 'join':
      return compileJoin(item, parentScope, ctes, rt);
  }
}

function compileTableFunction(item: Extract<FromItem, { k: 'func' }>, parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime): FromPlan {
  if (item.name !== 'generate_series') {
    const near = closestWord(item.name, ['generate_series'], 3);
    throw nameError(`No existe la función de tabla «${item.name}»`, near ? `¿Quisiste decir ${near}()?` : 'La función de tabla disponible es generate_series(inicio, fin [, paso])', item.pos);
  }
  if (item.args.length < 2 || item.args.length > 3) throw syntaxError('generate_series necesita 2 o 3 argumentos: (inicio, fin [, paso])', item.pos);
  const sc: Scope = { cols: [], parent: parentScope };
  const ctx = makeCtx(rt, sc, ctes, 'other');
  const args = item.args.map((a) => compileExpr(a, ctx));
  const alias = item.alias ?? item.name;
  // con fechas (generate_series('2024-01-01'::date, '2024-01-31'::date, '1 day')) la serie avanza con un intervalo
  const dateLike = args[0].type === 'date' || args[0].type === 'timestamp' || args[0].type === 'text';
  const colType: SqlType = args[0].type === 'real' ? 'real' : args[0].type === 'timestamp' ? 'timestamp' : dateLike ? 'date' : 'int';
  const col: ScopeCol = { name: item.cols?.[0] ?? (item.alias ? item.alias : 'generate_series'), table: alias, type: colType };
  note(rt, `Serie generada (${printExpr(item.args[0])} … ${printExpr(item.args[1])})`);
  return {
    cols: [col],
    correlated: !!sc.usedOuter,
    run: (env) => {
      const e = env ?? { row: [] };
      const [a, b, c] = args.map((x) => x.ev(e));
      if (a === null || b === null) return [];
      if (typeof a === 'string' && typeof b === 'string') {
        const withTime = a.length > 10 || b.length > 10;
        const from = withTime ? normalizeTimestamp(a) : normalizeDate(a);
        const to = withTime ? normalizeTimestamp(b) : normalizeDate(b);
        if (!from || !to) throw runtimeError('generate_series: las fechas no son válidas', "Usa el formato 'AAAA-MM-DD' y un paso como '1 day' o '1 month'");
        const iv = parseInterval(typeof c === 'string' ? c : c === undefined || c === null ? '1 day' : `${Number(c)} day`);
        if (iv.months <= 0 && iv.days <= 0 && iv.seconds <= 0) throw runtimeError('generate_series: el paso debe ser positivo', "Por ejemplo '1 day' o '1 month'");
        const end = toMs(to) as number;
        const out: Row[] = [];
        // cada valor es inicio + k × paso (así 31 ene + 1 mes, + 2 meses… respeta el fin de mes: 29 feb, 31 mar, 30 abr)
        for (let k = 0; ; k++) {
          const cur = addInterval(from, { months: iv.months * k, days: iv.days * k, seconds: iv.seconds * k });
          if ((toMs(cur) as number) > end) break;
          out.push([cur]);
          if (out.length > LIMITS.maxRows) throw runtimeError('generate_series genera demasiadas filas');
        }
        return out;
      }
      const start = Number(a);
      const stop = Number(b);
      const step = c === undefined || c === null ? 1 : Number(c);
      if (step === 0) throw runtimeError('generate_series: el paso no puede ser 0');
      const out: Row[] = [];
      for (let x = start; step > 0 ? x <= stop : x >= stop; x += step) {
        out.push([x]);
        if (out.length > LIMITS.maxRows) throw runtimeError('generate_series genera demasiadas filas');
      }
      return out;
    },
  };
}

function fromCte(entry: { def: CteDef; work?: { cols: ScopeCol[] } }, scope: CteScope, alias: string, aliased: boolean, parentScope: Scope | undefined, rt: Runtime): FromPlan {
  void aliased;
  const { def } = entry;
  if (entry.work) {
    const cols = entry.work.cols.map((c) => ({ ...c, table: alias }));
    return { cols, run: () => rt.cteWork.get(def) ?? [], correlated: false };
  }
  note(rt, `CTE «${def.name}»`);
  rt.depth++;
  const m = prepareCte(def, scope, rt);
  rt.depth--;
  void parentScope;
  const cols = m.cols.map((c) => ({ ...c, table: alias }));
  return { cols, run: () => materialize(def, m, rt), correlated: false };
}

interface CteMat {
  cols: ScopeCol[];
  compute: () => Row[];
}

const cteMats = new WeakMap<CteDef, CteMat>();

function prepareCte(def: CteDef, scope: CteScope, rt: Runtime): CteMat {
  const hit = cteMats.get(def);
  // el resultado en caché solo vale mientras se ejecuta la misma sentencia (rt.cteCache se vacía por sentencia)
  if (hit && rt.cteCache.has(def)) return hit;
  const body = def.q.body;
  // la CTE ve a las CTE anteriores (y a sí misma si es recursiva)
  const visible: CteScope = { defs: new Map(), parent: scope.parent };
  for (const [k, v] of scope.defs) {
    if (v.def === def) break;
    visible.defs.set(k, v);
  }
  let mat: CteMat;
  if (def.recursive && body.k === 'set' && body.op === 'union' && mentionsTable(body.r, def.name)) {
    const anchor = compileBody(body.l, undefined, visible, rt);
    const cols = anchor.cols.map((c, i) => ({ ...c, name: def.cols?.[i] ?? c.name }));
    const workScope: CteScope = { defs: new Map(visible.defs), parent: visible.parent };
    workScope.defs.set(def.name.toLowerCase(), { def, work: { cols } });
    const rec = compileBody(body.r, undefined, workScope, rt);
    if (rec.cols.length !== cols.length) throw syntaxError(`La parte recursiva de «${def.name}» debe tener ${cols.length} columna${cols.length === 1 ? '' : 's'}`);
    mat = {
      cols,
      compute: () => {
        let acc = anchor.run();
        const seen = new Set<string>();
        if (!body.all) {
          acc = dedupe(acc);
          for (const r of acc) seen.add(rowKey(r));
        }
        let work = acc;
        for (let i = 0; work.length; i++) {
          if (i > LIMITS.maxRecursion) throw runtimeError(`La CTE recursiva «${def.name}» no termina (más de ${LIMITS.maxRecursion} iteraciones)`, 'Añade una condición de parada en la parte recursiva (por ejemplo WHERE n < 10)');
          rt.cteWork.set(def, work);
          let next = rec.run();
          if (!body.all) {
            next = next.filter((r) => {
              const k = rowKey(r);
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            });
          }
          if (acc.length + next.length > LIMITS.maxRows) throw runtimeError(`La CTE recursiva «${def.name}» genera demasiadas filas`, 'Falta la condición de parada de la recursión');
          acc = acc.concat(next);
          work = next;
        }
        rt.cteWork.delete(def);
        return acc;
      },
    };
  } else {
    const cq = compileQuery(def.q, undefined, visible, rt);
    const cols = cq.cols.map((c, i) => ({ ...c, name: def.cols?.[i] ?? c.name }));
    mat = { cols, compute: () => cq.run() };
  }
  cteMats.set(def, mat);
  return mat;
}

function materialize(def: CteDef, m: CteMat, rt: Runtime): Row[] {
  const hit = rt.cteCache.get(def);
  if (hit) return hit.rows;
  const rows = m.compute();
  rt.cteCache.set(def, { cols: m.cols, rows });
  return rows;
}

// ───────────────────────── JOIN ─────────────────────────

function compileJoin(j: Extract<FromItem, { k: 'join' }>, parentScope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime): FromPlan {
  const kind = j.type;
  note(rt, kind === 'cross' ? 'Producto cartesiano (CROSS JOIN)' : `Unión ${{ inner: 'interna', left: 'externa izquierda', right: 'externa derecha', full: 'externa completa' }[kind]} (${kind.toUpperCase()} JOIN)`);
  rt.depth++;
  const l = compileFromItem(j.l, parentScope, ctes, rt);
  const r = compileFromItem(j.r, parentScope, ctes, rt);
  rt.depth--;
  const L = l.cols.length;
  // USING / NATURAL
  let using = j.using;
  if (j.natural) {
    const lnames = new Set(l.cols.filter((c) => !c.hidden).map((c) => c.name.toLowerCase()));
    using = r.cols.filter((c) => !c.hidden && lnames.has(c.name.toLowerCase())).map((c) => c.name);
  }
  const cols: ScopeCol[] = [...l.cols.map((c) => ({ ...c })), ...r.cols.map((c) => ({ ...c }))];
  const eqPairs: [number, number][] = [];
  if (using) {
    for (const n of using) {
      const li = l.cols.findIndex((c) => !c.hidden && c.name.toLowerCase() === n.toLowerCase());
      const ri = r.cols.findIndex((c) => !c.hidden && c.name.toLowerCase() === n.toLowerCase());
      if (li < 0 || ri < 0) {
        throw nameError(`La columna «${n}» del USING no existe en las dos tablas`, li < 0 ? `No está en ${l.cols[0]?.table ?? 'la tabla izquierda'}` : `No está en ${r.cols[0]?.table ?? 'la tabla derecha'}`);
      }
      eqPairs.push([li, L + ri]);
      cols[L + ri] = { ...cols[L + ri], hidden: true };
      if (kind === 'right' || kind === 'full') cols[li] = { ...cols[li], alt: L + ri };
    }
  }
  const scope: Scope = { cols, parent: parentScope };
  const ctx = makeCtx(rt, scope, ctes, 'on');

  // condición: ON compilado sobre la fila combinada
  let cond: CE | undefined;
  if (j.on) cond = compileExpr(j.on, ctx);
  const usingEq = eqPairs.map(([a, b]) => (row: Row) => row[a] !== null && row[b] !== null && keyEq(row[a], row[b]));

  // pares de igualdad para unir con una tabla hash
  const hashL: CE[] = [];
  const hashR: CE[] = [];
  const residual: Expr[] = [];
  if (j.on) {
    const lscope: Scope = { cols: l.cols, parent: parentScope };
    const rscope: Scope = { cols: r.cols, parent: parentScope };
    for (const c of splitAnd(j.on)) {
      let paired = false;
      if (c.k === 'bin' && c.op === '=') {
        const side = (e: Expr): 'l' | 'r' | 'c' | null => {
          const refs = columnRefs(e);
          if (!refs) return null;
          let any: 'l' | 'r' | 'c' = 'c';
          for (const ref of refs) {
            let f;
            try {
              f = resolveColumn(scope, ref);
            } catch {
              return null;
            }
            if (f.depth > 0) continue;
            const s2: 'l' | 'r' = f.idx < L ? 'l' : 'r';
            if (any !== 'c' && any !== s2) return null;
            any = s2;
          }
          return any;
        };
        const a = side(c.l);
        const b = side(c.r);
        if ((a === 'l' && b === 'r') || (a === 'r' && b === 'l')) {
          const le = a === 'l' ? c.l : c.r;
          const re = a === 'l' ? c.r : c.l;
          try {
            const lc = compileExpr(le, makeCtx(rt, lscope, ctes, 'on'));
            const rc = compileExpr(re, makeCtx(rt, rscope, ctes, 'on'));
            // mismo tipo de comparación en los dos lados, para que la igualdad por tabla hash coincida con la de SQL
            const num = (t: SqlType) => t === 'int' || t === 'real';
            if ((num(lc.type) && num(rc.type)) || (lc.type === rc.type && lc.type !== 'any')) {
              hashL.push(lc);
              hashR.push(rc);
              paired = true;
            }
          } catch {
            /* se queda como condición normal */
          }
        }
      }
      if (!paired) residual.push(c);
    }
  }
  const residualCE = j.on && hashL.length ? residual.map((e) => compileExpr(e, ctx)) : undefined;
  if (hashL.length) note(rt, `   (se unen por igualdad con una tabla hash: ${hashL.length} clave${hashL.length === 1 ? '' : 's'})`, 0);
  else if (cond || using) note(rt, `   (bucle anidado: se prueba la condición con cada par de filas)`, 0);

  const nullsL: Row = new Array(L).fill(null);
  const nullsR: Row = new Array(r.cols.length).fill(null);

  return {
    cols,
    correlated: l.correlated || r.correlated || !!scope.usedOuter,
    run: (outer) => {
      const lrows = l.run(outer);
      const rrows = r.run(outer);
      tick(rt, lrows.length + rrows.length);
      const out: Row[] = [];
      const matchedR = new Uint8Array(rrows.length);
      const push = (row: Row) => {
        out.push(row);
        if (out.length > LIMITS.maxJoinRows) throw runtimeError('La unión genera demasiadas filas', 'Revisa la condición ON: quizá falta, y se combinan todas las filas con todas');
      };
      const test = (row: Row): boolean => {
        for (const u of usingEq) if (!u(row)) return false;
        if (cond && !truthy(cond.ev({ row, parent: outer }))) return false;
        return true;
      };
      if (kind === 'cross') {
        for (const a of lrows) for (const b of rrows) push(a.concat(b));
        return out;
      }
      let map: Map<string, number[]> | undefined;
      if (hashL.length) {
        map = new Map();
        rrows.forEach((row, j2) => {
          const key: Value[] = hashR.map((h) => h.ev({ row, parent: outer }));
          if (key.some((v) => v === null)) return;
          const k = rowKey(key);
          const list = map!.get(k);
          if (list) list.push(j2);
          else map!.set(k, [j2]);
        });
      }
      for (const a of lrows) {
        let any = false;
        if (map) {
          const key: Value[] = hashL.map((h) => h.ev({ row: a, parent: outer }));
          const hits = key.some((v) => v === null) ? undefined : map.get(rowKey(key));
          if (hits) {
            for (const j2 of hits) {
              const row = a.concat(rrows[j2]);
              if (residualCE && !residualCE.every((c) => truthy(c.ev({ row, parent: outer })))) continue;
              if (usingEq.length && !usingEq.every((u) => u(row))) continue;
              any = true;
              matchedR[j2] = 1;
              push(row);
            }
          }
        } else {
          for (let j2 = 0; j2 < rrows.length; j2++) {
            const row = a.concat(rrows[j2]);
            if (test(row)) {
              any = true;
              matchedR[j2] = 1;
              push(row);
            }
          }
        }
        if (!any && (kind === 'left' || kind === 'full')) push(a.concat(nullsR));
      }
      if (kind === 'right' || kind === 'full') {
        for (let j2 = 0; j2 < rrows.length; j2++) if (!matchedR[j2]) push(nullsL.concat(rrows[j2]));
      }
      return out;
    },
  };
}

const keyEq = (a: Value, b: Value): boolean => rowKey([a]) === rowKey([b]);

export type { Cte };
export { evalConst };
