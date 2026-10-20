import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, any as either, forbids, outHas, stdout, uses, variable } from '../pycheck';

export const py4 = pyWorld({
  id: 'py4',
  index: 4,
  title: 'Colecciones',
  subtitle: 'Listas, tuplas, diccionarios y conjuntos',
  emoji: '📦',
  color: '#FB923C',
  level: 'basico',
  intro:
    'Un programa rara vez maneja un solo dato: maneja listas de productos, agendas de contactos, inventarios… Python trae cuatro colecciones fundamentales, cada una con su carácter. Saber cuál elegir es medio camino para escribir buen código.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py4-1', { title: 'Listas', summary: 'Colecciones ordenadas y modificables', emoji: '📋', commands: ['list', 'list.append', 'list.insert', 'list.remove', 'list.pop', 'list.sort', 'sorted'], minutes: 11 }, [
      learn(
        'Listas: muchos valores en una variable',
        `
Una **lista** guarda varios valores en orden, entre corchetes y separados por comas:

\`\`\`
notas = [7, 9, 5, 10]
frutas = ["pera", "kiwi", "uva"]
mezcla = [1, "dos", 3.0, True]       # pueden mezclar tipos
vacia = []
\`\`\`

Se manejan como los textos: **índices** (\`notas[0]\`, \`notas[-1]\`), **rebanadas** (\`notas[1:3]\`), \`len(notas)\`, \`in\` y se pueden recorrer con \`for\`. La gran diferencia: las listas son **mutables**, es decir, se pueden **modificar** sin crear otra:

\`\`\`
notas[0] = 8          # cambia el primer elemento
\`\`\`
`,
        '📋',
      ),
      illus('py-collections', 'Las cuatro colecciones', 'Lista, tupla, conjunto y diccionario: orden, repetición y mutabilidad.'),
      pyDemo('Lo básico de una lista', [
        ['notas = [7, 9, 5, 10]\nprint(notas[0], notas[-1], len(notas))'],
        ['notas[2] = 6\nprint(notas)', 'Reasignar una posición'],
        pyRepl('notas[1:3]', 'Una rebanada devuelve otra lista'),
        pyRepl('9 in notas'),
        pyErr('notas[10]', 'Un índice fuera de rango: `IndexError`', true),
      ]),
      learn(
        'Métodos para modificar listas',
        `
| Método | Qué hace |
|---|---|
| \`.append(x)\` | Añade \`x\` al **final** |
| \`.insert(i, x)\` | Inserta \`x\` en la posición \`i\` |
| \`.extend(otra)\` | Añade todos los elementos de otra lista |
| \`.remove(x)\` | Quita la **primera** aparición del valor \`x\` |
| \`.pop()\` / \`.pop(i)\` | Quita y **devuelve** el último / el de la posición \`i\` |
| \`.sort()\` | Ordena la lista **en sitio** |
| \`.reverse()\` | Le da la vuelta en sitio |
| \`.index(x)\` / \`.count(x)\` | Posición / número de apariciones |

> CLAVE: Los métodos que modifican la lista **devuelven \`None\`**. Escribir \`notas = notas.sort()\` deja \`notas\` en \`None\`: un clásico. Si quieres una copia ordenada **sin tocar la original**, usa la función \`sorted(notas)\`.
`,
      ),
      pyDemo('Añadir, quitar y ordenar', [
        ['compra = ["pan", "leche"]\ncompra.append("huevos")\ncompra.insert(0, "café")\nprint(compra)'],
        ['compra.remove("pan")\nultimo = compra.pop()\nprint(compra, ultimo)'],
        ['numeros = [5, 2, 9, 1]\nnuevos = sorted(numeros)\nprint(numeros, nuevos)', '`sorted` crea una lista nueva y deja la original'],
        ['numeros.sort(reverse=True)\nprint(numeros)', '`sort` modifica la original; `reverse=True` ordena de mayor a menor'],
        ['resultado = numeros.sort()\nprint(resultado)', 'La trampa: `sort()` devuelve `None`'],
      ]),
      pyOut('¿Qué imprime?', 'x = [3, 1, 2]\ny = x.sort()\nprint(x, y)', ['[3, 1, 2] None', '[1, 2, 3] [1, 2, 3]', '[1, 2, 3] []'], '`sort()` ordena `x` en sitio y devuelve `None`, así que `y` es `None`.'),
      mc('¿Qué diferencia hay entre `lista.sort()` y `sorted(lista)`?', ['Ninguna', '`sort()` modifica la lista; `sorted()` devuelve una nueva sin tocar la original', '`sorted()` modifica la lista; `sort()` crea una nueva', '`sort()` solo funciona con números'], 1, '`sort()` es un método que ordena en sitio (devuelve None). `sorted()` es una función que devuelve una lista nueva, sirve con cualquier iterable y deja el original intacto.'),
      match(
        'Une cada instrucción con su efecto',
        [
          ['lista.append(5)', 'Añade 5 al final'],
          ['lista.pop()', 'Quita y devuelve el último'],
          ['lista.remove(5)', 'Quita la primera aparición del valor 5'],
          ['lista.insert(0, 5)', 'Pone el 5 al principio'],
        ],
        '`append` e `insert` añaden; `pop` quita por posición (y devuelve) y `remove` quita por valor.',
      ),
      tf('`lista.append(1, 2)` añade los dos números a la lista.', false, '`append` acepta un único argumento. Para añadir varios elementos: `extend([1, 2])` o llamadas sucesivas.'),
      pyPractice({
        goal: 'La lista de la compra',
        prompt: 'Parte de `compra = ["pan"]`. Añade **"leche"** al final, inserta **"huevos"** al principio y quita **"pan"**. La lista final debe ser `["huevos", "leche"]`.',
        starter: 'compra = ["pan"]\n',
        check: variable('compra', "['huevos', 'leche']"),
        solution: 'compra = ["pan"]\ncompra.append("leche")\ncompra.insert(0, "huevos")\ncompra.remove("pan")',
        hints: ['Tres métodos: `append`, `insert` y `remove`.', '`compra.insert(0, "huevos")` coloca el elemento en la posición 0.'],
        explain: 'Las listas se modifican en sitio: no hace falta reasignar (`compra = compra.append(...)` sería un error: guardaría `None`).',
        commands: ['list.append', 'list.insert', 'list.remove'],
      }),
      pyPractice({
        goal: 'Ordena de mayor a menor',
        prompt: 'Ordena la lista `notas` **en sitio** de mayor a menor.',
        starter: 'notas = [4, 9, 3, 8, 6]\n',
        check: all(variable('notas', '[9, 8, 6, 4, 3]'), uses('method:sort')),
        solution: 'notas = [4, 9, 3, 8, 6]\nnotas.sort(reverse=True)',
        hints: ['El método `sort` tiene una opción para invertir el orden.', '`notas.sort(reverse=True)`'],
        explain: '`reverse=True` es un argumento con nombre. No se guarda el resultado en ninguna variable, porque `sort()` modifica la lista original.',
        commands: ['list.sort'],
      }),
      pyPractice({
        goal: 'Filtra los grandes',
        prompt: 'De la lista `numeros`, construye otra lista `grandes` con los números **mayores que 10** (en el mismo orden).',
        starter: 'numeros = [5, 12, 7, 20, 3, 15]\ngrandes = []\n',
        check: all(variable('grandes', '[12, 20, 15]'), uses('For'), uses('method:append')),
        solution: 'numeros = [5, 12, 7, 20, 3, 15]\ngrandes = []\nfor n in numeros:\n    if n > 10:\n        grandes.append(n)',
        hints: ['Recorre `numeros` y decide con un `if`.', 'Dentro del `if`: `grandes.append(n)`.'],
        explain: 'Este patrón —recorrer, comprobar, añadir— es tan común que Python tiene un atajo (las *comprensiones*) que verás en la zona 6.',
        commands: ['list.append', 'for'],
      }),
      pyCode('Guarda en `ultimo` el último elemento de `lista` **quitándolo** de ella.', {
        starter: 'lista = [10, 20, 30]\n',
        check: all(variable('ultimo', '30'), variable('lista', '[10, 20]')),
        solution: 'lista = [10, 20, 30]\nultimo = lista.pop()',
        hint: 'Un método quita *y* devuelve.',
        why: '`pop()` quita el último y lo devuelve. Con `lista[-1]` solo lo leerías sin quitarlo.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py4-2', { title: 'Tuplas y desempaquetado', summary: 'Colecciones inmutables y asignaciones múltiples', emoji: '🎁', commands: ['tuple', 'desempaquetado', 'zip'], minutes: 10 }, [
      learn(
        'Tuplas: listas que no cambian',
        `
Una **tupla** es como una lista pero **inmutable**: una vez creada no se puede cambiar. Se escribe con paréntesis (aunque lo que las hace tupla son las comas):

\`\`\`
punto = (3, 4)
color = ("rojo", 255, 0, 0)
solo_uno = (5,)        # ¡la coma es obligatoria con un elemento!
\`\`\`

Se indexan y rebanan igual que las listas, pero no tienen \`append\`, \`remove\`… ¿Para qué sirven entonces?

- Para datos que forman **un conjunto fijo**: coordenadas, fechas, (nombre, edad).
- Para **devolver varios valores** desde una función.
- Como **claves** de diccionario (las listas no pueden).
- Porque dan seguridad: nadie las altera por accidente.
`,
        '🎁',
      ),
      pyDemo('Creando y leyendo tuplas', [
        ['punto = (3, 4)\nprint(punto[0], punto[1], len(punto))'],
        pyRepl('type((5))', '`(5)` son solo paréntesis alrededor de un número'),
        pyRepl('type((5,))', 'Con la coma sí es una tupla'),
        pyErr('punto[0] = 10', 'Las tuplas no se pueden modificar: `TypeError`', true),
      ]),
      learn(
        'Desempaquetado: repartir una colección en variables',
        `
Puedes asignar los elementos de una secuencia a varias variables **de una sola vez**:

\`\`\`
x, y = (3, 4)             # x = 3, y = 4
nombre, edad = ["Ada", 36]
\`\`\`

Esto da el **intercambio** más elegante de Python, sin variable auxiliar:

\`\`\`
a, b = b, a
\`\`\`

Y con un **\`*\`** una variable recoge «el resto» (siempre es una lista):

\`\`\`
primero, *medio, ultimo = [1, 2, 3, 4, 5]    # medio = [2, 3, 4]
\`\`\`

Por convención, \`_\` se usa para un valor que no te interesa: \`_, edad = persona\`.
`,
      ),
      pyDemo('Desempaquetando', [
        ['x, y = (3, 4)\nprint(x, y)'],
        ['a, b = 1, 2\na, b = b, a\nprint(a, b)', 'Intercambio sin variable auxiliar'],
        ['primero, *resto = [10, 20, 30, 40]\nprint(primero, resto)'],
        ['for nombre, edad in [("Ada", 36), ("Linus", 30)]:\n    print(nombre, "tiene", edad)', 'Muy usado en bucles'],
        pyErr('a, b = [1, 2, 3]', 'El número de variables debe coincidir: `ValueError`', true),
      ]),
      learn(
        'zip: recorrer varias listas a la vez',
        `
**\`zip(a, b)\`** une las listas posición a posición, formando parejas. Combinado con el desempaquetado:

\`\`\`
nombres = ["Ada", "Linus"]
edades = [36, 30]
for nombre, edad in zip(nombres, edades):
    print(nombre, edad)
\`\`\`

Si las listas tienen distinta longitud, \`zip\` se detiene en la **más corta**. Con \`dict(zip(claves, valores))\` creas un diccionario a partir de dos listas.
`,
      ),
      pyDemo('zip en acción', [['nombres = ["Ada", "Linus", "Grace"]\nedades = [36, 30, 45]\nfor n, e in zip(nombres, edades):\n    print(f"{n} tiene {e}")'], pyRepl('list(zip("abc", [1, 2, 3, 4]))', 'Se para en la lista más corta')]),
      pyOut('¿Qué imprime?', 'a, b = 1, 2\na, b = b, a + b\nprint(a, b)', ['2 2', '1 3', '2 1'], 'El lado derecho se evalúa entero antes de asignar: `(b, a + b)` es `(2, 3)`. Por tanto `a` vale 2 y `b` vale 3.'),
      mc('¿Qué tipo tiene `(7)`?', ['tuple', 'int', 'list', 'Es un error'], 1, 'Los paréntesis solos solo agrupan. Para una tupla de un elemento hay que escribir la coma: `(7,)`.'),
      tf('Una tupla se puede modificar con `append`.', false, 'Las tuplas son inmutables: no tienen `append` ni permiten asignar a un índice.'),
      pyPractice({
        goal: 'Intercambia sin auxiliar',
        prompt: 'Las variables `a` y `b` valen 3 y 8. Intercámbialas (que `a` pase a valer 8 y `b` 3) en **una sola línea**, sin crear variables nuevas.',
        starter: 'a = 3\nb = 8\n',
        check: all(variable('a', '8'), variable('b', '3')),
        solution: 'a = 3\nb = 8\na, b = b, a',
        hints: ['Python evalúa todo el lado derecho antes de asignar.', '`a, b = b, a`'],
        explain: 'El lado derecho crea la tupla `(8, 3)` y luego se desempaqueta en `a` y `b`. No hace falta una variable temporal.',
        commands: ['desempaquetado'],
      }),
      pyPractice({
        goal: 'Primero y resto',
        prompt: 'Con `numeros = [10, 20, 30, 40]`, usa **desempaquetado con `*`** para guardar el primero en `primero` y el resto en `resto`.',
        starter: 'numeros = [10, 20, 30, 40]\n',
        check: all(variable('primero', '10'), variable('resto', '[20, 30, 40]'), uses('Starred')),
        solution: 'numeros = [10, 20, 30, 40]\nprimero, *resto = numeros',
        hints: ['Una variable con asterisco recoge lo sobrante.', '`primero, *resto = numeros`'],
        explain: 'La variable con `*` siempre es una **lista**, aunque sobre un solo elemento o ninguno.',
        commands: ['desempaquetado'],
      }),
      pyPractice({
        goal: 'Nombres y edades',
        prompt: 'Con las listas `nombres` y `edades`, muestra una línea por persona con el formato `Ada tiene 36 años`. Usa `zip`.',
        starter: 'nombres = ["Ada", "Linus"]\nedades = [36, 30]\n',
        check: all(stdout('Ada tiene 36 años\nLinus tiene 30 años'), uses('call:zip')),
        solution: 'nombres = ["Ada", "Linus"]\nedades = [36, 30]\nfor n, e in zip(nombres, edades):\n    print(f"{n} tiene {e} años")',
        hints: ['`zip` te da las parejas (nombre, edad).', '`for n, e in zip(nombres, edades):`'],
        explain: '`zip` + desempaquetado es la forma más limpia de recorrer varias listas en paralelo, sin índices.',
        commands: ['zip'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py4-3', { title: 'Diccionarios', summary: 'Pares clave → valor', emoji: '🗂️', commands: ['dict', 'dict.get', 'dict.items', 'dict.keys', 'dict.values', 'dict.pop'], minutes: 12 }, [
      learn(
        'Diccionarios: buscar por nombre en vez de por posición',
        `
Un **diccionario** (\`dict\`) guarda **pares clave → valor**. En lugar de preguntar «¿qué hay en la posición 2?», preguntas «¿cuál es el valor de \`"nombre"\`?»:

\`\`\`
persona = {"nombre": "Ada", "edad": 36}
print(persona["nombre"])          # Ada
\`\`\`

- Las **claves** son únicas y deben ser **inmutables** (textos, números, tuplas). Las listas no valen como clave.
- Los **valores** pueden ser de cualquier tipo, incluso otras colecciones.
- Mantienen el **orden de inserción**.
- Buscar por clave es **muy rápido**, aunque haya millones de entradas.
`,
        '🗂️',
      ),
      pyDemo('Crear, leer, cambiar y borrar', [
        ['persona = {"nombre": "Ada", "edad": 36}\nprint(persona["nombre"], len(persona))'],
        ['persona["edad"] = 37\npersona["ciudad"] = "Londres"\nprint(persona)', 'Asignar a una clave existente la cambia; a una nueva, la crea'],
        ['del persona["ciudad"]\nprint(persona)'],
        pyRepl('"nombre" in persona', '`in` mira las claves'),
        pyErr('persona["telefono"]', 'Pedir una clave que no existe: `KeyError`', true),
      ]),
      learn(
        'get, recorrer y otros métodos',
        `
Para evitar el \`KeyError\` usa **\`get\`**: devuelve un valor por defecto (\`None\` si no lo indicas) cuando la clave no existe.

| Expresión | Resultado |
|---|---|
| \`d.get(k)\` / \`d.get(k, 0)\` | Valor o \`None\` / valor o \`0\` |
| \`d.keys()\` | Las claves |
| \`d.values()\` | Los valores |
| \`d.items()\` | Las parejas \`(clave, valor)\` |
| \`d.pop(k)\` | Quita la clave y devuelve su valor |
| \`d.update(otro)\` | Mezcla otro diccionario |
| \`d.setdefault(k, v)\` | Si \`k\` no existe, la crea con \`v\` |

Recorrer un diccionario con \`for\` da las **claves**. Para clave y valor: \`for k, v in d.items():\`.
`,
      ),
      pyDemo('Recorriendo y consultando', [
        ['precios = {"pan": 1.2, "leche": 0.9, "huevos": 2.5}\nfor producto, precio in precios.items():\n    print(f"{producto}: {precio:.2f} €")'],
        pyRepl('precios.get("pan")'),
        pyRepl('precios.get("café", 0)', 'Con valor por defecto, sin error'),
        pyRepl('list(precios.keys())'),
        pyRepl('sum(precios.values())'),
        pyRepl('precios.pop("leche")'),
      ]),
      learn(
        'El patrón estrella: contar',
        `
Los diccionarios son perfectos para **contar apariciones**. El truco es \`get\` con valor por defecto 0:

\`\`\`
conteo = {}
for letra in "banana":
    conteo[letra] = conteo.get(letra, 0) + 1
print(conteo)     # {'b': 1, 'a': 3, 'n': 2}
\`\`\`

Lectura: «el conteo de esa letra es lo que tenía (o 0 si es nueva) más uno». Así no hace falta preguntar antes si la clave existe.
`,
      ),
      pyDemo('Contando letras y palabras', [['conteo = {}\nfor letra in "banana":\n    conteo[letra] = conteo.get(letra, 0) + 1\nprint(conteo)'], ['frase = "a b a c b a"\nfrecuencia = {}\nfor palabra in frase.split():\n    frecuencia[palabra] = frecuencia.get(palabra, 0) + 1\nprint(frecuencia)']]),
      pyOut('¿Qué imprime?', 'd = {"a": 1, "b": 2}\nd["c"] = 3\nd["a"] = 10\nprint(d)\nprint(d.get("z", "nada"))', ["{'a': 1, 'b': 2, 'c': 3}\nnada", "{'a': 1, 'b': 2, 'c': 3}\nNone", "{'a': 10, 'b': 2, 'c': 3}\nNone"], 'Asignar a una clave existente la sobrescribe (`a` pasa a 10); `c` se añade al final. `get("z", "nada")` devuelve el valor por defecto.'),
      mc('¿Qué devuelve `d.get("zz")` si `"zz"` no es una clave?', ['Un KeyError', 'None', '0', 'Un texto vacío'], 1, '`get` nunca falla: si la clave no existe devuelve `None` (o el valor por defecto que le des).'),
      tf('Una lista puede usarse como clave de un diccionario.', false, 'Las claves deben ser inmutables (hashables). Una lista es mutable, así que da `TypeError: unhashable type: \'list\'`. Una tupla sí vale.'),
      fill('Completa el patrón de conteo', 'conteo[p] = conteo.___(p, 0) + 1', ['get', 'pop', 'keys', 'update'], ['get'], '`get(p, 0)` devuelve el conteo actual o 0 si la palabra todavía no está.'),
      match(
        'Une cada método con lo que devuelve',
        [
          ['d.keys()', 'Las claves'],
          ['d.values()', 'Los valores'],
          ['d.items()', 'Las parejas (clave, valor)'],
          ['d.get(k)', 'El valor, o None si no existe'],
        ],
        'Son las cuatro consultas que más usarás con diccionarios.',
      ),
      pyPractice({
        goal: 'Ficha de contacto',
        prompt: 'Crea un diccionario `contacto` con las claves `"nombre"` (`"Ana"`) y `"telefono"` (`"555-1234"`). Después añade la clave `"ciudad"` con el valor `"Quito"`.',
        starter: '',
        check: variable('contacto', "{'nombre': 'Ana', 'telefono': '555-1234', 'ciudad': 'Quito'}"),
        solution: 'contacto = {"nombre": "Ana", "telefono": "555-1234"}\ncontacto["ciudad"] = "Quito"',
        hints: ['Primero el diccionario con dos pares, entre llaves.', '`contacto["ciudad"] = "Quito"` añade una clave nueva.'],
        explain: 'Los diccionarios crecen asignando a claves nuevas. Observa que el orden de inserción se conserva al mostrarlos.',
        commands: ['dict'],
      }),
      pyPractice({
        goal: 'Contar palabras',
        prompt: 'Cuenta cuántas veces aparece cada palabra de `frase` en un diccionario llamado `conteo`.',
        starter: 'frase = "a b a c b a"\nconteo = {}\n',
        check: all(variable('conteo', "{'a': 3, 'b': 2, 'c': 1}"), uses('For')),
        solution: 'frase = "a b a c b a"\nconteo = {}\nfor palabra in frase.split():\n    conteo[palabra] = conteo.get(palabra, 0) + 1',
        hints: ['`frase.split()` da la lista de palabras.', '`conteo[palabra] = conteo.get(palabra, 0) + 1`'],
        explain: 'El patrón de conteo con `get` aparece en muchísimos programas reales: frecuencias de palabras, votos, inventarios…',
        commands: ['dict.get', 'str.split'],
      }),
      pyPractice({
        goal: 'Consultar la agenda',
        prompt: 'La agenda ya existe. Lee un nombre con `input()` y muestra su teléfono; si no está, muestra **No encontrado**. Usa `get` o `in`.',
        setup: { stdin: ['Luis'] },
        starter: 'agenda = {"Ana": "555-1111", "Luis": "555-2222"}\nnombre = input("Nombre: ")\n',
        check: all(outHas('555-2222'), uses('call:input')),
        solution: 'agenda = {"Ana": "555-1111", "Luis": "555-2222"}\nnombre = input("Nombre: ")\nprint(agenda.get(nombre, "No encontrado"))',
        hints: ['`get` acepta un valor por defecto.', '`print(agenda.get(nombre, "No encontrado"))`'],
        explain: '`get` con valor por defecto evita el `KeyError` y te ahorra un `if nombre in agenda`.',
        commands: ['dict.get'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py4-4', { title: 'Conjuntos', summary: 'Colecciones sin repetidos y operaciones de conjuntos', emoji: '🔵', commands: ['set', 'set.add', 'set.discard', 'set.union', 'set.intersection', 'set.difference'], minutes: 9 }, [
      learn(
        'set: sin repetidos y sin orden',
        `
Un **conjunto** (\`set\`) es una colección de elementos **únicos** y **sin orden**: no hay posiciones (\`s[0]\` no existe). Se escribe con llaves:

\`\`\`
colores = {"rojo", "verde", "rojo"}      # solo queda un "rojo"
vacio = set()                           # {} crea un diccionario vacío, no un set
\`\`\`

Sus superpoderes:

- **Quitan duplicados** automáticamente.
- Preguntar **\`x in conjunto\`** es rapidísimo (mucho más que en una lista grande).
- Admiten las **operaciones matemáticas de conjuntos**.

Los elementos deben ser inmutables, como las claves de un diccionario.
`,
        '🔵',
      ),
      pyDemo('Duplicados y métodos', [
        ['numeros = [3, 1, 3, 2, 1]\nunicos = set(numeros)\nprint(sorted(unicos), len(unicos))', 'Para mostrar un set de forma estable usamos `sorted`'],
        ['s = {1, 2}\ns.add(3)\ns.add(2)\ns.discard(10)\nprint(sorted(s))', '`add` ignora repetidos; `discard` no falla si no existe'],
        pyErr('{1, 2}.remove(10)', '`remove` sí falla si no existe: `KeyError`', true),
        pyRepl('2 in {1, 2, 3}'),
      ]),
      learn(
        'Operaciones de conjuntos',
        `
| Operador | Método | Resultado |
|---|---|---|
| \`a \\| b\` | \`a.union(b)\` | Todo lo que está en **alguno** |
| \`a & b\` | \`a.intersection(b)\` | Lo que está en **ambos** |
| \`a - b\` | \`a.difference(b)\` | Lo de \`a\` que **no** está en \`b\` |
| \`a ^ b\` | \`a.symmetric_difference(b)\` | Lo que está en **uno solo** de los dos |
| \`a <= b\` | \`a.issubset(b)\` | ¿\`a\` está contenido en \`b\`? |

Ideales para preguntas como «¿qué amigos tenemos en común?» o «¿qué usuarios están en A pero no en B?».
`,
      ),
      pyDemo('Operaciones', [['a = {1, 2, 3, 4}\nb = {3, 4, 5}\nprint(sorted(a | b))\nprint(sorted(a & b))\nprint(sorted(a - b))\nprint(sorted(a ^ b))\nprint({3, 4} <= a)']]),
      pyOut('¿Qué imprime?', 'a = {1, 2, 3}\nb = {3, 4}\nprint(sorted(a | b), sorted(a & b), sorted(a - b))', ['[1, 2, 3, 4] [3] [2]', '[1, 2, 3, 3, 4] [3] [1, 2]', '[1, 2, 3, 4] [3] [4]'], 'La unión no repite el 3; la intersección es solo el 3; la diferencia `a - b` deja lo que está en `a` pero no en `b`: 1 y 2.'),
      mc('¿Cómo se crea un conjunto vacío?', ['{}', 'set()', '[]', 'set{}'], 1, '`{}` crea un diccionario vacío. Para un conjunto vacío hay que usar `set()`.'),
      tf('Un `set` conserva el orden en que se añadieron los elementos.', false, 'Un conjunto no garantiza ningún orden (y no admite índices). Si necesitas orden, usa `sorted(conjunto)` o una lista.'),
      fill('Completa para obtener los elementos comunes a `a` y `b`', 'comunes = a ___ b', ['&', '|', '-', '^'], ['&'], '`&` es la intersección; `|` la unión, `-` la diferencia y `^` la diferencia simétrica.'),
      pyPractice({
        goal: 'Sin repetidos y ordenados',
        prompt: 'De la lista `datos`, obtén una lista con sus valores **sin repetir y ordenados de menor a mayor**, y guárdala en `unicos`.',
        starter: 'datos = [5, 3, 5, 1, 3, 9, 1]\n',
        check: all(variable('unicos', '[1, 3, 5, 9]'), uses('call:set')),
        solution: 'datos = [5, 3, 5, 1, 3, 9, 1]\nunicos = sorted(set(datos))',
        hints: ['`set()` elimina los repetidos y `sorted()` devuelve una lista ordenada.', '`unicos = sorted(set(datos))`'],
        explain: 'Dos funciones encadenadas: `set` quita duplicados (pero pierde el orden) y `sorted` lo recupera en forma de lista.',
        commands: ['set', 'sorted'],
      }),
      pyPractice({
        goal: 'Amigos en común',
        prompt: 'Con los conjuntos `ana` y `luis`, guarda en `comunes` los amigos que tienen **ambos** (como lista ordenada).',
        starter: 'ana = {"Eva", "Rosa", "Pedro", "Marta"}\nluis = {"Pedro", "Juan", "Marta"}\n',
        check: all(variable('comunes', "['Marta', 'Pedro']"), either(uses('op:&'), uses('method:intersection'))),
        solution: 'ana = {"Eva", "Rosa", "Pedro", "Marta"}\nluis = {"Pedro", "Juan", "Marta"}\ncomunes = sorted(ana & luis)',
        hints: ['Hay un operador para la intersección.', '`sorted(ana & luis)`'],
        explain: 'La intersección (`&`) responde «¿qué tienen en común?». Ordenamos con `sorted` solo para que el resultado sea predecible.',
        commands: ['set.intersection'],
      }),
      pyPractice({
        goal: 'Primer repetido',
        prompt: 'Recorre `lista` y guarda en `repetido` el **primer** valor que ya se haya visto antes (usa un conjunto `vistos` y `break`).',
        starter: 'lista = [4, 7, 1, 7, 4, 9]\nvistos = set()\nrepetido = None\n',
        check: all(variable('repetido', '7'), uses('Break')),
        solution: 'lista = [4, 7, 1, 7, 4, 9]\nvistos = set()\nrepetido = None\nfor n in lista:\n    if n in vistos:\n        repetido = n\n        break\n    vistos.add(n)',
        hints: ['Antes de añadir `n` a `vistos`, pregunta si ya estaba.', 'Si estaba: guarda y `break`; si no: `vistos.add(n)`.'],
        explain: 'La pertenencia a un conjunto es muy rápida, por eso `vistos` es mejor que otra lista para este tipo de problemas.',
        commands: ['set.add', 'in'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py4-5', { title: 'Mutabilidad y copias', summary: 'Alias, copias y las trampas de las listas anidadas', emoji: '🪞', commands: ['mutabilidad', 'copy.copy', 'copy.deepcopy'], minutes: 11 }, [
      learn(
        'Dos nombres, un mismo objeto',
        `
Ya sabes que una variable es una **etiqueta** pegada a un valor. Lo que no se ve a primera vista es esto:

\`\`\`
a = [1, 2, 3]
b = a            # NO copia la lista: pega una segunda etiqueta
b.append(4)
print(a)         # [1, 2, 3, 4]  ¡a también cambió!
\`\`\`

Con valores **inmutables** (números, textos, tuplas) esto no importa, porque no se pueden modificar. Con **mutables** (listas, diccionarios, conjuntos) cualquier cambio hecho por un nombre lo ve el otro.

| Inmutables | Mutables |
|---|---|
| \`int\`, \`float\`, \`bool\` | \`list\` |
| \`str\`, \`tuple\`, \`frozenset\` | \`dict\`, \`set\` |
`,
        '🪞',
      ),
      illus('py-mutability', 'Una lista, dos etiquetas', 'Modificar a través de una etiqueta cambia lo que ve la otra.'),
      pyDemo('Alias frente a copia', [
        ['a = [1, 2, 3]\nb = a\nb.append(4)\nprint(a, b)\nprint(a is b)', 'Mismo objeto'],
        ['a = [1, 2, 3]\nc = a.copy()\nc.append(4)\nprint(a, c)\nprint(a is c)', 'Con `copy()` son objetos distintos'],
      ]),
      learn(
        'Cómo copiar de verdad',
        `
Para obtener una copia independiente (**copia superficial**) hay varias formas equivalentes:

- \`a.copy()\`
- \`list(a)\`
- \`a[:]\`
- \`copy.copy(a)\` (del módulo \`copy\`)

Pero ojo: la copia superficial solo copia **el contenedor exterior**. Si la lista contiene otras listas, esas sub-listas se **comparten**. Para copiarlo todo en profundidad existe \`copy.deepcopy\`.
`,
      ),
      pyDemo('Copia superficial frente a profunda', [['import copy\nmatriz = [[1, 2], [3, 4]]\nsuperficial = matriz.copy()\nprofunda = copy.deepcopy(matriz)\nmatriz[0][0] = 99\nprint(superficial)\nprint(profunda)', 'La copia superficial comparte las filas internas; la profunda no']]),
      learn(
        'Trampas clásicas',
        `
**1. Multiplicar una lista de listas.** \`[[0] * 3] * 3\` parece una cuadrícula 3×3, pero repite **la misma fila tres veces**:

\`\`\`
tablero = [[0] * 3] * 3
tablero[0][0] = 1
print(tablero)      # [[1, 0, 0], [1, 0, 0], [1, 0, 0]]
\`\`\`

La forma correcta es crear cada fila con su propia lista, por ejemplo con un bucle (o una comprensión, que verás en la zona 6).

**2. Funciones que modifican su argumento.** Si pasas una lista a una función y esta la altera, la alteración se ve fuera. Es un efecto secundario: asegúrate de que sea lo que quieres.
`,
        '⚠️',
      ),
      pyDemo('La trampa del tablero', [
        ['tablero = [[0] * 3] * 3\ntablero[0][0] = 1\nprint(tablero)', 'Las tres filas son la misma lista'],
        ['tablero = []\nfor _ in range(3):\n    tablero.append([0] * 3)\ntablero[0][0] = 1\nprint(tablero)', 'Una lista nueva por fila: ahora sí'],
      ]),
      pyOut('¿Qué imprime?', 'x = [1, 2]\ny = x\ny += [3]\nz = x[:]\nz.append(4)\nprint(x, y, z)', ['[1, 2] [1, 2, 3] [1, 2, 3, 4]', '[1, 2, 3, 4] [1, 2, 3, 4] [1, 2, 3, 4]', '[1, 2, 3] [1, 2, 3] [1, 2, 3]'], '`y += [3]` modifica la lista original en sitio, y `x` es la misma lista. `z = x[:]` es una copia, así que su `append(4)` no afecta a `x`.'),
      mc('¿Cuál de estas líneas crea una copia independiente de una lista de números?', ['b = a', 'b = a.copy()', 'b is a', 'b == a'], 1, '`b = a` solo crea otra etiqueta. `copy()` (o `a[:]`, `list(a)`) crea una lista nueva.'),
      match(
        'Une cada tipo con su mutabilidad',
        [
          ['list', 'Mutable'],
          ['tuple', 'Inmutable'],
          ['dict', 'Mutable'],
          ['str', 'Inmutable'],
        ],
        'Las listas, diccionarios y conjuntos se pueden modificar en sitio. Los números, textos y tuplas no.',
      ),
      tf('`copy.copy(lista_de_listas)` también duplica las listas interiores.', false, 'La copia superficial comparte los objetos interiores. Para duplicarlos hace falta `copy.deepcopy`.'),
      pyPractice({
        goal: 'Una copia independiente',
        prompt: 'Crea `copia` como una copia independiente de `original`. Añade un 4 **solo a `copia`**; `original` debe seguir siendo `[1, 2, 3]`.',
        starter: 'original = [1, 2, 3]\n',
        check: all(variable('original', '[1, 2, 3]'), variable('copia', '[1, 2, 3, 4]')),
        solution: 'original = [1, 2, 3]\ncopia = original.copy()\ncopia.append(4)',
        hints: ['No uses `copia = original` a secas.', '`copia = original.copy()`'],
        explain: 'Una copia superficial basta aquí porque la lista contiene números (inmutables).',
        commands: ['copy.copy', 'list.append'],
      }),
      pyPractice({
        goal: 'Tablero 3×3 correcto',
        prompt: 'Construye en `tablero` una cuadrícula 3×3 de ceros donde **cada fila sea una lista distinta** y cambia solo la esquina superior izquierda a 1. Resultado esperado: `[[1, 0, 0], [0, 0, 0], [0, 0, 0]]`.',
        starter: 'tablero = []\n',
        check: all(variable('tablero', '[[1, 0, 0], [0, 0, 0], [0, 0, 0]]'), uses('For')),
        solution: 'tablero = []\nfor _ in range(3):\n    tablero.append([0, 0, 0])\ntablero[0][0] = 1',
        hints: ['Crea la fila dentro del bucle, para que sea una lista nueva cada vez.', '`tablero.append([0, 0, 0])` dentro del `for`.'],
        explain: 'Al crear la fila dentro del bucle, cada iteración genera una lista nueva. `[[0]*3]*3` repetiría la misma.',
        commands: ['mutabilidad'],
      }),
      pyPractice({
        goal: 'Copia profunda',
        prompt: 'La variable `equipos` contiene listas. Haz con `copy.deepcopy` una copia llamada `respaldo`; luego añade `"Zoe"` al primer equipo de `equipos`. `respaldo` debe quedar sin Zoe.',
        starter: 'import copy\nequipos = [["Ana", "Luis"], ["Eva"]]\n',
        check: all(variable('respaldo', "[['Ana', 'Luis'], ['Eva']]"), variable('equipos', "[['Ana', 'Luis', 'Zoe'], ['Eva']]"), either(uses('method:deepcopy'), uses('call:deepcopy'))),
        solution: 'import copy\nequipos = [["Ana", "Luis"], ["Eva"]]\nrespaldo = copy.deepcopy(equipos)\nequipos[0].append("Zoe")',
        hints: ['La copia profunda duplica también las listas interiores.', '`respaldo = copy.deepcopy(equipos)` ANTES de modificar.'],
        explain: 'Hay que hacer el respaldo **antes** del cambio. Con `copy.copy` (o `.copy()`) el equipo interior seguiría compartido y Zoe aparecería en ambos.',
        commands: ['copy.deepcopy'],
      }),
    ]),
  ],
  boss: {
    goal: 'Frecuencia de palabras',
    prompt:
      'Dada la frase `texto`, muestra cuántas veces aparece cada palabra, **en orden alfabético**, con el formato `palabra: N` (una por línea).\n\nPara `"el gato y el perro y el pez"` el resultado es:\n\n```\nel: 3\ngato: 1\nperro: 1\npez: 1\ny: 2\n```',
    starter: 'texto = "el gato y el perro y el pez"\n',
    check: all(stdout('el: 3\ngato: 1\nperro: 1\npez: 1\ny: 2'), uses('For'), forbids('import:collections')),
    solution: 'texto = "el gato y el perro y el pez"\nconteo = {}\nfor palabra in texto.split():\n    conteo[palabra] = conteo.get(palabra, 0) + 1\nfor palabra in sorted(conteo):\n    print(f"{palabra}: {conteo[palabra]}")',
    hints: ['Primero cuenta con un diccionario; después muéstralo.', '`for palabra in sorted(conteo):` recorre las claves en orden alfabético.'],
    explain: 'Un clásico: dividir un texto (`split`), contar con un diccionario (`get`) y presentar ordenado (`sorted`). En la zona 8 conocerás `collections.Counter`, que lo hace en una línea.',
    commands: ['dict.get', 'str.split', 'sorted'],
  },
});

