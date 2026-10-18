/** Utilidades de rutas POSIX para el sistema de archivos virtual. */

export function normalize(path: string): string {
  const abs = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    } else out.push(part);
  }
  const joined = out.join('/');
  return abs ? '/' + joined : joined || '.';
}

/** Une `p` con `cwd` y normaliza. `~` debe resolverse antes (lo hace el shell). */
export function resolve(cwd: string, p: string): string {
  if (p.startsWith('/')) return normalize(p);
  return normalize(cwd + '/' + p);
}

export function dirname(p: string): string {
  const n = p.replace(/\/+$/, '');
  if (n === '') return '/';
  const i = n.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return n.slice(0, i);
}

export function basename(p: string, suffix?: string): string {
  const n = p.replace(/\/+$/, '');
  if (n === '') return p.startsWith('/') ? '/' : '';
  let b = n.slice(n.lastIndexOf('/') + 1);
  if (suffix && b.endsWith(suffix) && b !== suffix) b = b.slice(0, -suffix.length);
  return b;
}

export function join(...parts: string[]): string {
  return normalize(parts.join('/'));
}

export function split(abs: string): string[] {
  return abs.split('/').filter(Boolean);
}

/** Ruta relativa de `to` respecto a `from` (ambas absolutas). */
export function relative(from: string, to: string): string {
  const a = split(normalize(from));
  const b = split(normalize(to));
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  const rest = b.slice(i);
  const r = [...up, ...rest].join('/');
  return r === '' ? '.' : r;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}
