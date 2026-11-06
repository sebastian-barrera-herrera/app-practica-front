import numpy as np


def _p(u, v):
    return np.asarray(u, dtype=np.float64), np.asarray(v, dtype=np.float64)


def euclidean(u, v, w=None):
    u, v = _p(u, v)
    return float(np.sqrt(np.sum((u - v) ** 2)))


def sqeuclidean(u, v, w=None):
    u, v = _p(u, v)
    return float(np.sum((u - v) ** 2))


def cityblock(u, v, w=None):
    u, v = _p(u, v)
    return float(np.sum(np.abs(u - v)))


def chebyshev(u, v, w=None):
    u, v = _p(u, v)
    return float(np.max(np.abs(u - v)))


def minkowski(u, v, p=2, w=None):
    u, v = _p(u, v)
    return float(np.sum(np.abs(u - v) ** p) ** (1.0 / p))


def cosine(u, v, w=None):
    u, v = _p(u, v)
    return float(1.0 - np.dot(u, v) / (np.sqrt(np.dot(u, u)) * np.sqrt(np.dot(v, v))))


def correlation(u, v, w=None, centered=True):
    u, v = _p(u, v)
    if centered:
        u = u - u.mean()
        v = v - v.mean()
    return float(1.0 - np.dot(u, v) / (np.sqrt(np.dot(u, u)) * np.sqrt(np.dot(v, v))))


def hamming(u, v, w=None):
    u = np.asarray(u)
    v = np.asarray(v)
    return float(np.mean(u != v))


def jaccard(u, v, w=None):
    u = np.asarray(u) != 0
    v = np.asarray(v) != 0
    nonzero = np.bitwise_or(u, v)
    unequal = np.bitwise_and(np.not_equal(u, v), nonzero)
    a = np.double(unequal.sum())
    b = np.double(nonzero.sum())
    return float(a / b) if b != 0 else 0.0


_METRICS = {
    'euclidean': euclidean, 'sqeuclidean': sqeuclidean, 'cityblock': cityblock, 'manhattan': cityblock,
    'chebyshev': chebyshev, 'cosine': cosine, 'correlation': correlation, 'hamming': hamming,
    'jaccard': jaccard, 'minkowski': minkowski,
}


def cdist(XA, XB, metric='euclidean', **kw):
    XA = np.asarray(XA, dtype=np.float64)
    XB = np.asarray(XB, dtype=np.float64)
    if XA.ndim != 2 or XB.ndim != 2:
        raise ValueError('XA and XB must be two-dimensional arrays.')
    if XA.shape[1] != XB.shape[1]:
        raise ValueError('XA and XB must have the same number of columns (i.e. feature dimension.)')
    if metric == 'euclidean':
        d2 = (XA ** 2).sum(axis=1)[:, None] + (XB ** 2).sum(axis=1)[None, :] - 2.0 * XA @ XB.T
        diff = XA[:, None, :] - XB[None, :, :]
        return np.sqrt((diff ** 2).sum(axis=2))
    if metric == 'sqeuclidean':
        diff = XA[:, None, :] - XB[None, :, :]
        return (diff ** 2).sum(axis=2)
    if metric in ('cityblock', 'manhattan'):
        return np.abs(XA[:, None, :] - XB[None, :, :]).sum(axis=2)
    if metric == 'chebyshev':
        return np.abs(XA[:, None, :] - XB[None, :, :]).max(axis=2)
    if metric == 'cosine':
        na = np.sqrt((XA * XA).sum(axis=1))
        nb = np.sqrt((XB * XB).sum(axis=1))
        return 1.0 - (XA @ XB.T) / (na[:, None] * nb[None, :])
    f = metric if callable(metric) else _METRICS[metric]
    out = np.zeros((XA.shape[0], XB.shape[0]))
    for i in range(XA.shape[0]):
        for j in range(XB.shape[0]):
            out[i, j] = f(XA[i], XB[j], **kw)
    return out


def pdist(X, metric='euclidean', **kw):
    X = np.asarray(X, dtype=np.float64)
    n = X.shape[0]
    D = cdist(X, X, metric=metric, **kw)
    out = []
    for i in range(n):
        for j in range(i + 1, n):
            out.append(D[i, j])
    return np.array(out)


def squareform(X, force='no', checks=True):
    X = np.asarray(X, dtype=np.float64)
    if X.ndim == 1:
        m = X.shape[0]
        n = int((1 + np.sqrt(1 + 8 * m)) / 2)
        out = np.zeros((n, n))
        k = 0
        for i in range(n):
            for j in range(i + 1, n):
                out[i, j] = X[k]
                out[j, i] = X[k]
                k += 1
        return out
    n = X.shape[0]
    return np.array([X[i, j] for i in range(n) for j in range(i + 1, n)])
