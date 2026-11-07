# Genera src/illustrations/iaEmbedData.ts (mapas 2D de embeddings y puntuaciones de búsqueda) con dojo_ai.
# Uso: PYTHONPATH=<carpeta con un enlace a src/pyengine/pylib/dojo_ai> python3 scripts/gen_ia_embed_data.py
import json, re
import numpy as np
from dojo_ai.embeddings import embed, embed_palabra, tokens, raiz, _sin_acentos
from dojo_ai._lexicon import STOPWORDS
from dojo_ai.corpus import FAQ

GRUPOS = {
    'animales': 'perro gato caballo vaca pájaro pez lobo conejo',
    'comida': 'pizza pan arroz queso manzana naranja pasta huevo',
    'tecnología': 'ordenador teléfono pantalla teclado algoritmo software internet robot',
    'personas': 'rey reina hombre mujer niño niña príncipe princesa',
    'países': 'francia italia españa japón parís roma madrid tokio',
}

def pca2(words):
    M = np.array([embed_palabra(w) for w in words])
    M = M - M.mean(axis=0)
    U, S, Vt = np.linalg.svd(M, full_matrices=False)
    P = M @ Vt[:2].T
    for k in range(2):
        if P[np.argmax(np.abs(P[:, k])), k] < 0:
            P[:, k] = -P[:, k]
    lo, hi = P.min(axis=0), P.max(axis=0)
    return ((P - lo) / (hi - lo)).round(3).tolist()

todas = [(g, w) for g, ws in GRUPOS.items() for w in ws.split()]
pts = pca2([w for _, w in todas])
V = np.array([embed_palabra(w) for _, w in todas])
S_ = V @ V.T
mapa = []
for i, ((g, w), p) in enumerate(zip(todas, pts)):
    orden = [j for j in np.argsort(-S_[i], kind='stable') if j != i][:4]
    mapa.append({'w': w, 'g': g, 'x': p[0], 'y': p[1], 'nn': [[todas[j][1], round(float(S_[i, j]), 2)] for j in orden]})
# sub-mapas para las analogías
def sub(words):
    p = pca2(words)
    return [{'w': w, 'x': q[0], 'y': q[1]} for w, q in zip(words, p)]
familia = sub('hombre mujer rey reina niño niña príncipe princesa padre madre hijo hija'.split())
paises = sub('francia parís italia roma españa madrid japón tokio'.split())

# búsqueda: palabra a palabra frente a significado
QUERIES = [('No recuerdo mi clave de acceso', 'cuenta-password'), ('¿Se puede pagar a plazos?', 'pago-plazos'), ('¿Mandáis fuera de España?', 'envio-internacional'), ('Mi pedido llegó roto', 'producto-defectuoso'), ('¿A qué hora abrís el chat?', 'soporte-horario'), ('¿Cómo me pongo en contacto con vosotros?', 'soporte-contacto'), ('¿Cuánto cuesta el envío rápido?', 'envio-express'), ('Quiero que me devuelvan el dinero', 'reembolso')]
E = embed([f[2] for f in FAQ])
def claves(t):
    return {raiz(w) for w in tokens(t) if w not in STOPWORDS and _sin_acentos(w) not in STOPWORDS}
busq = []
for q, esp in QUERIES:
    kq = claves(q)
    kw = []
    for f in FAQ:
        kd = claves(f[2])
        kw.append(round(len(kq & kd) / max(len(kq), 1), 3))
    sem = (E @ embed(q)).round(3).tolist()
    busq.append({'q': q, 'esp': esp, 'kw': kw, 'sem': sem})
out = '/** GENERADO por scripts de datos del curso de IA (dojo_ai): no editar a mano. */\n'
out += 'export interface EmbPoint { w: string; g?: string; x: number; y: number; nn?: [string, number][] }\n'
out += 'export const EMB_MAP: EmbPoint[] = %s;\n' % json.dumps(mapa, ensure_ascii=False)
out += 'export const EMB_FAMILIA: EmbPoint[] = %s;\n' % json.dumps(familia, ensure_ascii=False)
out += 'export const EMB_PAISES: EmbPoint[] = %s;\n' % json.dumps(paises, ensure_ascii=False)
out += 'export const FAQ_DOCS: { id: string; cat: string; text: string }[] = %s;\n' % json.dumps([{'id': f[0], 'cat': f[1], 'text': f[2]} for f in FAQ], ensure_ascii=False)
out += 'export const FAQ_SEARCH: { q: string; esp: string; kw: number[]; sem: number[] }[] = %s;\n' % json.dumps(busq, ensure_ascii=False)
open('/home/user/app-practica-front/src/illustrations/iaEmbedData.ts', 'w').write(out)
print(len(out))
for b in busq:
    kw_top = FAQ[int(np.argmax(b['kw']))][0], max(b['kw'])
    sem_top = FAQ[int(np.argmax(b['sem']))][0], max(b['sem'])
    print(b['q'], '| kw', kw_top, '| sem', sem_top)
