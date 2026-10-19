/**
 * Cadenas de Python sobre strings de JS: longitud e índices por puntos de código (no por unidades UTF-16).
 */

let lastS = '';
let lastHas = false;

/** ¿la cadena contiene pares sustitutos (caracteres fuera del BMP)? */
export function hasAstral(s: string): boolean {
  const n = s.length;
  if (n < 24) {
    for (let i = 0; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
    return false;
  }
  if (s === lastS) return lastHas;
  let has = false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) { has = true; break; }
  }
  lastS = s;
  lastHas = has;
  return has;
}

let lastCpS = '';
let lastCp: string[] = [];

/** cadena → array de caracteres (puntos de código) */
export function chars(s: string): string[] {
  if (s === lastCpS) return lastCp;
  const a = Array.from(s);
  if (s.length > 64) {
    lastCpS = s;
    lastCp = a;
  }
  return a;
}

export function strLen(s: string): number {
  if (!hasAstral(s)) return s.length;
  return chars(s).length;
}

/** carácter en la posición i (0 ≤ i < len) */
export function strAt(s: string, i: number): string {
  if (!hasAstral(s)) return s[i];
  return chars(s)[i];
}

/** subcadena [a, b) por puntos de código */
export function strSlice(s: string, a: number, b: number): string {
  if (!hasAstral(s)) return s.slice(a, b);
  return chars(s).slice(a, b).join('');
}

/** índice (en unidades UTF-16) → índice (en puntos de código) */
export function cpIndexOf(s: string, utf16Index: number): number {
  if (!hasAstral(s)) return utf16Index;
  let n = 0;
  for (let i = 0; i < utf16Index; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) i++;
    n++;
  }
  return n;
}

/** índice (en puntos de código) → índice UTF-16 */
export function utf16IndexOf(s: string, cpIndex: number): number {
  if (!hasAstral(s)) return cpIndex;
  let n = 0;
  let i = 0;
  while (n < cpIndex && i < s.length) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff ? 2 : 1;
    n++;
  }
  return i;
}

/** comparación de cadenas por puntos de código (como Python) */
export function cmpStr(a: string, b: string): number {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) {
      // los sustitutos (0xD800–0xDFFF) representan puntos > 0xFFFF: ordenan por encima del resto del BMP
      const xs = x >= 0xd800 && x <= 0xdfff;
      const ys = y >= 0xd800 && y <= 0xdfff;
      if (xs !== ys) return xs ? 1 : -1;
      return x < y ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

export function strHash(s: string): number {
  // FNV-1a de 53 bits aproximado (determinista; no coincide con el hash aleatorizado de CPython)
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// ───────────────────────── UTF-8 ─────────────────────────

export function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** Decodifica UTF-8; `onError` devuelve null para lanzar error o una cadena de sustitución */
export function utf8Decode(b: ArrayLike<number>, onError?: (pos: number, byte: number, reason: string) => string | null): string {
  let out = '';
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (c < 0x80) { out += String.fromCharCode(c); i++; continue; }
    let need = 0;
    let cp = 0;
    let min = 0;
    if (c >= 0xc2 && c <= 0xdf) { need = 1; cp = c & 0x1f; min = 0x80; }
    else if (c >= 0xe0 && c <= 0xef) { need = 2; cp = c & 0x0f; min = 0x800; }
    else if (c >= 0xf0 && c <= 0xf4) { need = 3; cp = c & 0x07; min = 0x10000; }
    else {
      const r = onError ? onError(i, c, 'invalid start byte') : null;
      if (r === null) throw new Error(`utf8:${i}:${c}:invalid start byte`);
      out += r; i++;
      continue;
    }
    if (i + need >= n) {
      const r = onError ? onError(i, c, 'unexpected end of data') : null;
      if (r === null) throw new Error(`utf8:${i}:${c}:unexpected end of data`);
      out += r; i = n;
      continue;
    }
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const cc = b[i + k];
      if ((cc & 0xc0) !== 0x80) { ok = false; break; }
      cp = (cp << 6) | (cc & 0x3f);
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      const r = onError ? onError(i, c, ok ? 'invalid continuation byte' : 'invalid continuation byte') : null;
      if (r === null) throw new Error(`utf8:${i}:${c}:invalid continuation byte`);
      out += r; i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
