import math
import numbers
import warnings
import numpy as np

from sklearn.exceptions import UndefinedMetricWarning
from sklearn.utils import _to_array, column_or_1d, type_of_target


def _arr(y):
    return np.asarray(_to_array(y))


def _prep(y_true, y_pred):
    yt = _arr(y_true)
    yp = _arr(y_pred)
    if yt.ndim == 2 and yt.shape[1] == 1:
        yt = yt.ravel()
    if yp.ndim == 2 and yp.shape[1] == 1:
        yp = yp.ravel()
    if len(yt) != len(yp):
        raise ValueError('Found input variables with inconsistent numbers of samples: [%d, %d]' % (len(yt), len(yp)))
    return yt, yp


def _weights(sample_weight, n):
    return None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)


def _unique_labels(*ys):
    seen = []
    for y in ys:
        for v in np.unique(y).tolist():
            if v not in seen:
                seen.append(v)
    return np.array(sorted(seen))


# ───────────────────────── clasificación ─────────────────────────

def accuracy_score(y_true, y_pred, *, normalize=True, sample_weight=None):
    yt, yp = _prep(y_true, y_pred)
    ok = (yt == yp).astype(np.float64)
    if sample_weight is not None:
        w = np.asarray(sample_weight, dtype=np.float64)
        ok = ok * w
        return float(ok.sum() / w.sum()) if normalize else float(ok.sum())
    return float(ok.mean()) if normalize else float(ok.sum())


def zero_one_loss(y_true, y_pred, *, normalize=True, sample_weight=None):
    score = accuracy_score(y_true, y_pred, normalize=normalize, sample_weight=sample_weight)
    n = len(_arr(y_true))
    return 1.0 - score if normalize else n - score


def confusion_matrix(y_true, y_pred, *, labels=None, sample_weight=None, normalize=None):
    yt, yp = _prep(y_true, y_pred)
    labels = _unique_labels(yt, yp) if labels is None else np.asarray(labels)
    idx = {v: i for i, v in enumerate(labels.tolist())}
    n = len(labels)
    cm = np.zeros((n, n), dtype=np.int64 if sample_weight is None else np.float64)
    w = np.ones(len(yt)) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
    for t, p, wi in zip(yt.tolist(), yp.tolist(), w.tolist()):
        if t in idx and p in idx:
            cm[idx[t], idx[p]] += wi
    if normalize in ('true', 'pred', 'all'):
        cm = cm.astype(np.float64)
        with np.errstate(all='ignore') if hasattr(np, 'errstate') else _Noop():
            if normalize == 'true':
                cm = cm / cm.sum(axis=1, keepdims=True)
            elif normalize == 'pred':
                cm = cm / cm.sum(axis=0, keepdims=True)
            else:
                cm = cm / cm.sum()
        cm = np.nan_to_num(cm)
    return cm


class _Noop:
    def __enter__(self):
        return self

    def __exit__(self, *e):
        return False


def multilabel_confusion_matrix(y_true, y_pred, *, labels=None, sample_weight=None):
    yt, yp = _prep(y_true, y_pred)
    labels = _unique_labels(yt, yp) if labels is None else np.asarray(labels)
    out = []
    for c in labels.tolist():
        t = yt == c
        p = yp == c
        tp = int((t & p).sum())
        fp = int((~t & p).sum())
        fn = int((t & ~p).sum())
        tn = int((~t & ~p).sum())
        out.append([[tn, fp], [fn, tp]])
    return np.array(out)


def _safe_div(num, den, zero_division, name='Precision', warn=True):
    if den == 0:
        if zero_division == 'warn' and warn:
            warnings.warn('%s is ill-defined and being set to 0.0 due to no predicted samples. Use `zero_division` parameter to control this behavior.' % name, UndefinedMetricWarning)
        return 0.0 if zero_division in ('warn', 0, 0.0) else float(zero_division)
    return num / den


def _counts(yt, yp, labels, w):
    tp, fp, fn, sup = [], [], [], []
    for c in labels:
        t = yt == c
        p = yp == c
        wt = np.ones(len(yt)) if w is None else w
        tp.append(float((wt * (t & p)).sum()))
        fp.append(float((wt * (~t & p)).sum()))
        fn.append(float((wt * (t & ~p)).sum()))
        sup.append(float((wt * t).sum()))
    return np.array(tp), np.array(fp), np.array(fn), np.array(sup)


def _prf(tp, fp, fn, beta, zd, warn=True):
    prec = np.array([_safe_div(a, a + b, zd, 'Precision', warn) for a, b in zip(tp, fp)])
    rec = np.array([_safe_div(a, a + b, zd, 'Recall', warn) for a, b in zip(tp, fn)])
    b2 = beta ** 2
    f = []
    for a, b, c in zip(tp, fp, fn):
        den = (1 + b2) * a + b2 * c + b
        f.append(_safe_div((1 + b2) * a, den, zd, 'F-score', False) if den == 0 else (1 + b2) * a / den)
    return prec, rec, np.array(f)


def precision_recall_fscore_support(y_true, y_pred, *, beta=1.0, labels=None, pos_label=1, average=None, warn_for=('precision', 'recall', 'f-score'), sample_weight=None, zero_division='warn'):
    yt, yp = _prep(y_true, y_pred)
    w = _weights(sample_weight, len(yt))
    present = _unique_labels(yt, yp)
    if average == 'binary':
        if len(present) > 2:
            raise ValueError("Target is multiclass but average='binary'. Please choose another average setting, one of [None, 'micro', 'macro', 'weighted'].")
        if pos_label not in present.tolist():
            if len(present) <= 2 and (labels is None):
                raise ValueError('pos_label=%r is not a valid label. It should be one of %s' % (pos_label, present.tolist()))
        labs = np.array([pos_label])
    elif labels is not None:
        labs = np.asarray(labels)
    else:
        labs = present
    tp, fp, fn, sup = _counts(yt, yp, labs.tolist(), w)
    if average == 'micro':
        p, r, f = _prf(np.array([tp.sum()]), np.array([fp.sum()]), np.array([fn.sum()]), beta, zero_division)
        return float(p[0]), float(r[0]), float(f[0]), None
    p, r, f = _prf(tp, fp, fn, beta, zero_division)
    if average is None:
        return p, r, f, sup.astype(np.int64) if w is None else sup
    if average == 'binary':
        return float(p[0]), float(r[0]), float(f[0]), None
    if average == 'macro':
        return float(p.mean()), float(r.mean()), float(f.mean()), None
    if average == 'weighted':
        if sup.sum() == 0:
            return (0.0 if zero_division in ('warn', 0) else 1.0,) * 3 + (None,)
        return float(np.average(p, weights=sup)), float(np.average(r, weights=sup)), float(np.average(f, weights=sup)), None
    raise ValueError("average has to be one of (None, 'micro', 'macro', 'weighted', 'samples', 'binary')")


def precision_score(y_true, y_pred, *, labels=None, pos_label=1, average='binary', sample_weight=None, zero_division='warn'):
    return precision_recall_fscore_support(y_true, y_pred, labels=labels, pos_label=pos_label, average=average, sample_weight=sample_weight, zero_division=zero_division)[0]


def recall_score(y_true, y_pred, *, labels=None, pos_label=1, average='binary', sample_weight=None, zero_division='warn'):
    return precision_recall_fscore_support(y_true, y_pred, labels=labels, pos_label=pos_label, average=average, sample_weight=sample_weight, zero_division=zero_division)[1]


def f1_score(y_true, y_pred, *, labels=None, pos_label=1, average='binary', sample_weight=None, zero_division='warn'):
    return precision_recall_fscore_support(y_true, y_pred, beta=1.0, labels=labels, pos_label=pos_label, average=average, sample_weight=sample_weight, zero_division=zero_division)[2]


def fbeta_score(y_true, y_pred, *, beta, labels=None, pos_label=1, average='binary', sample_weight=None, zero_division='warn'):
    return precision_recall_fscore_support(y_true, y_pred, beta=beta, labels=labels, pos_label=pos_label, average=average, sample_weight=sample_weight, zero_division=zero_division)[2]


def balanced_accuracy_score(y_true, y_pred, *, sample_weight=None, adjusted=False):
    C = confusion_matrix(y_true, y_pred, sample_weight=sample_weight).astype(np.float64)
    per = np.diag(C) / C.sum(axis=1)
    score = float(np.mean(per[~np.isnan(per)]))
    if adjusted:
        n = C.shape[0]
        score = (score - 1 / n) / (1 - 1 / n)
    return score


def jaccard_score(y_true, y_pred, *, labels=None, pos_label=1, average='binary', sample_weight=None, zero_division='warn'):
    yt, yp = _prep(y_true, y_pred)
    present = _unique_labels(yt, yp)
    labs = np.array([pos_label]) if average == 'binary' else (present if labels is None else np.asarray(labels))
    tp, fp, fn, sup = _counts(yt, yp, labs.tolist(), None)
    if average == 'micro':
        return float(tp.sum() / (tp.sum() + fp.sum() + fn.sum()))
    j = np.array([_safe_div(a, a + b + c, zero_division, 'Jaccard') for a, b, c in zip(tp, fp, fn)])
    if average is None:
        return j
    if average == 'binary':
        return float(j[0])
    if average == 'weighted':
        return float(np.average(j, weights=sup))
    return float(j.mean())


def hamming_loss(y_true, y_pred, *, sample_weight=None):
    yt, yp = _prep(y_true, y_pred)
    return float((yt != yp).mean())


def matthews_corrcoef(y_true, y_pred, *, sample_weight=None):
    C = confusion_matrix(y_true, y_pred).astype(np.float64)
    t_sum = C.sum(axis=1)
    p_sum = C.sum(axis=0)
    n = C.sum()
    cov_ytyp = np.trace(C) * n - np.dot(t_sum, p_sum)
    cov_ypyp = n ** 2 - np.dot(p_sum, p_sum)
    cov_ytyt = n ** 2 - np.dot(t_sum, t_sum)
    den = np.sqrt(cov_ytyt * cov_ypyp)
    return float(cov_ytyp / den) if den != 0 else 0.0


def cohen_kappa_score(y1, y2, *, labels=None, weights=None, sample_weight=None):
    C = confusion_matrix(y1, y2, labels=labels).astype(np.float64)
    n = C.sum()
    sum0 = C.sum(axis=0)
    sum1 = C.sum(axis=1)
    expected = np.outer(sum0, sum1) / n
    k = C.shape[0]
    if weights is None:
        w = np.ones((k, k)) - np.eye(k)
    else:
        idx = np.arange(k)
        w = np.abs(idx[:, None] - idx[None, :]) if weights == 'linear' else (idx[:, None] - idx[None, :]) ** 2
    return float(1 - np.sum(w * C) / np.sum(w * expected))


def classification_report(y_true, y_pred, *, labels=None, target_names=None, sample_weight=None, digits=2, output_dict=False, zero_division='warn'):
    yt, yp = _prep(y_true, y_pred)
    unique = _unique_labels(yt, yp)
    labels_given = labels is not None
    labs = unique if labels is None else np.asarray(labels)
    ytype = type_of_target(yt)
    micro_is_accuracy = ytype in ('multiclass', 'binary') and (not labels_given or set(labs.tolist()) >= set(unique.tolist()))
    if target_names is not None and len(labs) != len(target_names):
        raise ValueError('Number of classes, %d, does not match size of target_names, %d. Try specifying the labels parameter' % (len(labs), len(target_names)))
    if target_names is None:
        target_names = ['%s' % l for l in labs.tolist()]
    headers = ['precision', 'recall', 'f1-score', 'support']
    p, r, f1, s = precision_recall_fscore_support(yt, yp, labels=labs, average=None, sample_weight=sample_weight, zero_division=zero_division)
    rows = list(zip(target_names, p.tolist(), r.tolist(), f1.tolist(), s.tolist()))
    if output_dict:
        report = {row[0]: dict(zip(headers, [float(v) for v in row[1:]])) for row in rows}
    else:
        longest = 'weighted avg'
        width = max(max(len(cn) for cn in target_names), len(longest), digits)
        head_fmt = '{:>{width}s} ' + ' {:>9}' * len(headers)
        report = head_fmt.format('', *headers, width=width)
        report += '\n\n'
        row_fmt = '{:>{width}s} ' + ' {:>9.{digits}f}' * 3 + ' {:>9}\n'
        for row in rows:
            report += row_fmt.format(*row, width=width, digits=digits)
        report += '\n'
    for average in ('micro', 'macro', 'weighted'):
        heading = 'accuracy' if (average == 'micro' and micro_is_accuracy) else average + ' avg'
        ap, ar, af, _ = precision_recall_fscore_support(yt, yp, labels=labs, average=average, sample_weight=sample_weight, zero_division=zero_division)
        avg = [ap, ar, af, float(np.sum(s))]
        if output_dict:
            report[heading] = dict(zip(headers, [float(v) for v in avg]))
        elif heading == 'accuracy':
            report += ('{:>{width}s} ' + ' {:>9.{digits}}' * 2 + ' {:>9.{digits}f}' + ' {:>9}\n').format(heading, '', '', avg[2], int(avg[3]), width=width, digits=digits)
        else:
            report += row_fmt.format(heading, avg[0], avg[1], avg[2], int(avg[3]), width=width, digits=digits)
    if output_dict:
        if 'accuracy' in report:
            report['accuracy'] = report['accuracy']['precision']
    return report


# ───────────────────────── curvas ─────────────────────────

def _binary_clf_curve(y_true, y_score, pos_label=None, sample_weight=None):
    y_true = column_or_1d(y_true)
    y_score = column_or_1d(y_score)
    classes = np.unique(y_true).tolist()
    if pos_label is None:
        if not (set(classes) <= {0, 1} or set(classes) <= {-1, 1} or set(classes) <= {False, True}) or len(classes) > 2:
            raise ValueError('y_true takes value in %s and pos_label is not specified: either make y_true take value in {0, 1} or {-1, 1} or pass pos_label explicitly.' % (classes,))
        pos_label = 1.0
    y_true = (y_true == pos_label)
    desc = np.argsort(y_score, kind='mergesort')[::-1]
    y_score = y_score[desc]
    y_true = y_true[desc]
    if sample_weight is not None:
        weight = np.asarray(sample_weight, dtype=np.float64)[desc]
    else:
        weight = 1.0
    distinct = np.where(np.diff(y_score))[0]
    thr = np.r_[distinct, y_true.size - 1]
    tps = np.cumsum(y_true * weight)[thr]
    if sample_weight is not None:
        fps = np.cumsum((1 - y_true) * weight)[thr]
    else:
        fps = 1 + thr - tps
    return fps, tps, y_score[thr]


def roc_curve(y_true, y_score, *, pos_label=None, sample_weight=None, drop_intermediate=True):
    fps, tps, thresholds = _binary_clf_curve(y_true, y_score, pos_label=pos_label, sample_weight=sample_weight)
    if drop_intermediate and len(fps) > 2:
        keep = np.where(np.r_[True, np.logical_or(np.diff(fps, 2), np.diff(tps, 2)), True])[0]
        fps = fps[keep]
        tps = tps[keep]
        thresholds = thresholds[keep]
    tps = np.r_[0, tps]
    fps = np.r_[0, fps]
    thresholds = np.r_[np.inf, thresholds]
    fpr = fps / fps[-1] if fps[-1] > 0 else np.repeat(np.nan, fps.shape)
    tpr = tps / tps[-1] if tps[-1] > 0 else np.repeat(np.nan, tps.shape)
    return fpr, tpr, thresholds


def auc(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.shape[0] < 2:
        raise ValueError('At least 2 points are needed to compute area under curve, but x.shape = %s' % (x.shape,))
    d = np.diff(x)
    direction = 1
    if np.any(d < 0):
        if np.all(d <= 0):
            direction = -1
        else:
            raise ValueError('x is neither increasing nor decreasing : %s.' % x)
    return float(direction * np.trapezoid(y, x))


def roc_auc_score(y_true, y_score, *, average='macro', sample_weight=None, max_fpr=None, multi_class='raise', labels=None):
    yt = _arr(y_true)
    ys = _arr(y_score)
    classes = np.unique(yt)
    if len(classes) == 2 and ys.ndim <= 1 or (len(classes) == 2 and ys.ndim == 2 and ys.shape[1] == 1):
        ys = ys.ravel()
        if len(classes) < 2:
            raise ValueError('Only one class is present in y_true. ROC AUC score is not defined in that case.')
        fpr, tpr, _ = roc_curve(yt, ys, pos_label=classes[1], sample_weight=sample_weight)
        return auc(fpr, tpr)
    if len(classes) == 2 and ys.ndim == 2:
        return roc_auc_score(yt, ys[:, 1])
    if ys.ndim == 2 and ys.shape[1] > 2:
        if multi_class == 'raise':
            raise ValueError("multi_class must be in ('ovo', 'ovr')")
        labs = classes if labels is None else np.asarray(labels)
        if multi_class == 'ovr':
            scores = []
            weights = []
            for k, c in enumerate(labs.tolist()):
                t = (yt == c).astype(int)
                fpr, tpr, _ = roc_curve(t, ys[:, k], pos_label=1)
                scores.append(auc(fpr, tpr))
                weights.append(t.sum())
            return float(np.average(scores, weights=weights if average == 'weighted' else None))
        pairs = []
        k = len(labs)
        for a in range(k):
            for b in range(a + 1, k):
                m = (yt == labs[a]) | (yt == labs[b])
                s1 = auc(*roc_curve((yt[m] == labs[a]).astype(int), ys[m, a])[:2])
                s2 = auc(*roc_curve((yt[m] == labs[b]).astype(int), ys[m, b])[:2])
                pairs.append((s1 + s2) / 2)
        return float(np.mean(pairs))
    raise ValueError('Only one class is present in y_true. ROC AUC score is not defined in that case.')


def precision_recall_curve(y_true, y_score=None, *, pos_label=None, sample_weight=None, drop_intermediate=False, probas_pred=None):
    fps, tps, thresholds = _binary_clf_curve(y_true, y_score, pos_label=pos_label, sample_weight=sample_weight)
    if drop_intermediate and len(fps) > 2:
        keep = np.where(np.r_[True, np.logical_or(np.diff(fps, 2), np.diff(tps, 2)), True])[0]
        fps, tps, thresholds = fps[keep], tps[keep], thresholds[keep]
    ps = tps + fps
    precision = np.zeros_like(tps)
    nz = ps != 0
    precision[nz] = tps[nz] / ps[nz]
    recall = np.ones_like(tps) if tps[-1] == 0 else tps / tps[-1]
    return np.hstack((precision[::-1], 1)), np.hstack((recall[::-1], 0)), thresholds[::-1]


def average_precision_score(y_true, y_score, *, average='macro', pos_label=1, sample_weight=None):
    precision, recall, _ = precision_recall_curve(y_true, y_score, pos_label=pos_label, sample_weight=sample_weight)
    return float(-np.sum(np.diff(recall) * np.array(precision)[:-1]))


def log_loss(y_true, y_pred, *, normalize=True, sample_weight=None, labels=None, eps='auto'):
    yt = _arr(y_true)
    yp = np.asarray(_to_array(y_pred), dtype=np.float64)
    classes = np.unique(yt) if labels is None else np.asarray(labels)
    if yp.ndim == 1:
        yp = np.column_stack([1 - yp, yp])
    epsv = np.finfo(np.float64).eps if eps == 'auto' else eps
    yp = np.clip(yp, epsv, 1 - epsv)
    yp = yp / yp.sum(axis=1, keepdims=True)
    idx = np.array([classes.tolist().index(v) for v in yt.tolist()])
    loss = -np.log(yp[np.arange(len(idx)), idx])
    if sample_weight is not None:
        loss = loss * np.asarray(sample_weight)
        return float(loss.sum() / np.sum(sample_weight)) if normalize else float(loss.sum())
    return float(loss.mean()) if normalize else float(loss.sum())


def brier_score_loss(y_true, y_proba=None, *, sample_weight=None, pos_label=None, y_prob=None):
    p = _arr(y_proba if y_proba is not None else y_prob).astype(np.float64)
    t = _arr(y_true)
    pl = pos_label if pos_label is not None else (np.unique(t)[-1] if len(np.unique(t)) else 1)
    return float(np.mean((p - (t == pl)) ** 2))


class ConfusionMatrixDisplay:
    def __init__(self, confusion_matrix, *, display_labels=None):
        self.confusion_matrix = confusion_matrix
        self.display_labels = display_labels

    @classmethod
    def from_predictions(cls, y_true, y_pred, *, labels=None, normalize=None, display_labels=None, cmap='viridis', **kw):
        cm = confusion_matrix(y_true, y_pred, labels=labels, normalize=normalize)
        labs = display_labels if display_labels is not None else (labels if labels is not None else _unique_labels(_arr(y_true), _arr(y_pred)).tolist())
        d = cls(cm, display_labels=labs)
        return d.plot(cmap=cmap)

    @classmethod
    def from_estimator(cls, estimator, X, y, *, labels=None, normalize=None, display_labels=None, cmap='viridis', **kw):
        return cls.from_predictions(y, estimator.predict(X), labels=labels, normalize=normalize, display_labels=display_labels, cmap=cmap)

    def plot(self, *, cmap='viridis', **kw):
        import matplotlib.pyplot as plt
        cm = self.confusion_matrix
        n = cm.shape[0]
        plt.imshow(cm, cmap=cmap)
        labs = [str(l) for l in (self.display_labels if self.display_labels is not None else range(n))]
        plt.xticks(list(range(n)), labs)
        plt.yticks(list(range(n)), labs)
        plt.xlabel('Predicted label')
        plt.ylabel('True label')
        hi = float(cm.max()) if cm.size else 1.0
        for i in range(n):
            for j in range(n):
                v = cm[i, j]
                txt = ('%d' % v) if float(v) == int(v) else ('%.2g' % v)
                plt.text(j, i, txt, color='white' if v < hi / 2 else 'black')
        return self


# ───────────────────────── regresión ─────────────────────────

def _reg(y_true, y_pred):
    yt = np.asarray(_to_array(y_true), dtype=np.float64)
    yp = np.asarray(_to_array(y_pred), dtype=np.float64)
    if yt.ndim == 1 and yp.ndim == 2 and yp.shape[1] == 1:
        yp = yp.ravel()
    if yp.ndim == 1 and yt.ndim == 2 and yt.shape[1] == 1:
        yt = yt.ravel()
    if len(yt) != len(yp):
        raise ValueError('Found input variables with inconsistent numbers of samples: [%d, %d]' % (len(yt), len(yp)))
    return yt, yp


def _avg(vals, multioutput, weights_for_var=None):
    vals = np.asarray(vals)
    if np.ndim(vals) == 0:
        return float(vals)
    if multioutput == 'raw_values':
        return vals
    if isinstance(multioutput, str) and multioutput == 'uniform_average':
        return float(vals.mean())
    if multioutput == 'variance_weighted':
        return float(np.average(vals, weights=weights_for_var))
    return float(np.average(vals, weights=multioutput))


def mean_squared_error(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average', squared=True):
    yt, yp = _reg(y_true, y_pred)
    out = np.average((yt - yp) ** 2, axis=0, weights=sample_weight)
    if squared is False:
        out = np.sqrt(out)
    return _avg(out, multioutput)


def root_mean_squared_error(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average'):
    return mean_squared_error(y_true, y_pred, sample_weight=sample_weight, multioutput=multioutput, squared=False)


def mean_absolute_error(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average'):
    yt, yp = _reg(y_true, y_pred)
    return _avg(np.average(np.abs(yt - yp), axis=0, weights=sample_weight), multioutput)


def median_absolute_error(y_true, y_pred, *, multioutput='uniform_average', sample_weight=None):
    yt, yp = _reg(y_true, y_pred)
    return _avg(np.median(np.abs(yt - yp), axis=0), multioutput)


def mean_absolute_percentage_error(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average'):
    yt, yp = _reg(y_true, y_pred)
    eps = np.finfo(np.float64).eps
    return _avg(np.average(np.abs(yp - yt) / np.maximum(np.abs(yt), eps), axis=0, weights=sample_weight), multioutput)


def mean_squared_log_error(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average', squared=True):
    yt, yp = _reg(y_true, y_pred)
    if (yt <= -1).any() or (yp <= -1).any():
        raise ValueError('Mean Squared Logarithmic Error cannot be used when targets contain values less than or equal to -1.')
    return mean_squared_error(np.log1p(yt), np.log1p(yp), sample_weight=sample_weight, multioutput=multioutput, squared=squared)


def r2_score(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average', force_finite=True):
    yt, yp = _reg(y_true, y_pred)
    if len(yt) < 2:
        warnings.warn('R^2 score is not well-defined with less than two samples.', UndefinedMetricWarning)
        return float('nan')
    w = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
    num = np.average((yt - yp) ** 2, axis=0, weights=w) * (len(yt) if w is None else w.sum())
    mean = np.average(yt, axis=0, weights=w)
    den = np.average((yt - mean) ** 2, axis=0, weights=w) * (len(yt) if w is None else w.sum())
    if np.ndim(den) == 0:
        if den == 0:
            return 1.0 if num == 0 else 0.0
        return float(1 - num / den)
    scores = np.where(den == 0, np.where(num == 0, 1.0, 0.0), 1 - num / np.where(den == 0, 1.0, den))
    return _avg(scores, multioutput, weights_for_var=den)


def explained_variance_score(y_true, y_pred, *, sample_weight=None, multioutput='uniform_average', force_finite=True):
    yt, yp = _reg(y_true, y_pred)
    num = np.var(yt - yp, axis=0)
    den = np.var(yt, axis=0)
    if np.ndim(den) == 0:
        return float(1.0 if (den == 0 and num == 0) else (0.0 if den == 0 else 1 - num / den))
    return _avg(np.where(den == 0, 1.0, 1 - num / np.where(den == 0, 1.0, den)), multioutput)


def max_error(y_true, y_pred):
    yt, yp = _reg(y_true, y_pred)
    return float(np.max(np.abs(yt - yp)))


# ───────────────────────── agrupamiento ─────────────────────────

def pairwise_distances(X, Y=None, metric='euclidean', **kw):
    X = np.asarray(_to_array(X), dtype=np.float64)
    Y = X if Y is None else np.asarray(_to_array(Y), dtype=np.float64)
    if metric == 'euclidean':
        return np.sqrt(np.maximum(((X[:, None, :] - Y[None, :, :]) ** 2).sum(axis=2), 0))
    if metric in ('manhattan', 'cityblock', 'l1'):
        return np.abs(X[:, None, :] - Y[None, :, :]).sum(axis=2)
    if metric == 'cosine':
        return 1 - cosine_similarity(X, Y)
    if metric == 'chebyshev':
        return np.abs(X[:, None, :] - Y[None, :, :]).max(axis=2)
    if callable(metric):
        return np.array([[metric(a, b) for b in Y] for a in X])
    raise ValueError('Unknown metric %s' % metric)


def euclidean_distances(X, Y=None, **kw):
    return pairwise_distances(X, Y, 'euclidean')


def manhattan_distances(X, Y=None, **kw):
    return pairwise_distances(X, Y, 'manhattan')


def cosine_similarity(X, Y=None, dense_output=True):
    X = np.asarray(_to_array(X), dtype=np.float64)
    Y = X if Y is None else np.asarray(_to_array(Y), dtype=np.float64)
    if X.ndim == 1:
        X = X.reshape(1, -1)
    if Y.ndim == 1:
        Y = Y.reshape(1, -1)
    nx = np.sqrt((X ** 2).sum(axis=1))
    ny = np.sqrt((Y ** 2).sum(axis=1))
    nx = np.where(nx == 0, 1.0, nx)
    ny = np.where(ny == 0, 1.0, ny)
    return (X / nx[:, None]) @ (Y / ny[:, None]).T


def silhouette_samples(X, labels, *, metric='euclidean'):
    X = np.asarray(_to_array(X), dtype=np.float64)
    labels = np.asarray(labels)
    D = pairwise_distances(X, metric=metric)
    uniq = np.unique(labels)
    out = np.zeros(len(X))
    for i in range(len(X)):
        same = labels == labels[i]
        n_same = same.sum()
        if n_same <= 1:
            out[i] = 0.0
            continue
        a = D[i, same].sum() / (n_same - 1)
        b = min(D[i, labels == c].mean() for c in uniq if c != labels[i])
        out[i] = (b - a) / max(a, b) if max(a, b) > 0 else 0.0
    return out


def silhouette_score(X, labels, *, metric='euclidean', sample_size=None, random_state=None):
    if len(np.unique(labels)) < 2 or len(np.unique(labels)) > len(labels) - 1:
        raise ValueError('Number of labels is %d. Valid values are 2 to n_samples - 1 (inclusive)' % len(np.unique(labels)))
    return float(np.mean(silhouette_samples(X, labels, metric=metric)))


def calinski_harabasz_score(X, labels):
    X = np.asarray(_to_array(X), dtype=np.float64)
    labels = np.asarray(labels)
    n = len(X)
    classes = np.unique(labels)
    k = len(classes)
    mean = X.mean(axis=0)
    ext = 0.0
    intra = 0.0
    for c in classes:
        m = X[labels == c]
        cm = m.mean(axis=0)
        ext += len(m) * ((cm - mean) ** 2).sum()
        intra += ((m - cm) ** 2).sum()
    return float(1.0 if intra == 0 else ext * (n - k) / (intra * (k - 1.0)))


def davies_bouldin_score(X, labels):
    X = np.asarray(_to_array(X), dtype=np.float64)
    labels = np.asarray(labels)
    classes = np.unique(labels)
    cents = np.array([X[labels == c].mean(axis=0) for c in classes])
    intra = np.array([np.mean(np.sqrt(((X[labels == c] - cents[i]) ** 2).sum(axis=1))) for i, c in enumerate(classes)])
    cd = pairwise_distances(cents)
    np.fill_diagonal(cd, np.inf)
    return float(np.mean(np.max((intra[:, None] + intra[None, :]) / cd, axis=1)))


def _contingency(a, b):
    a = np.asarray(a)
    b = np.asarray(b)
    ca, ia = np.unique(a, return_inverse=True)
    cb, ib = np.unique(b, return_inverse=True)
    M = np.zeros((len(ca), len(cb)))
    for i, j in zip(ia.tolist(), ib.tolist()):
        M[i, j] += 1
    return M


def adjusted_rand_score(labels_true, labels_pred):
    M = _contingency(labels_true, labels_pred)
    comb = lambda n: n * (n - 1) / 2.0
    sum_comb_c = sum(comb(x) for x in M.sum(axis=1))
    sum_comb_k = sum(comb(x) for x in M.sum(axis=0))
    sum_comb = sum(comb(x) for x in M.ravel())
    n = M.sum()
    prod = sum_comb_c * sum_comb_k / comb(n)
    mean = (sum_comb_c + sum_comb_k) / 2.0
    if mean == prod:
        return 1.0
    return float((sum_comb - prod) / (mean - prod))


def _entropy(labels):
    _, c = np.unique(labels, return_counts=True)
    p = c / c.sum()
    return float(-(p * np.log(p)).sum())


def mutual_info_score(labels_true, labels_pred):
    M = _contingency(labels_true, labels_pred)
    n = M.sum()
    pi = M.sum(axis=1)
    pj = M.sum(axis=0)
    mi = 0.0
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            if M[i, j] > 0:
                mi += (M[i, j] / n) * math.log((M[i, j] * n) / (pi[i] * pj[j]))
    return float(mi)


def normalized_mutual_info_score(labels_true, labels_pred, *, average_method='arithmetic'):
    mi = mutual_info_score(labels_true, labels_pred)
    h1, h2 = _entropy(labels_true), _entropy(labels_pred)
    if h1 == 0 and h2 == 0:
        return 1.0
    norm = (h1 + h2) / 2 if average_method == 'arithmetic' else (max(h1, h2) if average_method == 'max' else (min(h1, h2) if average_method == 'min' else math.sqrt(h1 * h2)))
    return float(mi / norm) if norm > 0 else 0.0


def homogeneity_score(labels_true, labels_pred):
    h_c = _entropy(labels_true)
    if h_c == 0:
        return 1.0
    M = _contingency(labels_true, labels_pred)
    n = M.sum()
    cond = 0.0
    for j in range(M.shape[1]):
        col = M[:, j]
        for v in col:
            if v > 0:
                cond -= (v / n) * math.log(v / col.sum())
    return float(1 - cond / h_c)


def completeness_score(labels_true, labels_pred):
    return homogeneity_score(labels_pred, labels_true)


def v_measure_score(labels_true, labels_pred):
    h = homogeneity_score(labels_true, labels_pred)
    c = completeness_score(labels_true, labels_pred)
    return 0.0 if h + c == 0 else float(2 * h * c / (h + c))


# ───────────────────────── puntuadores (scoring='…') ─────────────────────────

class _Scorer:
    def __init__(self, func, sign=1, needs=None, kwargs=None, name=''):
        self._func = func
        self._sign = sign
        self._needs = needs
        self._kwargs = kwargs or {}
        self._name = name

    def __call__(self, estimator, X, y, sample_weight=None):
        if self._needs == 'proba':
            if hasattr(estimator, 'predict_proba'):
                pred = estimator.predict_proba(X)
                if pred.shape[1] == 2 and self._name in ('roc_auc', 'average_precision', 'neg_brier_score'):
                    pred = pred[:, 1]
            else:
                pred = estimator.decision_function(X)
        elif self._needs == 'threshold':
            pred = estimator.decision_function(X) if hasattr(estimator, 'decision_function') else estimator.predict_proba(X)[:, 1]
        else:
            pred = estimator.predict(X)
        return self._sign * self._func(y, pred, **self._kwargs)

    def __repr__(self):
        return 'make_scorer(%s)' % getattr(self._func, '__name__', 'func')


_SCORERS = {
    'accuracy': _Scorer(accuracy_score),
    'balanced_accuracy': _Scorer(balanced_accuracy_score),
    'f1': _Scorer(f1_score),
    'f1_macro': _Scorer(f1_score, kwargs={'average': 'macro'}),
    'f1_micro': _Scorer(f1_score, kwargs={'average': 'micro'}),
    'f1_weighted': _Scorer(f1_score, kwargs={'average': 'weighted'}),
    'precision': _Scorer(precision_score),
    'precision_macro': _Scorer(precision_score, kwargs={'average': 'macro'}),
    'precision_weighted': _Scorer(precision_score, kwargs={'average': 'weighted'}),
    'recall': _Scorer(recall_score),
    'recall_macro': _Scorer(recall_score, kwargs={'average': 'macro'}),
    'recall_weighted': _Scorer(recall_score, kwargs={'average': 'weighted'}),
    'roc_auc': _Scorer(roc_auc_score, needs='threshold', name='roc_auc'),
    'roc_auc_ovr': _Scorer(roc_auc_score, needs='proba', kwargs={'multi_class': 'ovr'}, name='roc_auc_ovr'),
    'average_precision': _Scorer(average_precision_score, needs='threshold', name='average_precision'),
    'neg_log_loss': _Scorer(log_loss, sign=-1, needs='proba', name='neg_log_loss'),
    'neg_brier_score': _Scorer(brier_score_loss, sign=-1, needs='proba', name='neg_brier_score'),
    'r2': _Scorer(r2_score),
    'neg_mean_squared_error': _Scorer(mean_squared_error, sign=-1),
    'neg_root_mean_squared_error': _Scorer(root_mean_squared_error, sign=-1),
    'neg_mean_absolute_error': _Scorer(mean_absolute_error, sign=-1),
    'neg_median_absolute_error': _Scorer(median_absolute_error, sign=-1),
    'neg_mean_absolute_percentage_error': _Scorer(mean_absolute_percentage_error, sign=-1),
    'explained_variance': _Scorer(explained_variance_score),
    'max_error': _Scorer(max_error, sign=-1),
}


def get_scorer(scoring):
    if callable(scoring):
        return scoring
    if scoring not in _SCORERS:
        raise ValueError("'%s' is not a valid scoring value. Use sklearn.metrics.get_scorer_names() to get valid options." % scoring)
    return _SCORERS[scoring]


def get_scorer_names():
    return sorted(_SCORERS)


def make_scorer(score_func, *, greater_is_better=True, response_method=None, needs_proba=False, needs_threshold=False, **kwargs):
    needs = 'proba' if (needs_proba or response_method == 'predict_proba') else ('threshold' if (needs_threshold or response_method in ('decision_function', 'predict_proba')) else None)
    return _Scorer(score_func, 1 if greater_is_better else -1, needs, kwargs, getattr(score_func, '__name__', ''))
