import { SqlSession } from '../index';
import { fails, rows, shop } from './helpers';

describe('INSERT / UPDATE / DELETE', () => {
  test('INSERT con y sin columnas, varias filas, DEFAULT y autonumeración', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, n INT DEFAULT 7, created DATE DEFAULT CURRENT_DATE)");
    const out = s.exec("INSERT INTO t (name) VALUES ('a'), ('b'); INSERT INTO t (id, name, n) VALUES (10, 'c', 1); INSERT INTO t (name) VALUES ('d')");
    expect(out.results.map((r) => r.message)).toEqual(['2 filas insertadas', '1 fila insertada', '1 fila insertada']);
    expect(rows(s, 'SELECT id, name, n, created FROM t ORDER BY id')).toEqual([[1, 'a', 7, '2025-06-15'], [2, 'b', 7, '2025-06-15'], [10, 'c', 1, '2025-06-15'], [11, 'd', 7, '2025-06-15']]);
  });
  test('INSERT con número de valores equivocado explica qué pasa', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (a INT, b INT)');
    const e = fails(s, 'INSERT INTO t VALUES (1)');
    expect(e.message).toContain('2 columnas de destino pero 1 valor');
    expect(fails(s, 'INSERT INTO t (a, c) VALUES (1, 2)').message).toContain('no tiene ninguna columna «c»');
  });
  test('INSERT … SELECT y RETURNING', () => {
    const s = shop();
    s.exec('CREATE TABLE vips (id INT, name TEXT)');
    expect(rows(s, 'INSERT INTO vips SELECT id, name FROM customers WHERE vip RETURNING id, name')).toEqual([[1, 'Ana'], [3, 'Marta']]);
    expect(rows(s, 'SELECT COUNT(*) FROM vips')).toEqual([[2]]);
  });
  test('UPDATE con WHERE y expresiones que ven los valores antiguos', () => {
    const s = shop();
    const r = s.query("UPDATE products SET price = price * 2 WHERE category = 'perifericos'");
    expect(r.message).toBe('2 filas actualizadas');
    expect(rows(s, 'SELECT price FROM products WHERE id IN (1,2) ORDER BY id')).toEqual([[51], [24]]);
    s.exec('CREATE TABLE sw (a INT, b INT); INSERT INTO sw VALUES (1, 2)');
    s.exec('UPDATE sw SET a = b, b = a');
    expect(rows(s, 'SELECT a, b FROM sw')).toEqual([[2, 1]]);
  });
  test('UPDATE sin WHERE afecta a todas las filas; con RETURNING devuelve el nuevo valor', () => {
    const s = shop();
    expect(rows(s, "UPDATE customers SET city = 'Valencia' WHERE id = 4 RETURNING id, city")).toEqual([[4, 'Valencia']]);
    expect(s.query('UPDATE customers SET vip = true').affected).toBe(4);
  });
  test('UPDATE … FROM', () => {
    const s = shop();
    s.exec("UPDATE customers SET city = o.status FROM orders o WHERE o.customer_id = customers.id AND o.id = 3");
    expect(rows(s, 'SELECT city FROM customers WHERE id = 2')).toEqual([['enviado']]);
  });
  test('DELETE con WHERE y RETURNING', () => {
    const s = shop();
    expect(rows(s, "DELETE FROM order_items WHERE qty >= 5 RETURNING order_id, product_id")).toEqual([[3, 2], [3, 4]]);
    expect(s.query('DELETE FROM order_items').message).toBe('4 filas eliminadas');
  });
  test('DELETE … USING', () => {
    const s = shop();
    s.exec("DELETE FROM order_items USING orders o WHERE o.id = order_items.order_id AND o.status = 'cancelado'");
    expect(rows(s, 'SELECT COUNT(*) FROM order_items')).toEqual([[5]]);
  });
});

describe('restricciones', () => {
  test('NOT NULL', () => {
    const s = shop();
    const e = fails(s, 'INSERT INTO customers (id, name) VALUES (9, NULL)');
    expect(e.kind).toBe('constraint');
    expect(e.message).toContain('«name» de «customers» no admite NULL');
  });
  test('PRIMARY KEY y UNIQUE duplicados', () => {
    const s = shop();
    expect(fails(s, "INSERT INTO customers (id, name) VALUES (1, 'X')").message).toContain('Clave primaria duplicada');
    s.exec('CREATE TABLE u (email TEXT UNIQUE)');
    s.exec("INSERT INTO u VALUES ('a@x.com'), (NULL), (NULL)");
    const e = fails(s, "INSERT INTO u VALUES ('a@x.com')");
    expect(e.message).toContain('Valor duplicado');
    expect(e.message).toContain("email = 'a@x.com'");
  });
  test('clave primaria compuesta', () => {
    const s = shop();
    expect(fails(s, 'INSERT INTO order_items VALUES (1, 1, 3)').message).toContain('order_id = 1, product_id = 1');
  });
  test('CHECK', () => {
    const s = shop();
    const e = fails(s, "INSERT INTO products VALUES (9, 'Gratis', 0, 'x')");
    expect(e.message).toContain('CHECK (price > 0)');
    expect(fails(s, 'UPDATE products SET price = -1 WHERE id = 1').kind).toBe('constraint');
  });
  test('FOREIGN KEY al insertar, al borrar y la acción ON DELETE CASCADE', () => {
    const s = shop();
    const e = fails(s, "INSERT INTO orders VALUES (9, 99, '2025-05-01', 'x')");
    expect(e.message).toContain('Clave foránea');
    expect(e.hint).toContain('customers');
    const d = fails(s, 'DELETE FROM customers WHERE id = 1');
    expect(d.message).toContain('No se puede borrar');
    expect(d.hint).toContain('ON DELETE CASCADE');
    s.exec('CREATE TABLE p (id INT PRIMARY KEY); CREATE TABLE c (id INT, p_id INT REFERENCES p(id) ON DELETE CASCADE)');
    s.exec('INSERT INTO p VALUES (1),(2); INSERT INTO c VALUES (10,1),(11,1),(12,2)');
    s.exec('DELETE FROM p WHERE id = 1');
    expect(rows(s, 'SELECT id FROM c')).toEqual([[12]]);
  });
  test('ON DELETE SET NULL y ON UPDATE CASCADE', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE p (id INT PRIMARY KEY); CREATE TABLE c (id INT, p_id INT REFERENCES p(id) ON DELETE SET NULL ON UPDATE CASCADE)');
    s.exec('INSERT INTO p VALUES (1),(2); INSERT INTO c VALUES (10,1),(11,2)');
    s.exec('UPDATE p SET id = 5 WHERE id = 2');
    expect(rows(s, 'SELECT p_id FROM c ORDER BY id')).toEqual([[1], [5]]);
    s.exec('DELETE FROM p WHERE id = 1');
    expect(rows(s, 'SELECT p_id FROM c ORDER BY id')).toEqual([[null], [5]]);
  });
  test('un INSERT de varias filas es atómico: si una falla, no entra ninguna', () => {
    const s = shop();
    expect(fails(s, "INSERT INTO customers (id, name) VALUES (7, 'ok'), (1, 'repetido')").kind).toBe('constraint');
    expect(rows(s, 'SELECT COUNT(*) FROM customers')).toEqual([[4]]);
  });
  test('tipos: texto en una columna entera y VARCHAR demasiado largo', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (n INTEGER, s VARCHAR(3), d DATE, b BOOLEAN)');
    expect(fails(s, "INSERT INTO t (n) VALUES ('abc')").message).toContain('Sintaxis de entrada no válida');
    expect(fails(s, "INSERT INTO t (s) VALUES ('abcd')").message).toContain('demasiado largo');
    expect(fails(s, "INSERT INTO t (d) VALUES ('2025-13-40')").message).toContain('Fecha no válida');
    s.exec("INSERT INTO t VALUES ('42', 'ab', '2025-1-5', 'yes')");
    expect(rows(s, 'SELECT n, s, d, b FROM t')).toEqual([[42, 'ab', '2025-01-05', true]]);
  });
});

describe('ON CONFLICT (upsert) y REPLACE', () => {
  test('DO NOTHING y DO UPDATE con excluded', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE inv (sku TEXT PRIMARY KEY, qty INT)");
    s.exec("INSERT INTO inv VALUES ('a', 5)");
    expect(s.query("INSERT INTO inv VALUES ('a', 9) ON CONFLICT (sku) DO NOTHING").message).toContain('0 filas insertadas');
    expect(rows(s, 'SELECT qty FROM inv')).toEqual([[5]]);
    s.exec("INSERT INTO inv VALUES ('a', 9), ('b', 1) ON CONFLICT (sku) DO UPDATE SET qty = inv.qty + excluded.qty");
    expect(rows(s, 'SELECT sku, qty FROM inv ORDER BY sku')).toEqual([['a', 14], ['b', 1]]);
  });
  test('INSERT OR REPLACE / OR IGNORE', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE k (id INT PRIMARY KEY, v TEXT); INSERT INTO k VALUES (1, 'a')");
    s.exec("INSERT OR REPLACE INTO k VALUES (1, 'nuevo')");
    s.exec("INSERT OR IGNORE INTO k VALUES (1, 'otro')");
    expect(rows(s, 'SELECT id, v FROM k')).toEqual([[1, 'nuevo']]);
  });
});

describe('DDL', () => {
  test('CREATE, ALTER y DROP', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE t (id INT PRIMARY KEY, a TEXT); INSERT INTO t VALUES (1, 'x')");
    s.exec("ALTER TABLE t ADD COLUMN b INT DEFAULT 5");
    expect(rows(s, 'SELECT * FROM t')).toEqual([[1, 'x', 5]]);
    s.exec('ALTER TABLE t RENAME COLUMN a TO nombre; ALTER TABLE t RENAME TO t2');
    expect(rows(s, 'SELECT nombre FROM t2')).toEqual([['x']]);
    s.exec('ALTER TABLE t2 DROP COLUMN b');
    expect(rows(s, 'SELECT * FROM t2')).toEqual([[1, 'x']]);
    expect(fails(s, 'ALTER TABLE t2 ADD COLUMN c INT NOT NULL').hint).toContain('DEFAULT');
    s.exec('DROP TABLE t2');
    expect(fails(s, 'SELECT * FROM t2').message).toContain('No existe la tabla');
    s.exec('DROP TABLE IF EXISTS t2');
  });
  test('CREATE TABLE repetida, IF NOT EXISTS y DROP con dependencias', () => {
    const s = shop();
    expect(fails(s, 'CREATE TABLE customers (a INT)').hint).toContain('IF NOT EXISTS');
    expect(s.query('CREATE TABLE IF NOT EXISTS customers (a INT)').message).toContain('ya existe');
    const e = fails(s, 'DROP TABLE customers');
    expect(e.message).toContain('depende de ella');
    expect(e.hint).toContain('CASCADE');
    s.exec('DROP TABLE customers CASCADE');
    expect(s.db.table('customers')).toBeUndefined();
    expect(s.db.table('orders')!.fks.length).toBe(0);
  });
  test('CREATE TABLE AS SELECT, vistas y TRUNCATE', () => {
    const s = shop();
    s.exec("CREATE TABLE caros AS SELECT name, price FROM products WHERE price > 20");
    expect(rows(s, 'SELECT name FROM caros ORDER BY name')).toEqual([['Monitor'], ['Teclado']]);
    s.exec("CREATE VIEW madrid AS SELECT id, name FROM customers WHERE city = 'Madrid'");
    expect(rows(s, 'SELECT name FROM madrid ORDER BY id')).toEqual([['Ana'], ['Marta']]);
    s.exec("INSERT INTO customers (id, name, city) VALUES (9, 'Zoe', 'Madrid')");
    expect(rows(s, 'SELECT COUNT(*) FROM madrid')).toEqual([[3]]);
    expect(fails(s, 'INSERT INTO madrid VALUES (1, \'x\')').message).toContain('vista');
    expect(fails(s, 'DROP TABLE customers').message).toContain('la vista «madrid» la usa');
    s.exec('TRUNCATE TABLE caros');
    expect(rows(s, 'SELECT COUNT(*) FROM caros')).toEqual([[0]]);
  });
  test('ALTER TABLE: tipo, NOT NULL, CHECK y UNIQUE con datos existentes', () => {
    const s = new SqlSession();
    s.exec("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('1'),('2'),('2')");
    expect(fails(s, 'ALTER TABLE t ADD CONSTRAINT u UNIQUE (a)').message).toContain('valores repetidos');
    s.exec('ALTER TABLE t ALTER COLUMN a TYPE INTEGER');
    expect(rows(s, 'SELECT SUM(a) FROM t')).toEqual([[5]]);
    s.exec('ALTER TABLE t ADD CHECK (a > 0)');
    expect(fails(s, 'INSERT INTO t VALUES (-1)').kind).toBe('constraint');
    s.exec('INSERT INTO t VALUES (NULL)');
    expect(fails(s, 'ALTER TABLE t ALTER COLUMN a SET NOT NULL').message).toContain('hay filas con NULL');
  });
});

describe('transacciones', () => {
  test('COMMIT y ROLLBACK', () => {
    const s = shop();
    s.exec("BEGIN; DELETE FROM order_items; ROLLBACK");
    expect(rows(s, 'SELECT COUNT(*) FROM order_items')).toEqual([[6]]);
    s.exec("BEGIN; DELETE FROM order_items WHERE qty > 4; COMMIT");
    expect(rows(s, 'SELECT COUNT(*) FROM order_items')).toEqual([[4]]);
    expect(s.inTransaction).toBe(false);
  });
  test('SAVEPOINT y ROLLBACK TO', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (n INT); BEGIN; INSERT INTO t VALUES (1); SAVEPOINT a; INSERT INTO t VALUES (2); SAVEPOINT b; INSERT INTO t VALUES (3); ROLLBACK TO a; INSERT INTO t VALUES (4); COMMIT');
    expect(rows(s, 'SELECT n FROM t ORDER BY n')).toEqual([[1], [4]]);
  });
  test('un error dentro de una transacción la deja abortada hasta ROLLBACK', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (n INT PRIMARY KEY); BEGIN; INSERT INTO t VALUES (1)');
    expect(fails(s, 'INSERT INTO t VALUES (1)').kind).toBe('constraint');
    const e = fails(s, 'INSERT INTO t VALUES (2)');
    expect(e.kind).toBe('tx');
    expect(e.hint).toContain('ROLLBACK');
    s.exec('ROLLBACK');
    expect(rows(s, 'SELECT COUNT(*) FROM t')).toEqual([[0]]);
    expect(s.inTransaction).toBe(false);
  });
  test('DDL también se deshace', () => {
    const s = new SqlSession();
    s.exec('BEGIN; CREATE TABLE t (a INT); INSERT INTO t VALUES (1); ROLLBACK');
    expect(fails(s, 'SELECT * FROM t').message).toContain('No existe la tabla');
  });
  test('SAVEPOINT fuera de una transacción', () => {
    expect(fails(new SqlSession(), 'SAVEPOINT x').hint).toContain('BEGIN');
  });
});

describe('disparadores', () => {
  test('AFTER INSERT escribe en un registro de auditoría con NEW', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE t (id INT, v INT); CREATE TABLE log (msg TEXT)');
    s.exec("CREATE TRIGGER t_ai AFTER INSERT ON t FOR EACH ROW BEGIN INSERT INTO log VALUES ('nuevo ' || NEW.id); END");
    s.exec('INSERT INTO t VALUES (1, 10), (2, 20)');
    expect(rows(s, 'SELECT msg FROM log ORDER BY msg')).toEqual([['nuevo 1'], ['nuevo 2']]);
  });
  test('BEFORE UPDATE con RAISE rechaza el cambio; AFTER DELETE usa OLD', () => {
    const s = new SqlSession();
    s.exec('CREATE TABLE acc (id INT, bal INT); CREATE TABLE hist (id INT, old_bal INT)');
    s.exec("CREATE TRIGGER no_neg BEFORE UPDATE ON acc FOR EACH ROW WHEN NEW.bal < 0 BEGIN SELECT RAISE(ABORT, 'saldo negativo'); END");
    s.exec('CREATE TRIGGER del AFTER DELETE ON acc FOR EACH ROW BEGIN INSERT INTO hist VALUES (OLD.id, OLD.bal); END');
    s.exec('INSERT INTO acc VALUES (1, 100)');
    expect(fails(s, 'UPDATE acc SET bal = -5 WHERE id = 1').message).toContain('saldo negativo');
    s.exec('UPDATE acc SET bal = 50');
    s.exec('DELETE FROM acc');
    expect(rows(s, 'SELECT id, old_bal FROM hist')).toEqual([[1, 50]]);
  });
});
