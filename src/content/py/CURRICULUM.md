# Curso de Python de Dev Dojo — plan

12 zonas (mundos) × 5 lecciones. Español. Del primer `print()` a clases, generadores, decoradores, asyncio y pruebas.
Mismo formato y nivel de calidad que el curso de Linux (`src/content/worlds/w1.ts … w12.ts`): léelos como modelo de tono, ritmo y estructura.

| Zona | Título | Nivel | Color | Emoji |
| --- | --- | --- | --- | --- |
| py1 | Hola, Python | basico | #5AA9FF | 🐍 |
| py2 | Decisiones | basico | #FFD43B | 🔀 |
| py3 | Bucles | basico | #22D3A6 | 🔁 |
| py4 | Colecciones | basico | #FB923C | 📦 |
| py5 | Funciones | intermedio | #A78BFA | 🧩 |
| py6 | Comprensiones y estilo pythónico | intermedio | #F472B6 | ✨ |
| py7 | Errores y archivos | intermedio | #38BDF8 | 🛡️ |
| py8 | Módulos y la biblioteca estándar | intermedio | #4ADE80 | 📚 |
| py9 | Objetos y clases | avanzado | #FBBF24 | 🏛️ |
| py10 | Diseño de datos | avanzado | #F87171 | 🧱 |
| py11 | Iteradores, generadores y decoradores | avanzado | #2DD4BF | 🌀 |
| py12 | Maestría | avanzado | #C084FC | 🏆 |

## Lecciones (id · título · conceptos · ilustración sugerida)

**py1 Hola, Python**
1. py1-1 Tu primer programa — print, comentarios, ejecutar un script, leer un error de sintaxis simple.
2. py1-2 Variables y nombres — asignación, nombres válidos y snake_case, reasignar, `type()`. *(py-variables-labels)*
3. py1-3 Números y operadores — int/float, `+ - * / // % **`, precedencia, `round/abs/divmod`, `+=`. *(py-precedence)*
4. py1-4 Texto (str) — comillas, escapes, `+` y `*`, `len`, índices y rebanadas, métodos (`upper strip replace split join find startswith`), inmutabilidad. *(py-str-index)*
5. py1-5 Entrada y salida — `input()`, conversiones `int() float() str()`, f-strings con formato (`:.2f`, `:>8`), `print(sep=, end=)`. Usa `setup: { stdin: [...] }` en los retos.

**py2 Decisiones**
1. py2-1 Verdadero o falso — bool, comparaciones (también encadenadas), `is None`.
2. py2-2 if, elif, else — bloques e indentación, anidación. *(py-if-flow)*
3. py2-3 and, or, not — lógicos, cortocircuito, valores «falsy» y «truthy».
4. py2-4 Pertenencia, identidad y ternario — `in`, `not in`, `is`, expresión condicional.
5. py2-5 Menús y validaciones — mini-proyecto (año bisiesto, IMC, calculadora); introduce `match/case` básico como alternativa a if/elif.

**py3 Bucles**
1. py3-1 while — condición, contador, bucles infinitos, `break`.
2. py3-2 for y range — iterar textos y listas, `range(inicio, fin, paso)`, `enumerate` intro. *(py-loop-flow)*
3. py3-3 break, continue y else — control fino de bucles.
4. py3-4 Acumuladores y patrones — sumas, conteos, máximos, búsqueda, centinelas, `sum/min/max`.
5. py3-5 Bucles anidados — tablas, triángulos, primos, FizzBuzz completo.

**py4 Colecciones**
1. py4-1 Listas — crear, índices, rebanadas, `append insert remove pop sort sorted`, `in`. *(py-collections)*
2. py4-2 Tuplas y desempaquetado — inmutabilidad, desempaquetar, intercambio, `*resto`, `zip`.
3. py4-3 Diccionarios — acceso, `get`, `items/keys/values`, añadir/borrar, recorrer, contar con dict.
4. py4-4 Conjuntos — `set`, operaciones `| & - ^`, eliminar duplicados, pertenencia rápida.
5. py4-5 Mutabilidad y copias — alias, `copy`, `deepcopy`, listas anidadas, trampas. *(py-mutability)*

**py5 Funciones**
1. py5-1 Definir funciones — `def`, parámetros, `return`, docstrings, `None`.
2. py5-2 Argumentos — posicionales, nombrados, por defecto (y la trampa del valor mutable), `*args`, `**kwargs`.
3. py5-3 Alcance y closures — LEGB, `global`, `nonlocal`, funciones anidadas. *(py-scope-legb)*
4. py5-4 Funciones de primera clase — funciones como valores, `lambda`, `sorted(key=)`, `map`, `filter`.
5. py5-5 Recursión — caso base, factorial, Fibonacci, límite de recursión. *(py-call-stack)*

**py6 Comprensiones y estilo pythónico**
1. py6-1 List comprehensions — sintaxis, condición, anidadas. *(py-comprehension)*
2. py6-2 Dict/set comprehensions y generadoras — `{k: v …}`, `{x …}`, `(x for …)` con `sum/any/all`.
3. py6-3 Iteración elegante — `zip`, `enumerate`, `reversed`, `sorted`, `any/all`.
4. py6-4 Desempaquetado y sintaxis moderna — `*` y `**`, operador morsa `:=`, f-strings avanzadas (`=`, `!r`), `match/case` con patrones.
5. py6-5 Estilo pythónico — PEP 8, nombres, EAFP vs LBYL, docstrings, `if __name__ == "__main__"`.

**py7 Errores y archivos**
1. py7-1 Excepciones — leer un traceback, errores comunes, `try/except`. *(py-exceptions-flow)*
2. py7-2 else, finally y raise — `raise`, volver a lanzar, `from`, `assert`, orden de ejecución.
3. py7-3 Excepciones propias — heredar de `Exception`, jerarquías, buenas prácticas.
4. py7-4 Archivos de texto — `open`, `with`, `read/readline/write`, modos, recorrer líneas. *(py-file-modes)*
5. py7-5 JSON, CSV y pathlib — `json.dumps/loads`, `csv`, `Path`.

**py8 Módulos y la biblioteca estándar**
1. py8-1 import y módulos propios — `import/from/as`, tu propio módulo (archivo en el cwd), `__name__`, paquetes. *(py-import-path)*
2. py8-2 math, random y statistics — `sqrt floor ceil`, `randint choice shuffle seed`, `mean median`.
3. py8-3 datetime y time — fechas, `timedelta`, formato, aritmética (la fecha «hoy» es la del reloj virtual: evita depender de ella en las comprobaciones).
4. py8-4 collections e itertools — `Counter defaultdict deque namedtuple`, `product permutations combinations chain groupby`.
5. py8-5 Expresiones regulares — `re.search/match/findall/sub`, grupos, patrones comunes.

**py9 Objetos y clases**
1. py9-1 Tu primera clase — `class`, `__init__`, `self`, atributos, métodos. *(py-class-instance)*
2. py9-2 Atributos y @property — atributos de clase vs instancia, propiedades, encapsulación por convención.
3. py9-3 Herencia y polimorfismo — subclases, `super()`, sobrescribir, `isinstance`, MRO. *(py-mro)*
4. py9-4 Métodos especiales — `__repr__ __str__ __eq__ __lt__ __len__ __getitem__ __iter__ __add__ __contains__ __call__`.
5. py9-5 classmethod, staticmethod y composición — constructores alternativos, composición vs herencia.

**py10 Diseño de datos**
1. py10-1 dataclasses — `@dataclass`, `field`, `frozen`, `order`, `__post_init__`.
2. py10-2 Enum — `Enum`, `auto`, miembros con valores, comparar, iterar.
3. py10-3 Abstracción y duck typing — `abc.ABC`, `abstractmethod`, `Protocol`, interfaces implícitas.
4. py10-4 Anotaciones de tipo — `list[int]`, `X | None`, `Optional`, `Callable`, `TypedDict`; qué hacen y qué no (no se comprueban al ejecutar).
5. py10-5 Hashable, inmutable y proyecto de datos — `__hash__/__eq__`, conjuntos de objetos, mini-proyecto de inventario.

**py11 Iteradores, generadores y decoradores**
1. py11-1 El protocolo de iteración — `__iter__/__next__`, `iter()`, `next()`, `StopIteration`. *(py-iterator-protocol)*
2. py11-2 Generadores — `yield`, expresiones generadoras, perezosos, `yield from`, `send`. *(py-generator-pause)*
3. py11-3 Closures y decoradores — funciones que devuelven funciones, `@decorador`, `functools.wraps`, con argumentos. *(py-decorator-wrap)*
4. py11-4 Context managers — `with`, `__enter__/__exit__`, `contextlib.contextmanager`, `suppress`.
5. py11-5 functools e itertools — `lru_cache`, `partial`, `reduce`, `islice`, `chain`, `accumulate`, `groupby`.

**py12 Maestría**
1. py12-1 Pruebas con unittest — `TestCase`, aserciones, `setUp`, leer el resultado, mini-TDD.
2. py12-2 asyncio — `async def`, `await`, `gather`, `create_task`, cuándo sirve. *(py-event-loop)*
3. py12-3 Complejidad y rendimiento — Big-O, lista vs set/dict, memoización, `functools.cache`. *(py-recursion-tree, py-big-o)*
4. py12-4 Algoritmos clásicos — búsqueda binaria, ordenamientos, BFS/DFS con `dict` y `deque`, `heapq`, programación dinámica sencilla.
5. py12-5 Proyecto final — gestor de tareas por consola con clases, JSON, excepciones y pruebas; la misión final de la zona lo valida.

## Convenciones de ids
- Zona: `py1`…`py12` (`index` 1…12). Lección: `py1-1`…`py12-5`. Reto auto-numerado `py1-1-p1`; misión final `py1-boss`.
- `lesson(...).commands`: nombres (de funciones, métodos, sentencias o módulos) que la lección enseña; deben existir como fichas en la biblioteca de Python (`src/content/py/reference.ts`). Usa nombres canónicos: `print`, `len`, `str.split`, `list.append`, `dict.get`, `set.add`, `json.dumps`, `functools.lru_cache`, `asyncio.run`, `if`, `for`, `try`, `class`, `def`, `yield`, `with`…
