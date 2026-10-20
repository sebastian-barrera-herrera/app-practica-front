import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyWorld } from '../pybuild';
import { all, calls, expr, file, func, outHas, truthy, uses, variable } from '../pycheck';

/** Módulo de ejemplo que se precarga en el laboratorio de las demos. */
const UTIL_PY = 'print("cargando util, __name__ =", __name__)\n\nPI2 = 6.28\n\ndef saludar(nombre):\n    return f"Hola, {nombre}"\n';
const UTIL_GUARD_PY = 'def saludar(nombre):\n    return f"Hola, {nombre}"\n\nif __name__ == "__main__":\n    print("util.py ejecutado directamente")\n    print(saludar("mundo"))\n';
const TIENDA_FILES = {
  'tienda/__init__.py': 'print("cargando el paquete tienda")\n',
  'tienda/precios.py': 'IVA = 0.21\n\ndef con_iva(precio):\n    return round(precio * (1 + IVA), 2)\n',
  'tienda/stock.py': 'def hay(unidades):\n    return unidades > 0\n',
};

const APP_LOG =
  '2025-03-14 09:00:05 INFO inicio del servicio\n2025-03-14 09:12:41 WARN disco al 85%\n2025-03-14 09:30:00 ERROR fallo de conexión: db1\n2025-03-14 10:02:17 INFO usuario ana inició sesión\n2025-03-14 10:21:09 ERROR tiempo agotado: db2\n2025-03-14 10:44:50 INFO servicio detenido\n';

export const py8 = pyWorld({
  id: 'py8',
  index: 8,
  title: 'Módulos y la biblioteca estándar',
  subtitle: 'Baterías incluidas: no reinventes la rueda',
  emoji: '📚',
  color: '#4ADE80',
  level: 'intermedio',
  intro:
    'Python viene con una enorme **biblioteca estándar**: matemáticas, números aleatorios, fechas, contadores, combinatoria, expresiones regulares… Antes de escribir algo desde cero, pregúntate si ya existe un módulo. En esta zona aprenderás a **importar** módulos (y a crear los tuyos) y a manejar las herramientas que usarás en casi todos tus programas.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py8-1', { title: 'import y módulos propios', summary: 'Usar módulos, crear los tuyos y entender __name__', emoji: '📦', commands: ['import', 'from', 'dir', 'paquetes', '__main__'], minutes: 14 }, [
      learn(
        'Un módulo es un archivo .py',
        `
Un **módulo** es un archivo de Python (\`.py\`) con funciones, constantes y clases que puedes **reutilizar** desde otros programas. Python incluye cientos —la **biblioteca estándar**— bajo el lema *«baterías incluidas»*: \`math\`, \`random\`, \`datetime\`, \`json\`, \`re\`, \`collections\`…

Para usar un módulo lo **importas**:

\`\`\`
import math
print(math.sqrt(49))     # módulo.nombre
\`\`\`

Al importar, Python **ejecuta el archivo una sola vez** y te da un objeto-módulo con todo lo que define. Después usas sus nombres con un punto.
`,
        '📦',
      ),
      pyDemo('Importar módulos de la biblioteca estándar', [
        ['import math\nprint(math.sqrt(49))\nprint(math.pi)'],
        ['import math\nprint("sqrt" in dir(math), "hola" in dir(math))\nprint(math.__name__, type(math).__name__)', '`dir(módulo)` lista lo que contiene. Un módulo es un objeto más'],
        pyErr('import mate_inventada', 'Si no existe: `ModuleNotFoundError`'),
        pyErr('from math import cuadrado', 'El módulo existe pero no tiene ese nombre: `ImportError`'),
      ]),
      illus('py-import-path', 'Cómo encuentra Python un módulo', 'Primero mira los módulos ya cargados, luego la carpeta del programa, la biblioteca estándar y los paquetes instalados.'),
      learn(
        'Las formas de importar',
        `
| Forma | Cómo se usa después |
|---|---|
| \`import math\` | \`math.sqrt(9)\` |
| \`import math as m\` | \`m.sqrt(9)\` (alias, para nombres largos) |
| \`from math import sqrt\` | \`sqrt(9)\` (sin prefijo) |
| \`from math import sqrt as raiz\` | \`raiz(9)\` |
| \`from math import *\` | ¡evítalo! mete todo y pisa tus nombres |

> CLAVE: \`import modulo\` deja claro **de dónde viene** cada cosa (\`math.sqrt\`). Usa \`from modulo import nombre\` cuando uses pocas cosas muchas veces. Por convención, los \`import\` van **al principio** del archivo.
`,
      ),
      pyDemo('Las formas de importar', [
        ['import math as m\nprint(m.floor(7.9))'],
        ['from math import sqrt, pi\nprint(sqrt(16), round(pi, 2))'],
        ['from math import sqrt as raiz\nprint(raiz(81))'],
      ]),
      learn(
        'Tu propio módulo',
        `
**Cualquier archivo \`.py\` es un módulo.** Si junto a tu programa hay un archivo \`util.py\` así:

\`\`\`
print("cargando util, __name__ =", __name__)

PI2 = 6.28

def saludar(nombre):
    return f"Hola, {nombre}"
\`\`\`

puedes hacer \`import util\` y usar \`util.saludar("Ana")\`. Python busca primero en la **carpeta de tu programa** (por eso no pongas a tu archivo el nombre de un módulo estándar, como \`random.py\`: lo taparías).

Un módulo se ejecuta **solo la primera vez** que se importa; las siguientes veces Python reutiliza el que ya está en memoria (\`sys.modules\`).

*(El laboratorio de abajo ya contiene ese \`util.py\`.)*
`,
        '🧩',
      ),
      pyDemo(
        'Importar un módulo propio',
        [
          ['import util\nprint(util.saludar("Ana"))\nprint(util.PI2)', 'Al importar se ejecuta el archivo (ves el `print` de arriba)'],
          ['import util\nimport util\nprint("importado dos veces, cargado una")', 'El segundo `import` reutiliza el módulo de la caché'],
          ['from util import saludar, PI2 as dos_pi\nprint(saludar("Luis"), dos_pi)'],
        ],
        { files: { 'util.py': UTIL_PY } },
      ),
      learn(
        'if __name__ == "__main__"',
        `
Cada módulo tiene un nombre en la variable especial \`__name__\`:

- Si lo **ejecutas directamente** como programa, \`__name__\` vale \`"__main__"\`.
- Si lo **importas** desde otro, vale el nombre del módulo (\`"util"\`).

Así puedes poner al final un bloque que solo se ejecuta como programa (pruebas, un \`main()\`), pero **no** al importarlo:

\`\`\`
if __name__ == "__main__":
    main()
\`\`\`
`,
      ),
      pyDemo(
        'El guard de __main__',
        [
          ['import util\nprint("aquí __name__ vale:", __name__)\nprint("en el módulo vale:", util.__name__)', 'Importado: el bloque `__main__` no se ejecuta'],
          ['exec(open("util.py", encoding="utf-8").read(), {"__name__": "__main__"})', 'Así simulamos ejecutar `util.py` como programa principal'],
        ],
        { files: { 'util.py': UTIL_GUARD_PY } },
      ),
      learn(
        'Paquetes: carpetas de módulos',
        `
Un **paquete** es una **carpeta** con módulos dentro y un archivo \`__init__.py\` (puede estar vacío) que la marca como paquete. Se importa con puntos:

\`\`\`
tienda/
├── __init__.py
├── precios.py
└── stock.py
\`\`\`

\`\`\`
import tienda.precios
from tienda import stock
from tienda.precios import con_iva
\`\`\`

El \`__init__.py\` se ejecuta al importar el paquete. Los paquetes organizan proyectos grandes en piezas con un propósito claro.
`,
      ),
      pyDemo(
        'Un paquete',
        [
          ['import tienda.precios\nprint(tienda.precios.con_iva(100))', 'Se ejecuta el `__init__.py` del paquete al importar'],
          ['from tienda import precios, stock\nprint(precios.con_iva(50), stock.hay(0))'],
          ['from tienda.precios import con_iva\nprint(con_iva(10))'],
        ],
        { files: TIENDA_FILES },
      ),
      pyOut('¿Qué imprime?', 'import util\nprint(util.doble(4))\nprint(util.__name__)', ['8\n__main__', '4\nutil', '8\nutil.py'], 'Se llama a `doble(4)` → 8. Y como `util` se ha **importado**, su `__name__` es `"util"`; `__main__` sería solo si se ejecutara directamente.', { files: { 'util.py': 'def doble(n):\n    return n * 2\n' } }),
      mc('¿Qué hace `from math import sqrt`?', ['Importa todo `math`', 'Trae solo `sqrt`, que se usa sin prefijo: `sqrt(9)`', 'Crea un archivo `sqrt.py`', 'Es lo mismo que `import sqrt`'], 1, 'Con `from … import` traes nombres concretos al espacio de nombres; los usas directamente, sin escribir `math.`.'),
      tf('Si haces `import util` dos veces, Python ejecuta el código de `util.py` dos veces.', false, 'Se ejecuta una sola vez. El módulo queda guardado en `sys.modules` y los `import` siguientes reutilizan ese objeto.'),
      match(
        'Une cada forma de importar con cómo se usa',
        [
          ['import math', 'math.sqrt(9)'],
          ['import math as m', 'm.sqrt(9)'],
          ['from math import sqrt', 'sqrt(9)'],
          ['from math import sqrt as raiz', 'raiz(9)'],
        ],
        'Lo que cambia es el nombre con el que accedes a la función.',
      ),
      fill('Completa para importar `sqrt` con el nombre `raiz`', 'from math import sqrt ___ raiz', ['as', 'to', 'is', '='], ['as'], '`as` crea un alias, tanto en `import … as …` como en `from … import … as …`.'),
      pyPractice({
        goal: 'Importa solo lo que necesitas',
        prompt: 'Importa `sqrt` y `pi` del módulo `math` (con `from … import`). Guarda en `r` el valor de `sqrt(144)` y en `area` el de `pi * 5 ** 2` **redondeado a 2 decimales**.',
        starter: '',
        check: all(variable('r', '12.0'), variable('area', '78.54'), uses('ImportFrom')),
        solution: 'from math import sqrt, pi\nr = sqrt(144)\narea = round(pi * 5 ** 2, 2)',
        hints: ['`from math import sqrt, pi` (puedes importar varios nombres separados por comas).', '`round(valor, 2)` redondea a 2 decimales.'],
        explain: 'Con `from … import` usas los nombres sin prefijo. Es cómodo cuando usas pocos nombres de un módulo.',
        commands: ['from'],
      }),
      pyPractice({
        goal: 'Usa un módulo que ya existe',
        prompt: 'En la carpeta hay un archivo `util.py` con las funciones `doble(n)` y `es_par(n)`. Impórtalo y guarda en `a` el doble de 21, y en `b` si 10 es par.',
        setup: { files: { 'util.py': 'def doble(n):\n    return n * 2\n\ndef es_par(n):\n    return n % 2 == 0\n' } },
        starter: '',
        check: all(variable('a', '42'), variable('b', 'True'), uses('import:util')),
        solution: 'import util\na = util.doble(21)\nb = util.es_par(10)',
        hints: ['El módulo se llama `util` (el archivo sin `.py`).', '`util.doble(21)` y `util.es_par(10)`.'],
        explain: 'Cualquier `.py` junto a tu programa es importable. Así puedes dividir un proyecto en archivos con sentido.',
        commands: ['import'],
      }),
      pyPractice({
        goal: 'Crea tu propio módulo',
        prompt: 'Desde el propio código, **escribe** un archivo `mate.py` que defina `cuadrado(n)` (devuelve `n * n`), luego **impórtalo** y guarda en `r` el valor de `cuadrado(7)`.',
        starter: '',
        check: all(file('mate.py', { exists: true, includes: 'def cuadrado' }), variable('r', '49'), uses('import:mate')),
        solution: 'with open("mate.py", "w", encoding="utf-8") as f:\n    f.write("def cuadrado(n):\\n    return n * n\\n")\nimport mate\nr = mate.cuadrado(7)',
        hints: ['Escribe el texto del módulo con `open("mate.py", "w")` y `f.write(...)`.', 'Usa `\\n` dentro del texto para separar líneas, y haz el `import mate` **después** de crear el archivo.'],
        explain: 'Un módulo no es más que un archivo de texto con código Python. (Normalmente lo escribes con tu editor; aquí lo generamos desde el código para verlo funcionar.)',
        commands: ['import', 'dir'],
      }),
      pyCode('Importa `math` con el alias `m` y guarda en `x` el resultado de `m.floor(9.99)`.', {
        check: all(variable('x', '9'), uses('import:math')),
        solution: 'import math as m\nx = m.floor(9.99)',
        hint: '`import math as m`',
        why: '`floor` redondea hacia abajo (9.99 → 9) y devuelve un entero. El alias acorta nombres largos.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py8-2', { title: 'math, random y statistics', summary: 'Matemáticas, azar reproducible y estadística básica', emoji: '🎲', commands: ['math.sqrt', 'math.floor', 'math.ceil', 'math.isclose', 'random.randint', 'random.choice', 'random.shuffle', 'random.seed', 'statistics.mean', 'statistics.median'], minutes: 14 }, [
      learn(
        'math: las matemáticas',
        `
El módulo \`math\` añade lo que no traen los operadores:

| Función | Qué hace |
|---|---|
| \`math.sqrt(x)\` | Raíz cuadrada (siempre \`float\`) |
| \`math.floor(x)\` / \`math.ceil(x)\` | Redondea **hacia abajo** / **hacia arriba** (devuelve \`int\`) |
| \`math.pi\`, \`math.e\` | Constantes π y *e* |
| \`math.hypot(a, b)\` | Hipotenusa: √(a² + b²) |
| \`math.gcd(a, b)\` | Máximo común divisor |
| \`math.factorial(n)\` | n! |
| \`math.log(x)\`, \`log10\`, \`log2\` | Logaritmos |
| \`math.isclose(a, b)\` | ¿Son casi iguales? (para \`float\`) |

> CLAVE: los \`float\` tienen pequeños errores (\`0.1 + 0.2 != 0.3\`). **Nunca compares decimales con \`==\`**: usa \`math.isclose\`.
`,
        '🧮',
      ),
      pyDemo('Funciones de math', [
        ['import math\nprint(math.sqrt(16), math.floor(3.7), math.ceil(3.2))'],
        ['import math\nprint(round(math.pi, 3), math.hypot(3, 4), math.gcd(12, 18), math.factorial(5))'],
        ['import math\nprint(0.1 + 0.2 == 0.3)\nprint(math.isclose(0.1 + 0.2, 0.3))', 'Comparar decimales: `isclose`'],
        pyErr('import math\nmath.sqrt(-1)', 'Fuera de dominio: `ValueError: math domain error`'),
      ]),
      learn(
        'random: azar',
        `
El módulo \`random\` genera números **pseudoaleatorios**:

- \`random.random()\` → decimal en [0, 1).
- \`random.randint(a, b)\` → entero entre \`a\` y \`b\`, **ambos incluidos**.
- \`random.uniform(a, b)\` → decimal entre \`a\` y \`b\`.
- \`random.choice(secuencia)\` → un elemento al azar.
- \`random.sample(secuencia, k)\` → \`k\` elementos distintos.
- \`random.shuffle(lista)\` → **mezcla la lista en su sitio** (devuelve \`None\`).
- \`random.seed(n)\` → fija la **semilla**: con la misma semilla, siempre sale la misma secuencia.

La semilla es oro para **depurar y testear**: resultados «aleatorios» pero repetibles.
`,
      ),
      pyDemo('Azar con semilla', [
        ['import random\nrandom.seed(42)\nprint(random.randint(1, 20))\nprint(random.choice(["rojo", "verde", "azul"]))\nprint(random.random())', 'Con `seed(42)` siempre sale lo mismo'],
        ['import random\nrandom.seed(7)\nmazo = [1, 2, 3, 4, 5, 6]\nrandom.shuffle(mazo)\nprint(mazo)'],
        ['import random\nrandom.seed(1)\nprint(random.sample(range(1, 50), 3))', 'Tres números **distintos**, p. ej. para una lotería'],
      ]),
      learn(
        'statistics: estadística básica',
        `
\`statistics\` resume listas de números sin que escribas las fórmulas:

- \`mean(datos)\` → media.
- \`median(datos)\` → mediana (el valor central).
- \`mode(datos)\` → moda (el más repetido).
- \`stdev(datos)\` / \`pstdev(datos)\` → desviación típica (de muestra / de población).

La **media** se ve arrastrada por valores extremos; la **mediana**, no: en \`[1, 2, 3, 10]\` la media es 4 pero la mediana es 2.5.
`,
      ),
      pyDemo('Resumen de datos', [
        ['import statistics\nnotas = [10, 20, 30, 12]\nprint(statistics.mean(notas))\nprint(statistics.median(notas))'],
        ['import statistics\nprint(statistics.mode([1, 2, 2, 3, 2]))\nprint(statistics.stdev([2, 4, 4, 4, 5, 5, 7, 9]))'],
        pyErr('import statistics\nstatistics.mean([])', 'Sin datos: `StatisticsError`'),
      ]),
      pyOut('¿Qué imprime?', 'import math\nprint(math.floor(-2.5), math.ceil(-2.5), round(-2.5), int(-2.5))', ['-2 -3 -3 -2', '-3 -3 -3 -3', '-2 -2 -2 -2'], '`floor` va hacia abajo (−3), `ceil` hacia arriba (−2), `round(-2.5)` redondea al par más cercano (−2) e `int` trunca hacia cero (−2).'),
      pyOut('¿Qué imprime?', 'import statistics\ndatos = [1, 2, 3, 10]\nprint(statistics.mean(datos), statistics.median(datos))', ['4.0 2.5', '4 2', '4 3'], 'La media es 16/4 = 4 y la mediana es el promedio de los dos centrales: (2 + 3) / 2 = 2.5. Un valor extremo (10) sube la media pero no la mediana.'),
      mc('¿Qué devuelve `random.randint(1, 6)`?', ['Un decimal entre 1 y 6', 'Un entero entre 1 y 6, ambos incluidos', 'Un entero entre 1 y 5', 'Una lista con seis números'], 1, 'A diferencia de `range`, `randint` **incluye** el extremo superior: es como tirar un dado.'),
      tf('Si llamas a `random.seed(42)` antes de generar números, la secuencia será siempre la misma.', true, 'La semilla fija el estado inicial del generador: misma semilla → misma secuencia. Muy útil para reproducir resultados.'),
      match(
        'Une cada llamada con su resultado',
        [
          ['math.floor(3.9)', '3'],
          ['math.ceil(3.1)', '4'],
          ['math.sqrt(49)', '7.0'],
          ['math.gcd(12, 18)', '6'],
        ],
        '`sqrt` siempre devuelve `float`; `floor` y `ceil` devuelven `int`.',
      ),
      fill('Completa para traer solo la raíz cuadrada', 'from math import ___\nprint(sqrt(25))', ['sqrt', 'math', 'import', 'pi'], ['sqrt'], 'Tras `from math import` va el nombre que quieres traer.'),
      pyPractice({
        goal: 'Hipotenusa',
        prompt: 'Un triángulo rectángulo tiene catetos de 6 y 8. Guarda en `h` la longitud de su hipotenusa usando el módulo `math`.',
        starter: '',
        check: all(variable('h', '10.0'), uses('import:math')),
        solution: 'import math\nh = math.hypot(6, 8)',
        hints: ['`math.hypot(a, b)` calcula la hipotenusa.', 'También sirve `math.sqrt(6 ** 2 + 8 ** 2)`.'],
        explain: 'Antes de escribir una fórmula, mira si el módulo ya la tiene: `hypot` además evita errores numéricos con valores enormes.',
        commands: ['math.sqrt'],
      }),
      pyPractice({
        goal: 'Un dado reproducible',
        prompt: 'Fija la semilla en **42** con `random.seed` y guarda en `dado` el resultado de `random.randint(1, 6)`.',
        starter: '',
        check: all(variable('dado', '6'), uses('method:seed'), uses('method:randint')),
        solution: 'import random\nrandom.seed(42)\ndado = random.randint(1, 6)',
        hints: ['Primero `random.seed(42)` y después `random.randint(1, 6)`.', 'Recuerda `import random` al principio.'],
        explain: 'Con la misma semilla el «azar» es repetible, así que tus pruebas siempre dan el mismo resultado.',
        commands: ['random.seed', 'random.randint'],
      }),
      pyPractice({
        goal: 'Estadísticas de notas',
        prompt: 'Dada la lista `notas`, guarda en `media` la media **redondeada a 2 decimales**, en `mediana` la mediana y en `moda` la nota más frecuente. Usa el módulo `statistics`.',
        starter: 'notas = [7, 9, 5, 8, 6, 9, 10]\n',
        check: all(variable('media', '7.71'), variable('mediana', '8'), variable('moda', '9'), uses('import:statistics')),
        solution: 'import statistics\nnotas = [7, 9, 5, 8, 6, 9, 10]\nmedia = round(statistics.mean(notas), 2)\nmediana = statistics.median(notas)\nmoda = statistics.mode(notas)',
        hints: ['`statistics.mean`, `statistics.median` y `statistics.mode`.', 'Redondea solo la media: `round(..., 2)`.'],
        explain: 'Tres líneas bastan para resumir datos. Fíjate en que la mediana (8) y la media (7.71) cuentan historias algo distintas.',
        commands: ['statistics.mean', 'statistics.median'],
      }),
      pyCode('Calcula con `math.ceil` el número de páginas necesarias para 47 elementos a 10 por página y guárdalo en `paginas`.', {
        starter: 'import math\ntotal = 47\npor_pagina = 10\n',
        check: all(variable('paginas', '5'), uses('method:ceil')),
        solution: 'import math\ntotal = 47\npor_pagina = 10\npaginas = math.ceil(total / por_pagina)',
        hint: '47 / 10 = 4.7 → hay que redondear **hacia arriba**.',
        why: '`ceil` es el redondeo clásico para «cuántos envases/páginas necesito»: siempre sube al siguiente entero.',
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py8-3', { title: 'datetime y time', summary: 'Fechas, horas, duraciones y formatos', emoji: '📅', commands: ['datetime.date', 'datetime.datetime', 'datetime.timedelta', 'datetime.strftime', 'datetime.strptime', 'time.sleep', 'time.perf_counter'], minutes: 14 }, [
      learn(
        'date, datetime y timedelta',
        `
El módulo \`datetime\` trae tres tipos clave:

- \`date(2025, 3, 14)\` → una **fecha** (año, mes, día).
- \`datetime(2025, 3, 14, 18, 30)\` → fecha **y hora**.
- \`timedelta(days=30, hours=2)\` → una **duración**.

Con ellos se hace aritmética natural:

- fecha − fecha → \`timedelta\` (con \`.days\` y \`.total_seconds()\`).
- fecha + \`timedelta\` → otra fecha.
- Se pueden **comparar** con \`<\`, \`>\`, \`==\`.

Atributos útiles: \`.year\`, \`.month\`, \`.day\`, \`.hour\`… y \`.weekday()\` (**0 = lunes** … 6 = domingo). \`date.today()\` y \`datetime.now()\` dan el momento actual.

> En este laboratorio el reloj es **virtual y determinista**: en tus tareas usa fechas concretas en vez de «hoy», así el resultado no depende del día en que lo ejecutes.
`,
        '📅',
      ),
      pyDemo('Fechas y duraciones', [
        ['from datetime import date, timedelta\nd = date(2025, 3, 14)\nprint(d, d.year, d.month, d.day)\nprint(d + timedelta(days=30))'],
        ['from datetime import date\nprint((date(2025, 12, 25) - date(2025, 3, 14)).days, "días hasta Navidad")'],
        ['from datetime import datetime\nt = datetime(2025, 3, 14, 9, 0) - datetime(2025, 3, 14, 7, 15)\nprint(t, t.total_seconds())', 'La resta de dos `datetime` es un `timedelta`'],
        ['from datetime import date, timedelta\nprint(date(2024, 2, 28) + timedelta(days=2))\nprint(timedelta(hours=26), timedelta(minutes=90).total_seconds())', '2024 es bisiesto'],
      ]),
      learn(
        'Formatos: strftime y strptime',
        `
Para pasar de fecha a texto y viceversa:

- **\`strftime(formato)\`** (*format*): fecha → **texto**.
- **\`datetime.strptime(texto, formato)\`** (*parse*): texto → **datetime**.
- \`isoformat()\` y \`date.fromisoformat(...)\` para el estándar \`AAAA-MM-DD\`.

| Código | Significado | Ejemplo |
|---|---|---|
| \`%Y\` \`%m\` \`%d\` | año · mes · día | \`2025\` \`03\` \`14\` |
| \`%H\` \`%M\` \`%S\` | hora (24h) · minuto · segundo | \`18\` \`30\` \`05\` |
| \`%A\` \`%B\` | nombre del día · del mes | \`Friday\` \`March\` |
| \`%j\` | día del año | \`073\` |

Los nombres (\`%A\`, \`%B\`) dependen del idioma configurado; en la configuración por defecto salen en inglés.
`,
      ),
      pyDemo('Dar y leer formato', [
        ['from datetime import datetime\nt = datetime(2025, 3, 14, 18, 30)\nprint(t.strftime("%d/%m/%Y"))\nprint(t.strftime("%H:%M"))\nprint(t.strftime("%A %B"))'],
        ['from datetime import datetime\nt = datetime.strptime("14/03/2025 18:30", "%d/%m/%Y %H:%M")\nprint(t, t.hour, t.date().isoformat())', 'Del texto de un formulario a un objeto'],
        pyErr('from datetime import datetime\ndatetime.strptime("14-03-2025", "%d/%m/%Y")', 'Si el texto no encaja con el formato: `ValueError`'),
      ]),
      learn(
        'time: esperar y medir',
        `
El módulo \`time\` trabaja con el reloj del sistema:

- \`time.sleep(segundos)\` → pausa el programa.
- \`time.time()\` → segundos desde 1970 (la «marca de tiempo» Unix).
- \`time.perf_counter()\` → cronómetro de alta precisión para **medir cuánto tarda algo**.

\`\`\`
t0 = time.perf_counter()
# ... trabajo ...
print(time.perf_counter() - t0)
\`\`\`

(En el laboratorio \`sleep\` no espera de verdad: avanza el reloj virtual al instante.)
`,
      ),
      pyDemo('Medir tiempo', [['import time\nt0 = time.perf_counter()\ntime.sleep(1.5)\nprint(round(time.perf_counter() - t0, 1), "segundos")']]),
      pyOut('¿Qué imprime?', 'from datetime import date, timedelta\nprint(date(2024, 2, 28) + timedelta(days=2))', ['2024-02-30', '2024-03-02', '2024-02-29'], '2024 es bisiesto: febrero tiene 29 días. Dos días después del 28 de febrero es el **1 de marzo**.'),
      pyOut('¿Qué imprime?', 'from datetime import date\nd = date(2025, 3, 14)\nprint(d.weekday(), d.strftime("%A"))', ['5 Friday', '4 Viernes', '3 Friday'], '`weekday()` cuenta desde 0 = lunes, así que el viernes es 4. `%A` da el nombre del día en inglés.'),
      mc('¿Qué devuelve restar dos objetos `date`?', ['Un entero', 'Un `timedelta`', 'Otra `date`', 'Un texto'], 1, 'La diferencia entre dos fechas es una duración (`timedelta`); accedes a `.days` para los días.'),
      tf('`strftime` convierte un texto en una fecha.', false, 'Es al revés: `strftime` («format») pasa de fecha a **texto**; `strptime` («parse») pasa de texto a fecha.'),
      fill('Completa el formato para leer «14/03/2025»', 'datetime.strptime("14/03/2025", "___")', ['%d/%m/%Y', '%Y-%m-%d', '%m/%d/%Y', 'dd/mm/yyyy'], ['%d/%m/%Y'], 'Día `%d`, mes `%m`, año de 4 cifras `%Y`, con las mismas barras que el texto.'),
      match(
        'Une cada código de formato con lo que produce para 18:30 del 14/03/2025',
        [
          ['%Y', '2025'],
          ['%m', '03'],
          ['%d', '14'],
          ['%H:%M', '18:30'],
        ],
        'Las mayúsculas y minúsculas importan: `%M` son minutos y `%m` es el mes.',
      ),
      pyPractice({
        goal: 'Días hasta Navidad',
        prompt: 'Calcula cuántos días hay entre el **14 de marzo de 2025** y el **25 de diciembre de 2025**. Guarda el número en `dias`.',
        starter: 'from datetime import date\n',
        check: all(variable('dias', '286'), uses('import:datetime')),
        solution: 'from datetime import date\nhoy = date(2025, 3, 14)\nnavidad = date(2025, 12, 25)\ndias = (navidad - hoy).days',
        hints: ['Resta las dos fechas: da un `timedelta`.', 'Del `timedelta` te interesa el atributo `.days`.'],
        explain: 'Restar fechas te da la duración exacta, bisiestos incluidos, sin hacer ninguna cuenta a mano.',
        commands: ['datetime.date', 'datetime.timedelta'],
      }),
      pyPractice({
        goal: 'De texto a formato ISO',
        prompt: 'La variable `entrada` tiene una fecha en formato `día/mes/año`. Conviértela al formato ISO `AAAA-MM-DD` y guárdala en `iso`.',
        starter: 'from datetime import datetime\nentrada = "14/03/2025"\n',
        check: all(variable('iso', "'2025-03-14'"), uses('method:strptime')),
        solution: 'from datetime import datetime\nentrada = "14/03/2025"\niso = datetime.strptime(entrada, "%d/%m/%Y").date().isoformat()',
        hints: ['Primero `strptime(entrada, "%d/%m/%Y")` para obtener un `datetime`.', 'Después `.date().isoformat()` (o `.strftime("%Y-%m-%d")`).'],
        explain: 'Es la receta habitual con datos de usuario: **parsear** el texto a un objeto y **formatearlo** como lo necesites.',
        commands: ['datetime.strptime', 'datetime.strftime'],
      }),
      pyPractice({
        goal: 'Fecha de vencimiento',
        prompt: 'Una factura se emitió el **31/01/2025** y vence a los **45 días**. Guarda en `vence` la fecha de vencimiento como texto en formato `dd/mm/aaaa`.',
        starter: 'from datetime import date, timedelta\nemision = date(2025, 1, 31)\n',
        check: all(variable('vence', "'17/03/2025'"), uses('method:strftime')),
        solution: 'from datetime import date, timedelta\nemision = date(2025, 1, 31)\nvence = (emision + timedelta(days=45)).strftime("%d/%m/%Y")',
        hints: ['`emision + timedelta(days=45)` da la fecha de vencimiento.', 'Conviértela a texto con `.strftime("%d/%m/%Y")`.'],
        explain: 'Sumar un `timedelta` respeta la longitud real de cada mes. Luego formateas la fecha para mostrarla.',
        commands: ['datetime.timedelta', 'datetime.strftime'],
      }),
      pyPractice({
        goal: 'Duración de una sesión',
        prompt: 'Una sesión de estudio empezó a las 9:00 y terminó a las 10:45 del 14/03/2025. Guarda en `minutos` los minutos que duró, como número entero.',
        starter: 'from datetime import datetime\ninicio = datetime(2025, 3, 14, 9, 0)\nfin = datetime(2025, 3, 14, 10, 45)\n',
        check: all(variable('minutos', '105'), uses('op:-')),
        solution: 'from datetime import datetime\ninicio = datetime(2025, 3, 14, 9, 0)\nfin = datetime(2025, 3, 14, 10, 45)\nminutos = int((fin - inicio).total_seconds() // 60)',
        hints: ['`fin - inicio` es un `timedelta`.', '`.total_seconds()` te da los segundos; divide entre 60 con `//`.'],
        explain: '`total_seconds()` es la forma segura de convertir una duración a una sola unidad (`.seconds` solo da la parte de segundos del día).',
        commands: ['datetime.timedelta'],
      }),
      pyCode('Guarda en `finde` si la fecha `d` cae en fin de semana (sábado o domingo).', {
        starter: 'from datetime import date\nd = date(2025, 3, 15)\n',
        check: all(variable('finde', 'True'), uses('method:weekday')),
        solution: 'from datetime import date\nd = date(2025, 3, 15)\nfinde = d.weekday() >= 5',
        hint: '`weekday()` devuelve 5 para el sábado y 6 para el domingo.',
        why: 'Con lunes = 0, los días 5 y 6 son el fin de semana: basta con comparar `>= 5`.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py8-4', { title: 'collections e itertools', summary: 'Contadores, colas, grupos y combinatoria', emoji: '🧰', commands: ['collections.Counter', 'collections.defaultdict', 'collections.deque', 'collections.namedtuple', 'itertools.product', 'itertools.combinations', 'itertools.chain', 'itertools.groupby'], minutes: 15 }, [
      learn(
        'collections: contenedores con superpoderes',
        `
\`collections\` amplía \`list\`, \`dict\` y \`tuple\` con cuatro herramientas muy usadas:

- **\`Counter(iterable)\`** → cuenta cuántas veces aparece cada elemento. \`.most_common(n)\` devuelve los \`n\` más frecuentes.
- **\`defaultdict(fabrica)\`** → un diccionario que crea el valor inicial si la clave no existe (\`defaultdict(list)\`, \`defaultdict(int)\`).
- **\`deque\`** → cola doble: añadir y sacar por **ambos extremos** muy rápido. Con \`maxlen\` descarta los más antiguos.
- **\`namedtuple\`** → tuplas con **nombres de campo**: \`p.x\` en vez de \`p[0]\`.
`,
        '🧰',
      ),
      pyDemo('Las cuatro herramientas', [
        ['from collections import Counter\nc = Counter("abracadabra")\nprint(c)\nprint(c.most_common(2), c["a"], c["z"])', 'Una clave que no existe cuenta 0'],
        ['from collections import defaultdict\ngrupos = defaultdict(list)\nfor palabra in ["sol", "luna", "sal", "lana"]:\n    grupos[palabra[0]].append(palabra)\nprint(dict(grupos))', 'Sin comprobar si la clave existe'],
        ['from collections import deque\nq = deque([1, 2, 3], maxlen=3)\nq.append(4)\nprint(q)\nq.appendleft(0)\nprint(q, q.popleft())', 'Con `maxlen`, al añadir por un lado se pierde un elemento del otro'],
        ['from collections import namedtuple\nPunto = namedtuple("Punto", "x y")\np = Punto(3, 4)\nprint(p, p.x + p.y, p._replace(x=9), p._asdict())', 'Sigue siendo una tupla: inmutable y desempaquetable'],
      ]),
      learn(
        'itertools: combinatoria y flujos',
        `
\`itertools\` ofrece piezas para recorrer datos de formas creativas. Devuelven **iteradores perezosos** (usa \`list(...)\` para verlos):

| Función | Qué produce |
|---|---|
| \`product(a, b)\` | Producto cartesiano: todas las parejas \`(x, y)\` |
| \`permutations(xs, k)\` | Ordenaciones (**importa el orden**) |
| \`combinations(xs, k)\` | Selecciones (**no** importa el orden, sin repetir) |
| \`chain(a, b)\` | Une varias secuencias como si fueran una |
| \`islice(it, n)\` | Los primeros \`n\` elementos de un iterador |
| \`accumulate(xs)\` | Sumas acumuladas |
| \`groupby(xs, clave)\` | Agrupa elementos **consecutivos** con la misma clave (ordena antes) |
| \`zip_longest(a, b)\` | Como \`zip\`, pero hasta la más larga |
`,
      ),
      pyDemo('Combinatoria', [
        ['from itertools import product, permutations, combinations\nprint(list(product("ab", [1, 2])))\nprint(list(permutations([1, 2, 3], 2)))\nprint(list(combinations("abc", 2)))'],
        ['from itertools import chain, islice, count, accumulate\nprint(list(chain([1, 2], [3], "ab")))\nprint(list(islice(count(10), 3)))\nprint(list(accumulate([1, 2, 3, 4])))', '`count()` es infinito; `islice` lo corta'],
        ['from itertools import groupby\nfor letra, grupo in groupby("aabbbc"):\n    print(letra, len(list(grupo)))', 'Agrupa elementos **consecutivos** iguales'],
      ]),
      pyOut('¿Qué imprime?', 'from collections import Counter\nprint(Counter("mississippi").most_common(2))', ["[('s', 4), ('i', 4)]", "[('i', 4), ('p', 2)]", "[('m', 1), ('i', 4)]"], 'En «mississippi» la `i` y la `s` aparecen 4 veces. Con empate, `most_common` respeta el orden de primera aparición: la `i` salió antes que la `s`.'),
      pyOut('¿Qué imprime?', 'from itertools import combinations, permutations\nprint(len(list(combinations("abcd", 2))), len(list(permutations("abcd", 2))))', ['12 6', '6 6', '16 12'], 'Combinaciones de 2 entre 4: 6 (no importa el orden). Permutaciones: 12, porque `ab` y `ba` cuentan como distintas.'),
      mc('¿Para qué sirve `defaultdict(list)`?', ['Para ordenar listas', 'Para que una clave nueva empiece con una lista vacía', 'Para evitar claves repetidas', 'Para guardar solo listas'], 1, 'Cuando accedes a una clave que no existe, crea `list()` automáticamente: puedes hacer `d[k].append(x)` sin comprobar antes.'),
      tf('`combinations("abc", 2)` incluye tanto `("a", "b")` como `("b", "a")`.', false, 'Las **combinaciones** no distinguen el orden: solo aparece `("a", "b")`. Las **permutaciones** sí incluyen ambas.'),
      fill('Completa para que la cola solo recuerde los 3 últimos valores', 'from collections import deque\nultimos = deque(___=3)', ['maxlen', 'max', 'size', 'limit'], ['maxlen'], 'Con `maxlen` la cola descarta automáticamente los elementos más antiguos al añadir por el otro extremo.'),
      match(
        'Une cada herramienta con su uso típico',
        [
          ['Counter', 'Contar frecuencias'],
          ['defaultdict', 'Agrupar sin comprobar claves'],
          ['deque', 'Cola o pila eficiente'],
          ['namedtuple', 'Registro inmutable con campos con nombre'],
        ],
        'Elegir la estructura adecuada te ahorra código y errores.',
      ),
      pyPractice({
        goal: 'La palabra más repetida',
        prompt: 'Con `Counter`, guarda en `top` la pareja `(palabra, veces)` de la palabra más repetida de `texto`.',
        starter: 'from collections import Counter\ntexto = "la casa de la playa y la montaña de ana"\n',
        check: all(variable('top', "('la', 3)"), uses('import:collections')),
        solution: 'from collections import Counter\ntexto = "la casa de la playa y la montaña de ana"\ntop = Counter(texto.split()).most_common(1)[0]',
        hints: ['Cuenta las palabras con `Counter(texto.split())`.', '`most_common(1)` devuelve una lista con una pareja; toma su primer elemento con `[0]`.'],
        explain: 'Contar frecuencias es tan común que merece una herramienta propia. Antes habrías necesitado un diccionario y un bucle.',
        commands: ['collections.Counter'],
      }),
      pyPractice({
        goal: 'Agrupar por inicial',
        prompt: 'Agrupa las `palabras` por su primera letra en un `defaultdict(list)` llamado `grupos` (clave: la letra; valor: la lista de palabras, en el orden original).',
        starter: 'from collections import defaultdict\npalabras = ["manzana", "pera", "melón", "piña", "mora", "naranja"]\n',
        check: all(expr('dict(grupos)', "{'m': ['manzana', 'melón', 'mora'], 'p': ['pera', 'piña'], 'n': ['naranja']}"), uses('call:defaultdict')),
        solution: 'from collections import defaultdict\npalabras = ["manzana", "pera", "melón", "piña", "mora", "naranja"]\ngrupos = defaultdict(list)\nfor p in palabras:\n    grupos[p[0]].append(p)',
        hints: ['`grupos = defaultdict(list)` antes del bucle.', 'Dentro del bucle: `grupos[p[0]].append(p)`.'],
        explain: 'Gracias al `defaultdict` no hace falta el clásico «si la clave no existe, créala». El código queda corto y claro.',
        commands: ['collections.defaultdict'],
      }),
      pyPractice({
        goal: 'Torneo de todos contra todos',
        prompt: 'Con `itertools`, guarda en `partidos` la lista de todos los emparejamientos posibles (sin repetir ni distinguir el orden) entre los `equipos`.',
        starter: 'from itertools import combinations\nequipos = ["A", "B", "C", "D"]\n',
        check: all(expr('len(partidos)', '6'), expr('partidos[0]', "('A', 'B')"), expr('partidos[-1]', "('C', 'D')"), uses('import:itertools')),
        solution: 'from itertools import combinations\nequipos = ["A", "B", "C", "D"]\npartidos = list(combinations(equipos, 2))',
        hints: ['Cada partido es una **combinación** de 2 equipos.', '`list(combinations(equipos, 2))`'],
        explain: 'Con 4 equipos hay 6 partidos. `combinations` los genera sin duplicados (A-B y B-A son el mismo partido).',
        commands: ['itertools.combinations'],
      }),
      pyPractice({
        goal: 'Los últimos tres',
        prompt: 'Crea un `deque` llamado `ultimos` que solo guarde **los 3 últimos** valores, y añádele con un bucle los números del 1 al 7. Al final `ultimos` debe contener 5, 6 y 7.',
        starter: 'from collections import deque\n',
        check: all(expr('list(ultimos)', '[5, 6, 7]'), uses('call:deque')),
        solution: 'from collections import deque\nultimos = deque(maxlen=3)\nfor n in range(1, 8):\n    ultimos.append(n)',
        hints: ['`deque(maxlen=3)` crea la cola con límite.', 'Con `append` en el bucle, los más antiguos se descartan solos.'],
        explain: 'Un historial «de los últimos N» (mensajes, comandos, lecturas de un sensor) es el uso estrella de `deque(maxlen=N)`.',
        commands: ['collections.deque'],
      }),
      pyCode('Crea con `namedtuple` el tipo `Punto` (campos `x` e `y`) y guarda en `p` el punto (3, 4).', {
        starter: 'from collections import namedtuple\n',
        check: all(expr('p.x + p.y', '7'), expr('type(p).__name__', "'Punto'")),
        solution: 'from collections import namedtuple\nPunto = namedtuple("Punto", "x y")\np = Punto(3, 4)',
        hint: '`namedtuple("Punto", "x y")` devuelve una clase; llámala con los valores.',
        why: '`namedtuple` crea un tipo nuevo: lo guardas en una variable (con nombre de clase, `Punto`) y construyes valores con él.',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py8-5', { title: 'Expresiones regulares', summary: 'Buscar, validar y reemplazar patrones de texto con re', emoji: '🔎', commands: ['regex', 're.search', 're.match', 're.findall', 're.sub', 're.split'], minutes: 16 }, [
      learn(
        'Describir patrones de texto',
        `
Una **expresión regular** (*regex*) es un mini-lenguaje para describir patrones de texto: «tres letras, un guion y cuatro dígitos», «algo parecido a un correo»… En Python se usan con el módulo \`re\` y, por comodidad, con **cadenas crudas** \`r"..."\` (la barra invertida no se interpreta como escape).

| Patrón | Significa |
|---|---|
| \`.\` | cualquier carácter (menos el salto de línea) |
| \`\\d\` · \`\\w\` · \`\\s\` | un dígito · una letra/dígito/\`_\` · un espacio |
| \`\\D\` · \`\\W\` · \`\\S\` | lo contrario de cada uno |
| \`[abc]\` · \`[a-z]\` · \`[^0-9]\` | uno de esos · de un rango · cualquiera menos esos |
| \`*\` · \`+\` · \`?\` | 0 o más · 1 o más · 0 o 1 |
| \`{3}\` · \`{2,4}\` | exactamente 3 · entre 2 y 4 |
| \`^\` · \`$\` | inicio · fin del texto |
| \`\\b\` | límite de palabra |
| \`a\\|b\` | «a» o «b» |
| \`( )\` | un **grupo** (se puede extraer) |
`,
        '🔎',
      ),
      learn(
        'Las funciones de re',
        `
| Función | Qué hace |
|---|---|
| \`re.search(p, s)\` | Busca la **primera** coincidencia en cualquier parte → \`Match\` o \`None\` |
| \`re.match(p, s)\` | Como \`search\`, pero solo **al principio** |
| \`re.fullmatch(p, s)\` | Debe coincidir **todo** el texto |
| \`re.findall(p, s)\` | **Lista** con todas las coincidencias |
| \`re.finditer(p, s)\` | Iterador de objetos \`Match\` |
| \`re.sub(p, nuevo, s)\` | **Reemplaza** las coincidencias |
| \`re.split(p, s)\` | Divide el texto por el patrón |
| \`re.compile(p)\` | Prepara el patrón para reutilizarlo |

Un objeto \`Match\` ofrece \`.group()\` (lo encontrado), \`.group(1)\` / \`.groups()\` (los grupos), \`.start()\`, \`.end()\` y \`.span()\`. Si no hay coincidencia, la función devuelve \`None\`: **compruébalo** antes de usar el resultado.
`,
      ),
      pyDemo('Buscar', [
        ['import re\nprint(re.findall(r"\\d+", "a1 b22 c333"))', '`\\d+` = uno o más dígitos seguidos'],
        ['import re\nprint(re.search(r"b", "abc").group())\nprint(re.match(r"b", "abc"))\nprint(re.fullmatch(r"[A-Z]{3}\\d{2}", "ABC12") is not None)', '`match` solo mira el principio'],
        ['import re\nm = re.search(r"(\\w+)@(\\w+)\\.com", "escribe a ana@sitio.com ya")\nprint(m.group(), m.groups(), m.span())', 'Los paréntesis crean grupos'],
        ['import re\nm = re.search(r"(?P<anio>\\d{4})-(?P<mes>\\d\\d)", "fecha 2025-03-14")\nprint(m["anio"], m.group("mes"), m.groupdict())', 'Grupos con nombre: `(?P<nombre>...)`'],
      ]),
      pyDemo('Reemplazar y dividir', [
        ['import re\nprint(re.sub(r"\\s+", " ", "a   b \\n c"))', 'Normalizar espacios'],
        ['import re\nprint(re.sub(r"(\\w+)@(\\w+)", r"\\2 en \\1", "ana@sitio"))', '`\\1`, `\\2` reutilizan los grupos'],
        ['import re\nprint(re.split(r"[,;]\\s*", "a, b;c"))'],
        ['import re\nprint([m.group() for m in re.finditer(r"\\b\\w{4}\\b", "una casa muy bonita")])', 'Palabras de exactamente 4 letras'],
      ]),
      learn(
        'Voraz o perezoso, y banderas',
        `
Los cuantificadores \`*\`, \`+\` y \`?\` son **voraces**: toman todo lo que pueden. Añade \`?\` para hacerlos **perezosos** (lo mínimo posible):

- \`<.+>\` sobre \`<a><b>\` captura \`<a><b>\` (todo, de la primera \`<\` a la última \`>\`).
- \`<.+?>\` captura \`<a>\` y \`<b>\` por separado.

Las **banderas** cambian el comportamiento: \`re.IGNORECASE\` (o \`re.I\`) ignora mayúsculas, \`re.MULTILINE\` hace que \`^\`/\`$\` actúen por líneas.

> CLAVE: las regex son potentísimas pero ilegibles si abusas. Para tareas sencillas, \`split\`, \`in\`, \`startswith\`… son más claros. Y para HTML o JSON usa un *parser* de verdad, no regex.
`,
      ),
      pyDemo('Voraz vs perezoso', [
        ['import re\nprint(re.findall(r"<.+>", "<a><b>"))\nprint(re.findall(r"<.+?>", "<a><b>"))'],
        ['import re\nprint(re.findall(r"python", "Python y PYTHON y python", re.IGNORECASE))'],
      ]),
      pyOut('¿Qué imprime?', 'import re\nprint(re.findall(r"<.+?>", "<a><b>"))', ["['<a><b>']", "['a', 'b']", "['<a>']"], 'El `?` hace perezoso el `.+`: se detiene en el primer `>` posible, así que encuentra `<a>` y luego `<b>`.'),
      pyOut('¿Qué imprime?', 'import re\nprint(re.sub(r"(\\w+)@(\\w+)", r"\\2 en \\1", "ana@sitio"))', ['ana en sitio', 'ana@sitio', 'sitio@ana'], '`\\1` es «ana» y `\\2` es «sitio»: en el reemplazo van intercambiados, quedando «sitio en ana».'),
      pyOut('¿Qué imprime?', 'import re\nprint(re.match(r"b", "abc"), re.search(r"b", "abc").group())', ['b b', 'None None', 'None 1'], '`match` solo mira el principio del texto: no empieza por «b», así que da `None`. `search` busca en cualquier sitio y encuentra «b».'),
      mc('¿Qué diferencia hay entre `re.match` y `re.search`?', ['Ninguna', '`match` solo busca al principio del texto; `search` en cualquier posición', '`search` devuelve una lista y `match` un texto', '`match` es para números'], 1, '`match` ancla la búsqueda al inicio. Si quieres que coincida **todo** el texto usa `fullmatch`.'),
      tf('Conviene escribir los patrones como cadenas crudas, `r"\\d+"`, para que la barra invertida llegue intacta a `re`.', true, 'Sin la `r`, Python interpretaría `"\\d"` como un escape de texto. Con `r"..."` el patrón llega tal cual.'),
      fill('Completa el patrón para encontrar uno o más dígitos', 're.findall(r"___", "pedido 345 y 12")', ['\\d+', '\\w+', '\\s+', '.+'], ['\\d+'], '`\\d` = un dígito y `+` = uno o más seguidos. `\\w` también aceptaría letras.'),
      match(
        'Une cada patrón con lo que describe',
        [
          ['\\d{4}', 'cuatro dígitos'],
          ['[A-Z]+', 'una o más mayúsculas'],
          ['\\s*', 'cero o más espacios'],
          ['^a', 'una «a» al principio del texto'],
        ],
        'Aprender a leer patrones lleva práctica: sepáralos en piezas.',
      ),
      pyPractice({
        goal: 'Extrae los números',
        prompt: 'De `texto` extrae todos los números y guárdalos como enteros en la lista `numeros`.',
        starter: 'import re\ntexto = "Pedí 3 cafés y 12 bizcochos, pagué 45 euros"\n',
        check: all(variable('numeros', '[3, 12, 45]'), uses('import:re')),
        solution: 'import re\ntexto = "Pedí 3 cafés y 12 bizcochos, pagué 45 euros"\nnumeros = [int(n) for n in re.findall(r"\\d+", texto)]',
        hints: ['`re.findall(r"\\d+", texto)` devuelve los números como **textos**.', 'Conviértelos a `int` con una comprensión de listas.'],
        explain: '`findall` + conversión de tipos es una combinación muy habitual al extraer datos de texto libre.',
        commands: ['re.findall'],
      }),
      pyPractice({
        goal: 'Valida un código de producto',
        prompt: 'Define `es_codigo(s)` que devuelva `True` si `s` tiene el formato **tres letras mayúsculas, un guion y cuatro dígitos** (por ejemplo `ABC-1234`) y `False` en caso contrario.',
        starter: 'import re\n',
        check: all(func('es_codigo', 1), calls([["es_codigo('ABC-1234')", 'True'], ["es_codigo('abc-1234')", 'False'], ["es_codigo('ABC-123')", 'False'], ["es_codigo('ABC-12345')", 'False'], ["es_codigo('xABC-1234')", 'False']])),
        solution: 'import re\n\ndef es_codigo(s):\n    return re.fullmatch(r"[A-Z]{3}-\\d{4}", s) is not None',
        hints: ['`re.fullmatch` exige que coincida **todo** el texto.', 'Patrón: `[A-Z]{3}-\\d{4}`. Devuelve `... is not None` para obtener un booleano.'],
        explain: 'Validar formatos es el trabajo clásico de las regex. `fullmatch` evita que un texto con basura alrededor se cuele como válido.',
        commands: ['re.match', 're.search'],
      }),
      pyPractice({
        goal: 'Fecha con grupos',
        prompt: 'La variable `linea` contiene una fecha ISO. Con `re.search` y grupos, guarda en `anio`, `mes` y `dia` sus tres partes (como textos).',
        starter: 'import re\nlinea = "Entrega: 2025-03-14"\n',
        check: all(variable('anio', "'2025'"), variable('mes', "'03'"), variable('dia', "'14'"), uses('import:re')),
        solution: 'import re\nlinea = "Entrega: 2025-03-14"\nm = re.search(r"(\\d{4})-(\\d{2})-(\\d{2})", linea)\nanio, mes, dia = m.groups()',
        hints: ['Un grupo `( )` por cada parte: `(\\d{4})-(\\d{2})-(\\d{2})`.', '`m.groups()` devuelve una tupla que puedes desempaquetar.'],
        explain: 'Los grupos convierten una búsqueda en una extracción estructurada. Con `(?P<nombre>…)` también podrías acceder por nombre.',
        commands: ['re.search'],
      }),
      pyPractice({
        goal: 'Limpia los espacios',
        prompt: 'Reemplaza en `sucio` cualquier secuencia de espacios, tabuladores y saltos de línea por **un único espacio** y guarda el resultado en `limpio`. Usa `re.sub`.',
        starter: 'import re\nsucio = "hola    mundo \\t  desde\\npython"\n',
        check: all(variable('limpio', "'hola mundo desde python'"), uses('method:sub')),
        solution: 'import re\nsucio = "hola    mundo \\t  desde\\npython"\nlimpio = re.sub(r"\\s+", " ", sucio)',
        hints: ['`\\s` representa cualquier espacio en blanco; `+` indica «uno o más».', '`re.sub(patrón, reemplazo, texto)`'],
        explain: '`\\s+` → un espacio es una receta que usarás una y otra vez al limpiar datos de usuario.',
        commands: ['re.sub'],
      }),
      pyCode('Divide `texto` por comas o puntos y coma (con espacios opcionales alrededor) y guarda la lista en `partes`.', {
        starter: 'import re\ntexto = "a , b;c ;d"\n',
        check: all(variable('partes', "['a', 'b', 'c', 'd']"), uses('method:split')),
        solution: 'import re\ntexto = "a , b;c ;d"\npartes = re.split(r"\\s*[,;]\\s*", texto)',
        hint: 'Patrón: espacios opcionales, una coma o punto y coma, espacios opcionales.',
        why: '`str.split` solo admite un separador fijo; `re.split` permite varios y con espacios flexibles.',
      }),
    ]),
  ],
  boss: {
    goal: 'Reporte del registro',
    prompt:
      'El archivo `app.log` tiene líneas con el formato `AAAA-MM-DD HH:MM:SS NIVEL mensaje`. Escribe un programa que:\n\n1. Lea el registro y **extraiga con una expresión regular** la fecha, el nivel y el mensaje de cada línea.\n2. Cuente cuántas líneas hay de cada nivel con `Counter`.\n3. Calcule con `datetime` la **duración** entre la primera y la última línea.\n4. Guarde en `reporte.json` un diccionario con las claves `"niveles"` (el conteo), `"duracion"` (texto, p. ej. `"1:02:03"`) y `"errores"` (lista con los mensajes de nivel `ERROR`).\n5. Muestre `Líneas: N`, `Errores: N` y `Duración: ...`.',
    setup: { files: { 'app.log': APP_LOG } },
    starter: 'import re\nimport json\nfrom collections import Counter\nfrom datetime import datetime\n',
    check: all(
      outHas('Líneas: 6', 'Errores: 2', 'Duración: 1:44:45'),
      truthy("__import__('json').load(open('reporte.json', encoding='utf-8')) == {'niveles': {'INFO': 3, 'WARN': 1, 'ERROR': 2}, 'duracion': '1:44:45', 'errores': ['fallo de conexión: db1', 'tiempo agotado: db2']}"),
      uses('import:re'),
      uses('call:Counter'),
      uses('method:strptime'),
    ),
    solution:
      'import re\nimport json\nfrom collections import Counter\nfrom datetime import datetime\n\npatron = re.compile(r"^(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) ([A-Z]+) (.*)$")\nregistros = []\nwith open("app.log", encoding="utf-8") as f:\n    for linea in f:\n        m = patron.match(linea.strip())\n        if m:\n            registros.append(m.groups())\n\nniveles = Counter(nivel for _, nivel, _ in registros)\nformato = "%Y-%m-%d %H:%M:%S"\nprimera = datetime.strptime(registros[0][0], formato)\nultima = datetime.strptime(registros[-1][0], formato)\nduracion = str(ultima - primera)\nerrores = [msg for _, nivel, msg in registros if nivel == "ERROR"]\n\nwith open("reporte.json", "w", encoding="utf-8") as f:\n    json.dump({"niveles": dict(niveles), "duracion": duracion, "errores": errores}, f, ensure_ascii=False)\n\nprint(f"Líneas: {len(registros)}")\nprint(f"Errores: {niveles[\'ERROR\']}")\nprint(f"Duración: {duracion}")',
    hints: [
      'Compila un patrón con tres grupos: `(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}) ([A-Z]+) (.*)` y usa `.match(linea)` y `.groups()`.',
      'Para la duración: `datetime.strptime(texto, "%Y-%m-%d %H:%M:%S")` en la primera y la última línea, y resta. `str(timedelta)` da `1:44:45`.',
      '`json.dump` no puede guardar un `Counter` directamente en todos los casos: conviértelo con `dict(...)`.',
    ],
    explain: 'Este programa reúne toda la zona: **regex** para estructurar texto, **Counter** para contar, **datetime** para medir el tiempo, y **json** para guardar el resultado. Es la forma típica de un script de análisis de registros de la vida real.',
    commands: ['re.search', 'collections.Counter', 'datetime.strptime', 'json.dump'],
  },
});
