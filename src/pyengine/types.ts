/**
 * CONTRATO PÚBLICO del intérprete de Python de Dev Dojo.
 *
 * La app (retos, demos, laboratorio, exámenes, tests de contenido) solo depende de lo que se declara aquí
 * y de lo que exporta `src/pyengine/index.ts`. La implementación vive en el resto de `src/pyengine/`.
 *
 * Objetivo: Python 3.13 (la versión instalada en el entorno de desarrollo para pruebas diferenciales).
 * El intérprete es 100 % TypeScript, sin dependencias nativas, determinista y sin acceso real a red ni disco.
 */

// ───────────────────────── opciones de ejecución ─────────────────────────

export interface PyOptions {
  /**
   * Sistema de archivos virtual inicial: ruta → contenido.
   * Las rutas relativas cuelgan del cwd. Una ruta terminada en "/" crea un directorio vacío.
   * Los .py presentes en el cwd son importables (`import utils`).
   */
  files?: Record<string, string>;
  /** Líneas disponibles para input() / sys.stdin. Si se agotan y no hay `onInput`: EOFError (como Python). */
  stdin?: string[];
  /** Semilla inicial del módulo `random` (por defecto fija ⇒ ejecuciones deterministas). */
  seed?: number;
  /** sys.argv (por defecto ['main.py']). */
  argv?: string[];
  /** Presupuesto de pasos del evaluador (≈ nodos evaluados). Por defecto 5_000_000. Al agotarse ⇒ `timedOut`. */
  maxSteps?: number;
  /** sys.getrecursionlimit() (por defecto 1000). Al superarlo ⇒ RecursionError como en CPython. */
  recursionLimit?: number;
  /** Instante virtual inicial (ms desde epoch UTC) para time/datetime. Por defecto 2025-03-14T09:30:00Z. */
  now?: number;
  /** Directorio de trabajo inicial (por defecto /home/alumno). */
  cwd?: string;
}

// ───────────────────────── resultados ─────────────────────────

export interface PyError {
  /** Nombre de la clase de la excepción: "NameError", "ZeroDivisionError", "SyntaxError", "MiError"… */
  type: string;
  /** str(excepción), p. ej. "name 'x' is not defined". */
  message: string;
  /** Línea (1-based) del último frame del traceback, si se conoce. */
  line?: number;
  /** Texto completo estilo CPython (empieza por "Traceback (most recent call last):" o por el bloque SyntaxError). */
  traceback: string;
}

export interface PyRunResult {
  /** true si terminó sin excepción sin capturar (sys.exit(0) cuenta como ok). */
  ok: boolean;
  /** Todo lo escrito en stdout durante esta llamada a run() (sin el eco de REPL). */
  stdout: string;
  /** Todo lo escrito en stderr durante esta llamada, incluido el traceback si hubo error. */
  stderr: string;
  /** Excepción sin capturar (si la hubo). */
  error?: PyError;
  /** Solo en modo 'repl': repr() del valor de la última expresión (undefined si no era expresión o devolvió None). */
  value?: string;
  /** Se agotó `maxSteps` (probable bucle infinito). `error` describe el caso. */
  timedOut?: boolean;
  /** Código de salida si el programa llamó a sys.exit()/exit()/quit(). */
  exitCode?: number;
}

export interface RunOptions {
  /**
   * 'exec' (por defecto): el código es un módulo/script; el nombre de archivo se usa en los tracebacks.
   * 'repl': igual que el intérprete interactivo: una sentencia (posiblemente compuesta) por llamada y
   *         las expresiones con valor ≠ None se devuelven en `value` (la UI las imprime con su repr).
   */
  mode?: 'exec' | 'repl';
  /** Nombre del archivo para los tracebacks. exec: 'main.py' por defecto; repl: '<stdin>'. */
  filename?: string;
  /** Salida en streaming (se invoca a medida que el programa escribe). Útil para la UI. */
  onOutput?: (text: string, isErr: boolean) => void;
  /**
   * Entrada interactiva. Se llama cuando input()/sys.stdin necesita una línea y `stdin` está agotado.
   * Devuelve la línea (sin "\n") o null para EOF. La implementación puede reejecutar el programa de forma
   * determinista para reanudarlo: la UI NO debe preocuparse de ello (ver README de pyengine).
   */
  onInput?: (prompt: string) => Promise<string | null>;
  /** Permite abortar una ejecución larga (Ctrl+C ⇒ KeyboardInterrupt). */
  signal?: { aborted: boolean };
}

// ───────────────────────── sesión ─────────────────────────

export interface PySessionApi {
  /** Ejecuta código en el espacio de nombres `__main__` de la sesión. El estado persiste entre llamadas. */
  run(code: string, o?: RunOptions): Promise<PyRunResult>;
  /** Evalúa una expresión en `__main__` (síncrono) y devuelve su repr(). No imprime nada. */
  evalRepr(expr: string): { ok: true; value: string } | { ok: false; error: PyError };
  /** Nombres definidos por el usuario en `__main__` (sin los dunder). */
  names(): string[];
  /** Contenido de un archivo del FS virtual (undefined si no existe). */
  readFile(path: string): string | undefined;
  /** Instantánea del FS virtual: ruta absoluta → contenido (los directorios acaban en "/"). */
  snapshotFiles(): Record<string, string>;
  /** Todo lo escrito en stdout desde que se creó la sesión. */
  allStdout(): string;
  /** Todo lo escrito en stderr desde que se creó la sesión. */
  allStderr(): string;
  /** Resultado de la última llamada a run(). */
  last(): PyRunResult | undefined;
  /** Texto de todo el código ejecutado con run() en modo 'exec' (la última llamada) — para comprobaciones de código fuente. */
  lastSource(): string;
}

// ───────────────────────── análisis estático ─────────────────────────

export interface Analysis {
  ok: boolean;
  /** Si el código no compila: error de sintaxis con el formato de CPython. */
  syntaxError?: PyError;
  /**
   * Cuántas veces aparece cada "característica" en el código. Claves (tras el prefijo, el nombre exacto):
   *  - Nombres de nodos de la librería `ast` de CPython: "For", "While", "If", "FunctionDef", "AsyncFunctionDef",
   *    "ClassDef", "Lambda", "ListComp", "SetComp", "DictComp", "GeneratorExp", "Try", "With", "Raise", "Assert",
   *    "Yield", "YieldFrom", "Await", "Import", "ImportFrom", "Return", "Global", "Nonlocal", "Match", "JoinedStr"
   *    (f-string), "Slice", "Starred", "NamedExpr", "IfExp", "Delete", "AugAssign", "AnnAssign", "Break", "Continue",
   *    "Pass", "Dict", "Set", "List", "Tuple", "Subscript", "BoolOp", "Compare", "BinOp", "UnaryOp", "Call", "Attribute".
   *  - "call:NOMBRE"   → llamada directa a un nombre (`print(...)` ⇒ "call:print").
   *  - "method:NOMBRE" → llamada a un método/atributo (`xs.append(1)` ⇒ "method:append").
   *  - "import:MODULO" → `import json` / `from json import loads` ⇒ "import:json".
   *  - "name:NOMBRE"   → cualquier referencia a un nombre (carga).
   *  - "def:NOMBRE" / "class:NOMBRE" → definiciones.
   *  - "op:+" "op:-" "op:*" "op:/" "op://" "op:%" "op:**" "op:@" "op:&" "op:|" "op:^" "op:<<" "op:>>" (BinOp y AugAssign).
   *  - "decorator:NOMBRE" → decoradores aplicados.
   */
  features: Record<string, number>;
}

// ───────────────────────── comprobaciones de retos ─────────────────────────

/** Texto esperado en una salida. Se compara tras `trimEnd()` de cada lado salvo que se indique. */
export interface TextSpec {
  equals?: string;
  includes?: string | string[];
  /** Con `includes` como lista: basta con una (por defecto deben estar todas). */
  any?: boolean;
  notIncludes?: string | string[];
  /** Expresión regular (flags "m"). */
  matches?: string;
  /** Número de líneas no vacías. */
  lines?: number;
}

export type PyCheck =
  /** Salida estándar de la ÚLTIMA ejecución del código del alumno. */
  | ({ t: 'stdout' } & TextSpec)
  /** Salida de error (tracebacks incluidos) de la última ejecución. */
  | ({ t: 'stderr' } & TextSpec)
  /** La última ejecución terminó sin excepción. */
  | { t: 'ok' }
  /** La última ejecución terminó con una excepción de ese tipo (p. ej. 'ZeroDivisionError'; acepta subclases por nombre exacto). */
  | { t: 'raises'; type: string; message?: string }
  /** repr() de una variable global == `equals` (p. ej. "[1, 2, 3]", "'hola'", "{'a': 1}", "3.5"). */
  | { t: 'var'; name: string; equals: string }
  /** repr() de una expresión evaluada DESPUÉS del código del alumno == `equals`. Útil para probar funciones: expr: "suma(2, 3)". */
  | { t: 'expr'; expr: string; equals: string }
  /** Varias expresiones a la vez (azúcar de varios `expr`). Cada una se evalúa en una sesión limpia respecto a efectos de las anteriores solo si `isolate` es true. */
  | { t: 'calls'; tests: { expr: string; equals: string }[]; isolate?: boolean }
  /** Una expresión evaluada DESPUÉS del código debe ser verdadera (bool(expr)). */
  | { t: 'true'; expr: string; why?: string }
  /** Archivo del FS virtual. */
  | ({ t: 'file'; path: string; exists?: boolean } & TextSpec)
  /** El código usa una característica (ver `Analysis.features`) al menos `min` veces (por defecto 1). */
  | { t: 'uses'; feature: string; min?: number }
  /** El código NO usa esa característica. */
  | { t: 'forbids'; feature: string }
  /** Existe una función definida con ese nombre (y opcionalmente con ese nº de parámetros posicionales). */
  | { t: 'func'; name: string; params?: number }
  /** Existe una clase con ese nombre (y opcionalmente con esos atributos/métodos). */
  | { t: 'class'; name: string; has?: string[] }
  | { t: 'all'; checks: PyCheck[] }
  | { t: 'any'; checks: PyCheck[] }
  | { t: 'not'; check: PyCheck };

export interface PyCheckResult {
  ok: boolean;
  /** Mensaje (en español) de lo que falta, para pistas automáticas. */
  why?: string;
}

/** Contexto que necesita `evaluate` para comprobar un reto. */
export interface PyCheckContext {
  session: PySessionApi;
  /** Código que escribió el alumno en su última ejecución. */
  code: string;
}
