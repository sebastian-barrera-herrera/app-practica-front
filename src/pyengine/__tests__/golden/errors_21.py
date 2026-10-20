def show(label, f):
    try:
        f()
    except BaseException as e:
        print(label, repr(e), [repr(x) for x in getattr(e, "exceptions", ())], type(e.__context__).__name__, type(e.__cause__).__name__)
    else:
        print(label, "no exception")

def t1():
    try:
        raise ValueError(1)
    except* ValueError as eg:
        print("handled", repr(eg))
def t2():
    try:
        raise TypeError(2)
    except* ValueError:
        print("never")
def t3():
    try:
        raise ExceptionGroup("g", [ValueError(1), TypeError(2), OSError(3)])
    except* ValueError as eg:
        print("v", repr(eg))
def t4():
    try:
        raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError:
        raise KeyError("new")
def t5():
    try:
        raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError:
        raise
def t6():
    try:
        raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* (ValueError, TypeError) as eg:
        print("both", len(eg.exceptions))
def t7():
    try:
        raise ExceptionGroup("g", [ValueError(1), ExceptionGroup("inner", [TypeError(2), ValueError(3)])])
    except* ValueError as eg:
        print("nested", repr(eg))
    except* TypeError as eg:
        print("nested t", repr(eg))
def t8():
    try:
        try:
            raise ValueError(1)
        except* ValueError:
            raise
    except* ValueError as eg:
        print("re", repr(eg))
def t9():
    try:
        raise ValueError(1)
    except* ValueError:
        raise TypeError("x")
def t10():
    try:
        raise ExceptionGroup("g", [ValueError(1), TypeError(2)])
    except* ValueError as e:
        raise RuntimeError("a") from e
    else:
        print("else")
    finally:
        print("finally")
def t11():
    try:
        pass
    except* ValueError:
        pass
    else:
        print("else ran")
    finally:
        print("fin")
def t12():
    try:
        raise ExceptionGroup("g", [ValueError(1)])
    except* int:
        pass
def t13():
    try:
        raise ExceptionGroup("g", [ValueError(1)])
    except* ExceptionGroup:
        pass
for i, t in enumerate([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13], 1):
    show("t%d" % i, t)
