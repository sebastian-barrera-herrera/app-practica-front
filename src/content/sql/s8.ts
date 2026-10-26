import { fill, learn, lesson, mc, order, tf } from '../build';
import { both, fails, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld, state } from '../sqlbuild';

const AJUSTES = "CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor INTEGER NOT NULL); INSERT INTO ajustes VALUES ('visitas', 10), ('likes', 3);";

export const s8 = sqlWorld({
  id: 's8',
  index: 8,
  title: 'Modificar datos',
  subtitle: 'INSERT, UPDATE y DELETE sin romper nada',
  emoji: '✏️',
  color: '#F87171',
  level: 'intermedio',
  intro:
    'Hasta aquí solo has mirado datos. Ahora vas a **cambiarlos**: añadir filas nuevas, corregir las que están mal y borrar las que sobran. Es la parte más poderosa… y la más peligrosa: un `UPDATE` sin `WHERE` cambia **todas** las filas, y un `DELETE` mal escrito no tiene botón de deshacer. Por eso esta zona enseña también los hábitos de seguridad que usan los profesionales: probar con `SELECT` antes, leer los errores de las restricciones y trabajar dentro de una transacción.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s8-1', { title: 'INSERT: añadir filas', summary: 'Una, varias o copiadas de otra consulta', emoji: '➕', commands: ['INSERT'], minutes: 9 }, [
      learn(
        'Añadir una fila',
        `
\`INSERT INTO\` añade filas nuevas a una tabla. Lo habitual es indicar **qué columnas** rellenas y sus valores **en el mismo orden**:

\`\`\`
INSERT INTO clientes (nombre, ciudad, email, fecha_alta)
VALUES ('Nuevo Cliente', 'León', 'nuevo@mail.com', '2025-01-10');
\`\`\`

Las columnas que **no nombras** reciben su valor por defecto:

- Un \`id\` autoincremental se calcula solo (aquí será el 13).
- Una columna con \`DEFAULT\` toma ese valor (\`vip\` es \`false\`).
- Una columna sin \`DEFAULT\` queda en \`NULL\`… **salvo que sea \`NOT NULL\`**, y entonces es un error.

> TIP: Escribe siempre la lista de columnas. Sin ella dependes del orden exacto de la tabla, y un cambio futuro te rompería todos los \`INSERT\`.
`,
        '➕',
      ),
      sqlDemo('Insertar y comprobar', 'tienda', [
        ["INSERT INTO clientes (nombre, ciudad, email, fecha_alta) VALUES ('Nuevo Cliente', 'León', 'nuevo@mail.com', '2025-01-10');", 'El motor confirma cuántas filas se insertaron'],
        ["SELECT id, nombre, vip FROM clientes WHERE nombre = 'Nuevo Cliente';", 'Comprobamos con un SELECT: id automático (13) y vip tomó su DEFAULT (false)'],
        ["INSERT INTO clientes (nombre, fecha_alta) VALUES ('Ana', '2025-01-10'), ('Beto', '2025-01-11'), ('Cleo', '2025-01-12');", 'Varias filas a la vez: una lista de paréntesis separados por comas'],
        ['SELECT id, nombre, ciudad FROM clientes WHERE id > 12 ORDER BY id;', 'Cuatro clientes nuevos (13 a 16)'],
      ], 'Cada demo parte de la base de datos original y los cambios solo viven dentro de la demostración: puedes experimentar sin miedo.'),
      learn(
        'La base de datos se defiende',
        `
Las **restricciones** de las tablas (\`NOT NULL\`, \`UNIQUE\`, \`CHECK\`, claves foráneas) **rechazan** los datos que no cumplen las reglas. El \`INSERT\` falla **entero** y no queda nada a medias. Los mensajes dicen qué regla saltó:

- Falta un dato obligatorio → «no admite NULL».
- Email repetido → «valor duplicado».
- Precio 0 con \`CHECK (precio > 0)\` → «se incumple la restricción CHECK».
- Cliente que no existe → «clave foránea».
`,
        '🛡️',
      ),
      sqlDemo('Insertos rechazados', 'tienda', [
        sqlErr("INSERT INTO clientes (nombre) VALUES ('Sin fecha');", 'Falta fecha_alta, que es NOT NULL'),
        sqlErr("INSERT INTO clientes (nombre, fecha_alta, email) VALUES ('Dup', '2025-01-01', 'ana@mail.com');", 'Ese email ya existe y la columna es UNIQUE'),
        sqlErr("INSERT INTO productos (nombre, categoria, precio) VALUES ('Gratis', 'audio', 0);", 'CHECK (precio > 0): el precio 0 no vale'),
        sqlErr("INSERT INTO pedidos (cliente_id, fecha, estado) VALUES (999, '2025-01-01', 'pendiente');", 'Clave foránea: el cliente 999 no existe'),
      ]),
      learn(
        'INSERT … SELECT: copiar filas',
        `
En lugar de \`VALUES\`, un \`INSERT\` puede tomar sus filas **del resultado de una consulta**:

\`\`\`
INSERT INTO clientes_vip (id, nombre, email)
SELECT id, nombre, email
FROM clientes
WHERE vip;
\`\`\`

Es la forma de **copiar** o **transformar** datos de una tabla a otra de golpe. Las columnas del \`SELECT\` deben coincidir en número y orden con las del \`INSERT\`.
`,
        '📋',
      ),
      mc('¿Qué pasa con las columnas que no nombras en un `INSERT`?', ['El INSERT falla siempre', 'Reciben su valor por defecto (DEFAULT, autoincremento) o NULL', 'Se copian de la fila anterior', 'Se rellenan con 0'], 1, 'Reciben su `DEFAULT` si lo tienen, o `NULL` si no. Si además son `NOT NULL`, el `INSERT` falla.'),
      sqlOut('Predice los datos insertados', 'tienda', "INSERT INTO clientes (nombre, fecha_alta) VALUES ('Zoe', '2025-02-02'), ('Leo', '2025-02-03'); SELECT id, nombre, vip FROM clientes WHERE id > 12 ORDER BY id;", ['13 | Zoe | NULL\n14 | Leo | NULL', '12 | Zoe | false\n13 | Leo | false', '13 | Zoe | true\n14 | Leo | true'], 'Los ids siguen al último (13 y 14) y `vip` toma su `DEFAULT false` porque no se indicó.'),
      tf('Si un `INSERT` de varias filas falla en la tercera, las dos primeras se quedan guardadas.', false, 'Una sentencia es **atómica**: o se aplica entera o no se aplica nada. Si falla, la tabla queda como estaba.'),
      sqlCode('Inserta un cliente llamado `\'Marina\'` con fecha de alta `\'2025-03-01\'` (el resto de columnas, por defecto).', {
        setup: 'tienda',
        check: state(['clientes']),
        solution: "INSERT INTO clientes (nombre, fecha_alta) VALUES ('Marina', '2025-03-01');",
        hint: 'INSERT INTO clientes (nombre, fecha_alta) VALUES (…)',
        why: 'Las columnas que no se nombran (id, ciudad, email, vip) toman su valor por defecto.',
      }),
      sqlPractice({
        goal: 'Nuevo cliente',
        prompt: 'Acaba de registrarse un cliente. Añádelo:\n\n- **nombre**: `Valeria Costa`\n- **ciudad**: `León`\n- **email**: `valeria@mail.com`\n- **fecha_alta**: `2025-01-15`\n\nEl `id` y `vip` se rellenan solos.',
        setup: 'tienda',
        check: state(['clientes']),
        solution: "INSERT INTO clientes (nombre, ciudad, email, fecha_alta) VALUES ('Valeria Costa', 'León', 'valeria@mail.com', '2025-01-15');",
        hints: ['`INSERT INTO clientes (columnas) VALUES (valores)`.', 'Los textos y las fechas van entre comillas simples.'],
        explain: 'Un `INSERT` con lista de columnas es claro y robusto. El `id` (13) lo calcula la base de datos.',
        commands: ['INSERT'],
      }),
      sqlPractice({
        goal: 'Tres productos de golpe',
        prompt: 'Llegan tres productos nuevos al almacén:\n\n| nombre | categoria | precio | stock |\n| --- | --- | --- | --- |\n| Webcam 4K | perifericos | 89.90 | 15 |\n| Soporte monitor | accesorios | 24.50 | 40 |\n| Micrófono USB | audio | 54.00 | 12 |\n\n**Insértalos con una sola sentencia.**',
        setup: 'tienda',
        check: state(['productos']),
        solution: "INSERT INTO productos (nombre, categoria, precio, stock) VALUES ('Webcam 4K', 'perifericos', 89.90, 15), ('Soporte monitor', 'accesorios', 24.50, 40), ('Micrófono USB', 'audio', 54.00, 12);",
        hints: ['Una sola lista `VALUES` con tres paréntesis separados por comas.', 'Indica las 4 columnas: nombre, categoria, precio, stock.'],
        explain: 'Un `INSERT` de varias filas es más rápido que tres separados y es atómico: o entran los tres o ninguno.',
        commands: ['INSERT'],
      }),
      sqlPractice({
        goal: 'Copiar los clientes VIP',
        prompt: 'Marketing mantiene una tabla aparte, `clientes_vip` (ya creada y vacía), con `id`, `nombre` y `email`.\n\n**Copia en ella los clientes VIP de `clientes`** (los tres campos) con un solo `INSERT … SELECT`.',
        setup: { db: 'tienda', script: 'CREATE TABLE clientes_vip (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT);' },
        check: state(['clientes_vip']),
        solution: 'INSERT INTO clientes_vip (id, nombre, email) SELECT id, nombre, email FROM clientes WHERE vip;',
        hints: ['Sustituye `VALUES (…)` por un `SELECT`.', 'El `WHERE vip` filtra a los VIP.'],
        explain: '`INSERT … SELECT` copia cualquier resultado de consulta. Se usa para archivar datos, cargar tablas de resumen o migrar información.',
        commands: ['INSERT', 'SELECT'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s8-2', { title: 'UPDATE: corregir filas', summary: 'SET, WHERE y el peligro de olvidarlo', emoji: '🛠️', commands: ['UPDATE'], minutes: 9 }, [
      learn(
        'Cambiar valores existentes',
        `
\`UPDATE\` modifica filas que ya existen:

\`\`\`
UPDATE productos
SET precio = precio * 1.10
WHERE categoria = 'audio';
\`\`\`

- \`SET\` dice **qué columnas** cambian y con qué valores (pueden ser cálculos con el valor actual). Varias separadas por comas: \`SET stock = 100, precio = 9.99\`.
- \`WHERE\` dice **qué filas**. Funciona igual que en un \`SELECT\`.

> OJO: **Sin \`WHERE\`, el \`UPDATE\` cambia TODAS las filas de la tabla.** Es el error más famoso de SQL. Antes de ejecutar un \`UPDATE\`, escribe el mismo \`WHERE\` en un \`SELECT\` y comprueba que devuelve justo lo que quieres cambiar.
`,
        '🛠️',
      ),
      sqlDemo('Subir precios con cabeza', 'tienda', [
        ["SELECT nombre, precio FROM productos WHERE categoria = 'audio';", 'Primero MIRAMOS qué filas vamos a tocar'],
        ["UPDATE productos SET precio = ROUND(precio * 1.10, 2) WHERE categoria = 'audio';", 'Ahora sí, con el mismo WHERE: el motor dice cuántas filas cambió (2)'],
        ["SELECT nombre, precio FROM productos WHERE categoria = 'audio';", 'Comprobamos el resultado'],
      ]),
      sqlDemo('El UPDATE sin WHERE', 'tienda', [
        ['UPDATE productos SET precio = 10;', '¡14 filas actualizadas! Todos los productos cuestan ahora lo mismo'],
        ['SELECT COUNT(DISTINCT precio) AS precios_distintos FROM productos;', 'Solo queda un precio distinto. Esto en producción sería un desastre'],
      ], 'Aquí se ve el riesgo. Los cambios de esta demo no son reales, pero la lección sí lo es.'),
      learn(
        'UPDATE con subconsulta',
        `
El \`WHERE\` de un \`UPDATE\` admite todo lo que has aprendido: \`IN\`, subconsultas, \`EXISTS\`…

\`\`\`
UPDATE clientes
SET vip = true
WHERE id IN (
  SELECT cliente_id FROM pedidos
  WHERE estado <> 'cancelado'
  GROUP BY cliente_id
  HAVING COUNT(*) >= 3
);
\`\`\`

«Marca como VIP a quien tenga 3 o más pedidos válidos». Una sola sentencia sustituye a un programa entero.
`,
        '🧠',
      ),
      mc('Ejecutas `UPDATE clientes SET vip = true;` sin `WHERE`. ¿Qué ocurre?', ['Falla por falta de WHERE', 'Todos los clientes pasan a ser VIP', 'Solo cambia la primera fila', 'No cambia nada'], 1, 'Sin `WHERE`, el `UPDATE` afecta a todas las filas de la tabla.'),
      sqlOut('Predice el stock tras el UPDATE', 'tienda', 'UPDATE productos SET stock = stock - 5 WHERE id = 1; SELECT stock FROM productos WHERE id = 1;', ['25', '5', '-5'], 'El teclado mecánico tenía 25 unidades: `stock - 5` deja 20.'),
      sqlOut('Y si se olvida el WHERE…', 'tienda', 'UPDATE productos SET precio = 10; SELECT COUNT(DISTINCT precio) FROM productos;', ['14', '0', '10'], 'Todos los productos quedan con precio 10: solo hay **un** precio distinto.'),
      tf('En un `UPDATE` puedes cambiar varias columnas a la vez separándolas con comas en el `SET`.', true, 'Por ejemplo `SET stock = 100, precio = 9.99`.'),
      fill('Completa: pon a 0 el stock del producto 8', '___ productos ___ stock = 0 WHERE id = 8;', ['UPDATE', 'SET', 'INSERT', 'FROM'], ['UPDATE', 'SET'], '`UPDATE tabla SET columna = valor WHERE condición`.'),
      sqlCode('Sube un 5 % el salario (`salario * 1.05`) de todos los empleados del departamento 3 (Ventas).', {
        setup: 'empresa',
        check: state(['empleados']),
        solution: 'UPDATE empleados SET salario = salario * 1.05 WHERE departamento_id = 3;',
        hint: 'UPDATE empleados SET salario = salario * 1.05 WHERE …',
        why: 'El `WHERE` limita el cambio a Ventas; el `SET` usa el valor actual del salario para calcular el nuevo.',
      }),
      sqlPractice({
        goal: 'Oferta en audio',
        prompt: 'Empiezan las rebajas del **15 %** en la categoría `audio`.\n\n**Actualiza el precio de los productos de audio multiplicándolo por 0.85.**',
        setup: 'tienda',
        check: state(['productos']),
        solution: "UPDATE productos SET precio = precio * 0.85 WHERE categoria = 'audio';",
        hints: ['Cambia solo la columna `precio`.', 'El `WHERE` debe limitar a la categoría audio.'],
        explain: 'Un `UPDATE` con cálculo sobre el propio valor y un `WHERE` preciso. Probar antes con un `SELECT` evitaría sorpresas.',
        commands: ['UPDATE'],
      }),
      sqlPractice({
        goal: 'Ciudades por rellenar',
        prompt: 'Los clientes sin ciudad estropean los informes. Hasta que se completen, ponles el texto `Desconocida`.\n\n**Actualiza la ciudad de los clientes cuya ciudad es NULL.**',
        setup: 'tienda',
        check: state(['clientes']),
        solution: "UPDATE clientes SET ciudad = 'Desconocida' WHERE ciudad IS NULL;",
        hints: ['Recuerda: con NULL se usa `IS NULL`, no `=`.', "`SET ciudad = 'Desconocida'`"],
        explain: 'Un `WHERE ciudad = NULL` no habría cambiado nada. `IS NULL` es la única forma correcta de encontrar los vacíos.',
        commands: ['UPDATE', 'IS NULL'],
      }),
      sqlPractice({
        goal: 'Promoción a VIP',
        prompt: 'La directora quiere premiar la fidelidad: **marca como VIP** (`vip = true`) a los clientes que tengan **2 o más pedidos no cancelados**.\n\n**Escribe el `UPDATE`.** (Pista: subconsulta con `IN`.)',
        setup: 'tienda',
        check: state(['clientes']),
        solution: "UPDATE clientes SET vip = true WHERE id IN (SELECT cliente_id FROM pedidos WHERE estado <> 'cancelado' GROUP BY cliente_id HAVING COUNT(*) >= 2);",
        hints: ['La subconsulta devuelve los `cliente_id` con 2 o más pedidos válidos.', '`WHERE id IN (SELECT …)`'],
        explain: 'Combinar `UPDATE` con una subconsulta es el estándar para cambios «masivos con criterio».',
        commands: ['UPDATE', 'Subconsulta'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s8-3', { title: 'DELETE y TRUNCATE', summary: 'Borrar filas con seguridad', emoji: '🗑️', commands: ['DELETE', 'TRUNCATE'], minutes: 9 }, [
      learn(
        'Borrar filas',
        `
\`DELETE FROM\` elimina las filas que cumplan el \`WHERE\`:

\`\`\`
DELETE FROM clientes
WHERE id = 12;
\`\`\`

Igual que con \`UPDATE\`: **sin \`WHERE\` se borran todas las filas**. Y no hay papelera de reciclaje: salvo que uses una transacción (la verás en esta zona), lo borrado se pierde.

Hábito de oro: convierte el \`DELETE\` en \`SELECT\` (\`SELECT * FROM clientes WHERE id = 12\`), comprueba qué filas salen y solo entonces cámbialo a \`DELETE\`.
`,
        '🗑️',
      ),
      learn(
        'Las claves foráneas protegen a los padres',
        `
Si intentas borrar un cliente que **todavía tiene pedidos**, la base de datos lo impide: dejaría pedidos «huérfanos» apuntando a alguien que no existe.

\`\`\`
DELETE FROM clientes WHERE id = 1;  -- ¡error! tiene 4 pedidos
\`\`\`

Para borrar «hacia arriba» hay que ir **de hijos a padres**: primero las filas que dependen (\`detalle_pedido\`, luego \`pedidos\`) y por último el cliente. (Otra opción es definir la clave foránea con \`ON DELETE CASCADE\`, que borra los hijos automáticamente: lo verás en la zona de diseño.)
`,
        '⛓️',
      ),
      sqlDemo('Borrar y los límites', 'tienda', [
        ['SELECT id, nombre FROM clientes WHERE id NOT IN (SELECT cliente_id FROM pedidos);', 'Primero miramos: ¿quién no tiene pedidos? Raúl (id 12)'],
        ['DELETE FROM clientes WHERE id = 12;', 'Se puede borrar sin problema'],
        sqlErr('DELETE FROM clientes WHERE id = 1;', 'Ana tiene pedidos: la clave foránea lo impide y el mensaje dice cómo resolverlo'),
      ]),
      sqlDemo('Borrar de hijos a padres', 'tienda', [
        ["DELETE FROM detalle_pedido WHERE pedido_id IN (SELECT id FROM pedidos WHERE estado = 'cancelado');", 'Primero las líneas de los pedidos cancelados (los hijos)'],
        ["DELETE FROM pedidos WHERE estado = 'cancelado';", 'Ahora sí se pueden borrar los pedidos (los padres)'],
        ['SELECT COUNT(*) AS pedidos_restantes FROM pedidos;', '24 − 2 = 22'],
      ]),
      learn(
        'TRUNCATE: vaciar de golpe',
        `
\`TRUNCATE TABLE tabla\` **vacía la tabla entera** de una vez. Es mucho más rápido que un \`DELETE\` sin \`WHERE\` en tablas enormes, pero no admite condición y no se debe usar sobre tablas a las que apuntan claves foráneas.

Se usa con tablas **temporales o de trabajo** (cargas intermedias, caches), nunca con datos que importan.
`,
        '🧹',
      ),
      mc('¿Cuál es el orden correcto para borrar un cliente que tiene pedidos con líneas de detalle?', ['Cliente → pedidos → detalle', 'Detalle → pedidos → cliente', 'Pedidos → cliente → detalle', 'El orden da igual'], 1, 'Se borra de los «hijos» a los «padres»: primero las líneas, luego los pedidos y al final el cliente.'),
      sqlOut('Predice cuántos movimientos quedan', 'banco', 'DELETE FROM movimientos WHERE importe < 0; SELECT COUNT(*) FROM movimientos;', ['2', '5', '0'], 'Había 5 movimientos y 2 eran negativos (Alquiler y Cine): quedan 3.'),
      tf('`DELETE FROM clientes;` (sin WHERE) borra solo el primer cliente.', false, 'Sin `WHERE` se borran todas las filas (si las claves foráneas lo permiten).'),
      sqlCode('Borra los movimientos del banco cuyo importe, sin tener en cuenta el signo, sea menor que 100 (usa `ABS`).', {
        setup: 'banco',
        check: state(['movimientos']),
        solution: 'DELETE FROM movimientos WHERE ABS(importe) < 100;',
        hint: 'ABS(importe) < 100',
        why: '`ABS` quita el signo: así se tratan por igual gastos e ingresos pequeños.',
      }),
      sqlPractice({
        goal: 'Clientes que nunca compraron',
        prompt: 'Limpieza de datos: elimina de `clientes` a quienes **no tienen ningún pedido**.\n\n**Escribe el `DELETE`.** (Pista: `NOT EXISTS` o `NOT IN` con cuidado.)',
        setup: 'tienda',
        check: state(['clientes']),
        solution: 'DELETE FROM clientes WHERE NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = clientes.id);',
        hints: ['Para cada cliente, ¿existe algún pedido suyo?', '`NOT EXISTS` con `p.cliente_id = clientes.id`.'],
        explain: 'Un `DELETE` con `NOT EXISTS` borra solo lo que no tiene hijos, así que no choca con la clave foránea.',
        commands: ['DELETE', 'EXISTS'],
      }),
      sqlPractice({
        goal: 'Fuera los pedidos cancelados',
        prompt: 'Contabilidad quiere archivar los pedidos **cancelados**: bórralos de la base de datos.\n\n**Escribe las sentencias necesarias** (recuerda el orden: de hijos a padres), separadas por `;`.',
        setup: 'tienda',
        check: state(['pedidos', 'detalle_pedido']),
        solution: "DELETE FROM detalle_pedido WHERE pedido_id IN (SELECT id FROM pedidos WHERE estado = 'cancelado'); DELETE FROM pedidos WHERE estado = 'cancelado';",
        hints: ['Dos `DELETE`: primero `detalle_pedido`, luego `pedidos`.', "Para las líneas: `WHERE pedido_id IN (SELECT id FROM pedidos WHERE estado = 'cancelado')`."],
        explain: 'Si lo haces al revés, la clave foránea te lo impide. Respetar la dirección hijos → padres es la regla de oro del borrado.',
        commands: ['DELETE'],
      }),
      sqlPractice({
        goal: 'Vaciar la tabla de pruebas',
        prompt: 'Existe una tabla de trabajo `registro_temp` con datos de prueba que ya no hacen falta.\n\n**Vacíala por completo con `TRUNCATE`.**',
        setup: { db: 'vacia', script: "CREATE TABLE registro_temp (id INTEGER PRIMARY KEY, mensaje TEXT); INSERT INTO registro_temp (mensaje) VALUES ('a'), ('b'), ('c');" },
        check: state(['registro_temp']),
        solution: 'TRUNCATE TABLE registro_temp;',
        hints: ['`TRUNCATE TABLE nombre_de_la_tabla`.', 'No lleva `WHERE`.'],
        explain: '`TRUNCATE` vacía la tabla de un golpe. Úsalo solo con datos desechables.',
        commands: ['TRUNCATE'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s8-4', { title: 'RETURNING y UPSERT', summary: 'Ver lo que cambió y «insertar o actualizar»', emoji: '🔁', commands: ['RETURNING', 'ON CONFLICT'], minutes: 9 }, [
      learn(
        'RETURNING: qué ha cambiado',
        `
Muchas veces, tras un \`INSERT\`, necesitas saber **qué \`id\` se le asignó**. En vez de hacer un \`SELECT\` después, añade \`RETURNING\`: la sentencia devuelve las filas afectadas como si fuera una consulta.

\`\`\`
INSERT INTO productos (nombre, categoria, precio, stock)
VALUES ('Webcam 4K', 'perifericos', 89.9, 15)
RETURNING id, nombre;

UPDATE productos SET stock = stock - 1 WHERE id = 1
RETURNING id, nombre, stock;

DELETE FROM clientes WHERE id = 12
RETURNING nombre;
\`\`\`

Con \`UPDATE\` y \`DELETE\` es la mejor forma de **auditar**: ves qué filas tocaste y cómo quedaron.
`,
        '↩️',
      ),
      sqlDemo('RETURNING en las tres sentencias', 'tienda', [
        ["INSERT INTO productos (nombre, categoria, precio, stock) VALUES ('Webcam 4K', 'perifericos', 89.9, 15) RETURNING id, nombre;", 'El id nuevo llega en la propia respuesta'],
        ['UPDATE productos SET stock = stock - 1 WHERE id = 1 RETURNING id, nombre, stock;', 'Vemos el stock ya actualizado'],
        ['DELETE FROM clientes WHERE id = 12 RETURNING nombre;', 'Y a quién acabamos de borrar'],
      ]),
      learn(
        'UPSERT: insertar o, si ya existe, actualizar',
        `
Un caso muy frecuente: «guarda este dato; si ya existía, actualízalo». Con \`ON CONFLICT\` se resuelve en **una sola sentencia**:

\`\`\`
INSERT INTO ajustes (clave, valor)
VALUES ('visitas', 1)
ON CONFLICT (clave) DO UPDATE
SET valor = ajustes.valor + 1;
\`\`\`

- \`ON CONFLICT (columna)\` indica qué **clave única** puede chocar.
- \`DO UPDATE SET …\` actualiza la fila **existente**. Allí, \`ajustes.valor\` es el valor **antiguo** y \`EXCLUDED.valor\` es el valor que **intentabas insertar**.
- \`DO NOTHING\` ignora la fila nueva si ya existía.

Se llama **upsert** (_update_ + _insert_) y es la herramienta de los contadores, las cachés y las cargas de datos repetibles.
`,
        '🔁',
      ),
      sqlDemo('Contadores con upsert', { db: 'vacia', script: AJUSTES }, [
        ["INSERT INTO ajustes VALUES ('visitas', 1) ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + 1;", '«visitas» ya existía: se actualiza (10 + 1)'],
        ["INSERT INTO ajustes VALUES ('shares', 1) ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + 1;", '«shares» no existía: se inserta con valor 1'],
        ["INSERT INTO ajustes VALUES ('likes', 99) ON CONFLICT (clave) DO NOTHING;", 'DO NOTHING: «likes» existe, así que no se toca'],
        ['SELECT * FROM ajustes ORDER BY clave;', 'Resultado: likes 3, shares 1, visitas 11'],
        sqlErr("INSERT INTO ajustes VALUES ('visitas', 1) ON CONFLICT (clave) DO UPDATE SET valor = valor + 1;", 'Sin prefijo, «valor» es ambiguo (existe en la tabla y en EXCLUDED). Usa ajustes.valor'),
      ]),
      mc('En un upsert, ¿qué es `EXCLUDED.valor`?', ['El valor que ya estaba guardado', 'El valor que se intentaba insertar', 'El valor mínimo de la columna', 'Una columna oculta'], 1, '`EXCLUDED` representa la fila que se intentó insertar; `tabla.columna` es la fila que ya existía.'),
      sqlOut('Predice el contador', { db: 'vacia', script: AJUSTES }, "INSERT INTO ajustes VALUES ('visitas', 1) ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + 1; SELECT valor FROM ajustes WHERE clave = 'visitas';", ['1', '10', '12'], '«visitas» valía 10. El upsert encuentra el conflicto y ejecuta `valor = ajustes.valor + 1` = 11.'),
      tf('`ON CONFLICT DO NOTHING` provoca un error si la fila ya existe.', false, 'Justo lo contrario: ignora la fila nueva en silencio cuando choca con una existente.'),
      sqlCode('Inserta la clave `\'likes\'` con valor 1; si ya existe, suma 1 a su valor actual.', {
        setup: { db: 'vacia', script: AJUSTES },
        check: state(['ajustes']),
        solution: "INSERT INTO ajustes VALUES ('likes', 1) ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + 1;",
        hint: 'ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + 1',
        why: '«likes» existe (valor 3): el upsert lo actualiza a 4.',
      }),
      sqlPractice({
        goal: 'Un producto nuevo y su id',
        prompt: 'Das de alta el producto **Webcam 4K** (categoría `perifericos`, precio `89.9`, stock `15`) y necesitas conocer el `id` que le asigna la base de datos.\n\n**Escribe el `INSERT` que devuelva `id` y `nombre` del producto creado.**',
        setup: 'tienda',
        check: both(['productos'], { names: true }),
        solution: "INSERT INTO productos (nombre, categoria, precio, stock) VALUES ('Webcam 4K', 'perifericos', 89.9, 15) RETURNING id, nombre;",
        hints: ['Añade `RETURNING id, nombre` al final del `INSERT`.', 'Así evitas un `SELECT` posterior.'],
        explain: '`RETURNING` es la forma limpia y atómica de obtener el id generado.',
        commands: ['RETURNING', 'INSERT'],
      }),
      sqlPractice({
        goal: 'Contadores de la web',
        prompt: 'La tabla `ajustes` guarda contadores (`clave`, `valor`).\n\n**Con UNA SOLA sentencia, suma 1 a «visitas» y registra el contador nuevo «shares» con valor 1.** (Si la clave existe, se le suma lo que se intentaba insertar: `ajustes.valor + EXCLUDED.valor`.)',
        setup: { db: 'vacia', script: AJUSTES },
        check: state(['ajustes']),
        solution: "INSERT INTO ajustes VALUES ('visitas', 1), ('shares', 1) ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + EXCLUDED.valor;",
        hints: ['Un solo `INSERT` con dos filas en `VALUES`.', '`ON CONFLICT (clave) DO UPDATE SET valor = ajustes.valor + EXCLUDED.valor`'],
        explain: 'Un upsert sirve de golpe para filas nuevas y existentes. La fila «visitas» se actualiza (11) y «shares» se inserta (1).',
        commands: ['ON CONFLICT'],
      }),
      sqlPractice({
        goal: 'Anular pedidos antiguos',
        prompt: 'Los pedidos **pendientes anteriores al 1 de octubre de 2024** llevan demasiado tiempo sin pagarse: pásalos a `cancelado`.\n\n**Escribe el `UPDATE` y haz que devuelva `id` y `fecha` de los pedidos anulados.**',
        setup: 'tienda',
        check: both(['pedidos'], { names: true }),
        solution: "UPDATE pedidos SET estado = 'cancelado' WHERE estado = 'pendiente' AND fecha < '2024-10-01' RETURNING id, fecha;",
        hints: ['Dos condiciones en el `WHERE`: estado y fecha.', '`RETURNING id, fecha` al final.'],
        explain: 'Con `RETURNING` ves exactamente qué pedidos has tocado (12, 17 y 21): perfecto para dejar constancia.',
        commands: ['UPDATE', 'RETURNING'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s8-5', { title: 'Modificar sin miedo', summary: 'Hábitos de seguridad: SELECT previo, errores y transacciones', emoji: '🦺', commands: ['BEGIN / COMMIT / ROLLBACK'], minutes: 10 }, [
      learn(
        'Los cuatro hábitos de quien no rompe la base de datos',
        `
1. **Mira antes de cambiar.** Convierte tu \`UPDATE\`/\`DELETE\` en un \`SELECT\` con el mismo \`WHERE\` y comprueba qué filas toca.
2. **Cuenta las filas afectadas.** El motor te dice «14 filas actualizadas»: si esperabas 2, **para** y revisa.
3. **Usa \`RETURNING\`** cuando quieras ver exactamente qué cambió.
4. **Trabaja dentro de una transacción** cuando no estés 100 % seguro: si algo sale mal, \`ROLLBACK\` lo deshace todo.

Y un quinto, para el trabajo real: haz **copia de seguridad** antes de tocar datos importantes.
`,
        '🦺',
      ),
      learn(
        'Transacciones: el botón de deshacer',
        `
Una **transacción** agrupa varias sentencias en una unidad: **o se aplican todas o ninguna**.

- \`BEGIN\` — empieza la transacción. A partir de aquí nada es definitivo.
- \`COMMIT\` — **confirma** todos los cambios.
- \`ROLLBACK\` — **deshace** todos los cambios desde el \`BEGIN\`.

\`\`\`
BEGIN;
DELETE FROM clientes WHERE id = 12;
SELECT COUNT(*) FROM clientes;   -- 11: dentro de la transacción ya se ve el cambio
ROLLBACK;                        -- ¡me arrepiento!
SELECT COUNT(*) FROM clientes;   -- 12: todo como antes
\`\`\`

Verás las transacciones a fondo (ACID, concurrencia, puntos de guardado) en la zona de fiabilidad. Por ahora, quédate con la idea: **\`BEGIN\` te da un ensayo; \`ROLLBACK\` borra el ensayo; \`COMMIT\` lo hace real.**
`,
        '⏪',
      ),
      sqlDemo('Ensayar un borrado', 'tienda', [
        ['BEGIN;', 'Empezamos la transacción'],
        ['DELETE FROM clientes WHERE id = 12;', 'Borramos a Raúl (de momento, solo en el ensayo)'],
        ['SELECT COUNT(*) AS clientes FROM clientes;', 'Dentro de la transacción vemos 11 clientes'],
        ['ROLLBACK;', 'Nos arrepentimos: deshacemos'],
        ['SELECT COUNT(*) AS clientes FROM clientes;', 'Vuelven a ser 12: nada se perdió'],
      ]),
      sqlDemo('Cuando una restricción protege', 'banco', [
        ['SELECT * FROM cuentas ORDER BY id;', 'Beto tiene 250 €'],
        sqlErr('UPDATE cuentas SET saldo = saldo - 300 WHERE id = 2;', 'Sacar 300 € dejaría el saldo en negativo: el CHECK (saldo >= 0) lo impide'),
        ['SELECT * FROM cuentas ORDER BY id;', 'Nada cambió: el UPDATE falló entero'],
      ]),
      mc('¿Qué hace `ROLLBACK`?', ['Confirma los cambios', 'Deshace todos los cambios desde el último BEGIN', 'Repite la última sentencia', 'Borra la tabla'], 1, '`ROLLBACK` descarta todo lo hecho dentro de la transacción actual.'),
      sqlOut('Predice: ¿cuántos movimientos quedan tras el ROLLBACK?', 'banco', 'BEGIN; DELETE FROM movimientos; ROLLBACK; SELECT COUNT(*) FROM movimientos;', ['0', '3', '1'], 'El `ROLLBACK` deshace el borrado: siguen los 5 movimientos originales.'),
      tf('Dentro de una transacción, los cambios son definitivos desde el momento en que se ejecutan.', false, 'Solo se hacen definitivos al ejecutar `COMMIT`. Antes puedes deshacerlos con `ROLLBACK`.'),
      order('Ordena los pasos de un ensayo seguro', ['BEGIN;', 'UPDATE', 'productos', 'SET', 'stock', '=', '0;', 'ROLLBACK;'], 'BEGIN; UPDATE productos SET stock = 0; ROLLBACK;', 'Empiezas la transacción, haces el cambio y, si no te convence, lo deshaces.'),
      sqlCode('Arregla la sentencia: debe subir un 10 % el precio de los productos de la categoría `audio`.', {
        setup: 'tienda',
        starter: 'UPDATE productos SET precio = precio * 1.10 WHERE categoria = audio;',
        check: state(['productos']),
        solution: "UPDATE productos SET precio = precio * 1.10 WHERE categoria = 'audio';",
        hint: 'Los textos van entre comillas simples',
        why: 'Sin comillas, `audio` se interpreta como el nombre de una columna y la sentencia falla.',
      }),
      sqlPractice({
        goal: 'Provoca el error',
        prompt: 'La base de datos protege los precios con `CHECK (precio > 0)`. Para comprobarlo, **escribe un `INSERT` en `productos` que la base de datos rechace** por incumplir esa regla.',
        setup: 'tienda',
        starter: '',
        check: fails('CHECK'),
        solution: "INSERT INTO productos (nombre, categoria, precio) VALUES ('Gratis', 'audio', 0);",
        hints: ['Un precio que no sea mayor que 0.', 'Necesitas al menos `nombre`, `categoria` y `precio`.'],
        explain: 'Saber provocar y leer un error de restricción es una habilidad real: te permite entender las reglas de una base de datos que no conoces.',
        commands: ['INSERT'],
      }),
      sqlPractice({
        goal: 'Ensayo con red de seguridad',
        prompt: 'Quieres comprobar qué pasaría al **borrar todos los movimientos del banco** sin perderlos de verdad.\n\n**Escribe una transacción que los borre, cuente cuántos quedan y luego lo deshaga** (`BEGIN`, `DELETE`, `SELECT COUNT(*)`, `ROLLBACK`).',
        setup: 'banco',
        check: { mode: 'state', tables: ['movimientos'], uses: ['BEGIN', 'ROLLBACK'] },
        solution: 'BEGIN; DELETE FROM movimientos; SELECT COUNT(*) FROM movimientos; ROLLBACK;',
        hints: ['Cuatro sentencias separadas por `;`.', 'Termina con `ROLLBACK;` para que los datos sigan intactos.'],
        explain: 'Dentro de la transacción el `COUNT(*)` da 0, pero el `ROLLBACK` devuelve los 5 movimientos. Es el ensayo perfecto antes de un cambio arriesgado.',
        commands: ['BEGIN / COMMIT / ROLLBACK'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el cierre de temporada',
    prompt:
      'Es fin de temporada en TiendaTech. Prepara las cuatro operaciones y ejecútalas **en este orden**:\n\n1. **Marca como VIP** a los clientes con **2 o más pedidos no cancelados**.\n2. **Borra los pedidos cancelados** (con sus líneas de `detalle_pedido`).\n3. **Repón stock**: suma **20 unidades** a los productos con menos de 10 en stock.\n4. **Da de alta** el producto `Webcam 4K` (categoría `perifericos`, precio `89.9`, stock `15`).\n\nEscribe las sentencias separadas por `;`.',
    setup: 'tienda',
    check: state(['clientes', 'pedidos', 'detalle_pedido', 'productos']),
    solution:
      "UPDATE clientes SET vip = true WHERE id IN (SELECT cliente_id FROM pedidos WHERE estado <> 'cancelado' GROUP BY cliente_id HAVING COUNT(*) >= 2); DELETE FROM detalle_pedido WHERE pedido_id IN (SELECT id FROM pedidos WHERE estado = 'cancelado'); DELETE FROM pedidos WHERE estado = 'cancelado'; UPDATE productos SET stock = stock + 20 WHERE stock < 10; INSERT INTO productos (nombre, categoria, precio, stock) VALUES ('Webcam 4K', 'perifericos', 89.9, 15);",
    hints: ['Cinco sentencias en total: un UPDATE, dos DELETE (hijos antes que padres), otro UPDATE y un INSERT.', 'Borra primero `detalle_pedido` y después `pedidos`.'],
    explain: 'INSERT, UPDATE con subconsulta, DELETE respetando claves foráneas y reposición de stock: ya sabes modificar datos con criterio. ¡Nivel Intermedio completado!',
    commands: ['INSERT', 'UPDATE', 'DELETE'],
  },
});
