import { fill, learn, lesson, mc, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s3 = sqlWorld({
  id: 's3',
  index: 3,
  title: 'Transformar valores',
  subtitle: 'Funciones, fechas y condiciones dentro del SELECT',
  emoji: '🪄',
  color: '#22D3A6',
  level: 'basico',
  intro:
    'Los datos casi nunca vienen como los quieres mostrar: nombres en minúsculas, precios con diez decimales, fechas que hay que convertir, huecos que rellenar. Las funciones de SQL son tu caja de herramientas: cambian y calculan valores fila a fila sin tocar la tabla. Con `CASE` además podrás tomar decisiones dentro de la propia consulta, igual que un `if`.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s3-1', { title: 'Funciones de texto', summary: 'UPPER, LOWER, LENGTH, SUBSTR, TRIM y REPLACE', emoji: '🔤', commands: ['UPPER / LOWER', 'LENGTH', 'SUBSTR', 'TRIM', 'REPLACE'], minutes: 9 }, [
      learn(
        'Qué es una función',
        `
Una **función** recibe uno o varios valores, hace algo con ellos y **devuelve un resultado**. Se escribe con su nombre y los argumentos entre paréntesis:

\`\`\`
UPPER(nombre)        -- convierte a mayúsculas
LENGTH(nombre)       -- cuántos caracteres tiene
\`\`\`

Se aplican **fila a fila**: en cada fila usan los valores de esa fila. Son temporales: **no modifican** la tabla, solo el resultado. Y se pueden **anidar**: \`UPPER(TRIM(nombre))\` primero quita espacios y después pasa a mayúsculas.

> CLAVE: Si no recuerdas una función, ¡la biblioteca de la pestaña Practicar tiene una ficha de cada una con ejemplos!
`,
        '🧰',
      ),
      sqlDemo('Mayúsculas, minúsculas y longitud', 'tienda', [
        ['SELECT nombre, UPPER(nombre) AS mayusculas, LOWER(nombre) AS minusculas FROM clientes LIMIT 3;', 'UPPER y LOWER cambian las mayúsculas'],
        ['SELECT nombre, LENGTH(nombre) AS letras FROM productos ORDER BY LENGTH(nombre) DESC LIMIT 3;', 'LENGTH cuenta caracteres, y también se puede usar para ordenar'],
        ["SELECT nombre FROM productos WHERE LOWER(nombre) LIKE '%portátil%';", 'Combinar con LIKE para ignorar mayúsculas (otra forma de hacer lo que hace ILIKE)'],
      ]),
      mc('¿Cuánto devuelve `LENGTH(\'SQL\')`?', ['1', '3', '4', 'SQL'], 1, '`LENGTH` cuenta los caracteres del texto: S, Q y L son 3.'),
      learn(
        'Cortar texto: SUBSTR',
        `
\`SUBSTR(texto, inicio, largo)\` devuelve un trozo del texto:

- **inicio**: la posición del primer carácter. ¡Empieza en **1**, no en 0!
- **largo**: cuántos caracteres. Si lo omites, llega hasta el final.

\`\`\`
SUBSTR('Base de datos', 1, 4)   → 'Base'
SUBSTR('Base de datos', 6)      → 'de datos'
\`\`\`

Otras funciones muy útiles: \`LEFT(texto, n)\` y \`RIGHT(texto, n)\` (los n primeros o últimos caracteres) e \`INSTR(texto, buscado)\`, que dice **en qué posición** aparece algo (o 0 si no está).
`,
        '✂️',
      ),
      sqlDemo('Cortar y buscar', 'tienda', [
        ['SELECT nombre, SUBSTR(nombre, 1, 3) AS inicio FROM clientes LIMIT 3;', 'Los tres primeros caracteres'],
        ["SELECT nombre, INSTR(nombre, ' ') AS pos_espacio FROM clientes LIMIT 3;", 'Dónde está el primer espacio'],
        ["SELECT nombre, SUBSTR(nombre, 1, INSTR(nombre, ' ') - 1) AS nombre_pila FROM clientes LIMIT 3;", 'Combinadas: todo lo que hay antes del primer espacio (el nombre de pila)'],
      ]),
      sqlOut('Predice el resultado', 'tienda', "SELECT SUBSTR('Base de datos', 1, 4), SUBSTR('Base de datos', 6), LENGTH('Base de datos');", ['Base | de datos | 12', 'ase | e datos | 13', 'Base | datos | 13'], '`SUBSTR(…, 1, 4)` toma 4 caracteres desde el primero («Base»); `SUBSTR(…, 6)` desde el sexto hasta el final («de datos»). El texto completo tiene 13 caracteres, contando los espacios.'),
      learn(
        'Limpiar y reemplazar',
        `
- \`TRIM(texto)\` quita los **espacios** del principio y del final (\`LTRIM\` solo por la izquierda, \`RTRIM\` por la derecha). Imprescindible con datos escritos a mano.
- \`REPLACE(texto, buscado, nuevo)\` cambia **todas** las apariciones de un trozo por otro.
- \`CONCAT(a, b, …)\` une textos como \`||\`, pero **ignora los NULL** en lugar de contagiarlos.
`,
        '🧹',
      ),
      sqlDemo('Limpieza de datos', 'tienda', [
        ["SELECT TRIM('   hola   ') AS limpio, LENGTH('   hola   ') AS antes, LENGTH(TRIM('   hola   ')) AS despues;", 'TRIM quita los espacios de los lados'],
        ["SELECT email, REPLACE(email, '@mail.com', '@tienda.es') AS nuevo FROM clientes WHERE email IS NOT NULL LIMIT 3;", 'REPLACE cambia un trozo por otro'],
      ]),
      tf('`SUBSTR(\'Hola\', 0, 2)` y `SUBSTR(\'Hola\', 1, 2)` son lo mismo porque el primer carácter es el 0.', false, 'En SQL el primer carácter es el 1, no el 0. Con inicio 0 el trozo se corre una posición.'),
      fill('Completa: pon el nombre en mayúsculas', 'SELECT ___(nombre) FROM clientes;', ['UPPER', 'LOWER', 'LENGTH', 'TRIM'], ['UPPER'], '`UPPER` convierte todo a mayúsculas. `LOWER` haría lo contrario.'),
      sqlCode('Muestra el nombre de cada cliente en MAYÚSCULAS, con el alias `nombre_mayus`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT UPPER(nombre) AS nombre_mayus FROM clientes;',
        hint: 'UPPER(nombre) AS nombre_mayus',
        why: 'La función se aplica a cada fila y el alias le da nombre a la columna.',
      }),
      sqlPractice({
        goal: 'Nombres largos',
        prompt: 'Para un cartel necesitas saber cuántos caracteres tienen los nombres de los productos.\n\n**Muestra `nombre` y su longitud como `letras`, ordenados de más largo a más corto, y solo los 3 primeros.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, LENGTH(nombre) AS letras FROM productos ORDER BY letras DESC LIMIT 3;',
        hints: ['`LENGTH(nombre)` con el alias `letras`.', 'Puedes ordenar por el alias: `ORDER BY letras DESC`.'],
        explain: 'Una función puede estar en el `SELECT` y su alias se puede usar en el `ORDER BY`.',
        commands: ['LENGTH', 'ORDER BY'],
      }),
      sqlPractice({
        goal: 'Códigos de producto',
        prompt: 'Almacén quiere un código para cada producto con este formato: **las 3 primeras letras de la categoría en MAYÚSCULAS, un guion y el id** (por ejemplo `PER-1`).\n\n**Muestra `codigo` y `nombre`.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT UPPER(SUBSTR(categoria, 1, 3)) || '-' || id AS codigo, nombre FROM productos;",
        hints: ['`SUBSTR(categoria, 1, 3)` da las tres primeras letras.', "Une las piezas con `||`: `... || '-' || id`"],
        explain: 'Anidar funciones (`UPPER(SUBSTR(...))`) y unir con `||` es la base para generar códigos y etiquetas. Fíjate en que `||` convierte el número `id` en texto automáticamente.',
        commands: ['SUBSTR', 'UPPER / LOWER', 'Concatenar ||'],
      }),
      sqlPractice({
        goal: 'Cambio de dominio',
        prompt: 'La tienda estrena dominio. Los emails pasan de `@mail.com` a `@tienda.es`.\n\n**Muestra `nombre` y el email nuevo como `email_nuevo`** (solo para clientes que tengan email).',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, REPLACE(email, '@mail.com', '@tienda.es') AS email_nuevo FROM clientes WHERE email IS NOT NULL;",
        hints: ['`REPLACE(texto, buscado, nuevo)`.', 'Filtra los que tienen email con `IS NOT NULL`.'],
        explain: '`REPLACE` hace el cambio en el resultado; la tabla sigue igual. Para cambiarla de verdad harías un `UPDATE` (lo verás más adelante).',
        commands: ['REPLACE'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s3-2', { title: 'Funciones numéricas', summary: 'ROUND, ABS, CEIL y FLOOR', emoji: '🔢', commands: ['ROUND', 'ABS', 'CEIL / FLOOR'], minutes: 8 }, [
      learn(
        'Redondear',
        `
Al multiplicar precios por 1,21 salen decimales raros: \`96.679\`, \`193.5879\`… \`ROUND(número, decimales)\` redondea al número de decimales que indiques:

\`\`\`
ROUND(96.679, 2)    → 96.68
ROUND(96.679)       → 97     (sin decimales)
ROUND(1234.5, -2)   → 1200   (decimales negativos: a centenas)
\`\`\`

Si el decimal siguiente es 5 o más, redondea **hacia arriba**.

> TIP: Redondea siempre al **final** de una cadena de cálculos, no entre medias, para no acumular errores.
`,
        '🎯',
      ),
      sqlDemo('Antes y después de redondear', 'tienda', [
        ['SELECT nombre, precio * 1.21 AS sin_redondear, ROUND(precio * 1.21, 2) AS con_iva FROM productos LIMIT 4;', 'Con ROUND(…, 2) los precios quedan en céntimos'],
        ['SELECT nombre, precio, ROUND(precio) AS al_euro, CEIL(precio) AS hacia_arriba, FLOOR(precio) AS hacia_abajo FROM productos LIMIT 4;', 'ROUND al más cercano; CEIL siempre hacia arriba; FLOOR siempre hacia abajo'],
      ]),
      learn(
        'Valor absoluto y compañía',
        `
- \`ABS(x)\` devuelve el valor **absoluto** (sin signo): \`ABS(-50)\` → 50. Útil para distancias o para mostrar «gastos» como cantidades positivas.
- \`CEIL(x)\` redondea siempre **hacia arriba**; \`FLOOR(x)\` siempre **hacia abajo**. Por ejemplo, para calcular cuántas cajas hacen falta: \`CEIL(unidades / 12.0)\`.
- \`x % y\` es el **resto**; \`POWER(x, y)\` eleva; \`SQRT(x)\` la raíz cuadrada; \`SIGN(x)\` da -1, 0 o 1.
- \`GREATEST(a, b, …)\` y \`LEAST(a, b, …)\` devuelven el mayor / menor de **una fila** (no de una columna: eso es \`MAX\` / \`MIN\`, que verás en el resumen de datos).
`,
      ),
      sqlDemo('Gastos e ingresos', 'banco', [
        ['SELECT concepto, importe, ABS(importe) AS cantidad FROM movimientos;', 'ABS quita el signo'],
        ['SELECT concepto, importe, CASE WHEN importe < 0 THEN ABS(importe) END AS gasto FROM movimientos;', 'Un adelanto de CASE: solo mostramos los gastos como números positivos'],
      ]),
      mc('¿Qué devuelve `ROUND(7.5)`?', ['7', '8', '7.5', '75'], 1, '`ROUND` redondea al entero más cercano y con .5 sube: 8 (en este motor se muestra `8.0`, pues el valor es decimal).'),
      sqlOut('Predice el resultado', 'tienda', 'SELECT ROUND(2.5), ROUND(1234.567, 1), CEIL(4.1), FLOOR(4.9), ABS(-7);', ['2.0 | 1234.57 | 5.0 | 5.0 | 7', '3.0 | 1234.6 | 4.0 | 5.0 | 7', '3.0 | 1234.6 | 4.0 | 4.0 | -7'], '`ROUND(2.5)` sube a 3, `ROUND(…, 1)` deja un decimal, `CEIL` sube siempre (5), `FLOOR` baja siempre (4) y `ABS` quita el signo.'),
      tf('`CEIL(4.01)` devuelve 4.', false, '`CEIL` redondea **siempre hacia arriba**: 4.01 pasa a 5.'),
      sqlCode('Muestra el nombre y el precio con IVA (×1,21) redondeado a 2 decimales, como `precio_iva`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, ROUND(precio * 1.21, 2) AS precio_iva FROM productos;',
        hint: 'ROUND(precio * 1.21, 2)',
        why: '`ROUND(…, 2)` deja dos decimales: así se muestran los precios.',
      }),
      sqlPractice({
        goal: 'Rebajas del 15 %',
        prompt: 'Arrancan las rebajas con un **15 % de descuento**.\n\n**Muestra `nombre`, `precio` y el precio rebajado como `precio_rebaja` (precio × 0,85, redondeado a 2 decimales), solo para productos de más de 100 €.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT nombre, precio, ROUND(precio * 0.85, 2) AS precio_rebaja FROM productos WHERE precio > 100;',
        hints: ['Multiplicar por 0.85 aplica un 15 % de descuento.', 'El `WHERE precio > 100` filtra antes de calcular.'],
        explain: 'Cálculo + `ROUND` + `WHERE`: el patrón de cualquier informe de precios.',
        commands: ['ROUND', 'Operadores aritméticos'],
      }),
      sqlPractice({
        goal: 'Cuánto se ha gastado',
        prompt: 'En el banco, los gastos tienen importe negativo.\n\n**Muestra `concepto` y la cantidad gastada en positivo como `gastado`, solo para los movimientos negativos.**',
        setup: 'banco',
        check: same({ names: true }),
        solution: 'SELECT concepto, ABS(importe) AS gastado FROM movimientos WHERE importe < 0;',
        hints: ['Filtra los importes menores que 0.', '`ABS(importe)` quita el signo.'],
        explain: '`ABS` es perfecto para mostrar magnitudes sin signo. El filtro garantiza que solo salen gastos.',
        commands: ['ABS'],
      }),
      sqlPractice({
        goal: 'Cajas necesarias',
        prompt: 'Los productos se envían en cajas de **5 unidades**.\n\n**Muestra `nombre`, `stock` y las cajas necesarias para enviar todo el stock como `cajas`** (`CEIL(stock / 5.0)`), solo de los productos con stock mayor que 0, ordenados por cajas de mayor a menor y luego por nombre.',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['CEIL'] }),
        solution: 'SELECT nombre, stock, CEIL(stock / 5.0) AS cajas FROM productos WHERE stock > 0 ORDER BY cajas DESC, nombre;',
        hints: ['Divide por `5.0` para no perder decimales.', '`CEIL` redondea hacia arriba: 7 unidades necesitan 2 cajas.'],
        explain: 'Dividir por `5.0` evita la división entera y `CEIL` garantiza que una caja a medias cuente como una caja entera.',
        commands: ['CEIL / FLOOR'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s3-3', { title: 'Fechas y horas', summary: 'Extraer partes, sumar días y dar formato', emoji: '📅', commands: ['Fechas y horas', 'EXTRACT', 'strftime'], minutes: 9 }, [
      learn(
        'Las fechas también son datos',
        `
SQL tiene tipos propios para fechas: \`DATE\` (\`2024-03-15\`) y \`TIMESTAMP\` (fecha con hora, \`2024-03-15 18:30:00\`). Se escriben **como texto en formato año-mes-día**, y por eso ordenan bien alfabéticamente.

Valores útiles:

- \`CURRENT_DATE\` → la fecha de hoy. \`NOW()\` → fecha y hora ahora.
- Se puede **sumar o restar días**: \`fecha + 7\`, \`fecha - 1\`.
- **Restar dos fechas** da el número de días entre ellas.

> NOTA: Para que tus resultados sean siempre los mismos, en este curso «hoy» está fijado en el **15 de junio de 2025**.
`,
        '📅',
      ),
      sqlDemo('Hoy y aritmética de fechas', 'tienda', [
        ['SELECT CURRENT_DATE AS hoy, NOW() AS ahora;', 'La fecha y la hora actuales (fijadas en el curso)'],
        ['SELECT id, fecha, fecha + 5 AS entrega_estimada FROM pedidos LIMIT 3;', 'Sumar días a una fecha'],
        ['SELECT nombre, fecha_alta, CURRENT_DATE - fecha_alta AS dias_de_cliente FROM clientes ORDER BY dias_de_cliente DESC LIMIT 3;', 'Restar fechas: cuántos días lleva cada cliente con nosotros'],
      ]),
      learn(
        'Sacar partes de una fecha',
        `
Para agrupar o filtrar por año, mes o día de la semana necesitas **extraer** esa parte:

\`\`\`
EXTRACT(YEAR FROM fecha)      → 2024
EXTRACT(MONTH FROM fecha)     → 3
strftime('%Y-%m', fecha)      → '2024-03'   (año y mes juntos)
strftime('%d/%m/%Y', fecha)   → '15/03/2024' (como se escribe en España)
\`\`\`

\`strftime\` usa códigos: \`%Y\` año, \`%m\` mes, \`%d\` día, \`%H\` hora, \`%w\` día de la semana (0 = domingo). Existen \`TO_CHAR\` y \`DATE_TRUNC\` con la misma función en otros motores.
`,
        '🔎',
      ),
      sqlDemo('Partes de una fecha', 'tienda', [
        ['SELECT nombre, fecha_alta, EXTRACT(YEAR FROM fecha_alta) AS anio, EXTRACT(MONTH FROM fecha_alta) AS mes FROM clientes LIMIT 3;', 'Año y mes por separado'],
        ["SELECT id, fecha, strftime('%Y-%m', fecha) AS mes, strftime('%d/%m/%Y', fecha) AS en_espanol FROM pedidos LIMIT 3;", 'Año-mes (muy útil para agrupar) y formato español'],
        ["SELECT DATE('2024-03-15', '+1 month') AS el_mes_que_viene, DATE('2024-03-15', '-7 days') AS hace_una_semana;", 'DATE con modificadores: sumar meses o restar días'],
      ]),
      mc('¿Qué devuelve `EXTRACT(YEAR FROM \'2024-03-15\')`?', ['2024-03', '2024', '15', '03'], 1, '`EXTRACT(YEAR FROM …)` devuelve solo el año.'),
      sqlOut('Predice el resultado', 'tienda', "SELECT strftime('%Y-%m', '2024-03-15'), strftime('%d/%m/%Y', '2024-03-15'), DATE('2024-03-15', '+10 days');", ['2024-03-15 | 2024 | 2024-03-25', '2024-03 | 03/15/2024 | 2024-03-25', '2024-03 | 15/03/2024 | 2024-03-15'], '`%Y-%m` da año y mes; `%d/%m/%Y` el formato español; y `DATE(…, \'+10 days\')` avanza 10 días: 15 + 10 = 25 de marzo.'),
      tf('Restar dos fechas devuelve el número de días que hay entre ellas.', true, '`fecha2 - fecha1` da la diferencia en días, por ejemplo `CURRENT_DATE - fecha_alta`.'),
      sqlCode('Muestra los pedidos (`id` y `fecha`) hechos en 2024 usando `EXTRACT(YEAR FROM ...)`.', {
        setup: 'tienda',
        check: same({ uses: ['EXTRACT'] }),
        solution: 'SELECT id, fecha FROM pedidos WHERE EXTRACT(YEAR FROM fecha) = 2024;',
        hint: 'WHERE EXTRACT(YEAR FROM fecha) = 2024',
        why: 'Se extrae el año de cada fecha y se compara con 2024.',
      }),
      sqlPractice({
        goal: 'Antigüedad de los clientes',
        prompt: 'RR. HH. de la tienda quiere saber desde cuándo conocemos a cada cliente.\n\n**Muestra `nombre` y los días que lleva como cliente hasta hoy como `dias` (`CURRENT_DATE - fecha_alta`), de más antiguo a más reciente.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT nombre, CURRENT_DATE - fecha_alta AS dias FROM clientes ORDER BY dias DESC;',
        hints: ['Restar fechas da días.', 'El más antiguo es el que tiene más días: `ORDER BY dias DESC`.'],
        explain: 'Aritmética de fechas: la resta devuelve el número de días. Con `CURRENT_DATE` las consultas se mantienen siempre actualizadas.',
        commands: ['Fechas y horas'],
      }),
      sqlPractice({
        goal: 'Pedidos por mes',
        prompt: 'Contabilidad quiere agrupar los pedidos por mes.\n\n**Muestra `id` y el mes del pedido en formato `AAAA-MM` como `mes`, ordenados por fecha y luego por id.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['strftime'] }),
        solution: "SELECT id, strftime('%Y-%m', fecha) AS mes FROM pedidos ORDER BY fecha, id;",
        hints: ["El código para año-mes es '%Y-%m'.", "`strftime('%Y-%m', fecha)`"],
        explain: '`strftime(\'%Y-%m\', fecha)` es la receta clásica para agrupar por mes: lo usarás mucho cuando llegues a `GROUP BY`.',
        commands: ['strftime'],
      }),
      sqlPractice({
        goal: 'Clientes nuevos del año',
        prompt: 'Los clientes que se dieron de alta **en 2023, a partir de octubre (inclusive)** reciben un regalo.\n\n**Muestra `nombre` y `fecha_alta`.** Usa `EXTRACT` para año y mes.',
        setup: 'tienda',
        check: same({ names: true, uses: ['EXTRACT'] }),
        solution: 'SELECT nombre, fecha_alta FROM clientes WHERE EXTRACT(YEAR FROM fecha_alta) = 2023 AND EXTRACT(MONTH FROM fecha_alta) >= 10;',
        hints: ['Una condición para el año y otra para el mes.', '`EXTRACT(MONTH FROM fecha_alta) >= 10`'],
        explain: 'Descomponer la fecha con `EXTRACT` permite filtrar por trozos: año, mes, día… Combínalos con `AND`.',
        commands: ['EXTRACT'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s3-4', { title: 'CASE: decidir dentro de la consulta', summary: 'El «if» de SQL', emoji: '🔀', commands: ['CASE'], minutes: 9 }, [
      learn(
        'Un if dentro del SELECT',
        `
A veces el valor que quieres mostrar depende de una condición: «barato / medio / caro», «aprobado / suspenso»… Para eso existe \`CASE\`:

\`\`\`
SELECT nombre, precio,
       CASE
         WHEN precio < 30  THEN 'barato'
         WHEN precio < 300 THEN 'medio'
         ELSE 'caro'
       END AS gama
FROM productos;
\`\`\`

Se evalúan los \`WHEN\` **de arriba abajo**; el primero que se cumple decide el resultado. Si ninguno se cumple se usa el \`ELSE\` (y si no hay \`ELSE\`, el resultado es \`NULL\`). Termina siempre con \`END\`.
`,
        '🔀',
      ),
      sqlDemo('Clasificar productos', 'tienda', [
        ["SELECT nombre, precio, CASE WHEN precio < 30 THEN 'barato' WHEN precio < 300 THEN 'medio' ELSE 'caro' END AS gama FROM productos;", 'Cada fila recibe la etiqueta del primer WHEN que cumple'],
        ["SELECT id, estado, CASE estado WHEN 'entregado' THEN 'Completado' WHEN 'cancelado' THEN 'Cancelado' ELSE 'En curso' END AS situacion FROM pedidos LIMIT 6;", 'Forma corta: CASE columna WHEN valor THEN …, para comparar con valores exactos'],
      ]),
      learn(
        'El orden importa (y NULL también)',
        `
Como gana **el primer** \`WHEN\` que se cumple, ordénalos de lo más específico a lo más general. Si pusieras \`WHEN precio < 300\` antes que \`WHEN precio < 30\`, los baratos serían «medio».

Cuidado con NULL: \`nota >= 5\` es desconocido si la nota es NULL, así que **cae al \`ELSE\`**. Una matrícula sin nota saldría como «Suspenso»… ¡qué injusticia! Soluciona esto con un primer \`WHEN nota IS NULL THEN 'Sin nota'\`.

\`CASE\` puede ir en \`SELECT\`, en \`ORDER BY\`, en \`WHERE\`… en cualquier sitio donde pueda ir un valor.
`,
        '⚠️',
      ),
      sqlDemo('Notas con letra', 'escuela', [
        ["SELECT alumno_id, nota, CASE WHEN nota >= 9 THEN 'Sobresaliente' WHEN nota >= 7 THEN 'Notable' WHEN nota >= 5 THEN 'Aprobado' ELSE 'Suspenso' END AS calificacion FROM matriculas WHERE alumno_id IN (4, 10);", 'Fíjate en las notas NULL: caen en «Suspenso»'],
        ["SELECT alumno_id, nota, CASE WHEN nota IS NULL THEN 'Sin nota' WHEN nota >= 9 THEN 'Sobresaliente' WHEN nota >= 7 THEN 'Notable' WHEN nota >= 5 THEN 'Aprobado' ELSE 'Suspenso' END AS calificacion FROM matriculas WHERE alumno_id IN (4, 10);", 'Con un primer WHEN para NULL, queda justo'],
      ]),
      mc('En un `CASE`, si dos `WHEN` se cumplen a la vez, ¿cuál se usa?', ['El último', 'El primero que aparece', 'Los dos, separados por coma', 'Da un error'], 1, 'Se evalúan en orden y gana el primero que se cumple: por eso hay que ponerlos de lo más específico a lo más general.'),
      sqlOut('Predice: ¿qué gama sale?', 'tienda', "SELECT nombre, CASE WHEN precio < 30 THEN 'barato' WHEN precio < 300 THEN 'medio' ELSE 'caro' END FROM productos WHERE id IN (2, 5, 8);", ['Ratón inalámbrico | barato\nPortátil Pro 15 | caro\nAltavoz portátil | barato', 'Ratón inalámbrico | medio\nPortátil Pro 15 | caro\nAltavoz portátil | barato', 'Ratón inalámbrico | medio\nPortátil Pro 15 | caro\nAltavoz portátil | medio'], 'Ratón: 24,5 < 30 → barato. Portátil Pro: 1299 → ninguno de los dos primeros → caro. Altavoz: 34,95 no es < 30, pero sí < 300 → medio.'),
      tf('Si ningún `WHEN` se cumple y no hay `ELSE`, el resultado del `CASE` es NULL.', true, 'Sin `ELSE` y sin coincidencias, `CASE` devuelve NULL.'),
      sqlCode('Muestra `nombre` y una columna `disponibilidad` que valga `\'agotado\'` si el stock es 0 y `\'disponible\'` en otro caso.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, CASE WHEN stock = 0 THEN 'agotado' ELSE 'disponible' END AS disponibilidad FROM productos;",
        hint: "CASE WHEN stock = 0 THEN 'agotado' ELSE 'disponible' END",
        why: 'Un `CASE` con un solo `WHEN` y un `ELSE` es el «if / else» más sencillo.',
      }),
      sqlPractice({
        goal: 'Etiquetar precios',
        prompt: 'Para la web, clasifica los productos:\n\n- `barato`: menos de 30 €\n- `medio`: de 30 a menos de 300 €\n- `caro`: 300 € o más\n\n**Muestra `nombre`, `precio` y la clasificación como `gama`.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, precio, CASE WHEN precio < 30 THEN 'barato' WHEN precio < 300 THEN 'medio' ELSE 'caro' END AS gama FROM productos;",
        hints: ['Ordena los WHEN de lo más pequeño a lo más grande.', '`ELSE` recoge todo lo demás.'],
        explain: 'Un solo `CASE` convierte números en categorías legibles. Este patrón se usa constantemente en informes.',
        commands: ['CASE'],
      }),
      sqlPractice({
        goal: 'Boletín de notas',
        prompt: 'Genera el boletín de la escuela. Para cada matrícula:\n\n- `Sin nota` si no tiene nota\n- `Sobresaliente` (9 o más), `Notable` (7 o más), `Aprobado` (5 o más) y `Suspenso` (menos de 5)\n\n**Muestra `alumno_id`, `asignatura_id` y la calificación como `calificacion`.**',
        setup: 'escuela',
        check: same({ names: true }),
        solution: "SELECT alumno_id, asignatura_id, CASE WHEN nota IS NULL THEN 'Sin nota' WHEN nota >= 9 THEN 'Sobresaliente' WHEN nota >= 7 THEN 'Notable' WHEN nota >= 5 THEN 'Aprobado' ELSE 'Suspenso' END AS calificacion FROM matriculas;",
        hints: ['El primer WHEN debe tratar el caso NULL.', 'Después ordena de nota alta a baja.'],
        explain: 'El caso NULL va **primero**: si no, caería en el `ELSE`. Pensar en los NULL es una de las costumbres más valiosas al escribir SQL.',
        commands: ['CASE', 'IS NULL'],
      }),
      sqlPractice({
        goal: 'Estados de pedido',
        prompt: 'El panel de pedidos debe mostrar un texto más amable:\n\n- `entregado` → `Completado`\n- `cancelado` → `Cancelado`\n- cualquier otro → `En curso`\n\n**Muestra `id` y el texto como `situacion`**, ordenado por id.',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT id, CASE estado WHEN 'entregado' THEN 'Completado' WHEN 'cancelado' THEN 'Cancelado' ELSE 'En curso' END AS situacion FROM pedidos ORDER BY id;",
        hints: ['Puedes usar la forma corta: `CASE estado WHEN … THEN …`.', 'El `ELSE` agrupa «enviado» y «pendiente».'],
        explain: 'La forma corta compara una misma columna con varios valores exactos; la larga (`CASE WHEN condición`) permite condiciones cualesquiera.',
        commands: ['CASE'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s3-5', { title: 'Huecos y tipos', summary: 'COALESCE, NULLIF y CAST', emoji: '🧩', commands: ['COALESCE', 'NULLIF', 'CAST'], minutes: 9 }, [
      learn(
        'Rellenar huecos con COALESCE',
        `
\`COALESCE(a, b, c, …)\` devuelve **el primer valor que no sea NULL**. Es la forma estándar de poner un valor por defecto:

\`\`\`
COALESCE(ciudad, 'sin ciudad')
\`\`\`

Si \`ciudad\` tiene valor, lo devuelve; si es NULL, devuelve el texto. También arregla las concatenaciones que se contagiaban de NULL:

\`\`\`
nombre || ' vive en ' || COALESCE(ciudad, 'un sitio por descubrir')
\`\`\`
`,
        '🧩',
      ),
      sqlDemo('Valores por defecto', 'tienda', [
        ["SELECT nombre, COALESCE(ciudad, 'sin ciudad') AS ciudad, COALESCE(email, 'sin email') AS email FROM clientes WHERE ciudad IS NULL OR email IS NULL;", 'COALESCE sustituye los NULL por un texto'],
        ["SELECT nombre || ' vive en ' || COALESCE(ciudad, 'un sitio por descubrir') AS frase FROM clientes WHERE ciudad IS NULL;", 'Sin COALESCE, esta frase sería NULL'],
      ]),
      learn(
        'NULLIF: convertir en NULL a propósito',
        `
\`NULLIF(a, b)\` devuelve **NULL si a es igual a b**; si no, devuelve a. Parece raro, pero resuelve un problema clásico: **dividir entre cero** provoca un error, mientras que dividir entre NULL da NULL (sin error):

\`\`\`
SELECT 10 / 0;                 -- ERROR
SELECT 10 / NULLIF(0, 0);      -- NULL
\`\`\`

Así, \`precio / NULLIF(stock, 0)\` es seguro aunque haya productos sin stock.
`,
        '🛡️',
      ),
      sqlDemo('Evitar la división por cero', 'tienda', [
        sqlErr('SELECT 10 / 0;', 'Dividir entre cero es un error. El mensaje ya sugiere la solución'),
        ['SELECT nombre, stock, precio / NULLIF(stock, 0) AS precio_por_unidad FROM productos WHERE stock < 10;', 'Con NULLIF, el producto sin stock devuelve NULL en lugar de romper la consulta'],
      ]),
      learn(
        'CAST: cambiar de tipo',
        `
\`CAST(valor AS tipo)\` convierte un valor a otro tipo: \`INTEGER\`, \`REAL\`, \`TEXT\`, \`DATE\`…

\`\`\`
CAST('42' AS INTEGER) + 1       → 43
CAST(7 AS REAL) / 2             → 3.5
CAST(paginas AS TEXT) || ' págs.'
CAST('2024-05-01' AS DATE)
\`\`\`

Si el valor no se puede convertir (\`CAST('abc' AS INTEGER)\`) da error. Es la herramienta para arreglar columnas guardadas con el tipo equivocado (números escritos como texto, por ejemplo).
`,
        '🔁',
      ),
      sqlDemo('Convertir tipos', 'tienda', [
        ["SELECT CAST('42' AS INTEGER) + 1 AS suma, CAST(7 AS REAL) / 2 AS mitad, CAST(42 AS TEXT) || '!' AS texto;", 'Texto a número, entero a decimal y número a texto'],
        sqlErr("SELECT CAST('abc' AS INTEGER);", 'Si el texto no tiene forma de número, la conversión falla'),
      ]),
      mc('¿Qué devuelve `COALESCE(NULL, NULL, \'c\', \'d\')`?', ['NULL', "'c'", "'d'", 'Un error'], 1, 'Devuelve el primer valor que no es NULL: `\'c\'`.'),
      sqlOut('Predice el resultado', 'tienda', "SELECT COALESCE(NULL, 'a'), NULLIF(5, 5), NULLIF(5, 6), CAST('7' AS INTEGER) * 2;", ['a | 5 | 5 | 14', 'a | NULL | 6 | 14', 'NULL | NULL | 6 | 77'], '`COALESCE` salta el NULL y da «a»; `NULLIF(5, 5)` da NULL porque son iguales; `NULLIF(5, 6)` da 5; y `CAST` convierte el texto «7» en el número 7 antes de multiplicar.'),
      tf('`NULLIF(a, b)` devuelve NULL siempre que `a` sea distinto de `b`.', false, 'Es al revés: devuelve NULL cuando **son iguales**; si son distintos, devuelve `a`.'),
      sqlCode('Muestra `nombre` y la ciudad, pero con el texto `\'Desconocida\'` cuando falte, como `ciudad_ok`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT nombre, COALESCE(ciudad, 'Desconocida') AS ciudad_ok FROM clientes;",
        hint: "COALESCE(ciudad, 'Desconocida')",
        why: '`COALESCE` devuelve el primer valor no nulo.',
      }),
      sqlPractice({
        goal: 'Fichas completas',
        prompt: 'Para la agenda de la tienda cada cliente debe tener un contacto.\n\n**Muestra `nombre` y una columna `contacto` con el email o, si no tiene email, el texto `sin contacto`.**',
        setup: 'tienda',
        check: same({ names: true, uses: ['COALESCE'] }),
        solution: "SELECT nombre, COALESCE(email, 'sin contacto') AS contacto FROM clientes;",
        hints: ['Piensa: «el primer valor que no sea NULL».', "`COALESCE(email, 'sin contacto')`"],
        explain: '`COALESCE` es la herramienta estándar para mostrar valores por defecto donde hay NULL.',
        commands: ['COALESCE'],
      }),
      sqlPractice({
        goal: 'Precio por unidad en stock',
        prompt: 'Quieres saber cuánto «vale» cada unidad disponible: el precio dividido entre el stock. Pero hay un producto sin stock y no puede dar un error.\n\n**Muestra `nombre` y `precio / stock` como `ratio` (NULL si el stock es 0), solo para los productos con menos de 10 unidades en stock.**',
        setup: 'tienda',
        check: same({ names: true, uses: ['NULLIF'] }),
        solution: 'SELECT nombre, precio / NULLIF(stock, 0) AS ratio FROM productos WHERE stock < 10;',
        hints: ['Convierte el cero del divisor en NULL.', '`precio / NULLIF(stock, 0)`'],
        explain: '`NULLIF(x, 0)` es el truco estándar contra la división por cero.',
        commands: ['NULLIF'],
      }),
      sqlPractice({
        goal: 'Páginas con texto',
        prompt: 'La ficha de cada libro debe mostrar la extensión como texto, por ejemplo `471 págs.`.\n\n**Muestra `titulo` y `extension` (`paginas` convertido a texto con `CAST` y unido a `\' págs.\'`).**',
        setup: 'biblioteca',
        check: same({ names: true, uses: ['CAST'] }),
        solution: "SELECT titulo, CAST(paginas AS TEXT) || ' págs.' AS extension FROM libros;",
        hints: ['`CAST(paginas AS TEXT)` convierte el número en texto.', "Une con `|| ' págs.'`"],
        explain: '`CAST` hace explícito el cambio de tipo. Es una buena costumbre aunque el motor a veces convierta solo.',
        commands: ['CAST'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el escaparate de ofertas',
    prompt:
      'Preparas el escaparate de la web con los **6 productos más caros** (ya con IVA). Para cada uno muestra:\n\n- `etiqueta`: el nombre en **MAYÚSCULAS**.\n- `precio_final`: el precio con **21 % de IVA**, redondeado a **2 decimales**.\n- `aviso`: `AGOTADO` si el stock es 0, `ÚLTIMAS UNIDADES` si queda menos de 10 y `DISPONIBLE` en otro caso.\n\nOrdénalos por `precio_final` de mayor a menor.',
    setup: 'tienda',
    check: ordered({ names: true }),
    solution: "SELECT UPPER(nombre) AS etiqueta, ROUND(precio * 1.21, 2) AS precio_final, CASE WHEN stock = 0 THEN 'AGOTADO' WHEN stock < 10 THEN 'ÚLTIMAS UNIDADES' ELSE 'DISPONIBLE' END AS aviso FROM productos ORDER BY precio_final DESC LIMIT 6;",
    hints: ['Tres columnas: UPPER, ROUND y CASE.', 'Ordena por el alias `precio_final` y limita a 6.'],
    explain: 'Texto, números y decisiones en una sola consulta: ya sabes transformar cualquier dato al pedirlo. ¡Zona completada!',
    commands: ['UPPER / LOWER', 'ROUND', 'CASE'],
  },
});
