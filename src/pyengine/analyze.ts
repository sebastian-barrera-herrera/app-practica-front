/**
 * Análisis estático del código del alumno (características usadas) y detección de entrada incompleta.
 */
import type { Analysis } from './types';
import { parseSource } from './parser';
import { PySyntaxErr } from './lexer';
import { makeExc } from './runtime/errors';
import { E } from './runtime/exc_types';
import { syntaxErrToExc, toPyError } from './runtime/traceback';
import { Interp } from './runtime/interp';
import { setActive } from './runtime/state';
import './runtime/install';

function dottedName(e: any): string | null {
  if (!e) return null;
  if (e.k === 'Name') return e.id;
  if (e.k === 'Attribute') {
    const b = dottedName(e.value);
    return b === null ? e.attr : `${b}.${e.attr}`;
  }
  if (e.k === 'Call') return dottedName(e.func);
  return null;
}

function bump(f: Record<string, number>, key: string): void {
  f[key] = (f[key] ?? 0) + 1;
}

const SKIP = new Set(['line', 'col', 'endLine', 'endCol', 'paren']);

function walk(n: any, f: Record<string, number>): void {
  if (Array.isArray(n)) {
    for (const x of n) walk(x, f);
    return;
  }
  if (n === null || typeof n !== 'object' || n instanceof Uint8Array) return;
  const k = n.k as string | undefined;
  if (k) {
    bump(f, k);
    switch (k) {
      case 'Call':
        if (n.func.k === 'Name') bump(f, `call:${n.func.id}`);
        else if (n.func.k === 'Attribute') bump(f, `method:${n.func.attr}`);
        break;
      case 'Name':
        if (n.ctx === 'Load') bump(f, `name:${n.id}`);
        break;
      case 'BinOp':
        bump(f, `op:${n.op}`);
        break;
      case 'AugAssign':
        bump(f, `op:${n.op}`);
        break;
      case 'Import':
        for (const a of n.names) {
          bump(f, `import:${a.name}`);
          if (a.name.includes('.')) bump(f, `import:${a.name.split('.')[0]}`);
        }
        break;
      case 'ImportFrom':
        if (n.module) {
          bump(f, `import:${n.module}`);
          if (n.module.includes('.')) bump(f, `import:${n.module.split('.')[0]}`);
        }
        break;
      case 'FunctionDef':
      case 'AsyncFunctionDef':
        bump(f, `def:${n.name}`);
        for (const d of n.decorators) {
          const dn = dottedName(d);
          if (dn) bump(f, `decorator:${dn}`);
        }
        break;
      case 'ClassDef':
        bump(f, `class:${n.name}`);
        for (const d of n.decorators) {
          const dn = dottedName(d);
          if (dn) bump(f, `decorator:${dn}`);
        }
        break;
      default:
    }
  }
  for (const key of Object.keys(n)) {
    if (SKIP.has(key)) continue;
    const v = n[key];
    if (v !== null && typeof v === 'object') walk(v, f);
  }
}

let analysisInterp: Interp | null = null;
function withInterp<T>(fn: (I: Interp) => T): T {
  analysisInterp ??= new Interp({});
  const prev = setActive(analysisInterp);
  try {
    return fn(analysisInterp);
  } finally {
    setActive(prev);
  }
}

export function analyze(code: string): Analysis {
  try {
    const parsed = parseSource(code, 'exec');
    const features: Record<string, number> = {};
    walk(parsed.module.body, features);
    return { ok: true, features };
  } catch (e) {
    if (e instanceof PySyntaxErr) {
      return withInterp((I) => ({ ok: false, features: {}, syntaxError: toPyError(I, syntaxErrToExc(e, 'main.py', code)) }));
    }
    throw e;
  }
}

const COMPOUND = new Set(['If', 'For', 'AsyncFor', 'While', 'FunctionDef', 'AsyncFunctionDef', 'ClassDef', 'Try', 'TryStar', 'With', 'AsyncWith', 'Match']);

/**
 * ¿Necesita más líneas el intérprete interactivo? (equivalente a `codeop`): bloques sin terminar, paréntesis o
 * comillas abiertos, barra invertida final, y sentencias compuestas que aún no acaban en línea en blanco.
 */
export function isIncomplete(source: string): boolean {
  const src = source.replace(/\r\n?/g, '\n');
  if (src.trim() === '') return false;
  try {
    const parsed = parseSource(src, 'exec');
    const body = parsed.module.body;
    if (body.length === 0) return false;
    const endsBlank = /\n[ \t]*\n$/.test(src) || /\n\n$/.test(src);
    if (endsBlank) return false;
    const last = body[body.length - 1] as any;
    if (COMPOUND.has(last.k)) return true;
    const lines = src.replace(/\n+$/, '').split('\n');
    return /^\s/.test(lines[lines.length - 1]) && lines.length > 1 && body.length > 0 && COMPOUND.has((body[body.length - 1] as any).k);
  } catch (e) {
    if (e instanceof PySyntaxErr) return !!e.eof;
    throw e;
  }
}

void makeExc;
void E;
