/**
 * `str`: métodos, `str.format`, formato con `%` y codificación.
 */
import { PyBox, PyByteArray, PyBytes, PyDict, PyFloat, PyList, PyObject, PySlice, PyTuple, PyType, PyClassMethod, type Kw } from './objects';
import { NotImplemented, bytesType, classMethodType, staticMethodType, strType, typeOf } from './builtin_types';
import { E } from './exc_types';
import { indexError, keyError, makeExc, typeError, valueError, overflowError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { asciiOf, formatFloat, isPrintableCp, percentFormat, strRepr, type PercentHost } from './fmt';
import { chars, cmpStr, cpIndexOf, hasAstral, strHash, strLen, utf16IndexOf, utf8Decode, utf8Encode } from './pystr';
import { defMethods, mkNative } from './native';
import { asIdx, asStr, kwMap, tupleArr } from './util';
import { PyStaticMethod } from './objects';
import { toFloatValue } from './t_num';

const S = strType;

function sv(x: any): string {
  if (typeof x === 'string') return x;
  if (x instanceof PyBox && typeof x.value === 'string') return x.value;
  throw typeError(`descriptor requires a 'str' object but received a '${typeOf(x).name}'`);
}

function argStr(x: any, meth: string, pos = 1): string {
  if (typeof x === 'string') return x;
  if (x instanceof PyBox && typeof x.value === 'string') return x.value;
  throw typeError(`${meth}() argument ${pos} must be str, not ${typeOf(x).name}`);
}

// ───────────────────────── caracteres ─────────────────────────

const WS_CHARS = ' \t\n\r\v\f\u001c\u001d\u001e\u001f\u0085                 　';
const isWs = (c: string): boolean => WS_CHARS.indexOf(c) >= 0;

const RE_ALPHA = /^\p{L}+$/u;
const RE_ALNUM = /^[\p{L}\p{N}]+$/u;
const RE_DECIMAL = /^\p{Nd}+$/u;
const RE_DIGIT = /^[\p{Nd}²³¹⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐]+$/u;
const RE_NUMERIC = /^\p{N}+$/u;
const RE_IDENT = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}_]*$/u;

function isCased(c: string): boolean {
  return c.toLowerCase() !== c.toUpperCase() || /\p{Lt}/u.test(c);
}

// ───────────────────────── índices con puntos de código ─────────────────────────

/** normaliza start/end de find/count/startswith… a unidades UTF-16 */
function range16(s: string, start: any, end: any): [number, number] {
  const astral = hasAstral(s);
  const n = astral ? chars(s).length : s.length;
  let a = start === undefined || start === null ? 0 : asIdx(start, "slice indices must be integers or None or have an __index__ method");
  let b = end === undefined || end === null ? n : asIdx(end, "slice indices must be integers or None or have an __index__ method");
  if (a < 0) { a += n; if (a < 0) a = 0; }
  if (b < 0) { b += n; if (b < 0) b = 0; }
  if (b > n) b = n;
  if (!astral) return [a, b];
  return [utf16IndexOf(s, Math.min(a, n)), utf16IndexOf(s, b)];
}
function toCp(s: string, i: number): number {
  return hasAstral(s) ? cpIndexOf(s, i) : i;
}

// ───────────────────────── __new__ / básicos ─────────────────────────

function decodeBytes(b: ArrayLike<number>, enc: string, errors: string): string {
  const e = enc.toLowerCase().replace(/[-_ ]/g, '');
  if (e === 'utf8' || e === 'u8' || e === 'utf') {
    return utf8Decode(b, (pos, byte, reason) => {
      if (errors === 'strict') {
        const x = makeExc(E.UnicodeDecodeError, ['utf-8', new PyBytes(Uint8Array.from(b as any), bytesType), pos, pos + 1, reason]);
        x.extra = { custom: `'utf-8' codec can't decode byte 0x${byte.toString(16).padStart(2, '0')} in position ${pos}: ${reason}` };
        throw x;
      }
      if (errors === 'ignore') return '';
      if (errors === 'replace') return '�';
      if (errors === 'backslashreplace') return '\\x' + byte.toString(16).padStart(2, '0');
      throw makeExc(E.LookupError, [`unknown error handler name '${errors}'`]);
    });
  }
  if (e === 'ascii' || e === 'usascii') {
    let out = '';
    for (let i = 0; i < b.length; i++) {
      if (b[i] < 128) out += String.fromCharCode(b[i]);
      else if (errors === 'strict') {
        const x = makeExc(E.UnicodeDecodeError, ['ascii', new PyBytes(Uint8Array.from(b as any), bytesType), i, i + 1, 'ordinal not in range(128)']);
        x.extra = { custom: `'ascii' codec can't decode byte 0x${b[i].toString(16).padStart(2, '0')} in position ${i}: ordinal not in range(128)` };
        throw x;
      } else if (errors === 'replace') out += '�';
    }
    return out;
  }
  if (e === 'latin1' || e === 'iso88591' || e === 'l1' || e === 'cp1252' || e === 'windows1252') {
    let out = '';
    for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
    return out;
  }
  throw makeExc(E.LookupError, [`unknown encoding: ${enc}`]);
}

export function encodeStr(s: string, enc: string, errors: string): Uint8Array {
  const e = enc.toLowerCase().replace(/[-_ ]/g, '');
  if (e === 'utf8' || e === 'u8' || e === 'utf') return Uint8Array.from(utf8Encode(s));
  const limit = e === 'ascii' || e === 'usascii' ? 128 : e === 'latin1' || e === 'iso88591' || e === 'l1' ? 256 : -1;
  if (limit < 0) throw makeExc(E.LookupError, [`unknown encoding: ${enc}`]);
  const out: number[] = [];
  let pos = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp < limit) out.push(cp);
    else if (errors === 'strict') {
      const name = limit === 128 ? 'ascii' : 'latin-1';
      const x = makeExc(E.UnicodeEncodeError, [name, s, pos, pos + 1, `ordinal not in range(${limit})`]);
      x.extra = { custom: `'${name}' codec can't encode character '${cp < 256 ? '\\x' + cp.toString(16).padStart(2, '0') : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0') : '\\U' + cp.toString(16).padStart(8, '0')}' in position ${pos}: ordinal not in range(${limit})` };
      throw x;
    } else if (errors === 'ignore') { /* nada */ }
    else if (errors === 'replace') out.push(63);
    else if (errors === 'xmlcharrefreplace') for (const ch of `&#${cp};`) out.push(ch.charCodeAt(0));
    else if (errors === 'backslashreplace') for (const ch of (cp < 256 ? '\\x' + cp.toString(16).padStart(2, '0') : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0') : '\\U' + cp.toString(16).padStart(8, '0'))) out.push(ch.charCodeAt(0));
    else throw makeExc(E.LookupError, [`unknown error handler name '${errors}'`]);
    pos++;
  }
  return Uint8Array.from(out);
}

S.dict!.set('__new__', mkNative('__new__', 'cls, object=, encoding=, errors=', (cls: any, obj?: any, enc?: any, errs?: any) => {
  let v: string;
  if (obj === undefined) v = '';
  else if (enc !== undefined || errs !== undefined) {
    const e = enc === undefined ? 'utf-8' : argStr(enc, 'str', 2);
    const er = errs === undefined ? 'strict' : argStr(errs, 'str', 3);
    let b: ArrayLike<number> | undefined;
    if (obj instanceof PyBytes) b = obj.b;
    else if (obj instanceof PyByteArray) b = obj.b;
    if (b === undefined) {
      if (ops.isStr(obj)) throw typeError('decoding str is not supported');
      throw typeError(`decoding to str: need a bytes-like object, ${typeOf(obj).name} found`);
    }
    v = decodeBytes(b, e, er);
  } else v = ops.str(obj);
  if (cls === strType) return v;
  return new PyBox(cls, v);
}, { owner: 'str' }));

// ───────────────────────── búsqueda ─────────────────────────

function findImpl(self: any, sub: any, start: any, end: any, rev: boolean, meth: string): number {
  const s = sv(self);
  const t = argStr(sub, meth, 1);
  const [a, b] = range16(s, start, end);
  if (b - a < t.length) return -1;
  let i: number;
  if (rev) {
    i = s.slice(0, b).lastIndexOf(t);
    if (i < a) i = -1;
  } else {
    i = s.indexOf(t, a);
    if (i + t.length > b) i = -1;
  }
  return i < 0 ? -1 : toCp(s, i);
}

function countImpl(self: any, sub: any, start: any, end: any): number {
  const s = sv(self);
  const t = argStr(sub, 'count', 1);
  const [a, b] = range16(s, start, end);
  if (a > s.length) return 0;
  const seg = s.slice(a, b);
  if (t === '') return strLen(seg) + 1;
  let n = 0;
  let i = 0;
  for (;;) {
    const j = seg.indexOf(t, i);
    if (j < 0) return n;
    n++;
    i = j + t.length;
  }
}

function startsEnds(self: any, pre: any, start: any, end: any, ends: boolean): boolean {
  const s = sv(self);
  const [a, b] = range16(s, start, end);
  const seg = s.slice(a, b);
  const test = (p: any): boolean => {
    if (!ops.isStr(p)) throw typeError(`tuple for ${ends ? 'endswith' : 'startswith'} must only contain str, not ${typeOf(p).name}`);
    const q = ops.strValue(p);
    if (start !== undefined && a > s.length) return false;
    return ends ? seg.endsWith(q) : seg.startsWith(q);
  };
  if (pre instanceof PyTuple) {
    for (const p of pre.a) if (test(p)) return true;
    return false;
  }
  if (!ops.isStr(pre)) throw typeError(`${ends ? 'endswith' : 'startswith'} first arg must be str or a tuple of str, not ${typeOf(pre).name}`);
  return test(pre);
}

// ───────────────────────── split / strip ─────────────────────────

function splitWs(s: string, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && isWs(s[i])) i++;
    if (i >= n) break;
    if (max >= 0 && out.length >= max) {
      out.push(s.slice(i).replace(/[\s\u001c-\u001f\u0085]+$/, (m) => (m.split('').every(isWs) ? '' : m)));
      return out;
    }
    let j = i;
    while (j < n && !isWs(s[j])) j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

function rsplitWs(s: string, max: number): string[] {
  const out: string[] = [];
  let i = s.length;
  while (i > 0) {
    while (i > 0 && isWs(s[i - 1])) i--;
    if (i <= 0) break;
    if (max >= 0 && out.length >= max) {
      let k = 0;
      while (k < i && isWs(s[k])) k++;
      out.push(s.slice(k, i));
      return out.reverse();
    }
    let j = i;
    while (j > 0 && !isWs(s[j - 1])) j--;
    out.push(s.slice(j, i));
    i = j;
  }
  return out.reverse();
}

function splitImpl(self: any, sep: any, maxsplit: any, right: boolean): PyList {
  const s = sv(self);
  const max = maxsplit === undefined ? -1 : asIdx(maxsplit);
  if (sep === undefined || sep === null) return new PyList(right ? rsplitWs(s, max) : splitWs(s, max));
  const d = argStr(sep, right ? 'rsplit' : 'split', 1);
  if (d === '') throw valueError('empty separator');
  const parts: string[] = [];
  if (!right) {
    let i = 0;
    for (;;) {
      if (max >= 0 && parts.length >= max) break;
      const j = s.indexOf(d, i);
      if (j < 0) break;
      parts.push(s.slice(i, j));
      i = j + d.length;
    }
    parts.push(s.slice(i));
    return new PyList(parts);
  }
  let end = s.length;
  for (;;) {
    if (max >= 0 && parts.length >= max) break;
    const j = s.lastIndexOf(d, end - d.length);
    if (j < 0 || end - d.length < 0) break;
    parts.push(s.slice(j + d.length, end));
    end = j;
  }
  parts.push(s.slice(0, end));
  return new PyList(parts.reverse());
}

function stripChars(self: any, chs: any, left: boolean, right: boolean): string {
  const s = sv(self);
  let set: (c: string) => boolean;
  if (chs === undefined || chs === null) set = isWs;
  else {
    const cs = argStr(chs, 'strip', 1);
    set = (c) => cs.indexOf(c) >= 0;
  }
  let a = 0;
  let b = s.length;
  if (left) while (a < b && set(s[a])) a++;
  if (right) while (b > a && set(s[b - 1])) b--;
  return s.slice(a, b);
}

function splitlines(s: string, keep: boolean): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  let start = 0;
  while (i < n) {
    const c = s[i];
    if (c === '\n' || c === '\r' || c === '\v' || c === '\f' || c === '\u001c' || c === '\u001d' || c === '\u001e' || c === '\u0085' || c === ' ' || c === ' ') {
      let e = i + 1;
      if (c === '\r' && s[i + 1] === '\n') e++;
      out.push(s.slice(start, keep ? e : i));
      i = e;
      start = e;
    } else i++;
  }
  if (start < n) out.push(s.slice(start));
  return out;
}

// ───────────────────────── relleno ─────────────────────────

function padArgs(self: any, width: any, fill: any): [string, number, string] {
  const s = sv(self);
  const w = asIdx(width);
  let f = ' ';
  if (fill !== undefined) {
    const fs = argStr(fill, 'ljust', 2);
    if (strLen(fs) !== 1) throw typeError('The fill character must be exactly one character long');
    f = fs;
  }
  return [s, w, f];
}

function title(s: string): string {
  let out = '';
  let prevCased = false;
  for (const c of s) {
    if (prevCased) out += c.toLowerCase();
    else out += c.length === 1 && c.toUpperCase().length > 1 ? c.toUpperCase().charAt(0) + c.toUpperCase().slice(1).toLowerCase() : c.toUpperCase();
    prevCased = isCased(c);
  }
  return out;
}

// ───────────────────────── str.format ─────────────────────────

function formatField(I: { args: any[]; kw: Kw | null; auto: number; manual: boolean }, field: string, conv: string, spec: string, depth: number, mapping: any): string {
  // field: arg_name ("." attr | "[" idx "]")*
  const m = /^([^.\[]*)(.*)$/s.exec(field)!;
  const first = m[1];
  let rest = m[2];
  let obj: any;
  if (first === '') {
    if (I.manual) throw valueError('cannot switch from manual field specification to automatic field numbering');
    I.auto = I.auto === -1 ? 0 : I.auto;
    const idx = I.auto++;
    if (idx >= I.args.length) throw indexError(`Replacement index ${idx} out of range for positional args tuple`);
    obj = I.args[idx];
  } else if (/^\d+$/.test(first)) {
    if (I.auto > 0) throw valueError('cannot switch from automatic field numbering to manual field specification');
    I.manual = true;
    I.auto = -1;
    const idx = parseInt(first, 10);
    if (idx >= I.args.length) throw indexError(`Replacement index ${idx} out of range for positional args tuple`);
    obj = I.args[idx];
  } else {
    if (mapping !== undefined) obj = ops.getitem(mapping, first);
    else {
      if (I.kw === null || !I.kw.has(first)) throw keyError(first);
      obj = I.kw.get(first);
    }
  }
  while (rest.length > 0) {
    if (rest[0] === '.') {
      const mm = /^\.([^.\[]+)(.*)$/s.exec(rest);
      if (!mm) throw valueError('Empty attribute in format string');
      obj = ops.getAttr(obj, mm[1]);
      rest = mm[2];
    } else if (rest[0] === '[') {
      const close = rest.indexOf(']');
      if (close < 0) throw valueError("Missing ']' in format string");
      const key = rest.slice(1, close);
      obj = ops.getitem(obj, /^\d+$/.test(key) ? parseInt(key, 10) : key);
      rest = rest.slice(close + 1);
    } else throw valueError('Only \'.\' or \'[\' may follow \']\' in format field specifier');
  }
  if (conv === 'r') obj = ops.repr(obj);
  else if (conv === 's') obj = ops.str(obj);
  else if (conv === 'a') obj = ops.ascii(obj);
  else if (conv !== '') throw valueError(`Unknown conversion specifier ${conv}`);
  if (spec.includes('{')) {
    if (depth >= 2) throw valueError('Max string recursion exceeded');
    spec = formatTemplate(spec, I, depth + 1, mapping);
  }
  return ops.formatValue(obj, spec);
}

function formatTemplate(t: string, st: { args: any[]; kw: Kw | null; auto: number; manual: boolean }, depth: number, mapping?: any): string {
  let out = '';
  let i = 0;
  const n = t.length;
  while (i < n) {
    const c = t[i];
    if (c === '{') {
      if (t[i + 1] === '{') { out += '{'; i += 2; continue; }
      // buscar el cierre respetando anidamiento
      let depthB = 1;
      let j = i + 1;
      while (j < n && depthB > 0) {
        if (t[j] === '{') depthB++;
        else if (t[j] === '}') depthB--;
        j++;
      }
      if (depthB > 0) throw valueError("expected '}' before end of string");
      const inner = t.slice(i + 1, j - 1);
      // field!conv:spec  (el ':' y '!' dentro de [] no cuentan)
      let k = 0;
      let inBr = false;
      let fieldEnd = inner.length;
      for (; k < inner.length; k++) {
        const ch = inner[k];
        if (ch === '[') inBr = true;
        else if (ch === ']') inBr = false;
        else if (!inBr && (ch === '!' || ch === ':')) { fieldEnd = k; break; }
      }
      const field = inner.slice(0, fieldEnd);
      let conv = '';
      let spec = '';
      let r = inner.slice(fieldEnd);
      if (r[0] === '!') {
        if (r.length < 2) throw valueError('end of string while looking for conversion specifier');
        conv = r[1];
        r = r.slice(2);
        if (r !== '' && r[0] !== ':') throw valueError('expected \':\' after conversion specifier');
      }
      if (r[0] === ':') spec = r.slice(1);
      out += formatField(st, field, conv, spec, depth, mapping);
      i = j;
    } else if (c === '}') {
      if (t[i + 1] === '}') { out += '}'; i += 2; continue; }
      throw valueError("Single '}' encountered in format string");
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ───────────────────────── % ─────────────────────────

const percentHost: PercentHost = {
  str: ops.str,
  repr: ops.repr,
  ascii: ops.ascii,
  toInt(x, fmt) {
    const v = ops.intValue(x);
    if (v !== undefined) return v;
    if (x instanceof PyFloat) {
      if (fmt === 'd' || fmt === 'i' || fmt === 'u') {
        if (x.v !== x.v) throw valueError('cannot convert float NaN to integer');
        if (!isFinite(x.v)) throw overflowError('cannot convert float infinity to integer');
        return Number.isSafeInteger(Math.trunc(x.v)) ? Math.trunc(x.v) : BigInt(Math.trunc(x.v));
      }
      throw typeError(`%${fmt} format: an integer is required, not float`);
    }
    const f = typeOf(x).lookup('__index__');
    if (f !== undefined) return ops.toIndex(x);
    if (fmt === '*') throw typeError('* wants int');
    throw typeError(`%${fmt} format: a real number is required, not ${typeOf(x).name}`.replace(/a real number/, fmt === 'd' || fmt === 'i' || fmt === 'u' ? 'a real number' : 'an integer'));
  },
  toFloat(x, fmt) {
    try {
      return toFloatValue(x);
    } catch (e) {
      if (!ops.isStr(x) && typeOf(x).lookup('__float__') === undefined) throw typeError(`must be real number, not ${typeOf(x).name}`);
      throw e;
    }
  },
  isMapping: (x) => x instanceof PyDict || (x instanceof PyObject && !(x instanceof PyTuple) && typeof x !== 'string' && x.cls.lookup('__getitem__') !== undefined && !(ops.isStr(x))),
  getitem: ops.getitem,
  typeName: (x) => typeOf(x).name,
  isTuple: (x) => x instanceof PyTuple,
  tupleItems: (x) => x.a,
  isStr: (x) => ops.isStr(x),
  isIntLike: (x) => ops.intValue(x) !== undefined || typeOf(x).lookup('__index__') !== undefined,
};

ops.setStrPercent((s, args) => percentFormat(s, args, percentHost));

// ───────────────────────── tabla de métodos ─────────────────────────

defMethods(S, {
  __repr__: ['self', (a: any) => strRepr(sv(a))],
  __str__: ['self', (a: any) => (typeof a === 'string' ? a : sv(a))],
  __hash__: ['self', (a: any) => strHash(sv(a))],
  __len__: ['self', (a: any) => strLen(sv(a))],
  __bool__: ['self', (a: any) => sv(a).length > 0],
  __contains__: ['self, item', (a: any, x: any) => {
    if (!ops.isStr(x)) throw typeError(`'in <string>' requires string as left operand, not ${typeOf(x).name}`);
    return sv(a).includes(ops.strValue(x));
  }],
  __iter__: ['self', (a: any) => new ops.StrIter(sv(a))],
  __getitem__: ['self, key', (a: any, k: any) => {
    const s = sv(a);
    if (k instanceof PySlice) {
      const n = strLen(s);
      const [start, stop, step] = ops.sliceIndices(k, n);
      const cs = hasAstral(s) ? chars(s) : null;
      if (step === 1) return start < stop ? (cs ? cs.slice(start, stop).join('') : s.slice(start, stop)) : '';
      let out = '';
      if (step > 0) for (let i = start; i < stop; i += step) out += cs ? cs[i] : s[i];
      else for (let i = start; i > stop; i += step) out += cs ? cs[i] : s[i];
      return out;
    }
    const iv = ops.toIndex(k, 'string indices must be integers, not \'' + typeOf(k).name + '\'');
    const n = strLen(s);
    const i = ops.normIndex(iv, n, 'string index out of range');
    return hasAstral(s) ? chars(s)[i] : s[i];
  }],
  __add__: ['self, other', (a: any, b: any) => {
    if (!ops.isStr(b)) throw typeError(`can only concatenate str (not "${typeOf(b).name}") to str`);
    return sv(a) + ops.strValue(b);
  }],
  __mul__: ['self, n', (a: any, n: any) => {
    const iv = ops.intValue(n) ?? (typeOf(n).lookup('__index__') !== undefined ? ops.toIndex(n) : undefined);
    if (iv === undefined) return NotImplemented;
    const k = typeof iv === 'bigint' ? (iv < 0n ? 0 : Infinity) : iv;
    if (k <= 0) return '';
    const s = sv(a);
    if (s.length * k > 2 ** 29) throw makeExc(E.MemoryError, []);
    return s.repeat(k);
  }],
  __rmul__: ['self, n', (a: any, n: any) => {
    const iv = ops.intValue(n) ?? (typeOf(n).lookup('__index__') !== undefined ? ops.toIndex(n) : undefined);
    if (iv === undefined) return NotImplemented;
    const k = typeof iv === 'bigint' ? (iv < 0n ? 0 : Infinity) : iv;
    if (k <= 0) return '';
    return sv(a).repeat(k);
  }],
  __mod__: ['self, args', (a: any, b: any) => percentFormat(sv(a), b, percentHost)],
  __eq__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? sv(a) === ops.strValue(b) : NotImplemented)],
  __ne__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? sv(a) !== ops.strValue(b) : NotImplemented)],
  __lt__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? cmpStr(sv(a), ops.strValue(b)) < 0 : NotImplemented)],
  __le__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? cmpStr(sv(a), ops.strValue(b)) <= 0 : NotImplemented)],
  __gt__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? cmpStr(sv(a), ops.strValue(b)) > 0 : NotImplemented)],
  __ge__: ['self, other', (a: any, b: any) => (ops.isStr(b) ? cmpStr(sv(a), ops.strValue(b)) >= 0 : NotImplemented)],
  __format__: ['self, spec', (a: any, spec: any) => ops.formatValue(sv(a), argStr(spec, '__format__'))],
  __sizeof__: ['self', (a: any) => 49 + sv(a).length],
  __getnewargs__: ['self', (a: any) => new PyTuple([sv(a)])],

  capitalize: ['self', (a: any) => {
    const s = sv(a);
    if (s === '') return s;
    const cs = chars(s);
    return cs[0].toUpperCase().length > 1 && cs[0] === 'ß' ? 'Ss' + cs.slice(1).join('').toLowerCase() : cs[0].toUpperCase() + cs.slice(1).join('').toLowerCase();
  }],
  casefold: ['self', (a: any) => sv(a).toLowerCase().replace(/ß/g, 'ss')],
  lower: ['self', (a: any) => sv(a).toLowerCase()],
  upper: ['self', (a: any) => sv(a).toUpperCase()],
  swapcase: ['self', (a: any) => {
    let out = '';
    for (const c of sv(a)) {
      const u = c.toUpperCase();
      out += c === u ? c.toLowerCase() : u;
    }
    return out;
  }],
  title: ['self', (a: any) => title(sv(a))],
  center: ['self, width, fillchar=', (a: any, w: any, f: any) => {
    const [s, width, fill] = padArgs(a, w, f);
    const n = strLen(s);
    if (width <= n) return s;
    const marg = width - n;
    const left = Math.floor(marg / 2) + (marg & width & 1);
    return fill.repeat(left) + s + fill.repeat(marg - left);
  }],
  ljust: ['self, width, fillchar=', (a: any, w: any, f: any) => {
    const [s, width, fill] = padArgs(a, w, f);
    const n = strLen(s);
    return width <= n ? s : s + fill.repeat(width - n);
  }],
  rjust: ['self, width, fillchar=', (a: any, w: any, f: any) => {
    const [s, width, fill] = padArgs(a, w, f);
    const n = strLen(s);
    return width <= n ? s : fill.repeat(width - n) + s;
  }],
  zfill: ['self, width', (a: any, w: any) => {
    const s = sv(a);
    const width = asIdx(w);
    const n = strLen(s);
    if (width <= n) return s;
    const pad = '0'.repeat(width - n);
    if (s[0] === '+' || s[0] === '-') return s[0] + pad + s.slice(1);
    return pad + s;
  }],
  count: ['self, sub, start=, end=', countImpl],
  find: ['self, sub, start=, end=', (a: any, s: any, x?: any, y?: any) => findImpl(a, s, x, y, false, 'find')],
  rfind: ['self, sub, start=, end=', (a: any, s: any, x?: any, y?: any) => findImpl(a, s, x, y, true, 'rfind')],
  index: ['self, sub, start=, end=', (a: any, s: any, x?: any, y?: any) => {
    const i = findImpl(a, s, x, y, false, 'index');
    if (i < 0) throw valueError('substring not found');
    return i;
  }],
  rindex: ['self, sub, start=, end=', (a: any, s: any, x?: any, y?: any) => {
    const i = findImpl(a, s, x, y, true, 'rindex');
    if (i < 0) throw valueError('substring not found');
    return i;
  }],
  startswith: ['self, prefix, start=, end=', (a: any, p: any, x?: any, y?: any) => startsEnds(a, p, x, y, false)],
  endswith: ['self, suffix, start=, end=', (a: any, p: any, x?: any, y?: any) => startsEnds(a, p, x, y, true)],
  replace: ['self, old, new, count=', (a: any, o: any, n: any, c?: any) => {
    const s = sv(a);
    const old = argStr(o, 'replace', 1);
    const nw = argStr(n, 'replace', 2);
    const cnt = c === undefined ? -1 : asIdx(c);
    if (cnt === 0) return s;
    if (old === '') {
      const cs = chars(s);
      let out = '';
      let k = 0;
      for (let i = 0; i <= cs.length; i++) {
        if (cnt < 0 || k < cnt) { out += nw; k++; }
        if (i < cs.length) out += cs[i];
      }
      return out;
    }
    if (cnt < 0) return s.split(old).join(nw);
    let out = '';
    let i = 0;
    let k = 0;
    while (k < cnt) {
      const j = s.indexOf(old, i);
      if (j < 0) break;
      out += s.slice(i, j) + nw;
      i = j + old.length;
      k++;
    }
    return out + s.slice(i);
  }],
  split: ['self, sep=, maxsplit=', (a: any, sep?: any, m?: any) => splitImpl(a, sep, m, false)],
  rsplit: ['self, sep=, maxsplit=', (a: any, sep?: any, m?: any) => splitImpl(a, sep, m, true)],
  splitlines: ['self, keepends=', (a: any, k?: any) => new PyList(splitlines(sv(a), k !== undefined && ops.truthy(k)))],
  strip: ['self, chars=', (a: any, c?: any) => stripChars(a, c, true, true)],
  lstrip: ['self, chars=', (a: any, c?: any) => stripChars(a, c, true, false)],
  rstrip: ['self, chars=', (a: any, c?: any) => stripChars(a, c, false, true)],
  removeprefix: ['self, prefix', (a: any, p: any) => {
    const s = sv(a);
    const q = argStr(p, 'removeprefix', 1);
    return s.startsWith(q) ? s.slice(q.length) : s;
  }],
  removesuffix: ['self, suffix', (a: any, p: any) => {
    const s = sv(a);
    const q = argStr(p, 'removesuffix', 1);
    return q !== '' && s.endsWith(q) ? s.slice(0, s.length - q.length) : s;
  }],
  partition: ['self, sep', (a: any, sep: any) => {
    const s = sv(a);
    const d = argStr(sep, 'partition', 1);
    if (d === '') throw valueError('empty separator');
    const i = s.indexOf(d);
    return i < 0 ? new PyTuple([s, '', '']) : new PyTuple([s.slice(0, i), d, s.slice(i + d.length)]);
  }],
  rpartition: ['self, sep', (a: any, sep: any) => {
    const s = sv(a);
    const d = argStr(sep, 'rpartition', 1);
    if (d === '') throw valueError('empty separator');
    const i = s.lastIndexOf(d);
    return i < 0 ? new PyTuple(['', '', s]) : new PyTuple([s.slice(0, i), d, s.slice(i + d.length)]);
  }],
  join: ['self, iterable', (a: any, it: any) => {
    const s = sv(a);
    const items = it instanceof PyList || it instanceof PyTuple ? it.a : ops.iterToArray(it);
    const parts: string[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (typeof x === 'string') parts[i] = x;
      else if (x instanceof PyBox && typeof x.value === 'string') parts[i] = x.value;
      else throw typeError(`sequence item ${i}: expected str instance, ${typeOf(x).name} found`);
    }
    return parts.join(s);
  }],
  expandtabs: ['self, tabsize=', (a: any, t?: any) => {
    const ts = t === undefined ? 8 : asIdx(t);
    let out = '';
    let col = 0;
    for (const c of sv(a)) {
      if (c === '\t') {
        if (ts > 0) { const n = ts - (col % ts); out += ' '.repeat(n); col += n; }
      } else if (c === '\n' || c === '\r') { out += c; col = 0; }
      else { out += c; col++; }
    }
    return out;
  }],
  isalpha: ['self', (a: any) => RE_ALPHA.test(sv(a))],
  isalnum: ['self', (a: any) => RE_ALNUM.test(sv(a))],
  isdecimal: ['self', (a: any) => RE_DECIMAL.test(sv(a))],
  isdigit: ['self', (a: any) => RE_DIGIT.test(sv(a))],
  isnumeric: ['self', (a: any) => RE_NUMERIC.test(sv(a))],
  isascii: ['self', (a: any) => /^[\x00-\x7f]*$/.test(sv(a))],
  isidentifier: ['self', (a: any) => RE_IDENT.test(sv(a))],
  isspace: ['self', (a: any) => { const s = sv(a); return s.length > 0 && [...s].every(isWs); }],
  isprintable: ['self', (a: any) => [...sv(a)].every((c) => isPrintableCp(c.codePointAt(0)!) || c === ' ')],
  islower: ['self', (a: any) => { const s = sv(a); return s !== s.toUpperCase() || (s === s.toUpperCase() && false) ? s === s.toLowerCase() && [...s].some(isCased) : false; }],
  isupper: ['self', (a: any) => { const s = sv(a); return [...s].some(isCased) && s === s.toUpperCase() && s !== s.toLowerCase(); }],
  istitle: ['self', (a: any) => {
    const s = sv(a);
    let cased = false;
    let prev = false;
    for (const c of s) {
      const up = c !== c.toLowerCase() && c === c.toUpperCase();
      const low = c !== c.toUpperCase() && c === c.toLowerCase();
      if (up) { if (prev) return false; prev = true; cased = true; }
      else if (low) { if (!prev) return false; prev = true; cased = true; }
      else prev = false;
    }
    return cased;
  }],
  encode: ['self, encoding=, errors=', (a: any, e?: any, er?: any) => {
    const enc = e === undefined ? 'utf-8' : argStr(e, 'encode', 1);
    const errs = er === undefined ? 'strict' : argStr(er, 'encode', 2);
    return new PyBytes(encodeStr(sv(a), enc, errs), bytesType);
  }],
  format: ['self, *args, **kwargs', (a: any, args: any, kw: any) => {
    const st = { args: tupleArr(args), kw: kwMap(kw), auto: 0, manual: false };
    return formatTemplate(sv(a), st, 0);
  }],
  format_map: ['self, mapping', (a: any, m: any) => formatTemplate(sv(a), { args: [], kw: null, auto: 0, manual: false }, 0, m)],
  translate: ['self, table', (a: any, tbl: any) => {
    let out = '';
    for (const c of sv(a)) {
      let r: any;
      try {
        r = ops.getitem(tbl, c.codePointAt(0)!);
      } catch (e) {
        if (e instanceof Error) throw e;
        if ((e as any).cls && ops.isInstance(e, E.LookupError)) { out += c; continue; }
        throw e;
      }
      if (r === null) continue;
      if (ops.isStr(r)) out += ops.strValue(r);
      else {
        const iv = ops.intValue(r);
        if (iv === undefined) throw typeError('character mapping must return integer, None or str');
        out += String.fromCodePoint(Number(iv));
      }
    }
    return out;
  }],
});
S.dict!.set('maketrans', new PyStaticMethod(staticMethodType, mkNative('maketrans', 'x, y=, z=', (x: any, y?: any, z?: any) => {
  const d = new PyDict();
  if (y === undefined) {
    if (!(x instanceof PyDict)) throw typeError('if you give only one argument to maketrans it must be a dict');
    for (const e of x.m.values()) {
      const k = e.k;
      if (ops.isStr(k)) {
        const ks = ops.strValue(k);
        if (strLen(ks) !== 1) throw valueError('string keys in translate table must be of length 1');
        d.set(ks.codePointAt(0)!, e.v);
      } else d.set(k, e.v);
    }
    return d;
  }
  const xs = argStr(x, 'maketrans', 1);
  const ys = argStr(y, 'maketrans', 2);
  const xc = chars(xs);
  const yc = chars(ys);
  if (xc.length !== yc.length) throw valueError('the first two maketrans arguments must have equal length');
  xc.forEach((c, i) => d.set(c.codePointAt(0)!, yc[i].codePointAt(0)!));
  if (z !== undefined) for (const c of chars(argStr(z, 'maketrans', 3))) d.set(c.codePointAt(0)!, null);
  return d;
}, { owner: 'str' })));
S.dict!.set('__doc__', 'str(object=\'\') -> str');
void [formatFloat, asciiOf, PyObject, PyType, PyClassMethod, classMethodType];
export { decodeBytes, formatTemplate };
