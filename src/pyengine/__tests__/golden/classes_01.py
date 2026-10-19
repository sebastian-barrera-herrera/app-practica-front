class Animal:
    count = 0
    def __init__(self, name):
        self.name = name
        Animal.count += 1
    def speak(self):
        return f"{self.name} hace un sonido"
    def __repr__(self):
        return f"Animal({self.name!r})"
    def __str__(self):
        return f"<{self.name}>"
    def __eq__(self, other):
        return isinstance(other, Animal) and self.name == other.name
    def __hash__(self):
        return hash(self.name)
    def __lt__(self, other):
        return self.name < other.name

class Dog(Animal):
    def __init__(self, name, breed="mestizo"):
        super().__init__(name)
        self.breed = breed
    def speak(self):
        return super().speak() + " (guau)"
    @property
    def info(self):
        return f"{self.name}/{self.breed}"
    @info.setter
    def info(self, v):
        self.name, self.breed = v.split("/")
    @classmethod
    def create(cls, n):
        return cls(n, "x")
    @staticmethod
    def helper(a, b):
        return a + b

d = Dog("Rex")
print(d, repr(d), d.speak(), d.info, Animal.count)
d.info = "Fido/lab"
print(d.name, d.breed, Dog.create("Y").breed, Dog.helper(1, 2))
print(isinstance(d, Animal), issubclass(Dog, Animal), Dog.__mro__, Dog.__name__, type(d).__name__)
print(sorted([Dog("b"), Dog("a")]), {Dog("a"): 1}[Dog("a")], Dog("a") == Dog("a"), Dog("a") != Dog("b"))
print(hasattr(d, "name"), getattr(d, "zzz", "def"), d.__dict__, vars(d) == d.__dict__)
setattr(d, "extra", 5); print(d.extra); del d.extra; print(hasattr(d, "extra"))

class Vec:
    __slots__ = ("x", "y")
    def __init__(self, x, y): self.x, self.y = x, y
    def __add__(self, o): return Vec(self.x + o.x, self.y + o.y)
    def __mul__(self, k): return Vec(self.x * k, self.y * k)
    __rmul__ = __mul__
    def __neg__(self): return Vec(-self.x, -self.y)
    def __abs__(self): return (self.x ** 2 + self.y ** 2) ** 0.5
    def __bool__(self): return bool(self.x or self.y)
    def __len__(self): return 2
    def __getitem__(self, i): return (self.x, self.y)[i]
    def __iter__(self): yield self.x; yield self.y
    def __contains__(self, v): return v in (self.x, self.y)
    def __call__(self, k): return Vec(self.x * k, self.y * k)
    def __repr__(self): return f"Vec({self.x}, {self.y})"
    def __format__(self, spec): return f"[{self.x:{spec}}, {self.y:{spec}}]"
v = Vec(3, 4)
print(v + v, v * 2, 2 * v, -v, abs(v), bool(Vec(0, 0)), len(v), v[1], list(v), 3 in v, v(10), f"{v:>3}")
try:
    v.z = 1
except AttributeError as e:
    print(type(e).__name__, e)

class Meta(type):
    def __new__(mcs, name, bases, ns):
        ns["tag"] = name.upper()
        return super().__new__(mcs, name, bases, ns)
class WithMeta(metaclass=Meta):
    pass
print(WithMeta.tag, type(WithMeta).__name__)

class Base:
    registry = []
    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        Base.registry.append(cls.__name__)
class A1(Base): pass
class A2(Base): pass
print(Base.registry)

class Desc:
    def __set_name__(self, owner, name): self.name = name
    def __get__(self, obj, objtype=None):
        if obj is None: return self
        return obj.__dict__.get("_" + self.name, 0)
    def __set__(self, obj, v): obj.__dict__["_" + self.name] = v * 2
class UsesDesc:
    val = Desc()
u = UsesDesc(); u.val = 5
print(u.val, UsesDesc.val.name)

class M1:
    def who(self): return "M1"
class M2(M1):
    def who(self): return "M2>" + super().who()
class M3(M1):
    def who(self): return "M3>" + super().who()
class M4(M2, M3):
    def who(self): return "M4>" + super().who()
print(M4().who(), [c.__name__ for c in M4.__mro__])
