"""Piezas de `_operator` que no tienen versión en Python puro."""
__all__ = ['_compare_digest']


def _compare_digest(a, b):
    if isinstance(a, str) and isinstance(b, str):
        a, b = a.encode(), b.encode()
    if len(a) != len(b):
        return False
    r = 0
    for x, y in zip(a, b):
        r |= x ^ y
    return r == 0
