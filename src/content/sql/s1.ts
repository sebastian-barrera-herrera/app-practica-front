import { fill, illus, learn, lesson, match, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s1 = sqlWorld({
  id: 's1',
  index: 1,
  title: 'Hola, datos',
  subtitle: 'Tus primeras consultas',
  emoji: '🗃️',
  color: '#FB923C',
  level: 'basico',
  intro:
    'Cada app que usas guarda sus datos en tablas: tu música, tus pedidos, tus mensajes. SQL es el idioma con el que se les hacen preguntas. Hoy entras como analista junior en TiendaTech, una tienda de informática: el jefe te dará peticiones y tú las convertirás en consultas. Empezamos por lo fundamental: mirar una tabla, elegir columnas, hacer cálculos, ordenar y quitar repetidos.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s1-1', { title: '¿Qué es una base de datos?', summary: 'Tablas, filas, columnas y tu primer SELECT', emoji: '👋', commands: ['SELECT', 'FROM'], minutes: 8 }, [
      learn(
        'Datos en todas partes',
        `
Cuando compras algo online, alguien guarda quién eres, qué compraste y cuándo. Esa información vive en una **base de datos**: un almacén ordenado que no se pierde al apagar el programa.

En una base de datos **relacional** (la más común) la información está en **tablas**, como hojas de cálculo muy disciplinadas:

- Una **tabla** guarda un tipo de cosa: \`clientes\`, \`productos\`, \`pedidos\`…
- Cada **fila** es un elemento concreto: _un_ cliente, _un_ producto.
- Cada **columna** es una propiedad: el \`nombre\`, el \`precio\`…
- Casi siempre hay una columna que identifica cada fila sin confusión: la **clave primaria** (\`id\`).

> CLAVE: Una base de datos no es un gran montón de datos: es un conjunto de tablas pequeñas, cada una sobre una sola cosa, conectadas entre sí.
`,
        '🗃️',
      ),
      illus('sql-table-anatomy', 'Anatomía de una tabla', 'Mira cómo se llaman las partes: tabla, columnas, filas, celdas y clave primaria.'),
      learn(
        'SQL: pides qué, no cómo',
        `
**SQL** (_Structured Query Language_, «lenguaje de consulta estructurado») es el idioma para hablar con una base de datos. Lo usan analistas, programadores, científicos de datos… y casi todas las empresas del mundo.

Lo especial de SQL es que es **declarativo**: tú describes **qué** datos quieres y la base de datos decide **cómo** encontrarlos de la forma más rápida. No escribes bucles ni recorres nada a mano.

\`\`\`
SELECT nombre
FROM clientes;
\`\`\`

Se lee casi como una frase: «selecciona el nombre de los clientes».
`,
        '💬',
      ),
      sqlDemo('Tu primera consulta', 'tienda', [
        ['SELECT * FROM clientes;', 'Todas las columnas (*) de todas las filas de la tabla clientes'],
        ['SELECT * FROM productos;', 'Cambiamos de tabla y pedimos otra cosa: ahora los productos'],
      ], 'Estas son las tablas de TiendaTech. Pulsa «Ejecutar» y mira qué devuelve cada consulta. Debajo tienes el botón **Tablas** para ver todas las que existen.'),
      mc('¿Qué representa **una fila** de la tabla `clientes`?', ['Una propiedad de los clientes, como el nombre', 'Un cliente concreto', 'Todos los clientes', 'Una base de datos'], 1, 'Cada fila es un elemento: un cliente. Las propiedades (nombre, ciudad…) son las **columnas**.'),
      match(
        'Une cada concepto con su significado',
        [
          ['Tabla', 'Conjunto de datos sobre un mismo tipo de cosa'],
          ['Fila', 'Un elemento concreto (un cliente)'],
          ['Columna', 'Una propiedad (el nombre, la ciudad…)'],
          ['Clave primaria', 'Lo que identifica cada fila sin repetirse'],
        ],
        'Tabla = tipo de cosa; fila = elemento; columna = propiedad; clave primaria = identificador único de cada fila.',
      ),
      learn(
        'Leer una consulta',
        `
Una consulta mínima tiene dos piezas:

| Pieza | Significa |
| --- | --- |
| \`SELECT\` | **Qué** columnas quiero ver |
| \`FROM\` | **De qué** tabla las saco |

- \`*\` significa «todas las columnas».
- El **punto y coma** \`;\` marca el final de la sentencia.
- Los **saltos de línea y espacios** no importan: sirven para que se lea mejor.

> TIP: \`SELECT\` no cambia nada. Solo **mira**. Puedes ejecutar todas las consultas que quieras sin romper los datos.
`,
      ),
      sqlOut('Predice: ¿qué devuelve esta consulta?', 'banco', 'SELECT * FROM cuentas;', ['Ana | 1000.0\nBeto | 250.0\nClara | 5000.0', '1 | Ana | 1000.0', '1000.0 | Ana | 1\n250.0 | Beto | 2\n5000.0 | Clara | 3'], 'El `*` trae todas las columnas (id, titular, saldo) de todas las filas, en el orden en que están las columnas de la tabla.'),
      tf('`SELECT * FROM clientes;` modifica los datos de la tabla clientes.', false, '`SELECT` solo lee. Para cambiar datos se usan otras sentencias (`INSERT`, `UPDATE`, `DELETE`) que veremos más adelante.'),
      sqlDemo('Cuando algo falla', 'tienda', [
        sqlErr('SELEC * FROM clientes;', 'Escribimos mal SELECT. El motor lo detecta y sugiere la palabra correcta'),
        sqlErr('SELECT * FORM clientes;', 'Aquí falla FROM. El mensaje dice qué esperaba y qué encontró'),
        sqlErr('SELECT * FROM cliente;', 'La tabla se llama clientes (en plural). Los nombres tienen que ser exactos'),
      ], 'Los errores no son un castigo: son pistas. Mira cómo te hablan.'),
      fill('Completa la consulta para ver todos los productos', '___ * ___ productos;', ['SELECT', 'FROM', 'WHERE', 'TABLE'], ['SELECT', 'FROM'], '`SELECT` dice qué columnas (aquí todas: `*`) y `FROM` de qué tabla.'),
      sqlCode('Escribe la consulta que muestre todas las filas y columnas de la tabla `productos`.', {
        setup: 'tienda',
        check: same(),
        solution: 'SELECT * FROM productos;',
        hint: 'Empieza por SELECT, usa * y termina con FROM productos',
        why: '`SELECT * FROM productos;` pide todas las columnas de todas las filas de la tabla.',
      }),
      sqlPractice({
        goal: 'Tus primeros datos',
        prompt: 'Tu jefa de TiendaTech quiere echar un vistazo al catálogo.\n\n**Muestra todas las columnas de todos los productos.**',
        setup: 'tienda',
        check: same(),
        solution: 'SELECT * FROM productos;',
        hints: ['La tabla se llama `productos`.', '`SELECT * FROM productos;`'],
        explain: 'Con `SELECT * FROM tabla;` ves el contenido completo de cualquier tabla. Es lo primero que se hace al conocer una base de datos nueva.',
        commands: ['SELECT', 'FROM'],
      }),
      sqlPractice({
        goal: 'Explora el cine',
        prompt: 'Ahora trabajas con una base de datos de cine. Mira las tablas disponibles (botón **Tablas**) y **muestra todo el contenido de la tabla de películas**.',
        setup: 'cine',
        check: same(),
        solution: 'SELECT * FROM peliculas;',
        hints: ['Abre el panel «Tablas»: verás que hay una que se llama `peliculas`.', '`SELECT * FROM peliculas;`'],
        explain: 'Otra base de datos, la misma idea: `SELECT * FROM` + el nombre de la tabla. Lo único que cambia es qué tabla miras.',
        commands: ['SELECT', 'FROM'],
      }),
      sqlPractice({
        goal: 'Arregla la consulta',
        prompt: 'Esta consulta tiene un error y no funciona. Léelo y **corrígela** para que muestre todos los clientes.',
        setup: 'tienda',
        starter: 'SELECT * FORM clientes;',
        check: same(),
        solution: 'SELECT * FROM clientes;',
        hints: ['El mensaje de error te dice qué palabra no entiende.', 'Está mal escrita la palabra FROM.'],
        explain: 'Leer el mensaje de error es medio trabajo hecho: te señala la palabra exacta y, muchas veces, sugiere la corrección.',
        commands: ['SELECT', 'FROM'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s1-2', { title: 'Elegir columnas', summary: 'Pide solo lo que necesitas', emoji: '🎯', commands: ['SELECT', 'Comentarios'], minutes: 8 }, [
      learn(
        'Pedir solo lo que necesitas',
        `
\`SELECT *\` es cómodo para explorar, pero en el trabajo real casi nunca quieres **todas** las columnas: la mayoría sobran. Pide solo las que necesitas, **separadas por comas**:

\`\`\`
SELECT nombre, precio
FROM productos;
\`\`\`

- Las columnas salen **en el orden en que las escribes**, no en el orden de la tabla.
- Puedes repetir una columna o ponerlas en cualquier orden.
- Menos columnas = resultados más fáciles de leer (y consultas más rápidas en bases de datos grandes).
`,
        '🎯',
      ),
      sqlDemo('Columnas a tu medida', 'tienda', [
        ['SELECT nombre, precio FROM productos;', 'Solo dos columnas'],
        ['SELECT precio, nombre FROM productos;', 'El orden lo decides tú: ahora el precio sale primero'],
        ['SELECT categoria FROM productos;', 'Una sola columna (fíjate en que las categorías se repiten: ya lo arreglaremos)'],
      ]),
      learn(
        'Mayúsculas, espacios y orden',
        `
- Las palabras de SQL (\`SELECT\`, \`FROM\`…) **no distinguen** mayúsculas de minúsculas. Por convención se escriben en **MAYÚSCULAS** para distinguirlas de tus tablas y columnas.
- Los **nombres** de tablas y columnas tampoco distinguen mayúsculas aquí, pero escríbelos igual que en la tabla.
- Los espacios y saltos de línea son libres. Un buen estilo es **una cláusula por línea**:

\`\`\`
SELECT nombre, precio
FROM productos;
\`\`\`

> CLAVE: Una consulta se escribe en este orden: primero **qué** quieres (\`SELECT\`) y luego **de dónde** (\`FROM\`). Pero la base de datos las procesa al revés: primero mira la tabla y después elige columnas.
`,
      ),
      order('Ordena las piezas para pedir el nombre y el precio de los productos', ['SELECT', 'nombre,', 'precio', 'FROM', 'productos;'], 'SELECT nombre, precio FROM productos;', 'Primero `SELECT` con las columnas separadas por coma y después `FROM` con la tabla.'),
      mc('¿Qué columnas devuelve `SELECT precio, nombre FROM productos;` y en qué orden?', ['nombre y luego precio', 'precio y luego nombre', 'Todas las columnas', 'Da un error: hay que respetar el orden de la tabla'], 1, 'Las columnas salen en el orden en que las escribes en el `SELECT`.'),
      learn(
        'Comentarios: notas para personas',
        `
Dentro de una consulta puedes dejar notas que la base de datos **ignora**:

\`\`\`
-- Esto es un comentario de una línea
SELECT nombre,   -- también al final de la línea
       precio
FROM productos;

/* Y este es un comentario
   de varias líneas */
\`\`\`

Sirven para explicar el **porqué** de una consulta, para dejarte recordatorios y para **desactivar** un trozo sin borrarlo.
`,
        '📝',
      ),
      sqlDemo('La coma olvidada', 'tienda', [
        ['SELECT nombre, precio FROM productos LIMIT 3;', 'Con la coma: dos columnas'],
        ['SELECT nombre precio FROM productos LIMIT 3;', 'Sin la coma NO da error: SQL entiende que «precio» es un apodo para la columna nombre. ¡Solo sale una columna!'],
      ], 'Un despiste muy típico: olvidar una coma. A veces SQL no se queja, solo cambia el resultado. Fíjate siempre en las columnas que salen.'),
      sqlOut('Predice el resultado', 'banco', 'SELECT titular, saldo FROM cuentas;', ['1 | Ana | 1000.0\n2 | Beto | 250.0\n3 | Clara | 5000.0', 'Ana\nBeto\nClara', '1000.0 | Ana\n250.0 | Beto\n5000.0 | Clara'], 'Solo salen las columnas pedidas (`titular` y `saldo`) y en ese orden.'),
      tf('Escribir `select nombre from clientes;` en minúsculas da un error.', false, 'Las palabras de SQL no distinguen mayúsculas de minúsculas. Se escriben en mayúsculas solo por costumbre, para leer mejor.'),
      sqlCode('Muestra solo las columnas `nombre` y `ciudad` de la tabla `clientes`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, ciudad FROM clientes;',
        hint: 'SELECT columna1, columna2 FROM tabla',
        why: 'Dos columnas separadas por una coma, y `FROM clientes`.',
      }),
      sqlPractice({
        goal: 'La lista de precios',
        prompt: 'El equipo de ventas quiere imprimir una lista de precios.\n\n**Muestra el nombre y el precio de todos los productos** (solo esas dos columnas, en ese orden).',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, precio FROM productos;',
        hints: ['Pide `nombre` y `precio`, separadas por una coma.', '`SELECT nombre, precio FROM productos;`'],
        explain: 'Elegir columnas es lo más básico y lo más usado de SQL: pedir solo lo que hace falta.',
        commands: ['SELECT'],
      }),
      sqlPractice({
        goal: 'Ficha de películas',
        prompt: 'Para el cartel del cine necesitas el título y el año.\n\n**Muestra `titulo` y `anio` de todas las películas**, con el año primero y el título después.',
        setup: 'cine',
        check: same({ names: true }),
        solution: 'SELECT anio, titulo FROM peliculas;',
        hints: ['El orden de las columnas es el que escribas en el SELECT.', '`SELECT anio, titulo FROM peliculas;`'],
        explain: 'El orden de las columnas en el resultado es el del `SELECT`, no el de la tabla.',
        commands: ['SELECT'],
      }),
      sqlPractice({
        goal: 'Contactos de clientes',
        prompt: 'Marketing quiere los contactos de los clientes.\n\n**Muestra el nombre, la ciudad y el email de todos los clientes.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, ciudad, email FROM clientes;',
        hints: ['Tres columnas separadas por comas.', 'Observa que algunos clientes no tienen ciudad o email: salen como NULL (vacío).'],
        explain: 'Cuando falta un dato, SQL muestra `NULL`: significa «no se sabe / no hay valor». Le dedicaremos una lección entera.',
        commands: ['SELECT'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s1-3', { title: 'Alias y cálculos', summary: 'Renombra columnas y haz cuentas con AS', emoji: '🧮', commands: ['AS', 'Operadores aritméticos', 'Concatenar ||'], minutes: 9 }, [
      learn(
        'SELECT también calcula',
        `
Una columna del resultado no tiene por qué existir en la tabla: puede ser un **cálculo**. SQL entiende las operaciones de siempre:

| Operador | Hace |
| --- | --- |
| \`+\`  \`-\`  \`*\`  \`/\` | sumar, restar, multiplicar, dividir |
| \`%\` | resto de la división |
| \`( )\` | agrupar, como en matemáticas |

\`\`\`
SELECT nombre, precio * 1.21
FROM productos;
\`\`\`

Esto calcula el precio con un 21 % de IVA **para cada fila**. La tabla original no cambia: el cálculo solo existe en el resultado.
`,
        '🧮',
      ),
      sqlDemo('Cuentas dentro del SELECT', 'tienda', [
        ['SELECT nombre, precio, precio * 1.21 FROM productos LIMIT 4;', 'Una columna calculada. Su nombre es la propia fórmula… poco bonito'],
        ['SELECT nombre, precio, precio * 1.21 AS precio_iva FROM productos LIMIT 4;', 'Con AS le damos un nombre claro: un **alias**'],
        ['SELECT nombre, stock, precio, stock * precio AS valor_en_almacen FROM productos LIMIT 5;', 'También se puede operar entre columnas de la misma fila'],
        ['SELECT 2 + 3, 10 * 4, (2 + 3) * 4;', 'Y ni siquiera hace falta FROM si solo quieres calcular'],
      ]),
      learn(
        'AS: ponerle nombre al resultado',
        `
\`AS\` pone un **alias** (otro nombre) a una columna o a un cálculo:

\`\`\`
SELECT nombre AS producto,
       precio * 1.21 AS precio_iva
FROM productos;
\`\`\`

- El alias **solo afecta al resultado**; la tabla sigue igual.
- Usa nombres sin espacios (\`precio_iva\`). Si necesitas espacios, ponlos entre comillas dobles: \`AS "Precio con IVA"\`.
- Las **comillas simples** \`'...'\` son para **textos**; las **dobles** \`"..."\` para **nombres**. No las mezcles.
`,
        '🏷️',
      ),
      mc('¿Para qué sirve `AS` en `SELECT precio * 2 AS doble`?', ['Para multiplicar', 'Para darle un nombre a la columna del resultado', 'Para cambiar el precio en la tabla', 'Para ordenar'], 1, '`AS` crea un alias: el nombre con el que aparece la columna en el resultado. No modifica la tabla.'),
      learn(
        'Dividir: cuidado con los enteros',
        `
Con los **números enteros**, la división también da un entero:

- \`7 / 2\` → **3** (se pierde la parte decimal)
- \`7 / 2.0\` → **3.5** (si uno de los dos tiene decimales, el resultado también)
- \`7 % 2\` → **1** (el resto)

> OJO: Es un clásico: si divides enteros y esperas decimales, escribe uno de los números con \`.0\`.
`,
        '➗',
      ),
      sqlOut('Predice el resultado de estas tres operaciones', 'tienda', 'SELECT 7 / 2, 7 / 2.0, 7 % 2;', ['3.5 | 3.5 | 1', '3 | 3 | 1', '3 | 3.5 | 3'], 'Entre enteros la división es entera (3); con un decimal sale 3.5; y `%` devuelve el resto (1).'),
      learn(
        'Unir textos con ||',
        `
El operador \`||\` **concatena** (une) textos:

\`\`\`
SELECT nombre || ' vive en ' || ciudad
FROM clientes;
\`\`\`

El texto fijo va entre **comillas simples**. Puedes mezclar columnas y textos como quieras.

> OJO: Si una de las partes es \`NULL\` (dato que falta), **todo el resultado** es \`NULL\`. Lo arreglaremos con \`COALESCE\`.
`,
        '🔗',
      ),
      sqlDemo('Frases con datos', 'tienda', [
        ["SELECT nombre || ' vive en ' || ciudad AS frase FROM clientes LIMIT 5;", 'Une columnas y texto. Mira qué pasa con Pablo, que no tiene ciudad'],
        ["SELECT 'Producto: ' || nombre || ' (' || categoria || ')' AS ficha FROM productos LIMIT 3;", 'Se pueden unir tantas partes como quieras'],
      ]),
      mc('¿Qué devuelve `SELECT 10 / 4;`?', ['2.5', '2', '2.0', 'Un error'], 1, 'Entre dos enteros la división es entera: 10 / 4 = 2. Para obtener 2.5 habría que escribir `10 / 4.0`.'),
      sqlCode('Muestra el nombre de cada producto y su precio con un 21 % de IVA (`precio * 1.21`), llamando a la segunda columna `precio_iva`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, precio * 1.21 AS precio_iva FROM productos;',
        hint: 'precio * 1.21 AS precio_iva',
        why: 'La columna calculada se llama como diga el alias.',
      }),
      sqlPractice({
        goal: 'Precio con IVA',
        prompt: 'En la web hay que mostrar el precio final.\n\n**Muestra `nombre` y el precio con un 21 % de IVA** (`precio * 1.21`) como `precio_final`.',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, precio * 1.21 AS precio_final FROM productos;',
        hints: ['Multiplica el precio por 1.21.', 'Ponle el alias con `AS precio_final`.'],
        explain: 'Una columna calculada + `AS` es la receta más usada en informes: el cálculo se hace al pedir los datos, sin tocar la tabla.',
        commands: ['AS', 'Operadores aritméticos'],
      }),
      sqlPractice({
        goal: 'Duración en horas y minutos',
        prompt: 'La duración de las películas está en minutos. Para el programa de mano:\n\n**Muestra `titulo`, las horas completas como `horas` (`duracion / 60`) y los minutos sobrantes como `minutos` (`duracion % 60`).**',
        setup: 'cine',
        check: same({ names: true }),
        solution: 'SELECT titulo, duracion / 60 AS horas, duracion % 60 AS minutos FROM peliculas;',
        hints: ['La división entera te da las horas completas.', '`%` te da el resto: los minutos que sobran.'],
        explain: 'Aquí la división entera es justo lo que queríamos (horas completas) y `%` recupera el resto. Dos operadores, un truco clásico para convertir unidades.',
        commands: ['Operadores aritméticos', 'AS'],
      }),
      sqlPractice({
        goal: 'Etiquetas de producto',
        prompt: 'Para las etiquetas de la tienda necesitas una sola columna llamada `etiqueta` con el formato **`nombre - categoria`** (por ejemplo: `Webcam HD - perifericos`).\n\n**Muestra esa columna para todos los productos.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre || ' - ' || categoria AS etiqueta FROM productos;",
        hints: ["El texto fijo ' - ' va entre comillas simples.", "`nombre || ' - ' || categoria`"],
        explain: '`||` une columnas y textos fijos en una sola. Es la base para generar etiquetas, frases o nombres completos.',
        commands: ['Concatenar ||', 'AS'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s1-4', { title: 'Ordenar y limitar', summary: 'ORDER BY, LIMIT y OFFSET', emoji: '🏆', commands: ['ORDER BY', 'LIMIT y OFFSET'], minutes: 9 }, [
      learn(
        'Las filas no tienen orden por sí solas',
        `
Una tabla es un **conjunto** de filas: sin pedirlo, SQL **no garantiza** ningún orden. Para ordenar usas \`ORDER BY\`, que va **al final** de la consulta:

\`\`\`
SELECT nombre, precio
FROM productos
ORDER BY precio;
\`\`\`

- Por defecto ordena de menor a mayor (\`ASC\`, ascendente).
- \`DESC\` ordena de mayor a menor.
- Con textos ordena alfabéticamente; con fechas, cronológicamente.
`,
        '🏆',
      ),
      sqlDemo('Ordenar de varias formas', 'tienda', [
        ['SELECT nombre, precio FROM productos ORDER BY precio;', 'De más barato a más caro (ASC por defecto)'],
        ['SELECT nombre, precio FROM productos ORDER BY precio DESC;', 'De más caro a más barato con DESC'],
        ['SELECT nombre, categoria, precio FROM productos ORDER BY categoria, precio DESC;', 'Dos criterios: primero por categoría; dentro de cada una, por precio de mayor a menor'],
      ]),
      learn(
        'LIMIT y OFFSET: quedarte con un trozo',
        `
- \`LIMIT n\` devuelve como mucho **n filas**. Con \`ORDER BY\` sirve para los «top»: _los 3 más caros_, _las 5 últimas_.
- \`OFFSET m\` se **salta** las primeras m filas. Con \`LIMIT\` permite **paginar**: la página 1 es \`LIMIT 10\`, la 2 es \`LIMIT 10 OFFSET 10\`, la 3 es \`LIMIT 10 OFFSET 20\`.

\`\`\`
SELECT nombre, precio
FROM productos
ORDER BY precio DESC
LIMIT 3;
\`\`\`

> OJO: \`LIMIT\` sin \`ORDER BY\` devuelve filas «cualquiera». Casi siempre van juntos.
`,
        '✂️',
      ),
      sqlDemo('Top y páginas', 'tienda', [
        ['SELECT nombre, precio FROM productos ORDER BY precio DESC LIMIT 3;', 'Los 3 más caros'],
        ['SELECT nombre, precio FROM productos ORDER BY precio DESC LIMIT 3 OFFSET 3;', 'Los 3 siguientes (la «página 2»)'],
      ]),
      mc('¿Qué hace `ORDER BY precio DESC`?', ['Ordena del precio más bajo al más alto', 'Ordena del precio más alto al más bajo', 'Elimina los precios repetidos', 'Describe la columna precio'], 1, '`DESC` (descendente) pone primero los valores más grandes.'),
      learn(
        'NULL a la hora de ordenar',
        `
¿Dónde van las filas **sin valor** (\`NULL\`)? Depende del motor. Aquí, como en PostgreSQL, **los NULL se consideran los más grandes**: salen al final con \`ASC\` y **al principio con \`DESC\`**.

Puedes controlarlo: \`ORDER BY puntuacion DESC NULLS LAST\` los manda al final.
`,
        '🕳️',
      ),
      sqlOut('Una trampa: ¿qué películas salen primero?', 'cine', 'SELECT titulo, puntuacion FROM peliculas ORDER BY puntuacion DESC LIMIT 3;', ['Origen | 8.8\nInterstellar | 8.7\nParásitos | 8.5', 'Barbie | 6.8\nLa forma del agua | 7.3\nLady Bird | 7.4', 'Película sin estrenar | 0\nOrigen | 8.8\nInterstellar | 8.7'], 'La película sin estrenar no tiene puntuación (`NULL`) y los NULL cuentan como «los más grandes», así que con `DESC` salen primero. Para evitarlo: `NULLS LAST`.'),
      tf('`LIMIT 5 OFFSET 10` devuelve las filas de la 11 a la 15.', true, '`OFFSET 10` se salta 10 filas y `LIMIT 5` toma las 5 siguientes: de la 11 a la 15.'),
      sqlCode('Muestra el título y el año de las 3 películas más antiguas.', {
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT titulo, anio FROM peliculas ORDER BY anio LIMIT 3;',
        hint: 'Ordena por año (ASC es lo normal) y limita a 3',
        why: '`ORDER BY anio` pone las más antiguas primero y `LIMIT 3` se queda con tres.',
      }),
      sqlPractice({
        goal: 'El podio de precios',
        prompt: 'La directora quiere ver los **3 productos más caros** del catálogo.\n\n**Muestra `nombre` y `precio` de los 3 más caros, del más caro al menos caro.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, precio FROM productos ORDER BY precio DESC LIMIT 3;',
        hints: ['Ordena por precio de mayor a menor.', 'Añade `LIMIT 3` al final.'],
        explain: '`ORDER BY ... DESC` + `LIMIT n` es la receta de los «top n». Los dos van siempre al final y en ese orden.',
        commands: ['ORDER BY', 'LIMIT y OFFSET'],
      }),
      sqlPractice({
        goal: 'Estrenos recientes',
        prompt: 'En el cine quieren la lista de películas **de la más nueva a la más antigua**; en caso de empate de año, por título alfabéticamente.\n\n**Muestra `titulo` y `anio` con ese orden.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT titulo, anio FROM peliculas ORDER BY anio DESC, titulo;',
        hints: ['Dos criterios de orden separados por coma.', '`ORDER BY anio DESC, titulo`'],
        explain: 'Con varios criterios, SQL ordena por el primero y usa el siguiente solo para desempatar.',
        commands: ['ORDER BY'],
      }),
      sqlPractice({
        goal: 'Página 2',
        prompt: 'El catálogo web muestra los productos **ordenados por precio de menor a mayor**, de 4 en 4.\n\n**Muestra `nombre` y `precio` de la página 2** (los productos del 5.º al 8.º).',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, precio FROM productos ORDER BY precio LIMIT 4 OFFSET 4;',
        hints: ['La página 1 se saltaría 0 filas; la 2, 4.', '`LIMIT 4 OFFSET 4`'],
        explain: 'Paginar = `LIMIT tamaño OFFSET (página - 1) * tamaño`. Así funcionan los «Siguiente» de casi todas las webs.',
        commands: ['LIMIT y OFFSET', 'ORDER BY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s1-5', { title: 'Quitar repetidos', summary: 'DISTINCT y qué valores hay', emoji: '🧹', commands: ['DISTINCT'], minutes: 7 }, [
      learn(
        'Valores repetidos',
        `
En la tabla \`productos\` hay 14 filas pero solo 5 categorías: la misma categoría se repite en varias filas. Si preguntas «¿qué categorías existen?» no quieres ver 14 líneas.

\`DISTINCT\` justo después de \`SELECT\` **elimina las filas repetidas** del resultado:

\`\`\`
SELECT DISTINCT categoria
FROM productos;
\`\`\`
`,
        '🧹',
      ),
      sqlDemo('Con y sin DISTINCT', 'tienda', [
        ['SELECT categoria FROM productos;', 'Sin DISTINCT: una fila por producto, con repeticiones'],
        ['SELECT DISTINCT categoria FROM productos;', 'Con DISTINCT: cada categoría una sola vez'],
        ['SELECT DISTINCT ciudad FROM clientes ORDER BY ciudad;', 'Funciona con cualquier columna. Y puedes ordenar el resultado'],
      ]),
      learn(
        'DISTINCT mira la fila entera',
        `
Con **varias columnas**, \`DISTINCT\` quita las filas **completamente iguales**, no los valores sueltos repetidos:

\`\`\`
SELECT DISTINCT genero, anio
FROM peliculas;
\`\`\`

Dos películas del mismo género pero de años distintos salen las dos: la _combinación_ (género, año) es distinta.

> TIP: \`NULL\` también cuenta como un valor y aparece una vez. Y recuerda: \`DISTINCT\` va **solo una vez**, pegado a \`SELECT\`, y afecta a todas las columnas.
`,
      ),
      mc('Hay 14 productos y 5 categorías distintas. ¿Cuántas filas devuelve `SELECT DISTINCT categoria FROM productos;`?', ['14', '5', '1', '9'], 1, 'Una fila por cada categoría distinta: 5.'),
      sqlOut('¿Qué géneros hay en el cine?', 'cine', 'SELECT DISTINCT genero FROM peliculas ORDER BY genero;', ['ciencia ficcion\ncomedia\ndrama\nfantasia\nterror\nthriller\ndrama\ndrama', 'drama\ncomedia', 'ciencia ficcion\ncomedia\ndrama\nterror\nthriller'], 'Seis géneros distintos, uno por fila y ordenados alfabéticamente (`drama` aparece muchas veces en la tabla, pero una sola en el resultado).'),
      tf('`SELECT DISTINCT genero, anio FROM peliculas;` devuelve cada género una sola vez.', false, 'DISTINCT compara la fila completa (género **y** año): un mismo género sale tantas veces como años distintos tenga.'),
      sqlCode('Muestra las ciudades distintas donde viven los clientes (sin repetir).', {
        setup: 'tienda',
        check: same(),
        solution: 'SELECT DISTINCT ciudad FROM clientes;',
        hint: 'SELECT DISTINCT ...',
        why: '`DISTINCT` quita las ciudades repetidas. El `NULL` de los clientes sin ciudad sale como una fila más.',
      }),
      sqlPractice({
        goal: 'Las categorías de la tienda',
        prompt: 'Para el menú de la web necesitas la lista de categorías.\n\n**Muestra cada categoría de producto una sola vez, ordenadas alfabéticamente.**',
        setup: 'tienda',
        check: ordered(),
        solution: 'SELECT DISTINCT categoria FROM productos ORDER BY categoria;',
        hints: ['Usa DISTINCT para quitar repeticiones.', 'Añade `ORDER BY categoria` al final.'],
        explain: '`DISTINCT` + `ORDER BY` es el combo para listados limpios: valores únicos y en orden.',
        commands: ['DISTINCT', 'ORDER BY'],
      }),
      sqlPractice({
        goal: 'Directores con película',
        prompt: 'Quieres saber **de qué países hay directores** en la base de datos del cine.\n\n**Muestra cada país una sola vez** (tabla `directores`).',
        setup: 'cine',
        check: same(),
        solution: 'SELECT DISTINCT pais FROM directores;',
        hints: ['La tabla es `directores` y la columna `pais`.', 'Hay directores de España repetidos: DISTINCT los reduce a uno.'],
        explain: 'Cuando quieras saber «qué valores hay» en una columna, `SELECT DISTINCT columna` es la respuesta.',
        commands: ['DISTINCT'],
      }),
      sqlPractice({
        goal: 'Combinaciones únicas',
        prompt: 'Del catálogo de películas quieres las **combinaciones distintas de género y año** (por ejemplo, `drama` de 2006).\n\n**Muestra `genero` y `anio` sin repeticiones, ordenado por género y luego por año.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT DISTINCT genero, anio FROM peliculas ORDER BY genero, anio;',
        hints: ['DISTINCT afecta a las dos columnas a la vez.', '`ORDER BY genero, anio`'],
        explain: 'Con varias columnas, DISTINCT quita solo las filas **idénticas**: aquí, dos películas del mismo género y año.',
        commands: ['DISTINCT', 'ORDER BY'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el catálogo del lunes',
    prompt:
      'Es lunes y la directora de TiendaTech te pide un listado para la web:\n\n- Los **5 productos más baratos**, del más barato al más caro.\n- Con dos columnas: `nombre` y el precio **con un 21 % de IVA** llamado `precio_iva`.\n\n**Escribe la consulta.** (Usa todo lo que has aprendido: columnas, alias, cálculos, orden y límite.)',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: 'SELECT nombre, precio * 1.21 AS precio_iva FROM productos ORDER BY precio LIMIT 5;',
    hints: ['Calcula `precio * 1.21` y ponle el alias `precio_iva`.', 'Ordena por `precio` (el original o el calculado, da igual) y limita a 5.'],
    explain: 'Columnas + cálculo + alias + `ORDER BY` + `LIMIT`: con estas piezas ya puedes responder una gran cantidad de peticiones reales. ¡Zona completada!',
    commands: ['SELECT', 'AS', 'ORDER BY', 'LIMIT y OFFSET'],
  },
});
