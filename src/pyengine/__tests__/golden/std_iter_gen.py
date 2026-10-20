import functools, itertools, contextlib, inspect, sys, io
class Cuenta:
    def __init__(self, n): self.n = n
    def __iter__(self): return self
    def __next__(self):
        if self.n <= 0: raise StopIteration
        self.n -= 1
        return self.n + 1
c = Cuenta(3)
print(list(c), list(c), next(iter([1])), next(iter([]), "fin"))
it = iter([1, 2])
print(next(it), next(it))
try: next(it)
except StopIteration as e: print("StopIteration", repr(e), e.value)
print(iter([1]), iter({1: 2}), iter(range(3)), iter((1,)), iter({1}), reversed([1]), enumerate([1]), zip([1], [2]))
print(iter(lambda: 1, 1), list(iter(iter([1,2,3]).__next__, 3)))
try: iter(5)
except TypeError as e: print(e)
try: next([1])
except TypeError as e: print(e)
def gen():
    x = yield 1
    print("recibí", x)
    y = yield 2
    print("recibí", y)
    return "fin"
g = gen()
print(g, next(g), g.send("a"))
try: g.send("b")
except StopIteration as e: print("ret", e.value)
print(inspect.getgeneratorstate(g))
def cuenta_atras(n):
    while n > 0:
        yield n
        n -= 1
print(list(cuenta_atras(3)), sum(x*x for x in range(4)), (x for x in []))
def sub():
    r = yield from cuenta_atras(2)
    yield "fin"
print(list(sub()))
def conv():
    try:
        while True:
            v = yield
            print("got", v)
    finally:
        print("cerrando")
g = conv(); next(g); g.send(1); g.close()
def pg():
    try:
        yield 1
    except ValueError as e:
        yield f"capturado {e}"
g = pg(); next(g); print(g.throw(ValueError("boom")))
def infinito():
    n = 0
    while True:
        yield n
        n += 1
print(list(itertools.islice(infinito(), 3)), next(infinito()))
def deco(f):
    @functools.wraps(f)
    def w(*a, **k):
        """wrapper"""
        print("antes", f.__name__)
        return f(*a, **k)
    return w
@deco
def saluda(n, g="hola"):
    """Saluda."""
    return f"{g} {n}"
print(saluda("Ana"), saluda.__name__, saluda.__doc__, saluda.__wrapped__.__name__, inspect.signature(saluda))
def rep(n):
    def d(f):
        def w(*a, **k):
            return [f(*a, **k) for _ in range(n)]
        return w
    return d
@rep(2)
def hi(): return "hi"
print(hi(), hi.__name__)
class Cnt:
    def __init__(self, f): self.f = f; self.n = 0; functools.update_wrapper(self, f)
    def __call__(self, *a): self.n += 1; return self.f(*a)
@Cnt
def dbl(x): return x * 2
dbl(1); dbl(2); print(dbl.n, dbl.__name__)
@functools.lru_cache(maxsize=None)
def fib(n): return n if n < 2 else fib(n-1) + fib(n-2)
print(fib(30), fib.cache_info(), fib.__wrapped__(5))
fib.cache_clear(); print(fib.cache_info())
@functools.cache
def sq(x): return x*x
print(sq(3), sq.cache_info())
p = functools.partial(int, base=2)
print(p("101"), p, functools.reduce(lambda a, b: a*b, [1,2,3,4]), functools.reduce(lambda a,b:a+b, [], 0))
@contextlib.contextmanager
def etiqueta(n):
    print("<"+n+">")
    try:
        yield n.upper()
    finally:
        print("</"+n+">")
with etiqueta("b") as v: print("dentro", v)
with contextlib.suppress(ZeroDivisionError): 1/0
print("tras suppress")
class Ctx:
    def __enter__(self): print("enter"); return self
    def __exit__(self, t, v, tb):
        print("exit", t.__name__ if t else None, v)
        return t is ValueError
with Ctx(): print("ok")
with Ctx(): raise ValueError("x")
try:
    with Ctx(): raise KeyError("k")
except KeyError: print("KeyError propagó")
buf = io.StringIO()
with contextlib.redirect_stdout(buf): print("capturado")
print(repr(buf.getvalue()))
with contextlib.ExitStack() as st:
    st.callback(print, "cb1"); st.callback(print, "cb2")
print(isinstance(etiqueta("x"), contextlib.AbstractContextManager))
@functools.total_ordering
class V:
    def __init__(s, x): s.x = x
    def __eq__(s, o): return s.x == o.x
    def __lt__(s, o): return s.x < o.x
print(V(1) <= V(2), V(3) > V(2), V(1) >= V(1))
class Pf:
    @functools.cached_property
    def v(self):
        print("calculo"); return 42
o = Pf(); print(o.v, o.v)
@functools.singledispatch
def fmt(x): return f"obj {x}"
@fmt.register
def _(x: int): return f"int {x}"
@fmt.register(list)
def _(x): return f"lista {len(x)}"
print(fmt(1), fmt([1,2]), fmt("a"))
print(list(itertools.accumulate([1,2,3], lambda a,b: a*b)), list(itertools.starmap(pow, [(2,3),(3,2)])), list(itertools.takewhile(lambda x: x<3, [1,2,3,1])), list(itertools.dropwhile(lambda x: x<3,[1,2,3,1])), list(itertools.compress("abc",[1,0,1])), list(itertools.repeat(7,2)), list(itertools.pairwise([1,2,3])), list(itertools.batched(range(5),2)))
t1, t2 = itertools.tee([1,2,3]); print(list(t1), list(t2))
print(list(map(lambda a,b:a+b,[1,2],[3,4])), list(filter(None,[0,1,2])), list(zip(*[(1,2),(3,4)])))
g = (x for x in range(2))
print(g, g.__name__, g.__qualname__)
def f():
    return sum(1 / x for x in [1, 0])
try:
    f()
except ZeroDivisionError:
    import traceback
    traceback.print_exc()
async def a():
    pass
def gg():
    try:
        yield 1
    except ValueError as e:
        yield f"cap {e}"
    finally:
        print("fin")
h = gg(); next(h); print(h.throw(ValueError("x"))); h.close()
