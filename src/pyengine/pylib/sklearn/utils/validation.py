from sklearn.utils import check_array, check_X_y, check_random_state, column_or_1d, _num_samples
from sklearn.base import check_is_fitted


def check_consistent_length(*arrays):
    lengths = {_num_samples(a) for a in arrays if a is not None}
    if len(lengths) > 1:
        raise ValueError('Found input variables with inconsistent numbers of samples: %r' % [_num_samples(a) for a in arrays if a is not None])
