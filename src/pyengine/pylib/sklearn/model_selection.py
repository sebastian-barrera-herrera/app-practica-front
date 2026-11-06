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
