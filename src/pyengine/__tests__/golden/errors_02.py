class MyError(Exception):
    pass
def a():
    try:
        1 / 0
    except ZeroDivisionError as e:
        raise MyError("fallo") from e
def b():
    try:
        a()
    except MyError:
        raise ValueError("otra")
b()
