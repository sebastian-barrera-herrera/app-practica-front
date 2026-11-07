/**
 * Módulo `numpy` (y `numpy.linalg`, `numpy.random`): el tipo `ndarray` con sus operadores y métodos y las funciones
 * de nivel de módulo más usadas. La implementación pesada está en `nd.ts`, `ops.ts`, `linalg.ts` y `rng.ts`.
 */
import { PyDict, PyFloat, PyList, PyModule, PyObject, PyProperty, PySlice, PyTuple, PyType } from '../../runtime/objects';
import { NotImplemented, newNativeType, objectType, propertyType } from '../../runtime/builtin_types';
import { E } from '../../runtime/exc_types';
import { makeExc, indexError, typeError, valueError } from '../../runtime/errors';
import * as ops from '../../runtime/ops';
import { callObj } from '../../runtime/call';
import { importModule } from '../../runtime/modules';
import { mkNative } from '../../runtime/native';
import { registerNative } from '../registry';
import { mfn, mconst } from '../helpers';
import { arr, axesArg, axisArg, bool, dtypeArg, intArg, isNone, numArg, SCALAR_TYPES, shapeArg } from './args';
import { arrayRepr, arrayStr, array2string, dtypeName, PRINT } from './fmt';
import * as nd from './nd';
import { NdArray, ND_TYPE, flatNum, flatStr, fromPy, itemOf, mkNum, mkStr, scalarToPy, sizeOf, type DType } from './nd';
import * as O from './ops';
import * as L from './linalg';
import { installRandom } from './random';

const F = (v: number): PyFloat => new PyFloat(v);
const tup = (xs: number[]): PyTuple => new PyTuple(xs);

class ConcatObj extends PyObject {
  constructor(cls: PyType, public col: boolean) {
    super(cls);
  }
}

class NdDType extends PyObject {
  constructor(cls: PyType, public dt: DType, public arrRef?: NdArray) {
    super(cls);
  }
}

let dtypeType: PyType;
let linAlgError: PyType;
let axisError: PyType;
let typesReady = false;

/** 0-d → escalar de Python; el resto se devuelve como array */
const ret = (r: NdArray): any => (r.ndim === 0 ? itemOf(r) : r);

function prop(t: PyType, name: string, get: (a: any) => any, set?: (a: any, v: any) => void): void {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', get, { method: true });
  if (set) p.fset = mkNative(name, 'self, value', set, { method: true });
  t.dict!.set(name, p);
}

function coerce(o: any): NdArray | null {
  if (o instanceof NdArray) return o;
  if (typeof o === 'boolean' || typeof o === 'number' || typeof o === 'bigint' || o instanceof PyFloat || typeof o === 'string' || o instanceof PyList || o instanceof PyTuple) return fromPy(o);
  return null;
}

const dtypeObj = (dt: DType, a?: NdArray): NdDType => new NdDType(dtypeType, dt, a);

// ───────────────────────── escritura en el propio array ─────────────────────────

function assignAll(self: NdArray, value: NdArray): void {
  const shape = self.shape;
  const bshape = nd.broadcastShapes(value.shape, shape);
  if (bshape.length !== shape.length || bshape.some((s, i) => s !== shape[i])) throw valueError(`non-broadcastable output operand with shape ${nd.shapeStr(shape)} doesn't match the broadcast shape ${nd.shapeStr(bshape)}`);
  const offs = nd.offsetsOf(shape, self.strides, self.offset);
  if (self.dtype === 'str') {
    const v = flatStr(nd.broadcastTo(nd.astype(value, 'str'), shape));
    offs.forEach((o, i) => (self.str[o] = v[i]));
    return;
  }
  const src = flatNum(nd.broadcastTo(value, shape));
  const buf = self.num;
  const conv = self.dtype === 'int64' ? Math.trunc : self.dtype === 'bool' ? (v: number) => (v !== 0 ? 1 : 0) : (v: number) => v;
  for (let i = 0; i < offs.length; i++) buf[offs[i]] = conv(src[i]);
}

const CAST_RANK: Record<DType, number> = { bool: 0, int64: 1, float64: 2, str: 3 };

function inplace(name: string, f: (a: NdArray, b: NdArray) => NdArray): [string, (self: NdArray, o: any) => any] {
  return [
    'self, other',
    (self: NdArray, other: any) => {
      const o = coerce(other);
      if (o === null) return NotImplemented;
      const r = f(self, o);
      if (CAST_RANK[r.dtype] > CAST_RANK[self.dtype]) throw makeExc(E.TypeError, [`Cannot cast ufunc '${name}' output from dtype('${r.dtype}') to dtype('${self.dtype}') with casting rule 'same_kind'`]);
      assignAll(self, r);
      return self;
    },
  ];
}

// ───────────────────────── construcción del módulo ─────────────────────────

function ensureTypes(): PyType {
  if (typesReady) return ND_TYPE.t;
  typesReady = true;
  const t = newNativeType('ndarray', 'numpy', [objectType]);
  ND_TYPE.t = t;
  dtypeType = newNativeType('dtype', 'numpy', [objectType]);
  linAlgError = newNativeType('LinAlgError', 'numpy.linalg', [E.ValueError]);
  axisError = newNativeType('AxisError', 'numpy.exceptions', [E.ValueError, E.IndexError]);
  const M = (name: string, sig: string, impl: (...a: any[]) => any) => t.dict!.set(name, mkNative(name, sig, impl, { method: true, owner: 'ndarray' }));

  // dtype
  const dm = (name: string, sig: string, impl: (...a: any[]) => any) => dtypeType.dict!.set(name, mkNative(name, sig, impl, { method: true, owner: 'dtype' }));
  dm('__repr__', 'self', (d: NdDType) => `dtype('${dtypeName(d.dt, d.arrRef)}')`);
  dm('__str__', 'self', (d: NdDType) => dtypeName(d.dt, d.arrRef));
  dm('__eq__', 'self, other', (d: NdDType, o: any) => {
    try {
      return o instanceof NdDType ? o.dt === d.dt : dtypeArg(o) === d.dt;
    } catch {
      return false;
    }
  });
  dm('__ne__', 'self, other', (d: NdDType, o: any) => {
    try {
      return o instanceof NdDType ? o.dt !== d.dt : dtypeArg(o) !== d.dt;
    } catch {
      return true;
    }
  });
  dm('__hash__', 'self', (d: NdDType) => ops.hashOf(d.dt));
  prop(dtypeType, 'name', (d: NdDType) => (d.dt === 'str' ? dtypeName(d.dt, d.arrRef) : d.dt));
  prop(dtypeType, 'kind', (d: NdDType) => ({ bool: 'b', int64: 'i', float64: 'f', str: 'U' })[d.dt]);
  prop(dtypeType, 'itemsize', (d: NdDType) => (d.dt === 'bool' ? 1 : d.dt === 'str' ? 4 * Math.max(1, ...(d.arrRef ? flatStr(d.arrRef).map((s) => [...s].length) : [1])) : 8));

  // propiedades
  prop(t, 'shape', (a: NdArray) => tup(a.shape), (a: NdArray, v: any) => {
    const r = nd.reshapeTo(a, shapeArg(v));
    if (r.buf !== a.buf) throw makeExc(E.AttributeError, ['Incompatible shape for in-place modification. Use `.reshape()` to make a copy with the desired shape.']);
    a.shape = r.shape;
    a.strides = r.strides;
  });
  prop(t, 'ndim', (a: NdArray) => a.ndim);
  prop(t, 'size', (a: NdArray) => a.size);
  prop(t, 'dtype', (a: NdArray) => dtypeObj(a.dtype, a));
  prop(t, 'itemsize', (a: NdArray) => (a.dtype === 'bool' ? 1 : 8));
  prop(t, 'nbytes', (a: NdArray) => a.size * (a.dtype === 'bool' ? 1 : 8));
  prop(t, 'strides', (a: NdArray) => tup(a.strides.map((s) => s * (a.dtype === 'bool' ? 1 : 8))));
  prop(t, 'T', (a: NdArray) => nd.transposeAxes(a));
  prop(t, 'flat', (a: NdArray) => nd.reshapeTo(nd.copyOf(a), [a.size]));
  prop(t, 'real', (a: NdArray) => a);
  prop(t, 'imag', (a: NdArray) => nd.zerosOf(a.shape, a.dtype));
  prop(t, 'base', (a: NdArray) => a.base);

  // representación y protocolo
  M('__repr__', 'self', (a: NdArray) => arrayRepr(a));
  M('__str__', 'self', (a: NdArray) => arrayStr(a));
  M('__len__', 'self', (a: NdArray) => {
    if (a.ndim === 0) throw typeError('len() of unsized object');
    return a.shape[0];
  });
  M('__iter__', 'self', (a: NdArray) => {
    if (a.ndim === 0) throw typeError('iteration over a 0-d array');
    const rows: any[] = [];
    for (let i = 0; i < a.shape[0]; i++) rows.push(nd.getItem(a, i));
    return ops.pyIter(new PyList(rows));
  });
  M('__bool__', 'self', (a: NdArray) => {
    if (a.size === 0) return false;
    if (a.size > 1) throw valueError('The truth value of an array with more than one element is ambiguous. Use a.any() or a.all()');
    return a.dtype === 'str' ? flatStr(a)[0] !== '' : flatNum(a)[0] !== 0;
  });
  M('__float__', 'self', (a: NdArray) => {
    if (a.size !== 1) throw typeError('only length-1 arrays can be converted to Python scalars');
    return F(a.dtype === 'str' ? Number(flatStr(a)[0]) : flatNum(a)[0]);
  });
  M('__int__', 'self', (a: NdArray) => {
    if (a.size !== 1) throw typeError('only length-1 arrays can be converted to Python scalars');
    return Math.trunc(flatNum(a)[0]);
  });
  M('__index__', 'self', (a: NdArray) => {
    if (a.dtype === 'float64' || a.size !== 1) throw typeError('only integer scalar arrays can be converted to a scalar index');
    return Math.trunc(flatNum(a)[0]);
  });
  M('__contains__', 'self, x', (a: NdArray, x: any) => {
    const c = coerce(x);
    if (c === null) return false;
    return flatNum(O.compare('eq', a, c)).some((v) => v !== 0);
  });
  M('__getitem__', 'self, key', (a: NdArray, key: any) => nd.getItem(a, key));
  M('__setitem__', 'self, key, value', (a: NdArray, key: any, v: any) => {
    nd.setItem(a, key, v);
    return null;
  });
  M('__copy__', 'self', (a: NdArray) => nd.copyOf(a));
  M('__deepcopy__', 'self, memo=', (a: NdArray) => nd.copyOf(a));
  t.dict!.set('__hash__', null);

  // aritmética
  const bin = (name: string, f: (a: NdArray, b: NdArray) => NdArray, reflect = false): void => {
    M(name, 'self, other', (self: NdArray, other: any) => {
      const o = coerce(other);
      if (o === null) return NotImplemented;
      return ret(reflect ? f(o, self) : f(self, o));
    });
  };
  const A = O.arith;
  bin('__add__', (a, b) => A('add', a, b));
  bin('__radd__', (a, b) => A('add', a, b), true);
  bin('__sub__', (a, b) => A('sub', a, b));
  bin('__rsub__', (a, b) => A('sub', a, b), true);
  bin('__mul__', (a, b) => A('mul', a, b));
  bin('__rmul__', (a, b) => A('mul', a, b), true);
  bin('__truediv__', (a, b) => A('div', a, b));
  bin('__rtruediv__', (a, b) => A('div', a, b), true);
  bin('__floordiv__', (a, b) => A('floordiv', a, b));
  bin('__rfloordiv__', (a, b) => A('floordiv', a, b), true);
  bin('__mod__', (a, b) => A('mod', a, b));
  bin('__rmod__', (a, b) => A('mod', a, b), true);
  M('__pow__', 'self, other, mod=', (self: NdArray, other: any) => {
    const o = coerce(other);
    return o === null ? NotImplemented : ret(A('pow', self, o));
  });
  M('__rpow__', 'self, other, mod=', (self: NdArray, other: any) => {
    const o = coerce(other);
    return o === null ? NotImplemented : ret(A('pow', o, self));
  });
  bin('__matmul__', (a, b) => O.matmul(a, b));
  bin('__rmatmul__', (a, b) => O.matmul(a, b), true);
  bin('__and__', (a, b) => O.bitwise('and', a, b));
  bin('__rand__', (a, b) => O.bitwise('and', a, b), true);
  bin('__or__', (a, b) => O.bitwise('or', a, b));
  bin('__ror__', (a, b) => O.bitwise('or', a, b), true);
  bin('__xor__', (a, b) => O.bitwise('xor', a, b));
  bin('__rxor__', (a, b) => O.bitwise('xor', a, b), true);
  for (const [n, op] of [['eq', 'eq'], ['ne', 'ne'], ['lt', 'lt'], ['le', 'le'], ['gt', 'gt'], ['ge', 'ge']] as const) bin(`__${n}__`, (a, b) => O.compare(op, a, b));
  M('__neg__', 'self', (a: NdArray) => ret(O.negate(a)));
  M('__pos__', 'self', (a: NdArray) => a);
  M('__abs__', 'self', (a: NdArray) => ret(O.ufunc('abs', a)));
  M('__invert__', 'self', (a: NdArray) => ret(O.invert(a)));
  for (const [n, f, nm] of [
    ['__iadd__', (a: NdArray, b: NdArray) => A('add', a, b), 'add'],
    ['__isub__', (a: NdArray, b: NdArray) => A('sub', a, b), 'subtract'],
    ['__imul__', (a: NdArray, b: NdArray) => A('mul', a, b), 'multiply'],
    ['__itruediv__', (a: NdArray, b: NdArray) => A('div', a, b), 'divide'],
    ['__ifloordiv__', (a: NdArray, b: NdArray) => A('floordiv', a, b), 'floor_divide'],
    ['__imod__', (a: NdArray, b: NdArray) => A('mod', a, b), 'remainder'],
    ['__ipow__', (a: NdArray, b: NdArray) => A('pow', a, b), 'power'],
    ['__iand__', (a: NdArray, b: NdArray) => O.bitwise('and', a, b), 'bitwise_and'],
    ['__ior__', (a: NdArray, b: NdArray) => O.bitwise('or', a, b), 'bitwise_or'],
  ] as const) {
    const [sig, impl] = inplace(nm, f);
    M(n, sig, impl);
  }

  // forma
  M('reshape', 'self, *shape, order=', (a: NdArray, shape: PyTuple) => {
    const s = shape.a.length === 1 && (shape.a[0] instanceof PyTuple || shape.a[0] instanceof PyList) ? shapeArg(shape.a[0]) : shape.a.map((x: any) => intArg(x));
    return nd.reshapeTo(a, s);
  });
  M('ravel', 'self, order=', (a: NdArray) => nd.reshapeTo(a, [a.size]));
  M('flatten', 'self, order=', (a: NdArray) => nd.reshapeTo(nd.copyOf(a), [a.size]));
  M('copy', 'self, order=', (a: NdArray) => nd.copyOf(a));
  M('view', 'self, dtype=, type=', (a: NdArray) => new NdArray(a.buf, a.shape.slice(), a.strides.slice(), a.offset, a.dtype, a.base ?? a));
  M('astype', 'self, dtype, order=, casting=, subok=, copy=', (a: NdArray, dt: any) => nd.astype(a, dtypeArg(dt) as DType));
  M('tolist', 'self', (a: NdArray) => (a.ndim === 0 ? itemOf(a) : nd.toPyList(a)));
  M('item', 'self, *args', (a: NdArray, args: PyTuple) => {
    if (args.a.length === 0) {
      if (a.size !== 1) throw valueError('can only convert an array of size 1 to a Python scalar');
      return itemOf(a);
    }
    return nd.getItem(a, args.a.length === 1 ? args.a[0] : new PyTuple(args.a));
  });
  M('fill', 'self, value', (a: NdArray, v: any) => {
    assignAll(a, arr(v));
    return null;
  });
  M('transpose', 'self, *axes', (a: NdArray, axes: PyTuple) => nd.transposeAxes(a, axes.a.length === 0 ? undefined : (axes.a.length === 1 && (axes.a[0] instanceof PyTuple || axes.a[0] instanceof PyList) ? (axes.a[0] as PyTuple).a : axes.a).map((x: any) => nd.normAxis(intArg(x), a.ndim))));
  M('swapaxes', 'self, a1, a2', (a: NdArray, x: any, y: any) => {
    const p = a.shape.map((_, i) => i);
    const i = nd.normAxis(intArg(x), a.ndim);
    const j = nd.normAxis(intArg(y), a.ndim);
    [p[i], p[j]] = [p[j], p[i]];
    return nd.transposeAxes(a, p);
  });
  M('squeeze', 'self, axis=', (a: NdArray, axis: any) => O.squeeze(a, axesArg(axis)));
  M('diagonal', 'self, offset=, axis1=, axis2=', (a: NdArray, off: any) => diagonal(a, isNone(off) ? 0 : intArg(off)));
  M('trace', 'self, offset=, axis1=, axis2=, dtype=, out=', (a: NdArray) => {
    const r = O.trace(a);
    return scalarToPy(a.dtype === 'float64' ? 'float64' : 'int64', r);
  });
  M('nonzero', 'self', (a: NdArray) => new PyTuple(nd.nonzero(a)));
  M('take', 'self, indices, axis=, out=, mode=', (a: NdArray, idx: any, axis: any) => takeFn(a, idx, axis));
  M('repeat', 'self, repeats, axis=', (a: NdArray, reps: any, axis: any) => O.repeat(a, repsArg(reps), axisArg(axis)));
  M('dot', 'self, b, out=', (a: NdArray, b: any) => ret(O.dot(a, arr(b))));
  M('searchsorted', 'self, v, side=, sorter=', (a: NdArray, v: any, side: any) => ret(O.searchsorted(a, arr(v), side === 'right')));
  M('conj', 'self', (a: NdArray) => a);
  M('conjugate', 'self', (a: NdArray) => a);
  M('sort', 'self, axis=, kind=, order=, stable=', (a: NdArray, axis: any) => {
    assignAll(a, nd.sortAxis(a, isNone(axis) ? -1 : intArg(axis), false));
    return null;
  });
  M('argsort', 'self, axis=, kind=, order=, stable=', (a: NdArray, axis: any) => nd.sortAxis(a, isNone(axis) ? -1 : intArg(axis), true));
  M('clip', 'self, min=, max=, out=', (a: NdArray, lo: any, hi: any) => O.clip(a, isNone(lo) ? null : arr(lo), isNone(hi) ? null : arr(hi)));
  M('round', 'self, decimals=, out=', (a: NdArray, d: any) => ret(O.roundTo(a, isNone(d) ? 0 : intArg(d))));

  // reducciones
  const red = (name: string, impl: (a: NdArray, axes: number[] | null, keep: boolean, extra: any) => NdArray, sig = 'self, axis=, dtype=, out=, keepdims=') => {
    M(name, sig, (a: NdArray, axis: any, dtype: any, out: any, keepdims: any) => {
      let r = impl(a, axesArg(axis), bool(keepdims), dtype);
      if (name === 'sum' || name === 'prod' || name === 'mean' || name === 'cumsum') {
        const dt = dtypeArg(dtype);
        if (dt && dt !== r.dtype) r = nd.astype(r, dt);
      }
      return ret(r);
    });
  };
  red('sum', (a, ax, k) => O.sum(a, ax, k));
  red('prod', (a, ax, k) => O.prod(a, ax, k));
  red('mean', (a, ax, k) => O.mean(a, ax, k));
  M('std', 'self, axis=, dtype=, out=, ddof=, keepdims=', (a: NdArray, axis: any, _d: any, _o: any, ddof: any, keep: any) => ret(O.std(a, axesArg(axis), isNone(ddof) ? 0 : intArg(ddof), bool(keep))));
  M('var', 'self, axis=, dtype=, out=, ddof=, keepdims=', (a: NdArray, axis: any, _d: any, _o: any, ddof: any, keep: any) => ret(O.variance(a, axesArg(axis), isNone(ddof) ? 0 : intArg(ddof), bool(keep))));
  M('max', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any, _o: any, keep: any) => ret(O.minmax(a, axesArg(axis), bool(keep), true)));
  M('min', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any, _o: any, keep: any) => ret(O.minmax(a, axesArg(axis), bool(keep), false)));
  M('ptp', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any, _o: any, keep: any) => ret(O.arith('sub', O.minmax(a, axesArg(axis), bool(keep), true), O.minmax(a, axesArg(axis), bool(keep), false))));
  M('argmax', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any) => O.argmax(a, axisArg(axis)));
  M('argmin', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any) => O.argmin(a, axisArg(axis)));
  M('any', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any, _o: any, keep: any) => ret(O.anyAll(a, axesArg(axis), bool(keep), false)));
  M('all', 'self, axis=, out=, keepdims=', (a: NdArray, axis: any, _o: any, keep: any) => ret(O.anyAll(a, axesArg(axis), bool(keep), true)));
  M('cumsum', 'self, axis=, dtype=, out=', (a: NdArray, axis: any) => O.cumsum(a, axisArg(axis)));
  M('cumprod', 'self, axis=, dtype=, out=', (a: NdArray, axis: any) => O.cumprod(a, axisArg(axis)));
  M('count_nonzero', 'self', (a: NdArray) => flatNum(a).reduce((s, v) => s + (v !== 0 ? 1 : 0), 0));
  return t;
}

function repsArg(v: any): number[] {
  if (v instanceof PyTuple || v instanceof PyList) return v.a.map((x: any) => intArg(x));
  if (v instanceof NdArray) return Array.from(flatNum(v));
  return [intArg(v)];
}

function diagonal(a: NdArray, k: number): NdArray {
  const n = a.shape[0];
  const m = a.shape[1];
  const len = Math.max(0, k >= 0 ? Math.min(n, m - k) : Math.min(n + k, m));
  const start = a.offset + (k >= 0 ? k * a.strides[1] : -k * a.strides[0]);
  return new NdArray(a.buf, [len], [a.strides[0] + a.strides[1]], start, a.dtype, a.base ?? a);
}

function takeFn(a: NdArray, idx: any, axis: any): any {
  const ix = arr(idx);
  if (isNone(axis)) {
    const flat = nd.reshapeTo(a, [a.size]);
    const norm = Float64Array.from(flatNum(ix), (v) => (v < 0 ? v + a.size : v));
    for (const v of norm) if (v < 0 || v >= a.size) throw indexError(`index ${v} is out of bounds for axis 0 with size ${a.size}`);
    const r = O.takeAxis(flat, norm, 0);
    return ix.ndim === 0 ? ret(nd.reshapeTo(r, [])) : nd.reshapeTo(r, ix.shape);
  }
  const ax = nd.normAxis(intArg(axis), a.ndim);
  const n = a.shape[ax];
  const norm = Float64Array.from(flatNum(ix), (v) => (v < 0 ? v + n : v));
  for (const v of norm) if (v < 0 || v >= n) throw indexError(`index ${v} is out of bounds for axis ${ax} with size ${n}`);
  const r = O.takeAxis(a, norm, ax);
  if (ix.ndim === 1) return r;
  const shape = [...a.shape.slice(0, ax), ...ix.shape, ...a.shape.slice(ax + 1)];
  return nd.reshapeTo(r, shape);
}

// ───────────────────────── funciones del módulo ─────────────────────────

function aranger(args: any[], dtypeV: any): NdArray {
  const nums = args.filter((x) => x !== undefined);
  let start = 0;
  let stop: number;
  let step = 1;
  if (nums.length === 1) stop = numArg(nums[0]);
  else {
    start = numArg(nums[0]);
    stop = numArg(nums[1]);
    if (nums.length > 2 && !isNone(nums[2])) step = numArg(nums[2]);
  }
  if (step === 0) throw makeExc(E.ZeroDivisionError, ['Maximum allowed size exceeded']);
  const isFloat = nums.some((x) => x instanceof PyFloat);
  const dt: DType = dtypeArg(dtypeV) ?? (isFloat ? 'float64' : 'int64');
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return mkNum(out, [n], dt);
}

function linspace(start: number, stop: number, num: number, endpoint: boolean): Float64Array {
  const out = new Float64Array(num);
  const div = endpoint ? num - 1 : num;
  const step = div > 0 ? (stop - start) / div : 0;
  for (let i = 0; i < num; i++) out[i] = div > 0 ? start + i * step : start;
  if (endpoint && num > 1) out[num - 1] = stop;
  return out;
}

function seqArrays(x: any): NdArray[] {
  const items = x instanceof PyTuple || x instanceof PyList ? x.a : ops.iterToArray(x);
  return items.map(arr);
}

function atLeast(a: NdArray, n: number): NdArray {
  if (a.ndim >= n) return a;
  if (n === 1) return nd.reshapeTo(a, [1]);
  if (n === 2) return a.ndim === 0 ? nd.reshapeTo(a, [1, 1]) : nd.reshapeTo(a, [1, a.shape[0]]);
  return a.ndim === 0 ? nd.reshapeTo(a, [1, 1, 1]) : a.ndim === 1 ? nd.reshapeTo(a, [1, a.shape[0], 1]) : nd.reshapeTo(a, [...a.shape, 1]);
}

function splitFn(a: NdArray, spec: any, axis: number, equal: boolean): PyList {
  const ax = nd.normAxis(axis, a.ndim);
  const n = a.shape[ax];
  let bounds: number[];
  if (spec instanceof PyList || spec instanceof PyTuple || spec instanceof NdArray) {
    const idx = spec instanceof NdArray ? Array.from(flatNum(spec)) : spec.a.map((x: any) => intArg(x));
    bounds = [0, ...idx, n];
  } else {
    const k = intArg(spec);
    if (equal && n % k !== 0) throw valueError('array split does not result in an equal division');
    const base = Math.floor(n / k);
    const extra = n % k;
    bounds = [0];
    for (let i = 0; i < k; i++) bounds.push(bounds[i] + base + (i < extra ? 1 : 0));
  }
  const out: NdArray[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const lo = Math.min(Math.max(bounds[i], 0), n);
    const hi = Math.min(Math.max(bounds[i + 1], lo), n);
    out.push(O.takeAxis(a, Float64Array.from({ length: hi - lo }, (_, j) => lo + j), ax));
  }
  return new PyList(out);
}

function uniqueFn(a: NdArray, retIndex: boolean, retInverse: boolean, retCounts: boolean, axis: number | null): any {
  if (axis !== null && a.ndim > 1) {
    const ax = nd.normAxis(axis, a.ndim);
    const perm = [ax, ...a.shape.map((_, i) => i).filter((i) => i !== ax)];
    const moved = nd.copyOf(nd.transposeAxes(a, perm));
    const rows = moved.shape[0];
    const w = moved.size / Math.max(rows, 1);
    const d = flatNum(moved);
    const order = Array.from({ length: rows }, (_, i) => i).sort((i, j) => {
      for (let k = 0; k < w; k++) {
        const c = nd.cmpNum(d[i * w + k], d[j * w + k]);
        if (c) return c;
      }
      return i - j;
    });
    const keyOf = (i: number): string => Array.from(d.subarray(i * w, (i + 1) * w)).join(',');
    const keep: number[] = [];
    const inverse = new Array<number>(rows);
    const counts: number[] = [];
    let last = '';
    for (const i of order) {
      const k = keyOf(i);
      if (keep.length === 0 || k !== last) {
        keep.push(i);
        counts.push(1);
        last = k;
      } else counts[counts.length - 1]++;
      inverse[i] = keep.length - 1;
    }
    const vals = O.takeAxis(moved, Float64Array.from(keep), 0);
    const inv = new Array<number>(perm.length);
    perm.forEach((p, i) => (inv[p] = i));
    const res = nd.copyOf(nd.transposeAxes(vals, inv));
    const outs: any[] = [res];
    if (retIndex) outs.push(mkNum(Float64Array.from(keep), [keep.length], 'int64'));
    if (retInverse) outs.push(mkNum(Float64Array.from(inverse), [rows], 'int64'));
    if (retCounts) outs.push(mkNum(Float64Array.from(counts), [counts.length], 'int64'));
    return outs.length === 1 ? outs[0] : new PyTuple(outs);
  }
  const u = O.unique(a);
  const outs: any[] = [u.values];
  if (retIndex) outs.push(mkNum(Float64Array.from(u.index), [u.index.length], 'int64'));
  if (retInverse) outs.push(mkNum(Float64Array.from(u.inverse), [u.inverse.length], 'int64'));
  if (retCounts) outs.push(mkNum(Float64Array.from(u.counts), [u.counts.length], 'int64'));
  return outs.length === 1 ? outs[0] : new PyTuple(outs);
}

function nanFilter(a: NdArray, axes: number[] | null, keep: boolean, f: (v: Float64Array) => number, dt: DType = 'float64'): NdArray {
  return nd.reduceAxes(a, axes, { group: (v) => f(v.filter((x) => x === x)) }, dt, keep);
}

function polyfit(x: NdArray, y: NdArray, deg: number): NdArray {
  const xs = flatNum(x);
  const ys = flatNum(y);
  const n = xs.length;
  const V = new Float64Array(n * (deg + 1));
  for (let i = 0; i < n; i++) for (let j = 0; j <= deg; j++) V[i * (deg + 1) + j] = Math.pow(xs[i], deg - j);
  const A: L.Mat = { d: V, n, m: deg + 1 };
  const p = L.pinv(A);
  const out = new Float64Array(deg + 1);
  for (let j = 0; j <= deg; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += p.d[j * n + i] * ys[i];
    out[j] = s;
  }
  return mkNum(out, [deg + 1], 'float64');
}

function install(m: PyModule): void {
  const t = ensureTypes();
  m.dict!.set('ndarray', t);
  m.dict!.set('dtype', dtypeType);
  m.dict!.set('AxisError', axisError);
  const f = (name: string, sig: string, impl: (...a: any[]) => any): void => mfn(m, name, sig, impl);

  // constantes
  mconst(m, { pi: F(Math.PI), e: F(Math.E), inf: F(Infinity), nan: F(NaN), newaxis: null, euler_gamma: F(0.5772156649015329), Inf: F(Infinity), PINF: F(Infinity), NINF: F(-Infinity), NAN: F(NaN) });
  mconst(m, { __version__: '2.5.3-dojo' });

  // tipos escalares usados como dtype
  const scalar = (name: string, dt: DType, conv: (x: any) => any): void => {
    const fnObj = mkNative(name, 'x=', (x?: any) => (x === undefined ? conv(0) : conv(x)), { module: 'numpy' });
    SCALAR_TYPES.set(fnObj, dt);
    m.dict!.set(name, fnObj);
  };
  const toF = (x: any): any => (x instanceof NdArray ? (x.ndim === 0 ? F(Number(flatNum(x)[0])) : nd.astype(x, 'float64')) : F(numArg(typeof x === 'string' ? F(Number(x)) : x)));
  const toI = (x: any): any => (x instanceof NdArray ? nd.astype(x, 'int64') : Math.trunc(numArg(typeof x === 'string' ? F(Number(x)) : x)));
  scalar('float64', 'float64', toF);
  scalar('float32', 'float64', (x) => (x instanceof NdArray ? toF(x) : F(Math.fround(numArg(x)))));
  scalar('float16', 'float64', toF);
  scalar('double', 'float64', toF);
  scalar('int64', 'int64', toI);
  scalar('int32', 'int64', toI);
  scalar('int16', 'int64', toI);
  scalar('int8', 'int64', toI);
  scalar('uint8', 'int64', toI);
  scalar('uint16', 'int64', toI);
  scalar('uint32', 'int64', toI);
  scalar('uint64', 'int64', toI);
  scalar('int_', 'int64', toI);
  scalar('intp', 'int64', toI);
  scalar('bool_', 'bool', (x) => ops.truthy(x));
  scalar('str_', 'str', (x) => ops.str(x));
  m.dict!.set('bool', m.dict!.get('bool_'));
  m.dict!.set('float_', m.dict!.get('float64'));

  // creación
  f('array', 'object, dtype=, copy=, order=, subok=, ndmin=', (o: any, dt: any, copy: any, _or: any, _s: any, ndmin: any) => {
    let a = fromPy(o, dtypeArg(dt));
    if (a === o || bool(copy, true)) a = a === o ? nd.copyOf(a) : a;
    const nm = isNone(ndmin) ? 0 : intArg(ndmin);
    if (a.ndim < nm) a = nd.reshapeTo(a, [...new Array(nm - a.ndim).fill(1), ...a.shape]);
    return a;
  });
  f('asarray', 'a, dtype=, order=', (o: any, dt: any) => fromPy(o, dtypeArg(dt)));
  f('asanyarray', 'a, dtype=', (o: any, dt: any) => fromPy(o, dtypeArg(dt)));
  f('ascontiguousarray', 'a, dtype=', (o: any, dt: any) => nd.copyOf(fromPy(o, dtypeArg(dt))));
  f('copy', 'a, order=', (a: any) => nd.copyOf(arr(a)));
  f('zeros', 'shape, dtype=, order=', (s: any, dt: any) => nd.zerosOf(shapeArg(s), dtypeArg(dt) ?? 'float64'));
  f('empty', 'shape, dtype=, order=', (s: any, dt: any) => nd.zerosOf(shapeArg(s), dtypeArg(dt) ?? 'float64'));
  f('ones', 'shape, dtype=, order=', (s: any, dt: any) => {
    const shape = shapeArg(s);
    return mkNum(new Float64Array(sizeOf(shape)).fill(1), shape, dtypeArg(dt) ?? 'float64');
  });
  f('full', 'shape, fill_value, dtype=, order=', (s: any, v: any, dt: any) => {
    const shape = shapeArg(s);
    const val = fromPy(v, dtypeArg(dt));
    const out = nd.zerosOf(shape, val.dtype);
    assignAll(out, val);
    return out;
  });
  f('zeros_like', 'a, dtype=, order=, subok=, shape=', (a: any, dt: any, _o: any, _s: any, sh: any) => nd.zerosOf(isNone(sh) ? arr(a).shape : shapeArg(sh), dtypeArg(dt) ?? arr(a).dtype));
  f('empty_like', 'a, dtype=, order=, subok=, shape=', (a: any, dt: any, _o: any, _s: any, sh: any) => nd.zerosOf(isNone(sh) ? arr(a).shape : shapeArg(sh), dtypeArg(dt) ?? arr(a).dtype));
  f('ones_like', 'a, dtype=, order=, subok=, shape=', (a: any, dt: any, _o: any, _s: any, sh: any) => {
    const shape = isNone(sh) ? arr(a).shape : shapeArg(sh);
    return mkNum(new Float64Array(sizeOf(shape)).fill(1), shape, dtypeArg(dt) ?? arr(a).dtype);
  });
  f('full_like', 'a, fill_value, dtype=, order=, subok=, shape=', (a: any, v: any, dt: any) => {
    const x = arr(a);
    const out = nd.zerosOf(x.shape, dtypeArg(dt) ?? x.dtype);
    assignAll(out, arr(v));
    return out;
  });
  f('arange', '*args, dtype=', (args: PyTuple, dt: any) => aranger(args.a, dt));
  f('linspace', 'start, stop, num=, endpoint=, retstep=, dtype=, axis=', (a: any, b: any, num: any, ep: any, rs: any, dt: any) => {
    const n = isNone(num) ? 50 : intArg(num);
    const endpoint = bool(ep, true);
    const r = mkNum(linspace(numArg(a), numArg(b), n, endpoint), [n], 'float64');
    const res = dtypeArg(dt) ? nd.astype(r, dtypeArg(dt) as DType) : r;
    if (bool(rs)) return new PyTuple([res, F(n > 1 ? (numArg(b) - numArg(a)) / (endpoint ? n - 1 : n) : NaN)]);
    return res;
  });
  f('logspace', 'start, stop, num=, endpoint=, base=, dtype=', (a: any, b: any, num: any, ep: any, base: any) => {
    const n = isNone(num) ? 50 : intArg(num);
    const bs = isNone(base) ? 10 : numArg(base);
    return mkNum(linspace(numArg(a), numArg(b), n, bool(ep, true)).map((v) => Math.pow(bs, v)), [n], 'float64');
  });
  f('eye', 'N, M=, k=, dtype=, order=', (n: any, mm: any, k: any, dt: any) => {
    const N = intArg(n);
    const Mc = isNone(mm) ? N : intArg(mm);
    const kk = isNone(k) ? 0 : intArg(k);
    const out = new Float64Array(N * Mc);
    for (let i = 0; i < N; i++) if (i + kk >= 0 && i + kk < Mc) out[i * Mc + i + kk] = 1;
    return mkNum(out, [N, Mc], dtypeArg(dt) ?? 'float64');
  });
  f('identity', 'n, dtype=', (n: any, dt: any) => {
    const N = intArg(n);
    const out = new Float64Array(N * N);
    for (let i = 0; i < N; i++) out[i * N + i] = 1;
    return mkNum(out, [N, N], dtypeArg(dt) ?? 'float64');
  });
  f('diag', 'v, k=', (v: any, k: any) => {
    const a = arr(v);
    const kk = isNone(k) ? 0 : intArg(k);
    if (a.ndim === 1) {
      const n = a.shape[0] + Math.abs(kk);
      const out = nd.zerosOf([n, n], a.dtype);
      const d = flatNum(a);
      for (let i = 0; i < d.length; i++) out.num[(kk >= 0 ? i : i - kk) * n + (kk >= 0 ? i + kk : i)] = d[i];
      return out;
    }
    return nd.copyOf(diagonal(a, kk));
  });
  f('diagonal', 'a, offset=, axis1=, axis2=', (a: any, k: any) => nd.copyOf(diagonal(arr(a), isNone(k) ? 0 : intArg(k))));
  const tri = (name: string, keep: (i: number, j: number, k: number) => boolean): void =>
    f(name, 'm, k=', (mm: any, k: any) => {
      const a = arr(mm);
      const kk = isNone(k) ? 0 : intArg(k);
      const out = nd.copyOf(a);
      const r = a.shape[a.ndim - 2];
      const c = a.shape[a.ndim - 1];
      const d = out.num;
      for (let b = 0; b < a.size / (r * c); b++) for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (!keep(i, j, kk)) d[b * r * c + i * c + j] = 0;
      return out;
    });
  tri('triu', (i, j, k) => j - i >= k);
  tri('tril', (i, j, k) => j - i <= k);
  f('tri', 'N, M=, k=, dtype=', (n: any, mm: any, k: any) => {
    const N = intArg(n);
    const Mc = isNone(mm) ? N : intArg(mm);
    const kk = isNone(k) ? 0 : intArg(k);
    const out = new Float64Array(N * Mc);
    for (let i = 0; i < N; i++) for (let j = 0; j < Mc; j++) out[i * Mc + j] = j - i <= kk ? 1 : 0;
    return mkNum(out, [N, Mc], 'float64');
  });
  f('meshgrid', '*xi, indexing=, sparse=, copy=', (xi: PyTuple, indexing: any) => {
    const xs = xi.a.map((x: any) => nd.reshapeTo(arr(x), [-1]));
    const ij = indexing === 'ij';
    const shape = xs.map((x) => x.size);
    if (!ij && xs.length >= 2) [shape[0], shape[1]] = [shape[1], shape[0]];
    return new PyTuple(xs.map((x, k) => {
      let axis = k;
      if (!ij && xs.length >= 2 && k < 2) axis = 1 - k;
      const sh = shape.map((_, d) => (d === axis ? x.size : 1));
      return nd.copyOf(nd.broadcastTo(nd.reshapeTo(x, sh), shape));
    }));
  });

  // forma
  f('reshape', 'a, *shape, newshape=, shape=, order=', (a: any, sh: PyTuple, newshape: any, shape2: any) => {
    const spec = sh.a.length ? (sh.a.length === 1 ? sh.a[0] : new PyTuple(sh.a)) : !isNone(shape2) ? shape2 : newshape;
    return nd.reshapeTo(arr(a), shapeArg(spec));
  });
  f('ravel', 'a, order=', (a: any) => nd.reshapeTo(arr(a), [arr(a).size]));
  f('transpose', 'a, axes=', (a: any, axes: any) => nd.transposeAxes(arr(a), isNone(axes) ? undefined : axesArg(axes)!.map((x) => nd.normAxis(x, arr(a).ndim))));
  f('swapaxes', 'a, axis1, axis2', (a: any, x: any, y: any) => {
    const A = arr(a);
    const p = A.shape.map((_, i) => i);
    const i = nd.normAxis(intArg(x), A.ndim);
    const j = nd.normAxis(intArg(y), A.ndim);
    [p[i], p[j]] = [p[j], p[i]];
    return nd.transposeAxes(A, p);
  });
  f('moveaxis', 'a, source, destination', (a: any, s: any, d: any) => {
    const A = arr(a);
    const src = nd.normAxis(intArg(s), A.ndim);
    const dst = nd.normAxis(intArg(d), A.ndim);
    const order = A.shape.map((_, i) => i).filter((i) => i !== src);
    order.splice(dst, 0, src);
    return nd.transposeAxes(A, order);
  });
  f('expand_dims', 'a, axis', (a: any, ax: any) => {
    let A = arr(a);
    const axes = axesArg(ax)!;
    const nd2 = A.ndim + axes.length;
    for (const x of axes.map((v) => (v < 0 ? v + nd2 : v)).sort((p, q) => p - q)) A = O.expandDims(A, x);
    return A;
  });
  f('squeeze', 'a, axis=', (a: any, ax: any) => O.squeeze(arr(a), axesArg(ax)));
  f('atleast_1d', '*arys', (xs: PyTuple) => (xs.a.length === 1 ? atLeast(arr(xs.a[0]), 1) : new PyTuple(xs.a.map((x: any) => atLeast(arr(x), 1)))));
  f('atleast_2d', '*arys', (xs: PyTuple) => (xs.a.length === 1 ? atLeast(arr(xs.a[0]), 2) : new PyTuple(xs.a.map((x: any) => atLeast(arr(x), 2)))));
  f('atleast_3d', '*arys', (xs: PyTuple) => (xs.a.length === 1 ? atLeast(arr(xs.a[0]), 3) : new PyTuple(xs.a.map((x: any) => atLeast(arr(x), 3)))));
  f('concatenate', 'arrays, axis=, out=, dtype=', (xs: any, axis: any) => O.concatenate(seqArrays(xs), isNone(axis) ? (axis === null ? null : 0) : intArg(axis)));
  f('stack', 'arrays, axis=, out=', (xs: any, axis: any) => O.stack(seqArrays(xs), isNone(axis) ? 0 : intArg(axis)));
  f('vstack', 'tup', (xs: any) => O.concatenate(seqArrays(xs).map((x) => atLeast(x, 2)), 0));
  f('row_stack', 'tup', (xs: any) => O.concatenate(seqArrays(xs).map((x) => atLeast(x, 2)), 0));
  f('hstack', 'tup', (xs: any) => {
    const a = seqArrays(xs).map((x) => atLeast(x, 1));
    return O.concatenate(a, a[0].ndim === 1 ? 0 : 1);
  });
  f('dstack', 'tup', (xs: any) => O.concatenate(seqArrays(xs).map((x) => atLeast(x, 3)), 2));
  f('column_stack', 'tup', (xs: any) => O.concatenate(seqArrays(xs).map((x) => (x.ndim < 2 ? nd.reshapeTo(x, [x.size, 1]) : x)), 1));
  f('split', 'ary, indices_or_sections, axis=', (a: any, s: any, ax: any) => splitFn(arr(a), s, isNone(ax) ? 0 : intArg(ax), true));
  f('array_split', 'ary, indices_or_sections, axis=', (a: any, s: any, ax: any) => splitFn(arr(a), s, isNone(ax) ? 0 : intArg(ax), false));
  f('hsplit', 'ary, indices_or_sections', (a: any, s: any) => splitFn(arr(a), s, arr(a).ndim === 1 ? 0 : 1, true));
  f('vsplit', 'ary, indices_or_sections', (a: any, s: any) => splitFn(arr(a), s, 0, true));
  f('tile', 'A, reps', (a: any, r: any) => O.tile(arr(a), repsArg(r)));
  f('repeat', 'a, repeats, axis=', (a: any, r: any, ax: any) => O.repeat(arr(a), repsArg(r), axisArg(ax)));
  f('flip', 'm, axis=', (a: any, ax: any) => O.flip(arr(a), axesArg(ax)));
  f('fliplr', 'm', (a: any) => O.flip(arr(a), [1]));
  f('flipud', 'm', (a: any) => O.flip(arr(a), [0]));
  f('roll', 'a, shift, axis=', (a: any, s: any, ax: any) => O.roll(arr(a), intArg(s), axisArg(ax)));
  f('rot90', 'm, k=, axes=', (a: any, k: any) => {
    const A = arr(a);
    let r = A;
    const kk = (((isNone(k) ? 1 : intArg(k)) % 4) + 4) % 4;
    for (let i = 0; i < kk; i++) r = O.flip(nd.transposeAxes(r, [1, 0, ...r.shape.slice(2).map((_, j) => j + 2)]), [0]);
    return nd.copyOf(r);
  });
  f('broadcast_to', 'array, shape, subok=', (a: any, s: any) => nd.broadcastTo(arr(a), shapeArg(s)));
  f('broadcast_arrays', '*args', (xs: PyTuple) => {
    const as = xs.a.map(arr);
    const shape = as.reduce((s, x) => nd.broadcastShapes(s, x.shape), [] as number[]);
    return new PyList(as.map((x) => nd.broadcastTo(x, shape)));
  });
  f('append', 'arr, values, axis=', (a: any, v: any, ax: any) => O.concatenate([arr(a), arr(v)], isNone(ax) ? null : intArg(ax)));
  f('delete', 'arr, obj, axis=', (a: any, obj: any, ax: any) => {
    const A = isNone(ax) ? nd.reshapeTo(arr(a), [arr(a).size]) : arr(a);
    const axis = isNone(ax) ? 0 : nd.normAxis(intArg(ax), A.ndim);
    const n = A.shape[axis];
    const drop = new Set<number>();
    if (obj instanceof PySlice) {
      const [s, e, st] = ops.sliceIndices(obj, n);
      for (let i = s; st > 0 ? i < e : i > e; i += st) drop.add(i);
    } else for (const v of flatNum(arr(obj))) drop.add(v < 0 ? v + n : v);
    return O.takeAxis(A, Float64Array.from(Array.from({ length: n }, (_, i) => i).filter((i) => !drop.has(i))), axis);
  });
  f('insert', 'arr, obj, values, axis=', (a: any, obj: any, v: any, ax: any) => {
    const A = isNone(ax) ? nd.reshapeTo(arr(a), [arr(a).size]) : arr(a);
    const axis = isNone(ax) ? 0 : nd.normAxis(intArg(ax), A.ndim);
    const i = intArg(obj);
    const idx = i < 0 ? i + A.shape[axis] : i;
    const head = O.takeAxis(A, Float64Array.from({ length: idx }, (_, j) => j), axis);
    const tail = O.takeAxis(A, Float64Array.from({ length: A.shape[axis] - idx }, (_, j) => idx + j), axis);
    let val = arr(v);
    if (A.ndim > 1 && val.ndim < A.ndim) val = nd.reshapeTo(val, A.shape.map((s, d) => (d === axis ? 1 : s)).map((s, d) => (d === axis ? 1 : s)));
    return O.concatenate([head, val.ndim === A.ndim ? val : nd.reshapeTo(val, [val.size]), tail], axis);
  });

  // selección
  f('where', 'condition, x=, y=', (c: any, x: any, y: any) => {
    if (x === undefined) return new PyTuple(nd.nonzero(arr(c)));
    return ret(O.where3(arr(c), arr(x), arr(y)));
  });
  f('nonzero', 'a', (a: any) => new PyTuple(nd.nonzero(arr(a))));
  f('argwhere', 'a', (a: any) => {
    const idx = nd.nonzero(arr(a));
    const n = idx.length ? idx[0].size : 0;
    const out = new Float64Array(n * idx.length);
    idx.forEach((ix, d) => flatNum(ix).forEach((v, i) => (out[i * idx.length + d] = v)));
    return mkNum(out, [n, idx.length], 'int64');
  });
  f('flatnonzero', 'a', (a: any) => nd.nonzero(nd.reshapeTo(arr(a), [arr(a).size]))[0]);
  f('take', 'a, indices, axis=, out=, mode=', (a: any, i: any, ax: any) => takeFn(arr(a), i, ax));
  f('take_along_axis', 'arr, indices, axis', (a: any, i: any, ax: any) => {
    const A = arr(a);
    const I = arr(i);
    const axis = nd.normAxis(intArg(ax), A.ndim);
    const out = nd.zerosOf(I.shape, A.dtype);
    const offs = nd.offsetsOf(I.shape, nd.cStrides(I.shape), 0);
    void offs;
    const ia = flatNum(I);
    const coord = new Array<number>(I.ndim).fill(0);
    const od = out.num;
    for (let p = 0; p < ia.length; p++) {
      let src = A.offset;
      for (let d = 0; d < A.ndim; d++) src += (d === axis ? (ia[p] < 0 ? ia[p] + A.shape[axis] : ia[p]) : coord[d]) * A.strides[d];
      od[p] = A.num[src];
      for (let d = I.ndim - 1; d >= 0; d--) {
        coord[d]++;
        if (coord[d] < I.shape[d]) break;
        coord[d] = 0;
      }
    }
    return out;
  });
  f('put_along_axis', 'arr, indices, values, axis', (a: any, i: any, v: any, ax: any) => {
    const A = arr(a);
    const I = arr(i);
    const axis = nd.normAxis(intArg(ax), A.ndim);
    let V = arr(v);
    if (V.shape.length !== I.shape.length || V.shape.some((s, d) => s !== I.shape[d])) V = nd.broadcastTo(V, I.shape);
    const ia = flatNum(I);
    const va = flatNum(V);
    const coord = new Array<number>(I.ndim).fill(0);
    for (let p = 0; p < ia.length; p++) {
      let dst = A.offset;
      for (let d = 0; d < A.ndim; d++) dst += (d === axis ? (ia[p] < 0 ? ia[p] + A.shape[axis] : ia[p]) : coord[d]) * A.strides[d];
      A.num[dst] = va[p];
      for (let d = I.ndim - 1; d >= 0; d--) {
        coord[d]++;
        if (coord[d] < I.shape[d]) break;
        coord[d] = 0;
      }
    }
    return null;
  });
  f('compress', 'condition, a, axis=', (c: any, a: any, ax: any) => {
    const idx = nd.nonzero(arr(c))[0];
    return O.takeAxis(isNone(ax) ? nd.reshapeTo(arr(a), [arr(a).size]) : arr(a), flatNum(idx), isNone(ax) ? 0 : intArg(ax));
  });
  f('extract', 'condition, arr', (c: any, a: any) => nd.getItem(nd.reshapeTo(arr(a), [arr(a).size]), nd.reshapeTo(arr(c), [arr(c).size])));
  f('select', 'condlist, choicelist, default=', (cl: any, ch: any, d: any) => {
    const conds = seqArrays(cl);
    const choices = seqArrays(ch);
    let res = arr(isNone(d) ? 0 : d);
    for (let i = conds.length - 1; i >= 0; i--) res = O.where3(conds[i], choices[i], res);
    return res;
  });
  f('isin', 'element, test_elements, assume_unique=, invert=', (e: any, t: any, _u: any, inv: any) => {
    const E2 = arr(e);
    const T = arr(t);
    const set = new Set<any>(T.dtype === 'str' ? flatStr(T) : Array.from(flatNum(T)));
    const src: any = E2.dtype === 'str' ? flatStr(E2) : flatNum(E2);
    const invert = bool(inv);
    return mkNum(Float64Array.from(src as ArrayLike<any>, (v: any) => (set.has(v) !== invert ? 1 : 0)), E2.shape.slice(), 'bool');
  });
  m.dict!.set('in1d', m.dict!.get('isin'));
  const setop = (name: string, op: (a: Set<any>, b: Set<any>) => any[]): void =>
    f(name, 'ar1, ar2, assume_unique=', (a: any, b: any) => {
      const A = arr(a);
      const B = arr(b);
      const str = A.dtype === 'str' || B.dtype === 'str';
      const va = new Set<any>(str ? flatStr(nd.astype(A, 'str')) : Array.from(flatNum(A)));
      const vb = new Set<any>(str ? flatStr(nd.astype(B, 'str')) : Array.from(flatNum(B)));
      const res = op(va, vb).sort((x, y) => (str ? (x < y ? -1 : x > y ? 1 : 0) : x - y));
      return str ? mkStr(res, [res.length]) : mkNum(Float64Array.from(res), [res.length], nd.promote(A.dtype, B.dtype));
    });
  setop('intersect1d', (a, b) => [...a].filter((x) => b.has(x)));
  setop('union1d', (a, b) => [...new Set([...a, ...b])]);
  setop('setdiff1d', (a, b) => [...a].filter((x) => !b.has(x)));
  setop('setxor1d', (a, b) => [...a].filter((x) => !b.has(x)).concat([...b].filter((x) => !a.has(x))));

  // ufuncs de un argumento
  for (const name of ['sqrt', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'arcsinh', 'arccosh', 'arctanh', 'floor', 'ceil', 'trunc', 'rint', 'square', 'sign', 'cbrt', 'reciprocal', 'degrees', 'radians', 'isnan', 'isinf', 'isfinite', 'signbit'] as O.UFunc[])
    f(name, 'x, out=', (x: any) => ret(O.ufunc(name, arr(x))));
  f('abs', 'x, out=', (x: any) => ret(O.ufunc('abs', arr(x))));
  m.dict!.set('absolute', m.dict!.get('abs'));
  m.dict!.set('fabs', m.dict!.get('abs'));
  m.dict!.set('arcsin', m.dict!.get('arcsin'));
  for (const [al, name] of [['asin', 'arcsin'], ['acos', 'arccos'], ['atan', 'arctan'], ['asinh', 'arcsinh'], ['acosh', 'arccosh'], ['atanh', 'arctanh']]) m.dict!.set(al, m.dict!.get(name));
  f('negative', 'x, out=', (x: any) => ret(O.negate(arr(x))));
  f('positive', 'x, out=', (x: any) => arr(x));
  f('invert', 'x', (x: any) => ret(O.invert(arr(x))));
  f('sinc', 'x', (x: any) => ret(nd.ewUnary(arr(x), (v) => (v === 0 ? 1 : Math.sin(Math.PI * v) / (Math.PI * v)), 'float64')));
  f('round', 'a, decimals=, out=', (a: any, d: any) => ret(O.roundTo(arr(a), isNone(d) ? 0 : intArg(d))));
  m.dict!.set('around', m.dict!.get('round'));
  m.dict!.set('round_', m.dict!.get('round'));
  f('clip', 'a, a_min=, a_max=, out=, min=, max=', (a: any, lo: any, hi: any, _o: any, mn: any, mx: any) => {
    const l = !isNone(lo) ? lo : mn;
    const h = !isNone(hi) ? hi : mx;
    return ret(O.clip(arr(a), isNone(l) ? null : arr(l), isNone(h) ? null : arr(h)));
  });
  f('nan_to_num', 'x, copy=, nan=, posinf=, neginf=', (x: any, _c: any, nan: any, pi: any, ni: any) => {
    const A = arr(x);
    const big = 1.7976931348623157e308;
    return ret(nd.ewUnary(A, (v) => (v !== v ? (isNone(nan) ? 0 : numArg(nan)) : v === Infinity ? (isNone(pi) ? big : numArg(pi)) : v === -Infinity ? (isNone(ni) ? -big : numArg(ni)) : v), A.dtype === 'str' ? 'float64' : A.dtype));
  });

  // ufuncs de dos argumentos
  const binf = (name: string, op: O.ArithOp): void => f(name, 'x1, x2, out=', (a: any, b: any) => ret(O.arith(op, arr(a), arr(b))));
  binf('add', 'add');
  binf('subtract', 'sub');
  binf('multiply', 'mul');
  binf('divide', 'div');
  binf('true_divide', 'div');
  binf('floor_divide', 'floordiv');
  binf('mod', 'mod');
  binf('remainder', 'mod');
  binf('power', 'pow');
  binf('float_power', 'pow');
  binf('maximum', 'max');
  binf('minimum', 'min');
  binf('fmax', 'max');
  binf('fmin', 'min');
  binf('arctan2', 'arctan2');
  binf('hypot', 'hypot');
  // objetos «ufunc» con `.at`, `.reduce`, `.accumulate` y `.outer` para las operaciones binarias más usadas
  {
    const ufuncType = newNativeType('ufunc', 'numpy', [objectType]);
    const mk = (name: string, op: O.ArithOp, fn: (x: number, y: number) => number, reduceName: string): void => {
      const base = m.dict!.get(name);
      const obj = new PyObject(ufuncType) as any;
      obj.fn = base;
      const put = (k: string, sig: string, impl: (...a: any[]) => any): void => ufuncType.dict!.set(k, mkNative(k, sig, impl, { method: true, owner: 'ufunc' }));
      if (!ufuncType.dict!.has('__call__')) {
        put('__call__', 'self, *args', (self: any, args: PyTuple) => callObj(self.fn, args.a.slice()));
        put('__repr__', 'self', (self: any) => `<ufunc '${self.fn.name}'>`);
        put('at', 'self, a, indices, b=', (self: any, a: any, indices: any, b: any) => {
          const A = a as NdArray;
          const vals = isNone(b) ? null : flatNum(arr(b));
          const apply = (self.fnImpl as (x: number, y: number) => number);
          const idxs = indices instanceof PyTuple ? indices.a.map((x: any) => arr(x)) : [arr(indices)];
          const first = idxs[0];
          const cnt = first.size;
          const rows = idxs.map((ix) => flatNum(nd.broadcastTo(ix, first.shape)));
          const rest = idxs.length >= A.ndim ? 1 : sizeOf(A.shape.slice(idxs.length));
          for (let k = 0; k < cnt; k++) {
            let off = A.offset;
            for (let d = 0; d < idxs.length; d++) {
              let v = rows[d][k];
              if (v < 0) v += A.shape[d];
              if (v < 0 || v >= A.shape[d]) throw indexError(`index ${rows[d][k]} is out of bounds for axis ${d} with size ${A.shape[d]}`);
              off += v * A.strides[d];
            }
            if (rest === 1) {
              const y = vals ? vals[vals.length === 1 ? 0 : k] : 0;
              (A.buf as Float64Array)[off] = apply((A.buf as Float64Array)[off], y);
            } else {
              const sub = A.shape.slice(idxs.length);
              const subStr = A.strides.slice(idxs.length);
              const pos = new Array<number>(sub.length).fill(0);
              for (let r = 0; r < rest; r++) {
                let o2 = off;
                for (let d = 0; d < sub.length; d++) o2 += pos[d] * subStr[d];
                const y = vals ? vals[vals.length === 1 ? 0 : k * rest + r] : 0;
                (A.buf as Float64Array)[o2] = apply((A.buf as Float64Array)[o2], y);
                for (let d = sub.length - 1; d >= 0; d--) {
                  if (++pos[d] < sub[d]) break;
                  pos[d] = 0;
                }
              }
            }
          }
          return null;
        });
        put('reduce', 'self, a, axis=', (self: any, a: any, axis: any) => callObj(m.dict!.get(self.reduceName), [a, isNone(axis) ? 0 : axis]));
        put('accumulate', 'self, a, axis=', (self: any, a: any, axis: any) => {
          const A = arr(a);
          const ax = isNone(axis) ? 0 : intArg(axis);
          const sl = (i: number): NdArray => arr(nd.getItem(A, new PyTuple([...Array.from({ length: (ax < 0 ? ax + A.ndim : ax) }, () => ops.makeSlice(null, null, null)), i])));
          const n = A.shape[ax < 0 ? ax + A.ndim : ax];
          const out: NdArray[] = [];
          let acc: NdArray = sl(0);
          out.push(acc);
          for (let i = 1; i < n; i++) {
            acc = O.arith(self.op, acc, sl(i)) as NdArray;
            out.push(acc);
          }
          return callObj(m.dict!.get('stack'), [new PyList(out), ax]);
        });
        put('outer', 'self, a, b', (self: any, a: any, b: any) => {
          const A = arr(a);
          const B = arr(b);
          const ra = nd.reshapeTo(A, [...A.shape, ...new Array<number>(B.ndim).fill(1)]);
          return O.arith(self.op, ra, B);
        });
      }
      obj.fnImpl = fn;
      obj.op = op;
      obj.reduceName = reduceName;
      m.dict!.set(name, obj);
    };
    mk('add', 'add', (x, y) => x + y, 'sum');
    mk('subtract', 'sub', (x, y) => x - y, 'sum');
    mk('multiply', 'mul', (x, y) => x * y, 'prod');
    mk('maximum', 'max', (x, y) => (x !== x || y !== y ? NaN : Math.max(x, y)), 'max');
    mk('minimum', 'min', (x, y) => (x !== x || y !== y ? NaN : Math.min(x, y)), 'min');
  }
  f('logaddexp', 'x1, x2', (a: any, b: any) => ret(nd.ewBinary(arr(a), arr(b), (x, y) => (x === y && !isFinite(x) ? x : Math.max(x, y) + Math.log1p(Math.exp(-Math.abs(x - y)))), 'float64')));
  f('pad', 'array, pad_width, mode=, constant_values=', (a: any, pw: any, mode: any, cv: any) => {
    const A = arr(a);
    const md = isNone(mode) ? 'constant' : String(mode);
    let widths: [number, number][];
    const raw = pw instanceof PyTuple || pw instanceof PyList ? (pw as PyTuple).a : [pw];
    if (raw.length === 1 && !(raw[0] instanceof PyTuple || raw[0] instanceof PyList)) widths = A.shape.map(() => [intArg(raw[0]), intArg(raw[0])] as [number, number]);
    else if (raw.length === 2 && !(raw[0] instanceof PyTuple || raw[0] instanceof PyList)) widths = A.shape.map(() => [intArg(raw[0]), intArg(raw[1])] as [number, number]);
    else widths = raw.map((w: any) => { const t = w.a ?? w; return t.length === 1 ? [intArg(t[0]), intArg(t[0])] as [number, number] : [intArg(t[0]), intArg(t[1])] as [number, number]; });
    if (widths.length === 1 && A.ndim > 1) widths = A.shape.map(() => widths[0]);
    const outShape = A.shape.map((s, i) => s + widths[i][0] + widths[i][1]);
    const fill = isNone(cv) ? 0 : numArg(cv);
    const out = new Float64Array(sizeOf(outShape));
    if (md === 'constant') out.fill(fill);
    const src = flatNum(A);
    const oStr = nd.cStrides(outShape);
    const idx = new Array<number>(A.ndim).fill(0);
    const total = sizeOf(A.shape);
    for (let k = 0; k < total; k++) {
      let off = 0;
      for (let d = 0; d < A.ndim; d++) off += (idx[d] + widths[d][0]) * oStr[d];
      out[off] = src[k];
      for (let d = A.ndim - 1; d >= 0; d--) {
        if (++idx[d] < A.shape[d]) break;
        idx[d] = 0;
      }
    }
    if (md === 'edge') {
      const pos = new Array<number>(outShape.length).fill(0);
      for (let k = 0; k < out.length; k++) {
        let off = 0;
        for (let d = 0; d < A.ndim; d++) {
          const c = Math.min(Math.max(pos[d] - widths[d][0], 0), A.shape[d] - 1);
          off += c * A.strides[d];
        }
        const inside = pos.every((p, d) => p >= widths[d][0] && p < widths[d][0] + A.shape[d]);
        if (!inside) out[k] = (A.buf as Float64Array)[A.offset + off];
        for (let d = outShape.length - 1; d >= 0; d--) {
          if (++pos[d] < outShape[d]) break;
          pos[d] = 0;
        }
      }
    }
    return ret(mkNum(out, outShape, A.dtype === 'bool' ? 'bool' : A.dtype));
  });
  f('fmod', 'x1, x2', (a: any, b: any) => ret(nd.ewBinary(arr(a), arr(b), (x, y) => x % y, nd.promote(arr(a).dtype, arr(b).dtype))));
  f('copysign', 'x1, x2', (a: any, b: any) => ret(nd.ewBinary(arr(a), arr(b), (x, y) => Math.abs(x) * (y < 0 || Object.is(y, -0) ? -1 : 1), 'float64')));
  for (const [name, op] of [['equal', 'eq'], ['not_equal', 'ne'], ['less', 'lt'], ['less_equal', 'le'], ['greater', 'gt'], ['greater_equal', 'ge']] as [string, O.CmpOp][]) f(name, 'x1, x2, out=', (a: any, b: any) => ret(O.compare(op, arr(a), arr(b))));
  f('logical_and', 'x1, x2, out=', (a: any, b: any) => ret(O.logical('and', arr(a), arr(b))));
  f('logical_or', 'x1, x2, out=', (a: any, b: any) => ret(O.logical('or', arr(a), arr(b))));
  f('logical_xor', 'x1, x2, out=', (a: any, b: any) => ret(O.logical('xor', arr(a), arr(b))));
  f('logical_not', 'x, out=', (a: any) => ret(nd.ewUnary(arr(a), (v) => (v === 0 ? 1 : 0), 'bool')));
  f('bitwise_and', 'x1, x2', (a: any, b: any) => ret(O.bitwise('and', arr(a), arr(b))));
  f('bitwise_or', 'x1, x2', (a: any, b: any) => ret(O.bitwise('or', arr(a), arr(b))));
  f('bitwise_xor', 'x1, x2', (a: any, b: any) => ret(O.bitwise('xor', arr(a), arr(b))));
  f('bitwise_not', 'x', (a: any) => ret(O.invert(arr(a))));
  f('isclose', 'a, b, rtol=, atol=, equal_nan=', (a: any, b: any, rt: any, at: any, en: any) => {
    const r = isNone(rt) ? 1e-5 : numArg(rt);
    const at2 = isNone(at) ? 1e-8 : numArg(at);
    return ret(nd.ewBinary(arr(a), arr(b), (x, y) => ((x !== x && y !== y && bool(en)) || x === y || Math.abs(x - y) <= at2 + r * Math.abs(y) ? 1 : 0), 'bool'));
  });
  f('allclose', 'a, b, rtol=, atol=, equal_nan=', (a: any, b: any, rt: any, at: any, en: any) => {
    const r = isNone(rt) ? 1e-5 : numArg(rt);
    const at2 = isNone(at) ? 1e-8 : numArg(at);
    return flatNum(nd.ewBinary(arr(a), arr(b), (x, y) => ((x !== x && y !== y && bool(en)) || x === y || Math.abs(x - y) <= at2 + r * Math.abs(y) ? 1 : 0), 'bool')).every((v) => v !== 0);
  });
  f('array_equal', 'a1, a2, equal_nan=', (a: any, b: any) => {
    const A = arr(a);
    const B = arr(b);
    if (A.shape.length !== B.shape.length || A.shape.some((s, i) => s !== B.shape[i])) return false;
    return flatNum(O.compare('eq', A, B)).every((v) => v !== 0);
  });
  f('array_equiv', 'a1, a2', (a: any, b: any) => {
    try {
      return flatNum(O.compare('eq', arr(a), arr(b))).every((v) => v !== 0);
    } catch {
      return false;
    }
  });

  // reducciones
  const redf = (name: string, impl: (a: NdArray, ax: number[] | null, keep: boolean, extra: any[]) => NdArray, sig: string): void =>
    f(name, sig, (a: any, ax: any, ...rest: any[]) => ret(impl(arr(a), axesArg(ax), bool(rest[rest.length - 1]), rest)));
  redf('sum', (a, ax, k, r) => {
    let res = O.sum(a, ax, k);
    const dt = dtypeArg(r[0]);
    if (dt && dt !== res.dtype) res = nd.astype(res, dt);
    return res;
  }, 'a, axis=, dtype=, out=, keepdims=');
  redf('prod', (a, ax, k) => O.prod(a, ax, k), 'a, axis=, dtype=, out=, keepdims=');
  redf('mean', (a, ax, k) => O.mean(a, ax, k), 'a, axis=, dtype=, out=, keepdims=');
  f('std', 'a, axis=, dtype=, out=, ddof=, keepdims=', (a: any, ax: any, _d: any, _o: any, ddof: any, k: any) => ret(O.std(arr(a), axesArg(ax), isNone(ddof) ? 0 : intArg(ddof), bool(k))));
  f('var', 'a, axis=, dtype=, out=, ddof=, keepdims=', (a: any, ax: any, _d: any, _o: any, ddof: any, k: any) => ret(O.variance(arr(a), axesArg(ax), isNone(ddof) ? 0 : intArg(ddof), bool(k))));
  f('max', 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(O.minmax(arr(a), axesArg(ax), bool(k), true)));
  f('min', 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(O.minmax(arr(a), axesArg(ax), bool(k), false)));
  m.dict!.set('amax', m.dict!.get('max'));
  m.dict!.set('amin', m.dict!.get('min'));
  f('ptp', 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(O.arith('sub', O.minmax(arr(a), axesArg(ax), bool(k), true), O.minmax(arr(a), axesArg(ax), bool(k), false))));
  f('argmax', 'a, axis=, out=, keepdims=', (a: any, ax: any) => O.argmax(arr(a), axisArg(ax)));
  f('argmin', 'a, axis=, out=, keepdims=', (a: any, ax: any) => O.argmin(arr(a), axisArg(ax)));
  f('any', 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(O.anyAll(arr(a), axesArg(ax), bool(k), false)));
  f('all', 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(O.anyAll(arr(a), axesArg(ax), bool(k), true)));
  f('cumsum', 'a, axis=, dtype=, out=', (a: any, ax: any) => O.cumsum(arr(a), axisArg(ax)));
  f('cumprod', 'a, axis=, dtype=, out=', (a: any, ax: any) => O.cumprod(arr(a), axisArg(ax)));
  f('median', 'a, axis=, out=, overwrite_input=, keepdims=', (a: any, ax: any, _o: any, _w: any, k: any) => ret(O.median(arr(a), axesArg(ax), bool(k))));
  f('percentile', 'a, q, axis=, out=, overwrite_input=, method=, keepdims=, interpolation=', (a: any, q: any, ax: any, _o: any, _w: any, method: any, k: any) => {
    const Q = arr(q);
    return ret(O.percentileImpl(arr(a), axesArg(ax), Array.from(flatNum(Q)), bool(k), isNone(method) ? 'linear' : String(method), Q.ndim === 0));
  });
  f('quantile', 'a, q, axis=, out=, overwrite_input=, method=, keepdims=, interpolation=', (a: any, q: any, ax: any, _o: any, _w: any, method: any, k: any) => {
    const Q = arr(q);
    return ret(O.percentileImpl(arr(a), axesArg(ax), Array.from(flatNum(Q), (v) => v * 100), bool(k), isNone(method) ? 'linear' : String(method), Q.ndim === 0));
  });
  f('average', 'a, axis=, weights=, returned=, keepdims=', (a: any, ax: any, w: any) => {
    const A = arr(a);
    if (isNone(w)) return ret(O.mean(A, axesArg(ax), false));
    const W = arr(w);
    const axes = axesArg(ax);
    let Wb = W;
    if (W.ndim === 1 && A.ndim > 1 && axes) Wb = nd.reshapeTo(W, A.shape.map((s, i) => (i === nd.normAxis(axes[0], A.ndim) ? s : 1)));
    return ret(O.arith('div', O.sum(O.arith('mul', A, Wb), axes, false), O.sum(Wb, axes, false)));
  });
  f('count_nonzero', 'a, axis=, keepdims=', (a: any, ax: any, k: any) => ret(O.sum(nd.ewUnary(arr(a), (v) => (v !== 0 ? 1 : 0), 'int64'), axesArg(ax), bool(k))));
  for (const [name, fn2] of [
    ['nansum', (v: Float64Array) => v.reduce((s, x) => s + x, 0)],
    ['nanmean', (v: Float64Array) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN)],
    ['nanmax', (v: Float64Array) => (v.length ? v.reduce((s, x) => Math.max(s, x), -Infinity) : NaN)],
    ['nanmin', (v: Float64Array) => (v.length ? v.reduce((s, x) => Math.min(s, x), Infinity) : NaN)],
    ['nanprod', (v: Float64Array) => v.reduce((s, x) => s * x, 1)],
    ['nanmedian', (v: Float64Array) => {
      if (!v.length) return NaN;
      const s = Float64Array.from(v).sort();
      const h = s.length >> 1;
      return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    }],
  ] as [string, (v: Float64Array) => number][])
    f(name, 'a, axis=, out=, keepdims=', (a: any, ax: any, _o: any, k: any) => ret(nanFilter(arr(a), axesArg(ax), bool(k), fn2)));
  for (const [name, sd] of [['nanstd', true], ['nanvar', false]] as [string, boolean][])
    f(name, 'a, axis=, dtype=, out=, ddof=, keepdims=', (a: any, ax: any, _d: any, _o: any, ddof: any, k: any) =>
      ret(nanFilter(arr(a), axesArg(ax), bool(k), (v) => {
        const dd = isNone(ddof) ? 0 : intArg(ddof);
        if (v.length - dd <= 0) return NaN;
        const mu = v.reduce((s, x) => s + x, 0) / v.length;
        const va = v.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (v.length - dd);
        return sd ? Math.sqrt(va) : va;
      })));
  f('nanargmax', 'a, axis=', (a: any, ax: any) => O.argmax(nd.ewUnary(arr(a), (v) => (v !== v ? -Infinity : v), 'float64'), axisArg(ax)));
  f('nanargmin', 'a, axis=', (a: any, ax: any) => O.argmin(nd.ewUnary(arr(a), (v) => (v !== v ? Infinity : v), 'float64'), axisArg(ax)));

  // ordenación y conteos
  f('sort', 'a, axis=, kind=, order=, stable=', (a: any, ax: any) => nd.sortAxis(arr(a), isNone(ax) ? (ax === null ? null : -1) : intArg(ax), false));
  f('argsort', 'a, axis=, kind=, order=, stable=', (a: any, ax: any) => nd.sortAxis(arr(a), isNone(ax) ? (ax === null ? null : -1) : intArg(ax), true));
  f('unique', 'ar, return_index=, return_inverse=, return_counts=, axis=, equal_nan=', (a: any, ri: any, rv: any, rc: any, ax: any) => uniqueFn(arr(a), bool(ri), bool(rv), bool(rc), axisArg(ax)));
  f('bincount', 'x, weights=, minlength=', (x: any, w: any, ml: any) => O.bincount(arr(x), isNone(w) ? null : arr(w), isNone(ml) ? 0 : intArg(ml)));
  f('searchsorted', 'a, v, side=, sorter=', (a: any, v: any, side: any) => ret(O.searchsorted(arr(a), arr(v), side === 'right')));
  f('digitize', 'x, bins, right=', (x: any, b: any, right: any) => ret(O.searchsorted(arr(b), arr(x), !bool(right))));
  f('histogram', 'a, bins=, range=, density=, weights=', (a: any, bins: any, rng: any, dens: any, w: any) => {
    const A = arr(a);
    let edges: Float64Array;
    const d = flatNum(A);
    if (bins instanceof NdArray || bins instanceof PyList || bins instanceof PyTuple) edges = Float64Array.from(flatNum(arr(bins)));
    else {
      const nb = isNone(bins) ? 10 : intArg(bins);
      let lo = d.length ? d.reduce((s, x) => Math.min(s, x), Infinity) : 0;
      let hi = d.length ? d.reduce((s, x) => Math.max(s, x), -Infinity) : 1;
      if (!isNone(rng)) [lo, hi] = (rng as PyTuple).a.map(numArg);
      if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      }
      edges = linspace(lo, hi, nb + 1, true);
    }
    const [c, e] = O.histogram(A, edges, isNone(w) ? null : arr(w), bool(dens));
    return new PyTuple([c, e]);
  });
  f('diff', 'a, n=, axis=, prepend=, append=', (a: any, n: any, ax: any) => O.diff(arr(a), isNone(n) ? 1 : intArg(n), isNone(ax) ? -1 : intArg(ax)));
  f('gradient', 'f, *varargs, axis=, edge_order=', (fv: any, va: PyTuple) => {
    const A = arr(fv);
    const d = flatNum(A);
    const n = d.length;
    const h = va.a.length ? numArg(va.a[0]) : 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = i === 0 ? (d[1] - d[0]) / h : i === n - 1 ? (d[n - 1] - d[n - 2]) / h : (d[i + 1] - d[i - 1]) / (2 * h);
    return mkNum(out, [n], 'float64');
  });
  f('trapz', 'y, x=, dx=', (y: any, x: any, dx: any) => {
    const Y = flatNum(arr(y));
    let s = 0;
    const X = isNone(x) ? null : flatNum(arr(x));
    const h = isNone(dx) ? 1 : numArg(dx);
    for (let i = 1; i < Y.length; i++) s += ((Y[i] + Y[i - 1]) / 2) * (X ? X[i] - X[i - 1] : h);
    return F(s);
  });
  m.dict!.set('trapezoid', m.dict!.get('trapz'));
  f('interp', 'x, xp, fp, left=, right=', (x: any, xp: any, fp: any, l: any, r: any) => {
    const XP = flatNum(arr(xp));
    const FP = flatNum(arr(fp));
    return ret(nd.ewUnary(arr(x), (v) => {
      if (v !== v) return v;
      if (v < XP[0]) return isNone(l) ? FP[0] : numArg(l);
      if (v > XP[XP.length - 1]) return isNone(r) ? FP[FP.length - 1] : numArg(r);
      let lo = 0;
      let hi = XP.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (XP[mid] <= v) lo = mid;
        else hi = mid;
      }
      if (v === XP[hi]) return FP[hi];
      return FP[lo] + ((FP[hi] - FP[lo]) * (v - XP[lo])) / (XP[hi] - XP[lo]);
    }, 'float64'));
  });
  f('convolve', 'a, v, mode=', (a: any, v: any, mode: any) => {
    const A = flatNum(arr(a));
    const V = flatNum(arr(v));
    const full = new Float64Array(A.length + V.length - 1);
    for (let i = 0; i < A.length; i++) for (let j = 0; j < V.length; j++) full[i + j] += A[i] * V[j];
    const md = isNone(mode) ? 'full' : String(mode);
    if (md === 'full') return mkNum(full, [full.length], 'float64');
    const n = Math.max(A.length, V.length);
    if (md === 'same') {
      const s = Math.floor((V.length - 1) / 2) + ((A.length < V.length ? 1 : 0) * 0);
      return mkNum(full.slice(s, s + n), [n], 'float64');
    }
    const len = Math.max(A.length, V.length) - Math.min(A.length, V.length) + 1;
    return mkNum(full.slice(Math.min(A.length, V.length) - 1, Math.min(A.length, V.length) - 1 + len), [len], 'float64');
  });
  f('polyfit', 'x, y, deg', (x: any, y: any, d: any) => polyfit(arr(x), arr(y), intArg(d)));
  f('polyval', 'p, x', (p: any, x: any) => {
    const P = flatNum(arr(p));
    return ret(nd.ewUnary(arr(x), (v) => P.reduce((acc, c) => acc * v + c, 0), 'float64'));
  });
  f('cov', 'm, y=, rowvar=, bias=, ddof=', (a: any, y: any, rv: any, bias: any, ddof: any) => {
    let A = arr(a);
    if (!isNone(y)) A = O.stack([nd.reshapeTo(A, [A.size]), nd.reshapeTo(arr(y), [arr(y).size])], 0);
    return O.cov(A, bool(rv, true), isNone(ddof) ? (bool(bias) ? 0 : 1) : intArg(ddof));
  });
  f('corrcoef', 'x, y=, rowvar=', (x: any, y: any, rv: any) => {
    let A = arr(x);
    if (!isNone(y)) A = O.stack([nd.reshapeTo(A, [A.size]), nd.reshapeTo(arr(y), [arr(y).size])], 0);
    const c = O.cov(A, bool(rv, true), 1);
    if (c.ndim === 0) return F(1);
    const n = c.shape[0];
    const d = flatNum(c);
    const out = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = d[i * n + j] / Math.sqrt(d[i * n + i] * d[j * n + j]);
    return mkNum(out, [n, n], 'float64');
  });

  // álgebra
  f('dot', 'a, b, out=', (a: any, b: any) => ret(O.dot(arr(a), arr(b))));
  f('matmul', 'x1, x2, out=', (a: any, b: any) => ret(O.matmul(arr(a), arr(b))));
  f('vdot', 'a, b', (a: any, b: any) => ret(O.dot(nd.reshapeTo(arr(a), [-1]), nd.reshapeTo(arr(b), [-1]))));
  f('inner', 'a, b', (a: any, b: any) => {
    const A = arr(a);
    const B = arr(b);
    if (A.ndim <= 1 && B.ndim <= 1) return ret(O.dot(A, B));
    return ret(O.dot(A, nd.transposeAxes(B, B.shape.length > 1 ? [...B.shape.map((_, i) => i).slice(0, -2), B.ndim - 1, B.ndim - 2] : undefined)));
  });
  f('outer', 'a, b, out=', (a: any, b: any) => O.outer(arr(a), arr(b)));
  f('cross', 'a, b, axisa=, axisb=, axisc=, axis=', (a: any, b: any) => {
    const x = flatNum(arr(a));
    const y = flatNum(arr(b));
    return mkNum(Float64Array.of(x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]), [3], nd.promote(arr(a).dtype, arr(b).dtype));
  });
  f('trace', 'a, offset=, axis1=, axis2=, dtype=, out=', (a: any) => scalarToPy(arr(a).dtype === 'float64' ? 'float64' : 'int64', O.trace(arr(a))));
  f('tensordot', 'a, b, axes=', (a: any, b: any, axes: any) => {
    const A = arr(a);
    const B = arr(b);
    const k = isNone(axes) ? 2 : axes instanceof PyTuple || axes instanceof PyList ? 0 : intArg(axes);
    if (axes instanceof PyTuple || axes instanceof PyList) {
      const ax1 = axesArg((axes as PyTuple).a[0])!.map((x) => nd.normAxis(x, A.ndim));
      const ax2 = axesArg((axes as PyTuple).a[1])!.map((x) => nd.normAxis(x, B.ndim));
      const restA = A.shape.map((_, i) => i).filter((i) => !ax1.includes(i));
      const restB = B.shape.map((_, i) => i).filter((i) => !ax2.includes(i));
      const A2 = nd.reshapeTo(nd.copyOf(nd.transposeAxes(A, [...restA, ...ax1])), [restA.reduce((p, i) => p * A.shape[i], 1), -1]);
      const B2 = nd.reshapeTo(nd.copyOf(nd.transposeAxes(B, [...ax2, ...restB])), [-1, restB.reduce((p, i) => p * B.shape[i], 1)]);
      return ret(nd.reshapeTo(O.matmul(A2, B2), [...restA.map((i) => A.shape[i]), ...restB.map((i) => B.shape[i])]));
    }
    const A2 = nd.reshapeTo(A, [A.shape.slice(0, A.ndim - k).reduce((p, s) => p * s, 1), -1]);
    const B2 = nd.reshapeTo(B, [B.shape.slice(0, k).reduce((p, s) => p * s, 1), -1]);
    return ret(nd.reshapeTo(O.matmul(A2, B2), [...A.shape.slice(0, A.ndim - k), ...B.shape.slice(k)]));
  });
  f('einsum', 'subscripts, *operands, optimize=', (s: any, ops2: PyTuple) => ret(O.einsum(String(s), ops2.a.map(arr))));
  f('kron', 'a, b', (a: any, b: any) => {
    const A = nd.reshapeTo(arr(a), arr(a).ndim === 1 ? [1, arr(a).size] : arr(a).shape);
    const B = nd.reshapeTo(arr(b), arr(b).ndim === 1 ? [1, arr(b).size] : arr(b).shape);
    const [ar, ac] = A.shape;
    const [br, bc] = B.shape;
    const out = new Float64Array(ar * br * ac * bc);
    const ad = flatNum(A);
    const bd = flatNum(B);
    for (let i = 0; i < ar; i++) for (let j = 0; j < ac; j++) for (let k = 0; k < br; k++) for (let l = 0; l < bc; l++) out[(i * br + k) * ac * bc + j * bc + l] = ad[i * ac + j] * bd[k * bc + l];
    return mkNum(out, [ar * br, ac * bc], nd.promote(arr(a).dtype, arr(b).dtype));
  });

  // utilidades
  f('shape', 'a', (a: any) => tup(arr(a).shape));
  f('ndim', 'a', (a: any) => arr(a).ndim);
  f('size', 'a, axis=', (a: any, ax: any) => (isNone(ax) ? arr(a).size : arr(a).shape[intArg(ax)]));
  f('isscalar', 'element', (x: any) => !(x instanceof NdArray || x instanceof PyList || x instanceof PyTuple || x instanceof PyDict));
  f('result_type', '*arrays_and_dtypes', (xs: PyTuple) => dtypeObj(xs.a.map((x: any) => (x instanceof NdArray ? x.dtype : dtypeArg(x) ?? arr(x).dtype)).reduce((p: DType, q: DType) => nd.promote(p, q))));
  f('can_cast', 'from_, to, casting=', () => true);
  f('issubdtype', 'arg1, arg2', (a: any, b: any) => {
    const A = a instanceof NdDType ? a.dt : dtypeArg(a);
    const bn = String(b && b.name ? b.name : '');
    if (bn === 'integer') return A === 'int64';
    if (bn === 'floating') return A === 'float64';
    if (bn === 'number') return A === 'int64' || A === 'float64';
    return A === dtypeArg(b);
  });
  for (const nm of ['integer', 'floating', 'number', 'generic', 'signedinteger', 'bool_t']) m.dict!.set(nm, newNativeType(nm, 'numpy', [objectType]));
  f('vectorize', 'pyfunc, otypes=, signature=', (fn: any) =>
    mkNative('vectorize', '*args', (args: PyTuple) => {
      const as = args.a.map(arr);
      const shape = as.reduce((s, x) => nd.broadcastShapes(s, x.shape), [] as number[]);
      const bs = as.map((x) => nd.broadcastTo(x, shape));
      const n = sizeOf(shape);
      const outs: any[] = [];
      const flats = bs.map((x) => (x.dtype === 'str' ? flatStr(x) : flatNum(x)));
      for (let i = 0; i < n; i++) outs.push(callObj(fn, bs.map((x, k) => (x.dtype === 'str' ? (flats[k] as string[])[i] : scalarToPy(x.dtype, (flats[k] as Float64Array)[i])))));
      const r = fromPy(new PyList(outs));
      return ret(nd.reshapeTo(r, shape));
    }, { module: 'numpy' }));
  f('apply_along_axis', 'func1d, axis, arr, *args, **kwargs', (fn: any, axis: any, a: any) => {
    const A = arr(a);
    const ax = nd.normAxis(intArg(axis), A.ndim);
    const moved = nd.copyOf(nd.transposeAxes(A, [...A.shape.map((_, i) => i).filter((i) => i !== ax), ax]));
    const len = A.shape[ax];
    const groups = moved.size / Math.max(len, 1);
    const d = flatNum(moved);
    const res: any[] = [];
    for (let g = 0; g < groups; g++) res.push(callObj(fn, [mkNum(Float64Array.from(d.subarray(g * len, (g + 1) * len)), [len], A.dtype)]));
    const R = fromPy(new PyList(res));
    return nd.reshapeTo(R, [...A.shape.filter((_, i) => i !== ax), ...R.shape.slice(1)]);
  });
  f('set_printoptions', 'precision=, threshold=, edgeitems=, linewidth=, suppress=, **kw', (p: any, th: any, ei: any, lw: any, sp: any) => {
    if (!isNone(p)) PRINT.precision = intArg(p);
    if (!isNone(th)) PRINT.threshold = th instanceof PyFloat && !Number.isFinite(th.v) ? Infinity : intArg(th);
    if (!isNone(ei)) PRINT.edgeitems = intArg(ei);
    if (!isNone(lw)) PRINT.linewidth = intArg(lw);
    if (!isNone(sp)) PRINT.suppress = bool(sp);
    return null;
  });
  f('get_printoptions', '', () => {
    const d = new PyDict();
    d.set('precision', PRINT.precision);
    d.set('threshold', PRINT.threshold);
    d.set('edgeitems', PRINT.edgeitems);
    d.set('linewidth', PRINT.linewidth);
    d.set('suppress', PRINT.suppress);
    return d;
  });
  f('array_repr', 'arr, max_line_width=, precision=, suppress_small=', (a: any) => arrayRepr(arr(a)));
  f('array_str', 'a, max_line_width=, precision=, suppress_small=', (a: any) => arrayStr(arr(a)));
  f('array2string', 'a, max_line_width=, precision=, suppress_small=, separator=, prefix=, **kw', (a: any, _w: any, p: any, sp: any, sep: any, prefix: any) => {
    const old = PRINT.precision;
    if (!isNone(p)) PRINT.precision = intArg(p);
    try {
      return array2string(arr(a), isNone(sep) ? ' ' : String(sep), isNone(prefix) ? '' : String(prefix), '', PRINT);
    } finally {
      PRINT.precision = old;
      void sp;
    }
  });
  // finfo / iinfo: límites numéricos (solo los tipos de 64 bits y los habituales)
  const typeNameOf = (dt: any, dflt: string): string => {
    if (dt === undefined || dt === null) return dflt;
    try {
      const n = ops.getAttr(dt, '__name__');
      if (typeof n === 'string') return n;
    } catch {
      /* se prueba el nombre del dtype */
    }
    try {
      return String(dtypeName(dt));
    } catch {
      return dflt;
    }
  };
  const infoType = newNativeType('finfo', 'numpy', [objectType]);
  const mkInfo = (props: Record<string, any>): any => {
    const o = new PyObject(infoType);
    o.dict = new PyDict();
    for (const [k, v] of Object.entries(props)) o.dict.set(k, v);
    return o;
  };
  f('finfo', 'dtype=', (dt?: any) => {
    const nm = typeNameOf(dt, 'float64');
    const single = /32|single/.test(String(nm));
    return mkInfo(single
      ? { eps: F(1.1920929e-07), max: F(3.4028234663852886e38), min: F(-3.4028234663852886e38), tiny: F(1.1754943508222875e-38), smallest_normal: F(1.1754943508222875e-38), bits: 32, precision: 6, resolution: F(1e-6), dtype: 'float32' }
      : { eps: F(2.220446049250313e-16), max: F(1.7976931348623157e308), min: F(-1.7976931348623157e308), tiny: F(2.2250738585072014e-308), smallest_normal: F(2.2250738585072014e-308), bits: 64, precision: 15, resolution: F(1e-15), dtype: 'float64' });
  });
  f('iinfo', 'dtype=', (dt?: any) => {
    const nm = typeNameOf(dt, 'int64');
    const bits = /8/.test(nm) ? 8 : /16/.test(nm) ? 16 : /32/.test(nm) ? 32 : 64;
    const hi = bits === 64 ? 9223372036854775807n : (1n << BigInt(bits - 1)) - 1n;
    return mkInfo({ bits, max: hi > BigInt(Number.MAX_SAFE_INTEGER) ? hi : Number(hi), min: -hi - 1n > BigInt(-Number.MAX_SAFE_INTEGER) ? Number(-hi - 1n) : -hi - 1n, dtype: 'int' + bits });
  });
  f('seterr', '**kw', () => new PyDict());
  // `with np.errstate(all="ignore"):` — el motor no emite avisos numéricos, así que el contexto no hace nada
  {
    const errType = newNativeType('errstate', 'numpy', [objectType]);
    errType.dict!.set('__enter__', mkNative('__enter__', 'self', (self: any) => self, { method: true, owner: 'errstate' }));
    errType.dict!.set('__exit__', mkNative('__exit__', 'self, *a', () => false, { method: true, owner: 'errstate' }));
    errType.dict!.set('__new__', mkNative('__new__', 'cls, *args, **kw', (cls: PyType) => new PyObject(cls), { owner: 'errstate' }));
    m.dict!.set('errstate', errType);
  }
  f('geterr', '', () => new PyDict());
  f('may_share_memory', 'a, b', (a: any, b: any) => a instanceof NdArray && b instanceof NdArray && (a.buf === b.buf));
  f('shares_memory', 'a, b', (a: any, b: any) => a instanceof NdArray && b instanceof NdArray && a.buf === b.buf);
  f('lexsort', 'keys, axis=', (keys: any) => {
    const ks = seqArrays(keys).map((k) => flatNum(k));
    const n = ks[0].length;
    const idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => {
      for (let k = ks.length - 1; k >= 0; k--) {
        const c = nd.cmpNum(ks[k][i], ks[k][j]);
        if (c) return c;
      }
      return i - j;
    });
    return mkNum(Float64Array.from(idx), [n], 'int64');
  });
  f('indices', 'dimensions, dtype=', (dims: any) => {
    const sh = shapeArg(dims);
    const parts = sh.map((s, d) => nd.copyOf(nd.broadcastTo(nd.reshapeTo(mkNum(Float64Array.from({ length: s }, (_, i) => i), [s], 'int64'), sh.map((_, k) => (k === d ? s : 1))), sh)));
    return O.stack(parts, 0);
  });
  f('ix_', '*args', (xs: PyTuple) => new PyTuple(xs.a.map((x: any, i: number) => nd.reshapeTo(arr(x), xs.a.map((_: any, k: number) => (k === i ? arr(x).size : 1))))));
  f('unravel_index', 'indices, shape, order=', (idx: any, shape: any) => {
    const sh = shapeArg(shape);
    const I = arr(idx);
    const st = nd.cStrides(sh);
    const outs = sh.map((s, d) => nd.ewUnary(I, (v) => Math.floor(v / st[d]) % s, 'int64'));
    return new PyTuple(outs.map((o) => ret(o)));
  });
  f('ravel_multi_index', 'multi_index, dims, mode=, order=', (mi: any, dims: any) => {
    const sh = shapeArg(dims);
    const st = nd.cStrides(sh);
    const parts = seqArrays(mi);
    return ret(parts.reduce((acc, p, d) => O.arith('add', acc, O.arith('mul', p, scalarFrom(st[d]))), scalarFrom(0)));
  });


  // np.r_ y np.c_
  const catType = newNativeType('CClass', 'numpy.lib.index_tricks', [objectType]);
  catType.dict!.set('__getitem__', mkNative('__getitem__', 'self, key', (self: ConcatObj, key: any) => {
    const items = key instanceof PyTuple ? key.a : [key];
    const parts = items.map((it: any) => {
      if (it instanceof PySlice) {
        const start = isNone(it.start) ? 0 : numArg(it.start);
        const step = isNone(it.step) ? 1 : numArg(it.step);
        return aranger([start, numArg(it.stop), step], null);
      }
      const a = arr(it);
      if (self.col) return a.ndim === 0 ? nd.reshapeTo(a, [1, 1]) : a.ndim === 1 ? nd.reshapeTo(a, [a.shape[0], 1]) : a;
      return a.ndim === 0 ? nd.reshapeTo(a, [1]) : a;
    });
    return O.concatenate(parts, self.col ? -1 : 0);
  }, { method: true, owner: 'CClass' }));
  m.dict!.set('r_', new ConcatObj(catType, false));
  m.dict!.set('c_', new ConcatObj(catType, true));
}

const scalarFrom = (v: number): NdArray => nd.scalarArray(v, 'int64');

function mats(a: NdArray): { batch: number[]; list: L.Mat[] } {
  if (a.ndim < 2) throw makeExc(linAlgError, [`${a.ndim}-dimensional array given. Array must be at least two-dimensional`]);
  const n = a.shape[a.ndim - 2];
  const mm = a.shape[a.ndim - 1];
  const batch = a.shape.slice(0, -2);
  const flat = flatNum(a);
  const cnt = sizeOf(batch);
  const list: L.Mat[] = [];
  for (let i = 0; i < cnt; i++) list.push({ d: Float64Array.from(flat.subarray(i * n * mm, (i + 1) * n * mm)), n, m: mm });
  return { batch, list };
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof L.LinAlgFailure) throw makeExc(linAlgError, [e.message]);
    throw e;
  }
}

registerNative('numpy', (I, m) => {
  install(m);
  importModule(I, 'numpy.linalg');
  importModule(I, 'numpy.random');
});

registerNative('numpy.linalg', (_I, m) => {
  ensureTypes();
  const f = (name: string, sig: string, impl: (...a: any[]) => any): void => mfn(m, name, sig, impl);
  m.dict!.set('LinAlgError', linAlgError);
  const stacked = (a: NdArray, fn: (x: L.Mat) => NdArray): NdArray => {
    const { batch, list } = mats(a);
    if (list.length === 1 && batch.length === 0) return fn(list[0]);
    const parts = list.map(fn);
    return nd.reshapeTo(O.stack(parts, 0), [...batch, ...parts[0].shape]);
  };
  f('inv', 'a', (a: any) => guard(() => stacked(arr(a), (x) => L.fromMat(L.inv(x)))));
  f('det', 'a', (a: any) => {
    const A = arr(a);
    const { batch, list } = mats(A);
    const dets = list.map((x) => L.det(x));
    return batch.length === 0 ? F(dets[0]) : mkNum(Float64Array.from(dets), batch, 'float64');
  });
  f('slogdet', 'a', (a: any) => {
    const d = L.det(mats(arr(a)).list[0]);
    return new PyTuple([F(Math.sign(d)), F(Math.log(Math.abs(d)))]);
  });
  f('solve', 'a, b', (a: any, b: any) => guard(() => {
    const A = arr(a);
    const B = arr(b);
    const bv = B.ndim === 1;
    const Bm: L.Mat = bv ? { d: Float64Array.from(flatNum(B)), n: B.size, m: 1 } : L.toMat(B);
    const r = L.solveMat(mats(A).list[0], Bm);
    return bv ? mkNum(r.d, [r.n], 'float64') : L.fromMat(r);
  }));
  f('pinv', 'a, rcond=, hermitian=', (a: any) => L.fromMat(L.pinv(L.toMat(arr(a)))));
  f('lstsq', 'a, b, rcond=', (a: any, b: any) => {
    const A = L.toMat(arr(a));
    const B = arr(b);
    const bv = B.ndim === 1;
    const p = L.pinv(A);
    const Bm: L.Mat = bv ? { d: Float64Array.from(flatNum(B)), n: B.size, m: 1 } : L.toMat(B);
    const x = new Float64Array(A.m * Bm.m);
    for (let i = 0; i < A.m; i++) for (let j = 0; j < Bm.m; j++) {
      let s = 0;
      for (let k = 0; k < A.n; k++) s += p.d[i * A.n + k] * Bm.d[k * Bm.m + j];
      x[i * Bm.m + j] = s;
    }
    const sv = L.svd(A).s;
    const rank = Array.from(sv).filter((v) => v > 1e-12 * sv[0]).length;
    const res = new Float64Array(Bm.m);
    if (A.n > A.m && rank === A.m) for (let j = 0; j < Bm.m; j++) {
      let s = 0;
      for (let i = 0; i < A.n; i++) {
        let pr = 0;
        for (let k = 0; k < A.m; k++) pr += A.d[i * A.m + k] * x[k * Bm.m + j];
        s += (Bm.d[i * Bm.m + j] - pr) ** 2;
      }
      res[j] = s;
    }
    const xs = bv ? mkNum(x, [A.m], 'float64') : mkNum(x, [A.m, Bm.m], 'float64');
    return new PyTuple([xs, mkNum(res.slice(0, A.n > A.m && rank === A.m ? Bm.m : 0), [A.n > A.m && rank === A.m ? Bm.m : 0], 'float64'), rank, mkNum(Float64Array.from(sv), [sv.length], 'float64')]);
  });
  f('eigh', 'a, UPLO=', (a: any) => {
    const r = L.eigh(L.toMat(arr(a)));
    return new PyTuple([mkNum(r.w, [r.w.length], 'float64'), L.fromMat(r.v)]);
  });
  f('eigvalsh', 'a, UPLO=', (a: any) => {
    const r = L.eigh(L.toMat(arr(a)));
    return mkNum(r.w, [r.w.length], 'float64');
  });
  f('eig', 'a', (a: any) => guard(() => {
    const r = L.eigGeneral(L.toMat(arr(a)));
    return new PyTuple([mkNum(r.w, [r.w.length], 'float64'), L.fromMat(r.v)]);
  }));
  f('eigvals', 'a', (a: any) => guard(() => {
    const r = L.eigGeneral(L.toMat(arr(a)));
    return mkNum(r.w, [r.w.length], 'float64');
  }));
  f('svd', 'a, full_matrices=, compute_uv=, hermitian=', (a: any, full: any, cuv: any) => {
    const A = L.toMat(arr(a));
    const r = L.svd(A);
    const s = mkNum(r.s, [r.s.length], 'float64');
    if (!bool(cuv, true)) return s;
    if (bool(full, true)) {
      const U = A.n > r.u.m ? L.completeBasis(r.u) : r.u;
      const Vt = A.m > r.vt.n ? L.transposeMat(L.completeBasis(L.transposeMat(r.vt))) : r.vt;
      return new PyTuple([L.fromMat(U), s, L.fromMat(Vt)]);
    }
    return new PyTuple([L.fromMat(r.u), s, L.fromMat(r.vt)]);
  });
  f('qr', 'a, mode=', (a: any, mode: any) => {
    const r = L.qr(L.toMat(arr(a)), mode === 'complete');
    if (mode === 'r') return L.fromMat(r.r);
    return new PyTuple([L.fromMat(r.q), L.fromMat(r.r)]);
  });
  f('cholesky', 'a', (a: any) => guard(() => L.fromMat(L.cholesky(L.toMat(arr(a))))));
  f('matrix_rank', 'A, tol=, hermitian=', (a: any, tol: any) => {
    const A = arr(a);
    if (A.ndim < 2) return flatNum(A).some((v) => v !== 0) ? 1 : 0;
    const s = L.svd(L.toMat(A)).s;
    const t = isNone(tol) ? (s[0] ?? 0) * Math.max(A.shape[0], A.shape[1]) * 2.220446049250313e-16 : numArg(tol);
    return Array.from(s).filter((v) => v > t).length;
  });
  f('cond', 'x, p=', (a: any) => {
    const s = L.svd(L.toMat(arr(a))).s;
    return F(s[0] / s[s.length - 1]);
  });
  f('matrix_power', 'a, n', (a: any, n: any) => {
    const A = arr(a);
    let k = intArg(n);
    let base = k < 0 ? L.fromMat(L.inv(L.toMat(A))) : A;
    k = Math.abs(k);
    let res = nd.copyOf(mkNum(Float64Array.from({ length: A.size }, (_, i) => (Math.floor(i / A.shape[0]) === i % A.shape[0] ? 1 : 0)), A.shape.slice(), A.dtype));
    while (k > 0) {
      if (k & 1) res = O.matmul(res, base);
      base = O.matmul(base, base);
      k >>= 1;
    }
    return res;
  });
  f('multi_dot', 'arrays', (xs: any) => seqArrays(xs).reduce((p, q) => O.matmul(p, q)));
  f('norm', 'x, ord=, axis=, keepdims=', (x: any, ord: any, axis: any, keep: any) => {
    const A = arr(x);
    const o: number | 'fro' | 'nuc' | undefined = isNone(ord) ? undefined : typeof ord === 'string' ? (ord as 'fro' | 'nuc') : numArg(ord);
    const ax = axesArg(axis);
    const wrap = (v: number): any => {
      if (!bool(keep)) return F(v);
      return mkNum(Float64Array.of(v), A.shape.map(() => 1), 'float64');
    };
    if (ax === null) {
      if (o === undefined || A.ndim === 1) return wrap(L.vectorNorm(flatNum(A), o === undefined ? 2 : (o as number | 'fro')));
      if (A.ndim === 2) return wrap(L.matrixNorm(L.toMat(A), o as number | 'fro' | 'nuc'));
      throw valueError('Improper number of dimensions to norm.');
    }
    if (ax.length === 1) {
      const res = nd.reduceAxes(A, ax, { group: (v) => L.vectorNorm(v, o === undefined ? 2 : (o as number)) }, 'float64', bool(keep));
      return ret(res);
    }
    return wrap(L.matrixNorm(L.toMat(A), (o ?? 'fro') as number | 'fro' | 'nuc'));
  });
});

registerNative('numpy.random', (_I, m) => {
  ensureTypes();
  installRandom(m, { arr, ret, fromPy });
});

void indexError;
void flatStr;
void mkStr;
