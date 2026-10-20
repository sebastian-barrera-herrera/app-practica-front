/**
 * Compilador AST → closures: expresiones y estado de compilación compartido.
 * Cada nodo se convierte en una función `(f: Frame) => valor`; los nombres se resuelven en tiempo de compilación
 * a ranuras de locales, celdas, variables libres o diccionarios de globals.
 */
import type {
  Arguments, Attribute, BinOp, BoolOp, Call, Compare, Constant, Expr, FormattedValue, JoinedStr, Name, Pos, Stmt, Subscript,
} from './ast';
import { PySyntaxErr } from './lexer';
import { Scope, type ScopeTable } from './scope';
import {
  Cell, Frame, NativeFunction, PyBytes, PyComplex, PyDict, PyFloat, PyFunction, PyList, PyObject, PySet, PyTuple, PyType,
  PyGenerator, SIG_RETURN, type Code, type Ev, type Ex, type Kw, PyBaseException,
} from './runtime/objects';
import { Ellipsis } from './runtime/builtin_types';
import { E } from './runtime/exc_types';
import { bytesType, dictType, functionType, listType, tupleType, typeOf, Ellipsis as EllipsisV } from './runtime/builtin_types';
import { Interp } from './runtime/interp';
import * as ops from './runtime/ops';
import * as rt from './runtime/rt';
import { callFunction, callObj } from './runtime/call';
import { MAXS } from './runtime/numeric';
import { nameError, typeError, StepLimit } from './runtime/errors';
import { repr as reprOf } from './runtime/ops';
import { asciiOf } from './runtime/fmt';

void Ellipsis;
void EllipsisV;

export type Setter = (f: Frame, v: any) => void;

/** estado de compilación de un ámbito (función, clase, módulo) */
export class FnState {
  slots = new Map<string, number>();
  varnames: string[] = [];
  freeIdx = new Map<string, number>();
  loopDepth = 0;
  isGen = false;
  isAsync = false;
  /** dentro de un `finally` o similar */
  inFinally = 0;
  constructor(public scope: Scope, public kind: Code['kind']) {}
  slot(name: string): number {
    let s = this.slots.get(name);
    if (s === undefined) {
      s = this.varnames.length;
      this.slots.set(name, s);
      this.varnames.push(name);
    }
    return s;
  }
  temp(): number {
    const s = this.varnames.length;
    this.varnames.push('.t' + s);
    return s;
  }
}

let selfSlot: any = undefined;

/** Carga un método evitando crear el objeto método enlazado; deja `self` en selfSlot si hay que pasarlo */
export function loadMethod(o: any, name: string): any {
  const t = typeOf(o);
  if (t.getattro === null && !t.special.getattribute) {
    const d = t.lookup(name);
    if (d !== undefined && (d instanceof PyFunction || (d instanceof NativeFunction && d.isMethod))) {
      if (!(o instanceof PyObject && o.dict !== null && o.dict.m.has(name))) {
        selfSlot = o;
        return d;
      }
    }
  }
  selfSlot = undefined;
  return ops.getAttr(o, name);
}
export function takeSelf(): any {
  const s = selfSlot;
  selfSlot = undefined;
  return s;
}

export function pyConst(c: Constant): any {
  switch (c.vt) {
    case 'int': return c.value;
    case 'float': return new PyFloat(c.value as number);
    case 'complex': return new PyComplex(0, c.value as number);
    case 'str': return c.value;
    case 'bytes': return new PyBytes(c.value as Uint8Array, bytesType);
    case 'bool': return c.value;
    case 'none': return null;
    case 'ellipsis': return EllipsisV;
  }
}

export interface CompileEnv {
  I: Interp;
  filename: string;
  lines: string[];
  table: ScopeTable;
  hidden: boolean;
  futureAnnotations: boolean;
  replMode: boolean;
  /** compile(..., 'single'): las expresiones sueltas llaman a sys.displayhook */
  singleMode?: boolean;
}

export function posOf(n: Pos): Pos {
  return n;
}

export abstract class ExprCompiler {
  I: Interp;
  filename: string;
  lines: string[];
  table: ScopeTable;
  hidden: boolean;
  futureAnnotations: boolean;
  replMode: boolean;
  singleMode: boolean;
  fs!: FnState;
  qualStack: string[] = [];

  constructor(env: CompileEnv) {
    this.I = env.I;
    this.filename = env.filename;
    this.lines = env.lines;
    this.table = env.table;
    this.hidden = env.hidden;
    this.futureAnnotations = env.futureAnnotations;
    this.replMode = env.replMode;
    this.singleMode = !!env.singleMode;
  }

  get scope(): Scope {
    return this.fs.scope;
  }

  syntaxError(msg: string, p: Pos): never {
    throw new PySyntaxErr('SyntaxError', msg, p.line, p.col, p.endLine, p.endCol);
  }

  abstract compileFunctionLike(node: any, scope: Scope, name: string, qualname: string): { code: Code; freeNames: string[] };
  abstract stmtBlock(list: Stmt[]): Ex;
  abstract compComprehension(n: any): Ev;
  abstract awaitExpr(n: any): Ev;
  abstract yieldExpr(n: any): Ev;

  // ───────────── nombres ─────────────

  loadName(n: Name): Ev {
    const name = n.id;
    const sc = this.scope;
    const res = sc.resolve(name);
    const fs = this.fs;
    switch (res) {
      case 'local': {
        const i = fs.slot(name);
        return (f) => {
          const v = f.l[i];
          if (v === undefined) { f.pos = n; throw rt.unboundLocal(name); }
          return v;
        };
      }
      case 'cell': {
        const i = fs.slot(name);
        return (f) => {
          const v = f.l[i].v;
          if (v === undefined) { f.pos = n; throw name === '__class__' ? nameError(name) : rt.unboundFree(name); }
          return v;
        };
      }
      case 'free': {
        const j = this.freeIndex(name);
        return (f) => {
          const v = f.free![j].v;
          if (v === undefined) { f.pos = n; throw rt.unboundFree(name); }
          return v;
        };
      }
      case 'global':
        return (f) => {
          let e = f.g.m.get(name);
          if (e !== undefined) return e.v;
          e = f.b.m.get(name);
          if (e !== undefined) return e.v;
          f.pos = n;
          throw nameError(name);
        };
      default: {
        // espacio de nombres (clase / módulo)
        if (fs.kind === 'class') {
          return (f) => {
            if (f.ns!.cls !== dictType) {
              // espacio de nombres personalizado (p. ej. `_EnumDict`): se respeta __getitem__
              try {
                return ops.getitem(f.ns, name);
              } catch (err) {
                if (!(err instanceof PyBaseException && ops.isInstance(err, E.KeyError))) throw err;
              }
            }
            let e = f.ns!.m.get(name);
            if (e !== undefined) return e.v;
            e = f.g.m.get(name);
            if (e !== undefined) return e.v;
            e = f.b.m.get(name);
            if (e !== undefined) return e.v;
            f.pos = n;
            throw nameError(name);
          };
        }
        return (f) => {
          const ns = f.ns;
          if (ns !== f.g && ns !== null) {
            // exec(código, globales, locales) con diccionarios distintos
            const le = ns.m.get(name);
            if (le !== undefined) return le.v;
          }
          let e = f.g.m.get(name);
          if (e !== undefined) return e.v;
          e = f.b.m.get(name);
          if (e !== undefined) return e.v;
          f.pos = n;
          throw nameError(name);
        };
      }
    }
  }

  freeIndex(name: string): number {
    const i = this.fs.freeIdx.get(name);
    if (i === undefined) throw new Error('variable libre sin índice: ' + name);
    return i;
  }

  storeName(name: string, p: Pos): Setter {
    const sc = this.scope;
    const res = sc.resolve(name);
    const fs = this.fs;
    void p;
    switch (res) {
      case 'local': {
        const i = fs.slot(name);
        return (f, v) => { f.l[i] = v; };
      }
      case 'cell': {
        const i = fs.slot(name);
        return (f, v) => { f.l[i].v = v; };
      }
      case 'free': {
        const j = this.freeIndex(name);
        return (f, v) => { f.free![j].v = v; };
      }
      case 'global':
        return (f, v) => {
          const e = f.g.m.get(name);
          if (e !== undefined) e.v = v;
          else f.g.m.set(name, { k: name, v });
        };
      default:
        if (fs.kind === 'class') {
          return (f, v) => {
            const d = f.ns!;
            if (d.cls !== dictType) {
              ops.setitem(d, name, v);
              return;
            }
            const e = d.m.get(name);
            if (e !== undefined) e.v = v;
            else d.m.set(name, { k: name, v });
          };
        }
        return (f, v) => {
          const d = f.ns !== null && f.fn === null && f.code.kind !== 'function' && f.code.kind !== 'lambda' && f.code.kind !== 'genexp' ? f.ns : f.g;
          const e = d.m.get(name);
          if (e !== undefined) e.v = v;
          else d.m.set(name, { k: name, v });
        };
    }
  }

  deleteName(n: Name): (f: Frame) => void {
    const name = n.id;
    const res = this.scope.resolve(name);
    const fs = this.fs;
    switch (res) {
      case 'local': {
        const i = fs.slot(name);
        return (f) => {
          if (f.l[i] === undefined) { f.pos = n; throw rt.unboundLocal(name); }
          f.l[i] = undefined;
        };
      }
      case 'cell': {
        const i = fs.slot(name);
        return (f) => {
          if (f.l[i].v === undefined) { f.pos = n; throw rt.unboundFree(name); }
          f.l[i].v = undefined;
        };
      }
      case 'free': {
        const j = this.freeIndex(name);
        return (f) => {
          if (f.free![j].v === undefined) { f.pos = n; throw rt.unboundFree(name); }
          f.free![j].v = undefined;
        };
      }
      default: {
        const isClass = fs.kind === 'class' && res === 'name';
        return (f) => {
          const d = isClass ? f.ns! : fs.kind === 'module' && f.ns !== null ? f.ns : f.g;
          if (isClass && d.cls !== dictType) {
            try {
              ops.delitem(d, name);
            } catch (err) {
              if (err instanceof PyBaseException && ops.isInstance(err, E.KeyError)) { f.pos = n; throw nameError(name); }
              throw err;
            }
            return;
          }
          if (!d.m.delete(name)) { f.pos = n; throw nameError(name); }
        };
      }
    }
  }

  // ───────────── expresiones ─────────────

  expr(n: Expr): Ev {
    if ((n as any).k === 'TempRef') {
      const slot = (n as any).slot as number;
      return (f) => f.l[slot];
    }
    switch (n.k) {
      case 'Constant': {
        const v = pyConst(n);
        return () => v;
      }
      case 'Name': return this.loadName(n);
      case 'BinOp': return this.binop(n);
      case 'UnaryOp': return this.unary(n);
      case 'BoolOp': return this.boolop(n);
      case 'Compare': return this.compare(n);
      case 'Call': return this.call(n);
      case 'Attribute': return this.attribute(n);
      case 'Subscript': return this.subscript(n);
      case 'IfExp': {
        const t = this.cond(n.test);
        const a = this.expr(n.body);
        const b = this.expr(n.orelse);
        return (f) => (t(f) ? a(f) : b(f));
      }
      case 'Tuple': return this.tuple(n);
      case 'List': return this.list(n);
      case 'Set': return this.setDisplay(n);
      case 'Dict': return this.dictDisplay(n);
      case 'Lambda': return this.lambda(n);
      case 'JoinedStr': return this.joinedStr(n);
      case 'FormattedValue': return this.formattedValue(n);
      case 'Slice': {
        const lo = n.lower ? this.expr(n.lower) : null;
        const hi = n.upper ? this.expr(n.upper) : null;
        const st = n.step ? this.expr(n.step) : null;
        return (f) => ops.makeSlice(lo ? lo(f) : null, hi ? hi(f) : null, st ? st(f) : null);
      }
      case 'NamedExpr': {
        const val = this.expr(n.value);
        const set = this.storeName(n.target.id, n.target);
        return (f) => {
          const v = val(f);
          set(f, v);
          return v;
        };
      }
      case 'ListComp': case 'SetComp': case 'DictComp': case 'GeneratorExp':
        return this.compComprehension(n);
      case 'Await': return this.awaitExpr(n);
      case 'Yield': case 'YieldFrom': return this.yieldExpr(n);
      case 'Starred':
        this.syntaxError("can't use starred expression here", n);
    }
  }

  /** condición booleana de JS */
  cond(n: Expr): (f: Frame) => boolean {
    if (n.k === 'UnaryOp' && n.op === 'not') {
      const e = this.cond(n.operand);
      return (f) => !e(f);
    }
    if (n.k === 'Constant') {
      const b = ops.truthy(pyConst(n));
      return () => b;
    }
    if (n.k === 'BoolOp') {
      const parts = n.values.map((v) => this.cond(v));
      if (n.op === 'and') {
        if (parts.length === 2) { const [a, b] = parts; return (f) => a(f) && b(f); }
        return (f) => { for (let i = 0; i < parts.length; i++) if (!parts[i](f)) return false; return true; };
      }
      if (parts.length === 2) { const [a, b] = parts; return (f) => a(f) || b(f); }
      return (f) => { for (let i = 0; i < parts.length; i++) if (parts[i](f)) return true; return false; };
    }
    const e = this.expr(n);
    return (f) => {
      const v = e(f);
      if (v === true) return true;
      if (v === false) return false;
      return ops.truthy(v);
    };
  }

  binop(n: BinOp): Ev {
    // plegado de constantes numéricas seguras
    const l = this.expr(n.left);
    const r = this.expr(n.right);
    const op = n.op;
    const fn = ops.BINOPS[op];
    switch (op) {
      case '+':
        return (f) => {
          const a = l(f);
          const b = r(f);
          if (typeof a === 'number' && typeof b === 'number') {
            const x = a + b;
            if (x <= MAXS && x >= -MAXS) return x;
          }
          f.pos = n;
          return ops.opAdd(a, b);
        };
      case '-':
        return (f) => {
          const a = l(f);
          const b = r(f);
          if (typeof a === 'number' && typeof b === 'number') {
            const x = a - b;
            if (x <= MAXS && x >= -MAXS) return x;
          }
          f.pos = n;
          return ops.opSub(a, b);
        };
      case '*':
        return (f) => {
          const a = l(f);
          const b = r(f);
          if (typeof a === 'number' && typeof b === 'number') {
            const x = a * b;
            if (x <= MAXS && x >= -MAXS) return x === 0 ? 0 : x;
          }
          f.pos = n;
          return ops.opMul(a, b);
        };
      case '%':
        return (f) => {
          const a = l(f);
          const b = r(f);
          if (typeof a === 'number' && typeof b === 'number' && b !== 0) {
            let m = a % b;
            if (m !== 0 && (m < 0) !== (b < 0)) m += b;
            return m === 0 ? 0 : m;
          }
          f.pos = n;
          return ops.opMod(a, b);
        };
      default:
        return (f) => {
          const a = l(f);
          const b = r(f);
          f.pos = n;
          return fn(a, b);
        };
    }
  }

  unary(n: Expr & { k: 'UnaryOp' }): Ev {
    const e = this.expr(n.operand);
    switch (n.op) {
      case 'not': return (f) => !ops.truthy(e(f));
      case '-': {
        if (n.operand.k === 'Constant' && (n.operand.vt === 'int' || n.operand.vt === 'float')) {
          const v = ops.unaryNeg(pyConst(n.operand));
          return () => v;
        }
        return (f) => {
          const v = e(f);
          if (typeof v === 'number') return v === 0 ? 0 : -v;
          f.pos = n;
          return ops.unaryNeg(v);
        };
      }
      case '+': return (f) => { const v = e(f); f.pos = n; return ops.unaryPos(v); };
      default: return (f) => { const v = e(f); f.pos = n; return ops.unaryInvert(v); };
    }
  }

  boolop(n: BoolOp): Ev {
    const parts = n.values.map((v) => this.expr(v));
    if (n.op === 'and') {
      if (parts.length === 2) {
        const [a, b] = parts;
        return (f) => { const v = a(f); return v === false || (v !== true && !ops.truthy(v)) ? v : b(f); };
      }
      return (f) => {
        let v: any = null;
        for (let i = 0; i < parts.length; i++) { v = parts[i](f); if (!ops.truthy(v)) return v; }
        return v;
      };
    }
    if (parts.length === 2) {
      const [a, b] = parts;
      return (f) => { const v = a(f); return v === true || (v !== false && ops.truthy(v)) ? v : b(f); };
    }
    return (f) => {
      let v: any = null;
      for (let i = 0; i < parts.length; i++) { v = parts[i](f); if (ops.truthy(v)) return v; }
      return v;
    };
  }

  compare(n: Compare): Ev {
    const l = this.expr(n.left);
    const rs = n.comparators.map((c) => this.expr(c));
    const cmpOne = (op: string, nodePos: Pos): ((f: Frame, a: any, b: any) => any) => {
      switch (op) {
        case 'is': return (_f, a, b) => a === b;
        case 'is not': return (_f, a, b) => a !== b;
        case 'in': return (f, a, b) => { f.pos = nodePos; return ops.contains(b, a); };
        case 'not in': return (f, a, b) => { f.pos = nodePos; return !ops.contains(b, a); };
        case '==': return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a === b;
          if (typeof a === 'string' && typeof b === 'string') return a === b;
          f.pos = nodePos;
          return ops.richCompare('==', a, b);
        };
        case '!=': return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a !== b;
          if (typeof a === 'string' && typeof b === 'string') return a !== b;
          f.pos = nodePos;
          return ops.richCompare('!=', a, b);
        };
        case '<': return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a < b;
          f.pos = nodePos;
          return ops.richCompare('<', a, b);
        };
        case '<=': return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a <= b;
          f.pos = nodePos;
          return ops.richCompare('<=', a, b);
        };
        case '>': return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a > b;
          f.pos = nodePos;
          return ops.richCompare('>', a, b);
        };
        default: return (f, a, b) => {
          if (typeof a === 'number' && typeof b === 'number') return a >= b;
          f.pos = nodePos;
          return ops.richCompare('>=', a, b);
        };
      }
    };
    if (n.ops.length === 1) {
      const r = rs[0];
      const op = n.ops[0];
      const c = cmpOne(op, n);
      return (f) => {
        const a = l(f);
        const b = r(f);
        return c(f, a, b);
      };
    }
    const cs = n.ops.map((op) => cmpOne(op, n));
    return (f) => {
      let a = l(f);
      let res: any = true;
      for (let i = 0; i < rs.length; i++) {
        const b = rs[i](f);
        res = cs[i](f, a, b);
        if (res === false || (res !== true && !ops.truthy(res))) return res;
        a = b;
      }
      return res;
    };
  }

  attribute(n: Attribute): Ev {
    const o = this.expr(n.value);
    const name = n.attr;
    return (f) => {
      const v = o(f);
      f.pos = n;
      return ops.getAttr(v, name);
    };
  }

  subscript(n: Subscript): Ev {
    const o = this.expr(n.value);
    const k = this.expr(n.slice);
    return (f) => {
      const v = o(f);
      const key = k(f);
      f.pos = n;
      return ops.getitem(v, key);
    };
  }

  tuple(n: Expr & { k: 'Tuple' }): Ev {
    const hasStar = n.elts.some((e) => e.k === 'Starred');
    if (n.elts.length === 0) {
      const t = new PyTuple([]);
      return () => t;
    }
    if (!hasStar && n.elts.every((e) => e.k === 'Constant')) {
      const t = new PyTuple(n.elts.map((e) => pyConst(e as Constant)));
      return () => t;
    }
    const items = this.seqItems(n.elts);
    if (!hasStar) {
      const evs = n.elts.map((e) => this.expr(e));
      switch (evs.length) {
        case 1: { const [a] = evs; return (f) => new PyTuple([a(f)]); }
        case 2: { const [a, b] = evs; return (f) => new PyTuple([a(f), b(f)]); }
        case 3: { const [a, b, c] = evs; return (f) => new PyTuple([a(f), b(f), c(f)]); }
        default: return (f) => { const out = new Array(evs.length); for (let i = 0; i < evs.length; i++) out[i] = evs[i](f); return new PyTuple(out); };
      }
    }
    return (f) => new PyTuple(items(f));
  }

  /** evalúa una lista de elementos con posibles `*x` */
  seqItems(elts: Expr[]): (f: Frame) => any[] {
    const parts = elts.map((e) => (e.k === 'Starred' ? { star: true, ev: this.expr(e.value), node: e } : { star: false, ev: this.expr(e), node: e }));
    if (!parts.some((p) => p.star)) {
      return (f) => { const out = new Array(parts.length); for (let i = 0; i < parts.length; i++) out[i] = parts[i].ev(f); return out; };
    }
    return (f) => {
      const out: any[] = [];
      for (const p of parts) {
        if (p.star) {
          const v = p.ev(f);
          f.pos = p.node;
          if (v instanceof PyList || v instanceof PyTuple) { for (const x of v.a) out.push(x); }
          else for (const x of ops.iterToArray(v)) out.push(x);
        } else out.push(p.ev(f));
      }
      return out;
    };
  }

  list(n: Expr & { k: 'List' }): Ev {
    const items = this.seqItems(n.elts);
    if (n.elts.length === 0) return () => new PyList([]);
    return (f) => new PyList(items(f));
  }

  setDisplay(n: Expr & { k: 'Set' }): Ev {
    const items = this.seqItems(n.elts);
    return (f) => {
      f.pos = n;
      const s = new PySet(false);
      for (const x of items(f)) s.add(x);
      return s;
    };
  }

  dictDisplay(n: Expr & { k: 'Dict' }): Ev {
    const parts = n.values.map((v, i) => ({ k: n.keys[i] ? this.expr(n.keys[i]!) : null, v: this.expr(v) }));
    return (f) => {
      const d = new PyDict();
      for (const p of parts) {
        if (p.k === null) {
          const m = p.v(f);
          f.pos = n;
          if (m instanceof PyDict) { for (const e of m.m.values()) d.set(e.k, e.v); }
          else {
            const keysf = typeOf(m).lookup('keys');
            if (keysf === undefined) throw typeError(`'${typeOf(m).name}' object is not a mapping`);
            for (const key of ops.iterToArray(callObj(keysf, [m]))) d.set(key, ops.getitem(m, key));
          }
        } else {
          const key = p.k(f);
          const val = p.v(f);
          f.pos = n;
          d.set(key, val);
        }
      }
      return d;
    };
  }

  joinedStr(n: JoinedStr): Ev {
    const parts = n.values.map((v) => {
      if (v.k === 'Constant') {
        const s = v.value as string;
        return () => s;
      }
      return this.formattedValueStr(v as FormattedValue);
    });
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) { const [a, b] = parts; return (f) => a(f) + b(f); }
    return (f) => {
      let s = '';
      for (let i = 0; i < parts.length; i++) s += parts[i](f);
      return s;
    };
  }

  formattedValue(n: FormattedValue): Ev {
    return this.formattedValueStr(n);
  }

  formattedValueStr(n: FormattedValue): (f: Frame) => string {
    const ev = this.expr(n.value);
    const conv = n.conversion;
    const spec = n.formatSpec ? this.joinedStr(n.formatSpec) : null;
    return (f) => {
      let v = ev(f);
      f.pos = n.value;
      if (conv === 115) v = ops.str(v);
      else if (conv === 114) v = ops.repr(v);
      else if (conv === 97) v = ops.ascii(v);
      const sp = spec === null ? '' : spec(f);
      if (typeof v === 'string' && sp === '') return v;
      f.pos = n;
      return ops.formatValue(v, sp);
    };
  }

  lambda(n: Expr & { k: 'Lambda' }): Ev {
    const sc = this.table.byNode.get(n)!;
    return this.makeFunctionExpr(n, sc, '<lambda>', n.args, null);
  }

  /** crea el closure que construye un PyFunction a partir de un nodo def/lambda */
  makeFunctionExpr(node: any, sc: Scope, name: string, args: Arguments, annotationsEv: ((f: Frame) => PyDict | null) | null): Ev {
    const qualname = this.qualnameFor(name);
    const { code, freeNames } = this.compileFunctionLike(node, sc, name, qualname);
    const defaults = args.defaults.map((d) => this.expr(d));
    const kwDefs = args.kwonlyargs.map((a, i) => ({ name: a.arg, ev: args.kwDefaults[i] ? this.expr(args.kwDefaults[i]!) : null }));
    const getCells = this.closureBuilder(freeNames);
    const hasKwDefs = kwDefs.some((k) => k.ev !== null);
    return (f) => {
      const dv = defaults.length > 0 ? defaults.map((d) => d(f)) : null;
      let kwd: Map<string, any> | null = null;
      if (hasKwDefs) {
        kwd = new Map();
        for (const k of kwDefs) if (k.ev) kwd.set(k.name, k.ev(f));
      }
      const fn = new PyFunction(functionType, code, f.g, f.b, dv, kwd, getCells ? getCells(f) : null);
      const mod = f.g.m.get('__name__');
      fn.module = mod === undefined ? null : mod.v;
      fn.qualname = qualname;
      if (annotationsEv) fn.annotations = annotationsEv(f);
      return fn;
    };
  }

  qualnameFor(name: string): string {
    const sc = this.scope;
    if (sc.kind === 'module' || sc.kind === 'eval') return name;
    const parent = this.qualStack.length > 0 ? this.qualStack[this.qualStack.length - 1] : '';
    if (sc.kind === 'class') return parent + '.' + name;
    return parent + '.<locals>.' + name;
  }

  /** obtiene, desde el marco actual, las celdas que necesita un ámbito interior (en el orden de freeNames) */
  closureBuilder(freeNames: string[]): ((f: Frame) => Cell[]) | null {
    if (freeNames.length === 0) return null;
    const sc = this.scope;
    const getters: ((f: Frame) => Cell)[] = freeNames.map((n) => {
      const r = n === '__class__' && sc.kind === 'class' ? 'cell' : sc.resolve(n);
      if (r === 'cell' || (sc.kind === 'class' && n === '__class__')) {
        const i = this.fs.slot(n === '__class__' ? '__class__' : n);
        return (f) => f.l[i] as Cell;
      }
      if (r === 'free') {
        const j = this.freeIndex(n);
        return (f) => f.free![j];
      }
      // el ámbito actual no es el dueño: no debería ocurrir
      throw new Error(`no se puede capturar '${n}' (${r}) desde ${sc.kind}`);
    });
    if (getters.length === 1) { const g = getters[0]; return (f) => [g(f)]; }
    return (f) => getters.map((g) => g(f));
  }

  // ───────────── llamadas ─────────────

  call(n: Call): Ev {
    const fnode = n.func;
    const hasStar = n.args.some((a) => a.k === 'Starred');
    const hasKw = n.keywords.length > 0;
    // super() sin argumentos
    if (fnode.k === 'Name' && fnode.id === 'super' && n.args.length === 0 && !hasKw && this.scope.resolve('super') !== 'local') {
      const sup = this.zeroArgSuper(n);
      if (sup) return sup;
    }
    if (fnode.k === 'Attribute' && !hasStar && !hasKw) return this.methodCall(n, fnode);
    const fe = this.expr(fnode);
    if (!hasStar && !hasKw) {
      const evs = n.args.map((a) => this.expr(a));
      switch (evs.length) {
        case 0:
          return (f) => {
            const fn = fe(f);
            f.pos = n;
            if (fn instanceof PyFunction) return callFunction(fn, [], null);
            return callObj(fn, [], null);
          };
        case 1: {
          const [a] = evs;
          return (f) => {
            const fn = fe(f);
            const args = [a(f)];
            f.pos = n;
            if (fn instanceof PyFunction) return callFunction(fn, args, null);
            return callObj(fn, args, null);
          };
        }
        case 2: {
          const [a, b] = evs;
          return (f) => {
            const fn = fe(f);
            const args = [a(f), b(f)];
            f.pos = n;
            if (fn instanceof PyFunction) return callFunction(fn, args, null);
            return callObj(fn, args, null);
          };
        }
        default:
          return (f) => {
            const fn = fe(f);
            const args = new Array(evs.length);
            for (let i = 0; i < evs.length; i++) args[i] = evs[i](f);
            f.pos = n;
            if (fn instanceof PyFunction) return callFunction(fn, args, null);
            return callObj(fn, args, null);
          };
      }
    }
    const argsFn = this.argBuilder(n);
    return (f) => {
      const fn = fe(f);
      const [args, kw] = argsFn(f, fn);
      f.pos = n;
      if (fn instanceof PyFunction) return callFunction(fn, args, kw);
      return callObj(fn, args, kw);
    };
  }

  /** evalúa argumentos con `*` y `**` / palabras clave */
  argBuilder(n: Call): (f: Frame, fn: any) => [any[], Kw | null] {
    const posParts = n.args.map((a) => (a.k === 'Starred' ? { star: true, ev: this.expr(a.value) } : { star: false, ev: this.expr(a) }));
    const kwParts = n.keywords.map((k) => ({ name: k.arg, ev: this.expr(k.value) }));
    const hasStar = posParts.some((p) => p.star);
    return (f, fn) => {
      let args: any[];
      if (!hasStar) {
        args = new Array(posParts.length);
        for (let i = 0; i < posParts.length; i++) args[i] = posParts[i].ev(f);
      } else {
        args = [];
        for (const p of posParts) {
          if (p.star) {
            const v = p.ev(f);
            f.pos = n;
            const items = rt.starArgs(v, fn);
            for (const x of items) args.push(x);
          } else args.push(p.ev(f));
        }
      }
      let kw: Kw | null = null;
      if (kwParts.length > 0) {
        kw = new Map();
        for (const k of kwParts) {
          const v = k.ev(f);
          if (k.name === null) {
            f.pos = n;
            rt.starKw(kw, v, fn);
          } else {
            if (kw.has(k.name)) { f.pos = n; throw typeError(`${rt.describeCallee(fn)} got multiple values for keyword argument '${k.name}'`); }
            kw.set(k.name, v);
          }
        }
      }
      return [args, kw];
    };
  }

  methodCall(n: Call, fnode: Attribute): Ev {
    const oe = this.expr(fnode.value);
    const name = fnode.attr;
    const evs = n.args.map((a) => this.expr(a));
    const posAttr = fnode;
    switch (evs.length) {
      case 0:
        return (f) => {
          const o = oe(f);
          f.pos = posAttr;
          const m = loadMethod(o, name);
          const self = takeSelf();
          f.pos = n;
          if (self !== undefined) return m instanceof PyFunction ? callFunction(m, [self], null) : (m as NativeFunction).call([self], null);
          return callObj(m, [], null);
        };
      case 1: {
        const [a] = evs;
        return (f) => {
          const o = oe(f);
          f.pos = posAttr;
          const m = loadMethod(o, name);
          const self = takeSelf();
          const x = a(f);
          f.pos = n;
          if (self !== undefined) return m instanceof PyFunction ? callFunction(m, [self, x], null) : (m as NativeFunction).call([self, x], null);
          return callObj(m, [x], null);
        };
      }
      case 2: {
        const [a, b] = evs;
        return (f) => {
          const o = oe(f);
          f.pos = posAttr;
          const m = loadMethod(o, name);
          const self = takeSelf();
          const x = a(f);
          const y = b(f);
          f.pos = n;
          if (self !== undefined) return m instanceof PyFunction ? callFunction(m, [self, x, y], null) : (m as NativeFunction).call([self, x, y], null);
          return callObj(m, [x, y], null);
        };
      }
      default:
        return (f) => {
          const o = oe(f);
          f.pos = posAttr;
          const m = loadMethod(o, name);
          const self = takeSelf();
          const args = new Array(evs.length + (self !== undefined ? 1 : 0));
          let k = 0;
          if (self !== undefined) args[k++] = self;
          for (let i = 0; i < evs.length; i++) args[k++] = evs[i](f);
          f.pos = n;
          if (self !== undefined) return m instanceof PyFunction ? callFunction(m, args, null) : (m as NativeFunction).call(args, null);
          return callObj(m, args, null);
        };
    }
  }

  zeroArgSuper(n: Call): Ev | null {
    const sc = this.scope;
    if (!sc.usesClassCell) return null;
    if (this.fs.kind !== 'function' && this.fs.kind !== 'lambda') return null;
    const fs = this.fs;
    const classRes = sc.resolve('__class__');
    if (classRes !== 'free') return null;
    const j = this.freeIndex('__class__');
    // primer parámetro
    const first = sc.paramNames.length > 0 ? sc.paramNames[0] : null;
    const firstRes = first !== null ? sc.resolve(first) : null;
    const i0 = first !== null ? fs.slot(first) : -1;
    const superFn = this.expr({ k: 'Name', id: 'super', ctx: 'Load', line: n.line, col: n.col, endLine: n.endLine, endCol: n.endCol } as Name);
    return (f) => {
      const sfn = superFn(f);
      if (sfn !== SUPER_BUILTIN.f) {
        f.pos = n;
        return callObj(sfn, [], null);
      }
      f.pos = n;
      if (first === null) throw makeRuntimeError('super(): no arguments');
      const cell = f.free![j];
      const cls = cell.v;
      if (cls === undefined) throw makeRuntimeError('super(): __class__ cell not found');
      let obj = f.l[i0];
      if (firstRes === 'cell') obj = obj === undefined ? undefined : obj.v;
      if (obj === undefined) throw makeRuntimeError('super(): arg[0] deleted');
      return rt.superNew(cls, obj);
    };
  }
}

export const SUPER_BUILTIN: { f: any } = { f: undefined };

import { runtimeError as makeRuntimeError } from './runtime/errors';

void SIG_RETURN;
void PyType;
void PyGenerator;
void PyBaseException;
void StepLimit;
void listType;
void tupleType;
void reprOf;
void asciiOf;
void E;
