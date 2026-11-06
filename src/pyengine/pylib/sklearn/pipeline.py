import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, clone
from sklearn.utils import Bunch
from sklearn.utils.metaestimators import _BaseComposition, available_if


def _is_pass(t):
    return t is None or (isinstance(t, str) and t == 'passthrough')


def _name_estimators(estimators):
    names = [type(estimator).__name__.lower() for estimator in estimators]
    namecount = {}
    for name in names:
        namecount[name] = namecount.get(name, 0) + 1
    for k in list(namecount):
        if namecount[k] == 1:
            del namecount[k]
    for i in reversed(range(len(estimators))):
        name = names[i]
        if name in namecount:
            names[i] += '-%d' % namecount[name]
            namecount[name] -= 1
    return list(zip(names, estimators))


def _final_has(attr):
    def check(self):
        last = self.steps[-1][1]
        if _is_pass(last):
            return True
        return hasattr(last, attr)
    return check


def _can_transform(self):
    last = self.steps[-1][1]
    return _is_pass(last) or hasattr(last, 'transform')


def _can_inverse_transform(self):
    return all(hasattr(t, 'inverse_transform') for _, _, t in self._iter())


def _fit_transform_one(transformer, X, y, params):
    if hasattr(transformer, 'fit_transform'):
        res = transformer.fit_transform(X, y, **params.get('fit_transform', {}))
    else:
        res = transformer.fit(X, y, **params.get('fit', {})).transform(X, **params.get('transform', {}))
    return res, transformer


class Pipeline(_BaseComposition):
    def __init__(self, steps, *, transform_input=None, memory=None, verbose=False):
        self.steps = steps
        self.transform_input = transform_input
        self.memory = memory
        self.verbose = verbose

    def set_output(self, *, transform=None):
        for _, _, step in self._iter():
            step.set_output(transform=transform)
        return self

    def get_params(self, deep=True):
        return self._get_params('steps', deep=deep)

    def set_params(self, **kwargs):
        self._set_params('steps', **kwargs)
        return self

    def _validate_steps(self):
        if not self.steps:
            raise ValueError("The first argument to Pipeline must be a list of (name, estimator) tuples")
        names, estimators = zip(*self.steps)
        self._validate_names(names)
        transformers = estimators[:-1]
        estimator = estimators[-1]
        for t in transformers:
            if _is_pass(t):
                continue
            if not (hasattr(t, 'fit') or hasattr(t, 'fit_transform')) or not hasattr(t, 'transform'):
                raise TypeError("All intermediate steps should be transformers and implement fit and transform or be the string 'passthrough' '%s' (type %s) doesn't" % (t, type(t)))
        if not _is_pass(estimator) and not hasattr(estimator, 'fit'):
            raise TypeError("Last step of Pipeline should implement fit or be the string 'passthrough'. '%s' (type %s) doesn't" % (estimator, type(estimator)))

    def _iter(self, with_final=True, filter_passthrough=True):
        stop = len(self.steps)
        if not with_final:
            stop -= 1
        for idx, (name, trans) in enumerate(self.steps[:stop]):
            if not filter_passthrough:
                yield idx, name, trans
            elif not _is_pass(trans):
                yield idx, name, trans

    def __len__(self):
        return len(self.steps)

    def __getitem__(self, ind):
        if isinstance(ind, slice):
            if ind.step not in (1, None):
                raise ValueError('Pipeline slicing only supports a step of 1')
            return self.__class__(self.steps[ind], memory=self.memory, verbose=self.verbose)
        try:
            name, est = self.steps[ind]
        except TypeError:
            return self.named_steps[ind]
        return est

    @property
    def _estimator_type(self):
        return getattr(self.steps[-1][1], '_estimator_type', None)

    @property
    def named_steps(self):
        return Bunch(**dict(self.steps))

    @property
    def _final_estimator(self):
        estimator = self.steps[-1][1]
        return 'passthrough' if estimator is None else estimator

    def _check_method_params(self, method, props):
        out = {name: {'fit': {}, 'fit_transform': {}, 'transform': {}, 'predict': {}, 'score': {}} for name, _ in self.steps}
        for pname, pval in props.items():
            if '__' not in pname:
                raise ValueError("Pipeline.%s does not accept the %s parameter. You can pass parameters to specific steps of your pipeline using the stepname__parameter format, e.g. `Pipeline.fit(X, y, logisticregression__sample_weight=sample_weight)`." % (method, pname))
            step, param = pname.split('__', 1)
            if step not in out:
                raise ValueError("Pipeline.%s: no hay ningún paso llamado %r" % (method, step))
            out[step]['fit'][param] = pval
            out[step]['fit_transform'][param] = pval
            out[step]['transform'][param] = pval
            out[step]['predict'][param] = pval
            out[step]['score'][param] = pval
        return out

    def _fit(self, X, y=None, routed=None):
        self.steps = list(self.steps)
        self._validate_steps()
        for step_idx, name, transformer in self._iter(with_final=False, filter_passthrough=False):
            if _is_pass(transformer):
                continue
            X, fitted = _fit_transform_one(transformer, X, y, routed[name])
            self.steps[step_idx] = (name, fitted)
        return X

    def fit(self, X, y=None, **params):
        routed = self._check_method_params('fit', params)
        Xt = self._fit(X, y, routed)
        last = self._final_estimator
        if not _is_pass(last):
            last.fit(Xt, y, **routed[self.steps[-1][0]]['fit'])
        return self

    def _call_final(self, name):
        return getattr(self._final_estimator, name)

    def _transform_through(self, X, params=None, routed_key='predict'):
        Xt = X
        routed = params
        for _, name, transform in self._iter(with_final=False):
            Xt = transform.transform(Xt)
        return Xt

    @available_if(lambda self: _final_has('fit_transform')(self) or _can_transform(self))
    def fit_transform(self, X, y=None, **params):
        routed = self._check_method_params('fit_transform', params)
        Xt = self._fit(X, y, routed)
        last = self._final_estimator
        if _is_pass(last):
            return Xt
        p = routed[self.steps[-1][0]]
        if hasattr(last, 'fit_transform'):
            return last.fit_transform(Xt, y, **p['fit_transform'])
        return last.fit(Xt, y, **p['fit']).transform(Xt)

    @available_if(_final_has('predict'))
    def predict(self, X, **params):
        Xt = self._transform_through(X)
        return self.steps[-1][1].predict(Xt, **{k.split('__', 1)[1]: v for k, v in params.items() if k.startswith(self.steps[-1][0] + '__')})

    @available_if(_final_has('fit_predict'))
    def fit_predict(self, X, y=None, **params):
        routed = self._check_method_params('fit_predict', params)
        Xt = self._fit(X, y, routed)
        return self.steps[-1][1].fit_predict(Xt, y, **routed[self.steps[-1][0]]['fit'])

    @available_if(_final_has('predict_proba'))
    def predict_proba(self, X, **params):
        return self.steps[-1][1].predict_proba(self._transform_through(X))

    @available_if(_final_has('decision_function'))
    def decision_function(self, X, **params):
        return self.steps[-1][1].decision_function(self._transform_through(X))

    @available_if(_final_has('score_samples'))
    def score_samples(self, X):
        return self.steps[-1][1].score_samples(self._transform_through(X))

    @available_if(_final_has('predict_log_proba'))
    def predict_log_proba(self, X, **params):
        return self.steps[-1][1].predict_log_proba(self._transform_through(X))

    @available_if(_can_transform)
    def transform(self, X, **params):
        Xt = X
        for _, _, transform in self._iter():
            Xt = transform.transform(Xt)
        return Xt

    @available_if(_can_inverse_transform)
    def inverse_transform(self, X, **params):
        Xt = X
        for _, _, transform in reversed(list(self._iter())):
            Xt = transform.inverse_transform(Xt)
        return Xt

    @available_if(_final_has('score'))
    def score(self, X, y=None, sample_weight=None, **params):
        Xt = self._transform_through(X)
        kw = {}
        if sample_weight is not None:
            kw['sample_weight'] = sample_weight
        return self.steps[-1][1].score(Xt, y, **kw)

    @property
    def classes_(self):
        return self.steps[-1][1].classes_

    @property
    def n_features_in_(self):
        return self.steps[0][1].n_features_in_

    @property
    def feature_names_in_(self):
        return self.steps[0][1].feature_names_in_

    def get_feature_names_out(self, input_features=None):
        feature_names_out = input_features
        for _, name, transform in self._iter():
            if not hasattr(transform, 'get_feature_names_out'):
                raise AttributeError('Estimator %s does not provide get_feature_names_out. Did you mean to call pipeline[:-1].get_feature_names_out()?' % name)
            feature_names_out = transform.get_feature_names_out(feature_names_out)
        return feature_names_out

    def __sklearn_is_fitted__(self):
        from sklearn.base import check_is_fitted
        last = self.steps[-1][1]
        if _is_pass(last):
            return True
        check_is_fitted(last)
        return True


def make_pipeline(*steps, memory=None, transform_input=None, verbose=False):
    return Pipeline(_name_estimators(steps), memory=memory, transform_input=transform_input, verbose=verbose)


class FeatureUnion(TransformerMixin, _BaseComposition):
    def __init__(self, transformer_list, *, n_jobs=None, transformer_weights=None, verbose=False, verbose_feature_names_out=True):
        self.transformer_list = transformer_list
        self.n_jobs = n_jobs
        self.transformer_weights = transformer_weights
        self.verbose = verbose
        self.verbose_feature_names_out = verbose_feature_names_out

    @property
    def named_transformers(self):
        return Bunch(**dict(self.transformer_list))

    def get_params(self, deep=True):
        return self._get_params('transformer_list', deep=deep)

    def set_params(self, **kwargs):
        self._set_params('transformer_list', **kwargs)
        return self

    def _iter(self):
        get_weight = (self.transformer_weights or {}).get
        for name, trans in self.transformer_list:
            if trans == 'drop':
                continue
            if _is_pass(trans):
                from sklearn.preprocessing import FunctionTransformer
                trans = FunctionTransformer(feature_names_out='one-to-one')
            yield name, trans, get_weight(name)

    def get_feature_names_out(self, input_features=None):
        names = []
        for name, trans, _ in self._iter():
            if not hasattr(trans, 'get_feature_names_out'):
                raise AttributeError('Transformer %s (type %s) does not provide get_feature_names_out.' % (name, type(trans).__name__))
            for f in trans.get_feature_names_out(input_features):
                names.append(('%s__%s' % (name, f)) if self.verbose_feature_names_out else f)
        return np.asarray(names)

    def fit(self, X, y=None, **fit_params):
        for name, trans, _ in self._iter():
            trans.fit(X, y, **fit_params)
        return self

    def fit_transform(self, X, y=None, **fit_params):
        results = []
        for name, trans, weight in self._iter():
            if hasattr(trans, 'fit_transform'):
                res = trans.fit_transform(X, y, **fit_params)
            else:
                res = trans.fit(X, y, **fit_params).transform(X)
            results.append(res if weight is None else res * weight)
        return self._hstack(results)

    def transform(self, X, **params):
        results = []
        for name, trans, weight in self._iter():
            res = trans.transform(X)
            results.append(res if weight is None else res * weight)
        return self._hstack(results)

    def _hstack(self, Xs):
        if not Xs:
            return np.zeros((0, 0))
        return np.hstack([np.asarray(x) for x in Xs])

    def __getitem__(self, name):
        return self.named_transformers[name]

    def __sklearn_is_fitted__(self):
        from sklearn.base import check_is_fitted
        for _, t, _ in self._iter():
            check_is_fitted(t)
        return True


def make_union(*transformers, n_jobs=None, verbose=False, verbose_feature_names_out=True):
    return FeatureUnion(_name_estimators(transformers), n_jobs=n_jobs, verbose=verbose, verbose_feature_names_out=verbose_feature_names_out)
