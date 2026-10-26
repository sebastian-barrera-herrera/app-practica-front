/** Árbol sintáctico de SQL. */
import type { SqlType, Value } from './types';

export interface TypeName {
  /** Nombre normalizado: int, real, text, bool, date, timestamp. */
  base: SqlType;
  /** Nombre tal como lo escribió el alumno (para mensajes): VARCHAR, DECIMAL… */
  raw: string;
  /** Longitud de VARCHAR(n) / CHAR(n). */
  len?: number;
  /** Decimales de NUMERIC(p, s). */
  scale?: number;
}

export type Expr =
  | { k: 'lit'; v: Value; t: SqlType; pos: number }
  | { k: 'col'; table?: string; name: string; quoted?: boolean; pos: number }
  | { k: 'star'; table?: string; pos: number }
  | { k: 'un'; op: '-' | '+' | 'not'; e: Expr; pos: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; pos: number }
  | { k: 'isnull'; e: Expr; not: boolean; pos: number }
  | { k: 'istruth'; e: Expr; v: boolean; not: boolean; pos: number }
  | { k: 'distinct'; l: Expr; r: Expr; not: boolean; pos: number }
  | { k: 'between'; e: Expr; lo: Expr; hi: Expr; not: boolean; pos: number }
  | { k: 'in'; e: Expr; list: Expr[]; not: boolean; pos: number }
  | { k: 'insub'; e: Expr; q: Query; not: boolean; pos: number }
  | { k: 'like'; e: Expr; pat: Expr; esc?: Expr; not: boolean; ci: boolean; pos: number }
  | { k: 'exists'; q: Query; not: boolean; pos: number }
  | { k: 'subq'; q: Query; pos: number }
  | { k: 'quant'; op: string; kind: 'any' | 'all'; e: Expr; q: Query; pos: number }
  | { k: 'case'; operand?: Expr; whens: [Expr, Expr][]; else?: Expr; pos: number }
  | { k: 'cast'; e: Expr; type: TypeName; pos: number }
  | { k: 'fn'; name: string; args: Expr[]; distinct: boolean; star: boolean; filter?: Expr; over?: WindowSpec | string; order?: OrderItem[]; sep?: Expr; pos: number }
  | { k: 'extract'; field: string; e: Expr; pos: number }
  | { k: 'rowv'; items: Expr[]; pos: number };

export interface OrderItem {
  e: Expr;
  desc: boolean;
  /** true = NULLS FIRST, false = NULLS LAST, undefined = el valor por defecto (los NULL cuentan como lo más grande). */
  nullsFirst?: boolean;
}

export interface FrameBound {
  kind: 'unbounded_preceding' | 'preceding' | 'current' | 'following' | 'unbounded_following';
  n?: Expr;
}

export interface WindowSpec {
  /** Nombre de otra ventana de la que hereda (WINDOW w AS (…) ). */
  base?: string;
  partition: Expr[];
  order: OrderItem[];
  frame?: { mode: 'rows' | 'range' | 'groups'; start: FrameBound; end: FrameBound };
}

export interface SelItem {
  e: Expr;
  alias?: string;
}

export type FromItem =
  | { k: 'table'; name: string; alias?: string; pos: number }
  | { k: 'sub'; q: Query; alias: string; cols?: string[] }
  | { k: 'func'; name: string; args: Expr[]; alias?: string; cols?: string[]; pos: number }
  | { k: 'values'; rows: Expr[][]; alias: string; cols?: string[] }
  | { k: 'join'; type: 'inner' | 'left' | 'right' | 'full' | 'cross'; l: FromItem; r: FromItem; on?: Expr; using?: string[]; natural: boolean; lateral?: boolean };

export interface Select {
  k: 'select';
  /** DISTINCT (true) o DISTINCT ON (expresiones). */
  distinct: boolean | Expr[];
  items: SelItem[];
  from?: FromItem;
  where?: Expr;
  groupBy?: Expr[];
  /** ROLLUP / CUBE / GROUPING SETS: conjuntos de agrupación ya expandidos (índices sobre `groupBy`). */
  groupingSets?: number[][];
  having?: Expr;
  windows?: Record<string, WindowSpec>;
  pos: number;
}

export interface SetOp {
  k: 'set';
  op: 'union' | 'intersect' | 'except';
  all: boolean;
  l: QueryBody;
  r: QueryBody;
}

export interface ValuesBody {
  k: 'values';
  rows: Expr[][];
}

/** Una consulta entre paréntesis dentro de una operación de conjuntos. */
export interface SubBody {
  k: 'sub';
  q: Query;
}

export type QueryBody = Select | SetOp | ValuesBody | SubBody;

export interface Cte {
  name: string;
  cols?: string[];
  q: Query;
}

export interface Query {
  with?: { recursive: boolean; ctes: Cte[] };
  body: QueryBody;
  order?: OrderItem[];
  limit?: Expr;
  offset?: Expr;
}

// ───────────────────────── sentencias ─────────────────────────

export interface ColumnDef {
  name: string;
  type: TypeName;
  notNull: boolean;
  primary: boolean;
  unique: boolean;
  autoinc: boolean;
  default?: Expr;
  check?: Expr;
  refs?: { table: string; column?: string; onDelete: RefAction; onUpdate: RefAction };
  /** Columna generada: GENERATED ALWAYS AS (expr) STORED */
  generated?: Expr;
}

export type RefAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default';

export type TableConstraint =
  | { k: 'primary'; cols: string[]; name?: string }
  | { k: 'unique'; cols: string[]; name?: string }
  | { k: 'check'; e: Expr; name?: string }
  | { k: 'foreign'; cols: string[]; table: string; refCols?: string[]; onDelete: RefAction; onUpdate: RefAction; name?: string };

export interface Assignment {
  col: string;
  e: Expr;
}

export type Stmt =
  | { k: 'query'; q: Query }
  | { k: 'insert'; table: string; cols?: string[]; source: { k: 'values'; rows: Expr[][] } | { k: 'query'; q: Query } | { k: 'default' }; conflict?: OnConflict; orAction?: 'replace' | 'ignore'; returning?: SelItem[]; pos: number }
  | { k: 'update'; table: string; alias?: string; sets: Assignment[]; from?: FromItem; where?: Expr; returning?: SelItem[]; pos: number }
  | { k: 'delete'; table: string; alias?: string; using?: FromItem; where?: Expr; returning?: SelItem[]; pos: number }
  | { k: 'create_table'; name: string; ifNotExists: boolean; temp: boolean; cols: ColumnDef[]; constraints: TableConstraint[]; as?: Query; pos: number }
  | { k: 'create_index'; name: string; table: string; cols: { e: Expr; desc: boolean }[]; unique: boolean; ifNotExists: boolean; where?: Expr; pos: number }
  | { k: 'create_view'; name: string; cols?: string[]; q: Query; ifNotExists: boolean; orReplace: boolean; sql: string; pos: number }
  | { k: 'create_trigger'; name: string; timing: 'before' | 'after' | 'instead'; event: 'insert' | 'update' | 'delete'; table: string; when?: Expr; body: Stmt[]; ifNotExists: boolean; pos: number }
  | { k: 'drop'; what: 'table' | 'index' | 'view' | 'trigger'; name: string; ifExists: boolean; cascade: boolean; pos: number }
  | { k: 'alter'; table: string; action: AlterAction; pos: number }
  | { k: 'truncate'; table: string; pos: number }
  | { k: 'tx'; op: 'begin' | 'commit' | 'rollback' | 'savepoint' | 'release' | 'rollback_to' | 'isolation'; name?: string; level?: string; readOnly?: boolean }
  | { k: 'explain'; stmt: Stmt; analyze: boolean }
  | { k: 'meta'; cmd: string; arg?: string }
  | { k: 'pragma'; name: string; arg?: string };

export interface OnConflict {
  /** Columnas del conflicto (vacío = cualquiera). */
  cols: string[];
  action: 'nothing' | 'update';
  sets?: Assignment[];
  where?: Expr;
}

export type AlterAction =
  | { op: 'add_column'; col: ColumnDef }
  | { op: 'drop_column'; name: string; ifExists: boolean }
  | { op: 'rename_to'; name: string }
  | { op: 'rename_column'; from: string; to: string }
  | { op: 'add_constraint'; c: TableConstraint }
  | { op: 'alter_type'; col: string; type: TypeName }
  | { op: 'set_default'; col: string; e?: Expr }
  | { op: 'set_not_null'; col: string; on: boolean };
