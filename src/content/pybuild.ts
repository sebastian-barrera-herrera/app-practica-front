/** Constructores para el curso de Python (se combinan con los de `build.ts`: learn, mc, tf, order, match, fill…). */
import type { PyCheck, PyOptions } from '@/pyengine/types';
import type { PyChallenge, Step, WorldDef, CourseId } from './types';
import { world as baseWorld, type PyPracticeInput } from './build';

/** Celdas de código que se ejecutan en orden en una sesión compartida. Cada celda: código o [código, nota]. */
export const pyDemo = (title: string, cells: (string | [string] | [string, string])[], setup?: PyOptions, intro?: string): Step => ({
  type: 'pydemo',
  title,
  intro,
  setup,
  cells: cells.map((c) => (typeof c === 'string' ? { code: c } : { code: c[0], note: c[1] })),
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
