import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, calls, cls, file, func, outHas, stdout, truthy, uses, variable } from '../pycheck';

export const py7 = pyWorld({
  id: 'py7',
  index: 7,
  title: 'Errores y archivos',
  subtitle: 'Programas que no se rompen y recuerdan datos',
  emoji: '🛡️',
  color: '#38BDF8',
  level: 'intermedio',
  intro:
    'Los programas reales se enfrentan a lo inesperado: el usuario escribe letras donde esperabas un número, el archivo no existe, el dato viene incompleto. En esta zona aprenderás a **leer los errores**, a **anticiparlos y tratarlos** sin que el programa se caiga, y a **guardar información** en archivos de texto, JSON y CSV.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py7-1', { title: 'Excepciones', summary: 'Leer un traceback y capturar errores con try/except', emoji: '🚨', commands: ['try', 'except', 'ValueError', 'TypeError', 'IndexError', 'KeyError', 'ZeroDivisionError'], minutes: 12 }, [
      learn(
        'Cuando algo sale mal: el traceback',
        `
Cuando Python no puede continuar lanza una **excepción**. Si nadie la trata, el programa se detiene y muestra un **traceback**: el rastro de las llamadas que llevaron hasta el fallo.

Cómo leerlo (de **abajo hacia arriba**):

1. **La última línea** es lo más importante: el **tipo** de error y su **mensaje**.
2. Justo encima, la línea de código exacta donde ocurrió.
3. Las líneas anteriores muestran **quién llamó a quién** (la última llamada es la más reciente: *most recent call last*).
`,
        '🚨',
      ),
      pyDemo('Un traceback con varias llamadas', [pyErr('def dividir(a, b):\n    return a / b\n\ndef calcular():\n    return dividir(10, 0)\n\ncalcular()', 'Lee primero la última línea (ZeroDivisionError). Luego sube: el fallo está en `dividir`, llamada desde `calcular`')]),
      illus('py-exceptions-flow', 'El camino de una excepción', 'Si nadie la captura, sube por las llamadas hasta detener el programa.'),
      learn(
        'Los errores más comunes',
        `
| Excepción | Cuándo ocurre |
|---|---|
| \`SyntaxError\` | El código está mal escrito (antes de ejecutar) |
| \`NameError\` | Usas un nombre que no existe |
| \`TypeError\` | Operación con un tipo inadecuado (\`"a" + 1\`) |
| \`ValueError\` | Tipo correcto, valor inadecuado (\`int("abc")\`) |
| \`IndexError\` | Posición fuera de rango (\`[1, 2][5]\`) |
| \`KeyError\` | Clave inexistente en un diccionario |
| \`ZeroDivisionError\` | Dividir entre cero |
| \`AttributeError\` | El objeto no tiene ese atributo o método |
| \`FileNotFoundError\` | El archivo no existe |
`,
      ),
      pyDemo('Una galería de errores', [
        pyErr('int("abc")', '`ValueError`', true),
        pyErr('[1, 2, 3][5]', '`IndexError`', true),
        pyErr('{"a": 1}["b"]', '`KeyError`', true),
        pyErr('"hola".saltar()', '`AttributeError`', true),
        pyErr('len(5)', '`TypeError`', true),
        pyErr('10 / 0', '`ZeroDivisionError`', true),
      ]),
      learn(
        'try / except: tratar lo inesperado',
        `
Con **\`try\`/\`except\`** pruebas un bloque y decides qué hacer si falla:

\`\`\`
try:
    edad = int(input("Edad: "))
    print("El año que viene tendrás", edad + 1)
except ValueError:
    print("Eso no es un número")
\`\`\`

- Si el \`try\` no falla, el \`except\` se salta.
- Si falla con ese tipo de error, se ejecuta el \`except\` y el programa **continúa**.
- Con \`except ValueError as e:\` guardas el error en \`e\` (\`str(e)\` es el mensaje).
- Puedes poner **varios** \`except\` o agrupar tipos: \`except (ValueError, TypeError):\`.

> CLAVE: Captura **tipos concretos**. Un \`except:\` a secas (o \`except Exception:\` por todo) oculta errores de verdad y hace muy difícil depurar.
`,
      ),
      pyDemo(
        'Capturar errores',
        [
          ['try:\n    n = int(input("Número: "))\n    print("Doble:", n * 2)\nexcept ValueError:\n    print("Eso no es un número")', 'La entrada preparada es «abc»'],
          ['def dividir(a, b):\n    try:\n        return a / b\n    except ZeroDivisionError as e:\n        print("Error:", e)\n        return None\n\nprint(dividir(10, 2))\nprint(dividir(1, 0))'],
          ['for dato in ["12", "x", None]:\n    try:\n        print(int(dato) + 1)\n    except ValueError:\n        print("valor inválido:", dato)\n    except TypeError:\n        print("tipo inválido:", dato)', 'Varios `except` para distintos fallos'],
        ],
        { stdin: ['abc'] },
      ),
      pyOut('¿Qué imprime?', 'try:\n    print("A")\n    int("x")\n    print("B")\nexcept ValueError:\n    print("C")\nprint("D")', ['A\nB\nD', 'A\nB\nC\nD', 'A\nC'], 'Se imprime A; `int("x")` falla, así que se salta la B y se ejecuta el `except` (C). Luego el programa sigue con la D.'),
      mc('¿Qué excepción lanza `int("abc")`?', ['TypeError', 'ValueError', 'NameError', 'SyntaxError'], 1, 'El tipo (`str`) es válido para `int`, pero su valor no se puede convertir: eso es un `ValueError`.'),
      tf('Un `except:` sin tipo es la mejor forma de evitar que el programa falle.', false, 'Captura absolutamente todo —incluso errores de programación que deberías ver— y oculta el problema. Captura siempre tipos concretos.'),
      match(
        'Une cada código con la excepción que lanza',
        [
          ['[1, 2][9]', 'IndexError'],
          ['{"a": 1}["z"]', 'KeyError'],
          ['5 / 0', 'ZeroDivisionError'],
          ['float("x")', 'ValueError'],
        ],
        'Reconocer el tipo de error ya te dice dónde mirar.',
      ),
      fill('Completa para guardar el error en la variable `e`', 'try:\n    1 / 0\nexcept ZeroDivisionError ___ e:\n    print(e)', ['as', 'is', '=', 'in'], ['as'], 'Se escribe `except Tipo as nombre:`; el nombre solo existe dentro de ese bloque.'),
      pyPractice({
        goal: 'Número seguro',
        prompt: 'Lee un valor con `input()` e intenta convertirlo con `int`. Si no es un entero, muestra **No es un número**; si lo es, muestra **Número: N**.',
        setup: { stdin: ['abc'] },
        starter: '',
        check: all(outHas('No es un número'), uses('Try')),
        solution: 'try:\n    n = int(input("Número: "))\n    print(f"Número: {n}")\nexcept ValueError:\n    print("No es un número")',
        hints: ['Pon la conversión dentro de `try`.', '`except ValueError:` para el caso de error.'],
        explain: 'El programa ya no se cae con una entrada rara: la trata y continúa. Prueba mentalmente con «42».',
        commands: ['try', 'except', 'ValueError'],
      }),
      pyPractice({
        goal: 'División segura',
        prompt: 'Define `dividir(a, b)` que devuelva `a / b`, o `None` si `b` es cero (captura el error con `try/except`).',
        starter: '',
        check: all(func('dividir', 2), uses('Try'), calls([['dividir(10, 2)', '5.0'], ['dividir(1, 0)', 'None'], ['dividir(0, 5)', '0.0']])),
        solution: 'def dividir(a, b):\n    try:\n        return a / b\n    except ZeroDivisionError:\n        return None',
        hints: ['El `return a / b` va dentro del `try`.', '`except ZeroDivisionError:` y devolver `None`.'],
        explain: 'Esta función ya no se cae: avisa del problema devolviendo `None`, y quien la llama decide qué hacer.',
        commands: ['ZeroDivisionError'],
      }),
      pyPractice({
        goal: 'Pedir hasta que sea válido',
        prompt: 'Pide un número entero con `input()` **en un bucle** hasta que el usuario escriba uno válido. Cada vez que escriba algo inválido muestra **Inválido**. Al final muestra **Número: N**.',
        setup: { stdin: ['x', '', '7'] },
        starter: '',
        check: all(outHas('Inválido', 'Número: 7'), uses('While'), uses('Try')),
        solution: 'while True:\n    try:\n        n = int(input("Número: "))\n        break\n    except ValueError:\n        print("Inválido")\nprint(f"Número: {n}")',
        hints: ['`while True` con un `break` cuando la conversión funcione.', 'El `break` va justo después de la conversión, dentro del `try`.'],
        explain: 'Es el patrón estándar para validar entradas: repetir hasta que no haya excepción.',
        commands: ['try', 'except', 'while'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py7-2', { title: 'else, finally y raise', summary: 'Orden de ejecución, lanzar errores propios y assert', emoji: '🧯', commands: ['else', 'finally', 'raise', 'assert'], minutes: 11 }, [
      learn(
        'else y finally',
        `
Un bloque \`try\` completo puede tener cuatro partes:

\`\`\`
try:
    # lo que puede fallar
except Tipo:
    # si falla con ese tipo
else:
    # si NO hubo ninguna excepción
finally:
    # pase lo que pase (limpieza)
\`\`\`

- **\`else\`**: código que solo tiene sentido si el \`try\` salió bien. Así el \`try\` contiene *solo* lo que puede fallar.
- **\`finally\`**: se ejecuta **siempre**, haya error o no, e incluso aunque haya un \`return\` en medio. Ideal para liberar recursos (cerrar archivos, conexiones…).
`,
        '🧯',
      ),
      pyDemo('El orden de ejecución', [
        ['def probar(valor):\n    try:\n        n = int(valor)\n    except ValueError:\n        print("  except")\n    else:\n        print("  else:", n)\n    finally:\n        print("  finally")\n\nprint("con 5:")\nprobar("5")\nprint("con x:")\nprobar("x")'],
        ['def f():\n    try:\n        return "desde try"\n    finally:\n        print("finally se ejecuta antes de salir")\n\nprint(f())'],
      ]),
      learn(
        'raise: lanzar tus propios errores',
        `
No solo Python lanza excepciones: tú también puedes, con **\`raise\`**. Es la forma correcta de decir «este dato no es válido» desde una función:

\`\`\`
def pedir_edad(edad):
    if edad < 0:
        raise ValueError("La edad no puede ser negativa")
    return edad
\`\`\`

Más usos:

- **Volver a lanzar** dentro de un \`except\` con un \`raise\` solo: registras o limpias y dejas que el error siga subiendo.
- **Encadenar**: \`raise OtroError("...") from e\` conserva el error original como causa (aparece en el traceback).
`,
      ),
      pyDemo('Validar y encadenar', [
        ['def pedir_edad(edad):\n    if edad < 0:\n        raise ValueError("La edad no puede ser negativa")\n    return edad\n\ntry:\n    pedir_edad(-5)\nexcept ValueError as e:\n    print("Error:", e)'],
        pyErr('def leer_config(datos):\n    try:\n        return datos["puerto"]\n    except KeyError as e:\n        raise RuntimeError("Configuración incompleta") from e\n\nleer_config({})', 'El traceback muestra la causa original («direct cause») y el error nuevo'),
        ['try:\n    try:\n        1 / 0\n    except ZeroDivisionError:\n        print("registro: algo falló")\n        raise\nexcept ZeroDivisionError:\n    print("el error sigue subiendo")', 'Un `raise` solo, dentro de `except`, relanza el mismo error'],
      ]),
      learn(
        'assert: afirmaciones para el programador',
        `
\`assert condición, "mensaje"\` comprueba algo que **debería ser siempre cierto**. Si no lo es, lanza \`AssertionError\`. Sirve para detectar errores *de programación* durante el desarrollo:

\`\`\`
assert len(lista) > 0, "la lista no debería estar vacía"
\`\`\`

No lo uses para validar datos del usuario: los \`assert\` se pueden desactivar al ejecutar Python con la opción \`-O\`. Para eso, \`if\` + \`raise\`.
`,
      ),
      pyDemo('assert', [['edad = 25\nassert edad > 0, "la edad debe ser positiva"\nprint("todo bien")'], pyErr('descuento = 1.5\nassert 0 <= descuento <= 1, "el descuento debe estar entre 0 y 1"', 'Salta `AssertionError` con el mensaje')]),
      pyOut('¿Qué imprime?', 'def f():\n    try:\n        return "try"\n    finally:\n        print("finally")\n\nprint(f())', ['try', 'finally', 'try\nfinally'], 'El `return` prepara el valor, pero `finally` se ejecuta antes de salir de la función. Primero se imprime «finally» y después el `print` externo muestra «try».'),
      mc('¿Cuándo se ejecuta el bloque `else` de un `try`?', ['Siempre', 'Solo si hubo una excepción', 'Solo si el `try` terminó sin excepciones', 'Solo si hay `finally`'], 2, 'El `else` del `try` es para el «todo salió bien»; así, en el `try` solo queda el código que puede fallar.'),
      tf('El bloque `finally` no se ejecuta si el `try` contiene un `return`.', false, 'Se ejecuta siempre: con error, sin error e incluso con `return`, `break` o `continue` dentro del `try`.'),
      fill('Completa para lanzar un error de valor', 'if edad < 0:\n    ___ ValueError("negativa")', ['raise', 'throw', 'except', 'error'], ['raise'], 'En Python se lanza con `raise` (no existe `throw`).'),
      pyPractice({
        goal: 'Valida la edad',
        prompt: 'Completa `validar_edad(edad)`: si la edad es menor que 0 o mayor que 120, lanza `ValueError("Edad no válida")`; si no, devuélvela. Después las pruebas ya escritas mostrarán lo que ocurre.',
        starter: 'def validar_edad(edad):\n    pass  # completa la función\n\nfor e in (30, -5, 200):\n    try:\n        print(validar_edad(e))\n    except ValueError as err:\n        print("Error:", err)\n',
        check: stdout('30\nError: Edad no válida\nError: Edad no válida'),
        solution: 'def validar_edad(edad):\n    if edad < 0 or edad > 120:\n        raise ValueError("Edad no válida")\n    return edad\n\nfor e in (30, -5, 200):\n    try:\n        print(validar_edad(e))\n    except ValueError as err:\n        print("Error:", err)',
        hints: ['Dos condiciones unidas con `or`.', '`raise ValueError("Edad no válida")`'],
        explain: 'La función no decide qué hacer con el error: solo lo lanza. Quien la llama (aquí el bucle) elige cómo tratarlo.',
        commands: ['raise'],
      }),
      pyPractice({
        goal: 'Limpieza garantizada',
        prompt: 'Completa `procesar(n)` para que muestre **abrir**, luego calcule `100 / n` e imprima el resultado, y **siempre** (haya o no error) muestre **cerrar**. Usa `finally`.',
        starter: 'def procesar(n):\n    print("abrir")\n    print(100 / n)\n\ntry:\n    procesar(0)\nexcept ZeroDivisionError:\n    print("capturado")\n',
        check: all(stdout('abrir\ncerrar\ncapturado'), uses('Try')),
        solution: 'def procesar(n):\n    print("abrir")\n    try:\n        print(100 / n)\n    finally:\n        print("cerrar")\n\ntry:\n    procesar(0)\nexcept ZeroDivisionError:\n    print("capturado")',
        hints: ['El `try` debe envolver el cálculo, el `finally` imprime «cerrar».', 'El error sigue subiendo después del `finally` y lo captura el `except` de fuera.'],
        explain: 'Primero se ejecuta el `finally` (cerrar) y después el error continúa su camino hasta el `except` exterior (capturado).',
        commands: ['finally'],
      }),
      pyPractice({
        goal: 'Cambia el error y conserva la causa',
        prompt: 'Define `obtener(d, clave)` que devuelva `d[clave]`; si la clave no existe, debe lanzar `ValueError(f"Falta la clave {clave}")` **encadenado** (`from`) con el `KeyError` original. Las pruebas de abajo comprueban la causa.',
        starter: 'def obtener(d, clave):\n    return d[clave]\n\ntry:\n    obtener({"a": 1}, "b")\nexcept ValueError as e:\n    print(e, "|", type(e.__cause__).__name__)\n',
        check: all(stdout('Falta la clave b | KeyError'), uses('Try')),
        solution: 'def obtener(d, clave):\n    try:\n        return d[clave]\n    except KeyError as e:\n        raise ValueError(f"Falta la clave {clave}") from e\n\ntry:\n    obtener({"a": 1}, "b")\nexcept ValueError as e:\n    print(e, "|", type(e.__cause__).__name__)',
        hints: ['Captura el `KeyError` dentro de la función.', '`raise ValueError(...) from e`'],
        explain: 'Cambiar el tipo del error (de interno a uno propio del dominio) sin perder el original facilita el diagnóstico: `__cause__` lo conserva.',
        commands: ['raise'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py7-3', { title: 'Excepciones propias', summary: 'Heredar de Exception y diseñar jerarquías', emoji: '🏷️', commands: ['Exception'], minutes: 11 }, [
      learn(
        'Crear tu propia excepción',
        `
Las excepciones son **clases**. Para crear una propia solo hace falta heredar de \`Exception\`:

\`\`\`
class SaldoInsuficiente(Exception):
    pass
\`\`\`

(La palabra \`class\` la estudiarás a fondo en la zona 9; por ahora fíjate en el patrón.) Después se usa como cualquier otra:

\`\`\`
raise SaldoInsuficiente("Faltan 20 €")
...
except SaldoInsuficiente as e:
    print(e)
\`\`\`

¿Para qué? Porque los tipos **cuentan una historia**: \`SaldoInsuficiente\` dice mucho más que un \`ValueError\` genérico y permite que cada \`except\` trate solo lo que le corresponde.
`,
        '🏷️',
      ),
      pyDemo('Mi primera excepción', [
        ['class SaldoInsuficiente(Exception):\n    pass\n\ndef retirar(saldo, cantidad):\n    if cantidad > saldo:\n        raise SaldoInsuficiente(f"Faltan {cantidad - saldo} €")\n    return saldo - cantidad\n\ntry:\n    print(retirar(100, 30))\n    print(retirar(100, 150))\nexcept SaldoInsuficiente as e:\n    print("No se pudo:", e)'],
      ]),
      learn(
        'Jerarquías y el orden de los except',
        `
Como son clases, las excepciones forman **jerarquías**. Todas heredan de \`BaseException\`; las normales, de \`Exception\`. Por ejemplo, \`ZeroDivisionError\` es un tipo de \`ArithmeticError\`; \`KeyError\` e \`IndexError\` son tipos de \`LookupError\`.

Un \`except\` captura el tipo indicado **y todos sus hijos**. Por eso:

- Los \`except\` se prueban **en orden**: pon primero el más **específico** y después el general.
- En una aplicación se suele definir **una excepción base propia** (\`ErrorTienda\`) y que las demás hereden de ella: así quien lo desee puede capturar todos los fallos de tu librería con un solo \`except ErrorTienda\`.
`,
      ),
      pyDemo('Jerarquía propia', [
        ['class ErrorTienda(Exception):\n    """Base de los errores de la tienda."""\n\nclass SinStock(ErrorTienda):\n    pass\n\nclass PrecioInvalido(ErrorTienda):\n    pass\n\nfor error in (SinStock("agotado"), PrecioInvalido("negativo"), KeyError("x")):\n    try:\n        raise error\n    except SinStock:\n        print("Sin stock")\n    except ErrorTienda as e:\n        print("Error de tienda:", e)\n    except Exception as e:\n        print("Otro tipo:", type(e).__name__)'],
        pyRepl('issubclass(ZeroDivisionError, ArithmeticError)'),
        pyRepl('issubclass(KeyError, LookupError)'),
        pyRepl('KeyError.__mro__', 'La cadena de herencia completa'),
      ]),
      learn(
        'Buenas prácticas',
        `
- **Hereda de \`Exception\`**, nunca de \`BaseException\` (esta incluye \`KeyboardInterrupt\` y \`SystemExit\`, que no debes capturar por error).
- Nombra las clases con el sufijo **\`Error\`** cuando sea un fallo (\`SaldoInsuficienteError\`).
- Incluye **datos útiles** como atributos (qué campo falló, qué valor llegó).
- **No silencies** errores: un \`except: pass\` es la mejor receta para pasar horas depurando.
- Lanza el error **lo más específico** que describa el problema, y captura **solo** donde puedas hacer algo útil.
`,
      ),
      pyDemo('Con atributos y mensaje propio', [['class ErrorValidacion(Exception):\n    def __init__(self, campo, motivo):\n        super().__init__(f"{campo}: {motivo}")\n        self.campo = campo\n        self.motivo = motivo\n\ntry:\n    raise ErrorValidacion("edad", "debe ser positiva")\nexcept ErrorValidacion as e:\n    print(e)\n    print(e.campo, "|", e.motivo)']]),
      pyOut('¿Qué imprime?', 'class A(Exception): pass\nclass B(A): pass\n\ntry:\n    raise B("x")\nexcept A:\n    print("A")\nexcept B:\n    print("B")', ['B', 'A\nB', 'Nada: da error'], 'Un `except A` captura también a sus hijos (`B`). Como se evalúa primero, el `except B` nunca llega a ejecutarse.'),
      mc('¿De qué clase conviene heredar para crear una excepción propia?', ['BaseException', 'Exception', 'object', 'Error'], 1, '`Exception` es la base de todas las excepciones «normales». `BaseException` incluye también `KeyboardInterrupt` y `SystemExit`.'),
      tf('`except Exception:` captura también `KeyboardInterrupt` (Ctrl+C).', false, '`KeyboardInterrupt` hereda de `BaseException`, no de `Exception`, así que `except Exception` no lo captura.'),
      match(
        'Une cada excepción con su clase padre',
        [
          ['ZeroDivisionError', 'ArithmeticError'],
          ['KeyError', 'LookupError'],
          ['FileNotFoundError', 'OSError'],
          ['ModuleNotFoundError', 'ImportError'],
        ],
        'Conocer la jerarquía te permite capturar «familias» de errores con un único `except`.',
      ),
      pyPractice({
        goal: 'Error de saldo',
        prompt: 'Crea la excepción `SaldoInsuficiente` (hija de `Exception`) y la función `retirar(saldo, cantidad)`: lanza `SaldoInsuficiente` si `cantidad > saldo`; si no, devuelve el nuevo saldo.',
        starter: '# Crea la excepción y la función\n\ntry:\n    print(retirar(100, 30))\n    print(retirar(100, 500))\nexcept SaldoInsuficiente:\n    print("Saldo insuficiente")\n',
        check: all(cls('SaldoInsuficiente'), func('retirar', 2), truthy('issubclass(SaldoInsuficiente, Exception)'), stdout('70\nSaldo insuficiente')),
        solution: 'class SaldoInsuficiente(Exception):\n    pass\n\ndef retirar(saldo, cantidad):\n    if cantidad > saldo:\n        raise SaldoInsuficiente("Saldo insuficiente")\n    return saldo - cantidad\n\ntry:\n    print(retirar(100, 30))\n    print(retirar(100, 500))\nexcept SaldoInsuficiente:\n    print("Saldo insuficiente")',
        hints: ['`class SaldoInsuficiente(Exception):` y dentro `pass`.', 'En `retirar`: `if cantidad > saldo: raise SaldoInsuficiente(...)`.'],
        explain: 'La excepción propia permite que el código de fuera capture exactamente este caso sin confundirlo con otros fallos.',
        commands: ['Exception', 'raise'],
      }),
      pyPractice({
        goal: 'Una jerarquía de errores',
        prompt: 'Define `ErrorTienda` (hija de `Exception`), y dos hijas suyas: `SinStock` y `PrecioInvalido`.',
        starter: '',
        check: all(cls('ErrorTienda'), cls('SinStock'), cls('PrecioInvalido'), truthy('issubclass(SinStock, ErrorTienda) and issubclass(PrecioInvalido, ErrorTienda) and issubclass(ErrorTienda, Exception)')),
        solution: 'class ErrorTienda(Exception):\n    pass\n\nclass SinStock(ErrorTienda):\n    pass\n\nclass PrecioInvalido(ErrorTienda):\n    pass',
        hints: ['Cada clase hereda de otra: la base de `Exception`, las hijas de la base.', '`class SinStock(ErrorTienda): pass`'],
        explain: 'Con una base común, `except ErrorTienda` captura cualquiera de los errores de la tienda, y `except SinStock` solo uno.',
        commands: ['Exception'],
      }),
      pyPractice({
        goal: 'Un error con datos',
        prompt: 'Crea `ErrorValidacion` con `__init__(self, campo, motivo)`. Debe guardar `self.campo` y `self.motivo`, y su texto (`str(e)`) debe ser `"campo: motivo"`.',
        starter: '',
        check: all(cls('ErrorValidacion'), calls([["str(ErrorValidacion('edad', 'debe ser positiva'))", "'edad: debe ser positiva'"], ["ErrorValidacion('a', 'b').campo", "'a'"], ["ErrorValidacion('a', 'b').motivo", "'b'"]])),
        solution: 'class ErrorValidacion(Exception):\n    def __init__(self, campo, motivo):\n        super().__init__(f"{campo}: {motivo}")\n        self.campo = campo\n        self.motivo = motivo',
        hints: ['Llama a `super().__init__(mensaje)` para fijar el texto.', 'Guarda los datos con `self.campo = campo`.'],
        explain: 'Los atributos permiten que el código que captura el error consulte qué campo falló sin tener que analizar el texto.',
        commands: ['Exception'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py7-4', { title: 'Archivos de texto', summary: 'open, with, leer, escribir y añadir', emoji: '📄', commands: ['open', 'with', 'file.read', 'file.write', 'file.readlines'], minutes: 12 }, [
      learn(
        'Que tus datos sobrevivan al programa',
        `
Las variables desaparecen cuando el programa termina. Para **guardar** datos hay que usar **archivos**. La forma moderna y segura:

\`\`\`
with open("notas.txt", "w", encoding="utf-8") as f:
    f.write("Hola\\n")
\`\`\`

- \`open(ruta, modo)\` abre el archivo; \`with\` garantiza que se **cierra** al terminar el bloque, incluso si hay un error.
- El **modo** dice qué vas a hacer: \`"r"\` leer (por defecto), \`"w"\` escribir (**borra** el contenido previo), \`"a"\` añadir al final.
- \`encoding="utf-8"\` evita problemas con tildes y eñes.

> NOTA: En este entorno los archivos viven en un sistema de archivos **virtual**: es seguro experimentar sin tocar tu dispositivo.
`,
        '📄',
      ),
      illus('py-file-modes', 'Modos de apertura', 'Leer, escribir y añadir tienen efectos muy distintos sobre el contenido previo.'),
      pyDemo('Escribir y leer', [
        ['with open("notas.txt", "w", encoding="utf-8") as f:\n    f.write("Primera línea\\n")\n    f.write("Segunda línea\\n")\nprint("archivo escrito")'],
        ['with open("notas.txt", encoding="utf-8") as f:\n    contenido = f.read()\nprint(contenido)\nprint(len(contenido))', '`read()` devuelve todo el texto de golpe'],
        ['with open("notas.txt", "a", encoding="utf-8") as f:\n    f.write("Tercera línea\\n")\nwith open("notas.txt", encoding="utf-8") as f:\n    print(f.read())', 'El modo `a` añade sin borrar'],
      ]),
      learn(
        'Formas de leer',
        `
| Método | Resultado |
|---|---|
| \`f.read()\` | Todo el contenido en **un texto** |
| \`f.readline()\` | **Una** línea (con su \`\\n\` final) |
| \`f.readlines()\` | **Lista** con todas las líneas |
| \`for linea in f:\` | Recorre línea a línea (**lo mejor** para archivos grandes) |

Cada línea leída conserva el salto de línea; usa \`.strip()\` o \`.rstrip("\\n")\` para quitarlo. Para escribir: \`f.write(texto)\` (no añade saltos de línea solo) o \`print(..., file=f)\` (que sí los añade).
`,
      ),
      pyDemo(
        'Recorrer un archivo',
        [
          ['with open("datos.txt", encoding="utf-8") as f:\n    for linea in f:\n        print(linea.strip().upper())'],
          ['with open("datos.txt", encoding="utf-8") as f:\n    lineas = f.readlines()\nprint(lineas)\nprint(len(lineas))', 'Cada elemento conserva su `\\n`'],
          ['with open("copia.txt", "w", encoding="utf-8") as f:\n    for i in range(1, 4):\n        print(f"línea {i}", file=f)\nprint(open("copia.txt", encoding="utf-8").read())'],
        ],
        { files: { 'datos.txt': 'uno\ndos\ntres\n' } },
      ),
      learn(
        'Cuando el archivo no está',
        `
Abrir un archivo que no existe en modo lectura lanza **\`FileNotFoundError\`**. Se trata como cualquier excepción, o se comprueba antes con \`pathlib\` / \`os.path.exists\`.

\`\`\`
try:
    with open("config.txt") as f:
        ...
except FileNotFoundError:
    print("No encuentro config.txt: uso valores por defecto")
\`\`\`
`,
      ),
      pyDemo('Un archivo inexistente', [pyErr('open("no_existe.txt")', '`FileNotFoundError`', true), ['try:\n    with open("no_existe.txt", encoding="utf-8") as f:\n        print(f.read())\nexcept FileNotFoundError:\n    print("No encuentro el archivo")']]),
      pyOut('¿Qué imprime?', 'with open("t.txt", "w") as f:\n    f.write("A")\nwith open("t.txt", "a") as f:\n    f.write("B")\nwith open("t.txt", "w") as f:\n    f.write("C")\nprint(open("t.txt").read())', ['AB', 'ABC', 'BC'], 'Se escribe «A», se añade «B» (queda «AB») y finalmente el modo `"w"` **borra todo** y deja solo «C».'),
      mc('¿Qué hace abrir un archivo existente con el modo `"w"`?', ['Lo abre para leer', 'Añade texto al final', 'Borra su contenido y empieza de cero', 'Da un error'], 2, '`"w"` trunca el archivo. Para añadir sin perder lo anterior usa `"a"`.'),
      tf('Con `with open(...) as f:` el archivo se cierra automáticamente al salir del bloque.', true, 'Ese es el gran motivo para usar `with`: el cierre queda garantizado incluso si ocurre una excepción dentro.'),
      fill('Completa el modo para añadir al final del archivo', 'with open("log.txt", "___", encoding="utf-8") as f:\n    f.write("nueva línea\\n")', ['a', 'w', 'r', 'x'], ['a'], '`a` (append) conserva lo que había y escribe al final.'),
      pyPractice({
        goal: 'Guardar una lista',
        prompt: 'Escribe cada nombre de `nombres` en el archivo `nombres.txt`, **uno por línea**.',
        starter: 'nombres = ["Ana", "Luis", "Eva"]\n',
        check: all(file('nombres.txt', { equals: 'Ana\nLuis\nEva' }), uses('With')),
        solution: 'nombres = ["Ana", "Luis", "Eva"]\nwith open("nombres.txt", "w", encoding="utf-8") as f:\n    for nombre in nombres:\n        f.write(nombre + "\\n")',
        hints: ['Abre el archivo en modo escritura y recorre la lista.', 'Recuerda añadir `"\\n"` a cada nombre.'],
        explain: '`write` no añade saltos de línea: hay que ponerlos tú (o usar `print(nombre, file=f)`).',
        commands: ['open', 'with', 'file.write'],
      }),
      pyPractice({
        goal: 'Contar errores en un registro',
        prompt: 'El archivo `registro.log` ya existe. Cuenta cuántas líneas contienen la palabra **ERROR** y guarda el resultado en `errores`.',
        setup: { files: { 'registro.log': 'INFO inicio\nERROR disco lleno\nINFO ok\nERROR sin red\nWARN lento\n' } },
        starter: 'errores = 0\n',
        check: all(variable('errores', '2'), uses('With')),
        solution: 'errores = 0\nwith open("registro.log", encoding="utf-8") as f:\n    for linea in f:\n        if "ERROR" in linea:\n            errores += 1',
        hints: ['Recorre el archivo con `for linea in f`.', '`if "ERROR" in linea:` y suma a un contador.'],
        explain: 'Recorrer el archivo línea a línea no carga todo en memoria: funciona igual con un registro de gigabytes.',
        commands: ['open', 'with'],
      }),
      pyPractice({
        goal: 'Añadir al diario',
        prompt: 'El archivo `diario.txt` ya tiene una línea. **Añade** una segunda línea con el texto `Hoy aprendí Python` (sin borrar la anterior).',
        setup: { files: { 'diario.txt': 'Lunes: empecé el curso\n' } },
        starter: '',
        check: file('diario.txt', { equals: 'Lunes: empecé el curso\nHoy aprendí Python' }),
        solution: 'with open("diario.txt", "a", encoding="utf-8") as f:\n    f.write("Hoy aprendí Python\\n")',
        hints: ['El modo que no borra es `"a"`.', 'No olvides el `\\n` al final de la línea.'],
        explain: 'Con `"w"` habrías perdido la primera línea. El modo `"a"` abre al final del archivo.',
        commands: ['open', 'file.write'],
      }),
      pyPractice({
        goal: 'Copiar en mayúsculas',
        prompt: 'Lee `entrada.txt` y escribe en `salida.txt` el mismo texto **en mayúsculas**.',
        setup: { files: { 'entrada.txt': 'hola mundo\nadiós\n' } },
        starter: '',
        check: file('salida.txt', { equals: 'HOLA MUNDO\nADIÓS' }),
        solution: 'with open("entrada.txt", encoding="utf-8") as origen:\n    texto = origen.read()\nwith open("salida.txt", "w", encoding="utf-8") as destino:\n    destino.write(texto.upper())',
        hints: ['Dos archivos: uno en lectura y otro en escritura.', '`texto.upper()` convierte todo de una vez.'],
        explain: 'Leer, transformar y escribir es la estructura de casi todo procesamiento de archivos.',
        commands: ['open', 'file.read', 'file.write'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py7-5', { title: 'JSON, CSV y pathlib', summary: 'Formatos de datos y rutas de archivo', emoji: '🗃️', commands: ['json.dumps', 'json.loads', 'json.dump', 'json.load', 'csv.reader', 'csv.DictReader', 'pathlib.Path'], minutes: 13 }, [
      learn(
        'JSON: el idioma de los datos',
        `
**JSON** es un formato de texto para intercambiar datos entre programas (webs, apps, APIs). Se parece muchísimo a los diccionarios y listas de Python, y el módulo \`json\` convierte de un lado a otro:

| Función | Hace |
|---|---|
| \`json.dumps(obj)\` | Objeto Python → **texto** JSON |
| \`json.loads(texto)\` | Texto JSON → objeto Python |
| \`json.dump(obj, archivo)\` | Objeto → **archivo** |
| \`json.load(archivo)\` | **Archivo** → objeto |

JSON solo admite diccionarios (con claves de texto), listas, textos, números, \`true/false\` y \`null\`. Los conjuntos, las tuplas (se vuelven listas) o las fechas no encajan sin un paso extra.
`,
        '🗃️',
      ),
      pyDemo('Convertir y guardar', [
        ['import json\npersona = {"nombre": "Ada", "edad": 36, "lenguajes": ["Python", "C"], "activa": True, "pareja": None}\ntexto = json.dumps(persona)\nprint(texto)\nprint(type(texto))'],
        ['print(json.dumps(persona, indent=2, ensure_ascii=False, sort_keys=True))', '`indent` embellece, `ensure_ascii=False` respeta las tildes, `sort_keys` ordena las claves'],
        ['vuelta = json.loads(texto)\nprint(vuelta["lenguajes"][0], vuelta["pareja"], vuelta == persona)'],
        ['with open("persona.json", "w", encoding="utf-8") as f:\n    json.dump(persona, f, ensure_ascii=False)\nwith open("persona.json", encoding="utf-8") as f:\n    print(json.load(f)["nombre"])'],
      ]),
      learn(
        'CSV: tablas en texto',
        `
**CSV** guarda tablas: una fila por línea, columnas separadas por comas. El módulo \`csv\` se ocupa de los detalles (comillas, comas dentro de un campo…):

- \`csv.reader(f)\` → cada fila es una **lista** de textos.
- \`csv.DictReader(f)\` → cada fila es un **diccionario** usando la primera línea como cabecera (¡más cómodo!).
- \`csv.writer(f)\` / \`csv.DictWriter(f, fieldnames=[...])\` para escribir.

Al abrir el archivo pasa \`newline=""\`. Y recuerda: **todo lo que se lee es texto**; convierte con \`int()\`/\`float()\`.
`,
      ),
      pyDemo(
        'Leer y escribir CSV',
        [
          ['import csv\nwith open("ventas.csv", newline="", encoding="utf-8") as f:\n    for fila in csv.DictReader(f):\n        print(fila["producto"], float(fila["importe"]) * 2)'],
          ['with open("salida.csv", "w", newline="", encoding="utf-8") as f:\n    w = csv.writer(f)\n    w.writerow(["nombre", "nota"])\n    w.writerow(["Ana", 9])\n    w.writerow(["Luis", 7])\nprint(open("salida.csv", encoding="utf-8").read())'],
        ],
        { files: { 'ventas.csv': 'producto,importe\npan,1.5\nleche,2.25\nhuevos,3\n' } },
      ),
      learn(
        'pathlib: rutas como objetos',
        `
\`pathlib.Path\` representa una ruta como un objeto con métodos útiles, más cómodo que juntar textos a mano:

\`\`\`
from pathlib import Path

carpeta = Path("docs")
ruta = carpeta / "notas.txt"       # el operador / une partes
ruta.write_text("hola", encoding="utf-8")
print(ruta.read_text(encoding="utf-8"))
\`\`\`

Lo más útil: \`.exists()\`, \`.is_file()\`, \`.is_dir()\`, \`.name\`, \`.stem\` (sin extensión), \`.suffix\`, \`.parent\`, \`.mkdir(parents=True, exist_ok=True)\`, \`.iterdir()\` (contenido de una carpeta), \`.glob("*.txt")\` (buscar por patrón).
`,
      ),
      pyDemo(
        'Explorar con Path',
        [
          ['from pathlib import Path\ncarpeta = Path("docs")\nprint(carpeta.exists(), carpeta.is_dir())\nfor p in sorted(carpeta.glob("*.txt")):\n    print(p.name, p.stem, p.suffix)'],
          ['nueva = carpeta / "extra" / "nota.txt"\nnueva.parent.mkdir(parents=True, exist_ok=True)\nnueva.write_text("hola", encoding="utf-8")\nprint(nueva, nueva.read_text(encoding="utf-8"))'],
        ],
        { files: { 'docs/a.txt': 'A', 'docs/b.txt': 'B', 'docs/foto.png': 'x' } },
      ),
      pyOut('¿Qué imprime?', 'import json\ndatos = json.loads(\'{"a": [1, 2], "b": null}\')\nprint(datos["a"][1], datos["b"], type(datos).__name__)', ['2 None list', '2 null dict', '1 None dict'], 'JSON `null` se convierte en `None`; la lista `[1, 2]` tiene el 2 en la posición 1; el objeto JSON se convierte en `dict`.'),
      mc('¿Qué devuelve `csv.DictReader` en cada iteración?', ['Una lista de números', 'Un diccionario por fila con la cabecera como claves', 'Todo el archivo como un texto', 'Una tupla'], 1, 'Cada fila llega como un diccionario `{columna: valor}`; los valores siempre son textos hasta que los conviertas.'),
      tf('`json.dumps` escribe el JSON directamente en un archivo.', false, '`dumps` («dump to string») devuelve un **texto**. Para escribir en un archivo se usa `json.dump(obj, archivo)` (sin la s).'),
      fill('Completa para unir la carpeta y el nombre', 'ruta = Path("docs") ___ "notas.txt"', ['/', '+', ',', '&'], ['/'], 'Con `pathlib` el operador `/` une partes de una ruta, y funciona igual en cualquier sistema operativo.'),
      pyPractice({
        goal: 'Guardar y recuperar JSON',
        prompt: 'Guarda el diccionario `config` en el archivo `config.json` y vuelve a leerlo en la variable `cargado`.',
        starter: 'import json\nconfig = {"tema": "oscuro", "tamaño": 14, "favoritos": ["a", "b"]}\n',
        check: all(file('config.json', { exists: true }), variable('cargado', "{'tema': 'oscuro', 'tamaño': 14, 'favoritos': ['a', 'b']}")),
        solution: 'import json\nconfig = {"tema": "oscuro", "tamaño": 14, "favoritos": ["a", "b"]}\nwith open("config.json", "w", encoding="utf-8") as f:\n    json.dump(config, f, ensure_ascii=False)\nwith open("config.json", encoding="utf-8") as f:\n    cargado = json.load(f)',
        hints: ['`json.dump(objeto, archivo)` para guardar y `json.load(archivo)` para cargar.', 'Abre el archivo en modo `"w"` para escribir y en modo lectura para recuperarlo.'],
        explain: 'Guardar la configuración en JSON permite recuperarla en la próxima ejecución del programa.',
        commands: ['json.dump', 'json.load'],
      }),
      pyPractice({
        goal: 'Suma una columna',
        prompt: 'Lee `ventas.csv` con `csv.DictReader` y guarda en `total` la suma de la columna `importe` (recuerda convertirla a `float`).',
        setup: { files: { 'ventas.csv': 'producto,importe\npan,1.5\nleche,2.25\nhuevos,3\n' } },
        starter: 'import csv\ntotal = 0\n',
        check: all(variable('total', '6.75'), uses('import:csv')),
        solution: 'import csv\ntotal = 0\nwith open("ventas.csv", newline="", encoding="utf-8") as f:\n    for fila in csv.DictReader(f):\n        total += float(fila["importe"])',
        hints: ['Cada `fila` es un diccionario: `fila["importe"]`.', '`total += float(fila["importe"])`'],
        explain: 'Con `DictReader` accedes a las columnas por su nombre en lugar de por su posición, y el código sigue funcionando aunque cambie el orden de las columnas.',
        commands: ['csv.DictReader'],
      }),
      pyPractice({
        goal: 'Archivos .txt de una carpeta',
        prompt: 'Con `pathlib`, guarda en `txts` la lista **ordenada** de nombres de los archivos `.txt` de la carpeta `docs` (solo los nombres, como `"a.txt"`).',
        setup: { files: { 'docs/b.txt': 'B', 'docs/a.txt': 'A', 'docs/foto.png': 'x', 'docs/c.txt': 'C' } },
        starter: 'from pathlib import Path\n',
        check: all(variable('txts', "['a.txt', 'b.txt', 'c.txt']"), uses('import:pathlib')),
        solution: 'from pathlib import Path\ntxts = sorted(p.name for p in Path("docs").glob("*.txt"))',
        hints: ['`Path("docs").glob("*.txt")` busca por patrón.', 'Cada `Path` tiene el atributo `.name` y las listas se ordenan con `sorted`.'],
        explain: '`glob` devuelve rutas en un orden arbitrario según el sistema: ordena siempre que necesites un resultado predecible.',
        commands: ['pathlib.Path'],
      }),
      pyCode('Convierte el diccionario `d` en texto JSON y guárdalo en `texto`.', {
        starter: 'import json\nd = {"a": 1, "b": [True, None]}\n',
        check: all(variable('texto', '\'{"a": 1, "b": [true, null]}\'')),
        solution: 'import json\nd = {"a": 1, "b": [True, None]}\ntexto = json.dumps(d)',
        hint: '`dumps` = «dump to string».',
        why: 'Fíjate en la traducción: `True` → `true`, `None` → `null`, y las comillas simples de Python pasan a dobles.',
      }),
    ]),
  ],
  boss: {
    goal: 'Resumen de notas',
    prompt:
      'El archivo `notas.csv` tiene las columnas `nombre,nota`. Escribe un programa que:\n\n1. Lea el CSV (si no existe, debe mostrar `No hay datos` y terminar).\n2. Calcule el **promedio** de las notas (redondeado a 2 decimales) y cuántos alumnos **aprobaron** (nota ≥ 5).\n3. Guarde en `resumen.json` un diccionario con las claves `"promedio"` y `"aprobados"`.\n4. Muestre `Promedio: X` y `Aprobados: N`.',
    setup: { files: { 'notas.csv': 'nombre,nota\nAna,8\nLuis,4.5\nEva,6\nBea,3\nJon,9.5\n' } },
    starter: 'import csv\nimport json\n',
    check: all(
      outHas('Promedio: 6.2', 'Aprobados: 3'),
      truthy("__import__('json').load(open('resumen.json', encoding='utf-8')) == {'promedio': 6.2, 'aprobados': 3}"),
      uses('Try'),
    ),
    solution:
      'import csv\nimport json\n\ntry:\n    with open("notas.csv", newline="", encoding="utf-8") as f:\n        notas = [float(fila["nota"]) for fila in csv.DictReader(f)]\nexcept FileNotFoundError:\n    print("No hay datos")\nelse:\n    promedio = round(sum(notas) / len(notas), 2)\n    aprobados = sum(1 for n in notas if n >= 5)\n    with open("resumen.json", "w", encoding="utf-8") as f:\n        json.dump({"promedio": promedio, "aprobados": aprobados}, f)\n    print(f"Promedio: {promedio}")\n    print(f"Aprobados: {aprobados}")',
    hints: ['Usa `try/except FileNotFoundError` alrededor de la lectura y un `else` para el resto del trabajo.', 'Las notas se leen como texto: conviértelas con `float`. Aprobados: `sum(1 for n in notas if n >= 5)`.'],
    explain: 'Reúne la zona entera: excepciones, `else`, archivos con `with`, CSV, JSON y comprensiones/generadores. Un programa real de procesamiento de datos tiene esta misma forma: leer → procesar → guardar → informar.',
    commands: ['try', 'csv.DictReader', 'json.dump'],
  },
});

