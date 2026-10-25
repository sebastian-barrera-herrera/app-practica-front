/** Analizador léxico de SQL: texto → fichas con su posición. */
import { syntaxError } from './types';

export type TokKind = 'id' | 'qid' | 'num' | 'str' | 'op' | 'eof';

export interface Token {
  kind: TokKind;
  /** Texto: para identificadores sin comillas, tal cual (se compara en mayúsculas); para cadenas, el contenido ya sin comillas. */
  text: string;
  pos: number;
  end: number;
}

const OPS3 = ['<=>'];
const OPS2 = ['<>', '!=', '<=', '>=', '||', '::', '->', '=>', '~*', '!~'];
const OPS1 = '+-*/%=<>(),;.~[]:';

const isDigit = (c: string) => c >= '0' && c <= '9';
const isIdStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c > '\u007f';
const isIdPart = (c: string) => isIdStart(c) || isDigit(c) || c === '$';

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // comentarios
    if (c === '-' && src[i + 1] === '-') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw syntaxError('Comentario «/* … */» sin cerrar', i, 'Termina el comentario con */');
      i = end + 2;
      continue;
    }
    const start = i;
    // números
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i;
      while (j < n && isDigit(src[j])) j++;
      if (src[j] === '.' && isDigit(src[j + 1] ?? '')) {
        j++;
        while (j < n && isDigit(src[j])) j++;
      } else if (src[j] === '.' && !isIdStart(src[j + 1] ?? '') && src[j + 1] !== '.') {
        j++; // «5.» también es un número
      }
      if ((src[j] === 'e' || src[j] === 'E') && (isDigit(src[j + 1] ?? '') || ((src[j + 1] === '+' || src[j + 1] === '-') && isDigit(src[j + 2] ?? '')))) {
        j += 2;
        while (j < n && isDigit(src[j])) j++;
      }
      out.push({ kind: 'num', text: src.slice(i, j), pos: start, end: j });
      i = j;
      continue;
    }
    // cadenas 'texto' ('' = comilla)
    if (c === "'") {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= n) throw syntaxError('Texto sin cerrar: falta la comilla simple de cierre (\')', start, 'Los textos van entre comillas simples: \'hola\'');
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          j++;
          break;
        }
        s += src[j++];
      }
      out.push({ kind: 'str', text: s, pos: start, end: j });
      i = j;
      continue;
    }
    // identificadores entre comillas "nombre" o `nombre`
    if (c === '"' || c === '`') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= n) throw syntaxError(`Identificador sin cerrar: falta la comilla de cierre (${c})`, start);
        if (src[j] === c) {
          if (src[j + 1] === c) {
            s += c;
            j += 2;
            continue;
          }
          j++;
          break;
        }
        s += src[j++];
      }
      out.push({ kind: 'qid', text: s, pos: start, end: j });
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j])) j++;
      out.push({ kind: 'id', text: src.slice(i, j), pos: start, end: j });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) {
      out.push({ kind: 'op', text: three, pos: start, end: i + 3 });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ kind: 'op', text: two, pos: start, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ kind: 'op', text: c, pos: start, end: i + 1 });
      i++;
      continue;
    }
    if (c === '“' || c === '”' || c === '‘' || c === '’') throw syntaxError(`Carácter «${c}» no válido: parece una comilla «tipográfica»`, start, "Usa comillas simples rectas: '");
    throw syntaxError(`Carácter inesperado «${c}»`, start);
  }
  out.push({ kind: 'eof', text: '', pos: n, end: n });
  return out;
}
