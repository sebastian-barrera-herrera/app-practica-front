"""Índices vectoriales y una base de datos vectorial de juguete, con la forma de FAISS y de Chroma.

Índices (como ``faiss``): ``IndexFlatL2``, ``IndexFlatIP`` (exactos), ``IndexIVF`` y ``IndexLSH`` (aproximados).
Todos tienen ``add(X)`` y ``search(Q, k) -> (D, I)``, y cuentan en ``last_comparisons`` cuántas distancias calcularon
en la última búsqueda, para que se vea qué ahorra una búsqueda aproximada y qué precisión pierde.

Base de datos (como ``chromadb``): ``Client().create_collection(nombre)`` con ``add(ids, documents, metadatas)`` y
``query(query_texts, n_results, where)``.
"""
import numpy as np

from dojo_ai import embeddings as _emb


def _topk(puntuaciones, k, mayor_mejor):
    """Índices de las k mejores puntuaciones (empates: gana el índice menor)."""
    orden = np.argsort(-puntuaciones if mayor_mejor else puntuaciones, kind='stable')
    return orden[:k]


class _Indice:
    def __init__(self, d):
        self.d = d
        self.ntotal = 0
        self.last_comparisons = 0
        self._X = np.zeros((0, d))

    def add(self, X):
        X = np.asarray(X, dtype=float)
        if X.ndim != 2 or X.shape[1] != self.d:
            raise ValueError('se esperaba una matriz (n, %d) y se recibió %s' % (self.d, X.shape))
        self._X = np.vstack([self._X, X])
        self.ntotal = len(self._X)
        self._despues_de_añadir(len(X))

    def _despues_de_añadir(self, n):
        pass

    def _empaquetar(self, D, I, k):
        D = np.array(D, dtype=float)
        I = np.array(I, dtype=int)
        return D, I


class IndexFlatL2(_Indice):
    """Búsqueda exacta por distancia euclídea al cuadrado (la más cercana primero)."""

    def search(self, Q, k):
        Q = np.atleast_2d(np.asarray(Q, dtype=float))
        D, I = [], []
        self.last_comparisons = len(Q) * self.ntotal
        for q in Q:
            d2 = ((self._X - q) ** 2).sum(axis=1)
            idx = _topk(d2, k, False)
            D.append(list(d2[idx]) + [np.inf] * (k - len(idx)))
            I.append(list(idx) + [-1] * (k - len(idx)))
        return self._empaquetar(D, I, k)


class IndexFlatIP(_Indice):
    """Búsqueda exacta por producto escalar (con vectores de longitud 1 equivale al coseno; la mayor primero)."""

    def search(self, Q, k):
        Q = np.atleast_2d(np.asarray(Q, dtype=float))
        D, I = [], []
        self.last_comparisons = len(Q) * self.ntotal
        for q in Q:
            s = self._X @ q
            idx = _topk(s, k, True)
            D.append(list(s[idx]) + [-np.inf] * (k - len(idx)))
            I.append(list(idx) + [-1] * (k - len(idx)))
        return self._empaquetar(D, I, k)


def _kmeans(X, k, iteraciones=15):
    paso = max(1, len(X) // k)
    C = X[np.arange(k) * paso % len(X)].copy()          # centros iniciales repartidos por los datos
    for _ in range(iteraciones):
        d2 = ((X[:, None, :] - C[None, :, :]) ** 2).sum(axis=2)
        et = d2.argmin(axis=1)
        for j in range(k):
            m = et == j
            if m.any():
                C[j] = X[m].mean(axis=0)
    return C


class IndexIVF(_Indice):
    """Índice de archivo invertido: agrupa los vectores en ``nlist`` celdas (k-means) y al buscar solo mira las ``nprobe``
    celdas más cercanas a la consulta. Más rápido que mirar todo, pero puede perder algún vecino real."""

    def __init__(self, d, nlist=8, nprobe=1):
        super().__init__(d)
        self.nlist = nlist
        self.nprobe = nprobe
        self.centros = None
        self._celdas = None

    def train(self, X):
        self.centros = _kmeans(np.asarray(X, dtype=float), self.nlist)

    @property
    def is_trained(self):
        return self.centros is not None

    def _despues_de_añadir(self, n):
        if self.centros is None:
            raise RuntimeError('hay que llamar a train() antes de add()')
        d2 = ((self._X[:, None, :] - self.centros[None, :, :]) ** 2).sum(axis=2)
        et = d2.argmin(axis=1)
        self._celdas = [list(np.where(et == j)[0]) for j in range(self.nlist)]

    def search(self, Q, k, nprobe=None):
        nprobe = self.nprobe if nprobe is None else nprobe
        Q = np.atleast_2d(np.asarray(Q, dtype=float))
        D, I = [], []
        total = 0
        for q in Q:
            dc = ((self.centros - q) ** 2).sum(axis=1)
            celdas = _topk(dc, nprobe, False)
            cand = []
            for c in celdas:
                cand.extend(self._celdas[c])
            total += self.nlist + len(cand)
            if not cand:
                D.append([np.inf] * k)
                I.append([-1] * k)
                continue
            cand = np.array(sorted(cand))
            d2 = ((self._X[cand] - q) ** 2).sum(axis=1)
            idx = _topk(d2, k, False)
            D.append(list(d2[idx]) + [np.inf] * (k - len(idx)))
            I.append(list(cand[idx]) + [-1] * (k - len(idx)))
        self.last_comparisons = total
        return self._empaquetar(D, I, k)


class IndexLSH(_Indice):
    """*Locality-sensitive hashing*: ``nbits`` hiperplanos aleatorios dan a cada vector un código de bits (a qué lado de
    cada plano cae). Vectores parecidos suelen compartir código, así que solo se comparan los del mismo cubo."""

    def __init__(self, d, nbits=6, seed=0):
        super().__init__(d)
        self.nbits = nbits
        self.planos = np.random.RandomState(seed).randn(nbits, d)
        self._codigos = np.zeros((0, nbits), dtype=int)

    def _codigo(self, X):
        return (np.atleast_2d(X) @ self.planos.T > 0).astype(int)

    def _despues_de_añadir(self, n):
        self._codigos = self._codigo(self._X)

    def search(self, Q, k):
        Q = np.atleast_2d(np.asarray(Q, dtype=float))
        D, I = [], []
        total = 0
        for q in Q:
            cq = self._codigo(q)[0]
            dist = (self._codigos != cq).sum(axis=1)       # distancia de Hamming entre códigos
            radio = 0
            cand = np.where(dist <= radio)[0]
            while len(cand) < k and radio < self.nbits:
                radio += 1
                cand = np.where(dist <= radio)[0]
            total += len(cand)
            if len(cand) == 0:
                D.append([-np.inf] * k)
                I.append([-1] * k)
                continue
            Xc = self._X[cand]
            n = np.linalg.norm(Xc, axis=1) * np.linalg.norm(q)
            n = np.where(n == 0, 1.0, n)
            s = (Xc @ q) / n
            idx = _topk(s, k, True)
            D.append(list(s[idx]) + [-np.inf] * (k - len(idx)))
            I.append(list(cand[idx]) + [-1] * (k - len(idx)))
        self.last_comparisons = total
        return self._empaquetar(D, I, k)


def recall(aprox, exacto):
    """Fracción de los vecinos exactos que la búsqueda aproximada también encontró (por consulta, promediada)."""
    aprox, exacto = np.atleast_2d(aprox), np.atleast_2d(exacto)
    return float(np.mean([len(set(a) & set(e)) / len(e) for a, e in zip(aprox, exacto)]))


# ───────────────────────── base de datos vectorial (a la manera de Chroma) ─────────────────────────


def _cumple(meta, where):
    if not where:
        return True
    for clave, cond in where.items():
        if clave == '$and':
            if not all(_cumple(meta, w) for w in cond):
                return False
        elif clave == '$or':
            if not any(_cumple(meta, w) for w in cond):
                return False
        else:
            v = meta.get(clave)
            if isinstance(cond, dict):
                for op, ref in cond.items():
                    ok = {'$eq': v == ref, '$ne': v != ref, '$in': v in ref if isinstance(ref, (list, tuple)) else False,
                          '$nin': v not in ref if isinstance(ref, (list, tuple)) else True,
                          '$gt': v is not None and v > ref, '$gte': v is not None and v >= ref,
                          '$lt': v is not None and v < ref, '$lte': v is not None and v <= ref}.get(op)
                    if not ok:
                        return False
            elif v != cond:
                return False
    return True


class Collection:
    def __init__(self, name, metadata=None, embedding_function=None):
        self.name = name
        self.metadata = dict(metadata or {})
        self.space = self.metadata.get('hnsw:space', 'l2')
        self._ef = embedding_function or _emb.embed
        self._ids, self._docs, self._metas, self._vecs = [], [], [], []

    def count(self):
        return len(self._ids)

    def add(self, ids, documents=None, embeddings=None, metadatas=None):
        if embeddings is None:
            if documents is None:
                raise ValueError('hace falta documents o embeddings')
            embeddings = [self._ef(d) for d in documents]
        n = len(ids)
        documents = documents if documents is not None else [None] * n
        metadatas = metadatas if metadatas is not None else [{} for _ in range(n)]
        for i in range(n):
            if ids[i] in self._ids:
                raise ValueError('ya existe el id %r' % (ids[i],))
            self._ids.append(ids[i])
            self._docs.append(documents[i])
            self._metas.append(dict(metadatas[i] or {}))
            self._vecs.append(np.asarray(embeddings[i], dtype=float))

    def _distancia(self, q, V):
        if self.space == 'cosine':
            n = np.linalg.norm(V, axis=1) * np.linalg.norm(q)
            n = np.where(n == 0, 1.0, n)
            return 1.0 - (V @ q) / n
        if self.space == 'ip':
            return 1.0 - V @ q
        return ((V - q) ** 2).sum(axis=1)

    def query(self, query_texts=None, query_embeddings=None, n_results=3, where=None):
        if query_embeddings is None:
            query_embeddings = [self._ef(t) for t in query_texts]
        res = {'ids': [], 'documents': [], 'metadatas': [], 'distances': []}
        cand = [i for i in range(len(self._ids)) if _cumple(self._metas[i], where)]
        for q in query_embeddings:
            q = np.asarray(q, dtype=float)
            if not cand:
                for k in res:
                    res[k].append([])
                continue
            V = np.array([self._vecs[i] for i in cand])
            d = self._distancia(q, V)
            orden = np.argsort(d, kind='stable')[:n_results]
            res['ids'].append([self._ids[cand[j]] for j in orden])
            res['documents'].append([self._docs[cand[j]] for j in orden])
            res['metadatas'].append([self._metas[cand[j]] for j in orden])
            res['distances'].append([float(d[j]) for j in orden])
        return res

    def get(self, ids=None, where=None):
        idx = [i for i in range(len(self._ids)) if (ids is None or self._ids[i] in ids) and _cumple(self._metas[i], where)]
        return {'ids': [self._ids[i] for i in idx], 'documents': [self._docs[i] for i in idx], 'metadatas': [self._metas[i] for i in idx]}

    def delete(self, ids=None, where=None):
        borrar = set(self.get(ids=ids, where=where)['ids'])
        keep = [i for i in range(len(self._ids)) if self._ids[i] not in borrar]
        self._ids = [self._ids[i] for i in keep]
        self._docs = [self._docs[i] for i in keep]
        self._metas = [self._metas[i] for i in keep]
        self._vecs = [self._vecs[i] for i in keep]

    def __repr__(self):
        return 'Collection(name=%r, count=%d)' % (self.name, self.count())


class Client:
    def __init__(self):
        self._cols = {}

    def create_collection(self, name, metadata=None, embedding_function=None):
        if name in self._cols:
            raise ValueError('la colección %r ya existe' % name)
        self._cols[name] = Collection(name, metadata, embedding_function)
        return self._cols[name]

    def get_or_create_collection(self, name, metadata=None, embedding_function=None):
        return self._cols[name] if name in self._cols else self.create_collection(name, metadata, embedding_function)

    def get_collection(self, name):
        return self._cols[name]

    def list_collections(self):
        return list(self._cols.values())

    def delete_collection(self, name):
        del self._cols[name]
