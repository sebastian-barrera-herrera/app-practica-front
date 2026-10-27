/** Análisis de argumentos de la CLI: opciones globales, parámetros de cada operación y la sintaxis abreviada (shorthand). */
import { type AwsIO, type OpDef, UsageErr, type Params } from './registry';

export const GLOBAL_VALUED = new Set(['region', 'profile', 'output', 'query', 'endpoint-url', 'color', 'ca-bundle', 'cli-read-timeout', 'cli-connect-timeout', 'cli-binary-format', 'max-items', 'page-size', 'starting-token']);
export const GLOBAL_FLAGS = new Set(['debug', 'no-verify-ssl', 'no-paginate', 'no-sign-request', 'no-cli-pager', 'cli-auto-prompt', 'no-cli-auto-prompt', 'version']);

export interface Split {
  service?: string;
  operation?: string;
  rest: string[];
  globals: Record<string, string | true>;
}

/** Separa servicio, operación y el resto, extrayendo las opciones globales (que pueden ir en cualquier sitio). */
export function splitArgs(argv: string[]): Split {
  const globals: Record<string, string | true> = {};
  const rest: string[] = [];
  let service: string | undefined;
  let operation: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--') && tok.length > 2) {
      const eq = tok.indexOf('=');
      const name = eq > 0 ? tok.slice(2, eq) : tok.slice(2);
      if (GLOBAL_VALUED.has(name)) {
        if (eq > 0) globals[name] = tok.slice(eq + 1);
        else if (i + 1 < argv.length) globals[name] = argv[++i];
        else throw new UsageErr(`argument --${name}: expected one argument`);
        continue;
      }
      if (GLOBAL_FLAGS.has(name)) {
        globals[name] = true;
        continue;
      }
      rest.push(tok);
    } else if (service === undefined && !rest.length) service = tok;
    else if (operation === undefined && !rest.length) operation = tok;
    else rest.push(tok);
  }
  return { service, operation, rest, globals };
}

// ───────────────────────── shorthand ─────────────────────────

class ShortErr extends Error {}

/** Interpreta `Clave=valor,Otra=[a,b],Anidado={x=y}`; devuelve un objeto. */
export function parseShorthand(src: string): Record<string, unknown> {
  let i = 0;
  const n = src.length;
  const skipWs = () => {
    while (i < n && src[i] === ' ') i++;
  };
  const scalar = (stops: string): string => {
    skipWs();
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i++];
      let s = '';
      while (i < n && src[i] !== q) s += src[i++];
      if (i >= n) throw new ShortErr('Unterminated quote');
      i++;
      return s;
    }
    let s = '';
    while (i < n && !stops.includes(src[i])) {
      if (src[i] === '\\' && i + 1 < n) i++;
      s += src[i++];
    }
    return s.trim();
  };
  const value = (stops: string): unknown => {
    skipWs();
    if (src[i] === '[') {
      i++;
      const arr: unknown[] = [];
      skipWs();
      while (i < n && src[i] !== ']') {
        arr.push(src[i] === '{' ? (i++, obj('}')) : value(',]'));
        skipWs();
        if (src[i] === ',') i++;
        skipWs();
      }
      if (src[i] !== ']') throw new ShortErr('Expected ]');
      i++;
      return arr;
    }
    if (src[i] === '{') {
      i++;
      return obj('}');
    }
    return scalar(stops);
  };
  const continuesList = () => {
    const m = /^\s*([^,=}\]]*)([,=}\]]|$)/.exec(src.slice(i + 1));
    return !!m && m[2] !== '=' && m[1].trim() !== '';
  };
  const obj = (close: string): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    skipWs();
    while (i < n && src[i] !== close) {
      const key = scalar('=,' + close);
      if (src[i] !== '=') throw new ShortErr(`Expected '=' after ${key}`);
      i++;
      let v: unknown = value(',' + close);
      skipWs();
      // `Values=a,b` → lista cuando lo que sigue a la coma no es otra «clave=»
      if (typeof v === 'string') {
        const items: string[] = [v];
        while (src[i] === ',' && continuesList()) {
          i++;
          items.push(scalar(',' + close));
          skipWs();
        }
        if (items.length > 1) v = items;
      }
      o[key] = v;
      skipWs();
      if (src[i] === ',') i++;
      skipWs();
    }
    if (close === '}' && src[i] !== '}') throw new ShortErr('Expected }');
    if (src[i] === close) i++;
    return o;
  };
  const r = obj('\u0000');
  if (i < n) throw new ShortErr(`Unexpected characters: ${src.slice(i)}`);
  return r;
}

// ───────────────────────── valores de parámetros ─────────────────────────

/** Contenidos leídos con `fileb://` (bytes en bruto): los servicios que reciben base64 por defecto (KMS) los aceptan tal cual. */
export const rawBlobs = new Set<string>();

function paramFile(io: AwsIO, flag: string, v: string): string {
  const m = /^(file|fileb):\/\/(.*)$/.exec(v);
  if (!m) return v;
  const path = m[2];
  const text = io.readFile(io.abs(path));
  if (text === null) throw new UsageErr(`Error parsing parameter '--${flag}': Unable to load paramfile ${v}: [Errno 2] No such file or directory: '${path}'`, 252, false);
  if (m[1] === 'fileb') {
    if (rawBlobs.size > 64) rawBlobs.clear();
    rawBlobs.add(text);
  }
  return text;
}

function jsonOrShort(io: AwsIO, flag: string, raw: string): unknown {
  const text = paramFile(io, flag, raw).trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new UsageErr(`Error parsing parameter '--${flag}': Invalid JSON: ${msg}\nJSON received: ${text}`, 252, false);
    }
  }
  try {
    return parseShorthand(text);
  } catch {
    throw new UsageErr(`Error parsing parameter '--${flag}': Invalid JSON: Expecting value: line 1 column 1 (char 0)\nJSON received: ${text}`, 252, false);
  }
}

/** Convierte los argumentos de una operación en parámetros con la clave PascalCase del API. */
export function parseOpParams(op: OpDef, rest: string[], io: AwsIO): Params {
  const byName = new Map(op.params.map((p) => [p.name, p]));
  const p: Params = {};
  const positional: string[] = [];
  const unknown: string[] = [];
  const isOpt = (s: string) => s.startsWith('--') && s.length > 2;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!isOpt(tok)) {
      positional.push(tok);
      continue;
    }
    const eq = tok.indexOf('=');
    let name = eq > 0 ? tok.slice(2, eq) : tok.slice(2);
    let inline: string | undefined = eq > 0 ? tok.slice(eq + 1) : undefined;
    let negate = false;
    let spec = byName.get(name);
    if (!spec && name.startsWith('no-') && byName.get(name.slice(3))?.type === 'b') {
      spec = byName.get(name.slice(3));
      negate = true;
      name = name.slice(3);
    }
    if (!spec) {
      if (name === 'cli-input-json' || name === 'generate-cli-skeleton' || name === 'cli-input-yaml') {
        p['$' + name] = inline ?? (name === 'generate-cli-skeleton' && !(rest[i + 1] && !isOpt(rest[i + 1])) ? 'input' : rest[++i]);
        continue;
      }
      unknown.push(tok);
      while (i + 1 < rest.length && !isOpt(rest[i + 1])) unknown.push(rest[++i]);
      continue;
    }
    if (spec.type === 'b') {
      p[spec.key] = !negate;
      continue;
    }
    // valores de esta opción
    const vals: string[] = [];
    if (inline !== undefined) vals.push(inline);
    else if (spec.type === 'l' || spec.type === 't' || spec.type === 'f') {
      while (i + 1 < rest.length && !isOpt(rest[i + 1])) vals.push(rest[++i]);
    } else if (i + 1 < rest.length && (!isOpt(rest[i + 1]) || /^--\d/.test(rest[i + 1]))) vals.push(rest[++i]);
    inline = undefined;
    if (!vals.length) throw new UsageErr(`argument --${name}: expected ${spec.type === 'l' || spec.type === 't' || spec.type === 'f' ? 'at least one' : 'one'} argument`);
    switch (spec.type) {
      case 's': p[spec.key] = paramFile(io, name, vals[0]); break;
      case 'r': p[spec.key] = [...(p[spec.key] ?? []), paramFile(io, name, vals[0])]; break;
      case 'i': {
        if (!/^-?\d+$/.test(vals[0])) throw new UsageErr(`argument --${name}: invalid int value: '${vals[0]}'`);
        p[spec.key] = parseInt(vals[0], 10);
        break;
      }
      case 'n': {
        if (Number.isNaN(Number(vals[0]))) throw new UsageErr(`argument --${name}: invalid float value: '${vals[0]}'`);
        p[spec.key] = Number(vals[0]);
        break;
      }
      case 'l': {
        if (vals.length === 1 && vals[0].startsWith('file://')) p[spec.key] = paramFile(io, name, vals[0]).split(/\s+/).filter(Boolean);
        else p[spec.key] = vals;
        break;
      }
      case 'j': p[spec.key] = jsonOrShort(io, name, vals[0]); break;
      case 't':
      case 'f': {
        const out: unknown[] = [];
        for (const v of vals) {
          const x = jsonOrShort(io, name, v);
          if (Array.isArray(x)) out.push(...x);
          else out.push(x);
        }
        p[spec.key] = out;
        break;
      }
    }
  }
  // posicionales
  const pos = op.positional ?? [];
  if (positional.length) {
    let k = 0;
    for (const name of pos) {
      const spec = byName.get(name);
      if (!spec) continue;
      if (spec.type === 'l') {
        p[spec.key] = positional.slice(k);
        k = positional.length;
      } else if (k < positional.length) p[spec.key] = positional[k++];
    }
    unknown.push(...positional.slice(k));
  }
  if (unknown.length) throw new UsageErr(`unrecognized arguments: ${unknown.join(' ')}`);
  return p;
}

// ───────────────────────── sugerencias ─────────────────────────

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** Opciones parecidas a una palabra mal escrita («maybe you meant»). */
export function suggest(word: string, choices: string[], max = 3): string[] {
  const scored = choices.map((c) => ({ c, d: lev(word, c) + (c.startsWith(word.slice(0, 4)) ? -1 : 0) })).filter((x) => x.d <= Math.max(3, Math.floor(word.length / 3)));
  return scored.sort((a, b) => a.d - b.d || (a.c < b.c ? -1 : 1)).slice(0, max).map((x) => x.c);
}
