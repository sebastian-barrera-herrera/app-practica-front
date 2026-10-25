import { SqlSession, renderTable } from '../index';
import { SqlError } from '../types';

/** Ejecuta un script y devuelve el último resultado como texto. */
export function run(s: SqlSession, sql: string): string {
  const out = s.exec(sql);
  if (out.error) throw out.error.error;
  return renderTable(out.results[out.results.length - 1]);
}

export function rows(s: SqlSession, sql: string): unknown[][] {
  const out = s.exec(sql);
  if (out.error) throw out.error.error;
  return out.results[out.results.length - 1].rows;
}

export function fails(s: SqlSession, sql: string): SqlError {
  const out = s.exec(sql);
  if (!out.error) throw new Error(`Se esperaba un error y no hubo: ${sql}`);
  return out.error.error;
}

export const SHOP = `
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, vip BOOLEAN DEFAULT false);
CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL CHECK (price > 0), category TEXT);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), order_date DATE, status TEXT);
CREATE TABLE order_items (order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id), qty INTEGER NOT NULL, PRIMARY KEY (order_id, product_id));
INSERT INTO customers (id, name, city, vip) VALUES (1,'Ana','Madrid',true),(2,'Luis','Sevilla',false),(3,'Marta','Madrid',true),(4,'Pablo',NULL,false);
INSERT INTO products VALUES (1,'Teclado',25.5,'perifericos'),(2,'Ratón',12,'perifericos'),(3,'Monitor',199.99,'pantallas'),(4,'Cable',3.5,'accesorios');
INSERT INTO orders VALUES (1,1,'2025-01-10','enviado'),(2,1,'2025-02-03','pendiente'),(3,2,'2025-02-14','enviado'),(4,3,'2025-03-01','cancelado');
INSERT INTO order_items VALUES (1,1,1),(1,2,2),(2,3,1),(3,2,5),(3,4,10),(4,1,1);
`;

export function shop(): SqlSession {
  const s = new SqlSession();
  const out = s.exec(SHOP);
  if (out.error) throw out.error.error;
  return s;
}
