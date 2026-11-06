import numbers


class InvalidParameterError(ValueError, TypeError):
    """Un hiperparámetro no cumple su restricción."""


def _bound(v, default):
    if v is None:
        return default
    return repr(v) if isinstance(v, float) else str(v)


def check_interval(estimator, name, value, kind=int, lo=None, hi=None, closed='left', none_ok=False, extra=''):
    """Comprueba que `value` sea un `kind` en el intervalo; si no, lanza el mismo error que scikit-learn."""
    ok = False
    if value is None and none_ok:
        return
    if kind is int:
        is_type = isinstance(value, numbers.Integral) and not isinstance(value, bool)
    else:
        is_type = isinstance(value, numbers.Real) and not isinstance(value, bool)
    if is_type:
        ok = True
        if lo is not None:
            if closed in ('left', 'both'):
                ok = ok and value >= lo
            else:
                ok = ok and value > lo
        if hi is not None:
            if closed in ('right', 'both'):
                ok = ok and value <= hi
            else:
                ok = ok and value < hi
    if ok:
        return
    left = '[' if closed in ('left', 'both') and lo is not None else '('
    right = ']' if closed in ('right', 'both') and hi is not None else ')'
    desc = ('an int' if kind is int else 'a float') + ' in the range %s%s, %s%s' % (left, _bound(lo, '-inf'), _bound(hi, 'inf'), right)
    if extra:
        desc += ', ' + extra
    if none_ok:
        desc += ' or None'
    raise InvalidParameterError("The '%s' parameter of %s must be %s. Got %r instead." % (name, type(estimator).__name__, desc, value))
