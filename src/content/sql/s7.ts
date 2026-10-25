import { illus, learn, lesson, match, mc, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s7 = sqlWorld({
  id: 's7',
  index: 7,
  title: 'Combinar resultados',
  subtitle: 'Conjuntos, series de valores y resúmenes avanzados',
  emoji: '🧩',
  color: '#4ADE80',
  level: 'intermedio',
  intro:
    'Los `JOIN` unen tablas **en horizontal** (más columnas). Pero a veces necesitas apilar resultados **en vertical**, quedarte con lo que dos listas tienen en común o con lo que solo está en una, inventarte una tabla de valores al vuelo o generar un calendario entero. Esta zona completa tu caja de herramientas con las operaciones de conjuntos, `VALUES`, `generate_series` y los patrones de análisis más repetidos del mundo real: porcentajes, duplicados y listas agregadas.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s7-1', { title: 'UNION: apilar resultados', summary: 'UNION y UNION ALL', emoji: '📚', commands: ['UNION'], minutes: 8 }, [
      learn(
        'Una consulta debajo de otra',
        `
\`UNION\` **apila** los resultados de dos o más consultas en una sola lista. Reglas:

- Todas las consultas deben tener el **mismo número de columnas**, y de tipos compatibles.
- Los **nombres** de las columnas del resultado son los de la **primera** consulta.
- \`ORDER BY\` se escribe **una sola vez, al final**, y afecta a todo el resultado.

\`\`\`
SELECT nombre, 'alumno' AS rol FROM alumnos
UNION ALL
SELECT nombre, 'profesor' FROM profesores
ORDER BY rol, nombre;
\`\`\`

Fíjate en el truco de la columna fija \`'alumno' AS rol\`: añade una etiqueta para saber de qué consulta viene cada fila.
`,
        '📚',
      ),
      illus('sql-set-ops', 'Operaciones de conjuntos', 'UNION, INTERSECT y EXCEPT vistos como círculos: elige la operación y mira qué filas quedan.'),
      learn(
        'UNION frente a UNION ALL',
        `
- \`UNION\` **elimina duplicados** (como un \`DISTINCT\` sobre el resultado). Es más lento porque tiene que comparar filas.
- \`UNION ALL\` **conserva todas** las filas, repetidas incluidas. Es más rápido.

Si sabes que no hay duplicados, o los quieres, usa \`UNION ALL\`. Usa \`UNION\` solo cuando necesites quitarlos.
`,
      ),
      sqlDemo('Apilar listas', 'cine', [
        ["SELECT nombre, pais, 'director' AS rol FROM directores UNION ALL SELECT nombre, pais, 'actor' FROM actores ORDER BY rol, nombre LIMIT 6;", 'Directores y actores en una sola lista, con su rol'],
        ['SELECT pais FROM directores UNION SELECT pais FROM actores ORDER BY pais;', 'UNION: cada país una sola vez'],
        ['SELECT pais FROM directores UNION ALL SELECT pais FROM actores ORDER BY pais;', 'UNION ALL: España aparece muchas veces (una por cada persona)'],
        sqlErr('SELECT nombre FROM directores UNION SELECT nombre, pais FROM actores;', 'Distinto número de columnas: error'),
      ]),
      mc('¿Qué diferencia hay entre `UNION` y `UNION ALL`?', ['UNION es más rápido', 'UNION elimina las filas duplicadas y UNION ALL las conserva', 'UNION ALL solo funciona con dos tablas', 'No hay ninguna diferencia'], 1, '`UNION` quita duplicados; `UNION ALL` los deja (y por eso es más rápido).'),
      sqlOut('Predice: ¿cuántas filas tiene la unión?', 'cine', 'SELECT COUNT(*) FROM (SELECT pais FROM directores UNION ALL SELECT pais FROM actores) AS t;', ['8', '7', '11'], 'Hay 7 directores y 11 actores: con `UNION ALL` se conservan todas las filas, aunque se repitan países: 7 + 11 = 18.'),
      tf('En un `UNION`, cada `SELECT` puede devolver un número distinto de columnas.', false, 'Todos deben tener el mismo número de columnas (y tipos compatibles), o el motor da error.'),
      sqlCode('Muestra, sin repetir, todos los países que aparecen entre los directores o los actores (columna `pais`), ordenados.', {
        setup: 'cine',
        check: ordered({ names: true, uses: ['UNION'] }),
        solution: 'SELECT pais FROM directores UNION SELECT pais FROM actores ORDER BY pais;',
        hint: 'UNION (sin ALL) quita duplicados',
        why: '`UNION` combina las dos listas y elimina los países repetidos.',
      }),
      sqlPractice({
        goal: 'El directorio de la escuela',
        prompt: 'La secretaría necesita una lista única con **todos los alumnos y todos los profesores**.\n\n**Muestra `nombre` y `rol` (`alumno` o `profesor`), ordenado por rol y luego por nombre.**',
        setup: 'escuela',
        check: ordered({ names: true, uses: ['UNION'] }),
        solution: "SELECT nombre, 'alumno' AS rol FROM alumnos UNION ALL SELECT nombre, 'profesor' FROM profesores ORDER BY rol, nombre;",
        hints: ["Añade la columna fija `'alumno' AS rol` en el primer SELECT y `'profesor'` en el segundo.", 'El `ORDER BY` va una sola vez, al final.'],
        explain: 'Una columna con un texto fijo es la forma estándar de etiquetar de dónde sale cada fila en una unión.',
        commands: ['UNION'],
      }),
      sqlPractice({
        goal: 'Todos los países, una vez',
        prompt: 'Para un mapa del cine necesitas la lista de **países que aparecen como país de algún director o de algún actor**.\n\n**Muestra `pais`, sin repeticiones y en orden alfabético.**',
        setup: 'cine',
        check: ordered({ names: true, uses: ['UNION'] }),
        solution: 'SELECT pais FROM directores UNION SELECT pais FROM actores ORDER BY pais;',
        hints: ['`UNION` (sin ALL) elimina duplicados.', '`ORDER BY pais` al final.'],
        explain: '`UNION` es la forma más corta de «los valores de aquí o de allá, sin repetir».',
        commands: ['UNION'],
      }),
      sqlPractice({
        goal: 'Tamaño de las tablas',
        prompt: 'Para el informe de mantenimiento quieres saber cuántas filas tiene cada tabla de la tienda.\n\n**Muestra `tabla` y `filas` para `clientes`, `productos` y `pedidos`, ordenado de más a menos filas.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT 'clientes' AS tabla, COUNT(*) AS filas FROM clientes UNION ALL SELECT 'productos', COUNT(*) FROM productos UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos ORDER BY filas DESC;",
        hints: ["Una consulta por tabla con una columna fija: `'clientes' AS tabla, COUNT(*) AS filas`.", 'Une las tres con `UNION ALL`.'],
        explain: '`UNION ALL` permite juntar resultados de tablas que no tienen nada que ver, siempre que las columnas encajen.',
        commands: ['UNION'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s7-2', { title: 'INTERSECT y EXCEPT', summary: 'Lo que hay en común y lo que solo hay en uno', emoji: '⚖️', commands: ['INTERSECT / EXCEPT'], minutes: 8 }, [
      learn(
        'Comparar dos listas',
        `
Con la misma regla de columnas que \`UNION\`, hay otras dos operaciones de conjuntos:

- \`INTERSECT\`: las filas que están **en las dos** consultas.
- \`EXCEPT\`: las filas de la **primera** que **no están** en la segunda (el orden importa).

\`\`\`
-- países con directores Y con actores
SELECT pais FROM directores
INTERSECT
SELECT pais FROM actores;

-- países con directores pero SIN actores
SELECT pais FROM directores
EXCEPT
SELECT pais FROM actores;
\`\`\`

Los dos **eliminan duplicados** automáticamente. Y a diferencia de \`NOT IN\`, **tratan los NULL como iguales** entre sí, así que no sufren la trampa de antes.
`,
        '⚖️',
      ),
      sqlDemo('Intersección y diferencia', 'cine', [
        ['SELECT pais FROM directores INTERSECT SELECT pais FROM actores ORDER BY pais;', 'Países que están en las dos listas'],
        ['SELECT pais FROM directores EXCEPT SELECT pais FROM actores ORDER BY pais;', 'Países de directores que NO están en actores'],
        ['SELECT pais FROM actores EXCEPT SELECT pais FROM directores ORDER BY pais;', 'Al revés el resultado cambia: EXCEPT no es simétrico'],
      ]),
      mc('Si `A EXCEPT B` devuelve 3 filas, ¿qué devuelve `B EXCEPT A`?', ['Las mismas 3 filas', 'Las filas de B que no están en A, que pueden ser otras', 'Nada', 'Un error'], 1, '`EXCEPT` no es simétrico: depende de cuál va primero.'),
      match(
        'Une cada operación con su significado',
        [
          ['UNION', 'Las filas de una o de otra, sin repetir'],
          ['UNION ALL', 'Las filas de una o de otra, repetidas incluidas'],
          ['INTERSECT', 'Solo las filas que están en las dos'],
          ['EXCEPT', 'Las de la primera que no están en la segunda'],
        ],
        'Cuatro operaciones de conjuntos: dos para sumar, una para quedarse con lo común y otra para restar.',
      ),
      sqlOut('Predice: países con director pero sin actor', 'cine', 'SELECT pais FROM directores EXCEPT SELECT pais FROM actores ORDER BY pais;', ['Australia\nCanadá\nIrlanda', 'Corea del Sur\nEspaña\nEstados Unidos', 'España\nMéxico\nReino Unido'], 'México (Guillermo del Toro) y Reino Unido (Christopher Nolan) tienen director en la base de datos, pero ningún actor de esos países.'),
      tf('`INTERSECT` y `EXCEPT` conservan las filas duplicadas.', false, 'Los dos eliminan duplicados (como `UNION`). Existen variantes `INTERSECT ALL` / `EXCEPT ALL` en otros motores.'),
      sqlCode('Muestra los países de los que hay **actores pero no directores** (columna `pais`), ordenados.', {
        setup: 'cine',
        check: ordered({ names: true, uses: ['EXCEPT'] }),
        solution: 'SELECT pais FROM actores EXCEPT SELECT pais FROM directores ORDER BY pais;',
        hint: 'EXCEPT: primero actores, luego directores',
        why: 'El orden importa: restas los países de los directores a los de los actores.',
      }),
      sqlPractice({
        goal: 'Directores sin actores propios',
        prompt: 'Para un artículo sobre cine, ¿de qué países hay **directores pero ningún actor**?\n\n**Muestra `pais`, ordenados alfabéticamente.** Usa `EXCEPT`.',
        setup: 'cine',
        check: ordered({ names: true, uses: ['EXCEPT'] }),
        solution: 'SELECT pais FROM directores EXCEPT SELECT pais FROM actores ORDER BY pais;',
        hints: ['Directores primero, actores después.', '`EXCEPT` resta la segunda lista de la primera.'],
        explain: '`EXCEPT` es ideal para «los que están en A y no en B» cuando comparas listas de valores.',
        commands: ['INTERSECT / EXCEPT'],
      }),
      sqlPractice({
        goal: 'Seguidores y seguidos',
        prompt: 'En la red social quieres saber qué usuarios **siguen a alguien y además son seguidos por alguien**.\n\n**Muestra su `id` (columna `id`), ordenados.** Usa `INTERSECT` entre `seguidor_id` y `seguido_id` de la tabla `seguidores`.',
        setup: 'social',
        check: ordered({ names: true, uses: ['INTERSECT'] }),
        solution: 'SELECT seguidor_id AS id FROM seguidores INTERSECT SELECT seguido_id FROM seguidores ORDER BY id;',
        hints: ['Dos consultas sobre la misma tabla: una con `seguidor_id` y otra con `seguido_id`.', 'Pon el alias `id` en la primera.'],
        explain: 'Los nombres de columna del resultado son los de la primera consulta. `INTERSECT` deja los ids que aparecen en las dos.',
        commands: ['INTERSECT / EXCEPT'],
      }),
      sqlPractice({
        goal: 'Clientes que nunca compraron',
        prompt: 'Otra forma de encontrar clientes sin pedidos: resta los ids de los que sí compraron.\n\n**Muestra `id` de los clientes sin ningún pedido, usando `EXCEPT` entre `clientes.id` y `pedidos.cliente_id`.**',
        setup: 'tienda',
        check: same({ names: true, uses: ['EXCEPT'] }),
        solution: 'SELECT id FROM clientes EXCEPT SELECT cliente_id FROM pedidos;',
        hints: ['Todos los ids de clientes, menos los que aparecen en pedidos.', '`SELECT id FROM clientes EXCEPT SELECT cliente_id FROM pedidos`'],
        explain: 'Este es el tercer método de «los que no tienen…»: `LEFT JOIN … IS NULL`, `NOT EXISTS` y `EXCEPT`. Los tres dan el mismo resultado; elige el más legible para cada caso.',
        commands: ['INTERSECT / EXCEPT'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s7-3', { title: 'VALUES y generate_series', summary: 'Tablas inventadas y series de números y fechas', emoji: '🔢', commands: ['VALUES', 'generate_series'], minutes: 10 }, [
      learn(
        'Inventar una tabla al vuelo: VALUES',
        `
\`VALUES\` crea una **tabla temporal** escribiendo las filas a mano. Con un alias y los nombres de columna, se usa como cualquier tabla:

\`\`\`
SELECT *
FROM (VALUES ('audio', 10), ('pantallas', 15), ('ordenadores', 5))
     AS d(categoria, descuento);
\`\`\`

Es perfecto para **tablas pequeñas de apoyo** (descuentos, equivalencias, etiquetas) sin crear ninguna tabla de verdad, y para probar ideas rápidamente.
`,
        '🧪',
      ),
      sqlDemo('Una tabla de descuentos al vuelo', 'tienda', [
        ["SELECT * FROM (VALUES ('audio', 10), ('pantallas', 15), ('ordenadores', 5)) AS d(categoria, pct);", 'La tabla temporal tal cual'],
        ["SELECT p.nombre, p.precio, d.pct, ROUND(p.precio * (1 - d.pct / 100.0), 2) AS precio_final FROM productos p JOIN (VALUES ('audio', 10), ('pantallas', 15), ('ordenadores', 5)) AS d(categoria, pct) ON d.categoria = p.categoria ORDER BY p.nombre;", 'Unida con productos mediante JOIN: cada categoría con su descuento'],
      ]),
      learn(
        'Series de números y de fechas: generate_series',
        `
\`generate_series(inicio, fin [, paso])\` es una función que **produce una fila por cada valor** de una secuencia:

\`\`\`
SELECT * FROM generate_series(1, 10);          -- 1, 2, … 10
SELECT * FROM generate_series(1, 10, 3);       -- 1, 4, 7, 10
SELECT * FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month');  -- 12 meses
\`\`\`

Sirve para:

- **Calendarios**: tener una fila por cada día o mes, hayan ocurrido cosas o no.
- **Rellenar huecos**: un \`LEFT JOIN\` desde el calendario hacia tus datos muestra los meses con **cero** pedidos (que un \`GROUP BY\` normal no devolvería).
- Generar datos de prueba.
`,
        '📆',
      ),
      sqlDemo('Calendarios y series', 'tienda', [
        ['SELECT n, n * n AS cuadrado FROM generate_series(1, 5) AS n;', 'Los cuadrados del 1 al 5'],
        ["SELECT strftime('%Y-%m', m) AS mes FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m;", 'Los 12 meses de 2024'],
        ["SELECT strftime('%Y-%m', m) AS mes, COUNT(p.id) AS pedidos FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m LEFT JOIN pedidos p ON strftime('%Y-%m', p.fecha) = strftime('%Y-%m', m) GROUP BY mes ORDER BY mes;", 'Pedidos por mes SIN huecos: diciembre aparece con 0 (un GROUP BY normal no lo mostraría)'],
      ]),
      mc('¿Cuántas filas devuelve `SELECT * FROM generate_series(1, 10, 3)`?', ['10', '4', '3', '1'], 1, 'Valores 1, 4, 7 y 10: cuatro filas.'),
      sqlOut('Predice la serie', 'tienda', 'SELECT n, n * n FROM generate_series(1, 4) AS n;', ['1 | 1\n2 | 2\n3 | 3\n4 | 4', '1 | 1\n2 | 4\n3 | 9', '0 | 0\n1 | 1\n2 | 4\n3 | 9\n4 | 16'], '`generate_series(1, 4)` produce 1, 2, 3 y 4 (incluyendo el final) y la segunda columna es su cuadrado.'),
      tf('Un `GROUP BY mes` sobre la tabla de pedidos muestra también los meses sin ningún pedido.', false, 'Los meses sin pedidos no tienen filas que agrupar, así que no aparecen. Para verlos hace falta un calendario generado y un `LEFT JOIN`.'),
      sqlCode('Genera los días del 1 al 7 de enero de 2024 (columna `dia`) con `generate_series` de fechas, uno por fila.', {
        setup: 'tienda',
        check: same({ names: true, uses: ['generate_series'] }),
        solution: "SELECT d AS dia FROM generate_series('2024-01-01'::date, '2024-01-07'::date, '1 day') AS d;",
        hint: "generate_series('2024-01-01'::date, '2024-01-07'::date, '1 day')",
        why: 'Con fechas, el tercer argumento es el intervalo del paso (`1 day`).',
      }),
      sqlPractice({
        goal: 'Tabla de cuadrados',
        prompt: 'Genera, sin ninguna tabla, los números del **1 al 10** con su cuadrado.\n\n**Muestra `n` y `cuadrado` (`n * n`).**',
        setup: 'tienda',
        check: same({ names: true, uses: ['generate_series'] }),
        solution: 'SELECT n, n * n AS cuadrado FROM generate_series(1, 10) AS n;',
        hints: ['`FROM generate_series(1, 10) AS n`', '`n * n AS cuadrado`'],
        explain: '`generate_series` convierte un rango en una tabla de una sola columna. A partir de ahí es SQL normal.',
        commands: ['generate_series'],
      }),
      sqlPractice({
        goal: 'Rebajas por categoría',
        prompt: 'Las rebajas varían por categoría: audio 10 %, pantallas 15 %, ordenadores 5 %. El resto no tiene descuento.\n\n**Muestra `nombre`, `precio` y `precio_final` (precio con el descuento aplicado, 2 decimales) solo de las categorías con rebaja, ordenado por nombre.** Define los descuentos con `VALUES`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['VALUES'] }),
        solution: "SELECT p.nombre, p.precio, ROUND(p.precio * (1 - d.pct / 100.0), 2) AS precio_final FROM productos p JOIN (VALUES ('audio', 10), ('pantallas', 15), ('ordenadores', 5)) AS d(categoria, pct) ON d.categoria = p.categoria ORDER BY p.nombre;",
        hints: ["Una tabla `VALUES ('audio', 10), …` con alias `d(categoria, pct)`.", 'Únela con `productos` por categoría.'],
        explain: '`VALUES` evita crear una tabla de descuentos solo para esta consulta. Con `JOIN` los productos sin descuento desaparecen (no tienen pareja).',
        commands: ['VALUES'],
      }),
      sqlPractice({
        goal: 'Pedidos mes a mes, sin huecos',
        prompt: 'El gráfico de evolución de pedidos debe mostrar **los 12 meses de 2024**, también los meses sin ningún pedido.\n\n**Muestra `mes` (formato `AAAA-MM`) y `pedidos` (cuántos), ordenado por mes.** Usa `generate_series` de fechas y un `LEFT JOIN`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['generate_series', 'LEFT JOIN'] }),
        solution: "SELECT strftime('%Y-%m', m) AS mes, COUNT(p.id) AS pedidos FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m LEFT JOIN pedidos p ON strftime('%Y-%m', p.fecha) = strftime('%Y-%m', m) GROUP BY mes ORDER BY mes;",
        hints: ['El calendario es `generate_series(…, \'1 month\')`.', 'Cuenta con `COUNT(p.id)` para que los meses vacíos den 0.'],
        explain: 'El calendario aporta las filas que faltan y el `LEFT JOIN` + `COUNT(p.id)` las llena con ceros. Esta técnica de «rellenar huecos» es imprescindible en informes y gráficos.',
        commands: ['generate_series', 'LEFT JOIN'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s7-4', { title: 'Listas y resúmenes avanzados', summary: 'STRING_AGG, COUNT DISTINCT y estadística básica', emoji: '🧵', commands: ['STRING_AGG'], minutes: 9 }, [
      learn(
        'Unir los valores de un grupo en un solo texto',
        `
\`STRING_AGG(columna, separador)\` es una agregación que **concatena los valores de cada grupo** en un único texto:

\`\`\`
SELECT categoria,
       STRING_AGG(nombre, ', ' ORDER BY nombre) AS productos
FROM productos
GROUP BY categoria;
\`\`\`

- El \`ORDER BY\` **dentro** de la función controla el orden de la lista.
- \`DISTINCT\` dentro (\`STRING_AGG(DISTINCT col, ', ')\`) evita repetidos.
- En SQLite y MySQL se llama \`GROUP_CONCAT\`; aquí funcionan los dos nombres.

Es la forma de pasar de «una fila por producto» a «una fila por categoría con la lista de sus productos».
`,
        '🧵',
      ),
      sqlDemo('Listas por grupo', 'tienda', [
        ["SELECT categoria, STRING_AGG(nombre, ', ' ORDER BY nombre) AS productos FROM productos GROUP BY categoria ORDER BY categoria;", 'Productos de cada categoría, en una sola celda y ordenados'],
        ["SELECT categoria, GROUP_CONCAT(nombre, ' / ') AS productos FROM productos GROUP BY categoria ORDER BY categoria;", 'GROUP_CONCAT: otro nombre para lo mismo (sin ORDER BY interno, el orden es el de lectura)'],
      ]),
      learn(
        'Más resúmenes para estadística rápida',
        `
Además de \`COUNT\`, \`SUM\`, \`AVG\`, \`MIN\` y \`MAX\` hay:

- \`COUNT(DISTINCT col)\`: cuántos valores diferentes.
- \`MEDIAN(col)\`: la **mediana** (el valor central), menos sensible a valores extremos que la media.
- \`STDDEV(col)\` y \`VARIANCE(col)\`: desviación típica y varianza, que miden cuánto se dispersan los datos.

Una media de 238 € en una tienda con un portátil de 1299 € y cables de 7 € es engañosa: la mediana (49,45 €) cuenta mejor lo que cuesta un producto «típico».
`,
        '📈',
      ),
      sqlDemo('Media, mediana y dispersión', 'tienda', [
        ['SELECT ROUND(AVG(precio), 2) AS media, MEDIAN(precio) AS mediana, ROUND(STDDEV(precio), 2) AS desviacion FROM productos;', 'La media (238,82) y la mediana (49,45) no se parecen: hay productos muy caros que tiran de la media'],
      ]),
      sqlDemo('Un resumen completo por asignatura', 'escuela', [
        ['SELECT s.nombre, COUNT(DISTINCT m.alumno_id) AS alumnos, ROUND(AVG(m.nota), 2) AS media, MIN(m.nota) AS minima, MAX(m.nota) AS maxima FROM asignaturas s LEFT JOIN matriculas m ON m.asignatura_id = s.id GROUP BY s.id, s.nombre ORDER BY s.nombre;', 'Un resumen completo por asignatura (la de Ética no tiene alumnos: 0 y NULL)'],
      ]),
      mc('Los salarios de una empresa son 1200, 1300, 1400, 1500 y 90 000. ¿Qué cifra representa mejor al empleado «típico»?', ['La media', 'La mediana', 'El máximo', 'La suma'], 1, 'La mediana (1400) no se deja arrastrar por el sueldo extremo; la media (19 080) engaña.'),
      sqlOut('Predice la lista agregada', 'tienda', "SELECT categoria, STRING_AGG(nombre, ', ' ORDER BY nombre) FROM productos WHERE categoria IN ('audio', 'pantallas') GROUP BY categoria ORDER BY categoria;", ['audio | Auriculares Bluetooth, Altavoz portátil\npantallas | Monitor 27 pulgadas, Monitor 24 pulgadas', 'audio | Altavoz portátil\npantallas | Monitor 24 pulgadas', 'Altavoz portátil, Auriculares Bluetooth, Monitor 24 pulgadas, Monitor 27 pulgadas'], 'Una fila por categoría, con los nombres ordenados alfabéticamente: Altavoz antes que Auriculares y Monitor 24 antes que Monitor 27.'),
      tf('`STRING_AGG` devuelve una fila por cada valor del grupo.', false, 'Es una agregación: devuelve **una** fila por grupo con todos los valores unidos en un texto.'),
      sqlCode('Muestra, por cada director, los títulos de sus películas en una sola celda, separados por `\', \'` y ordenados por año (`director` y `peliculas`). Ordena el resultado por director.', {
        setup: 'cine',
        check: ordered({ names: true }),
        solution: "SELECT d.nombre AS director, STRING_AGG(p.titulo, ', ' ORDER BY p.anio) AS peliculas FROM directores d JOIN peliculas p ON p.director_id = d.id GROUP BY d.id, d.nombre ORDER BY d.nombre;",
        hint: "STRING_AGG(p.titulo, ', ' ORDER BY p.anio)",
        why: 'La agregación une los títulos de cada director; el `ORDER BY` interno los ordena por año.',
      }),
      sqlPractice({
        goal: 'Catálogo en una línea',
        prompt: 'La web necesita, por categoría, la lista de sus productos en una sola línea.\n\n**Muestra `categoria` y `productos` (nombres separados por `\', \'` y en orden alfabético), ordenado por categoría.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT categoria, STRING_AGG(nombre, ', ' ORDER BY nombre) AS productos FROM productos GROUP BY categoria ORDER BY categoria;",
        hints: ['Agrupa por `categoria`.', "`STRING_AGG(nombre, ', ' ORDER BY nombre)`"],
        explain: '`STRING_AGG` convierte filas en una lista legible. Muy útil para informes y exportaciones.',
        commands: ['STRING_AGG'],
      }),
      sqlPractice({
        goal: 'Obras de cada autor',
        prompt: 'En la biblioteca, para los autores con **más de un libro**:\n\n**Muestra `autor` (nombre), `obras` (títulos ordenados por año, separados por `\'; \'`) y `n` (cuántos), ordenado por `n` descendente y luego por autor.**',
        setup: 'biblioteca',
        check: ordered({ names: true }),
        solution: "SELECT a.nombre AS autor, STRING_AGG(l.titulo, '; ' ORDER BY l.anio) AS obras, COUNT(*) AS n FROM autores a JOIN libros l ON l.autor_id = a.id GROUP BY a.id, a.nombre HAVING COUNT(*) > 1 ORDER BY n DESC, a.nombre;",
        hints: ['Une `autores` con `libros`.', '`HAVING COUNT(*) > 1` deja a los autores con varios libros.'],
        explain: 'Una agregación de texto y un recuento en la misma consulta: la lista y su tamaño. `HAVING` filtra a los autores con un solo libro.',
        commands: ['STRING_AGG', 'HAVING'],
      }),
      sqlPractice({
        goal: 'Radiografía de las asignaturas',
        prompt: 'Para la memoria del curso, por **asignatura** (incluida la que no tiene alumnos):\n\n**Muestra `nombre`, `alumnos` (alumnos distintos), `media` (nota media, 2 decimales), `minima` y `maxima`, ordenado por nombre.**',
        setup: 'escuela',
        check: ordered({ names: true }),
        solution: 'SELECT s.nombre, COUNT(DISTINCT m.alumno_id) AS alumnos, ROUND(AVG(m.nota), 2) AS media, MIN(m.nota) AS minima, MAX(m.nota) AS maxima FROM asignaturas s LEFT JOIN matriculas m ON m.asignatura_id = s.id GROUP BY s.id, s.nombre ORDER BY s.nombre;',
        hints: ['`LEFT JOIN` para que no desaparezca la asignatura sin alumnos.', 'Cuatro agregaciones distintas.'],
        explain: 'Un `LEFT JOIN` más varias agregaciones: la receta del «informe completo por categoría». La asignatura sin alumnos sale con 0 alumnos y NULL en las estadísticas.',
        commands: ['COUNT', 'AVG', 'MIN / MAX'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s7-5', { title: 'Patrones de análisis', summary: 'Porcentajes del total, duplicados y rankings', emoji: '🔬', commands: ['Porcentaje sobre el total', 'Buscar duplicados'], minutes: 10 }, [
      learn(
        'Qué parte del total es cada grupo',
        `
Un número aislado dice poco: «360 unidades de accesorios». Un **porcentaje** lo contextualiza: «el 64 % del stock». La receta:

\`\`\`
SELECT categoria,
       SUM(stock) AS unidades,
       ROUND(100.0 * SUM(stock) / (SELECT SUM(stock) FROM productos), 1) AS porcentaje
FROM productos
GROUP BY categoria
ORDER BY porcentaje DESC;
\`\`\`

- \`100.0 *\` fuerza decimales (si no, la división entera da 0).
- La **subconsulta escalar** calcula el total una vez y se usa como denominador.
- En la zona de ventanas verás una forma aún más corta con \`SUM(…) OVER ()\`.
`,
        '🥧',
      ),
      sqlDemo('Porcentaje del total', 'tienda', [
        ['SELECT categoria, SUM(stock) AS unidades, ROUND(100.0 * SUM(stock) / (SELECT SUM(stock) FROM productos), 1) AS porcentaje FROM productos GROUP BY categoria ORDER BY porcentaje DESC;', 'Cada categoría y su peso en el stock total'],
      ]),
      learn(
        'Encontrar duplicados',
        `
Tras importar datos de varias fuentes es habitual que haya **filas repetidas**: el mismo email dos veces, el mismo cliente con distintas grafías. El patrón para localizarlos:

\`\`\`
SELECT email, COUNT(*) AS veces
FROM contactos
GROUP BY email
HAVING COUNT(*) > 1;
\`\`\`

Agrupa por lo que **debería ser único** y quédate con los grupos de más de una fila. Para ver **qué filas** concretas son, une el resultado con la tabla original (o usa una subconsulta con \`IN\`).
`,
        '👯',
      ),
      sqlDemo('Una libreta con contactos repetidos', { db: 'vacia', script: "CREATE TABLE contactos (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT); INSERT INTO contactos VALUES (1,'Ana','ana@x.com'),(2,'Luis','luis@x.com'),(3,'Ana B.','ana@x.com'),(4,'Marta','marta@x.com'),(5,'Luis M.','luis@x.com'),(6,'Pía','pia@x.com');" }, [
        ['SELECT email, COUNT(*) AS veces FROM contactos GROUP BY email HAVING COUNT(*) > 1 ORDER BY email;', 'Emails que aparecen más de una vez'],
        ['SELECT id, nombre, email FROM contactos WHERE email IN (SELECT email FROM contactos GROUP BY email HAVING COUNT(*) > 1) ORDER BY email, id;', 'Y ahora las filas concretas que están repetidas'],
      ]),
      mc('¿Por qué se escribe `100.0 * SUM(x) / total` y no `100 * SUM(x) / total`?', ['Por estilo', 'Para evitar la división entera, que daría 0 o un valor sin decimales', 'Porque 100 no se puede usar', 'Para que sea más rápido'], 1, 'Entre enteros, la división descarta los decimales. Multiplicar por `100.0` fuerza el cálculo decimal.'),
      sqlOut('Predice los dos primeros porcentajes', 'tienda', 'SELECT categoria, ROUND(100.0 * SUM(stock) / (SELECT SUM(stock) FROM productos), 1) AS pct FROM productos GROUP BY categoria ORDER BY pct DESC LIMIT 2;', ['accesorios | 360\nperifericos | 107', 'accesorios | 0.6\nperifericos | 0.2', 'accesorios | 4\nperifericos | 3'], 'Accesorios suma 360 de las 559 unidades totales (64,4 %) y periféricos 107 (19,1 %).'),
      tf('Para encontrar duplicados se usa `WHERE COUNT(*) > 1`.', false, 'El recuento es una agregación, así que va en `HAVING COUNT(*) > 1` después de `GROUP BY`.'),
      sqlCode('Muestra el `nombre` y `salario` del empleado con el salario más alto de toda la empresa, usando una subconsulta con `MAX`.', {
        setup: 'empresa',
        check: same({ names: true, uses: ['SUBQUERY'] }),
        solution: 'SELECT nombre, salario FROM empleados WHERE salario = (SELECT MAX(salario) FROM empleados);',
        hint: 'WHERE salario = (SELECT MAX(salario) FROM empleados)',
        why: 'La subconsulta devuelve el salario máximo y la consulta exterior busca quién lo cobra.',
      }),
      sqlPractice({
        goal: 'El reparto del stock',
        prompt: 'La directora quiere ver cómo se reparte el stock entre categorías.\n\n**Muestra `categoria`, `unidades` (suma de stock) y `porcentaje` (sobre el total, 1 decimal), ordenado por porcentaje descendente.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT categoria, SUM(stock) AS unidades, ROUND(100.0 * SUM(stock) / (SELECT SUM(stock) FROM productos), 1) AS porcentaje FROM productos GROUP BY categoria ORDER BY porcentaje DESC;',
        hints: ['El total sale de una subconsulta escalar: `(SELECT SUM(stock) FROM productos)`.', 'Multiplica por `100.0`.'],
        explain: 'Agrupar, dividir entre el total y redondear: el patrón universal de «qué porcentaje supone cada parte».',
        commands: ['Porcentaje sobre el total'],
      }),
      sqlPractice({
        goal: 'Limpieza de contactos',
        prompt: 'Esta libreta de contactos tiene filas duplicadas (mismo email).\n\n**Muestra `email` y `veces` de los emails que aparecen más de una vez, ordenados por email.**',
        setup: { db: 'vacia', script: "CREATE TABLE contactos (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT); INSERT INTO contactos VALUES (1,'Ana','ana@x.com'),(2,'Luis','luis@x.com'),(3,'Ana B.','ana@x.com'),(4,'Marta','marta@x.com'),(5,'Luis M.','luis@x.com'),(6,'Pía','pia@x.com');" },
        check: ordered({ names: true }),
        solution: 'SELECT email, COUNT(*) AS veces FROM contactos GROUP BY email HAVING COUNT(*) > 1 ORDER BY email;',
        hints: ['Agrupa por `email`.', '`HAVING COUNT(*) > 1`'],
        explain: 'Agrupar por lo que debería ser único y quedarse con los grupos de más de una fila es la técnica clásica para detectar duplicados.',
        commands: ['Buscar duplicados', 'HAVING'],
      }),
      sqlPractice({
        goal: 'El peso de cada usuario',
        prompt: 'En la red social quieres saber qué porcentaje de los likes totales aporta cada usuario.\n\n**Muestra `alias` y `porcentaje` (de los likes totales, 1 decimal) de los 3 usuarios con más aportación, de mayor a menor.**',
        setup: 'social',
        check: ordered({ names: true }),
        solution: 'SELECT u.alias, ROUND(100.0 * SUM(p.likes) / (SELECT SUM(likes) FROM publicaciones), 1) AS porcentaje FROM usuarios u JOIN publicaciones p ON p.usuario_id = u.id GROUP BY u.id, u.alias ORDER BY porcentaje DESC LIMIT 3;',
        hints: ['Une `usuarios` con `publicaciones`.', 'El total es `(SELECT SUM(likes) FROM publicaciones)`.'],
        explain: 'Un `JOIN`, un `GROUP BY`, un porcentaje y un `LIMIT`: casi todos los análisis reales se construyen con estas piezas.',
        commands: ['Porcentaje sobre el total', 'GROUP BY'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el informe del almacén',
    prompt:
      'El director de logística quiere un informe del almacén **por categoría** con:\n\n- `categoria`.\n- `porcentaje`: qué % del stock total (unidades) supone, con **1 decimal**.\n- `productos`: los nombres de sus productos separados por `\', \'` y **en orden alfabético**.\n\n**Ordena de mayor a menor porcentaje y, si empatan, por categoría.**',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: "SELECT categoria, ROUND(100.0 * SUM(stock) / (SELECT SUM(stock) FROM productos), 1) AS porcentaje, STRING_AGG(nombre, ', ' ORDER BY nombre) AS productos FROM productos GROUP BY categoria ORDER BY porcentaje DESC, categoria;",
    hints: ['Un solo `GROUP BY categoria` con dos agregaciones.', "`STRING_AGG(nombre, ', ' ORDER BY nombre)`"],
    explain: 'Porcentaje sobre el total y lista agregada en un único informe. Has completado el nivel Intermedio de análisis de datos: ¡enhorabuena!',
    commands: ['Porcentaje sobre el total', 'STRING_AGG'],
  },
});
