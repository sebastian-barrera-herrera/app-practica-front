import inspect
from typing import get_type_hints, NamedTuple
def suma(a: int, b: int) -> int:
    return a + b
print(list(inspect.signature(suma).parameters), suma.__code__.co_varnames[:2], get_type_hints(suma))
class Pt(NamedTuple):
    x: int
    y: int = 0
print(Pt(1), Pt(1, 2)._asdict(), Pt.__annotations__)
class A:
    def __init__(self, v): self.v = v
    def __eq__(self, o): return self.v == o.v
try:
    {A(1)}
except TypeError as e:
    print(e)
try:
    {[1,2]}
except TypeError as e:
    print(e)
print(A.__hash__, hash((1,2)) == hash((1,2)), hash("a") == hash("a"), hash(1.0) == hash(1), hash(frozenset([1,2])) == hash(frozenset([2,1])))
from dataclasses import dataclass, field
try:
    @dataclass
    class M:
        l: list = []
except ValueError as e:
    print(e)
@dataclass(unsafe_hash=True)
class U:
    x: int
print(hash(U(1)) == hash(U(1)), len({U(1), U(1)}))
@dataclass
class W:
    x: int
try:
    hash(W(1))
except TypeError as e:
    print(e)
@dataclass(order=True)
class O:
    a: int
    b: str = field(default="z", compare=False)
print(O(1, "q") == O(1, "r"), O(1) < O(2), sorted([O(3), O(1)]))
@dataclass
class Q:
    a: int
    def __post_init__(self):
        if self.a < 0:
            raise ValueError("negativo")
try:
    Q(-1)
except ValueError as e:
    print(e)
from enum import Enum
class E(Enum):
    A = 1
    B = 2
    def doble(self): return self.value * 2
    @property
    def etiqueta(self): return self.name.lower()
print(E.B.doble(), E.A.etiqueta, E.A in E, hash(E.A) == hash(E.A), {E.A: "x"}[E.A])
match E.B:
    case E.A: print("a")
    case E.B: print("b")
try:
    E.A = 5
except AttributeError as e:
    print(e)
class Dup(Enum):
    X = 1
    Y = 1
print(Dup.Y, Dup.Y is Dup.X, list(Dup))
for m in E: print(m.name, m.value)
print(E.__members__)
