/**
 * Lector de plantillas de CloudFormation: JSON o YAML (el subconjunto que se usa en la práctica, con las etiquetas cortas `!Ref`, `!Sub`, `!GetAtt`…).
 * Devuelve la misma estructura que el JSON equivalente (`{ Ref: 'X' }`, `{ 'Fn::Sub': '…' }`).
 */

export class YamlError extends Error {}

const SHORT: Record<string, string> = {
  Ref: 'Ref',
  Condition: 'Condition',
  GetAtt: 'Fn::GetAtt',
  Sub: 'Fn::Sub',
  Join: 'Fn::Join',
  Select: 'Fn::Select',
  Split: 'Fn::Split',
  If: 'Fn::If',
  Equals: 'Fn::Equals',
  Not: 'Fn::Not',
  And: 'Fn::And',
  Or: 'Fn::Or',
  FindInMap: 'Fn::FindInMap',
  ImportValue: 'Fn::ImportValue',
  Base64: 'Fn::Base64',
  GetAZs: 'Fn::GetAZs',
  Cidr: 'Fn::Cidr',
  Transform: 'Fn::Transform',
  Length: 'Fn::Length',
  ToJsonString: 'Fn::ToJsonString',
};

interface Ln {
  indent: number;
  text: string;
  raw: string;
}

/** Quita el comentario final (un `#` precedido de espacio y fuera de comillas). */
function stripComment(s: string): string {
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

/** Posición del `:` que separa clave y valor (fuera de comillas y de corchetes), o -1. */
function keyColon(s: string): number {
  let q = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") {
      if (i === 0 || depth > 0 || /[\s[{,]/.test(s[i - 1])) q = c;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ':' && depth === 0 && (i === s.length - 1 || s[i + 1] === ' ')) return i;
  }
  return -1;
}

function unquote(s: string): string {
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function scalar(s: string): unknown {
  const t = s.trim();
  if (t === '') return null;
  if (t.startsWith('"') || t.startsWith("'")) return unquote(t);
  if (t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t) && t.length < 16) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  return t;
}

/** Valores en línea: `[a, b]`, `{k: v}` y escalares. */
function flow(src: string): unknown {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const str = (stops: string): string => {
    ws();
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== q) j += src[j] === '\\' && q === '"' ? 2 : 1;
      const raw = src.slice(i, j + 1);
      i = j + 1;
      return unquote(raw);
    }
    let j = i;
    while (j < src.length && !stops.includes(src[j])) j++;
    const raw = src.slice(i, j);
    i = j;
    return raw.trim();
  };
  const value = (stops: string): unknown => {
    ws();
    if (src[i] === '[') {
      i++;
      const out: unknown[] = [];
      for (;;) {
        ws();
        if (src[i] === ']') {
          i++;
          return out;
        }
        out.push(value(',]'));
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== ']') throw new YamlError('Lista en línea mal cerrada');
      }
    }
    if (src[i] === '{') {
      i++;
      const out: Record<string, unknown> = {};
      for (;;) {
        ws();
        if (src[i] === '}') {
          i++;
          return out;
        }
        const k = str(':,}');
        ws();
        let v: unknown = null;
        if (src[i] === ':') {
          i++;
          v = value(',}');
        }
        out[k] = v;
        ws();
        if (src[i] === ',') i++;
        else if (src[i] !== '}') throw new YamlError('Mapa en línea mal cerrado');
      }
    }
    if (src[i] === '!') {
      let j = i + 1;
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
      const tag = src.slice(i + 1, j);
      i = j;
      return tagged(tag, value(stops));
    }
    const quoted = src[i] === '"' || src[i] === "'";
    const s = str(stops);
    return quoted ? s : scalar(s);
  };
  const v = value('');
  ws();
  if (i < src.length) throw new YamlError(`Texto inesperado: ${src.slice(i, i + 20)}`);
  return v;
}

function tagged(tag: string, v: unknown): unknown {
  const key = SHORT[tag];
  if (!key) throw new YamlError(`Etiqueta desconocida: !${tag}`);
  if (tag === 'GetAtt' && typeof v === 'string') {
    const dot = v.indexOf('.');
    return { [key]: dot < 0 ? [v] : [v.slice(0, dot), v.slice(dot + 1)] };
  }
  return { [key]: v };
}

const balanced = (s: string) => {
  let d = 0;
  let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d <= 0;
};

class Parser {
  all: string[];
  lines: Ln[] = [];
  /** Línea física de cada línea significativa (para leer bloques de texto). */
  phys: number[] = [];
  i = 0;

  constructor(src: string) {
    this.all = src.replace(/\r/g, '').split('\n');
    this.all.forEach((raw, n) => {
      const body = stripComment(raw);
      if (!body.trim()) return;
      if (/^\t/.test(body)) throw new YamlError(`Línea ${n + 1}: YAML no admite tabuladores para sangrar`);
      this.lines.push({ indent: body.length - body.trimStart().length, text: body.trim(), raw });
      this.phys.push(n);
    });
  }

  peek(): Ln | undefined {
    return this.lines[this.i];
  }

  node(minIndent: number): unknown {
    const ln = this.peek();
    if (!ln || ln.indent < minIndent) return null;
    const t = ln.text;
    if (t === '-' || t.startsWith('- ')) return this.seq(ln.indent);
    if (keyColon(t) >= 0 && !t.startsWith('[') && !t.startsWith('{') && !t.startsWith('!')) return this.map(ln.indent);
    this.i++;
    return this.inline(t, ln.indent, ln);
  }

  seq(indent: number): unknown[] {
    const out: unknown[] = [];
    for (;;) {
      const ln = this.peek();
      if (!ln || ln.indent !== indent || !(ln.text === '-' || ln.text.startsWith('- '))) break;
      const rest = ln.text.slice(1).trimStart();
      if (!rest) {
        this.i++;
        out.push(this.node(indent + 1));
      } else {
        // el contenido del elemento hace de línea nueva, sangrada hasta donde empieza
        ln.indent = indent + (ln.text.length - rest.length);
        ln.text = rest;
        out.push(this.node(ln.indent));
      }
    }
    return out;
  }

  map(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (;;) {
      const ln = this.peek();
      if (!ln || ln.indent !== indent) break;
      const c = keyColon(ln.text);
      if (c < 0) throw new YamlError(`Se esperaba «clave: valor» en: ${ln.text}`);
      const key = unquote(ln.text.slice(0, c).trim());
      const rest = ln.text.slice(c + 1).trim();
      this.i++;
      if (!rest) {
        const nx = this.peek();
        if (nx && nx.indent === indent && (nx.text === '-' || nx.text.startsWith('- '))) out[key] = this.seq(indent);
        else out[key] = this.node(indent + 1);
      } else out[key] = this.inline(rest, indent, ln);
    }
    const nx = this.peek();
    if (nx && nx.indent > indent) throw new YamlError(`Sangría inesperada en: ${nx.text}`);
    return out;
  }

  /** Valor escrito tras `clave:` o `- `: etiqueta, bloque de texto, valor en línea o escalar. */
  inline(text: string, indent: number, ln: Ln): unknown {
    if (text.startsWith('!')) {
      const m = /^!([A-Za-z]+)\s*(.*)$/.exec(text)!;
      const rest = m[2];
      if (!rest) return tagged(m[1], this.node(indent + 1));
      return tagged(m[1], this.inline(rest, indent, ln));
    }
    const bs = /^([|>])([+-]?)\d*$/.exec(text);
    if (bs) return this.block(bs[1] as '|' | '>', bs[2], indent, ln);
    if (text.startsWith('[') || text.startsWith('{')) {
      let full = text;
      while (!balanced(full) && this.i < this.lines.length) full += ' ' + this.lines[this.i++].text;
      return flow(full);
    }
    return scalar(text);
  }

  block(style: '|' | '>', chomp: string, indent: number, ln: Ln): string {
    // la línea física del encabezado (la última leída es la anterior a this.i)
    const headPhys = this.phys[this.lines.indexOf(ln)];
    const parentIndent = Math.max(indent, ln.raw.length - ln.raw.trimStart().length);
    const body: string[] = [];
    let n = headPhys + 1;
    let blockIndent = -1;
    for (; n < this.all.length; n++) {
      const raw = this.all[n];
      if (!raw.trim()) {
        body.push('');
        continue;
      }
      const ind = raw.length - raw.trimStart().length;
      if (blockIndent < 0) {
        if (ind <= parentIndent) break;
        blockIndent = ind;
      } else if (ind < blockIndent) break;
      body.push(raw.slice(blockIndent));
    }
    // salta las líneas significativas ya consumidas
    while (this.i < this.lines.length && this.phys[this.i] < n) this.i++;
    while (body.length && body[body.length - 1] === '') body.pop();
    let text = style === '|' ? body.join('\n') : body.reduce((s, l, k) => (k === 0 ? l : l === '' ? s + '\n' : s.endsWith('\n') ? s + l : s + ' ' + l), '');
    if (chomp !== '-') text += '\n';
    return text;
  }
}

/** Lee una plantilla en JSON o YAML. */
export function parseTemplate(src: string): Record<string, unknown> {
  const t = src.trim();
  if (!t) throw new YamlError('La plantilla está vacía');
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch (e) {
      throw new YamlError(`JSON mal formado: ${(e as Error).message}`);
    }
  }
  const p = new Parser(src);
  const v = p.node(0);
  if (p.i < p.lines.length) throw new YamlError(`No se esperaba: ${p.lines[p.i].text}`);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new YamlError('La plantilla debe ser un mapa con Resources');
  return v as Record<string, unknown>;
}

// ───────────────────────── salida ─────────────────────────

const plain = (s: string): boolean => /^[A-Za-z_/$][A-Za-z0-9_./$:@-]*(?: [A-Za-z0-9_./$:@-]+)*$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) && !/^-?\d/.test(s);

function dumpScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return plain(v) ? v : JSON.stringify(v);
  return String(v);
}

/** Escribe una estructura como YAML (mapas y listas en bloque; las funciones intrínsecas salen en forma larga, que CloudFormation acepta). */
export function dumpYaml(v: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}[]\n`;
    return v
      .map((x) => {
        if (x !== null && typeof x === 'object' && !(Array.isArray(x) && !x.length) && !(!Array.isArray(x) && !Object.keys(x as object).length)) {
          const inner = dumpYaml(x, indent + 2);
          return `${pad}- ${inner.slice(indent + 2)}`;
        }
        return `${pad}- ${Array.isArray(x) ? '[]' : x !== null && typeof x === 'object' ? '{}' : dumpScalar(x)}\n`;
      })
      .join('');
  }
  if (v !== null && typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>);
    if (!e.length) return `${pad}{}\n`;
    return e
      .map(([k, x]) => {
        const key = plain(k) || /^[A-Za-z0-9_:.-]+$/.test(k) ? k : JSON.stringify(k);
        if (Array.isArray(x)) return x.length ? `${pad}${key}:\n${dumpYaml(x, indent + 2)}` : `${pad}${key}: []\n`;
        if (x !== null && typeof x === 'object') return Object.keys(x).length ? `${pad}${key}:\n${dumpYaml(x, indent + 2)}` : `${pad}${key}: {}\n`;
        return `${pad}${key}: ${dumpScalar(x)}\n`;
      })
      .join('');
  }
  return `${pad}${dumpScalar(v)}\n`;
}
