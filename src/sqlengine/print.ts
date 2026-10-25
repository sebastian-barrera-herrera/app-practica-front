/** Expresión → texto SQL (para nombres de columna, planes y mensajes). */
import type { Expr } from './ast';

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function printExpr(e: Expr): string {
  switch (e.k) {
    case 'lit':
      if (e.v === null) return 'NULL';
      if (typeof e.v === 'string') return quote(e.v);
      if (typeof e.v === 'boolean') return e.v ? 'true' : 'false';
      return e.t === 'real' && Number.isInteger(e.v) ? `${e.v}.0` : String(e.v);
    case 'col':
      return e.table ? `${e.table}.${e.name}` : e.name;
    case 'star':
      return e.table ? `${e.table}.*` : '*';
    case 'un':
      return e.op === 'not' ? `NOT ${printExpr(e.e)}` : `${e.op}${printExpr(e.e)}`;
    case 'bin':
      return `${printExpr(e.l)} ${e.op === 'and' || e.op === 'or' ? e.op.toUpperCase() : e.op} ${printExpr(e.r)}`;
    case 'isnull':
      return `${printExpr(e.e)} IS ${e.not ? 'NOT ' : ''}NULL`;
    case 'istruth':
      return `${printExpr(e.e)} IS ${e.not ? 'NOT ' : ''}${e.v ? 'TRUE' : 'FALSE'}`;
    case 'distinct':
      return `${printExpr(e.l)} IS ${e.not ? 'NOT ' : ''}DISTINCT FROM ${printExpr(e.r)}`;
    case 'between':
      return `${printExpr(e.e)} ${e.not ? 'NOT ' : ''}BETWEEN ${printExpr(e.lo)} AND ${printExpr(e.hi)}`;
    case 'in':
      return `${printExpr(e.e)} ${e.not ? 'NOT ' : ''}IN (${e.list.map(printExpr).join(', ')})`;
    case 'insub':
      return `${printExpr(e.e)} ${e.not ? 'NOT ' : ''}IN (SELECT …)`;
    case 'like':
      return `${printExpr(e.e)} ${e.not ? 'NOT ' : ''}${e.ci ? 'ILIKE' : 'LIKE'} ${printExpr(e.pat)}`;
    case 'exists':
      return `${e.not ? 'NOT ' : ''}EXISTS (SELECT …)`;
    case 'subq':
      return '(SELECT …)';
    case 'quant':
      return `${printExpr(e.e)} ${e.op} ${e.kind.toUpperCase()} (SELECT …)`;
    case 'case':
      return `CASE${e.operand ? ` ${printExpr(e.operand)}` : ''}${e.whens.map(([c, r]) => ` WHEN ${printExpr(c)} THEN ${printExpr(r)}`).join('')}${e.else ? ` ELSE ${printExpr(e.else)}` : ''} END`;
    case 'cast':
      return `CAST(${printExpr(e.e)} AS ${e.type.raw.toUpperCase()})`;
    case 'extract':
      return `EXTRACT(${e.field.toUpperCase()} FROM ${printExpr(e.e)})`;
    case 'rowv':
      return `(${e.items.map(printExpr).join(', ')})`;
    case 'fn': {
      if (e.name === '__interval') return `INTERVAL ${printExpr(e.args[0])}`;
      const inner = e.star ? '*' : `${e.distinct ? 'DISTINCT ' : ''}${e.args.map(printExpr).join(', ')}`;
      return `${e.name}(${inner})${e.over ? ' OVER (…)' : ''}`;
    }
  }
}

/** Nombre de la columna de resultado para una expresión sin alias. */
export function columnName(e: Expr): string {
  switch (e.k) {
    case 'col':
      return e.name;
    case 'fn':
      return e.name.startsWith('__') ? printExpr(e) : e.name;
    case 'cast':
      return e.e.k === 'col' ? e.e.name : e.type.raw.toLowerCase();
    case 'extract':
      return e.field.toLowerCase();
    case 'case':
      return 'case';
    case 'subq':
      return 'subquery';
    default:
      return printExpr(e);
  }
}

/** Clave estructural de una expresión (para comparar GROUP BY con SELECT, agregados repetidos…). */
export function exprKey(e: unknown): string {
  return JSON.stringify(e, (k, v) => (k === 'pos' ? undefined : typeof v === 'string' && k === 'name' ? v.toLowerCase() : v));
}
