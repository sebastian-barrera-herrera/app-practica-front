import { all, calls, fill, iaWorld, illus, learn, lesson, match, mc, multi, order, pyDemo, pyPractice, tf, truthy } from './iabuild';

/** Datos sintéticos de préstamos (equidad): el grupo B parte con rentas históricamente menores. */
const PRESTAMOS = `import numpy as np

rng = np.random.default_rng(2)
n = 400
grupo = rng.integers(0, 2, n)                              # 0 = grupo A, 1 = grupo B
renta = rng.normal(50, 12, n) - 6 * grupo                  # el grupo B parte con rentas históricamente menores
score = 1 / (1 + np.exp(-(renta - 50) / 8))                # probabilidad de devolver que estima el modelo
real = (rng.random(n) < score).astype(int)                 # 1 = el cliente devolvió el préstamo
pred = (score >= 0.5).astype(int)                          # el modelo aprueba si la puntuación llega a 0,5
`;

const METRICAS = `
def tasa_aprobacion(pred, grupo, g):
    return float(pred[grupo == g].mean())

def paridad_demografica(pred, grupo):
    return tasa_aprobacion(pred, grupo, 0) - tasa_aprobacion(pred, grupo, 1)

def razon_impacto(pred, grupo):
    a, b = tasa_aprobacion(pred, grupo, 0), tasa_aprobacion(pred, grupo, 1)
    return min(a, b) / max(a, b)

def tpr(real, pred, grupo, g):
    m = (grupo == g) & (real == 1)
    return float(pred[m].mean())

def umbral_para_tasa(score, grupo, g, objetivo):
    s = np.sort(score[grupo == g])[::-1]
    k = max(int(round(objetivo * len(s))), 1)
    return float(s[k - 1])
`;

/** Detectores de datos personales. */
const PII = `import re

RE_EMAIL = re.compile(r"[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")
RE_TEL = re.compile(r"(?:\\+34\\s?)?\\b[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b")
RE_DNI = re.compile(r"\\b\\d{8}[A-Z]\\b")
RE_TARJ = re.compile(r"\\b\\d(?:[ -]?\\d){12,15}\\b")

def luhn(numero):
    d = [int(c) for c in numero if c.isdigit()][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(2 * x, 10)) for x in d[1::2])) % 10 == 0

def detectar_pii(texto):
    out = {"email": RE_EMAIL.findall(texto), "tarjeta": [t for t in RE_TARJ.findall(texto) if luhn(t)],
           "dni": RE_DNI.findall(texto), "telefono": RE_TEL.findall(texto)}
    return {k: v for k, v in out.items() if v}

def enmascarar(texto):
    t = RE_EMAIL.sub("<EMAIL>", texto)
    t = RE_TARJ.sub(lambda m: "<TARJETA>" if luhn(m.group(0)) else m.group(0), t)
    t = RE_DNI.sub("<DNI>", t)
    return RE_TEL.sub("<TELEFONO>", t)
`;

export const ia15 = iaWorld({
  id: 'ia15',
  index: 15,
  title: 'IA responsable y producción',
  subtitle: 'Equidad, privacidad, evaluación rigurosa, coste, fiabilidad y gobierno de sistemas de IA',
  emoji: '🏁',
  color: '#F59E0B',
  level: 'avanzado',
  intro:
    'Un sistema de IA que funciona en una demo no es un sistema listo para usarse. En producción importan otras preguntas: ¿trata **igual de bien a todos los grupos**? ¿qué hace con los **datos personales**? ¿cómo sabes, **con números fiables**, que una versión es mejor que otra? ¿cuánto **cuesta**, cuánto **tarda** y qué pasa cuando el proveedor **falla**? ¿quién lo **vigila** y qué dice la **normativa**? Esta zona final recorre ese camino con código: medirás sesgos con métricas de equidad, detectarás y enmascararás datos personales, calcularás intervalos de confianza y descubrirás los sesgos de un juez automático, reducirás costes con caché y enrutado, programarás reintentos con espera exponencial y cerrarás con una **auditoría previa al lanzamiento**.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('ia15-1', { title: 'Sesgo y equidad', summary: 'De dónde viene el sesgo, cómo medirlo por grupos y qué compromisos hay al corregirlo', emoji: '⚖️', commands: ['sesgo y equidad', 'paridad demográfica', 'igualdad de oportunidades'], minutes: 16 }, [
      learn(
        'El sesgo no está solo en el algoritmo',
        `
Un modelo aprende patrones de **datos históricos**, y los datos reflejan decisiones y desigualdades pasadas. Fuentes típicas de sesgo:

- **Datos**: grupos poco representados, etiquetas que reflejan prejuicios previos (a quién se concedieron créditos antes), medición desigual.
- **Variables proxy**: aunque quites el género o el origen, el código postal, el nombre o los ingresos pueden codificarlo.
- **Objetivo mal elegido**: optimizar «clics» o «beneficio» puede perjudicar a un colectivo.
- **Bucles de retroalimentación**: el sistema decide, sus decisiones generan datos, y el siguiente modelo aprende de ellas.
- **LLM**: heredan estereotipos del texto con el que se entrenaron y funcionan peor en dialectos o idiomas con menos datos.

Medir el sesgo exige **comparar resultados por grupo**. Tres criterios habituales:
- **Paridad demográfica**: ¿se aprueba la misma proporción en cada grupo? (se resume con la *razón de impacto*; la regla de los «cuatro quintos» pide ≥ 0,8).
- **Igualdad de oportunidades**: entre quienes *merecían* la aprobación, ¿se aprueba igual a todos los grupos? (misma tasa de verdaderos positivos).
- **Calibración / paridad predictiva**: ¿significa lo mismo «80 % de probabilidad» en cada grupo?

Resultado teórico incómodo: **salvo casos triviales, no se pueden cumplir todos a la vez**. Elegir cuál importa es una decisión ética, legal y de negocio, no solo técnica.
`,
        '⚖️',
      ),
      pyDemo(
        'Medir las tasas por grupo',
        [
          [
            `${PRESTAMOS}${METRICAS}
print("personas en el grupo B:", int(grupo.sum()), "de", n)
print("aprobación A:", round(tasa_aprobacion(pred, grupo, 0), 3), " B:", round(tasa_aprobacion(pred, grupo, 1), 3))
print("diferencia:", round(paridad_demografica(pred, grupo), 3), " razón de impacto:", round(razon_impacto(pred, grupo), 3))
print("verdaderos positivos A:", round(tpr(real, pred, grupo, 0), 3), " B:", round(tpr(real, pred, grupo, 1), 3))`,
            'Con el mismo umbral para todos se aprueba al 50,8 % del grupo A y al 25,8 % del B: la razón de impacto es 0,51, muy por debajo de 0,8. El modelo **solo mira la renta**, pero esa renta ya arrastra una desigualdad previa. Y entre quienes sí devolverían el préstamo, también se aprueba menos al grupo B (al 59 % frente al 72 % del grupo A)',
          ],
        ],
      ),
      illus('ia-fairness', 'Mueve los umbrales', 'Cambia los umbrales de cada grupo y observa cómo se mueven la razón de impacto, la precisión y los verdaderos positivos. Prueba el interruptor que iguala las tasas.'),
      pyDemo(
        'Igualar tasas tiene un coste',
        [
          [
            `${PRESTAMOS}${METRICAS}
objetivo = tasa_aprobacion(pred, grupo, 0)
u = umbral_para_tasa(score, grupo, 1, objetivo)
pred2 = pred.copy()
pred2[grupo == 1] = (score[grupo == 1] >= u).astype(int)
print("umbral del grupo B:", round(u, 3), "(el de A sigue en 0.5)")
print("razón de impacto:", round(razon_impacto(pred, grupo), 3), "->", round(razon_impacto(pred2, grupo), 3))
print("precisión global:", round(float((pred == real).mean()), 3), "->", round(float((pred2 == real).mean()), 3))
print("diferencia de verdaderos positivos:", round(tpr(real, pred, grupo, 0) - tpr(real, pred, grupo, 1), 3), "->", round(tpr(real, pred2, grupo, 0) - tpr(real, pred2, grupo, 1), 3))`,
            'Bajando el umbral del grupo B a 0,25 las tasas se igualan (razón 0,999) pero la precisión baja de 0,765 a 0,725 y la diferencia de verdaderos positivos **cambia de signo** (−0,152): ahora se favorece al grupo B entre quienes merecían el crédito. Corregir un criterio descoloca otro. Aplicar umbrales distintos por grupo puede además ser **ilegal** según el ámbito: consulta siempre a quien conozca la normativa',
          ],
        ],
      ),
      mc('Quitas la columna "género" del modelo y el sesgo persiste. ¿Por qué?', ['Otras variables (proxies) pueden codificar la misma información', 'Porque el modelo recuerda el género de otras ejecuciones', 'Porque quitar columnas nunca cambia nada', 'Porque el sesgo solo viene del algoritmo de entrenamiento'], 0, 'Código postal, historial, ingresos o incluso el nombre correlacionan con atributos protegidos. Para detectar el sesgo hay que medirlo por grupo (aunque no se use la variable) y revisar las variables proxy.'),
      tf('Si un modelo no usa variables sensibles, sus resultados son automáticamente justos.', false, 'La justicia se mide en los resultados por grupo, no en las columnas de entrada. Un modelo sin variables sensibles puede tratar de forma muy distinta a distintos colectivos.'),
      pyPractice({
        goal: 'Tasa de aprobación por grupo',
        prompt: 'Escribe `tasa_aprobacion(pred, grupo, g)`: fracción de aprobados (`pred == 1`) entre las personas del grupo `g`. Devuelve un `float`. `pred` y `grupo` son arrays de NumPy.',
        starter: 'import numpy as np\n\ndef tasa_aprobacion(pred, grupo, g):\n    pass\n',
        check: calls([
          ['round(tasa_aprobacion(np.array([1, 1, 0, 0, 1, 0]), np.array([0, 0, 0, 1, 1, 1]), 0), 4)', '0.6667'],
          ['round(tasa_aprobacion(np.array([1, 1, 0, 0, 1, 0]), np.array([0, 0, 0, 1, 1, 1]), 1), 4)', '0.3333'],
          ['type(tasa_aprobacion(np.array([1, 0]), np.array([0, 0]), 0)).__name__', "'float'"],
        ]),
        solution: 'import numpy as np\n\ndef tasa_aprobacion(pred, grupo, g):\n    return float(pred[grupo == g].mean())\n',
        hints: ['Filtra con la máscara `grupo == g` y calcula la media de `pred`.', 'Envuelve el resultado en `float(...)`.'],
        explain: 'La media de un array de 0 y 1 es la fracción de unos. Con esta función, tres líneas más dan la paridad demográfica y la razón de impacto de cualquier modelo de decisión.',
        commands: ['paridad demográfica'],
      }),
      pyPractice({
        goal: 'Razón de impacto',
        prompt: 'Escribe `razon_impacto(pred, grupo)`: cociente entre la tasa de aprobación **menor** y la **mayor** de los grupos 0 y 1 (siempre entre 0 y 1). La regla de los cuatro quintos pide ≥ 0,8. (`tasa_aprobacion` ya está escrita.)',
        starter: 'import numpy as np\n\ndef tasa_aprobacion(pred, grupo, g):\n    return float(pred[grupo == g].mean())\n\ndef razon_impacto(pred, grupo):\n    pass\n',
        check: calls([
          ['round(razon_impacto(np.array([1, 1, 0, 0, 1, 0]), np.array([0, 0, 0, 1, 1, 1])), 4)', '0.5'],
          ['razon_impacto(np.array([1, 0, 1, 0]), np.array([0, 0, 1, 1]))', '1.0'],
          ['round(razon_impacto(np.array([0, 1, 1, 1]), np.array([0, 0, 1, 1])), 3)', '0.5'],
        ]),
        solution: 'import numpy as np\n\ndef tasa_aprobacion(pred, grupo, g):\n    return float(pred[grupo == g].mean())\n\ndef razon_impacto(pred, grupo):\n    a, b = tasa_aprobacion(pred, grupo, 0), tasa_aprobacion(pred, grupo, 1)\n    return min(a, b) / max(a, b)\n',
        hints: ['Calcula las dos tasas y divide la menor entre la mayor: `min(a, b) / max(a, b)`.'],
        explain: 'Al dividir menor entre mayor, el resultado no depende de qué grupo esté favorecido. Un valor < 0,8 es una señal de alerta de impacto dispar, no una sentencia: hay que analizar el porqué.',
        commands: ['paridad demográfica', 'sesgo y equidad'],
      }),
      pyPractice({
        goal: 'Igualdad de oportunidades',
        prompt: 'Escribe `igualdad_oportunidad(real, pred, grupo)`: diferencia entre la tasa de verdaderos positivos del grupo 0 y la del grupo 1 (`pred[real == 1]` dentro de cada grupo). Positivo = se favorece al grupo 0.',
        starter: 'import numpy as np\n\ndef igualdad_oportunidad(real, pred, grupo):\n    pass\n',
        check: calls([
          ['igualdad_oportunidad(np.array([1, 1, 0, 1, 1, 0]), np.array([1, 1, 0, 0, 1, 0]), np.array([0, 0, 0, 1, 1, 1]))', '0.5'],
          ['igualdad_oportunidad(np.array([1, 1, 1, 1]), np.array([1, 0, 1, 0]), np.array([0, 0, 1, 1]))', '0.0'],
          ['igualdad_oportunidad(np.array([1, 1, 1, 1]), np.array([0, 0, 1, 1]), np.array([0, 0, 1, 1]))', '-1.0'],
        ]),
        solution: 'import numpy as np\n\ndef igualdad_oportunidad(real, pred, grupo):\n    def tpr(g):\n        m = (grupo == g) & (real == 1)\n        return float(pred[m].mean())\n    return tpr(0) - tpr(1)\n',
        hints: ['Define una función interna `tpr(g)` con la máscara `(grupo == g) & (real == 1)`.', 'Devuelve `tpr(0) - tpr(1)`.'],
        explain: 'Mide si quienes *sí* devolverían el préstamo tienen las mismas opciones de recibirlo en cada grupo. Es el criterio que más importa cuando el error es «negar algo que se merecía».',
        commands: ['igualdad de oportunidades'],
      }),
      pyPractice({
        goal: 'Umbral para igualar la tasa',
        prompt: 'Escribe `umbral_para_tasa(score, grupo, g, objetivo)`: ordena de mayor a menor las puntuaciones del grupo `g`, toma `k = max(round(objetivo × tamaño), 1)` y devuelve la puntuación en la posición `k` (la `k`-ésima mayor). Con ese umbral se aprueba aproximadamente la fracción `objetivo` del grupo.',
        starter: 'import numpy as np\n\ndef umbral_para_tasa(score, grupo, g, objetivo):\n    pass\n',
        check: calls([
          ['umbral_para_tasa(np.array([0.9, 0.7, 0.5, 0.3, 0.8, 0.6, 0.2, 0.1]), np.array([0, 0, 0, 0, 1, 1, 1, 1]), 1, 0.5)', '0.6'],
          ['umbral_para_tasa(np.array([0.9, 0.7, 0.5, 0.3, 0.8, 0.6, 0.2, 0.1]), np.array([0, 0, 0, 0, 1, 1, 1, 1]), 0, 0.25)', '0.9'],
          ['umbral_para_tasa(np.array([0.9, 0.7, 0.5, 0.3, 0.8, 0.6, 0.2, 0.1]), np.array([0, 0, 0, 0, 1, 1, 1, 1]), 0, 1.0)', '0.3'],
        ]),
        solution: 'import numpy as np\n\ndef umbral_para_tasa(score, grupo, g, objetivo):\n    s = np.sort(score[grupo == g])[::-1]\n    k = max(int(round(objetivo * len(s))), 1)\n    return float(s[k - 1])\n',
        hints: ['`np.sort(...)[::-1]` ordena de mayor a menor.', 'La `k`-ésima mayor puntuación es `s[k - 1]`: todo lo que llegue a ese valor se aprueba.'],
        explain: 'Ajustar el umbral por grupo es una técnica de *posprocesado*. Otras actúan antes (reponderar o rebalancear los datos) o durante el entrenamiento (añadir restricciones de equidad). Ninguna sustituye a entender de dónde viene la desigualdad.',
        commands: ['sesgo y equidad'],
      }),
      match('Une cada criterio con su pregunta:', [['Paridad demográfica', '¿Se aprueba la misma proporción en cada grupo?'], ['Igualdad de oportunidades', 'Entre quienes lo merecían, ¿se aprueba igual a todos?'], ['Calibración', '¿Significa lo mismo el 80 % de probabilidad en cada grupo?'], ['Razón de impacto', 'Cociente entre la menor y la mayor tasa de aprobación']], 'No se pueden satisfacer todos a la vez salvo en casos triviales. Hay que elegir con criterio según el daño que cause cada tipo de error.'),
    ]),
    // ───────────────────────── 2 ─────────────────────────
    lesson('ia15-2', { title: 'Privacidad y datos personales', summary: 'Detectar y enmascarar datos personales, minimizar, pseudonimizar y medir la anonimización', emoji: '🔏', commands: ['datos personales (PII)', 'algoritmo de Luhn', 'k-anonimato', 'pseudonimización'], minutes: 15 }, [
      learn(
        'Los datos personales no se limpian solos',
        `
Los sistemas con IA mueven datos personales por muchos sitios: el prompt que envías a un proveedor, el historial, los logs, la memoria del agente, los conjuntos de entrenamiento. Principios básicos (RGPD y similares):

- **Minimización**: recoge y envía solo lo necesario. Si el modelo no necesita el DNI, no se lo des.
- **Finalidad y base legal**: usar los datos solo para lo que se informó y con una base que lo permita.
- **Limitación de conservación**: borra lo que ya no haga falta (logs incluidos).
- **Derechos de las personas**: acceso, rectificación y **supresión** (¿puedes borrar a una persona de logs, índices y memorias?).
- **Seguridad y proveedores**: sabe dónde van los datos, quién los trata y si se usan para entrenar.

Técnicas:
- **Detección y enmascarado** (regex + validación, o modelos de reconocimiento de entidades) antes de guardar o enviar.
- **Pseudonimización**: sustituir el identificador por un código (hash con sal); los datos siguen siendo personales porque se puede re-identificar con la clave.
- **Anonimización**: ya no se puede re-identificar. Es difícil: la combinación de *casi-identificadores* (edad, código postal, sexo) identifica a mucha gente. **k-anonimato**: cada combinación aparece al menos *k* veces.
`,
        '🔏',
      ),
      pyDemo(
        'Detectar y enmascarar',
        [
          [
            `${PII}
LOG = "Marta Gil (marta@correo.example) llamó desde 612 345 678. DNI 12345678Z. Pagó con la tarjeta 4539 1488 0343 6467 el pedido PED-48213."
print(detectar_pii(LOG))
print(enmascarar(LOG))
print(luhn("4539 1488 0343 6467"), luhn("1234 5678 9012 3456"))
print(enmascarar("Código 1234 5678 9012 3456 ok, llama al +34 612345678"))`,
            'Cuatro detectores distintos: correo, teléfono, DNI y tarjeta. El número de pedido **no** se toca. La tarjeta se confirma con **Luhn** (suma de comprobación): «1234 5678 9012 3456» tiene 16 dígitos pero no es una tarjeta válida, así que se deja. Aun así, nombres y direcciones no los pillan estos patrones: por eso se combinan con modelos de entidades y con minimización',
          ],
        ],
      ),
      illus('ia-privacy', 'Qué detecta cada patrón', 'Activa y desactiva detectores y mira qué datos quedan al descubierto. Cambia a la vista enmascarada para ver lo que se guardaría.'),
      pyDemo(
        'Pseudonimizar y medir el k-anonimato',
        [
          [
            `import hashlib

def pseudonimo(valor, sal):
    return hashlib.sha256((sal + valor).encode()).hexdigest()[:8]

print(pseudonimo("marta@correo.example", "sal1"), pseudonimo("marta@correo.example", "sal1"), pseudonimo("marta@correo.example", "sal2"))

def k_anonimato(filas, cuasi):
    grupos = {}
    for f in filas:
        clave = tuple(f[c] for c in cuasi)
        grupos[clave] = grupos.get(clave, 0) + 1
    return min(grupos.values()) if grupos else 0

FILAS = [{"edad": "30-40", "cp": "280"}, {"edad": "30-40", "cp": "280"}, {"edad": "40-50", "cp": "280"}, {"edad": "40-50", "cp": "081"}]
for cuasi in (["edad"], ["cp"], ["edad", "cp"]):
    print(cuasi, "-> k =", k_anonimato(FILAS, cuasi))`,
            'El mismo valor con la misma sal da siempre el mismo código (sirve para **unir** registros sin ver el dato) y con otra sal, otro distinto. Pero quien tenga la sal puede re-identificar: es pseudonimización, no anonimización. En la tabla, usando solo la edad hay al menos 2 personas por grupo (k = 2), pero con edad **y** código postal hay una persona única (k = 1): se la puede identificar',
          ],
        ],
      ),
      mc('Guardas el correo de los clientes como un hash con sal. ¿Es una anonimización?', ['No: es pseudonimización, porque quien tenga la sal puede re-identificar', 'Sí, un hash siempre es irreversible', 'Sí, mientras el hash tenga 8 caracteres', 'No hace falta ninguna técnica'], 0, 'Un hash determinista permite volver a calcular el código de un correo conocido y comparar. Sigue siendo dato personal, aunque reduce el riesgo.'),
      multi('¿Qué buenas prácticas reducen el riesgo al usar un LLM de un proveedor externo?', ['Enmascarar los datos personales antes de enviarlos', 'Enviar solo los campos necesarios para la tarea', 'Revisar si el proveedor usa los datos para entrenar y cómo los conserva', 'Registrar todos los prompts completos para siempre'], [0, 1, 2], 'Minimizar, enmascarar y conocer el tratamiento del proveedor reduce la exposición. Guardar todo indefinidamente la aumenta.'),
      pyPractice({
        goal: 'Validación de Luhn',
        prompt: 'Escribe `luhn(numero)`: toma solo los dígitos del texto, recórrelos **de derecha a izquierda**, duplica uno de cada dos empezando por el segundo (si el doble pasa de 9, resta 9) y comprueba que la suma total es múltiplo de 10.',
        starter: 'def luhn(numero):\n    pass\n',
        check: calls([
          ['luhn("4539 1488 0343 6467")', 'True'],
          ['luhn("1234 5678 9012 3456")', 'False'],
          ['luhn("79927398713")', 'True'],
          ['luhn("79927398710")', 'False'],
        ]),
        solution: 'def luhn(numero):\n    d = [int(c) for c in numero if c.isdigit()][::-1]\n    total = 0\n    for i, x in enumerate(d):\n        if i % 2 == 1:\n            x *= 2\n            if x > 9:\n                x -= 9\n        total += x\n    return total % 10 == 0\n',
        hints: ['`[int(c) for c in numero if c.isdigit()][::-1]` da los dígitos invertidos.', 'Duplica los de índice impar (`i % 2 == 1`) y resta 9 si el doble supera 9.'],
        explain: 'Luhn solo detecta errores de tecleo: no demuestra que la tarjeta exista. Sirve para reducir falsos positivos al buscar números de tarjeta en texto libre (no tapar cualquier número largo).',
        commands: ['algoritmo de Luhn', 'datos personales (PII)'],
      }),
      pyPractice({
        goal: 'Enmascara los datos personales',
        prompt: 'Escribe `enmascarar(texto)`: sustituye los correos por `<EMAIL>`, los DNI por `<DNI>` y los teléfonos de 9 dígitos (`6xx`–`9xx`, con espacios opcionales) por `<TELEFONO>`. Los patrones ya están definidos. Deja el resto del texto intacto.',
        starter: 'import re\n\nRE_EMAIL = re.compile(r"[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")\nRE_TEL = re.compile(r"(?:\\+34\\s?)?\\b[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b")\nRE_DNI = re.compile(r"\\b\\d{8}[A-Z]\\b")\n\ndef enmascarar(texto):\n    pass\n',
        check: calls([
          ['enmascarar("Escribe a ana@correo.example o llama al 612 345 678")', "'Escribe a <EMAIL> o llama al <TELEFONO>'"],
          ['enmascarar("DNI 12345678Z, pedido PED-48213")', "'DNI <DNI>, pedido PED-48213'"],
          ['enmascarar("Sin datos personales")', "'Sin datos personales'"],
        ]),
        solution: 'import re\n\nRE_EMAIL = re.compile(r"[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")\nRE_TEL = re.compile(r"(?:\\+34\\s?)?\\b[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b")\nRE_DNI = re.compile(r"\\b\\d{8}[A-Z]\\b")\n\ndef enmascarar(texto):\n    t = RE_EMAIL.sub("<EMAIL>", texto)\n    t = RE_DNI.sub("<DNI>", t)\n    return RE_TEL.sub("<TELEFONO>", t)\n',
        hints: ['`patron.sub("<ETIQUETA>", texto)` sustituye todas las coincidencias.', 'Encadena las tres sustituciones sobre el resultado de la anterior.'],
        explain: 'El orden importa: si quitaras primero los teléfonos, un número dentro de un DNI podría romperse. Enmascarar se hace **antes** de guardar en logs y **antes** de enviar a terceros, no después.',
        commands: ['datos personales (PII)'],
      }),
      pyPractice({
        goal: 'k-anonimato',
        prompt: 'Escribe `k_anonimato(filas, cuasi)`: `filas` es una lista de diccionarios y `cuasi` la lista de columnas casi-identificadoras. Agrupa las filas por la tupla de esos valores y devuelve el **tamaño del grupo más pequeño** (0 si no hay filas).',
        starter: 'def k_anonimato(filas, cuasi):\n    pass\n',
        check: calls([
          ['k_anonimato([{"e": "a", "c": "1"}, {"e": "a", "c": "1"}, {"e": "b", "c": "1"}, {"e": "b", "c": "2"}], ["e"])', '2'],
          ['k_anonimato([{"e": "a", "c": "1"}, {"e": "a", "c": "1"}, {"e": "b", "c": "1"}, {"e": "b", "c": "2"}], ["e", "c"])', '1'],
          ['k_anonimato([{"e": "a"}, {"e": "b"}], [])', '2'],
          ['k_anonimato([], ["e"])', '0'],
        ]),
        solution: 'def k_anonimato(filas, cuasi):\n    grupos = {}\n    for f in filas:\n        clave = tuple(f[c] for c in cuasi)\n        grupos[clave] = grupos.get(clave, 0) + 1\n    return min(grupos.values()) if grupos else 0\n',
        hints: ['La clave del grupo es `tuple(f[c] for c in cuasi)`.', 'Con `cuasi` vacío todas las filas comparten la clave `()`.'],
        explain: 'Un k bajo (sobre todo 1) significa que hay personas únicas en la tabla: quien conozca su edad y código postal puede localizar su registro. Para mejorar k se **generalizan** valores (edad por tramos, código postal truncado) o se suprimen filas raras.',
        commands: ['k-anonimato'],
      }),
      fill('Completa: sustituir el correo por un hash con sal es ___, no anonimización.', 'Sustituir el correo por un hash con sal es ___, no anonimización.', ['pseudonimización', 'cifrado de extremo a extremo', 'compresión', 'normalización'], ['pseudonimización'], 'La pseudonimización reduce el riesgo pero los datos siguen siendo personales porque con información adicional (la sal, el correo original) se puede re-identificar.'),
    ]),
    // ───────────────────────── 3 ─────────────────────────
    lesson('ia15-3', { title: 'Evaluar con rigor', summary: 'Métricas de texto, incertidumbre (bootstrap), jueces automáticos, comparaciones y puertas de regresión', emoji: '🧪', commands: ['intervalo de confianza', 'bootstrap', 'LLM como juez', 'F1 de tokens'], minutes: 16 }, [
      learn(
        'Una media sin intervalo engaña',
        `
«La versión B acierta el 90 % y la A el 85 %: nos quedamos con la B.» ¿Con cuántos casos? Con 20, esa diferencia es **ruido**. Evaluar un sistema con IA es estadística con las mismas trampas de siempre:

- **Incertidumbre**: toda métrica sobre una muestra tiene un **intervalo de confianza**. Con pocos casos es muy ancho. El **bootstrap** lo estima sin fórmulas: se remuestrea con reemplazo el conjunto de evaluación miles de veces y se mira cómo varía la métrica.
- **Métricas de texto**: coincidencia exacta (rígida), **F1 de tokens** (solapamiento de palabras), similitud de embeddings (semántica), reglas específicas (la cifra correcta aparece). Elige la que refleje lo que te importa.
- **LLM como juez**: otro modelo puntúa las respuestas. Escala, pero tiene **sesgos** (prefiere respuestas largas, su propio estilo, la primera opción…). Úsalo calibrado con casos puntuados por personas.
- **Comparaciones por pares**: pedir elegir entre A y B es más fiable que pedir una nota absoluta.
- **Puerta de regresión**: antes de desplegar un cambio, la nueva versión no puede empeorar la métrica más allá de una tolerancia.
- **Conjunto oculto**: no ajustes el prompt mirando los mismos casos con los que mides.
`,
        '🧪',
      ),
      pyDemo(
        'Bootstrap: cuánta confianza da cada medida',
        [
          [
            `import numpy as np

def intervalo_bootstrap(aciertos, B=1000, semilla=0):
    aciertos = np.asarray(aciertos, dtype=float)
    r = np.random.default_rng(semilla)
    medias = np.array([aciertos[r.integers(0, len(aciertos), len(aciertos))].mean() for _ in range(B)])
    return round(float(np.percentile(medias, 2.5)), 3), round(float(np.percentile(medias, 97.5)), 3)

for aciertos, total in [(8, 10), (40, 50), (400, 500)]:
    datos = [1] * aciertos + [0] * (total - aciertos)
    print(total, "casos, 80 % de acierto -> IC 95 %:", intervalo_bootstrap(datos))`,
            'El mismo 80 % de acierto significa cosas muy distintas: con 10 casos, el valor real podría estar entre el 50 % y el 100 %; con 50, entre 68 % y 90 %; con 500, entre 76 % y 83 %. **Dos versiones cuya diferencia cabe dentro del intervalo no se pueden distinguir**',
          ],
        ],
      ),
      illus('ia-eval-ci', 'Tamaño del conjunto y sesgo del juez', 'Aumenta el número de casos y mira cómo se estrecha el intervalo. Abajo, un juez automático (simulado) puntúa respuestas cortas y largas.'),
      pyDemo(
        'El juez prefiere lo largo',
        [
          [
            `from dojo_ai.llm import Client

client = Client()
SISTEMA = "Eres un juez. Evalúa la respuesta frente a la referencia con una puntuación de 1 a 5."
REFERENCIA = "Puedes devolver cualquier producto en 30 días."
RESPUESTAS = {
    "corta y correcta": "Tienes 30 días para devolverlo.",
    "larga con relleno": "Tienes 30 días para devolverlo, que es un plazo bastante generoso, y además conviene recordar que el producto debe estar sin usar, en su embalaje original, y que puedes pedir la etiqueta desde tu cuenta cuando quieras.",
    "corta y errónea": "Tienes 14 días.",
}
for nombre, texto in RESPUESTAS.items():
    r = client.chat.completions.create(model="dojo-mini", temperature=0, messages=[
        {"role": "system", "content": SISTEMA},
        {"role": "user", "content": "Referencia: " + REFERENCIA + "\\nRespuesta: " + texto}])
    print(nombre.ljust(18), len(texto.split()), "palabras ->", r.choices[0].message.content)`,
            'Las dos respuestas con el dato correcto reciben nota distinta: la larga, con relleno, sube de **4 a 5**. Es el **sesgo de verbosidad** de los jueces LLM (aquí simulado, pero muy documentado en modelos reales). La errónea corta recibe un 2. Conclusión: úsalo como señal barata, no como verdad',
          ],
        ],
      ),
      mc('Tu conjunto de evaluación tiene 15 casos y la versión B saca 2 puntos más que la A. ¿Qué concluyes?', ['Que no puedes distinguirlas: el intervalo de confianza es muy ancho', 'Que B es mejor con seguridad', 'Que A es peor por definición', 'Que hay que desplegar B ya'], 0, 'Con tan pocos casos, 2 puntos están muy dentro del ruido. Amplía el conjunto o usa una comparación por pares con más ejemplos.'),
      tf('Si ajusto el prompt mirando los fallos de mi conjunto de evaluación, la nota que obtenga en ese mismo conjunto sigue siendo una estimación honesta.', false, 'Estás ajustando el sistema a esos casos concretos (sobreajuste). Para decidir, usa un conjunto oculto que no hayas mirado.'),
      pyPractice({
        goal: 'F1 de tokens',
        prompt: 'Escribe `f1_tokens(prediccion, referencia)`: separa ambos textos en palabras en minúsculas (`split()`), cuenta las palabras **en común** (cada palabra de la referencia solo puede emparejarse una vez), calcula precisión = comunes / palabras de la predicción, recall = comunes / palabras de la referencia y devuelve su media armónica. Si algún texto está vacío o no hay comunes, `0.0`.',
        starter: 'def f1_tokens(prediccion, referencia):\n    pass\n',
        check: calls([
          ['round(f1_tokens("Tienes 30 días para devolverlo", "Puedes devolver en 30 días"), 4)', '0.4'],
          ['f1_tokens("a b", "a b")', '1.0'],
          ['f1_tokens("", "a")', '0.0'],
          ['f1_tokens("x y", "a b")', '0.0'],
          ['round(f1_tokens("a a", "a b"), 4)', '0.5'],
        ]),
        solution: 'def f1_tokens(prediccion, referencia):\n    a, b = prediccion.lower().split(), referencia.lower().split()\n    if not a or not b:\n        return 0.0\n    resto = list(b)\n    comunes = 0\n    for w in a:\n        if w in resto:\n            resto.remove(w)\n            comunes += 1\n    if comunes == 0:\n        return 0.0\n    p, r = comunes / len(a), comunes / len(b)\n    return 2 * p * r / (p + r)\n',
        hints: ['Para emparejar cada palabra una sola vez, guarda una copia de la referencia y ve quitando las que encuentres.', 'F1 = 2·p·r / (p + r).'],
        explain: 'Es la métrica clásica de las evaluaciones de preguntas y respuestas extractivas. Penaliza respuestas largas con relleno (baja la precisión) y respuestas incompletas (baja el recall), pero no entiende sinónimos: «devolverlo» y «devolver» son palabras distintas.',
        commands: ['F1 de tokens'],
      }),
      pyPractice({
        goal: 'Intervalo de confianza por bootstrap',
        prompt: 'Escribe `intervalo_bootstrap(aciertos, B=1000, semilla=0)`: `aciertos` es una lista de 0 y 1. Crea `r = np.random.default_rng(semilla)`; repite `B` veces: remuestrea `len(aciertos)` elementos con reemplazo (`r.integers(0, n, n)`) y guarda la media. Devuelve los percentiles 2,5 y 97,5 de esas medias, redondeados a 3 decimales, como tupla `(bajo, alto)`.',
        starter: 'import numpy as np\n\ndef intervalo_bootstrap(aciertos, B=1000, semilla=0):\n    pass\n',
        check: calls([
          ['intervalo_bootstrap([1] * 40 + [0] * 10)', '(0.68, 0.9)'],
          ['intervalo_bootstrap([1] * 8 + [0] * 2)', '(0.5, 1.0)'],
          ['intervalo_bootstrap([1] * 400 + [0] * 100)', '(0.764, 0.834)'],
        ]),
        solution: 'import numpy as np\n\ndef intervalo_bootstrap(aciertos, B=1000, semilla=0):\n    aciertos = np.asarray(aciertos, dtype=float)\n    r = np.random.default_rng(semilla)\n    medias = np.array([aciertos[r.integers(0, len(aciertos), len(aciertos))].mean() for _ in range(B)])\n    return round(float(np.percentile(medias, 2.5)), 3), round(float(np.percentile(medias, 97.5)), 3)\n',
        hints: ['Cada remuestreo: `aciertos[r.integers(0, n, n)].mean()`.', '`np.percentile(medias, 2.5)` y `np.percentile(medias, 97.5)`; recuerda convertir a `float` y redondear.'],
        explain: 'Con una semilla fija el resultado es reproducible. Con 10 casos el intervalo abarca de 0,5 a 1,0; con 500, de 0,764 a 0,834. En producción el intervalo te dice cuántos casos necesitas antes de comparar dos versiones.',
        commands: ['intervalo de confianza', 'bootstrap'],
      }),
      pyPractice({
        goal: 'Puerta de regresión y votos por pares',
        prompt: 'Escribe dos funciones. `puerta_regresion(base, nueva, tolerancia=0.02)`: `True` si la métrica nueva no cae más de `tolerancia` por debajo de la base (`nueva >= base - tolerancia`). `tasa_victorias(votos)`: `votos` es una lista de `"A"`, `"B"` o `"empate"`; devuelve un diccionario con la fracción de cada uno (redondeada a 3 decimales, claves `"A"`, `"B"`, `"empate"`); lista vacía → todo `0.0`.',
        starter: 'def puerta_regresion(base, nueva, tolerancia=0.02):\n    pass\n\ndef tasa_victorias(votos):\n    pass\n',
        check: calls([
          ['puerta_regresion(0.9, 0.89)', 'True'],
          ['puerta_regresion(0.9, 0.85)', 'False'],
          ['puerta_regresion(0.9, 0.85, tolerancia=0.1)', 'True'],
          ['tasa_victorias(["A", "A", "B", "empate"])', "{'A': 0.5, 'B': 0.25, 'empate': 0.25}"],
          ['tasa_victorias([])', "{'A': 0.0, 'B': 0.0, 'empate': 0.0}"],
        ]),
        solution: 'def puerta_regresion(base, nueva, tolerancia=0.02):\n    return nueva >= base - tolerancia\n\ndef tasa_victorias(votos):\n    n = len(votos)\n    if n == 0:\n        return {"A": 0.0, "B": 0.0, "empate": 0.0}\n    return {k: round(votos.count(k) / n, 3) for k in ("A", "B", "empate")}\n',
        hints: ['La puerta es una comparación: `nueva >= base - tolerancia`.', 'Para los votos usa `votos.count(k) / n` por cada clave y trata aparte la lista vacía.'],
        explain: 'La puerta de regresión se ejecuta en cada cambio de prompt o de modelo (como los tests de un programa). La tolerancia debe ser coherente con el ruido: si tu intervalo de confianza es de ±5 puntos, una tolerancia de 2 puntos solo genera falsas alarmas.',
        commands: ['evaluar un prompt'],
      }),
      multi('¿Qué sesgos conocidos tienen los jueces LLM?', ['Prefieren respuestas largas y detalladas', 'Tienden a favorecer respuestas con su propio estilo', 'Pueden depender del orden en que se presentan las opciones', 'Son siempre perfectamente objetivos'], [0, 1, 2], 'Calibra el juez con puntuaciones humanas, aleatoriza el orden de las opciones y complementa con reglas verificables.'),
    ]),
    // ───────────────────────── 4 ─────────────────────────
    lesson('ia15-4', { title: 'Coste, latencia y fiabilidad', summary: 'Caché, enrutado de modelos, reintentos con espera exponencial y presupuestos mensuales', emoji: '⚡', commands: ['caché de respuestas', 'enrutado de modelos', 'espera exponencial', 'coste mensual'], minutes: 16 }, [
      learn(
        'Lo que no se mide, se dispara',
        `
Un prototipo con 20 pruebas cuesta céntimos. El mismo sistema con 200 000 usuarios al mes puede costar miles de euros y fallar de formas nuevas. Hay tres dimensiones a diseñar:

**Coste.** \`peticiones × (tokens_entrada × precio_entrada + tokens_salida × precio_salida)\`. Palancas, de mayor a menor efecto:
- **Elegir el modelo más pequeño que cumpla** y **enrutar**: preguntas fáciles al modelo barato, difíciles al grande.
- **Caché**: respuestas idénticas (o casi) no se vuelven a pagar. Caché exacta por clave; caché semántica por similitud de embeddings.
- **Prompts más cortos**: menos contexto irrelevante, menos ejemplos fijos, resúmenes del historial.
- **Límites de salida** (\`max_tokens\`) y *batching* para procesos no interactivos.

**Latencia.** Dos números: *time to first token* (cuándo empieza a salir texto) y tiempo total. El **streaming** mejora la percepción: el usuario ve texto enseguida. Más tokens de salida = más tiempo.

**Fiabilidad.** Las API fallan: límites de uso (429), errores 5xx, tiempos de espera. Se responde con **reintentos con espera exponencial** (1 s, 2 s, 4 s… con tope y algo de aleatoriedad), **tiempos máximos**, **alternativas** (otro modelo o proveedor, una respuesta enlatada) y un **cortacircuitos** que deja de insistir cuando el servicio está caído.
`,
        '⚡',
      ),
      illus('ia-cost', 'Tu factura mensual', 'Mueve el tráfico, los tokens, la caché y el porcentaje que va al modelo grande. Mira cuánto baja el coste y la latencia con las tres palancas.'),
      pyDemo(
        'Cuánto cuesta cada opción',
        [
          [
            `from dojo_ai.llm import coste

def coste_mensual(peticiones, tok_in, tok_out, modelo, acierto_cache=0.0):
    return peticiones * (1 - acierto_cache) * coste({"prompt_tokens": tok_in, "completion_tokens": tok_out}, modelo)

for modelo in ["dojo-mini", "dojo-pro"]:
    print(modelo, round(coste_mensual(100000, 1000, 300, modelo), 2), "$ al mes")
print("mini con 30 % de caché:", round(coste_mensual(100000, 1000, 300, "dojo-mini", 0.3), 2))

# enrutado: 80 % de las preguntas al modelo pequeño y 20 % al grande
mezcla = 0.8 * coste_mensual(100000, 1000, 300, "dojo-mini") + 0.2 * coste_mensual(100000, 1000, 300, "dojo-pro")
print("enrutado 80/20:", round(mezcla, 2))`,
            '100 000 peticiones al mes de 1 000 tokens de entrada y 300 de salida cuestan **33 $** con el modelo pequeño y **750 $** con el grande (23 veces más). Una caché del 30 % baja el pequeño a 23,1 $; y un enrutado 80/20 deja la factura en 176,4 $ en vez de 750: se paga el modelo grande solo donde hace falta',
          ],
        ],
      ),
      pyDemo(
        'Reintentos con espera exponencial',
        [
          [
            `from dojo_ai.llm import Client, RateLimitError

def espera(i, base=1.0, tope=30.0):
    return min(tope, base * 2 ** i)

def reintentar(fn, intentos=4, esperar=None):
    esperas = []
    for i in range(intentos):
        try:
            return fn(), esperas
        except RateLimitError:
            if i == intentos - 1:
                return None, esperas
            esperas.append(espera(i))
            if esperar:
                esperar(esperas[-1])

def llamada(cliente):
    return lambda: cliente.chat.completions.create(model="dojo-mini", temperature=0,
        messages=[{"role": "user", "content": "hola"}]).choices[0].message.content[:8]

print([espera(i) for i in (0, 1, 2, 3, 10)])
print(reintentar(llamada(Client(fallos_iniciales=2))))
print(reintentar(llamada(Client(fallos_iniciales=5)), intentos=3))
dormidas = []
reintentar(llamada(Client(fallos_iniciales=2)), esperar=dormidas.append)
print("esperaría:", dormidas)`,
            'El cliente simulado falla las dos primeras llamadas (`RateLimitError`, equivalente a un 429). Con la espera 1 s y 2 s el tercer intento funciona. Con 5 fallos y solo 3 intentos se rinde y devuelve `None`. Pasamos `esperar` como función para **no dormir de verdad** al probar. En producción se añade un poco de aleatoriedad (*jitter*) para que miles de clientes no reintenten a la vez',
          ],
        ],
      ),
      mc('Tu API devuelve 429 (demasiadas peticiones). ¿Qué estrategia es la más adecuada?', ['Reintentar con esperas crecientes (1 s, 2 s, 4 s…) y un máximo de intentos', 'Reintentar inmediatamente en bucle hasta que funcione', 'Ignorar el error y devolver una respuesta vacía', 'Enviar el doble de peticiones para compensar'], 0, 'Reintentar sin espera agrava el problema. La espera exponencial con tope (y jitter) da tiempo al servicio y evita avalanchas de reintentos.'),
      tf('Una caché exacta es útil en un chatbot donde casi nadie hace la misma pregunta con las mismas palabras.', false, 'La caché exacta solo ayuda con preguntas literalmente repetidas (FAQ, procesos por lotes). Para variantes de la misma pregunta hace falta una caché semántica (por similitud de embeddings), con cuidado de no devolver respuestas de otra pregunta.'),
      pyPractice({
        goal: 'Espera exponencial',
        prompt: 'Escribe `espera(i, base=1.0, tope=30.0)`: segundos a esperar antes del reintento número `i` (empezando en 0): `base × 2^i`, sin superar `tope`.',
        starter: 'def espera(i, base=1.0, tope=30.0):\n    pass\n',
        check: calls([
          ['[espera(i) for i in (0, 1, 3, 10)]', '[1.0, 2.0, 8.0, 30.0]'],
          ['espera(2, base=0.5)', '2.0'],
          ['espera(5, tope=10)', '10'],
        ]),
        solution: 'def espera(i, base=1.0, tope=30.0):\n    return min(tope, base * 2 ** i)\n',
        hints: ['`2 ** i` es la potencia; multiplícala por `base`.', '`min(tope, ...)` pone el techo.'],
        explain: 'Sin tope, la décima espera sería de 17 minutos. Con él, el cliente nunca espera más de 30 s entre intentos. Añadir un componente aleatorio (`random.uniform(0, espera)`) es el *jitter*.',
        commands: ['espera exponencial'],
      }),
      pyPractice({
        goal: 'Reintentar con límite',
        prompt: 'Escribe `reintentar(fn, intentos=4, esperar=None)`: llama a `fn()`; si lanza `RateLimitError`, guarda `espera(i)` en la lista `esperas` y, si `esperar` existe, la llama con ese valor; reintenta hasta `intentos`. Devuelve `(resultado, esperas)`; si en el último intento sigue fallando, `(None, esperas)`. (`espera` y `RateLimitError` ya están disponibles.)',
        starter: 'from dojo_ai.llm import Client, RateLimitError\n\ndef espera(i, base=1.0, tope=30.0):\n    return min(tope, base * 2 ** i)\n\ndef reintentar(fn, intentos=4, esperar=None):\n    pass\n\ndef llamada(cliente):\n    return lambda: cliente.chat.completions.create(model="dojo-mini", temperature=0, messages=[{"role": "user", "content": "hola"}]).choices[0].message.content[:8]\n',
        check: calls([
          ['reintentar(llamada(Client(fallos_iniciales=2)))', "('¡Hola! S', [1.0, 2.0])"],
          ['reintentar(llamada(Client(fallos_iniciales=5)), 3)', '(None, [1.0, 2.0])'],
          ['reintentar(llamada(Client()), 3)', "('¡Hola! S', [])"],
          ['(lambda reg: (reintentar(llamada(Client(fallos_iniciales=1)), 3, reg.append), reg)[1])([])', '[1.0]'],
        ]),
        solution: 'from dojo_ai.llm import Client, RateLimitError\n\ndef espera(i, base=1.0, tope=30.0):\n    return min(tope, base * 2 ** i)\n\ndef reintentar(fn, intentos=4, esperar=None):\n    esperas = []\n    for i in range(intentos):\n        try:\n            return fn(), esperas\n        except RateLimitError:\n            if i == intentos - 1:\n                return None, esperas\n            esperas.append(espera(i))\n            if esperar:\n                esperar(esperas[-1])\n\ndef llamada(cliente):\n    return lambda: cliente.chat.completions.create(model="dojo-mini", temperature=0, messages=[{"role": "user", "content": "hola"}]).choices[0].message.content[:8]\n',
        hints: ['Dentro del `for`, `try: return fn(), esperas` y `except RateLimitError:`.', 'En el último intento no esperes: devuelve `(None, esperas)`.'],
        explain: 'Solo se reintentan errores **transitorios** (límite de uso, 5xx, tiempo de espera); un error 400 (petición mal formada) no se arregla repitiéndolo. Y como cada reintento cuesta dinero y tiempo, el número de intentos siempre está acotado.',
        commands: ['espera exponencial'],
      }),
      pyPractice({
        goal: 'Caché de respuestas',
        prompt: 'Escribe la clase `Cache` con `obtener(clave, calcular)` (si la clave está, suma un acierto y devuelve el valor guardado; si no, suma un fallo, llama a `calcular()`, lo guarda y lo devuelve) y `tasa()` (aciertos / consultas, `0.0` si no hay).',
        starter: 'class Cache:\n    pass\n',
        check: calls([
          ['(lambda c: ([c.obtener(k, lambda k=k: k.upper()) for k in "abab a"], c.aciertos, c.fallos, round(c.tasa(), 3))[1:])(Cache())', '(3, 3, 0.5)'],
          ['Cache().tasa()', '0.0'],
          ['(lambda c: (c.obtener("x", lambda: 1), c.obtener("x", lambda: 2))[1])(Cache())', '1'],
        ]),
        solution: 'class Cache:\n    def __init__(self):\n        self.datos = {}\n        self.aciertos = 0\n        self.fallos = 0\n\n    def obtener(self, clave, calcular):\n        if clave in self.datos:\n            self.aciertos += 1\n            return self.datos[clave]\n        self.fallos += 1\n        self.datos[clave] = calcular()\n        return self.datos[clave]\n\n    def tasa(self):\n        total = self.aciertos + self.fallos\n        return self.aciertos / total if total else 0.0\n',
        hints: ['Guarda los valores en un diccionario y cuenta aciertos y fallos.', '`calcular` es una función sin argumentos: solo se llama si la clave no estaba.'],
        explain: 'En una app real la clave incluye el modelo, el prompt y los parámetros (si cambias el prompt, la caché antigua no vale), hay caducidad y nunca se cachean respuestas con datos personales de otro usuario.',
        commands: ['caché de respuestas'],
      }),
      pyPractice({
        goal: 'Enruta y presupuesta',
        prompt: 'Escribe dos funciones. `enrutar(pregunta)`: devuelve `"dojo-pro"` si la pregunta (en minúsculas) tiene más de 25 palabras o contiene `analiza`, `compara`, `razona` o `demuestra`; si no, `"dojo-mini"`. `coste_mensual(peticiones, tok_in, tok_out, modelo, acierto_cache=0.0)`: coste mensual con `coste` de `dojo_ai.llm` (ya importada), descontando las peticiones servidas por caché.',
        starter: 'from dojo_ai.llm import coste\n\ndef enrutar(pregunta):\n    pass\n\ndef coste_mensual(peticiones, tok_in, tok_out, modelo, acierto_cache=0.0):\n    pass\n',
        check: calls([
          ['enrutar("¿Cuál es la capital de Francia?")', "'dojo-mini'"],
          ['enrutar("Compara los planes de envío")', "'dojo-pro'"],
          ['enrutar(" ".join(["palabra"] * 30))', "'dojo-pro'"],
          ['round(coste_mensual(100000, 1000, 300, "dojo-mini"), 2)', '33.0'],
          ['round(coste_mensual(100000, 1000, 300, "dojo-pro"), 2)', '750.0'],
          ['round(coste_mensual(100000, 1000, 300, "dojo-mini", 0.3), 2)', '23.1'],
        ]),
        solution: 'from dojo_ai.llm import coste\n\ndef enrutar(pregunta):\n    t = pregunta.lower()\n    if len(t.split()) > 25 or any(p in t for p in ("analiza", "compara", "razona", "demuestra")):\n        return "dojo-pro"\n    return "dojo-mini"\n\ndef coste_mensual(peticiones, tok_in, tok_out, modelo, acierto_cache=0.0):\n    return peticiones * (1 - acierto_cache) * coste({"prompt_tokens": tok_in, "completion_tokens": tok_out}, modelo)\n',
        hints: ['`any(p in t for p in (...))` comprueba varias palabras clave.', 'Las peticiones que llegan al modelo son `peticiones × (1 − acierto_cache)`.'],
        explain: 'Un enrutador por reglas es el punto de partida; después se sustituye por un clasificador pequeño o por la propia confianza del modelo barato («si no estás seguro, escala»). Siempre medido: cada atajo debe mantener la calidad en tu conjunto de evaluación.',
        commands: ['enrutado de modelos', 'coste mensual'],
      }),
      order('Ordena las palancas de coste de mayor a menor efecto típico:', ['modelo', 'caché', 'prompt', 'salida'], 'modelo caché prompt salida', 'Cambiar el modelo (o enrutar) puede ahorrar un orden de magnitud; la caché depende de cuánto se repita; acortar el prompt y limitar la salida suman mejoras más pequeñas pero constantes.'),
    ]),
    // ───────────────────────── 5 ─────────────────────────
    lesson('ia15-5', { title: 'LLMOps, gobierno y lanzamiento', summary: 'Versionado, monitorización, pruebas A/B, riesgo normativo y la lista de lanzamiento', emoji: '🚦', commands: ['LLMOps', 'prueba A/B', 'nivel de riesgo', 'lista de lanzamiento'], minutes: 16 }, [
      learn(
        'Un sistema de IA nunca está terminado',
        `
Cuando el sistema sale a producción empieza el trabajo de **operarlo**. **LLMOps** es el conjunto de prácticas para hacerlo con orden:

- **Versionado**: prompts, plantillas, modelos, índices de RAG, herramientas y conjuntos de evaluación se guardan como código, con una versión asociada a cada respuesta. Sin esto es imposible reproducir un fallo.
- **Despliegue gradual**: un pequeño % de usuarios primero (*canary*), con **reversión** inmediata a la versión anterior.
- **Monitorización**: calidad (muestreos revisados por personas, métricas automáticas), coste, latencia, tasa de errores, abstenciones, intentos de inyección, reclamaciones. **Alertas** ante cambios. Los proveedores actualizan modelos y los datos del mundo cambian (*deriva*).
- **Pruebas A/B**: para comparar dos versiones con usuarios reales hace falta estadística (¿la diferencia es mayor que el ruido?).
- **Respuesta a incidentes**: un plan para desconectar funciones, avisar y corregir.
- **Gobierno y documentación**: quién es responsable, **tarjeta del modelo** (qué hace, datos, límites, métricas, riesgos conocidos), registro de decisiones y revisiones periódicas.
- **Normativa**: el **Reglamento europeo de IA** clasifica los sistemas por riesgo (prohibidos, alto riesgo, transparencia obligatoria, riesgo mínimo) con obligaciones distintas. A efectos de este curso es una clasificación **didáctica**, no asesoramiento legal.
`,
        '🚦',
      ),
      illus('ia-ops', 'Ciclo de vida, lista de lanzamiento y riesgo', 'Recorre las fases, marca los requisitos de la lista y prueba cómo cambia el nivel de riesgo según el uso del sistema.'),
      pyDemo(
        'Prueba A/B: ¿es de verdad mejor?',
        [
          [
            `import math

def ab_test(ex_a, n_a, ex_b, n_b):
    pa, pb = ex_a / n_a, ex_b / n_b
    p = (ex_a + ex_b) / (n_a + n_b)
    se = math.sqrt(p * (1 - p) * (1 / n_a + 1 / n_b))
    z = (pb - pa) / se if se else 0.0
    pv = math.erfc(abs(z) / math.sqrt(2))
    return {"z": round(z, 3), "p": round(pv, 4), "significativo": pv < 0.05}

print(ab_test(80, 100, 90, 100))
print(ab_test(800, 1000, 830, 1000))
print(ab_test(50, 100, 50, 100))`,
            '90 % frente a 80 % con 100 usuarios cada uno **sí** es significativo (p = 0,048 < 0,05). En cambio 83 % frente a 80 % con 1 000 usuarios cada uno **no** lo es (p = 0,084): una diferencia de 3 puntos puede ser ruido. Decide el tamaño de la prueba antes de empezarla y no la pares en cuanto salga «bien»',
          ],
        ],
      ),
      pyDemo(
        'Riesgo y lista de lanzamiento',
        [
          [
            `PROHIBIDO = {"puntuacion_social", "manipulacion_subliminal", "biometria_remota_tiempo_real"}
ALTO = {"empleo", "credito", "educacion", "salud", "justicia", "infraestructura_critica"}
LIMITADO = {"chatbot", "contenido_generado", "deepfake", "reconocimiento_emociones"}

def nivel_riesgo(usos):
    u = set(usos)
    if u & PROHIBIDO:
        return "prohibido"
    if u & ALTO:
        return "alto"
    if u & LIMITADO:
        return "limitado"
    return "mínimo"

for usos in [["chatbot"], ["chatbot", "credito"], ["filtro_spam"], ["puntuacion_social", "credito"]]:
    print(usos, "->", nivel_riesgo(usos))

REQUISITOS = ["evaluación con conjunto oculto", "prueba de equidad por grupos", "PII enmascarada en logs", "límite de pasos y de coste",
              "plan de reversión", "monitorización y alertas", "supervisión humana definida", "documentación (tarjeta del modelo)"]
hecho = ["evaluación con conjunto oculto", "PII enmascarada en logs", "plan de reversión"]
print([r for r in REQUISITOS if r not in set(hecho)])`,
            'El nivel lo marca **el uso**, no la tecnología: el mismo modelo en un chatbot de atención (transparencia) o decidiendo créditos (alto riesgo, con evaluación de riesgos, datos de calidad, supervisión humana y documentación). Si entre los usos hay uno prohibido, manda ese. Debajo, la lista de lanzamiento muestra qué **falta** por hacer. (Simplificación didáctica; consulta a un especialista para un caso real.)',
          ],
        ],
      ),
      mc('Tu nueva versión del prompt saca 3 puntos más en la prueba A/B, pero con p = 0,3. ¿Qué haces?', ['Seguir recogiendo datos: la diferencia aún puede ser ruido', 'Desplegarla ya, porque 3 puntos son 3 puntos', 'Descartarla para siempre', 'Repetir la prueba hasta que salga p < 0,05 y parar justo entonces'], 0, 'Un p-valor alto indica que la diferencia es compatible con el azar. Parar la prueba en cuanto salga «significativo» (mirar repetidamente) infla los falsos positivos: fija el tamaño de antemano.'),
      multi('¿Qué conviene registrar en producción para poder investigar un fallo?', ['La versión del prompt, del modelo y del índice usadas', 'Las herramientas llamadas y sus resultados', 'El coste, la latencia y el motivo de parada', 'Los datos personales completos de cada usuario, sin enmascarar'], [0, 1, 2], 'La trazabilidad reproduce el fallo. Los datos personales se enmascaran o minimizan: el log no debe convertirse en otro problema de privacidad.'),
      tf('Un sistema de IA con buenas métricas en el lanzamiento se mantiene bueno sin más trabajo.', false, 'Los modelos del proveedor cambian, los usuarios cambian, los documentos cambian y los ataques evolucionan. Sin monitorización y revisiones periódicas la calidad se degrada sin que nadie lo note.'),
      pyPractice({
        goal: 'Prueba A/B de dos proporciones',
        prompt: 'Escribe `ab_test(ex_a, n_a, ex_b, n_b)`: test z de dos proporciones. `pa`, `pb` = éxitos/total de cada grupo; `p` = proporción conjunta `(ex_a + ex_b) / (n_a + n_b)`; error estándar `sqrt(p·(1−p)·(1/n_a + 1/n_b))`; `z = (pb − pa) / error` (0 si el error es 0); valor p bilateral `math.erfc(|z| / √2)`. Devuelve `{"z": …, "p": …, "significativo": p < 0,05}` con `z` redondeado a 3 decimales y `p` a 4.',
        starter: 'import math\n\ndef ab_test(ex_a, n_a, ex_b, n_b):\n    pass\n',
        check: calls([
          ['ab_test(80, 100, 90, 100)', "{'z': 1.98, 'p': 0.0477, 'significativo': True}"],
          ['ab_test(800, 1000, 830, 1000)', "{'z': 1.728, 'p': 0.0841, 'significativo': False}"],
          ['ab_test(50, 100, 50, 100)', "{'z': 0.0, 'p': 1.0, 'significativo': False}"],
          ['ab_test(0, 10, 0, 10)', "{'z': 0.0, 'p': 1.0, 'significativo': False}"],
        ]),
        solution: 'import math\n\ndef ab_test(ex_a, n_a, ex_b, n_b):\n    pa, pb = ex_a / n_a, ex_b / n_b\n    p = (ex_a + ex_b) / (n_a + n_b)\n    se = math.sqrt(p * (1 - p) * (1 / n_a + 1 / n_b))\n    z = (pb - pa) / se if se else 0.0\n    pv = math.erfc(abs(z) / math.sqrt(2))\n    return {"z": round(z, 3), "p": round(pv, 4), "significativo": pv < 0.05}\n',
        hints: ['Primero las proporciones y la conjunta; luego el error estándar y `z`.', '`math.erfc(abs(z) / math.sqrt(2))` es el valor p bilateral.'],
        explain: 'El valor p es la probabilidad de ver una diferencia al menos así de grande si en realidad no hubiera ninguna. No dice cuánto mejor es B ni si la mejora importa para el negocio: combínalo con el tamaño del efecto y el coste.',
        commands: ['prueba A/B'],
      }),
      pyPractice({
        goal: 'Nivel de riesgo',
        prompt: 'Escribe `nivel_riesgo(usos)`: `usos` es una lista de cadenas. Devuelve `"prohibido"` si alguno está en `PROHIBIDO`; si no, `"alto"` si alguno está en `ALTO`; si no, `"limitado"` si alguno está en `LIMITADO`; si no, `"mínimo"`. (Los conjuntos ya están definidos.)',
        starter: 'PROHIBIDO = {"puntuacion_social", "manipulacion_subliminal", "biometria_remota_tiempo_real"}\nALTO = {"empleo", "credito", "educacion", "salud", "justicia", "infraestructura_critica"}\nLIMITADO = {"chatbot", "contenido_generado", "deepfake", "reconocimiento_emociones"}\n\ndef nivel_riesgo(usos):\n    pass\n',
        check: calls([
          ['nivel_riesgo(["chatbot"])', "'limitado'"],
          ['nivel_riesgo(["chatbot", "credito"])', "'alto'"],
          ['nivel_riesgo(["puntuacion_social", "credito"])', "'prohibido'"],
          ['nivel_riesgo([])', "'mínimo'"],
          ['nivel_riesgo(["filtro_spam"])', "'mínimo'"],
        ]),
        solution: 'PROHIBIDO = {"puntuacion_social", "manipulacion_subliminal", "biometria_remota_tiempo_real"}\nALTO = {"empleo", "credito", "educacion", "salud", "justicia", "infraestructura_critica"}\nLIMITADO = {"chatbot", "contenido_generado", "deepfake", "reconocimiento_emociones"}\n\ndef nivel_riesgo(usos):\n    u = set(usos)\n    if u & PROHIBIDO:\n        return "prohibido"\n    if u & ALTO:\n        return "alto"\n    if u & LIMITADO:\n        return "limitado"\n    return "mínimo"\n',
        hints: ['Convierte la lista en conjunto y usa la intersección `u & CONJUNTO`.', 'Comprueba los niveles de más a menos grave.'],
        explain: 'Se aplica el nivel **más grave** de entre los usos. Es una simplificación de una norma real y compleja (con excepciones y definiciones precisas): sirve para entender la lógica de «obligaciones proporcionales al riesgo».',
        commands: ['nivel de riesgo'],
      }),
      pyPractice({
        goal: 'Qué falta para lanzar',
        prompt: 'Escribe `faltan(hecho)`: devuelve la lista de `REQUISITOS` (en su orden) que **no** están en la lista `hecho`. Lista vacía = listo para lanzar. (`REQUISITOS` ya está definida.)',
        starter: 'REQUISITOS = ["evaluación con conjunto oculto", "prueba de equidad por grupos", "PII enmascarada en logs", "límite de pasos y de coste",\n              "plan de reversión", "monitorización y alertas", "supervisión humana definida", "documentación (tarjeta del modelo)"]\n\ndef faltan(hecho):\n    pass\n',
        check: calls([
          ['faltan(REQUISITOS)', '[]'],
          ['len(faltan([]))', '8'],
          ['faltan(["evaluación con conjunto oculto", "PII enmascarada en logs", "plan de reversión"])[:2]', "['prueba de equidad por grupos', 'límite de pasos y de coste']"],
        ]),
        solution: 'REQUISITOS = ["evaluación con conjunto oculto", "prueba de equidad por grupos", "PII enmascarada en logs", "límite de pasos y de coste",\n              "plan de reversión", "monitorización y alertas", "supervisión humana definida", "documentación (tarjeta del modelo)"]\n\ndef faltan(hecho):\n    hecho = set(hecho)\n    return [r for r in REQUISITOS if r not in hecho]\n',
        hints: ['Una lista por comprensión que conserve el orden de `REQUISITOS`.', 'Convertir `hecho` en conjunto hace la comprobación `in` más rápida y clara.'],
        explain: 'Una lista de comprobación no garantiza calidad, pero evita lo peor: lanzar sin haber pensado en lo que sale en cada incidente real. Conviértela en una puerta automática en tu pipeline de despliegue siempre que puedas.',
        commands: ['lista de lanzamiento', 'LLMOps'],
      }),
      order('Ordena un despliegue seguro:', ['evaluar', 'canary', 'monitorizar', 'ampliar'], 'evaluar canary monitorizar ampliar', 'Se evalúa antes de lanzar, se despliega a un pequeño porcentaje (canary) con reversión preparada, se monitoriza y solo entonces se amplía al resto de usuarios.'),
    ]),
  ],
  boss: {
    goal: 'Misión: auditoría previa al lanzamiento',
    prompt:
      'Tu asistente de créditos va a salir a producción. Prepara la **auditoría**. Tienes los datos de la lección 1 (`score`, `grupo`, `real`, `pred`), unos `LOGS` con datos personales, `ACIERTOS` (60 casos de evaluación) y la función `luhn`.\n\n1. `umbral_b()`: umbral del grupo B para que su tasa de aprobación iguale la del grupo A (con el umbral 0,5 de A).\n2. `limpiar(logs)`: devuelve los logs con `<EMAIL>`, `<TARJETA>` (solo tarjetas válidas según Luhn), `<DNI>` y `<TELEFONO>`; el resto del texto, intacto.\n3. `ic95(aciertos)`: intervalo bootstrap del 95 % (`B=1000`, `semilla=0`) como `(bajo, alto)` redondeado a 3 decimales.\n4. `coste_mes()`: 200 000 peticiones al mes, 800 tokens de entrada y 250 de salida, 25 % servidas por caché y 20 % del resto al modelo `dojo-pro` (el resto a `dojo-mini`); redondeado a 2 decimales.\n5. `informe()`: diccionario con `razon_antes`, `razon_despues` (razón de impacto antes/después de usar `umbral_b()` para el grupo B, 3 decimales), `pii_restante` (nº de logs limpios en los que aún quede algún dato personal detectable), `ic`, `coste`, `riesgo` (uso: `["chatbot", "credito"]`) y `listo` (`True` si `razon_despues ≥ 0.8`, `pii_restante == 0` y el extremo inferior del intervalo ≥ 0.8).',
    starter:
      `${PRESTAMOS}import re
from dojo_ai.llm import coste

LOGS = ["Marta Gil (marta@correo.example) llamó desde 612 345 678. Pedido PED-48213.",
        "Luis pagó con la tarjeta 4539 1488 0343 6467 y su DNI es 12345678Z.",
        "Consulta sin datos personales: ¿plazo de devolución?"]
ACIERTOS = [1] * 54 + [0] * 6

def luhn(numero):
    d = [int(c) for c in numero if c.isdigit()][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(2 * x, 10)) for x in d[1::2])) % 10 == 0

def umbral_b():
    pass

def limpiar(logs):
    pass

def ic95(aciertos):
    pass

def coste_mes():
    pass

def informe():
    pass
`,
    check: all(
      truthy('round(umbral_b(), 3) == 0.251'),
      calls([
        ['limpiar(LOGS)', "['Marta Gil (<EMAIL>) llamó desde <TELEFONO>. Pedido PED-48213.', 'Luis pagó con la tarjeta <TARJETA> y su DNI es <DNI>.', 'Consulta sin datos personales: ¿plazo de devolución?']"],
        ['ic95(ACIERTOS)', '(0.817, 0.967)'],
        ['coste_mes()', '216.9'],
      ]),
      truthy('informe()["razon_antes"] == 0.509 and informe()["razon_despues"] >= 0.99'),
      truthy('informe()["pii_restante"] == 0'),
      truthy('informe()["ic"] == (0.817, 0.967) and informe()["coste"] == 216.9'),
      truthy('informe()["riesgo"] == "alto" and informe()["listo"] is True'),
    ),
    solution:
      `${PRESTAMOS}import re
from dojo_ai.llm import coste

LOGS = ["Marta Gil (marta@correo.example) llamó desde 612 345 678. Pedido PED-48213.",
        "Luis pagó con la tarjeta 4539 1488 0343 6467 y su DNI es 12345678Z.",
        "Consulta sin datos personales: ¿plazo de devolución?"]
ACIERTOS = [1] * 54 + [0] * 6

def luhn(numero):
    d = [int(c) for c in numero if c.isdigit()][::-1]
    return (sum(d[0::2]) + sum(sum(divmod(2 * x, 10)) for x in d[1::2])) % 10 == 0

RE = [("EMAIL", re.compile(r"[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+")), ("TARJETA", re.compile(r"\\b\\d(?:[ -]?\\d){12,15}\\b")),
      ("DNI", re.compile(r"\\b\\d{8}[A-Z]\\b")), ("TELEFONO", re.compile(r"(?:\\+34\\s?)?\\b[6-9]\\d{2}[\\s.-]?\\d{3}[\\s.-]?\\d{3}\\b"))]

def tasa(p, g):
    return float(p[grupo == g].mean())

def razon(p):
    a, b = tasa(p, 0), tasa(p, 1)
    return min(a, b) / max(a, b)

def umbral_b():
    s = np.sort(score[grupo == 1])[::-1]
    k = max(int(round(tasa(pred, 0) * len(s))), 1)
    return float(s[k - 1])

def limpiar(logs):
    salida = []
    for t in logs:
        for etiqueta, patron in RE:
            t = patron.sub(lambda m, e=etiqueta: "<" + e + ">" if (e != "TARJETA" or luhn(m.group(0))) else m.group(0), t)
        salida.append(t)
    return salida

def ic95(aciertos):
    a = np.asarray(aciertos, dtype=float)
    r = np.random.default_rng(0)
    medias = np.array([a[r.integers(0, len(a), len(a))].mean() for _ in range(1000)])
    return round(float(np.percentile(medias, 2.5)), 3), round(float(np.percentile(medias, 97.5)), 3)

def coste_mes():
    uso_mini = coste({"prompt_tokens": 800, "completion_tokens": 250}, "dojo-mini")
    uso_pro = coste({"prompt_tokens": 800, "completion_tokens": 250}, "dojo-pro")
    return round(200000 * 0.75 * (0.8 * uso_mini + 0.2 * uso_pro), 2)

def informe():
    pred2 = pred.copy()
    pred2[grupo == 1] = (score[grupo == 1] >= umbral_b()).astype(int)
    limpios = limpiar(LOGS)
    restante = sum(
        any(patron.search(t) and (e != "TARJETA" or luhn(patron.search(t).group(0))) for e, patron in RE) for t in limpios
    )
    ic = ic95(ACIERTOS)
    razon_despues = round(razon(pred2), 3)
    return {
        "razon_antes": round(razon(pred), 3),
        "razon_despues": razon_despues,
        "pii_restante": restante,
        "ic": ic,
        "coste": coste_mes(),
        "riesgo": "alto",
        "listo": razon_despues >= 0.8 and restante == 0 and ic[0] >= 0.8,
    }
`,
    hints: [
      '`umbral_b`: ordena de mayor a menor las puntuaciones del grupo B, toma `k = round(tasa_de_A × tamaño_de_B)` y devuelve la `k`-ésima.',
      '`limpiar`: aplica en orden correo, tarjeta (solo si `luhn`), DNI y teléfono con `re.sub`; `ic95`: bootstrap con `np.random.default_rng(0)` y percentiles 2,5 y 97,5.',
      '`coste_mes`: 200 000 × 0,75 peticiones × (0,8 × coste mini + 0,2 × coste pro). En `informe`, el riesgo de `["chatbot", "credito"]` es el más grave: `"alto"`.',
    ],
    explain:
      'Has hecho una auditoría completa: equidad corregida y medida, datos personales fuera de los logs, una evaluación con su intervalo, un coste mensual realista y un nivel de riesgo. Si alguna de las condiciones fallara, `listo` sería `False` y el lanzamiento se pospondría: ese es el objetivo de una puerta de calidad. Con esto terminas el curso: sabes cómo funcionan los modelos, cómo hablar con ellos, darles conocimiento con RAG, dejarlos actuar con control y llevarlos a producción con responsabilidad. Lo siguiente es lo más importante: **construir algo real**, medirlo con honestidad y mejorarlo.',
    commands: ['sesgo y equidad', 'datos personales (PII)', 'bootstrap', 'coste mensual', 'nivel de riesgo', 'lista de lanzamiento'],
  },
});
