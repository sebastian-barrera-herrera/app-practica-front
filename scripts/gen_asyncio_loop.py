#!/usr/bin/env python3
"""
Genera src/pyengine/pylib/asyncio/base_events.py: el bucle de eventos de asyncio SIN red (sin sockets, ssl ni subprocesos),
extrayendo de la implementación de CPython 3.13 los métodos del planificador. El reloj es el virtual del intérprete,
de modo que `await asyncio.sleep(1)` no espera de verdad.
Uso: python3 scripts/gen_asyncio_loop.py
"""
import ast, os, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STD = os.path.join(os.path.dirname(os.__file__), 'asyncio', 'base_events.py')
OUT = os.path.join(ROOT, 'src', 'pyengine', 'pylib', 'asyncio', 'base_events.py')

src = open(STD, encoding='utf8').read()
tree = ast.parse(src)
lines = src.splitlines()

KEEP_METHODS = '''__init__ __repr__ create_future create_task set_task_factory get_task_factory _check_closed
_check_default_executor _asyncgen_finalizer_hook _asyncgen_firstiter_hook shutdown_asyncgens shutdown_default_executor _do_shutdown
_check_running _run_forever_setup _run_forever_cleanup run_forever run_until_complete stop close is_closed __del__ is_running time
call_later call_at call_soon _check_callback _call_soon _check_thread call_soon_threadsafe run_in_executor set_default_executor
get_exception_handler set_exception_handler default_exception_handler call_exception_handler _add_callback _add_callback_signalsafe
_timer_handle_cancelled _run_once _set_coroutine_origin_tracking get_debug set_debug'''.split()

def seg(node):
    start = node.lineno - 1
    if getattr(node, 'decorator_list', None):
        start = node.decorator_list[0].lineno - 1
    return '\n'.join(lines[start:node.end_lineno])

parts = []
header = '''"""Bucle de eventos de asyncio sin red (generado por scripts/gen_asyncio_loop.py a partir de CPython 3.13)."""

import collections
import collections.abc
import concurrent.futures
import heapq
import itertools
import os
import threading
import time
import traceback
import sys
import warnings
import weakref

from . import constants
from . import coroutines
from . import events
from . import exceptions
from . import futures
from . import tasks
from . import timeouts
from .log import logger

__all__ = 'BaseEventLoop',

_MIN_SCHEDULED_TIMER_HANDLES = 100
_MIN_CANCELLED_TIMER_HANDLES_FRACTION = 0.5
MAXIMUM_SELECT_TIMEOUT = 24 * 3600

'''
parts.append(header)
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ('_format_handle', '_run_until_complete_cb'):
        parts.append(seg(node) + '\n\n')
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'BaseEventLoop')
body = []
for item in cls.body:
    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name in KEEP_METHODS:
        body.append(seg(item))
missing = set(KEEP_METHODS) - {i.name for i in cls.body if isinstance(i, (ast.FunctionDef, ast.AsyncFunctionDef))}
assert not missing, missing
cls_src = 'class BaseEventLoop(events.AbstractEventLoop):\n\n' + '\n\n'.join(body) + '\n'
# el «selector» virtual: dormir adelanta el reloj virtual
cls_src = cls_src.replace('        self._internal_fds = 0\n', '        self._internal_fds = 0\n        self._selector = _VirtualSelector()\n', 1)
cls_src += '''
    def _write_to_self(self):
        pass

    def _process_events(self, event_list):
        pass

    def add_signal_handler(self, sig, callback, *args):
        raise NotImplementedError

    def remove_signal_handler(self, sig):
        return False
'''
parts.append('''class _VirtualSelector:
    """Sustituye al selector del sistema: «esperar» es adelantar el reloj virtual."""

    def select(self, timeout=None):
        if timeout:
            time.sleep(timeout)
        return []

    def close(self):
        pass


''')
parts.append(cls_src)
parts.append('''

class _VirtualEventLoop(BaseEventLoop):
    """Bucle de eventos por defecto del intérprete."""


DefaultEventLoop = _VirtualEventLoop
''')
open(OUT, 'w', encoding='utf8').write(''.join(parts))
print('→', os.path.relpath(OUT, ROOT))
