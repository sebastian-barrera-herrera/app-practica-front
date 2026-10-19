/**
 * Definición cómoda de funciones nativas con firma tipo Python.
 *
 * Sintaxis de `sig`: "a, b=, /, *args, c=, **kw". Un `=` final marca el parámetro como opcional (llega `undefined`
 * si no se pasó). `/` cierra los solo-posicionales; `*` o `*nombre` abre los solo-keyword.
 * La implementación recibe los parámetros en orden (primero posicionales, luego varargs, luego kwonly, luego **kw).
 */
import { NativeFunction, PyDict, PyProperty, PyTuple, PyType, type Kw } from './objects';
import { nativeFunctionType, propertyType } from './builtin_types';
import { typeError } from './errors';

export interface ParsedSig {
  names: string[]; // posicionales (con self si es método)
  required: number;
  posonly: number;
  varargs: boolean;
  kwonly: string[];
  kwonlyRequired: boolean[];
  varkw: boolean;
}

export function parseSig(sig: string): ParsedSig {
  const r: ParsedSig = { names: [], required: 0, posonly: 0, varargs: false, kwonly: [], kwonlyRequired: [], varkw: false };
  if (sig.trim() === '') return r;
  let afterStar = false;
  let seenOptional = false;
  for (let part of sig.split(',')) {
    part = part.trim();
    if (part === '/') { r.posonly = r.names.length; continue; }
    if (part === '*') { afterStar = true; continue; }
    if (part.startsWith('**')) { r.varkw = true; continue; }
    if (part.startsWith('*')) { r.varargs = true; afterStar = true; continue; }
    // `nombre=` o `nombre=valor` (el valor es solo documentación: llega `undefined` si no se pasó)
    const eq = part.indexOf('=');
    const opt = eq >= 0;
    const name = opt ? part.slice(0, eq) : part;
    if (afterStar) {
      r.kwonly.push(name);
      r.kwonlyRequired.push(!opt);
    } else {
      r.names.push(name);
      if (!opt && !seenOptional) r.required = r.names.length;
      if (opt) seenOptional = true;
    }
  }
  return r;
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

export interface NativeOpts {
  method?: boolean;
  /** nombre del tipo dueño, para mensajes: "list.append() ..." */
  owner?: string;
  doc?: string;
  module?: string;
  /** estilo de mensaje cuando sobran/faltan argumentos */
  style?: 'o' | 'clinic' | 'fast';
}

export function mkNative(name: string, sig: string, impl: (...a: any[]) => any, opts: NativeOpts = {}): NativeFunction {
  const ps = parseSig(sig);
  const isMethod = !!opts.method;
  const nPos = ps.names.length;
  const hasKwonly = ps.kwonly.length > 0;
  const simple = !ps.varargs && !hasKwonly && !ps.varkw;
  const shown = opts.owner ? `${opts.owner}.${name}` : name;
  const countOffset = isMethod ? 1 : 0;
  const maxArgs = nPos - countOffset;
  const minArgs = ps.required - countOffset;

  const arityError = (given: number): never => {
    const g = given - countOffset;
    if (maxArgs === minArgs) {
      if (maxArgs === 1 && (opts.style ?? 'o') === 'o') throw typeError(`${shown}() takes exactly one argument (${g} given)`);
      if (opts.style === 'fast' || isMethod) throw typeError(`${shown}() takes ${maxArgs === 0 ? 'no arguments' : `exactly ${maxArgs} argument${plural(maxArgs)}`} (${g} given)`);
      throw typeError(`${name} expected ${maxArgs} argument${plural(maxArgs)}, got ${g}`);
    }
    if (g > maxArgs) {
      if (opts.style === 'fast' || isMethod) throw typeError(`${shown}() takes at most ${maxArgs} argument${plural(maxArgs)} (${g} given)`);
      throw typeError(`${name} expected at most ${maxArgs} argument${plural(maxArgs)}, got ${g}`);
    }
    if (opts.style === 'fast' || isMethod) throw typeError(`${shown}() takes at least ${minArgs} argument${plural(minArgs)} (${g} given)`);
    throw typeError(`${name} expected at least ${minArgs} argument${plural(minArgs)}, got ${g}`);
  };

  const call = (args: any[], kw: Kw | null): any => {
    const n = args.length;
    if (simple && (kw === null || kw.size === 0)) {
      if (n > nPos || n < ps.required) arityError(n);
      switch (n) {
        case 0: return impl();
        case 1: return impl(args[0]);
        case 2: return impl(args[0], args[1]);
        case 3: return impl(args[0], args[1], args[2]);
        case 4: return impl(args[0], args[1], args[2], args[3]);
        default: return impl(...args);
      }
    }
    // enlace general
    const out: any[] = new Array(nPos + (ps.varargs ? 1 : 0) + ps.kwonly.length + (ps.varkw ? 1 : 0));
    let varkw: PyDict | null = null;
    if (n > nPos && !ps.varargs) arityError(n);
    for (let i = 0; i < nPos && i < n; i++) out[i] = args[i];
    let idx = nPos;
    if (ps.varargs) {
      out[idx] = new PyTuple(n > nPos ? args.slice(nPos) : []);
      idx++;
    }
    const kwBase = idx;
    if (ps.varkw) varkw = new PyDict();
    if (kw !== null) {
      for (const [k, v] of kw) {
        let pi = -1;
        for (let i = ps.posonly; i < nPos; i++) if (ps.names[i] === k) { pi = i; break; }
        if (pi >= 0) {
          if (out[pi] !== undefined && pi < n) throw typeError(`${shown}() got multiple values for argument '${k}'`);
          out[pi] = v;
          continue;
        }
        const ki = ps.kwonly.indexOf(k);
        if (ki >= 0) { out[kwBase + ki] = v; continue; }
        if (varkw !== null) { varkw.set(k, v); continue; }
        throw typeError(`${shown}() got an unexpected keyword argument '${k}'`);
      }
    }
    for (let i = 0; i < ps.required; i++) {
      if (out[i] === undefined) {
        if (i < n) continue;
        if (i < countOffset) arityError(n);
        throw typeError(`${shown}() missing required argument '${ps.names[i]}' (pos ${i + 1 - countOffset})`);
      }
    }
    for (let i = 0; i < ps.kwonly.length; i++) {
      if (ps.kwonlyRequired[i] && out[kwBase + i] === undefined) throw typeError(`${shown}() missing required keyword-only argument '${ps.kwonly[i]}'`);
    }
    if (varkw !== null) out[kwBase + ps.kwonly.length] = varkw;
    return impl(...out);
  };
  const f = new NativeFunction(nativeFunctionType, name, call, isMethod);
  f.qualname = opts.owner ? `${opts.owner}.${name}` : name;
  if (opts.doc) f.doc = opts.doc;
  if (opts.module) f.module = opts.module;
  f.text = sig;
  return f;
}

type MethodSpec = [string, (...a: any[]) => any] | ((...a: any[]) => any);

/** Registra métodos en el diccionario de un tipo: `{ nombre: ['self, x=', fn] }` */
export function defMethods(t: PyType, specs: Record<string, MethodSpec>): void {
  for (const k of Object.keys(specs)) {
    const sp = specs[k];
    const [sig, fn] = Array.isArray(sp) ? sp : ['self', sp];
    t.dict!.set(k, mkNative(k, sig, fn, { method: true, owner: t.name }));
  }
}

/** Función libre nativa (builtins y funciones de módulo) */
export function fn(name: string, sig: string, impl: (...a: any[]) => any, opts: NativeOpts = {}): NativeFunction {
  return mkNative(name, sig, impl, opts);
}

/** propiedad de solo lectura (o lectura/escritura) implementada en TS */
export function defGetter(t: PyType, name: string, get: (self: any) => any, set?: (self: any, v: any) => void): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', get, { method: true });
  if (set) p.fset = mkNative(name, 'self, value', set, { method: true });
  t.dict!.set(name, p);
}
