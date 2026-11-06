import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted
from sklearn.utils import check_random_state, _to_array


class DummyClassifier(ClassifierMixin, BaseEstimator):
    def __init__(self, *, strategy='prior', random_state=None, constant=None):
        self.strategy = strategy
        self.random_state = random_state
        self.constant = constant

    def fit(self, X, y, sample_weight=None):
        allowed = ('most_frequent', 'prior', 'stratified', 'uniform', 'constant')
        if self.strategy not in allowed:
            raise ValueError("The 'strategy' parameter of DummyClassifier must be a str among {'most_frequent', 'prior', 'stratified', 'uniform', 'constant'}. Got %r instead." % (self.strategy,))
        y = np.asarray(_to_array(y))
        self.n_features_in_ = np.asarray(_to_array(X)).shape[1] if np.ndim(_to_array(X)) == 2 else 1
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        self.class_prior_ = np.bincount(yi) / len(yi)
        if self.strategy == 'constant':
            if self.constant is None:
                raise ValueError('Constant target value has to be specified when the constant strategy is used.')
            if self.constant not in self.classes_.tolist():
                raise ValueError('The constant target value must be present in the training data. You provided constant=%r. Possible values are: %r.' % (self.constant, self.classes_.tolist()))
        return self

    def predict(self, X):
        check_is_fitted(self, 'classes_')
        n = np.asarray(_to_array(X)).shape[0]
        rs = check_random_state(self.random_state)
        k = self.n_classes_
        if self.strategy in ('most_frequent', 'prior'):
            return np.full(n, self.classes_[int(np.argmax(self.class_prior_))])
        if self.strategy == 'stratified':
            return self.classes_[np.argmax(self.predict_proba(X), axis=1)]
        if self.strategy == 'uniform':
            return self.classes_[rs.randint(k, size=n)]
        return np.full(n, self.constant)

    def predict_proba(self, X):
        check_is_fitted(self, 'classes_')
        n = np.asarray(_to_array(X)).shape[0]
        rs = check_random_state(self.random_state)
        k = self.n_classes_
        if self.strategy == 'most_frequent':
            out = np.zeros((n, k))
            out[:, int(np.argmax(self.class_prior_))] = 1.0
            return out
        if self.strategy == 'prior':
            return np.tile(self.class_prior_, (n, 1))
        if self.strategy == 'stratified':
            out = rs.multinomial(1, self.class_prior_, size=n)
            return out.astype(np.float64)
        if self.strategy == 'uniform':
            return np.ones((n, k)) / k
        out = np.zeros((n, k))
        out[:, int(np.searchsorted(self.classes_, self.constant))] = 1.0
        return out


class DummyRegressor(RegressorMixin, BaseEstimator):
    def __init__(self, *, strategy='mean', constant=None, quantile=None):
        self.strategy = strategy
        self.constant = constant
        self.quantile = quantile

    def fit(self, X, y, sample_weight=None):
        allowed = ('mean', 'median', 'quantile', 'constant')
        if self.strategy not in allowed:
            raise ValueError("The 'strategy' parameter of DummyRegressor must be a str among {'mean', 'median', 'quantile', 'constant'}. Got %r instead." % (self.strategy,))
        y = np.asarray(_to_array(y), dtype=np.float64)
        self.n_features_in_ = np.asarray(_to_array(X)).shape[1] if np.ndim(_to_array(X)) == 2 else 1
        if self.strategy == 'mean':
            self.constant_ = np.average(y, axis=0, weights=sample_weight)
        elif self.strategy == 'median':
            self.constant_ = np.median(y, axis=0)
        elif self.strategy == 'quantile':
            if self.quantile is None:
                raise ValueError('When using `strategy="quantile"`, you have to specify the desired quantile in the range [0, 1].')
            self.constant_ = np.percentile(y, axis=0, q=self.quantile * 100.0)
        else:
            if self.constant is None:
                raise TypeError('Constant target value has to be specified when the constant strategy is used.')
            self.constant_ = np.reshape(np.asarray(self.constant), (-1,))
        self.constant_ = np.reshape(np.asarray(self.constant_), (1, -1))
        self.n_outputs_ = 1 if y.ndim == 1 else y.shape[1]
        return self

    def predict(self, X, return_std=False):
        check_is_fitted(self, 'constant_')
        n = np.asarray(_to_array(X)).shape[0]
        c = np.asarray(self.constant_)
        out = np.tile(c, (n, 1))
        out = out.ravel() if self.n_outputs_ == 1 else out
        if return_std:
            return out, np.zeros(n)
        return out
