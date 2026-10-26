import { illus, learn, lesson, match, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlErr, sqlPerf, sqlPractice, sqlWorld, state } from '../sqlbuild';

/** Ventas con los índices más habituales ya creados (para ver qué consultas los aprovechan y cuáles no). */
const INDEXADA = {
  db: 'ventas_grande',
  script: 'CREATE INDEX idx_ventas_fecha ON ventas (fecha); CREATE INDEX idx_ventas_cliente ON ventas (cliente_id); CREATE INDEX idx_ventas_producto ON ventas (producto);',
};

export const s12 = sqlWorld({
  id: 's12',
  index: 12,
  title: 'Rendimiento e índices',
  subtitle: 'Que tus consultas vuelen con millones de filas',
  emoji: '⚡',
  color: '#FACC15',
  level: 'avanzado',
  intro:
    'Con 20 filas todo va rápido. Con 20 millones, una consulta mal escrita puede tardar minutos y tumbar una aplicación entera. En esta zona aprenderás **cómo busca realmente una base de datos**, a crear **índices** (el atajo que convierte un barrido de 6.000 filas en leer 12), a leer el **plan de ejecución** con `EXPLAIN` y a reconocer las consultas que sabotean sus propios índices. Aquí verás en cada consulta cuántas filas lee de verdad: ¡mide, optimiza y comprueba la mejora!',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s12-1', { title: 'Cómo busca la base de datos', summary: 'Escaneo completo frente a búsqueda con índice', emoji: '🔍', commands: ['EXPLAIN'], minutes: 10 }, [
      learn(
        'Buscar sin un índice',
        `
Imagina un libro de **6.000 páginas sin índice final** y te piden encontrar todas las veces que sale la palabra «Alicia». No hay otra: tendrías que **leer página por página**, de la primera a la última.

Eso es lo que hace una base de datos cuando filtras por una columna que **no está indexada**: un **escaneo completo** (_full scan_). Lee **todas las filas** de la tabla, una a una, y se queda con las que cumplen el \`WHERE\`.

\`\`\`
SELECT * FROM ventas WHERE cliente_id = 42;
\`\`\`

Aunque el cliente 42 solo tiene 12 ventas, el motor tiene que mirar las 6.000 para estar seguro de no dejarse ninguna. Con una tabla pequeña no se nota, pero el tiempo crece **en proporción al tamaño de la tabla**: el doble de filas, el doble de tiempo.
`,
        '📖',
      ),
      illus('sql-index-tree', 'Dos formas de buscar', 'Pulsa «Buscar» y compara cuántas filas visita cada estrategia.'),
      learn(
        'El índice: un atajo ordenado',
        `
Un **índice** es una estructura auxiliar que guarda los valores de una columna **ordenados**, cada uno con un puntero a su fila (como el índice alfabético de un libro). Como está ordenado, la base de datos no lo recorre entero: lo usa como un **árbol de búsqueda** (un B-tree) y salta directamente al valor, igual que abres un diccionario por la mitad y vas descartando mitades.

- Buscar en 6.000 filas con índice: **un puñado de saltos**, no 6.000 lecturas.
- Buscar en 6.000.000 de filas: solo unos pocos saltos más. El coste crece **muy despacio** (logarítmico).
- La **clave primaria** (\`PRIMARY KEY\`) y las columnas \`UNIQUE\` ya tienen índice automático. Por eso buscar por \`id\` siempre es rápido.

> TIP: En esta zona, cada resultado muestra abajo **cuántas filas ha leído** el motor de las tablas. Es la mejor forma de ver el efecto de un índice.
`,
        '🌳',
      ),
      sqlPerf(
        'Mismas ventas, dos búsquedas',
        'ventas_grande',
        [
          ['SELECT * FROM ventas WHERE id = 4321;', 'Por clave primaria: lee UNA fila (mira «leídas de las tablas», abajo)'],
          ['SELECT * FROM ventas WHERE cliente_id = 42;', 'Por una columna sin índice: devuelve 12 filas pero ha tenido que leer las 6.000'],
          ['EXPLAIN SELECT * FROM ventas WHERE cliente_id = 42;', 'EXPLAIN enseña el plan sin ejecutar: «Escaneo completo»'],
          ['EXPLAIN SELECT * FROM ventas WHERE id = 4321;', 'Y con la clave primaria: «Búsqueda en el índice ventas_pkey»'],
        ],
        'La tabla `ventas` tiene **6.000 filas**. Compara cuántas lee el motor en cada búsqueda.',
      ),
      learn(
        'Escanear no siempre es malo',
        `
Un escaneo completo **no es un error por sí mismo**:

- En tablas pequeñas (decenas de filas), leerlas todas es más rápido que usar un índice.
- Si la consulta necesita **la mayoría de las filas** (un \`SUM\` de toda la tabla, \`COUNT(*)\`), no hay atajo posible: hay que leerlas.
- El problema aparece cuando el filtro es **muy selectivo** (devuelve pocas filas de muchas) y aun así se barre la tabla entera.

La pregunta clave de todo este bloque: **¿cuántas filas lee mi consulta comparadas con las que devuelve?** Si lees 6.000 para devolver 12, algo se puede mejorar.
`,
        '⚖️',
      ),
      mc('La tabla `ventas` tiene 6.000 filas y un índice solo en `id`. ¿Cuántas filas lee `SELECT * FROM ventas WHERE id = 100`?', ['1', '100', '3.000', '6.000'], 0, 'Con el índice de la clave primaria salta directamente a esa fila: lee 1. Sin índice habría leído las 6.000.'),
      mc('¿Cuántas filas lee `SELECT * FROM ventas WHERE cliente_id = 42` si `cliente_id` no tiene índice?', ['12 (las del cliente)', '6.000 (toda la tabla)', '42', '500'], 1, 'Sin índice no hay forma de saber dónde están las del cliente 42: se recorren todas las filas y se descartan las que no cumplen.'),
      tf('Un escaneo completo es siempre una señal de que la consulta está mal escrita.', false, 'En tablas pequeñas o cuando se necesitan casi todas las filas, escanear es lo más rápido. Es un problema solo cuando se barre una tabla grande para devolver unas pocas filas.'),
      sqlCode('Muestra el plan de ejecución (sin ejecutar la consulta) de buscar la venta con `id` 250.', {
        setup: 'ventas_grande',
        check: same({ uses: ['EXPLAIN'] }),
        solution: 'EXPLAIN SELECT * FROM ventas WHERE id = 250;',
        hint: 'Escribe EXPLAIN delante de la consulta',
        why: '`EXPLAIN` + consulta devuelve el plan en lugar de las filas: aquí verás la «Búsqueda en el índice ventas_pkey».',
      }),
      sqlPractice({
        goal: 'Una sola fila',
        prompt: 'Busca el `importe` de la venta número **4500**.\n\n**Muestra `importe`.** Tu consulta no puede leer más de **1 fila** de la tabla (compruébalo abajo en «leídas de las tablas»).',
        setup: 'ventas_grande',
        check: same({ names: true, maxRead: 1 }),
        solution: 'SELECT importe FROM ventas WHERE id = 4500;',
        hints: ['Filtra por la clave primaria: `WHERE id = …`.', 'No hace falta ningún `LIMIT`: el índice ya va directo a la fila.'],
        explain: 'Buscar por la clave primaria usa su índice automático y lee exactamente una fila, tenga la tabla 6.000 filas o 6.000 millones.',
        commands: ['EXPLAIN'],
      }),
      sqlPractice({
        goal: 'Un bloque de ventas',
        prompt: 'Cuenta cuántas ventas tienen un `id` **entre 1000 y 1099** (ambos incluidos).\n\n**Muestra `total`.** Sin leer más de **100 filas**: el índice de la clave primaria también sirve para rangos.',
        setup: 'ventas_grande',
        check: same({ names: true, maxRead: 100 }),
        solution: 'SELECT COUNT(*) AS total FROM ventas WHERE id BETWEEN 1000 AND 1099;',
        hints: ['`BETWEEN` incluye los dos extremos.', 'Un índice ordenado permite saltar al principio del rango y leer solo hasta el final.'],
        explain: 'Como el índice está ordenado, un rango (`BETWEEN`, `>`, `<`) también es eficiente: salta al primer valor y lee seguidos solo los del intervalo.',
        commands: ['EXPLAIN'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s12-2', { title: 'Crear índices', summary: 'CREATE INDEX, DROP INDEX y el orden de las columnas', emoji: '🗂️', commands: ['CREATE INDEX'], minutes: 12 }, [
      learn(
        'CREATE INDEX',
        `
Crear un índice es una sola sentencia:

\`\`\`
CREATE INDEX idx_ventas_cliente
    ON ventas (cliente_id);
\`\`\`

Pones **un nombre** (la costumbre es \`idx_tabla_columna\`), la **tabla** y la **columna** (o columnas) que quieres acelerar. Para quitarlo: \`DROP INDEX idx_ventas_cliente;\`.

Otras variantes:

- \`CREATE UNIQUE INDEX …\` — además impide valores repetidos (como un \`UNIQUE\`).
- \`CREATE INDEX IF NOT EXISTS …\` — no falla si ya existe.
- \`CREATE INDEX … ON t (a, b)\` — índice **compuesto** sobre varias columnas.

Un índice **no cambia nunca el resultado** de una consulta, solo la velocidad con la que se calcula.
`,
        '🗂️',
      ),
      sqlPerf(
        'Antes y después de un índice',
        'ventas_grande',
        [
          ['SELECT COUNT(*) FROM ventas WHERE cliente_id = 42;', 'Sin índice: 6.000 filas leídas para contar 12'],
          ['CREATE INDEX idx_ventas_cliente ON ventas (cliente_id);', 'Creamos el índice sobre cliente_id'],
          ['SELECT COUNT(*) FROM ventas WHERE cliente_id = 42;', 'La misma consulta, el mismo resultado: ahora lee solo 12 filas'],
          ['EXPLAIN SELECT * FROM ventas WHERE cliente_id = 42;', 'El plan ya no dice «Escaneo completo»'],
          ['DROP INDEX idx_ventas_cliente;', 'Lo borramos: las tablas no cambian, solo el atajo'],
          ['SELECT COUNT(*) FROM ventas WHERE cliente_id = 42;', 'Y vuelve a leer 6.000'],
        ],
      ),
      learn(
        'No es gratis: el coste de un índice',
        `
Si los índices aceleran las lecturas, ¿por qué no crear uno en cada columna? Porque **cada índice hay que mantenerlo**:

- Cada \`INSERT\`, \`UPDATE\` o \`DELETE\` tiene que actualizar **también todos los índices** de la tabla. Muchos índices = escrituras más lentas.
- Ocupan **espacio** (a veces tanto como la propia tabla).

**¿Qué columnas merece la pena indexar?**

1. Las que usas **a menudo en \`WHERE\`** con filtros muy selectivos (\`email\`, \`cliente_id\`, \`fecha\`).
2. Las de **\`JOIN\`**: sobre todo las **claves foráneas** (\`pedidos.cliente_id\`). La clave primaria ya tiene índice; la foránea **no** lo tiene por defecto.
3. Las que se usan para **\`ORDER BY\`** o rangos de fechas en tablas grandes.

**Y las que no:** columnas con pocos valores distintos (un \`activo\` Sí/No parte la tabla solo en dos mitades), tablas diminutas y tablas con muchísimas más escrituras que lecturas.
`,
        '⚖️',
      ),
      sqlPerf(
        'Rangos y varias columnas',
        'ventas_grande',
        [
          ['CREATE INDEX idx_ventas_fecha ON ventas (fecha);', 'Un índice sobre la fecha'],
          sqlErr('CREATE INDEX idx_ventas_fecha ON ventas (fecha);', 'Los nombres de índice no se pueden repetir'),
          ["SELECT COUNT(*) FROM ventas WHERE fecha BETWEEN '2024-01-01' AND '2024-01-31';", 'Un rango de fechas: solo se leen las 526 ventas de enero, no las 6.000'],
          ['CREATE INDEX idx_ventas_producto_fecha ON ventas (producto, fecha);', 'Índice compuesto: primero por producto y, dentro de cada producto, por fecha'],
          ["SELECT COUNT(*) FROM ventas WHERE producto = 'raton' AND fecha >= '2024-12-01';", 'Igualdad en la primera columna y rango en la segunda: lee solo 96 filas'],
          sqlErr('CREATE UNIQUE INDEX idx_unico_cliente ON ventas (cliente_id);', 'Un índice UNIQUE falla si ya hay valores repetidos'),
        ],
      ),
      learn(
        'Índices compuestos: el orden importa',
        `
Un índice sobre \`(producto, fecha)\` funciona como una **agenda telefónica ordenada por apellido y, dentro de cada apellido, por nombre**. Sirve para:

- Buscar por **apellido** ✔️
- Buscar por **apellido y nombre** ✔️
- Buscar solo por **nombre** ✖️ (habría que repasar toda la agenda)

Es la **regla del prefijo por la izquierda**: el índice solo ayuda si tu \`WHERE\` usa las **primeras columnas** del índice, empezando por la primera. Por eso:

- \`WHERE producto = 'raton'\` → usa el índice.
- \`WHERE producto = 'raton' AND fecha >= '2024-12-01'\` → lo usa entero.
- \`WHERE fecha >= '2024-12-01'\` → **no** lo usa (falta la primera columna).

> TIP: Regla práctica para ordenar columnas: primero las que comparas con **igualdad** (\`=\`) y después la de **rango** (\`>\`, \`BETWEEN\`).
`,
        '📞',
      ),
      mc('Tienes un índice sobre `(cliente_id, fecha)`. ¿Qué consulta lo aprovecha?', ['`WHERE fecha >= \'2024-06-01\'`', '`WHERE cliente_id = 10 AND fecha >= \'2024-06-01\'`', '`WHERE fecha = \'2024-06-01\'`', 'Ninguna de las anteriores'], 1, 'Hay que usar la primera columna del índice (`cliente_id`). Las que filtran solo por `fecha` se saltan el prefijo y escanean.'),
      tf('Crear un índice puede cambiar las filas que devuelve una consulta.', false, 'Un índice solo es un atajo: el resultado es siempre el mismo con o sin índice. Lo único que cambia es cuántas filas hay que leer.'),
      order('Ordena la sentencia que indexa los pedidos por cliente', ['CREATE', 'INDEX', 'idx_pedidos_cliente', 'ON', 'pedidos', '(cliente_id);'], 'CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);', 'Nombre del índice, `ON` la tabla y, entre paréntesis, la columna.'),
      sqlCode('Crea un índice sobre la columna `producto` de `ventas` (el nombre lo eliges tú).', {
        setup: 'ventas_grande',
        check: state(['ventas'], { indexes: true }),
        solution: 'CREATE INDEX idx_ventas_producto ON ventas (producto);',
        hint: 'CREATE INDEX nombre ON ventas (producto);',
        why: 'El nombre da igual; lo que cuenta es la tabla y la columna que se indexan.',
      }),
      sqlPractice({
        goal: 'Atender al cliente 77',
        prompt: 'El servicio de atención consulta las ventas **por cliente** todo el día. Crea el índice adecuado sobre `ventas` y después cuenta cuántas ventas tiene el cliente **77**.\n\n**Muestra `total`.** La consulta final no puede leer más de **12 filas**.',
        setup: 'ventas_grande',
        check: same({ names: true, maxRead: 12 }),
        solution: 'CREATE INDEX idx_ventas_cliente ON ventas (cliente_id);\nSELECT COUNT(*) AS total FROM ventas WHERE cliente_id = 77;',
        hints: ['Primero `CREATE INDEX … ON ventas (cliente_id);`', 'Después, un `SELECT COUNT(*) … WHERE cliente_id = 77;` en la misma ejecución (separa con `;`).'],
        explain: 'Un índice sobre `cliente_id` convierte el barrido de 6.000 filas en una búsqueda directa de las 12 del cliente. La consulta no cambió: solo se le dio un atajo.',
        commands: ['CREATE INDEX'],
      }),
      sqlPractice({
        goal: 'Ventas de marzo',
        prompt: 'Contabilidad pide cada mes las ventas de marzo de 2024. Crea un índice sobre `fecha` y cuenta las ventas con `fecha >= \'2024-03-01\'` y `fecha < \'2024-04-01\'`.\n\n**Muestra `total`.** Máximo **600 filas leídas**.',
        setup: 'ventas_grande',
        check: same({ names: true, maxRead: 600 }),
        solution: "CREATE INDEX idx_ventas_fecha ON ventas (fecha);\nSELECT COUNT(*) AS total FROM ventas WHERE fecha >= '2024-03-01' AND fecha < '2024-04-01';",
        hints: ['El índice va sobre `fecha`.', 'Un rango con `>=` y `<` aprovecha el índice ordenado.'],
        explain: 'El índice ordenado permite saltar a «1 de marzo» y leer seguidas solo las ventas del mes (527), ignorando las otras 5.473.',
        commands: ['CREATE INDEX'],
      }),
      sqlPractice({
        goal: 'Un email, un cliente',
        prompt: 'El soporte busca clientes por **`nombre`** todo el día, y no debe haber dos clientes con el mismo nombre.\n\n**Con una sola sentencia, acelera esas búsquedas e impide nombres repetidos: crea un índice único (`UNIQUE`) sobre `clientes (nombre)`.**',
        setup: 'tienda',
        check: state(['clientes'], { indexes: true }),
        solution: 'CREATE UNIQUE INDEX idx_clientes_nombre ON clientes (nombre);',
        hints: ['`CREATE UNIQUE INDEX nombre ON tabla (columna);`'],
        explain: 'Un índice `UNIQUE` hace dos trabajos: acelera las búsquedas por esa columna y rechaza cualquier valor repetido.',
        commands: ['CREATE INDEX'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s12-3', { title: 'EXPLAIN: leer el plan', summary: 'Ver cómo ejecuta la base de datos cada consulta', emoji: '🩺', commands: ['EXPLAIN'], minutes: 10 }, [
      learn(
        'El plan de ejecución',
        `
Cuando mandas una consulta, la base de datos no la ejecuta «tal cual»: primero **decide un plan** (qué tabla leer primero, si usa un índice, cómo une las tablas…). Con \`EXPLAIN\` delante de la consulta **ves ese plan** sin ejecutarla:

\`\`\`
EXPLAIN SELECT * FROM pedidos WHERE cliente_id = 3;
\`\`\`

Con \`EXPLAIN ANALYZE\` la consulta **sí se ejecuta** y el plan incluye datos reales: cuántas filas devolvió y **cuántas leyó de las tablas**.

**Cómo leerlo:** el plan es un árbol. Los nodos que están **más a la derecha (más sangrados)** se ejecutan primero y pasan sus filas al nodo de encima. Lo que más interesa:

- 🐢 **Escaneo completo de «tabla»** — lee todas las filas.
- ⚡ **Búsqueda en el índice «x»** — usa un índice (igualdad o \`IN\`).
- ⚡ **Búsqueda por rango en el índice «x»** — usa un índice para \`>\`, \`<\` o \`BETWEEN\`.
- **Filtrar** — aplica el \`WHERE\` a las filas que le llegan.
- **Unión interna / izquierda…** — un \`JOIN\` (dice con qué método se une).
- **Agrupar, Ordenar, Límite, Agregar** — \`GROUP BY\`, \`ORDER BY\`, \`LIMIT\` y funciones agregadas.
`,
        '🩺',
      ),
      sqlPerf(
        'Tres planes',
        'tienda',
        [
          ['EXPLAIN SELECT * FROM clientes WHERE id = 3;', 'Búsqueda por clave primaria: un índice, sin escaneo'],
          ['EXPLAIN SELECT c.nombre, COUNT(*) AS pedidos FROM clientes c JOIN pedidos p ON p.cliente_id = c.id GROUP BY c.nombre ORDER BY pedidos DESC LIMIT 3;', 'Un plan con varios nodos: de abajo hacia arriba se lee clientes y pedidos, se unen, se agrupan, se ordenan y se aplica el LIMIT'],
          ['EXPLAIN ANALYZE SELECT * FROM pedidos WHERE cliente_id = 3;', 'ANALYZE ejecuta de verdad: devuelve 3 filas pero ha leído las 24 de la tabla'],
          ['CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);', 'Añadimos el índice…'],
          ['EXPLAIN ANALYZE SELECT * FROM pedidos WHERE cliente_id = 3;', '…y ahora lee solo 3'],
        ],
      ),
      learn(
        'Qué mirar primero',
        `
Cuando una consulta va lenta, no adivines: **ejecuta \`EXPLAIN ANALYZE\`** y busca:

1. El nodo que **lee muchas más filas** de las que devuelve.
2. Un **«Escaneo completo»** sobre una tabla grande.
3. Qué índices se usan (la línea final lo resume) y **cuáles esperabas y no aparecen**.

El plan responde con precisión a la pregunta «¿por qué tarda tanto?». Es la herramienta número uno de cualquiera que optimiza bases de datos.

> OJO: Un plan de una tabla de 24 filas no se parece al de una de 24 millones. Los motores reales eligen el plan según estadísticas del tamaño de las tablas; si pruebas con pocos datos, un escaneo puede ser la decisión correcta.
`,
        '🔎',
      ),
      match(
        'Une cada línea del plan con su significado',
        [
          ['Escaneo completo de «ventas»', 'Lee todas las filas de la tabla'],
          ['Búsqueda en el índice «ventas_pkey»', 'Va directo a las filas con un índice'],
          ['Búsqueda por rango en el índice', 'Usa un índice para >, < o BETWEEN'],
          ['Filtrar: cliente_id = 42', 'Aplica la condición del WHERE'],
        ],
        'Aprender a traducir estas líneas es aprender a leer cualquier plan.',
      ),
      mc('El plan dice «Escaneo completo de «pedidos» (24 filas)» y la consulta devolvió 3. ¿Qué significa?', ['Se usó un índice', 'Se leyeron las 24 filas para devolver solo 3', 'La tabla tiene 3 filas', 'La consulta falló'], 1, 'Un escaneo completo lee toda la tabla; el `WHERE` descarta después las que no cumplen.'),
      tf('`EXPLAIN` (sin `ANALYZE`) ejecuta la consulta y devuelve sus filas.', false, '`EXPLAIN` solo muestra el plan, sin ejecutar nada. `EXPLAIN ANALYZE` sí ejecuta la consulta (cuidado con `UPDATE`/`DELETE`: ¡se aplicarían!) y mide filas reales.'),
      mc('¿Qué orden sigue el plan para ejecutarse?', ['De arriba a abajo siempre', 'De los nodos más sangrados (hijos) hacia el nodo raíz', 'Orden alfabético', 'Aleatorio'], 1, 'Los nodos hijo (más a la derecha) producen filas que consume el nodo padre. El de más a la izquierda es el último paso.'),
      sqlCode('Muestra el plan **con datos reales** (`EXPLAIN ANALYZE`) de contar los pedidos con `cliente_id = 3`.', {
        setup: 'tienda',
        check: same({ uses: ['EXPLAIN', 'ANALYZE'] }),
        solution: 'EXPLAIN ANALYZE SELECT COUNT(*) FROM pedidos WHERE cliente_id = 3;',
        hint: 'EXPLAIN ANALYZE SELECT COUNT(*) …',
        why: 'Con ANALYZE ves el plan y también las filas leídas realmente.',
      }),
      sqlPractice({
        goal: 'El plan de un JOIN',
        prompt: 'Muestra el plan de ejecución (sin ejecutar) de esta consulta, que lista cada pedido con el nombre de su cliente:\n\n`SELECT c.nombre, p.id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id`',
        setup: 'tienda',
        check: same({ uses: ['EXPLAIN'] }),
        solution: 'EXPLAIN SELECT c.nombre, p.id FROM clientes c JOIN pedidos p ON p.cliente_id = c.id;',
        hints: ['Escribe `EXPLAIN` seguido de la consulta completa.'],
        explain: 'En el plan se ve la «Unión interna» con sus dos tablas, y que se unen con una tabla hash por igualdad: un método eficiente que lee cada tabla una sola vez.',
        commands: ['EXPLAIN'],
      }),
      sqlPractice({
        goal: 'Los pedidos pendientes',
        prompt: 'El almacén consulta `SELECT * FROM pedidos WHERE estado = \'pendiente\'` constantemente. Crea el índice adecuado sobre `pedidos` y ejecuta la consulta.\n\n**Muestra todas las columnas.** Lectura máxima: **5 filas** (las pendientes).',
        setup: 'tienda',
        check: same({ maxRead: 5 }),
        solution: "CREATE INDEX idx_pedidos_estado ON pedidos (estado);\nSELECT * FROM pedidos WHERE estado = 'pendiente';",
        hints: ['El índice va sobre `estado`.', 'Después ejecuta el `SELECT … WHERE estado = \'pendiente\'`.'],
        explain: 'Con el índice, el motor lee solo las 5 filas pendientes de las 24. (En una tabla enorme donde casi todo estuviera pendiente, este índice serviría de poco: ¡la selectividad importa!)',
        commands: ['CREATE INDEX', 'EXPLAIN'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s12-4', { title: 'Cuando el índice no se usa', summary: 'Consultas «sargables» y trampas que lo anulan', emoji: '🚧', commands: ['Consultas sargables'], minutes: 12 }, [
      learn(
        'Tener índice no basta',
        `
Es una sorpresa muy frecuente: creas el índice, ejecutas la consulta… ¡y sigue leyendo toda la tabla! Pasa cuando el \`WHERE\` está escrito de una forma que **impide usar el índice**.

La palabra mágica es **sargable** (_Search ARGument ABLE_): una condición es sargable si el motor puede usar un índice para resolverla. La regla de oro:

> **Deja la columna «limpia» a un lado de la comparación.** Si le aplicas una función o una operación (\`UPPER(col)\`, \`col + 1\`, \`strftime(…, col)\`), el índice sobre \`col\` ya no vale: está ordenado por el valor original, no por el resultado de tu función.

| ❌ No sargable | ✅ Sargable |
| --- | --- |
| \`strftime('%Y-%m', fecha) = '2024-03'\` | \`fecha >= '2024-03-01' AND fecha < '2024-04-01'\` |
| \`UPPER(producto) = 'RATON'\` | \`producto = 'raton'\` |
| \`importe * 2 > 300\` | \`importe > 150\` |
| \`WHERE cliente_id = 1 OR producto = 'x'\` | dos consultas con \`UNION ALL\` |
`,
        '🚧',
      ),
      sqlPerf(
        'Con índice… ¡pero escanea!',
        INDEXADA,
        [
          ["SELECT COUNT(*) FROM ventas WHERE strftime('%Y-%m', fecha) = '2024-03';", 'Hay índice sobre fecha, pero la función lo anula: 6.000 filas leídas'],
          ["SELECT COUNT(*) FROM ventas WHERE fecha >= '2024-03-01' AND fecha < '2024-04-01';", 'Mismo resultado con un rango: 527 filas leídas'],
          ["SELECT COUNT(*) FROM ventas WHERE UPPER(producto) = 'RATON';", 'UPPER sobre la columna: otra vez 6.000'],
          ["SELECT COUNT(*) FROM ventas WHERE producto = 'raton';", 'Sin la función: 1.200 (las del ratón)'],
          ['SELECT COUNT(*) FROM ventas WHERE cliente_id = 42 OR producto = \'raton\';', 'Un OR entre dos columnas distintas puede obligar a escanear todo'],
          ["SELECT COUNT(*) FROM (SELECT id FROM ventas WHERE cliente_id = 42 UNION ALL SELECT id FROM ventas WHERE producto = 'raton' AND cliente_id <> 42) AS t;", 'Dos consultas con índice, unidas: 12 + 1.200 filas leídas'],
        ],
        'La base `ventas` ya tiene índices sobre `fecha`, `cliente_id` y `producto`. Mira cuántas filas lee cada versión.',
      ),
      learn(
        'Más trampas, y cómo esquivarlas',
        `
- **Funciones sobre la columna**: reescribe moviendo el trabajo al **otro lado** (al valor constante) o convierte la condición en un **rango**. En los motores que lo permiten (PostgreSQL, por ejemplo) también puedes crear un **índice sobre la expresión** (\`CREATE INDEX … ON t (lower(col))\`); este simulador no los aprovecha, así que aquí se reescribe la consulta.
- **\`OR\` entre columnas distintas**: según el motor se resuelve mal. Una alternativa es repartirlo en dos \`SELECT\` unidos con \`UNION ALL\` (cuidando de no contar dos veces una misma fila).
- **\`<>\`, \`NOT\`**: «todo menos esto» casi siempre devuelve la mayor parte de la tabla y por tanto no se acelera con índices.
- **\`LIKE '%texto'\`** (comodín al principio): no se puede usar un índice ordenado, porque no se sabe por dónde empezar. \`LIKE 'texto%'\` (prefijo) sí puede, según el motor y la configuración.
- **Prefijo por la izquierda** de los índices compuestos (lo viste antes): no te saltes la primera columna.
- **Tipos distintos** (comparar un texto con un número) pueden obligar al motor a convertir cada fila y descartar el índice.
`,
        '🪤',
      ),
      sqlPerf(
        'Prefijo por la izquierda',
        { db: 'ventas_grande', script: 'CREATE INDEX idx_cliente_fecha ON ventas (cliente_id, fecha);' },
        [
          ["SELECT COUNT(*) FROM ventas WHERE fecha >= '2024-06-01';", 'Solo por fecha: el índice (cliente_id, fecha) no sirve y escanea'],
          ["SELECT COUNT(*) FROM ventas WHERE cliente_id = 10 AND fecha >= '2024-06-01';", 'Con cliente_id primero: lee solo 5 filas'],
        ],
      ),
      match(
        'Une cada condición con su versión sargable',
        [
          ["WHERE strftime('%Y', fecha) = '2024'", "WHERE fecha >= '2024-01-01' AND fecha < '2025-01-01'"],
          ["WHERE UPPER(producto) = 'CABLE'", "WHERE producto = 'cable'"],
          ['WHERE importe + 10 > 100', 'WHERE importe > 90'],
          ['WHERE cliente_id = 5 OR cliente_id = 6', 'WHERE cliente_id IN (5, 6)'],
        ],
        'En todos los casos la columna queda sola, sin funciones ni operaciones, y el índice puede usarse.',
      ),
      mc('Hay un índice sobre `fecha`. ¿Cuál de estas condiciones **no** puede usarlo?', ['`fecha = \'2024-06-15\'`', '`fecha BETWEEN \'2024-06-01\' AND \'2024-06-30\'`', '`strftime(\'%m\', fecha) = \'06\'`', '`fecha >= \'2024-06-01\'`'], 2, 'Con la función `strftime` sobre la columna, el motor tiene que calcularla fila a fila: no puede aprovechar el orden del índice.'),
      tf('Si una columna tiene un índice, cualquier consulta que la nombre en el WHERE lo usará.', false, 'Solo si la condición es sargable: con funciones sobre la columna, `LIKE \'%x\'`, `<>` u `OR` entre columnas, el motor puede ignorar el índice.'),
      mc('Con un índice sobre `(cliente_id, fecha)`, ¿qué filtro se queda **sin** el índice?', ['`WHERE cliente_id = 7`', '`WHERE cliente_id = 7 AND fecha > \'2024-05-01\'`', '`WHERE fecha > \'2024-05-01\'`', 'Los tres usan el índice'], 2, 'Falta la primera columna del índice: por el prefijo por la izquierda, no se puede usar.'),
      sqlCode('Reescribe para que use el índice sobre `fecha`: cuenta (`total`) las ventas de **mayo de 2024** sin usar funciones sobre `fecha`.', {
        setup: { db: 'ventas_grande', script: 'CREATE INDEX idx_ventas_fecha ON ventas (fecha);' },
        starter: "SELECT COUNT(*) AS total FROM ventas WHERE strftime('%Y-%m', fecha) = '2024-05';",
        check: same({ names: true, maxRead: 600 }),
        solution: "SELECT COUNT(*) AS total FROM ventas WHERE fecha >= '2024-05-01' AND fecha < '2024-06-01';",
        hint: 'Usa un rango: fecha >= … AND fecha < …',
        why: 'El rango deja la columna «limpia» y el índice ordenado salta directo a mayo.',
      }),
      sqlPractice({
        goal: 'El informe del ratón',
        prompt: 'El informe de ventas de `raton` tarda mucho **aunque existe un índice sobre `producto`**. Revisa el código inicial y arréglalo.\n\n**Muestra `total` (cuántas ventas del ratón hay).** Máximo **1.200 filas leídas** (las del ratón, no las 6.000).',
        setup: { db: 'ventas_grande', script: 'CREATE INDEX idx_ventas_producto ON ventas (producto);' },
        starter: "SELECT COUNT(*) AS total FROM ventas WHERE UPPER(producto) = 'RATON';",
        check: same({ names: true, maxRead: 1200 }),
        solution: "SELECT COUNT(*) AS total FROM ventas WHERE producto = 'raton';",
        hints: ['La función `UPPER` sobre la columna anula el índice.', 'En la tabla los productos están en minúsculas: compara con `\'raton\'`.'],
        explain: 'El índice está ordenado por el valor original de `producto`. Al aplicar `UPPER` el motor no puede usarlo; comparando la columna «limpia» salta directamente a las ventas del ratón.',
        commands: ['Consultas sargables'],
      }),
      sqlPractice({
        goal: 'Septiembre sin funciones',
        prompt: 'Contabilidad calcula las ventas de **septiembre de 2024**. Ya existe un índice sobre `fecha`, pero la consulta inicial lo ignora.\n\n**Muestra `total` y `ventas` (importe total redondeado a 2 decimales y número de ventas).** Máximo **500 filas leídas**.',
        setup: { db: 'ventas_grande', script: 'CREATE INDEX idx_ventas_fecha ON ventas (fecha);' },
        starter: "SELECT ROUND(SUM(importe), 2) AS total, COUNT(*) AS ventas FROM ventas WHERE strftime('%Y-%m', fecha) = '2024-09';",
        check: same({ names: true, maxRead: 500 }),
        solution: "SELECT ROUND(SUM(importe), 2) AS total, COUNT(*) AS ventas FROM ventas WHERE fecha >= '2024-09-01' AND fecha < '2024-10-01';",
        hints: ['Cambia `strftime(…) = \'2024-09\'` por un rango de fechas.', 'Septiembre va del `2024-09-01` (incluido) al `2024-10-01` (excluido).'],
        explain: 'Un mes completo es el rango «desde el día 1 (incluido) hasta el día 1 del mes siguiente (excluido)». Es el patrón estándar para filtrar por mes sin perder el índice.',
        commands: ['Consultas sargables'],
      }),
      sqlPractice({
        goal: 'Dos índices, un OR',
        prompt: 'Soporte quiere el **número de ventas** del cliente **42** _o_ del producto `raton`. Hay índices sobre `cliente_id` y `producto`, pero el `OR` obliga a escanear.\n\n**Muestra `total`.** Reescribe con `UNION ALL` (sin contar dos veces las ventas del cliente 42 que sean de ratón). Máximo **1.300 filas leídas**.',
        setup: { db: 'ventas_grande', script: 'CREATE INDEX idx_ventas_cliente ON ventas (cliente_id); CREATE INDEX idx_ventas_producto ON ventas (producto);' },
        starter: "SELECT COUNT(*) AS total FROM ventas WHERE cliente_id = 42 OR producto = 'raton';",
        check: same({ names: true, maxRead: 1300 }),
        solution: "SELECT COUNT(*) AS total FROM (SELECT id FROM ventas WHERE cliente_id = 42 UNION ALL SELECT id FROM ventas WHERE producto = 'raton' AND cliente_id <> 42) AS t;",
        hints: ['Dos `SELECT id …` unidos con `UNION ALL`, y cuenta fuera.', 'En la segunda parte añade `AND cliente_id <> 42` para no duplicar.'],
        explain: 'Cada mitad usa su propio índice (12 + 1.200 filas) en lugar de escanear 6.000. El `AND cliente_id <> 42` evita contar dos veces las ventas que cumplen ambas condiciones. (Con `UNION` sin `ALL` también se eliminan duplicados, a costa de ordenar.)',
        commands: ['Consultas sargables', 'UNION'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s12-5', { title: 'Optimizar de verdad', summary: 'Medir, localizar, arreglar y comprobar', emoji: '🏁', commands: ['Optimizar consultas'], minutes: 12 }, [
      learn(
        'El método: mide, no adivines',
        `
Los buenos ingenieros no «prueban a ver si mejora». Siguen un ciclo:

1. 📏 **Medir** — ejecuta \`EXPLAIN ANALYZE\` y apunta las filas leídas.
2. 🎯 **Localizar** — encuentra el nodo del plan que lee muchas más filas de las que produce.
3. 🔧 **Arreglar** — crea el índice adecuado o reescribe la consulta (filtros sargables, menos columnas, menos filas).
4. ✅ **Comprobar** — vuelve a medir. Si no ha mejorado, deshaz el cambio.

> «La optimización prematura es la raíz de todos los males.» Primero haz que la consulta sea **correcta**, y optimízala solo si es lenta de verdad y con datos reales.
`,
        '📐',
      ),
      sqlPerf(
        'Un informe lento, paso a paso',
        'ventas_grande',
        [
          ["SELECT producto, ROUND(SUM(importe), 2) AS total FROM ventas WHERE cliente_id = 100 AND fecha >= '2024-07-01' GROUP BY producto ORDER BY producto;", '1. Medir: el informe de un cliente del segundo semestre lee 6.000 filas'],
          ['CREATE INDEX idx_ventas_cliente_fecha ON ventas (cliente_id, fecha);', '3. Arreglar: índice con la igualdad primero (cliente_id) y el rango después (fecha)'],
          ["SELECT producto, ROUND(SUM(importe), 2) AS total FROM ventas WHERE cliente_id = 100 AND fecha >= '2024-07-01' GROUP BY producto ORDER BY producto;", '4. Comprobar: mismo resultado, ahora lee solo las filas del cliente en ese rango'],
        ],
      ),
      learn(
        'La consulta que se repite 12 veces',
        `
Un clásico: una **subconsulta correlacionada** se ejecuta **una vez por cada fila** de la consulta exterior. Si la tabla de dentro no tiene índice en la columna de enlace, cada ejecución barre la tabla entera:

\`\`\`
SELECT c.nombre,
       (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos
FROM clientes c;
\`\`\`

12 clientes × 24 pedidos barridos = **300 lecturas**. Con un índice sobre \`pedidos(cliente_id)\` cada ejecución va directa a los pedidos de ese cliente: **36 lecturas** en total. En una tabla de millones, esta diferencia es la que separa una consulta de milisegundos de otra de minutos.

**Más ideas de optimización:**

- **Indexa las claves foráneas** que usas en \`JOIN\` y en subconsultas correlacionadas.
- Pide **solo las columnas** que necesitas (evita \`SELECT *\` en tablas anchas) y **limita las filas** (\`LIMIT\`).
- **Filtra pronto**: un \`WHERE\` que reduce filas antes del \`GROUP BY\` o del \`JOIN\` es mejor que filtrar después con \`HAVING\`.
- Un \`DISTINCT\` o un \`ORDER BY\` innecesario obligan a ordenar o deduplicar: quítalos si no hacen falta.
- No sobreindexes: cada índice extra penaliza todas las escrituras.
`,
        '🔁',
      ),
      sqlPerf(
        'Subconsulta correlacionada: sin y con índice',
        'tienda',
        [
          ['SELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c ORDER BY c.id LIMIT 3;', 'Sin índice: cada cliente recorre la tabla de pedidos entera (mira las filas leídas)'],
          ['CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);', 'Indexamos la clave foránea'],
          ['SELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c ORDER BY c.id LIMIT 3;', 'Misma consulta y mismo resultado, con muchas menos lecturas'],
        ],
      ),
      order('Ordena el ciclo de optimización', ['Medir', 'Localizar', 'Arreglar', 'Comprobar'], 'Medir Localizar Arreglar Comprobar', 'Primero mides para saber dónde está el problema, lo localizas, aplicas el arreglo y vuelves a medir para confirmar la mejora.'),
      mc('Una consulta tarda 20 segundos. ¿Qué es lo primero que haces?', ['Crear un índice en todas las columnas', 'Reescribirla de memoria', 'Ejecutar EXPLAIN ANALYZE para ver dónde pierde el tiempo', 'Añadir LIMIT 10'], 2, 'Sin medir, adivinarías. El plan te dice qué tabla escanea y cuántas filas lee.'),
      tf('Cuantos más índices tenga una tabla, más rápido irá todo.', false, 'Los índices aceleran las lecturas pero ralentizan las escrituras (cada `INSERT`/`UPDATE`/`DELETE` actualiza todos) y ocupan espacio.'),
      mc('Una subconsulta correlacionada recorre una tabla grande una vez por cada fila de la consulta exterior. ¿Qué lo arregla mejor?', ['Un índice sobre la columna de enlace de la tabla interior', 'Quitar el ORDER BY', 'Usar SELECT *', 'Nada, es inevitable'], 0, 'Con un índice en la columna de enlace, cada ejecución va directa a sus filas en lugar de recorrer la tabla.'),
      sqlCode('Crea el índice que haga rápida la búsqueda de las ventas de un cliente en un rango de fechas (columnas `cliente_id` y `fecha`, en el orden correcto).', {
        setup: 'ventas_grande',
        check: state(['ventas'], { indexes: true }),
        solution: 'CREATE INDEX idx_ventas_cliente_fecha ON ventas (cliente_id, fecha);',
        hint: 'Igualdad primero (cliente_id), rango después (fecha)',
        why: 'La columna con `=` va primero y la del rango después: así el índice ordenado reduce primero al cliente y, dentro, a las fechas.',
      }),
      sqlPractice({
        goal: 'Clientes con su número de pedidos',
        prompt: 'El informe de abajo muestra cada cliente con su número de pedidos, pero lee 300 filas para una tabla de 24 pedidos. **Añade lo que haga falta para que lea 40 filas como máximo** sin cambiar el resultado.\n\n`SELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c;`',
        setup: 'tienda',
        starter: 'SELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c;',
        check: same({ names: true, maxRead: 40 }),
        solution: 'CREATE INDEX idx_pedidos_cliente ON pedidos (cliente_id);\nSELECT c.nombre, (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS pedidos FROM clientes c;',
        hints: ['La subconsulta filtra `pedidos` por `cliente_id`: esa es la columna a indexar.', 'Crea el índice antes de la consulta, en la misma ejecución.'],
        explain: 'La consulta no cambió ni un carácter: con el índice sobre la clave foránea, cada ejecución de la subconsulta va directa a los pedidos del cliente (36 lecturas en total en vez de 300).',
        commands: ['Optimizar consultas', 'CREATE INDEX'],
      }),
      sqlPractice({
        goal: 'Compras del cliente 250',
        prompt: 'El cliente **250** pide su historial del segundo semestre (desde `2024-07-01`), de más antiguo a más reciente.\n\n**Muestra `fecha`, `producto` e `importe`.** Crea el índice adecuado y consigue leer **solo las 6 filas** del resultado.',
        setup: 'ventas_grande',
        check: ordered({ names: true, maxRead: 6 }),
        solution: "CREATE INDEX idx_ventas_cliente_fecha ON ventas (cliente_id, fecha);\nSELECT fecha, producto, importe FROM ventas WHERE cliente_id = 250 AND fecha >= '2024-07-01' ORDER BY fecha;",
        hints: ['Un índice compuesto `(cliente_id, fecha)` deja en el índice solo las ventas del cliente a partir de esa fecha.', 'No olvides el `ORDER BY fecha`.'],
        explain: 'Con `(cliente_id, fecha)` el motor salta al cliente 250 y, dentro de él, a las fechas desde julio: lee exactamente las 6 filas que devuelve. Con un índice solo en `cliente_id` habría leído las 12 del cliente.',
        commands: ['Optimizar consultas', 'CREATE INDEX'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el dashboard del monitor',
    prompt:
      'El jefe de producto quiere un dashboard con los **monitores vendidos en el último trimestre de 2024** (desde `2024-10-01`), pero la consulta actual tarda una eternidad: lee las 6.000 ventas, y además filtra el trimestre con una función.\n\n**Muestra `ventas` (número de ventas) y `total` (importe sumado, redondeado a 2 decimales) del producto `monitor`.**\n\nArréglalo: crea el índice compuesto adecuado **y** reescribe el filtro de fecha para que sea sargable. Tu consulta final no puede leer más de **300 filas**.',
    setup: 'ventas_grande',
    starter: "SELECT COUNT(*) AS ventas, ROUND(SUM(importe), 2) AS total FROM ventas WHERE producto = 'monitor' AND strftime('%m', fecha) >= '10';",
    check: same({ names: true, maxRead: 300 }),
    solution:
      "CREATE INDEX idx_ventas_producto_fecha ON ventas (producto, fecha);\nSELECT COUNT(*) AS ventas, ROUND(SUM(importe), 2) AS total FROM ventas WHERE producto = 'monitor' AND fecha >= '2024-10-01';",
    hints: ['El índice compuesto: la columna con igualdad (`producto`) primero y la de rango (`fecha`) después.', 'Cambia `strftime(\'%m\', fecha) >= \'10\'` por `fecha >= \'2024-10-01\'`.', 'Con solo el índice o solo la reescritura no basta: necesitas las dos cosas.'],
    explain: 'Índice `(producto, fecha)` + filtro sargable: el motor salta a «monitor» y, dentro, a las fechas desde octubre, leyendo solo las 288 ventas necesarias en vez de 6.000. Esa es la receta de los dashboards rápidos. ¡Zona completada!',
    commands: ['Optimizar consultas', 'CREATE INDEX', 'Consultas sargables'],
  },
});
