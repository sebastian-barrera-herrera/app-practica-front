/**
 * Autocompletado del editor de Python (sin dependencias): propone, según la palabra que se está escribiendo,
 * los nombres que ya aparecen en el código (variables, funciones, clases), las funciones de Python, las palabras clave
 * y, tras un punto, los métodos más usados. Es una función pura: recibe el texto y la posición del cursor.
 */
import { highlightPython } from './pyhighlight';

export type CompletionKind = 'var' | 'fn' | 'cls' | 'bi' | 'kw' | 'method' | 'snippet';

export interface Completion {
  /** Lo que se muestra en el botón. */
  label: string;
  /** Texto que sustituye a lo escrito. */
  insert: string;
  /** Dónde queda el cursor dentro de `insert` (por defecto, al final). */
  caret?: number;
  kind: CompletionKind;
  /** Pista corta (firma o explicación). */
  hint?: string;
}

/** Funciones integradas: nombre, pista y si suelen llevar argumentos (el cursor entra en los paréntesis). */
const BUILTIN_FNS: [string, string, boolean][] = [
  ['print', 'muestra en pantalla', true],
  ['input', 'pide un texto', true],
  ['len', 'cuántos elementos', true],
  ['range', 'secuencia de números', true],
  ['int', 'a número entero', true],
  ['float', 'a número decimal', true],
  ['str', 'a texto', true],
  ['bool', 'a verdadero/falso', true],
  ['list', 'lista', true],
  ['dict', 'diccionario', true],
  ['set', 'conjunto', true],
  ['tuple', 'tupla', true],
  ['sum', 'suma', true],
  ['min', 'el menor', true],
  ['max', 'el mayor', true],
  ['abs', 'valor absoluto', true],
  ['round', 'redondea', true],
  ['sorted', 'ordena', true],
  ['reversed', 'da la vuelta', true],
  ['enumerate', 'posición y valor', true],
  ['zip', 'junta listas', true],
  ['map', 'aplica a cada uno', true],
  ['filter', 'deja los que cumplen', true],
  ['open', 'abre un archivo', true],
  ['type', 'de qué tipo es', true],
  ['isinstance', '¿es de este tipo?', true],
  ['chr', 'número → carácter', true],
  ['ord', 'carácter → número', true],
  ['any', '¿alguno cumple?', true],
  ['all', '¿todos cumplen?', true],
  ['pow', 'potencia', true],
  ['divmod', 'cociente y resto', true],
];

const BUILTIN_CLASSES = ['Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'NameError', 'ZeroDivisionError', 'AttributeError', 'FileNotFoundError', 'RuntimeError', 'StopIteration'];

/** Palabras clave: texto a insertar (con espacio o «:» cuando es lo habitual). */
const KEYWORD_INSERT: Record<string, string> = {
  False: 'False', None: 'None', True: 'True',
  and: 'and ', as: 'as ', assert: 'assert ', async: 'async ', await: 'await ', break: 'break', class: 'class ', continue: 'continue',
  def: 'def ', del: 'del ', elif: 'elif ', else: 'else:', except: 'except ', finally: 'finally:', for: 'for ', from: 'from ',
  global: 'global ', if: 'if ', import: 'import ', in: 'in ', is: 'is ', lambda: 'lambda ', nonlocal: 'nonlocal ', not: 'not ',
  or: 'or ', pass: 'pass', raise: 'raise ', return: 'return ', try: 'try:', while: 'while ', with: 'with ', yield: 'yield ',
};

/** Métodos habituales tras un punto (texto, lista, diccionario, archivo): nombre, pista y si no lleva argumentos. */
const METHODS: [string, string, boolean][] = [
  ['append', 'añade al final', false],
  ['upper', 'MAYÚSCULAS', true],
  ['lower', 'minúsculas', true],
  ['strip', 'quita espacios', true],
  ['split', 'parte el texto', false],
  ['join', 'une con un separador', false],
  ['replace', 'cambia un trozo', false],
  ['format', 'rellena {}', false],
  ['startswith', '¿empieza por…?', false],
  ['endswith', '¿acaba en…?', false],
  ['find', 'posición del texto', false],
  ['count', 'cuántas veces', false],
  ['title', 'Cada Palabra', true],
  ['capitalize', 'Primera mayúscula', true],
  ['isdigit', '¿solo dígitos?', true],
  ['lstrip', 'quita a la izquierda', true],
  ['rstrip', 'quita a la derecha', true],
  ['extend', 'añade varios', false],
  ['insert', 'inserta en una posición', false],
  ['remove', 'quita un valor', false],
  ['pop', 'saca uno', false],
  ['sort', 'ordena la lista', true],
  ['reverse', 'da la vuelta', true],
  ['index', 'posición de un valor', false],
  ['copy', 'copia', true],
  ['clear', 'vacía', true],
  ['get', 'valor o un por defecto', false],
  ['items', 'pares clave–valor', true],
  ['keys', 'las claves', true],
  ['values', 'los valores', true],
  ['update', 'actualiza', false],
  ['setdefault', 'valor o lo crea', false],
  ['read', 'lee todo', true],
  ['readline', 'lee una línea', true],
  ['readlines', 'lee todas las líneas', true],
  ['write', 'escribe', false],
  ['close', 'cierra', true],
];

const IDENT = /[A-Za-z0-9_]/;

/** Palabra que se está escribiendo justo antes del cursor. */
export function wordAt(text: string, cursor: number): { start: number; prefix: string; afterDot: boolean } {
  const c = Math.max(0, Math.min(cursor, text.length));
  let s = c;
  while (s > 0 && IDENT.test(text[s - 1])) s--;
  return { start: s, prefix: text.slice(s, c), afterDot: s > 0 && text[s - 1] === '.' };
}

const STRING_DONE = /^[rRbBfFuU]{0,2}("""[\s\S]*"""|'''[\s\S]*'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')$/;

/** ¿El cursor está dentro de un comentario o de un texto entre comillas? Ahí no se sugiere nada. */
export function inStringOrComment(text: string, cursor: number): boolean {
  const lines = highlightPython(text.slice(0, cursor));
  const line = lines[lines.length - 1] ?? [];
  const last = line[line.length - 1];
  // sin tramos en la línea actual no hay palabra que completar (y las sugerencias ya exigen prefijo o punto)
  if (!last) return false;
  if (last.k === 'com') return true;
  return last.k === 'str' && !STRING_DONE.test(last.s);
}

interface DocName {
  name: string;
  kind: 'var' | 'fn' | 'cls';
  /** Si es una función definida con `def`: ¿tiene parámetros? */
  params?: boolean;
}

/** Nombres que ya aparecen en el código, del más reciente al más antiguo. */
export function namesInCode(text: string): DocName[] {
  const defs = new Map<string, boolean>();
  for (const m of text.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) defs.set(m[1], m[2].replace(/\b(self|cls)\b\s*,?/g, '').trim() !== '');
  const out = new Map<string, DocName>();
  const lines = highlightPython(text);
  for (const line of lines) {
    for (const t of line) {
      if (t.k !== 'text' && t.k !== 'fn' && t.k !== 'cls') continue;
      if (!/^[A-Za-z_]\w*$/.test(t.s) || t.s.length < 2) continue;
      const kind = t.k === 'text' ? 'var' : t.k;
      // se vuelve a insertar para que el último uso quede al final (más reciente)
      out.delete(t.s);
      out.set(t.s, { name: t.s, kind: defs.has(t.s) ? 'fn' : kind, params: defs.get(t.s) });
    }
  }
  return [...out.values()].reverse();
}

/**
 * Sugerencias para la palabra que hay antes del cursor. `start` es dónde empieza esa palabra (lo que se sustituye).
 * Sin nada escrito (y sin punto) no se sugiere nada; tras un punto se ofrecen métodos aunque no haya prefijo.
 */
export function suggest(text: string, cursor: number, max = 8): { start: number; items: Completion[] } {
  const { start, prefix, afterDot } = wordAt(text, cursor);
  if (inStringOrComment(text, cursor)) return { start, items: [] };
  if (!afterDot && prefix === '') return { start, items: [] };
  // un número suelto (3, 2.5) no es el comienzo de un nombre
  if (/^\d/.test(prefix)) return { start, items: [] };

  const p = prefix.toLowerCase();
  const items: Completion[] = [];
  const seen = new Set<string>();
  const add = (c: Completion) => {
    if (seen.has(c.label) || c.insert === prefix) return;
    if (!c.label.toLowerCase().startsWith(p)) return;
    seen.add(c.label);
    items.push(c);
  };

  if (afterDot) {
    for (const [name, hint, noArgs] of METHODS) add({ label: name, insert: `${name}()`, caret: noArgs ? name.length + 2 : name.length + 1, kind: 'method', hint });
    return { start, items: items.slice(0, max) };
  }

  // lo que se está escribiendo no cuenta como «nombre ya existente»
  const rest = text.slice(0, start) + text.slice(cursor);
  const known = new Set<string>([...BUILTIN_FNS.map(([n]) => n), ...BUILTIN_CLASSES, ...Object.keys(KEYWORD_INSERT), 'self', 'cls']);
  for (const n of namesInCode(rest)) {
    if (known.has(n.name)) continue;
    if (n.kind === 'fn') add({ label: n.name, insert: `${n.name}()`, caret: n.params === false ? n.name.length + 2 : n.name.length + 1, kind: 'fn', hint: 'tu función' });
    else if (n.kind === 'cls') add({ label: n.name, insert: n.name, kind: 'cls', hint: 'clase' });
    else add({ label: n.name, insert: n.name, kind: 'var', hint: 'variable' });
  }
  for (const [name, hint, args] of BUILTIN_FNS) add({ label: name, insert: `${name}()`, caret: args ? name.length + 1 : name.length + 2, kind: 'bi', hint });
  for (const name of BUILTIN_CLASSES) add({ label: name, insert: name, kind: 'cls', hint: 'error' });
  for (const [kw, ins] of Object.entries(KEYWORD_INSERT)) add({ label: kw, insert: ins, kind: 'kw' });
  return { start, items: items.slice(0, max) };
}

/** Atajos que se ofrecen cuando no hay nada que autocompletar. `caret` = posición del cursor dentro del texto. */
export const SNIPPETS: Completion[] = [
  { label: 'print()', insert: 'print()', caret: 6, kind: 'snippet', hint: 'mostrar algo' },
  { label: 'input()', insert: 'input()', caret: 6, kind: 'snippet', hint: 'pedir un dato' },
  { label: 'for', insert: 'for i in range():\n    ', caret: 15, kind: 'snippet', hint: 'repetir' },
  { label: 'if', insert: 'if :\n    ', caret: 3, kind: 'snippet', hint: 'decidir' },
  { label: 'while', insert: 'while :\n    ', caret: 6, kind: 'snippet', hint: 'mientras' },
  { label: 'def', insert: 'def ():\n    ', caret: 4, kind: 'snippet', hint: 'función' },
  { label: 'len()', insert: 'len()', caret: 4, kind: 'snippet' },
  { label: 'range()', insert: 'range()', caret: 6, kind: 'snippet' },
  { label: 'f""', insert: 'f""', caret: 2, kind: 'snippet', hint: 'texto con {variables}' },
];
