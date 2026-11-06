import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, check_is_fitted
from sklearn.utils import _to_array


def _isnan(v):
    return v is None or (isinstance(v, float) and v != v)


def _cols(X):
    if hasattr(X, '_cols') and hasattr(X, '_data'):
        return [list(X._data[c]) for c in X._cols], len(X.index)
    A = np.asarray(_to_array(X))
    if A.ndim != 2:
        raise ValueError('Expected 2D array, got %dD array instead' % A.ndim)
    return [A[:, j].tolist() for j in range(A.shape[1])], A.shape[0]


def _is_missing(v, mv):
    if mv is None or (isinstance(mv, float) and mv != mv):
        return _isnan(v)
    return v == mv


def _mask(X, missing_values):
    A = np.asarray(_to_array(X))
    cols, n = _cols(A)
    return np.array([[_is_missing(v, missing_values) for v in col] for col in cols], dtype=bool).T.reshape(n, len(cols))


class SimpleImputer(TransformerMixin, BaseEstimator):
    def __init__(self, *, missing_values=np.nan, strategy='mean', fill_value=None, copy=True, add_indicator=False, keep_empty_features=False):
        self.missing_values = missing_values
        self.strategy = strategy
        self.fill_value = fill_value
        self.copy = copy
        self.add_indicator = add_indicator
        self.keep_empty_features = keep_empty_features

    def fit(self, X, y=None):
        if hasattr(X, 'columns'):
            self.feature_names_in_ = np.array([str(c) for c in X.columns])
        cols, n = _cols(X)
        self.n_features_in_ = len(cols)
        stats = []
        for col in cols:
            good = [v for v in col if not _is_missing(v, self.missing_values)]
            numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in col if not _isnan(v))
            if self.strategy == 'constant':
                stats.append(self.fill_value if self.fill_value is not None else (0 if numeric else 'missing_value'))
            elif not good:
                stats.append(np.nan)
            elif self.strategy == 'mean':
                stats.append(float(np.mean(np.array(good, dtype=np.float64))))
            elif self.strategy == 'median':
                stats.append(float(np.median(np.array(good, dtype=np.float64))))
            elif self.strategy == 'most_frequent':
                counts = {}
                for v in good:
                    counts[v] = counts.get(v, 0) + 1
                top = max(counts.values())
                stats.append(sorted(k for k, c in counts.items() if c == top)[0])
            else:
                raise ValueError("Can only use these strategies: ['mean', 'median', 'most_frequent', 'constant'], got strategy=%s" % self.strategy)
        self.statistics_ = np.array(stats)
        self._stats_list = stats
        return self

    def transform(self, X):
        check_is_fitted(self)
        cols, n = _cols(X)
        out_cols = []
        ind = []
        for j, col in enumerate(cols):
            m = [_is_missing(v, self.missing_values) for v in col]
            out_cols.append([self._stats_list[j] if mm else v for v, mm in zip(col, m)])
            if any(m):
                ind.append([1.0 if mm else 0.0 for mm in m])
        if getattr(self, '_output_pandas', False) and hasattr(X, 'columns'):
            import pandas as pd
            return pd.DataFrame({c: out_cols[j] for j, c in enumerate(X.columns)}, index=X.index)
        out = np.array(out_cols).T if out_cols else np.zeros((n, 0))
        if self.add_indicator and ind:
            out = np.hstack([out.astype(np.float64), np.array(ind).T])
        return out

    def get_feature_names_out(self, input_features=None):
        names = input_features if input_features is not None else getattr(self, 'feature_names_in_', None)
        return np.array(names if names is not None else ['x%d' % i for i in range(self.n_features_in_)])


class MissingIndicator(TransformerMixin, BaseEstimator):
    def __init__(self, *, missing_values=np.nan, features='missing-only', sparse='auto', error_on_new=True):
        self.missing_values = missing_values
        self.features = features
        self.sparse = sparse
        self.error_on_new = error_on_new

    def fit(self, X, y=None):
        A = np.asarray(_to_array(X))
        m = _mask(A, self.missing_values)
        self.features_ = np.where(m.any(axis=0))[0] if self.features == 'missing-only' else np.arange(A.shape[1])
        return self

    def transform(self, X):
        A = np.asarray(_to_array(X))
        return _mask(A, self.missing_values)[:, self.features_]


class KNNImputer(TransformerMixin, BaseEstimator):
    def __init__(self, *, missing_values=np.nan, n_neighbors=5, weights='uniform', metric='nan_euclidean', copy=True, add_indicator=False, keep_empty_features=False):
        self.missing_values = missing_values
        self.n_neighbors = n_neighbors
        self.weights = weights
        self.metric = metric
        self.copy = copy
        self.add_indicator = add_indicator
        self.keep_empty_features = keep_empty_features

    def fit(self, X, y=None):
        self._fit_X = np.array(_to_array(X), dtype=np.float64)
        self.n_features_in_ = self._fit_X.shape[1]
        return self

    def _dist(self, a, b):
        ok = ~(np.isnan(a) | np.isnan(b))
        if not ok.any():
            return np.nan
        d = ((a[ok] - b[ok]) ** 2).sum()
        return np.sqrt(d * len(a) / ok.sum())

    def transform(self, X):
        A = np.array(_to_array(X), dtype=np.float64)
        F = self._fit_X
        out = A.copy()
        col_means = np.nanmean(F, axis=0)
        for i in range(A.shape[0]):
            for j in np.where(np.isnan(A[i]))[0]:
                cand = [(self._dist(A[i], F[k]), k) for k in range(F.shape[0]) if not np.isnan(F[k, j])]
                cand = [c for c in cand if not np.isnan(c[0])]
                cand.sort(key=lambda c: (c[0], c[1]))
                top = cand[:self.n_neighbors]
                if not top:
                    out[i, j] = col_means[j]
                elif self.weights == 'distance':
                    w = np.array([1.0 / max(d, 1e-12) for d, _ in top])
                    out[i, j] = float((w * np.array([F[k, j] for _, k in top])).sum() / w.sum())
                else:
                    out[i, j] = float(np.mean([F[k, j] for _, k in top]))
        return out
