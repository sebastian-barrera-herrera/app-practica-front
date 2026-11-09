"""Un «LLM» simulado con la misma forma que las API reales (estilo OpenAI), para practicar prompts, RAG y agentes sin red ni claves.

**Es un simulador, no un modelo de lenguaje.** No genera texto con una red neuronal: aplica reglas y heurísticas deterministas
(léxicos, embeddings de juguete, plantillas) a los mensajes. Sirve para que el CÓDIGO que escribes alrededor del modelo
—construir mensajes, plantillas de prompt, bucles de herramientas, validación de JSON, evaluación— sea exactamente el que
usarías con un proveedor real, y para reproducir de forma controlada comportamientos típicos de los LLM: obedecer
instrucciones de sistema, aprender del contexto con ejemplos, razonar mejor «paso a paso», alucinar sin contexto,
citar fuentes, llamar a herramientas o dejarse engañar por una inyección de prompt.

    from dojo_ai.llm import Client
    client = Client()
    r = client.chat.completions.create(
        model="dojo-mini",
        messages=[{"role": "system", "content": "Eres un asistente breve."},
                  {"role": "user", "content": "Hola"}],
        temperature=0,
    )
    print(r.choices[0].message.content, r.usage.total_tokens)

Modelos: ``dojo-mini`` (barato, razona peor, se deja engañar por inyecciones directas) y ``dojo-pro`` (caro, razona
mejor y resiste inyecciones directas). Ver ``MODELOS``. Con un proveedor real cambiarías solo el cliente y el nombre del modelo.
"""
import json
import re

import numpy as np

from dojo_ai._lexicon import GROUPS, STOPWORDS
from dojo_ai.corpus import FAQ
from dojo_ai.embeddings import embed, embed_palabra, raiz, tokens as _tokens
from dojo_ai.tokenizer import contar_tokens

MODELOS = {
    'dojo-mini': {'contexto': 4096, 'precio_entrada': 0.15, 'precio_salida': 0.60, 'ms_primer_token': 250, 'ms_por_token': 12, 'razona': False, 'resiste_inyeccion': False},
    'dojo-pro': {'contexto': 16384, 'precio_entrada': 3.00, 'precio_salida': 15.00, 'ms_primer_token': 600, 'ms_por_token': 30, 'razona': True, 'resiste_inyeccion': True},
}
"""Características de cada modelo. Los precios son dólares por millón de tokens."""


# ───────────────────────── errores y objetos de respuesta ─────────────────────────


class APIError(Exception):
    """Error genérico de la API."""


class BadRequestError(APIError):
    """Petición mal formada (rol desconocido, temperatura fuera de rango…)."""


class ContextLengthExceededError(BadRequestError):
    """El prompt (más ``max_tokens``) no cabe en la ventana de contexto del modelo."""


class RateLimitError(APIError):
    """Demasiadas peticiones: hay que reintentar más tarde."""


class _Obj:
    """Objeto con atributos que también se lee como diccionario (``r.choices[0]`` y ``r["choices"]``)."""

    def __init__(self, **kw):
        self.__dict__.update(kw)

    def __getitem__(self, k):
        return self.__dict__[k]

    def get(self, k, defecto=None):
        return self.__dict__.get(k, defecto)

    def to_dict(self):
        return {k: _plano(v) for k, v in self.__dict__.items()}

    model_dump = to_dict

    def __repr__(self):
        return '%s(%s)' % (type(self).__name__, ', '.join('%s=%r' % (k, v) for k, v in self.__dict__.items()))


def _plano(v):
    if isinstance(v, _Obj):
        return v.to_dict()
    if isinstance(v, list):
        return [_plano(x) for x in v]
    if isinstance(v, dict):
        return {k: _plano(x) for k, x in v.items()}
    return v


class ChatCompletion(_Obj):
    pass


class Choice(_Obj):
    pass


class Message(_Obj):
    pass


class ToolCall(_Obj):
    pass


class Function(_Obj):
    pass


class Usage(_Obj):
    pass


class Chunk(_Obj):
    pass


# ───────────────────────── utilidades de texto ─────────────────────────

NEGACIONES = ('no', 'nunca', 'sin', 'ni', 'tampoco', 'jamas')
_MUTA = ('cancel', 'elimin', 'borr', 'anul', 'modific', 'actualiz', 'envia', 'mand', 'pagar', 'comprar', 'reserv', 'escrib')
_COMUNES = {'hace', 'hacer', 'tiene', 'tienen', 'puede', 'pueden', 'cada', 'sobre', 'segun', 'desde', 'como', 'donde', 'cuando', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'quiero', 'quiere', 'necesito', 'saber', 'dame', 'dime', 'favor', 'tienda', 'cliente', 'usuario', 'datos', 'dato', 'informacion'}


def _n(s):
    """Minúsculas y sin acentos."""
    import unicodedata
    s = unicodedata.normalize('NFD', s.lower())
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn')


def _contenido(m):
    c = m.get('content')
    if c is None:
        return ''
    return c if isinstance(c, str) else str(c)


def _frases(texto):
    partes = re.split(r'(?<=[.!?])\s+|\n+', texto.strip())
    return [p.strip() for p in partes if p.strip()]


def _num(s):
    s = s.replace(',', '.')
    v = float(s)
    return int(v) if v == int(v) else v


def _lista(txt):
    return [x.strip(' "\'`.') for x in re.split(r',|\by\b|\bo\b|/|\|', txt) if x.strip(' "\'`.')]


def tokens_de(mensajes):
    """Tokens que ocupa una lista de mensajes (con 4 de sobrecarga por mensaje, como las API reales)."""
    total = 0
    for m in mensajes:
        d = m.to_dict() if isinstance(m, _Obj) else m
        total += 4 + contar_tokens(_contenido(d))
        if d.get('tool_calls'):
            total += contar_tokens(json.dumps(d['tool_calls'], ensure_ascii=False))
    return total + 2


def coste(uso, modelo='dojo-mini'):
    """Dólares que cuesta una respuesta a partir de su ``usage`` (o de un diccionario con ``prompt_tokens`` y ``completion_tokens``)."""
    e = uso['prompt_tokens']
    s = uso['completion_tokens']
    m = MODELOS[modelo]
    return (e * m['precio_entrada'] + s * m['precio_salida']) / 1_000_000


# ───────────────────────── clasificación (aprendizaje en contexto) ─────────────────────────

_POS = ('maravill', 'excelent', 'genial', 'perfect', 'encant', 'recomiend', 'content', 'buen', 'estupend', 'fantastic', 'increibl', 'satisfech', 'rapid', 'comod', 'bonit', 'barat', 'gust', 'felic', 'amabl', 'util', 'mejor', 'fenomen', 'magnific', 'agradabl', 'ideal', 'calidad')
_NEG = ('horribl', 'pesim', 'desastr', 'roto', 'rota', 'rompi', 'fatal', 'defectuos', 'decepcion', 'lent', 'mal', 'terribl', 'problem', 'queja', 'incomod', 'inutil', 'peor', 'tard', 'caro', 'estafa', 'nunca', 'basura')


def _rasgos(texto):
    """Rasgos de una frase: raíces de las palabras con significado y bigramas con negación («no funciona»)."""
    toks = _tokens(texto)
    out = []
    neg = False
    for t in toks:
        tn = _n(t)
        if tn in NEGACIONES:
            neg = True
            continue
        if tn in STOPWORDS:
            continue
        r = raiz(t)
        out.append(r)
        if neg:
            out.append('NO_' + r)
            neg = False
    return out


def _sentimiento_lexico(texto):
    """Cuenta palabras positivas y negativas sin tener en cuenta negaciones ni ironía (como un modelo sin ejemplos)."""
    p = n = 0
    for t in _tokens(texto):
        tn = _n(t)
        if tn.startswith(_POS) and not tn.startswith(('malo', 'mal')):
            p += 1
        elif tn.startswith(_NEG):
            n += 1
    return p, n


# Lo que cualquier modelo general «sabe» del significado de las etiquetas habituales de atención al cliente.
_SENTIDO = {
    'envios': 'envío entrega paquete transporte llegada pedido retraso dirección',
    'devoluciones': 'devolver devolución reembolso cambio talla',
    'pagos': 'pagar pago tarjeta factura cobro cuotas precio',
    'cuenta': 'cuenta perfil contraseña correo usuario datos acceso',
    'garantia': 'garantía defecto roto averiado funcionar reparar',
    'soporte': 'ayuda atención contacto horario',
}


class _Clasificador:
    def __init__(self, etiquetas, ejemplos):
        self.etiquetas = etiquetas
        self.ejemplos = ejemplos
        self.cuentas = {e: {} for e in etiquetas}
        self.total = {e: 0 for e in etiquetas}
        for texto, et in ejemplos:
            if et not in self.cuentas:
                self.cuentas[et] = {}
                self.total[et] = 0
                self.etiquetas = list(self.etiquetas) + [et]
            for f in _rasgos(texto):
                self.cuentas[et][f] = self.cuentas[et].get(f, 0) + 1
                self.total[et] += 1
        self.vocab = {f for c in self.cuentas.values() for f in c}
        self.emb = {e: embed(e + ' ' + _SENTIDO.get(_n(e), '')) for e in self.etiquetas}

    def _prior(self, texto, et):
        """Conocimiento previo del modelo (sin ejemplos): léxico de sentimiento o parecido semántico con el nombre de la etiqueta."""
        net = _n(et)
        if net in ('positivo', 'negativo', 'neutral', 'neutro'):
            p, n = _sentimiento_lexico(texto)
            if net == 'positivo':
                return 1.5 * (p - n) + (0.5 if p > n else -0.5)
            if net == 'negativo':
                return 1.5 * (n - p) + (0.5 if n > p else -0.5)
            return 1.0 if p == n else -1.0
        return 6.0 * float(embed(texto) @ self.emb[et])

    def predecir(self, texto):
        f = [x for x in _rasgos(texto) if x in self.vocab]
        mejor = None
        puntos = {}
        L = len(self.etiquetas)
        for et in self.etiquetas:
            s = self._prior(texto, et)
            for x in f:
                tot_x = sum(self.cuentas[e].get(x, 0) for e in self.etiquetas)
                s += 1.4 * np.log((self.cuentas[et].get(x, 0) + 0.3) / (tot_x + 0.3 * L))
            puntos[et] = s
            if mejor is None or s > puntos[mejor]:
                mejor = et
        return mejor, puntos


# ───────────────────────── extracción de datos (modo JSON) ─────────────────────────

PRODUCTOS = ['zapatillas', 'auriculares', 'portátil', 'camiseta', 'camisetas', 'cargador', 'teclado', 'ratón', 'mochila', 'reloj', 'tablet', 'móvil', 'pantalla', 'gorra', 'gorras', 'botella', 'sudadera', 'chaqueta', 'altavoz', 'monitor']
CIUDADES = ['Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Málaga', 'Zaragoza', 'Lisboa', 'París', 'Roma', 'Berlín', 'Londres', 'Buenos Aires', 'Bogotá', 'Lima', 'Santiago', 'Tokio']
_NUM_PALABRAS = {'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10}
_RE_ID = re.compile(r'\b[A-Z]{2,4}-\d{3,8}\b')
_RE_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_RE_FECHA = re.compile(r'\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} de [a-záéíóú]+(?: de \d{4})?)\b', re.I)
_RE_IMPORTE = re.compile(r'(?:(\d+(?:[.,]\d+)?)\s*(?:€|euros?|eur\b))|(?:€\s*(\d+(?:[.,]\d+)?))', re.I)


def _producto(texto):
    t = _n(texto)
    mejor = None
    for p in PRODUCTOS:
        i = t.find(_n(p))
        if i >= 0 and (mejor is None or i < mejor[0]):
            mejor = (i, p)
    return mejor[1] if mejor else None


def _cantidad(texto):
    m = re.search(r'\b(\d+)\s*(?:x\s*)?(?:unidades?|uds?\b|pares?\b|' + '|'.join(_n(p) for p in PRODUCTOS) + r')', _n(texto))
    if m:
        return int(m.group(1))
    m = re.search(r'\b(' + '|'.join(_NUM_PALABRAS) + r')\s+(?:pares?\s+de\s+)?(?:' + '|'.join(_n(p) for p in PRODUCTOS) + ')', _n(texto))
    if m:
        return _NUM_PALABRAS[m.group(1)]
    return 1 if _producto(texto) else None


def _importe(texto):
    m = _RE_IMPORTE.search(texto)
    if m:
        return _num(m.group(1) or m.group(2))
    return None


def _ciudad(texto):
    for c in CIUDADES:
        if _n(c) in _n(texto):
            return c
    return None


def _nombre(texto):
    m = re.search(r'(?:me llamo|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)', texto)
    return m.group(1) if m else None


def _urgencia(texto):
    t = _n(texto)
    if any(w in t for w in ('urgente', 'inmediat', 'cuanto antes', 'ya mismo', 'hoy mismo', 'urgencia', 'de inmediato')):
        return 'alta'
    return 'baja'


def _extraer_clave(clave, texto, etiquetas, ejemplos):
    k = _n(clave)
    if any(s in k for s in ('pedido', 'orden', 'order', 'ticket')) or k in ('id', 'codigo', 'referencia'):
        m = _RE_ID.search(texto)
        return m.group(0) if m else None
    if any(s in k for s in ('producto', 'articulo', 'item')):
        return _producto(texto)
    if any(s in k for s in ('cantidad', 'unidades', 'numero_de')):
        return _cantidad(texto)
    if any(s in k for s in ('importe', 'precio', 'total', 'coste', 'monto')):
        return _importe(texto)
    if 'fecha' in k or 'date' in k:
        m = _RE_FECHA.search(texto)
        return m.group(0) if m else None
    if 'email' in k or 'correo' in k:
        m = _RE_EMAIL.search(texto)
        return m.group(0) if m else None
    if any(s in k for s in ('nombre', 'cliente', 'name')):
        return _nombre(texto)
    if any(s in k for s in ('ciudad', 'city', 'lugar', 'destino')):
        return _ciudad(texto)
    if any(s in k for s in ('urgen', 'prioridad', 'priority')):
        return _urgencia(texto)
    if any(s in k for s in ('sentimiento', 'sentiment', 'tono')):
        return _Clasificador(['positivo', 'negativo', 'neutral'], ejemplos).predecir(texto)[0]
    if any(s in k for s in ('categoria', 'tema', 'tipo', 'motivo', 'category')):
        et = etiquetas or ['envíos', 'devoluciones', 'pagos', 'cuenta', 'garantía', 'soporte']
        return _Clasificador(et, ejemplos).predecir(texto)[0]
    if any(s in k for s in ('resumen', 'summary')):
        f = _frases(texto)
        return f[0] if f else texto
    return None


# ───────────────────────── problemas de aritmética con enunciado ─────────────────────────

_VERBOS_MAS = r'compra|compró|gana|ganó|recibe|recibió|añade|añadió|suma|sumó|llegan|llegaron|reponen|repone'
_VERBOS_MENOS = r'vende|vendió|regala|regaló|pierde|perdió|gasta|gastó|se lleva|se llevó|quita|quitó|retira|retiró|devuelve|devolvió|se rompen|se rompieron'


def _resolver_problema(texto):
    """Devuelve (pasos, resultado) si reconoce el enunciado; ``None`` si no. Dos familias: compras con precios e inventario."""
    t = texto.replace('\n', ' ').lower()
    pares = re.findall(r'(\d+)\s+[\w áéíóúñ]*?\s*de\s+(\d+(?:[.,]\d+)?)\s*(?:euros|€)\s*cada', t)
    if len(pares) >= 1 and re.search(r'cuánt[oa]s?\s+(?:paga|cuesta|cobra|gasta|es|debe)', t):
        pasos = []
        subtotales = []
        for i, (q, p) in enumerate(pares, 1):
            q, p = _num(q), _num(p)
            sub = q * p
            subtotales.append(sub)
            pasos.append('Paso %d: %s × %s = %s' % (i, q, p, _fmt(sub)))
        total = sum(subtotales)
        if len(subtotales) > 1:
            pasos.append('Paso %d: %s = %s' % (len(pares) + 1, ' + '.join(_fmt(s) for s in subtotales), _fmt(total)))
        return pasos, total, subtotales[0]
    m = re.search(r'(?:tiene|tienen|hay|tengo|empieza con|comienza con)\s+(\d+)', t)
    if m and re.search(r'cuánt[oa]s?', t):
        base = int(m.group(1))
        resto = t[m.end():]
        ops = re.findall(r'(' + _VERBOS_MAS + '|' + _VERBOS_MENOS + r')\s+(\d+)', resto)
        if ops:
            pasos = []
            actual = base
            primera = None
            for i, (v, n) in enumerate(ops, 1):
                n = int(n)
                if re.fullmatch(_VERBOS_MAS, v):
                    nuevo = actual + n
                    pasos.append('Paso %d: %d + %d = %d' % (i, actual, n, nuevo))
                else:
                    nuevo = actual - n
                    pasos.append('Paso %d: %d − %d = %d' % (i, actual, n, nuevo))
                if primera is None:
                    primera = nuevo
                actual = nuevo
            return pasos, actual, primera
    return None


def _fmt(x):
    if isinstance(x, float) and x == int(x):
        x = int(x)
    return str(x)


# ───────────────────────── conocimiento general mínimo ─────────────────────────

CAPITALES = {'francia': 'París', 'espana': 'Madrid', 'italia': 'Roma', 'alemania': 'Berlín', 'portugal': 'Lisboa', 'mexico': 'Ciudad de México', 'argentina': 'Buenos Aires', 'japon': 'Tokio', 'chile': 'Santiago', 'peru': 'Lima', 'colombia': 'Bogotá', 'reino unido': 'Londres'}
NOMBRES_PAIS = {'espana': 'España', 'mexico': 'México', 'japon': 'Japón', 'peru': 'Perú'}
DEFINICIONES = {
    'token': 'Un token es un fragmento de texto (una palabra, parte de una palabra o un signo) que el modelo trata como unidad.',
    'embedding': 'Un embedding es un vector de números que representa un texto de modo que lo parecido queda cerca.',
    'rag': 'RAG (generación aumentada por recuperación) consiste en buscar documentos relevantes y dárselos al modelo en el prompt para que responda con ellos.',
    'alucinación': 'Una alucinación es una respuesta fluida pero falsa o inventada.',
    'prompt': 'El prompt es el texto de entrada, con instrucciones y datos, que se le da al modelo.',
    'agente': 'Un agente es un sistema que usa un modelo de lenguaje en bucle: decide, llama a herramientas, observa el resultado y repite hasta cumplir el objetivo.',
}


def _perturbar(texto, rng, temperatura):
    """Cambia las cifras de un texto por otras verosímiles: así «alucina» un modelo que no tiene el dato."""
    alt = {30: 14, 5: 3, 7: 10, 3: 2, 50: 30, 24: 48, 100: 200, 2: 1, 10: 15, 500: 1000, 14: 21, 9: 8, 18: 20}

    def cambia(m):
        s = m.group(0)
        if ',' in s:
            return '%d,%02d' % (int(float(s.replace(',', '.'))) + 1, 90)
        n = int(s)
        base = alt.get(n, n + 2)
        if temperatura >= 0.6 and rng.rand() < 0.5:
            base = base + int(rng.randint(1, 4))
        return str(base)

    return re.sub(r'\d+(?:,\d+)?', cambia, texto)


# ───────────────────────── el cliente ─────────────────────────


class _Completions:
    def __init__(self, cliente):
        self._c = cliente

    def create(self, model=None, messages=None, temperature=1.0, max_tokens=None, top_p=1.0, stop=None, seed=None,
               tools=None, tool_choice='auto', response_format=None, stream=False, n=1, **extra):
        return self._c._crear(model, messages, temperature, max_tokens, stop, seed, tools, tool_choice, response_format, stream)


class _Chat:
    def __init__(self, cliente):
        self.completions = _Completions(cliente)


class _Embeddings:
    def __init__(self, cliente):
        self._c = cliente

    def create(self, model='dojo-embed', input=None, **extra):
        textos = [input] if isinstance(input, str) else list(input)
        datos = [_Obj(object='embedding', index=i, embedding=[float(x) for x in embed(t)]) for i, t in enumerate(textos)]
        n = sum(contar_tokens(t) for t in textos)
        self._c.llamadas += 1
        return _Obj(object='list', model=model, data=datos, usage=Usage(prompt_tokens=n, total_tokens=n))


class Client:
    """Cliente del LLM simulado (equivalente a ``openai.OpenAI()``).

    ``fallos_iniciales=2`` hace que las dos primeras llamadas lancen ``RateLimitError``, para practicar reintentos.
    ``semilla`` cambia la serie de variaciones cuando se usa temperatura > 0 sin ``seed``.
    """

    def __init__(self, fallos_iniciales=0, semilla=0):
        self.chat = _Chat(self)
        self.embeddings = _Embeddings(self)
        self.fallos_iniciales = fallos_iniciales
        self.semilla = semilla
        self.llamadas = 0
        self.registro = []

    def __repr__(self):
        return 'Client(llamadas=%d)' % self.llamadas

    # ---- validación y utilidades ----
    def _crear(self, model, messages, temperature, max_tokens, stop, seed, tools, tool_choice, response_format, stream):
        self.llamadas += 1
        if self.fallos_iniciales > 0:
            self.fallos_iniciales -= 1
            raise RateLimitError('Demasiadas peticiones (429). Espera un poco y reintenta.')
        model = model or 'dojo-mini'
        if model not in MODELOS:
            raise BadRequestError("El modelo %r no existe. Modelos disponibles: %s" % (model, ', '.join(MODELOS)))
        if not messages:
            raise BadRequestError("'messages' no puede estar vacío")
        msgs = []
        for m in messages:
            d = m.to_dict() if isinstance(m, _Obj) else dict(m)
            if d.get('role') not in ('system', 'user', 'assistant', 'tool'):
                raise BadRequestError("Rol no válido: %r (usa system, user, assistant o tool)" % (d.get('role'),))
            msgs.append(d)
        if not 0 <= temperature <= 2:
            raise BadRequestError('temperature debe estar entre 0 y 2 (recibido %s)' % temperature)
        if max_tokens is not None and max_tokens < 1:
            raise BadRequestError('max_tokens debe ser mayor que 0')
        spec = MODELOS[model]
        n_prompt = tokens_de(msgs)
        if n_prompt + (max_tokens or 0) > spec['contexto']:
            raise ContextLengthExceededError("La longitud máxima de contexto de %s es %d tokens; la petición ocupa %d (prompt) + %d (max_tokens)." % (model, spec['contexto'], n_prompt, max_tokens or 0))
        if seed is not None:
            rng = np.random.RandomState(seed % (2 ** 31))
        else:
            rng = np.random.RandomState((self.semilla * 1000003 + self.llamadas * 7919) % (2 ** 31))
        cerebro = _Cerebro(model, spec, msgs, float(temperature), rng, tools, tool_choice, response_format)
        contenido, llamadas, fin = cerebro.responder()
        if stop and contenido:
            for s in ([stop] if isinstance(stop, str) else stop):
                i = contenido.find(s)
                if i >= 0:
                    contenido = contenido[:i]
                    fin = 'stop'
        if max_tokens is not None and contenido:
            recortado = _recortar_tokens(contenido, max_tokens)
            if recortado != contenido:
                contenido, fin = recortado, 'length'
        n_out = contar_tokens(contenido) if contenido else contar_tokens(json.dumps([c.function.to_dict() for c in llamadas], ensure_ascii=False)) if llamadas else 0
        uso = Usage(prompt_tokens=n_prompt, completion_tokens=n_out, total_tokens=n_prompt + n_out)
        ms = spec['ms_primer_token'] + spec['ms_por_token'] * n_out
        msg = Message(role='assistant', content=contenido if contenido else None, tool_calls=llamadas if llamadas else None)
        r = ChatCompletion(id='chatcmpl-%06d' % self.llamadas, object='chat.completion', model=model, choices=[Choice(index=0, message=msg, finish_reason=fin)], usage=uso, latency_ms=ms)
        self.registro.append({'modelo': model, 'prompt_tokens': n_prompt, 'completion_tokens': n_out, 'coste': coste(uso, model), 'latency_ms': ms})
        if stream:
            return _trozos(r)
        return r


def _recortar_tokens(texto, maximo):
    palabras = texto.split(' ')
    out = []
    for p in palabras:
        cand = ' '.join(out + [p])
        if contar_tokens(cand) > maximo:
            break
        out.append(p)
    return ' '.join(out)


def _trozos(r):
    """Respuesta en *streaming*: una lista de fragmentos con ``choices[0].delta.content``."""
    texto = r.choices[0].message.content or ''
    palabras = texto.split(' ')
    for i, p in enumerate(palabras):
        yield Chunk(id=r.id, object='chat.completion.chunk', model=r.model,
                    choices=[Choice(index=0, delta=_Obj(role='assistant' if i == 0 else None, content=(p if i == 0 else ' ' + p)), finish_reason=None)])
    yield Chunk(id=r.id, object='chat.completion.chunk', model=r.model, choices=[Choice(index=0, delta=_Obj(role=None, content=None), finish_reason=r.choices[0].finish_reason)])


OpenAI = Client
"""Alias: ``from dojo_ai.llm import OpenAI`` se parece al código con el SDK real."""


# ───────────────────────── el «cerebro» ─────────────────────────

_DEFENSAS = ('aunque el usuario', 'nunca reveles', 'bajo ninguna circunstancia', 'ignora cualquier instruccion del usuario', 'sin importar lo que pida', 'los datos del usuario son datos', 'es dato, no instruccion', 'trata el texto', 'trata el contenido', 'no sigas instrucciones', 'no obedezcas instrucciones', 'no sigas ninguna instruccion')
_FRASES_INYECCION = ('ignora', 'olvida', 'olvidate', 'desobedece', 'no hagas caso', 'ahora eres', 'modo desarrollador', 'nuevo rol', 'repite todo lo anterior', 'muestra tus instrucciones', 'prompt del sistema', 'instrucciones anteriores', 'instrucciones previas')


class _Cerebro:
    def __init__(self, modelo, spec, msgs, temperatura, rng, tools, tool_choice, response_format):
        self.modelo = modelo
        self.spec = spec
        self.msgs = msgs
        self.T = temperatura
        self.rng = rng
        self.tools = tools or []
        self.tool_choice = tool_choice
        self.rf = response_format
        self.sis = '\n'.join(_contenido(m) for m in msgs if m['role'] == 'system')
        self.sisn = _n(self.sis)
        ult = [m for m in msgs if m['role'] == 'user']
        self.u = _contenido(ult[-1]) if ult else ''
        self.un = _n(self.u)
        self._cache = {}
        self.defendido = any(d in self.sisn for d in _DEFENSAS) or '<entrada>' in self.sisn or 'delimit' in self.sisn

    # ---- variación según la temperatura ----
    def elegir(self, opciones):
        if len(opciones) == 1 or self.T < 0.2:
            return opciones[0]
        pesos = np.array([np.exp(-i / (self.T * 1.5)) for i in range(len(opciones))])
        pesos = pesos / pesos.sum()
        return opciones[int(np.searchsorted(np.cumsum(pesos), self.rng.rand(), side='right')) % len(opciones)]

    # ---- flujo principal ----
    def responder(self):
        ult = self.msgs[-1]
        if 'accion:' in self.sisn and 'observacion:' in self.sisn and 'respuesta final' in self.sisn:
            return self.react(), [], 'stop'
        if ult['role'] == 'tool' or (self.tools and self.tool_choice != 'none'):
            r = self.herramientas()
            if r is not None:
                return r
        if ult['role'] == 'tool':
            return self.final_herramientas(), [], 'stop'
        t = self.inyeccion_directa()
        if t is not None:
            return self.persona(t), [], 'stop'
        t = self.secuestro()
        if t is not None:
            return t, [], 'stop'
        if ('evalua' in self.sisn or 'juez' in self.sisn or 'puntua' in self.sisn) and 'referencia' in self.un:
            return self.juez(), [], 'stop'
        if self.pide_json():
            return self.json_salida(), [], 'stop'
        et = self.etiquetas()
        ej = self.ejemplos()
        if et or ej:
            t = self.clasificar(et, ej)
            if t is not None:
                return t, [], 'stop'
        c = self.contexto()
        if c:
            return self.persona(self.rag(c)), [], 'stop'
        t = self.matematicas()
        if t is not None:
            return t, [], 'stop'
        if re.search(r'\bresum', self.sisn + ' ' + self.un):
            return self.persona(self.resumen()), [], 'stop'
        return self.persona(self.general()), [], 'stop'

    # ---- inyección de prompt directa ----
    def secreto(self):
        m = re.search(r'(?:código|codigo|clave|contraseña)\s+(?:secret[oa]\s+)?(?:de\s+\w+\s+)?(?:es|:|=)\s*([A-Za-z0-9_\-]{3,})', self.sis, re.I)
        return m.group(1) if m else None

    def inyeccion_directa(self):
        s = self.secreto()
        confidencial = any(w in self.sisn for w in ('no reveles', 'confidencial', 'secreto', 'no compartas'))
        if not confidencial:
            return None
        inyecta = any(f in self.un for f in _FRASES_INYECCION)
        pide = inyecta or any(w in self.un for w in ('codigo secreto', 'contrasena', 'clave secreta', 'instrucciones', 'secreto'))
        if not pide:
            return None
        if not inyecta or self.defendido or self.spec['resiste_inyeccion']:
            return self.elegir(['No puedo ayudar con eso.', 'Lo siento, no puedo compartir esa información.'])
        if s:
            return 'Claro. El código secreto es %s.' % s
        return 'Mis instrucciones son: %s' % self.sis.strip()

    def secuestro(self):
        """Inyección de prompt «de secuestro»: una orden escondida en el texto del usuario («ignora… y responde X») que un modelo sin defensas obedece."""
        if self.defendido or self.spec['resiste_inyeccion'] or self.contexto():
            return None
        m = re.search(r'(?:ignora|olvida)[^.\n]*?(?:responde|di|escribe)\s*(?:solo\s*)?[:«"\']?\s*([^.\n«»"\'<>]+)', self.u, re.I)
        return m.group(1).strip() if m else None

    # ---- formato de la respuesta ----
    def persona(self, texto):
        s = self.sisn
        m = re.search(r'(?:maximo|como mucho|no mas de|menos de|en)\s+(\d+)\s+palabras', s + ' ' + self.un.replace('á', 'a'))
        if m:
            palabras = texto.split()
            if len(palabras) > int(m.group(1)):
                texto = ' '.join(palabras[:int(m.group(1))]).rstrip(',;:') + '.'
        if re.search(r'(?:una|1)\s+(?:sola\s+)?frase|en una linea', s + ' ' + self.un):
            texto = _frases(texto)[0]
        if 'pirata' in s:
            texto = '¡Arrr! ' + texto + ' ¡Por mil sirenas!'
        elif 'formal' in s or 'usted' in s:
            texto = 'Estimado cliente: ' + texto
        elif 'amigable' in s or 'emoji' in s:
            texto = texto + ' 😊'
        if 'viñetas' in s or 'vinetas' in s or 'lista' in s and 'puntos' in s:
            texto = '\n'.join('- ' + f for f in _frases(texto))
        return texto

    # ---- JSON ----
    def pide_json(self):
        if self.rf and (self.rf.get('type') if isinstance(self.rf, dict) else None) in ('json_object', 'json_schema'):
            return True
        return 'json' in self.sisn or 'json' in self.un

    def claves(self):
        t = self.sis + '\n' + self.u
        ej = re.findall(r'"(\w+)"\s*:', t)
        if ej:
            vistas = []
            for k in ej:
                if k not in vistas:
                    vistas.append(k)
            return vistas
        m = re.search(r'(?:claves|campos|keys)\s*(?:[:=]|son|como)?\s*([\w, ]+?)(?:\.|\n|$| y devuelve| con )', t, re.I)
        if m:
            return [k.strip() for k in re.split(r',|\by\b', m.group(1)) if k.strip()]
        return ['respuesta']

    def json_salida(self):
        texto = self.texto_dato()
        et = self.etiquetas()
        ej = self.ejemplos()
        datos = {}
        for k in self.claves():
            datos[k] = _extraer_clave(k, texto, et, ej)
        if datos == {'respuesta': None}:
            datos = {'respuesta': self.general()}
        js = json.dumps(datos, ensure_ascii=False)
        modo_json = bool(self.rf) and isinstance(self.rf, dict) and self.rf.get('type') in ('json_object', 'json_schema')
        if modo_json:
            return js
        if self.T >= 1.5 and self.rng.rand() < 0.5:
            return js[:-1] + ',}'           # JSON inválido: con temperatura alta y sin modo JSON puede fallar
        return 'Aquí tienes el resultado en JSON:\n```json\n%s\n```' % js

    def texto_dato(self):
        """El texto sobre el que se pide trabajar: lo que sigue a «Texto:» / «Mensaje:» o, si no, el último mensaje."""
        m = re.search(r'(?:texto|mensaje|reseña|resena|correo|ticket|pedido|opinión|opinion)\s*:\s*(.+)$', self.u, re.I | re.S)
        if m:
            return m.group(1).strip().strip('"“”«»')
        m = re.search(r'<entrada>(.*?)</entrada>', self.u, re.S)
        if m:
            return m.group(1).strip()
        return self.u

    # ---- clasificación ----
    def etiquetas(self):
        t = self.sis + '\n' + self.u
        m = re.search(r'(?:etiquetas?|categor[ií]as?|clases?|opciones)(?:\s+(?:posibles|v[aá]lidas))?\s*[:=]\s*([^\n.]+)', t, re.I)
        if m:
            return _lista(m.group(1))
        m = re.search(r'clasifica[^\n:]*\bcomo\s+([^\n.:]+)', t, re.I)
        if m:
            return _lista(m.group(1))
        if re.search(r'sentimiento|opini[oó]n|rese[ñn]a', t, re.I) and re.search(r'clasifica|indica|determina|eval[uú]a', t, re.I):
            return ['positivo', 'negativo', 'neutral']
        return []

    def ejemplos(self):
        """Ejemplos dentro del prompt (few-shot): pares usuario/asistente del historial o bloques «Texto: … Etiqueta: …»."""
        out = []
        msgs = self.msgs
        ultimo_u = max((i for i, m in enumerate(msgs) if m['role'] == 'user'), default=-1)
        i = 0
        while i < ultimo_u:
            if msgs[i]['role'] == 'user' and i + 1 < len(msgs) and msgs[i + 1]['role'] == 'assistant':
                resp = _contenido(msgs[i + 1]).strip()
                if 0 < len(resp) <= 40 and len(resp.split()) <= 3 and not msgs[i + 1].get('tool_calls'):
                    out.append((_contenido(msgs[i]), resp.strip('.')))
                i += 2
            else:
                i += 1
        t = self.sis + '\n' + self.u
        for a, b in re.findall(r'(?:Texto|Rese[ñn]a|Opini[oó]n|Mensaje|Entrada|Ticket)\s*:\s*(.+?)\s*\n\s*(?:Etiqueta|Sentimiento|Categor[ií]a|Clase|Salida|Respuesta)\s*:\s*([^\n]+)', t):
            if b.strip():
                out.append((a, b.strip().strip('.')))
        for a, b in re.findall(r'["“«](.+?)["”»]\s*(?:->|→|=>)\s*([^\n]+)', t):
            out.append((a, b.strip().strip('.')))
        return out

    def clasificar(self, etiquetas, ejemplos):
        texto = self.texto_dato()
        # si hay ejemplos de chat, el dato a clasificar es el último mensaje del usuario
        if not etiquetas:
            etiquetas = sorted({e for _, e in ejemplos})
        if not etiquetas:
            return None
        clf = _Clasificador(etiquetas, ejemplos)
        et, _ = clf.predecir(texto)
        solo = ejemplos and all(len(e) <= 20 for _, e in ejemplos)
        pide = self.sisn + ' ' + self.un
        if ('solo' in pide and any(w in pide for w in ('etiqueta', 'palabra', 'categoria', 'clase'))) or solo:
            return et
        if set(map(_n, etiquetas)) <= {'positivo', 'negativo', 'neutral', 'neutro'}:
            return self.elegir(['El sentimiento es «%s».' % et, 'Yo diría que es «%s».' % et])
        return self.elegir(['Creo que la categoría es «%s».' % et, 'Yo lo clasificaría como «%s».' % et])

    # ---- matemáticas con enunciado ----
    def matematicas(self):
        r = _resolver_problema(self.u)
        if r is None:
            m = re.fullmatch(r'\s*(?:cu[aá]nto es\s*)?(\d+(?:[.,]\d+)?)\s*([+\-*/x×])\s*(\d+(?:[.,]\d+)?)\s*\??\s*', self.u.lower())
            if m:
                a, op, b = _num(m.group(1)), m.group(2), _num(m.group(3))
                v = {'+': a + b, '-': a - b, '*': a * b, 'x': a * b, '×': a * b, '/': (a / b if b else float('nan'))}[op]
                return 'El resultado es %s.' % _fmt(round(v, 6) if isinstance(v, float) else v)
            return None
        pasos, total, primero = r
        piensa = any(w in self.sisn + ' ' + self.un for w in ('paso a paso', 'razona', 'piensa', 'explica tu razonamiento', 'desglosa'))
        if piensa:
            return '\n'.join(pasos) + '\nRespuesta: %s.' % _fmt(total)
        if self.spec['razona']:
            return 'La respuesta es %s.' % _fmt(total)
        return self.persona(self.elegir(['La respuesta es %s.' % _fmt(primero), 'Son %s.' % _fmt(primero)]))

    # ---- RAG ----
    def contexto(self):
        t = self.u
        pasajes = []
        for n, txt in re.findall(r'^\s*\[(\d+)\]\s*(.+)$', t, re.M):
            pasajes.append((int(n), txt.strip()))
        if not pasajes:
            for n, txt in re.findall(r'^\s*(?:Fuente|Documento|Pasaje)\s*(\d+)\s*[:.\-]\s*(.+)$', t, re.M | re.I):
                pasajes.append((int(n), txt.strip()))
        if not pasajes:
            m = re.search(r'(?:contexto|fuentes|documentos)\s*:\s*\n?(.*?)(?:\n\s*(?:pregunta|consulta)\s*:|$)', t, re.S | re.I)
            if m and m.group(1).strip():
                bloques = [b.strip() for b in re.split(r'\n\s*\n', m.group(1)) if b.strip()]
                pasajes = [(i + 1, b) for i, b in enumerate(bloques)]
        return pasajes

    def pregunta(self):
        m = re.findall(r'(?:pregunta|consulta)\s*:\s*(.+)', self.u, re.I)
        if m:
            return m[-1].strip()
        lineas = [l for l in self.u.strip().split('\n') if l.strip()]
        return lineas[-1].strip() if lineas else self.u

    def rag(self, pasajes):
        q = self.pregunta()
        qv = embed(q)
        qraices = {raiz(t) for t in _tokens(q) if len(t) >= 4 and _n(t) not in STOPWORDS and _n(t) not in _COMUNES}
        por_frase = {}
        for n, txt in pasajes:
            for fr in _frases(txt):
                if self.defendido and 'ignora' in _n(fr) and 'instrucciones' in _n(fr):
                    continue                # con defensa, el contexto se trata como datos y no como órdenes
                if fr not in por_frase:
                    por_frase[fr] = [float(qv @ embed(fr)), []]
                if n not in por_frase[fr][1]:
                    por_frase[fr][1].append(n)
        cand = sorted(((v[0], min(v[1]), fr) for fr, v in por_frase.items()), key=lambda c: (-c[0], c[1]))
        cita = 'cita' in self.sisn + ' ' + self.un.lower() or 'fuente' in self.sisn
        anclado = any(w in self.sisn for w in ('solo con el contexto', 'solo con la informacion', 'unicamente', 'exclusivamente', 'no lo se', 'solo el contexto', 'basandote solo', 'basate solo', 'solo usando'))

        def solape(fr):
            return len(qraices & {raiz(t) for t in _tokens(fr) if len(t) >= 4})

        if not cand or cand[0][0] < 0.30 or (cand[0][0] < 0.60 and solape(cand[0][2]) == 0):
            if anclado:
                return self.elegir(['No lo sé con la información disponible.', 'No tengo información suficiente en los documentos para responder.'])
            return self.general()
        mejor = cand[0]
        if not self.defendido:
            for sc, n, fr in cand:
                if re.search(r'ignora|olvida', _n(fr)) and re.search(r'instrucciones', _n(fr)):
                    m = re.search(r'(?:responde|di|escribe|visita|envia)[^.:]*[:.]?\s*(.+)$', fr, re.I)
                    return (m.group(1) if m else fr).strip()
        elegidas = [mejor]
        for sc, n, fr in cand[1:]:
            if sc >= 0.9 * mejor[0] and sc >= 0.42 and solape(fr) >= 1:
                elegidas.append((sc, n, fr))
                break
        salida = ' '.join(fr for _, _, fr in elegidas)
        if cita:
            fuentes = sorted({x for _, _, fr in elegidas for x in por_frase[fr][1]})
            salida += ' ' + ' '.join('[%d]' % x for x in fuentes)
        return salida

    # ---- resumen ----
    def resumen(self):
        texto = self.texto_dato() if re.search(r'texto\s*:', self.u, re.I) else self.u
        cab = re.match(r'([^:\n]*resum[^:\n]*):\s*(.+)$', texto, re.I | re.S)
        if cab:
            texto = cab.group(2)
        fr = _frases(texto)
        fr = [f for f in fr if not re.match(r'(?i)resume', f)] or fr
        m = re.search(r'en\s+(\d+|una|dos|tres)\s+frases?', self.un)
        k = {'una': 1, 'dos': 2, 'tres': 3}.get(m.group(1), None) if m else None
        if m and k is None:
            k = int(m.group(1))
        k = k or 2
        if len(fr) <= k:
            return ' '.join(fr)
        centro = embed(' '.join(fr))
        puntos = sorted(((float(embed(f) @ centro), -i, f) for i, f in enumerate(fr)), reverse=True)[:k]
        orden = sorted(puntos, key=lambda t: -t[1])
        return ' '.join(f for _, _, f in orden)

    # ---- general ----
    def general(self):
        u = self.un
        q = self.pregunta() if self.contexto() else self.u
        if re.search(r'^\s*(hola|buenas|buenos dias|buenas tardes|hey|que tal)\b', u):
            return self.elegir(['¡Hola! Soy %s, un modelo de lenguaje simulado de Dev Dojo. ¿En qué puedo ayudarte?' % self.modelo, '¡Hola! ¿En qué te ayudo?'])
        if re.search(r'qui[eé]n eres|qu[eé] eres|c[oó]mo te llamas', u):
            return 'Soy %s, un simulador de modelo de lenguaje de Dev Dojo. No uso una red neuronal: sigo reglas para que practiques con la API.' % self.modelo
        m = re.search(r'capital de ([a-z ]+)', u)
        if not m:
            seguimiento = re.match(r'\s*y\s+(?:la\s+|el\s+)?(?:de\s+|en\s+)?([a-z ]+?)\s*\??\s*$', u.strip().lstrip('¿'))
            previo = [_n(_contenido(x)) for x in self.msgs[:-1] if x['role'] == 'user']
            if seguimiento and any('capital de' in x for x in previo):
                m = re.search(r'capital de ([a-z ]+)', 'capital de ' + seguimiento.group(1))
        if m:
            pais = m.group(1).strip(' ?¿.')
            c = CAPITALES.get(pais)
            if c:
                return 'La capital de %s es %s.' % (NOMBRES_PAIS.get(pais, pais.title()), c)
        if 'chiste' in u:
            return '¿Por qué los programadores confunden Halloween con Navidad? Porque OCT 31 = DEC 25.'
        m = re.search(r'qu[eé] es (?:un|una|el|la)?\s*([a-záéíóúñ]+)', u)
        if m and m.group(1) in DEFINICIONES:
            return DEFINICIONES[m.group(1)]
        # preguntas sobre la tienda sin contexto: el modelo no conoce DojoShop e inventa algo verosímil
        qv = embed(q)
        mejor = max(FAQ, key=lambda f: float(qv @ embed(f[2])))
        if float(qv @ embed(mejor[2])) >= 0.35:
            return self.elegir(['Normalmente %s' % _perturbar(mejor[2][0].lower() + mejor[2][1:], self.rng, self.T), _perturbar(mejor[2], self.rng, self.T)])
        return self.elegir(['No tengo información suficiente para responder con seguridad.', 'No estoy seguro: ¿puedes darme más contexto?'])

    # ---- juez ----
    def juez(self):
        ref = re.search(r'referencia\s*:\s*(.+)', self.u, re.I)
        res = re.search(r'respuesta\s*:\s*(.+)', self.u, re.I)
        if not ref or not res:
            return 'Puntuación: 3'
        sim = float(embed(ref.group(1)) @ embed(res.group(1)))
        nums_ref = set(re.findall(r'\d+', ref.group(1)))
        nums_res = set(re.findall(r'\d+', res.group(1)))
        if nums_ref and not nums_ref <= nums_res:
            sim -= 0.35
        largo = 1 if len(res.group(1).split()) > 30 else 0       # sesgo de verbosidad: los jueces LLM premian las respuestas largas
        p = int(min(5, max(1, round(1 + 4 * min(1.0, max(0.0, sim) / 0.7) + 0.6 * largo))))
        if 'json' in self.sisn:
            return json.dumps({'puntuacion': p, 'motivo': 'parecido con la referencia %.2f' % sim}, ensure_ascii=False)
        return 'Puntuación: %d' % p

    # ---- herramientas ----
    def espec(self):
        out = []
        for t in self.tools:
            f = t.get('function', t)
            out.append({'name': f['name'], 'description': f.get('description', ''), 'parameters': f.get('parameters', {'type': 'object', 'properties': {}, 'required': []})})
        return out

    def previas(self):
        """Llamadas anteriores a herramientas: lista de (nombre, argumentos, resultado)."""
        res = {}
        out = []
        for m in self.msgs:
            if m['role'] == 'tool':
                res[m.get('tool_call_id')] = _contenido(m)
        for m in self.msgs:
            for c in (m.get('tool_calls') or []):
                c = c.to_dict() if isinstance(c, _Obj) else c
                f = c['function']
                try:
                    a = json.loads(f['arguments']) if isinstance(f['arguments'], str) else f['arguments']
                except ValueError:
                    a = {}
                out.append((f['name'], a, res.get(c['id'])))
        return out

    def relevancia(self, h, texto):
        """Cuánto encaja una herramienta con la petición. Cada palabra de la petición reparte su peso entre las herramientas cuyo nombre o descripción tienen un significado parecido: las coincidencias exclusivas pesan más que las compartidas."""
        clave = ('rel', texto)
        if clave not in self._cache:
            espec = self.espec()
            dvs = {}
            for t in espec:
                desc = [w for w in _tokens(t['name'].replace('_', ' ') + ' ' + t['description']) if len(w) >= 3 and _n(w) not in STOPWORDS and _n(w) not in _COMUNES]
                dvs[t['name']] = [(raiz(w), embed_palabra(w)) for w in desc]
            pesos = {t['name']: [] for t in espec}
            for qw in _tokens(texto):
                if len(qw) < 3 or _n(qw) in STOPWORDS or _n(qw) in _COMUNES:
                    continue
                qr = raiz(qw)
                qv = embed_palabra(qw)
                ms = {}
                for nombre, dv in dvs.items():
                    m = 0.0
                    for r, v in dv:
                        if r == qr:
                            m = 1.0
                            break
                        if qv is not None and v is not None:
                            m = max(m, float(qv @ v))
                    ms[nombre] = m
                fuertes = [n for n, m in ms.items() if m >= 0.6]
                for n in fuertes:
                    pesos[n].append(ms[n] / len(fuertes))
            res = {}
            for t in espec:
                ps = sorted(pesos[t['name']], reverse=True)[:3]
                sc = sum(ps)
                hits = len(ps)
                nombre = _n(t['name'] + ' ' + t['description'])
                muta = [v for v in _MUTA if v in nombre.replace('_', ' ')]
                if muta and sc > 0 and not any(_n(qw).startswith(v) for qw in _tokens(texto) for v in muta):
                    sc *= 0.3               # una acción con efectos (cancelar, enviar…) solo se elige si la petición la pide de forma explícita
                if ('aritm' in nombre or 'operacion' in nombre or t['name'] == 'calculadora') and re.search(r'\d\s*[+\-*/x×]\s*\d', texto):
                    sc += 1.0
                    hits += 1
                res[t['name']] = (sc, hits)
            self._cache[clave] = res
        return self._cache[clave][h['name']]

    def argumento(self, nombre, esq, texto, usados, previas):
        n = _n(nombre)
        if 'enum' in esq:
            for v in esq['enum']:
                if _n(str(v)) in _n(texto):
                    return v
        tipo = esq.get('type', 'string')
        if tipo in ('integer', 'number'):
            sin_ids = _RE_ID.sub(' ', texto)
            cand = [(m.start(), m.group(0)) for m in re.finditer(r'\d+(?:[.,]\d+)?', sin_ids)]
            clave = raiz(nombre.split('_')[0])
            for pos, s in cand:
                tras = re.match(r'\s*([a-záéíóúñ]+)', _n(sin_ids[pos + len(s):pos + len(s) + 20]))
                if clave and tras and raiz(tras.group(1)) == clave and s not in usados:
                    usados.append(s)
                    return int(s) if tipo == 'integer' else _num(s)
            imp = _importe(texto)
            if imp is not None and any(w in n for w in ('importe', 'precio', 'total', 'monto', 'euros')):
                m = _RE_IMPORTE.search(texto)
                usados.append(m.group(1) or m.group(2))
                return imp
            for pos, s in cand:
                if s not in usados:
                    usados.append(s)
                    return int(float(s.replace(',', '.'))) if tipo == 'integer' else _num(s)
            return None
        if tipo == 'boolean':
            return 'si' in _n(texto).split() or 'sí' in texto.lower()
        if any(w in n for w in ('email', 'correo')):
            m = _RE_EMAIL.search(texto)
            return m.group(0) if m else None
        if any(w in n for w in ('pedido', 'order', 'id', 'codigo', 'ticket')):
            m = _RE_ID.search(texto)
            return m.group(0) if m else None
        if any(w in n for w in ('ciudad', 'city', 'lugar', 'destino')):
            return _ciudad(texto)
        if 'fecha' in n or 'date' in n:
            m = _RE_FECHA.search(texto)
            return m.group(0) if m else None
        if any(w in n for w in ('expres', 'calculo', 'operacion')):
            m = re.search(r'\d[\d\s+\-*/().,x×]*\d', texto)
            return m.group(0).strip().replace('×', '*').replace('x', '*') if m else None
        if any(w in n for w in ('consulta', 'query', 'pregunta', 'texto', 'mensaje', 'busqueda', 'tema')):
            return texto.strip()
        if 'nombre' in n:
            return _nombre(texto)
        return None

    def argumentos(self, h, texto, previas):
        """Valores para los parámetros de una herramienta (del texto del usuario o de resultados anteriores). Devuelve (args, faltantes)."""
        props = h['parameters'].get('properties', {})
        req = h['parameters'].get('required', list(props))
        args = {}
        faltan = []
        usados = []
        dep = False
        for nombre in props:
            v = self.argumento(nombre, props[nombre], texto, usados, previas)
            if v is None:
                for pn, pa, pr in previas:
                    if nombre in pa:
                        v = pa[nombre]
                    elif pr:
                        try:
                            d = json.loads(pr)
                        except ValueError:
                            d = None
                        if isinstance(d, dict) and nombre in d:
                            v = d[nombre]
                if v is not None:
                    dep = True
            if v is None and nombre in req:
                faltan.append(nombre)
            elif v is not None:
                args[nombre] = v
        return args, faltan, dep

    def clausulas(self, texto, espec):
        """Divide la petición en cláusulas; las que no mencionan nada relacionado con una herramienta se pegan a la anterior."""
        partes = re.split(r'\s*(?:[;?¿]|\by\b|\btambién\b|\bademás\b|\bluego\b|\bdespués\b)\s*', texto)
        partes = [p.strip() for p in partes if len(p.strip()) > 3] or [texto]
        out = []
        for p in partes:
            hay = any(self.relevancia(h, p)[1] >= 1 for h in espec.values())
            if hay or not out:
                out.append(p)
            else:
                out[-1] += ' ' + p
        return out

    def planificar(self, texto):
        """Qué herramientas llamar ahora: (llamadas listas, parámetros que faltan). Se decide cláusula a cláusula: cada petición del usuario pide su herramienta."""
        espec = {h['name']: h for h in self.espec()}
        previas = self.previas()
        ya = {pn for pn, pa, pr in previas}
        forzada = None
        if isinstance(self.tool_choice, dict):
            forzada = self.tool_choice.get('function', {}).get('name')
        elif self.tool_choice == 'required' and espec:
            forzada = max(espec.values(), key=lambda h: self.relevancia(h, texto)[0])['name']
        listas = []
        faltan = []
        if forzada and forzada in espec:
            args, falta, _ = self.argumentos(espec[forzada], texto, previas)
            if not falta and forzada not in ya:
                return [(forzada, args)], []
            if falta:
                return [], [(forzada, f) for f in falta]
        for cl in self.clausulas(texto, espec):
            rank = []
            for h in espec.values():
                sc, hits = self.relevancia(h, cl)
                if hits >= 1:
                    rank.append((sc, h))
            rank.sort(key=lambda t: (-t[0], t[1]['name']))
            if not rank:
                continue
            tope = rank[0][0]
            elegido = None
            pendiente = None
            for sc, h in rank:
                if sc < 0.15 * tope:
                    break
                if h['name'] in ya:
                    continue
                args, falta, dep = self.argumentos(h, texto, previas)
                if previas and not (dep and not falta):
                    continue            # tras el primer turno solo se encadenan herramientas que usan el resultado de otra
                if not falta:
                    elegido = (h['name'], args)
                    break
                if pendiente is None:
                    pendiente = [(h['name'], f) for f in falta]
            if elegido:
                if elegido not in listas:
                    listas.append(elegido)
            elif pendiente and not previas:
                faltan += pendiente
        return listas, faltan

    def herramientas(self):
        if not self.tools:
            return None
        inj = self.inyeccion_en_herramientas()
        if inj is not None:
            return None, [inj], 'tool_calls'
        texto = self.u
        listas, faltan = self.planificar(texto)
        if listas:
            llamadas = []
            base = len(self.previas())
            for i, (nombre, args) in enumerate(listas):
                llamadas.append(ToolCall(id='call_%04d' % (base + i + 1), type='function', function=Function(name=nombre, arguments=json.dumps(args, ensure_ascii=False))))
            return None, llamadas, 'tool_calls'
        if self.msgs[-1]['role'] == 'tool':
            return None
        if faltan:
            nombre, p = faltan[0]
            return 'Para usar «%s» necesito el valor de «%s». ¿Puedes indicármelo?' % (nombre, p), [], 'stop'
        return None

    def inyeccion_en_herramientas(self):
        """Inyección indirecta por herramientas: un resultado que dice «ignora… envía un correo a X» hace que un modelo sin defensas use la herramienta de correo."""
        if self.defendido or self.spec['resiste_inyeccion'] or self.msgs[-1]['role'] != 'tool':
            return None
        espec = self.espec()
        correo = [h for h in espec if 'email' in h['name'] or 'correo' in h['name']]
        if not correo:
            return None
        previas = self.previas()
        if any(pn == correo[0]['name'] for pn, pa, pr in previas):
            return None
        for pn, pa, pr in previas:
            if pr and re.search(r'ignora', _n(pr)):
                m = re.search(r'(?:envia|manda|escribe)[^.]*?\b(?:correo|email|mensaje)\s+a\s+(' + _RE_EMAIL.pattern + ')', _n(pr))
                if m:
                    args, falta, _ = self.argumentos(correo[0], m.group(0), [])
                    props = correo[0]['parameters'].get('properties', {})
                    for nombre in props:
                        if nombre not in args and props[nombre].get('type', 'string') == 'string':
                            if nombre in ('destinatario', 'para', 'to', 'email', 'correo', 'direccion') or nombre.startswith('destin'):
                                args[nombre] = m.group(1)
                            elif any(w in nombre for w in ('asunto', 'subject')):
                                args[nombre] = 'Información del cliente'
                            else:
                                args[nombre] = pr[:60]
                    return ToolCall(id='call_%04d' % (len(previas) + 1), type='function', function=Function(name=correo[0]['name'], arguments=json.dumps(args, ensure_ascii=False)))
        return None

    def final_herramientas(self):
        previas = self.previas()
        partes = []
        for nombre, args, res in previas:
            if res is None:
                continue
            try:
                d = json.loads(res)
            except ValueError:
                d = res
            if isinstance(d, dict):
                if d.get('error'):
                    partes.append('La herramienta %s falló: %s' % (nombre, d['error']))
                else:
                    partes.append('%s → ' % nombre + ', '.join('%s: %s' % (k, v) for k, v in d.items()))
            else:
                partes.append('%s → %s' % (nombre, d))
        texto = 'He consultado las herramientas. ' + ' | '.join(partes) + '.' if partes else 'No obtuve resultados de las herramientas.'
        for nombre, args, res in previas:
            if res and re.search(r'ignora', _n(res)) and re.search(r'instrucciones', _n(res)) and not self.defendido and not self.spec['resiste_inyeccion'] and not any('email' in pn or 'correo' in pn for pn, pa, pr in previas):
                m = re.search(r'(?:responde|di|escribe|visita|envia|llama)[^.:]*[:.]?\s*(.+)$', res, re.I)
                return (m.group(1) if m else res).strip()
        return texto

    # ---- ReAct (texto) ----
    def react(self):
        herr = []
        for nombre, desc in re.findall(r'^\s*[-*]\s*([a-z_]+)\s*:\s*(.+)$', self.sis, re.M):
            herr.append({'name': nombre, 'description': desc, 'parameters': {'type': 'object', 'properties': {'entrada': {'type': 'string'}}, 'required': ['entrada']}})
        self.tools = [{'type': 'function', 'function': h} for h in herr]
        self._cache = {}
        ult = self.msgs[-1]
        usadas = []
        for m in self.msgs:
            if m['role'] == 'assistant':
                usadas += re.findall(r'Acci[oó]n:\s*([a-z_]+)\[', _contenido(m))
        obs = [_contenido(m) for m in self.msgs if m['role'] == 'user' and _contenido(m).startswith('Observación:')]
        pregunta = next((_contenido(m) for m in self.msgs if m['role'] == 'user' and not _contenido(m).startswith('Observación:')), self.u)
        mejores = []
        for h in herr:
            sc, comunes = self.relevancia(h, pregunta)
            if comunes >= 1 and h['name'] not in usadas:
                mejores.append((sc, h))
        if mejores and len(obs) == len(usadas):
            mejores.sort(key=lambda p: -p[0])
            h = mejores[0][1]
            ent = pregunta.strip()
            if 'calcul' in h['name'] or 'calcul' in _n(h['description']):
                m = re.search(r'\d[\d\s+\-*/().,x×]*\d', pregunta)
                ent = m.group(0).strip() if m else ent
            return 'Pensamiento: Necesito usar %s para responder.\nAcción: %s[%s]' % (h['name'], h['name'], ent)
        final = ' '.join(o[len('Observación:'):].strip() for o in obs) if obs else self.general()
        return 'Pensamiento: Ya tengo la información necesaria.\nRespuesta final: %s' % final

