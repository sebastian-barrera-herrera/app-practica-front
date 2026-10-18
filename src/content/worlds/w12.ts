import { all, content, crontabHas, exists, mode, missing, not, out, outEq, outRe, owner, pkg, ran, service, used } from '@/engine/check';
import { demo, fill, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd, world } from '../build';

const TEXTO = 'El gato y el perro. El perro corre; el gato duerme.\nUn gato negro, un perro blanco.\n';
const VENTAS = 'region,producto,unidades\nnorte,teclado,5\nsur,ratón,10\nnorte,monitor,2\neste,teclado,7\nsur,teclado,3\nnorte,ratón,4\n';
const DUPS = 'uno\ndos\nuno\ntres\ndos\ncuatro\n';
const ACCESS = [
  '192.168.1.20 - - [14/Mar/2026:09:01:12 +0000] "GET /index.html HTTP/1.1" 200 1024',
  '192.168.1.20 - - [14/Mar/2026:09:01:13 +0000] "GET /style.css HTTP/1.1" 200 512',
  '203.0.113.9 - - [14/Mar/2026:09:05:44 +0000] "GET /admin HTTP/1.1" 404 128',
  '203.0.113.9 - - [14/Mar/2026:09:05:46 +0000] "GET /login HTTP/1.1" 404 128',
  '10.0.0.5 - - [14/Mar/2026:09:12:03 +0000] "GET /index.html HTTP/1.1" 200 1024',
  '10.0.0.5 - - [14/Mar/2026:09:12:09 +0000] "POST /api/orden HTTP/1.1" 500 64',
  '198.51.100.7 - - [14/Mar/2026:10:02:21 +0000] "GET /index.html HTTP/1.1" 200 1024',
  '198.51.100.7 - - [14/Mar/2026:10:02:25 +0000] "GET /precios HTTP/1.1" 200 2048',
  '203.0.113.9 - - [14/Mar/2026:10:15:00 +0000] "GET /wp-login.php HTTP/1.1" 404 128',
  '10.0.0.5 - - [14/Mar/2026:10:30:10 +0000] "POST /api/orden HTTP/1.1" 500 64',
  '192.168.1.20 - - [14/Mar/2026:10:45:55 +0000] "GET /precios HTTP/1.1" 200 2048',
  '203.0.113.9 - - [14/Mar/2026:11:00:01 +0000] "GET /.env HTTP/1.1" 404 128',
].join('\n') + '\n';

export const w12 = world({
  id: 'w12',
  index: 12,
  title: 'Maestría',
  subtitle: 'One-liners, detective de logs y rescate de servidores',
  emoji: '🏆',
  color: '#E879F9',
  level: 'avanzado',
  intro:
    'La última zona no enseña comandos nuevos: te enseña a **combinarlos**. Resolverás casos reales de principio a fin, como en un trabajo de sysadmin: analizar un registro, rescatar un servidor roto, automatizar una rotación y montar un servicio completo.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w12-1', { title: 'One-liners de maestro', summary: 'Una línea, un problema resuelto', emoji: '⚡', commands: ['awk', 'sort', 'uniq', 'tr', 'find', 'xargs', 'gzip', 'comm'], minutes: 12 }, [
      learn('Pensar en pipelines', `
Un maestro de la terminal no memoriza soluciones: **descompone el problema** en pasos pequeños y los conecta.

1. ¿Cuál es mi **fuente** de datos? (\`cat\`, \`find\`, \`ls\`, \`grep\`…)
2. ¿Cómo la **limpio**? (\`tr\`, \`cut\`, \`sed\`, \`awk\`)
3. ¿Cómo la **agrupo/cuento**? (\`sort | uniq -c\`, arrays de awk)
4. ¿Cómo la **ordeno y recorto**? (\`sort -rn\`, \`head\`)
5. ¿Dónde la **guardo**? (\`>\`, \`tee\`)

Y construye **de izquierda a derecha**, mirando la salida en cada paso.

Cuatro armas especiales de esta zona:

| Truco | Hace… |
|---|---|
| \`awk '!seen[$0]++'\` | Elimina duplicados **conservando el orden** |
| \`find … \\| while read f; do …; done\` | Actúa sobre cada resultado |
| \`find … -exec cmd {} \\;\` | Lo mismo, más compacto |
| \`comm -12 <(sort a) <(sort b)\` | Líneas **comunes** de dos listas (\`<( )\` = sustitución de procesos) |
`, '⚡'),
      demo('Algunas joyas', [
        ['tr "A-Z" "a-z" < texto.txt | tr -cs "a-z" "\\n" | sort | uniq -c | sort -rn | head -n 3', 'Palabras más usadas'],
        ['awk -F, "NR>1 {t[$1]+=$3} END {for (r in t) print t[r], r}" ventas.csv | sort -rn', 'Total por región'],
        ['awk "!seen[$0]++" dups.txt', 'Duplicados fuera, orden intacto'],
        ['comm -12 <(sort a.txt) <(sort b.txt)', 'Lo que tienen en común'],
        ['paste -sd, dups.txt', 'Una columna → una línea separada por comas'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/texto.txt': TEXTO, '/home/alumno/ventas.csv': VENTAS, '/home/alumno/dups.txt': DUPS, '/home/alumno/a.txt': 'uno\ndos\ntres\n', '/home/alumno/b.txt': 'dos\ntres\ncuatro\n' } }),
      mc('¿Qué hace `awk \'!seen[$0]++\' archivo`?', ['Cuenta líneas', 'Elimina líneas repetidas sin reordenar', 'Ordena el archivo', 'Invierte el archivo'], 1, '`seen[$0]++` vale 0 (falso) la primera vez que aparece una línea; el `!` lo vuelve cierto y awk imprime. Las siguientes veces ya no.'),
      practice({
        goal: 'Las 3 palabras más usadas',
        prompt: 'Muestra las **3 palabras más frecuentes** de `texto.txt` (sin distinguir mayúsculas). Pista: pasa todo a minúsculas con `tr`, parte en una palabra por línea con `tr -cs`, y aplica la receta de frecuencias. Debe aparecer `4 el`.',
        setup: { files: { '/home/alumno/texto.txt': TEXTO } },
        check: all(ran('tr'), ran('uniq -c'), out('4 el'), out('perro'), out('gato')),
        solution: ["tr 'A-Z' 'a-z' < texto.txt | tr -cs 'a-z' '\\n' | sort | uniq -c | sort -rn | head -n 3"],
        hints: ['`tr -cs "a-z" "\\n"` convierte todo lo que no sea letra en saltos de línea (comprimidos).', 'Después: `sort | uniq -c | sort -rn | head -n 3`.'],
        explain: 'Es el análisis de frecuencia de palabras clásico. Cambiando la fuente sirve para IPs, errores, usuarios…',
        par: 1,
        commands: ['tr', 'sort', 'uniq'],
      }),
      practice({
        goal: 'Total por región',
        prompt: 'En `ventas.csv` (`region,producto,unidades`) calcula las **unidades totales por región**, de **mayor a menor**, con el formato `TOTAL región` (p. ej. `13 sur`).',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), ran('sort -r'), outEq('13 sur\n11 norte\n7 este')),
        solution: ["awk -F, 'NR>1 {t[$1]+=$3} END {for (r in t) print t[r], r}' ventas.csv | sort -rn"],
        hints: ['Un array de awk acumula por región.', "`awk -F, 'NR>1 {t[$1]+=$3} END {for (r in t) print t[r], r}' ventas.csv | sort -rn`"],
        explain: '`array[clave] += valor` + `END` es el GROUP BY de la terminal.',
        par: 1,
        commands: ['awk', 'sort'],
      }),
      practice({
        goal: 'Sin duplicados, mismo orden',
        prompt: 'Muestra `dups.txt` **sin líneas repetidas** pero **conservando el orden de aparición** (no uses `sort`).',
        setup: { files: { '/home/alumno/dups.txt': DUPS } },
        check: all(used('awk'), outEq('uno\ndos\ntres\ncuatro')),
        solution: ["awk '!seen[$0]++' dups.txt"],
        hints: ['Un array asociativo recuerda lo ya visto.', "`awk '!seen[$0]++' dups.txt`"],
        explain: '`sort -u` también quita duplicados, pero reordena. Este truco respeta el orden original.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Renombra .jpeg a .jpg en todo el árbol',
        prompt: 'Cambia la extensión **.jpeg → .jpg** de **todos** los archivos de `fotos` (a cualquier profundidad). Usa `find` y un bucle `while read` con `${f%.jpeg}.jpg`.',
        setup: { files: { '/home/alumno/fotos/a.jpeg': 'x', '/home/alumno/fotos/viaje/b.jpeg': 'y', '/home/alumno/fotos/c.jpg': 'z' } },
        check: all(exists('/home/alumno/fotos/a.jpg', 'file'), exists('/home/alumno/fotos/viaje/b.jpg', 'file'), missing('/home/alumno/fotos/a.jpeg'), missing('/home/alumno/fotos/viaje/b.jpeg'), exists('/home/alumno/fotos/c.jpg', 'file')),
        solution: ['find fotos -name "*.jpeg" | while read f; do mv "$f" "${f%.jpeg}.jpg"; done'],
        hints: ['`find fotos -name "*.jpeg"` lista; el bucle renombra cada ruta.', '`find fotos -name "*.jpeg" | while read f; do mv "$f" "${f%.jpeg}.jpg"; done`'],
        explain: 'Un renombrado masivo recursivo en una línea. Con comillas alrededor de `"$f"` también funciona con nombres con espacios.',
        par: 1,
        commands: ['find', 'mv'],
      }),
      practice({
        goal: 'Comprime los logs viejos',
        prompt: 'Comprime con gzip **todos los `.log` de `logs` con más de 7 días** (usa `find -mtime +7 -exec`). El log reciente debe quedar intacto.',
        setup: { files: { '/home/alumno/logs/viejo.log': { content: 'x', ago: 10 }, '/home/alumno/logs/otro.log': { content: 'z', ago: 30 }, '/home/alumno/logs/nuevo.log': { content: 'y', ago: 1 } } },
        check: all(exists('/home/alumno/logs/viejo.log.gz', 'file'), exists('/home/alumno/logs/otro.log.gz', 'file'), exists('/home/alumno/logs/nuevo.log', 'file'), missing('/home/alumno/logs/viejo.log')),
        solution: ['find logs -name "*.log" -mtime +7 -exec gzip {} \\;'],
        hints: ['Combina `-name`, `-mtime +7` y `-exec gzip {} \\;`.', '`find logs -name "*.log" -mtime +7 -exec gzip {} \\;`'],
        explain: 'Esto es, literalmente, una rotación de logs casera. Ponlo en un cron semanal y listo.',
        par: 1,
        commands: ['find', 'gzip'],
      }),
      practice({
        goal: 'Elementos comunes a dos listas',
        prompt: 'Muestra las líneas que están **a la vez** en `a.txt` y en `b.txt`, usando `comm -12` y sustitución de procesos `<( )` para ordenarlas al vuelo.',
        setup: { files: { '/home/alumno/a.txt': 'uno\ndos\ntres\n', '/home/alumno/b.txt': 'dos\ntres\ncuatro\n' } },
        check: all(used('comm'), ran('<\\(sort'), outEq('dos\ntres')),
        solution: ['comm -12 <(sort a.txt) <(sort b.txt)'],
        hints: ['`comm` necesita las entradas ordenadas: `<(sort archivo)`.', '`comm -12 <(sort a.txt) <(sort b.txt)`'],
        explain: '`<(cmd)` presenta la salida de un comando como si fuese un archivo. Así comparas resultados sin crear temporales.',
        par: 1,
        commands: ['comm', 'sort'],
      }),
      multi('¿Qué pasos suelen componer un pipeline de análisis?', ['Extraer la columna', 'Agrupar con sort', 'Contar con uniq -c', 'Compilar el kernel'], [0, 1, 2], 'Extraer → agrupar → contar → ordenar → recortar.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w12-2', { title: 'Detective de logs web', summary: 'Analiza un access.log como un analista de seguridad', emoji: '🕵️', commands: ['awk', 'grep', 'sort', 'uniq', 'cut'], minutes: 11 }, [
      learn('Caso: ¿qué está pasando en el servidor web?', `
Tienes el \`access.log\` de un servidor. Cada línea sigue el formato **combinado**:

\`\`\`
IP - - [fecha] "MÉTODO /ruta HTTP/1.1" ESTADO BYTES
 $1              $6     $7           $9     $10
\`\`\`

Con \`awk\` los campos son: **$1** IP, **$6** método (con comilla), **$7** ruta, **$9** código de estado, **$10** bytes.

Preguntas típicas de un analista:

- ¿Cuántas peticiones por código de estado? → \`awk '{print $9}' | sort | uniq -c\`
- ¿Qué rutas dan 404 (escaneos)? → \`awk '$9==404 {print $7}'\`
- ¿Qué IP genera más errores? → filtra y cuenta por \`$1\`.
- ¿Cuántos bytes servimos? → \`awk '{s+=$10} END {print s}'\`
- ¿Hay errores 5xx? → \`awk '$9>=500'\`

> CLAVE: Los **404 repetidos a rutas como \`/admin\`, \`/wp-login.php\` o \`/.env\`** suelen ser bots que buscan vulnerabilidades.
`, '🕵️'),
      demo('Primer vistazo', [
        ['wc -l < access.log', 'Cuántas peticiones'],
        ['awk "{print $9}" access.log | sort | uniq -c | sort -rn', 'Distribución de códigos'],
        ['awk "$9==404 {print $1, $7}" access.log', 'Quién pide qué y falla'],
        ['awk "{print $1}" access.log | sort | uniq -c | sort -rn | head -n 1', 'La IP más activa'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/access.log': ACCESS } }),
      mc('En una línea del access.log, ¿qué campo de awk contiene el **código de estado**?', ['$1', '$7', '$9', '$10'], 2, '`$1` IP, `$7` ruta, `$9` estado y `$10` bytes (con el formato combinado estándar).'),
      practice({
        goal: 'Peticiones por código',
        prompt: 'Cuenta **cuántas peticiones hay de cada código de estado** (columna 9), ordenado de más a menos frecuente. Deben verse `6 200`, `4 404` y `2 500`.',
        setup: { files: { '/home/alumno/access.log': ACCESS } },
        check: all(ran('uniq -c'), outRe('^\\s*6 200$'), outRe('^\\s*4 404$'), outRe('^\\s*2 500$')),
        solution: ["awk '{print $9}' access.log | sort | uniq -c | sort -rn"],
        hints: ['Extrae la columna 9 y aplica la receta de frecuencias.', "`awk '{print $9}' access.log | sort | uniq -c | sort -rn`"],
        explain: 'El 33 % de errores 404 + 500 es un indicio de que algo no va bien (o de que alguien está escaneando).',
        par: 1,
        commands: ['awk', 'sort', 'uniq'],
      }),
      practice({
        goal: 'Rutas que dan 404',
        prompt: 'Lista, **sin repetir**, las **rutas** (columna 7) que devolvieron **404**. Deben aparecer `/admin`, `/login`, `/wp-login.php` y `/.env`.',
        setup: { files: { '/home/alumno/access.log': ACCESS } },
        check: all(used('awk'), out(['/admin', '/login', '/wp-login.php', '/.env']), not(out('/index.html'))),
        solution: ["awk '$9==404 {print $7}' access.log | sort -u"],
        hints: ['Filtra con la condición `$9==404` e imprime `$7`.', "`awk '$9==404 {print $7}' access.log | sort -u`"],
        explain: 'Rutas de administración que no existen en tu sitio y que alguien intenta adivinar: huella de un escaneo automático.',
        par: 1,
        commands: ['awk', 'sort'],
      }),
      practice({
        goal: 'El atacante insistente',
        prompt: 'Averigua **qué IP acumula más respuestas 404** y cuántas: filtra con `grep " 404 "`, extrae la IP y aplica la receta de frecuencias con `head -n 1`. Debe salir `4 203.0.113.9`.',
        setup: { files: { '/home/alumno/access.log': ACCESS } },
        check: all(ran('grep'), ran('uniq -c'), outRe('^\\s*4 203\\.0\\.113\\.9$')),
        solution: ["grep ' 404 ' access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -n 1"],
        hints: ['grep filtra, awk extrae la IP, y después `sort | uniq -c | sort -rn | head -n 1`.', "`grep ' 404 ' access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -n 1`"],
        explain: 'Ya tienes a tu sospechoso. El siguiente paso lógico: bloquearlo en el cortafuegos.',
        par: 1,
        commands: ['grep', 'awk', 'sort', 'uniq'],
      }),
      practice({
        goal: 'Bloquea al atacante',
        prompt: 'Activa `ufw` y **bloquea todo el tráfico desde `203.0.113.9`** (`ufw deny from …`). Comprueba la regla con `ufw status`.',
        setup: { packages: ['ufw'] },
        check: all(ran('ufw status'), out('203.0.113.9'), out('DENY')),
        solution: ['sudo ufw enable', 'sudo ufw deny from 203.0.113.9', 'sudo ufw status'],
        hints: ['Primero `enable`; después una regla `deny from IP`.', '`sudo ufw enable`, `sudo ufw deny from 203.0.113.9`, `sudo ufw status`'],
        explain: 'Del análisis a la acción: detectaste, identificaste y contuviste. Eso es respuesta a incidentes en pequeño.',
        par: 3,
        commands: ['ufw'],
      }),
      practice({
        goal: 'Errores del servidor',
        prompt: 'Muestra **IP y ruta** de las peticiones con **código 5xx** (≥ 500), en la forma `IP ruta`. Deben salir dos líneas `10.0.0.5 /api/orden`.',
        setup: { files: { '/home/alumno/access.log': ACCESS } },
        check: all(used('awk'), outEq('10.0.0.5 /api/orden\n10.0.0.5 /api/orden')),
        solution: ["awk '$9>=500 {print $1, $7}' access.log"],
        hints: ['La condición `$9>=500` y `print $1, $7`.', "`awk '$9>=500 {print $1, $7}' access.log`"],
        explain: 'Los 5xx son culpa del servidor, no del cliente: estas son las que debe arreglar el desarrollador.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: '¿Cuántos bytes servimos?',
        prompt: 'Calcula el **total de bytes** servidos (columna 10) con `awk`. Debe salir **8320**.',
        setup: { files: { '/home/alumno/access.log': ACCESS } },
        check: all(used('awk'), outEq('8320')),
        solution: ["awk '{s+=$10} END {print s}' access.log"],
        hints: ['Acumula en `s` y muéstralo en `END`.', "`awk '{s+=$10} END {print s}' access.log`"],
        explain: 'Con la misma idea calculas ancho de banda por hora, por IP, por ruta…',
        par: 1,
        commands: ['awk'],
      }),
      fill('Completa para contar los 404 con grep', "grep ___ ' 404 ' access.log", ['-c', '-v', '-i', '-r'], ['-c'], '`-c` cuenta las líneas que coinciden.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w12-3', { title: 'Rescate de servidores', summary: 'Diagnostica y arregla incidencias reales', emoji: '🚑', commands: ['systemctl', 'journalctl', 'ss', 'chown', 'sshd'], minutes: 12 }, [
      learn('Método de resolución de incidencias', `
Cuando algo falla en producción, trabaja con **método**:

1. **Observa**: ¿qué síntoma exacto hay? (error, código de salida, servicio caído…)
2. **Reúne datos**: \`systemctl status\`, \`journalctl -u servicio\`, \`ss -tlnp\`, \`df -h\`, \`ls -l\`.
3. **Formula una hipótesis**: "el puerto 80 está ocupado", "el disco está lleno", "los permisos son incorrectos".
4. **Aplica UN cambio** y **comprueba** (\`curl\`, \`systemctl is-active\`…).
5. **Documenta** lo que hiciste.

Tres incidencias clásicas:

| Síntoma | Causa típica | Herramientas |
|---|---|---|
| Servicio no arranca | Puerto ocupado / configuración errónea | \`status\`, \`journalctl\`, \`ss\`, \`sshd -t\` |
| "No space left on device" | Un archivo enorme o logs sin rotar | \`df -h\`, \`du\`, \`find -size\` |
| "Permission denied" | Dueño o permisos incorrectos | \`ls -l\`, \`chown\`, \`chmod\` |
`, '🚑'),
      practice({
        goal: 'Incidencia 1 · nginx no arranca',
        prompt: '🚨 **nginx está caído** (`failed`) y la web no responde. **Averigua por qué** (`systemctl status` / `journalctl`), **libera el puerto 80** (alguien más lo usa: apache2 → páralo **y deshabilítalo**), **arranca nginx** y comprueba con `curl -I localhost` que responde `200 OK` desde nginx (`Server: nginx`).',
        setup: { packages: ['nginx', 'apache2', 'lsof'], services: { nginx: { state: 'failed', enabled: true }, apache2: { state: 'active', enabled: true } } },
        check: all(service('nginx', { state: 'active' }), service('apache2', { state: 'inactive', enabled: false }), ran('^curl'), out('200 OK'), out('Server: nginx')),
        solution: ['systemctl status nginx', 'sudo systemctl stop apache2', 'sudo systemctl disable apache2', 'sudo systemctl start nginx', 'curl -I localhost'],
        hints: ['`systemctl status nginx` y `journalctl -u nginx` dicen: "Address already in use" en el puerto 80.', '`sudo ss -tlnp | grep :80` o `sudo lsof -i :80` revelan a apache2.', 'Para y deshabilita apache2, arranca nginx y comprueba con `curl -I localhost`.'],
        explain: 'Dos servidores web no pueden compartir el puerto 80. El log te lo dijo claramente: leer el error es el 90 % del trabajo.',
        par: 5,
        commands: ['systemctl', 'curl'],
      }),
      practice({
        goal: 'Incidencia 2 · disco lleno',
        prompt: '🚨 El disco se ha llenado. Hay un archivo enorme en `/var/tmp`. **Localiza los archivos de más de 100 MB** con `find` y **elimina** el culpable (`/var/tmp/grande.iso`). No toques el resto.',
        setup: { files: { '/var/tmp/grande.iso': { content: 'x', size: 314572800 }, '/var/tmp/pequeno.txt': 'ok\n' } },
        check: all(ran('find .*-size \\+100M'), missing('/var/tmp/grande.iso'), exists('/var/tmp/pequeno.txt', 'file')),
        solution: ['sudo find / -xdev -type f -size +100M 2>/dev/null', 'sudo rm /var/tmp/grande.iso'],
        hints: ['Busca por tamaño en todo el sistema.', '`sudo find / -xdev -type f -size +100M 2>/dev/null` y luego `sudo rm` sobre el archivo.'],
        explain: 'Primero se localiza, luego se borra: nunca borres a ciegas. En el mundo real también comprobarías qué es ese archivo antes.',
        par: 2,
        commands: ['find', 'rm'],
      }),
      practice({
        goal: 'Incidencia 3 · permisos',
        prompt: '🚨 **ana** no puede guardar archivos en `/srv/proyecto`: todo pertenece a root. Haz que **ana (usuario y grupo `ana`) sea la propietaria de la carpeta y de todo su contenido**.',
        setup: { users: { ana: ['users'] }, files: { '/srv/proyecto/': { dir: true, owner: 'root', group: 'root', mode: 0o755 }, '/srv/proyecto/notas.txt': { content: 'x', owner: 'root', group: 'root', mode: 0o644 } } },
        check: all(owner('/srv/proyecto', 'ana', 'ana'), owner('/srv/proyecto/notas.txt', 'ana', 'ana')),
        solution: ['ls -l /srv/proyecto', 'sudo chown -R ana:ana /srv/proyecto'],
        hints: ['`ls -ld /srv/proyecto` muestra el dueño actual.', '`chown -R usuario:grupo ruta` con sudo.'],
        explain: '`-R` aplica el cambio a todo el árbol. Sin ella, solo cambiaría la carpeta y ana seguiría sin poder tocar los archivos de dentro.',
        par: 2,
        commands: ['chown'],
      }),
      practice({
        goal: 'Incidencia 4 · SSH caído',
        prompt: '🚨 El servicio **ssh** está `failed` tras editar su configuración. **Valida** `/etc/ssh/sshd_config` con `sshd -t`, **corrige** la línea errónea (`PermitRootLogin` debe ser `no`) y **reinicia** ssh.',
        setup: { files: { '/etc/ssh/sshd_config': 'Port 22\nPermitRootLogin quizas\nPasswordAuthentication yes\n' }, services: { ssh: { state: 'failed' } } },
        check: all(ran('sshd -t'), content('/etc/ssh/sshd_config', { includes: 'PermitRootLogin no', notIncludes: 'quizas' }), service('ssh', { state: 'active' })),
        solution: ['sudo sshd -t', "sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config", 'sudo sshd -t', 'sudo systemctl restart ssh'],
        hints: ['`sudo sshd -t` te dice en qué línea está el error.', 'Corrígela con `sed -i` (o nano) y reinicia con `systemctl restart ssh`.'],
        explain: 'Validar **antes** de reiniciar es la regla de oro. Un `sshd -t` te habría avisado del error antes de que el servicio cayera.',
        par: 4,
        commands: ['sshd', 'sed', 'systemctl'],
      }),
      mc('El servicio X no arranca. ¿Cuál es el **primer** paso del método?', ['Reiniciar el servidor', 'Leer el estado y los logs del servicio', 'Reinstalar el paquete', 'Borrar su configuración'], 1, 'Antes de cambiar nada, reúne datos: `systemctl status` y `journalctl -u`. El log casi siempre dice la causa.'),
      match('Une cada síntoma con su herramienta principal', [['Puerto ocupado', 'ss -tlnp / lsof -i'], ['Disco lleno', 'df -h y find -size'], ['Permission denied', 'ls -l y chown'], ['Config SSH rota', 'sshd -t']], 'Con estas cuatro parejas resuelves la mayoría de incidencias básicas.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w12-4', { title: 'Automatización final', summary: 'Rotación de backups y scripts de utilidad', emoji: '🤖', commands: ['ls', 'tail', 'xargs', 'bash'], minutes: 10 }, [
      learn('Rotar copias de seguridad', `
Los backups se acumulan. Un script profesional **conserva solo los N más recientes**:

\`\`\`bash
cd backups
ls -t | tail -n +4 | xargs rm      # conserva los 3 más nuevos
\`\`\`

- \`ls -t\` ordena por fecha, de **más nuevo a más viejo**.
- \`tail -n +4\` imprime **desde la línea 4 en adelante** (es decir, descarta las 3 primeras).
- \`xargs rm\` borra lo que quede.

Y un **script reutilizable** que recibe parámetros:

\`\`\`bash
#!/bin/bash
# uso: resumen.sh archivo.csv
awk -F, 'NR>1 {s+=$3} END {print s}' "$1"
\`\`\`

> TIP: Puedes escribir un script de varias líneas de golpe con un **heredoc**: \`cat > script.sh <<'EOF'\` … líneas … \`EOF\`. Las comillas en \`'EOF'\` evitan que la shell expanda \`$1\` al escribirlo.
`, '🤖'),
      demo('Rotación', [
        ['ls -t backups', 'Del más nuevo al más viejo'],
        ['ls -t backups | tail -n +4', 'Lo que sobra (a partir del 4.º)'],
        ['cd backups && ls -t | tail -n +4 | xargs rm; ls', 'Borra lo sobrante y mira'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/backups/b1.tgz': { content: '1', ago: 5 }, '/home/alumno/backups/b2.tgz': { content: '2', ago: 4 }, '/home/alumno/backups/b3.tgz': { content: '3', ago: 3 }, '/home/alumno/backups/b4.tgz': { content: '4', ago: 2 }, '/home/alumno/backups/b5.tgz': { content: '5', ago: 1 } } }),
      predict('Con 5 archivos, ¿qué imprime `ls -t | tail -n +4`?  (los más nuevos son b5, b4, b3…)', 'cd backups && ls -t | tail -n +4', ['b5.tgz\nb4.tgz', 'b3.tgz\nb2.tgz\nb1.tgz', 'b5.tgz\nb4.tgz\nb3.tgz'], '`ls -t` da b5 b4 b3 b2 b1; `tail -n +4` descarta las 3 primeras y deja **b2 y b1**: justo lo que hay que borrar.', { cwd: '/home/alumno', files: { '/home/alumno/backups/b1.tgz': { content: '1', ago: 5 }, '/home/alumno/backups/b2.tgz': { content: '2', ago: 4 }, '/home/alumno/backups/b3.tgz': { content: '3', ago: 3 }, '/home/alumno/backups/b4.tgz': { content: '4', ago: 2 }, '/home/alumno/backups/b5.tgz': { content: '5', ago: 1 } } }),
      practice({
        goal: 'Conserva solo los 3 más recientes',
        prompt: 'En `backups` hay 5 copias. **Elimina las más antiguas** dejando solo las **3 más recientes** (b3, b4 y b5), con un pipeline `ls -t | tail -n +4 | xargs rm`.',
        setup: { files: { '/home/alumno/backups/b1.tgz': { content: '1', ago: 5 }, '/home/alumno/backups/b2.tgz': { content: '2', ago: 4 }, '/home/alumno/backups/b3.tgz': { content: '3', ago: 3 }, '/home/alumno/backups/b4.tgz': { content: '4', ago: 2 }, '/home/alumno/backups/b5.tgz': { content: '5', ago: 1 } } },
        check: all(missing('/home/alumno/backups/b1.tgz'), missing('/home/alumno/backups/b2.tgz'), exists('/home/alumno/backups/b3.tgz', 'file'), exists('/home/alumno/backups/b5.tgz', 'file'), ran('xargs')),
        solution: ['cd backups', 'ls -t | tail -n +4 | xargs rm'],
        hints: ['Entra en la carpeta primero: `cd backups`.', '`ls -t | tail -n +4 | xargs rm`'],
        explain: 'Programado con cron, esto mantiene siempre las últimas N copias sin que el disco crezca sin límite.',
        par: 2,
        commands: ['ls', 'tail', 'xargs'],
      }),
      practice({
        goal: 'Tu script de utilidad',
        prompt: 'Escribe un script **resumen.sh** que reciba un CSV como argumento y **imprima la suma de su 3.ª columna** (sin cabecera). Hazlo ejecutable y pruébalo con `./resumen.sh ventas.csv` (debe salir **31**). Puedes usar un heredoc o el editor `nano`.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(mode('/home/alumno/resumen.sh', '755'), ran('^\\./resumen\\.sh ventas\\.csv$'), outEq('31')),
        solution: ["cat > resumen.sh <<'EOF'\n#!/bin/bash\nawk -F, 'NR>1 {s+=$3} END {print s}' \"$1\"\nEOF", 'chmod +x resumen.sh', './resumen.sh ventas.csv'],
        hints: ['Shebang + una línea de awk que usa `"$1"` como archivo.', 'No olvides `chmod +x`.'],
        explain: 'Acabas de convertir un one-liner en una herramienta reutilizable para cualquier CSV.',
        par: 3,
        commands: ['bash', 'awk', 'chmod'],
      }),
      practice({
        goal: 'Programa la rotación',
        prompt: 'Haz que la rotación se ejecute **todos los domingos a las 4:00** (`0 4 * * 0`). Instala en tu crontab la línea `0 4 * * 0 /home/alumno/rotar.sh`.',
        check: crontabHas('0 4 * * 0 /home/alumno/rotar.sh'),
        solution: ['printf "0 4 * * 0 /home/alumno/rotar.sh\\n" | crontab -'],
        hints: ['Día de la semana 0 = domingo.', '`printf "0 4 * * 0 /home/alumno/rotar.sh\\n" | crontab -`'],
        explain: 'Script + cron = administración desatendida. Esa es la meta de todo sysadmin: que las cosas se hagan solas.',
        par: 1,
        commands: ['crontab'],
      }),
      tf('`tail -n +4` imprime solo las 4 últimas líneas.', false, '`tail -n +4` imprime **a partir de la línea 4** (descarta las 3 primeras). Las últimas 4 serían `tail -n 4`.'),
      typeCmd('Escribe el comando que conserva solo los 2 archivos más nuevos de la carpeta actual: `ls -t | tail -n +3 | xargs ___`', ['ls -t | tail -n +3 | xargs rm'], 'Se borran los que sobran a partir del 3.º.'),
      order('Ordena el pipeline de rotación', ['ls', '-t', '|', 'tail', '-n', '+4', '|', 'xargs', 'rm'], 'ls -t | tail -n +4 | xargs rm', 'Listar por fecha → descartar los 3 mejores → borrar el resto.'),
    ]),
  ],
  boss: {
    goal: 'Examen final: monta un servicio web completo',
    prompt:
      '**Examen del maestro** 🥋🏆\n\nMonta un servidor web seguro desde cero (tienes `ufw` instalado):\n\n1. **Instala nginx**.\n2. Escribe en `/var/www/html/index.html` el texto **`<h1>Dojo OK</h1>`** (necesitas `sudo tee`).\n3. Asegura que nginx esté **activo y habilitado**.\n4. Abre el **puerto 80/tcp** en `ufw` (y el **22** para no perder SSH) y activa el cortafuegos.\n5. Programa en cron un **backup diario a las 4:00**: `0 4 * * * tar -czf /tmp/web.tar.gz /var/www`.\n6. **Termina comprobando con `curl -s localhost`**.',
    setup: { cwd: '/home/alumno', packages: ['ufw'] },
    check: all(
      pkg('nginx'),
      service('nginx', { state: 'active', enabled: true }),
      content('/var/www/html/index.html', { includes: 'Dojo OK' }),
      ran('ufw allow.*80'),
      ran('ufw allow.*22'),
      ran('ufw enable'),
      crontabHas('0 4 * * * tar -czf /tmp/web.tar.gz /var/www'),
      ran('^curl'),
      out('Dojo OK'),
    ),
    solution: [
      'sudo apt install -y nginx',
      'echo "<h1>Dojo OK</h1>" | sudo tee /var/www/html/index.html',
      'sudo systemctl enable --now nginx',
      'sudo ufw allow 22/tcp',
      'sudo ufw allow 80/tcp',
      'sudo ufw enable',
      'printf "0 4 * * * tar -czf /tmp/web.tar.gz /var/www\\n" | crontab -',
      'curl -s localhost',
    ],
    hints: ['`sudo apt install -y nginx` y `echo … | sudo tee /var/www/html/index.html`.', '`sudo systemctl enable --now nginx`, luego `ufw allow 22/tcp`, `ufw allow 80/tcp` y `ufw enable`.', 'Cron con `printf … | crontab -` y termina con `curl -s localhost`.'],
    explain: '🏆 ¡Eres maestro del dojo! Instalaste, configuraste, aseguraste, automatizaste y verificaste un servicio completo. Ahora te toca seguir practicando en la terminal libre y superar la certificación avanzada.',
    par: 8,
    commands: ['apt', 'systemctl', 'ufw', 'crontab', 'curl'],
  },
});

