import { learn, lesson, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

const TRIMESTRES = 'CREATE TABLE trimestres (anio INTEGER, q1 INTEGER, q2 INTEGER, q3 INTEGER, q4 INTEGER); INSERT INTO trimestres VALUES (2023, 10, 20, 30, 40), (2024, 15, 25, 35, 45);';
const RUTAS =
  "WITH RECURSIVE rutas(destino, ruta, escalas, precio) AS (SELECT destino, origen || '>' || destino, 0, precio FROM vuelos WHERE origen = 'MAD' UNION ALL SELECT v.destino, r.ruta || '>' || v.destino, r.escalas + 1, r.precio + v.precio FROM rutas r JOIN vuelos v ON v.origen = r.destino WHERE r.escalas < 2 AND POSITION(v.destino IN r.ruta) = 0)";

export const s11 = sqlWorld({
  id: 's11',
  index: 11,
  title: 'Recursión y análisis',
  subtitle: 'Jerarquías, subtotales, pivotes y patrones avanzados',
  emoji: '🌳',
  color: '#C084FC',
  level: 'avanzado',
  intro:
    'Algunos datos tienen forma de **árbol** (un organigrama, una carpeta dentro de otra) o de **red** (rutas de vuelos). Para recorrerlos hace falta que una consulta pueda llamarse a sí misma: las CTE recursivas. En esta zona también aprenderás a sacar **subtotales y totales** de un solo golpe, a girar una tabla de filas a columnas (y al revés) y a resolver los patrones clásicos de análisis de datos: rachas, huecos y comparativas. Es SQL de nivel profesional.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s11-1', { title: 'CTE recursivas', summary: 'Una consulta que se llama a sí misma', emoji: '♾️', commands: ['WITH RECURSIVE'], minutes: 10 }, [
      learn(
        'Ancla, paso y parada',
        `
Una **CTE recursiva** se define con tres piezas:

\`\`\`
WITH RECURSIVE n(i) AS (
  SELECT 1                       -- 1) ANCLA: la fila de partida
  UNION ALL
  SELECT i + 1 FROM n            -- 2) PASO: usa lo ya generado (n) para crear más filas
  WHERE i < 5                    -- 3) PARADA: cuándo dejar de crear
)
SELECT i FROM n;
\`\`\`

Se ejecuta así: la **ancla** produce la primera fila (1). El **paso** toma las filas nuevas y genera las siguientes (2, luego 3…) y se repite **hasta que ya no se genera ninguna fila** nueva. Por eso la **condición de parada es imprescindible**: sin ella nunca acaba (el motor corta tras 2000 vueltas con un error).

La CTE se llama a sí misma por su nombre (\`FROM n\`) dentro de su propia definición.
`,
        '♾️',
      ),
      sqlDemo('Contar, multiplicar y encadenar', 'vacia', [
        ['WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5) SELECT i FROM n;', 'Cuenta del 1 al 5'],
        ['WITH RECURSIVE f(i, factorial) AS (SELECT 1, 1 UNION ALL SELECT i + 1, factorial * (i + 1) FROM f WHERE i < 6) SELECT * FROM f;', 'Factoriales: una fila arrastra el cálculo de la anterior'],
        ['WITH RECURSIVE fib(a, b) AS (SELECT 0, 1 UNION ALL SELECT b, a + b FROM fib WHERE b < 50) SELECT a AS fibonacci FROM fib;', 'La sucesión de Fibonacci con dos columnas que van rotando'],
        sqlErr('WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n;', 'Sin condición de parada: el motor corta y avisa de qué falta'),
      ]),
      learn(
        'Cuidado con el borde',
        `
La condición de parada del \`WHERE\` se evalúa sobre la fila **anterior**, no sobre la que se va a generar. Por eso:

\`\`\`
SELECT i * 2 FROM n WHERE i < 20
\`\`\`

genera **hasta 32** (cuando \`i\` vale 16, se cumple \`i < 20\` y se crea 32; luego 32 ya no cumple y se para). Si querías que el último valor no pasara de 20, la condición debe mirar **el valor nuevo**: \`WHERE i * 2 <= 20\`.

> TIP: Pruébalo siempre con un caso pequeño y mira la última fila: es el error más común (un valor de más o de menos).
`,
        '🎯',
      ),
      sqlOut('Predice la sucesión', 'vacia', 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i * 2 FROM n WHERE i < 20) SELECT i FROM n;', ['1\n2\n4\n8\n16', '2\n4\n8\n16\n32', '1\n2\n3\n4\n5'], 'Cuando `i` vale 16 todavía se cumple `i < 20`, así que se genera 32. Después 32 no cumple y para: 1, 2, 4, 8, 16 y 32.'),
      mc('¿Qué pasa si una CTE recursiva no tiene condición de parada?', ['Se detiene sola cuando termina la tabla', 'Se repite hasta que el motor la corta con un error', 'Devuelve una sola fila', 'Funciona como una CTE normal'], 1, 'Sin parada generaría filas sin fin. El motor protege con un límite de iteraciones y lanza un error.'),
      order('Ordena las partes de una CTE recursiva', ['WITH', 'RECURSIVE', 'n(i)', 'AS', '(SELECT', '1', 'UNION', 'ALL', 'SELECT', 'i+1', 'FROM', 'n', 'WHERE', 'i<5)', 'SELECT', 'i', 'FROM', 'n;'], 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5) SELECT i FROM n;', 'Ancla, `UNION ALL`, paso recursivo con la condición de parada, y después la consulta final.'),
      tf('En una CTE recursiva, la parte del paso consulta a la propia CTE.', true, 'Sí: `FROM n` dentro de la definición de `n`. Cada vuelta toma las filas generadas en la vuelta anterior.'),
      sqlCode('Genera los números del 1 al 8 con una CTE recursiva (columna `n`).', {
        setup: 'vacia',
        check: same({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 8) SELECT n FROM s;',
        hint: 'Ancla 1, paso n + 1 y parada n < 8',
        why: 'Cuando `n` vale 7 se genera el 8; con 8 ya no se cumple `n < 8` y termina.',
      }),
      sqlPractice({
        goal: 'Tabla de cuadrados',
        prompt: 'Genera, solo con una CTE recursiva, los números del **1 al 10** junto a su cuadrado.\n\n**Muestra `n` y `cuadrado`.**',
        setup: 'vacia',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 10) SELECT n, n * n AS cuadrado FROM s;',
        hints: ['Ancla `SELECT 1`, paso `n + 1`, parada `n < 10`.', 'La consulta final calcula `n * n`.'],
        explain: 'Las CTE recursivas fabrican series de números: útil cuando no tienes `generate_series` o necesitas lógica más compleja.',
        commands: ['WITH RECURSIVE'],
      }),
      sqlPractice({
        goal: 'Potencias de 3',
        prompt: 'Genera las potencias de 3 (1, 3, 9, 27…) **sin pasar de 500**.\n\n**Muestra una columna `potencia`.** (Cuidado con el borde: la condición debe mirar el valor nuevo.)',
        setup: 'vacia',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE p(potencia) AS (SELECT 1 UNION ALL SELECT potencia * 3 FROM p WHERE potencia * 3 <= 500) SELECT potencia FROM p;',
        hints: ['El paso es `potencia * 3`.', 'La parada: `WHERE potencia * 3 <= 500`.'],
        explain: 'Con `WHERE potencia * 3 <= 500` el último valor es 243; con `WHERE potencia < 500` habría llegado a 729. Esa diferencia es el «error del borde».',
        commands: ['WITH RECURSIVE'],
      }),
      sqlPractice({
        goal: 'Calendario de una semana',
        prompt: 'Genera los **7 días del 1 al 7 de marzo de 2024** con una CTE recursiva, avanzando de día en día con `DATE(dia, \'+1 day\')`.\n\n**Muestra `dia` y el número del día de la semana `dia_semana` (`strftime(\'%w\', dia)`: 0 = domingo).**',
        setup: 'vacia',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: "WITH RECURSIVE d(dia) AS (SELECT '2024-03-01' UNION ALL SELECT DATE(dia, '+1 day') FROM d WHERE dia < '2024-03-07') SELECT dia, strftime('%w', dia) AS dia_semana FROM d;",
        hints: ["El ancla es el texto `'2024-03-01'`.", "Para en `dia < '2024-03-07'`."],
        explain: 'Las CTE recursivas también recorren fechas. (Hoy `generate_series` lo hace más corto, pero la técnica sirve en cualquier motor.)',
        commands: ['WITH RECURSIVE'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s11-2', { title: 'Jerarquías y grafos', summary: 'Organigramas, ascendientes y rutas', emoji: '🌲', commands: ['WITH RECURSIVE'], minutes: 11 }, [
      learn(
        'Recorrer un árbol',
        `
En \`empleados\`, cada fila apunta a su jefe con \`jefe_id\`. Recorrer el organigrama **entero** (jefes de jefes de jefes) es un caso de manual para una CTE recursiva:

- **Ancla**: la raíz (quien no tiene jefe: \`jefe_id IS NULL\`).
- **Paso**: \`JOIN\` entre la tabla y lo ya generado: «los empleados cuyo jefe es alguien que ya está en el árbol».

\`\`\`
WITH RECURSIVE arbol AS (
  SELECT id, nombre, 0 AS nivel
  FROM empleados WHERE jefe_id IS NULL
  UNION ALL
  SELECT e.id, e.nombre, a.nivel + 1
  FROM empleados e JOIN arbol a ON e.jefe_id = a.id
)
SELECT * FROM arbol;
\`\`\`

En cada vuelta se baja **un nivel**. Una columna \`nivel\` que suma 1 en cada paso permite indentar y contar por niveles.
`,
        '🌲',
      ),
      sqlDemo('El organigrama completo', 'empresa', [
        ['WITH RECURSIVE arbol AS (SELECT id, nombre, 0 AS nivel FROM empleados WHERE jefe_id IS NULL UNION ALL SELECT e.id, e.nombre, a.nivel + 1 FROM empleados e JOIN arbol a ON e.jefe_id = a.id) SELECT nivel, nombre FROM arbol ORDER BY nivel, nombre;', 'Cada empleado con su nivel jerárquico (0 es la directora general)'],
        ["WITH RECURSIVE arbol AS (SELECT id, nombre, nombre AS ruta FROM empleados WHERE jefe_id IS NULL UNION ALL SELECT e.id, e.nombre, a.ruta || ' > ' || e.nombre FROM empleados e JOIN arbol a ON e.jefe_id = a.id) SELECT ruta FROM arbol ORDER BY ruta;", 'Acumulando el camino en un texto: «Carolina > Andrés > Cristian > …»'],
        ['WITH RECURSIVE arbol AS (SELECT id, 0 AS nivel FROM empleados WHERE jefe_id IS NULL UNION ALL SELECT e.id, a.nivel + 1 FROM empleados e JOIN arbol a ON e.jefe_id = a.id) SELECT nivel, COUNT(*) AS personas FROM arbol GROUP BY nivel ORDER BY nivel;', 'Y contando personas por nivel con un GROUP BY normal'],
      ]),
      learn(
        'Hacia abajo y hacia arriba',
        `
La misma técnica recorre el árbol en las dos direcciones, según cómo escribas el \`JOIN\`:

- **Hacia abajo** (descendientes: todo el equipo de un jefe): el ancla es el jefe y el paso une \`e.jefe_id = q.id\`.
- **Hacia arriba** (ascendientes: la cadena de mando de un empleado): el ancla es el empleado y el paso une \`e.id = c.jefe_id\`.
`,
        '↕️',
      ),
      sqlDemo('Equipo de un jefe y cadena de mando', 'empresa', [
        ['WITH RECURSIVE equipo AS (SELECT id, nombre FROM empleados WHERE id = 4 UNION ALL SELECT e.id, e.nombre FROM empleados e JOIN equipo q ON e.jefe_id = q.id) SELECT nombre FROM equipo ORDER BY id;', 'Hacia abajo: Cristian y todos los que cuelgan de él (directa o indirectamente)'],
        ['WITH RECURSIVE cadena AS (SELECT id, nombre, jefe_id, 0 AS paso FROM empleados WHERE id = 5 UNION ALL SELECT e.id, e.nombre, e.jefe_id, c.paso + 1 FROM empleados e JOIN cadena c ON e.id = c.jefe_id) SELECT paso, nombre FROM cadena ORDER BY paso;', 'Hacia arriba: de Daniela hasta la directora general'],
      ]),
      learn(
        'Grafos y el peligro de los ciclos',
        `
Los vuelos forman un **grafo**, no un árbol: se puede volver al sitio de partida (MAD → BCN → MAD…). Si la recursión no lo vigila, **da vueltas** y genera rutas absurdas.

La defensa habitual: guardar el **camino recorrido** en un texto y no visitar un sitio que ya esté en él, y limitar el número de **escalas**:

\`\`\`
WHERE r.escalas < 2
  AND POSITION(v.destino IN r.ruta) = 0     -- ese destino no está ya en la ruta
\`\`\`
`,
        '🛫',
      ),
      sqlDemo('Rutas de MAD a JFK', 'vuelos', [
        [`${RUTAS} SELECT ruta, escalas, precio FROM rutas WHERE destino = 'JFK' ORDER BY precio;`, 'Todas las rutas con hasta 2 escalas, sin pasar dos veces por el mismo aeropuerto: la más barata no es el vuelo directo'],
      ]),
      mc('Para recorrer **todos los subordinados** (directos e indirectos) de un jefe, ¿cómo se une el paso recursivo?', ['`e.id = q.jefe_id`', '`e.jefe_id = q.id`', '`e.jefe_id = e.id`', 'No se puede'], 1, 'Buscas los empleados cuyo `jefe_id` es alguien que ya está en el equipo: `e.jefe_id = q.id`. (La otra opción sube hacia los jefes.)'),
      sqlOut('Predice el equipo', 'empresa', 'WITH RECURSIVE equipo AS (SELECT id, nombre FROM empleados WHERE jefe_id = 11 UNION ALL SELECT e.id, e.nombre FROM empleados e JOIN equipo q ON e.jefe_id = q.id) SELECT nombre FROM equipo;', ['Julia Navas', 'Kevin Soler\nJulia Navas', 'Carolina Vega\nKevin Soler'], 'Julia (id 11) tiene un único subordinado, Kevin Soler. El ancla toma a sus subordinados directos (no a ella) y no hay nadie por debajo de Kevin.'),
      tf('Un grafo con ciclos no necesita ningún control en la CTE recursiva: el motor sabe evitarlos.', false, 'El motor no lo evita: puede generar rutas repetidas hasta alcanzar el límite. Hay que controlar el camino o el número de pasos.'),
      sqlCode('Muestra el nombre de **todos los empleados que dependen (directa o indirectamente) de Andrés Molina (id 2)**, sin incluirlo a él. Ordénalos por nombre.', {
        setup: 'empresa',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE equipo AS (SELECT id, nombre FROM empleados WHERE jefe_id = 2 UNION ALL SELECT e.id, e.nombre FROM empleados e JOIN equipo q ON e.jefe_id = q.id) SELECT nombre FROM equipo ORDER BY nombre;',
        hint: 'El ancla son sus subordinados directos: jefe_id = 2',
        why: 'El ancla recoge a quienes dependen directamente de Andrés y el paso baja un nivel cada vez.',
      }),
      sqlPractice({
        goal: 'Niveles del organigrama',
        prompt: 'RR. HH. quiere el organigrama con la profundidad de cada persona.\n\n**Muestra `nivel` (0 = directora general) y `nombre`, ordenados por nivel y nombre.**',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE arbol AS (SELECT id, nombre, 0 AS nivel FROM empleados WHERE jefe_id IS NULL UNION ALL SELECT e.id, e.nombre, a.nivel + 1 FROM empleados e JOIN arbol a ON e.jefe_id = a.id) SELECT nivel, nombre FROM arbol ORDER BY nivel, nombre;',
        hints: ['El ancla es quien tiene `jefe_id IS NULL`.', 'El paso une `e.jefe_id = a.id` y suma 1 al nivel.'],
        explain: 'El nivel es la columna que va «contando» las vueltas de la recursión.',
        commands: ['WITH RECURSIVE'],
      }),
      sqlPractice({
        goal: 'Cadena de mando',
        prompt: 'Quieres ver la **cadena de mando de Daniela Pons (id 5)** hasta la cima.\n\n**Muestra `paso` (0 = ella, 1 = su jefe, …) y `nombre`, ordenados por paso.**',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: 'WITH RECURSIVE cadena AS (SELECT id, nombre, jefe_id, 0 AS paso FROM empleados WHERE id = 5 UNION ALL SELECT e.id, e.nombre, e.jefe_id, c.paso + 1 FROM empleados e JOIN cadena c ON e.id = c.jefe_id) SELECT paso, nombre FROM cadena ORDER BY paso;',
        hints: ['Ancla: el empleado 5.', 'El paso sube: `e.id = c.jefe_id`.'],
        explain: 'Hacia arriba el `JOIN` se invierte: buscas al jefe de quien acabas de encontrar.',
        commands: ['WITH RECURSIVE'],
      }),
      sqlPractice({
        goal: 'Las rutas más baratas a Nueva York',
        prompt: 'Una agencia quiere las **3 rutas más baratas de MAD a JFK con hasta 2 escalas**, sin pasar dos veces por el mismo aeropuerto.\n\n**Muestra `ruta` (por ejemplo `MAD>JFK`) y `precio` (suma de los tramos), de más barata a más cara, solo 3.**',
        setup: 'vuelos',
        check: ordered({ names: true, uses: ['RECURSIVE'] }),
        solution: `${RUTAS} SELECT ruta, precio FROM rutas WHERE destino = 'JFK' ORDER BY precio LIMIT 3;`,
        hints: ['Guarda el camino en un texto: `origen || \'>\' || destino`.', 'Limita con `escalas < 2` y evita ciclos con `POSITION(destino IN ruta) = 0`.'],
        explain: 'Un grafo se recorre con una CTE recursiva que acumula camino, precio y número de escalas. Aquí el vuelo directo (610 €) es la tercera opción: dos escalas por Londres salen más baratas.',
        commands: ['WITH RECURSIVE'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s11-3', { title: 'Subtotales: ROLLUP, CUBE y GROUPING SETS', summary: 'Totales y subtotales en una sola consulta', emoji: '🧮', commands: ['ROLLUP / CUBE'], minutes: 10 }, [
      learn(
        'Una fila de total sin consulta aparte',
        `
Un informe de pedidos por estado suele acabar con una fila **TOTAL**. Con \`GROUP BY\` normal necesitarías dos consultas unidas con \`UNION\`. Con \`ROLLUP\` sale todo de golpe:

\`\`\`
SELECT estado, COUNT(*) AS pedidos
FROM pedidos
GROUP BY ROLLUP (estado);
\`\`\`

Además de una fila por estado, añade **una fila final con el total**, donde \`estado\` vale **NULL**.

- \`ROLLUP (a, b)\` — subtotales **jerárquicos**: por (a, b), por (a) y total general. Ideal para año → mes.
- \`CUBE (a, b)\` — **todas** las combinaciones: (a, b), (a), (b) y total.
- \`GROUPING SETS ((a), (b), ())\` — tú eliges exactamente qué agrupaciones quieres.
`,
        '🧮',
      ),
      sqlDemo('Total general y por niveles', 'tienda', [
        ['SELECT categoria, COUNT(*) AS n, SUM(stock) AS stock FROM productos GROUP BY ROLLUP (categoria);', 'Cinco categorías y una fila final (categoria NULL) con el total'],
        ["SELECT strftime('%Y', fecha) AS anio, estado, COUNT(*) AS n FROM pedidos GROUP BY ROLLUP (strftime('%Y', fecha), estado) ORDER BY anio, estado;", 'Dos niveles: por año y estado, subtotal por año (estado NULL) y total general'],
      ]),
      learn(
        '¿Ese NULL es un total o un dato que falta?',
        `
Las filas de subtotal muestran **NULL** en la columna agrupada, pero **un dato real también puede ser NULL** (clientes sin ciudad). Para distinguirlos existe \`GROUPING(columna)\`: devuelve **1** si el NULL es de un subtotal y **0** si es un valor de verdad.

Con \`GROUPING\` puedes etiquetar el total y ordenar los totales al final:

\`\`\`
SELECT COALESCE(estado, 'TOTAL') AS estado, COUNT(*) AS pedidos
FROM pedidos
GROUP BY ROLLUP (estado)
ORDER BY GROUPING(estado), estado;
\`\`\`

> OJO: Si usas \`COALESCE(col, 'TOTAL')\` a secas, también rotularías como TOTAL los NULL reales. Cuando la columna admite NULL, usa \`CASE WHEN GROUPING(col) = 1 THEN 'TOTAL' ELSE …\`.
`,
        '🏷️',
      ),
      sqlDemo('GROUPING y GROUPING SETS', 'tienda', [
        ["SELECT COALESCE(estado, 'TOTAL') AS estado, COUNT(*) AS pedidos FROM pedidos GROUP BY ROLLUP (estado) ORDER BY GROUPING(estado), estado;", 'Etiquetado y con el total al final'],
        ['SELECT ciudad, vip, COUNT(*) AS clientes, GROUPING(ciudad) AS g_ciudad, GROUPING(vip) AS g_vip FROM clientes GROUP BY GROUPING SETS ((ciudad), (vip)) ORDER BY g_ciudad, ciudad, vip;', 'Dos resúmenes distintos en una sola consulta: por ciudad y por VIP. Fíjate: el NULL de la ciudad desconocida tiene g_ciudad = 0 (es un dato), el de «vip» en esas filas tiene g_vip = 1 (no se agrupó)'],
      ]),
      mc('En un `ROLLUP (a, b)`, ¿qué filas de resumen aparecen?', ['Solo el total general', 'Por (a, b), por (a) y el total general', 'Todas las combinaciones de a y b', 'Ninguna'], 1, '`ROLLUP` es jerárquico: va quitando columnas por la derecha (a, b) → (a) → (). `CUBE` generaría además (b).'),
      sqlOut('Predice las filas de ROLLUP', 'tienda', "SELECT categoria, COUNT(*) FROM productos WHERE categoria IN ('audio', 'pantallas') GROUP BY ROLLUP (categoria) ORDER BY GROUPING(categoria), categoria;", ['audio | 2\npantallas | 2', 'audio | 2\npantallas | 2\nNULL | 2', 'NULL | 4\naudio | 2\npantallas | 2'], 'Dos categorías (2 productos cada una) y la fila de total, con la categoría NULL y 4 productos, al final por el `ORDER BY GROUPING`.'),
      tf('`GROUPING(columna)` devuelve 1 cuando el NULL de esa columna es de una fila de subtotal.', true, 'Así se distinguen los NULL «de resumen» de los NULL «de datos».'),
      sqlCode('Cuenta los productos por categoría con una fila final `TOTAL` (columnas `categoria` y `productos`), el total al final.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT COALESCE(categoria, 'TOTAL') AS categoria, COUNT(*) AS productos FROM productos GROUP BY ROLLUP (categoria) ORDER BY GROUPING(categoria), categoria;",
        hint: 'GROUP BY ROLLUP (categoria) y ORDER BY GROUPING(categoria)',
        why: '`ROLLUP` añade el total y `GROUPING` lo manda al final.',
      }),
      sqlPractice({
        goal: 'Pedidos por estado, con total',
        prompt: 'Logística quiere el cuadro de pedidos por estado con la fila final del total.\n\n**Muestra `estado` (con el texto `TOTAL` en la última fila) y `pedidos`, con el total al final y los estados por orden alfabético.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROLLUP'] }),
        solution: "SELECT COALESCE(estado, 'TOTAL') AS estado, COUNT(*) AS pedidos FROM pedidos GROUP BY ROLLUP (estado) ORDER BY GROUPING(estado), estado;",
        hints: ['`GROUP BY ROLLUP (estado)`.', '`ORDER BY GROUPING(estado), estado` coloca el total al final.'],
        explain: 'Una sola consulta en lugar de un `UNION` entre el detalle y el total.',
        commands: ['ROLLUP / CUBE'],
      }),
      sqlPractice({
        goal: 'Año, estado y subtotales',
        prompt: 'Quieres el cuadro de pedidos por año y estado, con **subtotal por año y total general**.\n\n**Muestra `anio`, `estado` y `n` (cuántos pedidos), con `ROLLUP`, ordenado por `anio` y `estado` (los NULL de resumen van al final).**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROLLUP'] }),
        solution: "SELECT strftime('%Y', fecha) AS anio, estado, COUNT(*) AS n FROM pedidos GROUP BY ROLLUP (strftime('%Y', fecha), estado) ORDER BY anio, estado;",
        hints: ['Agrupa por dos expresiones: el año y el estado.', 'Los NULL ordenan al final en ascendente.'],
        explain: '`ROLLUP` jerárquico: detalle por (año, estado), subtotal por año (estado NULL) y total general (los dos NULL).',
        commands: ['ROLLUP / CUBE'],
      }),
      sqlPractice({
        goal: 'Dos resúmenes en una consulta',
        prompt: 'Para el informe de clientes necesitas, **en una sola consulta**, cuántos clientes hay **por ciudad** y cuántos **por condición VIP**.\n\n**Muestra `ciudad`, `vip` y `clientes` con `GROUPING SETS ((ciudad), (vip))`, ordenado por `GROUPING(ciudad)`, ciudad y vip.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['GROUPING SETS'] }),
        solution: 'SELECT ciudad, vip, COUNT(*) AS clientes FROM clientes GROUP BY GROUPING SETS ((ciudad), (vip)) ORDER BY GROUPING(ciudad), ciudad, vip;',
        hints: ['`GROUP BY GROUPING SETS ((ciudad), (vip))`', 'El `ORDER BY` puede usar `GROUPING(ciudad)`.'],
        explain: '`GROUPING SETS` elige las agrupaciones exactas que quieres y las calcula de una vez.',
        commands: ['ROLLUP / CUBE'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s11-4', { title: 'Pivotar y despivotar', summary: 'De filas a columnas y de columnas a filas', emoji: '🔄', commands: ['Pivotar y despivotar'], minutes: 10 }, [
      learn(
        'Pivotar: valores que se vuelven columnas',
        `
Una tabla «larga» tiene una fila por cada combinación (cliente, estado). Un **pivote** la gira para que cada valor de una columna pase a ser **una columna propia**: es el formato de las tablas de doble entrada de Excel.

La técnica universal en SQL: **agregación condicional** (la de \`CASE\` o \`FILTER\`), con **una columna por cada valor**:

\`\`\`
SELECT ciudad,
       COUNT(*) FILTER (WHERE vip)     AS vip,
       COUNT(*) FILTER (WHERE NOT vip) AS no_vip
FROM clientes
GROUP BY ciudad;
\`\`\`

Cada columna nueva cuenta **solo** las filas que cumplen su condición. Hay que **conocer de antemano** qué valores serán columnas: SQL no puede crear columnas dinámicamente.
`,
        '🔄',
      ),
      sqlDemo('Pedidos por mes y estado, en columnas', 'tienda', [
        ["SELECT strftime('%Y-%m', fecha) AS mes, SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) AS entregados, SUM(CASE WHEN estado = 'enviado' THEN 1 ELSE 0 END) AS enviados, SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes, SUM(CASE WHEN estado = 'cancelado' THEN 1 ELSE 0 END) AS cancelados FROM pedidos GROUP BY mes ORDER BY mes LIMIT 6;", 'Un pivote con SUM(CASE…): cada estado es una columna'],
        ['SELECT ciudad, COUNT(*) FILTER (WHERE vip) AS vip, COUNT(*) FILTER (WHERE NOT vip) AS no_vip FROM clientes GROUP BY ciudad ORDER BY ciudad;', 'El mismo patrón con FILTER'],
      ]),
      learn(
        'Despivotar: columnas que se vuelven filas',
        `
El camino inverso: una tabla «ancha» con una columna por trimestre (\`q1\`, \`q2\`, \`q3\`, \`q4\`) que quieres convertir en una fila por (año, trimestre). Esto se llama **unpivot** y es imprescindible para normalizar datos importados de hojas de cálculo. Dos formas:

- **\`UNION ALL\`**: una consulta por columna, etiquetando el nombre.
- **\`CROSS JOIN\` con \`VALUES\`**: se cruza cada fila con una lista de etiquetas y un \`CASE\` elige la columna.
`,
        '↩️',
      ),
      sqlDemo('De columnas a filas', { db: 'vacia', script: TRIMESTRES }, [
        ["SELECT anio, 'Q1' AS trimestre, q1 AS ventas FROM trimestres UNION ALL SELECT anio, 'Q2', q2 FROM trimestres UNION ALL SELECT anio, 'Q3', q3 FROM trimestres UNION ALL SELECT anio, 'Q4', q4 FROM trimestres ORDER BY anio, trimestre;", 'Con UNION ALL: cuatro consultas, una por trimestre'],
        ["SELECT t.anio, q.trimestre, CASE q.trimestre WHEN 'Q1' THEN t.q1 WHEN 'Q2' THEN t.q2 WHEN 'Q3' THEN t.q3 ELSE t.q4 END AS ventas FROM trimestres t CROSS JOIN (VALUES ('Q1'), ('Q2'), ('Q3'), ('Q4')) AS q(trimestre) ORDER BY 1, 2;", 'Con CROSS JOIN + VALUES: el mismo resultado, una sola lectura de la tabla'],
      ]),
      mc('Quieres una columna por cada estado de pedido. ¿Qué técnica usas?', ['`GROUP BY estado` y nada más', 'Agregaciones condicionales: `COUNT(*) FILTER (WHERE estado = …)` o `SUM(CASE …)`', '`ORDER BY estado`', 'Un `UNION`'], 1, 'Cada columna del pivote es una agregación condicional que cuenta solo los pedidos de ese estado.'),
      sqlOut('Predice el pivote', 'tienda', "SELECT SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) AS entregados, SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes FROM pedidos;", ['18 | 18', '5 | 13', '24 | 24'], 'Hay 13 pedidos entregados y 5 pendientes: cada `SUM(CASE …)` solo cuenta los de su estado.'),
      tf('Un pivote en SQL puede crear columnas nuevas automáticamente para cada valor distinto que aparezca.', false, 'No: las columnas del resultado se conocen al escribir la consulta. Si los valores cambian, hay que cambiar la consulta (o generarla desde un programa).'),
      sqlCode('Cuenta los clientes por ciudad en dos columnas: `vip` y `no_vip` (con `FILTER`), ordenado por ciudad.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT ciudad, COUNT(*) FILTER (WHERE vip) AS vip, COUNT(*) FILTER (WHERE NOT vip) AS no_vip FROM clientes GROUP BY ciudad ORDER BY ciudad;',
        hint: 'COUNT(*) FILTER (WHERE vip) y COUNT(*) FILTER (WHERE NOT vip)',
        why: 'Dos agregaciones condicionales en el mismo `GROUP BY`.',
      }),
      sqlPractice({
        goal: 'Ventas por mes y producto',
        prompt: 'La tabla `ventas` (6000 filas) tiene un registro por venta. Prepara un cuadro de doble entrada para los **tres primeros meses**.\n\n**Muestra `mes` (`AAAA-MM`) y una columna por producto con el importe total redondeado a 0 decimales: `raton`, `teclado` y `monitor`. Ordena por mes y quédate con los 3 primeros.**',
        setup: 'ventas_grande',
        check: ordered({ names: true }),
        solution: "SELECT strftime('%Y-%m', fecha) AS mes, ROUND(SUM(importe) FILTER (WHERE producto = 'raton'), 0) AS raton, ROUND(SUM(importe) FILTER (WHERE producto = 'teclado'), 0) AS teclado, ROUND(SUM(importe) FILTER (WHERE producto = 'monitor'), 0) AS monitor FROM ventas GROUP BY mes ORDER BY mes LIMIT 3;",
        hints: ['Una agregación `SUM(importe) FILTER (WHERE producto = …)` por columna.', 'Redondea con `ROUND(…, 0)`.'],
        explain: 'Un pivote clásico: meses en filas, productos en columnas. Seis mil filas se resumen en tres.',
        commands: ['Pivotar y despivotar', 'FILTER'],
      }),
      sqlPractice({
        goal: 'Estados en columnas',
        prompt: 'Logística quiere ver, por **cliente**, cuántos pedidos tiene en cada estado.\n\n**Muestra `cliente_id` y las columnas `entregados`, `enviados`, `pendientes` y `cancelados` (cuántos pedidos de cada estado), ordenado por `cliente_id`.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT cliente_id, SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) AS entregados, SUM(CASE WHEN estado = 'enviado' THEN 1 ELSE 0 END) AS enviados, SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes, SUM(CASE WHEN estado = 'cancelado' THEN 1 ELSE 0 END) AS cancelados FROM pedidos GROUP BY cliente_id ORDER BY cliente_id;",
        hints: ['Una columna por estado con `SUM(CASE WHEN estado = … THEN 1 ELSE 0 END)`.', 'Agrupa por `cliente_id`.'],
        explain: 'Cada columna es un contador condicional. Con 4 estados, 4 columnas.',
        commands: ['Pivotar y despivotar'],
      }),
      sqlPractice({
        goal: 'De ancho a largo',
        prompt: 'La tabla `trimestres` tiene una columna por trimestre. Para analizarla con `GROUP BY`, hay que pasarla a formato largo.\n\n**Muestra `anio`, `trimestre` (`Q1` a `Q4`) y `ventas`, ordenado por año y trimestre.** (Con `UNION ALL` o con `CROSS JOIN` + `VALUES`.)',
        setup: { db: 'vacia', script: TRIMESTRES },
        check: ordered({ names: true }),
        solution: "SELECT anio, 'Q1' AS trimestre, q1 AS ventas FROM trimestres UNION ALL SELECT anio, 'Q2', q2 FROM trimestres UNION ALL SELECT anio, 'Q3', q3 FROM trimestres UNION ALL SELECT anio, 'Q4', q4 FROM trimestres ORDER BY anio, trimestre;",
        hints: ['Una consulta `SELECT` por columna, unidas con `UNION ALL`.', "Añade el texto fijo `'Q1' AS trimestre`."],
        explain: 'El «unpivot» devuelve los datos a su forma normalizada: una fila por hecho. A partir de ahí, `GROUP BY` y gráficos son triviales.',
        commands: ['Pivotar y despivotar', 'UNION'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s11-5', { title: 'Patrones de analista', summary: 'Rachas, huecos y primeras/últimas veces', emoji: '🕵️', commands: ['Rachas y huecos'], minutes: 11 }, [
      learn(
        'Rachas: días consecutivos',
        `
«¿Quién publica **varios días seguidos**?» es el famoso problema de las **islas**: agrupar filas consecutivas. El truco asombra la primera vez:

1. Quita duplicados y **numera** las fechas de cada usuario con \`ROW_NUMBER()\`.
2. A cada fecha **réstale su número de fila** en días.

Para fechas **consecutivas** esa resta da **siempre el mismo valor**; en cuanto hay un salto, el valor cambia. Esa «fecha de grupo» identifica cada racha: basta \`GROUP BY\` usuario y grupo.

\`\`\`
fecha        rn   fecha − rn
2024-03-20   1    2024-03-19
2024-03-21   2    2024-03-19    ← misma racha
2024-03-22   3    2024-03-19    ← misma racha
2024-04-02   4    2024-03-29    ← racha nueva
\`\`\`
`,
        '🏝️',
      ),
      sqlDemo('Buscar las rachas', 'social', [
        ['SELECT usuario_id, DATE(fecha) AS dia FROM publicaciones ORDER BY usuario_id, dia;', 'Los días en que publicó cada usuario: sql_fan (5) tiene tres seguidos'],
        ["WITH dias AS (SELECT DISTINCT usuario_id, DATE(fecha) AS dia FROM publicaciones), num AS (SELECT usuario_id, dia, ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY dia) AS rn FROM dias), grupos AS (SELECT usuario_id, dia, DATE(dia, '-' || rn || ' days') AS grupo FROM num) SELECT usuario_id, MIN(dia) AS desde, MAX(dia) AS hasta, COUNT(*) AS dias_seguidos FROM grupos GROUP BY usuario_id, grupo HAVING COUNT(*) >= 2 ORDER BY dias_seguidos DESC, usuario_id;", 'Tres CTE encadenadas: días únicos → numeración → grupo. El resultado: la racha de 3 días de sql_fan'],
      ]),
      learn(
        'Huecos y primeras/últimas veces',
        `
Dos patrones más que se repiten en cada empresa:

- **Huecos**: los periodos **sin** datos (meses sin ventas). Calendario con \`generate_series\` + \`LEFT JOIN\` + \`IS NULL\`: el _anti-join_ de siempre aplicado al tiempo.
- **Primera y última vez** de cada entidad (primera y última compra, alta y baja): \`MIN\` y \`MAX\` por grupo; la diferencia entre ambas es la **antigüedad** o el tiempo de actividad.
`,
        '⏳',
      ),
      sqlDemo('Meses sin pedidos y vida de cada cliente', 'tienda', [
        ["SELECT strftime('%Y-%m', m) AS mes_sin_pedidos FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m LEFT JOIN pedidos p ON strftime('%Y-%m', p.fecha) = strftime('%Y-%m', m) WHERE p.id IS NULL;", 'Los huecos del año: diciembre'],
        ['SELECT cliente_id, MIN(fecha) AS primera, MAX(fecha) AS ultima, MAX(fecha) - MIN(fecha) AS dias_activo FROM pedidos GROUP BY cliente_id HAVING COUNT(*) > 1 ORDER BY dias_activo DESC, cliente_id LIMIT 5;', 'Primera y última compra, y cuánto tiempo estuvo activo cada cliente'],
      ]),
      mc('En el truco de las rachas, ¿qué valor es **igual** para todas las fechas de una misma racha?', ['La fecha', 'La fecha menos su número de fila', 'El número de fila', 'El usuario'], 1, 'Mientras las fechas son consecutivas, restar su posición en días da siempre el mismo resultado: identifica la racha.'),
      sqlOut('Predice la racha', 'vacia', "WITH d(dia) AS (VALUES ('2024-05-01'), ('2024-05-02'), ('2024-05-03'), ('2024-05-07'), ('2024-05-08')), n AS (SELECT dia, ROW_NUMBER() OVER (ORDER BY dia) AS rn FROM d), g AS (SELECT dia, DATE(dia, '-' || rn || ' days') AS grupo FROM n) SELECT MIN(dia), MAX(dia), COUNT(*) FROM g GROUP BY grupo ORDER BY MIN(dia);", ['2024-05-01 | 2024-05-08 | 5', '2024-05-01 | 2024-05-03 | 3\n2024-05-07 | 2024-05-08 | 2\n2024-05-02 | 2024-05-03 | 2', '2024-05-01 | 2024-05-03 | 2\n2024-05-07 | 2024-05-08 | 3'], 'Hay dos rachas: del 1 al 3 de mayo (3 días) y del 7 al 8 (2 días). El salto del 3 al 7 cambia el «grupo».'),
      tf('Para encontrar meses sin ventas basta un `GROUP BY mes` sobre la tabla de ventas.', false, 'Los meses sin ventas no tienen filas que agrupar: para verlos hace falta generar el calendario y hacer un `LEFT JOIN`.'),
      sqlCode('Muestra el mes (`AAAA-MM`) en que **no se hizo ningún pedido** de 2024 (columna `mes`), usando un calendario con `generate_series`.', {
        setup: 'tienda',
        check: same({ names: true, uses: ['generate_series'] }),
        solution: "SELECT strftime('%Y-%m', m) AS mes FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m LEFT JOIN pedidos p ON strftime('%Y-%m', p.fecha) = strftime('%Y-%m', m) WHERE p.id IS NULL;",
        hint: 'LEFT JOIN desde el calendario y filtra p.id IS NULL',
        why: 'El anti-join sobre el calendario deja solo los meses que no encuentran ningún pedido.',
      }),
      sqlPractice({
        goal: 'Rachas de publicaciones',
        prompt: 'La red social premia a quien publica **2 o más días seguidos**.\n\n**Muestra `usuario_id`, `desde`, `hasta` y `dias_seguidos` de cada racha de 2 o más días, ordenadas de más larga a más corta y luego por usuario.**',
        setup: 'social',
        check: ordered({ names: true }),
        solution: "WITH dias AS (SELECT DISTINCT usuario_id, DATE(fecha) AS dia FROM publicaciones), num AS (SELECT usuario_id, dia, ROW_NUMBER() OVER (PARTITION BY usuario_id ORDER BY dia) AS rn FROM dias), grupos AS (SELECT usuario_id, dia, DATE(dia, '-' || rn || ' days') AS grupo FROM num) SELECT usuario_id, MIN(dia) AS desde, MAX(dia) AS hasta, COUNT(*) AS dias_seguidos FROM grupos GROUP BY usuario_id, grupo HAVING COUNT(*) >= 2 ORDER BY dias_seguidos DESC, usuario_id;",
        hints: ['Tres pasos: días distintos, `ROW_NUMBER` por usuario, y fecha − número.', "`DATE(dia, '-' || rn || ' days')` resta `rn` días a la fecha."],
        explain: 'El patrón de las «islas»: la diferencia entre la fecha y su número de fila es constante dentro de cada racha.',
        commands: ['Rachas y huecos'],
      }),
      sqlPractice({
        goal: 'Meses mudos',
        prompt: 'Contabilidad pregunta: ¿**en qué meses de 2024 no se registró ningún pedido**?\n\n**Muestra `mes` (formato `AAAA-MM`).** Genera un calendario de 12 meses y busca los que no tienen pedidos.',
        setup: 'tienda',
        check: same({ names: true, uses: ['generate_series'] }),
        solution: "SELECT strftime('%Y-%m', m) AS mes FROM generate_series('2024-01-01'::date, '2024-12-01'::date, '1 month') AS m LEFT JOIN pedidos p ON strftime('%Y-%m', p.fecha) = strftime('%Y-%m', m) WHERE p.id IS NULL;",
        hints: ['El calendario manda: `FROM generate_series(…) AS m LEFT JOIN pedidos …`.', 'Se queda con las filas donde `p.id IS NULL`.'],
        explain: 'Calendario + `LEFT JOIN` + `IS NULL` encuentra cualquier hueco temporal: días sin ventas, semanas sin turno, meses sin facturas…',
        commands: ['Rachas y huecos', 'generate_series'],
      }),
      sqlPractice({
        goal: 'Clientes de largo recorrido',
        prompt: 'Marketing quiere premiar la fidelidad: clientes con **más de un pedido**, cuántos días pasaron entre su primer y su último pedido.\n\n**Muestra `cliente_id`, `primera`, `ultima` y `dias_activo`, de más a menos días y luego por cliente.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT cliente_id, MIN(fecha) AS primera, MAX(fecha) AS ultima, MAX(fecha) - MIN(fecha) AS dias_activo FROM pedidos GROUP BY cliente_id HAVING COUNT(*) > 1 ORDER BY dias_activo DESC, cliente_id;',
        hints: ['`MIN(fecha)` y `MAX(fecha)` por cliente.', 'Restar fechas da días.'],
        explain: 'Primera y última vez + `HAVING COUNT(*) > 1` para quedarse con quienes repiten. Es la base del análisis de fidelidad y retención.',
        commands: ['Rachas y huecos', 'MIN / MAX'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el coste de cada equipo',
    prompt:
      'La directora financiera quiere saber **cuánta gente cuelga de cada jefe, en todos los niveles**, y cuánto cuesta ese equipo.\n\nPara **cada empleado que tenga al menos una persona a su cargo** (directa o indirecta), muestra:\n\n- `nombre`: el jefe.\n- `personas`: cuántos empleados hay por debajo de él (en todos los niveles, sin contarlo a él).\n- `masa_equipo`: la suma de los salarios de esas personas (sin el suyo).\n\nOrdena por `personas` de mayor a menor y luego por nombre. (Pista: una CTE recursiva que empareje a cada empleado con todos sus subordinados.)',
    setup: 'empresa',
    check: ordered({ names: true, uses: ['RECURSIVE'] }),
    solution:
      'WITH RECURSIVE sub(raiz, id, salario) AS (SELECT id, id, salario FROM empleados UNION ALL SELECT s.raiz, e.id, e.salario FROM empleados e JOIN sub s ON e.jefe_id = s.id) SELECT j.nombre, COUNT(*) - 1 AS personas, SUM(s.salario) - j.salario AS masa_equipo FROM sub s JOIN empleados j ON j.id = s.raiz GROUP BY j.id, j.nombre, j.salario HAVING COUNT(*) > 1 ORDER BY personas DESC, j.nombre;',
    hints: ['Ancla: cada empleado es su propia «raíz» (`SELECT id, id, salario …`).', 'El paso baja un nivel manteniendo la raíz: `SELECT s.raiz, e.id, e.salario … JOIN sub s ON e.jefe_id = s.id`.'],
    explain: 'La CTE recursiva genera todas las parejas (jefe, subordinado) de la empresa; después un `GROUP BY` las resume. Recursión + agregación: SQL de nivel experto. ¡Zona completada!',
    commands: ['WITH RECURSIVE', 'GROUP BY'],
  },
});
