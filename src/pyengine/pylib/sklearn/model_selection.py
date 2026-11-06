import math
import numbers
import itertools
import numpy as np

from sklearn.base import BaseEstimator, clone, is_classifier
from sklearn.utils import check_random_state, _num_samples, _safe_indexing, _to_array


# ───────────────────────── tamaños de partición ─────────────────────────

def _validate_shuffle_split(n_samples, test_size, train_size, default_test_size=None):
    if test_size is None and train_size is None:
        test_size = default_test_size
    kind = lambda v: 'f' if isinstance(v, float) else ('i' if isinstance(v, numbers.Integral) else 'O')
    tk, rk = kind(test_size) if test_size is not None else 'O', kind(train_size) if train_size is not None else 'O'
    if (tk == 'i' and (test_size >= n_samples or test_size <= 0)) or (tk == 'f' and (test_size <= 0 or test_size >= 1)):
        raise ValueError('test_size={0} should be either positive and smaller than the number of samples {1} or a float in the (0, 1) range'.format(test_size, n_samples))
    if (rk == 'i' and (train_size >= n_samples or train_size <= 0)) or (rk == 'f' and (train_size <= 0 or train_size >= 1)):
        raise ValueError('train_size={0} should be either positive and smaller than the number of samples {1} or a float in the (0, 1) range'.format(train_size, n_samples))
    if tk == 'f' and rk == 'f' and train_size + test_size > 1:
        raise ValueError('The sum of test_size and train_size = {}, should be in the (0, 1) range. Reduce test_size and/or train_size.'.format(train_size + test_size))
    if tk == 'f':
        n_test = math.ceil(test_size * n_samples)
    elif tk == 'i':
        n_test = float(test_size)
    if rk == 'f':
        n_train = math.floor(train_size * n_samples)
    elif rk == 'i':
        n_train = float(train_size)
    if train_size is None:
        n_train = n_samples - n_test
    elif test_size is None:
        n_test = n_samples - n_train
    if n_train + n_test > n_samples:
        raise ValueError('The sum of train_size and test_size = %d, should be smaller than the number of samples %d. Reduce test_size and/or train_size.' % (n_train + n_test, n_samples))
    n_train, n_test = int(n_train), int(n_test)
    if n_train == 0:
        raise ValueError('With n_samples={}, test_size={} and train_size={}, the resulting train set will be empty. Adjust any of the aforementioned parameters.'.format(n_samples, test_size, train_size))
    return n_train, n_test


def _approximate_mode(class_counts, n_draws, rng):
    rng = check_random_state(rng)
    continuous = class_counts / class_counts.sum() * n_draws
    floored = np.floor(continuous)
    need_to_add = int(n_draws - floored.sum())
    if need_to_add > 0:
        remainder = continuous - floored
        values = np.sort(np.unique(remainder))[::-1]
        for value in values:
            (inds,) = np.where(remainder == value)
            add_now = min(len(inds), need_to_add)
            inds = rng.choice(inds, size=add_now, replace=False)
            floored[inds] += 1
            need_to_add -= add_now
            if need_to_add == 0:
                break
    return floored.astype(int)


# ───────────────────────── divisores ─────────────────────────

class _BaseCV:
    def get_n_splits(self, X=None, y=None, groups=None):
        return self.n_splits

    def split(self, X, y=None, groups=None):
        raise NotImplementedError

    def __repr__(self):
        return '%s(%s)' % (self.__class__.__name__, ', '.join('%s=%r' % (k, v) for k, v in self._repr_params()))

    def _repr_params(self):
        return []


class KFold(_BaseCV):
    def __init__(self, n_splits=5, *, shuffle=False, random_state=None):
        if n_splits < 2:
            raise ValueError('k-fold cross-validation requires at least one train/test split by setting n_splits=2 or more, got n_splits=%d.' % n_splits)
        self.n_splits = n_splits
        self.shuffle = shuffle
        self.random_state = random_state

    def _repr_params(self):
        return [('n_splits', self.n_splits), ('random_state', self.random_state), ('shuffle', self.shuffle)]

    def _iter_test_indices(self, X, y=None, groups=None):
        n = _num_samples(X)
        indices = np.arange(n)
        if self.shuffle:
            check_random_state(self.random_state).shuffle(indices)
        if self.n_splits > n:
            raise ValueError('Cannot have number of splits n_splits=%d greater than the number of samples: n_samples=%d.' % (self.n_splits, n))
        fold_sizes = np.full(self.n_splits, n // self.n_splits, dtype=int)
        fold_sizes[:n % self.n_splits] += 1
        current = 0
        for fs in fold_sizes:
            start, stop = current, current + fs
            yield indices[start:stop]
            current = stop

    def split(self, X, y=None, groups=None):
        n = _num_samples(X)
        indices = np.arange(n)
        for test in self._iter_test_indices(X, y, groups):
            mask = np.zeros(n, dtype=bool)
            mask[test] = True
            yield indices[~mask], indices[mask]


class StratifiedKFold(_BaseCV):
    def __init__(self, n_splits=5, *, shuffle=False, random_state=None):
        self.n_splits = n_splits
        self.shuffle = shuffle
        self.random_state = random_state

    def _repr_params(self):
        return [('n_splits', self.n_splits), ('random_state', self.random_state), ('shuffle', self.shuffle)]

    def _make_test_folds(self, X, y):
        rng = check_random_state(self.random_state)
        y = np.asarray(_to_array(y))
        _, y_idx, y_inv = np.unique(y, return_index=True, return_inverse=True)
        _, class_perm = np.unique(y_idx, return_inverse=True)
        y_encoded = class_perm[y_inv]
        n_classes = len(y_idx)
        y_counts = np.bincount(y_encoded)
        if np.all(self.n_splits > y_counts):
            raise ValueError('n_splits=%d cannot be greater than the number of members in each class.' % self.n_splits)
        y_order = np.sort(y_encoded)
        allocation = np.asarray([np.bincount(y_order[i::self.n_splits], minlength=n_classes) for i in range(self.n_splits)])
        test_folds = np.empty(len(y), dtype='i')
        for k in range(n_classes):
            folds_for_class = np.arange(self.n_splits).repeat(allocation[:, k])
            if self.shuffle:
                rng.shuffle(folds_for_class)
            test_folds[y_encoded == k] = folds_for_class
        return test_folds

    def split(self, X, y, groups=None):
        n = _num_samples(X)
        test_folds = self._make_test_folds(X, y)
        indices = np.arange(n)
        for i in range(self.n_splits):
            test = test_folds == i
            yield indices[~test], indices[test]


class ShuffleSplit(_BaseCV):
    def __init__(self, n_splits=10, *, test_size=None, train_size=None, random_state=None):
        self.n_splits = n_splits
        self.test_size = test_size
        self.train_size = train_size
        self.random_state = random_state
        self._default_test_size = 0.1

    def split(self, X, y=None, groups=None):
        n = _num_samples(X)
        n_train, n_test = _validate_shuffle_split(n, self.test_size, self.train_size, default_test_size=self._default_test_size)
        rng = check_random_state(self.random_state)
        for _ in range(self.n_splits):
            perm = rng.permutation(n)
            yield perm[n_test:(n_test + n_train)], perm[:n_test]


class StratifiedShuffleSplit(_BaseCV):
    def __init__(self, n_splits=10, *, test_size=None, train_size=None, random_state=None):
        self.n_splits = n_splits
        self.test_size = test_size
        self.train_size = train_size
        self.random_state = random_state
        self._default_test_size = 0.1

    def split(self, X, y, groups=None):
        n = _num_samples(X)
        y = np.asarray(_to_array(y))
        n_train, n_test = _validate_shuffle_split(n, self.test_size, self.train_size, default_test_size=self._default_test_size)
        classes, y_indices, class_counts = np.unique(y, return_inverse=True, return_counts=True)
        n_classes = classes.shape[0]
        if np.min(class_counts) < 2:
            raise ValueError('The least populated class in y has only 1 member, which is too few. The minimum number of groups for any class cannot be less than 2.')
        if n_train < n_classes:
            raise ValueError('The train_size = %d should be greater or equal to the number of classes = %d' % (n_train, n_classes))
        if n_test < n_classes:
            raise ValueError('The test_size = %d should be greater or equal to the number of classes = %d' % (n_test, n_classes))
        class_indices = np.split(np.argsort(y_indices, kind='stable'), np.cumsum(class_counts)[:-1])
        rng = check_random_state(self.random_state)
        for _ in range(self.n_splits):
            n_i = _approximate_mode(class_counts, n_train, rng)
            class_counts_remaining = class_counts - n_i
            t_i = _approximate_mode(class_counts_remaining, n_test, rng)
            train, test = [], []
            for i in range(n_classes):
                permutation = rng.permutation(class_counts[i])
                perm_indices_class_i = class_indices[i].take(permutation, mode='clip')
                train.extend(perm_indices_class_i[:n_i[i]])
                test.extend(perm_indices_class_i[n_i[i]:n_i[i] + t_i[i]])
            train = rng.permutation(train)
            test = rng.permutation(test)
            yield train, test


class LeaveOneOut(_BaseCV):
    def get_n_splits(self, X=None, y=None, groups=None):
        return _num_samples(X)

    def split(self, X, y=None, groups=None):
        n = _num_samples(X)
        idx = np.arange(n)
        for i in range(n):
            yield np.delete(idx, i), idx[i:i + 1]


class RepeatedKFold(_BaseCV):
    def __init__(self, *, n_splits=5, n_repeats=10, random_state=None):
        self.n_splits = n_splits
        self.n_repeats = n_repeats
        self.random_state = random_state

    def get_n_splits(self, X=None, y=None, groups=None):
        return self.n_splits * self.n_repeats

    def split(self, X, y=None, groups=None):
        rng = check_random_state(self.random_state)
        for _ in range(self.n_repeats):
            cv = KFold(self.n_splits, shuffle=True, random_state=rng)
            for tr, te in cv.split(X):
                yield tr, te


class TimeSeriesSplit(_BaseCV):
    def __init__(self, n_splits=5, *, max_train_size=None, test_size=None, gap=0):
        self.n_splits = n_splits
        self.max_train_size = max_train_size
        self.test_size = test_size
        self.gap = gap

    def split(self, X, y=None, groups=None):
        n = _num_samples(X)
        k = self.n_splits
        test_size = self.test_size if self.test_size is not None else n // (k + 1)
        starts = range(n - k * test_size, n, test_size)
        idx = np.arange(n)
        for s in starts:
            tr_end = s - self.gap
            tr = idx[:tr_end]
            if self.max_train_size and self.max_train_size < tr_end:
                tr = tr[tr_end - self.max_train_size:tr_end]
            yield tr, idx[s:s + test_size]


class GroupKFold(_BaseCV):
    def __init__(self, n_splits=5):
        self.n_splits = n_splits

    def split(self, X, y=None, groups=None):
        groups = np.asarray(groups)
        uniq, inv, counts = np.unique(groups, return_inverse=True, return_counts=True)
        order = np.argsort(counts)[::-1]
        loads = np.zeros(self.n_splits)
        assign = np.zeros(len(uniq), dtype=int)
        for g in order:
            f = int(np.argmin(loads))
            assign[g] = f
            loads[f] += counts[g]
        fold_of = assign[inv]
        idx = np.arange(len(groups))
        for f in range(self.n_splits):
            yield idx[fold_of != f], idx[fold_of == f]


# ───────────────────────── train_test_split ─────────────────────────

def train_test_split(*arrays, test_size=None, train_size=None, random_state=None, shuffle=True, stratify=None):
    if not arrays:
        raise ValueError('At least one array required as input')
    n = _num_samples(arrays[0])
    for a in arrays:
        if _num_samples(a) != n:
            raise ValueError('Found input variables with inconsistent numbers of samples: %r' % [_num_samples(x) for x in arrays])
    n_train, n_test = _validate_shuffle_split(n, test_size, train_size, default_test_size=0.25)
    if shuffle is False:
        if stratify is not None:
            raise ValueError('Stratified train/test split is not implemented for shuffle=False')
        train = np.arange(n_train)
        test = np.arange(n_train, n_train + n_test)
    elif stratify is not None:
        cv = StratifiedShuffleSplit(test_size=n_test, train_size=n_train, random_state=random_state)
        train, test = next(cv.split(np.zeros(n), stratify))
    else:
        cv = ShuffleSplit(test_size=n_test, train_size=n_train, random_state=random_state)
        train, test = next(cv.split(np.zeros(n)))
    out = []
    for a in arrays:
        out.append(_safe_indexing(a, train))
        out.append(_safe_indexing(a, test))
    return out


# ───────────────────────── validación cruzada y búsquedas ─────────────────────────

import time
import warnings
from itertools import product as _product

from sklearn.utils import sample_without_replacement, type_of_target, Bunch
from sklearn.utils.metaestimators import available_if
from sklearn.exceptions import FitFailedWarning, NotFittedError


class _CVIterableWrapper:
    def __init__(self, cv):
        self.cv = list(cv)

    def get_n_splits(self, X=None, y=None, groups=None):
        return len(self.cv)

    def split(self, X=None, y=None, groups=None):
        for train, test in self.cv:
            yield train, test


def check_cv(cv=5, y=None, *, classifier=False):
    cv = 5 if cv is None else cv
    if isinstance(cv, numbers.Integral):
        if classifier and y is not None and type_of_target(y) in ('binary', 'multiclass'):
            return StratifiedKFold(cv)
        return KFold(cv)
    if not hasattr(cv, 'split') or isinstance(cv, str):
        if isinstance(cv, str) or not hasattr(cv, '__iter__'):
            raise ValueError('Expected cv as an integer, cross-validation object (from sklearn.model_selection) or an iterable. Got %s.' % cv)
        return _CVIterableWrapper(cv)
    return cv


class ParameterGrid:
    def __init__(self, param_grid):
        if isinstance(param_grid, dict):
            param_grid = [param_grid]
        for grid in param_grid:
            if not isinstance(grid, dict):
                raise TypeError('Parameter grid is not a dict (%r)' % (grid,))
            for key, value in grid.items():
                if isinstance(value, str) or not hasattr(value, '__len__'):
                    raise TypeError("Parameter grid for parameter %r needs to be a list or a numpy array, but got %r (of type %s) instead. Single values need to be wrapped in a list with one element." % (key, value, type(value).__name__))
                if len(value) == 0:
                    raise ValueError('Parameter grid for parameter %r need to be a non-empty sequence, got: %r' % (key, value))
        self.param_grid = param_grid

    def __iter__(self):
        for p in self.param_grid:
            items = sorted(p.items())
            if not items:
                yield {}
            else:
                keys = [k for k, _ in items]
                values = [v for _, v in items]
                for v in _product(*values):
                    yield dict(zip(keys, v))

    def __len__(self):
        total = 0
        for p in self.param_grid:
            n = 1
            for v in p.values():
                n *= len(v)
            total += n if p else 1
        return total

    def __getitem__(self, ind):
        for sub_grid in self.param_grid:
            if not sub_grid:
                if ind == 0:
                    return {}
                ind -= 1
                continue
            items = sorted(sub_grid.items())[::-1]
            keys = [k for k, _ in items]
            values_lists = [v for _, v in items]
            sizes = [len(v) for v in values_lists]
            total = 1
            for n in sizes:
                total *= n
            if ind >= total:
                ind -= total
            else:
                out = {}
                for key, v_list, n in zip(keys, values_lists, sizes):
                    ind, offset = divmod(ind, n)
                    out[key] = v_list[offset]
                return out
        raise IndexError('ParameterGrid index out of range')


class ParameterSampler:
    def __init__(self, param_distributions, n_iter, *, random_state=None):
        if not isinstance(param_distributions, (dict, list)):
            raise TypeError('Parameter distribution is not a dict or a list, got: %r of type %s' % (param_distributions, type(param_distributions).__name__))
        if isinstance(param_distributions, dict):
            param_distributions = [param_distributions]
        self.n_iter = n_iter
        self.random_state = random_state
        self.param_distributions = param_distributions

    def _is_all_lists(self):
        return all(all(not hasattr(v, 'rvs') for v in dist.values()) for dist in self.param_distributions)

    def __iter__(self):
        rng = check_random_state(self.random_state)
        if self._is_all_lists():
            param_grid = ParameterGrid(self.param_distributions)
            grid_size = len(param_grid)
            n_iter = self.n_iter
            if grid_size < n_iter:
                warnings.warn('The total space of parameters %d is smaller than n_iter=%d. Running %d iterations. For exhaustive searches, use GridSearchCV.' % (grid_size, self.n_iter, grid_size), UserWarning)
                n_iter = grid_size
            for i in sample_without_replacement(grid_size, n_iter, random_state=rng):
                yield param_grid[int(i)]
        else:
            for _ in range(self.n_iter):
                dist = self.param_distributions[int(rng.randint(len(self.param_distributions)))]
                items = sorted(dist.items())
                params = dict()
                for k, v in items:
                    if hasattr(v, 'rvs'):
                        params[k] = v.rvs(random_state=rng)
                    else:
                        params[k] = v[int(rng.randint(len(v)))]
                yield params

    def __len__(self):
        if self._is_all_lists():
            return min(self.n_iter, len(ParameterGrid(self.param_distributions)))
        return self.n_iter


def _check_scoring(estimator, scoring):
    """Devuelve (puntuadores como dict nombre→función, multimétrica)."""
    from sklearn.metrics import get_scorer

    def one(s):
        if s is None:
            if not hasattr(estimator, 'score'):
                raise TypeError("If no scoring is specified, the estimator passed should have a 'score' method. The estimator %r does not." % estimator)
            return lambda est, X, y: est.score(X, y)
        if isinstance(s, str):
            return get_scorer(s)
        if callable(s):
            return s
        raise ValueError('scoring value should be a callable, string or None')

    if scoring is None or isinstance(scoring, str) or callable(scoring):
        return {'score': one(scoring)}, False
    if isinstance(scoring, dict):
        return {k: one(v) for k, v in scoring.items()}, True
    names = list(scoring)
    if len(set(names)) != len(names):
        raise ValueError('Duplicate elements were found in the given list. %r' % (names,))
    return {n: one(n) for n in names}, True


def check_scoring(estimator, scoring=None):
    sc, multi = _check_scoring(estimator, scoring)
    return sc['score']


def _index(X, idx):
    if X is None:
        return None
    return _safe_indexing(X, idx)


def _fit_and_score(estimator, X, y, scorers, train, test, parameters=None, fit_params=None, return_train_score=False, error_score=np.nan):
    est = clone(estimator)
    if parameters:
        est.set_params(**clone(parameters, safe=False))
    X_train, y_train = _index(X, train), _index(y, train)
    X_test, y_test = _index(X, test), _index(y, test)
    failed = None
    t0 = time.time()
    try:
        if y_train is None:
            est.fit(X_train, **(fit_params or {}))
        else:
            est.fit(X_train, y_train, **(fit_params or {}))
    except Exception as e:
        if isinstance(error_score, str) and error_score == 'raise':
            raise
        failed = e
    fit_time = time.time() - t0
    out = {'fit_time': fit_time, 'estimator': est}
    if failed is not None:
        out['test'] = {k: error_score for k in scorers}
        out['train'] = {k: error_score for k in scorers} if return_train_score else None
        out['score_time'] = 0.0
        out['error'] = '%s: %s' % (type(failed).__name__, failed)
        return out
    t1 = time.time()
    out['test'] = {k: float(sc(est, X_test, y_test)) for k, sc in scorers.items()}
    out['score_time'] = time.time() - t1
    out['train'] = {k: float(sc(est, X_train, y_train)) for k, sc in scorers.items()} if return_train_score else None
    return out


def _warn_failures(results):
    errs = [r['error'] for r in results if 'error' in r]
    if not errs:
        return
    n = len(results)
    if len(errs) == n:
        raise ValueError('\nAll the %d fits failed.\nIt is very likely that your model is misconfigured.\nYou can try to debug the error by setting error_score=\'raise\'.\n\nBelow are more details about the failures:\n%s' % (n, '--------------------------------------------------------------------------------\n%d fits failed with the following error:\n%s' % (len(errs), errs[0])))
    warnings.warn('\n%d fits failed out of a total of %d.\nThe score on these train-test partitions for these parameters will be set to nan.\nIf these failures are not expected, you can try to debug them by setting error_score=\'raise\'.\n\nBelow are more details about the failures:\n%s' % (len(errs), n, '--------------------------------------------------------------------------------\n%d fits failed with the following error:\n%s' % (len(errs), errs[0])), FitFailedWarning)


def cross_validate(estimator, X, y=None, *, groups=None, scoring=None, cv=None, n_jobs=None, verbose=0, params=None, pre_dispatch='2*n_jobs', return_train_score=False, return_estimator=False, return_indices=False, error_score=np.nan):
    cv = check_cv(cv, y, classifier=is_classifier(estimator))
    scorers, multi = _check_scoring(estimator, scoring)
    splits = list(cv.split(X, y, groups))
    results = [_fit_and_score(estimator, X, y, scorers, tr, te, None, params, return_train_score, error_score) for tr, te in splits]
    _warn_failures(results)
    ret = {'fit_time': np.array([r['fit_time'] for r in results]), 'score_time': np.array([r['score_time'] for r in results])}
    if return_estimator:
        ret['estimator'] = [r['estimator'] for r in results]
    if return_indices:
        ret['indices'] = {'train': tuple(tr for tr, _ in splits), 'test': tuple(te for _, te in splits)}
    for name in scorers:
        ret['test_%s' % name] = np.array([r['test'][name] for r in results])
        if return_train_score:
            ret['train_%s' % name] = np.array([r['train'][name] for r in results])
    return ret


def cross_val_score(estimator, X, y=None, *, groups=None, scoring=None, cv=None, n_jobs=None, verbose=0, params=None, pre_dispatch='2*n_jobs', error_score=np.nan):
    scorer = check_scoring(estimator, scoring=scoring)
    res = cross_validate(estimator, X, y, groups=groups, scoring={'score': scorer}, cv=cv, params=params, error_score=error_score)
    return res['test_score']


def cross_val_predict(estimator, X, y=None, *, groups=None, cv=None, n_jobs=None, verbose=0, params=None, pre_dispatch='2*n_jobs', method='predict'):
    cv = check_cv(cv, y, classifier=is_classifier(estimator))
    splits = list(cv.split(X, y, groups))
    test_indices = np.concatenate([te for _, te in splits])
    if len(test_indices) != _num_samples(X) or len(np.unique(test_indices)) != len(test_indices):
        raise ValueError('cross_val_predict only works for partitions')
    preds = []
    n_classes = len(np.unique(np.asarray(_to_array(y)))) if y is not None and is_classifier(estimator) else None
    for tr, te in splits:
        est = clone(estimator)
        est.fit(_index(X, tr), _index(y, tr), **(params or {}))
        p = getattr(est, method)(_index(X, te))
        if method in ('predict_proba', 'predict_log_proba', 'decision_function') and n_classes is not None and p.ndim == 2 and p.shape[1] != n_classes:
            full = np.full((p.shape[0], n_classes), 0.0 if method == 'predict_proba' else -np.inf if method == 'predict_log_proba' else -np.inf)
            cls_all = np.unique(np.asarray(_to_array(y)))
            for j, c in enumerate(est.classes_):
                full[:, int(np.searchsorted(cls_all, c))] = p[:, j]
            p = full
        preds.append(p)
    predictions = np.concatenate(preds)
    inv = np.empty(len(test_indices), dtype=int)
    inv[test_indices] = np.arange(len(test_indices))
    return predictions[inv]


def _translate_train_sizes(train_sizes, n_max_training_samples):
    train_sizes_abs = np.asarray(train_sizes)
    n_ticks = train_sizes_abs.shape[0]
    n_min = np.min(train_sizes_abs)
    n_max = np.max(train_sizes_abs)
    if train_sizes_abs.dtype.kind == 'f':
        if n_min <= 0.0 or n_max > 1.0:
            raise ValueError('train_sizes has been interpreted as fractions of the maximum number of training samples and must be within (0, 1], but is within [%f, %f].' % (n_min, n_max))
        train_sizes_abs = (train_sizes_abs * n_max_training_samples).astype(int)
        train_sizes_abs = np.clip(train_sizes_abs, 1, n_max_training_samples)
    else:
        if n_min <= 0 or n_max > n_max_training_samples:
            raise ValueError('train_sizes has been interpreted as absolute numbers of training samples and must be within (0, %d], but is within [%d, %d].' % (n_max_training_samples, n_min, n_max))
    train_sizes_abs = np.unique(train_sizes_abs)
    if n_ticks > train_sizes_abs.shape[0]:
        warnings.warn("Removed duplicate entries from 'train_sizes'. Number of ticks will be less than the size of 'train_sizes': %d instead of %d." % (train_sizes_abs.shape[0], n_ticks), RuntimeWarning)
    return train_sizes_abs


def learning_curve(estimator, X, y, *, groups=None, train_sizes=np.linspace(0.1, 1.0, 5), cv=None, scoring=None, exploit_incremental_learning=False, n_jobs=None, pre_dispatch='all', verbose=0, shuffle=False, random_state=None, error_score=np.nan, return_times=False, params=None):
    cv = check_cv(cv, y, classifier=is_classifier(estimator))
    cv_iter = list(cv.split(X, y, groups))
    scorers, _ = _check_scoring(estimator, scoring)
    scorer = list(scorers.values())[0]
    n_max = len(cv_iter[0][0])
    sizes = _translate_train_sizes(train_sizes, n_max)
    if shuffle:
        rng = check_random_state(random_state)
        cv_iter = [(rng.permutation(tr), te) for tr, te in cv_iter]
    tr_s, te_s, ft, st = [], [], [], []
    for n_train in sizes:
        a, b, c, d = [], [], [], []
        for tr, te in cv_iter:
            r = _fit_and_score(estimator, X, y, {'score': scorer}, tr[:n_train], te, None, params, True, error_score)
            a.append(r['train']['score'])
            b.append(r['test']['score'])
            c.append(r['fit_time'])
            d.append(r['score_time'])
        tr_s.append(a)
        te_s.append(b)
        ft.append(c)
        st.append(d)
    out = (sizes, np.array(tr_s), np.array(te_s))
    if return_times:
        return out + (np.array(ft), np.array(st))
    return out


def validation_curve(estimator, X, y, *, param_name, param_range, groups=None, cv=None, scoring=None, n_jobs=None, pre_dispatch='all', verbose=0, error_score=np.nan, params=None):
    cv = check_cv(cv, y, classifier=is_classifier(estimator))
    scorers, _ = _check_scoring(estimator, scoring)
    scorer = list(scorers.values())[0]
    splits = list(cv.split(X, y, groups))
    tr_s, te_s = [], []
    for v in param_range:
        a, b = [], []
        for tr, te in splits:
            r = _fit_and_score(estimator, X, y, {'score': scorer}, tr, te, {param_name: v}, params, True, error_score)
            a.append(r['train']['score'])
            b.append(r['test']['score'])
        tr_s.append(a)
        te_s.append(b)
    return np.array(tr_s), np.array(te_s)


def permutation_test_score(estimator, X, y, *, groups=None, cv=None, n_permutations=100, n_jobs=None, random_state=0, verbose=0, scoring=None, params=None):
    cv = check_cv(cv, y, classifier=is_classifier(estimator))
    scorers, _ = _check_scoring(estimator, scoring)
    scorer = list(scorers.values())[0]
    rng = check_random_state(random_state)

    def run(yy):
        sc = [_fit_and_score(estimator, X, yy, {'score': scorer}, tr, te)['test']['score'] for tr, te in cv.split(X, yy, groups)]
        return float(np.mean(sc))
    score = run(y)
    perm = np.array([run(rng.permutation(np.asarray(_to_array(y)))) for _ in range(n_permutations)])
    pvalue = (np.sum(perm >= score) + 1.0) / (n_permutations + 1)
    return score, perm, pvalue


def _rank_min(neg_means):
    n = len(neg_means)
    order = np.argsort(neg_means, kind='stable')
    ranks = np.empty(n, dtype=np.int32)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and neg_means[order[j + 1]] == neg_means[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = i + 1
        i = j + 1
    return ranks


def _estimator_has(attr):
    def check(self):
        if hasattr(self, 'best_estimator_'):
            return hasattr(self.best_estimator_, attr)
        return hasattr(self.estimator, attr)
    return check


class BaseSearchCV(BaseEstimator):
    def __init__(self, estimator, *, scoring=None, n_jobs=None, refit=True, cv=None, verbose=0, pre_dispatch='2*n_jobs', error_score=np.nan, return_train_score=True):
        self.scoring = scoring
        self.estimator = estimator
        self.n_jobs = n_jobs
        self.refit = refit
        self.cv = cv
        self.verbose = verbose
        self.pre_dispatch = pre_dispatch
        self.error_score = error_score
        self.return_train_score = return_train_score

    @property
    def _estimator_type(self):
        return getattr(self.estimator, '_estimator_type', None)

    @property
    def classes_(self):
        return self.best_estimator_.classes_

    @property
    def n_features_in_(self):
        return self.best_estimator_.n_features_in_

    @property
    def feature_names_in_(self):
        return self.best_estimator_.feature_names_in_

    def __sklearn_is_fitted__(self):
        return hasattr(self, 'cv_results_')

    def _check_refit(self, scorers, multi):
        refit = self.refit
        if multi:
            if refit is False:
                return None
            if callable(refit):
                return refit
            if not isinstance(refit, str) or refit not in scorers:
                raise ValueError('For multi-metric scoring, the parameter refit must be set to a scorer key or a callable to refit an estimator with the best parameter setting on the whole data and make the best_* attributes available for that metric. If this is not needed, refit should be set to False explicitly. %r was passed.' % (refit,))
            return refit
        return 'score'

    def fit(self, X, y=None, **params):
        estimator = self.estimator
        scorers, multi = _check_scoring(estimator, self.scoring)
        refit_metric = self._check_refit(scorers, multi)
        cv = check_cv(self.cv, y, classifier=is_classifier(estimator))
        n_splits = cv.get_n_splits(X, y)
        splits = list(cv.split(X, y))
        candidate_params = list(self._candidates())
        n_candidates = len(candidate_params)
        if self.verbose > 0:
            print('Fitting %d folds for each of %d candidates, totalling %d fits' % (n_splits, n_candidates, n_splits * n_candidates))
        flat = []
        for cand in candidate_params:
            for tr, te in splits:
                flat.append(_fit_and_score(estimator, X, y, scorers, tr, te, cand, params, self.return_train_score, self.error_score))
        _warn_failures(flat)
        results = {}

        def store(key, arr, splits_=False, rank=False):
            a = np.array(arr, dtype=np.float64).reshape(n_candidates, n_splits)
            if splits_:
                for s in range(n_splits):
                    results['split%d_%s' % (s, key)] = a[:, s]
            means = a.mean(axis=1)
            results['mean_%s' % key] = means
            if (key.startswith('train_') or key.startswith('test_')) and not np.all(np.isfinite(means)):
                warnings.warn('One or more of the %s scores are non-finite: %s' % (key.split('_')[0], means), UserWarning)
            results['std_%s' % key] = np.sqrt(((a - means[:, None]) ** 2).mean(axis=1))
            if rank:
                if np.isnan(means).all():
                    results['rank_%s' % key] = np.ones(len(means), dtype=np.int32)
                else:
                    filled = np.where(np.isnan(means), np.nanmin(means) - 1, means)
                    results['rank_%s' % key] = _rank_min(-filled)
        store('fit_time', [r['fit_time'] for r in flat])
        store('score_time', [r['score_time'] for r in flat])
        names = []
        for cand in candidate_params:
            for k in cand:
                if k not in names:
                    names.append(k)
        for k in names:
            vals = [cand.get(k) for cand in candidate_params]
            try:
                results['param_%s' % k] = np.array(vals)
            except Exception:
                results['param_%s' % k] = vals
        results['params'] = candidate_params
        for sname in scorers:
            store('test_%s' % sname, [r['test'][sname] for r in flat], splits_=True, rank=True)
            if self.return_train_score:
                store('train_%s' % sname, [r['train'][sname] for r in flat], splits_=True)
        self.cv_results_ = results
        self.n_splits_ = n_splits
        self.multimetric_ = multi
        self.scorer_ = scorers if multi else scorers['score']
        if refit_metric is not None or not multi:
            if callable(refit_metric):
                self.best_index_ = int(refit_metric(results))
            else:
                self.best_index_ = int(np.argmin(results['rank_test_%s' % refit_metric]))
            if not callable(self.refit):
                self.best_score_ = float(results['mean_test_%s' % refit_metric][self.best_index_])
            self.best_params_ = candidate_params[self.best_index_]
        if self.refit is not False and (self.refit or not multi):
            self.best_estimator_ = clone(estimator).set_params(**clone(self.best_params_, safe=False))
            t0 = time.time()
            if y is not None:
                self.best_estimator_.fit(X, y, **params)
            else:
                self.best_estimator_.fit(X, **params)
            self.refit_time_ = time.time() - t0
        return self

    @available_if(_estimator_has('score'))
    def score(self, X, y=None, **params):
        if not hasattr(self, 'best_estimator_'):
            raise NotFittedError('This %s instance was initialized with refit=False. score is available only after refitting on the best parameters. You can refit an estimator manually using the ``best_params_`` attribute' % type(self).__name__)
        if self.scorer_ is None:
            raise ValueError('No score function explicitly defined, and the estimator doesn\'t provide one %s' % self.best_estimator_)
        if isinstance(self.scorer_, dict):
            if self.multimetric_:
                scorer = self.scorer_[self.refit]
            else:
                scorer = self.scorer_
        else:
            scorer = self.scorer_
        return scorer(self.best_estimator_, X, y)

    def _delegate(self, name, X):
        if not hasattr(self, 'best_estimator_'):
            raise NotFittedError('This %s instance was initialized with refit=False. %s is available only after refitting on the best parameters. You can refit an estimator manually using the ``best_params_`` attribute' % (type(self).__name__, name))
        return getattr(self.best_estimator_, name)(X)

    @available_if(_estimator_has('predict'))
    def predict(self, X):
        return self._delegate('predict', X)

    @available_if(_estimator_has('predict_proba'))
    def predict_proba(self, X):
        return self._delegate('predict_proba', X)

    @available_if(_estimator_has('predict_log_proba'))
    def predict_log_proba(self, X):
        return self._delegate('predict_log_proba', X)

    @available_if(_estimator_has('decision_function'))
    def decision_function(self, X):
        return self._delegate('decision_function', X)

    @available_if(_estimator_has('transform'))
    def transform(self, X):
        return self._delegate('transform', X)

    @available_if(_estimator_has('inverse_transform'))
    def inverse_transform(self, X):
        return self._delegate('inverse_transform', X)

    @available_if(_estimator_has('score_samples'))
    def score_samples(self, X):
        return self._delegate('score_samples', X)


class GridSearchCV(BaseSearchCV):
    def __init__(self, estimator, param_grid, *, scoring=None, n_jobs=None, refit=True, cv=None, verbose=0, pre_dispatch='2*n_jobs', error_score=np.nan, return_train_score=False):
        BaseSearchCV.__init__(self, estimator=estimator, scoring=scoring, n_jobs=n_jobs, refit=refit, cv=cv, verbose=verbose, pre_dispatch=pre_dispatch, error_score=error_score, return_train_score=return_train_score)
        self.param_grid = param_grid

    def _candidates(self):
        return ParameterGrid(self.param_grid)


class RandomizedSearchCV(BaseSearchCV):
    def __init__(self, estimator, param_distributions, *, n_iter=10, scoring=None, n_jobs=None, refit=True, cv=None, verbose=0, pre_dispatch='2*n_jobs', random_state=None, error_score=np.nan, return_train_score=False):
        BaseSearchCV.__init__(self, estimator=estimator, scoring=scoring, n_jobs=n_jobs, refit=refit, cv=cv, verbose=verbose, pre_dispatch=pre_dispatch, error_score=error_score, return_train_score=return_train_score)
        self.param_distributions = param_distributions
        self.n_iter = n_iter
        self.random_state = random_state

    def _candidates(self):
        return ParameterSampler(self.param_distributions, self.n_iter, random_state=self.random_state)
