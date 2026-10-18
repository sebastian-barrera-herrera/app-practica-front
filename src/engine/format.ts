/** Helpers de formato: ANSI, fechas, tamaños, columnas, permisos. */

export const ESC = '\x1b[';
export const RESET = '\x1b[0m';
export const C = {
  dir: '\x1b[1;34m',
  exec: '\x1b[1;32m',
  link: '\x1b[1;36m',
  match: '\x1b[1;31m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  boldGreen: '\x1b[1;32m',
  boldRed: '\x1b[1;31m',
  boldYellow: '\x1b[1;33m',
  boldBlue: '\x1b[1;34m',
  archive: '\x1b[1;31m',
};

export function color(code: string, s: string): string {
  return code + s + RESET;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Fecha estilo `ls -l`: "Mar 14 10:00" o "Mar 14  2025" si es antigua. */
export function lsDate(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const old = nowMs - ms > 182 * 86400000 || ms > nowMs + 3600000;
  const day = String(d.getUTCDate()).padStart(2, ' ');
  if (old) return `${MONTHS[d.getUTCMonth()]} ${day}  ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${day} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Fecha estilo `date`: "Sat Mar 14 10:00:00 UTC 2026". */
export function dateString(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function isoTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function isoFull(ms: number): string {
  return `${isoDate(ms)} ${isoTime(ms)}`;
}

/** Tamaño legible (1K, 2.3M, ...) como `ls -h`. */
export function humanSize(bytes: number, si = false): string {
  const base = si ? 1000 : 1024;
  if (bytes < base) return String(bytes);
  const units = ['K', 'M', 'G', 'T', 'P'];
  let v = bytes / base;
  let i = 0;
  while (v >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  const r = v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v);
  return (v < 10 ? r.toFixed(1) : String(r)) + units[i];
}

/** Permisos como "drwxr-xr-x". */
export function modeString(kind: 'file' | 'dir' | 'symlink', mode: number): string {
  const t = kind === 'dir' ? 'd' : kind === 'symlink' ? 'l' : '-';
  const bit = (m: number, r: number, w: number, x: number, special: number, sc: string) => {
    const xs = (mode & x) !== 0;
    const sp = (mode & special) !== 0;
    return (
      ((mode & r) !== 0 ? 'r' : '-') +
      ((mode & w) !== 0 ? 'w' : '-') +
      (sp ? (xs ? sc : sc.toUpperCase()) : xs ? 'x' : '-')
    );
  };
  return (
    t +
    bit(mode, 0o400, 0o200, 0o100, 0o4000, 's') +
    bit(mode, 0o040, 0o020, 0o010, 0o2000, 's') +
    bit(mode, 0o004, 0o002, 0o001, 0o1000, 't')
  );
}

/** Reparte `items` en columnas (de arriba abajo) para un ancho dado, como `ls`. */
export function columns(items: string[], width: number, sep = 2): string {
  if (items.length === 0) return '';
  const lens = items.map(visibleLength);
  const n = items.length;
  for (let cols = Math.min(n, Math.max(1, Math.floor(width / (1 + sep)))); cols >= 1; cols--) {
    const rows = Math.ceil(n / cols);
    const widths: number[] = [];
    let total = 0;
    for (let c = 0; c < cols; c++) {
      let w = 0;
      for (let r = 0; r < rows; r++) {
        const idx = c * rows + r;
        if (idx < n) w = Math.max(w, lens[idx]);
      }
      widths.push(w);
      total += w + (c < cols - 1 ? sep : 0);
    }
    if (total <= width || cols === 1) {
      const lines: string[] = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          const idx = c * rows + r;
          if (idx >= n) break;
          const last = c === cols - 1 || (c + 1) * rows + r >= n;
          line += last ? items[idx] : items[idx] + ' '.repeat(widths[c] - lens[idx] + sep);
        }
        lines.push(line);
      }
      return lines.join('\n') + '\n';
    }
  }
  return items.join('\n') + '\n';
}

export const padEnd = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - visibleLength(s)));
export const padStart = (s: string, n: number) => ' '.repeat(Math.max(0, n - visibleLength(s))) + s;

/** Tabla alineada. `align` 'l' | 'r' por columna. */
export function table(rows: string[][], align: ('l' | 'r')[] = [], gap = 1): string {
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const w: number[] = Array(cols).fill(0);
  for (const r of rows) r.forEach((c, i) => (w[i] = Math.max(w[i], visibleLength(c))));
  return (
    rows
      .map((r) =>
        r
          .map((c, i) => {
            const last = i === r.length - 1;
            if (align[i] === 'r') return padStart(c, w[i]);
            return last ? c : padEnd(c, w[i]);
          })
          .join(' '.repeat(gap)),
      )
      .join('\n') + '\n'
  );
}

/** Citar una palabra para reconstruir una línea de shell. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./~-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

export function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

/** Hash determinista simple (no criptográfico) para datos falsos reproducibles. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinista (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
