/**
 * Importación de módulos: sys.modules, módulos nativos, módulos de la biblioteca escritos en Python,
 * archivos .py del sistema de archivos virtual.
 */
import { PyBaseException, PyDict, PyList, PyModule, PyObject, PyTuple, type Code } from './objects';
import { moduleType, strType } from './builtin_types';
import { E } from './exc_types';
import { importError, makeExc, typeError } from './errors';
import type { Interp } from './interp';
import { decodeUtf8 } from './interp';
import * as ops from './ops';
import { NATIVE, PYPKG, PYSRC, UNSUPPORTED } from '../stdlib/registry';
import { compileSource, runCode } from '../compile';
import { PySyntaxErr } from '../lexer';
import { syntaxErrToExc, emitWarnings } from './traceback';

export function newModule(I: Interp, name: string): PyModule {
  const m = new PyModule(moduleType, name);
  const d = m.dict!;
  d.set('__name__', name);
  d.set('__doc__', null);
  d.set('__package__', name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : '');
  d.set('__loader__', null);
  d.set('__spec__', null);
  d.set('__builtins__', I.builtins);
  return m;
}

function modulesGet(I: Interp, name: string): any {
  return I.modules.get(name);
}

/** resuelve un nombre relativo respecto del paquete de `g` */
function resolveAbs(I: Interp, name: string, level: number, g: PyDict | null): string {
  if (level === 0) return name;
  let pkg: any = g ? g.get('__package__') : undefined;
  if (pkg === undefined || pkg === null || pkg === '') {
    const nm = g ? g.get('__name__') : undefined;
    if (typeof nm === 'string' && g && g.get('__path__') !== undefined) pkg = nm;
    else if (typeof nm === 'string' && nm.includes('.')) pkg = nm.slice(0, nm.lastIndexOf('.'));
    else pkg = '';
  }
  if (pkg === '') throw importError('attempted relative import with no known parent package', null);
  const parts = String(pkg).split('.');
  if (level - 1 > parts.length - 1) throw importError('attempted relative import beyond top-level package', null);
  const base = parts.slice(0, parts.length - (level - 1)).join('.');
  return name ? base + '.' + name : base;
}

export function importName(I: Interp, name: string, fromlist: string[] | null, level: number, g: PyDict | null, bindLeaf: boolean): any {
  const abs = resolveAbs(I, name, level, g);
  if (abs === '') throw makeExc(E.ValueError, ['Empty module name']);
  const leaf = importModule(I, abs);
  if (fromlist !== null) return leaf;
  if (bindLeaf) return leaf;
  const top = abs.split('.')[0];
  return modulesGet(I, top);
}

export function importFromName(I: Interp, mod: any, name: string, modName: string, level: number, g: PyDict | null): any {
  const v = ops.getAttrOpt(mod, name);
  if (v !== undefined) return v;
  // submódulo
  const base = mod instanceof PyModule ? mod.name : modName;
  if (mod instanceof PyModule) {
    try {
      const sub = importModule(I, base + '.' + name);
      return sub;
    } catch (e) {
      if (!(e instanceof PyBaseException && ops.isInstance(e, E.ModuleNotFoundError) && String(e.args[0]).includes(`'${base}.${name}'`))) throw e;
    }
  }
  const file = mod instanceof PyModule ? mod.dict!.get('__file__') : undefined;
  const loc = file !== undefined && file !== null ? ` (${file})` : mod instanceof PyModule && mod.dict!.get('__file__') === undefined ? ' (unknown location)' : '';
  const e = importError(`cannot import name '${name}' from '${base}'${loc}`, base);
  e.extra.name_from = name;
  void g;
  void level;
  throw e;
}

export function importStar(I: Interp, mod: any, g: PyDict): void {
  let names: string[];
  const all = ops.getAttrOpt(mod, '__all__');
  if (all !== undefined) names = ops.iterToArray(all).map((x: any) => String(x));
  else names = mod.dict.keys().filter((k: any) => typeof k === 'string' && !k.startsWith('_'));
  for (const n of names) {
    const v = ops.getAttrOpt(mod, n);
    if (v === undefined) throw makeExc(E.AttributeError, [`module '${mod.name}' has no attribute '${n}'`]);
    g.set(n, v);
  }
  void I;
}

export function importModule(I: Interp, abs: string): PyModule {
  const have = modulesGet(I, abs);
  if (have !== undefined) {
    if (have === null) throw importError(`import of ${abs} halted; None in sys.modules`, abs);
    return have;
  }
  // padre primero
  let parent: PyModule | null = null;
  const dot = abs.lastIndexOf('.');
  if (dot > 0) {
    parent = importModule(I, abs.slice(0, dot));
    // otro intento: el padre puede haber importado el hijo
    const again = modulesGet(I, abs);
    if (again !== undefined) return again;
    if (parent.dict!.get('__path__') === undefined && !(NATIVE[abs] || PYSRC[abs])) {
      throw importError(`No module named '${abs}'; '${abs.slice(0, dot)}' is not a package`, abs, E.ModuleNotFoundError);
    }
  }
  let mod = loadModule(I, abs, parent);
  // el módulo puede haberse sustituido a sí mismo en sys.modules (p. ej. `decimal` → `_pydecimal`)
  const final = modulesGet(I, abs);
  if (final !== undefined && final !== null && final !== mod) mod = final;
  if (parent) parent.dict!.set(abs.slice(dot + 1), mod);
  return mod;
}

function searchPath(I: Interp): string[] {
  const sys = I.sysModule;
  const out: string[] = [];
  const p = sys ? sys.dict!.get('path') : undefined;
  if (p instanceof PyList) for (const x of p.a) if (typeof x === 'string') out.push(x);
  if (out.length === 0) out.push(I.vfs.cwd);
  return out;
}

function loadModule(I: Interp, abs: string, parent: PyModule | null): PyModule {
  const leaf = abs.slice(abs.lastIndexOf('.') + 1);
  // 1. archivos del usuario en el FS virtual
  const dirs = parent && parent.dict!.get('__path__') instanceof PyList ? (parent.dict!.get('__path__') as PyList).a.map(String) : searchPath(I);
  for (const d of dirs) {
    const base = I.vfs.abs(d + '/' + leaf);
    if (I.vfs.isFile(base + '.py')) return execFile(I, abs, base + '.py', false);
    if (I.vfs.isDir(base) && I.vfs.isFile(base + '/__init__.py')) return execFile(I, abs, base + '/__init__.py', true, base);
    if (I.vfs.isDir(base) && !NATIVE[abs] && !PYSRC[abs]) {
      // paquete de espacio de nombres
      const m = newModule(I, abs);
      m.dict!.set('__path__', new PyList([base]));
      I.modules.set(abs, m);
      return m;
    }
  }
  // 2. biblioteca estándar
  const nat = NATIVE[abs];
  if (nat) {
    const m = newModule(I, abs);
    I.modules.set(abs, m);
    try {
      nat(I, m);
    } catch (e) {
      I.modules.delete(abs);
      throw e;
    }
    return m;
  }
  const src = PYSRC[abs];
  if (src) return execSource(I, abs, src(), '<frozen ' + abs + '>', true);
  const un = UNSUPPORTED[abs] ?? UNSUPPORTED[abs.split('.')[0]];
  if (un !== undefined && un !== '') {
    throw importError(`El módulo '${abs}' no está disponible en este entorno: ${un}`, abs);
  }
  throw importError(`No module named '${abs}'`, abs, E.ModuleNotFoundError);
}

function execFile(I: Interp, abs: string, path: string, isPkg: boolean, pkgDir?: string): PyModule {
  const text = decodeUtf8(I.vfs.readFile(path));
  return execSource(I, abs, text, path, false, path, isPkg, pkgDir);
}

export function execSource(I: Interp, abs: string, text: string, filename: string, hidden: boolean, file?: string, isPkg = false, pkgDir?: string): PyModule {
  const m = newModule(I, abs);
  const d = m.dict!;
  if (file) d.set('__file__', file);
  if (isPkg || (hidden && (PKG_NAMES.has(abs) || PYPKG.has(abs)))) {
    d.set('__path__', new PyList(pkgDir ? [pkgDir] : []));
    d.set('__package__', abs);
  }
  I.modules.set(abs, m);
  try {
    const unit = compileSource(I, text, { filename, hidden, cacheKey: hidden ? 'std:' + abs : undefined });
    emitWarnings(I, unit.warnings, filename, unit.lines);
    runCode(I, unit.code, d);
  } catch (e) {
    I.modules.delete(abs);
    if (e instanceof PySyntaxErr) throw syntaxErrToExc(e, filename, text);
    throw e;
  }
  return m;
}

const PKG_NAMES = new Set(['collections', 'concurrent', 'importlib', 'json', 'os', 'unittest', 'xml', 'email', 'logging', 'asyncio', 'urllib']);

export function isPackageName(n: string): boolean {
  return PKG_NAMES.has(n);
}

void PyObject;
void PyTuple;
void strType;
void typeError;
export type { Code };

/** importlib.reload: vuelve a ejecutar el código del módulo sobre el mismo objeto */
export function reloadModule(I: Interp, mod: PyModule): PyModule {
  const name = mod.name;
  const src = PYSRC[name];
  if (NATIVE[name] && !src) return mod;
  const d = mod.dict!;
  const file = d.get('__file__');
  let text: string;
  let filename: string;
  if (src) {
    text = src();
    filename = '<frozen ' + name + '>';
  } else if (typeof file === 'string' && I.vfs.isFile(file)) {
    text = decodeUtf8(I.vfs.readFile(file));
    filename = file;
  } else throw importError(`module ${name} not in sys.modules`, name);
  try {
    const unit = compileSource(I, text, { filename, hidden: !!src });
    runCode(I, unit.code, d);
  } catch (e) {
    if (e instanceof PySyntaxErr) throw syntaxErrToExc(e, filename, text);
    throw e;
  }
  return mod;
}
