"""Modelo de lenguaje de n-gramas de juguete: predice la siguiente palabra contando qué palabras suelen seguir a las
anteriores. Un LLM hace lo mismo (predecir el siguiente token), pero con una red neuronal en lugar de una tabla.

    from dojo_ai.lm import modelo_cuentos
    m = modelo_cuentos()
    m.probabilidades("el")           # {'gato': 0.2, 'perro': 0.2, ...}
    m.generar("el gato", temperatura=0.8, semilla=3)
"""
import math

import numpy as np

FIN = '.'


def softmax_temperatura(logits, temperatura=1.0):
    """Convierte logits en probabilidades dividiendo antes por la temperatura (T alta: reparto plano; T→0: el mayor)."""
    z = np.asarray(logits, dtype=float) / max(temperatura, 1e-6)
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def filtrar_top_k(probs, k):
    """Deja solo las k probabilidades más altas (el resto a 0) y renormaliza."""
    p = np.asarray(probs, dtype=float)
    if k is None or k >= len(p):
        return p
    corte = np.sort(p)[::-1][k - 1]
    q = np.where(p >= corte, p, 0.0)
    return q / q.sum()


def filtrar_top_p(probs, p_acum):
    """*Nucleus sampling*: conserva las palabras más probables hasta sumar ``p_acum`` y renormaliza."""
    p = np.asarray(probs, dtype=float)
    if p_acum is None or p_acum >= 1:
        return p
    orden = np.argsort(-p, kind='stable')
    acum = 0.0
    q = np.zeros_like(p)
    for i in orden:
        q[i] = p[i]
        acum += p[i]
        if acum >= p_acum:
            break
    return q / q.sum()


class ModeloNgramas:
    def __init__(self, n=2):
        self.n = n
        self.cuentas = {}         # contexto (tupla) -> {palabra: veces}
        self.vocab = set()

    @classmethod
    def entrenar(cls, frases, n=2):
        m = cls(n)
        for f in frases:
            toks = f.split()
            for tok in toks:
                m.vocab.add(tok)
            for i in range(len(toks)):
                for orden in range(0, n):
                    if i - orden < 0:
                        continue
                    ctx = tuple(toks[i - orden:i])
                    m.cuentas.setdefault(ctx, {})
                    m.cuentas[ctx][toks[i]] = m.cuentas[ctx].get(toks[i], 0) + 1
        return m

    def _ctx(self, contexto):
        toks = contexto.split() if isinstance(contexto, str) else list(contexto)
        for orden in range(self.n - 1, -1, -1):
            ctx = tuple(toks[len(toks) - orden:]) if orden > 0 else ()
            if len(toks) >= orden and ctx in self.cuentas:
                return ctx
        return ()

    def probabilidades(self, contexto):
        """Diccionario ``{palabra: probabilidad}`` de la siguiente palabra, de mayor a menor probabilidad."""
        c = self.cuentas[self._ctx(contexto)]
        total = sum(c.values())
        items = sorted(c.items(), key=lambda t: (-t[1], t[0]))
        return {w: round(n / total, 4) for w, n in items}

    def logits(self, contexto):
        """Palabras candidatas y sus logits (logaritmos de las probabilidades)."""
        p = self.probabilidades(contexto)
        palabras = list(p)
        return palabras, np.log(np.array([p[w] for w in palabras]))

    def siguiente(self, contexto, temperatura=1.0, top_k=None, top_p=None, rng=None):
        rng = rng or np.random.RandomState(0)
        palabras, lg = self.logits(contexto)
        if temperatura <= 0:
            return palabras[0]
        pr = softmax_temperatura(lg, temperatura)
        pr = filtrar_top_k(pr, top_k)
        pr = filtrar_top_p(pr, top_p)
        u = rng.rand()
        acum = 0.0
        for w, q in zip(palabras, pr):
            acum += q
            if u < acum:
                return w
        return palabras[-1]

    def generar(self, prompt, max_tokens=12, temperatura=1.0, top_k=None, top_p=None, semilla=0):
        """Continúa ``prompt`` palabra a palabra hasta un punto o ``max_tokens``. Devuelve el texto completo."""
        rng = np.random.RandomState(semilla)
        toks = prompt.split()
        for _ in range(max_tokens):
            w = self.siguiente(toks, temperatura, top_k, top_p, rng)
            toks.append(w)
            if w == FIN:
                break
        return ' '.join(toks)

    def perplejidad(self, frase):
        """Cuánto «se sorprende» el modelo con una frase (menor = más esperable)."""
        toks = frase.split()
        lp = 0.0
        n = 0
        for i in range(len(toks)):
            p = self.probabilidades(toks[:i]).get(toks[i], 1e-4) if i > 0 else None
            if p is None:
                continue
            lp += math.log(p)
            n += 1
        return math.exp(-lp / max(n, 1))

    def __repr__(self):
        return 'ModeloNgramas(n=%d, vocabulario=%d)' % (self.n, len(self.vocab))


_CUENTOS = {}


def modelo_cuentos(n=2):
    """Modelo de n-gramas ya entrenado con las frases de ``dojo_ai.corpus.CUENTOS``."""
    if n not in _CUENTOS:
        from dojo_ai.corpus import CUENTOS
        _CUENTOS[n] = ModeloNgramas.entrenar(CUENTOS, n)
    return _CUENTOS[n]
