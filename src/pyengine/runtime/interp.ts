/**
 * Estado de un intérprete (una sesión): límites, salida, módulos, sistema de archivos virtual, reloj virtual…
 */
import type { PyOptions } from '../types';
import {
  Frame, PyBaseException, PyDict, PyModule, PyObject, type PyType,
} from './objects';
import { StepLimit, Aborted } from './errors';
import { VFS } from './vfs';
import { utf8Decode, utf8Encode } from './pystr';

export const DEFAULT_NOW = Date.UTC(2025, 2, 14, 9, 30, 0);

export interface RunSignals {
  signal?: { aborted: boolean };
}

export class Interp {
  // límites
  steps = 0;
  maxSteps: number;
  depth = 0;
  recursionLimit: number;
  nextCheck = 0;
  signal: { aborted: boolean } | null = null;

  frame: Frame | null = null;
  curExc: PyBaseException | null = null;
  hashBuckets = new Map<number, any[]>();

  // salida
  outChunks: string[] = [];
  errChunks: string[] = [];
  allOut = '';
  allErr = '';
  /** secuencia ordenada de escrituras: (texto, esError) */
  runLog: { text: string; isErr: boolean }[] = [];
  onWrite: ((text: string, isErr: boolean) => void) | null = null;
  /** caracteres (en orden de escritura) que ya se emitieron y deben omitirse al reejecutar */
  skipChars = 0;
  written = 0;

  // espacios de nombres
  builtins: PyDict;
  modules: PyDict;
  mainModule: PyModule | null = null;
  vfs: VFS;
  sysModule: PyModule | null = null;

  // reloj virtual (ms desde epoch)
  clockBase: number;
  clockOffsetMs = 0;
  perf = 0;
  /** milisegundos sumados por llamada al reloj */
  tickMs = 0.001;

  // identidad
  private nextId = 0x7f3a5c0d0000;
  private ids = new WeakMap<object, number>();
  private primIds = new Map<any, number>();

  // entrada
  stdinLines: (string | null)[] = [];
  stdinPos = 0;
  /** estado de reejecución: el programa necesita más líneas que las registradas */
  needInput: ((prompt: string) => never) | null = null;

  // caches de módulos y fuentes
  sources = new Map<string, string[]>();
  warnedOnce = new Set<string>();
  /** objetos por módulo nativo (estado propio de cada módulo para esta sesión) */
  modState = new Map<string, any>();
  options: PyOptions;
  programName = 'main.py';
  argv: string[];
  seed: number;
  replValue: any = undefined;
  /** última excepción no capturada (sys.last_exc) */
  lastExc: PyBaseException | null = null;
  /** lista de funciones registradas con atexit */
  atexit: { fn: any; args: any[] }[] = [];
  /** globales del módulo principal */
  mainGlobals: PyDict | null = null;
  /** futuro `annotations` activo por nombre de archivo */
  strAnnotations = new Set<string>();
  extraFlags: Record<string, any> = {};
  /** archivos abiertos con datos pendientes de volcar al sistema de archivos virtual */
  openFiles = new Set<{ flushNow: () => void }>();
  /** funciones que guardan el estado mutable de módulos nativos y devuelven la que lo restaura (reejecución por input) */
  snapHooks: (() => (() => void))[] = [];

  constructor(opts: PyOptions = {}) {
    this.options = opts;
    this.maxSteps = opts.maxSteps ?? 5_000_000;
    this.recursionLimit = opts.recursionLimit ?? 1000;
    this.clockBase = opts.now ?? DEFAULT_NOW;
    this.seed = opts.seed ?? 12345;
    this.argv = opts.argv ?? ['main.py'];
    this.builtins = new PyDict();
    this.modules = new PyDict();
    const cwd = opts.cwd ?? '/home/alumno';
    this.vfs = new VFS(cwd, () => this.nowMs());
    if (opts.files) {
      this.vfs.load(opts.files, (s) => Uint8Array.from(utf8Encode(s)));
    }
    this.nextCheck = Math.min(this.maxSteps, 1024);
  }

  /** vuelca al sistema de archivos virtual los datos pendientes de los archivos abiertos */
  flushFiles(): void {
    for (const f of this.openFiles) f.flushNow();
  }

  /** instante virtual actual en ms */
  nowMs(): number {
    return this.clockBase + this.clockOffsetMs;
  }
  /** avanza el reloj virtual (sleep) */
  advance(ms: number): void {
    this.clockOffsetMs += ms;
    this.perf += ms / 1000;
  }
  /** lectura del reloj: cada lectura avanza una fracción para que sea estrictamente creciente */
  readClock(): number {
    this.clockOffsetMs += this.tickMs;
    this.perf += this.tickMs / 1000;
    return this.nowMs();
  }

  /** paso lento del contador: comprueba límite y señal de aborto */
  tickSlow(): void {
    if (this.steps > this.maxSteps) throw new StepLimit();
    if (this.signal && this.signal.aborted) throw new Aborted();
    this.nextCheck = Math.min(this.maxSteps, this.steps + 1024);
  }

  write(text: string, isErr: boolean): void {
    if (text === '') return;
    if (isErr) {
      this.errChunks.push(text);
      this.allErr += text;
    } else {
      this.outChunks.push(text);
      this.allOut += text;
    }
    this.runLog.push({ text, isErr });
    // emisión (omitiendo lo ya emitido en intentos anteriores)
    let out = text;
    if (this.skipChars > 0) {
      if (this.skipChars >= out.length) {
        this.skipChars -= out.length;
        out = '';
      } else {
        out = out.slice(this.skipChars);
        this.skipChars = 0;
      }
    }
    if (out !== '') this.written += out.length;
    if (out !== '' && this.onWrite) this.onWrite(out, isErr);
  }

  /** identificador estable y verosímil de un objeto (dirección de memoria simulada) */
  idOf(x: any): number {
    if (typeof x === 'object' && x !== null || typeof x === 'function') {
      let id = this.ids.get(x);
      if (id === undefined) {
        this.nextId += 0x30 + ((this.nextId >> 4) & 0x30);
        id = this.nextId;
        this.ids.set(x, id);
      }
      return id;
    }
    // valores primitivos: identidad por valor
    if (x === null) return 0x7f3a5b000010;
    if (x === true) return 0x7f3a5b000020;
    if (x === false) return 0x7f3a5b000030;
    if (typeof x === 'number' && Number.isInteger(x) && x >= -5 && x <= 256) return 0x7f3a5b100000 + (x + 5) * 0x20;
    let id = this.primIds.get(x);
    if (id === undefined) {
      this.nextId += 0x20;
      id = this.nextId;
      this.primIds.set(x, id);
    }
    return id;
  }

  hexId(x: any): string {
    return '0x' + this.idOf(x).toString(16).padStart(12, '0');
  }

  /** texto de código fuente (líneas) de un nombre de archivo, para tracebacks */
  sourceLines(filename: string): string[] | undefined {
    return this.sources.get(filename);
  }
}

export function decodeUtf8(b: Uint8Array): string {
  return utf8Decode(b, (_pos, _byte) => '�');
}
export function encodeUtf8(s: string): Uint8Array {
  return Uint8Array.from(utf8Encode(s));
}

export type { PyObject, PyType };
