"""pandas en miniatura para Dev Dojo: Series y DataFrame con la API más usada (datos pequeños, sin dependencias nativas).

Diferencias conocidas con pandas real: sin fechas ni categorías, sin MultiIndex en columnas, copia al escribir siempre.
"""
import math
import re
import io as _io
from functools import cmp_to_key

import numpy as np

nan = float('nan')
NaN = nan
NA = None

__version__ = '3.0.5'

_NA_STRINGS = {'', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN', '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null'}

_OPTIONS = {'display.max_rows': 60, 'display.max_columns': 0, 'display.width': 80, 'display.precision': 6, 'display.min_rows': 10}


def set_option(name, value):
    _OPTIONS[name] = value


def get_option(name):
    return _OPTIONS[name]


def option_context(*a):
    class _Ctx:
        def __enter__(self):
            return self

        def __exit__(self, *e):
            return False
    return _Ctx()


# ───────────────────────── utilidades ─────────────────────────

def _isna(v):
    return v is None or (isinstance(v, float) and v != v)


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_scalar(v):
    return not isinstance(v, (list, tuple, dict, set, range, Series, DataFrame, Index, np.ndarray))


def _np_scalar(v):
    """Convierte escalares de NumPy a escalares de Python."""
    if isinstance(v, np.ndarray) and v.ndim == 0:
        return v.item()
    return v


def _infer(values):
    """Nombre del dtype que pandas daría a una lista de valores de Python."""
    has_bool = has_int = has_float = has_str = has_other = False
    n_na = 0
    for v in values:
        if v is None:
            n_na += 1
        elif isinstance(v, bool):
            has_bool = True
        elif isinstance(v, int):
            has_int = True
        elif isinstance(v, float):
            if v != v:
                n_na += 1
            has_float = True
        elif isinstance(v, str):
            has_str = True
        else:
            has_other = True
    if has_other:
        return 'object'
    kinds = has_bool + (has_int or has_float) + has_str
    if kinds > 1:
        return 'object'
    if has_str:
        return 'str'
    if has_bool:
        return 'object' if n_na else 'bool'
    if has_int or has_float:
        if has_float or n_na:
            return 'float64'
        return 'int64'
    if n_na:
        return 'float64' if all(v is None or v != v for v in values) and not any(v is None for v in values) else 'object'
    return 'float64' if not values else 'object'


def _coerce(values, dtype):
    """Ajusta los valores al dtype: floats con NaN, strings con NaN como ausente."""
    if dtype == 'float64':
        return [nan if v is None else float(v) for v in values]
    if dtype == 'int64':
        return [int(v) for v in values]
    if dtype == 'str':
        return [nan if v is None else v for v in values]
    return list(values)


class _DType:
    def __init__(self, name):
        self.name = name

    def __str__(self):
        return self.name

    def __repr__(self):
        if self.name == 'str':
            return '<StringDtype(na_value=nan)>'
        if self.name == 'object':
            return "dtype('O')"
        return "dtype('%s')" % self.name

    def __eq__(self, other):
        if isinstance(other, _DType):
            return self.name == other.name
        if isinstance(other, str):
            return other == self.name or (other == 'O' and self.name == 'object') or (other in ('int', 'float') and self.name.startswith(other))
        if other is int:
            return self.name == 'int64'
        if other is float:
            return self.name == 'float64'
        if other is bool:
            return self.name == 'bool'
        if other is str:
            return self.name == 'str'
        if other is object:
            return self.name == 'object'
        return False

    def __hash__(self):
        return hash(self.name)

    @property
    def kind(self):
        return {'int64': 'i', 'float64': 'f', 'bool': 'b', 'str': 'O', 'object': 'O'}[self.name]


def _fmt_float_col(vals):
    """Formato de una columna de floats como lo hace pandas (6 decimales, quitando ceros comunes)."""
    inf = (math.inf, -math.inf)
    fin = [v for v in vals if v == v and v not in inf]
    small = any(v != 0 and abs(v) < 1e-6 for v in fin)
    large = any(abs(v) > 1e6 for v in fin)
    s = ['%.6f' % v if v == v and v not in inf else None for v in vals]
    present = [x for x in s if x is not None]
    while present and all(x.endswith('0') and not x.endswith('.0') for x in present):
        present = [x[:-1] for x in present]
        s = [x[:-1] if x is not None else None for x in s]
    longest = max([len(x) for x in present] or [0])
    if small or (longest > 12 and large):
        out = []
        for v in vals:
            if v != v:
                out.append('NaN')
            elif v == math.inf:
                out.append('inf')
            elif v == -math.inf:
                out.append('-inf')
            else:
                out.append('%.6e' % v)
        return out
    res = []
    for v, x in zip(vals, s):
        if x is not None:
            res.append(x)
        elif v != v:
            res.append('NaN')
        elif v > 0:
            res.append('inf')
        else:
            res.append('-inf')
    return res


def _fmt_col(vals, dtype):
    if dtype == 'float64':
        return _fmt_float_col(vals)
    out = []
    for v in vals:
        if v is None:
            out.append('None')
        elif isinstance(v, float) and v != v:
            out.append('NaN')
        elif isinstance(v, float) and dtype == 'object':
            out.append(_fmt_float_col([v])[0])
        else:
            out.append(str(v))
    return out


def labs_multi(index):
    return bool(index._l) and isinstance(index._l[0], tuple)


def _lead(cells, dtype):
    """Espacio de signo de pandas: las celdas no negativas (y todo el texto) llevan un espacio delante."""
    if dtype in ('str', 'object'):
        return [' ' + c for c in cells]
    return [c if c.startswith('-') else ' ' + c for c in cells]


def _cmp_key(a, b):
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def _sorted_labels(labels):
    try:
        return sorted(labels)
    except TypeError:
        return sorted(labels, key=lambda x: (str(type(x)), str(x)))


# ───────────────────────── Index ─────────────────────────

class Index:
    def __init__(self, data=None, name=None, _range=None):
        if isinstance(data, Index):
            name = name if name is not None else data.name
            data = data._l
        self._l = list(data) if data is not None else []
        self.name = name
        self._range = _range

    # --- datos
    def tolist(self):
        return list(self._l)

    def to_numpy(self):
        return np.array(self._l)

    @property
    def values(self):
        return np.array(self._l)

    def __len__(self):
        return len(self._l)

    def __iter__(self):
        return iter(self._l)

    def __contains__(self, v):
        return v in self._l

    def __getitem__(self, i):
        if isinstance(i, slice):
            return Index(self._l[i], self.name)
        if isinstance(i, (list, np.ndarray)):
            return Index([self._l[k] for k in i], self.name)
        return self._l[i]

    def __eq__(self, other):
        if isinstance(other, Index):
            other = other._l
        if isinstance(other, (list, tuple, np.ndarray)):
            return np.array([a == b for a, b in zip(self._l, other)])
        return np.array([a == other for a in self._l])

    __hash__ = None

    @property
    def shape(self):
        return (len(self._l),)

    @property
    def size(self):
        return len(self._l)

    @property
    def dtype(self):
        return _DType(_infer(self._l) if self._l else 'object')

    @property
    def is_unique(self):
        return len(set(self._l)) == len(self._l)

    def unique(self):
        seen = []
        s = set()
        for v in self._l:
            if v not in s:
                s.add(v)
                seen.append(v)
        return Index(seen, self.name)

    def nunique(self):
        return len(set(self._l))

    def get_loc(self, key):
        for i, v in enumerate(self._l):
            if v == key:
                return i
        raise KeyError(key)

    def isin(self, vals):
        s = set(vals)
        return np.array([v in s for v in self._l])

    def map(self, f):
        return Index([f(v) if callable(f) else f[v] for v in self._l], self.name)

    def astype(self, t):
        return Index(Series(self._l).astype(t).tolist(), self.name)

    def sort_values(self, ascending=True):
        return Index(sorted(self._l, reverse=not ascending), self.name)

    def copy(self):
        return Index(self._l, self.name, self._range)

    def rename(self, name):
        return Index(self._l, name, self._range)

    def equals(self, other):
        return isinstance(other, Index) and self._l == other._l

    def to_series(self):
        return Series(self._l, index=self._l, name=self.name)

    def __add__(self, other):
        return Index([a + other for a in self._l], self.name)

    def __repr__(self):
        if self._range is not None and self._l == list(range(self._range[0], self._range[1], self._range[2])):
            return 'RangeIndex(start=%d, stop=%d, step=%d)' % self._range
        d = self.dtype.name
        body = ', '.join(repr(v) for v in self._l)
        name = ", name='%s'" % self.name if self.name is not None else ''
        return "Index([%s], dtype='%s'%s)" % (body, 'str' if d == 'str' else d, name)

    def __str__(self):
        return repr(self)


def RangeIndex(start=0, stop=None, step=1, name=None):
    if stop is None:
        start, stop = 0, start
    return Index(list(range(start, stop, step)), name, (start, stop, step))


def _range_index(n):
    return Index(list(range(n)), None, (0, n, 1))


def _as_index(idx, n, name=None):
    if idx is None:
        return _range_index(n)
    if isinstance(idx, Index):
        return idx
    return Index(list(idx), name)


# ───────────────────────── operaciones elementales ─────────────────────────

def _arith(f):
    def g(a, b):
        if _isna(a) or _isna(b):
            return nan
        return f(a, b)
    return g


def _div(a, b):
    if b == 0:
        if a == 0:
            return nan
        return math.inf if a > 0 else -math.inf
    return a / b


def _floordiv(a, b):
    if b == 0:
        return _div(a, b)
    return a // b


def _mod(a, b):
    if b == 0:
        return nan
    return a % b


_OPS = {
    'add': _arith(lambda a, b: a + b),
    'sub': _arith(lambda a, b: a - b),
    'mul': _arith(lambda a, b: a * b),
    'truediv': _arith(_div),
    'floordiv': _arith(_floordiv),
    'mod': _arith(_mod),
    'pow': _arith(lambda a, b: a ** b),
}


def _cmp(f, na_value=False):
    def g(a, b):
        if _isna(a) or _isna(b):
            return na_value
        return f(a, b)
    return g


_CMP = {
    'eq': _cmp(lambda a, b: a == b),
    'ne': _cmp(lambda a, b: a != b, True),
    'lt': _cmp(lambda a, b: a < b),
    'le': _cmp(lambda a, b: a <= b),
    'gt': _cmp(lambda a, b: a > b),
    'ge': _cmp(lambda a, b: a >= b),
}


def _nums(vals):
    return [v for v in vals if not _isna(v)]


def _quantile(sorted_vals, q):
    n = len(sorted_vals)
    if n == 0:
        return nan
    pos = (n - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    return float(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo))


def _mean(v):
    return sum(v) / len(v) if v else nan


def _var(v, ddof=1):
    n = len(v)
    if n - ddof <= 0:
        return nan
    m = sum(v) / n
    return sum((x - m) ** 2 for x in v) / (n - ddof)


def _std(v, ddof=1):
    r = _var(v, ddof)
    return math.sqrt(r) if r == r else nan


def _median(v):
    return _quantile(sorted(v), 0.5)


def _skew(v):
    n = len(v)
    if n < 3:
        return nan
    m = sum(v) / n
    m2 = sum((x - m) ** 2 for x in v) / n
    m3 = sum((x - m) ** 3 for x in v) / n
    if m2 == 0:
        return 0.0
    return (m3 / m2 ** 1.5) * math.sqrt(n * (n - 1)) / (n - 2)


def _kurt(v):
    n = len(v)
    if n < 4:
        return nan
    m = sum(v) / n
    s2 = sum((x - m) ** 2 for x in v)
    s4 = sum((x - m) ** 4 for x in v)
    if s2 == 0:
        return 0.0
    return (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * n * s4 / s2 ** 2 - 3 * (n - 1))


def _corr(a, b):
    pairs = [(x, y) for x, y in zip(a, b) if not _isna(x) and not _isna(y)]
    if len(pairs) < 2:
        return nan
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return nan
    return sxy / math.sqrt(sxx * syy)


def _rank_avg(vals):
    idx = sorted(range(len(vals)), key=lambda i: vals[i])
    ranks = [0.0] * len(vals)
    i = 0
    while i < len(idx):
        j = i
        while j + 1 < len(idx) and vals[idx[j + 1]] == vals[idx[i]]:
            j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[idx[k]] = r
        i = j + 1
    return ranks


def _unique(vals):
    seen = set()
    out = []
    for v in vals:
        k = ('nan',) if (isinstance(v, float) and v != v) else v
        if k not in seen:
            seen.add(k)
            out.append(v)
    return out


def _mask_list(key, n):
    """Convierte Series/lista/array booleano a lista de bool de longitud n (o None si no es máscara)."""
    if isinstance(key, Series):
        key = key._d
    elif isinstance(key, np.ndarray):
        key = key.tolist()
    if isinstance(key, (list, tuple)) and len(key) > 0 and all(isinstance(k, bool) for k in key):
        if len(key) != n:
            raise ValueError('Item wrong length %d instead of %d.' % (len(key), n))
        return list(key)
    return None


# ───────────────────────── Series ─────────────────────────

class Series:
    def __init__(self, data=None, index=None, name=None, dtype=None, copy=None):
        if isinstance(data, Series):
            vals = list(data._d)
            if index is None:
                index = data.index
            if name is None:
                name = data.name
        elif isinstance(data, dict):
            vals = list(data.values())
            if index is None:
                index = Index(list(data.keys()))
            else:
                vals = [data.get(k, nan) for k in index]
        elif data is None:
            vals = []
        elif isinstance(data, np.ndarray):
            vals = data.tolist() if data.ndim == 1 else [list(r) for r in data.tolist()]
        elif _is_scalar(data):
            n = len(index) if index is not None else 1
            vals = [data] * n
        else:
            vals = [_np_scalar(v) for v in data]
        vals = [_np_scalar(v) for v in vals]
        self.index = _as_index(index, len(vals))
        if len(self.index) != len(vals):
            raise ValueError('Length of values (%d) does not match length of index (%d)' % (len(vals), len(self.index)))
        self.name = name
        dt = _infer(vals)
        if dtype is not None:
            self._d = vals
            self._dt = dt
            cast = self.astype(dtype)
            self._d, self._dt = cast._d, cast._dt
        else:
            self._d = _coerce(vals, dt)
            self._dt = dt

    # --- construcción interna
    def _new(self, vals, index=None, name='__same__', dtype=None):
        s = Series.__new__(Series)
        s._d = list(vals)
        s._dt = dtype if dtype is not None else _infer(s._d)
        if dtype is None:
            s._d = _coerce(s._d, s._dt)
        s.index = index if index is not None else self.index
        s.name = self.name if name == '__same__' else name
        return s

    # --- propiedades
    @property
    def dtype(self):
        return _DType(self._dt)

    @property
    def values(self):
        return self.to_numpy()

    @property
    def shape(self):
        return (len(self._d),)

    @property
    def size(self):
        return len(self._d)

    @property
    def ndim(self):
        return 1

    @property
    def empty(self):
        return len(self._d) == 0

    @property
    def T(self):
        return self

    @property
    def hasnans(self):
        return any(_isna(v) for v in self._d)

    @property
    def is_unique(self):
        return len(_unique(self._d)) == len(self._d)

    @property
    def is_monotonic_increasing(self):
        v = self._d
        return all(v[i] <= v[i + 1] for i in range(len(v) - 1))

    @property
    def is_monotonic_decreasing(self):
        v = self._d
        return all(v[i] >= v[i + 1] for i in range(len(v) - 1))

    @property
    def str(self):
        return _StrAccessor(self)

    @property
    def loc(self):
        return _SLoc(self)

    @property
    def iloc(self):
        return _SILoc(self)

    @property
    def at(self):
        return _SLoc(self)

    @property
    def iat(self):
        return _SILoc(self)

    def __len__(self):
        return len(self._d)

    def __iter__(self):
        return iter(self._d)

    def __contains__(self, key):
        return key in self.index._l

    def __bool__(self):
        raise ValueError('The truth value of a Series is ambiguous. Use a.empty, a.bool(), a.item(), a.any() or a.all().')

    def __hash__(self):
        raise TypeError("unhashable type: 'Series'")

    def tolist(self):
        return list(self._d)

    to_list = tolist

    def to_numpy(self, dtype=None, copy=False):
        if self._dt in ('str', 'object'):
            return np.array(self._d, dtype=dtype) if dtype else np.array(self._d)
        a = np.array(self._d)
        return a.astype(dtype) if dtype else a

    def __array__(self, dtype=None):
        return self.to_numpy(dtype)

    def to_frame(self, name=None):
        n = name if name is not None else (self.name if self.name is not None else 0)
        return DataFrame({n: self._d}, index=self.index)

    def to_dict(self):
        return dict(zip(self.index._l, self._d))

    def copy(self, deep=True):
        return self._new(self._d, self.index.copy(), self.name, self._dt)

    def item(self):
        if len(self._d) != 1:
            raise ValueError('can only convert an array of size 1 to a Python scalar')
        return self._d[0]

    def keys(self):
        return self.index

    def items(self):
        return zip(self.index._l, self._d)

    iteritems = items

    # --- representación
    def __repr__(self):
        return self.to_string(_truncate=True)

    def __str__(self):
        return repr(self)

    def to_string(self, _truncate=False, index=True, **kw):
        n = len(self._d)
        if n == 0:
            return 'Series([], %sdtype: %s)' % ('Name: %s, ' % self.name if self.name is not None else '', self._dt)
        rows = list(range(n))
        trunc = _truncate and n > _OPTIONS['display.max_rows']
        if trunc:
            h = _OPTIONS['display.min_rows'] // 2
            rows = list(range(h)) + [None] + list(range(n - h, n))
        labels = _fmt_index_labels(self.index)
        vals = _lead(_fmt_col(self._d, self._dt), self._dt)
        lw = max(len(x) for x in labels)
        vw = max(len(x) for x in vals)
        lines = []
        if labs_multi(self.index):
            lines.append(_fmt_multi(self.index._l, self.index.name if isinstance(self.index.name, (list, tuple)) else [None] * len(self.index._l[0]), '  ')[1].rstrip())
        elif self.index.name is not None:
            lines.append(str(self.index.name))
        dots_i = '..' if lw <= 2 else '...'
        dots_v = '..' if vw <= 3 else '...'
        for r in rows:
            if r is None:
                lines.append(''.ljust(lw) + '   ' + dots_v.rjust(vw) if index else dots_v.rjust(vw))
            elif index:
                lines.append(labels[r].ljust(lw) + '   ' + vals[r].rjust(vw))
            else:
                lines.append(vals[r].rjust(vw))
        foot = []
        if self.name is not None:
            foot.append('Name: %s' % self.name)
        if trunc:
            foot.append('Length: %d' % n)
        foot.append('dtype: %s' % self._dt)
        lines.append(', '.join(foot))
        return '\n'.join(lines)

    # --- aritmética y comparación
    def _align(self, other):
        """(índice, valores_a, valores_b) alineando por etiquetas si los índices difieren."""
        if self.index._l == other.index._l:
            return self.index, self._d, other._d
        da = dict(zip(self.index._l, self._d))
        db = dict(zip(other.index._l, other._d))
        labels = _sorted_labels(_unique(self.index._l + other.index._l))
        return Index(labels), [da.get(k, nan) for k in labels], [db.get(k, nan) for k in labels]

    def _binary(self, other, op, table, rev=False):
        f = table[op]
        if isinstance(other, Series):
            idx, a, b = self._align(other)
            name = self.name if self.name == other.name else None
        else:
            if isinstance(other, (list, tuple, np.ndarray)):
                b = [_np_scalar(v) for v in (other.tolist() if isinstance(other, np.ndarray) else other)]
                if len(b) != len(self._d):
                    raise ValueError('Lengths must match to compare')
            else:
                b = [_np_scalar(other)] * len(self._d)
            idx, a, name = self.index, self._d, self.name
        if rev:
            a, b = b, a
        return self._new([f(x, y) for x, y in zip(a, b)], idx, name)

    def __add__(self, o): return self._binary(o, 'add', _OPS)
    def __radd__(self, o): return self._binary(o, 'add', _OPS, True)
    def __sub__(self, o): return self._binary(o, 'sub', _OPS)
    def __rsub__(self, o): return self._binary(o, 'sub', _OPS, True)
    def __mul__(self, o): return self._binary(o, 'mul', _OPS)
    def __rmul__(self, o): return self._binary(o, 'mul', _OPS, True)
    def __truediv__(self, o): return self._binary(o, 'truediv', _OPS)
    def __rtruediv__(self, o): return self._binary(o, 'truediv', _OPS, True)
    def __floordiv__(self, o): return self._binary(o, 'floordiv', _OPS)
    def __rfloordiv__(self, o): return self._binary(o, 'floordiv', _OPS, True)
    def __mod__(self, o): return self._binary(o, 'mod', _OPS)
    def __rmod__(self, o): return self._binary(o, 'mod', _OPS, True)
    def __pow__(self, o): return self._binary(o, 'pow', _OPS)
    def __rpow__(self, o): return self._binary(o, 'pow', _OPS, True)
    def __eq__(self, o): return self._binary(o, 'eq', _CMP)
    def __ne__(self, o): return self._binary(o, 'ne', _CMP)
    def __lt__(self, o): return self._binary(o, 'lt', _CMP)
    def __le__(self, o): return self._binary(o, 'le', _CMP)
    def __gt__(self, o): return self._binary(o, 'gt', _CMP)
    def __ge__(self, o): return self._binary(o, 'ge', _CMP)

    add = __add__
    sub = __sub__
    mul = __mul__
    div = __truediv__
    truediv = __truediv__
    eq = __eq__
    ne = __ne__
    lt = __lt__
    le = __le__
    gt = __gt__
    ge = __ge__

    def __neg__(self):
        return self._new([-v if not _isna(v) else v for v in self._d])

    def __abs__(self):
        return self.abs()

    def __and__(self, o):
        b = o._d if isinstance(o, Series) else (o if isinstance(o, (list, np.ndarray)) else [o] * len(self._d))
        b = b.tolist() if isinstance(b, np.ndarray) else b
        return self._new([bool(x) and bool(y) for x, y in zip(self._d, b)], self.index, self.name if not isinstance(o, Series) or self.name == o.name else None)

    def __or__(self, o):
        b = o._d if isinstance(o, Series) else (o if isinstance(o, (list, np.ndarray)) else [o] * len(self._d))
        b = b.tolist() if isinstance(b, np.ndarray) else b
        return self._new([bool(x) or bool(y) for x, y in zip(self._d, b)], self.index, self.name if not isinstance(o, Series) or self.name == o.name else None)

    def __xor__(self, o):
        b = o._d if isinstance(o, Series) else [o] * len(self._d)
        return self._new([bool(x) != bool(y) for x, y in zip(self._d, b)])

    __rand__ = __and__
    __ror__ = __or__

    def __invert__(self):
        if self._dt == 'bool':
            return self._new([not v for v in self._d])
        if self._dt == 'int64':
            return self._new([~v for v in self._d])
        raise TypeError('bad operand type for unary ~')

    # --- selección
    def _pos_of(self, key):
        try:
            return self.index._l.index(key)
        except ValueError:
            raise KeyError(key)

    def __getitem__(self, key):
        n = len(self._d)
        m = _mask_list(key, n)
        if m is not None:
            keep = [i for i in range(n) if m[i]]
            return self._new([self._d[i] for i in keep], Index([self.index._l[i] for i in keep], self.index.name), self.name)
        if isinstance(key, slice):
            if _is_int_slice(key) or not _is_label_index(self.index):
                return self._new(self._d[key], Index(self.index._l[key], self.index.name), self.name)
            return self.loc[key]
        if isinstance(key, (list, np.ndarray, Index, Series)):
            keys = key.tolist() if hasattr(key, 'tolist') else list(key)
            pos = [self._pos_of(k) for k in keys]
            return self._new([self._d[i] for i in pos], Index(keys, self.index.name), self.name)
        pos = [i for i, k in enumerate(self.index._l) if k == key]
        if not pos:
            raise KeyError(key)
        if len(pos) > 1:
            return self.take(pos)
        return self._d[pos[0]]

    def __setitem__(self, key, value):
        n = len(self._d)
        m = _mask_list(key, n)
        if m is not None:
            vals = _broadcast_vals(value, sum(m))
            it = iter(vals)
            for i in range(n):
                if m[i]:
                    self._d[i] = next(it)
        elif isinstance(key, slice):
            pos = list(range(n))[key]
            vals = _broadcast_vals(value, len(pos))
            for p, v in zip(pos, vals):
                self._d[p] = v
        elif isinstance(key, (list, np.ndarray)):
            keys = list(key)
            vals = _broadcast_vals(value, len(keys))
            for k, v in zip(keys, vals):
                self._d[self._pos_of(k)] = v
        else:
            if key in self.index._l:
                self._d[self._pos_of(key)] = value
            else:
                self.index = Index(self.index._l + [key], self.index.name)
                self._d.append(value)
        self._refit()

    def _refit(self):
        self._dt = _infer(self._d)
        self._d = _coerce(self._d, self._dt)

    def head(self, n=5):
        return self._new(self._d[:n] if n >= 0 else self._d[:n], Index(self.index._l[:n], self.index.name), self.name)

    def tail(self, n=5):
        if n == 0:
            return self.head(0)
        return self._new(self._d[-n:], Index(self.index._l[-n:], self.index.name), self.name)

    def take(self, positions):
        return self._new([self._d[i] for i in positions], Index([self.index._l[i] for i in positions], self.index.name), self.name)

    def sample(self, n=None, frac=None, replace=False, random_state=None):
        k = n if n is not None else int(round(len(self._d) * frac))
        rs = random_state if isinstance(random_state, np.random.RandomState) else np.random.RandomState(random_state)
        pos = rs.choice(len(self._d), size=k, replace=replace).tolist()
        return self.take(pos)

    # --- agregaciones
    def _vals(self, skipna=True):
        return _nums(self._d) if skipna else list(self._d)

    def count(self):
        return len(_nums(self._d))

    def sum(self, skipna=True, min_count=0, numeric_only=False):
        v = self._vals(skipna)
        if len(v) < min_count:
            return nan
        if self._dt == 'str':
            return ''.join(v)
        if not skipna and any(_isna(x) for x in self._d):
            return nan
        return sum(v)

    def prod(self, skipna=True):
        r = 1
        for x in self._vals(skipna):
            r *= x
        return r

    def mean(self, skipna=True, numeric_only=False):
        if self._dt in ('str', 'object'):
            raise TypeError("Cannot perform reduction 'mean' with string dtype")
        if not skipna and self.hasnans:
            return nan
        return _mean(self._vals())

    def median(self, skipna=True, numeric_only=False):
        if not skipna and self.hasnans:
            return nan
        return _median(self._vals())

    def std(self, ddof=1, skipna=True, numeric_only=False):
        return _std(self._vals(), ddof)

    def var(self, ddof=1, skipna=True, numeric_only=False):
        return _var(self._vals(), ddof)

    def sem(self, ddof=1):
        v = self._vals()
        return _std(v, ddof) / math.sqrt(len(v)) if v else nan

    def skew(self):
        return _skew(self._vals())

    def kurt(self):
        return _kurt(self._vals())

    kurtosis = kurt

    def min(self, skipna=True, numeric_only=False):
        v = self._vals()
        return min(v) if v else nan

    def max(self, skipna=True, numeric_only=False):
        v = self._vals()
        return max(v) if v else nan

    def ptp(self):
        return self.max() - self.min()

    def idxmax(self):
        best = None
        for i, v in enumerate(self._d):
            if not _isna(v) and (best is None or v > self._d[best]):
                best = i
        if best is None:
            raise ValueError('attempt to get argmax of an empty sequence')
        return self.index._l[best]

    def idxmin(self):
        best = None
        for i, v in enumerate(self._d):
            if not _isna(v) and (best is None or v < self._d[best]):
                best = i
        if best is None:
            raise ValueError('attempt to get argmin of an empty sequence')
        return self.index._l[best]

    def argmax(self):
        return self._d.index(max(self._vals()))

    def argmin(self):
        return self._d.index(min(self._vals()))

    def quantile(self, q=0.5, interpolation='linear'):
        v = sorted(self._vals())
        if isinstance(q, (list, tuple, np.ndarray)):
            qs = [float(x) for x in q]
            return Series([_quantile(v, x) for x in qs], index=Index(qs), name=self.name)
        return _quantile(v, q)

    def any(self, skipna=True):
        return any(bool(v) for v in self._d if not _isna(v))

    def all(self, skipna=True):
        return all(bool(v) for v in self._d if not _isna(v))

    def nunique(self, dropna=True):
        u = _unique(self._d)
        return len([v for v in u if not _isna(v)]) if dropna else len(u)

    def unique(self):
        u = _unique(self._d)
        if self._dt == 'str':
            return _StringArray(u)
        return np.array(u) if self._dt != 'object' else np.array(u, dtype=object)

    def mode(self, dropna=True):
        counts = {}
        for v in self._d:
            if dropna and _isna(v):
                continue
            counts[v] = counts.get(v, 0) + 1
        if not counts:
            return Series([], dtype=self._dt)
        top = max(counts.values())
        return Series(_sorted_labels([k for k, c in counts.items() if c == top]), name=self.name)

    def corr(self, other, method='pearson'):
        if method == 'spearman':
            return _corr(_rank_avg(self._d), _rank_avg(other._d))
        return _corr(self._d, other._d)

    def cov(self, other):
        pairs = [(x, y) for x, y in zip(self._d, other._d) if not _isna(x) and not _isna(y)]
        n = len(pairs)
        if n < 2:
            return nan
        mx = sum(p[0] for p in pairs) / n
        my = sum(p[1] for p in pairs) / n
        return sum((x - mx) * (y - my) for x, y in pairs) / (n - 1)

    def describe(self, percentiles=None):
        if self._dt in ('str', 'object'):
            v = [x for x in self._d if not _isna(x)]
            counts = {}
            for x in v:
                counts[x] = counts.get(x, 0) + 1
            top = max(counts.items(), key=lambda kv: kv[1]) if counts else (nan, nan)
            return Series([len(v), len(counts), top[0], top[1]], index=['count', 'unique', 'top', 'freq'], name=self.name)
        v = sorted(self._vals())
        ps = percentiles if percentiles is not None else [0.25, 0.5, 0.75]
        labels = ['count', 'mean', 'std', 'min'] + [_pct_label(p) for p in ps] + ['max']
        vals = [float(len(v)), _mean(v), _std(v), float(v[0]) if v else nan] + [_quantile(v, p) for p in ps] + [float(v[-1]) if v else nan]
        return Series(vals, index=labels, name=self.name)

    def value_counts(self, normalize=False, sort=True, ascending=False, dropna=True):
        counts = {}
        order = []
        for v in self._d:
            if dropna and _isna(v):
                continue
            k = ('nan',) if _isna(v) else v
            if k not in counts:
                counts[k] = 0
                order.append(v)
            counts[k] += 1
        pairs = [(v, counts[('nan',) if _isna(v) else v]) for v in order]
        if sort:
            pairs = sorted(pairs, key=lambda p: p[1], reverse=not ascending) if not ascending else sorted(pairs, key=lambda p: p[1])
            if not ascending:
                # orden estable: a igualdad, el primero que apareció
                pairs = sorted(pairs, key=cmp_to_key(lambda a, b: b[1] - a[1]))
        total = sum(c for _, c in pairs)
        vals = [c / total for _, c in pairs] if normalize else [c for _, c in pairs]
        return Series(vals, index=Index([p[0] for p in pairs], self.name), name='proportion' if normalize else 'count')

    # --- limpieza
    def isna(self):
        return self._new([_isna(v) for v in self._d], self.index, self.name)

    isnull = isna

    def notna(self):
        return self._new([not _isna(v) for v in self._d], self.index, self.name)

    notnull = notna

    def fillna(self, value=None, method=None, inplace=False, limit=None):
        if method in ('ffill', 'pad'):
            return self.ffill()
        if method in ('bfill', 'backfill'):
            return self.bfill()
        if isinstance(value, Series):
            vals = [value.to_dict().get(k, v) if _isna(v) else v for k, v in zip(self.index._l, self._d)]
        elif isinstance(value, dict):
            vals = [value.get(k, v) if _isna(v) else v for k, v in zip(self.index._l, self._d)]
        else:
            vals = [value if _isna(v) else v for v in self._d]
        r = self._new(vals)
        if inplace:
            self._d, self._dt = r._d, r._dt
            return None
        return r

    def ffill(self):
        out = []
        last = nan
        for v in self._d:
            if not _isna(v):
                last = v
            out.append(last if _isna(v) else v)
        return self._new(out)

    def bfill(self):
        out = list(self._d)
        nxt = nan
        for i in range(len(out) - 1, -1, -1):
            if not _isna(out[i]):
                nxt = out[i]
            else:
                out[i] = nxt
        return self._new(out)

    def interpolate(self, method='linear'):
        v = list(self._d)
        n = len(v)
        known = [i for i in range(n) if not _isna(v[i])]
        for i in range(n):
            if _isna(v[i]):
                lo = [k for k in known if k < i]
                hi = [k for k in known if k > i]
                if lo and hi:
                    a, b = lo[-1], hi[0]
                    v[i] = v[a] + (v[b] - v[a]) * (i - a) / (b - a)
                elif lo:
                    v[i] = v[lo[-1]]
        return self._new(v)

    def dropna(self, inplace=False):
        keep = [i for i, v in enumerate(self._d) if not _isna(v)]
        r = self._new([self._d[i] for i in keep], Index([self.index._l[i] for i in keep], self.index.name))
        if inplace:
            self._d, self._dt, self.index = r._d, r._dt, r.index
            return None
        return r

    def duplicated(self, keep='first'):
        seen = set()
        out = []
        vals = self._d if keep != 'last' else self._d[::-1]
        for v in vals:
            k = ('nan',) if _isna(v) else v
            out.append(k in seen)
            seen.add(k)
        if keep == 'last':
            out = out[::-1]
        if keep is False:
            cnt = {}
            for v in self._d:
                cnt[v] = cnt.get(v, 0) + 1
            out = [cnt[v] > 1 for v in self._d]
        return self._new(out)

    def drop_duplicates(self, keep='first'):
        d = self.duplicated(keep)
        return self[~d]

    def astype(self, t):
        name = t if isinstance(t, str) else getattr(t, '__name__', str(t))
        if name in ('int', 'int64', 'int32', 'Int64'):
            if any(_isna(v) for v in self._d):
                raise ValueError('Cannot convert non-finite values (NA or inf) to integer')
            return self._new([int(float(v)) if isinstance(v, str) else int(v) for v in self._d], dtype='int64')
        if name in ('float', 'float64', 'float32'):
            return self._new([nan if _isna(v) else float(v) for v in self._d], dtype='float64')
        if name in ('str', 'string', 'category', 'object') and name != 'object':
            return self._new([nan if _isna(v) else (str(v) if not isinstance(v, bool) else str(v)) for v in self._d], dtype='str')
        if name == 'object' or name == 'O':
            return self._new(self._d, dtype='object')
        if name in ('bool', 'boolean'):
            return self._new([bool(v) for v in self._d], dtype='bool')
        raise TypeError("data type '%s' not understood" % name)

    def map(self, arg, na_action=None):
        if isinstance(arg, dict):
            return self._new([arg.get(v, nan) for v in self._d])
        if isinstance(arg, Series):
            m = arg.to_dict()
            return self._new([m.get(v, nan) for v in self._d])
        return self._new([v if (na_action == 'ignore' and _isna(v)) else arg(v) for v in self._d])

    def apply(self, func, args=(), **kwargs):
        return self._new([func(v, *args, **kwargs) for v in self._d])

    def transform(self, func):
        return self.apply(func)

    def agg(self, func, *a, **kw):
        if isinstance(func, (list, tuple)):
            return Series([self.agg(f) for f in func], index=Index([f if isinstance(f, str) else f.__name__ for f in func]), name=self.name)
        if isinstance(func, str):
            return getattr(self, func)(*a, **kw)
        return func(self, *a, **kw)

    aggregate = agg

    def pipe(self, func, *a, **kw):
        return func(self, *a, **kw)

    def replace(self, to_replace=None, value=None, regex=False):
        if isinstance(to_replace, dict):
            m = to_replace
        elif isinstance(to_replace, (list, tuple)):
            vals = value if isinstance(value, (list, tuple)) else [value] * len(to_replace)
            m = dict(zip(to_replace, vals))
        else:
            m = {to_replace: value}
        if regex:
            out = []
            for v in self._d:
                if isinstance(v, str):
                    for pat, rep in m.items():
                        v = re.sub(pat, rep, v)
                out.append(v)
            return self._new(out)
        return self._new([m.get(v, v) if not _isna(v) or any(_isna(k) for k in m) else v for v in self._d])

    def clip(self, lower=None, upper=None):
        out = []
        for v in self._d:
            if not _isna(v):
                if lower is not None and v < lower:
                    v = lower
                if upper is not None and v > upper:
                    v = upper
            out.append(v)
        return self._new(out)

    def abs(self):
        return self._new([abs(v) if not _isna(v) else v for v in self._d])

    def round(self, decimals=0):
        return self._new([round(v, decimals) if not _isna(v) else v for v in self._d])

    def isin(self, values):
        s = set(values.tolist() if hasattr(values, 'tolist') else values)
        return self._new([v in s for v in self._d])

    def between(self, left, right, inclusive='both'):
        def ok(v):
            if _isna(v):
                return False
            lo = v >= left if inclusive in ('both', 'left') else v > left
            hi = v <= right if inclusive in ('both', 'right') else v < right
            return lo and hi
        return self._new([ok(v) for v in self._d])

    def where(self, cond, other=nan):
        c = cond._d if isinstance(cond, Series) else list(cond)
        return self._new([v if k else other for v, k in zip(self._d, c)])

    def mask(self, cond, other=nan):
        c = cond._d if isinstance(cond, Series) else list(cond)
        return self._new([other if k else v for v, k in zip(self._d, c)])

    # --- acumulados y desplazamientos
    def cumsum(self):
        out, t = [], 0
        for v in self._d:
            if _isna(v):
                out.append(nan)
            else:
                t += v
                out.append(t)
        return self._new(out)

    def cumprod(self):
        out, t = [], 1
        for v in self._d:
            if _isna(v):
                out.append(nan)
            else:
                t *= v
                out.append(t)
        return self._new(out)

    def cummax(self):
        out, t = [], None
        for v in self._d:
            if not _isna(v):
                t = v if t is None or v > t else t
            out.append(t if t is not None else nan)
        return self._new(out)

    def cummin(self):
        out, t = [], None
        for v in self._d:
            if not _isna(v):
                t = v if t is None or v < t else t
            out.append(t if t is not None else nan)
        return self._new(out)

    def shift(self, periods=1, fill_value=nan):
        n = len(self._d)
        if periods >= 0:
            out = [fill_value] * min(periods, n) + self._d[:max(0, n - periods)]
        else:
            out = self._d[-periods:] + [fill_value] * min(-periods, n)
        return self._new(out)

    def diff(self, periods=1):
        sh = self.shift(periods)
        return self - sh

    def pct_change(self, periods=1):
        sh = self.shift(periods)
        return self / sh - 1

    def rank(self, method='average', ascending=True, pct=False):
        vals = self._d if ascending else [-v if not _isna(v) else v for v in self._d]
        ok = [i for i, v in enumerate(vals) if not _isna(v)]
        sub = [vals[i] for i in ok]
        if method == 'average':
            r = _rank_avg(sub)
        elif method == 'min':
            r = [1 + sum(1 for y in sub if y < x) for x in sub]
        elif method == 'max':
            r = [sum(1 for y in sub if y <= x) for x in sub]
        elif method == 'dense':
            u = sorted(set(sub))
            r = [u.index(x) + 1 for x in sub]
        else:
            order = sorted(range(len(sub)), key=lambda i: sub[i])
            r = [0] * len(sub)
            for k, i in enumerate(order):
                r[i] = k + 1
        out = [nan] * len(self._d)
        for i, rv in zip(ok, r):
            out[i] = float(rv) / (len(sub) if pct else 1)
        return self._new(out)

    def rolling(self, window, min_periods=None):
        return _Rolling(self, window, min_periods)

    def expanding(self, min_periods=1):
        return _Rolling(self, len(self._d), min_periods, expanding=True)

    # --- orden
    def sort_values(self, ascending=True, na_position='last', inplace=False, key=None, kind=None):
        keys = key(self)._d if key is not None else self._d
        ok = [i for i, v in enumerate(keys) if not _isna(v)]
        bad = [i for i, v in enumerate(keys) if _isna(v)]
        order = sorted(ok, key=lambda i: keys[i], reverse=not ascending)
        if not ascending:
            order = sorted(ok, key=cmp_to_key(lambda a, b: -1 if keys[a] > keys[b] else (1 if keys[a] < keys[b] else (a - b))))
        order = order + bad if na_position == 'last' else bad + order
        r = self.take(order)
        if inplace:
            self._d, self._dt, self.index = r._d, r._dt, r.index
            return None
        return r

    def sort_index(self, ascending=True, inplace=False):
        labs = self.index._l
        order = sorted(range(len(labs)), key=lambda i: labs[i], reverse=not ascending)
        if not ascending:
            order = sorted(range(len(labs)), key=cmp_to_key(lambda a, b: -1 if labs[a] > labs[b] else (1 if labs[a] < labs[b] else (a - b))))
        r = self.take(order)
        if inplace:
            self._d, self.index = r._d, r.index
            return None
        return r

    def nlargest(self, n=5, keep='first'):
        return self.sort_values(ascending=False).head(n)

    def nsmallest(self, n=5, keep='first'):
        return self.sort_values(ascending=True).head(n)

    def reset_index(self, drop=False, name=None, inplace=False):
        if drop:
            r = self._new(self._d, _range_index(len(self._d)))
            if inplace:
                self.index = r.index
                return None
            return r
        iname = self.index.name if self.index.name is not None else 'index'
        vname = name if name is not None else (self.name if self.name is not None else 0)
        return DataFrame({iname: self.index._l, vname: self._d})

    def rename(self, index=None, **kw):
        if index is None or isinstance(index, str) or (not isinstance(index, (dict,)) and not callable(index)):
            return self._new(self._d, self.index, index)
        if callable(index):
            return self._new(self._d, Index([index(k) for k in self.index._l], self.index.name))
        return self._new(self._d, Index([index.get(k, k) for k in self.index._l], self.index.name))

    def rename_axis(self, name):
        return self._new(self._d, Index(self.index._l, name))

    def set_axis(self, labels, axis=0):
        return self._new(self._d, Index(labels))

    def drop(self, labels=None, index=None, errors='raise'):
        labs = labels if labels is not None else index
        labs = labs if isinstance(labs, (list, tuple, set)) else [labs]
        keep = [i for i, k in enumerate(self.index._l) if k not in labs]
        return self.take(keep)

    def reindex(self, labels):
        d = dict(zip(self.index._l, self._d))
        labs = list(labels)
        return self._new([d.get(k, nan) for k in labs], Index(labs, self.index.name))

    def equals(self, other):
        return isinstance(other, Series) and self._d == other._d and self.index._l == other.index._l

    def memory_usage(self, index=True, deep=False):
        return 8 * len(self._d) + (8 * len(self._d) if index else 0)

    def to_csv(self, path=None, index=True, header=True, sep=','):
        return self.to_frame().to_csv(path, index=index, header=header, sep=sep)

    def to_markdown(self):
        return self.to_frame().to_markdown()

    def cut(self, *a, **k):
        return cut(self, *a, **k)

    @property
    def plot(self):
        return _PlotAccessor(self)

    def hist(self, bins=10, **kw):
        return _PlotAccessor(self).hist(bins=bins, **kw)

    def boxplot(self, **kw):
        return _PlotAccessor(self).box(**kw)


def _is_int_slice(s):
    return all(x is None or isinstance(x, int) for x in (s.start, s.stop, s.step))


def _is_label_index(idx):
    return len(idx._l) > 0 and not all(isinstance(v, int) and not isinstance(v, bool) for v in idx._l)


def _broadcast_vals(value, n):
    if isinstance(value, Series):
        value = value._d
    if isinstance(value, np.ndarray):
        value = value.tolist()
    if isinstance(value, (list, tuple)):
        if len(value) != n:
            raise ValueError('Length of values (%d) does not match length of index (%d)' % (len(value), n))
        return list(value)
    return [value] * n


def _pct_label(p):
    s = ('%g' % (p * 100))
    return s + '%'


def _fmt_index_labels(index, sep='  '):
    labs = index._l
    if labs and isinstance(labs[0], tuple):
        names = index.name if isinstance(index.name, (list, tuple)) else [None] * len(labs[0])
        return _fmt_multi(labs, names, sep)[0]
    return [str(v) if not (isinstance(v, float) and v != v) else 'NaN' for v in labs]


def _fmt_multi(labs, names, sep):
    """Etiquetas de un MultiIndex «esparcidas» (el nivel solo se repite cuando cambia) y la fila con los nombres de nivel."""
    nl = len(labs[0])
    cols = []
    prev = [None] * nl
    for lab in labs:
        row = []
        same = True
        for k in range(nl):
            if same and prev[k] == lab[k]:
                row.append('')
            else:
                same = False
                row.append(str(lab[k]))
        prev = list(lab)
        cols.append(row)
    widths = [max([len(str(lab[k])) for lab in labs] + [len(str(names[k])) if names[k] is not None else 0]) for k in range(nl)]
    cells = [sep.join(r[k].ljust(widths[k]) for k in range(nl)) for r in cols]
    head = sep.join((str(names[k]) if names[k] is not None else '').ljust(widths[k]) for k in range(nl))
    return cells, head


class _PlotAccessor:
    """df.plot / s.plot: delega en matplotlib.pyplot (figura SVG en el móvil)."""

    def __init__(self, obj):
        self.o = obj

    def __call__(self, *args, kind='line', **kw):
        return getattr(self, kind)(*args, **kw)

    def _dec(self, plt, title, xlabel, ylabel, legend, grid=None, **kw):
        ax = plt.gca()
        if title:
            plt.title(title)
        if xlabel:
            plt.xlabel(xlabel)
        if ylabel:
            plt.ylabel(ylabel)
        if legend:
            plt.legend()
        if grid:
            plt.grid(True)
        if kw.get('xlim') is not None:
            plt.xlim(*kw['xlim'])
        if kw.get('ylim') is not None:
            plt.ylim(*kw['ylim'])
        return ax

    def _series_list(self):
        o = self.o
        if isinstance(o, Series):
            return [(o.name if o.name is not None else '', o)]
        return [(c, o._series(c)) for c in o._cols if o._dts[c] in ('int64', 'float64', 'bool')]

    def line(self, x=None, y=None, title=None, xlabel=None, ylabel=None, legend=None, grid=None, color=None, marker=None, style=None, **kw):
        import matplotlib.pyplot as plt
        o = self.o
        items = self._series_list()
        if isinstance(o, DataFrame) and x is not None:
            xs = o._data[x]
            items = [(c, s) for c, s in items if c != x and (y is None or c == y or (isinstance(y, list) and c in y))]
        else:
            xs = list(o.index._l)
            if xs and not all(isinstance(v, (int, float)) for v in xs):
                plt.xticks(list(range(len(xs))), [str(v) for v in xs])
                xs = list(range(len(xs)))
        for name, s in items:
            plt.plot(xs, s._d, label=str(name), color=color, marker=marker)
        self._dec(plt, title, xlabel if xlabel else (x if isinstance(x, str) else None), ylabel, legend if legend is not None else isinstance(o, DataFrame), grid, **kw)
        return plt.gca()

    def bar(self, x=None, y=None, title=None, xlabel=None, ylabel=None, legend=None, color=None, rot=None, grid=None, **kw):
        import matplotlib.pyplot as plt
        o = self.o
        if isinstance(o, DataFrame) and x is not None:
            labels = [str(v) for v in o._data[x]]
            items = [(c, s) for c, s in self._series_list() if c != x and (y is None or c == y or (isinstance(y, list) and c in y))]
        else:
            labels = [str(v) for v in o.index._l]
            items = self._series_list()
        n = len(labels)
        k = len(items)
        w = 0.8 / max(k, 1)
        for i, (name, s) in enumerate(items):
            xs = [j - 0.4 + w * (i + 0.5) for j in range(n)]
            plt.bar(xs, s._d, width=w, label=str(name), color=color)
        plt.xticks(list(range(n)), labels)
        self._dec(plt, title, xlabel, ylabel, legend if legend is not None else k > 1, grid, **kw)
        return plt.gca()

    def barh(self, x=None, y=None, title=None, xlabel=None, ylabel=None, color=None, **kw):
        import matplotlib.pyplot as plt
        o = self.o
        labels = [str(v) for v in o.index._l] if x is None else [str(v) for v in o._data[x]]
        name, s = self._series_list()[0] if y is None else (y, o._series(y))
        plt.barh(list(range(len(labels))), s._d, color=color)
        plt.yticks(list(range(len(labels))), labels)
        self._dec(plt, title, xlabel, ylabel, False, None, **kw)
        return plt.gca()

    def hist(self, bins=10, title=None, xlabel=None, ylabel=None, alpha=None, color=None, legend=None, density=False, column=None, **kw):
        import matplotlib.pyplot as plt
        items = self._series_list()
        if column is not None:
            items = [(c, s) for c, s in items if c == column]
        for name, s in items:
            plt.hist(_nums(s._d), bins=bins, alpha=alpha if alpha is not None else (0.6 if len(items) > 1 else None), label=str(name), color=color, density=density)
        self._dec(plt, title, xlabel, ylabel if ylabel else 'Frequency', legend if legend is not None else len(items) > 1, None, **kw)
        return plt.gca()

    def box(self, column=None, title=None, ylabel=None, **kw):
        import matplotlib.pyplot as plt
        items = self._series_list()
        if column is not None:
            cs = column if isinstance(column, list) else [column]
            items = [(c, s) for c, s in items if c in cs]
        plt.boxplot([_nums(s._d) for _, s in items], labels=[str(n) for n, _ in items])
        self._dec(plt, title, None, ylabel, False, None, **kw)
        return plt.gca()

    def scatter(self, x, y, c=None, s=None, alpha=None, title=None, xlabel=None, ylabel=None, color=None, cmap=None, **kw):
        import matplotlib.pyplot as plt
        o = self.o
        cc = o._data[c] if isinstance(c, str) and c in o._data else c
        if cc is not None and isinstance(cc, list) and cc and isinstance(cc[0], str):
            cats = _sorted_labels(_unique(cc))
            cc = [cats.index(v) for v in cc]
        plt.scatter(o._data[x], o._data[y], c=cc if cc is not None else color, s=s, alpha=alpha, cmap=cmap)
        self._dec(plt, title, xlabel if xlabel else x, ylabel if ylabel else y, False, None, **kw)
        return plt.gca()

    def pie(self, y=None, title=None, autopct=None, **kw):
        import matplotlib.pyplot as plt
        o = self.o
        s = o if isinstance(o, Series) else o._series(y if y is not None else self._series_list()[0][0])
        plt.pie(s._d, labels=[str(v) for v in s.index._l], autopct=autopct)
        self._dec(plt, title, None, None, False, None, **kw)
        return plt.gca()

    def area(self, **kw):
        return self.line(**kw)

    def kde(self, **kw):
        return self.hist(density=True, **kw)

    density = kde


class _SLoc:
    def __init__(self, s):
        self.s = s

    def __getitem__(self, key):
        s = self.s
        if isinstance(key, slice):
            labs = s.index._l
            start = 0 if key.start is None else labs.index(key.start)
            stop = len(labs) if key.stop is None else labs.index(key.stop) + 1
            return s._new(s._d[start:stop:key.step or 1], Index(labs[start:stop:key.step or 1], s.index.name), s.name)
        return s[key]

    def __setitem__(self, key, value):
        self.s[key] = value


class _SILoc:
    def __init__(self, s):
        self.s = s

    def __getitem__(self, key):
        s = self.s
        if isinstance(key, slice):
            return s._new(s._d[key], Index(s.index._l[key], s.index.name), s.name)
        if isinstance(key, (list, np.ndarray)):
            m = _mask_list(key, len(s._d))
            if m is not None:
                return s.take([i for i, k in enumerate(m) if k])
            return s.take([int(i) for i in key])
        return s._d[key]

    def __setitem__(self, key, value):
        s = self.s
        if isinstance(key, slice):
            pos = list(range(len(s._d)))[key]
            for p, v in zip(pos, _broadcast_vals(value, len(pos))):
                s._d[p] = v
        elif isinstance(key, list):
            for p, v in zip(key, _broadcast_vals(value, len(key))):
                s._d[p] = v
        else:
            s._d[key] = value
        s._refit()


class _Rolling:
    def __init__(self, s, window, min_periods, expanding=False):
        self.s = s
        self.w = window
        self.mp = min_periods if min_periods is not None else window
        self.expanding = expanding

    def _agg(self, f):
        d = self.s._d
        out = []
        for i in range(len(d)):
            lo = 0 if self.expanding else max(0, i - self.w + 1)
            win = [x for x in d[lo:i + 1] if not _isna(x)]
            full = (i + 1 - lo) >= (self.w if not self.expanding else 1)
            out.append(f(win) if len(win) >= self.mp and (full or self.expanding) else nan)
        return Series(out, index=self.s.index, name=self.s.name, dtype='float64')

    def mean(self): return self._agg(_mean)
    def sum(self): return self._agg(lambda v: float(sum(v)))
    def min(self): return self._agg(lambda v: float(min(v)))
    def max(self): return self._agg(lambda v: float(max(v)))
    def std(self): return self._agg(_std)
    def median(self): return self._agg(_median)


class _StringArray:
    """Lo que devuelve `unique()` en una columna de texto (pandas 3 usa StringArray)."""

    def __init__(self, vals):
        self._v = list(vals)

    def tolist(self):
        return list(self._v)

    def __len__(self):
        return len(self._v)

    def __iter__(self):
        return iter(self._v)

    def __getitem__(self, i):
        return self._v[i]

    def __contains__(self, x):
        return x in self._v

    def __eq__(self, other):
        return np.array([a == b for a, b in zip(self._v, other)])

    __hash__ = None

    def __repr__(self):
        return '<StringArray>\n[%s]\nLength: %d, dtype: str' % (', '.join(repr(v) for v in self._v), len(self._v))

    __str__ = __repr__


class _StrAccessor:
    def __init__(self, s):
        self.s = s

    def _m(self, f, dtype=None):
        return self.s._new([nan if _isna(v) else f(v) for v in self.s._d], dtype=dtype)

    def lower(self): return self._m(lambda v: v.lower())
    def upper(self): return self._m(lambda v: v.upper())
    def title(self): return self._m(lambda v: v.title())
    def capitalize(self): return self._m(lambda v: v.capitalize())
    def strip(self, chars=None): return self._m(lambda v: v.strip(chars))
    def lstrip(self, chars=None): return self._m(lambda v: v.lstrip(chars))
    def rstrip(self, chars=None): return self._m(lambda v: v.rstrip(chars))
    def len(self): return self._m(len)
    def isdigit(self): return self._m(lambda v: v.isdigit())
    def isalpha(self): return self._m(lambda v: v.isalpha())
    def isnumeric(self): return self._m(lambda v: v.isnumeric())
    def zfill(self, w): return self._m(lambda v: v.zfill(w))
    def pad(self, width, side='left', fillchar=' '):
        return self._m(lambda v: v.rjust(width, fillchar) if side == 'left' else v.ljust(width, fillchar))
    def slice(self, start=None, stop=None, step=None): return self._m(lambda v: v[start:stop:step])
    def count(self, pat): return self._m(lambda v: len(re.findall(pat, v)))
    def find(self, sub): return self._m(lambda v: v.find(sub))

    def contains(self, pat, case=True, regex=True, na=nan):
        flags = 0 if case else re.IGNORECASE
        if regex:
            return self._m(lambda v: re.search(pat, v, flags) is not None)
        if case:
            return self._m(lambda v: pat in v)
        return self._m(lambda v: pat.lower() in v.lower())

    def startswith(self, pat): return self._m(lambda v: v.startswith(pat))
    def endswith(self, pat): return self._m(lambda v: v.endswith(pat))

    def replace(self, pat, repl, regex=False, case=True):
        if regex:
            fl = 0 if case else re.IGNORECASE
            return self._m(lambda v: re.sub(pat, repl, v, flags=fl))
        return self._m(lambda v: v.replace(pat, repl))

    def split(self, pat=None, n=-1, expand=False):
        parts = [nan if _isna(v) else v.split(pat, n) if n != -1 else v.split(pat) for v in self.s._d]
        if expand:
            w = max([len(p) for p in parts if isinstance(p, list)] or [0])
            return DataFrame({i: [p[i] if isinstance(p, list) and i < len(p) else None for p in parts] for i in range(w)}, index=self.s.index)
        return self.s._new(parts, dtype='object')

    def get(self, i):
        return self.s._new([nan if _isna(v) else (v[i] if -len(v) <= i < len(v) else nan) for v in self.s._d])

    def cat(self, sep=''):
        return sep.join(v for v in self.s._d if not _isna(v))

    def extract(self, pat, expand=False):
        out = []
        for v in self.s._d:
            m = None if _isna(v) else re.search(pat, v)
            out.append(m.group(1) if m and m.groups() else nan)
        return self.s._new(out)


# ───────────────────────── DataFrame ─────────────────────────

def _col_from(v, n, index):
    """Valores de una columna a partir de lista/array/Series/escalar (alineando Series por etiquetas)."""
    if isinstance(v, Series):
        if index is not None and v.index._l != index._l:
            d = dict(zip(v.index._l, v._d))
            return [d.get(k, nan) for k in index._l]
        return list(v._d)
    if isinstance(v, np.ndarray):
        v = v.tolist()
    if isinstance(v, (list, tuple, range)):
        return [_np_scalar(x) for x in v]
    if isinstance(v, Index):
        return list(v._l)
    return [_np_scalar(v)] * n


class DataFrame:
    def __init__(self, data=None, index=None, columns=None, dtype=None, copy=None):
        cols = []
        store = {}
        idx = index if isinstance(index, Index) else (Index(list(index)) if index is not None else None)
        if isinstance(data, DataFrame):
            cols = list(data._cols)
            store = {c: list(data._data[c]) for c in cols}
            idx = idx if idx is not None else data.index
        elif isinstance(data, dict):
            keys = list(data.keys()) if columns is None else [c for c in columns]
            n = None
            for k in keys:
                v = data.get(k)
                if isinstance(v, Series) and idx is None:
                    idx = v.index
                if isinstance(v, (list, tuple, np.ndarray, Series, range)):
                    ln = len(v)
                    if n is not None and ln != n and not isinstance(v, Series):
                        raise ValueError('All arrays must be of the same length')
                    n = ln if n is None else n
            if n is None:
                n = len(idx) if idx is not None else (1 if keys else 0)
            if idx is None:
                idx = _range_index(n)
            for k in keys:
                store[k] = _col_from(data[k], len(idx), idx) if k in data else [nan] * len(idx)
                cols.append(k)
        elif data is None:
            keys = list(columns) if columns is not None else []
            n = len(idx) if idx is not None else 0
            for k in keys:
                store[k] = [nan] * n
                cols.append(k)
            idx = idx if idx is not None else _range_index(0)
        else:
            rows = data.tolist() if isinstance(data, np.ndarray) else list(data)
            if rows and isinstance(rows[0], dict):
                keys = []
                for r in rows:
                    for k in r:
                        if k not in keys:
                            keys.append(k)
                if columns is not None:
                    keys = list(columns)
                for k in keys:
                    store[k] = [r.get(k, nan) for r in rows]
                    cols.append(k)
            elif rows and isinstance(rows[0], Series):
                keys = list(rows[0].index._l) if columns is None else list(columns)
                for j, k in enumerate(keys):
                    store[k] = [r._d[j] for r in rows]
                    cols.append(k)
                if idx is None:
                    idx = Index([r.name for r in rows]) if all(r.name is not None for r in rows) else None
            else:
                if rows and not isinstance(rows[0], (list, tuple)):
                    rows = [[v] for v in rows]
                nc = len(rows[0]) if rows else (len(columns) if columns is not None else 0)
                keys = list(columns) if columns is not None else list(range(nc))
                for j, k in enumerate(keys):
                    store[k] = [_np_scalar(r[j]) for r in rows]
                    cols.append(k)
            n = len(rows)
            if idx is None:
                idx = _range_index(n)
        self.index = idx
        self._cols = cols
        self._data = {}
        self._dts = {}
        self._colname = None
        for c in cols:
            self._set_col(c, store[c])
        if dtype is not None:
            for c in cols:
                s = self._series(c).astype(dtype)
                self._data[c], self._dts[c] = s._d, s._dt

    def _set_col(self, c, vals):
        dt = _infer(vals)
        self._data[c] = _coerce(vals, dt)
        self._dts[c] = dt

    @classmethod
    def _build(cls, cols, data, index, colname=None):
        df = cls.__new__(cls)
        df.index = index
        df._cols = list(cols)
        df._data = {}
        df._dts = {}
        df._colname = colname
        for c in df._cols:
            df._set_col(c, data[c])
        return df

    def _series(self, c):
        s = Series.__new__(Series)
        s._d = list(self._data[c])
        s._dt = self._dts[c]
        s.index = self.index
        s.name = c
        return s

    # --- propiedades
    @property
    def columns(self):
        return Index(self._cols, self._colname)

    @columns.setter
    def columns(self, new):
        new = list(new)
        if len(new) != len(self._cols):
            raise ValueError('Length mismatch: Expected axis has %d elements, new values have %d elements' % (len(self._cols), len(new)))
        data = {n: self._data[o] for o, n in zip(self._cols, new)}
        dts = {n: self._dts[o] for o, n in zip(self._cols, new)}
        self._cols, self._data, self._dts = new, data, dts

    @property
    def shape(self):
        return (len(self.index), len(self._cols))

    @property
    def size(self):
        return len(self.index) * len(self._cols)

    @property
    def ndim(self):
        return 2

    @property
    def empty(self):
        return len(self.index) == 0 or len(self._cols) == 0

    @property
    def dtypes(self):
        return Series([_DType(self._dts[c]) for c in self._cols], index=Index(self._cols), dtype='object')

    @property
    def values(self):
        return self.to_numpy()

    @property
    def T(self):
        rows = [[self._data[c][i] for c in self._cols] for i in range(len(self.index))]
        return DataFrame({self.index._l[i]: [self._data[c][i] for c in self._cols] for i in range(len(self.index))}, index=Index(self._cols)) if rows else DataFrame()

    transpose = lambda self: self.T

    @property
    def axes(self):
        return [self.index, self.columns]

    @property
    def loc(self):
        return _DLoc(self)

    @property
    def iloc(self):
        return _DILoc(self)

    @property
    def at(self):
        return _DLoc(self)

    @property
    def iat(self):
        return _DILoc(self)

    def __len__(self):
        return len(self.index)

    def __iter__(self):
        return iter(self._cols)

    def __contains__(self, key):
        return key in self._cols

    def __hash__(self):
        raise TypeError("unhashable type: 'DataFrame'")

    def __bool__(self):
        raise ValueError('The truth value of a DataFrame is ambiguous. Use a.empty, a.bool(), a.item(), a.any() or a.all().')

    def keys(self):
        return self.columns

    def items(self):
        for c in self._cols:
            yield c, self._series(c)

    iteritems = items

    def to_numpy(self, dtype=None):
        rows = [[self._data[c][i] for c in self._cols] for i in range(len(self.index))]
        if not rows:
            return np.zeros((0, len(self._cols)))
        kinds = set(self._dts.values())
        if kinds <= {'int64', 'float64', 'bool'}:
            a = np.array(rows)
        else:
            a = np.array(rows, dtype=object)
        return a.astype(dtype) if dtype else a

    def copy(self, deep=True):
        return DataFrame._build(self._cols, {c: list(self._data[c]) for c in self._cols}, self.index.copy(), self._colname)

    # --- representación
    def __repr__(self):
        return self._repr(True)

    def __str__(self):
        return self._repr(True)

    def to_string(self, index=True, header=True, max_rows=None, **kw):
        return self._repr(False, index=index, header=header)

    def _repr(self, truncate, index=True, header=True):
        n, nc = self.shape
        if nc == 0 or n == 0:
            if nc == 0:
                return 'Empty DataFrame\nColumns: []\nIndex: %s' % ('[]' if n == 0 else repr(self.index._l))
            return 'Empty DataFrame\nColumns: [%s]\nIndex: []' % ', '.join(str(c) for c in self._cols)
        rows = list(range(n))
        trunc_r = truncate and n > _OPTIONS['display.max_rows']
        if trunc_r:
            h = _OPTIONS['display.min_rows'] // 2
            rows = list(range(h)) + [None] + list(range(n - h, n))
        labels = _fmt_index_labels(self.index, ' ')
        if labs_multi(self.index):
            name_row = _fmt_multi(self.index._l, self.index.name if isinstance(self.index.name, (list, tuple)) else [None] * len(self.index._l[0]), ' ')[1]
            has_names = isinstance(self.index.name, (list, tuple)) and any(x is not None for x in self.index.name)
        else:
            name_row = str(self.index.name) if self.index.name is not None else ''
            has_names = self.index.name is not None
        iw = max([len(x) for x in labels] + [len(name_row)])
        if not index:
            iw = 0
        # celdas de todas las columnas (con las filas ya recortadas)
        cells_all = []
        for c in self._cols:
            dt = self._dts[c]
            full = _lead(_fmt_col(self._data[c], dt), dt)
            dots = '..' if max(len(x) for x in full) <= 3 else '...'
            cells = [dots if r is None else full[r] for r in rows]
            textual = dt in ('str', 'object')
            cells_all.append((str(c) if textual else ' ' + str(c), cells))
        widths_all = [max([len(h)] + [len(x) for x in cells]) for h, cells in cells_all]
        mc = _OPTIONS['display.max_columns']
        shown = list(range(nc))
        trunc_c = False
        maxw = _OPTIONS['display.width']
        if truncate and mc is not None and mc > 0 and nc > mc:
            k = max(mc // 2, 1)
            shown = list(range(k)) + [None] + list(range(nc - k, nc))
            trunc_c = True
        elif truncate and mc == 0:
            total = iw + sum(w + 1 for w in widths_all)
            if total > maxw:
                lens = [iw] + list(widths_all)
                keys = list(range(len(lens)))
                adj = total - maxw + 1
                while adj > 0 and len(keys) > 1:
                    mid = round(len(keys) / 2)
                    adj -= lens[keys[mid]] + 1
                    del keys[mid]
                fitted = max(len(keys) - (1 if index else 0), 2)
                k = fitted // 2
                if k >= 1 and k < nc:
                    shown = list(range(k)) + [None] + list(range(nc - k, nc))
                    trunc_c = True
        colcells = []
        for j in shown:
            if j is None:
                colcells.append(('...', [' ...'] * len(rows)))
            else:
                colcells.append(cells_all[j])
        widths = [max([len(h)] + [len(x) for x in cells]) for h, cells in colcells]
        # partir en bloques según el ancho de pantalla (solo si no se recorta por ancho)
        blocks = []
        cur = []
        curw = iw
        for k, w in enumerate(widths):
            if cur and truncate and mc != 0 and curw + w + 1 > maxw:
                blocks.append(cur)
                cur = []
                curw = iw
            cur.append(k)
            curw += w + 1
        blocks.append(cur)
        out_blocks = []
        for bi, blk in enumerate(blocks):
            lines = []
            head = (str(self._colname) if self._colname is not None else '').ljust(iw)
            if header:
                lines.append(head + ''.join(' ' + colcells[k][0].rjust(widths[k]) for k in blk))
            if has_names and index:
                lines.append(name_row.ljust(iw) + ''.join(' ' + ''.rjust(widths[k]) for k in blk))
            for ri, r in enumerate(rows):
                lab = ('..' if iw <= 2 else '...') if r is None else labels[r]
                lines.append((lab.ljust(iw) if index else '') + ''.join(' ' + colcells[k][1][ri].rjust(widths[k]) for k in blk))
            if bi < len(blocks) - 1:
                lines = [l + ' \\' for l in lines]
            out_blocks.append('\n'.join(lines))
        text = '\n\n'.join(out_blocks)
        if truncate and (trunc_r or trunc_c):
            text += '\n\n[%d rows x %d columns]' % (n, nc)
        return text

    def to_markdown(self, index=True):
        heads = ([''] if index else []) + [str(c) for c in self._cols]
        lines = ['| ' + ' | '.join(heads) + ' |', '|' + '|'.join(['---'] * len(heads)) + '|']
        for i in range(len(self.index)):
            cells = ([str(self.index._l[i])] if index else []) + [str(self._data[c][i]) for c in self._cols]
            lines.append('| ' + ' | '.join(cells) + ' |')
        return '\n'.join(lines)

    def info(self, verbose=None, buf=None, memory_usage=None, show_counts=None):
        n = len(self.index)
        out = ["<class 'pandas.DataFrame'>"]
        if self.index._range is not None:
            out.append('RangeIndex: %d entries, %s to %s' % (n, 0 if n else 0, n - 1) if n else 'RangeIndex: 0 entries')
        else:
            out.append('Index: %d entries, %s to %s' % (n, self.index._l[0], self.index._l[-1]))
        nc = len(self._cols)
        out.append('Data columns (total %d columns):' % nc)
        cw = max([len(str(c)) for c in self._cols] + [6])
        cnts = [str(sum(1 for v in self._data[c] if not _isna(v))) + ' non-null' for c in self._cols]
        nw = max([len(x) for x in cnts] + [14])
        dw = max([len(self._dts[c]) for c in self._cols] + [5])
        out.append(' #   ' + 'Column'.ljust(cw) + '  ' + 'Non-Null Count'.ljust(nw) + '  ' + 'Dtype'.ljust(dw))
        out.append('---  ' + '------' + ' ' * (cw - 6) + '  ' + '-' * 14 + ' ' * (nw - 14) + '  ' + '-' * 5 + ' ' * (dw - 5))
        for i, c in enumerate(self._cols):
            out.append(str(i).rjust(2) + '   ' + str(c).ljust(cw) + '  ' + cnts[i].ljust(nw) + '  ' + self._dts[c].ljust(dw))
        counts = {}
        for c in self._cols:
            counts[self._dts[c]] = counts.get(self._dts[c], 0) + 1
        out.append('dtypes: ' + ', '.join('%s(%d)' % (k, v) for k, v in sorted(counts.items())))
        size = (132 if self.index._range is not None else 8 * n) + 8 * n * nc
        plus = '+' if ((self.index._range is None and _infer(self.index._l) in ('str', 'object')) or any(self._dts[c] == 'object' for c in self._cols)) else ''
        if size < 1024:
            out.append('memory usage: %.1f%s bytes' % (size, plus))
        else:
            out.append('memory usage: %.1f%s KB' % (size / 1024, plus))
        text = '\n'.join(out) + '\n'
        if buf is not None:
            buf.write(text)
            return None
        print(text, end='')

    # --- selección
    def _pos_col(self, c):
        if c not in self._data:
            raise KeyError(c)
        return c

    def __getitem__(self, key):
        n = len(self.index)
        m = _mask_list(key, n)
        if m is not None:
            keep = [i for i in range(n) if m[i]]
            return self._rows(keep)
        if isinstance(key, slice):
            return self._rows(list(range(n))[key]) if (_is_int_slice(key) or not _is_label_index(self.index)) else self.loc[key]
        if isinstance(key, (list, np.ndarray, Index)):
            keys = key.tolist() if hasattr(key, 'tolist') else list(key)
            for k in keys:
                if k not in self._data:
                    raise KeyError('%s not in index' % repr(keys) if False else "['%s'] not in index" % k)
            return DataFrame._build(keys, {c: self._data[c] for c in keys}, self.index)
        if isinstance(key, DataFrame):
            raise NotImplementedError('indexar con un DataFrame booleano no está soportado')
        if key not in self._data:
            raise KeyError(key)
        return self._series(key)

    def _rows(self, pos):
        return DataFrame._build(self._cols, {c: [self._data[c][i] for i in pos] for c in self._cols}, Index([self.index._l[i] for i in pos], self.index.name), self._colname)

    def get(self, key, default=None):
        return self[key] if key in self._data else default

    def __setitem__(self, key, value):
        n = len(self.index)
        if isinstance(key, (list, tuple)):
            if isinstance(value, DataFrame):
                for k, c in zip(key, value._cols):
                    self[k] = value[c]
            else:
                arr = value.tolist() if isinstance(value, np.ndarray) else value
                for j, k in enumerate(key):
                    self[k] = [r[j] for r in arr]
            return
        if _mask_list(key, n) is not None:
            raise NotImplementedError('usa df.loc[máscara, columna] = valor')
        vals = _col_from(value, n, self.index)
        if len(vals) != n:
            raise ValueError('Length of values (%d) does not match length of index (%d)' % (len(vals), n))
        if key not in self._data:
            self._cols.append(key)
        self._set_col(key, vals)

    def __delitem__(self, key):
        self._cols.remove(key)
        del self._data[key]
        del self._dts[key]

    def pop(self, key):
        s = self[key]
        del self[key]
        return s

    def insert(self, loc, column, value, allow_duplicates=False):
        self[column] = value
        self._cols.remove(column)
        self._cols.insert(loc, column)

    def assign(self, **kw):
        df = self.copy()
        for k, v in kw.items():
            df[k] = v(df) if callable(v) else v
        return df

    def head(self, n=5):
        return self._rows(list(range(len(self.index)))[:n])

    def tail(self, n=5):
        pos = list(range(len(self.index)))
        return self._rows(pos[-n:] if n else [])

    def sample(self, n=None, frac=None, replace=False, random_state=None, axis=0):
        k = n if n is not None else int(round(len(self.index) * frac))
        rs = random_state if isinstance(random_state, np.random.RandomState) else np.random.RandomState(random_state)
        pos = rs.choice(len(self.index), size=k, replace=replace).tolist()
        return self._rows(pos)

    def take(self, positions, axis=0):
        return self._rows(list(positions))

    def select_dtypes(self, include=None, exclude=None):
        def kinds(x):
            if x is None:
                return set()
            xs = x if isinstance(x, (list, tuple)) else [x]
            out = set()
            for t in xs:
                t = t if isinstance(t, str) else getattr(t, '__name__', str(t))
                if t == 'number':
                    out |= {'int64', 'float64'}
                elif t in ('int', 'int64'):
                    out.add('int64')
                elif t in ('float', 'float64'):
                    out.add('float64')
                elif t in ('object', 'O', 'str', 'string'):
                    out |= {'object', 'str'}
                elif t in ('bool', 'boolean'):
                    out.add('bool')
            return out
        inc, exc = kinds(include), kinds(exclude)
        cols = [c for c in self._cols if (not inc or self._dts[c] in inc) and self._dts[c] not in exc]
        return DataFrame._build(cols, {c: self._data[c] for c in cols}, self.index)

    # --- aritmética: DataFrame con escalar o Series/DataFrame
    def _binary(self, other, f, rev=False):
        data = {}
        for c in self._cols:
            if isinstance(other, DataFrame):
                o = other._series(c) if c in other._data else Series([nan] * len(self.index), index=self.index)
            elif isinstance(other, Series):
                o = other
            else:
                o = other
            s = self._series(c)
            r = getattr(o, '_rbin', None)
            data[c] = getattr(s, f)(o)._d if not rev else getattr(s, f)(o)._d
        return DataFrame._build(self._cols, data, self.index)

    def __add__(self, o): return self._binary(o, '__add__')
    def __radd__(self, o): return self._binary(o, '__radd__')
    def __sub__(self, o): return self._binary(o, '__sub__')
    def __rsub__(self, o): return self._binary(o, '__rsub__')
    def __mul__(self, o): return self._binary(o, '__mul__')
    def __rmul__(self, o): return self._binary(o, '__rmul__')
    def __truediv__(self, o): return self._binary(o, '__truediv__')
    def __rtruediv__(self, o): return self._binary(o, '__rtruediv__')
    def __floordiv__(self, o): return self._binary(o, '__floordiv__')
    def __mod__(self, o): return self._binary(o, '__mod__')
    def __pow__(self, o): return self._binary(o, '__pow__')
    def __eq__(self, o): return self._binary(o, '__eq__')
    def __ne__(self, o): return self._binary(o, '__ne__')
    def __lt__(self, o): return self._binary(o, '__lt__')
    def __le__(self, o): return self._binary(o, '__le__')
    def __gt__(self, o): return self._binary(o, '__gt__')
    def __ge__(self, o): return self._binary(o, '__ge__')

    def __neg__(self):
        return self._binary(-1, '__mul__')

    # --- limpieza
    def isna(self):
        return DataFrame._build(self._cols, {c: [_isna(v) for v in self._data[c]] for c in self._cols}, self.index)

    isnull = isna

    def notna(self):
        return DataFrame._build(self._cols, {c: [not _isna(v) for v in self._data[c]] for c in self._cols}, self.index)

    notnull = notna

    def dropna(self, axis=0, how='any', thresh=None, subset=None, inplace=False):
        cols = subset if subset is not None else self._cols
        if axis == 1:
            keep = [c for c in self._cols if (not any(_isna(v) for v in self._data[c]) if how == 'any' else not all(_isna(v) for v in self._data[c]))]
            r = DataFrame._build(keep, {c: self._data[c] for c in keep}, self.index)
        else:
            def ok(i):
                nas = sum(1 for c in cols if _isna(self._data[c][i]))
                if thresh is not None:
                    return len(cols) - nas >= thresh
                return nas == 0 if how == 'any' else nas < len(cols)
            r = self._rows([i for i in range(len(self.index)) if ok(i)])
        return self._finish(r, inplace)

    def _finish(self, r, inplace):
        if inplace:
            self.index, self._cols, self._data, self._dts = r.index, r._cols, r._data, r._dts
            return None
        return r

    def fillna(self, value=None, method=None, inplace=False, limit=None):
        data = {}
        for c in self._cols:
            if isinstance(value, dict):
                data[c] = self._series(c).fillna(value[c])._d if c in value else list(self._data[c])
            elif method is not None:
                data[c] = self._series(c).fillna(method=method)._d
            else:
                data[c] = self._series(c).fillna(value)._d
        return self._finish(DataFrame._build(self._cols, data, self.index), inplace)

    def ffill(self):
        return self.fillna(method='ffill')

    def bfill(self):
        return self.fillna(method='bfill')

    def interpolate(self):
        return DataFrame._build(self._cols, {c: (self._series(c).interpolate()._d if self._dts[c] in ('int64', 'float64') else self._data[c]) for c in self._cols}, self.index)

    def duplicated(self, subset=None, keep='first'):
        cols = subset if subset is not None else self._cols
        if isinstance(cols, str):
            cols = [cols]
        keys = [tuple(self._data[c][i] for c in cols) for i in range(len(self.index))]
        return Series(keys, index=self.index, dtype='object').duplicated(keep).rename(None)

    def drop_duplicates(self, subset=None, keep='first', inplace=False, ignore_index=False):
        d = self.duplicated(subset, keep)
        r = self._rows([i for i, k in enumerate(d._d) if not k])
        if ignore_index:
            r.index = _range_index(len(r.index))
        return self._finish(r, inplace)

    def drop(self, labels=None, axis=0, index=None, columns=None, inplace=False, errors='raise'):
        cols = columns
        rows = index
        if labels is not None:
            if axis in (1, 'columns'):
                cols = labels
            else:
                rows = labels
        r = self
        if cols is not None:
            cs = cols if isinstance(cols, (list, tuple, set)) else [cols]
            for c in cs:
                if c not in self._data and errors == 'raise':
                    raise KeyError("['%s'] not found in axis" % c)
            keep = [c for c in self._cols if c not in cs]
            r = DataFrame._build(keep, {c: r._data[c] for c in keep}, r.index, r._colname)
        if rows is not None:
            rs = rows if isinstance(rows, (list, tuple, set)) else [rows]
            r = r._rows([i for i, k in enumerate(r.index._l) if k not in rs])
        return self._finish(r, inplace)

    def rename(self, columns=None, index=None, mapper=None, axis=0, inplace=False):
        if mapper is not None:
            if axis in (1, 'columns'):
                columns = mapper
            else:
                index = mapper
        cols = [(columns(c) if callable(columns) else columns.get(c, c)) if columns is not None else c for c in self._cols]
        data = {n: self._data[o] for o, n in zip(self._cols, cols)}
        idx = self.index
        if index is not None:
            idx = Index([(index(k) if callable(index) else index.get(k, k)) for k in self.index._l], self.index.name)
        return self._finish(DataFrame._build(cols, data, idx, self._colname), inplace)

    def rename_axis(self, mapper=None, axis=0, **kw):
        r = self.copy()
        if axis in (1, 'columns'):
            r._colname = mapper
        else:
            r.index = Index(self.index._l, mapper)
        return r

    def reset_index(self, drop=False, inplace=False, names=None):
        if drop:
            r = DataFrame._build(self._cols, self._data, _range_index(len(self.index)), self._colname)
            return self._finish(r, inplace)
        if self.index._l and isinstance(self.index._l[0], tuple):
            nm = self.index.name if isinstance(self.index.name, (list, tuple)) else ['level_%d' % k for k in range(len(self.index._l[0]))]
            cols = list(nm) + self._cols
            data = {n: [t[k] for t in self.index._l] for k, n in enumerate(nm)}
        else:
            nm = self.index.name if self.index.name is not None else ('index' if 'index' not in self._data else 'level_0')
            cols = [nm] + self._cols
            data = {nm: list(self.index._l)}
        for c in self._cols:
            data[c] = self._data[c]
        return self._finish(DataFrame._build(cols, data, _range_index(len(self.index))), inplace)

    def set_index(self, keys, drop=True, inplace=False):
        ks = keys if isinstance(keys, list) else [keys]
        if len(ks) == 1:
            idx = Index(list(self._data[ks[0]]), ks[0])
        else:
            idx = Index([tuple(self._data[k][i] for k in ks) for i in range(len(self.index))], list(ks))
        cols = [c for c in self._cols if c not in ks] if drop else list(self._cols)
        return self._finish(DataFrame._build(cols, self._data, idx), inplace)

    def sort_index(self, ascending=True, inplace=False, axis=0):
        if axis in (1, 'columns'):
            cols = sorted(self._cols, reverse=not ascending)
            return DataFrame._build(cols, self._data, self.index)
        labs = self.index._l
        order = sorted(range(len(labs)), key=lambda i: labs[i])
        if not ascending:
            order = sorted(range(len(labs)), key=cmp_to_key(lambda a, b: -1 if labs[a] > labs[b] else (1 if labs[a] < labs[b] else a - b)))
        return self._finish(self._rows(order), inplace)

    def sort_values(self, by, ascending=True, inplace=False, na_position='last', ignore_index=False, key=None):
        bys = by if isinstance(by, list) else [by]
        asc = ascending if isinstance(ascending, list) else [ascending] * len(bys)
        n = len(self.index)

        def cmp(a, b):
            for c, up in zip(bys, asc):
                x, y = self._data[c][a], self._data[c][b]
                nx, ny = _isna(x), _isna(y)
                if nx or ny:
                    if nx and ny:
                        continue
                    return (1 if nx else -1) if na_position == 'last' else (-1 if nx else 1)
                if x == y:
                    continue
                r = -1 if x < y else 1
                return r if up else -r
            return a - b
        order = sorted(range(n), key=cmp_to_key(cmp))
        r = self._rows(order)
        if ignore_index:
            r.index = _range_index(n)
        return self._finish(r, inplace)

    def nlargest(self, n, columns, keep='first'):
        return self.sort_values(columns, ascending=False).head(n)

    def nsmallest(self, n, columns, keep='first'):
        return self.sort_values(columns, ascending=True).head(n)

    def astype(self, dtype):
        data = {}
        for c in self._cols:
            t = dtype.get(c) if isinstance(dtype, dict) else dtype
            data[c] = self._series(c).astype(t)._d if t is not None else self._data[c]
        return DataFrame._build(self._cols, data, self.index, self._colname)

    def replace(self, to_replace=None, value=None, regex=False):
        return DataFrame._build(self._cols, {c: self._series(c).replace(to_replace, value, regex)._d for c in self._cols}, self.index)

    def clip(self, lower=None, upper=None):
        return DataFrame._build(self._cols, {c: (self._series(c).clip(lower, upper)._d if self._dts[c] in ('int64', 'float64') else self._data[c]) for c in self._cols}, self.index)

    def abs(self):
        return DataFrame._build(self._cols, {c: self._series(c).abs()._d for c in self._cols}, self.index)

    def round(self, decimals=0):
        return DataFrame._build(self._cols, {c: (self._series(c).round(decimals)._d if self._dts[c] in ('int64', 'float64') else self._data[c]) for c in self._cols}, self.index)

    def isin(self, values):
        return DataFrame._build(self._cols, {c: self._series(c).isin(values)._d for c in self._cols}, self.index)

    def where(self, cond, other=nan):
        return DataFrame._build(self._cols, {c: self._series(c).where(cond[c] if isinstance(cond, DataFrame) else cond, other)._d for c in self._cols}, self.index)

    def mask(self, cond, other=nan):
        return DataFrame._build(self._cols, {c: self._series(c).mask(cond[c] if isinstance(cond, DataFrame) else cond, other)._d for c in self._cols}, self.index)

    def _each(self, name, *a, **k):
        return DataFrame._build(self._cols, {c: getattr(self._series(c), name)(*a, **k)._d if self._dts[c] in ('int64', 'float64') else self._data[c] for c in self._cols}, self.index)

    def cumsum(self): return self._each('cumsum')
    def cumprod(self): return self._each('cumprod')
    def cummax(self): return self._each('cummax')
    def cummin(self): return self._each('cummin')
    def diff(self, periods=1): return self._each('diff', periods)
    def pct_change(self, periods=1): return self._each('pct_change', periods)
    def shift(self, periods=1, fill_value=nan): return self._each('shift', periods, fill_value)
    def rank(self, method='average', ascending=True, pct=False): return self._each('rank', method, ascending, pct)

    # --- reducciones
    def _reduce(self, name, axis=0, numeric_only=False, **kw):
        if axis in (1, 'columns'):
            cols = [c for c in self._cols if self._dts[c] in ('int64', 'float64', 'bool')] if numeric_only or name in ('mean', 'median', 'std', 'var') else self._cols
            out = []
            for i in range(len(self.index)):
                s = Series([self._data[c][i] for c in cols])
                out.append(getattr(s, name)(**kw))
            return Series(out, index=self.index)
        cols = [c for c in self._cols if (self._dts[c] in ('int64', 'float64', 'bool'))] if numeric_only else self._cols
        res = [getattr(self._series(c), name)(**kw) for c in cols]
        return Series(res, index=Index(cols))

    def sum(self, axis=0, numeric_only=False, skipna=True): return self._reduce('sum', axis, numeric_only)
    def mean(self, axis=0, numeric_only=False, skipna=True): return self._reduce('mean', axis, numeric_only)
    def median(self, axis=0, numeric_only=False, skipna=True): return self._reduce('median', axis, numeric_only)
    def std(self, axis=0, numeric_only=False, ddof=1): return self._reduce('std', axis, numeric_only, ddof=ddof)
    def var(self, axis=0, numeric_only=False, ddof=1): return self._reduce('var', axis, numeric_only, ddof=ddof)
    def min(self, axis=0, numeric_only=False, skipna=True): return self._reduce('min', axis, numeric_only)
    def max(self, axis=0, numeric_only=False, skipna=True): return self._reduce('max', axis, numeric_only)
    def count(self, axis=0, numeric_only=False): return self._reduce('count', axis, numeric_only)
    def prod(self, axis=0, numeric_only=False): return self._reduce('prod', axis, numeric_only)
    def nunique(self, axis=0, dropna=True): return self._reduce('nunique', axis, False, dropna=dropna)
    def skew(self, axis=0, numeric_only=False): return self._reduce('skew', axis, True)
    def kurt(self, axis=0, numeric_only=False): return self._reduce('kurt', axis, True)
    def any(self, axis=0): return self._reduce('any', axis)
    def all(self, axis=0): return self._reduce('all', axis)
    def idxmax(self, axis=0, numeric_only=True): return self._reduce('idxmax', axis, True)
    def idxmin(self, axis=0, numeric_only=True): return self._reduce('idxmin', axis, True)

    def quantile(self, q=0.5, numeric_only=True):
        cols = [c for c in self._cols if self._dts[c] in ('int64', 'float64')]
        if isinstance(q, (list, tuple)):
            return DataFrame({c: [self._series(c).quantile(x) for x in q] for c in cols}, index=Index([float(x) for x in q]))
        return Series([self._series(c).quantile(q) for c in cols], index=Index(cols), name=q)

    def corr(self, method='pearson', numeric_only=False):
        cols = [c for c in self._cols if self._dts[c] in ('int64', 'float64', 'bool')]
        data = {a: [self._series(a).corr(self._series(b), method) for b in cols] for a in cols}
        return DataFrame._build(cols, data, Index(cols))

    def cov(self):
        cols = [c for c in self._cols if self._dts[c] in ('int64', 'float64')]
        data = {a: [self._series(a).cov(self._series(b)) for b in cols] for a in cols}
        return DataFrame._build(cols, data, Index(cols))

    def corrwith(self, other):
        return Series([self._series(c).corr(other) for c in self._cols], index=Index(self._cols))

    def describe(self, include=None, exclude=None, percentiles=None):
        if include == 'all':
            cols = self._cols
        elif include in ('object', 'str', 'O') or include == ['object']:
            cols = [c for c in self._cols if self._dts[c] in ('str', 'object')]
        else:
            cols = [c for c in self._cols if self._dts[c] in ('int64', 'float64')]
        parts = {c: self._series(c).describe(percentiles) for c in cols}
        labels = []
        for c in cols:
            for k in parts[c].index._l:
                if k not in labels:
                    labels.append(k)
        order = ['count', 'unique', 'top', 'freq', 'mean', 'std', 'min']
        pct = [l for l in labels if l.endswith('%')]
        final = [l for l in order if l in labels] + pct + [l for l in labels if l == 'max']
        data = {}
        for c in cols:
            d = parts[c].to_dict()
            data[c] = [d.get(l, nan) for l in final]
        return DataFrame._build(cols, data, Index(final))

    def value_counts(self, subset=None, normalize=False, sort=True, ascending=False, dropna=True):
        cols = subset if subset is not None else self._cols
        keys = [tuple(self._data[c][i] for c in cols) for i in range(len(self.index))]
        s = Series(keys, dtype='object').value_counts(normalize=normalize, sort=sort, ascending=ascending)
        idx = Index(s.index._l, list(cols) if len(cols) > 1 else cols[0])
        if len(cols) == 1:
            idx = Index([k[0] for k in s.index._l], cols[0])
        return Series(s._d, index=idx, name=s.name)

    # --- aplicar funciones
    def apply(self, func, axis=0, args=(), result_type=None, **kw):
        if axis in (1, 'columns'):
            rows = []
            for i in range(len(self.index)):
                rows.append(func(Series([self._data[c][i] for c in self._cols], index=Index(self._cols), name=self.index._l[i]), *args, **kw))
            if rows and isinstance(rows[0], Series):
                return DataFrame(rows, index=self.index)
            return Series(rows, index=self.index)
        res = [func(self._series(c), *args, **kw) for c in self._cols]
        if res and isinstance(res[0], Series):
            return DataFrame({c: r for c, r in zip(self._cols, res)})
        return Series(res, index=Index(self._cols))

    def map(self, func, na_action=None):
        return DataFrame._build(self._cols, {c: self._series(c).map(func, na_action)._d for c in self._cols}, self.index)

    applymap = map

    def transform(self, func):
        return self.apply(func)

    def agg(self, func, axis=0):
        if isinstance(func, str):
            return getattr(self, func)()
        if isinstance(func, dict):
            parts = {c: self._series(c).agg(f) for c, f in func.items()}
            if all(not isinstance(v, Series) for v in parts.values()):
                return Series(list(parts.values()), index=Index(list(parts.keys())))
            labels = []
            for v in parts.values():
                for k in (v.index._l if isinstance(v, Series) else []):
                    if k not in labels:
                        labels.append(k)
            return DataFrame({c: [dict(zip(v.index._l, v._d)).get(k, nan) for k in labels] for c, v in parts.items()}, index=Index(labels))
        if isinstance(func, (list, tuple)):
            labels = [f if isinstance(f, str) else f.__name__ for f in func]
            return DataFrame({c: [self._series(c).agg(f) for f in func] for c in self._cols if self._dts[c] in ('int64', 'float64')}, index=Index(labels))
        return self.apply(func)

    aggregate = agg

    def pipe(self, func, *a, **kw):
        return func(self, *a, **kw)

    def query(self, expr, local_dict=None, **kw):
        env = {c: self._series(c) for c in self._cols if isinstance(c, str)}
        env['index'] = Series(self.index._l, index=self.index)
        import inspect
        frame = None
        text = expr
        ors = re.split(r'\s+or\s+', text)
        ors = ['(' + ' & '.join('(' + p.strip() + ')' for p in re.split(r'\s+and\s+', o)) + ')' for o in ors]
        text = ' | '.join(ors)
        text = re.sub(r'\bnot\s+', '~', text)
        text = re.sub(r'@(\w+)', r'__loc_\1', text)
        for k, v in (local_dict or {}).items():
            env['__loc_' + k] = v
        mask = eval(text, {'__builtins__': __builtins__}, env)
        return self[mask]

    def eval(self, expr):
        env = {c: self._series(c) for c in self._cols if isinstance(c, str)}
        return eval(expr, {'__builtins__': __builtins__}, env)

    # --- iterar
    def iterrows(self):
        for i in range(len(self.index)):
            yield self.index._l[i], Series([self._data[c][i] for c in self._cols], index=Index(self._cols), name=self.index._l[i])

    def itertuples(self, index=True, name='Pandas'):
        from collections import namedtuple
        fields = (['Index'] if index else []) + [str(c) if str(c).isidentifier() else '_%d' % (k + 1) for k, c in enumerate(self._cols)]
        T = namedtuple(name, fields)
        for i in range(len(self.index)):
            vals = ([self.index._l[i]] if index else []) + [self._data[c][i] for c in self._cols]
            yield T(*vals)

    def to_dict(self, orient='dict'):
        if orient == 'list':
            return {c: list(self._data[c]) for c in self._cols}
        if orient == 'records':
            return [{c: self._data[c][i] for c in self._cols} for i in range(len(self.index))]
        if orient == 'index':
            return {self.index._l[i]: {c: self._data[c][i] for c in self._cols} for i in range(len(self.index))}
        if orient == 'split':
            return {'index': self.index.tolist(), 'columns': list(self._cols), 'data': [[self._data[c][i] for c in self._cols] for i in range(len(self.index))]}
        return {c: dict(zip(self.index._l, self._data[c])) for c in self._cols}

    def to_csv(self, path_or_buf=None, sep=',', index=True, header=True, na_rep=''):
        def cell(v):
            if _isna(v):
                return na_rep
            if isinstance(v, float):
                return repr(v)
            s = str(v)
            if any(ch in s for ch in (sep, '"', '\n')):
                s = '"' + s.replace('"', '""') + '"'
            return s
        lines = []
        if header:
            lines.append(sep.join(([cell(self.index.name) if self.index.name is not None else ''] if index else []) + [cell(c) for c in self._cols]))
        for i in range(len(self.index)):
            lines.append(sep.join(([cell(self.index._l[i])] if index else []) + [cell(self._data[c][i]) for c in self._cols]))
        text = '\n'.join(lines) + '\n'
        if path_or_buf is None:
            return text
        if hasattr(path_or_buf, 'write'):
            path_or_buf.write(text)
        else:
            with open(path_or_buf, 'w') as f:
                f.write(text)
        return None

    def equals(self, other):
        return isinstance(other, DataFrame) and self._cols == other._cols and all(self._data[c] == other._data[c] for c in self._cols) and self.index._l == other.index._l

    def memory_usage(self, index=True, deep=False):
        return Series([8 * len(self.index)] * len(self._cols), index=Index(self._cols))

    def groupby(self, by=None, as_index=True, sort=True, dropna=True):
        return GroupBy(self, by, as_index, sort)

    def merge(self, right, how='inner', on=None, left_on=None, right_on=None, suffixes=('_x', '_y'), left_index=False, right_index=False, indicator=False):
        return merge(self, right, how, on, left_on, right_on, suffixes, left_index, right_index)

    def join(self, other, on=None, how='left', lsuffix='', rsuffix=''):
        return merge(self, other, how, left_on=on, left_index=on is None, right_index=True, suffixes=(lsuffix, rsuffix))

    def explode(self, column):
        rows = []
        for i in range(len(self.index)):
            v = self._data[column][i]
            for x in (v if isinstance(v, list) else [v]):
                rows.append((i, x))
        out = self._rows([i for i, _ in rows])
        out[column] = [x for _, x in rows]
        return out

    def melt(self, id_vars=None, value_vars=None, var_name='variable', value_name='value'):
        ids = id_vars if isinstance(id_vars, list) else ([id_vars] if id_vars is not None else [])
        vs = value_vars if value_vars is not None else [c for c in self._cols if c not in ids]
        data = {c: [] for c in ids}
        data[var_name] = []
        data[value_name] = []
        for v in vs:
            for i in range(len(self.index)):
                for c in ids:
                    data[c].append(self._data[c][i])
                data[var_name].append(v)
                data[value_name].append(self._data[v][i])
        return DataFrame(data)

    def pivot_table(self, values=None, index=None, columns=None, aggfunc='mean', fill_value=None):
        return pivot_table(self, values, index, columns, aggfunc, fill_value)

    @property
    def plot(self):
        return _PlotAccessor(self)

    def hist(self, bins=10, figsize=None, column=None, **kw):
        import matplotlib.pyplot as plt
        cols = [column] if isinstance(column, str) else (column or [c for c in self._cols if self._dts[c] in ('int64', 'float64')])
        n = len(cols)
        nc = min(n, 3)
        nr = (n + nc - 1) // nc
        fig, axes = plt.subplots(nr, nc, figsize=figsize) if n > 1 else (None, [plt.gca()])
        flat = axes.flatten() if hasattr(axes, 'flatten') else list(axes)
        for ax, c in zip(flat, cols):
            ax.hist(_nums(self._data[c]), bins=bins)
            ax.set_title(str(c))
        return axes

    def boxplot(self, column=None, **kw):
        return _PlotAccessor(self).box(column=column, **kw)

    def to_json(self, orient='columns'):
        import json
        return json.dumps(self.to_dict('records' if orient == 'records' else 'dict'), default=str)

    def __getattr__(self, name):
        d = self.__dict__
        if '_data' in d and name in d['_data']:
            return self._series(name)
        raise AttributeError("'DataFrame' object has no attribute '%s'" % name)

    def __setattr__(self, name, value):
        if name in ('index', '_cols', '_data', '_dts', '_colname'):
            object.__setattr__(self, name, value)
        elif '_data' in self.__dict__ and name in self._data:
            self[name] = value
        else:
            object.__setattr__(self, name, value)


class _DLoc:
    def __init__(self, df):
        self.df = df

    def _rows_pos(self, key):
        df = self.df
        n = len(df.index)
        if isinstance(key, slice):
            labs = df.index._l
            start = 0 if key.start is None else labs.index(key.start)
            stop = n if key.stop is None else labs.index(key.stop) + 1
            return list(range(start, stop, key.step or 1)), False
        m = _mask_list(key, n)
        if m is not None:
            return [i for i in range(n) if m[i]], False
        if isinstance(key, (list, np.ndarray, Index)):
            ks = key.tolist() if hasattr(key, 'tolist') else list(key)
            return [df.index._l.index(k) for k in ks], False
        if key in df.index._l:
            pos = [i for i, k in enumerate(df.index._l) if k == key]
            return pos, len(pos) == 1
        raise KeyError(key)

    def _cols_sel(self, key):
        df = self.df
        if isinstance(key, slice):
            cs = df._cols
            start = 0 if key.start is None else cs.index(key.start)
            stop = len(cs) if key.stop is None else cs.index(key.stop) + 1
            return cs[start:stop], False
        if isinstance(key, (list, np.ndarray, Index)):
            ks = list(key.tolist() if hasattr(key, 'tolist') else key)
            m = _mask_list(ks, len(df._cols))
            if m is not None:
                return [c for c, k in zip(df._cols, m) if k], False
            for k in ks:
                if k not in df._data:
                    raise KeyError(k)
            return ks, False
        if key not in df._data:
            raise KeyError(key)
        return [key], True

    def __getitem__(self, key):
        df = self.df
        if isinstance(key, tuple):
            rk, ck = key
        else:
            rk, ck = key, slice(None)
        pos, rscalar = self._rows_pos(rk)
        cols, cscalar = self._cols_sel(ck)
        if rscalar and cscalar:
            return df._data[cols[0]][pos[0]]
        sub = DataFrame._build(cols, {c: [df._data[c][i] for i in pos] for c in cols}, Index([df.index._l[i] for i in pos], df.index.name))
        if cscalar:
            return sub._series(cols[0])
        if rscalar:
            return Series([sub._data[c][0] for c in cols], index=Index(cols), name=df.index._l[pos[0]])
        return sub

    def __setitem__(self, key, value):
        df = self.df
        if isinstance(key, tuple):
            rk, ck = key
        else:
            rk, ck = key, slice(None)
        pos, rscalar = self._rows_pos(rk)
        cols, _ = self._cols_sel(ck) if not (isinstance(ck, str) and ck not in df._data) else ([ck], True)
        for c in cols:
            if c not in df._data:
                df._cols.append(c)
                df._set_col(c, [nan] * len(df.index))
        k = 0
        vals = value
        if isinstance(value, Series):
            vals = value._d
        if isinstance(value, np.ndarray):
            vals = value.tolist()
        for ci, c in enumerate(cols):
            col = list(df._data[c])
            if isinstance(vals, (list, tuple)):
                if vals and isinstance(vals[0], (list, tuple)):
                    seq = [r[ci] for r in vals]
                elif len(cols) > 1 and len(pos) == 1:
                    seq = [vals[ci]]
                else:
                    seq = list(vals)
                for p, v in zip(pos, seq):
                    col[p] = v
            else:
                for p in pos:
                    col[p] = vals
            df._set_col(c, col)


class _DILoc:
    def __init__(self, df):
        self.df = df

    def __getitem__(self, key):
        df = self.df
        if isinstance(key, tuple):
            rk, ck = key
        else:
            rk, ck = key, slice(None)
        n = len(df.index)
        if isinstance(rk, slice):
            pos, rscalar = list(range(n))[rk], False
        elif isinstance(rk, (list, np.ndarray)):
            m = _mask_list(rk, n)
            pos, rscalar = ([i for i, k in enumerate(m) if k] if m is not None else [int(i) for i in rk]), False
        else:
            pos, rscalar = [rk if rk >= 0 else rk + n], True
            if not 0 <= pos[0] < n:
                raise IndexError('single positional indexer is out-of-bounds')
        if isinstance(ck, slice):
            cols, cscalar = df._cols[ck], False
        elif isinstance(ck, (list, np.ndarray)):
            cols, cscalar = [df._cols[int(j)] for j in ck], False
        else:
            cols, cscalar = [df._cols[ck]], True
        if rscalar and cscalar:
            return df._data[cols[0]][pos[0]]
        sub = DataFrame._build(cols, {c: [df._data[c][i] for i in pos] for c in cols}, Index([df.index._l[i] for i in pos], df.index.name))
        if cscalar:
            return sub._series(cols[0])
        if rscalar:
            return Series([sub._data[c][0] for c in cols], index=Index(cols), name=df.index._l[pos[0]])
        return sub

    def __setitem__(self, key, value):
        df = self.df
        if isinstance(key, tuple):
            rk, ck = key
        else:
            rk, ck = key, slice(None)
        n = len(df.index)
        pos = list(range(n))[rk] if isinstance(rk, slice) else ([rk] if isinstance(rk, int) else list(rk))
        cols = df._cols[ck] if isinstance(ck, slice) else ([df._cols[ck]] if isinstance(ck, int) else [df._cols[j] for j in ck])
        for c in cols:
            col = list(df._data[c])
            for p in pos:
                col[p] = value
            df._set_col(c, col)


# ───────────────────────── groupby ─────────────────────────

def _agg_series(vals, how, name='x'):
    s = Series(vals, name=name)
    if callable(how):
        return how(s)
    return getattr(s, how)()


class GroupBy:
    def __init__(self, df, by, as_index=True, sort=True, selection=None):
        self.df = df
        self.keys = by if isinstance(by, list) else [by]
        self.as_index = as_index
        self.sort = sort
        self.selection = selection
        groups = {}
        order = []
        n = len(df.index)
        kcols = []
        for k in self.keys:
            if isinstance(k, Series):
                kcols.append(k._d)
            else:
                if k not in df._data:
                    raise KeyError(k)
                kcols.append(df._data[k])
        for i in range(n):
            key = tuple(c[i] for c in kcols)
            if any(_isna(v) for v in key):
                continue
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(i)
        if sort:
            order = _sorted_labels(order)
        self.groups_pos = groups
        self.order = order
        self.names = [k if not isinstance(k, Series) else k.name for k in self.keys]

    # --- información
    @property
    def ngroups(self):
        return len(self.order)

    @property
    def groups(self):
        return {(k[0] if len(k) == 1 else k): [self.df.index._l[i] for i in self.groups_pos[k]] for k in self.order}

    def __len__(self):
        return len(self.order)

    def __iter__(self):
        for k in self.order:
            yield (k[0] if len(k) == 1 else k), self.df._rows(self.groups_pos[k])

    def get_group(self, key):
        k = key if isinstance(key, tuple) else (key,)
        return self.df._rows(self.groups_pos[k])

    def __getitem__(self, col):
        if isinstance(col, list):
            return GroupBy(self.df, self.keys, self.as_index, self.sort, selection=col)
        return SeriesGroupBy(self, col)

    def __getattr__(self, name):
        d = self.__dict__
        if 'df' in d and name in d['df']._data:
            return SeriesGroupBy(self, name)
        raise AttributeError(name)

    def _index(self):
        if len(self.keys) == 1:
            return Index([k[0] for k in self.order], self.names[0])
        return Index(list(self.order), list(self.names))

    def _value_cols(self):
        if self.selection is not None:
            return list(self.selection)
        return [c for c in self.df._cols if c not in [k for k in self.keys if not isinstance(k, Series)]]

    def _finish(self, cols, data):
        idx = self._index()
        res = DataFrame._build(cols, data, idx)
        if not self.as_index:
            res = res.reset_index()
        return res

    def _reduce(self, how, numeric_only=False, cols=None):
        cols = cols if cols is not None else self._value_cols()
        numeric = [c for c in cols if self.df._dts[c] in ('int64', 'float64', 'bool')]
        if how in ('mean', 'median', 'std', 'var') or numeric_only:
            cols = numeric
        data = {}
        for c in cols:
            col = self.df._data[c]
            data[c] = [_agg_series([col[i] for i in self.groups_pos[k]], how, c) for k in self.order]
        return self._finish(cols, data)

    def mean(self, numeric_only=True): return self._reduce('mean', numeric_only)
    def median(self, numeric_only=True): return self._reduce('median', numeric_only)
    def std(self, numeric_only=True): return self._reduce('std', numeric_only)
    def var(self, numeric_only=True): return self._reduce('var', numeric_only)
    def sum(self, numeric_only=False): return self._reduce('sum', numeric_only)
    def min(self, numeric_only=False): return self._reduce('min', numeric_only)
    def max(self, numeric_only=False): return self._reduce('max', numeric_only)
    def count(self): return self._reduce('count')
    def nunique(self): return self._reduce('nunique')

    def first(self):
        return self._pick(0)

    def last(self):
        return self._pick(-1)

    def _pick(self, which):
        cols = self._value_cols()
        data = {c: [self.df._data[c][self.groups_pos[k][which]] for k in self.order] for c in cols}
        return self._finish(cols, data)

    def size(self):
        vals = [len(self.groups_pos[k]) for k in self.order]
        if self.as_index:
            return Series(vals, index=self._index())
        return DataFrame._build(list(self.names) + ['size'], dict({n: [k[i] for k in self.order] for i, n in enumerate(self.names)}, size=vals), _range_index(len(vals)))

    def agg(self, func=None, **named):
        cols = self._value_cols()
        if named:
            data = {}
            for out, (c, how) in named.items():
                col = self.df._data[c]
                data[out] = [_agg_series([col[i] for i in self.groups_pos[k]], how, c) for k in self.order]
            return self._finish(list(named), data)
        if isinstance(func, dict):
            data = {}
            for c, how in func.items():
                if isinstance(how, (list, tuple)):
                    raise NotImplementedError('varias funciones por columna (columnas MultiIndex) no están soportadas; usa agg(nombre=(columna, función))')
                col = self.df._data[c]
                data[c] = [_agg_series([col[i] for i in self.groups_pos[k]], how, c) for k in self.order]
            return self._finish(list(func), data)
        if isinstance(func, (list, tuple)):
            raise NotImplementedError('varias funciones (columnas MultiIndex) no están soportadas; usa agg(nombre=(columna, función))')
        return self._reduce(func if isinstance(func, str) else func, False)

    aggregate = agg

    def apply(self, func):
        results = [func(self.df._rows(self.groups_pos[k])) for k in self.order]
        if results and isinstance(results[0], DataFrame):
            parts = results
            return concat(parts)
        if results and isinstance(results[0], Series):
            return DataFrame(results, index=self._index())
        return Series(results, index=self._index())

    def transform(self, func):
        n = len(self.df.index)
        cols = self._value_cols()
        data = {c: [nan] * n for c in cols}
        for k in self.order:
            pos = self.groups_pos[k]
            for c in cols:
                sub = Series([self.df._data[c][i] for i in pos], name=c)
                r = getattr(sub, func)() if isinstance(func, str) else func(sub)
                vals = r._d if isinstance(r, Series) else [r] * len(pos)
                for i, v in zip(pos, vals):
                    data[c][i] = v
        return DataFrame._build(cols, data, self.df.index)

    def filter(self, func):
        keep = []
        for k in self.order:
            if func(self.df._rows(self.groups_pos[k])):
                keep.extend(self.groups_pos[k])
        return self.df._rows(sorted(keep))

    def head(self, n=5):
        keep = []
        for k in self.order:
            keep.extend(self.groups_pos[k][:n])
        return self.df._rows(sorted(keep))

    def describe(self):
        raise NotImplementedError('GroupBy.describe no está soportado')


class SeriesGroupBy:
    def __init__(self, gb, col):
        self.gb = gb
        self.col = col

    def _vals(self, k):
        col = self.gb.df._data[self.col]
        return [col[i] for i in self.gb.groups_pos[k]]

    def _wrap(self, vals):
        gb = self.gb
        s = Series(vals, index=gb._index(), name=self.col)
        if not gb.as_index:
            return s.reset_index()
        return s

    def _how(self, how):
        return self._wrap([_agg_series(self._vals(k), how, self.col) for k in self.gb.order])

    def mean(self): return self._how('mean')
    def median(self): return self._how('median')
    def std(self): return self._how('std')
    def var(self): return self._how('var')
    def sum(self): return self._how('sum')
    def min(self): return self._how('min')
    def max(self): return self._how('max')
    def count(self): return self._how('count')
    def nunique(self): return self._how('nunique')
    def first(self): return self._wrap([self._vals(k)[0] for k in self.gb.order])
    def last(self): return self._wrap([self._vals(k)[-1] for k in self.gb.order])
    def size(self): return self._wrap([len(self._vals(k)) for k in self.gb.order])

    def agg(self, func):
        if isinstance(func, (list, tuple)):
            names = [f if isinstance(f, str) else f.__name__ for f in func]
            return DataFrame({n: [_agg_series(self._vals(k), f, self.col) for k in self.gb.order] for n, f in zip(names, func)}, index=self.gb._index())
        if isinstance(func, dict):
            return DataFrame({n: [_agg_series(self._vals(k), f, self.col) for k in self.gb.order] for n, f in func.items()}, index=self.gb._index())
        return self._how(func)

    aggregate = agg

    def apply(self, func):
        return self._wrap([func(Series(self._vals(k), name=self.col)) for k in self.gb.order])

    def transform(self, func):
        n = len(self.gb.df.index)
        out = [nan] * n
        for k in self.gb.order:
            pos = self.gb.groups_pos[k]
            sub = Series(self._vals(k), name=self.col)
            r = getattr(sub, func)() if isinstance(func, str) else func(sub)
            vals = r._d if isinstance(r, Series) else [r] * len(pos)
            for i, v in zip(pos, vals):
                out[i] = v
        return Series(out, index=self.gb.df.index, name=self.col)

    def value_counts(self):
        raise NotImplementedError('SeriesGroupBy.value_counts no está soportado')

    def __iter__(self):
        for k in self.gb.order:
            yield (k[0] if len(k) == 1 else k), Series(self._vals(k), name=self.col)


# ───────────────────────── unir y apilar ─────────────────────────

def _key_of(df, cols, i):
    return tuple(df._data[c][i] for c in cols)


def merge(left, right, how='inner', on=None, left_on=None, right_on=None, suffixes=('_x', '_y'), left_index=False, right_index=False):
    if isinstance(right, Series):
        right = right.to_frame()
    if on is None and left_on is None and not left_index:
        common = [c for c in left._cols if c in right._data]
        if not common:
            raise ValueError('No common columns to perform merge on.')
        on = common
    lcols = [on] if isinstance(on, str) else (list(on) if on is not None else None)
    lk = lcols if lcols is not None else ([left_on] if isinstance(left_on, str) else list(left_on or []))
    rk = lcols if lcols is not None else ([right_on] if isinstance(right_on, str) else list(right_on or []))
    # claves por posición (se admite el índice como clave)
    def keys(df, cols, use_index):
        if use_index and not cols:
            return [(v,) for v in df.index._l]
        return [_key_of(df, cols, i) for i in range(len(df.index))]
    lkeys = keys(left, lk, left_index)
    rkeys = keys(right, rk, right_index)
    rmap = {}
    for j, k in enumerate(rkeys):
        rmap.setdefault(k, []).append(j)
    pairs = []
    matched_r = set()
    if how == 'right':
        lmap = {}
        for i, k in enumerate(lkeys):
            lmap.setdefault(k, []).append(i)
        for j, k in enumerate(rkeys):
            ms = lmap.get(k, [])
            if ms:
                for i in ms:
                    pairs.append((i, j))
            else:
                pairs.append((None, j))
    else:
        for i, k in enumerate(lkeys):
            ms = rmap.get(k, [])
            if ms:
                for j in ms:
                    pairs.append((i, j))
                    matched_r.add(j)
            elif how in ('left', 'outer'):
                pairs.append((i, None))
        if how == 'outer':
            for j in range(len(rkeys)):
                if j not in matched_r:
                    pairs.append((None, j))
            def kk(p):
                k = lkeys[p[0]] if p[0] is not None else rkeys[p[1]]
                return k
            pairs = sorted(pairs, key=cmp_to_key(lambda a, b: _cmp_key(kk(a), kk(b))))
    same_names = lcols is not None
    out_cols = []
    data = {}
    lnames = {c: c for c in left._cols}
    overlap = [c for c in right._cols if c in left._data and not (same_names and c in lk)]
    for c in left._cols:
        name = c + suffixes[0] if c in overlap and isinstance(c, str) else c
        out_cols.append(name)
        if same_names and c in lk:
            ri = rk[lk.index(c)]
            data[name] = [left._data[c][i] if i is not None else right._data[ri][j] for i, j in pairs]
        else:
            data[name] = [left._data[c][i] if i is not None else nan for i, j in pairs]
    for c in right._cols:
        if same_names and c in rk:
            continue
        name = c + suffixes[1] if c in overlap and isinstance(c, str) else c
        out_cols.append(name)
        data[name] = [right._data[c][j] if j is not None else nan for i, j in pairs]
    return DataFrame._build(out_cols, data, _range_index(len(pairs)))


def concat(objs, axis=0, ignore_index=False, join='outer', keys=None):
    objs = list(objs.values()) if isinstance(objs, dict) else list(objs)
    objs = [o for o in objs if o is not None]
    if not objs:
        raise ValueError('No objects to concatenate')
    if axis in (1, 'columns'):
        idx_labels = []
        for o in objs:
            for k in o.index._l:
                if k not in idx_labels:
                    idx_labels.append(k)
        same = all(o.index._l == objs[0].index._l for o in objs)
        idx = objs[0].index if same else Index(idx_labels)
        cols, data = [], {}
        for k, o in enumerate(objs):
            frame = o.to_frame() if isinstance(o, Series) else o
            for c in frame._cols:
                name = c if not isinstance(o, Series) or o.name is not None else k
                if isinstance(o, Series) and o.name is None:
                    name = k
                d = dict(zip(frame.index._l, frame._data[c]))
                cols.append(name)
                data[name] = frame._data[c] if same else [d.get(l, nan) for l in idx._l]
        return DataFrame._build(cols, data, idx)
    if all(isinstance(o, Series) for o in objs):
        vals = []
        labs = []
        for o in objs:
            vals.extend(o._d)
            labs.extend(o.index._l)
        name = objs[0].name if all(o.name == objs[0].name for o in objs) else None
        return Series(vals, index=_range_index(len(vals)) if ignore_index else Index(labs), name=name)
    frames = [o.to_frame().T if isinstance(o, Series) else o for o in objs]
    cols = []
    for f in frames:
        for c in f._cols:
            if c not in cols:
                cols.append(c)
    if join == 'inner':
        cols = [c for c in cols if all(c in f._data for f in frames)]
    data = {c: [] for c in cols}
    labels = []
    for f in frames:
        for c in cols:
            data[c].extend(f._data[c] if c in f._data else [nan] * len(f.index))
        labels.extend(f.index._l)
    idx = _range_index(len(labels)) if ignore_index else Index(labels)
    return DataFrame._build(cols, data, idx)


# ───────────────────────── funciones de nivel de módulo ─────────────────────────

def isna(obj):
    if isinstance(obj, (Series, DataFrame)):
        return obj.isna()
    if isinstance(obj, (list, tuple, np.ndarray)):
        return np.array([_isna(v) for v in (obj.tolist() if isinstance(obj, np.ndarray) else obj)])
    return _isna(obj)


isnull = isna


def notna(obj):
    r = isna(obj)
    if isinstance(r, (Series, DataFrame)):
        return obj.notna()
    if isinstance(r, np.ndarray):
        return ~r
    return not r


notnull = notna


def to_numeric(arg, errors='raise'):
    def conv(v):
        if _isna(v):
            return nan
        if isinstance(v, (int, float)):
            return v
        try:
            f = float(v)
            return int(f) if ('.' not in str(v) and 'e' not in str(v).lower()) else f
        except (ValueError, TypeError):
            if errors == 'coerce':
                return nan
            raise ValueError('Unable to parse string "%s"' % v)
    if isinstance(arg, Series):
        return arg._new([conv(v) for v in arg._d])
    if isinstance(arg, (list, tuple, np.ndarray)):
        return np.array([conv(v) for v in arg])
    return conv(arg)


def factorize(values, sort=False):
    vals = values._d if isinstance(values, Series) else (values.tolist() if isinstance(values, np.ndarray) else list(values))
    uniq = _unique([v for v in vals if not _isna(v)])
    if sort:
        uniq = _sorted_labels(uniq)
    m = {u: i for i, u in enumerate(uniq)}
    codes = np.array([m[v] if not _isna(v) else -1 for v in vals])
    return codes, Index(uniq)


def get_dummies(data, prefix=None, prefix_sep='_', columns=None, drop_first=False, dtype=None, dummy_na=False):
    def conv(flag):
        if dtype is None or dtype is bool:
            return bool(flag)
        return dtype(flag) if callable(dtype) else (int(flag) if 'int' in str(dtype) else float(flag))

    def encode(vals, pre):
        cats = _sorted_labels(_unique([v for v in vals if not _isna(v)]))
        if drop_first:
            cats = cats[1:]
        out = {}
        for c in cats:
            name = '%s%s%s' % (pre, prefix_sep, c) if pre is not None else c
            out[name] = [conv(v == c) for v in vals]
        return out
    if isinstance(data, Series):
        enc = encode(data._d, prefix)
        return DataFrame._build(list(enc), enc, data.index)
    if isinstance(data, (list, tuple, np.ndarray)):
        data = Series(data)
        enc = encode(data._d, prefix)
        return DataFrame._build(list(enc), enc, data.index)
    cols = columns if columns is not None else [c for c in data._cols if data._dts[c] in ('str', 'object')]
    out_cols = [c for c in data._cols if c not in cols]
    store = {c: data._data[c] for c in out_cols}
    for c in cols:
        pre = prefix[cols.index(c)] if isinstance(prefix, list) else (prefix.get(c, c) if isinstance(prefix, dict) else (prefix if prefix is not None else c))
        enc = encode(data._data[c], pre)
        for k, v in enc.items():
            out_cols.append(k)
            store[k] = v
    return DataFrame._build(out_cols, store, data.index)


def _fmt_edge(v):
    r = round(float(v), 3)
    return str(int(r)) if r == int(r) else str(r)


def cut(x, bins, right=True, labels=None, include_lowest=False, precision=3):
    vals = x._d if isinstance(x, Series) else (x.tolist() if isinstance(x, np.ndarray) else list(x))
    if isinstance(bins, int):
        mn, mx = min(_nums(vals)), max(_nums(vals))
        rng = mx - mn
        edges = [mn + rng * i / bins for i in range(bins + 1)]
        edges[0] = mn - rng * 0.001
        edges[-1] = mx + rng * 0.001 if right else edges[-1]
        if not right:
            edges[0] = mn
            edges[-1] = mx + rng * 0.001
        edges = [float(e) for e in edges]
    else:
        edges = [float(b) for b in bins]
    nb = len(edges) - 1
    if labels is None:
        names = []
        for i in range(nb):
            a, b = _fmt_edge(edges[i]), _fmt_edge(edges[i + 1])
            names.append(('(%s, %s]' if right else '[%s, %s)') % (a, b))
            if include_lowest and i == 0 and right:
                names[0] = '[%s, %s]' % (a, b)
    elif labels is False:
        names = list(range(nb))
    else:
        names = list(labels)
    out = []
    for v in vals:
        k = nan
        if not _isna(v):
            for i in range(nb):
                lo, hi = edges[i], edges[i + 1]
                if right:
                    inside = lo < v <= hi or (include_lowest and i == 0 and v == lo)
                else:
                    inside = lo <= v < hi or (include_lowest and i == nb - 1 and v == hi)
                if inside:
                    k = names[i]
                    break
        out.append(k)
    if isinstance(x, Series):
        return Series(out, index=x.index, name=x.name)
    return Series(out)


def qcut(x, q, labels=None, duplicates='raise'):
    vals = x._d if isinstance(x, Series) else list(x)
    s = sorted(_nums(vals))
    qs = [i / q for i in range(q + 1)] if isinstance(q, int) else list(q)
    edges = [_quantile(s, p) for p in qs]
    edges[0] = edges[0] - (edges[-1] - edges[0]) * 0.001 if False else edges[0]
    r = cut(vals, [edges[0] - 1e-9] + edges[1:], labels=labels)
    return Series(r._d, index=x.index if isinstance(x, Series) else None, name=x.name if isinstance(x, Series) else None)


def pivot_table(data, values=None, index=None, columns=None, aggfunc='mean', fill_value=None):
    idx = index if isinstance(index, str) else index[0]
    if values is None:
        values = [c for c in data._cols if c not in ([idx] + ([columns] if columns else [])) and data._dts[c] in ('int64', 'float64')]
    vals = values if isinstance(values, list) else [values]
    rows = _sorted_labels(_unique(data._data[idx]))
    if columns is None:
        d = {}
        for v in vals:
            col = []
            for r in rows:
                col.append(_agg_series([data._data[v][i] for i in range(len(data.index)) if data._data[idx][i] == r], aggfunc))
            d[v] = col
        return DataFrame._build(vals, d, Index(rows, idx))
    cats = _sorted_labels(_unique(data._data[columns]))
    d = {}
    for cat in cats:
        col = []
        for r in rows:
            sel = [data._data[vals[0]][i] for i in range(len(data.index)) if data._data[idx][i] == r and data._data[columns][i] == cat]
            col.append(_agg_series(sel, aggfunc) if sel else nan)
        d[cat] = col
    res = DataFrame._build(cats, d, Index(rows, idx), columns)
    if fill_value is not None:
        res = res.fillna(fill_value)
    return res


def crosstab(index, columns, normalize=False):
    a = index if isinstance(index, Series) else Series(index)
    b = columns if isinstance(columns, Series) else Series(columns)
    rows = _sorted_labels(_unique(a._d))
    cats = _sorted_labels(_unique(b._d))
    d = {c: [sum(1 for x, y in zip(a._d, b._d) if x == r and y == c) for r in rows] for c in cats}
    res = DataFrame._build(cats, d, Index(rows, a.name if a.name is not None else 'row_0'), b.name if b.name is not None else 'col_0')
    if normalize in (True, 'all'):
        t = sum(sum(v) for v in d.values())
        res = res / t
    elif normalize == 'index':
        tot = [sum(d[c][i] for c in cats) for i in range(len(rows))]
        res = DataFrame._build(cats, {c: [d[c][i] / tot[i] for i in range(len(rows))] for c in cats}, res.index, res._colname)
    elif normalize == 'columns':
        res = DataFrame._build(cats, {c: [v / sum(d[c]) for v in d[c]] for c in cats}, res.index, res._colname)
    return res


# ───────────────────────── lectura de CSV ─────────────────────────

def _convert_col(raw, na_values):
    vals = [nan if (v in na_values) else v for v in raw]
    present = [v for v in vals if not (isinstance(v, float) and v != v)]
    if present and all(v in ('True', 'False') for v in present):
        return [nan if (isinstance(v, float)) else v == 'True' for v in vals]
    try:
        ints = [int(v) if not (isinstance(v, float)) else nan for v in vals]
        if not any(isinstance(v, float) for v in ints):
            return ints
        return [float(v) for v in ints]
    except ValueError:
        pass
    try:
        return [float(v) if not isinstance(v, float) else v for v in vals]
    except ValueError:
        return vals


def read_csv(filepath_or_buffer, sep=',', header='infer', names=None, index_col=None, usecols=None, dtype=None, nrows=None, skiprows=None, na_values=None, delimiter=None, parse_dates=None, encoding=None, comment=None, skipinitialspace=False):
    import csv
    if hasattr(filepath_or_buffer, 'read'):
        text = filepath_or_buffer.read()
    elif isinstance(filepath_or_buffer, str) and '\n' in filepath_or_buffer and not filepath_or_buffer.endswith(('.csv', '.txt')):
        text = filepath_or_buffer
    else:
        with open(filepath_or_buffer) as f:
            text = f.read()
    sep = delimiter or sep
    lines = text.splitlines()
    if isinstance(skiprows, int):
        lines = lines[skiprows:]
    rows = [r for r in csv.reader(lines, delimiter=sep, skipinitialspace=skipinitialspace) if r]
    if comment:
        rows = [r for r in rows if not r[0].startswith(comment)]
    nas = set(_NA_STRINGS)
    if na_values:
        nas |= set(na_values if isinstance(na_values, (list, set, tuple)) else [na_values])
    if header is None or names is not None and header == 'infer' and False:
        head = list(names) if names else list(range(len(rows[0]) if rows else 0))
        body = rows
    elif names is not None:
        head = list(names)
        body = rows[1:] if header in ('infer', 0) else rows
    else:
        head = rows[0] if rows else []
        body = rows[1:]
    if nrows is not None:
        body = body[:nrows]
    cols = {}
    for j, h in enumerate(head):
        cols[h] = _convert_col([r[j] if j < len(r) else '' for r in body], nas)
    if usecols is not None:
        keep = [c for c in head if c in usecols or head.index(c) in usecols]
        cols = {c: cols[c] for c in keep}
    if dtype:
        for c in list(cols):
            t = dtype.get(c) if isinstance(dtype, dict) else dtype
            if t is not None:
                cols[c] = Series(cols[c]).astype(t)._d
    df = DataFrame(cols)
    if index_col is not None:
        df = df.set_index(head[index_col] if isinstance(index_col, int) else index_col)
    return df


def read_json(path_or_buf, orient=None):
    import json
    data = json.loads(path_or_buf.read() if hasattr(path_or_buf, 'read') else (open(path_or_buf).read() if not path_or_buf.lstrip().startswith(('[', '{')) else path_or_buf))
    return DataFrame(data)


def date_range(*a, **k):
    raise NotImplementedError('Las fechas (to_datetime, date_range) no están soportadas en este pandas en miniatura')


to_datetime = date_range


class Categorical:
    def __new__(cls, values, categories=None, ordered=False):
        return Series(values, dtype='str')


Timestamp = None
DatetimeIndex = None
MultiIndex = Index
