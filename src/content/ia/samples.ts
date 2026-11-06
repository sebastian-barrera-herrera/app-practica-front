/** Programas de ejemplo para el laboratorio de IA (se cargan en el editor con un toque). */
import type { PySample } from '../py/samples';

export const IA_SAMPLES: PySample[] = [
  {
    id: 'numpy-hola',
    title: 'Arrays con NumPy',
    emoji: '🔢',
    blurb: 'Vectores, matrices y operaciones sin bucles',
    code: `import numpy as np

a = np.arange(1, 7).reshape(2, 3)
print(a)
print("forma:", a.shape)
print("suma por columnas:", a.sum(axis=0))
print("media:", a.mean())
print("a * 10 =")
print(a * 10)
`,
  },
  {
    id: 'seno',
    title: 'Mi primera gráfica',
    emoji: '📈',
    blurb: 'matplotlib: seno y coseno',
    code: `import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 100)
plt.plot(x, np.sin(x), label="seno")
plt.plot(x, np.cos(x), label="coseno")
plt.title("Ondas")
plt.legend()
plt.grid(True)
plt.show()
`,
  },
  {
    id: 'regresion',
    title: 'Regresión lineal a mano',
    emoji: '📉',
    blurb: 'Descenso del gradiente paso a paso',
    code: `import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(0)
x = rng.uniform(0, 10, 40)
y = 2.5 * x + 4 + rng.normal(0, 2, 40)

w, b = 0.0, 0.0
lr = 0.01
for paso in range(300):
    pred = w * x + b
    error = pred - y
    w -= lr * (2 * error * x).mean()
    b -= lr * (2 * error).mean()

print(f"w = {w:.2f}  (real: 2.5)")
print(f"b = {b:.2f}  (real: 4)")

plt.scatter(x, y, label="datos")
plt.plot(x, w * x + b, color="red", label="modelo")
plt.legend()
plt.show()
`,
  },
  {
    id: 'puntos',
    title: 'Nubes de puntos',
    emoji: '🎯',
    blurb: 'Dos clases y la distancia a sus centros',
    code: `import numpy as np
import matplotlib.pyplot as plt

rng = np.random.default_rng(1)
A = rng.normal([0, 0], 0.8, size=(50, 2))
B = rng.normal([3, 3], 0.8, size=(50, 2))

plt.scatter(A[:, 0], A[:, 1], label="clase A")
plt.scatter(B[:, 0], B[:, 1], label="clase B")
plt.legend()
plt.show()

punto = np.array([1.2, 1.0])
dA = np.linalg.norm(punto - A.mean(axis=0))
dB = np.linalg.norm(punto - B.mean(axis=0))
print("distancia a A:", round(float(dA), 2))
print("distancia a B:", round(float(dB), 2))
print("se parece más a:", "A" if dA < dB else "B")
`,
  },
];
