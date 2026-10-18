import { all, any, cwd, exitCode, out, ran, used, outEq, outRe } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, predict, tf, typeCmd, world } from '../build';

export const w1 = world({
  id: 'w1',
  index: 1,
  title: 'Primeros pasos',
  subtitle: 'Tu primera conversación con Linux',
  emoji: '🌱',
  color: '#22D3A6',
  level: 'basico',
  intro:
    'Bienvenido al dojo. Aquí aprenderás a hablarle a tu computadora con texto: sin ratón, sin menús, con la precisión de un comando bien escrito.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w1-1', { title: '¿Qué es la terminal?', summary: 'Linux, shell, terminal y tu primer comando', emoji: '💬', commands: ['whoami', 'hostname', 'date', 'echo', 'uname'], minutes: 6 }, [
      learn('Hablar con tu computadora', `
Casi todo lo que haces con el ratón, también se puede hacer **escribiendo órdenes**. Esas órdenes se llaman **comandos**, y el lugar donde las escribes es la **terminal**.

¿Por qué molestarse?

- **Velocidad**: renombrar 500 archivos son 10 segundos, no 10 minutos.
- **Servidores**: casi todo internet corre en Linux y se administra por terminal.
- **Automatización**: un comando se puede repetir, guardar y programar.

> CLAVE: Un comando es una frase corta: _qué hacer_ + _opciones_ + _sobre qué_. Por ejemplo: \`ls -l /etc\`.
`, '💬'),
      illus('shell-vs-kernel', 'Las capas de Linux', 'Tú escribes en la terminal; la shell interpreta; el kernel habla con el hardware.'),
      learn('Terminal, shell, kernel: ¿quién es quién?', `
- **Kernel** (Linux): el núcleo. Controla CPU, memoria y discos.
- **Shell** (por ejemplo **bash**): el programa que _entiende_ lo que escribes y lo ejecuta.
- **Terminal**: la ventana donde escribes. Es solo la pantalla y el teclado.
- **Distribución** (Ubuntu, Debian, Fedora…): Linux + programas + instalador, empaquetados.

> NOTA: En este simulador estás usando **bash** sobre un Ubuntu ficticio llamado _dojo_. Todo lo que aprendas funciona igual en un Linux real.
`),
      illus('terminal-anatomy', 'Anatomía del prompt', 'El prompt te dice quién eres, en qué equipo estás y dónde.'),
      mc('En `alumno@dojo:~$`, ¿qué significa la parte `dojo`?', ['El usuario conectado', 'El nombre del equipo (hostname)', 'La carpeta actual', 'La versión de Linux'], 1, 'El formato es `usuario@equipo:carpeta$`. Aquí: usuario `alumno`, equipo `dojo`, carpeta `~` (tu carpeta personal).'),
      demo('Tus primeros comandos', [
        ['whoami', 'Dice quién eres'],
        ['hostname', 'Nombre de este equipo'],
        ['date', 'Fecha y hora actuales'],
        ['echo "Hola, Linux"', 'echo repite lo que le des'],
        ['uname -s', 'Nombre del sistema operativo'],
      ]),
      tf('La terminal y la shell son exactamente lo mismo.', false, 'La terminal es la ventana; la shell (bash) es el programa que interpreta tus comandos dentro de ella.'),
      match('Une cada comando con lo que hace', [['whoami', 'Muestra tu nombre de usuario'], ['hostname', 'Muestra el nombre del equipo'], ['date', 'Muestra fecha y hora'], ['echo', 'Imprime un texto']], 'Cada comando hace una sola cosa. Combinarlos es lo que lo hace poderoso.'),
      practice({
        goal: 'Averigua quién eres',
        prompt: 'Escribe el comando que muestra **tu nombre de usuario** y pulsa Enter.',
        check: all(used('whoami'), out('alumno')),
        solution: ['whoami'],
        hints: ['El nombre del comando es una pregunta en inglés: _who am I_… todo junto.', 'Prueba: `whoami`'],
        explain: '`whoami` = "who am I" (¿quién soy?). Es el comando más corto para comprobar con qué usuario estás trabajando.',
        par: 1,
        commands: ['whoami'],
      }),
      practice({
        goal: 'Haz que la terminal diga "Hola Linux"',
        prompt: 'Usa `echo` para imprimir el texto **Hola Linux**. Recuerda poner el texto entre comillas.',
        check: all(used('echo'), outEq('Hola Linux')),
        solution: ['echo "Hola Linux"'],
        hints: ['`echo` repite el texto que le pases.', 'Las comillas agrupan las palabras: `echo "Hola Linux"`'],
        explain: '`echo` imprime sus argumentos. Las comillas aseguran que todo el texto se trate como una sola frase.',
        par: 1,
        commands: ['echo'],
      }),
      order('Ordena para imprimir **Hola**', ['"Hola"', 'echo'], 'echo "Hola"', 'Primero va el comando (`echo`) y después sus argumentos.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w1-2', { title: 'Dónde estoy: pwd y ls', summary: 'Ubícate en el árbol de carpetas y mira qué hay', emoji: '📍', commands: ['pwd', 'ls'], minutes: 7 }, [
      learn('Todo cuelga de una raíz', `
En Linux no hay unidades \`C:\` o \`D:\`. Todo vive en **un único árbol** que empieza en la **raíz**, escrita \`/\`.

Cuando abres la terminal estás _dentro_ de alguna carpeta: tu **directorio actual**. Al empezar es tu **carpeta personal** (home), que se abrevia \`~\`.

- \`pwd\` → _print working directory_: ¿en qué carpeta estoy?
- \`ls\` → _list_: ¿qué hay aquí dentro?
`, '📍'),
      illus('fs-tree', 'El árbol de Linux', 'Toca una carpeta para ver qué guarda.'),
      demo('Mira a tu alrededor', [
        ['pwd', 'Estás en /home/alumno: tu casa'],
        ['ls', 'Contenido de la carpeta actual'],
        ['ls -l', 'Formato largo: una línea por elemento, con detalles'],
        ['ls -a', 'Incluye los archivos ocultos (empiezan por punto)'],
        ['ls /', 'También puedes listar otra ruta sin moverte'],
      ]),
      learn('Opciones: modificar un comando', `
Muchos comandos aceptan **opciones** (también llamadas _flags_) que empiezan con \`-\`. Cambian cómo se comporta.

| Comando | Qué hace |
|---|---|
| \`ls\` | Lista en columnas |
| \`ls -l\` | Una línea por archivo, con detalles |
| \`ls -a\` | Incluye ocultos (\`.bashrc\`…) |
| \`ls -la\` | Ambas a la vez |
| \`ls -lh\` | Tamaños legibles (1K, 2M) |

> TIP: Las opciones cortas se pueden juntar: \`ls -l -a -h\` es lo mismo que \`ls -lah\`.
`),
      predict('¿Qué muestra `pwd` recién abierta la terminal?', 'pwd', ['/', '/root', '~'], 'La carpeta personal de `alumno` es `/home/alumno`. El `~` es solo una abreviatura que entiende la shell.'),
      mc('¿Qué archivos añade la opción `-a` de `ls`?', ['Los más grandes', 'Los ocultos (que empiezan por .)', 'Los recién modificados', 'Los ejecutables'], 1, 'En Linux un archivo es "oculto" simplemente si su nombre empieza por un punto. `ls -a` (_all_) los muestra.'),
      practice({
        goal: 'Encuentra los archivos ocultos de tu home',
        prompt: 'Lista el contenido de tu carpeta **incluyendo los archivos ocultos**. Deberías ver `.bashrc` y `.profile`.',
        check: all(used('ls', ['-a']), out('.bashrc')),
        solution: ['ls -a'],
        hints: ['Necesitas la opción de "all" (todos).', '`ls -a` o `ls -la`'],
        explain: '`ls -a` muestra todo, incluidos `.` (esta carpeta) y `..` (la carpeta padre). `.bashrc` es el archivo de configuración de tu shell.',
        par: 1,
        commands: ['ls'],
      }),
      practice({
        goal: 'Mira dentro de /etc sin moverte',
        prompt: 'Muestra el contenido de la carpeta **/etc** (la de configuración del sistema) **sin cambiar de carpeta**. Debe aparecer `passwd` en la lista.',
        check: all(ran('ls .*/etc'), out('passwd')),
        solution: ['ls /etc'],
        hints: ['`ls` acepta una ruta como argumento.', '`ls /etc`'],
        explain: 'Puedes pasarle una ruta a `ls` para listar cualquier carpeta sin moverte de donde estás.',
        par: 1,
        commands: ['ls'],
      }),
      typeCmd('Escribe el comando para ver **dónde estás**', ['pwd'], '`pwd` significa _print working directory_.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w1-3', { title: 'Moverse: cd y rutas', summary: 'Rutas absolutas, relativas y atajos . .. ~ -', emoji: '🧭', commands: ['cd'], minutes: 8 }, [
      learn('cd: cambiar de carpeta', `
\`cd\` (_change directory_) te mueve por el árbol. Necesita saber **a dónde**: una **ruta**.

Hay dos tipos de ruta:

- **Absoluta**: empieza por \`/\` y funciona desde cualquier sitio. Ej: \`/var/log\`.
- **Relativa**: no empieza por \`/\` y se cuenta desde donde estás. Ej: \`Documents\`.
`, '🧭'),
      illus('path-walk', 'Caminando por el árbol', 'Observa cómo cambia la ruta con cada cd.'),
      learn('Cuatro atajos que usarás todos los días', `
| Atajo | Significa |
|---|---|
| \`.\` | La carpeta actual |
| \`..\` | La carpeta padre (un nivel arriba) |
| \`~\` | Tu carpeta personal |
| \`-\` | La carpeta donde estabas antes |

\`cd\` a secas también te lleva a casa.

> TIP: Pulsa **Tab** para autocompletar nombres de carpetas y archivos. Escribe \`cd Doc\` + Tab → \`cd Documents/\`.
`),
      demo('Un paseo', [
        ['cd /var/log', 'Ruta absoluta'],
        ['pwd', 'Comprueba dónde estás'],
        ['cd ..', 'Sube un nivel'],
        ['pwd'],
        ['cd ~', 'Vuelve a casa'],
        ['cd Documents', 'Ruta relativa (desde casa)'],
        ['cd -', 'Vuelve a donde estabas'],
      ]),
      fill('Completa para subir un nivel', 'cd ___', ['..', '.', '~', '/'], ['..'], '`..` es la carpeta padre. `.` es la carpeta actual y `~` tu casa.'),
      predict('Estás en `/home/alumno/Documents`. ¿Qué muestra `cd .. && pwd`?', 'cd Documents && cd .. && pwd', ['/home/alumno/Documents', '/home', '/'], 'Subir un nivel desde Documents te deja en `/home/alumno`.'),
      practice({
        goal: 'Ve a /var/log',
        prompt: 'Muévete a la carpeta **/var/log** usando una ruta absoluta.',
        check: cwd('/var/log'),
        solution: ['cd /var/log'],
        hints: ['Escribe `cd` y la ruta completa.', '`cd /var/log`'],
        explain: 'Una ruta absoluta siempre empieza por `/` y no depende de dónde estés.',
        par: 1,
        commands: ['cd'],
      }),
      practice({
        goal: 'De Documents a Pictures con una ruta relativa',
        prompt: 'Estás dentro de **Documents**. Ve a la carpeta **Pictures**, que está al lado, usando una ruta relativa con `..`.',
        setup: { cwd: '/home/alumno/Documents' },
        check: cwd('/home/alumno/Pictures'),
        solution: ['cd ../Pictures'],
        hints: ['Primero hay que subir un nivel y luego bajar a Pictures.', '`cd ../Pictures`'],
        explain: '`..` sube un nivel; luego `/Pictures` baja a la hermana. Así te mueves entre carpetas vecinas sin escribir rutas largas.',
        par: 1,
        commands: ['cd'],
      }),
      practice({
        goal: 'Vuelve a casa',
        prompt: 'Estás en **/tmp**. Vuelve a tu carpeta personal con el comando **más corto posible**.',
        setup: { cwd: '/tmp' },
        check: cwd('/home/alumno'),
        solution: ['cd'],
        hints: ['No necesitas escribir ninguna ruta.', '`cd` sin argumentos'],
        explain: '`cd` sin argumentos (o `cd ~`) te lleva siempre a tu home.',
        par: 1,
        commands: ['cd'],
      }),
      mc('¿Cuál de estas es una ruta **absoluta**?', ['Documents/notas.txt', '../Pictures', '/etc/hosts', './script.sh'], 2, 'Las rutas absolutas empiezan por `/`. Las demás dependen del directorio actual.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w1-4', { title: 'Ayuda y atajos', summary: 'man, --help, Tab, historial y teclas mágicas', emoji: '🆘', commands: ['man', 'whatis', 'history', 'clear'], minutes: 7 }, [
      learn('Nadie se sabe todos los comandos', `
Ni los expertos. La habilidad real es **saber pedir ayuda**. Linux trae el manual dentro:

- \`man comando\` → el manual completo (se sale con **q**).
- \`comando --help\` → resumen rápido de opciones.
- \`whatis comando\` → descripción de una línea.
- \`type comando\` / \`which comando\` → de dónde sale.

> TIP: En un manual, usa **/palabra** para buscar y **n** para ir a la siguiente coincidencia.
`, '🆘'),
      demo('Pide ayuda', [
        ['whatis ls', 'Una línea que resume el comando'],
        ['ls --help | head -n 6', 'Resumen de opciones (recortado)'],
        ['type cd', 'cd no es un programa: viene dentro de la shell'],
        ['which ls', 'La ruta del ejecutable'],
      ]),
      learn('Atajos de teclado: ahorra miles de pulsaciones', `
| Tecla | Efecto |
|---|---|
| **Tab** | Autocompleta comandos y rutas |
| **↑ / ↓** | Recorre el historial |
| **Ctrl + C** | Cancela el comando en curso |
| **Ctrl + L** | Limpia la pantalla (como \`clear\`) |
| **Ctrl + A / E** | Principio / final de la línea |
| **Ctrl + R** | Busca en el historial |
| **Ctrl + D** | Fin de entrada / cerrar sesión |

Y dos comandos para el historial: \`history\` (lista) y \`!!\` (repite el último).

> OJO: **Ctrl + C** no copia en la terminal: _interrumpe_. Es tu botón de pánico cuando un comando se queda colgado.
`),
      mc('Un comando se queda ejecutándose y no devuelve el control. ¿Qué haces?', ['Cierras el ordenador', 'Pulsas Ctrl + C', 'Escribes exit', 'Pulsas Tab'], 1, 'Ctrl + C envía la señal de interrupción (SIGINT) al comando que está en primer plano.'),
      match('Une la tecla con su efecto', [['Tab', 'Autocompletar'], ['↑', 'Comando anterior'], ['Ctrl + C', 'Cancelar el comando'], ['Ctrl + L', 'Limpiar pantalla']], 'Con estos cuatro ya trabajas el doble de rápido.'),
      practice({
        goal: 'Descubre qué hace wc',
        prompt: 'Usa **cualquier** forma de ayuda para ver qué hace el comando `wc` (por ejemplo `whatis`, `man` o `--help`).',
        check: any(used('whatis'), used('man'), ran('wc --help')),
        solution: ['whatis wc'],
        hints: ['Hay tres formas: `whatis`, `man` o `--help`.', '`whatis wc`'],
        explain: '`wc` = _word count_: cuenta líneas, palabras y bytes. Acostúmbrate a consultar `whatis`/`man` ante cualquier comando desconocido.',
        par: 1,
        commands: ['whatis', 'man'],
      }),
      practice({
        goal: 'Repite un comando con !!',
        prompt: 'Escribe `echo hola` y después **repítelo** escribiendo solo `!!`. (Debe haberse ejecutado `echo hola` dos veces.)',
        check: ran('^echo hola$', 2),
        solution: ['echo hola', '!!'],
        hints: ['Primero ejecuta `echo hola`.', 'Luego escribe `!!` y Enter. La shell mostrará el comando que repite.'],
        explain: '`!!` se sustituye por tu último comando. Es genial junto con sudo: `sudo !!` repite el anterior como administrador.',
        par: 2,
        commands: ['history'],
      }),
      practice({
        goal: 'Cancela un comando con Ctrl + C',
        prompt: 'Ejecuta `sleep 100` (espera 100 segundos) y **cancélalo** con **Ctrl + C** (botón ⌃C del teclado de la app).',
        check: all(ran('^sleep 100$'), exitCode(130)),
        solution: ['sleep 100', '^C'],
        hints: ['Escribe `sleep 100` y Enter; la terminal se queda "pensando".', 'Pulsa el botón Ctrl+C del teclado.'],
        explain: 'Un comando cancelado con Ctrl+C termina con código 130 (128 + señal 2). Aprender a salir de un comando colgado es una habilidad básica.',
        par: 1,
        commands: ['sleep'],
      }),
      fill('Completa: el comando que muestra el manual de ls', '___ ls', ['man', 'help', 'info', 'cat'], ['man'], '`man` abre el manual de cualquier comando: `man ls`. Pulsa q para salir.'),
    ]),
  ],
  boss: {
    goal: 'Misión: explora y regresa a casa',
    prompt: '**Misión del dojo** 🥋\n\n1. Ve a la carpeta `/var/log`.\n2. Lista su contenido en formato largo (`-l`).\n3. Regresa a tu carpeta personal.\n\nTodo en la misma sesión.',
    check: all(cwd('/home/alumno'), ran('^cd /var/log'), used('ls', ['-l'])),
    solution: ['cd /var/log', 'ls -l', 'cd'],
    hints: ['Empieza con `cd /var/log`.', 'Luego `ls -l`. Para volver a casa basta `cd`.'],
    explain: '¡Primera zona completada! Ya sabes moverte, mirar y pedir ayuda. Siguiente parada: crear y manipular archivos.',
    par: 3,
    commands: ['cd', 'ls'],
  },
});

export { outRe };
