/**
 * ¿Contiene un nodo `yield` / `await` (sin entrar en funciones, lambdas ni clases anidadas)?
 * El compilador usa el modo generador solo para los subárboles que lo necesitan.
 */
import type { Expr, Pattern, Stmt } from './ast';
import type { ScopeTable } from './scope';

const cache = new WeakMap<object, boolean>();

export class Suspend {
  constructor(private table: ScopeTable) {}

  expr(n: Expr | null): boolean {
    if (n === null) return false;
    const c = cache.get(n);
    if (c !== undefined) return c;
    const r = this.exprUncached(n);
    cache.set(n, r);
    return r;
  }

  private exprs(l: (Expr | null)[]): boolean {
    for (const e of l) if (e !== null && this.expr(e)) return true;
    return false;
  }

  private exprUncached(n: Expr): boolean {
    switch (n.k) {
      case 'Constant': case 'Name': return false;
      case 'Await': case 'Yield': case 'YieldFrom': return true;
      case 'BoolOp': return this.exprs(n.values);
      case 'NamedExpr': return this.expr(n.value);
      case 'BinOp': return this.expr(n.left) || this.expr(n.right);
      case 'UnaryOp': return this.expr(n.operand);
      case 'Lambda': return false;
      case 'IfExp': return this.expr(n.test) || this.expr(n.body) || this.expr(n.orelse);
      case 'Dict': return this.exprs(n.keys) || this.exprs(n.values);
      case 'Set': case 'List': case 'Tuple': return this.exprs(n.elts);
      case 'ListComp': case 'SetComp': case 'DictComp': case 'GeneratorExp': {
        const sc = this.table.byNode.get(n);
        // la primera iterable se evalúa fuera; si la comprensión es asíncrona hay que esperar su corrutina
        if (sc && (sc.isCoroutine && n.k !== 'GeneratorExp')) return true;
        return this.expr(n.generators[0].iter);
      }
      case 'Compare': return this.expr(n.left) || this.exprs(n.comparators);
      case 'Call':
        return this.expr(n.func) || this.exprs(n.args) || n.keywords.some((k) => this.expr(k.value));
      case 'FormattedValue': return this.expr(n.value) || this.expr(n.formatSpec);
      case 'JoinedStr': return this.exprs(n.values);
      case 'Attribute': return this.expr(n.value);
      case 'Subscript': return this.expr(n.value) || this.expr(n.slice);
      case 'Starred': return this.expr(n.value);
      case 'Slice': return this.expr(n.lower) || this.expr(n.upper) || this.expr(n.step);
    }
  }

  stmts(l: Stmt[]): boolean {
    for (const s of l) if (this.stmt(s)) return true;
    return false;
  }

  stmt(n: Stmt): boolean {
    const c = cache.get(n);
    if (c !== undefined) return c;
    const r = this.stmtUncached(n);
    cache.set(n, r);
    return r;
  }

  private stmtUncached(n: Stmt): boolean {
    switch (n.k) {
      case 'FunctionDef': case 'AsyncFunctionDef':
        return this.exprs(n.decorators) || this.exprs(n.args.defaults) || this.exprs(n.args.kwDefaults);
      case 'ClassDef': return this.exprs(n.decorators) || this.exprs(n.bases) || n.keywords.some((k) => this.expr(k.value));
      case 'Return': return this.expr(n.value);
      case 'Delete': return this.exprs(n.targets);
      case 'Assign': return this.expr(n.value) || this.exprs(n.targets);
      case 'TypeAlias': return false;
      case 'AugAssign': return this.expr(n.value) || this.expr(n.target);
      case 'AnnAssign': return this.expr(n.value) || this.expr(n.target);
      case 'For': return this.expr(n.iter) || this.expr(n.target) || this.stmts(n.body) || this.stmts(n.orelse);
      case 'AsyncFor': return true;
      case 'While': return this.expr(n.test) || this.stmts(n.body) || this.stmts(n.orelse);
      case 'If': return this.expr(n.test) || this.stmts(n.body) || this.stmts(n.orelse);
      case 'With': return n.items.some((i) => this.expr(i.contextExpr) || this.expr(i.optionalVars)) || this.stmts(n.body);
      case 'AsyncWith': return true;
      case 'Match': return this.expr(n.subject) || n.cases.some((c) => this.pattern(c.pattern) || this.expr(c.guard) || this.stmts(c.body));
      case 'Raise': return this.expr(n.exc) || this.expr(n.cause);
      case 'Try': case 'TryStar':
        return this.stmts(n.body) || n.handlers.some((h) => this.expr(h.type) || this.stmts(h.body)) || this.stmts(n.orelse) || this.stmts(n.finalbody);
      case 'Assert': return this.expr(n.test) || this.expr(n.msg);
      case 'Expr': return this.expr(n.value);
      default: return false;
    }
  }

  pattern(p: Pattern): boolean {
    switch (p.k) {
      case 'MatchValue': return this.expr(p.value);
      case 'MatchSequence': case 'MatchOr': return p.patterns.some((x) => this.pattern(x));
      case 'MatchMapping': return this.exprs(p.keys) || p.patterns.some((x) => this.pattern(x));
      case 'MatchClass': return this.expr(p.cls) || p.patterns.some((x) => this.pattern(x)) || p.kwdPatterns.some((x) => this.pattern(x));
      case 'MatchAs': return p.pattern ? this.pattern(p.pattern) : false;
      default: return false;
    }
  }
}
