/** Resaltado de sintaxis de Python (sin dependencias): devuelve los tramos de cada línea con su categoría. */

export type TokKind = 'kw' | 'str' | 'num' | 'com' | 'fn' | 'cls' | 'dec' | 'bi' | 'op' | 'prompt' | 'out' | 'text';
export interface Tok {
  k: TokKind;
  s: string;
}

const KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case type'.split(' '),
);
const BUILTINS = new Set(
  'abs all any bin bool bytes callable chr dict dir divmod enumerate filter float format frozenset getattr hasattr hash hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print range repr reversed round set setattr slice sorted staticmethod classmethod property str sum super tuple type vars zip self cls Exception ValueError TypeError KeyError IndexError NameError ZeroDivisionError AttributeError StopIteration RuntimeError OSError FileNotFoundError'.split(' '),
);

const RE = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rRbBfFuU]{0,2}"(?:\\.|[^"\\\n])*"?|[rRbBfFuU]{0,2}'(?:\\.|[^'\\\n])*'?)|(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?j?|\.\d[\d_]*(?:[eE][+-]?\d+)?j?)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)|([ \t]+)|(\n)|(.)/g;

/** Resalta un fragmento de código Python. Devuelve una lista de líneas, cada una con sus tramos. */
export function highlightPython(src: string): Tok[][] {
  const lines: Tok[][] = [[]];
  const push = (k: TokKind, s: string) => {
    if (!s) return;
    // los tramos con saltos de línea (cadenas triples) se reparten entre líneas
    const parts = s.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ k, s: p });
    });
  };
  let prevWord = '';
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  // para saber si un identificador es una llamada, miramos el siguiente carácter no blanco
  while ((m = RE.exec(src))) {
    const [tok, com, str, num, dec, word, ws, nl] = m;
    if (com) push('com', tok);
    else if (str) push('str', tok);
    else if (num) push('num', tok);
    else if (dec) push('dec', tok);
    else if (word) {
      const next = src[RE.lastIndex] ?? '';
      let k: TokKind = 'text';
      if (KEYWORDS.has(word) && !(word === 'match' || word === 'case' || word === 'type') ) k = 'kw';
      else if ((word === 'match' || word === 'case' || word === 'type') && /^\s*[\w\[({"'-]/.test(src.slice(RE.lastIndex)) && prevWord === '') k = 'kw';
      else if (prevWord === 'def') k = 'fn';
      else if (prevWord === 'class') k = 'cls';
      else if (BUILTINS.has(word)) k = /^[A-Z]/.test(word) && word !== 'Exception' && !word.endsWith('Error') && word !== 'StopIteration' ? 'cls' : 'bi';
      else if (next === '(') k = /^[A-Z]/.test(word) ? 'cls' : 'fn';
      else if (/^[A-Z][A-Za-z0-9]*$/.test(word) && word.length > 1 && /[a-z]/.test(word)) k = 'cls';
      push(k, word);
      prevWord = KEYWORDS.has(word) ? word : '';
      continue;
    } else if (ws) push('text', tok);
    else if (nl) {
      push('text', '\n');
      prevWord = '';
      continue;
    } else push('op', tok);
    if (!ws) prevWord = '';
  }
  return lines;
}

/** Transcripción de REPL: líneas «>>> » / «... » son código; el resto, salida. */
export function highlightRepl(src: string): Tok[][] {
  return src.split('\n').map((line) => {
    const m = /^(>>>|\.\.\.)( |$)(.*)$/.exec(line);
    if (m) return [{ k: 'prompt' as const, s: m[1] + (m[2] || '') }, ...(highlightPython(m[3])[0] ?? [])];
    return line ? [{ k: 'out' as const, s: line }] : [];
  });
}

export const isReplTranscript = (src: string) => /^>>> /m.test(src);
