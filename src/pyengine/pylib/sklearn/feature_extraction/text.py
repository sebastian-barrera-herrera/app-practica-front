import re
import unicodedata
import numpy as np

from sklearn.base import BaseEstimator, TransformerMixin, check_is_fitted
from sklearn.feature_extraction._stop_words import ENGLISH_STOP_WORDS
from sklearn.preprocessing import _Sparse


def strip_accents_unicode(s):
    normalized = unicodedata.normalize('NFKD', s)
    if normalized == s:
        return s
    return ''.join([c for c in normalized if not unicodedata.combining(c)])


def strip_accents_ascii(s):
    nkfd_form = unicodedata.normalize('NFKD', s)
    return nkfd_form.encode('ASCII', 'ignore').decode('ASCII')


class _VectorizerMixin:
    def build_preprocessor(self):
        if self.preprocessor is not None:
            return self.preprocessor
        strip = None
        if self.strip_accents == 'ascii':
            strip = strip_accents_ascii
        elif self.strip_accents == 'unicode':
            strip = strip_accents_unicode
        lower = self.lowercase

        def pre(doc):
            if lower:
                doc = doc.lower()
            if strip is not None:
                doc = strip(doc)
            return doc
        return pre

    def build_tokenizer(self):
        if self.tokenizer is not None:
            return self.tokenizer
        pat = re.compile(self.token_pattern)
        if pat.groups > 1:
            raise ValueError('More than 1 capturing group in token pattern. Only a single group should be captured.')
        return pat.findall

    def get_stop_words(self):
        sw = self.stop_words
        if sw is None:
            return None
        if isinstance(sw, str):
            if sw == 'english':
                return ENGLISH_STOP_WORDS
            raise ValueError('not a built-in stop list: %s' % sw)
        return frozenset(sw)

    def _word_ngrams(self, tokens, stop_words=None):
        if stop_words is not None:
            tokens = [w for w in tokens if w not in stop_words]
        min_n, max_n = self.ngram_range
        if max_n != 1:
            original_tokens = tokens
            if min_n == 1:
                tokens = list(original_tokens)
                min_n += 1
            else:
                tokens = []
            n_original_tokens = len(original_tokens)
            tokens_append = tokens.append
            space_join = ' '.join
            for n in range(min_n, min(max_n + 1, n_original_tokens + 1)):
                for i in range(n_original_tokens - n + 1):
                    tokens_append(space_join(original_tokens[i:i + n]))
        return tokens

    def _char_ngrams(self, text_document):
        text_document = re.sub(r'\s\s+', ' ', text_document)
        text_len = len(text_document)
        min_n, max_n = self.ngram_range
        if min_n == 1:
            ngrams = list(text_document)
            min_n += 1
        else:
            ngrams = []
        ngrams_append = ngrams.append
        for n in range(min_n, min(max_n + 1, text_len + 1)):
            for i in range(text_len - n + 1):
                ngrams_append(text_document[i:i + n])
        return ngrams

    def _char_wb_ngrams(self, text_document):
        text_document = re.sub(r'\s\s+', ' ', text_document)
        min_n, max_n = self.ngram_range
        ngrams = []
        ngrams_append = ngrams.append
        for w in text_document.split():
            w = ' ' + w + ' '
            w_len = len(w)
            for n in range(min_n, max_n + 1):
                offset = 0
                ngrams_append(w[offset:offset + n])
                while offset + n < w_len:
                    offset += 1
                    ngrams_append(w[offset:offset + n])
                if offset == 0:
                    break
        return ngrams

    def build_analyzer(self):
        if callable(self.analyzer):
            return self.analyzer
        preprocess = self.build_preprocessor()
        if self.analyzer == 'char':
            return lambda doc: self._char_ngrams(preprocess(doc))
        if self.analyzer == 'char_wb':
            return lambda doc: self._char_wb_ngrams(preprocess(doc))
        if self.analyzer == 'word':
            stop_words = self.get_stop_words()
            tokenize = self.build_tokenizer()
            return lambda doc: self._word_ngrams(tokenize(preprocess(doc)), stop_words)
        raise ValueError('%s is not a valid tokenization scheme/analyzer' % self.analyzer)


def _docs(raw_documents):
    if isinstance(raw_documents, str):
        raise ValueError('Iterable over raw text documents expected, string object received.')
    if hasattr(raw_documents, 'tolist'):
        raw_documents = raw_documents.tolist()
    return list(raw_documents)


class CountVectorizer(_VectorizerMixin, BaseEstimator):
    def __init__(self, *, input='content', encoding='utf-8', decode_error='strict', strip_accents=None, lowercase=True, preprocessor=None, tokenizer=None, stop_words=None, token_pattern=r'(?u)\b\w\w+\b', ngram_range=(1, 1), analyzer='word', max_df=1.0, min_df=1, max_features=None, vocabulary=None, binary=False, dtype=np.int64):
        self.input = input
        self.encoding = encoding
        self.decode_error = decode_error
        self.strip_accents = strip_accents
        self.preprocessor = preprocessor
        self.tokenizer = tokenizer
        self.analyzer = analyzer
        self.lowercase = lowercase
        self.token_pattern = token_pattern
        self.stop_words = stop_words
        self.max_df = max_df
        self.min_df = min_df
        self.max_features = max_features
        self.ngram_range = ngram_range
        self.vocabulary = vocabulary
        self.binary = binary
        self.dtype = dtype

    def _count_vocab(self, raw_documents, fixed_vocab):
        if fixed_vocab:
            vocabulary = self.vocabulary_
        else:
            vocabulary = {}
        analyze = self.build_analyzer()
        rows = []
        for doc in raw_documents:
            counts = {}
            for feature in analyze(doc):
                if fixed_vocab:
                    if feature not in vocabulary:
                        continue
                    idx = vocabulary[feature]
                else:
                    if feature not in vocabulary:
                        vocabulary[feature] = len(vocabulary)
                    idx = vocabulary[feature]
                counts[idx] = counts.get(idx, 0) + 1
            rows.append(counts)
        if not fixed_vocab and not vocabulary:
            raise ValueError('empty vocabulary; perhaps the documents only contain stop words')
        return vocabulary, rows

    def _dense(self, rows, n_features):
        X = np.zeros((len(rows), n_features), dtype=np.int64)
        for i, counts in enumerate(rows):
            for j, c in counts.items():
                X[i, j] = c
        return X

    def _sort_features(self, vocabulary):
        sorted_features = sorted(vocabulary.items())
        map_index = {}
        for new_val, (term, old_val) in enumerate(sorted_features):
            vocabulary[term] = new_val
            map_index[old_val] = new_val
        return map_index

    def _limit_features(self, X, vocabulary, high=None, low=None, limit=None):
        if high is None and low is None and limit is None:
            return X, set()
        df = (X != 0).sum(axis=0)
        mask = np.ones(len(df), dtype=bool)
        if high is not None:
            mask &= df <= high
        if low is not None:
            mask &= df >= low
        if limit is not None and mask.sum() > limit:
            tfs = X.sum(axis=0)
            mask_inds = (-tfs[mask]).argsort(kind='stable')[:limit]
            new_mask = np.zeros(len(df), dtype=bool)
            new_mask[np.where(mask)[0][mask_inds]] = True
            mask = new_mask
        new_indices = np.cumsum(mask) - 1
        removed_terms = set()
        for term, old_index in list(vocabulary.items()):
            if mask[old_index]:
                vocabulary[term] = int(new_indices[old_index])
            else:
                del vocabulary[term]
                removed_terms.add(term)
        kept_indices = np.where(mask)[0]
        if len(kept_indices) == 0:
            raise ValueError('After pruning, no terms remain. Try a lower min_df or a higher max_df.')
        return X[:, kept_indices], removed_terms

    def fit(self, raw_documents, y=None):
        self.fit_transform(raw_documents)
        return self

    def fit_transform(self, raw_documents, y=None):
        raw_documents = _docs(raw_documents)
        fixed_vocab = self.vocabulary is not None
        if fixed_vocab:
            voc = self.vocabulary
            if not isinstance(voc, dict):
                voc = {t: i for i, t in enumerate(voc)}
            self.vocabulary_ = dict(voc)
            self.fixed_vocabulary_ = True
        else:
            self.fixed_vocabulary_ = False
        max_df = self.max_df
        min_df = self.min_df
        max_features = self.max_features
        vocabulary, rows = self._count_vocab(raw_documents, fixed_vocab)
        n_features = len(vocabulary) if not fixed_vocab else max(vocabulary.values()) + 1
        X = self._dense(rows, n_features)
        if self.binary:
            X = (X != 0).astype(np.int64)
        if not fixed_vocab:
            n_doc = X.shape[0]
            max_doc_count = max_df if isinstance(max_df, int) and not isinstance(max_df, bool) else max_df * n_doc
            min_doc_count = min_df if isinstance(min_df, int) and not isinstance(min_df, bool) else min_df * n_doc
            if max_doc_count < min_doc_count:
                raise ValueError('max_df corresponds to < documents than min_df')
            map_index = self._sort_features(vocabulary)
            order = np.zeros(n_features, dtype=int)
            for old, new in map_index.items():
                order[new] = old
            X = X[:, order]
            X, self.stop_words_ = self._limit_features(X, vocabulary, max_doc_count, min_doc_count, max_features)
            self.vocabulary_ = dict(vocabulary)
        return _Sparse(X.astype(self.dtype) if self.dtype is not np.int64 else X)

    def transform(self, raw_documents):
        if isinstance(raw_documents, str):
            raise ValueError('Iterable over raw text documents expected, string object received.')
        check_is_fitted(self, 'vocabulary_')
        docs = _docs(raw_documents)
        _, rows = self._count_vocab(docs, True) if len(self.vocabulary_) else ({}, [])
        X = self._dense(rows, len(self.vocabulary_))
        if self.binary:
            X = (X != 0).astype(np.int64)
        return _Sparse(X.astype(self.dtype) if self.dtype is not np.int64 else X)

    def inverse_transform(self, X):
        Xd = np.asarray(X.toarray() if hasattr(X, 'toarray') else X)
        terms = self.get_feature_names_out()
        return [terms[np.nonzero(row)[0]] for row in Xd]

    def get_feature_names_out(self, input_features=None):
        check_is_fitted(self, 'vocabulary_')
        items = sorted(self.vocabulary_.items(), key=lambda kv: kv[1])
        return np.asarray([t for t, _ in items])


class TfidfTransformer(BaseEstimator, TransformerMixin):
    def __init__(self, *, norm='l2', use_idf=True, smooth_idf=True, sublinear_tf=False):
        self.norm = norm
        self.use_idf = use_idf
        self.smooth_idf = smooth_idf
        self.sublinear_tf = sublinear_tf

    def fit(self, X, y=None):
        X = np.asarray(X.toarray() if hasattr(X, 'toarray') else X, dtype=np.float64)
        n_samples, n_features = X.shape
        self.n_features_in_ = n_features
        if self.use_idf:
            df = (X != 0).sum(axis=0).astype(np.float64)
            df = df + float(self.smooth_idf)
            n = n_samples + float(self.smooth_idf)
            self.idf_ = np.log(n / df) + 1.0
        return self

    def transform(self, X, copy=True):
        X = np.array(X.toarray() if hasattr(X, 'toarray') else X, dtype=np.float64)
        if self.sublinear_tf:
            X = np.where(X != 0, np.log(np.where(X != 0, X, 1.0)) + 1.0, 0.0)
        if self.use_idf:
            check_is_fitted(self, 'idf_')
            X = X * self.idf_
        if self.norm is not None:
            from sklearn.preprocessing import normalize
            X = normalize(X, norm=self.norm)
        return _Sparse(X)


class TfidfVectorizer(CountVectorizer):
    def __init__(self, *, input='content', encoding='utf-8', decode_error='strict', strip_accents=None, lowercase=True, preprocessor=None, tokenizer=None, analyzer='word', stop_words=None, token_pattern=r'(?u)\b\w\w+\b', ngram_range=(1, 1), max_df=1.0, min_df=1, max_features=None, vocabulary=None, binary=False, dtype=np.float64, norm='l2', use_idf=True, smooth_idf=True, sublinear_tf=False):
        CountVectorizer.__init__(self, input=input, encoding=encoding, decode_error=decode_error, strip_accents=strip_accents, lowercase=lowercase, preprocessor=preprocessor, tokenizer=tokenizer, analyzer=analyzer, stop_words=stop_words, token_pattern=token_pattern, ngram_range=ngram_range, max_df=max_df, min_df=min_df, max_features=max_features, vocabulary=vocabulary, binary=binary, dtype=dtype)
        self.norm = norm
        self.use_idf = use_idf
        self.smooth_idf = smooth_idf
        self.sublinear_tf = sublinear_tf

    @property
    def idf_(self):
        return self._tfidf.idf_

    def fit(self, raw_documents, y=None):
        X = CountVectorizer.fit_transform(self, raw_documents)
        self._tfidf = TfidfTransformer(norm=self.norm, use_idf=self.use_idf, smooth_idf=self.smooth_idf, sublinear_tf=self.sublinear_tf)
        self._tfidf.fit(X)
        return self

    def fit_transform(self, raw_documents, y=None):
        X = CountVectorizer.fit_transform(self, raw_documents)
        self._tfidf = TfidfTransformer(norm=self.norm, use_idf=self.use_idf, smooth_idf=self.smooth_idf, sublinear_tf=self.sublinear_tf)
        self._tfidf.fit(X)
        return self._tfidf.transform(X)

    def transform(self, raw_documents):
        check_is_fitted(self, 'vocabulary_')
        X = CountVectorizer.transform(self, raw_documents)
        return self._tfidf.transform(X)
