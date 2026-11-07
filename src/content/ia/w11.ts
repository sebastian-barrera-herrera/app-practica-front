import { all, calls, fill, iaWorld, illus, learn, lesson, match, mc, multi, order, pyDemo, pyOut, pyPractice, tf, truthy } from './iabuild';

/** Recursos de NumPy que se repiten en las lecciones de atención. */
const SOFTMAX = `def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)
`;

export const ia11 = iaWorld({
  id: 'ia11',
  index: 11,
  title: 'Transformers y LLMs',
  subtitle: 'Tokens, atención, el bloque Transformer, generación de texto y cómo se entrena un asistente',
  emoji: '🤖',
  color: '#A78BFA',
  level: 'avanzado',
  intro:
    'ChatGPT, Claude, Gemini o Llama son **modelos de lenguaje grandes** (*LLM*). Por dentro todos hacen lo mismo: leen una secuencia de **tokens** y calculan la probabilidad del **siguiente token**. Lo que los hizo posibles fue una idea de 2017: la **atención**, que deja a cada palabra mirar directamente a las demás, y la arquitectura **Transformer** que la apila. En esta zona lo construirás con NumPy: aprenderás qué es un token y cómo se aprende un vocabulario (BPE), programarás la atención y un bloque completo, verás cómo se **genera** texto (temperatura, top-k, top-p) y cómo se pasa de un modelo que solo continúa frases a un **asistente** (preentrenamiento, ajuste con instrucciones, alineación). No es un LLM real —sin entrenar no dice nada con sentido—, pero cada pieza es la misma que usan los de verdad.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia11-1', { title: 'Tokens: cómo lee un LLM', summary: 'Texto → tokens → números, el algoritmo BPE y por qué los tokens son la moneda de los LLM', emoji: '🔤', commands: ['token', 'BPE', 'get_encoding', 'contar_tokens'], minutes: 14 }, [
      learn(
        'Ni letras ni palabras: tokens',
        `
Una red neuronal solo procesa números. Para que un LLM lea texto hay que convertirlo en una **secuencia de enteros**. ¿Un número por letra? Las secuencias serían larguísimas. ¿Un número por palabra? El vocabulario sería enorme y fallaría con palabras nuevas, plurales, erratas o nombres propios.

La solución intermedia es el **token**: un trozo de texto de tamaño variable. Las palabras frecuentes son *un* token (\`" casa"\`); las raras se parten en piezas (\`"anti" + "constitu" + "cional"\`); los números y las cadenas extrañas pueden ir casi carácter a carácter. Cada modelo tiene un **vocabulario** fijo (de 30 000 a más de 200 000 tokens) y un **tokenizador** que traduce entre texto e ids.

El tokenizador más usado se aprende con **BPE** (*byte pair encoding*): empieza con caracteres sueltos y repite *«busca el par de símbolos adyacentes que más se repite y fúndelo en un símbolo nuevo»*. Así las secuencias frecuentes acaban siendo un solo token.
`,
        '🔤',
      ),
      illus('ia-bpe', 'Fusiona pares y mira cómo crece el vocabulario', 'Avanza las fusiones una a una. Fíjate en qué par gana cada ronda y en cómo se trocean las palabras nuevas con la prueba de abajo.'),
      pyDemo(
        'Entrenar un mini tokenizador BPE',
        [
          [
            `from dojo_ai.tokenizer import BPETokenizer

textos = ["bajo bajo bajo bajo", "baja baja baja", "bajar bajar", "subo subo", "subir subir"]
t = BPETokenizer.entrenar(textos, num_merges=8)
for i, m in enumerate(t.merges, 1):
    print(i, m)
print(t.tokens("bajo"))
print(t.tokens("bajista"))
print(t.tokens("subo"))
print(t.vocab_size)`,
            'Las fusiones salen por orden de frecuencia: primero `a+j` (aparece en bajo, baja y bajar), luego `b+aj`… «bajo» acaba siendo **un** token. «bajista», que no estaba en el corpus, se parte en `baj` y letras sueltas: el tokenizador nunca falla, solo se vuelve menos eficiente. `</w>` marca el final de palabra',
          ],
        ],
      ),
      mc('En cada ronda de BPE, ¿qué par se fusiona?', ['El par de símbolos adyacentes que más veces aparece en el corpus', 'El par de letras más raro', 'Un par elegido al azar', 'El par que aparece primero en el diccionario'], 0, 'BPE es un algoritmo voraz: cuenta todos los pares adyacentes (ponderados por la frecuencia de cada palabra) y fusiona el más repetido. Se repite hasta alcanzar el tamaño de vocabulario deseado.'),
      learn(
        'Los tokens son la moneda de un LLM',
        `
Casi todo lo que importa de un LLM se mide **en tokens**, no en palabras:

- **Coste**: las API cobran por millón de tokens de entrada y de salida.
- **Límite**: la **ventana de contexto** (cuánto texto cabe en una conversación) se cuenta en tokens.
- **Velocidad**: el modelo genera *un token cada vez*.
- **Rarezas**: contar letras, invertir palabras o sumar números largos le cuesta, porque *no ve letras*: ve fragmentos. Los números suelen partirse en trozos de 1–3 cifras.

Orden de magnitud para el español con tokenizadores reales: **1 token ≈ ¾ de palabra** en inglés y algo menos en español (suele costar más tokens expresar lo mismo). Nuestro tokenizador de juguete tiene solo 175 símbolos, así que parte más que uno real, pero ilustra la idea.
`,
        '💰',
      ),
      pyDemo(
        'Contar tokens y calcular lo que cuesta',
        [
          [
            `from dojo_ai.tokenizer import get_encoding, contar_tokens

enc = get_encoding()
for t in ["hola", "devolver el pedido", "4839201", "zzzxqj"]:
    print(f"{t!r:22} {len(t):2} caracteres -> {contar_tokens(t):2} tokens", enc.tokens(t))

PRECIO = 0.50                                   # dólares por millón de tokens
pregunta = "¿Cuánto tarda el envío de mi pedido?"
n = contar_tokens(pregunta)
print(n, "tokens por pregunta")
print("1 millón de preguntas:", round(n * 1_000_000 * PRECIO / 1_000_000, 2), "dólares")`,
            'Las palabras comunes del corpus ocupan pocos tokens («hola» = 2); un número o una cadena sin sentido se parte **casi cifra a cifra**. La factura es `tokens × precio`: 24 tokens por pregunta y un millón de preguntas salen a 12 $ de entrada con este precio de ejemplo',
          ],
        ],
      ),
      tf('Un LLM "ve" las palabras como letras sueltas, por eso contar las letras de una palabra le resulta fácil.', false, 'Al revés: ve tokens (fragmentos), no letras. Por eso tareas como contar letras o invertir una palabra le resultan sorprendentemente difíciles.'),
      pyOut('¿Qué imprime?', `def fusionar(simbolos, par):
    out = []
    i = 0
    while i < len(simbolos):
        if i < len(simbolos) - 1 and (simbolos[i], simbolos[i + 1]) == par:
            out.append(simbolos[i] + simbolos[i + 1])
            i += 2
        else:
            out.append(simbolos[i])
            i += 1
    return out

print(fusionar(["b", "a", "j", "a", "j"], ("a", "j")))`, ["['baj', 'aj']", "['b', 'a', 'j', 'aj']", "['b', 'aj']"], 'Se recorre la lista de izquierda a derecha y cada vez que aparecen «a» y «j» seguidas se unen: b, **aj**, **aj**.'),
      pyPractice({
        goal: 'El par más frecuente',
        prompt: 'Escribe `par_mas_frecuente(palabras)`. `palabras` es un diccionario `{tupla de símbolos: veces que aparece la palabra}`. Devuelve el **par de símbolos adyacentes** que más se repite (cada par cuenta tantas veces como su palabra). Si hay empate, devuelve el menor por orden alfabético.',
        starter: 'def par_mas_frecuente(palabras):\n    pass\n',
        check: calls([
          ['par_mas_frecuente({("b","a","j","o"): 4, ("b","a","j","a"): 3, ("s","u","b","o"): 2})', "('a', 'j')"],
          ['par_mas_frecuente({("a","b"): 1, ("c","d"): 1})', "('a', 'b')"],
          ['par_mas_frecuente({("x","y","x","y"): 5})', "('x', 'y')"],
        ]),
        solution: 'def par_mas_frecuente(palabras):\n    cuenta = {}\n    for simbolos, n in palabras.items():\n        for par in zip(simbolos, simbolos[1:]):\n            cuenta[par] = cuenta.get(par, 0) + n\n    return min(cuenta, key=lambda p: (-cuenta[p], p))\n',
        hints: ['`zip(simbolos, simbolos[1:])` recorre los pares adyacentes de una palabra.', 'Suma `n` (la frecuencia de la palabra) a cada par en un diccionario y quédate con el mejor: `min(cuenta, key=lambda p: (-cuenta[p], p))` resuelve también los empates.'],
        explain: 'Es literalmente el primer paso de BPE. Con `(a, j)` y `(b, a)` empatadas a 7 apariciones gana `(a, j)` por orden alfabético; así el entrenamiento es determinista.',
        commands: ['BPE'],
      }),
      pyPractice({
        goal: 'Fusionar un par',
        prompt: 'Escribe `fusionar(simbolos, par)`: recorre la lista de símbolos y, cada vez que encuentres `par[0]` seguido de `par[1]`, sustitúyelos por un único símbolo `par[0] + par[1]`. Devuelve la lista nueva.',
        starter: 'def fusionar(simbolos, par):\n    pass\n',
        check: calls([
          ['fusionar(["b","a","j","a","j"], ("a","j"))', "['b', 'aj', 'aj']"],
          ['fusionar(list("aaa"), ("a","a"))', "['aa', 'a']"],
          ['fusionar(["x","y"], ("y","z"))', "['x', 'y']"],
        ]),
        solution: 'def fusionar(simbolos, par):\n    out = []\n    i = 0\n    while i < len(simbolos):\n        if i < len(simbolos) - 1 and (simbolos[i], simbolos[i + 1]) == par:\n            out.append(simbolos[i] + simbolos[i + 1])\n            i += 2\n        else:\n            out.append(simbolos[i])\n            i += 1\n    return out\n',
        hints: ['Usa un `while` con un índice `i` para poder saltar de dos en dos cuando fusionas.', 'Con `["a","a","a"]` y `("a","a")` la fusión es de izquierda a derecha y no se solapan: `["aa", "a"]`.'],
        explain: 'Esta es la segunda mitad de cada ronda de BPE: tras elegir el par ganador, se aplica a todas las palabras. Aplicar las fusiones aprendidas en su orden es, además, exactamente lo que hace el tokenizador al leer texto nuevo.',
        commands: ['BPE'],
      }),
      pyPractice({
        goal: 'Calcula la factura',
        prompt: 'Escribe `coste(texto, precio_millon)`: dólares que cuesta procesar `texto` si el modelo cobra `precio_millon` dólares por **millón de tokens**. Usa `contar_tokens` (ya importado).',
        starter: 'from dojo_ai.tokenizer import contar_tokens\n\ndef coste(texto, precio_millon):\n    pass\n',
        check: calls([
          ['round(coste("hola", 1_000_000), 2)', '2.0'],
          ['round(coste("¿Cuánto tarda el envío de mi pedido?", 1_000_000), 2)', '24.0'],
          ['coste("", 5)', '0.0'],
        ]),
        solution: 'from dojo_ai.tokenizer import contar_tokens\n\ndef coste(texto, precio_millon):\n    return contar_tokens(texto) * precio_millon / 1_000_000\n',
        hints: ['El precio es por millón de tokens: divide entre `1_000_000`.', '`contar_tokens(texto)` ya devuelve cuántos tokens ocupa el texto.'],
        explain: 'Las API cobran distinto la entrada (tu prompt) y la salida (lo que genera), y la salida suele costar varias veces más. Medir tokens antes de enviar es la base para controlar el gasto, algo que retomarás en la última zona.',
        commands: ['contar_tokens', 'token'],
      }),
      match('Une cada concepto con su significado:', [['Token', 'Trozo de texto que el modelo trata como una unidad'], ['Vocabulario', 'Conjunto fijo de tokens que conoce el tokenizador'], ['BPE', 'Algoritmo que aprende el vocabulario fusionando los pares más frecuentes'], ['Ventana de contexto', 'Máximo de tokens que el modelo puede leer a la vez']], 'Todo en un LLM se cuenta en tokens: el texto de entrada, la respuesta, el coste y el límite de memoria de la conversación.'),
    ]),
    // ───────────────────────── 2 ─────────────────────────
    lesson('ia11-2', { title: 'Atención: mirar lo que importa', summary: 'Consultas, claves y valores; softmax(QKᵀ/√d)V; la máscara causal', emoji: '👀', commands: ['self-attention', 'softmax', 'máscara causal'], minutes: 16 }, [
      learn(
        'Cada palabra pregunta: ¿quién me importa?',
        `
«El gato no cruzó la calle porque **estaba** cansado.» ¿Quién estaba cansado? Para entender «estaba» hay que mirar a «gato», seis palabras atrás. Las redes recurrentes lo conseguían arrastrando una memoria palabra a palabra (y se olvidaban). La **atención** (*self-attention*) lo resuelve de otra forma: **cada palabra puede mirar directamente a todas las demás** y decidir cuánto le importa cada una.

Cada token produce tres vectores con tres matrices aprendidas:
- **Q (consulta)**: *«¿qué estoy buscando?»*
- **K (clave)**: *«¿qué ofrezco?»*
- **V (valor)**: *«esto es lo que aporto si me eligen»*

La relevancia de la palabra *j* para la palabra *i* es el producto escalar \`Q[i] · K[j]\`. Con un **softmax** se convierten en pesos que suman 1, y la salida es la **media ponderada de los valores**:

\`\`\`
atención(Q, K, V) = softmax(Q Kᵀ / √d) V
\`\`\`

La división por √d (*d* = tamaño de Q y K) evita que los productos crezcan con la dimensión.
`,
        '👀',
      ),
      illus('ia-attention', 'Qué mira cada palabra', 'Toca «estaba» o «cruzó» y mira a quién atienden. Prueba a quitar el escalado y a activar la máscara causal.'),
      pyDemo(
        'La atención en diez líneas de NumPy',
        [
          [
            `import numpy as np

${SOFTMAX}
palabras = ["el", "gato", "no", "cruzó", "la", "calle", "porque", "estaba", "cansado"]
rng = np.random.default_rng(7)
d = 8
X = rng.normal(size=(len(palabras), d))          # un vector por palabra (embeddings)
Wq, Wk, Wv = (rng.normal(size=(d, d)) / np.sqrt(d) for _ in range(3))
Q, K, V = X @ Wq, X @ Wk, X @ Wv
puntos = Q @ K.T / np.sqrt(d)                    # (9, 9): cuánto encaja cada consulta con cada clave
W = softmax(puntos)                              # cada fila suma 1
salida = W @ V
print(W.shape, salida.shape)
print(W.sum(axis=1).round(3))
print(W[7].round(2))
print(palabras[int(W[7].argmax())])`,
            'La matriz `W` es 9×9: la fila 7 («estaba») reparte su atención entre las nueve palabras y suma 1. Con matrices **aleatorias** la atención no significa nada: el reparto es casi plano (el máximo, 0.18, cae en «cruzó» por puro azar); durante el entrenamiento las matrices Wq, Wk y Wv se ajustan hasta que «estaba» aprende a buscar a su sujeto',
          ],
        ],
      ),
      mc('En la matriz de pesos de atención, ¿qué representa la fila de una palabra?', ['Cuánto atiende esa palabra a cada una de las demás (la fila suma 1)', 'Cuántas veces aparece la palabra en el texto', 'La probabilidad de que sea la última palabra', 'Su posición en la frase'], 0, 'Cada fila es una distribución de probabilidad: cuánto «mira» esa palabra a cada otra. La salida de la palabra es la mezcla de los valores V según esos pesos.'),
      learn(
        'Por qué √d y qué es la máscara causal',
        `
**Dividir por √d.** El producto escalar de dos vectores aleatorios de dimensión *d* tiene una desviación típica de √d: cuanto más grande el vector, más grandes los números que entran al softmax. Y un softmax con entradas enormes se vuelve «todo o nada» (un peso casi 1, los demás casi 0) y sus gradientes se anulan. Dividir por √d mantiene la escala en torno a 1 sin importar *d*.

**Máscara causal.** Un modelo que genera texto (GPT, Llama, Claude) predice cada token viendo solo **los anteriores**; si pudiera mirar al futuro, copiaría la respuesta. Se consigue poniendo \`−∞\` en los productos de las posiciones futuras *antes* del softmax: su peso pasa a ser exactamente 0. La matriz de pesos queda **triangular inferior**.

Un coste a tener en cuenta: la matriz de atención es *T × T*, de modo que el tiempo y la memoria crecen con el **cuadrado** de la longitud del texto. Por eso los contextos largos son caros.
`,
        '🎭',
      ),
      pyDemo(
        'Por qué se divide entre √d',
        [
          [
            `import numpy as np

rng = np.random.default_rng(0)
for d in [4, 64, 1024]:
    q = rng.normal(size=(1000, d))
    k = rng.normal(size=(1000, d))
    prod = (q * k).sum(axis=1)                   # 1000 productos escalares q·k
    print(d, round(float(prod.std()), 2), round(float((prod / np.sqrt(d)).std()), 2))`,
            'La desviación de `q·k` crece como √d (2, 8, 32…) pero tras dividir por √d se queda en **1** para cualquier dimensión. Sin esa división, con d = 1024 el softmax recibiría números de ±30 y casi siempre elegiría una sola palabra',
          ],
        ],
      ),
      pyDemo(
        'La máscara causal',
        [
          [
            `import numpy as np

${SOFTMAX}
T = 5
puntos = np.arange(T * T, dtype=float).reshape(T, T) % 4     # puntuaciones de ejemplo
mascara = np.triu(np.ones((T, T), dtype=bool), k=1)          # True = futuro (prohibido)
puntos = np.where(mascara, -np.inf, puntos)
W = softmax(puntos)
print(mascara.astype(int))
print(W.round(2))`,
            '`np.triu(..., k=1)` marca lo que queda **por encima de la diagonal** (el futuro). Con −∞ el softmax les da peso 0: la primera palabra solo se ve a sí misma (1.0) y cada fila reparte su atención únicamente hacia atrás',
          ],
        ],
      ),
      tf('En un modelo como GPT, la palabra en la posición 3 puede usar información de la palabra en la posición 5 para decidir cuál es su salida.', false, 'La máscara causal lo impide: cada posición solo ve las anteriores (y a sí misma). Es lo que permite entrenar el modelo para predecir el siguiente token sin hacer trampa.'),
      multi('¿Qué afirmaciones sobre la atención son ciertas?', ['Cada palabra puede mirar directamente a cualquier otra, sin pasar por las intermedias', 'Se calcula para todas las posiciones a la vez, lo que aprovecha muy bien las GPU', 'El coste crece con el cuadrado de la longitud del texto', 'Permite recordar sin límite cualquier cantidad de texto'], [0, 1, 2], 'Esas son sus ventajas y su límite: acceso directo y paralelismo, pero coste cuadrático. Y no hay memoria ilimitada: solo se atiende a lo que cabe en la ventana de contexto.'),
      pyPractice({
        goal: 'Softmax estable',
        prompt: 'Escribe `softmax(x)` para un array de NumPy, aplicado sobre el **último eje**. Para que no desborde con números grandes, resta antes el máximo (`keepdims=True`).',
        starter: 'import numpy as np\n\ndef softmax(x):\n    pass\n',
        check: calls([
          ['softmax(np.array([1.0, 1.0])).tolist()', '[0.5, 0.5]'],
          ['round(float(softmax(np.array([1000.0, 1000.0, 0.0])).sum()), 6)', '1.0'],
          ['round(float(softmax(np.array([2.0, 1.0, 0.1]))[0]), 4)', '0.659'],
          ['softmax(np.array([[1.0, 2.0], [3.0, 3.0]])).round(3).tolist()', '[[0.269, 0.731], [0.5, 0.5]]'],
        ]),
        solution: 'import numpy as np\n\ndef softmax(x):\n    e = np.exp(x - x.max(axis=-1, keepdims=True))\n    return e / e.sum(axis=-1, keepdims=True)\n',
        hints: ['Resta `x.max(axis=-1, keepdims=True)` antes de `np.exp`: el resultado no cambia pero evitas `inf`.', 'Divide cada exponencial entre la suma por filas: `e.sum(axis=-1, keepdims=True)`.'],
        explain: 'Restar el máximo no cambia el resultado (se cancela al dividir) pero evita que `np.exp(1000)` desborde. Todas las librerías hacen este truco.',
        commands: ['softmax'],
      }),
      pyPractice({
        goal: 'Atención desde cero',
        prompt: 'Escribe `atencion(Q, K, V)` que devuelva la tupla `(salida, pesos)`: `pesos = softmax(Q Kᵀ / √d)` con `d` = número de columnas de K, y `salida = pesos @ V`. La función `softmax` ya está escrita.',
        starter: `import numpy as np\n\n${SOFTMAX}\ndef atencion(Q, K, V):\n    pass\n`,
        check: calls([
          ['atencion(np.eye(2), np.eye(2), np.array([[10.0, 0.0], [0.0, 10.0]]))[1].round(3).tolist()', '[[0.67, 0.33], [0.33, 0.67]]'],
          ['atencion(np.eye(2), np.eye(2), np.array([[10.0, 0.0], [0.0, 10.0]]))[0].round(2).tolist()', '[[6.7, 3.3], [3.3, 6.7]]'],
          ['atencion(np.ones((3, 4)), np.ones((3, 4)), np.arange(6.0).reshape(3, 2))[0].round(2).tolist()', '[[2.0, 3.0], [2.0, 3.0], [2.0, 3.0]]'],
        ]),
        solution: `import numpy as np\n\n${SOFTMAX}\ndef atencion(Q, K, V):\n    d = K.shape[-1]\n    pesos = softmax(Q @ K.T / np.sqrt(d))\n    return pesos @ V, pesos\n`,
        hints: ['Las puntuaciones son `Q @ K.T / np.sqrt(d)`; `d = K.shape[-1]`.', 'La salida es `pesos @ V` y hay que devolver `(salida, pesos)`.'],
        explain: 'Eso es todo el mecanismo. Con Q = K = identidad cada palabra se parece más a sí misma (0.67) que a la otra (0.33), y su salida es una mezcla de los valores en esa proporción. Si todas las claves son iguales, todas las palabras reciben la misma atención y la salida es la media de V.',
        commands: ['self-attention'],
      }),
      pyPractice({
        goal: 'Atención con máscara causal',
        prompt: 'Escribe `atencion_causal(Q, K, V)` (devuelve `(salida, pesos)`) igual que antes, pero **poniendo −∞** en las puntuaciones de las posiciones futuras antes del softmax. Pista: `np.triu(np.ones((T, T), dtype=bool), 1)` marca el futuro.',
        starter: `import numpy as np\n\n${SOFTMAX}\ndef atencion_causal(Q, K, V):\n    pass\n`,
        check: calls([
          ['atencion_causal(np.eye(3), np.eye(3), np.eye(3))[1][0].tolist()', '[1.0, 0.0, 0.0]'],
          ['bool(np.allclose(np.triu(atencion_causal(np.random.default_rng(3).normal(size=(4, 3)), np.random.default_rng(4).normal(size=(4, 3)), np.eye(4, 3))[1], 1), 0))', 'True'],
          ['atencion_causal(np.eye(3), np.eye(3), np.eye(3))[1].sum(axis=1).round(6).tolist()', '[1.0, 1.0, 1.0]'],
        ]),
        solution: `import numpy as np\n\n${SOFTMAX}\ndef atencion_causal(Q, K, V):\n    T, d = Q.shape[0], K.shape[-1]\n    pts = Q @ K.T / np.sqrt(d)\n    pts = np.where(np.triu(np.ones((T, T), dtype=bool), 1), -np.inf, pts)\n    pesos = softmax(pts)\n    return pesos @ V, pesos\n`,
        hints: ['`np.where(mascara, -np.inf, pts)` sustituye por −∞ donde la máscara es verdadera.', 'La máscara debe aplicarse **antes** del softmax, no después (si no, las filas dejarían de sumar 1).'],
        explain: 'Con la máscara aplicada antes del softmax, el futuro pesa exactamente 0 y las filas siguen sumando 1. Así se entrenan los modelos tipo GPT: una sola pasada calcula las predicciones de todas las posiciones sin hacer trampa.',
        commands: ['máscara causal'],
      }),
      pyOut('¿Qué imprime?', 'import numpy as np\nprint(np.triu(np.ones((3, 3), dtype=int), k=1).sum())', ['6', '9', '0'], 'Por encima de la diagonal de una matriz 3×3 hay 3 posiciones (la 0-1, la 0-2 y la 1-2): son las que la máscara causal prohíbe.'),
    ]),
    // ───────────────────────── 3 ─────────────────────────
    lesson('ia11-3', { title: 'El bloque Transformer', summary: 'Posición, varias cabezas, conexiones residuales, normalización, MLP y cuántos parámetros tiene', emoji: '🧱', commands: ['transformer', 'multi-head attention', 'codificación posicional', 'layer norm'], minutes: 16 }, [
      learn(
        'Atención + MLP, apilados muchas veces',
        `
La atención sola no basta. Un **bloque Transformer** combina cuatro ingredientes y se **repite L veces** (12 en GPT-2 pequeño, decenas en los modelos grandes):

1. **Atención multi-cabeza**: en vez de una sola atención, varias *cabezas* en paralelo (cada una con sus propias Q, K y V de tamaño *d/h*). Cada cabeza puede especializarse en una relación distinta: sujeto–verbo, adjetivo–nombre, referencias… Sus salidas se concatenan y se mezclan con una matriz \`Wo\`.
2. **MLP por posición**: dos capas densas con una activación entre medias (\`d → 4d → d\`), aplicadas a cada token por separado. Aporta capacidad de «memorizar» y transformar.
3. **Conexiones residuales**: \`x + subcapa(x)\`. Dan un atajo al gradiente y permiten apilar muchísimas capas.
4. **Normalización** (*LayerNorm*): reescala cada vector a media 0 y varianza 1 para estabilizar el entrenamiento.

Falta un detalle: la atención trata la frase como un **conjunto** (no sabe el orden). «El perro muerde al hombre» y «el hombre muerde al perro» tendrían las mismas palabras. Se arregla sumando a cada embedding un vector de **posición** (en el Transformer original, ondas de senos y cosenos de distintas frecuencias; en modelos modernos, posiciones rotatorias RoPE).
`,
        '🧱',
      ),
      illus('ia-transformer', 'Un bloque por dentro y cuánto pesa', 'En «Anatomía» toca cada pieza para ver su forma y su papel; en «Tamaño» cambia la anchura y las capas y mira cuántos parámetros salen.'),
      pyDemo(
        'Posición con senos y cosenos',
        [
          [
            `import numpy as np

def posicional(T, d):
    pos = np.arange(T)[:, None]
    i = np.arange(0, d, 2)[None, :]
    ang = pos / (10000 ** (i / d))
    P = np.zeros((T, d))
    P[:, 0::2] = np.sin(ang)
    P[:, 1::2] = np.cos(ang)
    return P

P = posicional(6, 8)
print(P.shape)
print(P[:3].round(2))
print(np.allclose(P[0, 0::2], 0), np.allclose(P[0, 1::2], 1))`,
            'Cada posición recibe un vector único: las primeras columnas oscilan rápido (distinguen posiciones vecinas) y las últimas muy despacio (distinguen zonas del texto). La posición 0 es `[0, 1, 0, 1, …]` porque sin(0)=0 y cos(0)=1. Este vector se **suma** al embedding del token',
          ],
        ],
      ),
      mc('¿Por qué un Transformer necesita información de posición?', ['Porque la atención por sí sola no distingue el orden de las palabras', 'Para que el modelo sepa qué idioma es', 'Para reducir el número de parámetros', 'No la necesita: el orden se deduce solo'], 0, 'La atención compara todos con todos sin importar la posición: sin una señal de orden, «perro muerde hombre» y «hombre muerde perro» serían idénticas.'),
      pyDemo(
        'Un bloque Transformer completo en NumPy',
        [
          [
            `import numpy as np

${SOFTMAX}
def layer_norm(x, eps=1e-5):
    media = x.mean(axis=-1, keepdims=True)
    var = x.var(axis=-1, keepdims=True)
    return (x - media) / np.sqrt(var + eps)

def bloque(X, p, n_heads):
    T, d = X.shape
    dh = d // n_heads
    h = layer_norm(X)
    Q, K, V = h @ p["Wq"], h @ p["Wk"], h @ p["Wv"]
    cabezas = []
    for j in range(n_heads):
        s = slice(j * dh, (j + 1) * dh)                       # cada cabeza usa su trozo de columnas
        pts = Q[:, s] @ K[:, s].T / np.sqrt(dh)
        pts = np.where(np.triu(np.ones((T, T), dtype=bool), 1), -np.inf, pts)
        cabezas.append(softmax(pts) @ V[:, s])
    X = X + np.concatenate(cabezas, axis=1) @ p["Wo"]          # atención + conexión residual
    h = layer_norm(X)
    X = X + np.maximum(0, h @ p["W1"]) @ p["W2"]                # MLP por posición + residual
    return X

rng = np.random.default_rng(1)
d, T, heads = 16, 6, 4
p = {k: rng.normal(size=s) * 0.2 for k, s in
     {"Wq": (d, d), "Wk": (d, d), "Wv": (d, d), "Wo": (d, d), "W1": (d, 4 * d), "W2": (4 * d, d)}.items()}
X = rng.normal(size=(T, d))
Y = bloque(bloque(X, p, heads), p, heads)
print(X.shape, Y.shape)
print(sum(v.size for v in p.values()), "parámetros por bloque")
X2 = X.copy()
X2[-1] += 5                                                      # cambiamos solo la última palabra
print(np.allclose(bloque(X, p, heads)[:-1], bloque(X2, p, heads)[:-1]))`,
            'El bloque **conserva la forma** (6×16 entra, 6×16 sale), así que se pueden apilar los que se quiera. Tiene 12·d² = 3 072 parámetros (4d² de atención + 8d² del MLP). Y la última línea comprueba la causalidad: cambiar solo la última palabra **no altera** las salidas anteriores (`True`)',
          ],
        ],
      ),
      tf('Si duplicas la anchura d de un Transformer (manteniendo el número de capas), los parámetros de las capas se multiplican por 4.', true, 'Cada capa tiene unos 12·d² parámetros: depende del cuadrado de la anchura. Duplicar d los multiplica por 4; duplicar el número de capas solo los multiplica por 2.'),
      pyOut('¿Qué imprime?', 'import numpy as np\nX = np.zeros((6, 16))\nWq = np.zeros((16, 16))\nprint((X @ Wq).shape, X.reshape(6, 4, 4).shape)', ['(16, 6) (6, 4, 4)', '(6, 16) (6, 16)', '(6, 4) (6, 4, 4)'], 'Multiplicar (6,16) por (16,16) da (6,16). `reshape(6, 4, 4)` parte las 16 columnas en 4 cabezas de 4: así se reparte una atención multi-cabeza.'),
      order('Ordena el camino de un texto por un LLM:', ['tokens', 'embeddings', 'bloques', 'logits', 'softmax'], 'tokens embeddings bloques logits softmax', 'El texto se trocea en tokens, cada token pasa a embedding (con su posición), atraviesa L bloques Transformer, una capa final da los logits (una puntuación por cada token del vocabulario) y el softmax los convierte en probabilidades.'),
      pyPractice({
        goal: 'Normalización por capa',
        prompt: 'Escribe `layer_norm(x, eps=1e-5)`: para cada fila (último eje) resta la media y divide entre `sqrt(varianza + eps)`.',
        starter: 'import numpy as np\n\ndef layer_norm(x, eps=1e-5):\n    pass\n',
        check: calls([
          ['round(float(layer_norm(np.array([[1., 2., 3., 4.]]))[0, 0]), 4)', '-1.3416'],
          ['layer_norm(np.array([[5., 5., 5.]])).tolist()', '[[0.0, 0.0, 0.0]]'],
          ['bool(np.allclose(layer_norm(np.random.default_rng(0).normal(size=(3, 8)) * 5 + 2).mean(axis=-1), 0, atol=1e-6))', 'True'],
        ]),
        solution: 'import numpy as np\n\ndef layer_norm(x, eps=1e-5):\n    media = x.mean(axis=-1, keepdims=True)\n    var = x.var(axis=-1, keepdims=True)\n    return (x - media) / np.sqrt(var + eps)\n',
        hints: ['`x.mean(axis=-1, keepdims=True)` y `x.var(axis=-1, keepdims=True)` dan una media y una varianza por fila.', 'El `eps` evita dividir por 0 cuando todos los valores de la fila son iguales.'],
        explain: 'A diferencia de la normalización por lotes (BatchNorm), LayerNorm normaliza cada token por separado, así que no depende del tamaño del lote ni de los otros textos. Por eso se usa en los Transformers.',
        commands: ['layer norm'],
      }),
      pyPractice({
        goal: 'Codificación posicional',
        prompt: 'Escribe `posicional(T, d)`: matriz `(T, d)` donde la columna par `2k` de la fila `pos` vale `sin(pos / 10000^(2k/d))` y la impar `2k+1` vale `cos(...)` con el mismo ángulo.',
        starter: 'import numpy as np\n\ndef posicional(T, d):\n    pass\n',
        check: calls([
          ['posicional(4, 6).shape', '(4, 6)'],
          ['posicional(3, 4)[0].tolist()', '[0.0, 1.0, 0.0, 1.0]'],
          ['round(float(posicional(4, 6)[1, 0]), 4)', '0.8415'],
          ['round(float(posicional(5, 4)[3, 2]), 4)', '0.03'],
        ]),
        solution: 'import numpy as np\n\ndef posicional(T, d):\n    pos = np.arange(T)[:, None]\n    i = np.arange(0, d, 2)[None, :]\n    ang = pos / (10000 ** (i / d))\n    P = np.zeros((T, d))\n    P[:, 0::2] = np.sin(ang)\n    P[:, 1::2] = np.cos(ang)\n    return P\n',
        hints: ['`pos` es una columna `(T, 1)` e `i` una fila con los índices pares `0, 2, 4…`; al dividir salen todos los ángulos por broadcasting.', 'Rellena las columnas pares con `P[:, 0::2] = np.sin(ang)` y las impares con `P[:, 1::2] = np.cos(ang)`.'],
        explain: 'La posición 1, columna 0, vale sin(1) = 0.8415. Es un diseño sin parámetros que se puede calcular para cualquier longitud; muchos modelos actuales usan variantes rotatorias (RoPE) en su lugar.',
        commands: ['codificación posicional'],
      }),
      pyPractice({
        goal: 'Cuenta los parámetros',
        prompt: 'Escribe `contar_parametros(d, capas, vocab)`: aproximación de los parámetros de un Transformer solo-decodificador: **12·d²** por capa (atención 4d² + MLP 8d²) más la tabla de embeddings **vocab·d** (compartida con la salida).',
        starter: 'def contar_parametros(d, capas, vocab):\n    pass\n',
        check: calls([
          ['contar_parametros(768, 12, 50257)', '123532032'],
          ['contar_parametros(4096, 32, 32000)', '6573522944'],
          ['contar_parametros(100, 1, 0)', '120000'],
        ]),
        solution: 'def contar_parametros(d, capas, vocab):\n    return 12 * d * d * capas + vocab * d\n',
        hints: ['Por capa: `12 * d * d`. Multiplica por el número de capas.', 'Suma la tabla de embeddings: `vocab * d`.'],
        explain: 'Con d = 768, 12 capas y 50 257 tokens salen unos 124 millones: es GPT-2 pequeño. Con d = 4096 y 32 capas, unos 6 600 millones: la familia «7B». Casi todo el peso está en `d² × capas`.',
        commands: ['transformer', 'multi-head attention'],
      }),
      mc('Una atención con 8 cabezas y d = 512, ¿de qué tamaño es cada cabeza?', ['64', '512', '4096', '8'], 0, 'El vector de d = 512 se reparte entre 8 cabezas: 512 / 8 = 64 por cabeza. Todas juntas siguen usando 512 columnas.'),
    ]),
    // ───────────────────────── 4 ─────────────────────────
    lesson('ia11-4', { title: 'Generar texto: temperatura, top-k y top-p', summary: 'Logits → probabilidades → siguiente token; control de la creatividad', emoji: '🎲', commands: ['logits', 'temperatura', 'top-k y top-p', 'modelo_cuentos', 'perplejidad'], minutes: 15 }, [
      learn(
        'Un solo truco: predecir el siguiente token',
        `
Un LLM hace una única cosa: dada una secuencia de tokens, devuelve **una puntuación (logit) por cada token del vocabulario**. El softmax las convierte en probabilidades. Para escribir un párrafo se repite en bucle:

1. Se calculan las probabilidades del siguiente token.
2. Se **elige** uno (aquí está la decisión de diseño).
3. Se añade a la secuencia y se vuelve al paso 1, hasta un token de fin o el límite de longitud.

¿Cómo se elige? Hay varias estrategias de **muestreo**:
- **Voraz** (*greedy*): siempre el más probable. Determinista, pero repetitivo y soso.
- **Temperatura** *T*: se dividen los logits entre *T* antes del softmax. *T* < 1 afila la distribución (más previsible); *T* > 1 la aplana (más variado y más arriesgado).
- **top-k**: solo se considera a las *k* candidatas más probables.
- **top-p** (*nucleus*): solo las candidatas necesarias para sumar una probabilidad *p* (por ejemplo 0,9).

Nuestro modelo de juguete es un contador de n-gramas (\`dojo_ai.lm\`): predice la siguiente palabra a partir de la anterior contando lo visto en unos cuentos. Es mucho más simple que un Transformer, pero el **bucle de generación y el muestreo son idénticos**.
`,
        '🎲',
      ),
      pyDemo(
        'Las probabilidades del siguiente token',
        [
          [
            `from dojo_ai.lm import modelo_cuentos

m = modelo_cuentos()
print(m)
print(m.probabilidades("el gato"))`,
            'Tras «gato» el modelo ha visto «.» el 33 % de las veces, «come» el 22 %… Esa distribución **es** la salida del modelo; todo lo demás (temperatura, top-k) son formas de elegir de ella. Un LLM hace lo mismo con decenas de miles de candidatas',
          ],
        ],
      ),
      illus('ia-sampling', 'Temperatura, top-k y top-p', 'Mueve los tres controles y mira cómo cambian las barras. Pulsa «Tirar 20 veces» para ver qué palabras salen con cada configuración.'),
      pyDemo(
        'Dividir los logits por la temperatura',
        [
          [
            `import numpy as np
from dojo_ai.lm import modelo_cuentos, softmax_temperatura

m = modelo_cuentos()
palabras, logits = m.logits("el")
print(palabras[:5], logits[:5].round(2))
for T in [0.5, 1.0, 2.0]:
    p = softmax_temperatura(logits, T)
    print(T, p[:5].round(3), round(float(p.max()), 3))`,
            'Con T = 0.5 la mejor candidata se lleva el 30 %; con T = 1, el 19 %; con T = 2, el 14 %: la distribución se aplana hacia el reparto uniforme. Con T → 0 acabaría eligiendo siempre la mayor',
          ],
        ],
      ),
      pyDemo(
        'Generar con distintos ajustes',
        [
          [
            `from dojo_ai.lm import modelo_cuentos

m = modelo_cuentos()
for T, semilla in [(0, 0), (0.8, 1), (0.8, 2), (1.5, 1)]:
    print(T, semilla, m.generar("el gato", max_tokens=8, temperatura=T, semilla=semilla))`,
            'Con temperatura 0 sale siempre lo mismo (aquí «el gato .»: lo más probable es terminar). Con T > 0 la **semilla** cambia el resultado: dos semillas dan dos continuaciones. Es lo que ocurre al pulsar «regenerar» en un chat',
          ],
        ],
      ),
      mc('Quieres que un asistente que extrae datos de facturas devuelva siempre lo mismo ante el mismo texto. ¿Qué temperatura eliges?', ['0 (o muy baja)', '1,5', '2', 'Da igual, la temperatura no afecta'], 0, 'Para tareas de extracción, clasificación o código conviene temperatura 0 o muy baja: respuestas deterministas y fiables. La creatividad (T alta) se reserva para lluvia de ideas o escritura.'),
      tf('Con temperatura 0 el modelo elige siempre la palabra más probable.', true, 'Dividir por una temperatura cercana a 0 convierte el softmax en un «ganador se lo lleva todo»: es la decodificación voraz (greedy).'),
      learn(
        'Por qué los LLM "inventan" y cómo medir lo esperable que es un texto',
        `
Como el modelo solo elige **lo probable**, no lo verdadero, puede producir con total aplomo una frase fluida y falsa: una **alucinación**. No hay un detector interno de verdad; hay probabilidades aprendidas de texto. Las mitigaciones las verás más adelante (dar información real con RAG, pedir citas, herramientas, evaluación).

Para medir cuánto «le sorprende» un texto a un modelo se usa la **perplejidad**: la exponencial de la pérdida media (entropía cruzada) por token. Una perplejidad de 10 significa que, de media, el modelo duda como si tuviera que elegir entre 10 opciones equiprobables. Menor es mejor.
`,
        '🎭',
      ),
      pyDemo(
        'Perplejidad: lo esperable que es una frase',
        [
          [
            `import numpy as np
from dojo_ai.lm import modelo_cuentos

m = modelo_cuentos()
for frase in ["el gato come pescado .", "el pescado come gato ."]:
    print(frase, round(m.perplejidad(frase), 2))
p = np.array([0.5, 0.3, 0.15, 0.05])
print(round(float(-np.log(p[1])), 3))`,
            'La frase habitual tiene perplejidad ≈ 3 (el modelo la esperaba); la rara, más de 1 000, porque «pescado come» nunca apareció y se le da una probabilidad mínima. La última línea es la pérdida de una sola predicción: −ln(0.3) = 1.204',
          ],
        ],
      ),
      pyPractice({
        goal: 'Softmax con temperatura',
        prompt: 'Escribe `softmax_t(logits, T=1.0)`: divide los logits entre `T`, resta el máximo (estabilidad) y aplica el softmax. Devuelve un array de NumPy.',
        starter: 'import numpy as np\n\ndef softmax_t(logits, T=1.0):\n    pass\n',
        check: calls([
          ['softmax_t([2.0, 0.0], 1.0).round(3).tolist()', '[0.881, 0.119]'],
          ['softmax_t([2.0, 0.0], 2.0).round(3).tolist()', '[0.731, 0.269]'],
          ['softmax_t([2.0, 0.0], 0.5).round(3).tolist()', '[0.982, 0.018]'],
          ['round(float(softmax_t([1, 2, 3], 0.01)[2]), 4)', '1.0'],
        ]),
        solution: 'import numpy as np\n\ndef softmax_t(logits, T=1.0):\n    z = np.asarray(logits, dtype=float) / T\n    e = np.exp(z - z.max())\n    return e / e.sum()\n',
        hints: ['Convierte la lista a array con `np.asarray(logits, dtype=float)` y divide por `T`.', 'Resta el máximo antes de `np.exp` para evitar desbordes (con T = 0.01 los números son enormes).'],
        explain: 'T = 2 reparte más (0.731/0.269) y T = 0.5 concentra (0.982/0.018). Con T = 0.01 la probabilidad de la mayor es ya 1.0: es la decodificación voraz.',
        commands: ['temperatura', 'logits'],
      }),
      pyPractice({
        goal: 'top-k',
        prompt: 'Escribe `top_k(probs, k)`: deja solo las `k` probabilidades más altas (el resto a 0) y **renormaliza** para que sumen 1. Devuelve un array de NumPy.',
        starter: 'import numpy as np\n\ndef top_k(probs, k):\n    pass\n',
        check: calls([
          ['top_k([0.5, 0.3, 0.15, 0.05], 2).round(3).tolist()', '[0.625, 0.375, 0.0, 0.0]'],
          ['top_k([0.5, 0.3, 0.15, 0.05], 4).tolist()', '[0.5, 0.3, 0.15, 0.05]'],
          ['top_k([0.1, 0.6, 0.3], 1).tolist()', '[0.0, 1.0, 0.0]'],
        ]),
        solution: 'import numpy as np\n\ndef top_k(probs, k):\n    p = np.asarray(probs, dtype=float)\n    corte = np.sort(p)[::-1][k - 1]\n    q = np.where(p >= corte, p, 0.0)\n    return q / q.sum()\n',
        hints: ['El valor de corte es la k-ésima probabilidad más alta: `np.sort(p)[::-1][k - 1]`.', 'Pon a 0 las menores que el corte y divide entre la suma para renormalizar.'],
        explain: 'Con k = 2 se quedan 0.5 y 0.3 y se reescalan a 0.625 y 0.375. Así se descartan las candidatas absurdas de la cola antes de tirar el dado. (Si hay empates en el corte se conservan todas las empatadas.)',
        commands: ['top-k y top-p'],
      }),
      pyPractice({
        goal: 'Tirar el dado',
        prompt: 'Escribe `muestrear(probs, u)`: dado un número aleatorio `u` en [0, 1), devuelve el índice elegido recorriendo las probabilidades y acumulándolas hasta que `u` sea menor que la suma acumulada (muestreo por inversión de la función de distribución).',
        starter: 'def muestrear(probs, u):\n    pass\n',
        check: calls([
          ['[muestrear([0.2, 0.5, 0.3], u) for u in (0.1, 0.25, 0.7, 0.95)]', '[0, 1, 2, 2]'],
          ['muestrear([1.0], 0.5)', '0'],
          ['muestrear([0.0, 1.0], 0.0)', '1'],
        ]),
        solution: 'def muestrear(probs, u):\n    acum = 0.0\n    for i, p in enumerate(probs):\n        acum += p\n        if u < acum:\n            return i\n    return len(probs) - 1\n',
        hints: ['Acumula `acum += p` en cada vuelta y devuelve el índice `i` en cuanto `u < acum`.', 'Si por redondeo nunca se cumple, devuelve el último índice.'],
        explain: 'Las probabilidades [0.2, 0.5, 0.3] reparten el intervalo [0,1) en tres tramos: [0,0.2), [0.2,0.7) y [0.7,1). `u` cae en un tramo con probabilidad igual a su longitud. Así, con una semilla fija, el resultado es reproducible.',
        commands: ['temperatura'],
      }),
      pyOut('¿Qué imprime?', 'import numpy as np\nl = np.array([2.0, 0.0])\np = np.exp(l / 2.0) / np.exp(l / 2.0).sum()\nprint(round(float(p[0]), 3))', ['0.881', '0.5', '0.982'], 'Con temperatura 2 los logits pasan a [1, 0] y el softmax da e/(e+1) = 0.731. Con temperatura 1 sería 0.881: subir la temperatura acerca las probabilidades.'),
    ]),
    // ───────────────────────── 5 ─────────────────────────
    lesson('ia11-5', { title: 'De preentrenar a asistente', summary: 'Pérdida de preentrenamiento, ajuste con instrucciones, alineación, LoRA y ventana de contexto', emoji: '🚀', commands: ['preentrenamiento', 'ajuste fino', 'RLHF', 'LoRA', 'ventana de contexto', 'entropía cruzada', 'alucinación'], minutes: 16 }, [
      learn(
        'Tres etapas para crear un asistente',
        `
Un LLM no nace sabiendo conversar. Se construye por etapas:

1. **Preentrenamiento**. Se entrena a predecir el siguiente token sobre billones de tokens de texto (web, libros, código). La pérdida es la **entropía cruzada**: \`−log p(token correcto)\`. No hacen falta etiquetas: el propio texto es la solución. De aquí salen el lenguaje, los hechos y mucha capacidad de razonamiento. Resultado: un **modelo base**, que solo *continúa* texto (si le preguntas, quizá siga con más preguntas).
2. **Ajuste fino con instrucciones** (*SFT*). Se sigue entrenando con decenas de miles de ejemplos *«instrucción → buena respuesta»* escritos por personas. Aprende el formato de un asistente.
3. **Alineación con preferencias** (*RLHF*, *DPO*). Personas (o modelos) comparan dos respuestas y eligen la mejor; el modelo aprende a ser más útil, honesto y prudente.

Después viene el **uso**: ya no se entrena, se *guía* con prompts, se le da información propia (RAG) y herramientas.
`,
        '🚀',
      ),
      illus('ia-llm-stages', 'El camino desde los datos hasta el asistente', 'Toca cada etapa y compara qué responde el modelo a la misma pregunta al terminar cada una.'),
      pyDemo(
        'La pérdida del preentrenamiento',
        [
          [
            `import numpy as np

# En cada posición el modelo devuelve una distribución sobre el vocabulario.
vocab = ["el", "gato", "come", "pescado", "."]
frase = [0, 1, 2, 3, 4]                       # el gato come pescado .
probs = np.array([
    [0.05, 0.60, 0.10, 0.15, 0.10],           # tras "el" ...
    [0.02, 0.03, 0.70, 0.05, 0.20],           # tras "gato" ...
    [0.10, 0.05, 0.05, 0.75, 0.05],           # tras "come" ...
    [0.05, 0.05, 0.05, 0.05, 0.80],           # tras "pescado" ...
])
objetivos = frase[1:]                         # lo que de verdad vino después
p_correcta = probs[np.arange(4), objetivos]
perdida = -np.log(p_correcta).mean()          # entropía cruzada media
print(p_correcta)
print(round(float(perdida), 4), round(float(np.exp(perdida)), 3))`,
            'Se mira la probabilidad que el modelo dio a la palabra que **de verdad** vino después (0.6, 0.7, 0.75, 0.8). La pérdida media es −log de eso: 0.3446, y su exponencial (la perplejidad) 1.41. Entrenar es ajustar los pesos para que esas probabilidades suban en todo el corpus',
          ],
        ],
      ),
      mc('¿Qué minimiza el preentrenamiento de un LLM?', ['−log de la probabilidad que el modelo asigna al token que de verdad viene después', 'El número de parámetros', 'La longitud del texto generado', 'La diferencia entre dos respuestas escritas por personas'], 0, 'Es la entropía cruzada sobre el siguiente token. No requiere etiquetas humanas: en cada posición el texto real es la «respuesta correcta».'),
      learn(
        '¿Prompt, RAG o ajuste fino?',
        `
Cuando el modelo no hace lo que quieres, hay tres palancas, de la más barata a la más cara:

- **Prompt** (instrucciones y ejemplos): cambia el comportamiento sin entrenar nada. Empieza siempre por aquí.
- **RAG** (recuperación): le das tus documentos en el prompt cuando hace falta. Ideal para **conocimiento** actualizado o privado.
- **Ajuste fino**: reentrenas con tus ejemplos. Ideal para **estilo, formato o tareas muy específicas** a gran escala. No es buen camino para meter hechos nuevos.

Reentrenar los miles de millones de pesos es carísimo, así que se usa **LoRA** (*low-rank adaptation*): se congelan los pesos originales y se entrenan solo dos matrices pequeñas *A* (r×d_in) y *B* (d_out×r) por capa, que se suman como una corrección de rango bajo. Se entrena menos del 1 % de los parámetros.
`,
        '🛠️',
      ),
      pyDemo(
        'LoRA: entrenar menos del 1 %',
        [
          [
            `d_in, d_out = 4096, 4096
completo = d_in * d_out
for r in [4, 8, 16]:
    lora = r * (d_in + d_out)              # A: (r, d_in) y B: (d_out, r)
    print(r, lora, f"{100 * lora / completo:.2f} %")
print(completo)`,
            'Una sola matriz de 4096×4096 tiene 16,7 millones de pesos. Con rango r = 8 solo se entrenan 65 536 (el 0,39 %). Y las matrices LoRA son tan pequeñas que se pueden guardar y cambiar por tarea sin duplicar el modelo',
          ],
        ],
      ),
      match('Une cada problema con la palanca más adecuada:', [['El asistente no conoce los manuales internos de la empresa', 'RAG: recuperar los documentos y ponerlos en el prompt'], ['Responde bien, pero con un tono y un formato distintos al deseado', 'Instrucciones y ejemplos en el prompt (o ajuste fino si es a gran escala)'], ['Necesita el precio de hoy de una acción', 'Herramienta: llamar a una API en el momento'], ['Quieres un modelo pequeño especializado en una tarea concreta', 'Ajuste fino (por ejemplo con LoRA)']], 'Regla práctica: prompt primero, RAG para conocimiento, herramientas para datos en vivo o acciones, ajuste fino para estilo y especialización.'),
      learn(
        'La ventana de contexto: la memoria de trabajo',
        `
Un LLM **no recuerda** nada entre llamadas: cada vez que le escribes, la aplicación le reenvía **todo el historial** (mensaje del sistema, tus preguntas y sus respuestas) dentro de un límite: la **ventana de contexto**, medida en tokens. Si se supera, hay que **recortar** (normalmente lo más antiguo, conservando las instrucciones del sistema), resumir o recuperar solo lo relevante.

Detalles que conviene tener claros:
- La ventana incluye **entrada + salida**: hay que dejar hueco para la respuesta.
- Más contexto = **más coste y latencia**, y no siempre más calidad: con textos larguísimos el modelo puede pasar por alto datos que estén en medio.
- «Memoria» en un asistente es una función de la aplicación (guardar y reinyectar resúmenes), no de la red.
`,
        '🧠',
      ),
      illus('ia-context', 'Qué cabe y qué se olvida', 'Reduce la ventana y mira qué mensajes quedan fuera. El mensaje del sistema siempre se intenta conservar.'),
      pyDemo(
        'Cuántos tokens ocupa una conversación',
        [
          [
            `from dojo_ai.tokenizer import contar_tokens

historial = [
    ("system", "Eres el asistente de DojoShop. Responde en español y con brevedad."),
    ("user", "Hola, quiero devolver unas zapatillas."),
    ("assistant", "Claro. ¿Cuántos días han pasado desde que las recibiste?"),
    ("user", "Unos 12 días."),
    ("assistant", "Entonces estás dentro del plazo de 30 días. Entra en tu cuenta y solicita la etiqueta."),
    ("user", "¿Y cuánto tarda el reembolso?"),
]
total = 0
for rol, texto in historial:
    n = contar_tokens(texto)
    total += n
    print(f"{rol:10} {n:3} tokens")
print("total", total)`,
            'Seis mensajes cortos suman 174 tokens con el tokenizador de juguete. En cada turno nuevo se reenvía **todo** y se paga todo otra vez: las conversaciones largas se encarecen rápidamente',
          ],
        ],
      ),
      tf('Un modelo con una ventana de 128 000 tokens recuerda para siempre todas las conversaciones anteriores contigo.', false, 'No guarda nada entre llamadas: solo "ve" lo que la aplicación le envía en cada petición, hasta el límite de la ventana. Lo demás debe reenviarse o recuperarse.'),
      multi('¿Qué puede causar que un LLM dé una respuesta fluida pero falsa (alucinación)?', ['Que el dato no estuviera en sus datos de entrenamiento o esté desactualizado', 'Que se optimice para producir texto probable, no verdadero', 'Que el contexto no incluya la información necesaria y no se le haya pedido abstenerse', 'Que la temperatura sea siempre 0'], [0, 1, 2], 'Un LLM genera lo probable. Si falta el dato o no hay forma de comprobarlo, rellena con algo verosímil. La temperatura baja reduce la variedad, no garantiza veracidad.'),
      pyPractice({
        goal: 'Entropía cruzada',
        prompt: 'Escribe `entropia_cruzada(probs, objetivos)`: `probs` es una matriz `(N, V)` con la distribución predicha en cada posición y `objetivos` una lista con el índice correcto de cada fila. Devuelve la media de `−log(probs[i, objetivos[i]])` como `float`.',
        starter: 'import numpy as np\n\ndef entropia_cruzada(probs, objetivos):\n    pass\n',
        check: calls([
          ['round(entropia_cruzada(np.array([[0.7, 0.2, 0.1], [0.1, 0.8, 0.1]]), [0, 1]), 4)', '0.2899'],
          ['round(entropia_cruzada(np.full((2, 4), 0.25), [0, 3]), 4)', '1.3863'],
          ['round(float(np.exp(entropia_cruzada(np.full((2, 4), 0.25), [0, 3]))), 3)', '4.0'],
        ]),
        solution: 'import numpy as np\n\ndef entropia_cruzada(probs, objetivos):\n    probs = np.asarray(probs)\n    return float(-np.log(probs[np.arange(len(objetivos)), objetivos]).mean())\n',
        hints: ['Selecciona la probabilidad de la clase correcta de cada fila: `probs[np.arange(len(objetivos)), objetivos]`.', 'Calcula `-np.log(...)` y su media; devuelve un `float` de Python.'],
        explain: 'Un modelo que reparte por igual entre 4 opciones tiene pérdida ln 4 = 1.386 y perplejidad 4: «duda como si eligiera entre 4». Un modelo mejor concentra la probabilidad en la correcta y baja la pérdida.',
        commands: ['entropía cruzada', 'perplejidad'],
      }),
      pyPractice({
        goal: 'Parámetros de LoRA',
        prompt: 'Escribe `lora_params(d_in, d_out, r)`: parámetros que se entrenan al adaptar una matriz `d_out × d_in` con LoRA de rango `r` (dos matrices: `r × d_in` y `d_out × r`).',
        starter: 'def lora_params(d_in, d_out, r):\n    pass\n',
        check: calls([
          ['lora_params(4096, 4096, 8)', '65536'],
          ['lora_params(1000, 500, 4)', '6000'],
          ['round(100 * lora_params(4096, 4096, 8) / (4096 * 4096), 2)', '0.39'],
        ]),
        solution: 'def lora_params(d_in, d_out, r):\n    return r * d_in + d_out * r\n',
        hints: ['A tiene `r * d_in` pesos y B tiene `d_out * r`.', 'Súmalos: `r * (d_in + d_out)`.'],
        explain: 'Con r = 8 en una matriz de 4096×4096 solo se entrena el 0,39 %. Aplicado a las matrices de atención de todas las capas, se ajusta un modelo de miles de millones de parámetros con una sola GPU.',
        commands: ['LoRA', 'ajuste fino'],
      }),
      pyPractice({
        goal: 'Recortar el historial',
        prompt: 'Escribe `ventana(mensajes, limite)`. `mensajes` es una lista de tuplas `(rol, tokens)`. Devuelve la **lista de índices que se conservan**: primero el mensaje del sistema (si existe y cabe) y después los mensajes **más recientes** que quepan, recorriendo desde el último hacia atrás y parando en el primero que no entre. Los índices salen ordenados.',
        starter: 'def ventana(mensajes, limite):\n    pass\n',
        check: calls([
          ['ventana([("system", 38), ("user", 24), ("assistant", 36), ("user", 9), ("assistant", 47), ("user", 20)], 300)', '[0, 1, 2, 3, 4, 5]'],
          ['ventana([("system", 38), ("user", 24), ("assistant", 36), ("user", 9), ("assistant", 47), ("user", 20)], 120)', '[0, 3, 4, 5]'],
          ['ventana([("system", 38), ("user", 24), ("assistant", 36), ("user", 9), ("assistant", 47), ("user", 20)], 60)', '[0, 5]'],
          ['ventana([("system", 38), ("user", 24)], 10)', '[]'],
        ]),
        solution: 'def ventana(mensajes, limite):\n    dentro = [False] * len(mensajes)\n    usados = 0\n    sis = next((i for i, (rol, _) in enumerate(mensajes) if rol == "system"), None)\n    if sis is not None and mensajes[sis][1] <= limite:\n        dentro[sis] = True\n        usados += mensajes[sis][1]\n    for i in range(len(mensajes) - 1, -1, -1):\n        if i == sis:\n            continue\n        if usados + mensajes[i][1] > limite:\n            break\n        dentro[i] = True\n        usados += mensajes[i][1]\n    return [i for i, d in enumerate(dentro) if d]\n',
        hints: ['Reserva primero el sistema: busca el índice del mensaje con rol `"system"` y réstale su coste al presupuesto.', 'Recorre `range(len(mensajes) - 1, -1, -1)` saltando el del sistema y haz `break` en cuanto uno no quepa (se conservan mensajes contiguos hasta el final).'],
        explain: 'Es la política más común: conservar las instrucciones y lo más reciente, y olvidar lo antiguo. Con un límite de 120 tokens se pierden los dos primeros turnos del usuario. Para no perder datos importantes se resume lo viejo en un mensaje corto o se guardan hechos en una memoria externa.',
        commands: ['ventana de contexto'],
      }),
      fill('Completa: el modelo base se convierte en asistente con el ajuste con ___ y la ___ con preferencias humanas.', 'Modelo base → asistente: ajuste con ___ y ___ con preferencias humanas.', ['instrucciones', 'alineación', 'compresión', 'tokenización'], ['instrucciones', 'alineación'], 'SFT enseña el formato de asistente con ejemplos «instrucción → respuesta»; la alineación (RLHF/DPO) usa preferencias humanas para volverlo más útil, honesto y prudente.'),
    ]),
  ],
  boss: {
    goal: 'Misión: tu mini-GPT',
    prompt:
      'Monta un Transformer de un solo bloque (sin entrenar) que genere texto token a token. Las matrices `E` (embeddings), `Wq`, `Wk`, `Wv`, `Wo` y las funciones `softmax` y `posicional` ya están dadas.\n\n1. `atencion_causal(X)`: atención de una cabeza con las matrices `Wq`, `Wk`, `Wv` y máscara causal; devuelve la salida `(T, d)`.\n2. `bloque(X)`: `X + atencion_causal(X) @ Wo` (con conexión residual).\n3. `logits_siguiente(ids)`: embeddings de `ids` **más** la codificación posicional, pasa por `bloque` y devuelve los logits del siguiente token: `h[-1] @ E.T` (vector de tamaño `V`).\n4. `generar(ids, n)`: añade `n` tokens de forma voraz (`argmax` de los logits) y devuelve la lista completa de ids.',
    starter:
      `import numpy as np\n\nrng = np.random.default_rng(42)\nvocab = ["el", "gato", "come", "pescado", "."]\nV, d = len(vocab), 8\nE = rng.normal(size=(V, d))\nWq, Wk, Wv, Wo = (rng.normal(size=(d, d)) / np.sqrt(d) for _ in range(4))\n\n${SOFTMAX}\ndef posicional(T, d):\n    pos = np.arange(T)[:, None]\n    i = np.arange(0, d, 2)[None, :]\n    ang = pos / (10000 ** (i / d))\n    P = np.zeros((T, d))\n    P[:, 0::2] = np.sin(ang)\n    P[:, 1::2] = np.cos(ang)\n    return P\n\ndef atencion_causal(X):\n    pass\n\ndef bloque(X):\n    pass\n\ndef logits_siguiente(ids):\n    pass\n\ndef generar(ids, n):\n    pass\n`,
    check: all(
      truthy('bloque(E[[0, 1, 2, 3]] + posicional(4, d)).shape == (4, 8)'),
      truthy('np.allclose(bloque(np.vstack([E[[0, 1, 2]] + posicional(4, d)[:3], E[3] + 3 + posicional(4, d)[3]]))[:3], bloque(E[[0, 1, 2, 3]] + posicional(4, d))[:3])'),
      truthy('not np.allclose(bloque(np.vstack([E[[0, 1, 2]] + posicional(4, d)[:3], E[3] + 3 + posicional(4, d)[3]]))[3], bloque(E[[0, 1, 2, 3]] + posicional(4, d))[3])'),
      truthy('logits_siguiente([0, 1]).shape == (5,)'),
      calls([
        ['round(float(bloque(E[[0, 1, 2, 3]] + posicional(4, d)).sum()), 4)', '18.5375'],
        ['round(float(logits_siguiente([0, 1]).sum()), 4)', '5.0589'],
        ['generar([0, 1], 3)', '[0, 1, 1, 1, 1]'],
        ['len(generar([2], 6))', '7'],
      ]),
    ),
    solution:
      `import numpy as np\n\nrng = np.random.default_rng(42)\nvocab = ["el", "gato", "come", "pescado", "."]\nV, d = len(vocab), 8\nE = rng.normal(size=(V, d))\nWq, Wk, Wv, Wo = (rng.normal(size=(d, d)) / np.sqrt(d) for _ in range(4))\n\n${SOFTMAX}\ndef posicional(T, d):\n    pos = np.arange(T)[:, None]\n    i = np.arange(0, d, 2)[None, :]\n    ang = pos / (10000 ** (i / d))\n    P = np.zeros((T, d))\n    P[:, 0::2] = np.sin(ang)\n    P[:, 1::2] = np.cos(ang)\n    return P\n\ndef atencion_causal(X):\n    T = X.shape[0]\n    Q, K, Vv = X @ Wq, X @ Wk, X @ Wv\n    pts = Q @ K.T / np.sqrt(d)\n    pts = np.where(np.triu(np.ones((T, T), dtype=bool), 1), -np.inf, pts)\n    return softmax(pts) @ Vv\n\ndef bloque(X):\n    return X + atencion_causal(X) @ Wo\n\ndef logits_siguiente(ids):\n    X = E[ids] + posicional(len(ids), d)\n    h = bloque(X)\n    return h[-1] @ E.T\n\ndef generar(ids, n):\n    ids = list(ids)\n    for _ in range(n):\n        ids.append(int(np.argmax(logits_siguiente(ids))))\n    return ids\n`,
    hints: [
      '`atencion_causal`: `Q, K, Vv = X @ Wq, X @ Wk, X @ Wv`, puntuaciones `Q @ K.T / np.sqrt(d)`, −∞ en `np.triu(np.ones((T, T), dtype=bool), 1)` y `softmax(...) @ Vv`.',
      '`logits_siguiente`: `X = E[ids] + posicional(len(ids), d)`, `h = bloque(X)` y devuelve `h[-1] @ E.T` (la última posición decide el siguiente token).',
      '`generar`: en cada vuelta `ids.append(int(np.argmax(logits_siguiente(ids))))`. Usa `list(ids)` para no modificar la lista original.',
    ],
    explain:
      'Has construido todas las piezas de un LLM: embeddings, posición, atención causal multi-posición, residual, logits y un bucle de generación. Sin entrenar, el modelo repite tokens sin sentido, porque las matrices son aleatorias; entrenarlo es ajustar `E`, `Wq`, `Wk`, `Wv` y `Wo` con la entropía cruzada sobre muchísimo texto. Un LLM real añade normalización, varias cabezas, MLP y decenas de bloques, pero el esqueleto es este. En la zona 12 aprenderás a sacarles partido con **prompts**.',
    commands: ['transformer', 'self-attention', 'logits', 'codificación posicional'],
  },
});
