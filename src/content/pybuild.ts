/** Constructores para el curso de Python (se combinan con los de `build.ts`: learn, mc, tf, order, match, fill…). */
import type { PyCheck, PyOptions } from '@/pyengine/types';
import type { PyCell, PyChallenge, Step, WorldDef, CourseId } from './types';
import { world as baseWorld, type PyPracticeInput } from './build';

/** Celda que se ejecuta como en el intérprete interactivo (>>>): cada sentencia se evalúa y muestra su valor. */
export const pyRepl = (code: string, note?: string): PyCell => ({ code, note, repl: true });
/** Celda que provoca un error a propósito (se muestra el traceback real). `repl` para ejecutarla como en >>>. */
export const pyErr = (code: string, note?: string, repl = false): PyCell => ({ code, note, error: true, ...(repl ? { repl: true } : {}) });
/** Celda que se ejecuta como un script completo. */
export const pyScript = (code: string, note?: string): PyCell => ({ code, note });

/**
 * Celdas de código que se ejecutan en orden en una sesión compartida (el estado pasa de una celda a la siguiente).
 * Cada celda: código (script), [código, nota] o el resultado de `pyRepl(...)`.
 */
export const pyDemo = (title: string, cells: (string | [string] | [string, string] | PyCell)[], setup?: PyOptions, intro?: string): Step => ({
  type: 'pydemo',
  title,
  intro,
  setup,
  cells: cells.map((c): PyCell => (typeof c === 'string' ? { code: c } : Array.isArray(c) ? { code: c[0], note: c[1] } : c)),
});

export const pyPractice = (c: PyPracticeInput): Step => ({ type: 'pypractice', challenge: { ...c, lang: 'py', id: c.id ?? '' } as PyChallenge });

/** Escribir código dentro de un quiz (mini reto). */
export const pyCode = (q: string, o: { starter?: string; setup?: PyOptions; check: PyCheck; solution: string; hint?: string; why: string }): Step => ({
  type: 'quiz',
  q: { t: 'pycode', q, ...o },
});

/** Predecir la salida de un fragmento de Python. */
export const pyOut = (q: string, code: string, wrong: string[], why: string, setup?: PyOptions): Step => ({
  type: 'quiz',
  q: { t: 'pyout', q, code, wrong, why, setup },
});

export const pyWorld = (w: Omit<WorldDef, 'boss' | 'course'> & { boss?: PyPracticeInput }): WorldDef => baseWorld({ ...w, course: 'python' as CourseId });
