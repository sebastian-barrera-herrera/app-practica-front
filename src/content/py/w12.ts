import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyWorld } from '../pybuild';
import { all, any, calls, cls, expr, file, forbids, func, not, outHas, stdout, truthy, uses, variable } from '../pycheck';
import { c, corre } from './util';

/** Gestor de tareas de referencia (lo usan la demo y los retos de la última lección). */
const GESTOR_BASE = c`
import json
from dataclasses import dataclass
from enum import IntEnum


class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3


@dataclass
class Tarea:
    id: int
    titulo: str
    prioridad: Prioridad = Prioridad.MEDIA
    hecha: bool = False

    def a_dict(self):
        return {"id": self.id, "titulo": self.titulo, "prioridad": self.prioridad.name, "hecha": self.hecha}

    @classmethod
    def desde_dict(cls, d):
        return cls(d["id"], d["titulo"], Prioridad[d["prioridad"]], d["hecha"])


class Gestor:
    def __init__(self):
        self.tareas = []

    def agregar(self, titulo, prioridad=Prioridad.MEDIA):
        if not titulo.strip():
            raise ValueError("El título no puede estar vacío")
        tarea = Tarea(len(self.tareas) + 1, titulo.strip(), prioridad)
        self.tareas.append(tarea)
        return tarea

    def completar(self, id):
        for t in self.tareas:
            if t.id == id:
                t.hecha = True
                return t
        raise KeyError(f"Tarea {id} no encontrada")

    def pendientes(self):
        return sorted((t for t in self.tareas if not t.hecha), key=lambda t: (-t.prioridad, t.id))

    def guardar(self, ruta):
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump([t.a_dict() for t in self.tareas], f, ensure_ascii=False, indent=2)

    @classmethod
    def cargar(cls, ruta):
        g = cls()
        with open(ruta, encoding="utf-8") as f:
            g.tareas = [Tarea.desde_dict(d) for d in json.load(f)]
        return g
`;

export const py12 = pyWorld({
  id: 'py12',
  index: 12,
  title: 'Maestría',
  subtitle: 'Pruebas, concurrencia, rendimiento, algoritmos y un proyecto real',
  emoji: '🏆',
  color: '#C084FC',
  level: 'avanzado',
  intro:
    'La última zona reúne lo que distingue a quien programa de verdad: **demostrar que el código funciona** con pruebas automáticas, **hacer varias cosas a la vez** sin bloquearse con `asyncio`, **medir y mejorar el rendimiento**, conocer los **algoritmos clásicos** y, para terminar, construir un **proyecto completo** que junta todo el curso.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py12-1', { title: 'Pruebas con unittest', summary: 'TestCase, aserciones, setUp y desarrollo guiado por pruebas', emoji: '🧪', commands: ['unittest.TestCase', 'unittest.main'], minutes: 16 }, [
      learn(
        'Código que comprueba código',
        `
Una **prueba automática** es un programa pequeño que ejecuta tu código con unos datos y **comprueba el resultado**. Cuando cambias algo, las ejecutas todas y sabes en segundos si has roto algo. El módulo estándar **\`unittest\`** lo hace así:

\`\`\`
import unittest

def suma(a, b):
    return a + b

class TestSuma(unittest.TestCase):
    def test_positivos(self):
        self.assertEqual(suma(2, 3), 5)

    def test_negativos(self):
        self.assertEqual(suma(-1, -1), -2)

if __name__ == "__main__":
    unittest.main()
\`\`\`

- Cada prueba es un método cuyo nombre **empieza por \`test_\`**. Son independientes y se ejecutan en orden alfabético.
- **\`setUp\`** se ejecuta *antes de cada test* (prepara datos nuevos); **\`tearDown\`** *después* (limpia).
- Las **aserciones** comprueban cosas: si una falla, el test falla.

En el laboratorio ejecutamos con \`unittest.main(argv=["x"], exit=False)\`, para que el programa no termine al acabar las pruebas.
`,
        '🧪',
      ),
      learn(
        'Aserciones y cómo leer el resultado',
        `
| Aserción | Comprueba |
|---|---|
| \`assertEqual(a, b)\` / \`assertNotEqual\` | \`a == b\` / \`a != b\` |
| \`assertTrue(x)\` / \`assertFalse(x)\` | \`bool(x)\` es verdadero / falso |
| \`assertIs(a, b)\` · \`assertIsNone(x)\` | identidad · es \`None\` |
| \`assertIn(a, b)\` | \`a in b\` |
| \`assertAlmostEqual(a, b, places=7)\` | decimales casi iguales |
| \`assertGreater(a, b)\` · \`assertLess\` | \`a > b\` · \`a < b\` |
| \`assertIsInstance(x, T)\` | \`isinstance(x, T)\` |
| \`with self.assertRaises(Error):\` | el bloque **lanza** esa excepción |

El resultado muestra un carácter por test: **\`.\`** pasó · **\`F\`** *failure* (una aserción falló) · **\`E\`** *error* (excepción inesperada). Al final: \`OK\` o \`FAILED (failures=1, errors=1)\`, con el detalle de cada fallo.

**TDD** (desarrollo guiado por pruebas): 1) escribes un test que falla (*rojo*), 2) escribes lo mínimo para que pase (*verde*), 3) mejoras el código sin romper nada (*refactor*).
`,
      ),
      pyDemo('Pruebas que pasan y que fallan', [
        [c`
import unittest

def suma(a, b):
    return a + b

class TestSuma(unittest.TestCase):
    def test_positivos(self):
        self.assertEqual(suma(2, 3), 5)

    def test_negativos(self):
        self.assertEqual(suma(-1, -1), -2)

unittest.main(argv=["x"], exit=False)
`, 'Todo en verde: `OK`'],
        [c`
import unittest

class TestMal(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(2 + 2, 4)

    def test_falla(self):
        self.assertEqual(2 + 2, 5)

    def test_error(self):
        1 / 0

unittest.main(argv=["x"], exit=False)
`, 'Un test pasa (`.`), uno falla (`F`) y uno tiene un error (`E`)'],
        [c`
import unittest

def dividir(a, b):
    if b == 0:
        raise ValueError("no se puede dividir entre cero")
    return a / b

class TestDividir(unittest.TestCase):
    def setUp(self):
        self.pares = [(10, 2, 5.0), (1, 4, 0.25)]

    def test_resultados(self):
        for a, b, esperado in self.pares:
            with self.subTest(a=a, b=b):
                self.assertEqual(dividir(a, b), esperado)

    def test_cero(self):
        with self.assertRaises(ValueError):
            dividir(1, 0)

    def test_decimales(self):
        self.assertAlmostEqual(dividir(1, 3), 0.3333, places=3)

unittest.main(argv=["x"], exit=False, verbosity=2)
`, '`setUp`, `assertRaises`, `assertAlmostEqual` y `subTest`; con `verbosity=2` se ve cada test'],
      ]),
      pyOut(
        '¿Qué imprime? (en la salida estándar)',
        c`
import unittest

class T(unittest.TestCase):
    def setUp(self):
        print("setUp")

    def test_a(self):
        print("a")

    def test_b(self):
        print("b")

unittest.main(argv=["x"], exit=False, verbosity=0)
`,
        ['a\nb\nsetUp', 'setUp\na\nb', 'setUp\nb\nsetUp\na'],
        '`setUp` se ejecuta antes de **cada** test, y los tests corren en orden alfabético: setUp, a, setUp, b. (Los puntos y el resumen de unittest salen por la salida de error.)',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
import io
import unittest

class T(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(2 + 2, 4)

    def test_mal(self):
        self.assertEqual(2 + 2, 5)

    def test_error(self):
        1 / 0

suite = unittest.defaultTestLoader.loadTestsFromTestCase(T)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun, len(r.failures), len(r.errors), r.wasSuccessful())
`,
        ['3 2 0 False', '3 0 2 False', '3 1 1 True'],
        'Se ejecutan 3 tests: uno falla por aserción (`failures` = 1), otro lanza una excepción (`errors` = 1) y otro pasa. Con algún fallo, `wasSuccessful()` es False.',
      ),
      mc('¿Cómo debe empezar el nombre de un método de prueba para que `unittest` lo ejecute?', ['check_', 'test_', 'prueba_', 'assert_'], 1, 'El cargador de `unittest` descubre los métodos cuyo nombre empieza por `test`.'),
      tf('El método `setUp` se ejecuta una sola vez, antes de todos los tests de la clase.', false, 'Se ejecuta antes de **cada** test, para que cada uno parta de datos limpios. Para algo único está `setUpClass`.'),
      fill('Completa la aserción que comprueba que dos valores son iguales', 'self.___(suma(2, 3), 5)', ['assertEqual', 'assertTrue', 'assertIs', 'assertIn'], ['assertEqual'], '`assertEqual(obtenido, esperado)` compara con `==` y, si falla, muestra ambos valores.'),
      match(
        'Une cada aserción con lo que comprueba',
        [
          ['assertEqual(a, b)', 'a == b'],
          ['assertIn(a, b)', 'a in b'],
          ['assertRaises(E)', 'El bloque lanza la excepción E'],
          ['assertAlmostEqual(a, b)', 'Decimales casi iguales'],
        ],
        'Elige la aserción más específica: los mensajes de fallo serán más claros.',
      ),
      pyPractice({
        goal: 'Tus primeros tests',
        prompt: 'Escribe la clase `TestEsPar` con **al menos 3 tests** de la función `es_par` (usa `assertTrue` y `assertFalse`). Deja el final del programa tal cual: debe imprimir `True True` (hay 3 tests o más y todos pasan).',
        starter: c`
import io
import unittest

def es_par(n):
    return n % 2 == 0

# Escribe aquí la clase TestEsPar

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestEsPar)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 3, r.wasSuccessful())
` + '\n',
        check: all(cls('TestEsPar'), stdout('True True'), uses('method:assertTrue'), uses('method:assertFalse')),
        solution: c`
import io
import unittest

def es_par(n):
    return n % 2 == 0

class TestEsPar(unittest.TestCase):
    def test_par(self):
        self.assertTrue(es_par(4))

    def test_impar(self):
        self.assertFalse(es_par(7))

    def test_cero(self):
        self.assertTrue(es_par(0))

    def test_negativo(self):
        self.assertTrue(es_par(-2))

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestEsPar)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 3, r.wasSuccessful())
`,
        hints: ['La clase hereda de `unittest.TestCase`.', 'Cada método `test_…` comprueba un caso: un par, un impar, el cero, un negativo…'],
        explain: 'Pensar casos —típicos y límite (0, negativos, vacío)— es la parte creativa de probar. Las aserciones son solo la mecánica.',
        commands: ['unittest.TestCase'],
      }),
      pyPractice({
        goal: 'Excepciones y setUp',
        prompt: 'Para la función `dividir`, escribe `TestDividir` con un método `setUp` que prepare datos, al menos un test con `assertRaises` y otro que compruebe un resultado correcto (≥ 3 tests en total, todos pasando).',
        starter: c`
import io
import unittest

def dividir(a, b):
    if b == 0:
        raise ValueError("división por cero")
    return a / b

# Escribe aquí la clase TestDividir

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestDividir)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 3, r.wasSuccessful())
` + '\n',
        check: all(cls('TestDividir'), stdout('True True'), truthy("'setUp' in TestDividir.__dict__"), uses('method:assertRaises')),
        solution: c`
import io
import unittest

def dividir(a, b):
    if b == 0:
        raise ValueError("división por cero")
    return a / b

class TestDividir(unittest.TestCase):
    def setUp(self):
        self.a = 10

    def test_division(self):
        self.assertEqual(dividir(self.a, 2), 5.0)

    def test_decimal(self):
        self.assertAlmostEqual(dividir(1, 3), 0.3333, places=3)

    def test_cero(self):
        with self.assertRaises(ValueError):
            dividir(self.a, 0)

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestDividir)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 3, r.wasSuccessful())
`,
        hints: ['`with self.assertRaises(ValueError):` y dentro la llamada que debe fallar.', '`setUp(self)` guarda datos en atributos de `self`, p. ej. `self.a = 10`.'],
        explain: 'Probar que una función **falla cuando debe** es tan importante como probar que acierta.',
        commands: ['unittest.TestCase'],
      }),
      pyPractice({
        goal: 'Arregla el código guiado por los tests',
        prompt: 'Los tests de `es_palindromo` ya están escritos y **fallan**. Corrige la función (sin tocar los tests) para que pasen: debe ignorar mayúsculas y espacios. Debe imprimir `4 True`.',
        starter: c`
import io
import unittest

def es_palindromo(texto):
    return texto == texto[::-1]

class TestPalindromo(unittest.TestCase):
    def test_simple(self):
        self.assertTrue(es_palindromo("radar"))

    def test_mayusculas(self):
        self.assertTrue(es_palindromo("Reconocer"))

    def test_frase(self):
        self.assertTrue(es_palindromo("Anita lava la tina"))

    def test_no(self):
        self.assertFalse(es_palindromo("python"))

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestPalindromo)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun, r.wasSuccessful())
` + '\n',
        check: all(stdout('4 True'), calls([['es_palindromo("Ana")', 'True'], ['es_palindromo("Ana y Pedro")', 'False']])),
        solution: c`
import io
import unittest

def es_palindromo(texto):
    limpio = texto.replace(" ", "").lower()
    return limpio == limpio[::-1]

class TestPalindromo(unittest.TestCase):
    def test_simple(self):
        self.assertTrue(es_palindromo("radar"))

    def test_mayusculas(self):
        self.assertTrue(es_palindromo("Reconocer"))

    def test_frase(self):
        self.assertTrue(es_palindromo("Anita lava la tina"))

    def test_no(self):
        self.assertFalse(es_palindromo("python"))

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestPalindromo)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun, r.wasSuccessful())
`,
        hints: ['Normaliza el texto antes de comparar: quita los espacios y pasa a minúsculas.', '`texto.replace(" ", "").lower()`'],
        explain: 'Cuando un test falla te dice **qué caso** no cumple tu código. Arreglar hasta que todo esté en verde es el ciclo diario de un programador.',
        commands: ['unittest.TestCase'],
      }),
      pyPractice({
        goal: 'TDD: escribe la función',
        prompt: 'Los tests de `fizzbuzz(n)` ya están escritos. Implementa la función: devuelve `"FizzBuzz"` si `n` es múltiplo de 3 y de 5, `"Fizz"` si solo de 3, `"Buzz"` si solo de 5, y `str(n)` en otro caso. Debe imprimir `5 True`.',
        starter: c`
import io
import unittest

# Escribe aquí la función fizzbuzz

class TestFizzBuzz(unittest.TestCase):
    def test_numero(self):
        self.assertEqual(fizzbuzz(1), "1")

    def test_fizz(self):
        self.assertEqual(fizzbuzz(9), "Fizz")

    def test_buzz(self):
        self.assertEqual(fizzbuzz(10), "Buzz")

    def test_fizzbuzz(self):
        self.assertEqual(fizzbuzz(15), "FizzBuzz")

    def test_cero(self):
        self.assertEqual(fizzbuzz(0), "FizzBuzz")

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestFizzBuzz)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun, r.wasSuccessful())
` + '\n',
        check: all(func('fizzbuzz', 1), stdout('5 True'), calls([['[fizzbuzz(n) for n in (3, 5, 7, 30)]', "['Fizz', 'Buzz', '7', 'FizzBuzz']"]])),
        solution: c`
import io
import unittest

def fizzbuzz(n):
    if n % 15 == 0:
        return "FizzBuzz"
    if n % 3 == 0:
        return "Fizz"
    if n % 5 == 0:
        return "Buzz"
    return str(n)

class TestFizzBuzz(unittest.TestCase):
    def test_numero(self):
        self.assertEqual(fizzbuzz(1), "1")

    def test_fizz(self):
        self.assertEqual(fizzbuzz(9), "Fizz")

    def test_buzz(self):
        self.assertEqual(fizzbuzz(10), "Buzz")

    def test_fizzbuzz(self):
        self.assertEqual(fizzbuzz(15), "FizzBuzz")

    def test_cero(self):
        self.assertEqual(fizzbuzz(0), "FizzBuzz")

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestFizzBuzz)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun, r.wasSuccessful())
`,
        hints: ['Comprueba **primero** el caso más específico (múltiplo de 15) y después los otros.', 'El cero también es múltiplo de todo: `0 % 15 == 0`.'],
        explain: 'Con los tests primero, sabes exactamente cuándo has terminado. Fíjate en el caso límite del cero: sin test, es el típico fallo que pasa desapercibido.',
        commands: ['unittest.main'],
      }),
      pyCode('Completa el test: debe comprobar con `assertRaises` que `int("x")` lanza `ValueError`. Debe imprimirse `True`.', {
        starter: c`
import io
import unittest

class T(unittest.TestCase):
    def test_valor(self):
        pass  # escribe aquí la comprobación

r = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(T))
print(r.wasSuccessful())
` + '\n',
        check: all(stdout('True'), uses('method:assertRaises')),
        solution: c`
import io
import unittest

class T(unittest.TestCase):
    def test_valor(self):
        with self.assertRaises(ValueError):
            int("x")

r = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(T))
print(r.wasSuccessful())
`,
        hint: '`with self.assertRaises(ValueError):` y dentro `int("x")`.',
        why: '`assertRaises` como gestor de contexto verifica que el bloque lance la excepción esperada.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py12-2', { title: 'asyncio', summary: 'Concurrencia cooperativa: async, await, gather y tareas', emoji: '⚡', commands: ['asyncio.run', 'asyncio.gather', 'asyncio.create_task', 'asyncio.sleep', 'asyncio.wait_for', 'async', 'await'], minutes: 16 }, [
      learn(
        'Hacer esperas a la vez',
        `
Muchos programas pasan casi todo el tiempo **esperando**: una respuesta de red, una base de datos, un archivo. Si esperas de una en una, el tiempo total es la suma. Con **\`asyncio\`** puedes mantener muchas esperas **en curso a la vez** en un solo hilo: es **concurrencia cooperativa**.

- \`async def f(): ...\` define una **corrutina**. Llamarla **no la ejecuta**: devuelve un objeto corrutina.
- \`await algo\` **espera** a una corrutina o tarea y, mientras tanto, cede el control para que otras avancen.
- \`asyncio.run(main())\` crea el **bucle de eventos** y ejecuta \`main\` hasta el final.
- \`asyncio.sleep(s)\` es la espera «amable» (nunca uses \`time.sleep\` dentro de código \`async\`: bloquea todo).
- \`asyncio.gather(a, b, c)\` lanza varias corrutinas a la vez y devuelve la lista de resultados **en el mismo orden**.
- \`asyncio.create_task(c)\` programa una corrutina para que corra **en segundo plano**.
- \`asyncio.wait_for(c, timeout)\` impone un límite de tiempo.

> CLAVE: \`asyncio\` brilla con **E/S** (red, disco, esperas). Para **cálculo pesado** no ayuda: sigue habiendo un solo hilo ejecutando Python (para eso, procesos).
`,
        '⚡',
      ),
      illus('py-event-loop', 'El bucle de eventos', 'Un único hilo reparte el turno entre las tareas: cada await es un punto donde otra puede avanzar.'),
      pyDemo('Secuencial frente a concurrente', [
        [c`
import asyncio, time

async def descargar(nombre, segundos):
    await asyncio.sleep(segundos)
    return nombre

async def secuencial():
    return [await descargar("a", 1), await descargar("b", 2), await descargar("c", 1.5)]

async def concurrente():
    return await asyncio.gather(descargar("a", 1), descargar("b", 2), descargar("c", 1.5))

for f in (secuencial, concurrente):
    t0 = time.perf_counter()
    print(f.__name__, asyncio.run(f()), round(time.perf_counter() - t0, 1), "s")
`, 'Una tras otra: 1 + 2 + 1.5 = 4.5 s. A la vez: lo que tarda la más lenta, 2 s (el reloj del laboratorio es virtual, así que no esperas de verdad)'],
        [c`
import asyncio

async def tarea(n, t):
    await asyncio.sleep(t)
    print("fin", n)
    return n

async def main():
    resultados = await asyncio.gather(tarea(1, 0.3), tarea(2, 0.1), tarea(3, 0.2))
    print(resultados)

asyncio.run(main())
`, 'Terminan en orden de duración, pero el resultado de `gather` conserva el orden de entrada'],
        [c`
import asyncio

async def trabajo():
    print("trabajo: empieza")
    await asyncio.sleep(1)
    print("trabajo: termina")
    return 42

async def main():
    t = asyncio.create_task(trabajo())
    print("mientras tanto…")
    resultado = await t
    print("resultado:", resultado)

asyncio.run(main())
`, '`create_task` lo programa; empieza cuando `main` cede el control (en el `await`)'],
      ]),
      learn(
        'Tiempo límite, colas y errores',
        `
- **Timeout**: \`await asyncio.wait_for(corrutina, timeout=2)\` lanza \`asyncio.TimeoutError\` (en 3.11+, \`TimeoutError\`) si tarda más.
- **Errores en \`gather\`**: por defecto, la primera excepción se propaga. Con \`return_exceptions=True\` recibes las excepciones como resultados.
- **\`asyncio.Queue\`**: cola para comunicar *productores* y *consumidores* de forma segura.
- **\`asyncio.Semaphore(n)\`**: limita cuántas tareas pueden estar a la vez en una sección (p. ej. máximo 5 descargas).
- **\`asyncio.TaskGroup\`** (3.11+): agrupa tareas y garantiza que ninguna queda suelta.
`,
      ),
      pyDemo('Más herramientas', [
        [c`
import asyncio

async def lenta():
    await asyncio.sleep(2)
    return "listo"

async def intentar(segundos):
    try:
        return await asyncio.wait_for(lenta(), timeout=segundos)
    except asyncio.TimeoutError:
        return "tiempo agotado"

print(asyncio.run(intentar(1)), asyncio.run(intentar(3)))
`],
        [c`
import asyncio

async def productor(q):
    for i in range(3):
        await q.put(i)
        await asyncio.sleep(0.1)
    await q.put(None)

async def consumidor(q):
    while (x := await q.get()) is not None:
        print("consumo", x)

async def main():
    q = asyncio.Queue()
    await asyncio.gather(productor(q), consumidor(q))

asyncio.run(main())
`, 'Un productor y un consumidor trabajando a la vez'],
        [c`
import asyncio

async def falla():
    raise ValueError("boom")

async def bien():
    await asyncio.sleep(0.1)
    return "ok"

async def main():
    print(await asyncio.gather(falla(), bien(), return_exceptions=True))

asyncio.run(main())
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
import asyncio

async def tarea(n, t):
    await asyncio.sleep(t)
    print("fin", n)
    return n

async def main():
    r = await asyncio.gather(tarea(1, 0.3), tarea(2, 0.1), tarea(3, 0.2))
    print(r)

asyncio.run(main())
`,
        ['fin 1\nfin 2\nfin 3\n[1, 2, 3]', 'fin 2\nfin 3\nfin 1\n[2, 3, 1]', '[1, 2, 3]\nfin 1\nfin 2\nfin 3'],
        'Las tareas corren a la vez y terminan según lo que tardan: 2 (0.1 s), 3 (0.2 s), 1 (0.3 s). `gather` devuelve los resultados en el orden en que pasaste las corrutinas: [1, 2, 3].',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
import asyncio

async def f():
    return 5

async def main():
    x = f()
    print(type(x).__name__)
    print(await x)

asyncio.run(main())
`,
        ['int\n5', 'coroutine\ncoroutine', 'Task\n5'],
        'Llamar a una función `async` no ejecuta nada: devuelve un objeto `coroutine`. Con `await` se ejecuta y se obtiene el resultado (5).',
      ),
      mc('¿Cuándo es útil `asyncio`?', ['Para acelerar cálculos matemáticos pesados', 'Para manejar muchas esperas de E/S (red, disco…) a la vez en un solo hilo', 'Para usar varios núcleos de la CPU', 'Para evitar escribir bucles'], 1, 'Mientras una tarea espera (`await`), otra puede avanzar. No hay paralelismo real: hay un solo hilo repartiendo el turno.'),
      tf('`asyncio` ejecuta las tareas en paralelo, en varios núcleos de la CPU a la vez.', false, 'Es concurrencia en un solo hilo: las tareas se turnan en los `await`. Para paralelismo de CPU se usan procesos (`multiprocessing`).'),
      fill('Completa para lanzar varias corrutinas a la vez y esperar todos los resultados', 'resultados = await asyncio.___(a(), b(), c())', ['gather', 'run', 'sleep', 'wait_for'], ['gather'], '`gather` las ejecuta de forma concurrente y devuelve la lista de resultados.'),
      match(
        'Une cada elemento con su función',
        [
          ['async def', 'Define una corrutina'],
          ['await', 'Espera cediendo el control a otras tareas'],
          ['asyncio.run(main())', 'Crea el bucle de eventos y ejecuta main'],
          ['asyncio.create_task(c)', 'Programa c para correr en segundo plano'],
        ],
        'Con estas cuatro piezas ya puedes leer casi cualquier programa asíncrono.',
      ),
      pyPractice({
        goal: 'Tres descargas a la vez',
        prompt: 'Escribe `async def main()` que ejecute **a la vez** las tres descargas con `asyncio.gather` y devuelva la lista de resultados. Con la ejecución simultánea el tiempo total será el de la más lenta (2.0 s).',
        starter: c`
import asyncio
import time

async def descargar(nombre, segundos):
    await asyncio.sleep(segundos)
    return nombre

# Escribe aquí main

t0 = time.perf_counter()
resultado = asyncio.run(main())
print(resultado, round(time.perf_counter() - t0, 1))
` + '\n',
        check: all(stdout("['a', 'b', 'c'] 2.0"), uses('method:gather')),
        solution: c`
import asyncio
import time

async def descargar(nombre, segundos):
    await asyncio.sleep(segundos)
    return nombre

async def main():
    return await asyncio.gather(descargar("a", 1), descargar("b", 2), descargar("c", 1.5))

t0 = time.perf_counter()
resultado = asyncio.run(main())
print(resultado, round(time.perf_counter() - t0, 1))
`,
        hints: ['Llama a `descargar("a", 1)`, `descargar("b", 2)` y `descargar("c", 1.5)` dentro de `gather`.', 'No olvides el `await` delante de `asyncio.gather(...)`.'],
        explain: 'De 4.5 s a 2 s sin hilos ni procesos. Cuanto más esperan tus tareas, más ganas con la concurrencia.',
        commands: ['asyncio.gather', 'asyncio.run'],
      }),
      pyPractice({
        goal: 'Una tarea en segundo plano',
        prompt: 'Completa `main`: lanza `trabajo()` **en segundo plano** con `asyncio.create_task`, imprime `mientras tanto…` y después espera su resultado para imprimir `resultado: 42`.',
        starter: c`
import asyncio

async def trabajo():
    print("trabajo: empieza")
    await asyncio.sleep(1)
    print("trabajo: termina")
    return 42

async def main():
    # lanza trabajo() en segundo plano, imprime "mientras tanto…" y espera el resultado
    ...

asyncio.run(main())
` + '\n',
        check: all(stdout('mientras tanto…\ntrabajo: empieza\ntrabajo: termina\nresultado: 42'), uses('method:create_task')),
        solution: c`
import asyncio

async def trabajo():
    print("trabajo: empieza")
    await asyncio.sleep(1)
    print("trabajo: termina")
    return 42

async def main():
    tarea = asyncio.create_task(trabajo())
    print("mientras tanto…")
    resultado = await tarea
    print("resultado:", resultado)

asyncio.run(main())
`,
        hints: ['`tarea = asyncio.create_task(trabajo())` programa la tarea sin esperarla.', 'Más tarde, `resultado = await tarea`.'],
        explain: 'La tarea no empieza hasta que `main` cede el control en un `await`: por eso «mientras tanto…» sale antes que «trabajo: empieza».',
        commands: ['asyncio.create_task'],
      }),
      pyPractice({
        goal: 'Con límite de tiempo',
        prompt: 'Escribe `async def intentar(segundos)` que espere a `lenta()` con `asyncio.wait_for` y el tiempo límite indicado; si se agota devuelve `"tiempo agotado"`, y si no, el resultado de `lenta()`.',
        starter: c`
import asyncio

async def lenta():
    await asyncio.sleep(2)
    return "listo"

# Escribe aquí intentar

print(asyncio.run(intentar(1)))
print(asyncio.run(intentar(3)))
` + '\n',
        check: all(stdout('tiempo agotado\nlisto'), uses('method:wait_for')),
        solution: c`
import asyncio

async def lenta():
    await asyncio.sleep(2)
    return "listo"

async def intentar(segundos):
    try:
        return await asyncio.wait_for(lenta(), timeout=segundos)
    except asyncio.TimeoutError:
        return "tiempo agotado"

print(asyncio.run(intentar(1)))
print(asyncio.run(intentar(3)))
`,
        hints: ['`asyncio.wait_for(lenta(), timeout=segundos)` dentro de un `try`.', 'Captura `asyncio.TimeoutError`.'],
        explain: 'Poner límite a las esperas evita que un servicio caído cuelgue todo tu programa.',
        commands: ['asyncio.wait_for'],
      }),
      pyCode('Ejecuta la corrutina `saludar()` con `asyncio.run` y guarda el resultado en `r`.', {
        starter: c`
import asyncio

async def saludar():
    await asyncio.sleep(0.1)
    return "hola"
` + '\n',
        check: all(variable('r', "'hola'"), uses('method:run')),
        solution: c`
import asyncio

async def saludar():
    await asyncio.sleep(0.1)
    return "hola"

r = asyncio.run(saludar())
`,
        hint: '`asyncio.run(saludar())` — con los paréntesis de `saludar()`.',
        why: '`asyncio.run` recibe la corrutina ya creada, la ejecuta hasta el final y devuelve su resultado.',
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py12-3', { title: 'Complejidad y rendimiento', summary: 'Big-O, estructuras de datos adecuadas y memoización', emoji: '📈', commands: ['big-o', 'functools.lru_cache', 'set', 'dict'], minutes: 16 }, [
      learn(
        'Cómo crece el trabajo',
        `
Dos programas correctos pueden diferir en miles de veces en velocidad. La **complejidad** (notación **Big-O**) describe cómo **crece el trabajo** cuando crece la entrada \`n\`, ignorando constantes:

| Complejidad | Nombre | Ejemplo |
|---|---|---|
| O(1) | constante | acceder a \`lista[i]\`, \`dict[clave]\`, \`x in conjunto\` |
| O(log n) | logarítmica | búsqueda binaria |
| O(n) | lineal | recorrer una lista; \`x in lista\` |
| O(n log n) | casi lineal | \`sorted(lista)\` |
| O(n²) | cuadrática | dos bucles anidados sobre los mismos datos |
| O(2ⁿ) | exponencial | \`fib\` recursivo ingenuo |

Con \`n = 1000\`: O(n) son mil pasos, O(n²) un millón, O(2ⁿ) más que átomos del universo.

> CLAVE: **elegir la estructura adecuada** suele ser la mayor mejora. Buscar en una \`list\` es O(n), en un \`set\`/\`dict\` es O(1). Insertar al principio de una lista es O(n); en un \`deque\`, O(1).
`,
        '📈',
      ),
      illus('py-big-o', 'Cómo crecen las funciones', 'Con entradas grandes, la diferencia entre O(n) y O(n²) —o O(2ⁿ)— lo decide todo.'),
      learn(
        'Medir sin cronómetro: contar pasos',
        `
Medir el tiempo es poco fiable (depende de la máquina y de lo que haya en marcha; en este laboratorio, además, el reloj es virtual). Una forma más clara de **entender** la complejidad es **contar operaciones**: llamadas, comparaciones, accesos…

Y para evitar recalcular lo mismo, la **memoización** guarda resultados ya obtenidos (\`functools.cache\`/\`lru_cache\`): convierte el \`fib\` exponencial en lineal. Para medir tiempos reales en tu máquina, usa \`time.perf_counter()\` o el módulo \`timeit\`.
`,
      ),
      illus('py-recursion-tree', 'El árbol de llamadas de fib(5)', 'fib(3), fib(2)… se calculan una y otra vez: la memoización poda el árbol.'),
      pyDemo('Contar para entender', [
        [c`
llamadas = 0

def fib(n):
    global llamadas
    llamadas += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

for n in (5, 10, 15, 20):
    llamadas = 0
    fib(n)
    print(n, llamadas)
`, 'Cada +5 multiplica el trabajo por ~11: exponencial'],
        [c`
from functools import cache

llamadas = 0

@cache
def fib(n):
    global llamadas
    llamadas += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print(fib(80), llamadas)
`, 'Con caché: 81 llamadas en total (lineal)'],
        [c`
def lineal(xs, x):
    pasos = 0
    for v in xs:
        pasos += 1
        if v == x:
            break
    return pasos

def binaria(xs, x):
    bajo, alto, pasos = 0, len(xs) - 1, 0
    while bajo <= alto:
        pasos += 1
        medio = (bajo + alto) // 2
        if xs[medio] == x:
            break
        if xs[medio] < x:
            bajo = medio + 1
        else:
            alto = medio - 1
    return pasos

datos = list(range(1_000_000))
print(lineal(datos, 999_999), binaria(datos, 999_999))
`, 'Un millón de pasos frente a 20: la lista debe estar ordenada'],
        [c`
nombres = [f"n{i}" for i in range(2000)]
buscar = [f"n{i}" for i in range(1500, 2500)]

# O(n·m): cada «in» recorre la lista
en_lista = [x for x in buscar if x in nombres]
# O(n + m): un conjunto responde en tiempo constante
conjunto = set(nombres)
en_conjunto = [x for x in buscar if x in conjunto]
print(len(en_lista), en_lista == en_conjunto)
`, 'Mismo resultado; el conjunto evita recorrer la lista 1000 veces'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
llamadas = 0

def fib(n):
    global llamadas
    llamadas += 1
    return n if n < 2 else fib(n - 1) + fib(n - 2)

fib(10)
print(llamadas)
`,
        ['11', '55', '89'],
        'Calcular `fib(10)` (que vale 55) requiere 177 llamadas: el árbol de llamadas repite el trabajo una y otra vez. Con memoización serían 11.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
n = 5
cuenta = 0
for i in range(n):
    for j in range(i):
        cuenta += 1
print(cuenta)
`,
        ['25', '5', '15'],
        'El bucle interno da 0 + 1 + 2 + 3 + 4 = 10 vueltas (n·(n−1)/2). Dos bucles anidados sobre `n` son O(n²).',
      ),
      mc('¿Cuál de estas operaciones es O(1) en promedio?', ['`x in lista`', '`x in conjunto`', '`sorted(lista)`', '`lista.insert(0, x)`'], 1, 'Los conjuntos y diccionarios usan tablas hash: comprobar la pertenencia no depende del tamaño. En una lista hay que recorrerla (O(n)).'),
      tf('La búsqueda binaria funciona sobre una lista desordenada.', false, 'Necesita los datos **ordenados**: en cada paso descarta la mitad comparando con el elemento central.'),
      fill('Completa para que la comprobación de pertenencia sea rápida', 'vistos = ___()\nif x in vistos:\n    ...', ['set', 'list', 'tuple', 'str'], ['set'], 'Un `set` comprueba pertenencia en O(1); una lista en O(n).'),
      match(
        'Une cada complejidad con un ejemplo',
        [
          ['O(1)', 'Buscar una clave en un diccionario'],
          ['O(log n)', 'Búsqueda binaria en una lista ordenada'],
          ['O(n)', 'Recorrer una lista una vez'],
          ['O(n²)', 'Comparar cada elemento con todos los demás'],
        ],
        'Reconocer el patrón de bucles te dice la complejidad a simple vista.',
      ),
      pyPractice({
        goal: 'Duplicados en tiempo lineal',
        prompt: 'Escribe `hay_duplicados(xs)` que devuelva `True` si algún elemento se repite, en **tiempo lineal** (usa un conjunto, no dos bucles anidados).',
        starter: '',
        check: all(func('hay_duplicados', 1), calls([['hay_duplicados([1, 2, 3, 2])', 'True'], ['hay_duplicados([1, 2, 3])', 'False'], ['hay_duplicados([])', 'False'], ['hay_duplicados("hola")', 'False'], ['hay_duplicados("hello")', 'True']]), not(uses('For', 2))),
        solution: c`
def hay_duplicados(xs):
    vistos = set()
    for x in xs:
        if x in vistos:
            return True
        vistos.add(x)
    return False
`,
        hints: ['Guarda lo que ya has visto en un `set`.', 'Si el elemento ya está en `vistos`, devuelve `True`; al terminar el bucle, `False`.'],
        explain: 'El enfoque ingenuo compara cada par (O(n²)). Con un conjunto cada elemento se comprueba en tiempo constante: O(n) en total.',
        commands: ['set'],
      }),
      pyPractice({
        goal: 'Búsqueda binaria',
        prompt: 'Escribe `buscar(xs, x)`: búsqueda **binaria** en la lista ordenada `xs`; devuelve la posición de `x` o `-1` si no está. (Se comprobará que accede a muy pocos elementos.)',
        starter: '',
        check: all(
          func('buscar', 2),
          calls([['buscar([1, 3, 5, 7, 9], 7)', '3'], ['buscar([1, 3, 5, 7, 9], 4)', '-1'], ['buscar([], 1)', '-1'], ['buscar([5], 5)', '0']]),
          truthy(corre('class L(list):\n    accesos = 0\n    def __getitem__(self, i):\n        L.accesos += 1\n        return list.__getitem__(self, i)\nxs = L(range(0, 2000, 2))\nres = (buscar(xs, 1000), buscar(xs, 3), 2 <= L.accesos <= 60)') + ' == (500, -1, True)'),
        ),
        solution: c`
def buscar(xs, x):
    bajo, alto = 0, len(xs) - 1
    while bajo <= alto:
        medio = (bajo + alto) // 2
        if xs[medio] == x:
            return medio
        if xs[medio] < x:
            bajo = medio + 1
        else:
            alto = medio - 1
    return -1
`,
        hints: ['Mantén dos límites, `bajo` y `alto`, y mira siempre el elemento del `medio`.', 'Si `xs[medio] < x`, el objetivo está a la derecha: `bajo = medio + 1`; si no, `alto = medio - 1`.'],
        explain: 'Cada paso descarta la mitad de los datos: para un millón de elementos bastan unos 20 pasos. Eso es O(log n).',
        commands: ['big-o'],
      }),
      pyPractice({
        goal: 'Memoizar un cálculo caro',
        prompt: 'La función `caminos(f, c)` cuenta los caminos desde una esquina a la opuesta de una cuadrícula moviéndose solo hacia abajo o a la derecha. Añádele **memoización** para que `caminos(12, 12)` solo ejecute su cuerpo 143 veces (deja el programa de abajo tal cual).',
        starter: c`
llamadas = 0

def caminos(f, c):
    global llamadas
    llamadas += 1
    if f == 1 or c == 1:
        return 1
    return caminos(f - 1, c) + caminos(f, c - 1)

print(caminos(12, 12), llamadas)
` + '\n',
        check: all(stdout('705432 143')),
        solution: c`
from functools import cache

llamadas = 0

@cache
def caminos(f, c):
    global llamadas
    llamadas += 1
    if f == 1 or c == 1:
        return 1
    return caminos(f - 1, c) + caminos(f, c - 1)

print(caminos(12, 12), llamadas)
`,
        hints: ['`from functools import cache` y decora la función con `@cache`.', 'Sin caché se ejecutaría el cuerpo 1,4 millones de veces.'],
        explain: 'Hay solo 143 subproblemas distintos (la cuadrícula de 12 × 12 menos la esquina (1, 1), que nunca se alcanza); la caché evita recalcular cada uno más de una vez. Es la idea de la **programación dinámica**.',
        commands: ['functools.lru_cache'],
      }),
      pyPractice({
        goal: 'Dos números que suman',
        prompt: 'Escribe `existe_suma(xs, objetivo)`: `True` si hay **dos elementos distintos** (en posiciones distintas) de `xs` que suman `objetivo`. Hazlo en tiempo lineal con un conjunto (con un solo bucle `for`).',
        starter: '',
        check: all(func('existe_suma', 2), calls([['existe_suma([3, 8, 1, 6], 9)', 'True'], ['existe_suma([3, 8, 1, 6], 20)', 'False'], ['existe_suma([5], 10)', 'False'], ['existe_suma([5, 5], 10)', 'True'], ['existe_suma([], 0)', 'False']]), not(uses('For', 2))),
        solution: c`
def existe_suma(xs, objetivo):
    vistos = set()
    for x in xs:
        if objetivo - x in vistos:
            return True
        vistos.add(x)
    return False
`,
        hints: ['Para cada `x`, el compañero que necesitas es `objetivo - x`.', 'Mira si ya lo has visto (en un `set`) antes de añadir `x`; así no usas el mismo elemento dos veces.'],
        explain: 'Pasar de «probar todas las parejas» (O(n²)) a «recordar lo visto» (O(n)) es el truco más repetido de las entrevistas técnicas.',
        commands: ['set', 'dict'],
      }),
      pyCode('Cada elemento de `palabras` aparece en `vocabulario` (una lista enorme). Cambia `vocabulario` a una estructura con búsqueda rápida y guarda en `desconocidas` las palabras que **no** estén.', {
        starter: 'vocabulario = ["sol", "luna", "mar", "cielo"]\npalabras = ["mar", "tierra", "sol", "fuego"]\n',
        check: all(variable('desconocidas', "['tierra', 'fuego']"), any(uses('call:set'), uses('Set'))),
        solution: 'vocabulario = {"sol", "luna", "mar", "cielo"}\npalabras = ["mar", "tierra", "sol", "fuego"]\ndesconocidas = [p for p in palabras if p not in vocabulario]\n',
        hint: 'Convierte el vocabulario en un `set` y filtra con `not in`.',
        why: 'Con un conjunto cada comprobación es O(1) en lugar de recorrer toda la lista.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py12-4', { title: 'Algoritmos clásicos', summary: 'Ordenar, buscar, grafos (BFS/DFS), heapq y programación dinámica', emoji: '🧭', commands: ['bisect.bisect_left', 'heapq.heappush', 'heapq.heappop', 'heapq.nlargest', 'grafos', 'programacion-dinamica'], minutes: 18 }, [
      learn(
        'El repertorio básico',
        `
Estos algoritmos aparecen una y otra vez; reconocer cuál encaja en un problema es medio trabajo.

- **Ordenar**: \`sorted\` / \`list.sort\` usan *Timsort* (O(n log n), **estable**). Entender un algoritmo propio, como **ordenación por mezcla**, enseña la idea de «divide y vencerás»: partir en dos mitades, ordenar cada una y **mezclarlas**.
- **Buscar en ordenado**: el módulo \`bisect\` hace búsqueda binaria (\`bisect_left\`, \`bisect_right\`, \`insort\`).
- **Cola de prioridad**: \`heapq\` mantiene un **montículo**: \`heappush\`, \`heappop\` (siempre sale el **menor**), \`nlargest\`/\`nsmallest\`.
- **Grafos**: se representan con un diccionario \`{nodo: [vecinos]}\`.
  - **BFS** (anchura): usa una **cola** (\`deque\`); explora por capas y encuentra el **camino más corto** en grafos sin pesos.
  - **DFS** (profundidad): usa una **pila** o recursión; explora hasta el fondo antes de retroceder.
- **Programación dinámica**: dividir un problema en subproblemas que se **repiten** y guardar sus soluciones (memoización o tabla).
`,
        '🧭',
      ),
      pyDemo('Algoritmos en acción', [
        [c`
import bisect, heapq

notas = [10, 20, 30, 40]
print(bisect.bisect_left(notas, 30), bisect.bisect_left(notas, 25))
bisect.insort(notas, 25)
print(notas)

h = []
for tarea in [(3, "tercera"), (1, "primera"), (2, "segunda")]:
    heapq.heappush(h, tarea)
print(heapq.heappop(h), heapq.heappop(h), h)
print(heapq.nlargest(2, [4, 9, 1, 7]), heapq.nsmallest(2, [4, 9, 1, 7]))
`],
        [c`
def mezclar(a, b):
    resultado, i, j = [], 0, 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            resultado.append(a[i]); i += 1
        else:
            resultado.append(b[j]); j += 1
    return resultado + a[i:] + b[j:]

def ordenar(xs):
    if len(xs) <= 1:
        return xs
    medio = len(xs) // 2
    return mezclar(ordenar(xs[:medio]), ordenar(xs[medio:]))

print(ordenar([5, 2, 9, 1, 5, 6]))
`, 'Divide y vencerás: ordenar mitades y mezclarlas'],
        [c`
from collections import deque

grafo = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": ["F"], "E": ["F"], "F": []}

def bfs(inicio):
    visitados, cola = [inicio], deque([inicio])
    while cola:
        nodo = cola.popleft()
        for vecino in grafo[nodo]:
            if vecino not in visitados:
                visitados.append(vecino)
                cola.append(vecino)
    return visitados

def dfs(nodo, visitados=None):
    visitados = [] if visitados is None else visitados
    visitados.append(nodo)
    for vecino in grafo[nodo]:
        if vecino not in visitados:
            dfs(vecino, visitados)
    return visitados

print("BFS:", bfs("A"))
print("DFS:", dfs("A"))
`, 'BFS explora por capas; DFS se va hasta el fondo'],
        [c`
def min_monedas(monedas, cantidad):
    INF = float("inf")
    mejor = [0] + [INF] * cantidad
    for total in range(1, cantidad + 1):
        for m in monedas:
            if m <= total:
                mejor[total] = min(mejor[total], mejor[total - m] + 1)
    return mejor[cantidad] if mejor[cantidad] != INF else -1

print(min_monedas([1, 5, 10, 25], 63), min_monedas([1, 3, 4], 6), min_monedas([2], 3))
`, 'Programación dinámica: la solución de cada total reutiliza las de totales menores. (Con [1, 3, 4] y 6 el método «voraz» daría 3 monedas; la óptima son 2.)'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
from collections import deque

grafo = {"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}
visitados = ["A"]
cola = deque(["A"])
while cola:
    n = cola.popleft()
    for v in grafo[n]:
        if v not in visitados:
            visitados.append(v)
            cola.append(v)
print(visitados)
`,
        ["['A', 'B', 'D', 'C']", "['A', 'C', 'B', 'D']", "['D', 'C', 'B', 'A']"],
        'BFS visita por capas: primero A, luego sus vecinos B y C (en orden), y por último D. Un recorrido en profundidad habría dado A, B, D, C.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
import heapq

h = []
for x in [5, 1, 4]:
    heapq.heappush(h, x)
print(heapq.heappop(h), heapq.heappop(h), h)
`,
        ['5 4 [1]', '1 5 [4]', '1 4 [4, 5]'],
        'Un montículo siempre entrega primero el **menor**: 1, luego 4. Queda solo el 5.',
      ),
      mc('¿Qué estructura usa el recorrido en anchura (BFS)?', ['Una pila', 'Una cola (`deque`)', 'Un montículo', 'Un conjunto ordenado'], 1, 'La cola (FIFO) hace que se visiten primero todos los vecinos de un nivel antes de pasar al siguiente: por eso BFS halla el camino más corto sin pesos.'),
      tf('El algoritmo voraz (tomar siempre la moneda más grande) da siempre el mínimo número de monedas.', false, 'Con monedas [1, 3, 4] y 6, lo voraz da 4+1+1 (3 monedas) pero lo óptimo es 3+3 (2). Por eso se usa programación dinámica.'),
      fill('Completa para sacar siempre el menor elemento del montículo', 'import heapq\nmenor = heapq.___(h)', ['heappop', 'heappush', 'heapify', 'nlargest'], ['heappop'], '`heappop` extrae y devuelve el elemento más pequeño.'),
      match(
        'Une cada problema con la herramienta típica',
        [
          ['Camino más corto sin pesos', 'BFS con deque'],
          ['Los k elementos más grandes', 'heapq.nlargest'],
          ['Buscar en una lista ordenada', 'bisect / búsqueda binaria'],
          ['Subproblemas que se repiten', 'Programación dinámica / memoización'],
        ],
        'Reconocer el patrón es la mitad de resolver el problema.',
      ),
      pyPractice({
        goal: 'Ordenación por mezcla',
        prompt: 'Implementa `merge_sort(xs)`: devuelve una lista **nueva** ordenada, usando el método de dividir, ordenar y mezclar. No puedes usar `sorted` ni `.sort()`.',
        starter: '',
        check: all(func('merge_sort', 1), forbids('call:sorted'), forbids('method:sort'), calls([['merge_sort([5, 2, 9, 1, 5, 6])', '[1, 2, 5, 5, 6, 9]'], ['merge_sort([])', '[]'], ['merge_sort([3])', '[3]'], ['merge_sort(list(range(10, 0, -1)))', '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'], ['(lambda xs: (merge_sort(xs), xs)[1])([3, 1, 2])', '[3, 1, 2]']])),
        solution: c`
def merge_sort(xs):
    if len(xs) <= 1:
        return list(xs)
    medio = len(xs) // 2
    izq = merge_sort(xs[:medio])
    der = merge_sort(xs[medio:])
    resultado, i, j = [], 0, 0
    while i < len(izq) and j < len(der):
        if izq[i] <= der[j]:
            resultado.append(izq[i])
            i += 1
        else:
            resultado.append(der[j])
            j += 1
    return resultado + izq[i:] + der[j:]
`,
        hints: ['Caso base: una lista de 0 o 1 elementos ya está ordenada.', 'Ordena cada mitad recursivamente y mézclalas comparando las cabezas de ambas.'],
        explain: 'Al partir siempre por la mitad y mezclar en tiempo lineal, el coste es O(n log n): el mismo orden que el `sorted` de Python.',
        commands: ['recursion'],
      }),
      pyPractice({
        goal: 'Camino más corto',
        prompt: 'Escribe `camino(grafo, inicio, fin)`, que devuelva la lista de nodos del camino **más corto** (menos saltos) entre `inicio` y `fin`, o `None` si no hay camino. Usa BFS con `deque`.',
        starter: 'from collections import deque\n\nGRAFO = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": ["F"], "E": ["F"], "F": []}\n',
        check: all(func('camino', 3), calls([['camino(GRAFO, "A", "F")', "['A', 'B', 'D', 'F']"], ['camino(GRAFO, "A", "A")', "['A']"], ['camino(GRAFO, "F", "A")', 'None'], ['camino(GRAFO, "C", "F")', "['C', 'D', 'F']"]])),
        solution: c`
from collections import deque

GRAFO = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": ["F"], "E": ["F"], "F": []}

def camino(grafo, inicio, fin):
    previo = {inicio: None}
    cola = deque([inicio])
    while cola:
        nodo = cola.popleft()
        if nodo == fin:
            ruta = []
            while nodo is not None:
                ruta.append(nodo)
                nodo = previo[nodo]
            return ruta[::-1]
        for vecino in grafo[nodo]:
            if vecino not in previo:
                previo[vecino] = nodo
                cola.append(vecino)
    return None
`,
        hints: ['Guarda en un diccionario `previo` desde qué nodo llegaste a cada uno.', 'Al llegar a `fin`, reconstruye la ruta siguiendo `previo` hacia atrás y dale la vuelta.'],
        explain: 'Como BFS explora por capas, la primera vez que alcanza un nodo lo hace por el camino con menos saltos. El diccionario `previo` además marca los visitados.',
        commands: ['grafos'],
      }),
      pyPractice({
        goal: 'Las tareas más urgentes',
        prompt: 'Escribe `urgentes(tareas, k)`: `tareas` es una lista de parejas `(nombre, prioridad)`; devuelve los **nombres** de las `k` de mayor prioridad, de mayor a menor. Usa `heapq`.',
        starter: 'import heapq\n',
        check: all(func('urgentes', 2), uses('import:heapq'), calls([['urgentes([("a", 3), ("b", 9), ("c", 1), ("d", 7)], 2)', "['b', 'd']"], ['urgentes([("a", 3)], 5)', "['a']"], ['urgentes([], 3)', '[]']])),
        solution: c`
import heapq

def urgentes(tareas, k):
    return [nombre for nombre, prioridad in heapq.nlargest(k, tareas, key=lambda t: t[1])]
`,
        hints: ['`heapq.nlargest(k, iterable, key=...)` devuelve los k mayores, ya ordenados.', 'La clave es la prioridad: `lambda t: t[1]`.'],
        explain: '`nlargest` es mejor que ordenar todo cuando solo quieres unos pocos: no tiene que ordenar la lista completa.',
        commands: ['heapq.nlargest'],
      }),
      pyPractice({
        goal: 'Cambio de monedas',
        prompt: 'Escribe `min_monedas(monedas, cantidad)`: el **mínimo** número de monedas para sumar `cantidad`, o `-1` si es imposible. Usa programación dinámica.',
        starter: '',
        check: all(func('min_monedas', 2), calls([['min_monedas([1, 5, 10, 25], 63)', '6'], ['min_monedas([1, 3, 4], 6)', '2'], ['min_monedas([2], 3)', '-1'], ['min_monedas([5, 7], 0)', '0'], ['min_monedas([1, 2, 5], 100)', '20']])),
        solution: c`
def min_monedas(monedas, cantidad):
    INF = float("inf")
    mejor = [0] + [INF] * cantidad
    for total in range(1, cantidad + 1):
        for m in monedas:
            if m <= total:
                mejor[total] = min(mejor[total], mejor[total - m] + 1)
    return mejor[cantidad] if mejor[cantidad] != INF else -1
`,
        hints: ['Crea una tabla `mejor[t]` = mínimo de monedas para sumar `t`, con `mejor[0] = 0`.', 'Para cada total y cada moneda `m <= total`: `mejor[total] = min(mejor[total], mejor[total - m] + 1)`.'],
        explain: 'Cada celda reutiliza la solución de totales más pequeños, que ya están calculados. Eso es programación dinámica «de abajo arriba».',
        commands: ['programacion-dinamica'],
      }),
      pyCode('Con `bisect`, guarda en `pos` la posición donde habría que insertar 25 en `xs` para mantenerla ordenada.', {
        starter: 'import bisect\nxs = [10, 20, 30, 40]\n',
        check: all(variable('pos', '2'), uses('method:bisect_left')),
        solution: 'import bisect\nxs = [10, 20, 30, 40]\npos = bisect.bisect_left(xs, 25)\n',
        hint: '`bisect.bisect_left(lista, valor)`',
        why: '`bisect` hace búsqueda binaria sobre listas ordenadas: O(log n).',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py12-5', { title: 'Proyecto final', summary: 'Un gestor de tareas con clases, JSON, excepciones y pruebas', emoji: '🚀', commands: ['dataclasses.dataclass', 'json.dump', 'json.load', 'unittest.TestCase', 'raise'], minutes: 22 }, [
      learn(
        'Un proyecto, cinco ideas',
        `
Vas a construir un **gestor de tareas** (el clásico «to-do»). No es el programa más grande del mundo, pero ejercita todo lo importante de un proyecto real:

1. **Modelar los datos** con \`dataclass\` y \`Enum\` (una \`Tarea\` con prioridad y estado).
2. **Encapsular la lógica** en una clase (\`Gestor\`) que protege sus reglas con **excepciones**.
3. **Persistir** en un archivo **JSON** y recuperarlo (serializar / deserializar).
4. **Interactuar por consola**: interpretar comandos de texto.
5. **Probar** el código con \`unittest\`.

Buenas prácticas: separa **datos**, **lógica**, **entrada/salida** y **pruebas**; que cada función haga una cosa; y valida siempre lo que viene de fuera (usuario, archivos).

Primero verás el proyecto base funcionando; luego completarás sus piezas, y al final lo escribirás **tú entero** en la misión final.
`,
        '🚀',
      ),
      pyDemo('El gestor base', [
        [GESTOR_BASE + c`


g = Gestor()
g.agregar("Comprar pan")
g.agregar("Entregar informe", Prioridad.ALTA)
g.agregar("Llamar a Ana", Prioridad.BAJA)
g.completar(1)
for t in g.pendientes():
    print(t.id, t.titulo, t.prioridad.name)
g.guardar("tareas.json")
print(open("tareas.json", encoding="utf-8").read()[:120])
g2 = Gestor.cargar("tareas.json")
print(len(g2.tareas), [t.hecha for t in g2.tareas])
`, 'Datos + lógica + persistencia en ~50 líneas'],
      ]),
      learn(
        'Convenciones del proyecto',
        `
- **Identificadores**: cada tarea tiene un \`id\` entero, que empieza en 1 y crece.
- **Errores**: \`ValueError\` para datos inválidos (título vacío) y un error propio (\`TareaNoEncontrada\`) para ids que no existen. Un error propio permite que quien llama distinga *qué* ha pasado.
- **JSON**: la prioridad se guarda por **nombre** (\`"ALTA"\`), no por número: es más legible y robusto. \`Tarea.a_dict()\` y \`Tarea.desde_dict()\` convierten en ambos sentidos.
- **Interfaz**: los comandos son frases como \`agregar Comprar pan\`, \`completar 1\` o \`listar\`. Una función \`ejecutar(gestor, linea)\` los interpreta y **devuelve el texto** a mostrar (así es fácil de probar: no usa \`input\` ni \`print\`).
`,
      ),
      mc('¿Por qué conviene que `ejecutar(gestor, linea)` devuelva un texto en vez de imprimirlo?', ['Porque `print` está prohibido', 'Porque así es fácil de probar automáticamente y reutilizar (consola, web, tests…)', 'Porque es más rápido', 'Porque `print` no funciona dentro de funciones'], 1, 'Separar «calcular el mensaje» de «mostrarlo» permite probar la lógica con `assertEqual` y cambiar la interfaz sin tocarla.'),
      tf('Es mejor guardar la prioridad en el JSON como número (3) que como nombre ("ALTA"), porque el nombre puede cambiar.', false, 'El nombre es más legible y, si reordenas el `Enum`, los números guardados cambiarían de significado. Guardar por nombre es más robusto.'),
      fill('Completa para guardar los datos en un archivo JSON', 'with open("tareas.json", "w", encoding="utf-8") as f:\n    json.___(datos, f, ensure_ascii=False)', ['dump', 'dumps', 'load', 'write'], ['dump'], '`json.dump(obj, archivo)` escribe en un archivo; `dumps` devuelve un texto.'),
      match(
        'Une cada pieza del proyecto con su responsabilidad',
        [
          ['dataclass Tarea', 'Representa los datos'],
          ['Gestor', 'Reglas y operaciones sobre las tareas'],
          ['json.dump / json.load', 'Guardar y recuperar del disco'],
          ['unittest.TestCase', 'Comprobar que todo funciona'],
        ],
        'Cada parte tiene un solo motivo para cambiar: ese es el secreto de un diseño mantenible.',
      ),
      pyPractice({
        goal: 'Serializar una tarea',
        prompt: 'Completa el dataclass `Tarea` con el método `a_dict()` (diccionario con `id`, `titulo`, `prioridad` —por **nombre**— y `hecha`) y el **método de clase** `desde_dict(d)` que reconstruye la tarea. Ida y vuelta debe dar una tarea igual.',
        starter: c`
from dataclasses import dataclass
from enum import IntEnum

class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3

@dataclass
class Tarea:
    id: int
    titulo: str
    prioridad: Prioridad = Prioridad.MEDIA
    hecha: bool = False

    # Añade a_dict y desde_dict
` + '\n',
        check: all(cls('Tarea', ['a_dict', 'desde_dict']), calls([['Tarea(1, "x", Prioridad.ALTA).a_dict()', "{'id': 1, 'titulo': 'x', 'prioridad': 'ALTA', 'hecha': False}"], ['Tarea.desde_dict(Tarea(2, "y", Prioridad.BAJA, True).a_dict()) == Tarea(2, "y", Prioridad.BAJA, True)', 'True'], ['Tarea.desde_dict({"id": 3, "titulo": "z", "prioridad": "MEDIA", "hecha": False}).prioridad', '<Prioridad.MEDIA: 2>']]), uses('decorator:classmethod')),
        solution: c`
from dataclasses import dataclass
from enum import IntEnum

class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3

@dataclass
class Tarea:
    id: int
    titulo: str
    prioridad: Prioridad = Prioridad.MEDIA
    hecha: bool = False

    def a_dict(self):
        return {"id": self.id, "titulo": self.titulo, "prioridad": self.prioridad.name, "hecha": self.hecha}

    @classmethod
    def desde_dict(cls, d):
        return cls(d["id"], d["titulo"], Prioridad[d["prioridad"]], d["hecha"])
`,
        hints: ['La prioridad se guarda con `self.prioridad.name` y se recupera con `Prioridad[nombre]`.', '`desde_dict` es un `@classmethod`: construye con `cls(...)`.'],
        explain: 'Un objeto de tu dominio no se puede escribir directamente en JSON; hay que traducirlo a tipos simples (dict, str, int, bool) y volver.',
        commands: ['dataclasses.dataclass'],
      }),
      pyPractice({
        goal: 'Guardar y cargar',
        prompt: 'Al gestor base le faltan `guardar(ruta)` y el **método de clase** `cargar(ruta)`. Escríbelos: `guardar` escribe la lista de tareas (`a_dict`) como JSON y `cargar` devuelve un `Gestor` nuevo con las tareas leídas. Deja el programa de abajo tal cual.',
        starter: c`
import json
from dataclasses import dataclass
from enum import IntEnum

class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3

@dataclass
class Tarea:
    id: int
    titulo: str
    prioridad: Prioridad = Prioridad.MEDIA
    hecha: bool = False

    def a_dict(self):
        return {"id": self.id, "titulo": self.titulo, "prioridad": self.prioridad.name, "hecha": self.hecha}

    @classmethod
    def desde_dict(cls, d):
        return cls(d["id"], d["titulo"], Prioridad[d["prioridad"]], d["hecha"])

class Gestor:
    def __init__(self):
        self.tareas = []

    def agregar(self, titulo, prioridad=Prioridad.MEDIA):
        tarea = Tarea(len(self.tareas) + 1, titulo, prioridad)
        self.tareas.append(tarea)
        return tarea

    # Añade guardar(self, ruta) y el método de clase cargar(cls, ruta)

g = Gestor()
g.agregar("Comprar pan")
g.agregar("Entregar informe", Prioridad.ALTA)
g.tareas[0].hecha = True
g.guardar("tareas.json")
g2 = Gestor.cargar("tareas.json")
print(len(g2.tareas), g2.tareas == g.tareas)
print(g2.tareas[1].prioridad.name)
` + '\n',
        check: all(stdout('2 True\nALTA'), file('tareas.json', { exists: true, includes: ['"titulo"', '"ALTA"'] }), uses('call:open', 2)),
        solution: GESTOR_BASE.replace('        if not titulo.strip():\n            raise ValueError("El título no puede estar vacío")\n        tarea = Tarea(len(self.tareas) + 1, titulo.strip(), prioridad)', '        tarea = Tarea(len(self.tareas) + 1, titulo, prioridad)') + c`


g = Gestor()
g.agregar("Comprar pan")
g.agregar("Entregar informe", Prioridad.ALTA)
g.tareas[0].hecha = True
g.guardar("tareas.json")
g2 = Gestor.cargar("tareas.json")
print(len(g2.tareas), g2.tareas == g.tareas)
print(g2.tareas[1].prioridad.name)
`,
        hints: ['`json.dump([t.a_dict() for t in self.tareas], f, ensure_ascii=False)` dentro de un `with open(ruta, "w", ...)`.', '`cargar` lee con `json.load(f)` y crea las tareas con `Tarea.desde_dict`.'],
        explain: 'Persistir es solo traducir a tipos simples, escribir y, al recuperar, volver a construir los objetos. La lógica del gestor ni se entera de que existe un archivo.',
        commands: ['json.dump', 'json.load'],
      }),
      pyPractice({
        goal: 'Interpretar comandos',
        prompt: 'Escribe `ejecutar(gestor, linea)`, que interprete un comando y **devuelva** el texto a mostrar:\n\n- `agregar <título>` → `Añadida #<id>: <título>`\n- `completar <id>` → `Completada #<id>`\n- `listar` → `Pendientes:` y una línea `#<id> <título>` por tarea pendiente (o `No hay tareas pendientes`)\n- si el comando no existe → `Comando desconocido`\n- si el id no existe o el título está vacío → `Error: <mensaje de la excepción>`',
        starter: GESTOR_BASE + '\n\n# Escribe aquí ejecutar(gestor, linea)\n',
        check: all(func('ejecutar', 2), calls([
          ['(lambda g: [ejecutar(g, "agregar Comprar pan"), ejecutar(g, "agregar Estudiar"), ejecutar(g, "completar 1"), ejecutar(g, "listar")])(Gestor())', "['Añadida #1: Comprar pan', 'Añadida #2: Estudiar', 'Completada #1', 'Pendientes:\\n#2 Estudiar']"],
          ['ejecutar(Gestor(), "listar")', "'No hay tareas pendientes'"],
          ['ejecutar(Gestor(), "volar")', "'Comando desconocido'"],
          ['ejecutar(Gestor(), "completar 9")', "'Error: Tarea 9 no encontrada'"],
          ['ejecutar(Gestor(), "agregar   ")', "'Error: El título no puede estar vacío'"],
        ])),
        solution: GESTOR_BASE + c`


def ejecutar(gestor, linea):
    comando, _, resto = linea.strip().partition(" ")
    try:
        if comando == "agregar":
            tarea = gestor.agregar(resto)
            return f"Añadida #{tarea.id}: {tarea.titulo}"
        if comando == "completar":
            tarea = gestor.completar(int(resto))
            return f"Completada #{tarea.id}"
        if comando == "listar":
            pendientes = gestor.pendientes()
            if not pendientes:
                return "No hay tareas pendientes"
            return "\n".join(["Pendientes:"] + [f"#{t.id} {t.titulo}" for t in pendientes])
    except (ValueError, KeyError) as e:
        return f"Error: {e.args[0]}"
    return "Comando desconocido"
`,
        hints: ['`comando, _, resto = linea.strip().partition(" ")` separa la primera palabra del resto.', 'Envuelve las operaciones en `try` y captura `ValueError` y `KeyError`; el mensaje de un `KeyError` está en `e.args[0]` (si usas `str(e)` saldría entre comillas).'],
        explain: 'Una función que recibe texto y devuelve texto es trivial de probar y de enchufar a cualquier interfaz: consola, web, bot de chat…',
        commands: ['str.split', 'raise'],
      }),
      pyPractice({
        goal: 'Prueba tu gestor',
        prompt: 'Escribe `TestGestor` con **al menos 4 tests** del `Gestor` (incluye uno con `assertRaises` y otro con `setUp`). Todos deben pasar: el programa de abajo debe imprimir `True True`.',
        starter: GESTOR_BASE + c`


import io
import unittest

# Escribe aquí la clase TestGestor

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestGestor)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 4, r.wasSuccessful())
` + '\n',
        check: all(cls('TestGestor'), stdout('True True'), uses('method:assertRaises'), truthy("'setUp' in TestGestor.__dict__")),
        solution: GESTOR_BASE + c`


import io
import unittest

class TestGestor(unittest.TestCase):
    def setUp(self):
        self.g = Gestor()
        self.g.agregar("Comprar pan")
        self.g.agregar("Entregar informe", Prioridad.ALTA)

    def test_ids_correlativos(self):
        self.assertEqual([t.id for t in self.g.tareas], [1, 2])

    def test_titulo_vacio(self):
        with self.assertRaises(ValueError):
            self.g.agregar("   ")

    def test_completar_inexistente(self):
        with self.assertRaises(KeyError):
            self.g.completar(99)

    def test_pendientes_por_prioridad(self):
        self.assertEqual([t.titulo for t in self.g.pendientes()], ["Entregar informe", "Comprar pan"])

    def test_completar(self):
        self.g.completar(1)
        self.assertEqual([t.id for t in self.g.pendientes()], [2])

suite = unittest.defaultTestLoader.loadTestsFromTestCase(TestGestor)
r = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
print(r.testsRun >= 4, r.wasSuccessful())
`,
        hints: ['En `setUp` crea un `Gestor` y añade un par de tareas: se rehace antes de cada test.', 'Prueba lo bueno (ids, orden de `pendientes`, `completar`) y lo malo (`assertRaises(ValueError)` con título vacío, `KeyError` con id inexistente).'],
        explain: 'Con estos tests puedes refactorizar el gestor con tranquilidad: si algo se rompe, un test se pondrá en rojo.',
        commands: ['unittest.TestCase'],
      }),
      pyCode('Guarda en `titulos` la lista de títulos de las tareas **pendientes** de `g`, en el orden de `g.pendientes()`.', {
        starter: GESTOR_BASE + c`


g = Gestor()
g.agregar("A")
g.agregar("B", Prioridad.ALTA)
g.agregar("C")
g.completar(1)
` + '\n',
        check: all(variable('titulos', "['B', 'C']")),
        solution: GESTOR_BASE + c`


g = Gestor()
g.agregar("A")
g.agregar("B", Prioridad.ALTA)
g.agregar("C")
g.completar(1)
titulos = [t.titulo for t in g.pendientes()]
`,
        hint: 'Una comprensión sobre `g.pendientes()`.',
        why: 'Gracias a la clase `Gestor`, quien la usa no sabe cómo se ordenan ni se filtran las tareas: solo pide las pendientes.',
      }),
    ]),
  ],
  boss: {
    goal: 'Misión final: el gestor de tareas',
    prompt:
      'Es la prueba final del curso. Escribe **desde cero** el gestor de tareas:\n\n- `ErrorTarea(Exception)` y `TareaNoEncontrada(ErrorTarea)` (esta con el mensaje `Tarea <id> no encontrada`).\n- `Prioridad` (`IntEnum`): `BAJA = 1`, `MEDIA = 2`, `ALTA = 3`.\n- `Tarea` (dataclass): `id`, `titulo`, `prioridad` (por defecto `MEDIA`), `hecha` (por defecto `False`), con `a_dict()` y el método de clase `desde_dict(d)` (la prioridad se guarda **por nombre**).\n- `Gestor` con la lista `tareas` y los métodos: `agregar(titulo, prioridad=MEDIA)` (ids correlativos desde 1; título vacío o en blanco → `ValueError("El título no puede estar vacío")`), `completar(id)` (si no existe → `TareaNoEncontrada`), `pendientes()` (no hechas, de **mayor a menor prioridad** y, a igual prioridad, por id), `guardar(ruta)` (JSON) y el método de clase `cargar(ruta)`. Al cargar, los ids nuevos deben continuar tras los existentes.\n\nDeja el programa de abajo tal cual.',
    starter: c`
# Escribe aquí ErrorTarea, TareaNoEncontrada, Prioridad, Tarea y Gestor

g = Gestor()
g.agregar("Comprar pan")
g.agregar("Entregar informe", Prioridad.ALTA)
g.agregar("Llamar a Ana", Prioridad.BAJA)
g.completar(1)
for t in g.pendientes():
    print(t.id, t.titulo, t.prioridad.name)
try:
    g.completar(99)
except TareaNoEncontrada as e:
    print("Error:", e)
try:
    g.agregar("  ")
except ValueError as e:
    print("Error:", e)
g.guardar("tareas.json")
g2 = Gestor.cargar("tareas.json")
print(len(g2.tareas), g2.agregar("Nueva").id)
print([t.hecha for t in g2.tareas])
` + '\n',
    check: all(
      cls('ErrorTarea'),
      cls('TareaNoEncontrada'),
      cls('Prioridad'),
      cls('Tarea', ['a_dict', 'desde_dict']),
      cls('Gestor', ['agregar', 'completar', 'pendientes', 'guardar', 'cargar']),
      truthy('issubclass(TareaNoEncontrada, ErrorTarea) and issubclass(ErrorTarea, Exception)'),
      stdout('2 Entregar informe ALTA\n3 Llamar a Ana BAJA\nError: Tarea 99 no encontrada\nError: El título no puede estar vacío\n3 4\n[True, False, False, False]'),
      file('tareas.json', { exists: true, includes: ['"ALTA"', '"Llamar a Ana"'] }),
      uses('decorator:dataclass'),
    ),
    solution: c`
import json
from dataclasses import dataclass
from enum import IntEnum


class ErrorTarea(Exception):
    pass


class TareaNoEncontrada(ErrorTarea):
    def __init__(self, id):
        super().__init__(f"Tarea {id} no encontrada")
        self.id = id


class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3


@dataclass
class Tarea:
    id: int
    titulo: str
    prioridad: Prioridad = Prioridad.MEDIA
    hecha: bool = False

    def a_dict(self):
        return {"id": self.id, "titulo": self.titulo, "prioridad": self.prioridad.name, "hecha": self.hecha}

    @classmethod
    def desde_dict(cls, d):
        return cls(d["id"], d["titulo"], Prioridad[d["prioridad"]], d["hecha"])


class Gestor:
    def __init__(self):
        self.tareas = []

    def _siguiente_id(self):
        return max((t.id for t in self.tareas), default=0) + 1

    def agregar(self, titulo, prioridad=Prioridad.MEDIA):
        if not titulo.strip():
            raise ValueError("El título no puede estar vacío")
        tarea = Tarea(self._siguiente_id(), titulo.strip(), prioridad)
        self.tareas.append(tarea)
        return tarea

    def completar(self, id):
        for t in self.tareas:
            if t.id == id:
                t.hecha = True
                return t
        raise TareaNoEncontrada(id)

    def pendientes(self):
        return sorted((t for t in self.tareas if not t.hecha), key=lambda t: (-t.prioridad, t.id))

    def guardar(self, ruta):
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump([t.a_dict() for t in self.tareas], f, ensure_ascii=False, indent=2)

    @classmethod
    def cargar(cls, ruta):
        g = cls()
        with open(ruta, encoding="utf-8") as f:
            g.tareas = [Tarea.desde_dict(d) for d in json.load(f)]
        return g


g = Gestor()
g.agregar("Comprar pan")
g.agregar("Entregar informe", Prioridad.ALTA)
g.agregar("Llamar a Ana", Prioridad.BAJA)
g.completar(1)
for t in g.pendientes():
    print(t.id, t.titulo, t.prioridad.name)
try:
    g.completar(99)
except TareaNoEncontrada as e:
    print("Error:", e)
try:
    g.agregar("  ")
except ValueError as e:
    print("Error:", e)
g.guardar("tareas.json")
g2 = Gestor.cargar("tareas.json")
print(len(g2.tareas), g2.agregar("Nueva").id)
print([t.hecha for t in g2.tareas])
`,
    hints: [
      'Empieza por los datos: `ErrorTarea`, `TareaNoEncontrada` (con `super().__init__(f"Tarea {id} no encontrada")`), `Prioridad` y el dataclass `Tarea`.',
      '`pendientes()`: `sorted(..., key=lambda t: (-t.prioridad, t.id))` ordena de mayor a menor prioridad y, si empatan, por id.',
      'Para el id siguiente usa `max((t.id for t in self.tareas), default=0) + 1`: así, tras `cargar`, los ids continúan. Y recuerda guardar la prioridad por nombre en el JSON.',
    ],
    explain: '🏆 Has terminado el curso. Este programa reúne casi todo lo aprendido: **clases y herencia** (excepciones propias), **dataclass y Enum**, **comprensiones y ordenación con clave**, **excepciones**, **archivos y JSON**, **métodos de clase** y buen diseño por capas. Solo te falta seguir construyendo cosas: ¡enhorabuena, ya programas en Python!',
    commands: ['dataclasses.dataclass', 'json.dump', 'raise', 'unittest.TestCase'],
  },
});
