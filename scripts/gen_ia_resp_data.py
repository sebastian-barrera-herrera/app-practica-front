# Genera src/illustrations/iaRespData.ts (datos de equidad, intervalos bootstrap y sesgo del juez) para las ilustraciones de la zona 15.
# Uso: PYTHONPATH=<carpeta con un enlace a src/pyengine/pylib/dojo_ai> python3 scripts/gen_ia_resp_data.py
import json
import numpy as np
from dojo_ai.llm import Client

# ---- equidad: mismos datos que la lección 1 ----
rng = np.random.default_rng(2)
n = 400
grupo = rng.integers(0, 2, n)
renta = rng.normal(50, 12, n) - 6 * grupo
score = 1 / (1 + np.exp(-(renta - 50) / 8))
real = (rng.random(n) < score).astype(int)
equidad = {"score": [round(float(x), 4) for x in score], "grupo": [int(x) for x in grupo], "real": [int(x) for x in real]}

# ---- intervalos de confianza según el tamaño del conjunto de evaluación (precisión verdadera 0,8) ----
r0 = np.random.default_rng(1)
filas = []
for tam in [10, 20, 50, 100, 200, 500, 1000]:
    muestra = (r0.random(tam) < 0.8).astype(float)
    rb = np.random.default_rng(0)
    medias = np.array([muestra[rb.integers(0, tam, tam)].mean() for _ in range(1000)])
    filas.append({"n": tam, "media": round(float(muestra.mean()), 3), "bajo": round(float(np.percentile(medias, 2.5)), 3), "alto": round(float(np.percentile(medias, 97.5)), 3)})

# ---- sesgo de verbosidad del juez ----
c = Client()
SIS = "Eres un juez. Evalúa la respuesta frente a la referencia con una puntuación de 1 a 5."
REF = "Puedes devolver cualquier producto en 30 días."
respuestas = [
    ("Corta y correcta", "Tienes 30 días para devolverlo."),
    ("Larga con relleno", "Tienes 30 días para devolverlo, que es un plazo bastante generoso, y además conviene recordar que el producto debe estar sin usar, en su embalaje original, y que puedes pedir la etiqueta desde tu cuenta cuando quieras."),
    ("Corta y errónea", "Tienes 14 días."),
    ("Larga y errónea", "Tienes 14 días para devolverlo, que es un plazo bastante razonable, y además conviene recordar que el producto debe estar sin usar, en su embalaje original, y que puedes pedir la etiqueta desde tu cuenta cuando quieras."),
]
juez = []
for nombre, texto in respuestas:
    r = c.chat.completions.create(model="dojo-mini", temperature=0, messages=[{"role": "system", "content": SIS}, {"role": "user", "content": "Referencia: " + REF + "\nRespuesta: " + texto}])
    juez.append({"nombre": nombre, "palabras": len(texto.split()), "texto": texto, "nota": r.choices[0].message.content})

out = "/** GENERADO por scripts/gen_ia_resp_data.py con dojo_ai (lecciones de IA responsable y producción): no editar a mano. */\n"
out += "export const EQUIDAD: { score: number[]; grupo: number[]; real: number[] } = %s;\n" % json.dumps(equidad)
out += "export const BOOTSTRAP: { n: number; media: number; bajo: number; alto: number }[] = %s;\n" % json.dumps(filas)
out += "export const JUEZ: { nombre: string; palabras: number; texto: string; nota: string }[] = %s;\n" % json.dumps(juez, ensure_ascii=False)
open("src/illustrations/iaRespData.ts", "w").write(out)
print(filas)
print([(j["nombre"], j["palabras"], j["nota"]) for j in juez])
