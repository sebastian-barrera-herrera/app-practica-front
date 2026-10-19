def classify(x):
    match x:
        case 0: return "cero"
        case 1 | 2: return "uno o dos"
        case int(n) if n > 100: return f"grande {n}"
        case [a, b]: return f"par {a},{b}"
        case [a, *rest]: return f"lista {a} +{len(rest)}"
        case {"k": v}: return f"dict {v}"
        case str() as s: return f"str {s}"
        case (x, y): return "tupla"
        case None: return "none"
        case _: return "otro"
for v in [0, 2, 500, [1, 2], [1, 2, 3], {"k": 9}, "hi", None, 3.5, 7]:
    print(classify(v))
class P:
    __match_args__ = ("x", "y")
    def __init__(self, x, y): self.x, self.y = x, y
match P(1, 2):
    case P(x=1, y=yy): print("y", yy)
match P(3, 4):
    case P(a, b): print(a, b)
i = 0
while True:
    i += 1
    if i < 3: continue
    if i > 5: break
    print("i", i)
else:
    print("no")
for k in range(3):
    pass
else:
    print("for-else", k)
for a, b in [(1, 2), (3, 4)]: print(a + b)
for i, ch in enumerate("ab"): print(i, ch)
n = 5
r = "pos" if n > 0 else "neg"
print(r, n if n else 0, [x for x in range(10) if x % 2 if x > 3])
if (m := n * 2) > 5: print("walrus", m)
print([y for x in [[1, 2], [3]] for y in x], [(a, b) for a in range(2) for b in range(2)])
d = {}
d.setdefault("a", []).append(1)
d.setdefault("a", []).append(2)
print(d)
try:
    try:
        raise ValueError("a")
    finally:
        print("fin1")
except ValueError as e:
    print("cap", e)
else:
    print("else")
def tf():
    try:
        return "try"
    finally:
        print("cleanup")
print(tf())
def tf2():
    for i in range(3):
        try:
            if i == 1: continue
            if i == 2: break
        finally:
            print("f", i)
tf2()
class CM:
    def __enter__(self): print("enter"); return self
    def __exit__(self, t, v, tb): print("exit", t.__name__ if t else None); return True
with CM() as c:
    raise KeyError("x")
print("after")
with CM(), CM():
    print("body")
try:
    raise ValueError("x")
except (KeyError, ValueError) as e:
    print(type(e).__name__, e.args)
try:
    int("z")
except Exception as e:
    print(repr(e), e.__class__.__mro__[1].__name__)
print(isinstance(KeyError(), LookupError), issubclass(ZeroDivisionError, ArithmeticError))
try:
    raise RuntimeError("a")
except RuntimeError as e:
    try:
        raise ValueError("b")
    except ValueError as e2:
        print(e2.__context__ is e, e2.__cause__)
x = 3
del x
try: print(x)
except NameError as e: print(e)
def ff():
    try: return undefined_local
    except NameError as e: return str(e)
print(ff())
def uloc():
    print(zz)
    zz = 1
try: uloc()
except UnboundLocalError as e: print(e)
print(sorted({3: "c", 1: "a"}.items()), sorted("bca"), list(range(10, 0, -3)), list(range(0)), range(5)[2], range(1, 10, 2)[-1], len(range(0, 10, 3)))
print(3 in range(5), range(5) == range(5), list(reversed(range(3))))
