import { illus, learn, lesson, match, mc, order, tf } from '../build';
import { both, fails, ordered, sqlCode, sqlDemo, sqlErr, sqlOut, sqlPractice, sqlWorld, state } from '../sqlbuild';

/** Entradas de un concierto con un contador de versión (para el control optimista). */
const ENTRADAS = {
  db: 'vacia',
  script:
    "CREATE TABLE entradas (id INTEGER PRIMARY KEY, evento TEXT NOT NULL, libres INTEGER NOT NULL CHECK (libres >= 0), version INTEGER NOT NULL DEFAULT 0); INSERT INTO entradas VALUES (1, 'Concierto', 1, 0), (2, 'Teatro', 5, 3);",
};

export const s13 = sqlWorld({
  id: 's13',
  index: 13,
  title: 'Transacciones y fiabilidad',
  subtitle: 'Que el dinero nunca desaparezca a mitad de camino',
  emoji: '🔒',
  color: '#5AA9FF',
  level: 'avanzado',
  intro:
    'Imagina una transferencia bancaria: se resta de una cuenta, se suma en otra… y se va la luz **entre las dos**. ¿Dónde está el dinero? Las bases de datos resuelven esto con las **transacciones**: un grupo de sentencias que se ejecuta **entero o nada**. En esta zona aprenderás ACID, `BEGIN`/`COMMIT`/`ROLLBACK`, los puntos de guardado, qué pasa cuando **muchos usuarios** tocan los mismos datos a la vez (concurrencia y aislamiento), cómo las restricciones protegen tus datos y cómo las **vistas** simplifican y protegen tus consultas.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('s13-1', { title: 'Todo o nada: transacciones', summary: 'ACID, BEGIN, COMMIT y ROLLBACK', emoji: '⚛️', commands: ['ACID', 'BEGIN / COMMIT / ROLLBACK'], minutes: 12 }, [
      learn(
        'La transferencia que se queda a medias',
        `
Para mover **100 €** de Ana a Beto hacen falta **dos** sentencias:

\`\`\`
UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;  -- Ana
UPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;  -- Beto
\`\`\`

Si el servidor se cae **entre las dos**, Ana perdió 100 € y Beto no los recibió: el dinero **ha desaparecido**. No podemos permitirlo.

La solución es agrupar las sentencias en una **transacción**: un bloque que la base de datos trata como **una sola operación indivisible**.

\`\`\`
BEGIN;                                                -- empieza
UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;
UPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;
COMMIT;                                               -- confirma: ahora es definitivo
\`\`\`

- \`BEGIN\` abre la transacción. Desde aquí tus cambios son **provisionales**: solo tú los ves.
- \`COMMIT\` los **confirma**: pasan a ser permanentes y visibles para todos.
- \`ROLLBACK\` los **descarta**: todo vuelve a como estaba en el \`BEGIN\`.
`,
        '🏦',
      ),
      illus('sql-transaction', 'Todo o nada', 'Prueba «Confirmar» y «Fallo» en la pestaña «Todo o nada».'),
      learn(
        'ACID: las cuatro garantías',
        `
Una base de datos seria cumple **ACID**:

- **A — Atomicidad**: la transacción se ejecuta **entera o nada**. No existe «a medias».
- **C — Consistencia**: la base de datos pasa de un estado **válido** a otro válido. Las restricciones (\`CHECK\`, claves foráneas…) siempre se cumplen.
- **I — Aislamiento** (_Isolation_): varias transacciones simultáneas **no se estorban**: cada una se comporta como si estuviera sola.
- **D — Durabilidad**: lo que se confirmó con \`COMMIT\` **sobrevive** aunque el servidor se caiga justo después (se escribe en un registro en disco).

> TIP: Si no abres una transacción, cada sentencia suelta es su **propia transacción** (modo _autocommit_): se confirma sola al terminar. Por eso hasta un \`UPDATE\` de mil filas que falla a la mitad no deja nada a medias.
`,
        '🧪',
      ),
      sqlDemo(
        'Confirmar y deshacer',
        'banco',
        [
          ['SELECT * FROM cuentas ORDER BY id;', 'Tres cuentas: Ana 1.000, Beto 250 y Clara 5.000'],
          ['BEGIN;', 'Abrimos la transacción'],
          ['UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', 'Restamos 100 a Ana…'],
          ['UPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;', '…y los sumamos a Beto'],
          ['SELECT * FROM cuentas ORDER BY id;', 'Dentro de la transacción ya ves los cambios (provisionales)'],
          ['ROLLBACK;', '¡Nos arrepentimos! Se descarta todo'],
          ['SELECT * FROM cuentas ORDER BY id;', 'Como si nada hubiera pasado'],
          ['BEGIN;', 'Esta vez en serio'],
          ['UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', ''],
          ['UPDATE cuentas SET saldo = saldo + 100 WHERE id = 2;', ''],
          ['COMMIT;', 'Confirmamos: ya es definitivo'],
          ['SELECT * FROM cuentas ORDER BY id;', 'Ana 900 y Beto 350: el dinero total sigue siendo el mismo'],
        ],
      ),
      sqlDemo(
        'Una sentencia también es atómica',
        'banco',
        [
          sqlErr('UPDATE cuentas SET saldo = saldo - 500;', 'Beto solo tiene 250: restarle 500 incumple el CHECK (saldo >= 0). La sentencia entera falla'),
          ['SELECT * FROM cuentas ORDER BY id;', 'Ni a Ana ni a Clara se les restó nada: la sentencia no deja nada a medias'],
        ],
      ),
      mc('¿Qué garantiza la **A** de ACID (atomicidad)?', ['Que los datos están cifrados', 'Que la transacción se ejecuta entera o no se ejecuta nada', 'Que varios usuarios pueden trabajar a la vez', 'Que los datos se guardan en disco'], 1, 'Atomicidad = indivisible: o se aplican todos los cambios de la transacción, o ninguno.'),
      mc('¿Qué letra de ACID asegura que lo confirmado con COMMIT no se pierde si se apaga el servidor?', ['Atomicidad', 'Consistencia', 'Aislamiento', 'Durabilidad'], 3, 'La durabilidad: tras el `COMMIT` los cambios están a salvo en disco aunque falle la corriente.'),
      sqlOut('Predice el saldo', 'banco', 'BEGIN; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; ROLLBACK; SELECT saldo FROM cuentas WHERE id = 1;', ['900.0', '1100.0', '100.0'], 'El `ROLLBACK` deshace el `UPDATE`: Ana sigue con sus 1000.'),
      tf('Después de un COMMIT todavía puedes deshacer la transacción con ROLLBACK.', false, 'Un `COMMIT` es definitivo. Un `ROLLBACK` posterior no tiene ninguna transacción que deshacer.'),
      order('Ordena una transferencia segura', ['BEGIN;', 'restar', 'sumar', 'COMMIT;'], 'BEGIN; restar sumar COMMIT;', 'Abres la transacción, haces las dos operaciones y confirmas al final.'),
      sqlCode('Transfiere **200** de Ana (id 1) a Clara (id 3) con una transacción confirmada.', {
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['BEGIN', 'COMMIT'] }),
        solution: 'BEGIN; UPDATE cuentas SET saldo = saldo - 200 WHERE id = 1; UPDATE cuentas SET saldo = saldo + 200 WHERE id = 3; COMMIT;',
        hint: 'BEGIN; … dos UPDATE … COMMIT;',
        why: 'Las dos modificaciones van juntas entre `BEGIN` y `COMMIT`: o se hacen las dos o ninguna.',
      }),
      sqlPractice({
        goal: 'Transferencia de Beto',
        prompt: 'Beto (id **2**) envía **50** a Clara (id **3**).\n\n**Hazlo en una sola transacción y deja los cambios confirmados.**',
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['BEGIN', 'COMMIT'] }),
        solution: 'BEGIN; UPDATE cuentas SET saldo = saldo - 50 WHERE id = 2; UPDATE cuentas SET saldo = saldo + 50 WHERE id = 3; COMMIT;',
        hints: ['Abre con `BEGIN;` y cierra con `COMMIT;`.', 'Dos `UPDATE`: uno resta a la cuenta 2 y otro suma a la cuenta 3.'],
        explain: 'Con la transacción, si el servidor falla entre los dos `UPDATE`, ninguno de los dos se aplica: el dinero nunca desaparece.',
        commands: ['BEGIN / COMMIT / ROLLBACK'],
      }),
      sqlPractice({
        goal: 'Probar y deshacer',
        prompt: 'El banco quiere simular qué pasaría si sube un **10 %** todos los saldos, **sin aplicarlo de verdad**.\n\nEn una transacción, ejecuta el `UPDATE` que multiplica todos los saldos por 1.1, **deshazlo** con `ROLLBACK` y por último muestra la suma de saldos real.\n\n**Muestra `total`.**',
        setup: 'banco',
        check: both(['cuentas'], { names: true, closed: true, uses: ['BEGIN', 'ROLLBACK', 'UPDATE'] }),
        solution: 'BEGIN; UPDATE cuentas SET saldo = saldo * 1.1; ROLLBACK; SELECT SUM(saldo) AS total FROM cuentas;',
        hints: ['`BEGIN;` → `UPDATE cuentas SET saldo = saldo * 1.1;` → `ROLLBACK;`', 'Termina con `SELECT SUM(saldo) AS total FROM cuentas;`'],
        explain: 'Una transacción es el «ensayo» perfecto: pruebas cambios con total libertad y, si no te convencen, `ROLLBACK` y todo sigue intacto (la suma es 6250, la original).',
        commands: ['BEGIN / COMMIT / ROLLBACK'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('s13-2', { title: 'Errores y puntos de guardado', summary: 'Transacciones abortadas y SAVEPOINT', emoji: '📍', commands: ['SAVEPOINT', 'BEGIN / COMMIT / ROLLBACK'], minutes: 11 }, [
      learn(
        'Cuando algo falla dentro de una transacción',
        `
Si una sentencia **falla dentro de una transacción**, en PostgreSQL la transacción entera queda **abortada**: el motor ignora **todo lo que escribas** hasta que hagas \`ROLLBACK\` (aunque sea un \`SELECT\` inocente). Así se evita seguir trabajando sobre datos a medias.

\`\`\`
BEGIN;
UPDATE ...;   -- ✅
UPDATE ...;   -- ❌ falla (por ejemplo, incumple un CHECK)
SELECT ...;   -- ❌ «la transacción está abortada»
ROLLBACK;     -- ✔️ única salida
\`\`\`

(Otros motores como MySQL o SQLite son más permisivos y te dejan continuar tras el error. Por eso conviene siempre **comprobar el resultado** de cada sentencia en tu programa.)
`,
        '🚨',
      ),
      sqlDemo(
        'Una transacción abortada',
        'banco',
        [
          ['BEGIN;', ''],
          ['UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', 'Primer paso correcto'],
          sqlErr('UPDATE cuentas SET saldo = saldo - 5000 WHERE id = 2;', 'Beto no tiene 5.000: se viola el CHECK y la transacción queda abortada'),
          sqlErr('SELECT * FROM cuentas;', 'Ahora hasta un SELECT se rechaza'),
          ['ROLLBACK;', 'La única salida: deshacer'],
          ['SELECT * FROM cuentas ORDER BY id;', 'Y Ana recupera sus 100: nada quedó a medias'],
        ],
      ),
      learn(
        'SAVEPOINT: puntos de guardado',
        `
A veces no quieres tirar **toda** la transacción por un fallo pequeño. Un **\`SAVEPOINT\`** es un punto intermedio al que puedes volver sin perder lo anterior:

\`\`\`
BEGIN;
UPDATE ...;                  -- paso 1 (queremos conservarlo)
SAVEPOINT despues_del_paso1;
UPDATE ...;                  -- paso 2 (arriesgado)
ROLLBACK TO despues_del_paso1;  -- deshace SOLO el paso 2
COMMIT;                      -- confirma el paso 1
\`\`\`

- \`SAVEPOINT nombre\` marca el punto.
- \`ROLLBACK TO nombre\` vuelve a él (y **cancela el estado de «abortada»** si hubo un error).
- \`RELEASE SAVEPOINT nombre\` descarta el marcador (los cambios se quedan).

Se pueden crear varios, con nombres distintos. Lo usan los programas que procesan muchos registros: si uno falla, deshacen solo ese y siguen con los demás.
`,
        '📍',
      ),
      sqlDemo(
        'Recuperarse de un error con SAVEPOINT',
        'banco',
        [
          ['BEGIN;', ''],
          ['UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1;', 'Paso 1: Ana pierde 100'],
          ['SAVEPOINT tras_ana;', 'Guardamos un punto'],
          sqlErr('UPDATE cuentas SET saldo = saldo - 5000 WHERE id = 2;', 'Paso 2 falla: la transacción se aborta'),
          ['ROLLBACK TO tras_ana;', 'Volvemos al punto: el fallo se deshace y la transacción vuelve a estar viva'],
          ['UPDATE cuentas SET saldo = saldo + 100 WHERE id = 3;', 'Continuamos con otro paso'],
          ['COMMIT;', 'Confirmamos lo que sí salió bien (el paso 1 y este)'],
          ['SELECT * FROM cuentas ORDER BY id;', 'Ana 900, Beto 250 y Clara 5.100'],
        ],
      ),
      mc('En PostgreSQL, tras un error dentro de una transacción (sin SAVEPOINT), ¿qué pasa con las siguientes sentencias?', ['Se ejecutan con normalidad', 'Se ignoran hasta que hagas ROLLBACK', 'Se confirman solas', 'Se ejecutan pero sin guardar'], 1, 'La transacción queda abortada: cualquier sentencia da error hasta que la termines con `ROLLBACK` (o `ROLLBACK TO` un savepoint).'),
      sqlOut(
        'Predice el saldo con SAVEPOINT',
        'banco',
        'BEGIN; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; SAVEPOINT a; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; ROLLBACK TO a; COMMIT; SELECT saldo FROM cuentas WHERE id = 1;',
        ['800.0', '1000.0', '1100.0'],
        'El `ROLLBACK TO a` deshace solo el segundo `UPDATE`. El primero se confirma con el `COMMIT`: 1000 − 100 = 900.',
      ),
      tf('`ROLLBACK TO nombre` deshace toda la transacción, incluido lo anterior al SAVEPOINT.', false, 'Solo deshace lo hecho **después** del punto de guardado. Lo anterior se mantiene y la transacción sigue abierta.'),
      order('Ordena: conserva el paso 1 y descarta el paso 2', ['BEGIN;', 'paso1', 'SAVEPOINT', 'paso2', 'ROLLBACK', 'TO', 'COMMIT;'], 'BEGIN; paso1 SAVEPOINT paso2 ROLLBACK TO COMMIT;', 'Se marca un punto tras el paso 1; si el paso 2 sale mal, se vuelve al punto y se confirma lo que queda.'),
      sqlCode('Dentro de una transacción: guarda un punto `p`, resta 100 a Ana (id 1), vuelve al punto `p` y confirma. Ana debe seguir con su saldo.', {
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['SAVEPOINT', 'ROLLBACK TO'] }),
        solution: 'BEGIN; SAVEPOINT p; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; ROLLBACK TO p; COMMIT;',
        hint: 'BEGIN; SAVEPOINT p; UPDATE …; ROLLBACK TO p; COMMIT;',
        why: 'Volver al punto deshace el `UPDATE` hecho después de él; el `COMMIT` confirma una transacción que no cambia nada.',
      }),
      sqlPractice({
        goal: 'Solo el primer paso',
        prompt: 'En **una transacción**:\n\n1. Resta **100** a Ana (id 1).\n2. Guarda un punto llamado `tras_ana`.\n3. Resta **100** a Beto (id 2) _por error_.\n4. Vuelve a `tras_ana`.\n5. Confirma.\n\n**Al final solo Ana debe tener 100 menos.**',
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['SAVEPOINT', 'ROLLBACK TO', 'COMMIT'] }),
        solution: 'BEGIN; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; SAVEPOINT tras_ana; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 2; ROLLBACK TO tras_ana; COMMIT;',
        hints: ['El punto se crea **después** del primer `UPDATE`.', '`ROLLBACK TO tras_ana;` deshace el segundo `UPDATE` y deja el primero.'],
        explain: 'El punto de guardado separa lo que quieres conservar (Ana −100) de lo que descartas (Beto −100). El `COMMIT` final solo confirma lo anterior al punto.',
        commands: ['SAVEPOINT'],
      }),
      sqlPractice({
        goal: 'Dos puntos de guardado',
        prompt: 'En **una transacción**:\n\n1. Resta **100** a Ana (id 1).\n2. Guarda el punto `a`.\n3. Resta **50** a Beto (id 2).\n4. Guarda el punto `b`.\n5. Resta **1000** a Clara (id 3).\n6. Vuelve al punto `a`.\n7. Confirma.\n\n**Al final solo Ana debe tener 100 menos.**',
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['SAVEPOINT', 'ROLLBACK TO', 'COMMIT'] }),
        solution:
          'BEGIN; UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1; SAVEPOINT a; UPDATE cuentas SET saldo = saldo - 50 WHERE id = 2; SAVEPOINT b; UPDATE cuentas SET saldo = saldo - 1000 WHERE id = 3; ROLLBACK TO a; COMMIT;',
        hints: ['Hay dos `SAVEPOINT` (`a` y `b`).', 'Volver a `a` deshace todo lo posterior, incluido lo guardado en `b`.'],
        explain: 'Volver a un punto antiguo descarta todos los cambios posteriores y también los puntos creados después (aquí `b`).',
        commands: ['SAVEPOINT'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('s13-3', { title: 'Muchos usuarios a la vez', summary: 'Concurrencia, aislamiento y bloqueos', emoji: '👥', commands: ['Concurrencia y aislamiento'], minutes: 13 }, [
      learn(
        'El problema: dos manos en el mismo dato',
        `
Una aplicación real tiene **cientos de usuarios simultáneos**. Si dos transacciones tocan los mismos datos a la vez, pueden pasar cosas raras. Los casos clásicos:

**1. Actualización perdida** (_lost update_): dos usuarios leen el mismo saldo y cada uno escribe su resultado, pisándose.

\`\`\`
Saldo = 1000
Usuario A: lee 1000          Usuario B: lee 1000
Usuario A: escribe 1000-100  Usuario B: escribe 1000-200
Resultado: 800 (¡se perdió el cobro de A!). Debían ser 700.
\`\`\`

**2. Lectura sucia** (_dirty read_): leer datos de otra transacción que aún **no ha hecho COMMIT** (y quizá haga ROLLBACK).

**3. Lectura no repetible**: leer la misma fila dos veces en tu transacción y obtener valores distintos porque otro hizo COMMIT entre medias.

**4. Lectura fantasma** (_phantom_): repetir una consulta y que aparezcan **filas nuevas** (o desaparezcan) porque otro hizo COMMIT.
`,
        '👥',
      ),
      illus('sql-transaction', 'Dos usuarios a la vez', 'Elige la pestaña «Dos usuarios» y compara lo que ocurre sin protección y con SELECT … FOR UPDATE.'),
      learn(
        'Niveles de aislamiento',
        `
El **aislamiento** decide cuánto se «ven» las transacciones simultáneas. El estándar SQL define cuatro niveles; cuanto más alto, **más seguro** pero **más lento** (más esperas y conflictos):

| Nivel | Lectura sucia | No repetible | Fantasma |
| --- | --- | --- | --- |
| \`READ UNCOMMITTED\` | posible | posible | posible |
| \`READ COMMITTED\` (por defecto en PostgreSQL) | no | posible | posible |
| \`REPEATABLE READ\` | no | no | posible* |
| \`SERIALIZABLE\` | no | no | no |

\\* En PostgreSQL, \`REPEATABLE READ\` también evita los fantasmas.

Se elige al empezar:

\`\`\`
BEGIN ISOLATION LEVEL SERIALIZABLE;
\`\`\`

o con \`SET TRANSACTION ISOLATION LEVEL …\` justo al principio de la transacción.
`,
        '🎚️',
      ),
      learn(
        'Cómo evitar pisarse: tres herramientas',
        `
1. **Operaciones relativas y atómicas.** Que sea la base de datos quien calcule: \`UPDATE cuentas SET saldo = saldo - 100\` en vez de leer el saldo en tu programa y escribir \`SET saldo = 900\`. Así el cálculo se hace sobre el valor **actual**, aunque otro haya cambiado.

2. **Bloqueos de fila**: \`SELECT … FOR UPDATE\` lee una fila y la **bloquea** hasta tu \`COMMIT\`: cualquier otra transacción que quiera modificarla **espera**. Úsalo cuando necesites «leer, decidir y escribir» con garantías.

3. **Control optimista** (_optimistic locking_): añade una columna \`version\`. Al actualizar compruebas que nadie la cambió: \`UPDATE … SET …, version = version + 1 WHERE id = 1 AND version = 3\`. Si devuelve **0 filas actualizadas**, alguien se adelantó: tú reintentas.

> OJO: Los bloqueos pueden provocar un **interbloqueo** (_deadlock_): A espera lo que tiene B y B espera lo que tiene A. El motor detecta el ciclo y aborta una de las dos. Se evita tocando siempre las filas **en el mismo orden**.
`,
        '🔐',
      ),
      sqlDemo(
        'Control optimista con una columna de versión',
        ENTRADAS,
        [
          ['SELECT * FROM entradas WHERE id = 1;', 'Queda 1 entrada para el concierto (versión 0)'],
          ['UPDATE entradas SET libres = libres - 1, version = version + 1 WHERE id = 1 AND version = 0;', 'Usuario A compra: la versión coincide, se actualiza 1 fila'],
          ['UPDATE entradas SET libres = libres - 1, version = version + 1 WHERE id = 1 AND version = 0;', 'Usuario B intentó comprar con la versión antigua: 0 filas actualizadas → ¡alguien se adelantó!'],
          ['SELECT * FROM entradas WHERE id = 1;', 'La entrada se vendió una sola vez: ni se sobrevende ni se pierde nada'],
        ],
        'Dos usuarios intentan comprar la **última entrada** con la versión que leyeron al principio (la 0).',
      ),
      sqlDemo(
        'Bloquear antes de decidir',
        'banco',
        [
          ['BEGIN;', ''],
          ['SELECT saldo FROM cuentas WHERE id = 1 FOR UPDATE;', 'Lees el saldo y bloqueas la fila: ninguna otra transacción puede modificar a Ana hasta que termines'],
          ['UPDATE cuentas SET saldo = saldo - 300 WHERE id = 1;', 'Con la certeza de que el saldo que viste sigue siendo el real, haces el cobro'],
          ['COMMIT;', 'Al confirmar se libera el bloqueo'],
        ],
        'Aquí solo hay una conexión, así que no verás esperas; en un servidor real, otras conexiones quedarían esperando.',
      ),
      match(
        'Une cada problema con su descripción',
        [
          ['Actualización perdida', 'Dos usuarios leen y escriben el mismo dato y uno pisa al otro'],
          ['Lectura sucia', 'Se lee algo que otra transacción aún no confirmó'],
          ['Lectura no repetible', 'La misma fila da valores distintos en dos lecturas de la misma transacción'],
          ['Lectura fantasma', 'Al repetir una consulta aparecen o desaparecen filas'],
        ],
        'Son las cuatro anomalías que el aislamiento intenta evitar.',
      ),
      mc('¿Qué nivel de aislamiento evita **todas** las anomalías?', ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'], 3, '`SERIALIZABLE` hace que el resultado sea como si las transacciones se hubieran ejecutado una detrás de otra. Es el más seguro y el más costoso.'),
      mc('Quieres restar 100 al saldo sin riesgo de pisar a otro usuario. ¿Cuál es la mejor forma?', ['Leer el saldo en tu programa y escribir `SET saldo = 900`', '`UPDATE cuentas SET saldo = saldo - 100 WHERE id = 1`', 'Hacer un `DELETE` y un `INSERT`', 'Reiniciar el servidor'], 1, 'La operación relativa la calcula la base de datos sobre el valor actual en el momento de escribir: no depende de lo que leyó tu programa antes.'),
      sqlOut(
        'Predice el control optimista',
        ENTRADAS,
        'UPDATE entradas SET libres = libres - 1, version = version + 1 WHERE id = 2 AND version = 3; UPDATE entradas SET libres = libres - 1, version = version + 1 WHERE id = 2 AND version = 3; SELECT libres, version FROM entradas WHERE id = 2;',
        ['3 | 5', '5 | 3', '4 | 5'],
        'La primera actualización cambia la versión a 4. La segunda sigue buscando `version = 3`, ya no hay ninguna fila y no cambia nada: queda `libres = 4` y `version = 4`.',
      ),
      sqlPractice({
        goal: 'Reservar sin pisar',
        prompt: 'Compra **una entrada del Teatro** (id 2) con control optimista: en el momento de leerla la versión era **3**.\n\n**Resta 1 a `libres`, sube `version` en 1, y haz que solo se aplique si la versión sigue siendo 3.**',
        setup: ENTRADAS,
        check: state(['entradas']),
        solution: 'UPDATE entradas SET libres = libres - 1, version = version + 1 WHERE id = 2 AND version = 3;',
        hints: ['`SET libres = libres - 1, version = version + 1`', 'En el `WHERE`: `id = 2 AND version = 3`.'],
        explain: 'La condición `version = 3` convierte el `UPDATE` en un «compara y cambia» atómico. Si otra persona se adelantó, no se actualiza nada y tu aplicación sabe que debe volver a leer y reintentar.',
        commands: ['Concurrencia y aislamiento'],
      }),
      sqlPractice({
        goal: 'Cobro con bloqueo',
        prompt: 'Cobra **300** a Ana (id 1) de forma segura. En **una transacción**: primero lee y **bloquea** su fila con `SELECT … FOR UPDATE`, después resta los 300 y confirma.',
        setup: 'banco',
        check: state(['cuentas'], { closed: true, uses: ['BEGIN', 'FOR UPDATE', 'COMMIT'] }),
        solution: 'BEGIN; SELECT saldo FROM cuentas WHERE id = 1 FOR UPDATE; UPDATE cuentas SET saldo = saldo - 300 WHERE id = 1; COMMIT;',
        hints: ['El `SELECT saldo FROM cuentas WHERE id = 1 FOR UPDATE;` va dentro de la transacción, antes del `UPDATE`.'],
        explain: 'Con `FOR UPDATE` nadie más puede cambiar la cuenta mientras decides: el patrón «leer, decidir, escribir» queda protegido hasta el `COMMIT`.',
        commands: ['Concurrencia y aislamiento'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('s13-4', { title: 'La red de seguridad', summary: 'Restricciones que protegen tus datos', emoji: '🛡️', commands: ['Restricciones', 'FOREIGN KEY'], minutes: 11 }, [
      learn(
        'La base de datos es la última defensa',
        `
Tu aplicación tiene validaciones… y también tiene **errores**. Hay otros programas, scripts de mantenimiento, personas con acceso directo a la base… Si la única barrera está en el código, tarde o temprano entrarán datos imposibles: saldos negativos, pedidos sin cliente, emails repetidos.

Las **restricciones** (_constraints_) se declaran una vez en la tabla y la base de datos las hace cumplir **siempre, venga de donde venga la sentencia**. Son la «C» de ACID: la **consistencia**.

- \`NOT NULL\` — el dato es obligatorio.
- \`UNIQUE\` — sin repeticiones.
- \`CHECK (condición)\` — reglas de negocio (\`saldo >= 0\`, \`importe > 0\`).
- \`PRIMARY KEY\` — identifica cada fila.
- \`FOREIGN KEY\` — solo se puede referenciar algo que existe (y, con \`ON DELETE\`, qué hacer al borrar).
- \`DEFAULT\` — valor si no se indica.

> TIP: Combina transacciones y restricciones: si una sentencia de la transacción viola una restricción, la transacción **no puede confirmarse** y todo se deshace.
`,
        '🛡️',
      ),
      sqlDemo(
        'Lo que la base de datos no deja pasar',
        'banco',
        [
          sqlErr('INSERT INTO cuentas VALUES (4, \'Dani\', -5);', 'CHECK: un saldo no puede ser negativo'),
          sqlErr("INSERT INTO movimientos VALUES (9, 99, 10, 'Ingreso', '2025-01-01');", 'FOREIGN KEY: la cuenta 99 no existe'),
          sqlErr('DELETE FROM cuentas WHERE id = 1;', 'FOREIGN KEY: Ana tiene movimientos que dependen de ella'),
          sqlErr('UPDATE cuentas SET saldo = saldo - 2000 WHERE id = 1;', 'CHECK otra vez, ahora en un UPDATE'),
          ['SELECT * FROM cuentas ORDER BY id;', 'Ningún intento dejó rastro: los datos siguen válidos'],
        ],
      ),
      sqlDemo(
        'Restricción + transacción',
        'banco',
        [
          ['BEGIN;', 'Transferencia de 300 de Beto a Ana, empezando por el ingreso (¡al revés!)'],
          ['UPDATE cuentas SET saldo = saldo + 300 WHERE id = 1;', 'Ana recibe 300…'],
          sqlErr('UPDATE cuentas SET saldo = saldo - 300 WHERE id = 2;', '…pero Beto solo tiene 250: el CHECK lo impide'),
          ['ROLLBACK;', 'Se deshace TODO, también el ingreso a Ana'],
          ['SELECT * FROM cuentas ORDER BY id;', 'El dinero total sigue siendo 6.250: la transacción y el CHECK trabajan juntos'],
        ],
      ),
      learn(
        'Añadir restricciones a una tabla existente',
        `
No hace falta decidirlo todo al crear la tabla. Puedes añadir reglas después con \`ALTER TABLE\`:

\`\`\`
ALTER TABLE movimientos
  ADD CONSTRAINT importe_no_cero CHECK (importe <> 0);
\`\`\`

Los datos **que ya existen** deben cumplir la regla; si no, la sentencia falla y habrá que corregirlos antes. Ponerle **nombre** a la restricción (\`CONSTRAINT importe_no_cero\`) hace que el error diga exactamente cuál se incumplió.

Para una tabla nueva, puedes declarar restricciones a nivel de columna y a nivel de tabla (las que involucran varias columnas):

\`\`\`
CREATE TABLE transferencias (
  id      INTEGER PRIMARY KEY,
  origen  INTEGER NOT NULL REFERENCES cuentas(id),
  destino INTEGER NOT NULL REFERENCES cuentas(id),
  importe REAL    NOT NULL CHECK (importe > 0),
  CHECK (origen <> destino)
);
\`\`\`
`,
        '📐',
      ),
      mc('¿Dónde debes aplicar las reglas de negocio importantes (saldo no negativo, email único…)?', ['Solo en la aplicación', 'Solo en la base de datos', 'En la base de datos (y también en la aplicación para dar buenos mensajes)', 'En ningún sitio'], 2, 'La base de datos es la garantía final, venga la sentencia de donde venga; la aplicación valida además para ofrecer una experiencia amable.'),
      mc('Una transferencia viola un `CHECK` a la mitad de una transacción. ¿Qué ocurre con los cambios anteriores de esa transacción?', ['Se confirman igualmente', 'Se pierden al hacer ROLLBACK (la transacción no puede confirmarse)', 'Se confirman la mitad', 'Se guardan en un fichero'], 1, 'La transacción queda abortada: lo correcto es `ROLLBACK`, que deshace todo lo hecho desde el `BEGIN`.'),
      tf('Si una restricción `CHECK` se añade a una tabla que ya tiene datos que la incumplen, la sentencia funciona igualmente.', false, 'Los datos existentes deben cumplir la regla. Si no, falla y hay que corregirlos antes (con un `UPDATE` o `DELETE`).'),
      sqlCode('Prueba que la base te protege: escribe una sentencia que intente dejar a Beto (id 2) con **saldo negativo**.', {
        setup: 'banco',
        check: fails('CHECK'),
        solution: 'UPDATE cuentas SET saldo = saldo - 1000 WHERE id = 2;',
        hint: 'Resta más de 250 al saldo de Beto',
        why: 'El `CHECK (saldo >= 0)` rechaza cualquier modificación que deje un saldo negativo.',
      }),
      sqlPractice({
        goal: 'Importes que no sean cero',
        prompt: 'Un movimiento de 0 € no tiene sentido. **Añade a la tabla `movimientos` una restricción `CHECK` que impida que `importe` valga 0.**',
        setup: 'banco',
        check: state(['movimientos']),
        solution: 'ALTER TABLE movimientos ADD CONSTRAINT importe_no_cero CHECK (importe <> 0);',
        hints: ['`ALTER TABLE … ADD CONSTRAINT nombre CHECK (condición);`', 'La condición es `importe <> 0`.'],
        explain: 'Con `ALTER TABLE … ADD CONSTRAINT` blindas una tabla existente. Desde ahora, ni la aplicación ni nadie podrá insertar un movimiento de 0 €.',
        commands: ['Restricciones'],
      }),
      sqlPractice({
        goal: 'La tabla de transferencias',
        prompt: 'Crea la tabla **`transferencias`** para registrar las transferencias entre cuentas:\n\n- `id`: entero, clave primaria.\n- `origen` y `destino`: enteros obligatorios, **claves foráneas** a `cuentas(id)`.\n- `importe`: número real obligatorio con un `CHECK` que exija que sea **mayor que 0**.\n- Un `CHECK` de tabla que impida que `origen` y `destino` sean **la misma cuenta**.',
        setup: 'banco',
        check: state(['transferencias']),
        solution: 'CREATE TABLE transferencias (id INTEGER PRIMARY KEY, origen INTEGER NOT NULL REFERENCES cuentas(id), destino INTEGER NOT NULL REFERENCES cuentas(id), importe REAL NOT NULL CHECK (importe > 0), CHECK (origen <> destino));',
        hints: ['Las claves foráneas: `REFERENCES cuentas(id)`.', 'Dos `CHECK`: uno en la columna `importe` y otro al final de la tabla (`origen <> destino`).'],
        explain: 'Cada regla de negocio queda escrita en la propia tabla: una transferencia de una cuenta a sí misma, de importe cero o hacia una cuenta inexistente es imposible, sin escribir ni una línea de código de aplicación.',
        commands: ['Restricciones', 'FOREIGN KEY'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('s13-5', { title: 'Vistas', summary: 'Consultas guardadas con nombre', emoji: '🪟', commands: ['CREATE VIEW'], minutes: 10 }, [
      learn(
        'Una consulta con nombre',
        `
Una **vista** (_view_) es una **consulta guardada** a la que le pones nombre. Después la usas como si fuera una tabla:

\`\`\`
CREATE VIEW cuentas_ricas AS
  SELECT titular, saldo FROM cuentas WHERE saldo >= 1000;

SELECT * FROM cuentas_ricas;
\`\`\`

Importante: una vista **no guarda datos**. Cada vez que la consultas, se ejecuta la consulta de dentro sobre los datos **actuales**. Por eso siempre está al día.

**¿Para qué sirven?**

- 🧩 **Simplificar**: esconden \`JOIN\`s y cálculos complicados detrás de un nombre sencillo.
- ♻️ **Reutilizar**: la lógica se escribe una vez y la usan todos los informes.
- 🔒 **Proteger**: puedes dejar que alguien lea una vista que muestra solo ciertas columnas o filas (por ejemplo, sin el saldo).
- 🔄 **Evolucionar**: si cambia la estructura, mantienes la vista y los informes no se enteran.

Se modifican con \`CREATE OR REPLACE VIEW\` y se borran con \`DROP VIEW\`.
`,
        '🪟',
      ),
      sqlDemo(
        'Crear y usar una vista',
        'tienda',
        [
          ['CREATE VIEW pedidos_detalle AS SELECT p.id, c.nombre AS cliente, p.fecha, p.estado FROM pedidos p JOIN clientes c ON c.id = p.cliente_id;', 'Un JOIN complicado queda detrás de un nombre'],
          ["SELECT * FROM pedidos_detalle WHERE estado = 'pendiente' ORDER BY id;", 'Se usa como una tabla más, con su WHERE y todo'],
          ["UPDATE pedidos SET estado = 'enviado' WHERE id = 12;", 'Cambiamos un dato en la tabla de verdad…'],
          ["SELECT * FROM pedidos_detalle WHERE estado = 'pendiente' ORDER BY id;", '…y la vista lo refleja al instante: no guarda copias'],
          sqlErr("INSERT INTO pedidos_detalle VALUES (99, 'Alguien', '2025-01-01', 'pendiente');", 'Una vista con JOIN no se puede modificar directamente: se modifica la tabla de origen'),
          ['DROP VIEW pedidos_detalle;', 'Borrar la vista no toca los datos'],
        ],
      ),
      sqlDemo(
        'Una vista para proteger datos',
        'banco',
        [
          ['CREATE VIEW cuentas_publicas AS SELECT id, titular FROM cuentas;', 'La vista omite la columna saldo'],
          ['SELECT * FROM cuentas_publicas ORDER BY id;', 'Quien solo tenga permiso sobre la vista conoce a los titulares pero no sus saldos'],
          ['CREATE VIEW resumen_cuentas AS SELECT c.titular, COUNT(m.id) AS movimientos, COALESCE(SUM(m.importe), 0) AS neto FROM cuentas c LEFT JOIN movimientos m ON m.cuenta_id = c.id GROUP BY c.titular;', 'Otra vista: un informe con JOIN y GROUP BY'],
          ['SELECT * FROM resumen_cuentas ORDER BY titular;', 'Y se consulta con un simple SELECT'],
        ],
      ),
      learn(
        'Vistas materializadas (concepto)',
        `
Como la vista recalcula su consulta cada vez, si es **muy pesada** (agrega millones de filas) puede ser lenta. PostgreSQL y otros motores ofrecen las **vistas materializadas**: \`CREATE MATERIALIZED VIEW\`. Esas **sí guardan** el resultado en disco y lo consultan al instante, pero quedan **desfasadas** hasta que las refrescas (\`REFRESH MATERIALIZED VIEW nombre\`).

| | Vista normal | Vista materializada |
| --- | --- | --- |
| Guarda datos | No | Sí |
| Datos actuales | Siempre | Hasta el último refresco |
| Velocidad | Como la consulta original | Como una tabla |

(Este simulador solo incluye las vistas normales.)
`,
        '📸',
      ),
      mc('¿Una vista normal guarda copia de los datos?', ['Sí, una copia que se actualiza cada hora', 'Sí, una copia permanente', 'No, ejecuta su consulta cada vez que se usa', 'Solo si tiene más de 100 filas'], 2, 'La vista es una consulta guardada. Siempre muestra los datos actuales porque no hay copia que se quede desfasada.'),
      tf('Si borras una vista con `DROP VIEW` se pierden los datos de las tablas de las que sale.', false, 'La vista solo es una definición. Borrarla no toca los datos de las tablas originales.'),
      mc('Quieres dejar que otro equipo lea las cuentas pero sin ver los saldos. ¿Qué haces?', ['Darles acceso total a la tabla', 'Crear una vista con las columnas permitidas y darles acceso solo a ella', 'Copiar la tabla a mano cada día', 'Cambiar el nombre de la columna'], 1, 'Una vista que omite las columnas sensibles es una forma sencilla de controlar qué se puede ver.'),
      sqlCode('Crea una vista `ricos` con el `titular` y el `saldo` de las cuentas con saldo **mayor o igual a 1000** y consúltala (`SELECT * FROM ricos ORDER BY saldo DESC`).', {
        setup: 'banco',
        check: ordered({ names: true, uses: ['CREATE VIEW'] }),
        solution: 'CREATE VIEW ricos AS SELECT titular, saldo FROM cuentas WHERE saldo >= 1000; SELECT * FROM ricos ORDER BY saldo DESC;',
        hint: 'CREATE VIEW ricos AS SELECT …; y luego el SELECT sobre la vista',
        why: 'Después de crearla se usa como cualquier tabla.',
      }),
      sqlPractice({
        goal: 'Vista de pedidos con importe',
        prompt: 'Contabilidad quiere consultar el **total de cada pedido** sin escribir el JOIN cada vez.\n\nCrea la vista **`totales_pedido`** con `pedido_id` y `total` (suma de `cantidad * precio` de sus líneas de `detalle_pedido`, redondeada a 2 decimales) y consúltala para ver los **tres totales más altos**.\n\n**Muestra `pedido_id` y `total` ordenados de mayor a menor.**',
        setup: 'tienda',
        check: ordered({ names: true, uses: ['CREATE VIEW'] }),
        solution: 'CREATE VIEW totales_pedido AS SELECT d.pedido_id, ROUND(SUM(d.cantidad * p.precio), 2) AS total FROM detalle_pedido d JOIN productos p ON p.id = d.producto_id GROUP BY d.pedido_id; SELECT pedido_id, total FROM totales_pedido ORDER BY total DESC, pedido_id LIMIT 3;',
        hints: ['La vista une `detalle_pedido` con `productos` y agrupa por `pedido_id`.', 'Después, un `SELECT … FROM totales_pedido ORDER BY total DESC LIMIT 3;`'],
        explain: 'La lógica del total queda escrita una vez en la vista; los informes solo hacen `SELECT … FROM totales_pedido`. Si mañana cambia el cálculo, se cambia en un solo sitio.',
        commands: ['CREATE VIEW'],
      }),
      sqlPractice({
        goal: 'La vista siempre está al día',
        prompt: 'Crea una vista **`pendientes`** con los pedidos de estado `pendiente` (todas las columnas de `pedidos`). Después marca el pedido **12** como `enviado` y muestra cuántos pedidos pendientes hay ahora a través de la vista.\n\n**Muestra `total`.**',
        setup: 'tienda',
        check: both(['pedidos'], { names: true, uses: ['CREATE VIEW'] }),
        solution: "CREATE VIEW pendientes AS SELECT * FROM pedidos WHERE estado = 'pendiente'; UPDATE pedidos SET estado = 'enviado' WHERE id = 12; SELECT COUNT(*) AS total FROM pendientes;",
        hints: ['Crea la vista antes del `UPDATE`.', 'La vista no guarda copia: contará los pendientes actuales (4).'],
        explain: 'Como la vista consulta la tabla en cada uso, el `UPDATE` se refleja sin hacer nada más: había 5 pendientes y ahora quedan 4.',
        commands: ['CREATE VIEW'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: la transferencia blindada',
    prompt:
      'Clara (id **3**) transfiere **800 €** a Beto (id **2**). Hazlo como un profesional, **todo en una sola ejecución**:\n\n1. Abre una transacción.\n2. Lee y **bloquea** la cuenta de Clara con `SELECT … FOR UPDATE`.\n3. Resta 800 a Clara y suma 800 a Beto.\n4. Registra los dos movimientos en `movimientos` (fecha `\'2025-06-15\'`): id **6** para Clara (importe **-800**, concepto `\'Transferencia enviada\'`) e id **7** para Beto (importe **800**, concepto `\'Transferencia recibida\'`).\n5. Confirma la transacción.',
    setup: 'banco',
    check: state(['cuentas', 'movimientos'], { closed: true, uses: ['BEGIN', 'FOR UPDATE', 'COMMIT'] }),
    solution:
      "BEGIN; SELECT saldo FROM cuentas WHERE id = 3 FOR UPDATE; UPDATE cuentas SET saldo = saldo - 800 WHERE id = 3; UPDATE cuentas SET saldo = saldo + 800 WHERE id = 2; INSERT INTO movimientos (id, cuenta_id, importe, concepto, fecha) VALUES (6, 3, -800, 'Transferencia enviada', '2025-06-15'), (7, 2, 800, 'Transferencia recibida', '2025-06-15'); COMMIT;",
    hints: ['Orden: `BEGIN;` → `SELECT … FOR UPDATE;` → dos `UPDATE` → `INSERT` de los dos movimientos → `COMMIT;`.', 'Las columnas de `movimientos` son `(id, cuenta_id, importe, concepto, fecha)`.'],
    explain: 'Bloqueo para que nadie interfiera, dos modificaciones y dos registros de auditoría: todo dentro de una transacción. O se aplica entero o no se aplica nada, y el `CHECK` protege los saldos. Así funciona un banco de verdad. ¡Zona completada!',
    commands: ['BEGIN / COMMIT / ROLLBACK', 'Concurrencia y aislamiento', 'SAVEPOINT'],
  },
});
