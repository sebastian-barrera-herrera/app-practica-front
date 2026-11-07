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
- **Z4 · Regresión** ✅ — recta de mínimos cuadrados, varias variables (escalado, one-hot, polinomios), métricas (MAE/RMSE/R²) y línea base, Ridge/Lasso, KNN/árboles/bosques para curvas. Datos: `casas.csv`.
- **Z5 · Clasificación** ✅ — logística y umbral, árboles (Gini), KNN, SVM (margen, C, gamma, kernels), bosques y boosting. Datos: `bajas.csv`.
- **Z6 · Evaluación y optimización** ✅ — matriz de confusión, precisión/recall/F1 y clases raras, ROC/AUC, validación cruzada, sesgo-varianza (curvas de validación y aprendizaje), GridSearchCV y RandomizedSearchCV.
- **Z7 · Aprendizaje no supervisado** ✅ — k-means (codo y silueta), DBSCAN y jerárquico, PCA, anomalías (z-score, IQR, distancia al centro) y recomendador por similitud coseno. Datos: `tienda.csv`.

## Avanzado (deep learning y IA generativa)
- **Z8 · Redes neuronales desde cero** ✅ — neurona y perceptrón, capas y propagación hacia delante (XOR), activaciones (gradiente evanescente, softmax estable), pérdida y retropropagación (comprobada con derivadas numéricas), bucle de entrenamiento, mini-lotes, inicialización, SGD/momento/Adam y `MLPClassifier`. Datos: dos lunas (`make_moons`).
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
| pandas mini | hecho |
| scikit-learn mini (preprocesado, modelos lineales, árboles y bosques con el constructor de árboles portado a TS, SVM con el SMO de libsvm portado a TS, MLP, KNN, Naive Bayes, K-means/DBSCAN/jerárquico, PCA, texto, pipelines, búsquedas, métricas) | hecho · contrastado con la librería real en `__tests__/golden/sklearn_*.py` |
| SciPy mínimo (`stats`, `special`, `spatial.distance`, `optimize`) | hecho |
| torch mini (tensores, autograd, `nn`, `optim`, `utils.data`) | hecho · `__tests__/selfcheck/torch_*.py` (gradientes contra diferencias finitas y capas contra NumPy) |
| `dojo_ai` | por hacer (zonas 10–15) |
| `tools/contentdiff.ts` | compara demos, «¿qué imprime?», retos y fichas con CPython real: úsalo con cada zona nueva |
