/**
 * Autocompletado del editor de SQL (sin dependencias): según lo que se está escribiendo propone tablas (tras FROM/JOIN),
 * columnas (tras «tabla.» o en SELECT/WHERE…), funciones y palabras clave. Es una función pura.
 */
import type { Completion } from './pycomplete';

export interface SqlSchemaTable {
  name: string;
  cols: { name: string; type: string; pk?: boolean }[];
}
export interface SqlSchema {
  tables: SqlSchemaTable[];
}

const FUNCTIONS: [string, string][] = [
  ['COUNT', 'cuántas filas'], ['SUM', 'suma'], ['AVG', 'media'], ['MIN', 'el menor'], ['MAX', 'el mayor'],
  ['ROUND', 'redondea'], ['UPPER', 'MAYÚSCULAS'], ['LOWER', 'minúsculas'], ['LENGTH', 'longitud'], ['SUBSTR', 'trozo de texto'],
  ['TRIM', 'quita espacios'], ['REPLACE', 'cambia un trozo'], ['COALESCE', 'primer valor no nulo'], ['NULLIF', 'NULL si son iguales'],
  ['CAST', 'cambia de tipo'], ['ABS', 'valor absoluto'], ['DATE', 'fecha'], ['EXTRACT', 'parte de una fecha'], ['STRFTIME', 'formatea una fecha'],
  ['ROW_NUMBER', 'número de fila'], ['RANK', 'puesto con empates'], ['DENSE_RANK', 'puesto sin huecos'], ['LAG', 'valor anterior'], ['LEAD', 'valor siguiente'],
  ['STRING_AGG', 'une textos'], ['GROUP_CONCAT', 'une textos'], ['CONCAT', 'une textos'], ['FLOOR', 'hacia abajo'], ['CEIL', 'hacia arriba'],
];

const KEYWORDS = [
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'GROUP BY', 'HAVING', 'ORDER BY', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'USING', 'AS', 'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT', 'CASE WHEN', 'THEN', 'ELSE', 'END',
  'EXISTS', 'WITH', 'OVER', 'PARTITION BY', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'PRIMARY KEY', 'NOT NULL', 'DEFAULT', 'REFERENCES', 'RETURNING',
];

const TABLE_CONTEXT = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE']);
const IDENT = /[A-Za-z0-9_]/;

function inStringOrComment(text: string, cursor: number): boolean {
  const ls = text.lastIndexOf('\n', cursor - 1) + 1;
  const line = text.slice(ls, cursor);
  const dash = line.indexOf('--');
  if (dash >= 0 && ((line.slice(0, dash).match(/'/g) ?? []).length % 2 === 0)) return true;
  return (line.match(/'/g) ?? []).length % 2 === 1;
}

/** Tablas que aparecen tras FROM / JOIN en el texto, con su alias. */
export function tablesInQuery(text: string, schema?: SqlSchema): { table: SqlSchemaTable; alias: string }[] {
  if (!schema) return [];
  const out: { table: SqlSchemaTable; alias: string }[] = [];
  const re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([A-Za-z_][\w]*)(?:\s+(?:AS\s+)?([A-Za-z_][\w]*))?/gi;
  const stop = new Set(['WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'SET', 'VALUES', 'USING', 'UNION', 'HAVING', 'AS', 'NATURAL', 'OFFSET', 'SELECT', 'RETURNING', 'EXCEPT', 'INTERSECT']);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = schema.tables.find((x) => x.name.toLowerCase() === m![1].toLowerCase());
    if (!t) continue;
    const alias = m[2] && !stop.has(m[2].toUpperCase()) ? m[2] : t.name;
    out.push({ table: t, alias });
  }
  return out;
}

export function suggestSql(text: string, cursor: number, schema?: SqlSchema, max = 8): { start: number; items: Completion[] } {
  const c = Math.max(0, Math.min(cursor, text.length));
  let s = c;
  while (s > 0 && IDENT.test(text[s - 1])) s--;
  const prefix = text.slice(s, c);
  const none = { start: s, items: [] as Completion[] };
  if (inStringOrComment(text, c) || /^\d/.test(prefix)) return none;
  const p = prefix.toLowerCase();
  const items: Completion[] = [];
  const seen = new Set<string>();
  const add = (x: Completion) => {
    if (seen.has(x.label)) return;
    if (!x.label.toLowerCase().startsWith(p) || x.insert === prefix) return;
    seen.add(x.label);
    items.push(x);
  };
  const colItem = (name: string, type: string, pk?: boolean): Completion => ({ label: name, insert: name, kind: 'var', hint: `${pk ? '🔑 ' : ''}${type.toLowerCase() || 'columna'}` });
  const tabItem = (t: SqlSchemaTable): Completion => ({ label: t.name, insert: t.name, kind: 'cls', hint: 'tabla' });
  const before = text.slice(0, s);
  const inQuery = tablesInQuery(text, schema);

  // «tabla.» / «alias.» → columnas de esa tabla
  if (before.endsWith('.')) {
    const q = /([A-Za-z_]\w*)\.$/.exec(before);
    if (q) {
      const hit = inQuery.find((x) => x.alias.toLowerCase() === q[1].toLowerCase()) ?? inQuery.find((x) => x.table.name.toLowerCase() === q[1].toLowerCase()) ?? (schema ? { table: schema.tables.find((t) => t.name.toLowerCase() === q[1].toLowerCase())! } : undefined);
      if (hit?.table) for (const col of hit.table.cols) add(colItem(col.name, col.type, col.pk));
    }
    return { start: s, items: items.slice(0, max) };
  }

  // palabra clave anterior: decide si toca una tabla
  const words = [...before.matchAll(/[A-Za-z_]+|,|\(|\)/g)].map((m) => m[0]);
  let kwIdx = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    const u = words[i].toUpperCase();
    if (['SELECT', 'WHERE', 'ON', 'BY', 'HAVING', 'SET', 'VALUES', 'AND', 'OR', 'WHEN', 'THEN', 'ELSE', 'CASE'].includes(u) || TABLE_CONTEXT.has(u)) {
      kwIdx = i;
      break;
    }
  }
  const lastKw = kwIdx >= 0 ? words[kwIdx].toUpperCase() : '';
  const afterKw = kwIdx >= 0 ? words.slice(kwIdx + 1) : [];
  if (TABLE_CONTEXT.has(lastKw)) {
    const justTyped = afterKw.length === 0 || afterKw[afterKw.length - 1] === ',';
    if (justTyped && schema) {
      for (const t of schema.tables) add(tabItem(t));
      return { start: s, items: items.slice(0, max) };
    }
    // ya hay una tabla escrita: lo siguiente son palabras clave (WHERE, JOIN, ORDER BY…)
    if (prefix) for (const k of KEYWORDS) add({ label: k, insert: `${k} `, kind: 'kw' });
    return { start: s, items: items.slice(0, max) };
  }

  if (!prefix) return none;
  // columnas de las tablas de la consulta (o de todas si aún no hay FROM), funciones y palabras clave
  const sources = inQuery.length ? inQuery.map((x) => x.table) : schema?.tables ?? [];
  for (const t of sources) for (const col of t.cols) add(colItem(col.name, col.type, col.pk));
  for (const [f, hint] of FUNCTIONS) add({ label: f, insert: `${f}()`, caret: f.length + 1, kind: 'fn', hint });
  for (const k of KEYWORDS) add({ label: k, insert: `${k} `, kind: 'kw' });
  if (schema && !inQuery.length) for (const t of schema.tables) add(tabItem(t));
  return { start: s, items: items.slice(0, max) };
}

/** Atajos que se ofrecen cuando no hay nada que autocompletar. */
export const SQL_SNIPPETS: Completion[] = [
  { label: 'SELECT', insert: 'SELECT * FROM ', kind: 'snippet', hint: 'consultar' },
  { label: 'WHERE', insert: 'WHERE ', kind: 'snippet', hint: 'filtrar' },
  { label: 'GROUP BY', insert: 'GROUP BY ', kind: 'snippet', hint: 'agrupar' },
  { label: 'ORDER BY', insert: 'ORDER BY ', kind: 'snippet', hint: 'ordenar' },
  { label: 'JOIN', insert: 'JOIN  ON ', caret: 5, kind: 'snippet', hint: 'unir' },
  { label: 'LIMIT', insert: 'LIMIT ', kind: 'snippet' },
  { label: 'COUNT(*)', insert: 'COUNT(*)', kind: 'snippet' },
  { label: 'INSERT', insert: 'INSERT INTO  () VALUES ()', caret: 12, kind: 'snippet', hint: 'añadir' },
  { label: 'UPDATE', insert: 'UPDATE  SET  WHERE ', caret: 7, kind: 'snippet', hint: 'cambiar' },
  { label: 'DELETE', insert: 'DELETE FROM  WHERE ', caret: 12, kind: 'snippet', hint: 'borrar' },
];
