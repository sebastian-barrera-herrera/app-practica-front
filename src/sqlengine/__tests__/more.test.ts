import { SqlSession, deserializeDb, serializeDb } from '../index';
import { fails, rows, shop } from './helpers';

describe('índices y EXPLAIN', () => {
  const big = () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE big (id INTEGER PRIMARY KEY, name TEXT, grp INT)');
    s.exec("INSERT INTO big SELECT g, 'u' || g, g % 10 FROM generate_series(1, 2000) AS g");
    return s;
  };
  test('sin índice se lee toda la tabla; con índice solo lo necesario', () => {
    const s = big();
    let r = s.query('SELECT * FROM big WHERE grp = 3');
    expect(r.rows.length).toBe(200);
    expect(r.stats.rowsRead).toBe(2000);
    expect(r.stats.indexes).toEqual([]);
    s.exec('CREATE INDEX idx_grp ON big (grp)');
    r = s.query('SELECT * FROM big WHERE grp = 3');
    expect(r.rows.length).toBe(200);
    expect(r.stats.rowsRead).toBe(200);
    expect(r.stats.indexes).toEqual(['idx_grp']);
    r = s.query('SELECT name FROM big WHERE id = 1500');
    expect(r.rows).toEqual([['u1500']]);
    expect(r.stats.rowsRead).toBe(1);
    expect(r.stats.indexes).toEqual(['big_pkey']);
  });
  test('rangos y IN usan el índice y devuelven las filas en el orden de la tabla', () => {
    const s = big();
    let r = s.query('SELECT id FROM big WHERE id BETWEEN 10 AND 12');
    expect(r.rows).toEqual([[10], [11], [12]]);
    expect(r.stats.rowsRead).toBe(3);
    r = s.query('SELECT id FROM big WHERE id IN (30, 5, 5, 99999)');
    expect(r.rows).toEqual([[5], [30]]);
    r = s.query('SELECT id FROM big WHERE id > 1997');
    expect(r.rows).toEqual([[1998], [1999], [2000]]);
    expect(r.stats.rowsRead).toBe(3);
  });
  test('índice compuesto: igualdad en la primera columna y rango en la segunda se resuelven dentro del índice', () => {
    const s = big();
    s.exec('CREATE INDEX idx_gi ON big (grp, id)');
    const r = s.query('SELECT id FROM big WHERE grp = 3 AND id >= 1900 AND id < 1950');
    expect(r.rows).toEqual([[1903], [1913], [1923], [1933], [1943]]);
    expect(r.stats.rowsRead).toBe(5);
    expect(r.stats.indexes).toEqual(['idx_gi']);
    s.exec('DROP INDEX idx_gi');
    s.exec('CREATE INDEX idx_ig ON big (name, id)');
    expect(s.query("SELECT id FROM big WHERE grp = 3 AND name <> 'x'").stats.indexes).toEqual([]);
  });
  test('EXPLAIN enseña si se usa índice; EXPLAIN ANALYZE cuenta las filas leídas', () => {
    const s = big();
    let plan = s.query('EXPLAIN SELECT * FROM big WHERE grp = 3').plan!.join('\n');
    expect(plan).toContain('Escaneo completo de «big» (2000 filas)');
    s.exec('CREATE INDEX idx_grp ON big (grp)');
    plan = s.query('EXPLAIN SELECT * FROM big WHERE grp = 3').plan!.join('\n');
    expect(plan).toContain('Búsqueda en el índice «idx_grp»');
    const an = s.query('EXPLAIN ANALYZE SELECT * FROM big WHERE grp = 3').plan!.join('\n');
    expect(an).toContain('200 filas leídas');
  });
  test('el índice no cambia los resultados (valores de otro tipo, NULL)', () => {
    const s = big();
    s.exec('CREATE INDEX idx_name ON big (name)');
    expect(s.query("SELECT id FROM big WHERE name = 'u7'").rows).toEqual([[7]]);
    expect(s.query('SELECT id FROM big WHERE id = NULL').rows).toEqual([]);
    expect(s.query("SELECT id FROM big WHERE id = '7'").rows).toEqual([[7]]);
    expect(s.query('SELECT id FROM big WHERE id = 7.5').rows).toEqual([]);
  });
  test('un índice UNIQUE sobre una expresión y uno parcial', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE u (email TEXT); CREATE UNIQUE INDEX u_lower ON u (lower(email)); INSERT INTO u VALUES ('A@x.com')");
    expect(fails(s, "INSERT INTO u VALUES ('a@X.com')").kind).toBe('constraint');
    s.exec('CREATE TABLE addr (uid INT, is_default BOOLEAN); CREATE UNIQUE INDEX one_default ON addr (uid) WHERE is_default');
    s.exec('INSERT INTO addr VALUES (1, true), (1, false), (1, false), (2, true)');
    expect(fails(s, 'INSERT INTO addr VALUES (1, true)').kind).toBe('constraint');
  });
  test('crear un índice único con duplicados falla; DROP INDEX', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (a INT); INSERT INTO t VALUES (1),(1)');
    expect(fails(s, 'CREATE UNIQUE INDEX i ON t (a)').message).toContain('valores repetidos');
    s.exec('CREATE INDEX i2 ON t (a); DROP INDEX i2');
    expect(fails(s, 'DROP INDEX i2').message).toContain('No existe el índice');
  });
  test('EXPLAIN de una unión muestra el método', () => {
    const s = shop();
    const plan = s.query('EXPLAIN SELECT * FROM customers c JOIN orders o ON o.customer_id = c.id').plan!.join('\n');
    expect(plan).toContain('INNER JOIN');
    expect(plan).toContain('tabla hash');
  });
});

describe('fechas', () => {
  const s = new SqlSession();
  test('fecha de la sesión y aritmética', () => {
    expect(rows(s, 'SELECT CURRENT_DATE, DATE \'2024-01-31\' + 1, DATE \'2024-03-15\' - DATE \'2024-03-01\'')).toEqual([['2025-06-15', '2024-02-01', 14]]);
    expect(rows(s, "SELECT DATE '2024-01-31' + INTERVAL '1 month', DATE '2024-03-01' - INTERVAL '1 day'")).toEqual([['2024-02-29', '2024-02-29']]);
  });
  test('EXTRACT, date(), strftime, date_trunc y to_char', () => {
    expect(rows(s, "SELECT EXTRACT(YEAR FROM DATE '2024-03-15'), EXTRACT(MONTH FROM DATE '2024-03-15'), EXTRACT(DOW FROM DATE '2024-03-15')")).toEqual([[2024, 3, 5]]);
    expect(rows(s, "SELECT strftime('%Y-%m', '2024-03-15'), date('2024-03-15', '+1 month', 'start of month'), date_trunc('month', DATE '2024-03-15'), to_char(DATE '2024-03-15', 'DD/MM/YYYY')")).toEqual([['2024-03', '2024-04-01', '2024-03-01', '15/03/2024']]);
  });
  test('fecha no válida', () => {
    expect(fails(s, "SELECT CAST('2024-02-30' AS DATE)").message).toContain('Fecha no válida');
  });
});

describe('funciones de texto y números', () => {
  const s = new SqlSession();
  test('texto', () => {
    expect(
      rows(s, "SELECT length('hola'), substr('abcdef', 2, 3), replace('a-b-c','-','+'), trim('  x '), lpad('7',3,'0'), left('abc',2), right('abc',2), reverse('abc'), position('b' IN 'abc'), initcap('hello world'), split_part('a,b,c', ',', 2), concat('a', NULL, 'b'), 'a' || NULL, substring('abcdef' FROM 2 FOR 3)"),
    ).toEqual([[4, 'bcd', 'a+b+c', 'x', '007', 'ab', 'bc', 'cba', 2, 'Hello World', 'b', 'ab', null, 'bcd']]);
  });
  test('números', () => {
    expect(rows(s, 'SELECT round(2.5), round(-2.5), round(3.14159, 2), ceil(2.1), floor(-2.1), abs(-3), mod(10,3), power(2,10), sqrt(16), sign(-5), trunc(2.7)')).toEqual([[3, -3, 3.14, 3, -3, 3, 1, 1024, 4, -1, 2]]);
    expect(rows(s, 'SELECT greatest(1, 5, 3), least(4, 2, NULL), coalesce(NULL, NULL, 3)')).toEqual([[5, 2, 3]]);
  });
  test('expresiones regulares y GLOB', () => {
    expect(rows(s, "SELECT 'abc123' ~ '[0-9]+', 'ABC' ~* 'abc', 'abc' !~ 'z', 'file.txt' GLOB '*.txt', regexp_replace('a1b22', '[0-9]+', '#', 'g')")).toEqual([[true, true, true, true, 'a#b#']]);
  });
  test('funciones que no existen sugieren la correcta', () => {
    const e = fails(s, "SELECT UPPERCASE('x')");
    expect(e.message).toContain('No existe la función');
    expect(e.hint).toContain('UPPER');
    expect(fails(s, 'SELECT ROUND()').message).toContain('necesita');
  });
});

describe('agrupaciones avanzadas', () => {
  const t = new SqlSession();
  t.exec("CREATE TABLE s (a TEXT, b TEXT, n INT); INSERT INTO s VALUES ('x','p',1),('x','q',2),('y','p',4)");
  test('CUBE', () => {
    expect(rows(t, 'SELECT a, b, SUM(n) FROM s GROUP BY CUBE (a, b) ORDER BY a NULLS LAST, b NULLS LAST')).toEqual([
      ['x', 'p', 1], ['x', 'q', 2], ['x', null, 3], ['y', 'p', 4], ['y', null, 4], [null, 'p', 5], [null, 'q', 2], [null, null, 7],
    ]);
  });
  test('GROUPING SETS y GROUPING()', () => {
    expect(rows(t, 'SELECT a, GROUPING(a), SUM(n) FROM s GROUP BY ROLLUP (a) ORDER BY a NULLS LAST')).toEqual([['x', 0, 3], ['y', 0, 4], [null, 1, 7]]);
    expect(rows(t, 'SELECT a, b, SUM(n) FROM s GROUP BY GROUPING SETS ((a), (b)) ORDER BY a NULLS LAST, b NULLS LAST')).toEqual([['x', null, 3], ['y', null, 4], [null, 'p', 5], [null, 'q', 2]]);
  });
  test('DISTINCT ON', () => {
    const p = shop();
    expect(rows(p, 'SELECT DISTINCT ON (category) category, name FROM products ORDER BY category, price DESC')).toEqual([['accesorios', 'Cable'], ['pantallas', 'Monitor'], ['perifericos', 'Teclado']]);
  });
});

describe('utilidades', () => {
  test('.tables, .schema y PRAGMA table_info', () => {
    const s = shop();
    expect(rows(s, '.tables').map((r) => r[0])).toEqual(['customers', 'products', 'orders', 'order_items']);
    const schema = s.query('.schema products').rows[0][0] as string;
    expect(schema).toContain('CREATE TABLE products');
    expect(schema).toContain('price REAL NOT NULL CHECK (price > 0)');
    expect(rows(s, 'PRAGMA table_info(products)')[1]).toEqual([1, 'name', 'TEXT', 1, null, 0]);
  });
  test('guardar y recuperar la base de datos', () => {
    const s = shop();
    s.exec('CREATE INDEX i ON orders (status); CREATE VIEW v AS SELECT id FROM customers');
    const back = new SqlSession();
    back.db = deserializeDb(serializeDb(s.db));
    expect(rows(back, 'SELECT COUNT(*) FROM v')).toEqual([[4]]);
    expect(back.query("SELECT id FROM orders WHERE status = 'enviado'").stats.indexes).toEqual(['i']);
    expect(fails(back, "INSERT INTO customers (id, name) VALUES (1, 'x')").kind).toBe('constraint');
  });
  test('el motor no se cuelga con un producto cartesiano enorme', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE a (x INT)');
    s.exec('INSERT INTO a SELECT g FROM generate_series(1, 2000) AS g');
    const e = fails(s, 'SELECT COUNT(*) FROM a a1, a a2, a a3');
    expect(e.kind).toBe('runtime');
  });
});
