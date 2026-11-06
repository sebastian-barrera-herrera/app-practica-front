import math
import numpy as np


def _vec(f, x):
    if isinstance(x, (int, float)):
        return f(float(x))
    a = np.asarray(x, dtype=np.float64)
    return np.vectorize(f, otypes=[np.float64])(a)


def expit(x):
    a = np.asarray(x, dtype=np.float64)
    out = np.where(a >= 0, 1.0 / (1.0 + np.exp(-np.abs(a))), np.exp(-np.abs(a)) / (1.0 + np.exp(-np.abs(a))))
    return float(out) if np.ndim(a) == 0 else out


def logit(p):
    a = np.asarray(p, dtype=np.float64)
    out = np.log(a / (1.0 - a))
    return float(out) if np.ndim(a) == 0 else out


def erf(x):
    return _vec(math.erf, x)


def erfc(x):
    return _vec(math.erfc, x)


def gamma(x):
    return _vec(math.gamma, x)


def gammaln(x):
    return _vec(math.lgamma, x)


def comb(N, k, exact=False):
    if exact:
        return math.comb(int(N), int(k))
    return float(math.comb(int(N), int(k)))


def perm(N, k, exact=False):
    if exact:
        return math.perm(int(N), int(k))
    return float(math.perm(int(N), int(k)))


def logsumexp(a, axis=None, b=None, keepdims=False, return_sign=False):
    a = np.asarray(a, dtype=np.float64)
    if b is not None:
        a = a + np.log(np.asarray(b, dtype=np.float64))
    amax = np.max(a, axis=axis, keepdims=True)
    amax = np.where(np.isfinite(amax), amax, 0.0)
    s = np.sum(np.exp(a - amax), axis=axis, keepdims=True)
    out = np.log(s) + amax
    if not keepdims:
        out = np.squeeze(out, axis=axis) if axis is not None else out.reshape(())
    return float(out) if np.ndim(out) == 0 else out


def softmax(x, axis=None):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(x, axis=axis, keepdims=True)
    e = np.exp(x - m)
    return e / np.sum(e, axis=axis, keepdims=True)


def log_softmax(x, axis=None):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(x, axis=axis, keepdims=True)
    s = x - m
    return s - np.log(np.sum(np.exp(s), axis=axis, keepdims=True))


def xlogy(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    out = np.where(x == 0, 0.0, x * np.log(np.where(x == 0, 1.0, y)))
    return float(out) if np.ndim(out) == 0 else out


def betainc(a, b, x):
    return _vec(lambda t: _betainc(a, b, t), x)


def _betacf(a, b, x):
    MAXIT = 500
    EPS = 3e-16
    FPMIN = 1e-300
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def _betainc(a, b, x):
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    bt = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b
