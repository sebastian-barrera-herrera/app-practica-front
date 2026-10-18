import { all, any, content, crontabHas, not, out, outEq, outRe, pkg, ran, service, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, tf, world } from '../build';

const BACKUP_SH = { '/home/alumno/backup.sh': { content: '#!/bin/bash\necho respaldo hecho\n', mode: 0o755 } };

export const w11 = world({
  id: 'w11',
  index: 11,
  title: 'Administración de sistemas',
  subtitle: 'Cron, registros, seguridad, discos y rendimiento',
  emoji: '🛠️',
  color: '#F59E0B',
  level: 'avanzado',
  intro:
    'Administrar un servidor es **automatizar, vigilar y proteger**. Aprenderás a programar tareas, investigar registros, endurecer cuentas y SSH, controlar el almacenamiento y medir el rendimiento. Es el trabajo diario de un sysadmin.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w11-1', { title: 'Tareas programadas: cron', summary: 'Ejecuta comandos solos, a la hora que quieras', emoji: '⏰', commands: ['crontab'], minutes: 9 }, [
      learn('El reloj despertador de Linux', `
**cron** es un servicio que ejecuta comandos **a horas programadas**. Cada usuario tiene su **crontab** (tabla de tareas).

| Comando | Efecto |
|---|---|
| \`crontab -l\` | **Lista** tus tareas |
| \`crontab -e\` | **Edita** tus tareas (abre un editor) |
| \`crontab -r\` | **Borra** todas tus tareas |
| \`crontab archivo\` | Instala las tareas desde un archivo |
| \`sudo crontab -u ana -l\` | Las de otro usuario |

Cada línea de un crontab tiene **5 campos de tiempo** y luego el comando:

\`\`\`
┌──────── minuto (0-59)
│ ┌────── hora (0-23)
│ │ ┌──── día del mes (1-31)
│ │ │ ┌── mes (1-12)
│ │ │ │ ┌ día de la semana (0-7; 0 y 7 = domingo)
│ │ │ │ │
30 3 * * * /home/alumno/backup.sh
\`\`\`
`, '⏰'),
      illus('cron-fields', 'Los 5 campos de cron', 'Toca cada campo para ver qué valores admite.'),
      learn('Atajos de tiempo', `
| Símbolo | Significa | Ejemplo |
|---|---|---|
| \`*\` | Cualquier valor | \`* * * * *\` = cada minuto |
| \`,\` | Lista | \`0 8,20 * * *\` = a las 8:00 y 20:00 |
| \`-\` | Rango | \`0 9 * * 1-5\` = lunes a viernes a las 9 |
| \`/\` | Cada N | \`*/15 * * * *\` = cada 15 minutos |
| \`@reboot\` | Al arrancar | \`@reboot /home/alumno/inicio.sh\` |

> OJO: cron ejecuta con un **entorno mínimo** (PATH corto). Usa **rutas absolutas** para los comandos y redirige la salida: \`… >> /tmp/cron.log 2>&1\`.
`),
      demo('Programando tareas', [
        ['printf "30 3 * * * /home/alumno/backup.sh\\n*/15 * * * * /usr/bin/free -h >> /tmp/mem.log\\n" | crontab -', 'Instala dos tareas desde la entrada estándar'],
        ['crontab -l', 'Ahí están'],
        ['sudo systemctl status cron | head -n 3', 'El servicio cron debe estar activo'],
        ['crontab -r', 'Las borramos todas'],
        ['crontab -l', 'Ya no hay'],
      ], { cwd: '/home/alumno', files: BACKUP_SH }),
      mc('¿Qué significa `*/15 * * * *`?', ['Cada 15 horas', 'Cada 15 minutos', 'El día 15 de cada mes', 'A las 15:00'], 1, 'El campo de los minutos con `*/15` = cada 15 minutos (0, 15, 30, 45).'),
      mc('¿Cuándo se ejecuta `0 8 * * 1-5`?', ['Todos los días a las 8:00', 'De lunes a viernes a las 8:00', 'El día 8 de cada mes', 'Cada 8 minutos'], 1, 'Minuto 0, hora 8, cualquier día del mes, cualquier mes, días de semana 1 a 5 (lunes a viernes).'),
      practice({
        goal: 'Programa el backup',
        prompt: 'Programa `/home/alumno/backup.sh` para ejecutarse **todos los días a las 3:30** (minuto 30, hora 3). Instálalo con `crontab` (por ejemplo `printf … | crontab -`).',
        setup: { files: BACKUP_SH },
        check: crontabHas('30 3 * * * /home/alumno/backup.sh'),
        solution: ['printf "30 3 * * * /home/alumno/backup.sh\\n" | crontab -'],
        hints: ['Formato: `minuto hora día mes díaSemana comando`.', '`printf "30 3 * * * /home/alumno/backup.sh\\n" | crontab -`'],
        explain: 'Con `crontab -` instalas la tabla leyendo de la entrada estándar. En la vida real lo habitual es `crontab -e`.',
        par: 1,
        commands: ['crontab'],
      }),
      practice({
        goal: 'Cada 15 minutos',
        prompt: 'Programa que **cada 15 minutos** se ejecute `/usr/bin/free -h >> /tmp/mem.log`. Usa la forma `*/15` en el campo de minutos.',
        check: crontabHas('*/15 * * * * /usr/bin/free -h >> /tmp/mem.log'),
        solution: ['printf "*/15 * * * * /usr/bin/free -h >> /tmp/mem.log\\n" | crontab -'],
        hints: ['El campo de minutos admite `*/N`.', '`printf "*/15 * * * * /usr/bin/free -h >> /tmp/mem.log\\n" | crontab -`'],
        explain: 'Redirigir la salida a un log (`>>`) te permite revisar qué pasó cuando nadie miraba.',
        par: 1,
        commands: ['crontab'],
      }),
      practice({
        goal: 'Revisa lo programado',
        prompt: 'Programa el backup a las **2:00 todos los días** y a continuación **lista** tu crontab. Debe verse `backup.sh`.',
        setup: { files: BACKUP_SH },
        check: all(ran('^crontab -l$'), out('0 2 * * * /home/alumno/backup.sh')),
        solution: ['printf "0 2 * * * /home/alumno/backup.sh\\n" | crontab -', 'crontab -l'],
        hints: ['Primero instálalo, después `crontab -l`.', '`printf "0 2 * * * /home/alumno/backup.sh\\n" | crontab -` y `crontab -l`'],
        explain: '`crontab -l` es lo primero que haces en un servidor desconocido: ¿qué tareas automáticas corren aquí?',
        par: 2,
        commands: ['crontab'],
      }),
      practice({
        goal: 'Borra las tareas',
        prompt: 'Programa cualquier tarea y después **elimina todo tu crontab** con la opción correspondiente.',
        check: all(ran('^crontab -r$'), not(crontabHas('backup'))),
        solution: ['printf "0 2 * * * /home/alumno/backup.sh\\n" | crontab -', 'crontab -r'],
        hints: ['La opción `-r` (remove).', '`crontab -r`'],
        explain: 'Cuidado: `crontab -r` borra **todo** sin preguntar (y está pegada a `-e` en el teclado). Muchos admins hacen copia antes: `crontab -l > cron.bak`.',
        par: 2,
        commands: ['crontab'],
      }),
      fill('Completa: de lunes a viernes a las 9:00', '0 9 * * ___ /home/alumno/informe.sh', ['1-5', '5', '*/5', '0-4,7'], ['1-5'], 'El quinto campo es el día de la semana: `1-5` = lunes a viernes.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w11-2', { title: 'Registros del sistema', summary: '/var/log, journalctl, last y logger', emoji: '📚', commands: ['journalctl', 'last', 'logger', 'dmesg'], minutes: 9 }, [
      learn('Los registros cuentan la historia', `
Casi todo lo que ocurre en Linux deja una línea en un **registro** (_log_). Primer sitio al investigar un problema: **\`/var/log\`**.

| Archivo | Contiene |
|---|---|
| \`/var/log/syslog\` | Mensajes generales del sistema |
| \`/var/log/auth.log\` | **Autenticación**: logins, sudo, ssh |
| \`/var/log/kern.log\` | Mensajes del kernel |
| \`/var/log/dpkg.log\` | Instalaciones de paquetes |

Herramientas:

| Comando | Para qué |
|---|---|
| \`tail -f archivo\` | Seguir el registro **en directo** |
| \`journalctl -u ssh\` | Registros de un **servicio** (systemd) |
| \`journalctl -p err\` | Solo **errores** |
| \`last\` | Historial de **inicios de sesión** |
| \`who\` / \`w\` | Quién está conectado **ahora** |
| \`dmesg\` | Mensajes del **kernel** |
| \`logger "texto"\` | **Escribir** tu propio mensaje en el log |

> TIP: Muchos logs son legibles solo por root o el grupo \`adm\`: usa \`sudo\` si ves "Permission denied".
`, '📚'),
      demo('Investigando', [
        ['ls /var/log', 'Los registros disponibles'],
        ['sudo tail -n 3 /var/log/auth.log', 'Últimos eventos de autenticación'],
        ['sudo grep -c "Failed password" /var/log/auth.log', 'Cuántos intentos fallidos'],
        ['sudo grep "Failed password" /var/log/auth.log | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn | head -n 3', 'Las 3 IPs más insistentes'],
        ['last -n 3', 'Últimos accesos'],
        ['logger -t backup "copia terminada"', 'Tu propia línea en el log'],
        ['grep backup /var/log/syslog', 'Aquí está'],
      ], { cwd: '/home/alumno' }),
      mc('Sospechas que alguien intenta adivinar contraseñas por SSH. ¿Dónde miras primero?', ['/var/log/dpkg.log', '/var/log/auth.log', '/etc/passwd', '/var/log/kern.log'], 1, '`auth.log` registra los intentos de autenticación, incluidos los `Failed password`.'),
      mc('¿Qué comando muestra los **últimos inicios de sesión** de los usuarios?', ['who', 'last', 'uptime', 'id'], 1, '`last` lee el historial de accesos. `who` solo muestra quién está conectado ahora.'),
      practice({
        goal: 'Cuenta intentos fallidos',
        prompt: 'Cuenta **cuántas líneas** de `/var/log/auth.log` contienen `Failed password` (usa `grep -c`, con `sudo` si hace falta). Debe salir un número.',
        check: all(ran('grep.*-c.*Failed password'), outRe('^\\d+$')),
        solution: ['sudo grep -c "Failed password" /var/log/auth.log'],
        hints: ['`grep -c` cuenta coincidencias.', '`sudo grep -c "Failed password" /var/log/auth.log`'],
        explain: 'Un número alto de fallos en poco tiempo suele indicar un ataque de fuerza bruta.',
        par: 1,
        commands: ['grep'],
      }),
      practice({
        goal: 'La IP más insistente',
        prompt: 'Averigua **qué IP** acumula más intentos fallidos en `auth.log`. Extrae la IP (`awk \'{print $(NF-3)}\'`), cuéntalas con `sort | uniq -c | sort -rn` y muestra solo la primera. Debe aparecer `45.155.205.12`.',
        check: all(ran('grep.*Failed password'), ran('uniq -c'), out('45.155.205.12')),
        solution: ['sudo grep "Failed password" /var/log/auth.log | awk \'{print $(NF-3)}\' | sort | uniq -c | sort -rn | head -n 1'],
        hints: ['Receta de frecuencias: `sort | uniq -c | sort -rn | head`.', 'La IP es el 4.º campo empezando por el final (`$(NF-3)`).'],
        explain: 'Con esa IP puedes bloquearla: `sudo ufw deny from 45.155.205.12`. Es análisis de seguridad real con herramientas básicas.',
        par: 1,
        commands: ['grep', 'awk', 'sort', 'uniq'],
      }),
      practice({
        goal: 'Quién ha entrado',
        prompt: 'Muestra los **3 últimos accesos** al sistema con `last`.',
        check: all(used('last'), ran('last .*-n 3|last -3'), out('alumno')),
        solution: ['last -n 3'],
        hints: ['`last` admite `-n` para limitar.', '`last -n 3`'],
        explain: '`last` te dice quién entró, desde qué IP y cuánto estuvo conectado.',
        par: 1,
        commands: ['last'],
      }),
      practice({
        goal: 'Deja tu propia huella',
        prompt: 'Escribe en el registro del sistema, con la etiqueta **backup**, el mensaje **OK** (`logger -t backup OK`) y comprueba que aparece en `/var/log/syslog` filtrando con `grep`.',
        check: all(ran('^logger .*-t backup'), ran('grep backup'), out('backup: OK')),
        solution: ['logger -t backup OK', 'grep backup /var/log/syslog'],
        hints: ['`logger -t ETIQUETA mensaje` y luego `grep` en syslog.', '`logger -t backup OK` y `grep backup /var/log/syslog`'],
        explain: '`logger` permite que tus scripts dejen constancia de lo que hacen en el log del sistema.',
        par: 2,
        commands: ['logger', 'grep'],
      }),
      match('Une cada registro con su contenido', [['auth.log', 'Logins, sudo y SSH'], ['syslog', 'Mensajes generales'], ['dpkg.log', 'Instalación de paquetes'], ['kern.log', 'Mensajes del kernel']], 'Saber dónde mirar ahorra horas de búsqueda.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w11-3', { title: 'Cuentas y SSH seguros', summary: 'Bloquear usuarios, caducar contraseñas y endurecer sshd', emoji: '🛡️', commands: ['passwd', 'chage', 'sed', 'systemctl'], minutes: 9 }, [
      learn('Reduce la superficie de ataque', `
La seguridad práctica empieza por lo básico:

**Cuentas**

| Comando | Efecto |
|---|---|
| \`sudo passwd -l ana\` | **Bloquea** la contraseña de ana (no podrá entrar con ella) |
| \`sudo passwd -u ana\` | La desbloquea |
| \`sudo passwd -S ana\` | Estado (**L** = bloqueada, **P** = activa) |
| \`sudo chage -M 90 ana\` | Su contraseña **caduca a los 90 días** |
| \`sudo chage -l ana\` | Ver la política de caducidad |
| \`sudo userdel -r ana\` | Borra la cuenta |

**SSH** — el archivo \`/etc/ssh/sshd_config\` controla el servidor:

\`\`\`
PermitRootLogin no            # root no entra por SSH
PasswordAuthentication no     # solo claves, nada de contraseñas
\`\`\`

Después de cambiar la configuración hay que **reiniciar** el servicio: \`sudo systemctl restart ssh\`.

> OJO: **Prueba antes de reiniciar** con \`sudo sshd -t\`: si el archivo tiene un error, el servicio no arrancaría y te quedarías sin acceso.
`, '🛡️'),
      demo('Endureciendo', [
        ['sudo passwd -S ana', 'P = contraseña activa'],
        ['sudo passwd -l ana', 'Bloqueamos a ana'],
        ['sudo passwd -S ana', 'Ahora L = bloqueada'],
        ['sudo chage -M 90 ana', 'Caducidad a 90 días'],
        ['sudo chage -l ana | head -n 3', 'Comprobamos'],
        ['sudo grep ^PermitRootLogin /etc/ssh/sshd_config', 'Valor actual'],
        ['sudo sed -i "s/^PermitRootLogin.*/PermitRootLogin no/" /etc/ssh/sshd_config', 'Cambiamos la política'],
        ['sudo sshd -t && sudo systemctl restart ssh', 'Validamos y reiniciamos'],
      ], { cwd: '/home/alumno', users: { ana: ['users'] } }),
      mc('¿Qué hace `sudo passwd -l ana`?', ['Lista las contraseñas', 'Bloquea la contraseña de ana', 'Borra a ana', 'Obliga a ana a cambiar la contraseña'], 1, '`-l` (lock) impide autenticarse con la contraseña. La cuenta sigue existiendo.'),
      mc('Has cambiado `/etc/ssh/sshd_config`. ¿Qué haces **antes** de reiniciar ssh?', ['Nada', 'Comprobar la sintaxis con `sudo sshd -t`', 'Reiniciar el equipo', 'Borrar known_hosts'], 1, 'Un error en la configuración puede impedir que sshd arranque y dejarte fuera. `sshd -t` valida antes.'),
      practice({
        goal: 'Bloquea una cuenta',
        prompt: 'Bloquea la contraseña del usuario **ana** y comprueba su estado con `passwd -S` (debe aparecer la letra **L**).',
        setup: { users: { ana: ['users'] } },
        check: all(ran('^sudo passwd -l ana$'), ran('^sudo passwd -S ana$'), outRe('^ana L ')),
        solution: ['sudo passwd -l ana', 'sudo passwd -S ana'],
        hints: ['`-l` bloquea y `-S` muestra el estado.', '`sudo passwd -l ana` y `sudo passwd -S ana`'],
        explain: 'Bloquear (en vez de borrar) conserva los archivos de la persona: es lo habitual cuando alguien deja la empresa.',
        par: 2,
        commands: ['passwd'],
      }),
      practice({
        goal: 'Contraseña con caducidad',
        prompt: 'Haz que la contraseña de **ana** **caduque a los 90 días** y comprueba la política con `chage -l`. Debe verse `90`.',
        setup: { users: { ana: ['users'] } },
        check: all(ran('^sudo chage .*-M 90 ana$'), ran('^sudo chage -l ana$'), outRe('Maximum number of days between password change\\s*: 90')),
        solution: ['sudo chage -M 90 ana', 'sudo chage -l ana'],
        hints: ['`chage -M N` fija los días máximos.', '`sudo chage -M 90 ana` y `sudo chage -l ana`'],
        explain: 'Las políticas de caducidad obligan a renovar contraseñas periódicamente.',
        par: 2,
        commands: ['chage'],
      }),
      practice({
        goal: 'Prohíbe el login de root por SSH',
        prompt: 'En `/etc/ssh/sshd_config` pon **`PermitRootLogin no`** (usa `sed -i` sobre la línea existente), valida con `sshd -t` y **reinicia** el servicio ssh.',
        check: all(content('/etc/ssh/sshd_config', { includes: 'PermitRootLogin no' }), ran('sshd -t'), ran('systemctl restart ssh'), service('ssh', { state: 'active' })),
        solution: ["sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config", 'sudo sshd -t', 'sudo systemctl restart ssh'],
        hints: ['`sed -i` con una sustitución sobre la línea que empieza por PermitRootLogin.', 'Luego `sudo sshd -t` y `sudo systemctl restart ssh`.'],
        explain: 'Con esto root no puede entrar por SSH; los administradores entran con su usuario y usan sudo. Es de las primeras medidas de bastionado.',
        par: 3,
        commands: ['sed', 'systemctl'],
      }),
      fill('Completa: desbloquear la cuenta de ana', 'sudo passwd ___ ana', ['-u', '-l', '-S', '-d'], ['-u'], '`-u` (unlock) revierte el bloqueo.'),
      tf('Bloquear una cuenta con `passwd -l` borra su carpeta personal.', false, 'Solo impide la autenticación por contraseña. Los archivos permanecen.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w11-4', { title: 'Almacenamiento', summary: 'lsblk, mount, fstab, inodos y archivos gigantes', emoji: '💽', commands: ['lsblk', 'mount', 'df', 'find'], minutes: 8 }, [
      learn('Discos, particiones y montajes', `
En Linux los discos **no tienen letras**: se **montan** en carpetas del árbol. Un disco puede tener varias **particiones** (\`vda1\`, \`vda2\`…) y cada una se monta en un **punto de montaje** (\`/\`, \`/boot\`, \`/home\`…).

| Comando | Muestra |
|---|---|
| \`lsblk\` | Discos y particiones en árbol |
| \`mount\` | Lo que está montado ahora |
| \`df -h\` | **Espacio** libre por partición |
| \`df -i\` | Uso de **inodos** (nº de archivos) |
| \`cat /etc/fstab\` | Qué se monta **al arrancar** |
| \`du -sh *\` | Tamaño de cada carpeta |

Un disco puede estar "lleno" por **bytes** (\`df -h\` al 100 %) o por **inodos** (millones de archivos pequeños, \`df -i\` al 100 %).

> CLAVE: Para encontrar lo que ocupa: \`sudo find / -xdev -type f -size +100M\` lista archivos de más de 100 MB en el disco actual (\`-xdev\` no cruza a otros montajes).
`, '💽'),
      demo('Mirando el almacenamiento', [
        ['lsblk', 'Árbol de discos'],
        ['df -h /', 'Espacio de la raíz'],
        ['df -i /', 'Inodos de la raíz'],
        ['cat /etc/fstab', 'Montajes al arranque'],
        ['sudo find / -xdev -type f -size +100M 2>/dev/null', 'Archivos de más de 100 MB'],
        ['ls -lh /var/tmp', 'Ahí está el culpable'],
      ], { cwd: '/home/alumno', files: { '/var/tmp/grande.iso': { content: 'x', size: 314572800 } } }),
      mc('El disco dice "No space left on device" pero `df -h` muestra espacio libre. ¿Qué miras?', ['df -i (inodos)', 'uptime', 'free -h', 'lsblk'], 0, 'Puede haberse agotado la tabla de **inodos** (demasiados archivos pequeños) aunque queden bytes libres.'),
      match('Une cada comando con su utilidad', [['lsblk', 'Árbol de discos'], ['df -h', 'Espacio libre'], ['du -sh', 'Tamaño de carpetas'], ['/etc/fstab', 'Montajes del arranque']], 'Cuatro comandos para entender cualquier almacenamiento.'),
      practice({
        goal: 'Ver los discos',
        prompt: 'Muestra el **árbol de discos y particiones** del sistema. Debe aparecer `vda1`.',
        check: all(used('lsblk'), out('vda1')),
        solution: ['lsblk'],
        hints: ['_List block devices_.', '`lsblk`'],
        explain: '`lsblk` es la forma más clara de ver qué discos hay y dónde están montados.',
        par: 1,
        commands: ['lsblk'],
      }),
      practice({
        goal: 'Montajes del arranque',
        prompt: 'Consulta el archivo que define **qué se monta al arrancar**. Deben verse las líneas con `UUID`.',
        check: all(any(used('cat'), used('less'), used('head')), ran('/etc/fstab'), out('UUID')),
        solution: ['cat /etc/fstab'],
        hints: ['El archivo está en /etc y su nombre empieza por "fs".', '`cat /etc/fstab`'],
        explain: 'Una línea errónea en fstab puede impedir que el servidor arranque: edítalo con mucho cuidado.',
        par: 1,
        commands: ['cat'],
      }),
      practice({
        goal: 'Caza el archivo gigante',
        prompt: 'El disco se está llenando. **Encuentra los archivos de más de 100 MB** en todo el sistema (usa `sudo find /` con `-type f -size +100M`). Debe aparecer `grande.iso`.',
        setup: { files: { '/var/tmp/grande.iso': { content: 'x', size: 314572800 }, '/home/alumno/Downloads/peque.bin': { content: 'x', size: 2000 } } },
        check: all(ran('find /'), ran('-size \\+100M'), out('grande.iso'), not(out('peque.bin'))),
        solution: ['sudo find / -xdev -type f -size +100M 2>/dev/null'],
        hints: ['`find / -type f -size +100M`; añade `2>/dev/null` para ocultar errores de permisos.', '`sudo find / -xdev -type f -size +100M 2>/dev/null`'],
        explain: 'Es el primer paso al liberar espacio: localizar lo que más pesa. Después decide si borrar, comprimir o mover.',
        par: 1,
        commands: ['find'],
      }),
      practice({
        goal: 'Inodos',
        prompt: 'Muestra el uso de **inodos** de la partición raíz (`df` con la opción `-i`). Debe aparecer la columna `Inodes`.',
        check: all(used('df', ['-i']), out('Inodes')),
        solution: ['df -i /'],
        hints: ['`df -h` mira bytes; la otra opción mira inodos.', '`df -i /`'],
        explain: 'Cada archivo consume un inodo. Un directorio con millones de archivos minúsculos puede agotarlos.',
        par: 1,
        commands: ['df'],
      }),
      fill('Completa: archivos de más de 500 MB', 'find / -type f -size ___500M', ['+', '-', '=', '#'], ['+'], '`+500M` = mayor que 500 MB; `-500M` = menor.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w11-5', { title: 'Rendimiento y control', summary: 'time, timeout, nice, renice y lsof', emoji: '📈', commands: ['time', 'timeout', 'nice', 'renice', 'lsof', 'watch', 'uptime'], minutes: 8 }, [
      learn('Mide, limita y prioriza', `
| Comando | Para qué |
|---|---|
| \`time cmd\` | **Cuánto tarda** un comando (real, user, sys) |
| \`timeout 5 cmd\` | **Mata** el comando si pasa de 5 s (código de salida **124**) |
| \`nice -n 10 cmd\` | Lanza con **menor prioridad** |
| \`sudo renice -n 5 -p PID\` | Cambia la prioridad de un proceso en marcha |
| \`watch -n 2 df -h\` | **Repite** un comando cada 2 s (Ctrl+C para salir) |
| \`sudo lsof -i :22\` | **Qué proceso** usa el puerto 22 |
| \`uptime\` | Tiempo encendido y **carga media** |

**Prioridad (nice)**: de **-20** (máxima) a **19** (mínima). Solo root puede **bajar** el valor (subir prioridad).

La **carga media** de \`uptime\` (3 números: 1, 5 y 15 minutos) se compara con el nº de núcleos (\`nproc\`): una carga de 4.0 en 4 núcleos es "al 100 %".

> NOTA: \`lsof\` (_list open files_) no viene en todas las instalaciones: \`sudo apt install lsof\`.
`, '📈'),
      demo('Midiendo', [
        ['time sleep 1', 'Cuánto tardó'],
        ['timeout 2 sleep 10; echo "código: $?"', '124 = se agotó el tiempo'],
        ['nice -n 10 sleep 1', 'Prioridad baja'],
        ['sudo renice -n 5 -p $(pgrep sleep)', 'Bajar la prioridad de un proceso ya lanzado'],
        ['sudo apt install -y lsof | tail -n 1', 'Instalar lsof'],
        ['sudo lsof -i :22', 'Quién escucha en el 22'],
        ['uptime', 'Carga media'],
      ], { cwd: '/home/alumno', procs: [['alumno', 'sleep 1000', 0, 0.1]] }),
      mc('`timeout 5 comando` termina porque el comando tarda más de 5 segundos. ¿Qué código de salida devuelve?', ['0', '1', '124', '255'], 2, '`timeout` devuelve 124 cuando agota el tiempo, lo que permite distinguirlo de un fallo normal del comando.'),
      mc('¿Qué valor de _nice_ da **más prioridad** a un proceso?', ['19', '0', '-20', '100'], 2, 'Cuanto más bajo (más "negativo"), más prioridad. 19 es el más "amable" (menos prioridad).'),
      practice({
        goal: '¿Cuánto tarda?',
        prompt: 'Mide cuánto tarda en ejecutarse `sleep 1` anteponiendo `time`. Debe aparecer la línea `real`.',
        check: all(ran('^time sleep 1$'), out('real', { stderr: true })),
        solution: ['time sleep 1'],
        hints: ['Antepón el comando de medir tiempo.', '`time sleep 1`'],
        explain: '`real` es el tiempo de reloj; `user` y `sys` son tiempo de CPU. Útil para comparar dos formas de hacer lo mismo.',
        par: 1,
        commands: ['time'],
      }),
      practice({
        goal: 'Limita el tiempo',
        prompt: 'Ejecuta `sleep 10` pero **abórtalo a los 2 segundos** con `timeout` y muestra el código de salida (`echo $?`). Debe salir **124**.',
        check: all(ran('^echo \\$\\?$'), outEq('124')),
        solution: ['timeout 2 sleep 10', 'echo $?'],
        hints: ['`timeout SEGUNDOS comando`.', '`timeout 2 sleep 10` y luego `echo $?`'],
        explain: 'En scripts, `timeout` evita que un comando colgado bloquee todo (una descarga, una conexión…).',
        par: 2,
        commands: ['timeout'],
      }),
      practice({
        goal: 'Baja la prioridad',
        prompt: 'Hay un proceso `sleep 1000` en marcha. **Cambia su prioridad (nice) a 5** con `renice` (necesitas sudo). Debe indicar `new priority 5`.',
        setup: { procs: [['alumno', 'sleep 1000', 0, 0.1]] },
        check: all(ran('renice'), out('new priority 5')),
        solution: ['sudo renice -n 5 -p $(pgrep sleep)'],
        hints: ['`renice -n VALOR -p PID`; el PID lo da `pgrep`.', '`sudo renice -n 5 -p $(pgrep sleep)`'],
        explain: 'Así evitas que un trabajo pesado (backup, compresión) estorbe a los servicios importantes.',
        par: 1,
        commands: ['renice'],
      }),
      practice({
        goal: '¿Quién usa el puerto 22?',
        prompt: 'Instala **lsof** y averigua **qué proceso escucha en el puerto 22** (`sudo lsof -i :22`). Debe aparecer `sshd`.',
        check: all(pkg('lsof'), ran('lsof -i :22'), out('sshd')),
        solution: ['sudo apt install -y lsof', 'sudo lsof -i :22'],
        hints: ['Primero instala el paquete `lsof`.', '`sudo apt install -y lsof` y `sudo lsof -i :22`'],
        explain: 'Cuando un servicio no arranca porque "el puerto ya está en uso", `lsof -i :PUERTO` te dice quién lo ocupa.',
        par: 2,
        commands: ['apt', 'lsof'],
      }),
      order('Ordena: aborta `sleep 10` a los 3 segundos', ['timeout', '3', 'sleep', '10'], 'timeout 3 sleep 10', 'timeout + segundos + comando.'),
    ]),
  ],
  boss: {
    goal: 'Misión: guardia del servidor',
    prompt:
      '**Misión del dojo** 🥋\n\nDeja el servidor listo para la noche:\n\n1. Programa `/home/alumno/backup.sh` **todos los días a las 2:00** en tu crontab.\n2. **Bloquea** la cuenta de **ana**.\n3. En `/etc/ssh/sshd_config` pon **`PermitRootLogin no`** y reinicia el servicio **ssh**.',
    setup: { cwd: '/home/alumno', users: { ana: ['users'] }, files: BACKUP_SH },
    check: all(
      crontabHas('0 2 * * * /home/alumno/backup.sh'),
      ran('^sudo passwd -l ana$'),
      content('/etc/ssh/sshd_config', { includes: 'PermitRootLogin no' }),
      ran('systemctl restart ssh'),
    ),
    solution: [
      'printf "0 2 * * * /home/alumno/backup.sh\\n" | crontab -',
      'sudo passwd -l ana',
      "sudo sed -i 's/^PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config",
      'sudo systemctl restart ssh',
    ],
    hints: ['Cron: `printf "0 2 * * * /home/alumno/backup.sh\\n" | crontab -`.', '`sudo passwd -l ana`.', '`sed -i` sobre sshd_config y `sudo systemctl restart ssh`.'],
    explain: '¡Zona 11 completada! Programar, vigilar, proteger y medir: el día a día de un sysadmin. Queda la prueba final: la Maestría.',
    par: 4,
    commands: ['crontab', 'passwd', 'sed', 'systemctl'],
  },
});
