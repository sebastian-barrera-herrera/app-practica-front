from enum import Enum, IntEnum, Flag, auto, unique, StrEnum, IntFlag
class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 3
print(Color.RED, repr(Color.RED), Color(2), Color["BLUE"], Color.RED.name, Color.RED.value, list(Color), Color.RED == Color.RED, Color.RED is Color(1), len(Color))
class Pri(IntEnum):
    LOW = 1
    HIGH = 2
print(Pri.LOW < Pri.HIGH, Pri.HIGH + 1, int(Pri.HIGH), sorted([Pri.HIGH, Pri.LOW]), Pri(2))
class Perm(Flag):
    R = auto()
    W = auto()
    X = auto()
print(Perm.R | Perm.W, Perm.R in (Perm.R | Perm.W), Perm(0), bool(Perm.R & Perm.W), (Perm.R | Perm.W | Perm.X).value)
class S(StrEnum):
    A = auto()
    B = "bee"
print(S.A, S.B, S.A.value, "x" + S.B, S("bee"))
class Shape(Enum):
    CIRCLE = "c"
    SQUARE = "s"
    def describe(self): return f"{self.name.lower()}:{self.value}"
    @classmethod
    def parse(cls, v): return cls(v)
print(Shape.CIRCLE.describe(), Shape.parse("s"), [s.name for s in Shape], Shape.__members__["SQUARE"])
try: Color(9)
except ValueError as e: print(e)
try: Color.RED = 5
except AttributeError as e: print(type(e).__name__)
@unique
class U(Enum):
    A = 1
    B = 2
print(U.A.__class__.__name__, hash(U.A) == hash(U.A), {U.A: 1}[U.A], U._member_names_)
class Planet(Enum):
    EARTH = (5.97e24, 6.37e6)
    def __init__(self, mass, radius):
        self.mass = mass; self.radius = radius
print(Planet.EARTH.mass, Planet.EARTH.value)
