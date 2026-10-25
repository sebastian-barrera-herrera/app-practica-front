import type { Tok, TokKind } from './pyhighlight';

/** Colores del código SQL (paleta «Dark+» de VS Code; la caja de código es oscura en los dos temas). */
export const SQL_COLOR: Record<TokKind, string> = {
  kw: '#569CD6', // AND, OR, NOT, NULL, IN, LIKE, CASE…
  str: '#CE9178',
  num: '#B5CEA8',
  com: '#6A9955',
  fn: '#DCDCAA', // COUNT(, UPPER(…
  cls: '#4EC9B0', // INTEGER, TEXT, DATE…
  dec: '#C586C0', // SELECT, FROM, WHERE, JOIN… (las cláusulas que estructuran la consulta)
  bi: '#DCDCAA',
  op: '#D4D4D4',
  text: '#9CDCFE', // tablas y columnas
  prompt: '#4EC9B0',
  out: '#A6B6E0',
};

export const sqlTokColor = (t: Tok): string => SQL_COLOR[t.k];
