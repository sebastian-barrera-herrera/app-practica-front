import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, check_is_fitted


class _NB(ClassifierMixin, BaseEstimator):
    def predict(self, X):
        return self.classes_[np.argmax(self.predict_joint_log_proba(X), axis=1)]

    def predict_log_proba(self, X):
        jll = self.predict_joint_log_proba(X)
        mx = jll.max(axis=1, keepdims=True)
        lse = mx + np.log(np.exp(jll - mx).sum(axis=1, keepdims=True))
        return jll - lse

    def predict_proba(self, X):
        return np.exp(self.predict_log_proba(X))


class GaussianNB(_NB):
    def __init__(self, *, priors=None, var_smoothing=1e-9):
        self.priors = priors
        self.var_smoothing = var_smoothing

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        self.classes_ = np.unique(y)
        self.epsilon_ = self.var_smoothing * np.var(X, axis=0).max()
        K, d = len(self.classes_), X.shape[1]
        self.theta_ = np.zeros((K, d))
        self.var_ = np.zeros((K, d))
        self.class_count_ = np.zeros(K)
        for k, c in enumerate(self.classes_):
            Xk = X[y == c]
            self.class_count_[k] = Xk.shape[0]
            self.theta_[k] = Xk.mean(axis=0)
            self.var_[k] = Xk.var(axis=0)
        self.var_ = self.var_ + self.epsilon_
        self.class_prior_ = self.class_count_ / self.class_count_.sum() if self.priors is None else np.asarray(self.priors)
        return self

    def predict_joint_log_proba(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        out = []
        for k in range(len(self.classes_)):
            jointi = np.log(self.class_prior_[k])
            n_ij = -0.5 * np.sum(np.log(2.0 * np.pi * self.var_[k]))
            n_ij = n_ij - 0.5 * np.sum(((X - self.theta_[k]) ** 2) / self.var_[k], axis=1)
            out.append(jointi + n_ij)
        return np.array(out).T


class _DiscreteNB(_NB):
    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        if (X < 0).any() and isinstance(self, (MultinomialNB, ComplementNB)):
            raise ValueError('Negative values in data passed to %s (input X)' % type(self).__name__)
        if isinstance(self, BernoulliNB) and self.binarize is not None:
            X = (X > self.binarize).astype(np.float64)
        self.classes_ = np.unique(y)
        K = len(self.classes_)
        self.class_count_ = np.array([np.sum(y == c) for c in self.classes_], dtype=np.float64)
        self.feature_count_ = np.array([X[y == c].sum(axis=0) for c in self.classes_])
        self._update()
        return self

    def _prior(self):
        if self.class_prior is not None:
            return np.log(np.asarray(self.class_prior))
        if self.fit_prior:
            return np.log(self.class_count_) - np.log(self.class_count_.sum())
        return np.full(len(self.classes_), -np.log(len(self.classes_)))


class MultinomialNB(_DiscreteNB):
    def __init__(self, *, alpha=1.0, force_alpha=True, fit_prior=True, class_prior=None):
        self.alpha = alpha
        self.force_alpha = force_alpha
        self.fit_prior = fit_prior
        self.class_prior = class_prior

    def _update(self):
        sc = self.feature_count_ + self.alpha
        self.feature_log_prob_ = np.log(sc) - np.log(sc.sum(axis=1, keepdims=True))
        self.class_log_prior_ = self._prior()

    def predict_joint_log_proba(self, X):
        X = self._validate_data(X, reset=False)
        return X @ self.feature_log_prob_.T + self.class_log_prior_


class BernoulliNB(_DiscreteNB):
    def __init__(self, *, alpha=1.0, force_alpha=True, binarize=0.0, fit_prior=True, class_prior=None):
        self.alpha = alpha
        self.force_alpha = force_alpha
        self.binarize = binarize
        self.fit_prior = fit_prior
        self.class_prior = class_prior

    def _update(self):
        sc = self.feature_count_ + self.alpha
        n = self.class_count_[:, None] + self.alpha * 2
        self.feature_log_prob_ = np.log(sc) - np.log(n)
        self.class_log_prior_ = self._prior()

    def predict_joint_log_proba(self, X):
        X = self._validate_data(X, reset=False)
        if self.binarize is not None:
            X = (X > self.binarize).astype(np.float64)
        neg = np.log1p(-np.exp(self.feature_log_prob_))
        return X @ (self.feature_log_prob_ - neg).T + neg.sum(axis=1) + self.class_log_prior_


class ComplementNB(_DiscreteNB):
    def __init__(self, *, alpha=1.0, force_alpha=True, fit_prior=True, class_prior=None, norm=False):
        self.alpha = alpha
        self.force_alpha = force_alpha
        self.fit_prior = fit_prior
        self.class_prior = class_prior
        self.norm = norm

    def _update(self):
        comp = self.feature_count_.sum(axis=0) - self.feature_count_ + self.alpha
        logged = np.log(comp / comp.sum(axis=1, keepdims=True))
        self.feature_log_prob_ = -logged
        self.class_log_prior_ = self._prior()

    def predict_joint_log_proba(self, X):
        X = self._validate_data(X, reset=False)
        return X @ self.feature_log_prob_.T
