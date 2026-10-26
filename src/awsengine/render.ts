/** Formatos de salida de la CLI de AWS: json, text, table, yaml. */
import { isObj } from './util';

export type OutputFormat = 'json' | 'text' | 'table' | 'yaml' | 'yaml-stream';
export const OUTPUT_FORMATS: OutputFormat[] = ['json', 'text', 'table', 'yaml', 'yaml-stream'];

// ───────────────────────── json ─────────────────────────

export const renderJson = (v: unknown): string => (v === undefined ? 'null' : JSON.stringify(v, null, 4));

// ───────────────────────── text ─────────────────────────

/** Como `str()` de Python: None, True, False. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number' && Number.isInteger(v) === false) return String(v);
  return String(v);
}

const isScalar = (v: unknown) => !Array.isArray(v) && !isObj(v);

export function renderText(data: unknown): string {
  const out: string[] = [];
  const fmt = (item: unknown, identifier: string | null, scalarKeys: string[] | null): void => {
    if (isObj(item)) {
      const scalars: string[] = [];
      const non: [string, unknown][] = [];
      const entries = Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      if (scalarKeys === null) {
        for (const [k, v] of entries) {
          if (isScalar(v)) scalars.push(pyStr(v));
          else non.push([k, v]);
        }
      } else {
        for (const k of scalarKeys) scalars.push(k in item ? pyStr(item[k]) : '');
        for (const [k, v] of entries) if (!scalarKeys.includes(k)) non.push([k, v]);
      }
      if (scalars.length) {
        if (identifier !== null) scalars.unshift(identifier.toUpperCase());
        out.push(scalars.join('\t'));
      }
      for (const [k, v] of non) fmt(v, k, null);
    } else if (Array.isArray(item)) {
      if (!item.length) return;
      if (item.some(isObj)) {
        const keys = new Set<string>();
        for (const el of item) if (isObj(el)) for (const [k, v] of Object.entries(el)) if (isScalar(v)) keys.add(k);
        const all = [...keys].sort();
        for (const el of item) fmt(el, identifier, all);
      } else if (item.some(Array.isArray)) {
        const scal = item.filter(isScalar);
        if (scal.length) scalarList(scal, identifier);
        for (const el of item) if (!isScalar(el)) fmt(el, identifier, null);
      } else scalarList(item, identifier);
    } else out.push(pyStr(item));
  };
  const scalarList = (els: unknown[], identifier: string | null) => {
    if (identifier !== null) for (const e of els) out.push(`${identifier.toUpperCase()}\t${pyStr(e)}`);
    else out.push(els.map(pyStr).join('\t'));
  };
  fmt(data, null, null);
  return out.join('\n') + (out.length ? '\n' : '');
}

// ───────────────────────── yaml ─────────────────────────

function yamlScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return "''";
  if (s.includes('\n')) return JSON.stringify(s);
  const risky = /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^[-+]?(\d[\d_]*\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) || /^\d{4}-\d{2}-\d{2}/.test(s) || /^[\s!&*[\]{}|>'"%@`#,?:-]/.test(s) || /(: | #|:$)/.test(s) || s !== s.trim();
  return risky ? `'${s.replace(/'/g, "''")}'` : s;
}

export function renderYaml(data: unknown): string {
  const lines: string[] = [];
  const emit = (v: unknown, indent: number, prefix: string): void => {
    const pad = ' '.repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) {
        lines.push(`${pad}${prefix}[]`);
        return;
      }
      for (const el of v) {
        if (isObj(el) && Object.keys(el).length) {
          const ents = Object.entries(el);
          ents.forEach(([k, x], i) => {
            const lead = i === 0 ? `${pad}- ` : `${pad}  `;
            put(x, lead, k, indent + 2);
          });
        } else if (Array.isArray(el) && el.length) {
          lines.push(`${pad}-`);
          emit(el, indent + 2, '');
        } else lines.push(`${pad}- ${isObj(el) ? '{}' : Array.isArray(el) ? '[]' : yamlScalar(el)}`);
      }
    } else if (isObj(v)) {
      const ents = Object.entries(v);
      if (!ents.length) lines.push(`${pad}${prefix}{}`);
      for (const [k, x] of ents) put(x, pad, k, indent);
    } else lines.push(`${pad}${prefix}${yamlScalar(v)}`);
  };
  const put = (x: unknown, lead: string, k: string, indent: number) => {
    if (Array.isArray(x) && x.length) {
      lines.push(`${lead}${k}:`);
      emit(x, indent, '');
    } else if (isObj(x) && Object.keys(x).length) {
      lines.push(`${lead}${k}:`);
      emit(x, indent + 2, '');
    } else lines.push(`${lead}${k}: ${Array.isArray(x) ? '[]' : isObj(x) ? '{}' : yamlScalar(x)}`);
  };
  emit(data, 0, '');
  return lines.join('\n') + '\n';
}

// ───────────────────────── table ─────────────────────────

interface Section {
  title: string | null;
  indent: number;
  headers: string[] | null;
  rows: string[][];
}

function groupScalarKeys(d: Record<string, unknown>): [string[], string[]] {
  const heads: string[] = [];
  const more: string[] = [];
  for (const k of Object.keys(d).sort()) (isScalar(d[k]) ? heads : more).push(k);
  return [heads, more];
}

function buildSections(title: string | null, cur: unknown, indent: number, secs: Section[]): void {
  if (cur === null || cur === undefined || (Array.isArray(cur) && !cur.length)) return;
  if (title !== null) secs.push({ title, indent, headers: null, rows: [] });
  const last = () => secs[secs.length - 1] ?? (secs.push({ title: null, indent, headers: null, rows: [] }), secs[secs.length - 1]);
  if (Array.isArray(cur)) {
    if (isObj(cur[0])) {
      const heads = new Set<string>();
      const more = new Set<string>();
      for (const el of cur) if (isObj(el)) for (const [k, v] of Object.entries(el)) (isScalar(v) ? heads : more).add(k);
      const H = [...heads].sort();
      const M = [...more].sort();
      let first = true;
      last().headers = H;
      for (const el of cur as Record<string, unknown>[]) {
        if (!first && M.length) secs.push({ title, indent, headers: H, rows: [] });
        first = false;
        last().rows.push(H.map((h) => (h in el ? pyStr(el[h]) : '')));
        for (const r of M) if (r in el) buildSections(r, el[r], indent + 1, secs);
      }
    } else {
      for (const it of cur) {
        if (isScalar(it)) last().rows.push([pyStr(it)]);
        else if (Array.isArray(it) && it.every(isScalar)) last().rows.push(it.map(pyStr));
        else buildSections(null, it, indent, secs);
      }
    }
  } else if (isObj(cur)) {
    const [H, M] = groupScalarKeys(cur);
    const s = last();
    if (H.length === 1) s.rows.push([H[0], pyStr(cur[H[0]])]);
    else if (H.length) {
      s.headers = H;
      s.rows.push(H.map((h) => pyStr(cur[h])));
    }
    for (const r of M) buildSections(r, cur[r], indent + 1, secs);
  } else {
    last().rows.push([pyStr(cur)]);
  }
}

const center = (s: string, w: number) => {
  const total = Math.max(0, w - s.length);
  const l = Math.floor(total / 2);
  return ' '.repeat(l) + s + ' '.repeat(total - l);
};

/** Parte un texto en trozos de `n` caracteres, cortando en espacios cuando se puede. */
function wrapCell(s: string, n: number): string[] {
  if (s.length <= n) return [s];
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    let w = word;
    while (w.length > n) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= n) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Reduce las columnas más anchas hasta que la tabla de la sección quepa en `max` caracteres. */
function shrink(cols: number[], fixed: number, max: number): number[] {
  const out = [...cols];
  while (out.reduce((a, b) => a + b, 0) + fixed > max) {
    let k = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[k]) k = i;
    if (out[k] <= 10) break;
    out[k]--;
  }
  return out;
}

/**
 * Tabla ASCII como la de `--output table`. `title` es el nombre de la operación (p. ej. `DescribeInstances`).
 * Con `maxWidth` (la anchura de la terminal) las columnas anchas se estrechan y el texto se parte en varias líneas.
 */
export function renderTable(data: unknown, title: string, maxWidth?: number): string {
  const secs: Section[] = [];
  buildSections(title, data, 0, secs);
  if (!secs.length) return '';
  // anchos naturales de cada sección
  const widths = secs.map((s) => {
    const n = Math.max(s.headers?.length ?? 0, ...s.rows.map((r) => r.length), 1);
    const cols = Array.from({ length: n }, (_, i) => Math.max((s.headers?.[i] ?? '').length, ...s.rows.map((r) => (r[i] ?? '').length)) + 4);
    return maxWidth ? shrink(cols, cols.length - 1 + 2 + 2 * s.indent, maxWidth) : cols;
  });
  let total = 0;
  secs.forEach((s, i) => {
    const w = widths[i].reduce((a, b) => a + b, 0) + (widths[i].length - 1) + 2 + 2 * s.indent;
    total = Math.max(total, w, Math.min((s.title ?? '').length + 6 + 2 * s.indent, maxWidth ?? Infinity));
  });
  const lines: string[] = [];
  lines.push('-'.repeat(total));
  secs.forEach((s, si) => {
    const m = '|'.repeat(s.indent);
    const inner = total - 2 * s.indent;
    const cols = [...widths[si]];
    const sum = cols.reduce((a, b) => a + b, 0) + (cols.length - 1) + 2;
    cols[cols.length - 1] += inner - sum;
    const sep = m + '+' + cols.map((w) => '-'.repeat(w)).join('+') + '+' + m;
    const row = (cells: string[], ctr: boolean) => {
      const parts = cols.map((w, i) => (maxWidth ? wrapCell(cells[i] ?? '', Math.max(1, w - 4)) : [cells[i] ?? '']));
      const h = Math.max(...parts.map((p) => p.length));
      for (let k = 0; k < h; k++) {
        lines.push(m + '|' + cols.map((w, i) => { const c = parts[i][k] ?? ''; return ctr ? center(c, w) : '  ' + c + ' '.repeat(Math.max(0, w - 2 - c.length)); }).join('|') + '|' + m);
      }
    };
    if (s.title !== null && (si === 0 || s.title !== secs[si - 1].title || s.rows.length === 0 || !s.headers)) {
      lines.push(m + '|' + center(s.title, inner - 2) + '|' + m);
      if (!(s.headers || s.rows.length)) {
        lines.push(m + '+' + '-'.repeat(inner - 2) + '+' + m);
        return;
      }
    }
    if (s.headers || s.rows.length) {
      lines.push(sep);
      if (s.headers) {
        row(s.headers, true);
        lines.push(sep);
      }
      for (const r of s.rows) row(r, false);
      lines.push(sep);
    }
  });
  return lines.join('\n') + '\n';
}

/** Genera el texto final de una respuesta de la CLI según el formato. */
export function renderOutput(data: unknown, fmt: OutputFormat, opTitle: string, cols?: number): string {
  switch (fmt) {
    case 'text': return renderText(data);
    case 'table': return renderTable(data, opTitle, cols);
    case 'yaml': return renderYaml(data);
    case 'yaml-stream': return Array.isArray(data) ? data.map((x) => '- ' + renderYaml(x).replace(/\n(?=.)/g, '\n  ')).join('') : renderYaml(data);
    default: return renderJson(data) + '\n';
  }
}
