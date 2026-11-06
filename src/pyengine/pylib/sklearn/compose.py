import re
import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, RegressorMixin, clone, check_is_fitted
from sklearn.utils import Bunch, _to_array
from sklearn.utils.metaestimators import _BaseComposition
from sklearn.pipeline import _name_estimators


def _is_pass(t):
    return isinstance(t, str) and t == 'passthrough'


def _is_drop(t):
    return isinstance(t, str) and t == 'drop'


class make_column_selector:
    def __init__(self, pattern=None, *, dtype_include=None, dtype_exclude=None):
        self.pattern = pattern
        self.dtype_include = dtype_include
        self.dtype_exclude = dtype_exclude

    def __call__(self, df):
        if not hasattr(df, 'iloc'):
            raise ValueError('make_column_selector can only be applied to pandas dataframes')
        df_row = df.iloc[:1]
        if self.dtype_include is not None or self.dtype_exclude is not None:
            df_row = df_row.select_dtypes(include=self.dtype_include, exclude=self.dtype_exclude)
        cols = [c for c in df_row.columns]
        if self.pattern is not None:
            cols = [c for c in cols if re.search(self.pattern, str(c))]
        return cols


make_column_selector.__module__ = 'sklearn.compose._column_transformer'


def _is_empty_selection(col):
    if isinstance(col, (list, tuple, np.ndarray)):
        return len(col) == 0
    if isinstance(col, slice):
        return False
    return False


def _n_cols(X):
    return X.shape[1]


def _col_names(X):
    if hasattr(X, 'columns'):
        return [c for c in X.columns]
    return None


def _column_indices(X, key):
    n = _n_cols(X)
    names = _col_names(X)
    if isinstance(key, (str, int, np.integer)) and not isinstance(key, bool):
        if isinstance(key, str):
            if names is None or key not in names:
                raise ValueError('A given column is not a column of the dataframe' if names is not None else 'Specifying the columns using strings is only supported for dataframes.')
            return [names.index(key)]
        return [int(key) % n if key < 0 else int(key)]
    if isinstance(key, slice):
        if names is not None and (isinstance(key.start, str) or isinstance(key.stop, str)):
            a = names.index(key.start) if key.start is not None else 0
            b = names.index(key.stop) + 1 if key.stop is not None else n
            return list(range(a, b))
        return list(range(n))[key]
    arr = np.asarray(key)
    if arr.dtype == bool:
        return [int(i) for i in np.nonzero(arr)[0]]
    out = []
    for k in list(key):
        if isinstance(k, str):
            if names is None or k not in names:
                raise ValueError('A given column is not a column of the dataframe' if names is not None else 'Specifying the columns using strings is only supported for dataframes.')
            out.append(names.index(k))
        else:
            out.append(int(k))
    return out


def _get_column(X, key):
    scalar = isinstance(key, (str, int, np.integer)) and not isinstance(key, bool)
    if scalar:
        if hasattr(X, 'iloc'):
            return X[key] if isinstance(key, str) else X.iloc[:, int(key)]
        return X[:, int(key)]
    idx = _column_indices(X, key)
    if hasattr(X, 'iloc'):
        if isinstance(key, (list, tuple)) and len(key) and all(isinstance(k, str) for k in key):
            return X[list(key)]
        return X.iloc[:, idx]
    return X[:, idx]


def _fit_transform_one(trans, X, y, weight):
    if hasattr(trans, 'fit_transform'):
        res = trans.fit_transform(X, y)
    else:
        res = trans.fit(X, y).transform(X)
    if weight is not None:
        res = res * weight
    return res, trans


class ColumnTransformer(TransformerMixin, _BaseComposition):
    def __init__(self, transformers, *, remainder='drop', sparse_threshold=0.3, n_jobs=None, transformer_weights=None, verbose=False, verbose_feature_names_out=True):
        self.transformers = transformers
        self.remainder = remainder
        self.sparse_threshold = sparse_threshold
        self.n_jobs = n_jobs
        self.transformer_weights = transformer_weights
        self.verbose = verbose
        self.verbose_feature_names_out = verbose_feature_names_out

    @property
    def _transformers(self):
        try:
            return [(name, trans) for name, trans, _ in self.transformers]
        except (TypeError, ValueError):
            return self.transformers

    @_transformers.setter
    def _transformers(self, value):
        self.transformers = [(name, trans, col) for ((name, trans), (_, _, col)) in zip(value, self.transformers)]

    def get_params(self, deep=True):
        return self._get_params('_transformers', deep=deep)

    def set_params(self, **kwargs):
        self._set_params('_transformers', **kwargs)
        return self

    def set_output(self, *, transform=None):
        super().set_output(transform=transform)
        for _, trans, _ in self.transformers:
            if hasattr(trans, 'set_output'):
                trans.set_output(transform=transform)
        if hasattr(self.remainder, 'set_output'):
            self.remainder.set_output(transform=transform)
        return self

    @property
    def named_transformers_(self):
        return Bunch(**{name: trans for name, trans, _ in self.transformers_})

    def _validate_transformers(self):
        if not self.transformers:
            return
        names, transformers, _ = zip(*self.transformers)
        self._validate_names(names)
        for t in transformers:
            if _is_pass(t) or _is_drop(t):
                continue
            if not (hasattr(t, 'fit') or hasattr(t, 'fit_transform')) or not hasattr(t, 'transform'):
                raise TypeError("All estimators should implement fit and transform, or can be 'drop' or 'passthrough' specifiers. '%s' (type %s) doesn't." % (t, type(t)))

    def _validate_remainder(self, X):
        if not (_is_pass(self.remainder) or _is_drop(self.remainder) or (hasattr(self.remainder, 'fit') or hasattr(self.remainder, 'fit_transform')) and hasattr(self.remainder, 'transform')):
            raise ValueError("The remainder keyword needs to be one of 'drop', 'passthrough', or estimator. '%s' was passed instead" % self.remainder)
        cols = set()
        for idx in self._indices.values():
            cols |= set(idx)
        remaining = sorted(set(range(self.n_features_in_)) - cols)
        self._remainder = ('remainder', self.remainder, remaining)
        self._indices['remainder'] = remaining

    def _resolve(self, X):
        self._columns = []
        self._indices = {}
        for name, trans, col in self.transformers:
            c = col(X) if callable(col) else col
            self._columns.append(c)
            self._indices[name] = _column_indices(X, c) if not _is_empty_selection(c) else []

    def _check_X(self, X):
        if hasattr(X, 'iloc') or hasattr(X, 'shape'):
            return X
        return np.asarray(X)

    def _iter_unfitted(self):
        for (name, trans, _), col in zip(self.transformers, self._columns):
            yield name, trans, col
        if self._remainder[2]:
            yield self._remainder

    def fit(self, X, y=None, **params):
        self.fit_transform(X, y=y, **params)
        return self

    def fit_transform(self, X, y=None, **params):
        X = self._check_X(X)
        self.n_features_in_ = _n_cols(X)
        names = _col_names(X)
        if names is not None and all(isinstance(c, str) for c in names):
            self.feature_names_in_ = np.array(names)
        self._validate_transformers()
        self._resolve(X)
        self._validate_remainder(X)
        weights = self.transformer_weights or {}
        results = []
        fitted = []
        self.transformers_ = []
        for name, trans, col in self._iter_unfitted():
            if _is_drop(trans) or _is_empty_selection(col):
                fitted.append((name, trans, col))
                results.append((name, None))
                continue
            sub = _get_column(X, col)
            if _is_pass(trans):
                from sklearn.preprocessing import FunctionTransformer
                trans = FunctionTransformer(accept_sparse=True, check_inverse=False, feature_names_out='one-to-one')
            res, ft = _fit_transform_one(clone(trans), sub, y, weights.get(name))
            results.append((name, res))
            fitted.append((name, ft, col))
        self.transformers_ = fitted
        return self._assemble(X, results)

    def _assemble(self, X, results):
        blocks = []
        self.output_indices_ = {}
        start = 0
        for name, res in results:
            if res is None:
                self.output_indices_[name] = slice(0, 0)
                continue
            a = res
            if not hasattr(a, 'toarray'):
                a = np.asarray(_to_array(a))
                if a.ndim == 1:
                    a = a.reshape(-1, 1)
            w = a.shape[1]
            self.output_indices_[name] = slice(start, start + w)
            start += w
            blocks.append(a)
        if 'remainder' not in self.output_indices_:
            self.output_indices_['remainder'] = slice(0, 0)
        if not blocks:
            return np.zeros((X.shape[0], 0))
        if not hasattr(self, 'sparse_output_') or True:
            nnz = 0
            total = 0
            any_sparse = False
            for b in blocks:
                if hasattr(b, 'toarray'):
                    any_sparse = True
                    nnz += b.nnz
                    total += b.shape[0] * b.shape[1]
                else:
                    nnz += b.size
                    total += b.size
            self.sparse_output_ = bool(any_sparse and total > 0 and nnz / total < self.sparse_threshold)
        dense = [np.asarray(_to_array(b)) for b in blocks]
        out = np.hstack(dense)
        if self.sparse_output_:
            from sklearn.preprocessing import _Sparse
            return _Sparse(out)
        if getattr(self, '_output_pandas', False):
            import pandas as pd
            idx = X.index if hasattr(X, 'index') else None
            return pd.DataFrame(out, columns=list(self.get_feature_names_out()), index=idx)
        return out

    def transform(self, X, **params):
        check_is_fitted(self, 'transformers_')
        X = self._check_X(X)
        if _n_cols(X) != self.n_features_in_:
            raise ValueError('X has %d features, but ColumnTransformer is expecting %d features as input.' % (_n_cols(X), self.n_features_in_))
        names = _col_names(X)
        if hasattr(self, 'feature_names_in_') and names is not None:
            missing = set(self.feature_names_in_.tolist()) - set(names)
            if missing:
                raise ValueError('columns are missing: %r' % missing)
        weights = self.transformer_weights or {}
        results = []
        for name, trans, col in self.transformers_:
            if _is_drop(trans) or _is_empty_selection(col):
                results.append((name, None))
                continue
            sub = _get_column(X, col)
            out = trans.transform(sub)
            w = weights.get(name)
            results.append((name, out if w is None else out * w))
        return self._assemble(X, results)

    def _in_names(self, input_features):
        if input_features is not None:
            return list(input_features)
        names = getattr(self, 'feature_names_in_', None)
        if names is not None:
            return names.tolist()
        return ['x%d' % i for i in range(self.n_features_in_)]

    def get_feature_names_out(self, input_features=None):
        check_is_fitted(self, 'transformers_')
        fin = self._in_names(input_features)
        pairs = []
        for name, trans, col in self.transformers_:
            if _is_drop(trans) or _is_empty_selection(col):
                continue
            idx = self._indices[name]
            sub = [fin[i] for i in idx]
            if not hasattr(trans, 'get_feature_names_out'):
                raise AttributeError('Transformer %s (type %s) does not provide get_feature_names_out.' % (name, type(trans).__name__))
            out = list(trans.get_feature_names_out(sub))
            pairs.append((name, out))
        if not pairs:
            return np.array([])
        if self.verbose_feature_names_out:
            names = ['%s__%s' % (n, f) for n, fs in pairs for f in fs]
        else:
            names = [f for _, fs in pairs for f in fs]
            if len(set(names)) != len(names):
                dup = sorted(set(n for n in names if names.count(n) > 1))
                raise ValueError('Output feature names: %r are not unique. Please set verbose_feature_names_out=True to add prefixes to feature names' % dup)
        return np.asarray(names)

    def __getitem__(self, key):
        return self.named_transformers_[key]

    def __sklearn_is_fitted__(self):
        return hasattr(self, 'transformers_')


def make_column_transformer(*transformers, remainder='drop', sparse_threshold=0.3, n_jobs=None, verbose=False, verbose_feature_names_out=True):
    transformer_list = [(t, c) for t, c in transformers]
    named = _name_estimators([t for t, _ in transformer_list])
    triples = [(name, t, c) for (name, t), (_, c) in zip(named, transformer_list)]
    return ColumnTransformer(triples, n_jobs=n_jobs, remainder=remainder, sparse_threshold=sparse_threshold, verbose=verbose, verbose_feature_names_out=verbose_feature_names_out)


class TransformedTargetRegressor(RegressorMixin, BaseEstimator):
    def __init__(self, regressor=None, *, transformer=None, func=None, inverse_func=None, check_inverse=True):
        self.regressor = regressor
        self.transformer = transformer
        self.func = func
        self.inverse_func = inverse_func
        self.check_inverse = check_inverse

    def fit(self, X, y, **fit_params):
        y = np.asarray(_to_array(y))
        self._training_dim = y.ndim
        y2 = y.reshape(-1, 1) if y.ndim == 1 else y
        if self.transformer is not None and (self.func is not None or self.inverse_func is not None):
            raise ValueError("'transformer' and functions 'func'/'inverse_func' cannot both be set.")
        if self.transformer is not None:
            self.transformer_ = clone(self.transformer)
        else:
            from sklearn.preprocessing import FunctionTransformer
            if (self.func is not None and self.inverse_func is None) or (self.func is None and self.inverse_func is not None):
                raise ValueError("When 'func' is provided, 'inverse_func' must also be provided")
            self.transformer_ = FunctionTransformer(func=self.func, inverse_func=self.inverse_func, validate=True, check_inverse=self.check_inverse)
        self.transformer_.fit(y2)
        yt = np.asarray(self.transformer_.transform(y2))
        if self._training_dim == 1 and yt.ndim == 2 and yt.shape[1] == 1:
            yt = yt.ravel()
        if self.regressor is None:
            from sklearn.linear_model import LinearRegression
            self.regressor_ = LinearRegression()
        else:
            self.regressor_ = clone(self.regressor)
        self.regressor_.fit(X, yt, **fit_params)
        if hasattr(self.regressor_, 'feature_names_in_'):
            self.feature_names_in_ = self.regressor_.feature_names_in_
        self.n_features_in_ = self.regressor_.n_features_in_
        return self

    def predict(self, X, **predict_params):
        check_is_fitted(self, 'regressor_')
        pred = np.asarray(self.regressor_.predict(X, **predict_params))
        p2 = pred.reshape(-1, 1) if pred.ndim == 1 else pred
        inv = np.asarray(self.transformer_.inverse_transform(p2))
        if self._training_dim == 1 and inv.ndim == 2 and inv.shape[1] == 1:
            inv = inv.ravel()
        return inv
