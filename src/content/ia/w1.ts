import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyCode, pyDemo, pyOut, pyPractice, pyRepl, iaWorld } from './iabuild';
import { all, calls, outHas, stdout, truthy, uses, variable } from './iabuild';

/** Mensajes de ejemplo (con la etiqueta «es spam») que se usan en la zona. */
const MENSAJES = `mensajes = [
    ("Gana un premio gratis ahora", True),
    ("Reunión mañana a las 10", False),
    ("Oferta: iPhone gratis, haz clic", True),
    ("¿Cenamos hoy?", False),
    ("Tu factura de marzo está lista", False),
    ("URGENTE: verifica tu cuenta bancaria", True),
    ("Premio exclusivo para ti", True),
    ("Apuntes de la clase de hoy", False),
]`;

export const ia1 = iaWorld({
  id: 'ia1',
  index: 1,
  title: '¿Qué es la IA?',
  subtitle: 'Reglas, datos y aprender de ejemplos',
  emoji: '🧠',
  color: '#F472B6',
  level: 'basico',
  intro:
    'La inteligencia artificial no es magia ni robots con conciencia: es software que **aprende patrones a partir de ejemplos** en lugar de seguir reglas escritas a mano. En esta zona entenderás qué es (y qué no es) la IA, cómo se plantea un problema de aprendizaje, y entrenarás tus primeros «modelos» con unas pocas líneas de Python.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia1-1', { title: 'Reglas contra datos', summary: 'La diferencia entre programar reglas y aprender de ejemplos', emoji: '📏', commands: ['modelo', 'accuracy'], minutes: 9 }, [
      learn(
        'Dos formas de resolver un problema',
        `
Imagina que quieres que el correo separe el **spam**. Hay dos caminos:

1. **Reglas a mano**: escribes «si el mensaje contiene *gratis* o *premio* → es spam». Tú pones el conocimiento.
2. **Aprender de ejemplos**: le das miles de mensajes ya clasificados y un algoritmo **descubre solo** qué palabras y combinaciones delatan al spam.

La programación clásica es *reglas + datos → respuestas*. El **aprendizaje automático** (*machine learning*, ML) da la vuelta: *datos + respuestas → reglas*. Esas reglas aprendidas se llaman **modelo**.

> CLAVE: en ML no programas la solución: programas **cómo aprender** la solución a partir de datos.
`,
        '🧠',
      ),
      illus('ia-ai-ml-dl', 'IA, ML y deep learning', 'Son conjuntos anidados: toca cada círculo para ver qué añade y un ejemplo de cada uno.'),
      learn(
        'IA, ML, DL e IA generativa',
        `
Las palabras se mezclan mucho en las noticias, pero son **muñecas rusas**:

- **IA** (inteligencia artificial): cualquier técnica para que una máquina haga algo que parece inteligente. Incluye hasta un buscador de rutas con reglas.
- **ML** (aprendizaje automático): la parte de la IA que **aprende de datos**.
- **DL** (aprendizaje profundo): ML con **redes neuronales** de muchas capas. Domina imágenes, voz y texto.
- **IA generativa**: modelos de DL que **crean** contenido nuevo (texto, imágenes, código). Los **LLM** como los asistentes de chat son el ejemplo más famoso.

En este curso recorreremos todo el camino, de menos a más.
`,
        '🪆',
      ),
      mc('¿Cuál de estas afirmaciones es correcta?', ['Todo el ML es deep learning', 'Todo el deep learning es ML', 'La IA generativa no usa aprendizaje', 'Las reglas escritas a mano son ML'], 1, 'El deep learning es una parte del ML (que a su vez es parte de la IA). El resto de opciones invierten la relación o confunden reglas con aprendizaje.'),
      pyDemo(
        'Un filtro de spam con reglas',
        [
          [`${MENSAJES}`, 'Ocho mensajes con su etiqueta: `True` si son spam'],
          [
            `def es_spam(texto):
    t = texto.lower()
    return "gratis" in t or "premio" in t

for m, real in mensajes:
    print(es_spam(m), real, "←", m)`,
            'Una regla simple: acierta casi todo… pero se le escapa el mensaje de «URGENTE: verifica tu cuenta»',
          ],
        ],
      ),
      learn(
        'Por qué las reglas se quedan cortas',
        `
Las reglas a mano **funcionan** hasta que el mundo cambia: los spammers escriben «gr4tis», aparecen idiomas nuevos, o tu regla bloquea un correo legítimo que dice *«el premio de la rifa del cole»*.

Mantener miles de reglas es agotador. En cambio un modelo se **reentrena** con datos nuevos. Eso es lo que hace útil al ML cuando:

- el problema es **difícil de describir** con reglas (reconocer un gato en una foto),
- las reglas **cambian** con el tiempo,
- hay **muchos datos** de ejemplo disponibles.

Y cuando las reglas son simples y estables (calcular un IVA) …¡usa reglas! No todo problema necesita IA.
`,
        '⚖️',
      ),
      tf('Si un problema se puede resolver con unas pocas reglas claras y estables, lo ideal es entrenar una red neuronal.', false, 'Las reglas simples son más baratas, rápidas y fáciles de explicar. ML compensa cuando las reglas son demasiado difíciles de escribir o cambian con frecuencia.'),
      order('Ordena el flujo del aprendizaje automático:', ['datos', '+', 'respuestas', '→', 'reglas'], 'datos + respuestas → reglas', 'En ML entregas ejemplos con su respuesta correcta y el algoritmo produce las reglas (el modelo). En programación clásica entregas reglas + datos y obtienes respuestas.'),
      pyOut('¿Qué imprime esto?', 'def es_spam(t):\n    return "gratis" in t.lower()\n\nprint(es_spam("Café GRATIS"), es_spam("Hola"))', ['False False', 'True True', 'True'], 'Se pasa a minúsculas antes de buscar, así que «GRATIS» cuenta: `True` para el primero y `False` para el segundo.'),
      pyPractice({
        goal: 'Tu filtro de reglas',
        prompt: 'Escribe la función `es_spam(texto)` que devuelva `True` si el texto contiene la palabra **gratis** o **premio** (sin importar mayúsculas) y `False` en caso contrario.',
        starter: 'def es_spam(texto):\n    # devuelve True o False\n    pass\n',
        check: calls([
          ['es_spam("Gana un PREMIO")', 'True'],
          ['es_spam("Hola, ¿qué tal?")', 'False'],
          ['es_spam("Es gratis, entra ya")', 'True'],
          ['es_spam("Reunión a las 5")', 'False'],
        ]),
        solution: 'def es_spam(texto):\n    t = texto.lower()\n    return "gratis" in t or "premio" in t',
        hints: ['Pasa el texto a minúsculas con `.lower()` antes de buscar.', 'Usa `in` para comprobar si una palabra está dentro del texto y `or` para combinar las dos condiciones.'],
        explain: 'Convertir a minúsculas evita fallos por mayúsculas, y `"gratis" in t` es `True` si esa palabra aparece en cualquier parte del texto.',
        commands: ['modelo'],
      }),
      pyPractice({
        goal: 'Cuántos aciertos',
        prompt: 'Con tu función y la lista `mensajes`, calcula en `aciertos` **cuántos mensajes** clasifica bien (cuando `es_spam(texto)` coincide con la etiqueta real).',
        starter: `def es_spam(texto):
    t = texto.lower()
    return "gratis" in t or "premio" in t

${MENSAJES}

aciertos = 0
# recorre la lista y cuenta los aciertos
`,
        check: variable('aciertos', '7'),
        solution: `def es_spam(texto):
    t = texto.lower()
    return "gratis" in t or "premio" in t

${MENSAJES}

aciertos = 0
for texto, real in mensajes:
    if es_spam(texto) == real:
        aciertos += 1`,
        hints: ['Recorre con `for texto, real in mensajes:`.', 'Si `es_spam(texto) == real`, suma 1 a `aciertos`.'],
        explain: 'Comparar la predicción con la etiqueta real y contar coincidencias es la base de evaluar cualquier modelo. Aquí acierta 7 de 8.',
        commands: ['accuracy'],
      }),
      pyPractice({
        goal: 'Calcula la exactitud',
        prompt: 'La **exactitud** (*accuracy*) es la fracción de aciertos. Con `aciertos` y `total` ya calculados, imprime la exactitud como porcentaje con un decimal, por ejemplo `87.5%`.',
        starter: 'aciertos = 7\ntotal = 8\n# imprime la exactitud con formato de porcentaje\n',
        check: stdout('87.5%'),
        solution: 'aciertos = 7\ntotal = 8\nprint(f"{aciertos / total:.1%}")',
        hints: ['Divide `aciertos / total`.', 'El formato `:.1%` multiplica por 100 y añade el símbolo %: `f"{x:.1%}"`.'],
        explain: '`accuracy = aciertos / total`. El especificador `.1%` de las f-strings lo muestra como porcentaje con un decimal.',
        commands: ['accuracy'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia1-2', { title: 'Datos, features y etiquetas', summary: 'Cómo se representa un problema de aprendizaje: X e y', emoji: '🗂️', commands: ['features', 'etiquetas', 'np.array'], minutes: 9 }, [
      learn(
        'Una tabla de ejemplos',
        `
Un modelo no ve «un mensaje» ni «una casa»: ve **números**. Todo problema de ML se reduce a una tabla:

- Cada **fila** es un **ejemplo** (una casa, un cliente, una foto).
- Cada **columna de entrada** es una **característica** (*feature*): metros cuadrados, habitaciones, antigüedad…
- La **columna objetivo** es la **etiqueta** (*label*) o *target*: lo que quieres predecir (el precio).

Por convención, las características se llaman **X** (mayúscula: es una matriz) y las etiquetas **y** (minúscula: es un vector).
`,
        '🗂️',
      ),
      pyDemo(
        'X e y con NumPy',
        [
          [
            `import numpy as np

# columnas: metros, habitaciones, antigüedad (años)
X = np.array([[50, 2, 30],
              [80, 3, 10],
              [120, 4, 5],
              [65, 2, 20]])
y = np.array([90, 160, 280, 120])   # precio en miles`,
            'Cuatro casas (filas) con tres características (columnas)',
          ],
          ['print(X.shape, y.shape)', '`(4, 3)` = 4 ejemplos y 3 características; `y` tiene un valor por ejemplo'],
          ['print(X[:, 0])', '`X[:, 0]` selecciona una columna: los metros cuadrados de todas las casas'],
          ['print(X[1], "→", y[1])', 'La fila 1 (la segunda casa) con su etiqueta'],
        ],
      ),
      mc('Una tabla tiene 500 clientes y 8 columnas de datos, más una columna «se dio de baja». ¿Cuál es la forma de `X`?', ['(8, 500)', '(500, 8)', '(500, 9)', '(9,)'], 1, 'X tiene un ejemplo por fila (500) y una característica por columna (8). La columna «se dio de baja» es la etiqueta `y`, aparte.'),
      learn(
        'Regresión o clasificación',
        `
Según el tipo de **etiqueta**, el problema se llama distinto:

- **Regresión**: la etiqueta es un **número continuo**. Precio de una casa, temperatura de mañana, minutos de retraso.
- **Clasificación**: la etiqueta es una **categoría**. ¿Spam o no? ¿Perro, gato o pájaro? ¿Fraude o legítimo?

Truco para distinguirlos: ¿tiene sentido la respuesta «2,7»? Si sí (precio 2,7 millones) es regresión; si no (*«2,7 gatos»* no es una clase) es clasificación.
`,
        '🎯',
      ),
      match('Une cada problema con su tipo:', [['Predecir el precio de una casa', 'Regresión'], ['Decidir si una foto es de un perro o un gato', 'Clasificación'], ['Estimar los minutos de retraso de un tren', 'Regresión'], ['Marcar un pago como fraude o legítimo', 'Clasificación']], 'Si la salida es un número que puede tomar casi cualquier valor es regresión; si es una etiqueta de un conjunto cerrado de categorías es clasificación.'),
      multi('¿Cuáles de estas columnas serían buenas **features** para predecir el precio de una casa?', ['Metros cuadrados', 'Barrio', 'El precio de venta final', 'Año de construcción'], [0, 1, 3], 'El precio final es lo que quieres predecir (la etiqueta): usarlo como feature sería hacer trampa (se llama *fuga de datos*). El resto son información disponible antes de vender.'),
      pyDemo('Del registro a la matriz', [
        pyRepl(
        `import numpy as np
datos = [("Ana", 50, 90), ("Luis", 80, 160), ("Eva", 120, 280)]
X = np.array([[m] for _, m, _ in datos])
y = np.array([p for _, _, p in datos])
X
y
X.shape`,
        'Convertir una lista de registros en la matriz X (una columna) y el vector y',
        ),
      ]),
      pyOut('¿Qué imprime?', 'import numpy as np\nX = np.array([[1, 2], [3, 4], [5, 6]])\nprint(X.shape)\nprint(X[:, 1])', ['(2, 3)\n[2 4 6]', '(3, 2)\n[1 3 5]', '(3, 2)\n[3 4]'], 'Hay 3 filas y 2 columnas → `(3, 2)`. `X[:, 1]` toma la columna 1 (la segunda): `[2 4 6]`.'),
      pyPractice({
        goal: 'Construye X e y',
        prompt: 'Con la lista `casas` (metros, habitaciones, precio), construye `X` (un array de 2 columnas: metros y habitaciones) e `y` (un array con los precios).',
        starter: 'import numpy as np\n\ncasas = [(50, 2, 90), (80, 3, 160), (120, 4, 280), (65, 2, 120)]\n\nX = None\ny = None\n',
        check: all(variable('X.tolist()', '[[50, 2], [80, 3], [120, 4], [65, 2]]'), variable('y.tolist()', '[90, 160, 280, 120]')),
        solution: 'import numpy as np\n\ncasas = [(50, 2, 90), (80, 3, 160), (120, 4, 280), (65, 2, 120)]\n\nX = np.array([[m, h] for m, h, _ in casas])\ny = np.array([p for _, _, p in casas])',
        hints: ['Con una lista por comprensión puedes sacar `[m, h]` de cada casa.', '`X = np.array([[m, h] for m, h, _ in casas])` y `y = np.array([p for _, _, p in casas])`.'],
        explain: 'Cada casa aporta una fila de X (sus características) y un elemento de y (su etiqueta). `np.array` convierte las listas en arrays con forma `(n_ejemplos, n_features)` y `(n_ejemplos,)`.',
        commands: ['np.array', 'features'],
      }),
      pyPractice({
        goal: 'Separa la columna objetivo',
        prompt: 'Tienes la tabla `datos` donde **la última columna es la etiqueta**. Sepárala: `X` debe contener todas las columnas menos la última e `y` solo la última.',
        starter: 'import numpy as np\n\ndatos = np.array([[50, 2, 90], [80, 3, 160], [120, 4, 280]])\n\nX = None\ny = None\n',
        check: all(variable('X.tolist()', '[[50, 2], [80, 3], [120, 4]]'), variable('y.tolist()', '[90, 160, 280]')),
        solution: 'import numpy as np\n\ndatos = np.array([[50, 2, 90], [80, 3, 160], [120, 4, 280]])\n\nX = datos[:, :-1]\ny = datos[:, -1]',
        hints: ['`datos[:, :-1]` = todas las filas, todas las columnas menos la última.', '`datos[:, -1]` = todas las filas, solo la última columna.'],
        explain: 'Este corte es el primer gesto de casi todo proyecto de ML: `X = tabla[:, :-1]` e `y = tabla[:, -1]`.',
        commands: ['etiquetas', 'features'],
      }),
      pyPractice({
        goal: '¿Cuántos ejemplos y features?',
        prompt: 'Dado `X`, imprime en dos líneas: el número de ejemplos y el número de características (usa `X.shape`).',
        starter: 'import numpy as np\n\nX = np.zeros((120, 7))\n# imprime n_ejemplos y luego n_features\n',
        check: stdout('120\n7'),
        solution: 'import numpy as np\n\nX = np.zeros((120, 7))\nn_ejemplos, n_features = X.shape\nprint(n_ejemplos)\nprint(n_features)',
        hints: ['`X.shape` es una tupla `(filas, columnas)`.', 'Puedes desempaquetarla: `n, d = X.shape`.'],
        explain: '`X.shape[0]` son los ejemplos y `X.shape[1]` las características. Verás estas dos cifras constantemente.',
        commands: ['np.array'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia1-3', { title: 'Tipos de aprendizaje', summary: 'Supervisado, no supervisado y por refuerzo', emoji: '🧭', commands: ['aprendizaje supervisado', 'aprendizaje no supervisado', 'aprendizaje por refuerzo'], minutes: 10 }, [
      learn(
        'Con maestro, sin maestro, con premios',
        `
Hay tres grandes familias de aprendizaje automático:

- **Supervisado**: tienes ejemplos **con respuesta** (etiquetas). El modelo aprende a predecirlas. Es el más común: spam, precios, diagnósticos.
- **No supervisado**: solo hay datos **sin etiquetas**. El modelo busca estructura por su cuenta: grupos de clientes parecidos, anomalías, resúmenes.
- **Por refuerzo**: un **agente** actúa en un entorno, recibe **recompensas** o castigos y aprende una estrategia. Así se entrenan robots y programas que juegan.

A estas se suma el **aprendizaje autosupervisado**, clave en los LLM: las etiquetas salen de los propios datos (predecir la siguiente palabra del texto).
`,
        '🧭',
      ),
      illus('ia-learning-types', 'Tres maneras de aprender', 'Toca cada familia y mira qué datos necesita, qué produce y un ejemplo cotidiano.'),
      match('Une cada situación con su tipo de aprendizaje:', [['Predecir si un cliente se dará de baja con datos históricos ya etiquetados', 'Supervisado'], ['Agrupar clientes parecidos sin saber de antemano los grupos', 'No supervisado'], ['Un robot aprende a caminar probando y recibiendo recompensas', 'Por refuerzo'], ['Detectar transacciones anómalas sin ejemplos de fraude', 'No supervisado']], 'Con etiquetas → supervisado. Sin etiquetas buscando estructura → no supervisado. Aprender actuando con recompensas → refuerzo.'),
      pyDemo(
        'No supervisado: asignar a grupos',
        [
          [
            `import numpy as np
# dos "centros" que conocemos de otras veces
centros = np.array([[1.0, 1.0], [5.0, 5.0]])
puntos = np.array([[0.8, 1.3], [4.7, 5.2], [1.5, 0.7], [5.5, 4.4]])`,
            'No hay etiquetas: solo puntos y dos centros candidatos',
          ],
          ['d = np.linalg.norm(puntos[:, None, :] - centros[None, :, :], axis=2)\nprint(np.round(d, 2))', 'Distancia de cada punto (fila) a cada centro (columna)'],
          ['print(d.argmin(axis=1))', 'Cada punto se asigna al centro más cercano: así funciona k-means en cada paso'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\nd = np.array([[0.5, 4.0], [3.9, 0.2], [0.1, 6.0]])\nprint(d.argmin(axis=1))', ['[0 0 0]', '[1 0 1]', '[1 1 0]'], '`argmin(axis=1)` devuelve, para cada fila, la posición de la columna con el valor menor: fila 0 → columna 0, fila 1 → columna 1, fila 2 → columna 0.'),
      learn(
        'Refuerzo: aprender probando',
        `
En el aprendizaje por refuerzo no hay respuestas correctas, solo **recompensas** que llegan después. Un ejemplo clásico es el **bandido de varios brazos**: tienes varias máquinas tragaperras con probabilidades distintas (que no conoces) y quieres ganar lo máximo.

Dilema central: **explorar** (probar máquinas nuevas por si son mejores) o **explotar** (seguir con la que parece mejor). Una estrategia sencilla es **ε-greedy**: casi siempre eliges la mejor conocida, pero un ε % de las veces pruebas al azar.
`,
        '🎰',
      ),
      pyDemo(
        'Un bandido ε-greedy',
        [
          [
            `import numpy as np
rng = np.random.default_rng(0)
prob = np.array([0.2, 0.5, 0.8])   # lo que el agente NO sabe
est = np.zeros(3)                  # sus estimaciones
n = np.zeros(3)
for paso in range(300):
    a = rng.integers(3) if rng.random() < 0.1 else est.argmax()
    r = float(rng.random() < prob[a])   # recompensa 0 o 1
    n[a] += 1
    est[a] += (r - est[a]) / n[a]       # media incremental`,
            '300 jugadas: elige casi siempre la mejor estimada y a veces explora',
          ],
          ['print(np.round(est, 2))\nprint(n.astype(int))', 'Con la práctica descubre que la máquina 2 es la mejor y juega casi todas las veces con ella'],
        ],
      ),
      tf('En el aprendizaje por refuerzo el modelo recibe, para cada ejemplo, la respuesta correcta.', false, 'En refuerzo solo hay recompensas (a veces tardías). No existe una «respuesta correcta» por ejemplo: el agente la descubre explorando.'),
      pyPractice({
        goal: 'Asigna al grupo más cercano',
        prompt: 'Dados los `puntos` y los `centros` (arrays 2D), calcula en `grupo` un array con el índice del centro más cercano a cada punto. La matriz de distancias `d` ya está calculada.',
        starter: 'import numpy as np\n\ncentros = np.array([[0.0, 0.0], [10.0, 10.0]])\npuntos = np.array([[1.0, 2.0], [9.0, 8.0], [0.5, 0.5], [7.0, 9.0]])\nd = np.linalg.norm(puntos[:, None, :] - centros[None, :, :], axis=2)\n\ngrupo = None\n',
        check: variable('grupo.tolist()', '[0, 1, 0, 1]'),
        solution: 'import numpy as np\n\ncentros = np.array([[0.0, 0.0], [10.0, 10.0]])\npuntos = np.array([[1.0, 2.0], [9.0, 8.0], [0.5, 0.5], [7.0, 9.0]])\nd = np.linalg.norm(puntos[:, None, :] - centros[None, :, :], axis=2)\n\ngrupo = d.argmin(axis=1)',
        hints: ['Cada fila de `d` contiene las distancias de un punto a todos los centros.', '`d.argmin(axis=1)` te da el índice del mínimo de cada fila.'],
        explain: 'Asignar cada punto a su centro más cercano es el primer paso de k-means. Sin ninguna etiqueta, ya estamos agrupando.',
        commands: ['aprendizaje no supervisado'],
      }),
      pyPractice({
        goal: 'La mejor máquina',
        prompt: 'El registro `jugadas` guarda `(máquina, recompensa)`. Calcula en `media` un diccionario con la recompensa media de cada máquina (`{0: ..., 1: ..., 2: ...}`) y en `mejor` la máquina con la media más alta.',
        starter: 'jugadas = [(0, 0), (1, 1), (2, 1), (0, 0), (1, 0), (2, 1), (1, 1), (2, 0), (0, 1), (2, 1)]\n\nmedia = {}\nmejor = None\n',
        check: all(variable('media', '{0: 0.3333333333333333, 1: 0.6666666666666666, 2: 0.75}'), variable('mejor', '2')),
        solution: 'jugadas = [(0, 0), (1, 1), (2, 1), (0, 0), (1, 0), (2, 1), (1, 1), (2, 0), (0, 1), (2, 1)]\n\nmedia = {}\nfor m in {m for m, _ in jugadas}:\n    rs = [r for mm, r in jugadas if mm == m]\n    media[m] = sum(rs) / len(rs)\nmejor = max(media, key=media.get)',
        hints: ['Recorre las máquinas distintas y reúne las recompensas de cada una.', 'La media es `sum(rs) / len(rs)`; la mejor es `max(media, key=media.get)`.'],
        explain: 'Estimar el valor de cada acción con las recompensas observadas es el corazón del refuerzo. `max(..., key=media.get)` devuelve la clave con mayor valor.',
        commands: ['aprendizaje por refuerzo'],
      }),
      pyCode('Escribe una expresión que cuente cuántas distancias de `d` son menores que 1.', {
        starter: 'import numpy as np\nd = np.array([0.4, 2.5, 0.9, 3.1, 0.2])\nmenores = None',
        check: variable('menores', '3'),
        solution: 'import numpy as np\nd = np.array([0.4, 2.5, 0.9, 3.1, 0.2])\nmenores = (d < 1).sum()',
        hint: '`d < 1` da un array de booleanos; `.sum()` cuenta los `True`.',
        why: 'Las comparaciones de NumPy producen arrays de booleanos y `.sum()` los cuenta (True = 1). Es la forma estándar de contar sin bucles.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia1-4', { title: 'Tu primer modelo', summary: 'Entrenar = buscar los parámetros que menos se equivocan', emoji: '🎓', commands: ['baseline', 'entrenar y predecir', 'modelo'], minutes: 11 }, [
      learn(
        'Entrenar es buscar',
        `
Un **modelo** es una función con **parámetros** ajustables. **Entrenar** es encontrar los valores de esos parámetros que cometen **menos error** con los datos de ejemplo.

Para hacerlo necesitas tres ingredientes:

1. Un **modelo**: la forma de la función (por ejemplo «una recta»: \`y = w·x + b\`).
2. Una **pérdida**: un número que mide cuánto se equivoca (por ejemplo, el error medio).
3. Un **método de búsqueda**: cómo mover los parámetros para bajar la pérdida (probar todos, descenso del gradiente…).

> CLAVE: *entrenar = minimizar la pérdida sobre los datos*. Todo lo demás son variaciones de esto.
`,
        '🎓',
      ),
      learn(
        'El modelo más tonto: la media',
        `
Antes de entrenar nada hay que saber **cuánto vale el modelo más simple posible**. Para regresión es predecir siempre **la media** de las etiquetas; para clasificación, siempre **la clase más frecuente**. A ese punto de partida se le llama **baseline** (línea base).

Si tu modelo fantástico no mejora al baseline, no está aprendiendo nada útil. Medir el baseline es lo primero que hace un buen profesional.
`,
        '📏',
      ),
      pyDemo(
        'Baseline y error medio',
        [
          ['import numpy as np\nhoras = np.array([1, 2, 3, 4, 5, 6])\nnota = np.array([3.0, 4.5, 5.5, 7.0, 8.0, 9.5])', 'Horas de estudio y nota obtenida'],
          ['pred = np.full(6, nota.mean())\nprint(pred)\nprint(round(float(np.abs(pred - nota).mean()), 3))', 'Baseline: predecir siempre la media. Error absoluto medio ≈ 1.9 puntos'],
          ['pred2 = 1.2 * horas + 2\nprint(np.round(pred2, 1))\nprint(round(float(np.abs(pred2 - nota).mean()), 3))', 'Un modelo con una pendiente reduce el error a ≈ 0.28: **aprende algo** más que el baseline'],
        ],
      ),
      mc('Un modelo de ventas se equivoca de media 120 unidades; predecir siempre la media se equivoca 100. ¿Qué concluyes?', ['El modelo es muy bueno', 'El modelo es peor que no hacer nada inteligente', 'Hace falta más hardware', 'No se puede comparar'], 1, 'El baseline (la media) se equivoca menos que tu modelo, así que éste no ha aprendido nada útil. Hay que revisar los datos o el método.'),
      learn(
        'Entrenar probando umbrales',
        `
Veamos entrenar de forma literal. Queremos predecir si un alumno **aprueba** a partir de las horas que estudió. El modelo más simple es un **umbral**: *«si horas ≥ t → aprueba»*. El único parámetro es \`t\`.

Entrenar = probar muchos valores de \`t\` y quedarse con el que **más aciertos** tiene en los datos de ejemplo. Parece de juguete… pero es exactamente lo que hace un **árbol de decisión** en cada nodo.
`,
        '🔍',
      ),
      pyDemo(
        'Aprender un umbral a fuerza bruta',
        [
          ['import numpy as np\nhoras = np.array([0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7])\naprobo = np.array([0, 0, 0, 0, 1, 0, 1, 1, 1, 1])', 'Nótese el alumno raro: 3.5 horas y suspendió'],
          ['for t in [1, 2, 2.5, 3, 4, 5]:\n    pred = (horas >= t).astype(int)\n    print(t, (pred == aprobo).mean())', 'Probamos umbrales y miramos la exactitud de cada uno'],
          ['mejor = max([1, 2, 2.5, 3, 4, 5], key=lambda t: ((horas >= t) == aprobo).mean())\nprint("mejor umbral:", mejor)', 'El modelo «entrenado» es el umbral con más aciertos'],
        ],
      ),
      tf('Si tu modelo y el baseline (predecir la media) tienen el mismo error, el modelo ha aprendido algo útil.', false, 'Si no mejora al baseline, no ha aprendido nada que la media no sepa ya. Un modelo solo vale si supera a la línea base.'),
      order('Ordena el esquema de entrenar un modelo:', ['elegir', 'el', 'modelo', 'medir', 'el', 'error', 'ajustar', 'parámetros'], 'elegir el modelo medir el error ajustar parámetros', 'Primero decides la forma del modelo, luego mides cuánto se equivoca (pérdida) y después ajustas los parámetros para bajarla. Esto se repite hasta que el error deja de bajar.'),
      pyPractice({
        goal: 'Mide el baseline',
        prompt: 'Con el array `precios`, calcula en `error_base` el **error absoluto medio** de un modelo que siempre predice la media de `precios`.',
        starter: 'import numpy as np\n\nprecios = np.array([100.0, 150.0, 200.0, 250.0])\n\nerror_base = None\n',
        check: variable('float(error_base)', '50.0'),
        solution: 'import numpy as np\n\nprecios = np.array([100.0, 150.0, 200.0, 250.0])\n\nerror_base = np.abs(precios - precios.mean()).mean()',
        hints: ['La media es `precios.mean()` y el error de cada ejemplo es `|precio − media|`.', '`np.abs(precios - precios.mean()).mean()`.'],
        explain: 'Es el error absoluto medio (MAE) del modelo «predice siempre la media». Cualquier modelo serio debe mejorarlo.',
        commands: ['baseline'],
      }),
      pyPractice({
        goal: 'Entrena un umbral',
        prompt: 'Escribe `mejor_umbral(x, y)`: prueba como umbral cada valor distinto de `x` (de menor a mayor) y devuelve el que logre **más aciertos** con la regla `x >= t → 1`. Si hay empate, devuelve el menor.',
        starter: 'import numpy as np\n\ndef mejor_umbral(x, y):\n    pass\n',
        check: calls([
          ['mejor_umbral(np.array([0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7]), np.array([0, 0, 0, 0, 1, 0, 1, 1, 1, 1]))', '3.0'],
          ['mejor_umbral(np.array([1, 2, 3, 4]), np.array([0, 0, 1, 1]))', '3'],
        ]),
        solution: 'import numpy as np\n\ndef mejor_umbral(x, y):\n    mejor, mejor_acc = None, -1\n    for t in sorted(set(x.tolist())):\n        acc = ((x >= t) == y).mean()\n        if acc > mejor_acc:\n            mejor, mejor_acc = t, acc\n    return mejor',
        hints: ['Recorre `sorted(set(x.tolist()))` y calcula `((x >= t) == y).mean()` para cada `t`.', 'Guarda el `t` con mayor exactitud; usa `>` (estricto) para que en empate gane el menor.'],
        explain: 'Entrenar es una búsqueda: probar parámetros candidatos y quedarse con el que minimiza el error (o maximiza los aciertos). Los árboles de decisión hacen esto en cada división.',
        commands: ['entrenar y predecir'],
      }),
      pyPractice({
        goal: 'Predice con el modelo entrenado',
        prompt: 'Con el umbral `t = 3` ya aprendido, usa `predecir(x)` para devolver un array de 0/1 (1 si `x >= t`). Después imprime las predicciones para `[1, 2.5, 3, 8]`.',
        starter: 'import numpy as np\n\nt = 3\n\ndef predecir(x):\n    pass\n\nprint(predecir(np.array([1, 2.5, 3, 8])))\n',
        check: stdout('[0 0 1 1]'),
        solution: 'import numpy as np\n\nt = 3\n\ndef predecir(x):\n    return (x >= t).astype(int)\n\nprint(predecir(np.array([1, 2.5, 3, 8])))',
        hints: ['La comparación `x >= t` da booleanos; conviértelos con `.astype(int)`.', '`return (x >= t).astype(int)`.'],
        explain: 'Una vez entrenado, el modelo es solo una función: `predecir`. Los parámetros aprendidos (aquí `t`) quedan «congelados» dentro.',
        commands: ['entrenar y predecir'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia1-5', { title: 'No te engañes: entrenar y probar', summary: 'Conjunto de prueba, sobreajuste y sesgo-varianza', emoji: '🧪', commands: ['train/test split', 'sobreajuste', 'np.polyfit'], minutes: 12 }, [
      learn(
        'Memorizar no es aprender',
        `
Un alumno que **memoriza** las respuestas del examen de ayer clava ese examen, pero suspende el de hoy. Los modelos hacen lo mismo: pueden **memorizar** los datos de entrenamiento y fallar con datos nuevos. A eso se le llama **sobreajuste** (*overfitting*).

Lo que importa no es el acierto con los datos que ya vio, sino la **generalización**: acertar con datos **que nunca ha visto**.

Por eso se **separan los datos**: la mayoría para **entrenar** y una parte que el modelo **no puede tocar** para **probar** (*test*). El acierto en test es la estimación honesta de lo que pasará en el mundo real.
`,
        '🧪',
      ),
      illus('ia-split', 'Entrenar y probar', 'Mueve el reparto entre entrenamiento y prueba y observa cómo una regla de memoria brilla en entrenamiento pero se hunde en prueba.'),
      pyDemo(
        'Dividir los datos',
        [
          ['import numpy as np\nrng = np.random.default_rng(42)\nx = np.arange(10)\nidx = rng.permutation(10)\nprint(idx)', 'Primero barajamos los índices: así no depende del orden original'],
          ['train, test = idx[:8], idx[8:]\nprint("train:", sorted(train.tolist()))\nprint("test: ", sorted(test.tolist()))', 'El 80 % para entrenar y el 20 % para probar, sin solaparse'],
        ],
      ),
      mc('Entrenas un modelo y obtienes 100 % de aciertos en entrenamiento y 62 % en prueba. ¿Qué pasa?', ['Está perfecto', 'Sobreajuste: memorizó el entrenamiento', 'Infraajuste: es demasiado simple', 'Los datos de prueba están mal'], 1, 'Una gran diferencia entre entrenamiento y prueba es la señal típica del sobreajuste: el modelo se ajustó al ruido del entrenamiento y no generaliza.'),
      learn(
        'Demasiado simple, demasiado complejo',
        `
Ajustar un modelo es un equilibrio entre dos errores:

- **Infraajuste** (*underfitting*): el modelo es demasiado simple (una recta para datos curvos). Falla **también** en entrenamiento. Tiene mucho **sesgo**.
- **Sobreajuste** (*overfitting*): el modelo es demasiado flexible (una curva que pasa por todos los puntos, ruido incluido). Brilla en entrenamiento y falla en prueba. Tiene mucha **varianza**.

El punto dulce está en medio. En ML casi todo —regularización, validación cruzada, más datos, ensambles— es una herramienta para encontrarlo.
`,
        '⚖️',
      ),
      illus('ia-fit-curve', 'Infraajuste y sobreajuste', 'Sube el grado del polinomio: el error de entrenamiento siempre baja, pero el de prueba baja… y luego sube.'),
      pyDemo(
        'Polinomios de distinto grado',
        [
          [
            `import numpy as np
rng = np.random.default_rng(1)
x = np.linspace(0, 1, 20)
y = np.sin(2 * np.pi * x) + rng.normal(0, 0.2, 20)
xt, yt = x[::2], y[::2]     # entrenamiento
xs, ys = x[1::2], y[1::2]   # prueba`,
            'Datos con ruido; separamos las posiciones pares (train) de las impares (test)',
          ],
          [
            `for g in [1, 3, 9]:
    c = np.polyfit(xt, yt, g)
    e_tr = np.mean((np.polyval(c, xt) - yt) ** 2)
    e_te = np.mean((np.polyval(c, xs) - ys) ** 2)
    print(g, round(float(e_tr), 3), round(float(e_te), 3))`,
            'Grado 1: error alto en ambos (infraajuste). Grado 3: bien. Grado 9: error de train ínfimo pero el de test explota (sobreajuste)',
          ],
        ],
      ),
      tf('Un modelo que acierta el 100 % en los datos de entrenamiento es siempre el mejor.', false, 'Puede haber memorizado el ruido. Lo importante es el rendimiento en datos que no ha visto (prueba).'),
      fill('Completa: el error del modelo en datos nuevos se estima con el conjunto de ___.', 'Estimamos el rendimiento real con el conjunto de ___.', ['prueba', 'entrenamiento', 'baseline', 'etiquetas'], ['prueba'], 'El conjunto de prueba nunca se usa para entrenar: es la única estimación honesta de cómo se comportará el modelo con datos nuevos.'),
      pyPractice({
        goal: 'Divide en entrenamiento y prueba',
        prompt: 'Dados `X` e `y` (10 ejemplos), usa los **últimos 3** como prueba y el resto como entrenamiento: crea `X_train`, `X_test`, `y_train`, `y_test`.',
        starter: 'import numpy as np\n\nX = np.arange(20).reshape(10, 2)\ny = np.arange(10)\n\nX_train = X_test = y_train = y_test = None\n',
        check: all(variable('X_train.shape', '(7, 2)'), variable('X_test.shape', '(3, 2)'), variable('y_test.tolist()', '[7, 8, 9]'), variable('y_train.tolist()', '[0, 1, 2, 3, 4, 5, 6]')),
        solution: 'import numpy as np\n\nX = np.arange(20).reshape(10, 2)\ny = np.arange(10)\n\nX_train, X_test = X[:-3], X[-3:]\ny_train, y_test = y[:-3], y[-3:]',
        hints: ['`X[:-3]` son todas las filas menos las 3 últimas y `X[-3:]` son solo las 3 últimas.', 'Haz lo mismo con `y`.'],
        explain: 'Cortar con `[:-n]` y `[-n:]` es la división más simple. En la práctica se baraja antes (si los datos están ordenados) con `train_test_split`.',
        commands: ['train/test split'],
      }),
      pyPractice({
        goal: 'Detecta el sobreajuste',
        prompt: 'Escribe `diagnostico(acc_train, acc_test)` que devuelva `"sobreajuste"` si el acierto de entrenamiento supera al de prueba en **más de 0.15**, `"infraajuste"` si **ambos** están por debajo de 0.7, y `"bien"` en cualquier otro caso (comprueba en este orden).',
        starter: 'def diagnostico(acc_train, acc_test):\n    pass\n',
        check: calls([
          ['diagnostico(1.0, 0.62)', "'sobreajuste'"],
          ['diagnostico(0.6, 0.58)', "'infraajuste'"],
          ['diagnostico(0.9, 0.86)', "'bien'"],
          ['diagnostico(0.7, 0.69)', "'bien'"],
        ]),
        solution: 'def diagnostico(acc_train, acc_test):\n    if acc_train - acc_test > 0.15:\n        return "sobreajuste"\n    if acc_train < 0.7 and acc_test < 0.7:\n        return "infraajuste"\n    return "bien"',
        hints: ['Primero la comprobación del sobreajuste (diferencia grande) y luego la del infraajuste.', 'Para el infraajuste ambos valores deben ser menores que 0.7: usa `and`.'],
        explain: 'Comparar entrenamiento y prueba es el diagnóstico básico: brecha grande → varianza (sobreajuste); ambos malos → sesgo (infraajuste).',
        commands: ['sobreajuste'],
      }),
      pyPractice({
        goal: 'Elige el grado con el test',
        prompt: 'Con los datos ya divididos (`xt, yt` entrenamiento; `xs, ys` prueba), calcula en `errores` un diccionario `{grado: error_en_prueba}` para los grados 1 a 6 (error cuadrático medio con `np.polyfit`/`np.polyval`) y en `mejor` el grado con menor error en prueba.',
        starter: `import numpy as np
rng = np.random.default_rng(1)
x = np.linspace(0, 1, 20)
y = np.sin(2 * np.pi * x) + rng.normal(0, 0.2, 20)
xt, yt = x[::2], y[::2]
xs, ys = x[1::2], y[1::2]

errores = {}
mejor = None
`,
        check: truthy('sorted(errores) == [1, 2, 3, 4, 5, 6] and mejor == min(errores, key=errores.get) and mejor in (3, 4, 5)'),
        solution: `import numpy as np
rng = np.random.default_rng(1)
x = np.linspace(0, 1, 20)
y = np.sin(2 * np.pi * x) + rng.normal(0, 0.2, 20)
xt, yt = x[::2], y[::2]
xs, ys = x[1::2], y[1::2]

errores = {}
for g in range(1, 7):
    c = np.polyfit(xt, yt, g)
    errores[g] = np.mean((np.polyval(c, xs) - ys) ** 2)
mejor = min(errores, key=errores.get)`,
        hints: ['Para cada grado: `c = np.polyfit(xt, yt, g)` y el error en prueba es `np.mean((np.polyval(c, xs) - ys) ** 2)`.', '`mejor = min(errores, key=errores.get)`.'],
        explain: 'Elegir la complejidad del modelo mirando el error en datos de prueba es exactamente el papel del conjunto de validación. (En la práctica se usa un conjunto aparte para no «gastar» el de test.)',
        commands: ['np.polyfit', 'sobreajuste'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: tu primer clasificador',
    prompt:
      'Entrena un clasificador de umbral y evalúalo con honestidad. Con `horas` y `aprobo`, usa las **primeras 8** posiciones para entrenar y las **últimas 4** para probar. Define `mejor_umbral(x, y)` (el umbral `t` entre los valores de `x` con más aciertos para `x >= t → 1`; en empate, el menor) y calcula `acc_train` y `acc_test`.',
    starter:
      'import numpy as np\n\nhoras = np.array([0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7, 2.5, 4.5])\naprobo = np.array([0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1])\n\ndef mejor_umbral(x, y):\n    pass\n\nacc_train = acc_test = None\n',
    check: all(variable('float(acc_train)', '0.875'), variable('float(acc_test)', '1.0'), calls([['mejor_umbral(np.array([1, 2, 3, 4]), np.array([0, 0, 1, 1]))', '3']])),
    solution:
      'import numpy as np\n\nhoras = np.array([0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7, 2.5, 4.5])\naprobo = np.array([0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1])\n\ndef mejor_umbral(x, y):\n    mejor, mejor_acc = None, -1\n    for t in sorted(set(x.tolist())):\n        acc = ((x >= t) == y).mean()\n        if acc > mejor_acc:\n            mejor, mejor_acc = t, acc\n    return mejor\n\nx_tr, y_tr = horas[:8], aprobo[:8]\nx_te, y_te = horas[-4:], aprobo[-4:]\nt = mejor_umbral(x_tr, y_tr)\nacc_train = ((x_tr >= t) == y_tr).mean()\nacc_test = ((x_te >= t) == y_te).mean()',
    hints: ['Divide con cortes: `horas[:8]` / `horas[-4:]` (y lo mismo para `aprobo`).', 'Entrena `t = mejor_umbral(x_tr, y_tr)` solo con el entrenamiento.', 'Evalúa `((x >= t) == y).mean()` en cada conjunto.'],
    explain: 'Has hecho el ciclo completo del ML supervisado en miniatura: dividir, entrenar con una parte, evaluar con la otra. Verás lo mismo con scikit-learn, árboles y redes neuronales.',
    commands: ['train/test split', 'entrenar y predecir', 'accuracy'],
  },
});

// evita que el linter marque imports sin uso cuando se editan las lecciones
void [outHas, uses, pyCode];
