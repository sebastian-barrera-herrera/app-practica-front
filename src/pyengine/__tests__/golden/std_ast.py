import ast
src = '''
import os, sys as s
from . import x as y
@dec
def f(a, b=1, *args, c, d=2, **kw) -> int:
    """doc"""
    x = [i * 2 for i in range(a) if i % 2]
    async def g(): await z
    return a + b if c else -a
class C(Base, metaclass=M):
    y: int = 3
    def m(self): yield from self
with open(f) as fh, g():
    pass
try:
    raise ValueError("x") from e
except (A, B) as err:
    print(f"{err!r:>10} and {1+2}")
finally:
    del a[1:2], b.c
match p:
    case [1, 2, *rest] | {"k": v, **kw} if v:
        pass
    case Point(x=0) as q:
        pass
    case _:
        pass
lambda x, /, y: (x, y)
a = b = c[1, 2:3] ** -4
x += 1; assert x, "m"
global gg
for i in range(3): print(i)
else: pass
while True: break
type T[X] = list[X]
'''
tree = ast.parse(src)
print(ast.dump(tree, indent=1, include_attributes=True)[:3000])
print(ast.dump(ast.parse("a + b * c", mode="eval")))
print(ast.unparse(tree))
