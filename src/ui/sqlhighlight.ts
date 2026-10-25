/** Resaltado de sintaxis de SQL (tolerante: nunca falla, aunque el texto esté a medias). Devuelve los tramos de cada línea. */
import type { Tok, TokKind } from './pyhighlight';

/** Palabras que estructuran la consulta (van en color de «control»). */
export const CLAUSE_WORDS = new Set(
  `SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET FETCH JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL ON USING UNION INTERSECT EXCEPT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP ADD COLUMN INDEX VIEW TRIGGER WITH RECURSIVE OVER PARTITION WINDOW BEGIN COMMIT ROLLBACK SAVEPOINT RELEASE TRANSACTION EXPLAIN ANALYZE RETURNING CONFLICT DO TRUNCATE RENAME TO`.split(/\s+/),
);

/** Palabras de lógica, valores y modificadores (color de palabra clave). */
export const KEYWORDS = new Set(
  `AS AND OR NOT IN IS NULL LIKE ILIKE GLOB BETWEEN EXISTS CASE WHEN THEN ELSE END DISTINCT ALL ANY SOME TRUE FALSE ASC DESC NULLS FIRST LAST NEXT ONLY ROWS ROW RANGE GROUPS UNBOUNDED PRECEDING FOLLOWING CURRENT FILTER ROLLUP CUBE GROUPING SETS LATERAL UNIQUE PRIMARY KEY FOREIGN REFERENCES CHECK DEFAULT CONSTRAINT CASCADE RESTRICT NO ACTION IF NOTHING FOR EACH BEFORE AFTER INSTEAD OF WORK TEMP TEMPORARY REPLACE IGNORE ESCAPE INTERVAL NOTNULL ISNULL AUTOINCREMENT GENERATED ALWAYS STORED`.split(/\s+/),
);

export const TYPES = new Set(
  'INTEGER INT BIGINT SMALLINT TINYINT REAL FLOAT DOUBLE PRECISION NUMERIC DECIMAL TEXT VARCHAR CHAR CHARACTER VARYING BOOLEAN BOOL DATE TIMESTAMP DATETIME TIME SERIAL BIGSERIAL UUID JSON'.split(' '),
);

const RE = /(--[^\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|('(?:''|[^'])*'?)|("(?:""|[^"])*"?|`[^`]*`?)|(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_][\w$]*)|([ \t]+)|(\n)|(.)/g;

export function highlightSql(src: string): Tok[][] {
  const lines: Tok[][] = [[]];
  const push = (k: TokKind, s: string) => {
    if (!s) return;
    const parts = s.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ k, s: p });
    });
  };
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(src))) {
    const [tok, lineCom, blockCom, str, qid, num, word, ws, nl] = m;
    if (lineCom || blockCom) push('com', tok);
    else if (str) push('str', tok);
    else if (qid) push('text', tok);
    else if (num) push('num', tok);
    else if (word) {
      const u = word.toUpperCase();
      const call = /^\s*\(/.test(src.slice(RE.lastIndex, RE.lastIndex + 12));
      if (CLAUSE_WORDS.has(u) && !(call && (u === 'LEFT' || u === 'RIGHT' || u === 'REPLACE'))) push('dec', word);
      else if (KEYWORDS.has(u) && !(call && u === 'IN')) push('kw', word);
      else if (TYPES.has(u) && !call) push('cls', word);
      else if (call) push('fn', word);
      else push('text', word);
    } else if (ws) push('text', tok);
    else if (nl) push('text', '\n');
    else push('op', tok);
  }
  return lines;
}
