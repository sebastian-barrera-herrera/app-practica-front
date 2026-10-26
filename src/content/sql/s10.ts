import { illus, learn, lesson, match, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

const CONTACTOS = "CREATE TABLE contactos (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT); INSERT INTO contactos VALUES (1,'Ana','ana@x.com'),(2,'Luis','luis@x.com'),(3,'Ana B.','ana@x.com'),(4,'Marta','marta@x.com'),(5,'Luis M.','luis@x.com'),(6,'Pía','pia@x.com');";
const MENSUAL = "WITH m AS (SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos FROM pedidos GROUP BY mes)";

export const s10 = sqlWorld({
  id: 's10',
  index: 10,
  title: 'Funciones de ventana',
  subtitle: 'Calcular sobre grupos sin perder las filas',
  emoji: '🪟',
  color: '#FB7185',
  level: 'avanzado',
  intro:
    'Con `GROUP BY` resumes muchas filas en una: ganas la visión de conjunto, pero **pierdes el detalle**. Las funciones de ventana hacen lo mejor de los dos mundos: calculan sobre un grupo de filas (la media de la categoría, el acumulado hasta hoy, el puesto en el ranking) y **conservan cada fila** en el resultado. Son la herramienta estrella del análisis de datos y de las entrevistas técnicas: rankings, acumulados, comparación con la fila anterior, medias móviles…',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s10-1', { title: 'OVER y PARTITION BY', summary: 'Un agregado que no colapsa las filas', emoji: '🪟', commands: ['OVER / PARTITION BY'], minutes: 10 }, [
      learn(
        'GROUP BY pierde filas; una ventana, no',
        `
Quieres ver cada producto **junto a la media de su categoría**. Con \`GROUP BY\` obtienes la media, pero **una fila por categoría**: has perdido los productos. Para tener las dos cosas necesitas una **función de ventana**:

\`\`\`
SELECT nombre, categoria, precio,
       AVG(precio) OVER (PARTITION BY categoria) AS media_categoria
FROM productos;
\`\`\`

- \`AVG(precio)\` es la función de siempre.
- \`OVER (…)\` la convierte en **ventana**: en lugar de colapsar las filas, calcula el resultado sobre un grupo y **lo repite en cada fila** del grupo.
- \`PARTITION BY categoria\` define los grupos (como un \`GROUP BY\`, pero sin colapsar). Sin \`PARTITION BY\`, la ventana es **toda la tabla**: \`SUM(precio) OVER ()\`.
`,
        '🪟',
      ),
      illus('sql-window-frame', 'La ventana sobre las filas', 'Cambia entre partición, orden y marco para ver qué filas «ve» la función en cada fila.'),
      sqlDemo('Detalle y resumen a la vez', 'tienda', [
        ['SELECT categoria, nombre, precio, ROUND(AVG(precio) OVER (PARTITION BY categoria), 2) AS media_categoria FROM productos ORDER BY categoria, precio;', 'Cada producto conserva su fila y lleva la media de SU categoría'],
        ['SELECT categoria, nombre, precio, ROUND(precio - AVG(precio) OVER (PARTITION BY categoria), 2) AS dif_con_la_media FROM productos ORDER BY categoria, precio;', 'Se puede operar con la ventana: ¿cuánto se desvía cada precio de la media de su grupo?'],
        ['SELECT nombre, precio, ROUND(100.0 * precio / SUM(precio) OVER (), 1) AS pct_del_total FROM productos ORDER BY precio DESC LIMIT 4;', 'OVER () sin PARTITION BY: la ventana es toda la tabla (el porcentaje sobre el total sin subconsulta)'],
      ]),
      learn(
        'Reglas de las ventanas',
        `
- Las funciones de ventana van **en el \`SELECT\`** (y en el \`ORDER BY\`): se calculan **después** de \`WHERE\`, \`GROUP BY\` y \`HAVING\`.
- **No se pueden usar en el \`WHERE\`**: para filtrar por su resultado hay que envolver la consulta en una subconsulta o CTE.
- Cualquier agregado sirve de ventana: \`SUM\`, \`AVG\`, \`COUNT\`, \`MIN\`, \`MAX\`.
- Se pueden definir ventanas con nombre para no repetir: \`WINDOW w AS (PARTITION BY categoria)\` y luego \`AVG(precio) OVER w\`.
`,
        '📏',
      ),
      sqlDemo('El error de filtrar una ventana', 'tienda', [
        sqlErr('SELECT nombre FROM productos WHERE ROW_NUMBER() OVER (ORDER BY id) = 1;', 'Las ventanas no se pueden usar en el WHERE; el mensaje sugiere una subconsulta'),
        ['SELECT nombre, categoria, MAX(precio) OVER w AS max_categoria, COUNT(*) OVER w AS n FROM productos WINDOW w AS (PARTITION BY categoria) ORDER BY categoria, nombre LIMIT 5;', 'Una ventana con nombre se reutiliza en varias funciones'],
      ]),
      mc('¿Qué diferencia hay entre `AVG(precio)` con `GROUP BY categoria` y `AVG(precio) OVER (PARTITION BY categoria)`?', ['Ninguna', 'La primera devuelve una fila por categoría; la segunda conserva todas las filas', 'La segunda es más lenta pero igual', 'La primera no admite filtros'], 1, '`GROUP BY` colapsa cada grupo en una fila. Con `OVER (PARTITION BY …)` cada fila conserva su detalle y lleva el resultado de su grupo.'),
      sqlOut('Predice la media por categoría', 'tienda', "SELECT nombre, precio, ROUND(AVG(precio) OVER (PARTITION BY categoria), 1) FROM productos WHERE categoria = 'audio' ORDER BY precio;", ['audio | 47.4', 'Altavoz portátil | 34.95 | 34.95\nAuriculares Bluetooth | 59.9 | 59.9', 'Altavoz portátil | 34.95 | 47.4'], 'Las dos filas de audio se conservan y ambas muestran la media de la categoría: (34,95 + 59,90) / 2 = 47,425 → 47,4.'),
      tf('Se puede escribir `WHERE ROW_NUMBER() OVER (ORDER BY id) = 1` para quedarse con la primera fila.', false, 'Las funciones de ventana no se permiten en el `WHERE`. Hay que calcularlas en una subconsulta o CTE y filtrar fuera.'),
      sqlCode('Muestra `nombre`, `salario` y la media salarial de **todos** los empleados como `media_empresa` (2 decimales), sin perder ninguna fila.', {
        setup: 'empresa',
        check: same({ names: true }),
        solution: 'SELECT nombre, salario, ROUND(AVG(salario) OVER (), 2) AS media_empresa FROM empleados;',
        hint: 'OVER () sin PARTITION BY es toda la tabla',
        why: '`AVG(salario) OVER ()` calcula la media de toda la tabla y la repite en cada fila.',
      }),
      sqlPractice({
        goal: 'Cada producto frente a su categoría',
        prompt: 'Compras quiere comparar cada producto con la media de su categoría.\n\n**Muestra `categoria`, `nombre`, `precio` y `media_categoria` (media de la categoría, 2 decimales), ordenado por categoría y luego por precio.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT categoria, nombre, precio, ROUND(AVG(precio) OVER (PARTITION BY categoria), 2) AS media_categoria FROM productos ORDER BY categoria, precio;',
        hints: ['`AVG(precio) OVER (PARTITION BY categoria)`', 'Redondea con `ROUND(…, 2)`.'],
        explain: 'La ventana añade la media de cada grupo sin perder ninguna fila. Con `GROUP BY` habría que unir el resultado con la tabla original.',
        commands: ['OVER / PARTITION BY'],
      }),
      sqlPractice({
        goal: 'Peso de cada sueldo',
        prompt: 'RR. HH. quiere saber qué porcentaje de la masa salarial total supone cada empleado.\n\n**Muestra `nombre`, `salario` y `pct_masa` (porcentaje sobre la suma de todos los salarios, 2 decimales) de los 5 empleados mejor pagados, de mayor a menor salario.**',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, salario, ROUND(100.0 * salario / SUM(salario) OVER (), 2) AS pct_masa FROM empleados ORDER BY salario DESC LIMIT 5;',
        hints: ['`SUM(salario) OVER ()` es el total de toda la tabla.', 'Multiplica por `100.0` para tener decimales.'],
        explain: '`SUM(…) OVER ()` evita la subconsulta escalar del porcentaje sobre el total: más corto y más legible.',
        commands: ['OVER / PARTITION BY', 'Porcentaje sobre el total'],
      }),
      sqlPractice({
        goal: 'Por encima o por debajo de su género',
        prompt: 'Para una crítica de cine, compara cada película con la media de **su género**.\n\n**Muestra `titulo`, `genero`, `puntuacion` y `dif` (puntuación menos la media de su género, 2 decimales) de las películas que tienen puntuación, ordenadas por género y título.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT titulo, genero, puntuacion, ROUND(puntuacion - AVG(puntuacion) OVER (PARTITION BY genero), 2) AS dif FROM peliculas WHERE puntuacion IS NOT NULL ORDER BY genero, titulo;',
        hints: ['Primero `WHERE puntuacion IS NOT NULL`.', '`puntuacion - AVG(puntuacion) OVER (PARTITION BY genero)`'],
        explain: 'El `WHERE` se ejecuta **antes** que la ventana, así que la media solo se calcula con las películas que tienen puntuación.',
        commands: ['OVER / PARTITION BY'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s10-2', { title: 'Rankings', summary: 'ROW_NUMBER, RANK y DENSE_RANK', emoji: '🏅', commands: ['ROW_NUMBER', 'RANK / DENSE_RANK'], minutes: 10 }, [
      learn(
        'Numerar y puntuar filas',
        `
Las funciones de **ranking** asignan un número a cada fila según un orden (\`ORDER BY\` dentro del \`OVER\`):

| Función | En caso de empate… |
| --- | --- |
| \`ROW_NUMBER()\` | numera 1, 2, 3… **sin repetir**: los empatados se numeran arbitrariamente |
| \`RANK()\` | los empatados **comparten** puesto y se **salta** el siguiente (1, 1, 3) |
| \`DENSE_RANK()\` | los empatados comparten puesto y **no se salta** ninguno (1, 1, 2) |

\`\`\`
SELECT nombre, precio,
       ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC) AS puesto
FROM productos;
\`\`\`

Con \`PARTITION BY\` cada grupo se numera **por separado**: el puesto 1 de cada categoría.
`,
        '🏅',
      ),
      sqlDemo('Los tres rankings con empates', 'empresa', [
        ['SELECT nombre, salario, ROW_NUMBER() OVER (ORDER BY salario DESC) AS fila, RANK() OVER (ORDER BY salario DESC) AS puesto, DENSE_RANK() OVER (ORDER BY salario DESC) AS puesto_denso FROM empleados WHERE departamento_id = 2 ORDER BY salario DESC, nombre;', 'Daniela y Nuria cobran lo mismo: RANK da 4 y 4 y salta al 6; DENSE_RANK da 4 y 4 y sigue con 5'],
      ]),
      learn(
        'El patrón estrella: los N mejores de cada grupo',
        `
«Los 2 productos más caros de **cada categoría**» es imposible con \`LIMIT\` (recortaría el total, no cada grupo). La solución, con una ventana en una subconsulta:

\`\`\`
SELECT categoria, nombre, precio
FROM (
  SELECT categoria, nombre, precio,
         ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC) AS puesto
  FROM productos
) t
WHERE puesto <= 2;
\`\`\`

Como no puedes filtrar la ventana en el \`WHERE\`, la calculas **dentro** y filtras **fuera**.

> OJO: Si hay empates, \`ROW_NUMBER\` elige uno al azar; \`RANK\` los deja todos (puede devolver más de N). Y cuidado con los **NULL**: en \`ORDER BY … DESC\` van **primero**; usa \`NULLS LAST\`.
`,
        '🥇',
      ),
      sqlDemo('Top 2 por categoría y el problema del NULL', 'tienda', [
        ['SELECT categoria, nombre, precio, puesto FROM (SELECT categoria, nombre, precio, ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC) AS puesto FROM productos) t WHERE puesto <= 2 ORDER BY categoria, puesto;', 'Los dos más caros de cada categoría'],
      ]),
      sqlDemo('La mejor película de cada género', 'cine', [
        ['SELECT genero, titulo, puntuacion FROM (SELECT genero, titulo, puntuacion, ROW_NUMBER() OVER (PARTITION BY genero ORDER BY puntuacion DESC) AS rn FROM peliculas) t WHERE rn = 1 ORDER BY genero;', '¡Cuidado! En «drama» sale la película sin estrenar: su puntuación NULL va la primera con DESC'],
        ['SELECT genero, titulo, puntuacion FROM (SELECT genero, titulo, puntuacion, ROW_NUMBER() OVER (PARTITION BY genero ORDER BY puntuacion DESC NULLS LAST) AS rn FROM peliculas) t WHERE rn = 1 ORDER BY genero;', 'Con NULLS LAST, la mejor de verdad: Oppenheimer'],
      ]),
      order('Ordena una ventana de ranking por categoría', ['ROW_NUMBER()', 'OVER', '(PARTITION', 'BY', 'categoria', 'ORDER', 'BY', 'precio', 'DESC)'], 'ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC)', '`PARTITION BY` define los grupos y el `ORDER BY` interno el orden del ranking.'),
      sqlOut('Predice los puestos con empates', 'empresa', 'SELECT nombre, RANK() OVER (ORDER BY salario DESC) FROM empleados WHERE departamento_id = 2 AND salario <= 3200 ORDER BY salario DESC, nombre;', ['Daniela Pons | 1\nNuria Ferrer | 1\nEsteban Gil | 2', 'Daniela Pons | 1\nNuria Ferrer | 2\nEsteban Gil | 3', 'Daniela Pons | 1\nNuria Ferrer | 1\nEsteban Gil | 1'], 'Daniela y Nuria empatan en el puesto 1; con `RANK`, el siguiente es el 3 (se saltan huecos). `DENSE_RANK` habría dado 2.'),
      match(
        'Une cada función con su comportamiento con empates',
        [
          ['ROW_NUMBER()', '1, 2, 3, 4: nunca repite'],
          ['RANK()', '1, 1, 3, 4: salta puestos tras un empate'],
          ['DENSE_RANK()', '1, 1, 2, 3: no salta puestos'],
          ['NTILE(4)', 'Reparte las filas en 4 grupos de tamaño parecido'],
        ],
        'Cuatro formas de numerar: elige según cómo quieras tratar los empates.',
      ),
      tf('`RANK()` nunca devuelve el mismo número para dos filas.', false, 'Con empates, `RANK()` da el mismo número a las filas empatadas (y salta los siguientes).'),
      sqlCode('Numera los productos de cada categoría del más barato al más caro (`categoria`, `nombre`, `n`) con `ROW_NUMBER`. Ordena por categoría y `n`.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT categoria, nombre, ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio) AS n FROM productos ORDER BY categoria, n;',
        hint: 'ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio)',
        why: 'La numeración se reinicia en cada categoría.',
      }),
      sqlPractice({
        goal: 'El podio de cada categoría',
        prompt: 'La web destaca los **2 productos más caros de cada categoría**.\n\n**Muestra `categoria`, `nombre`, `precio` y `puesto` (1 o 2), ordenado por categoría y puesto.** Usa `ROW_NUMBER`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROW_NUMBER'] }),
        solution: 'SELECT categoria, nombre, precio, puesto FROM (SELECT categoria, nombre, precio, ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY precio DESC) AS puesto FROM productos) t WHERE puesto <= 2 ORDER BY categoria, puesto;',
        hints: ['Calcula `ROW_NUMBER` dentro de una subconsulta.', 'Filtra `puesto <= 2` fuera.'],
        explain: 'La ventana se calcula dentro y se filtra fuera: el patrón «top N por grupo».',
        commands: ['ROW_NUMBER'],
      }),
      sqlPractice({
        goal: 'Clasificación con empates',
        prompt: 'En Tecnología (departamento 2) hay sueldos iguales.\n\n**Muestra `nombre`, `salario`, `puesto` (con `RANK`) y `puesto_denso` (con `DENSE_RANK`), ordenado por salario descendente y luego por nombre.**',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, salario, RANK() OVER (ORDER BY salario DESC) AS puesto, DENSE_RANK() OVER (ORDER BY salario DESC) AS puesto_denso FROM empleados WHERE departamento_id = 2 ORDER BY salario DESC, nombre;',
        hints: ['Dos ventanas en el mismo SELECT.', 'El `WHERE departamento_id = 2` se aplica antes del ranking.'],
        explain: 'Los empatados comparten puesto en las dos, pero `RANK` salta del 4 al 6 y `DENSE_RANK` sigue en 5.',
        commands: ['RANK / DENSE_RANK'],
      }),
      sqlPractice({
        goal: 'Mejor película de cada género',
        prompt: 'Para el cartel del festival necesitas la **mejor película de cada género** (la de mayor puntuación). Atención: las películas sin puntuación **no** pueden ganar.\n\n**Muestra `genero`, `titulo` y `puntuacion`, ordenado por género.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT genero, titulo, puntuacion FROM (SELECT genero, titulo, puntuacion, ROW_NUMBER() OVER (PARTITION BY genero ORDER BY puntuacion DESC NULLS LAST) AS rn FROM peliculas) t WHERE rn = 1 ORDER BY genero;',
        hints: ['`ROW_NUMBER() OVER (PARTITION BY genero ORDER BY puntuacion DESC …)`', 'Añade `NULLS LAST` (o filtra los NULL antes).'],
        explain: 'Un clásico de las entrevistas: el NULL de «Película sin estrenar» va primero en `DESC` y habría ganado en drama. `NULLS LAST` lo arregla.',
        commands: ['ROW_NUMBER', 'ORDER BY'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s10-3', { title: 'LAG y LEAD', summary: 'Comparar con la fila anterior o la siguiente', emoji: '↔️', commands: ['LAG / LEAD'], minutes: 10 }, [
      learn(
        'Mirar a la fila de al lado',
        `
Muchas preguntas comparan una fila con **la anterior**: «¿cuántos días pasaron desde el pedido anterior?», «¿subieron o bajaron las ventas respecto al mes pasado?». Sin ventanas habría que hacer un auto-\`JOIN\` complicado. Con ellas:

- \`LAG(col)\` — el valor de la fila **anterior** (según el \`ORDER BY\` de la ventana).
- \`LEAD(col)\` — el valor de la fila **siguiente**.
- \`LAG(col, n, valor)\` — n filas atrás, con un valor por defecto si no existe (la primera fila no tiene anterior: sale NULL).

\`\`\`
SELECT id, fecha,
       fecha - LAG(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha) AS dias_desde_el_anterior
FROM pedidos;
\`\`\`

Con \`PARTITION BY cliente_id\`, «el anterior» es el anterior **del mismo cliente**.
`,
        '↔️',
      ),
      sqlDemo('Días entre pedidos y vistazo al siguiente', 'tienda', [
        ['SELECT cliente_id, id, fecha, fecha - LAG(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha) AS dias FROM pedidos WHERE cliente_id IN (1, 3) ORDER BY cliente_id, fecha;', 'La primera fila de cada cliente no tiene anterior: NULL'],
        ['SELECT id, fecha, LEAD(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha) AS siguiente FROM pedidos WHERE cliente_id = 1 ORDER BY fecha;', 'LEAD mira hacia delante: la fecha del siguiente pedido (la última no tiene)'],
      ]),
      learn(
        'Variación respecto al periodo anterior',
        `
El uso más habitual en informes: **la variación** entre un periodo y el anterior, en valor absoluto y en porcentaje.

\`\`\`
WITH m AS (
  SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos
  FROM pedidos GROUP BY mes
)
SELECT mes, pedidos,
       pedidos - LAG(pedidos) OVER (ORDER BY mes) AS variacion,
       ROUND(100.0 * (pedidos - LAG(pedidos) OVER (ORDER BY mes))
             / LAG(pedidos) OVER (ORDER BY mes), 1) AS pct
FROM m;
\`\`\`

Primero se resume por mes (CTE) y luego se compara cada mes con el anterior. El primer mes no tiene anterior: variación NULL.
`,
        '📉',
      ),
      sqlDemo('Pedidos mes a mes', 'tienda', [
        [`${MENSUAL} SELECT mes, pedidos, pedidos - LAG(pedidos) OVER (ORDER BY mes) AS variacion, ROUND(100.0 * (pedidos - LAG(pedidos) OVER (ORDER BY mes)) / LAG(pedidos) OVER (ORDER BY mes), 1) AS pct FROM m ORDER BY mes;`, 'Variación y porcentaje respecto al mes anterior'],
      ]),
      mc('En `LAG(likes, 1, 0) OVER (ORDER BY fecha)`, ¿qué significa el `0`?', ['La fila anterior', 'El valor que se devuelve cuando no hay fila anterior', 'El número de filas', 'Un error'], 1, 'Es el valor por defecto: sin él, la primera fila daría NULL; con él devuelve 0.'),
      sqlOut('Predice LAG', 'social', 'SELECT id, likes, LAG(likes) OVER (ORDER BY id) FROM publicaciones WHERE id <= 3 ORDER BY id;', ['1 | 12 | 30\n2 | 30 | 8\n3 | 8 | NULL', '1 | 12 | 0\n2 | 30 | 12\n3 | 8 | 30', '1 | 12 | 12\n2 | 30 | 30\n3 | 8 | 8'], 'La primera fila no tiene anterior (NULL); cada una de las demás muestra los likes de la publicación anterior: 12 y 30.'),
      tf('`LEAD(col)` devuelve el valor de la fila anterior.', false, '`LEAD` mira hacia **delante** (fila siguiente); `LAG`, hacia atrás (fila anterior).'),
      sqlCode('Muestra `id`, `fecha` y la `fecha` del pedido siguiente del mismo cliente como `siguiente` (usa `LEAD`), solo para el cliente 3, ordenado por fecha.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT id, fecha, LEAD(fecha) OVER (ORDER BY fecha) AS siguiente FROM pedidos WHERE cliente_id = 3 ORDER BY fecha;',
        hint: 'LEAD(fecha) OVER (ORDER BY fecha)',
        why: 'Como el `WHERE` deja solo los pedidos del cliente 3, el «siguiente» es el siguiente de ese cliente.',
      }),
      sqlPractice({
        goal: 'Cada cuánto compra cada cliente',
        prompt: 'Marketing quiere saber cuánto tarda cada cliente en volver a comprar.\n\n**Muestra `cliente_id`, `id` (del pedido), `fecha` y `dias` (días desde su pedido anterior; NULL en el primero) para los clientes 1 y 3, ordenado por cliente y fecha.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT cliente_id, id, fecha, fecha - LAG(fecha) OVER (PARTITION BY cliente_id ORDER BY fecha) AS dias FROM pedidos WHERE cliente_id IN (1, 3) ORDER BY cliente_id, fecha;',
        hints: ['`PARTITION BY cliente_id` para que el «anterior» sea del mismo cliente.', 'Restar dos fechas da días.'],
        explain: 'Sin `PARTITION BY` se comparaban los pedidos de clientes distintos. La partición reinicia la comparación en cada cliente.',
        commands: ['LAG / LEAD'],
      }),
      sqlPractice({
        goal: 'Evolución mensual',
        prompt: 'Contabilidad quiere ver la evolución mensual de los pedidos.\n\n**Muestra `mes` (formato `AAAA-MM`), `pedidos` (cuántos) y `variacion` (pedidos menos los del mes anterior; NULL el primero), ordenado por mes.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: `${MENSUAL} SELECT mes, pedidos, pedidos - LAG(pedidos) OVER (ORDER BY mes) AS variacion FROM m ORDER BY mes;`,
        hints: ['Primero una CTE que cuente pedidos por mes.', '`pedidos - LAG(pedidos) OVER (ORDER BY mes)`'],
        explain: 'Resumir primero y comparar después: `GROUP BY` en la CTE y `LAG` en la consulta final.',
        commands: ['LAG / LEAD', 'WITH'],
      }),
      sqlPractice({
        goal: 'Likes ganados o perdidos',
        prompt: 'En la red social quieres ver cómo cambia la cifra de likes entre publicaciones consecutivas (por fecha).\n\n**Muestra `id`, `likes` y `variacion` (likes menos los de la publicación anterior; para la primera, compara con 0), ordenado por fecha, solo las 5 primeras.**',
        setup: 'social',
        check: ordered({ names: true }),
        solution: 'SELECT id, likes, likes - LAG(likes, 1, 0) OVER (ORDER BY fecha) AS variacion FROM publicaciones ORDER BY fecha LIMIT 5;',
        hints: ['`LAG(likes, 1, 0)` devuelve 0 si no hay anterior.', '`ORDER BY fecha` dentro del `OVER` y fuera.'],
        explain: 'El tercer argumento de `LAG` evita el NULL de la primera fila.',
        commands: ['LAG / LEAD'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s10-4', { title: 'Acumulados y medias móviles', summary: 'El marco de la ventana: ROWS BETWEEN', emoji: '📈', commands: ['ROWS BETWEEN'], minutes: 11 }, [
      learn(
        'Totales acumulados',
        `
Si añades \`ORDER BY\` dentro del \`OVER\` a una función de agregación, deja de calcular sobre toda la partición: calcula **desde el principio hasta la fila actual**. Es un **total acumulado**:

\`\`\`
SELECT mes, pedidos,
       SUM(pedidos) OVER (ORDER BY mes) AS acumulado
FROM m;
\`\`\`

Mes a mes: 1, 1+2=3, 3+3=6, 6+3=9… Perfecto para saldos, ventas del año hasta la fecha, progreso hacia un objetivo.
`,
        '📈',
      ),
      sqlDemo('Pedidos acumulados', 'tienda', [
        [`${MENSUAL} SELECT mes, pedidos, SUM(pedidos) OVER (ORDER BY mes) AS acumulado FROM m ORDER BY mes;`, 'Cada fila suma todas las anteriores y ella misma'],
      ]),
      sqlDemo('El saldo de cada cuenta', 'banco', [
        ['SELECT cuenta_id, fecha, concepto, importe, SUM(importe) OVER (PARTITION BY cuenta_id ORDER BY fecha, id) AS saldo FROM movimientos ORDER BY cuenta_id, fecha;', 'Y por cuenta (banco): el saldo después de cada movimiento'],
      ]),
      learn(
        'El marco: qué filas ve la ventana',
        `
Dentro de la partición, el **marco** (\`frame\`) define qué filas cuentan para **cada fila**. Se escribe tras el \`ORDER BY\`:

\`\`\`
ROWS BETWEEN 2 PRECEDING AND CURRENT ROW      -- esta fila y las 2 anteriores
ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING      -- la anterior, esta y la siguiente
ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW   -- desde el principio hasta aquí
ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING   -- desde aquí hasta el final
\`\`\`

Con un marco de \`ROWS BETWEEN 2 PRECEDING AND CURRENT ROW\` la media es una **media móvil de 3 periodos**: suaviza las subidas y bajadas para ver la tendencia.

> OJO: Sin marco explícito, un \`ORDER BY\` usa \`RANGE\` y **las filas empatadas se suman a la vez** («peers»). Si quieres acumular fila a fila aunque haya empates, escribe \`ROWS\`.
`,
        '🎞️',
      ),
      sqlDemo('Media móvil y el efecto de los empates', 'tienda', [
        [`${MENSUAL} SELECT mes, pedidos, ROUND(AVG(pedidos) OVER (ORDER BY mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS media_movil_3 FROM m ORDER BY mes;`, 'Media móvil de 3 meses: suaviza la serie'],
      ]),
      sqlDemo('RANGE (por defecto) frente a ROWS', 'empresa', [
        ['SELECT nombre, salario, SUM(salario) OVER (ORDER BY salario DESC) AS acumulado_rango, SUM(salario) OVER (ORDER BY salario DESC ROWS UNBOUNDED PRECEDING) AS acumulado_filas FROM empleados WHERE departamento_id = 2 ORDER BY salario DESC, nombre;', 'Daniela y Nuria empatan: el acumulado por defecto las suma a las dos a la vez (19000 en ambas); con ROWS se acumula fila a fila (15800 y 19000)'],
      ]),
      mc('¿Qué calcula `AVG(x) OVER (ORDER BY t ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)`?', ['La media de todas las filas', 'La media de la fila actual y las 2 anteriores', 'La media de las 2 siguientes', 'La media de la partición'], 1, 'Es una media móvil: cada fila promedia sí misma y las dos filas previas según el orden.'),
      sqlOut('Predice el acumulado', 'tienda', 'SELECT n, SUM(n) OVER (ORDER BY n) FROM generate_series(1, 4) AS n;', ['1 | 10\n2 | 10\n3 | 10\n4 | 10', '1 | 1\n2 | 2\n3 | 3\n4 | 4', '1 | 1\n2 | 3\n3 | 5\n4 | 7'], 'Cada fila suma todas las anteriores y ella misma: 1, 1+2=3, 1+2+3=6, 1+2+3+4=10.'),
      tf('Un `SUM(x) OVER (PARTITION BY g)` (sin `ORDER BY`) es un total acumulado.', false, 'Sin `ORDER BY` calcula el total de toda la partición. El acumulado necesita un orden.'),
      sqlCode('Muestra el saldo acumulado de la cuenta 1: `fecha`, `importe` y `saldo` (suma acumulada), ordenado por fecha.', {
        setup: 'banco',
        check: ordered({ names: true }),
        solution: 'SELECT fecha, importe, SUM(importe) OVER (ORDER BY fecha) AS saldo FROM movimientos WHERE cuenta_id = 1 ORDER BY fecha;',
        hint: 'SUM(importe) OVER (ORDER BY fecha)',
        why: 'El `WHERE` deja solo los movimientos de la cuenta 1 y la ventana acumula en orden de fecha.',
      }),
      sqlPractice({
        goal: 'Pedidos acumulados del año',
        prompt: 'La directora quiere ver cuántos pedidos lleva acumulados la tienda mes a mes.\n\n**Muestra `mes` (formato `AAAA-MM`), `pedidos` y `acumulado`, ordenado por mes.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: `${MENSUAL} SELECT mes, pedidos, SUM(pedidos) OVER (ORDER BY mes) AS acumulado FROM m ORDER BY mes;`,
        hints: ['Primero una CTE con los pedidos por mes.', '`SUM(pedidos) OVER (ORDER BY mes)`'],
        explain: 'Un `ORDER BY` dentro de la ventana convierte la suma en acumulada.',
        commands: ['ROWS BETWEEN', 'SUM'],
      }),
      sqlPractice({
        goal: 'La tendencia suavizada',
        prompt: 'Las cifras mensuales saltan mucho. Para ver la tendencia:\n\n**Muestra `mes`, `pedidos` y `media_movil` (media del mes y los 2 anteriores, 2 decimales), ordenado por mes.** Usa `ROWS BETWEEN`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROWS BETWEEN'] }),
        solution: `${MENSUAL} SELECT mes, pedidos, ROUND(AVG(pedidos) OVER (ORDER BY mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS media_movil FROM m ORDER BY mes;`,
        hints: ['El marco es `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`.', 'Los primeros meses promedian menos filas (no hay 2 anteriores).'],
        explain: 'La media móvil suaviza picos y valles: es la base de los análisis de tendencia.',
        commands: ['ROWS BETWEEN', 'AVG'],
      }),
      sqlPractice({
        goal: 'Extracto bancario',
        prompt: 'El banco necesita un extracto con el saldo después de cada movimiento, **para cada cuenta por separado**.\n\n**Muestra `cuenta_id`, `fecha`, `concepto`, `importe` y `saldo` (acumulado de esa cuenta), ordenado por cuenta y fecha.**',
        setup: 'banco',
        check: ordered({ names: true }),
        solution: 'SELECT cuenta_id, fecha, concepto, importe, SUM(importe) OVER (PARTITION BY cuenta_id ORDER BY fecha, id) AS saldo FROM movimientos ORDER BY cuenta_id, fecha;',
        hints: ['`PARTITION BY cuenta_id` reinicia el acumulado en cada cuenta.', 'Ordena dentro de la ventana por fecha (y `id` para desempatar).'],
        explain: '`PARTITION BY` + `ORDER BY` en la ventana: un acumulado independiente por cuenta, como cualquier extracto.',
        commands: ['ROWS BETWEEN', 'OVER / PARTITION BY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s10-5', { title: 'NTILE, FIRST_VALUE y patrones', summary: 'Cuartiles, primer valor, deduplicar y ventanas con nombre', emoji: '🧰', commands: ['NTILE', 'FIRST_VALUE'], minutes: 10 }, [
      learn(
        'Dividir en grupos: NTILE',
        `
\`NTILE(n)\` reparte las filas (según el orden) en **n grupos del mismo tamaño**, numerados de 1 a n. Con 4 grupos son **cuartiles**; con 10, **deciles**:

\`\`\`
SELECT nombre, precio,
       NTILE(3) OVER (ORDER BY precio) AS tercio
FROM productos;
\`\`\`

Sirve para segmentar: el 25 % de clientes que más gastan, los productos del tercio más barato… (Si las filas no se reparten exactamente, los primeros grupos reciben una fila más.)
`,
        '🍰',
      ),
      sqlDemo('Tres tercios', 'tienda', [
        ['SELECT nombre, precio, NTILE(3) OVER (ORDER BY precio) AS tercio FROM productos ORDER BY precio;', '14 productos en 3 grupos: 5, 5 y 4 filas'],
      ]),
      learn(
        'FIRST_VALUE, LAST_VALUE y NTH_VALUE',
        `
- \`FIRST_VALUE(col)\` — el valor de la **primera** fila del marco.
- \`LAST_VALUE(col)\` — el de la **última**.
- \`NTH_VALUE(col, n)\` — el de la fila n.

Permiten comparar cada fila con el «extremo» de su grupo: «precio sobre el más barato de la categoría».

> OJO: El marco por defecto acaba en la fila **actual**, así que \`LAST_VALUE\` sin más devolvería… la propia fila. Para el último de verdad hay que ampliar el marco: \`ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING\`.
`,
        '🥇',
      ),
      sqlDemo('Comparar con el extremo del grupo', 'tienda', [
        ["SELECT categoria, nombre, precio, ROUND(precio - FIRST_VALUE(precio) OVER (PARTITION BY categoria ORDER BY precio), 2) AS sobre_el_mas_barato FROM productos WHERE categoria IN ('audio', 'pantallas') ORDER BY categoria, precio;", 'Cuánto cuesta cada producto por encima del más barato de su categoría'],
        ["SELECT categoria, nombre, precio, FIRST_VALUE(nombre) OVER w AS el_mas_caro, LAST_VALUE(nombre) OVER (PARTITION BY categoria ORDER BY precio DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS el_mas_barato FROM productos WHERE categoria IN ('audio', 'pantallas') WINDOW w AS (PARTITION BY categoria ORDER BY precio DESC) ORDER BY categoria, precio DESC;", 'FIRST_VALUE y LAST_VALUE (este con el marco ampliado), con una ventana con nombre'],
      ]),
      learn(
        'Un patrón de oro: quitar duplicados',
        `
Con \`ROW_NUMBER\` puedes **quedarte con una sola fila por grupo**: numeras las filas de cada grupo y conservas la número 1. Así se deduplican contactos conservando el más antiguo, o se obtiene «la última compra de cada cliente».

\`\`\`
SELECT id, nombre, email
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn
  FROM contactos
) t
WHERE rn = 1;
\`\`\`

Cambiando el \`ORDER BY\` decides cuál sobrevive: \`ORDER BY id\` conserva el primero; \`ORDER BY fecha DESC\`, el más reciente.
`,
        '👯',
      ),
      sqlDemo('Deduplicar contactos', { db: 'vacia', script: CONTACTOS }, [
        ['SELECT * FROM contactos ORDER BY email, id;', 'Ana y Luis aparecen dos veces con el mismo email'],
        ['SELECT id, nombre, email FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn FROM contactos) t WHERE rn = 1 ORDER BY id;', 'Nos quedamos con el primero de cada email (el de menor id)'],
      ]),
      mc('¿Por qué `LAST_VALUE(x) OVER (ORDER BY y)` suele dar la propia fila?', ['Es un error de SQL', 'Porque el marco por defecto termina en la fila actual, y por tanto la «última» es ella', 'Porque LAST_VALUE no existe', 'Porque necesita PARTITION BY'], 1, 'El marco por defecto es «desde el principio hasta la fila actual». Para ver el último valor real hay que ampliar el marco hasta `UNBOUNDED FOLLOWING`.'),
      sqlOut('Predice los grupos de NTILE', 'tienda', 'SELECT n, NTILE(2) OVER (ORDER BY n) FROM generate_series(1, 5) AS n;', ['1 | 1\n2 | 1\n3 | 2\n4 | 2\n5 | 2', '1 | 1\n2 | 1\n3 | 1\n4 | 1\n5 | 2', '1 | 1\n2 | 2\n3 | 1\n4 | 2\n5 | 1'], '5 filas en 2 grupos: el primero recibe una fila más (3 y 2): las filas 1, 2 y 3 al grupo 1, y 4 y 5 al grupo 2.'),
      tf('`ROW_NUMBER() OVER (PARTITION BY email ORDER BY id)` numera 1 al primer contacto de cada email.', true, 'Con la partición por email, cada email reinicia la numeración; la fila 1 es la de menor `id`.'),
      sqlCode('Divide los productos en 4 grupos de precio (`NTILE(4)`) y muestra `nombre`, `precio` y `cuartil`, ordenado por precio.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, precio, NTILE(4) OVER (ORDER BY precio) AS cuartil FROM productos ORDER BY precio;',
        hint: 'NTILE(4) OVER (ORDER BY precio)',
        why: '14 productos en 4 grupos: 4, 4, 3 y 3 filas.',
      }),
      sqlPractice({
        goal: 'Los tres escalones de precio',
        prompt: 'Comercial quiere clasificar los productos en tres tramos de igual tamaño (barato, medio, caro).\n\n**Muestra `nombre`, `precio` y `tercio` (1, 2 o 3 con `NTILE`), ordenado por precio.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['NTILE'] }),
        solution: 'SELECT nombre, precio, NTILE(3) OVER (ORDER BY precio) AS tercio FROM productos ORDER BY precio;',
        hints: ['`NTILE(3) OVER (ORDER BY precio)`.', 'Va en el SELECT, con un alias.'],
        explain: 'A diferencia de un `CASE` con umbrales fijos, `NTILE` reparte por posición: siempre grupos del mismo tamaño.',
        commands: ['NTILE'],
      }),
      sqlPractice({
        goal: 'Contactos sin duplicados',
        prompt: 'La libreta de contactos tiene emails repetidos. Quédate con **un solo contacto por email: el de menor `id`**.\n\n**Muestra `id`, `nombre` y `email`, ordenado por `id`.**',
        setup: { db: 'vacia', script: CONTACTOS },
        check: ordered({ names: true, uses: ['ROW_NUMBER'] }),
        solution: 'SELECT id, nombre, email FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id) AS rn FROM contactos) t WHERE rn = 1 ORDER BY id;',
        hints: ['Numera con `ROW_NUMBER() OVER (PARTITION BY email ORDER BY id)`.', 'Conserva `rn = 1` en la consulta de fuera.'],
        explain: 'La combinación `ROW_NUMBER` + `WHERE rn = 1` es la forma estándar de deduplicar con criterio.',
        commands: ['ROW_NUMBER'],
      }),
      sqlPractice({
        goal: 'Distancia al más barato',
        prompt: 'En cada categoría, comercial quiere ver **cuánto más caro** es cada producto que el más barato de su categoría.\n\n**Muestra `categoria`, `nombre`, `precio` y `sobre_el_mas_barato` (diferencia, 2 decimales), ordenado por categoría y precio.** Usa `FIRST_VALUE`.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['FIRST_VALUE'] }),
        solution: 'SELECT categoria, nombre, precio, ROUND(precio - FIRST_VALUE(precio) OVER (PARTITION BY categoria ORDER BY precio), 2) AS sobre_el_mas_barato FROM productos ORDER BY categoria, precio;',
        hints: ['`FIRST_VALUE(precio) OVER (PARTITION BY categoria ORDER BY precio)` es el más barato de cada categoría.', 'Réstalo al precio de la fila.'],
        explain: 'Ordenado por precio ascendente, la «primera» fila de cada categoría es la más barata: `FIRST_VALUE` la trae a todas las filas de su grupo.',
        commands: ['FIRST_VALUE'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: los más vendidos de cada categoría',
    prompt:
      'El director comercial quiere saber **cuáles son los 2 productos más vendidos de cada categoría** (por unidades vendidas, sumando `cantidad` de `detalle_pedido`; los productos sin ventas cuentan 0).\n\n**Muestra `categoria`, `nombre`, `unidades`, `puesto` (con `RANK`, por unidades de mayor a menor) y `pct` (porcentaje de las unidades de su categoría, 1 decimal), solo con `puesto` 1 o 2. Si hay empates, salen todos los empatados.**\n\nOrdena por categoría, puesto y nombre.',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution:
      'WITH v AS (SELECT pr.id, pr.nombre, pr.categoria, COALESCE(SUM(d.cantidad), 0) AS unidades FROM productos pr LEFT JOIN detalle_pedido d ON d.producto_id = pr.id GROUP BY pr.id, pr.nombre, pr.categoria), r AS (SELECT categoria, nombre, unidades, RANK() OVER (PARTITION BY categoria ORDER BY unidades DESC) AS puesto, ROUND(100.0 * unidades / SUM(unidades) OVER (PARTITION BY categoria), 1) AS pct FROM v) SELECT categoria, nombre, unidades, puesto, pct FROM r WHERE puesto <= 2 ORDER BY categoria, puesto, nombre;',
    hints: ['Primero una CTE con las unidades de cada producto (`LEFT JOIN` con `detalle_pedido`).', 'Después otra CTE con `RANK() OVER (PARTITION BY categoria …)` y `SUM(unidades) OVER (PARTITION BY categoria)`.'],
    explain: 'Agregación, `LEFT JOIN`, dos CTE, `RANK` por grupo y porcentaje con una ventana: ya manejas las funciones de ventana como un analista de datos. ¡Zona completada!',
    commands: ['RANK / DENSE_RANK', 'OVER / PARTITION BY', 'WITH'],
  },
});
