import { fill, learn, lesson, match, mc, tf } from '../build';
import { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyWorld } from '../pybuild';
import { all, calls, cls, expr, func, stdout, truthy, uses } from '../pycheck';
import { c, lanza } from './util';

export const py10 = pyWorld({
  id: 'py10',
  index: 10,
  title: 'Diseño de datos',
  subtitle: 'Modela información con tipos claros y seguros',
  emoji: '🧱',
  color: '#F87171',
  level: 'avanzado',
  intro:
    'Escribir clases a mano se vuelve repetitivo, y los datos de un programa grande necesitan **estructura**: registros, conjuntos de valores válidos, contratos entre componentes. Aquí aprenderás las herramientas modernas de Python para **diseñar datos**: `dataclass`, `Enum`, clases abstractas y `Protocol`, anotaciones de tipo, y cómo hacer que tus objetos sean **comparables, hasheables e inmutables**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('py10-1', { title: 'dataclasses', summary: 'Clases de datos sin código repetitivo', emoji: '🗃️', commands: ['dataclasses.dataclass', 'dataclasses.field', 'dataclasses.asdict', 'dataclasses.replace'], minutes: 15 }, [
      learn(
        'Menos código repetitivo',
        `
En la zona anterior escribías \`__init__\`, \`__repr__\` y \`__eq__\` para cada clase que solo guardaba datos. El decorador **\`@dataclass\`** los genera por ti a partir de las **anotaciones** de los campos:

\`\`\`
from dataclasses import dataclass

@dataclass
class Producto:
    nombre: str
    precio: float
    stock: int = 0
\`\`\`

Obtienes gratis:

- \`__init__(nombre, precio, stock=0)\`
- \`__repr__\`: \`Producto(nombre='pan', precio=1.5, stock=0)\`
- \`__eq__\`: dos productos con los mismos campos son iguales.

Los campos **con valor por defecto van después** de los que no lo tienen. Y recuerda: las anotaciones (\`str\`, \`float\`) **no se comprueban** al ejecutar; documentan, no validan.
`,
        '🗃️',
      ),
      pyDemo('Un dataclass', [
        [c`
from dataclasses import dataclass, asdict, replace

@dataclass
class Producto:
    nombre: str
    precio: float
    stock: int = 0

    def valor(self):
        return self.precio * self.stock

p = Producto("pan", 1.5, 10)
print(p)
print(p == Producto("pan", 1.5, 10), p is Producto("pan", 1.5, 10))
print(p.valor(), asdict(p))
print(replace(p, precio=2.0))
p.stock -= 1
print(p.stock)
`, 'Sigue siendo una clase normal: puedes añadir métodos'],
        pyErr('from dataclasses import dataclass\n\n@dataclass\nclass P:\n    nombre: str\n    edad: int\n\nP("Ana")', 'Falta un argumento del `__init__` generado'),
      ]),
      learn(
        'field, __post_init__ y opciones',
        `
- **\`field(default_factory=list)\`**: valor por defecto *mutable* (una lista nueva por objeto). Poner \`tags: list = []\` está **prohibido**: se compartiría entre todos.
- **\`field(init=False)\`**, **\`field(repr=False)\`**, **\`field(compare=False)\`**: excluir un campo del constructor, del texto o de las comparaciones.
- **\`__post_init__\`**: se ejecuta justo después del \`__init__\` generado; sirve para **validar** y para **calcular** campos derivados.
- Opciones del decorador: **\`frozen=True\`** (inmutable y hasheable), **\`order=True\`** (genera \`<\`, \`<=\`, \`>\`, \`>=\` comparando los campos en orden).
- Utilidades: \`asdict(obj)\`, \`astuple(obj)\`, \`replace(obj, campo=nuevo)\` (copia con cambios), \`fields(Clase)\`.
`,
      ),
      pyDemo('Opciones de dataclass', [
        [c`
from dataclasses import dataclass, field

@dataclass
class Alumno:
    nombre: str
    notas: list = field(default_factory=list)
    media: float = field(init=False, default=0.0)

    def __post_init__(self):
        if not self.nombre:
            raise ValueError("nombre vacío")
        self.actualizar()

    def actualizar(self):
        self.media = sum(self.notas) / len(self.notas) if self.notas else 0.0

a = Alumno("Ana", [7, 9])
b = Alumno("Luis")
a.notas.append(5)
print(a, b, sep="\n")
`],
        pyErr('from dataclasses import dataclass\n\n@dataclass\nclass M:\n    tags: list = []', 'Valor por defecto mutable: `ValueError`, usa `default_factory`'),
        [c`
from dataclasses import dataclass, FrozenInstanceError

@dataclass(frozen=True, order=True)
class Version:
    mayor: int
    menor: int = 0

v = Version(1, 2)
print(v < Version(2, 0), sorted([Version(1, 5), Version(1, 0), v]))
try:
    v.mayor = 9
except FrozenInstanceError as e:
    print("inmutable:", e)
print(hash(v) == hash(Version(1, 2)), {v: "estable"})
`, '`frozen` impide modificar; `order` permite ordenar'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
from dataclasses import dataclass

@dataclass
class P:
    x: int
    y: int = 0

print(P(1), P(1) == P(1, 0), P(1) is P(1))
`,
        ['P(1, 0) True False', 'P(x=1, y=0) False False', 'P(x=1, y=0) True True'],
        'El `__repr__` generado muestra los nombres de campo. `==` compara campos (True), pero `is` compara identidad: son dos objetos distintos (False).',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
from dataclasses import dataclass

@dataclass(frozen=True)
class C:
    n: int

c = C(1)
try:
    c.n = 2
except Exception as e:
    print(type(e).__name__)
print(c.n)
`,
        ['AttributeError\n1', 'FrozenInstanceError\n2', '2'],
        'Con `frozen=True`, asignar a un campo lanza `FrozenInstanceError` (una subclase de `AttributeError`) y el valor no cambia.',
      ),
      mc('¿Qué métodos genera `@dataclass` por defecto?', ['`__init__`, `__repr__` y `__eq__`', 'Solo `__init__`', '`__init__`, `__str__` y `__hash__`', 'Ninguno: solo anota tipos'], 0, 'Genera el constructor, la representación y la igualdad por campos. `order=True` añade las comparaciones y `frozen=True` ajusta el hash.'),
      tf('Un `@dataclass` con el campo `precio: float` lanza `TypeError` si le pasas un texto como precio.', false, 'Las anotaciones no se comprueban en tiempo de ejecución. Para validar, usa `__post_init__`.'),
      fill('Completa el valor por defecto seguro para una lista', 'tags: list = field(___=list)', ['default_factory', 'default', 'factory', 'init'], ['default_factory'], '`default_factory` recibe una función que crea un valor nuevo por cada objeto.'),
      match(
        'Une cada opción con su efecto',
        [
          ['frozen=True', 'Objetos inmutables (y hasheables)'],
          ['order=True', 'Permite comparar con < y ordenar con sorted'],
          ['field(default_factory=list)', 'Lista nueva y propia por cada objeto'],
          ['__post_init__', 'Código que corre justo tras el __init__ generado'],
        ],
        'Son las piezas que usarás en casi cualquier dataclass real.',
      ),
      pyPractice({
        goal: 'Un producto',
        prompt: 'Crea el dataclass `Producto` con los campos `nombre` (str), `precio` (float) y `stock` (int, por defecto 0), y un método `valor()` que devuelva `precio * stock`.',
        starter: 'from dataclasses import dataclass\n',
        check: all(cls('Producto', ['valor']), uses('decorator:dataclass'), calls([['Producto("a", 2.5, 4).valor()', '10.0'], ['Producto("a", 1.0)', "Producto(nombre='a', precio=1.0, stock=0)"], ['Producto("a", 1.0) == Producto("a", 1.0)', 'True']])),
        solution: c`
from dataclasses import dataclass

@dataclass
class Producto:
    nombre: str
    precio: float
    stock: int = 0

    def valor(self):
        return self.precio * self.stock
`,
        hints: ['Decora la clase con `@dataclass` y declara los campos con anotación: `nombre: str`.', 'El campo con valor por defecto (`stock: int = 0`) va el último.'],
        explain: 'Con cuatro líneas tienes constructor, repr e igualdad. Los métodos propios se añaden como en cualquier clase.',
        commands: ['dataclasses.dataclass'],
      }),
      pyPractice({
        goal: 'Alumno con validación',
        prompt: 'Crea el dataclass `Alumno` con `nombre` (str) y `notas` (lista, vacía por defecto). Si el nombre está vacío debe lanzar `ValueError` (usa `__post_init__`). Añade el método `promedio()` (0 si no hay notas, o la media redondeada a 2 decimales).',
        starter: 'from dataclasses import dataclass, field\n',
        check: all(cls('Alumno', ['promedio']), calls([['Alumno("Ana", [7, 8, 8]).promedio()', '7.67'], ['Alumno("Ana").promedio()', '0'], ['Alumno("A").notas', '[]'], ['(lambda a, b: (a.notas.append(1), b.notas)[1])(Alumno("A"), Alumno("B"))', '[]']]), truthy(lanza('Alumno("")', 'ValueError')), uses('call:field')),
        solution: c`
from dataclasses import dataclass, field

@dataclass
class Alumno:
    nombre: str
    notas: list = field(default_factory=list)

    def __post_init__(self):
        if not self.nombre:
            raise ValueError("nombre vacío")

    def promedio(self):
        if not self.notas:
            return 0
        return round(sum(self.notas) / len(self.notas), 2)
`,
        hints: ['La lista por defecto se declara con `field(default_factory=list)`.', '`__post_init__(self)` se ejecuta tras el `__init__`: ahí lanzas el `ValueError`.'],
        explain: 'El `default_factory` garantiza que cada alumno tiene **su propia** lista; sin él, todos compartirían la misma.',
        commands: ['dataclasses.field'],
      }),
      pyPractice({
        goal: 'Versiones ordenables e inmutables',
        prompt: 'Crea el dataclass `Version` con `mayor` (int) y `menor` (int, por defecto 0), **inmutable** y **ordenable**. Después `sorted([...])` debe ordenar versiones y se podrán usar como claves de diccionario.',
        starter: 'from dataclasses import dataclass\n',
        check: all(expr('sorted([Version(1, 2), Version(1, 0), Version(0, 9), Version(2)])', '[Version(mayor=0, menor=9), Version(mayor=1, menor=0), Version(mayor=1, menor=2), Version(mayor=2, menor=0)]'), expr('{Version(1, 0): "ok"}[Version(1, 0)]', "'ok'"), truthy(lanza('setattr(Version(1), "mayor", 3)', 'AttributeError'))),
        solution: c`
from dataclasses import dataclass

@dataclass(frozen=True, order=True)
class Version:
    mayor: int
    menor: int = 0
`,
        hints: ['Dos opciones en el decorador: `@dataclass(frozen=True, order=True)`.', 'El orden de comparación es el orden en que declaras los campos.'],
        explain: '`order=True` compara como tuplas `(mayor, menor)`, y `frozen=True` además hace los objetos hasheables.',
        commands: ['dataclasses.dataclass'],
      }),
      pyCode('Con `replace`, guarda en `p2` una copia de `p` con el precio cambiado a 3.0 (sin modificar `p`).', {
        starter: c`
from dataclasses import dataclass, replace

@dataclass(frozen=True)
class P:
    nombre: str
    precio: float

p = P("pan", 1.5)
` + '\n',
        check: all(expr('p2', "P(nombre='pan', precio=3.0)"), expr('p', "P(nombre='pan', precio=1.5)")),
        solution: c`
from dataclasses import dataclass, replace

@dataclass(frozen=True)
class P:
    nombre: str
    precio: float

p = P("pan", 1.5)
p2 = replace(p, precio=3.0)
`,
        hint: '`replace(objeto, campo=nuevo_valor)` devuelve un objeto nuevo.',
        why: 'Con objetos inmutables no se «modifica»: se crea una copia con el cambio. `replace` lo hace en una línea.',
      }),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('py10-2', { title: 'Enum', summary: 'Conjuntos cerrados de valores con nombre', emoji: '🚦', commands: ['enum.Enum', 'enum.auto'], minutes: 13 }, [
      learn(
        'Constantes con nombre',
        `
Cuando una variable solo puede tomar **unos pocos valores conocidos** (estados, direcciones, tallas…), usar textos o números «mágicos» (\`"pendiente"\`, \`2\`) invita a errores de escritura. Un **\`Enum\`** define ese conjunto cerrado:

\`\`\`
from enum import Enum, auto

class Estado(Enum):
    PENDIENTE = 1
    HECHA = 2
    ARCHIVADA = auto()      # el valor lo asigna Python
\`\`\`

- Cada **miembro** (\`Estado.HECHA\`) es un objeto único con \`.name\` (\`"HECHA"\`) y \`.value\` (\`2\`).
- Búsqueda por valor: \`Estado(2)\` · por nombre: \`Estado["HECHA"]\`.
- Se pueden **recorrer** (\`for e in Estado\`, \`list(Estado)\`) y contar (\`len(Estado)\`).
- Se comparan con \`==\`/\`is\`; un miembro **no** es igual a su valor crudo (\`Estado.HECHA == 2\` es \`False\`).
- Un valor inexistente lanza \`ValueError\`.
`,
        '🚦',
      ),
      pyDemo('Miembros de un Enum', [
        [c`
from enum import Enum, auto

class Estado(Enum):
    PENDIENTE = 1
    HECHA = 2
    ARCHIVADA = auto()

e = Estado.HECHA
print(e, repr(e))
print(e.name, e.value, Estado(2), Estado["ARCHIVADA"])
print(e is Estado(2), e == 2, isinstance(e, Estado))
print(list(Estado), len(Estado))
for miembro in Estado:
    print(miembro.name, "→", miembro.value)
`],
        pyErr('from enum import Enum\n\nclass C(Enum):\n    A = 1\n\nC(9)', 'Un valor que no existe: `ValueError`'),
      ]),
      learn(
        'Enums con métodos, IntEnum y match',
        `
- Un \`Enum\` es una clase: puede tener **métodos** y **propiedades** que usan \`self.value\` / \`self.name\`.
- **\`IntEnum\`**: sus miembros *sí* se comportan como enteros (se comparan y suman con números). Útil para prioridades o códigos.
- **\`Flag\`**: combinaciones de opciones con \`|\` (permisos, banderas).
- Con \`match/case\` los miembros se escriben con punto: \`case Estado.HECHA:\`.
- Un miembro es **inmutable**: no puedes reasignarlo.
`,
      ),
      pyDemo('Más Enum', [
        [c`
from enum import Enum, IntEnum

class Dia(Enum):
    LUNES = 1
    SABADO = 6
    DOMINGO = 7

    @property
    def es_finde(self):
        return self.value >= 6

    def siguiente(self):
        miembros = list(Dia)
        return miembros[(miembros.index(self) + 1) % len(miembros)]

print(Dia.SABADO.es_finde, Dia.LUNES.es_finde)
print(Dia.DOMINGO.siguiente())

class Prioridad(IntEnum):
    BAJA = 1
    ALTA = 3

print(Prioridad.BAJA < Prioridad.ALTA, Prioridad.ALTA + 1, sorted([Prioridad.ALTA, Prioridad.BAJA]))

match Dia.SABADO:
    case Dia.LUNES:
        print("empieza la semana")
    case Dia.SABADO | Dia.DOMINGO:
        print("fin de semana")
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
from enum import Enum

class C(Enum):
    ROJO = 1
    VERDE = 2

print(C.ROJO == 1, C(2) is C.VERDE, C.ROJO.name, C["VERDE"].value)
`,
        ['True True ROJO 2', 'False False ROJO 2', 'False True 1 VERDE'],
        'Un miembro de `Enum` no es igual a su valor (`C.ROJO == 1` es False). `C(2)` devuelve el miembro único `C.VERDE`; `.name` es el nombre y `C["VERDE"].value` el valor.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
from enum import Enum

class C(Enum):
    ROJO = 1
    VERDE = 2

print(list(C))
`,
        ["['ROJO', 'VERDE']", '[1, 2]', '[C.ROJO, C.VERDE]'],
        'Al recorrer un `Enum` obtienes los miembros, y su `repr` es `<C.ROJO: 1>` (nombre de la clase, nombre del miembro y valor).',
      ),
      mc('¿Cómo obtienes el miembro de `Estado` cuyo valor es 2?', ['`Estado[2]`', '`Estado(2)`', '`Estado.value(2)`', '`Estado.get(2)`'], 1, 'Con paréntesis se busca **por valor**: `Estado(2)`. Con corchetes se busca por nombre: `Estado["HECHA"]`.'),
      tf('En un `Enum` normal, `Estado.HECHA == 2` es `True` si el valor de `HECHA` es 2.', false, 'Un miembro es un objeto distinto de su valor. Solo con `IntEnum` se comporta como el entero.'),
      fill('Completa para que Python asigne los valores solos', 'from enum import Enum, ___\n\nclass Color(Enum):\n    ROJO = auto()', ['auto', 'field', 'unique', 'count'], ['auto'], '`auto()` asigna 1, 2, 3… en orden de definición.'),
      match(
        'Une cada expresión con su resultado (para HECHA = 2)',
        [
          ['Estado.HECHA.name', '"HECHA"'],
          ['Estado.HECHA.value', '2'],
          ['Estado(2)', 'Estado.HECHA'],
          ['Estado["HECHA"]', 'Estado.HECHA'],
        ],
        'Nombre y valor son atributos; los paréntesis buscan por valor y los corchetes por nombre.',
      ),
      pyPractice({
        goal: 'Semáforo',
        prompt: 'Define el `Enum` `Semaforo` con los miembros `VERDE`, `AMBAR` y `ROJO` (usa `auto()`), y un método `siguiente()` que devuelva el miembro que sigue en el ciclo (tras `ROJO` vuelve a `VERDE`).',
        starter: 'from enum import Enum, auto\n',
        check: all(cls('Semaforo', ['siguiente']), calls([['Semaforo.VERDE.siguiente()', '<Semaforo.AMBAR: 2>'], ['Semaforo.AMBAR.siguiente().name', "'ROJO'"], ['Semaforo.ROJO.siguiente().name', "'VERDE'"], ['len(Semaforo)', '3']])),
        solution: c`
from enum import Enum, auto

class Semaforo(Enum):
    VERDE = auto()
    AMBAR = auto()
    ROJO = auto()

    def siguiente(self):
        miembros = list(Semaforo)
        return miembros[(miembros.index(self) + 1) % len(miembros)]
`,
        hints: ['`list(Semaforo)` te da los miembros en orden.', 'Posición siguiente: `(indice + 1) % len(miembros)`.'],
        explain: 'Un Enum es una clase normal: puede tener lógica. Aquí el ciclo vive junto a los datos, en un solo sitio.',
        commands: ['enum.Enum', 'enum.auto'],
      }),
      pyPractice({
        goal: 'Tarea más urgente',
        prompt: 'Define `Prioridad` como `IntEnum` con `BAJA = 1`, `MEDIA = 2`, `ALTA = 3`. Después define `mas_urgente(tareas)`, que recibe una lista de parejas `(nombre, prioridad)` y devuelve el **nombre** de la tarea de mayor prioridad.',
        starter: 'from enum import IntEnum\n',
        check: all(cls('Prioridad'), func('mas_urgente', 1), calls([['mas_urgente([("a", Prioridad.BAJA), ("b", Prioridad.ALTA), ("c", Prioridad.MEDIA)])', "'b'"], ['Prioridad.ALTA > Prioridad.BAJA', 'True'], ['Prioridad.MEDIA + 1', '3']])),
        solution: c`
from enum import IntEnum

class Prioridad(IntEnum):
    BAJA = 1
    MEDIA = 2
    ALTA = 3

def mas_urgente(tareas):
    return max(tareas, key=lambda t: t[1])[0]
`,
        hints: ['Con `IntEnum` las prioridades se comparan como números.', '`max(tareas, key=lambda t: t[1])` devuelve la pareja con mayor prioridad.'],
        explain: 'Por ser `IntEnum`, `max` y `sorted` funcionan directamente, y el código se lee con nombres (`ALTA`) en lugar de números mágicos.',
        commands: ['enum.Enum'],
      }),
      pyPractice({
        goal: 'Estado desde texto',
        prompt: 'Define el `Enum` `Estado` con `PENDIENTE = "pendiente"`, `ENVIADO = "enviado"` y `ENTREGADO = "entregado"`. Escribe `parsear(texto)` que devuelva el miembro correspondiente al texto (da igual si viene en mayúsculas o con espacios alrededor) y lance `ValueError` si no existe.',
        starter: 'from enum import Enum\n',
        check: all(cls('Estado'), func('parsear', 1), calls([['parsear(" Enviado ")', '<Estado.ENVIADO: \'enviado\'>'], ['parsear("PENDIENTE").name', "'PENDIENTE'"]]), truthy(lanza('parsear("perdido")', 'ValueError'))),
        solution: c`
from enum import Enum

class Estado(Enum):
    PENDIENTE = "pendiente"
    ENVIADO = "enviado"
    ENTREGADO = "entregado"

def parsear(texto):
    return Estado(texto.strip().lower())
`,
        hints: ['Normaliza el texto con `strip().lower()`.', '`Estado(valor)` ya lanza `ValueError` si no existe: no hace falta comprobarlo.'],
        explain: 'Convertir datos externos (texto) en miembros de un Enum es la forma de validar entradas: lo que no esté en el conjunto es un error.',
        commands: ['enum.Enum'],
      }),
      pyCode('Guarda en `m` el miembro de `Color` cuyo valor es 2.', {
        starter: c`
from enum import Enum

class Color(Enum):
    ROJO = 1
    VERDE = 2
    AZUL = 3
` + '\n',
        check: all(expr('m.name', "'VERDE'"), truthy('m is Color.VERDE')),
        solution: c`
from enum import Enum

class Color(Enum):
    ROJO = 1
    VERDE = 2
    AZUL = 3

m = Color(2)
`,
        hint: 'Para buscar por valor se «llama» a la clase: `Color(...)`.',
        why: '`Color(2)` busca por valor y devuelve el miembro único `Color.VERDE`.',
      }),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('py10-3', { title: 'Abstracción y duck typing', summary: 'Contratos con ABC y Protocol, y el «si grazna como un pato»', emoji: '🦆', commands: ['duck-typing', 'abc.ABC', 'abc.abstractmethod', 'typing.Protocol'], minutes: 15 }, [
      learn(
        'Duck typing',
        `
En Python no importa *qué clase* es un objeto sino **qué puede hacer**: *«si camina como un pato y grazna como un pato, es un pato»*. Una función que llama a \`destino.write(texto)\` funciona con un archivo, con un \`StringIO\` o con **tu propia clase** que tenga un método \`write\`: no hace falta heredar de nada.

Esto da mucha flexibilidad, y el estilo EAFP (probar y capturar el error) encaja de forma natural. Pero cuando quieres **exigir** un contrato —«todo lo que se pase aquí debe tener \`area()\`»— hay dos herramientas: las **clases abstractas** y los **\`Protocol\`**.
`,
        '🦆',
      ),
      pyDemo('Duck typing en acción', [
        [c`
import io

class Pato:
    def hablar(self):
        return "cuac"

class Robot:
    def hablar(self):
        return "beep"

for x in [Pato(), Robot(), 5]:
    try:
        print(x.hablar())
    except AttributeError:
        print(type(x).__name__, "no sabe hablar")

class Pantalla:
    def write(self, texto):
        print("[pantalla]", texto, end="")

def guardar(destino, texto):
    destino.write(texto)

buf = io.StringIO()
guardar(buf, "hola\n")
guardar(Pantalla(), "hola\n")
print(repr(buf.getvalue()))
`, '`guardar` funciona con cualquier objeto que tenga `write`'],
      ]),
      learn(
        'Clases abstractas: abc',
        `
Una **clase abstracta** define un contrato que las subclases **deben cumplir**. Se crea heredando de \`ABC\` y marcando con **\`@abstractmethod\`** lo obligatorio:

\`\`\`
from abc import ABC, abstractmethod

class Forma(ABC):
    @abstractmethod
    def area(self): ...

    def describir(self):                  # método concreto reutilizable
        return f"área {self.area()}"
\`\`\`

- No se puede **instanciar** la clase abstracta ni una subclase que deje algún método abstracto sin implementar: \`TypeError\`.
- Puede mezclar métodos abstractos con otros ya implementados (patrón *método plantilla*: la base define el esqueleto y las subclases rellenan los huecos).
`,
      ),
      pyDemo('ABC', [
        [c`
from abc import ABC, abstractmethod

class Forma(ABC):
    @abstractmethod
    def area(self):
        ...

    def describir(self):
        return f"{type(self).__name__} con área {self.area()}"

class Cuadrado(Forma):
    def __init__(self, lado):
        self.lado = lado

    def area(self):
        return self.lado ** 2

print(Cuadrado(3).describir(), isinstance(Cuadrado(1), Forma))
`],
        pyErr('from abc import ABC, abstractmethod\n\nclass Forma(ABC):\n    @abstractmethod\n    def area(self): ...\n\nForma()', 'No se puede instanciar una clase abstracta'),
        pyErr('from abc import ABC, abstractmethod\n\nclass Forma(ABC):\n    @abstractmethod\n    def area(self): ...\n\nclass Mala(Forma):\n    pass\n\nMala()', 'Tampoco una subclase que no implemente lo obligatorio'),
      ]),
      learn(
        'Protocol: interfaces implícitas',
        `
Un **\`Protocol\`** (de \`typing\`) describe una interfaz **por su forma**: cualquier clase que tenga esos métodos la cumple, **sin heredar** de él. Es duck typing con documentación y comprobación para herramientas como *mypy* o tu editor.

\`\`\`
from typing import Protocol

class Volador(Protocol):
    def volar(self) -> str: ...
\`\`\`

| | \`ABC\` | \`Protocol\` |
|---|---|---|
| Relación | hay que **heredar** | basta con **tener los métodos** |
| Se exige | al **instanciar** (TypeError) | en el **análisis estático** (no en ejecución) |
| Cuándo | jerarquías propias con código común | aceptar «cualquier cosa con esta forma» |

Con \`@runtime_checkable\`, además, \`isinstance(obj, Volador)\` comprueba que el objeto tenga los métodos.
`,
      ),
      pyDemo('Protocol', [
        [c`
from typing import Protocol, runtime_checkable

@runtime_checkable
class Volador(Protocol):
    def volar(self) -> str: ...

class Pajaro:
    def volar(self):
        return "bate las alas"

class Piedra:
    pass

def despegar(x: Volador) -> str:
    return x.volar()

print(despegar(Pajaro()))
print(isinstance(Pajaro(), Volador), isinstance(Piedra(), Volador))
`, '`Pajaro` no hereda de `Volador`: lo cumple por su forma'],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
from abc import ABC, abstractmethod

class A(ABC):
    @abstractmethod
    def f(self):
        ...

class B(A):
    pass

class C(A):
    def f(self):
        return 1

try:
    B()
except TypeError:
    print("abstracta")
print(C().f())
`,
        ['1', 'abstracta', 'abstracta\nNone'],
        '`B` no implementa `f`, así que no se puede instanciar (TypeError → se imprime «abstracta»). `C` sí la implementa y devuelve 1.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class Pato:
    def hablar(self):
        return "cuac"

class Robot:
    def hablar(self):
        return "beep"

for x in [Pato(), Robot(), 5]:
    try:
        print(x.hablar())
    except AttributeError:
        print("mudo")
`,
        ['cuac\nbeep', 'cuac\nmudo\nmudo', 'Error'],
        'Duck typing: `Pato` y `Robot` no comparten clase, pero ambos tienen `hablar()`. El entero 5 no la tiene → `AttributeError` capturado → «mudo».',
      ),
      mc('¿Qué diferencia principal hay entre `ABC` y `Protocol`?', ['No hay ninguna', 'Con `ABC` hay que heredar y se exige al instanciar; con `Protocol` basta con tener los métodos', 'Solo `Protocol` permite métodos concretos', '`ABC` solo funciona con enteros'], 1, 'ABC es una jerarquía explícita («nominal») que Python hace cumplir al crear objetos. Protocol es estructural: se comprueba la forma, normalmente por herramientas estáticas.'),
      tf('Una clase que hereda de `ABC` se puede instanciar aunque tenga métodos abstractos sin implementar.', false, 'Python lanza `TypeError` al intentar instanciarla: hay que implementar todos los métodos abstractos.'),
      fill('Completa el decorador que marca un método como obligatorio', 'from abc import ABC, ___\n\nclass Forma(ABC):\n    @abstractmethod\n    def area(self): ...', ['abstractmethod', 'abstract', 'ABCMeta', 'Protocol'], ['abstractmethod'], 'Se importa `abstractmethod` y se usa como decorador (`@abstractmethod`).'),
      match(
        'Une cada concepto con su descripción',
        [
          ['Duck typing', 'Importa lo que el objeto puede hacer, no su clase'],
          ['ABC + @abstractmethod', 'Contrato obligatorio que se exige al instanciar'],
          ['Protocol', 'Interfaz por forma, sin necesidad de heredar'],
          ['Método plantilla', 'La base define el esqueleto y las subclases rellenan huecos'],
        ],
        'Cuatro ideas para diseñar componentes intercambiables.',
      ),
      pyPractice({
        goal: 'Contrato de figuras',
        prompt: 'Define la clase abstracta `Forma` (con `ABC`) con el método abstracto `area()` y el método concreto `describir()` que devuelve `"<NombreClase>: <área con 1 decimal>"`. Crea `Cuadrado(lado)` y `Rectangulo(ancho, alto)` como subclases.',
        starter: 'from abc import ABC, abstractmethod\n',
        check: all(cls('Forma'), cls('Cuadrado'), cls('Rectangulo'), calls([['Cuadrado(3).describir()', "'Cuadrado: 9.0'"], ['Rectangulo(2, 5).describir()', "'Rectangulo: 10.0'"], ['isinstance(Cuadrado(1), Forma)', 'True']]), truthy(lanza('Forma()', 'TypeError')), uses('decorator:abstractmethod')),
        solution: c`
from abc import ABC, abstractmethod

class Forma(ABC):
    @abstractmethod
    def area(self):
        ...

    def describir(self):
        return f"{type(self).__name__}: {self.area():.1f}"

class Cuadrado(Forma):
    def __init__(self, lado):
        self.lado = lado

    def area(self):
        return self.lado ** 2

class Rectangulo(Forma):
    def __init__(self, ancho, alto):
        self.ancho = ancho
        self.alto = alto

    def area(self):
        return self.ancho * self.alto
`,
        hints: ['`class Forma(ABC)` y `@abstractmethod` sobre `area`.', 'El nombre de la clase de un objeto es `type(self).__name__`.'],
        explain: '`describir()` se escribe una vez en la base y funciona para cualquier forma futura que implemente `area()`.',
        commands: ['abc.ABC', 'abc.abstractmethod'],
      }),
      pyPractice({
        goal: 'Canales de aviso',
        prompt: 'Define la clase abstracta `Canal` con el método abstracto `enviar(mensaje)`. Crea `Email` (devuelve `"email: <mensaje>"`) y `SMS` (devuelve `"sms: <mensaje en mayúsculas>"`). Escribe `avisar(canales, mensaje)` que devuelva la lista con lo que devuelve cada canal.',
        starter: 'from abc import ABC, abstractmethod\n',
        check: all(cls('Canal'), cls('Email'), cls('SMS'), func('avisar', 2), calls([['avisar([Email(), SMS()], "hola")', "['email: hola', 'sms: HOLA']"], ['avisar([], "x")', '[]']]), truthy(lanza('Canal()', 'TypeError'))),
        solution: c`
from abc import ABC, abstractmethod

class Canal(ABC):
    @abstractmethod
    def enviar(self, mensaje):
        ...

class Email(Canal):
    def enviar(self, mensaje):
        return f"email: {mensaje}"

class SMS(Canal):
    def enviar(self, mensaje):
        return f"sms: {mensaje.upper()}"

def avisar(canales, mensaje):
    return [canal.enviar(mensaje) for canal in canales]
`,
        hints: ['`Canal` solo declara `enviar` como abstracto.', '`avisar` no necesita saber de qué tipo es cada canal: solo llama a `enviar`.'],
        explain: 'Mañana puedes añadir `Telegram` sin tocar `avisar`: eso es programar contra una interfaz.',
        commands: ['abc.abstractmethod'],
      }),
      pyPractice({
        goal: 'Longitud total',
        prompt: 'Escribe `total_len(objetos)` que sume el `len` de todos los objetos de la lista **que tengan longitud**, ignorando (sin fallar) los que no la tengan (duck typing + EAFP).',
        starter: '',
        check: all(func('total_len', 1), calls([['total_len(["ab", [1, 2, 3], 5, {1: 2}, None])', '6'], ['total_len([])', '0'], ['total_len([7, 8.5])', '0']])),
        solution: c`
def total_len(objetos):
    total = 0
    for o in objetos:
        try:
            total += len(o)
        except TypeError:
            pass
    return total
`,
        hints: ['Intenta `len(o)` dentro de un `try`.', '`len(5)` lanza `TypeError`: capturalo y sigue.'],
        explain: 'No preguntas «¿es una lista o un texto?»: pruebas lo que necesitas y tratas el fallo. Es el estilo pythónico (EAFP).',
        commands: ['duck-typing'],
      }),
      pyCode('Haz que `Cuadrado` sea una subclase concreta de `Forma` implementando `area()`. Después `Cuadrado(3).area()` debe valer 9.', {
        starter: c`
from abc import ABC, abstractmethod

class Forma(ABC):
    @abstractmethod
    def area(self):
        ...

` + '\n',
        check: all(expr('Cuadrado(3).area()', '9'), truthy('issubclass(Cuadrado, Forma)')),
        solution: c`
from abc import ABC, abstractmethod

class Forma(ABC):
    @abstractmethod
    def area(self):
        ...

class Cuadrado(Forma):
    def __init__(self, lado):
        self.lado = lado

    def area(self):
        return self.lado ** 2
`,
        hint: 'Hereda de `Forma`, guarda el lado en `__init__` e implementa `area`.',
        why: 'Hasta que no implementas todos los métodos abstractos la clase no se puede instanciar.',
      }),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('py10-4', { title: 'Anotaciones de tipo', summary: 'Documentar tipos: qué hacen y qué no hacen', emoji: '🏷️', commands: ['anotaciones', 'typing.Optional', 'typing.TypedDict', 'typing.get_type_hints'], minutes: 14 }, [
      learn(
        'Type hints: documentación que entienden las herramientas',
        `
Python permite **anotar** los tipos de variables, parámetros y resultados:

\`\`\`
def saludar(nombre: str, veces: int = 1) -> str:
    return ("Hola, " + nombre + ". ") * veces

edad: int = 30
\`\`\`

> CLAVE: las anotaciones **no se comprueban al ejecutar**. \`saludar(5)\` no falla por el \`str\`: Python las guarda en \`__annotations__\` y las ignora. Sirven para **personas** (documentación), **editores** (autocompletado) y **verificadores estáticos** como *mypy* o *pyright*, que detectan errores *antes* de ejecutar.

Tipos habituales: \`int\`, \`float\`, \`str\`, \`bool\`, \`list[int]\`, \`dict[str, float]\`, \`tuple[int, str]\`, \`set[str]\`, \`X | None\` (un valor o \`None\`; antes \`Optional[X]\`), \`Callable[[int], str]\` (función), \`Iterable[int]\`, \`Any\` y \`Literal["a", "b"]\`.
`,
        '🏷️',
      ),
      pyDemo('Anotar no obliga', [
        [c`
def suma(a: int, b: int) -> int:
    return a + b

print(suma(2, 3))
print(suma("hola, ", "mundo"))
print(suma.__annotations__)
`, 'Python no protesta: las anotaciones son solo información'],
        [c`
from typing import Callable, Optional, Literal

def buscar(xs: list[int], x: int) -> int | None:
    return xs.index(x) if x in xs else None

def aplicar(f: Callable[[int], str], n: int) -> str:
    return f(n)

modo: Literal["claro", "oscuro"] = "claro"
print(buscar([4, 5], 5), buscar([4, 5], 9))
print(aplicar(str, 7))
print(list[int], dict[str, int], int | None, Optional[int], Callable[[int], str])
`],
      ]),
      learn(
        'TypedDict, NamedTuple y dataclass',
        `
Para describir la **forma** de un registro tienes tres opciones, de menos a más estructura:

- **\`TypedDict\`**: un diccionario normal en ejecución, pero con claves y tipos conocidos para el verificador. Ideal para datos con forma JSON.
- **\`NamedTuple\`**: tupla inmutable con campos con nombre y tipos.
- **\`@dataclass\`**: clase completa, con métodos y valores por defecto.

\`typing.get_type_hints(objeto)\` devuelve las anotaciones ya resueltas, por si quieres **usarlas en tu propio código** (validadores, serializadores…): así funcionan librerías como *pydantic* o *FastAPI*.
`,
      ),
      pyDemo('Formas de registro', [
        [c`
from typing import TypedDict, NamedTuple, get_type_hints

class Peli(TypedDict):
    titulo: str
    anio: int

p: Peli = {"titulo": "Matrix", "anio": 1999}
print(p, type(p).__name__)
print(get_type_hints(Peli))

class Punto(NamedTuple):
    x: int
    y: int = 0

pt = Punto(3)
print(pt, pt.x, pt._asdict(), Punto.__annotations__)
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
def suma(a: int, b: int) -> int:
    return a + b

print(suma("a", "b"))
`,
        ['TypeError', 'None', 'a b'],
        'Las anotaciones no se hacen cumplir: `"a" + "b"` es válido y da «ab». Solo un verificador estático (mypy) lo señalaría.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
def f(x: int, y: str = "a") -> bool:
    return True

print(f.__annotations__)
`,
        ["{'x': int, 'y': str, 'return': bool}", "{'x': <class 'int'>, 'y': <class 'str'>}", "{'x': 'int', 'y': 'str', 'return': 'bool'}"],
        '`__annotations__` es un diccionario con los tipos de cada parámetro y, bajo la clave `"return"`, el del resultado. Los tipos se muestran como clases: `<class \'int\'>`.',
      ),
      mc('¿Qué significa `str | None`?', ['Un texto y además `None`', 'Un texto o `None`', 'Una lista de dos elementos', 'Una operación bit a bit'], 1, 'Es la unión de tipos: el valor puede ser un `str` o `None` (equivale al antiguo `Optional[str]`).'),
      tf('Si anotas un parámetro como `edad: int`, Python lanza `TypeError` al pasarle un texto.', false, 'Python no comprueba las anotaciones al ejecutar. Hacen falta herramientas externas (mypy, pyright) o código propio que las lea.'),
      fill('Completa el tipo «un entero o None»', 'def buscar(xs: list[int]) -> int ___ None:\n    ...', ['|', 'or', '+', '&'], ['|'], 'Desde Python 3.10 las uniones de tipos se escriben con `|`.'),
      match(
        'Une cada anotación con su significado',
        [
          ['list[int]', 'Lista de enteros'],
          ['dict[str, float]', 'Diccionario de texto a decimal'],
          ['int | None', 'Un entero o None'],
          ['Callable[[int], str]', 'Función que recibe un int y devuelve un str'],
        ],
        'Leer anotaciones es leer la «firma» de lo que espera y entrega cada función.',
      ),
      pyPractice({
        goal: 'Anota una función',
        prompt: 'Añade anotaciones a `promedio`: recibe una lista de decimales (`list[float]`) y devuelve un `float`.',
        starter: 'def promedio(notas):\n    return sum(notas) / len(notas)\n',
        check: all(expr('promedio.__annotations__', "{'notas': list[float], 'return': <class 'float'>}"), expr('promedio([1.0, 2.0, 3.0])', '2.0')),
        solution: 'def promedio(notas: list[float]) -> float:\n    return sum(notas) / len(notas)\n',
        hints: ['Los parámetros se anotan con `nombre: tipo`.', 'El resultado, con `-> tipo` antes de los dos puntos.'],
        explain: 'La firma ahora se documenta sola, y tu editor puede avisarte si pasas algo que no sea una lista de números.',
        commands: ['anotaciones'],
      }),
      pyPractice({
        goal: 'Describe un registro',
        prompt: 'Define el `TypedDict` `Usuario` con `nombre` (str), `edad` (int) y `activo` (bool). Crea después la variable `u` (anotada como `Usuario`) con los valores `"Ana"`, `30` y `True`.',
        starter: 'from typing import TypedDict\n',
        check: all(expr('Usuario.__annotations__', "{'nombre': <class 'str'>, 'edad': <class 'int'>, 'activo': <class 'bool'>}"), expr('u', "{'nombre': 'Ana', 'edad': 30, 'activo': True}"), expr('type(u).__name__', "'dict'")),
        solution: c`
from typing import TypedDict

class Usuario(TypedDict):
    nombre: str
    edad: int
    activo: bool

u: Usuario = {"nombre": "Ana", "edad": 30, "activo": True}
`,
        hints: ['`class Usuario(TypedDict):` y los campos con anotación, sin valores.', 'En ejecución `u` es un `dict` normal.'],
        explain: 'Un `TypedDict` no cambia el comportamiento (es un diccionario): solo cuenta a las herramientas qué claves y tipos esperas.',
        commands: ['typing.TypedDict'],
      }),
      pyPractice({
        goal: 'Validar con las anotaciones',
        prompt: 'Escribe `validar(funcion, *args)` que devuelva `True` si cada argumento posicional es una instancia del tipo con el que está anotado su parámetro en `funcion` (usa `typing.get_type_hints` y `funcion.__code__.co_varnames`), o `False` si alguno no lo es.',
        starter: 'from typing import get_type_hints\n\ndef suma(a: int, b: int) -> int:\n    return a + b\n',
        check: all(func('validar'), calls([['validar(suma, 1, 2)', 'True'], ['validar(suma, 1, "2")', 'False'], ['validar(suma, 1.5, 2)', 'False']])),
        solution: c`
from typing import get_type_hints

def suma(a: int, b: int) -> int:
    return a + b

def validar(funcion, *args):
    hints = get_type_hints(funcion)
    nombres = funcion.__code__.co_varnames[:len(args)]
    return all(isinstance(valor, hints[nombre]) for nombre, valor in zip(nombres, args))
`,
        hints: ['`get_type_hints(funcion)` da un diccionario `{parametro: tipo}`.', 'Empareja nombres de parámetro y valores con `zip` y comprueba con `isinstance`.'],
        explain: 'Las anotaciones son datos accesibles en ejecución. Así funcionan las librerías que validan automáticamente (pydantic, FastAPI…).',
        commands: ['typing.get_type_hints'],
      }),
      pyCode('Anota `buscar` para que devuelva un entero o `None` (usando `|`).', {
        starter: 'def buscar(xs, x):\n    return xs.index(x) if x in xs else None\n',
        check: all(expr("buscar.__annotations__['return']", 'int | None')),
        solution: 'def buscar(xs, x) -> int | None:\n    return xs.index(x) if x in xs else None\n',
        hint: 'Entre los paréntesis y los dos puntos: `-> int | None`.',
        why: 'Avisar de que el resultado puede ser `None` obliga a quien llama a tratar ese caso.',
      }),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('py10-5', { title: 'Hashable e inmutable', summary: '__hash__, conjuntos de objetos e inmutabilidad', emoji: '🔑', commands: ['hash', '__hash__', 'inmutabilidad', 'dataclasses.dataclass'], minutes: 15 }, [
      learn(
        'Qué significa ser hasheable',
        `
Los **diccionarios** y los **conjuntos** localizan elementos mediante su **hash** (un número que resume el valor). Por eso solo admiten como claves o elementos objetos **hasheables**:

- Hasheables: \`int\`, \`str\`, \`float\`, \`bool\`, \`None\`, \`tuple\` (si su contenido lo es), \`frozenset\`.
- **No** hasheables: \`list\`, \`dict\`, \`set\` (son mutables: si cambiaran, su hash cambiaría y se «perderían» en el diccionario).

Reglas para tus clases:

1. Si dos objetos son **iguales** (\`==\`), deben tener el **mismo hash**.
2. El hash debe depender solo de datos que **no cambian** mientras el objeto esté en un dict/set.
3. Si defines \`__eq__\` y no \`__hash__\`, Python **anula el hash**: el objeto deja de ser hasheable.
`,
        '🔑',
      ),
      pyDemo('Hash y conjuntos', [
        [c`
print(hash("a") == hash("a"), hash((1, 2)) == hash((1, 2)), hash(1) == hash(1.0))
print(len({1, 1.0, True}), {(1, 2): "tupla como clave"})
`, '`1`, `1.0` y `True` son iguales y tienen el mismo hash'],
        pyErr('{[1, 2]: "no"}', 'Las listas no son hasheables: `TypeError`'),
        pyErr('class A:\n    def __init__(self, v):\n        self.v = v\n\n    def __eq__(self, otro):\n        return self.v == otro.v\n\n{A(1)}', 'Con `__eq__` sin `__hash__` el objeto deja de ser hasheable'),
        [c`
class Punto:
    def __init__(self, x, y):
        self.x, self.y = x, y

    def __eq__(self, otro):
        return isinstance(otro, Punto) and (self.x, self.y) == (otro.x, otro.y)

    def __hash__(self):
        return hash((self.x, self.y))

    def __repr__(self):
        return f"Punto({self.x}, {self.y})"

s = {Punto(1, 2), Punto(1, 2), Punto(0, 0)}
print(len(s), Punto(1, 2) in s)
print({Punto(1, 2): "origen A"}[Punto(1, 2)])
`, '`__eq__` y `__hash__` usan los **mismos datos**'],
      ]),
      learn(
        'Inmutabilidad: datos que no cambian',
        `
Un objeto **inmutable** nunca cambia tras crearse. Ventajas: se puede **compartir sin miedo**, es **hasheable**, y razonar sobre el programa es más fácil (nadie lo modifica a escondidas).

Herramientas: \`tuple\`, \`frozenset\`, \`str\`, \`namedtuple\`/\`NamedTuple\`, y **\`@dataclass(frozen=True)\`**, que ya genera un hash coherente con \`__eq__\`. Para «modificar» un inmutable se crea una copia con \`dataclasses.replace(obj, campo=nuevo)\`.

> CLAVE: modelar datos como **inmutables** (y reservar los objetos mutables para quien realmente cambia de estado) evita toda una familia de errores.
`,
      ),
      pyDemo('Frozen dataclass como clave', [
        [c`
from dataclasses import dataclass, replace

@dataclass(frozen=True)
class P:
    x: int
    y: int

a = P(1, 2)
visitados = {a, P(1, 2), P(2, 1)}
print(len(visitados), P(1, 2) in visitados)
precios = {P(0, 0): "origen"}
print(precios[P(0, 0)])
b = replace(a, y=9)
print(a, b)
`],
      ]),
      pyOut(
        '¿Qué imprime?',
        c`
from dataclasses import dataclass

@dataclass(frozen=True)
class P:
    x: int
    y: int

s = {P(1, 2), P(1, 2), P(2, 1)}
print(len(s), P(1, 2) in s)
`,
        ['3 True', '2 False', '3 False'],
        'Los dos `P(1, 2)` son iguales y con el mismo hash, así que el conjunto guarda uno solo: 2 elementos (`P(1, 2)` y `P(2, 1)`). Y `P(1, 2) in s` es True.',
      ),
      pyOut(
        '¿Qué imprime?',
        c`
class A:
    def __init__(self, v):
        self.v = v

    def __eq__(self, otro):
        return self.v == otro.v

try:
    {A(1)}
except TypeError as e:
    print(e)
`,
        ["A is not hashable", "unhashable type: 'list'", 'cannot hash A'],
        "Al definir `__eq__` sin `__hash__`, Python marca la clase como no hasheable: el error dice «unhashable type: 'A'».",
      ),
      mc('¿Cuál de estos objetos NO se puede usar como clave de un diccionario?', ['`(1, 2)`', '`"clave"`', '`[1, 2]`', '`frozenset({1, 2})`'], 2, 'Las listas son mutables y por tanto no hasheables. Una tupla sí (mientras su contenido también lo sea).'),
      tf('Dos objetos que son iguales según `==` deben tener el mismo `hash()`.', true, 'Es la regla básica del contrato: si no, dos objetos «iguales» acabarían en posiciones distintas del conjunto o diccionario.'),
      fill('Completa el hash coherente con la igualdad', 'def __hash__(self):\n    return ___((self.x, self.y))', ['hash', 'id', 'len', 'sum'], ['hash'], 'Se construye con `hash` de una tupla con los **mismos campos** que usa `__eq__`.'),
      match(
        'Une cada tipo con su condición',
        [
          ['tuple de enteros', 'Hasheable'],
          ['list', 'No hasheable'],
          ['frozenset', 'Hasheable'],
          ['dict', 'No hasheable'],
        ],
        'Lo mutable no es hasheable; las versiones inmutables sí.',
      ),
      pyPractice({
        goal: 'Un punto hasheable',
        prompt: 'Define la clase `Punto(x, y)` (sin dataclass) con `__eq__`, `__hash__` y `__repr__` (`Punto(1, 2)`), de modo que se pueda usar en conjuntos y como clave de diccionario.',
        starter: '',
        check: all(cls('Punto'), calls([['len({Punto(1, 2), Punto(1, 2), Punto(0, 0)})', '2'], ['{Punto(1, 2): "a"}[Punto(1, 2)]', "'a'"], ['repr(Punto(1, 2))', "'Punto(1, 2)'"], ['Punto(1, 2) == Punto(2, 1)', 'False'], ['hash(Punto(3, 4)) == hash(Punto(3, 4))', 'True']])),
        solution: c`
class Punto:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __eq__(self, otro):
        return isinstance(otro, Punto) and (self.x, self.y) == (otro.x, otro.y)

    def __hash__(self):
        return hash((self.x, self.y))

    def __repr__(self):
        return f"Punto({self.x}, {self.y})"
`,
        hints: ['`__eq__` compara la tupla `(x, y)` de ambos.', '`__hash__` devuelve `hash((self.x, self.y))`: los mismos datos que `__eq__`.'],
        explain: 'Con `__eq__` y `__hash__` basados en los mismos campos, tus objetos funcionan en conjuntos y diccionarios.',
        commands: ['__hash__', 'hash'],
      }),
      pyPractice({
        goal: 'Quitar duplicados',
        prompt: 'Crea el dataclass inmutable `Persona(nombre, edad)` y la función `unicos(personas)` que devuelva una lista **sin duplicados** manteniendo el orden de primera aparición.',
        starter: 'from dataclasses import dataclass\n',
        check: all(cls('Persona'), func('unicos', 1), calls([['unicos([Persona("Ana", 3), Persona("Luis", 4), Persona("Ana", 3)])', "[Persona(nombre='Ana', edad=3), Persona(nombre='Luis', edad=4)]"], ['unicos([])', '[]']])),
        solution: c`
from dataclasses import dataclass

@dataclass(frozen=True)
class Persona:
    nombre: str
    edad: int

def unicos(personas):
    return list(dict.fromkeys(personas))
`,
        hints: ['`frozen=True` hace al dataclass hasheable.', '`dict.fromkeys(secuencia)` elimina duplicados conservando el orden.'],
        explain: 'Un diccionario recuerda el orden de inserción y no repite claves: `dict.fromkeys` es el truco clásico para quitar duplicados en orden.',
        commands: ['dataclasses.dataclass'],
      }),
      pyPractice({
        goal: 'Productos por categoría',
        prompt: 'Define el `Enum` `Categoria` (`BEBIDA`, `COMIDA`), el dataclass inmutable y ordenable `Producto(nombre, categoria)` y la función `agrupar(productos)` que devuelva un diccionario `{nombre de categoría: [nombres de producto]}`, con los nombres de cada categoría **ordenados**.',
        starter: 'from dataclasses import dataclass\nfrom enum import Enum, auto\n',
        check: all(cls('Categoria'), cls('Producto'), func('agrupar', 1), calls([['agrupar([Producto("pan", Categoria.COMIDA), Producto("agua", Categoria.BEBIDA), Producto("arroz", Categoria.COMIDA)])', "{'COMIDA': ['arroz', 'pan'], 'BEBIDA': ['agua']}"], ['agrupar([])', '{}']])),
        solution: c`
from dataclasses import dataclass
from enum import Enum, auto

class Categoria(Enum):
    BEBIDA = auto()
    COMIDA = auto()

@dataclass(frozen=True)
class Producto:
    nombre: str
    categoria: Categoria

def agrupar(productos):
    grupos = {}
    for p in productos:
        grupos.setdefault(p.categoria.name, []).append(p.nombre)
    return {cat: sorted(nombres) for cat, nombres in grupos.items()}
`,
        hints: ['Recorre los productos y agrupa por `p.categoria.name` (por ejemplo con `setdefault` o `defaultdict`).', 'Ordena cada lista al final con `sorted`.'],
        explain: 'Dataclass + Enum + diccionarios: las tres piezas del diseño de datos moderno en Python trabajando juntas.',
        commands: ['enum.Enum', 'dataclasses.dataclass'],
      }),
      pyCode('Haz que `Medida` sea hasheable e igual por valor sin escribir `__eq__` ni `__hash__`: solo con un decorador.', {
        starter: c`
from dataclasses import dataclass

class Medida:
    def __init__(self, valor, unidad):
        self.valor = valor
        self.unidad = unidad
` + '\n',
        check: all(expr('len({Medida(1, "m"), Medida(1, "m")})', '1'), expr('Medida(1, "m") == Medida(1, "m")', 'True')),
        solution: c`
from dataclasses import dataclass

@dataclass(frozen=True)
class Medida:
    valor: float
    unidad: str
`,
        hint: 'Convierte la clase en un dataclass inmutable: `@dataclass(frozen=True)` con campos anotados.',
        why: '`frozen=True` + `eq=True` (por defecto) genera un `__hash__` coherente con la igualdad.',
      }),
    ]),
  ],
  boss: {
    goal: 'El inventario',
    prompt:
      'Modela un inventario con las herramientas de la zona:\n\n- `Categoria` (`Enum`): `BEBIDA`, `COMIDA`, `LIMPIEZA`.\n- `Producto` (dataclass **inmutable**): `sku`, `nombre`, `precio` (float) y `categoria`.\n- `Inventario`: `agregar(producto, cantidad)` (si `cantidad <= 0`, `ValueError("Cantidad inválida")`), `retirar(sku, cantidad)` (si el `sku` no existe `ValueError("<sku> no existe")`; si no hay stock suficiente `ValueError("Stock insuficiente")`), `unidades(sku)`, `valor_total()` (suma de precio × unidades) y `por_categoria()` (diccionario `{Categoria: unidades}` en el orden de definición del `Enum`).\n\nDeja el programa de abajo tal cual.',
    starter: c`
# Escribe aquí Categoria, Producto e Inventario

agua = Producto("A1", "Agua", 1.0, Categoria.BEBIDA)
pan = Producto("P1", "Pan", 0.8, Categoria.COMIDA)
jabon = Producto("J1", "Jabón", 2.5, Categoria.LIMPIEZA)
inv = Inventario()
inv.agregar(agua, 10)
inv.agregar(pan, 20)
inv.agregar(jabon, 4)
inv.agregar(agua, 5)
print(inv.valor_total())
inv.retirar("P1", 5)
print(inv.unidades("A1"), inv.unidades("P1"))
try:
    inv.retirar("J1", 9)
except ValueError as e:
    print("Error:", e)
try:
    inv.retirar("X9", 1)
except ValueError as e:
    print("Error:", e)
for cat, n in inv.por_categoria().items():
    print(cat.name, n)
print(agua == Producto("A1", "Agua", 1.0, Categoria.BEBIDA), len({agua, pan, agua}))
` + '\n',
    check: all(cls('Categoria'), cls('Producto'), cls('Inventario', ['agregar', 'retirar', 'unidades', 'valor_total', 'por_categoria']), stdout('41.0\n15 15\nError: Stock insuficiente\nError: X9 no existe\nBEBIDA 15\nCOMIDA 15\nLIMPIEZA 4\nTrue 2'), uses('decorator:dataclass')),
    solution: c`
from dataclasses import dataclass
from enum import Enum, auto

class Categoria(Enum):
    BEBIDA = auto()
    COMIDA = auto()
    LIMPIEZA = auto()

@dataclass(frozen=True)
class Producto:
    sku: str
    nombre: str
    precio: float
    categoria: Categoria

class Inventario:
    def __init__(self):
        self._productos = {}
        self._stock = {}

    def agregar(self, producto, cantidad):
        if cantidad <= 0:
            raise ValueError("Cantidad inválida")
        self._productos[producto.sku] = producto
        self._stock[producto.sku] = self._stock.get(producto.sku, 0) + cantidad

    def retirar(self, sku, cantidad):
        if sku not in self._stock:
            raise ValueError(f"{sku} no existe")
        if cantidad > self._stock[sku]:
            raise ValueError("Stock insuficiente")
        self._stock[sku] -= cantidad

    def unidades(self, sku):
        return self._stock.get(sku, 0)

    def valor_total(self):
        return round(sum(self._productos[s].precio * n for s, n in self._stock.items()), 2)

    def por_categoria(self):
        resultado = {cat: 0 for cat in Categoria}
        for sku, n in self._stock.items():
            resultado[self._productos[sku].categoria] += n
        return resultado

agua = Producto("A1", "Agua", 1.0, Categoria.BEBIDA)
pan = Producto("P1", "Pan", 0.8, Categoria.COMIDA)
jabon = Producto("J1", "Jabón", 2.5, Categoria.LIMPIEZA)
inv = Inventario()
inv.agregar(agua, 10)
inv.agregar(pan, 20)
inv.agregar(jabon, 4)
inv.agregar(agua, 5)
print(inv.valor_total())
inv.retirar("P1", 5)
print(inv.unidades("A1"), inv.unidades("P1"))
try:
    inv.retirar("J1", 9)
except ValueError as e:
    print("Error:", e)
try:
    inv.retirar("X9", 1)
except ValueError as e:
    print("Error:", e)
for cat, n in inv.por_categoria().items():
    print(cat.name, n)
print(agua == Producto("A1", "Agua", 1.0, Categoria.BEBIDA), len({agua, pan, agua}))
`,
    hints: ['Guarda dos diccionarios en `Inventario`: `sku → Producto` y `sku → unidades`.', '`por_categoria`: empieza con `{cat: 0 for cat in Categoria}` y suma las unidades de cada producto a su categoría.', 'Marca `Producto` con `@dataclass(frozen=True)`: así es igual por valor y se puede meter en un conjunto.'],
    explain: 'Un modelo de datos completo: `Enum` para valores cerrados, `dataclass` inmutable para registros, y una clase con reglas que protege su estado con excepciones. Esta estructura se repite en casi cualquier aplicación real.',
    commands: ['dataclasses.dataclass', 'enum.Enum', 'raise'],
  },
});
