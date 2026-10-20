/**
 * Compilador AST → closures: sentencias, definiciones de funciones y clases.
 */
import type {
  Arguments, Assert, Assign, AugAssign, Delete, Expr, ExceptHandler, For, FunctionDef, If, Import, ImportFrom, MatchCase, Pattern, Stmt,
  Try, While, With, ClassDef, AnnAssign, Raise, Match, TypeParam, TypeAlias,
} from './ast';
import { Scope } from './scope';
import {
  Cell, Frame, PyBaseException, PyBox, PyDict, PyFloat, PyFunction, PyList, PyObject, PyRange, PyTuple, PyType, PyGenerator,
  SIG_BREAK, SIG_CONTINUE, SIG_RETURN, type Code, type Ev, type Ex, type Kw, PyClassMethod,
} from './runtime/objects';
import { E } from './runtime/exc_types';
import { rangeType, listType, typeOf, functionType } from './runtime/builtin_types';
import * as ops from './runtime/ops';
import * as rt from './runtime/rt';
import { addTb, callFunction, callObj, toPyExc } from './runtime/call';
import { StarTry } from './runtime/t_exc';
import { assertionError, makeExc, StepLimit, runtimeError, typeError } from './runtime/errors';
import { importFromName, importName, importStar } from './runtime/modules';
import { ExprCompiler, FnState, type Setter, pyConst } from './compile_expr';
import { NeedInput, Aborted } from './runtime/errors';
import { MAXS } from './runtime/numeric';

const NOEXC = Symbol('noexc');

export function isInternalSignal(e: unknown): boolean {
  return e instanceof StepLimit || e instanceof NeedInput || e instanceof Aborted;
}

export abstract class StmtCompiler extends ExprCompiler {
  abstract genBlock(list: Stmt[]): (f: Frame) => Generator<any, number | undefined, any>;
  abstract suspends(n: Stmt | Expr): boolean;

  // ───────────── bloques ─────────────

  block(list: Stmt[]): Ex {
    const exs: Ex[] = [];
    for (const s of list) {
      const e = this.stmt(s);
      if (e !== null) exs.push(e);
    }
    return this.seq(exs);
  }

  seq(exs: Ex[]): Ex {
    switch (exs.length) {
      case 0: return () => undefined;
      case 1: return exs[0];
      case 2: {
        const [a, b] = exs;
        return (f) => {
          const r = a(f);
          if (r !== undefined) return r;
          return b(f);
        };
      }
      case 3: {
        const [a, b, c] = exs;
        return (f) => {
          let r = a(f);
          if (r !== undefined) return r;
          r = b(f);
          if (r !== undefined) return r;
          return c(f);
        };
      }
      default:
        return (f) => {
          for (let i = 0; i < exs.length; i++) {
            const r = exs[i](f);
            if (r !== undefined) return r;
          }
          return undefined;
        };
    }
  }

  stmtBlock(list: Stmt[]): Ex {
    return this.block(list);
  }

  // ───────────── sentencias ─────────────

  stmt(n: Stmt): Ex | null {
    switch (n.k) {
      case 'Expr': return this.exprStmt(n);
      case 'Assign': return this.assign(n);
      case 'AugAssign': return this.augAssign(n);
      case 'AnnAssign': return this.annAssign(n);
      case 'If': return this.ifStmt(n);
      case 'While': return this.whileStmt(n);
      case 'For': return this.forStmt(n);
      case 'Return': return this.returnStmt(n);
      case 'Pass': return null;
      case 'Break':
        if (this.fs.loopDepth === 0) this.syntaxError("'break' outside loop", n);
        return () => SIG_BREAK;
      case 'Continue':
        if (this.fs.loopDepth === 0) this.syntaxError("'continue' not properly in loop", n);
        return () => SIG_CONTINUE;
      case 'FunctionDef': return this.funcDef(n);
      case 'AsyncFunctionDef': return this.funcDef(n);
      case 'ClassDef': return this.classDef(n);
      case 'Try': return this.tryStmt(n);
      case 'TryStar': return this.tryStar(n);
      case 'With': return this.withStmt(n);
      case 'Raise': return this.raiseStmt(n);
      case 'Assert': return this.assertStmt(n);
      case 'Delete': return this.deleteStmt(n);
      case 'Import': return this.importStmt(n);
      case 'ImportFrom': return this.importFrom(n);
      case 'Global': case 'Nonlocal': return null;
      case 'Match': return this.matchStmt(n);
      case 'TypeAlias': return this.typeAlias(n);
      case 'AsyncFor': case 'AsyncWith':
        this.syntaxError(n.k === 'AsyncFor' ? "'async for' outside async function" : "'async with' outside async function", n);
    }
  }

  exprStmt(n: Stmt & { k: 'Expr' }): Ex | null {
    const v = n.value;
    // docstrings y constantes sueltas no hacen nada
    if (v.k === 'Constant' && !this.replMode && !this.singleMode) return null;
    if (v.k === 'Starred') this.syntaxError("can't use starred expression here", v);
    const e = this.expr(v);
    if (this.replMode && this.fs.kind === 'module') {
      const I = this.I;
      return (f) => {
        const r = e(f);
        I.replValue = r;
        return undefined;
      };
    }
    if (this.singleMode && this.fs.kind === 'module') {
      const I = this.I;
      return (f) => {
        const r = e(f);
        const hook = I.sysModule ? I.sysModule.dict!.get('displayhook') : undefined;
        if (hook === undefined) throw runtimeError('lost sys.displayhook');
        callObj(hook, [r]);
        return undefined;
      };
    }
    return (f) => {
      e(f);
      return undefined;
    };
  }

  // ───────────── asignación ─────────────

  target(t: Expr): Setter {
    switch (t.k) {
      case 'Name': return this.storeName(t.id, t);
      case 'Attribute': {
        const o = this.expr(t.value);
        const name = t.attr;
        return (f, v) => {
          const obj = o(f);
          f.pos = t;
          ops.setAttr(obj, name, v);
        };
      }
      case 'Subscript': {
        const o = this.expr(t.value);
        const k = this.expr(t.slice);
        return (f, v) => {
          const obj = o(f);
          const key = k(f);
          f.pos = t;
          ops.setitem(obj, key, v);
        };
      }
      case 'Tuple': case 'List': return this.unpackTarget(t);
      case 'Starred': this.syntaxError("starred assignment target must be in a list or tuple", t);
      default: this.syntaxError('cannot assign to ' + t.k, t);
    }
  }

  unpackTarget(t: Expr & { elts: Expr[] }): Setter {
    const elts = t.elts;
    const starIdx = elts.findIndex((e) => e.k === 'Starred');
    if (starIdx < 0) {
      const sets = elts.map((e) => this.target(e));
      const n = sets.length;
      return (f, v) => {
        f.pos = t;
        const items = ops.unpack(v, n);
        for (let i = 0; i < n; i++) sets[i](f, items[i]);
      };
    }
    if (elts.filter((e) => e.k === 'Starred').length > 1) this.syntaxError('multiple starred expressions in assignment', t);
    const before = elts.slice(0, starIdx).map((e) => this.target(e));
    const after = elts.slice(starIdx + 1).map((e) => this.target(e));
    const starSet = this.target((elts[starIdx] as Expr & { k: 'Starred' }).value);
    return (f, v) => {
      f.pos = t;
      const [b, mid, a] = ops.unpackEx(v, before.length, after.length);
      for (let i = 0; i < before.length; i++) before[i](f, b[i]);
      starSet(f, new PyList(mid));
      for (let i = 0; i < after.length; i++) after[i](f, a[i]);
    };
  }

  assign(n: Assign): Ex {
    const val = this.expr(n.value);
    if (n.targets.length === 1) {
      const t = n.targets[0];
      if (t.k === 'Name') {
        const res = this.scope.resolve(t.id);
        if (res === 'local') {
          const i = this.fs.slot(t.id);
          return (f) => {
            f.l[i] = val(f);
            return undefined;
          };
        }
      }
      const set = this.target(t);
      return (f) => {
        set(f, val(f));
        return undefined;
      };
    }
    const sets = n.targets.map((t) => this.target(t));
    return (f) => {
      const v = val(f);
      for (let i = 0; i < sets.length; i++) sets[i](f, v);
      return undefined;
    };
  }

  augAssign(n: AugAssign): Ex {
    const op = n.op;
    const rhs = this.expr(n.value);
    const t = n.target;
    if (t.k === 'Name') {
      const ld = this.loadName({ ...t, ctx: 'Load' });
      const st = this.storeName(t.id, t);
      if (op === '+') {
        return (f) => {
          const a = ld(f);
          const b = rhs(f);
          if (typeof a === 'number' && typeof b === 'number') {
            const x = a + b;
            if (x <= MAXS && x >= -MAXS) { st(f, x); return undefined; }
          }
          f.pos = n;
          st(f, ops.inplaceop(op, a, b));
          return undefined;
        };
      }
      return (f) => {
        const a = ld(f);
        const b = rhs(f);
        f.pos = n;
        st(f, ops.inplaceop(op, a, b));
        return undefined;
      };
    }
    if (t.k === 'Attribute') {
      const o = this.expr(t.value);
      const name = t.attr;
      return (f) => {
        const obj = o(f);
        f.pos = t;
        const a = ops.getAttr(obj, name);
        const b = rhs(f);
        f.pos = n;
        const r = ops.inplaceop(op, a, b);
        f.pos = t;
        ops.setAttr(obj, name, r);
        return undefined;
      };
    }
    if (t.k === 'Subscript') {
      const o = this.expr(t.value);
      const k = this.expr(t.slice);
      return (f) => {
        const obj = o(f);
        const key = k(f);
        f.pos = t;
        const a = ops.getitem(obj, key);
        const b = rhs(f);
        f.pos = n;
        const r = ops.inplaceop(op, a, b);
        f.pos = t;
        ops.setitem(obj, key, r);
        return undefined;
      };
    }
    this.syntaxError(`'${t.k}' is an illegal expression for augmented assignment`, t);
  }

  annAssign(n: AnnAssign): Ex | null {
    const t = n.target;
    const inFuncLike = this.fs.kind === 'function' || this.fs.kind === 'lambda';
    let annEv: Ev | null = null;
    // las anotaciones de variables locales de funciones no se evalúan
    if (!inFuncLike) {
      if (this.futureAnnotations) {
        const text = this.sourceText(n.annotation);
        annEv = () => text;
      } else annEv = this.expr(n.annotation);
    }
    let setv: Setter | null = null;
    let val: Ev | null = null;
    if (n.value) {
      val = this.expr(n.value);
      setv = this.target(t);
    } else if (t.k !== 'Name') {
      // x.y: int  → evalúa x
      const o = t.k === 'Attribute' ? this.expr(t.value) : t.k === 'Subscript' ? this.expr(t.value) : null;
      if (o) {
        const sl = t.k === 'Subscript' ? this.expr(t.slice) : null;
        return (f) => { o(f); if (sl) sl(f); return undefined; };
      }
    }
    const storeAnn: ((f: Frame) => void) | null = (!inFuncLike && t.k === 'Name' && (this.fs.kind === 'class' || this.fs.kind === 'module'))
      ? this.annotationStore(t.id, annEv!)
      : annEv && !inFuncLike ? ((f: Frame) => { annEv!(f); }) : null;
    return (f) => {
      if (val && setv) setv(f, val(f));
      if (storeAnn) storeAnn(f);
      return undefined;
    };
  }

  annotationStore(name: string, ev: Ev): (f: Frame) => void {
    const isClass = this.fs.kind === 'class';
    return (f) => {
      const v = ev(f);
      const d = isClass ? f.ns! : f.g;
      let a = d.get('__annotations__');
      if (a === undefined) {
        a = new PyDict();
        d.set('__annotations__', a);
      }
      (a as PyDict).set(name, v);
    };
  }

  sourceText(n: Expr): string {
    if (n.line === n.endLine) return (this.lines[n.line - 1] ?? '').slice(n.col, n.endCol);
    const parts: string[] = [];
    for (let l = n.line; l <= n.endLine; l++) {
      const s = this.lines[l - 1] ?? '';
      parts.push(l === n.line ? s.slice(n.col) : l === n.endLine ? s.slice(0, n.endCol) : s);
    }
    return parts.join('\n');
  }

  deleteStmt(n: Delete): Ex {
    const dels: ((f: Frame) => void)[] = n.targets.map((t) => this.delTarget(t));
    return (f) => {
      for (const d of dels) d(f);
      return undefined;
    };
  }

  delTarget(t: Expr): (f: Frame) => void {
    switch (t.k) {
      case 'Name': return this.deleteName(t);
      case 'Attribute': {
        const o = this.expr(t.value);
        return (f) => { const obj = o(f); f.pos = t; ops.delAttr(obj, t.attr); };
      }
      case 'Subscript': {
        const o = this.expr(t.value);
        const k = this.expr(t.slice);
        return (f) => { const obj = o(f); const key = k(f); f.pos = t; ops.delitem(obj, key); };
      }
      case 'Tuple': case 'List': {
        const ds = t.elts.map((e) => this.delTarget(e));
        return (f) => { for (const d of ds) d(f); };
      }
      default: this.syntaxError('cannot delete ' + t.k, t);
    }
  }

  // ───────────── control de flujo ─────────────

  ifStmt(n: If): Ex {
    const t = this.cond(n.test);
    const body = this.block(n.body);
    if (n.orelse.length === 0) return (f) => (t(f) ? body(f) : undefined);
    const orelse = this.block(n.orelse);
    return (f) => (t(f) ? body(f) : orelse(f));
  }

  whileStmt(n: While): Ex {
    const I = this.I;
    const t = this.cond(n.test);
    this.fs.loopDepth++;
    const body = this.block(n.body);
    this.fs.loopDepth--;
    const orelse = n.orelse.length > 0 ? this.block(n.orelse) : null;
    return (f) => {
      for (;;) {
        if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
        if (!t(f)) break;
        const r = body(f);
        if (r !== undefined) {
          if (r === SIG_BREAK) return undefined;
          if (r === SIG_CONTINUE) continue;
          return r;
        }
      }
      return orelse ? orelse(f) : undefined;
    };
  }

  forStmt(n: For): Ex {
    const I = this.I;
    const iterEv = this.expr(n.iter);
    const tgt = n.target;
    let simpleSlot = -1;
    if (tgt.k === 'Name' && this.scope.resolve(tgt.id) === 'local') simpleSlot = this.fs.slot(tgt.id);
    const set = this.target(tgt);
    this.fs.loopDepth++;
    const body = this.block(n.body);
    this.fs.loopDepth--;
    const orelse = n.orelse.length > 0 ? this.block(n.orelse) : null;
    const iterNode = n.iter;
    return (f) => {
      const it = iterEv(f);
      let r: number | undefined;
      // bucle numérico sobre range
      if (it instanceof PyRange && it.cls === rangeType && typeof it.start === 'number' && typeof it.stop === 'number' && typeof it.step === 'number') {
        const stop = it.stop;
        const step = it.step;
        if (step > 0) {
          for (let i = it.start; i < stop; i += step) {
            if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
            if (simpleSlot >= 0) f.l[simpleSlot] = i;
            else set(f, i);
            r = body(f);
            if (r !== undefined) {
              if (r === SIG_BREAK) return undefined;
              if (r === SIG_CONTINUE) continue;
              return r;
            }
          }
        } else {
          for (let i = it.start; i > stop; i += step) {
            if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
            if (simpleSlot >= 0) f.l[simpleSlot] = i;
            else set(f, i);
            r = body(f);
            if (r !== undefined) {
              if (r === SIG_BREAK) return undefined;
              if (r === SIG_CONTINUE) continue;
              return r;
            }
          }
        }
        return orelse ? orelse(f) : undefined;
      }
      // lista (con comprobación de longitud en vivo)
      if (it instanceof PyList && it.cls === listType) {
        const a = it.a;
        for (let i = 0; i < a.length; i++) {
          if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
          const v = a[i];
          if (simpleSlot >= 0) f.l[simpleSlot] = v;
          else set(f, v);
          r = body(f);
          if (r !== undefined) {
            if (r === SIG_BREAK) return undefined;
            if (r === SIG_CONTINUE) continue;
            return r;
          }
        }
        return orelse ? orelse(f) : undefined;
      }
      f.pos = iterNode;
      const iter = ops.getIter(it);
      for (;;) {
        if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
        f.pos = iterNode;
        const v = iter.next();
        if (v === undefined) break;
        if (simpleSlot >= 0) f.l[simpleSlot] = v;
        else set(f, v);
        r = body(f);
        if (r !== undefined) {
          if (r === SIG_BREAK) return undefined;
          if (r === SIG_CONTINUE) continue;
          return r;
        }
      }
      return orelse ? orelse(f) : undefined;
    };
  }

  returnStmt(n: Stmt & { k: 'Return' }): Ex {
    if (this.fs.kind !== 'function' && this.fs.kind !== 'lambda') this.syntaxError("'return' outside function", n);
    if (n.value === null) {
      return (f) => {
        f.ret = null;
        return SIG_RETURN;
      };
    }
    const e = this.expr(n.value);
    return (f) => {
      f.ret = e(f);
      return SIG_RETURN;
    };
  }

  raiseStmt(n: Raise): Ex {
    if (n.exc === null) {
      return (f) => {
        f.pos = n;
        return rt.doReraise();
      };
    }
    const exc = this.expr(n.exc);
    const cause = n.cause ? this.expr(n.cause) : null;
    return (f) => {
      const e = exc(f);
      const c = cause ? cause(f) : null;
      f.pos = n;
      return rt.doRaise(e, c, cause !== null);
    };
  }

  assertStmt(n: Assert): Ex {
    const t = this.cond(n.test);
    const msg = n.msg ? this.expr(n.msg) : null;
    return (f) => {
      if (t(f)) return undefined;
      const args = msg ? [msg(f)] : [];
      f.pos = n.test;
      const e = assertionError('');
      e.args = args;
      throw e;
    };
  }

  // ───────────── try / with ─────────────

  /** convierte el valor capturado en excepción de Python (o relanza señales internas) */
  caught(e: unknown): PyBaseException {
    if (e instanceof PyBaseException) return e;
    const pe = toPyExc(e);
    if (pe === null) throw e;
    return pe;
  }

  tryStmt(n: Try): Ex {
    const I = this.I;
    const body = this.block(n.body);
    const handlers = n.handlers.map((h) => this.handler(h));
    const orelse = n.orelse.length > 0 ? this.block(n.orelse) : null;
    const finalbody = n.finalbody.length > 0 ? this.block(n.finalbody) : null;

    const runTryExcept: Ex = (f) => {
      let sig: number | undefined;
      let exc: PyBaseException;
      try {
        sig = body(f);
      } catch (e0) {
        exc = this.caught(e0);
        addTb(exc, f);
        // buscar un manejador
        for (let i = 0; i < handlers.length; i++) {
          const h = handlers[i];
          let ok = true;
          if (h.type) {
            f.pos = h.node;
            const spec = h.type(f);
            ok = rt.exceptMatch(exc, spec);
          }
          if (ok) {
            const prev = I.curExc;
            I.curExc = exc;
            try {
              if (h.set) h.set(f, exc);
              return h.body(f);
            } finally {
              I.curExc = prev;
              if (h.name !== null) h.clear!(f);
            }
          }
        }
        throw exc;
      }
      if (orelse !== null && sig === undefined) return orelse(f);
      return sig;
    };
    const main: Ex = handlers.length > 0 ? runTryExcept : (f) => body(f);
    if (finalbody === null) return main;
    return (f) => {
      let sig: number | undefined;
      let pending: any = NOEXC;
      try {
        sig = main(f);
      } catch (e) {
        if (isInternalSignal(e)) throw e;
        pending = e;
      }
      let pendExc: PyBaseException | null = null;
      if (pending !== NOEXC) {
        pendExc = toPyExc(pending);
        if (pendExc === null) throw pending;
        if (pendExc.lastFrame !== f) addTb(pendExc, f);
      }
      const prev = I.curExc;
      if (pendExc !== null) I.curExc = pendExc;
      let fsig: number | undefined;
      try {
        fsig = finalbody(f);
      } finally {
        I.curExc = prev;
      }
      if (fsig !== undefined) return fsig;
      if (pendExc !== null) throw pendExc;
      return sig;
    };
  }

  handler(h: ExceptHandler): { type: Ev | null; node: ExceptHandler; set: Setter | null; clear: ((f: Frame) => void) | null; name: string | null; body: Ex } {
    const type = h.type ? this.expr(h.type) : null;
    let set: Setter | null = null;
    let clear: ((f: Frame) => void) | null = null;
    if (h.name) {
      set = this.storeName(h.name, h);
      const st = this.storeName(h.name, h);
      const del = this.deleteName({ k: 'Name', id: h.name, ctx: 'Del', line: h.line, col: h.col, endLine: h.endLine, endCol: h.endCol });
      clear = (f) => {
        try { del(f); } catch (e) { if (!(e instanceof PyBaseException)) throw e; }
        void st;
      };
    }
    return { type, node: h, set, clear, name: h.name, body: this.block(h.body) };
  }

  /** except* (grupos de excepciones) */
  tryStar(n: Try): Ex {
    const I = this.I;
    const body = this.block(n.body);
    const handlers = n.handlers.map((h) => this.handler(h));
    const orelse = n.orelse.length > 0 ? this.block(n.orelse) : null;
    const finalbody = n.finalbody.length > 0 ? this.block(n.finalbody) : null;
    const main: Ex = (f) => {
      let sig: number | undefined;
      try {
        sig = body(f);
      } catch (e0) {
        if (isInternalSignal(e0)) throw e0;
        const exc0 = this.caught(e0);
        addTb(exc0, f);
        const st = new StarTry(exc0);
        const outerExc: any = I.curExc;
        I.curExc = exc0;
        try {
        for (const h of handlers) {
          if (st.exhausted) break;
          f.pos = h.node;
          const spec = h.type!(f);
          const matched = st.match(spec);
          if (matched === null) continue;
          const prev: any = I.curExc;
          I.curExc = matched;
          try {
            if (h.set) h.set(f, matched);
            h.body(f);
          } catch (e1) {
            if (isInternalSignal(e1)) throw e1;
            const ex1 = this.caught(e1);
            if (ex1 !== matched) addTb(ex1, f);
            st.raised(ex1);
          } finally {
            I.curExc = prev;
            if (h.name !== null) h.clear!(f);
          }
        }
        } finally {
          I.curExc = outerExc;
        }
        const res = st.finish();
        if (res !== null) throw res;
        return undefined;
      }
      if (orelse !== null && sig === undefined) return orelse(f);
      return sig;
    };
    if (finalbody === null) return main;
    return (f) => {
      let sig: number | undefined;
      let pending: any = NOEXC;
      try { sig = main(f); } catch (e) { if (isInternalSignal(e)) throw e; pending = e; }
      const fsig = finalbody(f);
      if (fsig !== undefined) return fsig;
      if (pending !== NOEXC) throw pending;
      return sig;
    };
  }

  withStmt(n: With): Ex {
    const I = this.I;
    const items = n.items.map((it) => ({
      ctx: this.expr(it.contextExpr),
      node: it.contextExpr,
      set: it.optionalVars ? this.target(it.optionalVars) : null,
    }));
    const body = this.block(n.body);
    const run = (idx: number): Ex => {
      if (idx >= items.length) return body;
      const it = items[idx];
      const inner = run(idx + 1);
      return (f) => {
        const mgr = it.ctx(f);
        f.pos = it.node;
        const { ctx, value } = rt.withEnter(mgr, false);
        let sig: number | undefined;
        try {
          if (it.set) it.set(f, value);
          sig = inner(f);
        } catch (e0) {
          if (isInternalSignal(e0)) throw e0;
          const exc = this.caught(e0);
          addTb(exc, f);
          const prev = I.curExc;
          I.curExc = exc;
          let suppress: boolean;
          try {
            suppress = ops.truthy(rt.withExit(ctx, exc));
          } finally {
            I.curExc = prev;
          }
          if (!suppress) throw exc;
          return undefined;
        }
        f.pos = it.node;
        rt.withExit(ctx, null);
        return sig;
      };
    };
    return run(0);
  }

  // ───────────── importaciones ─────────────

  importStmt(n: Import): Ex {
    const parts = n.names.map((a) => {
      const top = a.name.split('.')[0];
      const set = this.storeName(a.asname ?? top, a);
      return { a, set, top };
    });
    return (f) => {
      for (const p of parts) {
        f.pos = n;
        const mod = importName(this.I, p.a.name, null, 0, f.g, p.a.asname !== null);
        p.set(f, mod);
      }
      return undefined;
    };
  }

  importFrom(n: ImportFrom): Ex {
    const level = n.level;
    const modName = n.module ?? '';
    if (n.names.length === 1 && n.names[0].name === '*') {
      if (this.fs.kind !== 'module') this.syntaxError('import * only allowed at module level', n);
      return (f) => {
        f.pos = n;
        const mod = importName(this.I, modName, ['*'], level, f.g, true);
        importStar(this.I, mod, f.g);
        return undefined;
      };
    }
    const names = n.names.map((a) => ({ name: a.name, set: this.storeName(a.asname ?? a.name, a) }));
    const fromlist = names.map((x) => x.name);
    if (modName === '__future__') {
      return null as unknown as Ex;
    }
    return (f) => {
      f.pos = n;
      const mod = importName(this.I, modName, fromlist, level, f.g, true);
      for (const x of names) {
        f.pos = n;
        x.set(f, importFromName(this.I, mod, x.name, modName, level, f.g));
      }
      return undefined;
    };
  }

  // ───────────── definiciones ─────────────

  annotationsEv(args: Arguments, returns: Expr | null): ((f: Frame) => PyDict | null) | null {
    const items: { name: string; ev: Ev }[] = [];
    const add = (name: string, a: Expr | null) => {
      if (!a) return;
      if (this.futureAnnotations) {
        const text = this.sourceText(a);
        items.push({ name, ev: () => text });
      } else items.push({ name, ev: this.expr(a) });
    };
    for (const a of args.posonlyargs) add(a.arg, a.annotation);
    for (const a of args.args) add(a.arg, a.annotation);
    if (args.vararg) add(args.vararg.arg, args.vararg.annotation);
    for (const a of args.kwonlyargs) add(a.arg, a.annotation);
    if (args.kwarg) add(args.kwarg.arg, args.kwarg.annotation);
    add('return', returns);
    if (items.length === 0) return null;
    return (f) => {
      const d = new PyDict();
      for (const it of items) d.set(it.name, it.ev(f));
      return d;
    };
  }

  funcDef(n: FunctionDef): Ex {
    const sc = this.table.byNode.get(n)!;
    const decorators = n.decorators.map((d) => this.expr(d));
    const set = this.storeName((n as any).bind ?? n.name, n);
    let mk: Ev;
    if (n.typeParams.length > 0) {
      mk = this.genericDef(n, sc);
    } else {
      mk = this.makeFunctionExpr(n, sc, n.name, n.args, this.annotationsEv(n.args, n.returns));
    }
    return (f) => {
      let fn = mk(f);
      for (let i = decorators.length - 1; i >= 0; i--) {
        const d = decorators[i](f);
        f.pos = n.decorators[i];
        fn = callObj(d, [fn], null);
      }
      set(f, fn);
      return undefined;
    };
  }

  /** def f[T](...): los parámetros de tipo viven en un ámbito intermedio */
  genericDef(n: FunctionDef, sc: Scope): Ev {
    const tp = this.table.byNode.get(n.typeParams)!;
    const outerFs = this.fs;
    const qual = this.qualnameFor(n.name);
    // compilar el interior dentro de un FnState de parámetros de tipo
    const inner = this.withTypeParams(n.typeParams, tp, () => this.makeFunctionExpr(n, sc, n.name, n.args, this.annotationsEv(n.args, n.returns)), qual);
    void outerFs;
    return inner;
  }

  /**
   * Compila `body` dentro de un ámbito de parámetros de tipo. Devuelve un Ev que crea las variables de tipo
   * (TypeVar...) en un marco propio y evalúa `body` dentro de él.
   */
  withTypeParams(params: TypeParam[], tp: Scope, bodyFn: () => Ev, qual: string): Ev {
    const saved = this.fs;
    const fs = new FnState(tp, 'function');
    this.fs = fs;
    tp.freeList.forEach((nm, i) => fs.freeIdx.set(nm, i));
    for (const p of params) fs.slot(p.name);
    const sets = params.map((p) => ({ p, set: this.storeName(p.name, p), bound: p.bound ? this.lambdaThunk(p.bound) : null }));
    const inner = bodyFn();
    // el marco de parámetros de tipo no tiene Code real: usamos uno mínimo
    const code = this.simpleCode(fs, '<generic parameters of ' + qual + '>');
    this.fs = saved;
    const getCells = this.closureBuilder(tp.freeList);
    return (f) => {
      const l = new Array(fs.varnames.length);
      for (const s of tp.syms.values()) if (s.res === 'cell') l[fs.slot(s.name)] = new Cell();
      const tf = new Frame(code, l, f.g, f.b, f.back, getCells ? getCells(f) : null, null, null);
      tf.pos = f.pos;
      for (const s of sets) {
        const tv = this.makeTypeVar(s.p, tf, s.bound);
        s.set(tf, tv);
      }
      return inner(tf);
    };
  }

  lambdaThunk(e: Expr): Ev {
    const sc = this.table.byNode.get(e);
    if (!sc) return this.expr(e);
    const { code, freeNames } = this.compileFunctionLike(e, sc, '<lambda>', '<lambda>');
    const getCells = this.closureBuilder(freeNames);
    return (f) => {
      const fn = new PyFunction(functionType, code, f.g, f.b, null, null, getCells ? getCells(f) : null);
      return fn;
    };
  }

  makeTypeVar(p: TypeParam, f: Frame, bound: Ev | null): any {
    const mod = this.I.modules.get('typing');
    const tvName = p.k === 'TypeVar' ? 'TypeVar' : p.k === 'ParamSpec' ? 'ParamSpec' : 'TypeVarTuple';
    let cls: any;
    if (mod instanceof PyObject && mod.dict) cls = mod.dict.get(tvName);
    if (cls === undefined) {
      const m = importName(this.I, 'typing', null, 0, f.g, true);
      cls = ops.getAttr(m, tvName);
    }
    const args: any[] = [p.name];
    const kw = new Map<string, any>();
    if (bound) kw.set('bound', bound(f));
    return callObj(cls, args, kw.size > 0 ? kw : null);
  }

  simpleCode(fs: FnState, name: string): Code {
    return {
      name, qualname: name, filename: this.filename, firstLine: 1, varnames: fs.varnames, nlocals: fs.varnames.length, argcount: 0,
      posonlyCount: 0, kwonlyCount: 0, varargsSlot: -1, varkwSlot: -1, paramNames: [], cellParams: [], cellVars: [], freeNames: [],
      isGenerator: false, isCoroutine: false, isAsyncGen: false, body: null, genBody: null, doc: null, simple: true, lines: this.lines,
      hidden: this.hidden, usesClassCell: false, classFree: -1, kind: 'function', classCellSlot: -1,
    };
  }

  typeAlias(n: TypeAlias): Ex {
    const sc = this.table.byNode.get(n)!;
    const set = this.storeName(n.name.id, n.name);
    const name = n.name.id;
    const mkValue = (): Ev => this.lambdaThunkFor(n, sc);
    const mk: Ev = n.typeParams.length > 0
      ? this.withTypeParams(n.typeParams, this.table.byNode.get(n.typeParams)!, mkValue, name)
      : mkValue();
    return (f) => {
      f.pos = n;
      const thunk = mk(f);
      const m = importName(this.I, 'typing', null, 0, f.g, true);
      const cls = ops.getAttr(m, 'TypeAliasType');
      const ta = callObj(cls, [name, thunk], null);
      set(f, ta);
      return undefined;
    };
  }

  lambdaThunkFor(n: TypeAlias, sc: Scope): Ev {
    const { code, freeNames } = this.compileFunctionLike(n, sc, n.name.id, n.name.id);
    const getCells = this.closureBuilder(freeNames);
    return (f) => new PyFunction(functionType, code, f.g, f.b, null, null, getCells ? getCells(f) : null);
  }

  classDef(n: ClassDef): Ex {
    const sc = this.table.byNode.get(n)!;
    const decorators = n.decorators.map((d) => this.expr(d));
    const set = this.storeName((n as any).bind ?? n.name, n);
    const bases = n.bases.map((b) => (b.k === 'Starred' ? { star: true, ev: this.expr(b.value) } : { star: false, ev: this.expr(b) }));
    const kws = n.keywords.map((k) => ({ name: k.arg, ev: this.expr(k.value) }));
    const qual = this.qualnameFor(n.name);
    // cuerpo
    const buildBody = (): { code: Code; bodyFn: (cf: Frame) => number | undefined; freeNames: string[] } => {
      const saved = this.fs;
      const savedQual = this.qualStack;
      const fs = new FnState(sc, 'class');
      this.fs = fs;
      this.qualStack = [...savedQual, qual];
      sc.freeList.forEach((nm, i) => fs.freeIdx.set(nm, i));
      let classCellSlot = -1;
      if (sc.needsClassCell) classCellSlot = fs.slot('__class__');
      let list = n.body;
      let docStmt: Ex | null = null;
      if (list.length > 0 && list[0].k === 'Expr' && list[0].value.k === 'Constant' && list[0].value.vt === 'str') {
        const doc = list[0].value.value as string;
        docStmt = (f) => { f.ns!.set('__doc__', doc); return undefined; };
        list = list.slice(1);
      }
      const bodyEx = this.block(list);
      const fn: (cf: Frame) => number | undefined = docStmt ? (cf) => { docStmt!(cf); return bodyEx(cf); } : bodyEx;
      const code = this.simpleCode(fs, n.name);
      code.kind = 'class';
      code.qualname = qual;
      code.classCellSlot = classCellSlot;
      code.freeNames = sc.freeList;
      code.firstLine = n.line;
      code.nlocals = fs.varnames.length;
      this.fs = saved;
      this.qualStack = savedQual;
      return { code, bodyFn: fn, freeNames: sc.freeList };
    };
    let mkClass: (f: Frame) => any;
    const compileHere = (): ((f: Frame) => any) => {
      const { code, bodyFn, freeNames } = buildBody();
      const getCells = this.closureBuilder(freeNames);
      return (f) => {
        const bs: any[] = [];
        for (const b of bases) {
          const v = b.ev(f);
          if (b.star) for (const x of rt.starArgs(v, null)) bs.push(x); else bs.push(v);
        }
        let kw: Kw | null = null;
        if (kws.length > 0) {
          kw = new Map();
          for (const k of kws) {
            const v = k.ev(f);
            if (k.name === null) rt.starKw(kw, v, E.TypeError); else kw.set(k.name, v);
          }
        }
        f.pos = n;
        return rt.buildClass(f, n.name, qual, code, bodyFn, getCells ? getCells(f) : null, bs, kw);
      };
    };
    if (n.typeParams.length > 0) {
      const tpScope = this.table.byNode.get(n.typeParams)!;
      const inner = this.withTypeParams(n.typeParams, tpScope, () => {
        const mk = compileHere();
        return (f) => {
          // __type_params__ y Generic[...] se añaden como base
          const cls = mk(f);
          return cls;
        };
      }, qual);
      mkClass = inner;
    } else mkClass = compileHere();
    return (f) => {
      let cls = mkClass(f);
      for (let i = decorators.length - 1; i >= 0; i--) {
        const d = decorators[i](f);
        f.pos = n.decorators[i];
        cls = callObj(d, [cls], null);
      }
      set(f, cls);
      return undefined;
    };
  }

  // ───────────── match ─────────────

  matchStmt(n: Match): Ex {
    const subject = this.expr(n.subject);
    const cases = n.cases.map((c, idx) => {
      this.checkPattern(c, idx === n.cases.length - 1);
      return {
        pat: this.pattern(c.pattern),
        guard: c.guard ? this.cond(c.guard) : null,
        body: this.block(c.body),
      };
    });
    return (f) => {
      const s = subject(f);
      for (const c of cases) {
        if (c.pat(f, s) && (c.guard === null || c.guard(f))) return c.body(f);
      }
      return undefined;
    };
  }

  checkPattern(c: MatchCase, _last: boolean): void {
    void c;
    void _last;
  }

  pattern(p: Pattern): (f: Frame, s: any) => boolean {
    switch (p.k) {
      case 'MatchValue': {
        const v = this.expr(p.value);
        return (f, s) => {
          const x = v(f);
          f.pos = p;
          return ops.eqOp(s, x);
        };
      }
      case 'MatchSingleton': {
        const v = p.value;
        return (_f, s) => s === v;
      }
      case 'MatchAs': {
        const inner = p.pattern ? this.pattern(p.pattern) : null;
        const set = p.name ? this.storeName(p.name, p) : null;
        return (f, s) => {
          if (inner && !inner(f, s)) return false;
          if (set) set(f, s);
          return true;
        };
      }
      case 'MatchOr': {
        const alts = p.patterns.map((x) => this.pattern(x));
        return (f, s) => {
          for (const a of alts) if (a(f, s)) return true;
          return false;
        };
      }
      case 'MatchStar': this.syntaxError('star pattern outside sequence', p);
      case 'MatchSequence': {
        const starIdx = p.patterns.findIndex((x) => x.k === 'MatchStar');
        const pats = p.patterns.map((x) => (x.k === 'MatchStar' ? null : this.pattern(x)));
        const starSet = starIdx >= 0 && (p.patterns[starIdx] as any).name ? this.storeName((p.patterns[starIdx] as any).name, p) : null;
        const n = p.patterns.length;
        return (f, s) => {
          if (!rt.isMatchSequence(s)) return false;
          const items: any[] = s instanceof PyTuple || s instanceof PyList ? s.a : ops.iterToArray(s);
          if (starIdx < 0) {
            if (items.length !== n) return false;
            for (let i = 0; i < n; i++) if (!pats[i]!(f, items[i])) return false;
            return true;
          }
          if (items.length < n - 1) return false;
          for (let i = 0; i < starIdx; i++) if (!pats[i]!(f, items[i])) return false;
          const after = n - starIdx - 1;
          if (starSet) starSet(f, new PyList(items.slice(starIdx, items.length - after)));
          for (let i = 0; i < after; i++) if (!pats[starIdx + 1 + i]!(f, items[items.length - after + i])) return false;
          return true;
        };
      }
      case 'MatchMapping': {
        const keys = p.keys.map((k) => this.expr(k));
        const pats = p.patterns.map((x) => this.pattern(x));
        const rest = p.rest ? this.storeName(p.rest, p) : null;
        return (f, s) => {
          if (!rt.isMatchMapping(s)) return false;
          const used: any[] = [];
          const missing = Symbol('missing');
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i](f);
            const v = ops.callMethod(s, 'get', [k, missing]);
            if (v === missing) return false;
            if (!pats[i](f, v)) return false;
            used.push(k);
          }
          if (rest) {
            const d = new PyDict();
            const items = ops.iterToArray(ops.callMethod(s, 'items', []));
            for (const it of items) {
              const kv = (it as PyTuple).a;
              if (!used.some((u) => ops.eqOp(u, kv[0]))) d.set(kv[0], kv[1]);
            }
            rest(f, d);
          }
          return true;
        };
      }
      case 'MatchClass': {
        const cls = this.expr(p.cls);
        const pats = p.patterns.map((x) => this.pattern(x));
        const kwPats = p.kwdPatterns.map((x) => this.pattern(x));
        const kwNames = p.kwdAttrs;
        return (f, s) => {
          const c = cls(f);
          f.pos = p;
          const vals = rt.matchClassAttrs(s, c, pats.length, kwNames);
          if (vals === null) return false;
          for (let i = 0; i < pats.length; i++) if (!pats[i](f, vals[i])) return false;
          for (let i = 0; i < kwPats.length; i++) if (!kwPats[i](f, vals[pats.length + i])) return false;
          return true;
        };
      }
    }
  }
}

void PyBox;
void PyFloat;
void PyGenerator;
void typeOf;
void makeExc;
void typeError;
void PyClassMethod;
void PyType;
