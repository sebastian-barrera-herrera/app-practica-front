/**
 * Análisis de ámbitos (tabla de símbolos), como `symtable` de CPython: decide si cada nombre es local, celda,
 * libre, global o de espacio de nombres, y detecta los errores de ámbito (`global`/`nonlocal`, argumentos duplicados…).
 *
 * Las comprensiones son ámbitos de función propios (como en CPython ≤ 3.11); el compilador las ejecuta
 * como llamadas a una función auxiliar.
 */
import type { Arg, Arguments, Comprehension, Expr, ExceptHandler, MatchCase, Module, Pattern, Pos, Stmt, TypeParam } from './ast';
import { PySyntaxErr } from './lexer';

export type ScopeKind = 'module' | 'eval' | 'function' | 'lambda' | 'class' | 'genexp' | 'comp' | 'typeparams';

// indicadores de símbolo
const F_ASSIGN = 1;
const F_PARAM = 2;
const F_GLOBAL = 4;
const F_NONLOCAL = 8;
const F_USED = 16;
const F_IMPORT = 32;
const F_ANNOT = 64;

export type Resolution = 'local' | 'cell' | 'free' | 'global' | 'name';

export interface Sym {
  name: string;
  flags: number;
  firstUse: Pos | null;
  firstAssign: Pos | null;
  res: Resolution;
}

export class Scope {
  syms = new Map<string, Sym>();
  children: Scope[] = [];
  /** nombres libres (en orden) que este ámbito toma de ámbitos externos */
  freeList: string[] = [];
  isGenerator = false;
  isCoroutine = false;
  hasAwait = false;
  hasYield = false;
  /** (función) usa super() sin argumentos o __class__ */
  usesClassCell = false;
  /** (clase) algún método necesita la celda __class__ */
  needsClassCell = false;
  paramNames: string[] = [];
  /** ranuras de variables locales (las asigna el compilador) */
  slots = new Map<string, number>();
  nslots = 0;
  constructor(public kind: ScopeKind, public node: any, public parent: Scope | null, public name: string) {}
  get isFunctionLike(): boolean {
    return this.kind === 'function' || this.kind === 'lambda' || this.kind === 'genexp' || this.kind === 'comp' || this.kind === 'typeparams';
  }
  sym(name: string): Sym {
    let s = this.syms.get(name);
    if (!s) {
      s = { name, flags: 0, firstUse: null, firstAssign: null, res: 'name' };
      this.syms.set(name, s);
    }
    return s;
  }
  /** resolución de un nombre usado en este ámbito */
  resolve(name: string): Resolution {
    const s = this.syms.get(name);
    if (s) return s.res;
    return this.kind === 'module' || this.kind === 'eval' || this.kind === 'class' ? 'name' : 'global';
  }
}

export interface ScopeTable {
  root: Scope;
  byNode: Map<any, Scope>;
}

function err(msg: string, p: Pos): never {
  throw new PySyntaxErr('SyntaxError', msg, p.line, p.col, p.endLine, p.endCol);
}

/** Construye la tabla de símbolos de un módulo (o de una expresión para eval). */
export function buildScopes(mod: Module, kind: 'module' | 'eval' = 'module'): ScopeTable {
  const byNode = new Map<any, Scope>();
  const root = new Scope(kind, mod, null, '<module>');
  byNode.set(mod, root);
  const b = new Builder(byNode);
  b.stmts(mod.body, root);
  analyze(root, new Set());
  return { root, byNode };
}

class Builder {
  constructor(private byNode: Map<any, Scope>) {}

  newScope(kind: ScopeKind, node: any, parent: Scope, name: string): Scope {
    const s = new Scope(kind, node, parent, name);
    parent.children.push(s);
    this.byNode.set(node, s);
    return s;
  }

  use(s: Scope, name: string, p: Pos): void {
    const sym = s.sym(name);
    sym.flags |= F_USED;
    if (!sym.firstUse) sym.firstUse = p;
  }

  assign(s: Scope, name: string, p: Pos, flag = F_ASSIGN): void {
    const sym = s.sym(name);
    if (!sym.firstAssign) sym.firstAssign = p;
    sym.flags |= flag;
  }

  /** destino de := dentro de comprensiones: se enlaza en el ámbito envolvente que no es comprensión */
  walrusTarget(s: Scope, name: string, p: Pos): void {
    if (s.kind !== 'comp' && s.kind !== 'genexp') {
      this.assign(s, name, p);
      return;
    }
    let t: Scope = s;
    while ((t.kind === 'comp' || t.kind === 'genexp') && t.parent) {
      const sym = t.syms.get(name);
      if (sym && sym.flags & F_ASSIGN && !(sym.flags & F_NONLOCAL) && !(sym.flags & F_GLOBAL)) {
        err(`assignment expression cannot rebind comprehension iteration variable '${name}'`, p);
      }
      t = t.parent;
    }
    if (t.kind === 'class') err('assignment expression within a comprehension cannot be used in a class body', p);
    this.assign(t, name, p);
    // en cada ámbito intermedio el nombre es "nonlocal" (o global si el destino es el módulo)
    let u: Scope = s;
    while (u !== t) {
      const sym = u.sym(name);
      sym.flags |= t.kind === 'module' || t.kind === 'eval' ? F_GLOBAL : F_NONLOCAL;
      u = u.parent!;
    }
  }

  stmts(list: Stmt[], s: Scope): void {
    for (const st of list) this.stmt(st, s);
  }

  stmt(n: Stmt, s: Scope): void {
    switch (n.k) {
      case 'FunctionDef':
      case 'AsyncFunctionDef': {
        for (const d of n.decorators) this.expr(d, s);
        this.argDefaults(n.args, s);
        this.assign(s, (n as any).bind ?? n.name, n);
        let outer = s;
        if (n.typeParams.length > 0) {
          outer = this.newScope('typeparams', n.typeParams, s, '<generic parameters of ' + n.name + '>');
          this.typeParams(n.typeParams, outer);
        }
        this.argAnnotations(n.args, outer);
        if (n.returns) this.expr(n.returns, outer);
        const fs = this.newScope('function', n, outer, n.name);
        fs.isCoroutine = n.k === 'AsyncFunctionDef';
        this.declareParams(n.args, fs);
        this.stmts(n.body, fs);
        return;
      }
      case 'ClassDef': {
        for (const d of n.decorators) this.expr(d, s);
        this.assign(s, (n as any).bind ?? n.name, n);
        let outer = s;
        if (n.typeParams.length > 0) {
          outer = this.newScope('typeparams', n.typeParams, s, '<generic parameters of ' + n.name + '>');
          this.typeParams(n.typeParams, outer);
        }
        for (const b of n.bases) this.expr(b, outer);
        for (const k of n.keywords) this.expr(k.value, outer);
        const cs = this.newScope('class', n, outer, n.name);
        this.stmts(n.body, cs);
        return;
      }
      case 'Return':
        if (n.value) this.expr(n.value, s);
        return;
      case 'Delete':
        for (const t of n.targets) this.target(t, s);
        return;
      case 'Assign':
        this.expr(n.value, s);
        for (const t of n.targets) this.target(t, s);
        return;
      case 'TypeAlias': {
        this.assign(s, n.name.id, n);
        let outer = s;
        if (n.typeParams.length > 0) {
          outer = this.newScope('typeparams', n.typeParams, s, '<generic parameters of ' + n.name.id + '>');
          this.typeParams(n.typeParams, outer);
        }
        const ls = this.newScope('lambda', n, outer, n.name.id);
        this.expr(n.value, ls);
        return;
      }
      case 'AugAssign':
        this.expr(n.value, s);
        if (n.target.k === 'Name') {
          this.use(s, n.target.id, n.target);
          this.assign(s, n.target.id, n.target);
        } else this.expr(n.target, s);
        return;
      case 'AnnAssign':
        if (n.value) this.expr(n.value, s);
        if (n.target.k === 'Name') {
          this.assign(s, n.target.id, n.target, n.value ? F_ASSIGN : F_ASSIGN | F_ANNOT);
        } else this.expr(n.target, s);
        this.expr(n.annotation, s);
        return;
      case 'For':
      case 'AsyncFor':
        this.expr(n.iter, s);
        this.target(n.target, s);
        this.stmts(n.body, s);
        this.stmts(n.orelse, s);
        if (n.k === 'AsyncFor') s.hasAwait = true;
        return;
      case 'While':
        this.expr(n.test, s);
        this.stmts(n.body, s);
        this.stmts(n.orelse, s);
        return;
      case 'If':
        this.expr(n.test, s);
        this.stmts(n.body, s);
        this.stmts(n.orelse, s);
        return;
      case 'With':
      case 'AsyncWith':
        for (const it of n.items) {
          this.expr(it.contextExpr, s);
          if (it.optionalVars) this.target(it.optionalVars, s);
        }
        this.stmts(n.body, s);
        if (n.k === 'AsyncWith') s.hasAwait = true;
        return;
      case 'Match':
        this.expr(n.subject, s);
        for (const c of n.cases) this.matchCase(c, s);
        return;
      case 'Raise':
        if (n.exc) this.expr(n.exc, s);
        if (n.cause) this.expr(n.cause, s);
        return;
      case 'Try':
      case 'TryStar':
        this.stmts(n.body, s);
        for (const h of n.handlers) this.handler(h, s);
        this.stmts(n.orelse, s);
        this.stmts(n.finalbody, s);
        return;
      case 'Assert':
        this.expr(n.test, s);
        if (n.msg) this.expr(n.msg, s);
        return;
      case 'Import':
        for (const a of n.names) this.assign(s, a.asname ?? a.name.split('.')[0], a, F_ASSIGN | F_IMPORT);
        return;
      case 'ImportFrom':
        for (const a of n.names) {
          if (a.name === '*') {
            if (s.kind !== 'module') err('import * only allowed at module level', n);
            continue;
          }
          this.assign(s, a.asname ?? a.name, a, F_ASSIGN | F_IMPORT);
        }
        return;
      case 'Global':
        for (const name of n.names) {
          const sym = s.sym(name);
          if (sym.flags & F_PARAM) err(`name '${name}' is parameter and global`, n);
          if (sym.flags & F_NONLOCAL) err(`name '${name}' is nonlocal and global`, n);
          if (sym.flags & F_ASSIGN) err(`name '${name}' is assigned to before global declaration`, n);
          if (sym.flags & F_USED) err(`name '${name}' is used prior to global declaration`, n);
          if (sym.flags & F_ANNOT) err(`annotated name '${name}' can't be global`, n);
          sym.flags |= F_GLOBAL;
        }
        return;
      case 'Nonlocal':
        if (s.kind === 'module') err('nonlocal declaration not allowed at module level', n);
        for (const name of n.names) {
          const sym = s.sym(name);
          if (sym.flags & F_PARAM) err(`name '${name}' is parameter and nonlocal`, n);
          if (sym.flags & F_GLOBAL) err(`name '${name}' is nonlocal and global`, n);
          if (sym.flags & F_ASSIGN) err(`name '${name}' is assigned to before nonlocal declaration`, n);
          if (sym.flags & F_USED) err(`name '${name}' is used prior to nonlocal declaration`, n);
          if (sym.flags & F_ANNOT) err(`annotated name '${name}' can't be nonlocal`, n);
          sym.flags |= F_NONLOCAL;
        }
        return;
      case 'Expr':
        this.expr(n.value, s);
        return;
      case 'Pass':
      case 'Break':
      case 'Continue':
        return;
    }
  }

  handler(h: ExceptHandler, s: Scope): void {
    if (h.type) this.expr(h.type, s);
    if (h.name) this.assign(s, h.name, h);
    this.stmts(h.body, s);
  }

  matchCase(c: MatchCase, s: Scope): void {
    this.pattern(c.pattern, s);
    if (c.guard) this.expr(c.guard, s);
    this.stmts(c.body, s);
  }

  pattern(p: Pattern, s: Scope): void {
    switch (p.k) {
      case 'MatchValue': this.expr(p.value, s); return;
      case 'MatchSingleton': return;
      case 'MatchSequence': for (const x of p.patterns) this.pattern(x, s); return;
      case 'MatchMapping':
        for (const k of p.keys) this.expr(k, s);
        for (const x of p.patterns) this.pattern(x, s);
        if (p.rest) this.assign(s, p.rest, p);
        return;
      case 'MatchClass':
        this.expr(p.cls, s);
        for (const x of p.patterns) this.pattern(x, s);
        for (const x of p.kwdPatterns) this.pattern(x, s);
        return;
      case 'MatchStar': if (p.name) this.assign(s, p.name, p); return;
      case 'MatchAs':
        if (p.pattern) this.pattern(p.pattern, s);
        if (p.name) this.assign(s, p.name, p);
        return;
      case 'MatchOr': for (const x of p.patterns) this.pattern(x, s); return;
    }
  }

  typeParams(ps: TypeParam[], s: Scope): void {
    for (const p of ps) {
      this.assign(s, p.name, p);
      if (p.bound) {
        const ls = this.newScope('lambda', p.bound, s, p.name);
        this.expr(p.bound, ls);
      }
      if (p.defaultValue) {
        const ls = this.newScope('lambda', p.defaultValue, s, p.name);
        this.expr(p.defaultValue, ls);
      }
    }
  }

  argDefaults(a: Arguments, s: Scope): void {
    for (const d of a.defaults) this.expr(d, s);
    for (const d of a.kwDefaults) if (d) this.expr(d, s);
  }
  argAnnotations(a: Arguments, s: Scope): void {
    const all: Arg[] = [...a.posonlyargs, ...a.args, ...a.kwonlyargs];
    if (a.vararg) all.push(a.vararg);
    if (a.kwarg) all.push(a.kwarg);
    for (const x of all) if (x.annotation) this.expr(x.annotation, s);
  }
  declareParams(a: Arguments, fs: Scope): void {
    const all: Arg[] = [...a.posonlyargs, ...a.args, ...a.kwonlyargs];
    if (a.vararg) all.push(a.vararg);
    if (a.kwarg) all.push(a.kwarg);
    const seen = new Set<string>();
    for (const p of all) {
      if (seen.has(p.arg)) err(`duplicate argument '${p.arg}' in function definition`, p);
      seen.add(p.arg);
      this.assign(fs, p.arg, p, F_ASSIGN | F_PARAM);
      fs.paramNames.push(p.arg);
    }
  }

  target(t: Expr, s: Scope): void {
    switch (t.k) {
      case 'Name': this.assign(s, t.id, t); return;
      case 'Tuple':
      case 'List': for (const e of t.elts) this.target(e, s); return;
      case 'Starred': this.target(t.value, s); return;
      default: this.expr(t, s);
    }
  }

  comprehension(n: Expr & { generators: Comprehension[] }, s: Scope, bodyFn: (cs: Scope) => void, kind: 'comp' | 'genexp'): void {
    const gens = n.generators;
    // la primera iterable se evalúa en el ámbito exterior
    this.expr(gens[0].iter, s);
    const cs = this.newScope(kind, n, s, kind === 'genexp' ? '<genexpr>' : '<comp>');
    cs.paramNames.push('.0');
    this.assign(cs, '.0', n, F_ASSIGN | F_PARAM);
    for (let i = 0; i < gens.length; i++) {
      const g = gens[i];
      if (i > 0) this.expr(g.iter, cs);
      this.target(g.target, cs);
      for (const c of g.ifs) this.expr(c, cs);
      if (g.isAsync) { cs.isCoroutine = true; cs.hasAwait = true; }
    }
    bodyFn(cs);
    if (cs.hasAwait) cs.isCoroutine = true;
    if (cs.hasYield) err("'yield' inside " + (kind === 'genexp' ? 'generator expression' : n.k === 'ListComp' ? 'list comprehension' : n.k === 'SetComp' ? 'set comprehension' : 'dict comprehension'), n);
  }

  expr(n: Expr, s: Scope): void {
    switch (n.k) {
      case 'Constant': return;
      case 'Name':
        if (n.ctx === 'Load') {
          this.use(s, n.id, n);
          if (n.id === 'super' || n.id === '__class__') this.noteSuper(s);
        } else this.assign(s, n.id, n);
        return;
      case 'BoolOp': for (const v of n.values) this.expr(v, s); return;
      case 'NamedExpr':
        this.expr(n.value, s);
        this.walrusTarget(s, n.target.id, n.target);
        return;
      case 'BinOp': this.expr(n.left, s); this.expr(n.right, s); return;
      case 'UnaryOp': this.expr(n.operand, s); return;
      case 'Lambda': {
        this.argDefaults(n.args, s);
        const ls = this.newScope('lambda', n, s, '<lambda>');
        this.declareParams(n.args, ls);
        this.expr(n.body, ls);
        return;
      }
      case 'IfExp': this.expr(n.test, s); this.expr(n.body, s); this.expr(n.orelse, s); return;
      case 'Dict':
        for (let i = 0; i < n.values.length; i++) {
          const k = n.keys[i];
          if (k) this.expr(k, s);
          this.expr(n.values[i], s);
        }
        return;
      case 'Set': for (const e of n.elts) this.expr(e, s); return;
      case 'List': case 'Tuple': for (const e of n.elts) this.expr(e, s); return;
      case 'ListComp':
      case 'SetComp':
        this.comprehension(n, s, (cs) => this.expr(n.elt, cs), 'comp');
        return;
      case 'DictComp':
        this.comprehension(n, s, (cs) => { this.expr(n.key, cs); this.expr(n.value, cs); }, 'comp');
        return;
      case 'GeneratorExp':
        this.comprehension(n, s, (cs) => this.expr(n.elt, cs), 'genexp');
        return;
      case 'Await':
        s.hasAwait = true;
        this.expr(n.value, s);
        return;
      case 'Yield':
      case 'YieldFrom':
        s.hasYield = true;
        if (n.value) this.expr(n.value, s);
        return;
      case 'Compare':
        this.expr(n.left, s);
        for (const c of n.comparators) this.expr(c, s);
        return;
      case 'Call':
        this.expr(n.func, s);
        for (const a of n.args) this.expr(a, s);
        for (const k of n.keywords) this.expr(k.value, s);
        return;
      case 'FormattedValue':
        this.expr(n.value, s);
        if (n.formatSpec) this.expr(n.formatSpec, s);
        return;
      case 'JoinedStr': for (const v of n.values) this.expr(v, s); return;
      case 'Attribute': this.expr(n.value, s); return;
      case 'Subscript': this.expr(n.value, s); this.expr(n.slice, s); return;
      case 'Starred': this.expr(n.value, s); return;
      case 'Slice':
        if (n.lower) this.expr(n.lower, s);
        if (n.upper) this.expr(n.upper, s);
        if (n.step) this.expr(n.step, s);
        return;
    }
  }

  /** `super` / `__class__` dentro de un método: la función necesita la celda de clase */
  noteSuper(s: Scope): void {
    let t: Scope | null = s;
    while (t) {
      if (t.kind === 'function' || t.kind === 'lambda') {
        // buscar clase envolvente (saltando funciones intermedias: super() solo funciona en el método directo,
        // pero __class__ se puede capturar desde funciones internas)
        let u: Scope | null = t.parent;
        while (u && u.kind === 'typeparams') u = u.parent;
        if (u && u.kind === 'class') {
          t.usesClassCell = true;
          u.needsClassCell = true;
          return;
        }
        // función interna de un método
        let v: Scope | null = t.parent;
        while (v && v.kind !== 'class' && v.kind !== 'module') v = v.parent;
        if (v && v.kind === 'class') {
          t.usesClassCell = true;
          v.needsClassCell = true;
        }
        return;
      }
      if (t.kind === 'class' || t.kind === 'module') return;
      t = t.parent;
    }
  }
}

// ───────────────────────── análisis ─────────────────────────

/**
 * Resuelve los símbolos del ámbito y de sus hijos.
 * `bound`: nombres enlazados en ámbitos de función envolventes (visibles como libres).
 * Devuelve el conjunto de nombres que este ámbito toma de fuera (libres).
 */
function analyze(s: Scope, bound: Set<string>): Set<string> {
  const freeOut = new Set<string>();
  const locals = new Set<string>();
  // 1. clasificar símbolos propios
  for (const sym of s.syms.values()) {
    const name = sym.name;
    if (sym.flags & F_GLOBAL) {
      sym.res = 'global';
      continue;
    }
    if (sym.flags & F_NONLOCAL) {
      if (!bound.has(name)) err(`no binding for nonlocal '${name}' found`, sym.firstAssign ?? sym.firstUse ?? (s.node as Pos));
      sym.res = 'free';
      freeOut.add(name);
      continue;
    }
    if (sym.flags & (F_ASSIGN | F_PARAM | F_IMPORT)) {
      if (s.kind === 'class' || s.kind === 'module' || s.kind === 'eval') sym.res = 'name';
      else {
        sym.res = 'local';
        locals.add(name);
      }
      continue;
    }
    // solo usado
    if (s.kind !== 'module' && s.kind !== 'eval' && bound.has(name)) {
      sym.res = 'free';
      freeOut.add(name);
    } else sym.res = s.kind === 'module' || s.kind === 'eval' || s.kind === 'class' ? 'name' : 'global';
  }
  // 2. hijos
  let childBound: Set<string>;
  if (s.kind === 'class') {
    childBound = new Set(bound);
    if (s.needsClassCell) childBound.add('__class__');
  } else if (s.kind === 'module' || s.kind === 'eval') {
    childBound = new Set();
  } else {
    childBound = new Set(bound);
    for (const n of locals) childBound.add(n);
  }
  for (const c of s.children) {
    // el cuerpo de una función sobre parámetros de tipo ve los enlaces de ese ámbito
    const cf = analyze(c, childBound);
    for (const n of cf) {
      const sym = s.syms.get(n);
      if (n === '__class__' && s.kind === 'class') {
        const sy = s.sym('__class__');
        sy.res = 'cell';
        continue;
      }
      if (s.kind === 'class') {
        if (sym && (sym.flags & (F_ASSIGN | F_PARAM | F_IMPORT)) && !(sym.flags & (F_GLOBAL | F_NONLOCAL))) {
          // el nombre de la clase no es visible para ámbitos internos: sigue siendo libre hacia fuera si existe
          if (bound.has(n)) freeOut.add(n);
          continue;
        }
        if (sym && sym.res === 'free') continue;
        if (bound.has(n)) {
          const sy = s.sym(n);
          if (sy.res === 'name' && !(sy.flags & (F_ASSIGN | F_PARAM | F_IMPORT | F_GLOBAL))) sy.res = 'free';
          if (!(sy.flags & (F_GLOBAL))) freeOut.add(n);
        }
        continue;
      }
      if (s.kind === 'module' || s.kind === 'eval') continue;
      if (sym && sym.res === 'local') {
        sym.res = 'cell';
        continue;
      }
      if (sym && (sym.res === 'cell' || sym.res === 'free' || sym.res === 'global')) {
        if (sym.res === 'free') freeOut.add(n);
        continue;
      }
      if (bound.has(n)) {
        const sy = s.sym(n);
        sy.res = 'free';
        freeOut.add(n);
      }
    }
  }
  // 3. celda de clase para super()/__class__
  if (s.usesClassCell && s.isFunctionLike && bound.has('__class__')) {
    const sy = s.sym('__class__');
    if (!(sy.flags & (F_ASSIGN | F_PARAM | F_IMPORT | F_GLOBAL))) {
      sy.res = 'free';
      freeOut.add('__class__');
    }
  }
  s.freeList = Array.from(s.syms.values()).filter((x) => x.res === 'free').map((x) => x.name);
  return freeOut;
}
