import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, iaWorld } from './iabuild';
import { all, calls, stdout, truthy, variable } from './iabuild';

export const ia2 = iaWorld({
  id: 'ia2',
  index: 2,
  title: 'Matemáticas con NumPy',
  subtitle: 'Vectores, matrices, estadística y gradientes',
  emoji: '🔢',
  color: '#22D3EE',
  level: 'basico',
  intro:
    'Detrás de cada modelo de IA hay álgebra, estadística y un poco de cálculo. La buena noticia: **NumPy** te deja usarlas sin escribir bucles. Aquí aprenderás los arrays, la «vectorización», los vectores y matrices que alimentan las redes neuronales, la estadística para describir datos y la idea de **gradiente** que hace posible entrenar cualquier modelo.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia2-1', { title: 'Arrays: matemáticas sin bucles', summary: 'Crear arrays y operar con todos sus elementos a la vez', emoji: '📦', commands: ['np.array', 'np.arange', 'np.linspace', 'ndarray.reshape', 'np.zeros'], minutes: 11 }, [
      learn(
        'Por qué NumPy',
        `
Las listas de Python son flexibles pero lentas para números: cada elemento es un objeto independiente. **NumPy** guarda los números **juntos y del mismo tipo** en un **array** (\`ndarray\`), y hace las operaciones en bloque, a velocidad de lenguaje compilado.

Lo más importante es la **vectorización**: una operación se aplica a **todos los elementos a la vez**, sin escribir un \`for\`. El código queda más corto, más claro y entre 10 y 100 veces más rápido. Todo el ecosistema de IA (pandas, scikit-learn, PyTorch) está construido sobre esta idea.
`,
        '📦',
      ),
      pyDemo(
        'Listas contra arrays',
        [
          ['lista = [1, 2, 3]\nprint(lista * 2)\nprint(lista + [4, 5, 6])', 'En una lista, `*` repite y `+` concatena'],
          ['import numpy as np\na = np.array([1, 2, 3])\nprint(a * 2)\nprint(a + np.array([4, 5, 6]))', 'En un array, las operaciones son **aritmética elemento a elemento**'],
          ['print(a ** 2)\nprint(np.sqrt(a))\nprint(a.shape, a.dtype, a.ndim)', 'Funciones matemáticas aplicadas a todo el array. `shape`, `dtype` y `ndim` describen su forma, tipo y dimensiones'],
        ],
      ),
      mc('Si `a = np.array([1, 2, 3])`, ¿qué vale `a * 2`?', ['[1, 2, 3, 1, 2, 3]', '[2, 4, 6]', '[1, 2, 3, 2]', 'Da un error'], 1, 'En NumPy `*` multiplica elemento a elemento: `[2 4 6]`. La repetición `[1,2,3,1,2,3]` es el comportamiento de las listas de Python.'),
      learn(
        'Crear arrays',
        `
Además de convertir listas con \`np.array\`, hay constructores muy usados:

- \`np.zeros((2, 3))\` y \`np.ones((2, 3))\`: matrices llenas de 0 o de 1 (la tupla es la **forma**).
- \`np.arange(inicio, fin, paso)\`: como \`range\`, pero con decimales y devuelve un array.
- \`np.linspace(a, b, n)\`: **n** puntos equiespaciados de a a b, **incluyendo** b.
- \`np.eye(n)\`: la matriz identidad.
- \`np.full(forma, valor)\`: llena con un valor.
`,
        '🏗️',
      ),
      pyDemo(
        'Constructores',
        [
          ['import numpy as np\nprint(np.zeros((2, 3)))\nprint(np.ones(4))', 'Matriz de ceros 2×3 y vector de cuatro unos'],
          ['print(np.arange(0, 1, 0.25))\nprint(np.linspace(0, 1, 5))', '`arange` usa un **paso**, `linspace` un **número de puntos** (y llega hasta el final)'],
          ['print(np.eye(3))\nprint(np.full((2, 2), 7))', 'Identidad 3×3 y matriz llena de sietes'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\nprint(np.arange(0, 1, 0.25))', ['[0.  0.25 0.5  0.75 1.  ]', '[0.25 0.5  0.75 1.  ]', '[0.25 0.5  0.75]'], '`arange(0, 1, 0.25)` empieza en 0 y avanza de 0.25 en 0.25 **sin llegar** a 1: `[0.   0.25 0.5  0.75]`.'),
      learn(
        'Forma y reshape',
        `
Todo array tiene una **forma** (\`shape\`): una tupla con el tamaño de cada dimensión. Un vector de 6 números tiene forma \`(6,)\`; una matriz de 2 filas y 3 columnas, \`(2, 3)\`.

\`a.reshape(filas, columnas)\` reorganiza los **mismos datos** con otra forma (el producto de las dimensiones debe coincidir). Con **−1** NumPy calcula esa dimensión por ti: \`a.reshape(-1, 2)\` → «las filas que hagan falta, 2 columnas».

En ML, ajustar formas es el pan de cada día: casi todos los errores de principiantes son *«shapes not aligned»*.
`,
        '📐',
      ),
      pyDemo(
        'Cambiar la forma',
        [
          ['import numpy as np\na = np.arange(12)\nprint(a.shape)\nm = a.reshape(3, 4)\nprint(m)\nprint(m.shape)', '12 elementos reorganizados en 3 filas × 4 columnas'],
          ['print(a.reshape(2, -1).shape)\nprint(m.T.shape)', 'Con −1 NumPy deduce la dimensión (6). `.T` es la traspuesta: filas ↔ columnas'],
          pyErr('a.reshape(5, 3)', 'No se puede: 5×3 = 15 ≠ 12 elementos. El error dice exactamente eso'),
        ],
      ),
      fill('Completa el código para obtener 5 puntos equiespaciados entre 0 y 10.', 'np.___(0, 10, 5)', ['linspace', 'arange', 'zeros', 'reshape'], ['linspace'], '`linspace(inicio, fin, n)` genera **n** puntos incluyendo el final: `[0, 2.5, 5, 7.5, 10]`.'),
      pyPractice({
        goal: 'De Celsius a Fahrenheit',
        prompt: 'Con el array `celsius`, calcula en `fahrenheit` la temperatura en °F usando la fórmula `C × 9/5 + 32` sobre todo el array **sin bucles**.',
        starter: 'import numpy as np\n\ncelsius = np.array([0.0, 20.0, 37.0, 100.0])\n\nfahrenheit = None\n',
        check: variable('fahrenheit.tolist()', '[32.0, 68.0, 98.6, 212.0]'),
        solution: 'import numpy as np\n\ncelsius = np.array([0.0, 20.0, 37.0, 100.0])\n\nfahrenheit = celsius * 9 / 5 + 32',
        hints: ['Puedes multiplicar, dividir y sumar arrays y números como si fueran un solo valor.', '`celsius * 9 / 5 + 32`.'],
        explain: 'La fórmula se aplica a **cada elemento** a la vez. A esto se le llama vectorización: el bucle ocurre dentro de NumPy, mucho más rápido.',
        commands: ['np.array'],
      }),
      pyPractice({
        goal: 'La tabla del 7',
        prompt: 'Crea en `tabla` un array con la tabla del 7 hasta el 10: `[7, 14, ..., 70]`. Usa `np.arange`.',
        starter: 'import numpy as np\n\ntabla = None\n',
        check: variable('tabla.tolist()', '[7, 14, 21, 28, 35, 42, 49, 56, 63, 70]'),
        solution: 'import numpy as np\n\ntabla = np.arange(1, 11) * 7',
        hints: ['`np.arange(1, 11)` da 1, 2, …, 10.', 'Multiplica ese array por 7.'],
        explain: '`np.arange(1, 11)` genera 1..10 (el final no se incluye) y `* 7` multiplica todos a la vez.',
        commands: ['np.arange'],
      }),
      pyPractice({
        goal: 'Dale forma',
        prompt: 'Crea en `m` una matriz con los números del 0 al 11 de forma `(3, 4)`. Después guarda en `fila_final` su última fila.',
        starter: 'import numpy as np\n\nm = None\nfila_final = None\n',
        check: all(variable('m.shape', '(3, 4)'), variable('fila_final.tolist()', '[8, 9, 10, 11]')),
        solution: 'import numpy as np\n\nm = np.arange(12).reshape(3, 4)\nfila_final = m[-1]',
        hints: ['`np.arange(12)` da los 12 números; luego `.reshape(3, 4)`.', 'La última fila es `m[-1]`.'],
        explain: 'Con `reshape` reorganizas los mismos datos; con `m[-1]` seleccionas la última fila, igual que en una lista.',
        commands: ['ndarray.reshape'],
      }),
      pyPractice({
        goal: 'Normaliza entre 0 y 1',
        prompt: 'Reescala `x` al rango [0, 1] con la **normalización mínimo-máximo**: `(x − mín) / (máx − mín)`. Guarda el resultado en `x01`.',
        starter: 'import numpy as np\n\nx = np.array([10.0, 20.0, 30.0, 50.0])\n\nx01 = None\n',
        check: variable('x01.tolist()', '[0.0, 0.25, 0.5, 1.0]'),
        solution: 'import numpy as np\n\nx = np.array([10.0, 20.0, 30.0, 50.0])\n\nx01 = (x - x.min()) / (x.max() - x.min())',
        hints: ['`x.min()` y `x.max()` te dan los extremos.', '`(x - x.min()) / (x.max() - x.min())`.'],
        explain: 'Escalar a [0, 1] es un paso típico antes de entrenar. Ojo: un solo valor atípico estira el rango y comprime al resto.',
        commands: ['np.array'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia2-2', { title: 'Índices, máscaras y broadcasting', summary: 'Seleccionar datos y combinar arrays de distinta forma', emoji: '🎭', commands: ['np.where', 'broadcasting', 'ndarray.mean'], minutes: 12 }, [
      learn(
        'Cortes en varias dimensiones',
        `
Los arrays se indexan como las listas, pero con **una posición por dimensión**, separadas por comas: \`m[fila, columna]\`.

- \`m[1, 2]\`: un elemento.
- \`m[1]\`: toda la fila 1.
- \`m[:, 0]\`: **toda** la columna 0 (los dos puntos significan «todo»).
- \`m[0:2, 1:3]\`: un bloque (filas 0 y 1, columnas 1 y 2).
- \`m[::2]\`: una de cada dos filas.
`,
        '✂️',
      ),
      pyDemo(
        'Cortar una matriz',
        [
          ['import numpy as np\nm = np.arange(12).reshape(3, 4)\nprint(m)', 'Una matriz 3×4 para jugar'],
          ['print(m[1, 2])\nprint(m[:, 0])\nprint(m[0:2, 1:3])', 'Un elemento, una columna y un bloque'],
          ['sub = m[:, :2]\nsub[0, 0] = 99\nprint(m[0])', 'Atención: un corte es una **vista** de los mismos datos; al cambiarla, cambia el original'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\nm = np.arange(12).reshape(3, 4)\nprint(m[1:, ::2])', ['[[ 4  5]\n [ 8  9]]', '[[ 5  7]\n [ 9 11]]', '[[ 0  2]\n [ 4  6]]'], '`1:` selecciona las filas 1 y 2; `::2` toma una columna de cada dos (0 y 2). Quedan los valores 4, 6 / 8, 10.'),
      learn(
        'Máscaras: filtrar con condiciones',
        `
Una comparación sobre un array produce otro array de **booleanos**: una **máscara**. Si indexas con ella, te quedas con los elementos donde es \`True\`:

\`\`\`
x[x > 3]               # los mayores que 3
x[(x > 1) & (x < 5)]   # y con & · o con | · no con ~
\`\`\`

Se usan **\`&\`, \`|\` y \`~\`** (no \`and\`, \`or\`, \`not\`) y **paréntesis** en cada condición. Además, \`np.where(cond, a, b)\` elige entre \`a\` y \`b\` según la condición, elemento a elemento. Y como \`True\` vale 1, \`(x > 3).sum()\` cuenta cuántos cumplen.
`,
        '🎭',
      ),
      pyDemo(
        'Filtrar y reemplazar',
        [
          ['import numpy as np\nx = np.array([4, -2, 7, 0, -5, 3])\nmascara = x > 0\nprint(mascara)\nprint(x[mascara])', 'La máscara y los elementos que la cumplen'],
          ['print(((x > 0) & (x < 5)).sum())\nprint(np.where(x > 0, x, 0))', 'Cuántos están entre 0 y 5, y un «reemplazar negativos por 0»'],
        ],
      ),
      tf('`x[x > 1 and x < 5]` es la forma correcta de filtrar con dos condiciones en NumPy.', false, 'Con arrays hay que usar `&` (y), `|` (o) y poner cada condición entre paréntesis: `x[(x > 1) & (x < 5)]`. `and` provoca un error de ambigüedad.'),
      learn(
        'Broadcasting: arrays de distinta forma',
        `
¿Qué pasa si sumas un array \`(3, 4)\` y un vector \`(4,)\`? NumPy **«estira»** el pequeño para que encaje, sin copiarlo. Es el **broadcasting** y sigue dos reglas, comparando las formas **de derecha a izquierda**:

1. Dos dimensiones son compatibles si son **iguales** o una de ellas es **1** (o no existe).
2. La dimensión de tamaño 1 se repite para igualar a la otra.

Gracias a esto, \`X - X.mean(axis=0)\` resta a cada columna su media con una sola línea.
`,
        '📡',
      ),
      illus('ia-broadcast', 'Broadcasting', 'Elige dos formas y mira cómo NumPy las alinea de derecha a izquierda, o por qué fallan.'),
      pyDemo(
        'Broadcasting en acción',
        [
          ['import numpy as np\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 30.0]])\nmedias = X.mean(axis=0)\nprint(medias)\nprint(X - medias)', 'Restar a cada columna su media: la forma `(3, 2)` y `(2,)` encajan'],
          ['col = np.array([[1], [2], [3]])\nfila = np.array([10, 20])\nprint(col + fila)', 'Un vector columna `(3, 1)` más una fila `(2,)` produce una tabla `(3, 2)`'],
          pyErr('np.ones((3, 2)) + np.ones(3)', 'Formas `(3, 2)` y `(3,)`: comparando desde la derecha, 2 ≠ 3. No encajan'),
        ],
      ),
      mc('¿Qué forma tiene el resultado de sumar arrays de formas `(5, 1)` y `(1, 4)`?', ['(5, 4)', '(5, 1)', '(1, 4)', 'No se pueden sumar'], 0, 'Cada dimensión 1 se estira para igualar a la otra: 5 con 1 → 5, y 1 con 4 → 4. El resultado es una tabla de 5 filas y 4 columnas.'),
      pyPractice({
        goal: 'Quita los atípicos',
        prompt: 'En `x` hay valores raros. Guarda en `normales` solo los que están a **menos de 2 desviaciones típicas** de la media: `|x − media| < 2·std`.',
        starter: 'import numpy as np\n\nx = np.array([10.0, 11.0, 9.0, 10.5, 9.5, 10.2, 9.8, 100.0])\n\nnormales = None\n',
        check: variable('normales.tolist()', '[10.0, 11.0, 9.0, 10.5, 9.5, 10.2, 9.8]'),
        solution: 'import numpy as np\n\nx = np.array([10.0, 11.0, 9.0, 10.5, 9.5, 10.2, 9.8, 100.0])\n\nnormales = x[np.abs(x - x.mean()) < 2 * x.std()]',
        hints: ['Construye la máscara con `np.abs(x - x.mean()) < 2 * x.std()`.', 'Indexa `x` con esa máscara.'],
        explain: 'Una máscara booleana selecciona directamente los valores que cumplen una condición. Es el filtro más usado al limpiar datos.',
        commands: ['ndarray.mean'],
      }),
      pyPractice({
        goal: 'Tu primera ReLU',
        prompt: 'La función **ReLU** de las redes neuronales deja pasar los positivos y convierte los negativos en 0. Calcúlala sobre `z` y guarda el resultado en `relu` usando `np.where`.',
        starter: 'import numpy as np\n\nz = np.array([-3.0, -0.5, 0.0, 2.0, 5.5])\n\nrelu = None\n',
        check: variable('relu.tolist()', '[0.0, 0.0, 0.0, 2.0, 5.5]'),
        solution: 'import numpy as np\n\nz = np.array([-3.0, -0.5, 0.0, 2.0, 5.5])\n\nrelu = np.where(z > 0, z, 0)',
        hints: ['`np.where(condición, si_verdadero, si_falso)`.', '`np.where(z > 0, z, 0)`.'],
        explain: 'ReLU(z) = max(0, z) es la activación más común en deep learning. `np.where` aplica la elección elemento a elemento.',
        commands: ['np.where'],
      }),
      pyPractice({
        goal: 'Centra las columnas',
        prompt: 'Resta a cada columna de `X` su media y guarda el resultado en `Xc`. Usa broadcasting (nada de bucles).',
        starter: 'import numpy as np\n\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 60.0]])\n\nXc = None\n',
        check: variable('Xc.tolist()', '[[-1.0, -20.0], [0.0, -10.0], [1.0, 30.0]]'),
        solution: 'import numpy as np\n\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 60.0]])\n\nXc = X - X.mean(axis=0)',
        hints: ['`axis=0` calcula la media **por columnas** (colapsa las filas).', '`X - X.mean(axis=0)`: la forma `(3, 2)` y `(2,)` encajan por broadcasting.'],
        explain: '`axis=0` recorre las filas y deja un valor por columna. Centrar los datos (media 0) es el primer paso de muchas técnicas, como PCA.',
        commands: ['broadcasting', 'ndarray.mean'],
      }),
      pyPractice({
        goal: 'Estandariza',
        prompt: 'Estandariza cada columna de `X` (media 0, desviación típica 1): `(X − media) / std` por columnas. Guarda el resultado en `Z`. Después imprime su forma con `print(Z.shape)`.',
        starter: 'import numpy as np\n\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 60.0], [6.0, 30.0]])\n\nZ = None\n',
        check: all(truthy('abs(Z.mean(axis=0)).max() < 1e-9'), truthy('abs(Z.std(axis=0) - 1).max() < 1e-9'), stdout('(4, 2)')),
        solution: 'import numpy as np\n\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 60.0], [6.0, 30.0]])\n\nZ = (X - X.mean(axis=0)) / X.std(axis=0)\nprint(Z.shape)',
        hints: ['Necesitas la media y la desviación **por columnas**: `axis=0`.', '`Z = (X - X.mean(axis=0)) / X.std(axis=0)`.'],
        explain: 'La **estandarización** pone todas las características en la misma escala. Los algoritmos basados en distancias o gradientes la agradecen mucho.',
        commands: ['broadcasting'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia2-3', { title: 'Vectores y matrices', summary: 'Producto escalar, normas, similitud coseno y producto de matrices', emoji: '🧭', commands: ['np.dot', 'np.linalg.norm', 'similitud coseno', 'np.linalg.solve'], minutes: 12 }, [
      learn(
        'Un vector es una lista de números con significado',
        `
En IA casi todo es un **vector**: una casa son 3 números, una palabra son 300, una foto son miles. Geométricamente, un vector es una **flecha** con dirección y longitud, y operar con ellos responde preguntas útiles:

- **Longitud (norma)**: \`np.linalg.norm(v)\`.
- **Distancia** entre dos puntos: la norma de su diferencia.
- **Producto escalar** \`a · b\`: suma de productos elemento a elemento. Es grande si apuntan en la misma dirección, 0 si son perpendiculares y negativo si se oponen.
- **Similitud coseno**: el producto escalar dividido por las dos normas. Vale **1** (misma dirección), **0** (perpendiculares) o **−1** (opuestos), sin importar la longitud. Es la medida estrella de los **embeddings**.
`,
        '🧭',
      ),
      illus('ia-vectors', 'Vectores en el plano', 'Cambia el ángulo y la longitud de B y mira cómo reaccionan el producto escalar y el coseno.'),
      pyDemo(
        'Producto escalar, norma y coseno',
        [
          ['import numpy as np\na = np.array([3.0, 4.0])\nb = np.array([4.0, 3.0])\nprint(np.dot(a, b))\nprint(np.linalg.norm(a))', '`a·b = 3·4 + 4·3 = 24` y la norma de `a` es 5 (el famoso 3-4-5)'],
          ['cos = a @ b / (np.linalg.norm(a) * np.linalg.norm(b))\nprint(round(float(cos), 4))', '0.96: casi la misma dirección'],
          ['print(round(float(np.linalg.norm(a - b)), 4))', 'La **distancia euclídea** entre los dos puntos'],
        ],
      ),
      mc('Dos vectores tienen similitud coseno −1. ¿Qué significa?', ['Son perpendiculares', 'Apuntan en la misma dirección', 'Apuntan en sentidos opuestos', 'Tienen la misma longitud'], 2, 'Coseno 1 = misma dirección, 0 = perpendiculares, −1 = sentidos opuestos. No depende de las longitudes.'),
      tf('La similitud coseno entre `[1, 2]` y `[10, 20]` es 1 aunque tengan longitudes muy distintas.', true, 'El coseno solo mira la dirección: los dos vectores apuntan exactamente igual, así que vale 1. Por eso se usa para comparar textos de distinta longitud.'),
      learn(
        'Matrices y el operador @',
        `
Una **matriz** es una tabla de números. La operación clave es el **producto de matrices**, que se escribe \`A @ B\` y cumple una regla de formas:

> \`(n, k) @ (k, m) → (n, m)\` — las dimensiones interiores deben coincidir.

Es lo que hace cada **capa** de una red neuronal: una matriz de datos \`X\` (ejemplos × características) se multiplica por una matriz de **pesos** \`W\` (características × neuronas) y se suma un sesgo \`b\`:

\`\`\`
salida = X @ W + b
\`\`\`
`,
        '🧮',
      ),
      pyDemo(
        'Una capa lineal',
        [
          ['import numpy as np\nX = np.array([[1.0, 2.0, 3.0],\n              [4.0, 5.0, 6.0]])   # 2 ejemplos, 3 características\nW = np.array([[0.1, 0.2],\n              [0.3, 0.4],\n              [0.5, 0.6]])        # 3 → 2 neuronas\nb = np.array([0.5, -0.5])', 'Datos, pesos y sesgo'],
          ['salida = X @ W + b\nprint(salida)\nprint(salida.shape)', '`(2,3) @ (3,2) → (2,2)`, y el sesgo `(2,)` se suma por broadcasting'],
          pyErr('X @ X', 'Formas `(2,3) @ (2,3)`: las dimensiones interiores (3 y 2) no coinciden'),
        ],
      ),
      pyOut('¿Qué forma tiene `A @ B` si `A` es `(4, 3)` y `B` es `(3, 5)`?', 'import numpy as np\nA = np.ones((4, 3))\nB = np.ones((3, 5))\nprint((A @ B).shape)', ['(3, 3)', '(4, 3)', '(3, 5)'], 'Las dimensiones interiores (3 y 3) desaparecen; quedan las exteriores: `(4, 5)`.'),
      learn(
        'Resolver sistemas de ecuaciones',
        `
\`np.linalg.solve(A, b)\` resuelve \`A·x = b\` (mucho mejor que calcular la inversa). Es el corazón de la **regresión lineal** con fórmula cerrada, que verás en la zona 4: buscar los pesos que mejor ajustan los datos se reduce a resolver un sistema.
`,
        '🧩',
      ),
      pyPractice({
        goal: 'Similitud coseno',
        prompt: 'Escribe `coseno(a, b)` que devuelva la similitud coseno de dos vectores (`a·b / (‖a‖·‖b‖)`).',
        starter: 'import numpy as np\n\ndef coseno(a, b):\n    pass\n',
        check: calls([
          ['round(float(coseno(np.array([1.0, 0.0]), np.array([0.0, 1.0]))), 6)', '0.0'],
          ['round(float(coseno(np.array([1.0, 2.0]), np.array([2.0, 4.0]))), 6)', '1.0'],
          ['round(float(coseno(np.array([1.0, 0.0]), np.array([-3.0, 0.0]))), 6)', '-1.0'],
        ]),
        solution: 'import numpy as np\n\ndef coseno(a, b):\n    return a @ b / (np.linalg.norm(a) * np.linalg.norm(b))',
        hints: ['El producto escalar es `a @ b` (o `np.dot(a, b)`).', 'Divide entre `np.linalg.norm(a) * np.linalg.norm(b)`.'],
        explain: 'La similitud coseno ignora la longitud y solo mira la dirección: la base de la búsqueda semántica con embeddings.',
        commands: ['similitud coseno', 'np.dot', 'np.linalg.norm'],
      }),
      pyPractice({
        goal: 'El vecino más cercano',
        prompt: 'Dado un `punto` y una matriz `puntos` (una fila por punto), guarda en `cercano` el **índice** de la fila más cercana al `punto` (distancia euclídea).',
        starter: 'import numpy as np\n\npuntos = np.array([[0.0, 0.0], [5.0, 5.0], [2.0, 1.0], [9.0, 0.0]])\npunto = np.array([2.5, 2.0])\n\ncercano = None\n',
        check: variable('int(cercano)', '2'),
        solution: 'import numpy as np\n\npuntos = np.array([[0.0, 0.0], [5.0, 5.0], [2.0, 1.0], [9.0, 0.0]])\npunto = np.array([2.5, 2.0])\n\ncercano = np.linalg.norm(puntos - punto, axis=1).argmin()',
        hints: ['`puntos - punto` resta el punto a cada fila (broadcasting).', '`np.linalg.norm(..., axis=1)` da una distancia por fila; `.argmin()` el índice de la menor.'],
        explain: 'Es la idea de **k-NN** y de la búsqueda de vecinos en bases de datos vectoriales: calcular distancias a todos y quedarse con el más cercano.',
        commands: ['np.linalg.norm'],
      }),
      pyPractice({
        goal: 'Una capa de red',
        prompt: 'Calcula en `salida` la salida de una capa lineal `X @ W + b` y después imprime su forma (`salida.shape`).',
        starter: 'import numpy as np\n\nX = np.ones((5, 4))\nW = np.ones((4, 3))\nb = np.zeros(3)\n\nsalida = None\n',
        check: all(variable('salida.shape', '(5, 3)'), variable('salida[0].tolist()', '[4.0, 4.0, 4.0]'), stdout('(5, 3)')),
        solution: 'import numpy as np\n\nX = np.ones((5, 4))\nW = np.ones((4, 3))\nb = np.zeros(3)\n\nsalida = X @ W + b\nprint(salida.shape)',
        hints: ['`@` es el producto de matrices.', '`salida = X @ W + b` y luego `print(salida.shape)`.'],
        explain: 'Cada capa densa de una red neuronal hace exactamente esto. Con 5 ejemplos de 4 características y 3 neuronas obtienes una matriz 5×3.',
        commands: ['np.dot'],
      }),
      pyPractice({
        goal: 'Resuelve el sistema',
        prompt: 'Resuelve `2x + y = 5` y `x + 3y = 10` con `np.linalg.solve` y guarda la solución en `sol` (un array `[x, y]`).',
        starter: 'import numpy as np\n\nA = np.array([[2.0, 1.0], [1.0, 3.0]])\nb = np.array([5.0, 10.0])\n\nsol = None\n',
        check: truthy('abs(sol - np.array([1.0, 3.0])).max() < 1e-9'),
        solution: 'import numpy as np\n\nA = np.array([[2.0, 1.0], [1.0, 3.0]])\nb = np.array([5.0, 10.0])\n\nsol = np.linalg.solve(A, b)',
        hints: ['`np.linalg.solve(A, b)` resuelve `A @ x = b`.', 'Pásale la matriz de coeficientes y el vector de resultados.'],
        explain: 'Resolver sistemas lineales es la herramienta de fondo de la regresión lineal por mínimos cuadrados (la «ecuación normal»).',
        commands: ['np.linalg.solve'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia2-4', { title: 'Estadística y probabilidad', summary: 'Describir datos, correlación, muestreo y regla de Bayes', emoji: '🎲', commands: ['ndarray.mean', 'np.percentile', 'np.corrcoef', 'np.random.default_rng'], minutes: 12 }, [
      learn(
        'Resumir datos con números',
        `
Antes de entrenar nada hay que **mirar los datos**. Las medidas básicas:

- **Media** (\`mean\`): el promedio. Muy sensible a valores extremos.
- **Mediana** (\`median\`): el valor del medio. Resistente a extremos.
- **Desviación típica** (\`std\`): cuánto se alejan los datos, de media, de la media. **Varianza** = std².
- **Percentiles** (\`np.percentile\`): el valor por debajo del cual queda cierto % de los datos. El P50 es la mediana; P25 y P75 delimitan la «caja» de un diagrama de cajas.

Con \`axis=0\` (por columnas) o \`axis=1\` (por filas) puedes aplicarlas a tablas completas.
`,
        '📊',
      ),
      pyDemo(
        'Un sueldo extremo',
        [
          ['import numpy as np\nsueldos = np.array([1200, 1350, 1400, 1500, 1600, 1750, 9000])\nprint(sueldos.mean())\nprint(np.median(sueldos))', 'Un solo sueldo de 9000 arrastra la media a 2543, pero la mediana sigue en 1500'],
          ['print(round(float(sueldos.std()), 1))\nprint(np.percentile(sueldos, [25, 50, 75]))', 'La desviación típica se dispara, y los percentiles 25/50/75 describen el grueso de los datos'],
        ],
      ),
      mc('Los datos tienen valores atípicos muy grandes. ¿Qué medida de «centro» es más fiable?', ['La media', 'La mediana', 'La varianza', 'El máximo'], 1, 'La mediana solo depende del orden: un valor extremo no la mueve. La media sí se desplaza hacia él.'),
      multi('¿Cuáles de estas medidas se ven muy afectadas por un valor extremo?', ['La media', 'La mediana', 'La desviación típica', 'El percentil 50'], [0, 2], 'La media y la desviación típica usan todos los valores y se desplazan hacia el extremo. La mediana y el percentil 50 solo dependen del orden.'),
      learn(
        'Correlación',
        `
La **correlación** de Pearson mide, entre −1 y 1, cuánto se mueven dos variables **juntas en línea recta**: +1 suben y bajan a la vez, −1 una sube cuando la otra baja, 0 no hay relación lineal.

\`np.corrcoef(x, y)\` devuelve una matriz 2×2; el valor que buscas está en \`[0, 1]\`.

> Correlación **no** es causalidad: las ventas de helados y los ahogamientos en la playa se correlacionan… porque ambos suben en verano.
`,
        '🔗',
      ),
      pyDemo(
        'Medir relaciones',
        [
          ['import numpy as np\nhoras = np.array([1, 2, 3, 4, 5, 6])\nnota = np.array([3.1, 4.2, 5.8, 6.1, 7.9, 8.8])\nruido = np.array([7, 2, 9, 4, 8, 3])', 'Tres variables'],
          ['print(round(float(np.corrcoef(horas, nota)[0, 1]), 3))\nprint(round(float(np.corrcoef(horas, ruido)[0, 1]), 3))', 'Estudiar y la nota están casi perfectamente correlacionadas (≈ 0.99); con el ruido casi no hay relación'],
        ],
      ),
      tf('Si dos variables tienen correlación 0.95, una causa a la otra.', false, 'La correlación solo mide que se mueven juntas. Puede haber una tercera causa común (el verano) o ser casualidad: causalidad requiere experimentos o argumentos adicionales.'),
      learn(
        'Aleatoriedad con semilla',
        `
Muchos algoritmos (inicializar pesos, barajar datos, muestrear) necesitan números **aleatorios**. En el ordenador son **pseudoaleatorios**: salen de una fórmula a partir de una **semilla**. Con la misma semilla obtienes siempre la misma secuencia, lo que hace los experimentos **reproducibles**.

La forma moderna: \`rng = np.random.default_rng(42)\` y luego \`rng.normal(...)\`, \`rng.integers(...)\`, \`rng.random(...)\`, \`rng.choice(...)\`.
`,
        '🎲',
      ),
      pyDemo(
        'Muestras con semilla',
        [
          ['import numpy as np\nrng = np.random.default_rng(42)\nprint(rng.integers(1, 7, size=8))', 'Ocho tiradas de un dado. Con la misma semilla saldrá siempre lo mismo'],
          ['x = np.random.default_rng(0).normal(loc=10, scale=2, size=100000)\nprint(round(float(x.mean()), 2), round(float(x.std()), 2))', 'Con muchas muestras, media y desviación se acercan a los parámetros reales (10 y 2): la **ley de los grandes números**'],
        ],
      ),
      illus('ia-montecarlo', 'Monte Carlo', 'Lanza dardos al azar sobre un cuadrado y estima π a partir de los que caen dentro del círculo.'),
      learn(
        'Probabilidad condicionada y regla de Bayes',
        `
\`P(A|B)\` es la probabilidad de A **sabiendo** que ha ocurrido B. La **regla de Bayes** invierte la condición:

\`\`\`
P(spam | palabra) = P(palabra | spam) · P(spam) / P(palabra)
\`\`\`

Es el fundamento del clasificador **Naive Bayes** y de buena parte del razonamiento bajo incertidumbre. Un ejemplo clásico: una prueba médica fiable al 99 % para una enfermedad rarísima da mayoritariamente **falsos positivos**, porque pocos pacientes están realmente enfermos.
`,
        '🔁',
      ),
      pyDemo(
        'Bayes con números',
        [
          ['p_spam = 0.2\np_gratis_si_spam = 0.6\np_gratis_si_ham = 0.05\np_gratis = p_gratis_si_spam * p_spam + p_gratis_si_ham * (1 - p_spam)\nprint(round(p_gratis, 3))', 'Probabilidad total de que un correo contenga «gratis»'],
          ['p_spam_si_gratis = p_gratis_si_spam * p_spam / p_gratis\nprint(round(p_spam_si_gratis, 3))', 'Si el correo dice «gratis», es spam con probabilidad 0.75 (antes era 0.2)'],
        ],
      ),
      pyPractice({
        goal: 'Puntuaciones z',
        prompt: 'Calcula en `z` la **puntuación z** de cada nota de `notas`: `(nota − media) / desviación típica`. Imprime también el índice (con `argmax`) de la nota más alta en términos de z.',
        starter: 'import numpy as np\n\nnotas = np.array([5.0, 6.0, 7.0, 8.0, 9.5])\n\nz = None\n',
        check: all(truthy('abs(z.mean()) < 1e-9 and abs(z.std() - 1) < 1e-9'), stdout('4')),
        solution: 'import numpy as np\n\nnotas = np.array([5.0, 6.0, 7.0, 8.0, 9.5])\n\nz = (notas - notas.mean()) / notas.std()\nprint(z.argmax())',
        hints: ['`(notas - notas.mean()) / notas.std()`.', '`print(z.argmax())` imprime el índice del mayor.'],
        explain: 'La puntuación z dice a cuántas desviaciones típicas está un dato de la media. Sirve para comparar medidas de escalas distintas y para detectar atípicos.',
        commands: ['ndarray.mean'],
      }),
      pyPractice({
        goal: '¿Hay relación?',
        prompt: 'Calcula en `r` la correlación de Pearson entre `x` e `y` con `np.corrcoef`, y en `fuerte` un booleano que sea `True` si `|r| > 0.8`.',
        starter: 'import numpy as np\n\nx = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])\ny = np.array([2.0, 4.1, 5.9, 8.2, 9.8, 12.1])\n\nr = None\nfuerte = None\n',
        check: all(truthy('0.99 < r <= 1'), variable('bool(fuerte)', 'True')),
        solution: 'import numpy as np\n\nx = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])\ny = np.array([2.0, 4.1, 5.9, 8.2, 9.8, 12.1])\n\nr = np.corrcoef(x, y)[0, 1]\nfuerte = abs(r) > 0.8',
        hints: ['`np.corrcoef(x, y)` devuelve una matriz 2×2.', 'La correlación está en la posición `[0, 1]`.'],
        explain: 'Una |r| cercana a 1 indica una relación lineal fuerte, pero recuerda: correlación ≠ causalidad.',
        commands: ['np.corrcoef'],
      }),
      pyPractice({
        goal: 'Simula dos dados',
        prompt: 'Con `rng = np.random.default_rng(0)`, simula 10 000 tiradas de dos dados (`rng.integers(1, 7, size=(10000, 2))`) y guarda en `p` la **proporción** de tiradas cuya suma es 7. Debería acercarse a 1/6.',
        starter: 'import numpy as np\n\nrng = np.random.default_rng(0)\n\np = None\n',
        check: truthy('abs(p - 1/6) < 0.02'),
        solution: 'import numpy as np\n\nrng = np.random.default_rng(0)\n\ntiradas = rng.integers(1, 7, size=(10000, 2))\np = (tiradas.sum(axis=1) == 7).mean()',
        hints: ['Genera una matriz de 10 000 filas y 2 columnas con una tirada por fila.', 'Suma por filas con `.sum(axis=1)`, compara con 7 y calcula la media del resultado booleano.'],
        explain: 'Esta técnica —estimar probabilidades simulando— se llama **Monte Carlo**. La media de un array de booleanos es la proporción de `True`.',
        commands: ['np.random.default_rng'],
      }),
      pyPractice({
        goal: 'Aplica Bayes',
        prompt: 'Escribe `bayes(p_a, p_b_si_a, p_b_si_no_a)` que devuelva `P(A | B)`. Pista: `P(B) = P(B|A)·P(A) + P(B|¬A)·(1 − P(A))`.',
        starter: 'def bayes(p_a, p_b_si_a, p_b_si_no_a):\n    pass\n',
        check: calls([
          ['round(bayes(0.2, 0.6, 0.05), 4)', '0.75'],
          ['round(bayes(0.001, 0.99, 0.01), 4)', '0.0902'],
        ]),
        solution: 'def bayes(p_a, p_b_si_a, p_b_si_no_a):\n    p_b = p_b_si_a * p_a + p_b_si_no_a * (1 - p_a)\n    return p_b_si_a * p_a / p_b',
        hints: ['Primero calcula `P(B)` con la probabilidad total.', 'Devuelve `P(B|A) * P(A) / P(B)`.'],
        explain: 'El segundo caso es la paradoja de la prueba: con una enfermedad de 0.1 %, una prueba al 99 % que da positivo solo implica un 9 % de probabilidad de estar enfermo.',
        commands: ['np.random.default_rng'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia2-5', { title: 'Derivadas y gradiente', summary: 'La idea matemática que permite entrenar cualquier modelo', emoji: '⛰️', commands: ['derivada numérica', 'descenso del gradiente', 'tasa de aprendizaje'], minutes: 13 }, [
      learn(
        'La derivada: cuánto cambia algo',
        `
La **derivada** de una función en un punto es su **pendiente**: cuánto cambia la salida si mueves un poquito la entrada. Si \`f(x) = x²\`, en \`x = 3\` la pendiente es 6: subir un poco \`x\` sube \`f\` seis veces más.

No hace falta saber derivar a mano: se puede **aproximar numéricamente**:

\`\`\`
f'(x) ≈ (f(x + h) − f(x − h)) / (2h)     con h muy pequeño
\`\`\`

Si la derivada es **positiva**, la función sube hacia la derecha; si es **negativa**, baja; si es **cero**, estás en un mínimo, un máximo o una meseta.
`,
        '📈',
      ),
      pyDemo(
        'Derivar con código',
        [
          ['def f(x):\n    return x ** 2\n\ndef derivada(f, x, h=1e-5):\n    return (f(x + h) - f(x - h)) / (2 * h)', 'Una derivada numérica genérica'],
          ['print(round(derivada(f, 3), 4))\nprint(round(derivada(f, -2), 4))\nprint(round(derivada(f, 0), 4))', 'La pendiente de x² es 2x: 6 en 3, −4 en −2 y 0 en el mínimo'],
        ],
      ),
      learn(
        'Gradiente y descenso del gradiente',
        `
Si una función tiene **varias** variables, el **gradiente** es el vector con la derivada respecto a cada una: apunta hacia donde la función **crece más deprisa**. Para **minimizar** una pérdida, caminamos en dirección **contraria**.

El **descenso del gradiente** repite este paso:

\`\`\`
parámetro = parámetro − tasa_de_aprendizaje · gradiente
\`\`\`

- Con una **tasa de aprendizaje** pequeña avanzas con seguridad pero despacio.
- Con una **demasiado grande** das saltos que se pasan del mínimo, oscilas o **divergees**.

Es el motor de **todo** el aprendizaje profundo: entrenar una red de mil millones de parámetros es repetir este paso millones de veces.
`,
        '⛰️',
      ),
      illus('ia-gradient-descent', 'Descenso del gradiente', 'Elige la tasa de aprendizaje y el punto de partida; da pasos y mira si converge, zigzaguea o explota.'),
      pyDemo(
        'Bajar por una parábola',
        [
          ['x = 0.0\nlr = 0.1\nfor paso in range(6):\n    grad = 2 * (x - 3)      # derivada de (x-3)**2\n    x = x - lr * grad\n    print(paso, round(x, 3))', 'Minimizamos `(x − 3)²` empezando en 0: cada paso se acerca al mínimo en x = 3'],
          ['x = 0.0\nfor paso in range(5):\n    x = x - 1.1 * 2 * (x - 3)\nprint(round(x, 1))', 'Con una tasa de 1.1 los pasos se pasan de largo y **divergen**: x se aleja cada vez más'],
        ],
      ),
      mc('Entrenas un modelo y la pérdida **sube** en cada paso hasta dar `nan`. ¿Qué es lo primero que pruebas?', ['Aumentar la tasa de aprendizaje', 'Reducir la tasa de aprendizaje', 'Añadir más datos', 'Entrenar más épocas'], 1, 'Una pérdida que explota suele indicar pasos demasiado grandes. Reducir la tasa de aprendizaje (por ejemplo, a la décima parte) es lo primero que se prueba.'),
      order('Ordena un paso del descenso del gradiente:', ['predecir', 'medir', 'el', 'error', 'calcular', 'el', 'gradiente', 'actualizar', 'parámetros'], 'predecir medir el error calcular el gradiente actualizar parámetros', 'Cada paso: predicción con los parámetros actuales, error frente a las etiquetas, gradiente de ese error y movimiento de los parámetros en sentido contrario al gradiente.'),
      learn(
        'Entrenar una recta con gradiente',
        `
Ahora el caso real. Un modelo \`ŷ = w·x + b\` y una pérdida: el **error cuadrático medio** \`L = media((ŷ − y)²)\`. Sus derivadas son:

- \`∂L/∂w = media(2·(ŷ − y)·x)\`
- \`∂L/∂b = media(2·(ŷ − y))\`

Entrenar es repetir: calcular predicciones → calcular error → calcular gradientes → mover \`w\` y \`b\` un poco **en contra** del gradiente.
`,
        '🏋️',
      ),
      pyDemo(
        'Entrenar w y b',
        [
          ['import numpy as np\nx = np.array([1.0, 2.0, 3.0, 4.0, 5.0])\ny = 2 * x + 1            # la relación real: w = 2, b = 1\nw, b, lr = 0.0, 0.0, 0.05', 'Datos perfectos de la recta `y = 2x + 1`'],
          ['for epoca in range(500):\n    pred = w * x + b\n    err = pred - y\n    w -= lr * (2 * err * x).mean()\n    b -= lr * (2 * err).mean()\nprint(round(w, 3), round(b, 3))', 'Tras 500 pasos descubre `w ≈ 2` y `b ≈ 1`: ha **aprendido** la relación'],
        ],
      ),
      tf('Con una tasa de aprendizaje mayor el descenso del gradiente siempre converge más rápido.', false, 'Hasta cierto punto sí, pero si pasa de un umbral el algoritmo oscila o diverge. La tasa de aprendizaje es de los hiperparámetros más importantes.'),
      pyPractice({
        goal: 'Derivada numérica',
        prompt: 'Escribe `derivada(f, x, h=1e-5)` que aproxime la derivada de `f` en `x` con la **diferencia centrada** `(f(x+h) − f(x−h)) / (2h)`.',
        starter: 'def derivada(f, x, h=1e-5):\n    pass\n',
        check: calls([
          ['round(derivada(lambda x: x ** 2, 3), 4)', '6.0'],
          ['round(derivada(lambda x: x ** 3, 2), 3)', '12.0'],
          ['round(derivada(lambda x: 5 * x + 1, 10), 4)', '5.0'],
        ]),
        solution: 'def derivada(f, x, h=1e-5):\n    return (f(x + h) - f(x - h)) / (2 * h)',
        hints: ['Evalúa `f` en `x + h` y en `x - h`.', '`return (f(x + h) - f(x - h)) / (2 * h)`.'],
        explain: 'Esta aproximación es la base de la **comprobación de gradientes**: una forma de verificar que un gradiente calculado a mano es correcto.',
        commands: ['derivada numérica'],
      }),
      pyPractice({
        goal: 'Baja a mano',
        prompt: 'Minimiza `f(x) = (x − 5)² + 2` con descenso del gradiente: empieza en `x = 0`, usa `lr = 0.1` y da **50 pasos** (la derivada es `2·(x − 5)`). Guarda el resultado en `x`.',
        starter: 'x = 0.0\nlr = 0.1\n\n# 50 pasos de descenso del gradiente\n',
        check: truthy('abs(x - 5) < 1e-3'),
        solution: 'x = 0.0\nlr = 0.1\n\nfor _ in range(50):\n    grad = 2 * (x - 5)\n    x = x - lr * grad',
        hints: ['En cada paso calcula `grad = 2 * (x - 5)`.', 'Actualiza `x = x - lr * grad` dentro de un `for _ in range(50)`.'],
        explain: 'Cada paso reduce la distancia al mínimo en un factor `1 − 2·lr = 0.8`. Tras 50 pasos has recorrido el 99.99 % del camino.',
        commands: ['descenso del gradiente', 'tasa de aprendizaje'],
      }),
      pyPractice({
        goal: 'Los gradientes de la recta',
        prompt: 'Para el modelo `ŷ = w·x + b` con `w = 1` y `b = 0`, calcula `grad_w` y `grad_b` (las derivadas del error cuadrático medio) con los datos dados.',
        starter: 'import numpy as np\n\nx = np.array([1.0, 2.0, 3.0])\ny = np.array([3.0, 5.0, 7.0])\nw, b = 1.0, 0.0\n\ngrad_w = grad_b = None\n',
        check: all(variable('round(float(grad_w), 4)', '-13.3333'), variable('round(float(grad_b), 4)', '-6.0')),
        solution: 'import numpy as np\n\nx = np.array([1.0, 2.0, 3.0])\ny = np.array([3.0, 5.0, 7.0])\nw, b = 1.0, 0.0\n\nerr = (w * x + b) - y\ngrad_w = (2 * err * x).mean()\ngrad_b = (2 * err).mean()',
        hints: ['El error es `err = (w * x + b) - y`.', '`grad_w = (2 * err * x).mean()` y `grad_b = (2 * err).mean()`.'],
        explain: 'Los dos gradientes son negativos: indican que **aumentar** w y b reduce el error (el modelo se queda corto). El descenso del gradiente haría `w -= lr * grad_w`, o sea, subirlo.',
        commands: ['descenso del gradiente'],
      }),
      pyPractice({
        goal: 'Entrena tu recta',
        prompt: 'Entrena `w` y `b` con descenso del gradiente: `lr = 0.02`, **2000 épocas**, empezando en 0, sobre los datos de la recta `y = 3x − 2`. Al final `w` debe acercarse a 3 y `b` a −2.',
        starter: 'import numpy as np\n\nx = np.linspace(0, 4, 21)\ny = 3 * x - 2\nw, b = 0.0, 0.0\nlr = 0.02\n\n# bucle de entrenamiento\n',
        check: all(truthy('abs(w - 3) < 0.05'), truthy('abs(b + 2) < 0.1')),
        solution: 'import numpy as np\n\nx = np.linspace(0, 4, 21)\ny = 3 * x - 2\nw, b = 0.0, 0.0\nlr = 0.02\n\nfor _ in range(2000):\n    err = w * x + b - y\n    w -= lr * (2 * err * x).mean()\n    b -= lr * (2 * err).mean()',
        hints: ['En cada época: predicción, error, dos gradientes y dos actualizaciones.', 'Usa `w -= lr * (2 * err * x).mean()` y `b -= lr * (2 * err).mean()`.'],
        explain: 'Acabas de escribir el bucle de entrenamiento de un modelo: es el mismo que usa PyTorch por dentro, solo que con muchos más parámetros.',
        commands: ['descenso del gradiente'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: ajusta una recta y mide su calidad',
    prompt:
      'Genera datos con ruido, **estandariza** `x`, entrena una recta con descenso del gradiente y mide cuánto de la variación explica con el **R²**.\n\n1. Crea `x` e `y` (ya están en el código) y estandariza `x` en `xs` (media 0, std 1).\n2. Entrena `w` y `b` con `lr = 0.1` durante **300 épocas** sobre `xs`.\n3. Calcula `r2 = 1 − suma((y − pred)²) / suma((y − media(y))²)`.',
    starter:
      'import numpy as np\n\nrng = np.random.default_rng(7)\nx = rng.uniform(0, 10, 60)\ny = 4 * x + 5 + rng.normal(0, 2, 60)\n\nxs = None   # x estandarizada\nw = b = 0.0\nlr = 0.1\n\nr2 = None\n',
    check: all(truthy('abs(xs.mean()) < 1e-9 and abs(xs.std() - 1) < 1e-9'), truthy('r2 > 0.95'), truthy('w > 5')),
    solution:
      'import numpy as np\n\nrng = np.random.default_rng(7)\nx = rng.uniform(0, 10, 60)\ny = 4 * x + 5 + rng.normal(0, 2, 60)\n\nxs = (x - x.mean()) / x.std()\nw = b = 0.0\nlr = 0.1\n\nfor _ in range(300):\n    err = w * xs + b - y\n    w -= lr * (2 * err * xs).mean()\n    b -= lr * (2 * err).mean()\n\npred = w * xs + b\nr2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()',
    hints: ['`xs = (x - x.mean()) / x.std()`.', 'Dentro del bucle: `err = w * xs + b - y` y dos actualizaciones.', '`r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()`.'],
    explain: 'Has combinado estandarización, descenso del gradiente y una métrica de calidad: el esqueleto de cualquier experimento de regresión. En la zona 4 verás cómo scikit-learn lo hace en una línea.',
    commands: ['descenso del gradiente', 'np.random.default_rng'],
  },
});

// importaciones usadas solo en algunas ediciones de las lecciones
void [match, multi, order, pyCode, pyRepl];
