import { all, any, exists, groupExists, mode, not, out, outEq, outRe, owner, ran, used, userExists } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, world } from '../build';

export const w5 = world({
  id: 'w5',
  index: 5,
  title: 'Permisos y usuarios',
  subtitle: 'Quién puede hacer qué en el sistema',
  emoji: '🔐',
  color: '#FB7185',
  level: 'intermedio',
  intro:
    'Linux es un sistema **multiusuario**: cada archivo tiene dueño y reglas sobre quién puede leerlo, modificarlo o ejecutarlo. Entender permisos es la base de la seguridad. Aquí aprenderás a leerlos, cambiarlos y a gestionar usuarios y grupos.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w5-1', { title: 'Leer permisos', summary: 'Qué significa -rwxr-xr-x', emoji: '👁️', commands: ['ls', 'id', 'groups'], minutes: 8 }, [
      learn('Cada archivo tiene dueño y reglas', `
Con \`ls -l\` ves los permisos de cada archivo:

\`\`\`
-rwxr-xr-- 1 alumno devs 220 Mar 11 script.sh
│└┬┘└┬┘└┬┘   │      │
│ │  │  │    │      └ grupo propietario
│ │  │  │    └ usuario propietario
│ │  │  └ permisos para OTROS
│ │  └ permisos para el GRUPO
│ └ permisos para el DUEÑO
└ tipo (- archivo, d carpeta, l enlace)
\`\`\`

Cada trío son tres letras: **r** (leer), **w** (escribir), **x** (ejecutar). Un guion \`-\` significa "sin ese permiso".
`, '👁️'),
      illus('ls-long', 'Anatomía de ls -l', 'Toca cada columna para ver qué significa.'),
      illus('perm-bits', 'Los bits r w x', 'Cada permiso vale un número: r=4, w=2, x=1.'),
      learn('En carpetas, los permisos significan otra cosa', `
| Permiso | En un **archivo** | En una **carpeta** |
|---|---|---|
| **r** | Leer el contenido | Listar lo que contiene (\`ls\`) |
| **w** | Modificarlo | Crear, borrar y renombrar dentro |
| **x** | Ejecutarlo como programa | **Entrar** en ella (\`cd\`) y acceder a lo de dentro |

> CLAVE: Para poder **borrar** un archivo no necesitas permiso sobre el archivo, sino **w sobre su carpeta**.
`),
      demo('Mirando permisos', [
        ['ls -l', 'Permisos de todo lo de la carpeta'],
        ['ls -ld Documents', '-d muestra la carpeta en sí, no su contenido'],
        ['ls -l /etc/shadow', 'Un archivo muy protegido: solo root (y grupo shadow) lo leen'],
        ['id', 'Tu usuario y tus grupos'],
        ['groups', 'Solo los grupos'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/script.sh': { content: '#!/bin/bash\necho hola\n', mode: 0o755 }, '/home/alumno/secreto.txt': { content: 'clave\n', mode: 0o600 } } }),
      mc('Un archivo tiene `-rw-r-----`. ¿Quién puede **leerlo**?', ['Solo el dueño', 'El dueño y el grupo', 'Todo el mundo', 'Nadie'], 1, 'El primer trío (dueño) tiene `rw-`, el segundo (grupo) `r--` y el tercero (otros) `---`: leen dueño y grupo.'),
      mc('¿Qué indica la primera letra `d` en `drwxr-xr-x`?', ['Que está borrado', 'Que es un directorio', 'Que es de depuración', 'Que es de datos'], 1, 'El primer carácter es el tipo: `-` archivo, `d` directorio, `l` enlace simbólico.'),
      predict('¿Qué permisos muestra el archivo? (solo los 10 primeros caracteres)', 'ls -l secreto.txt | cut -c1-10', ['-rw-r--r--', '-rwx------', '----------'], 'El archivo está en 600: lee y escribe solo su dueño (`rw-`) y nadie más.', { cwd: '/home/alumno', files: { '/home/alumno/secreto.txt': { content: 'clave\n', mode: 0o600 } } }),
      practice({
        goal: 'Inspecciona un archivo protegido',
        prompt: 'Muestra en formato largo los permisos de **/etc/shadow** (el archivo con las contraseñas cifradas). Debe verse que otros **no** tienen ningún permiso.',
        check: all(used('ls', ['-l']), outRe('^-rw-r-----.*shadow')),
        solution: ['ls -l /etc/shadow'],
        hints: ['Usa `ls` con la opción de formato largo.', '`ls -l /etc/shadow`'],
        explain: '`rw-r-----` = 640: el dueño (root) lee y escribe, el grupo (shadow) lee y los demás no tienen acceso. Por eso un usuario normal no puede leer contraseñas.',
        par: 1,
        commands: ['ls'],
      }),
      practice({
        goal: '¿A qué grupos perteneces?',
        prompt: 'Muestra los **grupos** a los que pertenece tu usuario (debe aparecer `sudo`).',
        check: all(any(used('groups'), used('id')), out('sudo')),
        solution: ['groups'],
        hints: ['Hay un comando con ese nombre y otro más completo (`id`).', '`groups` o `id`'],
        explain: 'Los grupos amplían tus permisos: pertenecer a `sudo` te permite administrar el sistema.',
        par: 1,
        commands: ['groups', 'id'],
      }),
      match('Une cada letra con su permiso', [['r', 'Leer'], ['w', 'Escribir'], ['x', 'Ejecutar'], ['-', 'Sin permiso']], 'Estas cuatro letras forman todos los permisos de Linux.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w5-2', { title: 'chmod: cambiar permisos', summary: 'Notación simbólica (u+x) y octal (755)', emoji: '🛠️', commands: ['chmod', 'umask'], minutes: 10 }, [
      learn('Dos formas de decirlo', `
\`chmod\` (_change mode_) cambia los permisos. Puedes usar **letras** o **números**.

**Simbólica** — \`quién  +/-/=  qué\`:

| Quién | Operación | Permiso |
|---|---|---|
| \`u\` dueño | \`+\` añade | \`r\` leer |
| \`g\` grupo | \`-\` quita | \`w\` escribir |
| \`o\` otros | \`=\` fija | \`x\` ejecutar |
| \`a\` todos | | |

\`\`\`
chmod u+x script.sh        # el dueño puede ejecutarlo
chmod go-w datos.txt       # grupo y otros pierden escritura
chmod a+r leeme.txt        # todos pueden leer
\`\`\`
`, '🛠️'),
      learn('Numérica (octal)', `
Cada permiso vale un número: **r = 4**, **w = 2**, **x = 1**. Se suman por cada trío:

| Permisos | Cálculo | Octal |
|---|---|---|
| \`rwx\` | 4+2+1 | **7** |
| \`rw-\` | 4+2 | **6** |
| \`r-x\` | 4+1 | **5** |
| \`r--\` | 4 | **4** |

Se escriben tres cifras (dueño, grupo, otros):

- **755** = \`rwxr-xr-x\` → programas y carpetas públicas.
- **644** = \`rw-r--r--\` → archivos normales.
- **600** = \`rw-------\` → privado (claves SSH).
- **700** = \`rwx------\` → carpeta privada.

> TIP: \`chmod -R 755 carpeta\` aplica los permisos a la carpeta **y a todo lo que contiene**.
`),
      demo('Cambiando permisos', [
        ['ls -l script.sh', 'Sin permiso de ejecución'],
        ['./script.sh', 'No se puede ejecutar'],
        ['chmod +x script.sh', 'Le damos x'],
        ['ls -l script.sh', 'Ahora tiene x'],
        ['./script.sh', 'Funciona'],
        ['chmod 600 secreto.txt', 'Solo yo puedo leerlo y escribirlo'],
        ['ls -l secreto.txt', 'rw-------'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/script.sh': { content: '#!/bin/bash\necho "¡Hola desde el script!"\n', mode: 0o644 }, '/home/alumno/secreto.txt': { content: 'clave\n', mode: 0o644 } } }),
      mc('¿Qué permisos da `chmod 644 archivo`?', ['rwxr-xr-x', 'rw-r--r--', 'rw-rw-rw-', 'rwx------'], 1, '6 = rw-, 4 = r--, 4 = r--. Dueño lee y escribe; los demás solo leen.'),
      mc('¿Cuál es el valor octal de `rwxr-x---`?', ['750', '755', '640', '705'], 0, 'rwx = 7, r-x = 5, --- = 0 → 750.'),
      practice({
        goal: 'Haz ejecutable el script',
        prompt: 'El script `script.sh` no tiene permiso de ejecución (`./script.sh` da "Permission denied"). Hazlo **ejecutable** y lánzalo.',
        setup: { files: { '/home/alumno/script.sh': { content: '#!/bin/bash\necho "Listo!"\n', mode: 0o644 } } },
        check: all(mode('/home/alumno/script.sh', '755'), out('Listo!')),
        solution: ['chmod +x script.sh', './script.sh'],
        hints: ['Necesitas añadir el permiso de ejecución.', '`chmod +x script.sh` y después `./script.sh`'],
        explain: 'Sin `x` un script no se puede ejecutar directamente. `chmod +x` es de los comandos más usados en la vida real.',
        par: 2,
        commands: ['chmod'],
      }),
      practice({
        goal: 'Privado: 600',
        prompt: 'Deja `secreto.txt` de forma que **solo tú** puedas leerlo y escribirlo (modo **600**).',
        setup: { files: { '/home/alumno/secreto.txt': { content: 'clave\n', mode: 0o644 } } },
        check: mode('/home/alumno/secreto.txt', '600'),
        solution: ['chmod 600 secreto.txt'],
        hints: ['6 = rw-, 0 = sin permisos.', '`chmod 600 secreto.txt`'],
        explain: '600 es el modo estándar para claves privadas (por ejemplo `~/.ssh/id_rsa`): SSH las rechaza si son más permisivas.',
        par: 1,
        commands: ['chmod'],
      }),
      practice({
        goal: 'Quita escritura a los demás',
        prompt: '`datos.txt` está en **666** (todos escriben). Quita el permiso de escritura al **grupo y a otros** usando notación simbólica; debe quedar en 644.',
        setup: { files: { '/home/alumno/datos.txt': { content: 'datos\n', mode: 0o666 } } },
        check: all(mode('/home/alumno/datos.txt', '644'), ran('chmod .*[a-z]*-w')),
        solution: ['chmod go-w datos.txt'],
        hints: ['`g` es grupo, `o` otros, `-` quita, `w` escritura.', '`chmod go-w datos.txt`'],
        explain: 'La notación simbólica cambia solo lo que dices y deja el resto intacto. Con octal tendrías que fijar todo de nuevo.',
        par: 1,
        commands: ['chmod'],
      }),
      practice({
        goal: 'Abre toda una carpeta',
        prompt: 'La carpeta **web** (y todo lo que tiene dentro) está en modo 700. Ponla en **755**, incluyendo su contenido, con un solo comando.',
        setup: { files: { '/home/alumno/web/': { dir: true, mode: 0o700 }, '/home/alumno/web/index.html': { content: '<h1>Hola</h1>', mode: 0o700 } } },
        check: all(mode('/home/alumno/web', '755'), mode('/home/alumno/web/index.html', '755')),
        solution: ['chmod -R 755 web'],
        hints: ['La opción `-R` es recursiva.', '`chmod -R 755 web`'],
        explain: '`-R` aplica el cambio a toda la jerarquía. Úsalo con cuidado: también pone `x` en archivos que no son programas.',
        par: 1,
        commands: ['chmod'],
      }),
      fill('Completa: dar permiso de ejecución', 'chmod ___ programa.sh', ['+x', '-x', '+w', '=r'], ['+x'], '`+x` añade ejecución para todos (según la umask).'),
      order('Ordena: hacer el archivo privado (solo dueño lee y escribe)', ['chmod', '600', 'clave.pem'], 'chmod 600 clave.pem', 'Primero chmod, luego el modo octal y por último el archivo.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w5-3', { title: 'Dueños: chown y chgrp', summary: 'Cambia el usuario y el grupo propietario', emoji: '🏷️', commands: ['chown', 'chgrp', 'sudo'], minutes: 7 }, [
      learn('Todo archivo pertenece a alguien', `
Cada archivo tiene un **usuario** dueño y un **grupo** propietario. Se ven en \`ls -l\`:

\`\`\`
-rw-r--r-- 1 ana  users  120 Mar 11 informe.txt
              └┬┘ └─┬─┘
            dueño  grupo
\`\`\`

Para cambiarlos:

| Comando | Qué cambia |
|---|---|
| \`chown ana archivo\` | El **usuario** dueño |
| \`chown ana:users archivo\` | Usuario **y** grupo |
| \`chown :users archivo\` | Solo el grupo |
| \`chgrp users archivo\` | Solo el grupo |
| \`chown -R ana carpeta\` | Recursivo |

> CLAVE: Normalmente solo **root** puede regalar archivos a otro usuario, así que verás \`sudo chown …\`. Un usuario sí puede cambiar el grupo de sus archivos a un grupo al que pertenece.
`, '🏷️'),
      demo('Cambiando de manos', [
        ['ls -l informe.txt', 'Dueño actual: alumno'],
        ['sudo chown ana informe.txt', 'Ahora es de ana'],
        ['ls -l informe.txt', 'Comprobamos'],
        ['sudo chown ana:users informe.txt', 'Usuario y grupo a la vez'],
        ['ls -l informe.txt', 'ana:users'],
      ], { cwd: '/home/alumno', users: { ana: ['users'] }, files: { '/home/alumno/informe.txt': 'datos\n' } }),
      mc('¿Qué hace `sudo chown ana:users archivo`?', ['Da el archivo a ana y a users', 'Pone a ana de dueño y a users de grupo', 'Copia el archivo', 'Cambia los permisos a ana'], 1, 'La sintaxis es `usuario:grupo`. Cambia ambos propietarios a la vez.'),
      tf('Cualquier usuario puede regalar sus archivos a otro con `chown`.', false, 'Solo root puede cambiar el dueño de un archivo. Por eso se usa `sudo chown`.'),
      practice({
        goal: 'Cambia el dueño',
        prompt: 'Haz que el archivo **informe.txt** pertenezca al usuario **ana**.',
        setup: { users: { ana: ['users'] }, files: { '/home/alumno/informe.txt': 'datos\n' } },
        check: owner('/home/alumno/informe.txt', 'ana'),
        solution: ['sudo chown ana informe.txt'],
        hints: ['Necesitas privilegios de administrador y el comando de _change owner_.', '`sudo chown ana informe.txt`'],
        explain: '`chown usuario archivo` cambia el propietario. Sin `sudo` te diría "Operation not permitted".',
        par: 1,
        commands: ['chown'],
      }),
      practice({
        goal: 'Usuario y grupo',
        prompt: 'Deja **datos.csv** con el usuario **ana** y el grupo **users**, en un único comando.',
        setup: { users: { ana: ['users'] }, files: { '/home/alumno/datos.csv': 'a,b\n' } },
        check: owner('/home/alumno/datos.csv', 'ana', 'users'),
        solution: ['sudo chown ana:users datos.csv'],
        hints: ['Usa la forma `usuario:grupo`.', '`sudo chown ana:users datos.csv`'],
        explain: 'Con `usuario:grupo` cambias ambos a la vez; con `:grupo` solo el grupo.',
        par: 1,
        commands: ['chown'],
      }),
      practice({
        goal: 'Solo el grupo',
        prompt: 'Cambia **únicamente el grupo** de `proyecto` (y todo su contenido) a **users**. Usa `chgrp` con la opción recursiva.',
        setup: { files: { '/home/alumno/proyecto/a.txt': 'a', '/home/alumno/proyecto/sub/b.txt': 'b' } },
        check: all(owner('/home/alumno/proyecto', undefined, 'users'), owner('/home/alumno/proyecto/sub/b.txt', undefined, 'users')),
        solution: ['chgrp -R users proyecto'],
        hints: ['`chgrp grupo ruta`, con `-R` para el contenido.', '`chgrp -R users proyecto`'],
        explain: 'Como alumno perteneces a `users`, puedes asignar ese grupo a tus propios archivos sin sudo.',
        par: 1,
        commands: ['chgrp'],
      }),
      fill('Completa para cambiar usuario y grupo', 'sudo chown ana___users doc.txt', [':', '.', ',', '/'], [':'], 'La sintaxis es `usuario:grupo`.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w5-4', { title: 'sudo y el superusuario', summary: 'Poder con responsabilidad', emoji: '🦸', commands: ['sudo', 'su', 'whoami'], minutes: 7 }, [
      learn('root lo puede todo', `
El usuario **root** (UID 0) es el superusuario: ignora casi todos los permisos. Puede borrar el sistema entero con un comando mal escrito.

Por eso **no se trabaja como root**. Se trabaja como usuario normal y se pide poder **solo para un comando** con **sudo** (_superuser do_):

\`\`\`
$ cat /etc/shadow
cat: /etc/shadow: Permission denied
$ sudo cat /etc/shadow
root:$y$j9T$…
\`\`\`
`, '🦸'),
      illus('sudo-flow', '¿Cómo funciona sudo?', 'sudo comprueba que tengas permiso y ejecuta el comando como root.'),
      learn('Trucos con sudo', `
| Comando | Efecto |
|---|---|
| \`sudo cmd\` | Ejecuta **solo ese comando** como root |
| \`sudo !!\` | Repite el último comando con sudo |
| \`sudo -l\` | Lista lo que tienes permitido |
| \`sudo -u ana cmd\` | Ejecuta como otro usuario |
| \`sudo -i\` | Abre una shell de root (cuidado) |
| \`su - ana\` | Cambia de usuario (pide su contraseña) |

Quién puede usar sudo lo decide el archivo \`/etc/sudoers\` (se edita con \`sudo visudo\`) o pertenecer al grupo **sudo**.

> OJO: **Piensa antes de escribir sudo.** Con él no hay red de seguridad: \`sudo rm -rf\` hace exactamente lo que dices.
`),
      demo('Antes y después de sudo', [
        ['whoami', 'Eres alumno'],
        ['cat /etc/shadow', 'Sin permiso'],
        ['sudo !!', '!! repite el comando anterior, pero con sudo'],
        ['sudo whoami', 'Dentro de sudo eres root'],
        ['sudo -l', 'Lo que tienes permitido'],
      ], { cwd: '/home/alumno' }),
      mc('¿Por qué no se recomienda trabajar siempre como root?', ['Es más lento', 'Un error o un malware tienen poder total sobre el sistema', 'root no puede usar la red', 'No existe en Linux'], 1, 'Con root un simple typo puede borrar el sistema. Con sudo el poder se limita a un comando concreto.'),
      mc('¿Qué hace `sudo !!`?', ['Repite el último comando como root', 'Abre una shell de root', 'Cierra la sesión', 'Cambia de usuario'], 0, '`!!` se sustituye por el comando anterior; con `sudo` delante se ejecuta con privilegios.'),
      practice({
        goal: 'Lee un archivo restringido',
        prompt: 'Muestra el contenido de **/etc/shadow** (solo root puede leerlo) usando `sudo`. Debe aparecer la línea de `root`.',
        check: all(used('sudo'), out('root:')),
        solution: ['sudo cat /etc/shadow'],
        hints: ['Antepón `sudo` al comando que ya conoces.', '`sudo cat /etc/shadow`'],
        explain: 'Con sudo ejecutas un único comando con permisos de administrador y vuelves a ser un usuario normal.',
        par: 1,
        commands: ['sudo'],
      }),
      practice({
        goal: 'Sudo sobre el comando anterior',
        prompt: 'Ejecuta `cat /etc/shadow` (fallará). Después **repítelo con privilegios** sin volver a escribirlo: usa `sudo !!`.',
        check: all(ran('^sudo cat /etc/shadow$'), out('root:')),
        solution: ['cat /etc/shadow', 'sudo !!'],
        hints: ['Primero ejecuta el comando normal.', 'Luego escribe `sudo !!`.'],
        explain: '`sudo !!` es el gesto clásico: «ups, me faltaba sudo». Te ahorra reescribir el comando.',
        par: 2,
        commands: ['sudo'],
      }),
      practice({
        goal: '¿Quién soy como root?',
        prompt: 'Ejecuta `whoami` **con sudo** para comprobar que el comando se ejecuta como root.',
        check: all(used('sudo'), outEq('root')),
        solution: ['sudo whoami'],
        hints: ['`sudo` + el comando que ya conoces.', '`sudo whoami`'],
        explain: 'Dentro del comando eres root (UID 0), pero tu sesión sigue siendo la del usuario normal.',
        par: 1,
        commands: ['sudo', 'whoami'],
      }),
      multi('Elige las afirmaciones **correctas** sobre sudo', ['Ejecuta un comando como root', 'Solo funciona para usuarios autorizados', 'Convierte permanentemente a tu usuario en root', 'Se configura en /etc/sudoers'], [0, 1, 3], 'sudo es temporal (solo ese comando) y depende de `/etc/sudoers` o del grupo sudo.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w5-5', { title: 'Usuarios y grupos', summary: 'useradd, usermod, groupadd y /etc/passwd', emoji: '👥', commands: ['useradd', 'usermod', 'groupadd', 'userdel', 'getent', 'passwd'], minutes: 9 }, [
      learn('Quién existe en el sistema', `
Los usuarios viven en \`/etc/passwd\` y los grupos en \`/etc/group\`. Cada línea de passwd tiene campos separados por \`:\`

\`\`\`
alumno:x:1000:1000:Alumno Linux:/home/alumno:/bin/bash
  │    │   │    │        │           │          └ shell
  │    │   │    │        │           └ carpeta personal
  │    │   │    │        └ comentario
  │    │   │    └ GID (grupo principal)
  │    │   └ UID
  │    └ contraseña (x = en /etc/shadow)
  └ nombre
\`\`\`

> NOTA: Los UID por debajo de 1000 son de **servicios del sistema** (www-data, syslog…). Los usuarios humanos empiezan en 1000.
`, '👥'),
      illus('users-groups', 'Usuarios y grupos', 'Un usuario tiene un grupo principal y puede pertenecer a otros.'),
      learn('Administrar usuarios', `
Todos requieren \`sudo\`:

| Comando | Para qué |
|---|---|
| \`useradd -m maria\` | Crea el usuario (\`-m\` crea su carpeta personal) |
| \`passwd maria\` | Fija su contraseña |
| \`groupadd dev\` | Crea un grupo |
| \`usermod -aG dev maria\` | **Añade** a maria al grupo dev |
| \`userdel -r maria\` | Borra el usuario (\`-r\` también su carpeta) |
| \`id maria\` / \`groups maria\` | Consulta sus grupos |

> OJO: En \`usermod -aG\` la **a** (_append_) es crucial. Sin ella, \`-G\` **reemplaza** todos los grupos del usuario.
`),
      demo('Un usuario nuevo', [
        ['sudo useradd -m maria', 'Crea a maria con su home'],
        ['id maria', 'Su identidad'],
        ['sudo groupadd dev', 'Crea el grupo dev'],
        ['sudo usermod -aG dev maria', 'Añade a maria a dev'],
        ['groups maria', 'Ahora pertenece a dev'],
        ['getent passwd maria', 'Su línea en /etc/passwd'],
        ['ls /home', 'Su carpeta personal'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué diferencia hay entre `usermod -G dev maria` y `usermod -aG dev maria`?', ['Ninguna', 'Sin `-a` se reemplazan todos los grupos secundarios', 'Con `-a` se borra el usuario', '`-a` es para crear grupos'], 1, '`-a` (append) añade al grupo conservando los demás. Olvidarla es un error clásico que quita a un usuario de sudo.'),
      predict('¿Cuántos campos separados por `:` tiene una línea de /etc/passwd? (`getent passwd alumno | tr : "\\n" | wc -l`)', 'getent passwd alumno | tr : "\\n" | wc -l', ['5', '6', '8'], 'Son 7 campos: nombre, x, UID, GID, comentario, home y shell.'),
      practice({
        goal: 'Crea un usuario',
        prompt: 'Crea el usuario **maria** **con su carpeta personal** (`/home/maria`).',
        check: all(userExists('maria'), exists('/home/maria', 'dir')),
        solution: ['sudo useradd -m maria'],
        hints: ['`useradd` con la opción que crea el home.', '`sudo useradd -m maria`'],
        explain: 'Sin `-m`, el usuario se crea pero no tiene carpeta personal.',
        par: 1,
        commands: ['useradd'],
      }),
      practice({
        goal: 'Grupo y miembro',
        prompt: 'Crea el grupo **dev** y añade a tu usuario **alumno** a él (sin quitarle sus otros grupos).',
        check: groupExists('dev', { member: 'alumno' }),
        solution: ['sudo groupadd dev', 'sudo usermod -aG dev alumno'],
        hints: ['Dos pasos: crear el grupo y añadir al usuario.', '`sudo groupadd dev` y `sudo usermod -aG dev alumno`'],
        explain: 'Los cambios de grupo se aplican al **siguiente inicio de sesión** del usuario.',
        par: 2,
        commands: ['groupadd', 'usermod'],
      }),
      practice({
        goal: 'Elimina un usuario',
        prompt: 'Elimina el usuario **bob** **y su carpeta personal**.',
        setup: { users: { bob: ['users'] } },
        check: all(not(userExists('bob')), not(exists('/home/bob'))),
        solution: ['sudo userdel -r bob'],
        hints: ['`userdel` con la opción de "remove".', '`sudo userdel -r bob`'],
        explain: '`-r` borra el directorio personal y el buzón. Sin ella, quedan archivos huérfanos.',
        par: 1,
        commands: ['userdel'],
      }),
      practice({
        goal: 'Consulta un usuario',
        prompt: 'Muestra la línea de **/etc/passwd** del usuario **ana** usando `getent` (o `grep`).',
        setup: { users: { ana: ['users'] } },
        check: all(any(used('getent'), used('grep')), out('ana:x:')),
        solution: ['getent passwd ana'],
        hints: ['`getent passwd NOMBRE` consulta la base de usuarios.', '`getent passwd ana`'],
        explain: '`getent` consulta la base de datos de usuarios del sistema (local o de red).',
        par: 1,
        commands: ['getent'],
      }),
      match('Une cada comando con su función', [['useradd', 'Crear usuario'], ['passwd', 'Cambiar contraseña'], ['groupadd', 'Crear grupo'], ['usermod -aG', 'Añadir a un grupo'], ['userdel', 'Borrar usuario']], 'Ya tienes la caja de herramientas de la gestión de usuarios.'),
    ]),
  ],
  boss: {
    goal: 'Misión: carpeta compartida del equipo',
    prompt:
      '**Misión del dojo** 🥋\n\nMonta una carpeta compartida para **ana** y **bob**:\n\n1. Crea el grupo **equipo** y añade a ana y a bob.\n2. Crea la carpeta **/srv/equipo**.\n3. Haz que su grupo propietario sea **equipo**.\n4. Permisos **770**: dueño y grupo todo; otros nada.',
    setup: { cwd: '/home/alumno', users: { ana: ['users'], bob: ['users'] } },
    check: all(
      groupExists('equipo', { member: 'ana' }),
      groupExists('equipo', { member: 'bob' }),
      exists('/srv/equipo', 'dir'),
      owner('/srv/equipo', undefined, 'equipo'),
      mode('/srv/equipo', '770'),
    ),
    solution: ['sudo groupadd equipo', 'sudo usermod -aG equipo ana', 'sudo usermod -aG equipo bob', 'sudo mkdir -p /srv/equipo', 'sudo chgrp equipo /srv/equipo', 'sudo chmod 770 /srv/equipo'],
    hints: ['Empieza por `sudo groupadd equipo` y dos `usermod -aG`.', 'Crea la carpeta con `sudo mkdir -p /srv/equipo`.', 'Luego `chgrp equipo` y `chmod 770`.'],
    explain: '¡Zona 5 completada! Este es exactamente el patrón de una carpeta de trabajo en equipo: grupo + permisos de grupo. Siguiente: procesos y sistema.',
    par: 6,
    commands: ['groupadd', 'usermod', 'chgrp', 'chmod'],
  },
});
