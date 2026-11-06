import type { IaRef } from '../reference';

export const NUMPY_REFS: IaRef[] = [
  {
    name: 'np.array',
    kind: 'función',
    category: 'numpy',
    level: 1,
    summary: 'Crea un array de NumPy a partir de una lista (o lista de listas).',
    usage: 'np.array(objeto, dtype=None) → ndarray',
    details: 'Un **array** es una tabla de números del **mismo tipo**, almacenada de forma compacta. Todas las operaciones se aplican a todos los elementos a la vez (sin bucles `for`).',
    examples: [
      ['import numpy as np\na = np.array([1, 2, 3])\na', 'un vector'],
      ['import numpy as np\nm = np.array([[1, 2, 3], [4, 5, 6]])\nm.shape', 'una matriz de 2 filas y 3 columnas'],
      ['import numpy as np\na = np.array([1, 2, 3])\na * 10 + 1', 'operación sobre todos los elementos'],
    ],
    seeAlso: ['np.arange', 'np.linspace', 'ndarray.reshape'],
  },
  {
    name: 'np.arange',
    kind: 'función',
    category: 'numpy',
    level: 1,
    summary: 'Secuencia de números con un paso fijo (como range, pero devuelve un array).',
    usage: 'np.arange(inicio, fin, paso)',
    examples: [
      ['import numpy as np\nnp.arange(5)', 'de 0 a 4'],
      ['import numpy as np\nnp.arange(2, 11, 3)', 'de 2 a 10 de 3 en 3'],
    ],
    seeAlso: ['np.linspace', 'np.array'],
  },
  {
    name: 'np.linspace',
    kind: 'función',
    category: 'numpy',
    level: 1,
    summary: 'N puntos equiespaciados entre dos valores (incluyendo el final).',
    usage: 'np.linspace(inicio, fin, n)',
    examples: [['import numpy as np\nnp.linspace(0, 1, 5)', 'cinco puntos: 0, 0.25, 0.5, 0.75, 1']],
    seeAlso: ['np.arange'],
  },
  {
    name: 'ndarray.reshape',
    kind: 'método',
    category: 'numpy',
    level: 1,
    summary: 'Cambia la forma del array sin cambiar los datos. Un −1 deja que NumPy calcule esa dimensión.',
    usage: 'a.reshape(filas, columnas)',
    examples: [
      ['import numpy as np\nnp.arange(6).reshape(2, 3)', '6 elementos en 2×3'],
      ['import numpy as np\nnp.arange(6).reshape(-1, 2)', 'NumPy deduce que son 3 filas'],
    ],
    seeAlso: ['np.array'],
  },
  {
    name: 'np.dot',
    kind: 'función',
    category: 'numpy',
    level: 2,
    summary: 'Producto escalar de vectores y producto de matrices. Es la operación central de las redes neuronales.',
    usage: 'np.dot(a, b)   ·   a @ b',
    examples: [
      ['import numpy as np\nnp.dot([1, 2, 3], [4, 5, 6])', '1·4 + 2·5 + 3·6'],
      ['import numpy as np\nA = np.array([[1, 2], [3, 4]])\nA @ A', 'producto de matrices'],
    ],
    seeAlso: ['np.array'],
  },
];
