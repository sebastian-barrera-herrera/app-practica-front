import { judge, sqlUses } from '../judge';
import { SqlSession } from '../index';

const fresh = (script = "CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT NOT NULL, v REAL); INSERT INTO t (n, v) VALUES ('a', 1), ('b', 2), ('c', 3);") => () => {
  const s = new SqlSession();
  const out = s.exec(script);
  if (out.error) throw out.error.error;
  return s;
};

describe('corrector: resultados', () => {
  test('cualquier forma equivalente vale, el orden solo importa si se pide', () => {
    const f = fresh();
    expect(judge(f, 'SELECT n, v FROM t WHERE v >= 2', 'SELECT n, v FROM t WHERE v > 1', { mode: 'result' }).ok).toBe(true);
    expect(judge(f, 'SELECT n FROM t ORDER BY n DESC', 'SELECT n FROM t ORDER BY n', { mode: 'result' }).ok).toBe(true);
    const r = judge(f, 'SELECT n FROM t ORDER BY n DESC', 'SELECT n FROM t ORDER BY n', { mode: 'result', ordered: true });
    expect(r.ok).toBe(false);
    expect(r.why).toContain('orden');
  });
  test('explica por qué falla', () => {
    const f = fresh();
    expect(judge(f, 'SELECT n FROM t', 'SELECT n, v FROM t', { mode: 'result' }).why).toContain('1 columna');
    expect(judge(f, 'SELECT n FROM t WHERE v > 1', 'SELECT n FROM t', { mode: 'result' }).why).toContain('2 filas');
    expect(judge(f, 'SELECT n AS x FROM t', 'SELECT n FROM t', { mode: 'result', names: true }).why).toContain('nombres de las columnas');
    expect(judge(f, 'SELEC n FROM t', 'SELECT n FROM t', { mode: 'result' }).error).toBeTruthy();
  });
  test('construcciones obligatorias y prohibidas', () => {
    const f = fresh();
    expect(judge(f, 'SELECT n FROM t', 'SELECT n FROM t', { mode: 'result', uses: ['WHERE'] }).why).toContain('WHERE');
    expect(judge(f, 'SELECT * FROM t', 'SELECT * FROM t', { mode: 'result', forbids: ['SELECT *'] }).ok).toBe(false);
    expect(sqlUses("SELECT 'JOIN' FROM t", 'JOIN')).toBe(false);
    expect(sqlUses('SELECT a FROM t JOIN u ON 1=1', 'JOIN')).toBe(true);
    expect(sqlUses('SELECT a FROM t WHERE a IN (SELECT 1)', 'SUBQUERY')).toBe(true);
  });
  test('modo error', () => {
    const f = fresh();
    expect(judge(f, 'INSERT INTO t (n) VALUES (NULL)', '', { mode: 'error', error: 'NULL' }).ok).toBe(true);
    expect(judge(f, 'SELECT 1', '', { mode: 'error' }).ok).toBe(false);
  });
});

describe('corrector: estado de la base de datos', () => {
  test('compara el contenido de las tablas', () => {
    const f = fresh();
    expect(judge(f, "UPDATE t SET v = 9 WHERE n = 'a'", "UPDATE t SET v = 9 WHERE id = 1", { mode: 'state', tables: ['t'] }).ok).toBe(true);
    const bad = judge(f, 'UPDATE t SET v = 9', "UPDATE t SET v = 9 WHERE id = 1", { mode: 'state', tables: ['t'] });
    expect(bad.ok).toBe(false);
    expect(bad.why).toContain('«t»');
    expect(judge(f, '', 'DELETE FROM t', { mode: 'state', tables: ['t'] }).why).toContain('0 filas');
  });
  test('la estructura no depende de cómo se escribió', () => {
    const f = fresh('SELECT 1');
    const sol = 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad INTEGER DEFAULT 0 CHECK (edad >= 0))';
    expect(judge(f, 'create table x (id int primary key, nombre text not null, edad integer check (edad >= 0) default 0)', sol, { mode: 'state', tables: ['x'] }).ok).toBe(true);
  });
  test('explica qué falta en la estructura', () => {
    const f = fresh('SELECT 1');
    const sol = 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad INTEGER, email TEXT UNIQUE)';
    const check = { mode: 'state' as const, tables: ['x'] };
    expect(judge(f, 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad INTEGER)', sol, check).why).toContain('falta la columna «email»');
    expect(judge(f, 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT, edad INTEGER, email TEXT UNIQUE)', sol, check).why).toContain('NOT NULL');
    expect(judge(f, 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad TEXT, email TEXT UNIQUE)', sol, check).why).toContain('tipo');
    expect(judge(f, 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad INTEGER, email TEXT)', sol, check).why).toContain('UNIQUE');
    expect(judge(f, 'CREATE TABLE x (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, edad INTEGER, email TEXT UNIQUE, extra INT)', sol, check).why).toContain('de más');
    expect(judge(f, '', sol, check).why).toContain('Falta la tabla');
  });
});

describe('corrector: rendimiento', () => {
  const big = () => fresh("CREATE TABLE v (id INTEGER PRIMARY KEY, cli INTEGER, f DATE); INSERT INTO v (cli, f) SELECT g % 50, '2024-01-01'::date + g FROM generate_series(1, 500) AS g;");
  test('los índices tienen que coincidir (el nombre da igual)', () => {
    const f = big();
    const check = { mode: 'state' as const, tables: ['v'], indexes: true };
    expect(judge(f, 'CREATE INDEX mi_indice ON v(cli)', 'CREATE INDEX idx_v_cli ON v(cli)', check).ok).toBe(true);
    expect(judge(f, '', 'CREATE INDEX idx_v_cli ON v(cli)', check).why).toContain('Falta un índice sobre v(cli)');
    expect(judge(f, 'CREATE INDEX a ON v(f)', 'CREATE INDEX idx_v_cli ON v(cli)', check).why).toContain('Falta un índice sobre v(cli)');
    expect(judge(f, 'CREATE INDEX a ON v(cli); CREATE INDEX b ON v(f)', 'CREATE INDEX idx_v_cli ON v(cli)', check).why).toContain('Sobra el índice sobre v(f)');
    expect(judge(f, 'CREATE INDEX a ON v(cli, f)', 'CREATE INDEX b ON v(f, cli)', check).ok).toBe(false);
    expect(judge(f, 'CREATE UNIQUE INDEX a ON v(f)', 'CREATE INDEX b ON v(f)', check).ok).toBe(false);
  });
  test('maxRead limita las filas leídas por la última consulta', () => {
    const f = big();
    const check = { mode: 'result' as const, maxRead: 20 };
    const sol = 'CREATE INDEX i ON v(cli); SELECT COUNT(*) FROM v WHERE cli = 7';
    expect(judge(f, sol, sol, check).ok).toBe(true);
    const slow = judge(f, 'SELECT COUNT(*) FROM v WHERE cli = 7', sol, check);
    expect(slow.ok).toBe(false);
    expect(slow.why).toContain('lee demasiadas filas');
    expect(slow.why).toContain('500');
  });
});

describe('corrector: transacciones', () => {
  const f = fresh("CREATE TABLE c (id INTEGER PRIMARY KEY, saldo REAL CHECK (saldo >= 0)); INSERT INTO c VALUES (1, 100), (2, 50);");
  test('closed exige COMMIT o ROLLBACK', () => {
    const sol = 'BEGIN; UPDATE c SET saldo = saldo - 10 WHERE id = 1; UPDATE c SET saldo = saldo + 10 WHERE id = 2; COMMIT;';
    const check = { mode: 'state' as const, tables: ['c'], closed: true };
    expect(judge(f, sol, sol, check).ok).toBe(true);
    const open = judge(f, sol.replace(' COMMIT;', ''), sol, check);
    expect(open.ok).toBe(false);
    expect(open.why).toContain('sigue abierta');
  });
  test('SELECT … FOR UPDATE se acepta y no cambia el resultado', () => {
    const s = f();
    const out = s.exec('BEGIN; SELECT * FROM c WHERE id = 1 FOR UPDATE; SELECT id FROM c ORDER BY id FOR SHARE NOWAIT; SELECT id FROM c FOR UPDATE OF c SKIP LOCKED; COMMIT;');
    expect(out.error).toBeUndefined();
    expect(out.results[1].rows).toEqual([[1, 100]]);
  });
});

describe('transacciones: modos', () => {
  test('ISOLATION LEVEL y READ ONLY', () => {
    const s = fresh()();
    let out = s.exec('BEGIN ISOLATION LEVEL SERIALIZABLE; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; COMMIT; START TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ WRITE; ROLLBACK;');
    expect(out.error).toBeUndefined();
    expect(out.results[0].message).toContain('SERIALIZABLE');
    out = s.exec('BEGIN READ ONLY; SELECT * FROM t; INSERT INTO t (n) VALUES (\'z\');');
    expect(out.error?.error.message).toContain('solo lectura');
    s.exec('ROLLBACK');
    expect(s.exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE').error?.error.message).toContain('dentro de una transacción');
  });
});
