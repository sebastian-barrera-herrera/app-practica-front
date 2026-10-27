/**
 * Sintaxis de filtros de CloudWatch Logs: términos (`ERROR`, `"dos palabras"`, `?A ?B`, `-X`), JSON (`{ $.status = 500 }`)
 * y texto separado por espacios (`[ip, user, ..., status=4*, size]`).
 */
import { AwsError } from '../registry';

export interface FilterMatch {
  ok: boolean;
  /** Valores capturados: campos del patrón separado por espacios (`$status`) o del JSON (`$.a.b`). */
  vars: Record<string, string | number | boolean | null>;
  json?: unknown;
}

// ───────────────────────── términos ─────────────────────────

function matchTerms(pattern: string, message: string): boolean {
  const toks = pattern.match(/"[^"]*"|\S+/g) ?? [];
  const strip = (t: string) => t.replace(/^"|"$/g, '');
  const ors = toks.filter((t) => t.startsWith('?')).map((t) => strip(t.slice(1)));
  const ands = toks.filter((t) => !t.startsWith('?') && !t.startsWith('-')).map(strip);
  const nots = toks.filter((t) => t.startsWith('-')).map((t) => strip(t.slice(1)));
  if (ors.length && !ors.some((t) => message.includes(t))) return false;
  if (!ands.every((t) => message.includes(t))) return false;
  return !nots.some((t) => message.includes(t));
}

// ───────────────────────── comparaciones ─────────────────────────

const wild = (pat: string, text: string): boolean => new RegExp('^' + pat.split('*').map((x) => x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*') + '$').test(text);

function compare(op: string, left: unknown, right: string | number | boolean | null): boolean {
  if (right === null) return op === '=' ? left === null : left !== null;
  if (typeof right === 'number') {
    const n = typeof left === 'number' ? left : typeof left === 'string' && left.trim() !== '' ? Number(left) : NaN;
    if (Number.isNaN(n)) return op === '!=';
    return op === '=' ? n === right : op === '!=' ? n !== right : op === '>' ? n > right : op === '<' ? n < right : op === '>=' ? n >= right : n <= right;
  }
  if (typeof right === 'boolean') return op === '=' ? left === right : left !== right;
  const s = left === undefined || left === null ? undefined : String(left);
  if (s === undefined) return op === '!=';
  const eq = right.includes('*') ? wild(right, s) : s === right;
  if (op === '=') return eq;
  if (op === '!=') return !eq;
  throw new AwsError('InvalidParameterException', 'Invalid character(s) in term: strings can only be compared with = and !=.', 400);
}

// ───────────────────────── JSON ─────────────────────────

type JNode = { t: 'cmp'; path: string; op: string; value: string | number | boolean | null } | { t: 'exists'; path: string; neg: boolean } | { t: 'and'; l: JNode; r: JNode } | { t: 'or'; l: JNode; r: JNode };

function parseJson(src: string): JNode {
  const body = src.trim().replace(/^\{/, '').replace(/\}$/, '');
  const toks = body.match(/\(|\)|&&|\|\||!=|>=|<=|=|>|<|"[^"]*"|NOT\s+EXISTS|EXISTS|IS\s+NULL|IS\s+NOT\s+NULL|[^\s()=!<>&|"]+/gi) ?? [];
  let i = 0;
  const fail = (m: string): never => {
    throw new AwsError('InvalidParameterException', `Invalid character(s) in term '${src}': ${m}`, 400);
  };
  function or(): JNode {
    let l = and();
    while (toks[i] === '||') {
      i++;
      l = { t: 'or', l, r: and() };
    }
    return l;
  }
  function and(): JNode {
    let l = atom();
    while (toks[i] === '&&') {
      i++;
      l = { t: 'and', l, r: atom() };
    }
    return l;
  }
  function atom(): JNode {
    if (toks[i] === '(') {
      i++;
      const e = or();
      if (toks[i++] !== ')') fail('expected ")"');
      return e;
    }
    const first = toks[i++];
    if (/^(NOT\s+EXISTS|EXISTS)$/i.test(first ?? '')) {
      const neg = /^NOT/i.test(first);
      const path = toks[i++];
      if (!path?.startsWith('$')) fail('expected a JSON path after EXISTS');
      return { t: 'exists', path, neg };
    }
    if (!first?.startsWith('$')) return fail(`expected a JSON path ($.field) but found "${first ?? ''}"`);
    const opTok = toks[i++];
    if (/^IS\s+NULL$/i.test(opTok ?? '')) return { t: 'cmp', path: first, op: '=', value: null };
    if (/^IS\s+NOT\s+NULL$/i.test(opTok ?? '')) return { t: 'cmp', path: first, op: '!=', value: null };
    if (!['=', '!=', '>', '<', '>=', '<='].includes(opTok ?? '')) return fail(`unknown operator "${opTok ?? ''}"`);
    const v = toks[i++];
    if (v === undefined) return fail('missing value');
    const value: string | number | boolean | null = v[0] === '"' ? v.slice(1, -1) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : v;
    return { t: 'cmp', path: first, op: opTok, value };
  }
  const e = or();
  if (i < toks.length) fail(`unexpected "${toks[i]}"`);
  return e;
}

/** Valor de una ruta `$.a.b[0]` (con `[*]` devuelve todas las coincidencias). */
export function jsonPath(obj: unknown, path: string): unknown[] {
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur: unknown[] = [obj];
  for (const part of parts) {
    const m = /^([^[]*)(?:\[(\d+|\*)\])?$/.exec(part);
    if (!m) return [];
    const next: unknown[] = [];
    for (const c of cur) {
      let v: unknown = m[1] ? (c as Record<string, unknown> | null)?.[m[1]] : c;
      if (m[2] !== undefined) {
        if (!Array.isArray(v)) continue;
        if (m[2] === '*') next.push(...v);
        else next.push(v[Number(m[2])]);
        continue;
      }
      if (v === undefined) continue;
      next.push(v);
    }
    cur = next;
  }
  return cur;
}

function evalJson(n: JNode, obj: unknown): boolean {
  if (n.t === 'and' || n.t === 'or') return n.t === 'and' ? evalJson(n.l, obj) && evalJson(n.r, obj) : evalJson(n.l, obj) || evalJson(n.r, obj);
  const vals = jsonPath(obj, n.path);
  if (n.t === 'exists') return n.neg ? vals.length === 0 : vals.length > 0;
  if (!vals.length) return n.op === '!=';
  return vals.some((v) => compare(n.op, v, n.value));
}

// ───────────────────────── separado por espacios ─────────────────────────

function splitFields(line: string): string[] {
  return line.match(/"[^"]*"|\[[^\]]*\]|\S+/g) ?? [];
}

function matchSpaced(pattern: string, message: string): FilterMatch {
  const m = /^\s*\[([^\]]*)\]\s*$/.exec(pattern);
  if (!m) throw new AwsError('InvalidParameterException', `Invalid character(s) in term '${pattern}'`, 400);
  const items = m[1].split(',').map((x) => x.trim()).filter(Boolean);
  const conds: { name: string; op: string; value: string | number }[] = [];
  const names: string[] = [];
  let ellipsis = -1;
  for (const raw of items) {
    if (raw === '...' || raw === '..') {
      ellipsis = names.length;
      continue;
    }
    // «status = 4* && bytes > 1000» o simplemente un nombre
    const parts = raw.split(/\s*&&\s*/);
    const first = /^([A-Za-z_$][\w]*)\s*(=|!=|>=|<=|>|<)?\s*(.*)$/.exec(parts[0]);
    if (!first) throw new AwsError('InvalidParameterException', `Invalid character(s) in term '${raw}'`, 400);
    const name = first[1].replace(/^\$/, '');
    names.push(name);
    if (first[2]) conds.push({ name, op: first[2], value: /^-?\d+(\.\d+)?$/.test(first[3]) ? Number(first[3]) : first[3].replace(/^"|"$/g, '') });
    for (const extra of parts.slice(1)) {
      const e = /^(=|!=|>=|<=|>|<)\s*(.*)$/.exec(extra.trim().replace(/^[A-Za-z_$][\w]*\s*/, ''));
      if (e) conds.push({ name, op: e[1], value: /^-?\d+(\.\d+)?$/.test(e[2]) ? Number(e[2]) : e[2].replace(/^"|"$/g, '') });
    }
  }
  const fields = splitFields(message).map((f) => f.replace(/^"|"$/g, '').replace(/^\[|\]$/g, ''));
  const vars: FilterMatch['vars'] = {};
  if (ellipsis < 0 ? fields.length !== names.length : fields.length < names.length) return { ok: false, vars };
  names.forEach((n, i) => {
    const idx = ellipsis >= 0 && i >= ellipsis ? fields.length - (names.length - i) : i;
    vars[n] = fields[idx];
  });
  const ok = conds.every((c) => compare(c.op, vars[c.name], c.value as string | number));
  return { ok, vars };
}

// ───────────────────────── entrada ─────────────────────────

const cache = new Map<string, JNode>();

/** Valida la sintaxis del patrón (lanza `InvalidParameterException` si no es válido). */
export function checkPattern(pattern: string | undefined): void {
  if (!pattern?.trim()) return;
  const p = pattern.trim();
  if (p.startsWith('{')) {
    if (!p.endsWith('}')) throw new AwsError('InvalidParameterException', `Invalid character(s) in term '${p}': a JSON filter pattern must be enclosed in { }.`, 400);
    parseJson(p);
  } else if (p.startsWith('[')) matchSpaced(p, '');
}

export function matchFilter(pattern: string | undefined, message: string): FilterMatch {
  const vars: FilterMatch['vars'] = {};
  if (!pattern || !pattern.trim()) return { ok: true, vars };
  const p = pattern.trim();
  if (p.startsWith('{')) {
    let ast = cache.get(p);
    if (!ast) {
      ast = parseJson(p);
      cache.set(p, ast);
    }
    let obj: unknown;
    try {
      obj = JSON.parse(message);
    } catch {
      return { ok: false, vars };
    }
    if (typeof obj !== 'object' || obj === null) return { ok: false, vars };
    return { ok: evalJson(ast, obj), vars, json: obj };
  }
  if (p.startsWith('[')) return matchSpaced(p, message);
  return { ok: matchTerms(p, message), vars };
}

/** Valor de `metricValue` para un registro que cumple el patrón: número fijo, `$.campo` del JSON o `$variable`. */
export function metricValueOf(spec: string, m: FilterMatch, message: string): number | null {
  if (/^-?\d+(\.\d+)?$/.test(spec)) return Number(spec);
  let v: unknown;
  if (spec.startsWith('$.')) {
    let obj = m.json;
    if (obj === undefined) {
      try {
        obj = JSON.parse(message);
      } catch {
        return null;
      }
    }
    v = jsonPath(obj, spec)[0];
  } else if (spec.startsWith('$')) v = m.vars[spec.slice(1)];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
