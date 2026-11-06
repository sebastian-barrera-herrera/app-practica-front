import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyDemo, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, truthy, variable } from './iabuild';

/** 30 viviendas: superficie (m²), habitaciones, antigüedad (años), distancia al centro (km), zona y precio (miles de €). */
const CASAS = `superficie,habitaciones,antiguedad,distancia,zona,precio
87,2,2,16.2,norte,208
108,2,19,8.6,norte,279
65,2,18,14.0,centro,141
158,5,21,10.5,norte,366
107,3,3,8.5,norte,269
123,3,11,15.9,centro,296
63,3,16,19.1,norte,143
143,4,12,5.9,centro,392
132,4,29,10.9,sur,271
97,4,9,17.5,centro,245
54,2,12,9.7,sur,128
63,1,3,3.1,sur,161
112,3,14,16.2,norte,259
129,2,20,10.5,norte,274
150,5,15,4.7,centro,370
82,2,35,17.6,centro,164
130,3,4,6.1,norte,338
48,2,8,5.5,centro,160
79,1,26,8.1,centro,208
142,4,23,8.3,centro,360
108,2,13,5.4,norte,237
88,2,39,4.3,norte,200
47,1,3,8.6,sur,113
84,3,29,17.0,centro,180
40,2,12,15.9,centro,107
115,3,12,13.2,sur,256
95,3,15,10.4,norte,220
46,1,29,10.0,sur,74
59,2,8,10.0,norte,140
100,2,38,18.9,sur,168
`;

const FILES = { files: { 'casas.csv': CASAS } };

/** Arranque común de las demostraciones (cada demostración empieza en una sesión limpia). */
const PRE = `import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression

df = pd.read_csv("casas.csv")
VARS = ["superficie", "habitaciones", "antiguedad", "distancia"]
X = df[VARS]
y = df["precio"]
`;

/** Carga habitual para las prácticas: la tabla y las cuatro variables numéricas. */
const CARGA = `import numpy as np
import pandas as pd

df = pd.read_csv("casas.csv")
VARS = ["superficie", "habitaciones", "antiguedad", "distancia"]
X = df[VARS]
y = df["precio"]
`;

export const ia4 = iaWorld({
  id: 'ia4',
  index: 4,
  title: 'Regresión',
  subtitle: 'Predecir números: rectas, error, regularización y curvas',
  emoji: '📈',
  color: '#34D399',
  level: 'intermedio',
  intro:
    'La **regresión** es el problema más habitual del aprendizaje supervisado: predecir un **número** (un precio, una temperatura, una demanda). Empezarás con la recta de mínimos cuadrados, la ampliarás a varias variables, aprenderás a **medir** el error con honestidad, a frenar el sobreajuste con **regularización** (Ridge y Lasso) y a ajustar curvas con modelos no lineales. Todo sobre un conjunto real de viviendas.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia4-1', { title: 'La recta que mejor se ajusta', summary: 'Regresión lineal y mínimos cuadrados', emoji: '📏', commands: ['LinearRegression', 'mínimos cuadrados', 'mean_squared_error'], minutes: 13 }, [
      learn(
        'Predecir un número',
        `
Un problema es de **regresión** cuando lo que quieres predecir es una **cantidad**: el precio de una casa, los minutos de retraso de un tren, las ventas de mañana. (Si fuese una *etiqueta* —spam o no spam— sería clasificación.)

El modelo más simple es la **recta**:

\`ŷ = w · x + b\`

- \`x\` es la característica (los m² de la casa).
- \`w\` es la **pendiente**: cuánto sube la predicción por cada unidad de \`x\`.
- \`b\` es la **ordenada**: la predicción cuando \`x = 0\`.
- \`ŷ\` ("y sombrero") es la **predicción**; \`y\` es el valor real.

Entrenar es encontrar los valores de \`w\` y \`b\` que mejor encajan con los datos.
`,
        '📏',
      ),
      mc('¿Cuál de estos problemas es de **regresión**?', ['Decidir si un correo es spam', 'Estimar cuántos litros de agua se consumirán mañana', 'Reconocer si una foto contiene un gato', 'Clasificar clientes en «alto», «medio» o «bajo» riesgo'], 1, 'La salida es una cantidad numérica continua. Los otros tres producen una etiqueta (clasificación).'),
      learn(
        'El error de cada punto',
        `
Una recta nunca pasa por todos los puntos. La diferencia entre lo real y lo predicho es el **residuo**:

\`residuo = y − ŷ\`

Para puntuar una recta hay que resumir todos los residuos en un número. Sumarlos no sirve (los positivos cancelan a los negativos), así que se **elevan al cuadrado** y se promedian: es el **error cuadrático medio (MSE)**.

\`MSE = media( (y − ŷ)² )\`

La recta de **mínimos cuadrados** es la que hace ese MSE lo más pequeño posible. Juega con la ilustración: mueve la recta a mano y comprueba que el botón «Ajuste óptimo» siempre gana.
`,
        '🎯',
      ),
      illus('ia-linreg-fit', 'Mínimos cuadrados', 'Cambia la pendiente y la ordenada: los cuadrados rojos son el error de cada punto. Pulsa «Ajuste óptimo» para ver el mínimo.'),
      mc('Con `w = 2` y `b = 1`, ¿qué predice el modelo para `x = 5`?', ['7', '10', '11', '12'], 2, '`ŷ = 2·5 + 1 = 11`.'),
      learn(
        'LinearRegression en scikit-learn',
        `
No hace falta resolver nada a mano: \`LinearRegression().fit(X, y)\` calcula la recta óptima.

- **\`X\` tiene que ser 2-D** (filas × características), incluso con una sola característica: \`df[["superficie"]]\` (doble corchete) o \`x.reshape(-1, 1)\`.
- Tras \`fit\`, la pendiente está en \`modelo.coef_\` (un valor por característica) y la ordenada en \`modelo.intercept_\`.
- \`modelo.predict(X_nuevo)\` predice, y \`modelo.score(X, y)\` devuelve el **R²**.

Los atributos que terminan en guion bajo (\`coef_\`, \`intercept_\`) son lo que el modelo **ha aprendido**.
`,
        '🧮',
      ),
      pyDemo(
        'Ajustar precio ~ superficie',
        [
          ['import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nX = df[["superficie"]]   # 2-D: doble corchete\ny = df["precio"]\n\nmodelo = LinearRegression().fit(X, y)\nprint(modelo.coef_, modelo.intercept_)', 'Cada m² añade unos 2.4 mil € al precio; la ordenada (−4.8) no tiene interpretación real porque no existen casas de 0 m²'],
          ['print(modelo.predict(pd.DataFrame({"superficie": [100, 150]})))', 'Predicciones para casas de 100 y 150 m²'],
          ['print(round(modelo.score(X, y), 3))', 'R² ≈ 0.91: la superficie por sí sola explica el 91 % de la variación del precio'],
        ],
        FILES,
      ),
      tf('Si `modelo.coef_` vale `[2.41]`, una casa 10 m² más grande cuesta, de media, unos 24 mil € más (todo lo demás igual).', true, 'El coeficiente es el cambio en la predicción por cada unidad de la característica: 10 × 2.41 ≈ 24.'),
      fill('Completa para entrenar el modelo.', 'modelo = LinearRegression().___(X, y)', ['fit', 'predict', 'score', 'transform'], ['fit'], '`fit(X, y)` ajusta los parámetros; después se usa `predict`.'),
      pyPractice({
        goal: 'Ajusta tu primera recta',
        prompt: 'Ajusta una `LinearRegression` de `precio` sobre `superficie` (recuerda la doble corchete) y guarda la pendiente en `pendiente` y la ordenada en `ordenada` (como números, no arrays).',
        setup: FILES,
        starter: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\npendiente = ordenada = None\n',
        check: all(truthy('abs(pendiente - 2.4077) < 0.001'), truthy('abs(ordenada + 4.8185) < 0.001')),
        solution: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nmodelo = LinearRegression().fit(df[["superficie"]], df["precio"])\npendiente = modelo.coef_[0]\nordenada = modelo.intercept_',
        hints: ['`LinearRegression().fit(df[["superficie"]], df["precio"])`.', '`coef_` es un array con un valor por característica: toma el primero con `[0]`.'],
        explain: 'Una recta con 2.41 de pendiente: cada metro cuadrado extra añade unos 2 410 € de media. Ese es el significado práctico de `coef_`.',
        commands: ['LinearRegression'],
      }),
      pyPractice({
        goal: 'Predice una casa de 120 m²',
        prompt: 'El `modelo` ya está entrenado. Guarda en `pred` el precio estimado para una casa de **120 m²** (un número, no un array).',
        setup: FILES,
        starter: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nmodelo = LinearRegression().fit(df[["superficie"]], df["precio"])\npred = None\n',
        check: truthy('abs(pred - 284.10) < 0.05'),
        solution: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nmodelo = LinearRegression().fit(df[["superficie"]], df["precio"])\npred = modelo.predict(pd.DataFrame({"superficie": [120]}))[0]',
        hints: ['`predict` espera la misma forma que `X`: un DataFrame con una columna `superficie`.', '`modelo.predict(pd.DataFrame({"superficie": [120]}))` devuelve un array de un elemento: toma `[0]`.'],
        explain: 'Para predecir hay que dar los datos con las **mismas columnas** con las que se entrenó. El resultado (≈ 284) está en miles de euros.',
        commands: ['LinearRegression'],
      }),
      pyPractice({
        goal: 'Mide el error de la recta',
        prompt: 'Calcula los `residuos` (`y − ŷ`) del modelo sobre los propios datos de entrenamiento y guarda en `mse` su media al cuadrado (el MSE).',
        setup: FILES,
        starter: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nX = df[["superficie"]]\ny = df["precio"]\nmodelo = LinearRegression().fit(X, y)\nresiduos = mse = None\n',
        check: all(truthy('abs(mse - 644.77) < 0.05'), truthy('abs(residuos.sum()) < 1e-6')),
        solution: 'import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nX = df[["superficie"]]\ny = df["precio"]\nmodelo = LinearRegression().fit(X, y)\nresiduos = y - modelo.predict(X)\nmse = (residuos ** 2).mean()',
        hints: ['`residuos = y - modelo.predict(X)`.', '`mse = (residuos ** 2).mean()`.'],
        explain: 'Fíjate en que los residuos de una recta de mínimos cuadrados con ordenada suman **cero**: los errores por arriba y por debajo se compensan exactamente. Por eso se elevan al cuadrado antes de promediar.',
        commands: ['mínimos cuadrados', 'mean_squared_error'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia4-2', { title: 'Varias variables', summary: 'Regresión múltiple, escalado, categorías y curvas', emoji: '🧩', commands: ['LinearRegression', 'StandardScaler', 'pd.get_dummies', 'PolynomialFeatures'], minutes: 14 }, [
      learn(
        'Más características, mejor predicción',
        `
Una casa no vale solo por sus metros. La **regresión lineal múltiple** suma la aportación de cada característica:

\`ŷ = w₁·superficie + w₂·habitaciones + w₃·antigüedad + w₄·distancia + b\`

Cada \`wᵢ\` se lee como **«lo que cambia la predicción al subir esa variable una unidad, manteniendo las demás iguales»**. Es una pregunta muy útil: ¿cuánto vale una habitación *a igual superficie*? ¿cuánto resta cada kilómetro al centro?

El código es idéntico al de una variable: solo cambia que \`X\` tiene varias columnas y \`coef_\` devuelve un peso por columna (en el mismo orden).
`,
        '🧩',
      ),
      pyDemo(
        'Cuatro variables a la vez',
        [
          ['import pandas as pd\nfrom sklearn.linear_model import LinearRegression\n\ndf = pd.read_csv("casas.csv")\nVARS = ["superficie", "habitaciones", "antiguedad", "distancia"]\nX = df[VARS]\ny = df["precio"]\n\nmodelo = LinearRegression().fit(X, y)\nprint(dict(zip(VARS, modelo.coef_.round(2))))\nprint(round(modelo.intercept_, 1))', 'Cada m² suma ~2.2 mil €, cada habitación ~9.3, cada año resta ~1.2 y cada km al centro resta ~2.4'],
          ['casa = pd.DataFrame({"superficie": [100], "habitaciones": [3], "antiguedad": [10], "distancia": [5.0]})\nprint(modelo.predict(casa).round(1))\nprint(round(modelo.score(X, y), 3))', 'Una casa de 100 m², 3 hab., 10 años y a 5 km: unos 260 mil €. R² = 0.958 (mejor que con solo la superficie, 0.91)'],
        ],
        FILES,
      ),
      illus('ia-coef-effect', 'Qué aporta cada variable', 'Cambia las características de la casa y mira cuánto suma o resta cada una al precio.'),
      mc('El coeficiente de `distancia` es −2.4. ¿Qué significa?', ['Las casas lejanas valen 2.4 mil € menos que las céntricas, siempre', 'Con las demás variables iguales, cada km más lejos del centro baja la predicción unos 2.4 mil €', 'La distancia explica el 2.4 % del precio', 'Hay un error de 2.4 mil € por km'], 1, 'Un coeficiente es el efecto de una unidad más de esa variable **con las demás fijas**. El signo negativo indica que el precio baja al alejarse.'),
      learn(
        'Unidades distintas, pesos incomparables',
        `
El peso de las habitaciones (9.3) es mayor que el de la superficie (2.2). ¿Importan más las habitaciones? **No necesariamente**: una habitación es una unidad muy "grande" y un m² muy "pequeña". Los coeficientes dependen de las unidades.

Para comparar la **importancia** de cada variable hay que ponerlas en la misma escala (media 0 y desviación 1) con \`StandardScaler\`. Entonces cada coeficiente significa «cuánto cambia el precio al subir esa variable **una desviación típica**».

Escalar tampoco cambia las predicciones de una regresión lineal: solo la interpretación de los pesos. (Pero será imprescindible para Ridge, Lasso y KNN.)
`,
        '⚖️',
      ),
      pyDemo(
        'Pesos comparables',
        [
          [`${PRE}from sklearn.preprocessing import StandardScaler\n\nXs = StandardScaler().fit_transform(X)\nm2 = LinearRegression().fit(Xs, y)\nprint(dict(zip(VARS, m2.coef_.round(1))))`, 'Ahora sí: la superficie (72.7) domina con diferencia; las habitaciones (10.0) pesan poco una vez descontada la superficie'],
          ['print(round(m2.score(Xs, y), 3))', 'Mismo R² (0.958) que sin escalar: las predicciones no cambian'],
        ],
        FILES,
      ),
      multi('¿Qué afirmaciones sobre escalar con `StandardScaler` son ciertas para una regresión lineal?', ['Cambia las predicciones del modelo', 'Hace comparables los coeficientes entre variables', 'No cambia el R²', 'Es obligatorio, o no se puede hacer `fit`'], [1, 2], 'Escalar no altera las predicciones ni el R² de una regresión lineal sin penalización, pero sí facilita comparar pesos. No es obligatorio para `LinearRegression`.'),
      learn(
        'Categorías: la codificación one-hot',
        `
La columna \`zona\` (norte, centro, sur) es texto: un modelo necesita números. Codificarla como 0, 1, 2 sería un error: le diría al modelo que «sur es el doble que centro». La solución es la **codificación one-hot**: una columna 0/1 por categoría.

\`pd.get_dummies(df, columns=["zona"], dtype=int)\` crea \`zona_centro\`, \`zona_norte\` y \`zona_sur\`. Cada coeficiente es entonces el «extra» de esa zona respecto a las demás.
`,
        '🏷️',
      ),
      pyDemo(
        'Añadir la zona',
        [
          [`${PRE}Xz = pd.get_dummies(df.drop(columns="precio"), columns=["zona"], dtype=int)\nprint(list(Xz.columns))\nm3 = LinearRegression().fit(Xz, y)\nprint(round(m3.score(Xz, y), 3))`, 'R² sube de 0.958 a 0.980: la zona aporta información'],
          ['print(dict(zip(Xz.columns, m3.coef_.round(1))))', 'Las casas del centro cuestan ~18 mil € más que la media y las del sur ~17 mil € menos, con todo lo demás igual'],
        ],
        FILES,
      ),
      tf('Codificar la zona como norte = 0, centro = 1, sur = 2 es equivalente a la codificación one-hot.', false, 'No lo es: introduce un orden y unas distancias que no existen (¿sur = 2 × centro?). Con one-hot cada categoría tiene su propio efecto libre.'),
      learn(
        'Curvas con un modelo lineal',
        `
«Lineal» significa lineal **en los coeficientes**, no en los datos. Si añades columnas como \`x²\` o \`x·y\`, el mismo modelo ajusta curvas:

\`PolynomialFeatures(degree=2)\` genera \`x, x²\` (y los productos cruzados si hay varias variables). Se suele combinar con un escalador y un modelo en un **pipeline**:

\`make_pipeline(PolynomialFeatures(2), LinearRegression())\`

Cuidado: cuanto mayor el grado, más flexible… y más riesgo de sobreajuste.
`,
        '〰️',
      ),
      pyDemo(
        'Una parábola',
        [
          ['import numpy as np\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import PolynomialFeatures\n\nx = np.linspace(-3, 3, 30).reshape(-1, 1)\ny_curva = 2 * x.ravel() ** 2 - 1\n\nrecta = LinearRegression().fit(x, y_curva)\nparabola = make_pipeline(PolynomialFeatures(2), LinearRegression()).fit(x, y_curva)\nprint(round(recta.score(x, y_curva), 3), round(parabola.score(x, y_curva), 3))', 'Una recta no puede captar una parábola (R² ≈ 0); con un término cuadrático el ajuste es perfecto (R² = 1)'],
        ],
        FILES,
      ),
      pyPractice({
        goal: 'Regresión con cuatro variables',
        prompt: 'Entrena una `LinearRegression` con las cuatro variables (`X`) para predecir `y` y guarda en `pesos` el array `coef_`. Debe salir un peso por variable.',
        setup: FILES,
        starter: `from sklearn.linear_model import LinearRegression\n${CARGA}\npesos = None\n`,
        check: all(variable('len(pesos)', '4'), truthy('abs(pesos - np.array([2.166, 9.262, -1.163, -2.355])).max() < 0.01')),
        solution: `from sklearn.linear_model import LinearRegression\n${CARGA}\npesos = LinearRegression().fit(X, y).coef_`,
        hints: ['`LinearRegression().fit(X, y)` entrena con todas las columnas de `X`.', '`.coef_` devuelve el array de pesos.'],
        explain: 'Con varias características `coef_` es un vector con un peso por columna de `X`, **en el mismo orden**.',
        commands: ['LinearRegression'],
      }),
      pyPractice({
        goal: 'Tasa una casa nueva',
        prompt: 'Con el `modelo` ya entrenado, guarda en `precio` la predicción (un número) para una casa de **100 m², 3 habitaciones, 10 años y a 5 km** del centro.',
        setup: FILES,
        starter: `from sklearn.linear_model import LinearRegression\n${CARGA}\nmodelo = LinearRegression().fit(X, y)\nprecio = None\n`,
        check: truthy('abs(precio - 260.33) < 0.1'),
        solution: `from sklearn.linear_model import LinearRegression\n${CARGA}\nmodelo = LinearRegression().fit(X, y)\ncasa = pd.DataFrame({"superficie": [100], "habitaciones": [3], "antiguedad": [10], "distancia": [5.0]})\nprecio = modelo.predict(casa)[0]`,
        hints: ['Crea un DataFrame con **las mismas cuatro columnas** que `X`.', '`modelo.predict(casa)[0]` extrae el número del array de un elemento.'],
        explain: 'El orden y los nombres de las columnas tienen que coincidir con los del entrenamiento: así el modelo aplica cada peso a su variable.',
        commands: ['LinearRegression'],
      }),
      pyPractice({
        goal: '¿Qué variable pesa más?',
        prompt: 'Estandariza `X` con `StandardScaler`, entrena una `LinearRegression` y guarda en `mas_importante` el **nombre** de la variable con mayor coeficiente en valor absoluto.',
        setup: FILES,
        starter: `from sklearn.linear_model import LinearRegression\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nmas_importante = None\n`,
        check: variable('mas_importante', "'superficie'"),
        solution: `from sklearn.linear_model import LinearRegression\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXs = StandardScaler().fit_transform(X)\npesos = LinearRegression().fit(Xs, y).coef_\nmas_importante = VARS[int(np.abs(pesos).argmax())]`,
        hints: ['`StandardScaler().fit_transform(X)` devuelve la matriz escalada.', '`np.abs(pesos).argmax()` es la posición del mayor peso; úsala para elegir el nombre de `VARS`.'],
        explain: 'Con las variables en la misma escala, los pesos sí son comparables: la superficie aporta muchísimo más que cualquier otra.',
        commands: ['StandardScaler', 'LinearRegression'],
      }),
      pyPractice({
        goal: 'Añade la zona al modelo',
        prompt: 'Convierte `zona` a columnas 0/1 (`pd.get_dummies`, `dtype=int`) en `Xz` (sin la columna `precio`), entrena una `LinearRegression` y guarda su R² en `r2`.',
        setup: FILES,
        starter: `from sklearn.linear_model import LinearRegression\n${CARGA}\nXz = r2 = None\n`,
        check: all(truthy('"zona_centro" in Xz.columns and "zona" not in Xz.columns'), truthy('abs(r2 - 0.98) < 0.002')),
        solution: `from sklearn.linear_model import LinearRegression\n${CARGA}\nXz = pd.get_dummies(df.drop(columns="precio"), columns=["zona"], dtype=int)\nr2 = LinearRegression().fit(Xz, y).score(Xz, y)`,
        hints: ['`df.drop(columns="precio")` quita la etiqueta de las características.', '`pd.get_dummies(..., columns=["zona"], dtype=int)` codifica solo esa columna.'],
        explain: 'Tan importante como añadir la zona es **no dejar el precio en `X`**: sería la fuga de datos más burda posible (el modelo copiaría la respuesta).',
        commands: ['pd.get_dummies'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia4-3', { title: 'Medir el error', summary: 'MAE, RMSE, R², datos de prueba y línea base', emoji: '📐', commands: ['mean_squared_error', 'r2_score', 'DummyRegressor', 'baseline'], minutes: 13 }, [
      learn(
        'Cuatro formas de medir un error',
        `
Con los residuos \`eᵢ = yᵢ − ŷᵢ\` se construyen las métricas de regresión:

| Métrica | Fórmula | Se lee como |
|---|---|---|
| **MAE** | media( \`|e|\` ) | el error típico, en las unidades de \`y\` |
| **MSE** | media( \`e²\` ) | error cuadrático (unidades²) |
| **RMSE** | √MSE | como el MAE, pero castiga más los errores grandes |
| **R²** | 1 − Σe² / Σ(y − ȳ)² | fracción de la variación que explica el modelo |

El **R²** compara tu modelo con el más tonto posible, el que siempre predice la media: R² = 1 es perfecto, **R² = 0** es "no mejor que la media" y puede ser **negativo** si lo haces peor.
`,
        '📐',
      ),
      illus('ia-reg-metrics', 'MAE contra RMSE', 'Sube el error del último punto: el RMSE se dispara y el R² cae, mientras que el MAE casi no se inmuta.'),
      mc('Quieres una métrica que **castigue mucho** los fallos grandes (un precio desviado 100 mil € es mucho peor que cinco desviados 20 mil €). ¿Cuál eliges?', ['MAE', 'RMSE', 'El número de aciertos', 'La media de los residuos'], 1, 'Al elevar al cuadrado, un error grande pesa mucho más que varios pequeños. La media de los residuos sin cuadrado sería casi 0 porque se compensan.'),
      pyDemo(
        'Las métricas, a mano y con sklearn',
        [
          ['import numpy as np\nfrom sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score\n\ny = np.array([3.0, 5.0, 7.0, 9.0, 11.0])\np = np.array([2.5, 5.5, 6.0, 9.5, 12.0])\ne = y - p\nprint(np.abs(e).mean(), (e ** 2).mean(), np.sqrt((e ** 2).mean()).round(4))', 'MAE 0.7, MSE 0.55, RMSE 0.7416 calculados con los residuos'],
          ['print(mean_absolute_error(y, p), mean_squared_error(y, p), r2_score(y, p))', 'Las funciones de sklearn dan lo mismo (R² = 0.93125)'],
        ],
      ),
      tf('Un R² de 0.95 en los datos de **entrenamiento** garantiza que el modelo predecirá bien datos nuevos.', false, 'No: mide cuánto encaja con lo que ya ha visto. Hay que medir en datos de prueba que el modelo no haya usado.'),
      learn(
        'Medir con datos que el modelo no ha visto',
        `
Es la regla de oro: **entrenar con una parte y evaluar con otra**. Lo que importa es el error en datos nuevos (error de generalización). Si el error de entrenamiento es mucho menor que el de prueba, hay sobreajuste.

Receta:
1. \`train_test_split(X, y, test_size=0.3, random_state=0)\`.
2. \`modelo.fit(X_train, y_train)\`.
3. \`pred = modelo.predict(X_test)\` y compara con \`y_test\`.
`,
        '🧪',
      ),
      pyDemo(
        'Entrenamiento contra prueba',
        [
          [`${PRE}from sklearn.metrics import mean_absolute_error, mean_squared_error\nfrom sklearn.model_selection import train_test_split\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\n\nmodelo = LinearRegression().fit(Xtr, ytr)\nprint(round(modelo.score(Xtr, ytr), 3), round(modelo.score(Xte, yte), 3))`, 'R² de entrenamiento 0.945 y de prueba 0.910: una pequeña caída, normal'],
          ['pred = modelo.predict(Xte)\nprint(round(mean_absolute_error(yte, pred), 1), round(np.sqrt(mean_squared_error(yte, pred)), 1))', 'En una casa nueva el modelo se equivoca unos 16 mil € de media (MAE) y 16.9 de RMSE'],
        ],
        FILES,
      ),
      learn(
        'La línea base',
        `
Un RMSE de 17 mil €… ¿es bueno o malo? Depende de con qué lo compares. Antes de entrenar nada, calcula una **línea base** (*baseline*): el rendimiento del modelo más simple posible. Para regresión, **predecir siempre la media** del entrenamiento: \`DummyRegressor()\`.

Si tu modelo no mejora claramente a la línea base, o no hay señal en los datos o has hecho algo mal. Esta comprobación tan barata evita muchos autoengaños.
`,
        '🏁',
      ),
      pyDemo(
        'Mejor que predecir la media',
        [
          [`${PRE}from sklearn.dummy import DummyRegressor\nfrom sklearn.metrics import mean_absolute_error, r2_score\nfrom sklearn.model_selection import train_test_split\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nmodelo = LinearRegression().fit(Xtr, ytr)\npred = modelo.predict(Xte)\n\nbase = DummyRegressor().fit(Xtr, ytr)\np0 = base.predict(Xte)\nprint(round(mean_absolute_error(yte, p0), 1), round(r2_score(yte, p0), 2))`, 'Predecir siempre 253 mil €: MAE 101.9 y R² negativo (−3.0)'],
          ['print(round(mean_absolute_error(yte, pred), 1))', 'Nuestro modelo: MAE 16.0, más de seis veces mejor'],
        ],
        FILES,
      ),
      pyOut('¿Qué imprime?', 'from sklearn.metrics import r2_score\nprint(r2_score([1, 2, 3], [2, 2, 2]))', ['1.0', '0.5', '-1.0'], 'Predecir siempre la media (2) da R² = 0 por definición: es el punto de referencia del R².'),
      order('Ordena los pasos para evaluar un modelo de regresión:', ['dividir', 'entrenar', 'predecir', 'comparar', 'con', 'la', 'prueba'], 'dividir entrenar predecir comparar con la prueba', 'Se divide primero; se entrena solo con el entrenamiento, se predice la prueba y se comparan las predicciones con los valores reales de la prueba.'),
      pyPractice({
        goal: 'Calcula las métricas a mano',
        prompt: 'Con los residuos de `y_real` y `y_pred`, calcula `mae`, `rmse` y `r2` **sin usar sklearn** (solo NumPy). Recuerda: `r2 = 1 − Σe² / Σ(y − ȳ)²`.',
        starter: 'import numpy as np\n\ny_real = np.array([3.0, 5.0, 7.0, 9.0, 11.0])\ny_pred = np.array([2.5, 5.5, 6.0, 9.5, 12.0])\nmae = rmse = r2 = None\n',
        check: all(truthy('abs(mae - 0.7) < 1e-9'), truthy('abs(rmse - 0.74162) < 1e-4'), truthy('abs(r2 - 0.93125) < 1e-6')),
        solution: 'import numpy as np\n\ny_real = np.array([3.0, 5.0, 7.0, 9.0, 11.0])\ny_pred = np.array([2.5, 5.5, 6.0, 9.5, 12.0])\ne = y_real - y_pred\nmae = np.abs(e).mean()\nrmse = np.sqrt((e ** 2).mean())\nr2 = 1 - (e ** 2).sum() / ((y_real - y_real.mean()) ** 2).sum()',
        hints: ['Calcula primero los residuos `e = y_real - y_pred`.', '`r2 = 1 - (e**2).sum() / ((y_real - y_real.mean())**2).sum()`.'],
        explain: 'Las tres métricas salen de los mismos residuos. El R² relaciona el error de tu modelo con el de "predecir la media".',
        commands: ['mean_squared_error', 'r2_score'],
      }),
      pyPractice({
        goal: 'Evalúa en datos de prueba',
        prompt: 'Con el reparto ya hecho, entrena una `LinearRegression` con el entrenamiento y guarda en `rmse` su RMSE sobre la **prueba** (usa `mean_squared_error`).',
        setup: FILES,
        starter: `from sklearn.linear_model import LinearRegression\nfrom sklearn.metrics import mean_squared_error\nfrom sklearn.model_selection import train_test_split\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nrmse = None\n`,
        check: truthy('abs(rmse - 16.9048) < 0.01'),
        solution: `from sklearn.linear_model import LinearRegression\nfrom sklearn.metrics import mean_squared_error\nfrom sklearn.model_selection import train_test_split\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nmodelo = LinearRegression().fit(Xtr, ytr)\nrmse = mean_squared_error(yte, modelo.predict(Xte)) ** 0.5`,
        hints: ['Entrena con `Xtr, ytr` y predice con `Xte`.', 'El RMSE es `mean_squared_error(yte, pred) ** 0.5`.'],
        explain: 'RMSE ≈ 16.9 mil €: el modelo se equivoca algo más de 16 000 € en una casa que no ha visto.',
        commands: ['mean_squared_error', 'LinearRegression'],
      }),
      pyPractice({
        goal: 'Calcula la línea base',
        prompt: 'Entrena un `DummyRegressor` (predice la media) con el entrenamiento y guarda en `mae_base` su MAE en la prueba. Después, en `veces`, cuántas veces mayor es ese error que el del modelo lineal (`mae_modelo`).',
        setup: FILES,
        starter: `from sklearn.dummy import DummyRegressor\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.metrics import mean_absolute_error\nfrom sklearn.model_selection import train_test_split\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nmae_modelo = mean_absolute_error(yte, LinearRegression().fit(Xtr, ytr).predict(Xte))\nmae_base = veces = None\n`,
        check: all(truthy('abs(mae_base - 101.889) < 0.01'), truthy('abs(veces - 6.368) < 0.01')),
        solution: `from sklearn.dummy import DummyRegressor\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.metrics import mean_absolute_error\nfrom sklearn.model_selection import train_test_split\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nmae_modelo = mean_absolute_error(yte, LinearRegression().fit(Xtr, ytr).predict(Xte))\nmae_base = mean_absolute_error(yte, DummyRegressor().fit(Xtr, ytr).predict(Xte))\nveces = mae_base / mae_modelo`,
        hints: ['`DummyRegressor().fit(Xtr, ytr).predict(Xte)` predice siempre la media del entrenamiento.', '`veces = mae_base / mae_modelo`.'],
        explain: 'Ese factor (≈ 6.4) es la prueba de que el modelo aprende algo útil. Si fuese ≈ 1 estaríamos ante un modelo inútil.',
        commands: ['DummyRegressor', 'baseline'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia4-4', { title: 'Regularización: Ridge y Lasso', summary: 'Frenar el sobreajuste penalizando los coeficientes grandes', emoji: '🪢', commands: ['Ridge', 'Lasso', 'regularización', 'make_pipeline'], minutes: 14 }, [
      learn(
        'Cuando el modelo se pasa de listo',
        `
Con muchas variables (o muy correlacionadas) y pocos datos, la regresión lineal puede ajustar el **ruido**: los coeficientes se vuelven enormes y de signos caprichosos, el R² de entrenamiento es excelente y el de prueba, pobre. Es el **sobreajuste** (*overfitting*).

La **regularización** añade a la función de error una **penalización por el tamaño de los coeficientes**, de modo que el modelo solo mantiene un peso grande si de verdad compensa:

- **Ridge (L2)**: \`error + α · Σ wᵢ²\`. Encoge todos los pesos hacia cero (casi nunca los anula).
- **Lasso (L1)**: \`error + α · Σ |wᵢ|\`. Además **apaga** variables: deja coeficientes exactamente en 0.

\`α\` (*alpha*) es el **hiperparámetro** que gradúa la fuerza: \`α = 0\` es la regresión normal; \`α\` enorme obliga a que todos los pesos sean ≈ 0 (el modelo predice casi la media).
`,
        '🪢',
      ),
      illus('ia-reg-path', 'Ridge frente a Lasso', 'Sube α y observa cómo se comportan los seis coeficientes. Las variables ámbar son puro ruido (su verdadero peso es 0).'),
      mc('¿Qué regularización puede dejar algunos coeficientes **exactamente en cero**?', ['Ridge (L2)', 'Lasso (L1)', 'Las dos por igual', 'Ninguna: la regularización solo encoge'], 1, 'La penalización L1 (valor absoluto) tiene una "esquina" en cero que atrae a los coeficientes: por eso Lasso hace selección de variables. Ridge solo los acerca.'),
      learn(
        'Escalar antes de penalizar',
        `
La penalización suma los tamaños de **todos** los coeficientes por igual. Si una variable está en metros cuadrados (100) y otra en habitaciones (3), sus pesos naturales son muy distintos y la penalización sería **injusta**.

Por eso, con Ridge/Lasso, **siempre se escalan las variables** (\`StandardScaler\`) y, para no filtrar información, el escalador debe formar parte de un \`make_pipeline\`. Un pipeline también aplica el escalado a los datos de prueba con las medias del entrenamiento.
`,
        '⚖️',
      ),
      pyDemo(
        'Más α, menos pesos',
        [
          ['import numpy as np\nimport pandas as pd\nfrom sklearn.linear_model import Ridge\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("casas.csv")\nX = df[["superficie", "habitaciones", "antiguedad", "distancia"]]\ny = df["precio"]\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nesc = StandardScaler().fit(Xtr)\nA, B = esc.transform(Xtr), esc.transform(Xte)\n\nfor alpha in [0.1, 1, 10, 100]:\n    m = Ridge(alpha=alpha).fit(A, ytr)\n    print(alpha, np.linalg.norm(m.coef_).round(1), round(m.score(B, yte), 3))', 'La norma de los pesos baja al subir α. Con α = 100 el modelo se queda corto (R² negativo): infraajuste por exceso de penalización'],
        ],
        FILES,
      ),
      tf('Un α más grande siempre mejora el resultado en datos de prueba.', false, 'Hay un punto óptimo: poca regularización deja sobreajustar, demasiada deja el modelo sin capacidad (infraajuste). Se elige α probando varios.'),
      pyDemo(
        'Lasso apaga variables',
        [
          ['import numpy as np\nimport pandas as pd\nfrom sklearn.linear_model import Lasso\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("casas.csv")\nVARS = ["superficie", "habitaciones", "antiguedad", "distancia"]\nXtr, Xte, ytr, yte = train_test_split(df[VARS], df["precio"], test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\n\nfor alpha in [0.5, 5, 20]:\n    m = Lasso(alpha=alpha).fit(A, ytr)\n    print(alpha, m.coef_.round(1), "ceros:", int((m.coef_ == 0).sum()))', 'Con α = 20 solo sobrevive la superficie: Lasso ha decidido que es la única variable que importa'],
        ],
        FILES,
      ),
      learn(
        'Elegir α de forma honesta',
        `
No hay un α universal. Se elige **probando valores y puntuándolos con validación cruzada** (nunca con el conjunto de prueba). Las clases \`RidgeCV\` y \`LassoCV\` lo hacen por ti: les pasas una lista de candidatos y guardan el mejor en \`alpha_\`.

\`RidgeCV(alphas=[0.01, 0.1, 1, 10, 100]).fit(X, y).alpha_\`

(La validación cruzada la estudiarás a fondo en la zona 6.)
`,
        '🎚️',
      ),
      match('Une cada concepto con su efecto:', [['Ridge', 'Encoge todos los coeficientes sin llegar a cero'], ['Lasso', 'Pone a cero los coeficientes de variables poco útiles'], ['α = 0', 'Equivale a una regresión lineal sin penalizar'], ['α muy grande', 'Modelo casi constante: infraajuste']], 'La regularización es un regulador: de "sin freno" (α=0) a "tan limitado que no aprende" (α enorme).'),
      pyPractice({
        goal: 'Ridge con escalado',
        prompt: 'Ajusta un `StandardScaler` con `Xtr`, escala `Xtr` en `A`, entrena `Ridge(alpha=10)` y guarda en `norma` la norma euclídea (`np.linalg.norm`) de sus coeficientes.',
        setup: FILES,
        starter: `from sklearn.linear_model import Ridge\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nnorma = None\n`,
        check: truthy('abs(norma - 43.891) < 0.01'),
        solution: `from sklearn.linear_model import Ridge\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\nmodelo = Ridge(alpha=10).fit(A, ytr)\nnorma = np.linalg.norm(modelo.coef_)`,
        hints: ['`A = StandardScaler().fit_transform(Xtr)` escala el entrenamiento.', '`np.linalg.norm(modelo.coef_)` es la longitud del vector de pesos.'],
        explain: 'Sin escalar, la norma dependería de las unidades (m² frente a habitaciones). Con las variables estandarizadas, α actúa de forma justa sobre todas.',
        commands: ['Ridge', 'StandardScaler'],
      }),
      pyPractice({
        goal: 'Cuántas variables sobreviven',
        prompt: 'Con las variables escaladas (`A`), entrena `Lasso(alpha=20)` y guarda en `n_ceros` cuántos coeficientes valen exactamente 0 y en `superviviente` el **nombre** de la variable cuyo coeficiente no es cero.',
        setup: FILES,
        starter: `from sklearn.linear_model import Lasso\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\nn_ceros = superviviente = None\n`,
        check: all(variable('int(n_ceros)', '3'), variable('superviviente', "'superficie'")),
        solution: `from sklearn.linear_model import Lasso\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\nlasso = Lasso(alpha=20).fit(A, ytr)\nn_ceros = (lasso.coef_ == 0).sum()\nsuperviviente = VARS[int(np.nonzero(lasso.coef_)[0][0])]`,
        hints: ['`(lasso.coef_ == 0).sum()` cuenta los coeficientes nulos.', '`np.nonzero(lasso.coef_)[0]` da las posiciones de los coeficientes distintos de cero.'],
        explain: 'Lasso ha hecho una selección automática: de cuatro variables se queda solo con la superficie.',
        commands: ['Lasso', 'regularización'],
      }),
      pyPractice({
        goal: 'Deja que RidgeCV elija α',
        prompt: 'Entrena `RidgeCV` con `alphas=[0.01, 0.1, 1, 10, 100]` sobre las variables escaladas (`A`, `ytr`) y guarda en `mejor_alpha` el α elegido.',
        setup: FILES,
        starter: `from sklearn.linear_model import RidgeCV\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\nmejor_alpha = None\n`,
        check: truthy('abs(mejor_alpha - 0.1) < 1e-9'),
        solution: `from sklearn.linear_model import RidgeCV\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n${CARGA}\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\nA = StandardScaler().fit_transform(Xtr)\nmejor_alpha = RidgeCV(alphas=[0.01, 0.1, 1, 10, 100]).fit(A, ytr).alpha_`,
        hints: ['`RidgeCV(alphas=[...])` recibe la lista de candidatos.', 'Tras `fit`, el elegido está en el atributo `alpha_`.'],
        explain: 'Con tan pocos datos (21 casas de entrenamiento) el mejor α es pequeño: apenas hace falta regularizar. Con más variables o más ruido, el elegido sería mayor.',
        commands: ['Ridge', 'regularización'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia4-5', { title: 'Cuando la recta no basta', summary: 'KNN, árboles y bosques para relaciones no lineales', emoji: '🌲', commands: ['KNeighborsRegressor', 'DecisionTreeRegressor', 'RandomForestRegressor', 'sobreajuste'], minutes: 14 }, [
      learn(
        'Curvas, escalones y vecinos',
        `
No todo se explica con una recta. Si la relación entre \`x\` e \`y\` es una curva (una estacionalidad, una saturación), un modelo lineal se queda corto. Tres alternativas muy usadas, **sin suposiciones sobre la forma**:

- **KNN** (*k vecinos más cercanos*): para predecir, busca los \`k\` datos de entrenamiento más parecidos y promedia su valor.
- **Árbol de decisión**: va haciendo preguntas «¿x ≤ umbral?» que dividen los datos y predice la media de cada región final (una "hoja"). Predicciones en **escalones**.
- **Bosque aleatorio**: promedia muchos árboles entrenados con variaciones de los datos. Suaviza los escalones y reduce el sobreajuste.

Cada uno tiene una "perilla" que controla su flexibilidad: \`k\` en KNN, \`max_depth\` en el árbol.
`,
        '🌲',
      ),
      illus('ia-reg-models', 'Tres modelos, una curva', 'Cambia de modelo y mueve su perilla. La línea discontinua es la señal real; los círculos huecos son los datos de prueba.'),
      mc('En la ilustración, un árbol con profundidad 8 tiene error de entrenamiento casi 0 pero peor error de prueba que uno de profundidad 3. ¿Cómo se llama el fenómeno?', ['Infraajuste', 'Sobreajuste', 'Regularización', 'Fuga de datos'], 1, 'El modelo ha memorizado hasta el ruido del entrenamiento; no generaliza. Es sobreajuste, y la solución es limitar su flexibilidad.'),
      pyDemo(
        'Una curva con ruido',
        [
          ['import numpy as np\nfrom sklearn.linear_model import LinearRegression\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.tree import DecisionTreeRegressor\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\nfor nombre, m in [("recta", LinearRegression()), ("árbol prof. 3", DecisionTreeRegressor(max_depth=3, random_state=0)), ("árbol prof. 8", DecisionTreeRegressor(max_depth=8, random_state=0))]:\n    m.fit(xtr, ytr)\n    print(nombre, round(m.score(xtr, ytr), 2), round(m.score(xte, yte), 2))', 'La recta se queda corta (0.60 / 0.47). El árbol de profundidad 3 es el mejor (0.92 / 0.75). El de profundidad 8 memoriza (0.99 en entrenamiento) y cae en prueba (0.64)'],
        ],
      ),
      learn(
        'KNN y la tiranía de la escala',
        `
KNN se basa en **distancias**. Si una variable tiene valores enormes (ingresos en miles) y otra pequeños (edad en decenas), la distancia casi solo depende de la grande: la otra "no cuenta". Solución: **escalar siempre** antes de usar KNN (y SVM, K-means, regresión regularizada…).

Los modelos de árboles, en cambio, **no necesitan escalado**: solo comparan cada variable con un umbral.
`,
        '📏',
      ),
      pyDemo(
        'KNN sin escalar y escalado',
        [
          ['import numpy as np\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.neighbors import KNeighborsRegressor\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nrng = np.random.RandomState(0)\nX = np.c_[rng.rand(80), rng.rand(80) * 1000]   # la 1.ª es la que importa; la 2.ª es ruido enorme\ny = 10 * X[:, 0] + rng.randn(80) * 0.3\nA, B, ya, yb = train_test_split(X, y, test_size=0.25, random_state=1)\n\nsin = KNeighborsRegressor(5).fit(A, ya)\ncon = make_pipeline(StandardScaler(), KNeighborsRegressor(5)).fit(A, ya)\nprint(round(sin.score(B, yb), 2), round(con.score(B, yb), 2))', 'Sin escalar, la variable de ruido (rango 1000) decide las distancias: R² negativo. Escalando, 0.96'],
        ],
      ),
      tf('Un árbol de decisión necesita que las variables estén escaladas para funcionar bien.', false, 'Los árboles solo comparan cada variable con un umbral, así que los cambios de escala no les afectan.'),
      pyOut('¿Qué imprime?', 'import numpy as np\nfrom sklearn.tree import DecisionTreeRegressor\nx = np.array([[1], [2], [3], [10], [11], [12]])\ny = np.array([1.0, 1.0, 1.0, 5.0, 5.0, 5.0])\nm = DecisionTreeRegressor(max_depth=1).fit(x, y)\nprint(m.predict([[2.5], [11.5]]))', ['[3. 3.]', '[1. 3.]', '[2.5 11.5]'], 'Con una sola pregunta (x ≤ 6.5) los datos se separan en dos grupos puros: predice 1 para la izquierda y 5 para la derecha.'),
      learn(
        'El bosque: muchos árboles, menos varianza',
        `
Un árbol profundo es inestable: cambia mucho si cambias algunos datos. El **bosque aleatorio** entrena muchos árboles, cada uno con una **muestra con reemplazo** de los datos y, en cada división, solo una selección aleatoria de variables; después **promedia** sus predicciones. Los errores individuales se compensan y el resultado es mucho más estable.

Es un excelente modelo "de partida" para datos en tablas: pocos ajustes, resiste atípicos y variables irrelevantes. Además da \`feature_importances_\`, que indica qué variables usó más.
`,
        '🌳',
      ),
      pyDemo(
        'Bosque contra árbol',
        [
          ['import numpy as np\nfrom sklearn.ensemble import RandomForestRegressor\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.tree import DecisionTreeRegressor\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\narbol = DecisionTreeRegressor(random_state=0).fit(xtr, ytr)\nbosque = RandomForestRegressor(n_estimators=100, random_state=0).fit(xtr, ytr)\nprint(round(arbol.score(xte, yte), 2), round(bosque.score(xte, yte), 2))', 'Un árbol sin límite de profundidad sobreajusta; el bosque de 100 árboles generaliza mucho mejor'],
        ],
      ),
      pyPractice({
        goal: 'Escala antes de usar KNN',
        prompt: 'Con los datos ya creados, entrena un KNN de 5 vecinos **dentro de un pipeline con `StandardScaler`** y guarda su R² en la prueba en `r2_esc`; guarda en `r2_raw` el de un KNN sin escalar.',
        starter: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.neighbors import KNeighborsRegressor\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nrng = np.random.RandomState(0)\nX = np.c_[rng.rand(80), rng.rand(80) * 1000]\ny = 10 * X[:, 0] + rng.randn(80) * 0.3\nA, B, ya, yb = train_test_split(X, y, test_size=0.25, random_state=1)\n\nr2_raw = r2_esc = None\n',
        check: all(truthy('r2_esc > 0.9'), truthy('r2_raw < 0.2')),
        solution: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.neighbors import KNeighborsRegressor\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\nrng = np.random.RandomState(0)\nX = np.c_[rng.rand(80), rng.rand(80) * 1000]\ny = 10 * X[:, 0] + rng.randn(80) * 0.3\nA, B, ya, yb = train_test_split(X, y, test_size=0.25, random_state=1)\n\nr2_raw = KNeighborsRegressor(5).fit(A, ya).score(B, yb)\nr2_esc = make_pipeline(StandardScaler(), KNeighborsRegressor(5)).fit(A, ya).score(B, yb)',
        hints: ['`make_pipeline(StandardScaler(), KNeighborsRegressor(5))` es un modelo que escala y luego vota.', '`.score(B, yb)` devuelve el R² en la prueba.'],
        explain: 'El mismo algoritmo pasa de R² ≈ −0.4 a 0.96 solo por poner las variables en la misma escala. Con KNN, el preprocesado importa tanto como el modelo.',
        commands: ['KNeighborsRegressor', 'make_pipeline'],
      }),
      pyPractice({
        goal: 'Pon freno al árbol',
        prompt: 'Entrena un `DecisionTreeRegressor(max_depth=3, random_state=0)` con `(xtr, ytr)` y guarda en `r2_train` y `r2_test` su R² en entrenamiento y en prueba.',
        starter: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.tree import DecisionTreeRegressor\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\nr2_train = r2_test = None\n',
        check: all(truthy('abs(r2_train - 0.9206) < 0.005'), truthy('abs(r2_test - 0.7543) < 0.005')),
        solution: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.tree import DecisionTreeRegressor\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\narbol = DecisionTreeRegressor(max_depth=3, random_state=0).fit(xtr, ytr)\nr2_train = arbol.score(xtr, ytr)\nr2_test = arbol.score(xte, yte)',
        hints: ['`DecisionTreeRegressor(max_depth=3, random_state=0).fit(xtr, ytr)`.', '`score` con entrenamiento y con prueba.'],
        explain: 'Una pequeña caída (0.92 → 0.75) es normal. Una caída enorme sería la señal de sobreajuste.',
        commands: ['DecisionTreeRegressor', 'sobreajuste'],
      }),
      pyPractice({
        goal: 'Prueba un bosque aleatorio',
        prompt: 'Entrena un `RandomForestRegressor(n_estimators=100, random_state=0)` con `(xtr, ytr)` y guarda en `r2_test` su R² en la prueba.',
        starter: 'import numpy as np\nfrom sklearn.ensemble import RandomForestRegressor\nfrom sklearn.model_selection import train_test_split\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\nr2_test = None\n',
        check: truthy('abs(r2_test - 0.7168) < 0.01'),
        solution: 'import numpy as np\nfrom sklearn.ensemble import RandomForestRegressor\nfrom sklearn.model_selection import train_test_split\n\ng = np.random.RandomState(3)\nx = np.sort(g.uniform(0, 6, 60)).reshape(-1, 1)\ny = np.sin(x).ravel() + g.randn(60) * 0.3\nxtr, xte, ytr, yte = train_test_split(x, y, test_size=0.3, random_state=0)\n\nbosque = RandomForestRegressor(n_estimators=100, random_state=0).fit(xtr, ytr)\nr2_test = bosque.score(xte, yte)',
        hints: ['`RandomForestRegressor(n_estimators=100, random_state=0)`; `random_state` fija la aleatoriedad.', '`.score(xte, yte)` es el R² de prueba.'],
        explain: 'Con un conjunto tan pequeño y ruidoso el techo está en torno a 0.75: ningún modelo puede explicar el ruido. Saber cuál es el límite razonable es parte del trabajo.',
        commands: ['RandomForestRegressor'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: tasador de viviendas',
    prompt:
      'Construye un modelo que tase viviendas con `casas.csv`.\n\n1. Convierte `zona` en columnas 0/1 (`dtype=int`) y separa `X` (sin `precio`) de `y`.\n2. Divide con `test_size=0.3` y `random_state=0`.\n3. Entrena un `make_pipeline(StandardScaler(), Ridge(alpha=1))` (el modelo se llama `modelo`).\n4. Guarda en `rmse` su error en la **prueba** y en `rmse_base` el de un `DummyRegressor`.\n5. Calcula en `mejora` cuántas veces es menor el error de tu modelo que el de la línea base.',
    setup: FILES,
    starter:
      'import pandas as pd\nfrom sklearn.dummy import DummyRegressor\nfrom sklearn.linear_model import Ridge\nfrom sklearn.metrics import mean_squared_error\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("casas.csv")\n\n# 1: variables\nX = y = None\n\n# 2: división\nXtr = Xte = ytr = yte = None\n\n# 3, 4 y 5: modelo, errores y mejora\nmodelo = None\nrmse = rmse_base = mejora = None\n',
    check: all(variable('X.shape', '(30, 7)'), variable('Xtr.shape', '(21, 7)'), truthy('abs(rmse - 15.489) < 0.01'), truthy('abs(rmse_base - 112.39) < 0.05'), truthy('abs(mejora - 7.256) < 0.01')),
    solution:
      'import pandas as pd\nfrom sklearn.dummy import DummyRegressor\nfrom sklearn.linear_model import Ridge\nfrom sklearn.metrics import mean_squared_error\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.pipeline import make_pipeline\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("casas.csv")\n\nD = pd.get_dummies(df, columns=["zona"], dtype=int)\nX = D.drop(columns="precio")\ny = D["precio"]\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0)\n\nmodelo = make_pipeline(StandardScaler(), Ridge(alpha=1)).fit(Xtr, ytr)\nrmse = mean_squared_error(yte, modelo.predict(Xte)) ** 0.5\nrmse_base = mean_squared_error(yte, DummyRegressor().fit(Xtr, ytr).predict(Xte)) ** 0.5\nmejora = rmse_base / rmse',
    hints: ['`pd.get_dummies(df, columns=["zona"], dtype=int)` y después `drop(columns="precio")` para `X`.', 'El pipeline se entrena con `Xtr, ytr` y se evalúa con `Xte, yte`.', '`mejora = rmse_base / rmse`.'],
    explain: 'Has hecho un proyecto completo de regresión: codificar, dividir, escalar y regularizar dentro de un pipeline, medir en prueba y compararte con una línea base. Tu tasador se equivoca unos 15 mil € de media (RMSE) frente a los 112 mil € de predecir siempre la media: es 7 veces mejor.',
    commands: ['make_pipeline', 'Ridge', 'DummyRegressor', 'mean_squared_error'],
  },
});

void [match, multi, order];
