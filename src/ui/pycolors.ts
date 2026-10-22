import { darkColors } from './theme';
import type { Tok, TokKind } from './pyhighlight';

/**
 * Colores del código de Python: la paleta «Dark+» de Visual Studio Code (la caja de código es oscura en los dos temas).
 * El editor y las cajas de código de las lecciones usan la misma, así que se ve igual en todas partes.
 */
export const PY_COLOR: Record<TokKind, string> = {
  kw: '#569CD6', // def, class, None, True, and, or, not, in, is, lambda…
  str: '#CE9178',
  num: '#B5CEA8',
  com: '#6A9955',
  fn: '#DCDCAA',
  cls: '#4EC9B0',
  dec: '#DCDCAA',
  bi: '#DCDCAA',
  op: '#D4D4D4',
  text: '#9CDCFE', // variables y atributos
  prompt: darkColors.mint,
  out: '#A6B6E0',
};

/** Palabras de control de flujo: en VS Code van en rosa/violeta, distintas del resto de palabras clave. */
const CONTROL = new Set(
  'if elif else for while break continue return try except finally raise import from as with pass yield assert del global nonlocal match case await async'.split(' '),
);

export const KEYWORD_CONTROL = '#C586C0';
export const SELF_COLOR = '#569CD6';

export function tokColor(t: Tok): string {
  if (t.k === 'kw' && CONTROL.has(t.s)) return KEYWORD_CONTROL;
  if (t.k === 'bi' && (t.s === 'self' || t.s === 'cls')) return SELF_COLOR;
  return PY_COLOR[t.k];
}
