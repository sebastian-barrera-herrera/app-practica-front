"""ProcessPoolExecutor del simulador: igual que ThreadPoolExecutor (no hay procesos)."""

from concurrent.futures import _base
from concurrent.futures.thread import ThreadPoolExecutor

__all__ = ['ProcessPoolExecutor']


class BrokenProcessPool(_base.BrokenExecutor):
    pass


class ProcessPoolExecutor(ThreadPoolExecutor):
    def __init__(self, max_workers=None, mp_context=None, initializer=None, initargs=(), *, max_tasks_per_child=None):
        super().__init__(max_workers, '', initializer, initargs)
