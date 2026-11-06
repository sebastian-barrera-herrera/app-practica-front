import type { IaRef } from '../reference';

/** Fichas de preprocesado y división de datos (Z3). */
export const PREPROCESADO_REFS: IaRef[] = [
  {
    name: 'StandardScaler',
    kind: 'tipo',
    category: 'ml',
    level: 1,
    summary: 'Estandariza cada columna: (x − media) / desviación. Aprende media y desviación con `fit` (solo con entrenamiento) y las aplica con `transform`.',
    usage: 'esc = StandardScaler().fit(X_train)\nX_train_s = esc.transform(X_train)\nX_test_s = esc.transform(X_test)',
    details: 'Parientes: `MinMaxScaler` (lleva a [0, 1]), `RobustScaler` (usa mediana y cuartiles: resiste atípicos).',
    examples: [
      ['import numpy as np\nfrom sklearn.preprocessing import StandardScaler\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 30.0]])\nesc = StandardScaler().fit(X)\nprint(esc.mean_, esc.scale_.round(3))\nprint(esc.transform(X).round(3))', 'media 0 y desviación 1 por columna'],
      ['import numpy as np\nfrom sklearn.preprocessing import MinMaxScaler\nX = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 30.0]])\nprint(MinMaxScaler().fit_transform(X))', 'a [0, 1]'],
    ],
    seeAlso: ['fuga de datos', 'train_test_split', 'pd.get_dummies'],
  },
  {
    name: 'pd.get_dummies',
    kind: 'función',
    category: 'datos',
    level: 1,
    summary: 'Codificación one-hot: una columna 0/1 por cada categoría. Equivalente de `OneHotEncoder` en pandas.',
    usage: 'pd.get_dummies(df, columns=["ciudad"], dtype=int, drop_first=False)',
    examples: [
      ['import pandas as pd\ns = pd.Series(["rojo", "azul", "rojo", "verde"])\nprint(pd.get_dummies(s, dtype=int))', 'una columna por color'],
      ['import pandas as pd\ndf = pd.DataFrame({"talla": [38, 40], "color": ["rojo", "azul"]})\nprint(pd.get_dummies(df, columns=["color"], dtype=int))', 'solo se codifica la columna indicada'],
    ],
    seeAlso: ['StandardScaler', 'train_test_split'],
  },
  {
    name: 'train_test_split',
    kind: 'función',
    category: 'ml',
    level: 1,
    summary: 'Reparte los datos al azar en entrenamiento y prueba. `random_state` fija la semilla; `stratify=y` conserva la proporción de clases.',
    usage: 'X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)',
    examples: [
      ['import numpy as np\nfrom sklearn.model_selection import train_test_split\nX = np.arange(20).reshape(10, 2)\ny = np.arange(10)\nXtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)\nprint(Xtr.shape, Xte.shape, yte)', '8 para entrenar y 2 para probar'],
    ],
    seeAlso: ['fuga de datos', 'StandardScaler'],
  },
  {
    name: 'fuga de datos',
    kind: 'concepto',
    category: 'ml',
    level: 2,
    summary: 'Cuando información del conjunto de prueba (o del futuro) se cuela en el entrenamiento: resultados excelentes en el laboratorio y malos en producción.',
    usage: 'dividir PRIMERO · fit solo con train · transform en ambos',
    details: 'Causas típicas: escalar o imputar con todo el conjunto antes de dividir, usar como variable algo que solo se conoce después del evento (el resultado), o mezclar filas casi idénticas entre entrenamiento y prueba.',
    examples: [['import numpy as np\nx = np.array([1.0, 2.0, 3.0, 4.0, 100.0])\ntrain, test = x[:4], x[4:]\nprint("media global (con fuga):", x.mean())\nprint("media del entrenamiento:", train.mean())', 'la media global ya «sabe» que existe el 100 de la prueba']],
    seeAlso: ['StandardScaler', 'train_test_split'],
  },
];
