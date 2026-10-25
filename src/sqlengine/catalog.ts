/** Base de datos en memoria: tablas, vistas, disparadores y los índices que se construyen cuando hacen falta. */
import type { Expr, Query, RefAction, Stmt, TypeName } from './ast';
import { rowKey } from './values';
import type { Value } from './types';

export type Row = Value[];

export interface Column {
  name: string;
  type: TypeName;
  notNull: boolean;
  autoinc: boolean;
  default?: Expr;
  generated?: Expr;
}

export interface UniqueDef {
  name?: string;
  cols: number[];
  primary: boolean;
}

export interface ForeignKey {
  name?: string;
  cols: number[];
  refTable: string;
  refCols: string[];
  onDelete: RefAction;
  onUpdate: RefAction;
}

export interface CheckDef {
  name?: string;
  e: Expr;
  /** Columna a la que pertenece (CHECK de columna), para el mensaje de error. */
  col?: string;
}

/** Índice creado con CREATE INDEX (los de PRIMARY KEY y UNIQUE se deducen de las restricciones). */
export interface IndexDef {
  name: string;
  table: string;
  /** Columnas simples (índices sobre expresiones guardan -1 y usan `exprs`). */
  cols: number[];
  exprs: Expr[];
  desc: boolean[];
  unique: boolean;
  where?: Expr;
}

export class Table {
  name: string;
  cols: Column[];
  rows: Row[] = [];
  uniques: UniqueDef[] = [];
  fks: ForeignKey[] = [];
  checks: CheckDef[] = [];
  indexes: IndexDef[] = [];
  /** Siguiente valor de cada columna autoincremental (por posición de columna). */
  counters: Record<number, number> = {};
  /** Se incrementa en cada cambio: invalida los índices en caché. */
  version = 0;
  private hashes = new Map<string, { version: number; map: Map<string, Row[]> }>();
  private sorts = new Map<number, { version: number; list: { key: Value; row: Row }[] }>();

  constructor(name: string, cols: Column[]) {
    this.name = name;
    this.cols = cols;
  }

  colIndex(name: string): number {
    const n = name.toLowerCase();
    return this.cols.findIndex((c) => c.name.toLowerCase() === n);
  }

  get primary(): UniqueDef | undefined {
    return this.uniques.find((u) => u.primary);
  }

  touch(): void {
    this.version++;
  }

  /** Filas agrupadas por el valor de las columnas dadas (sin las que tienen NULL en alguna). */
  hash(cols: number[]): Map<string, Row[]> {
    const id = cols.join(',');
    const hit = this.hashes.get(id);
    if (hit && hit.version === this.version) return hit.map;
    const map = new Map<string, Row[]>();
    for (const r of this.rows) {
      let nul = false;
      for (const c of cols) if (r[c] === null) nul = true;
      if (nul) continue;
      const k = rowKey(cols.map((c) => r[c]));
      const list = map.get(k);
      if (list) list.push(r);
      else map.set(k, [r]);
    }
    this.hashes.set(id, { version: this.version, map });
    return map;
  }

  /** Filas ordenadas por una columna (para buscar por rangos con búsqueda binaria). */
  sorted(col: number, cmp: (a: Value, b: Value) => number): { key: Value; row: Row }[] {
    const hit = this.sorts.get(col);
    if (hit && hit.version === this.version) return hit.list;
    const list = this.rows.filter((r) => r[col] !== null).map((row) => ({ key: row[col], row }));
    list.sort((a, b) => cmp(a.key, b.key));
    this.sorts.set(col, { version: this.version, list });
    return list;
  }

  /** ¿Hay un índice (de cualquier clase) que empiece por estas columnas? Devuelve su nombre. */
  indexFor(cols: number[]): string | undefined {
    const starts = (def: number[]) => cols.every((c, i) => def[i] === c);
    const pk = this.primary;
    if (pk && starts(pk.cols)) return `${this.name}_pkey`;
    for (const u of this.uniques) if (!u.primary && starts(u.cols)) return u.name ?? `${this.name}_${u.cols.map((c) => this.cols[c].name).join('_')}_key`;
    for (const ix of this.indexes) if (!ix.where && ix.exprs.length === 0 && starts(ix.cols)) return ix.name;
    return undefined;
  }

  clone(): Table {
    const t = new Table(this.name, this.cols.map((c) => ({ ...c })));
    t.rows = this.rows.map((r) => r.slice());
    t.uniques = this.uniques.map((u) => ({ ...u, cols: [...u.cols] }));
    t.fks = this.fks.map((f) => ({ ...f, cols: [...f.cols], refCols: [...f.refCols] }));
    t.checks = this.checks.map((c) => ({ ...c }));
    t.indexes = this.indexes.map((i) => ({ ...i, cols: [...i.cols], exprs: [...i.exprs], desc: [...i.desc] }));
    t.counters = { ...this.counters };
    return t;
  }
}

export interface View {
  name: string;
  q: Query;
  cols?: string[];
  sql: string;
}

export interface Trigger {
  name: string;
  table: string;
  timing: 'before' | 'after' | 'instead';
  event: 'insert' | 'update' | 'delete';
  when?: Expr;
  body: Stmt[];
}

export class Database {
  tables = new Map<string, Table>();
  views = new Map<string, View>();
  triggers = new Map<string, Trigger>();

  table(name: string): Table | undefined {
    return this.tables.get(name.toLowerCase());
  }

  view(name: string): View | undefined {
    return this.views.get(name.toLowerCase());
  }

  /** ¿Existe una tabla o vista con ese nombre? */
  hasRelation(name: string): boolean {
    return this.tables.has(name.toLowerCase()) || this.views.has(name.toLowerCase());
  }

  /** Todos los índices creados con CREATE INDEX, por nombre. */
  allIndexes(): IndexDef[] {
    return [...this.tables.values()].flatMap((t) => t.indexes);
  }

  clone(): Database {
    const d = new Database();
    for (const [k, t] of this.tables) d.tables.set(k, t.clone());
    for (const [k, v] of this.views) d.views.set(k, { ...v });
    for (const [k, t] of this.triggers) d.triggers.set(k, { ...t });
    return d;
  }
}
