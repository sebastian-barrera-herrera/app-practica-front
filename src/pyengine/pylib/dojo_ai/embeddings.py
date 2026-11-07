"""Embeddings de juguete (128 dimensiones) para practicar búsqueda semántica sin descargar modelos.

No es un modelo entrenado: parte de un léxico curado en español (``_lexicon.py``) en el que cada palabra pertenece a
conceptos. Aun así se comporta como un embedding de verdad: palabras de significado parecido quedan cerca (coseno alto),
se pueden hacer analogías (rey − hombre + mujer ≈ reina) y las frases se comparan por su significado, no solo por las
palabras exactas.

    from dojo_ai.embeddings import embed, similarity, most_similar
"""
import re
import unicodedata

import numpy as np

from dojo_ai._lexicon import EXTRA, GROUPS, STOPWORDS

DIM = 128
RUIDO = 0.9          # peso de la «identidad» propia de cada palabra frente a su significado (concepto)
_SUFIJOS = sorted(
    'amientos imientos aciones uciones amiento imiento adores adoras acion ucion mente ables ibles ando iendo ados adas idos idas aron ieron aban amos emos imos ar er ir as es os an en on ad ado ida ido ada a e o s'.split(),
    key=len,
    reverse=True,
)


def _sin_acentos(s):
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def raiz(palabra):
    """Raíz aproximada de una palabra (quita acentos y terminaciones): «enviamos», «envío» y «enviar» → «envi»."""
    p = _sin_acentos(palabra)
    for suf in _SUFIJOS:
        if p.endswith(suf) and len(p) - len(suf) >= 3:
            return p[: len(p) - len(suf)]
    return p


def _fnv(s):
    h = 2166136261
    for ch in s.encode('utf-8'):
        h = ((h ^ ch) * 16777619) % 4294967296
    return h


def _gauss(semilla, n):
    return np.random.RandomState(semilla % 4294967295).randn(n)


class _Modelo:
    """Vectores de todas las palabras del léxico (una entrada por forma, con búsqueda por raíz para las variantes)."""

    def __init__(self):
        conceptos = list(GROUPS)
        for pesos in EXTRA.values():
            for c in pesos:
                if not c.startswith('~') and c not in conceptos:
                    conceptos.append(c)
        self.conceptos = conceptos
        idx = {c: i for i, c in enumerate(conceptos)}
        # filas ortonormales (Gram–Schmidt): conceptos distintos no se parecen, y las dimensiones finales no son interpretables
        G = np.random.RandomState(42).randn(len(conceptos), DIM)
        P = np.zeros((len(conceptos), DIM))
        for i in range(len(conceptos)):
            v = G[i].copy()
            for k in range(i):
                v = v - (v @ P[k]) * P[k]
            P[i] = v / np.linalg.norm(v)
        self.P = P
        coords = {}
        superficie = {}
        for c, palabras in GROUPS.items():
            for w in palabras.split():
                k = _sin_acentos(w)
                coords.setdefault(k, {})
                coords[k][c] = coords[k].get(c, 0.0) + 1.0
                superficie.setdefault(k, w)
        for w, pesos in EXTRA.items():
            k = _sin_acentos(w)
            superficie.setdefault(k, w)
            coords[k] = {c: float(v) for c, v in pesos.items()}       # EXTRA manda sobre GROUPS
        self.exacto = {}
        for k, pesos in coords.items():
            v = np.zeros(DIM)
            for c, w in pesos.items():
                if c.startswith('~'):
                    v = v + w * _gauss(_fnv(c), DIM) / np.sqrt(DIM)
                else:
                    v = v + w * P[idx[c]]
            r = _gauss(_fnv('w:' + k), DIM)
            v = v + RUIDO * r / np.linalg.norm(r)
            self.exacto[k] = v / np.linalg.norm(v)
        por_raiz = {}
        for k in coords:
            por_raiz.setdefault(raiz(k), []).append(k)
        self.por_raiz = {}
        for r, ks in por_raiz.items():
            v = np.zeros(DIM)
            for k in ks:
                v = v + self.exacto[k]
            self.por_raiz[r] = v / np.linalg.norm(v)
        self.superficie = superficie
        self.cache = {}

    def palabra(self, w):
        k = _sin_acentos(w)
        if k in self.exacto:
            return self.exacto[k]
        return self.por_raiz.get(raiz(w))

    def trigramas(self, w):
        r = raiz(w)
        if r in self.cache:
            return self.cache[r]
        s = '<' + r + '>'
        v = np.zeros(DIM)
        for i in range(len(s) - 2):
            v = v + _gauss(_fnv('t:' + s[i:i + 3]), DIM)
        n = np.linalg.norm(v)
        v = v / n if n > 0 else v
        self.cache[r] = v
        return v


_M = None


def _modelo():
    global _M
    if _M is None:
        _M = _Modelo()
    return _M


def tokens(texto):
    """Palabras de un texto (en minúsculas, sin signos de puntuación)."""
    return re.findall(r"[a-záéíóúüñ0-9]+", texto.lower())


def embed_palabra(palabra):
    """Vector (128,) de una palabra del vocabulario; ``None`` si no la conoce."""
    v = _modelo().palabra(palabra)
    return None if v is None else v.copy()


def _embed_texto(texto):
    m = _modelo()
    acum = np.zeros(DIM)
    hay = False
    for t in tokens(texto):
        if t in STOPWORDS or _sin_acentos(t) in STOPWORDS:
            continue
        v = m.palabra(t)
        if v is not None:
            acum = acum + v
            hay = True
        else:
            acum = acum + 0.35 * m.trigramas(t)       # palabra desconocida: solo se parece a las de letras parecidas
            hay = True
    if not hay:
        return acum
    n = np.linalg.norm(acum)
    return acum / n if n > 0 else acum


def embed(texto):
    """Embedding de una frase (``(128,)``) o de una lista de frases (``(n, 128)``), normalizados a longitud 1."""
    if isinstance(texto, str):
        return _embed_texto(texto)
    return np.array([_embed_texto(t) for t in texto])


def cosine(a, b):
    """Similitud coseno entre dos vectores."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d > 0 else 0.0


def similarity(a, b):
    """Similitud coseno entre dos textos (frases o palabras)."""
    return cosine(embed(a), embed(b))


def vocabulario():
    """Palabras que el modelo conoce (una por raíz)."""
    m = _modelo()
    return sorted(m.superficie.values())


def most_similar(palabra, topn=5):
    """Las ``topn`` palabras del vocabulario más cercanas a ``palabra``: lista de ``(palabra, coseno)``."""
    m = _modelo()
    v = m.palabra(palabra)
    if v is None:
        raise KeyError("la palabra %r no está en el vocabulario" % palabra)
    propia = _sin_acentos(palabra)
    res = []
    for k, u in m.exacto.items():
        if k != propia:
            res.append((m.superficie[k], float(v @ u)))
    res.sort(key=lambda t: (-t[1], t[0]))
    return [(w, round(s, 4)) for w, s in res[:topn]]


def analogia(a, b, c, topn=3):
    """«a es a b como c es a ...»: vector(b) − vector(a) + vector(c); devuelve las palabras más cercanas."""
    m = _modelo()
    va, vb, vc = m.palabra(a), m.palabra(b), m.palabra(c)
    for w, v in ((a, va), (b, vb), (c, vc)):
        if v is None:
            raise KeyError("la palabra %r no está en el vocabulario" % w)
    obj = vb - va + vc
    obj = obj / np.linalg.norm(obj)
    excluir = {_sin_acentos(a), _sin_acentos(b), _sin_acentos(c)}
    res = [(m.superficie[k], float(obj @ u)) for k, u in m.exacto.items() if k not in excluir]
    res.sort(key=lambda t: (-t[1], t[0]))
    return [(w, round(s, 4)) for w, s in res[:topn]]
