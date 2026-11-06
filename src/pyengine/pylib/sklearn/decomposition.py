import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, check_is_fitted
from sklearn.utils import check_array, check_random_state, _to_array


def svd_flip(u, v, u_based_decision=True):
    if u_based_decision:
        idx = np.argmax(np.abs(u), axis=0)
        signs = np.sign(u[idx, range(u.shape[1])])
        u = u * signs
        v = v * signs[:, None]
    else:
        idx = np.argmax(np.abs(v), axis=1)
        signs = np.sign(v[range(v.shape[0]), idx])
        u = u * signs
        v = v * signs[:, None]
    return u, v


class PCA(TransformerMixin, BaseEstimator):
    def __init__(self, n_components=None, *, copy=True, whiten=False, svd_solver='auto', tol=0.0, iterated_power='auto', n_oversamples=10, power_iteration_normalizer='auto', random_state=None):
        self.n_components = n_components
        self.copy = copy
        self.whiten = whiten
        self.svd_solver = svd_solver
        self.tol = tol
        self.iterated_power = iterated_power
        self.n_oversamples = n_oversamples
        self.power_iteration_normalizer = power_iteration_normalizer
        self.random_state = random_state

    def fit(self, X, y=None):
        self._fit(X)
        return self

    def _fit(self, X):
        X = self._validate_data(X)
        n, d = X.shape
        nc = self.n_components
        if nc is None:
            nc = min(n, d)
        if isinstance(nc, float) and 0 < nc < 1.0:
            target = nc
            nc = min(n, d)
        else:
            target = None
            if nc == 'mle':
                nc = min(n, d)
            if not (isinstance(nc, (int, np.integer)) and 0 <= nc <= min(n, d)):
                raise ValueError("n_components=%r must be between 0 and min(n_samples, n_features)=%d with svd_solver='full'" % (self.n_components, min(n, d)))
        self.mean_ = X.mean(axis=0)
        Xc = X - self.mean_
        U, S, Vt = np.linalg.svd(Xc, full_matrices=False)
        U, Vt = svd_flip(U, Vt, u_based_decision=False)
        ev = (S ** 2) / (n - 1)
        total = ev.sum()
        ratio = ev / total
        if target is not None:
            cum = np.cumsum(ratio)
            nc = int(np.searchsorted(cum, target, side='right') + 1)
        self.n_samples_ = n
        self.n_features_ = d
        self.components_ = Vt[:nc]
        self.n_components_ = nc
        self.explained_variance_ = ev[:nc]
        self.explained_variance_ratio_ = ratio[:nc]
        self.singular_values_ = S[:nc]
        self.noise_variance_ = float(ev[nc:].mean()) if nc < min(n, d) else 0.0
        return U[:, :nc], S[:nc]

    def fit_transform(self, X, y=None):
        U, S = self._fit(X)
        U = U * S if not self.whiten else U * np.sqrt(X.shape[0] - 1)
        return U

    def transform(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        out = (X - self.mean_) @ self.components_.T
        if self.whiten:
            out = out / np.sqrt(self.explained_variance_)
        return out

    def inverse_transform(self, X):
        X = np.asarray(_to_array(X), dtype=np.float64)
        if self.whiten:
            X = X * np.sqrt(self.explained_variance_)
        return X @ self.components_ + self.mean_

    def get_feature_names_out(self, input_features=None):
        return np.array(['pca%d' % i for i in range(self.n_components_)])

    def score_samples(self, X):
        raise NotImplementedError('score_samples no está disponible en esta versión en miniatura')


class TruncatedSVD(TransformerMixin, BaseEstimator):
    def __init__(self, n_components=2, *, algorithm='randomized', n_iter=5, n_oversamples=10, power_iteration_normalizer='auto', random_state=None, tol=0.0):
        self.n_components = n_components
        self.algorithm = algorithm
        self.n_iter = n_iter
        self.n_oversamples = n_oversamples
        self.power_iteration_normalizer = power_iteration_normalizer
        self.random_state = random_state
        self.tol = tol

    def fit(self, X, y=None):
        self.fit_transform(X)
        return self

    def fit_transform(self, X, y=None):
        X = self._validate_data(X)
        U, S, Vt = np.linalg.svd(X, full_matrices=False)
        U, Vt = svd_flip(U, Vt)
        k = self.n_components
        self.components_ = Vt[:k]
        Xt = U[:, :k] * S[:k]
        self.singular_values_ = S[:k]
        self.explained_variance_ = np.var(Xt, axis=0)
        self.explained_variance_ratio_ = self.explained_variance_ / np.var(X, axis=0).sum()
        return Xt

    def transform(self, X):
        check_is_fitted(self)
        return self._validate_data(X, reset=False) @ self.components_.T

    def inverse_transform(self, X):
        return np.asarray(_to_array(X)) @ self.components_
