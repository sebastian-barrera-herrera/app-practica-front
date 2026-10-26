/**
 * Corrector de ejercicios de SQL. No compara el texto del alumno con la solución: ejecuta las dos sobre la misma base de
 * datos y compara lo que devuelven (o cómo queda la base de datos). Así cualquier forma correcta de escribir la consulta vale.
 */
import { tokenize } from './lexer';
import { renderTable, type SqlSession } from './session';
import { schemaSig } from './ddl';
import type { Table } from './catalog';
import { printExpr } from './print';
import { SqlError, type ResultSet, type Value } from './types';
import { formatValue } from './values';

/** Con qué base de datos se prepara un ejercicio. */
export interface SqlSetup {
  /** Identificador de la base de datos de ejemplo (tienda, cine…). */
  db: string;
  /** SQL extra que se ejecuta después de cargarla (para dejar el ejercicio preparado). */
  script?: string;
}

export interface SqlCheck {
  /**
   * result: la última consulta debe devolver lo mismo que la solución.
   * state: las tablas deben quedar igual que con la solución (INSERT, UPDATE, CREATE TABLE…).
   * both: las dos cosas. error: la sentencia debe fallar con un mensaje que contenga `error`.
   */
  mode: 'result' | 'state' | 'both' | 'error';
  /** El orden de las filas importa (cuando se pide ORDER BY). */
  ordered?: boolean;
  /** Los nombres de las columnas importan. */
  names?: boolean;
  /** Tablas que se comparan en `state` (por defecto, todas las de la solución). */
  tables?: string[];
  /** Palabras o construcciones que el SQL del alumno debe usar: 'JOIN', 'GROUP BY', 'SUBQUERY'… */
  uses?: string[];
  /** Construcciones que no se pueden usar. */
  forbids?: string[];
  /** Texto que debe contener el mensaje de error (modo `error`). */
  error?: string;
  /** En `state`: los índices (CREATE INDEX) también deben coincidir con los de la solución (tabla, columnas y UNIQUE; el nombre da igual). */
  indexes?: boolean;
  /** El SQL del alumno no puede dejar una transacción abierta (tiene que terminar con COMMIT o ROLLBACK). */
  closed?: boolean;
  /** La última consulta no puede leer más de estas filas de las tablas (se consigue con un buen índice o una consulta mejor escrita). */
  maxRead?: number;
}

export interface JudgeResult {
  ok: boolean;
  /** Qué falla (para enseñarlo al alumno). */
  why?: string;
  /** Resultado de la última sentencia del alumno. */
  result?: ResultSet;
  error?: SqlError;
  /** Texto del resultado esperado (para la pista «así debería verse»). */
  expected?: string;
  /** La base de datos del alumno después de ejecutar su SQL (para enseñar cómo quedaron las tablas). */
  session?: SqlSession;
}

// ───────────────────────── palabras usadas ─────────────────────────

/** ¿El SQL usa esa palabra o construcción? Ignora lo que está dentro de textos y comentarios. */
export function sqlUses(sql: string, what: string): boolean {
  let toks;
  try {
    toks = tokenize(sql);
  } catch {
    return false;
  }
  const words = toks.map((t) => (t.kind === 'id' ? t.text.toUpperCase() : t.kind === 'op' ? t.text : t.kind === 'str' ? "'" : t.kind === 'num' ? '#' : '"'));
  const target = what.toUpperCase();
  if (target === 'SUBQUERY') return words.some((w, i) => w === '(' && (words[i + 1] === 'SELECT' || words[i + 1] === 'WITH'));
  if (target === 'SELECT *') return words.some((w, i) => w === 'SELECT' && (words[i + 1] === '*' || (words[i + 1] === 'DISTINCT' && words[i + 2] === '*')));
  if (target === 'JOIN') return words.includes('JOIN');
  const parts = target.split(/\s+/);
  for (let i = 0; i + parts.length <= words.length; i++) if (parts.every((p, k) => words[i + k] === p)) return true;
  return false;
}

// ───────────────────────── comparación ─────────────────────────

const norm = (v: Value): string => {
  if (v === null) return 'N';
  if (typeof v === 'boolean') return `n${v ? 1 : 0}`;
  if (typeof v === 'number') return `n${Math.round(v * 1e9) / 1e9}`;
  return `s${v}`;
};

const rowText = (r: Value[], types: ResultSet['columns']): string => `(${r.map((v, i) => formatValue(v, types[i]?.type ?? 'any')).join(', ')})`;

/** Compara el resultado del alumno con el esperado. Devuelve null si coinciden o el motivo si no. */
export function diffResults(got: ResultSet, want: ResultSet, o: { ordered?: boolean; names?: boolean }): string | null {
  if (got.columns.length !== want.columns.length) {
    return `Tu consulta devuelve ${got.columns.length} columna${got.columns.length === 1 ? '' : 's'} y se esperaban ${want.columns.length}${want.columns.length <= 6 ? ` (${want.columns.map((c) => c.name).join(', ')})` : ''}.`;
  }
  if (o.names) {
    const a = got.columns.map((c) => c.name.toLowerCase());
    const b = want.columns.map((c) => c.name.toLowerCase());
    if (a.some((n, i) => n !== b[i])) return `Los nombres de las columnas deberían ser: ${want.columns.map((c) => c.name).join(', ')}.`;
  }
  const keyOf = (r: Value[]) => r.map(norm).join('\u0001');
  const g = got.rows.map(keyOf);
  const w = want.rows.map(keyOf);
  const counts = new Map<string, number>();
  for (const k of w) counts.set(k, (counts.get(k) ?? 0) + 1);
  const extra: number[] = [];
  g.forEach((k, i) => {
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else extra.push(i);
  });
  const missing: number[] = [];
  const seen = new Map<string, number>();
  for (const k of g) seen.set(k, (seen.get(k) ?? 0) + 1);
  w.forEach((k, i) => {
    const n = seen.get(k) ?? 0;
    if (n > 0) seen.set(k, n - 1);
    else missing.push(i);
  });
  if (extra.length || missing.length) {
    if (got.rows.length !== want.rows.length) {
      const detail = extra.length ? ` Por ejemplo, sobra ${rowText(got.rows[extra[0]], got.columns)}.` : missing.length ? ` Por ejemplo, falta ${rowText(want.rows[missing[0]], want.columns)}.` : '';
      return `Tu consulta devuelve ${got.rows.length} fila${got.rows.length === 1 ? '' : 's'} y se esperaban ${want.rows.length}.${detail}`;
    }
    if (extra.length && missing.length) return `Las filas no son las esperadas: no debería salir ${rowText(got.rows[extra[0]], got.columns)} y falta ${rowText(want.rows[missing[0]], want.columns)}.`;
    return 'Las filas no son las esperadas.';
  }
  if (o.ordered) {
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== w[i]) return `Las filas son las correctas pero no están en el orden pedido: en la posición ${i + 1} debería salir ${rowText(want.rows[i], want.columns)} y sale ${rowText(got.rows[i], got.columns)}.`;
    }
  }
  return null;
}

/** Texto de las tablas de la base de datos (para comparar estados). */
function stateOf(s: SqlSession, tables?: string[]): Map<string, { schema: string; rows: string[] }> {
  const out = new Map<string, { schema: string; rows: string[] }>();
  for (const t of s.db.tables.values()) {
    if (tables && !tables.some((n) => n.toLowerCase() === t.name.toLowerCase())) continue;
    out.set(t.name.toLowerCase(), { schema: schemaSig(t), rows: t.rows.map((r) => r.map(norm).join('\u0001')).sort() });
  }
  return out;
}

/** Explica en qué se diferencia la estructura de una tabla de la esperada (sin dar la solución completa). */
function describeSchemaDiff(got: Table, want: Table): string {
  const T = want.name;
  const gotNames = got.cols.map((c) => c.name.toLowerCase());
  const wantNames = want.cols.map((c) => c.name.toLowerCase());
  const missing = want.cols.filter((c) => !gotNames.includes(c.name.toLowerCase()));
  if (missing.length) return `A «${T}» le ${missing.length === 1 ? 'falta la columna' : 'faltan las columnas'} ${missing.map((c) => `«${c.name}»`).join(', ')}.`;
  const extra = got.cols.filter((c) => !wantNames.includes(c.name.toLowerCase()));
  if (extra.length) return `«${T}» tiene ${extra.length === 1 ? 'una columna' : 'columnas'} de más: ${extra.map((c) => `«${c.name}»`).join(', ')}.`;
  for (const w of want.cols) {
    const g = got.cols[got.colIndex(w.name)];
    if (g.type.base !== w.type.base) return `La columna «${w.name}» debería ser de tipo ${w.type.raw.toUpperCase() || w.type.base.toUpperCase()} (tiene ${g.type.raw.toUpperCase() || g.type.base.toUpperCase()}).`;
    if ((g.type.len ?? 0) !== (w.type.len ?? 0)) return `La columna «${w.name}» debería tener longitud ${w.type.len ?? 'sin límite'}.`;
    if (g.notNull !== w.notNull) return w.notNull ? `La columna «${w.name}» debería ser NOT NULL.` : `La columna «${w.name}» no debería ser NOT NULL.`;
    const gd = g.default ? printExpr(g.default) : '';
    const wd = w.default ? printExpr(w.default) : '';
    if (gd !== wd) return wd ? `La columna «${w.name}» debería tener DEFAULT ${wd}.` : `La columna «${w.name}» no debería tener DEFAULT.`;
  }
  if (gotNames.join() !== wantNames.join()) return `Las columnas de «${T}» deberían estar en este orden: ${want.cols.map((c) => c.name).join(', ')}.`;
  const ids = (t: Table) => (t.primary ? t.primary.cols.map((i) => t.cols[i].name.toLowerCase()).join(',') : '');
  if (ids(got) !== ids(want)) return want.primary ? `La clave primaria de «${T}» debería ser (${ids(want)}).` : `«${T}» no debería tener clave primaria.`;
  const uq = (t: Table) => t.uniques.filter((u) => !u.primary).length;
  if (uq(got) !== uq(want)) return uq(got) < uq(want) ? `Falta una restricción UNIQUE en «${T}».` : `Sobra una restricción UNIQUE en «${T}».`;
  if (got.checks.length !== want.checks.length) return got.checks.length < want.checks.length ? `Falta una restricción CHECK en «${T}».` : `Sobra una restricción CHECK en «${T}».`;
  if (got.fks.length !== want.fks.length) return got.fks.length < want.fks.length ? `Falta una clave foránea (REFERENCES) en «${T}».` : `Sobra una clave foránea en «${T}».`;
  const fkText = (t: Table) => t.fks.map((f) => `${f.refTable}:${f.onDelete}`).sort().join();
  if (fkText(got) !== fkText(want)) return `La clave foránea de «${T}» no es la esperada: revisa la tabla a la que apunta y su ON DELETE.`;
  return `Alguna restricción CHECK de «${T}» no es la esperada: revisa su condición.`;
}

/** Índices de una sesión como texto comparable: «tabla(col, col)» y «UNIQUE» si procede. */
function indexSigs(s: SqlSession, tables?: string[]): string[] {
  const out: string[] = [];
  for (const t of s.db.tables.values()) {
    if (tables && !tables.some((n) => n.toLowerCase() === t.name.toLowerCase())) continue;
    for (const ix of t.indexes) {
      const cols = ix.cols.map((i, k) => (i >= 0 ? t.cols[i].name.toLowerCase() : `expr${k}`)).map((c, k) => c + (ix.desc[k] ? ' desc' : ''));
      out.push(`${ix.unique ? 'UNIQUE ' : ''}${t.name.toLowerCase()}(${cols.join(', ')})${ix.where ? ' parcial' : ''}`);
    }
  }
  return out.sort();
}

function diffIndexes(user: SqlSession, want: SqlSession, tables?: string[]): string | null {
  const a = indexSigs(user, tables);
  const b = indexSigs(want, tables);
  const missing = b.find((x) => !a.includes(x));
  if (missing) return `Falta un índice sobre ${missing.replace(/^UNIQUE /, '')}${missing.startsWith('UNIQUE') ? ' (UNIQUE)' : ''}. Recuerda: el orden de las columnas importa.`;
  const extra = a.find((x) => !b.includes(x));
  if (extra) return `Sobra el índice sobre ${extra.replace(/^UNIQUE /, '')}: cada índice ralentiza las escrituras, crea solo los necesarios.`;
  return null;
}

function diffState(user: SqlSession, want: SqlSession, tables?: string[]): string | null {
  const a = stateOf(user, tables);
  const b = stateOf(want, tables);
  for (const [name, w] of b) {
    const g = a.get(name);
    const display = want.db.table(name)!.name;
    if (!g) return `Falta la tabla «${display}».`;
    if (g.schema !== w.schema) return describeSchemaDiff(user.db.table(name)!, want.db.table(name)!);
    if (g.rows.length !== w.rows.length) return `La tabla «${display}» debería tener ${w.rows.length} fila${w.rows.length === 1 ? '' : 's'} y tiene ${g.rows.length}.`;
    for (let i = 0; i < w.rows.length; i++) {
      if (g.rows[i] !== w.rows[i]) {
        const missing = w.rows.find((r) => !g.rows.includes(r));
        const t = want.db.table(name)!;
        const show = missing ? t.rows.find((r) => r.map(norm).join('\u0001') === missing) : undefined;
        return show ? `El contenido de «${display}» no es el esperado: falta la fila (${show.map((v) => formatValue(v, 'any')).join(', ')}).` : `El contenido de «${display}» no es el esperado.`;
      }
    }
  }
  for (const name of a.keys()) {
    if (!b.has(name) && !tables) return `Sobra la tabla «${user.db.table(name)!.name}».`;
  }
  return null;
}

// ───────────────────────── corrector ─────────────────────────

/**
 * Ejecuta el SQL del alumno y la solución sobre dos copias idénticas de la base de datos y compara.
 * `fresh` crea una sesión nueva con la base de datos del ejercicio.
 */
export function judge(fresh: () => SqlSession, userSql: string, solutionSql: string, check: SqlCheck): JudgeResult {
  const user = fresh();
  const out = user.exec(userSql);
  const last = out.results[out.results.length - 1];

  if (check.mode === 'error') {
    if (!out.error) return { ok: false, why: 'Se esperaba que esta sentencia diera un error, pero se ejecutó sin problemas.', result: last, session: user };
    const msg = `${out.error.error.message} ${out.error.error.hint ?? ''}`.toLowerCase();
    if (check.error && !msg.includes(check.error.toLowerCase())) return { ok: false, why: `Da un error, pero no el esperado (se buscaba «${check.error}»): ${out.error.error.message}`, error: out.error.error, session: user };
    return { ok: true, error: out.error.error, session: user };
  }
  if (out.error) return { ok: false, error: out.error.error, result: last, why: out.error.error.message, session: user };

  if (check.closed && user.inTransaction) return { ok: false, result: last, why: 'La transacción sigue abierta: termínala con COMMIT (para confirmar los cambios) o con ROLLBACK (para deshacerlos).', session: user };

  // construcciones obligatorias o prohibidas
  for (const w of check.uses ?? []) if (!sqlUses(userSql, w)) return { ok: false, result: last, why: `Para este reto tienes que usar ${friendly(w)}.`, session: user };
  for (const w of check.forbids ?? []) if (sqlUses(userSql, w)) return { ok: false, result: last, why: `En este reto no se puede usar ${friendly(w)}.`, session: user };

  const want = fresh();
  const wantOut = want.exec(solutionSql);
  if (wantOut.error) throw new Error(`La solución de referencia falla: ${wantOut.error.error.message} — ${solutionSql}`);
  const wantLast = wantOut.results[wantOut.results.length - 1];

  if (check.mode === 'result' || check.mode === 'both') {
    if (!last || !last.columns.length) return { ok: false, result: last, why: 'Tu SQL no devuelve ninguna tabla de resultados: termina con una consulta SELECT.', session: user };
    const d = diffResults(last, wantLast, { ordered: check.ordered, names: check.names });
    if (d) return { ok: false, why: d, result: last, expected: renderTable(wantLast), session: user };
  }
  if (check.mode === 'state' || check.mode === 'both') {
    const d = diffState(user, want, check.tables);
    if (d) return { ok: false, why: d, result: last, session: user };
  }
  if (check.indexes) {
    const d = diffIndexes(user, want, check.tables);
    if (d) return { ok: false, why: d, result: last, session: user };
  }
  if (check.maxRead !== undefined && last && last.stats.rowsRead > check.maxRead) {
    return { ok: false, why: `La consulta es correcta pero lee demasiadas filas: ${last.stats.rowsRead} (el límite es ${check.maxRead}). Mira el plan con EXPLAIN y ayuda al motor con un índice o escribiendo el filtro de otra forma.`, result: last, session: user };
  }
  return { ok: true, result: last, session: user };
}

function friendly(w: string): string {
  const u = w.toUpperCase();
  if (u === 'SUBQUERY') return 'una subconsulta';
  if (u === 'SELECT *') return 'SELECT *';
  return u;
}
