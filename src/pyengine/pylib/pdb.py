"""pdb (reducido): sin depurador interactivo; sólo lo necesario para que otros módulos (doctest) funcionen."""
import sys


class Restart(Exception):
    pass


class Pdb:
    def __init__(self, completekey='tab', stdin=None, stdout=None, skip=None, nosigint=False, readrc=True):
        self.stdout = stdout or sys.stdout
        self.use_rawinput = 1
        self.botframe = None
        self.quitting = False

    def reset(self):
        pass

    def set_trace(self, frame=None):
        pass

    def set_continue(self):
        pass

    def set_quit(self):
        self.quitting = True

    def trace_dispatch(self, frame, event, arg):
        return None

    def interaction(self, frame, traceback):
        pass

    def message(self, msg):
        print(msg, file=self.stdout)


def set_trace(*, header=None):
    pass


def post_mortem(t=None):
    pass


def pm():
    pass


def run(statement, globals=None, locals=None):
    exec(statement, globals, locals)


def runeval(expression, globals=None, locals=None):
    return eval(expression, globals, locals)


def runcall(func, *args, **kwds):
    return func(*args, **kwds)
