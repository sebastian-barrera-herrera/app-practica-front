/** Tipos internos que comparten el compilador de expresiones, las consultas y las sentencias de datos. */
import type { Query, Stmt, WindowSpec } from './ast';
import type { Database, Row, Table } from './catalog';
import type { ResultSet, RunStats, SqlType, Value } from './types';

/** Entorno de evaluación de una expresión: la fila actual y, si hace falta, lo que viene de fuera. */
export interface Env {
  row: Row;
  /** Fila de la consulta exterior (subconsultas correlacionadas, disparadores). */
  parent?: Env;
  /** Resultados de los agregados del grupo actual. */
  aggs?: Value[];
  /** Valores de las expresiones del GROUP BY del grupo actual. */
  keys?: Value[];
  /** Resultados de las funciones de ventana de esta fila. */
  wins?: Value[];
  /** Posiciones del GROUP BY que forman parte del conjunto de agrupación actual (ROLLUP/CUBE). */
  gset?: ReadonlySet<number>;
}

export type Ev = (e: Env) => Value;

/** Expresión compilada: cómo evaluarla y de qué tipo es. */
export interface CE {
  ev: Ev;
  type: SqlType;
}

export interface ScopeCol {
  name: string;
  table?: string;
  type: SqlType;
  /** Oculta a las búsquedas sin tabla (columna repetida en un USING/NATURAL). */
  hidden?: boolean;
  /** Tabla de origen y posición en ella (para saber si el GROUP BY cubre la clave primaria). */
  tbl?: Table;
  ci?: number;
  /** En un JOIN … USING de tipo RIGHT/FULL, posición de la otra columna con la que se completa un NULL. */
  alt?: number;
}

export interface Scope {
  cols: ScopeCol[];
  parent?: Scope;
  /** Alguna expresión de este bloque usa columnas de un bloque exterior (la subconsulta está correlacionada). */
  usedOuter?: boolean;
}

export interface CompiledQuery {
  cols: ScopeCol[];
  run: (env?: Env) => Row[];
  /** La consulta usa columnas del bloque que la contiene (hay que volver a ejecutarla por cada fila exterior). */
  correlated: boolean;
}

export interface CteDef {
  name: string;
  q: Query;
  cols?: string[];
  recursive: boolean;
}

export interface CteEntry {
  def: CteDef;
  /** Se está compilando el término recursivo: la CTE es la «tabla de trabajo» de la iteración. */
  work?: { cols: ScopeCol[] };
}

export interface CteScope {
  defs: Map<string, CteEntry>;
  parent?: CteScope;
}

/** Contexto exterior de una sentencia (las variables NEW y OLD de un disparador). */
export interface Outer {
  scope: Scope;
  env: Env;
}

export interface Runtime {
  db: Database;
  /** «Ahora» de la sesión (fijo, para que los resultados se puedan repetir). */
  now: string;
  stats: RunStats;
  /** Si está presente, el compilador añade aquí las líneas del plan (EXPLAIN). */
  plan?: string[];
  /** Nivel de sangría actual del plan. */
  depth: number;
  /** Resultados ya calculados de las CTE en esta ejecución. */
  cteCache: Map<CteDef, { cols: ScopeCol[]; rows: Row[] }>;
  /** Tabla de trabajo de una CTE recursiva mientras se itera. */
  cteWork: Map<CteDef, Row[]>;
  /** Generador pseudoaleatorio con semilla. */
  rand: () => number;
  /** Profundidad de vistas/CTE (para cortar ciclos). */
  nest: number;
  /** Filas procesadas: corta las consultas desbocadas. */
  budget: number;
  /** Ejecuta otra sentencia (los disparadores lanzan las de su cuerpo). */
  execStmt: (stmt: Stmt, outer?: Outer) => ResultSet;
  /** Profundidad de disparadores anidados. */
  trigDepth: number;
}

export interface Ctx {
  rt: Runtime;
  scope: Scope;
  ctes?: CteScope;
  /** 'row': se evalúa fila a fila. 'group': expresiones de un SELECT agrupado. */
  mode: 'row' | 'group';
  /** Cláusula que se está compilando (para los mensajes de error). */
  clause: 'select' | 'where' | 'group' | 'having' | 'order' | 'on' | 'other' | 'values';
  group?: GroupInfo;
  aggs?: AggRegistry;
  wins?: WinRegistry;
  /** Dentro de los argumentos de un agregado (no se pueden anidar). */
  inAgg?: boolean;
  /** Dentro de una función de ventana (no se pueden anidar). */
  inWin?: boolean;
  /** Alias de la lista del SELECT (para sugerir cuando se usan donde todavía no existen). */
  aliases?: string[];
  /** Ventanas con nombre (cláusula WINDOW). */
  namedWindows?: Record<string, WindowSpec>;
  /** Variables de disparador: NEW y OLD. */
  trigger?: boolean;
  compileQuery: (q: Query, scope: Scope | undefined, ctes: CteScope | undefined, rt: Runtime) => CompiledQuery;
}

export interface GroupInfo {
  /** Claves estructurales de las expresiones del GROUP BY. */
  keys: string[];
  /** Expresiones del GROUP BY compiladas (sobre las filas de entrada). */
  exprs: CE[];
  /** Columnas (tabla, posición) que son claves por sí solas. */
  cols: { tbl?: Table; ci?: number }[];
}

export interface AggSpec {
  name: string;
  args: CE[];
  distinct: boolean;
  filter?: CE;
  order?: { ce: CE; desc: boolean; nullsFirst?: boolean }[];
  star: boolean;
  type: SqlType;
}

export interface AggRegistry {
  list: AggSpec[];
  keys: string[];
}

export interface WinSpec {
  name: string;
  args: CE[];
  partition: CE[];
  order: { ce: CE; desc: boolean; nullsFirst?: boolean }[];
  frame?: { mode: 'rows' | 'range' | 'groups'; start: FrameB; end: FrameB };
  type: SqlType;
  star: boolean;
  distinct: boolean;
}

export type FrameB = { kind: 'unbounded_preceding' | 'preceding' | 'current' | 'following' | 'unbounded_following'; n?: number };

export interface WinRegistry {
  list: WinSpec[];
  keys: string[];
}
