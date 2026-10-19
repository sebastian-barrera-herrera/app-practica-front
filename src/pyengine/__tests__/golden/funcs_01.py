def f(a, b=2, *args, c=3, **kw):
    return (a, b, args, c, kw)
print(f(1), f(1, 5, 6, 7, c=9, z=1), f(*[1, 2], **{"c": 4}))
def g(x, /, y, *, z): return x + y + z
print(g(1, 2, z=3), g.__name__, g.__doc__, g.__defaults__)
def counter():
    n = 0
    def inc():
        nonlocal n
        n += 1
        return n
    return inc
c = counter(); c(); c()
print(c(), c.__closure__[0].cell_contents)
x = 10
def shadow():
    global x
    x = 20
shadow(); print(x)
sq = lambda v: v * v
print(sq(4), (lambda *a, **k: (a, k))(1, k=2), list(map(lambda t: t[0], [(1, 2), (3, 4)])))
def deco(fn):
    def wrap(*a, **k):
        print("antes", fn.__name__)
        r = fn(*a, **k)
        print("despues")
        return r
    wrap.__name__ = fn.__name__
    return wrap
@deco
def hello(n): return f"hola {n}"
print(hello("x"))
def deco_arg(times):
    def d(fn):
        def w(*a):
            return [fn(*a) for _ in range(times)]
        return w
    return d
@deco_arg(3)
def tick(): return "t"
print(tick())
def gen(n):
    for i in range(n):
        x = yield i
        if x: print("recibido", x)
    return "fin"
g1 = gen(3)
print(next(g1), g1.send("hola"), next(g1))
try: next(g1)
except StopIteration as e: print("stop", e.value)
def outer():
    yield from range(3)
    yield from "ab"
    r = yield from gen(1)
    yield r
print(list(outer()))
print(sum(i for i in range(10)), max((len(s), s) for s in ["a", "bcd", "ef"]))
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
print([fib(i) for i in range(15)])
import_ = __import__
print(callable(f), callable(5), f.__qualname__, type(f).__name__)
def kwonly(*, a, b=1): return a + b
print(kwonly(a=1))
try: kwonly(1)
except TypeError as e: print(e)
try: f()
except TypeError as e: print(e)
try: g(1, 2, 3)
except TypeError as e: print(e)
try: g(1, y=2, z=3, w=4)
except TypeError as e: print(e)
def default_mut(a, l=[]):
    l.append(a); return l
print(default_mut(1), default_mut(2))
print([(lambda i=i: i)() for i in range(3)], [f() for f in [lambda: j for j in range(3)]])
def rec_closure():
    fs = []
    for i in range(3):
        fs.append(lambda: i)
    return [f() for f in fs]
print(rec_closure())
print(*[1, 2, 3], sep="-", end="!\n")
a = [1, 2, 3]
b = a
b += [4]
print(a, a is b, a == [1, 2, 3, 4])
t = (1, 2)
t += (3,)
print(t)
s = "ab"; s += "c"; print(s)
print(isinstance(gen(1), type(x for x in [])), gen.__name__)
