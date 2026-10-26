/** Sesión de SQL: una base de datos en memoria, transacciones y la ejecución de sentencias (una o varias). */
import type { Stmt } from './ast';
import { Database, Table } from './catalog';
import { createSql, execAlter, execCreateIndex, execCreateTable, execCreateTrigger, execCreateView, execDrop } from './ddl';
import { emptyResult, execDelete, execInsert, execTruncate, execUpdate, plural } from './dml';
import { parseScript } from './parser';
import { printExpr } from './print';
import type { Outer, Runtime } from './rt';
import { compileQuery } from './select';
import { LIMITS, SqlError, syntaxError, type ResultSet, type Value } from './types';
import { formatValue } from './values';

export interface SessionOptions {
  /** «Ahora» de la sesión (fijo para que los resultados se puedan repetir). */
  now?: string;
  seed?: number;
}

export interface ExecOutcome {
  results: ResultSet[];
  /** La sentencia que falló (las anteriores se ejecutaron). */
  error?: { error: SqlError; sql: string; offset: number };
}

export const DEFAULT_NOW = '2025-06-15 12:00:00';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MUTATING = new Set(['insert', 'update', 'delete', 'create_table', 'create_index', 'create_view', 'create_trigger', 'drop', 'alter', 'truncate']);

interface TxState {
  snap: Database;
  saves: { name: string; snap: Database }[];
  aborted: boolean;
  level?: string;
  readOnly?: boolean;
}

export class SqlSession {
  db = new Database();
  now: string;
  seed: number;
  tx: TxState | null = null;
  private rand: () => number;

  constructor(o: SessionOptions = {}) {
    this.now = o.now ?? DEFAULT_NOW;
    this.seed = o.seed ?? 42;
    this.rand = mulberry32(this.seed);
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  /** Ejecuta un texto con una o varias sentencias. Se detiene en la primera que falla. */
  exec(sql: string): ExecOutcome {
    const results: ResultSet[] = [];
    let parsed;
    try {
      parsed = parseScript(sql);
    } catch (e) {
      if (e instanceof SqlError) return { results, error: { error: e, sql, offset: 0 } };
      throw e;
    }
    if (parsed.length > LIMITS.maxStatements) return { results, error: { error: syntaxError(`Demasiadas sentencias de golpe (máximo ${LIMITS.maxStatements})`), sql, offset: 0 } };
    for (const p of parsed) {
      try {
        results.push(this.execOne(p.stmt));
      } catch (e) {
        if (e instanceof SqlError) {
          if (this.tx && e.kind !== 'tx') this.tx.aborted = true;
          return { results, error: { error: e, sql: p.sql, offset: p.pos } };
        }
        // un fallo inesperado del motor no debe tumbar la app: se enseña como error de ejecución
        const err = new SqlError('runtime', `Error interno del motor de SQL: ${e instanceof Error ? e.message : String(e)}`);
        if (this.tx) this.tx.aborted = true;
        return { results, error: { error: err, sql: p.sql, offset: p.pos } };
      }
    }
    return { results };
  }

  /** Ejecuta UNA sentencia y devuelve su resultado (lanza SqlError si falla). */
  query(sql: string): ResultSet {
    const out = this.exec(sql);
    if (out.error) throw out.error.error;
    if (!out.results.length) throw syntaxError('No hay ninguna sentencia que ejecutar');
    return out.results[out.results.length - 1];
  }

  private makeRuntime(plan?: string[]): Runtime {
    const rt: Runtime = {
      db: this.db,
      now: this.now,
      stats: { rowsRead: 0, indexes: [] },
      plan,
      depth: 0,
      cteCache: new Map(),
      cteWork: new Map(),
      rand: this.rand,
      nest: 0,
      budget: LIMITS.maxJoinRows * 4,
      execStmt: () => {
        throw syntaxError('Sentencia no disponible aquí');
      },
      trigDepth: 0,
    };
    rt.execStmt = (s, outer) => this.dispatch(s, rt, outer);
    return rt;
  }

  private execOne(stmt: Stmt): ResultSet {
    if (stmt.k === 'tx') return this.txControl(stmt);
    if (this.tx?.aborted) {
      throw new SqlError('tx', 'La transacción está abortada por un error anterior: se ignoran las órdenes hasta que la termines', 'Escribe ROLLBACK para deshacerla (o ROLLBACK TO nombre si usaste un SAVEPOINT)');
    }
    if (this.tx?.readOnly && MUTATING.has(stmt.k)) {
      throw new SqlError('tx', 'No se puede modificar nada en una transacción de solo lectura', 'Termínala con COMMIT o ROLLBACK y empieza otra sin READ ONLY');
    }
    const mutating = MUTATING.has(stmt.k) || (stmt.k === 'explain' && false);
    const before = mutating ? this.db.clone() : null;
    try {
      return this.dispatch(stmt, this.makeRuntime());
    } catch (e) {
      // una sentencia es atómica: si falla, no deja nada a medias
      if (before) this.db = before;
      throw e;
    }
  }

  private txControl(st: Extract<Stmt, { k: 'tx' }>): ResultSet {
    const rt = this.makeRuntime();
    switch (st.op) {
      case 'begin':
        if (this.tx) return emptyResult('BEGIN', 'Ya hay una transacción en curso: se ignora este BEGIN', rt);
        this.tx = { snap: this.db.clone(), saves: [], aborted: false, level: st.level, readOnly: st.readOnly };
        return emptyResult('BEGIN', `Transacción iniciada${st.level ? ` (${st.level})` : ''}${st.readOnly ? ' de solo lectura' : ''}: los cambios no son definitivos hasta COMMIT`, rt);
      case 'isolation':
        if (!this.tx) throw new SqlError('tx', 'SET TRANSACTION solo se puede usar dentro de una transacción', 'Empieza una con BEGIN (o con BEGIN ISOLATION LEVEL …)');
        if (st.level) this.tx.level = st.level;
        if (st.readOnly) this.tx.readOnly = true;
        return emptyResult('SET', `Nivel de aislamiento ${this.tx.level ?? 'por defecto'} anotado. Con una sola conexión no hay otras transacciones con las que chocar, así que no se nota la diferencia`, rt);
      case 'commit': {
        if (!this.tx) return emptyResult('COMMIT', 'No hay ninguna transacción abierta: no se hace nada', rt);
        if (this.tx.aborted) {
          this.db = this.tx.snap;
          this.tx = null;
          return emptyResult('ROLLBACK', 'La transacción estaba abortada por un error: COMMIT la deshace (equivale a ROLLBACK)', rt);
        }
        this.tx = null;
        return emptyResult('COMMIT', 'Transacción confirmada: los cambios son definitivos', rt);
      }
      case 'rollback':
        if (!this.tx) return emptyResult('ROLLBACK', 'No hay ninguna transacción abierta: no se hace nada', rt);
        this.db = this.tx.snap;
        this.tx = null;
        return emptyResult('ROLLBACK', 'Transacción deshecha: la base de datos vuelve a como estaba en el BEGIN', rt);
      case 'savepoint':
        if (!this.tx) throw new SqlError('tx', 'SAVEPOINT solo se puede usar dentro de una transacción', 'Empieza una con BEGIN');
        if (this.tx.aborted) throw new SqlError('tx', 'La transacción está abortada: haz ROLLBACK');
        this.tx.saves.push({ name: st.name!, snap: this.db.clone() });
        return emptyResult('SAVEPOINT', `Punto de guardado «${st.name}» creado`, rt);
      case 'release': {
        if (!this.tx) throw new SqlError('tx', 'RELEASE solo se puede usar dentro de una transacción');
        const i = this.tx.saves.map((s) => s.name.toLowerCase()).lastIndexOf(st.name!.toLowerCase());
        if (i < 0) throw new SqlError('tx', `No existe el punto de guardado «${st.name}»`, this.tx.saves.length ? `Puntos de guardado: ${this.tx.saves.map((s) => s.name).join(', ')}` : 'No has creado ninguno con SAVEPOINT');
        this.tx.saves.splice(i);
        return emptyResult('RELEASE', `Punto de guardado «${st.name}» liberado`, rt);
      }
      case 'rollback_to': {
        if (!this.tx) throw new SqlError('tx', 'ROLLBACK TO solo se puede usar dentro de una transacción');
        const i = this.tx.saves.map((s) => s.name.toLowerCase()).lastIndexOf(st.name!.toLowerCase());
        if (i < 0) throw new SqlError('tx', `No existe el punto de guardado «${st.name}»`, this.tx.saves.length ? `Puntos de guardado: ${this.tx.saves.map((s) => s.name).join(', ')}` : 'No has creado ninguno con SAVEPOINT');
        this.db = this.tx.saves[i].snap.clone();
        this.tx.saves.splice(i + 1);
        this.tx.aborted = false;
        return emptyResult('ROLLBACK', `Vuelves al punto de guardado «${st.name}»: lo hecho después se ha deshecho`, rt);
      }
    }
  }

  private dispatch(stmt: Stmt, rt: Runtime, outer?: Outer): ResultSet {
    switch (stmt.k) {
      case 'query': {
        const cq = compileQuery(stmt.q, outer?.scope, undefined, rt);
        const rows = cq.run(outer?.env);
        return { command: 'SELECT', columns: cq.cols.map((c) => ({ name: c.name, type: c.type })), rows, affected: rows.length, message: plural(rows.length, 'fila', 'filas'), stats: rt.stats };
      }
      case 'insert':
        return execInsert(stmt, rt, outer);
      case 'update':
        return execUpdate(stmt, rt, outer);
      case 'delete':
        return execDelete(stmt, rt, outer);
      case 'truncate':
        return execTruncate(stmt.table, rt, stmt.pos);
      case 'create_table':
        return execCreateTable(stmt, rt);
      case 'create_index':
        return execCreateIndex(stmt, rt);
      case 'create_view':
        return execCreateView(stmt, rt);
      case 'create_trigger':
        return execCreateTrigger(stmt, rt);
      case 'drop':
        return execDrop(stmt, rt);
      case 'alter':
        return execAlter(stmt, rt);
      case 'tx':
        throw new SqlError('tx', 'BEGIN, COMMIT y ROLLBACK no se pueden usar dentro de un disparador');
      case 'explain':
        return this.explain(stmt, rt);
      case 'meta':
        return this.meta(stmt.cmd, stmt.arg, rt);
      case 'pragma':
        return this.pragma(stmt.name, stmt.arg, rt);
    }
  }

  // ───────────────────────── EXPLAIN ─────────────────────────

  private explain(st: Extract<Stmt, { k: 'explain' }>, rt0: Runtime): ResultSet {
    void rt0;
    const plan: string[] = [];
    const rt = this.makeRuntime(plan);
    const inner = st.stmt;
    let q;
    if (inner.k === 'query') q = inner.q;
    else if (inner.k === 'update' || inner.k === 'delete') {
      const table = inner.table;
      q = { body: { k: 'select' as const, distinct: false, items: [{ e: { k: 'star' as const, pos: 0 } }], from: { k: 'table' as const, name: table, pos: 0 }, where: inner.where, pos: 0 } };
      plan.push(inner.k === 'update' ? `Actualizar filas de «${table}»` : `Borrar filas de «${table}»`);
      rt.depth = 1;
    } else if (inner.k === 'insert') {
      plan.push(`Insertar en «${inner.table}» (${inner.source.k === 'values' ? plural(inner.source.rows.length, 'fila', 'filas') : 'resultado de una consulta'})`);
    } else throw syntaxError('EXPLAIN solo se puede usar con SELECT, INSERT, UPDATE o DELETE');
    if (q) {
      const cq = compileQuery(q, undefined, undefined, rt);
      if (st.analyze) {
        const rows = cq.run();
        plan.push(`— Resultado real: ${plural(rows.length, 'fila', 'filas')}, ${plural(rt.stats.rowsRead, 'fila leída', 'filas leídas')} de las tablas${rt.stats.indexes.length ? ` (índices usados: ${rt.stats.indexes.join(', ')})` : ' (sin índices)'}`);
      }
    }
    return { command: 'EXPLAIN', columns: [{ name: 'plan de ejecución', type: 'text' }], rows: plan.map((l) => [l]), affected: plan.length, message: '', plan, stats: rt.stats };
  }

  // ───────────────────────── comandos de ayuda ─────────────────────────

  private meta(cmd: string, arg: string | undefined, rt: Runtime): ResultSet {
    const text = (rows: Value[][], cols: string[]): ResultSet => ({
      command: 'META',
      columns: cols.map((name) => ({ name, type: 'text' as const })),
      rows,
      affected: rows.length,
      message: '',
      stats: rt.stats,
    });
    switch (cmd) {
      case 'tables':
      case 'dt':
      case 'relations': {
        const rows: Value[][] = [...this.db.tables.values()].map((t) => [t.name, 'tabla', t.cols.length, t.rows.length]);
        for (const v of this.db.views.values()) rows.push([v.name, 'vista', null, null]);
        return { ...text(rows, ['nombre', 'tipo', 'columnas', 'filas']), columns: [{ name: 'nombre', type: 'text' }, { name: 'tipo', type: 'text' }, { name: 'columnas', type: 'int' }, { name: 'filas', type: 'int' }] };
      }
      case 'schema':
      case 'd': {
        if (arg) {
          const t = this.db.table(arg);
          if (t) return text([[createSql(t)]], ['definición']);
          const v = this.db.view(arg);
          if (v) return text([[`CREATE VIEW ${v.name} AS\n${v.sql};`]], ['definición']);
          throw syntaxError(`No existe la tabla o vista «${arg}»`);
        }
        const rows: Value[][] = [...this.db.tables.values()].map((t) => [createSql(t)]);
        for (const v of this.db.views.values()) rows.push([`CREATE VIEW ${v.name} AS\n${v.sql};`]);
        return text(rows, ['definición']);
      }
      case 'indexes':
      case 'indices':
      case 'di': {
        const rows: Value[][] = [];
        for (const t of this.db.tables.values()) {
          if (arg && t.name.toLowerCase() !== arg.toLowerCase()) continue;
          if (t.primary) rows.push([`${t.name}_pkey`, t.name, t.primary.cols.map((c) => t.cols[c].name).join(', '), 'clave primaria']);
          for (const u of t.uniques) if (!u.primary) rows.push([u.name ?? `${t.name}_${u.cols.map((c) => t.cols[c].name).join('_')}_key`, t.name, u.cols.map((c) => t.cols[c].name).join(', '), 'UNIQUE']);
          for (const i of t.indexes) rows.push([i.name, t.name, i.exprs.length ? i.exprs.map(printExpr).join(', ') : i.cols.map((c) => t.cols[c].name).join(', '), i.unique ? 'índice único' : 'índice']);
        }
        return text(rows, ['índice', 'tabla', 'columnas', 'tipo']);
      }
      case 'views':
        return text([...this.db.views.values()].map((v) => [v.name, v.sql]), ['vista', 'consulta']);
      case 'triggers':
        return text([...this.db.triggers.values()].map((t) => [t.name, t.table, `${t.timing.toUpperCase()} ${t.event.toUpperCase()}`]), ['disparador', 'tabla', 'cuándo']);
      case 'help':
      case 'ayuda':
        return text(
          [
            ['.tables', 'Lista las tablas y vistas'],
            ['.schema [tabla]', 'Muestra cómo está definida una tabla (o todas)'],
            ['.indexes [tabla]', 'Lista los índices'],
            ['.views', 'Lista las vistas'],
            ['.triggers', 'Lista los disparadores'],
            ['EXPLAIN SELECT …', 'Enseña cómo se ejecutaría una consulta'],
          ],
          ['comando', 'qué hace'],
        );
      default:
        throw syntaxError(`Comando desconocido «.${cmd}»`, undefined, 'Escribe .help para ver los comandos');
    }
  }

  private pragma(name: string, arg: string | undefined, rt: Runtime): ResultSet {
    if (name === 'table_info' && arg) {
      const t = this.db.table(arg);
      if (!t) throw syntaxError(`No existe la tabla «${arg}»`);
      const pk = t.primary?.cols ?? [];
      const rows: Value[][] = t.cols.map((c, i) => [i, c.name, (c.type.raw || '').toUpperCase(), c.notNull ? 1 : 0, c.default ? printExpr(c.default) : null, pk.includes(i) ? pk.indexOf(i) + 1 : 0]);
      return {
        command: 'META',
        columns: [{ name: 'cid', type: 'int' }, { name: 'name', type: 'text' }, { name: 'type', type: 'text' }, { name: 'notnull', type: 'int' }, { name: 'dflt_value', type: 'text' }, { name: 'pk', type: 'int' }],
        rows,
        affected: rows.length,
        message: '',
        stats: rt.stats,
      };
    }
    if (name === 'foreign_keys') return emptyResult('SET', 'Las claves foráneas siempre están activadas en este motor', rt);
    throw syntaxError(`PRAGMA «${name}» no está disponible`, undefined, 'Disponible: PRAGMA table_info(tabla)');
  }
}

// ───────────────────────── guardar y recuperar una base de datos ─────────────────────────

/** Convierte la base de datos en texto (para guardar el estado del laboratorio). */
export function serializeDb(db: Database): string {
  return JSON.stringify({
    tables: [...db.tables.values()].map((t) => ({ name: t.name, cols: t.cols, rows: t.rows, uniques: t.uniques, fks: t.fks, checks: t.checks, indexes: t.indexes, counters: t.counters })),
    views: [...db.views.values()],
    triggers: [...db.triggers.values()],
  });
}

export function deserializeDb(json: string): Database {
  const d = JSON.parse(json) as {
    tables: { name: string; cols: Table['cols']; rows: Table['rows']; uniques: Table['uniques']; fks: Table['fks']; checks: Table['checks']; indexes: Table['indexes']; counters: Table['counters'] }[];
    views: Database['views'] extends Map<string, infer V> ? V[] : never;
    triggers: Database['triggers'] extends Map<string, infer V> ? V[] : never;
  };
  const db = new Database();
  for (const t of d.tables) {
    const tbl = new Table(t.name, t.cols);
    tbl.rows = t.rows;
    tbl.uniques = t.uniques;
    tbl.fks = t.fks;
    tbl.checks = t.checks;
    tbl.indexes = t.indexes;
    tbl.counters = t.counters ?? {};
    db.tables.set(t.name.toLowerCase(), tbl);
  }
  for (const v of d.views) db.views.set(v.name.toLowerCase(), v);
  for (const t of d.triggers) db.triggers.set(t.name.toLowerCase(), t);
  return db;
}

/** Texto de un resultado como tabla de caracteres (para pruebas y para copiar). */
export function renderTable(r: ResultSet): string {
  if (!r.columns.length) return r.message;
  const cells = r.rows.map((row) => row.map((v, i) => formatValue(v, r.columns[i].type)));
  const widths = r.columns.map((c, i) => Math.max(c.name.length, ...cells.map((row) => row[i].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join(' | ').trimEnd();
  return [line(r.columns.map((c) => c.name)), widths.map((w) => '-'.repeat(w)).join('-+-'), ...cells.map(line)].join('\n');
}

/** El resultado como lo ven las opciones de «¿qué devuelve?»: una fila por línea, valores separados por « | » y sin cabecera. */
export function renderRows(r: ResultSet): string {
  if (!r.columns.length) return r.message;
  if (!r.rows.length) return '(ninguna fila)';
  return r.rows.map((row) => row.map((v, i) => formatValue(v, r.columns[i].type)).join(' | ')).join('\n');
}
