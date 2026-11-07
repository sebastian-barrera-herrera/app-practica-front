import type { IaRef } from '../reference';

/** Fichas de RAG: recuperación, citas y evaluación (Z13). */
export const RAG_REFS: IaRef[] = [
  {
    name: 'RAG',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: '*Retrieval-Augmented Generation*: antes de preguntar al LLM se **buscan** fragmentos relevantes en tus documentos y se le dan como contexto para que responda con ellos y los cite. Aporta conocimiento propio y actualizable y reduce las alucinaciones.',
    usage: 'indexar:  documentos → trocear → embeddings → base vectorial\nconsultar: pregunta → recuperar k → prompt con fuentes → LLM → respuesta con [n]',
    details: 'Se actualiza cambiando documentos (no el modelo), permite citar y aplicar permisos. Sus fallos son de dos tipos: **recuperación** (el fragmento correcto no llega) y **generación** (llega y se usa mal). Evalúalos por separado. Alternativas o complementos: ajuste fino (comportamiento), herramientas (datos en vivo).',
    examples: [[`from dojo_ai.llm import Client
r = Client().chat.completions.create(model="dojo-mini", temperature=0, messages=[
    {"role": "system", "content": "Responde SOLO con el contexto y cita la fuente con [n]."},
    {"role": "user", "content": "Contexto:\\n[1] El envío exprés cuesta 6,90 € y entrega en 24 horas.\\n\\nPregunta: ¿Cuánto cuesta el envío exprés?"}])
print(r.choices[0].message.content)`, 'respuesta anclada con su fuente']],
    seeAlso: ['alucinación', 'chunking', 'cita de fuentes', 'evaluar un RAG'],
  },
  {
    name: 'búsqueda híbrida',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Combinar la búsqueda **vectorial** (entiende sinónimos) con la de **palabras clave** (exacta con códigos, nombres y cifras) y fusionar los dos rankings. Suele mejorar la cobertura (hit@k) de un RAG.',
    usage: 'ranking = rrf(ranking_vectorial[:10], ranking_palabras[:10])',
    details: 'La fusión más usada es RRF. Los buscadores reales usan BM25 para la parte de palabras. Ajusta cuántos candidatos pides a cada método y valida con tu conjunto de preguntas: el beneficio depende de lo exactos que sean tus términos (referencias de producto, siglas).',
    examples: [[`def rrf(*listas, k=60):
    p = {}
    for l in listas:
        for i, d in enumerate(l):
            p[d] = p.get(d, 0) + 1 / (k + i + 1)
    return sorted(p, key=lambda d: (-p[d], d))
print(rrf(["C", "A", "B"], ["A", "C", "E"]))`, 'C y A suben por estar altos en ambas listas']],
    seeAlso: ['RRF', 'reranking', 'MMR'],
  },
  {
    name: 'RRF',
    kind: 'función',
    category: 'llm',
    level: 3,
    summary: '*Reciprocal rank fusion*: fusiona varias listas ordenadas sumando `1 / (k + posición)` por cada lista donde aparece un resultado (k = 60 habitualmente). No necesita comparar puntuaciones de escalas distintas.',
    usage: 'puntos[d] += 1 / (60 + posicion + 1)',
    details: 'Es robusta y sin parámetros que ajustar: lo que aparece alto en varias listas sube. Perfecta para fusionar búsqueda vectorial y por palabras, o varias reformulaciones de la misma consulta.',
    examples: [[`def rrf(*listas, k=60):
    p = {}
    for l in listas:
        for i, d in enumerate(l):
            p[d] = p.get(d, 0) + 1 / (k + i + 1)
    return sorted(p, key=lambda d: (-p[d], d))
print(rrf(["X", "Y"], ["Z", "Y"]))`, 'Y gana por estar en ambas listas']],
    seeAlso: ['búsqueda híbrida'],
  },
  {
    name: 'MMR',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: '*Maximal marginal relevance*: elige resultados que sean **relevantes y distintos entre sí**, maximizando `λ·sim(pregunta, d) − (1−λ)·máx sim(d, ya elegidos)`. Evita llenar el contexto con fragmentos casi idénticos.',
    usage: 'elegidos = mmr(q, E, k=4, lam=0.7)',
    details: 'λ = 1 equivale a la ordenación normal por parecido; valores menores añaden diversidad. Útil cuando los documentos repiten información o cuando solapas fragmentos. Se aplica sobre los candidatos recuperados.',
    examples: [[`import numpy as np
E = np.array([[1.0, 0.0], [0.99, 0.14], [0.0, 1.0]])
E = E / np.linalg.norm(E, axis=1, keepdims=True)
print(float(E[0] @ E[1]) > 0.98, float(E[0] @ E[2]))`, 'dos candidatos casi idénticos: MMR evita elegir ambos']],
    seeAlso: ['búsqueda híbrida', 'reranking'],
  },
  {
    name: 'reranking',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Segunda pasada que **reordena** los mejores candidatos de la recuperación con un modelo más fino (un *cross-encoder*, un LLM o una señal frase a frase). Afina el primer puesto a cambio de más latencia y coste.',
    usage: 'candidatos = recuperar(pregunta, k=20)\nordenados = reordenar(pregunta, candidatos)[:4]',
    details: 'Se aplica a pocos candidatos (10–50). Compensa cuando la fuente correcta suele estar en los puestos 2–10. Mide el efecto: puede mejorar hit@1 y no hit@3, como pasa en la zona 13.',
    examples: [[`import re
def frases(t):
    return [f for f in re.split(r"(?<=[.!?])\\s+", t) if f]
print(len(frases("Primera frase. Segunda frase. Tercera.")))`, 'el reordenado fino compara la pregunta con cada frase']],
    seeAlso: ['búsqueda híbrida', 'MMR'],
  },
  {
    name: 'cita de fuentes',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Pedir al modelo que marque cada afirmación con el número `[n]` del fragmento del que sale, y **verificar en código** que esos números existen. Da confianza al usuario y permite auditar y detectar invenciones.',
    usage: 'citas = sorted({int(n) for n in re.findall(r"\\[(\\d+)\\]", respuesta)})\nvalidas = all(1 <= c <= len(fragmentos) for c in citas)',
    details: 'Una respuesta sin citas, o con una cita a una fuente inexistente, es sospechosa. Una abstención («No lo sé») no lleva citas. Devuelve las fuentes como datos estructurados (sección, enlace) para mostrarlas al usuario.',
    examples: [[`import re
r = "El envío exprés cuesta 6,90 €. [1] Es gratis a partir de 50 €. [3]"
print(sorted({int(n) for n in re.findall(r"\\[(\\d+)\\]", r)}))`, 'citas encontradas, sin repetir y ordenadas']],
    seeAlso: ['RAG', 'inyección de prompt'],
  },
  {
    name: 'MRR',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: '*Mean reciprocal rank*: media de `1 / posición` en la que aparece la fuente correcta (0 si no aparece). Vale 1 si siempre es la primera; premia que la correcta esté arriba, no solo que aparezca.',
    usage: 'mrr = sum(1 / p for p in posiciones if p > 0) / len(posiciones)',
    details: 'Complementa a hit@k: dos sistemas con el mismo hit@3 pueden diferir mucho en MRR si uno pone la correcta primera y el otro tercera. Se usa para evaluar la recuperación y los rankings en general.',
    examples: [[`posiciones = [1, 2, 0, 4]
print(sum(1 / p for p in posiciones if p > 0) / len(posiciones))`, '(1 + 1/2 + 0 + 1/4) / 4']],
    seeAlso: ['hit@k', 'evaluar un RAG'],
  },
  {
    name: 'fidelidad',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: '*Groundedness*: grado en que lo que afirma una respuesta está **respaldado por el contexto** recuperado. Una respuesta puede ser correcta por casualidad y no fiel; mide ambas cosas.',
    usage: 'fidelidad = frases_respaldadas / frases_de_la_respuesta',
    details: 'Se estima con reglas (las cifras y términos clave aparecen en el contexto), con modelos de inferencia de texto o con un LLM como juez (con sesgos conocidos, p. ej. preferir respuestas largas). Una fidelidad baja indica invención y se corrige reforzando el anclaje y verificando citas.',
    examples: [[`ctx = "El envío exprés cuesta 6,90 € y entrega en 24 horas."
print("6,90" in ctx and "24 horas" in ctx)`, 'las cifras de la respuesta aparecen en el contexto']],
    seeAlso: ['evaluar un RAG', 'cita de fuentes', 'alucinación'],
  },
  {
    name: 'evaluar un RAG',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Medir por separado la **recuperación** (hit@k, MRR, recall) y la **generación** (corrección, fidelidad, abstención, citas válidas) con un conjunto de preguntas con respuesta conocida, incluidas preguntas sin respuesta en los documentos.',
    usage: 'diagnostico = "recuperación" si la fuente correcta no llegó · "generación" si llegó y la respuesta falla · "ok"',
    details: 'Sin esa separación no sabes qué arreglar: cambiar el LLM cuando el fallo es de recuperación es dinero perdido. Empieza con 30–100 preguntas de usuarios reales, guarda los fallos de producción como nuevos casos y repite la evaluación en cada cambio.',
    examples: [[`def diagnosticar(esperada, recuperadas, respuesta, clave):
    if esperada not in recuperadas:
        return "recuperación"
    return "ok" if clave.lower() in respuesta.lower() else "generación"
print(diagnosticar("a", ["b"], "x", "k"), diagnosticar("a", ["a"], "K", "k"))`, 'dos diagnósticos distintos']],
    seeAlso: ['hit@k', 'MRR', 'fidelidad', 'RAG'],
  },
];
