import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, calls, truthy, variable } from './iabuild';

/** Dos medias lunas con ruido: el conjunto en el que se entrena la red completa (200 puntos). */
const LUNAS = `import numpy as np
from sklearn.datasets import make_moons

X, y = make_moons(200, noise=0.2, random_state=0)
y = y.reshape(-1, 1)
`;

/** Puertas lógicas: las cuatro combinaciones de dos entradas. */
const PUERTAS = `import numpy as np

X = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)
`;

export const ia8 = iaWorld({
  id: 'ia8',
  index: 8,
  title: 'Redes neuronales desde cero',
  subtitle: 'Neuronas, capas, retropropagación y entrenamiento con NumPy',
  emoji: '🧠',
  color: '#FB923C',
  level: 'avanzado',
  intro:
    'Detrás de ChatGPT, del reconocimiento de caras y de los traductores hay **redes neuronales**. En esta zona vas a construir una **desde cero con NumPy**, sin ninguna librería de aprendizaje profundo: la **neurona**, las **capas**, las **funciones de activación**, la **pérdida**, la **retropropagación** (el algoritmo que lo hace todo posible) y el **bucle de entrenamiento** con optimizadores como Adam. Cuando termines, PyTorch dejará de ser magia: será la misma máquina, automatizada.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia8-1', { title: 'La neurona artificial', summary: 'Pesos, sesgo y activación: la pieza básica', emoji: '⚡', commands: ['neurona', 'perceptrón', 'función de activación'], minutes: 13 }, [
      learn(
        'Una función con piezas que se aprenden',
        `
Una **neurona artificial** es una función minúscula:

1. Multiplica cada entrada por un **peso**: \`z = w₁x₁ + w₂x₂ + … + b\` (o, con vectores, \`z = x @ w + b\`).
2. Le suma un **sesgo** \`b\` (que desplaza el umbral).
3. Pasa \`z\` por una **función de activación** \`f\`: \`a = f(z)\`.

Los **pesos y el sesgo son los parámetros que se aprenden**; todo lo demás es fijo. Una red neuronal es simplemente muchas neuronas conectadas, y "entrenar" es encontrar buenos valores para millones de pesos.

El ejemplo más simple es el **perceptrón**: una neurona con activación de **paso** (da 1 si \`z ≥ 0\` y 0 si no). Funciona como una puerta de decisión.
`,
        '⚡',
      ),
      illus('ia-neuron', 'Una neurona y las puertas lógicas', 'Cambia los pesos y el sesgo para que acierte las cuatro filas de AND o de OR. Después prueba XOR.'),
      mc('Una neurona recibe `x = [2, 1]`, tiene pesos `w = [0.5, -1]` y sesgo `b = 0.25`. ¿Cuánto vale `z`?', ['0.25', '1.25', '−0.75', '2.0'], 0, 'z = 2·0.5 + 1·(−1) + 0.25 = 1 − 1 + 0.25 = 0.25. El 0.25 es justo el sesgo porque los dos primeros términos se cancelan.'),
      pyDemo(
        'Una neurona en NumPy',
        [
          ['import numpy as np\n\nx = np.array([2.0, 1.0])\nw = np.array([0.5, -1.0])\nb = 0.25\n\nz = x @ w + b\nprint(z)\na = 1 / (1 + np.exp(-z))      # activación sigmoide\nprint(round(float(a), 4))', 'El producto escalar `x @ w` hace toda la suma ponderada de golpe. La sigmoide convierte z = 0.25 en una "probabilidad" de 0.5622'],
        ],
      ),
      learn(
        'Una neurona traza una recta',
        `
La neurona se "activa" cuando \`z ≥ 0\`. La ecuación \`w₁x₁ + w₂x₂ + b = 0\` es una **recta**: a un lado la salida es 1 y al otro 0. Los pesos giran la recta y el sesgo la desplaza.

Con eso una neurona puede imitar puertas lógicas. Por ejemplo, con \`w = [1, 1]\` y \`b = −1.5\` solo se activa si **las dos** entradas valen 1: es **AND**. Con \`b = −0.5\` se activa si **alguna** vale 1: es **OR**.

Pero hay funciones que ninguna recta separa. **XOR** (verdadero si las entradas son distintas) coloca los 1 en esquinas opuestas del cuadrado: no hay recta que deje los dos 1 a un lado y los dos 0 al otro. Esa limitación (Minsky y Papert, 1969) frenó el campo durante años, hasta que se generalizaron las **capas ocultas**.
`,
        '📏',
      ),
      pyDemo(
        'AND, OR y el imposible XOR',
        [
          [`${PUERTAS}paso = lambda z: (z >= 0).astype(int)\nprint(paso(X @ np.array([1, 1]) - 1.5))   # AND\nprint(paso(X @ np.array([1, 1]) - 0.5))   # OR`, 'Los mismos pesos con distinto sesgo dan puertas distintas: el sesgo mueve el umbral'],
          ['xor = np.array([0, 1, 1, 0])\nrejilla = np.linspace(-2, 2, 41)\nhallados = 0\nfor w1 in rejilla:\n    for w2 in rejilla:\n        for b in rejilla:\n            if (paso(X @ np.array([w1, w2]) + b) == xor).all():\n                hallados += 1\nprint(hallados)', 'Se han probado 68 921 neuronas distintas: ninguna calcula XOR. No es mala suerte, es geometría'],
        ],
      ),
      tf('Si encuentras los pesos adecuados, una sola neurona puede calcular XOR.', false, 'XOR no es linealmente separable: ninguna recta (ningún peso ni sesgo) separa sus unos de sus ceros. Hace falta al menos una capa oculta.'),
      pyOut('¿Qué imprime?', 'import numpy as np\nx = np.array([1.0, 2.0, 3.0])\nw = np.array([0.2, -0.1, 0.4])\nb = -0.5\nz = x @ w + b\nprint(round(float(z), 2), int(z >= 0))', ['0.2 0', '1.2 1', '0.7 0'], 'z = 0.2 − 0.2 + 1.2 − 0.5 = 0.7. Como z ≥ 0, la neurona de paso devuelve 1.'),
      learn(
        'El perceptrón aprende solo',
        `
Rosenblatt propuso en 1958 una regla para **ajustar los pesos automáticamente**. Para cada ejemplo:

1. Predice \`pred = 1 si x @ w + b ≥ 0, si no 0\`.
2. Calcula el \`error = y − pred\` (0 si acertó, ±1 si falló).
3. Corrige: \`w += η · error · x\` y \`b += η · error\`.

Si se equivocó por defecto (debía ser 1), los pesos de las entradas activas **suben**; si fue por exceso, **bajan**. Si los datos son separables con una recta, el teorema de convergencia garantiza que acaba acertando todo. Es el ancestro directo del descenso del gradiente.
`,
        '🎓',
      ),
      pyDemo(
        'Aprender la puerta AND',
        [
          [`${PUERTAS}y = np.array([0, 0, 0, 1])\nw = np.zeros(2)\nb = 0.0\nfor epoca in range(10):\n    errores = 0\n    for xi, yi in zip(X, y):\n        e = yi - int(xi @ w + b >= 0)\n        if e != 0:\n            w += 0.5 * e * xi\n            b += 0.5 * e\n            errores += 1\n    print(epoca, errores, w, b)\n    if errores == 0:\n        break`, 'Los errores por época son 2, 3, 3, 2, 1 y, en la sexta pasada, 0: ya no falla ningún ejemplo. w = [1, 0.5] y b = −1.5 hacen de AND'],
        ],
      ),
      mc('¿Qué papel juega el sesgo `b` de una neurona?', ['Desplaza la frontera de decisión sin cambiar su orientación', 'Multiplica todas las entradas', 'Elige la función de activación', 'Solo sirve para evitar la división por cero'], 0, 'Los pesos orientan la recta y el sesgo la desplaza (sin él, la frontera pasaría siempre por el origen). Es lo que convierte la misma neurona en AND o en OR.'),
      pyPractice({
        goal: 'Tu primera neurona',
        prompt: 'Escribe la función `neurona(x, w, b)` que calcule `z = x @ w + b` y devuelva la salida de la **sigmoide** `1 / (1 + e^(−z))`.',
        starter: 'import numpy as np\n\ndef neurona(x, w, b):\n    pass\n',
        check: calls([
          ['round(float(neurona(np.array([2.0, 1.0]), np.array([0.5, -1.0]), 0.25)), 4)', '0.5622'],
          ['round(float(neurona(np.array([0.0, 0.0]), np.array([3.0, 3.0]), 0.0)), 2)', '0.5'],
          ['round(float(neurona(np.array([10.0]), np.array([1.0]), 0.0)), 4)', '1.0'],
        ]),
        solution: 'import numpy as np\n\ndef neurona(x, w, b):\n    z = x @ w + b\n    return 1 / (1 + np.exp(-z))\n',
        hints: ['`z = x @ w + b` es la suma ponderada.', 'La sigmoide es `1 / (1 + np.exp(-z))`.'],
        explain: 'Con tres líneas tienes la unidad de construcción de cualquier red. Observa que con entradas grandes la sigmoide se "satura" cerca de 1: eso será importante cuando hablemos de gradientes.',
        commands: ['neurona', 'función de activación'],
      }),
      pyPractice({
        goal: 'Diseña la puerta OR',
        prompt: `Elige los pesos \`w\` (un vector de 2 números) y el sesgo \`b\` para que la neurona de paso \`X @ w + b >= 0\` devuelva \`[0, 1, 1, 1]\` en las cuatro filas de \`X\`.`,
        starter: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]])\nw = np.zeros(2)\nb = 0.0\n',
        check: variable('(X @ np.asarray(w, dtype=float) + b >= 0).astype(int).tolist()', '[0, 1, 1, 1]'),
        solution: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]])\nw = np.array([1.0, 1.0])\nb = -0.5\n',
        hints: ['Para que (0, 0) dé 0, el sesgo debe ser negativo.', 'Con `w = [1, 1]`, basta que `b` esté entre −1 y 0 (por ejemplo −0.5): una sola entrada a 1 ya supera el umbral.'],
        explain: 'Buscar a mano pesos que funcionen es lo que hacía la gente en los años 50. La gracia del aprendizaje automático es que el ordenador los encuentre por sí mismo, como en el siguiente ejercicio.',
        commands: ['neurona', 'perceptrón'],
      }),
      pyPractice({
        goal: 'El perceptrón aprende NAND',
        prompt: 'Aplica la regla del perceptrón (tasa 0.5) durante 20 épocas para aprender la puerta **NAND** (`y = [1, 1, 1, 0]`). Parte de `w = 0` y `b = 0`. Al terminar, `w` y `b` deben clasificar bien las cuatro filas.',
        starter: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\ny = np.array([1, 1, 1, 0])\nw = np.zeros(2)\nb = 0.0\n\n# 20 épocas de la regla del perceptrón\n',
        check: variable('(X @ w + b >= 0).astype(int).tolist()', '[1, 1, 1, 0]'),
        solution: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\ny = np.array([1, 1, 1, 0])\nw = np.zeros(2)\nb = 0.0\n\nfor epoca in range(20):\n    for xi, yi in zip(X, y):\n        error = yi - int(xi @ w + b >= 0)\n        w += 0.5 * error * xi\n        b += 0.5 * error\n',
        hints: ['Recorre los ejemplos con `for xi, yi in zip(X, y)`.', 'El error es `yi - int(xi @ w + b >= 0)`; actualiza `w += 0.5 * error * xi` y `b += 0.5 * error`.'],
        explain: 'NAND es una puerta "universal": con ella se puede construir cualquier circuito digital. Una neurona que la aprende ya contiene, en potencia, todos los ordenadores. Aun así, sola no puede con XOR: para eso hacen falta capas.',
        commands: ['perceptrón', 'neurona'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia8-2', { title: 'Capas y propagación hacia delante', summary: 'De una neurona a una red: matrices, formas y XOR', emoji: '🧱', commands: ['red neuronal', 'propagación hacia delante', 'función de activación'], minutes: 14 }, [
      learn(
        'Una capa es una matriz',
        `
Una **capa** son varias neuronas que miran las mismas entradas. En vez de un vector de pesos \`w\`, cada neurona tiene el suyo, y se apilan como columnas de una **matriz** \`W\`:

\`\`\`
Z = X @ W + b        A = f(Z)
\`\`\`

Las formas importan: si \`X\` es \`(n, entradas)\` y \`W\` es \`(entradas, salidas)\`, entonces \`Z\` es \`(n, salidas)\`; el sesgo \`b\` (\`(salidas,)\`) se suma a cada fila por *broadcasting*. Procesas **n ejemplos a la vez** con una sola multiplicación de matrices, la operación que las GPU hacen a velocidad de vértigo.

Una red con una **capa oculta** (la que no es ni entrada ni salida) se escribe como \`entradas–ocultas–salidas\`, por ejemplo **2-3-1**. Calcular su salida de izquierda a derecha es la **propagación hacia delante** (*forward pass*).
`,
        '🧱',
      ),
      illus('ia-forward', 'Una red 2-2-1 que resuelve XOR', 'Cambia las entradas y mira cómo se activa cada neurona. Después apaga la activación y observa qué pasa.'),
      pyOut('¿Qué forma tiene el resultado?', 'import numpy as np\nX = np.ones((32, 10))\nW = np.ones((10, 4))\nb = np.ones(4)\nprint((X @ W + b).shape)', ['(32, 10)', '(10, 4)', '(4,)'], '(32, 10) @ (10, 4) da (32, 4): una fila por ejemplo y una columna por neurona. El sesgo (4,) se difunde sobre las 32 filas.'),
      pyDemo(
        'Propagación hacia delante de una red 2-3-1',
        [
          ['import numpy as np\n\nnp.random.seed(0)\nX = np.array([[0.5, 1.0], [2.0, -1.0], [0.0, 3.0], [1.5, 1.5]])   # 4 ejemplos, 2 características\nW1 = np.random.randn(2, 3) * 0.5; b1 = np.zeros(3)\nW2 = np.random.randn(3, 1) * 0.5; b2 = np.zeros(1)\n\ndef sigmoide(z): return 1 / (1 + np.exp(-z))\n\nZ1 = X @ W1 + b1\nA1 = np.maximum(0, Z1)      # capa oculta con ReLU\nZ2 = A1 @ W2 + b2\nA2 = sigmoide(Z2)           # salida: una probabilidad por ejemplo\nprint(X.shape, W1.shape, Z1.shape, A1.shape, W2.shape, A2.shape)\nprint(A2.round(4).ravel().tolist())', 'Cada ejemplo atraviesa las dos capas: (4, 2) → (4, 3) → (4, 1). Con pesos aleatorios las probabilidades no significan nada todavía: falta entrenar'],
          ['print(sum(p.size for p in (W1, b1, W2, b2)))', '2·3 + 3 (capa 1) más 3·1 + 1 (capa 2): 13 parámetros que ajustar'],
        ],
      ),
      learn(
        '¿Por qué hace falta la activación?',
        `
Imagina dos capas **sin** función de activación: \`(X @ W1) @ W2\`. Por la propiedad asociativa eso es \`X @ (W1 @ W2)\`: **una sola capa** con la matriz \`W1 @ W2\`. Da igual cuántas apiles, siempre se colapsan en una transformación lineal, y una transformación lineal solo dibuja rectas.

La **no linealidad** (la ReLU, la sigmoide…) es la que rompe esa trampa: pliega el espacio entre capa y capa. Gracias a ella una red con una capa oculta suficientemente ancha puede aproximar *cualquier* función continua (**teorema de aproximación universal**).
`,
        '🌀',
      ),
      pyDemo(
        'Dos capas lineales = una capa',
        [
          ['import numpy as np\n\nrng = np.random.RandomState(1)\nX = rng.randn(5, 4)\nW1 = rng.randn(4, 6)\nW2 = rng.randn(6, 3)\ndos_capas = (X @ W1) @ W2\nuna_capa = X @ (W1 @ W2)\nprint(np.allclose(dos_capas, una_capa), (W1 @ W2).shape)', 'Idénticas: la matriz combinada `W1 @ W2` (4, 3) hace lo mismo que las dos capas. Sin activación, la profundidad no sirve de nada'],
        ],
      ),
      pyDemo(
        'XOR con una capa oculta, a mano',
        [
          ['import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\nW1 = np.array([[1.0, 1.0], [1.0, 1.0]]); b1 = np.array([-0.5, -1.5])\nW2 = np.array([[1.0], [-2.0]]); b2 = np.array([-0.5])\npaso = lambda z: (z > 0).astype(float)\n\nH = paso(X @ W1 + b1)       # neurona 1 = OR, neurona 2 = AND\nS = paso(H @ W2 + b2)       # "OR pero no AND"\nprint(H.tolist())\nprint(S.ravel().tolist())', 'La capa oculta calcula OR y AND; la salida combina "OR y no AND", que es XOR: [0, 1, 1, 0]. Lo que una neurona no podía, dos capas lo resuelven'],
        ],
      ),
      tf('Apilar muchas capas lineales (sin función de activación) permite aprender funciones que una sola capa lineal no puede.', false, 'El producto de matrices es otra matriz: la composición de funciones lineales es lineal. Sin no linealidad, la profundidad no añade nada.'),
      mc('¿Cuántos parámetros (pesos + sesgos) tiene una red 4-10-3?', ['43', '83', '120', '40'], 1, 'Capa 1: 4·10 + 10 = 50. Capa 2: 10·3 + 3 = 33. Total 83. En una capa densa siempre es entradas × salidas + salidas.'),
      pyPractice({
        goal: 'Propaga un lote',
        prompt: 'Calcula la salida `A2` de la red 3-5-1: capa oculta con **ReLU** (`np.maximum(0, …)`) y capa de salida con **sigmoide**. Procesa los 4 ejemplos de `X` a la vez.',
        starter: 'import numpy as np\n\nrng = np.random.RandomState(0)\nX = rng.randn(4, 3)\nW1 = rng.randn(3, 5) * 0.5; b1 = np.zeros(5)\nW2 = rng.randn(5, 1) * 0.5; b2 = np.zeros(1)\n\nA2 = None\n',
        check: all(variable('A2.shape', '(4, 1)'), truthy('abs(float(A2.sum()) - 2.8430495) < 1e-6')),
        solution: 'import numpy as np\n\nrng = np.random.RandomState(0)\nX = rng.randn(4, 3)\nW1 = rng.randn(3, 5) * 0.5; b1 = np.zeros(5)\nW2 = rng.randn(5, 1) * 0.5; b2 = np.zeros(1)\n\nA1 = np.maximum(0, X @ W1 + b1)\nA2 = 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n',
        hints: ['Primero la capa oculta: `A1 = np.maximum(0, X @ W1 + b1)`.', 'Luego la salida: `1 / (1 + np.exp(-(A1 @ W2 + b2)))`.'],
        explain: 'Es la propagación hacia delante completa en dos líneas. En PyTorch será `modelo(X)`; por dentro hace exactamente esto, capa a capa.',
        commands: ['propagación hacia delante', 'red neuronal'],
      }),
      pyPractice({
        goal: 'Cuenta los parámetros',
        prompt: 'Escribe `n_params(capas)`, donde `capas` es la lista de tamaños (por ejemplo `[784, 128, 10]`), que devuelva el número total de pesos y sesgos de la red.',
        starter: 'def n_params(capas):\n    pass\n',
        check: calls([['n_params([784, 128, 10])', '101770'], ['n_params([2, 3, 1])', '13'], ['n_params([4, 10, 3])', '83']]),
        solution: 'def n_params(capas):\n    return sum(a * b + b for a, b in zip(capas[:-1], capas[1:]))\n',
        hints: ['`zip(capas[:-1], capas[1:])` te da las parejas (entradas, salidas) de cada capa.', 'Cada capa tiene `entradas * salidas + salidas` parámetros.'],
        explain: 'Una red para reconocer dígitos 28×28 con una sola capa oculta de 128 neuronas ya tiene más de 100 000 parámetros. GPT-4 se estima en cientos de miles de millones.',
        commands: ['red neuronal'],
      }),
      pyPractice({
        goal: 'XOR a mano',
        prompt: 'Rellena `W1`, `b1`, `W2` y `b2` para que la red de dos capas con activación de paso devuelva XOR (`[0, 1, 1, 0]`) en `salida`. Pista: la primera neurona oculta puede ser un OR y la segunda un AND.',
        starter: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\npaso = lambda z: (z > 0).astype(float)\n\nW1 = np.zeros((2, 2)); b1 = np.zeros(2)\nW2 = np.zeros((2, 1)); b2 = np.zeros(1)\n\nsalida = paso(paso(X @ W1 + b1) @ W2 + b2)\n',
        check: variable('salida.ravel().tolist()', '[0.0, 1.0, 1.0, 0.0]'),
        solution: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\npaso = lambda z: (z > 0).astype(float)\n\nW1 = np.array([[1.0, 1.0], [1.0, 1.0]]); b1 = np.array([-0.5, -1.5])\nW2 = np.array([[1.0], [-2.0]]); b2 = np.array([-0.5])\n\nsalida = paso(paso(X @ W1 + b1) @ W2 + b2)\n',
        hints: ['Neurona 1 (OR): pesos [1, 1] y sesgo −0.5. Neurona 2 (AND): pesos [1, 1] y sesgo −1.5.', 'La salida debe valer "OR y no AND": pesos [1, −2] y sesgo −0.5.'],
        explain: 'Has diseñado a mano lo que una red aprende sola: una representación intermedia (OR, AND) en la que el problema se vuelve separable por una recta. Eso es "aprender características".',
        commands: ['red neuronal', 'propagación hacia delante'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia8-3', { title: 'Funciones de activación', summary: 'Sigmoide, tanh, ReLU y softmax: cuándo usar cada una', emoji: '📈', commands: ['función de activación', 'ReLU', 'softmax'], minutes: 13 }, [
      learn(
        'Cuatro activaciones que debes conocer',
        `
| Activación | Fórmula | Rango | Úsala en… |
|---|---|---|---|
| **Sigmoide** | \`1 / (1 + e⁻ᶻ)\` | (0, 1) | salida de clasificación binaria |
| **tanh** | \`(eᶻ − e⁻ᶻ)/(eᶻ + e⁻ᶻ)\` | (−1, 1) | capas ocultas antiguas, RNN |
| **ReLU** | \`max(0, z)\` | [0, ∞) | **capas ocultas** por defecto |
| **Softmax** | \`eᶻⁱ / Σ eᶻʲ\` | (0, 1), suman 1 | salida multiclase |

Para **regresión** (predecir un número) la capa de salida no lleva activación.

La derivada importa tanto como la función: durante el entrenamiento el gradiente "pasa por" cada activación multiplicándose por su derivada. Si esa derivada es casi 0, el aprendizaje se detiene.
`,
        '📈',
      ),
      illus('ia-activations', 'Explora las activaciones y sus derivadas', 'Mueve z y mira el valor de la función (azul) y de su derivada (naranja). Fíjate dónde la derivada se anula. Al final, prueba softmax y su temperatura.'),
      mc('Quieres clasificar fotos en 10 categorías excluyentes. ¿Qué activación va en la capa de salida?', ['Sigmoide', 'ReLU', 'Softmax', 'Ninguna'], 2, 'Softmax produce 10 probabilidades que suman 1, una por clase. La sigmoide serviría para una decisión sí/no, y la ReLU no da probabilidades.'),
      pyDemo(
        'Las activaciones en NumPy',
        [
          ['import numpy as np\n\ndef sigmoide(z): return 1 / (1 + np.exp(-z))\ndef relu(z): return np.maximum(0, z)\ndef leaky(z, a=0.1): return np.where(z > 0, z, a * z)\n\nz = np.array([-4.0, -1.0, 0.0, 1.0, 4.0])\nfor nombre, f in [("sigmoide", sigmoide), ("tanh", np.tanh), ("relu", relu), ("leaky", leaky)]:\n    print(nombre, f(z).round(3).tolist())', 'La sigmoide y tanh aplastan los extremos (±4 casi iguales a ±1); la ReLU corta lo negativo; la Leaky lo deja pasar a escala reducida'],
        ],
      ),
      learn(
        'Gradientes que se desvanecen y neuronas muertas',
        `
La derivada de la sigmoide es \`σ(z)·(1 − σ(z))\` y **nunca pasa de 0.25** (en z = 0). Cuando |z| es grande se aplana: casi 0. En la retropropagación los gradientes se **multiplican** capa a capa, así que con 10 capas sigmoides el gradiente que llega a la primera es como mucho 0.25¹⁰ ≈ 10⁻⁶: las primeras capas casi no aprenden. Es el problema del **gradiente evanescente**, y la razón por la que se impuso la ReLU.

La ReLU tiene derivada 1 para z > 0 (el gradiente pasa intacto) y 0 para z < 0. Su riesgo es la **neurona muerta**: si sus pesos hacen que z sea siempre negativo, nunca recibe gradiente y no se recupera. La **Leaky ReLU** deja una pendiente pequeña (0.1) en negativo para evitarlo.
`,
        '☠️',
      ),
      pyDemo(
        'Cuánto gradiente sobrevive',
        [
          ['import numpy as np\n\nz = np.array([-4.0, -1.0, 0.0, 1.0, 4.0])\ns = 1 / (1 + np.exp(-z))\nprint((s * (1 - s)).round(4).tolist())   # derivada de la sigmoide\nprint(0.25 ** 10)                        # factor tras 10 capas sigmoides', 'La derivada es 0.25 como máximo y cae a 0.018 en |z| = 4. Tras 10 capas, el factor máximo es 9.5·10⁻⁷'],
        ],
      ),
      tf('Una neurona ReLU con `z` siempre negativo no recibe gradiente y deja de aprender.', true, 'Su derivada es 0 para z < 0, así que el gradiente se anula al pasar por ella: es la neurona "muerta". La Leaky ReLU mantiene una pendiente pequeña para evitarlo.'),
      learn(
        'Softmax: de números a probabilidades',
        `
La última capa de un clasificador multiclase produce un número por clase, los **logits**. **Softmax** los transforma en probabilidades: exponencia cada uno (todo se vuelve positivo) y divide por la suma. Los logits mayores se llevan casi toda la probabilidad.

Un detalle numérico crucial: \`np.exp(1000)\` es *infinito* y el cociente da \`nan\`. La solución es **restar el máximo** de cada fila antes de exponenciar; el resultado matemático es idéntico (se cancela al dividir) pero ya no se desborda.

Dividir los logits por una **temperatura** T antes de softmax controla lo "decidido" que es el reparto: T alta aplana las probabilidades, T baja las concentra. La reencontrarás al generar texto con un LLM.
`,
        '🎚️',
      ),
      pyDemo(
        'Softmax estable',
        [
          ['import numpy as np\n\ndef softmax(z):\n    e = np.exp(z - z.max(axis=1, keepdims=True))\n    return e / e.sum(axis=1, keepdims=True)\n\nL = np.array([[2.0, 1.0, 0.1], [1000.0, 1001.0, 1002.0]])\nprint(softmax(L).round(4).tolist())\nwith np.errstate(all="ignore"):\n    ingenuo = np.exp(L) / np.exp(L).sum(axis=1, keepdims=True)\nprint(ingenuo.round(4).tolist())', 'La versión estable reparte bien incluso con logits de 1000. La ingenua da `nan` en la segunda fila porque exp(1000) desborda'],
        ],
      ),
      match('Une cada situación con la activación adecuada:', [['Spam / no spam (salida)', 'Sigmoide'], ['Dígito del 0 al 9 (salida)', 'Softmax'], ['Precio de una casa (salida)', 'Ninguna (lineal)'], ['Capas ocultas por defecto', 'ReLU']], 'La salida debe tener la forma del problema: una probabilidad (sigmoide), un reparto entre clases (softmax) o un número libre (lineal). Dentro, la ReLU.'),
      pyOut('¿Qué imprime?', 'import numpy as np\nz = np.array([-2.0, 0.0, 3.0])\nprint(np.maximum(0, z).tolist(), (z > 0).astype(int).tolist())', ['[0.0, 0.0, 3.0] [1, 1, 1]', '[-2.0, 0.0, 3.0] [0, 0, 1]', '[0.0, 0.5, 3.0] [0, 0, 1]'], 'La ReLU deja 0 y 0 donde z ≤ 0 y 3 donde z = 3. La segunda lista es su derivada: 1 solo donde z > 0 (en z = 0 se toma 0).'),
      pyPractice({
        goal: 'Implementa softmax',
        prompt: 'Escribe `softmax(z)` para una matriz `z` de logits (una fila por ejemplo). Debe devolver las probabilidades de cada fila y ser **estable** (restando el máximo de la fila).',
        starter: 'import numpy as np\n\ndef softmax(z):\n    pass\n',
        check: calls([
          ['softmax(np.array([[2.0, 1.0, 0.1]])).round(4).tolist()', '[[0.659, 0.2424, 0.0986]]'],
          ['bool(np.isfinite(softmax(np.array([[1000.0, 1001.0, 1002.0]]))).all())', 'True'],
          ['round(float(softmax(np.array([[1000.0, 1000.0]])).sum()), 6)', '1.0'],
        ]),
        solution: 'import numpy as np\n\ndef softmax(z):\n    e = np.exp(z - z.max(axis=1, keepdims=True))\n    return e / e.sum(axis=1, keepdims=True)\n',
        hints: ['Resta `z.max(axis=1, keepdims=True)` antes de `np.exp`.', 'Divide cada fila por su suma: `e / e.sum(axis=1, keepdims=True)`.'],
        explain: 'El truco de restar el máximo se usa en todas las librerías (PyTorch lo hace internamente). `keepdims=True` conserva la forma (n, 1) para que el broadcasting funcione por filas.',
        commands: ['softmax'],
      }),
      pyPractice({
        goal: 'ReLU y su derivada',
        prompt: 'Escribe `relu(z)` y `drelu(z)` (su derivada: 1 donde `z > 0` y 0 en el resto, como array de `float`).',
        starter: 'import numpy as np\n\ndef relu(z):\n    pass\n\ndef drelu(z):\n    pass\n',
        check: calls([
          ['relu(np.array([-1.0, 2.0])).tolist()', '[0.0, 2.0]'],
          ['drelu(np.array([-1.0, 0.0, 2.0])).tolist()', '[0.0, 0.0, 1.0]'],
        ]),
        solution: 'import numpy as np\n\ndef relu(z):\n    return np.maximum(0, z)\n\ndef drelu(z):\n    return (z > 0).astype(float)\n',
        hints: ['`np.maximum(0, z)` aplica el máximo elemento a elemento.', '`(z > 0)` es un array booleano; `.astype(float)` lo convierte en 0.0 y 1.0.'],
        explain: 'La derivada de la ReLU es solo una comparación: por eso es tan barata, y por eso el entrenamiento de redes profundas se volvió práctico.',
        commands: ['ReLU', 'función de activación'],
      }),
      pyPractice({
        goal: 'El gradiente evanescente',
        prompt: 'La derivada máxima de la sigmoide es `dmax = 0.25`. Guarda en `grad_10` el factor máximo que sobrevive tras 10 capas sigmoides (`dmax` elevado a 10) y en `capas` el menor número de capas para que ese factor baje de `1e-3`.',
        starter: 'dmax = 0.25\ngrad_10 = None\ncapas = None\n',
        check: all(truthy('abs(grad_10 - 0.25 ** 10) < 1e-12'), variable('int(capas)', '5')),
        solution: 'dmax = 0.25\ngrad_10 = dmax ** 10\n\ncapas = 0\nfactor = 1.0\nwhile factor >= 1e-3:\n    factor *= dmax\n    capas += 1\n',
        hints: ['`grad_10 = dmax ** 10`.', 'Usa un bucle `while` que multiplique por `dmax` y cuente capas hasta que el factor sea menor que 1e-3.'],
        explain: 'Con solo 5 capas sigmoides el gradiente máximo ya cae por debajo de una milésima. Por eso las redes profundas de los años 90 eran tan difíciles de entrenar y por eso hoy se usa ReLU.',
        commands: ['función de activación', 'ReLU'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia8-4', { title: 'Pérdida y retropropagación', summary: 'Medir el error y repartir la culpa con la regla de la cadena', emoji: '🔙', commands: ['función de pérdida', 'entropía cruzada', 'retropropagación', 'regla de la cadena', 'comprobación de gradientes'], minutes: 16 }, [
      learn(
        'Medir cuánto se equivoca la red',
        `
Para mejorar hay que poder **medir el error con un número**: la **función de pérdida** \`L\`. Entrenar es buscar los pesos que la hacen mínima.

- **Error cuadrático medio** (regresión): \`mean((y − p)²)\`.
- **Entropía cruzada binaria** (clasificación): \`−mean(y·log p + (1 − y)·log(1 − p))\`. Para una clase correcta es \`−log(p)\`: si la red da 0.9 a la clase buena pierde 0.105; si da 0.05, pierde **3.0**. Castiga mucho a quien se equivoca con seguridad.

La pérdida debe ser **derivable**: por eso no se entrena con la exactitud (un escalón: cambiar un peso un poco no cambia cuántos aciertos hay), sino con una pérdida suave.
`,
        '📏',
      ),
      pyDemo(
        'Dos pérdidas sobre las mismas predicciones',
        [
          ['import numpy as np\n\ny = np.array([1, 0, 1, 1])\np = np.array([0.9, 0.2, 0.6, 0.05])    # probabilidades predichas de la clase 1\nmse = np.mean((y - p) ** 2)\nbce = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))\nprint(round(float(mse), 4), round(float(bce), 4))\nprint((-np.log(p)).round(3).tolist())      # lo que aporta cada ejemplo de clase 1', 'El último ejemplo (verdad 1, predicción 0.05) aporta 3.0 de los 3.8 totales: la entropía cruzada se concentra en el error más grave'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\nprint(round(float(-np.log(0.5)), 3), round(float(-np.log(0.99)), 3))', ['0.5 0.99', '0.693 0.693', '1.0 0.0'], 'Dudar (p = 0.5) cuesta 0.693; estar seguro y acertar (p = 0.99) casi nada: 0.01. La pérdida premia la confianza correcta.'),
      learn(
        'Retropropagación: repartir la culpa',
        `
Sabemos cuánto falla la red (\`L\`). Ahora necesitamos saber **cuánto contribuye cada peso** al fallo, es decir, la derivada \`∂L/∂w\` de cada uno. Con millones de pesos no se puede probar uno a uno: se usa la **regla de la cadena**.

Si \`z = w·x + b\`, \`a = σ(z)\` y \`L = (a − y)²\`, entonces

\`∂L/∂w = ∂L/∂a · ∂a/∂z · ∂z/∂w\`

Cada factor es una derivada **local y fácil**. La pasada hacia delante calcula \`z\`, \`a\` y \`L\`; la pasada **hacia atrás** va de la salida a la entrada multiplicando esas derivadas locales y reutilizando lo ya calculado. Su coste es parecido al de una pasada hacia delante, sin importar cuántos pesos haya. Eso es la **retropropagación** (*backpropagation*), y es lo que hace posible entrenar redes gigantes.

Un resultado muy cómodo: con sigmoide + entropía cruzada, el gradiente respecto a \`z\` se simplifica a \`dz = a − y\` (predicción menos verdad).
`,
        '🔗',
      ),
      illus('ia-backprop', 'La regla de la cadena paso a paso', 'Avanza eslabón a eslabón: primero hacia delante (azul), luego hacia atrás (naranja) y por último actualiza el peso.'),
      mc('¿Qué hace la pasada hacia atrás?', ['Recalcula la predicción con otros pesos', 'Calcula la derivada de la pérdida respecto a cada peso, multiplicando derivadas locales de la salida a la entrada', 'Elimina las neuronas que fallan', 'Reordena los datos de entrenamiento'], 1, 'Aplica la regla de la cadena en sentido inverso, reutilizando los valores de la pasada hacia delante. El resultado son los gradientes que luego usa el optimizador.'),
      pyDemo(
        'Retropropagación en una neurona (y comprobación)',
        [
          ['import numpy as np\n\nx = np.array([1.0, 2.0]); w = np.array([0.5, -0.3]); b = 0.1; y = 1\nz = x @ w + b\na = 1 / (1 + np.exp(-z))\ndz = a - y                 # sigmoide + entropía cruzada\ndw = dz * x\ndb = dz\nprint(round(float(z), 3), round(float(a), 4), dw.round(4).tolist(), round(float(db), 4))', 'Gradientes analíticos: la fórmula dz = a − y da dw = [−0.5, −1.0] y db = −0.5. Negativos: hay que subir los pesos para acercar a la probabilidad 1'],
          ['def perdida(w, b):\n    a = 1 / (1 + np.exp(-(x @ w + b)))\n    return -(y * np.log(a) + (1 - y) * np.log(1 - a))\n\neps = 1e-6\nnum = np.array([(perdida(w + eps * e, b) - perdida(w - eps * e, b)) / (2 * eps) for e in np.eye(2)])\nprint(num.round(4).tolist())', 'La derivada numérica (probar w ± ε y ver cuánto cambia L) da lo mismo: la retropropagación es correcta'],
        ],
      ),
      learn(
        'Cómo saber que tu retropropagación es correcta',
        `
Escribir las derivadas a mano es fácil de equivocar y los errores no avisan: la red entrena, pero mal. La defensa estándar es la **comprobación de gradientes** (*gradient checking*): para cada peso, estimas la derivada con la **diferencia centrada**

\`(L(w + ε) − L(w − ε)) / 2ε\`

y la comparas con la analítica. Con \`ε ≈ 1e-6\`, una **diferencia relativa** \`|num − ana| / (|num| + |ana|)\` por debajo de **1e-6** indica que el código está bien.

Es lento (dos pasadas completas por parámetro): se usa para depurar, **nunca** para entrenar. Los frameworks como PyTorch automatizan la retropropagación con *autograd*, pero entender lo que hace por dentro te salva cuando algo no converge.
`,
        '🔬',
      ),
      tf('Para calcular el gradiente de una red con 1 000 000 de pesos, la retropropagación necesita recorrer la red un millón de veces.', false, 'Una sola pasada hacia atrás (de coste parecido a la pasada hacia delante) da el gradiente de todos los pesos a la vez. La derivada numérica sí necesitaría dos pasadas por peso.'),
      fill('Completa: la comprobación de gradientes compara la derivada ___ con la calculada por retropropagación.', 'La comprobación compara la derivada ___ con la analítica.', ['numérica', 'segunda', 'parcial', 'aleatoria'], ['numérica'], 'Se estima probando el peso con un pequeño aumento y disminución (±ε) y viendo cuánto cambia la pérdida.'),
      pyPractice({
        goal: 'Gradiente de una neurona',
        prompt: 'Para la neurona sigmoide con entrada `x`, pesos `w`, sesgo `b` y verdad `y = 0`, calcula `a` (salida), `dz` (`a − y`), `dw` (gradiente de los pesos) y `db` (del sesgo) con entropía cruzada.',
        starter: 'import numpy as np\n\nx = np.array([0.5, -1.0, 2.0])\nw = np.array([0.1, 0.2, -0.1])\nb = 0.0\ny = 0\n\na = dz = dw = db = None\n',
        check: all(truthy('abs(a - 0.41338) < 1e-4'), truthy('abs(db - 0.41338) < 1e-4'), truthy('abs(dw[2] - 0.82676) < 1e-4'), variable('dw.shape', '(3,)')),
        solution: 'import numpy as np\n\nx = np.array([0.5, -1.0, 2.0])\nw = np.array([0.1, 0.2, -0.1])\nb = 0.0\ny = 0\n\nz = x @ w + b\na = 1 / (1 + np.exp(-z))\ndz = a - y\ndw = dz * x\ndb = dz\n',
        hints: ['Primero `z = x @ w + b` y la sigmoide para obtener `a`.', 'Con entropía cruzada, `dz = a - y`; después `dw = dz * x` y `db = dz`.'],
        explain: 'Como la verdad es 0 y la neurona predijo 0.41, el gradiente es positivo: bajar los pesos de las entradas activas reduce la probabilidad. Fíjate en que `dw` tiene el mismo signo que `x` multiplicado por `dz`.',
        commands: ['retropropagación', 'entropía cruzada'],
      }),
      pyPractice({
        goal: 'La derivada numérica',
        prompt: 'Escribe `grad_num(f, w, eps=1e-6)`, que devuelva un array con la derivada numérica (diferencia centrada) de `f` respecto a **cada** componente del vector `w`. `f` recibe un vector y devuelve un número.',
        starter: 'import numpy as np\n\ndef grad_num(f, w, eps=1e-6):\n    pass\n',
        check: calls([
          ['grad_num(lambda w: float((w ** 2).sum()), np.array([1.0, -2.0, 3.0])).round(4).tolist()', '[2.0, -4.0, 6.0]'],
          ['grad_num(lambda w: float(w[0] * w[1]), np.array([3.0, 5.0])).round(4).tolist()', '[5.0, 3.0]'],
        ]),
        solution: 'import numpy as np\n\ndef grad_num(f, w, eps=1e-6):\n    g = np.zeros_like(w)\n    for i in range(len(w)):\n        mas = w.copy(); mas[i] += eps\n        menos = w.copy(); menos[i] -= eps\n        g[i] = (f(mas) - f(menos)) / (2 * eps)\n    return g\n',
        hints: ['Crea `g = np.zeros_like(w)` y recorre cada índice `i`.', 'Para cada `i`, copia `w`, súmale `eps` a la posición `i` (y réstalo en otra copia) y aplica `(f(mas) - f(menos)) / (2 * eps)`.'],
        explain: 'Con esta función de ocho líneas puedes validar cualquier retropropagación. Es exactamente lo que hacen los tests de las librerías de aprendizaje profundo cuando añaden una operación nueva.',
        commands: ['comprobación de gradientes', 'derivada numérica'],
      }),
      pyPractice({
        goal: 'Retropropagación de una red de dos capas',
        prompt: 'La red 3-4-1 usa `tanh` en la capa oculta y sigmoide + entropía cruzada en la salida. Calcula los gradientes analíticos `dW1`, `db1`, `dW2`, `db2` (de la pérdida media del lote) y guarda en `error` la **mayor diferencia absoluta** entre ellos y los numéricos que devuelve `grad_numerico(k)` (k = 0, 1, 2, 3 para W1, b1, W2, b2).',
        starter: 'import itertools\nimport numpy as np\n\nrng = np.random.RandomState(0)\nX = rng.randn(5, 3)\ny = (rng.rand(5, 1) > 0.5).astype(float)\nW1 = rng.randn(3, 4) * 0.5; b1 = np.zeros((1, 4))\nW2 = rng.randn(4, 1) * 0.5; b2 = np.zeros((1, 1))\n\ndef hacia_delante():\n    A1 = np.tanh(X @ W1 + b1)\n    A2 = 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n    return A1, A2\n\ndef perdida():\n    A2 = hacia_delante()[1]\n    return -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n\ndef grad_numerico(k):\n    p = [W1, b1, W2, b2][k]\n    g = np.zeros_like(p)\n    for idx in itertools.product(*[range(n) for n in p.shape]):\n        viejo = p[idx]\n        p[idx] = viejo + 1e-6; lp = perdida()\n        p[idx] = viejo - 1e-6; lm = perdida()\n        p[idx] = viejo\n        g[idx] = (lp - lm) / 2e-6\n    return g\n\nA1, A2 = hacia_delante()\ndW1 = db1 = dW2 = db2 = None\nerror = None\n',
        check: all(variable('dW1.shape', '(3, 4)'), variable('db2.shape', '(1, 1)'), truthy('error < 1e-6')),
        solution: 'import itertools\nimport numpy as np\n\nrng = np.random.RandomState(0)\nX = rng.randn(5, 3)\ny = (rng.rand(5, 1) > 0.5).astype(float)\nW1 = rng.randn(3, 4) * 0.5; b1 = np.zeros((1, 4))\nW2 = rng.randn(4, 1) * 0.5; b2 = np.zeros((1, 1))\n\ndef hacia_delante():\n    A1 = np.tanh(X @ W1 + b1)\n    A2 = 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n    return A1, A2\n\ndef perdida():\n    A2 = hacia_delante()[1]\n    return -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n\ndef grad_numerico(k):\n    p = [W1, b1, W2, b2][k]\n    g = np.zeros_like(p)\n    for idx in itertools.product(*[range(n) for n in p.shape]):\n        viejo = p[idx]\n        p[idx] = viejo + 1e-6; lp = perdida()\n        p[idx] = viejo - 1e-6; lm = perdida()\n        p[idx] = viejo\n        g[idx] = (lp - lm) / 2e-6\n    return g\n\nA1, A2 = hacia_delante()\nn = len(X)\ndZ2 = (A2 - y) / n\ndW2 = A1.T @ dZ2\ndb2 = dZ2.sum(axis=0, keepdims=True)\ndZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\ndW1 = X.T @ dZ1\ndb1 = dZ1.sum(axis=0, keepdims=True)\nerror = max(np.abs(dW1 - grad_numerico(0)).max(), np.abs(db1 - grad_numerico(1)).max(), np.abs(dW2 - grad_numerico(2)).max(), np.abs(db2 - grad_numerico(3)).max())\n',
        hints: ['Salida: `dZ2 = (A2 - y) / n`; después `dW2 = A1.T @ dZ2` y `db2 = dZ2.sum(axis=0, keepdims=True)`.', 'Capa oculta: `dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)` (la derivada de tanh es 1 − A²); `dW1 = X.T @ dZ1` y `db1 = dZ1.sum(axis=0, keepdims=True)`.', 'Compara con `np.abs(dW1 - grad_numerico(0)).max()` y toma el máximo de los cuatro.'],
        explain: 'Si el error es ~1e-10, tu retropropagación es correcta. Fíjate en el patrón: cada gradiente es "la entrada de la capa, traspuesta, por el gradiente que llega de la capa siguiente". Es la misma receta para cualquier número de capas.',
        commands: ['retropropagación', 'regla de la cadena', 'comprobación de gradientes'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia8-5', { title: 'Entrenar una red completa', summary: 'Bucle de entrenamiento, mini-lotes, inicialización y optimizadores', emoji: '🏋️', commands: ['época', 'mini-batch', 'inicialización de pesos', 'SGD con momento', 'Adam', 'MLPClassifier'], minutes: 17 }, [
      learn(
        'El bucle de entrenamiento',
        `
Ya tienes todas las piezas. Entrenar una red es repetir cuatro pasos hasta que la pérdida deja de bajar:

1. **Hacia delante**: calcular las predicciones con los pesos actuales.
2. **Pérdida**: medir el error.
3. **Hacia atrás**: calcular los gradientes de todos los pesos.
4. **Actualizar**: \`w ← w − η · ∂L/∂w\`, con \`η\` la **tasa de aprendizaje**.

Cada pasada completa por los datos es una **época**. Los pesos empiezan **aleatorios y pequeños**; los sesgos pueden empezar a 0.

En el ejemplo siguiente una red 2-8-1 (capa oculta \`tanh\`, salida sigmoide) aprende a separar dos medias lunas entrelazadas, algo que ninguna recta (ni una regresión logística) puede hacer.
`,
        '🏋️',
      ),
      pyDemo(
        'Una red desde cero aprende las dos lunas',
        [
          [`${LUNAS}rng = np.random.RandomState(1)\nW1 = rng.randn(2, 8) * 0.5; b1 = np.zeros((1, 8))\nW2 = rng.randn(8, 1) * 0.5; b2 = np.zeros((1, 1))\nlr = 0.5\n\nfor epoca in range(1001):\n    # 1-2: hacia delante y pérdida\n    A1 = np.tanh(X @ W1 + b1)\n    A2 = 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n    perdida = -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n    if epoca % 200 == 0:\n        print(epoca, round(float(perdida), 4), round(float(((A2 > 0.5) == y).mean()), 3))\n    # 3: hacia atrás\n    dZ2 = (A2 - y) / len(X)\n    dW2 = A1.T @ dZ2; db2 = dZ2.sum(axis=0, keepdims=True)\n    dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\n    dW1 = X.T @ dZ1; db1 = dZ1.sum(axis=0, keepdims=True)\n    # 4: actualizar\n    W1 -= lr * dW1; b1 -= lr * db1; W2 -= lr * dW2; b2 -= lr * db2`, 'La pérdida baja de 0.81 a 0.09 y el acierto sube del 31 % (peor que el azar) al 96.5 %. Son 30 líneas y no usan ninguna librería de aprendizaje profundo'],
        ],
      ),
      illus('ia-train-net', 'Entrena tú la red', 'Pulsa "50 épocas" varias veces y mira cómo la frontera se curva. Prueba con 1 neurona oculta, con más, y con una tasa de aprendizaje muy alta.'),
      learn(
        'Inicialización, épocas y mini-lotes',
        `
**Inicialización.** Si pones todos los pesos a **0**, todas las neuronas de una capa calculan lo mismo y reciben el mismo gradiente: son clones para siempre (**problema de simetría**). Por eso se inicializan al azar. La escala importa: demasiado grande satura las activaciones; demasiado pequeña desvanece la señal. **He** (\`√(2/entradas)\`, para ReLU) y **Xavier** (\`√(1/entradas)\`, para tanh/sigmoide) la ajustan al tamaño de la capa.

**Mini-lotes.** Calcular el gradiente con *todos* los datos en cada paso es lento y con *uno solo* es ruidoso. Lo habitual es un **mini-lote** de 32 a 256 ejemplos: se barajan los datos al inicio de cada época y se da un paso por lote. Una época con 200 ejemplos y lotes de 32 son 7 actualizaciones. El ruido ayuda incluso a salir de malos mínimos.
`,
        '🎲',
      ),
      pyDemo(
        'Con mini-lotes de 32',
        [
          [`${LUNAS}rng = np.random.RandomState(1)\nW1 = rng.randn(2, 8) * 0.5; b1 = np.zeros((1, 8))\nW2 = rng.randn(8, 1) * 0.5; b2 = np.zeros((1, 1))\nlr = 0.5\n\nfor epoca in range(101):\n    orden = rng.permutation(len(X))            # barajar en cada época\n    for i in range(0, len(X), 32):\n        idx = orden[i:i + 32]\n        xb, yb = X[idx], y[idx]\n        A1 = np.tanh(xb @ W1 + b1); A2 = 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n        dZ2 = (A2 - yb) / len(xb)\n        dW2 = A1.T @ dZ2; db2 = dZ2.sum(axis=0, keepdims=True)\n        dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\n        dW1 = xb.T @ dZ1; db1 = dZ1.sum(axis=0, keepdims=True)\n        W1 -= lr * dW1; b1 -= lr * db1; W2 -= lr * dW2; b2 -= lr * db2\n    if epoca % 25 == 0:\n        A2 = 1 / (1 + np.exp(-(np.tanh(X @ W1 + b1) @ W2 + b2)))\n        print(epoca, round(float(-np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))), 4), round(float(((A2 > 0.5) == y).mean()), 3))`, 'Con 7 actualizaciones por época, en solo 100 épocas se llega al 96.5 % que con el lote completo se alcanzó hacia la época 600: más pasos, y cada uno más barato'],
        ],
      ),
      pyOut('¿Qué imprime?', 'n, lote = 250, 64\nprint(-(-n // lote), n // lote)', ['3 4', '4 4', '3 3'], 'Con 250 ejemplos y lotes de 64 hay 3 lotes completos y uno parcial de 58: 4 actualizaciones por época. `-(-n // lote)` es una división entera "hacia arriba".'),
      tf('Inicializar todos los pesos de una capa a cero es una buena idea porque así parten de un punto neutro.', false, 'Todas las neuronas de la capa serían idénticas y recibirían siempre el mismo gradiente: nunca se diferenciarían (problema de simetría). Hay que romperla con pesos aleatorios.'),
      learn(
        'Optimizadores: bajar mejor la montaña',
        `
El descenso del gradiente simple (**SGD**) da pasos proporcionales al gradiente. En un *valle estrecho* (muy empinado en un eje, casi plano en otro) rebota de pared a pared y avanza lentísimo hacia el fondo. Dos mejoras:

- **Momento**: acumula una "velocidad" \`v = μ·v − η·g\` (μ ≈ 0.9). Los componentes que se repiten paso tras paso se refuerzan; los que oscilan se cancelan.
- **Adam**: guarda además una media del gradiente² para **adaptar el paso a cada parámetro** (pasos grandes donde el gradiente es pequeño y viceversa). Combina las dos ideas y es la opción por defecto de casi todo el aprendizaje profundo, con \`η ≈ 0.001\`.

Ningún optimizador te libra de elegir bien la **tasa de aprendizaje**: demasiado alta, diverge; demasiado baja, no llega.
`,
        '⛰️',
      ),
      illus('ia-optimizers', 'La carrera de los optimizadores', 'Cambia la tasa de aprendizaje y los pasos. Sube la tasa hasta que SGD diverja.'),
      pyDemo(
        'SGD, momento y Adam en un valle',
        [
          ['import numpy as np\n\n# f(x, y) = 0.5 * (x**2 + 25 * y**2): estrecho en y, ancho en x\ndef grad(p): return np.array([p[0], 25 * p[1]])\ndef f(p): return 0.5 * (p[0] ** 2 + 25 * p[1] ** 2)\n\ndef sgd(lr, pasos, momento=0.0):\n    p = np.array([4.0, 1.0]); v = np.zeros(2)\n    for _ in range(pasos):\n        v = momento * v - lr * grad(p)\n        p = p + v\n    return p\n\ndef adam(lr, pasos, b1=0.9, b2=0.999, eps=1e-8):\n    p = np.array([4.0, 1.0]); m = np.zeros(2); s = np.zeros(2)\n    for t in range(1, pasos + 1):\n        g = grad(p)\n        m = b1 * m + (1 - b1) * g\n        s = b2 * s + (1 - b2) * g ** 2\n        mh = m / (1 - b1 ** t); sh = s / (1 - b2 ** t)\n        p = p - lr * mh / (np.sqrt(sh) + eps)\n    return p\n\nprint("SGD", round(float(f(sgd(0.03, 100))), 5))\nprint("momento", round(float(f(sgd(0.03, 100, 0.9))), 5))\nprint("Adam", round(float(f(adam(0.3, 100))), 5))', 'Tras 100 pasos SGD queda en 0.018; el momento llega a 0.00008 y Adam a 0.00005: más de 200 veces mejor con el mismo número de pasos'],
          ['for lr in [0.01, 0.03, 0.07, 0.081]:\n    print(lr, round(float(f(sgd(lr, 50))), 4))', 'La tasa es crítica: 0.07 casi converge, pero 0.081 hace que SGD diverja (la pérdida sube a 147 en lugar de bajar)'],
        ],
      ),
      pyDemo(
        'Lo mismo con scikit-learn',
        [
          ['from sklearn.datasets import make_moons\nfrom sklearn.neural_network import MLPClassifier\n\nXm, ym = make_moons(200, noise=0.2, random_state=0)\nmlp = MLPClassifier(hidden_layer_sizes=(8,), activation="tanh", learning_rate_init=0.05, max_iter=1000, random_state=0).fit(Xm, ym)\nprint(round(float(mlp.score(Xm, ym)), 3), mlp.n_iter_, round(float(mlp.loss_), 4))\nprint([w.shape for w in mlp.coefs_])', '`MLPClassifier` hace por dentro lo que has programado (Adam, mini-lotes, entropía cruzada): 97.5 % en 285 épocas, con pesos de formas (2, 8) y (8, 1)'],
        ],
      ),
      multi('¿Qué puede ocurrir si la tasa de aprendizaje es demasiado alta?', ['La pérdida sube o oscila en vez de bajar', 'El entrenamiento diverge (aparecen valores enormes o NaN)', 'La red aprende más rápido sin ningún riesgo', 'Los pasos se pasan de largo del mínimo'], [0, 1, 3], 'Con pasos demasiado grandes el descenso salta de un lado a otro del valle e incluso se aleja. Un valor muy bajo, en cambio, aprende despacio; no hay una tasa universal.'),
      pyPractice({
        goal: 'Un paso de descenso',
        prompt: 'Escribe `sgd_paso(params, grads, lr)`, que reciba una **lista** de arrays de parámetros y otra de sus gradientes, y devuelva una lista nueva con cada `p − lr·g`.',
        starter: 'import numpy as np\n\ndef sgd_paso(params, grads, lr):\n    pass\n',
        check: calls([
          ['[a.round(6).tolist() for a in sgd_paso([np.array([1.0, 2.0])], [np.array([0.5, -1.0])], 0.1)]', '[[0.95, 2.1]]'],
          ['[a.tolist() for a in sgd_paso([np.array([1.0]), np.array([[3.0, 4.0]])], [np.array([2.0]), np.array([[1.0, 1.0]])], 0.5)]', '[[0.0], [[2.5, 3.5]]]'],
        ]),
        solution: 'import numpy as np\n\ndef sgd_paso(params, grads, lr):\n    return [p - lr * g for p, g in zip(params, grads)]\n',
        hints: ['Recorre ambas listas a la vez con `zip(params, grads)`.', 'Una lista por comprensión: `[p - lr * g for p, g in zip(params, grads)]`.'],
        explain: 'Esta función de una línea es todo `torch.optim.SGD.step()`. Los optimizadores solo cambian cómo transforman el gradiente antes de restarlo.',
        commands: ['SGD con momento', 'época'],
      }),
      pyPractice({
        goal: 'Entrena la red del XOR',
        prompt: 'Ya tienes `hacia_delante` y `gradientes` (que devuelve `dW1, db1, dW2, db2`). Escribe el bucle de **2000 épocas** con tasa **0.5** que actualice los cuatro parámetros. Al terminar, la red debe acertar XOR (`A2 > 0.5` igual a `y`) con una pérdida menor que 0.05.',
        starter: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\ny = np.array([[0], [1], [1], [0]], dtype=float)\nrng = np.random.RandomState(0)\nW1 = rng.randn(2, 4); b1 = np.zeros((1, 4))\nW2 = rng.randn(4, 1); b2 = np.zeros((1, 1))\n\ndef hacia_delante(X, W1, b1, W2, b2):\n    A1 = np.tanh(X @ W1 + b1)\n    return A1, 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n\ndef gradientes(X, y, W1, b1, W2, b2):\n    A1, A2 = hacia_delante(X, W1, b1, W2, b2)\n    dZ2 = (A2 - y) / len(X)\n    dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\n    return X.T @ dZ1, dZ1.sum(axis=0, keepdims=True), A1.T @ dZ2, dZ2.sum(axis=0, keepdims=True)\n\n# TU CÓDIGO: el bucle de entrenamiento\n\nA2 = hacia_delante(X, W1, b1, W2, b2)[1]\nperdida = -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n',
        check: all(truthy('perdida < 0.05'), variable('bool(((A2 > 0.5) == y).all())', 'True')),
        solution: 'import numpy as np\n\nX = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=float)\ny = np.array([[0], [1], [1], [0]], dtype=float)\nrng = np.random.RandomState(0)\nW1 = rng.randn(2, 4); b1 = np.zeros((1, 4))\nW2 = rng.randn(4, 1); b2 = np.zeros((1, 1))\n\ndef hacia_delante(X, W1, b1, W2, b2):\n    A1 = np.tanh(X @ W1 + b1)\n    return A1, 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n\ndef gradientes(X, y, W1, b1, W2, b2):\n    A1, A2 = hacia_delante(X, W1, b1, W2, b2)\n    dZ2 = (A2 - y) / len(X)\n    dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\n    return X.T @ dZ1, dZ1.sum(axis=0, keepdims=True), A1.T @ dZ2, dZ2.sum(axis=0, keepdims=True)\n\nfor epoca in range(2000):\n    dW1, db1, dW2, db2 = gradientes(X, y, W1, b1, W2, b2)\n    W1 -= 0.5 * dW1; b1 -= 0.5 * db1; W2 -= 0.5 * dW2; b2 -= 0.5 * db2\n\nA2 = hacia_delante(X, W1, b1, W2, b2)[1]\nperdida = -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n',
        hints: ['Dentro de `for epoca in range(2000):` llama a `gradientes(...)` y desempaqueta `dW1, db1, dW2, db2`.', 'Actualiza con `W1 -= 0.5 * dW1`, igual con `b1`, `W2` y `b2`.'],
        explain: 'Una red 2-4-1 aprende XOR, el problema que una neurona no podía. Sin el bucle, la pérdida ronda 0.7 (azar); tras 2000 épocas baja a ~0.003. Eso es entrenar: el resto es escala.',
        commands: ['época', 'retropropagación'],
      }),
      pyPractice({
        goal: 'Un paso de Adam',
        prompt: 'Escribe `adam_paso(w, g, m, s, t, lr=0.3)` con `β₁ = 0.9`, `β₂ = 0.999`, `ε = 1e-8`: actualiza `m` y `s`, corrige el sesgo con `1 − β^t` y devuelve la tupla `(w_nuevo, m, s)`.',
        starter: 'import numpy as np\n\ndef adam_paso(w, g, m, s, t, lr=0.3):\n    pass\n',
        check: calls([['[v.round(4).tolist() for v in adam_paso(np.array([4.0, 1.0]), np.array([4.0, 25.0]), np.zeros(2), np.zeros(2), 1)]', '[[3.7, 0.7], [0.4, 2.5], [0.016, 0.625]]']]),
        solution: 'import numpy as np\n\ndef adam_paso(w, g, m, s, t, lr=0.3):\n    m = 0.9 * m + 0.1 * g\n    s = 0.999 * s + 0.001 * g ** 2\n    mh = m / (1 - 0.9 ** t)\n    sh = s / (1 - 0.999 ** t)\n    w = w - lr * mh / (np.sqrt(sh) + 1e-8)\n    return w, m, s\n',
        hints: ['`m = 0.9 * m + 0.1 * g` y `s = 0.999 * s + 0.001 * g ** 2`.', 'Corrige con `mh = m / (1 - 0.9 ** t)` y `sh = s / (1 - 0.999 ** t)`; el paso es `lr * mh / (np.sqrt(sh) + 1e-8)`.'],
        explain: 'En el primer paso Adam mueve ambos ejes exactamente `lr` (0.3), aunque un gradiente sea 4 y el otro 25: normaliza por la magnitud. Por eso se comporta tan bien en valles con escalas muy distintas.',
        commands: ['Adam', 'SGD con momento'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: tu red neuronal desde cero',
    prompt:
      'Entrena una red **2-12-1** (capa oculta `tanh`, salida sigmoide, entropía cruzada) sobre dos lunas, usando solo NumPy.\n\nYa tienes los datos separados en entrenamiento y prueba, los pesos iniciales, `adelante(X)` y `perdida_de(X, y)`.\n\n1. Escribe el bucle de **1500 épocas** con tasa `0.5` (retropropagación incluida).\n2. En la **primera época**, antes de actualizar, comprueba el gradiente de `W1[0, 0]` con la diferencia centrada (ε = 1e-6) y guarda en `err_grad` la diferencia relativa `|num − ana| / (|num| + |ana|)`.\n3. Al terminar guarda `perdida_final` (pérdida en entrenamiento) y `acc_test` (exactitud en prueba).',
    starter:
      'import numpy as np\nfrom sklearn.datasets import make_moons\nfrom sklearn.model_selection import train_test_split\n\nX, y = make_moons(300, noise=0.25, random_state=0)\nXtr, Xte, ytr, yte = train_test_split(X, y.reshape(-1, 1), test_size=0.3, random_state=0)\n\nrng = np.random.RandomState(0)\nW1 = rng.randn(2, 12) * 0.5; b1 = np.zeros((1, 12))\nW2 = rng.randn(12, 1) * 0.5; b2 = np.zeros((1, 1))\n\ndef adelante(X):\n    A1 = np.tanh(X @ W1 + b1)\n    return A1, 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n\ndef perdida_de(X, y):\n    A2 = adelante(X)[1]\n    return -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n\nlr = 0.5\nerr_grad = perdida_final = acc_test = None\n\n# TU CÓDIGO: bucle de 1500 épocas con comprobación de gradiente en la primera\n',
    check: all(truthy('err_grad < 1e-6'), truthy('perdida_final < 0.3'), truthy('acc_test >= 0.9'), variable('W1.shape', '(2, 12)')),
    solution:
      'import numpy as np\nfrom sklearn.datasets import make_moons\nfrom sklearn.model_selection import train_test_split\n\nX, y = make_moons(300, noise=0.25, random_state=0)\nXtr, Xte, ytr, yte = train_test_split(X, y.reshape(-1, 1), test_size=0.3, random_state=0)\n\nrng = np.random.RandomState(0)\nW1 = rng.randn(2, 12) * 0.5; b1 = np.zeros((1, 12))\nW2 = rng.randn(12, 1) * 0.5; b2 = np.zeros((1, 1))\n\ndef adelante(X):\n    A1 = np.tanh(X @ W1 + b1)\n    return A1, 1 / (1 + np.exp(-(A1 @ W2 + b2)))\n\ndef perdida_de(X, y):\n    A2 = adelante(X)[1]\n    return -np.mean(y * np.log(A2) + (1 - y) * np.log(1 - A2))\n\nlr = 0.5\nerr_grad = perdida_final = acc_test = None\n\nfor epoca in range(1500):\n    A1, A2 = adelante(Xtr)\n    dZ2 = (A2 - ytr) / len(Xtr)\n    dW2 = A1.T @ dZ2; db2 = dZ2.sum(axis=0, keepdims=True)\n    dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)\n    dW1 = Xtr.T @ dZ1; db1 = dZ1.sum(axis=0, keepdims=True)\n    if epoca == 0:\n        eps = 1e-6\n        W1[0, 0] += eps; lp = perdida_de(Xtr, ytr)\n        W1[0, 0] -= 2 * eps; lm = perdida_de(Xtr, ytr)\n        W1[0, 0] += eps\n        num = (lp - lm) / (2 * eps)\n        err_grad = abs(num - dW1[0, 0]) / (abs(num) + abs(dW1[0, 0]))\n    W1 -= lr * dW1; b1 -= lr * db1; W2 -= lr * dW2; b2 -= lr * db2\n\nperdida_final = perdida_de(Xtr, ytr)\nacc_test = ((adelante(Xte)[1] > 0.5) == yte).mean()\n',
    hints: [
      'Dentro del bucle: `A1, A2 = adelante(Xtr)`, `dZ2 = (A2 - ytr) / len(Xtr)`, y de ahí `dW2`, `db2`, `dZ1 = (dZ2 @ W2.T) * (1 - A1 ** 2)`, `dW1`, `db1`.',
      'Para la comprobación, en `epoca == 0`: suma y resta `eps` a `W1[0, 0]` (restaurándolo después) y calcula `perdida_de(Xtr, ytr)` en cada caso.',
      'Actualiza con `W1 -= lr * dW1` (y lo mismo con `b1`, `W2`, `b2`). Al final `acc_test = ((adelante(Xte)[1] > 0.5) == yte).mean()`.',
    ],
    explain:
      'Has construido, comprobado y entrenado una red neuronal sin librerías de aprendizaje profundo: propagación hacia delante, entropía cruzada, retropropagación verificada con derivadas numéricas y descenso del gradiente. La red generaliza (≈ 95 % en datos que no vio). En la siguiente zona haces lo mismo con PyTorch, que calcula los gradientes por ti con autograd, y construyes redes convolucionales y recurrentes.',
    commands: ['retropropagación', 'comprobación de gradientes', 'época', 'entropía cruzada'],
  },
});

void [order];
