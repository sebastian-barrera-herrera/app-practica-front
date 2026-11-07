import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, calls, truthy, variable } from './iabuild';

/** Preguntas de prueba sobre la base de conocimiento de DojoShop: (pregunta reformulada, id del documento correcto). */
const PRUEBA = `PRUEBA = [
    ("¿En cuántos días me llega el pedido?", "envio-estandar"), ("¿Entregáis en 24 horas?", "envio-express"),
    ("¿A partir de qué importe no pago el transporte?", "envio-gratis"), ("Quiero saber dónde está mi paquete", "envio-seguimiento"),
    ("¿Se puede enviar a Alemania?", "envio-internacional"), ("¿Cuántos días tengo para devolver un producto?", "devolucion-plazo"),
    ("¿Qué hago para devolver mi compra?", "devolucion-proceso"), ("¿En cuánto tiempo recibo el reembolso?", "reembolso"),
    ("¿Puedo cambiar de talla?", "cambio-talla"), ("¿Cuántos años de garantía tienen los aparatos electrónicos?", "garantia"),
    ("El producto llegó defectuoso, ¿qué hago?", "producto-defectuoso"), ("¿Qué formas de pago admitís?", "pago-metodos"),
    ("¿Puedo dividir el pago en varias cuotas?", "pago-plazos"), ("Necesito la factura de mi compra", "factura"),
    ("¿Puedo usar dos cupones a la vez?", "cupon"), ("No recuerdo mi contraseña", "cuenta-password"),
    ("Quiero eliminar mis datos personales", "cuenta-borrar"), ("¿Cómo gano puntos de fidelidad?", "puntos"),
    ("¿Cuál es el horario del servicio de atención?", "soporte-horario"), ("¿Puedo anular un pedido?", "cancelar-pedido"),
    ("Me equivoqué de dirección, ¿se puede cambiar?", "cambiar-direccion"), ("¿Las tarjetas regalo caducan?", "tarjeta-regalo"),
]
`;

/** Carga habitual: la base de conocimiento y sus embeddings. */
const BASE = `import numpy as np
from dojo_ai.embeddings import embed, tokens
from dojo_ai.corpus import FAQ

ids = [f[0] for f in FAQ]
textos = [f[2] for f in FAQ]
E = embed(textos)                      # una fila por documento, calculada una sola vez
`;

export const ia10 = iaWorld({
  id: 'ia10',
  index: 10,
  title: 'Datos vectoriales y embeddings',
  subtitle: 'Vectores, embeddings, búsqueda semántica, índices aproximados y bases vectoriales',
  emoji: '🧭',
  color: '#2DD4BF',
  level: 'avanzado',
  intro:
    'Los modelos de IA no entienden palabras, imágenes ni canciones: entienden **vectores**. Un **embedding** convierte cualquier cosa en una lista de números de forma que *lo parecido queda cerca*. Con esa idea se construyen los buscadores semánticos, los recomendadores y la parte de "memoria" de los asistentes con IA (**RAG**). En esta zona aprenderás a medir la cercanía, a usar embeddings, a buscar por significado, a hacerlo rápido con **índices aproximados** y a organizarlo todo en una **base de datos vectorial**. Trabajarás con `dojo_ai`, un módulo de Dev Dojo con embeddings de juguete en español y la misma forma que las librerías reales.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia10-1', { title: 'Vectores: puntos en un espacio de significado', summary: 'Distancia, coseno, producto escalar y búsqueda del vecino más cercano', emoji: '📐', commands: ['embedding', 'similitud coseno', 'np.linalg.norm'], minutes: 14 }, [
      learn(
        'Describir cosas con números',
        `
Imagina que describes animales con dos números: **tamaño** y **velocidad**. Cada animal pasa a ser un **vector** \`[tamaño, velocidad]\`, es decir, un **punto en el plano**. Y ocurre algo útil: los animales parecidos quedan cerca (el perro cerca del lobo, el elefante lejos del ratón).

Eso es la base de casi toda la IA moderna: **representar cualquier cosa (una palabra, una frase, una foto, un usuario, una canción) como un vector** y razonar con geometría:
- *¿Qué se parece más a esto?* → el vecino más cercano.
- *¿Cuántos tipos hay?* → agrupar (clustering).
- *¿Qué le gustará a este usuario?* → vectores cercanos a los suyos.

La pregunta clave es **cómo medir "cerca"**. Tres medidas habituales: la **distancia euclídea** (\`np.linalg.norm(a − b)\`), el **producto escalar** (\`a @ b\`) y la **similitud coseno** (\`a @ b / (|a|·|b|)\`), que solo mira la *dirección*.
`,
        '📐',
      ),
      illus('ia-vec-space', 'Cercanía de varias formas', 'Mueve la consulta y cambia la medida. Fíjate en qué animal gana con cada una y en la línea que parte del origen (coseno).'),
      pyDemo(
        'El animal más parecido con NumPy',
        [
          ['import numpy as np\n\nnombres = ["ratón", "conejo", "gato", "perro", "lobo", "caballo", "vaca", "elefante"]\n#            tamaño, velocidad\nV = np.array([[1, 3], [1.5, 6], [2, 5], [3, 6], [5, 8], [8, 9], [8, 3], [10, 2]], dtype=float)\nq = np.array([4.0, 7.0])                    # algo de tamaño 4 y velocidad 7\nd = np.linalg.norm(V - q, axis=1)           # distancia euclídea a cada animal\nfor i in np.argsort(d)[:3]:\n    print(nombres[i], round(float(d[i]), 2))', '`V - q` resta la consulta a cada fila y `norm(axis=1)` mide cada distancia. Perro y lobo empatan a 1.41; después el conejo'],
        ],
      ),
      mc('Dos vectores apuntan exactamente en la misma dirección pero uno es diez veces más largo. ¿Qué dice la similitud coseno?', ['0 (no se parecen)', '1 (máxima similitud)', '10', 'Depende de lo largos que sean'], 1, 'El coseno solo mira el ángulo entre los vectores: misma dirección ⇒ coseno 1, sin importar la longitud. La distancia euclídea, en cambio, sí los vería muy distintos.'),
      learn(
        'Normalizar: el atajo de los buscadores',
        `
Si divides cada vector por su longitud (**normalizar**, longitud 1), el producto escalar **es** el coseno: \`a @ b = cos(a, b)\`. Esto es muy útil porque con una sola multiplicación de matrices se compara la consulta con *todos* los documentos a la vez:

\`\`\`python
U = V / np.linalg.norm(V, axis=1, keepdims=True)   # filas de longitud 1
puntos = U @ q_normalizada                         # un coseno por fila
mejores = np.argsort(-puntos)[:3]                  # los 3 mayores
\`\`\`

Por eso las bases de datos vectoriales guardan los embeddings ya normalizados.
`,
        '⚡',
      ),
      pyDemo(
        'Coseno frente a distancia',
        [
          ['import numpy as np\n\nnombres = ["ratón", "conejo", "gato", "perro", "lobo", "caballo", "vaca", "elefante"]\nV = np.array([[1, 3], [1.5, 6], [2, 5], [3, 6], [5, 8], [8, 9], [8, 3], [10, 2]], dtype=float)\nq = np.array([4.0, 7.0])\n\ndef coseno(a, b):\n    return a @ b / (np.linalg.norm(a) * np.linalg.norm(b))\n\na, b = np.array([1.0, 2.0]), np.array([10.0, 20.0])\nprint(round(float(np.linalg.norm(a - b)), 2), round(float(coseno(a, b)), 2))', 'Están muy lejos (distancia 20.1) pero apuntan igual (coseno 1.0)'],
          ['U = V / np.linalg.norm(V, axis=1, keepdims=True)    # cada fila con longitud 1\nqn = q / np.linalg.norm(q)\nsim = U @ qn\nfor i in np.argsort(-sim)[:3]:\n    print(nombres[i], round(float(sim[i]), 3))', 'Con el coseno, lobo (0.999) y perro (0.998) siguen siendo los más parecidos; los tres de arriba tienen casi la misma proporción tamaño/velocidad'],
        ],
      ),
      tf('La similitud coseno entre dos vectores cambia si multiplico uno de ellos por 100.', false, 'El coseno solo depende del ángulo, no de la longitud: escalar un vector no lo cambia. (El producto escalar y la distancia sí cambian.)'),
      pyOut('¿Qué imprime?', 'import numpy as np\ndef coseno(a, b):\n    return a @ b / (np.linalg.norm(a) * np.linalg.norm(b))\nprint(round(float(coseno(np.array([1, 0]), np.array([0, 5]))), 2), round(float(coseno(np.array([3, 4]), np.array([6, 8]))), 2))', ['1.0 0.0', '0.0 0.5', '0.5 1.0'], 'Vectores perpendiculares ([1,0] y [0,5]) tienen coseno 0; [3,4] y [6,8] apuntan igual: coseno 1.'),
      pyPractice({
        goal: 'Tu función coseno',
        prompt: 'Escribe `coseno(a, b)` que devuelva la similitud coseno de dos vectores de NumPy.',
        starter: 'import numpy as np\n\ndef coseno(a, b):\n    pass\n',
        check: calls([['round(float(coseno(np.array([1.0, 2.0]), np.array([2.0, 4.0]))), 4)', '1.0'], ['round(float(coseno(np.array([1.0, 0.0]), np.array([0.0, 1.0]))), 4)', '0.0'], ['round(float(coseno(np.array([1.0, 1.0]), np.array([1.0, 0.0]))), 4)', '0.7071']]),
        solution: 'import numpy as np\n\ndef coseno(a, b):\n    return a @ b / (np.linalg.norm(a) * np.linalg.norm(b))\n',
        hints: ['Producto escalar: `a @ b`.', 'Divide por el producto de las longitudes: `np.linalg.norm(a) * np.linalg.norm(b)`.'],
        explain: 'Es la fórmula del coseno: producto escalar dividido por las normas. [1, 1] forma 45° con [1, 0], y cos 45° = 0.7071.',
        commands: ['similitud coseno', 'np.linalg.norm'],
      }),
      pyPractice({
        goal: 'Los k más parecidos',
        prompt: 'Escribe `mas_parecidos(consulta, matriz, k)`: devuelve la **lista** de los índices de las `k` filas de `matriz` con mayor similitud coseno con `consulta` (de la más parecida a la menos).',
        starter: 'import numpy as np\n\ndef mas_parecidos(consulta, matriz, k):\n    pass\n',
        check: calls([
          ['mas_parecidos(np.array([1.0, 0.1]), np.array([[0.0, 1.0], [5.0, 0.4], [1.0, 1.0], [-1.0, 0.0]]), 2)', '[1, 2]'],
          ['mas_parecidos(np.array([0.0, 1.0]), np.array([[0.0, 3.0], [1.0, 0.0]]), 1)', '[0]'],
        ]),
        solution: 'import numpy as np\n\ndef mas_parecidos(consulta, matriz, k):\n    U = matriz / np.linalg.norm(matriz, axis=1, keepdims=True)\n    q = consulta / np.linalg.norm(consulta)\n    puntos = U @ q\n    return np.argsort(-puntos)[:k].tolist()\n',
        hints: ['Normaliza las filas (`keepdims=True`) y la consulta; entonces `U @ q` da todos los cosenos.', '`np.argsort(-puntos)` ordena de mayor a menor; toma los `k` primeros y conviértelos con `.tolist()`.'],
        explain: 'Un buscador de vecinos en seis líneas: normalizar, multiplicar, ordenar. Este patrón es el corazón de la búsqueda vectorial; todo lo demás (índices aproximados, bases de datos) es hacerlo más rápido a gran escala.',
        commands: ['similitud coseno', 'np.argsort'],
      }),
      pyPractice({
        goal: 'Normaliza las filas',
        prompt: 'Escribe `normalizar(M)` que devuelva `M` con cada fila dividida por su longitud (norma euclídea), de modo que todas las filas midan 1.',
        starter: 'import numpy as np\n\ndef normalizar(M):\n    pass\n',
        check: calls([['np.allclose(np.linalg.norm(normalizar(np.array([[3.0, 4.0], [0.0, 2.0], [1.0, 1.0]])), axis=1), 1.0)', 'True'], ['normalizar(np.array([[3.0, 4.0]])).round(2).tolist()', '[[0.6, 0.8]]']]),
        solution: 'import numpy as np\n\ndef normalizar(M):\n    return M / np.linalg.norm(M, axis=1, keepdims=True)\n',
        hints: ['`np.linalg.norm(M, axis=1, keepdims=True)` da una columna con la longitud de cada fila.', 'Al dividir, el broadcasting reparte cada longitud por su fila.'],
        explain: 'Con `keepdims=True` la norma tiene forma (n, 1) y se difunde a lo largo de las columnas. Sin él, el broadcasting dividiría por columnas y daría un resultado equivocado (o un error).',
        commands: ['np.linalg.norm', 'similitud coseno'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia10-2', { title: 'Embeddings: vectores que capturan significado', summary: 'Palabras y frases como vectores; vecinos y analogías', emoji: '🧬', commands: ['embedding', 'embed', 'most_similar'], minutes: 14 }, [
      learn(
        '«Dime con quién andas…»',
        `
¿Cómo consigue un ordenador que *perro* y *gato* queden cerca y *perro* y *ordenador* lejos? Con la **hipótesis distribucional**: *las palabras que aparecen en contextos parecidos tienen significados parecidos*. "El **perro** ladra en el parque" y "El **gato** maúlla en el parque" comparten contexto; "El **ordenador** se reinicia" no.

Un modelo (word2vec, GloVe, o la capa de embeddings de un LLM) lee muchísimo texto y **aprende un vector por palabra** (de 100 a miles de números) de forma que las palabras intercambiables en un contexto acaban con vectores parecidos. Para frases se promedian o se combinan con una red.

En este curso usarás \`dojo_ai.embeddings\`, un modelo de juguete (128 números por palabra, ≈700 palabras en español) que se comporta igual pero cabe en el móvil: \`embed(texto)\`, \`similarity(a, b)\`, \`most_similar(palabra)\` y \`analogia(a, b, c)\`.

Dos propiedades fascinantes: los **vecinos** tienen sentido y las **relaciones** son direcciones: el paso *hombre → rey* es casi el mismo vector que *mujer → reina*.
`,
        '🧬',
      ),
      illus('ia-embed-map', 'El mapa de las palabras', 'Toca una palabra para ver sus vecinos más cercanos. Después mira las flechas de las analogías.'),
      pyDemo(
        'Parecidos y diferencias',
        [
          ['from dojo_ai.embeddings import embed, embed_palabra, similarity, most_similar, analogia, vocabulario\n\nprint(len(vocabulario()), embed_palabra("perro").shape)\nfor a, b in [("perro", "gato"), ("perro", "ordenador"), ("comprar", "vender"), ("feliz", "triste")]:\n    print(a, b, round(similarity(a, b), 2))\nprint(most_similar("fútbol", 4))', 'Perro-gato 0.70 frente a perro-ordenador −0.03. «Fútbol» queda rodeada de deportes. Fíjate: *feliz* y *triste* son opuestos pero no se parecen (−0.1), mientras que *comprar* y *vender* (acciones del mismo ámbito) sí'],
        ],
      ),
      pyDemo(
        'Analogías: aritmética con significados',
        [
          ['from dojo_ai.embeddings import analogia\n\nprint(analogia("hombre", "rey", "mujer", 2))\nprint(analogia("francia", "parís", "italia", 2))\nprint(analogia("padre", "madre", "hijo", 2))', '`analogia(a, b, c)` calcula vector(b) − vector(a) + vector(c) y busca la palabra más cercana: hombre→rey como mujer→**reina**; Francia→París como Italia→**Roma**; padre→madre como hijo→**hija**'],
        ],
      ),
      mc('¿Qué significa que el embedding de «rey» − «hombre» + «mujer» sea casi el de «reina»?', ['Que el modelo tiene una lista de reinas guardada', 'Que la diferencia de género está codificada como una dirección constante en el espacio', 'Que «reina» y «rey» son la misma palabra', 'Que los embeddings solo sirven para palabras de la realeza'], 1, 'El modelo no memoriza analogías: al aprender de los contextos, la relación "masculino → femenino" acaba siendo aproximadamente el mismo vector de desplazamiento para todas las parejas.'),
      learn(
        'De palabras a frases (y sus límites)',
        `
Una frase se puede representar combinando los vectores de sus palabras. En el módulo de juguete se **suman y normalizan** (los modelos reales usan redes que tienen en cuenta el orden y el contexto). Así *"quiero devolver un producto"* y *"necesito un reembolso"* quedan cerca aunque no compartan ninguna palabra.

Limitaciones que conviene conocer:
- **Palabras desconocidas** o nuevas (nombres de producto, jerga): sin vector propio, aportan poco.
- **Orden y negación**: "el perro muerde al hombre" y "el hombre muerde al perro" quedan idénticos si se promedian palabras.
- **Polisemia**: "banco" (asiento / entidad) tiene un solo vector en un modelo de palabras sueltas.
- **Sesgos**: los embeddings reflejan los datos con que se entrenaron, estereotipos incluidos.
- **Dimensiones opacas**: ninguna dimensión significa "es un animal"; solo importan distancias y direcciones.
`,
        '⚠️',
      ),
      pyDemo(
        'Frases con el mismo sentido',
        [
          ['from dojo_ai.embeddings import similarity\n\nprint(round(similarity("mi paquete no llega", "el envío se retrasa"), 2))\nprint(round(similarity("mi paquete no llega", "el perro corre por el parque"), 2))\nprint(round(similarity("el perro muerde al hombre", "el hombre muerde al perro"), 2))', 'La primera pareja comparte tema (0.33), la segunda casi no (0.12), y la tercera da 1.0 aunque el significado sea el contrario: este modelo ignora el orden'],
        ],
      ),
      tf('Cada dimensión de un embedding corresponde a una propiedad interpretable, como "es un animal".', false, 'Las dimensiones individuales no significan nada por separado; el significado está en las distancias y direcciones del conjunto.'),
      multi('¿Qué problemas tiene un embedding que promedia los vectores de las palabras de una frase?', ['Ignora el orden de las palabras', 'No distingue los distintos sentidos de una palabra ambigua', 'Las frases largas no se pueden representar', 'Las palabras desconocidas aportan poco'], [0, 1, 3], 'Las frases largas sí se pueden representar (se promedian igual); los otros tres son límites reales de este enfoque simple.'),
      pyPractice({
        goal: 'Palabras parecidas',
        prompt: 'Escribe `vecinas(palabra, n)` que devuelva solo la **lista de palabras** (sin las puntuaciones) de las `n` más parecidas, usando `most_similar`.',
        starter: 'from dojo_ai.embeddings import most_similar\n\ndef vecinas(palabra, n):\n    pass\n',
        check: calls([['vecinas("perro", 2)', "['gato', 'conejo']"], ['len(vecinas("fútbol", 5))', '5'], ['"deporte" in vecinas("fútbol", 5)', 'True']]),
        solution: 'from dojo_ai.embeddings import most_similar\n\ndef vecinas(palabra, n):\n    return [w for w, _ in most_similar(palabra, n)]\n',
        hints: ['`most_similar(palabra, n)` devuelve una lista de parejas `(palabra, puntuación)`.', 'Una lista por comprensión que se quede con la primera de cada pareja.'],
        explain: 'Con una línea tienes un "diccionario de sinónimos aproximados" aprendido solo de la geometría. Cada vecino es una palabra intercambiable en algún contexto.',
        commands: ['most_similar', 'embedding'],
      }),
      pyPractice({
        goal: 'Analogía a mano',
        prompt: 'Calcula `obj = vector(rey) − vector(hombre) + vector(mujer)` con `embed_palabra`, y guarda en `mejor` la palabra de la lista `candidatas` con mayor similitud coseno con `obj` (usa `cosine`).',
        starter: 'from dojo_ai.embeddings import embed_palabra, cosine\n\ncandidatas = ["reina", "princesa", "camarera", "perro", "madre"]\nobj = mejor = None\n',
        check: variable('mejor', "'reina'"),
        solution: 'from dojo_ai.embeddings import embed_palabra, cosine\n\ncandidatas = ["reina", "princesa", "camarera", "perro", "madre"]\nobj = embed_palabra("rey") - embed_palabra("hombre") + embed_palabra("mujer")\nmejor = max(candidatas, key=lambda w: cosine(obj, embed_palabra(w)))\n',
        hints: ['`embed_palabra("rey")` devuelve un array NumPy: puedes sumarlos y restarlos directamente.', '`max(candidatas, key=lambda w: cosine(obj, embed_palabra(w)))` elige la más parecida.'],
        explain: 'Esto es exactamente lo que hace `analogia` por dentro. La aritmética con vectores de significado fue una de las grandes sorpresas de word2vec en 2013.',
        commands: ['embedding', 'most_similar'],
      }),
      pyPractice({
        goal: 'La frase más parecida',
        prompt: 'Escribe `mas_parecida(frase, candidatas)` que devuelva, de una lista de frases, la que tiene mayor similitud (`similarity`) con `frase`.',
        starter: 'from dojo_ai.embeddings import similarity\n\ndef mas_parecida(frase, candidatas):\n    pass\n',
        check: calls([['mas_parecida("quiero devolver un artículo", ["el envío es gratis", "puedo devolver mi compra", "aceptamos tarjeta"])', "'puedo devolver mi compra'"], ['mas_parecida("¿cuándo llega mi paquete?", ["la contraseña es secreta", "el envío tarda tres días", "hay descuentos"])', "'el envío tarda tres días'"]]),
        solution: 'from dojo_ai.embeddings import similarity\n\ndef mas_parecida(frase, candidatas):\n    return max(candidatas, key=lambda c: similarity(frase, c))\n',
        hints: ['`max(lista, key=función)` devuelve el elemento con mayor valor de la función.', 'La función a maximizar es `similarity(frase, c)`.'],
        explain: 'Este es el núcleo de un buscador semántico en una línea. En la siguiente lección lo escalas a una base de conocimiento completa y lo evalúas con preguntas reales.',
        commands: ['embed', 'búsqueda semántica'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia10-3', { title: 'Búsqueda semántica', summary: 'Buscar por significado, medir con hit@k y saber decir «no lo sé»', emoji: '🔎', commands: ['búsqueda semántica', 'embed', 'hit@k', 'np.argsort'], minutes: 16 }, [
      learn(
        'Buscar lo que quieres decir, no lo que escribes',
        `
Una búsqueda clásica por palabras clave falla cuando preguntas con otras palabras: *"¿Mandáis fuera de España?"* no comparte ni una palabra con *"Enviamos a toda la Unión Europea"*. La **búsqueda semántica** compara significados:

1. **Indexar** (una sola vez): convierte cada documento en un embedding y guárdalos en una matriz \`E\` (una fila por documento).
2. **Consultar**: convierte la pregunta en un embedding \`q\`.
3. **Ordenar**: \`E @ q\` da la similitud con todos los documentos; \`np.argsort(-puntos)[:k]\` selecciona los k mejores.

Usarás la base de conocimiento de **DojoShop**, una tienda ficticia con 24 respuestas de atención al cliente (\`dojo_ai.corpus.FAQ\`: envíos, devoluciones, pagos, cuenta…).
`,
        '🔎',
      ),
      illus('ia-semantic-search', 'Palabras frente a significado', 'Elige una de las 8 preguntas y compara qué documentos devuelve cada método. Hay aciertos y fallos reales.'),
      pyDemo(
        'Dos buscadores sobre las mismas 24 respuestas',
        [
          [`${BASE}\ndef por_palabras(consulta, k=2):\n    q = set(tokens(consulta))\n    puntos = np.array([len(q & set(tokens(t))) for t in textos])\n    orden = np.argsort(-puntos, kind="stable")[:k]\n    return [(ids[i], int(puntos[i])) for i in orden]\n\ndef por_significado(consulta, k=2):\n    s = E @ embed(consulta)\n    orden = np.argsort(-s, kind="stable")[:k]\n    return [(ids[i], round(float(s[i]), 2)) for i in orden]\n\nfor c in ["¿Mandáis fuera de España?", "No recuerdo mi clave de acceso"]:\n    print(c)\n    print("  palabras:   ", por_palabras(c))\n    print("  significado:", por_significado(c))`, 'Por palabras solo se ven coincidencias sueltas (de, mi…); por significado salen `envio-internacional` y `cuenta-password`, pese a que la consulta no repite sus palabras'],
        ],
      ),
      learn(
        'Medir si la búsqueda funciona',
        `
Una demo bonita no basta: hay que **medirla**. Se prepara un conjunto de preguntas con su documento correcto (etiquetado por personas) y se calcula:

- **hit@k**: ¿qué fracción de preguntas tiene el documento correcto entre los k primeros resultados? *hit@1* es el más exigente.
- **MRR** (*mean reciprocal rank*): media de \`1 / posición\` del documento correcto.

Y hay otro problema: ¿qué pasa si la pregunta **no tiene respuesta** en la base ("¿cuál es la capital de Francia?")? La búsqueda siempre devuelve algo. Hay que fijar un **umbral de similitud** por debajo del cual se responde "no lo sé". Mirando las similitudes de las preguntas buenas y de las ajenas se elige un valor intermedio.
`,
        '📏',
      ),
      pyDemo(
        'hit@1 y hit@3 con 22 preguntas reformuladas',
        [
          [`${BASE}${PRUEBA}\ndef ranking(consulta, k, metodo):\n    if metodo == "palabras":\n        q = set(tokens(consulta))\n        puntos = np.array([len(q & set(tokens(t))) for t in textos])\n    else:\n        puntos = E @ embed(consulta)\n    return [ids[i] for i in np.argsort(-puntos, kind="stable")[:k]]\n\nfor k in (1, 3):\n    for metodo in ("palabras", "significado"):\n        aciertos = sum(esperado in ranking(q, k, metodo) for q, esperado in PRUEBA)\n        print("hit@%d" % k, metodo, aciertos, "de", len(PRUEBA))`, 'Por palabras acierta 14 de 22 en el primer puesto y 17 en los tres primeros; con el significado, 22 de 22 en ambos casos. Reformular la pregunta es justo donde ganan los embeddings'],
          ['fuera = ["¿Cuál es la capital de Francia?", "dame una receta de paella", "cuéntame un chiste"]\nprint([round(float((E @ embed(q)).max()), 2) for q in fuera])\nprint(sorted(round(float((E @ embed(q)).max()), 2) for q, _ in PRUEBA)[:5])', 'Las preguntas ajenas a la tienda no pasan de 0.3 de similitud; las buenas más flojas rondan 0.45. Un umbral cercano a 0.4 separa ambos grupos'],
        ],
      ),
      mc('Tu buscador devuelve siempre los documentos más cercanos, aunque la pregunta no tenga que ver con la base. ¿Cómo evitas respuestas absurdas?', ['Entrenando el modelo con más palabras', 'Fijando un umbral de similitud mínima y respondiendo «no lo sé» por debajo', 'Devolviendo siempre más documentos', 'No se puede evitar'], 1, 'La búsqueda vectorial siempre devuelve vecinos, por lejanos que sean. Un umbral calibrado con preguntas buenas y ajenas permite abstenerse.'),
      tf('Si una búsqueda tiene hit@3 = 100 %, los documentos correctos aparecen siempre en primer lugar.', false, 'hit@3 solo garantiza que el correcto está entre los tres primeros. El primer puesto lo mide hit@1 (o el MRR).'),
      pyOut('¿Qué imprime?', 'import numpy as np\npuntos = np.array([0.2, 0.9, 0.5, 0.9, 0.1])\nprint(np.argsort(-puntos, kind="stable")[:3].tolist(), float(puntos.max()))', ['[1, 3, 2] 0.5', '[3, 1, 2] 0.9', '[0, 4, 2] 0.1'], 'Los puntos mayores son 0.9 (índices 1 y 3, con empate resuelto por orden estable) y después 0.5 (índice 2); el máximo vale 0.9.'),
      pyPractice({
        goal: 'Construye el buscador',
        prompt: `Con la base de conocimiento ya cargada (\`ids\`, \`textos\`, \`E\`), escribe \`buscar(consulta, k=3)\` que devuelva la **lista de ids** de los \`k\` documentos más parecidos a la consulta.`,
        starter: `${BASE}\ndef buscar(consulta, k=3):\n    pass\n`,
        check: calls([['buscar("No recuerdo mi clave de acceso", 1)', "['cuenta-password']"], ['buscar("¿Se puede pagar a plazos?", 1)', "['pago-plazos']"], ['buscar("Mi pedido llegó roto", 2)[0]', "'producto-defectuoso'"], ['len(buscar("hola", 5))', '5']]),
        solution: `${BASE}\ndef buscar(consulta, k=3):\n    puntos = E @ embed(consulta)\n    orden = np.argsort(-puntos, kind="stable")[:k]\n    return [ids[i] for i in orden]\n`,
        hints: ['La similitud de la consulta con todos los documentos es `E @ embed(consulta)`.', 'Ordena de mayor a menor con `np.argsort(-puntos, kind="stable")[:k]` y traduce índices a ids.'],
        explain: 'Tres líneas son un buscador semántico. Las bases de datos vectoriales hacen lo mismo pero con índices aproximados, filtros y persistencia.',
        commands: ['búsqueda semántica', 'np.argsort'],
      }),
      pyPractice({
        goal: 'Calcula el hit@k',
        prompt: 'Con la función `buscar` ya definida y la lista `PRUEBA`, escribe `hit_at_k(k)` que devuelva la fracción de preguntas cuyo documento correcto está entre los `k` primeros resultados.',
        starter: `${BASE}${PRUEBA}\ndef buscar(consulta, k=3):\n    puntos = E @ embed(consulta)\n    return [ids[i] for i in np.argsort(-puntos, kind="stable")[:k]]\n\ndef hit_at_k(k):\n    pass\n`,
        check: calls([['round(hit_at_k(1), 3)', '1.0'], ['round(hit_at_k(3), 3)', '1.0']]),
        solution: `${BASE}${PRUEBA}\ndef buscar(consulta, k=3):\n    puntos = E @ embed(consulta)\n    return [ids[i] for i in np.argsort(-puntos, kind="stable")[:k]]\n\ndef hit_at_k(k):\n    return sum(esperado in buscar(q, k) for q, esperado in PRUEBA) / len(PRUEBA)\n`,
        hints: ['Para cada pareja `(q, esperado)` comprueba `esperado in buscar(q, k)`.', 'Suma los `True` (cuentan como 1) y divide por `len(PRUEBA)`.'],
        explain: 'Con este conjunto de prueba el buscador de juguete acierta siempre; con preguntas más difíciles o ambiguas bajaría. La clave es tener un conjunto de prueba y mirarlo cada vez que cambies algo.',
        commands: ['hit@k', 'búsqueda semántica'],
      }),
      pyPractice({
        goal: 'Responder o abstenerse',
        prompt: 'Escribe `responder(consulta, umbral=0.4)`: si la mayor similitud con algún documento es menor que `umbral`, devuelve `None`; si no, el id del documento más parecido.',
        starter: `${BASE}\ndef responder(consulta, umbral=0.4):\n    pass\n`,
        check: calls([['responder("No recuerdo mi clave de acceso")', "'cuenta-password'"], ['responder("¿Cuál es la capital de Francia?")', 'None'], ['responder("dame una receta de paella")', 'None'], ['responder("¿Puedo anular un pedido?")', "'cancelar-pedido'"]]),
        solution: `${BASE}\ndef responder(consulta, umbral=0.4):\n    puntos = E @ embed(consulta)\n    mejor = int(np.argmax(puntos))\n    if puntos[mejor] < umbral:\n        return None\n    return ids[mejor]\n`,
        hints: ['`np.argmax(puntos)` da el índice del documento más parecido; `puntos[mejor]` su similitud.', 'Si esa similitud es menor que `umbral`, devuelve `None`.'],
        explain: 'Saber decir "no lo sé" es lo que separa un asistente fiable de uno que inventa. El umbral nunca es perfecto (una pregunta como "¿qué tiempo hará mañana?" confunde a este modelo con las respuestas sobre plazos): por eso en producción se añaden más señales.',
        commands: ['búsqueda semántica', 'hit@k'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia10-4', { title: 'Índices vectoriales: exactos y aproximados', summary: 'Fuerza bruta, IVF y LSH: velocidad frente a precisión', emoji: '🚀', commands: ['IndexFlatL2', 'IndexIVF', 'búsqueda aproximada'], minutes: 15 }, [
      learn(
        'Cuando comparar con todo es demasiado',
        `
La búsqueda que acabas de escribir compara la consulta con **todos** los vectores: coste proporcional a *N × d*. Con 20 documentos es instantáneo; con **100 millones** de embeddings de 768 números, cada búsqueda tardaría segundos y no habría usuario que aguante.

La solución es renunciar a un poco de exactitud: la **búsqueda aproximada** (*ANN*, *approximate nearest neighbors*) devuelve vecinos "casi siempre los correctos" mirando solo una fracción de los datos. Familias principales:

- **IVF** (archivo invertido): agrupa los vectores en celdas con k-means; al buscar visita solo las \`nprobe\` celdas más cercanas.
- **LSH** (*locality-sensitive hashing*): hiperplanos aleatorios dan a cada vector un código de bits; solo se comparan los del mismo "cubo".
- **HNSW**: un grafo de vecinos por niveles; se navega "saltando" hacia la consulta. Es lo más usado en bases vectoriales.
- **PQ** (cuantización de producto): comprime los vectores para que quepan en memoria.

Siempre hay un compromiso **velocidad ↔ precisión (recall) ↔ memoria**. La precisión se mide con el **recall@k**: qué parte de los k vecinos exactos encontró el índice aproximado.
`,
        '🚀',
      ),
      pyDemo(
        'El índice exacto (el de referencia)',
        [
          ['import numpy as np\nfrom sklearn.datasets import load_digits\nfrom dojo_ai.vectordb import IndexFlatL2, IndexIVF, IndexLSH, recall\n\nX, y = load_digits(return_X_y=True)\nX = X / 16.0                                  # cada dígito es un vector de 64 números\nbase, consultas = X[:1500], X[1500:1520]\n\nexacto = IndexFlatL2(64)\nexacto.add(base)\nD, I_exacto = exacto.search(consultas, 5)\nprint(exacto.ntotal, I_exacto.shape, exacto.last_comparisons)', '20 consultas contra 1 500 vectores = 30 000 comparaciones. `I_exacto` guarda los 5 vecinos reales de cada consulta (para medir el recall de los demás)'],
        ],
      ),
      illus('ia-ann', 'Celdas de un índice IVF', 'Cada color es una celda. Con nprobe = 1 solo se mira la celda de la consulta: sube nprobe y verás cómo se recuperan los vecinos que se escapaban.'),
      pyDemo(
        'IVF: cuántas celdas se visitan',
        [
          ['import numpy as np\nfrom sklearn.datasets import load_digits\nfrom dojo_ai.vectordb import IndexFlatL2, IndexIVF, IndexLSH, recall\n\nX, y = load_digits(return_X_y=True)\nX = X / 16.0\nbase, consultas = X[:1500], X[1500:1520]\nexacto = IndexFlatL2(64)\nexacto.add(base)\nD, I_exacto = exacto.search(consultas, 5)\n\nfor nprobe in (1, 2, 4, 8):\n    ivf = IndexIVF(64, nlist=16, nprobe=nprobe)\n    ivf.train(base)\n    ivf.add(base)\n    D, I = ivf.search(consultas, 5)\n    print(nprobe, round(recall(I, I_exacto), 2), ivf.last_comparisons)', 'Con 1 celda ya se encuentran el 92 % de los vecinos exactos con ≈2 500 comparaciones en vez de 30 000 (12 veces menos); con 2 celdas, el 100 %. Más celdas solo cuestan más'],
        ],
      ),
      pyDemo(
        'LSH: códigos de bits',
        [
          ['import numpy as np\nfrom sklearn.datasets import load_digits\nfrom dojo_ai.vectordb import IndexFlatL2, IndexIVF, IndexLSH, recall\n\nX, y = load_digits(return_X_y=True)\nX = X / 16.0\nbase, consultas = X[:1500], X[1500:1520]\nexacto = IndexFlatL2(64)\nexacto.add(base)\nD, I_exacto = exacto.search(consultas, 5)\n\nfor nbits in (4, 6, 8):\n    lsh = IndexLSH(64, nbits=nbits)\n    lsh.add(base)\n    D, I = lsh.search(consultas, 5)\n    print(nbits, round(recall(I, I_exacto), 2), lsh.last_comparisons)', 'Cuantos más bits, más cubos y menos candidatos por cubo: más rápido pero se pierden más vecinos. Es un compromiso que se ajusta al problema'],
        ],
      ),
      tf('Un índice aproximado devuelve siempre exactamente los mismos vecinos que la búsqueda exacta, pero más rápido.', false, 'Por eso se llama aproximado: gana velocidad a cambio de que a veces se le escape algún vecino real. El recall@k mide cuántos.'),
      match('Une cada técnica con su idea:', [['IVF', 'Celdas de k-means; solo se visitan las más cercanas'], ['LSH', 'Códigos de bits por hiperplanos aleatorios'], ['HNSW', 'Grafo de vecinos por niveles'], ['PQ', 'Comprime los vectores en trozos cuantizados']], 'Todas buscan lo mismo —no comparar con todo— pero con estructuras distintas: celdas, hash, grafo o compresión.'),
      mc('Tienes 5 000 embeddings y recibes pocas consultas por segundo. ¿Qué índice eliges?', ['Uno aproximado complejo, para ir rápido', 'Uno exacto (IndexFlat): es simple, perfecto en precisión y suficientemente rápido', 'Ninguno, hay que ordenar a mano', 'LSH con 32 bits'], 1, 'Con pocos miles de vectores la búsqueda exacta cuesta milisegundos. Los índices aproximados compensan a partir de cientos de miles o millones de vectores.'),
      pyPractice({
        goal: 'Mide el recall',
        prompt: 'Escribe `recall_manual(aprox, exacto)`: recibe dos listas de listas de ids (una por consulta) y devuelve la fracción media de ids exactos que también aparecen en el resultado aproximado.',
        starter: 'def recall_manual(aprox, exacto):\n    pass\n',
        check: calls([['recall_manual([[1, 2, 9]], [[1, 2, 3]])', '0.6666666666666666'], ['recall_manual([[1, 2], [5, 6]], [[1, 2], [5, 7]])', '0.75'], ['recall_manual([[4, 5]], [[5, 4]])', '1.0']]),
        solution: 'def recall_manual(aprox, exacto):\n    total = 0.0\n    for a, e in zip(aprox, exacto):\n        total += len(set(a) & set(e)) / len(e)\n    return total / len(exacto)\n',
        hints: ['Para cada consulta, `len(set(a) & set(e))` cuenta los vecinos exactos encontrados.', 'Divide por `len(e)` y promedia entre consultas.'],
        explain: 'El orden dentro de los k resultados no importa para el recall: [4, 5] y [5, 4] dan 1.0. Un recall de 0.95 significa que, de cada 100 vecinos reales, el índice encuentra 95.',
        commands: ['búsqueda aproximada'],
      }),
      pyPractice({
        goal: 'Elige nprobe',
        prompt: 'Escribe `menor_nprobe(objetivo)`: construye un `IndexIVF(64, nlist=16)` para `nprobe` de 1 a 16 y devuelve el **menor** `nprobe` cuyo recall frente a `I_exacto` sea al menos `objetivo`.',
        starter: 'import numpy as np\nfrom sklearn.datasets import load_digits\nfrom dojo_ai.vectordb import IndexFlatL2, IndexIVF, recall\n\nX, y = load_digits(return_X_y=True)\nX = X / 16.0\nbase, consultas = X[:1500], X[1500:1520]\nexacto = IndexFlatL2(64); exacto.add(base)\nD, I_exacto = exacto.search(consultas, 5)\n\ndef menor_nprobe(objetivo):\n    pass\n',
        check: calls([['menor_nprobe(0.9)', '1'], ['menor_nprobe(0.99)', '2']]),
        solution: 'import numpy as np\nfrom sklearn.datasets import load_digits\nfrom dojo_ai.vectordb import IndexFlatL2, IndexIVF, recall\n\nX, y = load_digits(return_X_y=True)\nX = X / 16.0\nbase, consultas = X[:1500], X[1500:1520]\nexacto = IndexFlatL2(64); exacto.add(base)\nD, I_exacto = exacto.search(consultas, 5)\n\ndef menor_nprobe(objetivo):\n    for nprobe in range(1, 17):\n        ivf = IndexIVF(64, nlist=16, nprobe=nprobe)\n        ivf.train(base)\n        ivf.add(base)\n        D, I = ivf.search(consultas, 5)\n        if recall(I, I_exacto) >= objetivo:\n            return nprobe\n',
        hints: ['Un bucle `for nprobe in range(1, 17)` y devuelve (`return`) en cuanto se alcance el objetivo.', 'Dentro: crea el índice, entrénalo con `ivf.train(base)`, añade `base`, busca y compara con `recall(I, I_exacto)`.'],
        explain: 'Así se ajusta un índice en la práctica: se fija el recall que necesitas (95–99 %) y se busca la configuración más barata que lo cumple. Siempre sobre tus propios datos y consultas.',
        commands: ['IndexIVF', 'búsqueda aproximada'],
      }),
      pyPractice({
        goal: 'Cuánto ahorra IVF',
        prompt: 'Con `N` vectores repartidos por igual en `nlist` celdas, una búsqueda IVF compara con los `nlist` centros y con los vectores de las `nprobe` celdas visitadas. Escribe `comparaciones_ivf(N, nlist, nprobe)` que devuelva ese número (entero) y `ahorro(N, nlist, nprobe)` con la fracción de comparaciones **evitadas** frente a la búsqueda exacta (`N` comparaciones).',
        starter: 'def comparaciones_ivf(N, nlist, nprobe):\n    pass\n\ndef ahorro(N, nlist, nprobe):\n    pass\n',
        check: calls([['comparaciones_ivf(1500, 16, 1)', '109'], ['comparaciones_ivf(1500, 16, 4)', '391'], ['round(ahorro(1500, 16, 1), 3)', '0.927'], ['round(ahorro(1_000_000, 1000, 10), 4)', '0.989']]),
        solution: 'def comparaciones_ivf(N, nlist, nprobe):\n    return nlist + nprobe * N // nlist\n\ndef ahorro(N, nlist, nprobe):\n    return 1 - comparaciones_ivf(N, nlist, nprobe) / N\n',
        hints: ['Cada celda tiene `N // nlist` vectores; se visitan `nprobe` celdas.', 'El ahorro es `1 - comparaciones / N`.'],
        explain: 'Con un millón de vectores, 1 000 celdas y nprobe = 10, se compara con solo ≈11 000 en lugar de 1 000 000: ahorro del 98.9 %. Por eso funcionan los buscadores de millones de documentos.',
        commands: ['IndexIVF', 'búsqueda aproximada'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia10-5', { title: 'Bases de datos vectoriales y chunking', summary: 'Colecciones, metadatos, filtros y cómo trocear documentos largos', emoji: '🗄️', commands: ['base de datos vectorial', 'metadatos y filtros', 'chunking'], minutes: 16 }, [
      learn(
        'Más que una matriz de NumPy',
        `
Una **base de datos vectorial** guarda embeddings *junto con* su texto original y **metadatos**, mantiene un índice (exacto o aproximado) y resuelve consultas del tipo *"dame los n más parecidos a esto, pero solo de la categoría pagos"*. Además aporta lo que una matriz no da: persistencia, actualizaciones y borrados, control de acceso y escalado. Ejemplos: **Chroma**, **Qdrant**, **Weaviate**, **Pinecone**, **pgvector** (extensión de PostgreSQL).

El módulo \`dojo_ai.vectordb\` incluye una versión de juguete con la **misma forma que Chroma**:

\`\`\`python
cliente = Client()
col = cliente.create_collection("faq", metadata={"hnsw:space": "cosine"})
col.add(ids=[...], documents=[...], metadatas=[{...}])
col.query(query_texts=["..."], n_results=3, where={"categoria": "pagos"})
\`\`\`

La colección calcula los embeddings por ti y \`query\` devuelve \`ids\`, \`documents\`, \`metadatas\` y \`distances\` (con el espacio coseno, distancia = 1 − similitud).
`,
        '🗄️',
      ),
      pyDemo(
        'Una colección de preguntas frecuentes',
        [
          ['from dojo_ai.vectordb import Client\nfrom dojo_ai.corpus import FAQ\n\ncliente = Client()\ncol = cliente.create_collection("faq", metadata={"hnsw:space": "cosine"})\ncol.add(ids=[f[0] for f in FAQ],\n        documents=[f[2] for f in FAQ],\n        metadatas=[{"categoria": f[1]} for f in FAQ])\nprint(col.count(), col)\nr = col.query(query_texts=["¿Puedo devolver un producto?"], n_results=2)\nprint(r["ids"][0], [round(d, 3) for d in r["distances"][0]])', '24 documentos indexados. La consulta devuelve los dos más cercanos con sus distancias (menor = más parecido)'],
          ['r = col.query(query_texts=["¿cuánto cuesta?"], n_results=3, where={"categoria": "envíos"})\nprint(r["ids"][0])\nr = col.query(query_texts=["¿cuánto cuesta?"], n_results=3, where={"categoria": "pagos"})\nprint(r["ids"][0])', 'La misma pregunta ambigua obtiene respuestas distintas según el **filtro de metadatos**: se descartan los documentos que no cumplen `where` antes de comparar'],
        ],
      ),
      learn(
        'Chunking: trocear documentos',
        `
Un manual de 40 páginas no se convierte en *un* embedding: un vector no puede resumir cientos de temas. Se divide en **fragmentos** (*chunks*) y se indexa cada uno. Decisiones y compromisos:

- **Tamaño**: fragmentos *pequeños* (100–300 caracteres) son precisos pero pierden contexto ("tarda entre 5 y 7 días" sin saber de qué); *grandes* (1 000+) incluyen el contexto, pero mezclan temas y su embedding queda **diluido**. Punto de partida habitual: 300–800 caracteres.
- **Solape**: repetir el final de un fragmento al inicio del siguiente (10–20 %) evita que una respuesta quede **partida** por el corte.
- **Límites con sentido**: mejor cortar por frases, párrafos o encabezados que por posición fija.
- **Metadatos**: guarda de qué documento, página y posición viene cada fragmento para poder **citar** la fuente y ver el contexto.

El mejor tamaño no se adivina: se **mide** con un conjunto de preguntas (hit@k), como en la lección anterior.
`,
        '✂️',
      ),
      illus('ia-chunking', 'Trocear y no partir la respuesta', 'Cambia el tamaño y el solape. Con solape 0 busca un tamaño en el que el corte caiga justo sobre la frase de la respuesta.'),
      pyDemo(
        'Trocear y recuperar el fragmento correcto',
        [
          ['from dojo_ai.vectordb import Client\n\nTEXTO = ("POLÍTICA DE DEVOLUCIONES. Puedes devolver cualquier producto en un plazo de 30 días desde que lo recibes. "\n         "El artículo debe estar sin usar y con su embalaje original. Para iniciar la devolución entra en tu cuenta y solicita la etiqueta. "\n         "El reembolso se realiza en el mismo método de pago y tarda entre 5 y 7 días hábiles. "\n         "Los productos personalizados y las tarjetas regalo no admiten devolución. "\n         "Si el artículo llegó defectuoso, la devolución es gratuita y la recogemos nosotros en tu domicilio.")\n\ndef trocear(texto, tam, solape):\n    paso = tam - solape\n    return [texto[i:i + tam] for i in range(0, len(texto), paso)]\n\nRESPUESTA = "tarda entre 5 y 7 días hábiles"\nprint(len(TEXTO), "caracteres")\nfor tam, solape in [(150, 0), (150, 40), (400, 0)]:\n    trozos = trocear(TEXTO, tam, solape)\n    entero = any(RESPUESTA in t for t in trozos)\n    print(tam, solape, len(trozos), "respuesta entera en algún fragmento:", entero)', 'Con 150 caracteres y sin solape, el corte (carácter 300) cae en medio de la frase y **ningún** fragmento contiene la respuesta completa; con solape de 40 sí. Con 400 caracteres cabe, pero cada fragmento mezcla varios temas'],
        ],
      ),
      mc('Tus fragmentos son de 3 000 caracteres y la búsqueda devuelve resultados poco precisos. ¿Qué pruebas primero?', ['Fragmentos más pequeños (300–800 caracteres) con algo de solape', 'Fragmentos aún más grandes', 'Cambiar de lenguaje de programación', 'Quitar los metadatos'], 0, 'Los fragmentos muy grandes diluyen el embedding con muchos temas. Reducirlos (y medir el hit@k) suele mejorar la precisión.'),
      tf('El solape entre fragmentos sirve para que una respuesta que cae en el corte no quede dividida entre dos fragmentos.', true, 'Al repetir el final del fragmento anterior al inicio del siguiente, al menos uno de los dos contiene la frase completa.'),
      multi('¿Qué metadatos tiene sentido guardar con cada fragmento?', ['Documento de origen y página', 'Fecha de actualización', 'Quién tiene permiso para verlo', 'La contraseña del administrador'], [0, 1, 2], 'Origen y fecha permiten citar y filtrar; los permisos evitan filtrar información a quien no debe verla. Nunca guardes secretos en una base de datos de consulta.'),
      pyPractice({
        goal: 'Trocea con solape',
        prompt: 'Escribe `trocear(texto, tam, solape)`: lista de fragmentos de `tam` caracteres; cada fragmento empieza `tam − solape` caracteres después del anterior. Detente cuando un fragmento llegue al final del texto (no añadas fragmentos que ya estén contenidos en el anterior).',
        starter: 'def trocear(texto, tam, solape):\n    pass\n',
        check: calls([['trocear("abcdefghij", 4, 1)', "['abcd', 'defg', 'ghij']"], ['trocear("abcdefghij", 5, 0)', "['abcde', 'fghij']"], ['trocear("abc", 10, 2)', "['abc']"], ['len(trocear("x" * 1000, 300, 50))', '4']]),
        solution: 'def trocear(texto, tam, solape):\n    paso = tam - solape\n    trozos = []\n    for i in range(0, len(texto), paso):\n        trozos.append(texto[i:i + tam])\n        if i + tam >= len(texto):\n            break\n    return trozos\n',
        hints: ['El paso entre inicios es `tam - solape`: `range(0, len(texto), paso)`.', 'Después de añadir un fragmento, si `i + tam >= len(texto)` ya llegaste al final: `break`.'],
        explain: 'Sin el `break` final se añadirían restos que ya están dentro del último fragmento. Con 1 000 caracteres, tam 300 y solape 50, los inicios son 0, 250, 500 y 750: 4 fragmentos.',
        commands: ['chunking'],
      }),
      pyPractice({
        goal: 'Consulta con filtro',
        prompt: 'Escribe `buscar_en(col, pregunta, categoria, n=2)` que devuelva la **lista de ids** de los `n` documentos más cercanos a la pregunta **dentro de la categoría** dada.',
        starter: 'from dojo_ai.vectordb import Client\nfrom dojo_ai.corpus import FAQ\n\ncol = Client().create_collection("faq", metadata={"hnsw:space": "cosine"})\ncol.add(ids=[f[0] for f in FAQ], documents=[f[2] for f in FAQ], metadatas=[{"categoria": f[1]} for f in FAQ])\n\ndef buscar_en(col, pregunta, categoria, n=2):\n    pass\n',
        check: calls([['buscar_en(col, "¿Puedo pagar con PayPal?", "pagos", 1)', "['pago-metodos']"], ['buscar_en(col, "¿Puedo pagar con PayPal?", "envíos", 1)[0].startswith("envio")', 'True'], ['len(buscar_en(col, "hola", "cuenta", 3))', '3']]),
        solution: 'from dojo_ai.vectordb import Client\nfrom dojo_ai.corpus import FAQ\n\ncol = Client().create_collection("faq", metadata={"hnsw:space": "cosine"})\ncol.add(ids=[f[0] for f in FAQ], documents=[f[2] for f in FAQ], metadatas=[{"categoria": f[1]} for f in FAQ])\n\ndef buscar_en(col, pregunta, categoria, n=2):\n    r = col.query(query_texts=[pregunta], n_results=n, where={"categoria": categoria})\n    return r["ids"][0]\n',
        hints: ['`col.query(query_texts=[pregunta], n_results=n, where={"categoria": categoria})`.', 'El resultado es un diccionario con listas de listas: los ids de la primera (y única) consulta están en `r["ids"][0]`.'],
        explain: 'El filtro se aplica antes de buscar: aunque preguntes por PayPal, con `categoria="envíos"` solo pueden salir documentos de envíos. Es útil para acotar y también para controlar quién ve qué.',
        commands: ['base de datos vectorial', 'metadatos y filtros'],
      }),
      pyPractice({
        goal: 'Trocea por frases',
        prompt: 'Escribe `trocear_frases(texto, max_chars)`: separa el texto en frases por el punto (`. `) y las agrupa en fragmentos **sin pasar de `max_chars`** caracteres (une frases con un espacio; una frase sola puede superar el límite).',
        starter: 'def trocear_frases(texto, max_chars):\n    pass\n',
        check: calls([['trocear_frases("Uno dos. Tres cuatro. Cinco seis siete.", 22)', "['Uno dos. Tres cuatro.', 'Cinco seis siete.']"], ['len(trocear_frases("A. B. C. D.", 100))', '1'], ['trocear_frases("Una frase muy larga sin cortes.", 5)', "['Una frase muy larga sin cortes.']"]]),
        solution: 'def trocear_frases(texto, max_chars):\n    frases = [f.strip() + "." for f in texto.split(".") if f.strip()]\n    trozos = []\n    actual = ""\n    for f in frases:\n        if actual and len(actual) + 1 + len(f) > max_chars:\n            trozos.append(actual)\n            actual = f\n        else:\n            actual = (actual + " " + f).strip()\n    if actual:\n        trozos.append(actual)\n    return trozos\n',
        hints: ['Primero separa en frases con `texto.split(".")`, limpia espacios y vuelve a ponerles el punto.', 'Acumula frases en `actual`; si añadir otra superaría `max_chars`, guarda `actual` y empieza uno nuevo.'],
        explain: 'Cortar por frases mantiene las ideas enteras y evita partir una respuesta por la mitad. Las librerías de RAG ofrecen divisores recursivos (párrafos → frases → palabras) con la misma idea.',
        commands: ['chunking'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el buscador de DojoShop',
    prompt:
      'Construye el buscador semántico de la tienda con una base vectorial.\n\n1. Crea la colección `col` (espacio coseno) con los 24 documentos de `FAQ`, guardando la `categoria` como metadato.\n2. Escribe `buscar(pregunta, n=3, max_dist=0.6)`: devuelve la **lista de ids** más cercanos **cuya distancia sea menor que `max_dist`**; si ninguno cumple, lista vacía.\n3. Evalúa con `PRUEBA`: `hit1` y `hit3` (fracción de preguntas cuyo documento correcto es el primero / está entre los tres primeros).\n4. Con la lista `FUERA` de preguntas ajenas a la tienda, guarda en `rechazadas` cuántas devuelven lista vacía.',
    starter:
      `from dojo_ai.vectordb import Client\nfrom dojo_ai.corpus import FAQ\n\n${PRUEBA}FUERA = ["¿Cuál es la capital de Francia?", "dame una receta de paella", "cuéntame un chiste", "explícame la teoría de la relatividad"]\n\ncol = None\n\ndef buscar(pregunta, n=3, max_dist=0.6):\n    pass\n\nhit1 = hit3 = rechazadas = None\n`,
    check: all(
      truthy('col.count() == 24'),
      truthy('hit1 >= 0.9'),
      truthy('hit3 >= 0.95'),
      variable('rechazadas', '4'),
      calls([['buscar("¿Puedo pagar con PayPal?", 1)', "['pago-metodos']"], ['buscar("dame una receta de paella")', '[]']]),
    ),
    solution:
      `from dojo_ai.vectordb import Client\nfrom dojo_ai.corpus import FAQ\n\n${PRUEBA}FUERA = ["¿Cuál es la capital de Francia?", "dame una receta de paella", "cuéntame un chiste", "explícame la teoría de la relatividad"]\n\ncol = Client().create_collection("faq", metadata={"hnsw:space": "cosine"})\ncol.add(ids=[f[0] for f in FAQ], documents=[f[2] for f in FAQ], metadatas=[{"categoria": f[1]} for f in FAQ])\n\ndef buscar(pregunta, n=3, max_dist=0.6):\n    r = col.query(query_texts=[pregunta], n_results=n)\n    return [i for i, d in zip(r["ids"][0], r["distances"][0]) if d < max_dist]\n\nhit1 = sum(esperado in buscar(q, 1) for q, esperado in PRUEBA) / len(PRUEBA)\nhit3 = sum(esperado in buscar(q, 3) for q, esperado in PRUEBA) / len(PRUEBA)\nrechazadas = sum(buscar(q) == [] for q in FUERA)\n`,
    hints: [
      'Crea la colección con `Client().create_collection("faq", metadata={"hnsw:space": "cosine"})` y añade `ids`, `documents` y `metadatas`.',
      '`col.query(query_texts=[pregunta], n_results=n)` devuelve `ids` y `distances` como listas de listas: filtra por `d < max_dist`.',
      'hit@k: `sum(esperado in buscar(q, k) for q, esperado in PRUEBA) / len(PRUEBA)`; `rechazadas`: cuántas de `FUERA` dan `[]`.',
    ],
    explain:
      'Has montado un buscador semántico completo: indexación en una base vectorial, consulta con distancia, umbral para abstenerse y evaluación con preguntas reales. Es la mitad de un sistema **RAG**; la otra mitad es pasar los fragmentos recuperados a un modelo de lenguaje para que redacte la respuesta, que verás en la zona 13. Antes, la zona 11 explica cómo funcionan por dentro esos modelos de lenguaje.',
    commands: ['base de datos vectorial', 'búsqueda semántica', 'hit@k', 'metadatos y filtros'],
  },
});

void [fill, order];
