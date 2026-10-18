/** Markdown ligero para las lecciones: párrafos, listas, tablas, bloques de código y avisos. */
import type { Block, InlineSpan } from './types';

const CALLOUTS: Record<string, 'tip' | 'warn' | 'note' | 'key'> = {
  TIP: 'tip',
  OJO: 'warn',
  CUIDADO: 'warn',
  NOTA: 'note',
  CLAVE: 'key',
};

export function parseRich(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  const isBlank = (l: string) => l.trim() === '';
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push({ k: 'code', lines: code });
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ k: 'h', t: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      const text = buf.join(' ').trim();
      const m = /^([A-ZÁÉÍÓÚ]+):\s*(.*)$/s.exec(text);
      if (m && CALLOUTS[m[1]]) blocks.push({ k: 'callout', kind: CALLOUTS[m[1]], t: m[2] });
      else blocks.push({ k: 'callout', kind: 'note', t: text });
      continue;
    }
    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        rows.push(cells);
        i++;
      }
      const sepIdx = rows.findIndex((r) => r.every((c) => /^:?-{2,}:?$/.test(c)));
      const head = sepIdx === 1 ? rows[0] : [];
      const body = rows.filter((_r, k) => k !== sepIdx && !(sepIdx === 1 && k === 0));
      blocks.push({ k: 'table', head, rows: body });
      continue;
    }
    if (/^(- |\* )/.test(line) || /^\d+\.\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^(- |\* )/.test(lines[i]) || /^\d+\.\s/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        if (/^\s{2,}\S/.test(lines[i])) items[items.length - 1] += ' ' + lines[i].trim();
        else items.push(lines[i].replace(/^(- |\* |\d+\.\s)/, ''));
        i++;
      }
      blocks.push({ k: 'list', items, ordered });
      continue;
    }
    // párrafo
    const buf: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !lines[i].startsWith('>') && !lines[i].startsWith('|') && !lines[i].trim().startsWith('```') && !/^(- |\* |## )/.test(lines[i]) && !/^\d+\.\s/.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ k: 'p', t: buf.join(' ') });
  }
  return blocks;
}

/** Divide un texto en tramos: **negrita**, `código`, _cursiva_. */
export function parseInline(src: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<=^|[\s(¿¡])_[^_\s][^_]*_(?=$|[\s).,;:!?]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', s: src.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ t: 'b', s: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ t: 'code', s: tok.slice(1, -1) });
    else out.push({ t: 'i', s: tok.slice(1, -1) });
    last = m.index + tok.length;
  }
  if (last < src.length) out.push({ t: 'text', s: src.slice(last) });
  return out;
}
