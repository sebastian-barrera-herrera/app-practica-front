/** Lo que cambia entre el editor de Python y el de SQL: colores, autocompletado, atajos y sangrado. */
import { highlightPython, type Tok } from './pyhighlight';
import { KEYWORD_CONTROL, PY_COLOR, tokColor } from './pycolors';
import { SNIPPETS, suggest, type Completion } from './pycomplete';
import { highlightSql } from './sqlhighlight';
import { SQL_COLOR, sqlTokColor } from './sqlcolors';
import { SQL_SNIPPETS, suggestSql, type SqlSchema } from './sqlcomplete';
import { darkColors } from './theme';

export interface KeyDef {
  label: string;
  text?: string;
  pair?: string;
  act?: 'dedent' | 'tab';
}

export interface EditorLang {
  id: 'py' | 'sql';
  highlight: (src: string) => Tok[][];
  color: (t: Tok) => string;
  /** Color del texto sin resaltar. */
  base: string;
  suggest: (text: string, cursor: number, schema?: SqlSchema) => { start: number; items: Completion[] };
  snippets: Completion[];
  /** Atajo que se destaca cuando no hay sugerencias. */
  primary: string;
  keys: KeyDef[];
  /** ¿La línea abre un bloque (hay que sangrar la siguiente)? */
  indentAfter: (line: string) => boolean;
  candColor: (c: Completion) => string;
  placeholder: string;
}

const PY_KEYS: KeyDef[] = [
  { label: '⇥', act: 'tab' },
  { label: '⇤', act: 'dedent' },
  { label: '( )', text: '()', pair: ')' },
  { label: '[ ]', text: '[]', pair: ']' },
  { label: '{ }', text: '{}', pair: '}' },
  { label: ':', text: ':' },
  { label: '" "', text: '""', pair: '"' },
  { label: "' '", text: "''", pair: "'" },
  { label: '=', text: ' = ' },
  { label: '#', text: '# ' },
  { label: ',', text: ', ' },
  { label: '.', text: '.' },
  { label: '_', text: '_' },
  { label: '+', text: ' + ' },
  { label: '-', text: ' - ' },
  { label: '*', text: '*' },
  { label: '/', text: ' / ' },
  { label: '%', text: ' % ' },
  { label: '<', text: ' < ' },
  { label: '>', text: ' > ' },
  { label: '!', text: '!' },
  { label: '\\', text: '\\' },
];

const SQL_KEYS: KeyDef[] = [
  { label: '⇥', act: 'tab' },
  { label: "' '", text: "''", pair: "'" },
  { label: '( )', text: '()', pair: ')' },
  { label: ',', text: ', ' },
  { label: '.', text: '.' },
  { label: '*', text: '*' },
  { label: '=', text: ' = ' },
  { label: '<>', text: ' <> ' },
  { label: '>=', text: ' >= ' },
  { label: '<=', text: ' <= ' },
  { label: '<', text: ' < ' },
  { label: '>', text: ' > ' },
  { label: '%', text: '%' },
  { label: ';', text: ';' },
  { label: '||', text: ' || ' },
  { label: '+', text: ' + ' },
  { label: '-', text: ' - ' },
  { label: '/', text: ' / ' },
  { label: '" "', text: '""', pair: '"' },
  { label: '_', text: '_' },
];

const pyCand = (c: Completion) => (c.kind === 'var' ? PY_COLOR.text : c.kind === 'kw' ? KEYWORD_CONTROL : c.kind === 'cls' ? PY_COLOR.cls : c.kind === 'snippet' ? darkColors.mint : PY_COLOR.fn);
const sqlCand = (c: Completion) => (c.kind === 'var' ? SQL_COLOR.text : c.kind === 'kw' ? SQL_COLOR.dec : c.kind === 'cls' ? SQL_COLOR.cls : c.kind === 'snippet' ? darkColors.mint : SQL_COLOR.fn);

export const LANGS: Record<'py' | 'sql', EditorLang> = {
  py: {
    id: 'py',
    highlight: highlightPython,
    color: tokColor,
    base: PY_COLOR.text,
    suggest: (t, c) => suggest(t, c),
    snippets: SNIPPETS,
    primary: 'print()',
    keys: PY_KEYS,
    indentAfter: (line) => /:\s*(#.*)?$/.test(line.trimEnd()),
    candColor: pyCand,
    placeholder: '# Escribe tu código aquí',
  },
  sql: {
    id: 'sql',
    highlight: highlightSql,
    color: sqlTokColor,
    base: SQL_COLOR.text,
    suggest: (t, c, schema) => suggestSql(t, c, schema),
    snippets: SQL_SNIPPETS,
    primary: 'SELECT',
    keys: SQL_KEYS,
    indentAfter: () => false,
    candColor: sqlCand,
    placeholder: '-- Escribe tu consulta aquí',
  },
};
