import math
import warnings
import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted
from sklearn.exceptions import ConvergenceWarning
from sklearn.utils import check_array, check_X_y, check_random_state, _to_array


def _center(X, y, fit_intercept, sample_weight=None):
    if fit_intercept:
        if sample_weight is not None:
            w = np.asarray(sample_weight, dtype=np.float64)
            Xo = np.average(X, axis=0, weights=w)
            yo = np.average(y, axis=0, weights=w)
        else:
            Xo = X.mean(axis=0)
            yo = y.mean(axis=0)
        return X - Xo, y - yo, Xo, yo
    return X, y, np.zeros(X.shape[1]), (0.0 if y.ndim == 1 else np.zeros(y.shape[1]))


class LinearModel(BaseEstimator):
    def _decision_function(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        return X @ self.coef_.T + self.intercept_

    def predict(self, X):
        return self._decision_function(X)

    def _set_intercept(self, Xo, yo):
        if self.fit_intercept:
            self.intercept_ = yo - Xo @ self.coef_.T
        else:
            self.intercept_ = 0.0


class LinearRegression(RegressorMixin, LinearModel):
    def __init__(self, *, fit_intercept=True, copy_X=True, tol=1e-6, n_jobs=None, positive=False):
        self.fit_intercept = fit_intercept
        self.copy_X = copy_X
        self.tol = tol
        self.n_jobs = n_jobs
        self.positive = positive

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        Xc, yc, Xo, yo = _center(X, y, self.fit_intercept, sample_weight)
        if sample_weight is not None:
            sw = np.sqrt(np.asarray(sample_weight, dtype=np.float64))
            Xc = Xc * sw[:, None]
            yc = yc * (sw if yc.ndim == 1 else sw[:, None])
        if self.positive:
            coef = np.array([max(0.0, c) for c in np.linalg.lstsq(Xc, yc)[0]])
        else:
            coef, _, rank, sing = np.linalg.lstsq(Xc, yc)
            self.rank_ = int(rank)
            self.singular_ = sing
        self.coef_ = coef.T if yc.ndim == 2 else coef
        self._set_intercept(Xo, yo)
        return self


def _ridge_solve(Xc, yc, alpha):
    n, d = Xc.shape
    a = np.atleast_1d(alpha)
    if d <= n:
        A = Xc.T @ Xc
        return np.linalg.solve(A + np.diag(np.full(d, float(a[0]))) if a.size == 1 else A + np.diag(a), Xc.T @ yc)
    K = Xc @ Xc.T
    dual = np.linalg.solve(K + float(a[0]) * np.eye(n), yc)
    return Xc.T @ dual


class Ridge(RegressorMixin, LinearModel):
    def __init__(self, alpha=1.0, *, fit_intercept=True, copy_X=True, max_iter=None, tol=1e-4, solver='auto', positive=False, random_state=None):
        self.alpha = alpha
        self.fit_intercept = fit_intercept
        self.copy_X = copy_X
        self.max_iter = max_iter
        self.tol = tol
        self.solver = solver
        self.positive = positive
        self.random_state = random_state

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        Xc, yc, Xo, yo = _center(X, y, self.fit_intercept, sample_weight)
        coef = _ridge_solve(Xc, yc, self.alpha)
        self.coef_ = coef.T if yc.ndim == 2 else coef
        self._set_intercept(Xo, yo)
        self.n_iter_ = None
        return self


class RidgeCV(RegressorMixin, LinearModel):
    def __init__(self, alphas=(0.1, 1.0, 10.0), *, fit_intercept=True, scoring=None, cv=None, gcv_mode=None, store_cv_results=False, alpha_per_target=False):
        self.alphas = alphas
        self.fit_intercept = fit_intercept
        self.scoring = scoring
        self.cv = cv
        self.gcv_mode = gcv_mode
        self.store_cv_results = store_cv_results
        self.alpha_per_target = alpha_per_target

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        best = None
        if self.cv is None:
            Xc, yc, Xo, yo = _center(X, y, self.fit_intercept)
            n = X.shape[0]
            scores = []
            for a in self.alphas:
                H = Xc @ np.linalg.solve(Xc.T @ Xc + a * np.eye(X.shape[1]), Xc.T)
                if self.fit_intercept:
                    H = H + 1.0 / n
                res = (y - H @ y) / (1 - np.diag(H))
                scores.append(-float(np.mean(res ** 2)))
            k = int(np.argmax(scores))
            self.alpha_ = float(self.alphas[k])
            self.best_score_ = scores[k]
        else:
            from sklearn.model_selection import cross_val_score
            sc = [cross_val_score(Ridge(alpha=a, fit_intercept=self.fit_intercept), X, y, cv=self.cv, scoring=self.scoring).mean() for a in self.alphas]
            k = int(np.argmax(sc))
            self.alpha_ = float(self.alphas[k])
            self.best_score_ = sc[k]
        m = Ridge(alpha=self.alpha_, fit_intercept=self.fit_intercept).fit(X, y)
        self.coef_, self.intercept_ = m.coef_, m.intercept_
        return self


def _soft(x, t):
    return math.copysign(max(abs(x) - t, 0.0), x)


def _cd(Xc, yc, alpha, beta, max_iter, tol, positive=False, w0=None):
    """Descenso por coordenadas cíclico de ElasticNet (el mismo bucle y el mismo criterio de parada que scikit-learn)."""
    n, d = Xc.shape
    w = np.zeros(d) if w0 is None else w0.copy()
    norm2 = (Xc ** 2).sum(axis=0)
    R = yc - Xc @ w
    tol_abs = tol * float(yc @ yc)

    def gap_of(w, R):
        XtA = Xc.T @ R - beta * w
        dual = float(np.max(XtA)) if positive else float(np.max(np.abs(XtA)))
        Rn = float(R @ R)
        wl2 = float(w @ w) if beta > 0 else 0.0
        Ry = float(R @ yc)
        l1 = float(np.abs(w).sum())
        if dual > alpha:
            const = alpha / dual
            A = Rn * const * const
            g = 0.5 * (Rn + A)
        else:
            const = 1.0
            g = Rn
        g += alpha * l1 - const * Ry + 0.5 * beta * (1 + const * const) * wl2
        return g, dual

    gap, _ = gap_of(w, R)
    if gap <= tol_abs:
        return w, gap, 0
    n_iter = 0
    for it in range(max_iter):
        n_iter = it + 1
        w_max = 0.0
        d_max = 0.0
        for j in range(d):
            if norm2[j] == 0.0:
                continue
            wj = w[j]
            tmp = float(Xc[:, j] @ R) + wj * norm2[j]
            if positive and tmp < 0:
                nw = 0.0
            else:
                nw = _soft(tmp, alpha) / (norm2[j] + beta)
            if nw != wj:
                R = R + (wj - nw) * Xc[:, j]
            w[j] = nw
            d_max = max(d_max, abs(nw - wj))
            w_max = max(w_max, abs(nw))
        if w_max == 0.0 or d_max / w_max <= tol or it == max_iter - 1:
            gap, _ = gap_of(w, R)
            if gap <= tol_abs:
                break
    else:
        warnings.warn('Objective did not converge. You might want to increase the number of iterations, check the scale of the features or consider increasing regularisation. Duality gap: %.6e, tolerance: %.3e' % (gap, tol_abs), ConvergenceWarning)
    return w, gap, n_iter


class ElasticNet(RegressorMixin, LinearModel):
    def __init__(self, alpha=1.0, *, l1_ratio=0.5, fit_intercept=True, precompute=False, max_iter=1000, copy_X=True, tol=1e-4, warm_start=False, positive=False, random_state=None, selection='cyclic'):
        self.alpha = alpha
        self.l1_ratio = l1_ratio
        self.fit_intercept = fit_intercept
        self.precompute = precompute
        self.max_iter = max_iter
        self.copy_X = copy_X
        self.tol = tol
        self.warm_start = warm_start
        self.positive = positive
        self.random_state = random_state
        self.selection = selection

    def fit(self, X, y, sample_weight=None, check_input=True):
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        n = X.shape[0]
        Xc, yc, Xo, yo = _center(X, y, self.fit_intercept)
        if yc.ndim == 2:
            ws = [_cd(Xc, yc[:, k], self.alpha * self.l1_ratio * n, self.alpha * (1 - self.l1_ratio) * n, self.max_iter, self.tol, self.positive)[0] for k in range(yc.shape[1])]
            self.coef_ = np.array(ws)
            self.n_iter_ = None
        else:
            w, gap, n_iter = _cd(Xc, yc, self.alpha * self.l1_ratio * n, self.alpha * (1 - self.l1_ratio) * n, self.max_iter, self.tol, self.positive)
            self.coef_ = w
            self.dual_gap_ = gap / n
            self.n_iter_ = n_iter
        self._set_intercept(Xo, yo)
        return self

    @property
    def sparse_coef_(self):
        return self.coef_


class Lasso(ElasticNet):
    def __init__(self, alpha=1.0, *, fit_intercept=True, precompute=False, copy_X=True, max_iter=1000, tol=1e-4, warm_start=False, positive=False, random_state=None, selection='cyclic'):
        super().__init__(alpha=alpha, l1_ratio=1.0, fit_intercept=fit_intercept, precompute=precompute, copy_X=copy_X, max_iter=max_iter, tol=tol, warm_start=warm_start, positive=positive, random_state=random_state, selection=selection)

    def get_params(self, deep=True):
        p = super().get_params(deep)
        p.pop('l1_ratio', None)
        return p

    @classmethod
    def _get_param_names(cls):
        return [k for k in super()._get_param_names() if k != 'l1_ratio']


def _alpha_grid(X, y, l1_ratio=1.0, n_alphas=100, eps=1e-3, fit_intercept=True):
    n = X.shape[0]
    Xc, yc, _, _ = _center(X, y, fit_intercept)
    a_max = np.abs(Xc.T @ yc).max() / (n * l1_ratio)
    return np.logspace(np.log10(a_max * eps), np.log10(a_max), num=n_alphas)[::-1]


class LassoCV(RegressorMixin, LinearModel):
    def __init__(self, *, eps=1e-3, n_alphas=100, alphas=None, fit_intercept=True, precompute='auto', max_iter=1000, tol=1e-4, copy_X=True, cv=None, verbose=False, n_jobs=None, positive=False, random_state=None, selection='cyclic'):
        self.eps = eps
        self.n_alphas = n_alphas
        self.alphas = alphas
        self.fit_intercept = fit_intercept
        self.precompute = precompute
        self.max_iter = max_iter
        self.tol = tol
        self.copy_X = copy_X
        self.cv = cv
        self.verbose = verbose
        self.n_jobs = n_jobs
        self.positive = positive
        self.random_state = random_state
        self.selection = selection

    def fit(self, X, y):
        from sklearn.model_selection import KFold
        X, y = self._validate_data(X, y)
        y = np.asarray(y, dtype=np.float64)
        alphas = _alpha_grid(X, y, 1.0, self.n_alphas, self.eps, self.fit_intercept) if self.alphas is None else np.sort(np.asarray(self.alphas))[::-1]
        cv = KFold(self.cv or 5) if not hasattr(self.cv, 'split') else self.cv
        mse = np.zeros((len(alphas), cv.get_n_splits(X)))
        for f, (tr, te) in enumerate(cv.split(X)):
            w0 = None
            for k, a in enumerate(alphas):
                m = Lasso(alpha=a, fit_intercept=self.fit_intercept, max_iter=self.max_iter, tol=self.tol).fit(X[tr], y[tr])
                mse[k, f] = np.mean((y[te] - m.predict(X[te])) ** 2)
        self.alphas_ = alphas
        self.mse_path_ = mse
        self.alpha_ = float(alphas[int(np.argmin(mse.mean(axis=1)))])
        m = Lasso(alpha=self.alpha_, fit_intercept=self.fit_intercept, max_iter=self.max_iter, tol=self.tol).fit(X, y)
        self.coef_, self.intercept_ = m.coef_, m.intercept_
        return self


# ───────────────────────── regresión logística ─────────────────────────

def _softmax(Z):
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -500, 500)))


class LogisticRegression(ClassifierMixin, LinearModel):
    def __init__(self, penalty='deprecated', *, C=1.0, l1_ratio=0.0, dual=False, tol=1e-4, fit_intercept=True, intercept_scaling=1, class_weight=None, random_state=None, solver='lbfgs', max_iter=100, verbose=0, warm_start=False, n_jobs=None):
        self.penalty = penalty
        self.dual = dual
        self.tol = tol
        self.C = C
        self.fit_intercept = fit_intercept
        self.intercept_scaling = intercept_scaling
        self.class_weight = class_weight
        self.random_state = random_state
        self.solver = solver
        self.max_iter = max_iter
        self.verbose = verbose
        self.warm_start = warm_start
        self.n_jobs = n_jobs
        self.l1_ratio = l1_ratio

    def _eff_penalty(self):
        pen = self.penalty
        if isinstance(pen, str) and pen == 'deprecated':
            if self.C == float('inf'):
                return None
            if self.l1_ratio == 0:
                return 'l2'
            return 'l1' if self.l1_ratio == 1 else 'elasticnet'
        return pen

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        self.classes_ = np.unique(y)
        if len(self.classes_) < 2:
            raise ValueError('This solver needs samples of at least 2 classes in the data, but the data contains only one class: %r' % self.classes_[0])
        eff = self._eff_penalty()
        if eff in ('l1', 'elasticnet'):
            raise ValueError('penalty=%r no está disponible en esta versión en miniatura (usa l2 o sin penalización)' % eff)
        n, d = X.shape
        K = len(self.classes_)
        yi = np.searchsorted(self.classes_, y)
        sw = np.ones(n) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        if self.class_weight is not None:
            if self.class_weight == 'balanced':
                cnt = np.bincount(yi, minlength=K)
                cw = n / (K * cnt)
            else:
                cw = np.array([self.class_weight.get(c, 1.0) for c in self.classes_.tolist()])
            sw = sw * cw[yi]
        reg = 0.0 if eff in (None, 'none') else 1.0 / self.C
        Xa = np.hstack([X, np.ones((n, 1))]) if self.fit_intercept else X
        p = Xa.shape[1]
        pen = np.ones(p) * reg
        if self.fit_intercept:
            pen[-1] = 0.0
        if K == 2:
            t = (yi == 1).astype(np.float64)
            wv = np.zeros(p)

            def f_grad(w):
                z = Xa @ w
                pr = _sigmoid(z)
                loss = float(np.sum(sw * ((np.maximum(z, 0) + np.log1p(np.exp(-np.abs(z)))) - t * z))) + 0.5 * float(np.sum(pen * w * w))
                g = Xa.T @ (sw * (pr - t)) + pen * w
                return loss, g, pr
            loss, g, pr = f_grad(wv)
            for it in range(100):
                if np.abs(g).max() < 1e-9:
                    break
                H = (Xa * (sw * pr * (1 - pr))[:, None]).T @ Xa + np.diag(pen)
                step = np.linalg.lstsq(H, g)[0]
                s = 1.0
                while s > 1e-10:
                    nl, ng, npr = f_grad(wv - s * step)
                    if nl <= loss + 1e-12 * abs(loss):
                        break
                    s /= 2
                wv = wv - s * step
                loss, g, pr = nl, ng, npr
            self.n_iter_ = np.array([it + 1])
            self.coef_ = wv[:d].reshape(1, -1)
            self.intercept_ = np.array([wv[-1]]) if self.fit_intercept else np.zeros(1)
        else:
            T = np.zeros((n, K))
            T[np.arange(n), yi] = 1.0
            W = np.zeros((p, K))

            def f_grad_m(W):
                Z = Xa @ W
                P = _softmax(Z)
                lse = np.log(np.exp(Z - Z.max(axis=1, keepdims=True)).sum(axis=1)) + Z.max(axis=1)
                loss = float(np.sum(sw * (lse - (Z * T).sum(axis=1)))) + 0.5 * float(np.sum(pen[:, None] * W * W))
                G = Xa.T @ (sw[:, None] * (P - T)) + pen[:, None] * W
                return loss, G, P
            loss, G, P = f_grad_m(W)
            for it in range(60):
                if np.abs(G).max() < 1e-9:
                    break
                H = np.zeros((p * K, p * K))
                for a in range(K):
                    for b in range(a, K):
                        wgt = sw * P[:, a] * ((1.0 if a == b else 0.0) - P[:, b])
                        blk = (Xa * wgt[:, None]).T @ Xa
                        if a == b:
                            blk = blk + np.diag(pen)
                        H[a * p:(a + 1) * p, b * p:(b + 1) * p] = blk
                        if a != b:
                            H[b * p:(b + 1) * p, a * p:(a + 1) * p] = blk.T
                gv = G.T.reshape(-1)
                step = np.linalg.lstsq(H, gv)[0].reshape(K, p).T
                s = 1.0
                while s > 1e-10:
                    nl, nG, nP = f_grad_m(W - s * step)
                    if nl <= loss + 1e-12 * abs(loss):
                        break
                    s /= 2
                W = W - s * step
                loss, G, P = nl, nG, nP
            self.n_iter_ = np.array([it + 1])
            self.coef_ = W[:d].T
            self.intercept_ = W[-1] if self.fit_intercept else np.zeros(K)
        return self

    def decision_function(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        z = X @ self.coef_.T + self.intercept_
        return z.ravel() if z.shape[1] == 1 else z

    def predict_proba(self, X):
        z = self.decision_function(X)
        if z.ndim == 1:
            p = _sigmoid(z)
            return np.column_stack([1 - p, p])
        return _softmax(z)

    def predict_log_proba(self, X):
        return np.log(self.predict_proba(X))

    def predict(self, X):
        z = self.decision_function(X)
        if z.ndim == 1:
            return self.classes_[(z > 0).astype(int)]
        return self.classes_[np.argmax(z, axis=1)]


class RidgeClassifier(ClassifierMixin, LinearModel):
    def __init__(self, alpha=1.0, *, fit_intercept=True, copy_X=True, max_iter=None, tol=1e-4, class_weight=None, solver='auto', positive=False, random_state=None):
        self.alpha = alpha
        self.fit_intercept = fit_intercept
        self.copy_X = copy_X
        self.max_iter = max_iter
        self.tol = tol
        self.class_weight = class_weight
        self.solver = solver
        self.positive = positive
        self.random_state = random_state

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        self.classes_ = np.unique(y)
        T = np.where(y[:, None] == self.classes_[None, :], 1.0, -1.0)
        if len(self.classes_) == 2:
            T = T[:, 1]
        m = Ridge(alpha=self.alpha, fit_intercept=self.fit_intercept).fit(X, T)
        self.coef_ = m.coef_.reshape(1, -1) if T.ndim == 1 else m.coef_
        self.intercept_ = np.atleast_1d(m.intercept_)
        return self

    def decision_function(self, X):
        z = super()._decision_function(X)
        return z.ravel() if z.ndim == 2 and z.shape[1] == 1 else z

    def predict(self, X):
        z = self.decision_function(X)
        if z.ndim == 1:
            return self.classes_[(z > 0).astype(int)]
        return self.classes_[np.argmax(z, axis=1)]


class Perceptron(ClassifierMixin, LinearModel):
    def __init__(self, *, penalty=None, alpha=0.0001, l1_ratio=0.15, fit_intercept=True, max_iter=1000, tol=1e-3, shuffle=True, verbose=0, eta0=1.0, n_jobs=None, random_state=0, early_stopping=False, validation_fraction=0.1, n_iter_no_change=5, class_weight=None, warm_start=False):
        self.penalty = penalty
        self.alpha = alpha
        self.l1_ratio = l1_ratio
        self.fit_intercept = fit_intercept
        self.max_iter = max_iter
        self.tol = tol
        self.shuffle = shuffle
        self.verbose = verbose
        self.eta0 = eta0
        self.n_jobs = n_jobs
        self.random_state = random_state
        self.early_stopping = early_stopping
        self.validation_fraction = validation_fraction
        self.n_iter_no_change = n_iter_no_change
        self.class_weight = class_weight
        self.warm_start = warm_start

    def fit(self, X, y, sample_weight=None):
        X, y = self._validate_data(X, y)
        self.classes_ = np.unique(y)
        if len(self.classes_) != 2:
            raise ValueError('Perceptron en miniatura: solo clasificación binaria')
        t = np.where(y == self.classes_[1], 1.0, -1.0)
        w = np.zeros(X.shape[1])
        b = 0.0
        rng = check_random_state(self.random_state)
        for epoch in range(self.max_iter):
            errors = 0
            order = rng.permutation(len(X)) if self.shuffle else np.arange(len(X))
            for i in order:
                if t[i] * (X[i] @ w + b) <= 0:
                    w = w + self.eta0 * t[i] * X[i]
                    b = b + self.eta0 * t[i] if self.fit_intercept else b
                    errors += 1
            if errors == 0:
                break
        self.n_iter_ = epoch + 1
        self.coef_ = w.reshape(1, -1)
        self.intercept_ = np.array([b])
        return self

    def decision_function(self, X):
        z = super()._decision_function(X)
        return z.ravel()

    def predict(self, X):
        return self.classes_[(self.decision_function(X) > 0).astype(int)]
