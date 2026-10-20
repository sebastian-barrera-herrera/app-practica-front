import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, outHas, outMatch, stdout, uses, variable } from '../pycheck';

export const py1 = pyWorld({
  id: 'py1',
  index: 1,
  title: 'Hola, Python',
  subtitle: 'Tus primeras líneas de código',
  emoji: '🐍',
  color: '#5AA9FF',
  level: 'basico',
  intro:
    'Python es uno de los lenguajes más amables para empezar a programar: se lee casi como una frase y sirve para todo, desde automatizar tareas hasta inteligencia artificial. Aquí escribirás tus primeros programas, aprenderás a hablar con la computadora y a leer sus quejas (los errores) sin miedo.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py1-1', { title: 'Tu primer programa', summary: 'print, comentarios y cómo leer un error', emoji: '👋', commands: ['print', 'comentarios', 'SyntaxError', 'NameError'], minutes: 8 }, [
      learn(
        'Dar instrucciones a una máquina',
        `
Un **programa** es una lista de instrucciones que la computadora sigue **en orden**, una tras otra, sin saltarse ninguna y sin adivinar lo que querías decir.

**Python** es un lenguaje para escribir esas instrucciones. Lo usan desde estudiantes hasta grandes empresas: automatización, páginas web, análisis de datos, videojuegos, inteligencia artificial…

Tú escribes el **código**; un programa llamado **intérprete** lo lee de arriba hacia abajo y ejecuta cada línea.

> CLAVE: La computadora hace *exactamente* lo que escribes, no lo que querías escribir. Programar es aprender a ser preciso.
`,
        '🐍',
      ),
      pyDemo('Hola, mundo', [
        ['print("Hola, mundo")', '`print()` escribe en pantalla lo que va entre paréntesis'],
        ['print("Soy un programa")\nprint("y obedezco")', 'Cada `print()` escribe una línea nueva; se ejecutan de arriba abajo'],
      ]),
      learn(
        'print: tu megáfono',
        `
\`print()\` muestra información en pantalla. Dentro de los paréntesis va lo que quieres mostrar:

- **Texto**: va entre comillas, simples (\`'hola'\`) o dobles (\`"hola"\`). Es lo mismo.
- **Números**: van sin comillas. Python los puede calcular.
- **Varias cosas**: sepáralas con comas. \`print\` pone un espacio entre ellas.

A un texto lo llamamos **cadena** (en inglés *string*, tipo \`str\`).
`,
      ),
      pyDemo('print con varias cosas', [
        ['print("Edad:", 15)', 'Dos valores separados por coma: salen con un espacio en medio'],
        ['print(2 + 3)', 'Sin comillas, Python hace la cuenta'],
        ['print("2 + 3")', 'Con comillas es solo texto: no se calcula nada'],
        ['print()', 'Un `print()` vacío deja una línea en blanco'],
      ]),
      mc('¿Qué muestra `print("2 + 3")`?', ['5', '2 + 3', 'Un error', '"2 + 3" con las comillas'], 1, 'Lo que está entre comillas es texto y se muestra tal cual. Las comillas no se imprimen: solo delimitan el texto.'),
      learn(
        'Comentarios: notas para personas',
        `
Una línea que empieza con \`#\` es un **comentario**: Python la ignora por completo. Sirve para:

- Explicar **por qué** hiciste algo (el *qué* ya lo dice el código).
- Dejarte recordatorios.
- Desactivar una línea un momento sin borrarla.

\`\`\`
# Esto es un comentario
print("esto sí se ejecuta")  # también puede ir al final de la línea
\`\`\`
`,
        '📝',
      ),
      pyOut('¿Qué imprime este programa?', 'print("uno")\n# print("dos")\nprint("tres")', ['uno\ndos\ntres', 'uno\ntres\ndos', 'tres'], 'La segunda línea es un comentario, así que Python no la ejecuta: solo salen «uno» y «tres».'),
      learn(
        'Leer un error sin miedo',
        `
Los errores no son un castigo: son **mensajes** que te dicen qué salió mal y dónde. Cuando Python no puede continuar, muestra un *traceback*. Lo más útil está en las últimas líneas:

1. La **línea** del archivo donde ocurrió (\`line 1\`).
2. El **tipo** de error (\`SyntaxError\`, \`NameError\`…).
3. Una **explicación** en inglés de lo que pasó.

Dos errores que verás mucho de principiante:

- \`SyntaxError\`: escribiste algo que Python no entiende (falta una comilla, un paréntesis…).
- \`NameError\`: usaste un nombre que no existe (por ejemplo, escribiste mal \`print\`).
`,
        '🔎',
      ),
      pyDemo('Dos errores típicos', [
        pyErr('print("Hola)', 'Falta cerrar la comilla: `SyntaxError`. Python señala la línea con un ^'),
        pyErr('pritn("Hola")', 'Escribimos mal `print`: `NameError`. Python incluso sugiere el nombre correcto'),
      ]),
      tf('Python trata igual `print("hola")` que `Print("hola")`.', false, 'Python distingue mayúsculas de minúsculas. `Print` no existe, así que daría un `NameError`.'),
      fill('Completa el programa para que muestre ¡Hola!', '___("¡Hola!")', ['print', 'Print', 'echo', 'say'], ['print'], 'La función que muestra información en pantalla se llama `print`, en minúsculas.'),
      pyPractice({
        goal: 'Saluda a Python',
        prompt: 'Escribe un programa que muestre exactamente el texto **Hola, Python** en pantalla.',
        starter: '# Escribe tu código debajo\n',
        check: stdout('Hola, Python'),
        solution: 'print("Hola, Python")',
        hints: ['Usa `print()` y pon el texto entre comillas.', '`print("Hola, Python")`'],
        explain: '`print("...")` escribe el texto en pantalla. Las comillas indican dónde empieza y dónde acaba el texto, pero no se muestran.',
        commands: ['print'],
      }),
      pyPractice({
        goal: 'Tres líneas',
        prompt: 'Muestra estas tres líneas, una debajo de otra:\n\n```\nPython\nes\ndivertido\n```',
        starter: '',
        check: stdout('Python\nes\ndivertido'),
        solution: 'print("Python")\nprint("es")\nprint("divertido")',
        hints: ['Cada `print()` escribe en una línea nueva.', 'Necesitas tres `print()`, uno por palabra.'],
        explain: 'Python ejecuta las instrucciones en orden, de arriba hacia abajo. Cada `print()` termina con un salto de línea.',
        commands: ['print'],
      }),
      pyPractice({
        goal: 'Arregla el programa',
        prompt: 'Este programa tiene un error y no funciona. Corrígelo para que muestre **Casi funciona**.',
        starter: 'print("Casi funciona)',
        check: stdout('Casi funciona'),
        solution: 'print("Casi funciona")',
        hints: ['Mira dónde empiezan y terminan las comillas.', 'Falta una comilla de cierre antes del paréntesis.'],
        explain: 'Cada comilla que abres debe cerrarse. El `SyntaxError` te señalaba la línea exacta del problema.',
        commands: ['print', 'SyntaxError'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py1-2', { title: 'Variables y nombres', summary: 'Guardar valores con nombres y cambiarlos', emoji: '🏷️', commands: ['variables', 'type', 'print'], minutes: 9 }, [
      learn(
        'Una variable es una etiqueta',
        `
Un programa necesita **recordar** cosas: tu nombre, una puntuación, el total de una compra. Para eso están las **variables**: un nombre que apunta a un valor.

\`\`\`
edad = 15
\`\`\`

Se lee: *«edad pasa a valer 15»*. El \`=\` **no** significa «es igual a» como en matemáticas: es una **asignación**. Python calcula lo de la derecha y le pega la etiqueta de la izquierda.
`,
        '🏷️',
      ),
      illus('py-variables-labels', 'Nombres y valores', 'Un nombre es una etiqueta pegada a un valor. Dos etiquetas pueden señalar el mismo valor.'),
      pyDemo('Crear y usar variables', [
        ['nombre = "Ada"\nedad = 36\nprint(nombre, edad)', 'Dos variables; después se usan por su nombre'],
        ['edad = edad + 1\nprint(edad)', 'Primero se calcula la derecha (36 + 1) y luego se guarda en `edad`'],
        ['a = 5\nb = a\na = 10\nprint(a, b)', '`b = a` copia el valor de ese momento: si `a` cambia después, `b` sigue valiendo 5'],
      ]),
      learn(
        'Reglas para los nombres',
        `
Puedes llamar a tus variables casi como quieras, pero hay reglas:

- Solo **letras, números y guion bajo** \`_\`.
- **No** pueden empezar por un número (\`1er_lugar\` ✗).
- **Sin espacios ni guiones** (\`mi edad\` ✗, \`mi-edad\` ✗).
- No pueden ser palabras reservadas de Python (\`if\`, \`for\`, \`class\`, \`True\`…).
- **Mayúsculas importan**: \`edad\` y \`Edad\` son nombres distintos.

Y una convención muy extendida: **snake_case** (minúsculas separadas por guion bajo): \`precio_total\`, \`nombre_usuario\`. Elige nombres que expliquen el contenido: \`edad\` es mejor que \`x\`.
`,
      ),
      mc('¿Cuál es un nombre de variable válido?', ['2veces', 'mi-edad', 'mi_edad', 'class'], 2, '`2veces` empieza por número, `mi-edad` lleva un guion (Python lo leería como una resta) y `class` es una palabra reservada.'),
      match(
        'Une cada nombre con su veredicto',
        [
          ['precio_total', 'Válido y con buen estilo'],
          ['PrecioTotal', 'Válido, pero no sigue snake_case'],
          ['1er_lugar', 'Inválido: empieza por número'],
          ['mi edad', 'Inválido: tiene un espacio'],
        ],
        'Las reglas son estrictas (letras, números, `_`, sin empezar por número); las convenciones, como snake_case, hacen tu código más fácil de leer.',
      ),
      pyDemo('type(): ¿qué clase de valor es?', [
        pyRepl('type(42)', 'Un número entero: `int`'),
        pyRepl('type(3.14)', 'Un decimal: `float`'),
        pyRepl('type("hola")', 'Un texto: `str`'),
        pyRepl('type(True)', 'Verdadero o falso: `bool`'),
        pyRepl('type(None)', '«Nada»: `NoneType`'),
      ]),
      learn(
        'Los tipos básicos',
        `
Cada valor tiene un **tipo**, que decide qué se puede hacer con él:

| Tipo | Ejemplo | Para qué |
|---|---|---|
| \`int\` | \`42\`, \`-7\` | Números enteros |
| \`float\` | \`3.14\`, \`-0.5\` | Números con decimales |
| \`str\` | \`"hola"\` | Texto |
| \`bool\` | \`True\`, \`False\` | Verdadero / falso |
| \`NoneType\` | \`None\` | Ausencia de valor |

Las variables **no tienen tipo fijo**: el tipo lo tiene el *valor*. Puedes escribir \`x = 5\` y luego \`x = "cinco"\`. A esto se le llama **tipado dinámico**.
`,
      ),
      pyOut('¿Qué imprime?', 'x = 3\ny = x\nx = x + 4\nprint(x, y)', ['7 7', '3 3', '3 7'], '`y = x` guarda el 3. Después `x` pasa a valer 7, pero `y` sigue apuntando al 3. Se imprime `7 3`.'),
      tf('En `x = 5`, el signo `=` comprueba si x es igual a 5.', false, 'El `=` asigna: guarda el 5 en `x`. Para *comparar* se usa `==` (lo verás en la siguiente zona).'),
      pyCode('Escribe una línea que guarde el número 15 en una variable llamada `edad`.', { check: variable('edad', '15'), solution: 'edad = 15', hint: 'nombre, signo igual, valor.', why: 'La forma es siempre `nombre = valor`. Sin comillas porque 15 es un número.' }),
      pyPractice({
        goal: 'Presenta a Linus',
        prompt: 'Crea una variable `nombre` con el texto `"Linus"` y otra `edad` con el número `30`. Luego muestra: **Linus tiene 30 años** usando las variables (no escribas el texto a mano).',
        starter: '# Crea las variables y muestra la frase\n',
        check: all(variable('nombre', "'Linus'"), variable('edad', '30'), stdout('Linus tiene 30 años'), uses('name:nombre'), uses('name:edad')),
        solution: 'nombre = "Linus"\nedad = 30\nprint(nombre, "tiene", edad, "años")',
        hints: ['`print` acepta varios valores separados por comas.', '`print(nombre, "tiene", edad, "años")`'],
        explain: 'Las variables te permiten usar un valor muchas veces sin repetirlo. Si cambias `edad` en una sola línea, la frase se actualiza sola.',
        commands: ['variables', 'print'],
      }),
      pyPractice({
        goal: 'Sube la puntuación',
        prompt: 'La variable `puntos` empieza valiendo 10. Súmale 5 **reasignando** la misma variable y que el programa muestre el resultado (15).',
        starter: 'puntos = 10\n# Suma 5 puntos aquí\nprint(puntos)',
        check: all(variable('puntos', '15'), stdout('15')),
        solution: 'puntos = 10\npuntos = puntos + 5\nprint(puntos)',
        hints: ['Puedes usar el valor actual para calcular el nuevo.', '`puntos = puntos + 5`'],
        explain: 'En una asignación, Python evalúa primero la derecha (`puntos + 5` = 15) y después guarda ese resultado en `puntos`.',
        commands: ['variables'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py1-3', { title: 'Números y operadores', summary: 'Aritmética, precedencia y funciones numéricas', emoji: '🔢', commands: ['int', 'float', 'round', 'abs', 'divmod', 'operadores'], minutes: 10 }, [
      learn(
        'Dos tipos de números',
        `
Python distingue dos clases de números:

- **\`int\`**: enteros, sin parte decimal: \`7\`, \`-3\`, \`1000000\`. Pueden ser enormes: Python no tiene límite práctico.
- **\`float\`**: con decimales, escritos con **punto**: \`3.14\`, \`-0.5\`, \`2.0\`. Ojo: \`2.0\` es un float aunque parezca un entero.

Para números grandes puedes usar guiones bajos y Python los ignora: \`1_000_000\`.
`,
        '🔢',
      ),
      pyDemo('Los operadores aritméticos', [
        pyRepl('7 + 2', 'Suma'),
        pyRepl('7 - 2', 'Resta'),
        pyRepl('7 * 2', 'Multiplicación'),
        pyRepl('7 / 2', 'División: **siempre** da un float'),
        pyRepl('7 // 2', 'División entera: descarta los decimales'),
        pyRepl('7 % 2', 'Módulo: el **resto** de la división'),
        pyRepl('2 ** 10', 'Potencia: 2 elevado a 10'),
      ]),
      learn(
        'Tres divisiones distintas',
        `
- \`/\` divide y **siempre** devuelve un float: \`8 / 2\` da \`4.0\`.
- \`//\` divide y se queda con la **parte entera**: \`17 // 5\` da \`3\`.
- \`%\` da el **resto**: \`17 % 5\` da \`2\` (porque 5 × 3 = 15 y sobran 2).

El módulo \`%\` es más útil de lo que parece: \`n % 2 == 0\` te dice si un número es **par**, y sirve para repartir, para ciclos (horas, días) y para saber si algo es divisible.

> TIP: Las dos juntas cumplen: \`(a // b) * b + a % b == a\`.
`,
      ),
      mc('¿Cuánto vale `17 // 5`?', ['3', '3.4', '2', '4'], 0, '17 entre 5 es 3,4; la división entera se queda con el 3. El resto (`17 % 5`) sería 2.'),
      illus('py-precedence', 'Quién se calcula primero', 'Python respeta el orden de las operaciones, como en matemáticas.'),
      learn(
        'Precedencia y paréntesis',
        `
Cuando mezclas operadores, Python sigue este orden (de más a menos prioridad):

1. \`**\` (potencia)
2. \`*\`, \`/\`, \`//\`, \`%\`
3. \`+\`, \`-\`

A igual prioridad, de izquierda a derecha (la potencia, al revés: \`2 ** 3 ** 2\` es \`2 ** 9\`). Los **paréntesis** mandan sobre todo lo demás y dejan tus intenciones claras: \`(2 + 3) * 4\`.
`,
      ),
      pyOut('¿Qué imprime?', 'print(2 + 3 * 4)\nprint((2 + 3) * 4)\nprint(2 ** 3 ** 2)', ['14\n20\n64', '20\n20\n64', '14\n20\n36'], 'La multiplicación va antes que la suma (14). Con paréntesis, primero 2 + 3 (20). La potencia se evalúa de derecha a izquierda: 3 ** 2 = 9 y 2 ** 9 = 512.'),
      pyDemo('Funciones y atajos útiles', [
        pyRepl('round(3.14159, 2)', '`round` redondea; el segundo número son los decimales'),
        pyRepl('abs(-7)', 'Valor absoluto'),
        pyRepl('divmod(17, 5)', 'Cociente y resto a la vez'),
        ['puntos = 10\npuntos += 5\npuntos *= 2\nprint(puntos)', '`+=`, `-=`, `*=`… actualizan la variable sin repetir su nombre'],
      ]),
      learn(
        'Cuidado: los decimales son aproximados',
        `
La computadora guarda los \`float\` en binario, y algunos decimales sencillos no caben exactos. Es normal en **todos** los lenguajes:

\`\`\`
>>> 0.1 + 0.2
0.30000000000000004
\`\`\`

No es un fallo de Python. Para mostrar resultados usa \`round(valor, 2)\` o un formato (lo verás en la lección de entrada y salida). Y si necesitas exactitud con dinero, hay herramientas como \`decimal\` (más adelante).
`,
        '⚠️',
      ),
      pyDemo('La prueba del algodón', [pyRepl('0.1 + 0.2'), pyRepl('round(0.1 + 0.2, 2)', 'Redondeando para mostrar queda limpio'), pyRepl('0.5 + 0.25', 'Las fracciones de potencias de 2 sí son exactas')]),
      tf('`7 / 2` da `3` en Python.', false, 'La barra simple `/` siempre da un float: `3.5`. Para la parte entera (`3`) usa `//`.'),
      fill('¿Qué operador da el resto de dividir 17 entre 5?', 'print(17 ___ 5)', ['%', '//', '/', '**'], ['%'], '`%` es el módulo: el resto de la división. `17 % 5` vale 2.'),
      pyPractice({
        goal: 'Segundos en un día',
        prompt: 'Calcula cuántos segundos tiene un día (24 horas de 60 minutos de 60 segundos) y muéstralo con `print`. Que Python haga la multiplicación.',
        starter: '',
        check: all(stdout('86400'), uses('op:*')),
        solution: 'print(24 * 60 * 60)',
        hints: ['Multiplica horas × minutos × segundos.', '`print(24 * 60 * 60)`'],
        explain: 'Escribir la cuenta (en vez del resultado) hace el programa más claro: cualquiera ve de dónde sale el 86400.',
        commands: ['operadores'],
      }),
      pyPractice({
        goal: 'Repartir caramelos',
        prompt: 'Hay 17 caramelos para repartir entre 5 amigos. Guarda en `cada_uno` cuántos recibe cada uno (reparto equitativo) y en `sobran` cuántos quedan sin repartir. Usa `//` y `%`.',
        starter: 'caramelos = 17\namigos = 5\n',
        check: all(variable('cada_uno', '3'), variable('sobran', '2'), uses('op://'), uses('op:%')),
        solution: 'caramelos = 17\namigos = 5\ncada_uno = caramelos // amigos\nsobran = caramelos % amigos',
        hints: ['La parte entera de la división es lo que recibe cada uno.', '`cada_uno = caramelos // amigos` y `sobran = caramelos % amigos`'],
        explain: '`//` te da cuántas veces cabe y `%` lo que sobra. Juntas reconstruyen la división: `3 * 5 + 2 = 17`.',
        commands: ['operadores', 'divmod'],
      }),
      pyCode('Guarda en `media` el promedio de 7 y 10.', { check: variable('media', '8.5'), solution: 'media = (7 + 10) / 2', hint: 'Suma primero (con paréntesis) y luego divide entre 2.', why: 'Sin paréntesis, `7 + 10 / 2` daría 12.0 porque la división se calcula antes que la suma.' }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py1-4', { title: 'Texto (str)', summary: 'Cadenas: operar, indexar, rebanar y sus métodos', emoji: '🔤', commands: ['str', 'len', 'str.upper', 'str.lower', 'str.strip', 'str.replace', 'str.split', 'str.join', 'str.find', 'str.startswith'], minutes: 11 }, [
      learn(
        'Texto entre comillas',
        `
Un texto es una **cadena** (\`str\`). Puedes usar comillas simples o dobles; lo importante es cerrar con la misma que abriste. Útil: si tu texto lleva comillas dentro, usa el otro tipo por fuera.

- \`'Dijo "hola"'\` — comillas dobles dentro de simples.
- \`"It's fine"\` — apóstrofo dentro de dobles.
- \`"""texto en varias líneas"""\` — triples comillas.

Los **escapes** con barra invertida añaden caracteres especiales: \`\\n\` (salto de línea), \`\\t\` (tabulador), \`\\"\` (comilla), \`\\\\\` (una barra).
`,
        '🔤',
      ),
      pyDemo('Comillas y escapes', [
        ['print("Primera línea\\nSegunda línea")', '`\\n` crea un salto de línea'],
        ['print(\'Dijo "hola" y se fue\')', 'Comillas dobles dentro de simples'],
        ['print("Columna1\\tColumna2")', '`\\t` es un tabulador'],
        ['print("""Línea 1\nLínea 2\nLínea 3""")', 'Triples comillas: el texto puede ocupar varias líneas'],
      ]),
      learn(
        'Operar con texto',
        `
Con texto puedes hacer dos operaciones aritméticas:

- \`+\` **concatena** (pega): \`"Hola, " + "Ada"\` → \`"Hola, Ada"\`.
- \`*\` **repite**: \`"ja" * 3\` → \`"jajaja"\`.

Y \`len(texto)\` cuenta los caracteres (espacios incluidos). Lo que **no** puedes hacer es mezclar texto con números en un \`+\`: Python no adivina si quieres sumar o pegar.
`,
      ),
      pyDemo('Pegar, repetir y contar', [
        pyRepl('"Hola, " + "Ada"'),
        pyRepl('"ja" * 3'),
        pyRepl('"=" * 20', 'Truco para dibujar líneas'),
        pyRepl('len("Python")'),
        pyErr('"Edad: " + 15', 'No se puede pegar un `str` con un `int`: `TypeError`. Solución: `"Edad: " + str(15)` o una f-string (lo verás pronto)', true),
      ]),
      mc('¿Cuánto vale `len("hola mundo")`?', ['9', '10', '11', '2'], 1, 'Se cuentan todos los caracteres, el espacio incluido: h-o-l-a, espacio, m-u-n-d-o = 10.'),
      illus('py-str-index', 'Índices y rebanadas', 'Cada carácter tiene una posición. La primera es la 0; contando desde el final se usan negativos.'),
      learn(
        'Índices y rebanadas',
        `
Cada carácter tiene una **posición** (índice), y se empieza a contar en **0**:

\`\`\`
 p  y  t  h  o  n
 0  1  2  3  4  5      índices
-6 -5 -4 -3 -2 -1      desde el final
\`\`\`

- \`texto[0]\` → el primero. \`texto[-1]\` → el último.
- \`texto[1:4]\` → **rebanada** desde la posición 1 hasta la 4 **sin incluirla** (posiciones 1, 2, 3).
- \`texto[:3]\` empieza en el principio; \`texto[2:]\` llega hasta el final; \`texto[::-1]\` lo da vuelta.
- \`texto[::2]\` salta de dos en dos.

> NOTA: Pedir una posición que no existe (\`"hola"[10]\`) da un \`IndexError\`; en una rebanada, en cambio, Python es más permisivo.
`,
      ),
      pyDemo('Rebanando una palabra', [
        ['palabra = "serpiente"', 'Guardamos el texto'],
        pyRepl('palabra[0]'),
        pyRepl('palabra[-1]'),
        pyRepl('palabra[0:4]'),
        pyRepl('palabra[4:]'),
        pyRepl('palabra[::-1]', 'Al revés'),
      ]),
      pyOut('¿Qué imprime?', 's = "python"\nprint(s[1:4])\nprint(s[-2:])\nprint(s[::2])', ['yth\nth\npto', 'pyt\non\nptn', 'yth\nho\nytn'], '`s[1:4]` son las posiciones 1, 2 y 3: «yth». `s[-2:]` los dos últimos: «on». `s[::2]` toma una de cada dos: «pto».'),
      learn(
        'Métodos: acciones del texto',
        `
Los textos traen funciones propias llamadas **métodos**, que se escriben con un punto: \`texto.metodo()\`.

| Método | Qué hace |
|---|---|
| \`.upper()\` / \`.lower()\` | Mayúsculas / minúsculas |
| \`.strip()\` | Quita espacios de los extremos |
| \`.replace(a, b)\` | Cambia \`a\` por \`b\` |
| \`.split(sep)\` | Parte el texto en una **lista** |
| \`sep.join(lista)\` | Une una lista usando \`sep\` |
| \`.find(x)\` | Posición de \`x\` (o -1 si no está) |
| \`.startswith(x)\` | ¿Empieza por \`x\`? |

> CLAVE: Los textos son **inmutables**: un método nunca cambia el original, **devuelve uno nuevo**. Si quieres conservarlo, guárdalo: \`nombre = nombre.strip()\`.
`,
        '🧰',
      ),
      pyDemo('Métodos en acción', [
        pyRepl('"  Hola Mundo  ".strip()'),
        pyRepl('"hola".upper()'),
        pyRepl('"banana".replace("a", "o")'),
        pyRepl('"rojo,verde,azul".split(",")'),
        pyRepl('"-".join(["a", "b", "c"])'),
        pyRepl('"banana".find("n")'),
        pyRepl('"python".startswith("py")'),
        pyErr('s = "hola"\ns[0] = "H"', 'Los textos no se pueden modificar «por dentro»: `TypeError`'),
      ]),
      tf('`texto.upper()` convierte a mayúsculas la variable `texto` para siempre.', false, 'Los textos son inmutables: `upper()` devuelve un texto nuevo y deja `texto` intacto. Para conservarlo: `texto = texto.upper()`.'),
      match(
        'Une cada expresión con su resultado',
        [
          ['"ab" * 3', '"ababab"'],
          ['"Python"[0]', '"P"'],
          ['"a-b".split("-")', "['a', 'b']"],
          ['"hola".upper()', '"HOLA"'],
        ],
        'Repetir, indexar, partir y cambiar mayúsculas son las operaciones más comunes con texto.',
      ),
      pyPractice({
        goal: 'Grita el mensaje',
        prompt: 'La variable `mensaje` contiene `"hola mundo"`. Muéstralo **en mayúsculas**: HOLA MUNDO.',
        starter: 'mensaje = "hola mundo"\n',
        check: all(stdout('HOLA MUNDO'), uses('method:upper')),
        solution: 'mensaje = "hola mundo"\nprint(mensaje.upper())',
        hints: ['Hay un método de los textos para esto.', '`mensaje.upper()`'],
        explain: '`upper()` devuelve una copia en mayúsculas; `mensaje` no cambia. Por eso lo metemos directamente en el `print`.',
        commands: ['str.upper'],
      }),
      pyPractice({
        goal: 'Limpia y recorta',
        prompt: 'La variable `entrada` tiene `"   Python   "` (con espacios sobrando). Guarda en `limpio` el texto sin espacios en los extremos, y muestra su longitud con `len`.',
        starter: 'entrada = "   Python   "\n',
        check: all(variable('limpio', "'Python'"), stdout('6')),
        solution: 'entrada = "   Python   "\nlimpio = entrada.strip()\nprint(len(limpio))',
        hints: ['Existe un método que quita los espacios de ambos extremos.', '`limpio = entrada.strip()` y luego `print(len(limpio))`'],
        explain: '`strip()` es imprescindible al leer datos de usuarios: los espacios invisibles dan errores difíciles de ver.',
        commands: ['str.strip', 'len'],
      }),
      pyPractice({
        goal: 'Iniciales',
        prompt: 'La variable `nombre` contiene `"Grace Hopper"`. Muestra solo sus iniciales: **GH**. (Pista: `split` te da las palabras por separado.)',
        starter: 'nombre = "Grace Hopper"\n',
        check: stdout('GH'),
        solution: 'nombre = "Grace Hopper"\nnombre_pila, apellido = nombre.split()\nprint(nombre_pila[0] + apellido[0])',
        hints: ['Primero parte el nombre en dos palabras.', '`partes = nombre.split()`; después toma `partes[0][0]` y `partes[1][0]`.'],
        explain: '`split()` sin argumentos separa por espacios y devuelve una lista; luego se indexa cada palabra con `[0]` para tomar su primera letra.',
        commands: ['str.split'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py1-5', { title: 'Entrada y salida', summary: 'input, conversiones, f-strings y print con estilo', emoji: '⌨️', commands: ['input', 'int', 'float', 'str', 'f-strings', 'print'], minutes: 11 }, [
      learn(
        'input(): preguntarle al usuario',
        `
Hasta ahora tus programas siempre hacían lo mismo. Con \`input()\` el programa **pausa** y espera a que alguien escriba algo y pulse Enter. Lo escrito se devuelve como un **texto**:

\`\`\`
nombre = input("¿Cómo te llamas? ")
print("Hola,", nombre)
\`\`\`

El texto entre paréntesis (el *prompt*) se muestra antes de esperar. Lleva un espacio al final para que no se pegue a lo que escribe el usuario.

> CLAVE: \`input()\` **siempre** devuelve un \`str\`, aunque el usuario escriba \`42\`. Si necesitas un número, hay que convertirlo.
`,
        '⌨️',
      ),
      pyDemo(
        'Leyendo datos',
        [
          ['nombre = input("Nombre: ")\nprint("Hola,", nombre)', 'El programa se queda esperando; aquí ya tiene la respuesta'],
          ['edad = input("Edad: ")\nprint(type(edad))', 'Aunque escribas dígitos, `input` entrega un `str`'],
          ['print(int(edad) + 1)', '`int()` convierte el texto en un entero y ya se puede calcular'],
        ],
        { stdin: ['Ada', '36'] },
        'En estas demostraciones las respuestas del usuario ya vienen preparadas.',
      ),
      learn(
        'Conversiones: int, float, str',
        `
Las funciones que convierten entre tipos tienen el nombre del tipo:

- \`int("42")\` → \`42\`  ·  \`int(3.9)\` → \`3\` (corta, no redondea).
- \`float("3.5")\` → \`3.5\`.
- \`str(42)\` → \`"42"\`.

Si el texto no tiene pinta de número, Python se queja con un **ValueError**: \`int("hola")\`. Más adelante aprenderás a prevenir ese error.
`,
      ),
      pyDemo('Convertir tipos', [
        pyRepl('int("42") + 1'),
        pyRepl('float("3.5") * 2'),
        pyRepl('str(42) + "!"'),
        pyRepl('int(3.9)', 'Corta la parte decimal'),
        pyErr('int("hola")', 'No es un número: `ValueError`', true),
      ]),
      mc('¿De qué tipo es el valor que devuelve `input()`?', ['int', 'float', 'str', 'Depende de lo que escriba el usuario'], 2, 'Siempre `str`. Por eso `input("n: ") + 1` falla y hay que escribir `int(input("n: ")) + 1`.'),
      learn(
        'f-strings: mezclar texto y valores',
        `
Para armar frases con variables, la herramienta moderna son las **f-strings**: un texto con una \`f\` delante, donde lo que va entre llaves \`{}\` se sustituye por su valor.

\`\`\`
nombre = "Ada"
print(f"Hola, {nombre}")          # Hola, Ada
print(f"2 + 3 = {2 + 3}")         # dentro de las llaves cabe cualquier expresión
\`\`\`

Tras dos puntos puedes dar **formato**:

| Formato | Resultado de \`f"{x:...}"\` |
|---|---|
| \`:.2f\` | 2 decimales: \`3.14159\` → \`3.14\` |
| \`:>8\` / \`:<8\` / \`:^8\` | Alinea a la derecha / izquierda / centro en 8 espacios |
| \`:05d\` | Rellena con ceros: \`42\` → \`00042\` |
| \`:,\` | Separador de miles: \`1234567\` → \`1,234,567\` |
`,
        '✨',
      ),
      pyDemo('f-strings con formato', [
        ['precio = 4.5\ncantidad = 3\nprint(f"Total: {precio * cantidad:.2f} €")', 'Cálculo y formato dentro de las llaves'],
        ['for x in ("pan", "leche"):\n    print(f"{x:>8}|")', 'Alineado a la derecha en 8 espacios'],
        ['print(f"{1234567:,}")\nprint(f"{7:03d}")'],
      ]),
      pyOut('¿Qué imprime?', 'precio = 4.5\nprint(f"Total: {precio * 3:.2f} €")\nprint(f"{\'x\':>5}|{\'y\':<5}|")', ['Total: 13.5 €\n    x|y    |', 'Total: 13.50 €\nx    |    y|', 'Total: 13.50 €\n    x|    y|'], '`:.2f` fuerza dos decimales (13.50). `:>5` alinea a la derecha en 5 espacios y `:<5` a la izquierda.'),
      learn(
        'print con sep y end',
        `
\`print\` tiene dos opciones con nombre muy útiles:

- \`sep\`: qué poner **entre** los valores (por defecto, un espacio).
- \`end\`: qué poner **al final** (por defecto, un salto de línea).

\`\`\`
print("a", "b", "c", sep="-")     # a-b-c
print("Cargando", end="...")      # no salta de línea
print("listo")                    # Cargando...listo
\`\`\`
`,
      ),
      pyDemo('sep y end', [['print("2025", "03", "14", sep="-")'], ['print("Cargando", end="...")\nprint("listo")']]),
      tf('Si el usuario escribe `42` en un `input()`, Python lo guarda como el entero 42.', false, '`input()` devuelve siempre texto: `"42"`. Hay que convertirlo con `int()`.'),
      fill('Completa para sumar 1 a la edad que escribe el usuario', 'edad = ___(input("Edad: "))\nprint(edad + 1)', ['int', 'str', 'print', 'len'], ['int'], 'Hay que convertir el texto en un número con `int()` antes de operar con él.'),
      pyPractice({
        goal: 'Saluda por su nombre',
        prompt: 'Lee un nombre con `input()` y muestra **Hola, NOMBRE!** (por ejemplo, con la entrada `Ana`: `Hola, Ana!`).',
        setup: { stdin: ['Ana'] },
        starter: '# Lee el nombre y salúdalo\n',
        check: all(outHas('Hola, Ana!'), uses('call:input')),
        solution: 'nombre = input("Tu nombre: ")\nprint(f"Hola, {nombre}!")',
        hints: ['Guarda lo que devuelve `input()` en una variable.', 'Usa una f-string: `print(f"Hola, {nombre}!")`'],
        explain: 'Con `input()` el programa deja de ser siempre igual: ahora responde a quien lo usa. Con otra entrada saludaría a otra persona.',
        commands: ['input', 'f-strings'],
      }),
      pyPractice({
        goal: 'El doble de un número',
        prompt: 'Lee un número entero con `input()` y muestra su **doble**.',
        setup: { stdin: ['21'] },
        starter: '',
        check: all(outMatch('(^|\\n|\\s)42$'), uses('call:int')),
        solution: 'n = int(input())\nprint(n * 2)',
        hints: ['`input()` devuelve texto: conviértelo antes de multiplicar.', '`n = int(input())` y después `print(n * 2)`'],
        explain: 'Sin `int()`, `"21" * 2` daría `"2121"` (repetir el texto). La conversión de tipo es lo primero que hay que hacer con datos de entrada.',
        commands: ['input', 'int'],
      }),
      pyPractice({
        goal: 'Área de un rectángulo',
        prompt: 'Lee dos números (base y altura, pueden tener decimales) y muestra: **Área: X** con el resultado a **dos decimales**.\n\nEjemplo con 3.5 y 2: `Área: 7.00`',
        setup: { stdin: ['3.5', '2'] },
        starter: '',
        check: all(outMatch('Área: 7\\.00$'), uses('call:float', 1)),
        solution: 'base = float(input("Base: "))\naltura = float(input("Altura: "))\nprint(f"Área: {base * altura:.2f}")',
        hints: ['Como pueden llevar decimales, usa `float()`.', 'Formato de dos decimales: `{valor:.2f}` dentro de una f-string.'],
        explain: 'Combinaste las tres piezas de la lección: leer (`input`), convertir (`float`) y presentar con formato (`:.2f`).',
        commands: ['input', 'float', 'f-strings'],
      }),
    ]),
  ],
  boss: {
    goal: 'Ticket de compra',
    prompt:
      'Escribe un programa que lea **tres datos** (en este orden): el nombre de un producto, la cantidad (entero) y el precio unitario (decimal), y muestre este ticket:\n\n```\nProducto: Teclado\nCantidad: 3\nTotal: 37.50 €\n```\n\n(El total es cantidad × precio, con dos decimales.)',
    setup: { stdin: ['Teclado', '3', '12.5'] },
    starter: '# Lee los datos y muestra el ticket\n',
    check: all(outHas('Producto: Teclado', 'Cantidad: 3', 'Total: 37.50 €'), uses('call:input', 3)),
    solution:
      'producto = input("Producto: ")\ncantidad = int(input("Cantidad: "))\nprecio = float(input("Precio: "))\nprint(f"Producto: {producto}")\nprint(f"Cantidad: {cantidad}")\nprint(f"Total: {cantidad * precio:.2f} €")',
    hints: ['Necesitas tres `input()`; los dos últimos hay que convertirlos (`int` y `float`).', 'Calcula el total dentro de la f-string: `{cantidad * precio:.2f}`.'],
    explain: 'Este programa reúne todo lo de la zona: variables, conversiones, operadores y f-strings con formato. ¡Ya sabes hablar con Python!',
    commands: ['input', 'int', 'float', 'f-strings'],
  },
});
