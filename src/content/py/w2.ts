import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, outHas, outMatch, stdout, uses, variable } from '../pycheck';

export const py2 = pyWorld({
  id: 'py2',
  index: 2,
  title: 'Decisiones',
  subtitle: 'Programas que eligen su camino',
  emoji: '🔀',
  color: '#FFD43B',
  level: 'basico',
  intro:
    'Hasta ahora tus programas hacían siempre lo mismo, de arriba abajo. En esta zona aprenderás a que el programa mire una situación, haga una pregunta de verdadero o falso y **elija qué hacer**. Es el primer paso para que el código parezca inteligente.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py2-1', { title: 'Verdadero o falso', summary: 'Booleanos, comparaciones y None', emoji: '⚖️', commands: ['bool', 'comparaciones', 'None'], minutes: 9 }, [
      learn(
        'Preguntas con respuesta sí o no',
        `
Para decidir, el programa necesita **preguntas** que solo tengan dos respuestas: \`True\` (verdadero) o \`False\` (falso). Ese es el tipo **\`bool\`** (por el matemático George Boole). Se escriben con la primera letra en mayúscula.

Las preguntas más comunes son **comparaciones**:

| Operador | Pregunta |
|---|---|
| \`==\` | ¿Son iguales? |
| \`!=\` | ¿Son distintos? |
| \`<\`  \`<=\` | ¿Menor? ¿Menor o igual? |
| \`>\`  \`>=\` | ¿Mayor? ¿Mayor o igual? |

> CLAVE: \`=\` **asigna** (guarda un valor) y \`==\` **compara**. Confundirlos es el error clásico del principiante.
`,
        '⚖️',
      ),
      pyDemo('Comparaciones en acción', [
        pyRepl('5 > 3'),
        pyRepl('5 == 5'),
        pyRepl('5 != 5'),
        pyRepl('"a" < "b"', 'También se comparan textos, por orden alfabético'),
        pyRepl('1 < 5 < 10', 'Se pueden encadenar, como en matemáticas'),
        pyRepl('type(5 > 3)', 'El resultado es un `bool`'),
      ]),
      mc('¿Qué operador comprueba si dos valores son iguales?', ['=', '==', '===', 'is'], 1, '`==` compara. `=` es la asignación. `===` no existe en Python.'),
      learn(
        'Cuidado con los textos y los tipos',
        `
- Las comparaciones de texto **distinguen mayúsculas**: \`"Python" == "python"\` es \`False\`. Para ignorarlas, convierte ambos: \`a.lower() == b.lower()\`.
- Python compara por el orden de los caracteres, así que las mayúsculas van **antes** que las minúsculas: \`"B" < "a"\` es \`True\`.
- Tipos distintos no son iguales: \`1 == "1"\` es \`False\`. Y ordenar un número con un texto (\`3 < "4"\`) provoca un \`TypeError\`.
- Con los decimales cuidado: \`0.1 + 0.2 == 0.3\` es \`False\` (ya sabes por qué).
`,
      ),
      pyDemo('Trampas de las comparaciones', [
        pyRepl('"Python" == "python"'),
        pyRepl('"hola".lower() == "HOLA".lower()'),
        pyRepl('1 == "1"'),
        pyRepl('0.1 + 0.2 == 0.3'),
        pyErr('3 < "4"', 'No se puede ordenar un número frente a un texto: `TypeError`', true),
      ]),
      learn(
        'None: la ausencia de valor',
        `
\`None\` es un valor especial que significa **«nada»** o «todavía no hay valor». Lo devuelven muchas funciones que no tienen nada que devolver y se usa para marcar un dato como vacío.

Para comprobarlo se usa **\`is None\`** (o \`is not None\`), no \`== None\`:

\`\`\`
resultado = None
print(resultado is None)      # True
\`\`\`

\`is\` comprueba si es *el mismo objeto*; como solo existe un \`None\`, es la forma correcta (y la que recomienda PEP 8).
`,
      ),
      pyOut('¿Qué imprime?', 'print(10 > 3)\nprint(10 == 3 + 7)\nprint("10" == 10)', ['True\nFalse\nFalse', 'True\nTrue\nTrue', 'False\nTrue\nFalse'], '`10 > 3` es verdadero; `3 + 7` vale 10 así que la segunda igualdad también; pero el texto `"10"` no es igual al número `10`.'),
      tf('`=` y `==` hacen lo mismo en Python.', false, '`=` asigna un valor a una variable; `==` pregunta si dos valores son iguales y devuelve `True` o `False`.'),
      fill('Completa para comprobar que `edad` es mayor o igual que 18', 'edad = 20\nprint(edad ___ 18)', ['>=', '>', '=>', '='], ['>='], 'El «mayor o igual» se escribe `>=` (el signo `=` va después). `=>` no existe en Python.'),
      pyCode('Guarda en `es_par` si el número `n` es par (usa el resto de la división).', {
        starter: 'n = 14\n',
        check: all(variable('es_par', 'True'), uses('op:%')),
        solution: 'n = 14\nes_par = n % 2 == 0',
        hint: 'Un número es par si el resto de dividirlo entre 2 es 0.',
        why: '`n % 2 == 0` primero calcula el resto y después lo compara con 0. El resultado es un bool listo para usar en una decisión.',
      }),
      pyPractice({
        goal: '¿Mayor de edad?',
        prompt: 'La variable `edad` vale 20. Guarda en `es_mayor` el resultado de comprobar si `edad` es **mayor o igual que 18**, y muéstralo con `print`.',
        starter: 'edad = 20\n',
        check: all(variable('es_mayor', 'True'), stdout('True')),
        solution: 'edad = 20\nes_mayor = edad >= 18\nprint(es_mayor)',
        hints: ['Una comparación produce un valor que se puede guardar en una variable.', '`es_mayor = edad >= 18`'],
        explain: 'Una comparación es una expresión como cualquier otra: su resultado (`True`/`False`) se puede guardar, imprimir o usar en un `if`.',
        commands: ['comparaciones'],
      }),
      pyPractice({
        goal: 'Temperatura agradable',
        prompt: 'Lee una temperatura entera con `input()` y muestra `True` si está **entre 18 y 25 grados (ambos incluidos)** y `False` si no. Hazlo con **una sola comparación encadenada**.',
        setup: { stdin: ['22'] },
        starter: '',
        check: all(outMatch('True$'), uses('call:int'), uses('Compare')),
        solution: 'temperatura = int(input("Temperatura: "))\nprint(18 <= temperatura <= 25)',
        hints: ['Python permite escribir `a <= x <= b`.', '`print(18 <= temperatura <= 25)`'],
        explain: 'La comparación encadenada es una de las joyas de Python: `18 <= t <= 25` se lee como en matemáticas y evita repetir la variable.',
        commands: ['comparaciones'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py2-2', { title: 'if, elif, else', summary: 'Bloques, indentación y caminos alternativos', emoji: '🚦', commands: ['if', 'elif', 'else', 'indentación'], minutes: 10 }, [
      learn(
        'Si pasa esto, haz aquello',
        `
La sentencia **\`if\`** ejecuta un bloque de código **solo si** una condición es verdadera:

\`\`\`
edad = 20
if edad >= 18:
    print("Puedes pasar")
\`\`\`

Dos detalles imprescindibles:

1. La línea del \`if\` termina en **dos puntos** \`:\`.
2. El bloque va **indentado** (sangrado): lo habitual son **4 espacios**. La indentación no es decoración; en Python **es la sintaxis**: dice qué líneas pertenecen al \`if\`.

Con **\`else\`** defines qué hacer cuando la condición es falsa.
`,
        '🚦',
      ),
      illus('py-if-flow', 'El flujo de un if', 'La condición decide por cuál de los caminos continúa el programa.'),
      pyDemo('if / else', [
        ['edad = 17\nif edad >= 18:\n    print("Puedes pasar")\nelse:\n    print("Todavía no")\nprint("Fin del programa")', 'El último `print` no está indentado: se ejecuta siempre'],
        ['edad = 40\nif edad >= 18:\n    print("Puedes pasar")\nelse:\n    print("Todavía no")', 'Con otro valor, el otro camino'],
      ]),
      learn(
        'elif: varias opciones',
        `
Cuando hay más de dos caminos, encadena **\`elif\`** (de *else if*). Python mira las condiciones **de arriba abajo**, ejecuta el bloque de la **primera** que sea verdadera y se salta todo lo demás. \`else\` (opcional) recoge el resto de casos.

\`\`\`
nota = 75
if nota >= 90:
    print("A")
elif nota >= 70:
    print("B")
elif nota >= 50:
    print("C")
else:
    print("D")
\`\`\`

> CLAVE: El **orden importa**. Si pusieras \`nota >= 50\` primero, un 95 caería ahí y nunca llegaría al «A».
`,
      ),
      pyOut('¿Qué imprime?', 'n = 10\nif n > 5:\n    print("mayor que 5")\nelif n > 8:\n    print("mayor que 8")\nprint("fin")', ['mayor que 5\nmayor que 8\nfin', 'mayor que 8\nfin', 'fin'], 'Aunque `n > 8` también es verdadero, el `elif` solo se evalúa si el `if` anterior fue falso. Se ejecuta el primer camino válido y luego sigue el código sin sangría.'),
      mc(
        '¿Qué le falta a este código para funcionar?',
        ['Dos puntos al final de la línea del if', 'Paréntesis alrededor de la condición', 'La palabra then', 'Un punto y coma'],
        0,
        'En Python la línea de un `if` termina siempre en `:`. Los paréntesis son opcionales y `then` no existe.',
        'if x > 3\n    print("grande")',
      ),
      pyDemo('Cuando la indentación falla', [
        pyErr('if True:\nprint("hola")', 'Después de `if ...:` tiene que haber un bloque indentado: `IndentationError`'),
        pyErr('x = 5\n    y = 6', 'Una indentación inesperada también es un error'),
      ]),
      learn(
        'Decisiones dentro de decisiones',
        `
Un bloque puede contener otro \`if\`. Es lo que se llama **anidar**: cada nivel se indenta 4 espacios más.

\`\`\`
if usuario_existe:
    if clave_correcta:
        print("Bienvenido")
    else:
        print("Clave incorrecta")
else:
    print("Usuario desconocido")
\`\`\`

Funciona, pero demasiados niveles se vuelven difíciles de leer. En la próxima lección verás cómo juntar condiciones con \`and\` y \`or\` para aplanar el código.
`,
      ),
      tf('Si varias condiciones de una cadena `if/elif` son verdaderas, Python ejecuta todos sus bloques.', false, 'Solo se ejecuta el bloque de la **primera** condición verdadera. Las demás ni se evalúan.'),
      pyPractice({
        goal: 'Positivo, negativo o cero',
        prompt: 'Lee un número entero y muestra **positivo**, **negativo** o **cero** según corresponda. Usa `if`, `elif` y `else`.',
        setup: { stdin: ['-4'] },
        starter: 'n = int(input("Número: "))\n',
        check: all(outMatch('negativo$'), uses('If', 2)),
        solution: 'n = int(input("Número: "))\nif n > 0:\n    print("positivo")\nelif n < 0:\n    print("negativo")\nelse:\n    print("cero")',
        hints: ['Tres caminos: mayor que 0, menor que 0 y el resto.', '`if n > 0:` / `elif n < 0:` / `else:` — recuerda los dos puntos y la indentación.'],
        explain: 'Con `elif` cubres casos mutuamente excluyentes en orden; `else` recoge «todo lo demás», que aquí solo puede ser el cero.',
        commands: ['if', 'elif', 'else'],
      }),
      pyPractice({
        goal: 'La nota con letra',
        prompt: 'Lee una nota (0–100) y muestra su letra: **A** (90 o más), **B** (70–89), **C** (50–69) o **D** (menos de 50).',
        setup: { stdin: ['85'] },
        starter: 'nota = int(input("Nota: "))\n',
        check: all(outMatch('(^|\\s)B$'), uses('If', 3)),
        solution: 'nota = int(input("Nota: "))\nif nota >= 90:\n    print("A")\nelif nota >= 70:\n    print("B")\nelif nota >= 50:\n    print("C")\nelse:\n    print("D")',
        hints: ['Empieza por la condición más exigente (`>= 90`).', 'Como el `elif` solo se evalúa si lo anterior falló, basta con `>= 70`, `>= 50`…'],
        explain: 'No hace falta escribir «entre 70 y 89»: si llegaste al segundo `elif` es porque ya no eras 90 o más. Ordenar bien las condiciones simplifica todo.',
        commands: ['if', 'elif', 'else'],
      }),
      pyPractice({
        goal: 'Arregla la indentación',
        prompt: 'Este programa debería mostrar **Aprobado** y luego **Fin**, pero la indentación está mal. Corrígela.',
        starter: 'nota = 7\nif nota >= 5:\nprint("Aprobado")\nprint("Fin")',
        check: stdout('Aprobado\nFin'),
        solution: 'nota = 7\nif nota >= 5:\n    print("Aprobado")\nprint("Fin")',
        hints: ['El `print("Aprobado")` pertenece al `if`: debe ir sangrado.', '`Fin` no depende del `if`: déjalo sin sangría.'],
        explain: 'La indentación marca qué líneas dependen del `if`. Si "Fin" también estuviera sangrado, solo se mostraría cuando se aprueba.',
        commands: ['if', 'indentación'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py2-3', { title: 'and, or, not', summary: 'Combinar condiciones y valores «falsy» y «truthy»', emoji: '🧮', commands: ['and', 'or', 'not', 'truthy'], minutes: 10 }, [
      learn(
        'Combinar condiciones',
        `
Tres palabras reservadas combinan valores booleanos:

- **\`and\`**: verdadero solo si **ambos** lados lo son.
- **\`or\`**: verdadero si **al menos uno** lo es.
- **\`not\`**: invierte el valor.

\`\`\`
if edad >= 18 and tiene_dni:
    print("Puedes entrar")
\`\`\`

Precedencia: primero \`not\`, luego \`and\`, al final \`or\`. Cuando dudes, usa **paréntesis**: \`(a or b) and c\`.
`,
        '🧮',
      ),
      pyDemo('Tablas de verdad', [
        pyRepl('True and False'),
        pyRepl('True or False'),
        pyRepl('not True'),
        pyRepl('5 > 3 and 2 > 1'),
        pyRepl('5 < 3 or 2 > 1'),
        pyRepl('not (5 > 3)'),
        pyRepl('True or False and False', '`and` se evalúa antes que `or`'),
      ]),
      mc('¿Cuánto vale `True and not False`?', ['True', 'False', 'Error', 'None'], 0, '`not False` es `True`, y `True and True` es `True`.'),
      learn(
        'Cortocircuito',
        `
Python evalúa de izquierda a derecha y **se detiene en cuanto conoce el resultado**:

- En \`a and b\`, si \`a\` es falso, el resultado ya es falso: **no mira \`b\`**.
- En \`a or b\`, si \`a\` es verdadero, no mira \`b\`.

Eso se aprovecha para evitar errores:

\`\`\`
if divisor != 0 and 10 / divisor > 2:
    ...
\`\`\`

Si \`divisor\` es 0, la primera parte es falsa y la división nunca se calcula.

Y un detalle curioso: \`and\` / \`or\` no devuelven siempre \`True\`/\`False\`, sino **uno de los dos valores**. Por eso \`nombre = entrada or "anónimo"\` es un truco habitual para poner un valor por defecto.
`,
      ),
      pyDemo('Cortocircuito y valores por defecto', [
        ['divisor = 0\nif divisor != 0 and 10 / divisor > 2:\n    print("grande")\nelse:\n    print("sin dividir, sin error")'],
        pyRepl('0 or 5'),
        pyRepl('"" or "anónimo"'),
        pyRepl('"Ada" or "anónimo"'),
        pyRepl('"Ada" and "ok"'),
      ]),
      learn(
        'Truthy y falsy',
        `
En una condición, Python acepta **cualquier valor**, no solo bools. Los que cuentan como **falsos** («falsy») son los «vacíos o cero»:

\`False\`, \`None\`, \`0\`, \`0.0\`, \`""\` (texto vacío), \`[]\`, \`{}\`, \`()\` y \`set()\`.

**Todo lo demás es verdadero** («truthy»), incluso \`"0"\`, \`"False"\` o una lista con un cero dentro \`[0]\`. Gracias a eso se escribe \`if lista:\` en vez de \`if len(lista) > 0:\`.
`,
      ),
      pyOut('¿Qué imprime?', 'print(bool(0), bool("0"), bool([]), bool([0]))', ['False False False False', 'False False False True', 'True True False True'], '`0` y `[]` son falsos. `"0"` es un texto no vacío, y `[0]` una lista con un elemento: ambos son verdaderos.'),
      match(
        'Une cada valor con su `bool()`',
        [
          ['0', 'False'],
          ['"False"', 'True'],
          ['[]', 'False'],
          ['"  "', 'True'],
          ['None', 'False'],
        ],
        'Solo cuentan como falsos los valores «vacíos» (cero, texto o colección vacíos y None). Un texto con espacios o con la palabra «False» ya es verdadero.',
      ),
      tf('La expresión `"" or "x"` devuelve `True`.', false, 'Devuelve `"x"`: `or` entrega el primer valor verdadero (o el último si todos son falsos). No tiene por qué ser un bool.'),
      fill('Completa para permitir la entrada solo si es mayor de edad Y tiene entrada', 'if edad >= 18 ___ tiene_entrada:\n    print("Pasa")', ['and', 'or', 'not', 'in'], ['and'], 'Se necesitan **las dos** condiciones, así que es `and`. Con `or` bastaría una.'),
      pyPractice({
        goal: 'Entrada al cine',
        prompt: 'Lee la edad (entero) y si tiene entrada (`"si"` o `"no"`). Muestra **Acceso permitido** solo si tiene **12 años o más y** tiene entrada; en otro caso muestra **Acceso denegado**.',
        setup: { stdin: ['15', 'si'] },
        starter: 'edad = int(input("Edad: "))\ntiene_entrada = input("¿Tienes entrada? (si/no): ")\n',
        check: all(outHas('Acceso permitido'), uses('BoolOp')),
        solution: 'edad = int(input("Edad: "))\ntiene_entrada = input("¿Tienes entrada? (si/no): ")\nif edad >= 12 and tiene_entrada == "si":\n    print("Acceso permitido")\nelse:\n    print("Acceso denegado")',
        hints: ['Necesitas dos condiciones a la vez.', '`if edad >= 12 and tiene_entrada == "si":`'],
        explain: '`and` junta las dos exigencias en una sola condición. Sin él habría que anidar dos `if`.',
        commands: ['and', 'if'],
      }),
      pyPractice({
        goal: 'Fin de semana',
        prompt: 'Lee el nombre de un día (en minúsculas). Si es `"sabado"` **o** `"domingo"` muestra **Descanso**; si no, **A trabajar**.',
        setup: { stdin: ['domingo'] },
        starter: 'dia = input("Día: ")\n',
        check: all(outHas('Descanso'), uses('BoolOp')),
        solution: 'dia = input("Día: ")\nif dia == "sabado" or dia == "domingo":\n    print("Descanso")\nelse:\n    print("A trabajar")',
        hints: ['Basta con que se cumpla una de las dos condiciones.', 'Cuidado: `dia == "sabado" or "domingo"` NO hace lo que parece. Repite la comparación: `dia == ... or dia == ...`'],
        explain: 'Cada lado de un `or` es una condición completa. Escribir `dia == "sabado" or "domingo"` sería siempre verdadero, porque `"domingo"` (texto no vacío) es *truthy*.',
        commands: ['or'],
      }),
      pyCode('Guarda en `valido` si `x` es distinto de 0 **y** menor que 100 (con `x = 50`).', {
        starter: 'x = 50\n',
        check: all(variable('valido', 'True'), uses('BoolOp')),
        solution: 'x = 50\nvalido = x != 0 and x < 100',
        hint: 'Junta las dos comparaciones con `and`.',
        why: 'Cada comparación produce un bool; `and` los combina. El resultado se guarda como cualquier otro valor.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py2-4', { title: 'Pertenencia, identidad y ternario', summary: 'in, is y la expresión condicional', emoji: '🔎', commands: ['in', 'is', 'ternario'], minutes: 9 }, [
      learn(
        'in: ¿está dentro?',
        `
El operador **\`in\`** pregunta si un elemento está dentro de una colección o un fragmento dentro de un texto. Devuelve un bool. Su opuesto es **\`not in\`**.

- En textos: busca un **fragmento**: \`"py" in "python"\`.
- En listas, tuplas y conjuntos: busca un **elemento**.
- En diccionarios: busca entre las **claves**.
- En \`range\`: comprueba si el número está en el rango.
`,
        '🔎',
      ),
      pyDemo('Usando in', [
        pyRepl('"py" in "python"'),
        pyRepl('"z" not in "abc"'),
        pyRepl('3 in [1, 2, 3]'),
        pyRepl('"Ada" in {"Ada": 36, "Linus": 30}', 'En un diccionario se miran las claves'),
        pyRepl('5 in range(10)'),
        ['letra = "e"\nif letra in "aeiou":\n    print("vocal")'],
      ]),
      learn(
        'is frente a ==',
        `
- **\`==\`** pregunta: ¿tienen el **mismo valor**?
- **\`is\`** pregunta: ¿son **el mismo objeto** en memoria?

Dos listas con el mismo contenido son iguales (\`==\`) pero son objetos distintos (no \`is\`). Usa \`is\` casi únicamente con \`None\` (y \`True\`/\`False\`); para todo lo demás, \`==\`. Con números y textos, \`is\` puede dar resultados engañosos por optimizaciones internas de Python.
`,
      ),
      pyDemo('Igual no es lo mismo que idéntico', [
        ['a = [1, 2]\nb = [1, 2]\nc = a\nprint(a == b)\nprint(a is b)\nprint(a is c)', '`c` es otra etiqueta del mismo objeto que `a`'],
        ['x = None\nprint(x is None, x is not None)'],
      ]),
      mc('¿Cuándo es correcto usar `is`?', ['Para comparar números', 'Para comparar textos', 'Para comprobar si algo es None', 'Siempre, porque es más rápido'], 2, '`is None` es el uso estándar. Para valores (números, textos, listas…) compara con `==`.'),
      learn(
        'Expresión condicional (ternario)',
        `
A veces solo quieres elegir **entre dos valores**. En lugar de un \`if/else\` de cuatro líneas, existe la expresión condicional:

\`\`\`
valor_si_verdadero if condicion else valor_si_falso
\`\`\`

\`\`\`
estado = "adulto" if edad >= 18 else "menor"
\`\`\`

Se lee casi como en español. Es una *expresión* (produce un valor), así que se puede usar dentro de un \`print\` o una f-string. Úsala para casos sencillos; si se enreda, un \`if\` normal es más claro.
`,
      ),
      pyDemo('Elegir un valor', [
        ['edad = 20\nestado = "adulto" if edad >= 18 else "menor"\nprint(estado)'],
        ['n = 7\nprint(f"{n} es {\'par\' if n % 2 == 0 else \'impar\'}")', 'Dentro de una f-string (cuida las comillas)'],
      ]),
      pyOut('¿Qué imprime?', 'x = 7\nprint("par" if x % 2 == 0 else "impar")\nprint("a" in "banana", "x" in "banana")', ['impar\nTrue True', 'par\nTrue False', 'impar\nFalse True'], '7 es impar, así que la expresión condicional elige «impar». La «a» está en «banana»; la «x» no.'),
      tf('`a is b` siempre da el mismo resultado que `a == b`.', false, '`==` compara valores; `is` compara identidad. Dos listas iguales son `==` pero no `is`.'),
      fill('Completa para saber si la letra es una vocal', 'letra = "e"\nif letra ___ "aeiou":\n    print("vocal")', ['in', 'is', '==', 'not'], ['in'], '`in` busca el fragmento dentro del texto. `==` exigiría que la letra fuera igual a todo "aeiou".'),
      pyPractice({
        goal: 'Vocal o consonante',
        prompt: 'Lee una letra minúscula y muestra **vocal** si es una de `aeiou`, o **consonante** si no. Hazlo con una expresión condicional (ternario) dentro de un `print`.',
        setup: { stdin: ['e'] },
        starter: 'letra = input("Letra: ")\n',
        check: all(outMatch('(^|\\s)vocal$'), uses('IfExp')),
        solution: 'letra = input("Letra: ")\nprint("vocal" if letra in "aeiou" else "consonante")',
        hints: ['Estructura: `valor1 if condicion else valor2`.', '`print("vocal" if letra in "aeiou" else "consonante")`'],
        explain: 'El ternario devuelve un valor, así que cabe dentro del `print`. La condición `letra in "aeiou"` hace la comprobación de pertenencia.',
        commands: ['in', 'ternario'],
      }),
      pyPractice({
        goal: 'Descuento por compra',
        prompt: 'La variable `precio` vale 80. Si el precio supera 50, el descuento es 0.1 (10 %); si no, 0. Guarda el descuento en `descuento` con un ternario y el total a pagar en `total` (`precio * (1 - descuento)`).',
        starter: 'precio = 80\n',
        check: all(variable('descuento', '0.1'), variable('total', '72.0'), uses('IfExp')),
        solution: 'precio = 80\ndescuento = 0.1 if precio > 50 else 0\ntotal = precio * (1 - descuento)',
        hints: ['El ternario elige entre `0.1` y `0`.', '`descuento = 0.1 if precio > 50 else 0`'],
        explain: 'Primero decides el valor del descuento y después haces la cuenta con él: separar «decidir» de «calcular» mantiene el código limpio.',
        commands: ['ternario'],
      }),
      pyCode('Guarda en `sin_valor` si la variable `resultado` (que vale `None`) está vacía, usando `is`.', {
        starter: 'resultado = None\n',
        check: all(variable('sin_valor', 'True'), uses('Compare')),
        solution: 'resultado = None\nsin_valor = resultado is None',
        hint: 'Con None se usa `is`, no `==`.',
        why: '`resultado is None` es la forma estándar y segura de comprobar la ausencia de valor.',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py2-5', { title: 'Menús y validaciones', summary: 'Mini-proyectos con if/elif y match/case', emoji: '🍽️', commands: ['match', 'str.isdigit', 'if'], minutes: 12 }, [
      learn(
        'De la teoría a pequeños programas',
        `
Con \`input()\`, conversiones y condiciones ya puedes escribir programas útiles: calculadoras, menús, conversores… Un patrón muy común es el **menú**: mostrar opciones, leer una y actuar según la elegida.

\`\`\`
opcion = input("1) Saludar  2) Despedir: ")
if opcion == "1":
    print("¡Hola!")
elif opcion == "2":
    print("¡Adiós!")
else:
    print("Opción no válida")
\`\`\`

Fíjate en el \`else\` final: un buen programa siempre prevé qué hacer cuando el usuario escribe algo inesperado.
`,
        '🍽️',
      ),
      learn(
        'match / case: otra forma de elegir',
        `
Desde Python 3.10 existe **\`match\`**, pensado para elegir entre muchas opciones sobre un mismo valor. Es más ordenado que una larga cadena de \`elif\`:

\`\`\`
match opcion:
    case "1":
        print("¡Hola!")
    case "2" | "3":
        print("¡Adiós!")
    case _:
        print("Opción no válida")
\`\`\`

- Cada \`case\` es un **patrón**; se prueba de arriba abajo y se ejecuta el primero que encaja.
- \`|\` significa «o»: \`"2" | "3"\` encaja con cualquiera de los dos.
- \`_\` es el **comodín**: encaja con todo (como el \`else\`).

Más adelante descubrirás que \`match\` es capaz de mucho más (listas, diccionarios, clases…).
`,
      ),
      pyDemo(
        'Un menú con match',
        [
          ['opcion = input("1) Saludar  2) Despedir: ")\nmatch opcion:\n    case "1":\n        print("¡Hola!")\n    case "2" | "3":\n        print("¡Adiós!")\n    case _:\n        print("Opción no válida")', 'Con la entrada 2 se activa el segundo caso'],
        ],
        { stdin: ['2'] },
      ),
      pyOut('¿Qué imprime?', 'color = "verde"\nmatch color:\n    case "rojo" | "naranja":\n        print("cálido")\n    case "azul" | "verde":\n        print("frío")\n    case _:\n        print("otro")', ['cálido', 'otro', 'frío\notro'], '«verde» encaja con el segundo patrón (`"azul" | "verde"`). Solo se ejecuta el primer caso que encaja.'),
      mc('¿Qué hace `case _:` en un `match`?', ['Da un error', 'Encaja con cualquier valor (como un else)', 'Solo encaja con valores vacíos', 'Repite el caso anterior'], 1, '`_` es el comodín: encaja con cualquier cosa. Se pone al final para recoger los casos no previstos.'),
      learn(
        'Validar lo que escribe el usuario',
        `
Los usuarios escriben cosas inesperadas: letras donde esperas números, espacios, campos vacíos… **Validar** es comprobar el dato *antes* de usarlo.

- \`texto.isdigit()\` → ¿son todo dígitos? (evita el \`ValueError\` al hacer \`int(texto)\`).
- \`texto.strip()\` → quita espacios sobrantes.
- \`0 <= n <= 100\` → ¿está en el rango permitido?
- \`if not texto:\` → ¿vino vacío?

Más adelante (con \`try/except\`) verás otra forma de manejar los errores; por ahora, comprueba primero.
`,
      ),
      pyDemo(
        'Comprobar antes de convertir',
        [
          ['texto = input("Edad: ").strip()\nif texto.isdigit():\n    print("Dentro de un año tendrás", int(texto) + 1)\nelse:\n    print("Eso no es una edad válida")', 'Con la entrada «abc» no se llega a convertir'],
        ],
        { stdin: ['abc'] },
      ),
      tf('En un `match`, `case _` se ejecuta cuando ningún caso anterior ha coincidido.', true, 'Es el comodín final. Si lo pones antes de otros casos, estos nunca se alcanzarán.'),
      fill('Completa el patrón para que encaje con "a" o con "b"', 'match letra:\n    case "a" ___ "b":\n        print("ok")', ['|', 'or', ',', '&'], ['|'], 'En los patrones de `match` la alternativa se escribe con `|`. La palabra `or` se usa en las condiciones, no en los patrones.'),
      pyPractice({
        goal: 'Índice de masa corporal',
        prompt: 'Lee el peso (kg) y la altura (m), ambos decimales. Calcula `imc = peso / altura ** 2`. Muestra `IMC: X` con **un decimal** y, en otra línea, la categoría: **Bajo peso** (< 18.5), **Normal** (< 25), **Sobrepeso** (< 30) u **Obesidad** (30 o más).',
        setup: { stdin: ['70', '1.75'] },
        starter: 'peso = float(input("Peso (kg): "))\naltura = float(input("Altura (m): "))\n',
        check: all(outHas('IMC: 22.9', 'Normal'), uses('If', 3)),
        solution: 'peso = float(input("Peso (kg): "))\naltura = float(input("Altura (m): "))\nimc = peso / altura ** 2\nprint(f"IMC: {imc:.1f}")\nif imc < 18.5:\n    print("Bajo peso")\nelif imc < 25:\n    print("Normal")\nelif imc < 30:\n    print("Sobrepeso")\nelse:\n    print("Obesidad")',
        hints: ['Calcula primero el IMC y guárdalo en una variable.', 'Una cadena `if / elif / elif / else` con los límites en orden ascendente.'],
        explain: 'La potencia (`**`) se evalúa antes que la división, así que `peso / altura ** 2` ya es peso ÷ (altura²). Las condiciones en orden creciente permiten ahorrarse los límites inferiores.',
        commands: ['if', 'elif', 'else'],
      }),
      pyPractice({
        goal: 'Calculadora',
        prompt: 'Lee un número entero, un operador (`+`, `-`, `*`) y otro entero. Muestra `Resultado: X`. Si el operador no es válido, muestra **Operador desconocido**. Usa `match`.',
        setup: { stdin: ['8', '*', '4'] },
        starter: 'a = int(input("Primer número: "))\nop = input("Operador (+ - *): ")\nb = int(input("Segundo número: "))\n',
        check: all(outMatch('Resultado: 32$'), uses('Match')),
        solution: 'a = int(input("Primer número: "))\nop = input("Operador (+ - *): ")\nb = int(input("Segundo número: "))\nmatch op:\n    case "+":\n        print(f"Resultado: {a + b}")\n    case "-":\n        print(f"Resultado: {a - b}")\n    case "*":\n        print(f"Resultado: {a * b}")\n    case _:\n        print("Operador desconocido")',
        hints: ['Un `case` por cada operador y un `case _` para el resto.', 'Dentro de cada caso, un `print` con el resultado de esa operación.'],
        explain: '`match` deja las opciones alineadas y fáciles de ampliar: añadir una división sería añadir un `case "/"`.',
        commands: ['match'],
      }),
      pyPractice({
        goal: 'Año bisiesto',
        prompt: 'Lee un año y muestra **X es bisiesto** o **X no es bisiesto**. Un año es bisiesto si es divisible entre 4, salvo que sea divisible entre 100, a menos que también lo sea entre 400.',
        setup: { stdin: ['2024'] },
        starter: 'anio = int(input("Año: "))\n',
        check: all(outHas('2024 es bisiesto'), uses('BoolOp')),
        solution: 'anio = int(input("Año: "))\nif anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0):\n    print(f"{anio} es bisiesto")\nelse:\n    print(f"{anio} no es bisiesto")',
        hints: ['Es bisiesto si: múltiplo de 4 **y** (no múltiplo de 100 **o** múltiplo de 400).', 'Usa paréntesis para agrupar el `or`: `anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0)`.'],
        explain: 'Los paréntesis hacen que el `or` se evalúe antes que el `and`. Prueba mentalmente con 1900 (no bisiesto), 2000 (bisiesto) y 2024 (bisiesto).',
        commands: ['and', 'or', 'if'],
      }),
    ]),
  ],
  boss: {
    goal: 'Cajero automático',
    prompt:
      'El saldo inicial es `saldo = 100`. Escribe un programa que muestre un menú y lea la opción:\n\n- `1` → muestra `Saldo: X`.\n- `2` → pide una cantidad (entero) y la retira. Si es mayor que el saldo, muestra `Fondos insuficientes`; si no, muestra `Saldo restante: X`.\n- Cualquier otra opción → `Opción inválida`.\n\nEn esta prueba el usuario elige la opción 2 y retira 30.',
    setup: { stdin: ['2', '30'] },
    starter: 'saldo = 100\nopcion = input("1) Consultar  2) Retirar: ")\n',
    check: all(outHas('Saldo restante: 70'), uses('If', 2)),
    solution:
      'saldo = 100\nopcion = input("1) Consultar  2) Retirar: ")\nif opcion == "1":\n    print(f"Saldo: {saldo}")\nelif opcion == "2":\n    cantidad = int(input("Cantidad: "))\n    if cantidad > saldo:\n        print("Fondos insuficientes")\n    else:\n        saldo = saldo - cantidad\n        print(f"Saldo restante: {saldo}")\nelse:\n    print("Opción inválida")',
    hints: ['Primero decide la rama según `opcion`; la cantidad solo se pide en la rama del `2`.', 'Dentro de la rama 2 tienes otra decisión: ¿hay fondos suficientes?'],
    explain: 'Un menú con decisiones anidadas: el caso típico de un programa real. Recuerda: `input` devuelve texto, por eso se compara con `"1"` y `"2"` entre comillas, y la cantidad se convierte con `int`.',
    commands: ['if', 'elif', 'else', 'input'],
  },
});
