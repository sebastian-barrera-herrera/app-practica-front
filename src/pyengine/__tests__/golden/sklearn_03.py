import numpy as np
from sklearn.datasets import load_iris, load_diabetes, load_breast_cancer, make_regression
from sklearn.linear_model import LinearRegression, Ridge, Lasso, ElasticNet, LogisticRegression, RidgeCV
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, PolynomialFeatures

X, y = load_diabetes(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=0)
lr = LinearRegression().fit(Xtr, ytr)
print(lr.coef_.round(3), round(float(lr.intercept_), 3), round(lr.score(Xte, yte), 6))
print(lr)
r = Ridge(alpha=1.0).fit(Xtr, ytr)
print(r.coef_.round(3), round(float(r.intercept_), 3), round(r.score(Xte, yte), 6))
print(Ridge(alpha=10.0).fit(Xtr, ytr).coef_.round(3))
la = Lasso(alpha=0.5).fit(Xtr, ytr)
print(la.coef_.round(2), round(float(la.intercept_), 2), round(la.score(Xte, yte), 4), la.n_iter_)
print(ElasticNet(alpha=0.1, l1_ratio=0.5).fit(Xtr, ytr).coef_.round(2))
print(Lasso(alpha=0.5))
rcv = RidgeCV(alphas=[0.01, 0.1, 1.0, 10.0]).fit(Xtr, ytr)
print(rcv.alpha_)

x1 = np.linspace(0, 4, 9).reshape(-1, 1)
y1 = 3 * x1.ravel() - 2 + np.array([0.1, -0.2, 0.05, 0.0, 0.15, -0.1, 0.2, -0.05, 0.1])
m = LinearRegression().fit(x1, y1)
print(m.coef_.round(6), round(float(m.intercept_), 6), m.predict([[5.0]]).round(6), m.rank_)
P = PolynomialFeatures(2, include_bias=False).fit_transform(x1)
print(LinearRegression().fit(P, y1).coef_.round(4))

Xi, yi = load_iris(return_X_y=True)
clf = LogisticRegression(max_iter=1000).fit(Xi, yi)
print(clf.coef_.shape, clf.score(Xi, yi), clf.classes_)
print(clf.predict_proba(Xi[[0, 50, 100]]).round(1))
print(clf.predict(Xi[[0, 50, 100]]))
Xb, yb = load_breast_cancer(return_X_y=True)
Xs = StandardScaler().fit_transform(Xb)
cb = LogisticRegression().fit(Xs, yb)
print(cb.coef_[0][:5].round(1), cb.intercept_.round(1), round(cb.score(Xs, yb), 5))
print(cb.predict_proba(Xs[:3]).round(2))
print(LogisticRegression(C=0.01).fit(Xs, yb).coef_[0][:3].round(2))
print(LogisticRegression(class_weight="balanced").fit(Xs, yb).score(Xs, yb))
print(LogisticRegression(C=10.0))
