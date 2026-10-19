/**
 * `bytes`, `bytearray` y un `memoryview` mínimo.
 */
import { PyByteArray, PyBytes, PyClassMethod, PyList, PyObject, PySlice, PyTuple, PyType } from './objects';
import {
  NotImplemented, byteArrayType, bytesIterType, bytesType, classMethodType, memoryViewType, typeOf,
} from './builtin_types';
import { E } from './exc_types';
import { indexError, makeExc, typeError, valueError } from './errors';
import { callObj } from './call';
import * as ops from './ops';
import { bytesRepr } from './fmt';
import { defMethods, mkNative } from './native';
import { asIdx } from './util';
import { decodeBytes, encodeStr } from './t_str';

type BB = PyBytes | PyByteArray;
const isBB = (x: any): x is BB => x instanceof PyBytes || x instanceof PyByteArray;
const bytesOf = (x: any): number[] | Uint8Array => {
  if (x instanceof PyBytes) return x.b;
  if (x instanceof PyByteArray) return x.b;
  if (x instanceof PyObject && x.cls === memoryViewType) return (x as any).src;
  throw typeError(`a bytes-like object is required, not '${typeOf(x).name}'`);
};
const mkBytes = (a: ArrayLike<number>, cls: PyType = bytesType): PyBytes => new PyBytes(Uint8Array.from(a as any), cls);
const mkBA = (a: number[], cls: PyType = byteArrayType): PyByteArray => new PyByteArray(a, cls);

function toByteList(x: any, what: string): number[] {
  if (isBB(x)) return Array.from(x.b);
  if (ops.isStr(x)) throw typeError('string argument without an encoding');
  const iv = ops.intValue(x);
  if (iv !== undefined) {
    const n = Number(iv);
    if (n < 0) throw valueError('negative count');
    return new Array(n).fill(0);
  }
  const out: number[] = [];
  for (const v of ops.iterToArray(x)) {
    const k = ops.toIndex(v, `'${typeOf(v).name}' object cannot be interpreted as an integer`);
    if (typeof k === 'bigint' || k < 0 || k > 255) throw valueError('bytes must be in range(0, 256)');
    out.push(k);
  }
  return out;
}

function ctor(cls: PyType, mutable: boolean): (c: any, x?: any, enc?: any, errs?: any) => any {
  return (c: any, x?: any, enc?: any, errs?: any) => {
    let data: number[];
    if (x === undefined) data = [];
    else if (ops.isStr(x)) {
      if (enc === undefined) throw typeError('string argument without an encoding');
      data = Array.from(encodeStr(ops.strValue(x), String(enc), errs === undefined ? 'strict' : String(errs)));
    } else if (x instanceof PyObject && !isBB(x) && typeOf(x).lookup('__bytes__') !== undefined && !mutable) {
      const r = callObj(typeOf(x).lookup('__bytes__'), [x]);
      data = Array.from((r as PyBytes).b);
    } else data = toByteList(x, 'bytes');
    void cls;
    return mutable ? mkBA(data, c) : mkBytes(data, c);
  };
}
bytesType.dict!.set('__new__', mkNative('__new__', 'cls, source=, encoding=, errors=', ctor(bytesType, false), { owner: 'bytes' }));
byteArrayType.alloc = (cls) => new PyByteArray([], cls);
byteArrayType.dict!.set('__init__', mkNative('__init__', 'self, source=, encoding=, errors=', (self: any, x?: any, enc?: any, errs?: any) => {
  const r = ctor(byteArrayType, true)(byteArrayType, x, enc, errs) as PyByteArray;
  self.b = r.b;
  return null;
}, { method: true, owner: 'bytearray' }));

function find(hay: ArrayLike<number>, needle: ArrayLike<number>, start: number, end: number, rev: boolean): number {
  const n = needle.length;
  if (rev) {
    for (let i = end - n; i >= start; i--) {
      let ok = true;
      for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  for (let i = start; i + n <= end; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function sub(x: any): number[] | Uint8Array {
  const iv = ops.intValue(x);
  if (iv !== undefined) {
    const n = Number(iv);
    if (n < 0 || n > 255) throw valueError('byte must be in range(0, 256)');
    return [n];
  }
  return bytesOf(x);
}

function rng(len: number, s: any, e: any): [number, number] {
  let a = s === undefined || s === null ? 0 : asIdx(s);
  let b = e === undefined || e === null ? len : asIdx(e);
  if (a < 0) a = Math.max(0, a + len);
  if (b < 0) b = Math.max(0, b + len);
  if (b > len) b = len;
  return [a, b];
}

const WS = new Set([32, 9, 10, 13, 11, 12]);

function same(self: any, a: number[]): BB {
  return self instanceof PyByteArray ? mkBA(a) : mkBytes(a);
}

function stripImpl(self: any, chars: any, l: boolean, r: boolean): BB {
  const a = Array.from(bytesOf(self));
  const set = chars === undefined || chars === null ? WS : new Set(Array.from(bytesOf(chars)));
  let i = 0;
  let j = a.length;
  if (l) while (i < j && set.has(a[i])) i++;
  if (r) while (j > i && set.has(a[j - 1])) j--;
  return same(self, a.slice(i, j));
}

function splitImpl(self: any, sep: any, max: any, right: boolean): PyList {
  const a = Array.from(bytesOf(self));
  const m = max === undefined ? -1 : asIdx(max);
  const out: number[][] = [];
  if (sep === undefined || sep === null) {
    let i = 0;
    while (i < a.length) {
      while (i < a.length && WS.has(a[i])) i++;
      if (i >= a.length) break;
      if (m >= 0 && out.length >= m) { out.push(a.slice(i)); i = a.length; break; }
      let j = i;
      while (j < a.length && !WS.has(a[j])) j++;
      out.push(a.slice(i, j));
      i = j;
    }
    return new PyList(out.map((x) => same(self, x)));
  }
  const d = Array.from(bytesOf(sep));
  if (d.length === 0) throw valueError('empty separator');
  let i = 0;
  for (;;) {
    if (m >= 0 && out.length >= m) break;
    const j = find(a, d, i, a.length, false);
    if (j < 0) break;
    out.push(a.slice(i, j));
    i = j + d.length;
  }
  out.push(a.slice(i));
  void right;
  return new PyList(out.map((x) => same(self, x)));
}

const methods: Record<string, [string, (...a: any[]) => any]> = {
  __repr__: ['self', (b: any) => (b instanceof PyByteArray ? `bytearray(${bytesRepr(b.b)})` : bytesRepr(b.b))],
  __str__: ['self', (b: any) => (b instanceof PyByteArray ? `bytearray(${bytesRepr(b.b)})` : bytesRepr(b.b))],
  __len__: ['self', (b: any) => bytesOf(b).length],
  __bool__: ['self', (b: any) => bytesOf(b).length > 0],
  __iter__: ['self', (b: any) => new ops.BytesIter(bytesOf(b))],
  __contains__: ['self, x', (b: any, x: any) => find(bytesOf(b), sub(x), 0, bytesOf(b).length, false) >= 0],
  __getitem__: ['self, key', (b: any, k: any) => {
    const a = bytesOf(b);
    if (k instanceof PySlice) {
      const arr = ops.sliceList(Array.from(a), k);
      return same(b, arr);
    }
    const i = ops.normIndex(ops.toIndex(k, `byte indices must be integers or slices, not ${typeOf(k).name}`), a.length, 'index out of range');
    return a[i];
  }],
  __add__: ['self, other', (a: any, o: any) => {
    if (!isBB(o) && !(o instanceof PyObject && o.cls === memoryViewType)) throw typeError(`can't concat ${typeOf(o).name} to ${typeOf(a).name}`);
    return same(a, [...bytesOf(a), ...bytesOf(o)]);
  }],
  __mul__: ['self, n', (a: any, n: any) => {
    const iv = ops.intValue(n);
    if (iv === undefined) return NotImplemented;
    const out: number[] = [];
    for (let i = 0; i < Number(iv); i++) out.push(...bytesOf(a));
    return same(a, out);
  }],
  __rmul__: ['self, n', (a: any, n: any) => {
    const iv = ops.intValue(n);
    if (iv === undefined) return NotImplemented;
    const out: number[] = [];
    for (let i = 0; i < Number(iv); i++) out.push(...bytesOf(a));
    return same(a, out);
  }],
  __mod__: ['self, args', (a: any) => a],
  __eq__: ['self, other', (a: any, o: any) => {
    if (!isBB(o)) return NotImplemented;
    const x = bytesOf(a);
    const y = bytesOf(o);
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }],
  __lt__: ['self, other', (a: any, o: any) => (isBB(o) ? cmp(bytesOf(a), bytesOf(o)) < 0 : NotImplemented)],
  __le__: ['self, other', (a: any, o: any) => (isBB(o) ? cmp(bytesOf(a), bytesOf(o)) <= 0 : NotImplemented)],
  __gt__: ['self, other', (a: any, o: any) => (isBB(o) ? cmp(bytesOf(a), bytesOf(o)) > 0 : NotImplemented)],
  __ge__: ['self, other', (a: any, o: any) => (isBB(o) ? cmp(bytesOf(a), bytesOf(o)) >= 0 : NotImplemented)],
  decode: ['self, encoding=, errors=', (b: any, enc?: any, er?: any) => decodeBytes(bytesOf(b), enc === undefined ? 'utf-8' : String(enc), er === undefined ? 'strict' : String(er))],
  hex: ['self, sep=, bytes_per_sep=', (b: any, sep?: any) => Array.from(bytesOf(b)).map((x) => x.toString(16).padStart(2, '0')).join(sep === undefined ? '' : String(sep))],
  count: ['self, sub, start=, end=', (b: any, x: any, s?: any, e?: any) => {
    const a = bytesOf(b);
    const [i, j] = rng(a.length, s, e);
    const n = sub(x);
    if (n.length === 0) return j - i + 1;
    let c = 0;
    let k = i;
    for (;;) {
      const f = find(a, n, k, j, false);
      if (f < 0) return c;
      c++;
      k = f + n.length;
    }
  }],
  find: ['self, sub, start=, end=', (b: any, x: any, s?: any, e?: any) => { const a = bytesOf(b); const [i, j] = rng(a.length, s, e); return find(a, sub(x), i, j, false); }],
  rfind: ['self, sub, start=, end=', (b: any, x: any, s?: any, e?: any) => { const a = bytesOf(b); const [i, j] = rng(a.length, s, e); return find(a, sub(x), i, j, true); }],
  index: ['self, sub, start=, end=', (b: any, x: any, s?: any, e?: any) => {
    const a = bytesOf(b);
    const [i, j] = rng(a.length, s, e);
    const r = find(a, sub(x), i, j, false);
    if (r < 0) throw valueError('subsection not found');
    return r;
  }],
  startswith: ['self, prefix, start=, end=', (b: any, p: any, s?: any, e?: any) => {
    const a = bytesOf(b);
    const [i, j] = rng(a.length, s, e);
    const test = (x: any): boolean => {
      const n = bytesOf(x);
      if (j - i < n.length) return false;
      for (let k = 0; k < n.length; k++) if (a[i + k] !== n[k]) return false;
      return true;
    };
    return p instanceof PyTuple ? p.a.some(test) : test(p);
  }],
  endswith: ['self, suffix, start=, end=', (b: any, p: any, s?: any, e?: any) => {
    const a = bytesOf(b);
    const [i, j] = rng(a.length, s, e);
    const test = (x: any): boolean => {
      const n = bytesOf(x);
      if (j - i < n.length) return false;
      for (let k = 0; k < n.length; k++) if (a[j - n.length + k] !== n[k]) return false;
      return true;
    };
    return p instanceof PyTuple ? p.a.some(test) : test(p);
  }],
  replace: ['self, old, new, count=', (b: any, o: any, n: any, c?: any) => {
    const a = Array.from(bytesOf(b));
    const old = Array.from(bytesOf(o));
    const nw = Array.from(bytesOf(n));
    const max = c === undefined ? -1 : asIdx(c);
    const out: number[] = [];
    let i = 0;
    let k = 0;
    if (old.length === 0) {
      for (let x = 0; x <= a.length; x++) { if (max < 0 || k < max) { out.push(...nw); k++; } if (x < a.length) out.push(a[x]); }
      return same(b, out);
    }
    while (i < a.length) {
      if ((max < 0 || k < max) && find(a, old, i, a.length, false) === i) { out.push(...nw); i += old.length; k++; }
      else out.push(a[i++]);
    }
    return same(b, out);
  }],
  split: ['self, sep=, maxsplit=', (b: any, s?: any, m?: any) => splitImpl(b, s, m, false)],
  rsplit: ['self, sep=, maxsplit=', (b: any, s?: any, m?: any) => splitImpl(b, s, m, true)],
  splitlines: ['self, keepends=', (b: any, k?: any) => {
    const a = Array.from(bytesOf(b));
    const keep = k !== undefined && ops.truthy(k);
    const out: BB[] = [];
    let st = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === 10 || a[i] === 13) {
        let e = i + 1;
        if (a[i] === 13 && a[i + 1] === 10) e++;
        out.push(same(b, a.slice(st, keep ? e : i)));
        st = e;
        i = e - 1;
      }
    }
    if (st < a.length) out.push(same(b, a.slice(st)));
    return new PyList(out);
  }],
  strip: ['self, bytes=', (b: any, c?: any) => stripImpl(b, c, true, true)],
  lstrip: ['self, bytes=', (b: any, c?: any) => stripImpl(b, c, true, false)],
  rstrip: ['self, bytes=', (b: any, c?: any) => stripImpl(b, c, false, true)],
  join: ['self, iterable', (b: any, it: any) => {
    const sep = Array.from(bytesOf(b));
    const out: number[] = [];
    let first = true;
    for (const x of ops.iterToArray(it)) {
      if (!first) out.push(...sep);
      first = false;
      out.push(...bytesOf(x));
    }
    return same(b, out);
  }],
  upper: ['self', (b: any) => same(b, Array.from(bytesOf(b)).map((x) => (x >= 97 && x <= 122 ? x - 32 : x)))],
  lower: ['self', (b: any) => same(b, Array.from(bytesOf(b)).map((x) => (x >= 65 && x <= 90 ? x + 32 : x)))],
  isdigit: ['self', (b: any) => bytesOf(b).length > 0 && Array.from(bytesOf(b)).every((x) => x >= 48 && x <= 57)],
  isalpha: ['self', (b: any) => bytesOf(b).length > 0 && Array.from(bytesOf(b)).every((x) => (x >= 65 && x <= 90) || (x >= 97 && x <= 122))],
  isspace: ['self', (b: any) => bytesOf(b).length > 0 && Array.from(bytesOf(b)).every((x) => WS.has(x))],
  copy: ['self', (b: any) => mkBA(Array.from(bytesOf(b)))],
  __getnewargs__: ['self', (b: any) => new PyTuple([mkBytes(bytesOf(b))])],
};

function cmp(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return a.length - b.length;
}

for (const t of [bytesType, byteArrayType]) {
  for (const k of Object.keys(methods)) {
    if (k === 'copy' && t === bytesType) continue;
    const [sig, impl] = methods[k];
    t.dict!.set(k, mkNative(k, sig, impl, { method: true, owner: t.name }));
  }
}
bytesType.dict!.set('__hash__', mkNative('__hash__', 'self', (b: any) => ops.hashOf(String.fromCharCode(...b.b)), { method: true, owner: 'bytes' }));
byteArrayType.dict!.set('__hash__', null);

function fromhex(cls: any, s: any): any {
  const t = String(s).replace(/\s+/g, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(t)) throw valueError('non-hexadecimal number found in fromhex() arg at position 0');
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
  return cls === bytesType ? mkBytes(out) : mkBA(out);
}
for (const t of [bytesType, byteArrayType]) {
  t.dict!.set('fromhex', new PyClassMethod(classMethodType, mkNative('fromhex', 'cls, string', fromhex, { owner: t.name })));
}
bytesType.dict!.set('maketrans', mkNative('maketrans', 'frm, to', (f: any, t: any) => {
  const a = Array.from(bytesOf(f));
  const b = Array.from(bytesOf(t));
  const out = new Array(256).fill(0).map((_, i) => i);
  a.forEach((x, i) => { out[x] = b[i]; });
  return mkBytes(out);
}));
bytesType.dict!.set('translate', mkNative('translate', 'self, table, delete=', (b: any, t: any) => mkBytes(Array.from(bytesOf(b)).map((x) => bytesOf(t)[x])), { method: true, owner: 'bytes' }));

// ───────────────────────── bytearray mutable ─────────────────────────

const ba = (x: any): PyByteArray => x as PyByteArray;
function byteVal(v: any): number {
  const k = ops.toIndex(v, `'${typeOf(v).name}' object cannot be interpreted as an integer`);
  if (typeof k === 'bigint' || k < 0 || k > 255) throw valueError('byte must be in range(0, 256)');
  return k;
}
defMethods(byteArrayType, {
  append: ['self, item', (b: any, v: any) => { ba(b).b.push(byteVal(v)); return null; }],
  extend: ['self, iterable', (b: any, it: any) => { for (const v of isBB(it) ? Array.from(it.b) : ops.iterToArray(it)) ba(b).b.push(byteVal(v)); return null; }],
  pop: ['self, index=', (b: any, i?: any) => {
    const a = ba(b).b;
    if (a.length === 0) throw indexError('pop from empty bytearray');
    const k = i === undefined ? a.length - 1 : ops.normIndex(ops.toIndex(i), a.length, 'pop index out of range');
    return a.splice(k, 1)[0];
  }],
  insert: ['self, index, item', (b: any, i: any, v: any) => { ba(b).b.splice(Math.max(0, asIdx(i)), 0, byteVal(v)); return null; }],
  remove: ['self, value', (b: any, v: any) => {
    const k = ba(b).b.indexOf(byteVal(v));
    if (k < 0) throw valueError('value not found in bytearray');
    ba(b).b.splice(k, 1);
    return null;
  }],
  clear: ['self', (b: any) => { ba(b).b.length = 0; return null; }],
  reverse: ['self', (b: any) => { ba(b).b.reverse(); return null; }],
  __setitem__: ['self, key, value', (b: any, k: any, v: any) => {
    const a = ba(b).b;
    if (k instanceof PySlice) {
      const items = isBB(v) ? Array.from(v.b) : ops.iterToArray(v).map(byteVal);
      const [s, e] = ops.sliceIndices(k, a.length);
      a.splice(s, Math.max(0, e - s), ...items);
      return null;
    }
    a[ops.normIndex(ops.toIndex(k), a.length, 'bytearray index out of range')] = byteVal(v);
    return null;
  }],
  __delitem__: ['self, key', (b: any, k: any) => {
    const a = ba(b).b;
    if (k instanceof PySlice) {
      const [s, e] = ops.sliceIndices(k, a.length);
      a.splice(s, Math.max(0, e - s));
      return null;
    }
    a.splice(ops.normIndex(ops.toIndex(k), a.length, 'bytearray index out of range'), 1);
    return null;
  }],
  __iadd__: ['self, other', (b: any, o: any) => { ba(b).b.push(...bytesOf(o)); return b; }],
});

// ───────────────────────── memoryview mínimo ─────────────────────────

memoryViewType.dict!.set('__new__', mkNative('__new__', 'cls, obj', (cls: any, o: any) => {
  const m = new PyObject(memoryViewType);
  (m as any).src = bytesOf(o);
  return m;
}, { owner: 'memoryview' }));
defMethods(memoryViewType, {
  __len__: ['self', (m: any) => m.src.length],
  __getitem__: ['self, k', (m: any, k: any) => (k instanceof PySlice ? mkBytes(ops.sliceList(Array.from(m.src), k)) : m.src[ops.normIndex(ops.toIndex(k), m.src.length, 'index out of range')])],
  tobytes: ['self', (m: any) => mkBytes(m.src)],
  tolist: ['self', (m: any) => new PyList(Array.from(m.src))],
  __iter__: ['self', (m: any) => new ops.BytesIter(m.src)],
  __repr__: ['self', () => '<memory at 0x7f3a5c0d0000>'],
});

void [bytesIterType, makeExc, E];
export { mkBytes, mkBA, bytesOf, isBB };
