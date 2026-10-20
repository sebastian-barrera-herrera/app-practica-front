# pyengine — Python 3.13 en TypeScript

Intérprete de Python **escrito desde cero en TypeScript** que corre dentro de la app (React Native, Hermes) y en la web, **sin servidor y sin código nativo**. Sirve al curso de Python de Dev Dojo: ejecuta el código del alumno, comprueba los retos y alimenta el laboratorio, el REPL y la biblioteca.

El objetivo no es «un Python parecido», sino **ser fiel a CPython 3.13**: mismos resultados, mismos mensajes de error y mismos *tracebacks*. Esa fidelidad se comprueba con pruebas *golden* contra `python3`.

## Arquitectura

```
código fuente
  → lexer.ts / parser.ts        tokens y AST (misma nomenclatura que el módulo `ast` de CPython)
  → mangle.ts                   renombrado de nombres privados (__x → _Clase__x)
  → scope.ts                    análisis de ámbitos (local / env / global / builtin, cell vars, nonlocal…)
  → compile*.ts                 AST → cierres de JS (compile.ts, compile_expr.ts, compile_stmt.ts)
                                  y variantes con generadores de JS para funciones suspendibles (compile_gen.ts)
  → runtime/                    objetos y tipos (PyType, MRO, descriptores), builtins, excepciones, ops, vfs…
  → stdlib/                     módulos nativos en TS + pylib.generated.ts (módulos de CPython empaquetados)
  → session.ts                  PySession: ejecutar, REPL, entrada, archivos, comprobaciones de retos
```

- **Compilación a cierres**: cada nodo del AST se convierte en una función de JS que ejecuta ese nodo; es mucho más rápido que interpretar el árbol y no depende de generar código JS en tiempo de ejecución (`eval`/`new Function`), que no es fiable en móvil.
- **Generadores y `async`** usan generadores de JS (`function*`): `yield`/`await` suspenden el marco; `asyncio` corre sobre un bucle de eventos **virtual** (`scripts/gen_asyncio_loop.py`), así que `asyncio.sleep(2)` no espera de verdad y el tiempo es determinista.
- **Tracebacks exactos**: columnas con `~~~^^^`, causas encadenadas, `except*`, notas, `SyntaxError` con la misma posición que CPython.
- **Sistema de archivos virtual** (`runtime/vfs.ts`): `open`, `pathlib`, `os`, `csv`, `json`… escriben en memoria; el alumno nunca toca el dispositivo. Cada `PySession` parte de los archivos que le indique el reto (`setup.files`).
- **Reloj virtual** y `input()` reproducible (`setup.stdin`): los retos son deterministas y corregibles automáticamente.
- **Biblioteca estándar híbrida**: los módulos puramente Python de CPython (`unittest`, `dataclasses`, `enum`, `typing`, `argparse`, `textwrap`, `pickle`, `doctest`, `ast`, `traceback`…) se **empaquetan tal cual** (sin comentarios ni líneas en blanco) y se ejecutan con el propio motor; los que necesitan C (`math`, `re`, `itertools`, `_io`, `time`, `struct`, `hashlib`, `_codecs`…) están escritos en TS en `stdlib/`; algunos módulos del sistema (`socket`, `subprocess`, `threading`, `signal`…) son versiones propias mínimas en `pylib/`.

## Qué soporta

Sintaxis completa de 3.13 (f-strings anidadas, `match`/`case`, `:=`, `async`, `except*`, genéricos `def f[T]`, `type X = …`), todos los tipos nativos con su semántica (enteros de precisión arbitraria, `float` con `repr` exacto, `str` Unicode, `bytes`, `memoryview`, `dict` ordenado, `set`, `complex`, `Fraction`/`Decimal` vía stdlib…), clases con metaclases y descriptores, `__slots__`, `super()`, `contextvars`, `functools`, `itertools`, `collections`, `re`, `datetime`, `json`, `csv`, `random` (mismo generador Mersenne Twister, mismas secuencias con la misma semilla), `statistics`, `unittest`, `asyncio`, `codecs`/`encodings`, etc. El módulo `ast` es real (se genera `pylib/_ast.py` con `scripts/gen_ast.py` y se convierte con `runtime/astconv.ts`).

## Límites conocidos

- **Hilos síncronos**: `threading` y `concurrent.futures` existen pero se ejecutan sin interleaving real.
- Sin extensiones nativas ni red real: `sqlite3`, `zlib`, `xml.parsers.expat`, `ssl`, `ctypes`, `tkinter`… no están (se verá `ModuleNotFoundError`).
- La tabla de nombres Unicode (`\N{…}`, `unicodedata.name`) es un subconjunto.
- Rendimiento: del orden de decenas de millones de operaciones simples por segundo en escritorio; el primer `import` de módulos grandes (`unittest`, `dataclasses`, `asyncio`) cuesta entre decenas y cientos de ms (hay caché de AST por proceso). En móvil es varias veces más lento.
- Límite de pasos y de recursión configurables (`PySession`): los bucles infinitos se cortan.

## Probar

```bash
npx jest src/pyengine           # incluye golden.test.ts
npx jest src/content/__tests__/python.test.ts   # ejecuta todo el curso con el motor
```

### Pruebas *golden* (comparación con CPython)

`__tests__/golden/*.py` son programas que ejercitan una zona del lenguaje; `*.expected.json` guarda la salida (stdout + stderr) que dio **CPython 3.13**. `golden.test.ts` exige que el motor produzca exactamente lo mismo (tras normalizar tiempos y direcciones).

Con Bun y `python3` (3.13) instalados:

```bash
bun src/pyengine/__tests__/tools/diff.ts [filtro]          # compara el motor con python3 en vivo
bun src/pyengine/__tests__/tools/diff.ts [filtro] --bless  # y guarda las salidas de CPython como esperadas
bun src/pyengine/__tests__/tools/run.ts archivo.py         # ejecuta un .py con el motor
SHOWHIDDEN=1 bun .../run.ts archivo.py                      # muestra también los marcos ocultos de la stdlib
```

Cuando encuentres una diferencia con CPython: **añade un `.py` golden** que la reproduzca, arregla el motor, ejecuta `diff.ts --bless` y confirma que solo cambia lo esperado.

## Ampliar la biblioteca estándar

1. Si el módulo es Python puro en CPython: añádelo a `pylib/manifest.json` (`"nombre": "std:ruta"`, o `"…!pkg"` para paquetes) y ejecuta `python3 scripts/build_pylib.py`. Si el módulo de la versión pura se comporta distinto que el de C, añade un parche mínimo en `PATCHES` de ese script (por ejemplo, los mensajes de error de `_pydatetime`).
2. Si necesita código nativo: escribe el módulo en `stdlib/<nombre>.ts` (ver `stdlib/helpers.ts`: `mfn`, `mconst`) y regístralo en `stdlib/all.ts`.
3. Módulos propios en Python: `pylib/<nombre>.py` con `"nombre": "own:<nombre>.py"` en el manifiesto.
4. Añade un golden que lo ejercite.

`stdlib/pylib.generated.ts` (≈3 MB) se **genera**: no se edita a mano ni conviene buscarlo con `grep` a ciegas.

## Utilidades de desarrollo (`__tests__/tools`)

`diff.ts` (golden), `run.ts` (ejecutar), `repl.ts` (sesión interactiva), `astcorpus.ts` (compara el AST con el de CPython sobre un corpus), `cmpcols.ts` (columnas de tracebacks), `compilecheck.ts`, `parsebench.ts` e `imports.ts` (mide el coste de importar cada módulo). No forman parte del *build* de la app (están excluidas de `tsc`).
