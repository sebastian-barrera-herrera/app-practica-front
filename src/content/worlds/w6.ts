import { all, any, jobState, not, out, outRe, procRunning, ran, service, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, tf, typeCmd, world } from '../build';

const HOG: [string, string, number, number][] = [['alumno', 'python3 /opt/miner.py', 99, 8]];

export const w6 = world({
  id: 'w6',
  index: 6,
  title: 'Procesos y sistema',
  subtitle: 'Qué corre, cuánto consume y cómo controlarlo',
  emoji: '⚙️',
  color: '#A78BFA',
  level: 'intermedio',
  intro:
    'Cada programa en marcha es un **proceso**. Un administrador necesita saber qué corre, quién consume la CPU, cómo detener algo que se ha quedado colgado y cómo gestionar los servicios del sistema. Esta zona te da esos controles.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w6-1', { title: 'Ver procesos', summary: 'ps, top, pgrep y el PID', emoji: '📋', commands: ['ps', 'top', 'pgrep', 'pidof'], minutes: 8 }, [
      learn('Un proceso es un programa en ejecución', `
Cada vez que lanzas un programa, Linux crea un **proceso** con:

- un **PID** (_process id_): su número único.
- un **PPID**: el PID de su proceso padre (quién lo lanzó).
- un **usuario** dueño y un **estado**.

\`\`\`
ps          # solo tus procesos de esta terminal
ps aux      # TODOS los procesos del sistema, con CPU y memoria
ps -ef      # otro formato clásico (UID, PID, PPID…)
top         # vista en vivo (q para salir)
pgrep ssh   # PIDs cuyo nombre coincide
\`\`\`

> TIP: \`ps aux | grep nombre\` es el gesto más común para ver si algo está corriendo.
`, '📋'),
      illus('process-states', 'Vida de un proceso', 'Un proceso pasa por varios estados mientras trabaja.'),
      demo('Mirando el sistema', [
        ['ps', 'Solo lo de esta terminal'],
        ['ps aux | head -n 5', 'Todo el sistema (recortado)'],
        ['ps aux | grep sshd', 'Filtra por nombre'],
        ['pgrep -a cron', 'PID y comando de cron'],
        ['pidof sshd', 'Los PIDs de sshd'],
        ['ps aux --sort=-%cpu | head -n 3', 'Los 3 que más CPU consumen'],
      ], { cwd: '/home/alumno', procs: HOG }),
      learn('Columnas de ps aux', `
| Columna | Significa |
|---|---|
| **USER** | Quién lo ejecuta |
| **PID** | Identificador del proceso |
| **%CPU / %MEM** | Uso de procesador y memoria |
| **STAT** | Estado: **S** durmiendo, **R** ejecutándose, **T** detenido, **Z** zombi |
| **COMMAND** | El comando que lo lanzó |
`),
      mc('¿Qué significa un PID?', ['Programa Interno de Datos', 'El número único que identifica un proceso', 'La prioridad del proceso', 'El puerto que usa'], 1, 'PID = _process identifier_. Con él puedes referirte a un proceso concreto (por ejemplo para pararlo).'),
      practice({
        goal: '¿Quién devora la CPU?',
        prompt: 'El servidor va lento. Muestra los procesos **ordenados por uso de CPU** (de mayor a menor) y quédate con los primeros. Debe aparecer `miner.py`.',
        setup: { procs: HOG },
        check: all(used('ps'), out('miner.py'), ran('sort=-%cpu|sort -')),
        solution: ['ps aux --sort=-%cpu | head -n 3'],
        hints: ['`ps aux` admite `--sort=` y el signo `-` invierte el orden.', '`ps aux --sort=-%cpu | head -n 3`'],
        explain: 'Ordenar por CPU o memoria es lo primero que haces ante una lentitud: el culpable suele estar arriba.',
        par: 1,
        commands: ['ps'],
      }),
      practice({
        goal: 'Busca un proceso por nombre',
        prompt: 'Comprueba si hay algún proceso de **sshd** en marcha filtrando la salida de `ps aux`.',
        check: all(ran('ps aux.*\\|.*grep'), out('sshd')),
        solution: ['ps aux | grep sshd'],
        hints: ['Lista todo con `ps aux` y filtra con grep.', '`ps aux | grep sshd`'],
        explain: 'Combinar `ps aux` y `grep` es un clásico. Alternativa más limpia: `pgrep -a sshd`.',
        par: 1,
        commands: ['ps', 'grep'],
      }),
      practice({
        goal: 'El PID de cron',
        prompt: 'Averigua el **PID** del servicio `cron` usando `pgrep` (o `pidof`).',
        check: all(any(used('pgrep'), used('pidof')), outRe('^\\d+')),
        solution: ['pgrep cron'],
        hints: ['`pgrep` busca procesos por nombre y devuelve su PID.', '`pgrep cron`'],
        explain: '`pgrep` devuelve solo el PID, perfecto para combinarlo con `kill`: `kill $(pgrep nombre)`.',
        par: 1,
        commands: ['pgrep'],
      }),
      match('Une el estado con su significado', [['S', 'Durmiendo (esperando algo)'], ['R', 'Ejecutándose'], ['T', 'Detenido'], ['Z', 'Zombi (terminó pero su padre no lo recogió)']], 'En `ps aux` verás estas letras en la columna STAT.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w6-2', { title: 'Señales: kill', summary: 'Detén procesos con elegancia (o a la fuerza)', emoji: '🔪', commands: ['kill', 'pkill', 'killall'], minutes: 8 }, [
      learn('kill no mata: envía señales', `
\`kill\` envía una **señal** a un proceso. Cada proceso decide cómo reaccionar:

| Señal | Nº | Efecto |
|---|---|---|
| **SIGTERM** | 15 | "Por favor, termina" (la **predeterminada**) |
| **SIGINT** | 2 | Lo que envía **Ctrl + C** |
| **SIGKILL** | 9 | Muerte inmediata; **no se puede ignorar** |
| **SIGHUP** | 1 | "Recarga tu configuración" (muchos demonios) |
| **SIGSTOP / SIGCONT** | 19 / 18 | Pausar / reanudar |

\`\`\`
kill 1234          # SIGTERM al PID 1234 (educado)
kill -9 1234       # SIGKILL (último recurso)
pkill -f miner.py  # por nombre / línea de comando
killall sleep      # todos los procesos llamados sleep
\`\`\`

> CLAVE: Prueba **primero** con SIGTERM: deja que el programa cierre archivos y limpie. Usa \`-9\` solo si no responde.
`, '🔪'),
      illus('signals', 'Señales en acción', 'Un proceso puede atrapar SIGTERM… pero no SIGKILL.'),
      demo('Parando procesos', [
        ['pgrep -a sleep', 'Localiza el proceso'],
        ['kill $(pgrep sleep)', '$(…) inserta el PID encontrado'],
        ['pgrep sleep', 'Ya no está (sin salida)'],
        ['pgrep -a miner', 'Otro proceso, ahora por nombre'],
        ['pkill -f miner.py', 'pkill lo busca y lo termina'],
        ['pgrep -a miner', 'Desapareció'],
      ], { cwd: '/home/alumno', procs: [['alumno', 'sleep 1000', 0, 0.1], ...HOG] }),
      mc('¿Qué señal envía `kill 1234` si no indicas ninguna?', ['SIGKILL (9)', 'SIGTERM (15)', 'SIGINT (2)', 'SIGSTOP (19)'], 1, 'La señal por defecto es SIGTERM: una petición educada de terminar.'),
      mc('¿Por qué `kill -9` se considera un último recurso?', ['Es más lento', 'El proceso no puede limpiar ni guardar nada antes de morir', 'Solo funciona con root', 'No existe en todos los sistemas'], 1, 'SIGKILL lo mata el kernel directamente: no hay cierre limpio, puede dejar archivos temporales o datos a medias.'),
      practice({
        goal: 'Para el proceso colgado',
        prompt: 'Hay un proceso `sleep 1000` consumiendo recursos. **Termínalo** localizando su PID con `pgrep` y usando `kill` (puedes anidarlos con `$(…)`).',
        setup: { procs: [['alumno', 'sleep 1000', 0, 0.1]] },
        check: all(ran('kill'), procRunning('sleep 1000', false)),
        solution: ['kill $(pgrep sleep)'],
        hints: ['`pgrep sleep` te da el PID; `kill` lo recibe.', '`kill $(pgrep sleep)`'],
        explain: '`$(comando)` sustituye el resultado: así encadenas "encuentra el PID" y "mátalo" sin copiar números.',
        par: 1,
        commands: ['kill', 'pgrep'],
      }),
      practice({
        goal: 'Mata el minero',
        prompt: 'Un proceso `python3 /opt/miner.py` se come la CPU. Elimínalo **por nombre** (sin buscar su PID) con `pkill`.',
        setup: { procs: HOG },
        check: all(used('pkill'), procRunning('miner.py', false)),
        solution: ['pkill -f miner.py'],
        hints: ['`pkill` acepta un patrón; `-f` busca en toda la línea de comando.', '`pkill -f miner.py`'],
        explain: '`pkill -f` es ideal para scripts, porque `miner.py` no es el nombre del programa (que es `python3`).',
        par: 1,
        commands: ['pkill'],
      }),
      practice({
        goal: 'Todos los sleep',
        prompt: 'Hay **varios** procesos `sleep`. Termínalos todos con **un solo comando** `killall`.',
        setup: { procs: [['alumno', 'sleep 1000', 0, 0.1], ['alumno', 'sleep 2000', 0, 0.1], ['alumno', 'sleep 3000', 0, 0.1]] },
        check: all(used('killall'), procRunning('^sleep', false)),
        solution: ['killall sleep'],
        hints: ['`killall` mata por nombre exacto.', '`killall sleep`'],
        explain: '`killall nombre` envía la señal a todos los procesos con ese nombre. Cuidado: en Solaris hace algo muy distinto 😅.',
        par: 1,
        commands: ['killall'],
      }),
      fill('Completa para forzar la muerte del PID 4321', 'kill ___ 4321', ['-9', '-1', '-l', '-0'], ['-9'], '`-9` equivale a `-SIGKILL`.'),
      tf('Ctrl + C envía SIGKILL al proceso en primer plano.', false, 'Ctrl + C envía **SIGINT** (señal 2), que el programa puede atrapar para cerrar limpiamente.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w6-3', { title: 'Segundo plano y trabajos', summary: '&, jobs, fg, bg y Ctrl + Z', emoji: '🎛️', commands: ['jobs', 'fg', 'bg', 'sleep', 'nohup'], minutes: 8 }, [
      learn('No bloquees tu terminal', `
Un comando largo bloquea la terminal hasta que termina. Puedes mandarlo al **segundo plano** y seguir trabajando:

| Acción | Cómo |
|---|---|
| Lanzar directamente en segundo plano | \`comando &\` |
| Pausar el que está en primer plano | **Ctrl + Z** (queda _Stopped_) |
| Ver los trabajos de esta terminal | \`jobs\` |
| Traer un trabajo al primer plano | \`fg %1\` |
| Reanudar un trabajo pausado en segundo plano | \`bg %1\` |
| Terminar un trabajo | \`kill %1\` |

\`%1\` es el **número de trabajo** (distinto del PID) que ves en \`jobs\`.

> OJO: Si cierras la terminal, los trabajos en segundo plano **mueren** con ella. Para que sobrevivan: \`nohup comando &\`.
`, '🎛️'),
      demo('Malabarismo', [
        ['sleep 300 &', 'Se lanza en segundo plano: [1] y su PID'],
        ['sleep 400 &', 'Otro trabajo: [2]'],
        ['jobs', 'Lista de trabajos'],
        ['kill %1', 'Terminamos el trabajo 1'],
        ['jobs', 'Solo queda el 2'],
        ['kill %2', 'Y el 2'],
      ], { cwd: '/home/alumno' }),
      mc('Estás ejecutando un comando en primer plano y quieres **pausarlo**. ¿Qué pulsas?', ['Ctrl + C', 'Ctrl + Z', 'Ctrl + D', 'Ctrl + L'], 1, 'Ctrl + Z envía SIGTSTP: el proceso se pausa y recuperas el prompt. Luego puedes reanudarlo con `fg` o `bg`.'),
      match('Une el comando con su efecto', [['cmd &', 'Lanzar en segundo plano'], ['jobs', 'Listar trabajos'], ['fg %1', 'Traer el trabajo 1 al primer plano'], ['bg %1', 'Reanudar el trabajo 1 en segundo plano']], 'Con estos cuatro dominas el control de trabajos.'),
      practice({
        goal: 'Lanza algo en segundo plano',
        prompt: 'Ejecuta `sleep 300` **en segundo plano** (terminando el comando con `&`) para que la terminal siga libre.',
        check: all(ran('^sleep 300 &$'), jobState('running')),
        solution: ['sleep 300 &'],
        hints: ['Añade un símbolo al final del comando.', '`sleep 300 &`'],
        explain: '`&` devuelve el control al instante. Verás `[1] 2345`: número de trabajo y PID.',
        par: 1,
        commands: ['sleep'],
      }),
      practice({
        goal: 'Pausa con Ctrl + Z',
        prompt: 'Ejecuta `sleep 300` y **páusalo** con **Ctrl + Z** (botón ⌃Z del teclado de la app).',
        check: all(ran('^sleep 300$'), jobState('stopped')),
        solution: ['sleep 300', '^Z'],
        hints: ['Ejecuta el comando y, mientras espera, pulsa ⌃Z.', 'Después puedes comprobarlo con `jobs`.'],
        explain: 'Un trabajo pausado no consume CPU. Con `bg` seguirá en segundo plano; con `fg`, en primer plano.',
        par: 1,
        commands: ['sleep'],
      }),
      practice({
        goal: 'Pausa y reanuda en segundo plano',
        prompt: 'Ejecuta `sleep 300`, páusalo con **Ctrl + Z** y **reanúdalo en segundo plano** con `bg`.',
        check: all(ran('^bg'), jobState('running')),
        solution: ['sleep 300', '^Z', 'bg'],
        hints: ['Tres pasos: ejecutar, ⌃Z y `bg`.', 'Comprueba con `jobs`: debe poner _Running_.'],
        explain: 'Esta secuencia (**Ctrl + Z** y luego **bg**) es lo que haces cuando lanzas algo largo y olvidaste el `&`.',
        par: 2,
        commands: ['bg'],
      }),
      practice({
        goal: 'Cancela un trabajo por su número',
        prompt: 'Lanza `sleep 500 &` y después **termínalo** usando `kill %1`.',
        check: all(ran('^kill %1'), not(jobState('running'))),
        solution: ['sleep 500 &', 'kill %1'],
        hints: ['`%1` es el número de trabajo.', '`sleep 500 &` y luego `kill %1`'],
        explain: 'Con `%N` no necesitas buscar el PID: `kill %1`, `fg %2`, `bg %3`…',
        par: 2,
        commands: ['kill'],
      }),
      fill('Completa para traer el trabajo 2 al primer plano', '___ %2', ['fg', 'bg', 'jobs', 'wait'], ['fg'], '`fg` = foreground (primer plano).'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w6-4', { title: 'Recursos del sistema', summary: 'df, du, free, uptime y uname', emoji: '📊', commands: ['df', 'du', 'free', 'uptime', 'uname', 'nproc'], minutes: 8 }, [
      learn('El tablero de mandos', `
| Comando | Responde a… |
|---|---|
| \`df -h\` | ¿Cuánto **espacio libre** queda en cada disco? |
| \`du -sh carpeta\` | ¿Cuánto **ocupa** esta carpeta? |
| \`free -h\` | ¿Cuánta **memoria RAM** hay libre? |
| \`uptime\` | ¿Cuánto lleva **encendido** y qué carga tiene? |
| \`uname -a\` | ¿Qué **kernel** y sistema es? |
| \`nproc\` | ¿Cuántos **núcleos** de CPU hay? |

La opción **-h** (_human-readable_) muestra K, M, G en vez de bytes.

> TIP: \`du -sh * | sort -rh | head\` te dice qué carpetas ocupan más: el primer paso para liberar espacio.
`, '📊'),
      demo('Un vistazo al sistema', [
        ['df -h', 'Discos y espacio'],
        ['du -sh /home/alumno', 'Cuánto ocupa tu carpeta'],
        ['free -h', 'Memoria'],
        ['uptime', 'Tiempo encendido y carga'],
        ['uname -a', 'Datos del kernel'],
        ['nproc', 'Número de CPUs'],
      ], { cwd: '/home/alumno' }),
      mc('El disco se llena. ¿Qué comando te dice cuánto espacio **libre** queda en cada partición?', ['du -sh', 'df -h', 'free -h', 'ls -l'], 1, '`df` = _disk free_: espacio por sistema de archivos. `du` mide lo que ocupa una carpeta concreta.'),
      mc('¿Para qué sirve `-h` en `df -h`?', ['Para ocultar columnas', 'Para mostrar tamaños legibles (K, M, G)', 'Para pedir ayuda', 'Para listar discos ocultos'], 1, '`-h` = _human-readable_.'),
      practice({
        goal: 'Espacio en disco',
        prompt: 'Muestra el espacio de los discos en formato **legible**. Debe aparecer la partición raíz `/`.',
        check: all(used('df', ['-h']), out('/dev/vda1')),
        solution: ['df -h'],
        hints: ['_Disk free_, en modo humano.', '`df -h`'],
        explain: 'Fíjate en la columna **Use%** de `/`: si se acerca al 100 % hay que limpiar.',
        par: 1,
        commands: ['df'],
      }),
      practice({
        goal: '¿Cuánta RAM libre hay?',
        prompt: 'Muestra el uso de la **memoria** en formato legible.',
        check: all(used('free', ['-h']), out('Mem:')),
        solution: ['free -h'],
        hints: ['El nombre es muy directo: "libre".', '`free -h`'],
        explain: 'Mira la columna **available**: es la memoria realmente utilizable, incluida la caché que se puede liberar.',
        par: 1,
        commands: ['free'],
      }),
      practice({
        goal: 'Tamaño de una carpeta',
        prompt: 'Muestra, en un **resumen legible**, cuánto ocupa la carpeta **media** (`-s` resumen y `-h` legible).',
        setup: { files: { '/home/alumno/media/video.bin': { content: 'x', size: 5000000 } } },
        check: all(used('du', ['-s', '-h']), outRe('M\\s+media$')),
        solution: ['du -sh media'],
        hints: ['`du` + dos opciones juntas + la carpeta.', '`du -sh media`'],
        explain: '`-s` suma todo en una sola línea (sin ella `du` lista cada subcarpeta).',
        par: 1,
        commands: ['du'],
      }),
      practice({
        goal: 'La carpeta que más pesa',
        prompt: 'Averigua **cuál es la carpeta más grande** dentro de tu home: calcula el tamaño de cada elemento (`du -sh *`), ordénalos de mayor a menor (`sort -rh`) y muestra solo el primero. Debe ser **media**.',
        setup: { files: { '/home/alumno/media/b.bin': { content: 'x', size: 5000000 }, '/home/alumno/datos/a.bin': { content: 'x', size: 100000 } } },
        check: all(ran('du'), ran('sort'), outRe('media$')),
        solution: ['du -sh * | sort -rh | head -n 1'],
        hints: ['`sort -h` entiende sufijos K/M/G y `-r` invierte.', '`du -sh * | sort -rh | head -n 1`'],
        explain: 'Esta receta es oro: en 5 segundos sabes qué carpeta se come el disco.',
        par: 1,
        commands: ['du', 'sort'],
      }),
      typeCmd('Escribe el comando que muestra cuánto tiempo lleva encendido el sistema', ['uptime'], '`uptime` muestra la hora, el tiempo activo y la carga media.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w6-5', { title: 'Servicios con systemctl', summary: 'Arranca, para y habilita demonios', emoji: '🛎️', commands: ['systemctl', 'journalctl'], minutes: 9 }, [
      learn('Los servicios corren en segundo plano', `
Un **servicio** (o _demonio_) es un programa que arranca con el sistema y trabaja sin que lo veas: el servidor web, SSH, cron, el sistema de impresión…

En casi todas las distribuciones modernas los gestiona **systemd** mediante \`systemctl\`:

| Comando | Efecto |
|---|---|
| \`systemctl status ssh\` | Estado detallado |
| \`sudo systemctl start ssh\` | Arrancar ahora |
| \`sudo systemctl stop ssh\` | Parar ahora |
| \`sudo systemctl restart ssh\` | Parar y arrancar |
| \`sudo systemctl enable ssh\` | Que arranque **al iniciar** el sistema |
| \`sudo systemctl disable ssh\` | Que **no** arranque al iniciar |
| \`systemctl is-active ssh\` | Imprime active / inactive |
`, '🛎️'),
      illus('boot-sequence', 'Del botón de encendido al servicio', 'systemd arranca los servicios habilitados al final del arranque.'),
      learn('start no es enable', `
Son dos cosas **independientes**:

- **start / stop** → el estado **ahora**.
- **enable / disable** → si arranca **la próxima vez que se encienda**.

\`\`\`
sudo systemctl enable --now ssh     # habilita y arranca de una vez
sudo systemctl disable --now cups   # deshabilita y para de una vez
\`\`\`

Y para ver qué ha pasado, los **registros**:

\`\`\`
journalctl -u ssh -n 20    # últimas 20 líneas del servicio ssh
journalctl -p err          # solo errores
\`\`\`

> CLAVE: Un error muy típico: arrancas un servicio con \`start\`, funciona… y tras reiniciar el servidor no está. Te faltó \`enable\`.
`),
      demo('Gestionando un servicio', [
        ['systemctl status cups', 'Parado y deshabilitado'],
        ['sudo systemctl start cups', 'Lo arrancamos'],
        ['systemctl is-active cups', 'active'],
        ['sudo systemctl enable cups', 'Y que arranque siempre'],
        ['systemctl is-enabled cups', 'enabled'],
        ['journalctl -u ssh -n 3', 'Registros recientes de ssh'],
      ], { cwd: '/home/alumno' }),
      mc('Quieres que un servicio **arranque automáticamente** al encender el servidor. ¿Qué haces?', ['systemctl start', 'systemctl enable', 'systemctl restart', 'systemctl status'], 1, '`enable` crea el enlace de arranque. `start` solo lo arranca en este momento.'),
      tf('`systemctl restart` es lo mismo que `systemctl enable`.', false, '`restart` para y vuelve a arrancar ahora. `enable` configura el arranque automático futuro.'),
      practice({
        goal: 'Arranca el servicio de impresión',
        prompt: 'El servicio **cups** está parado. **Arráncalo** ahora.',
        check: service('cups', { state: 'active' }),
        solution: ['sudo systemctl start cups'],
        hints: ['Las acciones sobre servicios requieren privilegios.', '`sudo systemctl start cups`'],
        explain: 'Sin `sudo`, systemctl responde "Interactive authentication required".',
        par: 1,
        commands: ['systemctl'],
      }),
      practice({
        goal: 'Que arranque con el sistema',
        prompt: 'Haz que **cups** se inicie automáticamente al arrancar la máquina (está deshabilitado).',
        check: service('cups', { enabled: true }),
        solution: ['sudo systemctl enable cups'],
        hints: ['No es `start`: es la acción de "habilitar".', '`sudo systemctl enable cups`'],
        explain: '`enable` solo cambia el arranque futuro; si lo quieres también ahora, añade `--now`.',
        par: 1,
        commands: ['systemctl'],
      }),
      practice({
        goal: 'Comprueba SSH',
        prompt: 'Consulta el **estado detallado** del servicio **ssh** (debe verse `active (running)`).',
        check: all(used('systemctl'), out('active (running)')),
        solution: ['systemctl status ssh'],
        hints: ['`systemctl` + acción + servicio.', '`systemctl status ssh`'],
        explain: '`status` muestra si está activo, desde cuándo, su PID y las últimas líneas de su registro.',
        par: 1,
        commands: ['systemctl'],
      }),
      practice({
        goal: 'Lee su registro',
        prompt: 'Muestra las **últimas 5 líneas del registro** del servicio **ssh** con `journalctl`.',
        check: all(used('journalctl'), ran('-u ssh'), out('sshd')),
        solution: ['journalctl -u ssh -n 5'],
        hints: ['`-u` elige la unidad y `-n` cuántas líneas.', '`journalctl -u ssh -n 5`'],
        explain: 'Los registros de systemd se consultan con `journalctl`; con `-f` los sigues en directo.',
        par: 1,
        commands: ['journalctl'],
      }),
      practice({
        goal: 'Para y deshabilita',
        prompt: 'El servicio **cups** está activo y habilitado, pero no lo necesitas. **Páralo y deshabilítalo** con un único comando (`--now`).',
        setup: { services: { cups: { state: 'active', enabled: true } } },
        check: service('cups', { state: 'inactive', enabled: false }),
        solution: ['sudo systemctl disable --now cups'],
        hints: ['Existe una opción que combina parar y deshabilitar.', '`sudo systemctl disable --now cups`'],
        explain: 'Cada servicio innecesario es superficie de ataque. Apagar lo que no usas es una buena práctica de seguridad.',
        par: 1,
        commands: ['systemctl'],
      }),
      order('Ordena: reiniciar el servicio ssh como administrador', ['sudo', 'systemctl', 'restart', 'ssh'], 'sudo systemctl restart ssh', 'sudo + systemctl + acción + servicio.'),
    ]),
  ],
  boss: {
    goal: 'Misión: el servidor lento',
    prompt:
      '**Misión del dojo** 🥋\n\nEl servidor va lentísimo.\n\n1. Localiza qué proceso consume más CPU (`ps aux --sort=-%cpu`).\n2. **Elimina** el proceso `miner.py`.\n3. El servicio **cups** no se usa: **páralo y deshabilítalo**.',
    setup: { cwd: '/home/alumno', procs: HOG, services: { cups: { state: 'active', enabled: true } } },
    check: all(ran('ps'), procRunning('miner.py', false), service('cups', { state: 'inactive', enabled: false })),
    solution: ['ps aux --sort=-%cpu | head -n 3', 'pkill -f miner.py', 'sudo systemctl disable --now cups'],
    hints: ['Empieza con `ps aux --sort=-%cpu | head`.', 'Elimínalo con `pkill -f miner.py`.', '`sudo systemctl disable --now cups`'],
    explain: '¡Zona 6 completada! Ya puedes diagnosticar un servidor: procesos, señales, recursos y servicios. Siguiente: sed y awk, procesamiento de texto de nivel pro.',
    par: 3,
    commands: ['ps', 'pkill', 'systemctl'],
  },
});

