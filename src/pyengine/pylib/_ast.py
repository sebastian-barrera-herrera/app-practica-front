"""_ast: clases de los nodos del árbol sintáctico (generado por scripts/gen_ast.py; la lógica está en el intérprete)."""

PyCF_ONLY_AST = 1024
PyCF_TYPE_COMMENTS = 4096
PyCF_ALLOW_TOP_LEVEL_AWAIT = 8192
PyCF_OPTIMIZED_AST = 33792

_SPEC = """mod|AST||
Module|mod|body:stmt* type_ignores:type_ignore*|
Interactive|mod|body:stmt*|
Expression|mod|body:expr|
FunctionType|mod|argtypes:expr* returns:expr|
stmt|AST||lineno col_offset end_lineno end_col_offset
FunctionDef|stmt|name:str args:arguments body:stmt* decorator_list:expr* returns:expr? type_comment:str? type_params:type_param*|
AsyncFunctionDef|stmt|name:str args:arguments body:stmt* decorator_list:expr* returns:expr? type_comment:str? type_params:type_param*|
ClassDef|stmt|name:str bases:expr* keywords:keyword* body:stmt* decorator_list:expr* type_params:type_param*|
Return|stmt|value:expr?|
Delete|stmt|targets:expr*|
Assign|stmt|targets:expr* value:expr type_comment:str?|
TypeAlias|stmt|name:expr type_params:type_param* value:expr|
AugAssign|stmt|target:expr op:operator value:expr|
AnnAssign|stmt|target:expr annotation:expr value:expr? simple:int|
For|stmt|target:expr iter:expr body:stmt* orelse:stmt* type_comment:str?|
AsyncFor|stmt|target:expr iter:expr body:stmt* orelse:stmt* type_comment:str?|
While|stmt|test:expr body:stmt* orelse:stmt*|
If|stmt|test:expr body:stmt* orelse:stmt*|
With|stmt|items:withitem* body:stmt* type_comment:str?|
AsyncWith|stmt|items:withitem* body:stmt* type_comment:str?|
Match|stmt|subject:expr cases:match_case*|
Raise|stmt|exc:expr? cause:expr?|
Try|stmt|body:stmt* handlers:excepthandler* orelse:stmt* finalbody:stmt*|
TryStar|stmt|body:stmt* handlers:excepthandler* orelse:stmt* finalbody:stmt*|
Assert|stmt|test:expr msg:expr?|
Import|stmt|names:alias*|
ImportFrom|stmt|module:str? names:alias* level:int?|
Global|stmt|names:str*|
Nonlocal|stmt|names:str*|
Expr|stmt|value:expr|
Pass|stmt||
Break|stmt||
Continue|stmt||
expr|AST||lineno col_offset end_lineno end_col_offset
BoolOp|expr|op:boolop values:expr*|
NamedExpr|expr|target:expr value:expr|
BinOp|expr|left:expr op:operator right:expr|
UnaryOp|expr|op:unaryop operand:expr|
Lambda|expr|args:arguments body:expr|
IfExp|expr|test:expr body:expr orelse:expr|
Dict|expr|keys:expr* values:expr*|
Set|expr|elts:expr*|
ListComp|expr|elt:expr generators:comprehension*|
SetComp|expr|elt:expr generators:comprehension*|
DictComp|expr|key:expr value:expr generators:comprehension*|
GeneratorExp|expr|elt:expr generators:comprehension*|
Await|expr|value:expr|
Yield|expr|value:expr?|
YieldFrom|expr|value:expr|
Compare|expr|left:expr ops:cmpop* comparators:expr*|
Call|expr|func:expr args:expr* keywords:keyword*|
FormattedValue|expr|value:expr conversion:int format_spec:expr?|
JoinedStr|expr|values:expr*|
Constant|expr|value:object kind:str?|
Attribute|expr|value:expr attr:str ctx:expr_context|
Subscript|expr|value:expr slice:expr ctx:expr_context|
Starred|expr|value:expr ctx:expr_context|
Name|expr|id:str ctx:expr_context|
List|expr|elts:expr* ctx:expr_context|
Tuple|expr|elts:expr* ctx:expr_context|
Slice|expr|lower:expr? upper:expr? step:expr?|
expr_context|AST||
Load|expr_context||
Store|expr_context||
Del|expr_context||
boolop|AST||
And|boolop||
Or|boolop||
operator|AST||
Add|operator||
Sub|operator||
Mult|operator||
MatMult|operator||
Div|operator||
Mod|operator||
Pow|operator||
LShift|operator||
RShift|operator||
BitOr|operator||
BitXor|operator||
BitAnd|operator||
FloorDiv|operator||
unaryop|AST||
Invert|unaryop||
Not|unaryop||
UAdd|unaryop||
USub|unaryop||
cmpop|AST||
Eq|cmpop||
NotEq|cmpop||
Lt|cmpop||
LtE|cmpop||
Gt|cmpop||
GtE|cmpop||
Is|cmpop||
IsNot|cmpop||
In|cmpop||
NotIn|cmpop||
comprehension|AST|target:expr iter:expr ifs:expr* is_async:int|
excepthandler|AST||lineno col_offset end_lineno end_col_offset
ExceptHandler|excepthandler|type:expr? name:str? body:stmt*|
arguments|AST|posonlyargs:arg* args:arg* vararg:arg? kwonlyargs:arg* kw_defaults:expr* kwarg:arg? defaults:expr*|
arg|AST|arg:str annotation:expr? type_comment:str?|lineno col_offset end_lineno end_col_offset
keyword|AST|arg:str? value:expr|lineno col_offset end_lineno end_col_offset
alias|AST|name:str asname:str?|lineno col_offset end_lineno end_col_offset
withitem|AST|context_expr:expr optional_vars:expr?|
match_case|AST|pattern:pattern guard:expr? body:stmt*|
pattern|AST||lineno col_offset end_lineno end_col_offset
MatchValue|pattern|value:expr|
MatchSingleton|pattern|value:object|
MatchSequence|pattern|patterns:pattern*|
MatchMapping|pattern|keys:expr* patterns:pattern* rest:str?|
MatchClass|pattern|cls:expr patterns:pattern* kwd_attrs:str* kwd_patterns:pattern*|
MatchStar|pattern|name:str?|
MatchAs|pattern|pattern:pattern? name:str?|
MatchOr|pattern|patterns:pattern*|
type_ignore|AST||
TypeIgnore|type_ignore|lineno:int tag:str|
type_param|AST||lineno col_offset end_lineno end_col_offset
TypeVar|type_param|name:str bound:expr? default_value:expr?|
ParamSpec|type_param|name:str default_value:expr?|
TypeVarTuple|type_param|name:str default_value:expr?|"""


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


_classes = _make([l.split('|') for l in _SPEC.split('\n')])
globals().update(_classes)
del _classes, _make
