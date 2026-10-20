"""ThreadPoolExecutor del simulador: sin hilos reales, cada llamada se ejecuta al enviarla (submit)."""

from concurrent.futures import _base

__all__ = ['ThreadPoolExecutor']


class BrokenThreadPool(_base.BrokenExecutor):
    pass


class ThreadPoolExecutor(_base.Executor):
    def __init__(self, max_workers=None, thread_name_prefix='', initializer=None, initargs=()):
        if max_workers is None:
            max_workers = 8
        if max_workers <= 0:
            raise ValueError("max_workers must be greater than 0")
        if initializer is not None and not callable(initializer):
            raise TypeError("initializer must be a callable")
        self._max_workers = max_workers
        self._thread_name_prefix = thread_name_prefix or ("ThreadPoolExecutor-%d" % 0)
        self._initializer = initializer
        self._initargs = initargs
        self._shutdown = False
        self._initialized = False

    def submit(self, fn, /, *args, **kwargs):
        if self._shutdown:
            raise RuntimeError('cannot schedule new futures after shutdown')
        f = _base.Future()
        if not self._initialized:
            self._initialized = True
            if self._initializer is not None:
                try:
                    self._initializer(*self._initargs)
                except BaseException:
                    f.set_exception(BrokenThreadPool('A thread initializer failed, the thread pool is not usable anymore'))
                    return f
        if not f.set_running_or_notify_cancel():
            return f
        try:
            result = fn(*args, **kwargs)
        except BaseException as exc:
            f.set_exception(exc)
            self = None
        else:
            f.set_result(result)
        return f

    def shutdown(self, wait=True, *, cancel_futures=False):
        self._shutdown = True
