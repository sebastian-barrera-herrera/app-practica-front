import { all, content, fileCount, not, out, outEq, ran, used } from '@/engine/check';
import type { Files } from '@/engine/world';
import { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd, world } from '../build';

/** Proyecto de ejemplo para practicar búsquedas. */
const PROYECTO: Files = {
  '/home/alumno/proyecto/README.md': '# Proyecto\nUn proyecto de ejemplo.\n',
  '/home/alumno/proyecto/src/main.py': "import os\n# TODO: validar entrada\nprint('hola')\n",
  '/home/alumno/proyecto/src/utils.py': '# TODO: documentar\ndef suma(a, b):\n    return a + b\n# FIXME: manejar negativos\n',
  '/home/alumno/proyecto/src/test_utils.py': 'import utils\nassert utils.suma(1, 2) == 3\n',
  '/home/alumno/proyecto/docs/guia.md': '# Guía\nPendiente: TODO escribir ejemplos\n',
  '/home/alumno/proyecto/docs/Manual.MD': 'manual\n',
  '/home/alumno/proyecto/logs/app.log': { content: 'ok\nERROR algo falló\n', ago: 1 },
  '/home/alumno/proyecto/logs/vieja.log': { content: 'antiguo\n', ago: 40 },
  '/home/alumno/proyecto/tmp/cache.tmp': 'c',
  '/home/alumno/proyecto/tmp/sesion.tmp': 's',
  '/home/alumno/proyecto/data/big.dat': { content: 'x', size: 5000000 },
};

const SERVIDOR = 'ERROR disco lleno\nINFO arranque\nERROR sin red\nWARN temperatura alta\nerror en minúsculas\n';
const AGENDA =
  'Ana García   ana@correo.com    612-345-678\nLuis Pérez   luis@mail.org     655-111-222\nMarta Ruiz   marta@correo.com  600-999-000\nPedro Gil    pedro@gil.net\n';

export const w4 = world({
  id: 'w4',
  index: 4,
  title: 'Buscar y encontrar',
  subtitle: 'find, grep, regex y localizar comandos',
  emoji: '🔎',
  color: '#FB923C',
  level: 'intermedio',
  intro:
    'En un servidor puede haber millones de archivos. Un buen administrador no los recorre: los **encuentra**. Aprenderás a buscar por nombre, tamaño y fecha, a rastrear texto dentro de archivos y a usar expresiones regulares.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w4-1', { title: 'find: buscar archivos', summary: 'Por nombre, tipo, tamaño y antigüedad', emoji: '🧭', commands: ['find'], minutes: 9 }, [
      learn('find recorre carpetas por ti', `
\`find DÓNDE CRITERIOS\` recorre un árbol de carpetas y muestra lo que cumple **todos** los criterios.

\`\`\`
find proyecto -name "*.py"
\`\`\`

| Criterio | Significado |
|---|---|
| \`-name "*.txt"\` | Nombre (distingue mayúsculas) |
| \`-iname "*.txt"\` | Nombre sin distinguir mayúsculas |
| \`-type f\` / \`-type d\` | Solo **f**icheros / **d**irectorios |
| \`-size +1M\` | Más de 1 megabyte (\`-\` = menos de) |
| \`-mtime +30\` | Modificado hace **más** de 30 días |
| \`-mtime -1\` | Modificado en el **último** día |
| \`-empty\` | Vacíos |
| \`-maxdepth 1\` | No bajar más de 1 nivel |

> OJO: Pon el patrón **entre comillas** (\`"*.py"\`). Así la shell no lo expande antes y es \`find\` quien lo interpreta.
`, '🧭'),
      demo('Encuentra cosas', [
        ['find proyecto -name "*.py"', 'Todos los .py'],
        ['find proyecto -type d', 'Solo las carpetas'],
        ['find proyecto -iname "*.md"', 'Ignora mayúsculas: .md y .MD'],
        ['find proyecto -size +1M', 'Archivos de más de 1 MB'],
        ['find proyecto -type f -mtime +30', 'Archivos sin tocar hace más de 30 días'],
        ['find proyecto -maxdepth 1', 'Solo el primer nivel'],
      ], { cwd: '/home/alumno', files: PROYECTO }),
      learn('Combinar criterios', `
Varios criterios seguidos se combinan con **Y** implícito:

\`\`\`
find . -type f -name "*.log" -size +1M     # ficheros .log de más de 1 MB
find . -name "*.jpg" -o -name "*.png"      # O (-o) : jpg o png
find . -not -name "*.py"                   # NO (también: ! )
\`\`\`

> TIP: Si omites el punto de partida, GNU \`find\` usa el directorio actual. Por claridad escribe \`.\`.
`),
      mc('¿Qué encuentra `find . -type d`?', ['Archivos de texto', 'Solo directorios', 'Archivos ocultos', 'Enlaces rotos'], 1, '`-type d` filtra directorios; `-type f` archivos normales; `-type l` enlaces simbólicos.'),
      mc('`-mtime +30` significa…', ['Modificado hace menos de 30 días', 'Modificado hace más de 30 días', 'Creado exactamente hoy', 'Más de 30 MB'], 1, '`+N` = más de N días; `-N` = menos de N; `N` = exactamente N.'),
      practice({
        goal: 'Todos los scripts Python',
        prompt: 'Encuentra todos los archivos que terminan en **.py** dentro de la carpeta **proyecto**.',
        setup: { files: PROYECTO },
        check: all(used('find'), out(['main.py', 'utils.py', 'test_utils.py']), not(out('README'))),
        solution: ['find proyecto -name "*.py"'],
        hints: ['`find` + carpeta + criterio de nombre.', '`find proyecto -name "*.py"`'],
        explain: '`find` recorre todas las subcarpetas y devuelve las rutas completas de las coincidencias.',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: 'Solo carpetas',
        prompt: 'Lista **únicamente las carpetas** que hay dentro de `proyecto` (a cualquier profundidad).',
        setup: { files: PROYECTO },
        check: all(used('find'), out(['proyecto/docs', 'proyecto/src']), not(out('main.py'))),
        solution: ['find proyecto -type d'],
        hints: ['Hay un criterio para el tipo de elemento.', '`find proyecto -type d`'],
        explain: '`-type d` limita la búsqueda a directorios.',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: 'El archivo gigante',
        prompt: 'Encuentra los archivos de `proyecto` que pesan **más de 1 megabyte**.',
        setup: { files: PROYECTO },
        check: all(used('find'), outEq('proyecto/data/big.dat')),
        solution: ['find proyecto -size +1M'],
        hints: ['`-size` acepta sufijos como `k`, `M`, `G`.', '`find proyecto -size +1M`'],
        explain: '`-size +1M` = mayor que 1 MiB. Perfecto para descubrir qué ocupa el disco.',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: 'Archivos antiguos',
        prompt: 'Encuentra los **archivos** (no carpetas) de `proyecto` que **no se han modificado en los últimos 30 días**.',
        setup: { files: PROYECTO },
        check: all(used('find'), out('vieja.log'), not(out('app.log'))),
        solution: ['find proyecto -type f -mtime +30'],
        hints: ['Combina `-type f` con un criterio de tiempo.', '`find proyecto -type f -mtime +30`'],
        explain: 'Así se localizan registros viejos que se pueden archivar o borrar.',
        par: 1,
        commands: ['find'],
      }),
      match('Une el criterio con su significado', [['-name', 'Por nombre exacto/patrón'], ['-type f', 'Solo archivos'], ['-size +1M', 'Más de 1 MB'], ['-mtime -1', 'Modificado en el último día']], 'Memorízalos: son el 90 % de los usos de find.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w4-2', { title: 'Actuar sobre lo encontrado', summary: '-exec, -delete y xargs', emoji: '⚙️', commands: ['find', 'xargs'], minutes: 9 }, [
      learn('Encontrar y hacer algo', `
Encontrar es solo la mitad. Normalmente quieres **actuar** sobre los resultados. Hay tres formas:

1. **\`-delete\`** → borra lo encontrado.
2. **\`-exec comando {} \\;\`** → ejecuta un comando por cada resultado (\`{}\` es el nombre).
3. **\`| xargs comando\`** → pasa los resultados como **argumentos** de otro comando.

\`\`\`
find . -name "*.tmp" -delete
find . -name "*.py" -exec wc -l {} \\;
find . -name "*.py" | xargs grep -l import
\`\`\`

> OJO: Antes de usar \`-delete\` o \`rm\`, ejecuta el mismo \`find\` **sin** la acción para revisar qué va a tocar.
`, '⚙️'),
      demo('Acciones', [
        ['find proyecto -name "*.py" -exec wc -l {} \\;', 'wc -l por cada .py'],
        ['find proyecto -name "*.py" | xargs grep -l import', 'Qué .py importan algo'],
        ['find proyecto -name "*.tmp"', 'Primero MIRA qué se va a borrar'],
        ['find proyecto -name "*.tmp" -delete', 'Y entonces bórralo'],
        ['find proyecto -empty', 'Lo que queda vacío'],
      ], { cwd: '/home/alumno', files: PROYECTO }),
      learn('¿-exec o xargs?', `
- \`-exec cmd {} \\;\` lanza el comando **una vez por archivo** (más lento, muy seguro con nombres raros).
- \`-exec cmd {} +\` y \`xargs\` agrupan **muchos archivos en una sola llamada** (más rápido).

\`xargs\` toma la entrada estándar y la convierte en argumentos:

\`\`\`
echo "a b c" | xargs touch      # equivale a: touch a b c
\`\`\`

> NOTA: Si los nombres pueden tener espacios, usa \`find … -print0 | xargs -0 …\`.
`),
      mc('En `find . -name "*.txt" -exec cat {} \\;`, ¿qué representa `{}`?', ['Un directorio vacío', 'El archivo encontrado en cada paso', 'Un patrón de llaves', 'La carpeta actual'], 1, 'find sustituye `{}` por cada resultado y ejecuta el comando.'),
      predict('¿Qué imprime `echo uno dos tres | xargs -n 1 echo`?', 'echo uno dos tres | xargs -n 1 echo', ['uno dos tres', 'uno', 'tres dos uno'], '`-n 1` pasa **un** argumento por ejecución: `echo uno`, `echo dos`, `echo tres`.'),
      practice({
        goal: 'Limpia los temporales',
        prompt: 'Elimina **todos los archivos `.tmp`** dentro de `proyecto` usando `find` (a cualquier profundidad).',
        setup: { files: PROYECTO },
        check: all(fileCount('/home/alumno/proyecto/tmp', 0), ran('^find'), ran('-delete|-exec')),
        solution: ['find proyecto -name "*.tmp" -delete'],
        hints: ['`find` puede borrar con una acción.', '`find proyecto -name "*.tmp" -delete`'],
        explain: '`-delete` es la forma más limpia de borrar resultados de find, sin llamar a `rm`.',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: 'Cuenta líneas de cada .py',
        prompt: 'Ejecuta `wc -l` sobre **cada archivo .py** de `proyecto` usando `find -exec`.',
        setup: { files: PROYECTO },
        check: all(ran('-exec'), out(['main.py', 'utils.py', 'test_utils.py'])),
        solution: ['find proyecto -name "*.py" -exec wc -l {} \\;'],
        hints: ['`-exec` va al final y termina con `\\;`.', '`find proyecto -name "*.py" -exec wc -l {} \\;`'],
        explain: 'Con `-exec` cualquier comando se vuelve masivo: `chmod`, `grep`, `rm`, `cp`…',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: '¿Qué scripts importan módulos?',
        prompt: 'Lista **solo los nombres** de los `.py` que contienen la palabra `import`. Usa `find` + `xargs` + `grep -l`.',
        setup: { files: PROYECTO },
        check: all(ran('xargs'), outEq('proyecto/src/main.py\nproyecto/src/test_utils.py')),
        solution: ['find proyecto -name "*.py" | xargs grep -l import'],
        hints: ['`grep -l` imprime solo los nombres de archivo que coinciden.', '`find proyecto -name "*.py" | xargs grep -l import`'],
        explain: '`find | xargs grep` busca texto solo en los archivos que tú filtraste.',
        par: 1,
        commands: ['find', 'xargs', 'grep'],
      }),
      fill('Completa para borrar los .bak', 'find . -name "*.bak" ___', ['-delete', '-remove', '-rm', '-erase'], ['-delete'], '`-delete` es la acción de find para eliminar.'),
      typeCmd('Escribe `find` para localizar los archivos `.log` en la carpeta actual (usa un punto)', ['find . -name "*.log"', "find . -name '*.log'"], '`find . -name "*.log"` busca recursivamente desde `.`.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w4-3', { title: 'grep a fondo', summary: 'Búsqueda recursiva, contexto y listados', emoji: '🕵️', commands: ['grep'], minutes: 8 }, [
      learn('grep sobre carpetas enteras', `
Ya conoces \`grep patrón archivo\`. Con \`-r\` busca **dentro de todos los archivos de una carpeta**:

\`\`\`
grep -rn "TODO" proyecto/       # todas las líneas con TODO, con archivo y nº de línea
grep -rl "TODO" proyecto/       # solo los nombres de archivo
grep -rc "TODO" proyecto/       # cuántas veces en cada archivo
\`\`\`

Y para ver **alrededor** de la coincidencia:

| Opción | Muestra |
|---|---|
| \`-A 2\` | 2 líneas **después** (_after_) |
| \`-B 2\` | 2 líneas **antes** (_before_) |
| \`-C 2\` | 2 antes y 2 después (_context_) |
| \`-w\` | Solo palabras completas |
| \`-h\` | Oculta el nombre de archivo |
`, '🕵️'),
      demo('Rastreando TODOs', [
        ['grep -rn TODO proyecto', 'Recursivo con número de línea'],
        ['grep -rl TODO proyecto', 'Solo qué archivos lo contienen'],
        ['grep -A1 "def suma" proyecto/src/utils.py', 'La línea y 1 más'],
        ['grep -rn FIXME proyecto', 'Otra marca habitual'],
        ['grep -rli todo proyecto | wc -l', 'Cuántos archivos tienen TODO (ignorando mayúsculas)'],
      ], { cwd: '/home/alumno', files: PROYECTO }),
      mc('¿Qué hace `grep -rl texto carpeta/`?', ['Cuenta las coincidencias', 'Lista los archivos que contienen "texto"', 'Borra los archivos con "texto"', 'Muestra solo la primera coincidencia'], 1, '`-r` recorre la carpeta y `-l` imprime solo los nombres de los archivos con coincidencias.'),
      multi('¿Qué opciones muestran **líneas de contexto**?', ['-A', '-B', '-C', '-c'], [0, 1, 2], '`-A` (después), `-B` (antes) y `-C` (ambos lados). `-c` solo cuenta.'),
      practice({
        goal: 'Todos los TODO con su línea',
        prompt: 'Busca la palabra **TODO** en todos los archivos de `proyecto`, mostrando archivo y **número de línea** de cada coincidencia.',
        setup: { files: PROYECTO },
        check: all(used('grep'), ran('grep -.*r'), out(['guia.md:2', 'main.py:2', 'utils.py:1'])),
        solution: ['grep -rn TODO proyecto'],
        hints: ['Necesitas recursivo (`-r`) y número de línea (`-n`).', '`grep -rn TODO proyecto`'],
        explain: 'Así encuentras tareas pendientes en un proyecto entero con un solo comando.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'Solo los nombres de archivo',
        prompt: 'Muestra **solo los nombres** de los archivos de `proyecto` que contienen **TODO** (sin las líneas).',
        setup: { files: PROYECTO },
        check: all(used('grep', ['-l']), outEq('proyecto/docs/guia.md\nproyecto/src/main.py\nproyecto/src/utils.py')),
        solution: ['grep -rl TODO proyecto'],
        hints: ['Añade la opción que lista solo nombres.', '`grep -rl TODO proyecto`'],
        explain: '`-l` (list) es ideal para alimentar a otro comando: `grep -rl TODO . | xargs …`.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'La línea de después',
        prompt: 'En `proyecto/src/utils.py` busca `def suma` y muestra **también la línea siguiente** (debe verse `return a + b`).',
        setup: { files: PROYECTO },
        check: all(ran('grep.*-A'), out('return a + b')),
        solution: ['grep -A1 "def suma" proyecto/src/utils.py'],
        hints: ['La opción `-A N` muestra N líneas posteriores.', '`grep -A 1 "def suma" proyecto/src/utils.py`'],
        explain: 'El contexto ayuda a entender una coincidencia: en logs, la línea siguiente suele explicar el error.',
        par: 1,
        commands: ['grep'],
      }),
      order('Ordena: busca ERROR recursivamente en logs/ con nº de línea', ['grep', '-rn', 'ERROR', 'logs/'], 'grep -rn ERROR logs/', 'Comando, opciones, patrón y finalmente dónde buscar.'),
      tf('`grep -r` modifica los archivos donde encuentra coincidencias.', false, 'grep solo **lee**. Para modificar texto se usa `sed` (lo verás más adelante).'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w4-4', { title: 'Expresiones regulares', summary: 'Patrones con ^ $ . [ ] + {n} y grep -E', emoji: '🧩', commands: ['grep'], minutes: 10 }, [
      learn('Patrones, no solo palabras', `
Una **expresión regular** (_regex_) describe un **patrón** de texto. Lo básico:

| Símbolo | Significa | Ejemplo |
|---|---|---|
| \`^\` | Inicio de línea | \`^ERROR\` |
| \`$\` | Fin de línea | \`com$\` |
| \`.\` | Cualquier carácter | \`a.c\` → abc, a1c |
| \`[abc]\` | Uno de esos | \`[aeiou]\` |
| \`[0-9]\` | Un dígito | \`[0-9][0-9]\` |
| \`*\` | 0 o más del anterior | \`ab*\` |
| \`+\` | 1 o más (con \`-E\`) | \`[0-9]+\` |
| \`{n}\` | Exactamente n (con \`-E\`) | \`[0-9]{3}\` |
| \`\\|\` | O (con \`-E\`) | \`ana\\|luis\` |

> CLAVE: Añade **\`-E\`** a grep para usar la sintaxis extendida (\`+\`, \`?\`, \`{n}\`, \`|\`, \`()\`) sin tener que escaparlos con \`\\\`.
`, '🧩'),
      illus('regex-cheat', 'Chuleta de regex', 'Toca cada elemento para ver un ejemplo.'),
      demo('Regex en la práctica', [
        ['grep "^ERROR" servidor.log', 'Líneas que EMPIEZAN por ERROR'],
        ['grep -E "^(ERROR|WARN)" servidor.log', 'ERROR o WARN al inicio'],
        ['grep -E "[0-9]{3}-[0-9]{3}-[0-9]{3}" agenda.txt', 'Líneas con un teléfono'],
        ['grep -oE "[a-z]+@[a-z]+\\.[a-z]+" agenda.txt', '-o imprime solo lo que coincide: los emails'],
        ['grep -c "@correo.com" agenda.txt', 'Cuántos tienen ese dominio'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/servidor.log': SERVIDOR, '/home/alumno/agenda.txt': AGENDA } }),
      mc('¿Qué patrón coincide con líneas que **terminan** en `.com`?', ['^\\.com', '\\.com$', '.com*', '[.com]'], 1, '`$` ancla al final de línea. El punto se escapa (`\\.`) para que sea un punto literal.'),
      mc('¿Cuál coincide con exactamente tres dígitos seguidos (con `-E`)?', ['[0-9]*3', '[0-9]{3}', '[3-0]', '3[0-9]'], 1, '`{3}` repite lo anterior tres veces: `[0-9]{3}`.'),
      practice({
        goal: 'Líneas que empiezan por ERROR',
        prompt: 'Muestra solo las líneas de `servidor.log` que **empiezan** por `ERROR` (en mayúsculas).',
        setup: { files: { '/home/alumno/servidor.log': SERVIDOR } },
        check: all(ran("\\^ERROR"), outEq('ERROR disco lleno\nERROR sin red')),
        solution: ['grep "^ERROR" servidor.log'],
        hints: ['`^` ancla el patrón al inicio de la línea.', '`grep "^ERROR" servidor.log`'],
        explain: 'Sin el ancla `^` también saldrían líneas que contuvieran ERROR en medio.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'Extrae los emails',
        prompt: 'De `agenda.txt` extrae **solo las direcciones de correo** (una por línea, sin el resto del texto). Usa `-o` y `-E`.',
        setup: { files: { '/home/alumno/agenda.txt': AGENDA } },
        check: all(used('grep'), outEq('ana@correo.com\nluis@mail.org\nmarta@correo.com\npedro@gil.net')),
        solution: ['grep -oE "[a-z]+@[a-z]+\\.[a-z]+" agenda.txt'],
        hints: ['Un email son letras, una @, letras, un punto y letras.', '`grep -oE "[a-z]+@[a-z]+\\.[a-z]+" agenda.txt`'],
        explain: '`-o` imprime únicamente la parte que coincide. Con una regex decente extraes datos de cualquier texto.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: '¿Cuántos teléfonos hay?',
        prompt: 'Cuenta cuántas líneas de `agenda.txt` contienen un **teléfono** con formato `123-456-789` (debe salir 3).',
        setup: { files: { '/home/alumno/agenda.txt': AGENDA } },
        check: all(used('grep'), outEq('3')),
        solution: ['grep -cE "[0-9]{3}-[0-9]{3}-[0-9]{3}" agenda.txt'],
        hints: ['`-c` cuenta y `{3}` repite tres veces.', '`grep -cE "[0-9]{3}-[0-9]{3}-[0-9]{3}" agenda.txt`'],
        explain: 'Las regex permiten validar formatos: teléfonos, fechas, IPs, matrículas…',
        par: 1,
        commands: ['grep'],
      }),
      fill('Completa: líneas que contienen "ana" **o** "luis"', 'grep -E "ana___luis" agenda.txt', ['|', '&', ',', '+'], ['|'], 'En el modo extendido (`-E`), `|` significa "o".'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w4-5', { title: '¿Dónde está?', summary: 'which, whereis, type y locate', emoji: '📍', commands: ['which', 'whereis', 'type', 'locate'], minutes: 6 }, [
      learn('Localizar programas y archivos', `
| Comando | Responde a… |
|---|---|
| \`which cmd\` | ¿Qué ejecutable se lanza si escribo \`cmd\`? |
| \`whereis cmd\` | ¿Dónde están el binario **y** su manual? |
| \`type cmd\` | ¿Es alias, función, builtin o programa? |
| \`command -v cmd\` | Versión portable de which |
| \`locate nombre\` | Busca por nombre en una **base de datos** (rapidísimo) |

> NOTA: \`locate\` no recorre el disco: consulta un índice que se actualiza con \`sudo updatedb\`. Por eso un archivo recién creado puede no aparecer hasta actualizar. \`find\` siempre ve el estado real.
`, '📍'),
      demo('¿Dónde vive cada cosa?', [
        ['which python3', 'Ruta del ejecutable'],
        ['whereis ls', 'Binario y página de manual'],
        ['type cd', 'cd es un builtin: no existe como archivo'],
        ['type ls', 'ls sí es un programa'],
        ['locate passwd', 'Todo lo que se llame passwd'],
      ]),
      mc('Quieres saber si `cd` es un programa o parte de la shell. ¿Qué usas?', ['which cd', 'type cd', 'find cd', 'locate cd'], 1, '`type` distingue alias, funciones, builtins y programas externos. `cd` es un builtin.'),
      tf('`locate` siempre encuentra un archivo recién creado.', false, '`locate` usa una base de datos que se actualiza periódicamente (o con `sudo updatedb`). `find` sí ve archivos nuevos al instante.'),
      practice({
        goal: '¿Dónde está python3?',
        prompt: 'Averigua **en qué ruta** está el ejecutable de `python3`.',
        check: all(used('which'), out('/usr/bin/python3')),
        solution: ['which python3'],
        hints: ['El comando se llama como la pregunta: _¿cuál?_ en inglés.', '`which python3`'],
        explain: '`which` sigue el PATH y te dice qué ejecutable se usaría. Imprescindible cuando tienes varias versiones instaladas.',
        par: 1,
        commands: ['which'],
      }),
      practice({
        goal: '¿cd es un programa?',
        prompt: 'Averigua **qué tipo de comando** es `cd` (debe decir que es un _builtin_ de la shell).',
        check: all(used('type'), out('builtin')),
        solution: ['type cd'],
        hints: ['Un comando que "tipifica" a otros.', '`type cd`'],
        explain: 'Los builtins viven dentro de bash: por eso `cd` no puede ser un programa externo (cambiaría su propia carpeta, no la tuya).',
        par: 1,
        commands: ['type'],
      }),
      practice({
        goal: 'Encuentra passwd',
        prompt: 'Usa `locate` para encontrar **todos los archivos llamados passwd** (debe aparecer `/etc/passwd`).',
        check: all(used('locate'), out('/etc/passwd')),
        solution: ['locate passwd'],
        hints: ['`locate` + nombre.', '`locate passwd`'],
        explain: '`locate` es instantáneo gracias a su índice. Para cosas recientes o filtros avanzados usa `find`.',
        par: 1,
        commands: ['locate'],
      }),
      typeCmd('Escribe el comando que muestra la ruta del ejecutable `grep`', ['which grep'], '`which` imprime la ruta que usaría la shell.'),
    ]),
  ],
  boss: {
    goal: 'Misión: auditoría del proyecto',
    prompt:
      '**Misión del dojo** 🥋\n\nAudita la carpeta `proyecto`:\n\n1. **Borra** todos los archivos `.tmp`.\n2. Guarda en **pendientes.txt** (en tu carpeta personal) la lista de archivos que contienen la marca **TODO**.',
    setup: { cwd: '/home/alumno', files: PROYECTO },
    check: all(
      fileCount('/home/alumno/proyecto/tmp', 0),
      content('/home/alumno/pendientes.txt', { includes: ['proyecto/src/main.py', 'proyecto/src/utils.py', 'proyecto/docs/guia.md'], lines: 3 }),
    ),
    solution: ['find proyecto -name "*.tmp" -delete', 'grep -rl TODO proyecto > pendientes.txt'],
    hints: ['Para borrar: `find … -name "*.tmp" -delete`.', 'Para la lista: `grep -rl TODO proyecto`.', 'Redirige la segunda con `> pendientes.txt`.'],
    explain: '¡Zona 4 completada! Ya sabes encontrar cualquier archivo y cualquier línea. Siguiente: permisos y usuarios.',
    par: 2,
    commands: ['find', 'grep'],
  },
});

