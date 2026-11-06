from types import MethodType

from sklearn.base import BaseEstimator


class _AvailableIfDescriptor:
    def __init__(self, fn, check, attribute_name):
        self.fn = fn
        self.check = check
        self.attribute_name = attribute_name
        self.__doc__ = getattr(fn, '__doc__', None)

    def __get__(self, obj, owner=None):
        if obj is not None:
            if not self.check(obj):
                raise AttributeError("This %r has no attribute %r" % (type(obj).__name__, self.attribute_name))
            return MethodType(self.fn, obj)
        return self.fn


def available_if(check):
    return lambda fn: _AvailableIfDescriptor(fn, check, attribute_name=fn.__name__)


class _BaseComposition(BaseEstimator):
    def _get_params(self, attr, deep=True):
        out = BaseEstimator.get_params(self, deep=False)
        if not deep:
            return out
        estimators = getattr(self, attr)
        try:
            out.update(estimators)
        except (TypeError, ValueError):
            return out
        for name, estimator in estimators:
            if hasattr(estimator, 'get_params'):
                for key, value in estimator.get_params(deep=True).items():
                    out['%s__%s' % (name, key)] = value
        return out

    def _set_params(self, attr, **params):
        if attr in params:
            setattr(self, attr, params.pop(attr))
        items = getattr(self, attr)
        if isinstance(items, list) and items:
            item_names = [n for n, _ in items]
            for name in list(params.keys()):
                if '__' not in name and name in item_names:
                    self._replace_estimator(attr, name, params.pop(name))
        BaseEstimator.set_params(self, **params)
        return self

    def _replace_estimator(self, attr, name, new_val):
        new_estimators = list(getattr(self, attr))
        for i, (estimator_name, _) in enumerate(new_estimators):
            if estimator_name == name:
                new_estimators[i] = (name, new_val)
                break
        setattr(self, attr, new_estimators)

    def _validate_names(self, names):
        if len(set(names)) != len(names):
            raise ValueError('Names provided are not unique: %r' % (list(names),))
        invalid_names = set(names).intersection(self.get_params(deep=False))
        if invalid_names:
            raise ValueError('Estimator names conflict with constructor arguments: %r' % sorted(invalid_names))
        invalid_names = [name for name in names if '__' in name]
        if invalid_names:
            raise ValueError('Estimator names must not contain __: got %r' % invalid_names)
