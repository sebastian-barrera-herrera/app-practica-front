# Renombrado de nombres privados (name mangling) y reflexión de comparaciones.
class B:
    __cte = 10

    def __init__(self, __p=3, *, __k=4):
        self.__c = 1
        self.__d__ = 2
        self.__p = __p
        self.__k = __k

    def get(self):
        return self.__c, self.__p, self.__k, self.__cte

    def __m(self):
        return "m"

    def call(self):
        return self.__m()

    def lam(self):
        return (lambda: self.__c)()

    def comp(self):
        return [self.__c + i for i in range(2)]

    class __Inner:
        pass

    def inner(self):
        return self.__Inner

b = B(5, _B__k=6) if False else B(5, **{"_B__k": 6})
print(b.get(), b.call(), b.lam(), b.comp())
print(hasattr(b, "__c"), b._B__c, b.__d__)
print(sorted(n for n in dir(b) if n.startswith("_B")))
print(B._B__m(b), B._B__cte, B.__m if False else "ok")
print(B._B__m.__name__, B._B__m.__qualname__)
print(b.inner().__name__, b.inner() is B._B__Inner)


class _Cls:
    def __init__(self):
        self.__x = 1

    def x(self):
        return self.__x


print(_Cls().x(), sorted(vars(_Cls())))


class ___:
    def __init__(self):
        self.__y = 2


print(sorted(vars(___())))


class Outer:
    def __init__(self):
        self.__v = "outer"

    class Nested:
        def __init__(self):
            self.__v = "nested"

    def run(self):
        n = Outer.Nested()
        return self.__v, sorted(vars(n))


print(Outer().run())


def libre(obj):
    return obj.__z


class Z:
    __z = 7

    def go(self):
        return libre(self)


try:
    Z().go()
except AttributeError as e:
    print("AttributeError:", e)

# Comparaciones: el operador se refleja aunque solo exista el opuesto
class V:
    def __init__(self, x):
        self.x = x

    def __lt__(self, o):
        return self.x < o.x

    def __repr__(self):
        return f"V({self.x})"


print(V(1) > V(2), V(2) > V(1), max(V(1), V(5)), min(V(3), V(2)), sorted([V(3), V(1)], reverse=True))
try:
    V(1) <= V(2)
except TypeError as e:
    print(e)


class W:
    def __init__(self, x):
        self.x = x

    def __eq__(self, o):
        print("eq", self.x)
        return NotImplemented


print(W(1) == W(2), W(1) != W(2))
