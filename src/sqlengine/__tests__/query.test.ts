import { SqlSession } from '../index';
import { fails, rows, shop } from './helpers';

describe('JOIN', () => {
  const s = shop();
  test('INNER JOIN con alias', () => {
    expect(rows(s, 'SELECT c.name, o.id FROM customers c JOIN orders o ON o.customer_id = c.id ORDER BY o.id')).toEqual([['Ana', 1], ['Ana', 2], ['Luis', 3], ['Marta', 4]]);
  });
  test('LEFT JOIN conserva los de la izquierda sin pareja', () => {
    expect(rows(s, 'SELECT c.name, o.id FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ORDER BY c.id, o.id')).toEqual([['Ana', 1], ['Ana', 2], ['Luis', 3], ['Marta', 4], ['Pablo', null]]);
    expect(rows(s, 'SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL')).toEqual([['Pablo']]);
  });
  test('RIGHT y FULL JOIN', () => {
    expect(rows(s, 'SELECT o.id, c.name FROM orders o RIGHT JOIN customers c ON o.customer_id = c.id ORDER BY c.id, o.id')).toEqual([[1, 'Ana'], [2, 'Ana'], [3, 'Luis'], [4, 'Marta'], [null, 'Pablo']]);
    const t = new SqlSession();
    t.exec('CREATE TABLE a (x INT); CREATE TABLE b (y INT); INSERT INTO a VALUES (1),(2); INSERT INTO b VALUES (2),(3)');
    expect(rows(t, 'SELECT x, y FROM a FULL JOIN b ON x = y ORDER BY x, y')).toEqual([[1, null], [2, 2], [null, 3]]);
  });
  test('USING y NATURAL JOIN unen columnas con el mismo nombre', () => {
    const t = new SqlSession();
    t.exec("CREATE TABLE a (id INT, n TEXT); CREATE TABLE b (id INT, m TEXT); INSERT INTO a VALUES (1,'x'),(2,'y'); INSERT INTO b VALUES (2,'p'),(3,'q')");
    expect(rows(t, 'SELECT * FROM a JOIN b USING (id)')).toEqual([[2, 'y', 'p']]);
    expect(rows(t, 'SELECT * FROM a NATURAL JOIN b')).toEqual([[2, 'y', 'p']]);
    expect(rows(t, 'SELECT * FROM a FULL JOIN b USING (id) ORDER BY id')).toEqual([[1, 'x', null], [2, 'y', 'p'], [3, null, 'q']]);
  });
  test('autounión y producto cartesiano', () => {
    expect(rows(s, 'SELECT a.name, b.name FROM customers a JOIN customers b ON a.city = b.city AND a.id < b.id')).toEqual([['Ana', 'Marta']]);
    expect(rows(s, 'SELECT COUNT(*) FROM customers CROSS JOIN products')).toEqual([[16]]);
    expect(rows(s, 'SELECT COUNT(*) FROM customers, products')).toEqual([[16]]);
  });
  test('varias tablas y agregados', () => {
    expect(
      rows(s, 'SELECT c.name, SUM(i.qty * p.price) AS total FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id GROUP BY c.name ORDER BY total DESC'),
    ).toEqual([['Ana', 249.49], ['Luis', 95], ['Marta', 25.5]]);
  });
  test('JOIN sin condición da un error claro y una columna ambigua también', () => {
    expect(fails(s, 'SELECT * FROM customers JOIN orders').message).toContain('necesita una condición');
    const e = fails(s, 'SELECT id FROM customers JOIN orders ON customer_id = customers.id');
    expect(e.message).toContain('ambigua');
    expect(e.hint).toContain('customers.id');
  });
});

describe('GROUP BY y agregados', () => {
  const s = shop();
  test('COUNT, SUM, AVG, MIN, MAX', () => {
    expect(rows(s, 'SELECT COUNT(*), COUNT(city), COUNT(DISTINCT city), MIN(price), MAX(price), SUM(price), AVG(price) FROM customers, products WHERE customers.id = 1 AND products.id < 5')).toEqual([[4, 4, 1, 3.5, 199.99, 240.99, 60.2475]]);
    expect(rows(s, 'SELECT COUNT(*), SUM(price), AVG(price), MAX(price) FROM products WHERE price > 1000')).toEqual([[0, null, null, null]]);
  });
  test('GROUP BY y HAVING', () => {
    expect(rows(s, 'SELECT category, COUNT(*) AS n FROM products GROUP BY category ORDER BY n DESC, category')).toEqual([['perifericos', 2], ['accesorios', 1], ['pantallas', 1]]);
    expect(rows(s, 'SELECT category FROM products GROUP BY category HAVING COUNT(*) > 1')).toEqual([['perifericos']]);
    expect(rows(s, 'SELECT category, COUNT(*) FROM products GROUP BY 1 ORDER BY 1')).toEqual([['accesorios', 1], ['pantallas', 1], ['perifericos', 2]]);
  });
  test('AVG de enteros es decimal y la división entera trunca', () => {
    expect(rows(s, 'SELECT AVG(qty), SUM(qty) / COUNT(*) FROM order_items')).toEqual([[3.3333333333333335, 3]]);
  });
  test('una columna fuera del GROUP BY da un error que enseña', () => {
    const e = fails(s, 'SELECT category, name, COUNT(*) FROM products GROUP BY category');
    expect(e.message).toContain('debe aparecer en la cláusula GROUP BY');
    expect(e.hint).toContain('MAX(name)');
  });
  test('agregado en WHERE: error con la pista de HAVING', () => {
    const e = fails(s, 'SELECT category FROM products WHERE COUNT(*) > 1 GROUP BY category');
    expect(e.hint).toContain('HAVING');
  });
  test('clave primaria en el GROUP BY permite las demás columnas de esa tabla', () => {
    expect(rows(s, 'SELECT c.name, COUNT(o.id) FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY c.id')).toEqual([['Ana', 2], ['Luis', 1], ['Marta', 1], ['Pablo', 0]]);
  });
  test('GROUP_CONCAT / STRING_AGG, FILTER y agregados booleanos', () => {
    expect(rows(s, "SELECT string_agg(name, ', ' ORDER BY name) FROM products")).toEqual([['Cable, Monitor, Ratón, Teclado']]);
    expect(rows(s, "SELECT COUNT(*) FILTER (WHERE price > 10), bool_and(price > 1), bool_or(price > 100) FROM products")).toEqual([[3, true, true]]);
  });
  test('ROLLUP añade subtotales', () => {
    expect(rows(s, 'SELECT category, COUNT(*) FROM products GROUP BY ROLLUP (category) ORDER BY category NULLS LAST')).toEqual([['accesorios', 1], ['pantallas', 1], ['perifericos', 2], [null, 4]]);
  });
});

describe('subconsultas', () => {
  const s = shop();
  test('escalar, IN, EXISTS y NOT EXISTS', () => {
    expect(rows(s, 'SELECT name FROM products WHERE price = (SELECT MAX(price) FROM products)')).toEqual([['Monitor']]);
    expect(rows(s, 'SELECT name FROM customers WHERE id IN (SELECT customer_id FROM orders) ORDER BY id')).toEqual([['Ana'], ['Luis'], ['Marta']]);
    expect(rows(s, 'SELECT name FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = \'enviado\') ORDER BY id')).toEqual([['Ana'], ['Luis']]);
    expect(rows(s, 'SELECT name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)')).toEqual([['Pablo']]);
  });
  test('NOT IN con NULL no devuelve nada (la trampa clásica)', () => {
    expect(rows(s, 'SELECT name FROM customers WHERE id NOT IN (SELECT customer_id FROM orders)')).toEqual([['Pablo']]);
    expect(rows(s, 'SELECT name FROM customers WHERE city NOT IN (SELECT city FROM customers WHERE id = 4)')).toEqual([]);
  });
  test('subconsulta correlacionada y tabla derivada', () => {
    expect(rows(s, 'SELECT p.name FROM products p WHERE p.price > (SELECT AVG(price) FROM products WHERE category = p.category)')).toEqual([['Teclado']]);
    expect(rows(s, 'SELECT t.cat, t.n FROM (SELECT category AS cat, COUNT(*) AS n FROM products GROUP BY category) t WHERE t.n > 1')).toEqual([['perifericos', 2]]);
    expect(rows(s, 'SELECT name, (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS pedidos FROM customers c ORDER BY id')).toEqual([['Ana', 2], ['Luis', 1], ['Marta', 1], ['Pablo', 0]]);
  });
  test('ANY / ALL', () => {
    expect(rows(s, 'SELECT name FROM products WHERE price > ALL (SELECT price FROM products WHERE category = \'perifericos\') ORDER BY id')).toEqual([['Monitor']]);
    expect(rows(s, 'SELECT name FROM products WHERE price = ANY (SELECT price FROM products WHERE category = \'accesorios\')')).toEqual([['Cable']]);
  });
  test('subconsulta escalar con varias filas da error', () => {
    expect(fails(s, 'SELECT (SELECT id FROM products)').message).toContain('más de una fila');
  });
});

describe('operaciones de conjuntos, CTE y VALUES', () => {
  const s = shop();
  test('UNION, UNION ALL, INTERSECT, EXCEPT', () => {
    expect(rows(s, "SELECT city FROM customers WHERE id <= 3 UNION SELECT city FROM customers WHERE id = 2 ORDER BY 1")).toEqual([['Madrid'], ['Sevilla']]);
    expect(rows(s, "SELECT city FROM customers WHERE id <= 3 UNION ALL SELECT city FROM customers WHERE id = 2")).toHaveLength(4);
    expect(rows(s, 'SELECT id FROM customers INTERSECT SELECT customer_id FROM orders ORDER BY 1')).toEqual([[1], [2], [3]]);
    expect(rows(s, 'SELECT id FROM customers EXCEPT SELECT customer_id FROM orders')).toEqual([[4]]);
  });
  test('UNION con columnas distintas da error', () => {
    expect(fails(s, 'SELECT id, name FROM customers UNION SELECT id FROM orders').message).toContain('mismo número de columnas');
  });
  test('WITH (CTE) y VALUES', () => {
    expect(rows(s, 'WITH caros AS (SELECT * FROM products WHERE price > 20) SELECT name FROM caros ORDER BY name')).toEqual([['Monitor'], ['Teclado']]);
    expect(rows(s, 'WITH a AS (SELECT 1 AS x), b AS (SELECT x + 1 AS y FROM a) SELECT x, y FROM a, b')).toEqual([[1, 2]]);
    expect(rows(s, 'SELECT * FROM (VALUES (1, \'a\'), (2, \'b\')) AS t(n, l) ORDER BY n DESC')).toEqual([[2, 'b'], [1, 'a']]);
  });
  test('CTE recursiva', () => {
    expect(rows(s, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT SUM(i), COUNT(*) FROM n')).toEqual([[15, 5]]);
    const t = new SqlSession();
    t.exec("CREATE TABLE emp (id INT, name TEXT, boss INT); INSERT INTO emp VALUES (1,'Jefa',NULL),(2,'Ana',1),(3,'Luis',2),(4,'Eva',2)");
    expect(
      rows(t, 'WITH RECURSIVE arbol(id, name, nivel) AS (SELECT id, name, 0 FROM emp WHERE boss IS NULL UNION ALL SELECT e.id, e.name, a.nivel + 1 FROM emp e JOIN arbol a ON e.boss = a.id) SELECT name, nivel FROM arbol ORDER BY nivel, name'),
    ).toEqual([['Jefa', 0], ['Ana', 1], ['Eva', 2], ['Luis', 2]]);
  });
  test('una CTE recursiva sin parada se corta con un mensaje', () => {
    const e = fails(s, 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n');
    expect(e.message).toContain('no termina');
    expect(e.hint).toContain('condición de parada');
  });
  test('generate_series', () => {
    expect(rows(s, 'SELECT SUM(g) FROM generate_series(1, 10) AS g')).toEqual([[55]]);
    expect(rows(s, 'SELECT * FROM generate_series(10, 1, -3)')).toEqual([[10], [7], [4], [1]]);
  });
});

describe('funciones de ventana', () => {
  const s = shop();
  test('ROW_NUMBER, RANK y DENSE_RANK', () => {
    const t = new SqlSession();
    t.exec("CREATE TABLE n (v INT); INSERT INTO n VALUES (10),(20),(20),(30)");
    expect(rows(t, 'SELECT v, ROW_NUMBER() OVER (ORDER BY v), RANK() OVER (ORDER BY v), DENSE_RANK() OVER (ORDER BY v) FROM n ORDER BY v')).toEqual([[10, 1, 1, 1], [20, 2, 2, 2], [20, 3, 2, 2], [30, 4, 4, 3]]);
  });
  test('PARTITION BY y totales acumulados', () => {
    expect(rows(s, 'SELECT id, category, price, SUM(price) OVER (PARTITION BY category ORDER BY id) AS acum FROM products ORDER BY id')).toEqual([
      [1, 'perifericos', 25.5, 25.5], [2, 'perifericos', 12, 37.5], [3, 'pantallas', 199.99, 199.99], [4, 'accesorios', 3.5, 3.5],
    ]);
    expect(rows(s, 'SELECT id, COUNT(*) OVER () FROM products ORDER BY id LIMIT 1')).toEqual([[1, 4]]);
  });
  test('LAG, LEAD y FIRST_VALUE', () => {
    expect(rows(s, 'SELECT id, LAG(price) OVER (ORDER BY id), LEAD(price, 1, 0) OVER (ORDER BY id), FIRST_VALUE(name) OVER (ORDER BY price) FROM products ORDER BY id')).toEqual([
      [1, null, 12, 'Cable'], [2, 25.5, 199.99, 'Cable'], [3, 12, 3.5, 'Cable'], [4, 199.99, 0, 'Cable'],
    ]);
  });
  test('marco de ventana: media móvil y LAST_VALUE con marco completo', () => {
    const t = new SqlSession();
    t.exec('CREATE TABLE n (v INT); INSERT INTO n VALUES (1),(2),(3),(4)');
    expect(rows(t, 'SELECT v, AVG(v) OVER (ORDER BY v ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM n ORDER BY v')).toEqual([[1, 1.5], [2, 2], [3, 3], [4, 3.5]]);
    expect(rows(t, 'SELECT v, LAST_VALUE(v) OVER (ORDER BY v), LAST_VALUE(v) OVER (ORDER BY v ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM n ORDER BY v LIMIT 1')).toEqual([[1, 1, 4]]);
  });
  test('NTILE y ventana con nombre', () => {
    const t = new SqlSession();
    t.exec('CREATE TABLE n (v INT); INSERT INTO n VALUES (1),(2),(3),(4),(5)');
    expect(rows(t, 'SELECT v, NTILE(2) OVER w FROM n WINDOW w AS (ORDER BY v) ORDER BY v')).toEqual([[1, 1], [2, 1], [3, 1], [4, 2], [5, 2]]);
  });
  test('una ventana en el WHERE da un error con pista', () => {
    expect(fails(s, 'SELECT id FROM products WHERE ROW_NUMBER() OVER (ORDER BY id) = 1').hint).toContain('subconsulta');
  });
});

describe('subconsultas correlacionadas con búsqueda por índice', () => {
  test('la clave de búsqueda sale de la fila exterior (clave primaria compuesta y rango)', () => {
    const t = new SqlSession();
    t.exec('CREATE TABLE a (id INT PRIMARY KEY, n TEXT); CREATE TABLE m (a_id INT, k INT, v INT, PRIMARY KEY (a_id, k)); INSERT INTO a VALUES (1,\'x\'),(2,\'y\'),(3,\'z\'); INSERT INTO m VALUES (1,1,10),(1,2,20),(2,1,5)');
    expect(rows(t, 'SELECT n, (SELECT COUNT(*) FROM m WHERE m.a_id = a.id) FROM a ORDER BY id')).toEqual([['x', 2], ['y', 1], ['z', 0]]);
    expect(rows(t, 'SELECT n FROM a WHERE EXISTS (SELECT 1 FROM m WHERE m.a_id = a.id AND m.k = 2)')).toEqual([['x']]);
    t.exec('CREATE INDEX m_v ON m (v)');
    expect(rows(t, 'SELECT id, (SELECT COUNT(*) FROM m WHERE m.v >= a.id * 10) FROM a ORDER BY id')).toEqual([[1, 2], [2, 1], [3, 0]]);
    expect(rows(t, 'SELECT id FROM a WHERE id IN (SELECT a_id FROM m WHERE a_id = a.id) ORDER BY id')).toEqual([[1], [2]]);
  });
});

describe('generate_series con fechas', () => {
  test('días, meses y semanas', () => {
    const t = new SqlSession();
    expect(rows(t, "SELECT * FROM generate_series('2024-01-30'::date, '2024-02-02'::date)")).toEqual([['2024-01-30'], ['2024-01-31'], ['2024-02-01'], ['2024-02-02']]);
    expect(rows(t, "SELECT d FROM generate_series('2024-01-31', '2024-04-30', '1 month') AS d")).toEqual([['2024-01-31'], ['2024-02-29'], ['2024-03-31'], ['2024-04-30']]);
    expect(rows(t, "SELECT COUNT(*) FROM generate_series('2024-01-01'::date, '2024-12-31'::date, '1 week')")).toEqual([[53]]);
    expect(rows(t, "SELECT * FROM generate_series('2024-03-01', '2024-03-01')")).toEqual([['2024-03-01']]);
  });
  test('un paso no positivo da error', () => {
    const t = new SqlSession();
    expect(fails(t, "SELECT * FROM generate_series('2024-01-01', '2024-01-05', '0 days')").message).toContain('positivo');
  });
});
