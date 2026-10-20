/**
 * Renombrado de nombres privados (name mangling) de CPython: dentro de `class Nombre:`, todo identificador que
 * empieza por dos guiones bajos y no termina en dos guiones bajos se convierte en `_Nombre__identificador`
 * (variables, atributos `obj.__x`, parámetros, argumentos con nombre, `global`/`nonlocal`, patrones…).
 * Los nombres de `def`/`class` conservan su `__name__` original: solo cambia el nombre bajo el que se enlazan (`bind`).
 */
import type { Module } from './ast';

export function mangleName(cls: string | null, name: string): string {
  if (cls === null || !name.startsWith('__') || name.endsWith('__') || name.includes('.')) return name;
  const stripped = cls.replace(/^_+/, '');
  return stripped === '' ? name : '_' + stripped + name;
}

const SKIP = new Set(['line', 'col', 'endLine', 'endCol', 'paren', 'vt', 'value_']);

function mangleNode(n: any, cls: string | null): void {
  if (Array.isArray(n)) {
    for (const x of n) mangleNode(x, cls);
    return;
  }
  if (n === null || typeof n !== 'object' || n instanceof Uint8Array) return;
  const k = n.k as string | undefined;
  switch (k) {
    case 'ClassDef': {
      const b = mangleName(cls, n.name);
      if (b !== n.name) n.bind = b;
      mangleNode(n.decorators, cls);
      mangleNode(n.bases, cls);
      mangleNode(n.keywords, cls);
      mangleNode(n.typeParams, cls);
      mangleNode(n.body, n.name);
      return;
    }
    case 'FunctionDef':
    case 'AsyncFunctionDef': {
      const b = mangleName(cls, n.name);
      if (b !== n.name) n.bind = b;
      break;
    }
    case 'Name':
      n.id = mangleName(cls, n.id);
      return;
    case 'Attribute':
      n.attr = mangleName(cls, n.attr);
      mangleNode(n.value, cls);
      return;
    case 'Global':
    case 'Nonlocal':
      n.names = n.names.map((x: string) => mangleName(cls, x));
      return;
    case 'MatchAs':
    case 'MatchStar':
      if (n.name) n.name = mangleName(cls, n.name);
      break;
    case 'MatchMapping':
      if (n.rest) n.rest = mangleName(cls, n.rest);
      break;
    default:
  }
  if (k === undefined) {
    // nodos sin etiqueta: parámetros (`arg`), argumentos con nombre, alias de importación, manejadores de `except`
    if ('arg' in n && 'annotation' in n && typeof n.arg === 'string') n.arg = mangleName(cls, n.arg);
    else if ('arg' in n && 'value' in n && typeof n.arg === 'string') n.arg = mangleName(cls, n.arg);
    else if ('asname' in n && n.asname) n.asname = mangleName(cls, n.asname);
    else if ('handlers' in n === false && 'type' in n && 'name' in n && 'body' in n && typeof n.name === 'string') n.name = mangleName(cls, n.name);
  }
  for (const key of Object.keys(n)) {
    if (SKIP.has(key)) continue;
    const v = n[key];
    if (v !== null && typeof v === 'object') mangleNode(v, cls);
  }
}

export function mangleModule(mod: Module): void {
  mangleNode(mod.body, null);
}
