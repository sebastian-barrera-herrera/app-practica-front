from sklearn.metrics import cosine_similarity, euclidean_distances, manhattan_distances, pairwise_distances


def linear_kernel(X, Y=None):
    import numpy as np
    X = np.asarray(X, dtype=float)
    Y = X if Y is None else np.asarray(Y, dtype=float)
    return X @ Y.T


def rbf_kernel(X, Y=None, gamma=None):
    import numpy as np
    X = np.asarray(X, dtype=float)
    g = 1.0 / X.shape[1] if gamma is None else gamma
    return np.exp(-g * euclidean_distances(X, Y) ** 2)
