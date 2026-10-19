/**
 * Conversión entre el AST interno (ast.ts) y los objetos del módulo `ast` de Python (clases de pylib/_ast.py).
 * `parseToPy` devuelve el árbol como objetos de Python; `treeToModule` hace el camino inverso para `compile(arbol, ...)`.
 * Los desplazamientos de columna de Python son bytes UTF-8; el AST interno usa unidades UTF-16.
 */
import type { Module } from '../ast';
import { PyBytes, PyComplex, PyFloat, PyList, PyObject, PyType } from './objects';
import { Ellipsis, bytesType, typeOf } from './builtin_types';
import * as ops from './ops';
import { importModule } from './modules';
import { typeError, valueError } from './errors';
import type { Interp } from './interp';

/** código de campo: n = nodo, n? = opcional, n* = lista, n?* = lista con huecos, id/id?/id* = texto, i = entero, b = booleano→0/1 */
type FieldDef = [py: string, ts: string, code: string, hint?: string];
interface NodeDef {
  fields: FieldDef[];
  /** el nodo lleva lineno/col_offset/end_lineno/end_col_offset */
  pos: boolean;
  /** clase de Python (si el valor de `k` no coincide con ella) */
  py?: string;
  /** familia de la que depende la comprobación de posiciones ('stmt' | 'expr' | ...) */
  fam?: string;
}

const F = (py: string, code: string, ts: string = py, hint?: string): FieldDef => [py, ts, code, hint];

const DEFS: Record<string, NodeDef> = {
  // ── expresiones ──
  Name: { pos: true, fam: 'expr', fields: [F('id', 'id'), F('ctx', 'ctx')] },
  BoolOp: { pos: true, fam: 'expr', fields: [F('op', 'bool'), F('values', 'n*')] },
  NamedExpr: { pos: true, fam: 'expr', fields: [F('target', 'n'), F('value', 'n')] },
  BinOp: { pos: true, fam: 'expr', fields: [F('left', 'n'), F('op', 'bin'), F('right', 'n')] },
  UnaryOp: { pos: true, fam: 'expr', fields: [F('op', 'un'), F('operand', 'n')] },
  Lambda: { pos: true, fam: 'expr', fields: [F('args', 'n', 'args', 'arguments'), F('body', 'n')] },
  IfExp: { pos: true, fam: 'expr', fields: [F('test', 'n'), F('body', 'n'), F('orelse', 'n')] },
  Dict: { pos: true, fam: 'expr', fields: [F('keys', 'n?*'), F('values', 'n*')] },
  Set: { pos: true, fam: 'expr', fields: [F('elts', 'n*')] },
  ListComp: { pos: true, fam: 'expr', fields: [F('elt', 'n'), F('generators', 'n*', 'generators', 'comprehension')] },
  SetComp: { pos: true, fam: 'expr', fields: [F('elt', 'n'), F('generators', 'n*', 'generators', 'comprehension')] },
  DictComp: { pos: true, fam: 'expr', fields: [F('key', 'n'), F('value', 'n'), F('generators', 'n*', 'generators', 'comprehension')] },
  GeneratorExp: { pos: true, fam: 'expr', fields: [F('elt', 'n'), F('generators', 'n*', 'generators', 'comprehension')] },
  Await: { pos: true, fam: 'expr', fields: [F('value', 'n')] },
  Yield: { pos: true, fam: 'expr', fields: [F('value', 'n?')] },
  YieldFrom: { pos: true, fam: 'expr', fields: [F('value', 'n')] },
  Compare: { pos: true, fam: 'expr', fields: [F('left', 'n'), F('ops', 'cmp*'), F('comparators', 'n*')] },
  Call: { pos: true, fam: 'expr', fields: [F('func', 'n'), F('args', 'n*'), F('keywords', 'n*', 'keywords', 'keyword')] },
  FormattedValue: { pos: true, fam: 'expr', fields: [F('value', 'n'), F('conversion', 'i'), F('format_spec', 'n?', 'formatSpec')] },
  JoinedStr: { pos: true, fam: 'expr', fields: [F('values', 'n*')] },
  Attribute: { pos: true, fam: 'expr', fields: [F('value', 'n'), F('attr', 'id'), F('ctx', 'ctx')] },
  Subscript: { pos: true, fam: 'expr', fields: [F('value', 'n'), F('slice', 'n'), F('ctx', 'ctx')] },
  Starred: { pos: true, fam: 'expr', fields: [F('value', 'n'), F('ctx', 'ctx')] },
  List: { pos: true, fam: 'expr', fields: [F('elts', 'n*'), F('ctx', 'ctx')] },
  Tuple: { pos: true, fam: 'expr', fields: [F('elts', 'n*'), F('ctx', 'ctx')] },
  Slice: { pos: true, fam: 'expr', fields: [F('lower', 'n?'), F('upper', 'n?'), F('step', 'n?')] },
  // ── sentencias ──
  FunctionDef: { pos: true, fam: 'stmt', fields: [F('name', 'id'), F('args', 'n', 'args', 'arguments'), F('body', 'n*'), F('decorator_list', 'n*', 'decorators'), F('returns', 'n?'), F('type_params', 'n*', 'typeParams')] },
  AsyncFunctionDef: { pos: true, fam: 'stmt', fields: [F('name', 'id'), F('args', 'n', 'args', 'arguments'), F('body', 'n*'), F('decorator_list', 'n*', 'decorators'), F('returns', 'n?'), F('type_params', 'n*', 'typeParams')] },
  ClassDef: { pos: true, fam: 'stmt', fields: [F('name', 'id'), F('bases', 'n*'), F('keywords', 'n*', 'keywords', 'keyword'), F('body', 'n*'), F('decorator_list', 'n*', 'decorators'), F('type_params', 'n*', 'typeParams')] },
  Return: { pos: true, fam: 'stmt', fields: [F('value', 'n?')] },
  Delete: { pos: true, fam: 'stmt', fields: [F('targets', 'n*')] },
  Assign: { pos: true, fam: 'stmt', fields: [F('targets', 'n*'), F('value', 'n')] },
  TypeAlias: { pos: true, fam: 'stmt', fields: [F('name', 'n'), F('type_params', 'n*', 'typeParams'), F('value', 'n')] },
  AugAssign: { pos: true, fam: 'stmt', fields: [F('target', 'n'), F('op', 'bin'), F('value', 'n')] },
  AnnAssign: { pos: true, fam: 'stmt', fields: [F('target', 'n'), F('annotation', 'n'), F('value', 'n?'), F('simple', 'b')] },
  For: { pos: true, fam: 'stmt', fields: [F('target', 'n'), F('iter', 'n'), F('body', 'n*'), F('orelse', 'n*')] },
  AsyncFor: { pos: true, fam: 'stmt', fields: [F('target', 'n'), F('iter', 'n'), F('body', 'n*'), F('orelse', 'n*')] },
  While: { pos: true, fam: 'stmt', fields: [F('test', 'n'), F('body', 'n*'), F('orelse', 'n*')] },
  If: { pos: true, fam: 'stmt', fields: [F('test', 'n'), F('body', 'n*'), F('orelse', 'n*')] },
  With: { pos: true, fam: 'stmt', fields: [F('items', 'n*', 'items', 'withitem'), F('body', 'n*')] },
  AsyncWith: { pos: true, fam: 'stmt', fields: [F('items', 'n*', 'items', 'withitem'), F('body', 'n*')] },
  Match: { pos: true, fam: 'stmt', fields: [F('subject', 'n'), F('cases', 'n*', 'cases', 'match_case')] },
  Raise: { pos: true, fam: 'stmt', fields: [F('exc', 'n?'), F('cause', 'n?')] },
  Try: { pos: true, fam: 'stmt', fields: [F('body', 'n*'), F('handlers', 'n*', 'handlers', 'excepthandler'), F('orelse', 'n*'), F('finalbody', 'n*')] },
  TryStar: { pos: true, fam: 'stmt', fields: [F('body', 'n*'), F('handlers', 'n*', 'handlers', 'excepthandler'), F('orelse', 'n*'), F('finalbody', 'n*')] },
  Assert: { pos: true, fam: 'stmt', fields: [F('test', 'n'), F('msg', 'n?')] },
  Import: { pos: true, fam: 'stmt', fields: [F('names', 'n*', 'names', 'alias')] },
  ImportFrom: { pos: true, fam: 'stmt', fields: [F('module', 'id?'), F('names', 'n*', 'names', 'alias'), F('level', 'i')] },
  Global: { pos: true, fam: 'stmt', fields: [F('names', 'id*')] },
  Nonlocal: { pos: true, fam: 'stmt', fields: [F('names', 'id*')] },
  Expr: { pos: true, fam: 'stmt', fields: [F('value', 'n')] },
  Pass: { pos: true, fam: 'stmt', fields: [] },
  Break: { pos: true, fam: 'stmt', fields: [] },
  Continue: { pos: true, fam: 'stmt', fields: [] },
  // ── estructuras auxiliares ──
  comprehension: { pos: false, fields: [F('target', 'n'), F('iter', 'n'), F('ifs', 'n*'), F('is_async', 'b', 'isAsync')] },
  excepthandler: { pos: true, py: 'ExceptHandler', fam: 'excepthandler', fields: [F('type', 'n?'), F('name', 'id?'), F('body', 'n*')] },
  arguments: { pos: false, fields: [F('posonlyargs', 'n*', 'posonlyargs', 'arg'), F('args', 'n*', 'args', 'arg'), F('vararg', 'n?', 'vararg', 'arg'), F('kwonlyargs', 'n*', 'kwonlyargs', 'arg'), F('kw_defaults', 'n?*', 'kwDefaults'), F('kwarg', 'n?', 'kwarg', 'arg'), F('defaults', 'n*')] },
  arg: { pos: true, fam: 'arg', fields: [F('arg', 'id'), F('annotation', 'n?')] },
  keyword: { pos: true, fam: 'keyword', fields: [F('arg', 'id?'), F('value', 'n')] },
  alias: { pos: true, fam: 'alias', fields: [F('name', 'id'), F('asname', 'id?')] },
  withitem: { pos: false, fields: [F('context_expr', 'n', 'contextExpr'), F('optional_vars', 'n?', 'optionalVars')] },
  match_case: { pos: false, fields: [F('pattern', 'n'), F('guard', 'n?'), F('body', 'n*')] },
  MatchValue: { pos: true, fam: 'pattern', fields: [F('value', 'n')] },
  MatchSingleton: { pos: true, fam: 'pattern', fields: [F('value', 'v')] },
  MatchSequence: { pos: true, fam: 'pattern', fields: [F('patterns', 'n*')] },
  MatchMapping: { pos: true, fam: 'pattern', fields: [F('keys', 'n*'), F('patterns', 'n*'), F('rest', 'id?')] },
  MatchClass: { pos: true, fam: 'pattern', fields: [F('cls', 'n'), F('patterns', 'n*'), F('kwd_attrs', 'id*', 'kwdAttrs'), F('kwd_patterns', 'n*', 'kwdPatterns')] },
  MatchStar: { pos: true, fam: 'pattern', fields: [F('name', 'id?')] },
  MatchAs: { pos: true, fam: 'pattern', fields: [F('pattern', 'n?'), F('name', 'id?')] },
  MatchOr: { pos: true, fam: 'pattern', fields: [F('patterns', 'n*')] },
  TypeVar: { pos: true, fam: 'type_param', fields: [F('name', 'id'), F('bound', 'n?'), F('default_value', 'n?', 'defaultValue')] },
  ParamSpec: { pos: true, fam: 'type_param', fields: [F('name', 'id'), F('default_value', 'n?', 'defaultValue')] },
  TypeVarTuple: { pos: true, fam: 'type_param', fields: [F('name', 'id'), F('default_value', 'n?', 'defaultValue')] },
};

const PY_CLASS: Record<string, string> = { excepthandler: 'ExceptHandler' };
/** nodos del AST interno que no llevan `k` */
const STRUCTS = new Set(['comprehension', 'excepthandler', 'arguments', 'arg', 'keyword', 'alias', 'withitem', 'match_case']);
/** nodos que en CPython guardan `type_comment=None` en su __dict__ */
const TYPE_COMMENT = new Set(['FunctionDef', 'AsyncFunctionDef', 'Assign', 'For', 'AsyncFor', 'With', 'AsyncWith', 'arg']);

const BIN: Record<string, string> = {
  '+': 'Add', '-': 'Sub', '*': 'Mult', '/': 'Div', '//': 'FloorDiv', '%': 'Mod', '**': 'Pow', '@': 'MatMult',
  '&': 'BitAnd', '|': 'BitOr', '^': 'BitXor', '<<': 'LShift', '>>': 'RShift',
};
const UN: Record<string, string> = { not: 'Not', '-': 'USub', '+': 'UAdd', '~': 'Invert' };
const BOOL: Record<string, string> = { and: 'And', or: 'Or' };
const CMP: Record<string, string> = {
  '==': 'Eq', '!=': 'NotEq', '<': 'Lt', '<=': 'LtE', '>': 'Gt', '>=': 'GtE', is: 'Is', 'is not': 'IsNot', in: 'In', 'not in': 'NotIn',
};
const invert = (m: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]));
const BIN_R = invert(BIN);
const UN_R = invert(UN);
const BOOL_R = invert(BOOL);
const CMP_R = invert(CMP);

const POS_FIELDS = ['lineno', 'col_offset', 'end_lineno', 'end_col_offset'];

/** desplazamiento en bytes UTF-8 de la columna UTF-16 `col` de `line` */
function byteCol(line: string | undefined, col: number): number {
  if (line === undefined || col <= 0) return col;
  // sólo hace falta recodificar si hay caracteres no ASCII antes de la columna
  let ascii = true;
  const n = Math.min(col, line.length);
  for (let i = 0; i < n; i++) if (line.charCodeAt(i) > 0x7f) { ascii = false; break; }
  if (ascii) return col;
  let b = 0;
  for (let i = 0; i < n; i++) {
    const c = line.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c < 0xdc00) { b += 4; i++; } else b += 3;
  }
  return b + Math.max(0, col - line.length);
}

/** columna UTF-16 equivalente a un desplazamiento en bytes UTF-8 */
function charCol(line: string | undefined, off: number): number {
  if (line === undefined || off <= 0) return off;
  let b = 0;
  let i = 0;
  while (i < line.length && b < off) {
    const c = line.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c < 0xdc00) { b += 4; i++; } else b += 3;
    i++;
  }
  return i + Math.max(0, off - b);
}

class ToPy {
  private classes = new Map<string, PyType>();
  private singles = new Map<string, any>();
  constructor(private I: Interp, private lines: string[]) {}

  private mod(): any {
    return importModule(this.I, '_ast');
  }

  cls(name: string): PyType {
    let c = this.classes.get(name);
    if (c === undefined) {
      c = this.mod().dict.get(name);
      if (!(c instanceof PyType)) throw typeError(`ast: falta la clase ${name}`);
      this.classes.set(name, c);
    }
    return c;
  }

  single(name: string): any {
    let o = this.singles.get(name);
    if (o === undefined) {
      o = ops.typeCall(this.cls(name), [], null);
      this.singles.set(name, o);
    }
    return o;
  }

  private pos(o: any, n: any): void {
    const lineText = this.lines[n.line - 1];
    const endText = this.lines[n.endLine - 1];
    ops.setAttr(o, 'lineno', n.line);
    ops.setAttr(o, 'col_offset', byteCol(lineText, n.col));
    ops.setAttr(o, 'end_lineno', n.endLine);
    ops.setAttr(o, 'end_col_offset', byteCol(endText, n.endCol));
  }

  value(code: string, v: any): any {
    switch (code) {
      case 'id': case 'id?': case 'i': return v === undefined ? null : v;
      case 'b': return v ? 1 : 0;
      case 'v': return v;
      case 'id*': return new PyList(v.slice());
      case 'ctx': return this.single(v);
      case 'bin': return this.single(BIN[v]);
      case 'un': return this.single(UN[v]);
      case 'bool': return this.single(BOOL[v]);
      case 'cmp*': return new PyList((v as string[]).map((x) => this.single(CMP[x])));
      default: return null;
    }
  }

  node(n: any, hint?: string): any {
    if (n === null || n === undefined) return null;
    if (n.k === 'Constant') return this.constant(n);
    const name = n.k ?? hint;
    if (name === undefined) throw typeError('ast: nodo desconocido');
    const def = DEFS[name];
    if (def === undefined) throw typeError(`ast: nodo no soportado ${name}`);
    const o = ops.typeCall(this.cls(def.py ?? PY_CLASS[name] ?? name), [], null);
    for (const [py, ts, code, hint] of def.fields) {
      const v = (n as any)[ts];
      if (v === undefined && code !== 'id?' && code !== 'n?' && code !== 'v') throw new Error(`AST interno: falta el campo ${ts} en ${name}: ${JSON.stringify(n, (_k, x) => (typeof x === "bigint" ? String(x) : x)).slice(0, 300)}`);
      let out: any;
      if (code === 'n') out = this.node(v, hint);
      else if (code === 'n?') out = v === null || v === undefined ? null : this.node(v, hint);
      else if (code === 'n*' || code === 'n?*') {
        out = new PyList((v as any[]).map((x) => (x === null ? null : this.node(x, hint))));
      } else out = this.value(code, v);
      ops.setAttr(o, py, out);
      if (py === 'annotation' && name === 'arg') ops.setAttr(o, 'type_comment', null);
    }
    if (TYPE_COMMENT.has(name) && name !== 'arg') ops.setAttr(o, 'type_comment', null);
    if (def.pos) this.pos(o, n);
    return o;
  }

  constant(n: any): any {
    let v: any;
    switch (n.vt) {
      case 'int': v = n.value; break;
      case 'float': v = new PyFloat(n.value); break;
      case 'complex': v = new PyComplex(0, n.value); break;
      case 'str': v = n.value; break;
      case 'bytes': v = new PyBytes(n.value, bytesType); break;
      case 'bool': v = n.value; break;
      case 'none': v = null; break;
      default: v = Ellipsis;
    }
    const o = ops.typeCall(this.cls('Constant'), [], null);
    ops.setAttr(o, 'value', v);
    ops.setAttr(o, 'kind', null);
    this.pos(o, n);
    return o;
  }
}

/** Árbol de Python (objetos de `_ast`) de un módulo ya analizado */
export function moduleToPy(I: Interp, mod: Module, lines: string[], mode: 'exec' | 'eval' | 'single'): any {
  const c = new ToPy(I, lines);
  if (mode === 'eval') {
    const first = mod.body[0] as any;
    const o = ops.typeCall(c.cls('Expression'), [], null);
    ops.setAttr(o, 'body', c.node(first.value));
    return o;
  }
  const body = new PyList(mod.body.map((s) => c.node(s)));
  const o = ops.typeCall(c.cls(mode === 'single' ? 'Interactive' : 'Module'), [], null);
  ops.setAttr(o, 'body', body);
  if (mode !== 'single') ops.setAttr(o, 'type_ignores', new PyList([]));
  return o;
}

// ───────────────────────── Python → AST interno ─────────────────────────

class FromPy {
  private tsOf = new Map<string, string>();
  constructor(private I: Interp) {
    for (const k of Object.keys(DEFS)) this.tsOf.set(DEFS[k].py ?? PY_CLASS[k] ?? k, k);
    void this.I;
  }

  private attr(o: any, name: string, family: string): any {
    const v = ops.getAttrOpt(o, name);
    if (v === undefined) throw typeError(`required field "${name}" missing from ${family}`);
    return v;
  }

  private pos(o: any, fam: string, out: any): void {
    out.line = this.attr(o, 'lineno', fam);
    out.col = this.attr(o, 'col_offset', fam);
    const el = ops.getAttrOpt(o, 'end_lineno');
    const ec = ops.getAttrOpt(o, 'end_col_offset');
    out.endLine = el === undefined || el === null ? out.line : el;
    out.endCol = ec === undefined || ec === null ? out.col : ec;
  }

  private enumName(o: any, table: Record<string, string>, what: string): string {
    const n = typeOf(o).name;
    const r = table[n];
    if (r === undefined) throw typeError(`expected some sort of ${what}, but got ${ops.repr(o)}`);
    return r;
  }

  private list(o: any, field: string, owner: string): any[] {
    const v = this.attr(o, field, owner);
    if (!(v instanceof PyList)) throw typeError(`${owner} field "${field}" must be a list, not a ${typeOf(v).name}`);
    return v.a;
  }

  node(o: any, expect?: string): any {
    if (o === null || o === undefined) return null;
    const cname = typeOf(o).name;
    if (!(o instanceof PyObject)) throw typeError(`expected some sort of ${expect ?? 'expr'}, but got ${ops.repr(o)}`);
    if (cname === 'Constant') return this.constant(o);
    // las subclases de las clases estándar se tratan como la clase base con nodo conocido
    let name = cname;
    if (!this.tsOf.has(name)) {
      for (const t of typeOf(o).mro) if (this.tsOf.has(t.name)) { name = t.name; break; }
    }
    const k = this.tsOf.get(name);
    if (k === undefined) throw typeError(`expected some sort of ${expect ?? 'expr'}, but got ${ops.repr(o)}`);
    const def = DEFS[k];
    const out: any = {};
    if (!STRUCTS.has(k)) out.k = k;
    for (const [py, ts, code, hint] of def.fields) {
      const owner = def.fam ?? name;
      out[ts] = this.field(o, py, code, owner, hint);
    }
    if (def.pos) this.pos(o, def.fam ?? name, out);
    return out;
  }

  private field(o: any, py: string, code: string, owner: string, hint?: string): any {
    switch (code) {
      case 'n': return this.node(this.attr(o, py, owner), hint);
      case 'n?': {
        const v = ops.getAttrOpt(o, py);
        return v === undefined || v === null ? null : this.node(v, hint);
      }
      case 'n*': return this.list(o, py, owner).map((x) => this.node(x, hint));
      case 'n?*': return this.list(o, py, owner).map((x) => (x === null ? null : this.node(x, hint)));
      case 'id': {
        const v = this.attr(o, py, owner);
        if (typeof v !== 'string') throw typeError(`field "${py}" must be str, not ${typeOf(v).name}`);
        return v;
      }
      case 'id?': {
        const v = ops.getAttrOpt(o, py);
        return v === undefined ? null : v;
      }
      case 'id*': return this.list(o, py, owner).map((x) => String(x));
      case 'i': {
        const v = ops.getAttrOpt(o, py);
        if (v === undefined || v === null) return py === 'conversion' ? -1 : 0;
        return Number(v);
      }
      case 'b': {
        const v = ops.getAttrOpt(o, py);
        return v === undefined ? false : ops.truthy(v);
      }
      case 'v': return this.attr(o, py, owner);
      case 'ctx': {
        const v = ops.getAttrOpt(o, py);
        if (v === undefined) return 'Load';
        return this.enumName(v, { Load: 'Load', Store: 'Store', Del: 'Del' }, 'expr_context node');
      }
      case 'bin': return this.enumName(this.attr(o, py, owner), BIN_R, 'operator');
      case 'un': return this.enumName(this.attr(o, py, owner), UN_R, 'unaryop');
      case 'bool': return this.enumName(this.attr(o, py, owner), BOOL_R, 'boolop');
      case 'cmp*': return this.list(o, py, owner).map((x) => this.enumName(x, CMP_R, 'cmpop'));
      default: return null;
    }
  }

  private constant(o: any): any {
    const v = this.attr(o, 'value', 'Constant');
    const out: any = { k: 'Constant' };
    if (v === null) { out.vt = 'none'; out.value = null; }
    else if (v === true || v === false) { out.vt = 'bool'; out.value = v; }
    else if (typeof v === 'number' || typeof v === 'bigint') { out.vt = 'int'; out.value = v; }
    else if (v instanceof PyFloat) { out.vt = 'float'; out.value = v.v; }
    else if (v instanceof PyComplex) { out.vt = 'complex'; out.value = v.im; }
    else if (typeof v === 'string') { out.vt = 'str'; out.value = v; }
    else if (v instanceof PyBytes) { out.vt = 'bytes'; out.value = v.b; }
    else if (v === Ellipsis) { out.vt = 'ellipsis'; out.value = null; }
    else throw typeError(`got an invalid type in Constant: ${typeOf(v).name}`);
    this.pos(o, 'expr', out);
    return out;
  }

  module(tree: any, mode: 'exec' | 'eval' | 'single'): Module {
    const cname = typeOf(tree).name;
    if (mode === 'eval') {
      if (cname !== 'Expression') throw typeError('expected Expression node, got ' + cname);
      const e = this.node(this.attr(tree, 'body', 'Expression'));
      const stmt = { k: 'Expr', value: e, line: e.line, col: e.col, endLine: e.endLine, endCol: e.endCol };
      return { k: 'Module', body: [stmt as any] };
    }
    const want = mode === 'single' ? 'Interactive' : 'Module';
    if (cname !== want) throw typeError(`expected ${want} node, got ${cname}`);
    const body = this.list(tree, 'body', want).map((s) => this.node(s, 'stmt'));
    return { k: 'Module', body };
  }
}

/** AST interno a partir de un árbol de Python (para `compile(arbol, ...)`) */
export function pyToModule(I: Interp, tree: any, mode: 'exec' | 'eval' | 'single'): Module {
  return new FromPy(I).module(tree, mode);
}

export function isAstNode(I: Interp, x: any): boolean {
  if (!(x instanceof PyObject)) return false;
  const m = I.modules.get('_ast');
  if (m === undefined) return false;
  const base = (m as any).dict.get('AST');
  return base instanceof PyType && typeOf(x).isSubtype(base);
}

export { POS_FIELDS, charCol, valueError };
