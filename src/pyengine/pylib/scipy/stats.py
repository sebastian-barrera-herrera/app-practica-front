import math
import numbers
import numpy as np

from scipy.special import _betainc


def _rs(random_state):
    if random_state is None:
        return np.random.mtrand._rand if hasattr(np.random, 'mtrand') else np.random
    if isinstance(random_state, numbers.Integral):
        return np.random.RandomState(random_state)
    return random_state


def _ret(out):
    if np.ndim(out) == 0:
        return out if isinstance(out, int) else float(out)
    return out


def _ndtri(p):
    if p <= 0.0:
        return -math.inf if p == 0.0 else math.nan
    if p >= 1.0:
        return math.inf if p == 1.0 else math.nan
    q = p - 0.5
    if abs(q) <= 0.425:
        r = 0.180625 - q * q
        num = (((((((r * 2509.0809287301226727 + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)
        den = (((((((r * 5226.495278852545925 + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1.0)
        return q * num / den
    r = p if q < 0 else 1.0 - p
    r = math.sqrt(-math.log(r))
    if r <= 5.0:
        r -= 1.6
        num = (((((((r * 7.7454501427834140764e-4 + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734)
        den = (((((((r * 1.05075007164441684324e-9 + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1.0)
    else:
        r -= 5.0
        num = (((((((r * 2.01033439929228813265e-7 + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772)
        den = (((((((r * 2.04426310338993978564e-15 + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1.0)
    val = num / den
    return -val if q < 0 else val


class _Frozen:
    def __init__(self, dist, args, kwds):
        self.dist = dist
        self.args = args
        self.kwds = kwds

    def rvs(self, size=None, random_state=None):
        return self.dist.rvs(*self.args, size=size, random_state=random_state, **self.kwds)

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        f = getattr(self.dist, name)

        def call(*a, **k):
            kk = dict(self.kwds)
            kk.update(k)
            if name in _XFUNCS:
                return f(a[0], *self.args, **kk)
            return f(*self.args, **kk)
        return call


_XFUNCS = ('pdf', 'logpdf', 'cdf', 'sf', 'ppf', 'isf', 'pmf', 'logpmf', 'logcdf')


class _Dist:
    _n_shape = 0

    def __call__(self, *args, **kwds):
        return _Frozen(self, args, kwds)

    def _split(self, args, loc, scale):
        return args

    def rvs(self, *args, size=None, random_state=None, loc=0, scale=1):
        rs = _rs(random_state)
        shape = args[:self._n_shape]
        rest = args[self._n_shape:]
        if len(rest) >= 1:
            loc = rest[0]
        if len(rest) >= 2:
            scale = rest[1]
        return _ret(self._draw(rs, size, *shape) * scale + loc)

    def pdf(self, x, *args, loc=0, scale=1):
        shape, loc, scale = self._ls(args, loc, scale)
        z = (np.asarray(x, dtype=np.float64) - loc) / scale
        return _ret(self._pdf(z, *shape) / scale)

    def logpdf(self, x, *args, loc=0, scale=1):
        return _ret(np.log(self.pdf(x, *args, loc=loc, scale=scale)))

    def cdf(self, x, *args, loc=0, scale=1):
        shape, loc, scale = self._ls(args, loc, scale)
        z = (np.asarray(x, dtype=np.float64) - loc) / scale
        return _ret(self._cdf(z, *shape))

    def sf(self, x, *args, loc=0, scale=1):
        return _ret(1.0 - np.asarray(self.cdf(x, *args, loc=loc, scale=scale)))

    def ppf(self, q, *args, loc=0, scale=1):
        shape, loc, scale = self._ls(args, loc, scale)
        return _ret(self._ppf(np.asarray(q, dtype=np.float64), *shape) * scale + loc)

    def isf(self, q, *args, loc=0, scale=1):
        return self.ppf(1.0 - np.asarray(q, dtype=np.float64), *args, loc=loc, scale=scale)

    def _ls(self, args, loc, scale):
        shape = args[:self._n_shape]
        rest = args[self._n_shape:]
        if len(rest) >= 1:
            loc = rest[0]
        if len(rest) >= 2:
            scale = rest[1]
        return shape, loc, scale

    def interval(self, confidence, *args, loc=0, scale=1):
        a = (1.0 - confidence) / 2
        return self.ppf(a, *args, loc=loc, scale=scale), self.ppf(1 - a, *args, loc=loc, scale=scale)

    def mean(self, *args, loc=0, scale=1):
        shape, loc, scale = self._ls(args, loc, scale)
        return float(self._mean(*shape) * scale + loc)

    def var(self, *args, loc=0, scale=1):
        shape, loc, scale = self._ls(args, loc, scale)
        return float(self._var(*shape) * scale * scale)

    def std(self, *args, loc=0, scale=1):
        return math.sqrt(self.var(*args, loc=loc, scale=scale))

    def median(self, *args, loc=0, scale=1):
        return float(self.ppf(0.5, *args, loc=loc, scale=scale))


class _norm(_Dist):
    def _draw(self, rs, size):
        return rs.standard_normal(size)

    def _pdf(self, z):
        return np.exp(-z * z / 2.0) / math.sqrt(2.0 * math.pi)

    def _cdf(self, z):
        z = np.asarray(z, dtype=np.float64)
        return 0.5 * np.vectorize(math.erfc, otypes=[np.float64])(-z / math.sqrt(2.0)) if z.ndim else 0.5 * math.erfc(-float(z) / math.sqrt(2.0))

    def _ppf(self, q):
        q = np.asarray(q, dtype=np.float64)
        if q.ndim == 0:
            return _ndtri(float(q))
        return np.vectorize(_ndtri, otypes=[np.float64])(q)

    def _mean(self):
        return 0.0

    def _var(self):
        return 1.0


class _uniform(_Dist):
    def _draw(self, rs, size):
        return rs.uniform(0.0, 1.0, size)

    def _pdf(self, z):
        return np.where((z >= 0) & (z <= 1), 1.0, 0.0)

    def _cdf(self, z):
        return np.clip(z, 0.0, 1.0)

    def _ppf(self, q):
        return q

    def _mean(self):
        return 0.5

    def _var(self):
        return 1.0 / 12.0


class _expon(_Dist):
    def _draw(self, rs, size):
        return rs.standard_exponential(size)

    def _pdf(self, z):
        return np.where(z >= 0, np.exp(-np.maximum(z, 0.0)), 0.0)

    def _cdf(self, z):
        return np.where(z >= 0, 1.0 - np.exp(-np.maximum(z, 0.0)), 0.0)

    def _ppf(self, q):
        return -np.log1p(-q)

    def _mean(self):
        return 1.0

    def _var(self):
        return 1.0


class _reciprocal(_Dist):
    _n_shape = 2

    def _draw(self, rs, size, a, b):
        U = rs.uniform(size=size)
        return np.exp(math.log(a) + U * (math.log(b) - math.log(a)))

    def _pdf(self, z, a, b):
        return np.where((z >= a) & (z <= b), 1.0 / (z * (math.log(b) - math.log(a))), 0.0)

    def _cdf(self, z, a, b):
        return np.clip((np.log(np.maximum(z, 1e-300)) - math.log(a)) / (math.log(b) - math.log(a)), 0.0, 1.0)

    def _ppf(self, q, a, b):
        return np.exp(math.log(a) + q * (math.log(b) - math.log(a)))

    def _mean(self, a, b):
        return (b - a) / (math.log(b) - math.log(a))

    def _var(self, a, b):
        la, lb = math.log(a), math.log(b)
        m2 = (b * b - a * a) / (2 * (lb - la))
        return m2 - ((b - a) / (lb - la)) ** 2


class _Discrete:
    def __call__(self, *args, **kwds):
        return _Frozen(self, args, kwds)

    def interval(self, *a, **k):
        raise NotImplementedError

    def std(self, *args, **kw):
        return math.sqrt(self.var(*args, **kw))


class _randint(_Discrete):
    def rvs(self, low, high, loc=0, size=None, random_state=None):
        rs = _rs(random_state)
        return _ret(rs.randint(low, high, size) + loc)

    def pmf(self, k, low, high, loc=0):
        k = np.asarray(k) - loc
        return _ret(np.where((k >= low) & (k < high) & (k == np.floor(k)), 1.0 / (high - low), 0.0))

    def cdf(self, k, low, high, loc=0):
        k = np.floor(np.asarray(k, dtype=np.float64)) - loc
        return _ret(np.clip((k - low + 1) / (high - low), 0.0, 1.0))

    def mean(self, low, high, loc=0):
        return (low + high - 1) / 2.0 + loc

    def var(self, low, high, loc=0):
        return ((high - low) ** 2 - 1) / 12.0


class _poisson(_Discrete):
    def rvs(self, mu, loc=0, size=None, random_state=None):
        rs = _rs(random_state)
        return _ret(rs.poisson(mu, size) + loc)

    def pmf(self, k, mu, loc=0):
        k = np.asarray(k, dtype=np.float64) - loc
        f = np.vectorize(lambda x: math.exp(x * math.log(mu) - mu - math.lgamma(x + 1)) if x >= 0 and x == math.floor(x) else 0.0, otypes=[np.float64])
        return _ret(f(k))

    def cdf(self, k, mu, loc=0):
        k = np.floor(np.asarray(k, dtype=np.float64)) - loc
        f = np.vectorize(lambda x: sum(math.exp(i * math.log(mu) - mu - math.lgamma(i + 1)) for i in range(int(x) + 1)) if x >= 0 else 0.0, otypes=[np.float64])
        return _ret(f(k))

    def mean(self, mu, loc=0):
        return float(mu) + loc

    def var(self, mu, loc=0):
        return float(mu)


class _binom(_Discrete):
    def rvs(self, n, p, loc=0, size=None, random_state=None):
        rs = _rs(random_state)
        return _ret(rs.binomial(n, p, size) + loc)

    def pmf(self, k, n, p, loc=0):
        k = np.asarray(k, dtype=np.float64) - loc
        f = np.vectorize(lambda x: math.comb(int(n), int(x)) * p ** x * (1 - p) ** (n - x) if 0 <= x <= n and x == math.floor(x) else 0.0, otypes=[np.float64])
        return _ret(f(k))

    def cdf(self, k, n, p, loc=0):
        k = np.floor(np.asarray(k, dtype=np.float64)) - loc
        f = np.vectorize(lambda x: sum(math.comb(int(n), i) * p ** i * (1 - p) ** (n - i) for i in range(int(min(x, n)) + 1)) if x >= 0 else 0.0, otypes=[np.float64])
        return _ret(f(k))

    def mean(self, n, p, loc=0):
        return n * p + loc

    def var(self, n, p, loc=0):
        return n * p * (1 - p)


class _bernoulli(_binom):
    def rvs(self, p, loc=0, size=None, random_state=None):
        return _binom.rvs(self, 1, p, loc=loc, size=size, random_state=random_state)

    def pmf(self, k, p, loc=0):
        return _binom.pmf(self, k, 1, p, loc=loc)

    def cdf(self, k, p, loc=0):
        return _binom.cdf(self, k, 1, p, loc=loc)

    def mean(self, p, loc=0):
        return p + loc

    def var(self, p, loc=0):
        return p * (1 - p)


class _t(_Dist):
    _n_shape = 1

    def _draw(self, rs, size, df):
        return rs.standard_normal(size) / np.sqrt(rs.chisquare(df, size) / df) if hasattr(rs, 'chisquare') else rs.standard_normal(size)

    def _pdf(self, z, df):
        c = math.exp(math.lgamma((df + 1) / 2) - math.lgamma(df / 2)) / math.sqrt(df * math.pi)
        return c * (1 + z * z / df) ** (-(df + 1) / 2)

    def _cdf(self, z, df):
        f = np.vectorize(lambda x: _tcdf(x, df), otypes=[np.float64])
        return f(np.asarray(z, dtype=np.float64))

    def _ppf(self, q, df):
        f = np.vectorize(lambda p: _tppf(p, df), otypes=[np.float64])
        return f(np.asarray(q, dtype=np.float64))

    def _mean(self, df):
        return 0.0

    def _var(self, df):
        return df / (df - 2.0) if df > 2 else math.inf


def _tcdf(x, df):
    if x == 0:
        return 0.5
    xt = df / (df + x * x)
    p = 0.5 * _betainc(df / 2.0, 0.5, xt)
    return 1.0 - p if x > 0 else p


def _tppf(p, df):
    if p <= 0:
        return -math.inf
    if p >= 1:
        return math.inf
    lo, hi = -1e3, 1e3
    for _ in range(200):
        mid = (lo + hi) / 2
        if _tcdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


norm = _norm()
uniform = _uniform()
expon = _expon()
reciprocal = _reciprocal()
loguniform = reciprocal
randint = _randint()
poisson = _poisson()
binom = _binom()
bernoulli = _bernoulli()
t = _t()


def zscore(a, axis=0, ddof=0, nan_policy='propagate'):
    a = np.asarray(a, dtype=np.float64)
    if axis is None:
        return (a - a.mean()) / a.std(ddof=ddof)
    m = a.mean(axis=axis, keepdims=True)
    s = a.std(axis=axis, ddof=ddof, keepdims=True)
    return (a - m) / s


def rankdata(a, method='average', axis=None):
    a = np.asarray(a).ravel()
    n = len(a)
    order = np.argsort(a, kind='stable')
    ranks = np.empty(n, dtype=np.float64)
    sa = a[order]
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sa[j + 1] == sa[i]:
            j += 1
        if method == 'average':
            r = (i + j) / 2.0 + 1.0
        elif method == 'min':
            r = i + 1.0
        elif method == 'max':
            r = j + 1.0
        elif method == 'dense':
            r = None
        else:
            r = None
        for k in range(i, j + 1):
            ranks[order[k]] = r if r is not None else (k + 1.0 if method == 'ordinal' else 0.0)
        i = j + 1
    if method == 'dense':
        u = np.unique(a)
        ranks = np.searchsorted(u, a).astype(np.float64) + 1.0
    return ranks


def pearsonr(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    n = len(x)
    xm = x - x.mean()
    ym = y - y.mean()
    r = float(np.dot(xm, ym) / (np.sqrt(np.dot(xm, xm)) * np.sqrt(np.dot(ym, ym))))
    r = max(min(r, 1.0), -1.0)
    if abs(r) == 1.0 or n < 3:
        p = 0.0 if abs(r) == 1.0 else math.nan
    else:
        a = n / 2.0 - 1.0
        p = float(_betainc(a, a, 0.5 * (1.0 - abs(r)))) * 2.0
    return _Result(('statistic', r), ('pvalue', p))


def spearmanr(a, b=None):
    ra = rankdata(a)
    rb = rankdata(b)
    r = pearsonr(ra, rb)
    return _Result(('statistic', r[0]), ('pvalue', r[1]))


class _Result(tuple):
    def __new__(cls, *items):
        obj = tuple.__new__(cls, [v for _, v in items])
        obj._names = [k for k, _ in items]
        return obj

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        if name in self._names:
            return self[self._names.index(name)]
        if name == 'correlation' and 'statistic' in self._names:
            return self[0]
        raise AttributeError(name)

    def __repr__(self):
        return '%s(%s)' % (type(self).__name__ if type(self).__name__ != '_Result' else 'Result', ', '.join('%s=%r' % (k, v) for k, v in zip(self._names, self)))


def entropy(pk, qk=None, base=None, axis=0):
    pk = np.asarray(pk, dtype=np.float64)
    pk = pk / pk.sum(axis=axis, keepdims=True)
    if qk is None:
        terms = np.where(pk > 0, -pk * np.log(np.where(pk > 0, pk, 1.0)), 0.0)
    else:
        qk = np.asarray(qk, dtype=np.float64)
        qk = qk / qk.sum(axis=axis, keepdims=True)
        terms = np.where(pk > 0, pk * (np.log(np.where(pk > 0, pk, 1.0)) - np.log(np.where(qk > 0, qk, 1.0))), 0.0)
    s = terms.sum(axis=axis)
    if base is not None:
        s = s / math.log(base)
    return _ret(s)


def sem(a, axis=0, ddof=1):
    a = np.asarray(a, dtype=np.float64)
    return _ret(a.std(axis=axis, ddof=ddof) / np.sqrt(a.shape[axis]))


def skew(a, axis=0, bias=True):
    a = np.asarray(a, dtype=np.float64)
    m = a.mean(axis=axis, keepdims=True)
    m2 = ((a - m) ** 2).mean(axis=axis)
    m3 = ((a - m) ** 3).mean(axis=axis)
    g = m3 / m2 ** 1.5
    if not bias:
        n = a.shape[axis]
        g = g * math.sqrt(n * (n - 1)) / (n - 2)
    return _ret(g)


def kurtosis(a, axis=0, fisher=True, bias=True):
    a = np.asarray(a, dtype=np.float64)
    m = a.mean(axis=axis, keepdims=True)
    m2 = ((a - m) ** 2).mean(axis=axis)
    m4 = ((a - m) ** 4).mean(axis=axis)
    k = m4 / m2 ** 2
    return _ret(k - 3.0 if fisher else k)


def mode(a, axis=0, keepdims=False):
    a = np.asarray(a).ravel()
    vals, counts = np.unique(a, return_counts=True)
    i = int(np.argmax(counts))
    return _Result(('mode', vals[i]), ('count', int(counts[i])))


def ttest_1samp(a, popmean, axis=0):
    a = np.asarray(a, dtype=np.float64)
    n = a.shape[axis]
    tstat = (a.mean(axis=axis) - popmean) / (a.std(axis=axis, ddof=1) / math.sqrt(n))
    p = 2.0 * (1.0 - _tcdf(abs(float(tstat)), n - 1))
    return _Result(('statistic', float(tstat)), ('pvalue', p), ('df', n - 1))


def ttest_ind(a, b, equal_var=True):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    na, nb = len(a), len(b)
    va, vb = a.var(ddof=1), b.var(ddof=1)
    if equal_var:
        df = na + nb - 2
        sp = ((na - 1) * va + (nb - 1) * vb) / df
        se = math.sqrt(sp * (1.0 / na + 1.0 / nb))
    else:
        se = math.sqrt(va / na + vb / nb)
        df = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    tstat = (a.mean() - b.mean()) / se
    p = 2.0 * (1.0 - _tcdf(abs(tstat), df))
    return _Result(('statistic', float(tstat)), ('pvalue', p), ('df', df))
