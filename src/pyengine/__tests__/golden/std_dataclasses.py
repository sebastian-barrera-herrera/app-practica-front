from dataclasses import dataclass, field, asdict, astuple, replace, fields, is_dataclass
@dataclass
class P:
    x: int
    y: int = 0
    tags: list = field(default_factory=list)
p = P(1, 2)
print(p, repr(p), p == P(1, 2), asdict(p), astuple(p), replace(p, x=5), is_dataclass(p), [f.name for f in fields(p)])
@dataclass(order=True, frozen=True)
class V:
    a: int
    b: str = "z"
print(V(1) < V(2), sorted([V(2), V(1, "a")]), V(1) == V(1), hash(V(1)) == hash(V(1)))
try:
    V(1).a = 3
except Exception as e:
    print(type(e).__name__, e)
@dataclass
class Q:
    n: int
    def __post_init__(self): self.n *= 2
print(Q(2), P.__init__.__doc__, P.__doc__)
@dataclass(slots=True)
class S:
    a: int
print(S(1), S.__slots__)
try: P()
except TypeError as e: print(e)
@dataclass
class Inv:
    items: dict = field(default_factory=dict)
    count: int = field(default=0, repr=False)
print(Inv(), Inv({"a": 1}, 3))
