import { aliasIs, all, any, content, envIs, exists, funcDefined, mode, missing, out, outEq, outRe, ran } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, predict, tf, world } from '../build';

const LISTA = 'manzana\npera\nuva\n';
const DATOS = { '/home/alumno/datos/a.txt': 'a\n', '/home/alumno/datos/b.txt': 'b\n', '/home/alumno/datos/c.txt': 'c\n' };

export const w10 = world({
  id: 'w10',
  index: 10,
  title: 'Scripting en bash',
  subtitle: 'Automatiza con variables, condiciones, bucles y funciones',
  emoji: '📜',
  color: '#4ADE80',
  level: 'avanzado',
  intro:
    'Un script es simplemente **comandos guardados en un archivo**. Todo lo que ya sabes se vuelve reutilizable y automático. Aquí aprenderás el lenguaje de la shell: variables, condiciones, bucles y funciones.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w10-1', { title: 'Tu primer script', summary: 'Shebang, permisos y ejecución', emoji: '🚀', commands: ['bash', 'chmod', 'echo', 'printf'], minutes: 7 }, [
      learn('Comandos en un archivo', `
Un **script** es un archivo de texto con comandos que la shell ejecuta de arriba abajo.

\`\`\`bash
#!/bin/bash
# Mi primer script
echo "Hola desde un script"
\`\`\`

- La primera línea, **\`#!/bin/bash\`** (_shebang_), dice **qué intérprete** debe ejecutarlo.
- Las líneas que empiezan por **\`#\`** son comentarios.

Hay **dos formas** de ejecutarlo:

| Forma | Requiere |
|---|---|
| \`bash hola.sh\` | Solo leer el archivo |
| \`./hola.sh\` | Permiso de **ejecución** (\`chmod +x\`) |

> OJO: Se escribe \`./hola.sh\` y no \`hola.sh\`: por seguridad, la carpeta actual **no está en el PATH**, así que hay que indicar la ruta (\`./\` = "aquí").
`, '🚀'),
      illus('script-anatomy', 'Anatomía de un script', 'Shebang, comentarios, comandos… y su código de salida.'),
      demo('De cero a ejecutable', [
        ['printf \'#!/bin/bash\\necho "Hola desde un script"\\n\' > hola.sh', 'Crea el archivo (también puedes usar nano hola.sh)'],
        ['cat hola.sh', 'Su contenido'],
        ['./hola.sh', 'Sin permiso de ejecución: falla'],
        ['chmod +x hola.sh', 'Le damos permiso'],
        ['./hola.sh', 'Ahora funciona'],
        ['bash hola.sh', 'Con bash no hacía falta permiso'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué indica la línea `#!/bin/bash` al principio de un script?', ['Que es un comentario sin importancia', 'Qué intérprete debe ejecutar el script', 'El nombre del autor', 'Que el script es seguro'], 1, 'Se llama _shebang_ (`#!`). El sistema lee esa línea para saber con qué programa lanzar el archivo.'),
      mc('`./hola.sh` responde "Permission denied". ¿Qué falta?', ['sudo', 'Permiso de ejecución (chmod +x)', 'Reiniciar la shell', 'Instalar bash'], 1, 'Un archivo no es ejecutable hasta que le das el permiso `x`.'),
      practice({
        goal: 'Crea y ejecuta tu primer script',
        prompt: 'Crea un script **hola.sh** que imprima `Hola desde un script`, hazlo **ejecutable** y lánzalo con `./hola.sh`. (Puedes crearlo con `printf`, `echo` o el editor `nano`.)',
        check: all(mode('/home/alumno/hola.sh', '755'), ran('^\\./hola\\.sh$'), outEq('Hola desde un script')),
        solution: ['printf \'#!/bin/bash\\necho "Hola desde un script"\\n\' > hola.sh', 'chmod +x hola.sh', './hola.sh'],
        hints: ['Tres pasos: crear el archivo, `chmod +x`, ejecutar.', 'Con printf: `printf \'#!/bin/bash\\necho "Hola desde un script"\\n\' > hola.sh`'],
        explain: 'Ya tienes el ciclo de todo script: escribir → dar permiso → ejecutar. Lo demás es contenido.',
        par: 3,
        commands: ['chmod', 'printf'],
      }),
      practice({
        goal: 'Ejecuta sin permiso',
        prompt: 'Hay un script `saludo.sh` **sin** permiso de ejecución. Lánzalo igualmente usando el intérprete (`bash`), sin cambiar sus permisos.',
        setup: { files: { '/home/alumno/saludo.sh': { content: '#!/bin/bash\necho "Funciona sin chmod"\n', mode: 0o644 } } },
        check: all(ran('^bash saludo\\.sh$'), outEq('Funciona sin chmod')),
        solution: ['bash saludo.sh'],
        hints: ['No necesitas `x` si llamas a bash tú mismo.', '`bash saludo.sh`'],
        explain: '`bash script.sh` solo necesita permiso de **lectura**. Útil cuando no puedes (o no quieres) cambiar permisos.',
        par: 1,
        commands: ['bash'],
      }),
      practice({
        goal: 'Arregla el permiso',
        prompt: 'El script `limpiar.sh` falla con `Permission denied` al ejecutarlo con `./limpiar.sh`. **Dale permiso de ejecución** y lánzalo.',
        setup: { files: { '/home/alumno/limpiar.sh': { content: '#!/bin/bash\necho "Limpieza completada"\n', mode: 0o644 } } },
        check: all(mode('/home/alumno/limpiar.sh', '755'), outEq('Limpieza completada')),
        solution: ['chmod +x limpiar.sh', './limpiar.sh'],
        hints: ['Es un problema de permisos.', '`chmod +x limpiar.sh` y luego `./limpiar.sh`'],
        explain: '"Permission denied" al lanzar un script casi siempre significa que falta `chmod +x`.',
        par: 2,
        commands: ['chmod'],
      }),
      fill('Completa: la primera línea de un script bash', '___/bin/bash', ['#!', '//', '#$', '$!'], ['#!'], 'El _shebang_ es `#!` seguido de la ruta del intérprete.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w10-2', { title: 'Variables y argumentos', summary: 'Guarda datos, recibe parámetros y calcula', emoji: '🧺', commands: ['read', 'export', 'echo'], minutes: 9 }, [
      learn('Variables', `
Una variable guarda un valor. Se **asigna sin espacios** alrededor del \`=\` y se **usa con \`$\`**:

\`\`\`bash
nombre="Ana"
echo "Hola, $nombre"
echo "Eres \${nombre}itada"     # llaves para delimitar
\`\`\`

**Sustitución de comandos** — guarda la salida de un comando:

\`\`\`bash
archivos=$(ls /etc | wc -l)
hoy=$(date +%F)
\`\`\`

**Aritmética** con \`$(( ))\`:

\`\`\`bash
echo $(( 3 + 4 * 2 ))     # 11
n=$(( n + 1 ))
\`\`\`

> OJO: \`nombre = "Ana"\` (con espacios) **no funciona**: bash lo entiende como un comando llamado \`nombre\`.
`, '🧺'),
      learn('Argumentos del script', `
Cuando lanzas \`./script.sh uno dos\`, dentro del script:

| Variable | Valor |
|---|---|
| \`$0\` | El nombre del script |
| \`$1\`, \`$2\`… | Primer, segundo argumento |
| \`$#\` | Cuántos argumentos hay |
| \`$@\` | Todos los argumentos |
| \`$?\` | Código de salida del último comando |
| \`\${1:-mundo}\` | \`$1\`, o **"mundo"** si no se pasó |

Y para **pedir datos** al usuario: \`read -p "¿Nombre? " nombre\`.

> TIP: Escribe **siempre** las variables entre comillas dobles: \`"$nombre"\`. Evita errores con espacios.
`),
      demo('Variables en acción', [
        ['nombre="Ana"; echo "Hola, $nombre"', 'Asignar y usar'],
        ['echo $(( 15 * 4 + 2 ))', 'Aritmética'],
        ['archivos=$(ls /etc | wc -l); echo "En /etc hay $archivos elementos"', 'Sustitución de comandos'],
        ['printf \'#!/bin/bash\\necho "Args: $#"\\necho "Primero: $1"\\necho "Hola, ${2:-mundo}"\\n\' > args.sh', 'Un script con argumentos'],
        ['bash args.sh uno dos', 'Con dos argumentos'],
        ['bash args.sh uno', '$2 vacío → usa el valor por defecto'],
      ], { cwd: '/home/alumno' }),
      mc('¿Cuál asigna correctamente la variable?', ['nombre = "Ana"', 'nombre="Ana"', '$nombre="Ana"', 'set nombre "Ana"'], 1, 'En bash no puede haber espacios alrededor del `=`, y no se usa `$` al asignar.'),
      predict('¿Qué imprime?', 'x=5; y=3; echo $(( x * y + 1 ))', ['15', '13', '53'], '`x * y + 1` = 5·3 + 1 = 16.'),
      predict('¿Qué imprime este script con `bash s.sh a b c`?', 'printf \'echo "$# argumentos"\\n\' > s.sh; bash s.sh a b c', ['1 argumentos', '4 argumentos', 's.sh argumentos'], '`$#` cuenta los argumentos: 3.'),
      practice({
        goal: 'Calcula con bash',
        prompt: 'Muestra el resultado de **15 × 4 + 2** usando aritmética de bash (`$(( ))`). Debe salir **62**.',
        check: all(ran('\\$\\(\\('), outEq('62')),
        solution: ['echo $((15*4+2))'],
        hints: ['Aritmética: `$(( expresión ))`.', '`echo $((15*4+2))`'],
        explain: '`$(( ))` evalúa operaciones enteras: `+ - * / % **`.',
        par: 1,
        commands: ['echo'],
      }),
      practice({
        goal: 'Guarda la salida en una variable',
        prompt: 'Guarda en la variable **archivos** el número de elementos de `/etc` (`ls /etc | wc -l`) y muéstrala con `echo $archivos`.',
        check: all(envIs('archivos'), ran('\\$\\(.*ls.*\\)'), outRe('^\\d+$')),
        solution: ['archivos=$(ls /etc | wc -l)', 'echo $archivos'],
        hints: ['`variable=$(comando)` captura su salida.', '`archivos=$(ls /etc | wc -l)` y luego `echo $archivos`'],
        explain: 'La sustitución de comandos es la herramienta que une todos tus scripts: guarda un resultado para usarlo después.',
        par: 2,
        commands: ['echo'],
      }),
      practice({
        goal: 'Pasa un argumento',
        prompt: 'El script `saludo.sh` saluda a quien le pases como argumento. Ejecútalo (`./saludo.sh`) pasándole **Ana**.',
        setup: { files: { '/home/alumno/saludo.sh': { content: '#!/bin/bash\necho "Hola, $1"\n', mode: 0o755 } } },
        check: all(ran('^\\./saludo\\.sh Ana$'), outEq('Hola, Ana')),
        solution: ['./saludo.sh Ana'],
        hints: ['El argumento va detrás del nombre del script.', '`./saludo.sh Ana`'],
        explain: 'Dentro del script, `$1` valía "Ana". Así un mismo script sirve para mil casos.',
        par: 1,
        commands: ['bash'],
      }),
      practice({
        goal: 'Un script que pregunta',
        prompt: '`pregunta.sh` te pide tu nombre con `read`. Ejecútalo (`./pregunta.sh`) y responde **Luis**.',
        setup: { files: { '/home/alumno/pregunta.sh': { content: '#!/bin/bash\nread -p "¿Cómo te llamas? " nombre\necho "Hola, $nombre"\n', mode: 0o755 } } },
        check: all(ran('^\\./pregunta\\.sh$'), out('Hola, Luis')),
        solution: ['./pregunta.sh', 'Luis'],
        hints: ['Ejecútalo; cuando espere, escribe el nombre.', 'Escribe `./pregunta.sh` y luego `Luis`.'],
        explain: '`read` guarda lo que teclea el usuario en una variable: así los scripts se vuelven interactivos.',
        par: 2,
        commands: ['read'],
      }),
      fill('Completa: valor por defecto si no hay argumento', 'echo "Hola, ${1___mundo}"', [':-', ':=', '=-', '?'], [':-'], '`${var:-valor}` usa `valor` cuando `var` está vacía o sin definir.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w10-3', { title: 'Condiciones', summary: 'if, tests, códigos de salida, && y ||', emoji: '🔀', commands: ['test', '[', 'true', 'false'], minutes: 9 }, [
      learn('Decidir', `
\`\`\`bash
if [ -f /etc/passwd ]; then
  echo "existe"
elif [ -d /etc/passwd ]; then
  echo "es una carpeta"
else
  echo "no existe"
fi
\`\`\`

Los **corchetes** \`[ ]\` ejecutan el comando \`test\`. **Dejan espacios** dentro: \`[ -f archivo ]\`, no \`[-f archivo]\`.

| Test de archivos | ¿Cierto si…? |
|---|---|
| \`-f a\` | \`a\` es un archivo normal |
| \`-d a\` | \`a\` es un directorio |
| \`-e a\` | \`a\` existe |
| \`-r\` \`-w\` \`-x\` | Se puede leer / escribir / ejecutar |

| Números | Texto |
|---|---|
| \`-eq\` igual, \`-ne\` distinto | \`=\` igual, \`!=\` distinto |
| \`-gt\` mayor, \`-ge\` mayor o igual | \`-z "$s"\` vacío |
| \`-lt\` menor, \`-le\` menor o igual | \`-n "$s"\` no vacío |
`, '🔀'),
      illus('exit-status', 'Todo comando devuelve un código', '0 significa éxito; cualquier otro valor, error. Las condiciones se basan en eso.'),
      learn('Éxito y error: $?, && y ||', `
Cada comando termina con un **código de salida**: **0 = éxito**, distinto de 0 = error. Se consulta con \`$?\`.

\`if\` realmente evalúa **el código de salida** de un comando, no solo \`[ ]\`:

\`\`\`bash
if grep -q root /etc/passwd; then echo "hay root"; fi
\`\`\`

Atajos de una línea:

\`\`\`
comando1 && comando2     # comando2 SOLO si comando1 tuvo éxito
comando1 || comando2     # comando2 SOLO si comando1 falló
mkdir -p backup && cd backup
[ -d backup ] || mkdir backup
\`\`\`

> CLAVE: \`grep -q\` no imprime nada: solo devuelve 0 si encuentra. Perfecto para condiciones.
`),
      demo('Probando condiciones', [
        ['[ -f /etc/passwd ] && echo "existe"', 'Si el test es cierto, ejecuta echo'],
        ['[ -d /noexiste ] || echo "no es carpeta"', 'Si falla, ejecuta lo otro'],
        ['grep -q root /etc/passwd; echo $?', 'Éxito: 0'],
        ['grep -q zzzzz /etc/passwd; echo $?', 'No encuentra: 1'],
        ['n=7; if [ $n -gt 5 ]; then echo "grande"; else echo "pequeño"; fi', 'if en una línea'],
        ['case "linux" in linux) echo "pingüino";; *) echo "otro";; esac', 'case: varias opciones'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué significa un código de salida **0**?', ['Error', 'Éxito', 'Que el comando no existe', 'Que está vacío'], 1, 'En el mundo de las shells, 0 es "todo bien". Cualquier otro número es un error.'),
      mc('¿Qué hace `cmd1 || cmd2`?', ['Ejecuta cmd2 solo si cmd1 falla', 'Ejecuta ambos siempre', 'Ejecuta cmd2 solo si cmd1 funciona', 'Los une con una tubería'], 0, '`||` es "o si no": cmd2 se ejecuta únicamente cuando cmd1 devuelve un código distinto de 0.'),
      practice({
        goal: 'Comprueba si existe',
        prompt: 'En **una sola línea**, comprueba si `/etc/passwd` es un archivo y, si lo es, imprime **existe**.',
        check: all(any(ran('\\[ -[fe] /etc/passwd \\]'), ran('test -[fe] /etc/passwd'), ran('\\[\\[ -[fe]')), outEq('existe')),
        solution: ['[ -f /etc/passwd ] && echo existe'],
        hints: ['Un test con `-f` y `&&`.', '`[ -f /etc/passwd ] && echo existe`'],
        explain: '`test && acción` es la forma más corta de un `if` sin `else`.',
        par: 1,
        commands: ['test'],
      }),
      practice({
        goal: 'Crea solo si no existe',
        prompt: 'Crea la carpeta **backup** **solo si todavía no existe**, usando un test de directorio y `||` (o un `if`).',
        check: all(exists('/home/alumno/backup', 'dir'), any(ran('\\[ -d'), ran('test -d'), ran('\\[\\[ -d'), ran('^if '))),
        solution: ['[ -d backup ] || mkdir backup'],
        hints: ['Si el test `-d` falla, crea la carpeta.', '`[ -d backup ] || mkdir backup`'],
        explain: 'Los scripts deben ser **idempotentes**: ejecutarlos dos veces no debería dar error.',
        par: 1,
        commands: ['test', 'mkdir'],
      }),
      practice({
        goal: '¿Qué código devolvió?',
        prompt: 'Ejecuta `grep -q root /etc/passwd` (no imprime nada) y luego muestra su **código de salida** con `echo $?`. Debe salir **0**.',
        check: all(ran('^echo \\$\\?$'), outEq('0')),
        solution: ['grep -q root /etc/passwd', 'echo $?'],
        hints: ['`$?` guarda el código del comando anterior.', '`grep -q root /etc/passwd` y después `echo $?`'],
        explain: '`$?` se sobrescribe con **cada** comando, así que léelo inmediatamente.',
        par: 2,
        commands: ['grep', 'echo'],
      }),
      practice({
        goal: 'Un if completo',
        prompt: 'Escribe un `if` en una línea: asigna `n=7` y, si **n es mayor que 5**, imprime **grande**; si no, **pequeño**.',
        check: all(ran('^n=7'), ran('if .*-gt'), outEq('grande')),
        solution: ['n=7; if [ $n -gt 5 ]; then echo grande; else echo pequeño; fi'],
        hints: ['`if [ $n -gt 5 ]; then …; else …; fi`', '`n=7; if [ $n -gt 5 ]; then echo grande; else echo pequeño; fi`'],
        explain: 'Cada `if` se cierra con `fi` (if al revés). Los `;` permiten escribirlo en una línea.',
        par: 1,
        commands: ['test'],
      }),
      match('Une cada test con su significado', [['-f x', 'x es un archivo'], ['-d x', 'x es una carpeta'], ['-z "$s"', 's está vacía'], ['$a -gt $b', 'a es mayor que b']], 'Estos cuatro cubren casi todo lo que necesitarás.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w10-4', { title: 'Bucles', summary: 'for, while y recorrer archivos', emoji: '🔁', commands: ['seq', 'read'], minutes: 9 }, [
      learn('Repetir sin copiar y pegar', `
**for** recorre una lista:

\`\`\`bash
for fruta in manzana pera uva; do
  echo "Me gusta la $fruta"
done

for i in {1..5}; do echo $i; done          # rangos
for f in datos/*.txt; do echo "$f"; done   # archivos con comodín
\`\`\`

**while** repite mientras la condición sea cierta:

\`\`\`bash
n=3
while [ $n -gt 0 ]; do
  echo $n
  n=$(( n - 1 ))
done
\`\`\`

Y el patrón clásico para **leer un archivo línea a línea**:

\`\`\`bash
while read linea; do
  echo "-> $linea"
done < lista.txt
\`\`\`

> TIP: \`break\` sale del bucle y \`continue\` salta a la siguiente vuelta.
`, '🔁'),
      demo('Bucles en acción', [
        ['for i in 1 2 3; do echo "vuelta $i"; done', 'for con lista'],
        ['for f in datos/*.txt; do echo "archivo: $f"; done', 'for con comodín'],
        ['n=3; while [ $n -gt 0 ]; do echo $n; n=$((n-1)); done', 'Cuenta atrás con while'],
        ['while read l; do echo "-> $l"; done < lista.txt', 'Leer línea a línea'],
        ['for f in datos/*.txt; do mv "$f" "${f%.txt}.bak"; done', 'Renombrar en masa (${f%.txt} quita la extensión)'],
        ['ls datos', 'Todos son .bak ahora'],
      ], { cwd: '/home/alumno', files: { ...DATOS, '/home/alumno/lista.txt': LISTA } }),
      mc('¿Cuántas veces se ejecuta `for i in {1..5}; do echo $i; done`?', ['4', '5', '6', 'Infinitas'], 1, '`{1..5}` genera 5 valores: 1, 2, 3, 4 y 5.'),
      mc('¿Qué hace `${f%.txt}` cuando `f=informe.txt`?', ['informe.txt.txt', 'informe', '.txt', 'Da error'], 1, '`${var%patrón}` elimina el patrón del **final** de la variable. Es el truco para cambiar extensiones.'),
      practice({
        goal: 'Cuenta hasta 5',
        prompt: 'Imprime los números del **1 al 5**, uno por línea, usando un bucle `for` con llaves `{1..5}`.',
        check: all(ran('for .*\\{1\\.\\.5\\}'), outEq('1\n2\n3\n4\n5')),
        solution: ['for i in {1..5}; do echo $i; done'],
        hints: ['`for i in {1..5}; do …; done`', '`for i in {1..5}; do echo $i; done`'],
        explain: 'Este es el "hola mundo" de los bucles. Con `seq` también puedes: `for i in $(seq 1 5)`.',
        par: 1,
        commands: ['seq'],
      }),
      practice({
        goal: 'Procesa cada archivo',
        prompt: 'Para cada archivo `.txt` de la carpeta `datos`, imprime **`Procesando: RUTA`** (por ejemplo `Procesando: datos/a.txt`).',
        setup: { files: DATOS },
        check: all(ran('for .*datos/\\*\\.txt'), outEq('Procesando: datos/a.txt\nProcesando: datos/b.txt\nProcesando: datos/c.txt')),
        solution: ['for f in datos/*.txt; do echo "Procesando: $f"; done'],
        hints: ['El comodín `datos/*.txt` genera la lista.', '`for f in datos/*.txt; do echo "Procesando: $f"; done`'],
        explain: 'Recorrer archivos con un `for` + comodín es la base de la automatización de tareas masivas.',
        par: 1,
        commands: ['echo'],
      }),
      practice({
        goal: 'Lee una lista línea a línea',
        prompt: 'Lee `lista.txt` línea a línea con `while read` y muestra cada línea como **`-> línea`**.',
        setup: { files: { '/home/alumno/lista.txt': LISTA } },
        check: all(ran('while read'), outEq('-> manzana\n-> pera\n-> uva')),
        solution: ['while read l; do echo "-> $l"; done < lista.txt'],
        hints: ['La redirección `< lista.txt` va **después** de `done`.', '`while read l; do echo "-> $l"; done < lista.txt`'],
        explain: 'Es el patrón estándar para procesar archivos de texto línea a línea en un script.',
        par: 1,
        commands: ['read'],
      }),
      practice({
        goal: 'Renombra en masa',
        prompt: 'Cambia la extensión de **todos los `.txt` de `datos` a `.bak`** con un bucle (usa `${f%.txt}.bak`).',
        setup: { files: DATOS },
        check: all(exists('/home/alumno/datos/a.bak', 'file'), exists('/home/alumno/datos/c.bak', 'file'), missing('/home/alumno/datos/a.txt'), missing('/home/alumno/datos/b.txt')),
        solution: ['for f in datos/*.txt; do mv "$f" "${f%.txt}.bak"; done'],
        hints: ['Dentro del bucle: `mv "$f" "${f%.txt}.bak"`.', '`for f in datos/*.txt; do mv "$f" "${f%.txt}.bak"; done`'],
        explain: 'Renombrar 500 archivos en un segundo: ese es el superpoder del scripting.',
        par: 1,
        commands: ['mv'],
      }),
      order('Ordena un bucle for', ['for', 'i', 'in', '1', '2', '3;', 'do', 'echo', '$i;', 'done'], 'for i in 1 2 3; do echo $i; done', 'for VARIABLE in LISTA; do COMANDOS; done.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w10-5', { title: 'Funciones y buenas prácticas', summary: 'Reutiliza código y escribe scripts robustos', emoji: '🧱', commands: ['set', 'trap', 'source'], minutes: 9 }, [
      learn('Funciones', `
Una **función** agrupa comandos bajo un nombre para reutilizarlos:

\`\`\`bash
saludar() {
  local nombre="$1"
  echo "Hola, $nombre"
}
saludar Ana        # → Hola, Ana
\`\`\`

- Los argumentos de la función son \`$1\`, \`$2\`… (propios de ella).
- \`local\` limita una variable a la función.
- \`return N\` devuelve un **código de salida** (0 a 255), no un valor. Para devolver un texto, **imprímelo** y captúralo con \`$( )\`.

\`\`\`bash
suma() { echo $(( $1 + $2 )); }
total=$(suma 2 3)      # total = 5
\`\`\`
`, '🧱'),
      learn('Scripts que no fallan en silencio', `
Al principio de un script serio es habitual poner:

\`\`\`bash
#!/bin/bash
set -euo pipefail
\`\`\`

| Opción | Efecto |
|---|---|
| \`-e\` | Termina si **algún comando falla** |
| \`-u\` | Error si usas una **variable sin definir** |
| \`-o pipefail\` | Una tubería falla si falla **cualquiera** de sus partes |

Otras buenas prácticas:

- Pon las variables **entre comillas**: \`"$archivo"\`.
- Comprueba los argumentos: \`[ $# -eq 1 ] || { echo "uso: $0 DIR"; exit 1; }\`
- Usa \`trap 'rm -f "$tmp"' EXIT\` para **limpiar** al terminar.
- Depura con \`bash -x script.sh\` (muestra cada comando ejecutado).

> CLAVE: \`source archivo.sh\` (o \`. archivo.sh\`) ejecuta el archivo **en tu shell actual**, por eso las funciones y variables definidas allí quedan disponibles.
`),
      demo('Funciones', [
        ['saludar() { echo "Hola, $1"; }', 'Define la función'],
        ['saludar Ana', 'Llámala'],
        ['saludar Luis', 'Reutilízala'],
        ['suma() { echo $(( $1 + $2 )); }; total=$(suma 2 3); echo "Total: $total"', 'Devolver un valor imprimiéndolo'],
        ['esPar() { [ $(( $1 % 2 )) -eq 0 ]; }; esPar 4 && echo "4 es par"', 'Una función como condición'],
        ['esPar 7 || echo "7 es impar"', 'Su código de salida decide'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué devuelve realmente `return 3` dentro de una función?', ['El valor 3 para guardarlo en una variable', 'El código de salida 3', 'El texto "3"', 'Nada'], 1, '`return` fija el código de salida (como `$?`). Para devolver datos, imprímelos y captúralos con `$( )`.'),
      mc('¿Qué hace `set -e` al principio de un script?', ['Activa los colores', 'Detiene el script al primer comando que falle', 'Permite editar el script', 'Exporta todas las variables'], 1, 'Evita que un script siga ejecutándose después de un error, lo que podría causar daños en cadena.'),
      practice({
        goal: 'Tu primera función',
        prompt: 'Define una función **saludar** que imprima `Hola, ` seguido de su primer argumento y **llámala con Ana**. Debe imprimirse `Hola, Ana`.',
        check: all(funcDefined('saludar'), ran('saludar Ana'), outEq('Hola, Ana')),
        solution: ['saludar() { echo "Hola, $1"; }; saludar Ana'],
        hints: ['`nombre() { comandos; }` y luego `nombre argumento`.', '`saludar() { echo "Hola, $1"; }; saludar Ana`'],
        explain: 'Cada función tiene su propio `$1`. Ya puedes organizar un script en bloques con nombre.',
        par: 1,
        commands: ['echo'],
      }),
      practice({
        goal: 'Una función como condición',
        prompt: 'Define **esPar** (devuelve éxito si su argumento es par, con `[ $(( $1 % 2 )) -eq 0 ]`) y ejecútala así: `esPar 4 && echo par`.',
        check: all(funcDefined('esPar'), ran('esPar 4 && echo par'), outEq('par')),
        solution: ['esPar() { [ $(( $1 % 2 )) -eq 0 ]; }; esPar 4 && echo par'],
        hints: ['El cuerpo es solo el test; su resultado es el código de salida.', '`esPar() { [ $(( $1 % 2 )) -eq 0 ]; }; esPar 4 && echo par`'],
        explain: 'Una función puede usarse en un `if` igual que cualquier comando: `if esPar 8; then … fi`.',
        par: 1,
        commands: ['test'],
      }),
      practice({
        goal: 'Devuelve un valor',
        prompt: 'Define **suma** para que **imprima** `$1 + $2`, guarda su resultado con `$(suma 2 3)` en la variable **total** y muéstrala. Debe salir **5**.',
        check: all(funcDefined('suma'), envIs('total', '5'), outEq('5')),
        solution: ['suma() { echo $(( $1 + $2 )); }', 'total=$(suma 2 3)', 'echo $total'],
        hints: ['La función imprime; la variable la captura con `$( )`.', '`suma() { echo $(( $1 + $2 )); }` y `total=$(suma 2 3)`'],
        explain: 'Imprimir + `$( )` es la forma de "devolver" datos en bash.',
        par: 3,
        commands: ['echo'],
      }),
      practice({
        goal: 'Carga funciones con source',
        prompt: 'El archivo `util.sh` define la función `doble`. Cárgalo en tu shell con **source** y úsala: `doble 21` debe imprimir **42**.',
        setup: { files: { '/home/alumno/util.sh': 'doble() { echo $(( $1 * 2 )); }\n' } },
        check: all(any(ran('^source util\\.sh$'), ran('^\\. util\\.sh$')), funcDefined('doble'), outEq('42')),
        solution: ['source util.sh', 'doble 21'],
        hints: ['`source archivo` ejecuta el contenido en TU shell.', '`source util.sh` y luego `doble 21`'],
        explain: 'Con `bash util.sh` la función se definiría en un proceso hijo y desaparecería. `source` la deja en tu sesión.',
        par: 2,
        commands: ['source'],
      }),
      tf('Con `bash script.sh` las funciones que define el script quedan disponibles en tu terminal.', false, 'Se ejecutan en un proceso hijo. Para dejarlas en tu sesión hay que usar `source script.sh`.'),
    ]),

    // ───────────────────────── 6 ─────────────────────────
    lesson('w10-6', { title: 'Entorno, PATH y alias', summary: 'Variables de entorno y personalización de la shell', emoji: '🌿', commands: ['export', 'env', 'alias'], minutes: 8 }, [
      learn('Variables de entorno', `
Algunas variables las heredan **los programas que lanzas**. Se llaman **variables de entorno** y se crean con **\`export\`**:

\`\`\`bash
nombre="Ana"             # variable de shell (solo esta shell)
export idioma="es"       # variable de ENTORNO (la heredan los hijos)
bash -c 'echo $idioma'   # → es
bash -c 'echo $nombre'   # → (vacío)
\`\`\`

Las más importantes:

| Variable | Contenido |
|---|---|
| \`HOME\` | Tu carpeta personal |
| \`USER\` | Tu usuario |
| \`PATH\` | Carpetas donde se buscan los **comandos** |
| \`PWD\` | Directorio actual |
| \`SHELL\` | Tu shell |

\`env\` o \`printenv\` las lista.
`, '🌿'),
      illus('env-inherit', 'La herencia del entorno', 'Los procesos hijos reciben una copia de las variables exportadas.'),
      learn('PATH y alias', `
**PATH** es una lista de carpetas separadas por \`:\`. Cuando escribes \`ls\`, la shell la recorre buscando un ejecutable con ese nombre.

\`\`\`
echo $PATH                           # ver
export PATH="$PATH:$HOME/bin"        # añadir ~/bin al final
\`\`\`

Un **alias** es un atajo para un comando:

\`\`\`
alias ll='ls -la'
alias gs='git status'
\`\`\`

> CLAVE: Los cambios hechos en la terminal **se pierden al cerrarla**. Para que sean permanentes, añádelos a **\`~/.bashrc\`** (se ejecuta al abrir cada terminal). Tras editarlo: \`source ~/.bashrc\`.
`),
      demo('Entorno y alias', [
        ['echo $HOME $USER', 'Variables del sistema'],
        ['idioma=es; export saludo=hola', 'Una local y una exportada'],
        ['bash -c \'echo "idioma=[$idioma] saludo=[$saludo]"\'', 'El hijo solo ve la exportada'],
        ['alias ll="ls -la"', 'Un alias'],
        ['ll /home/alumno | head -n 3', 'Funciona'],
        ['export PATH="$PATH:$HOME/bin"; echo $PATH', 'Añade ~/bin al PATH'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué diferencia hay entre `x=5` y `export x=5`?', ['Ninguna', 'Con export, los programas que lances heredan la variable', 'Con export la variable se guarda en disco', 'export solo funciona con números'], 1, 'Sin `export`, la variable es solo de tu shell; con `export` pasa a los procesos hijos.'),
      mc('Quieres que un alias esté disponible **cada vez que abras la terminal**. ¿Dónde lo defines?', ['En /etc/hosts', 'En ~/.bashrc', 'En /tmp', 'En ~/.ssh/config'], 1, '`~/.bashrc` se ejecuta al abrir cada shell interactiva.'),
      practice({
        goal: 'Exporta una variable',
        prompt: 'Crea la variable de entorno **MIVAR** con valor **hola** y comprueba que un proceso hijo la ve: `bash -c \'echo $MIVAR\'`.',
        check: all(envIs('MIVAR', 'hola'), ran("bash -c"), outEq('hola')),
        solution: ['export MIVAR=hola', "bash -c 'echo $MIVAR'"],
        hints: ['`export NOMBRE=valor` y después una shell hija.', "`export MIVAR=hola` y `bash -c 'echo $MIVAR'`"],
        explain: 'Sin `export` el hijo imprimiría una línea vacía.',
        par: 2,
        commands: ['export', 'bash'],
      }),
      practice({
        goal: 'Crea un alias',
        prompt: 'Crea el alias **ll** para `ls -la`.',
        check: aliasIs('ll', 'ls -la'),
        solution: ["alias ll='ls -la'"],
        hints: ['`alias nombre="comando"`', "`alias ll='ls -la'`"],
        explain: 'Los alias ahorran miles de pulsaciones. Se pierden al cerrar la terminal salvo que los pongas en `~/.bashrc`.',
        par: 1,
        commands: ['alias'],
      }),
      practice({
        goal: 'Añade ~/bin al PATH',
        prompt: 'Añade **$HOME/bin** al final del `PATH` y muéstralo con `echo $PATH` (debe contener `/home/alumno/bin`).',
        check: all(ran('PATH='), out('/home/alumno/bin')),
        solution: ['export PATH="$PATH:$HOME/bin"', 'echo $PATH'],
        hints: ['Conserva el PATH anterior y añade la nueva carpeta tras `:`.', '`export PATH="$PATH:$HOME/bin"`'],
        explain: 'Con `~/bin` en el PATH, cualquier script ejecutable que guardes allí se lanza escribiendo solo su nombre.',
        par: 2,
        commands: ['export'],
      }),
      practice({
        goal: 'Hazlo permanente',
        prompt: 'Haz **permanente** el alias `ll` añadiendo la línea `alias ll=\'ls -la\'` **al final de `~/.bashrc`** (con `>>`).',
        check: content('/home/alumno/.bashrc', { includes: "alias ll='ls -la'" }),
        solution: ['echo "alias ll=\'ls -la\'" >> ~/.bashrc'],
        hints: ['Con `>>` añades sin borrar lo que ya hay.', '`echo "alias ll=\'ls -la\'" >> ~/.bashrc`'],
        explain: 'En la próxima terminal el alias estará disponible solo. Para usarlo ahora mismo: `source ~/.bashrc`.',
        par: 1,
        commands: ['echo'],
      }),
      fill('Completa: lista las variables de entorno', '___', ['env', 'set -x', 'export -n', 'echo'], ['env'], '`env` (o `printenv`) imprime el entorno.'),
    ]),
  ],
  boss: {
    goal: 'Misión: tu script de backup',
    prompt:
      '**Misión del dojo** 🥋\n\nEscribe el script **backup.sh** que reciba un nombre de carpeta como argumento (`$1`) y:\n\n- cree **backup-$1.tar.gz** con esa carpeta,\n- imprima **Backup de $1 listo**.\n\nHazlo ejecutable y lánzalo con `./backup.sh proyecto`.',
    setup: { cwd: '/home/alumno', files: { '/home/alumno/proyecto/a.txt': 'a\n', '/home/alumno/proyecto/b.txt': 'b\n' } },
    check: all(
      mode('/home/alumno/backup.sh', '755'),
      exists('/home/alumno/backup-proyecto.tar.gz', 'file'),
      ran('^\\./backup\\.sh proyecto$'),
      out('Backup de proyecto listo'),
    ),
    solution: [
      'printf \'#!/bin/bash\\ntar -czf "backup-$1.tar.gz" "$1"\\necho "Backup de $1 listo"\\n\' > backup.sh',
      'chmod +x backup.sh',
      './backup.sh proyecto',
    ],
    hints: ['El script necesita shebang, un `tar -czf "backup-$1.tar.gz" "$1"` y un `echo`.', 'Créalo con `nano backup.sh` o `printf`.', '`chmod +x backup.sh` y `./backup.sh proyecto`.'],
    explain: '¡Zona 10 completada! Acabas de automatizar una tarea real. Todo administrador escribe cientos de scripts como este.',
    par: 3,
    commands: ['bash', 'tar', 'chmod'],
  },
});

