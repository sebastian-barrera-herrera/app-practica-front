/**
 * Compilador en modo generador: cuerpos de generadores y corrutinas como `function*`.
 * Los subárboles que no contienen `yield`/`await` se delegan en las closures síncronas.
 */
import { StarTry } from './runtime/t_exc';
import type { Expr, ExceptHandler, Stmt, Try, With, For, While, If, Assign, AugAssign, Match, Raise, Assert, Return, Delete, AnnAssign } from './ast';
import { Scope } from './scope';
import { Suspend } from './suspend';
import {
  AGYield, Cell, Frame, PyBaseException, PyGenerator, PyList, PySet, PyDict, PyObject, PyTuple, SIG_BREAK, SIG_CONTINUE, SIG_RETURN,
  type Ev, type Ex,
} from './runtime/objects';
import { E } from './runtime/exc_types';
import { coroutineType, typeOf } from './runtime/builtin_types';
import * as ops from './runtime/ops';
import * as rt from './runtime/rt';
import { addTb, callObj, genResume, genClose } from './runtime/call';
import { runtimeError, typeError, stopIteration } from './runtime/errors';
import { StmtCompiler, isInternalSignal } from './compile_stmt';
import { pyConst } from './compile_expr';

export type GEx = (f: Frame) => Generator<any, number | undefined, any>;
export type GEv = (f: Frame) => Generator<any, any, any>;

const NOEXC = Symbol('noexc');

/** Delegación `yield from` / `await` sobre un iterador ya obtenido */
export function* delegate(it: any, awaiting: boolean): Generator<any, any, any> {
  const fin = { done: false, value: null as any };
  let mode: 0 | 1 = 0;
  let val: any = null;
  for (;;) {
    let y: any;
    if (it instanceof PyGenerator) {
      if (awaiting && it.state === 3 && it.cls === coroutineType) throw runtimeError('cannot reuse already awaited coroutine');
      y = genResume(it, mode, val, fin);
      if (fin.done) return fin.value;
    } else {
      try {
        if (mode === 0) {
          if (val === null || val === undefined) {
            const v = ops.pyNext(it);
            y = v;
          } else y = ops.callMethod(it, 'send', [val]);
        } else {
          const thr = ops.getAttrOpt(it, 'throw');
          if (thr === undefined) throw val;
          y = callObj(thr, [val]);
        }
      } catch (e) {
        if (e instanceof PyBaseException && ops.isInstance(e, E.StopIteration)) {
          const v = e.extra && e.extra.value !== undefined ? e.extra.value : e.args.length > 0 ? e.args[0] : null;
          return v;
        }
        throw e;
      }
    }
    try {
      val = yield y;
      mode = 0;
    } catch (e) {
      if (e instanceof PyBaseException) {
        if (ops.isInstance(e, E.GeneratorExit)) {
          if (it instanceof PyGenerator) genClose(it);
          else {
            const c = ops.getAttrOpt(it, 'close');
            if (c !== undefined) callObj(c, []);
          }
          throw e;
        }
        mode = 1;
        val = e;
      } else throw e;
    }
  }
}

function awaitMsgError(x: any): never {
  throw typeError(`object ${typeOf(x).name} can't be used in 'await' expression`);
}

export function getAwaitIter(x: any): any {
  if (x instanceof PyGenerator && x.cls === coroutineType) return x;
  // generador marcado con types.coroutine
  if (x instanceof PyGenerator && x.frame.code.iterCoro) return x;
  const t = typeOf(x);
  const aw = t.lookup('__await__');
  if (aw === undefined) awaitMsgError(x);
  const it = callObj(aw, [x]);
  if (it instanceof PyGenerator) {
    if (it.cls === coroutineType) throw typeError('__await__() returned a coroutine');
    return it;
  }
  const itt = typeOf(it);
  if (itt.lookup('__next__') === undefined) throw typeError(`__await__() returned non-iterator of type '${itt.name}'`);
  return it;
}

export abstract class GenCompiler extends StmtCompiler {
  susp!: Suspend;

  suspends(n: Stmt | Expr): boolean {
    if (!this.susp) this.susp = new Suspend(this.table);
    return 'k' in n && isStmtKind(n.k) ? this.susp.stmt(n as Stmt) : this.susp.expr(n as Expr);
  }

  abstract syncComp(n: any): Ex;

  // ───────────── await / yield ─────────────

  awaitExpr(n: any): Ev {
    if (this.fs.kind === 'module' || this.fs.kind === 'class') this.syntaxError("'await' outside function", n);
    this.syntaxError("'await' outside async function", n);
  }
  yieldExpr(n: any): Ev {
    this.syntaxError("'yield' outside function", n);
  }

  // ───────────── bloques ─────────────

  genBlock(list: Stmt[]): GEx {
    type Item = { s: Ex } | { g: GEx };
    const items: Item[] = [];
    let pending: Ex[] = [];
    const flush = () => {
      if (pending.length > 0) {
        items.push({ s: this.seq(pending) });
        pending = [];
      }
    };
    for (const st of list) {
      if (this.suspends(st)) {
        flush();
        items.push({ g: this.genStmt(st) });
      } else {
        const e = this.stmt(st);
        if (e !== null) pending.push(e);
      }
    }
    flush();
    if (items.length === 1) {
      const it = items[0];
      if ('s' in it) { const s = it.s; return function* (f) { return s(f); }; }
      return it.g;
    }
    return function* (f) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const r = 's' in it ? it.s(f) : yield* it.g(f);
        if (r !== undefined) return r;
      }
      return undefined;
    };
  }

  /** cuerpo completo de una función generadora: devuelve la función del generador JS */
  genBody(list: Stmt[]): (f: Frame) => Generator<any, any, any> {
    const b = this.genBlock(list);
    return function* (f) {
      const r = yield* b(f);
      return r === SIG_RETURN ? f.ret : null;
    };
  }

  // ───────────── expresiones ─────────────

  tempRef(slot: number, like: Expr): Expr {
    return { k: 'TempRef', slot, line: like.line, col: like.col, endLine: like.endLine, endCol: like.endCol } as unknown as Expr;
  }

  /** hijos de un nodo en orden de evaluación, con función para reemplazarlos */
  mapChildren(n: Expr, fn: (c: Expr) => Expr): Expr {
    const m = (c: Expr | null): Expr | null => (c === null ? null : fn(c));
    switch (n.k) {
      case 'BinOp': return { ...n, left: fn(n.left), right: fn(n.right) };
      case 'UnaryOp': return { ...n, operand: fn(n.operand) };
      case 'Call': return { ...n, func: fn(n.func), args: n.args.map((a) => fn(a)), keywords: n.keywords.map((k) => ({ ...k, value: fn(k.value) })) };
      case 'Attribute': return { ...n, value: fn(n.value) };
      case 'Subscript': return { ...n, value: fn(n.value), slice: fn(n.slice) };
      case 'Slice': return { ...n, lower: m(n.lower), upper: m(n.upper), step: m(n.step) };
      case 'Tuple': case 'List': case 'Set': return { ...n, elts: n.elts.map((e) => fn(e)) } as Expr;
      case 'Dict': {
        const keys: (Expr | null)[] = [];
        const values: Expr[] = [];
        for (let i = 0; i < n.values.length; i++) {
          keys.push(m(n.keys[i]));
          values.push(fn(n.values[i]));
        }
        return { ...n, keys, values };
      }
      case 'Starred': return { ...n, value: fn(n.value) };
      case 'Compare': return { ...n, left: fn(n.left), comparators: n.comparators.map((c) => fn(c)) };
      case 'NamedExpr': return { ...n, value: fn(n.value) };
      default: return n;
    }
  }

  /** hijos en orden (misma secuencia que mapChildren) */
  childList(n: Expr): Expr[] {
    const out: Expr[] = [];
    this.mapChildren(n, (c) => { out.push(c); return c; });
    return out;
  }

  genExpr(n: Expr): GEv {
    switch (n.k) {
      case 'Await': {
        if (!this.fs.isAsync) {
          if (this.fs.kind === 'module' || this.fs.kind === 'class') this.syntaxError("'await' outside function", n);
          this.syntaxError("'await' outside async function", n);
        }
        const inner = this.suspends(n.value) ? this.genExpr(n.value) : null;
        const sync = inner ? null : this.expr(n.value);
        return function* (f) {
          const x = inner ? yield* inner(f) : sync!(f);
          f.pos = n;
          const it = getAwaitIter(x);
          return yield* delegate(it, true);
        };
      }
      case 'Yield': {
        const inner = n.value ? (this.suspends(n.value) ? this.genExpr(n.value) : null) : null;
        const sync = n.value && !inner ? this.expr(n.value) : null;
        const asyncGen = this.fs.isAsync;
        if (this.fs.kind === 'module' || this.fs.kind === 'class') this.syntaxError("'yield' outside function", n);
        return function* (f) {
          const v = inner ? yield* inner(f) : sync ? sync(f) : null;
          f.pos = n;
          const r = yield asyncGen ? new AGYield(v) : v;
          return r === undefined ? null : r;
        };
      }
      case 'YieldFrom': {
        if (this.fs.kind === 'module' || this.fs.kind === 'class') this.syntaxError("'yield' outside function", n);
        if (this.fs.isAsync) this.syntaxError("'yield from' inside async function", n);
        const inner = this.suspends(n.value) ? this.genExpr(n.value) : null;
        const sync = inner ? null : this.expr(n.value);
        return function* (f) {
          const x = inner ? yield* inner(f) : sync!(f);
          f.pos = n;
          const it = x instanceof PyGenerator ? x : ops.pyIter(x);
          return yield* delegate(it, false);
        };
      }
      case 'BoolOp': {
        const parts = n.values.map((v) => (this.suspends(v) ? { g: this.genExpr(v), s: null as Ev | null } : { g: null as GEv | null, s: this.expr(v) }));
        const isAnd = n.op === 'and';
        return function* (f) {
          let v: any = null;
          for (const p of parts) {
            v = p.g ? yield* p.g(f) : p.s!(f);
            const t = ops.truthy(v);
            if (isAnd ? !t : t) return v;
          }
          return v;
        };
      }
      case 'IfExp': {
        const t = this.suspends(n.test) ? this.genExpr(n.test) : null;
        const ts = t ? null : this.cond(n.test);
        const a = this.suspends(n.body) ? this.genExpr(n.body) : null;
        const as = a ? null : this.expr(n.body);
        const b = this.suspends(n.orelse) ? this.genExpr(n.orelse) : null;
        const bs = b ? null : this.expr(n.orelse);
        return function* (f) {
          const c = t ? ops.truthy(yield* t(f)) : ts!(f);
          if (c) return a ? yield* a(f) : as!(f);
          return b ? yield* b(f) : bs!(f);
        };
      }
      case 'Compare': {
        if (n.ops.length > 1) {
          // cadena con cortocircuito: se evalúa en pasos
          const left = this.suspends(n.left) ? { g: this.genExpr(n.left), s: null as Ev | null } : { g: null as GEv | null, s: this.expr(n.left) };
          const rest = n.comparators.map((c, i) => ({
            op: n.ops[i],
            g: this.suspends(c) ? this.genExpr(c) : null,
            s: this.suspends(c) ? null : this.expr(c),
          }));
          return function* (f) {
            let a = left.g ? yield* left.g(f) : left.s!(f);
            let res: any = true;
            for (const r of rest) {
              const b = r.g ? yield* r.g(f) : r.s!(f);
              f.pos = n;
              res = cmpOp(r.op, a, b);
              if (!ops.truthy(res)) return res;
              a = b;
            }
            return res;
          };
        }
        return this.genGeneric(n);
      }
      case 'NamedExpr': {
        const v = this.genExpr(n.value);
        const set = this.storeName(n.target.id, n.target);
        return function* (f) {
          const x = yield* v(f);
          set(f, x);
          return x;
        };
      }
      case 'JoinedStr': {
        const parts = n.values.map((p) => {
          if (p.k === 'Constant') { const s = p.value as string; return { g: null as GEv | null, s: (() => s) as Ev }; }
          if (this.suspends(p)) return { g: this.genExpr(p), s: null as Ev | null };
          return { g: null as GEv | null, s: this.formattedValueStr(p as any) as Ev };
        });
        return function* (f) {
          let out = '';
          for (const p of parts) out += p.g ? yield* p.g(f) : p.s!(f);
          return out;
        };
      }
      case 'FormattedValue': {
        const v = this.genExpr(n.value);
        const spec = n.formatSpec ? (this.suspends(n.formatSpec) ? this.genExpr(n.formatSpec) : null) : null;
        const specS = n.formatSpec && !spec ? this.joinedStr(n.formatSpec) : null;
        const conv = n.conversion;
        return function* (f) {
          let x = yield* v(f);
          const sp = spec ? yield* spec(f) : specS ? specS(f) : '';
          f.pos = n;
          if (conv === 115) x = ops.str(x);
          else if (conv === 114) x = ops.repr(x);
          else if (conv === 97) x = ops.ascii(x);
          return ops.formatValue(x, sp);
        };
      }
      case 'ListComp': case 'SetComp': case 'DictComp': case 'GeneratorExp': {
        const sc = this.table.byNode.get(n)!;
        const g0 = n.generators[0];
        const firstG = this.suspends(g0.iter) ? this.genExpr(g0.iter) : null;
        if (sc.isCoroutine && n.k !== 'GeneratorExp') {
          const firstS = firstG ? null : this.expr(g0.iter);
          const { code, freeNames } = this.compileFunctionLike(n, sc, '<comp>', this.qualnameFor('<comp>'));
          const getCells = this.closureBuilder(freeNames);
          return function* (f) {
            const src = firstG ? yield* firstG(f) : firstS!(f);
            f.pos = g0.iter;
            const l = new Array(code.nlocals);
            l[0] = src;
            for (const s of code.cellParams) { const c = new Cell(); c.v = l[s]; l[s] = c; }
            for (const s of code.cellVars) l[s] = new Cell();
            const fr = new Frame(code, l, f.g, f.b, f.back, getCells ? getCells(f) : null, null);
            const g = new PyGenerator(coroutineType, fr, code.name, code.qualname);
            fr.gen = g;
            return yield* delegate(g, true);
          };
        }
        if (!firstG) return this.syncAsGen(n);
        // la primera iterable espera: se evalúa en un temporal y la comprensión se compila con él
        const slot = this.fs.temp();
        const copy: any = { ...n, generators: [{ ...g0, iter: this.tempRef(slot, g0.iter) }, ...n.generators.slice(1)] };
        this.table.byNode.set(copy, sc);
        const ev = this.expr(copy);
        return function* (f) {
          f.l[slot] = yield* firstG(f);
          return ev(f);
        };
      }
      default:
        return this.genGeneric(n);
    }
  }

  syncAsGen(n: Expr): GEv {
    const e = this.expr(n);
    return function* (f) {
      return e(f);
    };
  }

  /** nodo cuyos hijos se evalúan en orden y luego se aplica la operación síncrona */
  genGeneric(n: Expr): GEv {
    const kids = this.childList(n);
    const target = (k: Expr): Expr => (k.k === 'Starred' ? k.value : k);
    let last = -1;
    kids.forEach((k, i) => { if (this.suspends(target(k))) last = i; });
    if (last < 0) return this.syncAsGen(n);
    const slots: number[] = [];
    for (let i = 0; i <= last; i++) slots.push(this.fs.temp());
    const evs = kids.slice(0, last + 1).map((k) => {
      const t = target(k);
      return this.suspends(t) ? { g: this.genExpr(t), s: null as Ev | null } : { g: null as GEv | null, s: this.expr(t) };
    });
    let idx = 0;
    const replaced = this.mapChildren(n, (c) => {
      const i = idx++;
      if (i > last) return c;
      return c.k === 'Starred' ? ({ ...c, value: this.tempRef(slots[i], c.value) } as Expr) : this.tempRef(slots[i], c);
    });
    const rest = this.expr(replaced);
    return function* (f) {
      for (let i = 0; i <= last; i++) {
        const e = evs[i];
        f.l[slots[i]] = e.g ? yield* e.g(f) : e.s!(f);
      }
      return rest(f);
    };
  }

  // ───────────── sentencias ─────────────

  genStmt(n: Stmt): GEx {
    switch (n.k) {
      case 'Expr': {
        const e = this.genExpr(n.value);
        const I = this.I;
        const repl = this.replMode && this.fs.kind === 'module';
        return function* (f) {
          const v = yield* e(f);
          if (repl) I.replValue = v;
          return undefined;
        };
      }
      case 'Assign': return this.genAssign(n);
      case 'AugAssign': return this.genAugAssign(n);
      case 'AnnAssign': return this.genAnnAssign(n);
      case 'Return': return this.genReturn(n);
      case 'If': return this.genIf(n);
      case 'While': return this.genWhile(n);
      case 'For': return this.genFor(n);
      case 'AsyncFor': return this.genAsyncFor(n as any);
      case 'With': return this.genWith(n, false);
      case 'AsyncWith': return this.genWith(n, true);
      case 'Try': return this.genTry(n);
      case 'TryStar': return this.genTry(n);
      case 'Raise': return this.genRaise(n);
      case 'Assert': return this.genAssert(n);
      case 'Delete': return this.genDelete(n);
      case 'Match': return this.genMatch(n);
      default:
        throw this.notSupported(n.k + ' con await/yield en esta posición');
    }
  }

  notSupported(what: string): Error {
    return new GenUnsupported(what);
  }

  condGen(t: Expr): { g: GEv | null; s: ((f: Frame) => boolean) | null } {
    return this.suspends(t) ? { g: this.genExpr(t), s: null } : { g: null, s: this.cond(t) };
  }

  genAssign(n: Assign): GEx {
    const v = this.genExpr(n.value);
    const sets = n.targets.map((t) => this.target(t));
    return function* (f) {
      const x = yield* v(f);
      for (const s of sets) s(f, x);
      return undefined;
    };
  }

  genAugAssign(n: AugAssign): GEx {
    const t = n.target;
    const rhs = this.genExpr(n.value);
    const op = n.op;
    if (t.k === 'Name') {
      const ld = this.loadName({ ...t, ctx: 'Load' });
      const st = this.storeName(t.id, t);
      return function* (f) {
        const a = ld(f);
        const b = yield* rhs(f);
        f.pos = n;
        st(f, ops.inplaceop(op, a, b));
        return undefined;
      };
    }
    if (t.k === 'Attribute') {
      const o = this.expr(t.value);
      return function* (f) {
        const obj = o(f);
        f.pos = t;
        const a = ops.getAttr(obj, t.attr);
        const b = yield* rhs(f);
        f.pos = n;
        ops.setAttr(obj, t.attr, ops.inplaceop(op, a, b));
        return undefined;
      };
    }
    if (t.k === 'Subscript') {
      const o = this.expr(t.value);
      const k = this.expr(t.slice);
      return function* (f) {
        const obj = o(f);
        const key = k(f);
        f.pos = t;
        const a = ops.getitem(obj, key);
        const b = yield* rhs(f);
        f.pos = n;
        ops.setitem(obj, key, ops.inplaceop(op, a, b));
        return undefined;
      };
    }
    this.syntaxError(`'${t.k}' is an illegal expression for augmented assignment`, t);
  }

  genAnnAssign(n: AnnAssign): GEx {
    const v = n.value ? this.genExpr(n.value) : null;
    const set = this.target(n.target);
    return function* (f) {
      if (v) set(f, yield* v(f));
      return undefined;
    };
  }

  genReturn(n: Return): GEx {
    if (this.fs.kind !== 'function' && this.fs.kind !== 'lambda') this.syntaxError("'return' outside function", n);
    if (this.fs.isAsync && this.fs.scope.hasYield && n.value) this.syntaxError("'return' with value in async generator", n);
    const v = n.value ? this.genExpr(n.value) : null;
    return function* (f) {
      f.ret = v ? yield* v(f) : null;
      return SIG_RETURN;
    };
  }

  genIf(n: If): GEx {
    const t = this.condGen(n.test);
    const body = this.genBlock(n.body);
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    return function* (f) {
      const c = t.g ? ops.truthy(yield* t.g(f)) : t.s!(f);
      if (c) return yield* body(f);
      return orelse ? yield* orelse(f) : undefined;
    };
  }

  genWhile(n: While): GEx {
    const I = this.I;
    const t = this.condGen(n.test);
    this.fs.loopDepth++;
    const body = this.genBlock(n.body);
    this.fs.loopDepth--;
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    return function* (f) {
      for (;;) {
        if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
        const c = t.g ? ops.truthy(yield* t.g(f)) : t.s!(f);
        if (!c) break;
        const r = yield* body(f);
        if (r !== undefined) {
          if (r === SIG_BREAK) return undefined;
          if (r === SIG_CONTINUE) continue;
          return r;
        }
      }
      return orelse ? yield* orelse(f) : undefined;
    };
  }

  genFor(n: For): GEx {
    const I = this.I;
    const iterG = this.suspends(n.iter) ? this.genExpr(n.iter) : null;
    const iterS = iterG ? null : this.expr(n.iter);
    const set = this.target(n.target);
    this.fs.loopDepth++;
    const body = this.genBlock(n.body);
    this.fs.loopDepth--;
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    const iterNode = n.iter;
    return function* (f) {
      const src = iterG ? yield* iterG(f) : iterS!(f);
      f.pos = iterNode;
      const it = ops.getIter(src);
      for (;;) {
        if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
        f.pos = iterNode;
        const v = it.next();
        if (v === undefined) break;
        set(f, v);
        const r = yield* body(f);
        if (r !== undefined) {
          if (r === SIG_BREAK) return undefined;
          if (r === SIG_CONTINUE) continue;
          return r;
        }
      }
      return orelse ? yield* orelse(f) : undefined;
    };
  }

  genAsyncFor(n: Stmt & { k: 'AsyncFor' }): GEx {
    if (!this.fs.isAsync) this.syntaxError("'async for' outside async function", n);
    const I = this.I;
    const iterG = this.suspends(n.iter) ? this.genExpr(n.iter) : null;
    const iterS = iterG ? null : this.expr(n.iter);
    const set = this.target(n.target);
    this.fs.loopDepth++;
    const body = this.genBlock(n.body);
    this.fs.loopDepth--;
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    const iterNode = n.iter;
    return function* (f) {
      const src = iterG ? yield* iterG(f) : iterS!(f);
      f.pos = iterNode;
      const ait = asyncIter(src);
      const anext = typeOf(ait).lookup('__anext__');
      if (anext === undefined) throw typeError("'async for' received an object from __aiter__ that does not implement __anext__: " + typeOf(ait).name);
      for (;;) {
        if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
        let v: any;
        try {
          f.pos = iterNode;
          const aw = callObj(anext, [ait]);
          v = yield* delegate(getAwaitIter(aw), true);
        } catch (e) {
          if (e instanceof PyBaseException && ops.isInstance(e, E.StopAsyncIteration)) break;
          throw e;
        }
        set(f, v);
        const r = yield* body(f);
        if (r !== undefined) {
          if (r === SIG_BREAK) return undefined;
          if (r === SIG_CONTINUE) continue;
          return r;
        }
      }
      return orelse ? yield* orelse(f) : undefined;
    };
  }

  genWith(n: With, isAsync: boolean): GEx {
    if (isAsync && !this.fs.isAsync) this.syntaxError("'async with' outside async function", n);
    const I = this.I;
    const items = n.items.map((it) => ({
      g: this.suspends(it.contextExpr) ? this.genExpr(it.contextExpr) : null,
      s: this.suspends(it.contextExpr) ? null : this.expr(it.contextExpr),
      node: it.contextExpr,
      set: it.optionalVars ? this.target(it.optionalVars) : null,
    }));
    const body = this.genBlock(n.body);
    const self = this;
    const run = (idx: number): GEx => {
      if (idx >= items.length) return body;
      const it = items[idx];
      const inner = run(idx + 1);
      return function* (f) {
        const mgr = it.g ? yield* it.g(f) : it.s!(f);
        f.pos = it.node;
        const { ctx, value: v0 } = rt.withEnter(mgr, isAsync);
        let value = v0;
        if (isAsync) value = yield* delegate(getAwaitIter(v0), true);
        let sig: number | undefined;
        try {
          if (it.set) it.set(f, value);
          sig = yield* inner(f);
        } catch (e0) {
          if (isInternalSignal(e0)) throw e0;
          const exc = self.caught(e0);
          if (exc instanceof PyBaseException && ops.isInstance(exc, E.GeneratorExit) && false) throw exc;
          addTb(exc, f);
          const prev = I.curExc;
          I.curExc = exc;
          let suppress: boolean;
          try {
            let r = rt.withExit(ctx, exc);
            if (isAsync) r = yield* delegate(getAwaitIter(r), true);
            suppress = ops.truthy(r);
          } finally {
            I.curExc = prev;
          }
          if (!suppress) throw exc;
          return undefined;
        }
        f.pos = it.node;
        let r = rt.withExit(ctx, null);
        if (isAsync) r = yield* delegate(getAwaitIter(r), true);
        return sig;
      };
    };
    return run(0);
  }

  genTry(n: Stmt & { k: 'Try' | 'TryStar' }): GEx {
    const I = this.I;
    const self = this;
    if (n.k === 'TryStar') return this.genTryStar(n);
    const body = this.genBlock(n.body);
    const handlers = n.handlers.map((h: ExceptHandler) => {
      const hh = this.handler(h, false);
      return { ...hh, gbody: this.genBlock(h.body), typeG: h.type && this.suspends(h.type) ? this.genExpr(h.type) : null };
    });
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    const finalbody = n.finalbody.length > 0 ? this.genBlock(n.finalbody) : null;
    const main: GEx = handlers.length === 0 ? body : function* (f) {
      let sig: number | undefined;
      try {
        sig = yield* body(f);
      } catch (e0) {
        if (isInternalSignal(e0)) throw e0;
        const exc = self.caught(e0);
        addTb(exc, f);
        for (const h of handlers) {
          let ok = true;
          if (h.type) {
            f.pos = h.node;
            const spec = h.typeG ? yield* h.typeG(f) : h.type(f);
            ok = rt.exceptMatch(exc, spec);
          }
          if (ok) {
            const prev = I.curExc;
            I.curExc = exc;
            try {
              if (h.set) h.set(f, exc);
              return yield* h.gbody(f);
            } finally {
              I.curExc = prev;
              if (h.name !== null) h.clear!(f);
            }
          }
        }
        throw exc;
      }
      if (orelse !== null && sig === undefined) return yield* orelse(f);
      return sig;
    };
    if (finalbody === null) return main;
    return function* (f) {
      let sig: number | undefined;
      let pending: any = NOEXC;
      try {
        sig = yield* main(f);
      } catch (e) {
        if (isInternalSignal(e)) throw e;
        pending = e;
      }
      let pendExc: PyBaseException | null = null;
      if (pending !== NOEXC) {
        pendExc = self.caughtOrNull(pending);
        if (pendExc === null) throw pending;
        if (pendExc.lastFrame !== f) addTb(pendExc, f);
      }
      const prev = I.curExc;
      if (pendExc !== null) I.curExc = pendExc;
      let fsig: number | undefined;
      try {
        fsig = yield* finalbody(f);
      } finally {
        I.curExc = prev;
      }
      if (fsig !== undefined) return fsig;
      if (pendExc !== null) throw pendExc;
      return sig;
    };
  }

  /** try / except* cuando el cuerpo o los manejadores contienen await o yield */
  genTryStar(n: Stmt & { k: 'Try' | 'TryStar' }): GEx {
    const I = this.I;
    const self = this;
    const body = this.genBlock(n.body);
    const handlers = n.handlers.map((h: ExceptHandler) => {
      const hh = this.handler(h, false);
      return { ...hh, gbody: this.genBlock(h.body), typeG: h.type && this.suspends(h.type) ? this.genExpr(h.type) : null };
    });
    const orelse = n.orelse.length > 0 ? this.genBlock(n.orelse) : null;
    const finalbody = n.finalbody.length > 0 ? this.genBlock(n.finalbody) : null;
    const main: GEx = function* (f) {
      let sig: number | undefined;
      try {
        sig = yield* body(f);
      } catch (e0) {
        if (isInternalSignal(e0)) throw e0;
        const exc0 = self.caught(e0);
        addTb(exc0, f);
        const st = new StarTry(exc0);
        const outerExc: any = I.curExc;
        I.curExc = exc0;
        try {
        for (const h of handlers) {
          if (st.exhausted) break;
          f.pos = h.node;
          const spec = h.typeG ? yield* h.typeG(f) : h.type!(f);
          const matched = st.match(spec);
          if (matched === null) continue;
          const prev: any = I.curExc;
          I.curExc = matched;
          try {
            if (h.set) h.set(f, matched);
            yield* h.gbody(f);
          } catch (e1) {
            if (isInternalSignal(e1)) throw e1;
            const ex1 = self.caught(e1);
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
      if (orelse !== null && sig === undefined) return yield* orelse(f);
      return sig;
    };
    if (finalbody === null) return main;
    return function* (f) {
      let sig: number | undefined;
      let pending: any = NOEXC;
      try {
        sig = yield* main(f);
      } catch (e) {
        if (isInternalSignal(e)) throw e;
        pending = e;
      }
      let pendExc: PyBaseException | null = null;
      if (pending !== NOEXC) {
        pendExc = self.caughtOrNull(pending);
        if (pendExc === null) throw pending;
        if (pendExc.lastFrame !== f) addTb(pendExc, f);
      }
      const prev = I.curExc;
      if (pendExc !== null) I.curExc = pendExc;
      let fsig: number | undefined;
      try {
        fsig = yield* finalbody(f);
      } finally {
        I.curExc = prev;
      }
      if (fsig !== undefined) return fsig;
      if (pendExc !== null) throw pendExc;
      return sig;
    };
  }

  caughtOrNull(e: unknown): PyBaseException | null {
    try {
      return this.caught(e);
    } catch {
      return null;
    }
  }

  genRaise(n: Raise): GEx {
    const exc = n.exc ? this.genExpr(n.exc) : null;
    const cause = n.cause ? this.genExpr(n.cause) : null;
    return function* (f) {
      if (!exc) {
        f.pos = n;
        return rt.doReraise();
      }
      const e = yield* exc(f);
      const c = cause ? yield* cause(f) : null;
      f.pos = n;
      return rt.doRaise(e, c, cause !== null);
    };
  }

  genAssert(n: Assert): GEx {
    const t = this.condGen(n.test);
    const msg = n.msg ? this.genExpr(n.msg) : null;
    return function* (f) {
      const c = t.g ? ops.truthy(yield* t.g(f)) : t.s!(f);
      if (c) return undefined;
      const args = msg ? [yield* msg(f)] : [];
      f.pos = n;
      const e = require('./runtime/errors').assertionError('');
      e.args = args;
      throw e;
    };
  }

  genDelete(n: Delete): GEx {
    const dels = n.targets.map((t) => this.delTarget(t));
    return function* (f) {
      for (const d of dels) d(f);
      return undefined;
    };
  }

  genMatch(n: Match): GEx {
    const subject = this.genExpr(n.subject);
    const cases = n.cases.map((c) => ({
      pat: this.pattern(c.pattern),
      guard: c.guard ? this.condGen(c.guard) : null,
      body: this.genBlock(c.body),
    }));
    return function* (f) {
      const s = yield* subject(f);
      for (const c of cases) {
        if (!c.pat(f, s)) continue;
        if (c.guard) {
          const ok = c.guard.g ? ops.truthy(yield* c.guard.g(f)) : c.guard.s!(f);
          if (!ok) continue;
        }
        return yield* c.body(f);
      }
      return undefined;
    };
  }

  // ───────────── comprensiones como generadores ─────────────

  /** cuerpo (generador JS) de una expresión generadora o comprensión asíncrona */
  genComp(n: any, scope: Scope): (f: Frame) => Generator<any, any, any> {
    const I = this.I;
    const gens = n.generators as { target: Expr; iter: Expr; ifs: Expr[]; isAsync: boolean }[];
    const kind = n.k as 'ListComp' | 'SetComp' | 'DictComp' | 'GeneratorExp';
    const asyncGen = scope.isCoroutine && kind === 'GeneratorExp';
    const fs = this.fs;
    const resSlot = fs.temp();
    const eltG = kind === 'DictComp' ? null : this.suspends(n.elt) ? this.genExpr(n.elt) : null;
    const eltS = kind === 'DictComp' || eltG ? null : this.expr(n.elt);
    const keyG = kind === 'DictComp' && this.suspends(n.key) ? this.genExpr(n.key) : null;
    const keyS = kind === 'DictComp' && !keyG ? this.expr(n.key) : null;
    const valG = kind === 'DictComp' && this.suspends(n.value) ? this.genExpr(n.value) : null;
    const valS = kind === 'DictComp' && !valG ? this.expr(n.value) : null;
    const setters = gens.map((g) => this.target(g.target));
    const iterG = gens.map((g, i) => (i > 0 && this.suspends(g.iter) ? this.genExpr(g.iter) : null));
    const iterS = gens.map((g, i) => (i > 0 && !this.suspends(g.iter) ? this.expr(g.iter) : null));
    const conds = gens.map((g) => g.ifs.map((c) => this.condGen(c)));
    const iterNodes = gens.map((g) => g.iter);
    const node = n;
    const level = (i: number): ((f: Frame) => Generator<any, void, any>) => {
      const last = i === gens.length - 1;
      const inner = last ? null : level(i + 1);
      const isAsync = gens[i].isAsync;
      return function* (f) {
        let src: any;
        if (i === 0) src = f.l[0];
        else src = iterG[i] ? yield* iterG[i]!(f) : iterS[i]!(f);
        f.pos = iterNodes[i];
        let it: any;
        let anext: any;
        if (isAsync) {
          it = asyncIter(src);
          anext = typeOf(it).lookup('__anext__');
          if (anext === undefined) throw typeError("'async for' received an object from __aiter__ that does not implement __anext__: " + typeOf(it).name);
        } else it = i === 0 ? src : ops.getIter(src);
        for (;;) {
          if (++I.steps > I.nextCheck) { f.pos = n; I.tickSlow(); }
          let v: any;
          if (isAsync) {
            try {
              v = yield* delegate(getAwaitIter(callObj(anext, [it])), true);
            } catch (e) {
              if (e instanceof PyBaseException && ops.isInstance(e, E.StopAsyncIteration)) break;
              throw e;
            }
          } else {
            f.pos = iterNodes[i];
            v = it.next();
            if (v === undefined) break;
          }
          setters[i](f, v);
          let ok = true;
          for (const c of conds[i]) {
            const r = c.g ? ops.truthy(yield* c.g(f)) : c.s!(f);
            if (!r) { ok = false; break; }
          }
          if (!ok) continue;
          if (inner) {
            yield* inner(f);
          } else {
            if (kind === 'GeneratorExp') {
              const e = eltG ? yield* eltG(f) : eltS!(f);
              f.pos = node;
              yield asyncGen ? new AGYield(e) : e;
            } else if (kind === 'ListComp') {
              (f.l[resSlot] as PyList).a.push(eltG ? yield* eltG(f) : eltS!(f));
            } else if (kind === 'SetComp') {
              const e = eltG ? yield* eltG(f) : eltS!(f);
              f.pos = node;
              (f.l[resSlot] as PySet).add(e);
            } else {
              const k = keyG ? yield* keyG(f) : keyS!(f);
              const val = valG ? yield* valG(f) : valS!(f);
              f.pos = node;
              (f.l[resSlot] as PyDict).set(k, val);
            }
          }
        }
      };
    };
    const loop = level(0);
    return function* (f) {
      if (kind === 'ListComp') f.l[resSlot] = new PyList([]);
      else if (kind === 'SetComp') f.l[resSlot] = new PySet(false);
      else if (kind === 'DictComp') f.l[resSlot] = new PyDict();
      yield* loop(f);
      return kind === 'GeneratorExp' ? null : f.l[resSlot];
    };
  }
}

export class StarMarker {
  constructor(public v: any) {}
}

export class GenUnsupported extends Error {
  constructor(public what: string) {
    super('NotImplementedError: ' + what);
  }
}

function cmpOp(op: string, a: any, b: any): any {
  switch (op) {
    case 'is': return a === b;
    case 'is not': return a !== b;
    case 'in': return ops.contains(b, a);
    case 'not in': return !ops.contains(b, a);
    default: return ops.richCompare(op, a, b);
  }
}

function asyncIter(x: any): any {
  const t = typeOf(x);
  const f = t.lookup('__aiter__');
  if (f === undefined) throw typeError(`'async for' requires an object with __aiter__ method, got ${t.name}`);
  return callObj(f, [x]);
}

function isStmtKind(k: string): boolean {
  switch (k) {
    case 'FunctionDef': case 'AsyncFunctionDef': case 'ClassDef': case 'Return': case 'Delete': case 'Assign': case 'TypeAlias':
    case 'AugAssign': case 'AnnAssign': case 'For': case 'AsyncFor': case 'While': case 'If': case 'With': case 'AsyncWith':
    case 'Match': case 'Raise': case 'Try': case 'TryStar': case 'Assert': case 'Import': case 'ImportFrom': case 'Global':
    case 'Nonlocal': case 'Expr': case 'Pass': case 'Break': case 'Continue':
      return true;
    default: return false;
  }
}

void PyObject;
void PyTuple;
void pyConst;
void stopIteration;
void callObj;
