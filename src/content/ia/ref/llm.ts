import type { IaRef } from '../reference';

/** Fichas de tokens, Transformers y modelos de lenguaje (Z11). */
export const LLM_REFS: IaRef[] = [
  {
    name: 'token',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Trozo de texto (una palabra frecuente, parte de una palabra rara, una cifra, un signo) que un LLM trata como unidad. Los modelos leen, generan, cobran y miden su memoria **en tokens**, no en palabras.',
    usage: 'texto → tokenizador → [ids] → modelo → [ids] → tokenizador → texto',
    details: 'Un token en inglés ronda las ¾ de palabra; en español algo menos, y los números o el código suelen partirse más. Como el modelo ve fragmentos y no letras, le cuesta contar letras o invertir palabras. Cada modelo tiene su propio tokenizador: el mismo texto da recuentos distintos según el proveedor.',
    examples: [[`from dojo_ai.tokenizer import get_encoding
enc = get_encoding()
print(enc.tokens("hola"), enc.encode("hola"))`, 'un texto, sus tokens y sus identificadores']],
    seeAlso: ['BPE', 'contar_tokens', 'ventana de contexto'],
  },
  {
    name: 'BPE',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: '*Byte pair encoding*: algoritmo que aprende el vocabulario de un tokenizador. Parte de caracteres sueltos y fusiona una y otra vez el par de símbolos adyacentes **más frecuente** en el corpus.',
    usage: 'BPETokenizer.entrenar(textos, num_merges=100) → tokenizador\nenc.tokens("texto") / enc.encode("texto") / enc.decode(ids)',
    details: 'Las secuencias frecuentes acaban siendo un solo token y las raras se parten en piezas conocidas, así que **nunca hay palabras desconocidas**. Para tokenizar texto nuevo se aplican las fusiones aprendidas en el orden en que se aprendieron. Variantes: WordPiece, SentencePiece, BPE a nivel de bytes.',
    examples: [[`from dojo_ai.tokenizer import BPETokenizer
t = BPETokenizer.entrenar(["bajo bajo bajo", "baja baja"], num_merges=3)
print(t.merges)
print(t.tokens("bajo"))`, 'las tres primeras fusiones y una palabra del corpus']],
    seeAlso: ['token', 'get_encoding'],
  },
  {
    name: 'get_encoding',
    kind: 'función',
    category: 'llm',
    level: 2,
    summary: '`dojo_ai.tokenizer.get_encoding()` devuelve un tokenizador BPE de juguete ya entrenado con el corpus del curso (175 símbolos). Funciona como el de `tiktoken` de las API reales.',
    usage: 'enc = get_encoding()\nenc.tokens(texto)    # lista de cadenas\nenc.encode(texto)    # lista de enteros\nenc.decode(ids)      # texto',
    details: 'Un tokenizador real tiene 30 000–200 000 tokens y trabaja con bytes, de modo que cabe cualquier idioma o emoji. El de juguete trabaja en minúsculas y sin bytes; sirve para entender la idea y contar tokens de forma coherente.',
    examples: [[`from dojo_ai.tokenizer import get_encoding
enc = get_encoding()
ids = enc.encode("quiero devolver mi pedido")
print(len(ids), enc.decode(ids))`, 'ida y vuelta texto → ids → texto']],
    seeAlso: ['BPE', 'contar_tokens'],
  },
  {
    name: 'contar_tokens',
    kind: 'función',
    category: 'llm',
    level: 1,
    summary: '`dojo_ai.tokenizer.contar_tokens(texto)` devuelve cuántos tokens ocupa un texto con el tokenizador del curso: la base para calcular costes y comprobar que algo cabe en la ventana de contexto.',
    usage: 'contar_tokens("hola")  →  2\ncoste = contar_tokens(texto) * precio_millon / 1_000_000',
    details: 'Las API cobran por millón de tokens y distinguen entrada y salida. Mide siempre antes de enviar textos largos; con una API real usa el contador de tokens del proveedor, que coincide con su facturación.',
    examples: [[`from dojo_ai.tokenizer import contar_tokens
for t in ["hola", "4839201"]:
    print(t, contar_tokens(t))`, 'las cifras sueltas ocupan casi un token cada una']],
    seeAlso: ['token', 'ventana de contexto'],
  },
  {
    name: 'self-attention',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Mecanismo por el que cada token de una secuencia calcula cuánto le importa cada otro y mezcla su información: `softmax(Q·Kᵀ/√d)·V`. Es la pieza que define a los Transformers.',
    usage: 'Q, K, V = X @ Wq, X @ Wk, X @ Wv\npesos = softmax(Q @ K.T / np.sqrt(d))\nsalida = pesos @ V',
    details: '**Q** (consulta) pregunta, **K** (clave) ofrece y **V** (valor) aporta. Cada fila de `pesos` suma 1. A diferencia de una RNN, cualquier par de posiciones está conectado directamente y todo se calcula en paralelo; el precio es un coste que crece con el **cuadrado** de la longitud.',
    examples: [[`import numpy as np
def softmax(x):
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)
X = np.eye(3)
W = softmax(X @ X.T / np.sqrt(3))
print(W.round(2))
print(W.sum(axis=1))`, 'tres tokens ortogonales: cada uno atiende más a sí mismo']],
    seeAlso: ['máscara causal', 'multi-head attention', 'softmax'],
  },
  {
    name: 'máscara causal',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Matriz que impide a cada token mirar a los **posteriores**: se pone −∞ en las puntuaciones futuras antes del softmax, de modo que su peso es 0. Permite entrenar y generar texto de izquierda a derecha.',
    usage: 'mascara = np.triu(np.ones((T, T), dtype=bool), k=1)\npuntos = np.where(mascara, -np.inf, puntos)',
    details: 'Sin máscara causal el modelo vería la respuesta mientras entrena y no aprendería a predecir. Los modelos «codificadores» (como BERT) no la usan: ven toda la frase y sirven para entender, no para generar.',
    examples: [[`import numpy as np
T = 4
print(np.triu(np.ones((T, T), dtype=int), k=1))`, 'los 1 son el futuro prohibido']],
    seeAlso: ['self-attention', 'transformer'],
  },
  {
    name: 'multi-head attention',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Atención con **varias cabezas** en paralelo: el vector de tamaño d se reparte en h trozos de d/h, cada cabeza calcula su propia atención y se concatenan los resultados (y se mezclan con una matriz de salida).',
    usage: 'dh = d // n_heads\nfor j in range(n_heads):\n    s = slice(j * dh, (j + 1) * dh)\n    cabeza_j = softmax(Q[:, s] @ K[:, s].T / np.sqrt(dh)) @ V[:, s]',
    details: 'Cada cabeza puede especializarse en una relación distinta (sintaxis, correferencia, posición relativa…). El coste total es casi el mismo que una cabeza grande. En modelos recientes, varias cabezas de consulta comparten claves y valores (GQA/MQA) para ahorrar memoria al generar.',
    examples: [[`import numpy as np
X = np.zeros((6, 16))
cabezas = X.reshape(6, 4, 4)
print(cabezas.shape)`, '16 columnas = 4 cabezas de 4']],
    seeAlso: ['self-attention', 'transformer'],
  },
  {
    name: 'codificación posicional',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Señal que se **suma** al embedding de cada token para indicar su posición, porque la atención por sí sola no distingue el orden. El Transformer original usa senos y cosenos de distintas frecuencias.',
    usage: 'ang = pos / 10000 ** (i / d)\nP[:, 0::2] = np.sin(ang);  P[:, 1::2] = np.cos(ang)\nX = embeddings + P',
    details: 'Alternativas modernas: posiciones aprendidas, **RoPE** (rotar Q y K según la posición) y ALiBi. Influyen en cuánto texto puede manejar bien un modelo más allá de la longitud con la que se entrenó.',
    examples: [[`import numpy as np
pos = np.arange(3)[:, None]
i = np.arange(0, 4, 2)[None, :]
ang = pos / 10000 ** (i / 4)
print(np.sin(ang).round(3))`, 'ángulos de las columnas pares para 3 posiciones']],
    seeAlso: ['transformer', 'self-attention'],
  },
  {
    name: 'layer norm',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Normalización por capa: reescala **cada vector** (cada token) a media 0 y varianza 1 sobre sus d componentes. Estabiliza el entrenamiento de Transformers profundos y no depende del tamaño del lote.',
    usage: 'media = x.mean(axis=-1, keepdims=True)\nvar = x.var(axis=-1, keepdims=True)\ny = (x - media) / np.sqrt(var + eps)',
    details: 'En la práctica tiene dos parámetros aprendidos (escala y desplazamiento) y muchos modelos usan RMSNorm, una versión que solo divide por la raíz del valor cuadrático medio. Se coloca antes (*pre-norm*) o después de cada subcapa.',
    examples: [[`import numpy as np
x = np.array([[1., 2., 3., 4.]])
y = (x - x.mean(axis=-1, keepdims=True)) / np.sqrt(x.var(axis=-1, keepdims=True) + 1e-5)
print(y.round(3), y.mean().round(3))`, 'media 0 y desviación ≈ 1']],
    seeAlso: ['transformer'],
  },
  {
    name: 'transformer',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Arquitectura (Google, 2017) basada en **atención**, sin recurrencia ni convoluciones. Un bloque = atención multi-cabeza + MLP, con conexiones residuales y normalización; se apila L veces. Es la base de todos los LLM actuales.',
    usage: 'X = embeddings(tokens) + posición\nrepetir L veces:\n    X = X + atención(norm(X))\n    X = X + mlp(norm(X))\nlogits = norm(X) @ E.T',
    details: 'Parámetros ≈ **12·d²·L + V·d**. Los **decodificadores** (GPT, Llama, Claude) usan atención causal y generan texto; los **codificadores** (BERT) ven toda la frase y producen representaciones; los **codificador–decodificador** (T5) sirven para traducir y resumir. También se usan en imagen (ViT), audio y proteínas.',
    examples: [[`def contar_parametros(d, capas, vocab):
    return 12 * d * d * capas + vocab * d
print(contar_parametros(768, 12, 50257))`, 'GPT-2 pequeño: unos 124 millones']],
    seeAlso: ['self-attention', 'multi-head attention', 'layer norm', 'codificación posicional'],
  },
  {
    name: 'logits',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Puntuaciones sin normalizar que da un modelo, una por clase (o por token del vocabulario). El softmax las convierte en probabilidades; los logits pueden ser cualquier número real.',
    usage: 'probs = softmax(logits)\nsiguiente = np.argmax(logits)        # voraz',
    details: 'Trabajar con logits es numéricamente más estable que con probabilidades: las funciones de pérdida (entropía cruzada) y el muestreo con temperatura se aplican directamente sobre ellos. Una diferencia de 1 en logits equivale a multiplicar por e ≈ 2,7 las probabilidades relativas.',
    examples: [[`import numpy as np
lg = np.array([2.0, 1.0, 0.1])
p = np.exp(lg) / np.exp(lg).sum()
print(p.round(3), p.sum())`, 'tres logits → tres probabilidades que suman 1']],
    seeAlso: ['softmax', 'temperatura'],
  },
  {
    name: 'temperatura',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Parámetro de muestreo: se dividen los logits entre T antes del softmax. T < 1 afila la distribución (respuestas previsibles); T > 1 la aplana (variadas y arriesgadas); T → 0 equivale a elegir siempre la más probable.',
    usage: 'probs = softmax(logits / T)\nclient.chat.completions.create(..., temperature=0.2)',
    details: 'Úsala baja (0–0,3) para extracción, clasificación, código y respuestas factuales; media (0,7–1) para conversación; alta para lluvia de ideas. No garantiza veracidad: un modelo con T = 0 puede equivocarse siempre de la misma forma. Suele combinarse con top-p, no se recomienda tocar ambos a la vez.',
    examples: [[`import numpy as np
def softmax_t(l, T):
    z = np.array(l) / T
    e = np.exp(z - z.max())
    return e / e.sum()
for T in (0.5, 1, 2):
    print(T, softmax_t([2.0, 0.0], T).round(3))`, 'más temperatura = reparto más plano']],
    seeAlso: ['top-k y top-p', 'logits'],
  },
  {
    name: 'top-k y top-p',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Filtros previos al muestreo. **top-k**: solo las k candidatas más probables. **top-p** (*nucleus*): las más probables hasta acumular una probabilidad p (p. ej. 0,9). Descartan la cola de opciones absurdas.',
    usage: 'q = top_k(probs, 40)   # o top_p(probs, 0.9)\nsiguiente = muestrear(q)\nclient.chat.completions.create(..., top_p=0.9)',
    details: 'top-p se adapta: si el modelo está muy seguro, deja pocas candidatas; si duda, deja más. Después de filtrar se renormaliza para que sumen 1. En `dojo_ai.lm` están como `filtrar_top_k` y `filtrar_top_p`.',
    examples: [[`from dojo_ai.lm import filtrar_top_k, filtrar_top_p
p = [0.5, 0.3, 0.15, 0.05]
print(filtrar_top_k(p, 2).round(3))
print(filtrar_top_p(p, 0.9).round(3))`, 'dos formas de recortar la cola']],
    seeAlso: ['temperatura', 'logits', 'modelo_cuentos'],
  },
  {
    name: 'modelo_cuentos',
    kind: 'función',
    category: 'llm',
    level: 2,
    summary: '`dojo_ai.lm.modelo_cuentos()` devuelve un modelo de lenguaje de **n-gramas** de juguete entrenado con unos cuentos. Tiene `.probabilidades(contexto)`, `.logits(contexto)`, `.generar(prompt, temperatura, top_k, top_p, semilla)` y `.perplejidad(frase)`.',
    usage: 'm = modelo_cuentos()\nm.probabilidades("el gato")\nm.generar("el gato", max_tokens=8, temperatura=0.8, semilla=1)',
    details: 'Un n-grama predice la siguiente palabra contando qué palabras seguían a las anteriores: sin redes ni embeddings. Es la forma más simple de modelo de lenguaje, pero comparte con un LLM el bucle de generación, el muestreo y la métrica de perplejidad.',
    examples: [[`from dojo_ai.lm import modelo_cuentos
m = modelo_cuentos()
print(list(m.probabilidades("el gato"))[:3])
print(m.generar("el gato", max_tokens=8, temperatura=0.8, semilla=1))`, 'candidatas más probables y una generación reproducible']],
    seeAlso: ['temperatura', 'perplejidad', 'top-k y top-p'],
  },
  {
    name: 'perplejidad',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Exponencial de la entropía cruzada media por token: cuánto «duda» un modelo de lenguaje. Una perplejidad de 10 equivale a elegir entre 10 opciones equiprobables en cada paso. Menor es mejor.',
    usage: 'perplejidad = np.exp(entropia_cruzada_media)\nmodelo.perplejidad("frase")',
    details: 'Sirve para comparar modelos sobre el **mismo texto y tokenizador** (con otro tokenizador los números no son comparables). No mide si un asistente es útil o veraz, solo qué tan bien predice texto.',
    examples: [[`import numpy as np
p_correcta = np.array([0.6, 0.7, 0.75, 0.8])
perdida = -np.log(p_correcta).mean()
print(round(float(perdida), 4), round(float(np.exp(perdida)), 3))`, 'pérdida media y perplejidad']],
    seeAlso: ['entropía cruzada', 'modelo_cuentos'],
  },
  {
    name: 'preentrenamiento',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Primera etapa de un LLM: aprender a **predecir el siguiente token** sobre billones de tokens de texto, sin etiquetas. Da lenguaje, conocimiento y razonamiento; el resultado, un *modelo base*, solo continúa texto.',
    usage: 'perdida = entropia_cruzada(modelo(tokens[:-1]), tokens[1:])',
    details: 'Cuesta semanas en miles de GPU. Las *leyes de escalado* muestran que la pérdida baja de forma regular al crecer los parámetros, los datos y el cómputo. La calidad y variedad de los datos pesan tanto como la cantidad. Después vienen el ajuste fino y la alineación.',
    examples: [[`import numpy as np
probs = np.array([[0.1, 0.8, 0.1], [0.2, 0.2, 0.6]])
objetivos = [1, 2]
print(round(float(-np.log(probs[np.arange(2), objetivos]).mean()), 4))`, 'la pérdida es −log de la probabilidad del token real']],
    seeAlso: ['ajuste fino', 'RLHF', 'entropía cruzada'],
  },
  {
    name: 'ajuste fino',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: 'Seguir entrenando un modelo ya preentrenado con **tus** ejemplos para cambiar su estilo, formato o especializarlo. El *SFT* usa pares «instrucción → respuesta» para convertir un modelo base en asistente.',
    usage: 'datos = [{"instruccion": "...", "respuesta": "..."}, ...]\nentrenar(modelo, datos, lr=1e-5)',
    details: 'Sirve para **comportamiento** (tono, formato, tarea muy concreta a gran escala), no para meter conocimiento nuevo: para eso, RAG. Tiene riesgo de olvido catastrófico y de sobreajuste con pocos datos. Con LoRA se entrena solo una fracción mínima de los pesos.',
    examples: [[`# Esquema de un ejemplo de ajuste con instrucciones
ejemplo = {"instruccion": "Resume en una frase", "entrada": "El envío tarda 3 días.", "respuesta": "Tarda 3 días."}
print(sorted(ejemplo))`, 'estructura típica de un ejemplo de SFT']],
    seeAlso: ['LoRA', 'RLHF', 'preentrenamiento'],
  },
  {
    name: 'RLHF',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: '*Reinforcement learning from human feedback*: se entrena un modelo de recompensa con comparaciones humanas («A es mejor que B») y se optimiza el LLM para obtener buena recompensa. **DPO** logra algo parecido sin aprendizaje por refuerzo.',
    usage: 'preferencia = (prompt, respuesta_buena, respuesta_mala)\nrecompensa(buena) > recompensa(mala)',
    details: 'Hace al modelo más útil, honesto y prudente (y a veces servil: tiende a dar la razón al usuario). Es la etapa que enseña a rechazar peticiones dañinas, pero no elimina las alucinaciones ni garantiza seguridad.',
    examples: [[`pref = ("¿Capital de Francia?", "París.", "No lo sé, pregunta a otro.")
prompt, buena, mala = pref
print(len(buena) < len(mala), prompt)`, 'un dato de preferencia: pregunta, respuesta preferida y rechazada']],
    seeAlso: ['ajuste fino', 'preentrenamiento'],
  },
  {
    name: 'LoRA',
    kind: 'concepto',
    category: 'llm',
    level: 3,
    summary: '*Low-rank adaptation*: en lugar de reentrenar una matriz W (d_out×d_in), se congela y se entrena una corrección de **rango bajo** B·A con A de r×d_in y B de d_out×r. Con r pequeño se entrena menos del 1 % de los parámetros.',
    usage: 'W_efectiva = W + B @ A          # B: (d_out, r), A: (r, d_in)\nparametros = r * (d_in + d_out)',
    details: 'Permite ajustar modelos enormes con una GPU y guardar un «adaptador» de pocos MB por tarea. QLoRA lo combina con pesos cuantizados a 4 bits. Se aplica sobre todo a las matrices de atención.',
    examples: [[`import numpy as np
d_in, d_out, r = 6, 6, 2
rng = np.random.default_rng(0)
W = rng.normal(size=(d_out, d_in))
A = rng.normal(size=(r, d_in)) * 0.1
B = np.zeros((d_out, r))                 # empieza en 0: al principio W no cambia
print(np.allclose(W + B @ A, W), r * (d_in + d_out), d_in * d_out)`, 'la corrección empieza siendo cero y usa 24 de 36 pesos aquí (en grande, <1 %)']],
    seeAlso: ['ajuste fino'],
  },
  {
    name: 'ventana de contexto',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Máximo de tokens (entrada **más** salida) que un modelo puede considerar a la vez. No recuerda nada fuera de ella: la aplicación debe reenviar el historial y recortarlo o resumirlo cuando no cabe.',
    usage: 'tokens_prompt + max_tokens <= ventana\nhistorial = recortar(historial, ventana - reserva)',
    details: 'Ventanas actuales: de 8 000 a más de un millón de tokens. Más contexto significa más coste y latencia, y el modelo puede pasar por alto datos en mitad de un texto muy largo. Estrategias: conservar el mensaje del sistema, resumir lo antiguo, recuperar solo lo relevante (RAG).',
    examples: [[`from dojo_ai.tokenizer import contar_tokens
mensajes = ["Hola, quiero devolver unas zapatillas.", "¿Y cuánto tarda el reembolso?"]
print(sum(contar_tokens(m) for m in mensajes))`, 'tokens que ocupan los mensajes de una conversación']],
    seeAlso: ['token', 'contar_tokens'],
  },
  {
    name: 'alucinación',
    kind: 'concepto',
    category: 'llm',
    level: 2,
    summary: 'Respuesta fluida y segura de sí misma pero **falsa o inventada**. Aparece porque un LLM genera lo probable, no lo verdadero, y rellena con algo verosímil cuando no tiene el dato.',
    usage: 'Mitigaciones: RAG con citas · pedir que se abstenga · herramientas · temperatura baja · verificar',
    details: 'Son más frecuentes con datos raros, recientes o muy específicos (cifras, citas, referencias legales o científicas). No se eliminan por completo: hay que **diseñar el sistema** para detectarlas (evaluar con preguntas conocidas, comprobar las citas, pedir fuentes) y aceptar que el modelo diga «no lo sé».',
    examples: [[`# Comprobar que la respuesta está respaldada por el contexto
contexto = "Los pedidos de más de 50 euros tienen envío gratis."
respuesta = "El envío es gratis a partir de 50 euros."
print("50" in contexto and "50" in respuesta)`, 'una comprobación mínima: la cifra de la respuesta aparece en la fuente']],
    seeAlso: ['temperatura', 'ventana de contexto'],
  },
];
