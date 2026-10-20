/**
 * Sesión de Python: un intérprete con su espacio de nombres `__main__`, sistema de archivos virtual y estado.
 */
import './runtime/install';
import './stdlib/all';
import type { PyError, PyOptions, PyRunResult, PySessionApi, RunOptions } from './types';
import { Interp, decodeUtf8 } from './runtime/interp';
import { setActive } from './runtime/state';
import { installBuiltins } from './runtime/builtins';
import { importModule, newModule } from './runtime/modules';
import { compileSource, runCode } from './compile';
import { PySyntaxErr } from './lexer';
import { PyList } from './runtime/objects';
import { Aborted, NeedInput, StepLimit, makeExc } from './runtime/errors';
import { PyBaseException, PyDict, PyModule } from './runtime/objects';
import { E } from './runtime/exc_types';
import { toPyExc } from './runtime/call';
import * as ops from './runtime/ops';
import { emitWarnings, formatException, syntaxErrToExc, toPyError } from './runtime/traceback';

interface Attempt {
  result?: PyRunResult;
  need?: string;
}

export class PySession implements PySessionApi {
  readonly I: Interp;
  private lastResult: PyRunResult | undefined;
  private lastSrc = '';

  constructor(opts: PyOptions = {}) {
    this.I = new Interp(opts);
    const I = this.I;
    I.stdinLines = (opts.stdin ?? []).slice();
    const prev = setActive(I);
    try {
      installBuiltins(I.builtins);
      const main = newModule(I, '__main__');
      main.dict!.set('__doc__', null);
      I.mainModule = main;
      I.mainGlobals = main.dict!;
      I.modules.set('__main__', main);
      importModule(I, 'builtins');
      importModule(I, 'sys');
    } finally {
      setActive(prev);
    }
  }

  // ───────────── ejecución ─────────────

  private snapshot(): () => void {
    const I = this.I;
    const g = I.mainGlobals!;
    const entries = [...g.m.entries()].map(([k, e]) => [k, { k: e.k, v: e.v }] as const);
    const nodes = [...I.vfs.nodes.entries()].map(([k, n]) => [k, { ...n, data: n.data.slice() }] as const);
    const clock = I.clockOffsetMs;
    const perf = I.perf;
    const hooks = I.snapHooks.map((h) => h());
    const modKeys = new Set(I.modules.keys().map(String));
    return () => {
      g.m = new Map(entries.map(([k, e]) => [k, { k: e.k, v: e.v }]));
      I.vfs.nodes = new Map(nodes.map(([k, n]) => [k, { ...n, data: n.data.slice() }]));
      I.clockOffsetMs = clock;
      I.perf = perf;
      for (const r of hooks) r();
      for (const k of I.modules.keys().map(String)) if (!modKeys.has(k)) I.modules.delete(k);
    };
  }

  async run(code: string, o: RunOptions = {}): Promise<PyRunResult> {
    const I = this.I;
    const mode = o.mode ?? 'exec';
    const filename = o.filename ?? (mode === 'repl' ? '<stdin>' : 'main.py');
    if (mode === 'exec') {
      this.lastSrc = code;
      const argv = I.sysModule?.dict?.get('argv');
      if (o.filename && argv instanceof PyList && argv.a.length === 1 && argv.a[0] === 'main.py') argv.a[0] = o.filename;
    }
    const restore = o.onInput ? this.snapshot() : null;
    const startPos = I.stdinPos;
    const baseOut = I.allOut;
    const baseErr = I.allErr;
    let emitted = 0;
    let attempt = 0;
    for (;;) {
      if (attempt > 0 && restore) restore();
      I.stdinPos = startPos;
      I.skipChars = emitted;
      I.written = 0;
      I.allOut = baseOut;
      I.allErr = baseErr;
      I.needInput = o.onInput
        ? (prompt: string) => {
          throw new NeedInput(prompt);
        }
        : null;
      const r = this.runOnce(code, mode, filename, o);
      emitted += I.written;
      if (r.need !== undefined) {
        // el programa pide una línea: se muestra el aviso y se espera la respuesta
        if (r.need) {
          I.skipChars = 0;
          const w = I.written;
          I.onWrite = o.onOutput ?? null;
          I.write(r.need, false);
          I.onWrite = null;
          emitted += I.written - w;
        }
        const line = await o.onInput!(r.need);
        I.stdinLines.push(line);
        attempt++;
        continue;
      }
      I.needInput = null;
      this.lastResult = r.result!;
      return r.result!;
    }
  }

  private runOnce(code: string, mode: 'exec' | 'repl', filename: string, o: RunOptions): Attempt {
    const I = this.I;
    I.steps = 0;
    I.nextCheck = Math.min(I.maxSteps, 1024);
    I.depth = 0;
    I.frame = null;
    I.curExc = null;
    I.outChunks = [];
    I.errChunks = [];
    I.runLog = [];
    I.onWrite = o.onOutput ?? null;
    I.signal = o.signal ?? null;
    I.replValue = undefined;
    const prev = setActive(I);
    const res: PyRunResult = { ok: true, stdout: '', stderr: '' };
    try {
      try {
        const unit = compileSource(I, code, { filename, repl: mode === 'repl' });
        emitWarnings(I, unit.warnings, filename, unit.lines);
        if (mode === 'exec' && filename !== '<stdin>') I.mainGlobals!.set('__file__', filename);
        runCode(I, unit.code, I.mainGlobals!);
        if (mode === 'repl' && I.replValue !== undefined && I.replValue !== null) {
          res.value = ops.repr(I.replValue);
          I.builtins.set('_', I.replValue);
        }
        this.runAtExit();
      } catch (e) {
        if (e instanceof NeedInput) return { need: e.prompt };
        this.handleError(e, code, filename, res);
      }
    } finally {
      I.onWrite = null;
      setActive(prev);
    }
    I.flushFiles();
    res.stdout = I.outChunks.join('');
    res.stderr = I.errChunks.join('');
    return { result: res };
  }

  private runAtExit(): void {
    const I = this.I;
    while (I.atexit.length > 0) {
      const h = I.atexit.pop()!;
      try {
        ops.callObj(h.fn, h.args.slice());
      } catch (e) {
        const pe = toPyExc(e);
        if (pe === null) throw e;
        I.write(`Exception ignored in atexit callback ${ops.repr(h.fn)}:\n` + formatException(I, pe), true);
      }
    }
  }

  private handleError(e: unknown, code: string, filename: string, res: PyRunResult): void {
    const I = this.I;
    res.ok = false;
    if (e instanceof PySyntaxErr) {
      const exc = syntaxErrToExc(e, filename, code);
      this.report(exc, res);
      return;
    }
    if (e instanceof StepLimit) {
      res.timedOut = true;
      const where = e.line !== undefined ? ` (línea ${e.line}${e.fn && e.fn !== '<module>' ? `, en ${e.fn}` : ''})` : '';
      const msg = `El programa se detuvo porque tardó demasiado${where}. ¿Hay un bucle infinito?`;
      I.write(`Traceback (most recent call last):\n  File "${filename}"${e.line !== undefined ? `, line ${e.line}` : ''}\nKeyboardInterrupt: ${msg}\n`, true);
      res.error = { type: 'KeyboardInterrupt', message: msg, line: e.line, traceback: '' };
      return;
    }
    if (e instanceof Aborted) {
      const exc = makeExc(E.KeyboardInterrupt, []);
      this.report(exc, res);
      return;
    }
    const pe = toPyExc(e);
    if (pe === null) throw e;
    if (pe.cls.isSubtype(E.SystemExit)) {
      const c = pe.extra && pe.extra.code !== undefined ? pe.extra.code : pe.args.length === 0 ? null : pe.args.length === 1 ? pe.args[0] : pe.args;
      if (c === null || c === 0) {
        res.ok = true;
        res.exitCode = 0;
        return;
      }
      const iv = ops.intValue(c);
      if (iv !== undefined) {
        res.exitCode = Number(iv);
        res.ok = res.exitCode === 0;
        return;
      }
      I.write(ops.str(c) + '\n', true);
      res.exitCode = 1;
      return;
    }
    this.report(pe, res);
  }

  private report(exc: PyBaseException, res: PyRunResult): void {
    const I = this.I;
    I.lastExc = exc;
    const err: PyError = toPyError(I, exc);
    I.write(err.traceback, true);
    res.error = err;
  }

  // ───────────── consultas ─────────────

  evalRepr(expr: string): { ok: true; value: string } | { ok: false; error: PyError } {
    const I = this.I;
    const prev = setActive(I);
    const savedSteps = I.steps;
    const savedFrame = I.frame;
    const savedDepth = I.depth;
    I.steps = 0;
    I.nextCheck = Math.min(I.maxSteps, 1024);
    I.depth = 0;
    I.frame = null;
    const keepOut = [I.outChunks, I.errChunks, I.allOut, I.allErr, I.runLog, I.onWrite] as const;
    try {
      const unit = compileSource(I, expr.trim(), { filename: '<expr>', mode: 'eval' });
      const v = runCode(I, unit.code, I.mainGlobals!);
      return { ok: true, value: ops.repr(v) };
    } catch (e) {
      if (e instanceof PySyntaxErr) return { ok: false, error: toPyError(I, syntaxErrToExc(e, '<expr>', expr)) };
      if (e instanceof StepLimit) return { ok: false, error: { type: 'TimeoutError', message: 'La expresión tardó demasiado', traceback: '' } };
      const pe = toPyExc(e);
      if (pe === null) throw e;
      return { ok: false, error: toPyError(I, pe) };
    } finally {
      I.steps = savedSteps;
      I.frame = savedFrame;
      I.depth = savedDepth;
      [I.outChunks, I.errChunks, I.allOut, I.allErr, I.runLog, I.onWrite] = keepOut as any;
      setActive(prev);
    }
  }

  names(): string[] {
    const g = this.I.mainGlobals!;
    return g.keys().map(String).filter((k) => !(k.startsWith('__') && k.endsWith('__')));
  }

  readFile(path: string): string | undefined {
    const I = this.I;
    I.flushFiles();
    const n = I.vfs.get(I.vfs.abs(path));
    if (!n || n.kind !== 'file') return undefined;
    return decodeUtf8(n.data);
  }

  snapshotFiles(): Record<string, string> {
    this.I.flushFiles();
    return this.I.vfs.snapshot(decodeUtf8);
  }

  allStdout(): string {
    return this.I.allOut;
  }
  allStderr(): string {
    return this.I.allErr;
  }
  last(): PyRunResult | undefined {
    return this.lastResult;
  }
  lastSource(): string {
    return this.lastSrc;
  }

  /** globales de `__main__` (para comprobaciones) */
  globals(): PyDict {
    return this.I.mainGlobals!;
  }
}

export type { PyModule };
