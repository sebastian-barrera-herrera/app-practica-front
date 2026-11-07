"""Tokenizador BPE (*byte pair encoding*) de juguete, como el de los modelos de lenguaje.

Se entrena sobre un corpus: parte de caracteres sueltos y va **fusionando el par de símbolos que más se repite**.
Las palabras frecuentes acaban siendo un solo token; las raras se trocean en piezas más pequeñas.

    from dojo_ai.tokenizer import BPETokenizer, get_encoding
    enc = get_encoding()           # tokenizador ya entrenado con el corpus del curso
    enc.tokens("los envíos internacionales")
"""
import re

FIN = '</w>'


def _palabras(texto):
    return re.findall(r"\w+|[^\w\s]", texto.lower())


def _pares(simbolos):
    for a, b in zip(simbolos, simbolos[1:]):
        yield (a, b)


class BPETokenizer:
    def __init__(self, merges=None, caracteres=None):
        self.merges = list(merges or [])
        self._rango = {m: i for i, m in enumerate(self.merges)}
        base = sorted(caracteres or [])
        self.vocab = ['<pad>', '<unk>'] + base + [FIN]
        for a, b in self.merges:
            self.vocab.append(a + b)
        self._id = {t: i for i, t in enumerate(self.vocab)}

    @classmethod
    def entrenar(cls, textos, num_merges=100):
        """Aprende ``num_merges`` fusiones a partir de una lista de textos."""
        frecuencias = {}
        for t in textos:
            for w in _palabras(t):
                frecuencias[w] = frecuencias.get(w, 0) + 1
        palabras = {tuple(w) + (FIN,): n for w, n in frecuencias.items()}
        caracteres = {c for w in palabras for c in w if c != FIN}
        merges = []
        for _ in range(num_merges):
            cuenta = {}
            for simbolos, n in palabras.items():
                for par in _pares(simbolos):
                    cuenta[par] = cuenta.get(par, 0) + n
            if not cuenta:
                break
            mejor = min(cuenta, key=lambda p: (-cuenta[p], p))
            if cuenta[mejor] < 2:
                break
            merges.append(mejor)
            nuevas = {}
            for simbolos, n in palabras.items():
                nuevas[_fusionar(simbolos, mejor)] = n
            palabras = nuevas
        return cls(merges, caracteres)

    def _trocear(self, palabra):
        simbolos = tuple(palabra) + (FIN,)
        while len(simbolos) > 1:
            mejor = None
            for par in _pares(simbolos):
                r = self._rango.get(par)
                if r is not None and (mejor is None or r < mejor[0]):
                    mejor = (r, par)
            if mejor is None:
                break
            simbolos = _fusionar(simbolos, mejor[1])
        return list(simbolos)

    def tokens(self, texto):
        """Lista de tokens (cadenas) del texto. El final de cada palabra se marca con ``</w>``."""
        out = []
        for w in _palabras(texto):
            out.extend(self._trocear(w))
        return out

    def encode(self, texto):
        """Lista de identificadores enteros."""
        return [self._id.get(t, 1) for t in self.tokens(texto)]

    def decode(self, ids):
        """Vuelve del texto de identificadores al texto original (en minúsculas)."""
        s = ''.join(self.vocab[i] for i in ids)
        s = s.replace(FIN, ' ').strip()
        return re.sub(r' ([,.;:!?])', r'\1', s)

    @property
    def vocab_size(self):
        return len(self.vocab)

    def __repr__(self):
        return 'BPETokenizer(vocab_size=%d, merges=%d)' % (self.vocab_size, len(self.merges))


def _fusionar(simbolos, par):
    out = []
    i = 0
    while i < len(simbolos):
        if i < len(simbolos) - 1 and (simbolos[i], simbolos[i + 1]) == par:
            out.append(simbolos[i] + simbolos[i + 1])
            i += 2
        else:
            out.append(simbolos[i])
            i += 1
    return tuple(out)


_ENC = None


def get_encoding(nombre='dojo-bpe'):
    """Tokenizador BPE ya entrenado (140 fusiones) con el corpus del curso."""
    global _ENC
    if _ENC is None:
        from dojo_ai.corpus import TEXTOS
        _ENC = BPETokenizer.entrenar(TEXTOS, 140)
    return _ENC


def contar_tokens(texto):
    """Cuántos tokens ocupa un texto con el tokenizador del curso (lo que facturan las API por tokens)."""
    return len(get_encoding().encode(texto))
