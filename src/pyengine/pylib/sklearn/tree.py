from sklearn.utils._param_validation import check_interval
import math
import numbers
import numpy as np

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, check_is_fitted, is_classifier
from sklearn.utils import check_array, check_random_state, _to_array
import _mlkern

RAND_R_MAX = 2147483647


class Tree:
    """Estructura del árbol entrenado (los mismos atributos que `tree_` en scikit-learn)."""

    def __init__(self, n_features, n_classes, n_outputs, arrays):
        left, right, feature, threshold, impurity, n_node, w_node, value = arrays
        self.n_features = n_features
        self.n_classes = np.array(n_classes, dtype=np.int64)
        self.n_outputs = n_outputs
        self.children_left = left
        self.children_right = right
        self.feature = feature
        self.threshold = threshold
        self.impurity = impurity
        self.n_node_samples = n_node
        self.weighted_n_node_samples = w_node
        self.value = value
        self.node_count = int(len(left))
        depth = np.zeros(self.node_count, dtype=np.int64)
        for i in range(self.node_count):
            if left[i] != -1:
                depth[left[i]] = depth[i] + 1
                depth[right[i]] = depth[i] + 1
        self.max_depth = int(depth.max()) if self.node_count else 0
        self._depth = depth

    def apply(self, X):
        return _mlkern.tree_apply(np.asarray(X, dtype=np.float64), self.children_left, self.children_right, self.feature, self.threshold)

    def predict(self, X):
        out = self.value[self.apply(X)]
        if self.n_outputs == 1:
            return out[:, 0]
        return out

    def compute_feature_importances(self, normalize=True):
        imp = np.zeros(self.n_features)
        for i in range(self.node_count):
            l, r = self.children_left[i], self.children_right[i]
            if l != -1:
                imp[self.feature[i]] += (self.weighted_n_node_samples[i] * self.impurity[i]
                                         - self.weighted_n_node_samples[l] * self.impurity[l]
                                         - self.weighted_n_node_samples[r] * self.impurity[r])
        imp = imp / self.weighted_n_node_samples[0]
        if normalize:
            s = imp.sum()
            if s > 0:
                imp = imp / s
        return imp


def _resolve_max_features(mf, n_features, is_clf_default=None):
    if mf is None:
        return n_features
    if isinstance(mf, str):
        if mf == 'sqrt':
            return max(1, int(math.sqrt(n_features)))
        if mf == 'log2':
            return max(1, int(math.log2(n_features)))
        raise ValueError("Invalid value for max_features. Allowed string values are 'sqrt' or 'log2'.")
    if isinstance(mf, numbers.Integral):
        return int(mf)
    return max(1, int(mf * n_features))


class BaseDecisionTree(BaseEstimator):
    def _fit(self, X, y, sample_weight, classes_info=None):
        n, d = X.shape
        rs = check_random_state(self.random_state)
        mss = self.min_samples_split
        msl = self.min_samples_leaf
        if not isinstance(mss, numbers.Integral):
            mss = int(math.ceil(mss * n))
        if not isinstance(msl, numbers.Integral):
            msl = int(math.ceil(msl * n))
        mwl = self.min_weight_fraction_leaf * (n if sample_weight is None else float(np.sum(sample_weight)))
        max_depth = None if self.max_depth is None else int(self.max_depth)
        if self.max_leaf_nodes is not None:
            raise ValueError('max_leaf_nodes no está disponible en esta versión en miniatura (usa max_depth o min_samples_leaf)')
        self.max_features_ = _resolve_max_features(self.max_features, d)
        if self.max_features_ < 1 or self.max_features_ > d:
            raise ValueError('max_features must be in (0, n_features]')
        seed = int(rs.randint(0, RAND_R_MAX))
        Y = y.reshape(n, -1).astype(np.float64)
        n_classes = classes_info if classes_info is not None else [1] * Y.shape[1]
        arrays = _mlkern.tree_build(X, Y, sample_weight, n_classes, self.criterion, max_depth, mss, msl, mwl, self.min_impurity_decrease, self.max_features_, seed)
        self.tree_ = Tree(d, n_classes, Y.shape[1], arrays)
        self.n_outputs_ = Y.shape[1]
        return self

    def get_depth(self):
        check_is_fitted(self)
        return self.tree_.max_depth

    def get_n_leaves(self):
        check_is_fitted(self)
        return int((self.tree_.children_left == -1).sum())

    def apply(self, X):
        check_is_fitted(self)
        return self.tree_.apply(self._validate_data(X, reset=False))

    def decision_path(self, X):
        from sklearn.preprocessing import _Sparse
        X = self._validate_data(X, reset=False)
        t = self.tree_
        out = np.zeros((X.shape[0], t.node_count), dtype=np.int64)
        for i in range(X.shape[0]):
            node = 0
            out[i, node] = 1
            while t.children_left[node] != -1:
                node = t.children_left[node] if np.float32(X[i, t.feature[node]]) <= t.threshold[node] else t.children_right[node]
                out[i, node] = 1
        return _Sparse(out)

    @property
    def feature_importances_(self):
        check_is_fitted(self)
        return self.tree_.compute_feature_importances()

    def cost_complexity_pruning_path(self, X, y, sample_weight=None):
        raise NotImplementedError('La poda por complejidad no está disponible en esta versión en miniatura')


class DecisionTreeClassifier(ClassifierMixin, BaseDecisionTree):
    def __init__(self, *, criterion='gini', splitter='best', max_depth=None, min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_features=None, random_state=None, max_leaf_nodes=None, min_impurity_decrease=0.0, class_weight=None, ccp_alpha=0.0, monotonic_cst=None):
        self.criterion = criterion
        self.splitter = splitter
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_features = max_features
        self.random_state = random_state
        self.max_leaf_nodes = max_leaf_nodes
        self.min_impurity_decrease = min_impurity_decrease
        self.class_weight = class_weight
        self.ccp_alpha = ccp_alpha
        self.monotonic_cst = monotonic_cst

    def fit(self, X, y, sample_weight=None, check_input=True):
        check_interval(self, 'max_depth', self.max_depth, int, 1, None, 'left', none_ok=True)
        check_interval(self, 'min_samples_leaf', self.min_samples_leaf, int, 1, None, 'left', extra='or a float in the range (0.0, 1.0)') if isinstance(self.min_samples_leaf, int) else None
        if self.criterion not in ('gini', 'entropy', 'log_loss'):
            raise ValueError("The 'criterion' parameter of DecisionTreeClassifier must be a str among {'gini', 'entropy', 'log_loss'}. Got %r instead." % (self.criterion,))
        X, y = self._validate_data(X, y)
        self.classes_, yi = np.unique(y, return_inverse=True)
        self.n_classes_ = len(self.classes_)
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        if self.class_weight is not None:
            if self.class_weight == 'balanced':
                cnt = np.bincount(yi)
                cw = len(y) / (len(cnt) * cnt)
            else:
                cw = np.array([self.class_weight.get(c, 1.0) for c in self.classes_.tolist()])
            w = cw[yi]
            sw = w if sw is None else sw * w
        self._fit(X, yi.astype(np.float64), sw, [self.n_classes_])
        return self

    def predict_proba(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        proba = self.tree_.predict(X)[:, :self.n_classes_]
        norm = proba.sum(axis=1, keepdims=True)
        norm = np.where(norm == 0, 1.0, norm)
        return proba / norm

    def predict_log_proba(self, X):
        return np.log(self.predict_proba(X))

    def predict(self, X):
        proba = self.predict_proba(X)
        return self.classes_[np.argmax(proba, axis=1)]


class DecisionTreeRegressor(RegressorMixin, BaseDecisionTree):
    def __init__(self, *, criterion='squared_error', splitter='best', max_depth=None, min_samples_split=2, min_samples_leaf=1, min_weight_fraction_leaf=0.0, max_features=None, random_state=None, max_leaf_nodes=None, min_impurity_decrease=0.0, ccp_alpha=0.0, monotonic_cst=None):
        self.criterion = criterion
        self.splitter = splitter
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_samples_leaf = min_samples_leaf
        self.min_weight_fraction_leaf = min_weight_fraction_leaf
        self.max_features = max_features
        self.random_state = random_state
        self.max_leaf_nodes = max_leaf_nodes
        self.min_impurity_decrease = min_impurity_decrease
        self.ccp_alpha = ccp_alpha
        self.monotonic_cst = monotonic_cst

    def fit(self, X, y, sample_weight=None, check_input=True):
        if self.criterion not in ('squared_error', 'friedman_mse'):
            raise ValueError("criterion=%r no está disponible en esta versión en miniatura (usa 'squared_error')" % (self.criterion,))
        X, y = self._validate_data(X, y)
        sw = None if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        self._fit(X, np.asarray(y, dtype=np.float64), sw)
        return self

    def predict(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        out = self.tree_.predict(X)
        return out[:, 0] if out.ndim == 2 and self.n_outputs_ == 1 else out


# ───────────────────────── exportar y dibujar ─────────────────────────

def _compute_depth(tree_, node):
    d = 1
    stack = [(node, 1)]
    best = 1
    while stack:
        n, k = stack.pop()
        best = max(best, k)
        if tree_.children_left[n] != -1:
            stack.append((tree_.children_left[n], k + 1))
            stack.append((tree_.children_right[n], k + 1))
    return best


def export_text(decision_tree, *, feature_names=None, class_names=None, max_depth=10, spacing=3, decimals=2, show_weights=False):
    check_is_fitted(decision_tree)
    tree_ = decision_tree.tree_
    if is_classifier(decision_tree):
        if class_names is None:
            class_names = decision_tree.classes_
    right_fmt = '{} {} <= {}\n'
    left_fmt = '{} {} >  {}\n'
    clf = isinstance(decision_tree, DecisionTreeClassifier)
    if feature_names is not None and len(feature_names) != tree_.n_features:
        raise ValueError('feature_names must contain %d elements, got %d' % (tree_.n_features, len(feature_names)))
    if feature_names is not None:
        names = [feature_names[i] if i != -2 else None for i in tree_.feature]
    else:
        names = ['feature_{}'.format(i) for i in tree_.feature]
    lines = []

    def add_leaf(value, wn, class_name, indent):
        if clf:
            val = ''
            if show_weights:
                val = ['{1:.{0}f}, '.format(decimals, v * wn) for v in value]
                val = '[' + ''.join(val)[:-2] + ']'
            val += ' class: ' + str(class_name)
            lines.append('{}{}{}\n'.format(indent, '', val) if not show_weights else '{}{} weights: {}\n'.format(indent, '', val))
        else:
            val = ['{1:.{0}f}, '.format(decimals, v) for v in value]
            val = '[' + ''.join(val)[:-2] + ']'
            lines.append('{}{} value: {}\n'.format(indent, '', val))

    def rec(node, depth):
        indent = ('|' + (' ' * spacing)) * depth
        indent = indent[:-spacing] + '-' * spacing
        value = tree_.value[node][0] if tree_.n_outputs == 1 else tree_.value[node].T[0]
        class_name = np.argmax(value)
        if tree_.n_classes[0] != 1 and tree_.n_outputs == 1:
            class_name = class_names[class_name]
        wn = tree_.weighted_n_node_samples[node]
        if depth <= max_depth + 1:
            if tree_.feature[node] != -2:
                name = names[node]
                thr = '{1:.{0}f}'.format(decimals, tree_.threshold[node])
                lines.append(right_fmt.format(indent, name, thr))
                rec(tree_.children_left[node], depth + 1)
                lines.append(left_fmt.format(indent, name, thr))
                rec(tree_.children_right[node], depth + 1)
            else:
                add_leaf(value, wn, class_name, indent)
        else:
            sd = _compute_depth(tree_, node)
            if sd == 1:
                add_leaf(value, wn, class_name, indent)
            else:
                lines.append('{} {}\n'.format(indent, 'truncated branch of depth %d' % sd))

    rec(0, 1)
    return ''.join(lines)


def export_graphviz(decision_tree, out_file=None, *, max_depth=None, feature_names=None, class_names=None, label='all', filled=False, leaves_parallel=False, impurity=True, node_ids=False, proportion=False, rotate=False, rounded=False, special_characters=False, precision=3, fontname='helvetica'):
    check_is_fitted(decision_tree)
    t = decision_tree.tree_
    clf = isinstance(decision_tree, DecisionTreeClassifier)
    names = feature_names if feature_names is not None else ['x[%d]' % i for i in range(t.n_features)]
    lines = ['digraph Tree {', 'node [shape=box] ;']
    for i in range(t.node_count):
        parts = []
        if t.children_left[i] != -1:
            parts.append('%s <= %s' % (names[t.feature[i]], round(float(t.threshold[i]), precision)))
        if impurity:
            parts.append('%s = %s' % ('gini' if clf and decision_tree.criterion == 'gini' else ('entropy' if clf else 'squared_error'), round(float(t.impurity[i]), precision)))
        parts.append('samples = %d' % t.n_node_samples[i])
        if clf:
            parts.append('value = [%s]' % ', '.join('%g' % (v * t.weighted_n_node_samples[i]) for v in t.value[i][0]))
            cls = decision_tree.classes_[int(np.argmax(t.value[i][0]))] if class_names is None or class_names is True else class_names[int(np.argmax(t.value[i][0]))]
            parts.append('class = %s' % cls)
        else:
            parts.append('value = %s' % round(float(t.value[i][0][0]), precision))
        lines.append('%d [label="%s"] ;' % (i, '\\n'.join(parts)))
        if t.children_left[i] != -1:
            lines.append('%d -> %d ;' % (i, t.children_left[i]))
            lines.append('%d -> %d ;' % (i, t.children_right[i]))
    lines.append('}')
    text = '\n'.join(lines)
    if out_file is None:
        return text
    if hasattr(out_file, 'write'):
        out_file.write(text)
    else:
        with open(out_file, 'w') as f:
            f.write(text)
    return None


def plot_tree(decision_tree, *, max_depth=None, feature_names=None, class_names=None, label='all', filled=False, impurity=True, node_ids=False, proportion=False, rounded=False, precision=3, ax=None, fontsize=None):
    import matplotlib.pyplot as plt
    check_is_fitted(decision_tree)
    t = decision_tree.tree_
    clf = isinstance(decision_tree, DecisionTreeClassifier)
    names = feature_names if feature_names is not None else ['x[%d]' % i for i in range(t.n_features)]
    pos = {}
    counter = [0]

    def lay(n, depth):
        if max_depth is not None and depth > max_depth:
            return None
        if t.children_left[n] == -1 or (max_depth is not None and depth == max_depth):
            x = counter[0]
            counter[0] += 1
            pos[n] = (x, -depth)
            return x
        a = lay(t.children_left[n], depth + 1)
        b = lay(t.children_right[n], depth + 1)
        x = (a + b) / 2.0
        pos[n] = (x, -depth)
        return x
    lay(0, 0)
    for n, (x, y) in pos.items():
        if t.children_left[n] != -1:
            for c in (t.children_left[n], t.children_right[n]):
                if c in pos:
                    plt.plot([x, pos[c][0]], [y, pos[c][1]], color='#9CA3AF', lw=1)
    for n, (x, y) in pos.items():
        parts = []
        if t.children_left[n] != -1 and not (max_depth is not None and -y == max_depth):
            parts.append('%s <= %s' % (names[t.feature[n]], round(float(t.threshold[n]), 2)))
        if impurity:
            parts.append('%s=%s' % ('gini' if clf and decision_tree.criterion == 'gini' else ('entropy' if clf else 'mse'), round(float(t.impurity[n]), 2)))
        parts.append('n=%d' % t.n_node_samples[n])
        if clf:
            idx = int(np.argmax(t.value[n][0]))
            parts.append('→ %s' % (class_names[idx] if class_names is not None else decision_tree.classes_[idx]))
        else:
            parts.append('→ %.2f' % t.value[n][0][0])
        plt.text(x, y, '\n'.join(parts), fontsize=fontsize or 7, ha='center')
    plt.axis('off')
    return []
