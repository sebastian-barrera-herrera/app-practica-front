/** Constructores del curso de IA: los mismos que Python (el curso corre sobre el mismo intérprete) con el curso fijado a «ia». */
import type { CourseId, WorldDef } from '../types';
import { world as baseWorld, type PyPracticeInput } from '../build';

export { fill, illus, learn, lesson, match, mc, multi, order, tf } from '../build';
export { pyCode, pyDemo, pyErr, pyOut, pyPractice, pyRepl, pyScript } from '../pybuild';
export { all, any, calls, cls, errHas, expr, file, forbids, func, not, ok, outAny, outHas, outLines, outMatch, outNot, raises, stdout, truthy, uses, variable } from '../pycheck';

/** Zona del curso de IA. */
export const iaWorld = (w: Omit<WorldDef, 'boss' | 'course'> & { boss?: PyPracticeInput }): WorldDef => baseWorld({ ...w, course: 'ia' as CourseId });
