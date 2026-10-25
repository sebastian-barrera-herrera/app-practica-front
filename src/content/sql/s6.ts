import { fill, learn, lesson, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s6 = sqlWorld({
  id: 's6',
  index: 6,
  title: 'Subconsultas y CTE',
  subtitle: 'Consultas dentro de consultas',
  emoji: '🪆',
  color: '#F472B6',
  level: 'intermedio',
  intro:
    'Algunas preguntas no se contestan de un tirón: «¿qué productos cuestan más que la media?» necesita **primero** calcular la media y **después** comparar. Las subconsultas permiten meter una consulta dentro de otra, y las CTE (`WITH`) dejan darle nombre a cada paso para que el SQL se lea como una receta. Dominarlas es lo que separa las consultas de una línea de las que resuelven problemas de verdad.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s6-1', { title: 'Subconsultas en WHERE', summary: 'Un valor o una lista calculados al vuelo', emoji: '🪆', commands: ['Subconsulta', 'IN'], minutes: 9 }, [
      learn(
        'Una consulta dentro de otra',
        `
Una **subconsulta** es un \`SELECT\` entre **paréntesis** dentro de otra consulta. La base de datos resuelve **primero la de dentro** y usa su resultado en la de fuera.

\`\`\`
SELECT nombre, precio
FROM productos
WHERE precio > (SELECT AVG(precio) FROM productos);
\`\`\`

1. La interior calcula la media de precios: \`238.82\`.
2. La exterior se convierte en \`WHERE precio > 238.82\`.

Esta subconsulta devuelve **un solo valor** (una fila y una columna): es una **subconsulta escalar** y se puede usar donde iría un número o un texto: \`=\`, \`>\`, \`<\`…
`,
        '🪆',
      ),
      sqlDemo('Comparar con un valor calculado', 'tienda', [
        ['SELECT AVG(precio) FROM productos;', 'Primero la media por separado'],
        ['SELECT nombre, precio FROM productos WHERE precio > (SELECT AVG(precio) FROM productos) ORDER BY precio;', 'Ahora la misma media dentro de la consulta: solo los productos por encima'],
        ['SELECT nombre FROM productos WHERE precio = (SELECT MAX(precio) FROM productos);', 'El producto más caro (por si hubiera empate, saldrían todos)'],
      ]),
      learn(
        'Subconsultas que devuelven una lista: IN',
        `
Si la subconsulta devuelve **varias filas de una sola columna**, ya no es un valor sino una **lista**, y se usa con \`IN\`:

\`\`\`
SELECT id, fecha
FROM pedidos
WHERE cliente_id IN (SELECT id FROM clientes WHERE vip);
\`\`\`

«Los pedidos cuyos clientes están en la lista de clientes VIP». Es una alternativa a un \`JOIN\` cuando solo quieres **filtrar**, sin traer columnas de la otra tabla.

> OJO: Una subconsulta escalar **debe devolver exactamente una fila y una columna**. Si devuelve más, el motor da error.
`,
        '📋',
      ),
      sqlDemo('Listas y errores de forma', 'tienda', [
        ['SELECT id, fecha FROM pedidos WHERE cliente_id IN (SELECT id FROM clientes WHERE vip) ORDER BY id;', 'Pedidos de clientes VIP, sin JOIN'],
        sqlErr("SELECT nombre FROM productos WHERE precio > (SELECT precio FROM productos WHERE categoria = 'audio');", 'Hay dos productos de audio: la subconsulta devuelve dos filas y no se puede comparar con un valor'),
        ['SELECT nombre FROM productos WHERE precio > (SELECT MAX(precio) FROM productos WHERE categoria = \'audio\');', 'Con MAX vuelve a ser un solo valor: más caros que cualquier producto de audio'],
      ]),
      mc('¿Qué devuelve la subconsulta de `WHERE precio > (SELECT AVG(precio) FROM productos)`?', ['Una lista de precios', 'Un único valor: la media', 'Todas las filas de productos', 'Un error'], 1, 'Una agregación sin `GROUP BY` devuelve una sola fila y una sola columna: es una subconsulta escalar.'),
      sqlOut('Predice: ¿qué productos superan la media?', 'tienda', 'SELECT nombre FROM productos WHERE precio > (SELECT AVG(precio) FROM productos) ORDER BY precio;', ['Portátil Air 13\nPortátil Pro 15', 'Monitor 27 pulgadas\nMonitor 24 pulgadas\nTablet 10 pulgadas\nPortátil Air 13\nPortátil Pro 15', 'Teclado mecánico\nMonitor 27 pulgadas\nTablet 10 pulgadas\nPortátil Air 13\nPortátil Pro 15'], 'La media es 238,82 €: la superan el Monitor 27 (249), la Tablet (329) y los dos portátiles. El Monitor 24 (159,99) no.'),
      tf('`WHERE cliente_id IN (SELECT id FROM clientes WHERE vip)` puede devolver pedidos de varios clientes.', true, '`IN` admite una lista de varios valores: devuelve los pedidos de todos los clientes VIP.'),
      sqlCode('Muestra el `nombre` de los productos que cuestan más que la media del precio de todos los productos.', {
        setup: 'tienda',
        check: same({ uses: ['SUBQUERY'] }),
        solution: 'SELECT nombre FROM productos WHERE precio > (SELECT AVG(precio) FROM productos);',
        hint: 'WHERE precio > (SELECT AVG(precio) FROM productos)',
        why: 'La subconsulta calcula la media y la consulta exterior la usa para comparar.',
      }),
      sqlPractice({
        goal: 'Películas por encima de la media',
        prompt: 'El cine quiere destacar las películas mejor valoradas que la media.\n\n**Muestra `titulo` y `puntuacion` de las películas con puntuación mayor que la media de todas, ordenadas de mayor a menor puntuación y luego por título.**',
        setup: 'cine',
        check: ordered({ names: true, uses: ['SUBQUERY'] }),
        solution: 'SELECT titulo, puntuacion FROM peliculas WHERE puntuacion > (SELECT AVG(puntuacion) FROM peliculas) ORDER BY puntuacion DESC, titulo;',
        hints: ['La media se calcula con una subconsulta.', '`AVG` ignora los NULL: la película sin estrenar no cuenta en la media.'],
        explain: 'Una subconsulta escalar convierte «la media» en un valor que se puede comparar. Si la media cambia (nuevas películas), la consulta se ajusta sola.',
        commands: ['Subconsulta'],
      }),
      sqlPractice({
        goal: 'Pedidos de clientes VIP',
        prompt: 'Atención VIP necesita sus pedidos de marzo en adelante.\n\n**Muestra `id`, `fecha` y `estado` de los pedidos de clientes VIP hechos el 1 de marzo de 2024 o después, ordenados por `id`.** Usa una subconsulta con `IN` para los VIP.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['IN'] }),
        solution: "SELECT id, fecha, estado FROM pedidos WHERE fecha >= '2024-03-01' AND cliente_id IN (SELECT id FROM clientes WHERE vip) ORDER BY id;",
        hints: ['La lista de clientes VIP es `SELECT id FROM clientes WHERE vip`.', 'Combínala con la condición de fecha usando `AND`.'],
        explain: '`IN (subconsulta)` es la forma de filtrar una tabla con una lista que sale de otra.',
        commands: ['IN', 'Subconsulta'],
      }),
      sqlPractice({
        goal: 'Productos populares',
        prompt: 'Compras quiere saber qué productos se han vendido bien: aquellos de los que se han pedido **5 o más unidades en total** (suma de `cantidad` en `detalle_pedido`).\n\n**Muestra el `nombre` de esos productos, ordenado alfabéticamente.** Usa `IN` con una subconsulta que agrupe `detalle_pedido`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['IN'] }),
        solution: 'SELECT nombre FROM productos WHERE id IN (SELECT producto_id FROM detalle_pedido GROUP BY producto_id HAVING SUM(cantidad) >= 5) ORDER BY nombre;',
        hints: ['La subconsulta agrupa `detalle_pedido` por `producto_id`.', '`HAVING SUM(cantidad) >= 5`'],
        explain: 'La subconsulta puede ser tan compleja como quieras (aquí, con `GROUP BY` y `HAVING`); lo único que importa es que devuelva una columna.',
        commands: ['IN', 'Subconsulta'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s6-2', { title: 'EXISTS y NOT EXISTS', summary: 'Subconsultas correlacionadas y la trampa del NOT IN', emoji: '🔎', commands: ['EXISTS', 'Subconsulta correlacionada'], minutes: 10 }, [
      learn(
        'Preguntar «¿hay alguno?»',
        `
\`EXISTS (subconsulta)\` es verdadero si la subconsulta devuelve **al menos una fila**. No importa qué columnas devuelva (por costumbre se escribe \`SELECT 1\`), solo si hay filas.

\`\`\`
SELECT nombre
FROM clientes c
WHERE EXISTS (
  SELECT 1 FROM pedidos p
  WHERE p.cliente_id = c.id AND p.estado = 'entregado'
);
\`\`\`

Fíjate en que la subconsulta usa \`c.id\`, de la consulta de fuera: es una **subconsulta correlacionada**. Se evalúa **una vez por cada fila** de la consulta exterior: «para este cliente, ¿existe algún pedido entregado suyo?».
`,
        '🔎',
      ),
      sqlDemo('EXISTS y NOT EXISTS', 'tienda', [
        ["SELECT nombre FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.estado = 'entregado') ORDER BY nombre;", 'Clientes con al menos un pedido entregado'],
        ['SELECT nombre FROM clientes c WHERE NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id);', 'NOT EXISTS: clientes sin ningún pedido (el anti-join de otra forma)'],
        ['SELECT nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c ORDER BY pedidos DESC, nombre LIMIT 4;', 'Una subconsulta correlacionada también puede ir en el SELECT'],
      ]),
      learn(
        'La trampa mortal de NOT IN con NULL',
        `
\`NOT IN\` y \`NOT EXISTS\` parecen iguales, pero **no lo son** cuando la lista contiene **NULL**.

Recuerda: \`x NOT IN (1, 2, NULL)\` equivale a \`x <> 1 AND x <> 2 AND x <> NULL\`, y la última comparación es **desconocida**. El resultado total nunca es verdadero: **no devuelve ninguna fila**.

En la tabla \`empleados\` la directora general tiene \`jefe_id\` NULL. Si preguntas «¿quiénes no son jefe de nadie?» con \`NOT IN (SELECT jefe_id …)\`, el NULL lo arruina todo.

> CLAVE: Para «los que no tienen…» usa \`NOT EXISTS\` o un \`LEFT JOIN … IS NULL\`. Si usas \`NOT IN\`, asegúrate de que la subconsulta no devuelve NULL (\`WHERE col IS NOT NULL\`).
`,
        '☠️',
      ),
      sqlDemo('Comprobándolo con datos', 'empresa', [
        ['SELECT nombre FROM empleados WHERE id NOT IN (SELECT jefe_id FROM empleados);', 'NOT IN con un NULL en la lista: ¡no sale nadie!'],
        ['SELECT nombre FROM empleados e WHERE NOT EXISTS (SELECT 1 FROM empleados x WHERE x.jefe_id = e.id) ORDER BY id;', 'NOT EXISTS lo hace bien: los 10 empleados que no son jefe de nadie'],
        ['SELECT nombre FROM empleados WHERE id NOT IN (SELECT jefe_id FROM empleados WHERE jefe_id IS NOT NULL) ORDER BY id;', 'También funciona si quitas los NULL de la lista'],
      ]),
      sqlOut('Predice: ¿qué devuelve este NOT IN?', 'empresa', 'SELECT nombre FROM empleados WHERE id NOT IN (SELECT jefe_id FROM empleados);', ['Daniela Pons\nEsteban Gil\nFátima Ríos\nGonzalo Mora\nHelena Cruz', 'Carolina Vega', 'NULL'], 'La subconsulta incluye un NULL (la directora general no tiene jefe), así que `NOT IN` nunca es verdadero y **no devuelve ninguna fila**.'),
      mc('Quieres los clientes **sin** pedidos y la tabla `pedidos` podría tener `cliente_id` NULL. ¿Qué es lo más seguro?', ['`WHERE id NOT IN (SELECT cliente_id FROM pedidos)`', '`WHERE NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id)`', '`WHERE id <> (SELECT cliente_id FROM pedidos)`', 'Ninguna: no se puede'], 1, '`NOT EXISTS` no se ve afectado por los NULL. `NOT IN` puede devolver vacío si algún valor de la lista es NULL.'),
      tf('`EXISTS` devuelve las filas de la subconsulta.', false, '`EXISTS` solo devuelve verdadero o falso (si la subconsulta tiene filas). No trae ningún dato de ella.'),
      sqlCode('Muestra el `nombre` de los clientes que tienen al menos un pedido `pendiente` (usa `EXISTS`).', {
        setup: 'tienda',
        check: same({ uses: ['EXISTS'] }),
        solution: "SELECT nombre FROM clientes c WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.estado = 'pendiente');",
        hint: 'La subconsulta debe usar c.id',
        why: 'Para cada cliente se pregunta si existe algún pedido suyo con estado pendiente.',
      }),
      sqlPractice({
        goal: 'Clientes sin compras',
        prompt: 'Marketing prepara un correo para quienes **nunca han hecho un pedido**.\n\n**Muestra `nombre` y `email` de los clientes sin ningún pedido.** Usa `NOT EXISTS`.',
        setup: 'tienda',
        check: same({ names: true, uses: ['NOT EXISTS'] }),
        solution: 'SELECT nombre, email FROM clientes c WHERE NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id);',
        hints: ['La subconsulta busca pedidos del cliente `c.id`.', '`NOT EXISTS` deja pasar a quien no tiene ninguno.'],
        explain: 'Es el mismo resultado que el anti-join con `LEFT JOIN`, pero expresado como «no existe ningún pedido suyo». Elige el que te resulte más claro.',
        commands: ['EXISTS'],
      }),
      sqlPractice({
        goal: 'Las hojas del organigrama',
        prompt: 'RR. HH. quiere saber qué empleados **no tienen a nadie a su cargo**.\n\n**Muestra `nombre` y `cargo` de los empleados de los que no depende nadie** (no son `jefe_id` de ningún otro), ordenados por `id`.',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['NOT EXISTS'] }),
        solution: 'SELECT nombre, cargo FROM empleados e WHERE NOT EXISTS (SELECT 1 FROM empleados x WHERE x.jefe_id = e.id) ORDER BY id;',
        hints: ['Busca si existe algún empleado `x` con `x.jefe_id = e.id`.', 'Usa `NOT EXISTS`, no `NOT IN`: hay un NULL escondido.'],
        explain: 'Aquí `NOT IN` habría devuelto una tabla vacía por el NULL de la directora general. `NOT EXISTS` es inmune.',
        commands: ['EXISTS', 'Subconsulta correlacionada'],
      }),
      sqlPractice({
        goal: 'Libros sin devolver',
        prompt: 'La biblioteca busca los **libros que tienen algún préstamo sin devolver** (`fecha_devolucion` NULL).\n\n**Muestra `titulo` de esos libros, ordenados alfabéticamente.** Usa `EXISTS`.',
        setup: 'biblioteca',
        check: ordered({ names: true, uses: ['EXISTS'] }),
        solution: 'SELECT titulo FROM libros l WHERE EXISTS (SELECT 1 FROM prestamos p WHERE p.libro_id = l.id AND p.fecha_devolucion IS NULL) ORDER BY titulo;',
        hints: ['Para cada libro, ¿existe un préstamo suyo con `fecha_devolucion IS NULL`?', 'Correlaciona con `p.libro_id = l.id`.'],
        explain: '`EXISTS` combina de forma natural un filtro (`IS NULL`) con una correlación entre tablas.',
        commands: ['EXISTS'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s6-3', { title: 'Subconsultas en FROM y en SELECT', summary: 'Tablas derivadas y valores calculados por fila', emoji: '🧱', commands: ['Tabla derivada'], minutes: 10 }, [
      learn(
        'Una consulta como si fuera una tabla',
        `
Una subconsulta también puede ir en el \`FROM\`: su resultado se trata **como una tabla temporal** a la que **hay que ponerle alias**. Se llama **tabla derivada**.

¿Para qué sirve? Para **agregar una agregación**. Por ejemplo, «¿cuántos pedidos tiene de media un cliente?». Primero hay que contar los pedidos de cada cliente y **después** hacer la media de esos recuentos. Una sola consulta no puede hacer \`AVG(COUNT(*))\`, pero sí en dos pasos:

\`\`\`
SELECT AVG(n)
FROM (
  SELECT cliente_id, COUNT(*) AS n
  FROM pedidos
  GROUP BY cliente_id
) AS t;
\`\`\`

La de dentro devuelve una fila por cliente con su recuento; la de fuera promedia esa columna.
`,
        '🧱',
      ),
      sqlDemo('Media de recuentos', 'tienda', [
        ['SELECT cliente_id, COUNT(*) AS n FROM pedidos GROUP BY cliente_id ORDER BY cliente_id;', 'Primer paso: pedidos de cada cliente'],
        ['SELECT ROUND(AVG(n), 2) AS media_de_pedidos FROM (SELECT cliente_id, COUNT(*) AS n FROM pedidos GROUP BY cliente_id) AS t;', 'Segundo paso: la media de esa columna'],
      ]),
      learn(
        'Filtrar sobre un resultado agrupado',
        `
Una tabla derivada también sirve para **filtrar por un cálculo** de forma legible: primero calculas, luego aplicas un \`WHERE\` normal sobre el resultado (y puedes usar los alias, que dentro de la derivada ya existen).

\`\`\`
SELECT nombre, media
FROM (
  SELECT a.nombre, ROUND(AVG(m.nota), 2) AS media
  FROM alumnos a JOIN matriculas m ON m.alumno_id = a.id
  GROUP BY a.id, a.nombre
) AS t
WHERE media > 7;
\`\`\`

Y en el \`SELECT\` puedes poner una subconsulta escalar correlacionada, que calcula **un valor por fila**: «para cada cliente, cuántos pedidos tiene».
`,
        '🧩',
      ),
      sqlDemo('Valores por fila y filtro sobre un cálculo', 'escuela', [
        ['SELECT nombre, media FROM (SELECT a.nombre, ROUND(AVG(m.nota), 2) AS media FROM alumnos a JOIN matriculas m ON m.alumno_id = a.id GROUP BY a.id, a.nombre) AS t WHERE media > 7 ORDER BY media DESC, nombre;', 'Alumnos con media superior a 7, filtrando sobre el alias «media»'],
        ['SELECT a.nombre, (SELECT COUNT(*) FROM matriculas m WHERE m.alumno_id = a.id) AS asignaturas FROM alumnos a ORDER BY asignaturas DESC, a.nombre LIMIT 4;', 'Una subconsulta en el SELECT: cuántas asignaturas cursa cada alumno'],
      ]),
      mc('¿Por qué una tabla derivada necesita alias (`FROM (SELECT …) AS t`)?', ['Por estética', 'Porque el resultado se trata como una tabla y toda tabla del FROM necesita un nombre', 'Para que sea más rápida', 'Para poder ordenarla'], 1, 'En el `FROM` cada fuente de datos necesita nombre para poder referirse a sus columnas.'),
      sqlOut('Predice la media de pedidos por cliente', 'tienda', 'SELECT ROUND(AVG(n), 2) FROM (SELECT cliente_id, COUNT(*) AS n FROM pedidos GROUP BY cliente_id) AS t;', ['2.0', '24', '4'], 'Hay 24 pedidos repartidos entre 11 clientes que han comprado: 24 / 11 = 2,18. (Con 12 clientes, contando al que no compró, sería 2.0, pero ese cliente no aparece en `pedidos`.)'),
      tf('En una subconsulta del `FROM` se pueden usar los alias que definió su `SELECT`, desde la consulta de fuera.', true, 'Sí: desde fuera, los alias de la tabla derivada son sus columnas. Es la forma habitual de filtrar sobre un cálculo.'),
      sqlCode('Muestra la media de unidades por pedido, redondeada a 2 decimales, como `media` (tabla `detalle_pedido`). Usa una tabla derivada para sumar primero las unidades de cada pedido y luego promediar.', {
        setup: 'tienda',
        check: same({ names: true, uses: ['SUBQUERY'] }),
        solution: 'SELECT ROUND(AVG(unidades), 2) AS media FROM (SELECT pedido_id, SUM(cantidad) AS unidades FROM detalle_pedido GROUP BY pedido_id) AS t;',
        hint: 'Primero SUM(cantidad) por pedido_id; luego AVG de esa columna',
        why: 'La derivada calcula las unidades de cada pedido y la consulta exterior promedia esos totales.',
      }),
      sqlPractice({
        goal: 'Alumnos notables',
        prompt: 'La escuela quiere ver a los alumnos con **media superior a 7**.\n\n**Muestra `nombre` y `media` (media de notas, 2 decimales) de esos alumnos, ordenados por media descendente y luego por nombre.** Esta vez usa una **tabla derivada** y filtra con `WHERE` sobre el alias.',
        setup: 'escuela',
        check: ordered({ names: true, uses: ['SUBQUERY', 'WHERE'] }),
        solution: 'SELECT nombre, media FROM (SELECT a.nombre, ROUND(AVG(m.nota), 2) AS media FROM alumnos a JOIN matriculas m ON m.alumno_id = a.id GROUP BY a.id, a.nombre) AS t WHERE media > 7 ORDER BY media DESC, nombre;',
        hints: ['La consulta de dentro calcula nombre y media por alumno.', 'La de fuera aplica `WHERE media > 7`.'],
        explain: 'El mismo resultado se obtiene con `HAVING`, pero la tabla derivada hace evidente el paso intermedio y permite encadenar más cálculos encima.',
        commands: ['Tabla derivada'],
      }),
      sqlPractice({
        goal: 'Unidades vendidas de cada producto',
        prompt: 'Almacén quiere saber cuántas unidades se han vendido de **cada producto**, incluso de los que no se han vendido nunca (0).\n\n**Muestra `nombre` y `unidades` (suma de `cantidad` en `detalle_pedido`, 0 si no hay), de más a menos unidades y luego por nombre, los 5 primeros.** Usa una subconsulta correlacionada en el `SELECT`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['SUBQUERY'] }),
        solution: 'SELECT nombre, (SELECT COALESCE(SUM(cantidad), 0) FROM detalle_pedido d WHERE d.producto_id = p.id) AS unidades FROM productos p ORDER BY unidades DESC, nombre LIMIT 5;',
        hints: ['La subconsulta suma `cantidad` de las líneas con `d.producto_id = p.id`.', '`COALESCE(…, 0)` da 0 cuando no hay líneas.'],
        explain: 'Una subconsulta correlacionada en el `SELECT` calcula un valor por fila. Equivale a un `LEFT JOIN` con `GROUP BY`; a veces se lee mejor.',
        commands: ['Subconsulta correlacionada'],
      }),
      sqlPractice({
        goal: 'Último pedido de cada cliente',
        prompt: 'Para reactivar clientes necesitas saber cuándo compraron por última vez.\n\n**Muestra `nombre` y la fecha de su último pedido como `ultimo_pedido` (`NULL` si nunca compraron), ordenado por `ultimo_pedido` descendente y los 3 primeros.** Pista: en Postgres un NULL ordena como «el más grande».',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT c.nombre, (SELECT MAX(p.fecha) FROM pedidos p WHERE p.cliente_id = c.id) AS ultimo_pedido FROM clientes c ORDER BY ultimo_pedido DESC LIMIT 3;',
        hints: ['`MAX(fecha)` dentro de la subconsulta correlacionada.', 'El cliente sin pedidos sale primero porque su NULL se considera el mayor.'],
        explain: 'La subconsulta correlacionada se evalúa por cada cliente. Raúl, que no tiene pedidos, devuelve NULL, que con `DESC` va primero.',
        commands: ['Subconsulta correlacionada', 'MIN / MAX'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s6-4', { title: 'CTE: darle nombre a cada paso', summary: 'WITH para consultas legibles', emoji: '📝', commands: ['WITH'], minutes: 10 }, [
      learn(
        'WITH: pasos con nombre',
        `
Las subconsultas anidadas se vuelven ilegibles. Una **CTE** (*Common Table Expression*, «expresión de tabla común») te deja **definir una consulta con nombre al principio** y usarla después como si fuera una tabla:

\`\`\`
WITH caros AS (
  SELECT nombre, precio
  FROM productos
  WHERE precio > 100
)
SELECT COUNT(*) FROM caros;
\`\`\`

Se lee de arriba abajo, como una receta: primero «los caros», luego «cuéntalos». El resultado es el mismo que con una tabla derivada, pero **mucho más claro**.

- Puedes definir **varias** separadas por comas, y una puede usar las anteriores.
- Una CTE se puede usar **varias veces** en la consulta final (una tabla derivada habría que repetirla).
`,
        '📝',
      ),
      sqlDemo('Una receta en dos pasos', 'tienda', [
        ['WITH caros AS (SELECT nombre, precio FROM productos WHERE precio > 100) SELECT COUNT(*) AS n, MIN(precio) AS el_mas_barato FROM caros;', 'La CTE «caros» se usa como una tabla'],
        ["WITH gasto AS (SELECT p.cliente_id, SUM(d.cantidad * pr.precio) AS total FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado' GROUP BY p.cliente_id) SELECT c.nombre, ROUND(g.total, 2) AS total FROM gasto g JOIN clientes c ON c.id = g.cliente_id WHERE g.total > (SELECT AVG(total) FROM gasto) ORDER BY total DESC;", 'Una CTE usada DOS veces: para unirla con clientes y para calcular su media. Clientes que gastan más que la media'],
      ]),
      learn(
        'Varias CTE encadenadas',
        `
Cada CTE puede apoyarse en las anteriores. Es la forma de resolver problemas **paso a paso**, nombrando cada resultado intermedio:

\`\`\`
WITH
medias AS (               -- 1) la media de cada departamento
  SELECT departamento_id, AVG(salario) AS media
  FROM empleados GROUP BY departamento_id
),
mejores AS (              -- 2) quién gana más que su media
  SELECT e.nombre, e.salario
  FROM empleados e JOIN medias m ON m.departamento_id = e.departamento_id
  WHERE e.salario > m.media
)
SELECT * FROM mejores;
\`\`\`

> TIP: Cuando una consulta te cueste entender, trata de reescribirla con CTE. Si cada nombre describe su paso, ya casi no necesitas comentarios.
`,
        '🪜',
      ),
      sqlDemo('Pasos nombrados', 'empresa', [
        ['WITH medias AS (SELECT departamento_id, AVG(salario) AS media FROM empleados GROUP BY departamento_id) SELECT e.nombre, e.salario, ROUND(m.media, 2) AS media_depto FROM empleados e JOIN medias m ON m.departamento_id = e.departamento_id WHERE e.salario > m.media ORDER BY e.nombre;', 'Empleados que cobran más que la media de su departamento'],
      ]),
      mc('¿Cuál es una ventaja de la CTE frente a una tabla derivada?', ['Es siempre más rápida', 'Se puede nombrar, leer de arriba abajo y usar varias veces', 'Permite modificar datos', 'No necesita FROM'], 1, 'La CTE da nombre al paso, se lee en orden y se puede reutilizar en la consulta final.'),
      order('Ordena las piezas de la consulta', ['WITH', 'caros', 'AS', '(SELECT', 'nombre', 'FROM', 'productos', 'WHERE', 'precio', '>', '100)', 'SELECT', 'COUNT(*)', 'FROM', 'caros;'], 'WITH caros AS (SELECT nombre FROM productos WHERE precio > 100) SELECT COUNT(*) FROM caros;', 'Primero se define la CTE con `WITH nombre AS (…)` y después viene la consulta final que la usa.'),
      sqlOut('Predice cuántos productos caros hay', 'tienda', 'WITH caros AS (SELECT * FROM productos WHERE precio > 100) SELECT COUNT(*) FROM caros;', ['14', '4', '6'], 'Cinco productos cuestan más de 100 €: los dos monitores, los dos portátiles y la tablet.'),
      tf('Una CTE modifica de forma permanente la tabla sobre la que se define.', false, 'Una CTE es solo un nombre temporal para una consulta, válido durante esa sentencia. No cambia ni crea nada en la base de datos.'),
      sqlCode('Con una CTE llamada `gasto` que calcule el total de `cantidad * precio` de cada pedido (`pedido_id`, `total`), muestra los pedidos cuyo total supera los 500 € (`pedido_id`, `total`).', {
        setup: 'tienda',
        check: same({ names: true, uses: ['WITH'] }),
        solution: 'WITH gasto AS (SELECT d.pedido_id, SUM(d.cantidad * pr.precio) AS total FROM detalle_pedido d JOIN productos pr ON pr.id = d.producto_id GROUP BY d.pedido_id) SELECT pedido_id, total FROM gasto WHERE total > 500;',
        hint: 'WITH gasto AS (…) SELECT … FROM gasto WHERE total > 500',
        why: 'La CTE calcula el total de cada pedido y la consulta final lo filtra con un simple `WHERE`.',
      }),
      sqlPractice({
        goal: 'Clientes que gastan más que la media',
        prompt: 'La directora quiere premiar a los clientes que **gastan más que la media de gasto** de todos los clientes (sin contar pedidos cancelados).\n\n**Muestra `nombre` y `total` (redondeado a 2 decimales), de mayor a menor.** Usa una CTE para el gasto de cada cliente y reutilízala para la media.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['WITH'] }),
        solution: "WITH gasto AS (SELECT p.cliente_id, SUM(d.cantidad * pr.precio) AS total FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado' GROUP BY p.cliente_id) SELECT c.nombre, ROUND(g.total, 2) AS total FROM gasto g JOIN clientes c ON c.id = g.cliente_id WHERE g.total > (SELECT AVG(total) FROM gasto) ORDER BY total DESC;",
        hints: ['La CTE `gasto` agrupa por `cliente_id` y suma `cantidad * precio`.', 'La media es `(SELECT AVG(total) FROM gasto)`.'],
        explain: 'La CTE `gasto` se usa dos veces: para unir con `clientes` y para calcular la media. Con tablas derivadas habría que escribirla dos veces.',
        commands: ['WITH'],
      }),
      sqlPractice({
        goal: 'Mejor pagados que su departamento',
        prompt: 'RR. HH. busca a los empleados que **cobran más que la media de su departamento**.\n\n**Muestra `nombre`, `salario` y `media_depto` (media del departamento, 2 decimales), ordenados por nombre.** Usa una CTE con las medias por departamento.',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['WITH'] }),
        solution: 'WITH medias AS (SELECT departamento_id, AVG(salario) AS media FROM empleados GROUP BY departamento_id) SELECT e.nombre, e.salario, ROUND(m.media, 2) AS media_depto FROM empleados e JOIN medias m ON m.departamento_id = e.departamento_id WHERE e.salario > m.media ORDER BY e.nombre;',
        hints: ['Primero la CTE con `AVG(salario)` por `departamento_id`.', 'Une `empleados` con la CTE y compara salario con media.'],
        explain: 'Un clásico: comparar cada fila con un resumen de su grupo. En la zona de ventanas verás otra forma más corta.',
        commands: ['WITH'],
      }),
      sqlPractice({
        goal: 'Usuarios por encima del promedio',
        prompt: 'En la red social, calcula el total de likes de cada usuario y quédate con los que superan la **media de esos totales**.\n\n**Muestra `alias` y `likes` (total), de mayor a menor.** Usa una CTE `totales`.',
        setup: 'social',
        check: ordered({ names: true, uses: ['WITH'] }),
        solution: 'WITH totales AS (SELECT usuario_id, SUM(likes) AS likes FROM publicaciones GROUP BY usuario_id) SELECT u.alias, t.likes FROM totales t JOIN usuarios u ON u.id = t.usuario_id WHERE t.likes > (SELECT AVG(likes) FROM totales) ORDER BY t.likes DESC;',
        hints: ['La CTE agrupa publicaciones por `usuario_id`.', 'Une con `usuarios` para mostrar el `alias`.'],
        explain: 'El patrón «calcula por grupo, luego compara con la media de los grupos» se repite constantemente en análisis de datos.',
        commands: ['WITH'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s6-5', { title: 'ANY, ALL y «el mejor de cada grupo»', summary: 'Comparaciones con varios valores y subconsultas correlacionadas', emoji: '🥇', commands: ['ANY / ALL', 'Subconsulta correlacionada'], minutes: 10 }, [
      learn(
        'Comparar con todos o con alguno',
        `
Cuando una subconsulta devuelve **varios valores**, \`ANY\` y \`ALL\` permiten comparar con ellos:

- \`x > ALL (subconsulta)\`: mayor que **todos** los valores (que el máximo).
- \`x > ANY (subconsulta)\`: mayor que **alguno** de los valores (que el mínimo).

\`\`\`
-- más caros que TODAS las pantallas
SELECT nombre, precio FROM productos
WHERE precio > ALL (SELECT precio FROM productos WHERE categoria = 'pantallas');
\`\`\`

\`= ANY\` equivale a \`IN\`. Muchas veces es más claro usar \`MAX\` o \`MIN\`: \`precio > (SELECT MAX(precio) …)\`.
`,
        '🥇',
      ),
      sqlDemo('Más caros que todos, más caros que alguno', 'tienda', [
        ["SELECT nombre, precio FROM productos WHERE precio > ALL (SELECT precio FROM productos WHERE categoria = 'pantallas') ORDER BY precio;", 'Más caros que TODAS las pantallas (> el máximo)'],
        ["SELECT nombre, precio FROM productos WHERE precio > ANY (SELECT precio FROM productos WHERE categoria = 'ordenadores') ORDER BY precio;", 'Más caros que ALGÚN ordenador (> el más barato de ellos)'],
      ]),
      learn(
        'El mejor de cada grupo',
        `
Una pregunta clásica: «el producto **más caro de cada categoría**». \`GROUP BY\` te daría el precio máximo, pero no *qué producto* es. La solución con subconsulta correlacionada: «el producto cuyo precio es igual al máximo **de su propia categoría**».

\`\`\`
SELECT categoria, nombre, precio
FROM productos p
WHERE precio = (
  SELECT MAX(precio) FROM productos x
  WHERE x.categoria = p.categoria
);
\`\`\`

Para cada fila \`p\`, la subconsulta calcula el máximo de **su** categoría. Si hay empate, salen todos los empatados. (En la zona de ventanas verás \`ROW_NUMBER\`, que lo resuelve de forma más flexible.)
`,
        '🏆',
      ),
      sqlDemo('Máximo de su propio grupo', 'tienda', [
        ['SELECT categoria, nombre, precio FROM productos p WHERE precio = (SELECT MAX(precio) FROM productos x WHERE x.categoria = p.categoria) ORDER BY categoria;', 'El producto más caro de cada categoría'],
      ]),
      sqlOut('Predice el mejor de cada categoría', 'tienda', 'SELECT categoria, nombre FROM productos p WHERE precio = (SELECT MAX(precio) FROM productos x WHERE x.categoria = p.categoria) ORDER BY categoria;', ['ordenadores | Portátil Pro 15', 'accesorios | Cable HDMI 2m\naudio | Altavoz portátil\nordenadores | Tablet 10 pulgadas\npantallas | Monitor 24 pulgadas\nperifericos | Ratón inalámbrico', 'accesorios | Hub USB-C\naudio | Auriculares Bluetooth\nordenadores | Portátil Air 13\npantallas | Monitor 27 pulgadas\nperifericos | Teclado mecánico'], 'Se devuelve el producto con el precio máximo **de cada categoría**: Hub USB-C, Auriculares Bluetooth, Portátil Pro 15, Monitor 27 y Teclado mecánico.'),
      mc('`precio > ALL (SELECT precio FROM productos WHERE categoria = \'audio\')` equivale a…', ['precio > el menor precio de audio', 'precio > el mayor precio de audio', 'precio = algún precio de audio', 'precio > la media de audio'], 1, 'Ser mayor que todos los valores es ser mayor que el máximo.'),
      tf('`x = ANY (subconsulta)` es lo mismo que `x IN (subconsulta)`.', true, 'Sí: «igual a alguno de ellos» es justo lo que significa `IN`.'),
      sqlCode('Muestra `nombre` y `salario` de los empleados que cobran más que **todos** los del departamento 3 (Ventas). Usa `ALL`.', {
        setup: 'empresa',
        check: same({ names: true, uses: ['ALL'] }),
        solution: 'SELECT nombre, salario FROM empleados WHERE salario > ALL (SELECT salario FROM empleados WHERE departamento_id = 3);',
        hint: 'salario > ALL (SELECT salario FROM empleados WHERE departamento_id = 3)',
        why: 'Mayor que todos los de Ventas = mayor que el sueldo máximo de ese departamento (4800).',
      }),
      sqlPractice({
        goal: 'Más caros de cada categoría',
        prompt: 'Compras quiere el producto estrella de cada categoría: el **más caro de su propia categoría**.\n\n**Muestra `categoria`, `nombre` y `precio`, ordenado por categoría.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['SUBQUERY'] }),
        solution: 'SELECT categoria, nombre, precio FROM productos p WHERE precio = (SELECT MAX(precio) FROM productos x WHERE x.categoria = p.categoria) ORDER BY categoria;',
        hints: ['La subconsulta debe calcular el máximo de la **misma categoría** de la fila actual.', 'Correlaciona con `x.categoria = p.categoria`.'],
        explain: 'Subconsulta correlacionada: cada fila se compara con un valor calculado para su propio grupo.',
        commands: ['Subconsulta correlacionada'],
      }),
      sqlPractice({
        goal: 'Los mejor pagados de cada departamento',
        prompt: 'Directivos quiere el sueldo más alto de cada departamento y quién lo cobra.\n\n**Muestra `nombre`, `salario` y `departamento_id` del empleado (o empleados) con el salario más alto de su departamento, ordenados por departamento.** El becario sin departamento no cuenta: sin grupo no hay máximo.',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT e.nombre, e.salario, e.departamento_id FROM empleados e WHERE e.salario = (SELECT MAX(salario) FROM empleados x WHERE x.departamento_id = e.departamento_id) ORDER BY e.departamento_id;',
        hints: ['Máximo del mismo departamento: `x.departamento_id = e.departamento_id`.', 'Con NULL, `x.departamento_id = e.departamento_id` nunca es verdadero: el becario queda fuera.'],
        explain: 'Con `departamento_id` NULL, la comparación es desconocida y la subconsulta no encuentra nada: no hay máximo para él. Un detalle de NULL que ya dominas.',
        commands: ['Subconsulta correlacionada'],
      }),
      sqlPractice({
        goal: 'Por encima de todas las pantallas',
        prompt: 'Para una oferta especial buscas los productos **más caros que cualquier pantalla**.\n\n**Muestra `nombre` y `precio`, ordenados por precio.** Usa `ALL`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ALL'] }),
        solution: "SELECT nombre, precio FROM productos WHERE precio > ALL (SELECT precio FROM productos WHERE categoria = 'pantallas') ORDER BY precio;",
        hints: ['Las pantallas son `categoria = \'pantallas\'`.', 'Mayor que **todos** → `> ALL`.'],
        explain: '`ALL` es una forma literal de decir «más que todos»: se lee casi como el enunciado.',
        commands: ['ANY / ALL'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: clientes con pedidos en camino',
    prompt:
      'Logística quiere avisar a los **mejores clientes** de que tienen un pedido en camino. Cumplen:\n\n- Han gastado **más que la media** de gasto de todos los clientes (sin contar los pedidos cancelados).\n- Tienen **al menos un pedido en estado `enviado`**.\n\n**Muestra `nombre` y `gastado` (total redondeado a 2 decimales), de mayor a menor gasto.** (Pista: una CTE para el gasto y `EXISTS` para el pedido enviado.)',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: "WITH gasto AS (SELECT p.cliente_id, SUM(d.cantidad * pr.precio) AS total FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado' GROUP BY p.cliente_id) SELECT c.nombre, ROUND(g.total, 2) AS gastado FROM clientes c JOIN gasto g ON g.cliente_id = c.id WHERE g.total > (SELECT AVG(total) FROM gasto) AND EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.estado = 'enviado') ORDER BY gastado DESC;",
    hints: ['CTE `gasto` con el total de cada cliente, sin pedidos cancelados.', "`EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id AND p.estado = 'enviado')`"],
    explain: 'CTE, subconsulta escalar, `EXISTS` correlacionado y `JOIN` en la misma consulta. Con estas piezas puedes construir casi cualquier análisis. ¡Zona completada!',
    commands: ['WITH', 'EXISTS', 'Subconsulta'],
  },
});
