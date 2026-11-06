/**
 * Núcleo de NumPy: el tipo `ndarray` (con vistas y pasos como el real), difusión (broadcasting), indexación,
 * operaciones elemento a elemento y reducciones. Todo en TypeScript, sin dependencias.
 *
 * Tipos de dato: `bool`, `int64`, `float64` (y `str` para listas de etiquetas). Los datos numéricos viven
 * en un `Float64Array`; los de texto, en un `string[]`.
 */
import { PyDict, PyFloat, PyList, PyObject, PyRange, PySlice, PyTuple, PyType } from '../../runtime/objects';
import { Ellipsis } from '../../runtime/builtin_types';
import { indexError, typeError, valueError } from '../../runtime/errors';
import * as ops from '../../runtime/ops';

export type DType = 'bool' | 'int64' | 'float64' | 'str';

export const ND_TYPE: { t: PyType } = { t: undefined as any };

export class NdArray extends PyObject {
  constructor(
    public buf: Float64Array | string[],
    public shape: number[],
    public strides: number[],
    public offset: number,
    public dtype: DType,
    /** si es una vista, el array que posee los datos (para `.base`) */
    public base: NdArray | null = null,
  ) {
    super(ND_TYPE.t);
  }
  get ndim(): number {
    return this.shape.length;
  }
  get size(): number {
    return sizeOf(this.shape);
  }
  get num(): Float64Array {
    return this.buf as Float64Array;
  }
  get str(): string[] {
    return this.buf as string[];
  }
}

export const sizeOf = (shape: number[]): number => {
  let n = 1;
  for (const s of shape) n *= s;
  return n;
};

export function cStrides(shape: number[]): number[] {
  const st = new Array<number>(shape.length);
  let acc = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    st[i] = acc;
    acc *= Math.max(shape[i], 1);
  }
  return st;
}

export const shapeStr = (shape: number[]): string => '(' + shape.join(',') + (shape.length === 1 ? ',' : '') + ')';

// ───────────────────────── construcción ─────────────────────────

export function mkNum(data: Float64Array, shape: number[], dtype: DType): NdArray {
  return new NdArray(data, shape, cStrides(shape), 0, dtype);
}

export function mkStr(data: string[], shape: number[]): NdArray {
  return new NdArray(data, shape, cStrides(shape), 0, 'str');
}

export const scalarArray = (v: number, dtype: DType): NdArray => mkNum(Float64Array.of(v), [], dtype);

export function zerosOf(shape: number[], dtype: DType): NdArray {
  return dtype === 'str' ? mkStr(new Array<string>(sizeOf(shape)).fill(''), shape) : mkNum(new Float64Array(sizeOf(shape)), shape, dtype);
}

/** ¿los datos están en orden C y sin huecos? */
export function isContig(a: NdArray): boolean {
  let acc = 1;
  for (let i = a.shape.length - 1; i >= 0; i--) {
    if (a.shape[i] !== 1 && a.strides[i] !== acc) return false;
    acc *= a.shape[i];
  }
  return true;
}

/** índices (en `buf`) de cada elemento en orden C */
export function offsetsOf(shape: number[], strides: number[], offset: number): Int32Array {
  const n = sizeOf(shape);
  const out = new Int32Array(n);
  const nd = shape.length;
  if (n === 0) return out;
  if (nd === 0) {
    out[0] = offset;
    return out;
  }
  const idx = new Array<number>(nd).fill(0);
  let off = offset;
  for (let i = 0; i < n; i++) {
    out[i] = off;
    for (let d = nd - 1; d >= 0; d--) {
      idx[d]++;
      off += strides[d];
      if (idx[d] < shape[d]) break;
      off -= strides[d] * shape[d];
      idx[d] = 0;
    }
  }
  return out;
}

/** datos numéricos en orden C (la vista del propio buffer si ya lo están) */
export function flatNum(a: NdArray): Float64Array {
  const n = a.size;
  const buf = a.num;
  if (isContig(a)) return a.offset === 0 && buf.length === n ? buf : buf.subarray(a.offset, a.offset + n);
  const out = new Float64Array(n);
  const offs = offsetsOf(a.shape, a.strides, a.offset);
  for (let i = 0; i < n; i++) out[i] = buf[offs[i]];
  return out;
}

export function flatStr(a: NdArray): string[] {
  const n = a.size;
  const buf = a.str;
  if (isContig(a)) return buf.slice(a.offset, a.offset + n);
  const offs = offsetsOf(a.shape, a.strides, a.offset);
  const out = new Array<string>(n);
  for (let i = 0; i < n; i++) out[i] = buf[offs[i]];
  return out;
}

/** copia contigua e independiente */
export function copyOf(a: NdArray): NdArray {
  return a.dtype === 'str' ? mkStr(flatStr(a), a.shape.slice()) : mkNum(Float64Array.from(flatNum(a)), a.shape.slice(), a.dtype);
}

// ───────────────────────── conversión desde/hacia Python ─────────────────────────

type Kind = 'bool' | 'int' | 'float' | 'str';

function scalarKind(v: any): Kind | null {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number' || typeof v === 'bigint') return 'int';
  if (v instanceof PyFloat) return 'float';
  if (typeof v === 'string') return 'str';
  return null;
}

function leafValue(v: any): { kind: Kind; num: number; s?: string } {
  const k = scalarKind(v);
  if (k === 'bool') return { kind: 'bool', num: v ? 1 : 0 };
  if (k === 'int') return { kind: 'int', num: Number(v) };
  if (k === 'float') return { kind: 'float', num: (v as PyFloat).v };
  if (k === 'str') return { kind: 'str', num: 0, s: v };
  if (v === null) return { kind: 'float', num: NaN };
  const i = ops.intValue(v);
  if (i !== undefined) return { kind: 'int', num: Number(i) };
  const f = ops.floatValue(v);
  if (f !== undefined) return { kind: 'float', num: f };
  throw typeError(`float() argument must be a string or a real number, not '${ops.typeNameOf(v)}'`);
}

const isSeq = (x: any): boolean => x instanceof PyList || x instanceof PyTuple;

export function dtypeFromKinds(kinds: Set<Kind>): DType {
  if (kinds.has('str')) return 'str';
  if (kinds.has('float')) return 'float64';
  if (kinds.has('int')) return 'int64';
  if (kinds.has('bool')) return 'bool';
  return 'float64';
}

/** convierte un objeto de Python (escalar, lista anidada, tupla, rango, otro array) en un array; `dtype` fuerza el tipo */
export function fromPy(x: any, dtype?: DType): NdArray {
  if (x instanceof NdArray) return dtype && dtype !== x.dtype ? astype(x, dtype) : x;
  const shape: number[] = [];
  const leaves: any[] = [];
  const walk = (node: any, depth: number): void => {
    let items: any[] | null = null;
    if (isSeq(node)) items = (node as PyList).a;
    else if (node instanceof NdArray) items = null;
    else if (scalarKind(node) === null && node !== null && ops.hasAttr(node, '__iter__') && ops.hasAttr(node, '__len__')) items = ops.iterToArray(node);
    if (node instanceof NdArray) {
      // un array dentro de una lista: se aplana con su forma
      const sub = node;
      if (shape.length === depth) shape.push(...sub.shape);
      else if (shape.length - depth !== sub.ndim || sub.shape.some((s, i) => s !== shape[depth + i])) throw inhomog(depth);
      const t = toPyList(sub);
      const flat: any[] = [];
      const flatten = (l: any, d: number): void => {
        if (d === sub.ndim) flat.push(l);
        else for (const e of (l as PyList).a) flatten(e, d + 1);
      };
      flatten(t, 0);
      for (const f of flat) leaves.push(f);
      return;
    }
    if (items === null) {
      if (shape.length > depth) throw inhomog(depth);
      leaves.push(node);
      return;
    }
    if (shape.length === depth) shape.push(items.length);
    else if (shape[depth] !== items.length) throw inhomog(depth);
    for (const it of items) walk(it, depth + 1);
  };
  walk(x, 0);
  const total = leaves.length;
  const kinds = new Set<Kind>();
  const vals = leaves.map((l) => {
    const v = leafValue(l);
    kinds.add(v.kind);
    return v;
  });
  const dt: DType = dtype ?? dtypeFromKinds(kinds);
  if (dt === 'str') {
    const out = vals.map((v, i) => (v.kind === 'str' ? (v.s as string) : ops.str(leaves[i])));
    return mkStr(out, shape);
  }
  const data = new Float64Array(total);
  for (let i = 0; i < total; i++) data[i] = vals[i].kind === 'str' ? Number(vals[i].s) : vals[i].num;
  if (dt === 'int64') for (let i = 0; i < total; i++) data[i] = Math.trunc(data[i]);
  if (dt === 'bool') for (let i = 0; i < total; i++) data[i] = data[i] !== 0 ? 1 : 0;
  return mkNum(data, shape, dt);
}

function inhomog(depth: number): any {
  return valueError(`setting an array element with a sequence. The requested array has an inhomogeneous shape after ${depth} dimensions. The detected shape was (${depth === 0 ? '' : '…'}) + inhomogeneous part.`);
}

export function scalarToPy(dtype: DType, v: number): any {
  if (dtype === 'bool') return v !== 0;
  if (dtype === 'int64') return Number.isSafeInteger(v) ? v : Number.isFinite(v) ? BigInt(v) : v;
  return new PyFloat(v);
}

export function toPyList(a: NdArray): any {
  const flat = a.dtype === 'str' ? flatStr(a) : flatNum(a);
  let pos = 0;
  const build = (d: number): any => {
    if (d === a.ndim) {
      const v = flat[pos++];
      return a.dtype === 'str' ? v : scalarToPy(a.dtype, v as number);
    }
    const out: any[] = [];
    for (let i = 0; i < a.shape[d]; i++) out.push(build(d + 1));
    return new PyList(out);
  };
  return build(0);
}

/** el único elemento de un array 0-d / de tamaño 1 como valor de Python */
export function itemOf(a: NdArray, idx = 0): any {
  if (a.dtype === 'str') return flatStr(a)[idx];
  return scalarToPy(a.dtype, flatNum(a)[idx]);
}

// ───────────────────────── tipos ─────────────────────────

const RANK: Record<DType, number> = { bool: 0, int64: 1, float64: 2, str: 3 };

export const promote = (a: DType, b: DType): DType => (RANK[a] >= RANK[b] ? a : b);

export function astype(a: NdArray, dtype: DType): NdArray {
  if (dtype === a.dtype) return copyOf(a);
  if (dtype === 'str') {
    const flat = a.dtype === 'str' ? flatStr(a) : Array.from(flatNum(a)).map((v) => (a.dtype === 'bool' ? (v ? 'True' : 'False') : a.dtype === 'int64' ? String(v) : ops.str(new PyFloat(v))));
    return mkStr(flat, a.shape.slice());
  }
  if (a.dtype === 'str') {
    const flat = flatStr(a);
    const out = new Float64Array(flat.length);
    flat.forEach((s, i) => {
      const v = Number(s.trim());
      if (s.trim() === '' || Number.isNaN(v)) {
        if (/^nan$/i.test(s.trim())) out[i] = NaN;
        else throw valueError(`${dtype === 'int64' ? 'invalid literal for int() with base 10' : 'could not convert string to float'}: '${s}'`);
      } else out[i] = v;
    });
    if (dtype === 'int64') for (let i = 0; i < out.length; i++) out[i] = Math.trunc(out[i]);
    if (dtype === 'bool') for (let i = 0; i < out.length; i++) out[i] = out[i] !== 0 ? 1 : 0;
    return mkNum(out, a.shape.slice(), dtype);
  }
  const src = flatNum(a);
  const out = new Float64Array(src.length);
  if (dtype === 'int64') for (let i = 0; i < src.length; i++) out[i] = Math.trunc(src[i]);
  else if (dtype === 'bool') for (let i = 0; i < src.length; i++) out[i] = src[i] !== 0 ? 1 : 0;
  else out.set(src);
  return mkNum(out, a.shape.slice(), dtype);
}

// ───────────────────────── difusión ─────────────────────────

export function broadcastShapes(a: number[], b: number[], what?: string): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = i < n - a.length ? 1 : a[i - (n - a.length)];
    const y = i < n - b.length ? 1 : b[i - (n - b.length)];
    if (x === y || y === 1) out[i] = x;
    else if (x === 1) out[i] = y;
    else throw valueError(`operands could not be broadcast together with shapes ${shapeStr(a)} ${shapeStr(b)} ${what ?? ''}`);
  }
  return out;
}

/** vista de `a` con la forma `shape` (pasos 0 en las dimensiones difundidas) */
export function broadcastTo(a: NdArray, shape: number[]): NdArray {
  if (a.shape.length > shape.length) throw valueError(`input operand has more dimensions than allowed by the axis remapping`);
  const lead = shape.length - a.shape.length;
  const strides = new Array<number>(shape.length).fill(0);
  for (let i = 0; i < a.shape.length; i++) {
    const s = shape[lead + i];
    if (a.shape[i] === s) strides[lead + i] = a.strides[i];
    else if (a.shape[i] === 1) strides[lead + i] = 0;
    else throw valueError(`operands could not be broadcast together with remapped shapes [original->remapped]: ${shapeStr(a.shape)} and requested shape ${shapeStr(shape)}`);
  }
  return new NdArray(a.buf, shape.slice(), strides, a.offset, a.dtype, a.base ?? a);
}

/** datos de `a` difundidos a `shape`, en orden C */
function flatBroadcast(a: NdArray, shape: number[]): Float64Array {
  if (a.shape.length === shape.length && a.shape.every((s, i) => s === shape[i])) return flatNum(a);
  if (a.size === 1) {
    const out = new Float64Array(sizeOf(shape));
    out.fill(a.num[a.offset]);
    return out;
  }
  return flatNum(broadcastTo(a, shape));
}

// ───────────────────────── operaciones elemento a elemento ─────────────────────────

export type BinFn = (x: number, y: number) => number;

export function ewBinary(a: NdArray, b: NdArray, f: BinFn, out: DType): NdArray {
  const shape = broadcastShapes(a.shape, b.shape);
  const n = sizeOf(shape);
  const res = new Float64Array(n);
  if (a.size === 1 && a.ndim === 0 && b.shape.length === shape.length) {
    const x = a.num[a.offset];
    const B = flatNum(b);
    for (let i = 0; i < n; i++) res[i] = f(x, B[i]);
  } else if (b.size === 1 && b.ndim === 0 && a.shape.length === shape.length) {
    const y = b.num[b.offset];
    const A = flatNum(a);
    for (let i = 0; i < n; i++) res[i] = f(A[i], y);
  } else {
    const A = flatBroadcast(a, shape);
    const B = flatBroadcast(b, shape);
    for (let i = 0; i < n; i++) res[i] = f(A[i], B[i]);
  }
  return mkNum(res, shape, out);
}

export function ewUnary(a: NdArray, f: (x: number) => number, out: DType): NdArray {
  const src = flatNum(a);
  const res = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) res[i] = f(src[i]);
  return mkNum(res, a.shape.slice(), out);
}

// ───────────────────────── índices ─────────────────────────

export interface IdxItem {
  kind: 'int' | 'slice' | 'new' | 'adv';
  i?: number;
  start?: number;
  step?: number;
  len?: number;
  arr?: NdArray;
}

function normalizeKey(key: any): any[] {
  if (key instanceof PyTuple) return key.a.slice();
  return [key];
}

function toIndexArray(x: any): NdArray | null {
  if (x instanceof NdArray) return x;
  if (isSeq(x)) return fromPy(x);
  if (x instanceof PyRange) return fromPy(ops.mkList(ops.iterToArray(x)));
  return null;
}

/** analiza la clave en elementos de índice, expandiendo `...` y rellenando con rebanadas completas */
function parseKey(a: NdArray, key: any): IdxItem[] {
  const raw = normalizeKey(key);
  // contar cuántas dimensiones consume cada elemento
  let consumed = 0;
  let ell = -1;
  const parts: { item: any; arr: NdArray | null }[] = [];
  raw.forEach((k, pos) => {
    if (k === Ellipsis) {
      if (ell >= 0) throw indexError(`an index can only have a single ellipsis ('...')`);
      ell = pos;
      parts.push({ item: k, arr: null });
      return;
    }
    const arr = k === null || k instanceof PySlice ? null : toIndexArray(k);
    parts.push({ item: k, arr });
    if (k === null) return;
    if (arr && arr.dtype === 'bool') consumed += arr.ndim;
    else consumed += 1;
  });
  if (consumed > a.ndim) throw indexError(`too many indices for array: array is ${a.ndim}-dimensional, but ${consumed} were indexed`);
  const out: IdxItem[] = [];
  let dim = 0;
  const fill = a.ndim - consumed;
  const full = (): IdxItem => ({ kind: 'slice', start: 0, step: 1, len: a.shape[dim] });
  for (const { item, arr } of parts) {
    if (item === Ellipsis) {
      for (let j = 0; j < fill; j++) {
        out.push(full());
        dim++;
      }
      continue;
    }
    if (item === null) {
      out.push({ kind: 'new' });
      continue;
    }
    if (item instanceof PySlice) {
      const [s, e, st] = ops.sliceIndices(item, a.shape[dim]);
      out.push({ kind: 'slice', start: s, step: st, len: ops.sliceLength(s, e, st) });
      dim++;
      continue;
    }
    if (arr) {
      if (arr.dtype === 'bool') {
        for (let j = 0; j < arr.ndim; j++) if (arr.shape[j] !== a.shape[dim + j]) throw indexError(`boolean index did not match indexed array along axis ${dim + j}; size of axis is ${a.shape[dim + j]} but size of corresponding boolean axis is ${arr.shape[j]}`);
        const idx = nonzeroIdx(arr);
        for (const ix of idx) out.push({ kind: 'adv', arr: ix });
        dim += arr.ndim;
      } else {
        if (arr.dtype === 'float64' || arr.dtype === 'str') throw indexError('arrays used as indices must be of integer (or boolean) type');
        out.push({ kind: 'adv', arr });
        dim++;
      }
      continue;
    }
    const iv = ops.intValue(item);
    if (iv === undefined) {
      if (item instanceof PyFloat) throw indexError('only integers, slices (`:`), ellipsis (`...`), numpy.newaxis (`None`) and integer or boolean arrays are valid indices');
      throw indexError('only integers, slices (`:`), ellipsis (`...`), numpy.newaxis (`None`) and integer or boolean arrays are valid indices');
    }
    let i = Number(iv);
    const n = a.shape[dim];
    if (i < -n || i >= n) throw indexError(`index ${i} is out of bounds for axis ${dim} with size ${n}`);
    if (i < 0) i += n;
    out.push({ kind: 'int', i });
    dim++;
  }
  // dimensiones finales sin indexar
  while (dim < a.ndim) {
    out.push(full());
    dim++;
  }
  return out;
}

function nonzeroIdx(m: NdArray): NdArray[] {
  const flat = flatNum(m);
  const cnt = flat.reduce((s, v) => s + (v !== 0 ? 1 : 0), 0);
  const outs = m.shape.map(() => new Float64Array(cnt));
  const idx = new Array<number>(m.ndim).fill(0);
  let k = 0;
  for (let p = 0; p < flat.length; p++) {
    if (flat[p] !== 0) {
      for (let d = 0; d < m.ndim; d++) outs[d][k] = idx[d];
      k++;
    }
    for (let d = m.ndim - 1; d >= 0; d--) {
      idx[d]++;
      if (idx[d] < m.shape[d]) break;
      idx[d] = 0;
    }
  }
  return outs.map((o) => mkNum(o, [cnt], 'int64'));
}

export const nonzero = nonzeroIdx;

export type Resolved = { view: NdArray } | { offsets: Int32Array; shape: number[] };

/** resuelve una clave de indexación: una vista (índices básicos) o una lista de posiciones (índices avanzados) */
export function resolveIndex(a: NdArray, key: any): Resolved {
  const items = parseKey(a, key);
  const hasAdv = items.some((x) => x.kind === 'adv');
  if (!hasAdv) {
    const shape: number[] = [];
    const strides: number[] = [];
    let off = a.offset;
    let dim = 0;
    for (const it of items) {
      if (it.kind === 'new') {
        shape.push(1);
        strides.push(0);
      } else if (it.kind === 'int') {
        off += (it.i as number) * a.strides[dim];
        dim++;
      } else {
        shape.push(it.len as number);
        strides.push(a.strides[dim] * (it.step as number));
        off += (it.start as number) * a.strides[dim];
        dim++;
      }
    }
    return { view: new NdArray(a.buf, shape, strides, off, a.dtype, a.base ?? a) };
  }
  // índices avanzados: los enteros sueltos se tratan como arrays 0-d
  const advIdx: number[] = [];
  items.forEach((it, p) => {
    if (it.kind === 'adv' || it.kind === 'int') advIdx.push(p);
  });
  const adjacent = advIdx.every((p, k) => k === 0 || p === advIdx[k - 1] + 1);
  const arrs = advIdx.map((p) => (items[p].kind === 'adv' ? (items[p].arr as NdArray) : scalarArray(items[p].i as number, 'int64')));
  let bshape: number[] = [];
  for (const ar of arrs) bshape = broadcastShapes(bshape, ar.shape);
  const bsize = sizeOf(bshape);
  // desplazamiento base de cada elemento del bloque de índices
  const base = new Float64Array(bsize);
  // recorremos dimensiones del array original para conocer su paso y tamaño
  let dim = 0;
  const dimOfItem: number[] = [];
  for (const it of items) {
    if (it.kind === 'new') dimOfItem.push(-1);
    else {
      dimOfItem.push(dim);
      dim++;
    }
  }
  advIdx.forEach((p, k) => {
    const d = dimOfItem[p];
    const n = a.shape[d];
    const idxs = flatBroadcast(arrs[k], bshape);
    for (let i = 0; i < bsize; i++) {
      let v = idxs[i];
      if (v < -n || v >= n) throw indexError(`index ${v} is out of bounds for axis ${d} with size ${n}`);
      if (v < 0) v += n;
      base[i] += v * a.strides[d];
    }
  });
  // dimensiones restantes (rebanadas y ejes nuevos)
  type Rem = { len: number; stride: number; start: number; pos: number };
  const rem: Rem[] = [];
  items.forEach((it, p) => {
    if (it.kind === 'slice') rem.push({ len: it.len as number, stride: a.strides[dimOfItem[p]] * (it.step as number), start: a.strides[dimOfItem[p]] * (it.start as number), pos: p });
    else if (it.kind === 'new') rem.push({ len: 1, stride: 0, start: 0, pos: p });
  });
  const firstAdv = advIdx[0];
  const pre = adjacent ? rem.filter((r) => r.pos < firstAdv) : [];
  const post = adjacent ? rem.filter((r) => r.pos > firstAdv) : rem;
  const shape = [...pre.map((r) => r.len), ...bshape, ...post.map((r) => r.len)];
  const preOffs = offsetsOf(pre.map((r) => r.len), pre.map((r) => r.stride), 0);
  const postOffs = offsetsOf(post.map((r) => r.len), post.map((r) => r.stride), 0);
  const constStart = rem.reduce((s, r) => s + r.start, a.offset);
  const total = preOffs.length * bsize * postOffs.length;
  const offsets = new Int32Array(total);
  let k = 0;
  for (let i = 0; i < preOffs.length; i++) for (let j = 0; j < bsize; j++) for (let l = 0; l < postOffs.length; l++) offsets[k++] = constStart + preOffs[i] + base[j] + postOffs[l];
  return { offsets, shape };
}

export function getItem(a: NdArray, key: any): any {
  const r = resolveIndex(a, key);
  if ('view' in r) {
    const v = r.view;
    if (v.ndim === 0) return a.dtype === 'str' ? v.str[v.offset] : scalarToPy(v.dtype, v.num[v.offset]);
    return v;
  }
  const n = r.offsets.length;
  if (a.dtype === 'str') {
    const out = new Array<string>(n);
    for (let i = 0; i < n; i++) out[i] = a.str[r.offsets[i]];
    return mkStr(out, r.shape);
  }
  const out = new Float64Array(n);
  const buf = a.num;
  for (let i = 0; i < n; i++) out[i] = buf[r.offsets[i]];
  if (r.shape.length === 0) return scalarToPy(a.dtype, out[0]);
  return mkNum(out, r.shape, a.dtype);
}

/** escribe `value` (escalar o array difundible) en las posiciones indicadas */
export function setItem(a: NdArray, key: any, value: any): void {
  const r = resolveIndex(a, key);
  const target = 'view' in r ? r.view : null;
  const shape = target ? target.shape : (r as { shape: number[] }).shape;
  let val = value instanceof NdArray ? value : fromPy(value);
  if (a.dtype === 'str') {
    const vs = val.dtype === 'str' ? flatStr(val) : flatStr(astype(val, 'str'));
    const n = sizeOf(shape);
    const offs = target ? offsetsOf(target.shape, target.strides, target.offset) : (r as { offsets: Int32Array }).offsets;
    for (let i = 0; i < n; i++) a.str[offs[i]] = vs[vs.length === 1 ? 0 : i % vs.length];
    return;
  }
  if (val.dtype === 'str') val = astype(val, a.dtype);
  const vflat = flatBroadcast(val, broadcastShapes(val.shape, shape).length === shape.length && broadcastShapes(val.shape, shape).every((s, i) => s === shape[i]) ? shape : (() => {
    throw valueError(`could not broadcast input array from shape ${shapeStr(val.shape)} into shape ${shapeStr(shape)}`);
  })());
  const n = sizeOf(shape);
  const offs = target ? offsetsOf(target.shape, target.strides, target.offset) : (r as { offsets: Int32Array }).offsets;
  const buf = a.num;
  const conv = a.dtype === 'int64' ? (v: number) => Math.trunc(v) : a.dtype === 'bool' ? (v: number) => (v !== 0 ? 1 : 0) : (v: number) => v;
  for (let i = 0; i < n; i++) buf[offs[i]] = conv(vflat[i]);
}

// ───────────────────────── forma ─────────────────────────

export function reshapeTo(a: NdArray, shapeIn: number[]): NdArray {
  const size = a.size;
  const shape = shapeIn.slice();
  const neg = shape.indexOf(-1);
  if (neg >= 0) {
    const rest = shape.reduce((p, s, i) => (i === neg ? p : p * s), 1);
    if (rest === 0 || size % rest !== 0) throw valueError(`cannot reshape array of size ${size} into shape ${shapeStr(shapeIn.map((s) => s))}`.replace('(-1', '(-1'));
    shape[neg] = size / rest;
  }
  if (sizeOf(shape) !== size) throw valueError(`cannot reshape array of size ${size} into shape ${shapeStr(shapeIn)}`);
  if (isContig(a)) return new NdArray(a.buf, shape, cStrides(shape), a.offset, a.dtype, a.base ?? a);
  const c = copyOf(a);
  return new NdArray(c.buf, shape, cStrides(shape), 0, a.dtype);
}

export function transposeAxes(a: NdArray, axes?: number[]): NdArray {
  const nd = a.ndim;
  const ax = axes ?? Array.from({ length: nd }, (_, i) => nd - 1 - i);
  if (ax.length !== nd || new Set(ax).size !== nd) throw valueError(`axes don't match array`);
  return new NdArray(a.buf, ax.map((i) => a.shape[i]), ax.map((i) => a.strides[i]), a.offset, a.dtype, a.base ?? a);
}

export function normAxis(axis: number, nd: number): number {
  if (axis < -nd || axis >= nd) throw valueError(`axis ${axis} is out of bounds for array of dimension ${nd}`);
  return axis < 0 ? axis + nd : axis;
}

// ───────────────────────── reducciones ─────────────────────────

export interface ReduceSpec {
  /** valor inicial y paso de acumulación (para sum/prod/min/max) */
  init?: number;
  step?: (acc: number, v: number) => number;
  /** se pasa el vector de valores del grupo (mediana, desviación…) */
  group?: (vals: Float64Array) => number;
}

/** reduce `a` sobre `axes` (null = todos). Devuelve el array resultante (o con ejes de tamaño 1 si `keepdims`). */
export function reduceAxes(a: NdArray, axes: number[] | null, spec: ReduceSpec, outDtype: DType, keepdims = false): NdArray {
  const nd = a.ndim;
  const ax = axes === null ? Array.from({ length: nd }, (_, i) => i) : axes.map((x) => normAxis(x, nd));
  if (new Set(ax).size !== ax.length) throw valueError('duplicate value in \'axis\'');
  const keep = Array.from({ length: nd }, (_, i) => i).filter((i) => !ax.includes(i));
  const outShape = keepdims ? a.shape.map((s, i) => (ax.includes(i) ? 1 : s)) : keep.map((i) => a.shape[i]);
  // reordenamos para que los ejes reducidos queden al final: vista transpuesta y datos contiguos
  const perm = [...keep, ...ax];
  const tr = transposeAxes(a, perm);
  const data = flatNum(tr);
  const groupSize = ax.reduce((p, i) => p * a.shape[i], 1);
  const groups = sizeOf(keep.map((i) => a.shape[i]));
  const res = new Float64Array(groups);
  if (spec.group) {
    for (let g = 0; g < groups; g++) res[g] = spec.group(data.subarray(g * groupSize, (g + 1) * groupSize));
  } else {
    const step = spec.step as (acc: number, v: number) => number;
    for (let g = 0; g < groups; g++) {
      let acc = spec.init as number;
      const base = g * groupSize;
      for (let i = 0; i < groupSize; i++) acc = step(acc, data[base + i]);
      res[g] = acc;
    }
  }
  return mkNum(res, outShape, outDtype);
}

export function argReduce(a: NdArray, axis: number | null, better: (x: number, best: number) => boolean): NdArray | number {
  if (a.size === 0) throw valueError('attempt to get argmax of an empty sequence');
  if (axis === null) {
    const d = flatNum(a);
    let bi = 0;
    for (let i = 1; i < d.length; i++) if (better(d[i], d[bi])) bi = i;
    return bi;
  }
  const ax = normAxis(axis, a.ndim);
  const perm = [...Array.from({ length: a.ndim }, (_, i) => i).filter((i) => i !== ax), ax];
  const tr = transposeAxes(a, perm);
  const data = flatNum(tr);
  const gs = a.shape[ax];
  const groups = a.size / gs;
  const res = new Float64Array(groups);
  for (let g = 0; g < groups; g++) {
    let bi = 0;
    for (let i = 1; i < gs; i++) if (better(data[g * gs + i], data[g * gs + bi])) bi = i;
    res[g] = bi;
  }
  return mkNum(res, perm.slice(0, -1).map((i) => a.shape[i]), 'int64');
}

/** acumulaciones (cumsum, cumprod) a lo largo de un eje (null = aplanado) */
export function accumulate(a: NdArray, axis: number | null, step: (acc: number, v: number) => number, outDtype: DType): NdArray {
  if (axis === null) {
    const d = flatNum(a);
    const out = new Float64Array(d.length);
    let acc = 0;
    for (let i = 0; i < d.length; i++) {
      acc = i === 0 ? d[0] : step(acc, d[i]);
      out[i] = acc;
    }
    return mkNum(out, [d.length], outDtype);
  }
  const ax = normAxis(axis, a.ndim);
  const perm = [...Array.from({ length: a.ndim }, (_, i) => i).filter((i) => i !== ax), ax];
  const tr = transposeAxes(a, perm);
  const data = flatNum(tr);
  const gs = a.shape[ax];
  const out = new Float64Array(data.length);
  for (let g = 0; g < data.length / Math.max(gs, 1); g++) {
    let acc = 0;
    for (let i = 0; i < gs; i++) {
      acc = i === 0 ? data[g * gs] : step(acc, data[g * gs + i]);
      out[g * gs + i] = acc;
    }
  }
  const t = mkNum(out, perm.map((i) => a.shape[i]), outDtype);
  // deshacemos la permutación
  const inv = new Array<number>(perm.length);
  perm.forEach((p, i) => (inv[p] = i));
  return copyOf(transposeAxes(t, inv));
}

// ───────────────────────── ordenación ─────────────────────────

export function cmpNum(x: number, y: number): number {
  // NaN al final, como NumPy
  if (x !== x) return y !== y ? 0 : 1;
  if (y !== y) return -1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** ordena a lo largo de un eje; devuelve valores o índices (orden estable) */
export function sortAxis(a: NdArray, axis: number | null, wantIdx: boolean, descending = false): NdArray {
  const src = axis === null ? reshapeTo(a, [a.size]) : a;
  const ax = axis === null ? 0 : normAxis(axis, src.ndim);
  if (src.ndim === 0) return wantIdx ? mkNum(Float64Array.of(0), [], 'int64') : copyOf(src);
  const perm = [...Array.from({ length: src.ndim }, (_, i) => i).filter((i) => i !== ax), ax];
  const tr = transposeAxes(src, perm);
  const gs = src.shape[ax];
  const isStr = src.dtype === 'str';
  const data: any = isStr ? flatStr(tr) : flatNum(tr);
  const out = isStr && !wantIdx ? new Array<string>(data.length) : new Float64Array(data.length);
  const groups = gs === 0 ? 0 : data.length / gs;
  for (let g = 0; g < groups; g++) {
    const idx = Array.from({ length: gs }, (_, i) => i);
    const base = g * gs;
    if (isStr) idx.sort((i, j) => (data[base + i] < data[base + j] ? -1 : data[base + i] > data[base + j] ? 1 : i - j));
    else idx.sort((i, j) => cmpNum(data[base + i], data[base + j]) || i - j);
    if (descending) idx.reverse();
    for (let i = 0; i < gs; i++) (out as any)[base + i] = wantIdx ? idx[i] : data[base + idx[i]];
  }
  const shapeT = perm.map((i) => src.shape[i]);
  const t: NdArray = wantIdx ? mkNum(out as Float64Array, shapeT, 'int64') : isStr ? mkStr(out as string[], shapeT) : mkNum(out as Float64Array, shapeT, src.dtype);
  const inv = new Array<number>(perm.length);
  perm.forEach((p, i) => (inv[p] = i));
  return copyOf(transposeAxes(t, inv));
}

void PyDict;
