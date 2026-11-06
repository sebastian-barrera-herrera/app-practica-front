import numpy as np
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer, TfidfTransformer, ENGLISH_STOP_WORDS
from sklearn.naive_bayes import MultinomialNB
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.model_selection import cross_val_score

docs = ["The cat sat on the mat", "The dog sat on the log", "Cats and dogs are pets", "The mat was red and the cat was happy", "Dogs chase cats"]
cv = CountVectorizer()
X = cv.fit_transform(docs)
print(X.shape, X.nnz, cv.get_feature_names_out())
print(X.toarray())
print(cv.vocabulary_)
print(cv.transform(["the cat chased a bird", "zzz"]).toarray())
print(CountVectorizer(stop_words="english").fit(docs).get_feature_names_out())
print(CountVectorizer(ngram_range=(1, 2), min_df=2).fit(docs).get_feature_names_out())
print(CountVectorizer(max_features=4).fit(docs).get_feature_names_out(), CountVectorizer(binary=True).fit_transform(docs).toarray().sum())
print(CountVectorizer(max_df=0.5).fit(docs).get_feature_names_out(), len(CountVectorizer(lowercase=False).fit(docs).vocabulary_))
print(CountVectorizer(analyzer="char", ngram_range=(2, 2)).fit(["abca", "bcd"]).get_feature_names_out(), CountVectorizer(analyzer="char_wb", ngram_range=(2, 3)).fit(["ab cd"]).get_feature_names_out())
print(CountVectorizer(strip_accents="unicode").fit(["café olé", "Ñandú"]).get_feature_names_out())
print(CountVectorizer(token_pattern=r"[a-z]+").fit(["ab1cd ef", "x"]).get_feature_names_out())
tf = TfidfVectorizer()
T = tf.fit_transform(docs)
print(T.shape, T.toarray()[0].round(4), tf.idf_.round(4))
print(TfidfVectorizer(norm=None, smooth_idf=False).fit_transform(docs[:3]).toarray().round(3))
print(TfidfVectorizer(sublinear_tf=True, use_idf=False).fit_transform(["aa aa bb", "bb cc"]).toarray().round(4))
tt = TfidfTransformer().fit(X)
print(tt.idf_.round(4), tt.transform(X).toarray()[1].round(4))
print(tf.transform(["cat dog zzz"]).toarray().round(3))
print(len(ENGLISH_STOP_WORDS), "the" in ENGLISH_STOP_WORDS)
print(cv)
print(tf)

texts = ["free money now", "win cash prize", "meeting at noon", "lunch with team", "free cash win", "project meeting today", "claim your prize now", "team lunch noon"]
lab = np.array([1, 1, 0, 0, 1, 0, 1, 0])
clf = make_pipeline(CountVectorizer(), MultinomialNB())
clf.fit(texts, lab)
print(clf.predict(["free prize meeting", "team meeting today", "cash now"]), clf.predict_proba(["free cash"]).round(4))
clf2 = make_pipeline(TfidfVectorizer(), LogisticRegression(C=10))
clf2.fit(texts, lab)
print(clf2.predict(["win a prize", "lunch meeting"]), clf2.score(texts, lab))
print(cross_val_score(make_pipeline(CountVectorizer(), MultinomialNB()), texts, lab, cv=4))

dc = DummyClassifier(strategy="most_frequent").fit(np.zeros((6, 2)), [0, 1, 1, 1, 0, 1])
print(dc.predict(np.zeros((3, 2))), dc.score(np.zeros((6, 2)), [0, 1, 1, 1, 0, 1]), dc.class_prior_)
dp = DummyClassifier(strategy="prior").fit(np.zeros((4, 1)), ["a", "b", "b", "b"])
print(dp.predict_proba(np.zeros((2, 1))), dp.predict(np.zeros((2, 1))))
print(DummyClassifier(strategy="constant", constant="b").fit(np.zeros((4, 1)), ["a", "b", "b", "a"]).predict(np.zeros((3, 1))))
print(DummyClassifier(strategy="uniform", random_state=0).fit(np.zeros((4, 1)), [0, 1, 2, 1]).predict(np.zeros((6, 1))))
dr = DummyRegressor().fit(np.zeros((4, 1)), [1.0, 2.0, 3.0, 10.0])
print(dr.predict(np.zeros((2, 1))), dr.constant_, DummyRegressor(strategy="median").fit(np.zeros((4, 1)), [1.0, 2.0, 3.0, 10.0]).constant_, DummyRegressor(strategy="quantile", quantile=0.75).fit(np.zeros((4, 1)), [1.0, 2.0, 3.0, 10.0]).constant_)
print(round(dr.score(np.zeros((4, 1)), [1.0, 2.0, 3.0, 10.0]), 6), DummyRegressor(strategy="constant", constant=5).fit(np.zeros((3, 1)), [1, 2, 3]).predict(np.zeros((2, 1))))
