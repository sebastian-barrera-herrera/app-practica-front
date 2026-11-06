import warnings
import numpy as np
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.datasets import load_iris, make_moons
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

warnings.simplefilter("ignore")
X, y = load_iris(return_X_y=True)
Xs = StandardScaler().fit_transform(X)
Xtr, Xte, ytr, yte = train_test_split(Xs, y, test_size=0.3, random_state=0, stratify=y)
m1 = MLPClassifier(hidden_layer_sizes=(5,), max_iter=1, random_state=0).fit(Xtr, ytr)
print(m1.coefs_[0][0].round(6), m1.intercepts_[1].round(6), m1.n_iter_, round(m1.loss_, 6), m1.n_layers_, m1.out_activation_, m1.classes_)
m2 = MLPClassifier(hidden_layer_sizes=(5,), max_iter=5, random_state=0).fit(Xtr, ytr)
print(m2.coefs_[1].round(5), [float(round(v, 5)) for v in m2.loss_curve_], m2.t_)
m3 = MLPClassifier(hidden_layer_sizes=(10, 6), max_iter=400, random_state=3).fit(Xtr, ytr)
print(m3.n_iter_, round(m3.loss_, 3), round(m3.score(Xte, yte), 4), [c.shape for c in m3.coefs_], m3.predict(Xte[:8]))
print(m3.predict_proba(Xte[:2]).round(3).tolist(), len(m3.loss_curve_), round(m3.best_loss_, 3))
print(m3)
ms = MLPClassifier(hidden_layer_sizes=(6,), solver="sgd", learning_rate_init=0.05, max_iter=60, random_state=1, momentum=0.9).fit(Xtr, ytr)
print(ms.n_iter_, round(ms.loss_, 4), round(ms.score(Xte, yte), 4), ms.coefs_[0][0, :3].round(5))
mt = MLPClassifier(hidden_layer_sizes=(4,), activation="tanh", solver="sgd", learning_rate="adaptive", learning_rate_init=0.1, max_iter=30, random_state=2, nesterovs_momentum=False).fit(Xtr, ytr)
print(mt.n_iter_, round(mt.loss_, 4), mt.coefs_[1].round(4)[:2])
ml = MLPClassifier(hidden_layer_sizes=(4,), activation="logistic", max_iter=50, random_state=0, batch_size=16, alpha=0.01).fit(Xtr, ytr)
print(ml.n_iter_, round(ml.loss_, 4), ml.coefs_[0][1].round(5))
me = MLPClassifier(hidden_layer_sizes=(8,), early_stopping=True, max_iter=300, random_state=5).fit(Xtr, ytr)
print(me.n_iter_, round(me.best_validation_score_, 4), len(me.validation_scores_), me.validation_scores_[:3])
Xm, ym = make_moons(n_samples=200, noise=0.25, random_state=4)
mb = MLPClassifier(hidden_layer_sizes=(10,), max_iter=300, random_state=1).fit(Xm, ym)
print(mb.out_activation_, mb.n_outputs_, round(mb.score(Xm, ym), 4), mb.predict_proba(Xm[:2]).round(3).tolist(), round(mb.loss_, 4))
mp = MLPClassifier(hidden_layer_sizes=(5,), random_state=0)
for _ in range(3):
    mp.partial_fit(Xtr, ytr, classes=np.unique(ytr))
print(mp.t_, mp.n_iter_, round(mp.loss_, 5))
rng = np.random.RandomState(0)
xr = rng.uniform(-3, 3, (150, 1))
yr = np.sin(xr).ravel() + 0.1 * rng.randn(150)
mr = MLPRegressor(hidden_layer_sizes=(20,), max_iter=500, random_state=0).fit(xr, yr)
print(mr.n_iter_, round(mr.loss_, 4), round(mr.score(xr, yr), 3), mr.predict(np.array([[0.0], [1.5]])).round(2), mr.out_activation_)
mr1 = MLPRegressor(hidden_layer_sizes=(3,), max_iter=2, random_state=1).fit(xr, yr)
print(mr1.coefs_[0].round(6), mr1.intercepts_[1].round(6), [float(round(v, 6)) for v in mr1.loss_curve_])
ml2 = MLPClassifier(hidden_layer_sizes=(6,), solver="lbfgs", max_iter=300, random_state=0).fit(Xtr, ytr)
print(ml2.score(Xte, yte) > 0.9, ml2.solver, ml2.coefs_[0].shape)
