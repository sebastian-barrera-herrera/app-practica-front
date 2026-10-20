import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, calls, forbids, func, stdout, uses, variable } from '../pycheck';

export const py6 = pyWorld({
  id: 'py6',
  index: 6,
  title: 'Comprensiones y estilo pythónico',
  subtitle: 'Escribir Python como se escribe en Python',
  emoji: '✨',
  color: '#F472B6',
  level: 'intermedio',
  intro:
    'Ya sabes lo suficiente para escribir programas que funcionan. Ahora toca escribirlos **bien**: con las comprensiones, la iteración elegante y la sintaxis moderna que hacen el código de Python corto, expresivo y fácil de leer. Es lo que la comunidad llama escribir de forma **pythónica**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py6-1', { title: 'List comprehensions', summary: 'Construir listas en una sola línea', emoji: '🧪', commands: ['comprensiones'], minutes: 10 }, [
      learn(
        'Del bucle a la comprensión',
        `
Mira este patrón que ya conoces: crear una lista vacía, recorrer algo y añadir elementos.

\`\`\`
cuadrados = []
for n in range(1, 6):
    cuadrados.append(n * n)
\`\`\`

Python lo resume en una **comprensión de listas**:

\`\`\`
cuadrados = [n * n for n in range(1, 6)]
\`\`\`

Su estructura:

\`\`\`
[ expresión   for variable in iterable   if condición ]
   qué guardar     de dónde sale          filtro opcional
\`\`\`

Se lee casi como en español: «n al cuadrado, para cada n en el rango 1-5». Es más corta, más clara y normalmente más rápida que el bucle con \`append\`.
`,
        '🧪',
      ),
      illus('py-comprehension', 'Anatomía de una comprensión', 'Cada pieza de la comprensión corresponde a una parte del bucle equivalente.'),
      pyDemo('Transformar, filtrar y decidir', [
        pyRepl('[n * n for n in range(1, 6)]', 'Transformar cada elemento'),
        pyRepl('[n for n in range(10) if n % 2 == 0]', 'Filtrar con `if` al final'),
        pyRepl('[p.upper() for p in ["ana", "luis"]]'),
        pyRepl('["par" if n % 2 == 0 else "impar" for n in range(4)]', 'Una expresión condicional delante: elige el valor (siempre con `else`)'),
        pyRepl('[c for c in "Python" if c in "aeiou"]'),
      ]),
      learn(
        'Anidadas, y cuándo no usarlas',
        `
Una comprensión puede tener **varios \`for\`**, que se leen en el mismo orden que los bucles anidados:

\`\`\`
[(x, y) for x in range(3) for y in range(2)]      # todas las parejas
[celda for fila in matriz for celda in fila]      # aplanar una matriz
\`\`\`

Reglas de oro para no abusar:

- Si no cabe cómodamente en **una o dos líneas**, usa un bucle normal.
- Una comprensión sirve para **construir una lista**. No la uses solo por sus efectos (como \`[print(x) for x in lista]\`): para eso, un \`for\`.
- No anides más de **dos niveles**; es ilegible.
`,
      ),
      pyDemo('Dos niveles', [
        pyRepl('[(x, y) for x in range(3) for y in range(2)]'),
        pyRepl('matriz = [[1, 2, 3], [4, 5, 6]]'),
        pyRepl('[celda for fila in matriz for celda in fila]', 'Aplanar'),
        pyRepl('[[fila[i] for fila in matriz] for i in range(3)]', 'Transponer (una comprensión dentro de otra)'),
      ]),
      pyOut('¿Qué imprime?', 'print([n * 2 for n in range(5) if n % 2])', ['[0, 4, 8]', '[1, 3]', '[0, 2, 4, 6, 8]'], 'El filtro `if n % 2` deja los impares (1 y 3) y la expresión los duplica: [2, 6].'),
      mc('¿Cuál de estas líneas construye la lista de las longitudes de las palabras de `p`?', ['[len(x) for x in p]', '[x for len(x) in p]', 'len(x) for x in p', '[for x in p: len(x)]'], 0, 'La forma es `[expresión for variable in iterable]`; la expresión (`len(x)`) va **delante** del `for`.'),
      tf('Una comprensión de listas modifica la lista original sobre la que itera.', false, 'Siempre construye una **lista nueva**; el iterable de origen no cambia.'),
      fill('Completa para quedarte solo con los números positivos', '[n for n in datos ___ n > 0]', ['if', 'when', 'where', 'and'], ['if'], 'El filtro de una comprensión se escribe con `if` después del `for`.'),
      pyPractice({
        goal: 'Cuadrados del 1 al 10',
        prompt: 'Con una comprensión de listas, guarda en `cuadrados` los cuadrados de los números del 1 al 10.',
        starter: '',
        check: all(variable('cuadrados', '[1, 4, 9, 16, 25, 36, 49, 64, 81, 100]'), uses('ListComp')),
        solution: 'cuadrados = [n * n for n in range(1, 11)]',
        hints: ['Recuerda que `range(1, 11)` llega hasta el 10.', '`[n * n for n in range(1, 11)]`'],
        explain: 'La expresión transforma cada elemento; el bucle se resume en una línea sin lista vacía ni `append`.',
        commands: ['comprensiones'],
      }),
      pyPractice({
        goal: 'Palabras largas en mayúsculas',
        prompt: 'De la lista `palabras`, construye `largas` con las palabras de **más de 4 letras**, convertidas a mayúsculas.',
        starter: 'palabras = ["sol", "luna", "estrella", "cielo", "mar", "galaxia"]\n',
        check: all(variable('largas', "['ESTRELLA', 'CIELO', 'GALAXIA']"), uses('ListComp')),
        solution: 'palabras = ["sol", "luna", "estrella", "cielo", "mar", "galaxia"]\nlargas = [p.upper() for p in palabras if len(p) > 4]',
        hints: ['Combina transformación (`upper`) y filtro (`len(p) > 4`).', '`[p.upper() for p in palabras if len(p) > 4]`'],
        explain: 'El filtro se aplica a los elementos originales y la expresión de delante a los que pasan el filtro.',
        commands: ['comprensiones', 'str.upper'],
      }),
      pyPractice({
        goal: 'Aplana la matriz',
        prompt: 'Con una comprensión de **dos `for`**, convierte `matriz` en una lista plana `plana` (fila por fila).',
        starter: 'matriz = [[1, 2], [3, 4], [5, 6]]\n',
        check: all(variable('plana', '[1, 2, 3, 4, 5, 6]'), uses('ListComp')),
        solution: 'matriz = [[1, 2], [3, 4], [5, 6]]\nplana = [x for fila in matriz for x in fila]',
        hints: ['Primero el `for` externo (las filas) y después el interno (los elementos).', '`[x for fila in matriz for x in fila]`'],
        explain: 'Los `for` se escriben en el mismo orden que si fueran bucles anidados, de fuera hacia dentro.',
        commands: ['comprensiones'],
      }),
      pyCode('Guarda en `iniciales` una lista con la primera letra de cada nombre de `nombres`.', {
        starter: 'nombres = ["Ada", "Linus", "Grace"]\n',
        check: all(variable('iniciales', "['A', 'L', 'G']"), uses('ListComp')),
        solution: 'nombres = ["Ada", "Linus", "Grace"]\niniciales = [n[0] for n in nombres]',
        hint: 'La expresión puede indexar cada elemento.',
        why: '`n[0]` toma el primer carácter de cada nombre. Una comprensión es ideal para «aplicar algo a cada elemento».',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py6-2', { title: 'Dict/set comprehensions y generadoras', summary: 'Diccionarios, conjuntos y expresiones perezosas', emoji: '🧬', commands: ['comprensiones', 'any', 'all'], minutes: 11 }, [
      learn(
        'Diccionarios y conjuntos por comprensión',
        `
La misma idea funciona con llaves:

- **Diccionario**: \`{clave: valor for ... in ...}\`
- **Conjunto**: \`{expresión for ... in ...}\` (una sola expresión, sin \`:\`)

\`\`\`
{n: n ** 2 for n in range(4)}          # {0: 0, 1: 1, 2: 4, 3: 9}
{len(p) for p in ["sol", "luna", "mar"]}   # {3, 4}
\`\`\`

Cuidado con las llaves vacías: \`{}\` es un diccionario, y \`{x for x in ...}\` es un conjunto.
`,
        '🧬',
      ),
      pyDemo('Diccionarios y conjuntos', [
        pyRepl('{n: n ** 2 for n in range(5)}'),
        pyRepl('palabras = ["sol", "luna", "mar", "estrella"]'),
        pyRepl('{p: len(p) for p in palabras}', 'Cada palabra con su longitud'),
        pyRepl('sorted({len(p) for p in palabras})', 'Longitudes distintas (un conjunto, sin repetidos)'),
        pyRepl('d = {"a": 1, "b": 2}'),
        pyRepl('{v: k for k, v in d.items()}', 'Invertir un diccionario'),
        pyRepl('{k: v for k, v in d.items() if v > 1}', 'Filtrar un diccionario'),
      ]),
      learn(
        'Expresiones generadoras',
        `
Si cambias los corchetes de una comprensión de listas por **paréntesis**, no se crea ninguna lista: obtienes un **generador**, que va produciendo los valores **uno a uno, según se piden** («perezoso»).

\`\`\`
(n * n for n in range(1_000_000))      # casi no ocupa memoria
\`\`\`

Brillan cuando se las pasas a una función que consume valores: \`sum\`, \`min\`, \`max\`, \`any\`, \`all\`. Entonces ni siquiera necesitas los paréntesis extra:

\`\`\`
sum(n * n for n in range(1, 101))
any(n > 3 for n in numeros)
\`\`\`

Un generador **se agota**: solo se puede recorrer una vez.
`,
      ),
      pyDemo('Generadores', [
        pyRepl('sum(n * n for n in range(1, 101))'),
        pyRepl('numeros = [1, 5, 8, 3]'),
        pyRepl('any(n > 6 for n in numeros)', '¿Alguno cumple? Se detiene en cuanto encuentra uno'),
        pyRepl('all(n > 0 for n in numeros)', '¿Cumplen todos?'),
        pyRepl('max(len(p) for p in ["sol", "estrella"])'),
        ['g = (n * 2 for n in range(3))\nprint(next(g), next(g))\nprint(list(g))\nprint(list(g))', 'Se consume: cuando se acaba, queda vacío'],
      ]),
      pyOut('¿Qué imprime?', 'g = (x for x in range(3))\nprint(list(g), list(g))', ['[0, 1, 2] [0, 1, 2]', '[0, 1, 2] None', '[] []'], 'La primera `list(g)` consume el generador entero. Al segundo intento ya no queda nada: `[]`.'),
      mc('¿Qué ventaja tiene `sum(n for n in datos)` frente a `sum([n for n in datos])`?', ['Es más preciso', 'No construye la lista completa en memoria', 'Acepta más tipos', 'Ninguna: es idéntico'], 1, 'El generador produce los valores uno a uno, sin guardar una lista intermedia. Con datos enormes la diferencia en memoria es grande.'),
      tf('`{x for x in range(3)}` crea un diccionario.', false, 'Sin `clave: valor` es un **conjunto**. Para un diccionario la expresión necesita los dos puntos: `{x: x for x in range(3)}`.'),
      match(
        'Une cada expresión con el tipo que produce',
        [
          ['[x for x in "ab"]', 'list'],
          ['{x for x in "ab"}', 'set'],
          ['{x: 1 for x in "ab"}', 'dict'],
          ['(x for x in "ab")', 'generator'],
        ],
        'Los corchetes dan lista; las llaves, conjunto o diccionario (según lleven `:`); los paréntesis, un generador.',
      ),
      pyPractice({
        goal: 'Longitud de cada palabra',
        prompt: 'Construye con una comprensión el diccionario `longitudes` que asocie cada palabra de `palabras` con su longitud.',
        starter: 'palabras = ["sol", "luna", "estrella"]\n',
        check: all(variable('longitudes', "{'sol': 3, 'luna': 4, 'estrella': 8}"), uses('DictComp')),
        solution: 'palabras = ["sol", "luna", "estrella"]\nlongitudes = {p: len(p) for p in palabras}',
        hints: ['Usa llaves y la forma `clave: valor for ...`.', '`{p: len(p) for p in palabras}`'],
        explain: 'La clave y el valor se calculan para cada elemento. Es el equivalente en una línea de crear un `dict` vacío y asignar en un bucle.',
        commands: ['comprensiones'],
      }),
      pyPractice({
        goal: 'Invierte el diccionario',
        prompt: 'Dado `colores` (nombre → código), construye `por_codigo` con los pares invertidos (código → nombre).',
        starter: 'colores = {"rojo": "#f00", "verde": "#0f0", "azul": "#00f"}\n',
        check: all(variable('por_codigo', "{'#f00': 'rojo', '#0f0': 'verde', '#00f': 'azul'}"), uses('DictComp')),
        solution: 'colores = {"rojo": "#f00", "verde": "#0f0", "azul": "#00f"}\npor_codigo = {codigo: nombre for nombre, codigo in colores.items()}',
        hints: ['Recorre `colores.items()` desempaquetando clave y valor.', '`{codigo: nombre for nombre, codigo in colores.items()}`'],
        explain: 'Invertir un diccionario solo funciona bien si los valores son únicos e inmutables (si no, se perderían o darían error).',
        commands: ['comprensiones', 'dict.items'],
      }),
      pyPractice({
        goal: 'Contar sin crear lista',
        prompt: 'Guarda en `cuantos` cuántos números de `datos` son mayores que 10, usando `sum` con una **expresión generadora** (sin crear una lista).',
        starter: 'datos = [4, 15, 8, 22, 11, 3]\n',
        check: all(variable('cuantos', '3'), uses('GeneratorExp'), forbids('ListComp')),
        solution: 'datos = [4, 15, 8, 22, 11, 3]\ncuantos = sum(1 for n in datos if n > 10)',
        hints: ['Cada número que cumple aporta un `1` a la suma.', '`sum(1 for n in datos if n > 10)`'],
        explain: 'Contar con `sum(1 for ...)` es un idioma muy habitual en Python: no guarda ninguna lista intermedia.',
        commands: ['comprensiones', 'sum'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py6-3', { title: 'Iteración elegante', summary: 'zip, enumerate, reversed, sorted, any y all', emoji: '🎯', commands: ['enumerate', 'zip', 'reversed', 'any', 'all', 'sorted'], minutes: 10 }, [
      learn(
        'Recorre cosas, no números de posición',
        `
Un signo de código poco pythónico es \`for i in range(len(lista)):\` seguido de \`lista[i]\`. Casi siempre hay una herramienta mejor:

| Quieres… | Usa |
|---|---|
| Los elementos | \`for x in lista\` |
| Elemento **y** posición | \`for i, x in enumerate(lista)\` |
| **Dos** listas a la vez | \`for a, b in zip(l1, l2)\` |
| Al revés | \`for x in reversed(lista)\` |
| En orden (sin tocar la original) | \`for x in sorted(lista)\` |

Cada una expresa **la intención** directamente, sin índices que puedan salirse de rango.
`,
        '🎯',
      ),
      pyDemo('Las herramientas', [
        ['colores = ["rojo", "verde", "azul"]\nfor i, c in enumerate(colores, start=1):\n    print(i, c)'],
        ['nombres = ["Ada", "Linus"]\nedades = [36, 30]\nfor n, e in zip(nombres, edades):\n    print(n, e)'],
        ['for c in reversed(["a", "b", "c"]):\n    print(c, end=" ")\nprint()\nprint(sorted("python"))'],
        pyRepl('list(zip(*[[1, 2, 3], [4, 5, 6]]))', 'Con `*` se «transpone»: junta primeros con primeros, segundos con segundos…'),
      ]),
      learn(
        'any y all',
        `
Dos funciones que responden preguntas sobre una colección **completa**:

- **\`any(iterable)\`**: ¿hay **al menos uno** verdadero?
- **\`all(iterable)\`**: ¿son **todos** verdaderos?

Se combinan con expresiones generadoras: \`any(c.isdigit() for c in clave)\`, \`all(n > 0 for n in datos)\`. Se detienen en cuanto conocen la respuesta (cortocircuito).

Casos límite que conviene recordar: \`any([])\` es \`False\` («no hay ninguno») y \`all([])\` es \`True\` («no hay ningún contraejemplo»).
`,
      ),
      pyDemo('Preguntas sobre colecciones', [
        pyRepl('any(c.isdigit() for c in "abc1")', '¿Tiene algún dígito?'),
        pyRepl('all(c.isalpha() for c in "abc1")', '¿Son todo letras?'),
        pyRepl('any([])'),
        pyRepl('all([])'),
      ]),
      learn(
        'Ordenar con varios criterios',
        `
La función \`key\` puede devolver una **tupla**: Python ordena por el primer elemento y, en caso de empate, por el segundo, y así sucesivamente. Para invertir el sentido de un criterio **numérico**, ponle un signo menos:

\`\`\`
alumnos = [("Ana", 82), ("Luis", 95), ("Eva", 82)]
sorted(alumnos, key=lambda a: (-a[1], a[0]))
# mejor nota primero; si empatan, por nombre
\`\`\`
`,
      ),
      pyDemo('Ranking', [['alumnos = [("Ana", 82), ("Luis", 95), ("Eva", 82)]\nranking = sorted(alumnos, key=lambda a: (-a[1], a[0]))\nfor puesto, (nombre, nota) in enumerate(ranking, start=1):\n    print(f"{puesto}. {nombre} ({nota})")', 'Observa cómo se desempaqueta `(nombre, nota)` dentro del `for`']]),
      pyOut('¿Qué imprime?', 'for i, (a, b) in enumerate(zip("xy", [10, 20])):\n    print(i, a, b)', ['0 x 20\n1 y 10', '1 x 10\n2 y 20', 'x 10\ny 20'], '`zip` forma las parejas (x, 10) y (y, 20); `enumerate` añade la posición empezando en 0.'),
      mc('¿Cuál es la forma más pythónica de recorrer una lista con su posición?', ['for i in range(len(lista)): ...', 'for i, x in enumerate(lista): ...', 'i = 0; while i < len(lista): ...', 'for x in lista: i = lista.index(x)'], 1, '`enumerate` da la posición y el valor directamente. Además `lista.index(x)` fallaría con elementos repetidos.'),
      tf('`all([])` devuelve `False` porque la lista está vacía.', false, '`all([])` es `True`: no existe ningún elemento que incumpla la condición. Y `any([])` es `False`.'),
      fill('Completa para saber si hay algún número negativo en `datos`', 'hay_negativos = ___(n < 0 for n in datos)', ['any', 'all', 'sum', 'max'], ['any'], '`any` es verdadero si **al menos uno** cumple la condición.'),
      pyPractice({
        goal: 'Posiciones de los grandes',
        prompt: 'Guarda en `posiciones` los índices de los elementos de `datos` que sean **mayores que 5**. Usa `enumerate` en una comprensión.',
        starter: 'datos = [3, 8, 1, 9, 5, 7]\n',
        check: all(variable('posiciones', '[1, 3, 5]'), uses('call:enumerate')),
        solution: 'datos = [3, 8, 1, 9, 5, 7]\nposiciones = [i for i, n in enumerate(datos) if n > 5]',
        hints: ['`enumerate(datos)` da (posición, valor).', '`[i for i, n in enumerate(datos) if n > 5]`'],
        explain: 'Es mucho más limpio que `range(len(datos))` y `datos[i]`.',
        commands: ['enumerate'],
      }),
      pyPractice({
        goal: '¿Son todos positivos?',
        prompt: 'Guarda en `todos_positivos` si **todos** los números de `datos` son mayores que 0. Usa `all` con una expresión generadora.',
        starter: 'datos = [4, 9, 2, 7]\n',
        check: all(variable('todos_positivos', 'True'), uses('call:all'), uses('GeneratorExp')),
        solution: 'datos = [4, 9, 2, 7]\ntodos_positivos = all(n > 0 for n in datos)',
        hints: ['`all` recibe algo que produzca bools.', '`all(n > 0 for n in datos)`'],
        explain: 'Se detiene en cuanto encuentra un número no positivo. Si la lista fuera enorme, ahorraría muchísimo trabajo.',
        commands: ['all'],
      }),
      pyPractice({
        goal: 'Ranking con desempate',
        prompt: 'Dado el diccionario `puntos`, guarda en `ranking` la lista de **nombres** ordenados por puntos de mayor a menor y, si empatan, alfabéticamente.',
        starter: 'puntos = {"Ana": 82, "Luis": 95, "Eva": 82, "Bea": 70}\n',
        check: all(variable('ranking', "['Luis', 'Ana', 'Eva', 'Bea']"), uses('call:sorted')),
        solution: 'puntos = {"Ana": 82, "Luis": 95, "Eva": 82, "Bea": 70}\nranking = sorted(puntos, key=lambda nombre: (-puntos[nombre], nombre))',
        hints: ['Recorrer un diccionario da sus claves; la `key` puede consultar `puntos[nombre]`.', 'La `key` devuelve una tupla: `(-puntos[nombre], nombre)`.'],
        explain: 'Una `key` con tupla permite varios criterios; el signo menos invierte el criterio numérico.',
        commands: ['sorted'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py6-4', { title: 'Desempaquetado y sintaxis moderna', summary: '* y **, operador morsa, f-strings avanzadas y match con patrones', emoji: '🪄', commands: ['desempaquetado', 'walrus', 'f-strings', 'match'], minutes: 13 }, [
      learn(
        '* y ** para unir y repartir',
        `
Los asteriscos «abren» una colección en sus elementos, también al **construir** otras:

\`\`\`
a = [1, 2]
b = [3, 4]
todo = [*a, 0, *b]            # [1, 2, 0, 3, 4]

base = {"color": "rojo", "talla": "M"}
extra = {"talla": "L", "precio": 20}
resultado = {**base, **extra}  # los últimos mandan en caso de repetidos
\`\`\`

Y en las llamadas: \`print(*lista)\` imprime los elementos sueltos. Desde Python 3.9 también existe el operador \`|\` para unir diccionarios: \`base | extra\`.
`,
        '🪄',
      ),
      pyDemo('Abrir colecciones', [
        ['a = [1, 2]\nb = [3, 4]\nprint([*a, 0, *b])\nprint(*a, *b)'],
        ['base = {"color": "rojo", "talla": "M"}\nextra = {"talla": "L", "precio": 20}\nprint({**base, **extra})\nprint(base | extra)', 'La clave repetida toma el último valor'],
        ['print(*"hola", sep="-")', 'Cualquier iterable se puede abrir'],
      ]),
      learn(
        'El operador morsa :=',
        `
\`:=\` (llamado «morsa» por su forma de ojos y colmillos) **asigna y devuelve el valor a la vez**, dentro de una expresión. Evita calcular algo dos veces o repetir la lectura en un bucle:

\`\`\`
if (n := len(texto)) > 10:
    print(f"Demasiado largo: {n} caracteres")

while (linea := input("> ")) != "fin":
    print("Leíste", linea)
\`\`\`

Úsalo con mesura: en casos sencillos una asignación normal en su propia línea es más clara.
`,
      ),
      pyDemo(
        'Morsa en acción',
        [
          ['texto = "Python es genial"\nif (n := len(texto)) > 10:\n    print(f"Demasiado largo: {n} caracteres")'],
          ['while (linea := input("> ")) != "fin":\n    print("Leíste", linea)', 'Con las entradas «hola», «mundo» y «fin»'],
        ],
        { stdin: ['hola', 'mundo', 'fin'] },
      ),
      learn(
        'f-strings avanzadas',
        `
Las f-strings tienen más trucos:

| Forma | Efecto |
|---|---|
| \`f"{x=}"\` | Muestra el nombre y el valor: \`x=5\` (ideal para depurar) |
| \`f"{x!r}"\` | Usa \`repr()\`: comillas incluidas en los textos |
| \`f"{x:>10.2f}"\` | Ancho 10, alineado a la derecha, 2 decimales |
| \`f"{x:{ancho}}"\` | El ancho viene de otra variable |
| \`f"{n:,}"\` / \`f"{n:08.3f}"\` | Miles / relleno con ceros |
| \`f"{{texto}}"\` | Llaves literales |

Dentro de las llaves cabe cualquier expresión: llamadas, métodos, cuentas, condicionales…
`,
      ),
      pyDemo('Trucos de f-strings', [
        ['x = 5\nnombre = "Ada"\nprint(f"{x=}  {nombre=}")'],
        ['print(f"{nombre} / {nombre!r}")'],
        ['pi = 3.14159265\nancho = 12\nprint(f"[{pi:>{ancho}.3f}]")\nprint(f"[{pi:<{ancho}.1f}]")\nprint(f"[{pi:^{ancho}.2f}]")'],
        ['print(f"{1234567.891:,.2f}  {0.256:.1%}  {{llaves}}")'],
      ]),
      learn(
        'match con patrones',
        `
\`match\` es mucho más que un \`switch\`: compara la **forma** del dato y puede **capturar** partes de él.

\`\`\`
match comando.split():
    case ["salir"]:
        print("Adiós")
    case ["ir", direccion]:
        print("Voy hacia", direccion)
    case ["coger", *objetos]:
        print("Cojo:", objetos)
    case _:
        print("No entiendo")
\`\`\`

- **Listas/tuplas**: \`[x, y]\`, con \`*resto\` para el sobrante.
- **Diccionarios**: \`{"tipo": "circulo", "radio": r}\` (solo exige que esas claves existan).
- **Tipos**: \`int()\`, \`str()\`... y **alternativas** con \`|\`.
- **Guardas**: \`case [x, y] if x == y:\`.
- Un nombre suelto en un patrón **captura** el valor (\`case [x, y]\` crea \`x\` y \`y\`).
`,
      ),
      pyDemo('Patrones de verdad', [
        ['def interpretar(comando):\n    match comando.split():\n        case ["salir"]:\n            return "Adiós"\n        case ["ir", direccion]:\n            return f"Voy hacia {direccion}"\n        case ["coger", *objetos]:\n            return f"Cojo: {objetos}"\n        case _:\n            return "No entiendo"\n\nfor c in ["salir", "ir norte", "coger llave espada", "bailar"]:\n    print(interpretar(c))'],
        ['def area(figura):\n    match figura:\n        case {"tipo": "circulo", "radio": r}:\n            return round(3.14159 * r * r, 2)\n        case {"tipo": "rectangulo", "base": b, "altura": h}:\n            return b * h\n        case _:\n            return None\n\nprint(area({"tipo": "circulo", "radio": 2}))\nprint(area({"tipo": "rectangulo", "base": 3, "altura": 4}))\nprint(area({"tipo": "triangulo"}))'],
      ]),
      pyOut('¿Qué imprime?', 'def f(x):\n    match x:\n        case [a, b] if a == b:\n            return "iguales"\n        case [a, b]:\n            return "pareja"\n        case int() | float():\n            return "número"\n        case _:\n            return "otro"\n\nprint(f([3, 3]), f([1, 2]), f(2.5), f("hola"))', ['iguales pareja otro otro', 'pareja pareja número otro', 'iguales iguales número otro'], '`[3, 3]` encaja con la primera (guarda cumplida); `[1, 2]` con la segunda; `2.5` es `float`; el texto no encaja con nada anterior.'),
      mc('¿Qué hace `{**a, **b}` si ambas tienen la misma clave?', ['Da un error', 'Gana el valor de `b` (el último)', 'Gana el valor de `a`', 'Guarda los dos en una lista'], 1, 'Los diccionarios se despliegan en orden y las claves repetidas toman el último valor.'),
      tf('El operador `:=` solo se puede usar en bucles `while`.', false, 'Se puede usar en cualquier expresión: `if`, comprensiones, argumentos… aunque conviene usarlo con mesura.'),
      fill('Completa para mostrar nombre y valor de la variable (útil para depurar)', 'total = 42\nprint(f"{total___}")', ['=', '!r', ':', '#'], ['='], 'El `=` dentro de la llave imprime `total=42`: el texto de la expresión, un igual y su valor.'),
      pyPractice({
        goal: 'Fusionar configuraciones',
        prompt: 'Combina `base` y `usuario` en un nuevo diccionario `config` de modo que las claves de `usuario` **sobrescriban** las de `base`. Usa `**` (o `|`).',
        starter: 'base = {"tema": "claro", "fuente": 12, "idioma": "es"}\nusuario = {"tema": "oscuro", "fuente": 14}\n',
        check: all(variable('config', "{'tema': 'oscuro', 'fuente': 14, 'idioma': 'es'}")),
        solution: 'base = {"tema": "claro", "fuente": 12, "idioma": "es"}\nusuario = {"tema": "oscuro", "fuente": 14}\nconfig = {**base, **usuario}',
        hints: ['El orden importa: el último gana.', '`{**base, **usuario}`'],
        explain: 'Es el patrón estándar para «valores por defecto + personalización». Ninguno de los diccionarios originales cambia.',
        commands: ['desempaquetado'],
      }),
      pyPractice({
        goal: 'Describir con match',
        prompt: 'Define `describir(dato)` con `match` que devuelva: `"vacío"` para una lista vacía, `"uno: X"` para una lista de un elemento X, `"dos"` para una de dos elementos, `"número"` para un `int` o `float`, y `"otro"` para el resto.',
        starter: '',
        check: all(
          func('describir', 1),
          uses('Match'),
          calls([
            ['describir([])', "'vacío'"],
            ['describir([7])', "'uno: 7'"],
            ['describir([1, 2])', "'dos'"],
            ['describir(3.5)', "'número'"],
            ['describir(10)', "'número'"],
            ['describir("hola")', "'otro'"],
            ['describir([1, 2, 3])', "'otro'"],
          ]),
        ),
        solution: 'def describir(dato):\n    match dato:\n        case []:\n            return "vacío"\n        case [x]:\n            return f"uno: {x}"\n        case [_, _]:\n            return "dos"\n        case int() | float():\n            return "número"\n        case _:\n            return "otro"',
        hints: ['`case []` encaja con la lista vacía; `case [x]` con una de un elemento.', '`case int() | float():` encaja con cualquier número.'],
        explain: 'Los patrones de secuencia no encajan con textos (aunque un texto sea una secuencia): por eso `"hola"` llega al comodín.',
        commands: ['match'],
      }),
      pyPractice({
        goal: 'Leer hasta la línea vacía',
        prompt: 'Lee líneas con `input()` hasta que llegue una **línea vacía** y cuenta cuántas líneas (no vacías) se leyeron en `cuantas`. Usa el operador morsa `:=` en el `while`.',
        setup: { stdin: ['uno', 'dos', 'tres', ''] },
        starter: 'cuantas = 0\n',
        check: all(variable('cuantas', '3'), uses('NamedExpr')),
        solution: 'cuantas = 0\nwhile (linea := input()) != "":\n    cuantas += 1',
        hints: ['La condición del `while` puede asignar y comparar a la vez.', '`while (linea := input()) != "":`'],
        explain: 'Sin la morsa tendrías que escribir `input()` dos veces (antes del bucle y al final de cada vuelta).',
        commands: ['walrus'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py6-5', { title: 'Estilo pythónico', summary: 'PEP 8, buenos nombres, EAFP y el bloque main', emoji: '🧘', commands: ['pep8', 'eafp', '__main__'], minutes: 12 }, [
      learn(
        'PEP 8: un estilo común',
        `
**PEP 8** es la guía de estilo oficial de Python. No es obligatoria, pero casi todo el código serio la sigue, porque **el código se lee mucho más de lo que se escribe**. Lo esencial:

- **4 espacios** por nivel de indentación (nunca tabuladores mezclados).
- Líneas de **hasta ~79–99 caracteres**.
- \`snake_case\` para variables y funciones; \`PascalCase\` para clases; \`MAYUSCULAS\` para constantes.
- Espacios alrededor de los operadores (\`a + b\`) y después de las comas; **no** dentro de paréntesis ni antes de los dos puntos.
- Dos líneas en blanco entre funciones de nivel superior.
- Imports al principio del archivo, uno por línea.

Existen herramientas que lo comprueban o aplican por ti (\`ruff\`, \`black\`, \`flake8\`); no hace falta memorizarlo todo.
`,
        '🧘',
      ),
      learn(
        'Buenos nombres, constantes y comentarios',
        `
- Un nombre debe decir **qué es**, no cómo se calculó: \`precio_con_iva\` mejor que \`pc\` o \`x2\`.
- Evita los «**números mágicos**»: \`return precio * 1.21\` ¿qué es 1.21? Mejor \`IVA = 1.21\` arriba del archivo y \`return precio * IVA\`.
- Los **comentarios** explican el *por qué*; si necesitas explicar el *qué*, mejora los nombres.
- Prefiere funciones **cortas** que hagan **una cosa**.
- \`i\`, \`j\`, \`n\`, \`x\` están bien en bucles cortos y fórmulas; en el resto, nombres completos.
`,
      ),
      pyDemo('Más claro, mismo resultado', [
        ['# Difícil de leer\ndef f(a,b):\n  c=a*1.21\n  return c-b\n\nprint(f(100,5))'],
        ['IVA = 1.21\n\ndef precio_final(precio, descuento):\n    """Precio con IVA menos el descuento."""\n    return precio * IVA - descuento\n\nprint(precio_final(100, 5))', 'Mismo cálculo, pero ahora se entiende'],
      ]),
      learn(
        'Idiomas pythónicos',
        `
Pequeños hábitos que reconocen al programador de Python:

| En vez de… | Escribe… |
|---|---|
| \`if x == True:\` | \`if x:\` |
| \`if len(lista) == 0:\` | \`if not lista:\` |
| \`for i in range(len(l)): l[i]\` | \`for x in l:\` / \`enumerate(l)\` |
| \`resultado = ""; for ...: resultado += s\` | \`"".join(...)\` |
| \`if x == None:\` | \`if x is None:\` |
| \`a = b; b = a + b\` (con auxiliar) | \`a, b = b, a + b\` |
| bucle con \`append\` | comprensión |
| cerrar archivos a mano | \`with open(...)\` |
`,
      ),
      pyDemo('Antes y después', [
        ['lista = []\nif len(lista) == 0:\n    print("vacía (estilo largo)")\nif not lista:\n    print("vacía (estilo pythónico)")'],
        ['palabras = ["uno", "dos", "tres"]\nfrase = ""\nfor p in palabras:\n    frase += p + " "\nprint(frase.strip())\nprint(" ".join(palabras))', '`join` es más claro y mucho más eficiente'],
      ]),
      learn(
        'EAFP frente a LBYL',
        `
Dos filosofías para tratar situaciones que podrían fallar:

- **LBYL** (*Look Before You Leap*, «mira antes de saltar»): comprobar antes. \`if clave in diccionario: valor = diccionario[clave]\`.
- **EAFP** (*Easier to Ask Forgiveness than Permission*, «es más fácil pedir perdón que permiso»): intentar y manejar el error si ocurre, con \`try/except\` (lo estudiarás a fondo en la siguiente zona).

Python favorece **EAFP** cuando el fallo es poco frecuente o cuando comprobar es complicado. Y muchas veces existe una función que ya resuelve el caso: \`dict.get\`, \`str.isdigit()\`…
`,
      ),
      pyDemo('Dos estilos', [
        ['datos = {"nombre": "Ada"}\n\n# LBYL\nif "edad" in datos:\n    print(datos["edad"])\nelse:\n    print("sin edad")\n\n# EAFP\ntry:\n    print(datos["edad"])\nexcept KeyError:\n    print("sin edad")'],
      ]),
      learn(
        'if __name__ == "__main__"',
        `
Cada archivo \`.py\` es un **módulo**. Python crea en él una variable \`__name__\`:

- Si ejecutas el archivo directamente, vale \`"__main__"\`.
- Si otro archivo lo *importa*, vale el nombre del módulo.

Por eso se escribe al final:

\`\`\`
def main():
    print("Programa principal")

if __name__ == "__main__":
    main()
\`\`\`

Así el archivo se puede **ejecutar** como programa y también **importar** desde otro sin que arranque solo. Es la estructura recomendada para cualquier script.
`,
      ),
      pyDemo('El nombre del módulo', [
        ['print(__name__)', 'Ejecutado directamente'],
        ['def main():\n    print("Programa principal")\n\nif __name__ == "__main__":\n    main()'],
        ['import this', 'El Zen de Python: la filosofía del lenguaje'],
      ]),
      mc(
        '¿Cuál es la forma más pythónica de comprobar que una lista no está vacía?',
        ['if len(lista) > 0:', 'if lista != []:', 'if lista:', 'if lista == True:'],
        2,
        'Las colecciones vacías son «falsas» y las que tienen elementos «verdaderas», así que `if lista:` basta.',
      ),
      match(
        'Une cada código poco pythónico con su mejora',
        [
          ['if x == None:', 'if x is None:'],
          ['for i in range(len(l)): print(l[i])', 'for x in l: print(x)'],
          ['if flag == True:', 'if flag:'],
          ['r = ""; for p in ps: r += p', 'r = "".join(ps)'],
        ],
        'Cada mejora expresa la misma idea de forma más directa, más legible y a menudo más eficiente.',
      ),
      tf('Un programa que acaba en `if __name__ == "__main__": main()` se ejecuta si lo importas desde otro archivo.', false, 'Al importarlo, `__name__` vale el nombre del módulo, no `"__main__"`, así que `main()` no se ejecuta.'),
      pyPractice({
        goal: 'Refactoriza este bucle',
        prompt: 'Este código funciona, pero es muy poco pythónico. Reescríbelo para que `resultado` se calcule en **una sola línea con una comprensión** y sin `while`.',
        starter: 'nombres = ["ana", "luis", "eva"]\nresultado = []\ni = 0\nwhile i < len(nombres):\n    resultado.append(nombres[i].capitalize())\n    i = i + 1\n',
        check: all(variable('resultado', "['Ana', 'Luis', 'Eva']"), uses('ListComp'), forbids('While')),
        solution: 'nombres = ["ana", "luis", "eva"]\nresultado = [n.capitalize() for n in nombres]',
        hints: ['Recorre los nombres directamente, sin índices.', '`[n.capitalize() for n in nombres]`'],
        explain: 'Seis líneas con contador y `append` se convierten en una sola que dice qué se quiere obtener, no cómo.',
        commands: ['comprensiones', 'pep8'],
      }),
      pyPractice({
        goal: 'Estructura con main',
        prompt: 'Escribe un programa con una función `main()` que muestre **Hola desde main** y llámala solo cuando el archivo se ejecute directamente (`if __name__ == "__main__":`).',
        starter: '',
        check: all(stdout('Hola desde main'), func('main', 0), uses('If')),
        solution: 'def main():\n    print("Hola desde main")\n\nif __name__ == "__main__":\n    main()',
        hints: ['Define la función y después la guarda.', 'La guarda: `if __name__ == "__main__":` y dentro `main()`.'],
        explain: 'Esta estructura permite importar tus funciones desde otro archivo (por ejemplo para probarlas) sin que el programa arranque solo.',
        commands: ['__main__'],
      }),
      pyPractice({
        goal: 'Quita el número mágico',
        prompt: 'Define una constante `TASA = 0.21` y una función `con_iva(precio)` que devuelva `precio * (1 + TASA)` redondeado a 2 decimales. `con_iva(100)` debe dar `121.0`.',
        starter: '',
        check: all(variable('TASA', '0.21'), func('con_iva', 1), calls([['con_iva(100)', '121.0'], ['con_iva(19.99)', '24.19'], ['con_iva(0)', '0.0']])),
        solution: 'TASA = 0.21\n\ndef con_iva(precio):\n    return round(precio * (1 + TASA), 2)',
        hints: ['La constante va fuera de la función, en MAYÚSCULAS.', '`return round(precio * (1 + TASA), 2)`'],
        explain: 'Si el IVA cambia, solo editas un sitio. Los nombres en mayúsculas indican «esto no debería cambiar mientras el programa corre».',
        commands: ['pep8', 'round'],
      }),
    ]),
  ],
  boss: {
    goal: 'Analizador de texto',
    prompt:
      'Dado `texto`, haz un programa que (usando comprensiones) calcule y muestre estas tres líneas exactas:\n\n```\nÚnicas: 10\nLargas: {...}\nMás larga: perezoso\n```\n\n1. `palabras`: el texto en minúsculas dividido en palabras.\n2. **Únicas**: cuántas palabras distintas hay.\n3. **Largas**: un diccionario `palabra: longitud` solo con las palabras de **más de 3 letras** (en el orden en que aparecen).\n4. **Más larga**: la palabra más larga (usa `max` con `key`).',
    starter: 'texto = "El veloz zorro marrón salta sobre el perro perezoso y el perro duerme"\n',
    check: all(
      stdout("Únicas: 10\nLargas: {'veloz': 5, 'zorro': 5, 'marrón': 6, 'salta': 5, 'sobre': 5, 'perro': 5, 'perezoso': 8, 'duerme': 6}\nMás larga: perezoso"),
      uses('DictComp'),
    ),
    solution:
      'texto = "El veloz zorro marrón salta sobre el perro perezoso y el perro duerme"\npalabras = texto.lower().split()\nunicas = {p for p in palabras}\nlargas = {p: len(p) for p in palabras if len(p) > 3}\nprint(f"Únicas: {len(unicas)}")\nprint(f"Largas: {largas}")\nprint(f"Más larga: {max(palabras, key=len)}")',
    hints: ['Un conjunto por comprensión quita repetidos; un diccionario por comprensión asocia palabra y longitud.', '`max(palabras, key=len)` devuelve la palabra más larga.'],
    explain: 'Conjuntos, diccionarios y funciones con `key` en solo siete líneas. Eso es escribir Python con soltura. (Con `collections.Counter`, que verás en la zona 8, algunas de estas tareas serían aún más cortas.)',
    commands: ['comprensiones', 'max'],
  },
});

