# Curso de IA · plan

Todo corre en el móvil sobre el intérprete de Python propio (`src/pyengine`), con **NumPy** (bit a bit idéntico al real: mismo
generador aleatorio), **matplotlib** (figuras dibujadas con SVG), **pandas / scikit-learn / PyTorch en miniatura** y un
módulo `dojo_ai` (embeddings de juguete, tokenizador BPE, índices vectoriales y un «LLM» simulado con la misma API que los reales).

IDs: zonas `ia1`…`ia15`, lecciones `ia1-1`…, retos `ia1-1-p1`, jefes `ia1-boss`.
Cada lección: 7+ pasos, ≥3 preguntas, al menos un reto de código `pyPractice` validado por tests (solución pasa, código inicial no).

## Básico (cimientos)
- **Z1 · Qué es la IA** — IA vs ML vs DL, aprender de datos vs reglas, tipos de aprendizaje, el flujo de un proyecto, sesgo y varianza en pocas palabras.
- **Z2 · Matemáticas con NumPy** — arrays, broadcasting, vectores y matrices, producto escalar, normas, distancias, estadística, probabilidad, derivadas y gradiente.
- **Z3 · Datos y preprocesado** — tablas (pandas mini), limpieza, valores nulos, escalado, codificación, ingeniería de variables, train/test.

## Intermedio (aprendizaje automático clásico)
- **Z4 · Regresión** — regresión lineal (fórmula cerrada y descenso del gradiente), polinómica, regularización L1/L2, función de pérdida.
- **Z5 · Clasificación** — logística, k-NN, árboles, bosques, Naive Bayes, SVM, umbral de decisión.
- **Z6 · Evaluación y optimización** — métricas, matriz de confusión, ROC/AUC, validación cruzada, sobreajuste, búsqueda de hiperparámetros, pipelines.
- **Z7 · Aprendizaje no supervisado** — k-means, jerárquico, PCA, detección de anomalías, sistemas de recomendación.

## Avanzado (deep learning y IA generativa)
- **Z8 · Redes neuronales desde cero** — neurona, capas, activaciones, retropropagación, entrenar con NumPy, optimizadores.
- **Z9 · Deep learning práctico** — PyTorch mini, autograd, CNN, RNN/LSTM, regularización (dropout, batch norm), transfer learning.
- **Z10 · Datos vectoriales y embeddings** — vectores, similitud coseno, embeddings, búsqueda por vecinos (exacta y ANN), bases de datos vectoriales, chunking.
- **Z11 · Transformers y LLMs** — tokens y BPE, atención, arquitectura, preentrenamiento, ajuste fino, generación (temperatura, top-k/top-p), contexto.
- **Z12 · Prompt engineering** — roles, few-shot, cadena de pensamiento, formatos estructurados, evaluación de prompts, inyección de prompts.
- **Z13 · RAG** — pipeline completo, recuperación, reranking, citas, evaluación de RAG, fallos típicos.
- **Z14 · Agentes** — bucle razonar-actuar, herramientas y function calling, memoria, planificación, multi-agente, seguridad.
- **Z15 · IA responsable y producción** — sesgo y equidad, privacidad, alucinaciones, evaluación de LLMs, costes y latencia, MLOps/LLMOps, proyecto final.

## Motor
| Pieza | Estado |
|---|---|
| NumPy nativo (nd, fmt, rng, ops, linalg, random) | hecho |
| Canal de figuras + matplotlib.pyplot (line, scatter, bar, hist, imshow, pie, box…) | hecho |
| pandas mini · sklearn mini · torch mini · `dojo_ai` | por hacer (se añaden con cada fase) |
