import type { SqlRef } from '../reference';

export const SQL_REF_MASTERY: SqlRef[] = [
  {
    name: 'CREATE TRIGGER',
    kind: 'sentencia',
    category: 'modificar',
    level: 3,
    db: 'banco',
    summary: 'Define código SQL que la base de datos ejecuta automáticamente antes o después de un INSERT, UPDATE o DELETE.',
    usage: 'CREATE TRIGGER nombre {BEFORE|AFTER} {INSERT|UPDATE|DELETE} ON tabla\n  FOR EACH ROW [WHEN condición]\nBEGIN\n  sentencias;\nEND;\nDROP TRIGGER nombre;',
    details: 'Dentro del trigger, `NEW` es la fila nueva (INSERT/UPDATE) y `OLD` la antigua (UPDATE/DELETE). `BEFORE` sirve para validar y rechazar con `SELECT RAISE(ABORT, \'mensaje\')`; `AFTER` para auditar o mantener datos derivados (stock, historial). Son invisibles para quien lee el código de la aplicación: úsalos con moderación. En PostgreSQL el cuerpo es una función aparte (`EXECUTE FUNCTION`).',
    examples: [
      ['CREATE TABLE auditoria (id INTEGER PRIMARY KEY, cuenta_id INTEGER, antes REAL, despues REAL);\nCREATE TRIGGER trg_auditar AFTER UPDATE ON cuentas FOR EACH ROW WHEN OLD.saldo <> NEW.saldo BEGIN INSERT INTO auditoria (cuenta_id, antes, despues) VALUES (OLD.id, OLD.saldo, NEW.saldo); END;\nUPDATE cuentas SET saldo = saldo + 50 WHERE id = 1;\nSELECT * FROM auditoria;', 'Auditoría automática de cambios de saldo'],
    ],
    seeAlso: ['Restricciones', 'BEGIN / COMMIT / ROLLBACK'],
  },
  {
    name: 'Inyección SQL',
    kind: 'concepto',
    category: 'valores',
    level: 3,
    db: 'social',
    summary: 'Ataque que aprovecha el SQL construido pegando texto del usuario. Se evita con consultas parametrizadas y mínimo privilegio.',
    usage: "✗ \"… WHERE alias = '\" + entrada + \"'\"\n✓ \"… WHERE alias = $1\"  con los valores aparte",
    details: 'Si la entrada del usuario puede cerrar una comilla y añadir SQL, el atacante lee datos que no debe (`\' OR \'1\'=\'1`), se salta condiciones (`--`) o ejecuta otras sentencias (`; DROP TABLE …`). Defensas: **consultas parametrizadas** (la entrada es dato, nunca código), usuario de base de datos con **mínimo privilegio**, vistas que expongan solo lo necesario, validar entradas, lista blanca para nombres de columnas, no mostrar errores crudos y guardar contraseñas con hash y sal.',
    examples: [
      ["SELECT id, alias FROM usuarios WHERE alias = '' OR '1'='1';", 'Lo que recibe la base de datos con una entrada maliciosa: devuelve a todos'],
      ['CREATE VIEW perfil_publico AS SELECT alias, pais FROM usuarios;\nSELECT * FROM perfil_publico ORDER BY alias;', 'Defensa: exponer solo una vista con las columnas permitidas'],
    ],
    seeAlso: ['CREATE VIEW', 'Restricciones'],
  },
  {
    name: 'Dialectos SQL',
    kind: 'concepto',
    category: 'valores',
    level: 3,
    db: 'social',
    summary: 'SQL es un estándar pero cada motor tiene su dialecto. Escribe lo más estándar posible (COALESCE, CAST, FETCH FIRST, EXTRACT).',
    usage: 'LIMIT n  |  TOP n  |  FETCH FIRST n ROWS ONLY\nIFNULL  |  ISNULL  |  NVL  |  COALESCE',
    details: 'Paginación: `LIMIT` (PostgreSQL, MySQL, SQLite), `TOP` (SQL Server), `FETCH FIRST` (estándar, Oracle). Valor por defecto si NULL: `IFNULL` (MySQL/SQLite), `ISNULL` (SQL Server), `NVL` (Oracle) y `COALESCE` en todos. Concatenar: `||` o `CONCAT()` (con `||` un NULL contagia el resultado; `CONCAT` lo ignora). Autonumérico: `SERIAL`/`IDENTITY`/`AUTO_INCREMENT`/`AUTOINCREMENT`. Fechas: `EXTRACT` es estándar; `strftime`, `DATE_FORMAT`, `GETDATE` no. Aísla lo específico de un motor en un solo sitio.',
    examples: [
      ["SELECT COALESCE(pais, 'sin país') AS pais FROM usuarios ORDER BY id FETCH FIRST 3 ROWS ONLY;", 'Versión portable: COALESCE y FETCH FIRST'],
      ["SELECT alias || ' (' || pais || ')' AS con_barras, CONCAT(alias, ' (', pais, ')') AS con_concat FROM usuarios WHERE id IN (5, 6);", 'Diferencia clásica entre || y CONCAT con NULL'],
    ],
    seeAlso: ['COALESCE', 'EXTRACT', 'LIMIT y OFFSET'],
  },
];
