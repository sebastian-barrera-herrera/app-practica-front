"""threading simplificado: no hay hilos reales; Thread.start() ejecuta el objetivo de inmediato."""
import time as _time
import _thread

get_ident = _thread.get_ident
get_native_id = _thread.get_native_id
Lock = _thread.allocate_lock
RLock = _thread.RLock
local = _thread._local
TIMEOUT_MAX = _thread.TIMEOUT_MAX
ThreadError = _thread.error

__all__ = ['get_ident', 'active_count', 'Condition', 'current_thread', 'enumerate', 'main_thread', 'TIMEOUT_MAX',
           'Event', 'Lock', 'RLock', 'Semaphore', 'BoundedSemaphore', 'Thread', 'Barrier', 'BrokenBarrierError',
           'Timer', 'ThreadError', 'ExceptHookArgs', 'setprofile', 'settrace', 'local', 'stack_size',
           'excepthook', 'get_native_id']

_counter = 0
_active = {}


def _newname(template="Thread-%d"):
    global _counter
    _counter += 1
    return template % _counter


class Thread:
    def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, *, daemon=None):
        self._target = target
        self._name = str(name or _newname())
        self._args = args
        self._kwargs = kwargs if kwargs is not None else {}
        self._daemonic = bool(daemon) if daemon is not None else False
        self._started = False
        self._is_stopped = False
        self._ident = None

    def start(self):
        if self._started:
            raise RuntimeError("threads can only be started once")
        self._started = True
        self._ident = _newident()
        prev = _current[0]
        _current[0] = self
        _active[self._ident] = self
        try:
            self.run()
        except SystemExit:
            pass
        except BaseException as exc:
            import sys
            import traceback
            print(f"Exception in thread {self.name}:", file=sys.stderr)
            traceback.print_exception(type(exc), exc, exc.__traceback__)
        finally:
            _current[0] = prev
            self._is_stopped = True
            _active.pop(self._ident, None)

    def run(self):
        try:
            if self._target is not None:
                self._target(*self._args, **self._kwargs)
        finally:
            del self._target, self._args, self._kwargs

    def join(self, timeout=None):
        if not self._started:
            raise RuntimeError("cannot join thread before it is started")
        if self is current_thread():
            raise RuntimeError("cannot join current thread")

    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, name):
        self._name = str(name)

    @property
    def ident(self):
        return self._ident

    @property
    def native_id(self):
        return self._ident

    def is_alive(self):
        return self._started and not self._is_stopped

    @property
    def daemon(self):
        return self._daemonic

    @daemon.setter
    def daemon(self, daemonic):
        self._daemonic = bool(daemonic)

    def isDaemon(self):
        return self.daemon

    def setDaemon(self, daemonic):
        self.daemon = daemonic

    def getName(self):
        return self.name

    def setName(self, name):
        self.name = name

    def __repr__(self):
        status = "initial"
        if self._started:
            status = "started"
        if self._is_stopped:
            status = "stopped"
        if self._daemonic:
            status += " daemon"
        if self._ident is not None:
            status += " %s" % self._ident
        return "<%s(%s, %s)>" % (self.__class__.__name__, self._name, status)


_ident_counter = [1]


def _newident():
    _ident_counter[0] += 1
    return _ident_counter[0]


class _MainThread(Thread):
    def __init__(self):
        Thread.__init__(self, name="MainThread", daemon=False)
        self._started = True
        self._ident = 1


_main_thread = _MainThread()
_current = [_main_thread]


def current_thread():
    return _current[0]


currentThread = current_thread


def main_thread():
    return _main_thread


def active_count():
    return 1 + len(_active)


activeCount = active_count


def enumerate():
    return [_main_thread] + list(_active.values())


class Timer(Thread):
    def __init__(self, interval, function, args=None, kwargs=None):
        Thread.__init__(self)
        self.interval = interval
        self.function = function
        self.args = args if args is not None else []
        self.kwargs = kwargs if kwargs is not None else {}
        self.finished = Event()

    def cancel(self):
        self.finished.set()

    def run(self):
        _time.sleep(self.interval)
        if not self.finished.is_set():
            self.function(*self.args, **self.kwargs)
        self.finished.set()


class Event:
    def __init__(self):
        self._flag = False

    def is_set(self):
        return self._flag

    isSet = is_set

    def set(self):
        self._flag = True

    def clear(self):
        self._flag = False

    def wait(self, timeout=None):
        if not self._flag and timeout is not None:
            _time.sleep(timeout)
        elif not self._flag:
            raise RuntimeError("deadlock: Event.wait() sin timeout y no hay otros hilos que la activen")
        return self._flag


class Condition:
    def __init__(self, lock=None):
        self._lock = lock if lock is not None else RLock()
        self._waiters = 0

    def __enter__(self):
        return self._lock.__enter__()

    def __exit__(self, *args):
        return self._lock.__exit__(*args)

    def acquire(self, *args):
        return self._lock.acquire(*args)

    def release(self):
        return self._lock.release()

    def wait(self, timeout=None):
        if timeout is not None:
            _time.sleep(timeout)
            return False
        raise RuntimeError("deadlock: Condition.wait() sin timeout y no hay otros hilos")

    def wait_for(self, predicate, timeout=None):
        result = predicate()
        if not result and timeout is not None:
            _time.sleep(timeout)
            result = predicate()
        if not result and timeout is None:
            raise RuntimeError("deadlock: Condition.wait_for() sin timeout y no hay otros hilos")
        return result

    def notify(self, n=1):
        pass

    def notify_all(self):
        pass

    notifyAll = notify_all


class Semaphore:
    def __init__(self, value=1):
        if value < 0:
            raise ValueError("semaphore initial value must be >= 0")
        self._value = value

    def acquire(self, blocking=True, timeout=None):
        if self._value > 0:
            self._value -= 1
            return True
        if not blocking:
            return False
        raise RuntimeError("deadlock: Semaphore.acquire() bloquearía para siempre")

    __enter__ = acquire

    def release(self, n=1):
        self._value += n

    def __exit__(self, t, v, tb):
        self.release()


class BoundedSemaphore(Semaphore):
    def __init__(self, value=1):
        Semaphore.__init__(self, value)
        self._initial_value = value

    def release(self, n=1):
        if self._value + n > self._initial_value:
            raise ValueError("Semaphore released too many times")
        Semaphore.release(self, n)


class BrokenBarrierError(RuntimeError):
    pass


class Barrier:
    def __init__(self, parties, action=None, timeout=None):
        self._parties = parties
        self._action = action

    @property
    def parties(self):
        return self._parties

    def wait(self, timeout=None):
        if self._parties == 1:
            if self._action:
                self._action()
            return 0
        raise BrokenBarrierError


class ExceptHookArgs:
    def __init__(self, args):
        (self.exc_type, self.exc_value, self.exc_traceback, self.thread) = args


def excepthook(args, /):
    import sys
    import traceback
    print(f"Exception in thread {args.thread.name if args.thread else None}:", file=sys.stderr)
    traceback.print_exception(args.exc_type, args.exc_value, args.exc_traceback)


def setprofile(func):
    pass


def settrace(func):
    pass


def stack_size(size=0):
    return 0
