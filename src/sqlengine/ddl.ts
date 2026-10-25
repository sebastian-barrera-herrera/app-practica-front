/** CREATE / DROP / ALTER de tablas, índices, vistas y disparadores. */
import type { AlterAction, ColumnDef, Expr, Stmt, TableConstraint, TypeName } from './ast';
import { Table, type Column, type ForeignKey, type IndexDef, type Row, type UniqueDef } from './catalog';
import { ctxFor, emptyResult, plural, tableScope } from './dml';
import { compileExpr } from './expr';
import { closestWord } from './parser';
import { printExpr } from './print';
import type { Runtime, ScopeCol } from './rt';
import { compileQuery } from './select';
import { constraintError, nameError, syntaxError, type ResultSet, type SqlType, type Value } from './types';
import { castValue, rowKey } from './values';

type CreateTable = Extract<Stmt, { k: 'create_table' }>;
type CreateIndex = Extract<Stmt, { k: 'create_index' }>;
type CreateView = Extract<Stmt, { k: 'create_view' }>;
type CreateTrigger = Extract<Stmt, { k: 'create_trigger' }>;
type Drop = Extract<Stmt, { k: 'drop' }>;
type Alter = Extract<Stmt, { k: 'alter' }>;

const lower = (s: string) => s.toLowerCase();

const baseOf = (t: SqlType): TypeName => ({ base: t, raw: t === 'int' ? 'integer' : t === 'real' ? 'real' : t === 'bool' ? 'boolean' : t === 'any' || t === 'null' ? '' : t });

function needTable(rt: Runtime, name: string, pos?: number): Table {
  const t = rt.db.table(name);
  if (t) return t;
  const all = [...rt.db.tables.values()].map((x) => x.name);
  const near = closestWord(name, all, 2);
  throw nameError(`No existe la tabla «${name}»`, near ? `¿Quisiste decir «${near}»?` : all.length ? `Tablas disponibles: ${all.join(', ')}` : undefined, pos);
}

function colsOf(tbl: Table, names: string[], what: string): number[] {
  return names.map((n) => {
    const i = tbl.colIndex(n);
    if (i < 0) {
      const near = closestWord(n, tbl.cols.map((c) => c.name), 2);
      throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${n}» (${what})`, near ? `¿Quisiste decir «${near}»?` : `Columnas: ${tbl.cols.map((c) => c.name).join(', ')}`);
    }
    return i;
  });
}

// ───────────────────────── CREATE TABLE ─────────────────────────

function addConstraints(rt: Runtime, tbl: Table, defs: ColumnDef[], constraints: TableConstraint[]): void {
  let havePk = false;
  for (const c of defs) {
    if (c.primary) {
      if (havePk) throw syntaxError(`La tabla «${tbl.name}» ya tiene una clave primaria: solo puede haber una`, undefined, 'Para una clave de varias columnas usa PRIMARY KEY (a, b) al final');
      havePk = true;
      tbl.uniques.push({ cols: [tbl.colIndex(c.name)], primary: true });
    } else if (c.unique) tbl.uniques.push({ cols: [tbl.colIndex(c.name)], primary: false });
    if (c.check) tbl.checks.push({ e: c.check, col: c.name });
    if (c.refs) tbl.fks.push(makeFk(rt, tbl, [tbl.colIndex(c.name)], c.refs.table, c.refs.column ? [c.refs.column] : undefined, c.refs.onDelete, c.refs.onUpdate));
  }
  for (const k of constraints) {
    if (k.k === 'primary') {
      if (havePk) throw syntaxError(`La tabla «${tbl.name}» ya tiene una clave primaria: solo puede haber una`);
      havePk = true;
      const cols = colsOf(tbl, k.cols, 'PRIMARY KEY');
      cols.forEach((i) => (tbl.cols[i].notNull = true));
      tbl.uniques.push({ name: k.name, cols, primary: true });
    } else if (k.k === 'unique') tbl.uniques.push({ name: k.name, cols: colsOf(tbl, k.cols, 'UNIQUE'), primary: false });
    else if (k.k === 'check') tbl.checks.push({ e: k.e, name: k.name });
    else tbl.fks.push(makeFk(rt, tbl, colsOf(tbl, k.cols, 'FOREIGN KEY'), k.table, k.refCols, k.onDelete, k.onUpdate, k.name));
  }
}

function makeFk(rt: Runtime, tbl: Table, cols: number[], refTable: string, refCols: string[] | undefined, onDelete: ForeignKey['onDelete'], onUpdate: ForeignKey['onUpdate'], name?: string): ForeignKey {
  const parent = lower(refTable) === lower(tbl.name) ? tbl : rt.db.table(refTable);
  if (!parent) {
    const near = closestWord(refTable, [...rt.db.tables.values()].map((t) => t.name), 2);
    throw nameError(`La clave foránea apunta a una tabla que no existe: «${refTable}»`, near ? `¿Quisiste decir «${near}»?` : 'Crea primero la tabla a la que apuntas', undefined);
  }
  let rc = refCols;
  if (!rc) {
    const pk = parent === tbl ? tbl.primary ?? tbl.uniques.find((u) => u.primary) : parent.primary;
    if (!pk) throw constraintError(`La tabla «${parent.name}» no tiene clave primaria: indica a qué columna apunta (REFERENCES ${parent.name}(columna))`);
    rc = pk.cols.map((i) => parent.cols[i].name);
  }
  if (rc.length !== cols.length) throw constraintError('La clave foránea y la clave a la que apunta deben tener el mismo número de columnas');
  const refIdx = colsOf(parent, rc, 'REFERENCES');
  // la columna referenciada debe ser única (PRIMARY KEY o UNIQUE)
  const ok = parent.uniques.some((u) => u.cols.length === refIdx.length && u.cols.every((c) => refIdx.includes(c)));
  if (!ok && !(parent === tbl && tbl.uniques.length === 0)) {
    throw constraintError(`No se puede crear la clave foránea: «${parent.name}(${rc.join(', ')})» no es PRIMARY KEY ni UNIQUE`, 'Una clave foránea solo puede apuntar a una columna que identifique cada fila de forma única');
  }
  return { name, cols, refTable: parent.name, refCols: rc, onDelete, onUpdate };
}

export function execCreateTable(st: CreateTable, rt: Runtime): ResultSet {
  if (rt.db.hasRelation(st.name)) {
    if (st.ifNotExists) return emptyResult('CREATE', `La tabla «${st.name}» ya existe: no se hace nada`, rt);
    throw nameError(`La tabla «${st.name}» ya existe`, 'Usa CREATE TABLE IF NOT EXISTS para no fallar si ya existe, o DROP TABLE para borrarla antes', st.pos);
  }
  if (st.as) {
    const cq = compileQuery(st.as, undefined, undefined, rt);
    const names: string[] = [];
    const cols: Column[] = cq.cols.map((c, i) => {
      let n = c.name === '?column?' ? `column${i + 1}` : c.name;
      while (names.includes(lower(n))) n += '_';
      names.push(lower(n));
      return { name: n, type: baseOf(c.type === 'null' ? 'any' : c.type), notNull: false, autoinc: false };
    });
    const tbl = new Table(st.name, cols);
    tbl.rows = cq.run().map((r) => r.slice());
    rt.db.tables.set(lower(st.name), tbl);
    return { ...emptyResult('CREATE', `Tabla «${st.name}» creada con ${plural(tbl.rows.length, 'fila', 'filas')}`, rt), affected: tbl.rows.length };
  }
  const seen = new Set<string>();
  const cols: Column[] = st.cols.map((c) => {
    if (seen.has(lower(c.name))) throw syntaxError(`La columna «${c.name}» está repetida en la tabla «${st.name}»`, st.pos);
    seen.add(lower(c.name));
    return { name: c.name, type: c.type, notNull: c.notNull || c.primary, autoinc: c.autoinc, default: c.default, generated: c.generated };
  });
  const tbl = new Table(st.name, cols);
  // INTEGER PRIMARY KEY de una sola columna: se numera sola (como en SQLite)
  const pkCols = st.cols.filter((c) => c.primary);
  const tblPk = st.constraints.find((k) => k.k === 'primary');
  const single = pkCols.length === 1 && !tblPk ? pkCols[0] : tblPk && tblPk.k === 'primary' && tblPk.cols.length === 1 ? st.cols.find((c) => lower(c.name) === lower(tblPk.cols[0])) : undefined;
  if (single && single.type.base === 'int' && ['integer', 'int'].includes(single.type.raw.toLowerCase())) cols[st.cols.indexOf(single)].autoinc = true;
  addConstraints(rt, tbl, st.cols, st.constraints);
  // los valores por defecto y los CHECK se validan ahora para detectar columnas que no existen
  const ctx = ctxFor(rt, tableScope(tbl, tbl.name));
  for (const c of tbl.checks) compileExpr(c.e, ctx);
  for (const c of cols) if (c.generated) compileExpr(c.generated, ctx);
  rt.db.tables.set(lower(st.name), tbl);
  return emptyResult('CREATE', `Tabla «${st.name}» creada`, rt);
}

// ───────────────────────── CREATE INDEX ─────────────────────────

function indexNameExists(rt: Runtime, name: string): boolean {
  return rt.db.allIndexes().some((i) => lower(i.name) === lower(name));
}

export function execCreateIndex(st: CreateIndex, rt: Runtime): ResultSet {
  const tbl = needTable(rt, st.table, st.pos);
  if (indexNameExists(rt, st.name) || rt.db.hasRelation(st.name)) {
    if (st.ifNotExists) return emptyResult('CREATE', `El índice «${st.name}» ya existe: no se hace nada`, rt);
    throw nameError(`Ya existe un índice o una tabla llamada «${st.name}»`, 'Elige otro nombre para el índice', st.pos);
  }
  const plain = st.cols.every((c) => c.e.k === 'col');
  const def: IndexDef = {
    name: st.name,
    table: tbl.name,
    cols: plain ? colsOf(tbl, st.cols.map((c) => (c.e as { name: string }).name), 'índice') : [],
    exprs: plain ? [] : st.cols.map((c) => c.e),
    desc: st.cols.map((c) => c.desc),
    unique: st.unique,
    where: st.where,
  };
  if (!plain) compileExpr({ k: 'fn', name: 'coalesce', args: st.cols.map((c) => c.e), distinct: false, star: false, pos: 0 }, ctxFor(rt, tableScope(tbl, tbl.name)));
  if (st.where) compileExpr(st.where, ctxFor(rt, tableScope(tbl, tbl.name)));
  if (st.unique) {
    // no se puede crear un índice único si ya hay valores repetidos
    const ctx = ctxFor(rt, tableScope(tbl, tbl.name));
    const where = st.where ? compileExpr(st.where, ctx) : undefined;
    const exprs = def.exprs.map((e) => compileExpr(e, ctx));
    const seen = new Set<string>();
    for (const r of tbl.rows) {
      if (where && where.ev({ row: r }) !== true) continue;
      const vals: Value[] = exprs.length ? exprs.map((e) => e.ev({ row: r })) : def.cols.map((c) => r[c]);
      if (vals.some((v) => v === null)) continue;
      const k = rowKey(vals);
      if (seen.has(k)) throw constraintError(`No se puede crear el índice único «${st.name}»: ya hay valores repetidos (${vals.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ')})`, 'Elimina o corrige los duplicados antes de crear el índice');
      seen.add(k);
    }
  }
  tbl.indexes.push(def);
  tbl.touch();
  return emptyResult('CREATE', `Índice «${st.name}» creado en «${tbl.name}»`, rt);
}

// ───────────────────────── CREATE VIEW / TRIGGER ─────────────────────────

export function execCreateView(st: CreateView, rt: Runtime): ResultSet {
  if (rt.db.table(st.name)) throw nameError(`Ya existe una tabla llamada «${st.name}»`, 'Elige otro nombre para la vista', st.pos);
  const exists = rt.db.view(st.name);
  if (exists && !st.orReplace) {
    if (st.ifNotExists) return emptyResult('CREATE', `La vista «${st.name}» ya existe: no se hace nada`, rt);
    throw nameError(`La vista «${st.name}» ya existe`, 'Usa CREATE OR REPLACE VIEW para sustituirla, o DROP VIEW para borrarla', st.pos);
  }
  // se compila ahora para avisar de errores (tablas o columnas que no existen)
  const cq = compileQuery(st.q, undefined, undefined, rt);
  if (st.cols && st.cols.length > cq.cols.length) throw syntaxError(`La vista nombra ${st.cols.length} columnas pero la consulta devuelve ${cq.cols.length}`, st.pos);
  rt.db.views.set(lower(st.name), { name: st.name, q: st.q, cols: st.cols, sql: st.sql });
  return emptyResult('CREATE', `Vista «${st.name}» creada`, rt);
}

export function execCreateTrigger(st: CreateTrigger, rt: Runtime): ResultSet {
  needTable(rt, st.table, st.pos);
  if (rt.db.triggers.has(lower(st.name))) {
    if (st.ifNotExists) return emptyResult('CREATE', `El disparador «${st.name}» ya existe: no se hace nada`, rt);
    throw nameError(`El disparador «${st.name}» ya existe`, 'Elige otro nombre o bórralo con DROP TRIGGER', st.pos);
  }
  rt.db.triggers.set(lower(st.name), { name: st.name, table: st.table, timing: st.timing, event: st.event, when: st.when, body: st.body });
  return emptyResult('CREATE', `Disparador «${st.name}» creado`, rt);
}

// ───────────────────────── DROP ─────────────────────────

function viewsUsing(rt: Runtime, name: string): string[] {
  return [...rt.db.views.values()].filter((v) => new RegExp(`"k":"table","name":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(JSON.stringify(v.q))).map((v) => v.name);
}

export function execDrop(st: Drop, rt: Runtime): ResultSet {
  const name = st.name;
  if (st.what === 'table') {
    const tbl = rt.db.table(name);
    if (!tbl) {
      if (st.ifExists) return emptyResult('DROP', `La tabla «${name}» no existe: no se hace nada`, rt);
      const near = closestWord(name, [...rt.db.tables.values()].map((t) => t.name), 2);
      throw nameError(`No existe la tabla «${name}»`, near ? `¿Quisiste decir «${near}»?` : 'Usa DROP TABLE IF EXISTS para no fallar si no existe', st.pos);
    }
    const deps: string[] = [];
    for (const t of rt.db.tables.values()) if (t !== tbl && t.fks.some((f) => lower(f.refTable) === lower(name))) deps.push(t.name);
    const vdeps = viewsUsing(rt, name);
    if ((deps.length || vdeps.length) && !st.cascade) {
      throw constraintError(
        `No se puede borrar la tabla «${tbl.name}»: ${deps.length ? `la tabla ${deps.map((d) => `«${d}»`).join(', ')} depende de ella` : ''}${deps.length && vdeps.length ? ' y ' : ''}${vdeps.length ? `la vista ${vdeps.map((d) => `«${d}»`).join(', ')} la usa` : ''}`,
        `Si de verdad quieres borrarla, usa DROP TABLE ${tbl.name} CASCADE (también quita esas dependencias)`,
      );
    }
    for (const t of rt.db.tables.values()) t.fks = t.fks.filter((f) => lower(f.refTable) !== lower(name));
    for (const v of vdeps) rt.db.views.delete(lower(v));
    for (const [k, tr] of rt.db.triggers) if (lower(tr.table) === lower(name)) rt.db.triggers.delete(k);
    rt.db.tables.delete(lower(name));
    return emptyResult('DROP', `Tabla «${tbl.name}» borrada`, rt);
  }
  if (st.what === 'view') {
    const v = rt.db.view(name);
    if (!v) {
      if (st.ifExists) return emptyResult('DROP', `La vista «${name}» no existe: no se hace nada`, rt);
      throw nameError(`No existe la vista «${name}»`, undefined, st.pos);
    }
    rt.db.views.delete(lower(name));
    return emptyResult('DROP', `Vista «${v.name}» borrada`, rt);
  }
  if (st.what === 'index') {
    for (const t of rt.db.tables.values()) {
      const i = t.indexes.findIndex((x) => lower(x.name) === lower(name));
      if (i >= 0) {
        t.indexes.splice(i, 1);
        t.touch();
        return emptyResult('DROP', `Índice «${name}» borrado`, rt);
      }
    }
    if (st.ifExists) return emptyResult('DROP', `El índice «${name}» no existe: no se hace nada`, rt);
    throw nameError(`No existe el índice «${name}»`, `Índices: ${rt.db.allIndexes().map((i) => i.name).join(', ') || '(ninguno)'}`, st.pos);
  }
  if (!rt.db.triggers.delete(lower(name))) {
    if (st.ifExists) return emptyResult('DROP', `El disparador «${name}» no existe: no se hace nada`, rt);
    throw nameError(`No existe el disparador «${name}»`, undefined, st.pos);
  }
  return emptyResult('DROP', `Disparador «${name}» borrado`, rt);
}

// ───────────────────────── ALTER ─────────────────────────

function renameInAst<T>(node: T, from: string, to: string): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = { ...(x as Record<string, unknown>) };
      if (o.k === 'col' && typeof o.name === 'string' && lower(o.name) === lower(from)) o.name = to;
      for (const k of Object.keys(o)) if (k !== 'name') o[k] = walk(o[k]);
      return o;
    }
    return x;
  };
  return walk(node) as T;
}

function evalDefault(rt: Runtime, e: Expr): Value {
  return compileExpr(e, ctxFor(rt, { cols: [] })).ev({ row: [] });
}

export function execAlter(st: Alter, rt: Runtime): ResultSet {
  const tbl = needTable(rt, st.table, st.pos);
  const a: AlterAction = st.action;
  switch (a.op) {
    case 'add_column': {
      const c = a.col;
      if (tbl.colIndex(c.name) >= 0) throw nameError(`La columna «${c.name}» ya existe en «${tbl.name}»`, undefined, st.pos);
      const col: Column = { name: c.name, type: c.type, notNull: c.notNull || c.primary, autoinc: c.autoinc, default: c.default, generated: c.generated };
      if (c.primary) throw syntaxError('No se puede añadir una clave primaria con ADD COLUMN', st.pos, 'Crea la columna y luego usa ALTER TABLE … ADD PRIMARY KEY (columna)');
      let fill: Value = null;
      if (c.default) fill = castValue(evalDefault(rt, c.default), c.type, c.name);
      if (col.notNull && fill === null && tbl.rows.length > 0 && !c.generated) {
        throw constraintError(`No se puede añadir «${c.name}» NOT NULL a una tabla con filas si no tiene DEFAULT`, `Añade DEFAULT valor (por ejemplo ${c.name} ${c.type.raw || 'TEXT'} NOT NULL DEFAULT 0), o crea la columna sin NOT NULL`);
      }
      tbl.cols.push(col);
      const idx = tbl.cols.length - 1;
      if (c.unique) tbl.uniques.push({ cols: [idx], primary: false });
      if (c.check) tbl.checks.push({ e: c.check, col: c.name });
      if (c.refs) tbl.fks.push(makeFk(rt, tbl, [idx], c.refs.table, c.refs.column ? [c.refs.column] : undefined, c.refs.onDelete, c.refs.onUpdate));
      const gen = c.generated ? compileExpr(c.generated, ctxFor(rt, tableScope(tbl, tbl.name))) : undefined;
      for (const r of tbl.rows) r.push(gen ? castValue(gen.ev({ row: r }), c.type, c.name) : fill);
      tbl.touch();
      return emptyResult('ALTER', `Columna «${c.name}» añadida a «${tbl.name}»`, rt);
    }
    case 'drop_column': {
      const i = tbl.colIndex(a.name);
      if (i < 0) {
        if (a.ifExists) return emptyResult('ALTER', `La columna «${a.name}» no existe: no se hace nada`, rt);
        throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.name}»`, undefined, st.pos);
      }
      if (tbl.cols.length === 1) throw constraintError('No se puede borrar la única columna de una tabla', 'Usa DROP TABLE si quieres borrar la tabla entera');
      const usedBy = (u: UniqueDef) => u.cols.includes(i);
      if (tbl.uniques.some(usedBy)) throw constraintError(`No se puede borrar «${a.name}»: forma parte de una clave primaria o UNIQUE`, 'Quita antes esa restricción');
      if (tbl.fks.some((f) => f.cols.includes(i))) throw constraintError(`No se puede borrar «${a.name}»: forma parte de una clave foránea`);
      for (const t of rt.db.tables.values()) if (t.fks.some((f) => lower(f.refTable) === lower(tbl.name) && f.refCols.some((c) => lower(c) === lower(a.name)))) throw constraintError(`No se puede borrar «${a.name}»: la tabla «${t.name}» tiene una clave foránea que apunta a esa columna`);
      if (tbl.indexes.some((x) => x.cols.includes(i))) throw constraintError(`No se puede borrar «${a.name}»: hay un índice que la usa`, 'Borra antes el índice con DROP INDEX');
      const shift = (n: number) => (n > i ? n - 1 : n);
      tbl.cols.splice(i, 1);
      for (const r of tbl.rows) r.splice(i, 1);
      tbl.uniques = tbl.uniques.map((u) => ({ ...u, cols: u.cols.map(shift) }));
      tbl.fks = tbl.fks.map((f) => ({ ...f, cols: f.cols.map(shift) }));
      tbl.indexes = tbl.indexes.map((x) => ({ ...x, cols: x.cols.map(shift) }));
      tbl.checks = tbl.checks.filter((c) => c.col !== a.name);
      const counters: Record<number, number> = {};
      for (const [k, v] of Object.entries(tbl.counters)) if (Number(k) !== i) counters[shift(Number(k))] = v;
      tbl.counters = counters;
      tbl.touch();
      return emptyResult('ALTER', `Columna «${a.name}» borrada de «${tbl.name}»`, rt);
    }
    case 'rename_to': {
      if (rt.db.hasRelation(a.name) && lower(a.name) !== lower(tbl.name)) throw nameError(`Ya existe una tabla o vista llamada «${a.name}»`, undefined, st.pos);
      const old = tbl.name;
      rt.db.tables.delete(lower(old));
      tbl.name = a.name;
      rt.db.tables.set(lower(a.name), tbl);
      for (const t of rt.db.tables.values()) for (const f of t.fks) if (lower(f.refTable) === lower(old)) f.refTable = a.name;
      for (const tr of rt.db.triggers.values()) if (lower(tr.table) === lower(old)) tr.table = a.name;
      for (const ix of tbl.indexes) ix.table = a.name;
      return emptyResult('ALTER', `Tabla «${old}» renombrada a «${a.name}»`, rt);
    }
    case 'rename_column': {
      const i = tbl.colIndex(a.from);
      if (i < 0) throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.from}»`, undefined, st.pos);
      if (tbl.colIndex(a.to) >= 0 && lower(a.to) !== lower(a.from)) throw nameError(`Ya existe una columna «${a.to}» en «${tbl.name}»`, undefined, st.pos);
      tbl.cols[i].name = a.to;
      tbl.cols[i].default = tbl.cols[i].default ? renameInAst(tbl.cols[i].default!, a.from, a.to) : undefined;
      tbl.cols.forEach((c) => {
        if (c.generated) c.generated = renameInAst(c.generated, a.from, a.to);
      });
      tbl.checks = tbl.checks.map((c) => ({ ...c, e: renameInAst(c.e, a.from, a.to), col: c.col && lower(c.col) === lower(a.from) ? a.to : c.col }));
      tbl.indexes = tbl.indexes.map((x) => ({ ...x, exprs: x.exprs.map((e) => renameInAst(e, a.from, a.to)), where: x.where ? renameInAst(x.where, a.from, a.to) : undefined }));
      for (const t of rt.db.tables.values()) for (const f of t.fks) if (lower(f.refTable) === lower(tbl.name)) f.refCols = f.refCols.map((c) => (lower(c) === lower(a.from) ? a.to : c));
      return emptyResult('ALTER', `Columna «${a.from}» renombrada a «${a.to}»`, rt);
    }
    case 'alter_type': {
      const i = tbl.colIndex(a.col);
      if (i < 0) throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.col}»`, undefined, st.pos);
      const converted = tbl.rows.map((r) => castValue(r[i], a.type, a.col));
      tbl.rows.forEach((r, k) => (r[i] = converted[k]));
      tbl.cols[i].type = a.type;
      tbl.touch();
      return emptyResult('ALTER', `La columna «${a.col}» ahora es de tipo ${(a.type.raw || a.type.base).toUpperCase()}`, rt);
    }
    case 'set_default': {
      const i = tbl.colIndex(a.col);
      if (i < 0) throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.col}»`, undefined, st.pos);
      tbl.cols[i].default = a.e;
      return emptyResult('ALTER', a.e ? `Valor por defecto de «${a.col}» cambiado` : `Valor por defecto de «${a.col}» quitado`, rt);
    }
    case 'set_not_null': {
      const i = tbl.colIndex(a.col);
      if (i < 0) throw nameError(`La tabla «${tbl.name}» no tiene ninguna columna «${a.col}»`, undefined, st.pos);
      if (a.on && tbl.rows.some((r) => r[i] === null)) throw constraintError(`No se puede poner NOT NULL en «${a.col}»: hay filas con NULL`, `Corrígelas antes: UPDATE ${tbl.name} SET ${a.col} = … WHERE ${a.col} IS NULL`);
      tbl.cols[i].notNull = a.on;
      return emptyResult('ALTER', a.on ? `«${a.col}» ahora es NOT NULL` : `«${a.col}» ahora admite NULL`, rt);
    }
    case 'add_constraint': {
      const k = a.c;
      if (k.k === 'primary' || k.k === 'unique') {
        const cols = colsOf(tbl, k.cols, k.k === 'primary' ? 'PRIMARY KEY' : 'UNIQUE');
        if (k.k === 'primary' && tbl.primary) throw syntaxError(`La tabla «${tbl.name}» ya tiene una clave primaria`, st.pos);
        const seen = new Set<string>();
        for (const r of tbl.rows) {
          const vals = cols.map((c) => r[c]);
          if (vals.some((v) => v === null)) {
            if (k.k === 'primary') throw constraintError('No se puede crear la clave primaria: hay filas con NULL en esas columnas');
            continue;
          }
          const key = rowKey(vals);
          if (seen.has(key)) throw constraintError(`No se puede añadir la restricción: ya hay valores repetidos (${vals.join(', ')})`);
          seen.add(key);
        }
        if (k.k === 'primary') cols.forEach((i) => (tbl.cols[i].notNull = true));
        tbl.uniques.push({ name: k.name, cols, primary: k.k === 'primary' });
        tbl.touch();
        return emptyResult('ALTER', `Restricción ${k.k === 'primary' ? 'PRIMARY KEY' : 'UNIQUE'} añadida a «${tbl.name}»`, rt);
      }
      if (k.k === 'check') {
        const ce = compileExpr(k.e, ctxFor(rt, tableScope(tbl, tbl.name)));
        const bad = tbl.rows.find((r) => ce.ev({ row: r }) === false);
        if (bad) throw constraintError(`No se puede añadir el CHECK (${printExpr(k.e)}): hay filas que no lo cumplen`);
        tbl.checks.push({ e: k.e, name: k.name });
        return emptyResult('ALTER', `Restricción CHECK añadida a «${tbl.name}»`, rt);
      }
      const fk = makeFk(rt, tbl, colsOf(tbl, k.cols, 'FOREIGN KEY'), k.table, k.refCols, k.onDelete, k.onUpdate, k.name);
      const parent = rt.db.table(fk.refTable)!;
      const refIdx = fk.refCols.map((c) => parent.colIndex(c));
      const have = parent.hash(refIdx);
      for (const r of tbl.rows) {
        const vals = fk.cols.map((c) => r[c]);
        if (!vals.some((v) => v === null) && !have.has(rowKey(vals))) throw constraintError(`No se puede añadir la clave foránea: hay filas cuyo valor (${vals.join(', ')}) no existe en «${parent.name}»`);
      }
      tbl.fks.push(fk);
      return emptyResult('ALTER', `Clave foránea añadida a «${tbl.name}»`, rt);
    }
  }
}

// ───────────────────────── texto de la estructura ─────────────────────────

const typeText = (t: TypeName) => (t.raw ? `${t.raw.toUpperCase()}${t.len ? `(${t.len})` : ''}${t.scale != null ? `(${t.scale})` : ''}` : '');

/** CREATE TABLE equivalente de una tabla (para el comando .schema). */
export function createSql(tbl: Table): string {
  const pk = tbl.primary;
  const lines = tbl.cols.map((c, i) => {
    const bits = [`  ${c.name} ${typeText(c.type)}`.trimEnd()];
    if (pk && pk.cols.length === 1 && pk.cols[0] === i) bits.push('PRIMARY KEY');
    else if (c.notNull) bits.push('NOT NULL');
    if (tbl.uniques.some((u) => !u.primary && u.cols.length === 1 && u.cols[0] === i && !u.name)) bits.push('UNIQUE');
    if (c.default) bits.push(`DEFAULT ${printExpr(c.default)}`);
    if (c.generated) bits.push(`GENERATED ALWAYS AS (${printExpr(c.generated)}) STORED`);
    const chk = tbl.checks.find((k) => k.col === c.name);
    if (chk) bits.push(`CHECK (${printExpr(chk.e)})`);
    return bits.join(' ');
  });
  if (pk && pk.cols.length > 1) lines.push(`  PRIMARY KEY (${pk.cols.map((c) => tbl.cols[c].name).join(', ')})`);
  for (const u of tbl.uniques) if (!u.primary && (u.cols.length > 1 || u.name)) lines.push(`  ${u.name ? `CONSTRAINT ${u.name} ` : ''}UNIQUE (${u.cols.map((c) => tbl.cols[c].name).join(', ')})`);
  for (const k of tbl.checks) if (!k.col) lines.push(`  ${k.name ? `CONSTRAINT ${k.name} ` : ''}CHECK (${printExpr(k.e)})`);
  for (const f of tbl.fks) {
    const acts = `${f.onDelete !== 'no action' ? ` ON DELETE ${f.onDelete.toUpperCase()}` : ''}${f.onUpdate !== 'no action' ? ` ON UPDATE ${f.onUpdate.toUpperCase()}` : ''}`;
    lines.push(`  FOREIGN KEY (${f.cols.map((c) => tbl.cols[c].name).join(', ')}) REFERENCES ${f.refTable}(${f.refCols.join(', ')})${acts}`);
  }
  return `CREATE TABLE ${tbl.name} (\n${lines.join(',\n')}\n);`;
}

export type { Row, ScopeCol };
