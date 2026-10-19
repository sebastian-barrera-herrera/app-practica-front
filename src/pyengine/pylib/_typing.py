"""Implementación en Python del módulo `_typing` de CPython (TypeVar, ParamSpec, TypeVarTuple, Generic…)."""
import sys


def _idfunc(_, x):
    return x


class NoDefaultType:
    """El tipo de NoDefault."""
    __slots__ = ()
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = object.__new__(cls)
        return cls._instance

    def __repr__(self):
        return 'typing.NoDefault'

    def __reduce__(self):
        return 'NoDefault'


NoDefault = NoDefaultType()


def _caller_module(depth=2):
    try:
        return sys._getframe(depth).f_globals.get('__name__', '__main__')
    except Exception:
        return '__main__'


def _type_check(arg, msg):
    import typing
    return typing._type_check(arg, msg, is_argument=True)


class _Variance:
    def _repr_prefix(self):
        if getattr(self, '__infer_variance__', False):
            return ''
        if self.__covariant__:
            return '+'
        if self.__contravariant__:
            return '-'
        return '~'


class TypeVar(_Variance):
    """Type variable."""

    def __init__(self, name, *constraints, bound=None, covariant=False, contravariant=False,
                 infer_variance=False, default=NoDefault):
        if not isinstance(name, str):
            raise TypeError(f"TypeVar() argument 1 must be str, not {type(name).__name__}")
        if covariant and contravariant:
            raise ValueError("Bivariant type variables are not supported.")
        if infer_variance and (covariant or contravariant):
            raise ValueError("Variance cannot be specified with infer_variance.")
        if constraints and bound is not None:
            raise TypeError("Constraints cannot be combined with bound=...")
        if constraints and len(constraints) == 1:
            raise TypeError("A single constraint is not allowed")
        self.__name__ = name
        self.__covariant__ = bool(covariant)
        self.__contravariant__ = bool(contravariant)
        self.__infer_variance__ = bool(infer_variance)
        msg = "TypeVar(name, constraint, ...): constraints must be types."
        self.__constraints__ = tuple(_type_check(t, msg) for t in constraints)
        self.__bound__ = _type_check(bound, "Bound must be a type.") if bound is not None else None
        self.__default__ = default
        self.__module__ = _caller_module()

    def has_default(self):
        return self.__default__ is not NoDefault

    def __repr__(self):
        return self._repr_prefix() + self.__name__

    def __or__(self, right):
        import typing
        return typing.Union[self, right]

    def __ror__(self, left):
        import typing
        return typing.Union[left, self]

    def __reduce__(self):
        return self.__name__

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of TypeVar")

    def __typing_subst__(self, arg):
        import typing
        msg = "Parameters to generic types must be types."
        arg = typing._type_check(arg, msg, is_argument=True)
        if (isinstance(arg, typing._GenericAlias) and arg.__origin__ is typing.Unpack) or \
                (isinstance(arg, __import__('types').GenericAlias) and getattr(arg, '__unpacked__', False)):
            raise TypeError(f"{arg} is not valid as type argument")
        return arg

    def __typing_prepare_subst__(self, alias, args):
        params = alias.__parameters__
        i = params.index(self)
        if i < len(args):
            return args
        elif i == len(args):
            if self.has_default():
                return (*args, self.__default__)
        raise TypeError(f"Too few arguments for {alias}; actual {len(args)}, expected at least {i + 1}")

    def __init_subclass__(cls):
        raise TypeError("type 'typing.TypeVar' is not an acceptable base type")


TypeVar.__name__ = 'TypeVar'
TypeVar.__qualname__ = 'TypeVar'
TypeVar.__module__ = 'typing'


class ParamSpecArgs:
    def __init__(self, origin):
        self.__origin__ = origin

    def __repr__(self):
        return f"{self.__origin__.__name__}.args"

    def __eq__(self, other):
        if not isinstance(other, ParamSpecArgs):
            return NotImplemented
        return self.__origin__ == other.__origin__

    def __hash__(self):
        return hash((ParamSpecArgs, self.__origin__))

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of ParamSpecArgs")


class ParamSpecKwargs:
    def __init__(self, origin):
        self.__origin__ = origin

    def __repr__(self):
        return f"{self.__origin__.__name__}.kwargs"

    def __eq__(self, other):
        if not isinstance(other, ParamSpecKwargs):
            return NotImplemented
        return self.__origin__ == other.__origin__

    def __hash__(self):
        return hash((ParamSpecKwargs, self.__origin__))

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of ParamSpecKwargs")


class ParamSpec(_Variance):
    """Parameter specification variable."""

    @property
    def args(self):
        return ParamSpecArgs(self)

    @property
    def kwargs(self):
        return ParamSpecKwargs(self)

    def __init__(self, name, *, bound=None, covariant=False, contravariant=False, infer_variance=False,
                 default=NoDefault):
        self.__name__ = name
        self.__covariant__ = bool(covariant)
        self.__contravariant__ = bool(contravariant)
        self.__infer_variance__ = bool(infer_variance)
        self.__bound__ = _type_check(bound, "Bound must be a type.") if bound is not None else None
        self.__default__ = default
        self.__module__ = _caller_module()

    def has_default(self):
        return self.__default__ is not NoDefault

    def __repr__(self):
        return self._repr_prefix() + self.__name__

    def __or__(self, right):
        import typing
        return typing.Union[self, right]

    def __ror__(self, left):
        import typing
        return typing.Union[left, self]

    def __reduce__(self):
        return self.__name__

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of ParamSpec")

    def __typing_subst__(self, arg):
        import typing
        if isinstance(arg, (list, tuple)):
            arg = tuple(typing._type_check(a, "Expected a type.") for a in arg)
        elif not _is_param_expr(arg):
            raise TypeError(f"Expected a list of types, an ellipsis, ParamSpec, or Concatenate. Got {arg}")
        return arg

    def __typing_prepare_subst__(self, alias, args):
        import typing
        params = alias.__parameters__
        i = params.index(self)
        if i >= len(args):
            if self.has_default():
                args = (*args, self.__default__)
            else:
                raise TypeError(f"Too few arguments for {alias}")
        # Special case where Z[[int, str, bool]] == Z[int, str, bool] in PEP 612.
        if len(params) == 1 and not _is_param_expr(args[0]):
            assert i == 0
            args = (args,)
        elif isinstance(args[i], list):
            args = (*args[:i], tuple(args[i]), *args[i + 1:])
        return args


ParamSpec.__module__ = 'typing'


def _is_param_expr(arg):
    import typing
    return arg is ... or isinstance(arg, (tuple, list, ParamSpec, typing._ConcatenateGenericAlias))


class TypeVarTuple:
    """Type variable tuple."""

    def __init__(self, name, *, default=NoDefault):
        self.__name__ = name
        self.__default__ = default
        self.__module__ = _caller_module()

    def has_default(self):
        return self.__default__ is not NoDefault

    def __iter__(self):
        import typing
        yield typing.Unpack[self]

    def __repr__(self):
        return self.__name__

    def __reduce__(self):
        return self.__name__

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of TypeVarTuple")

    def __typing_subst__(self, arg):
        raise TypeError("Substitution of bare TypeVarTuple is not supported")

    def __typing_prepare_subst__(self, alias, args):
        import typing
        params = alias.__parameters__
        typevartuple_index = params.index(self)
        for param in params[typevartuple_index + 1:]:
            if isinstance(param, TypeVarTuple):
                raise TypeError(f"More than one TypeVarTuple parameter in {alias}")
        alen = len(args)
        plen = len(params)
        left = typevartuple_index
        right = plen - typevartuple_index - 1
        var_tuple_index = None
        fillarg = None
        for k, arg in enumerate(args):
            if not isinstance(arg, type):
                subargs = getattr(arg, '__typing_unpacked_tuple_args__', None)
                if subargs and len(subargs) == 2 and subargs[-1] is ...:
                    if var_tuple_index is not None:
                        raise TypeError("More than one unpacked arbitrary-length tuple argument")
                    var_tuple_index = k
                    fillarg = subargs[0]
        if var_tuple_index is not None:
            left = min(left, var_tuple_index)
            right = min(right, alen - var_tuple_index - 1)
        elif left + right > alen:
            raise TypeError(f"Too few arguments for {alias}; actual {alen}, expected at least {plen - 1}")
        if left == alen - right and self.has_default():
            replacement = _unpack_args(self.__default__)
        else:
            replacement = args[left: alen - right]
        return (
            *args[:left],
            *([fillarg] * (typevartuple_index - left)),
            replacement,
            *([fillarg] * (plen - right - left - typevartuple_index - 1)),
            *args[alen - right:],
        )


TypeVarTuple.__module__ = 'typing'


def _unpack_args(*args):
    import typing
    newargs = []
    for arg in args:
        subargs = getattr(arg, '__typing_unpacked_tuple_args__', None)
        if subargs is not None and not (subargs and subargs[-1] is ...):
            newargs.extend(subargs)
        else:
            newargs.append(arg)
    return newargs


class TypeAliasType:
    """Type alias."""

    def __init__(self, name, value, *, type_params=()):
        if not isinstance(name, str):
            raise TypeError("TypeAliasType name must be a string")
        self.__name__ = name
        self.__value__ = value
        self.__type_params__ = tuple(type_params)
        self.__parameters__ = tuple(p for p in type_params if not isinstance(p, TypeVarTuple) or True)
        self.__module__ = _caller_module()

    def __getitem__(self, parameters):
        import types
        if not isinstance(parameters, tuple):
            parameters = (parameters,)
        return types.GenericAlias(self, parameters)

    def __repr__(self):
        return self.__name__

    def __or__(self, right):
        import typing
        return typing.Union[self, right]

    def __ror__(self, left):
        import typing
        return typing.Union[left, self]

    def __reduce__(self):
        return self.__name__

    def __mro_entries__(self, bases):
        raise TypeError("Cannot subclass an instance of TypeAliasType")


TypeAliasType.__module__ = 'typing'


class Generic:
    """Abstract base class for generic types."""
    __slots__ = ()
    _is_protocol = False

    def __class_getitem__(cls, params):
        import typing
        return typing._generic_class_getitem(cls, params)

    def __init_subclass__(cls, *args, **kwargs):
        import typing
        return typing._generic_init_subclass(cls, *args, **kwargs)


Generic.__module__ = 'typing'
