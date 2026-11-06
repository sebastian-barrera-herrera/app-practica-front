import numpy as np
from sklearn.svm import SVC, SVR
from sklearn.datasets import load_iris, make_blobs, make_moons, make_circles
from sklearn.model_selection import train_test_split, GridSearchCV, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

rng = np.random.RandomState(0)
X = rng.randn(12, 2)
y = np.array([1, 1, 0, 2, 0, 2, 1, 0, 2, 1, 0, 2])
X[y == 1] += [2, 0]
X[y == 2] += [0, 2]
m = SVC(kernel="linear", C=1.0).fit(X, y)
print(m.classes_, m.n_support_, m.support_, m.dual_coef_.round(4), m.intercept_.round(4), m.n_iter_)
print(m.coef_.round(4), m.decision_function(X[:3]).round(4), m.predict(X))
yb = np.array([1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1])
mb = SVC(kernel="linear").fit(X, yb)
print(mb.support_, mb.dual_coef_.round(4), mb.intercept_.round(4), mb.n_support_, mb.coef_.round(4))
print(mb.decision_function(X[:3]).round(4), mb.predict(X[:3]), mb.score(X, yb))
print(SVC(decision_function_shape="ovo", kernel="linear").fit(X, y).decision_function(X[:2]).round(4))

Xi, yi = load_iris(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(Xi, yi, test_size=0.3, random_state=0, stratify=yi)
for kern in ("linear", "rbf", "poly", "sigmoid"):
    s = SVC(kernel=kern).fit(Xtr, ytr)
    print(kern, round(s.score(Xte, yte), 4), s.n_support_, s.support_[:5], round(s._gamma, 6))
s = SVC(C=10, gamma=0.1).fit(Xtr, ytr)
print(s, s.dual_coef_.shape, s.dual_coef_[:, :3].round(3), s.intercept_.round(4))
print(s.decision_function(Xte[:2]).round(4), s.predict(Xte[:6]))
print(SVC(kernel="rbf", gamma="auto", C=0.5).fit(Xtr, ytr).score(Xte, yte), SVC(class_weight="balanced").fit(Xtr, ytr).n_support_)
pipe = make_pipeline(StandardScaler(), SVC(C=1.0))
print(cross_val_score(pipe, Xi, yi, cv=5).round(4))
gs = GridSearchCV(SVC(), {"C": [0.1, 1, 10], "kernel": ["linear", "rbf"]}, cv=3)
gs.fit(Xi, yi)
print(gs.best_params_, round(gs.best_score_, 4), gs.cv_results_["mean_test_score"].round(4))
Xm, ym = make_moons(n_samples=120, noise=0.2, random_state=1)
sm = SVC(kernel="rbf", gamma=2.0, C=1.0).fit(Xm, ym)
print(sm.n_support_, round(sm.score(Xm, ym), 4), sm.decision_function(Xm[:4]).round(4), sm.intercept_.round(4))
Xc, yc = make_circles(n_samples=80, noise=0.1, factor=0.4, random_state=2)
print(SVC(kernel="linear").fit(Xc, yc).score(Xc, yc), SVC(kernel="rbf").fit(Xc, yc).score(Xc, yc), SVC(kernel="poly", degree=2, coef0=1).fit(Xc, yc).score(Xc, yc))

xs = np.linspace(0, 6, 40).reshape(-1, 1)
ys = np.sin(xs).ravel() + 0.1 * np.cos(7 * xs).ravel()
r = SVR(kernel="rbf", C=10, epsilon=0.05, gamma=1.0).fit(xs, ys)
print(r, r.support_.shape, r.dual_coef_.shape, r.intercept_.round(2), round(r.score(xs, ys), 3), r.predict(xs[:4]).round(2))
rl = SVR(kernel="linear", C=1.0, epsilon=0.2).fit(xs, ys)
print(rl.coef_.round(5), rl.intercept_.round(5), rl.n_support_)
print(SVR(kernel="poly", degree=3, C=5, gamma="auto").fit(xs, ys).predict(xs[:3]).round(4))
import warnings
warnings.simplefilter("ignore")
sp = SVC(probability=True, random_state=0).fit(Xtr, ytr)
print(sp.predict_proba(Xte[:2]).sum(axis=1).round(6), sp.predict(Xte[:3]))
