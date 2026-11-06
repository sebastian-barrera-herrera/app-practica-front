import itertools
import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, OneToOneFeatureMixin, check_is_fitted
from sklearn.utils import check_array, _to_array


class _Sparse:
    """Matriz «dispersa» mínima (guarda la densa): toarray(), shape, nnz, indexado y conversión a NumPy."""

    def __init__(self, dense):
        self._a = np.asarray(dense)

    @property
    def shape(self):
        return self._a.shape

    @property
    def dtype(self):
        return self._a.dtype

    @property
    def nnz(self):
        return int(np.count_nonzero(self._a))

    def toarray(self):
        return self._a.copy()

    todense = toarray

    def __len__(self):
        return self._a.shape[0]

    def __iter__(self):
        return iter(self._a)

    def __getitem__(self, k):
        r = self._a[k]
        return _Sparse(r) if isinstance(r, np.ndarray) and r.ndim == 2 else r

    def __array__(self, dtype=None):
        return self._a

    def sum(self, axis=None):
        return self._a.sum(axis=axis)

    def __matmul__(self, other):
        return self._a @ _to_array(other)

    def __str__(self):
        a = self._a
        rows, cols = np.nonzero(a)
        head = "<Compressed Sparse Row sparse matrix of dtype '%s'\n\twith %d stored elements and shape %s>" % (a.dtype, len(rows), a.shape)
        body = '\n'.join('  %s\t%s' % ((int(r), int(c)), repr(float(a[r, c])) if a.dtype.kind == 'f' else int(a[r, c])) for r, c in zip(rows, cols))
        return head + '\n  Coords\tValues\n' + body

    __repr__ = __str__


def _cols(X):
    """Columnas de X como listas de Python (DataFrame, ndarray 2D o lista de filas) y número de filas."""
    if hasattr(X, '_cols') and hasattr(X, '_data'):
        cols = [list(X._data[c]) for c in X._cols]
        return cols, len(X.index)
    if hasattr(X, 'toarray'):
        X = X.toarray()
    A = np.asarray(X)
    if A.ndim != 2:
        raise ValueError('Expected 2D array, got %dD array instead:\narray=%s.\nReshape your data either using array.reshape(-1, 1) if your data has a single feature or array.reshape(1, -1) if it contains a single sample.' % (A.ndim, A))
    return [A[:, j].tolist() for j in range(A.shape[1])], A.shape[0]


def _arr(X, est=None):
    return check_array(X, estimator=est, dtype=np.float64)


def _out(est, X, out):
    if getattr(est, '_output_pandas', False):
        import pandas as pd
        return pd.DataFrame(out, columns=list(est.get_feature_names_out()), index=X.index if hasattr(X, 'index') else None)
    return out


class StandardScaler(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, *, copy=True, with_mean=True, with_std=True):
        self.copy = copy
        self.with_mean = with_mean
        self.with_std = with_std

    def fit(self, X, y=None, sample_weight=None):
        X = self._validate_data(X, reset=True)
        self.n_samples_seen_ = X.shape[0]
        self.mean_ = X.mean(axis=0) if (self.with_mean or self.with_std) else None
        if self.with_std:
            self.var_ = X.var(axis=0)
            scale = np.sqrt(self.var_)
            self.scale_ = np.where(scale < 10 * np.finfo(np.float64).eps, 1.0, scale)
        else:
            self.var_ = None
            self.scale_ = None
        return self

    def partial_fit(self, X, y=None):
        return self.fit(X)

    def transform(self, X, copy=None):
        check_is_fitted(self)
        Xv = self._validate_data(X, reset=False)
        out = Xv.copy()
        if self.with_mean:
            out = out - self.mean_
        if self.with_std:
            out = out / self.scale_
        return _out(self, X, out)

    def inverse_transform(self, X, copy=None):
        check_is_fitted(self)
        out = np.array(_to_array(X), dtype=np.float64)
        if self.with_std:
            out = out * self.scale_
        if self.with_mean:
            out = out + self.mean_
        return out


class MinMaxScaler(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, feature_range=(0, 1), *, copy=True, clip=False):
        self.feature_range = feature_range
        self.copy = copy
        self.clip = clip

    def fit(self, X, y=None):
        X = self._validate_data(X, reset=True)
        lo, hi = self.feature_range
        if lo >= hi:
            raise ValueError('Minimum of desired feature range must be smaller than maximum. Got %s.' % (self.feature_range,))
        self.data_min_ = X.min(axis=0)
        self.data_max_ = X.max(axis=0)
        self.data_range_ = self.data_max_ - self.data_min_
        rng = np.where(self.data_range_ == 0, 1.0, self.data_range_)
        self.scale_ = (hi - lo) / rng
        self.min_ = lo - self.data_min_ * self.scale_
        self.n_samples_seen_ = X.shape[0]
        return self

    def transform(self, X):
        check_is_fitted(self)
        Xv = self._validate_data(X, reset=False)
        out = Xv * self.scale_ + self.min_
        if self.clip:
            out = np.clip(out, self.feature_range[0], self.feature_range[1])
        return _out(self, X, out)

    def inverse_transform(self, X):
        check_is_fitted(self)
        return (np.asarray(_to_array(X), dtype=np.float64) - self.min_) / self.scale_


class MaxAbsScaler(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, *, copy=True):
        self.copy = copy

    def fit(self, X, y=None):
        X = self._validate_data(X, reset=True)
        m = np.abs(X).max(axis=0)
        self.max_abs_ = m
        self.scale_ = np.where(m == 0, 1.0, m)
        self.n_samples_seen_ = X.shape[0]
        return self

    def transform(self, X):
        check_is_fitted(self)
        return _out(self, X, self._validate_data(X, reset=False) / self.scale_)

    def inverse_transform(self, X):
        return np.asarray(_to_array(X), dtype=np.float64) * self.scale_


class RobustScaler(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, *, with_centering=True, with_scaling=True, quantile_range=(25.0, 75.0), copy=True, unit_variance=False):
        self.with_centering = with_centering
        self.with_scaling = with_scaling
        self.quantile_range = quantile_range
        self.copy = copy
        self.unit_variance = unit_variance

    def fit(self, X, y=None):
        X = self._validate_data(X, reset=True)
        lo, hi = self.quantile_range
        self.center_ = np.median(X, axis=0) if self.with_centering else None
        if self.with_scaling:
            q = np.percentile(X, [lo, hi], axis=0)
            s = q[1] - q[0]
            self.scale_ = np.where(s == 0, 1.0, s)
        else:
            self.scale_ = None
        return self

    def transform(self, X):
        check_is_fitted(self)
        out = self._validate_data(X, reset=False)
        if self.with_centering:
            out = out - self.center_
        if self.with_scaling:
            out = out / self.scale_
        return _out(self, X, out)

    def inverse_transform(self, X):
        out = np.asarray(_to_array(X), dtype=np.float64)
        if self.with_scaling:
            out = out * self.scale_
        if self.with_centering:
            out = out + self.center_
        return out


class Normalizer(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, norm='l2', *, copy=True):
        self.norm = norm
        self.copy = copy

    def fit(self, X, y=None):
        self._validate_data(X, reset=True)
        return self

    def transform(self, X, copy=None):
        return normalize(self._validate_data(X, reset=False), norm=self.norm)


def normalize(X, norm='l2', *, axis=1):
    X = np.asarray(_to_array(X), dtype=np.float64)
    if axis == 0:
        return normalize(X.T, norm).T
    if norm == 'l1':
        n = np.abs(X).sum(axis=1)
    elif norm == 'max':
        n = np.abs(X).max(axis=1)
    else:
        n = np.sqrt((X ** 2).sum(axis=1))
    n = np.where(n == 0, 1.0, n)
    return X / n[:, None]


class Binarizer(OneToOneFeatureMixin, TransformerMixin, BaseEstimator):
    def __init__(self, *, threshold=0.0, copy=True):
        self.threshold = threshold
        self.copy = copy

    def fit(self, X, y=None):
        self._validate_data(X, reset=True)
        return self

    def transform(self, X, copy=None):
        return (self._validate_data(X, reset=False) > self.threshold).astype(np.float64)


class FunctionTransformer(TransformerMixin, BaseEstimator):
    def __init__(self, func=None, inverse_func=None, *, validate=False, accept_sparse=False, check_inverse=True, feature_names_out=None, kw_args=None, inv_kw_args=None):
        self.func = func
        self.inverse_func = inverse_func
        self.validate = validate
        self.accept_sparse = accept_sparse
        self.check_inverse = check_inverse
        self.feature_names_out = feature_names_out
        self.kw_args = kw_args
        self.inv_kw_args = inv_kw_args

    def fit(self, X, y=None):
        Xa = np.asarray(_to_array(X))
        if Xa.ndim == 2:
            self.n_features_in_ = Xa.shape[1]
        return self

    def transform(self, X):
        if self.func is None:
            return X
        return self.func(X, **(self.kw_args or {}))

    def inverse_transform(self, X):
        if self.inverse_func is None:
            return X
        return self.inverse_func(X, **(self.inv_kw_args or {}))

    def get_feature_names_out(self, input_features=None):
        if input_features is not None:
            return np.array(input_features)
        return np.array(['x%d' % i for i in range(getattr(self, 'n_features_in_', 0))])


class _Col(list):
    pass


def _unique_sorted(col):
    vals = list(col)
    try:
        return sorted(set(vals))
    except TypeError:
        return sorted(set(vals), key=str)


class OneHotEncoder(TransformerMixin, BaseEstimator):
    def __init__(self, *, categories='auto', drop=None, sparse_output=True, dtype=np.float64, handle_unknown='error', min_frequency=None, max_categories=None, feature_name_combiner='concat'):
        self.categories = categories
        self.drop = drop
        self.sparse_output = sparse_output
        self.dtype = dtype
        self.handle_unknown = handle_unknown
        self.min_frequency = min_frequency
        self.max_categories = max_categories
        self.feature_name_combiner = feature_name_combiner

    def fit(self, X, y=None):
        cols, n = _cols(X)
        if hasattr(X, 'columns'):
            self.feature_names_in_ = np.array([str(c) for c in X.columns])
        self.n_features_in_ = len(cols)
        cats = []
        for j, col in enumerate(cols):
            if self.categories == 'auto':
                cats.append(np.array(_unique_sorted(col)))
            else:
                cats.append(np.array(self.categories[j]))
        self.categories_ = cats
        self.drop_idx_ = None
        if self.drop == 'first':
            self.drop_idx_ = np.zeros(len(cats), dtype=int)
        elif self.drop == 'if_binary':
            self.drop_idx_ = np.array([0 if len(c) == 2 else -1 for c in cats])
        return self

    def transform(self, X):
        check_is_fitted(self)
        cols, n = _cols(X)
        blocks = []
        for j, cats in enumerate(self.categories_):
            cl = cats.tolist()
            block = np.zeros((n, len(cl)))
            for i in range(n):
                v = cols[j][i]
                if v in cl:
                    block[i, cl.index(v)] = 1.0
                elif self.handle_unknown == 'error':
                    raise ValueError('Found unknown categories [%r] in column %d during transform' % (v, j))
            if self.drop_idx_ is not None and self.drop_idx_[j] >= 0:
                block = np.delete(block, self.drop_idx_[j], axis=1)
            blocks.append(block)
        out = np.hstack(blocks) if blocks else np.zeros((n, 0))
        out = out.astype(self.dtype)
        if getattr(self, '_output_pandas', False):
            import pandas as pd
            return pd.DataFrame(out, columns=list(self.get_feature_names_out()), index=X.index if hasattr(X, 'index') else None)
        return _Sparse(out) if self.sparse_output else out

    def inverse_transform(self, X):
        A = np.asarray(_to_array(X))
        cols = []
        k = 0
        for j, cats in enumerate(self.categories_):
            dropped = self.drop_idx_ is not None and self.drop_idx_[j] >= 0
            m = len(cats) - (1 if dropped else 0)
            block = A[:, k:k + m]
            k += m
            full = cats.tolist()
            cl = [c for i, c in enumerate(full) if not (dropped and i == self.drop_idx_[j])]
            cols.append([cl[int(np.argmax(r))] if (r.sum() > 0 or not dropped) else full[self.drop_idx_[j]] for r in block])
        return np.array(cols).T

    def get_feature_names_out(self, input_features=None):
        names = input_features if input_features is not None else getattr(self, 'feature_names_in_', None)
        if names is None:
            names = ['x%d' % j for j in range(len(self.categories_))]
        out = []
        for j, cats in enumerate(self.categories_):
            for i, c in enumerate(cats.tolist()):
                if self.drop_idx_ is not None and self.drop_idx_[j] >= 0 and i == self.drop_idx_[j]:
                    continue
                out.append('%s_%s' % (names[j], c))
        return np.array(out)


class OrdinalEncoder(TransformerMixin, BaseEstimator):
    def __init__(self, *, categories='auto', dtype=np.float64, handle_unknown='error', unknown_value=None, encoded_missing_value=np.nan):
        self.categories = categories
        self.dtype = dtype
        self.handle_unknown = handle_unknown
        self.unknown_value = unknown_value
        self.encoded_missing_value = encoded_missing_value

    def fit(self, X, y=None):
        cols, n = _cols(X)
        self.n_features_in_ = len(cols)
        if hasattr(X, 'columns'):
            self.feature_names_in_ = np.array([str(c) for c in X.columns])
        self.categories_ = [np.array(_unique_sorted(_Col(c))) if self.categories == 'auto' else np.array(self.categories[j]) for j, c in enumerate(cols)]
        return self

    def transform(self, X):
        check_is_fitted(self)
        cols, n = _cols(X)
        out = np.zeros((n, len(cols)), dtype=np.float64)
        for j, cats in enumerate(self.categories_):
            cl = cats.tolist()
            for i in range(n):
                v = cols[j][i]
                if v in cl:
                    out[i, j] = cl.index(v)
                elif self.handle_unknown == 'use_encoded_value':
                    out[i, j] = self.unknown_value
                else:
                    raise ValueError('Found unknown categories [%r] in column %d during transform' % (v, j))
        return _out(self, X, out)

    def inverse_transform(self, X):
        A = np.asarray(_to_array(X))
        cols = []
        for j, cats in enumerate(self.categories_):
            cl = cats.tolist()
            cols.append([cl[int(v)] for v in A[:, j].tolist()])
        return np.array(cols).T

    def get_feature_names_out(self, input_features=None):
        names = input_features if input_features is not None else getattr(self, 'feature_names_in_', None)
        return np.array(names if names is not None else ['x%d' % j for j in range(self.n_features_in_)])


class LabelEncoder(TransformerMixin, BaseEstimator):
    def fit(self, y):
        y = np.asarray(_to_array(y)).ravel()
        self.classes_ = np.unique(y)
        return self

    def transform(self, y):
        check_is_fitted(self)
        y = np.asarray(_to_array(y)).ravel()
        cl = self.classes_.tolist()
        out = []
        for v in y.tolist():
            if v not in cl:
                raise ValueError('y contains previously unseen labels: %r' % (v,))
            out.append(cl.index(v))
        return np.array(out, dtype=np.int64)

    def fit_transform(self, y):
        return self.fit(y).transform(y)

    def inverse_transform(self, y):
        cl = self.classes_
        return cl[np.asarray(y, dtype=int)]


class LabelBinarizer(TransformerMixin, BaseEstimator):
    def __init__(self, *, neg_label=0, pos_label=1, sparse_output=False):
        self.neg_label = neg_label
        self.pos_label = pos_label
        self.sparse_output = sparse_output

    def fit(self, y):
        self.classes_ = np.unique(np.asarray(_to_array(y)))
        return self

    def transform(self, y):
        y = np.asarray(_to_array(y))
        cl = self.classes_.tolist()
        if len(cl) == 2:
            return np.array([[self.pos_label if v == cl[1] else self.neg_label] for v in y.tolist()])
        out = np.full((len(y), len(cl)), self.neg_label)
        for i, v in enumerate(y.tolist()):
            out[i, cl.index(v)] = self.pos_label
        return out

    def inverse_transform(self, Y):
        Y = np.asarray(Y)
        if Y.shape[1] == 1:
            return self.classes_[(Y[:, 0] > 0.5).astype(int)]
        return self.classes_[Y.argmax(axis=1)]


def label_binarize(y, *, classes, neg_label=0, pos_label=1):
    lb = LabelBinarizer(neg_label=neg_label, pos_label=pos_label).fit(classes)
    out = lb.transform(y)
    if len(classes) == 2:
        return out
    return out


class PolynomialFeatures(TransformerMixin, BaseEstimator):
    def __init__(self, degree=2, *, interaction_only=False, include_bias=True, order='C'):
        self.degree = degree
        self.interaction_only = interaction_only
        self.include_bias = include_bias
        self.order = order

    def _combos(self, n):
        out = []
        comb = itertools.combinations if self.interaction_only else itertools.combinations_with_replacement
        start = 0 if self.include_bias else 1
        for d in range(start, self.degree + 1):
            for c in comb(range(n), d):
                out.append(c)
        return out

    def fit(self, X, y=None):
        X = self._validate_data(X, reset=True)
        self.n_output_features_ = len(self._combos(X.shape[1]))
        return self

    def transform(self, X):
        check_is_fitted(self)
        Xa = self._validate_data(X, reset=False)
        cols = []
        for c in self._combos(Xa.shape[1]):
            col = np.ones(Xa.shape[0])
            for j in c:
                col = col * Xa[:, j]
            cols.append(col)
        return _out(self, X, np.column_stack(cols))

    def get_feature_names_out(self, input_features=None):
        names = input_features if input_features is not None else getattr(self, 'feature_names_in_', None)
        if names is None:
            names = ['x%d' % i for i in range(self.n_features_in_)]
        out = []
        for c in self._combos(len(names)):
            if not c:
                out.append('1')
                continue
            parts = []
            for j in sorted(set(c)):
                p = c.count(j)
                parts.append(names[j] if p == 1 else '%s^%d' % (names[j], p))
            out.append(' '.join(parts))
        return np.array(out)


class KBinsDiscretizer(TransformerMixin, BaseEstimator):
    def __init__(self, n_bins=5, *, encode='onehot', strategy='quantile', dtype=None, subsample=200000, random_state=None):
        self.n_bins = n_bins
        self.encode = encode
        self.strategy = strategy
        self.dtype = dtype
        self.subsample = subsample
        self.random_state = random_state

    def fit(self, X, y=None):
        X = self._validate_data(X, reset=True)
        edges = []
        for j in range(X.shape[1]):
            col = X[:, j]
            if self.strategy == 'uniform':
                e = np.linspace(col.min(), col.max(), self.n_bins + 1)
            else:
                e = np.percentile(col, np.linspace(0, 100, self.n_bins + 1))
            edges.append(e)
        self.bin_edges_ = np.array(edges) if len(set(len(e) for e in edges)) > 1 else np.array(edges)
        self.n_bins_ = np.array([len(e) - 1 for e in edges])
        return self

    def transform(self, X):
        check_is_fitted(self)
        Xa = self._validate_data(X, reset=False)
        out = np.zeros(Xa.shape)
        for j in range(Xa.shape[1]):
            e = np.asarray(self.bin_edges_[j])
            out[:, j] = np.clip(np.searchsorted(e[1:-1], Xa[:, j], side='right'), 0, len(e) - 2)
        if self.encode == 'ordinal':
            return out
        blocks = []
        for j in range(Xa.shape[1]):
            b = np.zeros((Xa.shape[0], int(self.n_bins_[j])))
            b[np.arange(Xa.shape[0]), out[:, j].astype(int)] = 1.0
            blocks.append(b)
        res = np.hstack(blocks)
        return _Sparse(res) if self.encode == 'onehot' else res


def scale(X, *, axis=0, with_mean=True, with_std=True, copy=True):
    X = np.asarray(_to_array(X), dtype=np.float64)
    if axis == 1:
        return scale(X.T, with_mean=with_mean, with_std=with_std).T
    out = X.copy()
    if with_mean:
        out = out - X.mean(axis=0)
    if with_std:
        s = X.std(axis=0)
        out = out / np.where(s == 0, 1.0, s)
    return out


def minmax_scale(X, feature_range=(0, 1), *, axis=0, copy=True):
    return MinMaxScaler(feature_range=feature_range).fit_transform(X)


def binarize(X, *, threshold=0.0, copy=True):
    return Binarizer(threshold=threshold).fit_transform(X)
