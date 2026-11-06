import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, truthy, variable } from './iabuild';

/** 90 clientes de una tienda: gasto mensual (€), visitas al mes, edad y el grupo real (solo para comprobar al final). */
const TIENDA = `gasto,visitas,edad,grupo
167,4,57,premium
87,7,45,fiel
77,12,28,fiel
16,4,50,ocasional
23,1,41,ocasional
106,7,39,fiel
27,2,46,ocasional
19,2,47,ocasional
77,11,29,fiel
38,2,48,ocasional
24,1,58,ocasional
95,8,35,fiel
30,2,44,ocasional
141,5,53,premium
152,3,55,premium
75,9,32,fiel
89,7,33,fiel
177,4,62,premium
182,4,63,premium
18,1,56,ocasional
168,6,48,premium
93,7,29,fiel
29,3,33,ocasional
22,2,42,ocasional
46,2,47,ocasional
189,2,58,premium
29,2,49,ocasional
160,4,61,premium
86,7,28,fiel
102,7,31,fiel
209,5,47,premium
152,5,58,premium
70,9,32,fiel
25,2,49,ocasional
27,2,42,ocasional
12,3,56,ocasional
27,1,44,ocasional
83,6,43,fiel
92,7,33,fiel
143,4,56,premium
25,1,46,ocasional
88,7,30,fiel
32,3,57,ocasional
58,6,34,fiel
28,2,46,ocasional
118,4,52,premium
28,1,39,ocasional
76,9,37,fiel
155,4,38,premium
20,1,58,ocasional
191,4,50,premium
75,9,35,fiel
25,1,48,ocasional
93,6,38,fiel
80,9,33,fiel
43,1,50,ocasional
75,10,38,fiel
35,1,69,ocasional
40,4,45,ocasional
22,3,42,ocasional
80,5,37,fiel
96,7,29,fiel
186,4,56,premium
27,2,47,ocasional
16,2,45,ocasional
201,3,41,premium
39,2,51,ocasional
77,8,44,fiel
156,2,45,premium
140,4,56,premium
150,5,45,premium
221,4,62,premium
66,6,33,fiel
33,1,33,ocasional
183,5,49,premium
84,8,44,fiel
23,3,44,ocasional
53,7,33,fiel
12,1,35,ocasional
63,8,34,fiel
23,2,45,ocasional
87,9,39,fiel
197,3,59,premium
55,7,35,fiel
68,8,28,fiel
103,6,35,fiel
143,4,61,premium
77,8,21,fiel
40,1,54,ocasional
82,9,35,fiel
`;

const FILES = { files: { 'tienda.csv': TIENDA } };

/** Carga habitual: la tabla y las tres variables escaladas (`Xs`). */
const CARGA = `import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

df = pd.read_csv("tienda.csv")
F = ["gasto", "visitas", "edad"]
esc = StandardScaler().fit(df[F])
Xs = esc.transform(df[F])
`;

/** Dos medias lunas entrelazadas (300 puntos). */
const LUNAS = `import numpy as np
from sklearn.datasets import make_moons

Xm, ym = make_moons(300, noise=0.07, random_state=0)
`;

/** El conjunto de vinos (13 variables químicas) estandarizado. */
const VINOS = `import numpy as np
from sklearn.datasets import load_wine
from sklearn.preprocessing import StandardScaler

X, y = load_wine(return_X_y=True)
Xw = StandardScaler().fit_transform(X)
`;

export const ia7 = iaWorld({
  id: 'ia7',
  index: 7,
  title: 'Aprendizaje no supervisado',
  subtitle: 'Agrupar, reducir dimensiones, detectar anomalías y recomendar',
  emoji: '🧩',
  color: '#38BDF8',
  level: 'intermedio',
  intro:
    'Hasta ahora siempre había una respuesta correcta que predecir. En el **aprendizaje no supervisado** no hay etiquetas: el algoritmo busca por sí solo **estructura** en los datos. Aprenderás a **agrupar** (K-means, DBSCAN, jerárquico), a **comprimir** variables con PCA, a **detectar anomalías** y a construir un **recomendador** por similitud, una idea que reaparecerá con los embeddings.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia7-1', { title: 'K-means: agrupar sin etiquetas', summary: 'Segmentar clientes con el algoritmo de los centros', emoji: '🎯', commands: ['KMeans', 'clustering', 'StandardScaler'], minutes: 13 }, [
      learn(
        'Descubrir grupos que nadie te ha dado',
        `
Una tienda tiene el gasto, las visitas y la edad de sus clientes, pero nadie le ha dicho "estos son los *premium*". ¿Hay grupos naturales? Eso es **clustering** (agrupamiento): dividir datos en grupos tales que los miembros de un grupo se parecen entre sí más que a los de otros.

**K-means** es el algoritmo más usado. Tú le dices **cuántos grupos (\`k\`)** quieres y él:

1. Coloca \`k\` **centros** al azar.
2. **Asigna** cada punto al centro más cercano.
3. **Mueve** cada centro a la media de los puntos que tiene asignados.
4. Repite 2 y 3 hasta que los centros dejan de moverse.

Lo que minimiza es la **inercia**: la suma de las distancias² de cada punto a su centro.
`,
        '🎯',
      ),
      illus('ia-kmeans', 'K-means paso a paso', 'Avanza paso a paso: asignar, mover, asignar… Cambia la semilla: algunos inicios acaban en una solución peor.'),
      mc('¿Cuál de estas tareas es de aprendizaje **no supervisado**?', ['Predecir el precio de una casa', 'Decidir si un correo es spam', 'Descubrir tipos de clientes sin saber de antemano cuántos ni cuáles hay', 'Clasificar una foto como perro o gato'], 2, 'No hay etiqueta que predecir: el algoritmo propone los grupos. Las otras tres tienen una respuesta conocida en los datos de entrenamiento.'),
      learn(
        'Escalar es obligatorio',
        `
K-means se basa en **distancias**. Si el gasto va de 5 a 200 € y las visitas de 1 a 12, la distancia casi solo depende del gasto y las visitas "no cuentan". Antes de agrupar hay que **estandarizar** (\`StandardScaler\`).

Después, para entender los grupos, hay que "traducir" los centros al lado original con \`escalador.inverse_transform(km.cluster_centers_)\` y mirar el perfil medio de cada uno.
`,
        '📏',
      ),
      pyDemo(
        'Segmentar la clientela',
        [
          [`${CARGA}from sklearn.cluster import KMeans\n\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\nprint(np.bincount(km.labels_))\nprint(round(km.inertia_, 2), km.n_iter_)`, 'Tres grupos de 34, 33 y 23 clientes. La inercia es 58.5 y el algoritmo convergió en 3 iteraciones'],
          ['import pandas as pd\ncentros = pd.DataFrame(esc.inverse_transform(km.cluster_centers_), columns=F).round(1)\nprint(centros)', 'Los perfiles medios: poco gasto y pocas visitas; gasto medio con muchas visitas y jóvenes; gasto alto con pocas visitas'],
        ],
        FILES,
      ),
      tf('Se puede ejecutar K-means directamente con las variables sin escalar y los resultados serán igual de buenos.', false, 'Sin escalar, la variable con mayor rango domina la distancia y las demás apenas influyen en los grupos.'),
      pyDemo(
        'Asignar clientes nuevos',
        [
          [`${CARGA}from sklearn.cluster import KMeans\n\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\nnuevos = pd.DataFrame({"gasto": [30, 90, 160], "visitas": [2, 9, 4], "edad": [50, 30, 55]})\nprint(km.predict(esc.transform(nuevos)))`, '`predict` asigna cada cliente nuevo al grupo cuyo centro está más cerca (¡con el mismo escalador!)'],
        ],
        FILES,
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\nfrom sklearn.cluster import KMeans\nX = np.array([[0.0], [0.2], [10.0], [10.2]])\nkm = KMeans(2, n_init=10, random_state=0).fit(X)\nprint(sorted(km.cluster_centers_.ravel().round(1).tolist()), round(float(km.inertia_), 2))', ['[0.0, 10.0] 0.0', '[5.1] 100.0', '[0.2, 10.2] 0.08'], 'Cada grupo tiene dos puntos separados 0.2: centros en 0.1 y 10.1. La inercia suma (0.1² + 0.1²) por grupo = 0.04.'),
      pyPractice({
        goal: 'Tres segmentos',
        prompt: 'Entrena `KMeans(n_clusters=3, n_init=10, random_state=0)` con `Xs` y guarda en `tamanos` la **lista ordenada** (de menor a mayor) del número de clientes de cada grupo.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\n${CARGA}\ntamanos = None\n`,
        check: variable('[int(v) for v in tamanos]', '[23, 33, 34]'),
        solution: `from sklearn.cluster import KMeans\n${CARGA}\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\ntamanos = sorted(np.bincount(km.labels_).tolist())`,
        hints: ['`km.labels_` contiene el grupo de cada cliente.', '`np.bincount(km.labels_)` cuenta cuántos hay en cada grupo; ordénalo con `sorted(...)`.'],
        explain: 'Ordenar los tamaños evita depender del **número** que K-means asigna a cada grupo, que es arbitrario (el grupo 0 de una ejecución puede ser el 2 de otra).',
        commands: ['KMeans', 'clustering'],
      }),
      pyPractice({
        goal: '¿A qué grupo pertenece?',
        prompt: 'Ya tienes `km` entrenado. Crea el DataFrame `nuevo` con un cliente (`gasto=165`, `visitas=4`, `edad=55`), escálalo con `esc` y guarda en `grupo` el grupo (un entero) que le asigna `km`. Después en `es_premium` guarda `True` si el centro de ese grupo (en unidades originales) tiene un gasto medio mayor que 150.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\n${CARGA}\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\ngrupo = es_premium = None\n`,
        check: all(truthy('isinstance(int(grupo), int)'), variable('bool(es_premium)', 'True')),
        solution: `from sklearn.cluster import KMeans\n${CARGA}\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\nnuevo = pd.DataFrame({"gasto": [165], "visitas": [4], "edad": [55]})\ngrupo = int(km.predict(esc.transform(nuevo))[0])\ncentros = esc.inverse_transform(km.cluster_centers_)\nes_premium = bool(centros[grupo][0] > 150)`,
        hints: ['`km.predict(esc.transform(nuevo))` devuelve un array con un grupo por cliente.', '`esc.inverse_transform(km.cluster_centers_)` vuelve a las unidades originales; la columna 0 es el gasto.'],
        explain: 'Siempre hay que aplicar a los datos nuevos el **mismo** escalador usado en el entrenamiento. Al volver a unidades originales, el centro de gasto 169 € confirma que es el grupo premium.',
        commands: ['KMeans', 'StandardScaler'],
      }),
      pyPractice({
        goal: 'Perfila los grupos',
        prompt: 'Añade a `df` la columna `segmento` con las etiquetas de `km` y guarda en `perfil` el DataFrame de las **medias** de `gasto`, `visitas` y `edad` por segmento (`groupby`). Guarda en `max_gasto` el gasto medio más alto de los tres segmentos.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\n${CARGA}\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\nperfil = max_gasto = None\n`,
        check: all(variable('perfil.shape', '(3, 3)'), truthy('abs(max_gasto - 168.7) < 0.1')),
        solution: `from sklearn.cluster import KMeans\n${CARGA}\nkm = KMeans(n_clusters=3, n_init=10, random_state=0).fit(Xs)\ndf["segmento"] = km.labels_\nperfil = df.groupby("segmento")[F].mean()\nmax_gasto = perfil["gasto"].max()`,
        hints: ['`df["segmento"] = km.labels_` crea la columna.', '`df.groupby("segmento")[F].mean()` calcula el perfil de cada grupo.'],
        explain: 'Ponerle nombre a los grupos es trabajo humano: los números dicen "ocasionales", "fieles" y "premium" solo cuando miras sus perfiles medios.',
        commands: ['KMeans', 'df.groupby'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia7-2', { title: '¿Cuántos grupos hay?', summary: 'El codo, la silueta y cómo validar un agrupamiento', emoji: '🦵', commands: ['silhouette_score', 'KMeans', 'clustering'], minutes: 12 }, [
      learn(
        'El problema de elegir k',
        `
K-means necesita que le digas \`k\`, pero ¿cuántos grupos hay de verdad? Nadie lo sabe de antemano. Dos herramientas orientan la decisión:

- **Método del codo**: calcula la inercia para \`k = 1, 2, 3…\` Siempre baja al subir \`k\` (con tantos grupos como puntos valdría 0), pero llega un punto —el *codo*— en que añadir grupos apenas reduce nada.
- **Silueta**: para cada punto compara lo cerca que está de **su** grupo (*a*) con lo cerca que está del **grupo vecino más próximo** (*b*): \`s = (b − a) / max(a, b)\`. Va de −1 (mal asignado) a 1 (muy bien). Se promedia sobre todos los puntos y se elige la \`k\` con la mejor silueta media.

Ninguna da "la verdad": son guías. La decisión final también tiene que ser útil para el negocio (¿puedo actuar sobre 7 segmentos?).
`,
        '🦵',
      ),
      illus('ia-elbow', 'Codo y silueta', 'Recorre k de 1 a 7 y mira la inercia (línea violeta) y la silueta (barras verdes).'),
      mc('¿Por qué no basta con elegir la `k` con **menor inercia**?', ['Porque la inercia es siempre 0', 'Porque la inercia siempre baja al aumentar k, llegando a 0 si cada punto es su propio grupo', 'Porque la inercia solo sirve para DBSCAN', 'Porque no se puede calcular'], 1, 'Más grupos siempre ajustan mejor. Por eso se busca el codo (dónde deja de compensar) o se usa un criterio que penalice la sobresegmentación, como la silueta.'),
      pyDemo(
        'Tabla de codo y silueta',
        [
          [`${CARGA}from sklearn.cluster import KMeans\nfrom sklearn.metrics import silhouette_score\n\nfor k in range(1, 7):\n    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Xs)\n    s = round(silhouette_score(Xs, km.labels_), 3) if k > 1 else "-"\n    print(k, round(km.inertia_, 1), s)`, 'La inercia cae a la mitad de 1 a 2 y a un tercio hasta k = 3; después baja despacio (el codo). La silueta máxima también está en k = 3 (0.606)'],
        ],
        FILES,
      ),
      learn(
        'Si hay etiquetas de referencia',
        `
En la práctica no tienes la "solución", pero en este curso sí (el CSV incluye el grupo real para comprobar). Cuando existe, el **índice de Rand ajustado** (\`adjusted_rand_score\`) compara dos agrupaciones por pares de puntos: **1.0** = idénticas (da igual cómo se numeren los grupos), **0** = como el azar.

Otro aviso: K-means supone grupos **redondeados, de tamaño y densidad parecidos**. Con formas alargadas, anillos, lunas o tamaños muy distintos se equivoca; para eso están DBSCAN y el clustering jerárquico (próxima lección).
`,
        '🔎',
      ),
      pyDemo(
        'Comparar con el grupo real',
        [
          [`${CARGA}from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n\nfor k in [2, 3, 4]:\n    p = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(Xs)\n    print(k, round(adjusted_rand_score(df["grupo"], p), 3))`, 'Con k = 3 el agrupamiento coincide al 100 % con los grupos reales; con 2 o 4 se pierde o se divide información'],
        ],
        FILES,
      ),
      tf('Dos agrupamientos que dividen a los clientes exactamente igual pero numeran los grupos al revés tienen un índice de Rand ajustado de 1.', true, 'El índice compara quién va con quién, no las etiquetas numéricas.'),
      multi('¿Qué limitaciones tiene K-means?', ['Hay que indicar k de antemano', 'Funciona mal con grupos alargados o en forma de luna', 'Necesita etiquetas para entrenar', 'Es sensible a la escala de las variables'], [0, 1, 3], 'K-means no usa etiquetas, pero necesita k, variables escaladas y supone grupos más o menos esféricos.'),
      pyPractice({
        goal: 'Dibuja el codo',
        prompt: 'Calcula en la lista `inercias` la inercia (`km.inertia_`, redondeada a 2 decimales) de `KMeans(n_clusters=k, n_init=10, random_state=0)` para `k` de 1 a 8.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\n${CARGA}\ninercias = []\n`,
        check: all(variable('len(inercias)', '8'), variable('[round(float(v), 1) for v in inercias[:4]]', '[270.0, 154.6, 58.5, 48.1]')),
        solution: `from sklearn.cluster import KMeans\n${CARGA}\ninercias = []\nfor k in range(1, 9):\n    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(Xs)\n    inercias.append(round(km.inertia_, 2))`,
        hints: ['Recorre `range(1, 9)` y entrena un `KMeans` en cada vuelta.', '`inercias.append(round(km.inertia_, 2))`.'],
        explain: 'De k = 3 a 4 la inercia solo baja de 58.5 a 48.1 (un 18 %), mientras que de 2 a 3 cayó un 62 %: ese es el codo.',
        commands: ['KMeans', 'clustering'],
      }),
      pyPractice({
        goal: 'Elige k por silueta',
        prompt: 'Calcula la silueta media (`silhouette_score(Xs, etiquetas)`) para `k` de 2 a 6 y guarda en `mejor_k` la `k` con mayor valor y en `mejor_silueta` ese valor.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import silhouette_score\n${CARGA}\nmejor_k = mejor_silueta = None\n`,
        check: all(variable('int(mejor_k)', '3'), truthy('abs(mejor_silueta - 0.6057) < 0.001')),
        solution: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import silhouette_score\n${CARGA}\nsil = {}\nfor k in range(2, 7):\n    etiquetas = KMeans(n_clusters=k, n_init=10, random_state=0).fit_predict(Xs)\n    sil[k] = silhouette_score(Xs, etiquetas)\nmejor_k = max(sil, key=sil.get)\nmejor_silueta = sil[mejor_k]`,
        hints: ['`KMeans(...).fit_predict(Xs)` devuelve las etiquetas directamente.', 'Guarda las siluetas en un diccionario `{k: silueta}` y usa `max(sil, key=sil.get)`.'],
        explain: 'Una silueta de 0.61 se considera una estructura clara (por encima de 0.5 hay grupos razonables; por debajo de 0.25 prácticamente no hay estructura).',
        commands: ['silhouette_score'],
      }),
      pyPractice({
        goal: 'Compara con la verdad',
        prompt: 'Entrena K-means con `k = 3` (`n_init=10`, `random_state=0`) y guarda en `ari` el índice de Rand ajustado entre `df["grupo"]` y sus etiquetas.',
        setup: FILES,
        starter: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n${CARGA}\nari = None\n`,
        check: truthy('abs(ari - 1.0) < 1e-9'),
        solution: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n${CARGA}\netiquetas = KMeans(n_clusters=3, n_init=10, random_state=0).fit_predict(Xs)\nari = adjusted_rand_score(df["grupo"], etiquetas)`,
        hints: ['`adjusted_rand_score(verdad, prediccion)` acepta etiquetas de cualquier tipo (texto o números).', 'Las etiquetas de K-means salen de `fit_predict`.'],
        explain: 'ARI = 1: K-means ha recuperado exactamente los tres tipos de cliente sin conocerlos. Con datos reales y menos separados no pasará: lo normal son valores intermedios.',
        commands: ['clustering', 'KMeans'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia7-3', { title: 'DBSCAN y clustering jerárquico', summary: 'Agrupar por densidad, detectar ruido y formas libres', emoji: '🌙', commands: ['DBSCAN', 'AgglomerativeClustering', 'KMeans', 'clustering'], minutes: 13 }, [
      learn(
        'Cuando los grupos no son bolas',
        `
K-means imagina que cada grupo es una **bola**. Pero hay grupos con forma de media luna, de anillo o de cadena. **DBSCAN** (*Density-Based Spatial Clustering of Applications with Noise*) usa otra idea: un grupo es una **zona densa** rodeada de zonas vacías.

Dos parámetros:

- **\`eps\` (ε)**: el radio de la "vecindad" de un punto.
- **\`min_samples\`**: cuántos puntos (él incluido) hacen falta en esa vecindad para considerarlo **punto núcleo**.

Los núcleos conectados forman un grupo; los puntos que están en la vecindad de un núcleo se añaden como *frontera*; y los que no son ni lo uno ni lo otro se declaran **ruido** (etiqueta \`-1\`). Ventajas: no hay que decir cuántos grupos, capta formas arbitrarias y detecta valores atípicos.
`,
        '🌙',
      ),
      illus('ia-dbscan', 'El radio ε', 'Cambia ε y min_samples hasta separar las dos lunas y dejar los puntos sueltos como ruido.'),
      mc('En DBSCAN, un punto con la etiqueta `-1` es…', ['El primer grupo', 'Ruido: no pertenece a ningún grupo', 'El centro de un grupo', 'Un error del algoritmo'], 1, '`-1` marca los puntos que no cumplen las condiciones de densidad: DBSCAN los considera atípicos.'),
      pyDemo(
        'K-means contra DBSCAN en dos lunas',
        [
          [`${LUNAS}from sklearn.cluster import DBSCAN, KMeans\nfrom sklearn.metrics import adjusted_rand_score\n\nkm = KMeans(2, n_init=10, random_state=0).fit_predict(Xm)\ndb = DBSCAN(eps=0.2, min_samples=5).fit_predict(Xm)\nprint(round(adjusted_rand_score(ym, km), 2), round(adjusted_rand_score(ym, db), 2))`, 'K-means corta las lunas con una recta y acierta poco (ARI 0.23); DBSCAN las separa perfectamente (ARI 1.0)'],
          ['for eps in [0.05, 0.1, 0.2, 0.5]:\n    et = DBSCAN(eps=eps, min_samples=5).fit_predict(Xm)\n    print(eps, len(set(et) - {-1}), int((et == -1).sum()))', 'ε demasiado pequeño: muchísimos grupos y ruido; demasiado grande: todo en un solo grupo. Hay que ajustarlo'],
        ],
      ),
      learn(
        'Jerárquico: un árbol de fusiones',
        `
El **clustering jerárquico aglomerativo** empieza con cada punto como un grupo y, en cada paso, **fusiona los dos grupos más cercanos**, hasta quedarse con \`n_clusters\`. El historial de fusiones forma un árbol (**dendrograma**) del que puedes "cortar" el número de grupos que quieras.

¿Cómo se mide la distancia entre grupos? Es el **enlace** (\`linkage\`):

- \`ward\`: minimiza el aumento de varianza al fusionar; grupos compactos (parecido a K-means). Es el valor por defecto.
- \`average\`, \`complete\`: distancia media / máxima entre puntos de ambos grupos.
- \`single\`: distancia entre los dos puntos más cercanos; sigue cadenas y capta formas alargadas, pero es sensible al ruido.
`,
        '🌳',
      ),
      pyDemo(
        'Dos enlaces, dos resultados',
        [
          [`${LUNAS}from sklearn.cluster import AgglomerativeClustering\nfrom sklearn.metrics import adjusted_rand_score\n\nfor enlace in ["ward", "single"]:\n    et = AgglomerativeClustering(n_clusters=2, linkage=enlace).fit_predict(Xm)\n    print(enlace, round(adjusted_rand_score(ym, et), 2))`, '`ward` busca grupos compactos y falla con las lunas (0.40); `single` sigue la cadena de puntos cercanos y las separa bien (1.0)'],
        ],
      ),
      tf('DBSCAN necesita que le indiques cuántos grupos buscar, igual que K-means.', false, 'DBSCAN no lo necesita: el número de grupos sale de los parámetros `eps` y `min_samples` y de la densidad de los datos.'),
      match('Une cada algoritmo con su rasgo principal:', [['K-means', 'Grupos redondos; hay que fijar k'], ['DBSCAN', 'Zonas densas de forma libre; detecta ruido'], ['Aglomerativo ward', 'Fusiona grupos manteniéndolos compactos'], ['Aglomerativo single', 'Sigue cadenas de puntos cercanos']], 'Elegir el algoritmo depende de la forma esperada de los grupos y de si hay ruido.'),
      pyPractice({
        goal: 'Encuentra las lunas con DBSCAN',
        prompt: 'Aplica `DBSCAN(eps=0.2, min_samples=5)` a `Xm` y guarda en `n_grupos` cuántos grupos encuentra (sin contar el ruido), en `n_ruido` cuántos puntos son ruido y en `ari` el índice de Rand ajustado con `ym`.',
        starter: `from sklearn.cluster import DBSCAN\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\nn_grupos = n_ruido = ari = None\n`,
        check: all(variable('int(n_grupos)', '2'), variable('int(n_ruido)', '0'), truthy('abs(ari - 1.0) < 1e-9')),
        solution: `from sklearn.cluster import DBSCAN\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\net = DBSCAN(eps=0.2, min_samples=5).fit_predict(Xm)\nn_grupos = len(set(et) - {-1})\nn_ruido = int((et == -1).sum())\nari = adjusted_rand_score(ym, et)`,
        hints: ['`et = DBSCAN(...).fit_predict(Xm)` devuelve las etiquetas, con `-1` para el ruido.', '`set(et) - {-1}` son las etiquetas de grupo; `(et == -1).sum()` cuenta el ruido.'],
        explain: 'Dos grupos, cero ruido y acuerdo total con la realidad. Cambia `eps` a 0.05 y verás cómo se desmorona el agrupamiento.',
        commands: ['DBSCAN'],
      }),
      pyPractice({
        goal: 'Falla K-means',
        prompt: 'Aplica `KMeans(2, n_init=10, random_state=0)` a `Xm` y guarda en `ari_km` el índice de Rand ajustado con `ym`. Debe ser bajo: la media luna no es una bola.',
        starter: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\nari_km = None\n`,
        check: truthy('abs(ari_km - 0.2343) < 0.01'),
        solution: `from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\net = KMeans(2, n_init=10, random_state=0).fit_predict(Xm)\nari_km = adjusted_rand_score(ym, et)`,
        hints: ['`KMeans(2, n_init=10, random_state=0).fit_predict(Xm)`.', '`adjusted_rand_score(ym, et)`.'],
        explain: 'ARI 0.23: apenas mejor que el azar. K-means parte el plano con una frontera recta, que atraviesa las dos lunas.',
        commands: ['KMeans', 'clustering'],
      }),
      pyPractice({
        goal: 'Enlace single',
        prompt: 'Con `AgglomerativeClustering(n_clusters=2, linkage="single")` sobre `Xm`, guarda en `ari_single` el índice de Rand ajustado con `ym`.',
        starter: `from sklearn.cluster import AgglomerativeClustering\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\nari_single = None\n`,
        check: truthy('abs(ari_single - 1.0) < 1e-9'),
        solution: `from sklearn.cluster import AgglomerativeClustering\nfrom sklearn.metrics import adjusted_rand_score\n${LUNAS}\net = AgglomerativeClustering(n_clusters=2, linkage="single").fit_predict(Xm)\nari_single = adjusted_rand_score(ym, et)`,
        hints: ['Pasa `linkage="single"` al constructor.', 'Compara con `ym` usando `adjusted_rand_score`.'],
        explain: 'El enlace simple sigue la cadena de puntos vecinos y acierta con las lunas. Pero con datos ruidosos, una "carretera" de puntos intermedios fundiría los grupos: ningún algoritmo vale para todo.',
        commands: ['AgglomerativeClustering'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia7-4', { title: 'PCA: reducir dimensiones', summary: 'Resumir muchas variables en pocas componentes con la mínima pérdida', emoji: '🗜️', commands: ['PCA', 'StandardScaler', 'KMeans'], minutes: 14 }, [
      learn(
        'Demasiadas columnas',
        `
Los datos reales tienen decenas o miles de columnas (un análisis químico del vino mide 13 variables; una foto, miles de píxeles) y muchas son **redundantes**: están correlacionadas. Eso complica visualizarlos, ralentiza los modelos y empeora algunos (KNN, K-means: la "maldición de la dimensionalidad").

**PCA** (*análisis de componentes principales*) construye **nuevas variables**, las **componentes**, que son combinaciones de las originales y cumplen:

- Son **ortogonales** (independientes entre sí).
- La primera recoge la **mayor varianza** posible; la segunda, la mayor de la que queda; y así sucesivamente.

Conservando solo las primeras \`k\` componentes se resumen los datos perdiendo poca información. Es **no supervisado** (no usa etiquetas) y **exige escalar** las variables, porque se guía por la varianza.
`,
        '🗜️',
      ),
      illus('ia-pca', 'El mejor eje', 'Gira el eje de proyección y mira cuánta varianza conserva. «Mejor eje» marca el primer componente.'),
      mc('¿Qué representa la **primera componente principal**?', ['La variable original más importante', 'La dirección en la que los datos varían más', 'El grupo más grande', 'El promedio de todas las variables'], 1, 'Es la combinación lineal de variables a lo largo de la cual los datos tienen mayor varianza (más información).'),
      pyDemo(
        'De 13 variables a 2',
        [
          [`${VINOS}from sklearn.decomposition import PCA\n\npca = PCA(n_components=2).fit(Xw)\nZ = pca.transform(Xw)\nprint(Xw.shape, "→", Z.shape)\nprint(pca.explained_variance_ratio_.round(3).tolist(), round(float(pca.explained_variance_ratio_.sum()), 3))`, '178 vinos × 13 variables pasan a 2 columnas que conservan el 55 % de la varianza (36 % la primera, 19 % la segunda)'],
          ['from sklearn.datasets import load_wine\nnombres = load_wine().feature_names\norden = np.abs(pca.components_[0]).argsort()[::-1][:3]\nprint([nombres[i] for i in orden])', 'La primera componente da más peso a los flavonoides, los fenoles totales y la dilución OD280: un "eje de polifenoles"'],
        ],
      ),
      learn(
        '¿Cuántas componentes conservar?',
        `
\`pca.explained_variance_ratio_\` dice qué fracción de la varianza explica cada componente. Su **suma acumulada** (\`.cumsum()\`) indica cuánta información conservas al quedarte con las \`k\` primeras. Reglas habituales:

- Quedarse con las que acumulan el **90–95 %** (puedes pasar \`PCA(n_components=0.95)\` y scikit-learn elige el número).
- Buscar el **codo** en el gráfico de varianza explicada.
- Si es para **visualizar**, 2 o 3 componentes.

Y un aviso: las componentes son combinaciones de todas las variables, así que son **menos interpretables** que las columnas originales.
`,
        '📐',
      ),
      pyDemo(
        'Varianza acumulada',
        [
          [`${VINOS}from sklearn.decomposition import PCA\n\npca = PCA().fit(Xw)\nacum = np.cumsum(pca.explained_variance_ratio_)\nprint(acum[:8].round(3).tolist())\nprint(int(np.searchsorted(acum, 0.90)) + 1, int(np.searchsorted(acum, 0.95)) + 1)`, 'Hacen falta 8 componentes para conservar el 90 % y 10 para el 95 %: los vinos no son tan redundantes como parecía'],
          ['from sklearn.cluster import KMeans\nfrom sklearn.metrics import adjusted_rand_score\n\nZ2 = PCA(2).fit_transform(Xw)\nfor nombre, datos in [("13 variables", Xw), ("2 componentes", Z2)]:\n    et = KMeans(3, n_init=10, random_state=0).fit_predict(datos)\n    print(nombre, round(adjusted_rand_score(y, et), 3))', 'Agrupar con solo 2 componentes da casi el mismo resultado que con las 13 variables (0.895 frente a 0.897): ¡y se puede dibujar!'],
        ],
      ),
      tf('PCA necesita las etiquetas de los datos para encontrar las componentes.', false, 'PCA es no supervisado: solo usa la varianza de las variables, sin saber nada de las clases.'),
      multi('¿Para qué se usa PCA?', ['Visualizar datos de muchas dimensiones en 2D', 'Eliminar redundancia entre variables correlacionadas', 'Predecir una variable objetivo directamente', 'Comprimir datos perdiendo poca información'], [0, 1, 3], 'PCA transforma y resume variables; no predice por sí mismo (aunque sus componentes pueden alimentar un modelo).'),
      pyPractice({
        goal: 'Varianza de dos componentes',
        prompt: 'Ajusta un `PCA(n_components=2)` a `Xw` y guarda en `ratio2` la fracción de varianza que conservan **entre las dos** juntas (suma de `explained_variance_ratio_`).',
        starter: `from sklearn.decomposition import PCA\n${VINOS}\nratio2 = None\n`,
        check: truthy('abs(ratio2 - 0.5541) < 0.001'),
        solution: `from sklearn.decomposition import PCA\n${VINOS}\npca = PCA(n_components=2).fit(Xw)\nratio2 = pca.explained_variance_ratio_.sum()`,
        hints: ['`PCA(n_components=2).fit(Xw)`.', '`pca.explained_variance_ratio_.sum()`.'],
        explain: 'Dos componentes resumen el 55 % de la información de 13 variables. Para dibujar es bastante; para modelar probablemente quieras más.',
        commands: ['PCA'],
      }),
      pyPractice({
        goal: 'Cuántas componentes necesito',
        prompt: 'Ajusta un `PCA()` completo y guarda en `n90` el número mínimo de componentes cuya varianza acumulada llega al 90 % (usa `np.cumsum` y `np.searchsorted`, o `np.argmax(acum >= 0.9) + 1`).',
        starter: `from sklearn.decomposition import PCA\n${VINOS}\nn90 = None\n`,
        check: variable('int(n90)', '8'),
        solution: `from sklearn.decomposition import PCA\n${VINOS}\npca = PCA().fit(Xw)\nacum = np.cumsum(pca.explained_variance_ratio_)\nn90 = int(np.argmax(acum >= 0.9)) + 1`,
        hints: ['`acum = np.cumsum(pca.explained_variance_ratio_)`.', '`np.argmax(acum >= 0.9)` devuelve la primera posición que cumple (empieza en 0, suma 1).'],
        explain: 'Con `PCA(n_components=0.9)` scikit-learn hace este cálculo por ti y deja exactamente esas 8 componentes.',
        commands: ['PCA'],
      }),
      pyPractice({
        goal: 'Agrupa en el espacio reducido',
        prompt: 'Reduce `Xw` a 2 componentes (`Z`) y agrupa con `KMeans(3, n_init=10, random_state=0)`. Guarda en `ari` el índice de Rand ajustado entre `y` y las etiquetas.',
        starter: `from sklearn.cluster import KMeans\nfrom sklearn.decomposition import PCA\nfrom sklearn.metrics import adjusted_rand_score\n${VINOS}\nari = None\n`,
        check: truthy('abs(ari - 0.895) < 0.005'),
        solution: `from sklearn.cluster import KMeans\nfrom sklearn.decomposition import PCA\nfrom sklearn.metrics import adjusted_rand_score\n${VINOS}\nZ = PCA(n_components=2).fit_transform(Xw)\netiquetas = KMeans(3, n_init=10, random_state=0).fit_predict(Z)\nari = adjusted_rand_score(y, etiquetas)`,
        hints: ['`PCA(n_components=2).fit_transform(Xw)` ajusta y proyecta de una vez.', 'Después `KMeans(...).fit_predict(Z)`.'],
        explain: 'Con solo 2 de 13 dimensiones se recupera el tipo de vino casi igual de bien. Reducir dimensiones ayuda a los algoritmos basados en distancias y permite dibujar.',
        commands: ['PCA', 'KMeans'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia7-5', { title: 'Anomalías y recomendaciones', summary: 'Detectar lo raro y sugerir lo parecido', emoji: '🔭', commands: ['detección de anomalías', 'filtrado colaborativo', 'similitud coseno', 'np.percentile'], minutes: 14 }, [
      learn(
        'Encontrar lo raro',
        `
Un pago de 250 € entre pagos de 15 €, un sensor que marca −40 °C en verano, una edad de 200 años. Las **anomalías** (atípicos, *outliers*) son observaciones que no encajan con el resto. Pueden ser **errores** que limpiar o **eventos valiosos** (un fraude, un fallo de máquina) que detectar.

Métodos sencillos sin etiquetas:

- **z-score**: cuántas desviaciones típicas se aleja un valor de la media: \`z = (x − media) / std\`. Se suele marcar \`|z| > 3\`.
- **Regla del IQR**: con los cuartiles \`Q1\` y \`Q3\` (\`IQR = Q3 − Q1\`), es atípico lo que queda fuera de \`[Q1 − 1.5·IQR, Q3 + 1.5·IQR]\`. Usa percentiles, así que **no se deja engañar** por los propios atípicos.
- **Distancia al centro de su grupo** (tras un clustering): lo muy lejos de su centroide es raro.

Más sofisticados: *Isolation Forest*, *LOF*, autoencoders.
`,
        '🔭',
      ),
      pyDemo(
        'z-score contra IQR',
        [
          ['import numpy as np\n\nimportes = np.array([12, 15, 14, 13, 16, 15, 14, 250, 13, 15, 17, 14, 12, 16, 15, -40, 14, 13], dtype=float)\nz = (importes - importes.mean()) / importes.std()\nprint(round(float(importes.mean()), 1), round(float(importes.std()), 1))\nprint(round(float(z[7]), 2), round(float(z[15]), 2))', 'El 250 tiene z = 4.0 (se detecta) pero el −40 tiene solo z = −1.15: el propio 250 ha inflado la media y la desviación y "enmascara" al otro atípico'],
          ['q1, q3 = np.percentile(importes, [25, 75])\niqr = q3 - q1\nlimites = (q1 - 1.5 * iqr, q3 + 1.5 * iqr)\nfuera = (importes < limites[0]) | (importes > limites[1])\nprint(limites, importes[fuera].tolist())', 'La regla del IQR usa cuartiles y no se deja engañar: marca los dos valores (250 y −40)'],
        ],
      ),
      mc('Un valor se aleja mucho del resto, pero los cuartiles de los datos apenas cambian por su culpa. ¿Qué regla lo detecta mejor?', ['El z-score con la media y la desviación', 'La regla del IQR', 'Ninguna: no se puede detectar', 'Elevar todo al cuadrado'], 1, 'La regla del IQR se basa en percentiles, que casi no se mueven por unos pocos extremos; la media y la desviación sí se dejan arrastrar.'),
      tf('El z-score con la media y la desviación típica detecta siempre todos los atípicos, por muchos que haya.', false, 'Los atípicos distorsionan la media y la desviación y se enmascaran entre sí. Los métodos robustos (mediana, IQR, MAD) resisten mejor.'),
      pyDemo(
        'Lejos de su grupo',
        [
          [`${CARGA}from sklearn.cluster import KMeans\n\nkm = KMeans(3, n_init=10, random_state=0).fit(Xs)\nd = np.linalg.norm(Xs - km.cluster_centers_[km.labels_], axis=1)\nprint(round(float(d.mean()), 2), round(float(d.max()), 2))\nprint(int((d > 2).sum()), int(d.argmax()))\nprint(df.iloc[int(d.argmax())].tolist())`, 'Distancia media al centro 0.71; un cliente (la fila 57) está a 2.15, más del triple. Es un cliente atípico dentro de su segmento'],
        ],
        FILES,
      ),
      learn(
        'Recomendar por parecido',
        `
**Filtrado colaborativo**: "a quienes se parecen a ti les gustó esto". Con una matriz de valoraciones (usuarios × películas):

1. Mide cuánto **se parece** cada usuario a ti con la **similitud coseno** de sus filas (vectores de valoraciones): \`cos = (a·b) / (|a|·|b|)\`.
2. Para cada película que **no has visto**, calcula una **media de las valoraciones de los demás ponderada por su parecido contigo**.
3. Recomienda las de mayor puntuación.

Es el mismo principio que veremos con los **embeddings**: representar cosas (usuarios, películas, palabras) como vectores y comparar con el coseno. Pruébalo en la ilustración.
`,
        '🍿',
      ),
      illus('ia-recommender', 'Un recomendador por parecido', 'Cambia tus valoraciones y mira cómo cambian los parecidos y las recomendaciones.'),
      pyDemo(
        'El recomendador en NumPy',
        [
          ['import numpy as np\n\nR = np.array([[5, 1, 5, 0, 1, 4], [4, 2, 5, 1, 0, 5], [1, 5, 0, 5, 4, 1], [0, 5, 1, 4, 5, 2], [5, 0, 4, 2, 1, 5]], dtype=float)\npelis = ["Matrix", "Titanic", "Alien", "Up", "Amélie", "Gladiator"]\nmia = np.array([5, 0, 5, 0, 0, 0], dtype=float)\n\nsim = R @ mia / (np.linalg.norm(R, axis=1) * np.linalg.norm(mia))\nprint(sim.round(2).tolist())', 'Eres muy parecido a los usuarios 0, 1 y 4 (aman Matrix y Alien) y casi nada a los 2 y 3'],
          ['for f in np.where(mia == 0)[0]:\n    vieron = R[:, f] > 0\n    pred = (sim[vieron] * R[vieron, f]).sum() / sim[vieron].sum()\n    print(pelis[f], round(float(pred), 2))', 'Gladiator sale con 4.43 ★: la valoran alto justo quienes se parecen a ti'],
        ],
      ),
      match('Une cada técnica con lo que hace:', [['z-score', 'Mide a cuántas desviaciones típicas está un valor de la media'], ['Regla del IQR', 'Marca lo que sale de [Q1 − 1.5·IQR, Q3 + 1.5·IQR]'], ['Similitud coseno', 'Compara la dirección de dos vectores, sin importar su tamaño'], ['Filtrado colaborativo', 'Recomienda según lo que gustó a usuarios parecidos']], 'Las cuatro son herramientas ligeras y muy usadas antes de recurrir a modelos complejos.'),
      pyPractice({
        goal: 'Atípicos con el z-score',
        prompt: 'Calcula el `z` de cada importe (media y `std()` de NumPy) y guarda en `n_z` cuántos tienen `|z| > 3` y en `z_menos40` el z-score del valor `-40`.',
        starter: 'import numpy as np\n\nimportes = np.array([12, 15, 14, 13, 16, 15, 14, 250, 13, 15, 17, 14, 12, 16, 15, -40, 14, 13], dtype=float)\nn_z = z_menos40 = None\n',
        check: all(variable('int(n_z)', '1'), truthy('abs(z_menos40 + 1.15) < 0.01')),
        solution: 'import numpy as np\n\nimportes = np.array([12, 15, 14, 13, 16, 15, 14, 250, 13, 15, 17, 14, 12, 16, 15, -40, 14, 13], dtype=float)\nz = (importes - importes.mean()) / importes.std()\nn_z = (np.abs(z) > 3).sum()\nz_menos40 = z[15]',
        hints: ['`z = (importes - importes.mean()) / importes.std()`.', '`(np.abs(z) > 3).sum()` cuenta los que superan el umbral; el −40 está en la posición 15.'],
        explain: 'El z-score solo detecta uno de los dos atípicos: el 250 ha inflado la desviación y el −40 se queda en z = −1.15. Es el efecto de enmascaramiento.',
        commands: ['detección de anomalías'],
      }),
      pyPractice({
        goal: 'Atípicos con la regla del IQR',
        prompt: 'Calcula `q1` y `q3` con `np.percentile`, los límites de la regla del IQR (1.5·IQR) y guarda en `atipicos` la **lista** de valores fuera de ellos (en el orden original).',
        starter: 'import numpy as np\n\nimportes = np.array([12, 15, 14, 13, 16, 15, 14, 250, 13, 15, 17, 14, 12, 16, 15, -40, 14, 13], dtype=float)\natipicos = None\n',
        check: variable('atipicos', '[250.0, -40.0]'),
        solution: 'import numpy as np\n\nimportes = np.array([12, 15, 14, 13, 16, 15, 14, 250, 13, 15, 17, 14, 12, 16, 15, -40, 14, 13], dtype=float)\nq1, q3 = np.percentile(importes, [25, 75])\niqr = q3 - q1\nfuera = (importes < q1 - 1.5 * iqr) | (importes > q3 + 1.5 * iqr)\natipicos = importes[fuera].tolist()',
        hints: ['`q1, q3 = np.percentile(importes, [25, 75])` y `iqr = q3 - q1`.', 'Combina dos máscaras con `|` y úsala para indexar; `.tolist()` convierte a lista.'],
        explain: 'Los cuartiles apenas se mueven por un par de valores extremos, así que el IQR detecta los dos. Es la razón por la que los diagramas de caja (*boxplots*) usan esta regla.',
        commands: ['np.percentile', 'detección de anomalías'],
      }),
      pyPractice({
        goal: 'Recomienda una película',
        prompt: 'Con la matriz `R` y tus valoraciones `mia`, calcula las similitudes coseno `sim` con cada usuario. Guarda en `mejor_peli` el **nombre** de la película no vista con mayor puntuación predicha (media de valoraciones ponderada por `sim`, solo entre quienes la vieron).',
        starter: 'import numpy as np\n\nR = np.array([[5, 1, 5, 0, 1, 4], [4, 2, 5, 1, 0, 5], [1, 5, 0, 5, 4, 1], [0, 5, 1, 4, 5, 2], [5, 0, 4, 2, 1, 5]], dtype=float)\npelis = ["Matrix", "Titanic", "Alien", "Up", "Amélie", "Gladiator"]\nmia = np.array([5, 0, 5, 0, 0, 0], dtype=float)\n\nsim = None\nmejor_peli = None\n',
        check: all(truthy('abs(sim[0] - 0.8575) < 0.001'), variable('mejor_peli', "'Gladiator'")),
        solution: 'import numpy as np\n\nR = np.array([[5, 1, 5, 0, 1, 4], [4, 2, 5, 1, 0, 5], [1, 5, 0, 5, 4, 1], [0, 5, 1, 4, 5, 2], [5, 0, 4, 2, 1, 5]], dtype=float)\npelis = ["Matrix", "Titanic", "Alien", "Up", "Amélie", "Gladiator"]\nmia = np.array([5, 0, 5, 0, 0, 0], dtype=float)\n\nsim = R @ mia / (np.linalg.norm(R, axis=1) * np.linalg.norm(mia))\npuntos = {}\nfor f in np.where(mia == 0)[0]:\n    vieron = R[:, f] > 0\n    puntos[pelis[f]] = (sim[vieron] * R[vieron, f]).sum() / sim[vieron].sum()\nmejor_peli = max(puntos, key=puntos.get)',
        hints: ['`sim = R @ mia / (np.linalg.norm(R, axis=1) * np.linalg.norm(mia))` calcula los cosenos de todos a la vez.', 'Para cada película no vista, usa solo los usuarios con `R[:, f] > 0`.'],
        explain: 'Sin ningún modelo entrenado, solo con vectores y el coseno, ya tienes un recomendador. Los sistemas reales usan la misma idea con embeddings aprendidos de millones de usuarios.',
        commands: ['filtrado colaborativo', 'similitud coseno'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: segmentar y vigilar la clientela',
    prompt:
      'Prepara un análisis completo con `tienda.csv` (ya tienes `Xs`, las variables escaladas, y `F`).\n\n1. Calcula la silueta media para `k` de 2 a 6 (`KMeans(k, n_init=10, random_state=0)`) y guarda en `mejor_k` la mejor.\n2. Entrena K-means con esa `k` (`km`) y guarda en `tamanos` la lista ordenada de tamaños de grupo y en `ari` el índice de Rand ajustado con `df["grupo"]`.\n3. Reduce `Xs` a 2 componentes con PCA y guarda en `var2` la varianza total que conservan.\n4. Calcula la distancia de cada cliente al centro de su grupo y guarda en `n_atipicos` cuántos superan **2** y en `fila_atipica` la posición del más lejano.',
    setup: FILES,
    starter:
      'import numpy as np\nimport pandas as pd\nfrom sklearn.cluster import KMeans\nfrom sklearn.decomposition import PCA\nfrom sklearn.metrics import adjusted_rand_score, silhouette_score\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("tienda.csv")\nF = ["gasto", "visitas", "edad"]\nXs = StandardScaler().fit_transform(df[F])\n\n# 1: elegir k por silueta\nmejor_k = None\n\n# 2: segmentación\nkm = None\ntamanos = ari = None\n\n# 3: PCA\nvar2 = None\n\n# 4: anomalías por distancia al centro\nn_atipicos = fila_atipica = None\n',
    check: all(variable('int(mejor_k)', '3'), variable('[int(v) for v in tamanos]', '[23, 33, 34]'), truthy('abs(ari - 1.0) < 1e-9'), truthy('abs(var2 - 0.9211) < 0.001'), variable('int(n_atipicos)', '1'), variable('int(fila_atipica)', '57')),
    solution:
      'import numpy as np\nimport pandas as pd\nfrom sklearn.cluster import KMeans\nfrom sklearn.decomposition import PCA\nfrom sklearn.metrics import adjusted_rand_score, silhouette_score\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("tienda.csv")\nF = ["gasto", "visitas", "edad"]\nXs = StandardScaler().fit_transform(df[F])\n\nsil = {}\nfor k in range(2, 7):\n    sil[k] = silhouette_score(Xs, KMeans(k, n_init=10, random_state=0).fit_predict(Xs))\nmejor_k = max(sil, key=sil.get)\n\nkm = KMeans(mejor_k, n_init=10, random_state=0).fit(Xs)\ntamanos = sorted(np.bincount(km.labels_).tolist())\nari = adjusted_rand_score(df["grupo"], km.labels_)\n\nvar2 = PCA(n_components=2).fit(Xs).explained_variance_ratio_.sum()\n\nd = np.linalg.norm(Xs - km.cluster_centers_[km.labels_], axis=1)\nn_atipicos = (d > 2).sum()\nfila_atipica = d.argmax()',
    hints: ['Guarda las siluetas en un diccionario y elige con `max(sil, key=sil.get)`.', '`km.cluster_centers_[km.labels_]` da, para cada cliente, el centro de su grupo; `np.linalg.norm(..., axis=1)` mide la distancia.', '`PCA(n_components=2).fit(Xs).explained_variance_ratio_.sum()`.'],
    explain: 'Has hecho un análisis no supervisado completo: elegiste k con un criterio objetivo, recuperaste los tres tipos de clientes (ARI 1.0), comprobaste que dos componentes resumen el 92 % de la información (se pueden dibujar en 2D sin perder casi nada) y localizaste al cliente más raro de su segmento para revisarlo.',
    commands: ['KMeans', 'silhouette_score', 'PCA', 'detección de anomalías'],
  },
});

void [fill, order, mc];
