import traceback, sys

def f(x):
    return 1 / x

def g(lst):
    return lst[5] + f(0)

try:
    g([1])
except Exception:
    traceback.print_exc()
    s = traceback.format_exc()
    print(repr(s))
    e = sys.exc_info()[1]
    print(traceback.format_exception_only(type(e), e))
    print(traceback.format_exception(e))
    tb = e.__traceback__
    for fs in traceback.extract_tb(tb):
        print(fs.filename, fs.lineno, fs.name, fs.line, fs.colno, fs.end_colno)
    print(traceback.format_tb(tb))
    traceback.print_tb(tb, limit=1)

def h():
    try:
        {}['a']
    except KeyError as e:
        raise RuntimeError("wrapped") from e

try:
    h()
except Exception as e:
    traceback.print_exception(e)
    te = traceback.TracebackException.from_exception(e)
    print(list(te.format_exception_only()))

def st():
    return traceback.extract_stack()
print([(x.name, x.lineno) for x in st()])
traceback.print_stack(limit=1)
print(traceback.format_list([("a.py", 3, "fn", "code()")]))

try:
    nme
except NameError:
    traceback.print_exc()
try:
    "abc".upperr()
except AttributeError:
    traceback.print_exc()
try:
    int("x")
except ValueError:
    traceback.print_exc(limit=0)
    traceback.print_exc(file=sys.stdout, chain=False)

try:
    raise ExceptionGroup("eg", [ValueError(1), TypeError(2)])
except* ValueError:
    traceback.print_exc()
except* TypeError as e:
    traceback.print_exception(e)
