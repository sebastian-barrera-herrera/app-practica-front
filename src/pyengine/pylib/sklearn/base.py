import copy
import inspect
import numpy as np

from sklearn.exceptions import NotFittedError


def _fmt(v):
    if isinstance(v, float):
        return repr(v)
    return repr(v)


class BaseEstimator:
    @classmethod
    def _get_param_names(cls):
        init = cls.__init__
        if init is object.__init__:
            return []
        sig = inspect.signature(init)
        return sorted(p.name for p in sig.parameters.values() if p.name != 'self' and p.kind != p.VAR_KEYWORD and p.kind != p.VAR_POSITIONAL)

    def get_params(self, deep=True):
        out = {}
        for key in self._get_param_names():
            value = getattr(self, key)
            if deep and hasattr(value, 'get_params') and not isinstance(value, type):
                for k, v in value.get_params().items():
                    out[key + '__' + k] = v
            out[key] = value
        return out

    def set_params(self, **params):
        if not params:
            return self
        valid = self.get_params(deep=True)
        nested = {}
        for key, value in params.items():
            key, delim, sub = key.partition('__')
            if key not in valid:
                raise ValueError('Invalid parameter %r for estimator %s. Valid parameters are: %r.' % (key, self, sorted(self._get_param_names())))
            if delim:
                nested.setdefault(key, {})[sub] = value
            else:
                setattr(self, key, value)
        for key, sub in nested.items():
            valid[key].set_params(**sub)
        return self

    def _changed_params(self):
        sig = inspect.signature(self.__class__.__init__)
        defaults = {p.name: p.default for p in sig.parameters.values() if p.name != 'self'}
        out = []
        for k in self._get_param_names():
            v = getattr(self, k, None)
            d = defaults.get(k)
            try:
                same = (v is d) or (v == d and type(v) == type(d))
            except Exception:
                same = False
            if isinstance(v, float) and isinstance(d, float) and v != v and d != d:
                same = True
            if not same:
                out.append((k, v))
        return out

    def __repr__(self, N_CHAR_MAX=700):
        import re
        from sklearn.utils._pprint import _EstimatorPrettyPrinter
        pp = _EstimatorPrettyPrinter(compact=True, indent=1, indent_at_name=True, n_max_elements_to_show=30)
        repr_ = pp.pformat(self)
        n_nonblank = len("".join(repr_.split()))
        if n_nonblank > N_CHAR_MAX:
            lim = N_CHAR_MAX // 2
            regex = r"^(\s*\S){%d}" % lim
            left_lim = re.match(regex, repr_).end()
            right_lim = re.match(regex, repr_[::-1]).end()
            if "\n" in repr_[left_lim:-right_lim]:
                regex += r"[^\n]*\n"
                right_lim = re.match(regex, repr_[::-1]).end()
            if left_lim + 3 < len(repr_) - right_lim:
                repr_ = repr_[:left_lim] + "..." + repr_[-right_lim:]
        return repr_

    def __sklearn_is_fitted__(self):
        return any(k.endswith('_') and not k.startswith('__') for k in vars(self))

    def _validate_data(self, X, y='no_validation', reset=True, **kw):
        from sklearn.utils import check_array, check_X_y
        names = None
        if hasattr(X, 'columns'):
            names = np.array([str(c) for c in list(X.columns)])
        if y is None or (isinstance(y, str) and y == 'no_validation'):
            X = check_array(X, estimator=self, **{k: v for k, v in kw.items() if k in ('dtype', 'ensure_min_samples', 'ensure_all_finite')})
            out = X
        else:
            X, y = check_X_y(X, y, estimator=self, **{k: v for k, v in kw.items() if k in ('dtype', 'ensure_all_finite')})
            out = (X, y)
        if reset:
            self.n_features_in_ = X.shape[1]
            if names is not None:
                self.feature_names_in_ = names
        else:
            nf = getattr(self, 'n_features_in_', None)
            if nf is not None and X.shape[1] != nf:
                raise ValueError('X has %d features, but %s is expecting %d features as input.' % (X.shape[1], self.__class__.__name__, nf))
        return out

    def set_output(self, *, transform=None):
        self._output_pandas = transform == 'pandas'
        return self

    def __getstate__(self):
        return dict(self.__dict__)


class ClassifierMixin:
    _estimator_type = 'classifier'

    def score(self, X, y, sample_weight=None):
        from sklearn.metrics import accuracy_score
        return accuracy_score(y, self.predict(X), sample_weight=sample_weight)


class RegressorMixin:
    _estimator_type = 'regressor'

    def score(self, X, y, sample_weight=None):
        from sklearn.metrics import r2_score
        return r2_score(y, self.predict(X), sample_weight=sample_weight)


class ClusterMixin:
    _estimator_type = 'clusterer'

    def fit_predict(self, X, y=None, **kw):
        self.fit(X, **kw)
        return self.labels_


class TransformerMixin:
    def fit_transform(self, X, y=None, **fit_params):
        if y is None:
            return self.fit(X, **fit_params).transform(X)
        return self.fit(X, y, **fit_params).transform(X)

    def _wrap(self, X, out):
        if getattr(self, '_output_pandas', False):
            import pandas as pd
            cols = self.get_feature_names_out() if hasattr(self, 'get_feature_names_out') else None
            idx = X.index if hasattr(X, 'index') else None
            return pd.DataFrame(out, columns=list(cols) if cols is not None else None, index=idx)
        return out


class OneToOneFeatureMixin:
    def get_feature_names_out(self, input_features=None):
        if input_features is not None:
            return np.array(input_features)
        names = getattr(self, 'feature_names_in_', None)
        if names is not None:
            return names
        return np.array(['x%d' % i for i in range(self.n_features_in_)])


class BiclusterMixin:
    pass


class MetaEstimatorMixin:
    pass


def clone(estimator, *, safe=True):
    if isinstance(estimator, (list, tuple, set)):
        return type(estimator)([clone(e, safe=safe) for e in estimator])
    if not hasattr(estimator, 'get_params'):
        if not safe:
            return copy.deepcopy(estimator)
        raise TypeError("Cannot clone object '%s' (type %s): it does not seem to be a scikit-learn estimator as it does not implement a 'get_params' method." % (estimator, type(estimator)))
    klass = estimator.__class__
    params = estimator.get_params(deep=False)
    new = {k: clone(v, safe=False) for k, v in params.items()}
    return klass(**new)


def is_classifier(est):
    return getattr(est, '_estimator_type', None) == 'classifier'


def is_regressor(est):
    return getattr(est, '_estimator_type', None) == 'regressor'


def check_is_fitted(estimator, attributes=None):
    if attributes is not None:
        attrs = attributes if isinstance(attributes, (list, tuple)) else [attributes]
        fitted = all(hasattr(estimator, a) for a in attrs)
    elif hasattr(estimator, '__sklearn_is_fitted__'):
        fitted = bool(estimator.__sklearn_is_fitted__())
    else:
        fitted = any(k.endswith('_') and not k.startswith('__') for k in vars(estimator))
    if not fitted:
        raise NotFittedError("This %s instance is not fitted yet. Call 'fit' with appropriate arguments before using this estimator." % type(estimator).__name__)
