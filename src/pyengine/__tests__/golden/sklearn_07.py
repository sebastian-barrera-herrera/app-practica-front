import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline, make_pipeline, FeatureUnion, make_union
from sklearn.compose import ColumnTransformer, make_column_transformer, make_column_selector, TransformedTargetRegressor
from sklearn.preprocessing import StandardScaler, OneHotEncoder, MinMaxScaler, PolynomialFeatures, FunctionTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, LinearRegression, Ridge
from sklearn.decomposition import PCA
from sklearn.tree import DecisionTreeClassifier
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split

X, y = load_iris(return_X_y=True)
Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=0, stratify=y)
pipe = Pipeline([("scaler", StandardScaler()), ("clf", LogisticRegression(C=0.5, max_iter=200))])
print(pipe)
pipe.fit(Xtr, ytr)
print(round(pipe.score(Xte, yte), 4), pipe.predict(Xte[:5]), pipe.predict_proba(Xte[:2]).round(2))
print(pipe.named_steps["scaler"].mean_.round(4), pipe[0].scale_.round(4), len(pipe), pipe.classes_)
print(pipe["clf"].coef_.round(0))
print(list(pipe.named_steps), pipe[:1], pipe[-1])
print(sorted(pipe.get_params().keys()))
pipe.set_params(clf__C=10.0, scaler__with_std=False)
print(pipe.get_params()["clf__C"], pipe.named_steps["scaler"])
mp = make_pipeline(StandardScaler(), PCA(n_components=2), DecisionTreeClassifier(max_depth=3, random_state=0))
print(mp)
print([n for n, _ in mp.steps])
mp.fit(Xtr, ytr)
print(mp.score(Xte, yte), mp[:-1].transform(Xte[:2]).round(4))
print(mp.named_steps["pca"].explained_variance_ratio_.round(4))
mp2 = make_pipeline(StandardScaler(), StandardScaler(), LinearRegression())
print([n for n, _ in mp2.steps])
tp = Pipeline([("s", StandardScaler()), ("p", PCA(n_components=2))])
print(tp.fit_transform(Xtr)[:2].round(4), tp.transform(Xte[:2]).round(4), tp.inverse_transform(tp.transform(Xte[:1])).round(3))
print(hasattr(pipe, "predict"), hasattr(tp, "predict"), hasattr(tp, "transform"), hasattr(pipe, "transform"))
try:
    tp.predict(Xte)
except AttributeError as e:
    print("AttributeError", e)
print(Pipeline([("a", StandardScaler()), ("clf", Ridge(alpha=3.0))]).fit(Xtr, Xtr[:, 3]).predict(Xte[:3]).round(4))
fu = FeatureUnion([("pca", PCA(n_components=2)), ("mm", MinMaxScaler())])
print(fu.fit_transform(Xtr)[:2].round(4), fu.transform(Xte[:1]).shape, fu.get_feature_names_out())
print(make_union(StandardScaler(), PCA(n_components=1)))

df = pd.DataFrame({
    "edad": [25.0, 32.0, np.nan, 41.0, 29.0, 55.0, 38.0, 46.0],
    "sueldo": [30.0, 42.0, 39.0, np.nan, 35.0, 80.0, 51.0, 60.0],
    "ciudad": ["Madrid", "Lima", "Madrid", "Quito", "Lima", "Quito", "Madrid", "Lima"],
    "sexo": ["F", "M", "F", "M", "M", "F", "F", "M"],
})
yd = np.array([0, 0, 0, 1, 0, 1, 1, 1])
num = Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())])
cat = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
ct = ColumnTransformer([("num", num, ["edad", "sueldo"]), ("cat", cat, ["ciudad", "sexo"])])
print(ct)
Xt = ct.fit_transform(df)
print(Xt.shape, Xt[:3].round(3))
print(ct.get_feature_names_out())
print([list(c) for c in ct.named_transformers_["cat"].categories_], ct.n_features_in_, ct.feature_names_in_)
print([(n, type(t).__name__ if not isinstance(t, str) else t, c) for n, t, c in ct.transformers_])
print(ct.output_indices_)
print(ct.transform(df.iloc[:2]).round(3))
ct2 = ColumnTransformer([("num", StandardScaler(), [0, 1])], remainder="passthrough")
Xn = np.array([[1.0, 2.0, 3.0], [2.0, 4.0, 6.0], [3.0, 9.0, 1.0]])
print(ct2.fit_transform(Xn).round(4), ct2.transformers_)
ct3 = make_column_transformer((StandardScaler(), make_column_selector(dtype_include=np.number)), (OneHotEncoder(sparse_output=False), make_column_selector(dtype_exclude=np.number)), remainder="drop")
print(ct3)
dfn = df.fillna(0.0)
print(ct3.fit_transform(dfn).shape, ct3.get_feature_names_out())
full = Pipeline([("prep", ct), ("clf", LogisticRegression(max_iter=300))])
full.fit(df, yd)
print(full.predict(df).tolist(), round(full.score(df, yd), 3))
print(full)
ct4 = ColumnTransformer([("num", StandardScaler(), ["edad", "sueldo"])], remainder="drop")
try:
    ct4.fit(df)
except Exception as e:
    print(type(e).__name__)
sel = make_column_selector(pattern="^s")
print(sel(df))
ctp = ColumnTransformer([("sc", StandardScaler(), ["sueldo", "edad"])], verbose_feature_names_out=False).fit(dfn)
print(ctp.get_feature_names_out())
ttr = TransformedTargetRegressor(regressor=LinearRegression(), func=np.log, inverse_func=np.exp)
xs = np.arange(1, 11, dtype=float).reshape(-1, 1)
ys = np.exp(0.3 * xs.ravel() + 0.5)
ttr.fit(xs, ys)
print(ttr.predict(np.array([[11.0], [12.0]])).round(3), round(ttr.score(xs, ys), 6), ttr.regressor_.coef_.round(4))
from sklearn.preprocessing import RobustScaler, MaxAbsScaler
Xnan = np.array([[1.0, np.nan], [2.0, 4.0], [4.0, 8.0], [np.nan, 2.0]])
for sc in (StandardScaler(), MinMaxScaler(), RobustScaler(), MaxAbsScaler()):
    print(type(sc).__name__, sc.fit_transform(Xnan).round(3).tolist())
print(StandardScaler().fit(Xnan).n_samples_seen_, StandardScaler().fit(Xnan).mean_.round(4))
