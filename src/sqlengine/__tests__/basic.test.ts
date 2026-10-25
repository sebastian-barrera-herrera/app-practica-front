import { SqlSession } from '../index';
import { fails, rows, run, shop } from './helpers';

describe('SELECT básico', () => {
  const s = shop();

  test('columnas, alias y orden', () => {
    expect(run(s, 'SELECT name, city FROM customers ORDER BY name DESC')).toBe(
      ['name  | city', '------+--------', 'Pablo | NULL', 'Marta | Madrid', 'Luis  | Sevilla', 'Ana   | Madrid'].join('\n'),
    );
    expect(rows(s, 'SELECT name AS n FROM customers WHERE id = 2')).toEqual([['Luis']]);
  });

  test('WHERE con AND, OR, NOT, IN, BETWEEN, LIKE', () => {
    expect(rows(s, "SELECT id FROM customers WHERE city = 'Madrid' AND vip")).toEqual([[1], [3]]);
    expect(rows(s, "SELECT id FROM customers WHERE city IN ('Sevilla','Madrid') AND NOT vip")).toEqual([[2]]);
    expect(rows(s, 'SELECT id FROM products WHERE price BETWEEN 10 AND 30 ORDER BY id')).toEqual([[1], [2]]);
    expect(rows(s, "SELECT name FROM products WHERE name LIKE 'T%'")).toEqual([['Teclado']]);
    expect(rows(s, "SELECT name FROM products WHERE name LIKE '_atón'")).toEqual([['Ratón']]);
  });

  test('NULL: =, IS NULL y lógica de tres valores', () => {
    expect(rows(s, 'SELECT id FROM customers WHERE city = NULL')).toEqual([]);
    expect(rows(s, 'SELECT id FROM customers WHERE city IS NULL')).toEqual([[4]]);
    expect(rows(s, "SELECT id FROM customers WHERE city <> 'Madrid'")).toEqual([[2]]); // Pablo (NULL) no sale
    expect(rows(s, 'SELECT NULL AND false, NULL OR true, NOT NULL, NULL = NULL')).toEqual([[false, true, null, null]]);
    expect(rows(s, 'SELECT 1 IN (2, NULL), 1 NOT IN (2, NULL), 2 IN (2, NULL)')).toEqual([[null, null, true]]);
  });

  test('LIMIT, OFFSET y DISTINCT', () => {
    expect(rows(s, 'SELECT id FROM products ORDER BY id LIMIT 2 OFFSET 1')).toEqual([[2], [3]]);
    expect(rows(s, 'SELECT DISTINCT category FROM products ORDER BY category')).toEqual([['accesorios'], ['pantallas'], ['perifericos']]);
    expect(rows(s, 'SELECT id FROM products ORDER BY id FETCH FIRST 1 ROWS ONLY')).toEqual([[1]]);
  });

  test('ORDER BY: NULL al final con ASC, NULLS FIRST, posición y alias', () => {
    expect(rows(s, 'SELECT city FROM customers ORDER BY city')).toEqual([['Madrid'], ['Madrid'], ['Sevilla'], [null]]);
    expect(rows(s, 'SELECT city FROM customers ORDER BY city NULLS FIRST LIMIT 1')).toEqual([[null]]);
    expect(rows(s, 'SELECT name, price * 2 AS doble FROM products ORDER BY doble DESC LIMIT 1')).toEqual([['Monitor', 399.98]]);
    expect(rows(s, 'SELECT name, price FROM products ORDER BY 2 LIMIT 1')).toEqual([['Cable', 3.5]]);
  });

  test('expresiones: aritmética entera y decimal', () => {
    expect(rows(s, 'SELECT 5 / 2, 5 / 2.0, 5 % 2, 2 + 3 * 4, -3 + 1, 7.0 / 2')).toEqual([[2, 2.5, 1, 14, -2, 3.5]]);
    expect(rows(s, "SELECT 'a' || 'b' || 1, 1 + 1 = 2")).toEqual([['ab1', true]]);
    expect(rows(s, 'SELECT price * qty FROM order_items JOIN products ON id = product_id WHERE order_id = 1 AND product_id = 2').length).toBe(1);
  });

  test('CASE, COALESCE, NULLIF y CAST', () => {
    expect(rows(s, "SELECT CASE WHEN price < 5 THEN 'barato' WHEN price < 50 THEN 'medio' ELSE 'caro' END FROM products ORDER BY id")).toEqual([['medio'], ['medio'], ['caro'], ['barato']]);
    expect(rows(s, "SELECT COALESCE(city, 'sin ciudad') FROM customers WHERE id = 4")).toEqual([['sin ciudad']]);
    expect(rows(s, 'SELECT NULLIF(5, 5), NULLIF(5, 6), CAST(3.7 AS INTEGER), CAST(42 AS TEXT) || \'!\', \'12\'::int + 1')).toEqual([[null, 5, 4, '42!', 13]]);
    expect(rows(s, "SELECT CASE category WHEN 'pantallas' THEN 1 ELSE 0 END FROM products WHERE id = 3")).toEqual([[1]]);
  });

  test('SELECT sin FROM, * y t.*', () => {
    expect(rows(s, 'SELECT 1 + 1, upper(\'hola\')')).toEqual([[2, 'HOLA']]);
    expect(rows(s, 'SELECT * FROM customers WHERE id = 1')).toEqual([[1, 'Ana', 'Madrid', true]]);
    expect(rows(s, 'SELECT c.* FROM customers c WHERE c.id = 2')).toEqual([[2, 'Luis', 'Sevilla', false]]);
  });
});

describe('errores con pistas', () => {
  const s = shop();
  test('tabla y columna inexistentes sugieren el nombre', () => {
    const e1 = fails(s, 'SELECT * FROM custmers');
    expect(e1.message).toContain('No existe la tabla «custmers»');
    expect(e1.hint).toContain('customers');
    const e2 = fails(s, 'SELECT nam FROM customers');
    expect(e2.message).toContain('No existe la columna «nam»');
    expect(e2.hint).toContain('name');
  });
  test('comillas dobles con un texto', () => {
    const e = fails(s, 'SELECT * FROM customers WHERE city = "Madrid"');
    expect(e.hint).toContain("comillas simples");
  });
  test('errata en una palabra clave', () => {
    const e = fails(s, 'SELECT name FORM customers');
    expect(e.kind).toBe('syntax');
    expect(e.hint).toContain('FROM');
  });
  test('coma de más antes de FROM y == en vez de =', () => {
    expect(fails(s, 'SELECT name, FROM customers').message).toContain('sobra una coma');
    expect(fails(s, 'SELECT * FROM customers WHERE id == 1').hint).toContain('un solo =');
  });
  test('división por cero y alias en WHERE', () => {
    expect(fails(s, 'SELECT 1 / 0').message).toContain('División por cero');
    const e = fails(s, 'SELECT price * 2 AS doble FROM products WHERE doble > 10');
    expect(e.hint).toContain('alias');
  });
  test('texto como número', () => {
    const e = fails(s, "SELECT 'abc' + 1");
    expect(e.message).toContain('No se puede usar el texto');
    expect(e.hint).toContain('||');
  });
});

describe('sesión', () => {
  test('varias sentencias y error a medias', () => {
    const s = new SqlSession();
    const out = s.exec("CREATE TABLE t (a INT); INSERT INTO t VALUES (1); INSERT INTO nada VALUES (2); INSERT INTO t VALUES (3)");
    expect(out.results.length).toBe(2);
    expect(out.error?.error.message).toContain('No existe la tabla «nada»');
    expect(rows(s, 'SELECT * FROM t')).toEqual([[1]]);
  });
});
