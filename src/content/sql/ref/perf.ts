import type { SqlRef } from '../reference';

export const SQL_REF_PERF: SqlRef[] = [
  {
    name: 'CREATE INDEX',
    kind: 'sentencia',
    category: 'rendimiento',
    level: 3,
    db: 'ventas_grande',
    summary: 'Crea un índice: una estructura ordenada que permite encontrar filas sin recorrer toda la tabla. No cambia los resultados, solo la velocidad.',
    usage: 'CREATE [UNIQUE] INDEX [IF NOT EXISTS] nombre ON tabla (col [, col…]);\nDROP INDEX [IF EXISTS] nombre;',
    details: 'Acelera `WHERE`, `JOIN` y rangos sobre las columnas indexadas, pero **ralentiza las escrituras** (hay que actualizar cada índice) y ocupa espacio. La clave primaria y las columnas `UNIQUE` ya tienen índice; las **claves foráneas no**, y conviene indexarlas. En un índice compuesto `(a, b)` el orden importa: sirve para filtrar por `a` o por `a` y `b`, no solo por `b` (prefijo por la izquierda). Regla práctica: primero las columnas con igualdad y después la de rango. `CREATE UNIQUE INDEX` además rechaza valores repetidos.',
    examples: [
      ['CREATE INDEX idx_ventas_cliente ON ventas (cliente_id);\nEXPLAIN ANALYZE SELECT * FROM ventas WHERE cliente_id = 42;', 'Con el índice, lee 12 filas en lugar de 6.000'],
      ["CREATE INDEX idx_producto_fecha ON ventas (producto, fecha);\nEXPLAIN ANALYZE SELECT * FROM ventas WHERE producto = 'raton' AND fecha >= '2024-12-01';", 'Compuesto: igualdad en la primera columna y rango en la segunda'],
    ],
    seeAlso: ['EXPLAIN', 'Consultas sargables', 'Restricciones'],
  },
  {
    name: 'EXPLAIN',
    kind: 'sentencia',
    category: 'rendimiento',
    level: 3,
    db: 'tienda',
    summary: 'Muestra el plan de ejecución de una consulta. Con `ANALYZE` la ejecuta y añade las filas reales leídas.',
    usage: 'EXPLAIN consulta;\nEXPLAIN ANALYZE consulta;',
    details: 'El plan es un árbol: los nodos más sangrados se ejecutan primero y pasan sus filas al de encima. Lo que hay que buscar: **«Escaneo completo»** sobre tablas grandes, nodos que **leen muchas más filas de las que devuelven** e índices que esperabas ver y no aparecen. `EXPLAIN ANALYZE` ejecuta de verdad la sentencia: con `UPDATE`/`DELETE` los cambios se aplican, ¡cuidado!',
    examples: [
      ['EXPLAIN SELECT * FROM clientes WHERE id = 3;', 'Búsqueda por clave primaria'],
      ['EXPLAIN ANALYZE SELECT * FROM pedidos WHERE cliente_id = 3;', 'Plan con filas realmente leídas'],
    ],
    seeAlso: ['CREATE INDEX', 'Optimizar consultas'],
  },
  {
    name: 'Consultas sargables',
    kind: 'patrón',
    category: 'rendimiento',
    level: 3,
    db: 'ventas_grande',
    summary: 'Escribe el WHERE dejando la columna indexada «limpia» (sin funciones ni operaciones) para que el motor pueda usar el índice.',
    usage: "✗ WHERE strftime('%Y-%m', fecha) = '2024-03'\n✓ WHERE fecha >= '2024-03-01' AND fecha < '2024-04-01'",
    details: 'Una condición es **sargable** si el motor puede resolverla con un índice. Lo rompen: funciones sobre la columna (`UPPER(col)`, `strftime(…, col)`), operaciones (`col * 2 > x`), `OR` entre columnas distintas (reparte con `UNION ALL`), `LIKE` con comodín al principio y no usar la primera columna de un índice compuesto. Soluciones: mover el cálculo al otro lado, convertir la condición en un rango, o (en motores que lo permiten) crear un índice sobre la expresión.',
    examples: [
      ["SELECT COUNT(*) FROM ventas WHERE strftime('%Y-%m', fecha) = '2024-03';", 'No sargable: escanea toda la tabla'],
      ["SELECT COUNT(*) FROM ventas WHERE fecha >= '2024-03-01' AND fecha < '2024-04-01';", 'Mismo resultado con un rango (pruébalo tras crear un índice sobre fecha)'],
    ],
    seeAlso: ['CREATE INDEX', 'EXPLAIN', 'UNION'],
  },
  {
    name: 'Optimizar consultas',
    kind: 'concepto',
    category: 'rendimiento',
    level: 3,
    db: 'tienda',
    summary: 'Ciclo de trabajo: medir con EXPLAIN ANALYZE, localizar el cuello de botella, arreglar (índice o reescritura) y volver a medir.',
    usage: '1. EXPLAIN ANALYZE   2. localizar   3. índice / reescritura   4. comprobar',
    details: 'Ideas habituales: **indexa las claves foráneas** usadas en `JOIN` y subconsultas correlacionadas (una subconsulta correlacionada se ejecuta una vez por fila exterior); pide solo las columnas necesarias; filtra pronto (`WHERE` antes de agrupar); evita `DISTINCT`/`ORDER BY` innecesarios; no sobreindexes. Y recuerda: primero correcta, después rápida, y siempre con medidas.',
    examples: [
      ['SELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c;', 'Subconsulta correlacionada sin índice: mira las filas leídas…'],
      ['CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);\nSELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c;', '…y con el índice sobre la clave foránea'],
    ],
    seeAlso: ['EXPLAIN', 'CREATE INDEX', 'Subconsulta correlacionada'],
  },
];
