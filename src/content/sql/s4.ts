import { illus, learn, lesson, match, mc, order, tf } from '../build';
import { ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

export const s4 = sqlWorld({
  id: 's4',
  index: 4,
  title: 'Resumir datos',
  subtitle: 'Contar, sumar, promediar y agrupar',
  emoji: '📊',
  color: '#38BDF8',
  level: 'basico',
  intro:
    'Hasta ahora has mirado filas sueltas. Pero un jefe rara vez pregunta «dame todos los pedidos»: pregunta «¿cuántos pedidos hubo por mes?», «¿cuál es el producto medio más caro por categoría?». Resumir miles de filas en pocas cifras es el superpoder del análisis de datos y lo consigues con las funciones de agregación, `GROUP BY` y `HAVING`.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s4-1', { title: 'Contar, sumar y promediar', summary: 'COUNT, SUM, AVG, MIN y MAX', emoji: '🧮', commands: ['COUNT', 'SUM', 'AVG', 'MIN / MAX'], minutes: 9 }, [
      learn(
        'Muchas filas, un solo valor',
        `
Una **función de agregación** toma **muchas filas** y devuelve **un único valor**:

| Función | Devuelve |
| --- | --- |
| \`COUNT(*)\` | cuántas filas hay |
| \`SUM(col)\` | la suma de los valores |
| \`AVG(col)\` | la media |
| \`MIN(col)\` | el menor |
| \`MAX(col)\` | el mayor |

\`\`\`
SELECT COUNT(*), AVG(precio), MAX(precio)
FROM productos;
\`\`\`

El resultado tiene **una sola fila**, aunque la tabla tenga millones.
`,
        '🧮',
      ),
      sqlDemo('Las cinco funciones', 'tienda', [
        ['SELECT COUNT(*) AS productos, SUM(stock) AS unidades FROM productos;', 'Cuántos productos hay y cuántas unidades en total'],
        ['SELECT MIN(precio) AS el_mas_barato, MAX(precio) AS el_mas_caro, ROUND(AVG(precio), 2) AS precio_medio FROM productos;', 'Mínimo, máximo y media (redondeada)'],
        ['SELECT MIN(fecha_alta) AS primer_alta, MAX(fecha_alta) AS ultimo_alta FROM clientes;', 'MIN y MAX también funcionan con fechas (y con textos)'],
        ['SELECT COUNT(*) AS vips FROM clientes WHERE vip;', 'Con WHERE: primero se filtra y después se cuenta'],
      ]),
      learn(
        'Los NULL no cuentan',
        `
Las funciones de agregación **ignoran los NULL**, con una excepción:

- \`COUNT(*)\` cuenta **filas** (todas).
- \`COUNT(columna)\` cuenta las filas donde esa columna **no es NULL**.
- \`COUNT(DISTINCT columna)\` cuenta valores **distintos** (sin NULL).
- \`AVG\`, \`SUM\`, \`MIN\` y \`MAX\` saltan los NULL.

Esto afecta a la media: una nota sin poner (NULL) **no cuenta como 0**: simplemente no entra en el promedio. Si quisieras que cuente como 0 tendrías que decírselo con \`COALESCE(nota, 0)\`.

> OJO: Si **no hay ninguna fila**, \`COUNT\` devuelve 0 pero \`SUM\`, \`AVG\`, \`MIN\` y \`MAX\` devuelven NULL.
`,
        '⚠️',
      ),
      sqlDemo('COUNT de tres formas y la nota que no cuenta', 'escuela', [
        ['SELECT COUNT(*) AS filas, COUNT(nota) AS con_nota FROM matriculas;', '29 matrículas, pero solo 27 tienen nota'],
        ['SELECT ROUND(AVG(nota), 2) AS media_real, ROUND(AVG(COALESCE(nota, 0)), 2) AS media_si_fueran_ceros FROM matriculas;', 'Las dos medias no coinciden: depende de qué quieras decir con «sin nota»'],
      ]),
      sqlOut('Predice los tres conteos', 'tienda', 'SELECT COUNT(*), COUNT(ciudad), COUNT(DISTINCT ciudad) FROM clientes;', ['12 | 12 | 6', '10 | 10 | 6', '12 | 10 | 10'], '`COUNT(*)` cuenta los 12 clientes; `COUNT(ciudad)` solo los 10 con ciudad; y `COUNT(DISTINCT ciudad)` las 6 ciudades distintas.'),
      mc('¿Qué cuenta `COUNT(email)`?', ['Todas las filas', 'Las filas donde email no es NULL', 'Los emails distintos', 'Los emails que terminan en .com'], 1, '`COUNT(columna)` cuenta solo los valores presentes (no NULL). Para valores distintos hay que añadir `DISTINCT`.'),
      learn(
        'No mezcles filas con resúmenes',
        `
Una consulta con agregados devuelve **una fila**. Si además pides una columna normal, SQL no sabe de **qué fila** sacar el valor:

\`\`\`
SELECT nombre, COUNT(*) FROM productos;   -- ¡error!
\`\`\`

La solución es indicar cómo agrupar (el tema de la próxima lección) o resumir también esa columna (\`MAX(nombre)\`).
`,
      ),
      sqlDemo('El error de mezclar', 'tienda', [
        sqlErr('SELECT nombre, COUNT(*) FROM productos;', 'El mensaje explica cómo arreglarlo: agrupar con GROUP BY'),
      ]),
      tf('`AVG(nota)` trata las notas NULL como si fueran 0.', false, 'Las funciones de agregación ignoran los NULL: no entran ni en la suma ni en el recuento de la media.'),
      sqlCode('Cuenta cuántos productos tienen stock mayor que 0. Llama a la columna `disponibles`.', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT COUNT(*) AS disponibles FROM productos WHERE stock > 0;',
        hint: 'COUNT(*) con un WHERE',
        why: 'Primero `WHERE` filtra las filas y después `COUNT(*)` las cuenta.',
      }),
      sqlPractice({
        goal: 'Ficha del catálogo',
        prompt: 'La directora quiere cuatro cifras del catálogo en una sola fila:\n\n- `productos`: cuántos hay.\n- `precio_medio`: la media de precios, redondeada a 2 decimales.\n- `mas_barato` y `mas_caro`: el precio mínimo y el máximo.\n\n**Escribe la consulta.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT COUNT(*) AS productos, ROUND(AVG(precio), 2) AS precio_medio, MIN(precio) AS mas_barato, MAX(precio) AS mas_caro FROM productos;',
        hints: ['Cuatro funciones de agregación en el mismo SELECT.', 'Redondea solo la media: `ROUND(AVG(precio), 2)`.'],
        explain: 'Muchas agregaciones juntas dan un resumen completo en una sola fila. Es la base de cualquier panel de control.',
        commands: ['COUNT', 'AVG', 'MIN / MAX'],
      }),
      sqlPractice({
        goal: 'Valor del almacén',
        prompt: 'Contabilidad necesita saber cuánto dinero hay parado en el almacén: la suma de **precio × stock** de todos los productos.\n\n**Muestra `valor_inventario` y cuántos productos están agotados (stock = 0) como `agotados`.**',
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT SUM(precio * stock) AS valor_inventario, COUNT(*) FILTER (WHERE stock = 0) AS agotados FROM productos;',
        hints: ['`SUM` acepta un cálculo entre columnas.', 'Para contar solo los agotados: `COUNT(*) FILTER (WHERE stock = 0)` (o `SUM(CASE WHEN … THEN 1 ELSE 0 END)`).'],
        explain: 'Dentro de una agregación puedes poner cualquier expresión. `FILTER (WHERE …)` restringe una agregación concreta a ciertas filas sin afectar a las demás.',
        commands: ['SUM', 'COUNT', 'FILTER'],
      }),
      sqlPractice({
        goal: 'Notas pendientes',
        prompt: 'En la escuela quieren saber cuántas matrículas aún no tienen nota y la media real del resto.\n\n**Muestra `sin_nota` (cuántas matrículas tienen la nota NULL) y `media` (media de las notas, redondeada a 2 decimales).** Pista: `COUNT(*)` y `COUNT(nota)` dan los números justos.',
        setup: 'escuela',
        check: same({ names: true }),
        solution: 'SELECT COUNT(*) - COUNT(nota) AS sin_nota, ROUND(AVG(nota), 2) AS media FROM matriculas;',
        hints: ['Las filas sin nota son `COUNT(*)` menos `COUNT(nota)`.', '`AVG` ya ignora los NULL.'],
        explain: 'La diferencia entre `COUNT(*)` y `COUNT(columna)` es un truco clásico para contar NULL. Y `AVG` ya ignora los huecos.',
        commands: ['COUNT', 'AVG'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s4-2', { title: 'GROUP BY: un resumen por grupo', summary: 'Una fila por categoría, por mes, por cliente…', emoji: '🗂️', commands: ['GROUP BY'], minutes: 9 }, [
      learn(
        'De un resumen a muchos',
        `
\`COUNT(*)\` sobre toda la tabla da una cifra. Pero lo normal es preguntar **por grupos**: «¿cuántos productos hay **en cada categoría**?». Eso es \`GROUP BY\`:

\`\`\`
SELECT categoria, COUNT(*) AS productos
FROM productos
GROUP BY categoria;
\`\`\`

La base de datos **reúne las filas con el mismo valor** de \`categoria\` en un grupo, y calcula las agregaciones **de cada grupo** por separado. El resultado tiene **una fila por grupo**.
`,
        '🗂️',
      ),
      illus('sql-group-flow', 'Cómo funciona GROUP BY', 'Las filas se reparten en cajas según su valor y cada caja se resume en una fila.'),
      sqlDemo('Un resumen por grupo', 'tienda', [
        ['SELECT categoria, COUNT(*) AS productos FROM productos GROUP BY categoria;', 'Cuántos productos hay en cada categoría'],
        ['SELECT categoria, COUNT(*) AS productos, ROUND(AVG(precio), 2) AS precio_medio, MAX(precio) AS mas_caro FROM productos GROUP BY categoria ORDER BY productos DESC, categoria;', 'Varias agregaciones a la vez, y ordenadas'],
        ['SELECT estado, COUNT(*) AS pedidos FROM pedidos GROUP BY estado ORDER BY pedidos DESC;', 'Pedidos por estado, del más frecuente al menos'],
        ['SELECT ciudad, COUNT(*) AS clientes FROM clientes GROUP BY ciudad ORDER BY ciudad;', 'Atención: los clientes sin ciudad (NULL) forman su propio grupo'],
      ]),
      learn(
        'La regla de oro',
        `
En un \`SELECT\` con \`GROUP BY\`, cada columna **o bien está en el \`GROUP BY\`, o bien va dentro de una agregación**. Si no, SQL no sabría qué valor mostrar de entre todas las filas del grupo:

\`\`\`
SELECT categoria, nombre, COUNT(*)     -- ¡error! ¿qué nombre?
FROM productos
GROUP BY categoria;
\`\`\`

También:

- Todos los valores **NULL** de la columna se reúnen en **un** grupo.
- \`ORDER BY\` puede ordenar por una agregación (\`ORDER BY COUNT(*) DESC\`) o por su alias.
- Se puede usar el alias del \`SELECT\` en \`GROUP BY\` en este motor (como en PostgreSQL).
`,
        '📜',
      ),
      sqlDemo('El error clásico de GROUP BY', 'tienda', [
        sqlErr('SELECT categoria, nombre, COUNT(*) FROM productos GROUP BY categoria;', 'Falta decidir qué hacer con «nombre». El error lo dice claramente'),
        ['SELECT categoria, MAX(nombre) AS un_nombre, COUNT(*) FROM productos GROUP BY categoria;', 'Una solución: resumir el nombre con una agregación'],
      ]),
      sqlOut('Predice: ¿cuántos pedidos hay por estado?', 'tienda', 'SELECT estado, COUNT(*) AS pedidos FROM pedidos GROUP BY estado ORDER BY pedidos DESC;', ['entregado | 13\nenviado | 5\npendiente | 4\ncancelado | 2', 'cancelado | 2\nenviado | 4\npendiente | 5\nentregado | 13', 'entregado | 13\npendiente | 4\nenviado | 5\ncancelado | 2'], '13 entregados, 5 pendientes, 4 enviados y 2 cancelados, ordenados de más a menos pedidos.'),
      mc('¿Cuántas filas devuelve una consulta con `GROUP BY categoria` si hay 5 categorías distintas en la tabla?', ['Tantas como filas tiene la tabla', '5', '1', 'Depende de las columnas del SELECT'], 1, 'Siempre una fila por grupo: aquí, 5.'),
      match(
        'Une cada consulta con lo que calcula',
        [
          ['COUNT(*) sin GROUP BY', 'El total de filas de la tabla'],
          ['COUNT(*) con GROUP BY categoria', 'Las filas de cada categoría'],
          ['AVG(precio) con GROUP BY categoria', 'El precio medio de cada categoría'],
          ['MAX(precio) sin GROUP BY', 'El precio más alto de toda la tabla'],
        ],
        'Sin `GROUP BY` el resumen es de toda la tabla; con `GROUP BY` hay un resumen por grupo.',
      ),
      sqlCode('Cuenta los clientes de cada ciudad (`ciudad` y `clientes`).', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT ciudad, COUNT(*) AS clientes FROM clientes GROUP BY ciudad;',
        hint: 'GROUP BY ciudad',
        why: 'Un grupo por ciudad (y otro para los NULL), con su recuento.',
      }),
      sqlPractice({
        goal: 'Pedidos por cliente',
        prompt: 'Quieres saber quién compra más a menudo.\n\n**Muestra `cliente_id` y cuántos pedidos ha hecho como `pedidos`, ordenado por pedidos de mayor a menor y, si empatan, por `cliente_id`.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: 'SELECT cliente_id, COUNT(*) AS pedidos FROM pedidos GROUP BY cliente_id ORDER BY pedidos DESC, cliente_id;',
        hints: ['Agrupa por `cliente_id` y cuenta.', 'Dos criterios en el `ORDER BY`.'],
        explain: '`GROUP BY` + `COUNT(*)` + `ORDER BY` es la consulta de «ranking» más común del mundo.',
        commands: ['GROUP BY', 'COUNT'],
      }),
      sqlPractice({
        goal: 'Panorama del cine',
        prompt: 'Para el informe anual del cine, por **género**:\n\n- `peliculas`: cuántas hay.\n- `media`: la puntuación media, redondeada a 2 decimales.\n\n**Ordena por número de películas (de más a menos) y luego por género.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT genero, COUNT(*) AS peliculas, ROUND(AVG(puntuacion), 2) AS media FROM peliculas GROUP BY genero ORDER BY peliculas DESC, genero;',
        hints: ['Agrupa por `genero`.', 'La película sin puntuación (NULL) no afecta a la media: AVG ignora los NULL.'],
        explain: 'Dos agregaciones por grupo. La película sin estrenar cuenta en `COUNT(*)` pero no en la media, porque su puntuación es NULL.',
        commands: ['GROUP BY', 'AVG'],
      }),
      sqlPractice({
        goal: 'Plantilla por departamento',
        prompt: 'RR. HH. quiere un resumen por departamento (en la tabla `empleados`, `departamento_id`):\n\n- `empleados`: cuántas personas.\n- `masa_salarial`: suma de salarios.\n\n**Ordena por `departamento_id`.** (El becario no tiene departamento: su grupo es NULL.)',
        setup: 'empresa',
        check: ordered({ names: true }),
        solution: 'SELECT departamento_id, COUNT(*) AS empleados, SUM(salario) AS masa_salarial FROM empleados GROUP BY departamento_id ORDER BY departamento_id;',
        hints: ['`GROUP BY departamento_id`.', '`SUM(salario)` suma los sueldos de cada grupo.'],
        explain: 'Cada departamento es un grupo; los empleados sin departamento (NULL) forman uno propio y salen al final del orden ascendente.',
        commands: ['GROUP BY', 'SUM'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s4-3', { title: 'HAVING: filtrar grupos', summary: 'Diferencia entre WHERE y HAVING', emoji: '🪣', commands: ['HAVING'], minutes: 8 }, [
      learn(
        'Filtrar después de agrupar',
        `
\`WHERE\` filtra **filas**, **antes** de agrupar. Pero a veces quieres filtrar **grupos** por su resultado: «categorías con más de 100 unidades en stock». Ese valor no existe hasta que se agrupa, así que \`WHERE\` no puede verlo. Para eso está \`HAVING\`:

\`\`\`
SELECT categoria, SUM(stock) AS unidades
FROM productos
GROUP BY categoria
HAVING SUM(stock) > 100;
\`\`\`

| | Filtra… | Cuándo | Puede usar agregaciones |
| --- | --- | --- | --- |
| \`WHERE\` | filas | antes de agrupar | ❌ |
| \`HAVING\` | grupos | después de agrupar | ✅ |
`,
        '🪣',
      ),
      sqlDemo('WHERE y HAVING juntos', 'tienda', [
        ['SELECT categoria, SUM(stock) AS unidades FROM productos GROUP BY categoria HAVING SUM(stock) > 100;', 'Solo las categorías con más de 100 unidades'],
        ['SELECT categoria, COUNT(*) AS n FROM productos WHERE precio > 20 GROUP BY categoria HAVING COUNT(*) >= 2 ORDER BY n DESC, categoria;', 'Primero WHERE quita productos baratos; luego se agrupa; y HAVING se queda con los grupos de 2 o más'],
      ]),
      sqlDemo('El error típico', 'tienda', [
        sqlErr('SELECT categoria, COUNT(*) FROM productos WHERE COUNT(*) > 2 GROUP BY categoria;', 'No se puede usar una agregación en WHERE. El mensaje te manda a HAVING'),
      ]),
      mc('Quieres las categorías que tienen **más de 3 productos**. ¿Dónde pones la condición?', ['En WHERE: `WHERE COUNT(*) > 3`', 'En HAVING: `HAVING COUNT(*) > 3`', 'En ORDER BY', 'En FROM'], 1, 'La condición depende de un recuento por grupo, así que va en `HAVING`.'),
      order('Ordena las cláusulas de la consulta', ['SELECT', 'categoria,', 'COUNT(*)', 'FROM', 'productos', 'GROUP', 'BY', 'categoria', 'HAVING', 'COUNT(*)', '>=', '3;'], 'SELECT categoria, COUNT(*) FROM productos GROUP BY categoria HAVING COUNT(*) >= 3;', '`HAVING` va justo después de `GROUP BY`.'),
      sqlOut('Predice qué categorías sobreviven', 'tienda', 'SELECT categoria, COUNT(*) FROM productos GROUP BY categoria HAVING COUNT(*) >= 3 ORDER BY categoria;', ['accesorios | 4\naudio | 2\nordenadores | 3\npantallas | 2\nperifericos | 3', 'accesorios | 4', 'accesorios | 4\nordenadores | 3\nperifericos | 3\naudio | 2'], 'Cinco categorías en total, pero solo tres tienen 3 o más productos: accesorios (4), ordenadores (3) y periféricos (3).'),
      tf('Se puede escribir `HAVING` sin `GROUP BY` y filtrar filas sueltas, como con `WHERE`.', false, '`HAVING` filtra grupos; para filas sueltas usa `WHERE`. (Sin `GROUP BY`, todo el conjunto es un único grupo.)'),
      sqlCode('Muestra las categorías cuyo precio medio supera los 100 €: `categoria` y `precio_medio` (redondeado a 2 decimales).', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: 'SELECT categoria, ROUND(AVG(precio), 2) AS precio_medio FROM productos GROUP BY categoria HAVING AVG(precio) > 100;',
        hint: 'HAVING AVG(precio) > 100',
        why: 'La condición depende de una media por categoría, así que va en `HAVING`.',
      }),
      sqlPractice({
        goal: 'Usuarios estrella',
        prompt: 'En la red social quieren premiar a los usuarios que **acumulan 50 o más likes** entre todas sus publicaciones.\n\n**Muestra `usuario_id` y el total como `likes`, ordenado de más a menos likes.**',
        setup: 'social',
        check: ordered({ names: true }),
        solution: 'SELECT usuario_id, SUM(likes) AS likes FROM publicaciones GROUP BY usuario_id HAVING SUM(likes) >= 50 ORDER BY likes DESC;',
        hints: ['Agrupa por usuario y suma los likes.', '`HAVING SUM(likes) >= 50`'],
        explain: 'Para filtrar por un total o un recuento, `HAVING`. El orden de las cláusulas siempre es `GROUP BY` → `HAVING` → `ORDER BY`.',
        commands: ['HAVING', 'SUM'],
      }),
      sqlPractice({
        goal: 'Géneros con al menos dos películas',
        prompt: 'Para el festival solo interesan los géneros con **2 o más películas**.\n\n**Muestra `genero`, `peliculas` (cuántas) y `media` (puntuación media a 2 decimales), ordenado por media de mayor a menor.**',
        setup: 'cine',
        check: ordered({ names: true }),
        solution: 'SELECT genero, COUNT(*) AS peliculas, ROUND(AVG(puntuacion), 2) AS media FROM peliculas GROUP BY genero HAVING COUNT(*) >= 2 ORDER BY media DESC;',
        hints: ['El filtro es sobre un recuento por género.', '`HAVING COUNT(*) >= 2`'],
        explain: 'Un género con una sola película (terror) desaparece por el `HAVING`.',
        commands: ['HAVING', 'COUNT'],
      }),
      sqlPractice({
        goal: 'Departamentos grandes y bien pagados',
        prompt: 'Directivos quiere ver los departamentos con **2 o más empleados** (ignorando a quienes no tienen departamento) y su salario medio.\n\n**Muestra `departamento_id`, `empleados` y `salario_medio` (2 decimales), de mayor a menor salario medio.** Usa `WHERE` para quitar el NULL y `HAVING` para el tamaño.',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['WHERE', 'HAVING'] }),
        solution: 'SELECT departamento_id, COUNT(*) AS empleados, ROUND(AVG(salario), 2) AS salario_medio FROM empleados WHERE departamento_id IS NOT NULL GROUP BY departamento_id HAVING COUNT(*) >= 2 ORDER BY salario_medio DESC;',
        hints: ['`WHERE` filtra filas (los sin departamento) antes de agrupar.', '`HAVING COUNT(*) >= 2` filtra grupos después.'],
        explain: '`WHERE` y `HAVING` conviven: el primero reduce las filas de entrada; el segundo, los grupos de salida.',
        commands: ['WHERE', 'HAVING'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s4-4', { title: 'Agrupar con más imaginación', summary: 'Varias columnas, fechas, CASE y conteos condicionales', emoji: '🎛️', commands: ['GROUP BY', 'FILTER'], minutes: 10 }, [
      learn(
        'Agrupar por varias columnas',
        `
Puedes agrupar por **más de una columna**: cada **combinación** distinta es un grupo.

\`\`\`
SELECT ciudad, vip, COUNT(*) AS clientes
FROM clientes
GROUP BY ciudad, vip;
\`\`\`

Esto cuenta los clientes **por ciudad y, dentro de cada ciudad, por si son VIP o no**. Madrid tendrá dos filas: una para VIP y otra para no VIP.
`,
        '🎛️',
      ),
      sqlDemo('Grupos de dos columnas', 'tienda', [
        ['SELECT ciudad, vip, COUNT(*) AS clientes FROM clientes GROUP BY ciudad, vip ORDER BY ciudad, vip;', 'Una fila por combinación ciudad + vip'],
      ]),
      learn(
        'Agrupar por un cálculo',
        `
Se puede agrupar por **cualquier expresión**, no solo por una columna. Los dos ejemplos clásicos:

- **Por mes**: \`GROUP BY strftime('%Y-%m', fecha)\`
- **Por tramos** con \`CASE\`: baratos, medios y caros.

Al escribir la expresión en el \`SELECT\` con un alias, puedes repetir **el alias** en el \`GROUP BY\`:

\`\`\`
SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos
FROM pedidos
GROUP BY mes
ORDER BY mes;
\`\`\`
`,
        '🧪',
      ),
      sqlDemo('Por mes y por tramos', 'tienda', [
        ["SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos FROM pedidos GROUP BY mes ORDER BY mes LIMIT 6;", 'Pedidos por mes'],
        ["SELECT CASE WHEN precio < 30 THEN 'barato' WHEN precio < 300 THEN 'medio' ELSE 'caro' END AS gama, COUNT(*) AS n, ROUND(AVG(precio), 2) AS media FROM productos GROUP BY gama ORDER BY n DESC;", 'Productos por gama: el CASE crea los grupos'],
      ]),
      learn(
        'Contar solo algunas filas dentro de cada grupo',
        `
Un informe muy típico: por cada estado, «cuántos pedidos hay **en total** y cuántos **desde junio**». Hay dos formas de hacerlo dentro del mismo \`GROUP BY\`:

\`\`\`
COUNT(*) FILTER (WHERE fecha >= '2024-06-01')          -- moderna y clara
SUM(CASE WHEN fecha >= '2024-06-01' THEN 1 ELSE 0 END)  -- funciona en todos los motores
\`\`\`

\`FILTER (WHERE …)\` aplica la condición **solo a esa agregación**. La técnica del \`CASE\` hace que cada fila aporte 1 o 0 a la suma.
`,
        '🎯',
      ),
      sqlDemo('Totales y subtotales en una pasada', 'tienda', [
        ["SELECT estado, COUNT(*) AS total, COUNT(*) FILTER (WHERE fecha >= '2024-06-01') AS desde_junio, SUM(CASE WHEN fecha >= '2024-06-01' THEN 1 ELSE 0 END) AS desde_junio_case FROM pedidos GROUP BY estado ORDER BY estado;", 'Las dos formas dan lo mismo'],
      ]),
      mc('¿Cuántas filas puede dar como mucho `GROUP BY ciudad, vip` si hay 7 ciudades y 2 valores de `vip`?', ['7', '2', '14', '9'], 2, 'Como mucho una fila por combinación posible: 7 × 2 = 14 (en la práctica menos, porque no todas las combinaciones existen).'),
      sqlOut('Predice los grupos', 'tienda', 'SELECT vip, COUNT(*) FROM clientes GROUP BY vip ORDER BY vip;', ['false | 4\ntrue | 8', 'true | 4\nfalse | 8', 'false | 12'], '4 clientes son VIP y 8 no: `false` sale antes que `true` en el orden ascendente.'),
      tf('Al agrupar por una expresión como `strftime(\'%Y-%m\', fecha)`, la expresión debe repetirse o usar su alias en el `GROUP BY`.', true, 'Sí: el `SELECT` solo puede mostrar lo que está en el `GROUP BY` o dentro de una agregación; con el alias lo escribes una sola vez.'),
      sqlCode('Cuenta los pedidos por mes (`mes` en formato `AAAA-MM` y `pedidos`), ordenados por mes.', {
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos FROM pedidos GROUP BY mes ORDER BY mes;",
        hint: "GROUP BY strftime('%Y-%m', fecha)",
        why: 'Se agrupa por el mes extraído de cada fecha.',
      }),
      sqlPractice({
        goal: 'Productos por gama',
        prompt: 'Clasifica los productos en `barato` (menos de 30 €), `medio` (de 30 a menos de 300 €) y `caro` (300 € o más).\n\n**Muestra `gama`, cuántos productos hay (`n`) y el precio medio (`media`, 2 decimales), ordenado por `n` de mayor a menor.**',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT CASE WHEN precio < 30 THEN 'barato' WHEN precio < 300 THEN 'medio' ELSE 'caro' END AS gama, COUNT(*) AS n, ROUND(AVG(precio), 2) AS media FROM productos GROUP BY gama ORDER BY n DESC;",
        hints: ['Escribe el CASE en el SELECT con el alias `gama`.', 'Agrupa por ese alias.'],
        explain: 'Un `CASE` dentro del `GROUP BY` convierte números en tramos y luego resume cada tramo.',
        commands: ['GROUP BY', 'CASE'],
      }),
      sqlPractice({
        goal: 'Evolución mensual de los pedidos',
        prompt: 'Contabilidad quiere ver cómo evolucionan los pedidos.\n\n**Muestra `mes` (formato `AAAA-MM`), `pedidos` (cuántos) y `entregados` (cuántos están en estado `entregado`), ordenado por mes.** Usa `FILTER` o `SUM(CASE …)` para `entregados`.',
        setup: 'tienda',
        check: ordered({ names: true }),
        solution: "SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos, COUNT(*) FILTER (WHERE estado = 'entregado') AS entregados FROM pedidos GROUP BY mes ORDER BY mes;",
        hints: ['Agrupa por mes con `strftime`.', "`COUNT(*) FILTER (WHERE estado = 'entregado')`"],
        explain: 'Un recuento total y uno condicional en la misma consulta: la base de los informes de «cuántos y cuántos de ellos…».',
        commands: ['GROUP BY', 'FILTER'],
      }),
      sqlPractice({
        goal: 'Libros por género y siglo',
        prompt: 'En la biblioteca quieres saber cuántos títulos hay de cada **género** según sean anteriores o no a 1960.\n\n**Muestra `genero`, `antiguos` (publicados antes de 1960, usa `FILTER`) y `modernos` (publicados en 1960 o después), ordenado por género.** Los libros sin año (NULL) no cuentan en ninguno.',
        setup: 'biblioteca',
        check: ordered({ names: true }),
        solution: 'SELECT genero, COUNT(*) FILTER (WHERE anio < 1960) AS antiguos, COUNT(*) FILTER (WHERE anio >= 1960) AS modernos FROM libros GROUP BY genero ORDER BY genero;',
        hints: ['Dos `FILTER` en el mismo SELECT.', 'Los NULL no cumplen ni `< 1960` ni `>= 1960`.'],
        explain: 'Dos recuentos condicionales a la vez son una «tabla de contingencia» en miniatura. Los libros sin año no entran en ninguna de las dos columnas.',
        commands: ['FILTER', 'GROUP BY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s4-5', { title: 'El orden en que SQL piensa', summary: 'Por qué una consulta se escribe en un orden y se ejecuta en otro', emoji: '🧭', commands: ['SELECT', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY'], minutes: 10 }, [
      learn(
        'Se escribe de una forma, se piensa de otra',
        `
Tú escribes \`SELECT\` primero. Pero la base de datos **no empieza por ahí**. Procesa una consulta en este orden:

1. \`FROM\` — de qué tablas leer.
2. \`WHERE\` — descartar filas.
3. \`GROUP BY\` — formar grupos.
4. \`HAVING\` — descartar grupos.
5. \`SELECT\` — calcular las columnas y los alias.
6. \`DISTINCT\` — quitar repetidos.
7. \`ORDER BY\` — ordenar.
8. \`LIMIT\` / \`OFFSET\` — recortar.

Casi todos los «¿por qué esto no funciona?» de SQL se explican con esta lista.
`,
        '🧭',
      ),
      illus('sql-eval-order', 'El orden de ejecución', 'Cada fase recibe lo que dejó la anterior. Toca una cláusula para ver qué hace con los datos.'),
      learn(
        'Lo que explica este orden',
        `
- **Un alias del \`SELECT\` no se puede usar en el \`WHERE\`**, porque el \`WHERE\` se ejecuta _antes_ de calcularlo. (Sí se puede en el \`ORDER BY\`, que va después.)
- **No hay agregaciones en el \`WHERE\`**: los grupos aún no existen. Para eso hay \`HAVING\`.
- **\`ORDER BY\` ve el resultado final**, así que puede ordenar por alias o por una agregación.
- **\`LIMIT\` va al final**: primero se ordena todo y luego se recorta. Por eso «los 3 más caros» funciona.
`,
      ),
      sqlDemo('Probando el orden', 'tienda', [
        sqlErr('SELECT nombre, precio * 2 AS doble FROM productos WHERE doble > 100;', 'El WHERE no conoce el alias «doble»: aún no se ha calculado'),
        ['SELECT nombre, precio * 2 AS doble FROM productos WHERE precio * 2 > 100 ORDER BY doble DESC;', 'Repitiendo la expresión en el WHERE funciona; y ORDER BY sí puede usar el alias'],
      ]),
      order('Ordena las fases en el orden en que SQL las procesa', ['FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'SELECT', 'ORDER', 'BY', 'LIMIT'], 'FROM WHERE GROUP BY HAVING SELECT ORDER BY LIMIT', 'Primero se lee la tabla (`FROM`), se filtran filas (`WHERE`), se agrupa, se filtran grupos (`HAVING`), se calculan las columnas (`SELECT`), se ordena y por último se recorta.'),
      mc('¿Por qué falla `WHERE total > 10` si `total` es un alias definido en el `SELECT`?', ['Porque total es una palabra reservada', 'Porque el WHERE se ejecuta antes que el SELECT y el alias aún no existe', 'Porque los alias solo valen con comillas', 'No falla: funciona siempre'], 1, 'El `WHERE` se evalúa antes del `SELECT`. Repite la expresión o usa `HAVING` / una subconsulta.'),
      tf('`ORDER BY` puede usar un alias definido en el `SELECT`.', true, 'Sí: `ORDER BY` se ejecuta después del `SELECT`, así que ya conoce los alias.'),
      sqlOut('Predice: ¿qué meses tienen más de 3 pedidos?', 'tienda', "SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS pedidos FROM pedidos GROUP BY mes HAVING COUNT(*) >= 3 ORDER BY mes LIMIT 4;", ['2024-01 | 1\n2024-02 | 2\n2024-03 | 3\n2024-04 | 3', '2024-03 | 3\n2024-04 | 3\n2024-05 | 3\n2024-09 | 3', '2024-04 | 3\n2024-05 | 3\n2024-06 | 3\n2024-07 | 2'], 'Se agrupa por mes, `HAVING` se queda con los meses de 3 o más, se ordenan y `LIMIT` toma los 4 primeros: marzo, abril, mayo y junio.'),
      sqlCode('Muestra los pedidos por estado, solo de pedidos hechos desde el 1 de mayo de 2024, y quédate con los estados que tienen al menos 2 pedidos (`estado` y `pedidos`).', {
        setup: 'tienda',
        check: same({ names: true }),
        solution: "SELECT estado, COUNT(*) AS pedidos FROM pedidos WHERE fecha >= '2024-05-01' GROUP BY estado HAVING COUNT(*) >= 2;",
        hint: 'WHERE para la fecha, HAVING para el recuento',
        why: '`WHERE` reduce las filas antes de agrupar y `HAVING` reduce los grupos después.',
      }),
      sqlPractice({
        goal: 'El informe de la red social',
        prompt: 'Para el informe de comunidad quieres ver a quienes publican con regularidad.\n\n**Muestra `usuario_id`, número de publicaciones (`posts`) y likes totales (`likes`) de todos los usuarios, pero solo los que tengan al menos 2 publicaciones, ordenados por `likes` descendente.**',
        setup: 'social',
        check: ordered({ names: true }),
        solution: 'SELECT usuario_id, COUNT(*) AS posts, SUM(likes) AS likes FROM publicaciones GROUP BY usuario_id HAVING COUNT(*) >= 2 ORDER BY likes DESC;',
        hints: ['Agrupa por usuario.', '`HAVING COUNT(*) >= 2` y ordena por el alias `likes`.'],
        explain: 'Agrupar, filtrar grupos y ordenar por un alias: cada pieza en su fase.',
        commands: ['GROUP BY', 'HAVING', 'ORDER BY'],
      }),
      sqlPractice({
        goal: 'Libros que más páginas aportan',
        prompt: 'La biblioteca quiere saber qué géneros aportan más páginas al catálogo.\n\n**Muestra `genero`, `titulos` (cuántos libros) y `paginas` (suma de páginas), pero solo de libros publicados en 1950 o después, y de los 3 géneros con más páginas.**',
        setup: 'biblioteca',
        check: ordered({ names: true }),
        solution: 'SELECT genero, COUNT(*) AS titulos, SUM(paginas) AS paginas FROM libros WHERE anio >= 1950 GROUP BY genero ORDER BY paginas DESC LIMIT 3;',
        hints: ['`WHERE` para el año, antes de agrupar.', 'Ordena por el total y recorta con `LIMIT 3`.'],
        explain: 'Las fases en orden: `FROM` → `WHERE` (año) → `GROUP BY` (género) → `SELECT` (cálculos) → `ORDER BY` → `LIMIT`.',
        commands: ['WHERE', 'GROUP BY', 'ORDER BY'],
      }),
      sqlPractice({
        goal: 'Ventas a gran escala',
        prompt: 'La tabla `ventas` tiene **6000 filas**. Con SQL da igual: ¡se resume en un instante!\n\n**Muestra `producto`, `ventas` (cuántas hay) y `media` (importe medio, 2 decimales) de los productos cuyo importe medio supera los 105 €, ordenado por `media` de mayor a menor.**',
        setup: 'ventas_grande',
        check: ordered({ names: true }),
        solution: 'SELECT producto, COUNT(*) AS ventas, ROUND(AVG(importe), 2) AS media FROM ventas GROUP BY producto HAVING AVG(importe) > 105 ORDER BY media DESC;',
        hints: ['Agrupa por producto.', '`HAVING AVG(importe) > 105`'],
        explain: 'Seis mil filas o seis millones: la consulta es la misma. SQL describe **qué** quieres y la base de datos se encarga del resto.',
        commands: ['GROUP BY', 'HAVING'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: los tres mejores meses',
    prompt:
      'La directora quiere saber cuáles fueron los **3 meses con más facturación** en la tabla `ventas` (6000 ventas).\n\n**Muestra `mes` (formato `AAAA-MM`), `ventas` (cuántas) y `total` (suma de importes, redondeada a 2 decimales), ordenado de más a menos facturación y solo los 3 primeros.**',
    setup: 'ventas_grande',
    check: ordered({ names: true }),
    solution: "SELECT strftime('%Y-%m', fecha) AS mes, COUNT(*) AS ventas, ROUND(SUM(importe), 2) AS total FROM ventas GROUP BY mes ORDER BY total DESC LIMIT 3;",
    hints: ['Agrupa por mes con `strftime`.', 'Ordena por `total` descendente y limita a 3.'],
    explain: 'Agrupar por mes, resumir, ordenar y recortar: has completado el nivel Básico de SQL. ¡Ya piensas en conjuntos de datos, no en filas sueltas!',
    commands: ['GROUP BY', 'SUM', 'ORDER BY'],
  },
});
