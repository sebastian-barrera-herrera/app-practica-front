import numpy as np
from sklearn.datasets import load_iris, load_wine, load_diabetes, load_breast_cancer, make_moons
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor, export_text
from sklearn.model_selection import train_test_split

X, y = load_iris(return_X_y=True)
iris = load_iris()
t = DecisionTreeClassifier(random_state=0).fit(X, y)
print(t.get_depth(), t.get_n_leaves(), t.tree_.node_count, t.score(X, y))
print(export_text(t, feature_names=list(iris.feature_names)))
print(t.feature_importances_.round(4))
t2 = DecisionTreeClassifier(max_depth=2, random_state=1).fit(X, y)
print(export_text(t2, feature_names=list(iris.feature_names), show_weights=True))
print(t2.tree_.threshold, t2.tree_.feature, t2.tree_.impurity.round(4), t2.tree_.n_node_samples)
print(t2.predict_proba(X[[0, 60, 120]]).round(3), t2.predict(X[[0, 60, 120]]))
print(t2)
for seed in range(4):
    print(seed, export_text(DecisionTreeClassifier(max_depth=3, random_state=seed).fit(X, y), max_depth=1).splitlines()[:3])

Xw, yw = load_wine(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(Xw, yw, test_size=0.3, random_state=42)
for crit in ("gini", "entropy"):
    w = DecisionTreeClassifier(criterion=crit, random_state=42).fit(Xtr, ytr)
    print(crit, w.get_depth(), w.get_n_leaves(), round(w.score(Xte, yte), 6), w.feature_importances_.round(3))
w = DecisionTreeClassifier(min_samples_leaf=5, random_state=0).fit(Xtr, ytr)
print(w.get_depth(), w.get_n_leaves(), round(w.score(Xte, yte), 6))
w = DecisionTreeClassifier(max_features="sqrt", random_state=3).fit(Xtr, ytr)
print(w.get_depth(), w.get_n_leaves(), round(w.score(Xte, yte), 6))
w = DecisionTreeClassifier(class_weight="balanced", random_state=0, max_depth=3).fit(Xtr, ytr)
print(round(w.score(Xte, yte), 6), w.tree_.value[0].round(4))

Xd, yd = load_diabetes(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(Xd, yd, test_size=0.25, random_state=0)
r = DecisionTreeRegressor(max_depth=3, random_state=0).fit(Xtr, ytr)
print(r.get_n_leaves(), round(r.score(Xte, yte), 6), r.tree_.threshold.round(4), r.tree_.value.ravel().round(2))
print(export_text(r, feature_names=list(load_diabetes().feature_names)))
r2 = DecisionTreeRegressor(random_state=0).fit(Xtr, ytr)
print(r2.get_depth(), r2.get_n_leaves(), round(r2.score(Xte, yte), 6))
Xm, ym = make_moons(200, noise=0.3, random_state=0)
m = DecisionTreeClassifier(max_depth=4, random_state=0).fit(Xm, ym)
print(round(m.score(Xm, ym), 4), m.tree_.node_count)
Xb, yb = load_breast_cancer(return_X_y=True)
b = DecisionTreeClassifier(random_state=0, max_depth=5).fit(Xb, yb)
print(b.get_n_leaves(), round(b.score(Xb, yb), 5), b.feature_importances_.argmax())
