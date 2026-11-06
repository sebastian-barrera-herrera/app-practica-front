import numpy as np
from sklearn.datasets import load_iris, load_wine, make_blobs, make_moons, make_circles, make_classification, make_regression
from sklearn.model_selection import train_test_split, KFold, StratifiedKFold, ShuffleSplit
from sklearn.preprocessing import StandardScaler, MinMaxScaler, RobustScaler, OneHotEncoder, OrdinalEncoder, LabelEncoder, PolynomialFeatures, Normalizer
from sklearn.impute import SimpleImputer

iris = load_iris()
print(iris.data.shape, iris.target.shape, list(iris.feature_names), iris.target_names.tolist())
print(iris.data[:3])
print(round(float(iris.data.mean()), 6), int(iris.target.sum()))
w = load_wine()
print(w.data.shape, w.data[0].round(2))

X, y = iris.data, iris.target
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
print(Xtr.shape, Xte.shape, ytr[:10], yte[:10])
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
print(ytr[:12], yte[:12], np.bincount(yte))
a, b = train_test_split(list(range(10)), random_state=1)
print(a, b)
a, b = train_test_split(np.arange(10), shuffle=False, test_size=3)
print(a, b)

for tr, te in KFold(4).split(np.arange(10)):
    print(tr, te)
for tr, te in KFold(3, shuffle=True, random_state=1).split(np.arange(9)):
    print(tr, te)
for tr, te in StratifiedKFold(3, shuffle=True, random_state=0).split(X, y):
    print(te[:6], np.bincount(y[te]))

sc = StandardScaler().fit(Xtr)
print(sc.mean_.round(4), sc.scale_.round(4))
print(sc.transform(Xte[:2]).round(4))
print(MinMaxScaler().fit_transform(X)[:2].round(4))
print(RobustScaler().fit(X).center_, RobustScaler().fit(X).scale_)
print(StandardScaler())
print(MinMaxScaler(feature_range=(-1, 1)))

enc = OneHotEncoder(sparse_output=False)
C = np.array([["rojo"], ["azul"], ["rojo"], ["verde"]])
print(enc.fit_transform(C))
print(enc.categories_, enc.get_feature_names_out())
print(OneHotEncoder(drop="first", sparse_output=False).fit_transform(C))
print(OrdinalEncoder().fit_transform(C).ravel())
le = LabelEncoder()
print(le.fit_transform(["gato", "perro", "gato", "pez"]), le.classes_)
print(le.inverse_transform([2, 0]))
pf = PolynomialFeatures(2)
print(pf.fit_transform(np.array([[2.0, 3.0]])), pf.get_feature_names_out(["a", "b"]))
print(Normalizer().fit_transform(np.array([[3.0, 4.0], [1.0, 0.0]])))
imp = SimpleImputer(strategy="mean")
Xn = np.array([[1.0, np.nan], [3.0, 4.0], [np.nan, 8.0]])
print(imp.fit_transform(Xn), imp.statistics_)
print(SimpleImputer(strategy="median").fit_transform(Xn))

Xb, yb = make_blobs(n_samples=7, centers=3, random_state=0)
print(Xb.round(4), yb)
Xm, ym = make_moons(n_samples=6, noise=0.1, random_state=1)
print(Xm.round(4), ym)
Xc, yc = make_circles(n_samples=6, noise=0.05, factor=0.5, random_state=2)
print(Xc.round(4), yc)
Xk, yk = make_classification(n_samples=6, n_features=5, n_informative=3, n_redundant=1, random_state=3)
print(Xk.round(4), yk)
Xr, yr = make_regression(n_samples=5, n_features=3, noise=1.0, random_state=4)
print(Xr.round(4), yr.round(3))
