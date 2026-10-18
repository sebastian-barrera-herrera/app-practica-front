import { all, content, not, out, outEq, ran, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, predict, tf, world } from '../build';

const FRASE = 'El gato negro y el gato blanco\nUn perro grande\nOtro gato\n';
const CONF = 'host=localhost\nport=8080\ndebug=true\n# comentario\nuser=admin\n';
const VENTAS = 'producto,cantidad,precio\nteclado,5,25\nratón,10,12\nmonitor,2,180\nteclado,3,25\nratón,4,12\n';
const A = 'uno\ndos\ntres\n';
const B = 'uno\ndos\ncuatro\n';

export const w7 = world({
  id: 'w7',
  index: 7,
  title: 'Texto como un pro',
  subtitle: 'sed, awk y herramientas de transformación',
  emoji: '✂️',
  color: '#F472B6',
  level: 'intermedio',
  intro:
    'Registros, CSV, configuraciones: casi todo en Linux es texto. **sed** edita flujos de texto sin abrir un editor y **awk** analiza columnas como una mini hoja de cálculo. Con ellos transformas miles de líneas en un segundo.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w7-1', { title: 'sed: sustituir', summary: 'Busca y reemplaza con s/viejo/nuevo/', emoji: '🪄', commands: ['sed'], minutes: 8 }, [
      learn('El editor de flujos', `
\`sed\` (_stream editor_) lee texto línea a línea, le aplica una **orden** y lo imprime. **No modifica el archivo original** (salvo que se lo pidas).

La orden estrella es **sustituir**:

\`\`\`
sed 's/gato/perro/' frase.txt
      │  └─┬─┘ └─┬─┘
      │  busca  reemplaza
      └ s = substitute
\`\`\`

Por defecto sustituye **solo la primera** coincidencia de cada línea. Con la bandera **g** (_global_) las cambia todas:

\`\`\`
sed 's/gato/perro/g' frase.txt
\`\`\`

> TIP: El separador no tiene por qué ser \`/\`. Si trabajas con rutas usa otro: \`sed 's|/usr/bin|/opt/bin|g'\`.
`, '🪄'),
      demo('Sustituciones', [
        ['sed "s/gato/perro/" frase.txt', 'Solo la primera de cada línea'],
        ['sed "s/gato/perro/g" frase.txt', 'Todas (g)'],
        ['sed "s/o/0/2" frase.txt', 'Solo la segunda "o" de cada línea'],
        ['sed "s/^/> /" frase.txt', '^ es el inicio: añade un prefijo'],
        ['cat frase.txt', 'El original no cambió'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/frase.txt': FRASE } }),
      learn('Imprimir y borrar líneas', `
Además de sustituir, sed puede **seleccionar** líneas:

| Orden | Efecto |
|---|---|
| \`sed -n '2p'\` | Imprime solo la línea 2 (\`-n\` silencia el resto) |
| \`sed -n '2,4p'\` | Líneas de la 2 a la 4 |
| \`sed '2d'\` | **Borra** la línea 2 (imprime el resto) |
| \`sed '/^#/d'\` | Borra las líneas que **empiezan por #** |
| \`sed -n '/gato/p'\` | Solo las que contienen "gato" |

> CLAVE: \`sed\` por sí solo imprime **todo**. Con \`-n\` imprimes solo lo que pidas con \`p\`.
`),
      mc('¿Qué diferencia hay entre `s/a/b/` y `s/a/b/g`?', ['Ninguna', 'Sin `g` solo cambia la primera coincidencia de cada línea', 'Con `g` solo cambia la última', '`g` borra la línea'], 1, '`g` = global: sustituye **todas** las coincidencias de la línea.'),
      predict('¿Qué imprime este comando?', 'echo "hola mundo" | sed "s/o/0/g"', ['h0la mundo', 'hola mund0', 'hola mundo'], 'Con `g` se cambian todas las "o": h**0**la mund**0**.'),
      practice({
        goal: 'Cambia todos los "gato"',
        prompt: 'Muestra `frase.txt` cambiando **todas** las apariciones de `gato` por `perro` (sin modificar el archivo).',
        setup: { files: { '/home/alumno/frase.txt': FRASE } },
        check: all(used('sed'), outEq('El perro negro y el perro blanco\nUn perro grande\nOtro perro')),
        solution: ['sed "s/gato/perro/g" frase.txt'],
        hints: ['Sustituir = `s`; todas las veces = bandera `g`.', '`sed "s/gato/perro/g" frase.txt`'],
        explain: 'sed trabaja sobre la salida: `frase.txt` sigue intacto. Para cambiar el archivo se usa `-i` (lo verás ahora).',
        par: 1,
        commands: ['sed'],
      }),
      practice({
        goal: 'Solo la línea 2',
        prompt: 'Muestra **únicamente la segunda línea** de `frase.txt` usando `sed -n`.',
        setup: { files: { '/home/alumno/frase.txt': FRASE } },
        check: all(used('sed', ['-n']), outEq('Un perro grande')),
        solution: ["sed -n '2p' frase.txt"],
        hints: ['`-n` apaga la impresión automática y `p` imprime.', "`sed -n '2p' frase.txt`"],
        explain: '`sed -n \'N p\'` es una alternativa a `head | tail` para extraer una línea concreta.',
        par: 1,
        commands: ['sed'],
      }),
      practice({
        goal: 'Quita los comentarios',
        prompt: 'Muestra `app.conf` **sin las líneas de comentario** (las que empiezan por `#`).',
        setup: { files: { '/home/alumno/app.conf': CONF } },
        check: all(used('sed'), out('port=8080'), not(out('#'))),
        solution: ["sed '/^#/d' app.conf"],
        hints: ['`d` borra; el patrón entre barras elige qué líneas.', "`sed '/^#/d' app.conf`"],
        explain: '`/^#/d` = "borra las líneas que empiezan por #". Útil para ver una configuración limpia.',
        par: 1,
        commands: ['sed'],
      }),
      fill('Completa para borrar la línea 3', "sed '3___' archivo.txt", ['d', 'p', 's', 'g'], ['d'], '`d` = delete.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w7-2', { title: 'sed en archivos', summary: '-i, copias .bak, insertar y grupos', emoji: '📝', commands: ['sed'], minutes: 8 }, [
      learn('Editar el archivo de verdad: -i', `
Con **\`-i\`** (_in-place_) sed escribe el resultado **dentro del archivo** en lugar de imprimirlo:

\`\`\`
sed -i 's/8080/9090/' app.conf        # modifica app.conf
sed -i.bak 's/8080/9090/' app.conf    # y guarda una copia app.conf.bak
\`\`\`

> OJO: \`-i\` **sobrescribe sin preguntar**. Usa \`-i.bak\` mientras no estés seguro: te da una copia de seguridad.
`, '📝'),
      demo('Edición in situ', [
        ['cat app.conf', 'Antes'],
        ['sed -i.bak "s/8080/9090/" app.conf', 'Edita y conserva copia'],
        ['cat app.conf', 'Después'],
        ['ls app.conf*', 'Existe app.conf.bak'],
        ['sed -i "/^#/d" app.conf', 'Elimina comentarios del archivo'],
        ['cat app.conf', 'Resultado'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/app.conf': CONF } }),
      learn('Insertar, añadir y grupos', `
| Orden | Efecto |
|---|---|
| \`sed '1i texto'\` | **Inserta** "texto" **antes** de la línea 1 |
| \`sed '$a texto'\` | **Añade** "texto" **después** de la última línea |
| \`sed -E 's/(\\w+) (\\w+)/\\2 \\1/'\` | Grupos: intercambia dos palabras |
| \`sed -e 's/a/b/' -e 's/c/d/'\` | Varias órdenes (también \`;\`) |

Los **grupos** \`( )\` capturan texto y puedes reutilizarlo con \`\\1\`, \`\\2\`… en el reemplazo. Con **-E** no hace falta escapar los paréntesis.
`),
      mc('¿Qué hace `sed -i.bak "s/a/b/" f.txt`?', ['Imprime el resultado sin tocar f.txt', 'Edita f.txt y guarda una copia como f.txt.bak', 'Borra f.txt.bak', 'Crea f.txt.bak vacío'], 1, '`-i.bak` modifica el archivo y conserva el original con la extensión `.bak`.'),
      predict('¿Qué imprime? (`-E` y grupos)', 'echo "Ana Gomez" | sed -E "s/([A-Za-z]+) ([A-Za-z]+)/\\2, \\1/"', ['Ana, Gomez', 'Gomez Ana', 'Gomez, Ana, Ana'], '`\\1` es la primera palabra y `\\2` la segunda: el reemplazo las intercambia con una coma.'),
      practice({
        goal: 'Cambia el puerto en el archivo',
        prompt: 'Edita **app.conf** (en el propio archivo) cambiando el puerto `8080` por `9090`.',
        setup: { files: { '/home/alumno/app.conf': CONF } },
        check: all(content('/home/alumno/app.conf', { includes: 'port=9090', notIncludes: '8080' }), ran('sed.*-i')),
        solution: ['sed -i "s/8080/9090/" app.conf'],
        hints: ['Necesitas la opción de edición "in place".', '`sed -i "s/8080/9090/" app.conf`'],
        explain: 'Así se automatiza el cambio de configuraciones en servidores: un `sed -i` dentro de un script.',
        par: 1,
        commands: ['sed'],
      }),
      practice({
        goal: 'Edita con copia de seguridad',
        prompt: 'Cambia `debug=true` por `debug=false` en **app.conf**, pero conserva el original como **app.conf.bak**.',
        setup: { files: { '/home/alumno/app.conf': CONF } },
        check: all(content('/home/alumno/app.conf', { includes: 'debug=false' }), content('/home/alumno/app.conf.bak', { includes: 'debug=true' })),
        solution: ['sed -i.bak "s/debug=true/debug=false/" app.conf'],
        hints: ['`-i` admite un sufijo pegado: `-i.bak`.', '`sed -i.bak "s/debug=true/debug=false/" app.conf`'],
        explain: 'Con `-i.bak` tienes siempre vuelta atrás: `mv app.conf.bak app.conf`.',
        par: 1,
        commands: ['sed'],
      }),
      practice({
        goal: 'Limpia la configuración',
        prompt: 'Elimina **del propio archivo** `app.conf` todas las líneas de comentario (las que empiezan por `#`).',
        setup: { files: { '/home/alumno/app.conf': CONF } },
        check: content('/home/alumno/app.conf', { equals: 'host=localhost\nport=8080\ndebug=true\nuser=admin' }),
        solution: ["sed -i '/^#/d' app.conf"],
        hints: ['Combina `-i` con la orden `/^#/d`.', "`sed -i '/^#/d' app.conf`"],
        explain: 'Cuando un archivo de configuración crece, quitar comentarios facilita leerlo y compararlo.',
        par: 1,
        commands: ['sed'],
      }),
      practice({
        goal: 'Añade una cabecera',
        prompt: 'Imprime `a.txt` con la línea `# lista` **insertada al principio** (usa la orden `i` de sed).',
        setup: { files: { '/home/alumno/a.txt': A } },
        check: all(used('sed'), outEq('# lista\nuno\ndos\ntres')),
        solution: ["sed '1i # lista' a.txt"],
        hints: ['`1i texto` inserta antes de la línea 1.', "`sed '1i # lista' a.txt`"],
        explain: 'sed también inserta (`i`), añade (`a`) y cambia (`c`) líneas completas.',
        par: 1,
        commands: ['sed'],
      }),
      order('Ordena: sustituir en el propio archivo, global', ['sed', '-i', "'s/a/b/g'", 'f.txt'], "sed -i 's/a/b/g' f.txt", 'Comando, opción -i, la orden entre comillas y el archivo.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w7-3', { title: 'awk: columnas', summary: 'Campos $1, $2…, -F y condiciones', emoji: '🧮', commands: ['awk'], minutes: 9 }, [
      learn('Una hoja de cálculo en la terminal', `
\`awk\` lee cada línea y la **divide en campos**. Accedes a ellos con **\`$1\`, \`$2\`, \`$3\`…** (\`$0\` es la línea entera y **\`$NF\`** el último campo).

\`\`\`
awk '{print $1}' frase.txt           # primera palabra de cada línea
awk -F, '{print $1, $3}' ventas.csv  # -F, = el separador es la coma
\`\`\`

La estructura general: **\`patrón { acción }\`**. Si la línea cumple el patrón, se ejecuta la acción.

\`\`\`
awk -F, 'NR>1 && $2>4' ventas.csv   # filas (no la cabecera) con cantidad > 4
\`\`\`
`, '🧮'),
      illus('awk-fields', 'Cómo awk trocea una línea', 'Cada palabra (o campo) tiene su número.'),
      learn('Variables útiles', `
| Variable | Significado |
|---|---|
| \`NR\` | Nº de la línea actual (_number of record_) |
| \`NF\` | Nº de campos de la línea (_number of fields_) |
| \`$NF\` | Último campo |
| \`FS\` | Separador de entrada (lo que pones con \`-F\`) |

\`\`\`
awk 'NR==1' f.txt          # solo la línea 1
awk 'NR>1' f.txt           # todas menos la cabecera
awk '/gato/ {print NR": "$0}' f.txt    # patrón regex + acción
\`\`\`
`),
      demo('awk en acción', [
        ['awk "{print $1}" frase.txt', 'Primera palabra'],
        ['awk "{print $NF}" frase.txt', 'Última palabra'],
        ['awk -F, "{print $1}" ventas.csv', 'Columna 1 de un CSV'],
        ['awk -F, "NR>1 {print $1, $2*$3}" ventas.csv', 'Producto e importe (cantidad×precio)'],
        ['awk -F, "NR>1 && $2>4" ventas.csv', 'Solo filas con cantidad mayor que 4'],
        ['awk "/gato/ {print NR\\": \\"$0}" frase.txt', 'Líneas con gato y su número'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/frase.txt': FRASE, '/home/alumno/ventas.csv': VENTAS } }),
      mc('En `awk -F, \'{print $2}\' f.csv`, ¿qué significa `-F,`?', ['Imprime en formato coma', 'El separador de campos es la coma', 'Filtra las filas con coma', 'Fuerza la salida'], 1, '`-F` define el **separador de campos** de la entrada.'),
      mc('¿Qué imprime `awk \'{print $NF}\'` con la línea `uno dos tres`?', ['uno', 'dos', 'tres', '3'], 2, '`$NF` es el **último** campo. `NF` (sin `$`) valdría 3.'),
      practice({
        goal: 'La primera palabra',
        prompt: 'Imprime **solo la primera palabra** de cada línea de `frase.txt` con `awk`.',
        setup: { files: { '/home/alumno/frase.txt': FRASE } },
        check: all(used('awk'), outEq('El\nUn\nOtro')),
        solution: ["awk '{print $1}' frase.txt"],
        hints: ['El primer campo es `$1`.', "`awk '{print $1}' frase.txt`"],
        explain: 'awk separa por espacios en blanco de forma predeterminada. `$1` es la primera columna.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Nombres de los productos',
        prompt: 'En `ventas.csv` (`producto,cantidad,precio`) imprime **solo la columna de productos**, sin la cabecera.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), outEq('teclado\nratón\nmonitor\nteclado\nratón')),
        solution: ["awk -F, 'NR>1 {print $1}' ventas.csv"],
        hints: ['Necesitas `-F,` y saltarte la línea 1 (`NR>1`).', "`awk -F, 'NR>1 {print $1}' ventas.csv`"],
        explain: '`NR>1` excluye la cabecera: es el truco típico para procesar CSV con awk.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Ventas grandes',
        prompt: 'Muestra las filas de `ventas.csv` (sin cabecera) en las que la **cantidad es mayor que 4**.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), outEq('teclado,5,25\nratón,10,12')),
        solution: ["awk -F, 'NR>1 && $2>4' ventas.csv"],
        hints: ['Usa una condición como patrón: `NR>1 && $2>4`.', "`awk -F, 'NR>1 && $2>4' ventas.csv`"],
        explain: 'Un patrón sin acción imprime la línea completa si es verdadero. awk compara números como números.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Última columna',
        prompt: 'Imprime la **última palabra** de cada línea de `frase.txt`.',
        setup: { files: { '/home/alumno/frase.txt': FRASE } },
        check: all(used('awk'), outEq('blanco\ngrande\ngato')),
        solution: ["awk '{print $NF}' frase.txt"],
        hints: ['Hay una variable que guarda el número de campos.', "`awk '{print $NF}' frase.txt`"],
        explain: '`$NF` es útil cuando las líneas tienen longitudes distintas y quieres siempre lo último.',
        par: 1,
        commands: ['awk'],
      }),
      match('Une cada variable de awk con su significado', [['$0', 'La línea completa'], ['$1', 'El primer campo'], ['NF', 'Número de campos'], ['NR', 'Número de línea']], 'Con estas cuatro hacen cosas sorprendentes.'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w7-4', { title: 'awk: calcular', summary: 'BEGIN, END, sumas y arrays', emoji: '📈', commands: ['awk'], minutes: 9 }, [
      learn('Acumular y resumir', `
awk tiene variables (sin declararlas) y bloques especiales:

- **\`BEGIN { … }\`** → se ejecuta **una vez antes** de leer nada.
- **\`END { … }\`** → se ejecuta **una vez al terminar**.

Ideal para **totales**:

\`\`\`
awk -F, 'NR>1 {total += $2*$3} END {print total}' ventas.csv
\`\`\`

Y los **arrays asociativos** (diccionarios) agrupan por clave:

\`\`\`
awk -F, 'NR>1 {unidades[$1] += $2}
         END {for (p in unidades) print p, unidades[p]}' ventas.csv
\`\`\`

> NOTA: El orden de \`for (k in array)\` no está garantizado. Si importa, pasa el resultado por \`sort\`.
`, '📈'),
      demo('Informes con awk', [
        ['awk -F, "NR>1 {t += $2*$3} END {print t}" ventas.csv', 'Total de ventas'],
        ['awk -F, "NR>1 {n++} END {print n}" ventas.csv', 'Cuántas filas (sin cabecera)'],
        ['awk -F, "NR>1 {c[$1]+=$2} END {for (k in c) print k, c[k]}" ventas.csv | sort', 'Unidades por producto'],
        ['awk -F, "NR>1 {printf \\"%-10s %3d\\\\n\\", $1, $2}" ventas.csv', 'printf para dar formato'],
        ['awk "END {print NR}" frase.txt', 'Contar líneas (como wc -l)'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/frase.txt': FRASE, '/home/alumno/ventas.csv': VENTAS } }),
      mc('¿Cuándo se ejecuta el bloque `END { … }`?', ['Antes de leer la primera línea', 'En cada línea', 'Después de procesar todas las líneas', 'Nunca'], 2, 'BEGIN corre antes de leer; END, tras la última línea. Perfecto para totales.'),
      predict('¿Qué imprime la suma de la 1.ª columna?', 'printf "3\\n4\\n5\\n" | awk "{s += $1} END {print s}"', ['3', '345', '12'], 'El acumulador `s` suma 3 + 4 + 5 = 12 y `END` lo imprime una vez.'),
      practice({
        goal: 'Total de ventas',
        prompt: 'Calcula el **importe total** de `ventas.csv` (suma de `cantidad × precio` de cada fila, sin la cabecera). Debe salir **728**.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), outEq('728')),
        solution: ["awk -F, 'NR>1 {t += $2*$3} END {print t}' ventas.csv"],
        hints: ['Acumula en una variable y muéstrala en `END`.', "`awk -F, 'NR>1 {t += $2*$3} END {print t}' ventas.csv`"],
        explain: 'awk convierte automáticamente los campos en números al operar con ellos.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Unidades por producto',
        prompt: 'Muestra cuántas **unidades** se vendieron de **cada producto** (`producto total`, ordenado alfabéticamente). Usa un array en awk y `sort`.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), ran('sort'), outEq('monitor 2\nratón 14\nteclado 8')),
        solution: ["awk -F, 'NR>1 {c[$1]+=$2} END {for (k in c) print k, c[k]}' ventas.csv | sort"],
        hints: ['`c[$1] += $2` agrupa por producto.', "`awk -F, 'NR>1 {c[$1]+=$2} END {for (k in c) print k, c[k]}' ventas.csv | sort`"],
        explain: 'Este patrón (`array[clave] += valor` + `END`) es el "GROUP BY" de la terminal.',
        par: 1,
        commands: ['awk', 'sort'],
      }),
      practice({
        goal: 'Cuenta líneas con awk',
        prompt: 'Muestra el **número de líneas** de `frase.txt` usando solo `awk` y `END`.',
        setup: { files: { '/home/alumno/frase.txt': FRASE } },
        check: all(used('awk'), outEq('3')),
        solution: ["awk 'END {print NR}' frase.txt"],
        hints: ['Al terminar, `NR` vale el total de líneas leídas.', "`awk 'END {print NR}' frase.txt`"],
        explain: 'Al llegar a `END`, `NR` guarda el número de la última línea: el total.',
        par: 1,
        commands: ['awk'],
      }),
      practice({
        goal: 'Informe con cabecera',
        prompt: 'Imprime primero la línea `REPORTE` y luego **cuántas filas de datos** tiene `ventas.csv` en la forma `5 filas`. Usa `BEGIN` y `END`.',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('awk'), outEq('REPORTE\n5 filas')),
        solution: ["awk -F, 'BEGIN {print \"REPORTE\"} NR>1 {n++} END {print n \" filas\"}' ventas.csv"],
        hints: ['`BEGIN` imprime la cabecera, `NR>1 {n++}` cuenta, `END` muestra el total.', "`awk -F, 'BEGIN {print \"REPORTE\"} NR>1 {n++} END {print n \" filas\"}' ventas.csv`"],
        explain: 'BEGIN + cuerpo + END es la anatomía de cualquier informe en awk.',
        par: 1,
        commands: ['awk'],
      }),
      tf('En awk hay que declarar las variables antes de usarlas.', false, 'Las variables nacen al usarlas y valen 0 (o cadena vacía) hasta que se les asigna algo.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w7-5', { title: 'Más herramientas de texto', summary: 'diff, comm, paste, column, nl, tac y tr', emoji: '🧰', commands: ['diff', 'comm', 'paste', 'column', 'nl', 'tac', 'tr'], minutes: 8 }, [
      learn('Una caja de herramientas de bolsillo', `
| Comando | Para qué |
|---|---|
| \`diff a b\` | **Diferencias** entre dos archivos (\`-u\` formato unificado) |
| \`comm -12 a b\` | Líneas **comunes** (archivos ordenados) |
| \`paste a b\` | Une archivos **columna a columna** |
| \`column -t\` | Alinea en una **tabla** legible |
| \`nl f\` | **Numera** líneas |
| \`tac f\` | Imprime al **revés** (última línea primero) |
| \`rev f\` | Invierte los **caracteres** de cada línea |
| \`tr -d 'x'\` | **Borra** caracteres |

\`diff\` marca con \`<\` lo que solo hay en el primer archivo y con \`>\` lo del segundo.
`, '🧰'),
      demo('Comparando y formateando', [
        ['diff a.txt b.txt', '< solo en a, > solo en b'],
        ['comm -12 a.txt b.txt', 'Líneas comunes'],
        ['paste a.txt b.txt', 'Lado a lado'],
        ['column -t -s, ventas.csv', 'CSV como tabla alineada'],
        ['tac a.txt', 'Al revés'],
        ['nl a.txt', 'Con números de línea'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/a.txt': A, '/home/alumno/b.txt': B, '/home/alumno/ventas.csv': VENTAS } }),
      mc('En la salida de `diff a b`, ¿qué indica una línea que empieza por `<`?', ['Está solo en el segundo archivo', 'Está solo en el primer archivo', 'Está en ambos', 'Es un comentario'], 1, '`<` = primer archivo; `>` = segundo archivo.'),
      practice({
        goal: '¿Qué cambió?',
        prompt: 'Compara `a.txt` y `b.txt` y muestra sus **diferencias**.',
        setup: { files: { '/home/alumno/a.txt': A, '/home/alumno/b.txt': B } },
        check: all(used('diff'), out(['< tres', '> cuatro'])),
        solution: ['diff a.txt b.txt'],
        hints: ['El comando se llama como la palabra "diferencia".', '`diff a.txt b.txt`'],
        explain: 'diff es la base del control de versiones: git muestra los cambios con este mismo formato.',
        par: 1,
        commands: ['diff'],
      }),
      practice({
        goal: 'Líneas en común',
        prompt: 'Muestra solo las **líneas que aparecen en ambos** archivos (`a.txt` y `b.txt`, ya ordenados) usando `comm`.',
        setup: { files: { '/home/alumno/a.txt': A, '/home/alumno/b.txt': B } },
        check: all(used('comm'), outEq('uno\ndos')),
        solution: ['comm -12 a.txt b.txt'],
        hints: ['`comm` tiene columnas que se suprimen con `-1`, `-2` y `-3`.', '`comm -12 a.txt b.txt` (suprime las columnas 1 y 2)'],
        explain: '`comm -12` deja solo la tercera columna: lo común. `-23` daría lo exclusivo del primero.',
        par: 1,
        commands: ['comm'],
      }),
      practice({
        goal: 'Una tabla bonita',
        prompt: 'Muestra `ventas.csv` como una **tabla alineada en columnas** usando `column` con `-t` y la coma como separador (`-s,`).',
        setup: { files: { '/home/alumno/ventas.csv': VENTAS } },
        check: all(used('column'), out('producto  cantidad  precio')),
        solution: ['column -t -s, ventas.csv'],
        hints: ['`-t` crea la tabla y `-s` define el separador.', '`column -t -s, ventas.csv`'],
        explain: '`column -t` es un adorno que mejora mucho la legibilidad de cualquier salida tabulada.',
        par: 1,
        commands: ['column'],
      }),
      practice({
        goal: 'Quita las vocales "o"',
        prompt: 'Muestra `a.txt` **sin ninguna letra o**, usando `tr` con la opción de borrar.',
        setup: { files: { '/home/alumno/a.txt': A } },
        check: all(used('tr'), outEq('un\nds\ntres')),
        solution: ["tr -d 'o' < a.txt"],
        hints: ['`tr -d` borra los caracteres indicados y lee de stdin.', "`tr -d 'o' < a.txt`"],
        explain: '`tr` trabaja con stdin, por eso la redirección `< a.txt`. Con `-d` borra, con `-s` comprime repeticiones.',
        par: 1,
        commands: ['tr'],
      }),
      fill('Completa para numerar las líneas de a.txt', '___ a.txt', ['nl', 'wc', 'tac', 'rev'], ['nl'], '`nl` = _number lines_.'),
    ]),
  ],
  boss: {
    goal: 'Misión: informe y limpieza',
    prompt:
      '**Misión del dojo** 🥋\n\n1. Genera **informe.txt** con las **unidades vendidas por producto** (formato `producto total`, ordenado alfabéticamente) a partir de `ventas.csv`.\n2. En **app.conf**, cambia el puerto a **9090** *en el propio archivo*.',
    setup: { cwd: '/home/alumno', files: { '/home/alumno/ventas.csv': VENTAS, '/home/alumno/app.conf': CONF } },
    check: all(
      content('/home/alumno/informe.txt', { equals: 'monitor 2\nratón 14\nteclado 8' }),
      content('/home/alumno/app.conf', { includes: 'port=9090', notIncludes: '8080' }),
    ),
    solution: ["awk -F, 'NR>1 {c[$1]+=$2} END {for (k in c) print k, c[k]}' ventas.csv | sort > informe.txt", "sed -i 's/8080/9090/' app.conf"],
    hints: ['Informe: awk con array + `sort` + `> informe.txt`.', 'Config: `sed -i` con una sustitución.'],
    explain: '¡Zona 7 completada y nivel Intermedio terminado! 🔷 sed y awk son herramientas que seguirás usando toda tu vida. Ya puedes enfrentarte a la certificación intermedia.',
    par: 2,
    commands: ['awk', 'sed'],
  },
});

