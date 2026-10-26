import type { SqlRef } from '../reference';

export const SQL_REF_ANALYSIS: SqlRef[] = [
  {
    name: 'WITH RECURSIVE',
    kind: 'cláusula',
    category: 'subconsultas',
    level: 3,
    db: 'empresa',
    summary: 'CTE que se llama a sí misma: una ancla, un paso que usa lo ya generado y una parada. Sirve para jerarquías, grafos y series.',
    usage: 'WITH RECURSIVE nombre(col, …) AS (\n  SELECT … -- ancla\n  UNION ALL\n  SELECT … FROM nombre … WHERE parada\n)\nSELECT … FROM nombre;',
    details: 'La ancla produce las filas de partida; el paso toma las filas de la vuelta anterior y genera las siguientes hasta que no sale ninguna. **Sin condición de parada nunca acaba** (el motor corta tras 2000 vueltas). La condición se evalúa sobre la fila anterior, no sobre la nueva. Para evitar ciclos en grafos, guarda el camino recorrido y no vuelvas a pasar por un nodo ya visitado. `UNION` (sin `ALL`) también elimina repetidos y corta ciclos simples.',
    examples: [
      ['WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT i FROM n;', 'Contar del 1 al 5'],
      ['WITH RECURSIVE equipo(id, nombre, nivel) AS (SELECT id, nombre, 0 FROM empleados WHERE jefe_id IS NULL UNION ALL SELECT e.id, e.nombre, q.nivel + 1 FROM empleados e JOIN equipo q ON e.jefe_id = q.id) SELECT nivel, nombre FROM equipo ORDER BY nivel, nombre;', 'Organigrama completo con su profundidad'],
    ],
    seeAlso: ['WITH', 'Auto-JOIN', 'generate_series'],
  },
  {
    name: 'ROLLUP / CUBE',
    kind: 'cláusula',
    category: 'resumir',
    level: 3,
    db: 'tienda',
    summary: 'Subtotales y total general en una sola consulta. `ROLLUP` es jerárquico, `CUBE` da todas las combinaciones y `GROUPING SETS` las eliges tú.',
    usage: 'GROUP BY ROLLUP (a, b)\nGROUP BY CUBE (a, b)\nGROUP BY GROUPING SETS ((a), (b), ())',
    details: 'Las filas de resumen muestran **NULL** en las columnas que no se agruparon. Como un dato real también puede ser NULL, usa `GROUPING(col)`: vale 1 si ese NULL es de un subtotal y 0 si es un dato. `ROLLUP (a, b)` produce (a, b), (a) y (); `CUBE (a, b)` añade (b). Para ordenar los totales al final: `ORDER BY GROUPING(a), a`.',
    examples: [
      ["SELECT COALESCE(categoria, 'TOTAL') AS categoria, COUNT(*) AS productos FROM productos GROUP BY ROLLUP (categoria) ORDER BY GROUPING(categoria), categoria;", 'Una fila por categoría y el total al final'],
      ['SELECT ciudad, vip, COUNT(*) AS clientes FROM clientes GROUP BY CUBE (ciudad, vip) ORDER BY GROUPING(ciudad), ciudad, GROUPING(vip), vip;', 'Todas las combinaciones de ciudad y VIP'],
    ],
    seeAlso: ['GROUP BY', 'HAVING', 'UNION'],
  },
  {
    name: 'Pivotar y despivotar',
    kind: 'patrón',
    category: 'resumir',
    level: 3,
    db: 'tienda',
    summary: 'Girar una tabla: los valores de una columna pasan a ser columnas (pivotar) o varias columnas pasan a ser filas (despivotar).',
    usage: 'Pivotar:    SUM(CASE WHEN col = valor THEN … END)  ó  COUNT(*) FILTER (WHERE …)\nDespivotar: SELECT …, \'etiqueta\', col1 FROM t UNION ALL SELECT …, \'otra\', col2 FROM t',
    details: 'Pivotar es una **agregación condicional**: una columna por cada valor, y esos valores hay que conocerlos de antemano (SQL no crea columnas dinámicas). Despivotar (unpivot) se hace con `UNION ALL` —una consulta por columna— o cruzando cada fila con una lista de etiquetas (`CROSS JOIN (VALUES …)`) y eligiendo la columna con `CASE`. Es el paso clave para limpiar datos importados de hojas de cálculo.',
    examples: [
      ['SELECT ciudad, COUNT(*) FILTER (WHERE vip) AS vip, COUNT(*) FILTER (WHERE NOT vip) AS no_vip FROM clientes GROUP BY ciudad ORDER BY ciudad;', 'Pivote con FILTER: una columna por valor'],
      ["SELECT categoria, SUM(CASE WHEN precio < 50 THEN 1 ELSE 0 END) AS baratos, SUM(CASE WHEN precio >= 50 THEN 1 ELSE 0 END) AS caros FROM productos GROUP BY categoria ORDER BY categoria;", 'Pivote con SUM(CASE…)'],
    ],
    seeAlso: ['FILTER', 'CASE', 'UNION'],
  },
  {
    name: 'Rachas y huecos',
    kind: 'patrón',
    category: 'ventanas',
    level: 3,
    db: 'social',
    summary: 'Patrones de analista: encontrar días consecutivos (rachas), periodos sin datos (huecos) y la primera/última vez de cada entidad.',
    usage: 'Racha: fecha − ROW_NUMBER() OVER (… ORDER BY fecha)  →  mismo valor en toda la racha\nHueco: generate_series(…) LEFT JOIN datos … WHERE datos.id IS NULL',
    details: 'Rachas (el problema de las islas): quita duplicados, numera las fechas con `ROW_NUMBER()` y réstale a cada fecha su número en días; para fechas consecutivas el resultado es constante, y `GROUP BY` ese valor da cada racha. Huecos: genera el calendario con `generate_series` y haz un `LEFT JOIN` con tus datos; los meses con `NULL` son los vacíos. Primera/última vez: `MIN` y `MAX` por grupo.',
    examples: [
      ["WITH dias AS (SELECT DISTINCT usuario_id, DATE(fecha) AS dia FROM publicaciones), num AS (SELECT usuario_id, dia, ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY dia) AS rn FROM dias), grupos AS (SELECT usuario_id, dia, DATE(dia, '-' || rn || ' days') AS grupo FROM num) SELECT usuario_id, MIN(dia) AS desde, MAX(dia) AS hasta, COUNT(*) AS dias_seguidos FROM grupos GROUP BY usuario_id, grupo HAVING COUNT(*) >= 2 ORDER BY dias_seguidos DESC, usuario_id;", 'Rachas de al menos 2 días publicando'],
      ['SELECT usuario_id, MIN(fecha) AS primera, MAX(fecha) AS ultima, COUNT(*) AS publicaciones FROM publicaciones GROUP BY usuario_id ORDER BY usuario_id;', 'Primera y última vez de cada usuario'],
    ],
    seeAlso: ['ROW_NUMBER', 'generate_series', 'MIN / MAX'],
  },
];
