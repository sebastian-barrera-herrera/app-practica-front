/**
 * Adaptador entre la interfaz y el motor de SQL (`src/sqlengine`). Carga el motor de forma perezosa (no pesa al arrancar)
 * y crea las sesiones con las bases de datos de ejemplo del curso.
 */
import { DATASETS } from '@/content/sql/datasets';
import type { Database } from '@/sqlengine/catalog';
import type { SqlSetup } from '@/sqlengine/judge';
import type { SqlSession } from '@/sqlengine/session';
import type { SqlSchema } from '@/ui/sqlcomplete';

type Engine = typeof import('@/sqlengine/session');
type Judge = typeof import('@/sqlengine/judge');

let engine: Engine | null = null;
let judgeMod: Judge | null = null;

/** El motor completo (se carga la primera vez que se necesita). */
export function sqlEngine(): Engine {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (engine ??= require('@/sqlengine/session') as Engine);
}

export function sqlJudge(): Judge {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (judgeMod ??= require('@/sqlengine/judge') as Judge);
}

const base = new Map<string, Database>();

/** Base de datos de ejemplo ya cargada (se construye una vez por proceso y se copia en cada uso). */
function baseDb(id: string): Database {
  let db = base.get(id);
  if (!db) {
    const ds = DATASETS[id];
    if (!ds) throw new Error(`Base de datos de ejemplo desconocida: ${id}`);
    const { SqlSession: S } = sqlEngine();
    const s = new S();
    const out = s.exec(ds.script);
    if (out.error) throw new Error(`La base de datos «${id}» no se pudo cargar: ${out.error.error.message}`);
    db = s.db;
    base.set(id, db);
  }
  return db;
}

/** Sesión nueva con la base de datos del ejercicio (y su preparación extra, si la tiene). */
export function newSqlSession(setup: SqlSetup): SqlSession {
  const { SqlSession: S } = sqlEngine();
  const s = new S();
  s.db = baseDb(setup.db).clone();
  if (setup.script) {
    const out = s.exec(setup.script);
    if (out.error) throw new Error(`La preparación del ejercicio falla: ${out.error.error.message}`);
  }
  return s;
}

/** Tablas y columnas de una base de datos (para el autocompletado y el explorador de tablas). */
export function schemaOf(db: Database): SqlSchema {
  return {
    tables: [...db.tables.values()].map((t) => ({
      name: t.name,
      cols: t.cols.map((c, i) => ({ name: c.name, type: c.type.raw ? c.type.raw.toUpperCase() : c.type.base, pk: !!t.primary?.cols.includes(i) })),
    })),
  };
}
