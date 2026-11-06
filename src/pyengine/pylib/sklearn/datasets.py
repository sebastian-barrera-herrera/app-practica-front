import numbers
import numpy as np

from sklearn.utils import Bunch, check_random_state, shuffle as util_shuffle, sample_without_replacement, _to_array
from sklearn import _data as _d


def _mat(text, ncols):
    vals = [float(x) for x in text.replace(';', ' ').split()]
    return np.array(vals).reshape(-1, ncols)


def _vec(text, dtype=int):
    return np.array([dtype(x) for x in text.split()])


def _frame(data, target, feature_names, target_name='target'):
    import pandas as pd
    X = pd.DataFrame(data, columns=list(feature_names))
    y = pd.Series(target, name=target_name)
    both = pd.concat([X, y], axis=1)
    return X, y, both


def _bunch(data, target, feature_names, target_names, descr, as_frame, return_X_y, target_name='target', frame_target=None):
    if as_frame:
        X, y, frame = _frame(data, target, feature_names, target_name)
        if return_X_y:
            return X, y
        return Bunch(data=X, target=y, frame=frame, target_names=target_names, DESCR=descr, feature_names=list(feature_names))
    if return_X_y:
        return data, target
    return Bunch(data=data, target=target, frame=None, target_names=target_names, DESCR=descr, feature_names=list(feature_names))


def load_iris(*, return_X_y=False, as_frame=False):
    descr = '.. _iris_dataset:\n\nIris plants dataset\n--------------------\n\n**Data Set Characteristics:**\n\n:Number of Instances: 150 (50 in each of three classes)\n:Number of Attributes: 4 numeric, predictive attributes and the class\n:Attribute Information:\n    - sepal length in cm\n    - sepal width in cm\n    - petal length in cm\n    - petal width in cm\n    - class: Iris-Setosa, Iris-Versicolour, Iris-Virginica\n'
    return _bunch(_mat(_d.IRIS_X, 4), _vec(_d.IRIS_Y), _d.IRIS_FEATURES, np.array(_d.IRIS_TARGETS), descr, as_frame, return_X_y)


def load_wine(*, return_X_y=False, as_frame=False):
    descr = '.. _wine_dataset:\n\nWine recognition dataset\n------------------------\n\n**Data Set Characteristics:**\n\n:Number of Instances: 178\n:Number of Attributes: 13 numeric, predictive attributes and the class\n:Classes: class_0, class_1, class_2 (cultivars de vino)\n'
    return _bunch(_mat(_d.WINE_X, 13), _vec(_d.WINE_Y), _d.WINE_FEATURES, np.array(_d.WINE_TARGETS), descr, as_frame, return_X_y)


def load_breast_cancer(*, return_X_y=False, as_frame=False):
    descr = '.. _breast_cancer_dataset:\n\nBreast cancer wisconsin (diagnostic) dataset\n--------------------------------------------\n\n**Data Set Characteristics:**\n\n:Number of Instances: 569\n:Number of Attributes: 30 numeric, predictive attributes and the class\n:Class Distribution: 212 - Malignant, 357 - Benign\n'
    return _bunch(_mat(_d.BC_X, 30), _vec(_d.BC_Y), _d.BC_FEATURES, np.array(_d.BC_TARGETS), descr, as_frame, return_X_y)


def load_diabetes(*, return_X_y=False, as_frame=False, scaled=True):
    descr = '.. _diabetes_dataset:\n\nDiabetes dataset\n----------------\n\n**Data Set Characteristics:**\n\n:Number of Instances: 442\n:Number of Attributes: First 10 columns are numeric predictive values\n:Target: Column 11 is a quantitative measure of disease progression one year after baseline\n'
    return _bunch(_mat(_d.DIA_X, 10), np.array([float(v) for v in _d.DIA_Y.split()]), _d.DIA_FEATURES, None, descr, as_frame, return_X_y)


def load_digits(*, n_class=10, return_X_y=False, as_frame=False):
    chars = '0123456789abcdefg'
    X = np.array([chars.index(c) for c in _d.DIGITS_X], dtype=float).reshape(-1, 64)
    y = _vec(_d.DIGITS_Y)
    if n_class < 10:
        m = y < n_class
        X, y = X[m], y[m]
    names = ['pixel_%d_%d' % (i, j) for i in range(8) for j in range(8)]
    descr = '.. _digits_dataset:\n\nOptical recognition of handwritten digits dataset\n--------------------------------------------------\n\n**Data Set Characteristics:**\n\n:Number of Instances: 1797\n:Number of Attributes: 64 (imágenes de 8x8 píxeles con valores de 0 a 16)\n:Classes: 10 (dígitos 0 a 9)\n'
    out = _bunch(X, y, names, np.arange(10), descr, as_frame, return_X_y)
    if not return_X_y and not as_frame:
        out['images'] = X.reshape(-1, 8, 8)
    return out


# ───────────────────────── generadores ─────────────────────────

def make_blobs(n_samples=100, n_features=2, *, centers=None, cluster_std=1.0, center_box=(-10.0, 10.0), shuffle=True, random_state=None, return_centers=False):
    generator = check_random_state(random_state)
    if isinstance(n_samples, numbers.Integral):
        if centers is None:
            centers = 3
        if isinstance(centers, numbers.Integral):
            n_centers = centers
            centers = generator.uniform(center_box[0], center_box[1], size=(n_centers, n_features))
        else:
            centers = np.asarray(centers, dtype=float)
            n_features = centers.shape[1]
            n_centers = centers.shape[0]
    else:
        n_centers = len(n_samples)
        if centers is None:
            centers = generator.uniform(center_box[0], center_box[1], size=(n_centers, n_features))
        centers = np.asarray(centers, dtype=float)
        n_features = centers.shape[1]
    if hasattr(cluster_std, '__len__') and len(cluster_std) != n_centers:
        raise ValueError('Length of `clusters_std` not consistent with number of centers. Got centers = {} and cluster_std = {}'.format(centers, cluster_std))
    if isinstance(cluster_std, numbers.Real):
        cluster_std = np.full(len(centers), cluster_std)
    if isinstance(n_samples, numbers.Integral):
        n_samples_per_center = [int(n_samples // n_centers)] * n_centers
        for i in range(n_samples % n_centers):
            n_samples_per_center[i] += 1
    else:
        n_samples_per_center = list(n_samples)
    cum = np.cumsum(n_samples_per_center)
    X = np.empty(shape=(sum(n_samples_per_center), n_features), dtype=np.float64)
    y = np.empty(shape=(sum(n_samples_per_center),), dtype=int)
    for i, (n, std) in enumerate(zip(n_samples_per_center, cluster_std)):
        start_idx = cum[i - 1] if i > 0 else 0
        end_idx = cum[i]
        X[start_idx:end_idx] = generator.normal(loc=centers[i], scale=std, size=(n, n_features))
        y[start_idx:end_idx] = i
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
    if return_centers:
        return X, y, centers
    return X, y


def make_moons(n_samples=100, *, shuffle=True, noise=None, random_state=None):
    if isinstance(n_samples, numbers.Integral):
        n_out = n_samples // 2
        n_in = n_samples - n_out
    else:
        n_out, n_in = n_samples
    generator = check_random_state(random_state)
    ox = np.cos(np.linspace(0, np.pi, n_out))
    oy = np.sin(np.linspace(0, np.pi, n_out))
    ix = 1 - np.cos(np.linspace(0, np.pi, n_in))
    iy = 1 - np.sin(np.linspace(0, np.pi, n_in)) - 0.5
    X = np.vstack([np.append(ox, ix), np.append(oy, iy)]).T
    y = np.hstack([np.zeros(n_out, dtype=np.intp), np.ones(n_in, dtype=np.intp)])
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
    if noise is not None:
        X += generator.normal(scale=noise, size=X.shape)
    return X, y


def make_circles(n_samples=100, *, shuffle=True, noise=None, random_state=None, factor=0.8):
    if isinstance(n_samples, numbers.Integral):
        n_out = n_samples // 2
        n_in = n_samples - n_out
    else:
        n_out, n_in = n_samples
    generator = check_random_state(random_state)
    lo = np.linspace(0, 2 * np.pi, n_out, endpoint=False)
    li = np.linspace(0, 2 * np.pi, n_in, endpoint=False)
    X = np.vstack([np.append(np.cos(lo), np.cos(li) * factor), np.append(np.sin(lo), np.sin(li) * factor)]).T
    y = np.hstack([np.zeros(n_out, dtype=np.intp), np.ones(n_in, dtype=np.intp)])
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
    if noise is not None:
        X += generator.normal(scale=noise, size=X.shape)
    return X, y


def _generate_hypercube(samples, dimensions, rng):
    if dimensions > 30:
        return np.hstack([rng.randint(2, size=(samples, dimensions - 30)), _generate_hypercube(samples, 30, rng)])
    vals = sample_without_replacement(2 ** dimensions, samples, random_state=rng)
    return np.array([[(int(v) >> (dimensions - 1 - k)) & 1 for k in range(dimensions)] for v in vals])


def make_classification(n_samples=100, n_features=20, *, n_informative=2, n_redundant=2, n_repeated=0, n_classes=2, n_clusters_per_class=2, weights=None, flip_y=0.01, class_sep=1.0, hypercube=True, shift=0.0, scale=1.0, shuffle=True, random_state=None, return_X_y=True):
    generator = check_random_state(random_state)
    if n_informative + n_redundant + n_repeated > n_features:
        raise ValueError('Number of informative, redundant and repeated features must sum to less than the number of total features')
    if n_informative < np.log2(n_classes * n_clusters_per_class):
        raise ValueError('n_classes({}) * n_clusters_per_class({}) must be smaller or equal 2**n_informative({})={}'.format(n_classes, n_clusters_per_class, n_informative, 2 ** n_informative))
    if weights is not None:
        if len(weights) not in [n_classes, n_classes - 1]:
            raise ValueError('Weights specified but incompatible with number of classes.')
        if len(weights) == n_classes - 1:
            weights_ = list(weights) + [1.0 - sum(weights)]
        else:
            weights_ = list(weights)
    else:
        weights_ = [1.0 / n_classes] * n_classes
    n_random = n_features - n_informative - n_redundant - n_repeated
    n_clusters = n_classes * n_clusters_per_class
    per = [int(n_samples * weights_[k % n_classes] / n_clusters_per_class) for k in range(n_clusters)]
    for i in range(n_samples - sum(per)):
        per[i % n_clusters] += 1
    X = np.zeros((n_samples, n_features))
    y = np.zeros(n_samples, dtype=int)
    centroids = _generate_hypercube(n_clusters, n_informative, generator).astype(float)
    centroids *= 2 * class_sep
    centroids -= class_sep
    if not hypercube:
        centroids *= generator.uniform(size=(n_clusters, 1))
        centroids *= generator.uniform(size=(1, n_informative))
    X[:, :n_informative] = generator.standard_normal(size=(n_samples, n_informative))
    stop = 0
    for k, centroid in enumerate(centroids):
        start, stop = stop, stop + per[k]
        y[start:stop] = k % n_classes
        X_k = X[start:stop, :n_informative]
        A = 2 * generator.uniform(size=(n_informative, n_informative)) - 1
        X[start:stop, :n_informative] = np.dot(X_k, A) + centroid
    if n_redundant > 0:
        B = 2 * generator.uniform(size=(n_informative, n_redundant)) - 1
        X[:, n_informative:n_informative + n_redundant] = np.dot(X[:, :n_informative], B)
    n = n_informative + n_redundant
    if n_repeated > 0:
        indices = ((n - 1) * generator.uniform(size=n_repeated) + 0.5).astype(np.intp)
        X[:, n:n + n_repeated] = X[:, indices]
    if n_random > 0:
        X[:, -n_random:] = generator.standard_normal(size=(n_samples, n_random))
    if flip_y >= 0.0:
        flip_mask = generator.uniform(size=n_samples) < flip_y
        y[flip_mask] = generator.randint(n_classes, size=flip_mask.sum())
    if shift is None:
        shift = (2 * generator.uniform(size=n_features) - 1) * class_sep
    X += shift
    if scale is None:
        scale = 1 + 100 * generator.uniform(size=n_features)
    X *= scale
    indices = np.arange(n_features)
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
        generator.shuffle(indices)
        X[:, :] = X[:, indices]
    return X, y


def make_regression(n_samples=100, n_features=100, *, n_informative=10, n_targets=1, bias=0.0, effective_rank=None, tail_strength=0.5, noise=0.0, shuffle=True, coef=False, random_state=None):
    n_informative = min(n_features, n_informative)
    generator = check_random_state(random_state)
    X = generator.standard_normal(size=(n_samples, n_features))
    ground_truth = np.zeros((n_features, n_targets))
    ground_truth[:n_informative, :] = 100 * generator.uniform(size=(n_informative, n_targets))
    y = np.dot(X, ground_truth) + bias
    if noise > 0.0:
        y += generator.normal(scale=noise, size=y.shape)
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
        indices = np.arange(n_features)
        generator.shuffle(indices)
        X[:, :] = X[:, indices]
        ground_truth = ground_truth[indices]
    y = np.squeeze(y)
    if coef:
        return X, y, np.squeeze(ground_truth)
    return X, y


def make_gaussian_quantiles(*, mean=None, cov=1.0, n_samples=100, n_features=2, n_classes=3, shuffle=True, random_state=None):
    generator = check_random_state(random_state)
    if mean is None:
        mean = np.zeros(n_features)
    else:
        mean = np.array(mean)
    X = generator.multivariate_normal(mean, cov * np.identity(n_features), (n_samples,))
    d2 = np.sum((X - mean) ** 2, axis=1)
    idx = np.argsort(d2)
    X = X[idx]
    y = np.zeros(n_samples, dtype=int)
    for k in range(n_classes):
        y[k * (n_samples // n_classes):] = k
    if shuffle:
        X, y = util_shuffle(X, y, random_state=generator)
    return X, y


def fetch_openml(*a, **k):
    raise OSError('fetch_openml necesita Internet: en Dev Dojo usa los conjuntos incluidos (load_iris, load_wine, load_digits…)')


fetch_california_housing = fetch_openml
fetch_20newsgroups = fetch_openml
