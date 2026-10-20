"""concurrent.futures: los «hilos» del simulador ejecutan cada tarea en el momento de enviarla."""

__author__ = 'Brian Quinlan (brian@sweetapp.com)'

from concurrent.futures._base import (FIRST_COMPLETED, FIRST_EXCEPTION, ALL_COMPLETED, CancelledError, TimeoutError,
                                      InvalidStateError, BrokenExecutor, Future, Executor, wait, as_completed)

__all__ = (
    'FIRST_COMPLETED', 'FIRST_EXCEPTION', 'ALL_COMPLETED', 'CancelledError', 'TimeoutError', 'BrokenExecutor',
    'Future', 'Executor', 'wait', 'as_completed', 'ProcessPoolExecutor', 'ThreadPoolExecutor',
)


def __getattr__(name):
    if name == 'ThreadPoolExecutor':
        from .thread import ThreadPoolExecutor as te
        return te
    if name == 'ProcessPoolExecutor':
        from .process import ProcessPoolExecutor as pe
        return pe
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
