import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, calls, truthy, variable } from './iabuild';

/** Los 1 797 dígitos 8×8 de scikit-learn, escalados a [0, 1] y repartidos en entrenamiento / prueba (tensores float32). */
const DIGITOS = `import torch
from torch import nn
from sklearn.datasets import load_digits
from sklearn.model_selection import train_test_split

torch.manual_seed(0)
X, y = load_digits(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X / 16.0, y, test_size=0.25, random_state=0, stratify=y)
Xtr = torch.tensor(Xtr, dtype=torch.float32).reshape(-1, 1, 8, 8)
Xte = torch.tensor(Xte, dtype=torch.float32).reshape(-1, 1, 8, 8)
ytr = torch.tensor(ytr)
yte = torch.tensor(yte)
`;

export const ia9 = iaWorld({
  id: 'ia9',
  index: 9,
  title: 'Deep learning práctico',
  subtitle: 'PyTorch: tensores, autograd, CNN, secuencias y regularización',
  emoji: '🔥',
  color: '#F43F5E',
  level: 'avanzado',
  intro:
    'En la zona anterior construiste una red con NumPy y calculaste a mano cada gradiente. En la práctica se usa **PyTorch**, que hace exactamente lo mismo pero con **tensores** (arrays con superpoderes), **autograd** (la retropropagación automática) y módulos listos para usar. Aquí aprenderás a manejar tensores, escribir el bucle de entrenamiento, construir **redes convolucionales** para imágenes y **LSTM** para secuencias, y a evitar el sobreajuste con **dropout, decaimiento de pesos, parada temprana** y **transfer learning**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia9-1', { title: 'Tensores: el array de PyTorch', summary: 'Formas, tipos, operaciones y los errores más típicos', emoji: '🧊', commands: ['torch.tensor', 'tensor.reshape', 'broadcasting'], minutes: 14 }, [
      learn(
        'Un tensor es un array con autograd',
        `
Un **tensor** es un array de números de cualquier número de dimensiones, igual que un \`ndarray\` de NumPy, con dos extras: puede vivir en una **GPU** y puede registrar las operaciones para calcular **derivadas automáticamente**.

Su **forma** (\`shape\`) cuenta cuántos elementos hay en cada dimensión:

| Datos | Forma | Dimensiones |
|---|---|---|
| un número | \`()\` | 0 |
| un vector | \`(n,)\` | 1 |
| una matriz (tabla) | \`(filas, columnas)\` | 2 |
| una imagen en color | \`(canales, alto, ancho)\` | 3 |
| un **lote** de imágenes | \`(lote, canales, alto, ancho)\` | 4 |
| un lote de texto | \`(lote, palabras, características)\` | 3 |

La primera dimensión casi siempre es el **lote** (*batch*): cuántos ejemplos procesas a la vez. La mayoría de errores de PyTorch son formas que no encajan, así que conviene acostumbrarse a seguirlas con los ojos.
`,
        '🧊',
      ),
      illus('ia-tensor-shapes', 'Juega con las formas', 'Parte de una imagen, un lote o un texto y aplica operaciones. Prueba también las que provocan un error.'),
      pyDemo(
        'Crear tensores y mirar sus atributos',
        [
          ['import torch\n\na = torch.tensor([[1., 2., 3.], [4., 5., 6.]])\nprint(a)\nprint(a.shape, a.dtype, a.ndim)\nprint(torch.zeros(2, 3).shape, torch.arange(6).reshape(2, 3).tolist())', 'Una lista de decimales da `float32`, el tipo habitual en redes. `arange` de enteros da `int64`'],
        ],
      ),
      mc('Un lote de 16 fotos en color de 64×64 píxeles tiene la forma…', ['(16, 64, 64)', '(16, 3, 64, 64)', '(3, 16, 64, 64)', '(64, 64, 3, 16)'], 1, '(lote, canales, alto, ancho): 16 imágenes, 3 canales (rojo, verde, azul) de 64×64. PyTorch usa el orden "canales primero".'),
      learn(
        'Operaciones: casi todo lo que sabes de NumPy',
        `
Los tensores se manejan casi igual que los arrays de NumPy: operaciones elemento a elemento, **broadcasting**, \`@\` para multiplicar matrices, reducciones con \`dim\` (\`sum(dim=0)\` suma a lo largo de las filas), indexado con cortes y máscaras.

Cambios de forma que usarás a diario:
- \`reshape(…)\` / \`view(…)\`: reorganiza los mismos datos (un \`-1\` significa "calcúlalo").
- \`unsqueeze(d)\` / \`squeeze()\`: añade o quita dimensiones de tamaño 1.
- \`flatten(1)\`: aplana todo salvo el lote.
- \`permute(…)\` / \`transpose(a, b)\`: reordena dimensiones.
`,
        '🔧',
      ),
      pyDemo(
        'Operaciones con tensores',
        [
          ['import torch\n\na = torch.tensor([[1., 2., 3.], [4., 5., 6.]])\nb = torch.tensor([10., 20., 30.])\nprint(a + b)                 # broadcasting: b se suma a cada fila\nprint(a @ a.T)               # producto de matrices (2×3 por 3×2)\nprint(a.sum(dim=0), a.mean(dim=1))\nprint(a[:, 1], a[a > 3])', '`sum(dim=0)` colapsa las filas (una suma por columna); `mean(dim=1)`, las columnas (una media por fila)'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import torch\nx = torch.arange(12).reshape(3, 4)\nprint(x.sum(dim=0).tolist(), x[:, 1:3].shape)', ['[6, 22, 38] torch.Size([3, 2])', '[12, 15, 18, 21] torch.Size([3, 4])', '[12, 15, 18, 21] torch.Size([2, 3])'], '`sum(dim=0)` suma por columnas: 0+4+8=12, 1+5+9=15… `x[:, 1:3]` conserva las 3 filas y toma las columnas 1 y 2: forma (3, 2).'),
      learn(
        'Tipos de dato: la fuente de errores clásica',
        `
Cada tensor tiene un \`dtype\`. Los importantes:

- **\`float32\`**: el tipo de los pesos y de los datos de entrada de las redes.
- **\`int64\`** (\`long\`): índices y etiquetas de clase.
- **\`float64\`**: lo que sale de un \`ndarray\` de NumPy de decimales.

Reglas útiles: una lista de decimales da \`float32\`, una de enteros \`int64\`, y un array de NumPy conserva su tipo (\`float64\`). Al sumar un \`float32\` con un \`float64\` el resultado es \`float64\`, pero **multiplicar matrices** (\`@\`, \`nn.Linear\`) con tipos distintos **da error**. Se arregla con \`.float()\`, \`.long()\` o \`dtype=torch.float32\`.
`,
        '🧬',
      ),
      pyDemo(
        'El error de los tipos distintos',
        [
          ['import numpy as np\nimport torch\n\na = torch.ones(2, 2)\nn = torch.tensor(np.ones((2, 2)))        # viene de NumPy: float64\nprint(a.dtype, n.dtype, (a + n).dtype)\ntry:\n    a @ n\nexcept RuntimeError as e:\n    print("Error:", e)\nprint((a @ n.float()).dtype)', 'La suma promociona a `float64`, pero `@` exige el mismo tipo. `n.float()` lo convierte a `float32` y el error desaparece'],
        ],
      ),
      tf('Un tensor `float32` y un tensor `float64` se pueden multiplicar con `@` sin problema.', false, 'La multiplicación de matrices exige el mismo `dtype`: `RuntimeError: expected m1 and m2 to have the same dtype, but got: float != double`. Convierte uno con `.float()` o `.double()`.'),
      match('Une cada dato con la forma de su tensor:', [['Una imagen RGB de 32×32', '(3, 32, 32)'], ['Una tabla con 100 filas y 4 columnas', '(100, 4)'], ['10 imágenes en gris de 28×28 con canal', '(10, 1, 28, 28)'], ['Las 100 etiquetas de clase', '(100,)']], 'Fíjate en que el canal va antes del alto y ancho, y en que un vector de etiquetas tiene una sola dimensión.'),
      pyPractice({
        goal: 'Normaliza un lote',
        prompt: '`X` es un tensor de **enteros**. Conviértelo a decimales y guarda en `Z` el tensor estandarizado **por columnas**: `(X − media) / desviación` con `mean(dim=0)` y `std(dim=0)`.',
        starter: 'import torch\n\nX = torch.tensor([[1, 10], [2, 20], [3, 60], [6, 30]])\nZ = None\n',
        check: all(variable('tuple(Z.shape)', '(4, 2)'), truthy('Z.mean(dim=0).abs().max().item() < 1e-6'), truthy('abs(Z.std(dim=0)[0].item() - 1) < 1e-5')),
        solution: 'import torch\n\nX = torch.tensor([[1, 10], [2, 20], [3, 60], [6, 30]])\nXf = X.float()\nZ = (Xf - Xf.mean(dim=0)) / Xf.std(dim=0)\n',
        hints: ['`mean` y `std` no funcionan con enteros: usa `X.float()` primero.', '`Xf.mean(dim=0)` da una media por columna y el broadcasting la resta de cada fila.'],
        explain: 'Es el mismo `StandardScaler` que ya conoces, ahora con tensores. Por columnas significa `dim=0`: se colapsan las filas y quedan los estadísticos de cada característica.',
        commands: ['torch.tensor', 'broadcasting'],
      }),
      pyPractice({
        goal: 'Prepara un lote de imágenes',
        prompt: '`imgs` tiene 32 imágenes en gris de 28×28 **sin** dimensión de canal. Guarda en `con_canal` la versión `(32, 1, 28, 28)` (para una CNN) y en `plano` la versión `(32, 784)` (para una red densa).',
        starter: 'import torch\n\nimgs = torch.zeros(32, 28, 28)\ncon_canal = plano = None\n',
        check: all(variable('tuple(con_canal.shape)', '(32, 1, 28, 28)'), variable('tuple(plano.shape)', '(32, 784)')),
        solution: 'import torch\n\nimgs = torch.zeros(32, 28, 28)\ncon_canal = imgs.unsqueeze(1)\nplano = imgs.reshape(32, -1)\n',
        hints: ['`unsqueeze(1)` añade una dimensión de tamaño 1 en la posición 1.', '`reshape(32, -1)` deja el lote y aplana el resto (el -1 se calcula: 28·28 = 784).'],
        explain: 'Las CNN piden `(N, C, H, W)`; las capas densas piden `(N, características)`. Pasar de una a otra es cuestión de `unsqueeze` y `reshape`/`flatten`.',
        commands: ['tensor.reshape', 'torch.tensor'],
      }),
      pyPractice({
        goal: 'Exactitud de un lote',
        prompt: 'Cada fila de `logits` son las puntuaciones de 3 clases para un ejemplo. Guarda en `prediccion` la clase ganadora de cada fila (`argmax`) y en `acc` la **proporción de aciertos** (un número) comparando con `etiquetas`.',
        starter: 'import torch\n\nlogits = torch.tensor([[2.0, 0.1, 0.3], [0.2, 1.5, 0.1], [0.1, 0.2, 3.0], [1.0, 0.9, 0.8], [0.3, 0.2, 0.1]])\netiquetas = torch.tensor([0, 1, 1, 0, 2])\nprediccion = acc = None\n',
        check: all(variable('prediccion.tolist()', '[0, 1, 2, 0, 0]'), truthy('abs(float(acc) - 0.6) < 1e-6')),
        solution: 'import torch\n\nlogits = torch.tensor([[2.0, 0.1, 0.3], [0.2, 1.5, 0.1], [0.1, 0.2, 3.0], [1.0, 0.9, 0.8], [0.3, 0.2, 0.1]])\netiquetas = torch.tensor([0, 1, 1, 0, 2])\nprediccion = logits.argmax(dim=1)\nacc = (prediccion == etiquetas).float().mean().item()\n',
        hints: ['`logits.argmax(dim=1)` devuelve la columna del máximo de cada fila.', '`(prediccion == etiquetas)` es booleano; `.float().mean()` lo convierte en la proporción de `True`.'],
        explain: 'Esta línea (`(pred == y).float().mean()`) es la exactitud que calcularás al final de cada época de cualquier entrenamiento. 3 de 5 ⇒ 0.6.',
        commands: ['torch.tensor'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia9-2', { title: 'Autograd: derivadas automáticas', summary: 'requires_grad, backward(), .grad y no_grad', emoji: '♻️', commands: ['autograd', 'torch.no_grad', 'descenso del gradiente'], minutes: 14 }, [
      learn(
        'Adiós a las derivadas a mano',
        `
En la zona anterior escribiste las derivadas de cada capa. **Autograd** lo hace por ti: cuando un tensor se crea con \`requires_grad=True\`, PyTorch anota cada operación que lo toca en un **grafo de cálculo**. Al llamar a \`loss.backward()\` recorre ese grafo hacia atrás aplicando la regla de la cadena y deja el resultado en \`w.grad\`.

\`\`\`python
w = torch.tensor(2.0, requires_grad=True)
loss = (3 * w - 6) ** 2
loss.backward()
w.grad           # 6 · (3w − 6) = 0 en w = 2
\`\`\`

Tres reglas que conviene grabarse:
1. \`.grad\` solo existe en los tensores "hoja" que tú creaste con \`requires_grad=True\` (los **parámetros**).
2. \`.grad\` **se acumula**: cada \`backward()\` suma al valor anterior. Hay que ponerlo a cero entre iteraciones.
3. Al evaluar, se desactiva el grafo con \`with torch.no_grad():\` (más rápido y sin memoria extra).
`,
        '♻️',
      ),
      pyDemo(
        'Tu primera derivada automática',
        [
          ['import torch\n\nx = torch.tensor(2.0, requires_grad=True)\ny = x ** 3 + 2 * x\nprint(y)\ny.backward()\nprint(x.grad)', 'El resultado lleva `grad_fn=<AddBackward0>`: recuerda cómo se calculó. La derivada 3x² + 2 en x = 2 vale 14'],
        ],
      ),
      illus('ia-autograd', 'El laboratorio de .grad', 'Pulsa en orden: loss, backward, step. Luego repite backward sin poner a cero para ver cómo se acumula.'),
      mc('Con `x = 4.0` (requires_grad), ¿qué vale `x.grad` tras `y = 3 * x ** 2; y.backward()`?', ['12.0', '24.0', '48.0', '6.0'], 1, 'dy/dx = 6x, que en x = 4 vale 24.'),
      pyDemo(
        'El gradiente se acumula',
        [
          ['import torch\n\nw = torch.tensor([1.0, 2.0], requires_grad=True)\nfor i in range(2):\n    (w * w).sum().backward()\n    print(w.grad)          # d/dw de w² = 2w\nw.grad.zero_()\n(w * w).sum().backward()\nprint(w.grad)', 'El segundo `backward()` SUMA: de [2, 4] a [4, 8]. Tras `zero_()` vuelve a [2, 4]'],
          ['with torch.no_grad():\n    z = w * 2\nprint(z.requires_grad, (w * 2).requires_grad)', 'Dentro de `no_grad` no se construye grafo: el resultado ya no lleva gradientes'],
        ],
      ),
      tf('Cada llamada a `backward()` reemplaza el valor anterior de `.grad`.', false, 'Los gradientes se acumulan (se suman). Por eso el bucle de entrenamiento empieza siempre con `optimizer.zero_grad()`.'),
      learn(
        'Descenso del gradiente con autograd',
        `
Con autograd se puede entrenar sin ninguna capa de \`nn\`: un parámetro, una pérdida y un bucle. La actualización \`w -= lr * w.grad\` modifica un tensor que requiere gradiente, así que se hace **dentro de \`torch.no_grad()\`** (si no, PyTorch intentaría derivar también la propia actualización y se negaría: *"a leaf Variable that requires grad is being used in an in-place operation"*).
`,
        '📉',
      ),
      pyDemo(
        'Ajustar y = 3x + 2 a mano',
        [
          ['import torch\n\nx = torch.linspace(-1, 1, 20)\ny = 3 * x + 2\nw = torch.tensor(0.0, requires_grad=True)\nb = torch.tensor(0.0, requires_grad=True)\n\nfor paso in range(200):\n    pred = w * x + b\n    loss = ((pred - y) ** 2).mean()\n    loss.backward()\n    with torch.no_grad():\n        w -= 0.1 * w.grad\n        b -= 0.1 * b.grad\n    w.grad.zero_()\n    b.grad.zero_()\nprint(round(w.item(), 2), round(b.item(), 2))', 'Con solo autograd y 10 líneas la recta aprende los valores correctos: w = 3 y b = 2'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import torch\nx = torch.tensor(3.0, requires_grad=True)\ny = x ** 2\ny.backward()\nprint(x.grad.item(), y.item())', ['9.0 6.0', '6.0 6.0', '3.0 9.0'], 'y = x² vale 9 en x = 3 y su derivada 2x vale 6: `x.grad` = 6.0 e `y` = 9.0.'),
      pyPractice({
        goal: 'Derivada con autograd',
        prompt: 'Con `x = 2.0` (que requiere gradiente), calcula `f = x³ − 2x`, llama a `backward()` y guarda en `grad` la derivada como número normal de Python (`.item()`).',
        starter: 'import torch\n\nx = torch.tensor(2.0, requires_grad=True)\nf = None\ngrad = None\n',
        check: truthy('abs(float(grad) - 10.0) < 1e-6'),
        solution: 'import torch\n\nx = torch.tensor(2.0, requires_grad=True)\nf = x ** 3 - 2 * x\nf.backward()\ngrad = x.grad.item()\n',
        hints: ['`f = x ** 3 - 2 * x`.', 'Después `f.backward()` y lee `x.grad.item()`.'],
        explain: 'f′(x) = 3x² − 2 = 10 en x = 2. Cambia la función por cualquier otra, por complicada que sea, y autograd seguirá dando la derivada exacta.',
        commands: ['autograd'],
      }),
      pyPractice({
        goal: 'Gradiente de una neurona',
        prompt: 'Calcula la salida de una neurona sigmoide `a = σ(x·w + b)`, su entropía cruzada binaria con la verdad `y = 1` y llama a `backward()`. Guarda en `gw` y `gb` los gradientes de `w` y de `b` (los tensores `.grad`).',
        starter: 'import torch\n\nx = torch.tensor([1.0, 2.0])\nw = torch.tensor([0.5, -0.3], requires_grad=True)\nb = torch.tensor(0.1, requires_grad=True)\ny = 1.0\ngw = gb = None\n',
        check: all(truthy('abs(gw[0].item() + 0.5) < 1e-5'), truthy('abs(gw[1].item() + 1.0) < 1e-5'), truthy('abs(gb.item() + 0.5) < 1e-5')),
        solution: 'import torch\n\nx = torch.tensor([1.0, 2.0])\nw = torch.tensor([0.5, -0.3], requires_grad=True)\nb = torch.tensor(0.1, requires_grad=True)\ny = 1.0\na = torch.sigmoid(x @ w + b)\nloss = -(y * torch.log(a) + (1 - y) * torch.log(1 - a))\nloss.backward()\ngw = w.grad\ngb = b.grad\n',
        hints: ['`a = torch.sigmoid(x @ w + b)`.', 'La entropía cruzada binaria es `-(y*log(a) + (1-y)*log(1-a))`.'],
        explain: 'Son exactamente los mismos números que calculaste a mano en la zona 8 (`dw = (a − y)·x` = [−0.5, −1.0] y `db` = −0.5): autograd aplicó la regla de la cadena por ti.',
        commands: ['autograd', 'retropropagación'],
      }),
      pyPractice({
        goal: 'Ajusta una recta con autograd',
        prompt: 'Aprende `y = 2x + 1` con descenso del gradiente: 100 pasos con tasa 0.3, usando la pérdida `((w·x + b − y)²).mean()`. Acuérdate de `no_grad` al actualizar y de poner a cero los gradientes.',
        starter: 'import torch\n\nx = torch.linspace(-1, 1, 20)\ny = 2 * x + 1\nw = torch.tensor(0.0, requires_grad=True)\nb = torch.tensor(0.0, requires_grad=True)\n\n# TU CÓDIGO: 100 pasos con lr = 0.3\n',
        check: all(truthy('abs(w.item() - 2.0) < 0.05'), truthy('abs(b.item() - 1.0) < 0.05')),
        solution: 'import torch\n\nx = torch.linspace(-1, 1, 20)\ny = 2 * x + 1\nw = torch.tensor(0.0, requires_grad=True)\nb = torch.tensor(0.0, requires_grad=True)\n\nfor paso in range(100):\n    loss = ((w * x + b - y) ** 2).mean()\n    loss.backward()\n    with torch.no_grad():\n        w -= 0.3 * w.grad\n        b -= 0.3 * b.grad\n    w.grad.zero_()\n    b.grad.zero_()\n',
        hints: ['Dentro del bucle: calcula `loss`, llama a `loss.backward()`.', 'Actualiza con `w -= 0.3 * w.grad` dentro de `with torch.no_grad():` y termina con `w.grad.zero_()` (y lo mismo con `b`).'],
        explain: 'Acabas de escribir a mano lo que hacen `optimizer.zero_grad()`, `loss.backward()` y `optimizer.step()` por ti. En la próxima lección usarás esas tres funciones.',
        commands: ['autograd', 'torch.no_grad', 'descenso del gradiente'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia9-3', { title: 'Módulos y bucle de entrenamiento', summary: 'nn.Module, pérdida, optimizador, DataLoader y evaluación', emoji: '🔁', commands: ['nn.Module', 'nn.Linear', 'CrossEntropyLoss', 'torch.optim', 'bucle de entrenamiento'], minutes: 17 }, [
      learn(
        'Las piezas de un modelo en PyTorch',
        `
Para entrenar una red solo necesitas cuatro objetos:

1. **El modelo** (\`nn.Module\`): capas con parámetros. \`nn.Linear(entradas, salidas)\` es la capa densa; \`nn.Sequential(...)\` encadena capas; para algo más complejo se escribe una clase con \`__init__\` (capas) y \`forward\` (cálculo).
2. **La pérdida**: \`nn.CrossEntropyLoss()\` para clasificación (recibe *logits* y etiquetas enteras), \`nn.MSELoss()\` para regresión.
3. **El optimizador**: \`torch.optim.Adam(modelo.parameters(), lr=…)\`. Sabe qué parámetros actualizar.
4. **Los datos**: un \`TensorDataset(X, y)\` y un \`DataLoader\` que los reparte en mini-lotes (y baraja).

Y el bucle de siempre, ahora con cinco líneas por lote:
\`opt.zero_grad()\` → \`pred = modelo(x)\` → \`loss = perdida(pred, y)\` → \`loss.backward()\` → \`opt.step()\`.
`,
        '🧩',
      ),
      pyDemo(
        'Construir y explorar un modelo',
        [
          ['import torch\nfrom torch import nn\n\nmodelo = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Linear(8, 3))\nprint(modelo)\nprint(sum(p.numel() for p in modelo.parameters()))\nfor nombre, p in modelo.named_parameters():\n    print(nombre, tuple(p.shape))', 'El modelo imprime su arquitectura. Parámetros: 4·8+8 = 40 y 8·3+3 = 27, en total 67. Los nombres `0.weight`, `2.bias`… identifican cada tensor'],
        ],
      ),
      illus('ia-train-loop', 'Qué pasa si fallas el bucle', 'Compara el bucle correcto con tres fallos típicos: quitar zero_grad, step o backward.'),
      order('Ordena los cinco pasos de una iteración del bucle de entrenamiento:', ['zero_grad()', 'predecir', 'pérdida', 'backward()', 'step()'], 'zero_grad() predecir pérdida backward() step()', 'Primero se limpian los gradientes viejos, luego se predice y se mide el error; `backward()` calcula los gradientes nuevos y `step()` los usa para actualizar los pesos.'),
      pyDemo(
        'Entrenar un clasificador de flores',
        [
          ['import torch\nfrom torch import nn\nfrom torch.utils.data import TensorDataset, DataLoader\nfrom sklearn.datasets import load_iris\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n\ntorch.manual_seed(0)\nX, y = load_iris(return_X_y=True)\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\nesc = StandardScaler().fit(Xtr)\nXtr = torch.tensor(esc.transform(Xtr), dtype=torch.float32)\nXte = torch.tensor(esc.transform(Xte), dtype=torch.float32)\nytr = torch.tensor(ytr); yte = torch.tensor(yte)\n\nmodelo = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 3))\nperdida = nn.CrossEntropyLoss()\nopt = torch.optim.Adam(modelo.parameters(), lr=0.01)\ndl = DataLoader(TensorDataset(Xtr, ytr), batch_size=16, shuffle=True)\n\nhistorial = []\nfor epoca in range(30):\n    total = 0.0\n    for xb, yb in dl:\n        opt.zero_grad()\n        loss = perdida(modelo(xb), yb)\n        loss.backward()\n        opt.step()\n        total += loss.item() * len(xb)\n    historial.append(total / len(Xtr))\nprint(len(dl), historial[-1] < historial[0] / 2)', '112 flores / lotes de 16 = 7 lotes por época. La pérdida de la última época es menos de la mitad de la primera: está aprendiendo'],
          ['modelo.eval()\nwith torch.no_grad():\n    acc = (modelo(Xte).argmax(dim=1) == yte).float().mean().item()\nprint(acc > 0.9)', 'Evaluación: `eval()` y `no_grad()`. Acierta más del 90 % de flores que no vio'],
        ],
      ),
      learn(
        'Entrenar, evaluar y guardar',
        `
- **\`modelo.train()\`** / **\`modelo.eval()\`**: algunas capas se comportan distinto al entrenar y al evaluar (*Dropout* apaga neuronas solo al entrenar; *BatchNorm* usa estadísticas del lote o las acumuladas). Hay que llamar a \`eval()\` antes de validar y a \`train()\` al volver a entrenar.
- **\`torch.no_grad()\`** al evaluar: no hace falta el grafo.
- **\`state_dict()\`**: diccionario con todos los pesos. Guardar el \`state_dict\` (\`torch.save(modelo.state_dict(), "modelo.pt")\`) y cargarlo en un modelo con **la misma arquitectura** (\`load_state_dict\`) es la forma estándar de conservar un entrenamiento.
`,
        '💾',
      ),
      pyDemo(
        'Guardar y cargar los pesos',
        [
          ['import torch\nfrom torch import nn\n\ntorch.manual_seed(0)\na = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 3))\nb = nn.Sequential(nn.Linear(4, 16), nn.ReLU(), nn.Linear(16, 3))\nx = torch.randn(5, 4)\nprint(list(a.state_dict().keys()))\na.eval(); b.eval()\nwith torch.no_grad():\n    print(torch.equal(a(x), b(x)))          # dos modelos con pesos distintos\nprint(b.load_state_dict(a.state_dict()))\nwith torch.no_grad():\n    print(torch.equal(a(x), b(x)))', 'El `state_dict` tiene cuatro tensores (pesos y sesgos de las dos capas lineales). Antes de cargarlo los modelos dan resultados distintos; después de `load_state_dict` son idénticos'],
        ],
      ),
      tf('Si olvidas `opt.zero_grad()`, los gradientes de los lotes anteriores se acumulan y los pasos de entrenamiento salen incorrectos.', true, '`backward()` suma al `.grad` existente. Sin ponerlo a cero, cada paso usa la suma de todos los gradientes anteriores.'),
      pyOut('¿Qué imprime?', 'import torch\nfrom torch import nn\nm = nn.Sequential(nn.Linear(10, 5), nn.ReLU(), nn.Linear(5, 2))\nprint(sum(p.numel() for p in m.parameters()), m(torch.zeros(4, 10)).shape)', ['60 torch.Size([4, 10])', '67 torch.Size([4, 5])', '55 torch.Size([4, 2])'], '10·5+5 = 55 y 5·2+2 = 12: 67 parámetros. Cuatro ejemplos de 10 características entran y salen 4 predicciones de 2 clases.'),
      multi('¿Qué hacen `model.eval()` y `torch.no_grad()` al evaluar?', ['`eval()` desactiva Dropout y hace que BatchNorm use sus estadísticas acumuladas', '`no_grad()` evita construir el grafo de derivadas (más rápido, menos memoria)', '`eval()` borra los pesos del modelo', '`no_grad()` impide que el modelo haga predicciones'], [0, 1], 'Se usan juntos: `eval()` cambia el comportamiento de ciertas capas y `no_grad()` ahorra el cálculo de gradientes que no se van a usar.'),
      pyPractice({
        goal: 'Define un modelo con nn.Module',
        prompt: 'Completa la clase `Clasificador`: dos capas `nn.Linear` (`entradas → ocultas` y `ocultas → clases`) con una **ReLU** entre ellas en `forward`. El modelo de abajo debe tener 83 parámetros y devolver `(5, 3)` para un lote de 5 ejemplos.',
        starter: 'import torch\nfrom torch import nn\n\nclass Clasificador(nn.Module):\n    def __init__(self, entradas, ocultas, clases):\n        super().__init__()\n        # define aquí las capas\n\n    def forward(self, x):\n        pass\n\nmodelo = Clasificador(4, 10, 3)\n',
        check: all(variable('sum(p.numel() for p in modelo.parameters())', '83'), variable('tuple(modelo(torch.zeros(5, 4)).shape)', '(5, 3)')),
        solution: 'import torch\nfrom torch import nn\n\nclass Clasificador(nn.Module):\n    def __init__(self, entradas, ocultas, clases):\n        super().__init__()\n        self.f1 = nn.Linear(entradas, ocultas)\n        self.f2 = nn.Linear(ocultas, clases)\n\n    def forward(self, x):\n        return self.f2(torch.relu(self.f1(x)))\n\nmodelo = Clasificador(4, 10, 3)\n',
        hints: ['En `__init__`: `self.f1 = nn.Linear(entradas, ocultas)` y `self.f2 = nn.Linear(ocultas, clases)`.', 'En `forward`: `return self.f2(torch.relu(self.f1(x)))`.'],
        explain: 'Registrar las capas como atributos (`self.f1 = …`) es lo que permite a `parameters()` encontrarlas. `forward` describe cómo viajan los datos: PyTorch construye el grafo de autograd al ejecutarlo.',
        commands: ['nn.Module', 'nn.Linear'],
      }),
      pyPractice({
        goal: 'Completa el bucle de entrenamiento',
        prompt: 'Entrena el clasificador de dos nubes de puntos durante **50 épocas** con el lote completo (`X`, `y`): los cinco pasos del bucle. Al final guarda en `perdida_final` la pérdida (un número, `.item()`) sobre todos los datos.',
        starter: 'import torch\nfrom torch import nn\n\ntorch.manual_seed(0)\nX = torch.cat([torch.randn(50, 2) + 2.5, torch.randn(50, 2) - 2.5])\ny = torch.cat([torch.zeros(50, dtype=torch.long), torch.ones(50, dtype=torch.long)])\nmodelo = nn.Sequential(nn.Linear(2, 8), nn.ReLU(), nn.Linear(8, 2))\nperdida = nn.CrossEntropyLoss()\nopt = torch.optim.Adam(modelo.parameters(), lr=0.05)\n\nperdida_final = None\n',
        check: truthy('perdida_final < 0.1'),
        solution: 'import torch\nfrom torch import nn\n\ntorch.manual_seed(0)\nX = torch.cat([torch.randn(50, 2) + 2.5, torch.randn(50, 2) - 2.5])\ny = torch.cat([torch.zeros(50, dtype=torch.long), torch.ones(50, dtype=torch.long)])\nmodelo = nn.Sequential(nn.Linear(2, 8), nn.ReLU(), nn.Linear(8, 2))\nperdida = nn.CrossEntropyLoss()\nopt = torch.optim.Adam(modelo.parameters(), lr=0.05)\n\nfor epoca in range(50):\n    opt.zero_grad()\n    loss = perdida(modelo(X), y)\n    loss.backward()\n    opt.step()\nperdida_final = perdida(modelo(X), y).item()\n',
        hints: ['`for epoca in range(50):` y dentro los cinco pasos en el orden correcto.', 'Empieza con `opt.zero_grad()`, termina con `opt.step()`. Guarda al final `perdida(modelo(X), y).item()`.'],
        explain: 'Con datos que caben en memoria no hace falta ni `DataLoader`: todo el conjunto es un único lote. Si cambias el orden de `backward()` y `zero_grad()`, comprobarás por qué importa.',
        commands: ['bucle de entrenamiento', 'torch.optim', 'CrossEntropyLoss'],
      }),
      pyPractice({
        goal: 'Evalúa sin gradientes',
        prompt: 'Escribe `exactitud(modelo, X, y)`, que ponga el modelo en modo evaluación, calcule las predicciones **sin gradientes** y devuelva la proporción de aciertos (un número).',
        starter: 'import torch\nfrom torch import nn\n\nmodelo = nn.Linear(2, 2)\nwith torch.no_grad():\n    modelo.weight.copy_(torch.tensor([[1., 0.], [0., 1.]]))\n    modelo.bias.zero_()\nX = torch.tensor([[2., 1.], [0., 3.], [4., 0.], [1., 5.]])\ny = torch.tensor([0, 1, 1, 1])\n\ndef exactitud(modelo, X, y):\n    pass\n',
        check: calls([['round(float(exactitud(modelo, X, y)), 2)', '0.75'], ['(exactitud(modelo, X, y), modelo.training)[1]', 'False']]),
        solution: 'import torch\nfrom torch import nn\n\nmodelo = nn.Linear(2, 2)\nwith torch.no_grad():\n    modelo.weight.copy_(torch.tensor([[1., 0.], [0., 1.]]))\n    modelo.bias.zero_()\nX = torch.tensor([[2., 1.], [0., 3.], [4., 0.], [1., 5.]])\ny = torch.tensor([0, 1, 1, 1])\n\ndef exactitud(modelo, X, y):\n    modelo.eval()\n    with torch.no_grad():\n        pred = modelo(X).argmax(dim=1)\n    return (pred == y).float().mean().item()\n',
        hints: ['Empieza con `modelo.eval()`.', 'Dentro de `with torch.no_grad():` calcula `modelo(X).argmax(dim=1)` y compáralo con `y`.'],
        explain: 'Esta función (modo eval + no_grad + argmax + media) la escribirás en casi todos tus proyectos. Los pesos identidad hacen que gane la columna mayor de cada fila: acierta 3 de 4.',
        commands: ['model.train y model.eval', 'torch.no_grad'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia9-4', { title: 'Redes convolucionales (CNN)', summary: 'Filtros, pooling y una CNN que reconoce dígitos', emoji: '🖼️', commands: ['convolución', 'nn.Conv2d', 'nn.MaxPool2d'], minutes: 17 }, [
      learn(
        'Por qué una red densa no es buena para imágenes',
        `
Una imagen de 28×28 tiene 784 píxeles. Una capa densa con 128 neuronas necesitaría 784 × 128 ≈ **100 000 pesos** solo en la primera capa, trata los píxeles como una lista sin vecindad y, si el dígito se desplaza un poco, "no se entera" de que es el mismo.

Una **convolución** soluciona las dos cosas:
- Un **filtro** pequeño (3×3 = 9 pesos) se **desliza** por la imagen. En cada posición multiplica el filtro por los píxeles que cubre y suma: un único número.
- **El mismo filtro** se aplica en todas las posiciones (pesos compartidos): detecta un patrón (un borde, una esquina) esté donde esté.
- El resultado, un **mapa de características**, dice dónde se encontró el patrón.

Tamaño de salida: \`(n + 2·relleno − k) // paso + 1\`. Con \`relleno = 1\` y filtro 3×3 la imagen no cambia de tamaño. Un **pooling** (p. ej. \`MaxPool2d(2)\`) reduce a la mitad quedándose con el mayor valor de cada bloque 2×2.
`,
        '🖼️',
      ),
      illus('ia-conv', 'Desliza el filtro', 'Elige un filtro y recorre la ventana. Cambia relleno y paso, y activa el pooling.'),
      pyDemo(
        'Un filtro que detecta un borde',
        [
          ['import torch\nimport torch.nn.functional as F\n\nimg = torch.zeros(1, 1, 5, 5)\nimg[..., 2:] = 1.0                      # izquierda oscura, derecha clara\nk = torch.tensor([[[[-1., 0., 1.], [-1., 0., 1.], [-1., 0., 1.]]]])\nprint(F.conv2d(img, k)[0, 0])', 'El filtro vertical da 3 donde la imagen pasa de oscuro a claro (las dos primeras columnas) y 0 donde ya es todo claro'],
        ],
      ),
      pyOut('¿Qué imprime?', 'def salida(n, k, p=0, s=1):\n    return (n + 2 * p - k) // s + 1\nprint(salida(28, 5), salida(28, 3, 1), salida(28, 3, 0, 2))', ['26 28 14', '24 26 13', '28 28 13'], '(28−5)/1+1 = 24; con relleno 1 y filtro 3 se conserva el tamaño (28); con paso 2: (28−3)//2+1 = 13.'),
      learn(
        'Una CNN completa',
        `
Una CNN apila bloques **convolución → ReLU → pooling** que van de lo local (bordes) a lo global (formas), y termina con \`Flatten\` y una o dos capas densas que clasifican. Con imágenes de 8×8 de un solo canal (los dígitos de scikit-learn):

\`\`\`python
nn.Sequential(
    nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),     # (8, 4, 4)
    nn.Flatten(), nn.Linear(8 * 4 * 4, 10),                       # 10 clases
)
\`\`\`

Para escribirla sin error hay que seguir la **forma** del tensor capa a capa: eso es lo que hace el siguiente ejemplo.
`,
        '🏗️',
      ),
      pyDemo(
        'Seguir la forma por la red',
        [
          ['import torch\nfrom torch import nn\n\nmodelo = nn.Sequential(\n    nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),\n    nn.Conv2d(8, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),\n    nn.Flatten(), nn.Linear(16 * 2 * 2, 10),\n)\nx = torch.zeros(5, 1, 8, 8)\nfor capa in modelo:\n    x = capa(x)\n    print(type(capa).__name__, tuple(x.shape))\nprint(sum(p.numel() for p in modelo.parameters()))', 'Cada convolución mantiene 8×8→4×4→2×2 gracias al relleno y a los pooling; `Flatten` convierte 16·2·2 = 64 en un vector. Solo 1 898 parámetros'],
        ],
      ),
      pyDemo(
        'Entrenar la CNN con los dígitos',
        [
          [`${DIGITOS}from torch.utils.data import TensorDataset, DataLoader\n\ncnn = nn.Sequential(nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), nn.Flatten(), nn.Linear(8 * 4 * 4, 10))\nopt = torch.optim.Adam(cnn.parameters(), lr=0.01)\nperdida = nn.CrossEntropyLoss()\ndl = DataLoader(TensorDataset(Xtr, ytr), batch_size=64, shuffle=True)\nfor epoca in range(8):\n    for xb, yb in dl:\n        opt.zero_grad()\n        perdida(cnn(xb), yb).backward()\n        opt.step()\ncnn.eval()\nwith torch.no_grad():\n    acc = (cnn(Xte).argmax(dim=1) == yte).float().mean().item()\nprint(sum(p.numel() for p in cnn.parameters()), acc > 0.9)`, 'Con solo 1 370 parámetros y 8 épocas la CNN supera el 90 % reconociendo dígitos manuscritos que nunca vio'],
          ['mlp = nn.Sequential(nn.Flatten(), nn.Linear(64, 128), nn.ReLU(), nn.Linear(128, 10))\nprint(sum(p.numel() for p in mlp.parameters()))', 'Una red densa equivalente ya necesita 9 610 parámetros, siete veces más, y con imágenes grandes la diferencia se dispara'],
        ],
      ),
      tf('Un filtro convolucional tiene pesos distintos para cada posición de la imagen.', false, 'Justo lo contrario: el mismo filtro (los mismos pesos) se aplica en todas las posiciones. Es lo que reduce los parámetros y permite detectar el patrón donde sea.'),
      mc('Entra una imagen 1×28×28 en `nn.Conv2d(1, 16, 5)` y después `nn.MaxPool2d(2)`. ¿Qué forma queda (sin lote)?', ['(16, 24, 24)', '(16, 12, 12)', '(16, 28, 28)', '(1, 14, 14)'], 1, 'La convolución sin relleno da (28−5)+1 = 24 por lado, con 16 canales: (16, 24, 24). El pooling 2×2 lo reduce a la mitad: (16, 12, 12).'),
      pyPractice({
        goal: 'Tamaño de salida',
        prompt: 'Escribe `tam_salida(n, k, p=0, s=1)` con la fórmula del tamaño de salida de una convolución (o de un pooling) sobre una dimensión de tamaño `n`.',
        starter: 'def tam_salida(n, k, p=0, s=1):\n    pass\n',
        check: calls([['tam_salida(28, 5)', '24'], ['tam_salida(28, 3, 1)', '28'], ['tam_salida(28, 3, 0, 2)', '13'], ['tam_salida(8, 2, 0, 2)', '4']]),
        solution: 'def tam_salida(n, k, p=0, s=1):\n    return (n + 2 * p - k) // s + 1\n',
        hints: ['El relleno añade `p` a cada lado: `n + 2 * p`.', 'Resta el tamaño del filtro, divide (entera) por el paso y suma 1.'],
        explain: 'Es la fórmula que hay que aplicar para saber con qué `in_features` debe empezar el `nn.Linear` que sigue al `Flatten`. Un `MaxPool2d(2)` es el caso `k = 2, s = 2`.',
        commands: ['convolución', 'nn.Conv2d'],
      }),
      pyPractice({
        goal: 'Detecta un borde horizontal',
        prompt: 'Aplica el filtro `kernel` (que responde a cambios de arriba abajo) a `img` con `F.conv2d` y guarda el resultado `(1, 1, 3, 3)` en `borde`.',
        starter: 'import torch\nimport torch.nn.functional as F\n\nimg = torch.zeros(1, 1, 5, 5)\nimg[..., 2:, :] = 1.0                    # arriba oscura, abajo clara\nkernel = torch.tensor([[[[-1., -1., -1.], [0., 0., 0.], [1., 1., 1.]]]])\nborde = None\n',
        check: variable('borde[0, 0].tolist()', '[[3.0, 3.0, 3.0], [3.0, 3.0, 3.0], [0.0, 0.0, 0.0]]'),
        solution: 'import torch\nimport torch.nn.functional as F\n\nimg = torch.zeros(1, 1, 5, 5)\nimg[..., 2:, :] = 1.0\nkernel = torch.tensor([[[[-1., -1., -1.], [0., 0., 0.], [1., 1., 1.]]]])\nborde = F.conv2d(img, kernel)\n',
        hints: ['`F.conv2d(entrada, filtros)` espera la entrada `(lote, canales, alto, ancho)` y los filtros `(salida, canales, k, k)`.'],
        explain: 'Las dos primeras filas del resultado valen 3: ahí el filtro ve "oscuro arriba, claro abajo". En una CNN real los filtros no se escriben a mano: se **aprenden** con el descenso del gradiente.',
        commands: ['convolución', 'nn.Conv2d'],
      }),
      pyPractice({
        goal: 'Construye tu CNN',
        prompt: 'Crea `cnn` con `nn.Sequential` para imágenes `(1, 8, 8)` y 10 clases: al menos una `nn.Conv2d`, una `nn.MaxPool2d`, un `nn.Flatten` y una capa final `nn.Linear` con 10 salidas, con **menos de 5 000 parámetros**.',
        starter: 'import torch\nfrom torch import nn\n\ncnn = None\n',
        check: all(variable('tuple(cnn(torch.zeros(3, 1, 8, 8)).shape)', '(3, 10)'), truthy('sum(p.numel() for p in cnn.parameters()) < 5000'), truthy('any(isinstance(m, nn.Conv2d) for m in cnn.modules()) and any(isinstance(m, nn.MaxPool2d) for m in cnn.modules())')),
        solution: 'import torch\nfrom torch import nn\n\ncnn = nn.Sequential(\n    nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),\n    nn.Flatten(), nn.Linear(8 * 4 * 4, 10),\n)\n',
        hints: ['`Conv2d(1, 8, 3, padding=1)` mantiene 8×8; `MaxPool2d(2)` lo deja en 4×4.', 'Tras `Flatten` hay 8 · 4 · 4 = 128 características: `nn.Linear(128, 10)`.'],
        explain: 'Si la forma no cuadra, PyTorch lo dice al instante (`mat1 and mat2 shapes cannot be multiplied`). Calcular a mano el tamaño tras cada capa es el truco para acertar con el `Linear` final.',
        commands: ['nn.Conv2d', 'nn.MaxPool2d'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia9-5', { title: 'Secuencias: RNN y LSTM', summary: 'Memoria a lo largo del tiempo, embeddings y celdas con puertas', emoji: '🧬', commands: ['nn.Embedding', 'nn.LSTM'], minutes: 16 }, [
      learn(
        'Datos que llegan en orden',
        `
Texto, audio, series temporales, genomas… son **secuencias**: el orden importa y la longitud varía. Una red densa no tiene noción de "antes" y "después". Una **red recurrente** (RNN) procesa los elementos uno a uno guardando un **estado oculto** \`h\` que resume lo visto hasta el momento:

\`\`\`
h_t = tanh(W · h_(t−1) + U · x_t)
\`\`\`

El mismo \`W\` y \`U\` se reutilizan en cada paso (pesos compartidos en el tiempo). Para texto, cada palabra se convierte primero en un vector con una capa **\`nn.Embedding\`** (una tabla de vectores aprendidos).

Problema: al retropropagar a través de muchos pasos, el gradiente se multiplica una y otra vez por \`W\` y la derivada de tanh: se **desvanece** (o explota). Una RNN simple olvida lo que vio hace pocos pasos. La solución es la **LSTM** (*Long Short-Term Memory*): añade una **celda de memoria** que se actualiza de forma casi lineal y tres **puertas** (entrada, olvido, salida) que deciden qué escribir, qué conservar y qué mostrar.
`,
        '🧬',
      ),
      pyDemo(
        'Una RNN a mano, paso a paso',
        [
          ['import torch\n\nxs = [torch.tensor([1., 0.]), torch.tensor([0., 1.]), torch.tensor([1., 1.])]\nW = 0.5 * torch.eye(3)                    # estado -> estado\nU = torch.full((3, 2), 0.2)               # entrada -> estado\nh = torch.zeros(3)\nfor t, x in enumerate(xs):\n    h = torch.tanh(W @ h + U @ x)\n    print(t, [round(v, 4) for v in h.tolist()])', 'El estado `h` se actualiza con cada entrada y arrastra algo de lo anterior. Con tres neuronas iguales todas valen lo mismo en cada paso'],
        ],
      ),
      illus('ia-rnn', 'Memoria de una RNN frente a una LSTM', 'Alarga la secuencia y mira cuánto queda del primer dato. Prueba a acercar la puerta f a 1.'),
      mc('¿Qué problema resuelve la celda de memoria de una LSTM?', ['Que los datos no caben en memoria RAM', 'Que el gradiente y la información se desvanecen en secuencias largas', 'Que las palabras tienen distinta longitud', 'Que no se pueden usar GPUs'], 1, 'La celda se actualiza de forma casi lineal, con puertas que deciden qué conservar: la información y el gradiente pueden viajar muchos pasos sin desvanecerse.'),
      pyDemo(
        'Embedding y LSTM: las formas',
        [
          ['import torch\nfrom torch import nn\n\nemb = nn.Embedding(100, 16)                         # vocabulario de 100 palabras\nlstm = nn.LSTM(16, 32, batch_first=True)\ntokens = torch.randint(0, 100, (4, 7))              # 4 frases de 7 palabras\nvectores = emb(tokens)\nsalidas, (h, c) = lstm(vectores)\nprint(tuple(tokens.shape), tuple(vectores.shape))\nprint(tuple(salidas.shape), tuple(h.shape), tuple(c.shape))', '`(4, 7)` enteros pasan a `(4, 7, 16)` decimales; la LSTM devuelve la salida de cada paso `(4, 7, 32)` y el último estado `h` y celda `c` con forma `(1, 4, 32)`'],
        ],
      ),
      learn(
        'Un clasificador de secuencias',
        `
Para clasificar una secuencia entera (¿es spam? ¿qué sentimiento tiene?) se usa el **último estado oculto**: \`h[-1]\` resume todo lo leído. Se le pone una capa \`Linear\` encima:

\`embedding → LSTM → h[-1] → Linear → logits\`

Para probar si una red tiene memoria de verdad basta un problema sencillo: secuencias de 0 y 1 de longitud 6 cuya etiqueta es **el primer elemento**. Para acertar, el modelo tiene que recordar el primer paso durante cinco más.
`,
        '🧠',
      ),
      pyDemo(
        'Una LSTM aprende a recordar',
        [
          ['import torch\nfrom torch import nn\n\ntorch.manual_seed(0)\nclass Clasificador(nn.Module):\n    def __init__(self):\n        super().__init__()\n        self.emb = nn.Embedding(2, 8)\n        self.lstm = nn.LSTM(8, 16, batch_first=True)\n        self.salida = nn.Linear(16, 2)\n    def forward(self, x):\n        _, (h, c) = self.lstm(self.emb(x))\n        return self.salida(h[-1])\n\nmodelo = Clasificador()\nopt = torch.optim.Adam(modelo.parameters(), lr=0.02)\nperdida = nn.CrossEntropyLoss()\nfor paso in range(120):\n    x = torch.randint(0, 2, (64, 6))        # secuencias de 0 y 1\n    y = x[:, 0]                             # la etiqueta es el primer elemento\n    opt.zero_grad()\n    perdida(modelo(x), y).backward()\n    opt.step()\n\nmodelo.eval()\nwith torch.no_grad():\n    x = torch.randint(0, 2, (500, 6))\n    acc = (modelo(x).argmax(dim=1) == x[:, 0]).float().mean().item()\nprint(acc > 0.9)', 'Tras solo 120 pasos acierta casi el 100 % de secuencias nuevas: ha aprendido a conservar el primer dato hasta el final'],
        ],
      ),
      tf('En una RNN el estado oculto se reinicia a cero en cada paso de tiempo.', false, 'Justo al revés: el estado se arrastra de un paso al siguiente (`h_t` depende de `h_(t−1)`). Solo se inicializa a cero al comenzar cada secuencia.'),
      match('Une cada componente con su función:', [['nn.Embedding', 'Convierte identificadores enteros en vectores aprendidos'], ['nn.LSTM', 'Recorre la secuencia con memoria y puertas'], ['h[-1]', 'Resumen de toda la secuencia leída'], ['nn.Linear final', 'Convierte el resumen en logits de clase']], 'Embedding → LSTM → último estado → Linear es el esqueleto de un clasificador de texto antes de la era de los transformers.'),
      pyPractice({
        goal: 'Las formas de una LSTM',
        prompt: 'Pasa `x` por la `lstm` y guarda en `salidas`, `h` y `c` los tres resultados (`salidas, (h, c) = lstm(x)`). Después guarda en `ultimo` el último estado de cada ejemplo, de forma `(lote, oculto)` (usa `h[-1]`).',
        starter: 'import torch\nfrom torch import nn\n\nlstm = nn.LSTM(input_size=5, hidden_size=7, batch_first=True)\nx = torch.zeros(3, 9, 5)          # 3 secuencias de 9 pasos con 5 características\nsalidas = h = c = ultimo = None\n',
        check: all(variable('tuple(salidas.shape)', '(3, 9, 7)'), variable('tuple(h.shape)', '(1, 3, 7)'), variable('tuple(ultimo.shape)', '(3, 7)')),
        solution: 'import torch\nfrom torch import nn\n\nlstm = nn.LSTM(input_size=5, hidden_size=7, batch_first=True)\nx = torch.zeros(3, 9, 5)\nsalidas, (h, c) = lstm(x)\nultimo = h[-1]\n',
        hints: ['`lstm(x)` devuelve una tupla `(salidas, (h, c))`.', '`h` tiene forma `(capas, lote, oculto)`; `h[-1]` es la última capa: `(lote, oculto)`.'],
        explain: 'Con `batch_first=True` la entrada es `(lote, tiempo, características)`. Sin él, PyTorch espera `(tiempo, lote, características)`: un error de formas clásico.',
        commands: ['nn.LSTM'],
      }),
      pyPractice({
        goal: 'Promedio de embeddings',
        prompt: 'Convierte los `tokens` (2 frases de 5 palabras) en embeddings con `emb` y guarda en `media` el **promedio por frase** (sobre las palabras): una forma `(2, 4)`.',
        starter: 'import torch\nfrom torch import nn\n\nemb = nn.Embedding(10, 4)\ntokens = torch.tensor([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]])\nmedia = None\n',
        check: all(variable('tuple(media.shape)', '(2, 4)'), truthy('torch.allclose(media[0], media[1], atol=1e-6)')),
        solution: 'import torch\nfrom torch import nn\n\nemb = nn.Embedding(10, 4)\ntokens = torch.tensor([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]])\nmedia = emb(tokens).mean(dim=1)\n',
        hints: ['`emb(tokens)` tiene forma `(2, 5, 4)`.', 'Promedia sobre las palabras: `.mean(dim=1)`.'],
        explain: 'Un modelo de "bolsa de palabras" con embeddings promedia los vectores: ignora el orden, por eso las dos frases (mismas palabras al revés) dan exactamente el mismo vector. Una LSTM sí distinguiría el orden.',
        commands: ['nn.Embedding'],
      }),
      pyPractice({
        goal: 'Una RNN a mano',
        prompt: 'Calcula el estado oculto final `h` de una RNN de una neurona sobre la secuencia `xs`: parte de `h = 0` y en cada paso aplica `h = tanh(w·h + u·x)`.',
        starter: 'import torch\n\nxs = [1.0, 0.0, -1.0, 0.5]\nw, u = 0.5, 2.0\nh = torch.tensor(0.0)\n',
        check: truthy('abs(h.item() - 0.4837) < 1e-3'),
        solution: 'import torch\n\nxs = [1.0, 0.0, -1.0, 0.5]\nw, u = 0.5, 2.0\nh = torch.tensor(0.0)\nfor x in xs:\n    h = torch.tanh(w * h + u * x)\n',
        hints: ['Un bucle `for x in xs:` y dentro `h = torch.tanh(w * h + u * x)`.'],
        explain: 'Esa sola línea dentro del bucle es toda una RNN. `nn.RNN`, `nn.GRU` y `nn.LSTM` hacen lo mismo con matrices, varias neuronas y, en la LSTM, puertas.',
        commands: ['nn.LSTM'],
      }),
    ]),

    // ───────────────────────── 6 ─────────────────────────
    lesson('ia9-6', { title: 'Regularización y transfer learning', summary: 'Dropout, BatchNorm, decaimiento de pesos, parada temprana y modelos preentrenados', emoji: '🛡️', commands: ['Dropout', 'BatchNorm', 'decaimiento de pesos', 'parada temprana', 'transfer learning'], minutes: 17 }, [
      learn(
        'Redes que memorizan',
        `
Una red grande tiene tantos parámetros que puede **memorizar** el conjunto de entrenamiento, ruido incluido: la pérdida de entrenamiento baja y baja, pero la de **validación** empieza a subir. Es el sobreajuste de siempre, y las redes profundas lo sufren más. Armas para combatirlo:

- **Dropout**: durante el entrenamiento apaga al azar una fracción de neuronas (\`nn.Dropout(0.3)\`). Obliga a repartir la información; es como entrenar muchas redes pequeñas a la vez.
- **Decaimiento de pesos** (*weight decay*, L2): penaliza los pesos grandes (\`optim.AdamW(..., weight_decay=1e-2)\`).
- **Batch Normalization** (\`nn.BatchNorm1d/2d\`): normaliza las activaciones de cada capa por lote; estabiliza y acelera, y tiene un ligero efecto regularizador.
- **Más datos / aumento de datos**: la cura definitiva.
- **Parada temprana**: se vigila la pérdida de validación y se detiene el entrenamiento cuando lleva \`paciencia\` épocas sin mejorar, quedándote con la **mejor época**.
`,
        '🛡️',
      ),
      illus('ia-overfit', 'Sobreajuste y sus remedios', 'Cambia el tamaño del modelo y activa dropout y decaimiento. Observa la mejor época y dónde pararía la parada temprana.'),
      pyDemo(
        'Dropout y BatchNorm se portan distinto en train y eval',
        [
          ['import torch\nfrom torch import nn\n\nd = nn.Dropout(0.5)\nd.train()\nprint(set(d(torch.ones(200)).tolist()) <= {0.0, 2.0})\nd.eval()\nprint(d(torch.ones(4)))', 'Al entrenar, el dropout deja valores 0 (apagados) o 2 (los demás se escalan por 1/(1−p)); al evaluar deja pasar todo tal cual'],
          ['bn = nn.BatchNorm1d(3)\nx = torch.tensor([[1., 2., 3.], [3., 4., 5.], [5., 6., 10.]])\nz = bn(x)\nprint(z.mean(dim=0).abs().max().item() < 1e-5, bn.running_mean.shape)', 'BatchNorm deja cada columna con media 0 y guarda estadísticas acumuladas (`running_mean`) para usar en evaluación'],
        ],
      ),
      mc('Tu pérdida de entrenamiento sigue bajando pero la de validación lleva 8 épocas subiendo. ¿Qué haces primero?', ['Entrenar más épocas', 'Parar en la mejor época y añadir regularización (dropout, decaimiento) o más datos', 'Subir la tasa de aprendizaje', 'Quitar la validación'], 1, 'Es sobreajuste. Guardar los pesos de la mejor época (parada temprana) y regularizar atacan el problema; entrenar más lo empeora.'),
      pyDemo(
        'Parada temprana en acción',
        [
          ['import numpy as np\nimport torch\nfrom torch import nn\nfrom sklearn.datasets import load_digits\nfrom sklearn.model_selection import train_test_split\n\ntorch.manual_seed(0)\nX, y = load_digits(return_X_y=True)\nXa, Xb, ya, yb = train_test_split(X / 16.0, y, train_size=100, random_state=0, stratify=y)\nXtr = torch.tensor(Xa, dtype=torch.float32); ytr = torch.tensor(ya)\nXva = torch.tensor(Xb[:400], dtype=torch.float32); yva = torch.tensor(yb[:400])\n\ndef entrenar(p, wd, epocas=40):\n    modelo = nn.Sequential(nn.Linear(64, 128), nn.ReLU(), nn.Dropout(p), nn.Linear(128, 128), nn.ReLU(), nn.Dropout(p), nn.Linear(128, 10))\n    opt = torch.optim.AdamW(modelo.parameters(), lr=0.003, weight_decay=wd)\n    perdida = nn.CrossEntropyLoss()\n    val = []\n    for ep in range(epocas):\n        modelo.train()\n        opt.zero_grad(); perdida(modelo(Xtr), ytr).backward(); opt.step()\n        modelo.eval()\n        with torch.no_grad():\n            val.append(perdida(modelo(Xva), yva).item())\n    return val\n\nval = entrenar(0.0, 0.0)\nmejor = int(np.argmin(val))\nprint(mejor < len(val) - 1, val[-1] > min(val) * 1.1)', 'Con solo 100 ejemplos y una red grande, la pérdida de validación toca fondo a mitad del entrenamiento y después sube (más de un 10 % por encima de su mínimo): parar en la mejor época habría sido mejor'],
          ['val_reg = entrenar(0.3, 0.1)\nprint(int(np.argmin(val_reg)) > mejor, min(val_reg) <= min(val) * 1.1)', 'Con dropout 0.3 y decaimiento de pesos, la mejor época llega más tarde y la validación no empeora: la regularización retrasa el sobreajuste'],
        ],
      ),
      learn(
        'Transfer learning: no empieces de cero',
        `
Entrenar una red grande desde cero exige muchos datos y muchas horas. El **transfer learning** reutiliza una red **ya entrenada** en una tarea grande: sus primeras capas aprendieron características generales (bordes, texturas, formas) que sirven para tu problema.

Receta:
1. Parte de una red preentrenada y **congela** su cuerpo: \`for p in base.parameters(): p.requires_grad_(False)\`.
2. Pon una **cabeza nueva** (\`nn.Linear\`) para tu tarea y entrena solo sus parámetros.
3. (Opcional) Descongela todo y afina con una tasa de aprendizaje muy pequeña (*fine-tuning*).

Con pocos datos suele ganar al entrenamiento desde cero, y entrenas cientos de parámetros en vez de millones. Es exactamente lo que se hace al usar un modelo de visión o un modelo de lenguaje preentrenado.
`,
        '🚀',
      ),
      pyDemo(
        'Congelar la base y entrenar solo la cabeza',
        [
          ['import numpy as np\nimport torch\nfrom torch import nn\nfrom sklearn.datasets import load_digits\nfrom sklearn.model_selection import train_test_split\n\ntorch.manual_seed(0)\nX, y = load_digits(return_X_y=True)\nXp, Xn, yp, yn = train_test_split(X / 16.0, y, train_size=1000, random_state=0, stratify=y)\n\n# 1) preentrenar en la tarea grande (los 10 dígitos)\nbase = nn.Sequential(nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 32), nn.ReLU())\npre = nn.Sequential(base, nn.Linear(32, 10))\nopt = torch.optim.Adam(pre.parameters(), lr=0.01)\nperdida = nn.CrossEntropyLoss()\nXa = torch.tensor(Xp, dtype=torch.float32); ya = torch.tensor(yp)\nfor ep in range(40):\n    opt.zero_grad(); perdida(pre(Xa), ya).backward(); opt.step()\n\n# 2) congelar la base\nfor p in base.parameters():\n    p.requires_grad_(False)\nmodelo = nn.Sequential(base, nn.Linear(32, 2))\nprint(sum(p.numel() for p in modelo.parameters() if p.requires_grad), sum(p.numel() for p in modelo.parameters()))', 'Congelada la base, solo se entrenan 66 de los 6 306 parámetros: la cabeza nueva (32·2 + 2)'],
          ['par = (yn % 2 == 0).astype(np.int64)             # tarea nueva: ¿es par? con muy pocas etiquetas\n\ndef probar(semilla, n_etiquetadas=10):\n    Xtr, Xte, ytr, yte = train_test_split(Xn, par, train_size=n_etiquetadas, random_state=semilla, stratify=par)\n    Xtr = torch.tensor(Xtr, dtype=torch.float32); ytr = torch.tensor(ytr)\n    Xte = torch.tensor(Xte, dtype=torch.float32); yte = torch.tensor(yte)\n    def entrenar(m, params):\n        o = torch.optim.Adam(params, lr=0.01)\n        for _ in range(60):\n            o.zero_grad(); perdida(m(Xtr), ytr).backward(); o.step()\n        with torch.no_grad():\n            return (m(Xte).argmax(dim=1) == yte).float().mean().item()\n    torch.manual_seed(semilla)\n    transfer = nn.Sequential(base, nn.Linear(32, 2))\n    scratch = nn.Sequential(nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 2))\n    return entrenar(transfer, transfer[1].parameters()), entrenar(scratch, scratch.parameters())\n\nres = [probar(s) for s in range(6)]\nmedia_t = sum(a for a, _ in res) / 6\nmedia_s = sum(b for _, b in res) / 6\nprint(media_t > media_s)', 'Con solo 10 ejemplos etiquetados, de media (6 repartos distintos) la red que reutiliza las características aprendidas supera a la que empieza de cero'],
        ],
      ),
      tf('Congelar una capa significa poner sus pesos a cero.', false, 'Congelar es impedir que se **actualicen** (`requires_grad_(False)`): los pesos conservan los valores preentrenados, solo dejan de cambiar durante el entrenamiento.'),
      multi('¿Qué técnicas ayudan contra el sobreajuste en una red neuronal?', ['Dropout', 'Decaimiento de pesos (weight decay)', 'Parada temprana', 'Entrenar con una tasa de aprendizaje enorme'], [0, 1, 2], 'Las tres primeras regularizan. Una tasa muy alta no regulariza: lo normal es que haga divergir el entrenamiento.'),
      pyPractice({
        goal: 'Congela y cuenta',
        prompt: 'Congela todas las capas de `modelo` **excepto la última** (`modelo[-1]`) y guarda en `entrenables` cuántos parámetros siguen entrenándose y en `total` cuántos tiene el modelo.',
        starter: 'import torch\nfrom torch import nn\n\nmodelo = nn.Sequential(nn.Linear(10, 20), nn.ReLU(), nn.Linear(20, 20), nn.ReLU(), nn.Linear(20, 3))\nentrenables = total = None\n',
        check: all(variable('entrenables', '63'), variable('total', '703')),
        solution: 'import torch\nfrom torch import nn\n\nmodelo = nn.Sequential(nn.Linear(10, 20), nn.ReLU(), nn.Linear(20, 20), nn.ReLU(), nn.Linear(20, 3))\nfor capa in list(modelo)[:-1]:\n    for p in capa.parameters():\n        p.requires_grad_(False)\nentrenables = sum(p.numel() for p in modelo.parameters() if p.requires_grad)\ntotal = sum(p.numel() for p in modelo.parameters())\n',
        hints: ['Recorre `list(modelo)[:-1]` (todas menos la última) y llama a `p.requires_grad_(False)` en sus parámetros.', 'Cuenta solo los que cumplen `p.requires_grad`.'],
        explain: 'Solo la cabeza (20·3 + 3 = 63) se entrena de los 703 parámetros. Con modelos de millones de parámetros, la diferencia en coste y datos necesarios es enorme.',
        commands: ['transfer learning'],
      }),
      pyPractice({
        goal: 'Decide cuándo parar',
        prompt: 'Escribe `parar(val, paciencia)`: recorre la lista `val` de pérdidas de validación y devuelve el **índice de la época en la que se detiene el entrenamiento**, es decir, la primera en la que llevas `paciencia` épocas seguidas sin mejorar el mínimo. Si nunca se agota la paciencia, devuelve el índice de la última época.',
        starter: 'def parar(val, paciencia):\n    pass\n',
        check: calls([['parar([5, 4, 3, 2.5, 2.6, 2.7, 2.8, 2.9], 3)', '6'], ['parar([3, 2, 1], 5)', '2'], ['parar([1, 2, 3, 4], 2)', '2'], ['parar([4, 3, 3, 3, 2], 2)', '3']]),
        solution: 'def parar(val, paciencia):\n    mejor = 0\n    espera = 0\n    for i in range(1, len(val)):\n        if val[i] < val[mejor]:\n            mejor = i\n            espera = 0\n        else:\n            espera += 1\n            if espera >= paciencia:\n                return i\n    return len(val) - 1\n',
        hints: ['Guarda el índice del mejor valor y un contador `espera` de épocas sin mejorar.', 'Si `val[i] < val[mejor]` reinicia el contador; si no, súmalo y comprueba si llegó a `paciencia`.'],
        explain: 'Mejor época 3 (2.5); las épocas 4, 5 y 6 no mejoran: con paciencia 3 se para en la 6. En la práctica además se guarda una copia del `state_dict` cada vez que mejora, para recuperar los pesos de la mejor época.',
        commands: ['parada temprana'],
      }),
      pyPractice({
        goal: 'Decaimiento de pesos a mano',
        prompt: 'Haz **un paso** de descenso del gradiente con decaimiento de pesos L2 a mano: `w_nuevo = w − lr·(g + wd·w)`. Guarda el resultado en `w_nuevo` y, para comprobarlo, el que da `torch.optim.SGD(..., weight_decay=wd)` en `w_opt`; deben ser iguales.',
        starter: 'import torch\n\nw = torch.tensor([2.0, -1.0])\ng = torch.tensor([0.5, 0.5])\nlr, wd = 0.1, 0.5\n\nw_nuevo = w_opt = None\n',
        check: all(variable('[round(v, 4) for v in w_nuevo.tolist()]', '[1.85, -1.0]'), truthy('torch.allclose(w_nuevo, w_opt, atol=1e-6)')),
        solution: 'import torch\n\nw = torch.tensor([2.0, -1.0])\ng = torch.tensor([0.5, 0.5])\nlr, wd = 0.1, 0.5\n\nw_nuevo = w - lr * (g + wd * w)\n\np = w.clone().requires_grad_(True)\nopt = torch.optim.SGD([p], lr=lr, weight_decay=wd)\np.grad = g.clone()\nopt.step()\nw_opt = p.detach()\n',
        hints: ['`w_nuevo = w - lr * (g + wd * w)`.', 'Para el optimizador: crea `p = w.clone().requires_grad_(True)`, asigna `p.grad = g.clone()` y llama a `opt.step()`.'],
        explain: 'El decaimiento de pesos solo suma `wd·w` al gradiente: empuja cada peso un poco hacia cero en cada paso, así que los pesos grandes solo sobreviven si de verdad ayudan a reducir la pérdida.',
        commands: ['decaimiento de pesos', 'torch.optim'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: reconoce dígitos escritos a mano',
    prompt:
      'Entrena una red convolucional con **PyTorch** para los dígitos 8×8 y aplica lo aprendido en la zona.\n\nYa tienes los datos en tensores (`Xtr`, `ytr`, `Xva`, `yva`, `Xte`, `yte`) y la función `evaluar(modelo, X, y)` que devuelve `(pérdida, exactitud)`.\n\n1. Define `modelo`: al menos una `Conv2d`, una `MaxPool2d`, un `Dropout` y una capa `Linear` final de 10 salidas.\n2. Usa `torch.optim.AdamW` con `weight_decay` y `lr = 0.01`.\n3. Entrena hasta **15 épocas** con `DataLoader` (lotes de 64), guarda en `historial` la pérdida de validación de cada época y aplica **parada temprana** con paciencia 3: guarda una copia del `state_dict` cuando mejora (`copy.deepcopy`) y recupérala al terminar.\n4. Guarda `acc_test` (exactitud en prueba con los mejores pesos).',
    starter:
      'import copy\nimport torch\nfrom torch import nn\nfrom torch.utils.data import TensorDataset, DataLoader\nfrom sklearn.datasets import load_digits\nfrom sklearn.model_selection import train_test_split\n\ntorch.manual_seed(0)\nX, y = load_digits(return_X_y=True)\nX = torch.tensor(X / 16.0, dtype=torch.float32).reshape(-1, 1, 8, 8)\ny = torch.tensor(y)\nXtr, Xrest, ytr, yrest = train_test_split(X, y, test_size=0.4, random_state=0, stratify=y)\nXva, Xte, yva, yte = train_test_split(Xrest, yrest, test_size=0.5, random_state=0, stratify=yrest)\n\ndef evaluar(modelo, X, y):\n    modelo.eval()\n    with torch.no_grad():\n        salida = modelo(X)\n        return nn.functional.cross_entropy(salida, y).item(), (salida.argmax(dim=1) == y).float().mean().item()\n\nmodelo = None\nhistorial = []\nacc_test = None\n',
    check: all(
      truthy('any(isinstance(m, nn.Conv2d) for m in modelo.modules()) and any(isinstance(m, nn.MaxPool2d) for m in modelo.modules()) and any(isinstance(m, nn.Dropout) for m in modelo.modules())'),
      truthy('1 <= len(historial) <= 15'),
      truthy('acc_test >= 0.92'),
      truthy('modelo.training == False'),
    ),
    solution:
      'import copy\nimport torch\nfrom torch import nn\nfrom torch.utils.data import TensorDataset, DataLoader\nfrom sklearn.datasets import load_digits\nfrom sklearn.model_selection import train_test_split\n\ntorch.manual_seed(0)\nX, y = load_digits(return_X_y=True)\nX = torch.tensor(X / 16.0, dtype=torch.float32).reshape(-1, 1, 8, 8)\ny = torch.tensor(y)\nXtr, Xrest, ytr, yrest = train_test_split(X, y, test_size=0.4, random_state=0, stratify=y)\nXva, Xte, yva, yte = train_test_split(Xrest, yrest, test_size=0.5, random_state=0, stratify=yrest)\n\ndef evaluar(modelo, X, y):\n    modelo.eval()\n    with torch.no_grad():\n        salida = modelo(X)\n        return nn.functional.cross_entropy(salida, y).item(), (salida.argmax(dim=1) == y).float().mean().item()\n\nmodelo = nn.Sequential(\n    nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),\n    nn.Flatten(), nn.Dropout(0.2), nn.Linear(8 * 4 * 4, 10),\n)\nopt = torch.optim.AdamW(modelo.parameters(), lr=0.01, weight_decay=0.01)\nperdida = nn.CrossEntropyLoss()\ndl = DataLoader(TensorDataset(Xtr, ytr), batch_size=64, shuffle=True)\n\nhistorial = []\nmejor, mejores_pesos, espera = float("inf"), None, 0\nfor epoca in range(15):\n    modelo.train()\n    for xb, yb in dl:\n        opt.zero_grad()\n        perdida(modelo(xb), yb).backward()\n        opt.step()\n    val, _ = evaluar(modelo, Xva, yva)\n    historial.append(val)\n    if val < mejor:\n        mejor, mejores_pesos, espera = val, copy.deepcopy(modelo.state_dict()), 0\n    else:\n        espera += 1\n        if espera >= 3:\n            break\n\nmodelo.load_state_dict(mejores_pesos)\n_, acc_test = evaluar(modelo, Xte, yte)\n',
    hints: [
      'Modelo: `nn.Sequential(nn.Conv2d(1, 8, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), nn.Flatten(), nn.Dropout(0.2), nn.Linear(128, 10))`.',
      'En cada época: `modelo.train()`, el bucle de lotes con los cinco pasos y después `val, _ = evaluar(modelo, Xva, yva)`.',
      'Parada temprana: si `val < mejor` guarda `copy.deepcopy(modelo.state_dict())` y reinicia `espera`; si no, súmala y haz `break` al llegar a 3. Al final `modelo.load_state_dict(mejores_pesos)`.',
    ],
    explain:
      'Has hecho el proyecto completo de deep learning: datos en tensores, una CNN con dropout, optimizador con decaimiento de pesos, validación en cada época, parada temprana con recuperación de los mejores pesos y evaluación final en datos que nunca tocaste. Es exactamente el esqueleto de cualquier proyecto real; solo cambian los datos y el tamaño del modelo. En la siguiente zona verás cómo se representan palabras, frases e imágenes como vectores (embeddings) y cómo buscarlos.',
    commands: ['bucle de entrenamiento', 'nn.Conv2d', 'Dropout', 'parada temprana', 'decaimiento de pesos'],
  },
});

void [fill];
