import { learn, lesson, match, mc, tf } from '../build';
import { fails, ordered, same, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld } from '../sqlbuild';

/** Prefijo común del proyecto de la tienda: cada línea de pedido con su importe, sin los pedidos cancelados. */
const LINEAS =
  "WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> 'cancelado')";

const TRG_STOCK = 'CREATE TRIGGER trg_stock AFTER INSERT ON detalle_pedido FOR EACH ROW BEGIN UPDATE productos SET stock = stock - NEW.cantidad WHERE id = NEW.producto_id; END;';

/** La plantilla de la empresa preparada para la entrevista: alguien que cobra más que su jefe y un departamento vacío. */
const ENTREVISTA = {
  db: 'empresa',
  script: "UPDATE empleados SET salario = 4500 WHERE id = 5; INSERT INTO departamentos VALUES (6, 'Legal', 'Madrid');",
};

const CONTACTOS = {
  db: 'vacia',
  script:
    "CREATE TABLE contactos (id INTEGER PRIMARY KEY, nombre TEXT, email TEXT); INSERT INTO contactos VALUES (1, 'Ana', 'ana@x.com'), (2, 'Luis', 'luis@x.com'), (3, 'Ana R', 'ana@x.com'), (4, 'Eva', 'eva@x.com'), (5, 'Pepe', 'luis@x.com'), (6, 'Ana P', 'ana@x.com');",
};

export const s14 = sqlWorld({
  id: 's14',
  index: 14,
  title: 'Maestría',
  subtitle: 'Triggers, seguridad, dialectos, proyecto real y entrevista',
  emoji: '🏆',
  color: '#F59E0B',
  level: 'avanzado',
  intro:
    'Última zona del curso: lo que separa a quien sabe SQL de quien lo **domina**. Verás cómo la base de datos puede reaccionar sola con **triggers**, cómo se ataca (y se defiende) una aplicación con la **inyección SQL**, qué cambia entre PostgreSQL, MySQL, SQLite y SQL Server, construirás un **informe de ventas** de principio a fin y terminarás con una **entrevista técnica** con los problemas clásicos que preguntan en las empresas. ¡Al final tendrás un perfil de nivel profesional!',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s14-1', { title: 'Triggers: la base de datos reacciona sola', summary: 'Disparadores con NEW, OLD y RAISE', emoji: '🪤', commands: ['CREATE TRIGGER'], minutes: 12 }, [
      learn(
        'Código que se dispara solo',
        `
Un **trigger** (disparador) es un trozo de SQL que la base de datos **ejecuta automáticamente** cuando ocurre un \`INSERT\`, \`UPDATE\` o \`DELETE\` en una tabla. Tú no lo llamas: salta solo, venga la modificación de donde venga.

\`\`\`
CREATE TRIGGER nombre
  AFTER UPDATE ON cuentas          -- cuándo: BEFORE/AFTER + evento + tabla
  FOR EACH ROW                     -- una vez por cada fila afectada
  WHEN OLD.saldo <> NEW.saldo      -- condición opcional
BEGIN
  INSERT INTO auditoria ...;       -- lo que se ejecuta
END;
\`\`\`

Dentro del trigger tienes dos «filas virtuales»:

- **\`NEW\`** — la fila **nueva** (existe en \`INSERT\` y \`UPDATE\`).
- **\`OLD\`** — la fila **antigua** (existe en \`UPDATE\` y \`DELETE\`).

**\`BEFORE\`** se ejecuta _antes_ de aplicar el cambio (ideal para **validar** y rechazar con \`RAISE(ABORT, 'mensaje')\`). **\`AFTER\`** se ejecuta _después_ (ideal para **auditar** y mantener datos derivados).

> NOTA: Aquí usamos la sintaxis compacta de SQLite/MySQL. En PostgreSQL el cuerpo del trigger se escribe como una **función** aparte (\`CREATE FUNCTION … RETURNS trigger\`) y el trigger la invoca con \`EXECUTE FUNCTION\`; la idea es la misma.
`,
        '🪤',
      ),
      sqlDemo(
        'Una auditoría automática',
        'banco',
        [
          ['CREATE TABLE auditoria (id INTEGER PRIMARY KEY, cuenta_id INTEGER NOT NULL, antes REAL NOT NULL, despues REAL NOT NULL, cuando TIMESTAMP DEFAULT CURRENT_TIMESTAMP);', 'La tabla donde se anotarán los cambios de saldo'],
          [
            'CREATE TRIGGER trg_auditar_saldo AFTER UPDATE ON cuentas FOR EACH ROW WHEN OLD.saldo <> NEW.saldo BEGIN INSERT INTO auditoria (cuenta_id, antes, despues) VALUES (OLD.id, OLD.saldo, NEW.saldo); END;',
            'Después de cada UPDATE de cuentas, si cambió el saldo, apunta el saldo antes y después',
          ],
          ['UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', 'Un cambio normal… sin tocar la auditoría'],
          ["UPDATE cuentas SET titular = 'Ana M.' WHERE id = 1;", 'Este cambio no toca el saldo: la condición WHEN no se cumple y el trigger no hace nada'],
          ['SELECT * FROM auditoria;', 'La auditoría se escribió sola, con una sola fila'],
        ],
      ),
      learn(
        'Validar con BEFORE y RAISE',
        `
Un trigger \`BEFORE\` puede **vetar** una operación. Con \`SELECT RAISE(ABORT, 'mensaje')\` se cancela la sentencia entera con tu propio error. Sirve para reglas de negocio que un \`CHECK\` no puede expresar (por ejemplo, que dependen de **otras tablas**).

También puedes mantener **datos derivados**: al insertar la línea de un pedido, descontar el stock automáticamente.

> OJO: Los triggers son potentes pero **invisibles**: quien lee el código de la aplicación no ve que hay lógica en la base de datos. Úsalos para reglas críticas (auditoría, integridad) y evita que encadenen muchos triggers entre sí.
`,
        '🛑',
      ),
      sqlDemo(
        'Rechazar y mantener el stock',
        'banco',
        [
          ["CREATE TRIGGER trg_limite BEFORE INSERT ON movimientos FOR EACH ROW WHEN NEW.importe > 10000 BEGIN SELECT RAISE(ABORT, 'Importe demasiado alto: requiere revisión'); END;", 'BEFORE INSERT: si el importe supera 10.000, se cancela'],
          sqlErr("INSERT INTO movimientos VALUES (6, 1, 20000, 'Compra', '2025-01-01');", 'El trigger vetó la operación con su propio mensaje'),
          ["INSERT INTO movimientos VALUES (6, 1, 200, 'Compra', '2025-01-01');", 'Un importe normal pasa sin problema'],
          ['SELECT COUNT(*) AS movimientos FROM movimientos;', 'Solo se guardó el correcto: 6 movimientos'],
        ],
      ),
      sqlDemo(
        'Descontar el stock al vender',
        'tienda',
        [
          [TRG_STOCK, 'Cada vez que se inserta una línea de pedido, resta la cantidad al stock del producto'],
          ["INSERT INTO pedidos VALUES (25, 1, '2025-01-10', 'pendiente');", 'Un pedido nuevo…'],
          ['INSERT INTO detalle_pedido VALUES (25, 5, 2);', '…con 2 portátiles (producto 5, tenía stock 5)'],
          ['SELECT nombre, stock FROM productos WHERE id = 5;', 'El stock bajó solo a 3: ninguna línea de código de la aplicación lo hizo'],
        ],
      ),
      match(
        'Une cada situación con la fila que puedes usar',
        [
          ['Trigger de INSERT', 'Solo existe NEW'],
          ['Trigger de DELETE', 'Solo existe OLD'],
          ['Trigger de UPDATE', 'Existen OLD y NEW'],
          ['Cancelar una operación', 'RAISE(ABORT, \'mensaje\') en un trigger BEFORE'],
        ],
        'En un `INSERT` no hay fila antigua; en un `DELETE` no hay fila nueva; en un `UPDATE` están las dos.',
      ),
      mc('Quieres apuntar en una tabla de historial cada cambio de precio. ¿Qué trigger usarías?', ['BEFORE INSERT', 'AFTER UPDATE', 'BEFORE DELETE', 'Ninguno, no se puede'], 1, 'Un `AFTER UPDATE` ve `OLD.precio` y `NEW.precio` y puede insertar el historial una vez confirmado el cambio.'),
      tf('Tienes que llamar a un trigger desde tu aplicación para que se ejecute.', false, 'Se dispara automáticamente ante el evento (`INSERT`, `UPDATE` o `DELETE`) para el que se creó.'),
      sqlOut(
        'Predice el stock',
        { db: 'tienda', script: TRG_STOCK },
        "INSERT INTO pedidos VALUES (25, 1, '2025-01-10', 'pendiente'); INSERT INTO detalle_pedido VALUES (25, 6, 3); SELECT nombre, stock FROM productos WHERE id = 6;",
        ['Portátil Air 13 | 8', 'Portátil Air 13 | 11', 'Portátil Air 13 | 3'],
        'El portátil Air 13 tenía 8 unidades; el trigger resta la cantidad de la línea insertada (3): quedan 5.',
      ),
      sqlCode('Crea un trigger `trg_sin_ceros` que rechace (con `RAISE`) los movimientos nuevos con `importe` igual a 0 e intenta insertar uno.', {
        setup: 'banco',
        check: fails(),
        solution: "CREATE TRIGGER trg_sin_ceros BEFORE INSERT ON movimientos FOR EACH ROW WHEN NEW.importe = 0 BEGIN SELECT RAISE(ABORT, 'No se admiten movimientos de 0'); END; INSERT INTO movimientos VALUES (9, 1, 0, 'Prueba', '2025-01-01');",
        hint: 'BEFORE INSERT ON movimientos … WHEN NEW.importe = 0 … RAISE(ABORT, …); y después un INSERT con importe 0',
        why: 'El `INSERT` de prueba debe fallar con tu mensaje: señal de que el trigger funciona.',
      }),
      sqlPractice({
        goal: 'La papelera de movimientos',
        prompt: 'Contabilidad quiere que **nunca se pierda un movimiento borrado**. Ya existe la tabla `papelera (id, concepto, importe)`.\n\nCrea un trigger **`trg_papelera`** `AFTER DELETE` sobre `movimientos` que copie el `id`, el `concepto` y el `importe` de la fila borrada a `papelera`. Después borra el movimiento **4** y consulta la papelera.\n\n**Muestra `id`, `concepto` e `importe` de `papelera`.**',
        setup: { db: 'banco', script: 'CREATE TABLE papelera (id INTEGER PRIMARY KEY, concepto TEXT, importe REAL);' },
        check: same({ names: true, uses: ['TRIGGER'] }),
        solution:
          'CREATE TRIGGER trg_papelera AFTER DELETE ON movimientos FOR EACH ROW BEGIN INSERT INTO papelera (id, concepto, importe) VALUES (OLD.id, OLD.concepto, OLD.importe); END; DELETE FROM movimientos WHERE id = 4; SELECT id, concepto, importe FROM papelera;',
        hints: ['`AFTER DELETE ON movimientos FOR EACH ROW BEGIN … END;`', 'En un `DELETE` solo existe `OLD`: `VALUES (OLD.id, OLD.concepto, OLD.importe)`.'],
        explain: 'Con el trigger, **cualquier** `DELETE` sobre `movimientos` (desde la aplicación, a mano, desde un script…) deja una copia en la papelera. Es una red de seguridad que no depende de que nadie se acuerde.',
        commands: ['CREATE TRIGGER'],
      }),
      sqlPractice({
        goal: 'Stock automático',
        prompt: 'Crea un trigger **`trg_stock`** `AFTER INSERT` sobre `detalle_pedido` que **reste** la `cantidad` al `stock` del producto de esa línea. Después inserta en el pedido **24** una línea con **3 unidades** del producto **2** y consulta su stock.\n\n**Muestra `nombre` y `stock` del producto 2.**',
        setup: 'tienda',
        check: same({ names: true, uses: ['TRIGGER'] }),
        solution: `${TRG_STOCK} INSERT INTO detalle_pedido VALUES (24, 2, 3); SELECT nombre, stock FROM productos WHERE id = 2;`,
        hints: ['El trigger actualiza `productos` usando `NEW.cantidad` y `NEW.producto_id`.', 'La línea nueva es `INSERT INTO detalle_pedido VALUES (24, 2, 3);`'],
        explain: 'El ratón pasa de 60 a 57 unidades. El stock queda siempre consistente con las ventas, sin depender de que cada programa se acuerde de actualizarlo.',
        commands: ['CREATE TRIGGER'],
      }),
      sqlPractice({
        goal: 'Protege los precios',
        prompt: 'Para evitar errores de tecleo, nadie debería poder **bajar un precio a menos de la mitad** del que tenía.\n\nCrea un trigger `BEFORE UPDATE` sobre `productos` que lo impida con `RAISE(ABORT, …)` (`WHEN NEW.precio < OLD.precio * 0.5`) y, para comprobarlo, intenta dejar el precio del producto **5** en **10**.\n\n**La sentencia final debe fallar.**',
        setup: 'tienda',
        check: fails(),
        solution:
          "CREATE TRIGGER trg_precio BEFORE UPDATE ON productos FOR EACH ROW WHEN NEW.precio < OLD.precio * 0.5 BEGIN SELECT RAISE(ABORT, 'Bajada de precio sospechosa'); END; UPDATE productos SET precio = 10 WHERE id = 5;",
        hints: ['`BEFORE UPDATE ON productos FOR EACH ROW WHEN … BEGIN SELECT RAISE(ABORT, \'…\'); END;`', 'Después, `UPDATE productos SET precio = 10 WHERE id = 5;` debe dar error.'],
        explain: 'Un trigger `BEFORE` con `RAISE` es un guardián: examina la fila nueva frente a la antigua y cancela lo sospechoso antes de que llegue a la tabla.',
        commands: ['CREATE TRIGGER'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s14-2', { title: 'Seguridad: inyección SQL', summary: 'Cómo se ataca una consulta y cómo se defiende', emoji: '🕵️', commands: ['Inyección SQL'], minutes: 12 }, [
      learn(
        'El fallo más famoso de la web',
        `
La **inyección SQL** (_SQL injection_) lleva décadas entre las vulnerabilidades más graves. Ocurre cuando una aplicación **construye el SQL pegando texto del usuario**:

\`\`\`
entrada = leer_formulario("alias")
consulta = "SELECT * FROM usuarios WHERE alias = '" + entrada + "'"
\`\`\`

Con una entrada normal (\`sql_fan\`) todo va bien. Pero si el usuario escribe \`x' OR '1'='1\`, la consulta resultante es:

\`\`\`
SELECT * FROM usuarios WHERE alias = 'x' OR '1'='1'
\`\`\`

La comilla del atacante **cierra el texto** y lo que viene después se interpreta como **código SQL**. Como \`'1'='1'\` siempre es verdadero, devuelve **todos** los usuarios. Y no solo se pueden leer datos: con \`;\` se pueden añadir sentencias nuevas, incluso un \`DROP TABLE\`.

> OJO: Esto se muestra para que sepas **defender** tus aplicaciones. Practica solo en bases de datos tuyas, como este simulador.
`,
        '🕵️',
      ),
      sqlDemo(
        'Lo que ve la base de datos',
        'social',
        [
          ["SELECT id, alias FROM usuarios WHERE alias = 'sql_fan';", 'Entrada normal: «sql_fan». Devuelve un usuario'],
          ["SELECT id, alias FROM usuarios WHERE alias = '' OR '1'='1';", "Entrada maliciosa: «' OR '1'='1». La condición siempre es verdadera: se filtran los 8 usuarios"],
          ["SELECT id, alias FROM usuarios WHERE alias = 'nube_azul'-- ' AND registro < '2000-01-01';", "Entrada «nube_azul'--». El -- convierte el resto en comentario: desaparece la condición de seguridad (registro < 2000) y devuelve a alguien que no debería"],
          ["SELECT id, alias FROM usuarios WHERE alias = 'x'; DROP TABLE publicaciones; --';", "Entrada «x'; DROP TABLE publicaciones; --»: ¡se añade una sentencia que borra una tabla entera!"],
          sqlErr('SELECT COUNT(*) FROM publicaciones;', 'La tabla ya no existe. Un solo campo de texto sin protección acabó con ella'),
        ],
        'La aplicación pega el texto del usuario dentro de la consulta. Mira lo que llega a la base de datos con cada entrada.',
      ),
      learn(
        'La defensa: consultas parametrizadas',
        `
La solución **no** es «filtrar comillas a mano» (siempre se escapa algo). La solución es **separar el código de los datos**: las **consultas parametrizadas** (_prepared statements_).

\`\`\`
-- el SQL lleva marcadores; los valores viajan aparte
consulta = "SELECT * FROM usuarios WHERE alias = $1"
ejecutar(consulta, [entrada])
\`\`\`

La base de datos recibe primero la **estructura** de la consulta ya compilada y después el valor como **dato puro**. Aunque la entrada sea \`x' OR '1'='1\`, se compara tal cual con la columna \`alias\`: nunca se interpreta como SQL.

**Resto de buenas prácticas:**

1. 🧱 **Mínimo privilegio**: el usuario de la base de datos que usa la aplicación solo debe poder hacer lo imprescindible (nada de \`DROP\`). Las **vistas** sirven para exponer solo columnas permitidas.
2. ✅ **Validar** la entrada (tipo, longitud, formato) como segunda barrera.
3. 📋 **Lista blanca** para nombres de columnas o de orden (\`ORDER BY\`), que **no** se pueden parametrizar.
4. 🙈 **No mostrar** al usuario los errores crudos de la base de datos.
5. 🔑 **Nunca** guardar contraseñas en claro: usa hash con sal (bcrypt, Argon2).
6. 🔄 Los **ORM** y las librerías modernas parametrizan por ti… mientras no concatenes SQL a mano.
`,
        '🛡️',
      ),
      match(
        'Une cada ataque o riesgo con su defensa principal',
        [
          ["Entrada con comillas que altera la consulta", 'Consultas parametrizadas'],
          ['La app puede ejecutar DROP TABLE', 'Mínimo privilegio en el usuario de la base de datos'],
          ['Contraseñas leídas en claro', 'Guardar solo su hash con sal'],
          ['Ordenar por una columna elegida por el usuario', 'Lista blanca de columnas permitidas'],
        ],
        'Cada riesgo tiene una defensa específica, y se combinan: seguridad por capas.',
      ),
      mc('¿Cuál es la defensa más importante contra la inyección SQL?', ['Prohibir las comillas en los formularios', 'Usar consultas parametrizadas', 'Ocultar el nombre de las tablas', 'Usar mayúsculas'], 1, 'Separar el código SQL de los datos del usuario hace que la entrada nunca se interprete como SQL.'),
      tf('Escapar a mano las comillas simples es tan seguro como usar consultas parametrizadas.', false, 'El escapado manual falla con casos raros (otras comillas, codificaciones, números sin comillas…). Los parámetros eliminan el problema de raíz.'),
      sqlOut('Predice qué se filtra', 'social', "SELECT COUNT(*) FROM usuarios WHERE alias = 'zzz' OR 'a' = 'a';", ['0', '1', '7'], 'La condición `\'a\' = \'a\'` es siempre verdadera, así que el `OR` deja pasar todas las filas: los 8 usuarios.'),
      sqlCode('Crea una vista `perfil_publico` con solo `alias` y `pais` de `usuarios` y muéstrala ordenada por alias. (Así la aplicación pública nunca ve más columnas.)', {
        setup: 'social',
        check: ordered({ names: true, uses: ['CREATE VIEW'] }),
        solution: 'CREATE VIEW perfil_publico AS SELECT alias, pais FROM usuarios; SELECT * FROM perfil_publico ORDER BY alias;',
        hint: 'CREATE VIEW … AS SELECT alias, pais …; y luego el SELECT',
        why: 'Dar acceso solo a la vista limita el daño aunque la aplicación tuviera un fallo.',
      }),
      sqlPractice({
        goal: 'Entiende el ataque (laboratorio)',
        prompt: 'La aplicación de la red social ejecuta esta plantilla con lo que escribe el usuario en `<ENTRADA>`:\n\n`SELECT alias, pais FROM usuarios WHERE alias = \'<ENTRADA>\' AND pais = \'España\'`\n\nEl usuario teclea exactamente esto: `x\' OR \'1\'=\'1\' --`\n\n**Escribe la consulta que recibe realmente la base de datos** (sustituyendo `<ENTRADA>` por el texto) y ejecútala para ver qué datos se filtran.',
        setup: 'social',
        check: same({ names: true, uses: ['OR'] }),
        solution: "SELECT alias, pais FROM usuarios WHERE alias = 'x' OR '1'='1' --' AND pais = 'España'",
        hints: ['Sustituye `<ENTRADA>` por `x\' OR \'1\'=\'1\' --` dentro de las comillas de la plantilla.', 'El `--` convierte en comentario todo lo que va detrás, incluido `AND pais = \'España\'`.'],
        explain: 'El atacante cerró la comilla, añadió una condición siempre verdadera y comentó el resto: sale **todo** el mundo, no solo quienes son de España. Con una consulta parametrizada, esa entrada se buscaría literalmente como un alias y no encontraría nada.',
        commands: ['Inyección SQL'],
      }),
      sqlPractice({
        goal: 'Exponer solo lo necesario',
        prompt: 'El equipo de marketing necesita ver **cuántos usuarios hay por país**, pero no debe tener acceso a `usuarios` completa. Crea la vista **`usuarios_por_pais`** con `pais` y `usuarios` (cuántos hay; los usuarios sin país se agrupan como `pais` vacío/NULL) y consúltala.\n\n**Muestra `pais` y `usuarios`, de más a menos usuarios y luego por país.**',
        setup: 'social',
        check: ordered({ names: true, uses: ['CREATE VIEW'] }),
        solution: 'CREATE VIEW usuarios_por_pais AS SELECT pais, COUNT(*) AS usuarios FROM usuarios GROUP BY pais; SELECT * FROM usuarios_por_pais ORDER BY usuarios DESC, pais;',
        hints: ['La vista agrupa por `pais` con `COUNT(*) AS usuarios`.', 'Después ordena por `usuarios DESC, pais`.'],
        explain: 'La vista entrega solo datos agregados: marketing obtiene lo que necesita y nunca llega a ver aliases ni fechas de registro. Mínimo privilegio en acción.',
        commands: ['Inyección SQL', 'CREATE VIEW'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s14-3', { title: 'Dialectos y portabilidad', summary: 'PostgreSQL, MySQL, SQLite, SQL Server y Oracle', emoji: '🌍', commands: ['Dialectos SQL'], minutes: 11 }, [
      learn(
        'Un estándar, muchos acentos',
        `
SQL es un estándar internacional (ISO/ANSI), pero **cada motor habla su propio dialecto**: añade funciones, cambia nombres y a veces ignora partes del estándar. Lo esencial (\`SELECT\`, \`JOIN\`, \`GROUP BY\`, \`CASE\`…) es igual en todos; los detalles cambian:

| Tarea | Estándar / PostgreSQL | MySQL | SQLite | SQL Server | Oracle |
| --- | --- | --- | --- | --- | --- |
| Limitar filas | \`FETCH FIRST n ROWS ONLY\` / \`LIMIT n\` | \`LIMIT n\` | \`LIMIT n\` | \`TOP n\` | \`FETCH FIRST n ROWS ONLY\` |
| Si es NULL | \`COALESCE\` | \`IFNULL\` | \`IFNULL\` | \`ISNULL\` | \`NVL\` |
| Autonumérico | \`GENERATED … AS IDENTITY\` / \`SERIAL\` | \`AUTO_INCREMENT\` | \`AUTOINCREMENT\` | \`IDENTITY\` | \`IDENTITY\` |
| Concatenar | \`\\|\\|\` | \`CONCAT()\` | \`\\|\\|\` | \`+\` / \`CONCAT()\` | \`\\|\\|\` |
| Comillas de identificador | \`"nombre"\` | \`\`nombre\`\` | \`"nombre"\` | \`[nombre]\` | \`"nombre"\` |
| Upsert | \`ON CONFLICT\` | \`ON DUPLICATE KEY UPDATE\` | \`ON CONFLICT\` | \`MERGE\` | \`MERGE\` |
| Fecha actual | \`CURRENT_DATE\` | \`CURDATE()\` | \`date('now')\` | \`GETDATE()\` | \`SYSDATE\` |

**Consejo profesional:** escribe lo más **estándar** posible (\`COALESCE\`, \`CAST\`, \`CASE\`, \`JOIN\` explícitos, \`FETCH FIRST\`), y aísla lo específico de un motor en un solo sitio. Así migrar o dar soporte a otra base de datos cuesta mucho menos.
`,
        '🌍',
      ),
      sqlDemo(
        'Varias formas de decir lo mismo',
        'social',
        [
          ['SELECT alias FROM usuarios ORDER BY id LIMIT 2;', 'LIMIT: PostgreSQL, MySQL y SQLite'],
          ['SELECT alias FROM usuarios ORDER BY id FETCH FIRST 2 ROWS ONLY;', 'FETCH FIRST: la forma del estándar SQL (Oracle, PostgreSQL, DB2…)'],
          sqlErr('SELECT TOP 2 alias FROM usuarios ORDER BY id;', 'TOP es de SQL Server: este motor sigue el estándar y no lo entiende'),
          ["SELECT COALESCE(pais, 'sin país') AS pais FROM usuarios WHERE id = 6;", 'COALESCE: estándar y funciona en todos los motores. IFNULL (MySQL, SQLite), ISNULL (SQL Server) y NVL (Oracle) hacen lo mismo con otro nombre'],
          ['SELECT CAST(registro AS TEXT) AS texto, registro::text AS texto2 FROM usuarios WHERE id = 1;', 'CAST es estándar; el operador :: es propio de PostgreSQL'],
          ["SELECT alias || ' (' || pais || ')' AS con_barras, CONCAT(alias, ' (', pais, ')') AS con_concat FROM usuarios WHERE id IN (5, 6);", 'Ojo a esta diferencia clásica: con || un NULL contagia a todo (queda NULL); CONCAT ignora los NULL'],
        ],
        'Este simulador entiende los dialectos más comunes, pero fíjate en cuáles son estándar y cuáles no.',
      ),
      learn(
        'Qué cambia al migrar de motor',
        `
Cuando una aplicación cambia de base de datos, lo que más suele romperse es:

- **Paginación** (\`LIMIT\` / \`TOP\` / \`FETCH\`).
- **Fechas y horas**: funciones como \`DATE_TRUNC\`, \`strftime\`, \`DATE_FORMAT\`, \`GETDATE\` son muy distintas. \`EXTRACT(YEAR FROM fecha)\` es la forma estándar.
- **Tipos de datos**: \`BOOLEAN\` (MySQL lo simula con \`TINYINT\`), \`TEXT\` / \`VARCHAR\` / \`NVARCHAR\`, \`SERIAL\` frente a \`IDENTITY\`.
- **Mayúsculas/minúsculas** en comparaciones: MySQL y SQL Server comparan textos sin distinguir mayúsculas por defecto; PostgreSQL y SQLite sí (por eso existe \`ILIKE\` en PostgreSQL).
- **\`NULL\` en el orden** (¿van primero o al final?) y la **concatenación con \`NULL\`**.
- **Transacciones y DDL**: en MySQL, por ejemplo, un \`CREATE TABLE\` confirma la transacción en curso.

La mejor protección: **pruebas automáticas** de tus consultas críticas contra el motor real, y usar las partes estándar siempre que se pueda.
`,
        '🧳',
      ),
      match(
        'Une cada rasgo con su motor',
        [
          ['SELECT TOP 5 …', 'SQL Server'],
          ['AUTO_INCREMENT y ON DUPLICATE KEY UPDATE', 'MySQL'],
          ['NVL y SYSDATE', 'Oracle'],
          ['ILIKE, RETURNING y ::', 'PostgreSQL'],
        ],
        'Reconocer estos rasgos ayuda a leer SQL escrito para otros motores y a saber qué hay que adaptar.',
      ),
      mc('¿Cuál de estas es la forma **estándar** de sustituir un NULL por un valor?', ['IFNULL(x, 0)', 'NVL(x, 0)', 'ISNULL(x, 0)', 'COALESCE(x, 0)'], 3, '`COALESCE` pertenece al estándar y lo entienden todos los motores. Las otras son específicas de MySQL/SQLite, Oracle y SQL Server.'),
      tf('Una consulta escrita para PostgreSQL funciona sin cambios en cualquier otro motor.', false, 'Lo básico sí, pero funciones de fecha, `ILIKE`, `::`, `RETURNING`, la paginación o los tipos pueden requerir adaptaciones.'),
      sqlOut('Predice la concatenación', 'social', "SELECT alias || ' - ' || pais FROM usuarios WHERE id = 6;", ['codigo_zen - ', 'codigo_zen', 'NULL - '], 'Con `||`, si cualquiera de las partes es NULL (el país de `codigo_zen`), todo el resultado es NULL.'),
      sqlCode('Reescribe en estándar: muestra los 3 primeros alias por `id` usando `FETCH FIRST` (columna `alias`).', {
        setup: 'social',
        starter: 'SELECT alias FROM usuarios ORDER BY id LIMIT 3;',
        check: ordered({ names: true, uses: ['FETCH'], forbids: ['LIMIT'] }),
        solution: 'SELECT alias FROM usuarios ORDER BY id FETCH FIRST 3 ROWS ONLY;',
        hint: 'FETCH FIRST 3 ROWS ONLY al final',
        why: '`FETCH FIRST n ROWS ONLY` es la paginación del estándar SQL.',
      }),
      sqlPractice({
        goal: 'País o «sin país»',
        prompt: 'Esta consulta usa funciones que no son estándar. **Hazla portable**: sustituye `IFNULL` por la función estándar y `LIMIT` por la forma estándar.\n\n`SELECT IFNULL(pais, \'sin país\') AS pais FROM usuarios ORDER BY id LIMIT 4`\n\n**Muestra `pais`.**',
        setup: 'social',
        starter: "SELECT IFNULL(pais, 'sin país') AS pais FROM usuarios ORDER BY id LIMIT 4;",
        check: ordered({ names: true, uses: ['COALESCE', 'FETCH'], forbids: ['IFNULL', 'LIMIT'] }),
        solution: "SELECT COALESCE(pais, 'sin país') AS pais FROM usuarios ORDER BY id FETCH FIRST 4 ROWS ONLY;",
        hints: ['`COALESCE(pais, \'sin país\')`', '`FETCH FIRST 4 ROWS ONLY` en lugar de `LIMIT 4`.'],
        explain: 'Con `COALESCE` y `FETCH FIRST`, la misma consulta funciona en PostgreSQL, Oracle, SQL Server (2012+), DB2… Un cambio mínimo que te ahorra sorpresas al migrar.',
        commands: ['Dialectos SQL', 'COALESCE'],
      }),
      sqlPractice({
        goal: 'El año, en estándar',
        prompt: 'Cuenta cuántos usuarios se registraron cada año, pero **sin usar `strftime`** (que es de SQLite). Usa la función estándar para obtener el año de una fecha.\n\n**Muestra `anio` (como número) y `usuarios`, ordenado por año.**',
        setup: 'social',
        starter: "SELECT strftime('%Y', registro) AS anio, COUNT(*) AS usuarios FROM usuarios GROUP BY anio ORDER BY anio;",
        check: ordered({ names: true, uses: ['EXTRACT'], forbids: ['strftime'] }),
        solution: 'SELECT EXTRACT(YEAR FROM registro) AS anio, COUNT(*) AS usuarios FROM usuarios GROUP BY EXTRACT(YEAR FROM registro) ORDER BY anio;',
        hints: ['`EXTRACT(YEAR FROM registro)` devuelve el año como número.', 'Repite la expresión en el `GROUP BY` (así funciona en todos los motores).'],
        explain: '`EXTRACT(YEAR FROM fecha)` está en el estándar SQL y la entienden PostgreSQL, MySQL, Oracle… mientras que `strftime` solo existe en SQLite.',
        commands: ['Dialectos SQL', 'EXTRACT'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s14-4', { title: 'Proyecto: el informe de ventas', summary: 'Construye un cuadro de mando completo', emoji: '📊', commands: ['WITH', 'OVER / PARTITION BY', 'Porcentaje sobre el total', 'ROLLUP / CUBE'], minutes: 16 }, [
      learn(
        'El encargo',
        `
La dirección comercial de la tienda te pide un **informe de ventas completo**. Es un trabajo real: tendrás que combinar lo aprendido en todo el curso. El método profesional:

1. 🧱 **Prepara una base limpia**: una CTE (\`lineas\`) con cada línea de pedido y su importe (cantidad × precio), **sin los pedidos cancelados**.
2. 🧮 Cada informe se apoya en esa base: lo calculas por capas, con más CTE si hace falta.
3. ✅ Comprueba que las **cifras cuadran**: la suma de las partes debe ser igual al total.

El informe tendrá cuatro partes:

- **Ingresos por categoría** con su porcentaje.
- **Top de clientes** con ranking.
- **Evolución mensual** con acumulado.
- **Producto estrella** de cada categoría.

Y rematarás con un resumen con total usando \`ROLLUP\`.
`,
        '📊',
      ),
      sqlDemo(
        'La base: líneas de pedido con importe',
        'tienda',
        [
          [`${LINEAS} SELECT * FROM lineas ORDER BY pedido_id, producto_id LIMIT 6;`, 'La CTE une pedidos, líneas y productos, y calcula importe = cantidad × precio. Los cancelados quedan fuera'],
          [`${LINEAS} SELECT COUNT(DISTINCT pedido_id) AS pedidos, ROUND(SUM(importe), 2) AS ingresos FROM lineas;`, 'Los dos grandes números del negocio: 22 pedidos válidos y 6.558,31 € de ingresos'],
          [`${LINEAS} SELECT categoria, ROUND(SUM(importe), 2) AS ingresos FROM lineas GROUP BY categoria ORDER BY ingresos DESC;`, 'Primer desglose. Comprobación: las categorías suman exactamente 6.558,31'],
        ],
        'Todos los informes de este proyecto empiezan por la misma CTE `lineas`; aquí tienes cómo se construye y se usa.',
      ),
      mc('¿Por qué conviene preparar la CTE `lineas` una sola vez al principio?', ['Para que el servidor consuma más memoria', 'Para reutilizar la misma definición limpia en todos los informes y evitar contradicciones', 'Porque SQL lo obliga', 'Para ordenar los resultados'], 1, 'Una base común garantiza que todos los informes usen las mismas reglas (por ejemplo, excluir cancelados) y que las cifras cuadren.'),
      tf('Si dos informes de la misma empresa excluyen los cancelados de forma distinta, sus totales podrían no coincidir.', true, 'Por eso se define una vez la lógica de negocio (en una CTE o una vista) y se reutiliza.'),
      mc('Quieres el porcentaje de cada categoría sobre el total sin una segunda consulta. ¿Qué usas?', ['Una subconsulta en el WHERE', 'Una función de ventana: `SUM(SUM(importe)) OVER ()`', 'Un UNION', 'Un DISTINCT'], 1, 'La ventana `OVER ()` suma el total de todas las filas del resultado y permite dividir sin segunda pasada.'),
      sqlPractice({
        goal: 'Ingresos por categoría',
        prompt: 'Usando la CTE `lineas` (cada línea de pedido con su `importe`, sin pedidos cancelados), crea el primer informe.\n\nLa CTE ya está definida en tu mente: empieza tu consulta con\n\n`WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> \'cancelado\')`\n\n**Muestra `categoria`, `ingresos` (redondeado a 2 decimales) y `pct` (porcentaje sobre el total, redondeado a 1 decimal). De más a menos ingresos y luego por categoría.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['WITH', 'OVER'] }),
        solution: `${LINEAS} SELECT categoria, ROUND(SUM(importe), 2) AS ingresos, ROUND(100.0 * SUM(importe) / SUM(SUM(importe)) OVER (), 1) AS pct FROM lineas GROUP BY categoria ORDER BY ingresos DESC, categoria;`,
        hints: ['`GROUP BY categoria` y `SUM(importe)`.', 'El total para el porcentaje: `SUM(SUM(importe)) OVER ()`.'],
        explain: 'Los ordenadores aportan el 55,3 % de los ingresos. Una sola consulta con CTE + `GROUP BY` + función de ventana.',
        commands: ['WITH', 'Porcentaje sobre el total'],
      }),
      sqlPractice({
        goal: 'Los mejores clientes',
        prompt: 'Con la misma CTE `lineas`, haz el ranking de clientes.\n\n**Muestra `puesto` (con `RANK()` por gasto de mayor a menor), `cliente` (nombre), `pedidos` (cuántos pedidos distintos) y `gasto` (suma de importes, redondeado a 2 decimales). Solo los clientes en los 3 primeros puestos, ordenados por puesto y luego por cliente.**\n\nRecuerda empezar con la CTE `lineas`:\n`WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> \'cancelado\')`',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['RANK'] }),
        solution: `${LINEAS}, por_cliente AS (SELECT c.nombre AS cliente, COUNT(DISTINCT l.pedido_id) AS pedidos, ROUND(SUM(l.importe), 2) AS gasto FROM lineas l JOIN clientes c ON c.id = l.cliente_id GROUP BY c.id, c.nombre) SELECT puesto, cliente, pedidos, gasto FROM (SELECT cliente, pedidos, gasto, RANK() OVER (ORDER BY gasto DESC) AS puesto FROM por_cliente) t WHERE puesto <= 3 ORDER BY puesto, cliente;`,
        hints: ['Agrupa por cliente en una segunda CTE (`por_cliente`).', 'Los puestos se calculan en una subconsulta; el filtro `puesto <= 3` va fuera.'],
        explain: 'Encadenar CTE (`lineas` → `por_cliente`) y filtrar el ranking en una consulta exterior es el patrón estándar del «top N con empates».',
        commands: ['WITH', 'RANK / DENSE_RANK'],
      }),
      sqlPractice({
        goal: 'Evolución mensual y acumulado',
        prompt: 'Con la CTE `lineas`, prepara la evolución mensual.\n\n**Muestra `mes` (`AAAA-MM`), `ingresos` del mes (redondeado a 2 decimales) y `acumulado` (suma acumulada de los ingresos hasta ese mes, redondeada a 2 decimales), ordenado por mes.**\n\nRecuerda empezar con la CTE `lineas`:\n`WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> \'cancelado\')`',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['OVER'] }),
        solution: `${LINEAS}, mensual AS (SELECT strftime('%Y-%m', fecha) AS mes, ROUND(SUM(importe), 2) AS ingresos FROM lineas GROUP BY strftime('%Y-%m', fecha)) SELECT mes, ingresos, ROUND(SUM(ingresos) OVER (ORDER BY mes), 2) AS acumulado FROM mensual ORDER BY mes;`,
        hints: ['Primero agrega por mes en una CTE (`mensual`).', 'El acumulado: `SUM(ingresos) OVER (ORDER BY mes)`.'],
        explain: 'El último valor del acumulado (6.558,31) coincide con el total de ingresos: la comprobación de que las cifras cuadran.',
        commands: ['OVER / PARTITION BY', 'WITH'],
      }),
      sqlPractice({
        goal: 'El producto estrella de cada categoría',
        prompt: 'Con la CTE `lineas`, encuentra el producto que **más unidades vende en cada categoría**.\n\n**Muestra `categoria`, `producto` y `unidades` (suma de `cantidad`). Si hay empate, gana el nombre que va antes alfabéticamente. Una fila por categoría, ordenado por categoría.**\n\nRecuerda empezar con la CTE `lineas`:\n`WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> \'cancelado\')`',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROW_NUMBER'] }),
        solution: `${LINEAS}, u AS (SELECT categoria, producto, SUM(cantidad) AS unidades FROM lineas GROUP BY categoria, producto) SELECT categoria, producto, unidades FROM (SELECT categoria, producto, unidades, ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY unidades DESC, producto) AS rn FROM u) t WHERE rn = 1 ORDER BY categoria;`,
        hints: ['Primero suma las unidades por categoría y producto.', '`ROW_NUMBER() OVER (PARTITION BY categoria ORDER BY unidades DESC, producto)` y quédate con `rn = 1`.'],
        explain: 'El clásico «el mejor de cada grupo»: `ROW_NUMBER()` con `PARTITION BY` y filtro por `rn = 1`. El desempate por nombre hace el resultado reproducible.',
        commands: ['ROW_NUMBER', 'OVER / PARTITION BY'],
      }),
      sqlPractice({
        goal: 'El resumen ejecutivo con total',
        prompt: 'Para cerrar el informe, la dirección quiere una tabla de ingresos por categoría con una **fila final `TOTAL`**.\n\n**Muestra `categoria` y `ingresos` (redondeado a 2 decimales). La fila de total se llama `TOTAL` y va la última; el resto, ordenadas por categoría. Usa `ROLLUP`.**\n\nRecuerda empezar con la CTE `lineas`:\n`WITH lineas AS (SELECT p.id AS pedido_id, p.cliente_id, p.fecha, d.producto_id, pr.nombre AS producto, pr.categoria, d.cantidad, d.cantidad * pr.precio AS importe FROM pedidos p JOIN detalle_pedido d ON d.pedido_id = p.id JOIN productos pr ON pr.id = d.producto_id WHERE p.estado <> \'cancelado\')`',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['ROLLUP'] }),
        solution: `${LINEAS} SELECT CASE WHEN GROUPING(categoria) = 1 THEN 'TOTAL' ELSE categoria END AS categoria, ROUND(SUM(importe), 2) AS ingresos FROM lineas GROUP BY ROLLUP (categoria) ORDER BY GROUPING(categoria), categoria;`,
        hints: ['`GROUP BY ROLLUP (categoria)` añade la fila del total (con categoría NULL).', '`GROUPING(categoria) = 1` identifica la fila de total; ordena por `GROUPING(categoria), categoria`.'],
        explain: '¡Informe completo! Una base común (`lineas`), porcentajes, ranking, acumulados, mejor de cada grupo y totales. Esto es exactamente lo que hace un analista de datos cada semana.',
        commands: ['ROLLUP / CUBE', 'WITH'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s14-5', { title: 'Entrevista técnica', summary: 'Los problemas clásicos que preguntan en las empresas', emoji: '🎤', commands: ['Auto-JOIN', 'Buscar duplicados', 'RANK / DENSE_RANK', 'Subconsulta'], minutes: 16 }, [
      learn(
        'Cómo se resuelve una pregunta de entrevista',
        `
En las entrevistas de SQL se repiten unos **diez problemas clásicos**. No se trata de memorizarlos, sino de reconocer el patrón:

| Problema | Patrón |
| --- | --- |
| Segundo salario más alto | \`DENSE_RANK\`, subconsulta con \`MAX\` o \`OFFSET\` |
| Quién cobra más que su jefe | **Auto-JOIN** |
| Departamentos sin empleados | **Anti-join** (\`LEFT JOIN … IS NULL\` / \`NOT EXISTS\`) |
| Emails duplicados | \`GROUP BY\` + \`HAVING COUNT(*) > 1\` |
| Top N por grupo | \`ROW_NUMBER\` / \`RANK\` + \`PARTITION BY\` |
| Mediana | Numerar y quedarse con la fila del medio |
| Acumulado | Función de ventana con \`ORDER BY\` |
| Rachas y huecos | Fecha − número de fila |

**Método para cualquier pregunta:**

1. 🗣️ **Aclara**: ¿qué pasa con los empates? ¿y con los NULL? ¿hay duplicados?
2. 👀 **Mira el esquema** y piensa qué tablas necesitas.
3. 🧱 **Construye por capas** (CTE): primero la parte fácil, luego añade.
4. 🧪 **Prueba los casos límite**: tabla vacía, un solo elemento, empates.
5. ⚡ **Comenta el rendimiento**: «aquí un índice sobre … ayudaría».
`,
        '🎤',
      ),
      sqlDemo(
        'El segundo salario más alto: tres formas',
        'empresa',
        [
          ['SELECT MAX(salario) AS segundo FROM empleados WHERE salario < (SELECT MAX(salario) FROM empleados);', '1. El máximo de los que no son el máximo'],
          ['SELECT salario AS segundo FROM (SELECT salario, DENSE_RANK() OVER (ORDER BY salario DESC) AS r FROM empleados) t WHERE r = 2 GROUP BY salario;', '2. Con DENSE_RANK (se generaliza fácil al N-ésimo)'],
          ['SELECT DISTINCT salario AS segundo FROM empleados ORDER BY salario DESC LIMIT 1 OFFSET 1;', '3. Con OFFSET: sin repetidos, saltando el primero'],
        ],
        'Las tres devuelven 5.200. En una entrevista, menciona los empates: DENSE_RANK y DISTINCT los tratan bien.',
      ),
      sqlOut('Predice la trampa del NOT IN', 'empresa', 'SELECT COUNT(*) FROM empleados WHERE id NOT IN (SELECT jefe_id FROM empleados);', ['10', '6', '16'], 'El empleado raíz tiene `jefe_id` NULL. Con un NULL en la lista, `id NOT IN (…)` nunca es verdadero (lógica de tres valores): devuelve **0** filas. Usa `NOT EXISTS` o filtra `WHERE jefe_id IS NOT NULL`.'),
      mc('¿Cuál es la forma más segura de encontrar los empleados que NO son jefe de nadie?', ['`WHERE id NOT IN (SELECT jefe_id …)` sin más', '`NOT EXISTS (SELECT 1 FROM empleados h WHERE h.jefe_id = e.id)`', '`WHERE jefe_id = NULL`', '`GROUP BY jefe_id`'], 1, '`NOT EXISTS` no se ve afectado por los NULL. El `NOT IN` sin proteger es una trampa clásica de entrevista.'),
      mc('Te piden el salario medio por departamento «incluyendo los departamentos sin empleados». ¿Qué JOIN necesitas?', ['INNER JOIN', 'LEFT JOIN desde departamentos', 'CROSS JOIN', 'No hace falta JOIN'], 1, 'Para no perder los departamentos vacíos, la tabla de departamentos va a la izquierda de un `LEFT JOIN`.'),
      tf('En una entrevista debes empezar a escribir SQL inmediatamente, sin hacer preguntas.', false, 'Preguntar por empates, NULL y duplicados es lo que más valoran: demuestra que piensas en los casos límite.'),
      sqlPractice({
        goal: 'Cobra más que su jefe',
        prompt: 'En esta plantilla alguien cobra más que su propio jefe. Encuéntralo.\n\n**Muestra `empleado`, `salario`, `jefe` y `salario_jefe` (nombres y salarios), ordenado por empleado.**',
        setup: ENTREVISTA,
        check: ordered({ names: true }),
        solution: 'SELECT e.nombre AS empleado, e.salario, j.nombre AS jefe, j.salario AS salario_jefe FROM empleados e JOIN empleados j ON j.id = e.jefe_id WHERE e.salario > j.salario ORDER BY e.nombre;',
        hints: ['Une `empleados` consigo misma: `e` (empleado) y `j` (su jefe, `j.id = e.jefe_id`).', 'Filtra `e.salario > j.salario`.'],
        explain: 'El auto-JOIN es el patrón para relaciones «dentro de la misma tabla» (empleado → jefe). Aparece en casi todas las entrevistas.',
        commands: ['Auto-JOIN'],
      }),
      sqlPractice({
        goal: 'Departamentos vacíos',
        prompt: 'Recursos Humanos quiere saber qué departamentos **no tienen ningún empleado**.\n\n**Muestra `nombre` del departamento, ordenado por nombre.**',
        setup: ENTREVISTA,
        check: ordered({ names: true }),
        solution: 'SELECT d.nombre FROM departamentos d LEFT JOIN empleados e ON e.departamento_id = d.id WHERE e.id IS NULL ORDER BY d.nombre;',
        hints: ['Parte de `departamentos` con un `LEFT JOIN` a `empleados`.', 'Quédate con las filas donde `e.id IS NULL`.'],
        explain: 'El anti-join: los departamentos que no encuentran pareja en `empleados`. También valdría `NOT EXISTS`.',
        commands: ['Subconsulta'],
      }),
      sqlPractice({
        goal: 'Emails repetidos',
        prompt: 'La tabla `contactos` se llenó con registros duplicados. Encuentra los **emails que aparecen más de una vez**.\n\n**Muestra `email` y `veces`, de más a menos veces y luego por email.**',
        setup: CONTACTOS,
        check: ordered({ names: true }),
        solution: 'SELECT email, COUNT(*) AS veces FROM contactos GROUP BY email HAVING COUNT(*) > 1 ORDER BY veces DESC, email;',
        hints: ['Agrupa por `email` y cuenta.', 'Filtra los grupos con `HAVING COUNT(*) > 1`.'],
        explain: '`GROUP BY` + `HAVING COUNT(*) > 1` es la receta universal para detectar duplicados.',
        commands: ['Buscar duplicados'],
      }),
      sqlPractice({
        goal: 'Los dos mejor pagados por departamento',
        prompt: 'Para cada departamento, saca a los **dos empleados mejor pagados** (con `RANK`, de modo que un empate comparta puesto).\n\n**Muestra `departamento` (nombre), `nombre`, `salario` y `puesto`. Solo puestos 1 y 2, ordenado por departamento, puesto y nombre.**',
        setup: 'empresa',
        check: ordered({ names: true, uses: ['RANK'] }),
        solution:
          'SELECT departamento, nombre, salario, puesto FROM (SELECT d.nombre AS departamento, e.nombre, e.salario, RANK() OVER (PARTITION BY e.departamento_id ORDER BY e.salario DESC) AS puesto FROM empleados e JOIN departamentos d ON d.id = e.departamento_id) t WHERE puesto <= 2 ORDER BY departamento, puesto, nombre;',
        hints: ['`RANK() OVER (PARTITION BY e.departamento_id ORDER BY e.salario DESC)`', 'Filtra `puesto <= 2` en una consulta exterior (no se puede en el WHERE de la misma).'],
        explain: 'El patrón «top N por grupo»: función de ventana por departamento y filtro afuera. Con `RANK`, dos personas empatadas comparten puesto.',
        commands: ['RANK / DENSE_RANK'],
      }),
      sqlPractice({
        goal: 'La mediana',
        prompt: 'Calcula la **mediana** de los salarios de todos los empleados (el valor del medio; si hay un número par de empleados, la media de los dos centrales).\n\n**Muestra `mediana`, redondeada a 1 decimal.**',
        setup: 'empresa',
        check: same({ names: true, uses: ['ROW_NUMBER'] }),
        solution: 'SELECT ROUND(AVG(salario), 1) AS mediana FROM (SELECT salario, ROW_NUMBER() OVER (ORDER BY salario) AS rn, COUNT(*) OVER () AS n FROM empleados) t WHERE rn IN ((n + 1) / 2, (n + 2) / 2);',
        hints: ['Numera los salarios con `ROW_NUMBER()` y cuenta el total con `COUNT(*) OVER ()`.', 'Los centrales son `rn = (n + 1) / 2` y `rn = (n + 2) / 2` (división entera); promedia sus salarios.'],
        explain: 'Con 16 empleados, las posiciones 8 y 9 son las centrales (ambas 3.200). Con un número impar, las dos expresiones coinciden y el `AVG` devuelve el único valor central.',
        commands: ['RANK / DENSE_RANK', 'Subconsulta'],
      }),
    ]),
  ],
  boss: {
    goal: 'Entrevista final: los líderes de cada departamento',
    prompt:
      'Última pregunta de la entrevista, de las difíciles. La directora general quiere ver quién destaca en cada equipo:\n\nPara **cada departamento con al menos 3 empleados**, muestra al empleado (o empleados, si hay empate) con el **mayor salario**, y cuánto se aleja del salario medio de su departamento.\n\n**Muestra `departamento` (nombre), `nombre`, `salario`, `media` (salario medio del departamento, redondeado a 1 decimal) y `sobre_media` (porcentaje por encima de la media, redondeado a 1 decimal). De mayor a menor `sobre_media`.**',
    setup: 'empresa',
    check: ordered({ names: true }),
    solution:
      'SELECT d.nombre AS departamento, e.nombre, e.salario, ROUND(a.media, 1) AS media, ROUND(100.0 * (e.salario - a.media) / a.media, 1) AS sobre_media FROM empleados e JOIN departamentos d ON d.id = e.departamento_id JOIN (SELECT departamento_id, AVG(salario) AS media, COUNT(*) AS n, MAX(salario) AS maximo FROM empleados GROUP BY departamento_id) a ON a.departamento_id = e.departamento_id WHERE e.salario = a.maximo AND a.n >= 3 ORDER BY sobre_media DESC;',
    hints: [
      'Una subconsulta (o CTE) por departamento con la media, el máximo y el número de empleados.',
      'Une esa subconsulta con `empleados` y filtra `e.salario = máximo` y `n >= 3`.',
      'El porcentaje: `100.0 * (salario - media) / media`.',
    ],
    explain:
      'Agregar por grupo, unir el resultado con el detalle y filtrar por comparación: el patrón detrás de la mitad de los informes reales. Resultado: Ventas (Beatriz, +45,5 %) y Tecnología (Andrés, +41,2 %). ¡Has completado el curso de SQL: de tu primer SELECT a triggers, ventanas, recursión e índices! 🏆',
    commands: ['WITH', 'OVER / PARTITION BY', 'GROUP BY'],
  },
});
