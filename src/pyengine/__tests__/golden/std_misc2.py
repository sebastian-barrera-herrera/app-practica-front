import contextlib, abc, typing, os, io, pathlib, csv, sys
from typing import List, Dict, Optional, Union, Callable, TypeVar, Generic, Any, NamedTuple, Protocol, Literal, TypedDict
@contextlib.contextmanager
def cm(n):
    print("enter", n)
    try: yield n * 2
    finally: print("exit", n)
with cm(2) as v: print("dentro", v)
with contextlib.suppress(KeyError): {}["a"]
with contextlib.redirect_stdout(io.StringIO()) as buf: print("oculto")
print(repr(buf.getvalue()))
class A(abc.ABC):
    @abc.abstractmethod
    def f(self): ...
    @property
    @abc.abstractmethod
    def p(self): ...
class B(A):
    def f(self): return 1
    p = 5
try: A()
except TypeError as e: print(e)
print(B().f(), B().p, isinstance(B(), A), A.__abstractmethods__ == frozenset({"f", "p"}))
T = TypeVar("T")
class Box(Generic[T]):
    def __init__(self, v: T): self.v = v
print(Box[int](3).v, Box.__orig_bases__, List[int], Dict[str, List[int]], Optional[int], Union[int, str], Callable[[int], str], Literal["a", 1])
class Emp(NamedTuple):
    name: str
    age: int = 0
print(Emp("a"), Emp._fields, typing.get_type_hints(Emp), Emp("b", 3)._asdict())
class TD(TypedDict):
    a: int
print(TD(a=1), typing.get_origin(List[int]), typing.get_args(Dict[str, int]), Any, typing.cast(int, "x"))
class Proto(Protocol):
    def m(self) -> int: ...
print(Proto, isinstance(Proto, type))
os.makedirs("d/sub", exist_ok=True)
p = pathlib.Path("d/sub/f.txt")
p.write_text("hola\nmundo\n")
print(p.exists(), p.read_text().splitlines(), p.name, p.suffix, p.stem, p.parent, p.parts, sorted(x.name for x in pathlib.Path("d").rglob("*")), os.listdir("d"), os.path.join("a", "b"), os.path.splitext("x.tar.gz"), os.path.basename("/a/b.c"), os.path.exists("zz"))
with open("d/data.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["a", "b c", 'd"e']); w.writerows([[1, 2, 3], ["x,y", None, 1.5]])
print(open("d/data.csv").read())
with open("d/data.csv") as f: print(list(csv.reader(f)))
with open("d/dd.csv", "w", newline="") as f:
    dw = csv.DictWriter(f, fieldnames=["n", "v"]); dw.writeheader(); dw.writerow({"n": "a", "v": 1})
print(list(csv.DictReader(open("d/dd.csv"))), os.getcwd(), os.path.getsize("d/sub/f.txt"), os.stat("d/sub/f.txt").st_size, sorted(os.walk("d"))[0][1])
p.unlink(); os.rmdir("d/sub"); print(os.path.isdir("d/sub"), pathlib.Path("d").is_dir(), pathlib.Path("/a/b").joinpath("c").as_posix(), pathlib.PurePosixPath("a/b").with_suffix(".x"))
print(sys.version_info >= (3, 8), sys.platform, sys.argv, sys.maxsize)
