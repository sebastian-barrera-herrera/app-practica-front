/**
 * Códecs nativos (utf-8, utf-16, utf-32, ascii, latin-1, cp1252…) con los manejadores de errores de CPython
 * (strict, ignore, replace, backslashreplace, xmlcharrefreplace, namereplace, surrogateescape, surrogatepass y los registrados con
 * `codecs.register_error`). Las funciones del módulo `_codecs` y `str.encode` / `bytes.decode` se apoyan en este archivo.
 */
import { PyBytes, PyDict, PyTuple } from './objects';
import { bytesType } from './builtin_types';
import { E } from './exc_types';
import { makeExc, typeError } from './errors';
import { callObj } from './call';
import { interp } from './state';
import * as ops from './ops';
import { unicodeByName, unicodeName } from '../unames';

// ───────────────────────── utilidades ─────────────────────────

export function codePoints(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out.push((c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000);
        i++;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

export function fromCodePoints(cps: number[]): string {
  let out = '';
  for (let i = 0; i < cps.length; i += 4096) out += String.fromCodePoint(...cps.slice(i, i + 4096));
  return out;
}

const hex = (n: number, w: number): string => n.toString(16).padStart(w, '0');

/** `\xNN`, `\uNNNN` o `\UNNNNNNNN` */
export function escapeCp(cp: number): string {
  return cp < 0x100 ? '\\x' + hex(cp, 2) : cp < 0x10000 ? '\\u' + hex(cp, 4) : '\\U' + hex(cp, 8);
}

// ───────────────────────── manejadores de errores ─────────────────────────

/** estado de códecs de una sesión: manejadores (codecs.register_error), funciones de búsqueda y caché de lookup */
export interface CodecState {
  handlers: Map<string, any>;
  search: any[];
  cache: Map<string, any>;
}
export function codecState(): CodecState {
  const I = interp();
  let st = I.extraFlags.codecState as CodecState | undefined;
  if (st === undefined) {
    st = { handlers: new Map(), search: [], cache: new Map() };
    I.extraFlags.codecState = st;
  }
  return st;
}

export function bytesObj(b: ArrayLike<number>): PyBytes {
  return new PyBytes(Uint8Array.from(b as any), bytesType);
}

function lookupHandler(name: string): any {
  const h = codecState().handlers.get(name);
  if (h === undefined) throw makeExc(E.LookupError, [`unknown error handler name '${name}'`]);
  return h;
}

export class EncodeCtx {
  constructor(public codec: string, public s: string, public cps: number[], public errors: string) {}
}

/**
 * Resuelve un grupo de caracteres no codificables [start, end). Añade los bytes de sustitución a `out`
 * y devuelve la posición siguiente.
 */
export function encodeError(ctx: EncodeCtx, start: number, end: number, reason: string, out: number[], encodeText: (t: string) => number[]): number {
  const cps = ctx.cps;
  switch (ctx.errors) {
    case 'strict': throw makeExc(E.UnicodeEncodeError, [ctx.codec, ctx.s, start, end, reason]);
    case 'ignore': return end;
    case 'replace':
      for (let i = start; i < end; i++) out.push(63);
      return end;
    case 'backslashreplace':
      for (let i = start; i < end; i++) for (const ch of escapeCp(cps[i])) out.push(ch.charCodeAt(0));
      return end;
    case 'xmlcharrefreplace':
      for (let i = start; i < end; i++) for (const ch of `&#${cps[i]};`) out.push(ch.charCodeAt(0));
      return end;
    case 'namereplace':
      for (let i = start; i < end; i++) {
        const nm = unicodeName(cps[i]);
        for (const ch of nm === null ? escapeCp(cps[i]) : `\\N{${nm}}`) out.push(ch.charCodeAt(0));
      }
      return end;
    case 'surrogateescape': {
      for (let i = start; i < end; i++) {
        const c = cps[i];
        if (c >= 0xdc80 && c <= 0xdcff) out.push(c - 0xdc00);
        else throw makeExc(E.UnicodeEncodeError, [ctx.codec, ctx.s, start, end, reason]);
      }
      return end;
    }
    case 'surrogatepass': {
      for (let i = start; i < end; i++) {
        const c = cps[i];
        if (c < 0xd800 || c > 0xdfff) throw makeExc(E.UnicodeEncodeError, [ctx.codec, ctx.s, start, end, reason]);
        for (const b of encodeText(String.fromCharCode(c))) out.push(b);
      }
      return end;
    }
  }
  const h = lookupHandler(ctx.errors);
  const exc = makeExc(E.UnicodeEncodeError, [ctx.codec, ctx.s, start, end, reason]);
  const r = callObj(h, [exc]);
  if (!(r instanceof PyTuple) || r.a.length !== 2) throw typeError('encoding error handler must return (str/bytes, int) tuple');
  const rep = r.a[0];
  let next = Number(ops.toIndex(r.a[1]));
  if (next < 0) next += cps.length;
  if (next < 0 || next > cps.length) throw makeExc(E.IndexError, [`position ${next} from error handler out of bounds`]);
  if (rep instanceof PyBytes) for (const b of rep.b) out.push(b);
  else if (ops.isStr(rep)) {
    const t = ops.strValue(rep);
    for (const cp of codePoints(t)) {
      if (cp < 128) out.push(cp);
      else {
        // el texto de sustitución debe poder codificarse con el mismo códec
        for (const b of encodeText(String.fromCodePoint(cp))) out.push(b);
      }
    }
  } else throw typeError('encoding error handler must return (str/bytes, int) tuple');
  return next;
}

export class DecodeCtx {
  constructor(public codec: string, public data: ArrayLike<number>, public errors: string) {}
}

/** Resuelve un error de decodificación [start, end); devuelve el texto sustituto y la posición siguiente. */
export function decodeError(ctx: DecodeCtx, start: number, end: number, reason: string): { text: string; next: number } {
  const b = ctx.data;
  switch (ctx.errors) {
    case 'strict': throw makeExc(E.UnicodeDecodeError, [ctx.codec, bytesObj(b), start, end, reason]);
    case 'ignore': return { text: '', next: end };
    case 'replace': return { text: '�', next: end };
    case 'backslashreplace': {
      let t = '';
      for (let i = start; i < end; i++) t += '\\x' + hex(b[i], 2);
      return { text: t, next: end };
    }
    case 'surrogateescape': {
      let t = '';
      for (let i = start; i < end; i++) {
        if (b[i] < 0x80) throw makeExc(E.UnicodeDecodeError, [ctx.codec, bytesObj(b), start, end, reason]);
        t += String.fromCharCode(0xdc00 + b[i]);
      }
      return { text: t, next: end };
    }
  }
  const h = lookupHandler(ctx.errors);
  const exc = makeExc(E.UnicodeDecodeError, [ctx.codec, bytesObj(b), start, end, reason]);
  const r = callObj(h, [exc]);
  if (!(r instanceof PyTuple) || r.a.length !== 2 || !ops.isStr(r.a[0])) throw typeError('decoding error handler must return (str, int) tuple');
  let next = Number(ops.toIndex(r.a[1]));
  if (next < 0) next += b.length;
  if (next < 0 || next > b.length) throw makeExc(E.IndexError, [`position ${next} from error handler out of bounds`]);
  return { text: ops.strValue(r.a[0]), next };
}

// ───────────────────────── UTF-8 ─────────────────────────

export function utf8EncodeBytes(s: string, errors: string, codec = 'utf-8'): number[] {
  const out: number[] = [];
  let ctx: EncodeCtx | null = null;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      // sustituto suelto: no se puede codificar
      if (ctx === null) ctx = new EncodeCtx(codec, s, codePoints(s), errors);
      // índice en puntos de código
      const idx = codePoints(s.slice(0, i)).length;
      let end = idx + 1;
      while (end < ctx.cps.length && ctx.cps[end] >= 0xd800 && ctx.cps[end] <= 0xdfff) end++;
      const next = encodeError(ctx, idx, end, 'surrogates not allowed', out, (t) => (errors === 'surrogatepass' ? [0xe0 | (t.charCodeAt(0) >> 12), 0x80 | ((t.charCodeAt(0) >> 6) & 63), 0x80 | (t.charCodeAt(0) & 63)] : utf8EncodeBytes(t, 'strict', codec)));
      // avanzar la cadena hasta `next`
      let k = idx;
      while (k < next && i < s.length) { k++; i += k <= ctx.cps.length && ctx.cps[k - 1] > 0xffff ? 2 : 1; }
      i--;
      continue;
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/**
 * Decodifica UTF-8 con las mismas reglas de error que CPython. Con `final = false` una secuencia incompleta al final
 * no es un error: se devuelve en `consumed` lo que se pudo procesar.
 */
export function utf8Decode(b: ArrayLike<number>, errors: string, final = true, codec = 'utf-8'): { text: string; consumed: number } {
  const n = b.length;
  const ctx = new DecodeCtx(codec, b, errors);
  const parts: string[] = [];
  let cur = '';
  let i = 0;
  const flush = (): void => { if (cur) { parts.push(cur); cur = ''; } };
  while (i < n) {
    const c = b[i];
    if (c < 0x80) { cur += String.fromCharCode(c); i++; if (cur.length > 8192) flush(); continue; }
    let need: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (c >= 0xc2 && c <= 0xdf) need = 1;
    else if (c >= 0xe0 && c <= 0xef) {
      need = 2;
      if (c === 0xe0) lo = 0xa0;
      else if (c === 0xed) { if (errors === 'surrogatepass') hi = 0xbf; else hi = 0x9f; }
    } else if (c >= 0xf0 && c <= 0xf4) {
      need = 3;
      if (c === 0xf0) lo = 0x90;
      else if (c === 0xf4) hi = 0x8f;
    } else {
      const r = decodeError(ctx, i, i + 1, 'invalid start byte');
      cur += r.text; i = r.next;
      continue;
    }
    // comprobar continuaciones
    let k = 1;
    let bad = false;
    for (; k <= need; k++) {
      if (i + k >= n) break;
      const cc = b[i + k];
      const l = k === 1 ? lo : 0x80;
      const h = k === 1 ? hi : 0xbf;
      if (cc < l || cc > h) { bad = true; break; }
    }
    if (bad) {
      const r = decodeError(ctx, i, i + k, 'invalid continuation byte');
      cur += r.text; i = r.next;
      continue;
    }
    if (k <= need) {
      // faltan bytes al final
      if (!final) { flush(); return { text: parts.join(''), consumed: i }; }
      const r = decodeError(ctx, i, n, 'unexpected end of data');
      cur += r.text; i = r.next;
      continue;
    }
    let cp = need === 1 ? c & 0x1f : need === 2 ? c & 0x0f : c & 0x07;
    for (let q = 1; q <= need; q++) cp = (cp << 6) | (b[i + q] & 0x3f);
    cur += String.fromCodePoint(cp);
    i += need + 1;
  }
  flush();
  return { text: parts.join(''), consumed: n };
}

// ───────────────────────── UTF-16 / UTF-32 ─────────────────────────

export type ByteOrder = 'le' | 'be';

export function utf16Encode(s: string, errors: string, order: ByteOrder, bom: boolean): number[] {
  const out: number[] = [];
  const put = (u: number): void => { if (order === 'le') out.push(u & 255, u >> 8); else out.push(u >> 8, u & 255); };
  if (bom) put(0xfeff);
  const cps = codePoints(s);
  const ctx = new EncodeCtx(order === 'le' && !bom ? 'utf-16-le' : order === 'be' && !bom ? 'utf-16-be' : 'utf-16', s, cps, errors);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp >= 0xd800 && cp <= 0xdfff) {
      let end = i + 1;
      while (end < cps.length && cps[end] >= 0xd800 && cps[end] <= 0xdfff) end++;
      i = encodeError(ctx, i, end, 'surrogates not allowed', out, (t) => utf16Encode(t, 'strict', order, false)) - 1;
      continue;
    }
    if (cp < 0x10000) put(cp);
    else { const v = cp - 0x10000; put(0xd800 + (v >> 10)); put(0xdc00 + (v & 0x3ff)); }
  }
  return out;
}

export function utf16Decode(b: ArrayLike<number>, errors: string, order: ByteOrder | null, final: boolean, codec = 'utf-16'): { text: string; consumed: number; order: ByteOrder } {
  const n = b.length;
  let i = 0;
  let ord: ByteOrder = order ?? 'le';
  if (order === null && n >= 2) {
    if (b[0] === 0xff && b[1] === 0xfe) { ord = 'le'; i = 2; } else if (b[0] === 0xfe && b[1] === 0xff) { ord = 'be'; i = 2; }
  }
  const ctx = new DecodeCtx('utf-16-' + ord, b, errors);
  const get = (p: number): number => (ord === 'le' ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  let out = '';
  while (i < n) {
    if (i + 1 >= n) {
      if (!final) return { text: out, consumed: i, order: ord };
      const r = decodeError(ctx, i, n, 'truncated data');
      out += r.text; i = r.next;
      continue;
    }
    const u = get(i);
    if (u < 0xd800 || u > 0xdfff) { out += String.fromCharCode(u); i += 2; continue; }
    if (u >= 0xdc00) {
      const r = decodeError(ctx, i, i + 2, 'illegal encoding');
      out += r.text; i = r.next;
      continue;
    }
    if (i + 3 >= n) {
      if (!final) return { text: out, consumed: i, order: ord };
      const r = decodeError(ctx, i, n, 'unexpected end of data');
      out += r.text; i = r.next;
      continue;
    }
    const v = get(i + 2);
    if (v >= 0xdc00 && v <= 0xdfff) { out += String.fromCharCode(u, v); i += 4; continue; }
    const r = decodeError(ctx, i, i + 2, 'illegal UTF-16 surrogate');
    out += r.text; i = r.next;
  }
  return { text: out, consumed: n, order: ord };
}

export function utf32Encode(s: string, errors: string, order: ByteOrder, bom: boolean): number[] {
  const out: number[] = [];
  const put = (u: number): void => {
    if (order === 'le') out.push(u & 255, (u >> 8) & 255, (u >> 16) & 255, (u >>> 24) & 255);
    else out.push((u >>> 24) & 255, (u >> 16) & 255, (u >> 8) & 255, u & 255);
  };
  if (bom) put(0xfeff);
  const cps = codePoints(s);
  const ctx = new EncodeCtx(order === 'le' && !bom ? 'utf-32-le' : order === 'be' && !bom ? 'utf-32-be' : 'utf-32', s, cps, errors);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp >= 0xd800 && cp <= 0xdfff) {
      let end = i + 1;
      while (end < cps.length && cps[end] >= 0xd800 && cps[end] <= 0xdfff) end++;
      i = encodeError(ctx, i, end, 'surrogates not allowed', out, (t) => utf32Encode(t, 'strict', order, false)) - 1;
      continue;
    }
    put(cp);
  }
  return out;
}

export function utf32Decode(b: ArrayLike<number>, errors: string, order: ByteOrder | null, final: boolean, codec = 'utf-32'): { text: string; consumed: number; order: ByteOrder } {
  const n = b.length;
  let i = 0;
  let ord: ByteOrder = order ?? 'le';
  if (order === null && n >= 4) {
    if (b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) { ord = 'le'; i = 4; } else if (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) { ord = 'be'; i = 4; }
  }
  const ctx = new DecodeCtx('utf-32-' + ord, b, errors);
  let out = '';
  while (i < n) {
    if (i + 3 >= n) {
      if (!final) return { text: out, consumed: i, order: ord };
      const r = decodeError(ctx, i, n, 'truncated data');
      out += r.text; i = r.next;
      continue;
    }
    const v = ord === 'le' ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (v > 0x10ffff) {
      const r = decodeError(ctx, i, i + 4, 'code point not in range(0x110000)');
      out += r.text; i = r.next;
      continue;
    }
    if (v >= 0xd800 && v <= 0xdfff) {
      const r = decodeError(ctx, i, i + 4, 'code point in surrogate code point range(0xd800, 0xe000)');
      out += r.text; i = r.next;
      continue;
    }
    out += String.fromCodePoint(v);
    i += 4;
  }
  return { text: out, consumed: n, order: ord };
}

// ───────────────────────── codificaciones de un byte ─────────────────────────

/** ASCII y latin-1 */
export function encodeLimit(s: string, errors: string, limit: number, codec: string): number[] {
  const cps = codePoints(s);
  const out: number[] = [];
  const ctx = new EncodeCtx(codec, s, cps, errors);
  const reason = `ordinal not in range(${limit})`;
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp < limit) { out.push(cp); continue; }
    let end = i + 1;
    while (end < cps.length && cps[end] >= limit) end++;
    i = encodeError(ctx, i, end, reason, out, (t) => encodeLimit(t, 'strict', limit, codec)) - 1;
  }
  return out;
}

export function decodeAscii(b: ArrayLike<number>, errors: string): string {
  const ctx = new DecodeCtx('ascii', b, errors);
  let out = '';
  for (let i = 0; i < b.length; i++) {
    if (b[i] < 128) { out += String.fromCharCode(b[i]); continue; }
    let end = i + 1;
    while (end < b.length && b[end] >= 128) end++;
    // CPython informa de un byte cada vez
    const r = decodeError(ctx, i, i + 1, 'ordinal not in range(128)');
    out += r.text;
    i = r.next - 1;
    void end;
  }
  return out;
}

export function decodeLatin1(b: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < b.length; i += 4096) out += String.fromCharCode(...Array.from({ length: Math.min(4096, b.length - i) }, (_, k) => b[i + k]));
  return out;
}

// ───────────────────────── mapas de caracteres (charmap) ─────────────────────────

/** tabla de decodificación (256 caracteres; '￾' = sin definir) → mapa de codificación */
export class EncodingMap {
  m = new Map<number, number>();
  constructor(public table: string) {
    const cps = codePoints(table);
    for (let i = 0; i < cps.length; i++) if (cps[i] !== 0xfffe && !this.m.has(cps[i])) this.m.set(cps[i], i);
  }
}

export function charmapEncode(s: string, errors: string, mapping: any, codec = 'charmap'): number[] {
  const cps = codePoints(s);
  const out: number[] = [];
  const ctx = new EncodeCtx(codec, s, cps, errors);
  const look = (cp: number): number[] | null => {
    if (mapping === null) return cp < 256 ? [cp] : null;
    if (mapping instanceof EncodingMap) {
      const v = mapping.m.get(cp);
      return v === undefined ? null : [v];
    }
    let v: any;
    try {
      v = ops.getitem(mapping, cp);
    } catch (e) {
      if (e instanceof Error) throw e;
      const exc = (e as any);
      if (exc && exc.cls && (exc.cls.isSubtype(E.LookupError))) return null;
      throw e;
    }
    if (v === null) return null;
    if (typeof v === 'number') {
      if (v < 0 || v > 255) throw typeError('character mapping must be in range(256)');
      return [v];
    }
    if (v instanceof PyBytes) return Array.from(v.b);
    throw typeError('character mapping must return integer, bytes or None, not ' + ops.typeNameOf(v));
  };
  for (let i = 0; i < cps.length; i++) {
    const r = look(cps[i]);
    if (r !== null) { for (const b of r) out.push(b); continue; }
    let end = i + 1;
    while (end < cps.length && look(cps[end]) === null) end++;
    i = encodeError(ctx, i, end, 'character maps to <undefined>', out, (t) => charmapEncode(t, 'strict', mapping, codec)) - 1;
  }
  return out;
}

export function charmapDecode(b: ArrayLike<number>, errors: string, mapping: any, codec = 'charmap'): string {
  const ctx = new DecodeCtx(codec, b, errors);
  let out = '';
  let table: number[] | null = null;
  if (typeof mapping === 'string') table = codePoints(mapping);
  for (let i = 0; i < b.length; i++) {
    let ch: string | null = null;
    if (mapping === null) ch = String.fromCharCode(b[i]);
    else if (table !== null) {
      const cp = table[b[i]];
      if (cp !== undefined && cp !== 0xfffe) ch = String.fromCodePoint(cp);
    } else {
      let v: any;
      try {
        v = ops.getitem(mapping, b[i]);
      } catch (e) {
        if (e instanceof Error) throw e;
        const exc = (e as any);
        if (exc && exc.cls && exc.cls.isSubtype(E.LookupError)) v = null;
        else throw e;
      }
      if (v === null) ch = null;
      else if (typeof v === 'number') {
        if (v < 0 || v > 0x10ffff) throw typeError('character mapping must be in range(0x110000)');
        ch = String.fromCodePoint(v);
      } else if (ops.isStr(v)) {
        const t = ops.strValue(v);
        ch = t === '￾' ? null : t;
      } else throw typeError('character mapping must return integer, None or str');
    }
    if (ch !== null) { out += ch; continue; }
    const r = decodeError(ctx, i, i + 1, 'character maps to <undefined>');
    out += r.text;
    i = r.next - 1;
  }
  return out;
}

// cp1252 (Windows-1252): 0x80–0x9f
const CP1252_HI = [
  0x20ac, 0xfffe, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffe, 0x017d, 0xfffe,
  0xfffe, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffe, 0x017e, 0x0178,
];
const LATIN9_DIFF: Record<number, number> = { 0xa4: 0x20ac, 0xa6: 0x0160, 0xa8: 0x0161, 0xb4: 0x017d, 0xb8: 0x017e, 0xbc: 0x0152, 0xbd: 0x0153, 0xbe: 0x0178 };

export function singleByteTable(name: 'cp1252' | 'iso8859-15'): string {
  const cps: number[] = [];
  for (let i = 0; i < 256; i++) {
    if (name === 'cp1252') cps.push(i >= 0x80 && i < 0xa0 ? CP1252_HI[i - 0x80] : i);
    else cps.push(LATIN9_DIFF[i] ?? i);
  }
  return fromCodePoints(cps);
}

// ───────────────────────── unicode-escape ─────────────────────────

export function unicodeEscapeEncode(s: string, raw: boolean): number[] {
  const out: number[] = [];
  const put = (t: string): void => { for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i)); };
  for (const cp of codePoints(s)) {
    if (raw) {
      if (cp < 256) out.push(cp);
      else put(cp < 0x10000 ? '\\u' + hex(cp, 4) : '\\U' + hex(cp, 8));
      continue;
    }
    if (cp === 0x5c) put('\\\\');
    else if (cp === 9) put('\\t');
    else if (cp === 10) put('\\n');
    else if (cp === 13) put('\\r');
    else if (cp >= 0x20 && cp < 0x7f) out.push(cp);
    else put(escapeCp(cp));
  }
  return out;
}

export function unicodeEscapeDecode(b: ArrayLike<number>, errors: string, raw: boolean): string {
  const ctx = new DecodeCtx(raw ? 'rawunicodeescape' : 'unicodeescape', b, errors);
  let out = '';
  const n = b.length;
  const isHex = (c: number): boolean => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
  for (let i = 0; i < n; ) {
    const c = b[i];
    if (c !== 0x5c) { out += String.fromCharCode(c); i++; continue; }
    // barra invertida
    if (i + 1 >= n) {
      const r = decodeError(ctx, i, n, '\\ at end of string');
      out += r.text; i = r.next;
      continue;
    }
    const e = b[i + 1];
    if (raw && e !== 0x75 && e !== 0x55) { out += '\\'; i++; continue; }
    const simple: Record<number, string> = { 0x5c: '\\', 0x27: "'", 0x22: '"', 0x61: '\x07', 0x62: '\b', 0x66: '\f', 0x6e: '\n', 0x72: '\r', 0x74: '\t', 0x76: '\v' };
    if (!raw && simple[e] !== undefined) { out += simple[e]; i += 2; continue; }
    if (!raw && e === 10) { i += 2; continue; }
    if (!raw && e >= 48 && e <= 55) {
      let v = e - 48;
      let k = i + 2;
      for (let q = 0; q < 2 && k < n && b[k] >= 48 && b[k] <= 55; q++, k++) v = v * 8 + (b[k] - 48);
      out += String.fromCharCode(v);
      i = k;
      continue;
    }
    const digits = e === 0x78 ? 2 : e === 0x75 ? 4 : e === 0x55 ? 8 : 0;
    if (digits > 0) {
      let v = 0;
      let k = i + 2;
      let q = 0;
      for (; q < digits && k < n && isHex(b[k]); q++, k++) v = v * 16 + parseInt(String.fromCharCode(b[k]), 16);
      if (q < digits) {
        const msg = e === 0x78 ? 'truncated \\xXX escape' : e === 0x75 ? 'truncated \\uXXXX escape' : 'truncated \\UXXXXXXXX escape';
        const r = decodeError(ctx, i, k, msg);
        out += r.text; i = r.next;
        continue;
      }
      if (v > 0x10ffff) {
        const r = decodeError(ctx, i, k, 'illegal Unicode character');
        out += r.text; i = r.next;
        continue;
      }
      out += String.fromCodePoint(v);
      i = k;
      continue;
    }
    if (!raw && e === 0x4e && b[i + 2] === 0x7b) {
      let k = i + 3;
      let nm = '';
      while (k < n && b[k] !== 0x7d) nm += String.fromCharCode(b[k++]);
      const cp = k < n ? unicodeByName(nm) : null;
      if (cp === null) {
        const r = decodeError(ctx, i, Math.min(n, k + 1), 'unknown Unicode character name');
        out += r.text; i = r.next;
        continue;
      }
      out += String.fromCodePoint(cp);
      i = k + 1;
      continue;
    }
    // escape desconocido: se conserva la barra
    out += '\\' + String.fromCharCode(e);
    i += 2;
  }
  return out;
}

// ───────────────────────── nombres de códecs ─────────────────────────

export interface NativeCodec {
  /** nombre que devuelve codecs.lookup().name */
  name: string;
  encode(s: string, errors: string): Uint8Array;
  decode(b: ArrayLike<number>, errors: string): string;
}

const ALIASES: Record<string, string> = {
  utf_8: 'utf-8', utf8: 'utf-8', u8: 'utf-8', utf: 'utf-8', cp65001: 'utf-8', utf8_ucs2: 'utf-8', utf8_ucs4: 'utf-8',
  utf_8_sig: 'utf-8-sig',
  utf_16: 'utf-16', utf16: 'utf-16', u16: 'utf-16', utf_16_le: 'utf-16-le', utf_16le: 'utf-16-le', unicodelittleunmarked: 'utf-16-le',
  utf_16_be: 'utf-16-be', utf_16be: 'utf-16-be', unicodebigunmarked: 'utf-16-be',
  utf_32: 'utf-32', utf32: 'utf-32', u32: 'utf-32', utf_32_le: 'utf-32-le', utf_32le: 'utf-32-le', utf_32_be: 'utf-32-be', utf_32be: 'utf-32-be',
  ascii: 'ascii', us_ascii: 'ascii', ansi_x3_4_1968: 'ascii', '646': 'ascii', cp367: 'ascii', iso646_us: 'ascii', iso_646_irv_1991: 'ascii',
  latin_1: 'iso8859-1', latin1: 'iso8859-1', latin: 'iso8859-1', l1: 'iso8859-1', iso8859_1: 'iso8859-1', iso_8859_1: 'iso8859-1',
  '8859': 'iso8859-1', cp819: 'iso8859-1', iso_ir_100: 'iso8859-1', ibm819: 'iso8859-1',
  cp1252: 'cp1252', windows_1252: 'cp1252', '1252': 'cp1252',
  iso8859_15: 'iso8859-15', iso_8859_15: 'iso8859-15', latin9: 'iso8859-15', l9: 'iso8859-15',
  unicode_escape: 'unicode-escape', unicodeescape: 'unicode-escape', raw_unicode_escape: 'raw-unicode-escape', rawunicodeescape: 'raw-unicode-escape',
};

export function normCodecName(enc: string): string {
  return enc.toLowerCase().replace(/[^a-z0-9.]+/g, '_').replace(/^_+|_+$/g, '');
}

const u8 = (a: number[]): Uint8Array => Uint8Array.from(a);

const CODECS: Record<string, NativeCodec> = {
  'utf-8': { name: 'utf-8', encode: (s, e) => u8(utf8EncodeBytes(s, e)), decode: (b, e) => utf8Decode(b, e, true).text },
  'utf-8-sig': {
    name: 'utf-8-sig',
    encode: (s, e) => u8([0xef, 0xbb, 0xbf, ...utf8EncodeBytes(s, e, 'utf-8')]),
    decode: (b, e) => utf8Decode(b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? Array.prototype.slice.call(b, 3) : b, e, true, 'utf-8').text,
  },
  'utf-16': { name: 'utf-16', encode: (s, e) => u8(utf16Encode(s, e, 'le', true)), decode: (b, e) => utf16Decode(b, e, null, true).text },
  'utf-16-le': { name: 'utf-16-le', encode: (s, e) => u8(utf16Encode(s, e, 'le', false)), decode: (b, e) => utf16Decode(b, e, 'le', true, 'utf-16-le').text },
  'utf-16-be': { name: 'utf-16-be', encode: (s, e) => u8(utf16Encode(s, e, 'be', false)), decode: (b, e) => utf16Decode(b, e, 'be', true, 'utf-16-be').text },
  'utf-32': { name: 'utf-32', encode: (s, e) => u8(utf32Encode(s, e, 'le', true)), decode: (b, e) => utf32Decode(b, e, null, true).text },
  'utf-32-le': { name: 'utf-32-le', encode: (s, e) => u8(utf32Encode(s, e, 'le', false)), decode: (b, e) => utf32Decode(b, e, 'le', true, 'utf-32-le').text },
  'utf-32-be': { name: 'utf-32-be', encode: (s, e) => u8(utf32Encode(s, e, 'be', false)), decode: (b, e) => utf32Decode(b, e, 'be', true, 'utf-32-be').text },
  ascii: { name: 'ascii', encode: (s, e) => u8(encodeLimit(s, e, 128, 'ascii')), decode: (b, e) => decodeAscii(b, e) },
  'iso8859-1': { name: 'iso8859-1', encode: (s, e) => u8(encodeLimit(s, e, 256, 'latin-1')), decode: (b) => decodeLatin1(b) },
  cp1252: {
    name: 'cp1252',
    encode: (s, e) => u8(charmapEncode(s, e, new EncodingMap(singleByteTable('cp1252')), 'charmap')),
    decode: (b, e) => charmapDecode(b, e, singleByteTable('cp1252'), 'charmap'),
  },
  'iso8859-15': {
    name: 'iso8859-15',
    encode: (s, e) => u8(charmapEncode(s, e, new EncodingMap(singleByteTable('iso8859-15')), 'charmap')),
    decode: (b, e) => charmapDecode(b, e, singleByteTable('iso8859-15'), 'charmap'),
  },
  'unicode-escape': { name: 'unicode-escape', encode: (s) => u8(unicodeEscapeEncode(s, false)), decode: (b, e) => unicodeEscapeDecode(b, e, false) },
  'raw-unicode-escape': { name: 'raw-unicode-escape', encode: (s) => u8(unicodeEscapeEncode(s, true)), decode: (b, e) => unicodeEscapeDecode(b, e, true) },
};

export function nativeCodec(enc: string): NativeCodec | undefined {
  const n = ALIASES[normCodecName(enc)];
  return n === undefined ? undefined : CODECS[n];
}

// ───────────────────────── punto de entrada (str.encode / bytes.decode) ─────────────────────────

/** CodecInfo de un códec definido en Python (codecs.register / paquete encodings) */
function pyCodecInfo(enc: string, op: 'encode' | 'decode'): any {
  const { importModule } = require('./modules') as typeof import('./modules');
  const cm = importModule(interp(), 'codecs');
  const info = callObj(ops.getAttr(cm, 'lookup'), [enc]);
  if (ops.getAttrOpt(info, '_is_text_encoding') === false) {
    throw makeExc(E.LookupError, [`'${enc}' is not a text encoding; use codecs.${op}() to handle arbitrary codecs`]);
  }
  return info;
}

export function encodeText(s: string, enc: string, errors: string): Uint8Array {
  const c = nativeCodec(enc);
  if (c !== undefined) return c.encode(s, errors);
  const info = pyCodecInfo(enc, 'encode');
  const r = callObj(ops.getAttr(info, 'encode'), [s, errors]);
  if (!(r instanceof PyTuple) || r.a.length !== 2) throw typeError('encoder must return a tuple (object, integer)');
  if (!(r.a[0] instanceof PyBytes)) throw typeError(`'${enc}' encoder returned '${ops.typeNameOf(r.a[0])}' instead of 'bytes'; use codecs.encode() to encode to arbitrary types`);
  return Uint8Array.from(r.a[0].b as any);
}

export function decodeText(b: ArrayLike<number>, enc: string, errors: string): string {
  const c = nativeCodec(enc);
  if (c !== undefined) return c.decode(b, errors);
  const info = pyCodecInfo(enc, 'decode');
  const r = callObj(ops.getAttr(info, 'decode'), [bytesObj(b), errors]);
  if (!(r instanceof PyTuple) || r.a.length !== 2) throw typeError('decoder must return a tuple (object,integer)');
  if (!ops.isStr(r.a[0])) throw typeError(`'${enc}' decoder returned '${ops.typeNameOf(r.a[0])}' instead of 'str'; use codecs.decode() to decode to arbitrary types`);
  return ops.strValue(r.a[0]);
}

export const unused = { PyDict };
