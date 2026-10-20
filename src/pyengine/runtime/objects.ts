/**
 * Modelo de objetos del intérprete.
 *
 * Representación de valores de Python:
 *  - None → `null`;  bool → `boolean`;  int → `number` (entero seguro) o `bigint`;  str → `string`
 *  - float → PyFloat;  complex → PyComplex;  el resto → instancias de clases que cuelgan de PyObject.
 *  - `undefined` nunca es un valor de Python: marca "sin valor" (variable sin asignar, fin de iterador…).
 */
import type { Pos } from '../ast';
import { SetTable } from './settable';

// ───────────────────────── tipos ─────────────────────────

/** funciones que dependen de módulos que importan este (se inyectan al cargarlos para evitar ciclos de evaluación) */
export const HOOKS: { ckey: (k: any) => any; hashOf: (x: any) => number } = { ckey: undefined as any, hashOf: undefined as any };

let TYPE_VERSION = 1;
export function bumpTypeVersion(): void {
  TYPE_VERSION++;
}

const NOTFOUND = Symbol('notfound');

export class PyObject {
  cls: PyType;
  dict: PyDict | null = null;
  constructor(cls: PyType) {
    this.cls = cls;
  }
}

/** Indicadores de tipo */
export const F_BUILTIN = 1; // tipo inmutable del sistema
export const F_BASETYPE = 2; // se puede heredar
export const F_ABSTRACT = 4; // tiene métodos abstractos pendientes (se calcula al crear)
export const F_HEAP = 8; // creado por el usuario
export const F_INSTDICT = 16; // las instancias tienen __dict__

export class PyType extends PyObject {
  name: string;
  qualname: string;
  module = 'builtins';
  bases: PyType[];
  mro: PyType[] = [];
  flags = 0;
  /** reserva la instancia según la disposición del tipo base nativo */
  alloc: ((cls: PyType) => PyObject) | null = null;
  /** nombres permitidos si todas las clases declaran __slots__; null = sin restricción */
  slots: Set<string> | null = null;
  /** __slots__ declarado por esta clase */
  ownSlots: Set<string> | null = null;
  instDict = false;
  getattro: ((o: any, name: string) => any) | null = null;
  setattro: ((o: any, name: string, v: any) => void) | null = null;
  delattro: ((o: any, name: string) => void) | null = null;
  ownGetattro: ((o: any, name: string) => any) | null = null;
  ownSetattro: ((o: any, name: string, v: any) => void) | null = null;
  ownDelattro: ((o: any, name: string) => void) | null = null;
  doc: string | null = null;
  abstracts: Set<string> | null = null;
  private cache = new Map<string, any>();
  private cacheVer = 0;
  /** si el tipo (o un ancestro) define __getattr__, __getattribute__, __setattr__... se anota aquí */
  special: { getattr: boolean; getattribute: boolean; setattr: boolean; delattr: boolean } = { getattr: false, getattribute: false, setattr: false, delattr: false };
  subclasses: PyType[] = [];

  constructor(name: string, bases: PyType[], dictInit?: Record<string, any>, meta?: PyType) {
    super(meta as PyType);
    this.name = name;
    this.qualname = name;
    this.bases = bases;
    this.dict = new PyDict();
    if (dictInit) for (const k of Object.keys(dictInit)) this.dict.set(k, dictInit[k]);
  }

  /** (re)calcula el MRO por C3 y los indicadores derivados. Lanza TypeError si es inconsistente. */
  computeMro(): void {
    this.mro = c3(this);
    // un tipo nativo con `alloc` propio lo conserva; los demás lo heredan del primer tipo del MRO que lo tenga
    if (!(this.flags & F_BUILTIN)) this.alloc = null;
    for (const t of this.mro) {
      if (this.alloc) break;
      if (t.alloc) this.alloc = t.alloc;
    }
    this.special = { getattr: false, getattribute: false, setattr: false, delattr: false };
    for (const t of this.mro) {
      if (t.flags & F_BUILTIN) continue;
      const d = t.dict!.m;
      if (d.has('__getattr__')) this.special.getattr = true;
      if (d.has('__getattribute__')) this.special.getattribute = true;
      if (d.has('__setattr__')) this.special.setattr = true;
      if (d.has('__delattr__')) this.special.delattr = true;
    }
    // __slots__ solo restringe si TODOS los tipos (salvo object) lo declaran
    let allSlots = true;
    let sawHeapSlots = false;
    let hasDict = false;
    const names = new Set<string>();
    this.getattro = null;
    this.setattro = null;
    this.delattro = null;
    for (const t of this.mro) {
      if (this.getattro === null && t.ownGetattro !== null) this.getattro = t.ownGetattro;
      if (this.setattro === null && t.ownSetattro !== null) this.setattro = t.ownSetattro;
      if (this.delattro === null && t.ownDelattro !== null) this.delattro = t.ownDelattro;
      if (t.flags & F_INSTDICT) hasDict = true;
      if (t.name === 'object' && (t.flags & F_BUILTIN)) continue;
      if (t.flags & F_BUILTIN) continue; // los tipos nativos sin __dict__ no impiden restringir con __slots__
      if (!t.ownSlots) { allSlots = false; hasDict = true; continue; }
      sawHeapSlots = true;
      if (t.ownSlots.has('__dict__')) hasDict = true;
      for (const n of t.ownSlots) names.add(n);
    }
    this.slots = allSlots && sawHeapSlots && !hasDict && this.mro.length > 1 ? names : null;
    this.instDict = hasDict;
  }

  /** Búsqueda de un atributo en el MRO (sin descriptores). `undefined` si no existe. */
  lookup(name: string): any {
    if (this.cacheVer !== TYPE_VERSION) {
      this.cache.clear();
      this.cacheVer = TYPE_VERSION;
    }
    const c = this.cache.get(name);
    if (c !== undefined) return c === NOTFOUND ? undefined : c;
    const mro = this.mro;
    for (let i = 0; i < mro.length; i++) {
      const e = mro[i].dict!.m.get(name);
      if (e !== undefined) {
        this.cache.set(name, e.v);
        return e.v;
      }
    }
    this.cache.set(name, NOTFOUND);
    return undefined;
  }

  /** Tipo del MRO donde se define `name` (undefined si no está). */
  definer(name: string): PyType | undefined {
    for (const t of this.mro) if (t.dict!.m.has(name)) return t;
    return undefined;
  }

  /** ¿algún tipo del MRO tiene ese nombre cualificado (`módulo.nombre`)? Útil para ABCs registradas por nombre. */
  isSubtypeByName(qual: string): boolean {
    for (const t of this.mro) if (t.module + '.' + t.name === qual) return true;
    return false;
  }

  isSubtype(other: PyType): boolean {
    if (this === other) return true;
    const mro = this.mro;
    for (let i = 0; i < mro.length; i++) if (mro[i] === other) return true;
    return false;
  }
}

function c3(t: PyType): PyType[] {
  const seqs: PyType[][] = t.bases.map((b) => b.mro.slice());
  seqs.push(t.bases.slice());
  const result: PyType[] = [t];
  for (;;) {
    const nonEmpty = seqs.filter((s) => s.length > 0);
    if (nonEmpty.length === 0) return result;
    let cand: PyType | null = null;
    for (const s of nonEmpty) {
      const c = s[0];
      if (!nonEmpty.some((o) => o.indexOf(c) > 0)) { cand = c; break; }
    }
    if (!cand) {
      const e = new Error('MRO');
      (e as any).mroError = t.bases.map((b) => b.name).join(', ');
      throw e;
    }
    result.push(cand);
    for (const s of nonEmpty) if (s[0] === cand) s.shift();
  }
}

// ───────────────────────── celdas, marcos, código ─────────────────────────

export class Cell {
  v: any = undefined;
}

export type Ev = (f: Frame) => any;
/** 0/undefined = normal; 1 = break; 2 = continue; 3 = return (valor en f.ret) */
export type Ex = (f: Frame) => number | undefined;
export const SIG_BREAK = 1;
export const SIG_CONTINUE = 2;
export const SIG_RETURN = 3;

export interface Code {
  /** posiciones internadas para `tb_lasti` / `co_positions()` (índice 0 = sin posición) */
  /** generador marcado con types.coroutine (CO_ITERABLE_COROUTINE): se puede usar con await */
  iterCoro?: boolean;
  plist?: (Pos | null)[];
  pmap?: Map<Pos, number>;
  name: string;
  qualname: string;
  filename: string;
  firstLine: number;
  /** nombres de las variables locales por ranura */
  varnames: string[];
  nlocals: number;
  /** número de parámetros posicionales (con posonly), sin *args */
  argcount: number;
  posonlyCount: number;
  kwonlyCount: number;
  varargsSlot: number; // -1 si no hay
  varkwSlot: number;
  /** nombres de parámetros posicionales y kwonly en orden de ranura (slot = índice) */
  paramNames: string[];
  /** ranuras de parámetros que son celdas: [slot...] */
  cellParams: number[];
  /** ranuras de variables celda no parámetros (se crean vacías al entrar) */
  cellVars: number[];
  freeNames: string[];
  isGenerator: boolean;
  isCoroutine: boolean;
  isAsyncGen: boolean;
  /** cuerpo para funciones normales */
  body: Ex | null;
  /** cuerpo para generadores/corrutinas */
  genBody: ((f: Frame) => Generator<any, any, any>) | null;
  doc: string | null;
  /** parámetros "simples": solo posicionales, sin *args/**kw ni kwonly */
  simple: boolean;
  lines: string[];
  /** frames de esta función no se muestran en tracebacks (módulos de la librería estándar escritos en Python) */
  hidden: boolean;
  /** ranura donde guardar la celda __class__ para super() sin argumentos, -1 si no se usa */
  usesClassCell: boolean;
  /** índice de la variable libre __class__ (en freeNames) o -1 */
  classFree: number;
  /** módulo/class body: no tiene ranuras de parámetros */
  kind: 'module' | 'function' | 'class' | 'lambda' | 'genexp' | 'eval';
  /** el nombre de las variables libres que son celdas de clase: slot en el cuerpo de clase */
  classCellSlot: number;
  flagsStr?: string;
  /** comprensión inlinada en 3.12+: su marco no se muestra en tracebacks */
  inlined?: boolean;
}

export class Frame {
  l: any[];
  free: Cell[] | null;
  g: PyDict;
  ns: PyDict | null;
  code: Code;
  fn: PyFunction | null;
  /** nodo en ejecución (para tracebacks) */
  pos: Pos | null = null;
  ret: any = undefined;
  back: Frame | null;
  gen: PyGenerator | null = null;
  /** diccionario de builtins del módulo */
  b: PyDict;
  constructor(code: Code, l: any[], g: PyDict, b: PyDict, back: Frame | null, free: Cell[] | null, fn: PyFunction | null, ns: PyDict | null = null) {
    this.code = code;
    this.l = l;
    this.g = g;
    this.b = b;
    this.back = back;
    this.free = free;
    this.fn = fn;
    this.ns = ns;
  }
}

// ───────────────────────── escalares ─────────────────────────

export interface PyFloat {
  cls: PyType;
}
export class PyFloat {
  constructor(public v: number) {}
}

export interface PyComplex {
  cls: PyType;
}
export class PyComplex {
  constructor(public re: number, public im: number) {}
}

/** Instancia de una clase de usuario que hereda de int/str/float/bool (valor primitivo en `value`) */
export class PyBox extends PyObject {
  value: any;
  constructor(cls: PyType, value: any) {
    super(cls);
    this.value = value;
  }
}

// ───────────────────────── contenedores ─────────────────────────

export class PyList extends PyObject {
  a: any[];
  constructor(a: any[], cls?: PyType) {
    super(cls ?? LIST_TYPE_REF.t);
    this.a = a;
  }
}

export class PyTuple extends PyObject {
  a: any[];
  hash: number | undefined = undefined;
  constructor(a: any[], cls?: PyType) {
    super(cls ?? TUPLE_TYPE_REF.t);
    this.a = a;
  }
}

/** referencias tardías a los tipos base (se rellenan en types.ts para evitar dependencias circulares de carga) */
export const LIST_TYPE_REF: { t: PyType } = { t: undefined as any };
export const TUPLE_TYPE_REF: { t: PyType } = { t: undefined as any };
export const DICT_TYPE_REF: { t: PyType } = { t: undefined as any };
export const SET_TYPE_REF: { t: PyType } = { t: undefined as any };

export interface DEntry {
  k: any;
  v: any;
}

export class PyDict extends PyObject {
  m: Map<any, DEntry> = new Map();
  constructor(cls?: PyType) {
    super(cls ?? DICT_TYPE_REF.t);
  }
  get size(): number {
    return this.m.size;
  }
  /** valor o undefined */
  get(key: any): any {
    const e = this.m.get(typeof key === 'string' ? key : HOOKS.ckey(key));
    return e === undefined ? undefined : e.v;
  }
  has(key: any): boolean {
    return this.m.has(typeof key === 'string' ? key : HOOKS.ckey(key));
  }
  set(key: any, value: any): void {
    const ck = typeof key === 'string' ? key : HOOKS.ckey(key);
    const e = this.m.get(ck);
    if (e !== undefined) e.v = value;
    else this.m.set(ck, { k: key, v: value });
  }
  delete(key: any): boolean {
    return this.m.delete(typeof key === 'string' ? key : HOOKS.ckey(key));
  }
  clear(): void {
    this.m.clear();
  }
  keys(): any[] {
    const out: any[] = [];
    for (const e of this.m.values()) out.push(e.k);
    return out;
  }
  values(): any[] {
    const out: any[] = [];
    for (const e of this.m.values()) out.push(e.v);
    return out;
  }
  /** copia superficial (mismas claves y valores) */
  copyInto(other: PyDict): PyDict {
    for (const [ck, e] of this.m) other.m.set(ck, { k: e.k, v: e.v });
    return other;
  }
}

export class PySet extends PyObject {
  /** clave canónica → elemento (pertenencia) */
  m: Map<any, any> = new Map();
  /** disposición de la tabla de CPython (orden de iteración) */
  tbl: SetTable = new SetTable();
  frozen: boolean;
  hash: number | undefined = undefined;
  constructor(frozen: boolean, cls?: PyType) {
    super(cls ?? SET_TYPE_REF.t);
    this.frozen = frozen;
  }
  add(x: any): void {
    const ck = typeof x === 'string' ? x : HOOKS.ckey(x);
    if (!this.m.has(ck)) {
      this.m.set(ck, x);
      this.tbl.insert(HOOKS.hashOf(x), ck, x);
    }
  }
  has(x: any): boolean {
    return this.m.has(typeof x === 'string' ? x : HOOKS.ckey(x));
  }
  delete(x: any): boolean {
    const ck = typeof x === 'string' ? x : HOOKS.ckey(x);
    const v = this.m.get(ck);
    if (v === undefined && !this.m.has(ck)) return false;
    this.m.delete(ck);
    this.tbl.remove(HOOKS.hashOf(v), ck);
    return true;
  }
  clear(): void {
    this.m.clear();
    this.tbl.clear();
  }
  get size(): number {
    return this.m.size;
  }
  items(): any[] {
    return this.tbl.items();
  }
}

export class PyRange extends PyObject {
  /** start/stop/step como number o bigint (normalizados) */
  constructor(public start: any, public stop: any, public step: any, cls: PyType) {
    super(cls);
  }
}

export class PySlice extends PyObject {
  constructor(public start: any, public stop: any, public step: any, cls: PyType) {
    super(cls);
  }
}

export class PyBytes extends PyObject {
  constructor(public b: Uint8Array, cls: PyType) {
    super(cls);
  }
}
export class PyByteArray extends PyObject {
  constructor(public b: number[], cls: PyType) {
    super(cls);
  }
}

// ───────────────────────── callables ─────────────────────────

export class PyFunction extends PyObject {
  name: string;
  qualname: string;
  code: Code;
  globals: PyDict;
  builtins: PyDict;
  defaults: any[] | null;
  kwdefaults: Map<string, any> | null;
  closure: Cell[] | null;
  doc: any = null;
  module: any = null;
  annotations: PyDict | null = null;
  constructor(cls: PyType, code: Code, globals: PyDict, builtins: PyDict, defaults: any[] | null, kwdefaults: Map<string, any> | null, closure: Cell[] | null) {
    super(cls);
    this.code = code;
    this.name = code.name;
    this.qualname = code.qualname;
    this.globals = globals;
    this.builtins = builtins;
    this.defaults = defaults;
    this.kwdefaults = kwdefaults;
    this.closure = closure;
  }
}

export type Kw = Map<string, any>;

/** Función nativa. `fn(args, kw)` recibe los argumentos ya "crudos". */
export class NativeFunction extends PyObject {
  name: string;
  qualname: string;
  /** si es true, al acceder desde una instancia se enlaza (método); si no, se comporta como función estática */
  isMethod: boolean;
  /** objeto "self" para funciones enlazadas (builtin_function_or_method de un módulo/objeto) */
  self: any = undefined;
  doc: string | null = null;
  module: string | null = null;
  text: string | null = null; // firma para help()/inspect
  constructor(cls: PyType, name: string, public call: (args: any[], kw: Kw | null) => any, isMethod = false) {
    super(cls);
    this.name = name;
    this.qualname = name;
    this.isMethod = isMethod;
  }
}

export class BoundMethod extends PyObject {
  constructor(cls: PyType, public fn: any, public self: any) {
    super(cls);
  }
}

export class PyProperty extends PyObject {
  fget: any = null;
  fset: any = null;
  fdel: any = null;
  doc: any = null;
  name: string | null = null;
  /** tipo nativo que define este descriptor (getset_descriptor) */
  owner: PyType | null = null;
}

export class PyClassMethod extends PyObject {
  fn: any;
  constructor(cls: PyType, fn: any) {
    super(cls);
    this.fn = fn;
  }
}
export class PyStaticMethod extends PyObject {
  fn: any;
  constructor(cls: PyType, fn: any) {
    super(cls);
    this.fn = fn;
  }
}

export class PySuper extends PyObject {
  constructor(cls: PyType, public thisClass: PyType, public obj: any, public objType: PyType) {
    super(cls);
  }
}

export class PyModule extends PyObject {
  name: string;
  constructor(cls: PyType, name: string) {
    super(cls);
    this.name = name;
    this.dict = new PyDict();
  }
}

// ───────────────────────── excepciones ─────────────────────────

export interface TbEntry {
  code: Code;
  pos: Pos | null;
  /** línea de código (si el código no está en `code.lines`, p. ej. exec/eval) */
  text?: string;
  /** marco asociado (para traceback.tb_frame) */
  frame?: Frame | null;
}

export class PyBaseException extends PyObject {
  args: any[] = [];
  /** entradas del traceback (de la más interna a la más externa) */
  tb: TbEntry[] = [];
  cause: PyBaseException | null = null;
  context: PyBaseException | null = null;
  suppressContext = false;
  notes: string[] | null = null;
  /** marco por el que pasó por última vez (evita duplicar entradas de traceback) */
  lastFrame: Frame | null = null;
  /** SyntaxError etc.: datos adicionales */
  extra: any = null;
}

// ───────────────────────── generadores ─────────────────────────

export class PyGenerator extends PyObject {
  /** estado: 0 = sin empezar, 1 = suspendido, 2 = ejecutando, 3 = terminado */
  state = 0;
  retValue: any = null;
  js: Generator<any, any, any> | null = null;
  frame: Frame;
  name: string;
  qualname: string;
  /** valor pendiente para la primera reanudación */
  constructor(cls: PyType, frame: Frame, name: string, qualname: string) {
    super(cls);
    this.frame = frame;
    this.name = name;
    this.qualname = qualname;
  }
}

/** Iterador nativo genérico: `next()` devuelve `undefined` al terminar */
export abstract class PyIter extends PyObject {
  abstract next(): any;
}

export class PyTraceback extends PyObject {
  constructor(cls: PyType, public entry: TbEntry, public nextTb: PyTraceback | null) {
    super(cls);
  }
}

/** valor cedido por `yield` dentro de un generador asíncrono (los `await` ceden valores sin envolver) */
export class AGYield {
  constructor(public v: any) {}
}
