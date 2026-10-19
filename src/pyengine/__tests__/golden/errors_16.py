import sys
class E(Exception):
    def __init__(self, a, b):
        super().__init__(a, b)
try:
    raise E(1, 2)
except E as e:
    print(e.args, str(e), repr(e))
raise KeyError("k")
