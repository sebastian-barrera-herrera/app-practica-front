"""PyTorch en miniatura: tensores con autograd sobre NumPy, capas, optimizadores y cargadores de datos."""
import builtins as _b
import math
import numpy as np

__version__ = '2.5.0+mini'

# ───────────────────────── tipos de dato ─────────────────────────


class dtype:
    def __init__(self, name, np_dtype, floating=False):
        self.name = name
        self.np = np_dtype
        self.is_floating_point = floating

    def __repr__(self):
        return 'torch.' + self.name


float32 = dtype('float32', np.float64, True)
float64 = dtype('float64', np.float64, True)
float16 = dtype('float16', np.float64, True)
int64 = dtype('int64', np.int64)
int32 = dtype('int32', np.int64)
bool = dtype('bool', np.bool_)
long = int64
float = float32
double = float64
half = float16
int = int32

_py_bool = _b.bool
_py_int = _b.int
_py_float = _b.float

_default_dtype = float32


def get_default_dtype():
    return _default_dtype


def set_default_dtype(d):
    global _default_dtype
    _default_dtype = d


# ───────────────────────── semilla y estado del autograd ─────────────────────────

_rng = np.random.RandomState(0)
_grad_enabled = [True]


def manual_seed(seed):
    global _rng
    _rng = np.random.RandomState(seed)
    return Generator(seed)


def seed():
    return 0


class Generator:
    def __init__(self, seed=0):
        self.seed_ = seed

    def manual_seed(self, seed):
        manual_seed(seed)
        return self

    def initial_seed(self):
        return self.seed_


class no_grad:
    def __enter__(self):
        self.prev = _grad_enabled[0]
        _grad_enabled[0] = False
        return self

    def __exit__(self, *a):
        _grad_enabled[0] = self.prev
        return False

    def __call__(self, fn):
        def wrapper(*args, **kw):
            with no_grad():
                return fn(*args, **kw)
        return wrapper


class enable_grad(no_grad):
    def __enter__(self):
        self.prev = _grad_enabled[0]
        _grad_enabled[0] = True
        return self


class set_grad_enabled:
    def __init__(self, mode):
        self.prev = _grad_enabled[0]
        _grad_enabled[0] = mode

    def __enter__(self):
        return self

    def __exit__(self, *a):
        _grad_enabled[0] = self.prev
        return False


def is_grad_enabled():
    return _grad_enabled[0]


inference_mode = no_grad

# ───────────────────────── impresión como PyTorch ─────────────────────────


def _fmt_all(a, floating):
    """Devuelve (lista de cadenas, ancho) como hace torch."""
    flat = a.ravel().tolist()
    if not floating:
        if a.dtype == np.bool_:
            strs = [('True' if v else 'False') for v in flat]
        else:
            strs = [str(_py_int(v)) for v in flat]
        w = _b.max([len(s) for s in strs] + [0])
        return strs, w
    fin = [_b.abs(v) for v in flat if v == v and _b.abs(v) != math.inf]
    nz = [v for v in fin if v != 0]
    mx = _b.max(nz) if nz else 0.0
    mn = _b.min(nz) if nz else 0.0
    int_mode = all(v == round(v) for v in flat if v == v and _b.abs(v) != math.inf)
    strs = []
    if int_mode:
        sci = mx > 1e8
        for v in flat:
            if v != v:
                strs.append('nan')
            elif _b.abs(v) == math.inf:
                strs.append('inf' if v > 0 else '-inf')
            else:
                strs.append(('%.4e' % v) if sci else ('%.0f.' % v))
    else:
        sci = bool_(mx / mn > 1000.0 or mx > 1e8 or mn < 1e-4) if nz else False
        for v in flat:
            if v != v:
                strs.append('nan')
            elif _b.abs(v) == math.inf:
                strs.append('inf' if v > 0 else '-inf')
            else:
                strs.append(('%.4e' % v) if sci else ('%.4f' % v))
    w = _b.max([len(s) for s in strs] + [0])
    return strs, w


def bool_(x):
    return True if x else False


def _tensor_str(a, floating, indent):
    strs, w = _fmt_all(a, floating)
    pos = [0]
    summarize = a.size > 1000

    def val():
        s = strs[pos[0]]
        pos[0] += 1
        return s.rjust(w)

    def build(sub_shape, ind, idx_prefix):
        dim = len(sub_shape)
        if dim == 0:
            return val()
        if dim == 1:
            n = sub_shape[0]
            vals = [val() for _ in range(n)]
            if summarize and n > 6:
                vals = vals[:3] + ['...'] + vals[-3:]
            el = w + 2
            per_line = _b.max(1, (80 - ind) // el)
            lines = [', '.join(vals[i:i + per_line]) for i in range(0, len(vals), per_line)]
            return '[' + (',\n' + ' ' * (ind + 1)).join(lines) + ']'
        parts = []
        n = sub_shape[0]
        for i in range(n):
            parts.append(build(sub_shape[1:], ind + 1, idx_prefix))
        if summarize and n > 6:
            parts = parts[:3] + ['...'] + parts[-3:]
        return '[' + (',' + '\n' * (dim - 1) + ' ' * (ind + 1)).join(parts) + ']'

    return build(list(a.shape), indent, ())


# ───────────────────────── el tensor ─────────────────────────


def _unbroadcast(g, shape):
    if g.shape == tuple(shape):
        return g
    while g.ndim > len(shape):
        g = g.sum(axis=0)
    for i, s in enumerate(shape):
        if s == 1 and g.shape[i] != 1:
            g = g.sum(axis=i, keepdims=True)
    return g.reshape(shape)


def _as_np(x, dt=None):
    if isinstance(x, Tensor):
        return x._a
    return np.asarray(x)


def _infer_dtype(arr):
    k = arr.dtype.kind
    if k == 'b':
        return bool
    if k in 'iu':
        return int64
    return _default_dtype


class Tensor:
    __array_priority__ = 100

    def __init__(self, data=None, dtype=None, requires_grad=False):
        a = np.asarray(data._a if isinstance(data, Tensor) else data)
        dt = dtype or _infer_dtype(a)
        if dt.is_floating_point:
            a = a.astype(np.float64)
        elif dt is bool:
            a = a.astype(np.bool_)
        else:
            a = a.astype(np.int64)
        self._a = a
        self._dtype = dt
        self.requires_grad = requires_grad
        self.grad = None
        self._parents = ()
        self._backward_fn = None
        self._name = None

    # --- construcción interna
    @staticmethod
    def _wrap(a, dt=None, parents=(), name=None, fn=None):
        t = Tensor.__new__(Tensor)
        a = np.asarray(a)
        t._dtype = dt or _infer_dtype(a)
        t._a = a if (t._dtype.is_floating_point and a.dtype == np.float64) or (not t._dtype.is_floating_point and a.dtype != np.float64) else (a.astype(np.float64) if t._dtype.is_floating_point else a)
        t.grad = None
        t.requires_grad = False
        t._parents = ()
        t._backward_fn = None
        t._name = None
        if _grad_enabled[0] and parents and any(p.requires_grad for p in parents) and t._dtype.is_floating_point:
            t.requires_grad = True
            t._parents = parents
            t._backward_fn = fn
            t._name = name
        return t

    # --- propiedades
    @property
    def dtype(self):
        return self._dtype

    @property
    def shape(self):
        return Size(self._a.shape)

    @property
    def ndim(self):
        return self._a.ndim

    @property
    def data(self):
        t = Tensor._wrap(self._a, self._dtype)
        return t

    @data.setter
    def data(self, v):
        self._a = v._a if isinstance(v, Tensor) else np.asarray(v)

    @property
    def grad_fn(self):
        return _GradFn(self._name) if self._name else None

    @property
    def is_leaf(self):
        return self._backward_fn is None

    @property
    def T(self):
        return self.transpose(0, 1) if self.ndim == 2 else self.permute(*reversed(range(self.ndim)))

    @property
    def mT(self):
        return self.transpose(-2, -1)

    @property
    def device(self):
        return device('cpu')

    def size(self, dim=None):
        return Size(self._a.shape) if dim is None else self._a.shape[dim]

    def dim(self):
        return self._a.ndim

    def numel(self):
        return self._a.size

    def __len__(self):
        return self._a.shape[0]

    def item(self):
        if self._a.size != 1:
            raise RuntimeError('a Tensor with %d elements cannot be converted to Scalar' % self._a.size)
        v = self._a.ravel()[0]
        return _py_float(v) if self._dtype.is_floating_point else (_py_bool(v) if self._dtype is bool else _py_int(v))

    def tolist(self):
        return self._a.tolist()

    def numpy(self):
        return self._a

    def __array__(self, dtype=None):
        return self._a

    def __float__(self):
        return _py_float(self.item())

    def __int__(self):
        return _py_int(self.item())

    def __bool__(self):
        return _py_bool(self.item())

    def __index__(self):
        return _py_int(self.item())

    def to(self, *args, **kw):
        for a in args:
            if isinstance(a, dtype):
                return self.type(a)
        if 'dtype' in kw and kw['dtype'] is not None:
            return self.type(kw['dtype'])
        return self

    def cpu(self):
        return self

    def cuda(self):
        return self

    def type(self, dt=None):
        if dt is None:
            return 'torch.FloatTensor' if self._dtype.is_floating_point else 'torch.LongTensor'
        if dt.is_floating_point:
            return Tensor._wrap(self._a.astype(np.float64), dt, (self,), 'ToCopyBackward0', lambda g: (g,)) if self._dtype.is_floating_point else Tensor._wrap(self._a.astype(np.float64), dt)
        if dt is bool:
            return Tensor._wrap(self._a.astype(np.bool_), bool)
        return Tensor._wrap(self._a.astype(np.int64), dt)

    def float(self):
        return self.type(float32)

    def double(self):
        return self.type(float64)

    def long(self):
        return self.type(int64)

    def int(self):
        return self.type(int32)

    def bool(self):
        return self.type(bool)

    def half(self):
        return self.type(float32)

    def detach(self):
        return Tensor._wrap(self._a, self._dtype)

    def detach_(self):
        self._parents = ()
        self._backward_fn = None
        self._name = None
        self.requires_grad = False
        return self

    def clone(self):
        return Tensor._wrap(self._a.copy(), self._dtype, (self,), 'CloneBackward0', lambda g: (g,))

    def requires_grad_(self, flag=True):
        self.requires_grad = flag
        return self

    def retain_grad(self):
        self._retain = True

    _retain = False
    _hooks = ()

    def register_hook(self, fn):
        if not self.requires_grad:
            raise RuntimeError("cannot register a hook on a tensor that doesn't require gradient")
        if not isinstance(self._hooks, list):
            self._hooks = []
        self._hooks.append(fn)

        class _Handle:
            def remove(h):
                if fn in self._hooks:
                    self._hooks.remove(fn)
        return _Handle()

    # --- autograd
    def backward(self, gradient=None, retain_graph=None, create_graph=False, inputs=None):
        if not self.requires_grad:
            raise RuntimeError('element 0 of tensors does not require grad and does not have a grad_fn')
        if gradient is None:
            if self._a.size != 1:
                raise RuntimeError('grad can be implicitly created only for scalar outputs')
            g0 = np.ones_like(self._a)
        else:
            g0 = _as_np(gradient).astype(np.float64)
        _backprop(self, g0, True, None)

    # --- repr
    def __repr__(self):
        a = self._a
        floating = self._dtype.is_floating_point
        s = _tensor_str(a, floating, 7)
        extra = ''
        if self._backward_fn is not None:
            extra += ', grad_fn=<%s>' % self._name
        elif self.requires_grad:
            extra += ', requires_grad=True'
        if self._dtype not in (float32, int64, bool):
            extra = ', dtype=%r' % self._dtype + extra
        return 'tensor(' + s + extra + ')'

    __str__ = __repr__

    # --- aritmética
    def _bin(self, other, name, fa, fb, op):
        o = other if isinstance(other, Tensor) else None
        oa = o._a if o is not None else np.asarray(other)
        res = op(self._a, oa)
        floating = res.dtype.kind == 'f' or self._dtype.is_floating_point or (o is not None and o._dtype.is_floating_point)
        dt = (self._dtype if self._dtype.is_floating_point else (o._dtype if (o is not None and o._dtype.is_floating_point) else (float32 if res.dtype.kind == 'f' else self._dtype)))
        if res.dtype.kind == 'b':
            dt = bool
        parents = (self, o) if o is not None else (self,)
        if o is None:
            return Tensor._wrap(res, dt, parents, name, lambda g: (fa(g, self._a, oa),))
        return Tensor._wrap(res, dt, parents, name, lambda g: (fa(g, self._a, oa), fb(g, self._a, oa)))

    def __add__(self, o):
        return self._bin(o, 'AddBackward0', lambda g, a, b: g, lambda g, a, b: g, lambda a, b: a + b)

    __radd__ = __add__

    def __sub__(self, o):
        return self._bin(o, 'SubBackward0', lambda g, a, b: g, lambda g, a, b: -g, lambda a, b: a - b)

    def __rsub__(self, o):
        return (-self) + o if not isinstance(o, Tensor) else o - self

    def __mul__(self, o):
        return self._bin(o, 'MulBackward0', lambda g, a, b: g * b, lambda g, a, b: g * a, lambda a, b: a * b)

    __rmul__ = __mul__

    def __truediv__(self, o):
        return self._bin(o, 'DivBackward0', lambda g, a, b: g / b, lambda g, a, b: -g * a / (b * b), lambda a, b: a / b)

    def __rtruediv__(self, o):
        return tensor(o, dtype=self._dtype) / self

    def __floordiv__(self, o):
        return Tensor._wrap(self._a // _as_np(o), self._dtype)

    def __mod__(self, o):
        return Tensor._wrap(self._a % _as_np(o), self._dtype)

    def __neg__(self):
        return Tensor._wrap(-self._a, self._dtype, (self,), 'NegBackward0', lambda g: (-g,))

    def __pos__(self):
        return self

    def __abs__(self):
        return self.abs()

    def __pow__(self, e):
        if isinstance(e, Tensor):
            res = self._a ** e._a
            return Tensor._wrap(res, self._dtype, (self, e), 'PowBackward1', lambda g: (g * e._a * self._a ** (e._a - 1), g * res * np.log(np.where(self._a > 0, self._a, 1.0))))
        res = self._a ** e
        return Tensor._wrap(res, self._dtype, (self,), 'PowBackward0', lambda g: (g * e * self._a ** (e - 1),))

    def __rpow__(self, b):
        res = b ** self._a
        return Tensor._wrap(res, self._dtype, (self,), 'PowBackward1', lambda g: (g * res * math.log(b),))

    def __matmul__(self, o):
        return matmul(self, o)

    def __rmatmul__(self, o):
        return matmul(o, self)

    # --- comparaciones (sin gradiente)
    def __eq__(self, o):
        return Tensor._wrap(self._a == _as_np(o), bool)

    def __ne__(self, o):
        return Tensor._wrap(self._a != _as_np(o), bool)

    def __lt__(self, o):
        return Tensor._wrap(self._a < _as_np(o), bool)

    def __le__(self, o):
        return Tensor._wrap(self._a <= _as_np(o), bool)

    def __gt__(self, o):
        return Tensor._wrap(self._a > _as_np(o), bool)

    def __ge__(self, o):
        return Tensor._wrap(self._a >= _as_np(o), bool)

    __hash__ = object.__hash__

    def __and__(self, o):
        return Tensor._wrap(np.logical_and(self._a, _as_np(o)), bool)

    def __or__(self, o):
        return Tensor._wrap(np.logical_or(self._a, _as_np(o)), bool)

    def __invert__(self):
        return Tensor._wrap(np.logical_not(self._a), bool)

    def eq(self, o):
        return self == o

    def ne(self, o):
        return self != o

    def lt(self, o):
        return self < o

    def gt(self, o):
        return self > o

    def le(self, o):
        return self <= o

    def ge(self, o):
        return self >= o

    # --- operaciones in situ
    def _inplace_check(self):
        if _grad_enabled[0] and self.requires_grad and self._backward_fn is None:
            raise RuntimeError('a leaf Variable that requires grad is being used in an in-place operation.')

    def _set(self, res):
        self._inplace_check()
        self._a[...] = res
        return self

    def add_(self, o, alpha=1):
        return self._set(self._a + alpha * _as_np(o))

    def sub_(self, o, alpha=1):
        return self._set(self._a - alpha * _as_np(o))

    def mul_(self, o):
        return self._set(self._a * _as_np(o))

    def div_(self, o):
        return self._set(self._a / _as_np(o))

    def __iadd__(self, o):
        return self.add_(o)

    def __isub__(self, o):
        return self.sub_(o)

    def __imul__(self, o):
        return self.mul_(o)

    def __itruediv__(self, o):
        return self.div_(o)

    def zero_(self):
        return self._set(0.0)

    def fill_(self, v):
        return self._set(v)

    def copy_(self, o):
        return self._set(_as_np(o))

    def clamp_(self, min=None, max=None):
        return self._set(np.clip(self._a, min, max))

    def uniform_(self, a=0.0, b=1.0):
        return self._set(_rng.uniform(a, b, self._a.shape))

    def normal_(self, mean=0.0, std=1.0):
        return self._set(_rng.normal(mean, std, self._a.shape))

    def sqrt_(self):
        return self._set(np.sqrt(self._a))

    # --- funciones elementales
    def _un(self, name, fwd, bwd):
        res = fwd(self._a)
        dt = self._dtype if self._dtype.is_floating_point else float32
        return Tensor._wrap(res, dt, (self,), name, lambda g: (bwd(g, self._a, res),))

    def exp(self):
        return self._un('ExpBackward0', np.exp, lambda g, a, r: g * r)

    def log(self):
        return self._un('LogBackward0', np.log, lambda g, a, r: g / a)

    def log2(self):
        return self._un('Log2Backward0', np.log2, lambda g, a, r: g / (a * math.log(2)))

    def sqrt(self):
        return self._un('SqrtBackward0', np.sqrt, lambda g, a, r: g / (2 * r))

    def rsqrt(self):
        return self._un('RsqrtBackward0', lambda a: 1 / np.sqrt(a), lambda g, a, r: -0.5 * g * r ** 3)

    def square(self):
        return self._un('PowBackward0', lambda a: a * a, lambda g, a, r: 2 * g * a)

    def abs(self):
        return self._un('AbsBackward0', np.abs, lambda g, a, r: g * np.sign(a))

    def sign(self):
        return Tensor._wrap(np.sign(self._a), self._dtype)

    def sin(self):
        return self._un('SinBackward0', np.sin, lambda g, a, r: g * np.cos(a))

    def cos(self):
        return self._un('CosBackward0', np.cos, lambda g, a, r: -g * np.sin(a))

    def tanh(self):
        return self._un('TanhBackward0', np.tanh, lambda g, a, r: g * (1 - r * r))

    def sigmoid(self):
        return self._un('SigmoidBackward0', lambda a: 1.0 / (1.0 + np.exp(-a)), lambda g, a, r: g * r * (1 - r))

    def relu(self):
        return self._un('ReluBackward0', lambda a: np.maximum(a, 0), lambda g, a, r: g * (a > 0))

    def leaky_relu(self, negative_slope=0.01):
        return self._un('LeakyReluBackward0', lambda a: np.where(a > 0, a, negative_slope * a), lambda g, a, r: g * np.where(a > 0, 1.0, negative_slope))

    def gelu(self):
        c = math.sqrt(2 / math.pi)
        return self._un('GeluBackward0', lambda a: 0.5 * a * (1 + np.tanh(c * (a + 0.044715 * a ** 3))), lambda g, a, r: g * (0.5 * (1 + np.tanh(c * (a + 0.044715 * a ** 3))) + 0.5 * a * (1 - np.tanh(c * (a + 0.044715 * a ** 3)) ** 2) * c * (1 + 3 * 0.044715 * a * a)))

    def softplus(self):
        return self._un('SoftplusBackward0', lambda a: np.logaddexp(0.0, a), lambda g, a, r: g / (1 + np.exp(-a)))

    def clamp(self, min=None, max=None):
        res = np.clip(self._a, min, max)
        return Tensor._wrap(res, self._dtype, (self,), 'ClampBackward1', lambda g: (g * ((self._a >= (min if min is not None else -np.inf)) & (self._a <= (max if max is not None else np.inf))),))

    clip = clamp

    def pow(self, e):
        return self ** e

    def softmax(self, dim=-1):
        return softmax(self, dim)

    def log_softmax(self, dim=-1):
        return log_softmax(self, dim)

    # --- reducciones
    def _norm_dim(self, dim):
        if dim is None:
            return None
        if isinstance(dim, (list, tuple)):
            return tuple(d % self._a.ndim for d in dim)
        return dim % self._a.ndim

    def sum(self, dim=None, keepdim=False, dtype=None):
        d = self._norm_dim(dim)
        res = self._a.sum(axis=d, keepdims=keepdim)
        dt = self._dtype if self._dtype.is_floating_point else int64

        def bwd(g):
            g = np.asarray(g)
            if d is not None and not keepdim:
                g = np.expand_dims(g, d)
            return (np.broadcast_to(g, self._a.shape),)
        return Tensor._wrap(res, dt, (self,), 'SumBackward0' if dim is None else 'SumBackward1', bwd)

    def mean(self, dim=None, keepdim=False):
        d = self._norm_dim(dim)
        res = self._a.mean(axis=d, keepdims=keepdim)
        n = self._a.size if d is None else (np.prod([self._a.shape[i] for i in (d if isinstance(d, tuple) else (d,))]))

        def bwd(g):
            g = np.asarray(g)
            if d is not None and not keepdim:
                g = np.expand_dims(g, d)
            return (np.broadcast_to(g, self._a.shape) / n,)
        return Tensor._wrap(res, self._dtype if self._dtype.is_floating_point else float32, (self,), 'MeanBackward0' if dim is None else 'MeanBackward1', bwd)

    def var(self, dim=None, unbiased=True, keepdim=False, correction=None):
        d = self._norm_dim(dim)
        ddof = 1 if (unbiased if correction is None else correction) else 0
        m = self.mean(dim, keepdim=True)
        n = self._a.size if d is None else np.prod([self._a.shape[i] for i in (d if isinstance(d, tuple) else (d,))])
        return ((self - m) ** 2).sum(dim, keepdim=keepdim) / (n - ddof)

    def std(self, dim=None, unbiased=True, keepdim=False, correction=None):
        return self.var(dim, unbiased, keepdim, correction).sqrt()

    def prod(self, dim=None, keepdim=False):
        d = self._norm_dim(dim)
        res = self._a.prod(axis=d, keepdims=keepdim)
        a = self._a

        def bwd(g):
            if d is None:
                x = a.reshape(-1)
                gg = np.asarray(g).reshape(())
                n = x.shape[0]
                out = np.zeros(n)
                for i in range(n):
                    out[i] = np.prod(np.concatenate([x[:i], x[i + 1:]])) if n > 1 else 1.0
                return (gg * out.reshape(a.shape),)
            ax = d if isinstance(d, _py_int) else d[0]
            m = np.moveaxis(a, ax, 0)
            n = m.shape[0]
            out = np.zeros(m.shape)
            for i in range(n):
                rest = np.delete(m, i, axis=0)
                out[i] = rest.prod(axis=0) if n > 1 else 1.0
            gg = g if keepdim else np.expand_dims(g, ax)
            return (np.moveaxis(out, 0, ax) * gg,)
        return Tensor._wrap(res, self._dtype, (self,), 'ProdBackward0', bwd)

    def norm(self, p=2, dim=None, keepdim=False):
        if p == 1:
            return self.abs().sum(dim, keepdim)
        return (self * self).sum(dim, keepdim).sqrt()

    def max(self, dim=None, keepdim=False):
        if dim is None:
            res = self._a.max()
            mask = (self._a == res)
            return Tensor._wrap(res, self._dtype, (self,), 'MaxBackward1', lambda g: (g * mask / mask.sum(),))
        if isinstance(dim, Tensor):
            return maximum(self, dim)
        d = dim % self._a.ndim
        idx = self._a.argmax(axis=d)
        vals = np.take_along_axis(self._a, np.expand_dims(idx, d), axis=d)
        if not keepdim:
            vals = np.squeeze(vals, axis=d)
        sel = Tensor._wrap(vals, self._dtype, (self,), 'MaxBackward0', lambda g: (_scatter(self._a.shape, d, idx, g, keepdim),))
        return _MinMax(sel, Tensor._wrap(idx if keepdim is False else np.expand_dims(idx, d), int64))

    def min(self, dim=None, keepdim=False):
        if dim is None:
            res = self._a.min()
            mask = (self._a == res)
            return Tensor._wrap(res, self._dtype, (self,), 'MinBackward1', lambda g: (g * mask / mask.sum(),))
        if isinstance(dim, Tensor):
            return minimum(self, dim)
        d = dim % self._a.ndim
        idx = self._a.argmin(axis=d)
        vals = np.take_along_axis(self._a, np.expand_dims(idx, d), axis=d)
        if not keepdim:
            vals = np.squeeze(vals, axis=d)
        sel = Tensor._wrap(vals, self._dtype, (self,), 'MinBackward0', lambda g: (_scatter(self._a.shape, d, idx, g, keepdim),))
        return _MinMax(sel, Tensor._wrap(idx if keepdim is False else np.expand_dims(idx, d), int64))

    def argmax(self, dim=None, keepdim=False):
        if dim is None:
            return Tensor._wrap(self._a.argmax(), int64)
        r = self._a.argmax(axis=dim)
        return Tensor._wrap(np.expand_dims(r, dim) if keepdim else r, int64)

    def argmin(self, dim=None, keepdim=False):
        if dim is None:
            return Tensor._wrap(self._a.argmin(), int64)
        r = self._a.argmin(axis=dim)
        return Tensor._wrap(np.expand_dims(r, dim) if keepdim else r, int64)

    def all(self):
        return Tensor._wrap(self._a.all(), bool)

    def any(self):
        return Tensor._wrap(self._a.any(), bool)

    def topk(self, k, dim=-1):
        d = dim % self._a.ndim
        idx = np.argsort(-self._a, axis=d, kind='stable')
        idx = np.take(idx, np.arange(k), axis=d)
        it = Tensor._wrap(idx, int64)
        return _MinMax(self.gather(d, it), it)

    def sort(self, dim=-1, descending=False):
        d = dim % self._a.ndim
        idx = np.argsort(-self._a if descending else self._a, axis=d, kind='stable')
        it = Tensor._wrap(idx, int64)
        return _MinMax(self.gather(d, it), it)

    def cumsum(self, dim):
        return Tensor._wrap(np.cumsum(self._a, axis=dim), self._dtype, (self,), 'CumsumBackward0', lambda g: (np.flip(np.cumsum(np.flip(g, dim), axis=dim), dim),))

    # --- forma
    def reshape(self, *shape):
        if len(shape) == 1 and isinstance(shape[0], (tuple, list, Size)):
            shape = tuple(shape[0])
        old = self._a.shape
        return Tensor._wrap(self._a.reshape(shape), self._dtype, (self,), 'ViewBackward0', lambda g: (g.reshape(old),))

    view = reshape

    def view_as(self, o):
        return self.reshape(o.shape)

    def flatten(self, start_dim=0, end_dim=-1):
        nd = self._a.ndim
        if nd == 0:
            return self.reshape(1)
        s, e = start_dim % nd, end_dim % nd
        shape = list(self._a.shape[:s]) + [-1] + list(self._a.shape[e + 1:])
        return self.reshape(shape)

    def ravel(self):
        return self.reshape(-1)

    def unsqueeze(self, dim):
        d = dim % (self._a.ndim + 1)
        return self.reshape(list(self._a.shape[:d]) + [1] + list(self._a.shape[d:]))

    def squeeze(self, dim=None):
        if dim is None:
            return self.reshape([s for s in self._a.shape if s != 1])
        d = dim % self._a.ndim
        if self._a.shape[d] != 1:
            return self
        return self.reshape(list(self._a.shape[:d]) + list(self._a.shape[d + 1:]))

    def transpose(self, d0, d1):
        a = list(range(self._a.ndim))
        i, j = d0 % self._a.ndim, d1 % self._a.ndim
        a[i], a[j] = a[j], a[i]
        return self.permute(*a)

    def permute(self, *dims):
        if len(dims) == 1 and isinstance(dims[0], (tuple, list)):
            dims = tuple(dims[0])
        dims = tuple(d % self._a.ndim for d in dims)
        inv = [0] * len(dims)
        for i, d in enumerate(dims):
            inv[d] = i
        return Tensor._wrap(self._a.transpose(dims), self._dtype, (self,), 'PermuteBackward0', lambda g: (g.transpose(inv),))

    def t(self):
        return self.T

    def contiguous(self):
        return self

    def expand(self, *shape):
        if len(shape) == 1 and isinstance(shape[0], (tuple, list)):
            shape = tuple(shape[0])
        shape = tuple(self._a.shape[i - (len(shape) - self._a.ndim)] if s == -1 else s for i, s in enumerate(shape))
        return Tensor._wrap(np.broadcast_to(self._a, shape), self._dtype, (self,), 'ExpandBackward0', lambda g: (g,))

    def repeat(self, *reps):
        if len(reps) == 1 and isinstance(reps[0], (tuple, list)):
            reps = tuple(reps[0])
        shape = self._a.shape
        pad = len(reps) - len(shape)
        full_shape = (1,) * pad + tuple(shape)
        res = np.tile(self._a, reps)

        def bwd(g):
            inter = []
            for r, n in zip(reps, full_shape):
                inter += [r, n]
            gg = np.asarray(g).reshape(inter)
            gg = gg.sum(axis=tuple(range(0, len(inter), 2)))
            return (gg.reshape(shape),)
        return Tensor._wrap(res, self._dtype, (self,), 'RepeatBackward0', bwd)

    def chunk(self, n, dim=0):
        total = self._a.shape[dim]
        size = -(-total // n)
        return self.split(size, dim)

    def split(self, size, dim=0):
        total = self._a.shape[dim]
        if isinstance(size, (list, tuple)):
            sizes = list(size)
        else:
            sizes = [size] * (total // size) + ([total % size] if total % size else [])
        parts = []
        start = 0
        for sz in sizes:
            parts.append(self.narrow(dim, start, sz))
            start += sz
        return tuple(parts)

    def masked_fill(self, mask, value):
        m = _as_np(mask).astype(np.bool_)
        return Tensor._wrap(np.where(m, value, self._a), self._dtype, (self,), 'MaskedFillBackward0', lambda g: (g * ~m,))

    def index_select(self, dim, index):
        idx = _as_np(index)
        return Tensor._wrap(np.take(self._a, idx, axis=dim), self._dtype, (self,), 'IndexSelectBackward0', lambda g: (_take_back(self._a.shape, dim, idx, g),))

    def gather(self, dim, index):
        idx = _as_np(index)
        res = np.take_along_axis(self._a, idx, axis=dim)
        return Tensor._wrap(res, self._dtype, (self,), 'GatherBackward0', lambda g: (_gather_back(self._a.shape, dim, idx, g),))

    def matmul(self, o):
        return matmul(self, o)

    def mm(self, o):
        return matmul(self, o)

    def dot(self, o):
        return matmul(self, o)

    def __getitem__(self, idx):
        i = _conv_index(idx)
        res = self._a[i]
        shape = self._a.shape

        def bwd(g):
            out = np.zeros(shape)
            if _has_int_array(i):
                np.add.at(out, i, g)
            else:
                out[i] = g
            return (out,)
        return Tensor._wrap(res, self._dtype, (self,), 'SelectBackward0' if isinstance(idx, _py_int) else 'IndexBackward0', bwd)

    def __setitem__(self, idx, v):
        self._inplace_check()
        self._a[_conv_index(idx)] = _as_np(v)

    def __iter__(self):
        for k in range(self._a.shape[0]):
            yield self[k]

    def __deepcopy__(self, memo=None):
        t = Tensor._wrap(self._a.copy(), self._dtype)
        t.requires_grad = self.requires_grad
        return t

    def apply_(self, fn):
        self._a[...] = np.vectorize(fn)(self._a)
        return self


def _backprop(root, g0, accumulate, wanted):
    order = []
    seen = set()
    stack = [(root, False)]
    while stack:
        node, done = stack.pop()
        if done:
            order.append(node)
            continue
        if id(node) in seen:
            continue
        seen.add(id(node))
        stack.append((node, True))
        for p in node._parents:
            if p.requires_grad and id(p) not in seen:
                stack.append((p, False))
    grads = {id(root): g0}
    found = {}
    for node in reversed(order):
        g = grads.get(id(node))
        if g is None:
            continue
        for h in node._hooks:
            r = h(Tensor._wrap(g, node._dtype))
            if r is not None:
                g = r._a
        if wanted is not None and id(node) in wanted:
            found[id(node)] = g
        if node._backward_fn is None:
            if accumulate:
                node.grad = Tensor._wrap(g if node.grad is None else node.grad._a + g, node._dtype)
            continue
        if node._retain and accumulate:
            node.grad = Tensor._wrap(g if node.grad is None else node.grad._a + g, node._dtype)
        gs = node._backward_fn(g)
        for p, pg in zip(node._parents, gs):
            if pg is None or not p.requires_grad:
                continue
            pg = _unbroadcast(np.asarray(pg, dtype=np.float64), p._a.shape)
            grads[id(p)] = pg if id(p) not in grads else grads[id(p)] + pg
    return found


class _MinMax(tuple):
    def __new__(cls, values, indices):
        o = tuple.__new__(cls, (values, indices))
        o.values = values
        o.indices = indices
        return o


class _GradFn:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return '<%s object>' % self.name


class Size(tuple):
    def __repr__(self):
        return 'torch.Size([' + ', '.join(str(v) for v in self) + '])'

    def numel(self):
        n = 1
        for v in self:
            n *= v
        return n


class device:
    def __init__(self, t='cpu'):
        self.type = t

    def __repr__(self):
        return "device(type='%s')" % self.type


def _has_int_array(i):
    parts = i if isinstance(i, tuple) else (i,)
    only_arrays = True
    for p in parts:
        if isinstance(p, (np.ndarray, list)):
            a = np.asarray(p)
            if a.dtype != np.bool_ and a.dtype != bool:
                if len(parts) == 1:
                    return True
                only_arrays = False
    return False


def _conv_index(idx):
    if isinstance(idx, Tensor):
        return idx._a
    if isinstance(idx, tuple):
        return tuple(i._a if isinstance(i, Tensor) else i for i in idx)
    return idx


def _scatter(shape, d, idx, g, keepdim):
    out = np.zeros(shape)
    g = np.asarray(g)
    if not keepdim:
        g = np.expand_dims(g, d)
    ix = np.expand_dims(idx, d)
    np.put_along_axis(out, ix, g, axis=d)
    return out


def _take_back(shape, dim, idx, g):
    out = np.zeros(shape)
    moved = np.moveaxis(out, dim, 0)
    gm = np.moveaxis(g, dim, 0)
    np.add.at(moved, idx, gm)
    return out


def _gather_back(shape, dim, idx, g):
    out = np.zeros(shape)
    grid = np.indices(idx.shape)
    pos = list(grid)
    pos[dim] = idx
    np.add.at(out, tuple(pos), g)
    return out


# ───────────────────────── funciones de nivel superior ─────────────────────────


def tensor(data, dtype=None, requires_grad=False, device=None):
    return Tensor(data, dtype=dtype, requires_grad=requires_grad)


def as_tensor(data, dtype=None):
    return data if isinstance(data, Tensor) and dtype is None else Tensor(data, dtype=dtype)


def from_numpy(a):
    return Tensor._wrap(a, None)


def is_tensor(x):
    return isinstance(x, Tensor)


def numel(t):
    return t.numel()


def _shape_args(size):
    if len(size) == 1 and isinstance(size[0], (tuple, list, Size)):
        return tuple(size[0])
    return tuple(size)


def _mk(a, dtype, requires_grad):
    dt = dtype or (_default_dtype if a.dtype.kind == 'f' else _infer_dtype(a))
    t = Tensor._wrap(a, dt)
    t.requires_grad = requires_grad
    return t


def zeros(*size, dtype=None, requires_grad=False, device=None):
    return _mk(np.zeros(_shape_args(size)), dtype or _default_dtype, requires_grad)


def ones(*size, dtype=None, requires_grad=False, device=None):
    return _mk(np.ones(_shape_args(size)), dtype or _default_dtype, requires_grad)


def full(size, fill_value, dtype=None, requires_grad=False):
    a = np.full(tuple(size), fill_value)
    return _mk(a, dtype, requires_grad)


def eye(n, m=None, dtype=None, requires_grad=False):
    return _mk(np.eye(n, m), dtype or _default_dtype, requires_grad)


def zeros_like(t, dtype=None):
    return _mk(np.zeros_like(t._a), dtype or t._dtype, False)


def ones_like(t, dtype=None):
    return _mk(np.ones_like(t._a), dtype or t._dtype, False)


def full_like(t, v):
    return _mk(np.full_like(t._a, v), t._dtype, False)


def rand(*size, dtype=None, requires_grad=False, generator=None):
    return _mk(_rng.uniform(0, 1, _shape_args(size)), dtype or _default_dtype, requires_grad)


def randn(*size, dtype=None, requires_grad=False, generator=None):
    return _mk(_rng.standard_normal(_shape_args(size)), dtype or _default_dtype, requires_grad)


def rand_like(t):
    return rand(*t.shape)


def randn_like(t):
    return randn(*t.shape)


def randint(low, high=None, size=None, dtype=None):
    if size is None:
        size, high = high, None
    if high is None:
        low, high = 0, low
    return _mk(_rng.randint(low, high, tuple(size)), int64, False)


def randperm(n):
    return _mk(_rng.permutation(n), int64, False)


def normal(mean, std, size=None):
    if size is not None:
        return _mk(_rng.normal(mean, std, tuple(size)), _default_dtype, False)
    m = _as_np(mean)
    return _mk(_rng.normal(m, _as_np(std)), _default_dtype, False)


def bernoulli(p):
    pa = _as_np(p)
    return _mk((_rng.uniform(0, 1, pa.shape) < pa).astype(np.float64), _default_dtype, False)


def multinomial(probs, num_samples, replacement=False):
    p = _as_np(probs)
    if p.ndim == 1:
        return _mk(_rng.choice(len(p), size=num_samples, replace=replacement, p=p / p.sum()), int64, False)
    return _mk(np.stack([_rng.choice(p.shape[1], size=num_samples, replace=replacement, p=r / r.sum()) for r in p]), int64, False)


def arange(start, end=None, step=1, dtype=None, requires_grad=False):
    if end is None:
        start, end = 0, start
    a = np.arange(start, end, step)
    return _mk(a, dtype, requires_grad)


def linspace(start, end, steps, dtype=None, requires_grad=False):
    return _mk(np.linspace(start, end, steps), dtype or _default_dtype, requires_grad)


def cat(tensors, dim=0):
    arrs = [t._a for t in tensors]
    res = np.concatenate(arrs, axis=dim)
    sizes = [a.shape[dim] for a in arrs]
    dt = tensors[0]._dtype

    def bwd(g):
        out = []
        pos = 0
        for s in sizes:
            out.append(np.take(g, np.arange(pos, pos + s), axis=dim))
            pos += s
        return tuple(out)
    return Tensor._wrap(res, dt, tuple(tensors), 'CatBackward0', bwd)


concat = cat


def stack(tensors, dim=0):
    ts = [t.unsqueeze(dim) for t in tensors]
    return cat(ts, dim)


def matmul(a, b):
    a = a if isinstance(a, Tensor) else tensor(a)
    b = b if isinstance(b, Tensor) else tensor(b)
    res = np.matmul(a._a, b._a)

    def bwd(g):
        ga = np.matmul(g, np.swapaxes(b._a, -1, -2)) if b._a.ndim > 1 else np.multiply.outer(g, b._a) if a._a.ndim > 1 else g * b._a
        gb = np.matmul(np.swapaxes(a._a, -1, -2), g) if a._a.ndim > 1 else (np.multiply.outer(a._a, g) if b._a.ndim > 1 else g * a._a)
        if a._a.ndim > 1 and b._a.ndim == 1:
            ga = np.multiply.outer(g, b._a)
            gb = np.matmul(np.swapaxes(a._a, -1, -2), g)
        return (ga, gb)
    nm = 'MmBackward0' if a._a.ndim == 2 and b._a.ndim == 2 else ('DotBackward0' if a._a.ndim == 1 and b._a.ndim == 1 else 'MvBackward0' if b._a.ndim == 1 else 'BmmBackward0')
    return Tensor._wrap(res, a._dtype if a._dtype.is_floating_point else b._dtype, (a, b), nm, bwd)


mm = matmul
bmm = matmul
dot = matmul
mv = matmul


def where(cond, x, y):
    c = _as_np(cond).astype(np.bool_)
    xa = x if isinstance(x, Tensor) else tensor(x, dtype=float32)
    ya = y if isinstance(y, Tensor) else tensor(y, dtype=float32)
    return Tensor._wrap(np.where(c, xa._a, ya._a), xa._dtype, (xa, ya), 'WhereBackward0', lambda g: (g * c, g * ~c))


def maximum(a, b):
    ta = a if isinstance(a, Tensor) else tensor(a, dtype=float32)
    tb = b if isinstance(b, Tensor) else tensor(b, dtype=float32)
    return where(ta >= tb, ta, tb)


def minimum(a, b):
    ta = a if isinstance(a, Tensor) else tensor(a, dtype=float32)
    tb = b if isinstance(b, Tensor) else tensor(b, dtype=float32)
    return where(ta <= tb, ta, tb)


def softmax(x, dim=-1):
    d = dim % x._a.ndim
    e = np.exp(x._a - x._a.max(axis=d, keepdims=True))
    r = e / e.sum(axis=d, keepdims=True)
    return Tensor._wrap(r, x._dtype if x._dtype.is_floating_point else float32, (x,), 'SoftmaxBackward0', lambda g: (r * (g - (g * r).sum(axis=d, keepdims=True)),))


def log_softmax(x, dim=-1):
    d = dim % x._a.ndim
    sh = x._a - x._a.max(axis=d, keepdims=True)
    lse = np.log(np.exp(sh).sum(axis=d, keepdims=True))
    r = sh - lse
    return Tensor._wrap(r, x._dtype if x._dtype.is_floating_point else float32, (x,), 'LogSoftmaxBackward0', lambda g: (g - np.exp(r) * g.sum(axis=d, keepdims=True),))


def _un_fn(name):
    def f(x):
        return getattr(x, name)()
    f.__name__ = name
    return f


exp = _un_fn('exp')
log = _un_fn('log')
sqrt = _un_fn('sqrt')
tanh = _un_fn('tanh')
sigmoid = _un_fn('sigmoid')
relu = _un_fn('relu')
abs = _un_fn('abs')
sin = _un_fn('sin')
cos = _un_fn('cos')
square = _un_fn('square')
sign = _un_fn('sign')
log2 = _un_fn('log2')
rsqrt = _un_fn('rsqrt')


def sum(x, dim=None, keepdim=False):
    return x.sum(dim, keepdim)


def mean(x, dim=None, keepdim=False):
    return x.mean(dim, keepdim)


def std(x, dim=None, unbiased=True, keepdim=False):
    return x.std(dim, unbiased, keepdim)


def var(x, dim=None, unbiased=True, keepdim=False):
    return x.var(dim, unbiased, keepdim)


def max(x, dim=None, keepdim=False):
    return x.max(dim, keepdim)


def min(x, dim=None, keepdim=False):
    return x.min(dim, keepdim)


def argmax(x, dim=None, keepdim=False):
    return x.argmax(dim, keepdim)


def argmin(x, dim=None, keepdim=False):
    return x.argmin(dim, keepdim)


def clamp(x, min=None, max=None):
    return x.clamp(min, max)


def pow(x, e):
    return x ** e


def norm(x, p=2, dim=None):
    return x.norm(p, dim)


def flatten(x, start_dim=0, end_dim=-1):
    return x.flatten(start_dim, end_dim)


def reshape(x, shape):
    return x.reshape(shape)


def transpose(x, a, b):
    return x.transpose(a, b)


def squeeze(x, dim=None):
    return x.squeeze(dim)


def unsqueeze(x, dim):
    return x.unsqueeze(dim)


def allclose(a, b, rtol=1e-5, atol=1e-8):
    return _py_bool(np.allclose(_as_np(a), _as_np(b), rtol=rtol, atol=atol))


def equal(a, b):
    return _py_bool(np.array_equal(_as_np(a), _as_np(b)))


def outer(a, b):
    return Tensor._wrap(np.multiply.outer(a._a, b._a), a._dtype, (a, b), 'MulBackward0', lambda g: (g @ b._a, a._a @ g))


def tril(x, diagonal=0):
    return Tensor._wrap(np.tril(x._a, diagonal), x._dtype, (x,), 'TrilBackward0', lambda g: (np.tril(g, diagonal),))


def triu(x, diagonal=0):
    return Tensor._wrap(np.triu(x._a, diagonal), x._dtype, (x,), 'TriuBackward0', lambda g: (np.triu(g, diagonal),))


def cosine_similarity(a, b, dim=1, eps=1e-8):
    num = (a * b).sum(dim)
    den = (a * a).sum(dim).sqrt() * (b * b).sum(dim).sqrt()
    return num / den.clamp(min=eps)


def cdist(a, b, p=2.0):
    d = a.unsqueeze(1) - b.unsqueeze(0)
    return (d * d).sum(-1).sqrt()


def topk(x, k, dim=-1):
    return x.topk(k, dim)


def sort(x, dim=-1, descending=False):
    return x.sort(dim, descending)


def cumsum(x, dim):
    return x.cumsum(dim)


def einsum(eq, *ops):
    res = np.einsum(eq, *[o._a for o in ops])
    return Tensor._wrap(res, ops[0]._dtype)


def save(obj, f):
    import pickle
    return None


def load(f):
    return None


def set_printoptions(precision=4, **kw):
    return None


def get_num_threads():
    return 1


class _Cuda:
    @staticmethod
    def is_available():
        return False

    @staticmethod
    def device_count():
        return 0


cuda = _Cuda()


class _Backends:
    class mps:
        @staticmethod
        def is_available():
            return False


backends = _Backends()


# ───────────────────────── extensión de la API ─────────────────────────


def _def(name):
    def deco(fn):
        setattr(Tensor, name, fn)
        return fn
    return deco


@_def('add')
def _t_add(self, other, alpha=1):
    return self + (other * alpha if alpha != 1 else other)


@_def('sub')
def _t_sub(self, other, alpha=1):
    return self - (other * alpha if alpha != 1 else other)


@_def('mul')
def _t_mul(self, other):
    return self * other


@_def('div')
def _t_div(self, other, rounding_mode=None):
    if rounding_mode is None:
        return self / other
    q = self._a / _as_np(other)
    res = np.floor(q) if rounding_mode == 'floor' else np.where(q < 0, np.ceil(q), np.floor(q))
    if not self._dtype.is_floating_point and not (isinstance(other, Tensor) and other._dtype.is_floating_point) and not isinstance(other, _py_float):
        res = res.astype(np.int64)
        return Tensor._wrap(res, self._dtype)
    return Tensor._wrap(res, self._dtype if self._dtype.is_floating_point else float32)


Tensor.true_divide = Tensor.div
Tensor.multiply = Tensor.mul
Tensor.divide = Tensor.div
Tensor.subtract = Tensor.sub
Tensor.neg = Tensor.__neg__
Tensor.negative = Tensor.__neg__
Tensor.absolute = Tensor.abs


def _nodiff(name, fn):
    def f(self):
        return self._un(name, fn, lambda g, a, r: g * 0.0)
    return f


Tensor.floor = _nodiff('FloorBackward0', np.floor)
Tensor.ceil = _nodiff('CeilBackward0', np.ceil)
Tensor.trunc = _nodiff('TruncBackward0', lambda a: np.where(a < 0, np.ceil(a), np.floor(a)))


@_def('round')
def _t_round(self, decimals=0):
    return self._un('RoundBackward0', lambda a: np.round(a, decimals), lambda g, a, r: g * 0.0)


def _unary(name, bname, fwd, bwd):
    setattr(Tensor, name, lambda self: self._un(bname, fwd, bwd))


_unary('reciprocal', 'ReciprocalBackward0', lambda a: 1.0 / a, lambda g, a, r: -g * r * r)
_unary('log10', 'Log10Backward0', np.log10, lambda g, a, r: g / (a * math.log(10)))
_unary('log1p', 'Log1PBackward0', lambda a: np.log(1.0 + a), lambda g, a, r: g / (1.0 + a))
_unary('expm1', 'Expm1Backward0', lambda a: np.exp(a) - 1.0, lambda g, a, r: g * (r + 1.0))
_unary('exp2', 'Exp2Backward0', lambda a: np.exp(a * math.log(2)), lambda g, a, r: g * r * math.log(2))
_unary('tan', 'TanBackward0', np.tan, lambda g, a, r: g * (1 + r * r))
_unary('asin', 'AsinBackward0', np.arcsin, lambda g, a, r: g / np.sqrt(1 - a * a))
_unary('acos', 'AcosBackward0', np.arccos, lambda g, a, r: -g / np.sqrt(1 - a * a))
_unary('atan', 'AtanBackward0', np.arctan, lambda g, a, r: g / (1 + a * a))
_unary('sinh', 'SinhBackward0', np.sinh, lambda g, a, r: g * np.cosh(a))
_unary('cosh', 'CoshBackward0', np.cosh, lambda g, a, r: g * np.sinh(a))
_unary('erf', 'ErfBackward0', np.vectorize(math.erf), lambda g, a, r: g * (2 / math.sqrt(math.pi)) * np.exp(-a * a))
Tensor.arcsin = Tensor.asin
Tensor.arccos = Tensor.acos
Tensor.arctan = Tensor.atan


@_def('isnan')
def _t_isnan(self):
    return Tensor._wrap(np.isnan(self._a), bool)


@_def('isinf')
def _t_isinf(self):
    return Tensor._wrap(np.isinf(self._a), bool)


@_def('isfinite')
def _t_isfinite(self):
    return Tensor._wrap(np.isfinite(self._a), bool)


@_def('logical_and')
def _t_land(self, o):
    return Tensor._wrap(np.logical_and(self._a != 0, _as_np(o) != 0), bool)


@_def('logical_or')
def _t_lor(self, o):
    return Tensor._wrap(np.logical_or(self._a != 0, _as_np(o) != 0), bool)


@_def('logical_not')
def _t_lnot(self):
    return Tensor._wrap(np.logical_not(self._a != 0), bool)


@_def('argsort')
def _t_argsort(self, dim=-1, descending=False):
    a = -self._a if descending else self._a
    return Tensor._wrap(np.argsort(a, axis=dim, kind='stable'), int64)


@_def('unique')
def _t_unique(self, sorted=True, return_inverse=False, return_counts=False, dim=None):
    r = np.unique(self._a, return_inverse=return_inverse, return_counts=return_counts)
    if not (return_inverse or return_counts):
        return Tensor._wrap(r, self._dtype)
    out = [Tensor._wrap(r[0], self._dtype)]
    k = 1
    if return_inverse:
        out.append(Tensor._wrap(np.asarray(r[k]).reshape(self._a.shape), int64))
        k += 1
    if return_counts:
        out.append(Tensor._wrap(r[k], int64))
    return tuple(out)


@_def('diag')
def _t_diag(self, diagonal=0):
    res = np.diag(self._a, diagonal)
    return Tensor._wrap(res, self._dtype, (self,), 'DiagBackward0', lambda g: (np.diag(g, diagonal),))


@_def('diagonal')
def _t_diagonal(self, offset=0, dim1=0, dim2=1):
    res = np.diagonal(self._a, offset, dim1, dim2)
    shape = self._a.shape

    def bwd(g):
        out = np.zeros(shape)
        n = res.shape[-1]
        for k in range(n):
            r = k if offset >= 0 else k - offset
            c = k + offset if offset >= 0 else k
            out[r, c] = g[k]
        return (out,)
    return Tensor._wrap(res, self._dtype, (self,), 'DiagonalBackward0', bwd)


@_def('trace')
def _t_trace(self):
    return self.diagonal().sum()


@_def('expand_as')
def _t_expand_as(self, o):
    return self.expand(*o.shape)


@_def('flip')
def _t_flip(self, *dims):
    if len(dims) == 1 and isinstance(dims[0], (tuple, list)):
        dims = tuple(dims[0])
    res = self._a
    for d in dims:
        res = np.flip(res, d)
    return Tensor._wrap(np.ascontiguousarray(res), self._dtype, (self,), 'FlipBackward0', lambda g: (_flip_np(g, dims),))


def _flip_np(g, dims):
    for d in dims:
        g = np.flip(g, d)
    return g


@_def('roll')
def _t_roll(self, shifts, dims=None):
    res = np.roll(self._a, shifts, axis=dims) if dims is not None else np.roll(self._a.ravel(), shifts).reshape(self._a.shape)
    neg = (-shifts if isinstance(shifts, _py_int) else tuple(-s for s in shifts))
    return Tensor._wrap(res, self._dtype, (self,), 'RollBackward0', lambda g: (np.roll(g, neg, axis=dims) if dims is not None else np.roll(g.ravel(), neg).reshape(g.shape),))


@_def('narrow')
def _t_narrow(self, dim, start, length):
    idx = [slice(None)] * self._a.ndim
    idx[dim] = slice(start, start + length)
    return self[tuple(idx)]


@_def('ndimension')
def _t_ndimension(self):
    return self._a.ndim


@_def('nelement')
def _t_nelement(self):
    return self._a.size


@_def('is_floating_point')
def _t_isfp(self):
    return self._dtype.is_floating_point


@_def('element_size')
def _t_esize(self):
    return {'float32': 4, 'float64': 8, 'float16': 2, 'int64': 8, 'int32': 4, 'bool': 1}.get(self._dtype.name, 4)


@_def('clamp_min')
def _t_clamp_min(self, m):
    return self.clamp(min=m)


@_def('clamp_max')
def _t_clamp_max(self, m):
    return self.clamp(max=m)


@_def('masked_fill_')
def _t_masked_fill_(self, mask, value):
    return self._set(np.where(_as_np(mask).astype(np.bool_), value, self._a))


def _scatter_np(a, dim, idx, src, add):
    out = a.copy()
    s = np.asarray(src, dtype=out.dtype) if not isinstance(src, (_py_int, _py_float)) else np.full(idx.shape, src, dtype=out.dtype)
    s = s[tuple(slice(0, n) for n in idx.shape)]
    pos = list(np.indices(idx.shape))
    pos[dim] = idx
    if add:
        np.add.at(out, tuple(pos), s)
    else:
        out[tuple(pos)] = s
    return out


@_def('scatter')
def _t_scatter(self, dim, index, src=None, value=None, reduce=None):
    v = src if src is not None else value
    return Tensor._wrap(_scatter_np(self._a, dim, _as_np(index), v._a if isinstance(v, Tensor) else v, reduce == 'add'), self._dtype)


@_def('scatter_')
def _t_scatter_(self, dim, index, src=None, value=None, reduce=None):
    v = src if src is not None else value
    return self._set(_scatter_np(self._a, dim, _as_np(index), v._a if isinstance(v, Tensor) else v, reduce == 'add'))


@_def('scatter_add')
def _t_scatter_add(self, dim, index, src):
    return Tensor._wrap(_scatter_np(self._a, dim, _as_np(index), src._a, True), self._dtype)


@_def('scatter_add_')
def _t_scatter_add_(self, dim, index, src):
    return self._set(_scatter_np(self._a, dim, _as_np(index), src._a, True))


@_def('new_zeros')
def _t_new_zeros(self, *size, dtype=None, requires_grad=False):
    return zeros(*size, dtype=dtype or self._dtype, requires_grad=requires_grad)


@_def('new_ones')
def _t_new_ones(self, *size, dtype=None, requires_grad=False):
    return ones(*size, dtype=dtype or self._dtype, requires_grad=requires_grad)


@_def('new_full')
def _t_new_full(self, size, fill_value, dtype=None):
    return full(size, fill_value, dtype=dtype or self._dtype)


@_def('new_tensor')
def _t_new_tensor(self, data, dtype=None, requires_grad=False):
    return tensor(data, dtype=dtype or self._dtype, requires_grad=requires_grad)


@_def('new_empty')
def _t_new_empty(self, *size, dtype=None):
    return zeros(*size, dtype=dtype or self._dtype)


Tensor.abs_ = lambda self: self._set(np.abs(self._a))
Tensor.exp_ = lambda self: self._set(np.exp(self._a))
Tensor.log_ = lambda self: self._set(np.log(self._a))
Tensor.neg_ = lambda self: self._set(-self._a)
Tensor.pow_ = lambda self, e: self._set(self._a ** _as_np(e))
Tensor.relu_ = lambda self: self._set(np.maximum(self._a, 0))
Tensor.sigmoid_ = lambda self: self._set(1.0 / (1.0 + np.exp(-self._a)))
Tensor.tanh_ = lambda self: self._set(np.tanh(self._a))
Tensor.floor_ = lambda self: self._set(np.floor(self._a))
Tensor.round_ = lambda self: self._set(np.round(self._a))
Tensor.unsqueeze_ = lambda self, d: _reshape_inplace(self, np.expand_dims(self._a, d))
Tensor.squeeze_ = lambda self, d=None: _reshape_inplace(self, np.squeeze(self._a) if d is None else np.squeeze(self._a, d))


def _reshape_inplace(t, a):
    t._a = a
    return t


@_def('lerp')
def _t_lerp(self, end, weight):
    return self + (end - self) * weight


@_def('fill_diagonal_')
def _t_fill_diag_(self, v, wrap=False):
    self._inplace_check()
    np.fill_diagonal(self._a, v)
    return self


@_def('median')
def _t_median(self, dim=None, keepdim=False):
    if dim is None:
        flat = np.sort(self._a.ravel())
        return Tensor._wrap(flat[(flat.size - 1) // 2], self._dtype)
    order = np.argsort(self._a, axis=dim, kind='stable')
    k = (self._a.shape[dim] - 1) // 2
    idx = np.take(order, [k], axis=dim)
    vals = np.take_along_axis(self._a, idx, axis=dim)
    if not keepdim:
        idx = np.squeeze(idx, dim)
        vals = np.squeeze(vals, dim)
    return _MinMax(Tensor._wrap(vals, self._dtype), Tensor._wrap(idx, int64))


def _extreme(self, dim, keepdim, fn):
    if dim is None:
        axes = None
    else:
        axes = tuple(dim) if isinstance(dim, (tuple, list)) else (dim,)
    res = fn(self._a, axis=axes, keepdims=True)
    mask = (self._a == res).astype(np.float64)
    cnt = mask.sum(axis=axes, keepdims=True)
    out = res if keepdim else (np.squeeze(res) if axes is None else np.squeeze(res, axes))
    shape_k = res.shape

    def bwd(g):
        gg = np.asarray(g).reshape(shape_k) if (keepdim or axes is None or True) else g
        return (gg * mask / cnt,)
    return Tensor._wrap(out, self._dtype, (self,), 'AmaxBackward0', bwd)


@_def('amax')
def _t_amax(self, dim=None, keepdim=False):
    return _extreme(self, dim, keepdim, np.max)


@_def('amin')
def _t_amin(self, dim=None, keepdim=False):
    return _extreme(self, dim, keepdim, np.min)


@_def('nan_to_num')
def _t_nan_to_num(self, nan=0.0, posinf=None, neginf=None):
    big = 3.4028234663852886e38
    a = np.where(np.isnan(self._a), nan, self._a)
    a = np.where(a == np.inf, big if posinf is None else posinf, a)
    a = np.where(a == -np.inf, -big if neginf is None else neginf, a)
    return Tensor._wrap(a, self._dtype)


@_def('count_nonzero')
def _t_count_nonzero(self, dim=None):
    return Tensor._wrap((self._a != 0).astype(np.int64).sum(axis=dim), int64)


@_def('nonzero')
def _t_nonzero(self, as_tuple=False):
    idx = np.nonzero(self._a)
    if as_tuple:
        return tuple(Tensor._wrap(i, int64) for i in idx)
    return Tensor._wrap(np.stack(idx, axis=1), int64)


@_def('isclose')
def _t_isclose(self, o, rtol=1e-5, atol=1e-8):
    b = _as_np(o)
    return Tensor._wrap(np.abs(self._a - b) <= atol + rtol * np.abs(b), bool)


@_def('allclose')
def _t_allclose(self, o, rtol=1e-5, atol=1e-8):
    return _py_bool(np.all(np.abs(self._a - _as_np(o)) <= atol + rtol * np.abs(_as_np(o))))


@_def('logsumexp')
def _t_logsumexp(self, dim, keepdim=False):
    m = self.detach().amax(dim, keepdim=True)
    r = (self - m).exp().sum(dim, keepdim=True).log() + m
    if not keepdim:
        r = r.squeeze(dim) if isinstance(dim, _py_int) else r.reshape(*[s for i, s in enumerate(r.shape) if i not in [d % r.ndim for d in dim]])
    return r


Tensor.bmm = Tensor.matmul
Tensor.mv = Tensor.matmul


@_def('outer')
def _t_outer(self, o):
    return self.reshape(-1, 1) * o.reshape(1, -1)


Tensor.ger = Tensor.outer


@_def('addmm')
def _t_addmm(self, m1, m2, beta=1, alpha=1):
    return self * beta + (m1 @ m2) * alpha


@_def('unflatten')
def _t_unflatten(self, dim, sizes):
    d = dim % self._a.ndim
    return self.reshape(*(list(self._a.shape[:d]) + list(sizes) + list(self._a.shape[d + 1:])))


@_def('var_mean')
def _t_var_mean(self, dim=None, unbiased=True, keepdim=False):
    return (self.var(dim, unbiased=unbiased, keepdim=keepdim), self.mean(dim, keepdim=keepdim))


@_def('std_mean')
def _t_std_mean(self, dim=None, unbiased=True, keepdim=False):
    return (self.std(dim, unbiased=unbiased, keepdim=keepdim), self.mean(dim, keepdim=keepdim))


@_def('cumprod')
def _t_cumprod(self, dim):
    res = np.cumprod(self._a, axis=dim)

    def bwd(g):
        # g_i = sum_{j>=i} g_j * res_j / x_i  (válido si x_i != 0)
        rev = np.flip(np.cumsum(np.flip(g * res, dim), axis=dim), dim)
        return (rev / self._a,)
    return Tensor._wrap(res, self._dtype, (self,), 'CumprodBackward0', bwd)


# ── dtypes extra
int8 = dtype('int8', np.int64)
uint8 = dtype('uint8', np.int64)
int16 = dtype('int16', np.int64)
bfloat16 = dtype('bfloat16', np.float64, True)
short = int16


# ── funciones a nivel de módulo que delegan en el método del tensor
def _alias(name):
    def f(x, *a, **k):
        if not isinstance(x, Tensor):
            x = tensor(x)
        return getattr(x, name)(*a, **k)
    f.__name__ = name
    return f


add = _alias('add')
sub = _alias('sub')
subtract = sub
mul = _alias('mul')
multiply = mul
div = _alias('div')
divide = div
true_divide = div
neg = _alias('neg')
negative = neg
floor = _alias('floor')
ceil = _alias('ceil')
trunc = _alias('trunc')
round = _alias('round')
reciprocal = _alias('reciprocal')
log10 = _alias('log10')
log1p = _alias('log1p')
expm1 = _alias('expm1')
exp2 = _alias('exp2')
tan = _alias('tan')
asin = _alias('asin')
acos = _alias('acos')
atan = _alias('atan')
sinh = _alias('sinh')
cosh = _alias('cosh')
erf = _alias('erf')
isnan = _alias('isnan')
isinf = _alias('isinf')
isfinite = _alias('isfinite')
logical_and = _alias('logical_and')
logical_or = _alias('logical_or')
logical_not = _alias('logical_not')
permute = _alias('permute')
gather = _alias('gather')
index_select = _alias('index_select')
masked_fill = _alias('masked_fill')
prod = _alias('prod')
chunk = _alias('chunk')
split = _alias('split')
argsort = _alias('argsort')
unique = _alias('unique')
diag = _alias('diag')
diagonal = _alias('diagonal')
trace = _alias('trace')
flip = _alias('flip')
roll = _alias('roll')
narrow = _alias('narrow')
scatter = _alias('scatter')
scatter_add = _alias('scatter_add')
lerp = _alias('lerp')
median = _alias('median')
amax = _alias('amax')
amin = _alias('amin')
nan_to_num = _alias('nan_to_num')
count_nonzero = _alias('count_nonzero')
nonzero = _alias('nonzero')
isclose = _alias('isclose')
logsumexp = _alias('logsumexp')
var_mean = _alias('var_mean')
std_mean = _alias('std_mean')
cumprod = _alias('cumprod')
clone = _alias('clone')
detach = _alias('detach')
eq = _alias('eq')
ne = _alias('ne')
lt = _alias('lt')
le = _alias('le')
gt = _alias('gt')
ge = _alias('ge')
unflatten = _alias('unflatten')
clamp_min = _alias('clamp_min')
clamp_max = _alias('clamp_max')
negative = neg
square = _alias('square')


def empty(*size, dtype=None, requires_grad=False):
    return zeros(*size, dtype=dtype, requires_grad=requires_grad)


def empty_like(t, dtype=None):
    return zeros_like(t, dtype)


def cross(a, b, dim=-1):
    return Tensor._wrap(np.cross(a._a, b._a, axis=dim), a._dtype)


def tensordot(a, b, dims=2):
    return Tensor._wrap(np.tensordot(a._a, b._a, dims), a._dtype)


def baddbmm(inp, b1, b2, beta=1, alpha=1):
    return inp * beta + (b1 @ b2) * alpha


def addmm(inp, m1, m2, beta=1, alpha=1):
    return inp * beta + (m1 @ m2) * alpha


def initial_seed():
    return 0


def compile(model=None, *a, **k):
    return model


def result_type(a, b):
    return a._dtype if a._dtype.is_floating_point else b._dtype


def finfo(dt=None):
    class _F:
        eps = 1.1920928955078125e-07
        max = 3.4028234663852886e+38
        min = -3.4028234663852886e+38
        tiny = 1.1754943508222875e-38
    return _F()


from torch import autograd

from torch import nn, optim, utils
