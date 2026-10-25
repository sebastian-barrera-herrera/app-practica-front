# Curso de SQL de Dev Dojo — plan

14 zonas (`s1…s14`) × 5 lecciones. Español. De `SELECT` a ventanas, índices, transacciones y triggers.
Motor propio en TypeScript (`src/sqlengine`), dialecto estilo PostgreSQL (+ comodidades de SQLite como `strftime`, `group_concat`).
Modelos de formato y tono: `src/content/py/w1.ts` (usa `lesson`, `learn`, `mc`, `tf`, `fill`, `order`, `match` de `../build`; `sqlDemo`, `sqlErr`, `sqlPractice`, `sqlCode`, `sqlOut`, `sqlWorld`, `same/ordered/state/both/fails` de `../sqlbuild`).

## Reglas de contenido
- Cada lección: ≥ 8 pasos; ≥ 1 `sqlDemo`; ≥ 3 preguntas; ≥ 1 `sqlPractice`; `commands` = nombres de fichas de la biblioteca (existen en `ref/*`).
- Narrativa: eres analista/a en empresas de ejemplo; los retos empiezan con una petición de un jefe/cliente. Tono cercano, sin tecnicismos sin explicar.
- Los retos se corrigen por RESULTADO (cualquier SQL equivalente vale). `ordered()` solo si se pide orden; `state([...tablas])` para INSERT/UPDATE/DELETE/DDL.
- `sqlOut(pregunta, bd, sql, wrong[], why)`: `wrong` = resultados falsos en el formato de `renderRows` (filas con « | », una por línea).
- Los tests (`__tests__/sqlcourse.test.ts`) ejecutan TODO: demos, soluciones, `expectInitialFail`, opciones de `sqlout`, ejemplos de la biblioteca y ejemplos del laboratorio.

## Bases de datos (ver `datasets.ts`)
tienda (clientes 12, productos 14, pedidos 24, detalle_pedido 41) · cine (directores 7, peliculas 16 [puntuacion, 1 sin director y NULL], actores 11, reparto 16) ·
escuela (profesores 4, alumnos 10, asignaturas 7, matriculas 29 [nota NULL ×2]) · empresa (departamentos 5, empleados 16 [jefe_id, 1 sin depto], proyectos 5, asignaciones 17) ·
biblioteca (autores 7, libros 13, socios 7, prestamos 15 [fecha_devolucion NULL ×4]) · social (usuarios 8, publicaciones 12, seguidores 16) ·
banco (cuentas 3 [CHECK saldo>=0], movimientos 5) · vuelos (aeropuertos 7, vuelos 12) · ventas_grande (ventas 6000) · vacia.

## Zonas
| Zona | Título | Nivel | Color | Emoji |
| --- | --- | --- | --- | --- |
| s1 | Hola, datos | basico | #FB923C | 🗃️ |
| s2 | Filtrar | basico | #FBBF24 | 🧲 |
| s3 | Transformar valores | basico | #22D3A6 | 🪄 |
| s4 | Resumir datos | basico | #38BDF8 | 📊 |
| s5 | Unir tablas | intermedio | #A78BFA | 🔗 |
| s6 | Subconsultas y CTE | intermedio | #F472B6 | 🪆 |
| s7 | Combinar resultados | intermedio | #4ADE80 | 🧩 |
| s8 | Modificar datos | intermedio | #F87171 | ✏️ |
| s9 | Diseñar tablas | avanzado | #2DD4BF | 🏗️ |
| s10 | Funciones de ventana | avanzado | #FB7185 | 🪟 |
| s11 | Recursión y análisis | avanzado | #C084FC | 🌳 |
| s12 | Rendimiento e índices | avanzado | #FACC15 | ⚡ |
| s13 | Transacciones y fiabilidad | avanzado | #5AA9FF | 🔒 |
| s14 | Maestría | avanzado | #F59E0B | 🏆 |

## Lecciones
**s1 Hola, datos** (tienda, cine) 1 ¿Qué es una base de datos? (tablas/filas/columnas/claves; SELECT * FROM) · 2 Elegir columnas (SELECT cols, mayúsculas, ;, comentarios) · 3 Alias y cálculos (AS, aritmética, ||, SELECT sin FROM) · 4 ORDER BY, LIMIT y OFFSET · 5 DISTINCT.
**s2 Filtrar** 1 WHERE y comparaciones · 2 AND, OR, NOT y paréntesis · 3 IN y BETWEEN · 4 LIKE · 5 NULL (IS NULL, lógica de 3 valores).
**s3 Transformar valores** 1 Texto (UPPER, LOWER, LENGTH, SUBSTR, TRIM, REPLACE) · 2 Números (ROUND, ABS, %, división entera, CEIL/FLOOR) · 3 Fechas · 4 CASE WHEN · 5 COALESCE, NULLIF, CAST.
**s4 Resumir datos** 1 COUNT/SUM/AVG/MIN/MAX · 2 GROUP BY · 3 HAVING · 4 Agrupar por varias cosas/expresiones y conteos condicionales · 5 Orden lógico de una consulta + informes.
**s5 Unir tablas** 1 Claves primarias y foráneas · 2 INNER JOIN · 3 LEFT/RIGHT/FULL JOIN (+anti-join) · 4 JOIN de varias tablas y agregados · 5 Auto-JOIN, CROSS JOIN, USING y fan-out.
**s6 Subconsultas y CTE** 1 Subconsulta escalar / IN · 2 EXISTS / NOT EXISTS (NOT IN y NULL) · 3 Tablas derivadas y subconsultas en SELECT · 4 WITH (CTE) · 5 ANY/ALL, el mejor de cada grupo.
**s7 Combinar resultados** 1 UNION / UNION ALL · 2 INTERSECT / EXCEPT · 3 VALUES y generate_series · 4 Agregados avanzados (group_concat/string_agg, FILTER, DISTINCT) · 5 Patrones de análisis (porcentajes, duplicados, tops).
**s8 Modificar datos** 1 INSERT · 2 UPDATE · 3 DELETE / TRUNCATE · 4 RETURNING y UPSERT · 5 Modificar sin miedo (probar con SELECT, errores de restricción).
**s9 Diseñar tablas** 1 CREATE TABLE, tipos, ALTER/DROP · 2 Restricciones · 3 Claves foráneas y ON DELETE · 4 Relaciones 1:N, N:M, 1:1 · 5 Normalización.
**s10 Funciones de ventana** 1 OVER y PARTITION BY · 2 ROW_NUMBER, RANK, DENSE_RANK · 3 LAG y LEAD · 4 Acumulados y medias móviles (frames) · 5 NTILE, FIRST_VALUE… y patrones.
**s11 Recursión y análisis** 1 CTE recursivas · 2 Jerarquías y grafos · 3 ROLLUP, CUBE, GROUPING SETS · 4 Pivotar y despivotar · 5 Patrones: huecos y rachas, deduplicar, retención.
**s12 Rendimiento e índices** 1 Cómo busca la base de datos · 2 CREATE INDEX · 3 EXPLAIN · 4 Consultas que no usan el índice · 5 Optimizar de verdad.
**s13 Transacciones y fiabilidad** 1 ACID y BEGIN/COMMIT/ROLLBACK · 2 SAVEPOINT y transacciones abortadas · 3 Concurrencia y aislamiento · 4 Restricciones como red de seguridad · 5 Vistas.
**s14 Maestría** 1 Triggers · 2 Seguridad e inyección SQL · 3 Dialectos y portabilidad · 4 Proyecto: informe de ventas · 5 Entrevista técnica (el jefe final).

## Ilustraciones (IllustrationId nuevos)
sql-table-anatomy · sql-eval-order · sql-join-types · sql-group-flow · sql-window-frame · sql-index-tree · sql-transaction · sql-er-model · sql-normalization · sql-set-ops
