import warnings
import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted
from sklearn.exceptions import ConvergenceWarning
from sklearn.utils import check_random_state, shuffle as _shuffle, _to_array
from sklearn.utils._param_validation import check_interval


def _logistic(X):
    return 1.0 / (1.0 + np.exp(-X))


def _softmax(X):
    tmp = X - X.max(axis=1)[:, np.newaxis]
    e = np.exp(tmp)
    return e / e.sum(axis=1)[:, np.newaxis]


def _act(name, X):
    if name == 'identity':
        return X
    if name == 'logistic':
        return _logistic(X)
    if name == 'tanh':
        return np.tanh(X)
    if name == 'relu':
        return np.maximum(X, 0)
    if name == 'softmax':
        return _softmax(X)
    if name == 'exp':
        return np.exp(X)
    raise ValueError("The 'activation' parameter of MLP must be a str among {'identity', 'logistic', 'tanh', 'relu'}. Got %r instead." % (name,))


def _deriv(name, Z, delta):
    if name == 'logistic':
        return delta * Z * (1 - Z)
    if name == 'tanh':
        return delta * (1 - Z ** 2)
    if name == 'relu':
        return np.where(Z == 0, 0.0, delta)
    return delta


def _xlogy(x, y):
    return np.where(x == 0, 0.0, x * np.log(np.where(x == 0, 1.0, y)))


def _squared_loss(y_true, y_pred, sw=None):
    return 0.5 * np.average((y_true - y_pred) ** 2, weights=sw, axis=0).mean()


def _log_loss(y_true, y_prob, sw=None):
    eps = np.finfo(np.float64).eps
    y_prob = np.clip(y_prob, eps, 1 - eps)
    if y_prob.shape[1] == 1:
        y_prob = np.append(1 - y_prob, y_prob, axis=1)
    if y_true.shape[1] == 1:
        y_true = np.append(1 - y_true, y_true, axis=1)
    return -np.average(_xlogy(y_true, y_prob), weights=sw, axis=0).sum()


def _binary_log_loss(y_true, y_prob, sw=None):
    eps = np.finfo(np.float64).eps
    y_prob = np.clip(y_prob, eps, 1 - eps)
    return -np.average(_xlogy(y_true, y_prob) + _xlogy(1 - y_true, 1 - y_prob), weights=sw, axis=0).sum()


class _Adam:
    def __init__(self, params, lr, b1, b2, eps):
        self.learning_rate_init = lr
        self.learning_rate = float(lr)
        self.b1, self.b2, self.eps = b1, b2, eps
        self.t = 0
        self.ms = [np.zeros_like(p) for p in params]
        self.vs = [np.zeros_like(p) for p in params]

    def update_params(self, params, grads):
        self.t += 1
        self.ms = [self.b1 * m + (1 - self.b1) * g for m, g in zip(self.ms, grads)]
        self.vs = [self.b2 * v + (1 - self.b2) * (g ** 2) for v, g in zip(self.vs, grads)]
        self.learning_rate = self.learning_rate_init * np.sqrt(1 - self.b2 ** self.t) / (1 - self.b1 ** self.t)
        for p, m, v in zip(params, self.ms, self.vs):
            p += -self.learning_rate * m / (np.sqrt(v) + self.eps)

    def iteration_ends(self, time_step):
        pass

    def trigger_stopping(self, msg, verbose):
        if verbose:
            print(msg + ' Stopping.')
        return True


class _SGD:
    def __init__(self, params, lr, schedule, momentum, nesterov, power_t):
        self.learning_rate_init = lr
        self.learning_rate = float(lr)
        self.lr_schedule = schedule
        self.momentum = momentum
        self.nesterov = nesterov
        self.power_t = power_t
        self.velocities = [np.zeros_like(p) for p in params]

    def update_params(self, params, grads):
        updates = [self.momentum * v - self.learning_rate * g for v, g in zip(self.velocities, grads)]
        self.velocities = updates
        if self.nesterov:
            updates = [self.momentum * v - self.learning_rate * g for v, g in zip(self.velocities, grads)]
        for p, u in zip(params, updates):
            p += u

    def iteration_ends(self, time_step):
        if self.lr_schedule == 'invscaling':
            self.learning_rate = float(self.learning_rate_init) / (time_step + 1) ** self.power_t

    def trigger_stopping(self, msg, verbose):
        if self.lr_schedule != 'adaptive':
            if verbose:
                print(msg + ' Stopping.')
            return True
        if self.learning_rate <= 1e-6:
            if verbose:
                print(msg + ' Learning rate too small. Stopping.')
            return True
        self.learning_rate /= 5.0
        if verbose:
            print(msg + ' Setting learning rate to %f' % self.learning_rate)
        return False


class BaseMultilayerPerceptron(BaseEstimator):
    def _check(self):
        if self.activation not in ('identity', 'logistic', 'tanh', 'relu'):
            raise ValueError("The 'activation' parameter of %s must be a str among {'identity', 'logistic', 'tanh', 'relu'}. Got %r instead." % (type(self).__name__, self.activation))
        if self.solver not in ('lbfgs', 'sgd', 'adam'):
            raise ValueError("The 'solver' parameter of %s must be a str among {'lbfgs', 'sgd', 'adam'}. Got %r instead." % (type(self).__name__, self.solver))
        check_interval(self, 'max_iter', self.max_iter, int, 1, None, 'left')
        check_interval(self, 'alpha', self.alpha, float, 0.0, None, 'left')
        check_interval(self, 'learning_rate_init', self.learning_rate_init, float, 0.0, None, 'neither')

    def _init_coef(self, fan_in, fan_out):
        factor = 2.0 if self.activation == 'logistic' else 6.0
        bound = np.sqrt(factor / (fan_in + fan_out))
        coef = self._random_state.uniform(-bound, bound, (fan_in, fan_out))
        inter = self._random_state.uniform(-bound, bound, fan_out)
        return coef, inter

    def _initialize(self, y, layer_units):
        self.n_iter_ = 0
        self.t_ = 0
        self.n_outputs_ = y.shape[1]
        self.n_layers_ = len(layer_units)
        if not self._is_clf:
            self.out_activation_ = 'exp' if getattr(self, 'loss', '') == 'poisson' else 'identity'
        elif self._y_type == 'multiclass':
            self.out_activation_ = 'softmax'
        else:
            self.out_activation_ = 'logistic'
        self.coefs_ = []
        self.intercepts_ = []
        for i in range(self.n_layers_ - 1):
            c, b = self._init_coef(layer_units[i], layer_units[i + 1])
            self.coefs_.append(c)
            self.intercepts_.append(b)
        self._best_coefs = [c.copy() for c in self.coefs_]
        self._best_intercepts = [b.copy() for b in self.intercepts_]
        if self.solver in ('sgd', 'adam'):
            self.loss_curve_ = []
            self._no_improvement_count = 0
            if self.early_stopping:
                self.validation_scores_ = []
                self.best_validation_score_ = -np.inf
                self.best_loss_ = None
            else:
                self.best_loss_ = np.inf
                self.validation_scores_ = None
                self.best_validation_score_ = None

    def _forward(self, X):
        acts = [X]
        a = X
        for i in range(self.n_layers_ - 1):
            a = a @ self.coefs_[i] + self.intercepts_[i]
            if i + 1 != self.n_layers_ - 1:
                a = _act(self.activation, a)
            acts.append(a)
        acts[-1] = _act(self.out_activation_, acts[-1])
        return acts

    def _forward_fast(self, X):
        a = X
        for i in range(self.n_layers_ - 1):
            a = a @ self.coefs_[i] + self.intercepts_[i]
            if i != self.n_layers_ - 2:
                a = _act(self.activation, a)
        return _act(self.out_activation_, a)

    def _loss_fn(self):
        name = getattr(self, 'loss', 'log_loss')
        if name == 'squared_error':
            return _squared_loss
        if name == 'log_loss' and self.out_activation_ == 'logistic':
            return _binary_log_loss
        return _log_loss

    def _backprop(self, X, y, sw):
        n = X.shape[0]
        acts = self._forward(X)
        loss = self._loss_fn()(y, acts[-1], sw)
        values = 0
        for s in self.coefs_:
            s = s.ravel()
            values += float(np.dot(s, s))
        sw_sum = n if sw is None else sw.sum()
        loss += (0.5 * self.alpha) * values / sw_sum
        last = self.n_layers_ - 2
        deltas = [None] * (self.n_layers_ - 1)
        deltas[last] = acts[-1] - y
        if sw is not None:
            deltas[last] = deltas[last] * sw.reshape(-1, 1)
        coef_grads = [None] * (self.n_layers_ - 1)
        inter_grads = [None] * (self.n_layers_ - 1)

        def grads(layer):
            g = acts[layer].T @ deltas[layer]
            g = g + self.alpha * self.coefs_[layer]
            coef_grads[layer] = g / sw_sum
            inter_grads[layer] = np.sum(deltas[layer], axis=0) / sw_sum
        grads(last)
        for i in range(last, 0, -1):
            deltas[i - 1] = deltas[i] @ self.coefs_[i].T
            deltas[i - 1] = _deriv(self.activation, acts[i], deltas[i - 1])
            grads(i - 1)
        return loss, coef_grads, inter_grads

    def _fit(self, X, y, sample_weight=None, incremental=False):
        self._check()
        hls = self.hidden_layer_sizes
        if not hasattr(hls, '__iter__'):
            hls = [hls]
        hls = list(hls)
        if any(h <= 0 for h in hls):
            raise ValueError('hidden_layer_sizes must be > 0, got %s.' % hls)
        first_pass = not hasattr(self, 'coefs_') or (not self.warm_start and not incremental)
        X, y = self._validate_input(X, y, incremental, first_pass)
        n_samples, n_features = X.shape
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        if y.ndim == 1:
            y = y.reshape((-1, 1))
        self.n_outputs_ = y.shape[1]
        layer_units = [n_features] + hls + [self.n_outputs_]
        self._random_state = check_random_state(self.random_state)
        if first_pass:
            self._initialize(y, layer_units)
        if self.solver in ('sgd', 'adam'):
            self._fit_stochastic(X, y, sw, incremental)
        else:
            self._fit_lbfgs(X, y, sw)
        for w in self.coefs_ + self.intercepts_:
            if not np.isfinite(w).all():
                raise ValueError('Solver produced non-finite parameter weights. The input data may contain large values and need to be preprocessed.')
        return self

    def _fit_stochastic(self, X, y, sw, incremental):
        params = self.coefs_ + self.intercepts_
        if not incremental or not hasattr(self, '_optimizer'):
            if self.solver == 'sgd':
                self._optimizer = _SGD(params, self.learning_rate_init, self.learning_rate, self.momentum, self.nesterovs_momentum, self.power_t)
            else:
                self._optimizer = _Adam(params, self.learning_rate_init, self.beta_1, self.beta_2, self.epsilon)
        early = self.early_stopping
        if early and incremental:
            raise ValueError('partial_fit does not support early_stopping=True')
        if early:
            from sklearn.model_selection import train_test_split
            stratify = y.ravel() if (self._is_clf and self.n_outputs_ == 1) else None
            if sw is None:
                X_train, X_val, y_train, y_val = train_test_split(X, y, random_state=self._random_state, test_size=self.validation_fraction, stratify=stratify)
                sw_train = sw_val = None
            else:
                X_train, X_val, y_train, y_val, sw_train, sw_val = train_test_split(X, y, sw, random_state=self._random_state, test_size=self.validation_fraction, stratify=stratify)
            if X_val.shape[0] < 2:
                raise ValueError("The validation set is too small. Increase 'validation_fraction' or the size of your dataset.")
            if self._is_clf:
                y_val = self._inverse_labels(y_val)
        else:
            X_train, y_train, sw_train = X, y, sw
            X_val = y_val = sw_val = None
        n_samples = X_train.shape[0]
        sample_idx = np.arange(n_samples, dtype=int)
        if isinstance(self.batch_size, str) and self.batch_size == 'auto':
            batch_size = min(200, n_samples)
        else:
            if self.batch_size > n_samples:
                warnings.warn('Got `batch_size` less than 1 or larger than sample size. It is going to be clipped')
            batch_size = int(np.clip(self.batch_size, 1, n_samples))
        self.n_iter_ = 0
        for it in range(self.max_iter):
            if self.shuffle:
                sample_idx = _shuffle(sample_idx, random_state=self._random_state)
            accumulated = 0.0
            for start in range(0, n_samples, batch_size):
                stop = min(start + batch_size, n_samples)
                if self.shuffle:
                    bidx = sample_idx[start:stop]
                else:
                    bidx = np.arange(start, stop)
                Xb = X_train[bidx]
                yb = y_train[bidx]
                swb = None if sw is None else sw_train[bidx]
                batch_loss, cg, ig = self._backprop(Xb, yb, swb)
                accumulated += batch_loss * (stop - start)
                self._optimizer.update_params(params, cg + ig)
            self.n_iter_ += 1
            self.loss_ = accumulated / X_train.shape[0]
            self.t_ += n_samples
            self.loss_curve_.append(self.loss_)
            if self.verbose:
                print('Iteration %d, loss = %.8f' % (self.n_iter_, self.loss_))
            self._update_no_improvement_count(early, X_val, y_val, sw_val)
            self._optimizer.iteration_ends(self.t_)
            if self._no_improvement_count > self.n_iter_no_change:
                if early:
                    msg = 'Validation score did not improve more than tol=%f for %d consecutive epochs.' % (self.tol, self.n_iter_no_change)
                else:
                    msg = 'Training loss did not improve more than tol=%f for %d consecutive epochs.' % (self.tol, self.n_iter_no_change)
                if self._optimizer.trigger_stopping(msg, self.verbose):
                    break
                self._no_improvement_count = 0
            if incremental:
                break
            if self.n_iter_ == self.max_iter:
                warnings.warn("Stochastic Optimizer: Maximum iterations (%d) reached and the optimization hasn't converged yet." % self.max_iter, ConvergenceWarning)
        if early:
            self.coefs_ = self._best_coefs
            self.intercepts_ = self._best_intercepts

    def _update_no_improvement_count(self, early, X, y, sw):
        if early:
            val = self._score(X, y, sample_weight=sw)
            self.validation_scores_.append(val)
            if self.verbose:
                print('Validation score: %f' % self.validation_scores_[-1])
            last = self.validation_scores_[-1]
            if last < self.best_validation_score_ + self.tol:
                self._no_improvement_count += 1
            else:
                self._no_improvement_count = 0
            if last > self.best_validation_score_:
                self.best_validation_score_ = last
                self._best_coefs = [c.copy() for c in self.coefs_]
                self._best_intercepts = [b.copy() for b in self.intercepts_]
        else:
            if self.loss_curve_[-1] > self.best_loss_ - self.tol:
                self._no_improvement_count += 1
            else:
                self._no_improvement_count = 0
            if self.loss_curve_[-1] < self.best_loss_:
                self.best_loss_ = self.loss_curve_[-1]

    def _fit_lbfgs(self, X, y, sw):
        from scipy.optimize import minimize
        shapes = [c.shape for c in self.coefs_]
        sizes = [b.shape[0] for b in self.intercepts_]

        def unpack(v):
            pos = 0
            cs = []
            for sh in shapes:
                n = sh[0] * sh[1]
                cs.append(v[pos:pos + n].reshape(sh))
                pos += n
            bs = []
            for s in sizes:
                bs.append(v[pos:pos + s])
                pos += s
            return cs, bs
        packed = np.concatenate([c.ravel() for c in self.coefs_] + [b.ravel() for b in self.intercepts_])

        def fg(v):
            self.coefs_, self.intercepts_ = unpack(v)
            loss, cg, ig = self._backprop(X, y, sw)
            return loss, np.concatenate([g.ravel() for g in cg] + [g.ravel() for g in ig])
        res = minimize(fg, packed, method='L-BFGS-B', jac=True, options={'maxfun': self.max_fun, 'maxiter': self.max_iter, 'gtol': self.tol})
        self.n_iter_ = res.nit
        if res.nit >= self.max_iter:
            warnings.warn('lbfgs failed to converge after %d iterations. Increase the number of iterations (max_iter) or scale the data.' % self.max_iter, ConvergenceWarning)
        self.loss_ = res.fun
        self.coefs_, self.intercepts_ = unpack(res.x)

    def fit(self, X, y, sample_weight=None):
        return self._fit(X, y, sample_weight, incremental=False)

    def partial_fit(self, X, y, sample_weight=None, classes=None):
        if self.solver not in ('sgd', 'adam'):
            raise AttributeError("partial_fit is only available for stochastic optimizers. %s is not stochastic." % self.solver)
        return self._fit(X, y, sample_weight, incremental=True)


class MLPClassifier(ClassifierMixin, BaseMultilayerPerceptron):
    _is_clf = True
    loss = 'log_loss'

    def __init__(self, hidden_layer_sizes=(100,), activation='relu', *, solver='adam', alpha=0.0001, batch_size='auto', learning_rate='constant', learning_rate_init=0.001, power_t=0.5, max_iter=200, shuffle=True, random_state=None, tol=1e-4, verbose=False, warm_start=False, momentum=0.9, nesterovs_momentum=True, early_stopping=False, validation_fraction=0.1, beta_1=0.9, beta_2=0.999, epsilon=1e-8, n_iter_no_change=10, max_fun=15000):
        self.hidden_layer_sizes = hidden_layer_sizes
        self.activation = activation
        self.solver = solver
        self.alpha = alpha
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.learning_rate_init = learning_rate_init
        self.power_t = power_t
        self.max_iter = max_iter
        self.shuffle = shuffle
        self.random_state = random_state
        self.tol = tol
        self.verbose = verbose
        self.warm_start = warm_start
        self.momentum = momentum
        self.nesterovs_momentum = nesterovs_momentum
        self.early_stopping = early_stopping
        self.validation_fraction = validation_fraction
        self.beta_1 = beta_1
        self.beta_2 = beta_2
        self.epsilon = epsilon
        self.n_iter_no_change = n_iter_no_change
        self.max_fun = max_fun

    def _validate_input(self, X, y, incremental, reset):
        X, y = self._validate_data(X, y, reset=reset)
        y = np.asarray(y)
        if y.ndim == 2 and y.shape[1] == 1:
            y = y.ravel()
        if reset or not hasattr(self, 'classes_'):
            self.classes_ = np.unique(y)
            self._y_type = 'binary' if len(self.classes_) <= 2 else 'multiclass'
        yi = np.searchsorted(self.classes_, y)
        if len(self.classes_) <= 2:
            yb = (yi == 1).astype(np.float64).reshape(-1, 1)
        else:
            yb = np.zeros((len(y), len(self.classes_)))
            yb[np.arange(len(y)), yi] = 1.0
        return X, yb

    def _inverse_labels(self, yb):
        if yb.shape[1] == 1:
            return self.classes_[(yb[:, 0] > 0.5).astype(int)]
        return self.classes_[np.argmax(yb, axis=1)]

    def _score(self, X, y, sample_weight=None):
        from sklearn.metrics import accuracy_score
        return accuracy_score(y, self.predict(X, _check=False), sample_weight=sample_weight)

    def predict(self, X, _check=True):
        check_is_fitted(self, 'coefs_')
        Xa = self._validate_data(X, reset=False) if _check else X
        y = self._forward_fast(Xa)
        if self.n_outputs_ == 1:
            y = y.ravel()
            return self.classes_[(y > 0.5).astype(int)]
        return self.classes_[np.argmax(y, axis=1)]

    def predict_proba(self, X):
        check_is_fitted(self, 'coefs_')
        Xa = self._validate_data(X, reset=False)
        y = self._forward_fast(Xa)
        if self.n_outputs_ == 1:
            y = y.ravel()
        if y.ndim == 1:
            return np.vstack([1 - y, y]).T
        return y

    def predict_log_proba(self, X):
        return np.log(self.predict_proba(X))


class MLPRegressor(RegressorMixin, BaseMultilayerPerceptron):
    _is_clf = False

    def __init__(self, hidden_layer_sizes=(100,), activation='relu', *, solver='adam', alpha=0.0001, batch_size='auto', learning_rate='constant', learning_rate_init=0.001, power_t=0.5, max_iter=200, shuffle=True, random_state=None, tol=1e-4, verbose=False, warm_start=False, momentum=0.9, nesterovs_momentum=True, early_stopping=False, validation_fraction=0.1, beta_1=0.9, beta_2=0.999, epsilon=1e-8, n_iter_no_change=10, max_fun=15000, loss='squared_error'):
        self.hidden_layer_sizes = hidden_layer_sizes
        self.activation = activation
        self.solver = solver
        self.alpha = alpha
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.learning_rate_init = learning_rate_init
        self.power_t = power_t
        self.max_iter = max_iter
        self.shuffle = shuffle
        self.random_state = random_state
        self.tol = tol
        self.verbose = verbose
        self.warm_start = warm_start
        self.momentum = momentum
        self.nesterovs_momentum = nesterovs_momentum
        self.early_stopping = early_stopping
        self.validation_fraction = validation_fraction
        self.beta_1 = beta_1
        self.beta_2 = beta_2
        self.epsilon = epsilon
        self.n_iter_no_change = n_iter_no_change
        self.max_fun = max_fun
        self.loss = loss

    def _validate_input(self, X, y, incremental, reset):
        X, y = self._validate_data(X, y, reset=reset)
        y = np.asarray(y, dtype=np.float64)
        if y.ndim == 2 and y.shape[1] == 1:
            y = y.ravel()
        return X, y

    def _score(self, X, y, sample_weight=None):
        from sklearn.metrics import r2_score
        return r2_score(y, self.predict(X, _check=False), sample_weight=sample_weight)

    def predict(self, X, _check=True):
        check_is_fitted(self, 'coefs_')
        Xa = self._validate_data(X, reset=False) if _check else X
        y = self._forward_fast(Xa)
        if y.shape[1] == 1:
            return y.ravel()
        return y
