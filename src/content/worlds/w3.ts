import { all, content, exists, not, out, outEq, outRe, ran, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd, world } from '../build';

const FRUTAS = 'manzana\npera\nuva\nmanzana\nbanana\nuva\nmanzana\npera\nkiwi\n';
const APPLOG =
  '2024-03-01 10:00:01 INFO Servidor iniciado\n2024-03-01 10:00:05 WARN Disco al 85%\n2024-03-01 10:01:12 ERROR No se pudo conectar a la base de datos\n2024-03-01 10:01:13 INFO Reintentando conexión\n2024-03-01 10:01:20 ERROR Tiempo de espera agotado\n2024-03-01 10:02:00 INFO Conexión establecida\n2024-03-01 10:05:44 error Archivo temporal no encontrado\n';
const ACCESOS =
  '10.0.0.5 /index.html\n10.0.0.9 /login\n10.0.0.5 /about\n10.0.0.7 /index.html\n10.0.0.5 /login\n10.0.0.9 /index.html\n10.0.0.5 /contact\n10.0.0.7 /login\n';
const NOTAS = 'ana,8\nluis,5\nmaría,9\npedro,6\nelena,10\n';

export const w3 = world({
  id: 'w3',
  index: 3,
  title: 'Texto y tuberías',
  subtitle: 'Redirige, encadena y filtra como un pro',
  emoji: '🔧',
  color: '#FBBF24',
  level: 'basico',
  intro:
    'La filosofía de Unix: programas pequeños que hacen una sola cosa y se conectan entre sí. Esta zona te enseña a unirlos con redirecciones y tuberías. Aquí es donde la terminal se vuelve mágica.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w3-1', { title: 'Redirecciones: > y >>', summary: 'Guarda la salida de un comando en un archivo', emoji: '📤', commands: ['echo', 'cat', 'printf'], minutes: 8 }, [
      learn('Tres canales de comunicación', `
Todo comando tiene tres canales abiertos:

- **stdin** (0): por donde **entra** información (el teclado, por defecto).
- **stdout** (1): por donde **sale** el resultado normal (la pantalla).
- **stderr** (2): por donde salen los **errores** (también la pantalla, pero es otro canal).

La shell te deja **redirigir** esos canales hacia archivos.
`, '📤'),
      illus('streams', 'Los tres canales', 'Un comando lee de stdin y escribe en stdout y stderr.'),
      learn('Los operadores', `
| Operador | Efecto |
|---|---|
| \`cmd > f\` | Guarda stdout en \`f\` (**sobrescribe**) |
| \`cmd >> f\` | **Añade** stdout al final de \`f\` |
| \`cmd 2> f\` | Guarda solo los **errores** en \`f\` |
| \`cmd < f\` | Toma la entrada desde \`f\` |
| \`cmd > /dev/null\` | Tira la salida (agujero negro) |

> OJO: \`>\` **destruye** el contenido anterior del archivo sin preguntar. Si quieres conservar lo que hay, usa \`>>\`.
`),
      demo('Probando redirecciones', [
        ['echo "primera línea" > nota.txt', 'Crea (o sobrescribe) nota.txt'],
        ['cat nota.txt', 'Contiene la línea'],
        ['echo "segunda línea" >> nota.txt', '>> añade al final'],
        ['cat nota.txt', 'Ahora tiene dos'],
        ['echo "empezar de nuevo" > nota.txt', '> borra lo anterior'],
        ['cat nota.txt', 'Solo queda la última'],
        ['ls /no-existe 2> errores.txt', 'El error va al archivo, no a la pantalla'],
        ['cat errores.txt', 'Aquí está el mensaje'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué diferencia hay entre `>` y `>>`?', ['Ninguna', '`>` sobrescribe y `>>` añade al final', '`>` añade y `>>` sobrescribe', '`>>` solo funciona con carpetas'], 1, '`>` vacía el archivo antes de escribir; `>>` conserva lo que había y añade al final.'),
      tf('`ls /carpeta-que-no-existe > salida.txt` guarda el mensaje de error en salida.txt.', false, 'El mensaje de error sale por **stderr**, y `>` solo redirige stdout. Para capturarlo necesitas `2>`.'),
      practice({
        goal: 'Guarda un saludo en un archivo',
        prompt: 'Escribe el texto **Hola Linux** dentro de un archivo nuevo llamado **saludo.txt** usando `echo` y una redirección.',
        check: all(content('/home/alumno/saludo.txt', { equals: 'Hola Linux' }), ran('echo')),
        solution: ['echo "Hola Linux" > saludo.txt'],
        hints: ['`echo` imprime; `>` desvía la salida a un archivo.', '`echo "Hola Linux" > saludo.txt`'],
        explain: 'Redirigir con `>` convierte la salida de cualquier comando en un archivo. Es la forma más rápida de crear texto sin editor.',
        par: 1,
        commands: ['echo'],
      }),
      practice({
        goal: 'Añade sin borrar',
        prompt: 'El archivo `lista.txt` ya tiene dos frutas. **Añade** la línea `pera` al final sin perder las anteriores.',
        setup: { files: { '/home/alumno/lista.txt': 'manzana\nuva\n' } },
        check: content('/home/alumno/lista.txt', { equals: 'manzana\nuva\npera' }),
        solution: ['echo pera >> lista.txt'],
        hints: ['Si usas `>` perderás las dos frutas.', '`echo pera >> lista.txt`'],
        explain: '`>>` (append) añade al final. Es ideal para registros y listas que crecen.',
        par: 1,
        commands: ['echo'],
      }),
      practice({
        goal: 'Guarda el listado de /etc',
        prompt: 'Guarda el listado de la carpeta **/etc** en un archivo llamado **etc.txt** (en tu carpeta personal).',
        check: all(exists('/home/alumno/etc.txt', 'file'), content('/home/alumno/etc.txt', { includes: 'passwd' })),
        solution: ['ls /etc > etc.txt'],
        hints: ['Redirige la salida de `ls`.', '`ls /etc > etc.txt`'],
        explain: 'Cualquier comando que imprima algo puede volcar su salida a un archivo con `>`.',
        par: 1,
        commands: ['ls'],
      }),
      practice({
        goal: 'Captura solo los errores',
        prompt: 'Ejecuta `ls /no-existe` pero guarda **el mensaje de error** en **errores.txt**.',
        check: all(content('/home/alumno/errores.txt', { includes: 'No such file' }), ran('2>')),
        solution: ['ls /no-existe 2> errores.txt'],
        hints: ['El canal de errores es el número 2.', '`ls /no-existe 2> errores.txt`'],
        explain: '`2>` redirige stderr. Separar errores de resultados te permite revisar los fallos sin ensuciar la salida.',
        par: 1,
        commands: ['ls'],
      }),
      fill('Completa para **añadir** al final de log.txt', 'echo fin ___ log.txt', ['>>', '>', '<', '|'], ['>>'], '`>>` añade; `>` sobrescribe.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w3-2', { title: 'Tuberías: |', summary: 'Conecta la salida de un comando con la entrada de otro', emoji: '🚰', commands: ['wc', 'head', 'tail', 'tee'], minutes: 8 }, [
      learn('La tubería une comandos', `
El símbolo **|** (_pipe_) conecta la **salida** de un comando con la **entrada** del siguiente:

\`\`\`
comando1 | comando2 | comando3
\`\`\`

Cada comando hace una cosa sencilla; juntos resuelven problemas enormes.

\`\`\`
$ ls /etc | wc -l        # ¿cuántos elementos hay en /etc?
$ cat poema.txt | head -n 3
\`\`\`

> CLAVE: Los datos fluyen de **izquierda a derecha**. No se guardan en ningún archivo intermedio: pasan directamente de un programa al siguiente.
`, '🚰'),
      illus('pipe-flow', 'Datos que fluyen', 'Mira cómo la salida de un comando alimenta al siguiente.'),
      demo('Primeras tuberías', [
        ['ls /etc | wc -l', 'Cuenta elementos de /etc'],
        ['ls /etc | head -n 3', 'Solo las tres primeras entradas'],
        ['ls /etc | tail -n 2', 'Y las dos últimas'],
        ['ls -l /etc | head -n 5', 'Funciona con cualquier salida'],
        ['cat frutas.txt | sort | uniq', 'Tres comandos encadenados'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/frutas.txt': FRUTAS } }),
      learn('tee: bifurcar el flujo', `
\`tee\` es como una "T" de fontanería: deja pasar los datos **y** los guarda en un archivo a la vez.

\`\`\`
$ ls /etc | tee lista.txt | wc -l
\`\`\`

Guarda el listado en \`lista.txt\` y además cuenta las líneas.
`),
      mc('En `ls | wc -l`, ¿de dónde lee `wc` su entrada?', ['Del teclado', 'De un archivo llamado ls', 'De la salida de `ls`', 'De /dev/null'], 2, 'La tubería conecta la stdout de `ls` con la stdin de `wc`.'),
      predict('¿Qué imprime `echo uno dos tres | wc -w`?', 'echo uno dos tres | wc -w', ['1', '4', '3 uno'], '`wc -w` cuenta palabras. `echo` emite tres palabras.'),
      practice({
        goal: 'Cuenta los archivos de /etc',
        prompt: 'Averigua **cuántos elementos** hay en **/etc** usando `ls` y `wc -l` unidos por una tubería.',
        check: all(ran('ls .*/etc.*\\|\\s*wc\\s+-l'), outRe('^\\d+$')),
        solution: ['ls /etc | wc -l'],
        hints: ['`ls` lista y `wc -l` cuenta líneas.', '`ls /etc | wc -l`'],
        explain: 'Esta combinación (`ls | wc -l`) es de las más usadas: "¿cuántos archivos hay?".',
        par: 1,
        commands: ['ls', 'wc'],
      }),
      practice({
        goal: 'Las 3 primeras frutas ordenadas',
        prompt: 'Ordena alfabéticamente `frutas.txt` y muestra solo las **tres primeras** líneas, con **una sola línea de comando**.',
        setup: { files: { '/home/alumno/frutas.txt': FRUTAS } },
        check: all(ran('sort.*\\|.*head'), outEq('banana\nkiwi\nmanzana')),
        solution: ['sort frutas.txt | head -n 3'],
        hints: ['`sort` ordena y `head` recorta.', '`sort frutas.txt | head -n 3`'],
        explain: 'Primero se ordena todo y luego `head` se queda con el principio. Cada comando hace una cosa.',
        par: 1,
        commands: ['sort', 'head'],
      }),
      practice({
        goal: 'Guarda y cuenta a la vez',
        prompt: 'Lista `/etc`, **guarda** el resultado en `lista.txt` con `tee` **y** cuenta las líneas con `wc -l`.',
        check: all(exists('/home/alumno/lista.txt', 'file'), used('tee'), ran('\\|.*wc')),
        solution: ['ls /etc | tee lista.txt | wc -l'],
        hints: ['`tee archivo` copia el flujo a un archivo y lo deja seguir.', '`ls /etc | tee lista.txt | wc -l`'],
        explain: '`tee` permite guardar un resultado intermedio sin romper la cadena de tuberías.',
        par: 1,
        commands: ['tee'],
      }),
      order('Ordena: cuenta las líneas de la salida de ls', ['ls', '|', 'wc', '-l'], 'ls | wc -l', 'La salida de `ls` entra por la tubería en `wc -l`.'),
      typeCmd('Escribe el comando para ver las **5 primeras** líneas de la salida de `ls -l /etc`', ['ls -l /etc | head -n 5', 'ls -l /etc | head -5'], 'Cualquier comando puede alimentar a `head` con una tubería.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w3-3', { title: 'Filtros: sort, uniq, cut, tr', summary: 'Ordena, elimina duplicados y extrae columnas', emoji: '🧪', commands: ['sort', 'uniq', 'cut', 'tr', 'wc'], minutes: 9 }, [
      learn('Pequeñas herramientas, gran poder', `
Estos comandos leen texto de stdin (o de un archivo) y lo **transforman**. Son los ladrillos de las tuberías:

| Comando | Para qué sirve |
|---|---|
| \`sort\` | Ordena líneas (\`-n\` numérico, \`-r\` inverso, \`-u\` sin repetidos) |
| \`uniq\` | Quita repetidos **consecutivos** (\`-c\` los cuenta) |
| \`cut\` | Extrae columnas (\`-d\` separador, \`-f\` campo) |
| \`tr\` | Cambia o borra caracteres |
| \`wc\` | Cuenta líneas, palabras, bytes |

> OJO: \`uniq\` solo elimina repetidos **vecinos**. Por eso casi siempre va precedido de \`sort\`: \`sort | uniq\`.
`, '🧪'),
      demo('Cada filtro a su turno', [
        ['sort frutas.txt', 'Orden alfabético'],
        ['sort -u frutas.txt', 'Ordena y quita repetidos'],
        ['sort frutas.txt | uniq -c', 'Cuenta cuántas veces sale cada una'],
        ['cut -d, -f1 notas.csv', 'Campo 1 con separador coma (los nombres)'],
        ['sort -t, -k2 -n notas.csv', 'Ordena por la 2.ª columna, numéricamente'],
        ['echo "hola mundo" | tr a-z A-Z', 'tr convierte minúsculas en mayúsculas'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/frutas.txt': FRUTAS, '/home/alumno/notas.csv': NOTAS } }),
      learn('Ordenar números: -n', `
Por defecto \`sort\` ordena **como texto**: "10" va antes que "9" porque "1" < "9". Con \`-n\` ordena **como números**.

\`\`\`
$ printf "10\\n9\\n100\\n" | sort      →  10  100  9
$ printf "10\\n9\\n100\\n" | sort -n   →  9  10  100
\`\`\`

> TIP: Combínalo con \`-r\` para el orden inverso: \`sort -rn\` deja los números más altos arriba.
`),
      mc('¿Por qué casi siempre se usa `sort` antes de `uniq`?', ['Porque uniq no acepta archivos', 'Porque uniq solo elimina repetidos consecutivos', 'Porque sort es más rápido', 'Porque uniq necesita mayúsculas'], 1, '`uniq` compara cada línea con la anterior. Si los repetidos no están juntos, no los detecta; `sort` los agrupa.'),
      predict('¿Qué muestra `printf "10\\n9\\n100\\n" | sort -n | head -n 1`?', 'printf "10\\n9\\n100\\n" | sort -n | head -n 1', ['10', '100', '1'], 'Con `-n` el menor es 9; `head -n 1` se queda con la primera línea.'),
      practice({
        goal: 'Lista sin repetidos',
        prompt: 'Muestra las frutas de `frutas.txt` **ordenadas y sin repetir** (cada una una sola vez).',
        setup: { files: { '/home/alumno/frutas.txt': FRUTAS } },
        check: all(outEq('banana\nkiwi\nmanzana\npera\nuva')),
        solution: ['sort frutas.txt | uniq'],
        hints: ['Ordena primero, luego quita duplicados.', '`sort frutas.txt | uniq`  (o `sort -u frutas.txt`)'],
        explain: '`sort | uniq` y `sort -u` son equivalentes: quedan solo los valores distintos.',
        par: 1,
        commands: ['sort', 'uniq'],
      }),
      practice({
        goal: 'Solo los nombres',
        prompt: '`notas.csv` tiene `nombre,nota`. Muestra **solo la primera columna** (los nombres).',
        setup: { files: { '/home/alumno/notas.csv': NOTAS } },
        check: all(used('cut'), outEq('ana\nluis\nmaría\npedro\nelena')),
        solution: ['cut -d, -f1 notas.csv'],
        hints: ['`cut` necesita saber el separador (-d) y qué campo (-f).', '`cut -d, -f1 notas.csv`'],
        explain: '`cut -d, -f1` = "separa por comas y dame el campo 1". Ideal para CSV y archivos con columnas.',
        par: 1,
        commands: ['cut'],
      }),
      practice({
        goal: 'La nota más alta',
        prompt: 'Muestra la **línea con la nota más alta** de `notas.csv` (debe aparecer `elena,10`). Pista: ordena por la 2.ª columna, numéricamente y de mayor a menor, y quédate con la primera.',
        setup: { files: { '/home/alumno/notas.csv': NOTAS } },
        check: all(ran('sort'), ran('head|tail'), outEq('elena,10')),
        solution: ['sort -t, -k2 -rn notas.csv | head -n 1'],
        hints: ['`sort -t,` define la coma como separador y `-k2` elige la columna 2.', '`sort -t, -k2 -rn notas.csv | head -n 1`'],
        explain: 'Ordenar + `head` = ranking. Cambia `head` por `tail` o quita `-r` para obtener la nota más baja.',
        par: 1,
        commands: ['sort', 'head'],
      }),
      practice({
        goal: 'Todo en mayúsculas',
        prompt: 'Imprime el texto **hola dojo** convertido a **MAYÚSCULAS** usando `echo` y `tr`.',
        check: all(used('tr'), outEq('HOLA DOJO')),
        solution: ['echo "hola dojo" | tr a-z A-Z'],
        hints: ['`tr` traduce un conjunto de caracteres por otro.', '`echo "hola dojo" | tr a-z A-Z`'],
        explain: '`tr a-z A-Z` mapea cada minúscula a su mayúscula. También `tr -d` borra caracteres.',
        par: 1,
        commands: ['tr'],
      }),
      match('Une el filtro con su función', [['sort', 'Ordenar líneas'], ['uniq', 'Quitar repetidos vecinos'], ['cut', 'Extraer columnas'], ['tr', 'Cambiar caracteres'], ['wc', 'Contar']], 'Cada uno hace una sola cosa. Combinados, resuelven casi todo.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w3-4', { title: 'grep: buscar en texto', summary: 'Filtra líneas que coinciden con un patrón', emoji: '🔍', commands: ['grep'], minutes: 8 }, [
      learn('El buscador de la terminal', `
\`grep\` imprime **las líneas que contienen un patrón**. Es probablemente el comando que más usarás con los registros.

\`\`\`
grep PATRÓN archivo
comando | grep PATRÓN
\`\`\`

Opciones imprescindibles:

| Opción | Efecto |
|---|---|
| \`-i\` | Ignora mayúsculas/minúsculas |
| \`-n\` | Muestra el número de línea |
| \`-v\` | **Invierte**: líneas que NO coinciden |
| \`-c\` | Solo **cuenta** las líneas que coinciden |
| \`-r\` | Busca recursivamente en carpetas |

> TIP: Si el patrón tiene espacios, enciérralo entre comillas: \`grep "no encontrado" app.log\`.
`, '🔍'),
      illus('grep-scan', 'grep recorre línea a línea', 'Solo pasan las líneas que contienen el patrón.'),
      demo('Cazando líneas', [
        ['grep ERROR app.log', 'Líneas con ERROR (distingue mayúsculas)'],
        ['grep -i error app.log', '-i incluye también "error"'],
        ['grep -n WARN app.log', '-n numera las líneas'],
        ['grep -c INFO app.log', '-c solo cuenta'],
        ['grep -v INFO app.log', '-v: todo menos INFO'],
        ['cat app.log | grep ERROR | wc -l', 'grep dentro de una tubería'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/app.log': APPLOG } }),
      mc('¿Qué hace `grep -v INFO app.log`?', ['Muestra solo las líneas con INFO', 'Muestra las líneas que NO contienen INFO', 'Cuenta las líneas con INFO', 'Borra las líneas con INFO'], 1, '`-v` invierte la selección: _in**v**ert_.'),
      predict('¿Cuántas líneas con `ERROR` (exacto) tiene app.log?  →  `grep -c ERROR app.log`', 'grep -c ERROR app.log', ['3', '7', '1'], 'Hay dos líneas con `ERROR` en mayúsculas; la de `error` en minúscula no cuenta sin `-i`.', { cwd: '/home/alumno', files: { '/home/alumno/app.log': APPLOG } }),
      practice({
        goal: 'Encuentra los errores',
        prompt: 'Muestra solo las líneas de `app.log` que contienen **ERROR** (en mayúsculas).',
        setup: { files: { '/home/alumno/app.log': APPLOG } },
        check: all(used('grep'), out('No se pudo conectar'), out('Tiempo de espera'), not(out('Servidor iniciado'))),
        solution: ['grep ERROR app.log'],
        hints: ['`grep` + patrón + archivo.', '`grep ERROR app.log`'],
        explain: 'Con grep reduces un registro de miles de líneas a las pocas que te importan.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'Ignora las mayúsculas',
        prompt: 'Muestra las líneas que contengan "error" **sin importar las mayúsculas** (debes ver 3 líneas).',
        setup: { files: { '/home/alumno/app.log': APPLOG } },
        check: all(used('grep', ['-i']), out('Archivo temporal'), out('Tiempo de espera')),
        solution: ['grep -i error app.log'],
        hints: ['Hay una opción para "ignorar mayúsculas" (_ignore case_).', '`grep -i error app.log`'],
        explain: '`-i` es de las opciones más útiles: los logs mezclan `ERROR`, `Error` y `error`.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'Todo excepto INFO',
        prompt: 'Muestra todas las líneas de `app.log` **que no sean de nivel INFO**.',
        setup: { files: { '/home/alumno/app.log': APPLOG } },
        check: all(used('grep', ['-v']), out('WARN'), not(out('INFO'))),
        solution: ['grep -v INFO app.log'],
        hints: ['Necesitas la opción que invierte la coincidencia.', '`grep -v INFO app.log`'],
        explain: '`-v` es ideal para ocultar ruido: "enséñame todo menos lo que ya sé que es normal".',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'Pipeline con grep',
        prompt: 'Cuenta cuántos archivos de `/etc` contienen **"conf"** en su nombre: lista `/etc`, filtra con `grep` y cuenta con `wc -l`.',
        check: all(ran('ls .*/etc.*\\|\\s*grep.*conf.*\\|\\s*wc'), outRe('^\\d+$')),
        solution: ['ls /etc | grep conf | wc -l'],
        hints: ['Tres comandos encadenados con dos tuberías.', '`ls /etc | grep conf | wc -l`'],
        explain: 'Listar → filtrar → contar. Este patrón (fuente | filtro | contador) resuelve la mitad de las tareas diarias.',
        par: 1,
        commands: ['grep', 'wc'],
      }),
      typeCmd('Escribe el comando que busca la palabra **linux** en `notas.txt` ignorando mayúsculas', ['grep -i linux notas.txt'], '`grep -i` ignora mayúsculas y minúsculas.'),
      multi('¿Cuáles de estas opciones de grep son correctas?', ['-i ignora mayúsculas', '-n numera líneas', '-c borra las líneas', '-v invierte'], [0, 1, 3], '`-c` solo **cuenta** líneas que coinciden; grep nunca modifica el archivo.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w3-5', { title: 'Pipelines reales', summary: 'Combina todo para analizar datos', emoji: '🧬', commands: ['sort', 'uniq', 'cut', 'head'], minutes: 9 }, [
      learn('La receta más famosa de la terminal', `
Contar cuántas veces aparece cada valor y ordenar de más a menos frecuente:

\`\`\`
… | sort | uniq -c | sort -rn | head
\`\`\`

1. \`sort\` agrupa los valores iguales.
2. \`uniq -c\` los cuenta (añade el contador delante).
3. \`sort -rn\` ordena por ese contador, de mayor a menor.
4. \`head\` se queda con los primeros (el "top").

Esto sirve para: IPs más activas, palabras más repetidas, errores más comunes…

> CLAVE: Construye los pipelines **poco a poco**: ejecuta el primer comando, mira la salida, añade el siguiente. Así detectas dónde falla.
`, '🧬'),
      demo('Construyéndolo paso a paso', [
        ['cut -d" " -f1 accesos.log', 'Paso 1: solo la columna de IPs'],
        ['cut -d" " -f1 accesos.log | sort', 'Paso 2: agrúpalas'],
        ['cut -d" " -f1 accesos.log | sort | uniq -c', 'Paso 3: cuéntalas'],
        ['cut -d" " -f1 accesos.log | sort | uniq -c | sort -rn', 'Paso 4: ordena por frecuencia'],
        ['cut -d" " -f1 accesos.log | sort | uniq -c | sort -rn | head -n 1', 'Paso 5: la más activa'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/accesos.log': ACCESOS } }),
      mc('En `sort | uniq -c | sort -rn`, ¿para qué sirve el **segundo** sort?', ['Para quitar duplicados', 'Para ordenar por el contador de mayor a menor', 'Para ordenar alfabéticamente', 'No hace nada'], 1, 'El primer `sort` agrupa los repetidos para `uniq`; el segundo (`-rn`) ordena por el número de apariciones.'),
      order('Ordena las piezas del pipeline de frecuencias', ['sort', '|', 'uniq', '-c', '|', 'sort', '-rn'], 'sort | uniq -c | sort -rn', 'Agrupar → contar → ordenar por contador.', ['sort | uniq -c | sort -nr']),
      practice({
        goal: '¿Qué fruta es la más repetida?',
        prompt: 'Averigua qué fruta aparece **más veces** en `frutas.txt`. Debe mostrarse **solo una línea** con su contador (ej. `3 manzana`).',
        setup: { files: { '/home/alumno/frutas.txt': FRUTAS } },
        check: all(ran('uniq\\s+-c'), outRe('^\\s*3 manzana$')),
        solution: ['sort frutas.txt | uniq -c | sort -rn | head -n 1'],
        hints: ['Receta: `sort | uniq -c | sort -rn | head`.', '`sort frutas.txt | uniq -c | sort -rn | head -n 1`'],
        explain: 'El pipeline de frecuencia en acción: manzana aparece 3 veces. Cámbiale `head -n 1` por `head -n 3` para un top 3.',
        par: 1,
        commands: ['sort', 'uniq', 'head'],
      }),
      practice({
        goal: 'La IP más activa',
        prompt: 'En `accesos.log` cada línea es `IP ruta`. Extrae la **IP** de cada línea y muestra **la más frecuente con su contador**.',
        setup: { files: { '/home/alumno/accesos.log': ACCESOS } },
        check: all(ran('cut'), ran('uniq'), outRe('^\\s*4 10\\.0\\.0\\.5$')),
        solution: ['cut -d" " -f1 accesos.log | sort | uniq -c | sort -rn | head -n 1'],
        hints: ['Primero extrae la columna con `cut -d" " -f1`.', 'Después aplica la receta de frecuencias.'],
        explain: 'Esto es análisis de logs real: la IP 10.0.0.5 hizo 4 peticiones. Así se detectan visitantes sospechosos.',
        par: 1,
        commands: ['cut', 'sort', 'uniq'],
      }),
      practice({
        goal: 'Cuenta las rutas distintas',
        prompt: 'Cuenta **cuántas rutas distintas** aparecen en la segunda columna de `accesos.log` (debe salir 4).',
        setup: { files: { '/home/alumno/accesos.log': ACCESOS } },
        check: all(ran('cut'), ran('wc'), outRe('^4$')),
        solution: ['cut -d" " -f2 accesos.log | sort -u | wc -l'],
        hints: ['Extrae la columna 2, quita repetidos, cuenta líneas.', '`cut -d" " -f2 accesos.log | sort -u | wc -l`'],
        explain: '`sort -u | wc -l` es la forma rápida de contar valores distintos.',
        par: 1,
        commands: ['cut', 'sort', 'wc'],
      }),
      tf('El orden correcto para contar repetidos es `uniq -c | sort`.', false, '`uniq` solo detecta repetidos **consecutivos**, así que hay que ordenar **antes**: `sort | uniq -c`.'),
      fill('Completa para ver el top 3', 'sort | uniq -c | sort -rn | ___ -n 3', ['head', 'tail', 'wc', 'cut'], ['head'], '`head -n 3` toma las tres primeras líneas: las más frecuentes.'),
    ]),
  ],
  boss: {
    goal: 'Misión: informe de actividad',
    prompt:
      '**Misión del dojo** 🥋\n\nEl servidor guarda las visitas en `accesos.log` (formato `IP ruta`). Genera **top.txt** con la **IP más activa y su número de peticiones** usando un único pipeline y una redirección.',
    setup: { cwd: '/home/alumno', files: { '/home/alumno/accesos.log': ACCESOS } },
    check: content('/home/alumno/top.txt', { matches: '^\\s*4 10\\.0\\.0\\.5\\s*$' }),
    solution: ['cut -d" " -f1 accesos.log | sort | uniq -c | sort -rn | head -n 1 > top.txt'],
    hints: ['Extrae IPs con `cut -d" " -f1`.', 'Añade `sort | uniq -c | sort -rn | head -n 1`.', 'Termina con `> top.txt`.'],
    explain: '¡Zona 3 completada! Redirecciones + tuberías + filtros: el corazón de la filosofía Unix. Siguiente: buscar archivos y dominar grep.',
    par: 1,
    commands: ['cut', 'sort', 'uniq', 'head'],
  },
});
