import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { fails, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld, state } from '../sqlbuild';

const ESTUDIANTES = "CREATE TABLE estudiantes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL); CREATE TABLE cursos (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL); INSERT INTO estudiantes (nombre) VALUES ('Ana'), ('Luis'); INSERT INTO cursos (titulo) VALUES ('SQL'), ('Python');";
const PLANAS = "CREATE TABLE compras_planas (id INTEGER PRIMARY KEY, cliente_nombre TEXT NOT NULL, cliente_email TEXT NOT NULL, producto TEXT NOT NULL, precio REAL NOT NULL, cantidad INTEGER NOT NULL); INSERT INTO compras_planas (cliente_nombre, cliente_email, producto, precio, cantidad) VALUES ('Ana', 'ana@mail.com', 'Teclado', 79.9, 1), ('Ana', 'ana@mail.com', 'Ratón', 24.5, 2), ('Luis', 'luis@mail.com', 'Teclado', 79.9, 1), ('Marta', 'marta@mail.com', 'Monitor', 249, 1), ('Ana', 'ana@mail.com', 'Monitor', 249, 1), ('Luis', 'luis@mail.com', 'Ratón', 24.5, 3);";

export const s9 = sqlWorld({
  id: 's9',
  index: 9,
  title: 'Diseñar tablas',
  subtitle: 'CREATE TABLE, restricciones, relaciones y normalización',
  emoji: '🏗️',
  color: '#2DD4BF',
  level: 'avanzado',
  intro:
    'Hasta ahora has usado bases de datos que ya existían. Ahora te toca ser el **arquitecto**: decidir qué tablas hacen falta, qué columnas lleva cada una, qué tipo de dato es cada valor y qué reglas protegen la información. Un buen diseño hace que las consultas sean sencillas y que los datos no se contradigan jamás; uno malo acumula errores durante años. En esta zona aprenderás `CREATE TABLE` y sus restricciones, las claves foráneas con sus acciones, los tres tipos de relaciones y la normalización.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s9-1', { title: 'CREATE TABLE y tipos de datos', summary: 'Crear, modificar y borrar tablas', emoji: '🧱', commands: ['CREATE TABLE', 'Tipos de datos', 'ALTER TABLE', 'DROP TABLE'], minutes: 10 }, [
      learn(
        'Crear una tabla',
        `
\`CREATE TABLE\` define una tabla nueva: su nombre y, para cada columna, su **nombre**, su **tipo** y sus **restricciones**:

\`\`\`
CREATE TABLE mascotas (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  especie       TEXT,
  edad          INTEGER,
  adoptada      BOOLEAN DEFAULT false,
  fecha_ingreso DATE
);
\`\`\`

Convenciones que te ahorrarán problemas:

- Nombres de tabla en **plural** y **minúsculas con guiones bajos** (\`detalle_pedido\`), sin tildes ni espacios.
- **Una tabla por tipo de cosa.**
- Casi siempre una columna \`id\` como **clave primaria**; \`INTEGER PRIMARY KEY\` se numera sola.
`,
        '🧱',
      ),
      learn(
        'Tipos de datos',
        `
El **tipo** decide qué valores admite una columna y cómo se almacenan y comparan:

| Tipo | Sirve para | Ejemplo |
| --- | --- | --- |
| \`INTEGER\` | números enteros | \`42\` |
| \`REAL\` | decimales aproximados | \`3.14\` |
| \`NUMERIC(10, 2)\` | decimales **exactos** (dinero) | \`1299.99\` |
| \`TEXT\` / \`VARCHAR(n)\` | texto (con límite de n) | \`'Ana'\` |
| \`BOOLEAN\` | verdadero / falso | \`true\` |
| \`DATE\` | fecha | \`'2025-03-01'\` |
| \`TIMESTAMP\` | fecha y hora | \`'2025-03-01 18:30:00'\` |

> OJO: Para **dinero** usa \`NUMERIC(p, s)\` (o guarda céntimos como entero). Los \`REAL\` son aproximados y acumulan errores de redondeo: \`0.1 + 0.2\` no es exactamente \`0.3\`.
`,
        '🔢',
      ),
      sqlDemo('Crear, rellenar y mirar la estructura', 'vacia', [
        ["CREATE TABLE mascotas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, especie TEXT, edad INTEGER, adoptada BOOLEAN DEFAULT false, fecha_ingreso DATE);", 'La tabla nace vacía'],
        ["INSERT INTO mascotas (nombre, especie, edad) VALUES ('Luna', 'gato', 3);", 'Insertamos una fila sin dar id, adoptada ni fecha'],
        ['SELECT * FROM mascotas;', 'El id se numeró solo, «adoptada» tomó su DEFAULT (false) y la fecha, NULL'],
        ['PRAGMA table_info(mascotas);', 'PRAGMA table_info enseña la estructura: nombre, tipo, si es NOT NULL, su valor por defecto y si es clave primaria'],
        sqlErr("INSERT INTO mascotas (especie) VALUES ('perro');", 'Falta el nombre, que es NOT NULL'),
      ]),
      learn(
        'Cambiar una tabla: ALTER TABLE',
        `
Con \`ALTER TABLE\` modificas una tabla que **ya existe** (y que quizá ya tiene datos):

- \`ALTER TABLE t ADD COLUMN c TIPO\` — añade una columna (las filas existentes tendrán NULL o el \`DEFAULT\`).
- \`ALTER TABLE t RENAME COLUMN a TO b\` y \`ALTER TABLE t RENAME TO nuevo\`.
- \`ALTER TABLE t DROP COLUMN c\` — borra una columna **y sus datos**.

Y para eliminar una tabla entera: \`DROP TABLE t\` (con \`IF EXISTS\` para que no falle si no existe). **Borra la tabla y todo su contenido sin pedir confirmación.**

> OJO: Una columna nueva \`NOT NULL\` en una tabla con datos **necesita un \`DEFAULT\`**: si no, ¿qué valor tendrían las filas que ya existen?
`,
        '🔧',
      ),
      sqlDemo('Evolucionar una tabla', 'tienda', [
        ['ALTER TABLE productos ADD COLUMN descuento REAL NOT NULL DEFAULT 0;', 'Nueva columna con DEFAULT: las 14 filas existentes la reciben con 0'],
        ['SELECT nombre, precio, descuento FROM productos LIMIT 3;', 'Comprobamos'],
        sqlErr('ALTER TABLE productos ADD COLUMN etiqueta TEXT NOT NULL;', 'Sin DEFAULT no se puede: las filas que ya existen se quedarían sin valor'),
        ['ALTER TABLE productos RENAME COLUMN descuento TO descuento_pct;', 'Renombrar una columna'],
        ['ALTER TABLE productos DROP COLUMN descuento_pct;', 'Y volver a borrarla'],
      ]),
      mc('¿Qué tipo es el más adecuado para guardar un precio en euros con céntimos?', ['REAL', 'NUMERIC(10, 2)', 'TEXT', 'INTEGER'], 1, '`NUMERIC(10, 2)` guarda decimales exactos (hasta 2 decimales); `REAL` es aproximado y puede arrastrar errores de redondeo.'),
      sqlOut('Predice los valores por defecto', { db: 'vacia', script: 'CREATE TABLE m (a INTEGER, b BOOLEAN DEFAULT true, c TEXT); INSERT INTO m (a) VALUES (1);' }, 'SELECT * FROM m;', ['1 | NULL | NULL', '1 | true | true', '1 | false | NULL'], 'La columna `a` recibe el 1; `b` toma su `DEFAULT true`; y `c`, sin `DEFAULT`, queda en NULL.'),
      tf('`DROP TABLE clientes` pide confirmación antes de borrar los datos.', false, 'No pregunta nada: borra la tabla y todos sus datos al instante. Por eso en producción se usa con muchísimo cuidado (y con copias de seguridad).'),
      fill('Completa: añade una columna `peso` decimal a `productos`', 'ALTER TABLE productos ___ COLUMN peso ___;', ['ADD', 'DROP', 'REAL', 'TEXT'], ['ADD', 'REAL'], '`ADD COLUMN nombre TIPO` añade la columna; `peso` es un decimal, así que `REAL`.'),
      sqlCode('Crea una tabla `etiquetas` con `id` (entero, clave primaria) y `nombre` (texto, obligatorio).', {
        setup: 'vacia',
        check: state(['etiquetas']),
        solution: 'CREATE TABLE etiquetas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL);',
        hint: 'CREATE TABLE nombre (columna TIPO restricciones, …)',
        why: 'Una columna `id` como clave primaria y otra de texto marcada `NOT NULL`.',
      }),
      sqlPractice({
        goal: 'Tu primera tabla',
        prompt: 'La protectora de animales necesita su base de datos. Crea la tabla **`mascotas`** con estas columnas, en este orden:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `id` | `INTEGER` | clave primaria |\n| `nombre` | `TEXT` | obligatorio |\n| `especie` | `TEXT` | |\n| `edad` | `INTEGER` | |\n| `adoptada` | `BOOLEAN` | por defecto `false` |',
        setup: 'vacia',
        check: state(['mascotas']),
        solution: 'CREATE TABLE mascotas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, especie TEXT, edad INTEGER, adoptada BOOLEAN DEFAULT false);',
        hints: ['Cada columna: nombre, tipo y sus reglas.', '`adoptada BOOLEAN DEFAULT false`'],
        explain: 'Una tabla bien definida desde el principio evita errores futuros. Si el `id` es `INTEGER PRIMARY KEY`, se numera solo.',
        commands: ['CREATE TABLE', 'Tipos de datos'],
      }),
      sqlPractice({
        goal: 'Un descuento por producto',
        prompt: 'Comercial quiere guardar un porcentaje de descuento en cada producto.\n\n**Añade a `productos` la columna `descuento` (`REAL`, obligatoria, valor por defecto `0`).**',
        setup: 'tienda',
        check: state(['productos']),
        solution: 'ALTER TABLE productos ADD COLUMN descuento REAL NOT NULL DEFAULT 0;',
        hints: ['`ALTER TABLE … ADD COLUMN …`.', 'Al ser `NOT NULL` y haber filas, necesita `DEFAULT 0`.'],
        explain: 'Con `DEFAULT 0` las filas existentes se rellenan solas. Es la forma segura de añadir una columna obligatoria.',
        commands: ['ALTER TABLE'],
      }),
      sqlPractice({
        goal: 'Reservas de restaurante',
        prompt: 'Diseña la tabla **`reservas`** de un restaurante:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `id` | `INTEGER` | clave primaria |\n| `cliente` | `TEXT` | obligatorio |\n| `fecha` | `DATE` | obligatoria |\n| `personas` | `INTEGER` | por defecto `2` |\n| `senal` | `NUMERIC(8, 2)` | |',
        setup: 'vacia',
        check: state(['reservas']),
        solution: 'CREATE TABLE reservas (id INTEGER PRIMARY KEY, cliente TEXT NOT NULL, fecha DATE NOT NULL, personas INTEGER DEFAULT 2, senal NUMERIC(8, 2));',
        hints: ['`NUMERIC(8, 2)`: hasta 8 dígitos, 2 decimales.', '`personas INTEGER DEFAULT 2`'],
        explain: 'Elegir bien el tipo (`DATE` para la fecha, `NUMERIC` para el dinero) hace que los datos se ordenen, comparen y calculen correctamente.',
        commands: ['CREATE TABLE', 'Tipos de datos'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s9-2', { title: 'Restricciones', summary: 'NOT NULL, UNIQUE, CHECK, DEFAULT y claves compuestas', emoji: '🚧', commands: ['Restricciones'], minutes: 10 }, [
      learn(
        'Reglas que protegen los datos',
        `
Una **restricción** es una regla que la base de datos **vigila siempre**, venga el dato de donde venga (la aplicación, un script, alguien escribiendo a mano). Si una fila la incumple, se **rechaza**.

| Restricción | Garantiza |
| --- | --- |
| \`PRIMARY KEY\` | identifica cada fila: único y nunca NULL |
| \`NOT NULL\` | el valor es obligatorio |
| \`UNIQUE\` | no hay dos filas con el mismo valor (se admiten NULL) |
| \`CHECK (condición)\` | se cumple una condición lógica |
| \`DEFAULT valor\` | valor automático si no se indica |
| \`REFERENCES\` | el valor existe en otra tabla (clave foránea) |

> CLAVE: Las reglas **en la base de datos** son la última línea de defensa. Una aplicación puede tener un fallo; la restricción no.
`,
        '🚧',
      ),
      sqlDemo('Una tabla con reglas', 'vacia', [
        ["CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, edad INTEGER, CONSTRAINT edad_valida CHECK (edad BETWEEN 0 AND 120));", 'Cuatro reglas: id único, email obligatorio y único, edad entre 0 y 120'],
        ["INSERT INTO usuarios (email, edad) VALUES ('ana@mail.com', 30);", 'Un usuario correcto entra sin problema'],
        sqlErr("INSERT INTO usuarios (email, edad) VALUES ('ana@mail.com', 31);", 'UNIQUE: ese email ya está'),
        sqlErr("INSERT INTO usuarios (email, edad) VALUES ('luis@mail.com', 200);", 'CHECK: el error nombra la regla (edad_valida)'),
        sqlErr("INSERT INTO usuarios (edad) VALUES (25);", 'NOT NULL: falta el email'),
      ]),
      learn(
        'Claves compuestas y nombres de restricción',
        `
Una clave primaria puede estar formada por **varias columnas**: la **combinación** debe ser única, aunque cada valor por separado se repita.

\`\`\`
CREATE TABLE inscripciones (
  estudiante_id INTEGER,
  curso_id      INTEGER,
  nota          REAL,
  PRIMARY KEY (estudiante_id, curso_id)
);
\`\`\`

Un estudiante puede estar en muchos cursos y un curso tener muchos estudiantes, pero **no el mismo estudiante dos veces en el mismo curso**.

Con \`CONSTRAINT nombre\` le das **nombre** a una regla para que los errores sean legibles (\`CONSTRAINT edad_valida CHECK (…)\`).
`,
        '🧩',
      ),
      sqlDemo('Clave primaria compuesta', 'vacia', [
        ['CREATE TABLE inscripciones (estudiante_id INTEGER, curso_id INTEGER, nota REAL, PRIMARY KEY (estudiante_id, curso_id));', 'La pareja (estudiante, curso) es la clave'],
        ['INSERT INTO inscripciones VALUES (1, 1, 9), (1, 2, 8), (2, 1, 7);', 'El estudiante 1 en dos cursos y el curso 1 con dos estudiantes: todo válido'],
        sqlErr('INSERT INTO inscripciones VALUES (1, 1, 5);', 'Pero repetir la pareja (1, 1) viola la clave primaria'),
      ]),
      mc('Una columna `email` tiene `UNIQUE` y NO tiene `NOT NULL`. ¿Cuántas filas pueden tener `email` NULL?', ['Solo una', 'Todas las que quieras', 'Ninguna', 'Depende del tipo'], 1, 'Para `UNIQUE`, los NULL no se consideran iguales entre sí («desconocido» ≠ «desconocido»): puede haber varios.'),
      match(
        'Une cada regla con el problema que evita',
        [
          ['NOT NULL', 'Que falte un dato obligatorio'],
          ['UNIQUE', 'Dos usuarios con el mismo email'],
          ['CHECK (precio > 0)', 'Un precio negativo o cero'],
          ['DEFAULT 0', 'Tener que escribir el valor típico cada vez'],
        ],
        'Cada restricción previene un tipo de dato incorrecto o incómodo.',
      ),
      tf('Si una aplicación valida los datos antes de insertarlos, ya no hace falta poner restricciones en la base de datos.', false, 'Las restricciones son la última línea de defensa: protegen incluso de fallos de la aplicación y de cambios hechos a mano o por otros programas.'),
      sqlCode('Crea una tabla `productos_nuevos` con `id` (clave primaria), `nombre` (texto obligatorio) y `precio` (`REAL`, obligatorio, con `CHECK (precio > 0)`).', {
        setup: 'vacia',
        check: state(['productos_nuevos']),
        solution: 'CREATE TABLE productos_nuevos (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio REAL NOT NULL CHECK (precio > 0));',
        hint: 'precio REAL NOT NULL CHECK (precio > 0)',
        why: 'La restricción `CHECK` rechaza cualquier precio que no sea positivo.',
      }),
      sqlPractice({
        goal: 'Tabla de usuarios',
        prompt: 'Crea la tabla **`socios`** de un gimnasio:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `id` | `INTEGER` | clave primaria |\n| `dni` | `TEXT` | obligatorio y único |\n| `nombre` | `TEXT` | obligatorio |\n| `edad` | `INTEGER` | `CHECK (edad >= 16)` |\n| `cuota` | `NUMERIC(6, 2)` | por defecto `29.90` |',
        setup: 'vacia',
        check: state(['socios']),
        solution: 'CREATE TABLE socios (id INTEGER PRIMARY KEY, dni TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, edad INTEGER CHECK (edad >= 16), cuota NUMERIC(6, 2) DEFAULT 29.90);',
        hints: ['`dni TEXT NOT NULL UNIQUE`', '`edad INTEGER CHECK (edad >= 16)`'],
        explain: 'Cuatro tipos de restricción en una sola tabla. Fíjate en el orden dentro de cada columna: tipo, `NOT NULL`, `UNIQUE`/`CHECK`, `DEFAULT`.',
        commands: ['Restricciones'],
      }),
      sqlPractice({
        goal: 'Una clave compuesta',
        prompt: 'En un torneo, cada jugador puntúa una vez por ronda. Crea la tabla **`puntuaciones`**:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `jugador` | `TEXT` | |\n| `ronda` | `INTEGER` | |\n| `puntos` | `INTEGER` | obligatorio, por defecto `0` |\n\nLa **clave primaria** es la pareja (`jugador`, `ronda`).',
        setup: 'vacia',
        check: state(['puntuaciones']),
        solution: 'CREATE TABLE puntuaciones (jugador TEXT, ronda INTEGER, puntos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (jugador, ronda));',
        hints: ['La clave compuesta va al final: `PRIMARY KEY (jugador, ronda)`.', '`puntos INTEGER NOT NULL DEFAULT 0`'],
        explain: 'La clave compuesta impide que un mismo jugador puntúe dos veces la misma ronda, pero permite que puntúe en muchas rondas.',
        commands: ['Restricciones', 'PRIMARY KEY'],
      }),
      sqlPractice({
        goal: 'Rompe la regla',
        prompt: 'En la tabla `productos`, `precio` tiene `CHECK (precio > 0)`.\n\n**Escribe un `UPDATE` que intente poner a 0 el precio del producto con id 1 y que la base de datos rechace.**',
        setup: 'tienda',
        starter: '',
        check: fails('CHECK'),
        solution: 'UPDATE productos SET precio = 0 WHERE id = 1;',
        hints: ['Cambia `precio` a un valor que no sea mayor que 0.', '`UPDATE productos SET precio = 0 WHERE id = 1;`'],
        explain: 'Las restricciones se aplican también a las modificaciones, no solo a las inserciones: un `UPDATE` que incumple la regla se rechaza entero.',
        commands: ['Restricciones'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s9-3', { title: 'Claves foráneas y acciones', summary: 'REFERENCES y qué pasa al borrar o cambiar el padre', emoji: '🪢', commands: ['ON DELETE', 'FOREIGN KEY'], minutes: 10 }, [
      learn(
        'REFERENCES: declarar la relación',
        `
Una **clave foránea** se declara con \`REFERENCES\` y conecta una columna con la clave primaria de **otra tabla**:

\`\`\`
CREATE TABLE comentarios (
  id             INTEGER PRIMARY KEY,
  publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id),
  texto          TEXT NOT NULL
);
\`\`\`

La base de datos garantiza la **integridad referencial**: no puede existir un comentario cuya publicación no existe.

- \`NOT NULL\` en la clave foránea significa «**todo comentario pertenece a una publicación**». Sin él, el comentario puede quedar «suelto» (NULL).
- Se puede escribir también al final: \`FOREIGN KEY (publicacion_id) REFERENCES publicaciones(id)\`.
`,
        '🪢',
      ),
      learn(
        'ON DELETE: qué pasa con los hijos',
        `
¿Qué debe ocurrir con los comentarios si **se borra** la publicación? Lo decides con \`ON DELETE\`:

| Acción | Efecto al borrar el padre |
| --- | --- |
| \`RESTRICT\` / sin acción _(por defecto)_ | **Prohíbe** el borrado si hay hijos |
| \`CASCADE\` | **Borra también** los hijos |
| \`SET NULL\` | Deja a los hijos con la clave en NULL |
| \`SET DEFAULT\` | Les pone el valor por defecto |

Y \`ON UPDATE CASCADE\` propaga los cambios de la clave del padre a los hijos.

Elegir bien depende del significado: los **comentarios** no tienen sentido sin su publicación (\`CASCADE\`); el **responsable de una tarea** sí puede quedar sin asignar (\`SET NULL\`); una **factura** nunca debería poder desaparecer con su cliente (\`RESTRICT\`).
`,
        '🎛️',
      ),
      sqlDemo('Tres comportamientos', 'vacia', [
        ['CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b_cascada (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id) ON DELETE CASCADE); CREATE TABLE b_nulo (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id) ON DELETE SET NULL); CREATE TABLE b_restrict (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id) ON DELETE RESTRICT);', 'Un padre y tres hijos con distinta acción'],
        ['INSERT INTO a VALUES (1), (2); INSERT INTO b_cascada VALUES (1, 1), (2, 1), (3, 2); INSERT INTO b_nulo VALUES (1, 1), (2, 1), (3, 2);', 'Dos hijos de a=1 y uno de a=2 en las tablas de cascada y nulo'],
        ['DELETE FROM a WHERE id = 1;', 'Borramos el padre 1: ahora veamos cada hijo…'],
        ['SELECT * FROM b_cascada;', 'CASCADE: los hijos de 1 desaparecieron con él; queda solo el del padre 2'],
        ['SELECT * FROM b_nulo;', 'SET NULL: los hijos siguen, pero con a_id = NULL'],
        ['INSERT INTO b_restrict VALUES (1, 2);', 'Ahora un hijo RESTRICT del padre 2…'],
        sqlErr('DELETE FROM a WHERE id = 2;', 'RESTRICT: no te deja borrar al padre mientras tenga hijos (b_cascada borraría, pero b_restrict lo impide)'),
      ]),
      mc('Los comentarios de una publicación no tienen sentido sin ella. ¿Qué `ON DELETE` conviene?', ['RESTRICT', 'CASCADE', 'SET NULL', 'Ninguno'], 1, '`CASCADE` borra automáticamente los comentarios cuando se borra la publicación.'),
      sqlOut('Predice cuántos hijos quedan', { db: 'vacia', script: 'CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES a(id) ON DELETE CASCADE); INSERT INTO a VALUES (1), (2); INSERT INTO b VALUES (1, 1), (2, 1), (3, 2);' }, 'DELETE FROM a WHERE id = 1; SELECT COUNT(*) FROM b;', ['3', '2', '0'], 'Con `CASCADE`, al borrar el padre 1 desaparecen sus dos hijos y solo queda el del padre 2.'),
      tf('Con `ON DELETE SET NULL`, la columna de clave foránea no puede tener `NOT NULL`.', true, 'Si la columna es `NOT NULL`, no se puede dejar a NULL: la acción `SET NULL` fallaría. Lo coherente es una columna que admita NULL.'),
      sqlCode('Crea la tabla `comentarios` con `id` (clave primaria), `publicacion_id` (entero, obligatorio, que referencia a `publicaciones(id)` con `ON DELETE CASCADE`) y `texto` (texto, obligatorio).', {
        setup: 'social',
        check: state(['comentarios']),
        solution: 'CREATE TABLE comentarios (id INTEGER PRIMARY KEY, publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id) ON DELETE CASCADE, texto TEXT NOT NULL);',
        hint: 'REFERENCES publicaciones(id) ON DELETE CASCADE',
        why: 'La clave foránea con `CASCADE` borra los comentarios cuando se borra su publicación.',
      }),
      sqlPractice({
        goal: 'Tareas con responsable',
        prompt: 'En la empresa, cada tarea puede tener un responsable (un empleado) o ninguno. Si el empleado se va, la tarea no desaparece: queda sin asignar.\n\nCrea la tabla **`tareas`**:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `id` | `INTEGER` | clave primaria |\n| `titulo` | `TEXT` | obligatorio |\n| `responsable_id` | `INTEGER` | referencia a `empleados(id)` con `ON DELETE SET NULL` |',
        setup: 'empresa',
        check: state(['tareas']),
        solution: 'CREATE TABLE tareas (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, responsable_id INTEGER REFERENCES empleados(id) ON DELETE SET NULL);',
        hints: ['La clave foránea puede declararse en la propia columna con `REFERENCES`.', '`ON DELETE SET NULL` al final de la definición.'],
        explain: '`SET NULL` encaja con relaciones opcionales: la tarea sobrevive al empleado. Fíjate en que `responsable_id` **no** es `NOT NULL`.',
        commands: ['ON DELETE', 'FOREIGN KEY'],
      }),
      sqlPractice({
        goal: 'Pedidos que no desaparecen',
        prompt: 'Contabilidad quiere que **no se pueda borrar un cliente que tenga facturas**. Crea la tabla **`facturas`**:\n\n| columna | tipo | reglas |\n| --- | --- | --- |\n| `id` | `INTEGER` | clave primaria |\n| `cliente_id` | `INTEGER` | obligatorio, referencia a `clientes(id)` con `ON DELETE RESTRICT` |\n| `importe` | `NUMERIC(10, 2)` | obligatorio |',
        setup: 'tienda',
        check: state(['facturas']),
        solution: 'CREATE TABLE facturas (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT, importe NUMERIC(10, 2) NOT NULL);',
        hints: ['`cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT`', '`importe NUMERIC(10, 2) NOT NULL`'],
        explain: '`RESTRICT` es la acción más prudente: protege los datos que no deberían perderse jamás.',
        commands: ['ON DELETE', 'FOREIGN KEY'],
      }),
      sqlPractice({
        goal: 'Comprobar la integridad',
        prompt: 'Ya existe la tabla `comentarios`, que referencia a `publicaciones(id)`.\n\n**Escribe un `INSERT` que la base de datos rechace por violar la clave foránea** (un comentario de una publicación que no existe, por ejemplo la 999).',
        setup: { db: 'social', script: 'CREATE TABLE comentarios (id INTEGER PRIMARY KEY, publicacion_id INTEGER NOT NULL REFERENCES publicaciones(id), texto TEXT NOT NULL);' },
        starter: '',
        check: fails('clave foránea'),
        solution: "INSERT INTO comentarios (publicacion_id, texto) VALUES (999, 'Hola');",
        hints: ['Usa un `publicacion_id` que no exista.', 'Recuerda dar también el `texto`, que es obligatorio.'],
        explain: 'La integridad referencial impide los «comentarios huérfanos»: cada uno tiene que apuntar a una publicación real.',
        commands: ['FOREIGN KEY'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s9-4', { title: 'Relaciones: 1:N, N:M y 1:1', summary: 'Cómo se modela cada tipo de relación', emoji: '🕸️', commands: ['Relaciones'], minutes: 10 }, [
      learn(
        'Tres formas de relacionar cosas',
        `
Casi todas las bases de datos se reducen a tres tipos de relación:

1. **Uno a muchos (1:N)** — un cliente tiene **muchos** pedidos, pero cada pedido es de **un** cliente. Se resuelve con una **clave foránea en el lado «muchos»**: \`pedidos.cliente_id\`.
2. **Muchos a muchos (N:M)** — un estudiante cursa **muchos** cursos y un curso tiene **muchos** estudiantes. Se resuelve con una **tabla intermedia** (o «puente»), con una clave foránea a cada lado y **clave primaria compuesta**: \`inscripciones(estudiante_id, curso_id)\`.
3. **Uno a uno (1:1)** — un usuario tiene **un** perfil. La clave foránea es **también la clave primaria** del lado dependiente: \`perfiles.usuario_id\`.

La pregunta clave para decidir: _«¿cuántos de A pueden estar relacionados con uno de B, y al revés?»_
`,
        '🕸️',
      ),
      illus('sql-er-model', 'Tipos de relación', 'Observa cómo se conectan las tablas del modelo y qué columna es clave en cada extremo.'),
      sqlDemo('Las tres relaciones en acción', 'vacia', [
        ['CREATE TABLE estudiantes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL); CREATE TABLE cursos (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL); CREATE TABLE inscripciones (estudiante_id INTEGER REFERENCES estudiantes(id), curso_id INTEGER REFERENCES cursos(id), nota REAL, PRIMARY KEY (estudiante_id, curso_id));', 'N:M: la tabla intermedia une estudiantes y cursos'],
        ["INSERT INTO estudiantes (nombre) VALUES ('Ana'), ('Luis'); INSERT INTO cursos (titulo) VALUES ('SQL'), ('Python'); INSERT INTO inscripciones VALUES (1, 1, 9), (1, 2, 8), (2, 1, 7);", 'Ana cursa dos asignaturas; SQL tiene dos alumnos'],
        ['SELECT e.nombre, c.titulo, i.nota FROM inscripciones i JOIN estudiantes e ON e.id = i.estudiante_id JOIN cursos c ON c.id = i.curso_id ORDER BY e.nombre, c.titulo;', 'Para consultarla, un JOIN pasando por la tabla puente'],
        sqlErr('INSERT INTO inscripciones VALUES (1, 1, 5);', 'La clave compuesta impide inscribir dos veces al mismo estudiante en el mismo curso'),
      ]),
      mc('Una canción pertenece a un solo álbum, pero un álbum tiene muchas canciones. ¿Dónde va la clave foránea?', ['En la tabla albumes', 'En la tabla canciones', 'En una tabla intermedia', 'En ninguna'], 1, 'En el lado «muchos»: `canciones.album_id` apunta a `albumes.id`.'),
      match(
        'Une cada situación con su modelado',
        [
          ['Un cliente y sus pedidos', '1:N: clave foránea en pedidos'],
          ['Estudiantes y cursos', 'N:M: tabla intermedia'],
          ['Un usuario y su perfil', '1:1: la clave foránea es también la primaria'],
          ['Un libro y sus autores (puede haber varios)', 'N:M: tabla intermedia libros_autores'],
        ],
        'La cardinalidad (cuántos de cada lado) decide el modelado.',
      ),
      tf('En una relación N:M basta con añadir una columna `curso_id` a la tabla `estudiantes`.', false, 'Con una columna solo cabría un curso por estudiante (1:N). Para N:M hace falta una tabla intermedia con las dos claves foráneas.'),
      sqlCode('Crea la tabla intermedia `libros_autores` con `libro_id` y `autor_id` (enteros, claves foráneas a `libros(id)` y `autores(id)`), con clave primaria compuesta.', {
        setup: 'biblioteca',
        check: state(['libros_autores']),
        solution: 'CREATE TABLE libros_autores (libro_id INTEGER REFERENCES libros(id), autor_id INTEGER REFERENCES autores(id), PRIMARY KEY (libro_id, autor_id));',
        hint: 'PRIMARY KEY (libro_id, autor_id) al final',
        why: 'La tabla puente tiene una clave foránea a cada lado y la pareja como clave primaria.',
      }),
      sqlPractice({
        goal: 'Artistas y canciones (1:N)',
        prompt: 'Modela un catálogo musical. Crea **dos tablas**:\n\n**`artistas`**: `id` (`INTEGER`, clave primaria), `nombre` (`TEXT`, obligatorio).\n\n**`canciones`**: `id` (`INTEGER`, clave primaria), `titulo` (`TEXT`, obligatorio), `duracion` (`INTEGER`), `artista_id` (`INTEGER`, obligatorio, referencia a `artistas(id)`).',
        setup: 'vacia',
        check: state(['artistas', 'canciones']),
        solution: 'CREATE TABLE artistas (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL); CREATE TABLE canciones (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, duracion INTEGER, artista_id INTEGER NOT NULL REFERENCES artistas(id));',
        hints: ['Primero crea `artistas` (la tabla «padre»).', '`artista_id INTEGER NOT NULL REFERENCES artistas(id)`'],
        explain: 'Una relación 1:N: la clave foránea vive en el lado «muchos» (canciones). Hay que crear el padre antes que el hijo.',
        commands: ['Relaciones', 'FOREIGN KEY'],
      }),
      sqlPractice({
        goal: 'Inscripciones (N:M)',
        prompt: 'Ya existen las tablas `estudiantes` y `cursos`. Crea la tabla intermedia **`inscripciones`**:\n\n- `estudiante_id` (`INTEGER`, referencia a `estudiantes(id)`)\n- `curso_id` (`INTEGER`, referencia a `cursos(id)`)\n- `nota` (`REAL`)\n- **clave primaria** compuesta (`estudiante_id`, `curso_id`)',
        setup: { db: 'vacia', script: ESTUDIANTES },
        check: state(['inscripciones']),
        solution: 'CREATE TABLE inscripciones (estudiante_id INTEGER REFERENCES estudiantes(id), curso_id INTEGER REFERENCES cursos(id), nota REAL, PRIMARY KEY (estudiante_id, curso_id));',
        hints: ['Dos claves foráneas y una clave primaria compuesta.', 'La clave primaria compuesta va al final.'],
        explain: 'La tabla puente de una relación N:M: cada fila une un estudiante y un curso, y la pareja no puede repetirse. La nota es un dato propio de la relación.',
        commands: ['Relaciones'],
      }),
      sqlPractice({
        goal: 'Perfiles (1:1)',
        prompt: 'En la red social, cada usuario puede tener **un único perfil** con datos extra. La tabla `usuarios` ya existe.\n\nCrea la tabla **`perfiles`**:\n\n- `usuario_id` (`INTEGER`): clave primaria **y** referencia a `usuarios(id)`.\n- `bio` (`TEXT`)\n- `web` (`TEXT`)',
        setup: 'social',
        check: state(['perfiles']),
        solution: 'CREATE TABLE perfiles (usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id), bio TEXT, web TEXT);',
        hints: ['La misma columna es clave primaria y clave foránea.', '`usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id)`'],
        explain: 'Al ser la clave foránea **también** la clave primaria, cada usuario solo puede tener una fila en `perfiles`: eso es una relación 1:1.',
        commands: ['Relaciones', 'PRIMARY KEY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s9-5', { title: 'Normalización', summary: 'Evitar la repetición de datos y las contradicciones', emoji: '🧼', commands: ['Normalización'], minutes: 11 }, [
      learn(
        'La tabla que repite todo',
        `
Observa esta tabla, típica de una hoja de cálculo mal pasada a base de datos:

| id | cliente_nombre | cliente_email | producto | precio | cantidad |
| --- | --- | --- | --- | --- | --- |
| 1 | Ana | ana@mail.com | Teclado | 79.9 | 1 |
| 2 | Ana | ana@mail.com | Ratón | 24.5 | 2 |
| 3 | Luis | luis@mail.com | Teclado | 79.9 | 1 |

Problemas:

- El email de Ana está **repetido**: si cambia, hay que actualizar muchas filas… y si te olvidas de una, los datos se **contradicen** (_anomalía de actualización_).
- No puedes guardar un cliente sin una compra, ni un producto sin ventas (_anomalía de inserción_).
- Si borras la única compra de Luis, **pierdes también sus datos** (_anomalía de borrado_).

La **normalización** es el conjunto de reglas para evitarlo: **cada dato se guarda una sola vez**.
`,
        '🧼',
      ),
      illus('sql-normalization', 'De una tabla gigante a tablas pequeñas', 'Mira cómo se separan los datos repetidos en tablas propias conectadas por claves.'),
      learn(
        'Las tres formas normales',
        `
- **1.ª forma normal (1FN)**: cada celda guarda **un solo valor**, sin listas («lápiz, goma, regla» en una celda) ni columnas repetidas (\`telefono1\`, \`telefono2\`, \`telefono3\`).
- **2.ª forma normal (2FN)**: cada columna depende de **toda** la clave primaria, no de una parte. (Importa con claves compuestas.)
- **3.ª forma normal (3FN)**: las columnas dependen **solo de la clave**, no de otras columnas. El nombre del cliente depende del cliente, no del pedido: va en la tabla \`clientes\`.

Regla mnemotécnica: _«cada columna depende de la clave, de toda la clave y de nada más que la clave»_.

Resultado: tablas pequeñas, cada una sobre una sola cosa, relacionadas con claves foráneas. Es exactamente cómo está organizada TiendaTech.

> TIP: A veces se **desnormaliza** a propósito (duplicar un dato) para que una consulta lenta sea rápida, p. ej. en analítica. Pero es una decisión consciente, con coste, no un descuido.
`,
        '📐',
      ),
      sqlDemo('Normalizando paso a paso', { db: 'vacia', script: PLANAS }, [
        ['SELECT cliente_nombre, cliente_email, COUNT(*) AS filas FROM compras_planas GROUP BY cliente_nombre, cliente_email ORDER BY cliente_nombre;', 'Ana aparece 3 veces con el mismo email, Luis 2 y Marta 1'],
        ['CREATE TABLE clientes_n (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE);', 'Primer paso: una tabla de clientes, con cada cliente UNA sola vez'],
        ['INSERT INTO clientes_n (nombre, email) SELECT DISTINCT cliente_nombre, cliente_email FROM compras_planas ORDER BY cliente_nombre;', 'La rellenamos con los clientes distintos (INSERT … SELECT DISTINCT)'],
        ['SELECT * FROM clientes_n;', 'Tres clientes, tres filas. Si Ana cambia de email, se toca una sola fila'],
        ['SELECT c.nombre, SUM(p.precio * p.cantidad) AS gastado FROM compras_planas p JOIN clientes_n c ON c.email = p.cliente_email GROUP BY c.id, c.nombre ORDER BY c.nombre;', 'Y podemos seguir uniendo las compras con su cliente por el email'],
      ]),
      mc('Una columna `telefonos` guarda «600111222, 911222333» en la misma celda. ¿Qué forma normal incumple?', ['La 1FN: hay varios valores en una celda', 'La 2FN', 'La 3FN', 'Ninguna'], 0, 'La 1.ª forma normal exige un único valor por celda. Los teléfonos deberían estar en una tabla aparte con una fila por teléfono.'),
      mc('En una tabla `pedidos(id, cliente_id, cliente_nombre, fecha)`, ¿qué problema hay?', ['Ninguno', '`cliente_nombre` depende de `cliente_id`, no del pedido: está repetido y debería estar en `clientes`', 'Falta una clave primaria', 'La fecha sobra'], 1, 'Es una dependencia transitiva (3FN): el nombre depende del cliente, no del pedido. Guárdalo solo en `clientes`.'),
      sqlOut('Predice los clientes distintos', { db: 'vacia', script: PLANAS }, 'SELECT DISTINCT cliente_nombre FROM compras_planas ORDER BY cliente_nombre;', ['Ana\nLuis\nMarta\nAna\nAna\nLuis', 'Ana', 'Ana\nLuis'], 'Hay 6 compras pero solo 3 clientes distintos: Ana, Luis y Marta. `DISTINCT` quita los repetidos.'),
      tf('Normalizar una base de datos significa convertir todos los datos a minúsculas.', false, 'Normalizar es **reorganizar tablas** para que cada dato se guarde una sola vez y evitar contradicciones. Nada que ver con las mayúsculas.'),
      sqlPractice({
        goal: 'Separar a los clientes',
        prompt: 'La tabla plana `compras_planas` repite los datos de cada cliente.\n\n**Crea la tabla `clientes_n` (`id` `INTEGER` clave primaria, `nombre` `TEXT` obligatorio, `email` `TEXT` obligatorio y único) y rellénala con los clientes distintos, ordenados por nombre** (para que los `id` salgan 1, 2, 3).',
        setup: { db: 'vacia', script: PLANAS },
        check: state(['clientes_n']),
        solution: 'CREATE TABLE clientes_n (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE); INSERT INTO clientes_n (nombre, email) SELECT DISTINCT cliente_nombre, cliente_email FROM compras_planas ORDER BY cliente_nombre;',
        hints: ['Primero `CREATE TABLE`, luego `INSERT … SELECT DISTINCT …`.', 'Ordena por `cliente_nombre` para que los ids queden Ana = 1, Luis = 2, Marta = 3.'],
        explain: '`INSERT … SELECT DISTINCT` es la herramienta para extraer una tabla normalizada de una plana. Después se haría lo mismo con productos.',
        commands: ['Normalización', 'CREATE TABLE', 'DISTINCT'],
      }),
      sqlPractice({
        goal: 'Cambiar un dato una sola vez',
        prompt: 'Ana ha cambiado de email a `ana.garcia@mail.com`. Con la tabla `clientes_n` ya normalizada (y rellena), basta tocar **una fila**.\n\n**Escribe el `UPDATE` que cambie el email de Ana.**',
        setup: { db: 'vacia', script: `${PLANAS} CREATE TABLE clientes_n (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT NOT NULL UNIQUE); INSERT INTO clientes_n (nombre, email) SELECT DISTINCT cliente_nombre, cliente_email FROM compras_planas ORDER BY cliente_nombre;` },
        check: state(['clientes_n']),
        solution: "UPDATE clientes_n SET email = 'ana.garcia@mail.com' WHERE nombre = 'Ana';",
        hints: ['Un solo `UPDATE` con `WHERE nombre = \'Ana\'`.', 'En la tabla plana habría hecho falta cambiar 3 filas.'],
        explain: 'Esa es la gran ventaja: **un dato, un sitio**. Una sola fila cambiada y toda la base de datos queda coherente.',
        commands: ['Normalización', 'UPDATE'],
      }),
      sqlPractice({
        goal: 'La clave está en el diseño',
        prompt: 'Diseña desde cero la base de datos de una **videoteca de juegos**. Crea tres tablas:\n\n**`jugadores`**: `id` (`INTEGER`, clave primaria), `alias` (`TEXT`, obligatorio y único).\n\n**`juegos`**: `id` (`INTEGER`, clave primaria), `titulo` (`TEXT`, obligatorio), `precio` (`NUMERIC(6, 2)`, `CHECK (precio >= 0)`).\n\n**`partidas`**: `jugador_id` (`INTEGER`, referencia a `jugadores(id)` con `ON DELETE CASCADE`), `juego_id` (`INTEGER`, referencia a `juegos(id)`), `puntos` (`INTEGER`, por defecto `0`), clave primaria (`jugador_id`, `juego_id`).',
        setup: 'vacia',
        check: state(['jugadores', 'juegos', 'partidas']),
        solution: 'CREATE TABLE jugadores (id INTEGER PRIMARY KEY, alias TEXT NOT NULL UNIQUE); CREATE TABLE juegos (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, precio NUMERIC(6, 2) CHECK (precio >= 0)); CREATE TABLE partidas (jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE, juego_id INTEGER REFERENCES juegos(id), puntos INTEGER DEFAULT 0, PRIMARY KEY (jugador_id, juego_id));',
        hints: ['Crea primero las tablas «padre» (`jugadores`, `juegos`) y luego `partidas`.', '`partidas` es la tabla puente de la relación N:M.'],
        explain: 'Tres tablas, una relación N:M con tabla intermedia, claves compuestas, `CHECK`, `UNIQUE` y `CASCADE`: has diseñado un modelo completo.',
        commands: ['Normalización', 'Relaciones', 'CREATE TABLE'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el modelo de la biblioteca',
    prompt:
      'El ayuntamiento te encarga la base de datos de una **biblioteca de barrio**. Crea estas cuatro tablas respetando exactamente las reglas:\n\n**`socios`**: `id` (`INTEGER`, clave primaria), `nombre` (`TEXT`, obligatorio), `email` (`TEXT`, único).\n\n**`libros`**: `id` (`INTEGER`, clave primaria), `titulo` (`TEXT`, obligatorio), `paginas` (`INTEGER`, `CHECK (paginas > 0)`).\n\n**`prestamos`**: `id` (`INTEGER`, clave primaria), `socio_id` (`INTEGER`, obligatorio, referencia a `socios(id)` con `ON DELETE RESTRICT`), `libro_id` (`INTEGER`, obligatorio, referencia a `libros(id)`), `fecha_prestamo` (`DATE`, obligatoria), `fecha_devolucion` (`DATE`).\n\n**`reservas`**: `socio_id` (`INTEGER`, referencia a `socios(id)` con `ON DELETE CASCADE`), `libro_id` (`INTEGER`, referencia a `libros(id)` con `ON DELETE CASCADE`), clave primaria (`socio_id`, `libro_id`).',
    setup: 'vacia',
    check: state(['socios', 'libros', 'prestamos', 'reservas']),
    solution:
      'CREATE TABLE socios (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, email TEXT UNIQUE); CREATE TABLE libros (id INTEGER PRIMARY KEY, titulo TEXT NOT NULL, paginas INTEGER CHECK (paginas > 0)); CREATE TABLE prestamos (id INTEGER PRIMARY KEY, socio_id INTEGER NOT NULL REFERENCES socios(id) ON DELETE RESTRICT, libro_id INTEGER NOT NULL REFERENCES libros(id), fecha_prestamo DATE NOT NULL, fecha_devolucion DATE); CREATE TABLE reservas (socio_id INTEGER REFERENCES socios(id) ON DELETE CASCADE, libro_id INTEGER REFERENCES libros(id) ON DELETE CASCADE, PRIMARY KEY (socio_id, libro_id));',
    hints: ['Crea primero `socios` y `libros`: las demás dependen de ellas.', '`prestamos` es 1:N con socios y con libros; `reservas` es una tabla puente con clave compuesta.'],
    explain: 'Relaciones 1:N y N:M, claves foráneas con distintas acciones, `UNIQUE`, `CHECK`, `NOT NULL` y claves compuestas. Un modelo de datos completo, ¡de arquitecto!',
    commands: ['CREATE TABLE', 'Restricciones', 'Relaciones'],
  },
});
