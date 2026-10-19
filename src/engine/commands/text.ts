/** Procesamiento de texto: head, tail, wc, sort, uniq, cut, tr, diff… */
import { padStart, table, humanSize } from '../format';
import { basename } from '../path';
import { BufferStdin, defineCommand, parseOpts, type Ctx } from '../registry';
import { SignalEx } from '../shell';
import { FsError, utf8Length } from '../vfs';
import { b64decode, b64encode, md5, sha1, sha256 } from './hash';
import { joinLines, readInputs, splitLines, formatPrintf } from './util';

// ───────────────────────── head / tail ─────────────────────────

defineCommand('head', {
  summary: 'Muestra las primeras líneas de un archivo',
  usage: 'head [-n N] [-c N] [ARCHIVO]...',
  category: 'texto',
  level: 1,
  options: [['-n N', 'Primeras N líneas (por defecto 10)'], ['-n -N', 'Todas menos las últimas N'], ['-c N', 'Primeros N bytes'], ['-q / -v', 'Sin / con cabecera de nombre']],
  examples: [['head -n 5 log.txt', 'Las 5 primeras líneas'], ['ls -l | head -3', 'Recorta la salida de otro comando']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'qv', values: 'nc', numeric: true, long: { '--lines': 'n', '--bytes': 'c', '--quiet': 'q', '--verbose': 'v' } });
  const nStr = o.val('n') ?? o.numeric ?? (o.val('c') ? undefined : '10');
  const { inputs, failed } = await readInputs(c, o.rest);
  inputs.forEach((inp, idx) => {
    if ((inputs.length > 1 && !o.has('q')) || o.has('v')) c.out(`${idx ? '\n' : ''}==> ${inp.name === '-' ? 'standard input' : inp.name} <==\n`);
    if (o.val('c') !== undefined) {
      const n = parseInt(o.val('c')!, 10);
      c.out(n >= 0 ? inp.text.slice(0, n) : inp.text.slice(0, Math.max(0, inp.text.length + n)));
      return;
    }
    const n = parseInt(nStr!, 10);
    if (Number.isNaN(n)) {
      c.err(`head: invalid number of lines: ‘${nStr}’\n`);
      return;
    }
    const lines = inp.text === '' ? [] : inp.text.split('\n');
    const hasTrail = inp.text.endsWith('\n');
    if (hasTrail) lines.pop();
    const sel = n >= 0 ? lines.slice(0, n) : lines.slice(0, Math.max(0, lines.length + n));
    c.out(sel.length ? sel.join('\n') + (sel.length < lines.length || hasTrail ? '\n' : '') : '');
  });
  return failed ? 1 : 0;
});

defineCommand('tail', {
  summary: 'Muestra las últimas líneas de un archivo (y sigue su crecimiento con -f)',
  usage: 'tail [-n N] [-f] [ARCHIVO]...',
  category: 'texto',
  level: 1,
  options: [['-n N', 'Últimas N líneas (por defecto 10)'], ['-n +N', 'Desde la línea N hasta el final'], ['-f', 'Sigue el archivo en tiempo real (Ctrl+C para salir)'], ['-c N', 'Últimos N bytes']],
  examples: [['tail -n 20 /var/log/syslog', 'Las últimas 20 líneas del log'], ['tail -f /var/log/auth.log', 'Observa el log en vivo']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'qvfF', values: 'ncs', numeric: true, long: { '--lines': 'n', '--bytes': 'c', '--follow': 'f', '--quiet': 'q' } });
  const spec = o.val('n') ?? o.numeric ?? (o.val('c') ? undefined : '10');
  const { inputs, failed } = await readInputs(c, o.rest);
  inputs.forEach((inp, idx) => {
    if ((inputs.length > 1 && !o.has('q')) || o.has('v')) c.out(`${idx ? '\n' : ''}==> ${inp.name === '-' ? 'standard input' : inp.name} <==\n`);
    if (o.val('c') !== undefined) {
      const n = parseInt(o.val('c')!, 10);
      c.out(inp.text.slice(Math.max(0, inp.text.length - n)));
      return;
    }
    const lines = inp.text === '' ? [] : inp.text.split('\n');
    const hasTrail = inp.text.endsWith('\n');
    if (hasTrail) lines.pop();
    let sel: string[];
    if (spec!.startsWith('+')) sel = lines.slice(Math.max(0, parseInt(spec!.slice(1), 10) - 1));
    else sel = lines.slice(Math.max(0, lines.length - parseInt(spec!.replace('-', ''), 10)));
    c.out(sel.length ? sel.join('\n') + '\n' : '');
  });
  if ((o.has('f') || o.has('F')) && c.io.tty && o.rest.length && !c.sh.bg) {
    const f = o.rest[0];
    let last = inputs[0]?.text.length ?? 0;
    for (;;) {
      await c.sh.sleep(1000);
      let cur: string;
      try {
        cur = c.fs.readFile(c.abs(f), c.cred);
      } catch {
        continue;
      }
      if (cur.length > last) {
        c.out(cur.slice(last));
        last = cur.length;
      } else if (cur.length < last) {
        c.err(`tail: ${f}: file truncated\n`);
        last = 0;
      }
    }
  }
  return failed ? 1 : 0;
});

// ───────────────────────── wc ─────────────────────────

defineCommand('wc', {
  summary: 'Cuenta líneas, palabras y bytes',
  usage: 'wc [-lwcm] [ARCHIVO]...',
  category: 'texto',
  level: 1,
  options: [['-l', 'Líneas'], ['-w', 'Palabras'], ['-c', 'Bytes'], ['-m', 'Caracteres'], ['-L', 'Longitud de la línea más larga']],
  examples: [['wc -l notas.txt', 'Número de líneas'], ['ls | wc -l', 'Cuántos archivos hay'], ['cat *.txt | wc -w', 'Palabras totales']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'lwcmL', long: { '--lines': 'l', '--words': 'w', '--bytes': 'c', '--chars': 'm' } });
  const { inputs, failed } = await readInputs(c, o.rest);
  const any = o.has('l') || o.has('w') || o.has('c') || o.has('m') || o.has('L');
  const rows = inputs.map((inp) => {
    const t = inp.text;
    const nums: number[] = [];
    if (o.has('l') || !any) nums.push((t.match(/\n/g) ?? []).length);
    if (o.has('w') || !any) nums.push(t.split(/\s+/).filter(Boolean).length);
    if (o.has('m')) nums.push([...t].length);
    if (o.has('c') || !any) nums.push(utf8Length(t));
    if (o.has('L')) nums.push(Math.max(0, ...t.split('\n').map((l) => l.length)));
    return { name: inp.name === '-' && o.rest.length === 0 ? '' : inp.name, nums };
  });
  if (rows.length > 1) {
    const total = rows[0].nums.map((_, i) => rows.reduce((s, r) => s + r.nums[i], 0));
    rows.push({ name: 'total', nums: total });
  }
  const width = rows.length === 1 && !rows[0].name ? 1 : Math.max(1, ...rows.flatMap((r) => r.nums.map((n) => String(n).length)));
  for (const r of rows) {
    c.out(r.nums.map((n) => String(n).padStart(width)).join(' ') + (r.name ? ' ' + r.name : '') + '\n');
  }
  return failed ? 1 : 0;
});

// ───────────────────────── sort / uniq ─────────────────────────

export function collateCmp(a: string, b: string, c_locale = false): number {
  if (c_locale) return a < b ? -1 : a > b ? 1 : 0;
  const ka = a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const kb = b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  // desempate: minúsculas antes que mayúsculas, luego signos
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function leadingNumber(s: string): number {
  const m = /^\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/.exec(s);
  return m ? parseFloat(m[1]) : 0;
}

function humanNumber(s: string): number {
  const m = /^\s*([-+]?\d*\.?\d+)\s*([KMGTPkmgtp]?)/.exec(s);
  if (!m) return 0;
  const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12, p: 1e15 }[m[2].toLowerCase() as '' | 'k'] ?? 1;
  return parseFloat(m[1]) * mult;
}

const MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface SortKey {
  f1: number;
  c1: number;
  f2: number;
  c2: number;
  n: boolean;
  r: boolean;
  f: boolean;
  h: boolean;
  M: boolean;
  b: boolean;
  V: boolean;
}

function parseKey(spec: string): SortKey | null {
  const m = /^(\d+)(?:\.(\d+))?([bdfghiMnrV]*)(?:,(\d+)(?:\.(\d+))?([bdfghiMnrV]*))?$/.exec(spec);
  if (!m) return null;
  const mods = (m[3] ?? '') + (m[6] ?? '');
  return {
    f1: parseInt(m[1], 10), c1: m[2] ? parseInt(m[2], 10) : 0,
    f2: m[4] ? parseInt(m[4], 10) : 0, c2: m[5] ? parseInt(m[5], 10) : 0,
    n: mods.includes('n'), r: mods.includes('r'), f: mods.includes('f'),
    h: mods.includes('h'), M: mods.includes('M'), b: mods.includes('b'), V: mods.includes('V'),
  };
}

function versionCmp(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (i % 2 === 1) {
      const d = parseInt(x, 10) - parseInt(y || '0', 10);
      if (d) return d;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

defineCommand('sort', {
  summary: 'Ordena las líneas de texto',
  usage: 'sort [OPCIÓN]... [ARCHIVO]...',
  category: 'texto',
  level: 1,
  options: [['-n', 'Orden numérico'], ['-r', 'Orden inverso'], ['-u', 'Elimina líneas repetidas'], ['-k N', 'Ordena por la columna N'], ['-t SEP', 'Separador de columnas'], ['-f', 'Ignora mayúsculas'], ['-h', 'Orden de números legibles (1K, 2M)'], ['-M', 'Orden por meses (Jan, Feb…)']],
  examples: [['sort nombres.txt', 'Orden alfabético'], ['sort -n -r numeros.txt', 'Numérico de mayor a menor'], ['sort -t, -k2 -n datos.csv', 'CSV ordenado por la 2.ª columna'], ['sort | uniq -c', 'Cuenta repeticiones']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'nrufhMbVcCsdgi', values: 'kto', long: { '--numeric-sort': 'n', '--reverse': 'r', '--unique': 'u', '--ignore-case': 'f', '--human-numeric-sort': 'h', '--version-sort': 'V', '--key': 'k', '--field-separator': 't', '--stable': 's', '--check': 'c', '--output': 'o' } });
  const { inputs, failed } = await readInputs(c, o.rest);
  const lines = inputs.flatMap((i) => splitLines(i.text));
  const sep = o.val('t');
  const cLocale = c.sh.getVar('LC_ALL') === 'C' || c.sh.getVar('LC_COLLATE') === 'C';
  const keys = o.all('k').map(parseKey);
  if (keys.some((k) => k === null)) return c.fail(`invalid number at field start: invalid count at start of '${o.all('k')[0]}'`, 2);
  const kspecs = keys as SortKey[];
  const globalOpts = { n: o.has('n'), r: o.has('r'), f: o.has('f'), h: o.has('h'), M: o.has('M'), b: o.has('b'), V: o.has('V') };

  const fieldsOf = (line: string): string[] => (sep ? line.split(sep) : line.split(/(?<=\S)(?=\s)|(?<=\s)(?=\S)/).reduce<string[]>((acc, part) => {
    // campos = (blancos + no-blancos)
    if (/^\s+$/.test(part)) acc.push(part);
    else if (acc.length && /^\s+$/.test(acc[acc.length - 1]) && acc.length % 1 === 0) acc[acc.length - 1] += part;
    else acc.push(part);
    return acc;
  }, []));

  const extract = (line: string, k: SortKey): string => {
    const f = fieldsOf(line);
    // para el separador por defecto cada campo incluye los blancos previos
    const fields = f;
    const start = Math.max(0, k.f1 - 1);
    const end = k.f2 ? k.f2 : fields.length;
    let s = fields.slice(start, end).join(sep ?? '');
    if (!sep && (k.b || globalOpts.b)) s = s.replace(/^\s+/, '');
    if (k.c1 > 1 && fields[start] !== undefined) {
      const first = fields[start];
      s = first.slice(k.c1 - 1) + (end - start > 1 ? (sep ?? '') + fields.slice(start + 1, end).join(sep ?? '') : '');
    }
    if (k.f2 && k.c2 > 0) {
      const lastField = fields[end - 1] ?? '';
      const before = fields.slice(start, end - 1).join(sep ?? '');
      s = (before ? before + (sep ?? '') : '') + lastField.slice(0, k.c2);
    }
    return s;
  };

  const cmpWith = (a: string, b: string, o2: { n: boolean; f: boolean; h: boolean; M: boolean; V: boolean }) => {
    if (o2.n) return leadingNumber(a) - leadingNumber(b);
    if (o2.h) return humanNumber(a) - humanNumber(b);
    if (o2.M) return MONTH_ORDER.indexOf(a.trim().slice(0, 3).toLowerCase()) - MONTH_ORDER.indexOf(b.trim().slice(0, 3).toLowerCase());
    if (o2.V) return versionCmp(a, b);
    if (o2.f) return collateCmp(a.toUpperCase(), b.toUpperCase(), cLocale);
    return collateCmp(a, b, cLocale);
  };

  const compare = (a: string, b: string): number => {
    if (kspecs.length) {
      for (const k of kspecs) {
        const ka = extract(a, k);
        const kb = extract(b, k);
        const anyMod = k.n || k.f || k.h || k.M || k.V || k.r;
        const eff = anyMod ? k : { ...k, n: globalOpts.n, f: globalOpts.f, h: globalOpts.h, M: globalOpts.M, V: globalOpts.V, r: globalOpts.r && !k.r };
        let d = cmpWith(ka, kb, eff);
        if (d !== 0) return (anyMod ? k.r : globalOpts.r) ? -d : d;
      }
      if (o.has('s') || o.has('u')) return 0;
      const d = collateCmp(a, b, cLocale);
      return globalOpts.r ? -d : d;
    }
    const d = cmpWith(a, b, globalOpts);
    if (d !== 0) return globalOpts.r ? -d : d;
    if (o.has('s') || o.has('u')) return 0;
    const d2 = collateCmp(a, b, cLocale);
    return globalOpts.r ? -d2 : d2;
  };

  if (o.has('c') || o.has('C')) {
    for (let i = 1; i < lines.length; i++) {
      if (compare(lines[i - 1], lines[i]) > 0) {
        c.err(`sort: ${o.rest[0] ?? '-'}:${i + 1}: disorder: ${lines[i]}\n`);
        return 1;
      }
    }
    return 0;
  }
  const idx = lines.map((l, i) => ({ l, i }));
  idx.sort((x, y) => compare(x.l, y.l) || x.i - y.i);
  let out = idx.map((x) => x.l);
  if (o.has('u')) out = out.filter((l, i) => i === 0 || compare(out[i - 1], l) !== 0);
  const text = joinLines(out);
  if (o.val('o')) {
    try {
      c.fs.writeFile(c.abs(o.val('o')!), text, { cred: c.cred });
    } catch (e) {
      return c.fsfail(e, o.val('o')!);
    }
  } else c.out(text);
  return failed ? 2 : 0;
});

defineCommand('uniq', {
  summary: 'Filtra o cuenta líneas repetidas consecutivas',
  usage: 'uniq [OPCIÓN]... [ENTRADA [SALIDA]]',
  category: 'texto',
  level: 1,
  options: [['-c', 'Antepone el número de repeticiones'], ['-d', 'Solo líneas repetidas'], ['-u', 'Solo líneas únicas'], ['-i', 'Ignora mayúsculas'], ['-f N', 'Ignora los primeros N campos']],
  examples: [['sort lista.txt | uniq', 'Elimina duplicados (hay que ordenar antes)'], ['sort log | uniq -c | sort -nr', 'Ranking de frecuencias']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'cduiz', values: 'fsw', long: { '--count': 'c', '--repeated': 'd', '--unique': 'u', '--ignore-case': 'i' } });
  const { inputs, failed } = await readInputs(c, o.rest.slice(0, 1));
  const lines = inputs.flatMap((i) => splitLines(i.text));
  const skip = o.val('f') ? parseInt(o.val('f')!, 10) : 0;
  const keyOf = (l: string) => {
    let k = l;
    if (skip) k = l.split(/\s+/).slice(skip).join(' ');
    if (o.val('s')) k = k.slice(parseInt(o.val('s')!, 10));
    if (o.val('w')) k = k.slice(0, parseInt(o.val('w')!, 10));
    return o.has('i') ? k.toLowerCase() : k;
  };
  const groups: { line: string; n: number }[] = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (last && keyOf(last.line) === keyOf(l)) last.n++;
    else groups.push({ line: l, n: 1 });
  }
  let out = '';
  for (const g of groups) {
    if (o.has('d') && g.n < 2) continue;
    if (o.has('u') && g.n > 1) continue;
    out += (o.has('c') ? String(g.n).padStart(7) + ' ' : '') + g.line + '\n';
  }
  if (o.rest[1]) {
    try {
      c.fs.writeFile(c.abs(o.rest[1]), out, { cred: c.cred });
    } catch (e) {
      return c.fsfail(e, o.rest[1]);
    }
  } else c.out(out);
  return failed ? 1 : 0;
});

// ───────────────────────── cut / paste / column ─────────────────────────

function parseRanges(spec: string): [number, number][] | null {
  const out: [number, number][] = [];
  for (const part of spec.split(',')) {
    const m = /^(\d*)-?(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[2])) return null;
    if (!part.includes('-')) out.push([parseInt(m[1], 10), parseInt(m[1], 10)]);
    else out.push([m[1] ? parseInt(m[1], 10) : 1, m[2] ? parseInt(m[2], 10) : Infinity]);
  }
  return out;
}

defineCommand('cut', {
  summary: 'Extrae columnas o campos de cada línea',
  usage: 'cut -f LISTA [-d DELIM] | -c LISTA [ARCHIVO]...',
  category: 'texto',
  level: 2,
  options: [['-d SEP', 'Delimitador (por defecto TAB)'], ['-f LISTA', 'Campos a extraer (1,3  2-4  5-)'], ['-c LISTA', 'Caracteres a extraer'], ['--complement', 'Todo menos lo indicado'], ['-s', 'Omite líneas sin delimitador']],
  examples: [["cut -d: -f1 /etc/passwd", 'Lista de usuarios'], ['cut -c1-10 fichero', 'Primeros 10 caracteres'], ['cut -d, -f2,4 datos.csv', 'Columnas 2 y 4 del CSV']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'sz', values: 'dfcb', long: { '--delimiter': 'd', '--fields': 'f', '--characters': 'c', '--bytes': 'b', '--only-delimited': 's', '--complement': 'C', '--output-delimiter': 'O' } });
  const spec = o.val('f') ?? o.val('c') ?? o.val('b');
  if (!spec) return c.fail('you must specify a list of bytes, characters, or fields\nTry \'cut --help\' for more information.');
  const ranges = parseRanges(spec);
  if (!ranges) return c.fail(`invalid field range`);
  const delim = o.val('d') ?? '\t';
  if (o.val('d') && o.val('d')!.length !== 1) return c.fail('the delimiter must be a single character');
  const { inputs, failed } = await readInputs(c, o.rest);
  const inR = (i: number) => ranges.some(([a, b]) => i >= a && i <= b);
  const comp = o.has('C');
  for (const inp of inputs) {
    for (const line of splitLines(inp.text)) {
      if (o.val('f') !== undefined) {
        if (!line.includes(delim)) {
          if (!o.has('s')) c.out(line + '\n');
          continue;
        }
        const f = line.split(delim);
        c.out(f.filter((_x, i) => inR(i + 1) !== comp).join(delim) + '\n');
      } else {
        const chars = [...line];
        c.out(chars.filter((_x, i) => inR(i + 1) !== comp).join('') + '\n');
      }
    }
  }
  return failed ? 1 : 0;
});

defineCommand('paste', {
  summary: 'Une líneas de varios archivos en columnas',
  usage: 'paste [-d SEP] [-s] ARCHIVO...',
  category: 'texto',
  level: 3,
  options: [['-d SEP', 'Separador (por defecto TAB)'], ['-s', 'Une todas las líneas de cada archivo en una sola']],
  examples: [['paste nombres.txt edades.txt', 'Dos columnas'], ['paste -sd, lista.txt', 'Todo en una línea separado por comas']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 's', values: 'd' });
  const d = o.val('d') ?? '\t';
  const { inputs } = await readInputs(c, o.rest);
  const cols = inputs.map((i) => splitLines(i.text));
  if (o.has('s')) {
    for (const col of cols) c.out(col.join(d) + '\n');
    return 0;
  }
  const n = Math.max(0, ...cols.map((x) => x.length));
  for (let i = 0; i < n; i++) c.out(cols.map((x) => x[i] ?? '').join(d) + '\n');
});

defineCommand('column', {
  summary: 'Formatea la entrada en columnas alineadas',
  usage: 'column [-t] [-s SEP] [ARCHIVO]',
  category: 'texto',
  level: 3,
  options: [['-t', 'Crea una tabla alineada'], ['-s SEP', 'Separador de entrada']],
  examples: [['mount | column -t', 'Tabla ordenada'], ['column -t -s, datos.csv', 'CSV alineado']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 't', values: 'sowc' });
  const { inputs } = await readInputs(c, o.rest);
  const lines = inputs.flatMap((i) => splitLines(i.text));
  if (!o.has('t')) {
    c.out(lines.join('\n') + '\n');
    return 0;
  }
  const sep = o.val('s');
  const rows = lines.map((l) => (sep ? l.split(new RegExp(`[${sep.replace(/[\]\\^-]/g, '\\$&')}]`)) : l.trim().split(/\s+/)));
  c.out(table(rows, [], 2));
});

// ───────────────────────── tr / tee / nl / rev / tac ─────────────────────────

function expandTrSet(s: string): string[] {
  const out: string[] = [];
  const classes: Record<string, string> = {
    '[:lower:]': 'abcdefghijklmnopqrstuvwxyz', '[:upper:]': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '[:digit:]': '0123456789', '[:alpha:]': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '[:alnum:]': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    '[:space:]': ' \t\n\r\f\v', '[:blank:]': ' \t', '[:punct:]': '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
    '[:xdigit:]': '0123456789abcdefABCDEF',
  };
  for (let i = 0; i < s.length; i++) {
    const rest = s.slice(i);
    const cls = Object.keys(classes).find((k) => rest.startsWith(k));
    if (cls) {
      out.push(...classes[cls]);
      i += cls.length - 1;
      continue;
    }
    let ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const n = s[++i];
      ch = n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n === '\\' ? '\\' : /[0-7]/.test(n) ? String.fromCharCode(parseInt(s.slice(i, i + 3).match(/^[0-7]+/)![0], 8)) : n;
      if (/[0-7]/.test(n)) i += (s.slice(i, i + 3).match(/^[0-7]+/)![0].length - 1);
    }
    if (s[i + 1] === '-' && i + 2 < s.length) {
      let end = s[i + 2];
      if (end === '\\') end = s[i + 3];
      const a = ch.charCodeAt(0);
      const b = end.charCodeAt(0);
      if (b >= a) {
        for (let k = a; k <= b; k++) out.push(String.fromCharCode(k));
        i += end === s[i + 2] ? 2 : 3;
        continue;
      }
    }
    out.push(ch);
  }
  return out;
}

defineCommand('tr', {
  summary: 'Traduce, comprime o elimina caracteres',
  usage: 'tr [-cds] CONJUNTO1 [CONJUNTO2]',
  category: 'texto',
  level: 2,
  options: [['-d', 'Elimina los caracteres del conjunto'], ['-s', 'Comprime repeticiones en una sola'], ['-c', 'Usa el complemento del conjunto 1']],
  examples: [["tr a-z A-Z", 'Convierte a mayúsculas'], ["tr -d '\\r'", 'Quita retornos de carro de Windows'], ["tr -s ' '", 'Colapsa espacios repetidos'], ['tr "[:lower:]" "[:upper:]"', 'Con clases POSIX']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'cdsC', long: { '--delete': 'd', '--squeeze-repeats': 's', '--complement': 'c' } });
  if (!o.rest.length) return c.fail("missing operand\nTry 'tr --help' for more information.");
  let set1 = expandTrSet(o.rest[0]);
  const set2 = o.rest[1] !== undefined ? expandTrSet(o.rest[1]) : [];
  if (!o.has('d') && !o.has('s') && !o.rest[1]) return c.fail(`missing operand after ‘${o.rest[0]}’\nTwo strings must be given when translating.`);
  const text = await c.stdin.readAll();
  const comp = o.has('c') || o.has('C');
  const inSet1 = (ch: string) => set1.includes(ch) !== comp;
  let out = '';
  if (o.has('d')) {
    for (const ch of text) if (!inSet1(ch)) out += ch;
    if (o.has('s') && set2.length) out = out.replace(new RegExp(`([${set2.map(escSet).join('')}])\\1+`, 'g'), '$1');
  } else if (set2.length) {
    if (comp) {
      const last = set2[set2.length - 1];
      for (const ch of text) out += set1.includes(ch) ? ch : last;
    } else {
      for (const ch of text) {
        const i = set1.indexOf(ch);
        out += i < 0 ? ch : (set2[Math.min(i, set2.length - 1)] ?? ch);
      }
    }
    if (o.has('s')) out = out.replace(new RegExp(`([${set2.map(escSet).join('')}])\\1+`, 'g'), '$1');
  } else if (o.has('s')) {
    const cls = comp ? null : set1.map(escSet).join('');
    out = comp
      ? text.replace(new RegExp(`([^${set1.map(escSet).join('')}])\\1+`, 'g'), '$1')
      : text.replace(new RegExp(`([${cls}])\\1+`, 'g'), '$1');
  } else out = text;
  c.out(out);
});
const escSet = (ch: string) => (/[\]\\^-]/.test(ch) ? '\\' + ch : ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch);

defineCommand('tee', {
  summary: 'Copia la entrada a la salida y a archivos a la vez',
  usage: 'tee [-a] [ARCHIVO]...',
  category: 'texto',
  level: 2,
  options: [['-a', 'Añade al final en vez de sobrescribir']],
  examples: [['ls | tee lista.txt', 'Guarda y muestra'], ['echo "x" | sudo tee /etc/archivo', 'Escribir con sudo en un archivo protegido']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'ai', long: { '--append': 'a' } });
  const text = await c.stdin.readAll();
  c.out(text);
  let st = 0;
  for (const f of o.rest) {
    try {
      if (f === '/dev/null') continue;
      c.fs.writeFile(c.abs(f), text, { append: o.has('a'), cred: c.cred });
    } catch (e) {
      c.err(`tee: ${f}: ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('nl', { summary: 'Numera las líneas de un archivo', usage: 'nl [ARCHIVO]', category: 'texto', level: 2, examples: [['nl script.sh', 'Líneas numeradas (las vacías no se numeran)']] }, async (c) => {
  const o = parseOpts(c, c.args, { flags: '', values: 'bwnsv' });
  const { inputs } = await readInputs(c, o.rest);
  let n = 1;
  for (const inp of inputs)
    for (const l of splitLines(inp.text)) {
      if (l === '' && o.val('b') !== 'a') c.out('       ' + '\n');
      else c.out(`${String(n++).padStart(6)}\t${l}\n`);
    }
});
defineCommand('rev', { summary: 'Invierte cada línea', usage: 'rev [ARCHIVO]', category: 'texto', level: 3, examples: [['echo hola | rev', 'aloh']] }, async (c) => {
  const { inputs } = await readInputs(c, c.args);
  for (const inp of inputs) for (const l of splitLines(inp.text)) c.out([...l].reverse().join('') + '\n');
});
defineCommand('tac', { summary: 'Muestra un archivo con las líneas en orden inverso', usage: 'tac [ARCHIVO]', category: 'texto', level: 3, examples: [['tac log.txt | head', 'Las últimas líneas primero']] }, async (c) => {
  const { inputs } = await readInputs(c, c.args);
  for (const inp of inputs) c.out(joinLines(splitLines(inp.text).reverse()));
});

defineCommand('fold', { summary: 'Parte las líneas largas a un ancho dado', usage: 'fold [-w N] [-s]', category: 'texto', level: 3 }, async (c) => {
  const o = parseOpts(c, c.args, { flags: 's', values: 'w' });
  const w = o.val('w') ? parseInt(o.val('w')!, 10) : 80;
  const { inputs } = await readInputs(c, o.rest);
  for (const inp of inputs)
    for (const l of splitLines(inp.text)) {
      let rest = l;
      if (rest === '') c.out('\n');
      while (rest.length > 0) {
        let cut = Math.min(w, rest.length);
        if (o.has('s') && rest.length > w) {
          const sp = rest.lastIndexOf(' ', w - 1);
          if (sp > 0) cut = sp + 1;
        }
        c.out(rest.slice(0, cut) + '\n');
        rest = rest.slice(cut);
      }
    }
});

// ───────────────────────── comm / diff / cmp ─────────────────────────

defineCommand('comm', {
  summary: 'Compara dos archivos ordenados línea a línea',
  usage: 'comm [-123] ARCHIVO1 ARCHIVO2',
  category: 'texto',
  level: 3,
  options: [['-1', 'Oculta líneas solo en el archivo 1'], ['-2', 'Oculta líneas solo en el archivo 2'], ['-3', 'Oculta líneas comunes']],
  examples: [['comm -12 a.txt b.txt', 'Solo las líneas comunes']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: '123' });
  if (o.rest.length !== 2) return c.fail("missing operand\nTry 'comm --help' for more information.");
  const { inputs, failed } = await readInputs(c, o.rest);
  if (failed) return 1;
  const a = splitLines(inputs[0].text);
  const b = splitLines(inputs[1].text);
  let i = 0, j = 0;
  const tab = (n: number) => '\t'.repeat(n);
  const c2 = o.has('1') ? 0 : 1;
  const c3 = c2 + (o.has('2') ? 0 : 1);
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i] < b[j])) {
      if (!o.has('1')) c.out(a[i] + '\n');
      i++;
    } else if (i >= a.length || b[j] < a[i]) {
      if (!o.has('2')) c.out(tab(c2) + b[j] + '\n');
      j++;
    } else {
      if (!o.has('3')) c.out(tab(c3) + a[i] + '\n');
      i++; j++;
    }
  }
});

function lcsDiff(a: string[], b: string[]): { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { op: ' ' | '-' | '+'; line: string; ai: number; bi: number }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: ' ', line: a[i], ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: '-', line: a[i], ai: i, bi: j }); i++; }
    else { out.push({ op: '+', line: b[j], ai: i, bi: j }); j++; }
  }
  while (i < n) out.push({ op: '-', line: a[i], ai: i++, bi: j });
  while (j < m) out.push({ op: '+', line: b[j], ai: i, bi: j++ });
  return out;
}

async function diffFiles(c: Ctx, f1: string, f2: string, mode: 'normal' | 'unified' | 'context' | 'brief' | 'sidebyside', ctxLines: number, ignoreCase: boolean, ignoreSpace: boolean): Promise<number> {
  let t1: string, t2: string;
  try {
    t1 = f1 === '-' ? await c.stdin.readAll() : c.fs.readFile(c.abs(f1), c.cred);
  } catch (e) {
    c.err(`diff: ${f1}: ${(e as Error).message}\n`);
    return 2;
  }
  try {
    t2 = f2 === '-' ? await c.stdin.readAll() : c.fs.readFile(c.abs(f2), c.cred);
  } catch (e) {
    c.err(`diff: ${f2}: ${(e as Error).message}\n`);
    return 2;
  }
  const norm = (s: string) => (ignoreCase ? s.toLowerCase() : s).replace(ignoreSpace ? /\s+/g : /$^/, ignoreSpace ? ' ' : '');
  const a = splitLines(t1);
  const b = splitLines(t2);
  const ops = lcsDiff(a.map(norm), b.map(norm)).map((o) => ({ ...o, line: o.op === '+' ? b[o.bi] : a[o.ai] }));
  if (!ops.some((o) => o.op !== ' ')) return 0;
  if (mode === 'brief') {
    c.out(`Files ${f1} and ${f2} differ\n`);
    return 1;
  }
  if (mode === 'sidebyside') {
    for (const o of ops) {
      if (o.op === ' ') c.out(`${o.line.padEnd(30)}  ${o.line}\n`);
      else if (o.op === '-') c.out(`${o.line.padEnd(30)} <\n`);
      else c.out(`${''.padEnd(30)} > ${o.line}\n`);
    }
    return 1;
  }
  if (mode === 'unified') {
    const st = (f: string) => {
      const n = c.fs.stat(c.abs(f), c.cred);
      const d = new Date(n?.mtime ?? 0);
      const p = (x: number) => String(x).padStart(2, '0');
      return `${f}\t${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.000000000 +0000`;
    };
    c.out(`--- ${st(f1)}\n+++ ${st(f2)}\n`);
    // agrupar en hunks
    const changeIdx = ops.map((o, i) => (o.op !== ' ' ? i : -1)).filter((i) => i >= 0);
    let k = 0;
    while (k < changeIdx.length) {
      let start = Math.max(0, changeIdx[k] - ctxLines);
      let end = Math.min(ops.length - 1, changeIdx[k] + ctxLines);
      let kk = k + 1;
      while (kk < changeIdx.length && changeIdx[kk] - ctxLines <= end + 1) {
        end = Math.min(ops.length - 1, changeIdx[kk] + ctxLines);
        kk++;
      }
      const slice = ops.slice(start, end + 1);
      let aStart = slice.find((o) => o.op !== '+')?.ai ?? ops[start].ai;
      let bStart = slice.find((o) => o.op !== '-')?.bi ?? ops[start].bi;
      const aCount = slice.filter((o) => o.op !== '+').length;
      const bCount = slice.filter((o) => o.op !== '-').length;
      const rng = (s: number, n: number) => (n === 1 ? `${s + 1}` : `${n === 0 ? s : s + 1},${n}`);
      c.out(`@@ -${rng(aStart, aCount)} +${rng(bStart, bCount)} @@\n`);
      for (const o of slice) c.out(`${o.op}${o.line}\n`);
      k = kk;
    }
    return 1;
  }
  // formato normal
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === ' ') { i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].op !== ' ') j++;
    const del = ops.slice(i, j).filter((o) => o.op === '-');
    const add = ops.slice(i, j).filter((o) => o.op === '+');
    const a1 = del.length ? del[0].ai + 1 : ops[i].ai;
    const a2 = del.length ? del[del.length - 1].ai + 1 : ops[i].ai;
    const b1 = add.length ? add[0].bi + 1 : ops[i].bi;
    const b2 = add.length ? add[add.length - 1].bi + 1 : ops[i].bi;
    const r = (x: number, y: number) => (x === y ? `${x}` : `${x},${y}`);
    const kind = del.length && add.length ? 'c' : del.length ? 'd' : 'a';
    c.out(`${r(a1, a2)}${kind}${r(b1, b2)}\n`);
    for (const o of del) c.out(`< ${o.line}\n`);
    if (del.length && add.length) c.out('---\n');
    for (const o of add) c.out(`> ${o.line}\n`);
    i = j;
  }
  return 1;
}

defineCommand('diff', {
  summary: 'Compara dos archivos línea a línea',
  usage: 'diff [OPCIÓN]... ARCHIVO1 ARCHIVO2',
  category: 'texto',
  level: 2,
  options: [['-u', 'Formato unificado (el que usa git)'], ['-q', 'Solo indica si difieren'], ['-i', 'Ignora mayúsculas'], ['-w', 'Ignora espacios'], ['-y', 'Dos columnas lado a lado'], ['-r', 'Compara directorios recursivamente']],
  examples: [['diff a.txt b.txt', 'Diferencias en formato normal'], ['diff -u viejo.conf nuevo.conf', 'Formato unificado']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'uqiwyrcBsN', values: 'U', long: { '--unified': 'u', '--brief': 'q', '--ignore-case': 'i', '--recursive': 'r', '--side-by-side': 'y' } });
  if (o.rest.length < 2) return c.fail(`missing operand after '${o.rest[0] ?? 'diff'}'\ndiff: Try 'diff --help' for more information.`);
  const [f1, f2] = o.rest;
  const mode = o.has('q') ? 'brief' : o.has('y') ? 'sidebyside' : o.has('u') || o.val('U') ? 'unified' : 'normal';
  const n1 = c.fs.stat(c.abs(f1), c.cred);
  const n2 = c.fs.stat(c.abs(f2), c.cred);
  if (n1?.kind === 'dir' && n2?.kind === 'dir') {
    if (!o.has('r') && mode !== 'brief') {
      // lista de diferencias a nivel superior
    }
    const names = new Set([...c.fs.readdir(c.abs(f1), c.cred), ...c.fs.readdir(c.abs(f2), c.cred)]);
    let st = 0;
    for (const n of [...names].sort()) {
      const p1 = c.abs(f1) + '/' + n;
      const p2 = c.abs(f2) + '/' + n;
      const e1 = c.fs.stat(p1, c.cred);
      const e2 = c.fs.stat(p2, c.cred);
      if (!e1) { c.out(`Only in ${f2}: ${n}\n`); st = 1; }
      else if (!e2) { c.out(`Only in ${f1}: ${n}\n`); st = 1; }
      else if (e1.kind === 'file' && e2.kind === 'file') {
        if (e1.content !== e2.content) {
          if (mode !== 'brief') c.out(`diff ${o.has('u') ? '-u ' : ''}${f1}/${n} ${f2}/${n}\n`);
          st = Math.max(st, await diffFiles(c, `${f1}/${n}`, `${f2}/${n}`, mode, o.val('U') ? parseInt(o.val('U')!, 10) : 3, o.has('i'), o.has('w')));
        }
      } else if (e1.kind === 'dir' && e2.kind === 'dir' && o.has('r')) {
        st = Math.max(st, await c.sh.runArgv(['diff', ...c.args.filter((a) => a !== f1 && a !== f2), `${f1}/${n}`, `${f2}/${n}`], c.io));
      }
    }
    return st;
  }
  return diffFiles(c, f1, f2, mode, o.val('U') ? parseInt(o.val('U')!, 10) : 3, o.has('i'), o.has('w'));
});

defineCommand('cmp', { summary: 'Compara dos archivos byte a byte', usage: 'cmp ARCHIVO1 ARCHIVO2', category: 'texto', level: 3 }, (c) => {
  const o = parseOpts(c, c.args, { flags: 'sl' });
  if (o.rest.length < 2) return c.fail('missing operand');
  let a: string, b: string;
  try {
    a = c.fs.readFile(c.abs(o.rest[0]), c.cred);
    b = c.fs.readFile(c.abs(o.rest[1]), c.cred);
  } catch (e) {
    c.err(`cmp: ${(e as Error).message}\n`);
    return 2;
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (!o.has('s')) c.out(`${o.rest[0]} ${o.rest[1]} differ: byte ${i + 1}, line ${a.slice(0, i).split('\n').length}\n`);
      return 1;
    }
  }
  if (a.length !== b.length) {
    if (!o.has('s')) c.err(`cmp: EOF on ${a.length < b.length ? o.rest[0] : o.rest[1]} after byte ${Math.min(a.length, b.length)}\n`);
    return 1;
  }
  return 0;
});

// ───────────────────────── seq / shuf / yes / xargs ─────────────────────────

defineCommand('seq', {
  summary: 'Imprime una secuencia de números',
  usage: 'seq [OPCIÓN]... [PRIMERO [INCREMENTO]] ÚLTIMO',
  category: 'scripting',
  level: 2,
  options: [['-s SEP', 'Separador (por defecto salto de línea)'], ['-w', 'Rellena con ceros al mismo ancho']],
  examples: [['seq 5', '1 2 3 4 5'], ['seq 2 2 10', '2 4 6 8 10'], ['seq -s, 1 5', '1,2,3,4,5']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'w', values: 'sf', lenient: true, long: { '--separator': 's', '--equal-width': 'w' } });
  const nums = o.rest.map(Number);
  if (!o.rest.length || nums.some(Number.isNaN)) return c.fail(`invalid floating point argument: '${o.rest.find((x) => Number.isNaN(Number(x))) ?? ''}'\nTry 'seq --help' for more information.`);
  const [first, inc, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
  if (inc === 0) return c.fail("invalid Zero increment value: '0'");
  const out: string[] = [];
  const dec = Math.max(...o.rest.map((x) => (x.split('.')[1] ?? '').length));
  for (let v = first; inc > 0 ? v <= last + 1e-9 : v >= last - 1e-9; v += inc) {
    out.push(dec ? v.toFixed(dec) : String(v));
    if (out.length > 100000) break;
  }
  const w = Math.max(...out.map((x) => x.length));
  const list = o.has('w') ? out.map((x) => x.padStart(w, '0')) : out;
  c.out(list.join(o.val('s') ?? '\n') + (list.length ? '\n' : ''));
});

defineCommand('shuf', {
  summary: 'Mezcla líneas al azar',
  usage: 'shuf [-n N] [-e ELEM...] [-i LO-HI] [ARCHIVO]',
  category: 'texto',
  level: 3,
  options: [['-n N', 'Muestra solo N líneas'], ['-e', 'Trata los argumentos como líneas'], ['-i LO-HI', 'Rango de números']],
  examples: [['shuf -n 1 frases.txt', 'Una línea aleatoria'], ['shuf -i 1-10', 'Los números 1 a 10 mezclados']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'e', values: 'ni' });
  let lines: string[];
  if (o.val('i')) {
    const [a, b] = o.val('i')!.split('-').map(Number);
    lines = Array.from({ length: b - a + 1 }, (_x, i) => String(a + i));
  } else if (o.has('e')) lines = o.rest;
  else lines = (await readInputs(c, o.rest)).inputs.flatMap((i) => splitLines(i.text));
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(c.sh.rt.random() * (i + 1));
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  if (o.val('n')) lines = lines.slice(0, parseInt(o.val('n')!, 10));
  c.out(joinLines(lines));
});

defineCommand('yes', { summary: 'Repite un texto sin parar (Ctrl+C para detener)', usage: 'yes [TEXTO]', category: 'scripting', level: 3, examples: [['yes | head -3', 'Tres líneas con "y"'], ['yes sí | rm -i *', 'Responde "sí" a todo']] }, async (c) => {
  const text = (c.args.length ? c.args.join(' ') : 'y') + '\n';
  if (c.io.tty && !c.sh.bg) {
    for (;;) {
      c.out(text.repeat(20));
      await c.sh.sleep(50);
    }
  }
  c.out(text.repeat(c.sh.bg ? 3 : 2000));
});

function parseXargsInput(text: string, nul: boolean, delim?: string): string[] {
  if (nul) return text.split('\0').filter((x) => x !== '');
  if (delim) return text.split(delim).filter((x) => x !== '');
  const items: string[] = [];
  let cur = '';
  let has = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === '\\' && i + 1 < text.length) {
      cur += text[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) items.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (cur || has) items.push(cur);
  return items;
}

defineCommand('xargs', {
  summary: 'Construye y ejecuta comandos a partir de la entrada estándar',
  usage: 'xargs [OPCIÓN]... [COMANDO [ARGS]...]',
  category: 'texto',
  level: 3,
  noHelp: true,
  options: [['-n N', 'Máximo N argumentos por ejecución'], ['-I {}', 'Sustituye {} por cada elemento (uno por ejecución)'], ['-0', 'Elementos separados por NUL (con find -print0)'], ['-t', 'Imprime cada comando antes de ejecutarlo'], ['-r', 'No ejecuta si no hay entrada'], ['-P N', 'Ejecuciones en paralelo (ignorado)']],
  examples: [['find . -name "*.tmp" | xargs rm', 'Borra lo que encuentra find'], ['ls *.txt | xargs -I{} cp {} /tmp/', 'Un comando por archivo'], ['echo a b c | xargs -n1', 'Uno por ejecución']],
}, async (c) => {
  if (c.args[0] === '--help') {
    c.out('Uso: xargs [OPCIÓN]... [COMANDO [ARGS]...]\nConstruye y ejecuta comandos a partir de la entrada estándar.\n');
    return 0;
  }
  const o = parseOpts(c, c.args, { flags: '0trpxo', values: 'nILPdsEaiJ', stopAtOperand: true, long: { '--null': '0', '--max-args': 'n', '--replace': 'I', '--verbose': 't', '--no-run-if-empty': 'r', '--delimiter': 'd', '--max-procs': 'P' } });
  const cmd = o.rest.length ? o.rest : ['echo'];
  const text = o.val('a') ? c.fs.readFile(c.abs(o.val('a')!), c.cred) : await c.stdin.readAll();
  let items = parseXargsInput(text, o.has('0'), o.val('d'));
  const repl = o.val('I') ?? o.val('i');
  if (items.length === 0 && o.has('r')) return 0;
  const runs: string[][] = [];
  if (repl !== undefined) {
    const lines = o.has('0') ? items : splitLines(text).map((l) => l.replace(/^\s+/, ''));
    for (const l of lines) runs.push(cmd.map((a) => a.split(repl || '{}').join(l)));
  } else {
    const n = o.val('n') ? parseInt(o.val('n')!, 10) : o.val('L') ? parseInt(o.val('L')!, 10) : Infinity;
    if (items.length === 0) runs.push(cmd);
    for (let i = 0; i < items.length; i += n) runs.push([...cmd, ...items.slice(i, i + n)]);
  }
  let st = 0;
  for (const argv of runs) {
    if (o.has('t')) c.err(argv.join(' ') + '\n');
    const r = await c.sh.runArgv(argv, { ...c.io, stdin: new BufferStdin('') });
    if (r === 127) return 127;
    if (r !== 0) st = 123;
  }
  return st;
});

// ───────────────────────── volcados / codificación ─────────────────────────

function hexdumpLines(text: string, mode: 'xxd' | 'C'): string {
  const bytes = [...text].map((ch) => ch.charCodeAt(0) & 255);
  const out: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const ascii = chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    if (mode === 'xxd') {
      let hx = '';
      for (let i = 0; i < 16; i += 2) {
        const a = chunk[i] !== undefined ? chunk[i].toString(16).padStart(2, '0') : '';
        const b = chunk[i + 1] !== undefined ? chunk[i + 1].toString(16).padStart(2, '0') : '';
        hx += (a + b).padEnd(4) + ' ';
      }
      out.push(`${off.toString(16).padStart(8, '0')}: ${hx} ${ascii}`);
    } else {
      const hx = chunk.map((b) => b.toString(16).padStart(2, '0'));
      const left = hx.slice(0, 8).join(' ').padEnd(23);
      const right = hx.slice(8).join(' ').padEnd(23);
      out.push(`${off.toString(16).padStart(8, '0')}  ${left}  ${right}  |${ascii}|`);
    }
  }
  if (mode === 'C') out.push(bytes.length.toString(16).padStart(8, '0'));
  return out.join('\n') + (out.length ? '\n' : '');
}

defineCommand(['xxd', 'hexdump'], {
  summary: 'Muestra el contenido de un archivo en hexadecimal',
  usage: 'xxd [ARCHIVO]  |  hexdump -C [ARCHIVO]',
  category: 'texto',
  level: 3,
  examples: [['echo Hola | xxd', 'Bytes en hexadecimal'], ['hexdump -C archivo', 'Volcado canónico']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'Cpr', lenient: true });
  const { inputs } = await readInputs(c, o.rest);
  for (const inp of inputs) c.out(hexdumpLines(inp.text, c.name === 'hexdump' ? 'C' : 'xxd'));
});

defineCommand('od', {
  summary: 'Vuelca un archivo en octal, hexadecimal o caracteres',
  usage: 'od [-A base] [-t tipo] [-c] [ARCHIVO]',
  category: 'texto',
  level: 4,
  examples: [['echo Hola | od -c', 'Cada carácter, incluyendo el \\n']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'cxbdo', values: 'AtNj' });
  const { inputs } = await readInputs(c, o.rest);
  const text = inputs.map((i) => i.text).join('');
  const bytes = [...text].map((ch) => ch.charCodeAt(0) & 255);
  const showChars = o.has('c') || o.val('t') === 'c';
  const noAddr = o.val('A') === 'n';
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    let line = '';
    if (showChars) {
      line = chunk.map((b) => {
        const ch = b === 10 ? '\\n' : b === 9 ? '\\t' : b === 0 ? '\\0' : b === 13 ? '\\r' : b >= 32 && b < 127 ? String.fromCharCode(b) : b.toString(8).padStart(3, '0');
        return ch.padStart(4);
      }).join('');
    } else if (o.val('t')?.startsWith('x1') || o.has('x') && false) {
      line = chunk.map((b) => ' ' + b.toString(16).padStart(2, '0')).join('');
    } else {
      line = chunk.map((b) => ' ' + b.toString(8).padStart(3, '0')).join('');
    }
    c.out((noAddr ? '' : off.toString(8).padStart(7, '0')) + line + '\n');
  }
  if (!noAddr) c.out(bytes.length.toString(8).padStart(7, '0') + '\n');
});

defineCommand('base64', {
  summary: 'Codifica o decodifica en base64',
  usage: 'base64 [-d] [ARCHIVO]',
  category: 'texto',
  level: 3,
  options: [['-d', 'Decodifica'], ['-w N', 'Ancho de línea (0 = sin saltos)']],
  examples: [['echo hola | base64', 'aG9sYQo='], ['echo aG9sYQo= | base64 -d', 'hola']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'di', values: 'w', long: { '--decode': 'd', '--wrap': 'w' } });
  const { inputs } = await readInputs(c, o.rest);
  const text = inputs.map((i) => i.text).join('');
  if (o.has('d')) {
    const d = b64decode(text);
    if (d === null) return c.fail('invalid input');
    c.out(d);
    return 0;
  }
  const enc = b64encode(text);
  const w = o.val('w') !== undefined ? parseInt(o.val('w')!, 10) : 76;
  c.out(w > 0 ? (enc.match(new RegExp(`.{1,${w}}`, 'g')) ?? []).join('\n') + (enc ? '\n' : '') : enc + (enc ? '\n' : ''));
});

for (const [cmd, fn] of [['md5sum', md5], ['sha1sum', sha1], ['sha256sum', sha256]] as [string, (s: string) => string][]) {
  defineCommand(cmd, {
    summary: `Calcula y verifica sumas de comprobación ${cmd.replace('sum', '').toUpperCase()}`,
    usage: `${cmd} [-c] [ARCHIVO]...`,
    category: 'texto',
    level: 3,
    options: [['-c', 'Verifica sumas guardadas en un archivo']],
    examples: [[`${cmd} descarga.iso`, 'Huella del archivo'], [`${cmd} -c sumas.txt`, 'Comprueba integridad']],
  }, async (c) => {
    const o = parseOpts(c, c.args, { flags: 'cbtw', long: { '--check': 'c' } });
    if (o.has('c')) {
      const { inputs } = await readInputs(c, o.rest);
      let bad = 0;
      for (const inp of inputs)
        for (const l of splitLines(inp.text)) {
          const m = /^([0-9a-f]+)\s+\*?(.+)$/.exec(l);
          if (!m) continue;
          let ok = false;
          try {
            ok = fn(c.fs.readFile(c.abs(m[2]), c.cred)) === m[1];
          } catch {
            c.out(`${m[2]}: FAILED open or read\n`);
            bad++;
            continue;
          }
          c.out(`${m[2]}: ${ok ? 'OK' : 'FAILED'}\n`);
          if (!ok) bad++;
        }
      if (bad) c.err(`${cmd}: WARNING: ${bad} computed checksum${bad > 1 ? 's' : ''} did NOT match\n`);
      return bad ? 1 : 0;
    }
    const { inputs, failed } = await readInputs(c, o.rest);
    for (const inp of inputs) c.out(`${fn(inp.text)}  ${inp.name}\n`);
    return failed ? 1 : 0;
  });
}

// ───────────────────────── expr / bc ─────────────────────────

defineCommand('expr', {
  summary: 'Evalúa expresiones aritméticas y de texto',
  usage: 'expr EXPRESIÓN',
  category: 'scripting',
  level: 3,
  examples: [['expr 2 + 3', '5'], ['expr length hola', '4'], ['expr 10 \\* 3', '30 (hay que escapar el *)']],
}, (c) => {
  const a = c.args;
  if (!a.length) return c.fail('missing operand\nTry \'expr --help\' for more information.', 2);
  const num = (s: string) => (/^-?\d+$/.test(s) ? parseInt(s, 10) : NaN);
  let res: string | number;
  if (a[0] === 'length' && a.length === 2) res = a[1].length;
  else if (a[0] === 'substr' && a.length === 4) res = a[1].substr(parseInt(a[2], 10) - 1, parseInt(a[3], 10));
  else if (a[0] === 'index' && a.length === 3) res = [...a[2]].map((ch) => a[1].indexOf(ch) + 1).filter(Boolean).sort((x, y) => x - y)[0] ?? 0;
  else if (a.length === 3 && a[1] === ':') {
    const m = new RegExp('^' + a[2].replace(/\\\(/g, '(').replace(/\\\)/g, ')')).exec(a[0]);
    res = m ? (m[1] !== undefined ? m[1] : m[0].length) : (a[2].includes('\\(') ? '' : 0);
  } else if (a.length === 3) {
    const [x, op, y] = a;
    const nx = num(x), ny = num(y);
    const both = !Number.isNaN(nx) && !Number.isNaN(ny);
    switch (op) {
      case '+': if (!both) return c.fail('non-integer argument', 2); res = nx + ny; break;
      case '-': if (!both) return c.fail('non-integer argument', 2); res = nx - ny; break;
      case '*': if (!both) return c.fail('non-integer argument', 2); res = nx * ny; break;
      case '/': if (!both) return c.fail('non-integer argument', 2); if (ny === 0) return c.fail('division by zero', 2); res = Math.trunc(nx / ny); break;
      case '%': if (!both) return c.fail('non-integer argument', 2); if (ny === 0) return c.fail('division by zero', 2); res = nx % ny; break;
      case '=': res = (both ? nx === ny : x === y) ? 1 : 0; break;
      case '!=': res = (both ? nx !== ny : x !== y) ? 1 : 0; break;
      case '<': res = (both ? nx < ny : x < y) ? 1 : 0; break;
      case '>': res = (both ? nx > ny : x > y) ? 1 : 0; break;
      case '<=': res = (both ? nx <= ny : x <= y) ? 1 : 0; break;
      case '>=': res = (both ? nx >= ny : x >= y) ? 1 : 0; break;
      case '|': res = x && x !== '0' ? x : y; break;
      case '&': res = x && x !== '0' && y && y !== '0' ? x : 0; break;
      default: return c.fail('syntax error: unexpected argument', 2);
    }
  } else if (a.length === 1) res = a[0];
  else return c.fail('syntax error', 2);
  c.out(res + '\n');
  return res === 0 || res === '' ? 1 : 0;
});

defineCommand('bc', {
  summary: 'Calculadora de precisión arbitraria',
  usage: 'bc [-l]',
  category: 'scripting',
  package: 'bc',
  level: 3,
  options: [['-l', 'Carga la librería matemática (scale=20)']],
  examples: [['echo "scale=2; 10/3" | bc', '3.33'], ['echo "2^10" | bc', '1024']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'lqs' });
  const text = o.rest.length ? c.fs.readFile(c.abs(o.rest[0]), c.cred) : await c.stdin.readAll();
  let scale = o.has('l') ? 20 : 0;
  const vars = new Map<string, number>();
  for (const stmt of text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    if (stmt === 'quit') break;
    const m = /^(\w+)\s*=\s*(.+)$/.exec(stmt);
    const ev = (e: string): number => {
      const js = e
        .replace(/\^/g, '**')
        .replace(/\bsqrt\(/g, 'Math.sqrt(')
        .replace(/\bs\(/g, 'Math.sin(').replace(/\bc\(/g, 'Math.cos(').replace(/\bl\(/g, 'Math.log(').replace(/\be\(/g, 'Math.exp(')
        .replace(/[A-Za-z_]\w*/g, (id) => (id.startsWith('Math') || id === 'sin' || id === 'cos' || id === 'log' || id === 'exp' || id === 'sqrt' ? id : vars.has(id) ? String(vars.get(id)) : '0'));
      if (!/^[\d\s+\-*/%().,eEMathsqrtincolgxp*]*$/.test(js)) throw new Error('syntax error');
       
      return Function(`"use strict"; return (${js})`)() as number;
    };
    try {
      if (m && m[1] === 'scale') {
        scale = Math.trunc(ev(m[2]));
      } else if (m) {
        vars.set(m[1], ev(m[2]));
      } else {
        const v = ev(stmt);
        const f = 10 ** scale;
        const t = Math.trunc(v * f) / f;
        let s = scale > 0 ? t.toFixed(scale) : String(Math.trunc(v));
        if (scale > 0) s = s.replace(/^(-?)0\./, '$1.');
        c.out(s + '\n');
      }
    } catch {
      c.err('(standard_in) 1: syntax error\n');
    }
  }
});

export { basename, FsError, SignalEx, humanSize, padStart, formatPrintf };
