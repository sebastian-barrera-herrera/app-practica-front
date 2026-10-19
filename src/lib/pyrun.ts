/**
 * Adaptador entre la interfaz y el intérprete de Python (`src/pyengine`). Carga el motor de forma perezosa
 * (no pesa al arrancar) y ofrece una ejecución cómoda con salida en streaming y entrada interactiva.
 */
import type { Analysis, PyCheck, PyCheckContext, PyCheckResult, PyOptions, PyRunResult, PySessionApi, RunOptions } from '@/pyengine/types';

export interface PyEngine {
  PySession: new (opts?: PyOptions) => PySessionApi;
  evaluate: (check: PyCheck, ctx: PyCheckContext) => PyCheckResult;
  analyze: (code: string) => Analysis;
  isIncomplete: (source: string) => boolean;
}

let engine: PyEngine | null = null;

/** El motor completo (se carga la primera vez que se necesita). */
export function pyEngine(): PyEngine {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (engine ??= require('@/pyengine') as PyEngine);
}

export interface OutChunk {
  text: string;
  err: boolean;
  /** 'echo' = lo que escribió el alumno (prompt >>>); se pinta aparte de la salida del programa. */
  kind?: 'echo';
}

/** Ejecuta código en una sesión nueva (o la dada) y devuelve resultado + salida en orden. */
export async function runPython(
  code: string,
  o: { session?: PySessionApi; setup?: PyOptions; run?: RunOptions; onChunk?: (c: OutChunk) => void } = {},
): Promise<{ session: PySessionApi; result: PyRunResult; chunks: OutChunk[] }> {
  const session = o.session ?? new (pyEngine().PySession)(o.setup);
  const chunks: OutChunk[] = [];
  const result = await session.run(code, {
    ...o.run,
    onOutput: (text, isErr) => {
      const c = { text, err: isErr };
      chunks.push(c);
      o.onChunk?.(c);
      o.run?.onOutput?.(text, isErr);
    },
  });
  return { session, result, chunks };
}

/** Salida estándar de un fragmento (para preguntas de «predice la salida»). */
export async function pythonStdout(code: string, setup?: PyOptions): Promise<string> {
  const { result } = await runPython(code, { setup });
  return result.stdout.trimEnd();
}
