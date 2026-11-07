import numpy as np
import numbers


def check_random_state(seed):
    if seed is None or seed is np.random:
        return np.random.mtrand._rand if hasattr(np.random, 'mtrand') else np.random.RandomState()
    if isinstance(seed, numbers.Integral):
        return np.random.RandomState(seed)
    if isinstance(seed, np.random.RandomState):
        return seed
    raise ValueError('%r cannot be used to seed a numpy.random.RandomState instance' % seed)


def _to_array(X):
    if hasattr(X, 'toarray'):
        return X.toarray()
    if hasattr(X, 'to_numpy'):
        return X.to_numpy()
    if not isinstance(X, (np.ndarray, list, tuple)) and hasattr(X, '__array__'):
        return X.__array__()
    return X


def check_array(array, *, dtype='numeric', ensure_2d=True, allow_nd=False, ensure_all_finite=True, force_all_finite=None, estimator=None, input_name='', copy=False, ensure_min_samples=1, ensure_min_features=1):
    X = _to_array(array)
    if not isinstance(X, np.ndarray):
        X = np.array(X)
    if dtype == 'numeric' and X.dtype.kind in 'OUS':
        try:
            X = X.astype(np.float64)
        except (ValueError, TypeError):
            raise ValueError('could not convert string to float: %r' % X.ravel()[0])
    elif dtype is not None and dtype != 'numeric':
        X = X.astype(dtype)
    elif X.dtype.kind in 'biu' and dtype == 'numeric':
        X = X.astype(np.float64) if False else X
    if ensure_2d and X.ndim != 2:
        if X.ndim == 1:
            raise ValueError('Expected 2D array, got 1D array instead:\narray=%s.\nReshape your data either using array.reshape(-1, 1) if your data has a single feature or array.reshape(1, -1) if it contains a single sample.' % (X,))
        raise ValueError('Expected 2D array, got scalar array instead:\narray=%s.' % (X,))
    allow_nan = isinstance(ensure_all_finite, str) and ensure_all_finite == 'allow-nan'
    if ensure_all_finite and X.dtype.kind == 'f':
        if not allow_nan and np.isnan(X).any():
            name = type(estimator).__name__ if estimator is not None else 'the estimator'
            raise ValueError('Input %s contains NaN.\n%s does not accept missing values encoded as NaN natively. For supported imputers see: https://scikit-learn.org/stable/modules/impute.html' % (input_name or 'X', name))
        if np.isinf(X).any():
            raise ValueError('Input %s contains infinity or a value too large for dtype(\'float64\').' % (input_name or 'X'))
    if X.ndim >= 1 and X.shape[0] < ensure_min_samples:
        raise ValueError('Found array with %d sample(s) (shape=%s) while a minimum of %d is required.' % (X.shape[0], X.shape, ensure_min_samples))
    return X.copy() if copy else X


def check_X_y(X, y, **kw):
    X = check_array(X, **{k: v for k, v in kw.items() if k in ('dtype', 'estimator', 'ensure_min_samples')})
    y = _to_array(y)
    y = np.asarray(y)
    if y.ndim == 2 and y.shape[1] == 1:
        y = y.ravel()
    if len(y) != X.shape[0]:
        raise ValueError('Found input variables with inconsistent numbers of samples: [%d, %d]' % (X.shape[0], len(y)))
    return X, y


def column_or_1d(y, warn=False):
    y = np.asarray(_to_array(y))
    if y.ndim == 2 and y.shape[1] == 1:
        return y.ravel()
    if y.ndim == 1:
        return y
    raise ValueError('y should be a 1d array, got an array of shape %s instead.' % (y.shape,))


def _num_samples(x):
    if hasattr(x, 'shape') and len(x.shape) > 0:
        return x.shape[0]
    return len(x)


def _safe_indexing(X, indices):
    if hasattr(X, 'iloc'):
        return X.iloc[list(indices)]
    if isinstance(X, np.ndarray):
        return X[indices]
    if hasattr(X, 'shape') and hasattr(X, '__getitem__'):      # tensores de PyTorch y similares
        return X[np.asarray(indices)]
    return [X[i] for i in indices]


def shuffle(*arrays, random_state=None, n_samples=None):
    return resample(*arrays, replace=False, n_samples=n_samples, random_state=random_state)


def resample(*arrays, replace=True, n_samples=None, random_state=None, stratify=None):
    rs = check_random_state(random_state)
    n = _num_samples(arrays[0])
    k = n if n_samples is None else n_samples
    if stratify is None:
        if replace:
            idx = rs.randint(0, n, size=k)
        else:
            idx = np.arange(n)
            rs.shuffle(idx)
            idx = idx[:k]
    else:
        y = np.asarray(stratify)
        classes, inv = np.unique(y, return_inverse=True)
        idx = []
        for c in range(len(classes)):
            members = np.where(inv == c)[0]
            kk = int(round(k * len(members) / n))
            idx.extend(rs.choice(members, size=kk, replace=replace).tolist())
        idx = np.array(idx)
        rs.shuffle(idx)
    out = [_safe_indexing(a, idx) for a in arrays]
    return out[0] if len(out) == 1 else out


def class_weight_compute(y):
    classes, counts = np.unique(y, return_counts=True)
    return dict(zip(classes.tolist(), (len(y) / (len(classes) * counts)).tolist()))


class Bunch(dict):
    """Diccionario con acceso por atributo (lo que devuelven load_iris, etc.)."""

    def __init__(self, **kwargs):
        super().__init__(kwargs)

    def __setattr__(self, key, value):
        self[key] = value

    def __getattr__(self, key):
        try:
            return self[key]
        except KeyError:
            raise AttributeError(key)

    def __dir__(self):
        return self.keys()


def compute_class_weight(class_weight, *, classes, y):
    if class_weight == 'balanced':
        counts = np.array([np.sum(y == c) for c in classes])
        return len(y) / (len(classes) * counts)
    return np.array([class_weight.get(c, 1.0) for c in classes])


def type_of_target(y):
    y = np.asarray(_to_array(y))
    if y.ndim > 1 and y.shape[1] > 1:
        return 'multilabel-indicator' if set(np.unique(y).tolist()) <= {0, 1} else 'multiclass-multioutput'
    y = y.ravel()
    if y.dtype.kind == 'f' and np.any(y != np.floor(y)):
        return 'continuous'
    n = len(np.unique(y))
    return 'binary' if n <= 2 else 'multiclass'


def multiclass_type(y):
    return type_of_target(y)


def sample_without_replacement(n_population, n_samples, method='auto', random_state=None):
    """Port del algoritmo de scikit-learn (misma secuencia de números aleatorios)."""
    if n_population < 0:
        raise ValueError('n_population should be greater than 0, got %s.' % n_population)
    if n_samples > n_population:
        raise ValueError('n_population should be greater or equal than n_samples, got n_samples > n_population (%s > %s)' % (n_samples, n_population))
    rng = check_random_state(random_state)
    ratio = n_samples / n_population if n_population != 0 else 1.0
    if method == 'auto' and 0.01 < ratio < 0.99:
        return rng.permutation(n_population)[:n_samples]
    if method == 'pool':
        pool = list(range(n_population))
        out = np.empty(n_samples, dtype=int)
        for i in range(n_samples):
            j = rng.randint(n_population - i)
            out[i] = pool[j]
            pool[j] = pool[n_population - i - 1]
        return out
    if (method == 'auto' or method == 'tracking_selection') and ratio < 0.2:
        out = np.empty(n_samples, dtype=int)
        selected = set()
        for i in range(n_samples):
            j = rng.randint(n_population)
            while j in selected:
                j = rng.randint(n_population)
            selected.add(j)
            out[i] = j
        return out
    out = np.arange(n_samples)
    for i in range(n_samples, n_population):
        j = rng.randint(0, i + 1)
        if j < n_samples:
            out[j] = i
    return out
