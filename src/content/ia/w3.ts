import { fill, illus, learn, lesson, match, mc, multi, order, tf } from './iabuild';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, iaWorld } from './iabuild';
import { all, calls, stdout, truthy, uses, variable } from './iabuild';

/** Tabla de clientes con los defectos típicos de los datos reales: huecos, duplicados, texto sucio y un valor imposible. */
const CLIENTES = `id,nombre,edad,ciudad,ingresos,compras,premium
1,Ana,34,Madrid,32000,12,si
2,Luis,45,Lima,41000,7,no
3,Eva,,Quito,28000,3,no
4,Pedro,29,Madrid,,9,si
5,Marta,52,Lima,58000,20,si
6,Juan,38,quito ,36000,5,no
7,Sofía,41,Madrid,39500,11,si
8,Diego,200,Lima,45000,8,no
9,Lucía,27,Quito,30000,,no
10,Carlos,33,Madrid,34000,6,si
10,Carlos,33,Madrid,34000,6,si
11,Rosa,47,LIMA,52000,15,si
12,Mateo,31,Quito,29500,4,no
`;

const PEDIDOS = `id_cliente,importe
1,50.5
1,20
2,75
5,120.25
5,30
9,15
`;

const FILES = { files: { 'clientes.csv': CLIENTES, 'pedidos.csv': PEDIDOS } };

/** Carga y limpieza habituales, para las prácticas que parten de datos ya limpios. */
const LIMPIEZA = `import pandas as pd
import numpy as np

df = pd.read_csv("clientes.csv")
df["ciudad"] = df["ciudad"].str.strip().str.title()
df = df.drop_duplicates()
`;

export const ia3 = iaWorld({
  id: 'ia3',
  index: 3,
  title: 'Datos y preprocesado',
  subtitle: 'pandas, limpieza, gráficas y datos listos para un modelo',
  emoji: '🧹',
  color: '#A78BFA',
  level: 'basico',
  intro:
    'Los modelos son tan buenos como los datos que reciben. Los profesionales dedican **más del 70 % de su tiempo** a preparar datos: leerlos, limpiarlos, mirarlos con gráficas y convertirlos en números que un algoritmo entienda. Aquí dominarás **pandas** y las herramientas de preprocesado de scikit-learn, y aprenderás la trampa que arruina más proyectos: la **fuga de datos**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia3-1', { title: 'Tablas con pandas', summary: 'DataFrame, Series, leer un CSV y seleccionar datos', emoji: '🐼', commands: ['pd.DataFrame', 'pd.read_csv', 'df.loc', 'df.sort_values'], minutes: 12 }, [
      learn(
        'Una hoja de cálculo dentro de Python',
        `
**pandas** es la librería de tablas de Python. Sus dos piezas:

- **\`Series\`**: una columna, es decir, una lista de valores con **etiquetas** (el índice) y un tipo.
- **\`DataFrame\`**: una tabla: varias columnas (cada una es una Series) que comparten el mismo índice de filas.

Por debajo usa NumPy, así que las operaciones se aplican a columnas enteras sin bucles. Y todo conjunto de datos de ML (\`X\`, \`y\`) suele pasar antes por un DataFrame.
`,
        '🐼',
      ),
      pyDemo(
        'Tu primer DataFrame',
        [
          ['import pandas as pd\n\ndf = pd.DataFrame({\n    "nombre": ["Ana", "Luis", "Eva"],\n    "edad": [34, 45, 29],\n    "ingresos": [32000.0, 41000.0, 28000.0],\n})\nprint(df)', 'Un diccionario de columnas se convierte en una tabla; cada fila recibe un índice 0, 1, 2…'],
          ['print(df.shape)\nprint(df.dtypes)', '`shape` = (filas, columnas) y `dtypes` el tipo de cada columna: texto (`str`), entero (`int64`), decimal (`float64`)'],
          ['print(df["edad"])\nprint(df["edad"].mean())', 'Una columna es una `Series`: se puede operar con ella directamente'],
        ],
      ),
      mc('Un DataFrame tiene 500 filas y 8 columnas. ¿Qué devuelve `df.shape`?', ['(8, 500)', '(500, 8)', '508', '[500, 8]'], 1, '`shape` es una tupla `(filas, columnas)`: igual que en NumPy.'),
      tf('En un DataFrame cada columna puede tener un tipo distinto (texto, enteros, decimales).', true, 'A diferencia de un array de NumPy, un DataFrame guarda un tipo por columna: es lo que lo hace ideal para tablas reales con datos mezclados.'),
      learn(
        'Leer archivos CSV',
        `
Los datos casi siempre vienen de un archivo. **CSV** (valores separados por comas) es el formato más común: texto plano, una fila por línea.

\`pd.read_csv("archivo.csv")\` lo convierte en un DataFrame y **adivina el tipo** de cada columna. Las primeras comprobaciones, siempre:

- \`df.head()\`: las primeras filas.
- \`df.info()\`: columnas, tipos y **cuántos valores hay** (los nulos delatan huecos).
- \`df.describe()\`: estadísticas de las columnas numéricas.
- \`df.shape\`: el tamaño.
`,
        '📂',
      ),
      pyDemo(
        'Mirar un CSV',
        [
          ['import pandas as pd\ndf = pd.read_csv("clientes.csv")\nprint(df.head(3))', 'Las tres primeras filas del archivo'],
          ['df.info()', '13 filas; `edad`, `ingresos` y `compras` tienen menos de 13 valores no nulos: hay huecos'],
          ['print(df.describe())', 'Cuenta, media, desviación y percentiles. Fíjate en el máximo de `edad`: 200 años… un dato sospechoso'],
        ],
        FILES,
      ),
      learn(
        'Seleccionar filas y columnas',
        `
- \`df["col"]\` → una columna (Series). \`df[["a", "b"]]\` → varias columnas (DataFrame).
- **Filtrar filas**: \`df[condición]\`, con la misma idea de máscaras que NumPy: \`df[df["edad"] > 40]\`. Varias condiciones: \`&\` (y), \`|\` (o), con paréntesis.
- \`df.loc[filas, columnas]\` selecciona por **etiqueta** (¡el final se incluye!). \`df.iloc[filas, columnas]\` por **posición** (como las listas).
- \`df.sort_values("col", ascending=False)\` ordena; \`df.nlargest(3, "col")\` toma los 3 mayores.
`,
        '🎯',
      ),
      pyDemo(
        'Filtrar y ordenar',
        [
          ['import pandas as pd\ndf = pd.read_csv("clientes.csv")\nprint(df[df["ingresos"] > 40000][["nombre", "ingresos"]])', 'Filas con ingresos altos y solo dos columnas'],
          ['print(df.loc[2:4, ["nombre", "edad"]])\nprint(df.iloc[2:4, [1, 2]])', '`loc` incluye la etiqueta 4; `iloc` no incluye la posición 4'],
          ['print(df.sort_values("ingresos", ascending=False).head(3)[["nombre", "ingresos"]])', 'Los tres clientes con más ingresos'],
        ],
        FILES,
      ),
      pyOut('¿Qué imprime?', 'import pandas as pd\ndf = pd.DataFrame({"x": [10, 20, 30, 40]})\nprint(df.loc[1:2, "x"].tolist(), df.iloc[1:2, 0].tolist())', ['[20] [20, 30]', '[20, 30] [20, 30]', '[20] [20]'], '`loc` usa etiquetas y **incluye** el final (filas 1 y 2 → `[20, 30]`); `iloc` usa posiciones y **excluye** el final (solo la posición 1 → `[20]`).'),
      pyPractice({
        goal: 'Construye una tabla',
        prompt: 'Crea el DataFrame `df` con las columnas `producto` (`"pan"`, `"leche"`, `"queso"`), `precio` (`1.2`, `0.9`, `4.5`) y `cantidad` (`3`, `2`, `1`). Después añade la columna `total` = `precio × cantidad`.',
        starter: 'import pandas as pd\n\ndf = None\n',
        check: all(variable('df["total"].round(2).tolist()', '[3.6, 1.8, 4.5]'), variable('list(df.columns)', "['producto', 'precio', 'cantidad', 'total']")),
        solution: 'import pandas as pd\n\ndf = pd.DataFrame({"producto": ["pan", "leche", "queso"], "precio": [1.2, 0.9, 4.5], "cantidad": [3, 2, 1]})\ndf["total"] = df["precio"] * df["cantidad"]',
        hints: ['Pasa un diccionario `{columna: lista}` a `pd.DataFrame`.', 'Una columna nueva se crea asignando: `df["total"] = df["precio"] * df["cantidad"]`.'],
        explain: 'Operar con columnas completas (`precio * cantidad`) es la vectorización de pandas: sin bucles y con el índice alineado.',
        commands: ['pd.DataFrame'],
      }),
      pyPractice({
        goal: 'Cuenta los clientes premium',
        prompt: 'Lee `clientes.csv` en `df` y guarda en `n_premium` cuántas filas tienen `premium == "si"`.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = None\nn_premium = None\n',
        check: variable('int(n_premium)', '7'),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\nn_premium = (df["premium"] == "si").sum()',
        hints: ['`pd.read_csv("clientes.csv")` carga el archivo.', 'Una comparación da una máscara; `.sum()` cuenta los `True`.'],
        explain: 'Comparar una columna da una Series de booleanos y `sum()` los cuenta. (Hay 7 porque el cliente 10 está repetido: lo arreglaremos al limpiar.)',
        commands: ['pd.read_csv'],
      }),
      pyPractice({
        goal: 'Los tres mejores',
        prompt: 'Con `clientes.csv`, guarda en `top3` la **lista** con los nombres de los 3 clientes de mayores `ingresos` (de mayor a menor).',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\ntop3 = None\n',
        check: variable('top3', "['Marta', 'Rosa', 'Diego']"),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\ntop3 = df.nlargest(3, "ingresos")["nombre"].tolist()',
        hints: ['`df.nlargest(3, "ingresos")` devuelve las 3 filas con mayores ingresos.', 'Selecciona la columna `"nombre"` y conviértela con `.tolist()`.'],
        explain: '`nlargest` equivale a ordenar de mayor a menor y quedarse con las primeras filas, pero más corto y más claro.',
        commands: ['df.sort_values'],
      }),
      pyPractice({
        goal: 'Filtra con dos condiciones',
        prompt: 'Guarda en `adultos_ricos` el DataFrame con los clientes con `edad >= 40` **y** `ingresos >= 40000`. Después imprime cuántos son con `print(len(adultos_ricos))`.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\nadultos_ricos = None\n',
        check: all(variable('len(adultos_ricos)', '4'), stdout('4')),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\nadultos_ricos = df[(df["edad"] >= 40) & (df["ingresos"] >= 40000)]\nprint(len(adultos_ricos))',
        hints: ['Cada condición va entre paréntesis y se unen con `&`.', '`df[(df["edad"] >= 40) & (df["ingresos"] >= 40000)]`.'],
        explain: 'Con pandas (igual que con NumPy) se usa `&` y `|` en lugar de `and` y `or`, y cada comparación necesita sus paréntesis.',
        commands: ['df.loc'],
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('ia3-2', { title: 'Limpiar datos', summary: 'Nulos, duplicados, texto sucio y valores atípicos', emoji: '🧼', commands: ['df.isna', 'df.fillna', 'df.drop_duplicates', 'Series.str'], minutes: 13 }, [
      learn(
        'Datos reales, datos sucios',
        `
Los datos de la vida real vienen **rotos**. Los cinco defectos clásicos:

1. **Valores ausentes** (\`NaN\`): una casilla vacía.
2. **Duplicados**: la misma fila dos veces.
3. **Texto inconsistente**: \`"Lima"\`, \`"lima "\` y \`"LIMA"\` son tres valores distintos para el ordenador.
4. **Valores imposibles o atípicos**: una edad de 200 años.
5. **Tipos incorrectos**: números guardados como texto.

La mayoría de los algoritmos **fallan o mienten** con estos defectos, así que se limpian primero. El hueco se detecta con \`df.isna().sum()\` (cuántos nulos por columna).
`,
        '🧼',
      ),
      pyDemo(
        'Ver los defectos',
        [
          ['import pandas as pd\ndf = pd.read_csv("clientes.csv")\nprint(df.isna().sum())', 'Un nulo en `edad`, otro en `ingresos` y otro en `compras`'],
          ['print(df.duplicated().sum())\nprint(df["ciudad"].unique().tolist())', 'Hay 1 fila duplicada y la misma ciudad escrita de varias formas'],
        ],
        FILES,
      ),
      learn(
        'Huecos: ¿tirar o rellenar?',
        `
Ante un hueco hay dos caminos:

- **Eliminar** la fila (\`df.dropna()\`) o la columna: simple, pero pierdes información. Solo si faltan **pocos** datos.
- **Imputar**: rellenar con un valor razonable. Con \`df["col"].fillna(valor)\`:
  - la **media** (si no hay valores extremos),
  - la **mediana** (más robusta si los hay),
  - la **moda** (para categorías),
  - o un valor constante como \`0\` o \`"desconocido"\`.

Un buen hábito: guardar además una columna \`falta_ingresos = df["ingresos"].isna()\` por si **que falte** ya es una pista.
`,
        '🕳️',
      ),
      pyDemo(
        'Imputar con la mediana',
        [
          ['import pandas as pd\ndf = pd.read_csv("clientes.csv")\nprint(df["ingresos"].mean(), df["ingresos"].median())', 'Media y mediana de los ingresos conocidos'],
          ['df["ingresos"] = df["ingresos"].fillna(df["ingresos"].median())\nprint(df["ingresos"].isna().sum())\nprint(df.loc[3, ["nombre", "ingresos"]])', 'El hueco de Pedro ahora vale la mediana (35000)'],
        ],
        FILES,
      ),
      mc('Una columna de sueldos tiene un directivo que cobra 100 veces más que el resto. ¿Con qué rellenas los huecos?', ['La media', 'La mediana', '0', 'El máximo'], 1, 'La media se dispara por el valor extremo y rellenaría con un sueldo irreal. La mediana resiste a los atípicos.'),
      learn(
        'Duplicados y texto sucio',
        `
- \`df.drop_duplicates()\` elimina las filas repetidas (con \`subset=["id"]\` decides qué columnas comparar).
- Para el texto, el accesor \`.str\` aplica funciones de cadenas a una columna entera: \`.str.strip()\` (quita espacios), \`.str.lower()\`, \`.str.title()\`, \`.str.replace()\`, \`.str.contains()\`.
- \`map({"si": 1, "no": 0})\` traduce valores con un diccionario (útil para convertir categorías en números).
`,
        '✂️',
      ),
      pyDemo(
        'Normalizar texto y quitar repetidos',
        [
          ['import pandas as pd\ndf = pd.read_csv("clientes.csv")\ndf["ciudad"] = df["ciudad"].str.strip().str.title()\nprint(sorted(df["ciudad"].unique().tolist()))', 'De 5 variantes a 3 ciudades reales'],
          ['print(len(df))\ndf = df.drop_duplicates()\nprint(len(df))', 'La fila repetida del cliente 10 desaparece'],
        ],
        FILES,
      ),
      learn(
        'Atípicos: la regla del IQR',
        `
Un **valor atípico** (*outlier*) está muy lejos del resto. ¿Error o dato real? Hay que mirarlo; un método estándar para **detectarlos** es la **regla del IQR**:

\`\`\`
Q1, Q3 = percentiles 25 y 75
IQR = Q3 − Q1
atípico si  x < Q1 − 1.5·IQR   o   x > Q3 + 1.5·IQR
\`\`\`

Es la misma regla con la que un diagrama de cajas dibuja los puntos sueltos. Opciones: **eliminar** la fila (si es un error), **recortar** al límite (\`clip\`) o **conservar** (si es real y relevante: un cliente multimillonario existe de verdad).
`,
        '📏',
      ),
      multi('¿Qué problemas de calidad tiene esta fila repetida: `7,Sofía,41,Madrid,39500,11,si`?', ['Es un duplicado', 'Provoca fuga de datos si cae en entrenamiento y en prueba', 'Es un valor atípico', 'Cuenta dos veces en medias y recuentos'], [0, 1, 3], 'Un duplicado distorsiona las estadísticas y, si una copia va a entrenamiento y otra a prueba, el modelo «ve» la respuesta de antemano. No es un atípico: su valor es normal.'),
      tf('Un valor atípico siempre es un error y hay que borrarlo.', false, 'A veces es un error (una edad de 200 años) y a veces es real y muy informativo (un fraude, un cliente enorme). Hay que investigarlo antes de decidir.'),
      pyPractice({
        goal: 'Rellena los ingresos',
        prompt: 'Rellena los huecos de `ingresos` con la **mediana** de esa columna (calculada antes de rellenar), dentro del propio `df`.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\n\n# rellena df["ingresos"]\n',
        check: all(variable('int(df["ingresos"].isna().sum())', '0'), variable('float(df.loc[3, "ingresos"])', '35000.0')),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\n\ndf["ingresos"] = df["ingresos"].fillna(df["ingresos"].median())',
        hints: ['La mediana es `df["ingresos"].median()`.', '`df["ingresos"] = df["ingresos"].fillna(...)`.'],
        explain: '`fillna` devuelve una columna nueva; hay que reasignarla. La mediana de los ingresos conocidos es 35000.',
        commands: ['df.fillna'],
      }),
      pyPractice({
        goal: 'Ciudades limpias y sin repetidos',
        prompt: 'Normaliza `ciudad` (sin espacios sobrantes y con la primera letra en mayúscula) y elimina las filas duplicadas. Deja el resultado en `df`.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\n',
        check: all(variable('sorted(df["ciudad"].unique().tolist())', "['Lima', 'Madrid', 'Quito']"), variable('len(df)', '12')),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\ndf["ciudad"] = df["ciudad"].str.strip().str.title()\ndf = df.drop_duplicates()',
        hints: ['Encadena `.str.strip().str.title()` sobre la columna y reasígnala.', 'Luego `df = df.drop_duplicates()`.'],
        explain: 'Normalizar el texto antes de agrupar o contar evita que «Lima», «lima » y «LIMA» cuenten como ciudades distintas.',
        commands: ['Series.str', 'df.drop_duplicates'],
      }),
      pyPractice({
        goal: 'Quita las edades imposibles',
        prompt: 'Calcula los límites del IQR de `edad` (`q1`, `q3`, `limite_sup = q3 + 1.5 * IQR`) y guarda en `limpio` el DataFrame **sin** las filas cuya edad supera `limite_sup` (las filas con edad desconocida se conservan).',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\nq1 = q3 = limite_sup = None\nlimpio = None\n',
        check: all(variable('float(limite_sup)', '65.0'), variable('len(limpio)', '12'), variable('float(limpio["edad"].max())', '52.0')),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\nq1 = df["edad"].quantile(0.25)\nq3 = df["edad"].quantile(0.75)\nlimite_sup = q3 + 1.5 * (q3 - q1)\nlimpio = df[~(df["edad"] > limite_sup)]',
        hints: ['`df["edad"].quantile(0.25)` y `quantile(0.75)` dan Q1 y Q3.', 'Para conservar los NaN usa `~(df["edad"] > limite_sup)` (comparar un NaN da `False`).'],
        explain: 'Q1 = 32.5 y Q3 = 45.5 → IQR = 13 → límite = 65. Los 200 años quedan fuera. Ojo: el atípico infló la media de edades a 50 años; la regla basada en cuartiles es robusta.',
        commands: ['df.describe'],
      }),
      pyPractice({
        goal: 'Convierte sí/no en 1/0',
        prompt: 'Transforma la columna `premium` de `df` de `"si"`/`"no"` a `1`/`0` con `map`.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\n',
        check: all(variable('int(df["premium"].sum())', '7'), variable('str(df["premium"].dtype)', "'int64'")),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv")\ndf["premium"] = df["premium"].map({"si": 1, "no": 0})',
        hints: ['`Series.map` acepta un diccionario.', '`df["premium"] = df["premium"].map({"si": 1, "no": 0})`.'],
        explain: 'Los modelos necesitan números. Una variable binaria se codifica como 0/1: es la etiqueta típica de un problema de clasificación.',
        commands: ['df.isna'],
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('ia3-3', { title: 'Agrupar y combinar', summary: 'groupby, value_counts, pivot_table y merge', emoji: '🧩', commands: ['df.groupby', 'Series.value_counts', 'df.merge', 'df.pivot_table'], minutes: 12 }, [
      learn(
        'Dividir, aplicar, combinar',
        `
Casi toda pregunta de análisis tiene la forma *«¿cuánto vale X **por** cada Y?»*: ingresos medios **por ciudad**, ventas **por mes**. En pandas es el patrón **dividir–aplicar–combinar**:

\`\`\`
df.groupby("ciudad")["ingresos"].mean()
\`\`\`

1. **Divide** la tabla en grupos según \`ciudad\`.
2. **Aplica** una función (media, suma, cuenta…) a cada grupo.
3. **Combina** los resultados en una Series o DataFrame.

Con \`.agg()\` calculas varias cosas a la vez: \`df.groupby("ciudad").agg(media=("ingresos", "mean"), n=("id", "count"))\`.
`,
        '🧩',
      ),
      pyDemo(
        'Estadísticas por grupo',
        [
          [`${LIMPIEZA}print(df.groupby("ciudad")["ingresos"].mean())`, 'La media de ingresos de cada ciudad (los nulos se ignoran)'],
          ['print(df.groupby("ciudad").agg(media=("ingresos", "mean"), clientes=("id", "count")))', 'Varias métricas a la vez, con nombres a tu gusto'],
          ['print(df["ciudad"].value_counts())\nprint(df["premium"].value_counts(normalize=True))', '`value_counts` cuenta cuántas veces aparece cada valor (y con `normalize` da proporciones)'],
        ],
        FILES,
      ),
      mc('¿Qué devuelve `df.groupby("tipo")["precio"].max()`?', ['Un solo número: el precio máximo', 'Una Series con el precio máximo de cada tipo', 'Un DataFrame con todas las columnas', 'La fila más cara'], 1, 'Una Series indexada por los valores de `tipo`, con el máximo de `precio` en cada grupo.'),
      tf('`groupby` modifica el DataFrame original agrupando sus filas.', false, '`groupby` no cambia la tabla original: devuelve un objeto con los grupos y, al agregar, una tabla o Series nueva.'),
      learn(
        'Tablas dinámicas',
        `
\`pivot_table\` cruza **dos** categorías: filas por una, columnas por otra, y en cada celda una agregación:

\`\`\`
df.pivot_table(values="ingresos", index="ciudad", columns="premium", aggfunc="mean")
\`\`\`

Es lo que hace una tabla dinámica de Excel.
`,
        '📊',
      ),
      pyDemo(
        'Cruzar dos variables',
        [
          [`${LIMPIEZA}print(df.pivot_table(values="ingresos", index="ciudad", columns="premium", aggfunc="mean"))`, 'Ingresos medios por ciudad y tipo de cliente'],
        ],
        FILES,
      ),
      learn(
        'Juntar tablas: merge',
        `
Los datos suelen estar repartidos en varias tablas (clientes en una, pedidos en otra) enlazadas por una **clave** (\`id\`). \`merge\` las une como un \`JOIN\` de SQL:

- \`how="inner"\` (por defecto): solo las filas con pareja en **ambas** tablas.
- \`how="left"\`: todas las de la izquierda; las que no tengan pareja reciben \`NaN\`.
- \`how="outer"\`: todas las de ambas.

\`pd.concat([a, b])\` apila tablas con las mismas columnas (una debajo de otra).
`,
        '🔗',
      ),
      pyDemo(
        'Unir clientes y pedidos',
        [
          ['import pandas as pd\nclientes = pd.read_csv("clientes.csv").drop_duplicates()\npedidos = pd.read_csv("pedidos.csv")\nunido = clientes.merge(pedidos, left_on="id", right_on="id_cliente")\nprint(unido[["nombre", "importe"]])', 'Solo los clientes que hicieron pedidos (unión interna)'],
          ['print(unido.groupby("nombre")["importe"].sum())', 'Lo gastado por cliente'],
          ['todos = clientes.merge(pedidos, left_on="id", right_on="id_cliente", how="left")\nprint(todos["importe"].isna().sum())', 'Con `left` se conservan los clientes sin pedidos (importe vacío)'],
        ],
        FILES,
      ),
      match('Une cada tipo de unión con lo que conserva:', [['inner', 'Solo filas con pareja en las dos tablas'], ['left', 'Todas las de la izquierda, con NaN si no hay pareja'], ['outer', 'Todas las filas de ambas tablas'], ['concat', 'Apila tablas una debajo de otra']], 'Son las mismas ideas que los JOIN de SQL, más `concat` para apilar.'),
      pyPractice({
        goal: 'Ingresos por ciudad',
        prompt: 'Con el DataFrame ya limpio `df`, guarda en `por_ciudad` la Series con el **ingreso medio de cada ciudad** y en `mejor_ciudad` el nombre de la ciudad con la media más alta.',
        setup: FILES,
        starter: `${LIMPIEZA}\npor_ciudad = mejor_ciudad = None\n`,
        check: all(variable('round(float(por_ciudad["Lima"]))', '49000'), variable('round(float(por_ciudad["Quito"]), 1)', '30875.0'), variable('mejor_ciudad', "'Lima'")),
        solution: `${LIMPIEZA}\npor_ciudad = df.groupby("ciudad")["ingresos"].mean()\nmejor_ciudad = por_ciudad.idxmax()`,
        hints: ['`df.groupby("ciudad")["ingresos"].mean()`.', '`Series.idxmax()` devuelve la etiqueta del valor máximo.'],
        explain: 'Con `groupby` la pregunta «por cada ciudad» se resuelve en una línea. `idxmax` devuelve la **etiqueta** (la ciudad), mientras que `max` devuelve el valor.',
        commands: ['df.groupby'],
      }),
      pyPractice({
        goal: 'Cuenta por categoría',
        prompt: 'Dada la lista `pagos`, crea la Series `metodos` y guarda en `mas_usado` el método más frecuente y en `proporcion` la proporción (entre 0 y 1) que representa.',
        starter: 'import pandas as pd\n\npagos = ["tarjeta", "efectivo", "tarjeta", "bizum", "tarjeta", "efectivo", "tarjeta", "bizum"]\nmetodos = pd.Series(pagos)\n\nmas_usado = proporcion = None\n',
        check: all(variable('mas_usado', "'tarjeta'"), variable('float(proporcion)', '0.5')),
        solution: 'import pandas as pd\n\npagos = ["tarjeta", "efectivo", "tarjeta", "bizum", "tarjeta", "efectivo", "tarjeta", "bizum"]\nmetodos = pd.Series(pagos)\n\ncuentas = metodos.value_counts(normalize=True)\nmas_usado = cuentas.idxmax()\nproporcion = cuentas.max()',
        hints: ['`metodos.value_counts(normalize=True)` devuelve proporciones ordenadas.', 'Su `idxmax()` es la categoría y su `max()` la proporción.'],
        explain: '`value_counts` es la herramienta número uno para entender una variable categórica (y para detectar clases desbalanceadas).',
        commands: ['Series.value_counts'],
      }),
      pyPractice({
        goal: 'Quién ha gastado más',
        prompt: 'Une `clientes` y `pedidos` (clave `id` = `id_cliente`), suma el `importe` por `nombre` y guarda en `gasto` esa Series. Guarda en `mejor` el nombre del cliente que más gastó.',
        setup: FILES,
        starter: 'import pandas as pd\n\nclientes = pd.read_csv("clientes.csv").drop_duplicates()\npedidos = pd.read_csv("pedidos.csv")\n\ngasto = mejor = None\n',
        check: all(variable('float(gasto["Marta"])', '150.25'), variable('float(gasto["Ana"])', '70.5'), variable('mejor', "'Marta'")),
        solution: 'import pandas as pd\n\nclientes = pd.read_csv("clientes.csv").drop_duplicates()\npedidos = pd.read_csv("pedidos.csv")\n\nunido = clientes.merge(pedidos, left_on="id", right_on="id_cliente")\ngasto = unido.groupby("nombre")["importe"].sum()\nmejor = gasto.idxmax()',
        hints: ['`clientes.merge(pedidos, left_on="id", right_on="id_cliente")`.', 'Después `groupby("nombre")["importe"].sum()`.'],
        explain: 'Unir y agrupar es el flujo estándar para pasar de datos «transaccionales» (un pedido por fila) a datos «por cliente» (una fila por cliente): justo la forma que necesita un modelo.',
        commands: ['df.merge'],
      }),
      pyPractice({
        goal: 'Tabla dinámica',
        prompt: 'Con el `df` ya limpio, crea en `tabla` la tabla dinámica con las **compras medias** (`compras`) por `ciudad` (filas) y `premium` (columnas).',
        setup: FILES,
        starter: `${LIMPIEZA}\ntabla = None\n`,
        check: all(variable('tabla.shape', '(3, 2)'), variable('float(tabla.loc["Madrid", "si"])', '9.5'), variable('float(tabla.loc["Lima", "no"])', '7.5')),
        solution: `${LIMPIEZA}\ntabla = df.pivot_table(values="compras", index="ciudad", columns="premium", aggfunc="mean")`,
        hints: ['`pivot_table(values=..., index=..., columns=..., aggfunc=...)`.', 'Los valores son `compras`, el índice `ciudad`, las columnas `premium` y la función `"mean"`.'],
        explain: 'Una tabla dinámica es un `groupby` con dos claves, con una de ellas «girada» a columnas para leerla mejor.',
        commands: ['df.pivot_table'],
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('ia3-4', { title: 'Mirar los datos', summary: 'Análisis exploratorio con gráficas: histogramas, dispersión, cajas y correlaciones', emoji: '📈', commands: ['plt.hist', 'plt.scatter', 'df.corr', 'df.plot'], minutes: 13 }, [
      learn(
        'Antes de modelar, dibuja',
        `
Las estadísticas resumen; las **gráficas revelan**. El **análisis exploratorio de datos** (EDA) responde: ¿cómo se reparte cada variable? ¿Hay atípicos? ¿Qué variables se relacionan entre sí y con lo que quiero predecir?

| Pregunta | Gráfica |
|---|---|
| ¿Cómo se distribuye una variable numérica? | **histograma** (\`plt.hist\`) |
| ¿Hay valores extremos? | **diagrama de cajas** (\`plt.boxplot\`) |
| ¿Cómo se relacionan dos variables? | **dispersión** (\`plt.scatter\`) |
| ¿Cuántos hay de cada categoría? | **barras** (\`plt.bar\`) |
| ¿Qué variables se parecen? | **matriz de correlación** (\`plt.imshow\`) |

En este curso las figuras de \`matplotlib\` se dibujan **dentro de la salida**: termina con \`plt.show()\`.
`,
        '📈',
      ),
      pyDemo(
        'Distribución y atípicos',
        [
          ['import pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.read_csv("clientes.csv").drop_duplicates()\nplt.hist(df["ingresos"].dropna(), bins=5, color="#A78BFA")\nplt.title("Ingresos")\nplt.xlabel("euros")\nplt.show()', 'Cada barra cuenta cuántos clientes caen en un tramo de ingresos'],
          ['plt.boxplot([df["edad"].dropna()], labels=["edad"])\nplt.title("Edad")\nplt.show()', 'La caja cubre del cuartil 1 al 3; los puntos sueltos son atípicos: ahí está el cliente de 200 años'],
        ],
        FILES,
      ),
      illus('ia-hist-bins', 'El truco de los intervalos', 'Cambia el número de barras: pocas esconden la forma, demasiadas dibujan ruido.'),
      mc('Un histograma con **muy pocas** barras (por ejemplo 2) suele…', ['Mostrar el ruido con detalle', 'Esconder la forma real de la distribución', 'Ser siempre el más claro', 'Cambiar los datos'], 1, 'Con pocos intervalos se mezclan grupos distintos y se pierde la forma (por ejemplo, dos picos parecen uno solo). Con demasiados se dibuja ruido. Conviene probar varios.'),
      pyOut('¿Qué imprime?', 'import numpy as np\ncontenido, bordes = np.histogram([1, 2, 2, 3, 3, 3, 9], bins=2)\nprint(contenido.tolist())', ['[3, 4]', '[4, 3]', '[1, 6]'], 'Con 2 intervalos entre 1 y 9 (corte en 5), caen 6 datos en el primero (1, 2, 2, 3, 3, 3) y solo 1 (el 9) en el segundo.'),
      learn(
        'Relaciones y correlaciones',
        `
Un **diagrama de dispersión** pone una variable en cada eje: la nube de puntos muestra la relación (ascendente, descendente o ninguna). Con \`df.corr()\` obtienes la **matriz de correlaciones** (de −1 a 1) de todas las columnas numéricas.

Dos precauciones:
- La correlación solo mide relaciones **lineales** y se distorsiona con **atípicos**.
- Correlación **no** implica causalidad.
`,
        '🔗',
      ),
      pyDemo(
        'Dispersión y correlación',
        [
          ['import pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.read_csv("clientes.csv").drop_duplicates()\nplt.scatter(df["edad"], df["ingresos"], c=(df["premium"] == "si"), cmap="coolwarm")\nplt.xlabel("edad")\nplt.ylabel("ingresos")\nplt.show()', 'Cada punto es un cliente; el color indica si es premium. El punto de 200 años queda aislado'],
          ['print(df[["edad", "ingresos", "compras"]].corr().round(2))', 'La matriz de correlaciones: el atípico de edad la deforma'],
        ],
        FILES,
      ),
      tf('Si la correlación entre dos variables es 0, no tienen ninguna relación.', false, 'Solo significa que no hay relación **lineal**. Una parábola perfecta (y = x²) puede tener correlación casi 0 con x.'),
      pyPractice({
        goal: 'Cuenta por intervalos',
        prompt: 'Calcula en `conteos` y `bordes` el histograma de `ingresos` (sin nulos) con **4 intervalos** usando `np.histogram`. Después dibuja el histograma con `plt.hist` y muéstralo.',
        setup: FILES,
        starter: 'import numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\ningresos = df["ingresos"].dropna()\n\nconteos = bordes = None\n',
        check: all(variable('conteos.tolist()', '[5, 3, 1, 2]'), variable('bordes.tolist()', '[28000.0, 35500.0, 43000.0, 50500.0, 58000.0]'), uses('method:hist')),
        solution: 'import numpy as np\nimport pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\ningresos = df["ingresos"].dropna()\n\nconteos, bordes = np.histogram(ingresos, bins=4)\nplt.hist(ingresos, bins=4)\nplt.show()',
        hints: ['`np.histogram(datos, bins=4)` devuelve (conteos, bordes).', 'Y `plt.hist(ingresos, bins=4)` + `plt.show()` lo dibuja.'],
        explain: '`np.histogram` calcula los números que `plt.hist` dibuja: útil cuando quieres los valores y no solo la imagen.',
        commands: ['plt.hist'],
      }),
      pyPractice({
        goal: 'El atípico de la correlación',
        prompt: 'Calcula en `r_con` la correlación entre `edad` e `ingresos` con **todos** los datos y en `r_sin` la misma correlación **sin** la fila de 200 años (`edad < 100`). Redondea ambas a 3 decimales.',
        setup: FILES,
        starter: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\n\nr_con = r_sin = None\n',
        check: all(variable('float(r_con)', '0.332'), variable('float(r_sin)', '0.943')),
        solution: 'import pandas as pd\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\n\nr_con = round(df["edad"].corr(df["ingresos"]), 3)\nsin = df[df["edad"] < 100]\nr_sin = round(sin["edad"].corr(sin["ingresos"]), 3)',
        hints: ['`serie_a.corr(serie_b)` devuelve la correlación de Pearson.', 'Filtra primero con `df[df["edad"] < 100]` para la segunda.'],
        explain: 'Una sola fila errónea hundió la correlación de 0.94 a 0.33. Por eso se miran las gráficas y se limpian los atípicos **antes** de fiarse de una correlación.',
        commands: ['df.corr'],
      }),
      pyPractice({
        goal: 'Dibuja una dispersión',
        prompt: 'Dibuja un diagrama de dispersión de `ingresos` (eje y) frente a `compras` (eje x) con `plt.scatter`, ponle título y etiquetas de ejes, y termina con `plt.show()`.',
        setup: FILES,
        starter: 'import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\n\n# dibuja aquí\n',
        check: all(uses('method:scatter'), uses('method:show'), uses('method:title'), uses('method:xlabel'), uses('method:ylabel')),
        solution: 'import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("clientes.csv").drop_duplicates()\n\nplt.scatter(df["compras"], df["ingresos"])\nplt.title("Compras e ingresos")\nplt.xlabel("compras")\nplt.ylabel("ingresos")\nplt.show()',
        hints: ['`plt.scatter(x, y)` toma primero lo del eje horizontal.', 'Añade `plt.title(...)`, `plt.xlabel(...)`, `plt.ylabel(...)` y cierra con `plt.show()`.'],
        explain: 'Una gráfica sin título ni etiquetas no se entiende. La dispersión muestra algo que los números ocultan: quienes compran más tienden a tener más ingresos.',
        commands: ['plt.scatter'],
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('ia3-5', { title: 'Preparar los datos para el modelo', summary: 'Escalado, codificación, división y la fuga de datos', emoji: '🔧', commands: ['StandardScaler', 'pd.get_dummies', 'train_test_split', 'fuga de datos'], minutes: 14 }, [
      learn(
        'Convertir la tabla en números comparables',
        `
Un modelo recibe una matriz de **números** (X). Antes hay que resolver dos cosas:

1. **Escalas distintas**: la edad va de 20 a 80 y los ingresos de 20 000 a 60 000. Los algoritmos basados en **distancias** (k-NN, k-means) o en **gradientes** (regresión, redes neuronales) se dejan dominar por la columna con números grandes.
   - **Estandarizar**: \`(x − media) / desviación\` → media 0, desviación 1 (\`StandardScaler\`).
   - **Min-max**: lleva todo a [0, 1] (\`MinMaxScaler\`).
2. **Categorías**: el texto no se puede multiplicar. Se convierte:
   - **One-hot** (\`pd.get_dummies\` / \`OneHotEncoder\`): una columna 0/1 por categoría. Para variables **sin orden** (ciudad, color).
   - **Ordinal** (\`OrdinalEncoder\`, o \`map\`): 0, 1, 2… Solo si hay un **orden real** (bajo < medio < alto).

> Los árboles de decisión no necesitan escalar; casi todo lo demás, sí.
`,
        '🔧',
      ),
      pyDemo(
        'Estandarizar y codificar',
        [
          ['import pandas as pd\nfrom sklearn.preprocessing import StandardScaler\n\nX = pd.DataFrame({"edad": [25, 35, 45, 55], "ingresos": [20000, 30000, 50000, 60000]})\nesc = StandardScaler().fit(X)\nprint(esc.mean_, esc.scale_.round(1))\nprint(esc.transform(X).round(2))', '`fit` aprende la media y la desviación de cada columna; `transform` las aplica'],
          ['ciudades = pd.DataFrame({"ciudad": ["Lima", "Quito", "Lima", "Madrid"]})\nprint(pd.get_dummies(ciudades["ciudad"], dtype=int))', 'Una columna 0/1 por cada ciudad'],
        ],
      ),
      learn(
        'La trampa: fuga de datos',
        `
Imagina que estandarizas **todo** el conjunto con su media y **luego** divides en entrenamiento y prueba. La media «ha visto» los datos de prueba: has filtrado información del futuro al modelo. Es la **fuga de datos** (*data leakage*) y produce resultados de laboratorio brillantes… que **se hunden en producción**.

Regla de oro:

1. **Divide primero** en entrenamiento y prueba.
2. **\`fit\` solo con el entrenamiento** (\`escalador.fit(X_train)\`).
3. **\`transform\`** con ese mismo escalador **ambos** conjuntos.

Lo mismo vale para imputar huecos, codificar categorías, seleccionar variables… cualquier cosa que «aprenda» de los datos.
`,
        '🚰',
      ),
      illus('ia-leakage', 'Fuga de datos', 'Compara escalar antes y después de dividir: observa cómo cambia lo que el modelo «sabe» del conjunto de prueba.'),
      mc('Quieres imputar los huecos con la media. ¿Cuándo calculas esa media?', ['Con todo el conjunto, antes de dividir', 'Solo con el conjunto de entrenamiento', 'Con el conjunto de prueba', 'Da igual'], 1, 'La media debe calcularse solo con el entrenamiento y aplicarse luego a los dos conjuntos; si no, hay fuga de datos.'),
      order('Ordena los pasos para escalar sin fuga de datos:', ['dividir', 'ajustar', 'con', 'el', 'entrenamiento', 'transformar', 'train', 'y', 'test'], 'dividir ajustar con el entrenamiento transformar train y test', 'Primero se divide; el escalador se ajusta (`fit`) solo con el entrenamiento y después se transforma tanto el entrenamiento como la prueba con ese mismo escalador.'),
      learn(
        'Dividir bien',
        `
\`train_test_split(X, y, test_size=0.25, random_state=42)\` reparte los datos al azar (con **semilla** para que sea reproducible). Dos detalles importantes:

- **\`stratify=y\`** mantiene la **proporción de clases** en los dos conjuntos. Imprescindible cuando una clase es rara (fraudes, enfermedades).
- Si los datos son una **serie temporal**, no se baraja: se entrena con el pasado y se prueba con el futuro (\`shuffle=False\`).
`,
        '✂️',
      ),
      pyDemo(
        'Dividir con estratificación',
        [
          ['import numpy as np\nfrom sklearn.model_selection import train_test_split\n\nX = np.arange(40).reshape(20, 2)\ny = np.array([0] * 16 + [1] * 4)   # clase 1 poco frecuente\n\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\nprint(len(ytr), len(yte))\nprint(yte.mean(), ytr.mean())', 'Con `stratify` las dos particiones conservan el 20 % de la clase rara'],
        ],
      ),
      tf('Se puede estandarizar todo el conjunto con su media y desviación y dividir después, porque da el mismo resultado.', false, 'No da lo mismo y, sobre todo, filtra información de la prueba al entrenamiento (fuga). El escalador se ajusta con el entrenamiento únicamente.'),
      pyPractice({
        goal: 'Estandariza sin fugas',
        prompt: 'Ajusta un `StandardScaler` **solo con `X_train`** y transforma `X_train` y `X_test` en `X_train_s` y `X_test_s`.',
        starter: 'import numpy as np\nfrom sklearn.preprocessing import StandardScaler\n\nX_train = np.array([[1.0, 100.0], [2.0, 200.0], [3.0, 300.0], [4.0, 400.0]])\nX_test = np.array([[5.0, 500.0]])\n\nX_train_s = X_test_s = None\n',
        check: all(truthy('abs(X_train_s.mean(axis=0)).max() < 1e-9'), variable('X_test_s.round(4).tolist()', '[[2.2361, 2.2361]]')),
        solution: 'import numpy as np\nfrom sklearn.preprocessing import StandardScaler\n\nX_train = np.array([[1.0, 100.0], [2.0, 200.0], [3.0, 300.0], [4.0, 400.0]])\nX_test = np.array([[5.0, 500.0]])\n\nesc = StandardScaler().fit(X_train)\nX_train_s = esc.transform(X_train)\nX_test_s = esc.transform(X_test)',
        hints: ['`esc = StandardScaler().fit(X_train)` aprende media y desviación del entrenamiento.', 'Aplica `esc.transform(...)` a los dos conjuntos.'],
        explain: 'El punto de prueba (5, 500) queda a 2.24 desviaciones del entrenamiento: así se ve lo «nuevo» que es respecto a lo que el modelo ha visto. Si hubieras ajustado con todo el conjunto, su media habría incluido el propio punto de prueba.',
        commands: ['StandardScaler', 'fuga de datos'],
      }),
      pyPractice({
        goal: 'Codifica las ciudades',
        prompt: 'Convierte la columna `ciudad` de `df` en columnas 0/1 con `pd.get_dummies` (con `dtype=int`) y guarda el resultado completo en `codificado`.',
        setup: FILES,
        starter: `${LIMPIEZA}\ncodificado = None\n`,
        check: all(variable('sorted(c for c in codificado.columns if c.startswith("ciudad_"))', "['ciudad_Lima', 'ciudad_Madrid', 'ciudad_Quito']"), variable('int(codificado["ciudad_Lima"].sum())', '4'), variable('"ciudad" in codificado.columns', 'False')),
        solution: `${LIMPIEZA}\ncodificado = pd.get_dummies(df, columns=["ciudad"], dtype=int)`,
        hints: ['`pd.get_dummies(df, columns=["ciudad"], dtype=int)` codifica solo esa columna.', 'La columna original desaparece y aparecen `ciudad_Lima`, `ciudad_Madrid` y `ciudad_Quito`.'],
        explain: 'One-hot evita que el modelo piense que Quito (2) «vale el doble» que Lima (1). Cada categoría tiene su propia columna independiente.',
        commands: ['pd.get_dummies'],
      }),
      pyPractice({
        goal: 'Divide con semilla',
        prompt: 'Divide `X` e `y` en entrenamiento y prueba con `test_size=0.2` y `random_state=42`. Guarda los cuatro resultados en `X_train, X_test, y_train, y_test`.',
        starter: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\n\nX = np.arange(20).reshape(10, 2)\ny = np.arange(10)\n\nX_train = X_test = y_train = y_test = None\n',
        check: all(variable('y_test.tolist()', '[8, 1]'), variable('y_train.tolist()', '[5, 0, 7, 2, 9, 4, 3, 6]'), variable('X_train.shape', '(8, 2)')),
        solution: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\n\nX = np.arange(20).reshape(10, 2)\ny = np.arange(10)\n\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)',
        hints: ['`train_test_split(X, y, test_size=..., random_state=...)` devuelve cuatro arrays en este orden.', 'El orden es `X_train, X_test, y_train, y_test`.'],
        explain: 'Con `random_state` fijo el reparto es siempre el mismo (aquí, el mismo que daría scikit-learn real): imprescindible para que tus experimentos sean reproducibles.',
        commands: ['train_test_split'],
      }),
      pyPractice({
        goal: 'Estratifica',
        prompt: 'Divide con `stratify=y`, `test_size=0.25` y `random_state=0`. Guarda en `prop_test` la proporción de unos en `y_test`.',
        starter: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\n\nX = np.arange(40).reshape(20, 2)\ny = np.array([0] * 16 + [1] * 4)\n\nprop_test = None\n',
        check: variable('float(prop_test)', '0.2'),
        solution: 'import numpy as np\nfrom sklearn.model_selection import train_test_split\n\nX = np.arange(40).reshape(20, 2)\ny = np.array([0] * 16 + [1] * 4)\n\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\nprop_test = y_test.mean()',
        hints: ['Añade `stratify=y` a `train_test_split`.', 'La proporción de unos es `y_test.mean()` (los unos valen 1).'],
        explain: 'Sin estratificar, una partición pequeña podría quedarse sin ningún ejemplo de la clase rara y tus métricas serían un espejismo.',
        commands: ['train_test_split'],
      }),
    ]),
  ],
  boss: {
    goal: 'Misión: del CSV al modelo',
    prompt:
      'Prepara el conjunto de clientes para predecir si son **premium**.\n\n1. Lee `clientes.csv`, normaliza `ciudad` (`strip` + `title`) y elimina duplicados.\n2. Imputa `edad`, `ingresos` y `compras` con la **mediana** y quita las filas con edad mayor que 100.\n3. Crea `y` (1 si `premium == "si"`) y `X` con `edad`, `ingresos`, `compras` y las ciudades en one-hot (`dtype=int`).\n4. Divide con `test_size=0.25`, `random_state=0`, `stratify=y`.\n5. Estandariza con un `StandardScaler` ajustado **solo con el entrenamiento** (`X_train_s`, `X_test_s`).',
    setup: FILES,
    starter:
      'import pandas as pd\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("clientes.csv")\n\n# 1 y 2: limpieza\n\n# 3: X e y\nX = y = None\n\n# 4 y 5: división y escalado\nX_train_s = X_test_s = None\n',
    check: all(variable('X.shape', '(11, 6)'), variable('int(y.sum())', '6'), variable('X_train_s.shape', '(8, 6)'), variable('X_test_s.shape', '(3, 6)'), truthy('abs(X_train_s.mean(axis=0)).max() < 1e-9'), variable('int(X.isna().sum().sum())', '0')),
    solution:
      'import pandas as pd\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.preprocessing import StandardScaler\n\ndf = pd.read_csv("clientes.csv")\n\ndf["ciudad"] = df["ciudad"].str.strip().str.title()\ndf = df.drop_duplicates()\nfor col in ["edad", "ingresos", "compras"]:\n    df[col] = df[col].fillna(df[col].median())\ndf = df[df["edad"] <= 100]\n\ny = (df["premium"] == "si").astype(int)\nX = pd.get_dummies(df[["edad", "ingresos", "compras", "ciudad"]], columns=["ciudad"], dtype=int)\n\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=0, stratify=y)\nesc = StandardScaler().fit(X_train)\nX_train_s = esc.transform(X_train)\nX_test_s = esc.transform(X_test)',
    hints: ['Rellena cada columna con su mediana: `df[col] = df[col].fillna(df[col].median())`.', '`pd.get_dummies(df[[...]], columns=["ciudad"], dtype=int)` deja las numéricas y codifica la ciudad.', 'Primero `train_test_split(..., stratify=y)`, luego `StandardScaler().fit(X_train)` y `transform` en los dos.'],
    explain: 'Has recorrido el ciclo completo de preparación: limpiar, imputar, codificar, dividir **antes** de escalar y escalar sin fugas. Este mismo esqueleto precede a casi cualquier modelo clásico.',
    commands: ['StandardScaler', 'pd.get_dummies', 'train_test_split'],
  },
});

void [fill, match, multi, order, calls, pyCode, pyErr, pyOut, stdout];
