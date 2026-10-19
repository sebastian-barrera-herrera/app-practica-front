/** Programas de ejemplo para el laboratorio de Python (se cargan en el editor con un toque). */
export interface PySample {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  code: string;
}

export const PY_SAMPLES: PySample[] = [
  {
    id: 'hola',
    title: 'Hola, mundo',
    emoji: '👋',
    blurb: 'print() e input()',
    code: `nombre = input("¿Cómo te llamas? ")
print(f"¡Hola, {nombre}! Bienvenido a Python.")
`,
  },
  {
    id: 'fizzbuzz',
    title: 'FizzBuzz',
    emoji: '🔢',
    blurb: 'Bucles y condiciones',
    code: `for n in range(1, 21):
    if n % 15 == 0:
        print("FizzBuzz")
    elif n % 3 == 0:
        print("Fizz")
    elif n % 5 == 0:
        print("Buzz")
    else:
        print(n)
`,
  },
  {
    id: 'tabla',
    title: 'Tabla de multiplicar',
    emoji: '✖️',
    blurb: 'Bucles anidados y f-strings',
    code: `n = 7
for i in range(1, 11):
    print(f"{n} x {i:2} = {n * i:3}")
`,
  },
  {
    id: 'primos',
    title: 'Números primos',
    emoji: '🧮',
    blurb: 'Funciones y comprensiones',
    code: `def es_primo(n):
    if n < 2:
        return False
    return all(n % d for d in range(2, int(n ** 0.5) + 1))

primos = [n for n in range(2, 60) if es_primo(n)]
print(primos)
print(f"Hay {len(primos)} primos menores que 60")
`,
  },
  {
    id: 'fibonacci',
    title: 'Fibonacci con generador',
    emoji: '🌀',
    blurb: 'yield e itertools',
    code: `from itertools import islice

def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

print(list(islice(fibonacci(), 15)))
`,
  },
  {
    id: 'palabras',
    title: 'Contador de palabras',
    emoji: '📝',
    blurb: 'Diccionarios y Counter',
    code: `from collections import Counter

texto = """el perro y el gato juegan
el gato duerme y el perro come"""
conteo = Counter(texto.split())
for palabra, veces in conteo.most_common(4):
    print(f"{palabra:8} {'#' * veces} ({veces})")
`,
  },
  {
    id: 'clases',
    title: 'Animales con clases',
    emoji: '🐶',
    blurb: 'Herencia y polimorfismo',
    code: `class Animal:
    def __init__(self, nombre):
        self.nombre = nombre

    def hablar(self):
        return "..."

    def __repr__(self):
        return f"{type(self).__name__}({self.nombre!r})"

class Perro(Animal):
    def hablar(self):
        return "¡Guau!"

class Gato(Animal):
    def hablar(self):
        return "Miau"

for a in [Perro("Toby"), Gato("Misu"), Animal("Algo")]:
    print(a, "dice", a.hablar())
`,
  },
  {
    id: 'azar',
    title: 'Números al azar (con semilla)',
    emoji: '🎲',
    blurb: 'random reproducible',
    code: `import random

random.seed(42)
print([random.randint(1, 6) for _ in range(10)])
print(random.choice(["piedra", "papel", "tijera"]))
`,
  },
  {
    id: 'archivos',
    title: 'Escribir y leer un archivo',
    emoji: '📄',
    blurb: 'with open(...)',
    code: `with open("notas.txt", "w") as f:
    f.write("primera línea\\n")
    f.write("segunda línea\\n")

with open("notas.txt") as f:
    for i, linea in enumerate(f, start=1):
        print(i, linea.rstrip())
`,
  },
  {
    id: 'json',
    title: 'JSON',
    emoji: '🧾',
    blurb: 'Serializar datos',
    code: `import json

persona = {"nombre": "Ada", "lenguajes": ["Python", "C"], "activa": True}
texto = json.dumps(persona, indent=2, ensure_ascii=False)
print(texto)
print(json.loads(texto)["lenguajes"][0])
`,
  },
  {
    id: 'decorador',
    title: 'Un decorador',
    emoji: '🎀',
    blurb: 'Funciones que envuelven funciones',
    code: `import functools

def anunciar(func):
    @functools.wraps(func)
    def envoltura(*args, **kwargs):
        print(f"Llamando a {func.__name__}{args}")
        resultado = func(*args, **kwargs)
        print(f"  -> {resultado}")
        return resultado
    return envoltura

@anunciar
def suma(a, b):
    return a + b

suma(2, 3)
suma(10, 5)
`,
  },
  {
    id: 'asyncio',
    title: 'Tareas con asyncio',
    emoji: '⚡',
    blurb: 'async / await',
    code: `import asyncio

async def tarea(nombre, segundos):
    await asyncio.sleep(segundos)
    print(f"{nombre} terminó tras {segundos} s")
    return nombre.upper()

async def main():
    resultados = await asyncio.gather(tarea("a", 2), tarea("b", 1), tarea("c", 3))
    print(resultados)

asyncio.run(main())
`,
  },
];
