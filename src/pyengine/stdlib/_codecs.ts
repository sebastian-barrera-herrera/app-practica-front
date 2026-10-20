/**
 * Módulo `_codecs`: funciones de codificación que usan `codecs.py` y el paquete `encodings` de CPython.
 */
import { PyBaseException, PyBytes, PyDict, PyModule, PyTuple } from '../runtime/objects';
import { bytesType, typeOf } from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { makeExc, typeError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { bytesOf } from '../runtime/t_bytes';
import { registerNative } from './registry';
import { mfn } from './helpers';
import {
  EncodingMap, charmapDecode, charmapEncode, codePoints, codecState, decodeAscii, decodeLatin1, encodeLimit, escapeCp,
  normCodecName, unicodeEscapeDecode, unicodeEscapeEncode, utf16Decode, utf16Encode, utf32Decode, utf32Encode, utf8Decode,
  utf8EncodeBytes, type ByteOrder,
} from '../runtime/codecs';
import { unicodeName } from '../unames';

const bytes = (a: ArrayLike<number>): PyBytes => new PyBytes(Uint8Array.from(a as any), bytesType);
const errs = (e: any): string => (e === undefined || e === null ? 'strict' : ops.strValue(e));
const strArg = (s: any, fn: string): string => {
  if (!ops.isStr(s)) throw typeError(`${fn}() argument 1 must be str, not ${typeOf(s).name}`);
  return ops.strValue(s);
};
const dataArg = (d: any, fn: string): ArrayLike<number> => {
  if (ops.isStr(d)) throw typeError(`${fn}() argument 1 must be a bytes-like object, not 'str'`);
  return bytesOf(d);
};

function lookupCodec(I: Interp, encoding: string): any {
  const { search: searchFns, cache: codecCache } = codecState();
  const key = normCodecName(encoding).replace(/\./g, '_');
  const hit = codecCache.get(key);
  if (hit !== undefined) return hit;
  if (searchFns.length === 0) {
    // CPython importa `encodings` al arrancar: ahí se registra la función de búsqueda estándar
    const { importModule } = require('../runtime/modules') as typeof import('../runtime/modules');
    importModule(I, 'encodings');
  }
  const norm = encoding.toLowerCase().replace(/[ -]/g, '_');
  for (const fn of searchFns) {
    const r = callObj(fn, [norm]);
    if (r === null) continue;
    if (!(r instanceof PyTuple) || r.a.length !== 4) throw typeError('codec search functions must return 4-tuples');
    codecCache.set(key, r);
    return r;
  }
  throw makeExc(E.LookupError, [`unknown encoding: ${encoding}`]);
}

/** atributos de la excepción que recibe un manejador */
function excInfo(e: any, name: string): { start: number; end: number; obj: any; reason: string } {
  if (!(e instanceof PyBaseException)) throw typeError(`don't know how to handle ${typeOf(e).name} in error callback`);
  return {
    start: Number(ops.getAttr(e, 'start')),
    end: Number(ops.getAttr(e, 'end')),
    obj: ops.getAttr(e, 'object'),
    reason: String(ops.getAttr(e, 'reason')),
  };
}

function installHandlers(m: PyModule): void {
  const isEnc = (e: any): boolean => e instanceof PyBaseException && e.cls.isSubtype(E.UnicodeEncodeError);
  const isDec = (e: any): boolean => e instanceof PyBaseException && e.cls.isSubtype(E.UnicodeDecodeError);
  const isTr = (e: any): boolean => e instanceof PyBaseException && e.cls.isSubtype(E.UnicodeTranslateError);
  const def = (name: string, impl: (e: any) => any): void => {
    const f = mkNative(name === 'surrogateescape' || name === 'surrogatepass' ? name : name + '_errors', 'exc', impl);
    codecState().handlers.set(name, f);
  };
  def('strict', (e: any) => {
    if (e instanceof PyBaseException) throw e;
    throw typeError('codec must pass exception instance');
  });
  def('ignore', (e: any) => {
    const x = excInfo(e, 'ignore');
    return new PyTuple(['', x.end]);
  });
  def('replace', (e: any) => {
    const x = excInfo(e, 'replace');
    if (isDec(e)) return new PyTuple(['�', x.end]);
    return new PyTuple([(isTr(e) ? '�' : '?').repeat(x.end - x.start), x.end]);
  });
  def('xmlcharrefreplace', (e: any) => {
    if (!isEnc(e)) throw typeError(`don't know how to handle ${typeOf(e).name} in error callback`);
    const x = excInfo(e, 'xmlcharrefreplace');
    const cps = codePoints(ops.strValue(x.obj));
    let t = '';
    for (let i = x.start; i < x.end; i++) t += `&#${cps[i]};`;
    return new PyTuple([t, x.end]);
  });
  def('backslashreplace', (e: any) => {
    const x = excInfo(e, 'backslashreplace');
    let t = '';
    if (isDec(e)) {
      const b = bytesOf(x.obj);
      for (let i = x.start; i < x.end; i++) t += '\\x' + b[i].toString(16).padStart(2, '0');
    } else {
      const cps = codePoints(ops.strValue(x.obj));
      for (let i = x.start; i < x.end; i++) t += escapeCp(cps[i]);
    }
    return new PyTuple([t, x.end]);
  });
  def('namereplace', (e: any) => {
    if (!isEnc(e)) throw typeError(`don't know how to handle ${typeOf(e).name} in error callback`);
    const x = excInfo(e, 'namereplace');
    const cps = codePoints(ops.strValue(x.obj));
    let t = '';
    for (let i = x.start; i < x.end; i++) {
      const nm = unicodeName(cps[i]);
      t += nm === null ? escapeCp(cps[i]) : `\\N{${nm}}`;
    }
    return new PyTuple([t, x.end]);
  });
  def('surrogateescape', (e: any) => {
    const x = excInfo(e, 'surrogateescape');
    if (isDec(e)) {
      const b = bytesOf(x.obj);
      let t = '';
      for (let i = x.start; i < x.end; i++) {
        if (b[i] < 0x80) throw e;
        t += String.fromCharCode(0xdc00 + b[i]);
      }
      return new PyTuple([t, x.end]);
    }
    if (isEnc(e)) {
      const cps = codePoints(ops.strValue(x.obj));
      const out: number[] = [];
      for (let i = x.start; i < x.end; i++) {
        if (cps[i] < 0xdc80 || cps[i] > 0xdcff) throw e;
        out.push(cps[i] - 0xdc00);
      }
      return new PyTuple([bytes(out), x.end]);
    }
    throw typeError(`don't know how to handle ${typeOf(e).name} in error callback`);
  });
  def('surrogatepass', (e: any) => {
    const x = excInfo(e, 'surrogatepass');
    const enc = String(ops.getAttr(e, 'encoding')).toLowerCase().replace(/_/g, '-');
    if (isEnc(e)) {
      const cps = codePoints(ops.strValue(x.obj));
      const out: number[] = [];
      for (let i = x.start; i < x.end; i++) {
        const c = cps[i];
        if (c < 0xd800 || c > 0xdfff) throw e;
        if (enc === 'utf-8' || enc === 'utf8') out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else if (enc.startsWith('utf-16')) { if (enc.endsWith('be')) out.push(c >> 8, c & 255); else out.push(c & 255, c >> 8); }
        else if (enc.startsWith('utf-32')) { if (enc.endsWith('be')) out.push(0, 0, c >> 8, c & 255); else out.push(c & 255, c >> 8, 0, 0); }
        else throw e;
      }
      return new PyTuple([bytes(out), x.end]);
    }
    if (isDec(e)) {
      const b = bytesOf(x.obj);
      if (enc === 'utf-8' || enc === 'utf8') {
        if (x.start + 2 < b.length + 0 && b[x.start] === 0xed && (b[x.start + 1] & 0xe0) === 0xa0 && (b[x.start + 2] & 0xc0) === 0x80) {
          const c = ((b[x.start] & 0x0f) << 12) | ((b[x.start + 1] & 0x3f) << 6) | (b[x.start + 2] & 0x3f);
          return new PyTuple([String.fromCharCode(c), x.start + 3]);
        }
      } else if (enc.startsWith('utf-16') && x.start + 1 < b.length) {
        const c = enc.endsWith('be') ? (b[x.start] << 8) | b[x.start + 1] : b[x.start] | (b[x.start + 1] << 8);
        if (c >= 0xd800 && c <= 0xdfff) return new PyTuple([String.fromCharCode(c), x.start + 2]);
      }
      throw e;
    }
    throw typeError(`don't know how to handle ${typeOf(e).name} in error callback`);
  });
  void m;
}

registerNative('_codecs', (I: Interp, m: PyModule) => {
  installHandlers(m);

  mfn(m, 'register', 'search_function, /', (fn: any) => {
    if (!ops.isCallable(fn)) throw typeError('argument must be callable');
    codecState().search.push(fn);
    return null;
  });
  mfn(m, 'unregister', 'search_function, /', (fn: any) => {
    const st = codecState();
    const i = st.search.indexOf(fn);
    if (i >= 0) st.search.splice(i, 1);
    st.cache.clear();
    return null;
  });
  mfn(m, '_forget_codec', 'encoding, /', (enc: any) => {
    codecState().cache.delete(normCodecName(ops.strValue(enc)).replace(/\./g, '_'));
    return null;
  });
  mfn(m, 'lookup', 'encoding, /', (enc: any) => lookupCodec(I, strArg(enc, 'lookup')));
  mfn(m, 'encode', 'obj, encoding="utf-8", errors="strict"', (obj: any, enc?: any, er?: any) => {
    const info = lookupCodec(I, enc === undefined ? 'utf-8' : ops.strValue(enc));
    const r = callObj((info as PyTuple).a[0], [obj, er === undefined ? 'strict' : er]);
    if (!(r instanceof PyTuple) || r.a.length !== 2) throw typeError('encoder must return a tuple (object, integer)');
    return r.a[0];
  });
  mfn(m, 'decode', 'obj, encoding="utf-8", errors="strict"', (obj: any, enc?: any, er?: any) => {
    const info = lookupCodec(I, enc === undefined ? 'utf-8' : ops.strValue(enc));
    const r = callObj((info as PyTuple).a[1], [obj, er === undefined ? 'strict' : er]);
    if (!(r instanceof PyTuple) || r.a.length !== 2) throw typeError('decoder must return a tuple (object,integer)');
    return r.a[0];
  });
  mfn(m, 'register_error', 'errors, handler, /', (name: any, h: any) => {
    if (!ops.isCallable(h)) throw typeError('handler must be callable');
    codecState().handlers.set(ops.strValue(name), h);
    return null;
  });
  mfn(m, 'lookup_error', 'name, /', (name: any) => {
    const h = codecState().handlers.get(ops.strValue(name));
    if (h === undefined) throw makeExc(E.LookupError, [`unknown error handler name '${ops.strValue(name)}'`]);
    return h;
  });

  // ── utf-8 ──
  mfn(m, 'utf_8_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(utf8EncodeBytes(strArg(s, 'utf_8_encode'), errs(e))), ops.lenOf(s)]));
  mfn(m, 'utf_8_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf8Decode(dataArg(d, 'utf_8_decode'), errs(e), f !== undefined && ops.truthy(f));
    return new PyTuple([r.text, r.consumed]);
  });
  // ── ascii / latin-1 ──
  mfn(m, 'ascii_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(encodeLimit(strArg(s, 'ascii_encode'), errs(e), 128, 'ascii')), ops.lenOf(s)]));
  mfn(m, 'ascii_decode', 'data, errors=None, /', (d: any, e?: any) => {
    const b = dataArg(d, 'ascii_decode');
    return new PyTuple([decodeAscii(b, errs(e)), b.length]);
  });
  mfn(m, 'latin_1_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(encodeLimit(strArg(s, 'latin_1_encode'), errs(e), 256, 'latin-1')), ops.lenOf(s)]));
  mfn(m, 'latin_1_decode', 'data, errors=None, /', (d: any) => {
    const b = dataArg(d, 'latin_1_decode');
    return new PyTuple([decodeLatin1(b), b.length]);
  });
  // ── utf-16 ──
  const orderOf = (n: number): ByteOrder | null => (n < 0 ? 'le' : n > 0 ? 'be' : null);
  mfn(m, 'utf_16_encode', 'str, errors=None, byteorder=0, /', (s: any, e?: any, bo?: any) => {
    const n = bo === undefined ? 0 : Number(bo);
    return new PyTuple([bytes(utf16Encode(strArg(s, 'utf_16_encode'), errs(e), n > 0 ? 'be' : 'le', n === 0)), ops.lenOf(s)]);
  });
  mfn(m, 'utf_16_le_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(utf16Encode(strArg(s, 'utf_16_le_encode'), errs(e), 'le', false)), ops.lenOf(s)]));
  mfn(m, 'utf_16_be_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(utf16Encode(strArg(s, 'utf_16_be_encode'), errs(e), 'be', false)), ops.lenOf(s)]));
  mfn(m, 'utf_16_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf16Decode(dataArg(d, 'utf_16_decode'), errs(e), null, f !== undefined && ops.truthy(f));
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_16_le_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf16Decode(dataArg(d, 'utf_16_le_decode'), errs(e), 'le', f !== undefined && ops.truthy(f), 'utf-16-le');
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_16_be_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf16Decode(dataArg(d, 'utf_16_be_decode'), errs(e), 'be', f !== undefined && ops.truthy(f), 'utf-16-be');
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_16_ex_decode', 'data, errors=None, byteorder=0, final=False, /', (d: any, e?: any, bo?: any, f?: any) => {
    const n = bo === undefined ? 0 : Number(bo);
    const r = utf16Decode(dataArg(d, 'utf_16_ex_decode'), errs(e), orderOf(n), f !== undefined && ops.truthy(f));
    return new PyTuple([r.text, r.consumed, n !== 0 ? n : r.order === 'le' ? -1 : 1]);
  });
  // ── utf-32 ──
  mfn(m, 'utf_32_encode', 'str, errors=None, byteorder=0, /', (s: any, e?: any, bo?: any) => {
    const n = bo === undefined ? 0 : Number(bo);
    return new PyTuple([bytes(utf32Encode(strArg(s, 'utf_32_encode'), errs(e), n > 0 ? 'be' : 'le', n === 0)), ops.lenOf(s)]);
  });
  mfn(m, 'utf_32_le_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(utf32Encode(strArg(s, 'utf_32_le_encode'), errs(e), 'le', false)), ops.lenOf(s)]));
  mfn(m, 'utf_32_be_encode', 'str, errors=None, /', (s: any, e?: any) => new PyTuple([bytes(utf32Encode(strArg(s, 'utf_32_be_encode'), errs(e), 'be', false)), ops.lenOf(s)]));
  mfn(m, 'utf_32_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf32Decode(dataArg(d, 'utf_32_decode'), errs(e), null, f !== undefined && ops.truthy(f));
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_32_le_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf32Decode(dataArg(d, 'utf_32_le_decode'), errs(e), 'le', f !== undefined && ops.truthy(f), 'utf-32-le');
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_32_be_decode', 'data, errors=None, final=False, /', (d: any, e?: any, f?: any) => {
    const r = utf32Decode(dataArg(d, 'utf_32_be_decode'), errs(e), 'be', f !== undefined && ops.truthy(f), 'utf-32-be');
    return new PyTuple([r.text, r.consumed]);
  });
  mfn(m, 'utf_32_ex_decode', 'data, errors=None, byteorder=0, final=False, /', (d: any, e?: any, bo?: any, f?: any) => {
    const n = bo === undefined ? 0 : Number(bo);
    const r = utf32Decode(dataArg(d, 'utf_32_ex_decode'), errs(e), orderOf(n), f !== undefined && ops.truthy(f));
    return new PyTuple([r.text, r.consumed, n !== 0 ? n : r.order === 'le' ? -1 : 1]);
  });
  // ── escapes ──
  mfn(m, 'unicode_escape_encode', 'str, errors=None, /', (s: any) => new PyTuple([bytes(unicodeEscapeEncode(strArg(s, 'unicode_escape_encode'), false)), ops.lenOf(s)]));
  mfn(m, 'unicode_escape_decode', 'data, errors=None, final=True, /', (d: any, e?: any) => {
    const b = ops.isStr(d) ? Uint8Array.from(codePoints(ops.strValue(d)).map((c) => c & 255)) : dataArg(d, 'unicode_escape_decode');
    return new PyTuple([unicodeEscapeDecode(b, errs(e), false), b.length]);
  });
  mfn(m, 'raw_unicode_escape_encode', 'str, errors=None, /', (s: any) => new PyTuple([bytes(unicodeEscapeEncode(strArg(s, 'raw_unicode_escape_encode'), true)), ops.lenOf(s)]));
  mfn(m, 'raw_unicode_escape_decode', 'data, errors=None, final=True, /', (d: any, e?: any) => {
    const b = ops.isStr(d) ? Uint8Array.from(codePoints(ops.strValue(d)).map((c) => c & 255)) : dataArg(d, 'raw_unicode_escape_decode');
    return new PyTuple([unicodeEscapeDecode(b, errs(e), true), b.length]);
  });
  mfn(m, 'escape_encode', 'data, errors=None, /', (d: any) => {
    const b = dataArg(d, 'escape_encode');
    const out: number[] = [];
    const put = (t: string): void => { for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i)); };
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === 0x5c) put('\\\\');
      else if (c === 0x27) put("\\'");
      else if (c === 9) put('\\t');
      else if (c === 10) put('\\n');
      else if (c === 13) put('\\r');
      else if (c < 0x20 || c >= 0x7f) put('\\x' + c.toString(16).padStart(2, '0'));
      else out.push(c);
    }
    return new PyTuple([bytes(out), b.length]);
  });
  mfn(m, 'escape_decode', 'data, errors=None, /', (d: any) => {
    const src = ops.isStr(d) ? Uint8Array.from(codePoints(ops.strValue(d)).map((c) => c & 255)) : dataArg(d, 'escape_decode');
    const out: number[] = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c !== 0x5c || i + 1 >= src.length) { out.push(c); continue; }
      const e = src[++i];
      const simple: Record<number, number> = { 0x5c: 0x5c, 0x27: 0x27, 0x22: 0x22, 0x61: 7, 0x62: 8, 0x66: 12, 0x6e: 10, 0x72: 13, 0x74: 9, 0x76: 11 };
      if (simple[e] !== undefined) out.push(simple[e]);
      else if (e === 10) { /* continuación */ }
      else if (e >= 48 && e <= 55) {
        let v = e - 48;
        for (let q = 0; q < 2 && i + 1 < src.length && src[i + 1] >= 48 && src[i + 1] <= 55; q++) v = v * 8 + (src[++i] - 48);
        out.push(v & 255);
      } else if (e === 0x78 && i + 2 < src.length + 0) {
        const h = String.fromCharCode(src[i + 1], src[i + 2]);
        if (!/^[0-9a-fA-F]{2}$/.test(h)) throw makeExc(E.ValueError, ['invalid \\x escape at position ' + (i - 1)]);
        out.push(parseInt(h, 16));
        i += 2;
      } else { out.push(0x5c, e); }
    }
    return new PyTuple([bytes(out), src.length]);
  });
  mfn(m, 'readbuffer_encode', 'data, errors=None, /', (d: any) => {
    const b = ops.isStr(d) ? Uint8Array.from(utf8EncodeBytes(ops.strValue(d), 'strict')) : dataArg(d, 'readbuffer_encode');
    return new PyTuple([bytes(b), b.length]);
  });
  // ── charmap ──
  mfn(m, 'charmap_build', 'map, /', (t: any) => new EncodingMap(strArg(t, 'charmap_build')));
  mfn(m, 'charmap_encode', 'str, errors=None, mapping=None, /', (s: any, e?: any, mp?: any) =>
    new PyTuple([bytes(charmapEncode(strArg(s, 'charmap_encode'), errs(e), mp === undefined ? null : mp)), ops.lenOf(s)]));
  mfn(m, 'charmap_decode', 'data, errors=None, mapping=None, /', (d: any, e?: any, mp?: any) => {
    const b = dataArg(d, 'charmap_decode');
    return new PyTuple([charmapDecode(b, errs(e), mp === undefined ? null : mp), b.length]);
  });
  void PyDict;
});
