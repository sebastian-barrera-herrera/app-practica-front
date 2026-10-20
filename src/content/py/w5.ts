import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, calls, forbids, func, stdout, uses, variable } from '../pycheck';

export const py5 = pyWorld({
  id: 'py5',
  index: 5,
  title: 'Funciones',
  subtitle: 'Código reutilizable con nombre propio',
  emoji: '🧩',
  color: '#A78BFA',
  level: 'intermedio',
  intro:
    'Hasta aquí todo tu código era un guion de arriba abajo. Las funciones te dejan ponerle **nombre** a un trozo de código para reutilizarlo, probarlo y combinarlo. Es el paso que separa los scripts de los programas de verdad: aprenderás a definirlas, a pasarles datos de todas las formas, a entender su alcance y a tratarlas como valores.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py5-1', { title: 'Definir funciones', summary: 'def, parámetros, return y docstrings', emoji: '🛠️', commands: ['def', 'return', 'docstrings'], minutes: 10 }, [
      learn(
        'Una receta con nombre',
        `
Una **función** es un bloque de código con nombre que puedes ejecutar (**llamar**) tantas veces como quieras. Ya usas funciones hechas: \`print\`, \`len\`, \`input\`. Ahora las crearás tú con **\`def\`**:

\`\`\`
def saludar(nombre):
    print(f"Hola, {nombre}")

saludar("Ada")
saludar("Linus")
\`\`\`

- \`nombre\` es un **parámetro**: una variable que recibe el dato cuando se llama.
- \`"Ada"\` es el **argumento**: el dato concreto que se pasa en cada llamada.
- Definir una función **no la ejecuta**; solo la registra. El código se ejecuta cuando la llamas.

¿Por qué? **No repetir código**, **dar nombres claros** a las ideas y poder **probar** cada pieza por separado.
`,
        '🛠️',
      ),
      pyDemo('Definir y llamar', [
        ['def saludar(nombre):\n    print(f"Hola, {nombre}")\n\nsaludar("Ada")\nsaludar("Linus")', 'Una definición, dos llamadas'],
        ['def cuadrado(n):\n    return n * n\n\nresultado = cuadrado(7)\nprint(resultado)\nprint(cuadrado(3) + cuadrado(4))', '`return` entrega un valor que se puede guardar o usar en cuentas'],
      ]),
      learn(
        'return no es print',
        `
Esta es la confusión número uno de las funciones:

- **\`print\`** *muestra* algo en pantalla y se acaba: el valor no sale de la función.
- **\`return\`** *devuelve* un valor a quien llamó, para que lo guarde o siga calculando. Además **termina la función en ese instante**: el código que haya después no se ejecuta.

Si una función no tiene \`return\` (o lo tiene vacío) devuelve **\`None\`**. Puedes devolver varios valores separados por comas: en realidad es una **tupla**.

> CLAVE: Una función que *calcula* debería **devolver** el resultado y dejar que quien la llame decida si lo muestra, lo guarda o lo usa en otra cuenta.
`,
      ),
      pyDemo('print frente a return', [
        ['def mostrar_doble(x):\n    print(x * 2)\n\ndef devolver_doble(x):\n    return x * 2\n\na = mostrar_doble(5)\nb = devolver_doble(5)\nprint("a vale", a)\nprint("b vale", b)', '`mostrar_doble` imprime pero devuelve None'],
        ['def min_max(datos):\n    return min(datos), max(datos)\n\nmenor, mayor = min_max([4, 9, 2, 7])\nprint(menor, mayor)', 'Devolver dos valores y desempaquetarlos'],
        ['def f():\n    return "salgo ya"\n    print("esto nunca se ejecuta")\n\nprint(f())'],
      ]),
      pyOut('¿Qué imprime?', 'def a(x):\n    print(x * 2)\n\ndef b(x):\n    return x * 2\n\nr = a(3)\ns = b(3)\nprint(r, s)', ['6\n6 6', '6\n6 None', 'None 6'], '`a(3)` imprime 6 durante la llamada y devuelve `None`. `b(3)` devuelve 6 sin imprimir. El último `print` muestra `None 6`.'),
      learn(
        'Docstrings: documentar',
        `
La primera línea de la función puede ser un texto entre triples comillas: el **docstring**. Describe qué hace la función y queda guardado en \`funcion.__doc__\`; lo muestran las ayudas del editor y \`help(funcion)\`.

\`\`\`
def area_circulo(radio):
    """Devuelve el área de un círculo de ese radio."""
    return 3.14159 * radio ** 2
\`\`\`

Una buena función hace **una sola cosa**, tiene un **nombre que dice qué hace** (verbo: \`calcular_total\`, \`es_primo\`) y un docstring de una línea.
`,
      ),
      mc('¿Qué devuelve una función que no tiene ninguna sentencia `return`?', ['0', 'Un texto vacío', 'None', 'Da un error'], 2, 'Sin `return` la función termina al acabar su código y devuelve `None`, el «valor de nada».'),
      tf('En una función, el código escrito después de un `return` también se ejecuta.', false, '`return` termina la función de inmediato. Lo que hay después solo se ejecutaría si `return` estuviera dentro de un `if` que no se cumple.'),
      fill('Completa la función para que devuelva el triple de `n`', 'def triple(n):\n    ___ n * 3', ['return', 'print', 'yield', 'def'], ['return'], 'Con `return` el valor sale de la función. Con `print` solo se mostraría y la llamada devolvería `None`.'),
      pyPractice({
        goal: 'Función cuadrado',
        prompt: 'Define una función `cuadrado(n)` que **devuelva** el cuadrado de `n`.',
        starter: '# Define la función cuadrado\n',
        check: all(func('cuadrado', 1), calls([['cuadrado(5)', '25'], ['cuadrado(-3)', '9'], ['cuadrado(0)', '0']])),
        solution: 'def cuadrado(n):\n    return n * n',
        hints: ['Estructura: `def nombre(parametro):` y un `return` indentado.', '`return n * n` (o `n ** 2`).'],
        explain: 'Aquí no hay `print`: la función devuelve el valor y cada quien decide qué hacer con él. Así se puede usar en `cuadrado(3) + cuadrado(4)`.',
        commands: ['def', 'return'],
      }),
      pyPractice({
        goal: '¿Es par?',
        prompt: 'Define `es_par(n)` que devuelva `True` si el número es par y `False` si no.',
        starter: '',
        check: all(func('es_par', 1), calls([['es_par(4)', 'True'], ['es_par(7)', 'False'], ['es_par(0)', 'True']])),
        solution: 'def es_par(n):\n    return n % 2 == 0',
        hints: ['La comparación `n % 2 == 0` ya es un bool.', 'No necesitas `if`: `return n % 2 == 0`.'],
        explain: 'Una comparación produce `True` o `False`, así que se puede devolver directamente. Escribir `if ...: return True else: return False` es redundante.',
        commands: ['def', 'return'],
      }),
      pyPractice({
        goal: 'Área y perímetro',
        prompt: 'Define `rectangulo(base, altura)` que devuelva **dos valores**: el área y el perímetro (en ese orden).',
        starter: '',
        check: all(func('rectangulo', 2), calls([['rectangulo(3, 4)', '(12, 14)'], ['rectangulo(5, 5)', '(25, 20)']])),
        solution: 'def rectangulo(base, altura):\n    area = base * altura\n    perimetro = 2 * (base + altura)\n    return area, perimetro',
        hints: ['Puedes devolver varios valores separados por comas.', '`return area, perimetro`'],
        explain: 'Python devuelve una tupla `(area, perimetro)`. Quien llama puede desempaquetarla: `a, p = rectangulo(3, 4)`.',
        commands: ['return'],
      }),
      pyCode('Define `mayor(a, b)` que devuelva el mayor de dos números (sin usar `max`).', {
        check: all(func('mayor', 2), forbids('call:max'), calls([['mayor(3, 9)', '9'], ['mayor(10, -2)', '10'], ['mayor(5, 5)', '5']])),
        solution: 'def mayor(a, b):\n    if a > b:\n        return a\n    return b',
        hint: 'Un `if` con `return` dentro; el otro `return` va después.',
        why: 'Un `return` dentro de un `if` termina la función; si no se cumple, se sigue con la siguiente línea. No hace falta `else`.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py5-2', { title: 'Argumentos', summary: 'Posicionales, con nombre, por defecto, *args y **kwargs', emoji: '🎛️', commands: ['argumentos', 'args-kwargs'], minutes: 12 }, [
      learn(
        'Formas de pasar datos',
        `
Al llamar a una función puedes pasar los argumentos de varias maneras:

- **Posicionales**: importa el orden. \`potencia(2, 10)\`.
- **Con nombre** (*keyword*): importa el nombre, no el orden. \`potencia(exponente=10, base=2)\`. Hacen la llamada mucho más legible.
- **Con valor por defecto**: si no se pasan, el parámetro toma el valor indicado en la definición.

\`\`\`
def potencia(base, exponente=2):
    return base ** exponente

potencia(5)                 # 25   (exponente por defecto)
potencia(2, 10)             # 1024
potencia(exponente=3, base=2)   # 8
\`\`\`

Regla: los parámetros con valor por defecto van **al final** de la lista.
`,
        '🎛️',
      ),
      pyDemo('Posicionales, nombrados y por defecto', [
        ['def potencia(base, exponente=2):\n    return base ** exponente\n\nprint(potencia(5))\nprint(potencia(2, 10))\nprint(potencia(exponente=3, base=2))'],
        ['def saludar(nombre, saludo="Hola", cierre="!"):\n    return f"{saludo}, {nombre}{cierre}"\n\nprint(saludar("Ada"))\nprint(saludar("Ada", cierre="."))\nprint(saludar("Ada", "Buenas"))', 'Puedes saltarte parámetros intermedios usando el nombre'],
        pyErr('def f(a=1, b):\n    return a + b', 'Un parámetro sin valor no puede ir después de uno con valor por defecto: `SyntaxError`'),
      ]),
      learn(
        '*args y **kwargs: cantidad variable',
        `
A veces no sabes cuántos argumentos llegarán:

- **\`*args\`** recoge todos los argumentos posicionales sobrantes en una **tupla**.
- **\`**kwargs\`** recoge todos los argumentos con nombre sobrantes en un **diccionario**.

\`\`\`
def suma(*numeros):
    return sum(numeros)

def ficha(**datos):
    for clave, valor in datos.items():
        print(clave, "=", valor)
\`\`\`

(Los nombres \`args\` y \`kwargs\` son convención; lo que cuenta son los asteriscos.) Y al **llamar**, los asteriscos hacen lo contrario: \`suma(*[1, 2, 3])\` reparte la lista como argumentos sueltos y \`ficha(**{"a": 1})\` reparte el diccionario como argumentos con nombre.
`,
      ),
      pyDemo('Cantidad variable', [
        ['def suma(*numeros):\n    print(type(numeros))\n    return sum(numeros)\n\nprint(suma(1, 2, 3))\nprint(suma())\nvalores = [10, 20, 30]\nprint(suma(*valores))', '`numeros` es una tupla; con `*` al llamar se reparte una lista'],
        ['def ficha(**datos):\n    print(type(datos))\n    for clave, valor in datos.items():\n        print(clave, "=", valor)\n\nficha(nombre="Ada", edad=36)', '`datos` es un diccionario'],
      ]),
      learn(
        'La trampa del valor por defecto mutable',
        `
Los valores por defecto se calculan **una sola vez**, cuando se define la función. Si el valor es una lista o un diccionario, **se comparte entre todas las llamadas**:

\`\`\`
def agregar(x, lista=[]):        # ¡peligro!
    lista.append(x)
    return lista
\`\`\`

La solución estándar: usar \`None\` como señal y crear la lista dentro.

\`\`\`
def agregar(x, lista=None):
    if lista is None:
        lista = []
    lista.append(x)
    return lista
\`\`\`
`,
        '⚠️',
      ),
      pyDemo('El fallo y su arreglo', [
        ['def agregar(x, lista=[]):\n    lista.append(x)\n    return lista\n\nprint(agregar(1))\nprint(agregar(2))\nprint(agregar(3))', '¡La lista se arrastra entre llamadas!'],
        ['def agregar(x, lista=None):\n    if lista is None:\n        lista = []\n    lista.append(x)\n    return lista\n\nprint(agregar(1))\nprint(agregar(2))', 'Ahora cada llamada empieza con su propia lista'],
      ]),
      pyOut('¿Qué imprime?', 'def f(a, b=10, *resto):\n    return a + b + len(resto)\n\nprint(f(1))\nprint(f(1, 2))\nprint(f(1, 2, 7, 8, 9))', ['11\n3\n8', '11\n3\n5', '1\n3\n6'], '`f(1)` = 1 + 10 + 0 = 11. `f(1, 2)` = 1 + 2 + 0 = 3. En la última, `resto` es `(7, 8, 9)`, que tiene 3 elementos: 1 + 2 + 3 = 6.'),
      mc('¿Qué tipo tiene `args` dentro de `def f(*args):`?', ['list', 'tuple', 'dict', 'set'], 1, '`*args` recoge los posicionales en una **tupla**. `**kwargs` recoge los nombrados en un diccionario.'),
      tf('Los valores por defecto de una función se recalculan en cada llamada.', false, 'Se evalúan una sola vez, al definir la función. Por eso un valor por defecto mutable (como `[]`) se comparte entre llamadas.'),
      fill('Completa para aceptar cualquier cantidad de números', 'def total(___):\n    return sum(numeros)', ['*numeros', '**numeros', 'numeros[]', 'numeros...'], ['*numeros'], 'Un asterisco delante del nombre indica «recoger todos los posicionales en una tupla».'),
      pyPractice({
        goal: 'Saludo con valor por defecto',
        prompt: 'Define `saludar(nombre, saludo="Hola")` que devuelva el texto `"<saludo>, <nombre>!"`. Por ejemplo `saludar("Ada")` → `"Hola, Ada!"` y `saludar("Ada", "Buenas")` → `"Buenas, Ada!"`.',
        starter: '',
        check: all(func('saludar'), calls([['saludar("Ada")', "'Hola, Ada!'"], ['saludar("Ada", "Buenas")', "'Buenas, Ada!'"], ['saludar(nombre="Luis", saludo="Hey")', "'Hey, Luis!'"]])),
        solution: 'def saludar(nombre, saludo="Hola"):\n    return f"{saludo}, {nombre}!"',
        hints: ['El parámetro con valor por defecto va al final.', '`def saludar(nombre, saludo="Hola"):`'],
        explain: 'Los valores por defecto hacen que lo habitual sea corto de escribir (`saludar("Ada")`) y lo especial siga siendo posible.',
        commands: ['argumentos'],
      }),
      pyPractice({
        goal: 'Promedio de cantidad variable',
        prompt: 'Define `promedio(*notas)` que devuelva el promedio de todas las notas recibidas (un decimal).',
        starter: '',
        check: all(func('promedio'), calls([['promedio(8, 6)', '7.0'], ['promedio(10)', '10.0'], ['promedio(5, 7, 9)', '7.0']])),
        solution: 'def promedio(*notas):\n    return sum(notas) / len(notas)',
        hints: ['`notas` es una tupla: funcionan `sum` y `len`.', '`return sum(notas) / len(notas)`'],
        explain: 'Con `*notas` la función admite una, dos o veinte notas sin cambiar nada. (Con cero notas dividiría entre cero: en la zona de errores aprenderás a manejarlo.)',
        commands: ['args-kwargs'],
      }),
      pyPractice({
        goal: 'Arregla la lista compartida',
        prompt: 'Esta función comparte la lista entre llamadas. Arréglala para que cada llamada **sin lista** empiece con una lista nueva: `agregar(1)` debe dar `[1]` y después `agregar(2)` debe dar `[2]`.',
        starter: 'def agregar(x, lista=[]):\n    lista.append(x)\n    return lista\n',
        check: all(func('agregar'), calls([['agregar(1)', '[1]'], ['agregar(2)', '[2]'], ['agregar(3, [9])', '[9, 3]']])),
        solution: 'def agregar(x, lista=None):\n    if lista is None:\n        lista = []\n    lista.append(x)\n    return lista',
        hints: ['Usa `None` como valor por defecto.', 'Dentro de la función: `if lista is None: lista = []`.'],
        explain: 'Crear la lista dentro del cuerpo (y no en la firma) garantiza una lista nueva en cada llamada.',
        commands: ['argumentos'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py5-3', { title: 'Alcance y closures', summary: 'Dónde viven las variables y funciones que recuerdan', emoji: '🔭', commands: ['alcance', 'global', 'nonlocal', 'closures'], minutes: 12 }, [
      learn(
        'Dónde vive cada variable',
        `
Una variable no es visible desde cualquier parte: depende de **dónde se creó**. Las variables creadas dentro de una función son **locales**: nacen cuando se llama a la función y **desaparecen** cuando termina.

Cuando Python busca un nombre sigue la regla **LEGB**, de dentro hacia fuera:

1. **L**ocal: dentro de la función actual.
2. **E**nclosing: en las funciones que la envuelven.
3. **G**lobal: en el módulo (el archivo).
4. **B**uilt-in: los nombres de Python (\`print\`, \`len\`…).

Se usa el **primer** sitio donde aparezca el nombre.
`,
        '🔭',
      ),
      illus('py-scope-legb', 'La búsqueda LEGB', 'Python busca un nombre de dentro hacia fuera: local, envolvente, global y predefinido.'),
      pyDemo('Local, global y sombras', [
        ['x = "global"\n\ndef f():\n    x = "local"\n    print("dentro:", x)\n\nf()\nprint("fuera:", x)', 'La `x` de dentro es otra variable: «sombrea» a la global'],
        ['limite = 100\n\ndef comprobar(n):\n    return n < limite\n\nprint(comprobar(50))', 'Leer una global desde una función sí se puede'],
        pyErr('def g():\n    secreto = 42\n\ng()\nprint(secreto)', 'Una variable local no existe fuera de su función: `NameError`'),
      ]),
      learn(
        'global y nonlocal',
        `
Leer una variable de fuera es libre. Pero si **asignas** dentro de una función, Python asume que es local, y eso provoca un clásico error:

\`\`\`
contador = 0
def sumar():
    contador += 1     # UnboundLocalError
\`\`\`

Para modificar una global hay que declararlo con **\`global\`**; para modificar una variable de una función envolvente, **\`nonlocal\`**.

> CLAVE: Usar \`global\` es casi siempre una mala idea (el código se vuelve difícil de seguir). Lo normal es **pasar datos como parámetros** y **devolver resultados**. Es mejor diseño y más fácil de probar.
`,
      ),
      pyDemo('El error y su arreglo', [
        pyErr('contador = 0\n\ndef sumar():\n    contador += 1\n\nsumar()', 'Asignar dentro la hace local, pero la leemos antes de darle valor: `UnboundLocalError`'),
        ['contador = 0\n\ndef sumar():\n    global contador\n    contador += 1\n\nsumar()\nsumar()\nprint(contador)', 'Con `global` funciona (pero es mejor devolver valores)'],
        ['def sumar(contador):\n    return contador + 1\n\nc = 0\nc = sumar(c)\nc = sumar(c)\nprint(c)', 'La alternativa recomendada'],
      ]),
      learn(
        'Closures: funciones que recuerdan',
        `
Una función puede definirse **dentro de otra** y usar sus variables. Si la función exterior **devuelve** la interior, esta sigue «recordando» el entorno donde nació, aunque la exterior ya haya terminado. A eso se le llama **closure** (clausura).

\`\`\`
def crear_multiplicador(n):
    def multiplicar(x):
        return x * n          # usa la n de la función exterior
    return multiplicar

doble = crear_multiplicador(2)
print(doble(10))             # 20
\`\`\`

Con \`nonlocal\` la función interior incluso puede **modificar** el estado que recuerda: así se hacen contadores sin variables globales. Es la base de los **decoradores** que verás en la zona 11.
`,
      ),
      pyDemo('Funciones que fabrican funciones', [
        ['def crear_multiplicador(n):\n    def multiplicar(x):\n        return x * n\n    return multiplicar\n\ndoble = crear_multiplicador(2)\ntriple = crear_multiplicador(3)\nprint(doble(10), triple(10))'],
        ['def crear_contador():\n    cuenta = 0\n    def contar():\n        nonlocal cuenta\n        cuenta += 1\n        return cuenta\n    return contar\n\na = crear_contador()\nb = crear_contador()\nprint(a(), a(), a(), b())', 'Cada contador tiene su propio estado'],
      ]),
      pyOut('¿Qué imprime?', 'x = "global"\n\ndef f():\n    x = "local"\n    return x\n\nprint(f(), x)', ['global global', 'local local', 'global local'], 'La `x` de `f` es local y no toca la global. `f()` devuelve «local» y la `x` global sigue siendo «global».'),
      mc('¿Qué significa la «E» de LEGB?', ['Entrada', 'Las variables de las funciones envolventes (Enclosing)', 'Errores', 'Externa a Python'], 1, 'Enclosing: las variables de las funciones dentro de las que está definida la tuya. Es lo que usan los closures.'),
      tf('Dentro de una función, `total += 1` modifica una variable global llamada `total` sin necesidad de ninguna declaración.', false, 'Sin `global total`, Python trata `total` como local y lanza `UnboundLocalError` al intentar leerla antes de asignarla.'),
      fill('Completa para que la función interior modifique `cuenta` de la exterior', 'def externa():\n    cuenta = 0\n    def interna():\n        ___ cuenta\n        cuenta += 1\n    return interna', ['nonlocal', 'global', 'local', 'static'], ['nonlocal'], '`nonlocal` indica que `cuenta` pertenece a la función envolvente más próxima, no a la interna.'),
      pyPractice({
        goal: 'Contador con closure',
        prompt: 'Define `crear_contador()` que devuelva una función. Cada vez que se llame a esa función debe devolver el siguiente número: 1, 2, 3… y cada contador creado debe tener su propia cuenta.',
        starter: '',
        check: all(func('crear_contador', 0), calls([['(lambda c: (c(), c(), c()))(crear_contador())', '(1, 2, 3)'], ['(lambda a, b: (a(), a(), b()))(crear_contador(), crear_contador())', '(1, 2, 1)']])),
        solution: 'def crear_contador():\n    cuenta = 0\n    def contar():\n        nonlocal cuenta\n        cuenta += 1\n        return cuenta\n    return contar',
        hints: ['La variable `cuenta` va en la función exterior; la interior la modifica.', 'No olvides `nonlocal cuenta` dentro de la interior.'],
        explain: 'El estado vive en la función exterior, pero cada llamada a `crear_contador` crea un entorno nuevo, por eso los contadores son independientes.',
        commands: ['closures', 'nonlocal'],
      }),
      pyPractice({
        goal: 'Fábrica de multiplicadores',
        prompt: 'Define `crear_multiplicador(n)` que devuelva una función que multiplique su argumento por `n`.',
        starter: '',
        check: all(func('crear_multiplicador', 1), calls([['crear_multiplicador(3)(5)', '15'], ['crear_multiplicador(10)(7)', '70'], ['crear_multiplicador(0)(99)', '0']])),
        solution: 'def crear_multiplicador(n):\n    def multiplicar(x):\n        return x * n\n    return multiplicar',
        hints: ['Define una función dentro de otra y devuélvela (sin paréntesis).', '`return multiplicar`, no `return multiplicar()`.'],
        explain: 'Devuelves la función en sí, no su resultado. La interior «recuerda» el `n` con el que se creó.',
        commands: ['closures'],
      }),
      pyPractice({
        goal: 'Arregla el UnboundLocalError',
        prompt: 'Este programa debería mostrar **8** pero falla. Arréglalo usando `global` (en un programa real preferirías devolver el valor).',
        starter: 'total = 0\n\ndef sumar(n):\n    total += n\n\nsumar(5)\nsumar(3)\nprint(total)',
        check: all(stdout('8'), uses('Global')),
        solution: 'total = 0\n\ndef sumar(n):\n    global total\n    total += n\n\nsumar(5)\nsumar(3)\nprint(total)',
        hints: ['Dentro de `sumar`, Python debe saber que `total` es la global.', 'Añade `global total` como primera línea de la función.'],
        explain: '`global total` le dice a Python que no cree una variable local. Alternativa mejor: `def sumar(total, n): return total + n`.',
        commands: ['global'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py5-4', { title: 'Funciones de primera clase', summary: 'Funciones como valores: lambda, key, map y filter', emoji: '🎭', commands: ['lambda', 'map', 'filter', 'sorted'], minutes: 12 }, [
      learn(
        'Las funciones también son valores',
        `
En Python una función es un valor más, como un número o un texto. Eso significa que puedes:

- **Guardarla** en una variable: \`f = len\`.
- **Pasarla** como argumento a otra función.
- **Devolverla** desde una función (como en los closures).
- **Guardarla** en una lista o un diccionario.

Fíjate en la diferencia: \`len\` es la función; \`len("hola")\` es **llamarla**. Sin paréntesis no se ejecuta.
`,
        '🎭',
      ),
      pyDemo('Funciones como valores', [
        ['f = len\nprint(f("hola"))\nprint(f)', 'La función guardada en una variable'],
        ['def doble(x):\n    return x * 2\n\ndef aplicar(funcion, valor):\n    return funcion(valor)\n\nprint(aplicar(doble, 21))\nprint(aplicar(str.upper, "hola"))', 'Pasar funciones como argumentos'],
        ['def sumar(a, b):\n    return a + b\n\ndef restar(a, b):\n    return a - b\n\noperaciones = {"+": sumar, "-": restar}\nprint(operaciones["+"](10, 4))\nprint(operaciones["-"](10, 4))', 'Un diccionario de funciones sustituye a una cadena de if/elif'],
      ]),
      learn(
        'lambda: funciones de una línea',
        `
Una **lambda** es una función pequeña **sin nombre**, escrita como una expresión:

\`\`\`
lambda x: x * 2
\`\`\`

Equivale a \`def f(x): return x * 2\`. Solo puede contener **una expresión** (no sentencias) y devuelve su valor. Su sitio natural es donde necesitas una función pequeña **una sola vez**, sobre todo como argumento \`key\` de \`sorted\`, \`min\` y \`max\`:

\`\`\`
palabras = ["pera", "kiwi", "manzana"]
sorted(palabras, key=len)                     # por longitud
sorted(palabras, key=lambda p: p[-1])          # por la última letra
\`\`\`

Con \`key\`, Python aplica la función a cada elemento y ordena por el resultado.
`,
      ),
      pyDemo('lambda y key', [
        pyRepl('(lambda x: x * 2)(21)', 'Una lambda se puede llamar directamente'),
        ['palabras = ["manzana", "pera", "kiwi", "uva"]\nprint(sorted(palabras, key=len))\nprint(sorted(palabras, key=lambda p: p[-1]))\nprint(max(palabras, key=len))'],
        ['personas = [("Ada", 36), ("Linus", 30), ("Grace", 45)]\nprint(sorted(personas, key=lambda p: p[1]))\nprint(min(personas, key=lambda p: p[1]))', 'Ordenar tuplas por su segundo elemento'],
      ]),
      learn(
        'map y filter',
        `
Dos funciones clásicas que reciben **otra función** como primer argumento:

- **\`map(f, lista)\`**: aplica \`f\` a **cada** elemento y devuelve los resultados.
- **\`filter(f, lista)\`**: se queda solo con los elementos para los que \`f\` devuelve verdadero.

Ambas devuelven un iterador «perezoso»: para ver los datos envuélvelos con \`list(...)\`.

\`\`\`
list(map(lambda n: n * n, [1, 2, 3]))          # [1, 4, 9]
list(filter(lambda n: n % 2 == 0, [1, 2, 3, 4]))   # [2, 4]
\`\`\`

Más adelante verás las **comprensiones**, que suelen ser más legibles para lo mismo; pero conviene conocer estas funciones porque aparecen en mucho código.
`,
      ),
      pyDemo('Transformar y filtrar', [pyRepl('list(map(lambda n: n * n, [1, 2, 3, 4]))'), pyRepl('list(filter(lambda n: n % 2 == 0, [1, 2, 3, 4, 5, 6]))'), pyRepl('list(map(str.upper, ["a", "b"]))', 'Con funciones ya existentes no hace falta lambda'), pyRepl('list(filter(None, [0, 1, "", "a", None]))', 'Con `None` quita los valores falsos')]),
      pyOut('¿Qué imprime?', 'nums = [1, 2, 3, 4]\nprint(list(map(lambda n: n + 1, filter(lambda n: n > 2, nums))))', ['[2, 3, 4, 5]', '[3, 4]', '[5, 6]'], 'Primero `filter` deja [3, 4] y después `map` suma 1 a cada uno: [4, 5].'),
      mc('¿Qué es `lambda x: x + 1`?', ['Una variable', 'Una función anónima de una sola expresión', 'Un bucle', 'Un módulo'], 1, 'Una lambda es una función sin nombre cuyo cuerpo es una única expresión.'),
      tf('Una `lambda` puede contener varias sentencias, como un `for` o varios `print`.', false, 'Una lambda solo admite una expresión. Para algo más complejo hay que usar `def`.'),
      match(
        'Une cada llamada con su resultado',
        [
          ['sorted([3, 1, 2], reverse=True)', '[3, 2, 1]'],
          ['max(["a", "bbb", "cc"], key=len)', '"bbb"'],
          ['list(map(len, ["ab", "c"]))', '[2, 1]'],
          ['list(filter(str.isdigit, ["1", "a", "22"]))', "['1', '22']"],
        ],
        '`key` decide con qué criterio se compara; `map` transforma cada elemento y `filter` descarta los que no cumplen la condición.',
      ),
      pyPractice({
        goal: 'De la más larga a la más corta',
        prompt: 'Ordena la lista `palabras` por **longitud, de mayor a menor**, y guarda el resultado en `ordenadas` (sin modificar `palabras`).',
        starter: 'palabras = ["pera", "kiwi", "uva", "manzana"]\n',
        check: all(variable('ordenadas', "['manzana', 'pera', 'kiwi', 'uva']"), uses('call:sorted')),
        solution: 'palabras = ["pera", "kiwi", "uva", "manzana"]\nordenadas = sorted(palabras, key=len, reverse=True)',
        hints: ['`sorted` acepta `key` y `reverse`.', '`sorted(palabras, key=len, reverse=True)`'],
        explain: '`key=len` pasa la función `len` sin llamarla (sin paréntesis). Con empates, `sorted` mantiene el orden original (es estable).',
        commands: ['sorted'],
      }),
      pyPractice({
        goal: 'Aplicar dos veces',
        prompt: 'Define `aplicar_dos_veces(f, x)` que aplique la función `f` al valor `x` y luego otra vez al resultado.',
        starter: '',
        check: all(func('aplicar_dos_veces', 2), calls([['aplicar_dos_veces(lambda n: n + 3, 10)', '16'], ['aplicar_dos_veces(str.upper, "a")', "'A'"], ['aplicar_dos_veces(lambda s: s + "!", "hola")', "'hola!!'"]])),
        solution: 'def aplicar_dos_veces(f, x):\n    return f(f(x))',
        hints: ['`f` es un parámetro que contiene una función: se llama con paréntesis.', '`return f(f(x))`'],
        explain: 'Las funciones que reciben funciones se llaman de **orden superior**. `map`, `filter` o `sorted(key=...)` son ejemplos.',
        commands: ['lambda'],
      }),
      pyPractice({
        goal: 'Cuadrados de los pares',
        prompt: 'Con `numeros = [1, 2, 3, 4, 5, 6]`, guarda en `resultado` (una lista) el cuadrado de cada número **par**. Usa `filter` y `map`.',
        starter: 'numeros = [1, 2, 3, 4, 5, 6]\n',
        check: all(variable('resultado', '[4, 16, 36]'), uses('call:map'), uses('call:filter')),
        solution: 'numeros = [1, 2, 3, 4, 5, 6]\nresultado = list(map(lambda n: n * n, filter(lambda n: n % 2 == 0, numeros)))',
        hints: ['Primero filtra los pares, después eleva al cuadrado.', 'No olvides envolver con `list(...)` para obtener una lista.'],
        explain: 'Funciona, pero compáralo con la comprensión `[n * n for n in numeros if n % 2 == 0]` que verás en la zona 6: dice lo mismo con menos ruido.',
        commands: ['map', 'filter'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py5-5', { title: 'Recursión', summary: 'Funciones que se llaman a sí mismas', emoji: '🪆', commands: ['recursion'], minutes: 12 }, [
      learn(
        'Una función que se llama a sí misma',
        `
Una función **recursiva** se resuelve llamándose a sí misma con un problema **más pequeño**. Es como las muñecas rusas: para abrir una, abres otra más pequeña, hasta llegar a la última.

Toda recursión necesita dos cosas:

1. **Caso base**: la situación más simple, que se responde directamente (y detiene la recursión).
2. **Caso recursivo**: reduce el problema y se llama a sí misma.

\`\`\`
def factorial(n):
    if n <= 1:            # caso base
        return 1
    return n * factorial(n - 1)     # caso recursivo
\`\`\`

\`factorial(4)\` espera a \`factorial(3)\`, que espera a \`factorial(2)\`… hasta llegar al caso base y entonces las respuestas «regresan» multiplicándose.
`,
        '🪆',
      ),
      illus('py-call-stack', 'La pila de llamadas', 'Cada llamada espera a la siguiente; al llegar al caso base las respuestas vuelven en cadena.'),
      pyDemo('Factorial y cuenta atrás', [
        ['def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(5))\nprint(factorial(10))'],
        ['def cuenta_atras(n):\n    if n == 0:\n        print("¡Despegue!")\n    else:\n        print(n)\n        cuenta_atras(n - 1)\n\ncuenta_atras(3)'],
        ['def mostrar(n):\n    if n > 0:\n        mostrar(n - 1)\n        print(n)\n\nmostrar(3)', 'Si el `print` va DESPUÉS de la llamada recursiva, el orden se invierte: se imprime al volver'],
      ]),
      learn(
        'Fibonacci, límites y peligros',
        `
**Fibonacci**: cada número es la suma de los dos anteriores (0, 1, 1, 2, 3, 5, 8…). Su definición es naturalmente recursiva:

\`\`\`
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
\`\`\`

Dos advertencias importantes:

- **Sin caso base** (o si nunca se alcanza) la recursión no termina. Python la corta por seguridad al llegar a unas **1000 llamadas** con un \`RecursionError\`.
- **Fibonacci así de escrito es lentísimo**: repite los mismos cálculos miles de veces (\`fib(30)\` hace más de un millón de llamadas). En la zona 12 aprenderás a evitarlo con *memoización*.
`,
      ),
      pyDemo('Fibonacci y la recursión infinita', [
        ['def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint([fib(i) for i in range(10)])'],
        pyErr('def sin_fin(n):\n    return sin_fin(n + 1)\n\nsin_fin(0)', 'Sin caso base: `RecursionError`. Fíjate en «[Previous line repeated ... more times]»'),
      ]),
      learn(
        '¿Cuándo usar recursión?',
        `
La recursión brilla cuando el problema **tiene la misma forma que sus subproblemas**: recorrer carpetas dentro de carpetas, árboles, expresiones anidadas, dividir y conquistar (búsqueda binaria, ordenamiento rápido)…

Para recorridos simples (sumar una lista, contar hasta N) un bucle suele ser más claro y más rápido, y no tiene límite de profundidad. Todo lo recursivo se puede escribir con bucles (y viceversa); elige lo que dé el código más legible.
`,
      ),
      pyOut('¿Qué imprime?', 'def f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)\n\nprint(f(4))', ['4', '24', '6'], '`f(4)` = 4 + f(3) = 4 + 3 + f(2) = … = 4 + 3 + 2 + 1 + 0 = 10.'),
      mc('¿Para qué sirve el caso base de una función recursiva?', ['Para acelerar el programa', 'Para detener la recursión devolviendo una respuesta directa', 'Para imprimir el resultado', 'Para declarar variables'], 1, 'Sin caso base la función se llamaría a sí misma indefinidamente hasta provocar un `RecursionError`.'),
      tf('Una función recursiva sin caso base termina con un `RecursionError`.', true, 'Python limita la profundidad de la pila (unas 1000 llamadas por defecto) y lanza `RecursionError: maximum recursion depth exceeded`.'),
      fill('Completa el caso base del factorial', 'def factorial(n):\n    if n ___ 1:\n        return 1\n    return n * factorial(n - 1)', ['<=', '>=', '==', '!='], ['<='], 'Con `n <= 1` cubrimos el 1 y también el 0 (0! = 1), y evitamos llamadas con números negativos infinitas.'),
      pyPractice({
        goal: 'Factorial recursivo',
        prompt: 'Define `factorial(n)` **de forma recursiva** (sin bucles). `factorial(5)` es 120; `factorial(0)` es 1.',
        starter: '',
        check: all(func('factorial', 1), calls([['factorial(5)', '120'], ['factorial(0)', '1'], ['factorial(1)', '1'], ['factorial(8)', '40320']]), uses('call:factorial'), forbids('For'), forbids('While')),
        solution: 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)',
        hints: ['Caso base: `n <= 1` devuelve 1.', 'Caso recursivo: `n * factorial(n - 1)`'],
        explain: 'Cada llamada multiplica `n` por el factorial del siguiente número menor, hasta llegar al caso base.',
        commands: ['recursion'],
      }),
      pyPractice({
        goal: 'Suma de dígitos',
        prompt: 'Define `suma_digitos(n)` recursiva: para un entero no negativo devuelve la suma de sus dígitos. `suma_digitos(1234)` es 10. Pista: `n % 10` es el último dígito y `n // 10` es el número sin él.',
        starter: '',
        check: all(func('suma_digitos', 1), calls([['suma_digitos(1234)', '10'], ['suma_digitos(7)', '7'], ['suma_digitos(0)', '0'], ['suma_digitos(999)', '27']]), uses('call:suma_digitos')),
        solution: 'def suma_digitos(n):\n    if n < 10:\n        return n\n    return n % 10 + suma_digitos(n // 10)',
        hints: ['Caso base: si `n` tiene un solo dígito (`n < 10`), la suma es `n`.', 'Caso recursivo: último dígito + `suma_digitos(n // 10)`.'],
        explain: 'Cada llamada «pela» un dígito: el problema se reduce hasta que queda uno solo.',
        commands: ['recursion'],
      }),
      pyPractice({
        goal: 'Potencia sin **',
        prompt: 'Define `potencia(base, exp)` recursiva para exponentes enteros no negativos, **sin usar el operador `**`**: `potencia(2, 10)` es 1024 y `potencia(5, 0)` es 1.',
        starter: '',
        check: all(func('potencia', 2), calls([['potencia(2, 10)', '1024'], ['potencia(5, 0)', '1'], ['potencia(3, 3)', '27'], ['potencia(7, 1)', '7']]), forbids('op:**'), uses('call:potencia')),
        solution: 'def potencia(base, exp):\n    if exp == 0:\n        return 1\n    return base * potencia(base, exp - 1)',
        hints: ['Cualquier número elevado a 0 es 1.', '`base ** n` es `base * base ** (n - 1)`.'],
        explain: 'El exponente baja en cada llamada hasta llegar a 0, el caso base. (Existe una versión más rápida que divide el exponente a la mitad.)',
        commands: ['recursion'],
      }),
      pyPractice({
        goal: 'Palíndromo recursivo',
        prompt: 'Define `es_palindromo(texto)` recursiva: devuelve `True` si el texto se lee igual al derecho y al revés (`"reconocer"` sí; `"hola"` no). Comprueba los extremos y repite con el interior.',
        starter: '',
        check: all(func('es_palindromo', 1), calls([['es_palindromo("reconocer")', 'True'], ['es_palindromo("hola")', 'False'], ['es_palindromo("")', 'True'], ['es_palindromo("a")', 'True'], ['es_palindromo("abba")', 'True']]), uses('call:es_palindromo')),
        solution: 'def es_palindromo(texto):\n    if len(texto) < 2:\n        return True\n    if texto[0] != texto[-1]:\n        return False\n    return es_palindromo(texto[1:-1])',
        hints: ['Caso base: un texto de 0 o 1 letras es palíndromo.', 'Si el primer y el último carácter difieren, es `False`; si no, mira el texto sin los extremos: `texto[1:-1]`.'],
        explain: 'Cada llamada elimina los dos extremos, así que el problema se encoge de dos en dos hasta quedar vacío o con una letra.',
        commands: ['recursion'],
      }),
    ]),
  ],
  boss: {
    goal: 'Mini calculadora',
    prompt:
      'Define `calcular(operacion, *numeros)` que haga una de estas operaciones sobre todos los números recibidos y **devuelva** el resultado:\n\n- `"suma"` → la suma\n- `"producto"` → el producto\n- `"promedio"` → el promedio (decimal)\n- `"maximo"` → el mayor\n\nPara cualquier otra operación devuelve `None`. Ejemplos: `calcular("suma", 1, 2, 3)` → `6`; `calcular("raro", 1)` → `None`.',
    starter: '',
    check: all(
      func('calcular'),
      calls([
        ['calcular("suma", 1, 2, 3)', '6'],
        ['calcular("producto", 2, 3, 4)', '24'],
        ['calcular("promedio", 4, 6)', '5.0'],
        ['calcular("maximo", 3, 9, 2)', '9'],
        ['calcular("raro", 1)', 'None'],
      ]),
    ),
    solution:
      'def calcular(operacion, *numeros):\n    if operacion == "suma":\n        return sum(numeros)\n    if operacion == "producto":\n        resultado = 1\n        for n in numeros:\n            resultado *= n\n        return resultado\n    if operacion == "promedio":\n        return sum(numeros) / len(numeros)\n    if operacion == "maximo":\n        return max(numeros)\n    return None',
    hints: ['Un parámetro normal y un `*numeros` para el resto.', 'El producto necesita un acumulador que empiece en 1. Cuando ninguna operación coincide, la función termina sin `return` (o devuelve `None`).'],
    explain: 'Combina todo lo de la zona: parámetros posicionales y variables, `return`, decisiones y funciones predefinidas. Un reto extra: reemplaza los `if` por un diccionario de funciones (`{"suma": sum, "maximo": max, ...}`).',
    commands: ['def', 'return', 'args-kwargs'],
  },
});

