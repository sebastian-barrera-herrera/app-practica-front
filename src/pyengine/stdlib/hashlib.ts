/**
 * `hashlib` (md5, sha1, sha224/256, sha384/512) y utilidades de hash en TypeScript puro.
 */
import { PyBytes, PyByteArray, PyObject, PyModule, PyProperty, PyType } from '../runtime/objects';
import { bytesType, newNativeType, objectType, propertyType } from '../runtime/builtin_types';
import { typeError, valueError } from '../runtime/errors';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mfn } from './helpers';
import { encodeStr } from '../runtime/t_str';
import { asStr } from '../runtime/util';

const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

function padMessage(msg: Uint8Array, block: number, lenBytes: number, bigEndian: boolean): Uint8Array {
  const bits = BigInt(msg.length) * 8n;
  let total = msg.length + 1 + lenBytes;
  total = Math.ceil(total / block) * block;
  const out = new Uint8Array(total);
  out.set(msg);
  out[msg.length] = 0x80;
  for (let i = 0; i < lenBytes; i++) {
    const byte = Number((bits >> BigInt(8 * i)) & 0xffn);
    if (bigEndian) out[total - 1 - i] = byte;
    else out[total - lenBytes + i] = byte;
  }
  return out;
}

export function md5(msg: Uint8Array): Uint8Array {
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const m = padMessage(msg, 64, 8, false);
  const dv = new DataView(m.buffer);
  for (let off = 0; off < m.length; off += 64) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + dv.getUint32(off + g * 4, true)) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => ov.setUint32(i * 4, v >>> 0, true));
  return out;
}

export function sha1(msg: Uint8Array): Uint8Array {
  let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
  const m = padMessage(msg, 64, 8, true);
  const dv = new DataView(m.buffer);
  const w = new Array<number>(80);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc | 0; }
      else { f = b ^ c ^ d; k = 0xca62c1d6 | 0; }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
  return out;
}

const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256(msg: Uint8Array, is224 = false): Uint8Array {
  const h = is224
    ? [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4]
    : [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const m = padMessage(msg, 64, 8, true);
  const dv = new DataView(m.buffer);
  const w = new Array<number>(64);
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  const n = is224 ? 7 : 8;
  const out = new Uint8Array(n * 4);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < n; i++) ov.setUint32(i * 4, h[i] >>> 0);
  return out;
}

const K512 = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
].map((x) => BigInt('0x' + x));

export function sha512(msg: Uint8Array, is384 = false): Uint8Array {
  const M = (1n << 64n) - 1n;
  const h = (is384
    ? ['cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939', '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4']
    : ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179']
  ).map((x) => BigInt('0x' + x));
  const m = padMessage(msg, 128, 16, true);
  const dv = new DataView(m.buffer);
  const rr = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & M;
  const w = new Array<bigint>(80);
  for (let off = 0; off < m.length; off += 128) {
    for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(off + i * 8);
    for (let i = 16; i < 80; i++) {
      const s0 = rr(w[i - 15], 1n) ^ rr(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 = rr(w[i - 2], 19n) ^ rr(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i++) {
      const S1 = rr(e, 14n) ^ rr(e, 18n) ^ rr(e, 41n);
      const ch = (e & f) ^ (~e & M & g);
      const t1 = (hh + S1 + ch + K512[i] + w[i]) & M;
      const S0 = rr(a, 28n) ^ rr(a, 34n) ^ rr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M;
      hh = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + add[i]) & M;
  }
  const n = is384 ? 6 : 8;
  const out = new Uint8Array(n * 8);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < n; i++) ov.setBigUint64(i * 8, h[i]);
  return out;
}

const ALGOS: Record<string, { fn: (m: Uint8Array) => Uint8Array; block: number; size: number }> = {
  md5: { fn: md5, block: 64, size: 16 },
  sha1: { fn: sha1, block: 64, size: 20 },
  sha224: { fn: (m) => sha256(m, true), block: 64, size: 28 },
  sha256: { fn: sha256, block: 64, size: 32 },
  sha384: { fn: (m) => sha512(m, true), block: 128, size: 48 },
  sha512: { fn: sha512, block: 128, size: 64 },
};

export function hashBytes(name: string, data: Uint8Array): Uint8Array {
  return ALGOS[name].fn(data);
}

const hex = (b: Uint8Array): string => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

function toU8(x: any, what = 'Strings must be encoded before hashing'): Uint8Array {
  if (x instanceof PyBytes) return x.b;
  if (x instanceof PyByteArray) return Uint8Array.from(x.b);
  if (ops.isStr(x)) throw typeError(what);
  throw typeError(`object supporting the buffer API required`);
}

class HashObj extends PyObject {
  chunks: Uint8Array[] = [];
  constructor(cls: PyType, public algo: string) {
    super(cls);
  }
  data(): Uint8Array {
    let n = 0;
    for (const c of this.chunks) n += c.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    return out;
  }
}

registerNative('hashlib', (I: Interp, m: PyModule) => {
  const t = newNativeType('HASH', '_hashlib', [objectType]);
  const methods: Record<string, [string, (...a: any[]) => any]> = {
    update: ['self, data', (h: HashObj, d: any) => { h.chunks.push(toU8(d).slice()); return null; }],
    digest: ['self', (h: HashObj) => new PyBytes(ALGOS[h.algo].fn(h.data()), bytesType)],
    hexdigest: ['self', (h: HashObj) => hex(ALGOS[h.algo].fn(h.data()))],
    copy: ['self', (h: HashObj) => { const c = new HashObj(t, h.algo); c.chunks = h.chunks.slice(); return c; }],
    __repr__: ['self', (h: HashObj) => `<${h.algo} _hashlib.HASH object @ ${I.hexId(h)}>`],
  };
  for (const k of Object.keys(methods)) t.dict!.set(k, mkNative(k, methods[k][0], methods[k][1], { method: true, owner: 'HASH' }));
  const prop = (name: string, get: (h: HashObj) => any): void => {
    const p = new PyProperty(propertyType);
    p.name = name;
    p.fget = mkNative(name, 'self', get, { method: true });
    t.dict!.set(name, p);
  };
  prop('name', (h) => h.algo);
  prop('digest_size', (h) => ALGOS[h.algo].size);
  prop('block_size', (h) => ALGOS[h.algo].block);
  const make = (algo: string, data?: any): HashObj => {
    const h = new HashObj(t, algo);
    if (data !== undefined && data !== null) h.chunks.push(toU8(data).slice());
    return h;
  };
  for (const algo of Object.keys(ALGOS)) mfn(m, algo, 'data=, *, usedforsecurity=', (d?: any) => make(algo, d));
  mfn(m, 'new', 'name, data=, *, usedforsecurity=', (name: any, d?: any) => {
    const n = asStr(name).toLowerCase().replace('-', '');
    if (!ALGOS[n]) throw valueError(`unsupported hash type ${asStr(name)}`);
    return make(n, d);
  });
  m.dict!.set('algorithms_guaranteed', ops.callObj(require('../runtime/builtin_types').frozenSetType, [new (require('../runtime/objects').PyList)(Object.keys(ALGOS))]));
  m.dict!.set('algorithms_available', m.dict!.get('algorithms_guaranteed'));
  mfn(m, 'pbkdf2_hmac', 'hash_name, password, salt, iterations, dklen=', (hn: any, pw: any, salt: any, it: any, dk?: any) => {
    const name = asStr(hn).toLowerCase();
    const a = ALGOS[name];
    if (!a) throw valueError(`unsupported hash type ${name}`);
    const key = toU8(pw);
    const hmac = (k: Uint8Array, msg: Uint8Array): Uint8Array => {
      let kk = k;
      if (kk.length > a.block) kk = a.fn(kk);
      const ipad = new Uint8Array(a.block).fill(0x36);
      const opad = new Uint8Array(a.block).fill(0x5c);
      for (let i = 0; i < kk.length; i++) { ipad[i] ^= kk[i]; opad[i] ^= kk[i]; }
      const inner = a.fn(Uint8Array.from([...ipad, ...msg]));
      return a.fn(Uint8Array.from([...opad, ...inner]));
    };
    const iters = Number(ops.toIndex(it));
    const len = dk === undefined || dk === null ? a.size : Number(ops.toIndex(dk));
    const out: number[] = [];
    for (let block = 1; out.length < len; block++) {
      let u = hmac(key, Uint8Array.from([...toU8(salt), (block >>> 24) & 255, (block >>> 16) & 255, (block >>> 8) & 255, block & 255]));
      const t0 = Uint8Array.from(u);
      for (let i = 1; i < iters; i++) {
        u = hmac(key, u);
        for (let j = 0; j < t0.length; j++) t0[j] ^= u[j];
      }
      out.push(...t0);
    }
    return new PyBytes(Uint8Array.from(out.slice(0, len)), bytesType);
  });
  void encodeStr;
});

/** utilidad para `random.seed(str)`: sha512 del texto en UTF-8 (versión 2) */
export function sha512Bytes(data: Uint8Array): Uint8Array {
  return sha512(data);
}
