/**
 * Jerarquía de excepciones de CPython 3.13 (solo los tipos; el comportamiento está en t_exceptions.ts).
 */
import { F_BASETYPE, F_BUILTIN, PyType } from './objects';
import { objectType, typeType } from './builtin_types';

export const excTypes: Record<string, PyType> = {};

function mk(name: string, base: PyType | null, module = 'builtins'): PyType {
  const t = new PyType(name, [base ?? objectType], undefined, typeType);
  t.flags = F_BUILTIN | F_BASETYPE;
  t.module = module;
  t.computeMro();
  t.dict!.cls = (objectType.dict as any).cls;
  excTypes[name] = t;
  return t;
}

const HIER: [string, string | null][] = [
  ['BaseException', null],
  ['BaseExceptionGroup', 'BaseException'],
  ['GeneratorExit', 'BaseException'],
  ['KeyboardInterrupt', 'BaseException'],
  ['SystemExit', 'BaseException'],
  ['Exception', 'BaseException'],
  ['ArithmeticError', 'Exception'],
  ['FloatingPointError', 'ArithmeticError'],
  ['OverflowError', 'ArithmeticError'],
  ['ZeroDivisionError', 'ArithmeticError'],
  ['AssertionError', 'Exception'],
  ['AttributeError', 'Exception'],
  ['BufferError', 'Exception'],
  ['EOFError', 'Exception'],
  ['ImportError', 'Exception'],
  ['ModuleNotFoundError', 'ImportError'],
  ['LookupError', 'Exception'],
  ['IndexError', 'LookupError'],
  ['KeyError', 'LookupError'],
  ['MemoryError', 'Exception'],
  ['NameError', 'Exception'],
  ['UnboundLocalError', 'NameError'],
  ['OSError', 'Exception'],
  ['BlockingIOError', 'OSError'],
  ['ChildProcessError', 'OSError'],
  ['ConnectionError', 'OSError'],
  ['BrokenPipeError', 'ConnectionError'],
  ['ConnectionAbortedError', 'ConnectionError'],
  ['ConnectionRefusedError', 'ConnectionError'],
  ['ConnectionResetError', 'ConnectionError'],
  ['FileExistsError', 'OSError'],
  ['FileNotFoundError', 'OSError'],
  ['InterruptedError', 'OSError'],
  ['IsADirectoryError', 'OSError'],
  ['NotADirectoryError', 'OSError'],
  ['PermissionError', 'OSError'],
  ['ProcessLookupError', 'OSError'],
  ['TimeoutError', 'OSError'],
  ['ReferenceError', 'Exception'],
  ['RuntimeError', 'Exception'],
  ['NotImplementedError', 'RuntimeError'],
  ['PythonFinalizationError', 'RuntimeError'],
  ['RecursionError', 'RuntimeError'],
  ['StopAsyncIteration', 'Exception'],
  ['StopIteration', 'Exception'],
  ['SyntaxError', 'Exception'],
  ['IndentationError', 'SyntaxError'],
  ['TabError', 'IndentationError'],
  ['SystemError', 'Exception'],
  ['TypeError', 'Exception'],
  ['ValueError', 'Exception'],
  ['UnicodeError', 'ValueError'],
  ['UnicodeDecodeError', 'UnicodeError'],
  ['UnicodeEncodeError', 'UnicodeError'],
  ['UnicodeTranslateError', 'UnicodeError'],
  ['Warning', 'Exception'],
  ['BytesWarning', 'Warning'],
  ['DeprecationWarning', 'Warning'],
  ['EncodingWarning', 'Warning'],
  ['FutureWarning', 'Warning'],
  ['ImportWarning', 'Warning'],
  ['PendingDeprecationWarning', 'Warning'],
  ['ResourceWarning', 'Warning'],
  ['RuntimeWarning', 'Warning'],
  ['SyntaxWarning', 'Warning'],
  ['UnicodeWarning', 'Warning'],
  ['UserWarning', 'Warning'],
];

for (const [n, b] of HIER) mk(n, b ? excTypes[b] : null);

// ExceptionGroup hereda de BaseExceptionGroup y Exception
{
  const t = new PyType('ExceptionGroup', [excTypes.BaseExceptionGroup, excTypes.Exception], undefined, typeType);
  t.flags = F_BUILTIN | F_BASETYPE;
  t.computeMro();
  excTypes.ExceptionGroup = t;
}

export const E = excTypes as Record<string, PyType> & {
  BaseException: PyType; Exception: PyType; TypeError: PyType; ValueError: PyType; KeyError: PyType; IndexError: PyType;
  AttributeError: PyType; NameError: PyType; UnboundLocalError: PyType; ZeroDivisionError: PyType; OverflowError: PyType;
  StopIteration: PyType; StopAsyncIteration: PyType; RuntimeError: PyType; RecursionError: PyType; NotImplementedError: PyType;
  AssertionError: PyType; ImportError: PyType; ModuleNotFoundError: PyType; OSError: PyType; EOFError: PyType;
  SyntaxError: PyType; IndentationError: PyType; TabError: PyType; SystemExit: PyType; KeyboardInterrupt: PyType;
  GeneratorExit: PyType; LookupError: PyType; ArithmeticError: PyType; SystemError: PyType; UnicodeError: PyType;
  UnicodeDecodeError: PyType; UnicodeEncodeError: PyType; FileNotFoundError: PyType; FileExistsError: PyType;
  PermissionError: PyType; IsADirectoryError: PyType; NotADirectoryError: PyType; Warning: PyType; UserWarning: PyType;
  DeprecationWarning: PyType; SyntaxWarning: PyType; RuntimeWarning: PyType; FutureWarning: PyType; ExceptionGroup: PyType;
  BaseExceptionGroup: PyType; MemoryError: PyType; ReferenceError: PyType; BufferError: PyType; TimeoutError: PyType;
  FloatingPointError: PyType; ImportWarning: PyType; PendingDeprecationWarning: PyType; ResourceWarning: PyType;
  BytesWarning: PyType; UnicodeWarning: PyType; EncodingWarning: PyType;
};
