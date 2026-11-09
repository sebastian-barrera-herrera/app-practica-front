import type { IaRef } from '../reference';

/** Fichas de IA responsable, evaluación y producción (Z15). */
export const RESPONSABLE_REFS: IaRef[] = [
  {
    name: 'sesgo y equidad',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Un modelo puede tratar peor a ciertos grupos porque aprende de datos históricos desiguales, de variables proxy o de un objetivo mal elegido. Se detecta **midiendo los resultados por grupo**, no mirando qué columnas usa.',
    usage: 'tasa_A = pred[grupo == 0].mean();  tasa_B = pred[grupo == 1].mean()\nrazon = min(tasa_A, tasa_B) / max(tasa_A, tasa_B)   # ≥ 0,8: regla de los cuatro quintos',
    details: 'Mitigaciones: antes (reponderar o ampliar datos), durante (restricciones de equidad) y después (umbrales por grupo). Cada una tiene costes en precisión y a veces implicaciones legales. No se pueden satisfacer todos los criterios a la vez: elegir cuál prima es una decisión ética y de negocio. Los LLM añaden sesgos de estereotipo e idioma.',
    examples: [[`import numpy as np
pred = np.array([1, 1, 0, 0, 1, 0]); grupo = np.array([0, 0, 0, 1, 1, 1])
a, b = pred[grupo == 0].mean(), pred[grupo == 1].mean()
print(round(float(a), 3), round(float(b), 3), round(float(min(a, b) / max(a, b)), 3))`, 'tasas de aprobación y razón de impacto']],
    seeAlso: ['paridad demográfica', 'igualdad de oportunidades'],
  },
  {
    name: 'paridad demográfica',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Criterio de equidad: la proporción de resultados positivos (aprobados) debe ser similar en todos los grupos. Se resume con la diferencia de tasas o con la **razón de impacto** (menor/mayor, ≥ 0,8 como regla práctica).',
    usage: 'paridad = tasa(pred, grupo, 0) - tasa(pred, grupo, 1)',
    details: 'Ignora quién *merecía* el resultado: puede exigir aprobar a personas con menor probabilidad de éxito si las tasas base difieren. Por eso se complementa con la igualdad de oportunidades. Es una señal de alarma para investigar, no un veredicto por sí sola.',
    examples: [[`import numpy as np
pred = np.array([1, 1, 0, 0, 1, 0]); grupo = np.array([0, 0, 0, 1, 1, 1])
print(round(float(pred[grupo == 0].mean() - pred[grupo == 1].mean()), 4))`, 'diferencia de aprobación entre grupos']],
    seeAlso: ['sesgo y equidad', 'igualdad de oportunidades'],
  },
  {
    name: 'igualdad de oportunidades',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Criterio de equidad: entre quienes **sí merecían** el resultado positivo (por ejemplo, devolverían el préstamo), la tasa de aprobados (verdaderos positivos) debe ser igual en todos los grupos.',
    usage: 'tpr(g) = pred[(grupo == g) & (real == 1)].mean()\ndiferencia = tpr(0) - tpr(1)',
    details: 'Es la medida adecuada cuando lo grave es negar algo a quien lo merecía. Corregir la paridad demográfica puede cambiar el signo de esta diferencia: los criterios compiten entre sí. Requiere etiquetas fiables de lo que «merecía» cada persona, que a menudo están sesgadas.',
    examples: [[`import numpy as np
real = np.array([1, 1, 0, 1, 1, 0]); pred = np.array([1, 1, 0, 0, 1, 0]); grupo = np.array([0, 0, 0, 1, 1, 1])
tpr = lambda g: float(pred[(grupo == g) & (real == 1)].mean())
print(tpr(0), tpr(1))`, 'verdaderos positivos de cada grupo']],
    seeAlso: ['paridad demográfica', 'sesgo y equidad'],
  },
  {
    name: 'datos personales (PII)',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Información que identifica o puede identificar a una persona (correo, teléfono, DNI, tarjeta, dirección, datos de salud…). Se **minimizan**, se **enmascaran** antes de guardarlos o enviarlos a terceros y se borran cuando ya no hacen falta.',
    usage: 'texto_seguro = enmascarar(texto)   # <EMAIL>, <TELEFONO>, <DNI>, <TARJETA>',
    details: 'Los patrones (regex + validación) detectan formatos fijos, pero no nombres ni direcciones: se combinan con modelos de reconocimiento de entidades. Aplica la minimización también a prompts, logs, memorias de agentes e índices de RAG, y planifica cómo atender una petición de supresión.',
    examples: [[`import re
t = "Escribe a ana@correo.example o llama al 612 345 678"
t = re.sub(r"[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+", "<EMAIL>", t)
print(re.sub(r"\\b[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b", "<TELEFONO>", t))`, 'enmascarado de correo y teléfono']],
    seeAlso: ['algoritmo de Luhn', 'k-anonimato', 'pseudonimización'],
  },
  {
    name: 'algoritmo de Luhn',
    kind: 'función',
    category: 'agentes',
    level: 3,
    summary: 'Suma de comprobación que cumplen los números de tarjeta: de derecha a izquierda se duplica un dígito de cada dos (restando 9 si pasa de 9) y el total debe ser múltiplo de 10. Evita enmascarar números largos que no son tarjetas.',
    usage: 'luhn("4539 1488 0343 6467")  →  True',
    details: 'Solo detecta errores de tecleo, no prueba que la tarjeta exista. Se usa como segunda comprobación tras una regex de 13–16 dígitos para reducir falsos positivos (números de pedido, teléfonos largos).',
    examples: [[`def luhn(n):
    d = [int(c) for c in n if c.isdigit()][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(2 * x, 10)) for x in d[1::2])) % 10 == 0
print(luhn("4539 1488 0343 6467"), luhn("1234 5678 9012 3456"))`, 'una tarjeta válida y un número cualquiera']],
    seeAlso: ['datos personales (PII)'],
  },
  {
    name: 'k-anonimato',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Propiedad de una tabla: cada combinación de **casi-identificadores** (edad, código postal, sexo…) aparece al menos *k* veces, de modo que nadie es único. Un k = 1 indica personas identificables. Se mejora generalizando valores o suprimiendo filas.',
    usage: 'k = min(tamaño de cada grupo de filas con los mismos casi-identificadores)',
    details: 'Es un mínimo, no una garantía total (ataques por homogeneidad o por conocimiento previo). Medidas más fuertes: l-diversidad y privacidad diferencial, que añade ruido controlado a los resultados.',
    examples: [[`filas = [("30-40", "280"), ("30-40", "280"), ("40-50", "280"), ("40-50", "081")]
def k(cols):
    g = {}
    for f in filas:
        g[tuple(f[c] for c in cols)] = g.get(tuple(f[c] for c in cols), 0) + 1
    return min(g.values())
print(k([0]), k([0, 1]))`, 'solo la edad: k=2; edad y código postal: k=1']],
    seeAlso: ['pseudonimización', 'datos personales (PII)'],
  },
  {
    name: 'pseudonimización',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Sustituir un identificador (correo, DNI) por un código, normalmente un hash con sal, para poder unir registros sin ver el dato. Reduce el riesgo pero **sigue siendo dato personal** porque se puede re-identificar con información adicional.',
    usage: 'hashlib.sha256((sal + valor).encode()).hexdigest()[:8]',
    details: 'Guarda la sal (o la tabla de equivalencias) separada y protegida. Distinto de la anonimización, que elimina la posibilidad razonable de re-identificar. Un hash sin sal de un valor conocido (un correo) se puede recalcular y comparar.',
    examples: [[`import hashlib
def pseudonimo(valor, sal):
    return hashlib.sha256((sal + valor).encode()).hexdigest()[:8]
print(pseudonimo("marta@correo.example", "s1") == pseudonimo("marta@correo.example", "s1"))`, 'el mismo valor y sal dan el mismo código']],
    seeAlso: ['k-anonimato', 'datos personales (PII)'],
  },
  {
    name: 'intervalo de confianza',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Rango en el que, con una confianza dada (95 %), está el valor real de una métrica estimada con una muestra. Con pocos casos de evaluación es muy ancho: diferencias menores que el intervalo no se pueden distinguir del ruido.',
    usage: 'bajo, alto = intervalo_bootstrap(aciertos)  # p. ej. (0.68, 0.90)',
    details: 'Se estrecha con la raíz del tamaño de la muestra: para reducirlo a la mitad hay que cuadruplicar los casos. Dilo siempre junto a la métrica («90 % ± 8») y exige intervalos que no se solapen antes de declarar que una versión es mejor.',
    examples: [[`import math
p, n = 0.8, 100
print(round(1.96 * math.sqrt(p * (1 - p) / n), 3))`, 'margen aproximado: ±0,078 con 100 casos']],
    seeAlso: ['bootstrap', 'evaluar un prompt'],
  },
  {
    name: 'bootstrap',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Técnica para estimar la incertidumbre de una métrica **remuestreando con reemplazo** el conjunto de evaluación muchas veces y mirando cómo varía. Los percentiles 2,5 y 97,5 de esas métricas dan un intervalo de confianza del 95 %.',
    usage: 'r = np.random.default_rng(0)\nmedias = [a[r.integers(0, n, n)].mean() for _ in range(1000)]\nnp.percentile(medias, [2.5, 97.5])',
    details: 'No requiere suponer una distribución concreta y funciona con casi cualquier métrica (F1, precisión, coste). Fija una semilla para que sea reproducible. Asume que los casos son independientes: no vale si hay muchos casi duplicados.',
    examples: [[`import numpy as np
a = np.array([1] * 8 + [0] * 2, dtype=float)
r = np.random.default_rng(0)
medias = [a[r.integers(0, 10, 10)].mean() for _ in range(1000)]
print(round(float(np.percentile(medias, 2.5)), 2), round(float(np.percentile(medias, 97.5)), 2))`, 'intervalo con solo 10 casos']],
    seeAlso: ['intervalo de confianza'],
  },
  {
    name: 'LLM como juez',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Usar un modelo para puntuar o comparar respuestas de otro. Escala la evaluación de texto abierto, pero tiene sesgos: prefiere respuestas largas, su propio estilo y a veces la primera opción presentada. Debe **calibrarse** con puntuaciones humanas.',
    usage: 'r = client.chat.completions.create(..., messages=[{"role": "system", "content": "Eres un juez…"}, {"role": "user", "content": "Referencia: …\\nRespuesta: …"}])',
    details: 'Mejoras: rúbricas claras, comparaciones por pares con el orden aleatorizado, varias muestras, reglas verificables para lo que sí se puede comprobar con código y revisión humana de una muestra. Mide el acuerdo del juez con personas.',
    examples: [[`from dojo_ai.llm import Client
r = Client().chat.completions.create(model="dojo-mini", temperature=0, messages=[
    {"role": "system", "content": "Eres un juez. Evalúa la respuesta frente a la referencia con una puntuación de 1 a 5."},
    {"role": "user", "content": "Referencia: Puedes devolver cualquier producto en 30 días.\\nRespuesta: Tienes 30 días para devolverlo."}])
print(r.choices[0].message.content)`, 'una nota del juez simulado']],
    seeAlso: ['F1 de tokens', 'intervalo de confianza'],
  },
  {
    name: 'F1 de tokens',
    kind: 'función',
    category: 'agentes',
    level: 3,
    summary: 'Métrica de solapamiento de palabras entre una respuesta y la referencia: media armónica de precisión (palabras correctas / palabras de la respuesta) y recall (palabras correctas / palabras de la referencia). Clásica en preguntas y respuestas extractivas.',
    usage: 'f1 = 2 * p * r / (p + r)',
    details: 'Rápida y reproducible, pero ciega a los sinónimos y a la negación («sí» y «no» puntúan igual si el resto coincide). Combínala con similitud de embeddings, reglas (¿aparece la cifra correcta?) y revisión humana.',
    examples: [[`def f1(pred, ref):
    a, b = pred.lower().split(), ref.lower().split()
    comunes = sum(min(a.count(w), b.count(w)) for w in set(a))
    if not comunes:
        return 0.0
    p, r = comunes / len(a), comunes / len(b)
    return 2 * p * r / (p + r)
print(round(f1("Tienes 30 días para devolverlo", "Puedes devolver en 30 días"), 3))`, 'dos palabras en común de cinco y cinco']],
    seeAlso: ['LLM como juez', 'intervalo de confianza'],
  },
  {
    name: 'caché de respuestas',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Guardar la respuesta de una petición para no volver a pagarla ni esperarla si se repite. La caché **exacta** usa la petición como clave; la **semántica** compara embeddings para reconocer preguntas equivalentes.',
    usage: 'cache.obtener((modelo, prompt), lambda: llamar_al_modelo())',
    details: 'La clave debe incluir modelo, prompt y parámetros. Pon caducidad y no mezcles respuestas con datos de usuarios distintos. En la caché semántica, un umbral demasiado laxo devuelve respuestas de otra pregunta: mídelo. Algunos proveedores ofrecen además caché de prompts largos con descuento.',
    examples: [[`datos = {}
def obtener(clave, calcular):
    if clave not in datos:
        datos[clave] = calcular()
    return datos[clave]
print(obtener("a", lambda: 1), obtener("a", lambda: 2))`, 'la segunda llamada devuelve lo guardado']],
    seeAlso: ['enrutado de modelos', 'coste mensual'],
  },
  {
    name: 'enrutado de modelos',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Elegir para cada petición el modelo más barato que la resuelva bien: las preguntas sencillas al modelo pequeño y las difíciles (o las de baja confianza) al grande. Puede recortar la factura un orden de magnitud.',
    usage: 'modelo = "dojo-pro" if es_dificil(pregunta) else "dojo-mini"',
    details: 'Empieza con reglas (longitud, palabras clave) y evoluciona a un clasificador o a la confianza del modelo barato («escala si no estás seguro»). Mide la calidad por tipo de petición: un enrutador demasiado agresivo degrada la experiencia sin que se note en la media.',
    examples: [[`def enrutar(p):
    t = p.lower()
    return "dojo-pro" if len(t.split()) > 25 or "compara" in t else "dojo-mini"
print(enrutar("¿Cuál es la capital de Francia?"), enrutar("Compara los planes de envío"))`, 'una pregunta fácil y una difícil']],
    seeAlso: ['caché de respuestas', 'coste mensual'],
  },
  {
    name: 'espera exponencial',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: '*Exponential backoff*: tras cada fallo transitorio (límite de uso, 5xx) se espera el doble que antes (1 s, 2 s, 4 s…) hasta un tope, con un máximo de intentos y algo de aleatoriedad (*jitter*) para no sincronizar a todos los clientes.',
    usage: 'espera = min(tope, base * 2 ** intento)',
    details: 'Solo se reintentan errores transitorios; una petición inválida (400) no mejora repitiéndola. Combínalo con tiempos máximos, un cortacircuitos que deje de llamar si el servicio está caído y una alternativa (otro modelo o respuesta enlatada).',
    examples: [[`print([min(30.0, 1.0 * 2 ** i) for i in range(7)])`, 'las esperas crecen y se detienen en el tope']],
    seeAlso: ['coste mensual', 'LLMOps'],
  },
  {
    name: 'coste mensual',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Estimación del gasto en un LLM: `peticiones × (tokens_entrada × precio_entrada + tokens_salida × precio_salida)`, descontando las servidas por caché y mezclando los precios según el modelo usado. Los precios van por millón de tokens.',
    usage: 'coste_mensual(100000, 1000, 300, "dojo-mini", acierto_cache=0.3)',
    details: 'La salida suele costar 4–5 veces más que la entrada. Los agentes y el RAG multiplican los tokens de entrada (historial y contexto en cada vuelta). Calcula el coste **por tarea resuelta**, no solo por llamada, y pon alertas y topes de presupuesto.',
    examples: [[`from dojo_ai.llm import coste
print(round(100000 * coste({"prompt_tokens": 1000, "completion_tokens": 300}, "dojo-mini"), 2))`, '33 $ al mes con el modelo pequeño']],
    seeAlso: ['enrutado de modelos', 'caché de respuestas', 'contar_tokens'],
  },
  {
    name: 'LLMOps',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Prácticas para operar sistemas con LLM: versionar prompts, modelos e índices, desplegar gradualmente con reversión, monitorizar calidad, coste, latencia y seguridad, probar cambios con A/B y puertas de regresión, y documentar y gobernar el sistema.',
    usage: 'cada respuesta registra: versión de prompt · modelo · índice · herramientas · coste · latencia',
    details: 'La deriva (cambios en el modelo del proveedor, en los datos o en los usuarios) degrada la calidad sin avisar. Convierte los fallos reales en casos de prueba, define responsables y un plan de incidentes y revisa periódicamente si el sistema sigue siendo adecuado.',
    examples: [[`registro = {"prompt": "v3", "modelo": "dojo-mini", "indice": "manual-2026-11", "coste": 0.0003}
print(sorted(registro))`, 'qué conviene guardar por cada respuesta']],
    seeAlso: ['prueba A/B', 'lista de lanzamiento'],
  },
  {
    name: 'prueba A/B',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Comparar dos versiones con usuarios reales repartidos al azar. Un test de dos proporciones da un valor p: la probabilidad de ver una diferencia así si en realidad no hubiera ninguna. p < 0,05 se suele considerar significativo.',
    usage: 'ab_test(80, 100, 90, 100)  →  {"z": 1.98, "p": 0.0477, "significativo": True}',
    details: 'Fija el tamaño de la muestra antes de empezar y no pares en cuanto salga «bien» (inflas los falsos positivos). Un resultado significativo no implica que la mejora importe: mira el tamaño del efecto, el coste y los efectos secundarios (quejas, abstenciones, latencia).',
    examples: [[`import math
pa, pb, n = 0.8, 0.9, 100
p = (pa + pb) / 2
se = math.sqrt(p * (1 - p) * 2 / n)
print(round((pb - pa) / se, 3))`, 'el estadístico z de la comparación']],
    seeAlso: ['LLMOps', 'intervalo de confianza'],
  },
  {
    name: 'nivel de riesgo',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'El Reglamento europeo de IA gradúa las obligaciones según el **uso** del sistema: prohibido, alto riesgo (empleo, crédito, salud, educación…), transparencia (chatbots, contenido generado) y riesgo mínimo. Aquí es una clasificación didáctica, no asesoramiento legal.',
    usage: 'nivel_riesgo(["chatbot", "credito"])  →  "alto"',
    details: 'Manda el uso más grave. Alto riesgo implica evaluación de riesgos, calidad de datos, registro, documentación técnica, supervisión humana y ciberseguridad; los sistemas de propósito general tienen además obligaciones propias. Para un caso real, consulta a quien conozca la norma vigente.',
    examples: [[`ALTO = {"empleo", "credito", "salud"}
usos = ["chatbot", "credito"]
print("alto" if set(usos) & ALTO else "otro")`, 'un uso de alto riesgo domina']],
    seeAlso: ['lista de lanzamiento', 'LLMOps'],
  },
  {
    name: 'lista de lanzamiento',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Requisitos mínimos antes de sacar un sistema de IA a producción: evaluación con conjunto oculto, prueba de equidad, PII enmascarada, límites de pasos y de coste, plan de reversión, monitorización, supervisión humana y documentación.',
    usage: 'pendientes = [r for r in REQUISITOS if r not in hecho]',
    details: 'Conviértela en una puerta automática del despliegue siempre que se pueda (pruebas que fallan si falta algo). Revísala tras cada incidente: lo que falló una vez se añade a la lista.',
    examples: [[`REQ = ["evaluación", "equidad", "PII", "reversión"]
hecho = ["evaluación", "PII"]
print([r for r in REQ if r not in hecho])`, 'lo que falta por hacer']],
    seeAlso: ['LLMOps', 'nivel de riesgo'],
  },
];
