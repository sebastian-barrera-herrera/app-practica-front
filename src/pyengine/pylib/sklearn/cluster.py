from sklearn.utils._param_validation import check_interval
import math
import numpy as np

from sklearn.base import BaseEstimator, ClusterMixin, TransformerMixin, check_is_fitted
from sklearn.utils import check_array, check_random_state, _to_array

MAX_INT = np.iinfo(np.int32).max


def _sq_dists(A, B):
    return ((A[:, None, :] - B[None, :, :]) ** 2).sum(axis=2)


def _kmeans_plusplus(X, n_clusters, sample_weight, random_state, n_local_trials=None):
    n, d = X.shape
    centers = np.empty((n_clusters, d))
    if n_local_trials is None:
        n_local_trials = 2 + int(np.log(n_clusters))
    center_id = random_state.choice(n, p=sample_weight / sample_weight.sum())
    indices = np.full(n_clusters, -1, dtype=int)
    centers[0] = X[center_id]
    indices[0] = center_id
    closest = _sq_dists(centers[0:1], X)[0]
    current_pot = closest @ sample_weight
    for c in range(1, n_clusters):
        rand_vals = random_state.uniform(size=n_local_trials) * current_pot
        cand = np.searchsorted(np.cumsum(sample_weight * closest), rand_vals)
        cand = np.clip(cand, None, closest.size - 1)
        dc = _sq_dists(X[cand], X)
        dc = np.minimum(closest, dc)
        pots = dc @ sample_weight
        best = int(np.argmin(pots))
        current_pot = pots[best]
        closest = dc[best]
        centers[c] = X[cand[best]]
        indices[c] = cand[best]
    return centers, indices


def kmeans_plusplus(X, n_clusters, *, sample_weight=None, x_squared_norms=None, random_state=None, n_local_trials=None):
    X = check_array(X)
    sw = np.ones(X.shape[0]) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
    return _kmeans_plusplus(X, n_clusters, sw, check_random_state(random_state), n_local_trials)


def _lloyd(X, sw, centers, max_iter, tol):
    k = centers.shape[0]
    labels = np.full(X.shape[0], -1)
    labels_old = labels.copy()
    strict = False
    for i in range(max_iter):
        D = _sq_dists(X, centers)
        labels = np.argmin(D, axis=1)
        new = np.zeros_like(centers)
        w_in = np.zeros(k)
        for c in range(k):
            m = labels == c
            w_in[c] = sw[m].sum()
            if w_in[c] > 0:
                new[c] = (X[m] * sw[m][:, None]).sum(axis=0) / w_in[c]
        empty = np.where(w_in == 0)[0]
        if len(empty):
            far = np.argsort(D[np.arange(len(X)), labels])[::-1]
            for j, e in enumerate(empty):
                p = far[j]
                new[e] = X[p]
                labels[p] = e
        shift = np.sqrt(((new - centers) ** 2).sum(axis=1))
        centers = new
        if np.array_equal(labels, labels_old):
            strict = True
            break
        if (shift ** 2).sum() <= tol:
            break
        labels_old = labels.copy()
    if not strict:
        D = _sq_dists(X, centers)
        labels = np.argmin(D, axis=1)
    inertia = float((sw * _sq_dists(X, centers)[np.arange(len(X)), labels]).sum())
    return labels, inertia, centers, i + 1


class KMeans(ClusterMixin, TransformerMixin, BaseEstimator):
    def __init__(self, n_clusters=8, *, init='k-means++', n_init='auto', max_iter=300, tol=1e-4, verbose=0, random_state=None, copy_x=True, algorithm='lloyd'):
        self.n_clusters = n_clusters
        self.init = init
        self.n_init = n_init
        self.max_iter = max_iter
        self.tol = tol
        self.verbose = verbose
        self.random_state = random_state
        self.copy_x = copy_x
        self.algorithm = algorithm

    def fit(self, X, y=None, sample_weight=None):
        check_interval(self, 'n_clusters', self.n_clusters, int, 1, None, 'left')
        X = self._validate_data(X).astype(np.float64)
        n = X.shape[0]
        if n < self.n_clusters:
            raise ValueError('n_samples=%d should be >= n_clusters=%d.' % (n, self.n_clusters))
        rs = check_random_state(self.random_state)
        sw = np.ones(n) if sample_weight is None else np.asarray(sample_weight, dtype=np.float64)
        tol = float(np.mean(np.var(X, axis=0)) * self.tol) if self.tol > 0 else 0.0
        n_init = self.n_init
        init_array = not isinstance(self.init, str) and not callable(self.init)
        if n_init == 'auto':
            n_init = 1 if (self.init == 'k-means++' or init_array) else 10
        if init_array:
            n_init = 1
        Xm = X.mean(axis=0)
        Xc = X - Xm
        best = None
        for _ in range(n_init):
            if init_array:
                c0 = np.asarray(self.init, dtype=np.float64) - Xm
            elif self.init == 'k-means++':
                c0, _i = _kmeans_plusplus(Xc, self.n_clusters, sw, rs)
            elif self.init == 'random':
                seeds = rs.choice(n, size=self.n_clusters, replace=False, p=sw / sw.sum())
                c0 = Xc[seeds]
            else:
                c0 = np.asarray(self.init(Xc, self.n_clusters, random_state=rs))
            labels, inertia, centers, n_iter = _lloyd(Xc, sw, c0.copy(), self.max_iter, tol)
            if best is None or (inertia < best[1] and len(set(labels.tolist())) >= 1 and not _same_clustering(labels, best[0], self.n_clusters)):
                best = (labels, inertia, centers, n_iter)
        labels, inertia, centers, n_iter = best
        self.cluster_centers_ = centers + Xm
        self.labels_ = labels
        self.inertia_ = inertia
        self.n_iter_ = n_iter
        return self

    def predict(self, X):
        check_is_fitted(self)
        X = self._validate_data(X, reset=False)
        return np.argmin(_sq_dists(X, self.cluster_centers_), axis=1)

    def transform(self, X):
        X = self._validate_data(X, reset=False)
        return np.sqrt(_sq_dists(X, self.cluster_centers_))

    def fit_transform(self, X, y=None, sample_weight=None):
        return self.fit(X, sample_weight=sample_weight).transform(X)

    def score(self, X, y=None, sample_weight=None):
        X = self._validate_data(X, reset=False)
        return -float(_sq_dists(X, self.cluster_centers_).min(axis=1).sum())

    def get_feature_names_out(self, input_features=None):
        return np.array(['kmeans%d' % i for i in range(self.n_clusters)])


def _same_clustering(l1, l2, k):
    m = {}
    for a, b in zip(l1.tolist(), l2.tolist()):
        if m.setdefault(a, b) != b:
            return False
    return len(set(m.values())) == len(m)


class MiniBatchKMeans(KMeans):
    """Aproximación: usa k-means completo (suficiente para datos pequeños)."""

    def __init__(self, n_clusters=8, *, init='k-means++', max_iter=100, batch_size=1024, verbose=0, compute_labels=True, random_state=None, tol=0.0, max_no_improvement=10, init_size=None, n_init='auto', reassignment_ratio=0.01):
        super().__init__(n_clusters=n_clusters, init=init, n_init=n_init, max_iter=max_iter, random_state=random_state)
        self.batch_size = batch_size


class DBSCAN(ClusterMixin, BaseEstimator):
    def __init__(self, *, eps=0.5, min_samples=5, metric='euclidean', metric_params=None, algorithm='auto', leaf_size=30, p=None, n_jobs=None):
        self.eps = eps
        self.min_samples = min_samples
        self.metric = metric
        self.metric_params = metric_params
        self.algorithm = algorithm
        self.leaf_size = leaf_size
        self.p = p
        self.n_jobs = n_jobs

    def fit(self, X, y=None, sample_weight=None):
        from sklearn.neighbors import _dist
        X = self._validate_data(X)
        n = X.shape[0]
        D = _dist(X, X, self.metric, self.p or 2)
        neigh = [np.where(D[i] <= self.eps)[0] for i in range(n)]
        core = np.array([len(nb) >= self.min_samples for nb in neigh])
        labels = np.full(n, -1)
        cid = 0
        for i in range(n):
            if labels[i] != -1 or not core[i]:
                continue
            labels[i] = cid
            stack = [i]
            while stack:
                j = stack.pop()
                if not core[j]:
                    continue
                for nb in neigh[j]:
                    if labels[nb] == -1:
                        labels[nb] = cid
                        stack.append(nb)
            cid += 1
        self.labels_ = labels
        self.core_sample_indices_ = np.where(core)[0]
        self.components_ = X[self.core_sample_indices_]
        return self


class AgglomerativeClustering(ClusterMixin, BaseEstimator):
    def __init__(self, n_clusters=2, *, metric='euclidean', memory=None, connectivity=None, compute_full_tree='auto', linkage='ward', distance_threshold=None, compute_distances=False):
        self.n_clusters = n_clusters
        self.metric = metric
        self.memory = memory
        self.connectivity = connectivity
        self.compute_full_tree = compute_full_tree
        self.linkage = linkage
        self.distance_threshold = distance_threshold
        self.compute_distances = compute_distances

    def fit(self, X, y=None):
        import _mlkern
        X = self._validate_data(X)
        n = X.shape[0]
        D = np.sqrt(_sq_dists(X, X))
        if self.linkage == 'ward':
            D = D ** 2
        ma, mb, md, ms = _mlkern.agglomerate(D, self.linkage)
        merges = list(zip(ma.tolist(), mb.tolist(), md.tolist(), ms.tolist()))
        self.children_ = np.array([[m[0], m[1]] for m in merges])
        self.distances_ = np.array([m[2] for m in merges])
        self.n_leaves_ = n
        self.n_connected_components_ = 1
        if self.distance_threshold is not None:
            self.n_clusters_ = int(np.count_nonzero(self.distances_ >= self.distance_threshold)) + 1
        else:
            self.n_clusters_ = self.n_clusters
        self.labels_ = _hc_cut(self.n_clusters_, self.children_, n)
        return self


def _hc_cut(n_clusters, children, n_leaves):
    import heapq
    if n_clusters > n_leaves:
        raise ValueError('Cannot extract more clusters than samples: %d clusters were given for a tree with %d leaves.' % (n_clusters, n_leaves))
    nodes = [-(int(max(children[-1])) + 1)]
    for _ in range(n_clusters - 1):
        these_children = children[-nodes[0] - n_leaves]
        heapq.heappush(nodes, -int(these_children[0]))
        heapq.heappushpop(nodes, -int(these_children[1]))
    label = np.zeros(n_leaves, dtype=int)
    for i, node in enumerate(nodes):
        ind = [-node]
        while ind:
            k = ind.pop()
            if k < n_leaves:
                label[k] = i
            else:
                ind.extend([int(v) for v in children[k - n_leaves]])
    return label


class AffinityPropagation(ClusterMixin, BaseEstimator):
    def __init__(self, *a, **k):
        raise NotImplementedError('AffinityPropagation no está disponible en esta versión en miniatura')
