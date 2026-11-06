import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted
from sklearn.utils import check_array, _to_array


def _dist(A, B, metric, p=2, w=None):
    A = np.asarray(A, dtype=np.float64)
    B = np.asarray(B, dtype=np.float64)
    if callable(metric):
        return np.array([[metric(a, b) for b in B] for a in A])
    if metric in ('euclidean', 'l2') or (metric == 'minkowski' and p == 2):
        return np.sqrt(np.maximum(((A[:, None, :] - B[None, :, :]) ** 2).sum(axis=2), 0.0))
    if metric in ('manhattan', 'cityblock', 'l1') or (metric == 'minkowski' and p == 1):
        return np.abs(A[:, None, :] - B[None, :, :]).sum(axis=2)
    if metric == 'chebyshev':
        return np.abs(A[:, None, :] - B[None, :, :]).max(axis=2)
    if metric == 'minkowski':
        return (np.abs(A[:, None, :] - B[None, :, :]) ** p).sum(axis=2) ** (1.0 / p)
    if metric == 'cosine':
        na = np.sqrt((A ** 2).sum(axis=1))
        nb = np.sqrt((B ** 2).sum(axis=1))
        return 1 - (A / np.where(na == 0, 1, na)[:, None]) @ (B / np.where(nb == 0, 1, nb)[:, None]).T
    raise ValueError('Unknown metric %r' % (metric,))


class NearestNeighbors(BaseEstimator):
    def __init__(self, *, n_neighbors=5, radius=1.0, algorithm='auto', leaf_size=30, metric='minkowski', p=2, metric_params=None, n_jobs=None):
        self.n_neighbors = n_neighbors
        self.radius = radius
        self.algorithm = algorithm
        self.leaf_size = leaf_size
        self.metric = metric
        self.p = p
        self.metric_params = metric_params
        self.n_jobs = n_jobs

    def fit(self, X, y=None):
        self._fit_X = self._validate_data(X)
        self.n_samples_fit_ = self._fit_X.shape[0]
        return self

    def kneighbors(self, X=None, n_neighbors=None, return_distance=True):
        check_is_fitted(self)
        k = self.n_neighbors if n_neighbors is None else n_neighbors
        if X is None:
            Q = self._fit_X
            D = _dist(Q, self._fit_X, self.metric, self.p)
            np.fill_diagonal(D, np.inf)
        else:
            Q = self._validate_data(X, reset=False)
            D = _dist(Q, self._fit_X, self.metric, self.p)
        idx = np.argsort(D, axis=1, kind='stable')[:, :k]
        if return_distance:
            return np.take_along_axis(D, idx, axis=1), idx
        return idx

    def radius_neighbors(self, X=None, radius=None, return_distance=True):
        r = self.radius if radius is None else radius
        Q = self._fit_X if X is None else self._validate_data(X, reset=False)
        D = _dist(Q, self._fit_X, self.metric, self.p)
        dists, idxs = [], []
        for row in D:
            ind = np.where(row <= r)[0]
            ind = ind[np.argsort(row[ind], kind='stable')]
            dists.append(row[ind])
            idxs.append(ind)
        return (dists, idxs) if return_distance else idxs

    def kneighbors_graph(self, X=None, n_neighbors=None, mode='connectivity'):
        d, idx = self.kneighbors(X, n_neighbors)
        n = self._fit_X.shape[0] if X is None else len(_to_array(X))
        g = np.zeros((n, self._fit_X.shape[0]))
        for i in range(len(idx)):
            for j, dd in zip(idx[i], d[i]):
                g[i, j] = 1.0 if mode == 'connectivity' else dd
        from sklearn.preprocessing import _Sparse
        return _Sparse(g)


class _KNeighborsBase(NearestNeighbors):
    def _weights(self, dist):
        if self.weights == 'uniform' or self.weights is None:
            return None
        if self.weights == 'distance':
            with_zero = (dist == 0).any(axis=1)
            w = 1.0 / np.where(dist == 0, 1.0, dist)
            for i in np.where(with_zero)[0]:
                w[i] = (dist[i] == 0).astype(np.float64)
            return w
        return self.weights(dist)


class KNeighborsClassifier(ClassifierMixin, _KNeighborsBase):
    def __init__(self, n_neighbors=5, *, weights='uniform', algorithm='auto', leaf_size=30, p=2, metric='minkowski', metric_params=None, n_jobs=None):
        self.n_neighbors = n_neighbors
        self.weights = weights
        self.algorithm = algorithm
        self.leaf_size = leaf_size
        self.p = p
        self.metric = metric
        self.metric_params = metric_params
        self.n_jobs = n_jobs

    def fit(self, X, y):
        X, y = self._validate_data(X, y)
        self._fit_X = X
        self.classes_, self._y = np.unique(y, return_inverse=True)
        self.n_samples_fit_ = X.shape[0]
        if self.n_neighbors > X.shape[0]:
            pass
        return self

    def predict_proba(self, X):
        check_is_fitted(self)
        if self.n_neighbors > self._fit_X.shape[0]:
            raise ValueError('Expected n_neighbors <= n_samples_fit, but n_neighbors = %d, n_samples_fit = %d, n_samples = %d' % (self.n_neighbors, self._fit_X.shape[0], len(_to_array(X))))
        dist, idx = self.kneighbors(X)
        w = self._weights(dist)
        K = len(self.classes_)
        out = np.zeros((idx.shape[0], K))
        for i in range(idx.shape[0]):
            for j in range(idx.shape[1]):
                out[i, self._y[idx[i, j]]] += 1.0 if w is None else w[i, j]
        s = out.sum(axis=1, keepdims=True)
        s = np.where(s == 0, 1.0, s)
        return out / s

    def predict(self, X):
        proba = self.predict_proba(X)
        return self.classes_[np.argmax(proba, axis=1)]


class KNeighborsRegressor(RegressorMixin, _KNeighborsBase):
    def __init__(self, n_neighbors=5, *, weights='uniform', algorithm='auto', leaf_size=30, p=2, metric='minkowski', metric_params=None, n_jobs=None):
        self.n_neighbors = n_neighbors
        self.weights = weights
        self.algorithm = algorithm
        self.leaf_size = leaf_size
        self.p = p
        self.metric = metric
        self.metric_params = metric_params
        self.n_jobs = n_jobs

    def fit(self, X, y):
        X, y = self._validate_data(X, y)
        self._fit_X = X
        self._y = np.asarray(y, dtype=np.float64)
        self.n_samples_fit_ = X.shape[0]
        return self

    def predict(self, X):
        check_is_fitted(self)
        dist, idx = self.kneighbors(X)
        w = self._weights(dist)
        yy = self._y[idx]
        if w is None:
            return yy.mean(axis=1)
        return (yy * w).sum(axis=1) / w.sum(axis=1)


class RadiusNeighborsClassifier(ClassifierMixin, NearestNeighbors):
    def __init__(self, radius=1.0, *, weights='uniform', algorithm='auto', leaf_size=30, p=2, metric='minkowski', outlier_label=None, metric_params=None, n_jobs=None):
        self.radius = radius
        self.weights = weights
        self.algorithm = algorithm
        self.leaf_size = leaf_size
        self.p = p
        self.metric = metric
        self.outlier_label = outlier_label
        self.metric_params = metric_params
        self.n_jobs = n_jobs

    def fit(self, X, y):
        X, y = self._validate_data(X, y)
        self._fit_X = X
        self.classes_, self._y = np.unique(y, return_inverse=True)
        return self

    def predict(self, X):
        dists, idxs = self.radius_neighbors(X)
        out = []
        for d, ind in zip(dists, idxs):
            if len(ind) == 0:
                out.append(self.outlier_label)
            else:
                out.append(self.classes_[np.argmax(np.bincount(self._y[ind], minlength=len(self.classes_)))])
        return np.array(out)


class NearestCentroid(ClassifierMixin, BaseEstimator):
    def __init__(self, metric='euclidean', *, shrink_threshold=None):
        self.metric = metric
        self.shrink_threshold = shrink_threshold

    def fit(self, X, y):
        X, y = self._validate_data(X, y)
        self.classes_ = np.unique(y)
        self.centroids_ = np.array([X[y == c].mean(axis=0) for c in self.classes_])
        return self

    def predict(self, X):
        X = self._validate_data(X, reset=False)
        return self.classes_[np.argmin(_dist(X, self.centroids_, self.metric), axis=1)]
