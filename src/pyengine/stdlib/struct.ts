/**
 * Módulo `struct` (empaquetado binario) y utilidades de importación (`_imp_support`).
 */
import { PyBytes, PyFloat, PyList, PyModule, PyObject, PyProperty, PyTuple, PyType } from '../runtime/objects';
import { bytesType, newNativeType, objectType, propertyType } from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { makeExc, overflowError, typeError } from '../runtime/errors';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mfn } from './helpers';
import { asStr } from '../runtime/util';
import { normBig, toBig } from '../runtime/numeric';
import { encodeUtf8 } from '../runtime/interp';

interface Item {
  code: string;
  count: number;
  size: number;
  offset: number;
}

const STD: Record<string, number> = { x: 1, c: 1, b: 1, B: 1, '?': 1, h: 2, H: 2, i: 4, I: 4, l: 4, L: 4, q: 8, Q: 8, e: 2, f: 4, d: 8, s: 1, p: 1, n: 8, N: 8, P: 8 };
const NAT: Record<string, number> = { ...STD, l: 8, L: 8 };

let structError: PyType;

function parse(fmt: string): { items: Item[]; size: number; little: boolean; native: boolean } {
  let little = true;
  let native = true;
  let i = 0;
  if ('@=<>!'.includes(fmt[0] ?? '')) {
    native = fmt[0] === '@';
    little = fmt[0] !== '>' && fmt[0] !== '!';
    i = 1;
  }
  const table = native ? NAT : STD;
  const items: Item[] = [];
  let offset = 0;
  while (i < fmt.length) {
    if (/\s/.test(fmt[i])) { i++; continue; }
    let num = '';
    while (/\d/.test(fmt[i] ?? '')) num += fmt[i++];
    const code = fmt[i++];
    if (code === undefined) throw makeExc(structError, ['repeat count given without format specifier']);
    const sz = table[code];
    if (sz === undefined) throw makeExc(structError, ['bad char in struct format']);
    const count = num === '' ? 1 : parseInt(num, 10);
    if (native && sz > 1 && 'hHiIlLqQnNPefd'.includes(code)) offset = Math.ceil(offset / sz) * sz;
    items.push({ code, count, size: sz, offset });
    offset += code === 's' || code === 'p' ? count : sz * count;
  }
  return { items, size: offset, little, native };
}

function pack(fmt: string, vals: any[], buf?: Uint8Array, at = 0): Uint8Array {
  const { items, size, little } = parse(fmt);
  const need = items.reduce((n, it) => n + (it.code === 's' || it.code === 'p' ? 1 : it.code === 'x' ? 0 : it.count), 0);
  if (vals.length !== need) throw makeExc(structError, [`pack expected ${need} items for packing (got ${vals.length})`]);
  const out = buf ?? new Uint8Array(size);
  const dv = new DataView(out.buffer, out.byteOffset);
  let vi = 0;
  for (const it of items) {
    if (it.code === 's' || it.code === 'p') {
      const v = vals[vi++];
      if (!(v instanceof PyBytes)) throw makeExc(structError, [`argument for '${it.code}' must be a bytes object`]);
      for (let k = 0; k < it.count; k++) out[at + it.offset + k] = k < v.b.length ? v.b[k] : 0;
      continue;
    }
    for (let c = 0; c < it.count; c++) {
      const o = at + it.offset + c * it.size;
      if (it.code === 'x') continue;
      const v = vals[vi++];
      switch (it.code) {
        case 'c':
          if (!(v instanceof PyBytes) || v.b.length !== 1) throw makeExc(structError, ['char format requires a bytes object of length 1']);
          out[o] = v.b[0];
          break;
        case '?': out[o] = ops.truthy(v) ? 1 : 0; break;
        case 'e': case 'f': case 'd': {
          const x = v instanceof PyFloat ? v.v : Number(ops.toIndex(v));
          if (it.code === 'd') dv.setFloat64(o, x, little);
          else if (it.code === 'f') dv.setFloat32(o, x, little);
          else dv.setUint16(o, f16(x), little);
          break;
        }
        default: {
          if (v instanceof PyFloat) throw makeExc(structError, ["required argument is not an integer"]);
          let iv: bigint;
          try {
            iv = toBig(ops.toIndex(v, 'required argument is not an integer'));
          } catch {
            throw makeExc(structError, ['required argument is not an integer']);
          }
          const signed = 'bhilqn'.includes(it.code);
          const bits = BigInt(it.size * 8);
          const lo = signed ? -(1n << (bits - 1n)) : 0n;
          const hi = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
          if (iv < lo || iv > hi) {
            throw makeExc(structError, [signed ? `'${it.code}' format requires ${lo} <= number <= ${hi}` : `'${it.code}' format requires 0 <= number <= ${hi}`]);
          }
          let u = BigInt.asUintN(it.size * 8, iv);
          for (let k = 0; k < it.size; k++) {
            out[o + (little ? k : it.size - 1 - k)] = Number(u & 255n);
            u >>= 8n;
          }
        }
      }
    }
  }
  return out;
}

function f16(x: number): number {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  f[0] = x;
  const b = u[0];
  const sign = (b >>> 16) & 0x8000;
  let exp = ((b >>> 23) & 0xff) - 127 + 15;
  let man = b & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00 | (man ? 0x200 : 0);
  man >>>= 13;
  return sign | (exp << 10) | man;
}
function f16d(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}

function unpack(fmt: string, data: Uint8Array, at = 0, exact = true): any[] {
  const { items, size, little } = parse(fmt);
  if (exact ? data.length - at !== size : data.length - at < size) {
    throw makeExc(structError, [exact ? `unpack requires a buffer of ${size} bytes` : `unpack_from requires a buffer of at least ${size + at} bytes for unpacking ${size} bytes at offset ${at} (actual buffer size is ${data.length})`]);
  }
  const dv = new DataView(data.buffer, data.byteOffset);
  const out: any[] = [];
  for (const it of items) {
    if (it.code === 's' || it.code === 'p') {
      out.push(new PyBytes(data.slice(at + it.offset, at + it.offset + it.count), bytesType));
      continue;
    }
    for (let c = 0; c < it.count; c++) {
      const o = at + it.offset + c * it.size;
      switch (it.code) {
        case 'x': break;
        case 'c': out.push(new PyBytes(data.slice(o, o + 1), bytesType)); break;
        case '?': out.push(data[o] !== 0); break;
        case 'f': out.push(new PyFloat(dv.getFloat32(o, little))); break;
        case 'd': out.push(new PyFloat(dv.getFloat64(o, little))); break;
        case 'e': out.push(new PyFloat(f16d(dv.getUint16(o, little)))); break;
        default: {
          let u = 0n;
          for (let k = 0; k < it.size; k++) u |= BigInt(data[o + (little ? k : it.size - 1 - k)]) << BigInt(8 * k);
          const signed = 'bhilqn'.includes(it.code);
          out.push(normBig(signed ? BigInt.asIntN(it.size * 8, u) : u));
        }
      }
    }
  }
  return out;
}

const bytesArg = (x: any): Uint8Array => {
  if (x instanceof PyBytes) return x.b;
  if (x instanceof PyObject && (x as any).b instanceof Uint8Array) return (x as any).b;
  if (x instanceof PyObject && Array.isArray((x as any).b)) return Uint8Array.from((x as any).b);
  throw typeError(`a bytes-like object is required, not '${(require('../runtime/builtin_types') as typeof import('../runtime/builtin_types')).typeOf(x).name}'`);
};

registerNative('struct', (I: Interp, m: PyModule) => {
  structError = newNativeType('error', 'struct', [E.Exception]);
  m.dict!.set('error', structError);
  const fmtOf = (f: any): string => (f instanceof PyBytes ? String.fromCharCode(...f.b) : asStr(f, 'Struct() argument 1'));
  mfn(m, 'calcsize', 'format, /', (f: any) => parse(fmtOf(f)).size);
  mfn(m, 'pack', 'format, /, *v', (f: any, v: any) => new PyBytes(pack(fmtOf(f), v.a), bytesType));
  mfn(m, 'unpack', 'format, buffer, /', (f: any, b: any) => new PyTuple(unpack(fmtOf(f), bytesArg(b))));
  mfn(m, 'unpack_from', 'format, /, buffer, offset=', (f: any, b: any, off?: any) => new PyTuple(unpack(fmtOf(f), bytesArg(b), off === undefined ? 0 : Number(ops.toIndex(off)), false)));
  mfn(m, 'pack_into', 'format, buffer, offset, /, *v', (f: any, buf: any, off: any, v: any) => {
    const target = (buf as any).b;
    const tmp = pack(fmtOf(f), v.a);
    const o = Number(ops.toIndex(off));
    for (let i = 0; i < tmp.length; i++) target[o + i] = tmp[i];
    return null;
  });
  mfn(m, 'iter_unpack', 'format, buffer, /', (f: any, b: any) => {
    const fmt = fmtOf(f);
    const sz = parse(fmt).size;
    const data = bytesArg(b);
    const out: any[] = [];
    for (let o = 0; o + sz <= data.length; o += sz) out.push(new PyTuple(unpack(fmt, data, o, false)));
    return new ops.ListIter(new PyList(out));
  });
  const S = newNativeType('Struct', 'struct', [objectType]);
  S.dict!.set('__new__', mkNative('__new__', 'cls, format', (cls: any, f: any) => {
    const o = new PyObject(cls);
    (o as any).fmt = fmtOf(f);
    parse((o as any).fmt);
    return o;
  }, { owner: 'Struct' }));
  const sm: Record<string, [string, (...a: any[]) => any]> = {
    pack: ['self, *v', (s: any, v: any) => new PyBytes(pack(s.fmt, v.a), bytesType)],
    unpack: ['self, buffer', (s: any, b: any) => new PyTuple(unpack(s.fmt, bytesArg(b)))],
    unpack_from: ['self, buffer, offset=', (s: any, b: any, off?: any) => new PyTuple(unpack(s.fmt, bytesArg(b), off === undefined ? 0 : Number(ops.toIndex(off)), false))],
    iter_unpack: ['self, buffer', (s: any, b: any) => {
      const sz = parse(s.fmt).size;
      const data = bytesArg(b);
      const out: any[] = [];
      for (let o = 0; o + sz <= data.length; o += sz) out.push(new PyTuple(unpack(s.fmt, data, o, false)));
      return new ops.ListIter(new PyList(out));
    }],
  };
  for (const k of Object.keys(sm)) S.dict!.set(k, mkNative(k, sm[k][0], sm[k][1], { method: true, owner: 'Struct' }));
  for (const [nm, get] of [['format', (s: any) => s.fmt], ['size', (s: any) => parse(s.fmt).size]] as const) {
    const p = new PyProperty(propertyType);
    p.name = nm;
    p.fget = mkNative(nm, 'self', get, { method: true });
    S.dict!.set(nm, p);
  }
  m.dict!.set('Struct', S);
  void [I, overflowError, encodeUtf8];
});

registerNative('_imp_support', (I: Interp, m: PyModule) => {
  mfn(m, 'reload', 'module', (mod: any) => {
    const { reloadModule } = require('../runtime/modules') as typeof import('../runtime/modules');
    return reloadModule(I, mod);
  });
});

// ───────────────────────── binascii ─────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

registerNative('binascii', (I: Interp, m: PyModule) => {
  const err = newNativeType('Error', 'binascii', [E.ValueError]);
  const incomplete = newNativeType('Incomplete', 'binascii', [E.Exception]);
  m.dict!.set('Error', err);
  m.dict!.set('Incomplete', incomplete);
  const bytes = (x: any): Uint8Array => bytesArg(x);
  const mk = (a: ArrayLike<number>): PyBytes => new PyBytes(Uint8Array.from(a as any), bytesType);
  const hexl = (d: any, sep?: any, per?: any): PyBytes => {
    const b = bytes(d);
    const parts = Array.from(b).map((x) => x.toString(16).padStart(2, '0'));
    if (sep === undefined || sep === null) return mk(Array.from(parts.join('')).map((c) => c.charCodeAt(0)));
    const sp = sep instanceof PyBytes ? String.fromCharCode(...sep.b) : asStr(sep);
    const n = per === undefined ? 1 : Number(ops.toIndex(per));
    const groups: string[] = [];
    for (let i = 0; i < parts.length; i += n) groups.push(parts.slice(i, i + n).join(''));
    return mk(Array.from(groups.join(sp)).map((c) => c.charCodeAt(0)));
  };
  const unhex = (d: any): PyBytes => {
    const t = d instanceof PyBytes ? String.fromCharCode(...d.b) : asStr(d);
    if (t.length % 2) throw makeExc(err, ['Odd-length string']);
    if (!/^[0-9a-fA-F]*$/.test(t)) throw makeExc(err, ['Non-hexadecimal digit found']);
    const out: number[] = [];
    for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
    return mk(out);
  };
  for (const n of ['hexlify', 'b2a_hex']) mfn(m, n, 'data, sep=, bytes_per_sep=', hexl);
  for (const n of ['unhexlify', 'a2b_hex']) mfn(m, n, 'hexstr', unhex);
  mfn(m, 'b2a_base64', 'data, /, *, newline=', (d: any, nl?: any) => {
    const b = bytes(d);
    let out = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
    }
    if (nl === undefined || ops.truthy(nl)) out += '\n';
    return mk(Array.from(out).map((c) => c.charCodeAt(0)));
  });
  mfn(m, 'a2b_base64', 'data, /, *, strict_mode=', (d: any) => {
    const t = (d instanceof PyBytes ? String.fromCharCode(...d.b) : asStr(d)).replace(/[^A-Za-z0-9+/=]/g, '');
    const body = t.replace(/=+$/, '');
    if (body.length % 4 === 1) throw makeExc(err, [`Invalid base64-encoded string: number of data characters (${body.length}) cannot be 1 more than a multiple of 4`]);
    if (t.length % 4 !== 0 && /=/.test(t)) throw makeExc(err, ['Incorrect padding']);
    if (t.length % 4 !== 0) throw makeExc(err, ['Incorrect padding']);
    const out: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const c of body) {
      acc = (acc << 6) | B64.indexOf(c);
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return mk(out);
  });
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  mfn(m, 'crc32', 'data, crc=, /', (d: any, crc?: any) => {
    let c = (crc === undefined ? 0 : Number(ops.toIndex(crc))) ^ 0xffffffff;
    for (const b of bytes(d)) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  });
  void I;
});
