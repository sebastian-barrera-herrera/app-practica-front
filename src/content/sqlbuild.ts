/** Constructores para el curso de SQL (se combinan con los de `build.ts`: learn, mc, tf, order, match, fill, illus…). */
import type { SqlCheck, SqlSetup } from '@/sqlengine/judge';
import type { SqlCell, SqlChallenge, Step, WorldDef, CourseId } from './types';
import { world as baseWorld, type SqlPracticeInput } from './build';

/** Sentencia que falla a propósito (se muestra el error real). */
export const sqlErr = (sql: string, note?: string): SqlCell => ({ sql, note, error: true });

/**
 * Sentencias que se ejecutan en orden sobre la misma base de datos de ejemplo (lo que hace una sentencia lo ven las siguientes).
 * Cada celda: texto SQL, [texto, nota] o el resultado de `sqlErr(...)`.
 */
export const sqlDemo = (title: string, setup: SqlSetup | string, cells: (string | [string] | [string, string] | SqlCell)[], intro?: string): Step => ({
  type: 'sqldemo',
  title,
  intro,
  setup: typeof setup === 'string' ? { db: setup } : setup,
  cells: cells.map((c): SqlCell => (typeof c === 'string' ? { sql: c } : Array.isArray(c) ? { sql: c[0], note: c[1] } : c)),
});

/** Como `sqlDemo`, pero enseñando cuántas filas lee cada consulta (para ver el efecto de un índice). */
export const sqlPerf = (title: string, setup: SqlSetup | string, cells: Parameters<typeof sqlDemo>[2], intro?: string): Step => ({ ...sqlDemo(title, setup, cells, intro), stats: true }) as Step;

export const sqlPractice = (c: SqlPracticeInput): Step => ({ type: 'sqlpractice', challenge: { ...c, lang: 'sql', id: c.id ?? '', setup: norm(c.setup) } as SqlChallenge });

const norm = (s: SqlSetup | string): SqlSetup => (typeof s === 'string' ? { db: s } : s);

/** Escribir SQL dentro de un quiz (mini reto). */
export const sqlCode = (q: string, o: { setup: SqlSetup | string; starter?: string; check: SqlCheck; solution: string; hint?: string; why: string }): Step => ({
  type: 'quiz',
  q: { t: 'sqlcode', q, ...o, setup: norm(o.setup) },
});

/** Predecir lo que devuelve una consulta. `wrong` son resultados falsos escritos como las filas (una por línea, valores separados por « | »). */
export const sqlOut = (q: string, setup: SqlSetup | string, sql: string, wrong: string[], why: string): Step => ({
  type: 'quiz',
  q: { t: 'sqlout', q, setup: norm(setup), sql, wrong, why },
});

export const sqlWorld = (w: Omit<WorldDef, 'boss' | 'course'> & { boss?: SqlPracticeInput }): WorldDef => baseWorld({ ...w, course: 'sql' as CourseId });

// ───────── comprobaciones ─────────

type Extra = Pick<SqlCheck, 'names' | 'uses' | 'forbids' | 'indexes' | 'maxRead' | 'closed'>;

/** La consulta debe devolver lo mismo que la solución (en cualquier orden). */
export const same = (o: Extra = {}): SqlCheck => ({ mode: 'result', ...o });
/** Lo mismo, y además en el mismo orden. */
export const ordered = (o: Extra = {}): SqlCheck => ({ mode: 'result', ordered: true, ...o });
/** Las tablas deben quedar como con la solución (INSERT, UPDATE, DELETE, CREATE TABLE…). */
export const state = (tables?: string[], o: Extra = {}): SqlCheck => ({ mode: 'state', tables, ...o });
/** Resultado y estado. */
export const both = (tables?: string[], o: Extra = {}): SqlCheck => ({ mode: 'both', tables, ...o });
/** La sentencia debe fallar (con un mensaje que contenga `text`). */
export const fails = (text?: string): SqlCheck => ({ mode: 'error', error: text });
