/**
 * Compilador: AST → Code (closures). Punto de entrada `compileSource`.
 */
import type { Expr, Module, Stmt } from './ast';
import { PySyntaxErr } from './lexer';
import { parseSource, type ParseMode, type ParseWarning } from './parser';
import { buildScopes, Scope } from './scope';
import {
  Cell, Frame, PyFunction, PyGenerator, PyDict, PyList, PySet, SIG_RETURN, type Code, type Ev, type Ex,
} from './runtime/objects';
import { functionType, generatorType, listType, typeOf } from './runtime/builtin_types';
import * as ops from './runtime/ops';
import { callFunction, runFrame } from './runtime/call';
import type { Interp } from './runtime/interp';
import { FnState, type CompileEnv } from './compile_expr';
import { GenCompiler } from './compile_gen';

export interface CompiledUnit {
  code: Code;
  warnings: ParseWarning[];
  lines: string[];
}

class Compiler extends GenCompiler {
  compileFunctionLike(node: any, scope: Scope, name: string, qualname: string): { code: Code; freeNames: string[] } {
    const saved = this.fs;
    const savedQual = this.qualStack;
    const kind: Code['kind'] = scope.kind === 'lambda' ? 'lambda' : scope.kind === 'genexp' ? 'genexp' : 'function';
    const fs = new FnState(scope, kind);
    this.fs = fs;
    this.qualStack = [...savedQual, qualname];
    for (const p of scope.paramNames) fs.slot(p);
    scope.freeList.forEach((nm, i) => fs.freeIdx.set(nm, i));
    for (const s of scope.syms.values()) if (s.res === 'local' || s.res === 'cell') fs.slot(s.name);
    const isGenExp = scope.kind === 'genexp';
    const isGen = scope.hasYield || scope.isCoroutine || isGenExp;
    fs.isGen = isGen;
    fs.isAsync = scope.isCoroutine;
    let body: Ex | null = null;
    let genBody: ((f: Frame) => Generator<any, any, any>) | null = null;
    let doc: string | null = null;
    const args = node.args;
    const isComp = scope.kind === 'comp';
    if (node.k === 'FunctionDef' || node.k === 'AsyncFunctionDef') {
      let list: Stmt[] = node.body;
      if (list.length > 0 && list[0].k === 'Expr' && list[0].value.k === 'Constant' && list[0].value.vt === 'str') {
        doc = list[0].value.value as string;
        list = list.slice(1);
      }
      if (isGen) genBody = this.genBody(list);
      else body = this.block(list);
    } else if (node.k === 'Lambda') {
      const ret: Stmt = { k: 'Return', value: node.body, line: node.line, col: node.col, endLine: node.endLine, endCol: node.endCol };
      if (isGen) genBody = this.genBody([ret]);
      else body = this.block([ret]);
    } else if (isComp || isGenExp) {
      if (isGenExp || isGen) genBody = this.genComp(node, scope);
      else body = this.syncComp(node);
    } else if (node.k === 'TypeAlias') {
      const ret: Stmt = { k: 'Return', value: node.value, line: node.line, col: node.col, endLine: node.endLine, endCol: node.endCol };
      body = this.block([ret]);
    } else {
      // expresión suelta (límite o valor por defecto de parámetro de tipo)
      const e = this.expr(node as Expr);
      body = (f) => { f.ret = e(f); return SIG_RETURN; };
    }
    const hasArgs = args && args.posonlyargs !== undefined;
    const posonly = hasArgs ? args.posonlyargs.length : 0;
    const npos = hasArgs ? posonly + args.args.length : isComp || isGenExp ? 1 : 0;
    const nkwonly = hasArgs ? args.kwonlyargs.length : 0;
    const hasVarargs = hasArgs && args.vararg !== null;
    const hasVarkw = hasArgs && args.kwarg !== null;
    const cellParams: number[] = [];
    const cellVars: number[] = [];
    for (const s of scope.syms.values()) {
      if (s.res !== 'cell') continue;
      const slot = fs.slot(s.name);
      if (scope.paramNames.indexOf(s.name) >= 0) cellParams.push(slot);
      else cellVars.push(slot);
    }
    const paramNames = scope.paramNames.slice(0, npos + nkwonly);
    const code: Code = {
      name: isComp ? ((node.k === 'ListComp') ? '<listcomp>' : (node.k === 'SetComp') ? '<setcomp>' : '<dictcomp>') : isGenExp ? '<genexpr>' : name,
      qualname: isComp ? qualname : qualname,
      filename: this.filename,
      firstLine: node.line,
      varnames: fs.varnames,
      nlocals: fs.varnames.length,
      argcount: npos,
      posonlyCount: posonly,
      kwonlyCount: nkwonly,
      varargsSlot: hasVarargs ? npos + nkwonly : -1,
      varkwSlot: hasVarkw ? npos + nkwonly + (hasVarargs ? 1 : 0) : -1,
      paramNames,
      cellParams,
      cellVars,
      freeNames: scope.freeList,
      isGenerator: isGen,
      isCoroutine: scope.isCoroutine && !scope.hasYield,
      isAsyncGen: scope.isCoroutine && scope.hasYield,
      body,
      genBody,
      doc,
      simple: !hasVarargs && !hasVarkw && nkwonly === 0,
      lines: this.lines,
      hidden: this.hidden,
      usesClassCell: scope.usesClassCell,
      classFree: -1,
      kind,
      classCellSlot: -1,
    };
    if (isComp) code.inlined = true;
    if (isGenExp && scope.isCoroutine) { code.isAsyncGen = true; code.isCoroutine = false; }
    code.nlocals = fs.varnames.length;
    this.fs = saved;
    this.qualStack = savedQual;
    return { code, freeNames: scope.freeList };
  }

  /** comprensión (lista/conjunto/diccionario) síncrona: el bucle vive en una función auxiliar */
  syncComp(n: any): Ex {
    const gens = n.generators as { target: Expr; iter: Expr; ifs: Expr[]; isAsync: boolean }[];
    const I = this.I;
    const fs = this.fs;
    const resSlot = fs.temp();
    const kind = n.k as 'ListComp' | 'SetComp' | 'DictComp';
    const elt = kind === 'DictComp' ? null : this.expr(n.elt);
    const keyEv = kind === 'DictComp' ? this.expr(n.key) : null;
    const valEv = kind === 'DictComp' ? this.expr(n.value) : null;
    const setters = gens.map((g) => this.target(g.target));
    const iters = gens.map((g, i) => (i === 0 ? null : this.expr(g.iter)));
    const conds = gens.map((g) => g.ifs.map((c) => this.cond(c)));
    const iterNodes = gens.map((g) => g.iter);
    const nodeForErr = n;
    const addItem: (f: Frame) => void = kind === 'ListComp'
      ? (f) => { (f.l[resSlot] as PyList).a.push(elt!(f)); }
      : kind === 'SetComp'
        ? (f) => { f.pos = nodeForErr; (f.l[resSlot] as PySet).add(elt!(f)); }
        : (f) => { const k = keyEv!(f); const v = valEv!(f); f.pos = nodeForErr; (f.l[resSlot] as PyDict).set(k, v); };
    const level = (i: number): ((f: Frame) => void) => {
      const last = i === gens.length - 1;
      const inner = last ? addItem : level(i + 1);
      const set = setters[i];
      const cs = conds[i];
      const iterEv = iters[i];
      const iterNode = iterNodes[i];
      return (f) => {
        const src = iterEv === null ? f.l[0] : iterEv(f);
        f.pos = iterNode;
        const it = iterEv === null ? src : ops.getIter(src);
        for (;;) {
          if (++I.steps > I.nextCheck) I.tickSlow();
          f.pos = iterNode;
          const v = it.next();
          if (v === undefined) break;
          set(f, v);
          let ok = true;
          for (let k = 0; k < cs.length; k++) if (!cs[k](f)) { ok = false; break; }
          if (ok) inner(f);
        }
      };
    };
    const loop = level(0);
    const make = kind === 'ListComp' ? () => new PyList([]) : kind === 'SetComp' ? () => new PySet(false) : () => new PyDict();
    return (f) => {
      f.l[resSlot] = make();
      loop(f);
      f.ret = f.l[resSlot];
      return SIG_RETURN;
    };
  }

  compComprehension(n: any): Ev {
    const sc = this.table.byNode.get(n)!;
    const first = this.expr(n.generators[0].iter);
    const iterNode = n.generators[0].iter;
    const { code, freeNames } = this.compileFunctionLike(n, sc, '<comp>', this.qualnameFor('<comp>'));
    const getCells = this.closureBuilder(freeNames);
    const isGenExp = n.k === 'GeneratorExp';
    const isAsync = sc.isCoroutine;
    return (f) => {
      const src = first(f);
      f.pos = iterNode;
      // las comprensiones asíncronas reciben el iterable tal cual (se recorre con __aiter__)
      const it = isAsync ? src : ops.getIter(src);
      const free = getCells ? getCells(f) : null;
      if (isGenExp || isAsync) {
        const l = new Array(code.nlocals);
        l[0] = it;
        for (const s of code.cellParams) { const c = new Cell(); c.v = l[s]; l[s] = c; }
        for (const s of code.cellVars) l[s] = new Cell();
        const fr = new Frame(code, l, f.g, f.b, this.I.frame, free, null);
        const tp = code.isAsyncGen ? typeAsyncGen() : code.isCoroutine ? typeCoroutine() : generatorType;
        const g = new PyGenerator(tp, fr, code.name, code.qualname);
        fr.gen = g;
        return g;
      }
      const fn = new PyFunction(functionType, code, f.g, f.b, null, null, free);
      return callFunction(fn, [it], null);
    };
  }
}

import { asyncGeneratorType, coroutineType } from './runtime/builtin_types';
function typeAsyncGen() {
  return asyncGeneratorType;
}
function typeCoroutine() {
  return coroutineType;
}

// ───────────────────────── punto de entrada ─────────────────────────

export interface CompileOptions {
  filename: string;
  mode?: ParseMode;
  hidden?: boolean;
  repl?: boolean;
}

export function checkFuture(mod: Module): { annotations: boolean } {
  let annotations = false;
  let allowed = true;
  const known = new Set(['nested_scopes', 'generators', 'division', 'absolute_import', 'with_statement', 'print_function', 'unicode_literals', 'barry_as_FLUFL', 'generator_stop', 'annotations']);
  for (let i = 0; i < mod.body.length; i++) {
    const s = mod.body[i];
    if (i === 0 && s.k === 'Expr' && s.value.k === 'Constant' && s.value.vt === 'str') continue;
    if (s.k === 'ImportFrom' && s.module === '__future__' && s.level === 0) {
      if (!allowed) throw new PySyntaxErr('SyntaxError', 'from __future__ imports must occur at the beginning of the file', s.line, s.col, s.endLine, s.endCol);
      for (const a of s.names) {
        if (a.name === 'annotations') annotations = true;
        else if (!known.has(a.name)) {
          if (a.name === '*') throw new PySyntaxErr('SyntaxError', "future feature * is not defined", a.line, a.col, a.endLine, a.endCol);
          throw new PySyntaxErr('SyntaxError', `future feature ${a.name} is not defined`, s.line, s.col, s.endLine, s.endCol);
        }
      }
    } else allowed = false;
  }
  return { annotations };
}

/** Parsea, analiza y compila un texto fuente. Lanza PySyntaxErr. */
export function compileSource(I: Interp, source: string, o: CompileOptions): CompiledUnit {
  const mode = o.mode ?? 'exec';
  const parsed = parseSource(source, mode);
  const lines = parsed.src.split('\n');
  I.sources.set(o.filename, lines);
  return compileModule(I, parsed.module, lines, parsed.warnings, o);
}

/** Compila un módulo ya analizado (o construido a partir de un árbol de `ast`) */
export function compileModule(I: Interp, mod: Module, lines: string[], warnings: ParseWarning[], o: CompileOptions): CompiledUnit {
  const mode = o.mode ?? 'exec';
  const table = buildScopes(mod, mode === 'eval' ? 'eval' : 'module');
  const fut = checkFuture(mod);
  const env: CompileEnv = {
    I, filename: o.filename, lines, table, hidden: !!o.hidden, futureAnnotations: fut.annotations, replMode: !!o.repl,
  };
  const c = new Compiler(env);
  const fs = new FnState(table.root, 'module');
  c.fs = fs;
  let list: Stmt[] = mod.body;
  let docEx: Ex | null = null;
  if (mode !== 'eval') {
    let doc: string | null = null;
    if (list.length > 0 && list[0].k === 'Expr' && list[0].value.k === 'Constant' && list[0].value.vt === 'str') {
      doc = list[0].value.value as string;
    }
    if (!o.repl) docEx = (f) => { if (f.g.get('__doc__') === undefined || true) f.g.set('__doc__', doc); return undefined; };
  }
  let body: Ex;
  if (mode === 'eval') {
    const e = c.expr((mod.body[0] as any).value);
    body = (f) => { f.ret = e(f); return SIG_RETURN; };
  } else {
    const b = c.block(list);
    body = docEx ? (f) => { docEx!(f); return b(f); } : b;
  }
  const code: Code = c.simpleCode(fs, '<module>');
  code.kind = mode === 'eval' ? 'eval' : 'module';
  code.body = body;
  code.nlocals = fs.varnames.length;
  code.qualname = '<module>';
  void typeOf;
  void listType;
  return { code, warnings, lines };
}

/** Ejecuta un Code de módulo/exec/eval con los diccionarios dados */
export function runCode(I: Interp, code: Code, g: PyDict, ns?: PyDict | null): any {
  const f = new Frame(code, new Array(code.nlocals), g, I.builtins, null, null, null, ns ?? g);
  return runFrame(f, code.body!);
}

export { PySyntaxErr };
