import functools as ft
from functools import partial, reduce, lru_cache, wraps, cache, total_ordering, cmp_to_key, singledispatch, cached_property
print(reduce(lambda a, b: a + b, [1, 2, 3, 4]), reduce(lambda a, b: a * b, [1, 2, 3], 10), partial(int, base=2)("101"), partial(pow, 2)(5))
@lru_cache(maxsize=None)
def fib(n): return n if n < 2 else fib(n - 1) + fib(n - 2)
print(fib(50), fib.cache_info(), fib.__wrapped__(10))
fib.cache_clear(); print(fib.cache_info())
@cache
def sq(x): return x * x
print(sq(4), sq(4), sq.cache_info().hits)
def deco(f):
    @wraps(f)
    def w(*a, **k): return f(*a, **k)
    return w
@deco
def hello(): "doc"; return 1
print(hello.__name__, hello.__doc__, hello.__wrapped__.__name__)
@total_ordering
class V:
    def __init__(self, n): self.n = n
    def __eq__(self, o): return self.n == o.n
    def __lt__(self, o): return self.n < o.n
print(V(1) < V(2), V(2) >= V(1), V(1) > V(2), V(1) <= V(1))
print(sorted([3, 1, 2], key=cmp_to_key(lambda a, b: b - a)))
@singledispatch
def show(x): return "otro"
@show.register(int)
def _(x): return "int"
@show.register(str)
def _(x): return "str"
print(show(1), show("a"), show(1.5), show([]))
class C:
    @cached_property
    def v(self):
        print("calculando"); return 42
c = C(); print(c.v, c.v)
p = partial(print, "a", sep="-")
p("b"); print(p.func is print, p.args, p.keywords)
print(ft.reduce(max, [3, 9, 2]))
