import type { IaRef } from '../reference';

/** Fichas de agentes: herramientas, bucle, patrones, memoria y seguridad (Z14). */
export const AGENTES_REFS: IaRef[] = [
  {
    name: 'agente',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Sistema que usa un LLM **en bucle** con herramientas: decide qué hacer, tu código lo ejecuta, el modelo observa el resultado y repite hasta cumplir el objetivo. El modelo decide *qué*; tu código decide *si se hace*.',
    usage: 'mientras no haya respuesta final y queden pasos:\n    llamada = modelo(mensajes, herramientas)\n    resultado = ejecutar(llamada)   # con permisos\n    mensajes += [llamada, resultado]',
    details: 'Un *workflow* sigue pasos fijos que tú programas; un agente elige él los pasos. Más flexible, pero más caro, lento e impredecible: usa un workflow cuando el camino se conoce de antemano. Los riesgos principales son el exceso de permisos, la inyección de prompt a través de lo que lee y los bucles de gasto.',
    examples: [[`mensajes = [{"role": "user", "content": "¿Dónde está mi pedido?"}]
for paso in range(3):
    print("vuelta", paso + 1, "- mensajes en el historial:", len(mensajes))
    mensajes.append({"role": "assistant", "content": "..."})`, 'cada vuelta reenvía un historial más largo']],
    seeAlso: ['function calling', 'bucle del agente', 'mínimo privilegio'],
  },
  {
    name: 'function calling',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Mecanismo de las API de LLM para usar herramientas: envías la lista de funciones (nombre, descripción, parámetros) y el modelo devuelve, en lugar de texto, la función que quiere llamar con sus argumentos en JSON. Tu código la ejecuta.',
    usage: 'r = client.chat.completions.create(model=..., messages=..., tools=HERRAMIENTAS)\nr.choices[0].message.tool_calls',
    details: 'Cuando hay llamadas, `finish_reason` es `"tool_calls"` y el `content` suele ser `None`. El resultado se devuelve con un mensaje de rol `tool` y su `tool_call_id`. Hay también "salida estructurada" para forzar un JSON sin ejecutar nada.',
    examples: [[`from dojo_ai.llm import Client
herr = [{"type": "function", "function": {"name": "clima", "description": "Consulta el tiempo que hace en una ciudad",
         "parameters": {"type": "object", "properties": {"ciudad": {"type": "string"}}, "required": ["ciudad"]}}}]
r = Client().chat.completions.create(model="dojo-mini", temperature=0, tools=herr,
    messages=[{"role": "user", "content": "¿Qué tiempo hace en Sevilla?"}])
c = r.choices[0].message.tool_calls[0]
print(r.choices[0].finish_reason, c.function.name, c.function.arguments)`, 'el modelo pide la herramienta con sus argumentos']],
    seeAlso: ['tool_calls', 'esquema de herramienta', 'agente'],
  },
  {
    name: 'tool_calls',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Campo del mensaje del asistente con las herramientas que pide usar: una lista de llamadas con `id`, `function.name` y `function.arguments` (**texto JSON**). Puede haber varias a la vez (llamadas en paralelo).',
    usage: 'for c in mensaje.tool_calls:\n    args = json.loads(c.function.arguments)\n    resultado = REGISTRO[c.function.name](**args)',
    details: 'Tras ejecutar cada una, añade el mensaje del asistente (con `tool_calls`) y después un mensaje `{"role": "tool", "tool_call_id": c.id, "content": ...}` por llamada. Valida siempre nombre y argumentos antes de ejecutar: vienen de un modelo y pueden ser incorrectos o maliciosos.',
    examples: [[`import json
argumentos = '{"importe": 59.9, "dias": 12}'
args = json.loads(argumentos)
print(args["dias"] + 1, type(args["importe"]).__name__)`, 'los argumentos llegan como texto JSON']],
    seeAlso: ['function calling', 'bucle del agente'],
  },
  {
    name: 'esquema de herramienta',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Descripción de una herramienta para el modelo: `name`, `description` y `parameters` (esquema JSON con tipos, `enum` y `required`). La **descripción** es lo que más pesa para que el modelo la elija bien.',
    usage: '{"type": "function", "function": {"name": "...", "description": "...", "parameters": {"type": "object", "properties": {...}, "required": [...]}}}',
    details: 'Nombres claros, descripciones concretas (qué hace, cuándo usarla y cuándo no), pocos parámetros, `enum` para valores cerrados y pocas herramientas bien separadas. Prueba qué herramienta pide el modelo ante preguntas variadas: es el test más útil de un agente.',
    examples: [[`def esquema(nombre, descripcion, props, req):
    return {"type": "function", "function": {"name": nombre, "description": descripcion,
            "parameters": {"type": "object", "properties": props, "required": req}}}
print(esquema("clima", "Consulta el tiempo", {"ciudad": {"type": "string"}}, ["ciudad"])["function"]["parameters"]["required"])`, 'un esquema mínimo']],
    seeAlso: ['function calling', 'tool_calls'],
  },
  {
    name: 'herramienta (tool)',
    kind: 'concepto',
    category: 'agentes',
    level: 1,
    summary: 'Función de tu código que el agente puede pedir ejecutar: consultar una base de datos, llamar a una API, calcular, buscar en documentos, enviar un correo… Debe devolver datos breves y estructurados y errores legibles.',
    usage: 'def datos_pedido(pedido):\n    return {"estado": "enviado"} if pedido in PEDIDOS else {"error": "pedido no encontrado"}',
    details: 'Pon las reglas de negocio **dentro de la herramienta** (por ejemplo, rechazar cancelar un pedido ya enviado), no solo en el prompt. Separa las de solo lectura de las que tienen efectos y trata estas últimas con permisos y confirmación.',
    examples: [[`PEDIDOS = {"PED-1": "preparando"}
def cancelar_pedido(pedido):
    if PEDIDOS.get(pedido) != "preparando":
        return {"error": "solo se pueden cancelar pedidos en preparación"}
    PEDIDOS[pedido] = "cancelado"
    return {"pedido": pedido, "estado": "cancelado"}
print(cancelar_pedido("PED-1"), cancelar_pedido("PED-1"))`, 'la regla vive en la herramienta']],
    seeAlso: ['esquema de herramienta', 'mínimo privilegio'],
  },
  {
    name: 'bucle del agente',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Ciclo llamar al modelo → si pide herramientas, añadir su mensaje al historial → ejecutarlas → añadir cada resultado (rol `tool`) → repetir; termina cuando el modelo responde con texto o se agota `max_pasos`.',
    usage: 'for _ in range(max_pasos):\n    m = modelo(mensajes, tools)\n    if not m.tool_calls: return m.content\n    ...',
    details: 'Cada vuelta reenvía todo el historial, así que el coste crece más que linealmente. Registra la traza (herramienta, argumentos, resultado, tokens) para depurar. Convierte los errores en resultados que el modelo pueda leer.',
    examples: [[`def resumen_traza(traza):
    return " → ".join(n for n, a in traza) if traza else "(sin herramientas)"
print(resumen_traza([("datos_pedido", {}), ("calcular_reembolso", {})]))`, 'la traza de un agente con dos pasos']],
    seeAlso: ['agente', 'max_pasos', 'tool_calls'],
  },
  {
    name: 'max_pasos',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Tope de vueltas del bucle de un agente. Garantiza que siempre termina aunque el modelo se confunda y repita llamadas; junto con un tope de coste y de tiempo, es la red de seguridad básica.',
    usage: 'for _ in range(max_pasos):\n    ...\nreturn "(límite de pasos)"',
    details: 'Dimensiónalo según las tareas reales (2–10 suele bastar). Cuando se agota, devuelve un mensaje claro y deriva a una persona o reintenta con otra estrategia. Registra cuántas tareas llegan al tope: son tus casos a mejorar.',
    examples: [[`pasos = 0
while True:
    pasos += 1
    if pasos >= 4:
        break
print(pasos)`, 'un bucle sin tope necesita siempre una salida']],
    seeAlso: ['bucle del agente', 'presupuesto del agente'],
  },
  {
    name: 'ReAct',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: '*Reason + Act*: el modelo escribe **Pensamiento → Acción (herramienta[entrada]) → Observación** en bucle hasta una **Respuesta final**. Es un formato de texto, así que sirve incluso sin function calling.',
    usage: 'Pensamiento: necesito el plazo de devolución\nAcción: buscar_faq[plazo de devolución]\nObservación: 30 días\nRespuesta final: 30 días',
    details: 'Tu código lee la acción (con una regex), ejecuta la herramienta y devuelve «Observación: …» como siguiente mensaje. Es frágil si el modelo rompe el formato: valida y reintenta. Con function calling los argumentos llegan estructurados.',
    examples: [[`import re
texto = "Pensamiento: busco\\nAcción: calculadora[12 * 7 + 3]"
m = re.search(r"Acción:\\s*(\\w+)\\[(.*)\\]", texto)
print(m.group(1), m.group(2))`, 'leer la acción de un paso ReAct']],
    seeAlso: ['patrones de agente', 'bucle del agente'],
  },
  {
    name: 'patrones de agente',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Estrategias para organizar un agente: **ReAct** (decidir paso a paso), **planificar y ejecutar** (plan completo y luego pasos), **reflexión** (criticar y corregir con criterios comprobables) y **varios agentes** (coordinador y especialistas).',
    usage: 'Empieza por el patrón más simple que resuelva la tarea: cada capa añade coste, latencia y puntos de fallo.',
    details: 'Planificar sirve en tareas largas y permite revisar antes de actuar; la reflexión funciona cuando hay un criterio objetivo (tests, JSON válido, citas verificadas). Varios agentes complican la depuración y la seguridad: úsalos si las subtareas necesitan herramientas o permisos muy distintos.',
    examples: [[`plan = ["buscar el pedido", "calcular el reembolso", "responder al cliente"]
for i, paso in enumerate(plan, 1):
    print(i, paso)`, 'un plan como lista de pasos revisable']],
    seeAlso: ['ReAct', 'agente'],
  },
  {
    name: 'calculadora segura',
    kind: 'concepto',
    category: 'agentes',
    level: 3,
    summary: 'Herramienta aritmética que **valida** la expresión antes de evaluarla (solo dígitos, espacios y `+ - * / ( ) .`) y se ejecuta sin acceso a funciones internas. Evaluar con `eval` texto de un modelo sin restringirlo permite ejecutar código arbitrario.',
    usage: 'if not re.fullmatch(r"[0-9+\\-*/(). ]+", e): raise ValueError("expresión no permitida")\neval(e, {"__builtins__": {}}, {})',
    details: 'Lo ideal es un analizador de expresiones propio o ejecutar el código en un entorno aislado (*sandbox*) sin red ni ficheros. La lista blanca de caracteres es el mínimo. Aplica el mismo principio a SQL, comandos o rutas de ficheros que genere un modelo.',
    examples: [[`import re
def calculadora(e):
    if not re.fullmatch(r"[0-9+\\-*/(). ]+", e):
        raise ValueError("expresión no permitida")
    return eval(e, {"__builtins__": {}}, {})
print(calculadora("12 * 7 + 3"))`, 'una expresión permitida']],
    seeAlso: ['mínimo privilegio', 'herramienta (tool)'],
  },
  {
    name: 'memoria del agente',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Lo que un agente recuerda lo decide tu código: **ventana** de mensajes recientes (corto plazo), **resumen** de lo antiguo y **hechos** guardados con embeddings y recuperados por significado (largo plazo).',
    usage: 'memoria.recordar("El pedido es PED-48213")\nmemoria.buscar("¿Cuál era mi número de pedido?")',
    details: 'Guarda lo mínimo útil, con consentimiento, caducidad y posibilidad de borrado; separa por usuario. Cuidado con recordar información incorrecta o inyectada: una memoria envenenada persiste en el tiempo.',
    examples: [[`import numpy as np
from dojo_ai.embeddings import embed
hechos = ["Marta compró unos auriculares.", "El pedido es PED-48213 y llegó con un cable roto."]
E = embed(hechos)
print(hechos[int(np.argmax(E @ embed("¿Cuál era mi número de pedido?")))])`, 'recuperar un hecho por significado']],
    seeAlso: ['resumen de historial', 'ventana de contexto', 'embed'],
  },
  {
    name: 'resumen de historial',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Sustituir los mensajes antiguos de una conversación por un resumen breve para ahorrar tokens y no perder el hilo. Se pierde detalle: conserva aparte los datos que no pueden perderse (nombres, números, decisiones).',
    usage: 'resumen = resumir_historial(client, mensajes_viejos, max_palabras=60)\nmensajes = [sistema, resumen] + mensajes_recientes',
    details: 'Cuesta una llamada extra pero abarata todas las siguientes. Pide un formato fijo («hechos: … decisiones: … pendiente: …») y vuelve a comprobar los datos críticos contra la fuente cuando importe.',
    examples: [[`from dojo_ai.llm import Client
r = Client().chat.completions.create(model="dojo-mini", temperature=0, messages=[
    {"role": "system", "content": "Resume en máximo 8 palabras."},
    {"role": "user", "content": "Los envíos estándar tardan entre 3 y 5 días. Puedes devolver cualquier producto en 30 días."}])
print(len(r.choices[0].message.content.split()) <= 8)`, 'un resumen con límite de palabras']],
    seeAlso: ['memoria del agente', 'ventana de contexto'],
  },
  {
    name: 'mínimo privilegio',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Cada usuario o rol solo puede usar las herramientas estrictamente necesarias (lista blanca, **denegar por defecto**). Es la defensa que no depende de que el modelo obedezca: aunque lo engañen, el código no permite la acción.',
    usage: 'PERMISOS = {"cliente": {"datos_pedido", "calcular_reembolso"}}\nnombre in PERMISOS.get(rol, set())',
    details: 'Aplícalo también a los datos (filtra por usuario antes de recuperar) y a las credenciales de cada herramienta (de solo lectura siempre que se pueda). Revisa los permisos como revisas el código: son parte de la superficie de ataque.',
    examples: [[`PERMISOS = {"cliente": {"datos_pedido"}}
def permitida(nombre, rol):
    return nombre in PERMISOS.get(rol, set())
print(permitida("datos_pedido", "cliente"), permitida("enviar_correo", "cliente"), permitida("datos_pedido", "invitado"))`, 'rol desconocido = sin permisos']],
    seeAlso: ['confirmación humana', 'inyección de prompt'],
  },
  {
    name: 'confirmación humana',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: '*Human-in-the-loop*: las acciones con efectos o irreversibles (cancelar, pagar, enviar, borrar) no se ejecutan hasta que una persona las aprueba, mostrando exactamente qué se hará y con qué argumentos.',
    usage: 'if nombre in CONFIRMAR and not confirmar(nombre, args):\n    return {"error": "el usuario no ha confirmado la acción"}',
    details: 'Comprueba antes los permisos para no molestar con acciones prohibidas. Evita la "fatiga de confirmaciones": pide confirmación solo donde importa y deja las consultas de solo lectura automáticas. Registra quién aprobó qué.',
    examples: [[`CONFIRMAR = {"cancelar_pedido"}
def ejecutar(nombre, confirmar):
    if nombre in CONFIRMAR and not confirmar(nombre):
        return "no confirmado"
    return "hecho"
print(ejecutar("cancelar_pedido", lambda n: False), ejecutar("cancelar_pedido", lambda n: True))`, 'sin aprobación no se ejecuta']],
    seeAlso: ['mínimo privilegio', 'presupuesto del agente'],
  },
  {
    name: 'presupuesto del agente',
    kind: 'concepto',
    category: 'agentes',
    level: 2,
    summary: 'Límites duros de pasos, dinero y tiempo para una tarea de agente. En cuanto se supera uno, el bucle se detiene con un mensaje claro. Protege de bucles infinitos y de facturas inesperadas.',
    usage: 'if not presupuesto.gastar(coste_llamada):\n    return "(presupuesto agotado)"',
    details: 'Añade límites por usuario y por día además de por tarea, y alertas de consumo. Mide el coste real por tarea resuelta: es la métrica con la que decidir si un agente compensa frente a un workflow fijo.',
    examples: [[`class Presupuesto:
    def __init__(self, max_pasos, max_coste):
        self.max_pasos, self.max_coste, self.pasos, self.coste = max_pasos, max_coste, 0, 0.0
    def gastar(self, c):
        self.pasos += 1
        self.coste += c
        return self.pasos <= self.max_pasos and self.coste <= self.max_coste
p = Presupuesto(2, 1.0)
print([p.gastar(0.1), p.gastar(0.1), p.gastar(0.1)])`, 'el tercer paso supera el tope']],
    seeAlso: ['max_pasos', 'bucle del agente'],
  },
];
