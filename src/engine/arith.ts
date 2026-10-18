/** Evaluador de aritmética de bash: $((...)), ((...)), let, for ((;;)). */

export class ArithError extends Error {}

export interface ArithEnv {
  get(name: string): number;
  set(name: string, v: number): void;
}

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'end' };

const OPS = [
  '<<=', '>>=', '**', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=',
  '%=', '&=', '^=', '|=', '++', '--', '+', '-', '*', '/', '%', '<', '>', '&', '^', '|', '!', '~',
  '?', ':', '=', ',', '(', ')',
];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        j = i + 2;
        while (/[0-9a-fA-F]/.test(src[j] ?? '')) j++;
        out.push({ t: 'num', v: parseInt(src.slice(i + 2, j), 16) });
      } else {
        while (/[0-9]/.test(src[j] ?? '')) j++;
        const txt = src.slice(i, j);
        out.push({ t: 'num', v: txt.length > 1 && txt[0] === '0' ? parseInt(txt, 8) : parseInt(txt, 10) });
      }
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      if (c === '$') j++;
      if (src[j] === '{') {
        const e = src.indexOf('}', j);
        out.push({ t: 'id', v: src.slice(j + 1, e) });
        i = e + 1;
        continue;
      }
      const s = j;
      while (/[A-Za-z0-9_]/.test(src[j] ?? '')) j++;
      out.push({ t: 'id', v: src.slice(s, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ArithError(`${src}: syntax error: operand expected (error token is "${src.slice(i)}")`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

export function evalArith(src: string, env: ArithEnv): number {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().t === 'op' && (peek() as any).v === v;
  const eat = (v: string) => {
    if (isOp(v)) {
      p++;
      return true;
    }
    return false;
  };
  const errTok = () => {
    const t = peek();
    return t.t === 'end' ? '' : String((t as any).v);
  };

  function parseComma(): number {
    let v = parseAssign();
    while (eat(',')) v = parseAssign();
    return v;
  }

  function parseAssign(): number {
    const t = peek();
    const n = toks[p + 1];
    if (t.t === 'id' && n.t === 'op' && /^(=|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\^=|\|=)$/.test(n.v)) {
      p += 2;
      const rhs = parseAssign();
      const cur = n.v === '=' ? 0 : env.get(t.v);
      let r = rhs;
      switch (n.v) {
        case '+=': r = cur + rhs; break;
        case '-=': r = cur - rhs; break;
        case '*=': r = cur * rhs; break;
        case '/=': r = div(cur, rhs); break;
        case '%=': r = mod(cur, rhs); break;
        case '<<=': r = cur << rhs; break;
        case '>>=': r = cur >> rhs; break;
        case '&=': r = cur & rhs; break;
        case '^=': r = cur ^ rhs; break;
        case '|=': r = cur | rhs; break;
      }
      env.set(t.v, r);
      return r;
    }
    return parseTernary();
  }

  function parseTernary(): number {
    const c = parseBin(0);
    if (eat('?')) {
      const a = parseAssign();
      if (!eat(':')) throw new ArithError(`${src}: expected ':'`);
      const b = parseAssign();
      return c ? a : b;
    }
    return c;
  }

  const LEVELS: string[][] = [
    ['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'],
    ['+', '-'], ['*', '/', '%'],
  ];

  function parseBin(level: number): number {
    if (level >= LEVELS.length) return parsePow();
    let l = parseBin(level + 1);
    for (;;) {
      const t = peek();
      if (t.t === 'op' && LEVELS[level].includes(t.v)) {
        p++;
        const op = t.v;
        // cortocircuito
        if (op === '&&' || op === '||') {
          const r = parseBin(level + 1);
          l = op === '&&' ? (l && r ? 1 : 0) : l || r ? 1 : 0;
          continue;
        }
        const r = parseBin(level + 1);
        switch (op) {
          case '|': l = l | r; break;
          case '^': l = l ^ r; break;
          case '&': l = l & r; break;
          case '==': l = l === r ? 1 : 0; break;
          case '!=': l = l !== r ? 1 : 0; break;
          case '<': l = l < r ? 1 : 0; break;
          case '<=': l = l <= r ? 1 : 0; break;
          case '>': l = l > r ? 1 : 0; break;
          case '>=': l = l >= r ? 1 : 0; break;
          case '<<': l = l << r; break;
          case '>>': l = l >> r; break;
          case '+': l = l + r; break;
          case '-': l = l - r; break;
          case '*': l = l * r; break;
          case '/': l = div(l, r); break;
          case '%': l = mod(l, r); break;
        }
      } else break;
    }
    return l;
  }

  function parsePow(): number {
    const base = parseUnary();
    if (eat('**')) {
      const e = parsePow();
      return Math.trunc(Math.pow(base, e));
    }
    return base;
  }

  function parseUnary(): number {
    if (eat('+')) return parseUnary();
    if (eat('-')) return -parseUnary();
    if (eat('!')) return parseUnary() ? 0 : 1;
    if (eat('~')) return ~parseUnary();
    if (isOp('++') || isOp('--')) {
      const op = (peek() as any).v;
      p++;
      const t = peek();
      if (t.t !== 'id') throw new ArithError(`${src}: syntax error: operand expected`);
      p++;
      const v = env.get(t.v) + (op === '++' ? 1 : -1);
      env.set(t.v, v);
      return v;
    }
    return parsePostfix();
  }

  function parsePostfix(): number {
    const t = peek();
    if (t.t === 'id') {
      p++;
      if (isOp('++') || isOp('--')) {
        const op = (peek() as any).v;
        p++;
        const old = env.get(t.v);
        env.set(t.v, old + (op === '++' ? 1 : -1));
        return old;
      }
      return env.get(t.v);
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (t.t === 'num') {
      p++;
      return t.v;
    }
    if (eat('(')) {
      const v = parseComma();
      if (!eat(')')) throw new ArithError(`${src}: missing ')'`);
      return v;
    }
    throw new ArithError(`${src}: syntax error: operand expected (error token is "${errTok()}")`);
  }

  function div(a: number, b: number) {
    if (b === 0) throw new ArithError(`${src}: division by 0 (error token is "${errTok() || '0'}")`);
    return Math.trunc(a / b);
  }
  function mod(a: number, b: number) {
    if (b === 0) throw new ArithError(`${src}: division by 0 (error token is "${errTok() || '0'}")`);
    return a % b;
  }

  if (toks.length === 1) return 0;
  const v = parseComma();
  if (peek().t !== 'end') throw new ArithError(`${src}: syntax error in expression (error token is "${errTok()}")`);
  return v;
}
