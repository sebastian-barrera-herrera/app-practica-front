import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyWorld } from '../pybuild';
import { all, any, calls, cls, expr, func, outHas, stdout, truthy, uses, variable } from '../pycheck';
import { c } from './util';

const VENTAS_TXT = 'pan;10;1.5\nleche;4;2.25\n# comentario\npan;5;1.5\nhuevos;doce;3.0\nleche;2;2.25\n;;\nagua;6;1.0\n';

export const py11 = pyWorld({
  id: 'py11',
  index: 11,
  title: 'Iteradores, generadores y decoradores',
  subtitle: 'Las herramientas que hacen elegante al Python profesional',
  emoji: '🌀',
  color: '#2DD4BF',
  level: 'avanzado',
  intro:
    'Detrás de cada `for` hay un **protocolo** que puedes implementar tú. Con **generadores** producirás datos bajo demanda, sin llenar la memoria; con **decoradores** añadirás comportamiento a funciones sin tocar su código; con **gestores de contexto** garantizarás que los recursos se liberan; y con `functools` e `itertools` ahorrarás código. Son las piezas que separan el código que «funciona» del código **elegante y profesional**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py11-1', { title: 'El protocolo de iteración', summary: 'Iterables, iteradores, iter(), next() y StopIteration', emoji: '🔁', commands: ['iter', 'next', '__next__', 'StopIteration', '__iter__'], minutes: 14 }, [
      learn(
        'Qué hace realmente un for',
        `
Cuando escribes \`for x in cosa:\`, Python hace esto por debajo:

1. Llama a **\`iter(cosa)\`** para obtener un **iterador**.
2. Llama repetidamente a **\`next(iterador)\`** para pedir el siguiente valor.
3. Cuando no quedan valores, el iterador lanza **\`StopIteration\`** y el bucle termina sin error.

Dos conceptos distintos:

- **Iterable**: algo de lo que se puede obtener un iterador (tiene \`__iter__\`): listas, textos, diccionarios, rangos, archivos…
- **Iterador**: el objeto que va entregando valores (tiene \`__next__\`, y su \`__iter__\` devuelve \`self\`). **Es de un solo uso**: cuando se agota, se acabó.

Una lista es *iterable* pero no es un iterador: \`iter(lista)\` te da uno nuevo cada vez.
`,
        '🔁',
      ),
      illus('py-iterator-protocol', 'El protocolo de iteración', 'iter() pide un iterador; next() entrega valores uno a uno hasta que salta StopIteration.'),
      pyDemo('Iterar a mano', [
        ['it = iter(["a", "b", "c"])\nprint(next(it))\nprint(next(it))\nprint(next(it))', 'Tres valores…'],
        pyErr('it = iter([1])\nnext(it)\nnext(it)', '…y al pedir otro: `StopIteration`'),
        ['it = iter([1, 2, 3])\nprint(next(it), next(it))\nprint(list(it))\nprint(list(it))', 'Un iterador se agota: la segunda vez está vacío'],
        ['print(next(iter([]), "vacío"))\nprint(next(iter([5, 6]), "vacío"))', '`next(it, valor)`: valor por defecto en vez de `StopIteration`'],
        ['it = iter(["x", "y"])\nwhile True:\n    try:\n        valor = next(it)\n    except StopIteration:\n        break\n    print(valor)', 'Esto es exactamente lo que hace `for valor in ["x", "y"]`'],
      ]),
      learn(
        'Crear tus propios iteradores',
        `
Para que tu clase sea **iterador** necesita:

- \`__iter__(self)\` → devuelve \`self\`.
- \`__next__(self)\` → devuelve el siguiente valor o lanza \`StopIteration\`.

Para que sea **iterable reutilizable**, basta con \`__iter__\` que devuelva un iterador **nuevo** cada vez (así puedes recorrerla varias veces).

Truco: \`iter(función, centinela)\` llama a la función una y otra vez hasta que devuelva el centinela.
`,
      ),
      pyDemo('Un iterador y un iterable', [
        [c`
class CuentaAtras:
    """Iterador: se agota."""
    def __init__(self, n):
        self.n = n

    def __iter__(self):
        return self

    def __next__(self):
        if self.n <= 0:
            raise StopIteration
        self.n -= 1
        return self.n + 1

c = CuentaAtras(3)
print(list(c), list(c))
`, 'Iterador: la segunda vez ya no queda nada'],
        [c`
class Rango:
    """Iterable: cada for obtiene un iterador nuevo."""
    def __init__(self, a, b):
        self.a, self.b = a, b

    def __iter__(self):
        n = self.a
        while n < self.b:
            yield n
            n += 1

r = Rango(1, 4)
print(list(r), list(r), sum(r))
`, 'Iterable reutilizable'],
        ['from random import Random\nR = Random(1)\nprint(list(iter(lambda: R.randint(1, 3), 2))[:5])', '`iter(f, centinela)` llama a `f()` hasta obtener el centinela'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
it = iter([1, 2, 3])
print(next(it), next(it))
print(list(it))
print(list(it))
`,
        ['1 2\n[1, 2, 3]\n[1, 2, 3]', '1 2\n[3]\n[3]', '1 2\n[]\n[]'],
        'Tras consumir dos valores quedan `[3]`; `list(it)` consume el resto, así que la segunda vez el iterador está agotado y da `[]`.',
      ),
      pyOut('¿Qué imprime?', 'print(next(iter([]), "vacío"))', ['StopIteration', 'None', ''], 'Con un valor por defecto, `next` lo devuelve en lugar de lanzar `StopIteration` cuando no quedan elementos.'),
      mc('¿Qué diferencia hay entre un iterable y un iterador?', ['Ninguna: son sinónimos', 'El iterable produce un iterador con `iter()`; el iterador entrega valores con `next()` y se agota', 'El iterador es siempre una lista', 'El iterable solo existe con generadores'], 1, 'Una lista es iterable (puedes pedir iteradores nuevos); cada iterador recuerda por dónde va y se agota una vez recorrido.'),
      tf('Una lista de Python es un iterador.', false, 'Es un iterable: `iter(lista)` devuelve un iterador distinto cada vez. Una lista no tiene `__next__`.'),
      fill('Completa la excepción que indica que no quedan más valores', 'def __next__(self):\n    if self.n == 0:\n        raise ___\n    ...', ['StopIteration', 'IndexError', 'EOFError', 'KeyError'], ['StopIteration'], '`for` y `list()` capturan `StopIteration` para saber cuándo terminar.'),
      match(
        'Une cada elemento con su función',
        [
          ['iter(x)', 'Obtiene un iterador de un iterable'],
          ['next(it)', 'Pide el siguiente valor'],
          ['StopIteration', 'Señal de que no quedan valores'],
          ['__iter__', 'Método que devuelve un iterador'],
        ],
        'Son las cuatro piezas del protocolo de iteración.',
      ),
      pyPractice({
        goal: 'Cuenta atrás',
        prompt: 'Crea la clase iterador `CuentaAtras(n)` que, recorrida con `for`, entregue `n`, `n-1`, …, `1`. Con `n = 0` no entrega nada.',
        starter: '',
        check: all(cls('CuentaAtras'), calls([['list(CuentaAtras(3))', '[3, 2, 1]'], ['list(CuentaAtras(0))', '[]'], ['[x * 2 for x in CuentaAtras(2)]', '[4, 2]'], ['next(CuentaAtras(5))', '5']])),
        solution: c`
class CuentaAtras:
    def __init__(self, n):
        self.n = n

    def __iter__(self):
        return self

    def __next__(self):
        if self.n <= 0:
            raise StopIteration
        valor = self.n
        self.n -= 1
        return valor
`,
        hints: ['`__iter__` devuelve `self`.', 'En `__next__`, si `self.n <= 0` lanza `StopIteration`; si no, guarda el valor, resta uno y devuélvelo.'],
        explain: 'Con `__iter__` y `__next__` tu objeto funciona en `for`, `list()`, `sum()`, comprensiones… Todo el lenguaje habla este protocolo.',
        commands: ['__next__', 'StopIteration', '__iter__'],
      }),
      pyPractice({
        goal: 'Un iterable reutilizable',
        prompt: 'Crea `Pares(limite)`, un **iterable** (no un iterador) que al recorrerse entregue los números pares desde 0 hasta `limite` (sin incluirlo). Debe poder recorrerse varias veces.',
        starter: '',
        check: all(cls('Pares'), calls([['(lambda p: (list(p), list(p)))(Pares(7))', '([0, 2, 4, 6], [0, 2, 4, 6])'], ['sum(Pares(10))', '20'], ['list(Pares(0))', '[]']])),
        solution: c`
class Pares:
    def __init__(self, limite):
        self.limite = limite

    def __iter__(self):
        return iter(range(0, self.limite, 2))
`,
        hints: ['No hace falta `__next__`: `__iter__` devuelve un iterador **nuevo** cada vez.', '`iter(range(0, self.limite, 2))` ya lo es.'],
        explain: 'Un iterable reutilizable crea un iterador fresco en cada recorrido. Por eso una lista puede recorrerse mil veces.',
        commands: ['iter', '__iter__'],
      }),
      pyPractice({
        goal: 'Fibonacci como iterador',
        prompt: 'Crea el iterador `Fibonacci(limite)` que entregue los números de Fibonacci (0, 1, 1, 2, 3, 5…) **menores que** `limite`.',
        starter: '',
        check: all(cls('Fibonacci'), calls([['list(Fibonacci(30))', '[0, 1, 1, 2, 3, 5, 8, 13, 21]'], ['list(Fibonacci(1))', '[0]'], ['list(Fibonacci(0))', '[]']])),
        solution: c`
class Fibonacci:
    def __init__(self, limite):
        self.limite = limite
        self.a, self.b = 0, 1

    def __iter__(self):
        return self

    def __next__(self):
        if self.a >= self.limite:
            raise StopIteration
        valor = self.a
        self.a, self.b = self.b, self.a + self.b
        return valor
`,
        hints: ['Guarda dos valores consecutivos, `a` y `b`, en el `__init__`.', 'En cada `__next__`: devuelve `a` y avanza con `a, b = b, a + b`.'],
        explain: 'El iterador recuerda su estado (`a`, `b`) entre llamadas. Genera cada número solo cuando se pide: nunca guarda la secuencia completa.',
        commands: ['__next__'],
      }),
      pyCode('Guarda en `primero` el primer elemento de `datos`, o `None` si está vacío, usando `next` con un valor por defecto.', {
        starter: 'datos = []\n',
        check: all(variable('primero', 'None'), uses('call:next')),
        solution: 'datos = []\nprimero = next(iter(datos), None)\n',
        hint: '`next(iter(datos), None)`',
        why: 'Es la forma idiomática de «dame el primero si existe»: sin `if`, sin `IndexError`.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py11-2', { title: 'Generadores', summary: 'yield, evaluación perezosa y expresiones generadoras', emoji: '⏸️', commands: ['yield', 'generadores', 'next'], minutes: 15 }, [
      learn(
        'Una función que se pausa',
        `
Escribir un iterador con una clase es laborioso. Un **generador** lo hace con una simple función: si contiene **\`yield\`**, al llamarla **no se ejecuta**; devuelve un *generador* (un iterador). Cada \`next()\` ejecuta la función hasta el siguiente \`yield\`, entrega ese valor y **se pausa conservando todo su estado**.

\`\`\`
def cuenta_atras(n):
    while n > 0:
        yield n
        n -= 1
\`\`\`

Ventajas:

- **Perezoso**: calcula cada valor solo cuando se pide. Puede representar secuencias **enormes o infinitas** con memoria constante.
- **Sencillo**: el estado (variables locales, posición) lo guarda Python por ti.
- Se **agota** como cualquier iterador.

Hay una versión abreviada: la **expresión generadora** \`(x * x for x in datos)\`: como una comprensión pero con paréntesis y perezosa.
`,
        '⏸️',
      ),
      illus('py-generator-pause', 'Un generador se pausa en cada yield', 'La ejecución se detiene en el yield, entrega un valor y continúa justo ahí con el siguiente next().'),
      pyDemo('Generadores en acción', [
        [c`
def tres():
    print("  empieza")
    yield 1
    print("  entre medias")
    yield 2
    print("  termina")

g = tres()
print("creado, aún no ha corrido nada")
print(next(g))
print(next(g))
`, 'El código solo avanza cuando se pide un valor'],
        ['def cuenta_atras(n):\n    while n > 0:\n        yield n\n        n -= 1\n\nprint(list(cuenta_atras(3)))\nfor x in cuenta_atras(2):\n    print("x =", x)'],
        [c`
from itertools import islice

def naturales():
    n = 1
    while True:
        yield n
        n += 1

print(list(islice(naturales(), 5)))
cuadrados = (n * n for n in naturales())
print(next(cuadrados), next(cuadrados), next(cuadrados))
`, 'Una secuencia **infinita**, sin problema: solo se calcula lo que se pide'],
        ['g = (x * 2 for x in [1, 2, 3])\nprint(sum(g), sum(g))\nprint(sum(x * x for x in range(1, 1001)))', 'Un generador se consume una sola vez'],
      ]),
      learn(
        'yield from, send y return',
        `
- **\`yield from otro\`** delega en otro iterable/generador: emite todos sus valores. El valor de la expresión es lo que **retorna** el subgenerador.
- Un generador puede **recibir** valores: \`x = yield valor\` y el que llama usa \`g.send(dato)\`. (Es la base histórica de las corrutinas y de \`async\`/\`await\`.)
- Un \`return valor\` dentro de un generador termina la iteración; el valor viaja en \`StopIteration.value\`.
- \`g.close()\` lo detiene antes de tiempo y \`g.throw(error)\` le inyecta una excepción.

Úsalos para **canalizaciones** («pipelines»): cada paso es un generador que consume el anterior, procesando un dato a la vez.
`,
      ),
      pyDemo('Delegar, enviar y encadenar', [
        ['def sub():\n    yield "a"\n    yield "b"\n    return "fin"\n\ndef principal():\n    r = yield from sub()\n    yield r\n    yield from [1, 2]\n\nprint(list(principal()))'],
        [c`
def acumulador():
    total = 0
    while True:
        x = yield total
        total += x

g = acumulador()
next(g)
print(g.send(10), g.send(5), g.send(1))
g.close()
`, '`send` entrega un valor al `yield` y recibe el siguiente'],
        [c`
def leer(lineas):
    for l in lineas:
        yield l.strip()

def no_vacias(it):
    for l in it:
        if l:
            yield l

def mayusculas(it):
    for l in it:
        yield l.upper()

texto = ["  hola ", "", " mundo", "  "]
print(list(mayusculas(no_vacias(leer(texto)))))
`, 'Un «pipeline»: cada línea atraviesa todos los pasos antes de procesar la siguiente'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
def g():
    print("a")
    yield 1
    print("b")
    yield 2

it = g()
print("inicio")
print(next(it))
print(next(it))
`,
        ['a\ninicio\n1\nb\n2', 'inicio\na\nb\n1\n2', 'a\nb\ninicio\n1\n2'],
        'Llamar a `g()` no ejecuta nada. «inicio» se imprime primero; `next` ejecuta hasta el primer `yield` (imprime «a» y entrega 1), y el siguiente `next` sigue (imprime «b» y entrega 2).',
      ),
      pyOut('¿Qué imprime?', 'g = (x * 2 for x in [1, 2, 3])\nprint(sum(g), sum(g))', ['12 12', '6 6', '12 6'], 'La primera `sum` consume el generador (2 + 4 + 6 = 12). La segunda lo encuentra agotado y suma 0.'),
      mc('¿Cuál es la principal ventaja de un generador frente a una lista?', ['Es más rápido siempre', 'Produce los valores bajo demanda, sin guardarlos todos en memoria', 'Se puede indexar con `g[0]`', 'Se puede recorrer varias veces'], 1, 'Un generador es perezoso: calcula cada elemento cuando se pide. Perfecto para datos enormes o infinitos.'),
      tf('Al llamar a una función generadora, su código se ejecuta inmediatamente hasta el primer `yield`.', false, 'Llamarla solo crea el generador. El código empieza a ejecutarse con el primer `next()` (o al recorrerlo con un `for`).'),
      fill('Completa la palabra clave que entrega un valor y pausa la función', 'def numeros():\n    for n in range(3):\n        ___ n', ['yield', 'return', 'print', 'next'], ['yield'], '`return` terminaría la función; `yield` entrega un valor y se pausa para continuar después.'),
      match(
        'Une cada elemento con su significado',
        [
          ['yield valor', 'Entrega un valor y pausa la función'],
          ['yield from sub', 'Emite todos los valores de otro iterable'],
          ['g.send(x)', 'Envía un valor al yield donde está pausado'],
          ['(x for x in it)', 'Expresión generadora perezosa'],
        ],
        'Cuatro formas de producir o consumir valores bajo demanda.',
      ),
      pyPractice({
        goal: 'Números pares',
        prompt: 'Escribe el generador `pares(limite)` que entregue los números pares desde 0 hasta `limite` (sin incluirlo).',
        starter: '',
        check: all(func('pares', 1), uses('Yield'), calls([['list(pares(10))', '[0, 2, 4, 6, 8]'], ['list(pares(1))', '[0]'], ['list(pares(0))', '[]'], ['type(pares(3)).__name__', "'generator'"]])),
        solution: 'def pares(limite):\n    n = 0\n    while n < limite:\n        yield n\n        n += 2\n',
        hints: ['Usa un bucle `while` con una variable que empiece en 0.', 'Haz `yield n` y suma 2 en cada vuelta.'],
        explain: 'Tu función ya no devuelve una lista: devuelve un generador que produce los pares cuando se piden.',
        commands: ['yield'],
      }),
      pyPractice({
        goal: 'Fibonacci infinito',
        prompt: 'Escribe el generador **infinito** `fib()` que entregue 0, 1, 1, 2, 3, 5, 8… para siempre.',
        starter: '',
        check: all(func('fib', 0), uses('Yield'), calls([['list(__import__("itertools").islice(fib(), 10))', '[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]'], ['next(fib())', '0']])),
        solution: 'def fib():\n    a, b = 0, 1\n    while True:\n        yield a\n        a, b = b, a + b\n',
        hints: ['Un `while True` con `yield a` dentro.', 'Avanza con `a, b = b, a + b`.'],
        explain: 'Un generador puede ser infinito porque nunca calcula todos los valores a la vez. Quien lo usa decide cuántos pide (con `islice`, `break`…).',
        commands: ['yield', 'generadores'],
      }),
      pyPractice({
        goal: 'Lectura por bloques',
        prompt: 'Escribe el generador `bloques(datos, n)` que entregue listas consecutivas de `n` elementos (la última puede ser más corta).',
        starter: '',
        check: all(func('bloques', 2), calls([['list(bloques([1, 2, 3, 4, 5, 6, 7], 3))', '[[1, 2, 3], [4, 5, 6], [7]]'], ['list(bloques([], 2))', '[]'], ['list(bloques("abcd", 2))', "['ab', 'cd']"]])),
        solution: 'def bloques(datos, n):\n    for i in range(0, len(datos), n):\n        yield datos[i:i + n]\n',
        hints: ['`range(0, len(datos), n)` da el inicio de cada bloque.', 'Cada bloque es la rebanada `datos[i:i + n]`.'],
        explain: 'Procesar datos «por trozos» es habitual (paginar, enviar por red, leer archivos grandes). Un generador lo hace sin cargar todo a la vez.',
        commands: ['yield'],
      }),
      pyCode('Con una **expresión generadora** y `sum`, guarda en `total` la suma de los cuadrados de los números impares menores que 10.', {
        check: all(variable('total', '165'), uses('GeneratorExp')),
        solution: 'total = sum(x * x for x in range(10) if x % 2)\n',
        hint: '`sum(x * x for x in range(10) if x % 2)`',
        why: '1 + 9 + 25 + 49 + 81 = 165. Sin crear ninguna lista intermedia.',
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py11-3', { title: 'Closures y decoradores', summary: 'Funciones que envuelven funciones: @decorador y functools.wraps', emoji: '🎁', commands: ['decoradores', 'functools.wraps', 'closures'], minutes: 16 }, [
      learn(
        'Funciones que devuelven funciones',
        `
Las funciones son objetos: se pasan como argumentos, se guardan en variables y se **devuelven**. Una función interna que recuerda variables de la externa es un **closure**:

\`\`\`
def multiplicador(k):
    def multiplicar(x):
        return x * k          # recuerda k
    return multiplicar

triple = multiplicador(3)
print(triple(5))              # 15
\`\`\`

Un **decorador** es una función que **recibe una función y devuelve otra** (normalmente la envuelve añadiendo comportamiento: registrar, medir, validar, cachear…). La sintaxis \`@decorador\` es un atajo:

\`\`\`
@decorador
def f(): ...
# equivale a:   f = decorador(f)
\`\`\`
`,
        '🎁',
      ),
      illus('py-decorator-wrap', 'Un decorador envuelve la función', 'La llamada pasa primero por el envoltorio (que puede actuar antes y después) y luego llega a la función original.'),
      pyDemo('Tu primer decorador', [
        [c`
def registrar(f):
    def envoltorio(*args, **kwargs):
        print(f"→ llamando a {f.__name__}{args}")
        resultado = f(*args, **kwargs)
        print(f"← devolvió {resultado}")
        return resultado
    return envoltorio

@registrar
def sumar(a, b):
    return a + b

sumar(2, 3)
print(sumar.__name__)
`, 'Ojo: el nombre de la función decorada es ahora el del envoltorio'],
        [c`
from functools import wraps

def registrar(f):
    @wraps(f)
    def envoltorio(*args, **kwargs):
        print("llamando a", f.__name__)
        return f(*args, **kwargs)
    return envoltorio

@registrar
def sumar(a, b):
    """Suma dos números."""
    return a + b

print(sumar(1, 2), sumar.__name__, sumar.__doc__)
`, '`@wraps(f)` conserva el nombre, la documentación y otros datos'],
      ]),
      learn(
        'Decoradores con argumentos y apilados',
        `
- **Con argumentos**: necesitas un nivel más. \`@repetir(3)\` primero **llama** a \`repetir(3)\`, que devuelve el decorador real:

\`\`\`
def repetir(veces):
    def decorador(f):
        @wraps(f)
        def envoltorio(*a, **k):
            for _ in range(veces):
                resultado = f(*a, **k)
            return resultado
        return envoltorio
    return decorador
\`\`\`

- **Apilados**: \`@a\` encima de \`@b\` equivale a \`a(b(f))\`: se aplican de **abajo hacia arriba**.
- **Clases** también pueden decorar: un objeto con \`__call__\` que guarda estado (p. ej. un contador de llamadas).
`,
      ),
      pyDemo('Con argumentos, apilados y con estado', [
        [c`
from functools import wraps

def repetir(veces):
    def decorador(f):
        @wraps(f)
        def envoltorio(*a, **k):
            return [f(*a, **k) for _ in range(veces)]
        return envoltorio
    return decorador

@repetir(3)
def saludo(nombre):
    return f"hola {nombre}"

print(saludo("Ana"))
`],
        [c`
def negrita(f):
    return lambda: "<b>" + f() + "</b>"

def cursiva(f):
    return lambda: "<i>" + f() + "</i>"

@negrita
@cursiva
def texto():
    return "hola"

print(texto())
`, 'Se aplican de abajo arriba: primero `cursiva`, luego `negrita`'],
        [c`
import functools

class Contador:
    def __init__(self, f):
        functools.update_wrapper(self, f)
        self.f = f
        self.llamadas = 0

    def __call__(self, *a, **k):
        self.llamadas += 1
        return self.f(*a, **k)

@Contador
def doble(x):
    return x * 2

doble(1)
doble(2)
print(doble.llamadas, doble.__name__)
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
def deco(f):
    def w(*a, **k):
        print("antes")
        r = f(*a, **k)
        print("después")
        return r
    return w

@deco
def hola(n):
    print("hola", n)
    return n * 2

print(hola(4))
print(hola.__name__)
`,
        ['antes\nhola 4\ndespués\n8\nhola', 'hola 4\nantes\ndespués\n8\nw', 'antes\nhola 4\ndespués\n4\nw'],
        'El envoltorio imprime «antes», llama a la función original (imprime «hola 4» y devuelve 8), imprime «después» y devuelve 8. Como no usamos `@wraps`, `hola.__name__` es `"w"`.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
def a(f):
    return lambda: "A" + f()

def b(f):
    return lambda: "B" + f()

@a
@b
def x():
    return "x"

print(x())
`,
        ['BAx', 'Ax', 'xBA'],
        'Los decoradores se aplican de abajo arriba: `b` envuelve a `x` y `a` envuelve el resultado. Al llamar, el exterior (`a`) añade «A» y delega en `b` que añade «B».',
      ),
      mc('¿A qué equivale escribir `@deco` sobre `def f(): ...`?', ['`f = deco`', '`f = deco(f)`', '`deco = f(deco)`', '`deco(f())`'], 1, 'El decorador recibe la función ya definida y lo que devuelve la reemplaza con el mismo nombre.'),
      tf('Sin `functools.wraps`, una función decorada pierde su `__name__` y su documentación originales.', true, 'Porque el nombre que queda es el del envoltorio. `@wraps(f)` copia el nombre, el docstring y otros metadatos.'),
      fill('Completa el decorador que conserva los metadatos', 'from functools import ___\n\ndef deco(f):\n    @wraps(f)\n    def w(*a, **k):\n        return f(*a, **k)\n    return w', ['wraps', 'partial', 'cache', 'reduce'], ['wraps'], '`wraps` es un decorador que se aplica al envoltorio.'),
      match(
        'Une cada situación con su patrón',
        [
          ['@deco', 'Decorador simple: deco(f)'],
          ['@deco(3)', 'Decorador con argumentos: deco(3)(f)'],
          ['@a sobre @b', 'a(b(f)): se aplican de abajo arriba'],
          ['functools.wraps', 'Conserva el nombre y la documentación'],
        ],
        'Conocer estos cuatro patrones te permite leer casi cualquier decorador.',
      ),
      pyPractice({
        goal: 'Contar llamadas',
        prompt: 'Escribe el decorador `contar` que cuente cuántas veces se llama a la función decorada: el contador debe estar en el atributo `llamadas` de la función. Conserva el nombre original con `wraps`. Deja el programa de abajo tal cual.',
        starter: c`
# Escribe aquí el decorador contar

@contar
def saludar(nombre):
    return f"Hola, {nombre}"

saludar("Ana")
saludar("Luis")
print(saludar.llamadas)
print(saludar.__name__)
` + '\n',
        check: all(func('contar', 1), stdout('2\nsaludar'), uses('decorator:contar')),
        solution: c`
from functools import wraps

def contar(f):
    @wraps(f)
    def envoltorio(*args, **kwargs):
        envoltorio.llamadas += 1
        return f(*args, **kwargs)
    envoltorio.llamadas = 0
    return envoltorio

@contar
def saludar(nombre):
    return f"Hola, {nombre}"

saludar("Ana")
saludar("Luis")
print(saludar.llamadas)
print(saludar.__name__)
`,
        hints: ['Las funciones también admiten atributos: `envoltorio.llamadas = 0`.', 'Dentro del envoltorio suma 1 y llama a la función original con `*args, **kwargs`.'],
        explain: 'Un decorador puede añadir **estado** a la función. Aquí el contador viaja con ella.',
        commands: ['decoradores', 'functools.wraps'],
      }),
      pyPractice({
        goal: 'Reintentar',
        prompt: 'Escribe la **fábrica de decoradores** `reintentar(veces)`: si la función lanza una excepción, la vuelve a llamar, hasta `veces` intentos en total; si el último intento también falla, deja subir esa excepción. Deja el programa de abajo tal cual.',
        starter: c`
# Escribe aquí reintentar(veces)

intentos = 0

@reintentar(3)
def inestable():
    global intentos
    intentos += 1
    if intentos < 3:
        raise ValueError("falló")
    return "ok"

print(inestable(), intentos)

@reintentar(2)
def siempre():
    raise RuntimeError("nunca")

try:
    siempre()
except RuntimeError as e:
    print("agotado:", e)
` + '\n',
        check: all(func('reintentar', 1), stdout('ok 3\nagotado: nunca')),
        solution: c`
from functools import wraps

def reintentar(veces):
    def decorador(f):
        @wraps(f)
        def envoltorio(*a, **k):
            for intento in range(1, veces + 1):
                try:
                    return f(*a, **k)
                except Exception:
                    if intento == veces:
                        raise
        return envoltorio
    return decorador

intentos = 0

@reintentar(3)
def inestable():
    global intentos
    intentos += 1
    if intentos < 3:
        raise ValueError("falló")
    return "ok"

print(inestable(), intentos)

@reintentar(2)
def siempre():
    raise RuntimeError("nunca")

try:
    siempre()
except RuntimeError as e:
    print("agotado:", e)
`,
        hints: ['Tres niveles: `reintentar(veces)` → `decorador(f)` → `envoltorio(*a, **k)`.', 'Dentro del envoltorio, un bucle con `try: return f(...)`; en el último intento haz `raise`.'],
        explain: 'Un decorador con argumentos es una función que devuelve un decorador. Reintentar operaciones inestables (red, disco) es un uso muy real.',
        commands: ['decoradores', 'closures'],
      }),
      pyPractice({
        goal: 'Memoización casera',
        prompt: 'Escribe el decorador `memo` que guarde en un diccionario los resultados ya calculados (según los argumentos) para no repetir cálculos. Con él, el `fib(30)` recursivo de abajo solo debe ejecutarse 31 veces.',
        starter: c`
# Escribe aquí el decorador memo

llamadas = 0

@memo
def fib(n):
    global llamadas
    llamadas += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(30), llamadas)
` + '\n',
        check: all(func('memo', 1), stdout('832040 31')),
        solution: c`
from functools import wraps

def memo(f):
    cache = {}
    @wraps(f)
    def envoltorio(*args):
        if args not in cache:
            cache[args] = f(*args)
        return cache[args]
    return envoltorio

llamadas = 0

@memo
def fib(n):
    global llamadas
    llamadas += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(30), llamadas)
`,
        hints: ['El diccionario `cache` vive en el closure, fuera del envoltorio.', 'Usa la tupla de argumentos `args` como clave.'],
        explain: 'Sin memoización `fib(30)` haría más de un millón de llamadas; con ella, 31. En la práctica usarías `functools.cache`, que hace justo esto.',
        commands: ['decoradores', 'closures'],
      }),
      pyCode('Corrige el decorador para que `f.__name__` siga siendo `"f"` después de decorar.', {
        starter: c`
def deco(func):
    def w(*a, **k):
        return func(*a, **k)
    return w

@deco
def f():
    return 1
` + '\n',
        check: all(expr('f.__name__', "'f'"), expr('f()', '1')),
        solution: c`
from functools import wraps

def deco(func):
    @wraps(func)
    def w(*a, **k):
        return func(*a, **k)
    return w

@deco
def f():
    return 1
`,
        hint: 'Importa `wraps` de `functools` y decora el envoltorio con `@wraps(func)`.',
        why: '`wraps` copia `__name__`, `__doc__`… de la función original al envoltorio.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py11-4', { title: 'Gestores de contexto', summary: 'with, __enter__/__exit__ y contextlib', emoji: '🚪', commands: ['__enter__', '__exit__', 'contextlib.contextmanager', 'contextlib.suppress', 'with'], minutes: 14 }, [
      learn(
        'with: limpieza garantizada',
        `
Ya conoces \`with open(...) as f:\`. Detrás hay un **gestor de contexto**: un objeto con dos métodos especiales:

- **\`__enter__(self)\`**: se ejecuta al entrar en el bloque; lo que devuelve se asigna tras \`as\`.
- **\`__exit__(self, tipo, valor, traza)\`**: se ejecuta **siempre** al salir (con o sin error). Recibe la excepción si hubo; si devuelve un valor **verdadero**, la excepción queda **suprimida**.

Sirve para cualquier pareja «preparar / limpiar»: archivos, bloqueos, conexiones, carpetas temporales, transacciones, cambios temporales de configuración…
`,
        '🚪',
      ),
      pyDemo('Un gestor de contexto', [
        [c`
class Seccion:
    def __init__(self, nombre):
        self.nombre = nombre

    def __enter__(self):
        print("entra", self.nombre)
        return self

    def __exit__(self, tipo, valor, traza):
        print("sale", self.nombre, "| error:", tipo.__name__ if tipo else None)
        return False

with Seccion("A") as s:
    print("dentro de", s.nombre)

try:
    with Seccion("B"):
        raise ValueError("boom")
except ValueError:
    print("el error siguió subiendo")
`, '`__exit__` corre siempre; devolver `False` deja subir el error'],
        [c`
class Silencioso:
    def __enter__(self):
        return self

    def __exit__(self, tipo, valor, traza):
        return tipo is ZeroDivisionError

with Silencioso():
    1 / 0
print("el programa continúa")
`, 'Si `__exit__` devuelve `True`, la excepción se suprime'],
      ]),
      learn(
        'contextlib: gestores sin escribir clases',
        `
Con **\`@contextmanager\`** conviertes un generador en gestor de contexto: lo que hay **antes del \`yield\`** es el \`__enter__\`, el valor del \`yield\` va a \`as\`, y lo de **después** es el \`__exit__\`. Pon el \`yield\` dentro de \`try/finally\` para que la limpieza ocurra siempre.

Otras herramientas de \`contextlib\`:

- **\`suppress(Error, …)\`**: ignora esas excepciones.
- **\`redirect_stdout(destino)\`**: redirige \`print\` temporalmente.
- **\`ExitStack\`**: apila un número variable de gestores o *callbacks*.
- **\`nullcontext\`**: un gestor que no hace nada.
`,
      ),
      pyDemo('contextlib', [
        [c`
from contextlib import contextmanager

@contextmanager
def etiqueta(nombre):
    print(f"<{nombre}>")
    try:
        yield nombre.upper()
    finally:
        print(f"</{nombre}>")

with etiqueta("b") as v:
    print("contenido", v)

try:
    with etiqueta("i"):
        raise KeyError("x")
except KeyError:
    print("error tras cerrar")
`, 'El \`finally\` garantiza el cierre incluso con errores'],
        [c`
import io
from contextlib import suppress, redirect_stdout

d = {"a": 1}
with suppress(KeyError):
    del d["z"]
print(d)

buf = io.StringIO()
with redirect_stdout(buf):
    print("esto no sale por pantalla")
print(repr(buf.getvalue()))
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
class C:
    def __enter__(self):
        print("entra")
        return self

    def __exit__(self, t, v, tb):
        print("sale", t.__name__ if t else None)
        return True

with C():
    print("dentro")
    raise ValueError
print("después")
`,
        ['entra\ndentro\nsale None\ndespués', 'dentro\nentra\nsale ValueError\ndespués', 'entra\ndentro\nsale ValueError'],
        '`__exit__` recibe el tipo de la excepción (`ValueError`) y, al devolver `True`, la suprime: el programa continúa y se imprime «después».',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
from contextlib import contextmanager

@contextmanager
def caja():
    print("abrir")
    try:
        yield "dato"
    finally:
        print("cerrar")

with caja() as d:
    print(d)
`,
        ['abrir\ncerrar\ndato', 'dato\nabrir\ncerrar', 'abrir\ndato'],
        'Primero corre el código previo al `yield` («abrir»), luego el cuerpo del `with` (imprime «dato») y al salir el código posterior («cerrar»).',
      ),
      mc('¿Qué ocurre si `__exit__` devuelve `True`?', ['Se repite el bloque `with`', 'La excepción que haya ocurrido se suprime', 'El programa termina', 'Se llama otra vez a `__enter__`'], 1, 'Devolver un valor verdadero significa «ya he gestionado el error»: Python no lo propaga.'),
      tf('El código de `__exit__` se ejecuta solo si el bloque `with` terminó sin errores.', false, 'Se ejecuta **siempre**, haya error o no. Por eso es el lugar ideal para liberar recursos.'),
      fill('Completa para guardar el objeto del gestor en la variable `f`', 'with open("datos.txt") ___ f:\n    texto = f.read()', ['as', 'in', 'is', '='], ['as'], 'Lo que devuelve `__enter__` se asigna con `as`.'),
      match(
        'Une cada herramienta con su función',
        [
          ['__enter__', 'Prepara el recurso al entrar al bloque'],
          ['__exit__', 'Limpia siempre al salir; puede suprimir el error'],
          ['@contextmanager', 'Crea un gestor a partir de un generador'],
          ['suppress(KeyError)', 'Ignora esa excepción dentro del bloque'],
        ],
        'Todas sirven al mismo objetivo: que la limpieza no dependa de acordarse.',
      ),
      pyPractice({
        goal: 'Un cronómetro',
        prompt: 'Crea el gestor de contexto `Cronometro`: al salir del bloque `with` deja en el atributo `duracion` el tiempo transcurrido en segundos (mide con `time.perf_counter()`). Deja el programa de abajo tal cual.',
        starter: c`
import time

# Escribe aquí la clase Cronometro

with Cronometro() as c:
    time.sleep(1.5)
print(round(c.duracion, 1))
` + '\n',
        check: all(cls('Cronometro'), stdout('1.5')),
        solution: c`
import time

class Cronometro:
    def __enter__(self):
        self.inicio = time.perf_counter()
        return self

    def __exit__(self, tipo, valor, traza):
        self.duracion = time.perf_counter() - self.inicio
        return False

with Cronometro() as c:
    time.sleep(1.5)
print(round(c.duracion, 1))
`,
        hints: ['En `__enter__` guarda `time.perf_counter()` y devuelve `self`.', 'En `__exit__` calcula la diferencia y guárdala en `self.duracion`.'],
        explain: 'Medir cuánto tarda un bloque es el ejemplo clásico: la medida se cierra siempre, aunque el bloque falle.',
        commands: ['__enter__', '__exit__'],
      }),
      pyPractice({
        goal: 'Una sección con registro',
        prompt: 'Con `@contextmanager`, escribe `seccion(nombre)` que imprima `[inicio nombre]` al entrar y `[fin nombre]` al salir, **incluso si el bloque lanza un error**. Deja el programa de abajo tal cual.',
        starter: c`
# Escribe aquí seccion(nombre)

with seccion("carga"):
    print("trabajando")

try:
    with seccion("proceso"):
        raise ValueError("fallo")
except ValueError as e:
    print("capturado:", e)
` + '\n',
        check: all(func('seccion', 1), stdout('[inicio carga]\ntrabajando\n[fin carga]\n[inicio proceso]\n[fin proceso]\ncapturado: fallo'), uses('decorator:contextmanager')),
        solution: c`
from contextlib import contextmanager

@contextmanager
def seccion(nombre):
    print(f"[inicio {nombre}]")
    try:
        yield
    finally:
        print(f"[fin {nombre}]")

with seccion("carga"):
    print("trabajando")

try:
    with seccion("proceso"):
        raise ValueError("fallo")
except ValueError as e:
    print("capturado:", e)
`,
        hints: ['Imprime «inicio», haz `yield` y después imprime «fin».', 'Pon el `yield` dentro de `try` y el «fin» en `finally`.'],
        explain: 'El `finally` alrededor del `yield` es lo que garantiza la limpieza cuando el cuerpo del `with` falla.',
        commands: ['contextlib.contextmanager'],
      }),
      pyPractice({
        goal: 'Transacción',
        prompt: 'Crea el gestor `Transaccion(lista)`: si el bloque termina con un error, la lista debe **volver a su contenido original** (el error sigue subiendo); si termina bien, los cambios se conservan. Deja el programa de abajo tal cual.',
        starter: c`
# Escribe aquí la clase Transaccion

datos = [1, 2]
try:
    with Transaccion(datos):
        datos.append(3)
        raise ValueError("fallo")
except ValueError:
    pass
print(datos)
with Transaccion(datos):
    datos.append(9)
print(datos)
` + '\n',
        check: all(cls('Transaccion'), stdout('[1, 2]\n[1, 2, 9]')),
        solution: c`
class Transaccion:
    def __init__(self, lista):
        self.lista = lista

    def __enter__(self):
        self.copia = list(self.lista)
        return self.lista

    def __exit__(self, tipo, valor, traza):
        if tipo is not None:
            self.lista[:] = self.copia
        return False

datos = [1, 2]
try:
    with Transaccion(datos):
        datos.append(3)
        raise ValueError("fallo")
except ValueError:
    pass
print(datos)
with Transaccion(datos):
    datos.append(9)
print(datos)
`,
        hints: ['En `__enter__` guarda una copia: `list(self.lista)`.', 'En `__exit__`, si `tipo` no es `None`, restaura con `self.lista[:] = self.copia`.'],
        explain: 'Es el mismo patrón que las transacciones de las bases de datos: o todo se aplica, o nada.',
        commands: ['__exit__'],
      }),
      pyCode('Guarda en `d` el diccionario `{"a": 1}` tras intentar borrar la clave `"x"` (que no existe) y después la `"b"`, ignorando el error con `suppress`.', {
        starter: 'from contextlib import suppress\nd = {"a": 1, "b": 2}\n',
        check: all(expr('d', "{'a': 1}"), uses('call:suppress')),
        solution: 'from contextlib import suppress\nd = {"a": 1, "b": 2}\nwith suppress(KeyError):\n    del d["x"]\nwith suppress(KeyError):\n    del d["b"]\n',
        hint: 'Usa un `with suppress(KeyError):` por cada borrado.',
        why: '`suppress` es una forma compacta de `try/except X: pass`: ignora ese error y sigue.',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py11-5', { title: 'functools e itertools', summary: 'lru_cache, partial, reduce, groupby y otras herramientas', emoji: '🧰', commands: ['functools.lru_cache', 'functools.partial', 'functools.reduce', 'itertools.islice', 'itertools.groupby', 'itertools.pairwise', 'itertools.accumulate'], minutes: 15 }, [
      learn(
        'functools: herramientas para funciones',
        `
- **\`lru_cache\` / \`cache\`**: memoriza resultados (decorador). \`f.cache_info()\` da aciertos y fallos.
- **\`partial(f, ...)\`**: «congela» algunos argumentos y crea una función nueva.
- **\`reduce(f, datos, inicial)\`**: pliega una secuencia a un solo valor aplicando \`f\` acumulativamente.
- **\`wraps\`**: conserva metadatos en decoradores.
- **\`total_ordering\`**: completa las comparaciones desde \`__eq__\` y \`__lt__\`.
- **\`cached_property\`**: propiedad que se calcula una vez.
- **\`singledispatch\`**: una función con comportamiento distinto según el tipo del primer argumento.
`,
        '🧰',
      ),
      pyDemo('functools', [
        [c`
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(80))
print(fib.cache_info())
`, 'De cálculo exponencial a lineal con una línea'],
        ['from functools import partial, reduce\n\nbinario = partial(int, base=2)\nprint(binario("101"), binario("1000"))\nprint(reduce(lambda a, b: a * b, [1, 2, 3, 4, 5]))\nprint(reduce(lambda a, b: a + b, [], 0))', '`reduce` con un valor inicial funciona también con listas vacías'],
        [c`
from functools import singledispatch, cached_property

@singledispatch
def formatear(x):
    return f"objeto {x}"

@formatear.register
def _(x: int):
    return f"entero {x}"

@formatear.register(list)
def _(x):
    return f"lista de {len(x)}"

print(formatear(5), formatear([1, 2]), formatear("a"))

class Dato:
    @cached_property
    def pesado(self):
        print("calculando…")
        return 42

d = Dato()
print(d.pesado, d.pesado)
`],
      ]),
      learn(
        'itertools: más allá de lo básico',
        `
Además de \`product\`, \`permutations\`, \`combinations\`, \`chain\` y \`groupby\` (zona 8), tienes:

| Función | Qué hace |
|---|---|
| \`islice(it, n)\` | Primeros \`n\` elementos de cualquier iterador |
| \`accumulate(xs, f)\` | Resultados acumulados (sumas, máximos…) |
| \`pairwise(xs)\` | Parejas consecutivas: \`(a,b), (b,c), …\` |
| \`takewhile(p, xs)\` / \`dropwhile(p, xs)\` | Tomar / saltar mientras se cumpla \`p\` |
| \`starmap(f, tuplas)\` | Aplica \`f(*tupla)\` a cada tupla |
| \`compress(xs, selectores)\` | Filtra por una lista de booleanos |
| \`tee(it, n)\` | Copia independiente de un iterador |
| \`batched(xs, n)\` | Bloques de tamaño \`n\` (3.12+) |
| \`groupby(xs, clave)\` | Agrupa elementos **consecutivos** con la misma clave |

Todos son **perezosos**: se pueden encadenar sin crear listas intermedias.
`,
      ),
      pyDemo('itertools', [
        ['from itertools import accumulate, pairwise, takewhile, dropwhile, starmap, compress, batched\n\nprint(list(accumulate([1, 2, 3, 4])), list(accumulate([3, 1, 4, 1, 5], max)))\nprint(list(pairwise([1, 4, 9, 16])))\nprint(list(takewhile(lambda x: x < 3, [1, 2, 3, 1])), list(dropwhile(lambda x: x < 3, [1, 2, 3, 1])))\nprint(list(starmap(pow, [(2, 3), (3, 2)])), list(compress("abcd", [1, 0, 1, 0])))\nprint(list(batched(range(7), 3)))'],
        ['from itertools import groupby\n\ntexto = "aaabccdd"\nprint([(k, len(list(g))) for k, g in groupby(texto)])\nprint("".join(f"{k}{len(list(g))}" for k, g in groupby(texto)))', 'Compresión «run-length»'],
      ]),
      pyOut('¿Qué imprime?', 'from functools import partial\n\nbinario = partial(int, base=2)\nprint(binario("11"), binario("1000"))', ['11 1000', '3 1000', '2 3'], '`partial(int, base=2)` equivale a `int(texto, base=2)`: «11» en binario es 3 y «1000» es 8.'),
      pyOut(
        '¿Qué imprime?',
        c`
from functools import lru_cache

@lru_cache(maxsize=None)
def f(n):
    print("calculo", n)
    return n * n

print(f(3), f(3), f(4))
`,
        ['calculo 3\ncalculo 3\ncalculo 4\n9 9 16', '9 9 16\ncalculo 3\ncalculo 4', 'calculo 3\n9 9 16\ncalculo 4'],
        'Los argumentos del `print` se evalúan antes de imprimir: `f(3)` calcula (y avisa), el segundo `f(3)` sale de la caché sin avisar, `f(4)` calcula. Luego se imprime «9 9 16».',
      ),
      mc('¿Para qué sirve `functools.partial`?', ['Para ejecutar una función en parte', 'Para crear una función nueva con algunos argumentos ya fijados', 'Para dividir una lista', 'Para medir el tiempo'], 1, '`partial(int, base=2)` te da una función que ya lleva `base=2` puesto.'),
      tf('`itertools.groupby` agrupa todos los elementos iguales aunque no estén seguidos.', false, 'Solo agrupa elementos **consecutivos**. Para agrupar de verdad, ordena antes los datos por la misma clave.'),
      fill('Completa para obtener las 5 primeras posiciones de un generador infinito', 'from itertools import ___\n\nprimeros = list(islice(naturales(), 5))', ['islice', 'chain', 'count', 'cycle'], ['islice'], '`islice` recorta cualquier iterador, incluso infinito.'),
      match(
        'Une cada herramienta con lo que hace',
        [
          ['lru_cache', 'Memoriza los resultados de una función'],
          ['partial', 'Fija argumentos y crea una función nueva'],
          ['reduce', 'Pliega una secuencia a un solo valor'],
          ['pairwise', 'Entrega las parejas consecutivas'],
        ],
        'Pequeñas piezas que, combinadas, hacen el código mucho más corto.',
      ),
      pyPractice({
        goal: 'Producto con reduce',
        prompt: 'Escribe `producto(xs)` que devuelva el producto de todos los números de la lista usando `functools.reduce` (para una lista vacía, 1).',
        starter: 'from functools import reduce\n',
        check: all(func('producto', 1), uses('call:reduce'), calls([['producto([1, 2, 3, 4])', '24'], ['producto([5])', '5'], ['producto([])', '1']])),
        solution: 'from functools import reduce\n\ndef producto(xs):\n    return reduce(lambda a, b: a * b, xs, 1)\n',
        hints: ['`reduce(función, secuencia, valor_inicial)`.', 'El valor inicial 1 hace que la lista vacía dé 1.'],
        explain: '`reduce` pliega la secuencia: ((1·a)·b)·c… El valor inicial es el elemento neutro de la operación.',
        commands: ['functools.reduce'],
      }),
      pyPractice({
        goal: 'Fibonacci con caché',
        prompt: 'Haz que `fib(n)` (versión recursiva) sea instantáneo para valores grandes usando `functools.lru_cache` (o `cache`) como decorador.',
        starter: 'def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n',
        check: all(expr('fib(80)', '23416728348467685'), any(uses('decorator:lru_cache'), uses('decorator:functools.lru_cache'), uses('decorator:cache'), uses('decorator:functools.cache'))),
        solution: 'from functools import lru_cache\n\n@lru_cache(maxsize=None)\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)\n',
        hints: ['Importa `lru_cache` de `functools`.', 'Decora la función con `@lru_cache(maxsize=None)`.'],
        explain: 'Sin caché, `fib(80)` tardaría siglos; con ella, microsegundos. Una línea, un cambio de complejidad exponencial a lineal.',
        commands: ['functools.lru_cache'],
      }),
      pyPractice({
        goal: 'Saltos entre lecturas',
        prompt: 'Con `itertools.pairwise`, guarda en `saltos` la lista de diferencias entre cada lectura y la anterior.',
        starter: 'from itertools import pairwise\nlecturas = [10, 12, 9, 15, 15]\n',
        check: all(variable('saltos', '[2, -3, 6, 0]'), uses('call:pairwise')),
        solution: 'from itertools import pairwise\nlecturas = [10, 12, 9, 15, 15]\nsaltos = [b - a for a, b in pairwise(lecturas)]\n',
        hints: ['`pairwise(lecturas)` entrega `(10, 12), (12, 9), …`.', 'Resta cada pareja en una comprensión: `b - a`.'],
        explain: '`pairwise` evita los índices (`lecturas[i + 1] - lecturas[i]`) y funciona con cualquier iterable.',
        commands: ['itertools.pairwise'],
      }),
      pyPractice({
        goal: 'Compresión por repeticiones',
        prompt: 'Escribe `comprimir(texto)` que sustituya cada racha de letras iguales por la letra seguida de su número de repeticiones (`"aaabcc"` → `"a3b1c2"`). Usa `itertools.groupby`.',
        starter: 'from itertools import groupby\n',
        check: all(func('comprimir', 1), uses('call:groupby'), calls([['comprimir("aaabccdd")', "'a3b1c2d2'"], ['comprimir("x")', "'x1'"], ['comprimir("")', "''"]])),
        solution: 'from itertools import groupby\n\ndef comprimir(texto):\n    return "".join(f"{letra}{len(list(grupo))}" for letra, grupo in groupby(texto))\n',
        hints: ['`groupby(texto)` entrega parejas `(letra, grupo)` por cada racha.', 'El tamaño de la racha es `len(list(grupo))`.'],
        explain: 'Es la base de la codificación «run-length». `groupby` agrupa rachas consecutivas, justo lo que se necesita aquí.',
        commands: ['itertools.groupby'],
      }),
      pyCode('Guarda en `acumulado` la lista de sumas acumuladas de `[1, 2, 3, 4]` (`[1, 3, 6, 10]`) usando `itertools.accumulate`.', {
        starter: 'from itertools import accumulate\n',
        check: all(variable('acumulado', '[1, 3, 6, 10]'), uses('call:accumulate')),
        solution: 'from itertools import accumulate\nacumulado = list(accumulate([1, 2, 3, 4]))\n',
        hint: '`accumulate` devuelve un iterador: conviértelo con `list`.',
        why: 'Es el «total acumulado» típico (saldos, contadores…) en una sola llamada.',
      }),
    ]),
  ],
  boss: {
    goal: 'Tubería perezosa',
    prompt:
      'El archivo `ventas.txt` tiene líneas `producto;unidades;precio`, con líneas vacías, comentarios (`#`) y datos mal formados. Escribe:\n\n1. El **decorador** `contar_llamadas`: guarda en el atributo `llamadas` de la función cuántas veces se ha llamado (conservando su nombre).\n2. `parsear_linea(linea)` (decorada con él): devuelve la tupla `(producto, unidades int, precio float)`; lanza `ValueError` si la línea está mal (campos que no son números, producto vacío…).\n3. El **generador** `registros(ruta)`: abre el archivo con `with`, **ignora** las líneas vacías o que empiezan por `#` (sin llamar a `parsear_linea`), y entrega los registros válidos omitiendo las líneas con error.\n\nDeja el programa de abajo tal cual.',
    setup: { files: { 'ventas.txt': VENTAS_TXT } },
    starter: c`
# Escribe aquí contar_llamadas, parsear_linea y registros

ventas = list(registros("ventas.txt"))
print(len(ventas), parsear_linea.llamadas)
totales = {}
for producto, unidades, precio in ventas:
    totales[producto] = totales.get(producto, 0) + unidades * precio
mejores = sorted(totales.items(), key=lambda kv: -kv[1])[:2]
print(mejores)
primero = next(registros("ventas.txt"))
print(primero)
` + '\n',
    check: all(func('contar_llamadas', 1), func('parsear_linea', 1), func('registros', 1), uses('Yield'), uses('decorator:contar_llamadas'), outHas("5 7", "[('pan', 22.5), ('leche', 13.5)]", "('pan', 10, 1.5)")),
    solution: c`
from functools import wraps

def contar_llamadas(f):
    @wraps(f)
    def envoltorio(*args, **kwargs):
        envoltorio.llamadas += 1
        return f(*args, **kwargs)
    envoltorio.llamadas = 0
    return envoltorio

@contar_llamadas
def parsear_linea(linea):
    producto, unidades, precio = linea.split(";")
    if not producto:
        raise ValueError("producto vacío")
    return producto, int(unidades), float(precio)

def registros(ruta):
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            linea = linea.strip()
            if not linea or linea.startswith("#"):
                continue
            try:
                yield parsear_linea(linea)
            except ValueError:
                continue

ventas = list(registros("ventas.txt"))
print(len(ventas), parsear_linea.llamadas)
totales = {}
for producto, unidades, precio in ventas:
    totales[producto] = totales.get(producto, 0) + unidades * precio
mejores = sorted(totales.items(), key=lambda kv: -kv[1])[:2]
print(mejores)
primero = next(registros("ventas.txt"))
print(primero)
`,
    hints: [
      '`contar_llamadas` guarda el contador en un atributo del envoltorio y usa `@wraps(f)`.',
      '`parsear_linea`: `linea.split(";")` en tres campos; `int(...)` y `float(...)` ya lanzan `ValueError`; añade tú el de producto vacío.',
      'En `registros`, un `try: yield parsear_linea(linea) except ValueError: continue` dentro del `for` y del `with open(...)`.',
    ],
    explain: 'Reúne la zona: un **decorador** que añade estado, un **generador** que lee el archivo perezosamente (una línea cada vez) y un **gestor de contexto** (`with`) que lo cierra. Así se procesan archivos de gigabytes con memoria constante.',
    commands: ['yield', 'decoradores', 'functools.wraps', 'with'],
  },
});
