"""Política de bucles de eventos por defecto (sin señales ni observadores de procesos)."""

from . import base_events
from . import events

__all__ = (
    'SelectorEventLoop', 'DefaultEventLoopPolicy', 'EventLoop',
)

SelectorEventLoop = EventLoop = base_events.DefaultEventLoop


class _UnixDefaultEventLoopPolicy(events.BaseDefaultEventLoopPolicy):
    """Política con un bucle por hilo."""
    _loop_factory = base_events.DefaultEventLoop


_DefaultEventLoopPolicy = DefaultEventLoopPolicy = _UnixDefaultEventLoopPolicy
