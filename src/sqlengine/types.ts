/** Tipos comunes del motor de SQL. */

/** Un valor de SQL: NULL, número, texto o booleano. Las fechas son texto «AAAA-MM-DD» (o con hora). */
export type Value = null | number | string | boolean;

/** Tipo estático de una expresión (se conoce al compilar la consulta, no al ejecutarla). */
export type SqlType = 'int' | 'real' | 'text' | 'bool' | 'date' | 'timestamp' | 'null' | 'any';

export interface ResultColumn {
  name: string;
  type: SqlType;
}

export type CommandTag = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'DROP' | 'ALTER' | 'BEGIN' | 'COMMIT' | 'ROLLBACK' | 'SAVEPOINT' | 'RELEASE' | 'TRUNCATE' | 'EXPLAIN' | 'META' | 'SET';

export interface RunStats {
  /** Filas leídas de las tablas (para ver el efecto de un índice). */
  rowsRead: number;
  /** Índices que se usaron para buscar. */
  indexes: string[];
}

/** Resultado de una sentencia. */
export interface ResultSet {
  command: CommandTag;
  columns: ResultColumn[];
  rows: Value[][];
  /** Filas afectadas por INSERT/UPDATE/DELETE. */
  affected: number;
  /** Mensaje corto para el alumno («INSERT 3», «Tabla creada»…). */
  message: string;
  /** Texto con el plan de ejecución (EXPLAIN). */
  plan?: string[];
  stats: RunStats;
}

/** Error de SQL, con una pista para el alumno y la posición (índice en el texto) cuando se conoce. */
export class SqlError extends Error {
  hint?: string;
  pos?: number;
  /** Categoría para pruebas y comprobaciones: 'syntax' | 'name' | 'constraint' | 'type' | 'runtime' | 'tx' */
  kind: 'syntax' | 'name' | 'constraint' | 'type' | 'runtime' | 'tx';
  constructor(kind: SqlError['kind'], message: string, hint?: string, pos?: number) {
    super(message);
    this.name = 'SqlError';
    this.kind = kind;
    this.hint = hint;
    this.pos = pos;
  }
}

export const syntaxError = (message: string, pos?: number, hint?: string) => new SqlError('syntax', message, hint, pos);
export const nameError = (message: string, hint?: string, pos?: number) => new SqlError('name', message, hint, pos);
export const runtimeError = (message: string, hint?: string) => new SqlError('runtime', message, hint);
export const typeError = (message: string, hint?: string) => new SqlError('type', message, hint);
export const constraintError = (message: string, hint?: string) => new SqlError('constraint', message, hint);

/** Límites para que una consulta mal escrita no cuelgue la app. */
export const LIMITS = {
  maxRows: 200_000,
  maxRecursion: 2_000,
  maxJoinRows: 400_000,
  maxStatements: 200,
};
