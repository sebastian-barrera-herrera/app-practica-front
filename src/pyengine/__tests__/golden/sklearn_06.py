import numpy as np
from sklearn.datasets import load_iris, load_wine, make_blobs, load_digits
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor, NearestNeighbors
from sklearn.cluster import KMeans, DBSCAN, AgglomerativeClustering
from sklearn.decomposition import PCA
from sklearn.naive_bayes import GaussianNB, MultinomialNB
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import adjusted_rand_score

X, y = load_iris(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
for k in (1, 3, 7):
    kn = KNeighborsClassifier(n_neighbors=k).fit(Xtr, ytr)
    print(k, kn.score(Xte, yte), kn.predict(Xte[:6]))
kn = KNeighborsClassifier(n_neighbors=5, weights="distance").fit(Xtr, ytr)
print(kn.score(Xte, yte), kn.predict_proba(Xte[:3]).round(4))
print(KNeighborsClassifier(n_neighbors=4))
rs = np.random.RandomState(3)
Xr = rs.rand(80, 3)
yr = Xr @ np.array([1.0, -2.0, 0.5]) + rs.normal(0, 0.05, 80)
kr = KNeighborsRegressor(n_neighbors=3).fit(Xr[:60], yr[:60])
print(kr.predict(Xr[60:63]).round(4), round(kr.score(Xr[60:], yr[60:]), 6))
nn = NearestNeighbors(n_neighbors=3).fit(Xtr)
d, i = nn.kneighbors(Xte[:2])
print(d.round(4), i)

Xb, yb = make_blobs(n_samples=200, centers=4, cluster_std=1.0, random_state=7)
km = KMeans(n_clusters=4, random_state=0).fit(Xb)
print(km.cluster_centers_.round(4), km.inertia_.round(4), km.n_iter_, km.labels_[:10])
print(round(adjusted_rand_score(yb, km.labels_), 6))
km2 = KMeans(n_clusters=3, init="random", n_init=5, random_state=1).fit(X)
print(km2.cluster_centers_.round(3), round(km2.inertia_, 4), km2.labels_[:12], km2.predict(X[[0, 60, 120]]))
print(KMeans(n_clusters=3, random_state=0, n_init=10).fit(X).inertia_)
db = DBSCAN(eps=0.5, min_samples=5).fit(StandardScaler().fit_transform(X))
print(np.unique(db.labels_, return_counts=True), len(db.core_sample_indices_))
for link in ("ward", "average", "single", "complete"):
    ag = AgglomerativeClustering(n_clusters=3, linkage=link).fit(X)
    print(link, np.bincount(ag.labels_), round(adjusted_rand_score(y, ag.labels_), 4))

p = PCA(n_components=2).fit(X)
print(p.components_.round(4), p.explained_variance_.round(4), p.explained_variance_ratio_.round(5), p.mean_.round(4))
print(p.transform(X[:3]).round(4))
p3 = PCA().fit(load_wine().data)
print(p3.explained_variance_ratio_[:4].round(5), p3.singular_values_[:2].round(3))
print(PCA(n_components=0.95).fit(load_wine().data).n_components_)
pw = PCA(n_components=2, whiten=True).fit(X)
print(pw.transform(X[:2]).round(4), np.abs(p.inverse_transform(p.transform(X[:2])) - X[:2]).max().round(4))
dg = load_digits()
pd_ = PCA(n_components=5).fit(dg.data)
print(pd_.explained_variance_ratio_.round(4))

Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=1)
g = GaussianNB().fit(Xtr, ytr)
print(g.score(Xte, yte), g.theta_.round(3), g.var_.round(4), g.class_prior_, g.predict_proba(Xte[:2]).round(5))
Xc = np.array([[2, 1, 0], [0, 3, 1], [1, 0, 4], [3, 0, 0], [0, 2, 2]])
yc = np.array([0, 1, 2, 0, 1])
mn = MultinomialNB().fit(Xc, yc)
print(mn.predict(Xc), mn.feature_log_prob_.round(4), mn.predict_proba(np.array([[1, 1, 1]])).round(4))
