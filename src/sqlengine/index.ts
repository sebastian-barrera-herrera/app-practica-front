/** Motor de SQL propio (sin dependencias nativas): analiza y ejecuta SQL sobre una base de datos en memoria. */
export { SqlSession, DEFAULT_NOW, deserializeDb, renderTable, serializeDb, type ExecOutcome, type SessionOptions } from './session';
export { Database, Table } from './catalog';
export { parseScript } from './parser';
export { formatValue } from './values';
export { SqlError, type ResultSet, type ResultColumn, type SqlType, type Value } from './types';
