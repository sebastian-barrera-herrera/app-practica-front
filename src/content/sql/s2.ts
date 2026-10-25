import { fill, learn, lesson, match, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s2 = sqlWorld({
  id: 's2',
  index: 2,
  title: 'Filtrar',
  subtitle: 'Quédate solo con lo que importa',
  emoji: '🧲',
  color: '#FBBF24',
  level: 'basico',
  intro:
    'Las tablas de verdad tienen miles de filas y casi nunca las quieres todas. `WHERE` es el filtro de SQL: describes una condición y solo pasan las filas que la cumplen. Aprenderás a comparar, a combinar condiciones con AND y OR, a buscar por listas, rangos y patrones de texto, y a manejar ese valor tan peculiar que es NULL, el origen de más de un error famoso.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s2-1', { title: 'WHERE y comparaciones', summary: 'Filtra filas con una condición', emoji: '🔍', commands: ['WHERE', 'Comparaciones'], minutes: 8 }, [
      learn(
        'Filas que cumplen una condición',
        `
\`WHERE\` va después de \`FROM\` y deja pasar **solo las filas** para las que la condición es verdadera:

\`\`\`
SELECT nombre, precio
FROM productos
WHERE precio > 100;
\`\`\`

La base de datos revisa cada fila, se hace la pregunta «¿es el precio mayor que 100?» y se queda solo con las que responden **sí**. Después elige las columnas del \`SELECT\`.

> CLAVE: \`WHERE\` filtra **filas**; el \`SELECT\` elige **columnas**. Son dos recortes distintos de la tabla.
`,
        '🔍',
      ),
      learn(
        'Los operadores de comparación',
        `
| Operador | Significa |
| --- | --- |
| \`=\` | igual (¡un solo signo!) |
| \`<>\` o \`!=\` | distinto |
| \`<\`   \`>\` | menor / mayor |
| \`<=\`   \`>=\` | menor o igual / mayor o igual |

Reglas importantes:

- Los **textos** van entre comillas **simples**: \`categoria = 'audio'\`.
- Los **números** van sin comillas: \`precio > 100\`.
- Las **fechas** se escriben como texto \`'AAAA-MM-DD'\`: \`fecha >= '2024-01-01'\`.
- Los textos se comparan **distinguiendo mayúsculas**: \`'Audio'\` no es igual a \`'audio'\`.
`,
      ),
      sqlDemo('Filtrando productos y clientes', 'tienda', [
        ['SELECT nombre, precio FROM productos WHERE precio > 100;', 'Los productos de más de 100 €'],
        ["SELECT nombre, categoria FROM productos WHERE categoria = 'audio';", 'Comparar con un texto: comillas simples'],
        ["SELECT nombre, fecha_alta FROM clientes WHERE fecha_alta >= '2024-01-01';", 'Con fechas: el texto «AAAA-MM-DD» se compara cronológicamente'],
        ['SELECT nombre, stock FROM productos WHERE stock = 0;', 'Un solo signo = para comparar'],
      ]),
      mc('¿Cuál es la forma correcta de pedir los productos de la categoría audio?', ["WHERE categoria == 'audio'", "WHERE categoria = 'audio'", 'WHERE categoria = audio', 'WHERE categoria IS audio'], 1, 'En SQL se compara con un único `=` y los textos van entre comillas simples.'),
      sqlDemo('Error típico: comillas dobles', 'tienda', [
        sqlErr('SELECT nombre FROM productos WHERE categoria = "audio";', 'Las comillas dobles son para NOMBRES de columnas o tablas, no para textos. El mensaje lo explica'),
      ]),
      sqlOut('Predice: ¿qué productos pasan el filtro?', 'tienda', 'SELECT nombre, precio FROM productos WHERE precio >= 249 ORDER BY precio;', ['Tablet 10 pulgadas | 329.0\nPortátil Air 13 | 999.0\nPortátil Pro 15 | 1299.0', 'Monitor 27 pulgadas | 249.0\nTablet 10 pulgadas | 329.0', 'Portátil Pro 15 | 1299.0\nPortátil Air 13 | 999.0\nTablet 10 pulgadas | 329.0\nMonitor 27 pulgadas | 249.0'], 'Con `>=` entra el 249 (el Monitor 27 pulgadas), así que son cuatro productos, ordenados de menor a mayor precio.'),
      tf('`WHERE precio > 100` y `WHERE precio >= 100` devuelven siempre lo mismo.', false, 'Se diferencian en las filas con precio exactamente igual a 100: `>=` las incluye y `>` no.'),
      fill('Completa: clientes que viven en Sevilla', 'SELECT nombre FROM clientes ___ ciudad ___ \'Sevilla\';', ['WHERE', '=', 'FROM', '=='], ['WHERE', '='], '`WHERE` introduce la condición y se compara con un único `=`.'),
      sqlCode('Muestra el nombre de los productos que cuestan menos de 20 €.', {
        setup: 'tienda',
        check: same(),
        solution: 'SELECT nombre FROM productos WHERE precio < 20;',
        hint: 'WHERE precio < 20',
        why: '`WHERE precio < 20` deja solo los productos más baratos de 20.',
      }),
      sqlPractice({
        goal: 'Chollos',
        prompt: 'Marketing prepara la sección «Chollos»: todo lo que cuesta **menos de 30 €**.\n\n**Muestra `nombre` y `precio` de esos productos.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, precio FROM productos WHERE precio < 30;',
        hints: ['La condición es `precio < 30`.', '`WHERE` va después de `FROM`.'],
        explain: '`WHERE` filtra las filas antes de elegir columnas. Aquí quedan cinco productos baratos.',
        commands: ['WHERE', 'Comparaciones'],
      }),
      sqlPractice({
        goal: 'Clientes de Madrid',
        prompt: 'Vas a enviar una invitación a un evento en Madrid.\n\n**Muestra `nombre` y `email` de los clientes cuya ciudad es Madrid.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, email FROM clientes WHERE ciudad = 'Madrid';",
        hints: ['Los textos van entre comillas simples.', "`WHERE ciudad = 'Madrid'`"],
        explain: 'Comparar con un texto necesita comillas simples. Recuerda que se distinguen mayúsculas: `Madrid` no es `madrid`.',
        commands: ['WHERE', 'Comparaciones'],
      }),
      sqlPractice({
        goal: 'Cine moderno',
        prompt: 'Para el ciclo «Cine del siglo XXI» necesitas las películas **posteriores a 2010** (el año 2010 no cuenta).\n\n**Muestra `titulo` y `anio`, ordenadas por año y, si empatan, por título.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT titulo, anio FROM peliculas WHERE anio > 2010 ORDER BY anio, titulo;',
        hints: ['«Posteriores» a 2010 es `anio > 2010`.', 'El `ORDER BY` va después del `WHERE`.'],
        explain: 'Orden de las cláusulas: `SELECT … FROM … WHERE … ORDER BY …`. Primero se filtra y luego se ordena lo que queda.',
        commands: ['WHERE', 'ORDER BY'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s2-2', { title: 'AND, OR y NOT', summary: 'Combina condiciones (y no te líes con la prioridad)', emoji: '🧠', commands: ['AND, OR, NOT'], minutes: 9 }, [
      learn(
        'Más de una condición',
        `
Casi nunca basta una sola condición. Se combinan con tres palabras:

| Palabra | La fila pasa si… |
| --- | --- |
| \`AND\` | se cumplen **las dos** condiciones |
| \`OR\` | se cumple **al menos una** |
| \`NOT\` | la condición **no** se cumple |

\`\`\`
SELECT nombre, categoria, precio
FROM productos
WHERE categoria = 'perifericos' AND precio < 50;
\`\`\`
`,
        '🧠',
      ),
      sqlDemo('AND, OR y NOT en acción', 'tienda', [
        ["SELECT nombre, categoria, precio FROM productos WHERE categoria = 'perifericos' AND precio < 50;", 'AND: periféricos Y baratos. Solo salen los que cumplen las dos'],
        ["SELECT nombre, categoria FROM productos WHERE categoria = 'audio' OR categoria = 'pantallas';", 'OR: audio O pantallas. Basta con una'],
        ['SELECT nombre, vip FROM clientes WHERE NOT vip;', 'NOT: invierte la condición. Aquí, los que no son VIP'],
      ]),
      learn(
        'La trampa de la prioridad',
        `
Igual que en matemáticas la multiplicación va antes que la suma, en SQL **\`AND\` se evalúa antes que \`OR\`**. Esto es una fuente clásica de errores:

\`\`\`
WHERE categoria = 'audio' OR categoria = 'pantallas' AND precio > 200
\`\`\`

SQL lo entiende como: \`audio\` **o** (\`pantallas\` **y** precio > 200). Es decir, ¡cualquier producto de audio, sea cual sea su precio!

La solución es la de siempre: **paréntesis**. Cuando mezcles \`AND\` y \`OR\`, ponlos siempre, aunque no hagan falta.

\`\`\`
WHERE (categoria = 'audio' OR categoria = 'pantallas') AND precio > 200
\`\`\`
`,
        '⚠️',
      ),
      sqlDemo('Sin paréntesis vs con paréntesis', 'tienda', [
        ["SELECT nombre, categoria, precio FROM productos WHERE categoria = 'audio' OR categoria = 'pantallas' AND precio > 200;", 'Sin paréntesis: salen los dos de audio (aunque cuestan menos de 200)…'],
        ["SELECT nombre, categoria, precio FROM productos WHERE (categoria = 'audio' OR categoria = 'pantallas') AND precio > 200;", '…y con paréntesis solo lo que pretendíamos: audio o pantallas, pero caros'],
      ]),
      sqlOut('¿Qué devuelve? (cuidado con la prioridad)', 'tienda', "SELECT nombre FROM productos WHERE categoria = 'audio' OR categoria = 'pantallas' AND precio > 200;", ['Monitor 27 pulgadas', 'Monitor 27 pulgadas\nMonitor 24 pulgadas\nAuriculares Bluetooth\nAltavoz portátil', 'Auriculares Bluetooth\nAltavoz portátil'], '`AND` se evalúa primero: pantallas **y** de más de 200 € (solo el Monitor 27) o cualquier producto de audio. Por eso salen tres.'),
      mc('¿Qué operador se evalúa primero si no hay paréntesis?', ['OR', 'AND', 'Los dos a la vez', 'El que esté más a la izquierda'], 1, '`AND` tiene más prioridad que `OR`. Por eso conviene usar paréntesis al mezclarlos.'),
      match(
        'Une cada condición con lo que significa',
        [
          ['a AND b', 'Se cumplen las dos'],
          ['a OR b', 'Se cumple al menos una'],
          ['NOT a', 'No se cumple a'],
          ['(a OR b) AND c', 'Primero se resuelve el paréntesis'],
        ],
        'AND exige las dos; OR basta con una; NOT invierte; y los paréntesis mandan sobre cualquier prioridad.',
      ),
      tf('`WHERE NOT vip` devuelve los clientes que sí son VIP.', false, '`NOT` invierte la condición: devuelve los que **no** son VIP.'),
      sqlCode('Muestra los clientes VIP de Madrid (`nombre` y `ciudad`).', {
        setup: 'tienda',
        check: same(),
        solution: "SELECT nombre, ciudad FROM clientes WHERE vip AND ciudad = 'Madrid';",
        hint: "vip es verdadero/falso: puedes escribir WHERE vip AND ciudad = 'Madrid'",
        why: 'Las dos condiciones deben cumplirse: AND. Una columna booleana (`vip`) se puede usar sola como condición.',
      }),
      sqlPractice({
        goal: 'Periféricos baratos',
        prompt: 'Para una oferta quieres los **periféricos que cuestan menos de 50 €**.\n\n**Muestra `nombre`, `categoria` y `precio`.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, categoria, precio FROM productos WHERE categoria = 'perifericos' AND precio < 50;",
        hints: ['Dos condiciones: categoría y precio.', "`WHERE categoria = 'perifericos' AND precio < 50`"],
        explain: '`AND` exige que se cumplan las dos condiciones a la vez. El teclado mecánico (79,90 €) se queda fuera por precio.',
        commands: ['AND, OR, NOT'],
      }),
      sqlPractice({
        goal: 'Dramas o comedias recientes',
        prompt: 'El cine programa un ciclo reciente: películas de **drama o comedia** estrenadas **en 2017 o después**.\n\n**Muestra `titulo`, `genero` y `anio`.** (Atención a la prioridad de AND y OR.)',
        setup: 'cine',
        check: same({ names: true }),
        solution: "SELECT titulo, genero, anio FROM peliculas WHERE (genero = 'drama' OR genero = 'comedia') AND anio >= 2017;",
        hints: ['Agrupa el género con paréntesis.', "`(genero = 'drama' OR genero = 'comedia') AND anio >= 2017`"],
        explain: 'Sin paréntesis, `AND` se evaluaría primero y entrarían dramas de cualquier año. Con ellos, el filtro de año se aplica a los dos géneros.',
        commands: ['AND, OR, NOT'],
      }),
      sqlPractice({
        goal: 'Clientes que no son VIP',
        prompt: 'Para una campaña de fidelización buscas los clientes **que no son VIP y viven en Sevilla o en Valencia**.\n\n**Muestra `nombre` y `ciudad`.** Usa `NOT`.',
        setup: 'tienda',
        check: same({ names: true, uses: ['NOT'] }),
        solution: "SELECT nombre, ciudad FROM clientes WHERE NOT vip AND (ciudad = 'Sevilla' OR ciudad = 'Valencia');",
        hints: ['`NOT vip` deja los no VIP.', "El paréntesis agrupa las dos ciudades: `(ciudad = 'Sevilla' OR ciudad = 'Valencia')`"],
        explain: '`NOT`, `AND` y `OR` se combinan sin límite; los paréntesis dejan claro el orden.',
        commands: ['AND, OR, NOT'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s2-3', { title: 'IN y BETWEEN', summary: 'Listas y rangos sin repetir condiciones', emoji: '📏', commands: ['IN', 'BETWEEN'], minutes: 8 }, [
      learn(
        'IN: pertenecer a una lista',
        `
Si quieres productos de audio, pantallas o accesorios, escribir tres \`OR\` es pesado. \`IN\` lo resume:

\`\`\`
WHERE categoria IN ('audio', 'pantallas', 'accesorios')
\`\`\`

es lo mismo que \`categoria = 'audio' OR categoria = 'pantallas' OR categoria = 'accesorios'\`. Con \`NOT IN\` pides lo contrario: todo lo que **no** esté en la lista.

> TIP: \`IN\` también funciona con números: \`WHERE id IN (1, 5, 9)\`.
`,
        '📋',
      ),
      learn(
        'BETWEEN: estar dentro de un rango',
        `
\`BETWEEN a AND b\` comprueba si un valor está **entre a y b, incluyendo ambos extremos**:

\`\`\`
WHERE precio BETWEEN 20 AND 60
\`\`\`

es equivalente a \`precio >= 20 AND precio <= 60\`. Sirve para números, fechas y también para textos (por orden alfabético).

> OJO: Los extremos **sí cuentan**. Un producto de exactamente 20 € o de exactamente 60 € entra en el resultado.
`,
        '📏',
      ),
      sqlDemo('Listas y rangos', 'tienda', [
        ["SELECT nombre, categoria FROM productos WHERE categoria IN ('audio', 'pantallas');", 'IN con una lista de textos'],
        ["SELECT nombre, categoria FROM productos WHERE categoria NOT IN ('audio', 'pantallas', 'accesorios');", 'NOT IN: todo lo que no esté en la lista'],
        ['SELECT nombre, precio FROM productos WHERE precio BETWEEN 20 AND 60 ORDER BY precio;', 'BETWEEN con números'],
        ["SELECT id, fecha FROM pedidos WHERE fecha BETWEEN '2024-03-01' AND '2024-03-31';", 'BETWEEN con fechas: los pedidos de marzo, incluido el del día 1'],
      ]),
      mc('`WHERE precio BETWEEN 20 AND 60` incluye un producto que cuesta exactamente 60 €.', ['Sí, los extremos cuentan', 'No, el límite superior se excluye', 'Solo si añades OR', 'Depende del orden de las columnas'], 0, '`BETWEEN` es inclusivo: equivale a `precio >= 20 AND precio <= 60`.'),
      sqlOut('Predice: ¿qué productos entran en el rango?', 'tienda', 'SELECT nombre, precio FROM productos WHERE precio BETWEEN 24.5 AND 39 ORDER BY precio;', ['Hub USB-C | 29.9\nAltavoz portátil | 34.95', 'Ratón inalámbrico | 24.5\nHub USB-C | 29.9\nAltavoz portátil | 34.95', 'Ratón inalámbrico | 24.5\nHub USB-C | 29.9\nAltavoz portátil | 34.95\nWebcam HD | 39.0\nAuriculares Bluetooth | 59.9'], 'Los extremos entran: 24,5 (Ratón) y 39 (Webcam) cuentan. Con ellos son cuatro productos.'),
      order('Ordena: productos de audio o pantallas', ['SELECT', 'nombre', 'FROM', 'productos', 'WHERE', 'categoria', 'IN', "('audio',", "'pantallas');"], "SELECT nombre FROM productos WHERE categoria IN ('audio', 'pantallas');", 'Después de `IN` va la lista entre paréntesis, con los textos separados por comas.'),
      tf('`WHERE id IN (1, 5, 9)` devuelve las filas con id 1, 5 o 9.', true, '`IN` comprueba si el valor es uno de los de la lista.'),
      sqlCode('Muestra el nombre de los productos de las categorías `accesorios` y `audio`.', {
        setup: 'tienda',
        check: same(),
        solution: "SELECT nombre FROM productos WHERE categoria IN ('accesorios', 'audio');",
        hint: "WHERE categoria IN ('accesorios', 'audio')",
        why: '`IN` evita repetir `OR`.',
      }),
      sqlPractice({
        goal: 'Pedidos de marzo',
        prompt: 'Contabilidad pide los **pedidos de marzo de 2024** (del 1 al 31, ambos incluidos).\n\n**Muestra `id`, `fecha` y `estado`.** Usa `BETWEEN`.',
        setup: 'tienda',
        check: same({ names: true, uses: ['BETWEEN'] }),
        solution: "SELECT id, fecha, estado FROM pedidos WHERE fecha BETWEEN '2024-03-01' AND '2024-03-31';",
        hints: ["Las fechas se escriben como texto: '2024-03-01'.", "`WHERE fecha BETWEEN '2024-03-01' AND '2024-03-31'`"],
        explain: '`BETWEEN` incluye los dos extremos, así que el pedido del 1 de marzo entra. Es la forma más cómoda de filtrar periodos.',
        commands: ['BETWEEN'],
      }),
      sqlPractice({
        goal: 'Solo lo que ya salió',
        prompt: 'Quieres ver los pedidos **que no están cancelados ni pendientes**.\n\n**Muestra `id` y `estado`.** Usa `NOT IN`.',
        setup: 'tienda',
        check: same({ names: true, uses: ['NOT IN'] }),
        solution: "SELECT id, estado FROM pedidos WHERE estado NOT IN ('cancelado', 'pendiente');",
        hints: ['Dos estados que excluir: usa una lista.', "`estado NOT IN ('cancelado', 'pendiente')`"],
        explain: '`NOT IN` excluye varios valores de una vez. Quedan los pedidos enviados y entregados.',
        commands: ['IN'],
      }),
      sqlPractice({
        goal: 'Selección de directores',
        prompt: 'En la base de cine, muestra los **directores nacidos entre 1960 y 1972** (ambos incluidos).\n\n**Muestra `nombre` y `nacimiento`, ordenados por año de nacimiento.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, nacimiento FROM directores WHERE nacimiento BETWEEN 1960 AND 1972 ORDER BY nacimiento;',
        hints: ['Un rango con `BETWEEN 1960 AND 1972`.', 'Añade `ORDER BY nacimiento` al final.'],
        explain: 'El rango incluye 1960 (Isabel Coixet) y 1972 (Alejandro Amenábar). Combinar `WHERE` y `ORDER BY` es lo habitual.',
        commands: ['BETWEEN', 'ORDER BY'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s2-4', { title: 'Buscar texto con LIKE', summary: 'Patrones con % y _', emoji: '🔤', commands: ['LIKE'], minutes: 8 }, [
      learn(
        'Cuando no sabes el texto exacto',
        `
\`=\` exige coincidencia **completa**. Para buscar por trozos se usa \`LIKE\` con un **patrón** que tiene dos comodines:

| Comodín | Sustituye a |
| --- | --- |
| \`%\` | **cualquier** cantidad de caracteres (también ninguno) |
| \`_\` | **exactamente un** carácter |

Ejemplos:

- \`'L%'\` → empieza por L
- \`'%ez'\` → termina en ez
- \`'%port%'\` → contiene «port» en cualquier lugar
- \`'_ub%'\` → una letra cualquiera, luego «ub»
`,
        '🔤',
      ),
      sqlDemo('Patrones de texto', 'tienda', [
        ["SELECT nombre FROM clientes WHERE nombre LIKE 'L%';", 'Empieza por L'],
        ["SELECT nombre FROM clientes WHERE nombre LIKE '%ez';", 'Termina en «ez» (los apellidos López, Fernández, Sánchez)'],
        ["SELECT nombre FROM productos WHERE nombre LIKE '%port%';", 'Contiene «port». Fíjate: «Portátil» con P mayúscula no entra'],
        ["SELECT nombre FROM productos WHERE nombre ILIKE '%port%';", 'ILIKE ignora mayúsculas y minúsculas: ahora sí entran los «Portátil»'],
      ]),
      learn(
        'Mayúsculas, NOT LIKE y orden',
        `
- \`LIKE\` **distingue** mayúsculas: \`'%port%'\` no encuentra «Portátil». Usa \`ILIKE\` para ignorarlas, o convierte el texto con \`LOWER(columna) LIKE '%port%'\`.
- \`NOT LIKE\` devuelve las filas que **no** encajan con el patrón.
- Buscar con \`%\` **al principio** del patrón (\`'%port%'\`) es más lento en tablas gigantes: no se puede aprovechar un índice. Lo verás en la zona de rendimiento.
`,
      ),
      mc('¿Qué nombres encajan con el patrón `\'_ar%\'`?', ['Marta y Carmen', 'Solo los que empiezan por «ar»', 'Todos los que contienen «ar»', 'Ninguno'], 0, '`_` es un carácter cualquiera y después debe venir «ar»: **M**arta, **C**armen… (la segunda y tercera letra son «ar»).'),
      sqlOut('Predice: ¿qué productos contienen «port» (con minúscula)?', 'tienda', "SELECT nombre FROM productos WHERE nombre LIKE '%port%';", ['Altavoz portátil', 'Portátil Pro 15\nPortátil Air 13\nAltavoz portátil\nFunda para portátil', 'Portátil Pro 15\nPortátil Air 13'], '`LIKE` distingue mayúsculas: «Portátil Pro 15» tiene la P mayúscula y no coincide con `%port%`.'),
      match(
        'Une el patrón con lo que busca',
        [
          ["'A%'", 'Empieza por A'],
          ["'%a'", 'Termina en a'],
          ["'%an%'", 'Contiene «an»'],
          ["'A__'", 'Una A y exactamente dos caracteres más'],
        ],
        '`%` = cualquier cosa (o nada); `_` = exactamente un carácter.',
      ),
      tf("`WHERE nombre LIKE 'ana'` (sin comodines) encuentra también «Mariana».", false, 'Sin comodines, `LIKE` equivale a `=`: solo encuentra «ana» exacto.'),
      sqlCode('Muestra el nombre de los productos que contienen la palabra `pulgadas`.', {
        setup: 'tienda',
        check: same(),
        solution: "SELECT nombre FROM productos WHERE nombre LIKE '%pulgadas%';",
        hint: "Pon % delante y detrás: '%pulgadas%'",
        why: 'Con `%` a los dos lados, «pulgadas» puede estar en cualquier parte del nombre.',
      }),
      sqlPractice({
        goal: 'Clientes cuyo nombre empieza por L',
        prompt: 'Un cliente recuerda que su nombre «empezaba por L».\n\n**Muestra `nombre` y `ciudad` de los clientes cuyo nombre empiece por L.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, ciudad FROM clientes WHERE nombre LIKE 'L%';",
        hints: ["El patrón es 'L%'.", "`WHERE nombre LIKE 'L%'`"],
        explain: '`L%` significa «una L seguida de lo que sea». Salen Luis, Lucía y Laura.',
        commands: ['LIKE'],
      }),
      sqlPractice({
        goal: 'Títulos de cinco letras',
        prompt: 'Un concurso de cine pide títulos **de exactamente 5 caracteres**.\n\n**Muestra `titulo`.** (Pista: el comodín que sustituye a un solo carácter.)',
        setup: 'cine',
        check: same({ uses: ['LIKE'] }),
        solution: "SELECT titulo FROM peliculas WHERE titulo LIKE '_____';",
        hints: ['El comodín `_` vale por un carácter.', "Cinco guiones bajos: `'_____'`"],
        explain: 'Cada `_` exige un carácter. Cinco de ellos, sin `%`, encajan solo con textos de exactamente cinco letras: «Tesis».',
        commands: ['LIKE'],
      }),
      sqlPractice({
        goal: 'Búsqueda sin importar mayúsculas',
        prompt: 'En el buscador de la tienda el usuario escribe `monitor` en minúsculas.\n\n**Muestra `nombre` y `precio` de los productos cuyo nombre contenga «monitor», sin importar mayúsculas.** Usa `ILIKE`.',
        setup: 'tienda',
        check: same({ names: true, uses: ['ILIKE'] }),
        solution: "SELECT nombre, precio FROM productos WHERE nombre ILIKE '%monitor%';",
        hints: ['`ILIKE` es como `LIKE` pero ignora mayúsculas.', "`nombre ILIKE '%monitor%'`"],
        explain: '`ILIKE` es la forma cómoda de hacer búsquedas «de usuario», donde nadie se preocupa por las mayúsculas.',
        commands: ['LIKE'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s2-5', { title: 'NULL: el valor que no está', summary: 'IS NULL y la lógica de tres valores', emoji: '🕳️', commands: ['IS NULL'], minutes: 9 }, [
      learn(
        'NULL no es cero',
        `
En la tabla \`clientes\`, a Pablo le falta la ciudad. En ese hueco SQL guarda **NULL**: «no hay valor» o «no se sabe». Es muy distinto de:

- **0** (un número real), ni
- **''** (un texto vacío).

Como NULL significa «desconocido», cualquier comparación con él **tampoco se sabe**:

- \`NULL = 'Madrid'\` → desconocido
- \`NULL = NULL\` → desconocido (¡ni siquiera es igual a sí mismo!)
- \`NULL <> 'Madrid'\` → desconocido

Y \`WHERE\` solo deja pasar las filas donde la condición es **verdadera**; si es falsa **o desconocida**, se descarta.
`,
        '🕳️',
      ),
      sqlDemo('Buscar NULL: lo que no funciona y lo que sí', 'tienda', [
        ['SELECT nombre, ciudad FROM clientes WHERE ciudad = NULL;', 'No devuelve nada: «= NULL» nunca es verdadero'],
        ['SELECT nombre, ciudad FROM clientes WHERE ciudad IS NULL;', 'IS NULL es la forma correcta de preguntar «¿no tiene valor?»'],
        ['SELECT nombre, ciudad FROM clientes WHERE ciudad IS NOT NULL;', 'IS NOT NULL: los que sí tienen valor'],
      ]),
      learn(
        'La trampa silenciosa',
        `
Como la condición \`ciudad <> 'Madrid'\` es desconocida para los NULL, **los clientes sin ciudad desaparecen** del resultado aunque «claramente» no vivan en Madrid:

\`\`\`
WHERE ciudad <> 'Madrid'                   -- sin Pablo ni Laura
WHERE ciudad <> 'Madrid' OR ciudad IS NULL -- con ellos
\`\`\`

Lo mismo pasa con \`NOT IN\`. Siempre que una columna admita NULL, piensa: **¿qué quiero hacer con las filas sin valor?**

> CLAVE: Con NULL se usa \`IS NULL\` / \`IS NOT NULL\`, nunca \`=\` ni \`<>\`. Y los NULL se «pierden» en comparaciones: añade su caso a mano si los necesitas.
`,
        '⚠️',
      ),
      sqlDemo('Los NULL desaparecen', 'tienda', [
        ["SELECT nombre, ciudad FROM clientes WHERE ciudad <> 'Madrid';", 'Faltan Pablo y Laura: sus ciudades son NULL'],
        ["SELECT nombre, ciudad FROM clientes WHERE ciudad <> 'Madrid' OR ciudad IS NULL;", 'Con IS NULL añadimos su caso'],
        ['SELECT COUNT(*), COUNT(ciudad) FROM clientes;', 'Adelanto: COUNT(*) cuenta filas (12) y COUNT(ciudad) solo las que tienen valor (10)'],
      ]),
      mc('¿Cuál es la forma correcta de buscar clientes sin ciudad?', ['WHERE ciudad = NULL', "WHERE ciudad = ''", 'WHERE ciudad IS NULL', 'WHERE ciudad == NULL'], 2, 'NULL no se compara con `=`: se pregunta con `IS NULL`.'),
      sqlOut('Predice: ¿a quiénes devuelve `<>` ?', 'tienda', "SELECT nombre FROM clientes WHERE ciudad <> 'Madrid';", ['Luis Martín\nPablo Ruiz\nLucía Fernández\nDiego Sánchez\nCarmen Díaz\nElena Torres\nSergio Navarro\nLaura Gil\nRaúl Ortega', 'Ana García\nMarta López\nJavier Moreno', 'Pablo Ruiz\nLaura Gil'], 'Pablo y Laura (sin ciudad) no aparecen: `NULL <> \'Madrid\'` es desconocido y `WHERE` descarta lo que no es verdadero.'),
      tf('Si dos clientes tienen la ciudad NULL, `ciudad = ciudad` es verdadero para ellos.', false, 'Cualquier comparación con NULL es desconocida, incluso comparado consigo mismo. Para eso existe `IS NULL`.'),
      sqlCode('Muestra el nombre de los clientes que **sí** tienen email registrado.', {
        setup: 'tienda',
        check: same(),
        solution: 'SELECT nombre FROM clientes WHERE email IS NOT NULL;',
        hint: 'IS NOT NULL',
        why: '`IS NOT NULL` deja las filas donde hay un valor.',
      }),
      sqlPractice({
        goal: 'Fichas incompletas',
        prompt: 'Atención al cliente quiere completar datos: busca a los clientes **sin ciudad registrada**.\n\n**Muestra `id`, `nombre` y `email`.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT id, nombre, email FROM clientes WHERE ciudad IS NULL;',
        hints: ['No se puede usar `=` con NULL.', '`WHERE ciudad IS NULL`'],
        explain: '`IS NULL` es la única forma correcta de buscar valores ausentes.',
        commands: ['IS NULL'],
      }),
      sqlPractice({
        goal: 'Notas pendientes',
        prompt: 'En la base de la escuela, algunas matrículas aún **no tienen nota**.\n\n**Muestra `alumno_id` y `asignatura_id` de las matrículas sin nota.**',
        setup: 'escuela',
        check: same({ names: true }),
        solution: 'SELECT alumno_id, asignatura_id FROM matriculas WHERE nota IS NULL;',
        hints: ['La tabla es `matriculas`.', '`WHERE nota IS NULL`'],
        explain: 'Una nota «todavía sin poner» es NULL, no 0: un 0 sería un suspenso real.',
        commands: ['IS NULL'],
      }),
      sqlPractice({
        goal: 'Estrenos con nota',
        prompt: 'Quieres las películas **posteriores a 2020 que ya tienen puntuación** (las que aún no se han valorado no interesan).\n\n**Muestra `titulo`, `anio` y `puntuacion`.**',
        setup: 'cine',
        check: same({ names: true, uses: ['IS NOT NULL'] }),
        solution: 'SELECT titulo, anio, puntuacion FROM peliculas WHERE anio > 2020 AND puntuacion IS NOT NULL;',
        hints: ['Dos condiciones unidas con AND.', '`puntuacion IS NOT NULL`'],
        explain: 'Combinar condiciones normales con `IS NULL` / `IS NOT NULL` es muy frecuente al limpiar datos.',
        commands: ['IS NULL', 'AND, OR, NOT'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: la campaña VIP',
    prompt:
      'Marketing lanza una campaña de bienvenida para clientes VIP. Los requisitos:\n\n- Son clientes **VIP**.\n- Viven en **Madrid o Barcelona**.\n- Se dieron de alta **el 1 de marzo de 2023 o después**.\n- Tienen **email** registrado.\n\n**Muestra `nombre`, `ciudad` y `email`, ordenados por nombre.**',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: "SELECT nombre, ciudad, email FROM clientes WHERE vip AND ciudad IN ('Madrid', 'Barcelona') AND fecha_alta >= '2023-03-01' AND email IS NOT NULL ORDER BY nombre;",
    hints: ['Cuatro condiciones unidas con AND.', "Para las ciudades usa IN ('Madrid', 'Barcelona')."],
    explain: 'Booleanos, listas, comparaciones de fecha y NULL en una sola consulta. Con `WHERE` ya puedes responder casi cualquier «dame solo los que…». ¡Zona completada!',
    commands: ['WHERE', 'AND, OR, NOT', 'IN', 'IS NULL'],
  },
});
