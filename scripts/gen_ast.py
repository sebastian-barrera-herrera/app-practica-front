#!/usr/bin/env python3
"""
Genera src/pyengine/pylib/_ast.py (clases de nodos del módulo `ast`) a partir del `ast` de CPython 3.13.
Uso: python3 scripts/gen_ast.py  (luego: python3 scripts/build_pylib.py)
"""
import ast, os, typing

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'pyengine', 'pylib', '_ast.py')


def enc(tp):
    """tipo de campo → 'nombre', 'nombre*' (lista) o 'nombre?' (opcional)"""
    origin = typing.get_origin(tp)
    if origin is list:
        (inner,) = typing.get_args(tp)
        return enc(inner) + '*'
    if origin is typing.Union or str(origin) == "<class 'types.UnionType'>":
        args = [a for a in typing.get_args(tp) if a is not type(None)]
        return enc(args[0]) + '?'
    if isinstance(tp, type):
        return tp.__name__ if tp.__module__ != 'builtins' else tp.__name__
    return str(tp)


def classes():
    seen = []
    def walk(c):
        for s in c.__subclasses__():
            if s.__module__ == 'ast' and s not in seen:
                seen.append(s)
                walk(s)
    walk(ast.AST)
    return seen


lines = []
for c in classes():
    if c.__name__ in ('slice', 'Index', 'ExtSlice', 'Suite', 'AugLoad', 'AugStore', 'Param', 'Num', 'Str', 'Bytes', 'NameConstant', 'Ellipsis') :
        continue
    base = c.__bases__[0].__name__
    ft = getattr(c, '_field_types', {})
    fields = ' '.join(f"{n}:{enc(ft[n])}" for n in c._fields)
    own_attrs = c.__dict__.get('_attributes')
    attrs = ' '.join(own_attrs) if own_attrs else ''
    lines.append(f"{c.__name__}|{base}|{fields}|{attrs}")

spec = '\n'.join(lines)
src = '''"""_ast: clases de los nodos del árbol sintáctico (generado por scripts/gen_ast.py; la lógica está en el intérprete)."""

PyCF_ONLY_AST = 1024
PyCF_TYPE_COMMENTS = 4096
PyCF_ALLOW_TOP_LEVEL_AWAIT = 8192
PyCF_OPTIMIZED_AST = 33792

_SPEC = """%s"""


class AST:
    _fields = ()
    _attributes = ()
    _field_types = {}
    _marks = {}
    __module__ = 'ast'

    def __init__(self, *args, **kwargs):
        cls = type(self)
        fields = cls._fields
        if len(args) > len(fields):
            raise TypeError(f"{cls.__name__} constructor takes at most {len(fields)} positional argument{'' if len(fields) == 1 else 's'}")
        for name, value in zip(fields, args):
            setattr(self, name, value)
        for name, value in kwargs.items():
            if name in fields[:len(args)]:
                raise TypeError(f"{cls.__name__} got multiple values for argument {name!r}")
            if name not in fields and name not in cls._attributes:
                import warnings
                warnings.warn(f"{cls.__name__}.__init__ got an unexpected keyword argument {name!r}. Support for arbitrary keyword arguments is deprecated and will be removed in Python 3.15.", DeprecationWarning, stacklevel=2)
            setattr(self, name, value)
        marks = cls._marks
        missing = []
        for name in fields[len(args):]:
            if name in kwargs:
                continue
            mark = marks.get(name, '')
            if mark == '*':
                setattr(self, name, [])
            elif mark == '?':
                setattr(self, name, None)
            elif name == 'ctx':
                setattr(self, name, Load())
            else:
                missing.append(name)
        if missing:
            import warnings
            n = len(missing)
            names = ', '.join(repr(m) for m in missing[:-1]) + (' and ' if n > 1 else '') + (repr(missing[-1]))
            warnings.warn(f"{cls.__name__}.__init__ missing {n} required positional argument{'s' if n > 1 else ''}: {names}. This will become an error in Python 3.15.", DeprecationWarning, stacklevel=2)

    def __reduce__(self):
        return type(self), (), self.__dict__

    def __setstate__(self, state):
        self.__dict__.update(state)

    def __replace__(self, **kwargs):
        d = dict(self.__dict__)
        d.update(kwargs)
        new = type(self).__new__(type(self))
        new.__dict__.update(d)
        return new


def _make(pending):
    # los tipos base (mod, stmt, expr...) aparecen antes que sus hijos en _SPEC
    classes = {'AST': AST}
    for name, base, fields, attrs in pending:
        bcls = classes[base]
        ns = {'__module__': 'ast'}
        flds = tuple(f.split(':')[0] for f in fields.split()) if fields else ()
        ns['_fields'] = flds
        ns['__match_args__'] = flds
        if attrs:
            ns['_attributes'] = tuple(attrs.split())
        cls = type(name, (bcls,), ns)
        classes[name] = cls
    for name, base, fields, attrs in pending:
        cls = classes[name]
        ft = {}
        marks = {}
        for f in fields.split() if fields else ():
            fname, t = f.split(':')
            mark = ''
            if t[-1] in '*?':
                mark = t[-1]
                t = t[:-1]
            tp = classes.get(t) or {'str': str, 'int': int, 'object': object}[t]
            ft[fname] = list[tp] if mark == '*' else (tp | None if mark == '?' else tp)
            marks[fname] = mark
            if mark == '?':
                setattr(cls, fname, None)
        cls._field_types = ft
        cls._marks = marks
    return classes


_classes = _make([l.split('|') for l in _SPEC.split('\\n')])
globals().update(_classes)
del _classes, _make
''' % spec
open(OUT, 'w', encoding='utf8').write(src)
print(len(lines), 'clases →', os.path.relpath(OUT, ROOT))
