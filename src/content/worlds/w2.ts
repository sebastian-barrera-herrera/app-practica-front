import { all, content, exists, fileCount, missing, out, outRe, ran, used, not } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd, world } from '../build';

const DOCS = {
  '/home/alumno/Documents/poema.txt': 'Rosas son rojas\nLas violetas son azules\nLinux es genial\nY tú también lo serás\nPero sigue practicando\nCada día un comando\nHasta dominar la terminal\nSin miedo y sin prisa\nFin\nGracias por leer\n',
  '/home/alumno/Documents/informe.txt': 'Informe de ventas\nTotal: 4200\nEstado: aprobado\n',
};

export const w2 = world({
  id: 'w2',
  index: 2,
  title: 'Archivos y carpetas',
  subtitle: 'Crear, leer, copiar, mover y borrar',
  emoji: '📁',
  color: '#38BDF8',
  level: 'basico',
  intro:
    'Ya sabes moverte. Ahora toca construir: crear carpetas, escribir archivos, copiarlos, moverlos y —con cuidado— borrarlos. Es el 80 % del trabajo diario en una terminal.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w2-1', { title: 'Crear: mkdir y touch', summary: 'Haz carpetas y archivos vacíos', emoji: '🏗️', commands: ['mkdir', 'touch', 'rmdir'], minutes: 7 }, [
      learn('Dos verbos para construir', `
- \`mkdir\` → _make directory_: crea **carpetas**.
- \`touch\` → crea un **archivo vacío** (o actualiza la fecha de uno que ya existe).

\`\`\`
$ mkdir proyectos
$ touch notas.txt
\`\`\`

Puedes crear **varios a la vez**, separándolos con espacios: \`touch a.txt b.txt c.txt\`.

> TIP: Los nombres con espacios se complican. Usa guiones o guiones bajos: \`mi-proyecto\`, \`mi_proyecto\`.
`, '🏗️'),
      demo('Construyendo', [
        ['mkdir proyectos', 'Crea la carpeta proyectos'],
        ['cd proyectos', 'Entra en ella'],
        ['touch a.txt b.txt', 'Crea dos archivos vacíos de golpe'],
        ['ls -l', 'Tamaño 0: están vacíos'],
        ['mkdir -p web/css/vendor', '-p crea toda la cadena de carpetas'],
        ['ls -R', '-R lista recursivamente (entra en subcarpetas)'],
      ]),
      learn('La opción -p', `
Sin \`-p\`, \`mkdir\` falla si la carpeta padre no existe:

\`\`\`
$ mkdir escuela/mates/tareas
mkdir: cannot create directory 'escuela/mates/tareas': No such file or directory
\`\`\`

Con \`-p\` (_parents_) crea **todos los niveles que falten** y no se queja si ya existen.

> CLAVE: \`mkdir -p\` es el modo "hazlo y no me des problemas". Lo verás en casi todos los scripts.
`),
      mc('¿Qué hace `touch informe.txt` si el archivo **no existe**?', ['Da un error', 'Crea un archivo vacío', 'Abre un editor', 'Crea una carpeta'], 1, '`touch` crea el archivo vacío si no existe; si existe, solo actualiza su fecha de modificación.'),
      practice({
        goal: 'Crea tu carpeta de proyectos',
        prompt: 'Crea una carpeta llamada **proyectos** dentro de tu carpeta personal.',
        check: exists('/home/alumno/proyectos', 'dir'),
        solution: ['mkdir proyectos'],
        hints: ['El verbo es _make directory_.', '`mkdir proyectos`'],
        explain: '`mkdir nombre` crea una carpeta en el directorio actual. Si estás en tu home, queda en `/home/alumno/proyectos`.',
        par: 1,
        commands: ['mkdir'],
      }),
      practice({
        goal: 'Tres archivos de un golpe',
        prompt: 'Crea tres archivos vacíos en tu carpeta personal: **uno.txt**, **dos.txt** y **tres.txt**. Hazlo con **un solo comando**.',
        check: all(exists('/home/alumno/uno.txt', 'file'), exists('/home/alumno/dos.txt', 'file'), exists('/home/alumno/tres.txt', 'file'), ran('^touch', 1)),
        solution: ['touch uno.txt dos.txt tres.txt'],
        hints: ['`touch` acepta varios nombres separados por espacios.', '`touch uno.txt dos.txt tres.txt`'],
        explain: 'La mayoría de los comandos aceptan varios argumentos. Aprovéchalo: menos escritura, menos errores.',
        par: 1,
        commands: ['touch'],
      }),
      practice({
        goal: 'Una estructura anidada',
        prompt: 'Crea la ruta **escuela/mates/tareas** (tres niveles de carpetas) con **un solo comando**.',
        check: exists('/home/alumno/escuela/mates/tareas', 'dir'),
        solution: ['mkdir -p escuela/mates/tareas'],
        hints: ['Las carpetas padre todavía no existen: necesitas una opción especial.', '`mkdir -p escuela/mates/tareas`'],
        explain: '`-p` crea los padres que falten. Sin ella, `mkdir` solo puede crear un nivel cada vez.',
        par: 1,
        commands: ['mkdir'],
      }),
      typeCmd('Escribe el comando para crear un archivo vacío llamado **notas.txt**', ['touch notas.txt'], '`touch nombre` crea un archivo vacío.'),
      order('Ordena para crear la carpeta **fotos**', ['fotos', 'mkdir'], 'mkdir fotos', 'Primero el comando, luego su argumento.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w2-2', { title: 'Leer archivos', summary: 'cat, head, tail, less, wc y file', emoji: '👓', commands: ['cat', 'head', 'tail', 'less', 'wc', 'file'], minutes: 8 }, [
      learn('Mirar dentro sin abrir un editor', `
Casi todo en Linux son **archivos de texto**: configuración, registros, scripts. Con unos pocos comandos puedes leerlos desde la terminal:

| Comando | Qué hace |
|---|---|
| \`cat f\` | Imprime **todo** el archivo |
| \`head f\` | Las **primeras** 10 líneas |
| \`tail f\` | Las **últimas** 10 líneas |
| \`less f\` | Lectura paginada (↑↓, **q** para salir) |
| \`wc f\` | Cuenta líneas, palabras y bytes |
| \`file f\` | Dice **qué tipo** de archivo es |

> NOTA: \`cat\` viene de _concatenate_ (concatenar), porque también sirve para unir archivos.
`, '👓'),
      demo('Probando lectores', [
        ['cat informe.txt', 'Todo el contenido'],
        ['head -n 3 poema.txt', '-n elige cuántas líneas'],
        ['tail -n 2 poema.txt', 'Las dos últimas'],
        ['wc -l poema.txt', '-l cuenta solo líneas'],
        ['file poema.txt', 'Tipo de archivo'],
      ], { cwd: '/home/alumno/Documents', files: DOCS }),
      learn('tail: lo más nuevo está al final', `
Los **registros** (_logs_) añaden líneas nuevas **al final**. Por eso \`tail\` es el comando favorito de los administradores:

- \`tail -n 20 /var/log/syslog\` → las 20 últimas líneas.
- \`tail -f archivo.log\` → **sigue** el archivo y muestra las líneas nuevas en directo (sal con **Ctrl + C**).

> TIP: Para archivos largos usa \`less\`. Dentro: **espacio** avanza, **b** retrocede, **/texto** busca, **q** sale.
`),
      mc('Quieres ver **solo el final** de un archivo de registro enorme. ¿Qué usas?', ['cat', 'head', 'tail', 'touch'], 2, '`tail` muestra las últimas líneas (10 por defecto). `head` las primeras.'),
      predict('¿Qué muestra `wc -l poema.txt`?', 'wc -l poema.txt', ['poema.txt 10', '10', '10 líneas'], '`wc -l` imprime el número de líneas seguido del nombre del archivo.', { cwd: '/home/alumno/Documents', files: DOCS }),
      practice({
        goal: 'Lee las primeras líneas',
        prompt: 'En **Documents** hay un archivo `poema.txt`. Muestra solo sus **3 primeras líneas**.',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(used('head'), out('Linux es genial'), not(out('Sin miedo'))),
        solution: ['head -n 3 poema.txt'],
        hints: ['`head` muestra el principio del archivo.', '`head -n 3 poema.txt`'],
        explain: '`head -n N` muestra las primeras N líneas. También vale la forma corta `head -3`.',
        par: 1,
        commands: ['head'],
      }),
      practice({
        goal: 'Lee las últimas líneas',
        prompt: 'Muestra las **2 últimas líneas** de `poema.txt`.',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(used('tail'), out('Gracias por leer'), not(out('Sin miedo'))),
        solution: ['tail -n 2 poema.txt'],
        hints: ['El comando opuesto a `head`.', '`tail -n 2 poema.txt`'],
        explain: '`tail -n N` muestra las últimas N líneas: justo lo que quieres en un registro.',
        par: 1,
        commands: ['tail'],
      }),
      practice({
        goal: '¿Cuántas líneas tiene?',
        prompt: 'Cuenta las **líneas** de `poema.txt` (debe mostrar el número 10).',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(used('wc', ['-l']), outRe('^10\\b')),
        solution: ['wc -l poema.txt'],
        hints: ['`wc` = _word count_. Tiene una opción para líneas.', '`wc -l poema.txt`'],
        explain: '`wc -l` cuenta saltos de línea. Con pipes lo usarás constantemente: `ls | wc -l` cuenta cuántos archivos hay.',
        par: 1,
        commands: ['wc'],
      }),
      match('Une cada comando con su función', [['cat', 'Muestra todo el archivo'], ['head', 'Muestra el principio'], ['tail', 'Muestra el final'], ['wc -l', 'Cuenta líneas'], ['file', 'Detecta el tipo']], 'Con estos cinco inspeccionas cualquier archivo sin abrirlo.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w2-3', { title: 'Copiar y mover', summary: 'cp, mv y cómo renombrar', emoji: '🚚', commands: ['cp', 'mv'], minutes: 8 }, [
      learn('Origen → destino', `
Los dos comandos siguen el mismo patrón: **primero lo que quieres mover/copiar, luego a dónde**.

\`\`\`
cp ORIGEN DESTINO     # copia (el original se queda)
mv ORIGEN DESTINO     # mueve (el original desaparece)
\`\`\`

- Si el destino es una **carpeta existente**, el archivo entra dentro.
- Si el destino es un **nombre nuevo**, el archivo se crea (o renombra) con ese nombre.
- Para copiar **carpetas** hay que añadir \`-r\` (recursivo).

> CLAVE: En Linux **no existe "renombrar"**: renombrar es mover a un nombre nuevo. \`mv viejo.txt nuevo.txt\`.
`, '🚚'),
      demo('Copiar, mover, renombrar', [
        ['cp informe.txt informe-backup.txt', 'Copia con otro nombre'],
        ['mkdir archivo', 'Una carpeta destino'],
        ['mv informe-backup.txt archivo/', 'Mueve dentro de la carpeta (la barra final aclara que es carpeta)'],
        ['mv informe.txt informe-2024.txt', 'Renombrar = mover al mismo sitio con otro nombre'],
        ['cp -r archivo copia-archivo', '-r para copiar carpetas enteras'],
        ['ls -R', 'Resultado'],
      ], { cwd: '/home/alumno/Documents', files: DOCS }),
      learn('Cuidado: sobrescribir', `
Si el destino **ya existe**, \`cp\` y \`mv\` lo **sobrescriben sin avisar**. Para que te pregunten antes usa \`-i\` (_interactive_):

\`\`\`
$ cp -i a.txt b.txt
cp: overwrite 'b.txt'?
\`\`\`

> OJO: No hay papelera de reciclaje ni "deshacer". Un \`mv\` o \`cp\` sobre un archivo existente destruye el contenido anterior.
`),
      mc('¿Qué hace `mv notas.txt apuntes.txt` si `apuntes.txt` no existe?', ['Copia notas.txt a apuntes.txt', 'Renombra notas.txt como apuntes.txt', 'Da un error', 'Crea una carpeta apuntes.txt'], 1, 'Mover un archivo a un nombre nuevo equivale a renombrarlo.'),
      tf('`cp carpeta copia` copia una carpeta con todo su contenido.', false, 'Para carpetas hace falta `-r`: `cp -r carpeta copia`. Sin ella, cp responde "omitting directory".'),
      practice({
        goal: 'Haz una copia de seguridad',
        prompt: 'Copia `informe.txt` con el nombre **informe-backup.txt** (en la misma carpeta). El original debe seguir existiendo.',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(exists('/home/alumno/Documents/informe.txt', 'file'), content('/home/alumno/Documents/informe-backup.txt', { includes: 'Total: 4200' })),
        solution: ['cp informe.txt informe-backup.txt'],
        hints: ['Primero el origen, luego el destino.', '`cp informe.txt informe-backup.txt`'],
        explain: 'Antes de modificar un archivo importante, copiarlo es el seguro más barato que existe.',
        par: 1,
        commands: ['cp'],
      }),
      practice({
        goal: 'Renombra un archivo',
        prompt: 'Cambia el nombre de `informe.txt` a **informe-final.txt**.',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(missing('/home/alumno/Documents/informe.txt'), exists('/home/alumno/Documents/informe-final.txt', 'file')),
        solution: ['mv informe.txt informe-final.txt'],
        hints: ['No hay comando "rename" aquí: usa el que mueve.', '`mv informe.txt informe-final.txt`'],
        explain: 'Mover y renombrar son la misma operación: cambiar la ruta de un archivo.',
        par: 1,
        commands: ['mv'],
      }),
      practice({
        goal: 'Mueve el archivo a una carpeta',
        prompt: 'Mueve `informe.txt` dentro de la carpeta **Downloads** (que está un nivel arriba, en `~/Downloads`).',
        setup: { cwd: '/home/alumno/Documents', files: DOCS },
        check: all(missing('/home/alumno/Documents/informe.txt'), exists('/home/alumno/Downloads/informe.txt', 'file')),
        solution: ['mv informe.txt ../Downloads/'],
        hints: ['Puedes usar `..` o `~` para llegar a Downloads.', '`mv informe.txt ~/Downloads/`'],
        explain: 'Cuando el destino es una carpeta existente, el archivo entra dentro conservando su nombre.',
        par: 1,
        commands: ['mv'],
      }),
      practice({
        goal: 'Copia una carpeta entera',
        prompt: 'Copia la carpeta **fotos** (con todo lo que contiene) a una nueva llamada **fotos-bak**.',
        setup: { files: { '/home/alumno/fotos/a.jpg': 'jpg-a', '/home/alumno/fotos/b.jpg': 'jpg-b', '/home/alumno/fotos/viaje/c.jpg': 'jpg-c' } },
        check: all(exists('/home/alumno/fotos-bak/a.jpg', 'file'), exists('/home/alumno/fotos-bak/viaje/c.jpg', 'file'), exists('/home/alumno/fotos/a.jpg', 'file')),
        solution: ['cp -r fotos fotos-bak'],
        hints: ['Para carpetas hay que añadir una opción de "recursivo".', '`cp -r fotos fotos-bak`'],
        explain: '`-r` (recursive) recorre la carpeta y copia cada archivo y subcarpeta.',
        par: 1,
        commands: ['cp'],
      }),
      fill('Completa: copiar una carpeta', 'cp ___ datos datos-copia', ['-r', '-l', '-d', '-x'], ['-r'], '`-r` = recursivo. Sin ella cp no copia carpetas.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w2-4', { title: 'Borrar con cabeza', summary: 'rm, rmdir y por qué no hay papelera', emoji: '🗑️', commands: ['rm', 'rmdir'], minutes: 7 }, [
      learn('Aquí no hay papelera', `
En la terminal, **borrar es definitivo**. No hay "Papelera de reciclaje" ni Ctrl + Z que te salve.

| Comando | Qué borra |
|---|---|
| \`rm archivo\` | Un archivo |
| \`rm a b c\` | Varios archivos |
| \`rm -r carpeta\` | Una carpeta **y todo lo de dentro** |
| \`rmdir carpeta\` | Solo carpetas **vacías** |
| \`rm -i archivo\` | Pregunta antes de borrar |

> OJO: \`rm -rf /\` (o \`rm -rf ~\`) es la forma clásica de destruir un sistema. \`-f\` fuerza y no pregunta. **Lee siempre dos veces** antes de pulsar Enter con \`rm -r\`.
`, '🗑️'),
      demo('Borrar paso a paso', [
        ['ls', 'Lo que hay antes'],
        ['rm viejo.txt', 'Borra un archivo'],
        ['rmdir vacia', 'Borra una carpeta vacía'],
        ['rmdir llena', 'Falla: la carpeta no está vacía (rmdir te protege)'],
        ['rm -r llena', 'Con -r sí: borra la carpeta y su contenido'],
        ['ls', 'Lo que queda'],
      ], { cwd: '/home/alumno/limpieza', files: { '/home/alumno/limpieza/viejo.txt': 'x', '/home/alumno/limpieza/vacia/': { dir: true }, '/home/alumno/limpieza/llena/a.txt': 'a', '/home/alumno/limpieza/llena/b.txt': 'b', '/home/alumno/limpieza/guardar.txt': 'importante' } }),
      learn('Hábitos de supervivencia', `
1. **Mira antes de borrar**: haz \`ls\` con el mismo patrón y revisa qué va a desaparecer.
2. Prefiere \`rmdir\` si esperas que la carpeta esté vacía: si no lo está, te avisa.
3. Usa \`rm -i\` mientras aprendes.
4. Comprueba **dónde estás** (\`pwd\`) antes de un \`rm -r\`.
5. Haz **copia** de lo importante antes de limpiar.

> CLAVE: El borrado **no pasa por ninguna papelera**: el espacio se libera al instante y recuperar los datos es muy difícil.
`),
      mc('¿Qué comando borra una carpeta **con contenido**?', ['rmdir carpeta', 'rm carpeta', 'rm -r carpeta', 'del carpeta'], 2, '`rmdir` solo borra carpetas vacías y `rm` a secas rechaza las carpetas. Hace falta `-r` (recursivo).'),
      multi('Elige las afirmaciones **verdaderas**', ['rm envía los archivos a la papelera', 'rmdir solo funciona con carpetas vacías', 'rm -r borra carpetas y su contenido', 'Se puede deshacer un rm con Ctrl + Z'], [1, 2], 'No existe papelera en la terminal y Ctrl + Z no deshace borrados. `rmdir` es la opción segura para carpetas vacías.'),
      practice({
        goal: 'Borra un archivo',
        prompt: 'En la carpeta actual hay un archivo `basura.tmp`. **Bórralo**, pero no toques `guardar.txt`.',
        setup: { cwd: '/home/alumno/limpieza', files: { '/home/alumno/limpieza/basura.tmp': 'xxx', '/home/alumno/limpieza/guardar.txt': 'importante' } },
        check: all(missing('/home/alumno/limpieza/basura.tmp'), exists('/home/alumno/limpieza/guardar.txt', 'file')),
        solution: ['rm basura.tmp'],
        hints: ['_Remove_ en inglés.', '`rm basura.tmp`'],
        explain: '`rm archivo` lo elimina de forma permanente. Nota cómo solo has nombrado el que querías borrar.',
        par: 1,
        commands: ['rm'],
      }),
      practice({
        goal: 'Quita una carpeta vacía',
        prompt: 'Elimina la carpeta vacía **vacia** usando el comando pensado para eso.',
        setup: { cwd: '/home/alumno/limpieza', files: { '/home/alumno/limpieza/vacia/': { dir: true }, '/home/alumno/limpieza/llena/a.txt': 'a' } },
        check: all(missing('/home/alumno/limpieza/vacia'), exists('/home/alumno/limpieza/llena', 'dir'), used('rmdir')),
        solution: ['rmdir vacia'],
        hints: ['Existe un comando específico para carpetas vacías.', '`rmdir vacia`'],
        explain: '`rmdir` es el más seguro: si la carpeta tiene algo dentro, se niega a borrarla.',
        par: 1,
        commands: ['rmdir'],
      }),
      practice({
        goal: 'Borra una carpeta con todo',
        prompt: 'Elimina la carpeta **proyecto-viejo** completa, con todo su contenido.',
        setup: { cwd: '/home/alumno', files: { '/home/alumno/proyecto-viejo/src/main.c': 'int main(){}', '/home/alumno/proyecto-viejo/README': 'x', '/home/alumno/proyecto-nuevo/README': 'y' } },
        check: all(missing('/home/alumno/proyecto-viejo'), exists('/home/alumno/proyecto-nuevo/README', 'file')),
        solution: ['rm -r proyecto-viejo'],
        hints: ['`rm` necesita la opción recursiva para carpetas.', '`rm -r proyecto-viejo`'],
        explain: '`rm -r` desciende por la carpeta borrando todo. Es potente… y peligroso: revisa siempre el nombre.',
        par: 1,
        commands: ['rm'],
      }),
      typeCmd('Escribe el comando para borrar el archivo **datos.csv**', ['rm datos.csv'], '`rm` = _remove_.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w2-5', { title: 'Comodines y llaves', summary: 'Usa * ? [ ] y { } para actuar sobre muchos archivos', emoji: '🃏', commands: ['ls', 'cp', 'rm', 'mkdir', 'touch'], minutes: 9 }, [
      learn('La shell expande los comodines', `
Antes de ejecutar tu comando, la **shell** reemplaza ciertos símbolos por listas de nombres. A esto se le llama **expansión** (_globbing_):

| Símbolo | Significa | Ejemplo |
|---|---|---|
| \`*\` | Cualquier cosa (0 o más caracteres) | \`*.txt\` |
| \`?\` | Exactamente **un** carácter | \`foto?.jpg\` |
| \`[abc]\` | Uno de esos caracteres | \`doc[123].txt\` |
| \`[0-9]\` | Un carácter del rango | \`log[0-9].txt\` |

> CLAVE: Quien expande el \`*\` es **la shell**, no el comando. \`ls *.txt\` se convierte en \`ls a.txt b.txt c.txt\` antes de que \`ls\` llegue a ejecutarse.
`, '🃏'),
      illus('glob-expansion', 'Así se expande *.txt', 'La shell sustituye el patrón por los archivos que coinciden.'),
      demo('Patrones en acción', [
        ['ls', 'Todo lo que hay'],
        ['ls *.txt', 'Solo los .txt'],
        ['ls foto?.jpg', 'foto + un carácter'],
        ['ls foto[12].jpg', 'foto1.jpg o foto2.jpg'],
        ['ls *.jpg *.png', 'Varios patrones a la vez'],
        ['echo *.txt', 'echo te enseña lo que la shell expandió'],
      ], { cwd: '/home/alumno/mix', files: { '/home/alumno/mix/a.txt': 'a', '/home/alumno/mix/b.txt': 'b', '/home/alumno/mix/foto1.jpg': 'x', '/home/alumno/mix/foto2.jpg': 'x', '/home/alumno/mix/foto10.jpg': 'x', '/home/alumno/mix/logo.png': 'x' } }),
      learn('Llaves { }: generar nombres', `
Las llaves **generan** texto (no buscan archivos existentes):

\`\`\`
$ touch informe{1,2,3}.txt        → informe1.txt informe2.txt informe3.txt
$ touch dia{1..5}                 → dia1 dia2 dia3 dia4 dia5
$ mkdir -p web/{css,js,img}       → web/css  web/js  web/img
$ cp config.ini{,.bak}            → cp config.ini config.ini.bak
\`\`\`

> TIP: El truco \`archivo{,.bak}\` es la forma más rápida de hacer una copia de seguridad.
`),
      predict('¿Qué imprime `echo informe{1,2,3}.txt`?', 'echo informe{1,2,3}.txt', ['informe{1,2,3}.txt', 'informe123.txt', 'informe1,2,3.txt'], 'La shell expande las llaves antes de ejecutar `echo`: genera tres palabras.'),
      mc('¿Qué archivos coinciden con `foto?.jpg`?', ['foto.jpg y foto10.jpg', 'foto1.jpg y foto2.jpg', 'Solo foto?.jpg', 'Todos los .jpg'], 1, '`?` sustituye **exactamente un** carácter: `foto1.jpg` y `foto2.jpg` sí; `foto10.jpg` tiene dos.'),
      practice({
        goal: 'Lista solo los .txt',
        prompt: 'En esta carpeta hay de todo. Lista **únicamente** los archivos que terminan en `.txt`.',
        setup: { cwd: '/home/alumno/mix', files: { '/home/alumno/mix/a.txt': 'a', '/home/alumno/mix/b.txt': 'b', '/home/alumno/mix/foto1.jpg': 'x', '/home/alumno/mix/logo.png': 'x' } },
        check: all(used('ls'), out(['a.txt', 'b.txt']), not(out('foto1'))),
        solution: ['ls *.txt'],
        hints: ['`*` representa cualquier cosa.', '`ls *.txt`'],
        explain: 'La shell convierte `*.txt` en `a.txt b.txt`, así que `ls` solo recibe esos nombres.',
        par: 1,
        commands: ['ls'],
      }),
      practice({
        goal: 'Borra todos los temporales',
        prompt: 'Borra de golpe todos los archivos terminados en **.tmp** de esta carpeta. No toques los demás.',
        setup: { cwd: '/home/alumno/mix', files: { '/home/alumno/mix/a.tmp': 'a', '/home/alumno/mix/b.tmp': 'b', '/home/alumno/mix/c.tmp': 'c', '/home/alumno/mix/importante.txt': 'x' } },
        check: all(fileCount('/home/alumno/mix', 1), exists('/home/alumno/mix/importante.txt', 'file')),
        solution: ['rm *.tmp'],
        hints: ['Un comodín para "cualquier nombre" + la extensión.', '`rm *.tmp`'],
        explain: 'Un patrón con `rm` es poderoso. Tip profesional: ejecuta primero `ls *.tmp` para ver qué se va a borrar.',
        par: 1,
        commands: ['rm'],
      }),
      practice({
        goal: 'Genera cinco archivos',
        prompt: 'Crea los archivos **dia1.txt … dia5.txt** con **un solo comando** (usa llaves con un rango).',
        check: all(exists('/home/alumno/dia1.txt', 'file'), exists('/home/alumno/dia3.txt', 'file'), exists('/home/alumno/dia5.txt', 'file'), ran('\\{1\\.\\.5\\}')),
        solution: ['touch dia{1..5}.txt'],
        hints: ['Las llaves aceptan rangos: `{1..5}`.', '`touch dia{1..5}.txt`'],
        explain: '`{1..5}` genera 1 2 3 4 5. Puedes combinarlo con letras (`{a..e}`) o con saltos (`{0..20..5}`).',
        par: 1,
        commands: ['touch'],
      }),
      practice({
        goal: 'Estructura de proyecto con llaves',
        prompt: 'Crea dentro de **sitio** las carpetas **css**, **js** e **img** con un solo `mkdir`.',
        check: all(exists('/home/alumno/sitio/css', 'dir'), exists('/home/alumno/sitio/js', 'dir'), exists('/home/alumno/sitio/img', 'dir')),
        solution: ['mkdir -p sitio/{css,js,img}'],
        hints: ['Combina `-p` con llaves.', '`mkdir -p sitio/{css,js,img}`'],
        explain: 'Con llaves y `-p` montas toda la estructura de un proyecto en una línea.',
        par: 1,
        commands: ['mkdir'],
      }),
      fill('Completa: archivos que empiezan por "inf"', 'ls inf___', ['*', '?', '.', '|'], ['*'], '`inf*` coincide con todo lo que empiece por «inf».'),
    ]),
  ],
  boss: {
    goal: 'Misión: ordena la carpeta Descargas',
    prompt:
      '**Misión del dojo** 🥋\n\nTu carpeta `~/Downloads` es un caos. Déjala así:\n\n1. Crea la carpeta `Downloads/imagenes`.\n2. Mueve ahí todos los `.jpg` y `.png`.\n3. Borra todos los `.tmp`.\n4. El `.pdf` debe quedarse donde está.',
    setup: {
      cwd: '/home/alumno/Downloads',
      files: {
        '/home/alumno/Downloads/foto1.jpg': 'x',
        '/home/alumno/Downloads/foto2.jpg': 'x',
        '/home/alumno/Downloads/logo.png': 'x',
        '/home/alumno/Downloads/cache1.tmp': 'x',
        '/home/alumno/Downloads/cache2.tmp': 'x',
        '/home/alumno/Downloads/factura.pdf': 'x',
      },
    },
    check: all(
      exists('/home/alumno/Downloads/imagenes/foto1.jpg', 'file'),
      exists('/home/alumno/Downloads/imagenes/foto2.jpg', 'file'),
      exists('/home/alumno/Downloads/imagenes/logo.png', 'file'),
      missing('/home/alumno/Downloads/cache1.tmp'),
      missing('/home/alumno/Downloads/cache2.tmp'),
      exists('/home/alumno/Downloads/factura.pdf', 'file'),
      missing('/home/alumno/Downloads/foto1.jpg'),
    ),
    solution: ['mkdir imagenes', 'mv *.jpg *.png imagenes/', 'rm *.tmp'],
    hints: ['Empieza con `mkdir imagenes`.', '`mv *.jpg *.png imagenes/` mueve ambos tipos en un comando.', '`rm *.tmp` borra los temporales.'],
    explain: '¡Zona 2 completada! Con `mkdir`, `mv`, `rm` y comodines puedes reorganizar cientos de archivos en segundos. Siguiente: tuberías y texto.',
    par: 3,
    commands: ['mkdir', 'mv', 'rm'],
  },
});

