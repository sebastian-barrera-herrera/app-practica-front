import numpy as np
import pandas as pd
from scipy import stats
from sklearn.datasets import load_iris, load_wine, make_classification
from sklearn.model_selection import (cross_val_score, cross_validate, cross_val_predict, GridSearchCV, RandomizedSearchCV,
                                     ParameterGrid, ParameterSampler, learning_curve, validation_curve, KFold, StratifiedKFold,
                                     check_cv, train_test_split)
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.naive_bayes import GaussianNB
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, make_scorer, f1_score

X, y = load_iris(return_X_y=True)
knn = KNeighborsClassifier(n_neighbors=5)
s = cross_val_score(knn, X, y, cv=5)
print(s, s.mean().round(6), s.std().round(6))
print(cross_val_score(knn, X, y, cv=KFold(5, shuffle=True, random_state=0)).round(4))
print(cross_val_score(DecisionTreeClassifier(random_state=0), X, y, cv=StratifiedKFold(3, shuffle=True, random_state=1), scoring="accuracy").round(4))
print(cross_val_score(GaussianNB(), X, y, cv=4, scoring="f1_macro").round(4))
r = cross_validate(knn, X, y, cv=3, scoring=["accuracy", "f1_macro"], return_train_score=True)
print(sorted(r.keys()), r["test_accuracy"].round(4), r["train_f1_macro"].round(4))
print(cross_val_predict(knn, X, y, cv=5)[:12], accuracy_score(y, cross_val_predict(knn, X, y, cv=5)))
print(cross_val_predict(GaussianNB(), X, y, cv=3, method="predict_proba")[:2].round(4))
print(check_cv(5, y, classifier=True), check_cv(3, y, classifier=False), check_cv(None))

grid = ParameterGrid({"b": [1, 2], "a": ["x", "y", "z"]})
print(len(grid), list(grid)[:3], grid[4], grid[0])
print(len(ParameterGrid([{"a": [1, 2]}, {"b": [3, 4, 5]}])), list(ParameterGrid([{"a": [1, 2]}, {"b": [3, 4, 5]}]))[2:4])
print(list(ParameterSampler({"a": [1, 2, 3], "b": [10, 20]}, 4, random_state=0)))
print([(round(float(d["a"]), 6), d["b"], d["c"]) for d in ParameterSampler({"a": stats.uniform(0, 1), "b": [10, 20, 30], "c": stats.randint(1, 10)}, 3, random_state=2)])

gs = GridSearchCV(KNeighborsClassifier(), {"n_neighbors": [1, 3, 5, 9, 15], "weights": ["uniform", "distance"]}, cv=5)
gs.fit(X, y)
print(gs)
print(gs.best_params_, round(gs.best_score_, 6), gs.best_index_, gs.n_splits_)
print(gs.cv_results_["mean_test_score"].round(4), gs.cv_results_["rank_test_score"])
print(gs.cv_results_["params"][:2], sorted(k for k in gs.cv_results_ if "split" not in k))
print(gs.predict(X[:5]), round(gs.score(X, y), 4), gs.best_estimator_, gs.classes_)
df = pd.DataFrame(gs.cv_results_)
print(df.sort_values(["rank_test_score", "param_n_neighbors", "param_weights"])[["param_n_neighbors", "param_weights", "mean_test_score", "rank_test_score"]].head(3))
pipe = Pipeline([("sc", StandardScaler()), ("knn", KNeighborsClassifier())])
gp = GridSearchCV(pipe, {"knn__n_neighbors": [3, 7, 11], "sc__with_mean": [True, False]}, cv=4, scoring="accuracy", return_train_score=True, refit=True)
gp.fit(X, y)
print(gp.best_params_, round(gp.best_score_, 4), gp.cv_results_["mean_train_score"].round(3))
ms = GridSearchCV(DecisionTreeClassifier(random_state=0), {"max_depth": [1, 2, 3, 4]}, cv=5, scoring={"acc": "accuracy", "f1": "f1_macro"}, refit="acc")
ms.fit(X, y)
print(ms.best_params_, ms.cv_results_["mean_test_acc"].round(4), ms.cv_results_["rank_test_f1"], sorted(ms.cv_results_)[:6])
rs = RandomizedSearchCV(DecisionTreeClassifier(random_state=0), {"max_depth": stats.randint(1, 8), "min_samples_leaf": [1, 2, 4, 8], "criterion": ["gini", "entropy"]}, n_iter=6, cv=3, random_state=3)
rs.fit(X, y)
print(rs.best_params_, round(rs.best_score_, 4), [p for p in rs.cv_results_["params"]][:3])
print(rs.cv_results_["mean_test_score"].round(4))
gs2 = GridSearchCV(Ridge(), {"alpha": [0.01, 0.1, 1.0, 10.0]}, scoring="neg_mean_squared_error", cv=KFold(4, shuffle=True, random_state=0))
gs2.fit(X[:, :3], X[:, 3])
print(gs2.best_params_, round(gs2.best_score_, 6), gs2.cv_results_["mean_test_score"].round(5))
sizes, tr, te = learning_curve(KNeighborsClassifier(3), X, y, cv=4, train_sizes=[0.2, 0.5, 1.0])
print(sizes, tr.round(4), te.round(4))
tr, te = validation_curve(DecisionTreeClassifier(random_state=0), X, y, param_name="max_depth", param_range=[1, 2, 3], cv=3)
print(tr.round(4), te.round(4))
bad = GridSearchCV(KNeighborsClassifier(), {"n_neighbors": [0]}, cv=3)
try:
    bad.fit(X, y)
except ValueError as e:
    print("ValueError", str(e).splitlines()[1])
