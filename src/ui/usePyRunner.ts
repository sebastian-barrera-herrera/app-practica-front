import { useCallback, useEffect, useRef, useState } from 'react';
import type { PyOptions, PyRunResult, PySessionApi, RunOptions } from '@/pyengine/types';
import { error as hapticError } from '@/lib/haptics';
import { pyEngine, type OutChunk } from '@/lib/pyrun';

export interface InputRequest {
  prompt: string;
}

/**
 * Ejecuta código de Python mostrando la salida en vivo y pidiendo `input()` al alumno.
 * `run` devuelve la sesión (para evaluar comprobaciones después) y el resultado.
 */
export function usePyRunner() {
  const [chunks, setChunks] = useState<OutChunk[]>([]);
  const [running, setRunning] = useState(false);
  const [request, setRequest] = useState<InputRequest | null>(null);
  const resolver = useRef<((s: string | null) => void) | null>(null);
  const signal = useRef({ aborted: false });
  const buf = useRef<OutChunk[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const emittedErr = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      resolver.current?.(null);
    };
  }, []);

  const flush = useCallback(() => {
    timer.current = null;
    const add = buf.current;
    buf.current = [];
    if (add.length && alive.current) setChunks((c) => [...c, ...add]);
  }, []);

  const push = useCallback(
    (c: OutChunk) => {
      buf.current.push(c);
      if (!timer.current) timer.current = setTimeout(flush, 30);
    },
    [flush],
  );

  const clear = useCallback(() => {
    buf.current = [];
    setChunks([]);
  }, []);

  /** Ejecuta `code`. Sin `session`, crea una nueva con `setup`. */
  const run = useCallback(
    async (code: string, o: { session?: PySessionApi; setup?: PyOptions; mode?: RunOptions['mode']; keep?: boolean; filename?: string } = {}): Promise<{ session: PySessionApi; result: PyRunResult }> => {
      const session = o.session ?? new (pyEngine().PySession)(o.setup);
      if (!o.keep) clear();
      signal.current = { aborted: false };
      emittedErr.current = false;
      setRunning(true);
      let result: PyRunResult;
      try {
        result = await session.run(code, {
          mode: o.mode ?? 'exec',
          filename: o.filename,
          signal: signal.current,
          onOutput: (text, isErr) => {
            if (isErr) emittedErr.current = true;
            push({ text, err: isErr });
          },
          onInput: (prompt) =>
            new Promise<string | null>((resolve) => {
              flush();
              resolver.current = resolve;
              if (alive.current) setRequest({ prompt });
            }),
        });
        // si el motor no emitió el traceback por la salida, lo mostramos igualmente
        if (!result.ok && result.error && !emittedErr.current) push({ text: result.error.traceback + '\n', err: true });
        // un error de Python (o un bucle infinito cortado) avisa con una vibración
        if (!result.ok && (result.error || result.timedOut)) hapticError();
      } finally {
        flush();
        if (alive.current) {
          setRunning(false);
          setRequest(null);
        }
      }
      return { session, result };
    },
    [clear, flush, push],
  );

  const submitInput = useCallback(
    (line: string) => {
      const r = resolver.current;
      resolver.current = null;
      setRequest(null);
      // eco de lo que escribió el alumno, como en una terminal
      push({ text: line + '\n', err: false });
      r?.(line);
    },
    [push],
  );

  const stop = useCallback(() => {
    signal.current.aborted = true;
    resolver.current?.(null);
    resolver.current = null;
    setRequest(null);
  }, []);

  return { chunks, running, request, run, submitInput, stop, clear, push };
}
