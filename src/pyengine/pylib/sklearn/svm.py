import math
import numbers
import warnings
import numpy as np

import _mlkern
from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted
from sklearn.exceptions import ConvergenceWarning, NotFittedError
from sklearn.utils import check_array, _to_array
from sklearn.utils._param_validation import check_interval


def _kernel_matrix(kernel, A, B, gamma, degree, coef0, same):
    if callable(kernel):
        return np.asarray(kernel(A, B), dtype=np.float64)
    G = A @ B.T
    if kernel == 'linear':
        return G
    if kernel == 'poly':
        return (gamma * G + coef0) ** degree
    if kernel == 'rbf':
        if same:
            sa = (A * A).sum(axis=1)
            return np.exp(-gamma * (sa[:, None] + sa[None, :] - 2.0 * G))
        D = A[:, None, :] - B[None, :, :]
        return np.exp(-gamma * (D * D).sum(axis=2))
    if kernel == 'sigmoid':
        return np.tanh(gamma * G + coef0)
    if kernel == 'precomputed':
        return A
    raise ValueError("'%s' is not in list" % (kernel,))


class BaseSVM(BaseEstimator):
    def _resolve_gamma(self, X):
        g = self.gamma
        if isinstance(g, str):
            if g == 'scale':
                v = X.var()
                return 1.0 / (X.shape[1] * v) if v != 0 else 1.0
            if g == 'auto':
                return 1.0 / X.shape[1]
            raise ValueError("The 'gamma' parameter of %s must be a str among {'scale', 'auto'} or an instance of 'float'. Got %r instead." % (type(self).__name__, g))
        return float(g)

    def _check_common(self):
        check_interval(self, 'C', self.C, float, 0.0, None, 'neither')
        if isinstance(self.kernel, str) and self.kernel not in ('linear', 'poly', 'rbf', 'sigmoid', 'precomputed'):
            raise ValueError("The 'kernel' parameter of %s must be a str among {'linear', 'poly', 'rbf', 'sigmoid', 'precomputed'} or a callable. Got %r instead." % (type(self).__name__, self.kernel))

    def _kmat(self, A, B, same=False):
        return _kernel_matrix(self.kernel, A, B, self._gamma, self.degree, self.coef0, same)


class SVC(ClassifierMixin, BaseSVM):
    def __init__(self, *, C=1.0, kernel='rbf', degree=3, gamma='scale', coef0=0.0, shrinking=True, probability=False, tol=1e-3, cache_size=200, class_weight=None, verbose=False, max_iter=-1, decision_function_shape='ovr', break_ties=False, random_state=None):
        self.C = C
        self.kernel = kernel
        self.degree = degree
        self.gamma = gamma
        self.coef0 = coef0
        self.shrinking = shrinking
        self.probability = probability
        self.tol = tol
        self.cache_size = cache_size
        self.class_weight = class_weight
        self.verbose = verbose
        self.max_iter = max_iter
        self.decision_function_shape = decision_function_shape
        self.break_ties = break_ties
        self.random_state = random_state

    def fit(self, X, y, sample_weight=None):
        self._check_common()
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        K = len(self.classes_)
        if K < 2:
            raise ValueError('The number of classes has to be greater than one; got %d class' % K)
        n = X.shape[0]
        sw = np.ones(n) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        if self.class_weight is None:
            cw = np.ones(K)
        elif isinstance(self.class_weight, str) and self.class_weight == 'balanced':
            cw = n / (K * np.bincount(yi))
        else:
            cw = np.array([self.class_weight.get(c, 1.0) for c in self.classes_.tolist()])
        self.class_weight_ = cw
        self._gamma = self._resolve_gamma(X)
        self.shape_fit_ = X.shape
        Kfull = self._kmat(X, X, same=True)
        idx_by = [np.where(yi == c)[0] for c in range(K)]
        pair_alpha = {}
        rhos = []
        iters = []
        nz = np.zeros(n, dtype=bool)
        for a in range(K):
            for b in range(a + 1, K):
                idx = np.concatenate([idx_by[a], idx_by[b]])
                yy = np.concatenate([np.ones(len(idx_by[a])), -np.ones(len(idx_by[b]))])
                Ksub = Kfull[idx][:, idx]
                Q = (yy[:, None] * yy[None, :]) * Ksub
                QD = np.diag(Ksub).copy()
                Cvec = sw[idx] * np.where(yy > 0, self.C * cw[a], self.C * cw[b])
                alpha, rho, it, obj, timed_out = _mlkern.svm_solve(Q, QD, -np.ones(len(idx)), yy, np.zeros(len(idx)), Cvec, self.tol, self.max_iter)
                if timed_out:
                    warnings.warn('Solver terminated early (max_iter=%i).  Consider pre-processing your data with StandardScaler or MinMaxScaler.' % self.max_iter, ConvergenceWarning)
                alpha = alpha * yy
                pair_alpha[(a, b)] = (idx, alpha)
                rhos.append(rho)
                iters.append(it)
                nz[idx[alpha != 0]] = True
        # vectores de soporte por clase en orden de clase y, dentro de ella, de aparición
        sv_idx = []
        n_support = []
        for c in range(K):
            ids = idx_by[c][nz[idx_by[c]]]
            sv_idx.extend(ids.tolist())
            n_support.append(len(ids))
        sv_idx = np.array(sv_idx, dtype=np.int64)
        pos = {int(v): i for i, v in enumerate(sv_idx.tolist())}
        coef = np.zeros((K - 1, len(sv_idx)))
        for (a, b), (idx, alpha) in pair_alpha.items():
            na = len(idx_by[a])
            for k, g in enumerate(idx.tolist()):
                if nz[g]:
                    if k < na:
                        coef[b - 1, pos[g]] = alpha[k]
                    else:
                        coef[a, pos[g]] = alpha[k]
        self.support_ = sv_idx
        self.support_vectors_ = X[sv_idx].astype(np.float64)
        self._n_support = np.array(n_support, dtype=np.int32)
        self.n_support_ = self._n_support
        self._dual_coef_ = coef
        self._intercept_ = -np.array(rhos)
        self.dual_coef_ = coef.copy()
        self.intercept_ = self._intercept_.copy()
        if K == 2:
            self.dual_coef_ = -self.dual_coef_
            self.intercept_ = -self.intercept_
        self.n_iter_ = np.array(iters, dtype=np.int32)
        self.fit_status_ = 0
        self.n_features_in_ = X.shape[1]
        self._fit_X = X
        if self.probability:
            warnings.warn('The `probability` parameter was deprecated in 1.9 and will be removed in version 1.11. Use `CalibratedClassifierCV(SVC(), ensemble=False)` instead of `SVC(probability=True)`', FutureWarning)
            self._fit_probability(X, yi)
        return self

    def _fit_probability(self, X, yi):
        K = len(self.classes_)
        dec = self._pair_decisions(X)
        self.probA_ = []
        self.probB_ = []
        p = 0
        for a in range(K):
            for b in range(a + 1, K):
                mask = (yi == a) | (yi == b)
                d = dec[mask, p]
                lab = (yi[mask] == a).astype(np.float64)
                A, B = _sigmoid_train(d, lab)
                self.probA_.append(A)
                self.probB_.append(B)
                p += 1
        self.probA_ = np.array(self.probA_)
        self.probB_ = np.array(self.probB_)

    def _pair_decisions(self, X):
        """Valores de decisión de libsvm por pareja (i, j): positivo ⇒ clase i."""
        K = len(self.classes_)
        Ks = self._kmat(X, self.support_vectors_)
        starts = np.concatenate([[0], np.cumsum(self._n_support)]).astype(int)
        out = np.zeros((X.shape[0], K * (K - 1) // 2))
        p = 0
        for a in range(K):
            for b in range(a + 1, K):
                s = np.zeros(X.shape[0])
                ca = self._dual_coef_[b - 1, starts[a]:starts[a + 1]]
                cb = self._dual_coef_[a, starts[b]:starts[b + 1]]
                s = s + Ks[:, starts[a]:starts[a + 1]] @ ca + Ks[:, starts[b]:starts[b + 1]] @ cb
                out[:, p] = s + self._intercept_[p]
                p += 1
        return out

    def _votes(self, dec):
        K = len(self.classes_)
        votes = np.zeros((dec.shape[0], K))
        p = 0
        for a in range(K):
            for b in range(a + 1, K):
                pos = dec[:, p] > 0
                votes[pos, a] += 1
                votes[~pos, b] += 1
                p += 1
        return votes

    def _validate_pred(self, X):
        check_is_fitted(self, 'support_')
        if self.kernel == 'precomputed':
            return np.asarray(_to_array(X), dtype=np.float64)
        return self._validate_data(X, reset=False)

    def decision_function(self, X):
        Xa = self._validate_pred(X)
        dec = self._pair_decisions(Xa)
        K = len(self.classes_)
        if K == 2:
            return -dec.ravel()
        if self.decision_function_shape == 'ovr':
            return _ovr_decision_function(dec < 0, -dec, K)
        return dec

    def predict(self, X):
        K = len(self.classes_)
        if self.break_ties and self.decision_function_shape == 'ovr' and K > 2:
            return self.classes_[np.argmax(self.decision_function(X), axis=1)]
        Xa = self._validate_pred(X)
        dec = self._pair_decisions(Xa)
        votes = self._votes(dec)
        return self.classes_[np.argmax(votes, axis=1)]

    def predict_proba(self, X):
        if not self.probability:
            raise AttributeError('predict_proba is not available when probability=False')
        Xa = self._validate_pred(X)
        dec = self._pair_decisions(Xa)
        K = len(self.classes_)
        n = Xa.shape[0]
        out = np.zeros((n, K))
        for r in range(n):
            R = np.zeros((K, K))
            p = 0
            for a in range(K):
                for b in range(a + 1, K):
                    pr = min(max(_sigmoid_predict(dec[r, p], self.probA_[p], self.probB_[p]), 1e-7), 1 - 1e-7)
                    R[a, b] = pr
                    R[b, a] = 1 - pr
                    p += 1
            out[r] = _multiclass_probability(K, R)
        return out

    def predict_log_proba(self, X):
        return np.log(self.predict_proba(X))

    @property
    def coef_(self):
        if self.kernel != 'linear':
            raise AttributeError('coef_ is only available when using a linear kernel')
        check_is_fitted(self, 'support_')
        if self.dual_coef_.shape[0] == 1:
            return self.dual_coef_ @ self.support_vectors_
        K = len(self.classes_)
        starts = np.concatenate([[0], np.cumsum(self._n_support)]).astype(int)
        rows = []
        for c1 in range(K):
            sv1 = self.support_vectors_[starts[c1]:starts[c1 + 1]]
            for c2 in range(c1 + 1, K):
                sv2 = self.support_vectors_[starts[c2]:starts[c2 + 1]]
                a1 = self.dual_coef_[c2 - 1, starts[c1]:starts[c1 + 1]]
                a2 = self.dual_coef_[c1, starts[c2]:starts[c2 + 1]]
                rows.append(a1 @ sv1 + a2 @ sv2)
        return np.array(rows)

    @property
    def _estimator_type(self):
        return 'classifier'


def _ovr_decision_function(predictions, confidences, n_classes):
    n_samples = predictions.shape[0]
    votes = np.zeros((n_samples, n_classes))
    sum_of_confidences = np.zeros((n_samples, n_classes))
    k = 0
    for i in range(n_classes):
        for j in range(i + 1, n_classes):
            sum_of_confidences[:, i] -= confidences[:, k]
            sum_of_confidences[:, j] += confidences[:, k]
            votes[predictions[:, k] == 0, i] += 1
            votes[predictions[:, k] == 1, j] += 1
            k += 1
    transformed = sum_of_confidences / (3 * (np.abs(sum_of_confidences) + 1))
    return votes + transformed


def _sigmoid_predict(dec, A, B):
    fApB = dec * A + B
    if fApB >= 0:
        return math.exp(-fApB) / (1.0 + math.exp(-fApB))
    return 1.0 / (1 + math.exp(fApB))


def _sigmoid_train(dec, labels):
    prior1 = float(labels.sum())
    prior0 = float(len(labels) - prior1)
    max_iter = 100
    min_step = 1e-10
    sigma = 1e-12
    eps = 1e-5
    hiTarget = (prior1 + 1.0) / (prior1 + 2.0)
    loTarget = 1 / (prior0 + 2.0)
    t = np.where(labels > 0, hiTarget, loTarget)
    A = 0.0
    B = math.log((prior0 + 1.0) / (prior1 + 1.0))
    fval = 0.0
    for i in range(len(dec)):
        fApB = dec[i] * A + B
        if fApB >= 0:
            fval += t[i] * fApB + math.log(1 + math.exp(-fApB))
        else:
            fval += (t[i] - 1) * fApB + math.log(1 + math.exp(fApB))
    for it in range(max_iter):
        h11 = sigma
        h22 = sigma
        h21 = 0.0
        g1 = 0.0
        g2 = 0.0
        for i in range(len(dec)):
            fApB = dec[i] * A + B
            if fApB >= 0:
                p = math.exp(-fApB) / (1.0 + math.exp(-fApB))
                q = 1.0 / (1.0 + math.exp(-fApB))
            else:
                p = 1.0 / (1.0 + math.exp(fApB))
                q = math.exp(fApB) / (1.0 + math.exp(fApB))
            d2 = p * q
            h11 += dec[i] * dec[i] * d2
            h22 += d2
            h21 += dec[i] * d2
            d1 = t[i] - p
            g1 += dec[i] * d1
            g2 += d1
        if abs(g1) < eps and abs(g2) < eps:
            break
        det = h11 * h22 - h21 * h21
        dA = -(h22 * g1 - h21 * g2) / det
        dB = -(-h21 * g1 + h11 * g2) / det
        gd = g1 * dA + g2 * dB
        stepsize = 1.0
        while stepsize >= min_step:
            newA = A + stepsize * dA
            newB = B + stepsize * dB
            newf = 0.0
            for i in range(len(dec)):
                fApB = dec[i] * newA + newB
                if fApB >= 0:
                    newf += t[i] * fApB + math.log(1 + math.exp(-fApB))
                else:
                    newf += (t[i] - 1) * fApB + math.log(1 + math.exp(fApB))
            if newf < fval + 0.0001 * stepsize * gd:
                A = newA
                B = newB
                fval = newf
                break
            stepsize = stepsize / 2.0
        if stepsize < min_step:
            break
    return A, B


def _multiclass_probability(k, r):
    max_iter = max(100, k)
    eps = 0.005 / k
    Q = np.zeros((k, k))
    p = np.full(k, 1.0 / k)
    for t in range(k):
        for j in range(t):
            Q[t, t] += r[j, t] * r[j, t]
            Q[t, j] = Q[j, t]
        for j in range(t + 1, k):
            Q[t, t] += r[j, t] * r[j, t]
            Q[t, j] = -r[j, t] * r[t, j]
    for it in range(max_iter):
        pQp = float(p @ Q @ p)
        Qp = Q @ p
        max_error = float(np.abs(Qp - pQp).max())
        if max_error < eps:
            break
        for t in range(k):
            diff = (-Qp[t] + pQp) / Q[t, t]
            p[t] += diff
            pQp = (pQp + diff * (diff * Q[t, t] + 2 * Qp[t])) / (1 + diff) / (1 + diff)
            Qp = (Qp + diff * Q[t]) / (1 + diff)
            p = p / (1 + diff)
    return p


class SVR(RegressorMixin, BaseSVM):
    def __init__(self, *, kernel='rbf', degree=3, gamma='scale', coef0=0.0, tol=1e-3, C=1.0, epsilon=0.1, shrinking=True, cache_size=200, verbose=False, max_iter=-1):
        self.kernel = kernel
        self.degree = degree
        self.gamma = gamma
        self.coef0 = coef0
        self.tol = tol
        self.C = C
        self.epsilon = epsilon
        self.shrinking = shrinking
        self.cache_size = cache_size
        self.verbose = verbose
        self.max_iter = max_iter

    def fit(self, X, y, sample_weight=None):
        self._check_common()
        check_interval(self, 'epsilon', self.epsilon, float, 0.0, None, 'left')
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        n = X.shape[0]
        sw = np.ones(n) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._gamma = self._resolve_gamma(X)
        Kfull = self._kmat(X, X, same=True)
        sign = np.concatenate([np.ones(n), -np.ones(n)])
        Q = (sign[:, None] * sign[None, :]) * np.tile(Kfull, (2, 2))
        QD = np.concatenate([np.diag(Kfull), np.diag(Kfull)])
        p = np.concatenate([self.epsilon - y, self.epsilon + y])
        Cvec = np.concatenate([self.C * sw, self.C * sw])
        alpha2, rho, it, obj, timed_out = _mlkern.svm_solve(Q, QD, p, sign, np.zeros(2 * n), Cvec, self.tol, self.max_iter)
        if timed_out:
            warnings.warn('Solver terminated early (max_iter=%i).  Consider pre-processing your data with StandardScaler or MinMaxScaler.' % self.max_iter, ConvergenceWarning)
        coef = alpha2[:n] - alpha2[n:]
        nz = np.where(coef != 0)[0]
        self.support_ = nz.astype(np.int32)
        self.support_vectors_ = X[nz].astype(np.float64)
        self.dual_coef_ = coef[nz].reshape(1, -1)
        self._dual_coef_ = self.dual_coef_
        self.intercept_ = np.array([-rho])
        self._intercept_ = self.intercept_
        self.n_support_ = np.array([len(nz)], dtype=np.int32)
        self.n_iter_ = it
        self.fit_status_ = 0
        self.shape_fit_ = X.shape
        self.n_features_in_ = X.shape[1]
        self._fit_X = X
        return self

    def predict(self, X):
        check_is_fitted(self, 'support_')
        Xa = self._validate_data(X, reset=False)
        Ks = self._kmat(Xa, self.support_vectors_)
        return Ks @ self.dual_coef_.ravel() + self.intercept_[0]

    @property
    def coef_(self):
        if self.kernel != 'linear':
            raise AttributeError('coef_ is only available when using a linear kernel')
        return self.dual_coef_ @ self.support_vectors_


class OneClassSVM(BaseSVM):
    def __init__(self, *a, **k):
        raise NotImplementedError('OneClassSVM no está disponible en esta versión en miniatura')
