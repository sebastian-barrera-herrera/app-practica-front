/**
 * Formato de excepciones y tracebacks idéntico al de CPython 3.13: «Traceback (most recent call last)», líneas de
 * código con indicadores (~~~^^^), repetición de marcos, cadenas de excepciones, notas y bloques de SyntaxError.
 */
import { PyBaseException, PyList, PyTuple, type TbEntry } from './objects';
import { E } from './exc_types';
import { makeExc } from './errors';
import { PySyntaxErr } from '../lexer';
import type { ParseWarning } from '../parser';
import type { Interp } from './interp';
import * as ops from './ops';
import type { PyError } from '../types';

// ───────────────────────── nombre y mensaje ─────────────────────────

export function excTypeName(e: PyBaseException): string {
  const t = e.cls;
  const m = t.module;
  const q = t.qualname;
  if (m === 'builtins' || m === '__main__' || m === undefined || m === '') return q;
  return `${m}.${q}`;
}

/** str(exc) sin lanzar nunca */
export function excStr(e: PyBaseException): string {
  try {
    return ops.str(e);
  } catch {
    return '<exception str() failed>';
  }
}

// ───────────────────────── indicadores (carets) ─────────────────────────

interface Anchors {
  /** fin de la parte izquierda (índice dentro de la línea) y comienzo de la derecha */
  leftEnd: number;
  rightStart: number;
}

const OP_LEN: Record<string, number> = {
  '+': 1, '-': 1, '*': 1, '/': 1, '//': 2, '%': 1, '**': 2, '@': 1, '&': 1, '|': 1, '^': 1, '<<': 2, '>>': 2,
};

/** Posición del operador de un BinOp, de un Subscript o del paréntesis de una Call (como `traceback._extract_caret_anchors`) */
function anchorsFor(node: any, line: string, start: number, end: number): Anchors | null {
  if (!node || typeof node !== 'object') return null;
  const single = (x: any) => x && x.line === node.line && x.endLine === node.line;
  if (node.k === 'BinOp' && single(node.left) && single(node.right)) {
    let i = node.left.endCol;
    // cierra paréntesis y espacios que pertenecen al operando izquierdo
    while (i < line.length && (line[i] === ')' || line[i] === ' ' || line[i] === '\t')) i++;
    const len = OP_LEN[node.op] ?? 1;
    // el operador: desde i hasta i+len
    if (i + len > end) return null;
    // CPython marca como «izquierda» todo hasta el operador (incluidos los espacios) y como «derecha» lo posterior al operador
    return { leftEnd: i, rightStart: i + len };
  }
  if (node.k === 'Subscript' && single(node.value) && single(node.slice)) {
    const l = node.value.endCol;
    let r = node.slice.endCol;
    // el cierre `]` (puede haber paréntesis o espacios antes)
    while (r < line.length && line[r] !== ']') r++;
    r++;
    return { leftEnd: l, rightStart: Math.min(r, end) };
  }
  if (node.k === 'Call' && single(node.func)) {
    let l = node.func.endCol;
    while (l < line.length && line[l] !== '(' ) l++;
    // right_start == fin del nodo: los paréntesis se marcan con el carácter secundario
    return { leftEnd: l, rightStart: end };
  }
  void start;
  return null;
}

/** `traceback._should_show_carets` de CPython 3.13 */
function shouldShowCarets(node: any, line: string, start: number, end: number, anchors: Anchors | null): boolean {
  if (node.k === 'Call' && node.line === node.endLine) {
    const before = line.slice(0, start);
    const after = line.slice(end);
    // `return f(...)` (llamada a un nombre) o `nombre = llamada(...)`: el segmento ocupa todo el valor ⇒ sin indicadores
    if (/^\s*return\s*\(*\s*$/.test(before) && node.func && node.func.k === 'Name' && /^\s*\)*\s*(#.*)?$/.test(after)) return false;
    if (/^\s*[A-Za-z_][A-Za-z_0-9]*\s*=\s*\(*\s*$/.test(before) && /^\s*\)*\s*(#.*)?$/.test(after)) return false;
  }
  if (anchors) return true;
  if (line.slice(0, start).trim() !== '' || line.slice(end).trimEnd() !== '') return true;
  return false;
}

function lineText(I: Interp, tb: TbEntry, lineno: number): string | undefined {
  if (tb.text !== undefined) return tb.text;
  const lines = I.sources.get(tb.code.filename);
  if (lines === undefined) return undefined;
  const l = lines[lineno - 1];
  return l === undefined ? undefined : l.replace(/\r$/, '');
}

function fmtFrame(I: Interp, tb: TbEntry): string {
  const lineno = tb.pos ? tb.pos.line : tb.code.firstLine;
  let out = `  File "${tb.code.filename}", line ${lineno}, in ${tb.code.name}\n`;
  const orig = lineText(I, tb, lineno);
  if (orig === undefined) return out;
  const stripped = orig.trim();
  if (stripped === '') return out;
  const lead = orig.length - orig.replace(/^[ \t\f]+/, '').length;
  out += `    ${stripped}\n`;
  const pos = tb.pos;
  if (!pos) return out;
  const startOff = pos.col;
  let endOff = pos.endLine === pos.line ? pos.endCol : lead + stripped.length;
  if (pos.endLine !== pos.line) endOff = lead + stripped.length;
  let anchors: Anchors | null = null;
  if (pos.endLine === pos.line) anchors = anchorsFor(pos as any, orig, startOff, endOff);
  if (endOff <= startOff) return out;
  if (!shouldShowCarets(pos as any, orig, startOff, endOff, anchors)) return out;
  let carets = '    ' + ' '.repeat(Math.max(0, startOff - lead));
  if (anchors) {
    const isCall = (pos as any).k === 'Call';
    const prim = '~';
    const leftEnd = anchors.leftEnd;
    const rightStart = anchors.rightStart;
    if (isCall) {
      carets += prim.repeat(Math.max(0, leftEnd - startOff)) + '^'.repeat(Math.max(0, endOff - leftEnd));
    } else {
      carets += prim.repeat(Math.max(0, leftEnd - startOff)) + '^'.repeat(Math.max(0, rightStart - leftEnd)) + prim.repeat(Math.max(0, endOff - rightStart));
    }
  } else {
    carets += '^'.repeat(endOff - startOff);
  }
  out += carets + '\n';
  return out;
}

// ───────────────────────── traceback de una excepción ─────────────────────────

function visibleEntries(e: PyBaseException): TbEntry[] {
  const out: TbEntry[] = [];
  for (let i = e.tb.length - 1; i >= 0; i--) {
    const t = e.tb[i];
    if ((t.code.hidden && !(globalThis as any).__PY_SHOW_HIDDEN__) || t.code.inlined) continue;
    out.push(t);
  }
  return out;
}

const REPEAT_CUTOFF = 3;

function fmtStack(I: Interp, entries: TbEntry[]): string {
  let out = '';
  let lastKey = '';
  let count = 0;
  for (const t of entries) {
    const key = `${t.code.filename}:${t.pos ? t.pos.line : 0}:${t.code.name}`;
    if (key !== lastKey) {
      if (count > REPEAT_CUTOFF) {
        const n = count - REPEAT_CUTOFF;
        out += `  [Previous line repeated ${n} more time${n === 1 ? '' : 's'}]\n`;
      }
      lastKey = key;
      count = 0;
    }
    count++;
    if (count > REPEAT_CUTOFF) continue;
    out += fmtFrame(I, t);
  }
  if (count > REPEAT_CUTOFF) {
    const n = count - REPEAT_CUTOFF;
    out += `  [Previous line repeated ${n} more time${n === 1 ? '' : 's'}]\n`;
  }
  return out;
}

/** líneas «File/texto/carets» de un SyntaxError y su mensaje */
function fmtSyntaxError(e: PyBaseException): string {
  const x = e.extra ?? {};
  const kind = excTypeName(e);
  let out = '';
  const filename: string | null = x.filename ?? null;
  const lineno: number | null = x.lineno ?? null;
  let suffix = '';
  if (lineno !== null && lineno !== undefined) out += `  File "${filename ?? '<string>'}", line ${lineno}\n`;
  else if (filename !== null) suffix = ` (${filename})`;
  const text: string | null = x.text ?? null;
  if (text !== null && text !== undefined) {
    const rtext = text.replace(/\n+$/, '');
    const ltext = rtext.replace(/^[ \n\f]+/, '');
    const spaces = rtext.length - ltext.length;
    const offset: number | null = x.offset ?? null;
    if (offset === null || offset === undefined) out += `    ${ltext}\n`;
    else {
      const colno = offset - 1 - spaces;
      let endColno = x.end_offset !== null && x.end_offset !== undefined ? x.end_offset - 1 - spaces : colno + 1;
      if (x.end_lineno !== undefined && x.end_lineno !== null && lineno !== null && x.end_lineno !== lineno) endColno = ltext.length;
      if (colno >= 0) {
        let caretspace = '';
        for (const c of ltext.slice(0, colno)) caretspace += /\s/.test(c) ? c : ' ';
        out += `    ${ltext}\n`;
        out += `    ${caretspace}${'^'.repeat(Math.max(1, endColno - colno))}\n`;
      } else out += `    ${ltext}\n`;
    }
  }
  const msg = x.msg ?? excStr(e);
  out += `${kind}: ${msg || '<no detail available>'}${suffix}\n`;
  return out;
}

/** «Tipo: mensaje» + notas */
export function formatExceptionOnly(e: PyBaseException): string {
  if (e.cls.isSubtype(E.SyntaxError) && e.extra && e.extra.syntax) {
    let s = fmtSyntaxError(e);
    s += fmtNotes(e);
    return s;
  }
  const name = excTypeName(e);
  const msg = excStr(e);
  let s = msg === '' ? `${name}\n` : `${name}: ${msg}\n`;
  s += fmtNotes(e);
  return s;
}

function fmtNotes(e: PyBaseException): string {
  const notes = e.dict ? e.dict.get('__notes__') : undefined;
  let s = '';
  if (notes instanceof PyList || notes instanceof PyTuple) {
    for (const n of notes.a) s += `${ops.str(n)}\n`;
  } else if (e.notes) {
    for (const n of e.notes) s += `${n}\n`;
  }
  return s;
}

/** Traceback completo de una excepción (con las cadenas de causa y contexto), como `traceback.format_exception` */
export function formatException(I: Interp, e: PyBaseException, seen: Set<PyBaseException> = new Set()): string {
  seen.add(e);
  let out = '';
  const cause = e.cause;
  const ctx = e.context;
  if (cause !== null && !seen.has(cause)) {
    out += formatException(I, cause, seen) + '\nThe above exception was the direct cause of the following exception:\n\n';
  } else if (cause === null && ctx !== null && !e.suppressContext && !seen.has(ctx)) {
    out += formatException(I, ctx, seen) + '\nDuring handling of the above exception, another exception occurred:\n\n';
  }
  const entries = visibleEntries(e);
  const isSyntax = e.cls.isSubtype(E.SyntaxError) && e.extra && e.extra.syntax;
  if (entries.length > 0) out += 'Traceback (most recent call last):\n' + fmtStack(I, entries);
  void isSyntax;
  out += formatExceptionOnly(e);
  return out;
}

/** Línea (1-based) del último marco visible del traceback (donde ocurrió el error) */
export function errorLine(e: PyBaseException): number | undefined {
  const x = e.extra;
  if (e.cls.isSubtype(E.SyntaxError) && x && typeof x.lineno === 'number') return x.lineno;
  for (let i = 0; i < e.tb.length; i++) {
    const t = e.tb[i];
    if (t.code.hidden || t.code.inlined) continue;
    if (t.pos) return t.pos.line;
  }
  return undefined;
}

export function toPyError(I: Interp, e: PyBaseException): PyError {
  const traceback = formatException(I, e);
  return { type: excTypeName(e), message: excStr(e), line: errorLine(e), traceback };
}

// ───────────────────────── errores de sintaxis ─────────────────────────

const KIND_TYPE: Record<string, () => import('./objects').PyType> = {
  SyntaxError: () => E.SyntaxError,
  IndentationError: () => E.IndentationError,
  TabError: () => E.TabError,
};

export function syntaxErrToExc(se: PySyntaxErr, filename: string, text: string): PyBaseException {
  const t = (KIND_TYPE[se.kind] ?? KIND_TYPE.SyntaxError)();
  const exc = makeExc(t, [se.msg]);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const lineText = lines[se.line - 1];
  const hasText = lineText !== undefined;
  // offsets 1-based
  const offset = se.col + 1;
  const endOffset = se.endCol + 1;
  exc.extra = {
    syntax: true,
    msg: se.msg,
    filename,
    lineno: se.line,
    offset,
    end_lineno: se.endLine,
    end_offset: endOffset,
    text: hasText ? lineText + '\n' : null,
  };
  return exc;
}

// ───────────────────────── avisos de sintaxis ─────────────────────────

export function emitWarnings(I: Interp, ws: ParseWarning[], filename: string, lines: string[]): void {
  for (const w of ws) {
    const key = `${filename}:${w.line}:${w.msg}`;
    if (I.warnedOnce.has(key)) continue;
    I.warnedOnce.add(key);
    let s = `${filename}:${w.line}: ${w.category}: ${w.msg}\n`;
    const src = lines[w.line - 1];
    if (src !== undefined && src.trim() !== '') s += `  ${src.trim()}\n`;
    I.write(s, true);
  }
}
