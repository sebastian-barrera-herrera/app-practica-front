import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s5 = sqlWorld({
  id: 's5',
  index: 5,
  title: 'Unir tablas',
  subtitle: 'JOIN: el corazón de las bases de datos relacionales',
  emoji: '🔗',
  color: '#A78BFA',
  level: 'intermedio',
  intro:
    'Una base de datos bien diseñada reparte la información en varias tablas pequeñas para no repetir datos: los clientes por un lado, los pedidos por otro. Pero las preguntas interesantes mezclan tablas: «¿qué compró cada cliente?». `JOIN` es la herramienta que las vuelve a unir en el momento de consultar. Es lo que más separa a quien «sabe SQL» de quien solo lo ha probado, así que vamos paso a paso.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s5-1', { title: 'Por qué hay varias tablas', summary: 'Claves primarias y foráneas', emoji: '🧬', commands: ['PRIMARY KEY', 'FOREIGN KEY'], minutes: 9 }, [
      learn(
        'El problema de repetirlo todo',
        `
Imagina guardar los pedidos en **una sola tabla** con el nombre, la ciudad y el email del cliente en cada fila. Ana hace 4 pedidos y sus datos se repiten **4 veces**. Si cambia de email, tendrías que cambiarlo en 4 sitios, y si te olvidas de uno, la base de datos se contradice.

La solución es **separar** la información:

- Una tabla \`clientes\`: cada cliente **una sola vez**, con su \`id\`.
- Una tabla \`pedidos\`: cada pedido guarda solo \`cliente_id\`, un **número que apunta** al cliente.

Así, cambiar un email es tocar **una** fila.
`,
        '🧬',
      ),
      illus('sql-er-model', 'El modelo de TiendaTech', 'Cuatro tablas conectadas por claves. Toca una conexión para ver cómo se relacionan.'),
      learn(
        'Claves primarias y foráneas',
        `
- **Clave primaria** (\`PRIMARY KEY\`): la columna que **identifica de forma única** cada fila: \`clientes.id\`. No puede repetirse ni ser NULL.
- **Clave foránea** (\`FOREIGN KEY\`): una columna que **guarda la clave primaria de otra tabla** y la apunta: \`pedidos.cliente_id\` apunta a \`clientes.id\`.

La base de datos **vigila** esa relación: no te deja crear un pedido para un cliente que no existe, ni borrar un cliente que aún tiene pedidos (salvo que se configure otra cosa).

Esta relación, un cliente con **muchos** pedidos, se llama **uno a muchos** (1:N).

> CLAVE: La clave foránea es el hilo que luego usarás en el \`JOIN\`: \`pedidos.cliente_id = clientes.id\`.
`,
        '🔑',
      ),
      sqlDemo('Siguiendo el hilo a mano', 'tienda', [
        ['SELECT id, cliente_id, fecha FROM pedidos WHERE id = 5;', 'El pedido 5 guarda cliente_id = 3… pero ¿quién es el 3?'],
        ['SELECT id, nombre FROM clientes WHERE id = 3;', 'Seguimos la clave a la otra tabla: el cliente 3 es Marta López'],
        ['SELECT id, fecha, estado FROM pedidos WHERE cliente_id = 1;', 'Y al revés: todos los pedidos del cliente 1 (Ana)'],
      ], 'Antes de aprender JOIN, hagamos a mano lo que él hace automáticamente: seguir una clave de una tabla a otra.'),
      mc('En la tabla `pedidos`, ¿qué es la columna `cliente_id`?', ['Una clave primaria', 'Una clave foránea hacia clientes', 'Una columna calculada', 'El nombre del cliente'], 1, '`cliente_id` guarda el `id` de un cliente: es una clave foránea que apunta a `clientes.id`.'),
      match(
        'Une cada elemento con su papel',
        [
          ['clientes.id', 'Clave primaria de clientes'],
          ['pedidos.cliente_id', 'Clave foránea hacia clientes'],
          ['detalle_pedido.producto_id', 'Clave foránea hacia productos'],
          ['productos.id', 'Clave primaria de productos'],
        ],
        'La clave primaria identifica filas de su propia tabla; las foráneas apuntan a la clave primaria de otra.',
      ),
      learn(
        'Un primer vistazo al desastre: combinar todo con todo',
        `
¿Qué pasa si simplemente pones **dos tablas en el \`FROM\`**, separadas por una coma, sin decir cómo se relacionan?

\`\`\`
SELECT COUNT(*) FROM clientes, pedidos;
\`\`\`

SQL combina **cada fila de una con cada fila de la otra**: es el **producto cartesiano**. Con 12 clientes y 24 pedidos salen 12 × 24 = **288** filas, casi todas absurdas («Ana García con el pedido de Marta»). Para quedarse solo con las parejas correctas hace falta una condición: la que une la clave foránea con la primaria. Eso es lo que hace \`JOIN … ON\`, el tema de la siguiente lección.
`,
        '💥',
      ),
      sqlDemo('Todas con todas', 'tienda', [
        ['SELECT COUNT(*) AS combinaciones FROM clientes, pedidos;', '12 clientes × 24 pedidos = 288 combinaciones'],
        ['SELECT c.nombre, p.id FROM clientes c, pedidos p WHERE c.id = p.cliente_id LIMIT 4;', 'Con la condición clave = clave solo quedan las parejas correctas. Esto es un JOIN escrito a la antigua'],
      ]),
      mc('Una tabla tiene 5 filas y otra 7. ¿Cuántas filas tiene su producto cartesiano?', ['12', '35', '5', '7'], 1, 'Cada una de las 5 filas se combina con cada una de las 7: 5 × 7 = 35.'),
      sqlOut('Predice: ¿qué pedidos tiene el cliente 1?', 'tienda', 'SELECT id, fecha FROM pedidos WHERE cliente_id = 1;', ['1 | 2024-01-10\n2 | 2024-02-03\n8 | 2024-04-15', '1 | Ana García\n2 | Ana García\n8 | Ana García\n17 | Ana García', '1 | 2024-01-10\n2 | 2024-02-03\n3 | 2024-02-14\n4 | 2024-03-01'], 'El filtro por clave foránea devuelve los 4 pedidos del cliente 1: 1, 2, 8 y 17. (La tabla `pedidos` no tiene el nombre del cliente: eso está en `clientes`.)'),
      sqlCode('Muestra el `id`, la `fecha` y el `estado` de todos los pedidos del cliente cuyo id es 5.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT id, fecha, estado FROM pedidos WHERE cliente_id = 5;',
        hint: 'La clave foránea es cliente_id',
        why: 'Filtrando por la clave foránea obtienes todos los pedidos de ese cliente.',
      }),
      sqlPractice({
        goal: 'Las compras del pedido 5',
        prompt: 'Sigue el hilo: la tabla `detalle_pedido` guarda qué productos lleva cada pedido (`pedido_id`, `producto_id`, `cantidad`).\n\n**Muestra `producto_id` y `cantidad` de las líneas del pedido número 5.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT producto_id, cantidad FROM detalle_pedido WHERE pedido_id = 5;',
        hints: ['La tabla es `detalle_pedido`.', '`WHERE pedido_id = 5`'],
        explain: '`detalle_pedido` es una tabla intermedia: sus dos claves foráneas unen pedidos con productos. Todavía vemos números (ids) en lugar de nombres; con `JOIN` los convertiremos en nombres.',
        commands: ['FOREIGN KEY'],
      }),
      sqlPractice({
        goal: 'El reparto de una película',
        prompt: 'En la base de cine, `reparto` une películas con actores (`pelicula_id`, `actor_id`, `personaje`).\n\n**Muestra `actor_id` y `personaje` del reparto de la película con id 7 (Origen).**',
        setup: 'cine',
        check: same({ names: true }),
        solution: 'SELECT actor_id, personaje FROM reparto WHERE pelicula_id = 7;',
        hints: ['Filtra `reparto` por `pelicula_id`.', '`WHERE pelicula_id = 7`'],
        explain: 'Otra tabla intermedia: una película tiene muchos actores y un actor muchas películas (relación N:M). Verás cómo se modela en la zona de diseño.',
        commands: ['FOREIGN KEY'],
      }),
      sqlPractice({
        goal: 'Los clientes más fieles',
        prompt: 'Sin `JOIN` aún no podemos ver el nombre del cliente de cada pedido, pero sí contar. Pedidos por cliente:\n\n**Muestra `cliente_id` y cuántos pedidos tiene (`pedidos`), solo de los clientes con 3 o más pedidos, ordenados por `cliente_id`.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT cliente_id, COUNT(*) AS pedidos FROM pedidos GROUP BY cliente_id HAVING COUNT(*) >= 3 ORDER BY cliente_id;',
        hints: ['Agrupa por `cliente_id`.', '`HAVING COUNT(*) >= 3`'],
        explain: 'Agrupar por una clave foránea es la forma de resumir «por cliente» sin unir tablas. En la próxima lección veremos cómo poner nombres a esos ids.',
        commands: ['FOREIGN KEY', 'GROUP BY'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s5-2', { title: 'INNER JOIN', summary: 'Unir dos tablas por una clave', emoji: '🤝', commands: ['INNER JOIN', 'Alias de tabla'], minutes: 9 }, [
      learn(
        'JOIN … ON',
        `
\`JOIN\` une dos tablas **emparejando las filas que cumplen una condición**, la del \`ON\`:

\`\`\`
SELECT pedidos.id, clientes.nombre, pedidos.fecha
FROM pedidos
JOIN clientes ON clientes.id = pedidos.cliente_id;
\`\`\`

Léelo así: «de **pedidos**, y por cada pedido, **junta** el cliente cuyo \`id\` sea igual a su \`cliente_id\`». El resultado tiene columnas de las dos tablas y una fila por cada pareja que encaja.

\`JOIN\` a secas es un **\`INNER JOIN\`** (unión interna): solo salen las filas que **tienen pareja** en las dos tablas. Un pedido sin cliente o un cliente sin pedidos **no aparecen**.
`,
        '🤝',
      ),
      learn(
        'Alias de tabla y columnas ambiguas',
        `
Escribir \`clientes.id = pedidos.cliente_id\` cansa. Se pone un **alias corto** a cada tabla (con o sin \`AS\`) y se usa en todas partes:

\`\`\`
SELECT p.id, c.nombre, p.fecha
FROM pedidos p
JOIN clientes c ON c.id = p.cliente_id;
\`\`\`

Cuando dos tablas tienen una columna con el **mismo nombre** (aquí \`id\`), SQL no sabe a cuál te refieres y da error de **columna ambigua**. La solución: prefijarla con la tabla o su alias (\`p.id\`).

> TIP: Usa alias de una o dos letras que recuerden la tabla (\`c\` para clientes, \`p\` para pedidos). Y escribe **siempre** el prefijo en las columnas, aunque no haga falta: la consulta se entiende mejor.
`,
        '🏷️',
      ),
      sqlDemo('Tu primer JOIN', 'tienda', [
        ['SELECT p.id, c.nombre, p.fecha, p.estado FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ORDER BY p.id LIMIT 6;', 'Cada pedido con el nombre de su cliente'],
        ["SELECT p.id, c.nombre FROM pedidos p INNER JOIN clientes c ON c.id = p.cliente_id WHERE p.estado = 'entregado' AND c.ciudad = 'Madrid' ORDER BY p.id;", 'Después del JOIN puedes filtrar con WHERE usando columnas de las dos tablas'],
        sqlErr('SELECT id, nombre FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;', 'Las dos tablas tienen «id». El error dice cuál es el problema y cómo arreglarlo'),
      ]),
      mc('En `FROM pedidos p JOIN clientes c ON c.id = p.cliente_id`, ¿qué hace la condición `ON`?', ['Ordena las filas', 'Dice qué filas de una tabla se emparejan con cuáles de la otra', 'Filtra los clientes de Madrid', 'Crea una clave primaria'], 1, '`ON` indica cuándo dos filas se emparejan: cuando el `id` del cliente coincide con el `cliente_id` del pedido.'),
      sqlOut('Predice el resultado del JOIN', 'cine', 'SELECT p.titulo, d.nombre FROM peliculas p JOIN directores d ON d.id = p.director_id WHERE p.anio = 2006 ORDER BY p.titulo;', ['El laberinto del fauno | Pedro Almodóvar\nVolver | Guillermo del Toro', 'El laberinto del fauno | Guillermo del Toro\nLa forma del agua | Guillermo del Toro\nVolver | Pedro Almodóvar', 'Volver | Pedro Almodóvar\nEl laberinto del fauno | Guillermo del Toro'], 'Dos películas son de 2006: «El laberinto del fauno» (Guillermo del Toro) y «Volver» (Pedro Almodóvar). El JOIN pone a cada una el nombre de **su** director.'),
      tf('Con `INNER JOIN`, un cliente que nunca ha hecho un pedido aparece en el resultado con el pedido a NULL.', false, 'Eso lo hace `LEFT JOIN`. El `INNER JOIN` solo devuelve las filas que tienen pareja en las dos tablas.'),
      fill('Completa el JOIN', 'SELECT p.id, c.nombre FROM pedidos p ___ clientes c ___ c.id = p.cliente_id;', ['JOIN', 'ON', 'WHERE', 'FROM'], ['JOIN', 'ON'], '`JOIN` indica la tabla que se une y `ON` la condición que empareja las filas.'),
      sqlCode('Muestra el `id` de cada pedido y el `nombre` de su cliente (con alias de tabla y `JOIN`).', {
        setup: 'tienda',
        check: same({ uses: ['JOIN'] }),
        solution: 'SELECT p.id, c.nombre FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;',
        hint: 'FROM pedidos p JOIN clientes c ON c.id = p.cliente_id',
        why: 'El `ON` empareja cada pedido con su cliente a través de la clave foránea.',
      }),
      sqlPractice({
        goal: 'Pedidos con nombre',
        prompt: 'Contabilidad no entiende los números: quiere nombres.\n\n**Muestra `id` (del pedido), `nombre` (del cliente) y `fecha` de todos los pedidos, ordenados por `id`.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['JOIN'] }),
        solution: 'SELECT p.id, c.nombre, p.fecha FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ORDER BY p.id;',
        hints: ['Une `pedidos` con `clientes` por `c.id = p.cliente_id`.', 'Prefija `id` con el alias del pedido: `p.id`.'],
        explain: 'Tu primer `JOIN`. Las columnas salen de las dos tablas y cada pedido lleva ya el nombre de su cliente.',
        commands: ['INNER JOIN', 'Alias de tabla'],
      }),
      sqlPractice({
        goal: 'Películas con su director',
        prompt: 'El programa del cine debe mostrar cada película con el nombre de su director.\n\n**Muestra `titulo`, `anio` y el nombre del director como `director`, ordenados por título.** (La película sin director no aparecerá con `INNER JOIN`.)',
        setup: 'cine',
        check: ordered({ names: true, uses: ['JOIN'] }),
        solution: 'SELECT p.titulo, p.anio, d.nombre AS director FROM peliculas p JOIN directores d ON d.id = p.director_id ORDER BY p.titulo;',
        hints: ['Une `peliculas` y `directores` con `d.id = p.director_id`.', '`d.nombre AS director`'],
        explain: 'El alias del resultado (`director`) evita dos columnas llamadas `nombre`. La película sin estrenar no tiene director, así que no encuentra pareja y desaparece.',
        commands: ['INNER JOIN', 'AS'],
      }),
      sqlPractice({
        goal: 'Entregas en Madrid',
        prompt: 'Logística prepara las rutas de reparto.\n\n**Muestra `id` del pedido, `nombre` del cliente y `fecha` de los pedidos con estado `entregado` cuyo cliente viva en Madrid, ordenados por `id`.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['JOIN'] }),
        solution: "SELECT p.id, c.nombre, p.fecha FROM pedidos p JOIN clientes c ON c.id = p.cliente_id WHERE p.estado = 'entregado' AND c.ciudad = 'Madrid' ORDER BY p.id;",
        hints: ['El `WHERE` puede usar columnas de las dos tablas.', "`p.estado = 'entregado' AND c.ciudad = 'Madrid'`"],
        explain: 'Con `JOIN` filtras por datos de cualquiera de las dos tablas: el estado viene de `pedidos` y la ciudad, de `clientes`.',
        commands: ['INNER JOIN', 'WHERE'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s5-3', { title: 'LEFT, RIGHT y FULL JOIN', summary: 'Conservar las filas sin pareja', emoji: '🫥', commands: ['LEFT JOIN', 'RIGHT / FULL JOIN'], minutes: 10 }, [
      learn(
        'Las filas que se quedan sin pareja',
        `
Con \`INNER JOIN\` desaparecen las filas sin pareja. Pero a veces **justo eso** es lo que quieres ver: «¿qué clientes **nunca** han comprado?». Para conservarlas hay tres variantes:

| JOIN | Conserva |
| --- | --- |
| \`INNER JOIN\` | solo las filas con pareja en las dos tablas |
| \`LEFT JOIN\` | **todas** las de la tabla izquierda (las que no tienen pareja llevan NULL a la derecha) |
| \`RIGHT JOIN\` | todas las de la derecha |
| \`FULL JOIN\` | todas las de las dos |

La tabla «izquierda» es la que va **antes** del \`JOIN\`; la «derecha», la que va después.
`,
        '🫥',
      ),
      illus('sql-join-types', 'Los tipos de JOIN', 'Elige el tipo y mira qué filas se conservan y cuáles se descartan.'),
      sqlDemo('Clientes y sus pedidos, incluso sin pedidos', 'tienda', [
        ['SELECT c.nombre, p.id AS pedido FROM clientes c JOIN pedidos p ON p.cliente_id = c.id ORDER BY c.nombre, p.id LIMIT 6;', 'Con INNER JOIN, Raúl no aparece (no tiene pedidos)'],
        ['SELECT c.nombre, p.id AS pedido FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id ORDER BY c.nombre DESC, p.id LIMIT 4;', 'Con LEFT JOIN sí aparece, con el pedido a NULL'],
      ]),
      learn(
        'El truco del anti-join',
        `
Como las filas sin pareja traen \`NULL\` en las columnas de la otra tabla, puedes **encontrarlas** filtrando por ese NULL:

\`\`\`
SELECT c.nombre
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id
WHERE p.id IS NULL;
\`\`\`

«Clientes **sin** pedidos». Se llama **anti-join** y es una de las consultas más útiles que existen: productos sin ventas, alumnos sin matrícula, usuarios sin publicaciones…

> OJO: Para detectar «sin pareja» filtra por una columna de la derecha que **nunca** sea NULL en una fila real, normalmente su clave primaria (\`p.id\`).
`,
        '🕵️',
      ),
      sqlDemo('Anti-join y recuentos con ceros', 'tienda', [
        ['SELECT c.nombre FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id WHERE p.id IS NULL;', 'Clientes que nunca han comprado'],
        ['SELECT c.nombre, COUNT(p.id) AS pedidos FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id GROUP BY c.id, c.nombre ORDER BY pedidos DESC, c.nombre LIMIT 12;', 'Cuántos pedidos tiene cada cliente, incluidos los de 0. Cuenta con COUNT(p.id): no cuenta los NULL'],
      ]),
      mc('¿Por qué en un `LEFT JOIN` se cuenta con `COUNT(p.id)` y no con `COUNT(*)`?', ['Porque COUNT(*) da error', 'Porque COUNT(*) contaría también la fila «vacía» del cliente sin pedidos (1) en vez de 0', 'Porque COUNT(p.id) es más rápido', 'No hay diferencia'], 1, '`COUNT(*)` cuenta filas: el cliente sin pedidos tiene una fila (con NULL) y contaría 1. `COUNT(p.id)` ignora ese NULL y da 0.'),
      sqlOut('Predice el anti-join', 'cine', 'SELECT p.titulo FROM peliculas p LEFT JOIN directores d ON d.id = p.director_id WHERE d.id IS NULL;', ['Tesis', 'Barbie\nPelícula sin estrenar', 'Película sin estrenar | NULL'], 'Solo una película no encuentra director: la que no tiene `director_id` (NULL). El `WHERE d.id IS NULL` la deja sola.'),
      tf('`A LEFT JOIN B` y `B RIGHT JOIN A` devuelven lo mismo (con las columnas en distinto orden).', true, 'Son equivalentes: el `RIGHT JOIN` es un `LEFT JOIN` con las tablas intercambiadas. Por eso casi todo el mundo usa solo `LEFT JOIN`.'),
      sqlCode('Muestra el `nombre` de los clientes que no tienen ningún pedido.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT c.nombre FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id WHERE p.id IS NULL;',
        hint: 'LEFT JOIN y filtra por p.id IS NULL',
        why: 'El `LEFT JOIN` conserva a todos los clientes; `p.id IS NULL` deja solo los que no tienen pedido.',
      }),
      sqlPractice({
        goal: 'Clientes dormidos',
        prompt: 'Marketing quiere reactivar a los clientes que **nunca han comprado**.\n\n**Muestra `nombre`, `email` y `fecha_alta` de los clientes sin ningún pedido.**',
        setup: 'tienda',
        check: same({ names: true, uses: ['LEFT JOIN'] }),
        solution: 'SELECT c.nombre, c.email, c.fecha_alta FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id WHERE p.id IS NULL;',
        hints: ['`LEFT JOIN` desde clientes hacia pedidos.', 'Filtra con `p.id IS NULL`.'],
        explain: 'El anti-join con `LEFT JOIN … IS NULL` es la forma estándar de decir «los que no tienen…».',
        commands: ['LEFT JOIN'],
      }),
      sqlPractice({
        goal: 'Pedidos por cliente (con ceros)',
        prompt: 'El informe de fidelización debe incluir a **todos** los clientes, también a los que no han comprado.\n\n**Muestra `nombre` y su número de pedidos como `pedidos`, ordenado de más a menos pedidos y luego por nombre.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT c.nombre, COUNT(p.id) AS pedidos FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id GROUP BY c.id, c.nombre ORDER BY pedidos DESC, c.nombre;',
        hints: ['`LEFT JOIN` para conservar a todos los clientes.', 'Cuenta con `COUNT(p.id)`, no con `COUNT(*)`.'],
        explain: '`LEFT JOIN` + `GROUP BY` + `COUNT(columna_de_la_derecha)`: la receta para listar «cuántos de cada», incluidos los ceros.',
        commands: ['LEFT JOIN', 'GROUP BY'],
      }),
      sqlPractice({
        goal: 'Alumnos y asignaturas',
        prompt: 'En la escuela, la secretaría quiere saber cuántas asignaturas cursa cada alumno.\n\n**Muestra `nombre` y `asignaturas` (cuántas matrículas), de más a menos y luego por nombre, y solo los 4 primeros.**',
        setup: 'escuela',
        check: ordered({ names: true }),
        solution: 'SELECT a.nombre, COUNT(m.asignatura_id) AS asignaturas FROM alumnos a LEFT JOIN matriculas m ON m.alumno_id = a.id GROUP BY a.id, a.nombre ORDER BY asignaturas DESC, a.nombre LIMIT 4;',
        hints: ['Une `alumnos` con `matriculas` por `m.alumno_id = a.id`.', 'Cuenta `m.asignatura_id`.'],
        explain: 'El mismo patrón en otra base de datos. Reconocer patrones es la clave para escribir SQL con soltura.',
        commands: ['LEFT JOIN', 'COUNT'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s5-4', { title: 'Unir varias tablas', summary: 'Cadenas de JOIN y agregados', emoji: '⛓️', commands: ['JOIN de varias tablas'], minutes: 10 }, [
      learn(
        'Un JOIN detrás de otro',
        `
Para llegar a un dato que está a varias tablas de distancia, **encadenas** los \`JOIN\`. Cada uno añade una tabla usando la clave que la conecta con las anteriores:

\`\`\`
SELECT p.id, c.nombre, pr.nombre AS producto, d.cantidad
FROM pedidos p
JOIN clientes c       ON c.id = p.cliente_id
JOIN detalle_pedido d ON d.pedido_id = p.id
JOIN productos pr     ON pr.id = d.producto_id;
\`\`\`

El camino es: **pedido → cliente**, **pedido → líneas del pedido → producto**. Dibujar mentalmente el mapa de tablas (como el del modelo de TiendaTech) ayuda mucho a decidir qué \`JOIN\` hacen falta.

Una **tabla intermedia** como \`detalle_pedido\` resuelve las relaciones **muchos a muchos**: un pedido tiene muchos productos y un producto está en muchos pedidos.
`,
        '⛓️',
      ),
      sqlDemo('Cuatro tablas en una consulta', 'tienda', [
        ['SELECT p.id AS pedido, c.nombre AS cliente, pr.nombre AS producto, d.cantidad FROM pedidos p JOIN clientes c ON c.id = p.cliente_id JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.id <= 3 ORDER BY p.id, pr.nombre;', 'Quién compró qué: los tres primeros pedidos'],
        ['SELECT p.id, ROUND(SUM(d.cantidad * pr.precio), 2) AS total FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id GROUP BY p.id ORDER BY total DESC LIMIT 3;', 'JOIN + agregación: el importe total de cada pedido'],
      ]),
      learn(
        'JOIN + GROUP BY: el dúo estrella',
        `
La mayoría de informes reales combinan las dos ideas: **unir** para tener todos los datos en una misma fila y **agrupar** para resumirlos.

- Primero se hace el \`JOIN\`: cada fila ya tiene cliente, producto y cantidad.
- Después \`GROUP BY\` resume esas filas ya unidas.

Cuando agrupas por una entidad (un cliente), agrupa por su **\`id\` y su nombre** (\`GROUP BY c.id, c.nombre\`): así dos clientes con el mismo nombre no se mezclan.
`,
        '🧮',
      ),
      mc('Para saber el nombre del **producto** de cada línea de `detalle_pedido`, ¿con qué tabla haces `JOIN`?', ['clientes', 'productos', 'pedidos', 'ninguna: ya está en detalle_pedido'], 1, '`detalle_pedido.producto_id` es una clave foránea hacia `productos.id`, donde está el nombre.'),
      sqlOut('Predice el reparto', 'cine', 'SELECT a.nombre, p.titulo FROM reparto r JOIN actores a ON a.id = r.actor_id JOIN peliculas p ON p.id = r.pelicula_id WHERE p.anio = 2023 ORDER BY a.nombre;', ['Cillian Murphy | Oppenheimer', 'Margot Robbie | Barbie\nRyan Gosling | Barbie', 'Cillian Murphy | Oppenheimer\nMargot Robbie | Barbie'], 'Dos películas de 2023: Oppenheimer (Cillian Murphy) y Barbie (Margot Robbie y Ryan Gosling). `reparto` conecta actores con películas.'),
      tf('En una cadena de `JOIN`, el orden en que escribes las tablas cambia siempre el resultado.', false, 'Con `INNER JOIN` el orden de las tablas no cambia el resultado (aunque sí puede cambiar el orden de las filas y la velocidad). Lo importante es que cada `ON` use las claves correctas.'),
      sqlCode('Muestra el nombre de cada producto y cuántas unidades se han vendido en total de él (`producto` y `unidades`), sumando `cantidad` de `detalle_pedido`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT pr.nombre AS producto, SUM(d.cantidad) AS unidades FROM productos pr JOIN detalle_pedido d ON d.producto_id = pr.id GROUP BY pr.id, pr.nombre;',
        hint: 'JOIN productos con detalle_pedido y GROUP BY producto',
        why: 'Se unen productos y líneas de pedido, y se suma la cantidad por producto.',
      }),
      sqlPractice({
        goal: 'Quién compró qué',
        prompt: 'Atención al cliente necesita un listado de compras.\n\n**Muestra `cliente` (nombre), `producto` (nombre) y `cantidad` de los pedidos con id del 1 al 4, ordenado por id de pedido y luego por producto.** (Cuatro tablas: pedidos, clientes, detalle_pedido y productos.)',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['JOIN'] }),
        solution: 'SELECT c.nombre AS cliente, pr.nombre AS producto, d.cantidad FROM pedidos p JOIN clientes c ON c.id = p.cliente_id JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.id <= 4 ORDER BY p.id, pr.nombre;',
        hints: ['Cadena: pedidos → clientes y pedidos → detalle_pedido → productos.', 'Filtra con `WHERE p.id <= 4`.'],
        explain: 'Tres `JOIN` encadenados llevan de un pedido a su cliente y a cada producto que contiene.',
        commands: ['JOIN de varias tablas', 'INNER JOIN'],
      }),
      sqlPractice({
        goal: 'Importe de cada pedido',
        prompt: 'Contabilidad necesita el importe de cada pedido que **no esté cancelado**.\n\n**Muestra `id` del pedido y su `total` (suma de `cantidad × precio`, redondeada a 2 decimales), de mayor a menor importe, solo los 3 primeros.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT p.id, ROUND(SUM(d.cantidad * pr.precio), 2) AS total FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado' GROUP BY p.id ORDER BY total DESC LIMIT 3;",
        hints: ['Une pedidos, detalle_pedido y productos.', '`SUM(d.cantidad * pr.precio)` calcula el importe de cada pedido.'],
        explain: 'Unir para tener cantidad y precio en la misma fila, multiplicar y sumar por grupo: la fórmula de «el importe total de cada factura».',
        commands: ['JOIN de varias tablas', 'SUM'],
      }),
      sqlPractice({
        goal: 'Actores más activos',
        prompt: 'En el cine quieren saber qué actores han trabajado en más películas.\n\n**Muestra `nombre` del actor y `peliculas` (cuántas), de más a menos y luego por nombre, solo los 4 primeros.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT a.nombre, COUNT(*) AS peliculas FROM reparto r JOIN actores a ON a.id = r.actor_id GROUP BY a.id, a.nombre ORDER BY peliculas DESC, a.nombre LIMIT 4;',
        hints: ['Une `reparto` con `actores`.', 'Cuenta las filas de `reparto` por actor.'],
        explain: 'La tabla intermedia `reparto` tiene una fila por cada «actor en película»; contarlas por actor da su número de películas.',
        commands: ['JOIN de varias tablas', 'GROUP BY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s5-5', { title: 'Auto-JOIN, CROSS JOIN y trampas', summary: 'Una tabla consigo misma, combinaciones y filas duplicadas', emoji: '🪞', commands: ['Auto-JOIN', 'CROSS JOIN', 'USING'], minutes: 11 }, [
      learn(
        'Una tabla unida consigo misma',
        `
En la tabla \`empleados\`, cada uno tiene un \`jefe_id\` que apunta a **otro empleado** de la **misma tabla**. Para ver «empleado y su jefe» hay que unir la tabla consigo misma. Es un **auto-JOIN** y obliga a usar **alias distintos** para saber qué «copia» es cuál:

\`\`\`
SELECT e.nombre AS empleado, j.nombre AS jefe
FROM empleados e
LEFT JOIN empleados j ON j.id = e.jefe_id;
\`\`\`

Piensa en dos copias de la tabla: \`e\` (los empleados) y \`j\` (los jefes). Se usa \`LEFT JOIN\` para que la directora general, que **no tiene jefe**, no desaparezca.
`,
        '🪞',
      ),
      sqlDemo('Jerarquía de la empresa', 'empresa', [
        ['SELECT e.nombre AS empleado, j.nombre AS jefe FROM empleados e LEFT JOIN empleados j ON j.id = e.jefe_id ORDER BY e.id;', 'Cada empleado con su jefe (la directora general no tiene)'],
        ['SELECT j.nombre AS jefe, COUNT(*) AS equipo FROM empleados e JOIN empleados j ON j.id = e.jefe_id GROUP BY j.id, j.nombre ORDER BY equipo DESC, jefe;', 'Cuántas personas dependen directamente de cada jefe'],
      ]),
      learn(
        'USING y CROSS JOIN',
        `
- Si la columna de unión **se llama igual** en las dos tablas, puedes escribir \`USING (columna)\` en lugar de \`ON a.x = b.x\`. Además, esa columna aparece una sola vez en el resultado.
- \`CROSS JOIN\` es el producto cartesiano **a propósito**: cada fila con cada fila, **sin condición**. Sirve para generar combinaciones (cada talla con cada color, cada día con cada tienda…).

\`\`\`
SELECT d.nombre, p.nombre FROM departamentos d CROSS JOIN proyectos p;
\`\`\`
`,
        '🧩',
      ),
      sqlDemo('USING y CROSS JOIN', { db: 'vacia', script: "CREATE TABLE autores (autor_id INTEGER PRIMARY KEY, nombre TEXT); CREATE TABLE libros (libro_id INTEGER PRIMARY KEY, titulo TEXT, autor_id INTEGER); INSERT INTO autores VALUES (1, 'Borges'), (2, 'Allende'); INSERT INTO libros VALUES (1, 'Ficciones', 1), (2, 'El Aleph', 1), (3, 'Paula', 2);" }, [
        ['SELECT titulo, nombre FROM libros JOIN autores USING (autor_id);', 'Las dos tablas tienen autor_id: USING lo resume'],
        ["SELECT a.nombre, t.talla FROM autores a CROSS JOIN (VALUES ('S'), ('M'), ('L')) AS t(talla);", 'CROSS JOIN: cada autor con cada talla. 2 × 3 = 6 combinaciones'],
      ]),
      learn(
        'La trampa de las filas duplicadas',
        `
Un \`JOIN\` **multiplica filas** cuando una fila de la izquierda tiene **varias** parejas. Si después sumas una columna de la tabla «de un solo lado», **la cuentas varias veces**.

Ejemplo: sumar los sueldos de un departamento y unirlo con \`asignaciones\` (cada empleado puede estar en varios proyectos): el sueldo de cada empleado aparece **una vez por proyecto**, así que la suma sale inflada.

La regla de oro: **antes de sumar, pregúntate cuántas filas hay por cada elemento que sumas**. Las soluciones: agregar **antes** de unir (subconsulta), o usar \`COUNT(DISTINCT …)\` cuando solo cuentas.
`,
        '⚠️',
      ),
      sqlDemo('Cuando el JOIN infla la suma', 'empresa', [
        ['SELECT d.nombre, SUM(e.salario) AS masa FROM departamentos d JOIN empleados e ON e.departamento_id = d.id GROUP BY d.id, d.nombre ORDER BY d.nombre;', 'Masa salarial correcta: cada empleado aparece una vez'],
        ['SELECT d.nombre, SUM(e.salario) AS masa FROM departamentos d JOIN empleados e ON e.departamento_id = d.id JOIN asignaciones a ON a.empleado_id = e.id GROUP BY d.id, d.nombre ORDER BY d.nombre;', 'Al unir con asignaciones, cada sueldo se repite por proyecto: ¡Tecnología sale con 48100 en lugar de 22100!'],
      ]),
      sqlOut('Predice el jefe de cada uno', 'empresa', 'SELECT e.nombre, j.nombre FROM empleados e JOIN empleados j ON j.id = e.jefe_id WHERE e.id IN (1, 5, 12) ORDER BY e.id;', ['Carolina Vega | NULL\nDaniela Pons | Cristian Lara\nKevin Soler | Julia Navas', 'Daniela Pons | Andrés Molina\nKevin Soler | Julia Navas', 'Daniela Pons | Cristian Lara\nKevin Soler | Carolina Vega'], 'Carolina (id 1) no tiene jefe, así que con `INNER JOIN` no encuentra pareja y desaparece. Daniela depende de Cristian y Kevin de Julia.'),
      mc('Un `JOIN` hace que cada sueldo de la tabla empleados se repita 3 veces. Si lo sumas con `SUM(salario)`, ¿qué sale?', ['La suma correcta', 'Tres veces el total real', 'Un error', 'NULL'], 1, 'Cada fila repetida entra en la suma: el total se infla (aquí ×3). Es el error más típico de los `JOIN` con agregados.'),
      tf('`CROSS JOIN` necesita una cláusula `ON`.', false, '`CROSS JOIN` combina todas las filas con todas, sin condición.'),
      sqlCode('Muestra el nombre de cada empleado y el de su jefe (`empleado`, `jefe`); la directora general también debe aparecer.', {
        setup: 'empresa',
        check: same({ names: true }),
        solution: 'SELECT e.nombre AS empleado, j.nombre AS jefe FROM empleados e LEFT JOIN empleados j ON j.id = e.jefe_id;',
        hint: 'LEFT JOIN de empleados consigo misma',
        why: 'El `LEFT JOIN` conserva a Carolina, que no tiene jefe (queda NULL).',
      }),
      sqlPractice({
        goal: 'Organigrama de un vistazo',
        prompt: 'La directora de RR. HH. quiere un listado de **empleados con el nombre de su jefe y el cargo de su jefe**.\n\n**Muestra `empleado`, `jefe` y `cargo_jefe`, ordenados por `empleado`, incluyendo a quien no tiene jefe.**',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT e.nombre AS empleado, j.nombre AS jefe, j.cargo AS cargo_jefe FROM empleados e LEFT JOIN empleados j ON j.id = e.jefe_id ORDER BY e.nombre;',
        hints: ['Dos alias distintos para la misma tabla: `e` y `j`.', '`LEFT JOIN` para incluir a la directora general.'],
        explain: 'Un auto-JOIN con alias claros se lee como «empleado y _su_ jefe». Cada alias es un papel distinto de la misma tabla.',
        commands: ['Auto-JOIN'],
      }),
      sqlPractice({
        goal: 'Equipos más grandes',
        prompt: 'Quieres saber **quién tiene más gente a su cargo directo**.\n\n**Muestra `jefe` (nombre) y `equipo` (cuántos empleados dependen directamente de él), de mayor a menor y luego por nombre.**',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT j.nombre AS jefe, COUNT(*) AS equipo FROM empleados e JOIN empleados j ON j.id = e.jefe_id GROUP BY j.id, j.nombre ORDER BY equipo DESC, jefe;',
        hints: ['Cada empleado aporta una fila a su jefe.', 'Agrupa por el jefe: `GROUP BY j.id, j.nombre`.'],
        explain: 'Auto-JOIN + `GROUP BY` + `COUNT`: contar «cuántos hijos tiene cada padre» dentro de una misma tabla.',
        commands: ['Auto-JOIN', 'GROUP BY'],
      }),
      sqlPractice({
        goal: 'Todas las combinaciones',
        prompt: 'Para una hoja de planificación necesitas **cada departamento combinado con cada proyecto**.\n\n**Muestra `departamento` y `proyecto` (los nombres), ordenados por departamento y luego por proyecto.** Usa `CROSS JOIN`.',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['CROSS JOIN'] }),
        solution: 'SELECT d.nombre AS departamento, p.nombre AS proyecto FROM departamentos d CROSS JOIN proyectos p ORDER BY d.nombre, p.nombre;',
        hints: ['`CROSS JOIN` no lleva `ON`.', '5 departamentos × 5 proyectos = 25 filas.'],
        explain: 'Cuando quieres todas las parejas posibles, `CROSS JOIN` es la herramienta. Se usa mucho para generar calendarios o rejillas.',
        commands: ['CROSS JOIN'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: los mejores clientes',
    prompt:
      'La directora de TiendaTech quiere premiar a sus mejores clientes. Para cada cliente, sin contar los pedidos **cancelados**, necesita:\n\n- `nombre`: el nombre del cliente.\n- `pedidos`: cuántos pedidos distintos ha hecho.\n- `gastado`: el dinero total (cantidad × precio de todos sus productos), redondeado a 2 decimales.\n\n**Muestra solo los 5 que más han gastado, de mayor a menor gasto.** (Necesitas unir cuatro tablas.)',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: "SELECT c.nombre, COUNT(DISTINCT p.id) AS pedidos, ROUND(SUM(d.cantidad * pr.precio), 2) AS gastado FROM clientes c JOIN pedidos p ON p.cliente_id = c.id JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado' GROUP BY c.id, c.nombre ORDER BY gastado DESC LIMIT 5;",
    hints: ['Cadena: clientes → pedidos → detalle_pedido → productos.', 'Para contar pedidos sin repetir (cada pedido tiene varias líneas) usa `COUNT(DISTINCT p.id)`.'],
    explain: 'Cuatro tablas, un filtro, dos agregaciones, un orden y un límite: ya sabes unir datos como un profesional. Fíjate en `COUNT(DISTINCT p.id)`: cada pedido tiene varias líneas y, sin `DISTINCT`, se contaría varias veces (la trampa de las filas duplicadas). ¡Zona completada!',
    commands: ['INNER JOIN', 'JOIN de varias tablas', 'GROUP BY'],
  },
});
