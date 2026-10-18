import { all, any, exists, missing, not, out, pkg, ran, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd, world } from '../build';

const PROYECTO = {
  '/home/alumno/proyecto/a.txt': 'aaaa\n',
  '/home/alumno/proyecto/docs/b.txt': 'bbbb\n',
  '/home/alumno/proyecto/img/logo.png': { content: 'x', size: 50000 },
};

export const w9 = world({
  id: 'w9',
  index: 9,
  title: 'Paquetes y archivado',
  subtitle: 'Instala software, empaqueta y comprime',
  emoji: '📦',
  color: '#60A5FA',
  level: 'avanzado',
  intro:
    'En Linux casi no se descargan instaladores: el software viene en **paquetes** que un gestor instala, actualiza y elimina por ti. Además aprenderás a empaquetar y comprimir archivos con **tar**, **gzip** y **zip**: la base de los backups.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w9-1', { title: 'apt: instalar software', summary: 'update, install, remove, search y upgrade', emoji: '🛍️', commands: ['apt'], minutes: 8 }, [
      learn('El gestor de paquetes', `
En Debian y Ubuntu el gestor de paquetes es **apt**. Un **paquete** es un programa empaquetado con todo lo que necesita y la lista de **dependencias** (otros paquetes que requiere). apt las resuelve solo.

Los programas se descargan de **repositorios** (servidores oficiales). Antes de instalar conviene **refrescar la lista** de lo disponible.

| Comando | Efecto |
|---|---|
| \`sudo apt update\` | Actualiza la **lista** de paquetes disponibles |
| \`sudo apt upgrade\` | Instala las **versiones nuevas** de lo que ya tienes |
| \`sudo apt install tree\` | Instala un paquete (\`-y\` responde sí a todo) |
| \`sudo apt remove tree\` | Desinstala (conserva la configuración) |
| \`sudo apt purge tree\` | Desinstala **y borra** la configuración |
| \`sudo apt autoremove\` | Quita dependencias que ya nadie usa |
| \`apt search palabra\` | Busca paquetes |
| \`apt show tree\` | Información de un paquete |

> CLAVE: **update ≠ upgrade.** \`update\` solo refresca el catálogo; \`upgrade\` es lo que actualiza el software.
`, '🛍️'),
      illus('apt-flow', 'Qué pasa al instalar', 'apt consulta el repositorio, descarga el paquete y sus dependencias, y los instala.'),
      demo('Instalando software', [
        ['sudo apt update', 'Refresca la lista de paquetes'],
        ['apt list --upgradable', 'Qué puede actualizarse'],
        ['apt search tree | head -n 4', 'Busca un programa'],
        ['apt show tree', 'Ficha del paquete'],
        ['sudo apt install -y tree', 'Instala tree'],
        ['tree /home/alumno', 'Ya lo tienes'],
        ['sudo apt remove -y tree', 'Y lo quitas'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué hace `sudo apt update`?', ['Actualiza todos los programas instalados', 'Refresca la lista de paquetes disponibles', 'Instala el sistema operativo nuevo', 'Borra paquetes antiguos'], 1, 'Solo descarga el catálogo. Para actualizar programas se usa `apt upgrade`.'),
      mc('¿Cuál borra el programa **y su configuración**?', ['apt remove', 'apt purge', 'apt autoremove', 'apt clean'], 1, '`remove` deja los archivos de configuración; `purge` los elimina también.'),
      practice({
        goal: 'Actualiza el catálogo',
        prompt: 'Refresca la lista de paquetes disponibles (con privilegios).',
        check: all(ran('^sudo apt update$'), out('Reading package lists')),
        solution: ['sudo apt update'],
        hints: ['Requiere `sudo` y la palabra "update".', '`sudo apt update`'],
        explain: 'Haz `update` antes de instalar en una máquina que lleve tiempo apagada: así obtienes las versiones más recientes.',
        par: 1,
        commands: ['apt'],
      }),
      practice({
        goal: 'Instala tree',
        prompt: 'Instala el paquete **tree** sin que te pida confirmación (`-y`).',
        check: pkg('tree'),
        solution: ['sudo apt install -y tree'],
        hints: ['Necesitas sudo, `install`, `-y` y el nombre.', '`sudo apt install -y tree`'],
        explain: '`-y` es imprescindible en scripts, donde no hay nadie para teclear "S".',
        par: 1,
        commands: ['apt'],
      }),
      practice({
        goal: 'Busca un paquete',
        prompt: 'Busca paquetes relacionados con **cowsay**. Debe aparecer `cowsay` en los resultados.',
        check: all(any(ran('^apt search'), ran('^apt-cache search')), out('cowsay')),
        solution: ['apt search cowsay'],
        hints: ['`apt` tiene un subcomando para buscar.', '`apt search cowsay`'],
        explain: 'No se necesita sudo para consultar; solo para cambiar el sistema.',
        par: 1,
        commands: ['apt'],
      }),
      practice({
        goal: 'Instala y úsalo',
        prompt: 'Instala **cowsay** y haz que la vaca diga **Linux** (`cowsay Linux`).',
        check: all(pkg('cowsay'), used('cowsay'), out('Linux')),
        solution: ['sudo apt install -y cowsay', 'cowsay Linux'],
        hints: ['Dos pasos: instalar y ejecutar.', '`sudo apt install -y cowsay` y después `cowsay Linux`'],
        explain: 'Cuando un comando no existe ("command not found") suele bastar con `apt install` del paquete que lo trae.',
        par: 2,
        commands: ['apt', 'cowsay'],
      }),
      practice({
        goal: 'Desinstala un programa',
        prompt: 'El paquete **tree** está instalado. **Desinstálalo** sin confirmación.',
        setup: { packages: ['tree'] },
        check: pkg('tree', false),
        solution: ['sudo apt remove -y tree'],
        hints: ['El verbo es `remove`.', '`sudo apt remove -y tree`'],
        explain: 'Usa `purge` si también quieres eliminar los archivos de configuración.',
        par: 1,
        commands: ['apt'],
      }),
      fill('Completa: borra el paquete y su configuración', 'sudo apt ___ -y nginx', ['purge', 'remove', 'update', 'search'], ['purge'], '`purge` = remove + borrar configuración.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w9-2', { title: 'Qué hay instalado', summary: 'dpkg, apt list y a qué paquete pertenece cada cosa', emoji: '🔬', commands: ['dpkg', 'apt'], minutes: 7 }, [
      learn('apt y dpkg: hermanos', `
- **apt** es la herramienta **cómoda**: descarga, resuelve dependencias.
- **dpkg** es la herramienta **de bajo nivel** que realmente instala el archivo \`.deb\`. Sirve para **consultar** el sistema.

| Comando | Responde a… |
|---|---|
| \`dpkg -l\` | Lista **todo** lo instalado |
| \`dpkg -l \\| grep nginx\` | ¿Está instalado nginx? (\`ii\` = sí) |
| \`dpkg -L tree\` | ¿**Qué archivos** instala tree? |
| \`dpkg -S /bin/ls\` | ¿A **qué paquete** pertenece este archivo? |
| \`dpkg -s tree\` | Estado y datos de un paquete |
| \`apt list --installed\` | Lo instalado, con formato apt |

> NOTA: Un paquete \`.deb\` descargado a mano se instala con \`sudo dpkg -i archivo.deb\` (pero no resuelve dependencias: \`sudo apt install ./archivo.deb\` sí).
`, '🔬'),
      demo('Investigando', [
        ['dpkg -l | grep bash', 'ii = instalado correctamente'],
        ['dpkg -S /bin/ls', 'ls viene de coreutils'],
        ['dpkg -L tree', 'Archivos que instala tree'],
        ['dpkg -s tree | head -n 3', 'Su estado'],
        ['which tree', 'Su ejecutable'],
      ], { cwd: '/home/alumno', packages: ['tree'] }),
      mc('¿Qué comando te dice **a qué paquete pertenece** el archivo `/bin/ls`?', ['dpkg -l /bin/ls', 'dpkg -S /bin/ls', 'dpkg -L /bin/ls', 'apt show /bin/ls'], 1, '`dpkg -S` (search) busca el dueño de un archivo. `-L` hace lo contrario: lista los archivos de un paquete.'),
      predict('¿Qué paquete es el dueño de `/bin/ls`?', 'dpkg -S /bin/ls', ['bash', 'ls', 'util-linux'], '`ls` forma parte de **coreutils**, el paquete de las utilidades básicas de GNU.'),
      practice({
        goal: '¿Está instalado?',
        prompt: 'Comprueba si el paquete **bash** está instalado filtrando la salida de `dpkg -l`. Debe aparecer la línea de bash.',
        check: all(used('dpkg'), ran('dpkg -l.*\\|.*grep'), out('bash')),
        solution: ['dpkg -l | grep bash'],
        hints: ['Lista todo y filtra.', '`dpkg -l | grep bash`'],
        explain: 'El prefijo `ii` indica "deseado: instalado / estado: instalado". Es la forma clásica de comprobar un paquete.',
        par: 1,
        commands: ['dpkg'],
      }),
      practice({
        goal: '¿Qué instala tree?',
        prompt: 'Lista los **archivos que instala** el paquete `tree` (ya instalado). Debe aparecer `/usr/bin/tree`.',
        setup: { packages: ['tree'] },
        check: all(used('dpkg'), out('/usr/bin/tree')),
        solution: ['dpkg -L tree'],
        hints: ['Opción `-L` de listar archivos.', '`dpkg -L tree`'],
        explain: 'Muy útil para saber dónde quedó un binario o su configuración tras instalar.',
        par: 1,
        commands: ['dpkg'],
      }),
      practice({
        goal: '¿De quién es ls?',
        prompt: 'Averigua **a qué paquete pertenece** el archivo `/bin/ls`.',
        check: all(used('dpkg'), out('coreutils')),
        solution: ['dpkg -S /bin/ls'],
        hints: ['_Search_: la opción `-S`.', '`dpkg -S /bin/ls`'],
        explain: 'Cuando un archivo del sistema te sorprende, `dpkg -S` te dice qué paquete lo puso ahí.',
        par: 1,
        commands: ['dpkg'],
      }),
      practice({
        goal: 'Ficha de un paquete',
        prompt: 'Muestra la **información** del paquete `tree` con apt (versión, descripción…). Debe aparecer `Version`.',
        check: all(any(ran('^apt show'), ran('^apt info')), out('Version')),
        solution: ['apt show tree'],
        hints: ['Un subcomando de apt para mostrar fichas.', '`apt show tree`'],
        explain: '`apt show` te da versión, tamaño, dependencias y descripción antes de instalar.',
        par: 1,
        commands: ['apt'],
      }),
      match('Une cada comando con su pregunta', [['dpkg -l', '¿Qué está instalado?'], ['dpkg -L P', '¿Qué archivos instala P?'], ['dpkg -S F', '¿A qué paquete pertenece F?'], ['apt show P', '¿Qué es P?']], 'Con estas cuatro respondes casi cualquier duda sobre software instalado.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w9-3', { title: 'tar: empaquetar', summary: 'Crear, listar y extraer archivos .tar.gz', emoji: '🗃️', commands: ['tar'], minutes: 9 }, [
      learn('Una caja para muchos archivos', `
**tar** (_tape archive_) junta muchos archivos y carpetas en **un solo archivo** (un "tarball"). Por sí solo **no comprime**; se combina con gzip (\`z\`) o bzip2 (\`j\`).

Se usa con banderas que se escriben juntas (el guion es opcional):

| Bandera | Significa |
|---|---|
| \`c\` | **c**rear un archivo |
| \`x\` | e**x**traer |
| \`t\` | lis**t**ar el contenido |
| \`z\` | comprimir con g**z**ip (\`.tar.gz\`) |
| \`v\` | **v**erbose (mostrar archivos) |
| \`f\` | **f**ichero: el nombre va a continuación (¡siempre!) |
| \`-C dir\` | trabajar en **otra carpeta** |

\`\`\`
tar -czvf proyecto.tar.gz proyecto/     # CREAR
tar -tzvf proyecto.tar.gz               # LISTAR (sin extraer)
tar -xzvf proyecto.tar.gz               # EXTRAER aquí
tar -xzvf proyecto.tar.gz -C /tmp       # EXTRAER en /tmp
\`\`\`

> TIP: Memotecnia: **c**reate = **c**omprimir y empaquetar, e**x**tract = e**x**traer. Y **f** va pegada al nombre del archivo, siempre la última bandera.
`, '🗃️'),
      illus('tar-box', 'Muchos archivos, una caja', 'tar los une; gzip los comprime.'),
      demo('Crear, mirar y extraer', [
        ['tar -czvf proyecto.tar.gz proyecto', 'Crea el tarball comprimido'],
        ['ls -lh proyecto.tar.gz', 'Pesa muy poco'],
        ['tar -tzf proyecto.tar.gz', 'Mira dentro SIN extraer'],
        ['mkdir restaurado', 'Una carpeta destino'],
        ['tar -xzf proyecto.tar.gz -C restaurado', 'Extrae allí'],
        ['ls restaurado/proyecto', 'Todo está'],
      ], { cwd: '/home/alumno', files: PROYECTO }),
      mc('¿Qué bandera de tar sirve para **extraer**?', ['c', 'x', 't', 'z'], 1, '`x` = extract. `c` crea, `t` lista y `z` indica compresión gzip.'),
      mc('Quieres ver qué hay dentro de `datos.tar.gz` **sin extraerlo**. ¿Qué usas?', ['tar -xzf datos.tar.gz', 'tar -tzf datos.tar.gz', 'tar -czf datos.tar.gz', 'cat datos.tar.gz'], 1, '`t` = list. Es la comprobación segura antes de extraer (a veces un tarball se "desparrama" en la carpeta actual).'),
      order('Ordena: crear `copia.tar.gz` con la carpeta `datos`', ['tar', '-czf', 'copia.tar.gz', 'datos'], 'tar -czf copia.tar.gz datos', 'Opciones, luego el nombre del archivo resultante y al final lo que se empaqueta.'),
      practice({
        goal: 'Empaqueta el proyecto',
        prompt: 'Crea un archivo **proyecto.tar.gz** que contenga la carpeta `proyecto` (comprimido con gzip).',
        setup: { files: PROYECTO },
        check: all(exists('/home/alumno/proyecto.tar.gz', 'file'), ran('^tar .*c')),
        solution: ['tar -czvf proyecto.tar.gz proyecto'],
        hints: ['c (crear) + z (gzip) + f (archivo).', '`tar -czvf proyecto.tar.gz proyecto`'],
        explain: 'El nombre `.tar.gz` es convención: tar las junta y gzip las comprime.',
        par: 1,
        commands: ['tar'],
      }),
      practice({
        goal: 'Mira dentro sin extraer',
        prompt: 'Crea `p.tar.gz` con la carpeta `proyecto` y luego **lista su contenido** sin extraerlo. Debe verse `docs/b.txt`.',
        setup: { files: PROYECTO },
        check: all(ran('^tar .*t'), out('proyecto/docs/b.txt')),
        solution: ['tar -czf p.tar.gz proyecto', 'tar -tzf p.tar.gz'],
        hints: ['Primero créalo y después usa la bandera `t`.', '`tar -czf p.tar.gz proyecto` y `tar -tzf p.tar.gz`'],
        explain: 'Listar antes de extraer evita sorpresas (archivos sueltos o rutas absolutas peligrosas).',
        par: 2,
        commands: ['tar'],
      }),
      practice({
        goal: 'Extrae en otra carpeta',
        prompt: 'Crea `p.tar.gz` con `proyecto`, crea la carpeta **copia** y **extrae** el tarball **dentro de copia** (con `-C`).',
        setup: { files: PROYECTO },
        check: all(exists('/home/alumno/copia/proyecto/a.txt', 'file'), exists('/home/alumno/copia/proyecto/docs/b.txt', 'file')),
        solution: ['tar -czf p.tar.gz proyecto', 'mkdir copia', 'tar -xzf p.tar.gz -C copia'],
        hints: ['`-C` cambia a esa carpeta antes de extraer; debe existir.', '`mkdir copia` y `tar -xzf p.tar.gz -C copia`'],
        explain: '`-C` es la clave para restaurar copias de seguridad donde tú quieras.',
        par: 3,
        commands: ['tar', 'mkdir'],
      }),
      practice({
        goal: 'Un tar sin comprimir',
        prompt: 'Crea un archivo **solo.tar** con `proyecto` **sin compresión** (sin la bandera `z`).',
        setup: { files: PROYECTO },
        check: all(exists('/home/alumno/solo.tar', 'file'), not(ran('^tar .*z'))),
        solution: ['tar -cvf solo.tar proyecto'],
        hints: ['Igual que antes, pero sin `z`.', '`tar -cvf solo.tar proyecto`'],
        explain: 'Sin `z` tar solo empaqueta. Útil cuando los datos ya están comprimidos (fotos, vídeos).',
        par: 1,
        commands: ['tar'],
      }),
      tf('Con `tar -czf` el archivo resultante queda comprimido con gzip.', true, '`z` activa gzip. Para bzip2 sería `j` y para xz `J`.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w9-4', { title: 'Comprimir: gzip y zip', summary: 'gzip, gunzip, zip y unzip', emoji: '🗜️', commands: ['gzip', 'gunzip', 'zip', 'unzip', 'bzip2'], minutes: 7 }, [
      learn('Ahorra espacio', `
| Herramienta | Qué hace |
|---|---|
| \`gzip archivo\` | Comprime **un** archivo → \`archivo.gz\` (y **borra** el original) |
| \`gzip -k archivo\` | Igual, pero **conserva** el original |
| \`gunzip archivo.gz\` | Descomprime |
| \`zcat archivo.gz\` | Lee el contenido sin descomprimir |
| \`bzip2\` / \`bunzip2\` | Comprime más que gzip, algo más lento |
| \`zip -r a.zip carpeta\` | Crea un **.zip** (compatible con Windows/Mac) |
| \`unzip a.zip\` | Extrae un .zip (\`-d dir\` a otra carpeta, \`-l\` lista) |

> NOTA: \`gzip\` solo comprime **archivos sueltos**. Para carpetas se usa \`tar -z\` o \`zip -r\`. En un servidor nuevo puede que haga falta \`sudo apt install zip unzip\`.
`, '🗜️'),
      demo('Comprimiendo', [
        ['gzip -k notas.txt', 'Crea notas.txt.gz y conserva el original'],
        ['ls', 'Ambos existen'],
        ['zcat notas.txt.gz', 'Lee sin descomprimir'],
        ['zip -r proyecto.zip proyecto', 'Un zip de una carpeta'],
        ['unzip -l proyecto.zip', 'Mira dentro'],
        ['unzip proyecto.zip -d /tmp/destino', 'Extrae en otra carpeta'],
      ], { cwd: '/home/alumno', packages: ['zip', 'unzip'], files: { ...PROYECTO, '/home/alumno/notas.txt': 'hola mundo\n' } }),
      mc('¿Qué pasa con `notas.txt` al ejecutar `gzip notas.txt`?', ['Se conserva y se crea notas.txt.gz', 'Se reemplaza por notas.txt.gz', 'Se borra sin más', 'Se copia a /tmp'], 1, 'gzip sustituye el original por la versión comprimida. Con `-k` (keep) se conserva.'),
      mc('¿Qué herramienta comprime una **carpeta** en un formato legible en Windows?', ['gzip', 'zip', 'gunzip', 'wc'], 1, '`zip -r` crea archivos .zip universales; gzip solo sabe de archivos sueltos.'),
      practice({
        goal: 'Comprime un archivo',
        prompt: 'Comprime `notas.txt` con gzip. Debe quedar `notas.txt.gz` y **desaparecer** el original.',
        setup: { files: { '/home/alumno/notas.txt': 'hola mundo\n' } },
        check: all(exists('/home/alumno/notas.txt.gz', 'file'), missing('/home/alumno/notas.txt')),
        solution: ['gzip notas.txt'],
        hints: ['Es el comando más directo.', '`gzip notas.txt`'],
        explain: 'gzip sustituye al original. Si no quieres perderlo, `gzip -k`.',
        par: 1,
        commands: ['gzip'],
      }),
      practice({
        goal: 'Comprime conservando el original',
        prompt: 'Comprime `notas.txt` pero **conservando el original** (deben existir `notas.txt` y `notas.txt.gz`).',
        setup: { files: { '/home/alumno/notas.txt': 'hola mundo\n' } },
        check: all(exists('/home/alumno/notas.txt.gz', 'file'), exists('/home/alumno/notas.txt', 'file')),
        solution: ['gzip -k notas.txt'],
        hints: ['Hay una opción _keep_.', '`gzip -k notas.txt`'],
        explain: '`-k` (keep) evita perder el archivo original.',
        par: 1,
        commands: ['gzip'],
      }),
      practice({
        goal: 'Un zip de la carpeta',
        prompt: 'Crea **proyecto.zip** con la carpeta `proyecto` (recursivo).',
        setup: { packages: ['zip', 'unzip'], files: PROYECTO },
        check: all(exists('/home/alumno/proyecto.zip', 'file'), used('zip', ['-r'])),
        solution: ['zip -r proyecto.zip proyecto'],
        hints: ['Para carpetas hace falta `-r`.', '`zip -r proyecto.zip proyecto`'],
        explain: 'El nombre del zip va primero; después, lo que quieres incluir.',
        par: 1,
        commands: ['zip'],
      }),
      practice({
        goal: 'Extrae un zip en otra carpeta',
        prompt: 'Crea `p.zip` con `proyecto`, crea la carpeta **copia** y **extráelo allí** con `unzip -d`.',
        setup: { packages: ['zip', 'unzip'], files: PROYECTO },
        check: all(exists('/home/alumno/copia/proyecto/a.txt', 'file'), used('unzip')),
        solution: ['zip -r p.zip proyecto', 'mkdir copia', 'unzip p.zip -d copia'],
        hints: ['`unzip archivo -d carpeta`.', '`zip -r p.zip proyecto`, `mkdir copia`, `unzip p.zip -d copia`'],
        explain: '`-d` indica el directorio de destino (como `-C` en tar).',
        par: 3,
        commands: ['unzip'],
      }),
      match('Une cada herramienta con su función', [['gzip', 'Comprime un archivo'], ['gunzip', 'Descomprime un .gz'], ['zip -r', 'Comprime una carpeta en .zip'], ['unzip', 'Extrae un .zip']], 'Cada formato tiene su pareja de comprimir/descomprimir.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w9-5', { title: 'Copias de seguridad', summary: 'Backups con fecha, exclusiones y restauración', emoji: '🛟', commands: ['tar', 'date'], minutes: 8 }, [
      learn('Tu primer script de backup (a mano)', `
Una copia de seguridad que nunca probaste restaurar **no es una copia**. La receta básica:

1. **Empaqueta y comprime** con un nombre que incluya la **fecha**.
2. **Verifica** su contenido (\`tar -tzf\`).
3. **Restaura** en una carpeta de prueba para comprobar.

El nombre con fecha se genera con **sustitución de comandos**:

\`\`\`
tar -czf backup-$(date +%F).tar.gz proyecto
\`\`\`

\`date +%F\` devuelve \`2026-03-14\`, así que cada día genera un archivo distinto.

Para **excluir** cosas pesadas o innecesarias:

\`\`\`
tar -czf backup.tar.gz --exclude='*.png' --exclude='node_modules' proyecto
\`\`\`

> CLAVE: Regla **3-2-1**: 3 copias, en 2 soportes distintos, 1 fuera de casa. Con \`scp\` o \`rsync\` puedes llevar el tarball a otro equipo.
`, '🛟'),
      demo('Un backup completo', [
        ['date +%F', 'La fecha en formato ISO'],
        ['tar -czf backup-$(date +%F).tar.gz proyecto', 'Backup con fecha en el nombre'],
        ['ls *.tar.gz', 'Aquí está'],
        ['tar -tzf backup-$(date +%F).tar.gz', 'Verifica su contenido'],
        ['tar -czf ligero.tar.gz --exclude="*.png" proyecto', 'Otro, sin imágenes'],
        ['tar -tzf ligero.tar.gz', 'No contiene logo.png'],
      ], { cwd: '/home/alumno', files: PROYECTO }),
      mc('¿Qué genera `backup-$(date +%F).tar.gz` hoy 14 de marzo de 2026?', ['backup-$(date +%F).tar.gz', 'backup-2026-03-14.tar.gz', 'backup-14-03.tar.gz', 'backup-date.tar.gz'], 1, '`$(…)` ejecuta el comando y sustituye su salida: `date +%F` da `2026-03-14`.'),
      practice({
        goal: 'Backup con fecha',
        prompt: 'Crea una copia comprimida de `proyecto` llamada **backup-FECHA.tar.gz**, generando la fecha con `$(date +%F)` en el nombre.',
        setup: { files: PROYECTO },
        check: all(exists('/home/alumno/backup-2026-03-14.tar.gz', 'file'), ran('\\$\\(date')),
        solution: ['tar -czf backup-$(date +%F).tar.gz proyecto'],
        hints: ['Combina `tar -czf` con una sustitución de comandos en el nombre.', '`tar -czf backup-$(date +%F).tar.gz proyecto`'],
        explain: 'Los backups con fecha en el nombre no se pisan entre sí y se ordenan solos con `ls`.',
        par: 1,
        commands: ['tar', 'date'],
      }),
      practice({
        goal: 'Backup sin imágenes',
        prompt: 'Crea **ligero.tar.gz** con `proyecto` **excluyendo los .png** (`--exclude`), y comprueba su contenido: no debe aparecer `logo.png`.',
        setup: { files: PROYECTO },
        check: all(ran('--exclude'), ran('^tar .*-?t'), out('proyecto/a.txt'), not(out('logo.png'))),
        solution: ["tar -czf ligero.tar.gz --exclude='*.png' proyecto", 'tar -tzf ligero.tar.gz'],
        hints: ['`--exclude` acepta patrones (entre comillas).', "`tar -czf ligero.tar.gz --exclude='*.png' proyecto` y luego `tar -tzf ligero.tar.gz`"],
        explain: 'Excluir cachés, `node_modules` o vídeos reduce muchísimo el tamaño de un backup.',
        par: 2,
        commands: ['tar'],
      }),
      practice({
        goal: 'Prueba de restauración',
        prompt: 'Haz un backup `b.tar.gz` de `proyecto`, **bórralo** (`rm -r proyecto`) y **restáuralo** desde el backup en la carpeta actual. Debe existir de nuevo `proyecto/a.txt`.',
        setup: { files: PROYECTO },
        check: all(exists('/home/alumno/proyecto/a.txt', 'file'), exists('/home/alumno/b.tar.gz', 'file'), ran('^rm -r')),
        solution: ['tar -czf b.tar.gz proyecto', 'rm -r proyecto', 'tar -xzf b.tar.gz'],
        hints: ['Crea, borra y extrae.', '`tar -czf b.tar.gz proyecto`, `rm -r proyecto`, `tar -xzf b.tar.gz`'],
        explain: 'Así se prueba un backup: borrar y restaurar. Si nunca lo has restaurado, no sabes si funciona.',
        par: 3,
        commands: ['tar', 'rm'],
      }),
      multi('¿Qué forma parte de un buen backup?', ['Nombre con fecha', 'Verificar el contenido', 'Probar la restauración', 'Guardarlo solo en el mismo disco'], [0, 1, 2], 'Si el backup está en el mismo disco que los originales, un fallo del disco lo pierde todo.'),
      typeCmd('Escribe la parte que falta: `tar ___ backup.tar.gz datos` para **crear** un backup comprimido', ['tar -czf backup.tar.gz datos', 'tar czf backup.tar.gz datos', 'tar -zcf backup.tar.gz datos'], 'Crear + gzip + fichero: `czf`.'),
    ]),
  ],
  boss: {
    goal: 'Misión: instala, respalda y restaura',
    prompt:
      '**Misión del dojo** 🥋\n\n1. Instala **tree** (`apt`).\n2. Haz un backup **respaldo.tar.gz** de la carpeta `proyecto`.\n3. **Borra** la carpeta `proyecto` original.\n4. Crea la carpeta **restaurado** y **extrae ahí** el backup.',
    setup: { cwd: '/home/alumno', files: PROYECTO },
    check: all(pkg('tree'), exists('/home/alumno/respaldo.tar.gz', 'file'), missing('/home/alumno/proyecto'), exists('/home/alumno/restaurado/proyecto/docs/b.txt', 'file')),
    solution: ['sudo apt install -y tree', 'tar -czf respaldo.tar.gz proyecto', 'rm -r proyecto', 'mkdir restaurado', 'tar -xzf respaldo.tar.gz -C restaurado'],
    hints: ['`sudo apt install -y tree`.', '`tar -czf respaldo.tar.gz proyecto` y después `rm -r proyecto`.', '`mkdir restaurado` y `tar -xzf respaldo.tar.gz -C restaurado`.'],
    explain: '¡Zona 9 completada! Instalas software, empaquetas, comprimes y sabes restaurar. Siguiente: scripting en bash.',
    par: 5,
    commands: ['apt', 'tar'],
  },
});

