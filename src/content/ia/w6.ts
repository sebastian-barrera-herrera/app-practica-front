import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, truthy, variable } from './iabuild';
import { BAJAS } from './w5';

const FILES = { files: { 'bajas.csv': BAJAS } };

/** Conjunto desequilibrado: 1 000 casos y solo un 5 % de positivos (por ejemplo, transacciones fraudulentas). */
const IMB = `import numpy as np
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split

X, y = make_classification(n_samples=1000, n_features=6, n_informative=3, n_redundant=0, weights=[0.95], flip_y=0, class_sep=1.2, random_state=0)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
`;

/** Clientes de la operadora con el contrato codificado. */
const CARGA = `import numpy as np
import pandas as pd

df = pd.read_csv("bajas.csv")
D = pd.get_dummies(df, columns=["contrato"], dtype=int)
X = D.drop(columns="baja")
y = D["baja"]
`;

const DIV = `${CARGA}from sklearn.model_selection import train_test_split

Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)
`;

export const ia6 = iaWorld({
  id: 'ia6',
  index: 6,
  title: 'Evaluación y optimización',
  subtitle: 'Métricas honestas, validación cruzada, sesgo-varianza y búsqueda de hiperparámetros',
  emoji: '🎯',
  color: '#FBBF24',
  level: 'intermedio',
  intro:
    'Entrenar un modelo es lo fácil; **saber si funciona de verdad** es lo difícil. En esta zona aprenderás a medir con honestidad: la **matriz de confusión** y sus métricas, las **curvas ROC** y los umbrales, la **validación cruzada**, el diagnóstico de **sesgo y varianza** con curvas de aprendizaje y la **búsqueda de hiperparámetros** (rejilla y aleatoria) sin hacerte trampas a ti mismo.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia6-1', { title: 'La matriz de confusión', summary: 'Aciertos, falsas alarmas, precisión, recall y por qué la exactitud engaña', emoji: '🧮', commands: ['confusion_matrix', 'precision_score', 'clases desequilibradas', 'accuracy'], minutes: 14 }, [
      learn(
        'Cuatro maneras de acertar o fallar',
        `
Un clasificador binario puede acertar o equivocarse de **cuatro** maneras distintas. Se cuentan en la **matriz de confusión** (filas = realidad, columnas = predicción):

| | Predice **negativo** | Predice **positivo** |
|---|---|---|
| **Real negativo** | **VN** verdadero negativo ✅ | **FP** falso positivo (falsa alarma) ❌ |
| **Real positivo** | **FN** falso negativo (positivo perdido) ❌ | **VP** verdadero positivo ✅ |

No todos los errores cuestan lo mismo. Un FN en un test de cáncer es gravísimo; un FP en un filtro de spam (un correo bueno a la basura) también molesta mucho. Por eso no basta con "el % de aciertos".
`,
        '🧮',
      ),
      mc('Un cliente **se da de baja** (positivo real) pero el modelo predijo que se quedaba. ¿Qué casilla es?', ['Verdadero positivo', 'Falso positivo', 'Falso negativo', 'Verdadero negativo'], 2, 'Era positivo y el modelo dijo negativo: es un positivo que se perdió (falso negativo).'),
      learn(
        'Precisión, recall y F1',
        `
De la matriz salen las métricas que de verdad importan:

- **Exactitud** (*accuracy*) = (VP + VN) / total. El porcentaje de aciertos.
- **Precisión** = VP / (VP + FP). De los que **marcaste** como positivos, ¿cuántos lo eran? Alta precisión = pocas falsas alarmas.
- **Sensibilidad (*recall*)** = VP / (VP + FN). De los positivos **reales**, ¿cuántos encontraste? Alto recall = se te escapan pocos.
- **F1** = media armónica de precisión y recall: \`2·P·R / (P + R)\`. Es alta solo si **ambas** lo son.

Hay un tira y afloja: subir el umbral aumenta la precisión y baja el recall; bajarlo, al revés. Prueba la ilustración, incluida la trampa de las clases raras.
`,
        '⚖️',
      ),
      illus('ia-confusion', 'Umbral, matriz y métricas', 'Mueve el umbral y cambia la proporción de positivos. Con pocos positivos, la exactitud sube aunque el modelo no encuentre ninguno.'),
      pyDemo(
        'Las métricas con sklearn',
        [
          ['import numpy as np\nfrom sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score\n\ny_real = np.array([1, 0, 1, 1, 0, 0, 1, 0, 0, 0])\ny_pred = np.array([1, 0, 0, 1, 0, 1, 1, 0, 0, 0])\n\nprint(confusion_matrix(y_real, y_pred))', 'Filas = real, columnas = predicho: [[VN, FP], [FN, VP]] = [[5, 1], [1, 3]]'],
          ['print(accuracy_score(y_real, y_pred), precision_score(y_real, y_pred), recall_score(y_real, y_pred), f1_score(y_real, y_pred))', 'Exactitud 0.8; precisión 3/4 = 0.75; recall 3/4 = 0.75; F1 = 0.75'],
        ],
      ),
      match('Une cada pregunta con la métrica que la responde:', [['De lo que marqué como positivo, ¿cuánto lo era?', 'Precisión'], ['De todos los positivos reales, ¿cuántos encontré?', 'Recall'], ['¿Qué porcentaje de todos los casos acerté?', 'Exactitud'], ['¿Cómo resumo precisión y recall en un solo número?', 'F1']], 'Cada métrica mira una casilla distinta de la matriz. Elegir la adecuada depende del coste de cada error.'),
      tf('Un modelo que predice siempre «no fraude» en un conjunto con un 1 % de fraudes tiene una exactitud del 99 %, así que es un buen modelo.', false, 'La exactitud engaña con clases desequilibradas: ese modelo no detecta ni un solo fraude (recall 0 %). Hay que mirar recall, precisión, F1 o AUC.'),
      pyDemo(
        'La trampa de la exactitud',
        [
          [`${IMB}from sklearn.dummy import DummyClassifier\nfrom sklearn.metrics import accuracy_score, recall_score\n\nprint(y.mean(), yte.sum())\nbase = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr)\np = base.predict(Xte)\nprint(accuracy_score(yte, p), recall_score(yte, p))`, 'Solo un 5 % de positivos (15 en la prueba). Predecir siempre «0» da 95 % de exactitud y 0 % de recall: no detecta nada'],
          ['from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import confusion_matrix, precision_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nm = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\np = m.predict(Xte)\nprint(accuracy_score(yte, p), precision_score(yte, p), recall_score(yte, p))\nprint(confusion_matrix(yte, p))', 'Exactitud 96.7 % (¡mejora poco sobre 95 %!), precisión perfecta pero solo encuentra 5 de 15 positivos (recall 0.33)'],
        ],
      ),
      pyOut('¿Qué imprime?', 'import numpy as np\ny = np.array([1, 1, 0, 0, 0])\np = np.array([1, 0, 1, 0, 0])\ntp = ((y == 1) & (p == 1)).sum()\nfp = ((y == 0) & (p == 1)).sum()\nfn = ((y == 1) & (p == 0)).sum()\nprint(tp, fp, fn)', ['2 1 0', '1 0 1', '0 1 1'], 'Verdadero positivo: solo el primer caso (1). Falsa alarma: el tercero, que era negativo y se marcó (1). Positivo perdido: el segundo, que era positivo y no se marcó (1). Resultado: `1 1 1`.'),
      pyPractice({
        goal: 'Cuenta la matriz a mano',
        prompt: 'Con NumPy (sin sklearn) calcula `vp`, `fp`, `fn` y `vn` a partir de `y_real` y `y_pred`, y después `precision` y `recall`.',
        starter: 'import numpy as np\n\ny_real = np.array([1, 0, 1, 1, 0, 0, 1, 0, 0, 0])\ny_pred = np.array([1, 0, 0, 1, 0, 1, 1, 0, 0, 0])\n\nvp = fp = fn = vn = precision = recall = None\n',
        check: all(variable('(int(vp), int(fp), int(fn), int(vn))', '(3, 1, 1, 5)'), truthy('abs(precision - 0.75) < 1e-9'), truthy('abs(recall - 0.75) < 1e-9')),
        solution: 'import numpy as np\n\ny_real = np.array([1, 0, 1, 1, 0, 0, 1, 0, 0, 0])\ny_pred = np.array([1, 0, 0, 1, 0, 1, 1, 0, 0, 0])\n\nvp = ((y_real == 1) & (y_pred == 1)).sum()\nfp = ((y_real == 0) & (y_pred == 1)).sum()\nfn = ((y_real == 1) & (y_pred == 0)).sum()\nvn = ((y_real == 0) & (y_pred == 0)).sum()\nprecision = vp / (vp + fp)\nrecall = vp / (vp + fn)',
        hints: ['Combina dos máscaras con `&`: `(y_real == 1) & (y_pred == 1)` marca los verdaderos positivos.', '`.sum()` cuenta los `True`.'],
        explain: 'Las cuatro casillas suman el total (3 + 1 + 1 + 5 = 10). Precisión = VP/(VP+FP) y recall = VP/(VP+FN) usan columnas y filas distintas de la matriz.',
        commands: ['confusion_matrix', 'precision_score'],
      }),
      pyPractice({
        goal: 'Desenmascara el modelo perezoso',
        prompt: 'Con el conjunto desequilibrado, entrena un `DummyClassifier(strategy="most_frequent")` con `(Xtr, ytr)` y guarda en `exactitud_base` su exactitud y en `recall_base` su recall (usa `zero_division=0`) sobre la **prueba**.',
        starter: `from sklearn.dummy import DummyClassifier\nfrom sklearn.metrics import accuracy_score, recall_score\n${IMB}\nexactitud_base = recall_base = None\n`,
        check: all(truthy('abs(exactitud_base - 0.95) < 1e-9'), truthy('abs(recall_base - 0.0) < 1e-9')),
        solution: `from sklearn.dummy import DummyClassifier\nfrom sklearn.metrics import accuracy_score, recall_score\n${IMB}\np = DummyClassifier(strategy="most_frequent").fit(Xtr, ytr).predict(Xte)\nexactitud_base = accuracy_score(yte, p)\nrecall_base = recall_score(yte, p, zero_division=0)`,
        hints: ['`DummyClassifier(strategy="most_frequent").fit(Xtr, ytr).predict(Xte)`.', '`recall_score(yte, p, zero_division=0)`.'],
        explain: '95 % de exactitud y 0 % de recall. Cualquier modelo que quiera ser útil tiene que superar la línea base en las métricas que importan, no solo en la exactitud.',
        commands: ['clases desequilibradas', 'accuracy'],
      }),
      pyPractice({
        goal: 'Da más peso a la clase rara',
        prompt: 'Entrena `make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced"))` con `(Xtr, ytr)` y guarda en `recall` y `precision` sus métricas sobre la prueba. Debería encontrar muchos más positivos que el modelo normal, a costa de más falsas alarmas.',
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import precision_score, recall_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nrecall = precision = None\n`,
        check: all(truthy('abs(recall - 0.7333) < 0.001'), truthy('abs(precision - 0.1833) < 0.001')),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import precision_score, recall_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nm = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced")).fit(Xtr, ytr)\np = m.predict(Xte)\nrecall = recall_score(yte, p)\nprecision = precision_score(yte, p)`,
        hints: ['`class_weight="balanced"` da a cada clase un peso inversamente proporcional a su frecuencia.', 'Calcula `recall_score` y `precision_score` con `yte` y las predicciones.'],
        explain: 'El recall pasa de 0.33 a 0.73 (se encuentran 11 de 15 positivos), pero la precisión cae a 0.18: 49 falsas alarmas. Es el tira y afloja; el umbral o los pesos lo deciden según el coste de cada error.',
        commands: ['clases desequilibradas', 'precision_score'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia6-2', { title: 'Curvas ROC y umbrales', summary: 'Evaluar sin fijar el umbral: ROC, AUC y elegir el punto de trabajo', emoji: '📉', commands: ['roc_auc_score', 'predict_proba', 'precision_score'], minutes: 13 }, [
      learn(
        'Todos los umbrales a la vez',
        `
La mayoría de clasificadores producen una **puntuación** (una probabilidad) y luego se compara con un umbral. La matriz y sus métricas dependen de ese umbral. ¿Cómo comparar dos modelos sin elegir uno?

La **curva ROC** recorre todos los umbrales posibles y dibuja, para cada uno, dos tasas:

- **TPR** (tasa de verdaderos positivos = recall): eje vertical.
- **FPR** (tasa de falsos positivos = FP / (FP + VN)): eje horizontal.

Un modelo que adivina al azar dibuja la diagonal. Un modelo perfecto pasa por la esquina superior izquierda. El **AUC** (área bajo la curva) lo resume en un número: **0.5 = azar, 1 = perfecto**. Significa: *la probabilidad de que el modelo dé más puntuación a un positivo elegido al azar que a un negativo elegido al azar*.
`,
        '📉',
      ),
      illus('ia-roc', 'La curva ROC', 'Separa más las dos clases y mira cómo la curva se acerca a la esquina. El punto verde es el umbral elegido.'),
      mc('Un modelo tiene AUC = 0.5. ¿Qué significa?', ['Acierta el 50 % de las veces siempre', 'No distingue mejor que el azar entre positivos y negativos', 'Es perfecto', 'Tiene 50 variables'], 1, 'AUC 0.5 corresponde a la diagonal de la ROC: las puntuaciones de los positivos y las de los negativos están igual de mezcladas que lanzando una moneda.'),
      pyDemo(
        'AUC y umbrales con scikit-learn',
        [
          [`${IMB}from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import average_precision_score, precision_score, recall_score, roc_auc_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nm = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nproba = m.predict_proba(Xte)[:, 1]\nprint(round(roc_auc_score(yte, proba), 3), round(average_precision_score(yte, proba), 3))`, 'AUC = 0.885: buena separación. La precisión promedio (área bajo la curva precisión-recall) es más exigente con clases raras: 0.576'],
          ['for umbral in [0.5, 0.3, 0.2, 0.1]:\n    marcado = proba >= umbral\n    print(umbral, marcado.sum(), round(precision_score(yte, marcado), 2), round(recall_score(yte, marcado), 2))', 'Al bajar el umbral se marcan más casos (5 → 35), el recall sube (0.33 → 0.67) y la precisión cae (1.0 → 0.29)'],
        ],
      ),
      learn(
        'Elegir el punto de trabajo',
        `
El AUC compara modelos; pero al desplegar uno hay que **fijar un umbral**. Se elige según el negocio:

- *Quiero encontrar al menos el 80 % de los fraudes* ⇒ el umbral más alto que dé recall ≥ 0.8 (y así la precisión más alta posible).
- *Cada revisión manual cuesta 5 € y un fraude no detectado, 500 €* ⇒ el umbral que minimiza el coste total esperado.

Con clases muy raras, la **curva precisión-recall** es más informativa que la ROC (la ROC puede parecer buena aunque la precisión sea ridícula). \`average_precision_score\` resume esa curva.
`,
        '🎛️',
      ),
      tf('El AUC depende del umbral que elijas al desplegar el modelo.', false, 'El AUC se calcula con todos los umbrales a la vez; por eso sirve para comparar modelos independientemente de cuál se elija luego.'),
      fill('Completa para calcular el AUC de las probabilidades de la clase positiva.', 'auc = roc_auc_score(y_real, modelo.___(X)[:, 1])', ['predict_proba', 'predict', 'score', 'decision'], ['predict_proba'], 'El AUC necesita puntuaciones o probabilidades, no las etiquetas duras de `predict`.'),
      pyPractice({
        goal: 'Calcula el AUC',
        prompt: 'Con el modelo ya entrenado, guarda en `auc` el AUC (`roc_auc_score`) de las probabilidades de la clase positiva sobre la prueba.',
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import roc_auc_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nm = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nauc = None\n`,
        check: truthy('abs(auc - 0.885) < 0.01'),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import roc_auc_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nm = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nauc = roc_auc_score(yte, m.predict_proba(Xte)[:, 1])`,
        hints: ['`m.predict_proba(Xte)[:, 1]` da la probabilidad de la clase positiva.', '`roc_auc_score(yte, esas_probabilidades)`.'],
        explain: 'AUC ≈ 0.88: si eliges un positivo y un negativo al azar, el modelo puntúa más alto al positivo el 88 % de las veces.',
        commands: ['roc_auc_score', 'predict_proba'],
      }),
      pyPractice({
        goal: 'Elige un umbral con una exigencia de recall',
        prompt: 'Recorre los umbrales `[0.5, 0.3, 0.2, 0.1]` (en ese orden) y guarda en `umbral` el **primero** cuyo recall sea al menos `0.6`, y en `precision_u` la precisión que se obtiene con él.',
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import precision_score, recall_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nproba = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr).predict_proba(Xte)[:, 1]\numbral = precision_u = None\n`,
        check: all(truthy('abs(umbral - 0.1) < 1e-9'), truthy('abs(precision_u - 0.286) < 0.02')),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import precision_score, recall_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nproba = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr).predict_proba(Xte)[:, 1]\numbral = precision_u = None\nfor u in [0.5, 0.3, 0.2, 0.1]:\n    marcado = proba >= u\n    if recall_score(yte, marcado) >= 0.6:\n        umbral = u\n        precision_u = precision_score(yte, marcado)\n        break`,
        hints: ['Recorre la lista con un `for` y usa `break` al encontrar el primero.', 'Con `marcado = proba >= u`, calcula `recall_score(yte, marcado)`.'],
        explain: 'Para encontrar al menos el 60 % de los positivos hay que bajar el umbral a 0.1, y entonces solo el 29 % de las alertas son reales. El umbral convierte una exigencia de negocio en un número.',
        commands: ['precision_score', 'predict_proba'],
      }),
      pyPractice({
        goal: 'Compara dos modelos por AUC',
        prompt: 'Guarda en `auc_lr` el AUC de la regresión logística (pipeline con escalado) y en `auc_rf` el de un `RandomForestClassifier(n_estimators=100, random_state=0)` sobre la prueba, y en `mejor` el nombre (`"logistica"` o `"bosque"`) del que tenga mayor AUC.',
        starter: `from sklearn.ensemble import RandomForestClassifier\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import roc_auc_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nauc_lr = auc_rf = mejor = None\n`,
        check: all(truthy('abs(auc_lr - 0.885) < 0.01'), truthy('abs(auc_rf - 0.997) < 0.01'), variable('mejor', "'bosque'")),
        solution: `from sklearn.ensemble import RandomForestClassifier\nfrom sklearn.linear_model import LogisticRegression\nfrom sklearn.metrics import roc_auc_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${IMB}\nlr = make_pipeline(StandardScaler(), LogisticRegression()).fit(Xtr, ytr)\nrf = RandomForestClassifier(n_estimators=100, random_state=0).fit(Xtr, ytr)\nauc_lr = roc_auc_score(yte, lr.predict_proba(Xte)[:, 1])\nauc_rf = roc_auc_score(yte, rf.predict_proba(Xte)[:, 1])\nmejor = "bosque" if auc_rf > auc_lr else "logistica"`,
        hints: ['Entrena los dos modelos con `(Xtr, ytr)` y pide `predict_proba(Xte)[:, 1]` a cada uno.', 'Compara los dos AUC.'],
        explain: 'El bosque capta relaciones no lineales entre las variables que la regresión logística no puede: AUC 0.997 frente a 0.885. Comparar con una métrica independiente del umbral lo deja claro.',
        commands: ['roc_auc_score', 'ensemble'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia6-3', { title: 'Validación cruzada', summary: 'K-fold: puntuar con todos los datos y medir la incertidumbre', emoji: '🔁', commands: ['cross_val_score', 'StratifiedKFold', 'make_pipeline'], minutes: 13 }, [
      learn(
        'Un solo reparto es una sola tirada de dado',
        `
Con una única división entrenamiento/prueba, el resultado depende de **qué filas caen en la prueba**. Con 20 clientes de prueba, un solo cliente cambia la exactitud un 5 %. Estás midiendo una suerte, no el modelo.

La **validación cruzada de k bloques (*k-fold*)** lo arregla:

1. Reparte los datos en **k bloques** del mismo tamaño.
2. Para cada bloque: entrena con los otros k − 1 y puntúa con ese bloque.
3. Promedia las k puntuaciones (y mira su desviación típica).

Cada fila se usa **una vez como prueba** y k − 1 veces como entrenamiento. Es k veces más costoso, pero la estimación es mucho más fiable. En clasificación se usa la variante **estratificada**, que conserva la proporción de clases en cada bloque.
`,
        '🔁',
      ),
      illus('ia-kfold', 'Los bloques de la validación cruzada', 'Cambia el número de bloques y avanza de ronda: el bloque ámbar es el que se usa como prueba.'),
      mc('Con validación cruzada de 5 bloques sobre 100 filas, ¿cuántas filas hay en el conjunto de **entrenamiento** de cada ronda?', ['20', '50', '80', '100'], 2, 'En cada ronda se reserva 1 bloque de 20 filas para probar y se entrena con los 4 restantes: 80.'),
      pyDemo(
        'Cinco puntuaciones en vez de una',
        [
          [`${CARGA}from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\npuntos = cross_val_score(modelo, X, y, cv=5)\nprint(puntos)\nprint(round(puntos.mean(), 3), round(puntos.std(), 3))`, 'Cinco exactitudes entre 0.75 y 0.875: media 0.8125 con desviación 0.04. Ya sabes que no debes fiarte de décimas'],
        ],
        FILES,
      ),
      learn(
        'Pipelines dentro de la validación cruzada',
        `
Hay una regla de oro: **todo lo que "aprende" de los datos** (escalar, imputar, seleccionar variables…) debe ajustarse *dentro de cada ronda* solo con el bloque de entrenamiento. Si escalas con todos los datos antes de la validación cruzada, la media y la desviación ya "han visto" los bloques de prueba: es **fuga de datos**.

La solución es pasar a \`cross_val_score\` el **pipeline completo**: así, en cada ronda, el escalador se ajusta únicamente con las filas de entrenamiento de esa ronda.
`,
        '🚰',
      ),
      tf('Para evitar fugas de datos, hay que escalar las variables **antes** de la validación cruzada con todos los datos.', false, 'Al revés: hay que escalar dentro de cada ronda, solo con el entrenamiento de esa ronda. Un `make_pipeline(StandardScaler(), modelo)` pasado a `cross_val_score` lo hace correctamente.'),
      pyDemo(
        'Estratificar y mezclar',
        [
          [`${CARGA}from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import KFold, StratifiedKFold, cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nnormal = cross_val_score(modelo, X, y, cv=KFold(5, shuffle=True, random_state=0))\nestrat = cross_val_score(modelo, X, y, cv=StratifiedKFold(5, shuffle=True, random_state=0))\nprint(normal.round(3), round(normal.mean(), 3))\nprint(estrat.round(3), round(estrat.mean(), 3))`, 'Con 80 filas cada bloque tiene 16: los resultados cambian mucho según el reparto (0.44–0.94 sin estratificar). Estratificar los estabiliza y evita bloques con casi una sola clase'],
        ],
        FILES,
      ),
      order('Ordena el proceso de validación cruzada:', ['dividir', 'en', 'bloques', 'entrenar', 'con', 'k-1', 'puntuar', 'el', 'restante', 'y', 'promediar'], 'dividir en bloques entrenar con k-1 puntuar el restante y promediar', 'Se repite para cada bloque, y al final se promedian las puntuaciones.'),
      multi('¿Cuándo **no** debes mezclar (`shuffle=True`) los datos antes de partirlos?', ['Cuando son una serie temporal y el futuro no puede entrenar el pasado', 'Cuando las filas son independientes', 'Cuando varias filas pertenecen al mismo paciente o cliente', 'Cuando hay pocas filas'], [0, 2], 'En series temporales hay que respetar el orden (`TimeSeriesSplit`); con filas agrupadas hay que mantener juntas las del mismo grupo (`GroupKFold`) para no repartir "copias" entre entrenamiento y prueba.'),
      pyPractice({
        goal: 'Media y desviación',
        prompt: 'Calcula con `cross_val_score` (5 bloques) las puntuaciones del `modelo` (pipeline con escalado + regresión logística) y guarda en `media` y `desviacion` su media y su desviación típica.',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nmedia = desviacion = None\n`,
        check: all(truthy('abs(media - 0.8125) < 1e-9'), truthy('abs(desviacion - 0.03953) < 0.001')),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\npuntos = cross_val_score(modelo, X, y, cv=5)\nmedia = puntos.mean()\ndesviacion = puntos.std()`,
        hints: ['`cross_val_score(modelo, X, y, cv=5)` devuelve un array de cinco puntuaciones.', '`.mean()` y `.std()` resumen el array.'],
        explain: '0.81 ± 0.04: la exactitud verdadera podría estar razonablemente entre 0.77 y 0.85. Esa incertidumbre es lo que oculta una única división.',
        commands: ['cross_val_score'],
      }),
      pyPractice({
        goal: 'Estratifica y mezcla',
        prompt: 'Repite la validación con un `StratifiedKFold(5, shuffle=True, random_state=0)` y guarda en `media_est` la media de sus puntuaciones.',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import StratifiedKFold, cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nmedia_est = None\n`,
        check: truthy('abs(media_est - 0.8625) < 1e-9'),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import StratifiedKFold, cross_val_score\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\ncv = StratifiedKFold(5, shuffle=True, random_state=0)\nmedia_est = cross_val_score(modelo, X, y, cv=cv).mean()`,
        hints: ['Crea el objeto `StratifiedKFold(5, shuffle=True, random_state=0)`.', 'Pásalo como `cv=` a `cross_val_score`.'],
        explain: 'Otro reparto da 0.86 en vez de 0.81: la diferencia (≈ 0.05) es del orden de la desviación típica. Con tan pocos datos no se pueden distinguir esas cifras.',
        commands: ['StratifiedKFold', 'cross_val_score'],
      }),
      pyPractice({
        goal: 'Varias métricas a la vez',
        prompt: 'Con `cross_validate(modelo, X, y, cv=5, scoring=["accuracy", "recall"])` guarda en `recall_medio` la media de `resultado["test_recall"]` y en `acc_medio` la de `resultado["test_accuracy"]`.',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import cross_validate\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nrecall_medio = acc_medio = None\n`,
        check: all(truthy('abs(recall_medio - 0.7) < 1e-9'), truthy('abs(acc_medio - 0.8125) < 1e-9')),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import cross_validate\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nresultado = cross_validate(modelo, X, y, cv=5, scoring=["accuracy", "recall"])\nrecall_medio = resultado["test_recall"].mean()\nacc_medio = resultado["test_accuracy"].mean()`,
        hints: ['`cross_validate` devuelve un diccionario con claves `test_<métrica>`.', '`resultado["test_recall"].mean()`.'],
        explain: 'El modelo acierta el 81 % de los casos pero encuentra solo el 70 % de las bajas reales: mirar las dos métricas cuenta una historia más completa.',
        commands: ['cross_val_score', 'precision_score'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia6-4', { title: 'Sesgo, varianza y curvas', summary: 'Diagnosticar infraajuste y sobreajuste con curvas de validación y aprendizaje', emoji: '📊', commands: ['sesgo y varianza', 'learning_curve', 'sobreajuste', 'cross_val_score'], minutes: 14 }, [
      learn(
        'Los dos enemigos: sesgo y varianza',
        `
El error de un modelo en datos nuevos tiene tres componentes:

- **Sesgo**: el error por ser **demasiado simple** para la realidad (una recta para una curva). Falla incluso con los datos de entrenamiento → **infraajuste**.
- **Varianza**: el error por ser **demasiado sensible** a los datos concretos con que se entrenó. Cambia mucho si cambias unas filas → **sobreajuste**.
- **Ruido irreducible**: lo que ningún modelo puede predecir.

Al aumentar la complejidad baja el sesgo y sube la varianza. El error de prueba dibuja una **U**: hay un punto óptimo. Más datos reducen la varianza (no el sesgo).
`,
        '⚖️',
      ),
      illus('ia-bias-variance', 'El valle del error', 'Mueve la complejidad y compara 30 con 300 datos. ¿Dónde está el mínimo de la curva de prueba?'),
      mc('El error de **entrenamiento** es alto y el de **prueba** también (y parecidos). ¿Qué diagnóstico es más probable?', ['Sobreajuste (varianza alta)', 'Infraajuste (sesgo alto)', 'Fuga de datos', 'El modelo es perfecto'], 1, 'Si falla ya con los datos que ha visto, el modelo es demasiado simple: hace falta más complejidad o mejores variables, no más datos.'),
      learn(
        'Curvas de validación',
        `
Una **curva de validación** muestra la puntuación de entrenamiento y la de validación (con validación cruzada) al variar **un hiperparámetro** (profundidad de un árbol, \`k\` en KNN, \`C\` en una SVM). Se lee así:

- Las dos bajas y juntas → infraajuste.
- Entrenamiento muy alto y validación mucho menor → sobreajuste.
- Se elige el valor donde la **validación** es máxima.

\`validation_curve(modelo, X, y, param_name="max_depth", param_range=[1, 2, 3, 4, 6, 8], cv=5)\` devuelve dos matrices (hiperparámetros × bloques).
`,
        '📈',
      ),
      pyDemo(
        'Profundidad del árbol',
        [
          [`${CARGA}from sklearn.model_selection import validation_curve\nfrom sklearn.tree import DecisionTreeClassifier\n\nprofundidades = [1, 2, 3, 4, 6, 8]\ntrain, val = validation_curve(DecisionTreeClassifier(random_state=0), X, y, param_name="max_depth", param_range=profundidades, cv=5)\nfor d, a, b in zip(profundidades, train.mean(axis=1), val.mean(axis=1)):\n    print(d, round(a, 3), round(b, 3))`, 'El entrenamiento sube hasta 0.99 al crecer el árbol; la validación sube a 0.75 con profundidad 4 y luego baja: sobreajuste'],
        ],
        FILES,
      ),
      learn(
        'Curvas de aprendizaje',
        `
Una **curva de aprendizaje** muestra cómo evolucionan la puntuación de entrenamiento y de validación al **aumentar el número de datos** de entrenamiento. Sirve para decidir en qué invertir:

- **Dos curvas que convergen en un valor bajo**: sesgo alto. Conseguir más datos no ayudará; necesitas un modelo más flexible o mejores variables.
- **Una brecha grande entre ambas** que se estrecha al añadir datos: varianza alta. **Más datos** (o regularizar, o simplificar) ayudará.

\`learning_curve(modelo, X, y, cv=5, train_sizes=[0.3, 0.6, 1.0])\` devuelve los tamaños y las matrices de puntuaciones.
`,
        '📚',
      ),
      pyDemo(
        'Cuánto ayudan más datos',
        [
          [`${CARGA}from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import learning_curve\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\ntamanos, train, val = learning_curve(modelo, X, y, cv=5, train_sizes=[0.3, 0.6, 1.0])\nprint(tamanos)\nprint(train.mean(axis=1).round(3))\nprint(val.mean(axis=1).round(3))`, 'Las dos curvas están cerca (≈ 0.83 y 0.81) y planas: una regresión logística ya no aprende más con más clientes (sesgo moderado)'],
        ],
        FILES,
      ),
      multi('¿Qué remedios ayudan cuando hay **sobreajuste** (varianza alta)?', ['Conseguir más datos', 'Regularizar o simplificar el modelo', 'Añadir más capas / más complejidad', 'Eliminar variables ruidosas'], [0, 1, 3], 'Más complejidad empeora el sobreajuste. Los demás reducen la varianza: más datos, un modelo más simple o regularizado, y menos variables ruidosas.'),
      tf('Si las curvas de entrenamiento y validación son bajas y casi iguales, conseguir 10 veces más datos resolverá el problema.', false, 'Eso es sesgo alto: el modelo no tiene capacidad. Más datos no la crean; hay que cambiar de modelo o de variables.'),
      pyPractice({
        goal: 'Elige la profundidad óptima',
        prompt: 'Calcula con `validation_curve` (5 bloques) la puntuación media de validación de cada profundidad en `profundidades` y guarda en `mejor_prof` la profundidad con la media más alta.',
        setup: FILES,
        starter: `from sklearn.model_selection import validation_curve\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\nprofundidades = [1, 2, 3, 4, 6, 8]\nmejor_prof = None\n`,
        check: variable('int(mejor_prof)', '4'),
        solution: `from sklearn.model_selection import validation_curve\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\nprofundidades = [1, 2, 3, 4, 6, 8]\ntrain, val = validation_curve(DecisionTreeClassifier(random_state=0), X, y, param_name="max_depth", param_range=profundidades, cv=5)\nmejor_prof = profundidades[int(val.mean(axis=1).argmax())]`,
        hints: ['`validation_curve(..., param_name="max_depth", param_range=profundidades, cv=5)` devuelve `(train, val)`.', '`val.mean(axis=1).argmax()` es la posición del mejor valor.'],
        explain: 'La profundidad 4 da la mejor validación (0.75). Más profundidad no aporta nada en validación aunque en entrenamiento llegue al 99 %.',
        commands: ['sesgo y varianza', 'cross_val_score'],
      }),
      pyPractice({
        goal: 'Mide la brecha',
        prompt: 'Con `learning_curve` y los tamaños `[0.3, 0.6, 1.0]`, guarda en `brecha` la diferencia entre la puntuación media de **entrenamiento** y la de **validación** con el tamaño mayor (la última fila).',
        setup: FILES,
        starter: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import learning_curve\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\nbrecha = None\n`,
        check: truthy('abs(brecha - 0.0313) < 0.01'),
        solution: `from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import learning_curve\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmodelo = make_pipeline(StandardScaler(), LogisticRegression())\ntamanos, train, val = learning_curve(modelo, X, y, cv=5, train_sizes=[0.3, 0.6, 1.0])\nbrecha = train.mean(axis=1)[-1] - val.mean(axis=1)[-1]`,
        hints: ['`learning_curve(...)` devuelve `(tamanos, train, val)`.', 'Promedia por bloques con `.mean(axis=1)` y toma `[-1]`.'],
        explain: 'Una brecha del 3 % es pequeña: no hay sobreajuste. Si fuera del 30 % (como el árbol sin límite) sí.',
        commands: ['learning_curve', 'sobreajuste'],
      }),
      pyPractice({
        goal: 'Diagnóstico automático',
        prompt: 'Para un árbol sin límite de profundidad (`DecisionTreeClassifier(random_state=0)`), calcula con `validation_curve` o `cross_validate` las medias de entrenamiento y validación (`cv=5`, `return_train_score=True`) y guarda en `diagnostico` el texto `"varianza alta"` si la brecha supera 0.15 y `"normal"` en otro caso.',
        setup: FILES,
        starter: `from sklearn.model_selection import cross_validate\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\ndiagnostico = None\n`,
        check: variable('diagnostico', "'varianza alta'"),
        solution: `from sklearn.model_selection import cross_validate\nfrom sklearn.tree import DecisionTreeClassifier\n${CARGA}\nr = cross_validate(DecisionTreeClassifier(random_state=0), X, y, cv=5, return_train_score=True)\nbrecha = r["train_score"].mean() - r["test_score"].mean()\ndiagnostico = "varianza alta" if brecha > 0.15 else "normal"`,
        hints: ['`cross_validate(..., return_train_score=True)` incluye la clave `train_score`.', 'La brecha es `train_score.mean() - test_score.mean()`.'],
        explain: 'Un árbol sin freno obtiene 1.0 en entrenamiento y ≈ 0.69 en validación: una brecha de más de 0.3. Es el sobreajuste "de libro".',
        commands: ['sesgo y varianza', 'sobreajuste'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia6-5', { title: 'Buscar hiperparámetros', summary: 'Rejilla y búsqueda aleatoria con validación cruzada, sin hacer trampas', emoji: '🔎', commands: ['GridSearchCV', 'RandomizedSearchCV', 'make_pipeline', 'cross_val_score'], minutes: 14 }, [
      learn(
        'Los botones del modelo',
        `
Los **parámetros** de un modelo (los pesos) los aprende el entrenamiento. Los **hiperparámetros** (la profundidad de un árbol, \`C\` y \`gamma\` de una SVM, \`k\` de KNN) los fijas tú *antes* de entrenar. Un buen ajuste puede mejorar mucho el rendimiento.

**\`GridSearchCV\`** automatiza la búsqueda: le das una **rejilla** de valores, prueba **todas las combinaciones** con validación cruzada y se queda con la mejor, reentrenándola con todos los datos de entrenamiento.

En un pipeline los parámetros se nombran \`paso__parametro\` (por ejemplo \`svc__C\`).
`,
        '🔎',
      ),
      illus('ia-search', 'Rejilla contra aleatoria', 'Con el mismo número de pruebas, ¿quién se acerca más a la zona verde? Cambia el presupuesto para comprobarlo.'),
      mc('Quieres probar 5 valores de `C` y 4 de `gamma`, con validación cruzada de 5 bloques. ¿Cuántos entrenamientos hará `GridSearchCV`?', ['9', '20', '45', '100'], 3, '5 × 4 = 20 combinaciones y 5 bloques cada una: 100 entrenamientos. El coste crece multiplicando las opciones.'),
      pyDemo(
        'Una rejilla para la SVM',
        [
          [`${DIV}from sklearn.model_selection import GridSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n\npipe = make_pipeline(StandardScaler(), SVC())\nrejilla = {"svc__C": [0.1, 1, 10, 100], "svc__gamma": [0.01, 0.1, 1]}\nbusqueda = GridSearchCV(pipe, rejilla, cv=5).fit(Xtr, ytr)\nprint(busqueda.best_params_)\nprint(round(busqueda.best_score_, 3), round(busqueda.score(Xte, yte), 3))`, 'Mejor combinación: C = 10 y gamma = 0.1. Validación cruzada 0.817; en la prueba (que no se tocó) 0.85'],
          ['import pandas as pd\nr = pd.DataFrame(busqueda.cv_results_)\nprint(r[["param_svc__C", "param_svc__gamma", "mean_test_score", "rank_test_score"]].sort_values("rank_test_score").head(4))', '`cv_results_` guarda cada combinación con su puntuación media y su posición'],
        ],
        FILES,
      ),
      learn(
        'La regla de oro: la prueba se toca una sola vez',
        `
La búsqueda ya usa los datos de entrenamiento muchas veces (todas las combinaciones, todos los bloques). Por eso \`best_score_\` es una estimación **optimista**: de entre muchas combinaciones elegiste la que mejor salió, en parte por suerte.

La puntuación **honesta** es la del conjunto de prueba, que **no se ha utilizado en la búsqueda**, evaluado **una sola vez al final**. Si afinas hiperparámetros mirando la prueba, la conviertes en entrenamiento y pierdes tu único árbitro imparcial.

Flujo correcto: dividir → buscar con validación cruzada **solo con el entrenamiento** → evaluar el mejor modelo **una vez** con la prueba.
`,
        '⚖️',
      ),
      tf('Es correcto probar varios valores de hiperparámetros directamente sobre el conjunto de prueba y quedarse con el mejor.', false, 'Así la prueba deja de ser independiente: la estás usando para tomar decisiones. Para eso están la validación cruzada y, si hace falta, un tercer conjunto de validación.'),
      learn(
        'Búsqueda aleatoria',
        `
Cuando hay muchos hiperparámetros, la rejilla se vuelve carísima y además **repite los mismos pocos valores** de cada parámetro. Normalmente solo unos pocos parámetros importan de verdad. **\`RandomizedSearchCV\`** prueba \`n_iter\` combinaciones **al azar**, tomando un valor distinto de cada parámetro en cada intento; con el mismo presupuesto explora más variedad de los parámetros importantes.

Para parámetros que varían en órdenes de magnitud (\`C\`, \`gamma\`) se muestrea en **escala logarítmica**: \`scipy.stats.loguniform(0.01, 100)\`.
`,
        '🎲',
      ),
      pyDemo(
        'Búsqueda aleatoria con loguniform',
        [
          [`${DIV}from scipy.stats import loguniform\nfrom sklearn.model_selection import RandomizedSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n\npipe = make_pipeline(StandardScaler(), SVC())\ndist = {"svc__C": loguniform(0.01, 100), "svc__gamma": loguniform(0.001, 10)}\nb = RandomizedSearchCV(pipe, dist, n_iter=12, cv=5, random_state=0).fit(Xtr, ytr)\nprint({k: round(float(v), 3) for k, v in b.best_params_.items()})\nprint(round(b.best_score_, 3), round(b.score(Xte, yte), 3))`, '12 combinaciones al azar encuentran C ≈ 14.7 y gamma ≈ 0.13 con 0.833 de validación; en la prueba, 0.80'],
        ],
        FILES,
      ),
      fill('Completa para que el parámetro `C` de la SVM de un pipeline se busque en una rejilla.', 'rejilla = {"___": [0.1, 1, 10]}', ['svc__C', 'C', 'SVC.C', 'svc.C'], ['svc__C'], 'En un pipeline el nombre es `<paso>__<parámetro>`: aquí el paso se llama `svc` y el parámetro `C`.'),
      match('Une cada concepto con su descripción:', [['best_params_', 'La combinación de hiperparámetros ganadora'], ['best_score_', 'Su puntuación media en validación cruzada'], ['cv_results_', 'Todas las combinaciones con sus puntuaciones y su ranking'], ['best_estimator_', 'El modelo ya reentrenado con la mejor combinación']], 'Después de `fit`, `GridSearchCV` se comporta como el mejor modelo: se puede llamar a `predict` y `score` directamente.'),
      pyPractice({
        goal: 'Tu primera búsqueda en rejilla',
        prompt: 'Haz una `GridSearchCV` con el `pipe` (`StandardScaler` + `SVC`), la rejilla de `svc__C` = `[0.1, 1, 10, 100]` y `svc__gamma` = `[0.01, 0.1, 1]`, y `cv=5`, sobre `(Xtr, ytr)`. Guarda en `mejor_C` y `mejor_gamma` los valores ganadores y en `acc_test` la exactitud del mejor modelo en la **prueba**.',
        setup: FILES,
        starter: `from sklearn.model_selection import GridSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\npipe = make_pipeline(StandardScaler(), SVC())\nmejor_C = mejor_gamma = acc_test = None\n`,
        check: all(truthy('abs(mejor_C - 10) < 1e-9'), truthy('abs(mejor_gamma - 0.1) < 1e-9'), truthy('abs(acc_test - 0.85) < 1e-9')),
        solution: `from sklearn.model_selection import GridSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\npipe = make_pipeline(StandardScaler(), SVC())\nrejilla = {"svc__C": [0.1, 1, 10, 100], "svc__gamma": [0.01, 0.1, 1]}\nbusqueda = GridSearchCV(pipe, rejilla, cv=5).fit(Xtr, ytr)\nmejor_C = busqueda.best_params_["svc__C"]\nmejor_gamma = busqueda.best_params_["svc__gamma"]\nacc_test = busqueda.score(Xte, yte)`,
        hints: ['El diccionario de la rejilla usa claves `"svc__C"` y `"svc__gamma"`.', '`busqueda.best_params_` es un diccionario; `busqueda.score(Xte, yte)` usa el mejor modelo.'],
        explain: 'El mejor modelo se evaluó una sola vez con la prueba: 0.85. El `best_score_` (0.817) viene de la validación cruzada del entrenamiento.',
        commands: ['GridSearchCV', 'make_pipeline'],
      }),
      pyPractice({
        goal: 'Afina un árbol',
        prompt: 'Busca con `GridSearchCV` (5 bloques) los mejores `max_depth` (`[1, 2, 3, 4, 5, 6]`) y `min_samples_leaf` (`[1, 3, 5]`) para un `DecisionTreeClassifier(random_state=0)` con `(Xtr, ytr)`. Guarda en `mejores` el diccionario `best_params_` y en `cv_score` el `best_score_`.',
        setup: FILES,
        starter: `from sklearn.model_selection import GridSearchCV\nfrom sklearn.tree import DecisionTreeClassifier\n${DIV}\nmejores = cv_score = None\n`,
        check: all(variable('mejores', "{'max_depth': 4, 'min_samples_leaf': 1}"), truthy('abs(cv_score - 0.7667) < 0.001')),
        solution: `from sklearn.model_selection import GridSearchCV\nfrom sklearn.tree import DecisionTreeClassifier\n${DIV}\nrejilla = {"max_depth": [1, 2, 3, 4, 5, 6], "min_samples_leaf": [1, 3, 5]}\nb = GridSearchCV(DecisionTreeClassifier(random_state=0), rejilla, cv=5).fit(Xtr, ytr)\nmejores = b.best_params_\ncv_score = b.best_score_`,
        hints: ['Sin pipeline, las claves son los nombres directos: `"max_depth"` y `"min_samples_leaf"`.', '`b.best_params_` y `b.best_score_`.'],
        explain: '18 combinaciones × 5 bloques = 90 árboles entrenados en un instante. Un árbol es barato; con modelos caros hay que ser más selectivo (búsqueda aleatoria).',
        commands: ['GridSearchCV'],
      }),
      pyPractice({
        goal: 'Búsqueda aleatoria',
        prompt: 'Con `RandomizedSearchCV` (`n_iter=12`, `cv=5`, `random_state=0`) sobre el `pipe` y las distribuciones `loguniform` dadas, guarda en `cv_score` su `best_score_` y en `acc_test` la exactitud en la prueba.',
        setup: FILES,
        starter: `from scipy.stats import loguniform\nfrom sklearn.model_selection import RandomizedSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\npipe = make_pipeline(StandardScaler(), SVC())\ndist = {"svc__C": loguniform(0.01, 100), "svc__gamma": loguniform(0.001, 10)}\ncv_score = acc_test = None\n`,
        check: all(truthy('abs(cv_score - 0.8333) < 0.001'), truthy('abs(acc_test - 0.8) < 1e-9')),
        solution: `from scipy.stats import loguniform\nfrom sklearn.model_selection import RandomizedSearchCV\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n${DIV}\npipe = make_pipeline(StandardScaler(), SVC())\ndist = {"svc__C": loguniform(0.01, 100), "svc__gamma": loguniform(0.001, 10)}\nb = RandomizedSearchCV(pipe, dist, n_iter=12, cv=5, random_state=0).fit(Xtr, ytr)\ncv_score = b.best_score_\nacc_test = b.score(Xte, yte)`,
        hints: ['`RandomizedSearchCV(pipe, dist, n_iter=12, cv=5, random_state=0).fit(Xtr, ytr)`.', '`best_score_` y `score(Xte, yte)`.'],
        explain: 'La búsqueda aleatoria sube la validación de 0.817 a 0.833 con solo 12 pruebas, pero en la prueba rinde 0.80 frente a 0.85: con 20 clientes de prueba esas diferencias son ruido. Por eso se reporta siempre con incertidumbre.',
        commands: ['RandomizedSearchCV'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: el informe de rendimiento',
    prompt:
      'Prepara el modelo definitivo de bajas con una evaluación rigurosa.\n\n1. Carga y codifica los datos y divide con `test_size=0.25`, `random_state=0`, `stratify=y`.\n2. Crea el `pipe` (`StandardScaler` + `SVC`) y una `GridSearchCV` (`cv=5`) con `svc__C` en `[0.1, 1, 10, 100]` y `svc__gamma` en `[0.01, 0.1, 1]`, entrenada **solo con el entrenamiento**.\n3. Guarda en `n_combinaciones` cuántas combinaciones probó (`len(busqueda.cv_results_["params"])`) y en `cv_score` su mejor puntuación.\n4. Evalúa el mejor modelo **una vez** con la prueba: `acc_test` y su matriz de confusión `cm` (`confusion_matrix`).\n5. Guarda en `recall` el recall de las bajas en la prueba.',
    setup: FILES,
    starter:
      'import pandas as pd\nfrom sklearn.metrics import confusion_matrix, recall_score\nfrom sklearn.model_selection import GridSearchCV, train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n\ndf = pd.read_csv("bajas.csv")\n\n# 1: variables y división\nX = y = None\nXtr = Xte = ytr = yte = None\n\n# 2 y 3: búsqueda\nbusqueda = None\nn_combinaciones = cv_score = None\n\n# 4 y 5: evaluación final\nacc_test = cm = recall = None\n',
    check: all(variable('int(n_combinaciones)', '12'), truthy('abs(cv_score - 0.8167) < 0.001'), truthy('abs(acc_test - 0.85) < 1e-9'), variable('cm.tolist()', '[[11, 1], [2, 6]]'), truthy('abs(recall - 0.75) < 1e-9')),
    solution:
      'import pandas as pd\nfrom sklearn.metrics import confusion_matrix, recall_score\nfrom sklearn.model_selection import GridSearchCV, train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\nfrom sklearn.svm import SVC\n\ndf = pd.read_csv("bajas.csv")\n\nD = pd.get_dummies(df, columns=["contrato"], dtype=int)\nX = D.drop(columns="baja")\ny = D["baja"]\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\n\npipe = make_pipeline(StandardScaler(), SVC())\nrejilla = {"svc__C": [0.1, 1, 10, 100], "svc__gamma": [0.01, 0.1, 1]}\nbusqueda = GridSearchCV(pipe, rejilla, cv=5).fit(Xtr, ytr)\nn_combinaciones = len(busqueda.cv_results_["params"])\ncv_score = busqueda.best_score_\n\npred = busqueda.predict(Xte)\nacc_test = busqueda.score(Xte, yte)\ncm = confusion_matrix(yte, pred)\nrecall = recall_score(yte, pred)',
    hints: ['`pd.get_dummies(df, columns=["contrato"], dtype=int)` y después `drop(columns="baja")` para `X`.', '`GridSearchCV(pipe, rejilla, cv=5).fit(Xtr, ytr)`: la rejilla tiene 4 × 3 = 12 combinaciones.', 'Después de `fit`, `busqueda.predict(Xte)` y `busqueda.score(Xte, yte)` usan el mejor modelo.'],
    explain: 'Has seguido el flujo riguroso: dividir, afinar solo con el entrenamiento mediante validación cruzada, y usar la prueba una única vez. El modelo acierta el 85 % y encuentra 6 de las 8 bajas reales (recall 0.75), con 1 falsa alarma. Con solo 20 clientes de prueba, estas cifras tienen mucha incertidumbre: así hay que presentarlas.',
    commands: ['GridSearchCV', 'confusion_matrix', 'precision_score'],
  },
});

void [multi];
