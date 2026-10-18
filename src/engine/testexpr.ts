/** Evaluador de test / [ ] / [[ ]]. Devuelve 0 (verdadero), 1 (falso). */
import { globMatch, makeRegex } from './regex';
import type { Shell } from './shell';
import { ShellError } from './shell';

export interface TestTok {
  s: string;
  /** Versión como patrón glob (partes entrecomilladas escapadas). */
  pat: string;
}

const UNARY = new Set(['-e', '-f', '-d', '-r', '-w', '-x', '-s', '-L', '-h', '-z', '-n', '-O', '-G', '-p', '-S', '-b', '-c', '-t', '-v', '-a']);
const BIN_INT = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge']);
const BIN_FILE = new Set(['-nt', '-ot', '-ef']);

function isBinary(op: string, dbl: boolean): boolean {
  if (BIN_INT.has(op) || BIN_FILE.has(op)) return true;
  if (op === '=' || op === '==' || op === '!=' || op === '<' || op === '>') return true;
  if (dbl && op === '=~') return true;
  return false;
}

export function evalTest(sh: Shell, toks: TestTok[], dbl: boolean, name = dbl ? '[[' : 'test'): number {
  let p = 0;
  const peek = () => toks[p];

  const orExpr = (): boolean => {
    let v = andExpr();
    while (peek() && (dbl ? peek().s === '||' : peek().s === '-o')) {
      p++;
      const r = andExpr();
      v = v || r;
    }
    return v;
  };
  const andExpr = (): boolean => {
    let v = notExpr();
    while (peek() && (dbl ? peek().s === '&&' : peek().s === '-a')) {
      p++;
      const r = notExpr();
      v = v && r;
    }
    return v;
  };
  const notExpr = (): boolean => {
    if (peek() && peek().s === '!') {
      p++;
      return !notExpr();
    }
    return primary();
  };
  const primary = (): boolean => {
    const t = peek();
    if (!t) return false;
    if (t.s === '(') {
      p++;
      const v = orExpr();
      if (peek() && peek().s === ')') p++;
      return v;
    }
    const n1 = toks[p + 1];
    const n2 = toks[p + 2];
    if (n1 && n2 && isBinary(n1.s, dbl)) {
      p += 3;
      return binary(t, n1.s, n2);
    }
    if (n1 && UNARY.has(t.s) && !(dbl ? ['&&', '||'] : ['-a', '-o']).includes(n1.s)) {
      p += 2;
      return unary(t.s, n1.s);
    }
    p++;
    return t.s.length > 0;
  };

  const stat = (path: string) => sh.fs.stat(sh.abs(path), null);

  const unary = (op: string, a: string): boolean => {
    switch (op) {
      case '-z': return a.length === 0;
      case '-n': return a.length > 0;
      case '-v': return sh.vars.has(a);
      case '-t': return false;
    }
    const abs = sh.abs(a);
    const n = op === '-L' || op === '-h' ? sh.fs.lstat(abs, null) : stat(a);
    if (!n) return false;
    switch (op) {
      case '-e': case '-a': return true;
      case '-f': return n.kind === 'file';
      case '-d': return n.kind === 'dir';
      case '-L': case '-h': return n.kind === 'symlink';
      case '-s': return sh.fs.sizeOf(n) > 0;
      case '-r': return sh.fs.can(n, sh.cred, 'r');
      case '-w': return sh.fs.can(n, sh.cred, 'w');
      case '-x': return sh.fs.can(n, sh.cred, 'x');
      case '-O': return n.uid === sh.user;
      case '-G': return sh.cred.groups.includes(n.gid);
      case '-p': case '-S': case '-b': case '-c': return false;
    }
    return false;
  };

  const intOf = (s: string): number => {
    if (!/^\s*-?\d+\s*$/.test(s)) throw new ShellError(`${name}: ${s}: integer expression expected`, 2);
    return parseInt(s, 10);
  };

  const binary = (a: TestTok, op: string, b: TestTok): boolean => {
    switch (op) {
      case '=': case '==':
        return dbl ? globMatch(b.pat, a.s) : a.s === b.s;
      case '!=':
        return dbl ? !globMatch(b.pat, a.s) : a.s !== b.s;
      case '<': return a.s < b.s;
      case '>': return a.s > b.s;
      case '-eq': return intOf(a.s) === intOf(b.s);
      case '-ne': return intOf(a.s) !== intOf(b.s);
      case '-lt': return intOf(a.s) < intOf(b.s);
      case '-le': return intOf(a.s) <= intOf(b.s);
      case '-gt': return intOf(a.s) > intOf(b.s);
      case '-ge': return intOf(a.s) >= intOf(b.s);
      case '-nt': return (stat(a.s)?.mtime ?? -1) > (stat(b.s)?.mtime ?? -1);
      case '-ot': return (stat(a.s)?.mtime ?? Infinity) < (stat(b.s)?.mtime ?? Infinity);
      case '-ef': {
        const x = stat(a.s);
        const y = stat(b.s);
        return !!x && x === y;
      }
      case '=~': {
        try {
          const m = makeRegex(b.s, { extended: true }).exec(a.s);
          if (m) sh.setArray('BASH_REMATCH', [...m].map((x) => x ?? ''));
          else sh.unsetVar('BASH_REMATCH');
          return !!m;
        } catch {
          throw new ShellError(`${name}: invalid regular expression`, 2);
        }
      }
    }
    return false;
  };

  if (toks.length === 0) return 1;
  const v = orExpr();
  if (p < toks.length && !dbl) {
    throw new ShellError(`${name}: too many arguments`, 2);
  }
  return v ? 0 : 1;
}
