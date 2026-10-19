"""contextvars (versión sin hilos): ContextVar, Token y Context."""

__all__ = ('Context', 'ContextVar', 'Token', 'copy_context')


class _Missing:
    def __repr__(self):
        return '<Token.MISSING>'


class Token:
    MISSING = _Missing()

    def __init__(self, context, var, old_value):
        self._context = context
        self._var = var
        self._old_value = old_value
        self._used = False

    @property
    def var(self):
        return self._var

    @property
    def old_value(self):
        return self._old_value

    def __repr__(self):
        return f"<Token{' used' if self._used else ''} var={self._var!r} at 0x{id(self):x}>"

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._var.reset(self)


class Context(dict):
    def run(self, callable, *args, **kwargs):
        global _current
        prev = _current
        _current = self
        try:
            return callable(*args, **kwargs)
        finally:
            _current = prev

    def copy(self):
        return Context(self)


_current = Context()
_MISSING = object()


def copy_context():
    return _current.copy()


class ContextVar:
    def __init__(self, name, *, default=_MISSING):
        if not isinstance(name, str):
            raise TypeError("context variable name must be a str")
        self._name = name
        self._default = default

    @property
    def name(self):
        return self._name

    def get(self, *args):
        if len(args) > 1:
            raise TypeError(f"get expected at most 1 argument, got {len(args)}")
        try:
            return _current[self]
        except KeyError:
            pass
        if args:
            return args[0]
        if self._default is not _MISSING:
            return self._default
        raise LookupError(self)

    def set(self, value):
        old = _current.get(self, Token.MISSING)
        _current[self] = value
        return Token(_current, self, old)

    def reset(self, token):
        if token._used:
            raise RuntimeError(f"{token!r} has already been used once")
        if token._var is not self:
            raise ValueError(f"{token!r} was created by a different ContextVar")
        token._used = True
        if token._old_value is Token.MISSING:
            _current.pop(self, None)
        else:
            _current[self] = token._old_value

    def __hash__(self):
        return object.__hash__(self)

    def __repr__(self):
        r = f'<ContextVar name={self._name!r}'
        if self._default is not _MISSING:
            r += f' default={self._default!r}'
        return r + f' at 0x{id(self):x}>'

    def __class_getitem__(cls, item):
        from types import GenericAlias
        return GenericAlias(cls, item)
