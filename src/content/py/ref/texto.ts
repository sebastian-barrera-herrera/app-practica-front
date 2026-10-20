import type { PyRef } from '../reference';

const m = (name: string, summary: string, usage: string, examples: PyRef['examples'], extra: Partial<PyRef> = {}): PyRef => ({
  name,
  kind: 'método',
  category: 'texto',
  level: 1,
  summary,
  usage,
  examples,
  ...extra,
});

export const TEXTO: PyRef[] = [
  m('str.upper', 'Devuelve el texto en mayúsculas.', 'texto.upper() → str', [['"hola".upper()'], ['"Ñandú".upper()', 'Respeta tildes y eñes']], { seeAlso: ['str.lower'] }),
  m('str.lower', 'Devuelve el texto en minúsculas.', 'texto.lower() → str', [['"HOLA Mundo".lower()', 'Útil para comparar sin importar mayúsculas']], { seeAlso: ['str.upper'] }),
  m('str.strip', 'Quita espacios (u otros caracteres) de los extremos.', 'texto.strip(caracteres=None) → str', [['"  hola  ".strip()'], ['"--hola--".strip("-")', 'Quita guiones en vez de espacios'], ['"  hola  ".lstrip()', 'Solo a la izquierda']], { details: 'Imprescindible al leer datos de usuarios o archivos. Existen `lstrip` y `rstrip` para un solo lado.' }),
  m('str.replace', 'Cambia las apariciones de un fragmento por otro.', 'texto.replace(viejo, nuevo, cuantas=-1) → str', [['"banana".replace("a", "o")'], ['"banana".replace("a", "o", 1)', 'Solo la primera']], { details: 'Devuelve un texto nuevo; el original no cambia (los textos son inmutables).' }),
  m('str.split', 'Parte un texto en una lista de trozos.', 'texto.split(separador=None, maxsplit=-1) → list', [['"rojo,verde,azul".split(",")'], ['"  varias   palabras  ".split()', 'Sin argumento: separa por espacios y descarta los vacíos'], ['"a=b=c".split("=", 1)', 'Máximo una partición']], { seeAlso: ['str.join'] }),
  m('str.join', 'Une los textos de una lista usando el texto como pegamento.', 'separador.join(iterable) → str', [['"-".join(["a", "b", "c"])'], ['", ".join(["uno", "dos"])', 'Con coma y espacio'], ['"".join(["Py", "thon"])', 'Sin separador']], { details: 'Todos los elementos deben ser textos: `", ".join([1, 2])` da `TypeError`; conviértelos antes con `str`.', seeAlso: ['str.split'] }),
  m('str.find', 'Posición de un fragmento (o -1 si no está).', 'texto.find(sub, inicio=0, fin=len) → int', [['"banana".find("n")'], ['"banana".find("z")', 'No está: -1'], ['"banana".find("n", 3)', 'Empieza a buscar en la posición 3']], { seeAlso: ['str.count', 'in'] }),
  m('str.startswith', '¿Empieza el texto por ese fragmento?', 'texto.startswith(prefijo) → bool', [['"python".startswith("py")'], ['"python".startswith(("java", "py"))', 'Acepta una tupla de opciones']], { seeAlso: ['str.endswith'] }),
  m('str.endswith', '¿Termina el texto con ese fragmento?', 'texto.endswith(sufijo) → bool', [['"foto.png".endswith(".png")'], ['"foto.png".endswith((".jpg", ".png"))']], { seeAlso: ['str.startswith'] }),
  m('str.count', 'Cuenta las apariciones de un fragmento.', 'texto.count(sub) → int', [['"banana".count("a")'], ['"banana".count("an")']]),
  m('str.format', 'Rellena huecos `{}` de un texto.', 'texto.format(*args, **kwargs) → str', [['"{} tiene {} años".format("Ada", 36)'], ['"{nombre}: {valor:.1f}".format(nombre="x", valor=2.55)']], { details: 'Era la forma habitual antes de las f-strings; sigue siendo útil cuando la plantilla viene de fuera del código.', seeAlso: ['f-strings'] }),
  m('str.isdigit', '¿Son todos los caracteres dígitos?', 'texto.isdigit() → bool', [['"2025".isdigit()'], ['"12a".isdigit()'], ['"".isdigit()', 'Un texto vacío da False']], { details: 'Útil para validar entradas antes de usar `int()`. Para negativos o decimales no sirve (`"-3".isdigit()` es `False`).', seeAlso: ['int', 'str.isalpha'] }),
  m('str.isalpha', '¿Son todos los caracteres letras?', 'texto.isalpha() → bool', [['"hola".isalpha()'], ['"hola1".isalpha()'], ['"ñandú".isalpha()']]),
  m('str.title', 'Pone en mayúscula la primera letra de cada palabra.', 'texto.title() → str', [['"hola mundo cruel".title()']], { seeAlso: ['str.capitalize'] }),
  m('str.capitalize', 'Primera letra en mayúscula y el resto en minúsculas.', 'texto.capitalize() → str', [['"hOLA MUNDO".capitalize()']]),
  m('str.center', 'Centra el texto en un ancho dado.', 'texto.center(ancho, relleno=" ") → str', [['"hola".center(10, "*")']], { seeAlso: ['str.ljust', 'str.rjust'] }),
  m('str.ljust', 'Alinea a la izquierda rellenando hasta un ancho.', 'texto.ljust(ancho, relleno=" ") → str', [['"ab".ljust(5, ".") + "|"']]),
  m('str.rjust', 'Alinea a la derecha rellenando hasta un ancho.', 'texto.rjust(ancho, relleno=" ") → str', [['"ab".rjust(5, ".")'], ['str(7).rjust(3, "0")', 'Rellenar con ceros']], { seeAlso: ['f-strings'] }),
  m('str.splitlines', 'Parte un texto en líneas.', 'texto.splitlines() → list', [['"uno\\ndos\\ntres".splitlines()']]),
];
