from sklearn.utils._param_validation import check_interval
import math
import numbers
import warnings
import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, clone, check_is_fitted, is_classifier
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, _resolve_max_features
from sklearn.utils import check_random_state, _to_array, sample_without_replacement

MAX_INT = np.iinfo(np.int32).max


def _set_random_states(estimator, random_state):
    random_state = check_random_state(random_state)
    to_set = {}
    for key in sorted(estimator.get_params(deep=True)):
        if key == 'random_state' or key.endswith('__random_state'):
            to_set[key] = random_state.randint(MAX_INT)
    if to_set:
        estimator.set_params(**to_set)


class _BaseEnsemble(BaseEstimator):
    def _make_estimator(self, append=True, random_state=None):
        est = clone(self.estimator_)
        if hasattr(self, 'estimator_params'):
            est.set_params(**{p: getattr(self, p) for p in self.estimator_params})
        if random_state is not None:
            _set_random_states(est, random_state)
        if append:
            self.estimators_.append(est)
        return est

    def __len__(self):
        return len(self.estimators_)

    def __getitem__(self, i):
        return self.estimators_[i]

    def __iter__(self):
        return iter(self.estimators_)


# ───────────────────────── bosques aleatorios ─────────────────────────

def _bootstrap_indices(seed, n_samples, n_bootstrap):
    rs = check_random_state(seed)
    return rs.randint(0, n_samples, n_bootstrap)


class BaseForest(_BaseEnsemble):
    estimator_params = ('criterion', 'max_depth', 'min_samples_split', 'min_samples_leaf', 'min_weight_fraction_leaf', 'max_features', 'max_leaf_nodes', 'min_impurity_decrease', 'random_state', 'ccp_alpha')

    def _fit_forest(self, X, y_enc, sample_weight, n_classes):
        n = X.shape[0]
        random_state = check_random_state(self.random_state)
        self.estimators_ = []
        if self.max_samples is None:
            n_boot = n
        elif isinstance(self.max_samples, numbers.Integral):
            n_boot = self.max_samples
        else:
            n_boot = max(int(self.max_samples * n), 1)
        if not self.bootstrap and self.oob_score:
            raise ValueError('Out of bag estimation only available if bootstrap=True')
        trees = [self._make_estimator(append=False, random_state=random_state) for _ in range(self.n_estimators)]
        self._n_boot = n_boot
        for t in trees:
            if self.bootstrap:
                idx = _bootstrap_indices(t.random_state, n, n_boot)
                counts = np.bincount(idx, minlength=n).astype(np.float64)
                sw = counts if sample_weight is None else counts * sample_weight
                if getattr(self, 'class_weight', None) == 'balanced_subsample' and n_classes:
                    cc = np.bincount(y_enc[idx].astype(int), minlength=n_classes)
                    cw = len(idx) / (n_classes * np.where(cc == 0, 1, cc))
                    sw = sw * cw[y_enc.astype(int)]
                t._fit(X, y_enc, sw, [n_classes] if n_classes else None)
            else:
                t._fit(X, y_enc, sample_weight, [n_classes] if n_classes else None)
            if n_classes:
                t.classes_ = np.arange(n_classes)
                t.n_classes_ = n_classes
            self.estimators_.append(t)
        self.n_features_in_ = X.shape[1]

    @property
    def feature_importances_(self):
        check_is_fitted(self)
        imps = [t.feature_importances_ for t in self.estimators_ if t.tree_.node_count > 1]
        if not imps:
            return np.zeros(self.n_features_in_)
        all_imp = np.mean(imps, axis=0)
        return all_imp / np.sum(all_imp)

    def apply(self, X):
        X = self._validate_data(X, reset=False)
        return np.array([t.tree_.apply(X) for t in self.estimators_]).T

    def _oob_masks(self, n):
        masks = []
        for t in self.estimators_:
            idx = _bootstrap_indices(t.random_state, n, self._n_boot)
            m = np.ones(n, dtype=bool)
            m[idx] = False
            masks.append(m)
        return masks


class RandomForestClassifier(ClassifierMixin, BaseForest):
    def __init__(self, n_estimators=100, *, criterion='gini', max_depth=None, min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_features='sqrt', max_leaf_nodes=None, min_impurity_decrease=0.0, bootstrap=True, oob_score=False, n_jobs=None, random_state=None, verbose=0, warm_start=False, class_weight=None, ccp_alpha=0.0, max_samples=None, monotonic_cst=None):
        self.n_estimators = n_estimators
        self.criterion = criterion
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_features = max_features
        self.max_leaf_nodes = max_leaf_nodes
        self.min_impurity_decrease = min_impurity_decrease
        self.bootstrap = bootstrap
        self.oob_score = oob_score
        self.n_jobs = n_jobs
        self.random_state = random_state
        self.verbose = verbose
        self.warm_start = warm_start
        self.class_weight = class_weight
        self.ccp_alpha = ccp_alpha
        self.max_samples = max_samples
        self.monotonic_cst = monotonic_cst
        self.estimator_ = DecisionTreeClassifier()

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        self.n_outputs_ = 1
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        if self.class_weight is not None and self.class_weight != 'balanced_subsample':
            if self.class_weight == 'balanced':
                cnt = np.bincount(yi)
                cw = len(y) / (len(cnt) * cnt)
            else:
                cw = np.array([self.class_weight.get(c, 1.0) for c in self.classes_.tolist()])
            sw = cw[yi] if sw is None else sw * cw[yi]
        self.estimator_ = DecisionTreeClassifier()
        self._fit_forest(X, yi.astype(np.float64), sw, self.n_classes_)
        if self.oob_score:
            n = X.shape[0]
            proba = np.zeros((n, self.n_classes_))
            cnt = np.zeros(n)
            for t, m in zip(self.estimators_, self._oob_masks(n)):
                if m.any():
                    proba[m] += t.predict_proba(X[m])
                    cnt[m] += 1
            with_p = cnt > 0
            proba[with_p] /= cnt[with_p][:, None]
            proba[~with_p] = np.nan
            self.oob_decision_function_ = proba
            self.oob_score_ = float(np.mean(np.argmax(proba[with_p], axis=1) == yi[with_p]))
        return self

    def predict_proba(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        acc = np.zeros((X.shape[0], self.n_classes_))
        for t in self.estimators_:
            acc += t.predict_proba(X)
        return acc / len(self.estimators_)

    def predict_log_proba(self, X):
        return np.log(self.predict_proba(X))

    def predict(self, X):
        return self.classes_.take(np.argmax(self.predict_proba(X), axis=1))


class RandomForestRegressor(RegressorMixin, BaseForest):
    def __init__(self, n_estimators=100, *, criterion='squared_error', max_depth=None, min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_features=1.0, max_leaf_nodes=None, min_impurity_decrease=0.0, bootstrap=True, oob_score=False, n_jobs=None, random_state=None, verbose=0, warm_start=False, ccp_alpha=0.0, max_samples=None, monotonic_cst=None):
        self.n_estimators = n_estimators
        self.criterion = criterion
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_features = max_features
        self.max_leaf_nodes = max_leaf_nodes
        self.min_impurity_decrease = min_impurity_decrease
        self.bootstrap = bootstrap
        self.oob_score = oob_score
        self.n_jobs = n_jobs
        self.random_state = random_state
        self.verbose = verbose
        self.warm_start = warm_start
        self.ccp_alpha = ccp_alpha
        self.max_samples = max_samples
        self.monotonic_cst = monotonic_cst
        self.estimator_ = DecisionTreeRegressor()

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.n_outputs_ = 1
        self.estimator_ = DecisionTreeRegressor()
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._fit_forest(X, np.asarray(y, dtype=np.float64), sw, None)
        if self.oob_score:
            n = X.shape[0]
            pred = np.zeros(n)
            cnt = np.zeros(n)
            for t, m in zip(self.estimators_, self._oob_masks(n)):
                if m.any():
                    pred[m] += t.predict(X[m])
                    cnt[m] += 1
            ok = cnt > 0
            pred[ok] /= cnt[ok]
            pred[~ok] = np.nan
            self.oob_prediction_ = pred
            from sklearn.metrics import r2_score
            self.oob_score_ = r2_score(y[ok], pred[ok])
        return self

    def predict(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        acc = np.zeros(X.shape[0])
        for t in self.estimators_:
            acc += t.predict(X)
        return acc / len(self.estimators_)


# ───────────────────────── bagging ─────────────────────────

def _gen_indices(rs, bootstrap, n_population, n_samples):
    if bootstrap:
        return rs.randint(0, n_population, n_samples)
    return sample_without_replacement(n_population, n_samples, random_state=rs)


class _BaseBagging(_BaseEnsemble):
    def _fit_bagging(self, X, y, sample_weight, n_classes):
        n, d = X.shape
        random_state = check_random_state(self.random_state)
        max_samples = n if self.max_samples is None else (self.max_samples if isinstance(self.max_samples, numbers.Integral) else int(self.max_samples * n))
        max_features = d if self.max_features is None or self.max_features == 1.0 else (self.max_features if isinstance(self.max_features, numbers.Integral) else int(self.max_features * d))
        if not self.bootstrap and self.oob_score:
            raise ValueError('Out of bag estimation only available if bootstrap=True')
        seeds = random_state.randint(MAX_INT, size=self.n_estimators)
        self.estimators_ = []
        self.estimators_features_ = []
        self._samples = []
        self.n_features_in_ = d
        for seed in seeds:
            rs = np.random.RandomState(seed)
            est = self._make_estimator(append=False, random_state=rs)
            features = _gen_indices(rs, self.bootstrap_features, d, max_features)
            indices = _gen_indices(rs, self.bootstrap, n, max_samples)
            curr = np.ones(n) if sample_weight is None else sample_weight.copy()
            if self.bootstrap:
                curr = curr * np.bincount(indices, minlength=n)
            else:
                mask = np.ones(n, dtype=bool)
                mask[indices] = False
                curr[mask] = 0
            if hasattr(est, 'classes_') or n_classes:
                pass
            if n_classes:
                est._fit(X[:, features], y, curr, [n_classes])
                est.classes_ = np.arange(n_classes)
                est.n_classes_ = n_classes
            else:
                est._fit(X[:, features], y, curr)
            est.n_features_in_ = len(features)
            self.estimators_.append(est)
            self.estimators_features_.append(features)
            self._samples.append(indices)

    def _oob(self, n):
        masks = []
        for ind in self._samples:
            m = np.ones(n, dtype=bool)
            m[ind] = False
            masks.append(m)
        return masks


class BaggingClassifier(ClassifierMixin, _BaseBagging):
    def __init__(self, estimator=None, n_estimators=10, *, max_samples=1.0, max_features=1.0, bootstrap=True, bootstrap_features=False, oob_score=False, warm_start=False, n_jobs=None, random_state=None, verbose=0):
        self.estimator = estimator
        self.n_estimators = n_estimators
        self.max_samples = max_samples
        self.max_features = max_features
        self.bootstrap = bootstrap
        self.bootstrap_features = bootstrap_features
        self.oob_score = oob_score
        self.warm_start = warm_start
        self.n_jobs = n_jobs
        self.random_state = random_state
        self.verbose = verbose

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        self.estimator_ = DecisionTreeClassifier() if self.estimator is None else self.estimator
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._fit_bagging(X, yi.astype(np.float64), sw, self.n_classes_)
        if self.oob_score:
            n = X.shape[0]
            proba = np.zeros((n, self.n_classes_))
            cnt = np.zeros(n)
            for est, feats, m in zip(self.estimators_, self.estimators_features_, self._oob(n)):
                if m.any():
                    proba[m] += est.predict_proba(X[m][:, feats])
                    cnt[m] += 1
            ok = cnt > 0
            proba[ok] /= cnt[ok][:, None]
            self.oob_decision_function_ = proba
            self.oob_score_ = float(np.mean(np.argmax(proba[ok], axis=1) == yi[ok]))
        return self

    def predict_proba(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        acc = np.zeros((X.shape[0], self.n_classes_))
        for est, feats in zip(self.estimators_, self.estimators_features_):
            acc += est.predict_proba(X[:, feats])
        return acc / self.n_estimators

    def predict(self, X):
        return self.classes_.take(np.argmax(self.predict_proba(X), axis=1))


class BaggingRegressor(RegressorMixin, _BaseBagging):
    def __init__(self, estimator=None, n_estimators=10, *, max_samples=1.0, max_features=1.0, bootstrap=True, bootstrap_features=False, oob_score=False, warm_start=False, n_jobs=None, random_state=None, verbose=0):
        self.estimator = estimator
        self.n_estimators = n_estimators
        self.max_samples = max_samples
        self.max_features = max_features
        self.bootstrap = bootstrap
        self.bootstrap_features = bootstrap_features
        self.oob_score = oob_score
        self.warm_start = warm_start
        self.n_jobs = n_jobs
        self.random_state = random_state
        self.verbose = verbose

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.estimator_ = DecisionTreeRegressor() if self.estimator is None else self.estimator
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._fit_bagging(X, np.asarray(y, dtype=np.float64), sw, None)
        return self

    def predict(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        acc = np.zeros(X.shape[0])
        for est, feats in zip(self.estimators_, self.estimators_features_):
            acc += est.predict(X[:, feats])
        return acc / self.n_estimators


# ───────────────────────── AdaBoost ─────────────────────────

class AdaBoostClassifier(ClassifierMixin, _BaseEnsemble):
    def __init__(self, estimator=None, *, n_estimators=50, learning_rate=1.0, algorithm='deprecated', random_state=None):
        self.estimator = estimator
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.algorithm = algorithm
        self.random_state = random_state

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        self.estimator_ = DecisionTreeClassifier(max_depth=1) if self.estimator is None else self.estimator
        sw = np.ones(len(y)) / len(y) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64) / np.sum(sample_weight)
        self.estimators_ = []
        self.estimator_weights_ = np.zeros(self.n_estimators)
        self.estimator_errors_ = np.ones(self.n_estimators)
        rs = check_random_state(self.random_state)
        eps = np.finfo(np.float64).eps
        zero = sw == 0.0
        for it in range(self.n_estimators):
            sw = np.clip(sw, eps, None)
            sw[zero] = 0.0
            est = self._make_estimator(random_state=rs)
            est.fit(X, y, sample_weight=sw)
            pred = est.predict(X)
            incorrect = pred != y
            err = float(np.mean(np.average(incorrect, weights=sw, axis=0)))
            if err <= 0:
                self.estimator_weights_[it] = 1.0
                self.estimator_errors_[it] = 0.0
                break
            if err >= 1.0 - 1.0 / self.n_classes_:
                self.estimators_.pop(-1)
                if not self.estimators_:
                    raise ValueError('BaseClassifier in AdaBoostClassifier ensemble is worse than random, ensemble can not be fit.')
                break
            w = self.learning_rate * (math.log((1.0 - err) / err) + math.log(self.n_classes_ - 1.0))
            if it != self.n_estimators - 1:
                sw = np.exp(np.log(sw) + w * incorrect * (sw > 0))
            self.estimator_weights_[it] = w
            self.estimator_errors_[it] = err
            s = float(np.sum(sw))
            if not np.isfinite(s) or s <= 0:
                break
            if it < self.n_estimators - 1:
                sw = sw / s
        return self

    def decision_function(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        K = self.n_classes_
        classes = self.classes_[:, None]
        pred = 0
        for est, w in zip(self.estimators_, self.estimator_weights_):
            pred = pred + np.where((est.predict(X) == classes).T, w, -1 / (K - 1) * w)
        pred = pred / self.estimator_weights_[:len(self.estimators_)].sum()
        if K == 2:
            pred[:, 0] *= -1
            return pred.sum(axis=1)
        return pred

    def predict_proba(self, X):
        K = self.n_classes_
        d = self.decision_function(X)
        if K == 2:
            d = np.column_stack([-d, d])
        else:
            pass
        d = d / (K - 1)
        e = np.exp(d - d.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)

    def predict(self, X):
        d = self.decision_function(X)
        if self.n_classes_ == 2:
            return self.classes_.take((d > 0).astype(int))
        return self.classes_.take(np.argmax(d, axis=1))


# ───────────────────────── votación ─────────────────────────

class VotingClassifier(ClassifierMixin, _BaseEnsemble):
    def __init__(self, estimators, *, voting='hard', weights=None, n_jobs=None, flatten_transform=True, verbose=False):
        self.estimators = estimators
        self.voting = voting
        self.weights = weights
        self.n_jobs = n_jobs
        self.flatten_transform = flatten_transform
        self.verbose = verbose

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.estimators_ = []
        for name, est in self.estimators:
            if est == 'drop':
                continue
            e = clone(est)
            e.fit(X, yi if False else y)
            self.estimators_.append(e)
        self.named_estimators_ = {n: e for (n, _), e in zip(self.estimators, self.estimators_)}
        return self

    def predict_proba(self, X):
        probas = [e.predict_proba(X) for e in self.estimators_]
        return np.average(np.array(probas), axis=0, weights=self.weights)

    def predict(self, X):
        if self.voting == 'soft':
            return self.classes_.take(np.argmax(self.predict_proba(X), axis=1))
        preds = np.array([np.searchsorted(self.classes_, e.predict(X)) for e in self.estimators_]).T
        w = np.ones(len(self.estimators_)) if self.weights is None else np.asarray(self.weights)
        out = np.array([np.argmax(np.bincount(row, weights=w, minlength=len(self.classes_))) for row in preds])
        return self.classes_.take(out)

    def transform(self, X):
        if self.voting == 'soft':
            return np.hstack([e.predict_proba(X) for e in self.estimators_])
        return np.array([e.predict(X) for e in self.estimators_]).T


class VotingRegressor(RegressorMixin, _BaseEnsemble):
    def __init__(self, estimators, *, weights=None, n_jobs=None, verbose=False):
        self.estimators = estimators
        self.weights = weights
        self.n_jobs = n_jobs
        self.verbose = verbose

    def fit(self, X, y, sample_weight=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        X, y = self._validate_data(X, y)
        self.estimators_ = [clone(e).fit(X, y) for _, e in self.estimators]
        self.named_estimators_ = {n: e for (n, _), e in zip(self.estimators, self.estimators_)}
        return self

    def predict(self, X):
        return np.average(np.array([e.predict(X) for e in self.estimators_]), axis=0, weights=self.weights)


# ───────────────────────── gradient boosting ─────────────────────────

def _expit(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -500, 500)))


def _softmax(Z):
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _safe_divide(num, den):
    return 0.0 if abs(den) < 1e-150 else num / den


def _random_sample_mask(n, n_in_bag, rs):
    rand = rs.uniform(size=n)
    mask = np.zeros(n, dtype=bool)
    n_bagged = 0
    i = 0
    while n_bagged < n_in_bag:
        if rand[i] * (n - i) < (n_in_bag - n_bagged):
            mask[i] = True
            n_bagged += 1
        i += 1
    return mask


class _ObjGrid:
    """Matriz de objetos (n_etapas × n_árboles_por_etapa): lo que NumPy llamaría un array de dtype=object."""

    def __init__(self, n, k):
        self._rows = [[None] * k for _ in range(n)]
        self.shape = (n, k)

    def __getitem__(self, key):
        if isinstance(key, tuple):
            return self._rows[key[0]][key[1]]
        if isinstance(key, slice):
            g = _ObjGrid(0, self.shape[1])
            g._rows = self._rows[key]
            g.shape = (len(g._rows), self.shape[1])
            return g
        return self._rows[key]

    def __setitem__(self, key, value):
        self._rows[key[0]][key[1]] = value

    def __len__(self):
        return len(self._rows)

    def __iter__(self):
        return iter(self._rows)

    def ravel(self):
        return [t for r in self._rows for t in r]

    def __repr__(self):
        return 'array(%s, dtype=object)' % (self._rows,)


class BaseGradientBoosting(_BaseEnsemble):
    def _check(self):
        if self.loss not in self._LOSSES:
            raise ValueError("The 'loss' parameter of %s must be a str among %s. Got %r instead." % (self.__class__.__name__, sorted(self._LOSSES), self.loss))

    def _loss_value(self, y, raw, sw):
        if self._kind == 'ls':
            return float(np.average((y - raw[:, 0]) ** 2 / 2.0, weights=sw))
        if self._kind == 'bin':
            z = raw[:, 0]
            return float(np.average((np.maximum(z, 0) + np.log1p(np.exp(-np.abs(z)))) - y * z, weights=sw))
        lse = np.log(np.exp(raw - raw.max(axis=1, keepdims=True)).sum(axis=1)) + raw.max(axis=1)
        return float(np.average(lse - raw[np.arange(len(y)), y.astype(int)], weights=sw))

    def _fit_gb(self, X, y, sample_weight, init_raw_fn):
        n, d = X.shape
        sw = np.ones(n) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        max_features = _resolve_max_features(self.max_features, d)
        rs = check_random_state(self.random_state)
        self._rng = rs
        self.n_features_in_ = d
        Xtr, ytr, swtr = X, y, sw
        Xval = yval = swval = None
        if self.n_iter_no_change is not None:
            from sklearn.model_selection import train_test_split
            strat = y if self._kind != 'ls' else None
            Xtr, Xval, ytr, yval, swtr, swval = train_test_split(X, y, sw, random_state=self.random_state, test_size=self.validation_fraction, stratify=strat)
        n = Xtr.shape[0]
        K = self.n_trees_per_iteration_
        raw = init_raw_fn(Xtr, ytr, swtr)
        self.estimators_ = _ObjGrid(self.n_estimators, K)
        self.train_score_ = np.zeros(self.n_estimators)
        do_oob = self.subsample < 1.0
        if do_oob:
            self.oob_improvement_ = np.zeros(self.n_estimators)
            self.oob_scores_ = np.zeros(self.n_estimators)
        n_inbag = max(1, int(self.subsample * n))
        mask = np.ones(n, dtype=bool)
        hist = np.full(self.n_iter_no_change, np.inf) if self.n_iter_no_change is not None else None
        raw_val = None
        if Xval is not None:
            raw_val = np.tile(self._init_raw_row, (Xval.shape[0], 1)) if hasattr(self, '_init_raw_row') else self._init_raw_for(Xval)
        last = self.n_estimators
        for i in range(self.n_estimators):
            if do_oob:
                mask = _random_sample_mask(n, n_inbag, rs)
                oob_y = ytr[~mask]
                oob_sw = swtr[~mask]
                if i == 0:
                    initial_loss = (2 if self._kind != 'mult' else 1) * self._loss_value(oob_y, raw[~mask], oob_sw)
            # gradiente negativo
            if self._kind == 'ls':
                neg = (ytr - raw[:, 0]).reshape(-1, 1)
            elif self._kind == 'bin':
                neg = (ytr - _expit(raw[:, 0])).reshape(-1, 1)
            else:
                Y = (ytr[:, None] == np.arange(K)[None, :]).astype(np.float64)
                neg = Y - _softmax(raw)
            for k in range(K):
                tree = DecisionTreeRegressor(criterion='squared_error', splitter='best', max_depth=self.max_depth, min_samples_split=self.min_samples_split, min_samples_leaf=self.min_samples_leaf, min_weight_fraction_leaf=self.min_weight_fraction_leaf, min_impurity_decrease=self.min_impurity_decrease, max_features=self.max_features, max_leaf_nodes=self.max_leaf_nodes, random_state=rs, ccp_alpha=self.ccp_alpha)
                swk = swtr * mask.astype(np.float64) if do_oob else swtr
                tree.fit(Xtr, neg[:, k], sample_weight=swk)
                terminal = tree.tree_.apply(Xtr)
                if self._kind != 'ls':
                    masked = terminal.copy()
                    masked[~mask] = -1
                    yk = (ytr == k).astype(np.float64) if self._kind == 'mult' else ytr
                    for leaf in np.nonzero(tree.tree_.children_left == -1)[0]:
                        ind = np.nonzero(masked == leaf)[0]
                        if len(ind) == 0:
                            tree.tree_.value[leaf, 0, 0] = 0.0
                            continue
                        y_ = yk[ind]
                        w_ = swtr[ind]
                        neg_g = neg[ind, k]
                        prob = y_ - neg_g
                        num = np.average(neg_g, weights=w_)
                        if self._kind == 'mult':
                            num *= (K - 1) / K
                        den = np.average(prob * (1 - prob), weights=w_)
                        tree.tree_.value[leaf, 0, 0] = _safe_divide(num, den)
                raw[:, k] += self.learning_rate * tree.tree_.value[:, 0, 0].take(terminal, axis=0)
                self.estimators_[i, k] = tree
            factor = 2 if self._kind in ('ls', 'bin') else 1
            if do_oob:
                self.train_score_[i] = factor * self._loss_value(ytr[mask], raw[mask], swtr[mask])
                self.oob_scores_[i] = factor * self._loss_value(oob_y, raw[~mask], oob_sw)
                prev = initial_loss if i == 0 else self.oob_scores_[i - 1]
                self.oob_improvement_[i] = prev - self.oob_scores_[i]
            else:
                self.train_score_[i] = factor * self._loss_value(ytr, raw, swtr)
            if hist is not None:
                raw_val = raw_val + 0
                for k in range(K):
                    raw_val[:, k] += self.learning_rate * self.estimators_[i, k].predict(Xval)
                vloss = factor * self._loss_value(yval, raw_val, swval)
                if np.any(vloss + self.tol < hist):
                    hist[i % len(hist)] = vloss
                else:
                    last = i + 1
                    break
        if last != self.n_estimators:
            self.estimators_ = self.estimators_[:last]
            self.train_score_ = self.train_score_[:last]
        self.n_estimators_ = last
        return self

    def _raw_predict(self, X):
        X = self._validate_data(X, reset=False)
        raw = np.tile(self._init_raw_for(X), (1, 1)) if False else self._init_raw_for(X)
        for i in range(self.estimators_.shape[0]):
            for k in range(self.n_trees_per_iteration_):
                raw[:, k] += self.learning_rate * self.estimators_[i, k].predict(X)
        return raw

    def _staged_raw(self, X):
        X = self._validate_data(X, reset=False)
        raw = self._init_raw_for(X)
        for i in range(self.estimators_.shape[0]):
            for k in range(self.n_trees_per_iteration_):
                raw[:, k] += self.learning_rate * self.estimators_[i, k].predict(X)
            yield raw.copy()

    @property
    def feature_importances_(self):
        check_is_fitted(self)
        trees = [t for stage in self.estimators_ for t in stage if t.tree_.node_count > 1]
        if not trees:
            return np.zeros(self.n_features_in_)
        avg = np.mean([t.tree_.compute_feature_importances(normalize=False) for t in trees], axis=0)
        return avg / np.sum(avg)

    def apply(self, X):
        X = self._validate_data(X, reset=False)
        return np.array([[t.tree_.apply(X) for t in stage] for stage in self.estimators_]).transpose(2, 0, 1)


class GradientBoostingRegressor(RegressorMixin, BaseGradientBoosting):
    _LOSSES = ('squared_error',)

    def __init__(self, *, loss='squared_error', learning_rate=0.1, n_estimators=100, subsample=1.0, criterion='friedman_mse', min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_depth=3, min_impurity_decrease=0.0, init=None, random_state=None, max_features=None, alpha=0.9, verbose=0, max_leaf_nodes=None, warm_start=False, validation_fraction=0.1, n_iter_no_change=None, tol=1e-4, ccp_alpha=0.0):
        self.loss = loss
        self.learning_rate = learning_rate
        self.n_estimators = n_estimators
        self.subsample = subsample
        self.criterion = criterion
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_depth = max_depth
        self.min_impurity_decrease = min_impurity_decrease
        self.init = init
        self.random_state = random_state
        self.max_features = max_features
        self.alpha = alpha
        self.verbose = verbose
        self.max_leaf_nodes = max_leaf_nodes
        self.warm_start = warm_start
        self.validation_fraction = validation_fraction
        self.n_iter_no_change = n_iter_no_change
        self.tol = tol
        self.ccp_alpha = ccp_alpha

    def fit(self, X, y, sample_weight=None, monitor=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        self._check()
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        self._kind = 'ls'
        self.n_trees_per_iteration_ = 1
        sw = np.ones(len(y)) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._init_value = float(np.average(y, weights=sw))

        def init_raw(Xt, yt, swt):
            self._init_value = float(np.average(yt, weights=swt))
            return np.full((Xt.shape[0], 1), self._init_value)
        return self._fit_gb(X, y, sample_weight, init_raw)

    def _init_raw_for(self, X):
        return np.full((X.shape[0], 1), self._init_value)

    def predict(self, X):
        check_is_fitted(self)
        return self._raw_predict(X)[:, 0]

    def staged_predict(self, X):
        for r in self._staged_raw(X):
            yield r[:, 0]


class GradientBoostingClassifier(ClassifierMixin, BaseGradientBoosting):
    _LOSSES = ('log_loss',)

    def __init__(self, *, loss='log_loss', learning_rate=0.1, n_estimators=100, subsample=1.0, criterion='friedman_mse', min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_depth=3, min_impurity_decrease=0.0, init=None, random_state=None, max_features=None, verbose=0, max_leaf_nodes=None, warm_start=False, validation_fraction=0.1, n_iter_no_change=None, tol=1e-4, ccp_alpha=0.0):
        self.loss = loss
        self.learning_rate = learning_rate
        self.n_estimators = n_estimators
        self.subsample = subsample
        self.criterion = criterion
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_depth = max_depth
        self.min_impurity_decrease = min_impurity_decrease
        self.init = init
        self.random_state = random_state
        self.max_features = max_features
        self.verbose = verbose
        self.max_leaf_nodes = max_leaf_nodes
        self.warm_start = warm_start
        self.validation_fraction = validation_fraction
        self.n_iter_no_change = n_iter_no_change
        self.tol = tol
        self.ccp_alpha = ccp_alpha

    def fit(self, X, y, sample_weight=None, monitor=None):
        if hasattr(self, 'n_estimators'):
            check_interval(self, 'n_estimators', self.n_estimators, int, 1, None, 'left')
        self._check()
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        if self.n_classes_ < 2:
            raise ValueError('y contains 1 class after sample_weight trimmed classes with zero weights, while a minimum of 2 classes are required.')
        self._kind = 'bin' if self.n_classes_ == 2 else 'mult'
        self.n_trees_per_iteration_ = 1 if self.n_classes_ == 2 else self.n_classes_
        yi = yi.astype(np.float64)

        def init_raw(Xt, yt, swt):
            counts = np.bincount(yt.astype(int), weights=swt, minlength=self.n_classes_)
            prior = counts / counts.sum()
            eps = np.finfo(np.float32).eps
            prior = np.clip(prior, eps, 1 - eps)
            if self._kind == 'bin':
                self._init_row = np.array([[math.log(prior[1] / (1 - prior[1]))]])
            else:
                self._init_row = np.log(prior).reshape(1, -1)
            return np.tile(self._init_row, (Xt.shape[0], 1))
        return self._fit_gb(X, yi, sample_weight, init_raw)

    def _init_raw_for(self, X):
        return np.tile(self._init_row, (X.shape[0], 1))

    def decision_function(self, X):
        check_is_fitted(self)
        raw = self._raw_predict(X)
        return raw.ravel() if raw.shape[1] == 1 else raw

    def predict_proba(self, X):
        raw = self._raw_predict(X)
        if self._kind == 'bin':
            p = _expit(raw[:, 0])
            return np.column_stack([1 - p, p])
        return _softmax(raw)

    def predict(self, X):
        raw = self._raw_predict(X)
        if self._kind == 'bin':
            return self.classes_.take((raw[:, 0] > 0).astype(int))
        return self.classes_.take(np.argmax(raw, axis=1))

    def staged_predict(self, X):
        for r in self._staged_raw(X):
            yield self.classes_.take((r[:, 0] > 0).astype(int)) if self._kind == 'bin' else self.classes_.take(np.argmax(r, axis=1))

    def staged_predict_proba(self, X):
        for r in self._staged_raw(X):
            if self._kind == 'bin':
                p = _expit(r[:, 0])
                yield np.column_stack([1 - p, p])
            else:
                yield _softmax(r)


class HistGradientBoostingClassifier(GradientBoostingClassifier):
    """Aproximación: usa el mismo algoritmo que GradientBoostingClassifier (scikit-learn real agrupa los valores en intervalos)."""

    def __init__(self, loss='log_loss', *, learning_rate=0.1, max_iter=100, max_leaf_nodes=31, max_depth=None, min_samples_leaf=20, l2_regularization=0.0, max_features=1.0, max_bins=255, early_stopping='auto', scoring='loss', validation_fraction=0.1, n_iter_no_change=10, tol=1e-7, verbose=0, random_state=None):
        super().__init__(loss='log_loss', learning_rate=learning_rate, n_estimators=max_iter, max_depth=max_depth if max_depth is not None else 3, min_samples_leaf=min_samples_leaf, random_state=random_state)
        self.max_iter = max_iter
        self.max_leaf_nodes = max_leaf_nodes


class HistGradientBoostingRegressor(GradientBoostingRegressor):
    def __init__(self, loss='squared_error', *, learning_rate=0.1, max_iter=100, max_leaf_nodes=31, max_depth=None, min_samples_leaf=20, l2_regularization=0.0, max_features=1.0, max_bins=255, early_stopping='auto', scoring='loss', validation_fraction=0.1, n_iter_no_change=10, tol=1e-7, verbose=0, random_state=None):
        super().__init__(loss='squared_error', learning_rate=learning_rate, n_estimators=max_iter, max_depth=max_depth if max_depth is not None else 3, min_samples_leaf=min_samples_leaf, random_state=random_state)
        self.max_iter = max_iter
        self.max_leaf_nodes = max_leaf_nodes
