/** Consultas de ejemplo del laboratorio de SQL: cada una se carga en el editor sobre su base de datos. Un test comprueba que todas funcionan. */
export interface SqlSample {
  id: string;
  db: string;
  title: string;
  blurb: string;
  emoji: string;
  sql: string;
}

export const SQL_SAMPLES: SqlSample[] = [
  { id: 'caros', db: 'tienda', emoji: '💶', title: 'Los productos más caros', blurb: 'ORDER BY + LIMIT', sql: 'SELECT nombre, precio\nFROM productos\nORDER BY precio DESC\nLIMIT 5;' },
  { id: 'por-categoria', db: 'tienda', emoji: '📦', title: 'Productos por categoría', blurb: 'GROUP BY con varios resúmenes', sql: 'SELECT categoria,\n       COUNT(*)       AS productos,\n       ROUND(AVG(precio), 2) AS precio_medio\nFROM productos\nGROUP BY categoria\nORDER BY productos DESC;' },
  { id: 'quien-compro', db: 'tienda', emoji: '🧾', title: 'Quién compró qué', blurb: 'Tres tablas unidas con JOIN', sql: 'SELECT c.nombre AS cliente, p.fecha, pr.nombre AS producto, d.cantidad\nFROM pedidos p\nJOIN clientes c       ON c.id = p.cliente_id\nJOIN detalle_pedido d ON d.pedido_id = p.id\nJOIN productos pr     ON pr.id = d.producto_id\nORDER BY p.fecha\nLIMIT 15;' },
  { id: 'sin-pedidos', db: 'tienda', emoji: '👻', title: 'Clientes sin ningún pedido', blurb: 'LEFT JOIN + IS NULL', sql: 'SELECT c.nombre, c.ciudad\nFROM clientes c\nLEFT JOIN pedidos p ON p.cliente_id = c.id\nWHERE p.id IS NULL;' },
  { id: 'gasto-cliente', db: 'tienda', emoji: '💰', title: 'Cuánto ha gastado cada cliente', blurb: 'JOIN + SUM + GROUP BY', sql: 'SELECT c.nombre,\n       SUM(d.cantidad * pr.precio) AS gastado\nFROM clientes c\nJOIN pedidos p        ON p.cliente_id = c.id\nJOIN detalle_pedido d ON d.pedido_id = p.id\nJOIN productos pr     ON pr.id = d.producto_id\nGROUP BY c.id, c.nombre\nORDER BY gastado DESC;' },
  { id: 'ranking-cat', db: 'tienda', emoji: '🏅', title: 'El más caro de cada categoría', blurb: 'Función de ventana ROW_NUMBER', sql: 'SELECT categoria, nombre, precio\nFROM (\n  SELECT categoria, nombre, precio,\n         ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC) AS puesto\n  FROM productos\n) t\nWHERE puesto = 1;' },
  { id: 'mejores-peliculas', db: 'cine', emoji: '🍿', title: 'Las mejor valoradas', blurb: 'Filtrar y ordenar', sql: 'SELECT titulo, anio, puntuacion\nFROM peliculas\nORDER BY puntuacion DESC\nLIMIT 10;' },
  { id: 'peliculas-director', db: 'cine', emoji: '🎬', title: 'Películas con su director', blurb: 'JOIN de dos tablas', sql: 'SELECT d.nombre AS director, p.titulo, p.anio\nFROM peliculas p\nJOIN directores d ON d.id = p.director_id\nORDER BY d.nombre, p.anio;' },
  { id: 'notas-alumno', db: 'escuela', emoji: '🎓', title: 'Nota media de cada alumno', blurb: 'AVG + GROUP BY + HAVING', sql: 'SELECT a.nombre, ROUND(AVG(m.nota), 2) AS media\nFROM alumnos a\nJOIN matriculas m ON m.alumno_id = a.id\nGROUP BY a.id, a.nombre\nHAVING AVG(m.nota) >= 6\nORDER BY media DESC;' },
  { id: 'jefes', db: 'empresa', emoji: '👔', title: 'Cada empleado con su jefe', blurb: 'Auto-JOIN (una tabla con ella misma)', sql: 'SELECT e.nombre AS empleado, j.nombre AS jefe\nFROM empleados e\nLEFT JOIN empleados j ON j.id = e.jefe_id\nORDER BY j.nombre, e.nombre;' },
  { id: 'organigrama', db: 'empresa', emoji: '🌳', title: 'Organigrama completo', blurb: 'CTE recursiva', sql: 'WITH RECURSIVE arbol AS (\n  SELECT id, nombre, jefe_id, 0 AS nivel\n  FROM empleados WHERE jefe_id IS NULL\n  UNION ALL\n  SELECT e.id, e.nombre, e.jefe_id, a.nivel + 1\n  FROM empleados e JOIN arbol a ON e.jefe_id = a.id\n)\nSELECT substr(\'                    \', 1, nivel * 4) || nombre AS organigrama\nFROM arbol;' },
  { id: 'prestamos', db: 'biblioteca', emoji: '📚', title: 'Libros más prestados', blurb: 'COUNT + GROUP BY + ORDER BY', sql: 'SELECT l.titulo, COUNT(*) AS veces\nFROM prestamos p\nJOIN libros l ON l.id = p.libro_id\nGROUP BY l.id, l.titulo\nORDER BY veces DESC\nLIMIT 5;' },
  { id: 'populares', db: 'social', emoji: '⭐', title: 'Usuarios con más seguidores', blurb: 'Contar relaciones', sql: 'SELECT u.alias, COUNT(*) AS seguidores\nFROM seguidores s\nJOIN usuarios u ON u.id = s.seguido_id\nGROUP BY u.id, u.alias\nORDER BY seguidores DESC\nLIMIT 5;' },
  { id: 'saldos', db: 'banco', emoji: '🏦', title: 'Saldo de cada cuenta', blurb: 'Una tabla para practicar transacciones', sql: 'SELECT * FROM cuentas;' },
  { id: 'rutas', db: 'vuelos', emoji: '✈️', title: 'Vuelos con ciudad de origen y destino', blurb: 'Dos JOIN a la misma tabla', sql: 'SELECT v.id, o.ciudad AS origen, d.ciudad AS destino, v.precio\nFROM vuelos v\nJOIN aeropuertos o ON o.codigo = v.origen\nJOIN aeropuertos d ON d.codigo = v.destino\nORDER BY v.precio\nLIMIT 10;' },
  { id: 'ventas-mes', db: 'ventas_grande', emoji: '📈', title: 'Ventas por mes', blurb: 'Agrupar por parte de una fecha', sql: "SELECT strftime('%Y-%m', fecha) AS mes,\n       COUNT(*)            AS ventas,\n       ROUND(SUM(importe), 2) AS total\nFROM ventas\nGROUP BY mes\nORDER BY mes;" },
  { id: 'sin-indice', db: 'ventas_grande', emoji: '🐢', title: 'Buscar sin índice (lee todo)', blurb: 'Mira «filas leídas» bajo el resultado', sql: 'SELECT * FROM ventas WHERE cliente_id = 123;' },
  { id: 'con-indice', db: 'ventas_grande', emoji: '⚡', title: 'Crear un índice y repetir', blurb: 'La misma búsqueda, mucho más barata', sql: 'CREATE INDEX idx_ventas_cliente ON ventas (cliente_id);\nEXPLAIN SELECT * FROM ventas WHERE cliente_id = 123;\nSELECT * FROM ventas WHERE cliente_id = 123;' },
  { id: 'crear-tabla', db: 'vacia', emoji: '🆕', title: 'Tu primera tabla', blurb: 'CREATE TABLE + INSERT + SELECT', sql: "CREATE TABLE mascotas (\n  id INTEGER PRIMARY KEY,\n  nombre TEXT NOT NULL,\n  especie TEXT,\n  edad INTEGER CHECK (edad >= 0)\n);\n\nINSERT INTO mascotas (nombre, especie, edad) VALUES\n  ('Luna', 'gato', 3),\n  ('Toby', 'perro', 5),\n  ('Nemo', 'pez', 1);\n\nSELECT * FROM mascotas;" },
];
