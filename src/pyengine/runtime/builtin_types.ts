/**
 * Tipos nativos (objetos `PyType`) del intérprete. Los métodos se registran en los módulos `t_*.ts`.
 */
import {
  Cell, DICT_TYPE_REF, F_BASETYPE, F_BUILTIN, LIST_TYPE_REF, PyComplex, PyFloat, PyObject, PyType, SET_TYPE_REF, TUPLE_TYPE_REF,
} from './objects';

function mk(name: string, bases: PyType[], flags = F_BASETYPE): PyType {
  const t = new PyType(name, bases, undefined, undefined);
  t.flags = F_BUILTIN | flags;
  return t;
}

// `object` y `type` se crean a mano: ambos son instancias de `type`
export const objectType = new PyType('object', [], undefined, undefined);
objectType.flags = F_BUILTIN | F_BASETYPE;
export const typeType = new PyType('type', [objectType], undefined, undefined);
typeType.flags = F_BUILTIN | F_BASETYPE;
objectType.cls = typeType;
typeType.cls = typeType;
objectType.computeMro();
typeType.computeMro();

const all: PyType[] = [objectType, typeType];
/** Solo los tipos que existen al cargar el módulo se guardan en `all`: los que crean las sesiones (módulos nativos) no, o cada sesión quedaría retenida para siempre. */
let booting = true;
function T(name: string, bases: PyType[] = [objectType], flags = F_BASETYPE): PyType {
  const t = mk(name, bases, flags);
  t.cls = typeType;
  t.computeMro();
  if (booting) all.push(t);
  return t;
}

export const intType = T('int');
export const boolType = T('bool', [intType], 0);
export const floatType = T('float');
export const complexType = T('complex');
export const strType = T('str');
export const bytesType = T('bytes');
export const byteArrayType = T('bytearray');
export const listType = T('list');
export const tupleType = T('tuple');
export const dictType = T('dict');
export const setType = T('set');
export const frozenSetType = T('frozenset');
export const rangeType = T('range', [objectType], 0);
export const sliceType = T('slice', [objectType], 0);
export const noneType = T('NoneType', [objectType], 0);
export const notImplementedType = T('NotImplementedType', [objectType], 0);
export const ellipsisType = T('ellipsis', [objectType], 0);
export const functionType = T('function', [objectType], 0);
export const nativeFunctionType = T('builtin_function_or_method', [objectType], 0);
export const methodDescriptorType = T('method_descriptor', [objectType], 0);
export const boundMethodType = T('method', [objectType], 0);
export const moduleType = T('module');
export const generatorType = T('generator', [objectType], 0);
export const coroutineType = T('coroutine', [objectType], 0);
export const asyncGeneratorType = T('async_generator', [objectType], 0);
export const propertyType = T('property');
export const classMethodType = T('classmethod');
export const staticMethodType = T('staticmethod');
export const superType = T('super');
export const cellType = T('cell', [objectType], 0);
export const tracebackType = T('traceback', [objectType], 0);
export const frameType = T('frame', [objectType], 0);
export const codeType = T('code', [objectType], 0);
export const enumerateType = T('enumerate');
export const zipType = T('zip');
export const mapType = T('map');
export const filterType = T('filter');
export const reversedType = T('reversed');
export const mappingProxyType = T('mappingproxy', [objectType], 0);
export const dictKeysType = T('dict_keys', [objectType], 0);
export const dictValuesType = T('dict_values', [objectType], 0);
export const dictItemsType = T('dict_items', [objectType], 0);
export const listIterType = T('list_iterator', [objectType], 0);
export const listRevIterType = T('list_reverseiterator', [objectType], 0);
export const tupleIterType = T('tuple_iterator', [objectType], 0);
export const strIterType = T('str_iterator', [objectType], 0);
export const dictKeyIterType = T('dict_keyiterator', [objectType], 0);
export const dictValueIterType = T('dict_valueiterator', [objectType], 0);
export const dictItemIterType = T('dict_itemiterator', [objectType], 0);
export const setIterType = T('set_iterator', [objectType], 0);
export const rangeIterType = T('range_iterator', [objectType], 0);
export const bytesIterType = T('bytes_iterator', [objectType], 0);
export const callableIterType = T('callable_iterator', [objectType], 0);
export const genericAliasType = T('GenericAlias', [objectType], F_BASETYPE);
export const simpleNamespaceType = T('SimpleNamespace');
export const memoryViewType = T('memoryview', [objectType], 0);
export const wrapperDescrType = T('wrapper_descriptor', [objectType], 0);
export const getSetDescrType = T('getset_descriptor', [objectType], 0);
export const typeVarType = T('TypeVar');
export const unionType = T('UnionType', [objectType], 0);

intType.alloc = null;
// El módulo de un tipo nativo es 'builtins'; algunos tipos viven en 'types'
for (const t of [functionType, boundMethodType, generatorType, coroutineType, asyncGeneratorType, cellType, tracebackType, frameType, codeType, mappingProxyType, simpleNamespaceType, moduleType, genericAliasType, unionType, notImplementedType, ellipsisType, noneType]) {
  t.module = 'types';
}
moduleType.module = 'builtins';
functionType.module = 'builtins';
notImplementedType.module = 'builtins';
ellipsisType.module = 'builtins';
noneType.module = 'builtins';
typeVarType.module = 'typing';
for (const t of [dictKeysType, dictValuesType, dictItemsType, genericAliasType]) t.module = 'builtins';
genericAliasType.name = 'GenericAlias';
genericAliasType.qualname = 'GenericAlias';

LIST_TYPE_REF.t = listType;
TUPLE_TYPE_REF.t = tupleType;
DICT_TYPE_REF.t = dictType;
SET_TYPE_REF.t = setType;
(PyFloat.prototype as any).cls = floatType;
(PyComplex.prototype as any).cls = complexType;
(Cell.prototype as any).cls = cellType;

export function allBuiltinTypes(): PyType[] {
  return all;
}

/** Crea un tipo nativo adicional (usado por módulos de la biblioteca estándar nativos) */
export function newNativeType(name: string, module: string, bases: PyType[] = [objectType], flags = F_BASETYPE): PyType {
  const t = T(name, bases, flags);
  t.module = module;
  return t;
}

export class PyNotImplemented extends PyObject {}
export class PyEllipsis extends PyObject {}
export const NotImplemented = new PyNotImplemented(notImplementedType);
export const Ellipsis = new PyEllipsis(ellipsisType);

// los diccionarios de los primeros tipos se crearon antes de que existiera `dict`
for (const t of all) t.dict!.cls = dictType;
booting = false;

/** tipo de un valor de Python */
export function typeOf(x: any): PyType {
  switch (typeof x) {
    case 'object':
      return x === null ? noneType : x.cls;
    case 'number':
    case 'bigint':
      return intType;
    case 'string':
      return strType;
    case 'boolean':
      return boolType;
    default:
      throw new Error('valor interno inesperado: ' + String(x));
  }
}
