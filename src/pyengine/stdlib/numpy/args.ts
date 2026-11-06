/**
 * Conversión de argumentos de Python a los tipos que usa el núcleo de NumPy.
 */
import { PyFloat, PyList, PyTuple } from '../../runtime/objects';
import { boolType, floatType, intType, strType } from '../../runtime/builtin_types';
import { typeError, valueError } from '../../runtime/errors';
import * as ops from '../../runtime/ops';
import { fromPy, itemOf, NdArray, type DType } from './nd';

/** objeto de Python → array (los arrays se devuelven tal cual) */
export const arr = (x: any): NdArray => (x instanceof NdArray ? x : fromPy(x));

export const isNone = (v: any): boolean => v === undefined || v === null;

export const intArg = (v: any, what = 'integer'): number => {
  if (v instanceof PyFloat) throw typeError(`'float' object cannot be interpreted as an integer`);
  const n = ops.intValue(v);
  if (n !== undefined) return Number(n);
  if (v instanceof NdArray && v.size === 1) return Number(itemOf(v));
  return Number(ops.toIndex(v, `'${ops.typeNameOf(v)}' object cannot be interpreted as an ${what}`));
};

export const optInt = (v: any): number | null => (isNone(v) ? null : intArg(v));
export const bool = (v: any, d = false): boolean => (isNone(v) ? d : ops.truthy(v));

export const numArg = (v: any): number => {
  if (v instanceof PyFloat) return v.v;
  const i = ops.intValue(v);
  if (i !== undefined) return Number(i);
  if (v instanceof NdArray && v.size === 1) return Number(itemOf(v) instanceof PyFloat ? (itemOf(v) as PyFloat).v : itemOf(v));
  const f = ops.floatValue(v);
  if (f !== undefined) return f;
  throw typeError(`must be real number, not ${ops.typeNameOf(v)}`);
};

/** eje(s): None → null; entero → [n]; tupla → lista */
export const axesArg = (v: any): number[] | null => {
  if (isNone(v)) return null;
  if (v instanceof PyTuple || v instanceof PyList) return v.a.map((x: any) => intArg(x));
  return [intArg(v)];
};

export const axisArg = (v: any): number | null => (isNone(v) ? null : intArg(v));

/** forma: entero o secuencia de enteros */
export function shapeArg(v: any): number[] {
  if (v instanceof PyTuple || v instanceof PyList) return v.a.map((x: any) => intArg(x));
  if (v instanceof NdArray) return Array.from(arr(v).num as Float64Array);
  const n = intArg(v);
  if (n < 0) throw valueError('negative dimensions are not allowed');
  return [n];
}

/** registro de los objetos «tipo escalar» (np.float64, np.int64…) → tipo de dato */
export const SCALAR_TYPES = new Map<any, DType>();

const NAMES: Record<string, DType> = {
  float: 'float64', float64: 'float64', f8: 'float64', d: 'float64', double: 'float64', float32: 'float64', f4: 'float64', f: 'float64', float16: 'float64', f2: 'float64', half: 'float64', single: 'float64',
  int: 'int64', int64: 'int64', i8: 'int64', int32: 'int64', i4: 'int64', int16: 'int64', i2: 'int64', int8: 'int64', i1: 'int64', uint8: 'int64', u1: 'int64', uint16: 'int64', uint32: 'int64', uint64: 'int64', intp: 'int64', long: 'int64', l: 'int64', i: 'int64',
  bool: 'bool', bool_: 'bool', '?': 'bool', b1: 'bool',
  str: 'str', str_: 'str', U: 'str', object: 'str', O: 'str', unicode: 'str',
};

export function dtypeArg(v: any): DType | undefined {
  if (isNone(v)) return undefined;
  if (SCALAR_TYPES.has(v)) return SCALAR_TYPES.get(v);
  if (v === floatType) return 'float64';
  if (v === intType) return 'int64';
  if (v === boolType) return 'bool';
  if (v === strType) return 'str';
  if (typeof v === 'string') {
    const k = v.replace(/^[<>=|]/, '');
    if (NAMES[k]) return NAMES[k];
    if (/^U\d*$/.test(k) || /^S\d*$/.test(k)) return 'str';
    throw typeError(`data type '${v}' not understood`);
  }
  if (v && typeof v === 'object' && 'dt' in v) return (v as { dt: DType }).dt;
  throw typeError(`Cannot interpret '${ops.repr(v)}' as a data type`);
}
