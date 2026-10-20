import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyOut, pyPractice, pyRepl, pyWorld } from '../pybuild';
import { all, forbids, outHas, stdout, uses, variable } from '../pycheck';

export const py3 = pyWorld({
  id: 'py3',
  index: 3,
  title: 'Bucles',
  subtitle: 'Repetir sin copiar y pegar',
  emoji: '🔁',
  color: '#22D3A6',
  level: 'basico',
  intro:
    'Los ordenadores son increíbles repitiendo tareas: mil veces, un millón de veces, sin cansarse ni equivocarse. En esta zona aprenderás los dos bucles de Python (`while` y `for`), a controlarlos con `break` y `continue`, y los patrones que usarás todos los días: acumuladores, contadores y búsquedas.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py3-1', { title: 'while', summary: 'Repetir mientras se cumpla una condición', emoji: '♻️', commands: ['while', 'break'], minutes: 9 }, [
      learn(
        'Repetir mientras...',
        `
Un **bucle** repite un bloque de código. El más sencillo es **\`while\`** («mientras»): evalúa una condición y, **mientras sea verdadera**, ejecuta el bloque una y otra vez.

\`\`\`
n = 3
while n > 0:
    print(n)
    n -= 1
print("¡Despegue!")
\`\`\`

Un bucle \`while\` casi siempre tiene tres piezas:

1. **Preparación**: la variable de control antes del bucle (\`n = 3\`).
2. **Condición**: cuándo seguir (\`n > 0\`).
3. **Avance**: algo dentro del bloque que acerca la condición a ser falsa (\`n -= 1\`).

> CLAVE: Si te olvidas del avance, la condición nunca cambia y el bucle **no termina jamás** (bucle infinito).
`,
        '♻️',
      ),
      pyDemo('Cuenta atrás y sumas', [
        ['n = 3\nwhile n > 0:\n    print(n)\n    n -= 1\nprint("¡Despegue!")', 'La condición se vuelve falsa cuando n llega a 0'],
        ['total = 0\ni = 1\nwhile i <= 5:\n    total += i\n    i += 1\nprint(total)', 'Acumula 1 + 2 + 3 + 4 + 5'],
      ]),
      pyOut('¿Qué imprime?', 'n = 1\nwhile n < 20:\n    n *= 2\nprint(n)', ['16', '20', '40'], 'n va valiendo 1, 2, 4, 8, 16 y 32. Cuando llega a 32 la condición `n < 20` es falsa y el bucle termina; se imprime 32.'),
      learn(
        'Bucles infinitos y break',
        `
A veces **quieres** un bucle sin fin aparente: «pregunta hasta que el usuario acierte». Se escribe \`while True:\` y se sale con **\`break\`**, que interrumpe el bucle de inmediato.

\`\`\`
while True:
    texto = input("Escribe 'salir' para terminar: ")
    if texto == "salir":
        break
    print("Escribiste:", texto)
\`\`\`

Este es el patrón de «**repetir hasta que**…»: más claro que duplicar la lectura antes y dentro del bucle.
`,
      ),
      pyDemo(
        'Leer hasta que el usuario diga basta',
        [['while True:\n    texto = input("Número (0 para salir): ")\n    if texto == "0":\n        break\n    print("Leíste", texto)\nprint("Fin")', 'Con las entradas 5, 7 y 0 el programa se detiene en la tercera vuelta']],
        { stdin: ['5', '7', '0'] },
      ),
      mc('¿Qué ocurre si en un `while n > 0:` olvidas restar a `n` dentro del bucle?', ['El bucle no se ejecuta', 'Se ejecuta una sola vez', 'Se repite sin fin: bucle infinito', 'Python avisa con un error'], 2, 'La condición sigue siendo verdadera para siempre. Python no lo detecta: eres tú quien debe asegurar que el bucle puede terminar.'),
      tf('`while True:` es siempre un error de programación.', false, 'Es un patrón legítimo si dentro hay un `break` (o un `return`) que permite salir.'),
      fill('Completa para salir del bucle cuando la respuesta sea "ok"', 'while True:\n    r = input("> ")\n    if r == "ok":\n        ___', ['break', 'continue', 'pass', 'exit'], ['break'], '`break` interrumpe el bucle. `continue` solo saltaría a la siguiente vuelta.'),
      pyPractice({
        goal: 'Cuenta atrás',
        prompt: 'Con un bucle `while`, muestra los números del **5 al 1** (uno por línea) y después **¡Despegue!**.',
        starter: 'n = 5\n',
        check: all(stdout('5\n4\n3\n2\n1\n¡Despegue!'), uses('While')),
        solution: 'n = 5\nwhile n >= 1:\n    print(n)\n    n -= 1\nprint("¡Despegue!")',
        hints: ['La condición debe seguir siendo cierta mientras `n` valga 1 o más.', '`while n >= 1:` y dentro `print(n)` y `n -= 1`.'],
        explain: 'Preparación (`n = 5`), condición (`n >= 1`) y avance (`n -= 1`): las tres piezas de todo `while`.',
        commands: ['while'],
      }),
      pyPractice({
        goal: 'Duplicar hasta pasar de 1000',
        prompt: 'Empieza con `valor = 1` y `pasos = 0`. Mientras `valor` sea **menor o igual que 1000**, duplícalo y suma 1 a `pasos`. Al terminar, `valor` y `pasos` deben tener los valores finales.',
        starter: 'valor = 1\npasos = 0\n',
        check: all(variable('valor', '1024'), variable('pasos', '10'), uses('While')),
        solution: 'valor = 1\npasos = 0\nwhile valor <= 1000:\n    valor *= 2\n    pasos += 1',
        hints: ['Dentro del bucle hacen falta dos instrucciones.', '`valor *= 2` y `pasos += 1`'],
        explain: 'Un `while` es ideal cuando no sabes de antemano cuántas vueltas hacen falta. Aquí harían falta 10 duplicaciones (2^10 = 1024).',
        commands: ['while'],
      }),
      pyPractice({
        goal: 'Adivina el número',
        prompt: 'El número secreto es `7`. Pide números con `input()` **hasta que el usuario acierte**. Al final muestra **Acertaste en N intentos** (N = cuántos números escribió).',
        setup: { stdin: ['3', '8', '7'] },
        starter: 'secreto = 7\nintentos = 0\n',
        check: all(outHas('Acertaste en 3 intentos'), uses('While')),
        solution: 'secreto = 7\nintentos = 0\nwhile True:\n    n = int(input("Tu número: "))\n    intentos += 1\n    if n == secreto:\n        break\nprint(f"Acertaste en {intentos} intentos")',
        hints: ['Usa `while True:` y sal con `break` cuando acierte.', 'Cuenta un intento en cada vuelta, antes de comprobar.'],
        explain: 'El contador `intentos` es un **acumulador**: empieza en 0 y crece una unidad por vuelta. Lo verás en cada lección de esta zona.',
        commands: ['while', 'break'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py3-2', { title: 'for y range', summary: 'Recorrer secuencias y repetir un número exacto de veces', emoji: '🎡', commands: ['for', 'range', 'enumerate'], minutes: 10 }, [
      learn(
        'for: una vuelta por cada elemento',
        `
Cuando sabes **qué** quieres recorrer (las letras de un texto, los elementos de una lista, los números de un rango) usa **\`for\`**:

\`\`\`
for letra in "Python":
    print(letra)
\`\`\`

En cada vuelta, la **variable del bucle** (\`letra\`) toma el siguiente elemento. Cuando se acaban, el bucle termina solo: no hay riesgo de bucle infinito ni contador que mantener. Por eso, **si puedes usar \`for\`, úsalo** en lugar de \`while\`.
`,
        '🎡',
      ),
      illus('py-loop-flow', 'El camino de un for', 'Cada vuelta toma el siguiente elemento hasta que no quedan más.'),
      pyDemo('Recorrer textos y listas', [
        ['for letra in "Py":\n    print(letra)', 'Un texto se recorre carácter a carácter'],
        ['frutas = ["manzana", "pera", "kiwi"]\nfor fruta in frutas:\n    print("Me gusta", fruta)', 'Una lista, elemento a elemento (las verás a fondo en la zona 4)'],
      ]),
      learn(
        'range: una secuencia de números',
        `
Para repetir algo **N veces** o recorrer números, usa **\`range\`**:

| Llamada | Genera |
|---|---|
| \`range(5)\` | 0, 1, 2, 3, 4 |
| \`range(2, 6)\` | 2, 3, 4, 5 |
| \`range(0, 10, 3)\` | 0, 3, 6, 9 |
| \`range(5, 0, -1)\` | 5, 4, 3, 2, 1 |

Regla de oro: **el final nunca se incluye** (igual que en las rebanadas de texto). \`range(5)\` tiene 5 números pero llega solo hasta el 4. Con \`list(range(...))\` puedes ver sus valores.
`,
      ),
      pyDemo('Mirando dentro de range', [pyRepl('list(range(5))'), pyRepl('list(range(2, 6))'), pyRepl('list(range(0, 10, 3))'), pyRepl('list(range(5, 0, -1))', 'Con paso negativo, cuenta hacia atrás'), ['for i in range(3):\n    print("vuelta", i)']]),
      pyOut('¿Qué imprime?', 'for i in range(3):\n    print(i)\nfor i in range(10, 0, -4):\n    print(i)', ['1\n2\n3\n10\n6\n2', '0\n1\n2\n10\n6\n2\n-2', '0\n1\n2\n10\n6'], 'El primer bucle da 0, 1 y 2. El segundo empieza en 10 y baja de 4 en 4 mientras sea mayor que 0: 10, 6 y 2.'),
      mc('¿Qué `range` produce los números del 1 al 5?', ['range(5)', 'range(1, 5)', 'range(1, 6)', 'range(0, 5)'], 2, 'El final no se incluye, así que para llegar al 5 hay que parar en 6: `range(1, 6)`.'),
      tf('`range(5)` incluye el número 5.', false, 'Genera 0, 1, 2, 3 y 4: cinco números, pero nunca el valor final.'),
      learn(
        'enumerate: posición y valor a la vez',
        `
A veces quieres el elemento **y** su número de orden. En lugar de gestionar un contador a mano, usa **\`enumerate\`**:

\`\`\`
for pos, fruta in enumerate(["pan", "leche"]):
    print(pos, fruta)        # 0 pan / 1 leche
\`\`\`

Con \`start=1\` la cuenta empieza donde tú quieras: \`enumerate(lista, start=1)\`. Verás que \`pos, fruta\` desempaqueta dos valores a la vez; lo estudiarás en la zona de colecciones.
`,
      ),
      pyDemo('Numerar una lista', [['colores = ["rojo", "verde", "azul"]\nfor numero, color in enumerate(colores, start=1):\n    print(f"{numero}. {color}")']]),
      fill('Completa para mostrar los números 0, 1 y 2', 'for i in range(___):\n    print(i)', ['3', '2', '0', '1'], ['3'], '`range(3)` genera 3 números empezando en 0: 0, 1 y 2.'),
      pyPractice({
        goal: 'Tabla del 7',
        prompt: 'Muestra la tabla de multiplicar del 7, del 1 al 10, con este formato exacto (una línea por cada multiplicación):\n\n```\n7 x 1 = 7\n7 x 2 = 14\n...\n7 x 10 = 70\n```',
        starter: '',
        check: all(stdout('7 x 1 = 7\n7 x 2 = 14\n7 x 3 = 21\n7 x 4 = 28\n7 x 5 = 35\n7 x 6 = 42\n7 x 7 = 49\n7 x 8 = 56\n7 x 9 = 63\n7 x 10 = 70'), uses('For')),
        solution: 'for i in range(1, 11):\n    print(f"7 x {i} = {7 * i}")',
        hints: ['Recorre `range(1, 11)` y usa una f-string.', '`print(f"7 x {i} = {7 * i}")`'],
        explain: '`range(1, 11)` llega hasta 10. Dentro del bucle, la variable `i` se usa tanto para mostrar como para calcular.',
        commands: ['for', 'range'],
      }),
      pyPractice({
        goal: 'Suma de 1 a 100',
        prompt: 'Calcula la suma de todos los números del 1 al 100 con un bucle `for` y guárdala en la variable `total`. (Parte de `total = 0`.)',
        starter: 'total = 0\n',
        check: all(variable('total', '5050'), uses('For')),
        solution: 'total = 0\nfor n in range(1, 101):\n    total += n',
        hints: ['Necesitas recorrer 1, 2, …, 100.', '`for n in range(1, 101): total += n`'],
        explain: 'Es el patrón **acumulador**: una variable que empieza en 0 y va sumando. (Gauss lo resolvió con una fórmula, pero el bucle funciona para cualquier secuencia.)',
        commands: ['for', 'range'],
      }),
      pyPractice({
        goal: 'Lista numerada',
        prompt: 'Dada la lista `compra`, muestra cada elemento numerado desde 1 con el formato `1. pan`. Usa `enumerate`.',
        starter: 'compra = ["pan", "leche", "huevos"]\n',
        check: all(stdout('1. pan\n2. leche\n3. huevos'), uses('call:enumerate')),
        solution: 'compra = ["pan", "leche", "huevos"]\nfor n, producto in enumerate(compra, start=1):\n    print(f"{n}. {producto}")',
        hints: ['`enumerate(compra, start=1)` te da el número y el producto.', '`for n, producto in enumerate(compra, start=1):`'],
        explain: '`enumerate` evita el contador manual (`i = 0 ... i += 1`), que es fuente de errores.',
        commands: ['enumerate'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py3-3', { title: 'break, continue y else', summary: 'Control fino de lo que ocurre en cada vuelta', emoji: '🚧', commands: ['break', 'continue', 'else'], minutes: 9 }, [
      learn(
        'Tres herramientas para cualquier bucle',
        `
- **\`break\`**: termina el bucle **ya**, aunque queden vueltas.
- **\`continue\`**: abandona la vuelta actual y **salta a la siguiente**.
- **\`else\`** (en un bucle): su bloque se ejecuta **solo si el bucle terminó sin \`break\`**, es decir, si recorrió todo.

\`\`\`
for n in range(10):
    if n == 3:
        continue      # el 3 se salta
    if n == 6:
        break         # a partir del 6, nada más
    print(n)          # 0 1 2 4 5
\`\`\`
`,
        '🚧',
      ),
      pyDemo('break y continue', [
        ['for n in range(10):\n    if n == 3:\n        continue\n    if n == 6:\n        break\n    print(n)', '0 1 2 4 5: se salta el 3 y se corta en el 6'],
        ['for n in range(1, 20):\n    if n % 7 == 0:\n        print("Primer múltiplo de 7:", n)\n        break', 'Buscar y parar en cuanto se encuentra'],
      ]),
      learn(
        'El else de los bucles',
        `
El \`else\` de un bucle suena extraño al principio, pero resuelve un patrón muy común: **«buscar algo y avisar si no está»** sin necesidad de variables auxiliares.

\`\`\`
for n in [4, 8, 15]:
    if n == 99:
        print("lo encontré")
        break
else:
    print("no estaba")
\`\`\`

Se lee: «para cada n… ; **si no se interrumpió**, entonces…». Si hay un \`break\`, el \`else\` se salta.
`,
      ),
      pyDemo('for ... else', [
        ['for n in [4, 8, 15]:\n    if n == 8:\n        print("encontrado")\n        break\nelse:\n    print("no estaba")', 'Se encontró y hubo break: el else no se ejecuta'],
        ['for n in [4, 8, 15]:\n    if n == 99:\n        print("encontrado")\n        break\nelse:\n    print("no estaba")', 'Terminó sin break: sí se ejecuta el else'],
      ]),
      pyOut('¿Qué imprime?', 'for n in range(5):\n    if n % 2 == 0:\n        continue\n    print(n)', ['0\n2\n4', '1\n3\n5', '1\n2\n3\n4'], '`continue` salta los pares (0, 2, 4), así que solo se imprimen los impares: 1 y 3.'),
      mc('¿Cuándo se ejecuta el `else` de un `for`?', ['Siempre al final', 'Cuando el bucle no se ejecutó ni una vez', 'Cuando el bucle terminó sin ejecutar ningún `break`', 'Cuando hubo un error'], 2, 'El `else` de un bucle se ejecuta solo si el bucle llegó al final de forma natural, sin ser interrumpido por `break`.'),
      tf('`continue` termina el bucle completo.', false, '`continue` solo abandona la vuelta actual; el bucle sigue con la siguiente. Quien termina el bucle es `break`.'),
      fill('Completa para saltarte los números pares', 'for n in range(10):\n    if n % 2 == 0:\n        ___\n    print(n)', ['continue', 'break', 'pass', 'return'], ['continue'], '`continue` salta el resto de esta vuelta y pasa a la siguiente, así los pares nunca llegan al `print`.'),
      pyPractice({
        goal: 'Primer múltiplo de 7 mayor que 50',
        prompt: 'Recorre los números desde 51 en adelante con `for n in range(51, 200)`. Guarda en `primero` el **primer** múltiplo de 7 y sal del bucle con `break`.',
        starter: 'primero = None\nfor n in range(51, 200):\n    pass  # completa el bucle\n',
        check: all(variable('primero', '56'), uses('Break')),
        solution: 'primero = None\nfor n in range(51, 200):\n    if n % 7 == 0:\n        primero = n\n        break',
        hints: ['Dentro del `for`, comprueba `n % 7 == 0`.', 'Cuando lo encuentres: `primero = n` y luego `break`.'],
        explain: 'Sin `break`, el bucle seguiría y `primero` acabaría valiendo el último múltiplo (196). `break` convierte el bucle en una búsqueda eficiente.',
        commands: ['break', 'for'],
      }),
      pyPractice({
        goal: 'Solo los impares',
        prompt: 'Muestra los números impares del 1 al 9 (uno por línea) usando `continue` para saltarte los pares.',
        starter: '',
        check: all(stdout('1\n3\n5\n7\n9'), uses('Continue')),
        solution: 'for n in range(1, 10):\n    if n % 2 == 0:\n        continue\n    print(n)',
        hints: ['Recorre `range(1, 10)`.', 'Si `n` es par (`n % 2 == 0`), haz `continue`.'],
        explain: 'Hay otras formas de lograr lo mismo (`range(1, 10, 2)`), pero `continue` es la herramienta general cuando el criterio de salto es más complejo.',
        commands: ['continue'],
      }),
      pyPractice({
        goal: 'Buscar con for/else',
        prompt: 'La lista `numeros` es `[4, 8, 15, 16, 23, 42]` y `objetivo` vale `15`. Recórrela: si encuentras el objetivo muestra **encontrado** y para; si terminas sin hallarlo, muestra **no está**. Usa `for ... else`.',
        starter: 'numeros = [4, 8, 15, 16, 23, 42]\nobjetivo = 15\n',
        check: all(stdout('encontrado'), uses('For'), uses('Break')),
        solution: 'numeros = [4, 8, 15, 16, 23, 42]\nobjetivo = 15\nfor n in numeros:\n    if n == objetivo:\n        print("encontrado")\n        break\nelse:\n    print("no está")',
        hints: ['El `else` se alinea con el `for`, no con el `if`.', 'Dentro del `if`: `print("encontrado")` y `break`.'],
        explain: 'Cambia `objetivo` a 99 y verás **no está**. El `else` del `for` evita tener que guardar una variable «encontrado = False» a mano.',
        commands: ['for', 'break', 'else'],
      }),
      pyCode('Con `n` desde 1 hasta 10, suma en `total` solo los que NO son múltiplos de 3 (usa `continue`).', {
        starter: 'total = 0\n',
        check: all(variable('total', '37'), uses('Continue')),
        solution: 'total = 0\nfor n in range(1, 11):\n    if n % 3 == 0:\n        continue\n    total += n',
        hint: 'Salta los múltiplos de 3 antes de sumar.',
        why: '1+2+4+5+7+8+10 = 37. Los múltiplos de 3 (3, 6, 9) se saltan con `continue` antes de llegar a la suma.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py3-4', { title: 'Acumuladores y patrones', summary: 'Sumar, contar, buscar el mayor y centinelas', emoji: '🧺', commands: ['sum', 'min', 'max', 'len'], minutes: 11 }, [
      learn(
        'El patrón acumulador',
        `
Casi todos los bucles reales hacen una de estas cosas con los datos que recorren, y todas siguen el mismo esquema: **una variable que se prepara antes del bucle y se actualiza dentro**.

| Objetivo | Se prepara | Se actualiza |
|---|---|---|
| **Sumar** | \`total = 0\` | \`total += x\` |
| **Contar** | \`cuenta = 0\` | \`cuenta += 1\` (a veces con un \`if\`) |
| **Multiplicar** | \`producto = 1\` | \`producto *= x\` |
| **Buscar el mayor** | \`mayor = primer elemento\` | \`if x > mayor: mayor = x\` |
| **Construir texto** | \`resultado = ""\` | \`resultado += letra\` |

El valor inicial importa: para multiplicar empieza en **1** (si empezara en 0, todo sería 0).
`,
        '🧺',
      ),
      pyDemo('Sumar, contar y buscar el mayor', [
        ['total = 0\nfor n in [4, 9, 2, 7]:\n    total += n\nprint("Suma:", total)'],
        ['pares = 0\nfor n in range(1, 11):\n    if n % 2 == 0:\n        pares += 1\nprint("Pares:", pares)', 'Contar solo los que cumplen una condición'],
        ['mayor = 3\nfor n in [3, 17, 8, 25, 4]:\n    if n > mayor:\n        mayor = n\nprint("Mayor:", mayor)'],
        ['al_reves = ""\nfor letra in "hola":\n    al_reves = letra + al_reves\nprint(al_reves)', 'Construir un texto letra a letra'],
      ]),
      mc('¿Con qué valor debe empezar un acumulador que **multiplica**?', ['0', '1', '-1', 'Da igual'], 1, 'El 1 es el elemento neutro de la multiplicación. Con 0, todo producto saldría 0.'),
      learn(
        'Centinela: parar cuando llegue una señal',
        `
Cuando no sabes cuántos datos habrá, el usuario avisa de que ha terminado con un valor especial llamado **centinela** (por ejemplo, \`0\` o \`"fin"\`). El bucle lee, comprueba el centinela y se detiene:

\`\`\`
total = 0
cuenta = 0
while True:
    n = int(input("Número (0 para terminar): "))
    if n == 0:
        break
    total += n
    cuenta += 1
\`\`\`

Tras el bucle podrás calcular, por ejemplo, el promedio (cuidado: si no se leyó ningún dato, \`cuenta\` sería 0 y dividir daría error).
`,
      ),
      pyDemo(
        'Promedio de lo que escriba el usuario',
        [['total = 0\ncuenta = 0\nwhile True:\n    n = int(input("Número (0 para terminar): "))\n    if n == 0:\n        break\n    total += n\n    cuenta += 1\nprint("Suma:", total, "Cantidad:", cuenta)\nprint("Promedio:", total / cuenta)']],
        { stdin: ['4', '10', '7', '0'] },
      ),
      learn(
        'Funciones listas: sum, min, max, len',
        `
Los patrones más comunes ya vienen hechos. Con cualquier colección de números:

- \`sum(coleccion)\` → suma todo.
- \`min(coleccion)\` / \`max(coleccion)\` → el menor / el mayor.
- \`len(coleccion)\` → cuántos elementos tiene.

También aceptan varios valores sueltos: \`max(3, 9, 2)\`. ¿Entonces para qué aprender los bucles? Porque cuando el criterio es propio («sumar solo los que cumplen X») hace falta el patrón completo, y porque entender qué hay debajo te hace mejor programador.
`,
      ),
      pyDemo('Atajos', [pyRepl('sum([3, 5, 8])'), pyRepl('max(3, 9, 2)'), pyRepl('min([4, 1, 7])'), pyRepl('sum(range(1, 101))', 'La suma del 1 al 100 en una línea'), pyRepl('max("hola")', 'También sirve con textos (por orden alfabético)')]),
      pyOut('¿Qué imprime?', 'total = 0\nfor n in range(1, 6):\n    if n % 2 == 1:\n        total += n\nprint(total)', ['15', '6', '25'], 'Solo se suman los impares del 1 al 5: 1 + 3 + 5 = 9.'),
      match(
        'Une cada objetivo con el valor inicial adecuado',
        [
          ['Contar elementos', 'cuenta = 0'],
          ['Sumar números', 'total = 0'],
          ['Multiplicar números', 'producto = 1'],
          ['Construir un texto', 'resultado = ""'],
        ],
        'El valor inicial debe ser el elemento neutro de la operación: 0 para sumar y contar, 1 para multiplicar, el texto vacío para pegar textos.',
      ),
      tf('Para buscar el mayor de una lista de números se puede empezar con `mayor = 0` sin ningún problema.', false, 'Si todos los números son negativos, el 0 inicial nunca sería superado y el resultado sería incorrecto. Empieza con el primer elemento de la lista.'),
      pyPractice({
        goal: 'Promedio con centinela',
        prompt: 'Lee números enteros hasta que el usuario escriba **0**. Muestra al final el promedio de los números leídos (sin contar el 0) con el formato `Promedio: X`.',
        setup: { stdin: ['4', '10', '7', '0'] },
        starter: 'total = 0\ncuenta = 0\n',
        check: all(outHas('Promedio: 7.0'), uses('While')),
        solution: 'total = 0\ncuenta = 0\nwhile True:\n    n = int(input("Número: "))\n    if n == 0:\n        break\n    total += n\n    cuenta += 1\nprint(f"Promedio: {total / cuenta}")',
        hints: ['Dos acumuladores: la suma y la cantidad.', 'No sumes el 0: haz el `break` antes de `total += n`.'],
        explain: 'El orden dentro del bucle importa: primero se comprueba el centinela y solo después se acumula, para que el 0 no cuente.',
        commands: ['while', 'break'],
      }),
      pyPractice({
        goal: 'Contar vocales',
        prompt: 'Cuenta cuántas vocales (a, e, i, o, u, en minúscula) tiene el texto `frase` y guarda el resultado en `vocales`.',
        starter: 'frase = "python es genial"\n',
        check: all(variable('vocales', '5'), uses('For')),
        solution: 'frase = "python es genial"\nvocales = 0\nfor letra in frase:\n    if letra in "aeiou":\n        vocales += 1',
        hints: ['Recorre el texto letra a letra.', '`if letra in "aeiou": vocales += 1`'],
        explain: 'Combinas tres ideas: recorrer un texto, pertenencia con `in` y un contador condicional.',
        commands: ['for', 'in'],
      }),
      pyPractice({
        goal: 'El mayor, sin usar max',
        prompt: 'Encuentra el número más grande de la lista `datos` **con un bucle** (sin llamar a `max`) y guárdalo en `mayor`.',
        starter: 'datos = [-8, -3, -15, -1, -9]\n',
        check: all(variable('mayor', '-1'), forbids('call:max')),
        solution: 'datos = [-8, -3, -15, -1, -9]\nmayor = datos[0]\nfor n in datos:\n    if n > mayor:\n        mayor = n',
        hints: ['Cuidado: todos son negativos, así que empezar con `mayor = 0` fallaría.', 'Empieza con `mayor = datos[0]` y compara cada elemento.'],
        explain: 'Inicializar con el primer elemento (y no con 0) hace que el algoritmo funcione para cualquier lista, incluso de negativos.',
        commands: ['max', 'for'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py3-5', { title: 'Bucles anidados', summary: 'Tablas, triángulos, primos y FizzBuzz', emoji: '🧱', commands: ['for', 'range', 'while'], minutes: 11 }, [
      learn(
        'Un bucle dentro de otro',
        `
Un bucle puede contener otro bucle. Por cada vuelta del **externo**, el **interno** se ejecuta **completo**. Así se recorren cosas de dos dimensiones: filas y columnas, días y horas, parejas de elementos…

\`\`\`
for fila in range(1, 4):
    for col in range(1, 4):
        print(fila * col, end=" ")
    print()          # salto de línea al terminar cada fila
\`\`\`

Si el externo da *a* vueltas y el interno *b*, el cuerpo interno se ejecuta *a × b* veces. Es habitual en tablas, matrices, comparar todas las parejas… y también la razón de que algunos programas se vuelvan lentos.
`,
        '🧱',
      ),
      pyDemo('Una tabla y un triángulo', [
        ['for fila in range(1, 4):\n    for col in range(1, 4):\n        print(fila * col, end=" ")\n    print()', 'La tabla de multiplicar 3 × 3'],
        ['for i in range(1, 5):\n    print("*" * i)', 'Un triángulo con un solo bucle: repetir el texto'],
      ]),
      pyOut('¿Cuántas veces se ejecuta el `n += 1`?', 'n = 0\nfor i in range(3):\n    for j in range(4):\n        n += 1\nprint(n)', ['7', '3', '4'], 'El bucle interno da 4 vueltas por cada una de las 3 del externo: 3 × 4 = 12.'),
      learn(
        'Primos y FizzBuzz',
        `
**¿Es primo?** Un número es primo si solo se divide entre 1 y él mismo. Se prueba con un bucle interno que busca algún divisor (y el \`for ... else\` de la lección anterior es perfecto):

\`\`\`
for n in range(2, 20):
    for d in range(2, n):
        if n % d == 0:
            break
    else:
        print(n)          # nadie lo dividió: es primo
\`\`\`

**FizzBuzz**, la famosa pregunta de entrevistas: del 1 al N, mostrar *Fizz* si es múltiplo de 3, *Buzz* si lo es de 5, *FizzBuzz* si de ambos, y el número en otro caso. La trampa: comprobar primero el caso doble (15) o nunca se alcanzará.
`,
      ),
      pyDemo('Primos hasta 20', [['for n in range(2, 20):\n    for d in range(2, n):\n        if n % d == 0:\n            break\n    else:\n        print(n, end=" ")\nprint()']]),
      mc('¿Cuántas líneas imprime este código?', ['5', '6', '3', '2'], 1, 'Por cada una de las 3 vueltas del bucle externo, el interno da 2: 3 × 2 = 6 llamadas a `print`.', 'for a in range(3):\n    for b in range(2):\n        print(a, b)'),
      tf('En un bucle anidado, el `break` del bucle interno también detiene el bucle externo.', false, '`break` solo interrumpe el bucle más cercano (el interno). El externo continúa con su siguiente vuelta.'),
      pyPractice({
        goal: 'Triángulo de asteriscos',
        prompt: 'Muestra este triángulo (4 filas) con un bucle:\n\n```\n*\n**\n***\n****\n```',
        starter: '',
        check: all(stdout('*\n**\n***\n****'), uses('For')),
        solution: 'for i in range(1, 5):\n    print("*" * i)',
        hints: ['La fila `i` tiene `i` asteriscos.', '`print("*" * i)`'],
        explain: 'Multiplicar un texto lo repite: `"*" * 3` es `"***"`. Un bucle de una dimensión basta aquí.',
        commands: ['for', 'range'],
      }),
      pyPractice({
        goal: 'Tabla 4 × 4',
        prompt: 'Muestra la tabla de multiplicar de 1 a 4. Cada número ocupa **4 espacios** alineado a la derecha y cada fila va en una línea:\n\n```\n   1   2   3   4\n   2   4   6   8\n   3   6   9  12\n   4   8  12  16\n```\nPista: construye cada fila en un texto con `+=` y muéstrala al terminar la fila.',
        starter: '',
        check: all(stdout('   1   2   3   4\n   2   4   6   8\n   3   6   9  12\n   4   8  12  16'), uses('For', 2)),
        solution: 'for fila in range(1, 5):\n    texto = ""\n    for col in range(1, 5):\n        texto += f"{fila * col:4}"\n    print(texto)',
        hints: ['El bucle interno va añadiendo celdas a un texto vacío.', 'Formato de ancho 4: `f"{valor:4}"`. Muestra el texto al acabar el bucle interno.'],
        explain: 'El texto `texto` se reinicia en cada fila (`texto = ""` dentro del externo) y el `print` va fuera del bucle interno: justo una vez por fila.',
        commands: ['for', 'range', 'f-strings'],
      }),
      pyPractice({
        goal: 'Primos hasta 30',
        prompt: 'Muestra los números primos menores que 30, uno por línea (empezando por 2).',
        starter: '',
        check: all(stdout('2\n3\n5\n7\n11\n13\n17\n19\n23\n29'), uses('For', 2)),
        solution: 'for n in range(2, 30):\n    for d in range(2, n):\n        if n % d == 0:\n            break\n    else:\n        print(n)',
        hints: ['Para cada `n`, busca un divisor entre 2 y n-1.', 'Si lo encuentras: `break`. El `else` del bucle interno detecta que no hubo divisor.'],
        explain: 'El `else` del bucle interno solo se ejecuta si nadie rompió el bucle, es decir, si no hay divisores: ¡es primo!',
        commands: ['for', 'else'],
      }),
    ]),
  ],
  boss: {
    goal: 'Adivina con pistas',
    prompt:
      'El número secreto es **42**. Pide números con `input()` y, tras cada intento, muestra **Muy alto** si se pasó o **Muy bajo** si se quedó corto. Al acertar muestra **¡Correcto en N intentos!** y termina.\n\nEn esta prueba el usuario escribe 50, 30 y 42.',
    setup: { stdin: ['50', '30', '42'] },
    starter: 'secreto = 42\nintentos = 0\n',
    check: all(outHas('Muy alto', 'Muy bajo', '¡Correcto en 3 intentos!'), uses('While'), uses('If', 2)),
    solution:
      'secreto = 42\nintentos = 0\nwhile True:\n    n = int(input("Tu número: "))\n    intentos += 1\n    if n > secreto:\n        print("Muy alto")\n    elif n < secreto:\n        print("Muy bajo")\n    else:\n        print(f"¡Correcto en {intentos} intentos!")\n        break',
    hints: ['Un `while True` con un `break` al acertar.', 'Dentro, un `if / elif / else` con tres casos: mayor, menor e igual.'],
    explain: 'Reúne lo aprendido: bucle con centinela (`break`), un contador, entrada del usuario y una cadena de decisiones. ¡Ya puedes escribir juegos sencillos!',
    commands: ['while', 'break', 'if'],
  },
});

