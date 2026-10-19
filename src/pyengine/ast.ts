/**
 * AST de Python 3.13 (misma nomenclatura que el módulo `ast` de CPython).
 * Cada nodo lleva su posición: línea (1-based) y columna (0-based, en unidades UTF-16) de inicio y fin.
 */

export interface Pos {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  /** la expresión estaba entre paréntesis en el código fuente */
  paren?: boolean;
}

export type BinOpName = '+' | '-' | '*' | '/' | '//' | '%' | '**' | '@' | '&' | '|' | '^' | '<<' | '>>';
export type UnaryOpName = 'not' | '-' | '+' | '~';
export type CmpOpName = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'is' | 'is not' | 'in' | 'not in';

export type ConstKind = 'int' | 'float' | 'complex' | 'str' | 'bytes' | 'bool' | 'none' | 'ellipsis';

// ───────────── expresiones ─────────────

export interface Constant extends Pos {
  k: 'Constant';
  vt: ConstKind;
  /** int: number|bigint; float/complex: number (complex = parte imaginaria); str: string; bytes: Uint8Array; bool: boolean */
  value: number | bigint | string | boolean | null | Uint8Array;
}
export interface Name extends Pos { k: 'Name'; id: string; ctx: Ctx }
export type Ctx = 'Load' | 'Store' | 'Del';
export interface BoolOp extends Pos { k: 'BoolOp'; op: 'and' | 'or'; values: Expr[] }
export interface NamedExpr extends Pos { k: 'NamedExpr'; target: Name; value: Expr }
export interface BinOp extends Pos { k: 'BinOp'; left: Expr; op: BinOpName; right: Expr }
export interface UnaryOp extends Pos { k: 'UnaryOp'; op: UnaryOpName; operand: Expr }
export interface Lambda extends Pos { k: 'Lambda'; args: Arguments; body: Expr }
export interface IfExp extends Pos { k: 'IfExp'; test: Expr; body: Expr; orelse: Expr }
export interface Dict extends Pos { k: 'Dict'; keys: (Expr | null)[]; values: Expr[] }
export interface SetExpr extends Pos { k: 'Set'; elts: Expr[] }
export interface ListComp extends Pos { k: 'ListComp'; elt: Expr; generators: Comprehension[] }
export interface SetComp extends Pos { k: 'SetComp'; elt: Expr; generators: Comprehension[] }
export interface DictComp extends Pos { k: 'DictComp'; key: Expr; value: Expr; generators: Comprehension[] }
export interface GeneratorExp extends Pos { k: 'GeneratorExp'; elt: Expr; generators: Comprehension[] }
export interface Await extends Pos { k: 'Await'; value: Expr }
export interface Yield extends Pos { k: 'Yield'; value: Expr | null }
export interface YieldFrom extends Pos { k: 'YieldFrom'; value: Expr }
export interface Compare extends Pos { k: 'Compare'; left: Expr; ops: CmpOpName[]; comparators: Expr[] }
export interface Call extends Pos { k: 'Call'; func: Expr; args: Expr[]; keywords: Keyword[] }
export interface FormattedValue extends Pos {
  k: 'FormattedValue';
  value: Expr;
  /** -1 = ninguna, 115 = s, 114 = r, 97 = a */
  conversion: number;
  formatSpec: JoinedStr | null;
}
export interface JoinedStr extends Pos { k: 'JoinedStr'; values: Expr[] }
export interface Attribute extends Pos { k: 'Attribute'; value: Expr; attr: string; ctx: Ctx }
export interface Subscript extends Pos { k: 'Subscript'; value: Expr; slice: Expr; ctx: Ctx }
export interface Starred extends Pos { k: 'Starred'; value: Expr; ctx: Ctx }
export interface ListExpr extends Pos { k: 'List'; elts: Expr[]; ctx: Ctx }
export interface TupleExpr extends Pos { k: 'Tuple'; elts: Expr[]; ctx: Ctx; parenthesized?: boolean }
export interface Slice extends Pos { k: 'Slice'; lower: Expr | null; upper: Expr | null; step: Expr | null }

export type Expr =
  | Constant | Name | BoolOp | NamedExpr | BinOp | UnaryOp | Lambda | IfExp | Dict | SetExpr
  | ListComp | SetComp | DictComp | GeneratorExp | Await | Yield | YieldFrom | Compare | Call
  | FormattedValue | JoinedStr | Attribute | Subscript | Starred | ListExpr | TupleExpr | Slice;

export interface Comprehension { target: Expr; iter: Expr; ifs: Expr[]; isAsync: boolean }
export interface Keyword extends Pos { arg: string | null; value: Expr }
export interface Arg extends Pos { arg: string; annotation: Expr | null }
export interface Arguments {
  posonlyargs: Arg[];
  args: Arg[];
  vararg: Arg | null;
  kwonlyargs: Arg[];
  kwDefaults: (Expr | null)[];
  kwarg: Arg | null;
  defaults: Expr[];
}
export interface Alias extends Pos { name: string; asname: string | null }
export interface WithItem { contextExpr: Expr; optionalVars: Expr | null }

// ───────────── patrones (match) ─────────────

export interface MatchValue extends Pos { k: 'MatchValue'; value: Expr }
export interface MatchSingleton extends Pos { k: 'MatchSingleton'; value: boolean | null }
export interface MatchSequence extends Pos { k: 'MatchSequence'; patterns: Pattern[] }
export interface MatchMapping extends Pos { k: 'MatchMapping'; keys: Expr[]; patterns: Pattern[]; rest: string | null }
export interface MatchClass extends Pos { k: 'MatchClass'; cls: Expr; patterns: Pattern[]; kwdAttrs: string[]; kwdPatterns: Pattern[] }
export interface MatchStar extends Pos { k: 'MatchStar'; name: string | null }
export interface MatchAs extends Pos { k: 'MatchAs'; pattern: Pattern | null; name: string | null }
export interface MatchOr extends Pos { k: 'MatchOr'; patterns: Pattern[] }
export type Pattern = MatchValue | MatchSingleton | MatchSequence | MatchMapping | MatchClass | MatchStar | MatchAs | MatchOr;
export interface MatchCase { pattern: Pattern; guard: Expr | null; body: Stmt[] }

// ───────────── type params (3.12) ─────────────

export interface TypeParam extends Pos { k: 'TypeVar' | 'ParamSpec' | 'TypeVarTuple'; name: string; bound: Expr | null; defaultValue: Expr | null }

// ───────────── sentencias ─────────────

export interface FunctionDef extends Pos {
  k: 'FunctionDef' | 'AsyncFunctionDef';
  name: string;
  args: Arguments;
  body: Stmt[];
  decorators: Expr[];
  returns: Expr | null;
  typeParams: TypeParam[];
  /** posición del nombre `def` (para tracebacks de decoradores no hace falta) */
}
export interface ClassDef extends Pos {
  k: 'ClassDef';
  name: string;
  bases: Expr[];
  keywords: Keyword[];
  body: Stmt[];
  decorators: Expr[];
  typeParams: TypeParam[];
}
export interface Return extends Pos { k: 'Return'; value: Expr | null }
export interface Delete extends Pos { k: 'Delete'; targets: Expr[] }
export interface Assign extends Pos { k: 'Assign'; targets: Expr[]; value: Expr }
export interface TypeAlias extends Pos { k: 'TypeAlias'; name: Name; typeParams: TypeParam[]; value: Expr }
export interface AugAssign extends Pos { k: 'AugAssign'; target: Expr; op: BinOpName; value: Expr }
export interface AnnAssign extends Pos { k: 'AnnAssign'; target: Expr; annotation: Expr; value: Expr | null; simple: boolean }
export interface For extends Pos { k: 'For' | 'AsyncFor'; target: Expr; iter: Expr; body: Stmt[]; orelse: Stmt[] }
export interface While extends Pos { k: 'While'; test: Expr; body: Stmt[]; orelse: Stmt[] }
export interface If extends Pos { k: 'If'; test: Expr; body: Stmt[]; orelse: Stmt[] }
export interface With extends Pos { k: 'With' | 'AsyncWith'; items: WithItem[]; body: Stmt[] }
export interface Match extends Pos { k: 'Match'; subject: Expr; cases: MatchCase[] }
export interface Raise extends Pos { k: 'Raise'; exc: Expr | null; cause: Expr | null }
export interface ExceptHandler extends Pos { type: Expr | null; name: string | null; body: Stmt[] }
export interface Try extends Pos { k: 'Try' | 'TryStar'; body: Stmt[]; handlers: ExceptHandler[]; orelse: Stmt[]; finalbody: Stmt[] }
export interface Assert extends Pos { k: 'Assert'; test: Expr; msg: Expr | null }
export interface Import extends Pos { k: 'Import'; names: Alias[] }
export interface ImportFrom extends Pos { k: 'ImportFrom'; module: string | null; names: Alias[]; level: number }
export interface Global extends Pos { k: 'Global'; names: string[] }
export interface Nonlocal extends Pos { k: 'Nonlocal'; names: string[] }
export interface ExprStmt extends Pos { k: 'Expr'; value: Expr }
export interface Pass extends Pos { k: 'Pass' }
export interface Break extends Pos { k: 'Break' }
export interface Continue extends Pos { k: 'Continue' }

export type Stmt =
  | FunctionDef | ClassDef | Return | Delete | Assign | TypeAlias | AugAssign | AnnAssign | For | While | If
  | With | Match | Raise | Try | Assert | Import | ImportFrom | Global | Nonlocal | ExprStmt | Pass | Break | Continue;

export interface Module { k: 'Module'; body: Stmt[]; docstring?: string | null }

export type Node = Expr | Stmt | Pattern | TypeParam | Keyword | Arg | Alias | ExceptHandler;
