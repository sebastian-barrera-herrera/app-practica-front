import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, truthy, variable } from './iabuild';

/** 80 clientes de una operadora: meses de antigüedad, llamadas a soporte, cuota mensual, tipo de contrato y si se dieron de baja (1). */
export const BAJAS = `meses,soporte,cuota,contrato,baja
13,1,40,mensual,0
23,1,60,mensual,1
72,2,58,mensual,0
29,1,73,mensual,0
11,2,100,mensual,1
62,5,62,anual,1
27,3,99,mensual,1
26,0,87,mensual,0
33,3,48,mensual,1
5,0,64,anual,0
11,2,93,anual,1
11,1,49,mensual,1
1,0,38,mensual,0
6,4,97,mensual,1
38,3,40,mensual,1
42,2,93,anual,0
68,2,26,mensual,0
69,1,34,anual,0
46,2,79,anual,0
18,3,97,mensual,1
1,3,43,mensual,0
32,5,53,mensual,1
10,2,59,anual,0
60,1,59,anual,0
28,3,71,mensual,1
44,1,99,anual,0
2,5,73,anual,1
72,5,96,mensual,1
64,1,65,mensual,0
11,1,25,mensual,0
46,4,60,mensual,1
31,2,77,mensual,0
20,2,64,anual,1
66,5,59,anual,0
58,3,26,mensual,0
14,2,73,mensual,1
57,1,52,mensual,0
42,1,79,mensual,0
22,1,96,anual,0
14,0,73,anual,0
68,1,54,mensual,0
62,1,78,mensual,0
58,2,43,mensual,0
61,1,72,mensual,1
10,3,99,mensual,1
5,2,66,mensual,1
51,1,70,mensual,0
17,0,62,mensual,0
53,0,57,anual,0
2,2,100,mensual,1
12,1,34,anual,1
4,3,30,anual,0
13,3,77,mensual,1
29,1,90,mensual,1
18,1,55,mensual,1
49,1,84,mensual,0
36,1,78,anual,0
33,0,83,anual,0
11,3,92,mensual,1
53,6,77,anual,1
63,6,55,mensual,1
53,5,98,mensual,1
68,3,37,mensual,0
57,2,60,mensual,0
49,1,57,anual,0
53,3,30,anual,0
57,2,99,mensual,0
13,2,25,anual,0
51,4,85,anual,0
60,0,85,anual,0
56,3,29,mensual,1
34,0,50,anual,0
64,2,38,anual,0
5,2,93,mensual,0
57,4,73,mensual,1
27,4,37,anual,0
50,2,57,anual,0
29,3,91,mensual,1
39,6,100,anual,1
9,2,50,mensual,1
`;

const FILES = { files: { 'bajas.csv': BAJAS } };

/** Carga habitual: la tabla con el contrato en columnas 0/1, `X` y `y`. */
const CARGA = `import numpy as np
import pandas as pd

df = pd.read_csv("bajas.csv")
D = pd.get_dummies(df, columns=["contrato"], dtype=int)
X = D.drop(columns="baja")
y = D["baja"]
`;

/** Lo mismo más la división en entrenamiento y prueba (25 %, estratificada). */
const DIV = `${CARGA}from sklearn.model_selection import train_test_split

Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)
`;

export const ia5 = iaWorld({
  id: 'ia5',
  index: 5,
  title: 'Clasificación',
  subtitle: 'Decidir entre clases: logística, árboles, vecinos, SVM y conjuntos',
  emoji: '🧭',
  color: '#F472B6',
  level: 'intermedio',
  intro:
    'La **clasificación** predice una etiqueta: ¿se dará de baja este cliente? ¿es spam? ¿qué dígito es? Aquí conocerás los cinco grandes tipos de clasificadores —**regresión logística, árboles, vecinos (KNN), máquinas de vectores de soporte y conjuntos (bosques y boosting)**—, cómo piensa cada uno, qué ajustes tienen y cuándo conviene cada uno. Todo sobre un caso real de bajas de clientes.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia5-1', { title: 'Regresión logística', summary: 'De una puntuación a una probabilidad y una decisión', emoji: '🎚️', commands: ['LogisticRegression', 'función logística', 'predict_proba', 'accuracy'], minutes: 14 }, [
      learn(
        'Predecir una etiqueta con una probabilidad',
        `
Queremos predecir si un cliente se dará de **baja** (1) o no (0). Una regresión lineal no sirve: su salida puede ser −3 o 17, y una probabilidad debe estar entre 0 y 1.

La **regresión logística** (a pesar del nombre, es de *clasificación*) hace dos pasos:

1. Calcula una **puntuación** lineal: \`z = w₁·x₁ + w₂·x₂ + … + b\`.
2. La pasa por la **función logística** (sigmoide): \`P(baja) = 1 / (1 + e⁻ᶻ)\`, una curva en S que aplasta cualquier número a un valor entre 0 y 1.

Después **decide**: si \`P ≥ umbral\` (por defecto 0.5) predice 1. Cuando \`z = 0\`, \`P = 0.5\`: esa es la **frontera de decisión**.
`,
        '🎚️',
      ),
      illus('ia-sigmoid', 'La sigmoide y el umbral', 'Cambia el peso, el sesgo y el umbral. Los puntos con borde rojo son errores. Observa dónde queda la frontera.'),
      mc('Si la puntuación es `z = 0`, ¿qué probabilidad devuelve la función logística?', ['0', '0.5', '1', 'No está definida'], 1, '`1 / (1 + e⁰) = 1 / 2 = 0.5`: es justo el punto de indecisión, la frontera.'),
      pyDemo(
        'La sigmoide a mano',
        [
          ['import numpy as np\n\ndef sigmoide(z):\n    return 1 / (1 + np.exp(-z))\n\nz = np.array([-4.0, -1.0, 0.0, 1.0, 4.0])\nprint(sigmoide(z).round(3))', 'Puntuaciones muy negativas ⇒ probabilidad ≈ 0; muy positivas ⇒ ≈ 1; cero ⇒ 0.5'],
        ],
      ),
      learn(
        'Entrenar con scikit-learn',
        `
\`LogisticRegression\` se usa como cualquier modelo de sklearn: \`fit\`, \`predict\`, \`score\`. Además:

- \`predict_proba(X)\` devuelve **una probabilidad por clase** (columnas en el orden de \`modelo.classes_\`). La probabilidad de la clase positiva es la columna \`[:, 1]\`.
- \`coef_\` y \`intercept_\` son los pesos \`w\` y el sesgo \`b\`.
- \`score\` devuelve la **exactitud** (*accuracy*): el porcentaje de aciertos.

Igual que en la regresión regularizada, **escala las variables** y usa un pipeline. Por defecto aplica regularización L2 (el parámetro \`C\` es su inversa: más pequeño = más penalización).
`,
        '🧮',
      ),
      pyDemo(
        'Predecir bajas',
        [
          [`${CARGA}from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nprint(round(modelo.score(Xte, yte), 2))`, '85 % de aciertos en clientes que el modelo no había visto'],
          ['lr = modelo[-1]\nprint(dict(zip(X.columns, lr.coef_[0].round(2))))', 'Más llamadas a soporte (+1.23) ⇒ más probabilidad de baja; más antigüedad (−0.91) ⇒ menos'],
          ['print(modelo.predict_proba(Xte)[:3].round(2))', 'Cada fila: [P(se queda), P(se va)]. Suman 1'],
        ],
        FILES,
      ),
      tf('`predict_proba` devuelve, para cada fila, probabilidades de las clases que suman 1.', true, 'Cada fila es una distribución de probabilidad sobre las clases: positivas y de suma 1.'),
      fill('Completa para obtener la probabilidad de la **clase positiva** (columna 1).', 'p = modelo.predict_proba(X)[:, ___]', ['0', '1', '-2', '2'], ['1'], 'Con dos clases, la columna 0 es P(clase 0) y la columna 1 es P(clase 1).'),
      learn(
        'El umbral es una decisión de negocio',
        `
El umbral 0.5 es solo una convención. Si **perder un cliente** cuesta mucho más que **hacerle una oferta** a uno que no se iba a ir, te conviene un umbral más bajo (0.3, 0.35…): detectas más bajas reales a costa de más falsas alarmas. En un diagnóstico médico grave pasa lo mismo.

Para usar otro umbral se trabaja con las probabilidades:

\`alertas = modelo.predict_proba(X)[:, 1] >= 0.35\`

En la zona 6 estudiarás cómo medir este compromiso con precisión, sensibilidad y curvas ROC.
`,
        '🎛️',
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\np = np.array([0.1, 0.4, 0.55, 0.9])\nprint((p >= 0.5).sum(), (p >= 0.35).sum())', ['2 2', '3 2', '2 4'], 'Con umbral 0.5 pasan 0.55 y 0.9 (2). Con 0.35 pasan 0.4, 0.55 y 0.9 (3). Bajar el umbral genera más alertas.'),
      pyPractice({
        goal: 'Tu primer clasificador',
        prompt: 'Entrena un `make_pipeline(StandardScaler(), LogisticRegression())` con `(Xtr, ytr)` y guarda en `exactitud` su exactitud (*accuracy*) en la **prueba**.',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nexactitud = None\n`,
        check: truthy('abs(exactitud - 0.85) < 1e-9'),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nexactitud = modelo.score(Xte, yte)`,
        hints: ['El pipeline escala y clasifica en un solo objeto: `.fit(Xtr, ytr)`.', '`modelo.score(Xte, yte)` devuelve la exactitud en la prueba.'],
        explain: 'El 85 % son 17 aciertos de 20 clientes de prueba. Recuerda que con tan pocos datos de prueba la cifra tiene mucha incertidumbre: lo veremos en la zona 6.',
        commands: ['LogisticRegression', 'accuracy'],
      }),
      pyPractice({
        goal: '¿Se dará de baja este cliente?',
        prompt: 'El `modelo` ya está entrenado. Guarda en `p` la **probabilidad de baja** (un número) de un cliente con `meses=6`, `soporte=5`, `cuota=80` y contrato mensual (`contrato_anual=0`, `contrato_mensual=1`).',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\np = None\n`,
        check: truthy('abs(p - 0.979) < 0.01'),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\ncliente = pd.DataFrame({"meses": [6], "soporte": [5], "cuota": [80], "contrato_anual": [0], "contrato_mensual": [1]})\np = modelo.predict_proba(cliente)[0, 1]`,
        hints: ['Crea un DataFrame con **las mismas columnas y en el mismo orden** que `X`.', '`predict_proba(cliente)` devuelve una fila `[P(0), P(1)]`: toma el elemento `[0, 1]`.'],
        explain: 'Un cliente nuevo, con contrato mensual y 5 llamadas a soporte, recibe un 98 % de probabilidad de baja: prioridad máxima para el equipo de retención.',
        commands: ['predict_proba', 'LogisticRegression'],
      }),
      pyPractice({
        goal: 'Baja el umbral',
        prompt: 'Calcula `proba` (probabilidad de baja de cada cliente de la prueba) con el `modelo` y guarda en `alertas_05` y `alertas_035` cuántos clientes pasan el umbral 0.5 y 0.35 respectivamente.',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nproba = alertas_05 = alertas_035 = None\n`,
        check: all(variable('int(alertas_05)', '9'), variable('int(alertas_035)', '11')),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nproba = modelo.predict_proba(Xte)[:, 1]\nalertas_05 = (proba >= 0.5).sum()\nalertas_035 = (proba >= 0.35).sum()`,
        hints: ['`proba = modelo.predict_proba(Xte)[:, 1]`.', '`(proba >= 0.35).sum()` cuenta los `True`.'],
        explain: 'Bajar el umbral de 0.5 a 0.35 añade 2 alertas más. Si esas 2 son bajas reales, ganas retención; si no, gastas ofertas innecesarias. Es una decisión de coste-beneficio.',
        commands: ['predict_proba'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia5-2', { title: 'Árboles de decisión', summary: 'Preguntas que separan clases: Gini, profundidad y poda', emoji: '🌿', commands: ['DecisionTreeClassifier', 'impureza de Gini', 'sobreajuste'], minutes: 14 }, [
      learn(
        'Jugar a las veinte preguntas',
        `
Un **árbol de decisión** clasifica con una cadena de preguntas de sí/no sobre las variables: «¿tiene más de 2 llamadas a soporte? → ¿lleva menos de 26 meses?…». Cada hoja final reparte una clase. Es el modelo más **interpretable** de todos: puedes leer sus reglas.

¿Cómo elige las preguntas? Busca la que deje los dos grupos resultantes lo más **puros** posible. La **impureza de Gini** de un grupo es:

\`Gini = 1 − (p₀² + p₁²)\`

- Grupo puro (todos de la misma clase): **0**.
- Mitad y mitad: **0.5** (máxima mezcla con dos clases).

Para cada pregunta se calcula el Gini de los dos grupos (ponderado por su tamaño) y se elige la que más lo reduce. Luego se repite, recursivamente, dentro de cada grupo.
`,
        '🌿',
      ),
      illus('ia-tree-split', 'Elegir el mejor corte', 'Mueve el umbral y mira cómo cambian las impurezas de los dos grupos. «Mejor corte» busca el óptimo.'),
      mc('Un grupo tiene 5 clientes que se quedan y 5 que se van. ¿Cuál es su impureza de Gini?', ['0', '0.25', '0.5', '1'], 2, '`1 − (0.5² + 0.5²) = 0.5`: mezcla máxima con dos clases.'),
      pyDemo(
        'Un árbol que se puede leer',
        [
          [`${DIV}from sklearn.tree import DecisionTreeClassifier, export_text\n\narbol = DecisionTreeClassifier(max_depth=2, random_state=0).fit(Xtr, ytr)\nprint(export_text(arbol, feature_names=list(X.columns)))`, 'Las reglas: pocas llamadas a soporte y poca antigüedad ⇒ baja; muchas llamadas y cuota alta ⇒ baja…'],
          ['print(dict(zip(X.columns, arbol.feature_importances_.round(2))))', 'La importancia de cada variable: cuánto ha reducido la impureza. El contrato no se usó en este árbol'],
        ],
        FILES,
      ),
      tf('Los árboles de decisión necesitan que las variables estén escaladas para funcionar bien.', false, 'Solo comparan cada variable con un umbral: no les afecta la escala ni la forma de la distribución.'),
      learn(
        'Un árbol sin freno memoriza',
        `
Si dejas crecer un árbol hasta que todas las hojas sean puras, acaba con **una hoja casi por cada dato**: 100 % en entrenamiento y mucho peor en prueba. Es el **sobreajuste** clásico.

Se controla **limitando la complejidad**:

- \`max_depth\`: profundidad máxima (3–6 suele bastar).
- \`min_samples_leaf\`: mínimo de ejemplos en cada hoja (evita hojas con 1 dato).
- \`min_samples_split\`, \`max_leaf_nodes\`, \`ccp_alpha\` (poda).

Estos son **hiperparámetros**: no se aprenden, los eliges tú (con validación cruzada).
`,
        '✂️',
      ),
      pyDemo(
        'Profundidad contra rendimiento',
        [
          [`${DIV}from sklearn.tree import DecisionTreeClassifier\n\nfor d in [1, 2, 3, 5, None]:\n    t = DecisionTreeClassifier(max_depth=d, random_state=0).fit(Xtr, ytr)\n    print(d, t.get_depth(), round(t.score(Xtr, ytr), 2), round(t.score(Xte, yte), 2))`, 'Sin límite el árbol llega a 100 % en entrenamiento pero cae en prueba (0.75); con profundidad 3 el compromiso es mejor'],
        ],
        FILES,
      ),
      pyOut('¿Qué imprime?', 'def gini(a, b):\n    n = a + b\n    return round(1 - (a / n) ** 2 - (b / n) ** 2, 2)\n\nprint(gini(9, 1), gini(5, 5), gini(4, 0))', ['0.9 0.5 0.0', '0.1 0.25 0.0', '0.18 0.5 1.0'], 'Gini(9, 1) = 1 − 0.81 − 0.01 = 0.18; Gini(5, 5) = 0.5; un grupo puro vale 0.'),
      match('Une cada hiperparámetro con su efecto:', [['max_depth', 'Limita cuántas preguntas seguidas puede hacer'], ['min_samples_leaf', 'Prohíbe hojas con muy pocos ejemplos'], ['criterion', 'Mide la impureza: gini o entropy'], ['random_state', 'Fija el desempate para que el resultado sea reproducible']], 'Los tres primeros regulan el crecimiento y la forma del árbol; `random_state` solo hace repetible el entrenamiento.'),
      pyPractice({
        goal: 'Calcula el Gini',
        prompt: 'Escribe la función `gini(a, b)` que devuelve la impureza de un grupo con `a` ejemplos de una clase y `b` de otra. Calcula en `gini_mezcla` el de un grupo (5, 5) y en `gini_corte` el **ponderado** de dividirlo en (4, 1) a la izquierda y (1, 4) a la derecha.',
        starter: 'def gini(a, b):\n    pass\n\ngini_mezcla = gini_corte = None\n',
        check: all(truthy('abs(gini(5, 5) - 0.5) < 1e-9'), truthy('abs(gini_mezcla - 0.5) < 1e-9'), truthy('abs(gini_corte - 0.32) < 1e-9')),
        solution: 'def gini(a, b):\n    n = a + b\n    return 1 - (a / n) ** 2 - (b / n) ** 2\n\ngini_mezcla = gini(5, 5)\ngini_corte = (5 / 10) * gini(4, 1) + (5 / 10) * gini(1, 4)',
        hints: ['`n = a + b` y `p = a / n`, `q = b / n`.', 'Ponderado: `(n_izq/n) * gini(izq) + (n_der/n) * gini(der)`.'],
        explain: 'Dividir bajó la impureza de 0.5 a 0.32: esa ganancia (0.18) es lo que hace atractiva la pregunta. El árbol prueba todas y elige la de mayor ganancia.',
        commands: ['impureza de Gini'],
      }),
      pyPractice({
        goal: 'Un árbol de profundidad 3',
        prompt: 'Entrena `DecisionTreeClassifier(max_depth=3, random_state=0)` con `(Xtr, ytr)` y guarda en `acc_train` y `acc_test` su exactitud en entrenamiento y en prueba.',
        setup: FILES,
        starter: `from sklearn.tree import DecisionTreeClassifier\n${DIV}\nacc_train = acc_test = None\n`,
        check: all(truthy('abs(acc_train - 0.8667) < 0.001'), truthy('abs(acc_test - 0.8) < 1e-9')),
        solution: `from sklearn.tree import DecisionTreeClassifier\n${DIV}\narbol = DecisionTreeClassifier(max_depth=3, random_state=0).fit(Xtr, ytr)\nacc_train = arbol.score(Xtr, ytr)\nacc_test = arbol.score(Xte, yte)`,
        hints: ['`DecisionTreeClassifier(max_depth=3, random_state=0).fit(Xtr, ytr)`.', '`score` con entrenamiento y con prueba.'],
        explain: 'La diferencia entre entrenamiento (87 %) y prueba (80 %) es pequeña: el árbol podado generaliza razonablemente.',
        commands: ['DecisionTreeClassifier'],
      }),
      pyPractice({
        goal: 'Mide el sobreajuste',
        prompt: 'Entrena un árbol **sin límite de profundidad** (`random_state=0`) y guarda en `brecha` la diferencia `exactitud_entrenamiento − exactitud_prueba`. Guarda en `hojas` cuántas hojas tiene (`get_n_leaves()`).',
        setup: FILES,
        starter: `from sklearn.tree import DecisionTreeClassifier\n${DIV}\nbrecha = hojas = None\n`,
        check: all(truthy('abs(brecha - 0.25) < 1e-9'), variable('int(hojas)', '16')),
        solution: `from sklearn.tree import DecisionTreeClassifier\n${DIV}\narbol = DecisionTreeClassifier(random_state=0).fit(Xtr, ytr)\nbrecha = arbol.score(Xtr, ytr) - arbol.score(Xte, yte)\nhojas = arbol.get_n_leaves()`,
        hints: ['Sin `max_depth` el árbol crece hasta que todas las hojas son puras.', '`arbol.get_n_leaves()` cuenta las hojas.'],
        explain: '16 hojas para 60 clientes: casi una hoja por cada tres datos, y una brecha del 25 % entre entrenamiento y prueba. Esa brecha es la firma del sobreajuste.',
        commands: ['DecisionTreeClassifier', 'sobreajuste'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia5-3', { title: 'Vecinos más cercanos', summary: 'KNN: votar con los parecidos, escalar y elegir k', emoji: '👥', commands: ['KNeighborsClassifier', 'StandardScaler', 'predict_proba'], minutes: 12 }, [
      learn(
        'Dime con quién andas',
        `
**KNN** (*k nearest neighbors*) es el clasificador más intuitivo: para decidir la clase de un punto nuevo, mira a sus **\`k\` vecinos más cercanos** del conjunto de entrenamiento y deja que **voten**. Si 4 de 5 vecinos se dieron de baja, predice baja (y \`predict_proba\` da 0.8).

No hay una fase de aprendizaje: \`fit\` solo **guarda los datos**; todo el cálculo ocurre al predecir (se llama *aprendizaje perezoso*). Eso lo hace lento con muchísimos datos.

Dos decisiones lo definen:
- **\`k\`**: cuántos vecinos votan.
- **La distancia** (por defecto la euclídea): qué significa "cercano".
`,
        '👥',
      ),
      illus('ia-knn-region', 'Regiones de decisión', 'Cambia k y observa cómo se redibuja el mapa: cada celda toma el color que votarían sus k vecinos más cercanos.'),
      mc('¿Qué ocurre con la frontera de decisión de KNN cuando `k = 1`?', ['Es una recta', 'Se ajusta a cada punto, incluidos los ruidosos (riesgo de sobreajuste)', 'Es siempre perfecta en datos nuevos', 'Desaparece'], 1, 'Con un solo vecino, cada punto de entrenamiento se clasifica a sí mismo: 100 % en entrenamiento, pero una frontera retorcida que no generaliza.'),
      learn(
        'La distancia exige escalar',
        `
Como KNN solo mira **distancias**, una variable con valores grandes (la cuota en euros: 20–100) domina sobre una pequeña (llamadas a soporte: 0–9). Es como medir la distancia entre dos ciudades sumando kilómetros y milímetros.

Por eso **KNN requiere escalar**. Con un \`make_pipeline(StandardScaler(), KNeighborsClassifier())\` todas las variables pesan lo mismo y, de paso, el escalado se calcula solo con el entrenamiento.

Más pistas: KNN sufre la **maldición de la dimensionalidad** (con muchas variables todo está "lejos" de todo) y no filtra variables irrelevantes.
`,
        '📏',
      ),
      pyDemo(
        'Con y sin escalar',
        [
          [`${DIV}from sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nfor k in [1, 5, 15]:\n    sin = KNeighborsClassifier(k).fit(Xtr, ytr).score(Xte, yte)\n    con = make_pipeline(StandardScaler(), KNeighborsClassifier(k)).fit(Xtr, ytr).score(Xte, yte)\n    print(k, sin, con)`, 'Escalar mejora claramente (0.55–0.70 → 0.70–0.85): la cuota y los meses dominaban la distancia'],
        ],
        FILES,
      ),
      tf('Un KNN con `k = 1` siempre acierta el 100 % de los puntos de entrenamiento (si no hay puntos repetidos con clases distintas).', true, 'Cada punto es su propio vecino más cercano y se vota a sí mismo. Por eso la exactitud de entrenamiento no sirve para elegir k.'),
      multi('¿Qué modelos de esta lista **necesitan** variables escaladas para funcionar bien?', ['KNN', 'Árbol de decisión', 'SVM con núcleo RBF', 'Bosque aleatorio'], [0, 2], 'KNN y SVM se basan en distancias, así que dependen de la escala. Los árboles y los bosques solo comparan cada variable con un umbral.'),
      learn(
        'Elegir k con datos que no se ven',
        `
No se puede elegir \`k\` mirando el entrenamiento (siempre ganaría \`k = 1\`). Se prueban varios valores y se puntúan con **validación cruzada**: se parte el entrenamiento en trozos, se entrena con unos y se puntúa con el trozo restante, y se promedian los resultados.

\`cross_val_score(modelo, X, y, cv=5)\` devuelve 5 puntuaciones. (La técnica completa es el tema de la zona 6.)
`,
        '🔁',
      ),
      pyDemo(
        'Buscar un buen k',
        [
          [`${DIV}from sklearn.model_selection import cross_val_score\nfrom sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nfor k in [1, 3, 5, 7, 9, 11]:\n    m = make_pipeline(StandardScaler(), KNeighborsClassifier(k))\n    print(k, round(cross_val_score(m, X, y, cv=5).mean(), 3))`, 'La mejor media en validación cruzada se da con k = 7 (0.825); k = 1 es claramente peor (0.70)'],
        ],
        FILES,
      ),
      pyPractice({
        goal: 'KNN escalado',
        prompt: 'Crea un pipeline `StandardScaler` + `KNeighborsClassifier(5)`, entrénalo con `(Xtr, ytr)` y guarda en `exactitud` su exactitud en la prueba.',
        setup: FILES,
        starter: `from sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nexactitud = None\n`,
        check: truthy('abs(exactitud - 0.85) < 1e-9'),
        solution: `from sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${DIV}\nmodelo = make_pipeline(StandardScaler(), KNeighborsClassifier(5)).fit(Xtr, ytr)\nexactitud = modelo.score(Xte, yte)`,
        hints: ['`make_pipeline(StandardScaler(), KNeighborsClassifier(5))`.', 'Entrena con `Xtr, ytr` y puntúa con `Xte, yte`.'],
        explain: 'Con las variables escaladas, KNN llega al 85 %; sin escalar se quedaba en el 60 %. El preprocesado pesa tanto como el algoritmo.',
        commands: ['KNeighborsClassifier', 'StandardScaler'],
      }),
      pyPractice({
        goal: 'Encuentra el mejor k',
        prompt: 'Para cada `k` en `[1, 3, 5, 7, 9, 11]`, calcula la media de `cross_val_score(pipeline, X, y, cv=5)` (pipeline = escalador + KNN) y guarda en `mejor_k` el valor con la media más alta.',
        setup: FILES,
        starter: `from sklearn.model_selection import cross_val_score\nfrom sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmejor_k = None\n`,
        check: variable('mejor_k', '7'),
        solution: `from sklearn.model_selection import cross_val_score\nfrom sklearn.neighbors import KNeighborsClassifier\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmedias = {}\nfor k in [1, 3, 5, 7, 9, 11]:\n    modelo = make_pipeline(StandardScaler(), KNeighborsClassifier(k))\n    medias[k] = cross_val_score(modelo, X, y, cv=5).mean()\nmejor_k = max(medias, key=medias.get)`,
        hints: ['Guarda las medias en un diccionario `{k: media}`.', '`max(medias, key=medias.get)` devuelve la clave con el valor máximo.'],
        explain: 'Validación cruzada: cada valor de k se puntúa con cinco repartos distintos, así que la elección es mucho más fiable que con una única prueba.',
        commands: ['KNeighborsClassifier'],
      }),
      pyPractice({
        goal: 'k = 1 memoriza',
        prompt: 'Entrena un `KNeighborsClassifier(1)` (sin escalar) con `(Xtr, ytr)` y guarda en `acc_train` su exactitud **en el propio entrenamiento** y en `acc_test` en la prueba.',
        setup: FILES,
        starter: `from sklearn.neighbors import KNeighborsClassifier\n${DIV}\nacc_train = acc_test = None\n`,
        check: all(truthy('abs(acc_train - 1.0) < 1e-9'), truthy('abs(acc_test - 0.55) < 1e-9')),
        solution: `from sklearn.neighbors import KNeighborsClassifier\n${DIV}\nknn = KNeighborsClassifier(1).fit(Xtr, ytr)\nacc_train = knn.score(Xtr, ytr)\nacc_test = knn.score(Xte, yte)`,
        hints: ['`KNeighborsClassifier(1).fit(Xtr, ytr)`.', 'Puntúa con los dos conjuntos.'],
        explain: '100 % frente a 55 %: el caso de manual de sobreajuste. Si solo hubieras mirado el entrenamiento, habrías pensado que el modelo era perfecto.',
        commands: ['KNeighborsClassifier', 'sobreajuste'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia5-4', { title: 'Máquinas de vectores de soporte', summary: 'Margen máximo, vectores de soporte, C, gamma y kernels', emoji: '🛡️', commands: ['SVC', 'StandardScaler', 'sobreajuste'], minutes: 14 }, [
      learn(
        'La frontera con más margen',
        `
Entre las infinitas rectas que separan dos clases, ¿cuál es la mejor? La **máquina de vectores de soporte (SVM)** elige la que deja el **margen más ancho** entre ambas clases: la "calle" más ancha posible sin ningún punto dentro. Una frontera con mucho margen es más robusta ante puntos nuevos.

Lo curioso: la frontera solo depende de unos pocos puntos, los que quedan justo en el borde de la calle: los **vectores de soporte**. Borrar cualquier otro punto no la movería.

Cuando las clases se mezclan un poco, se permite que algunos puntos invadan el margen, con una penalización controlada por **\`C\`**:

- **\`C\` pequeño**: margen ancho, tolera errores (frontera suave; más riesgo de infraajuste).
- **\`C\` grande**: castiga cada error (margen estrecho; riesgo de sobreajuste).
`,
        '🛡️',
      ),
      illus('ia-svm', 'Margen, C y gamma', 'Los puntos con borde blanco son los vectores de soporte. Cambia C, el núcleo y el conjunto de datos.'),
      mc('En una SVM, los **vectores de soporte** son…', ['Todos los puntos de entrenamiento', 'Los puntos mal clasificados únicamente', 'Los pocos puntos del borde del margen que determinan la frontera', 'Los centros de cada clase'], 2, 'Solo esos puntos definen la frontera; el resto podría desaparecer sin cambiarla.'),
      learn(
        'Fronteras curvas con núcleos',
        `
Una recta no separa dos lunas entrelazadas. La SVM resuelve esto con un truco matemático, el **núcleo (*kernel*)**: calcula similitudes entre puntos como si estuvieran proyectados a un espacio de más dimensiones donde sí son separables con un plano. Los núcleos habituales:

- \`kernel="linear"\`: recta (o plano). Rápido y con \`coef_\` interpretable.
- \`kernel="rbf"\` (por defecto): fronteras curvas flexibles. Tiene un segundo parámetro, **\`gamma\`**: cuánto "alcance" tiene cada punto. \`gamma\` grande = cada punto solo influye en su vecindad ⇒ fronteras en forma de islas (sobreajuste).
- \`kernel="poly"\`, \`"sigmoid"\`: menos usados.

Como KNN, la SVM se basa en distancias: **hay que escalar** las variables.
`,
        '🌀',
      ),
      pyDemo(
        'Lineal frente a RBF en las lunas',
        [
          ['import numpy as np\nfrom sklearn.datasets import make_moons\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.svm import SVC\n\nX, y = make_moons(200, noise=0.3, random_state=0)\nA, B, ya, yb = train_test_split(X, y, test_size=0.3, random_state=0)\n\nlineal = SVC(kernel="linear").fit(A, ya)\nrbf = SVC(kernel="rbf").fit(A, ya)\nprint(round(lineal.score(B, yb), 3), round(rbf.score(B, yb), 3))', 'La recta se queda en 0.85; el RBF, con frontera curva, llega a 0.93'],
          ['demasiado = SVC(kernel="rbf", gamma=50).fit(A, ya)\nprint(round(demasiado.score(A, ya), 3), round(demasiado.score(B, yb), 3))', 'Con gamma enorme el modelo se ajusta al entrenamiento (0.97) pero rinde peor en prueba (0.90): sobreajuste'],
        ],
      ),
      tf('Con una SVM de núcleo RBF, un `gamma` muy grande tiende a producir sobreajuste.', true, 'Cada punto influye solo en su entorno inmediato: la frontera se pliega alrededor de los datos de entrenamiento, incluido el ruido.'),
      pyDemo(
        'Una SVM sobre las bajas de clientes',
        [
          [`${DIV}from sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n\nmodelo = make_pipeline(StandardScaler(), SVC()).fit(Xtr, ytr)\nprint(round(modelo.score(Xte, yte), 2), modelo[-1].n_support_)`, 'Exactitud del 85 %; `n_support_` indica cuántos vectores de soporte hay en cada clase (22 y 20 de 60 clientes)'],
          ['for C in [0.1, 1, 10, 100]:\n    m = make_pipeline(StandardScaler(), SVC(C=C, gamma=0.5)).fit(Xtr, ytr)\n    print(C, round(m.score(Xtr, ytr), 2), round(m.score(Xte, yte), 2), m[-1].n_support_.sum())', 'Al subir C el entrenamiento mejora (0.57 → 1.0) y hay menos vectores de soporte, pero la prueba baja desde el óptimo (C = 1)'],
        ],
        FILES,
      ),
      fill('Completa para pedir una SVM con frontera **recta**.', 'modelo = SVC(kernel="___")', ['linear', 'rbf', 'poly', 'gamma'], ['linear'], '`kernel="linear"` produce una frontera lineal; `"rbf"` (por defecto) una curva.'),
      order('Ordena la receta para una SVM bien hecha:', ['escalar', 'las', 'variables', 'elegir', 'C', 'y', 'gamma', 'con', 'validación', 'cruzada'], 'escalar las variables elegir C y gamma con validación cruzada', 'La SVM necesita variables en la misma escala, y sus dos hiperparámetros principales se afinan con validación cruzada.'),
      pyPractice({
        goal: 'SVM escalada',
        prompt: 'Entrena un pipeline `StandardScaler` + `SVC()` con `(Xtr, ytr)` y guarda en `exactitud` su exactitud en la prueba y en `n_vectores` el **total** de vectores de soporte.',
        setup: FILES,
        starter: `from sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\nexactitud = n_vectores = None\n`,
        check: all(truthy('abs(exactitud - 0.85) < 1e-9'), variable('int(n_vectores)', '42')),
        solution: `from sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\nmodelo = make_pipeline(StandardScaler(), SVC()).fit(Xtr, ytr)\nexactitud = modelo.score(Xte, yte)\nn_vectores = modelo[-1].n_support_.sum()`,
        hints: ['`modelo[-1]` es el último paso del pipeline (la SVM).', '`n_support_` es un array con los vectores de soporte de cada clase: súmalo.'],
        explain: '42 de los 60 clientes de entrenamiento son vectores de soporte: con datos tan solapados, la mayoría de puntos "tocan" el margen.',
        commands: ['SVC', 'StandardScaler'],
      }),
      pyPractice({
        goal: 'El precio de un C alto',
        prompt: 'Entrena `make_pipeline(StandardScaler(), SVC(C=100, gamma=0.5))` y guarda en `acc_train` y `acc_test` su exactitud en entrenamiento y prueba.',
        setup: FILES,
        starter: `from sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\nacc_train = acc_test = None\n`,
        check: all(truthy('abs(acc_train - 1.0) < 1e-9'), truthy('abs(acc_test - 0.75) < 1e-9')),
        solution: `from sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\nmodelo = make_pipeline(StandardScaler(), SVC(C=100, gamma=0.5)).fit(Xtr, ytr)\nacc_train = modelo.score(Xtr, ytr)\nacc_test = modelo.score(Xte, yte)`,
        hints: ['Pasa `C=100, gamma=0.5` a `SVC`.', 'Puntúa con entrenamiento y prueba.'],
        explain: 'Un C enorme obliga a clasificar bien hasta el último punto: 100 % en entrenamiento y un 75 % en prueba. La diferencia delata el sobreajuste.',
        commands: ['SVC', 'sobreajuste'],
      }),
      pyPractice({
        goal: 'Dos núcleos, dos fronteras',
        prompt: 'Con las lunas (`A, B, ya, yb`) entrena una SVM de núcleo `"linear"` y otra `"rbf"` y guarda sus exactitudes en la prueba en `acc_lineal` y `acc_rbf`.',
        starter: 'from sklearn.datasets import make_moons\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.svm import SVC\n\nX, y = make_moons(200, noise=0.3, random_state=0)\nA, B, ya, yb = train_test_split(X, y, test_size=0.3, random_state=0)\n\nacc_lineal = acc_rbf = None\n',
        check: all(truthy('abs(acc_lineal - 0.85) < 1e-9'), truthy('abs(acc_rbf - 0.9333) < 0.001')),
        solution: 'from sklearn.datasets import make_moons\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.svm import SVC\n\nX, y = make_moons(200, noise=0.3, random_state=0)\nA, B, ya, yb = train_test_split(X, y, test_size=0.3, random_state=0)\n\nacc_lineal = SVC(kernel="linear").fit(A, ya).score(B, yb)\nacc_rbf = SVC(kernel="rbf").fit(A, ya).score(B, yb)',
        hints: ['`SVC(kernel="linear")` y `SVC(kernel="rbf")`.', '`.fit(A, ya).score(B, yb)` entrena y puntúa en la prueba.'],
        explain: 'Una frontera curva encaja mejor con unos datos en forma de media luna. Cuando los datos no son separables con una recta, un núcleo no lineal marca la diferencia.',
        commands: ['SVC'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia5-5', { title: 'Bosques y boosting', summary: 'Conjuntos de modelos: votar y corregirse', emoji: '🌲', commands: ['RandomForestClassifier', 'GradientBoostingClassifier', 'ensemble', 'DecisionTreeClassifier'], minutes: 14 }, [
      learn(
        'La sabiduría de la multitud',
        `
Si le preguntas a mil personas cuántas canicas hay en un tarro, la **media** de sus respuestas suele acercarse más a la verdad que casi cualquier individuo. Los **conjuntos (*ensembles*)** aplican la idea a los modelos: combinar muchos modelos imperfectos da uno mucho mejor… siempre que los errores de cada uno sean **distintos**.

Hay dos grandes estrategias:

1. **Bagging** (*bootstrap aggregating*): entrena muchos modelos **en paralelo**, cada uno con una muestra aleatoria con reemplazo de los datos, y **vota**. El **bosque aleatorio** son muchos árboles con bagging, más un sorteo de variables en cada división para que se parezcan menos.
2. **Boosting**: entrena modelos **en secuencia**; cada nuevo modelo (un árbol pequeño) se centra en corregir los errores del conjunto anterior. Es el motor de XGBoost, LightGBM y *gradient boosting*.
`,
        '🌲',
      ),
      illus('ia-ensemble-vote', 'Por qué votar funciona', 'Sube el número de modelos y mira cuándo mejora la mayoría. Después sube la correlación: si todos fallan igual, votar no sirve.'),
      mc('¿En qué caso votar entre muchos modelos **no** mejora el resultado?', ['Cuando cada modelo es mejor que el azar', 'Cuando los modelos cometen casi siempre los mismos errores', 'Cuando hay un número impar de modelos', 'Cuando los modelos se entrenan con datos distintos'], 1, 'Si todos fallan a la vez, la mayoría falla igual. El valor de un conjunto está en la **diversidad** de errores.'),
      learn(
        'Bagging frente a boosting',
        `
| | Bosque aleatorio | Gradient boosting |
|---|---|---|
| Cómo | árboles **independientes** (paralelo) | árboles **encadenados** (secuencial) |
| Cada árbol | profundo, de alta varianza | pequeño (profundidad 2–5), de alto sesgo |
| Reduce | la **varianza** | el **sesgo** (y algo de varianza) |
| Riesgo | casi no sobreajusta | sobreajusta si se pasa de árboles/aprendizaje |
| Ajustes | pocos, robusto | \`learning_rate\`, \`n_estimators\`, \`max_depth\` |

Con \`n_estimators\` mayor, el bosque nunca empeora (solo tarda más); el boosting sí puede sobreajustar. Regla práctica: *learning_rate* bajo + más árboles.
`,
        '⚖️',
      ),
      pyDemo(
        'Árbol, bosque y boosting',
        [
          [`${DIV}from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.tree import DecisionTreeClassifier\n\nmodelos = {\n    "árbol": DecisionTreeClassifier(random_state=0),\n    "bosque": RandomForestClassifier(n_estimators=100, random_state=0),\n    "boosting": GradientBoostingClassifier(random_state=0),\n}\nfor nombre, m in modelos.items():\n    print(nombre, round(cross_val_score(m, X, y, cv=5).mean(), 3))`, 'El bosque supera al árbol solo (0.76 contra 0.69), como se esperaba. El boosting por defecto, con tan pocos datos, queda entre ambos'],
          ['bosque = modelos["bosque"].fit(Xtr, ytr)\nprint(dict(zip(X.columns, bosque.feature_importances_.round(2))))', '`feature_importances_`: la variable más usada es la antigüedad (`meses`), seguida de soporte y cuota'],
        ],
        FILES,
      ),
      tf('Un bosque aleatorio con más árboles (`n_estimators` mayor) tiende a sobreajustar más.', false, 'Añadir árboles a un bosque reduce la varianza o la deja igual; no sobreajusta por eso (solo tarda más). Con boosting sí hay que vigilarlo.'),
      pyOut('¿Qué imprime?', 'import numpy as np\nfrom sklearn.ensemble import RandomForestClassifier\nX = np.array([[0], [1], [2], [3], [4], [5], [6], [7]])\ny = np.array([0, 0, 0, 0, 1, 1, 1, 1])\nm = RandomForestClassifier(n_estimators=25, random_state=0).fit(X, y)\nprint(m.predict([[1], [6]]), len(m.estimators_))', ['[0 1] 8', '[1 0] 25', '[0 1] 1'], 'Los árboles aprenden que x ≥ 4 ⇒ clase 1, así que 1 → 0 y 6 → 1; `estimators_` guarda los 25 árboles.'),
      match('Une cada término con su descripción:', [['Bagging', 'Modelos independientes entrenados con muestras aleatorias que votan'], ['Boosting', 'Modelos en cadena, cada uno corrige los errores del anterior'], ['feature_importances_', 'Cuánto ha usado el modelo cada variable'], ['n_estimators', 'Número de árboles del conjunto']], 'Son los cuatro términos que aparecen una y otra vez al trabajar con bosques y gradient boosting.'),
      pyPractice({
        goal: 'Tu primer bosque',
        prompt: 'Entrena un `RandomForestClassifier(n_estimators=100, random_state=0)` con `(Xtr, ytr)` y guarda en `exactitud` su exactitud en la prueba y en `mas_importante` el **nombre** de la variable con mayor importancia.',
        setup: FILES,
        starter: `from sklearn.ensemble import RandomForestClassifier\n${DIV}\nexactitud = mas_importante = None\n`,
        check: all(truthy('abs(exactitud - 0.75) < 1e-9'), variable('mas_importante', "'meses'")),
        solution: `from sklearn.ensemble import RandomForestClassifier\n${DIV}\nbosque = RandomForestClassifier(n_estimators=100, random_state=0).fit(Xtr, ytr)\nexactitud = bosque.score(Xte, yte)\nmas_importante = X.columns[bosque.feature_importances_.argmax()]`,
        hints: ['`RandomForestClassifier(n_estimators=100, random_state=0)`.', '`X.columns[bosque.feature_importances_.argmax()]` toma el nombre de la columna con mayor importancia.'],
        explain: 'Con solo 20 clientes de prueba, 0.75 y 0.85 no son estadísticamente distinguibles. Para comparar modelos de verdad se usa validación cruzada (zona 6).',
        commands: ['RandomForestClassifier'],
      }),
      pyPractice({
        goal: 'Boosting con frenos',
        prompt: 'Entrena `GradientBoostingClassifier(n_estimators=50, learning_rate=0.1, max_depth=2, random_state=0)` con `(Xtr, ytr)` y guarda en `exactitud` su exactitud en la prueba y en `n_arboles` cuántos árboles contiene (`len(modelo.estimators_)`).',
        setup: FILES,
        starter: `from sklearn.ensemble import GradientBoostingClassifier\n${DIV}\nexactitud = n_arboles = None\n`,
        check: all(truthy('abs(exactitud - 0.8) < 1e-9'), variable('int(n_arboles)', '50')),
        solution: `from sklearn.ensemble import GradientBoostingClassifier\n${DIV}\nmodelo = GradientBoostingClassifier(n_estimators=50, learning_rate=0.1, max_depth=2, random_state=0).fit(Xtr, ytr)\nexactitud = modelo.score(Xte, yte)\nn_arboles = len(modelo.estimators_)`,
        hints: ['Pasa los tres hiperparámetros al constructor.', '`modelo.estimators_` tiene un árbol por etapa (en clasificación binaria, una columna).'],
        explain: 'Árboles muy pequeños (profundidad 2) y una tasa de aprendizaje moderada: así cada etapa corrige un poco y el conjunto no se ajusta al ruido.',
        commands: ['GradientBoostingClassifier', 'ensemble'],
      }),
      pyPractice({
        goal: 'Compara con validación cruzada',
        prompt: 'Calcula en el diccionario `cv` la media de `cross_val_score(modelo, X, y, cv=5)` para `"arbol"` (`DecisionTreeClassifier(random_state=0)`) y `"bosque"` (`RandomForestClassifier(n_estimators=100, random_state=0)`). Guarda en `gana_el_bosque` si la media del bosque es mayor.',
        setup: FILES,
        starter: `from sklearn.ensemble import RandomForestClassifier\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\ncv = {}\ngana_el_bosque = None\n`,
        check: all(truthy('abs(cv["arbol"] - 0.6875) < 1e-9'), truthy('abs(cv["bosque"] - 0.7625) < 1e-9'), variable('bool(gana_el_bosque)', 'True')),
        solution: `from sklearn.ensemble import RandomForestClassifier\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\ncv = {\n    "arbol": cross_val_score(DecisionTreeClassifier(random_state=0), X, y, cv=5).mean(),\n    "bosque": cross_val_score(RandomForestClassifier(n_estimators=100, random_state=0), X, y, cv=5).mean(),\n}\ngana_el_bosque = cv["bosque"] > cv["arbol"]`,
        hints: ['`cross_val_score(modelo, X, y, cv=5).mean()` da la media de los cinco repartos.', 'Compara los valores del diccionario.'],
        explain: 'Cinco repartos distintos comparan los modelos de forma mucho más fiable que una sola división. El bosque supera al árbol: la diversidad compensa los errores.',
        commands: ['RandomForestClassifier', 'DecisionTreeClassifier'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: retener clientes',
    prompt:
      'El equipo de retención quiere una lista de clientes con riesgo de baja.\n\n1. Carga `bajas.csv`, codifica `contrato` en columnas 0/1 (`dtype=int`) y separa `X` e `y` (`baja`).\n2. Divide con `test_size=0.25`, `random_state=0` y `stratify=y`.\n3. Entrena un `make_pipeline(StandardScaler(), LogisticRegression())` llamado `modelo`.\n4. Guarda en `exactitud` su exactitud en la prueba y en `base` la de un `DummyClassifier(strategy="most_frequent")`.\n5. Calcula `proba` (probabilidad de baja en la prueba), y con el umbral **0.35** guarda en `alertas` cuántos clientes se marcan y en `capturadas` cuántas **bajas reales** están entre ellos.',
    setup: FILES,
    starter:
      'import pandas as pd\nfrom sklearn.dummy import DummyClassifier\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("bajas.csv")\n\n# 1: variables\nX = y = None\n\n# 2: división\nXtr = Xte = ytr = yte = None\n\n# 3 y 4: modelo y exactitudes\nmodelo = None\nexactitud = base = None\n\n# 5: alertas con umbral 0.35\nproba = alertas = capturadas = None\n',
    check: all(variable('X.shape', '(80, 5)'), variable('Xte.shape', '(20, 5)'), truthy('abs(exactitud - 0.85) < 1e-9'), truthy('abs(base - 0.6) < 1e-9'), variable('int(alertas)', '11'), variable('int(capturadas)', '8')),
    solution:
      'import pandas as pd\nfrom sklearn.dummy import DummyClassifier\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("bajas.csv")\n\nD = pd.get_dummies(df, columns=["contrato"], dtype=int)\nX = D.drop(columns="baja")\ny = D["baja"]\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\n\nmodelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nexactitud = modelo.score(Xte, yte)\nbase = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr).score(Xte, yte)\n\nproba = modelo.predict_proba(Xte)[:, 1]\nmarcado = proba >= 0.35\nalertas = marcado.sum()\ncapturadas = (marcado & (yte == 1)).sum()',
    hints: ['`pd.get_dummies(df, columns=["contrato"], dtype=int)` y después `drop(columns="baja")`.', '`DummyClassifier(strategy="most_frequent")` predice siempre la clase más común: es la línea base.', '`capturadas = (marcado & (yte == 1)).sum()` cuenta los marcados que además son bajas reales.'],
    explain: 'Has montado un clasificador completo: codificar, dividir con estratificación, escalar dentro de un pipeline, compararte con una línea base (60 %) y convertir probabilidades en alertas con un umbral pensado para el negocio: con 0.35 se marcan 11 clientes y se capturan las 8 bajas reales de la prueba.',
    commands: ['LogisticRegression', 'predict_proba', 'accuracy'],
  },
});

void [multi];
