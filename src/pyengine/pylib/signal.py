"""signal (stub): no hay señales reales en este entorno."""
import enum as _enum

SIG_DFL = 0
SIG_IGN = 1
NSIG = 65


class Signals(_enum.IntEnum):
    SIGHUP = 1
    SIGINT = 2
    SIGQUIT = 3
    SIGILL = 4
    SIGABRT = 6
    SIGFPE = 8
    SIGKILL = 9
    SIGSEGV = 11
    SIGPIPE = 13
    SIGALRM = 14
    SIGTERM = 15
    SIGUSR1 = 10
    SIGUSR2 = 12
    SIGCHLD = 17


globals().update(Signals.__members__)

_handlers = {}


def default_int_handler(signum, frame):
    raise KeyboardInterrupt


def signal(signalnum, handler):
    old = _handlers.get(signalnum, SIG_DFL if signalnum != Signals.SIGINT else default_int_handler)
    _handlers[signalnum] = handler
    return old


def getsignal(signalnum):
    return _handlers.get(signalnum, SIG_DFL if signalnum != Signals.SIGINT else default_int_handler)


def alarm(seconds):
    return 0


def pause():
    raise RuntimeError("signal.pause() no está disponible")


def raise_signal(signalnum):
    h = getsignal(signalnum)
    if callable(h):
        h(signalnum, None)


def strsignal(signalnum):
    return Signals(signalnum).name


def valid_signals():
    return set(Signals)
