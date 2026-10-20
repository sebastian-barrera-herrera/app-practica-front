from dataclasses import dataclass, field, asdict, astuple, replace, fields, FrozenInstanceError
from enum import Enum, auto, IntEnum, Flag, unique
from abc import ABC, abstractmethod
from typing import Optional, Callable, Protocol, TypedDict, runtime_checkable, get_type_hints, Literal, Union, Any, Iterable
import typing

@dataclass
class P:
    nombre: str
    precio: float = 0.0
    tags: list = field(default_factory=list)
    def total(self): return self.precio * 2
p = P("pan", 1.5)
print(p, p == P("pan", 1.5), asdict(p), astuple(p), replace(p, precio=2), [f.name for f in fields(P)])

@dataclass(frozen=True, order=True)
class V:
    x: int
    y: int = 0
v = V(1, 2)
print(v, v < V(2, 0), hash(v) == hash(V(1, 2)), {v: 1})
try:
    v.x = 5
except FrozenInstanceError as e:
    print(type(e).__name__, e)
try:
    P()
except TypeError as e:
    print(e)

@dataclass
class Q:
    a: int
    b: int = field(init=False)
    def __post_init__(self):
        self.b = self.a * 2
print(Q(3), Q.__dataclass_fields__.keys())

class Color(Enum):
    ROJO = 1
    VERDE = 2
    AZUL = auto()
print(Color.ROJO, repr(Color.AZUL), Color.ROJO.name, Color.ROJO.value, Color(2), Color["VERDE"], list(Color), Color.AZUL.value)
print(Color.ROJO is Color(1), Color.ROJO == 1, isinstance(Color.ROJO, Color), len(Color), [c.name for c in Color])
try:
    Color(9)
except ValueError as e:
    print(e)
class N(IntEnum):
    BAJO = 1
    ALTO = 3
print(N.BAJO < N.ALTO, N.ALTO + 1, sorted([N.ALTO, N.BAJO]))
class Perm(Flag):
    R = 4
    W = 2
    X = 1
print(Perm.R | Perm.W, Perm.R in (Perm.R | Perm.W), (Perm.R | Perm.W).value)

class Forma(ABC):
    @abstractmethod
    def area(self): ...
    def describir(self): return f"área {self.area()}"
class Cuad(Forma):
    def __init__(self, l): self.l = l
    def area(self): return self.l ** 2
try:
    Forma()
except TypeError as e:
    print(e)
print(Cuad(3).describir(), isinstance(Cuad(1), Forma))
class Mal(Forma): pass
try:
    Mal()
except TypeError as e:
    print(e)

@runtime_checkable
class Volador(Protocol):
    def volar(self) -> str: ...
class Pajaro:
    def volar(self): return "ala"
print(isinstance(Pajaro(), Volador), isinstance(5, Volador))

class Peli(TypedDict):
    titulo: str
    anio: int
d: Peli = {"titulo": "X", "anio": 1999}
print(d, get_type_hints(Peli), Peli.__annotations__)
def f(a: int, b: "str" = "x", *, c: Optional[int] = None) -> list[int]:
    return [a]
print(f.__annotations__)
print(get_type_hints(f))
print(list[int], dict[str, int], Optional[int], int | None, Callable[[int], str], Literal["a", "b"], Union[int, str])
print(f("no es int"))
x: int = "texto"
print(x, __annotations__)
