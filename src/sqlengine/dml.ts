/** INSERT, UPDATE y DELETE con todas sus restricciones: NOT NULL, UNIQUE, PRIMARY KEY, CHECK, FOREIGN KEY y disparadores. */
import type { SelItem, Stmt } from './ast';
import type { CheckDef, ForeignKey, Row, Table, UniqueDef } from './catalog';
import { compileExpr } from './expr';
import { closestWord } from './parser';
import { columnName, printExpr } from './print';
import type { CE, Ctx, Env, Outer, Runtime, Scope, ScopeCol } from './rt';
import { compileQuery } from './select';
import { constraintError, nameError, runtimeError, syntaxError, type ResultSet, type Value } from './types';
import { castValue, compareValues, rowKey, truthy } from './values';

type InsertStmt = Extract<Stmt, { k: 'insert' }>;
type UpdateStmt = Extract<Stmt, { k: 'update' }>;
type DeleteStmt = Extract<Stmt, { k: 'delete' }>;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const show = (v: Value): string => (v === null ? 'NULL' : typeof v === 'string' ? `'${v}'` : String(v));

export function emptyResult(command: ResultSet['command'], message: string, rt: Runtime): ResultSet {
  return { command, columns: [], rows: [], affected: 0, message, stats: rt.stats };
}

export function tableScope(tbl: Table, alias: string, outer?: Outer): Scope {
  const cols: ScopeCol[] = tbl.cols.map((c, ci) => ({ name: c.name, table: alias, type: c.type.base, tbl, ci }));
  return { cols, parent: outer?.scope };
}

export function ctxFor(rt: Runtime, scope: Scope, clause: Ctx['clause'] = 'other'): Ctx {
  return { rt, scope, mode: 'row', clause, compileQuery };
}

function needTable(rt: Runtime, name: string, pos?: number): Table {
  const t = rt.db.table(name);
  if (t) return t;
  if (rt.db.view(name)) throw syntaxError(`«${name}» es una vista: no se puede modificar directamente`, pos, 'Modifica la tabla de la que sale la vista');
  const all = [...rt.db.tables.values()].map((x) => x.name);
  const near = closestWord(name, all, 2);
  throw nameError(`No existe la tabla «${name}»`, near ? `¿Quisiste decir «${near}»?` : all.length ? `Tablas disponibles: ${all.join(', ')}` : 'La base de datos aún no tiene tablas', pos);
}

// ───────────────────────── restricciones de una tabla ─────────────────────────

interface Prep {
  tbl: Table;
  scope: Scope;
  ctx: Ctx;
  defaults: (CE | undefined)[];
  gens: (CE | undefined)[];
  checks: { ce: CE; def: CheckDef }[];
  outer?: Outer;
}

function prepare(rt: Runtime, tbl: Table, alias: string, outer?: Outer): Prep {
  const scope = tableScope(tbl, alias, outer);
  const ctx = ctxFor(rt, scope);
  const noRow = ctxFor(rt, { cols: [], parent: outer?.scope });
  return {
    tbl,
    scope,
    ctx,
    outer,
    defaults: tbl.cols.map((c) => (c.default ? compileExpr(c.default, noRow) : undefined)),
    gens: tbl.cols.map((c) => (c.generated ? compileExpr(c.generated, ctx) : undefined)),
    checks: tbl.checks.map((def) => ({ ce: compileExpr(def.e, ctx), def })),
  };
}

const label = (tbl: Table, cols: number[]) => cols.map((c) => tbl.cols[c].name).join(', ');

/** Índices únicos de la tabla (PRIMARY KEY, UNIQUE y CREATE UNIQUE INDEX) con sus claves en memoria durante una sentencia. */
class UniqueGuard {
  defs: { name: string; cols: number[]; primary: boolean; exprs?: CE[]; where?: CE; map: Map<string, Row> }[] = [];
  constructor(rt: Runtime, public tbl: Table, outer?: Outer) {
    const scope = tableScope(tbl, tbl.name, outer);
    const ctx = ctxFor(rt, scope);
    const add = (u: UniqueDef) => this.defs.push({ name: u.name ?? (u.primary ? `${tbl.name}_pkey` : `${tbl.name}_${label(tbl, u.cols).replace(/, /g, '_')}_key`), cols: u.cols, primary: u.primary, map: new Map() });
    for (const u of tbl.uniques) add(u);
    for (const ix of tbl.indexes) {
      if (!ix.unique) continue;
      this.defs.push({
        name: ix.name,
        cols: ix.cols,
        primary: false,
        exprs: ix.exprs.length ? ix.exprs.map((e) => compileExpr(e, ctx)) : undefined,
        where: ix.where ? compileExpr(ix.where, ctx) : undefined,
        map: new Map(),
      });
    }
    for (const r of tbl.rows) for (const d of this.defs) this.put(d, r);
  }
  keyOf(d: UniqueGuard['defs'][number], row: Row): string | null {
    if (d.where && !truthy(d.where.ev({ row }))) return null;
    const vals = d.exprs ? d.exprs.map((e) => e.ev({ row })) : d.cols.map((c) => row[c]);
    if (vals.some((v) => v === null)) return null; // NULL no choca con NULL
    return rowKey(vals);
  }
  put(d: UniqueGuard['defs'][number], row: Row): void {
    const k = this.keyOf(d, row);
    if (k !== null) d.map.set(k, row);
  }
  /** La primera restricción que violaría esta fila (ignorando `self`), con la fila que ya existe. */
  find(row: Row, self?: Row): { def: UniqueGuard['defs'][number]; other: Row } | null {
    for (const d of this.defs) {
      const k = this.keyOf(d, row);
      if (k === null) continue;
      const other = d.map.get(k);
      if (other && other !== self) return { def: d, other };
    }
    return null;
  }
  add(row: Row): void {
    for (const d of this.defs) this.put(d, row);
  }
  remove(row: Row): void {
    for (const d of this.defs) {
      const k = this.keyOf(d, row);
      if (k !== null && d.map.get(k) === row) d.map.delete(k);
    }
  }
  error(d: UniqueGuard['defs'][number], row: Row) {
    const where = d.exprs ? 'el índice' : `«${label(this.tbl, d.cols)}»`;
    const val = d.exprs ? '' : ` (${d.cols.map((c) => `${this.tbl.cols[c].name} = ${show(row[c])}`).join(', ')})`;
    return constraintError(
      d.primary ? `Clave primaria duplicada: ya existe un registro con ${d.cols.map((c) => `${this.tbl.cols[c].name} = ${show(row[c])}`).join(', ')} en «${this.tbl.name}»` : `Valor duplicado: ya existe ese valor en ${where} de «${this.tbl.name}»${val}`,
      d.primary ? 'La clave primaria identifica a cada fila y no se puede repetir. Usa otro valor, o deja que se genere sola' : 'Esa columna (o grupo de columnas) es UNIQUE: no admite dos filas con el mismo valor',
    );
  }
}

/** Convierte, completa y valida una fila nueva o modificada (tipos, valores por defecto, columnas generadas, NOT NULL y CHECK). */
function finishRow(prep: Prep, input: (Value | undefined)[], rt: Runtime): Row {
  const { tbl } = prep;
  const row: Row = new Array(tbl.cols.length).fill(null);
  tbl.cols.forEach((c, i) => {
    let v = input[i];
    if (v === undefined) {
      if (c.generated) v = null;
      else if (c.autoinc && !prep.defaults[i]) {
        let max = tbl.counters[i] ?? 0;
        if (max === 0) for (const r of tbl.rows) if (typeof r[i] === 'number' && (r[i] as number) > max) max = r[i] as number;
        v = max + 1;
        tbl.counters[i] = v;
      } else v = prep.defaults[i] ? prep.defaults[i]!.ev({ row, parent: prep.outer?.env }) : null;
    }
    if (c.autoinc && v === null && !c.generated) {
      let max = tbl.counters[i] ?? 0;
      for (const r of tbl.rows) if (typeof r[i] === 'number' && (r[i] as number) > max) max = r[i] as number;
      v = max + 1;
      tbl.counters[i] = v;
    }
    row[i] = c.type.base === 'any' || c.generated ? v : castValue(v, c.type, c.name);
    if (c.autoinc && typeof row[i] === 'number' && (row[i] as number) > (tbl.counters[i] ?? 0)) tbl.counters[i] = row[i] as number;
  });
  prep.gens.forEach((g, i) => {
    if (g) row[i] = castValue(g.ev({ row, parent: prep.outer?.env }), tbl.cols[i].type, tbl.cols[i].name);
  });
  tbl.cols.forEach((c, i) => {
    if (row[i] === null && c.notNull) {
      throw constraintError(`La columna «${c.name}» de «${tbl.name}» no admite NULL`, c.default || c.autoinc ? undefined : `Dale un valor a ${c.name}, o define la columna con un DEFAULT / sin NOT NULL`);
    }
  });
  for (const { ce, def } of prep.checks) {
    const v = ce.ev({ row, parent: prep.outer?.env });
    if (v === false || v === 0) {
      throw constraintError(
        `Se incumple la restricción CHECK ${def.name ? `«${def.name}» ` : ''}(${printExpr(def.e)}) de «${tbl.name}»`,
        `El valor ${def.col && tbl.colIndex(def.col) >= 0 ? `${def.col} = ${show(row[tbl.colIndex(def.col)])}` : 'de la fila'} no cumple la condición`,
      );
    }
  }
  return row;
}

function parentRows(rt: Runtime, fk: ForeignKey, vals: Value[], pending: Row[], self: Table) {
  const parent = rt.db.table(fk.refTable);
  if (!parent) return false;
  const refIdx = fk.refCols.map((c) => parent.colIndex(c));
  const k = rowKey(vals);
  if (parent.hash(refIdx).has(k)) return true;
  if (parent === self) return pending.some((r) => rowKey(refIdx.map((i) => r[i])) === k);
  return false;
}

function checkForeignKeys(rt: Runtime, tbl: Table, row: Row, pending: Row[]): void {
  for (const fk of tbl.fks) {
    const vals = fk.cols.map((c) => row[c]);
    if (vals.some((v) => v === null)) continue;
    if (!parentRows(rt, fk, vals, pending, tbl)) {
      throw constraintError(
        `Clave foránea: ${fk.cols.map((c, i) => `${tbl.cols[c].name} = ${show(vals[i])}`).join(', ')} no existe en «${fk.refTable}(${fk.refCols.join(', ')})»`,
        `Primero tiene que existir ese registro en ${fk.refTable}, o usa un valor que ya exista`,
      );
    }
  }
}

function referencing(rt: Runtime, parent: Table): { child: Table; fk: ForeignKey }[] {
  const out: { child: Table; fk: ForeignKey }[] = [];
  for (const child of rt.db.tables.values()) for (const fk of child.fks) if (fk.refTable.toLowerCase() === parent.name.toLowerCase()) out.push({ child, fk });
  return out;
}

// ───────────────────────── disparadores ─────────────────────────

function fireTriggers(rt: Runtime, tbl: Table, timing: 'before' | 'after', event: 'insert' | 'update' | 'delete', oldRow: Row | null, newRow: Row | null, outer?: Outer): void {
  const list = [...rt.db.triggers.values()].filter((t) => t.table.toLowerCase() === tbl.name.toLowerCase() && t.timing === timing && t.event === event);
  if (!list.length) return;
  if (rt.trigDepth > 8) throw runtimeError('Demasiados disparadores anidados', '¿Un disparador que se activa a sí mismo sin parar?');
  const n = tbl.cols.length;
  const scope: Scope = {
    cols: [...tbl.cols.map((c) => ({ name: c.name, table: 'old', type: c.type.base })), ...tbl.cols.map((c) => ({ name: c.name, table: 'new', type: c.type.base }))],
    parent: outer?.scope,
  };
  const env: Env = { row: [...(oldRow ?? new Array(n).fill(null)), ...(newRow ?? new Array(n).fill(null))], parent: outer?.env };
  for (const t of list) {
    if (t.when && !truthy(compileExpr(t.when, ctxFor(rt, scope)).ev(env))) continue;
    rt.trigDepth++;
    try {
      for (const s of t.body) rt.execStmt(s, { scope, env });
    } finally {
      rt.trigDepth--;
    }
  }
}

// ───────────────────────── borrado en cascada ─────────────────────────

function removeRows(rt: Runtime, tbl: Table, rows: Row[], outer?: Outer): void {
  if (!rows.length) return;
  const set = new Set(rows);
  for (const { child, fk } of referencing(rt, tbl)) {
    const refIdx = fk.refCols.map((c) => tbl.colIndex(c));
    const keys = new Set(rows.map((r) => (refIdx.some((i) => r[i] === null) ? '' : rowKey(refIdx.map((i) => r[i])))).filter(Boolean));
    if (!keys.size) continue;
    const kids = child.rows.filter((cr) => {
      if (child === tbl && set.has(cr)) return false;
      const vals = fk.cols.map((i) => cr[i]);
      return !vals.some((v) => v === null) && keys.has(rowKey(vals));
    });
    if (!kids.length) continue;
    if (fk.onDelete === 'cascade') removeRows(rt, child, kids, outer);
    else if (fk.onDelete === 'set null' || fk.onDelete === 'set default') {
      for (const kid of kids) {
        fk.cols.forEach((ci) => {
          const col = child.cols[ci];
          const v = fk.onDelete === 'set null' ? null : col.default ? compileExpr(col.default, ctxFor(rt, { cols: [] })).ev({ row: [] }) : null;
          if (v === null && col.notNull) throw constraintError(`No se puede poner NULL en «${col.name}» de «${child.name}» (es NOT NULL)`, 'Cambia la acción ON DELETE o permite NULL en esa columna');
          kid[ci] = v;
        });
      }
      child.touch();
    } else {
      throw constraintError(
        `No se puede borrar: hay ${plural(kids.length, 'fila', 'filas')} de «${child.name}» que dependen de ${rows.length === 1 ? 'este registro' : 'estos registros'} de «${tbl.name}»`,
        `Borra primero las filas de ${child.name}, o define la clave foránea con ON DELETE CASCADE`,
      );
    }
  }
  for (const r of rows) fireTriggers(rt, tbl, 'before', 'delete', r, null, outer);
  tbl.rows = tbl.rows.filter((r) => !set.has(r));
  tbl.touch();
  for (const r of rows) fireTriggers(rt, tbl, 'after', 'delete', r, null, outer);
}

// ───────────────────────── RETURNING ─────────────────────────

function returningResult(rt: Runtime, command: ResultSet['command'], tbl: Table, alias: string, items: SelItem[], rows: Row[], outer?: Outer): ResultSet {
  const scope = tableScope(tbl, alias, outer);
  const ctx = ctxFor(rt, scope, 'select');
  const compiled: { ce: CE; name: string }[] = [];
  for (const it of items) {
    if (it.e.k === 'star') {
      tbl.cols.forEach((c, i) => compiled.push({ ce: { ev: (env) => env.row[i], type: c.type.base }, name: c.name }));
    } else compiled.push({ ce: compileExpr(it.e, ctx), name: it.alias ?? columnName(it.e) });
  }
  return {
    command,
    columns: compiled.map((c) => ({ name: c.name, type: c.ce.type })),
    rows: rows.map((r) => compiled.map((c) => c.ce.ev({ row: r, parent: outer?.env }))),
    affected: rows.length,
    message: '',
    stats: rt.stats,
  };
}

// ───────────────────────── INSERT ─────────────────────────

export function execInsert(st: InsertStmt, rt: Runtime, outer?: Outer): ResultSet {
  const tbl = needTable(rt, st.table, st.pos);
  let colIdx: number[];
  if (st.cols) {
    colIdx = st.cols.map((n) => {
      const i = tbl.colIndex(n);
      if (i < 0) {
        const near = closestWord(n, tbl.cols.map((c) => c.name), 2);
        throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${n}»`, near ? `¿Quisiste decir «${near}»?` : `Columnas de ${tbl.name}: ${tbl.cols.map((c) => c.name).join(', ')}`, st.pos);
      }
      if (tbl.cols[i].generated) throw syntaxError(`La columna «${n}» es generada: no se puede dar un valor`, st.pos);
      return i;
    });
    const dup = colIdx.find((c, i) => colIdx.indexOf(c) !== i);
    if (dup !== undefined) throw syntaxError(`La columna «${tbl.cols[dup].name}» aparece dos veces en el INSERT`, st.pos);
  } else colIdx = tbl.cols.map((_, i) => i).filter((i) => !tbl.cols[i].generated);

  // origen de los valores
  const noRowCtx = ctxFor(rt, { cols: [], parent: outer?.scope }, 'values');
  const source: (Value | undefined)[][] = [];
  const env: Env = { row: [], parent: outer?.env };
  if (st.source.k === 'values') {
    for (const r of st.source.rows) {
      if (r.length !== colIdx.length) {
        throw syntaxError(
          `INSERT tiene ${plural(colIdx.length, 'columna de destino', 'columnas de destino')} pero ${plural(r.length, 'valor', 'valores')} en la fila`,
          st.pos,
          st.cols ? 'Cada fila de VALUES debe tener tantos valores como columnas nombradas' : `Sin nombrar columnas hay que dar ${colIdx.length} valores (uno por columna: ${colIdx.map((c) => tbl.cols[c].name).join(', ')}). Es más seguro escribir INSERT INTO ${tbl.name} (columnas) VALUES (…)`,
        );
      }
      source.push(r.map((e) => (e.k === 'fn' && e.name === '__default' ? undefined : compileExpr(e, noRowCtx).ev(env))));
    }
  } else if (st.source.k === 'query') {
    const cq = compileQuery(st.source.q, outer?.scope, undefined, rt);
    if (cq.cols.length !== colIdx.length) throw syntaxError(`El SELECT devuelve ${plural(cq.cols.length, 'columna', 'columnas')} pero el INSERT espera ${colIdx.length}`, st.pos);
    for (const r of cq.run(env)) source.push(r);
  } else source.push([]);

  const prep = prepare(rt, tbl, tbl.name, outer);
  const guard = new UniqueGuard(rt, tbl, outer);
  const inserted: Row[] = [];
  const returned: Row[] = [];
  let skipped = 0;
  let updatedByConflict = 0;
  for (const src of source) {
    const input: (Value | undefined)[] = new Array(tbl.cols.length).fill(undefined);
    colIdx.forEach((ci, k) => {
      input[ci] = src[k];
    });
    // disparadores BEFORE (solo validan: pueden lanzar un error con RAISE)
    if (rt.db.triggers.size) {
      const preview = input.map((v) => (v === undefined ? null : v));
      fireTriggers(rt, tbl, 'before', 'insert', null, preview, outer);
    }
    const row = finishRow(prep, input, rt);
    let conflict = guard.find(row);
    while (conflict) {
      const { def, other } = conflict;
      const c = st.conflict;
      if (c && (c.cols.length === 0 || (c.cols.length === def.cols.length && c.cols.every((n) => def.cols.includes(tbl.colIndex(n)))))) {
        if (c.action === 'nothing') {
          skipped++;
          conflict = null;
          row.length = 0;
          break;
        }
        // DO UPDATE: las columnas del valor propuesto se llaman «excluded»
        const exScope: Scope = {
          cols: [...tbl.cols.map((x, i) => ({ name: x.name, table: tbl.name, type: x.type.base, tbl, ci: i })), ...tbl.cols.map((x) => ({ name: x.name, table: 'excluded', type: x.type.base }))],
          parent: outer?.scope,
        };
        const ectx = ctxFor(rt, exScope);
        const e2: Env = { row: [...other, ...row], parent: outer?.env };
        if (c.where && !truthy(compileExpr(c.where, ectx).ev(e2))) {
          skipped++;
          row.length = 0;
          break;
        }
        const next: (Value | undefined)[] = other.slice();
        for (const a of c.sets ?? []) {
          const ci = tbl.colIndex(a.col);
          if (ci < 0) throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.col}»`);
          next[ci] = compileExpr(a.e, ectx).ev(e2);
        }
        const upd = finishRow(prep, next, rt);
        guard.remove(other);
        const again = guard.find(upd, other);
        if (again) throw guard.error(again.def, upd);
        checkForeignKeys(rt, tbl, upd, inserted);
        upd.forEach((v, i) => {
          other[i] = v;
        });
        guard.add(other);
        updatedByConflict++;
        returned.push(other);
        row.length = 0;
        conflict = null;
        break;
      }
      if (st.orAction === 'ignore') {
        skipped++;
        row.length = 0;
        break;
      }
      if (st.orAction === 'replace') {
        guard.remove(other);
        tbl.rows = tbl.rows.filter((r) => r !== other);
        const at = inserted.indexOf(other);
        if (at >= 0) inserted.splice(at, 1);
        conflict = guard.find(row);
        continue;
      }
      throw guard.error(def, row);
    }
    if (row.length === 0) continue;
    checkForeignKeys(rt, tbl, row, inserted);
    tbl.rows.push(row);
    inserted.push(row);
    guard.add(row);
    returned.push(row);
    tbl.touch();
    fireTriggers(rt, tbl, 'after', 'insert', null, row, outer);
  }
  tbl.touch();
  const affected = inserted.length + updatedByConflict;
  const message = skipped && !affected ? `0 filas insertadas (${plural(skipped, 'fila omitida', 'filas omitidas')} por conflicto)` : `${plural(affected, 'fila insertada', 'filas insertadas')}${skipped ? ` (${plural(skipped, 'omitida', 'omitidas')} por conflicto)` : ''}`;
  if (st.returning) {
    const r = returningResult(rt, 'INSERT', tbl, tbl.name, st.returning, returned, outer);
    r.message = message;
    return r;
  }
  return { ...emptyResult('INSERT', message, rt), affected };
}

// ───────────────────────── UPDATE ─────────────────────────

export function execUpdate(st: UpdateStmt, rt: Runtime, outer?: Outer): ResultSet {
  const tbl = needTable(rt, st.table, st.pos);
  const alias = st.alias ?? tbl.name;
  const targetScope = tableScope(tbl, alias, outer);
  // UPDATE … FROM otra: se unen las dos
  let fromRows: Row[] | undefined;
  let scope = targetScope;
  if (st.from) {
    const cq = compileQuery({ body: { k: 'select', distinct: false, items: [{ e: { k: 'star', pos: 0 } }], from: st.from, pos: 0 } }, outer?.scope, undefined, rt);
    fromRows = cq.run({ row: [], parent: outer?.env });
    scope = { cols: [...targetScope.cols, ...cq.cols], parent: outer?.scope };
  }
  const ctx = ctxFor(rt, scope, 'where');
  const where = st.where ? compileExpr(st.where, ctx) : undefined;
  const sets = st.sets.map((a) => {
    const ci = tbl.colIndex(a.col);
    if (ci < 0) {
      const near = closestWord(a.col, tbl.cols.map((c) => c.name), 2);
      throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.col}»`, near ? `¿Quisiste decir «${near}»?` : `Columnas de ${tbl.name}: ${tbl.cols.map((c) => c.name).join(', ')}`, st.pos);
    }
    if (tbl.cols[ci].generated) throw syntaxError(`La columna «${a.col}» es generada: no se puede modificar`, st.pos);
    const isDefault = a.e.k === 'fn' && a.e.name === '__default';
    return { ci, ce: isDefault ? undefined : compileExpr(a.e, ctxFor(rt, scope, 'other')) };
  });

  // 1. filas afectadas (se deciden antes de cambiar nada)
  const matches: { row: Row; combined: Row }[] = [];
  const outerEnv = outer?.env;
  for (const row of tbl.rows) {
    if (fromRows) {
      for (const f of fromRows) {
        const combined = row.concat(f);
        if (!where || truthy(where.ev({ row: combined, parent: outerEnv }))) {
          matches.push({ row, combined });
          break;
        }
      }
    } else if (!where || truthy(where.ev({ row, parent: outerEnv }))) matches.push({ row, combined: row });
  }
  rt.stats.rowsRead += tbl.rows.length;

  // 2. nuevos valores (todas las expresiones ven los valores antiguos)
  const prep = prepare(rt, tbl, alias, outer);
  const guard = new UniqueGuard(rt, tbl, outer);
  const plan = matches.map(({ row, combined }) => {
    const input: (Value | undefined)[] = row.slice();
    for (const s of sets) input[s.ci] = s.ce ? s.ce.ev({ row: combined, parent: outerEnv }) : undefined;
    return { row, input, old: row.slice() };
  });
  const out: Row[] = [];
  for (const p of plan) {
    const fresh = finishRow(prep, p.input.map((v, i) => (sets.some((s) => s.ci === i && !s.ce) ? undefined : v)), rt);
    // las columnas autoincrementales que no se tocan se conservan
    fresh.forEach((_, i) => {
      if (!sets.some((s) => s.ci === i) && !tbl.cols[i].generated) fresh[i] = p.row[i];
    });
    guard.remove(p.row);
    const clash = guard.find(fresh, p.row);
    if (clash) throw guard.error(clash.def, fresh);
    checkForeignKeys(rt, tbl, fresh, []);
    // claves referenciadas por otras tablas
    for (const { child, fk } of referencing(rt, tbl)) {
      const refIdx = fk.refCols.map((c) => tbl.colIndex(c));
      if (refIdx.every((i) => compareValuesSafe(p.row[i], fresh[i]))) continue;
      const k = rowKey(refIdx.map((i) => p.row[i]));
      const kids = child.rows.filter((cr) => {
        const vals = fk.cols.map((i) => cr[i]);
        return !vals.some((v) => v === null) && rowKey(vals) === k;
      });
      if (!kids.length) continue;
      if (fk.onUpdate === 'cascade') {
        for (const kid of kids) fk.cols.forEach((ci, n) => (kid[ci] = fresh[refIdx[n]]));
        child.touch();
      } else if (fk.onUpdate === 'set null') {
        for (const kid of kids) fk.cols.forEach((ci) => (kid[ci] = null));
        child.touch();
      } else {
        throw constraintError(`No se puede cambiar esa clave de «${tbl.name}»: hay ${plural(kids.length, 'fila', 'filas')} de «${child.name}» que dependen de ella`, 'Define la clave foránea con ON UPDATE CASCADE, o cambia primero las filas dependientes');
      }
    }
    fireTriggers(rt, tbl, 'before', 'update', p.old, fresh, outer);
    fresh.forEach((v, i) => {
      p.row[i] = v;
    });
    guard.add(p.row);
    out.push(p.row);
  }
  tbl.touch();
  for (const p of plan) fireTriggers(rt, tbl, 'after', 'update', p.old, p.row, outer);
  const message = plural(out.length, 'fila actualizada', 'filas actualizadas');
  if (st.returning) {
    const r = returningResult(rt, 'UPDATE', tbl, alias, st.returning, out, outer);
    r.message = message;
    return r;
  }
  return { ...emptyResult('UPDATE', message, rt), affected: out.length };
}

const compareValuesSafe = (a: Value, b: Value): boolean => (a === null || b === null ? a === b : compareValues(a, b) === 0);

// ───────────────────────── DELETE ─────────────────────────

export function execDelete(st: DeleteStmt, rt: Runtime, outer?: Outer): ResultSet {
  const tbl = needTable(rt, st.table, st.pos);
  const alias = st.alias ?? tbl.name;
  const targetScope = tableScope(tbl, alias, outer);
  let usingRows: Row[] | undefined;
  let scope = targetScope;
  if (st.using) {
    const cq = compileQuery({ body: { k: 'select', distinct: false, items: [{ e: { k: 'star', pos: 0 } }], from: st.using, pos: 0 } }, outer?.scope, undefined, rt);
    usingRows = cq.run({ row: [], parent: outer?.env });
    scope = { cols: [...targetScope.cols, ...cq.cols], parent: outer?.scope };
  }
  const where = st.where ? compileExpr(st.where, ctxFor(rt, scope, 'where')) : undefined;
  const victims: Row[] = [];
  for (const row of tbl.rows) {
    if (usingRows) {
      if (usingRows.some((u) => !where || truthy(where.ev({ row: row.concat(u), parent: outer?.env })))) victims.push(row);
    } else if (!where || truthy(where.ev({ row, parent: outer?.env }))) victims.push(row);
  }
  rt.stats.rowsRead += tbl.rows.length;
  const snapshot = st.returning ? victims.map((r) => r.slice()) : [];
  removeRows(rt, tbl, victims, outer);
  const message = plural(victims.length, 'fila eliminada', 'filas eliminadas');
  if (st.returning) {
    const r = returningResult(rt, 'DELETE', tbl, alias, st.returning, snapshot, outer);
    r.message = message;
    return r;
  }
  return { ...emptyResult('DELETE', message, rt), affected: victims.length };
}

export function execTruncate(name: string, rt: Runtime, pos?: number): ResultSet {
  const tbl = needTable(rt, name, pos);
  for (const { child, fk } of referencing(rt, tbl)) {
    if (child !== tbl && child.rows.length > 0) {
      throw constraintError(`No se puede vaciar «${tbl.name}»: la tabla «${child.name}» tiene una clave foránea que apunta a ella`, `Vacía primero ${child.name}, o usa DELETE FROM ${tbl.name} con la acción ON DELETE adecuada`);
    }
    void fk;
  }
  const n = tbl.rows.length;
  tbl.rows = [];
  tbl.touch();
  return { ...emptyResult('TRUNCATE', `Tabla «${tbl.name}» vaciada (${plural(n, 'fila', 'filas')})`, rt), affected: n };
}

