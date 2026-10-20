import { fill, illus, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyWorld } from '../pybuild';
import { all, calls, cls, expr, func, stdout, truthy, uses } from '../pycheck';

/** Código de Python tal cual (las barras invertidas no se interpretan), sin el salto inicial ni el final. */
const c = (s: TemplateStringsArray): string => s.raw[0].replace(/^\n/, '').replace(/\s+$/, '');

/** Expresión que vale True si ejecutar `stmt` (con las clases del alumno) lanza `tipo`. */
const lanza = (stmt: string, tipo: string): string => `(lambda g: (exec(${JSON.stringify(`try:\n    ${stmt}\nexcept ${tipo}:\n    ok = True\nelse:\n    ok = False`)}, g), g['ok'])[1])(dict(globals()))`;

const PERRO = c`
class Perro:
    def __init__(self, nombre, edad):
        self.nombre = nombre
        self.edad = edad

    def ladrar(self):
        return f"{self.nombre} dice: ¡Guau!"
`;

export const py9 = pyWorld({
  id: 'py9',
  index: 9,
  title: 'Objetos y clases',
  subtitle: 'Modela el mundo con tus propios tipos',
  emoji: '🏛️',
  color: '#FBBF24',
  level: 'avanzado',
  intro:
    'Todo en Python es un objeto, y con las **clases** puedes crear los tuyos: una cuenta bancaria, un vector, un producto, un personaje… En esta zona aprenderás a **definir clases**, a proteger sus datos con propiedades, a **reutilizar código con herencia**, a hacer que tus objetos funcionen con los operadores y funciones de Python (`+`, `len`, `print`…) y a **componer** objetos pequeños en sistemas más grandes.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py9-1', { title: 'Tu primera clase', summary: 'class, __init__, self, atributos y métodos', emoji: '🏗️', commands: ['class', '__init__', 'self', 'hasattr'], minutes: 15 }, [
      learn(
        'Clases y objetos',
        `
Ya usas objetos sin saberlo: cada texto, lista o diccionario es un **objeto** con sus **datos** y sus **operaciones** (\`"hola".upper()\`, \`lista.append(3)\`).

- Una **clase** es el *plano* que describe cómo son y qué pueden hacer los objetos de un tipo.
- Un **objeto** (o **instancia**) es una pieza concreta construida con ese plano. De una clase puedes crear tantas instancias como quieras, cada una con **sus propios datos**.
- Los datos de un objeto se llaman **atributos**; sus operaciones, **métodos** (funciones definidas dentro de la clase).

\`\`\`
class Perro:
    def __init__(self, nombre, edad):
        self.nombre = nombre
        self.edad = edad

    def ladrar(self):
        return f"{self.nombre} dice: ¡Guau!"
\`\`\`
`,
        '🏗️',
      ),
      pyDemo('Crear y usar objetos', [
        [PERRO + '\n\nrex = Perro("Rex", 3)\nluna = Perro("Luna", 5)\nprint(rex.nombre, rex.edad)\nprint(luna.ladrar())\nprint(type(rex).__name__, isinstance(rex, Perro))', 'Dos objetos de la misma clase, con datos distintos'],
      ]),
      illus('py-class-instance', 'De la clase a las instancias', 'La clase es el molde; cada instancia que se crea guarda su propio estado.'),
      learn(
        '__init__ y self',
        `
- **\`__init__\`** es el *inicializador*: Python lo ejecuta automáticamente al crear el objeto, con los argumentos de \`Perro("Rex", 3)\`. Aquí preparas los atributos iniciales. **No devuelve nada** (siempre \`None\`).
- **\`self\`** es el propio objeto sobre el que se llama al método. Es el **primer parámetro** de todos los métodos de instancia; Python lo pasa solo: \`rex.ladrar()\` es lo mismo que \`Perro.ladrar(rex)\`.
- Los atributos nacen cuando los asignas: \`self.nombre = nombre\`.

> CLAVE: dentro de la clase, los datos del objeto siempre se leen y escriben con \`self.\`. Sin \`self.\`, \`nombre\` es solo una variable local que desaparece al terminar el método.

Convenciones: clases en **CamelCase** (\`CuentaBancaria\`), métodos y atributos en **snake_case**.
`,
      ),
      pyDemo(
        'Cada objeto tiene su estado',
        [
          [PERRO + '\n\nrex = Perro("Rex", 3)\nprint(rex.ladrar())\nprint(Perro.ladrar(rex))', 'Las dos formas son equivalentes'],
          [PERRO + '\n\na = Perro("A", 1)\nb = Perro("B", 2)\na.edad += 1\nprint(a.edad, b.edad)\nc = a\nc.edad = 99\nprint(a.edad, a is c)', '`c = a` no copia: son el mismo objeto'],
          pyErr(PERRO + '\n\nrex = Perro("Rex", 3)\nrex.volar()', 'El objeto no tiene ese método: `AttributeError`'),
          pyErr(PERRO + '\n\nPerro("Rex")', 'Falta un argumento del `__init__`: `TypeError`'),
        ],
      ),
      learn(
        'Métodos que cambian el estado',
        `
Los métodos pueden **leer y modificar** los atributos con \`self\`. Así un objeto «recuerda» lo que le ha pasado, y protege sus propias reglas (p. ej. no permitir un saldo negativo):

\`\`\`
class Cuenta:
    def __init__(self, titular, saldo=0):
        self.titular = titular
        self.saldo = saldo

    def depositar(self, monto):
        self.saldo += monto

    def retirar(self, monto):
        if monto > self.saldo:
            raise ValueError("Saldo insuficiente")
        self.saldo -= monto
\`\`\`

Con \`hasattr(obj, "saldo")\` compruebas si un objeto tiene cierto atributo; \`getattr\`/\`setattr\` los leen y escriben por nombre.
`,
      ),
      pyDemo('Una cuenta con reglas', [
        [c`
class Cuenta:
    def __init__(self, titular, saldo=0):
        self.titular = titular
        self.saldo = saldo

    def depositar(self, monto):
        self.saldo += monto

    def retirar(self, monto):
        if monto > self.saldo:
            raise ValueError("Saldo insuficiente")
        self.saldo -= monto

ana = Cuenta("Ana", 100)
ana.depositar(50)
ana.retirar(30)
print(ana.titular, ana.saldo)
try:
    ana.retirar(500)
except ValueError as e:
    print("Error:", e)
print(hasattr(ana, "saldo"), hasattr(ana, "email"))
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
class Contador:
    def __init__(self):
        self.n = 0

    def subir(self):
        self.n += 1

a = Contador()
b = Contador()
a.subir()
a.subir()
b.subir()
print(a.n, b.n)
`,
        ['3 3', '1 1', '2 2'],
        'Cada instancia tiene su propio `n`: `a` sube dos veces (2) y `b` una (1). Los atributos de instancia no se comparten.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class Caja:
    def __init__(self):
        self.items = []

a = Caja()
b = a
b.items.append("x")
print(a.items, a is b)
`,
        ["[] False", "[] True", "['x'] False"],
        '`b = a` no crea otra caja: son **el mismo objeto** con dos nombres. Lo que se añade por `b` se ve por `a`.',
      ),
      mc('¿Qué es `self` dentro de un método?', ['Una palabra reservada que crea la clase', 'El propio objeto sobre el que se llama al método', 'El nombre de la clase', 'Un atributo especial de solo lectura'], 1, '`self` es el objeto concreto: `rex.ladrar()` se ejecuta con `self` apuntando a `rex`. Es una convención (podría llamarse de otra forma), pero no cambies el nombre.'),
      tf('El método `__init__` debe devolver el objeto que se acaba de crear.', false, '`__init__` solo **inicializa**: debe devolver `None`. Python se encarga de crear el objeto y devolvértelo al llamar a `Perro(...)`.'),
      match(
        'Une cada término con su significado',
        [
          ['Clase', 'El plano que describe un tipo de objetos'],
          ['Instancia', 'Un objeto concreto creado a partir de una clase'],
          ['Atributo', 'Un dato guardado en el objeto'],
          ['Método', 'Una función definida dentro de la clase'],
        ],
        'Clase = molde; instancia = pieza; atributo = dato; método = acción.',
      ),
      fill('Completa el primer parámetro de todo método de instancia', 'class Punto:\n    def __init__(___, x, y):\n        self.x = x\n        self.y = y', ['self', 'this', 'cls', 'punto'], ['self'], 'Por convención el primer parámetro de los métodos de instancia es `self`.'),
      pyPractice({
        goal: 'Un rectángulo',
        prompt: 'Define la clase `Rectangulo` con atributos `ancho` y `alto` (se pasan al crearlo) y los métodos `area()` y `perimetro()`.',
        starter: '',
        check: all(cls('Rectangulo', ['area', 'perimetro']), calls([['Rectangulo(3, 4).area()', '12'], ['Rectangulo(3, 4).perimetro()', '14'], ['Rectangulo(5, 5).area()', '25']])),
        solution: c`
class Rectangulo:
    def __init__(self, ancho, alto):
        self.ancho = ancho
        self.alto = alto

    def area(self):
        return self.ancho * self.alto

    def perimetro(self):
        return 2 * (self.ancho + self.alto)
`,
        hints: ['`__init__(self, ancho, alto)` guarda los dos valores en `self.ancho` y `self.alto`.', 'Los métodos usan `self.ancho` y `self.alto`: `return self.ancho * self.alto`.'],
        explain: 'Los datos (ancho, alto) viajan con el objeto, así los métodos no necesitan recibirlos como parámetros.',
        commands: ['class', '__init__', 'self'],
      }),
      pyPractice({
        goal: 'Un contador',
        prompt: 'Define la clase `Contador` con un atributo `valor` que empieza en 0, y los métodos `subir()` (suma 1), `bajar()` (resta 1, sin bajar de 0) y `reiniciar()` (lo deja en 0).',
        starter: '',
        check: all(cls('Contador', ['subir', 'bajar', 'reiniciar']), calls([['Contador().valor', '0'], ['(lambda c: (c.subir(), c.subir(), c.bajar(), c.valor)[-1])(Contador())', '1'], ['(lambda c: (c.bajar(), c.valor)[-1])(Contador())', '0'], ['(lambda c: (c.subir(), c.reiniciar(), c.valor)[-1])(Contador())', '0']])),
        solution: c`
class Contador:
    def __init__(self):
        self.valor = 0

    def subir(self):
        self.valor += 1

    def bajar(self):
        if self.valor > 0:
            self.valor -= 1

    def reiniciar(self):
        self.valor = 0
`,
        hints: ['`__init__` crea `self.valor = 0`.', 'En `bajar`, resta solo si `self.valor > 0`.'],
        explain: 'El objeto guarda su estado y sus métodos lo modifican respetando las reglas (aquí, nunca negativo).',
        commands: ['class', 'self'],
      }),
      pyPractice({
        goal: 'Cuenta bancaria',
        prompt: 'Completa la clase `Cuenta`: `__init__(titular, saldo=0)`, `depositar(monto)` y `retirar(monto)`. Si se intenta retirar más que el saldo debe lanzar `ValueError("Saldo insuficiente")`. Deja el programa de abajo tal cual.',
        starter: c`
# Escribe aquí la clase Cuenta

cuenta = Cuenta("Ana", 100)
cuenta.depositar(50)
print(cuenta.saldo)
try:
    cuenta.retirar(500)
except ValueError as e:
    print("Error:", e)
cuenta.retirar(30)
print(cuenta.saldo)
` + '\n',
        check: all(cls('Cuenta', ['depositar', 'retirar']), stdout('150\nError: Saldo insuficiente\n120')),
        solution: c`
class Cuenta:
    def __init__(self, titular, saldo=0):
        self.titular = titular
        self.saldo = saldo

    def depositar(self, monto):
        self.saldo += monto

    def retirar(self, monto):
        if monto > self.saldo:
            raise ValueError("Saldo insuficiente")
        self.saldo -= monto

cuenta = Cuenta("Ana", 100)
cuenta.depositar(50)
print(cuenta.saldo)
try:
    cuenta.retirar(500)
except ValueError as e:
    print("Error:", e)
cuenta.retirar(30)
print(cuenta.saldo)
`,
        hints: ['El `saldo` por defecto es 0: `def __init__(self, titular, saldo=0)`.', 'En `retirar`: `if monto > self.saldo: raise ValueError("Saldo insuficiente")` antes de restar.'],
        explain: 'Fíjate en que la propia clase protege sus reglas: quien la usa no puede dejar la cuenta en un estado inválido sin enterarse.',
        commands: ['class', '__init__', 'raise'],
      }),
      pyCode('Añade a `Persona` un método `presentarse()` que devuelva `"Hola, soy Ana"` para `Persona("Ana")`, y guarda ese resultado en `msg`.', {
        starter: c`
class Persona:
    def __init__(self, nombre):
        self.nombre = nombre

` + '\n',
        check: all(cls('Persona', ['presentarse']), expr('msg', "'Hola, soy Ana'")),
        solution: c`
class Persona:
    def __init__(self, nombre):
        self.nombre = nombre

    def presentarse(self):
        return f"Hola, soy {self.nombre}"

msg = Persona("Ana").presentarse()
`,
        hint: 'Dentro del método, el nombre está en `self.nombre`.',
        why: 'Los métodos acceden a los datos del objeto a través de `self`.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py9-2', { title: 'Atributos y @property', summary: 'Atributos de clase e instancia, encapsulación y propiedades', emoji: '🔐', commands: ['atributos', 'property', 'getattr', 'setattr'], minutes: 14 }, [
      learn(
        'Atributos de instancia y de clase',
        `
Hay dos sitios donde guardar datos:

- **De instancia**: se crean con \`self.x = ...\` y son **propios** de cada objeto.
- **De clase**: se escriben directamente en el cuerpo de la clase y son **compartidos** por todas las instancias (constantes, contadores, valores por defecto).

Al leer \`obj.x\`, Python busca primero en el **objeto** y, si no está, en su **clase**. Si *asignas* \`obj.x = ...\`, creas un atributo de instancia que **oculta** el de la clase solo para ese objeto; para cambiar el compartido hay que usar \`Clase.x\`.
`,
        '🔐',
      ),
      pyDemo('Compartido vs propio', [
        [c`
class Perro:
    especie = "Canis familiaris"
    total = 0

    def __init__(self, nombre):
        self.nombre = nombre
        Perro.total += 1

a = Perro("Rex")
b = Perro("Luna")
print(a.especie, b.especie, Perro.total)
a.especie = "Lobo"
print(a.especie, b.especie, Perro.especie)
`, 'Asignar por la instancia oculta el atributo de clase solo en esa instancia'],
        ['class A:\n    lista = []\n\na = A()\nb = A()\na.lista.append(1)\nprint(b.lista)', '¡Cuidado! Un atributo de clase **mutable** se comparte entre todas'],
      ]),
      learn(
        'Encapsulación «a la Python»',
        `
Python no tiene atributos realmente privados; se basa en **convenciones**:

- \`_nombre\` → «uso interno, no lo toques desde fuera».
- \`__nombre\` (dos guiones bajos) → Python lo renombra a \`_Clase__nombre\` (*name mangling*) para evitar choques en subclases; es un aviso fuerte, no una cerradura.

La idea: la clase expone una **interfaz pública** (métodos y propiedades) y se reserva libertad para cambiar su interior.
`,
      ),
      learn(
        '@property: atributos con lógica',
        `
Una **propiedad** se usa como un atributo (\`obj.edad\`, sin paréntesis) pero ejecuta código: sirve para **validar**, **calcular** o hacer de **solo lectura**.

\`\`\`
class Temperatura:
    def __init__(self, celsius):
        self.celsius = celsius        # pasa por el setter

    @property
    def celsius(self):
        return self._c

    @celsius.setter
    def celsius(self, valor):
        if valor < -273.15:
            raise ValueError("por debajo del cero absoluto")
        self._c = valor

    @property
    def fahrenheit(self):             # solo lectura, calculada
        return self._c * 9 / 5 + 32
\`\`\`

El valor real se guarda en \`_c\`; fuera se usa \`t.celsius\` y \`t.fahrenheit\`. Si más adelante cambias cómo se guarda, **el código que usa la clase no cambia**.
`,
      ),
      pyDemo(
        'Propiedades',
        [
          [c`
class Temperatura:
    def __init__(self, celsius):
        self.celsius = celsius

    @property
    def celsius(self):
        return self._c

    @celsius.setter
    def celsius(self, valor):
        if valor < -273.15:
            raise ValueError("por debajo del cero absoluto")
        self._c = valor

    @property
    def fahrenheit(self):
        return self._c * 9 / 5 + 32

t = Temperatura(100)
print(t.celsius, t.fahrenheit)
t.celsius = 0
print(t.fahrenheit)
`],
          pyErr('class T:\n    def __init__(self):\n        self._c = 0\n\n    @property\n    def f(self):\n        return self._c * 2\n\nT().f = 5', 'Sin setter la propiedad es de solo lectura: `AttributeError`'),
          [c`
class Banco:
    def __init__(self):
        self.__clave = "1234"

b = Banco()
print(hasattr(b, "__clave"), b._Banco__clave)
`, 'El «name mangling»: no impide el acceso, solo avisa'],
        ],
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class A:
    x = 1

a = A()
b = A()
a.x = 5
A.x = 9
print(a.x, b.x, A.x)
`,
        ['9 9 9', '5 1 9', '5 5 9'],
        '`a.x = 5` crea un atributo propio de `a` que oculta al de la clase. `A.x = 9` cambia el compartido, que es el que ve `b`.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class Circulo:
    def __init__(self, r):
        self.r = r

    @property
    def diametro(self):
        return self.r * 2

c = Circulo(3)
c.r = 10
print(c.diametro)
`,
        ['6', '3', '10'],
        'La propiedad **se calcula cada vez que se lee**, con el valor actual de `r` (10), así que el diámetro es 20. No hay un valor guardado que se quede desfasado.',
      ),
      mc('¿Para qué sirve `@property`?', ['Para que un método se use como un atributo, con lógica detrás', 'Para hacer privado un método', 'Para compartir un dato entre instancias', 'Para crear una constante'], 0, 'Permite escribir `obj.dato` mientras se ejecuta código (validar, calcular…), manteniendo una interfaz sencilla.'),
      tf('Un atributo cuyo nombre empieza por `_` es realmente privado: Python impide acceder a él desde fuera.', false, 'Es solo una convención («no lo toques»). Python no bloquea el acceso; confía en que los programadores respeten la interfaz pública.'),
      fill('Completa para definir el setter de la propiedad `celsius`', '@celsius.___\ndef celsius(self, valor):\n    self._c = valor', ['setter', 'getter', 'set', 'property'], ['setter'], 'Tras definir `@property def celsius`, el setter se declara con `@celsius.setter`.'),
      match(
        'Une cada elemento con su significado',
        [
          ['x = 1 en el cuerpo de la clase', 'Atributo de clase (compartido)'],
          ['self.x = 1 en __init__', 'Atributo de instancia (propio)'],
          ['_x', 'Privado por convención'],
          ['@property', 'Método que se usa como atributo'],
        ],
        'Distinguir qué es compartido y qué es propio evita muchos errores sutiles.',
      ),
      pyPractice({
        goal: 'Contar instancias',
        prompt: 'Crea la clase `Robot` con un atributo de **clase** `total` que cuente cuántos robots se han creado, y un atributo de instancia `nombre`. Crea tres robots al final del programa.',
        starter: 'class Robot:\n    pass\n\n# Crea tres robots aquí\n',
        check: all(expr('Robot.total', '3'), calls([["(Robot('z'), Robot.total)[1]", '4'], ["Robot('x').nombre", "'x'"]])),
        solution: c`
class Robot:
    total = 0

    def __init__(self, nombre):
        self.nombre = nombre
        Robot.total += 1

r1 = Robot("R1")
r2 = Robot("R2")
r3 = Robot("R3")
`,
        hints: ['Define `total = 0` directamente en el cuerpo de la clase.', 'En `__init__`, súmale uno con `Robot.total += 1` (si usaras `self.total` crearías uno de instancia).'],
        explain: 'El contador vive en la clase, no en cada robot, así que todos lo comparten.',
        commands: ['atributos'],
      }),
      pyPractice({
        goal: 'Temperatura validada',
        prompt: 'Define `Temperatura(celsius)` con la propiedad `celsius` (que lance `ValueError` si el valor es menor que −273.15) y una propiedad de **solo lectura** `fahrenheit`.',
        starter: '',
        check: all(cls('Temperatura'), calls([['Temperatura(100).fahrenheit', '212.0'], ['Temperatura(0).fahrenheit', '32.0'], ["(lambda t: (setattr(t, 'celsius', 25), t.celsius)[1])(Temperatura(0))", '25']]), truthy(lanza('Temperatura(-300)', 'ValueError')), truthy(lanza('Temperatura(0).fahrenheit = 1', 'AttributeError')), uses('decorator:property')),
        solution: c`
class Temperatura:
    def __init__(self, celsius):
        self.celsius = celsius

    @property
    def celsius(self):
        return self._c

    @celsius.setter
    def celsius(self, valor):
        if valor < -273.15:
            raise ValueError("por debajo del cero absoluto")
        self._c = valor

    @property
    def fahrenheit(self):
        return self._c * 9 / 5 + 32
`,
        hints: ['En `__init__` asigna `self.celsius = celsius` para que pase por el setter.', 'Guarda el valor real en `self._c`. `fahrenheit` solo lleva `@property` (sin setter).'],
        explain: 'La validación está en un único sitio (el setter) y se aplica siempre, incluso al crear el objeto.',
        commands: ['property'],
      }),
      pyPractice({
        goal: 'Edad válida',
        prompt: 'Define `Persona(nombre, edad)` donde `edad` es una propiedad que lanza `ValueError("Edad inválida")` si el valor es negativo (también al crear la persona).',
        starter: '',
        check: all(cls('Persona'), calls([["Persona('Ana', 30).edad", '30'], ["(lambda p: (setattr(p, 'edad', 31), p.edad)[1])(Persona('Ana', 30))", '31'], ["Persona('Ana', 30).nombre", "'Ana'"]]), truthy(lanza("Persona('Ana', -1)", 'ValueError')), truthy(lanza("setattr(Persona('Ana', 3), 'edad', -5)", 'ValueError'))),
        solution: c`
class Persona:
    def __init__(self, nombre, edad):
        self.nombre = nombre
        self.edad = edad

    @property
    def edad(self):
        return self._edad

    @edad.setter
    def edad(self, valor):
        if valor < 0:
            raise ValueError("Edad inválida")
        self._edad = valor
`,
        hints: ['Necesitas `@property` y `@edad.setter`.', 'Guarda el dato en `self._edad`, no en `self.edad` (sería recursivo).'],
        explain: 'Si guardaras en `self.edad` dentro del setter, se llamaría a sí mismo sin fin. Por eso el valor real va en `_edad`.',
        commands: ['property', 'setattr'],
      }),
      pyCode('Añade a `Cuadrado` una **propiedad** `area` (se lee sin paréntesis: `Cuadrado(4).area` vale 16).', {
        starter: c`
class Cuadrado:
    def __init__(self, lado):
        self.lado = lado
` + '\n',
        check: all(expr('Cuadrado(4).area', '16'), uses('decorator:property')),
        solution: c`
class Cuadrado:
    def __init__(self, lado):
        self.lado = lado

    @property
    def area(self):
        return self.lado ** 2
`,
        hint: 'Un método decorado con `@property` se lee como un atributo.',
        why: 'El área se calcula al leerla, así nunca queda desfasada si cambia `lado`.',
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py9-3', { title: 'Herencia y polimorfismo', summary: 'Subclases, super(), sobrescribir y el orden MRO', emoji: '🧬', commands: ['herencia', 'super', 'issubclass', 'isinstance', 'mro'], minutes: 16 }, [
      learn(
        'Heredar: reutilizar y especializar',
        `
Con la **herencia**, una clase (la **subclase** o *hija*) toma todo lo de otra (la **base** o *madre*) y puede **añadir** o **sobrescribir** cosas:

\`\`\`
class Animal:
    def __init__(self, nombre):
        self.nombre = nombre

    def hablar(self):
        return "..."

class Perro(Animal):          # Perro ES UN Animal
    def hablar(self):
        return "¡Guau!"
\`\`\`

- Úsala para relaciones **«es un»** (un perro *es un* animal).
- \`isinstance(x, Animal)\` es verdadero también para los perros; \`issubclass(Perro, Animal)\` comprueba la relación entre clases.
- Con **\`super()\`** accedes a la versión de la clase base, p. ej. \`super().__init__(nombre)\` para que la base prepare sus atributos.
- **Polimorfismo**: objetos distintos responden al mismo mensaje (\`hablar()\`) cada uno a su manera, y el código que los usa no necesita saber de qué tipo son.
`,
        '🧬',
      ),
      pyDemo(
        'Animales',
        [
          [c`
class Animal:
    def __init__(self, nombre):
        self.nombre = nombre

    def hablar(self):
        return "..."

    def presentarse(self):
        return f"{self.nombre} dice {self.hablar()}"

class Perro(Animal):
    def hablar(self):
        return "¡Guau!"

class Gato(Animal):
    def __init__(self, nombre, interior=True):
        super().__init__(nombre)
        self.interior = interior

    def hablar(self):
        return "Miau"

for a in [Perro("Rex"), Gato("Tom"), Animal("Bicho")]:
    print(a.presentarse())
`, 'Mismo mensaje, respuestas distintas: polimorfismo'],
          [c`
class Animal: pass
class Perro(Animal): pass

rex = Perro()
print(isinstance(rex, Perro), isinstance(rex, Animal), isinstance(Animal(), Perro))
print(issubclass(Perro, Animal), issubclass(Animal, Perro))
print(Perro.__bases__, Perro.__mro__)
`],
        ],
      ),
      illus('py-mro', 'El orden de búsqueda (MRO)', 'Python busca cada método en la clase y luego en sus bases, siguiendo el orden de resolución de métodos.'),
      learn(
        'Herencia múltiple y MRO',
        `
Una clase puede heredar de **varias**: \`class D(B, C)\`. Cuando un nombre existe en varias bases, Python usa el **MRO** (*Method Resolution Order*): una lista ordenada y coherente que puedes ver con \`D.__mro__\`.

- Se busca de **izquierda a derecha**, pero una base siempre va **después** de todas sus hijas.
- \`super()\` no significa «mi padre», sino **«la siguiente clase en el MRO»**. Gracias a eso, si todas las clases llaman a \`super()\`, cada una se ejecuta una sola vez (incluso en un «diamante»).

Úsala con cabeza: la herencia múltiple se reserva para *mixins* (pequeñas clases que añaden una capacidad).
`,
      ),
      pyDemo('El diamante', [
        [c`
class A:
    def quien(self):
        return "A"

class B(A):
    def quien(self):
        return "B" + super().quien()

class C(A):
    def quien(self):
        return "C" + super().quien()

class D(B, C):
    def quien(self):
        return "D" + super().quien()

print(D().quien())
print([k.__name__ for k in D.__mro__])
`, '`D → B → C → A → object`: cada clase una sola vez'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
class A:
    def hola(self):
        return "A"

class B(A):
    def hola(self):
        return "B" + super().hola()

print(B().hola(), isinstance(B(), A), issubclass(A, B))
`,
        ['A True False', 'BA True True', 'BA False False'],
        '`B.hola` añade «B» a lo que devuelve la de `A`: «BA». Un `B` es también un `A` (True), pero `A` no es subclase de `B` (False).',
      ),
      mc('¿Qué hace `super()` en un método?', ['Crea un objeto nuevo', 'Da acceso a la siguiente clase del MRO (normalmente la base)', 'Borra el método de la clase base', 'Convierte la clase en abstracta'], 1, '`super()` delega en la siguiente clase del orden de búsqueda; es la forma estándar de ampliar el comportamiento heredado.'),
      tf('Si una subclase define su propio `__init__` sin llamar a `super().__init__()`, los atributos creados por el `__init__` de la base no se crean.', true, 'El `__init__` de la base solo se ejecuta si lo llamas tú. Olvidar `super().__init__()` es un error clásico (aparece un `AttributeError` más tarde).'),
      fill('Completa para inicializar la clase base', 'class Gato(Animal):\n    def __init__(self, nombre):\n        super().___(nombre)', ['__init__', 'init', '__new__', 'self'], ['__init__'], '`super().__init__(...)` ejecuta el inicializador de la base.'),
      match(
        'Une cada expresión con lo que significa',
        [
          ['isinstance(x, C)', 'x es instancia de C o de una subclase'],
          ['issubclass(A, B)', 'A hereda de B'],
          ['super()', 'La siguiente clase en el MRO'],
          ['C.__mro__', 'Orden en que se buscan los métodos'],
        ],
        'Son las herramientas básicas para razonar sobre jerarquías.',
      ),
      pyPractice({
        goal: 'Figuras',
        prompt: 'Crea `Figura(nombre)` con `area()` (devuelve 0) y `descripcion()` que devuelve `"<nombre>: área <área con 2 decimales>"`. Después `Cuadrado(lado)` y `Circulo(radio)`, subclases que sobrescriben `area()` (usa `math.pi`). Sus nombres son `"cuadrado"` y `"círculo"`.',
        starter: 'import math\n',
        check: all(cls('Figura'), cls('Cuadrado'), cls('Circulo'), truthy('issubclass(Cuadrado, Figura) and issubclass(Circulo, Figura)'), calls([['Cuadrado(3).descripcion()', "'cuadrado: área 9.00'"], ['Circulo(1).descripcion()', "'círculo: área 3.14'"], ['Figura("f").descripcion()', "'f: área 0.00'"]])),
        solution: c`
import math

class Figura:
    def __init__(self, nombre):
        self.nombre = nombre

    def area(self):
        return 0

    def descripcion(self):
        return f"{self.nombre}: área {self.area():.2f}"

class Cuadrado(Figura):
    def __init__(self, lado):
        super().__init__("cuadrado")
        self.lado = lado

    def area(self):
        return self.lado ** 2

class Circulo(Figura):
    def __init__(self, radio):
        super().__init__("círculo")
        self.radio = radio

    def area(self):
        return math.pi * self.radio ** 2
`,
        hints: ['Las subclases llaman a `super().__init__("cuadrado")`.', '`descripcion` está en la base y llama a `self.area()`: cada subclase aporta la suya (polimorfismo).'],
        explain: '`descripcion()` se escribe una sola vez y funciona para cualquier figura, porque `self.area()` resuelve a la versión de cada subclase.',
        commands: ['herencia', 'super'],
      }),
      pyPractice({
        goal: 'Nómina',
        prompt: 'Define `Empleado(nombre, salario)` con `pagar()` (devuelve el salario) y `Gerente(nombre, salario, bono)`, subclase cuyo `pagar()` devuelve el salario **más el bono** (reutiliza el de la base con `super()`). Define también `total_nomina(personas)` que sume lo que se paga a todos.',
        starter: '',
        check: all(cls('Empleado'), cls('Gerente'), func('total_nomina', 1), calls([['Empleado("a", 1000).pagar()', '1000'], ['Gerente("b", 2000, 500).pagar()', '2500'], ['total_nomina([Empleado("a", 1000), Gerente("b", 2000, 500)])', '3500']]), truthy('issubclass(Gerente, Empleado)')),
        solution: c`
class Empleado:
    def __init__(self, nombre, salario):
        self.nombre = nombre
        self.salario = salario

    def pagar(self):
        return self.salario

class Gerente(Empleado):
    def __init__(self, nombre, salario, bono):
        super().__init__(nombre, salario)
        self.bono = bono

    def pagar(self):
        return super().pagar() + self.bono

def total_nomina(personas):
    return sum(p.pagar() for p in personas)
`,
        hints: ['`Gerente.__init__` llama a `super().__init__(nombre, salario)` y guarda `self.bono`.', '`total_nomina` no necesita saber qué tipo es cada persona: solo llama a `p.pagar()`.'],
        explain: 'Eso es polimorfismo: `total_nomina` funciona con cualquier objeto que sepa `pagar()`, y mañana podrías añadir otros tipos sin tocarla.',
        commands: ['super', 'isinstance'],
      }),
      pyCode('Haz que `Cachorro` herede de `Perro` y sobrescriba `ladrar()` para devolver `"guau"`.', {
        starter: c`
class Perro:
    def ladrar(self):
        return "GUAU"

` + '\n',
        check: all(truthy('issubclass(Cachorro, Perro)'), calls([['Cachorro().ladrar()', "'guau'"], ['Perro().ladrar()', "'GUAU'"]])),
        solution: c`
class Perro:
    def ladrar(self):
        return "GUAU"

class Cachorro(Perro):
    def ladrar(self):
        return "guau"
`,
        hint: '`class Cachorro(Perro):` y redefine el método con el mismo nombre.',
        why: 'Sobrescribir = definir en la subclase un método con el mismo nombre: Python usa el de la subclase.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py9-4', { title: 'Métodos especiales', summary: 'Haz que tus objetos funcionen con print, len, +, ==, sorted…', emoji: '✨', commands: ['__repr__', '__str__', '__eq__', '__lt__', '__len__', '__getitem__', '__add__', '__call__'], minutes: 16 }, [
      learn(
        'El protocolo «dunder»',
        `
Los métodos con **doble guion bajo** (*dunder*: \`__init__\`, \`__len__\`…) son los ganchos con los que Python integra tus clases en el lenguaje. Cuando escribes \`len(x)\`, Python llama a \`x.__len__()\`; con \`a + b\`, a \`a.__add__(b)\`. Definirlos hace que tus objetos se sientan **nativos**:

| Método | Lo usa Python en… |
|---|---|
| \`__repr__\` | \`repr(x)\`, la consola, listas y depuración (debe ser claro e inequívoco) |
| \`__str__\` | \`str(x)\` y \`print(x)\` (versión «amigable»; si falta, usa \`__repr__\`) |
| \`__eq__\` | \`a == b\` |
| \`__lt__\` | \`a < b\` y \`sorted()\` |
| \`__len__\` | \`len(x)\` |
| \`__getitem__\` | \`x[i]\`, cortes y, de rebote, recorrer con \`for\` |
| \`__contains__\` | \`y in x\` |
| \`__add__\`, \`__mul__\`… | \`+\`, \`*\`… |
| \`__bool__\` | \`if x:\` |
| \`__call__\` | \`x(...)\` (objetos «llamables») |

> CLAVE: tú **no** llamas a estos métodos directamente (\`x.__len__()\`): usas la función u operador, y Python hace el resto.
`,
        '✨',
      ),
      pyDemo('Un vector con operadores', [
        [c`
class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

    def __add__(self, otro):
        return Vector(self.x + otro.x, self.y + otro.y)

    def __mul__(self, k):
        return Vector(self.x * k, self.y * k)

    def __eq__(self, otro):
        return isinstance(otro, Vector) and (self.x, self.y) == (otro.x, otro.y)

    def __abs__(self):
        return (self.x ** 2 + self.y ** 2) ** 0.5

a = Vector(1, 2)
b = Vector(3, 4)
print(a + b)
print(a * 3)
print(a == Vector(1, 2), a == b)
print(abs(b))
`],
      ]),
      pyDemo('Contenedores: len, índices y bucles', [
        [c`
class Playlist:
    def __init__(self, canciones):
        self.canciones = list(canciones)

    def __len__(self):
        return len(self.canciones)

    def __getitem__(self, i):
        return self.canciones[i]

    def __contains__(self, cancion):
        return cancion in self.canciones

p = Playlist(["Alba", "Brisa", "Cima"])
print(len(p), p[0], p[-1], p[0:2])
print("Brisa" in p)
for c in p:
    print("♪", c)
print(list(reversed(p)))
`, 'Con `__len__` y `__getitem__` ya funcionan `len`, índices, cortes, `for` y `reversed`'],
      ]),
      learn(
        '__str__ y __repr__, orden y objetos llamables',
        `
- **\`__repr__\`**: para programadores («¿qué es esto exactamente?»). Idealmente se parece a cómo crearías el objeto. Es lo que muestran las listas.
- **\`__str__\`**: para el usuario final; \`print\` lo prefiere. Si solo defines uno, define **\`__repr__\`**.
- **\`__eq__\`**: por defecto \`==\` compara la **identidad** (¿es el mismo objeto?). Defínelo para comparar por valor.
- **\`__lt__\`**: con él \`sorted()\` y \`min()\`/\`max()\` ordenan tus objetos. (\`functools.total_ordering\` completa el resto de comparaciones.)
- **\`__call__\`**: tu objeto se usa como una función, pero **con memoria**.
`,
      ),
      pyDemo('Mostrar, comparar y llamar', [
        [c`
class Persona:
    def __init__(self, nombre, edad):
        self.nombre = nombre
        self.edad = edad

    def __repr__(self):
        return f"Persona({self.nombre!r}, {self.edad})"

    def __str__(self):
        return f"{self.nombre} ({self.edad} años)"

    def __lt__(self, otro):
        return self.edad < otro.edad

gente = [Persona("Ana", 30), Persona("Luis", 25), Persona("Eva", 41)]
print(gente[0])
print(gente)
print(sorted(gente))
print(max(gente))
`],
        [c`
class Multiplicador:
    def __init__(self, factor):
        self.factor = factor

    def __call__(self, x):
        return x * self.factor

triple = Multiplicador(3)
print(triple(5), callable(triple), list(map(triple, [1, 2, 3])))
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
class P:
    def __init__(self, n):
        self.n = n

    def __repr__(self):
        return f"P({self.n})"

    def __str__(self):
        return f"persona {self.n}"

p = P(1)
print(p)
print([p])
print(f"{p!r}")
`,
        ['P(1)\n[P(1)]\nP(1)', 'persona 1\n[persona 1]\npersona 1', 'persona 1\n[P(1)]\npersona 1'],
        '`print(p)` usa `__str__`. Dentro de una lista (y con `!r`) se usa `__repr__`.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class A:
    def __init__(self, v):
        self.v = v

a = A(1)
print(a == a, a == A(1))
`,
        ['True True', 'False False', 'False True'],
        'Sin `__eq__`, `==` compara identidad: `a` es el mismo objeto que `a` (True), pero `A(1)` es otro objeto distinto (False) aunque tenga los mismos datos.',
      ),
      mc('¿Qué método hace que `len(obj)` funcione con tu clase?', ['__size__', '__len__', '__count__', '__length__'], 1, 'Python llama a `obj.__len__()`; debe devolver un entero.'),
      tf('Si defines `__eq__` en una clase pero no `__hash__`, sus objetos dejan de poder usarse como claves de diccionario o en conjuntos.', true, 'Python pone `__hash__` a `None` cuando defines `__eq__` (igualdad por valor sin un hash coherente sería peligroso). Si quieres objetos hasheables, defínelo tú; lo verás en la zona 10.'),
      fill('Completa el método que hace funcionar el operador +', 'def ___(self, otro):\n    return Vector(self.x + otro.x, self.y + otro.y)', ['__add__', '__plus__', '__sum__', 'add'], ['__add__'], '`a + b` se traduce en `a.__add__(b)`.'),
      match(
        'Une cada operación con su método especial',
        [
          ['print(x)', '__str__'],
          ['x == y', '__eq__'],
          ['x[0]', '__getitem__'],
          ['x(3)', '__call__'],
        ],
        'Conocer la correspondencia te dice qué implementar para cada comportamiento.',
      ),
      pyPractice({
        goal: 'Vector 2D',
        prompt: 'Define `Vector(x, y)` con `__repr__` (`Vector(1, 2)`), `__add__` (suma componente a componente), `__sub__` (resta) y `__eq__` (igualdad por valor).',
        starter: '',
        check: all(cls('Vector'), calls([['Vector(1, 2) + Vector(3, 4)', 'Vector(4, 6)'], ['Vector(5, 5) - Vector(2, 1)', 'Vector(3, 4)'], ['Vector(1, 2) == Vector(1, 2)', 'True'], ['Vector(1, 2) == Vector(2, 1)', 'False'], ['repr(Vector(0, -1))', "'Vector(0, -1)'"]])),
        solution: c`
class Vector:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Vector({self.x}, {self.y})"

    def __add__(self, otro):
        return Vector(self.x + otro.x, self.y + otro.y)

    def __sub__(self, otro):
        return Vector(self.x - otro.x, self.y - otro.y)

    def __eq__(self, otro):
        return isinstance(otro, Vector) and self.x == otro.x and self.y == otro.y
`,
        hints: ['`__add__` y `__sub__` devuelven un `Vector` **nuevo**.', 'En `__eq__` comprueba que `otro` sea un `Vector` antes de comparar sus componentes.'],
        explain: 'Con cuatro métodos, `Vector` se usa con `+`, `-`, `==` y se muestra bien: «código que se lee como matemáticas».',
        commands: ['__repr__', '__add__', '__eq__'],
      }),
      pyPractice({
        goal: 'Una colección propia',
        prompt: 'Define `Pila` (de «apilar») con una lista interna: `apilar(x)`, `desapilar()` (saca y devuelve el último), `__len__` y `__bool__` (verdadera si no está vacía). Después `len(Pila())` es 0 y `bool(Pila())` es `False`.',
        starter: '',
        check: all(cls('Pila', ['apilar', 'desapilar']), calls([['len(Pila())', '0'], ['bool(Pila())', 'False'], ['(lambda p: (p.apilar(1), p.apilar(2), len(p), bool(p), p.desapilar(), len(p))[2:])(Pila())', '(2, True, 2, 1)']])),
        solution: c`
class Pila:
    def __init__(self):
        self._items = []

    def apilar(self, x):
        self._items.append(x)

    def desapilar(self):
        return self._items.pop()

    def __len__(self):
        return len(self._items)

    def __bool__(self):
        return len(self._items) > 0
`,
        hints: ['Guarda los elementos en una lista `self._items`.', '`__len__` devuelve `len(self._items)`; `__bool__` devuelve si ese número es mayor que 0.'],
        explain: 'Si defines `__len__`, Python ya usa «longitud 0 = falso», pero `__bool__` te deja decidirlo explícitamente.',
        commands: ['__len__', '__getitem__'],
      }),
      pyPractice({
        goal: 'Versiones ordenables',
        prompt: 'Define `Version(mayor, menor)` con `__repr__` (`v1.2`) y `__lt__` para que `sorted()` ordene primero por mayor y luego por menor.',
        starter: '',
        check: all(cls('Version'), expr('[repr(v) for v in sorted([Version(1, 2), Version(1, 0), Version(0, 9), Version(2, 0)])]', "['v0.9', 'v1.0', 'v1.2', 'v2.0']"), expr('repr(max([Version(1, 2), Version(1, 10)]))', "'v1.10'")),
        solution: c`
class Version:
    def __init__(self, mayor, menor):
        self.mayor = mayor
        self.menor = menor

    def __repr__(self):
        return f"v{self.mayor}.{self.menor}"

    def __lt__(self, otro):
        return (self.mayor, self.menor) < (otro.mayor, otro.menor)
`,
        hints: ['Comparar tuplas hace el trabajo: `(self.mayor, self.menor) < (otro.mayor, otro.menor)`.', 'Con solo `__lt__`, `sorted` y `max` ya funcionan.'],
        explain: 'Las tuplas se comparan elemento a elemento: es el truco estándar para ordenar por varios criterios.',
        commands: ['__lt__'],
      }),
      pyCode('Haz `Multiplicador` llamable: `Multiplicador(3)(5)` debe valer 15.', {
        starter: c`
class Multiplicador:
    def __init__(self, factor):
        self.factor = factor

` + '\n',
        check: all(expr('Multiplicador(3)(5)', '15'), expr('Multiplicador(2)(4.5)', '9.0')),
        solution: c`
class Multiplicador:
    def __init__(self, factor):
        self.factor = factor

    def __call__(self, x):
        return x * self.factor
`,
        hint: 'El método que permite «llamar» a un objeto es `__call__`.',
        why: 'Un objeto llamable es como una función con estado propio (aquí, el factor).',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py9-5', { title: 'classmethod, staticmethod y composición', summary: 'Constructores alternativos, utilidades y objetos que contienen objetos', emoji: '🧱', commands: ['classmethod', 'staticmethod', 'composicion'], minutes: 15 }, [
      learn(
        'Tres tipos de método',
        `
| Tipo | Primer parámetro | Se usa para… |
|---|---|---|
| **Método de instancia** (normal) | \`self\` (el objeto) | trabajar con los datos de un objeto |
| **\`@classmethod\`** | \`cls\` (la clase) | operaciones de la clase: sobre todo **constructores alternativos** |
| **\`@staticmethod\`** | ninguno | funciones **relacionadas** con la clase que no necesitan ni objeto ni clase |

Un *classmethod* recibe la clase, así que \`cls(...)\` construye una instancia **de la clase que lo llamó** (funciona bien con subclases). Un *staticmethod* es una función normal que, por organización, vive dentro de la clase.
`,
        '🧱',
      ),
      pyDemo('Constructor alternativo y utilidad', [
        [c`
class Fecha:
    def __init__(self, dia, mes, anio):
        self.dia, self.mes, self.anio = dia, mes, anio

    @classmethod
    def desde_texto(cls, texto):
        d, m, a = map(int, texto.split("/"))
        return cls(d, m, a)

    @staticmethod
    def es_bisiesto(anio):
        return anio % 4 == 0 and (anio % 100 != 0 or anio % 400 == 0)

    def __repr__(self):
        return f"Fecha({self.dia}, {self.mes}, {self.anio})"

f = Fecha.desde_texto("14/03/2025")
print(f, Fecha.es_bisiesto(2024), f.es_bisiesto(2100))
`, 'Se pueden llamar desde la clase o desde una instancia'],
        [c`
class Base:
    @classmethod
    def crear(cls):
        return cls()

class Hija(Base):
    pass

print(type(Base.crear()).__name__, type(Hija.crear()).__name__)
`, '`cls` es la clase que hace la llamada, no siempre `Base`'],
      ]),
      learn(
        'Composición: «tiene un»',
        `
La herencia modela **«es un»** (un perro *es un* animal). Pero muchas relaciones son **«tiene un»**: un coche *tiene un* motor; un pedido *tiene* líneas de productos. Ahí se usa **composición**: un objeto guarda otros objetos en sus atributos y les **delega** el trabajo.

\`\`\`
class Motor:
    def arrancar(self):
        return "brum"

class Coche:
    def __init__(self):
        self.motor = Motor()      # composición

    def arrancar(self):
        return self.motor.arrancar()
\`\`\`

> CLAVE: *«Prefiere composición sobre herencia»*. La herencia acopla fuertemente las clases; la composición es más flexible (puedes cambiar el motor sin tocar el coche) y evita jerarquías enormes.
`,
      ),
      pyDemo('Un pedido', [
        [c`
class Producto:
    def __init__(self, nombre, precio):
        self.nombre = nombre
        self.precio = precio

class Pedido:
    def __init__(self):
        self.lineas = []

    def agregar(self, producto, cantidad=1):
        self.lineas.append((producto, cantidad))

    def total(self):
        return sum(p.precio * n for p, n in self.lineas)

    def __len__(self):
        return len(self.lineas)

pedido = Pedido()
pedido.agregar(Producto("pan", 1.5), 2)
pedido.agregar(Producto("leche", 2.25))
print(len(pedido), pedido.total())
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
class M:
    @staticmethod
    def doble(n):
        return n * 2

print(M.doble(3), M().doble(4))
`,
        ['6 6', '6 4', 'Error'],
        'Un método estático se puede llamar tanto desde la clase como desde una instancia, y no recibe `self`: `M.doble(3)` → 6 y `M().doble(4)` → 8.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class A:
    @classmethod
    def crear(cls):
        return cls()

class B(A):
    pass

print(type(B.crear()).__name__)
`,
        ['A', 'type', 'crear'],
        '`cls` es la clase por la que se llamó: `B.crear()` construye una `B`. Por eso los constructores alternativos funcionan bien con la herencia.',
      ),
      mc('¿Cuándo es útil un `@classmethod`?', ['Para ocultar atributos', 'Para crear objetos de formas alternativas (p. ej. desde un texto)', 'Para evitar usar `__init__`', 'Para que un método sea privado'], 1, 'Los constructores alternativos (`Fecha.desde_texto("14/03/2025")`) son su uso estrella: leen la clase en `cls` y devuelven una instancia.'),
      tf('Un `@staticmethod` recibe `self` como primer parámetro.', false, 'Un método estático no recibe ni `self` ni `cls`: es una función normal agrupada dentro de la clase.'),
      fill('Completa el decorador del constructor alternativo', '@___\ndef desde_texto(cls, texto):\n    ...', ['classmethod', 'staticmethod', 'property', 'cls'], ['classmethod'], 'Recibe `cls` como primer parámetro, así que va con `@classmethod`.'),
      match(
        'Une cada tipo de método con su primer parámetro',
        [
          ['Método normal', 'self (la instancia)'],
          ['@classmethod', 'cls (la clase)'],
          ['@staticmethod', 'ninguno'],
          ['Composición', 'Un objeto guarda otros objetos como atributos'],
        ],
        'La firma te dice con qué trabaja cada método.',
      ),
      pyPractice({
        goal: 'Crear desde texto',
        prompt: 'Define `Persona(nombre, edad)` con un **método de clase** `desde_texto` que cree una persona desde un texto como `"Ana,30"` (la edad debe ser un entero).',
        starter: '',
        check: all(cls('Persona'), calls([['Persona.desde_texto("Ana,30").nombre', "'Ana'"], ['Persona.desde_texto("Ana,30").edad', '30'], ['Persona("Bea", 5).edad', '5']]), uses('decorator:classmethod')),
        solution: c`
class Persona:
    def __init__(self, nombre, edad):
        self.nombre = nombre
        self.edad = edad

    @classmethod
    def desde_texto(cls, texto):
        nombre, edad = texto.split(",")
        return cls(nombre, int(edad))
`,
        hints: ['Divide el texto con `split(",")` y convierte la edad con `int`.', 'Devuelve `cls(nombre, edad)`.'],
        explain: 'Puedes tener varias formas de construir un objeto sin sobrecargar `__init__` con parámetros raros.',
        commands: ['classmethod'],
      }),
      pyPractice({
        goal: 'Conversor de temperatura',
        prompt: 'Define la clase `Conversor` con dos métodos **estáticos**: `c_a_f(c)` (Celsius → Fahrenheit) y `f_a_c(f)` (Fahrenheit → Celsius, redondeado a 1 decimal).',
        starter: '',
        check: all(cls('Conversor', ['c_a_f', 'f_a_c']), calls([['Conversor.c_a_f(100)', '212.0'], ['Conversor.c_a_f(0)', '32.0'], ['Conversor.f_a_c(212)', '100.0'], ['Conversor().f_a_c(100)', '37.8']]), uses('decorator:staticmethod', 2)),
        solution: c`
class Conversor:
    @staticmethod
    def c_a_f(c):
        return c * 9 / 5 + 32

    @staticmethod
    def f_a_c(f):
        return round((f - 32) * 5 / 9, 1)
`,
        hints: ['Cada método lleva `@staticmethod` y no tiene `self`.', 'F → C: `(f - 32) * 5 / 9`.'],
        explain: 'Es una forma de agrupar funciones relacionadas bajo un nombre, sin necesidad de crear objetos.',
        commands: ['staticmethod'],
      }),
      pyPractice({
        goal: 'Un pedido por composición',
        prompt: 'Define `Producto(nombre, precio)` y `Pedido()` con `agregar(producto, cantidad=1)` y `total()` (suma de precio × cantidad). El pedido guarda internamente los productos que le agregan.',
        starter: '',
        check: all(cls('Producto'), cls('Pedido', ['agregar', 'total']), calls([["(lambda p: (p.agregar(Producto('pan', 1.5), 2), p.agregar(Producto('leche', 2.25)), p.total())[-1])(Pedido())", '5.25'], ['Pedido().total()', '0']])),
        solution: c`
class Producto:
    def __init__(self, nombre, precio):
        self.nombre = nombre
        self.precio = precio

class Pedido:
    def __init__(self):
        self.lineas = []

    def agregar(self, producto, cantidad=1):
        self.lineas.append((producto, cantidad))

    def total(self):
        return sum(p.precio * n for p, n in self.lineas)
`,
        hints: ['El `Pedido` guarda una lista de parejas `(producto, cantidad)`.', '`sum(...)` con una expresión generadora: `p.precio * n for p, n in self.lineas`.'],
        explain: 'Un `Pedido` **tiene** productos, no **es** un producto: composición. Cada clase se ocupa de lo suyo.',
        commands: ['composicion'],
      }),
      pyCode('Haz que `Motor` sea un atributo de `Coche`: `Coche().arrancar()` debe devolver `"brum"` delegando en el motor.', {
        starter: c`
class Motor:
    def arrancar(self):
        return "brum"

class Coche:
    pass
` + '\n',
        check: all(expr('Coche().arrancar()', "'brum'"), truthy("isinstance(Coche().motor, Motor)")),
        solution: c`
class Motor:
    def arrancar(self):
        return "brum"

class Coche:
    def __init__(self):
        self.motor = Motor()

    def arrancar(self):
        return self.motor.arrancar()
`,
        hint: 'Crea el `Motor` en el `__init__` del coche y guárdalo en `self.motor`.',
        why: 'El coche **delega** en su motor. Si mañana hay un `MotorElectrico`, el coche apenas cambia.',
      }),
    ]),
  ],
  boss: {
    goal: 'La biblioteca',
    prompt:
      'Modela una biblioteca. Escribe las clases:\n\n- `Libro(titulo, autor)`: empieza **disponible**; al convertirlo en texto (`str`) muestra `titulo (autor)`.\n- `Biblioteca`: guarda libros. `agregar(libro)`, `prestar(titulo)`, `devolver(titulo)`, `disponibles()` (lista **ordenada** de títulos de los libros disponibles) y `len(biblioteca)` (número total de libros).\n- `prestar` lanza `ValueError("<titulo> no existe")` si no hay un libro con ese título, y `ValueError("<titulo> ya está prestado")` si ya estaba prestado.\n\nDeja el programa de abajo tal cual.',
    starter: c`
# Escribe aquí las clases Libro y Biblioteca

b = Biblioteca()
b.agregar(Libro("Dune", "Herbert"))
b.agregar(Libro("Emma", "Austen"))
b.agregar(Libro("Ulises", "Joyce"))
print(len(b))
b.prestar("Dune")
print(b.disponibles())
try:
    b.prestar("Dune")
except ValueError as e:
    print("Error:", e)
try:
    b.prestar("Matilda")
except ValueError as e:
    print("Error:", e)
b.devolver("Dune")
print(b.disponibles())
print(Libro("Emma", "Austen"))
` + '\n',
    check: all(cls('Libro'), cls('Biblioteca', ['agregar', 'prestar', 'devolver', 'disponibles']), stdout("3\n['Emma', 'Ulises']\nError: Dune ya está prestado\nError: Matilda no existe\n['Dune', 'Emma', 'Ulises']\nEmma (Austen)"), uses('ClassDef', 2)),
    solution: c`
class Libro:
    def __init__(self, titulo, autor):
        self.titulo = titulo
        self.autor = autor
        self.disponible = True

    def __str__(self):
        return f"{self.titulo} ({self.autor})"

class Biblioteca:
    def __init__(self):
        self._libros = {}

    def agregar(self, libro):
        self._libros[libro.titulo] = libro

    def _buscar(self, titulo):
        if titulo not in self._libros:
            raise ValueError(f"{titulo} no existe")
        return self._libros[titulo]

    def prestar(self, titulo):
        libro = self._buscar(titulo)
        if not libro.disponible:
            raise ValueError(f"{titulo} ya está prestado")
        libro.disponible = False

    def devolver(self, titulo):
        self._buscar(titulo).disponible = True

    def disponibles(self):
        return sorted(t for t, l in self._libros.items() if l.disponible)

    def __len__(self):
        return len(self._libros)

b = Biblioteca()
b.agregar(Libro("Dune", "Herbert"))
b.agregar(Libro("Emma", "Austen"))
b.agregar(Libro("Ulises", "Joyce"))
print(len(b))
b.prestar("Dune")
print(b.disponibles())
try:
    b.prestar("Dune")
except ValueError as e:
    print("Error:", e)
try:
    b.prestar("Matilda")
except ValueError as e:
    print("Error:", e)
b.devolver("Dune")
print(b.disponibles())
print(Libro("Emma", "Austen"))
`,
    hints: ['La `Biblioteca` puede guardar los libros en un diccionario `{titulo: libro}` y tener un método interno `_buscar(titulo)` que lance «no existe».', '`disponibles()`: `sorted(...)` de los títulos cuyos libros tengan `disponible == True`.', 'Añade `__len__` en `Biblioteca` y `__str__` en `Libro`.'],
    explain: 'Reúne la zona: clases con estado, métodos que protegen reglas con excepciones, `__str__`/`__len__`, y composición (la biblioteca **tiene** libros). Así se estructura casi cualquier programa orientado a objetos.',
    commands: ['class', '__init__', '__str__', '__len__', 'raise'],
  },
});
