/**
 * Intérprete de Python de Dev Dojo (TypeScript puro, objetivo CPython 3.13). Ver README.md.
 *
 * Uso:
 *   const s = new PySession({ stdin: ['Ana'] });
 *   const r = await s.run('print(input("¿Cómo te llamas? "))');
 *   evaluate({ t: 'stdout', includes: 'Ana' }, { session: s, code: '…' });
 */
export { PySession } from './session';
export { analyze, isIncomplete } from './analyze';
export { evaluate } from './check';
export type * from './types';

import type { PyCheck } from './types';

/** Constructores cómodos para escribir comprobaciones (retos y preguntas del curso). */
export const check = {
  stdout: (equals: string): PyCheck => ({ t: 'stdout', equals }),
  includes: (...s: string[]): PyCheck => ({ t: 'stdout', includes: s }),
  ok: (): PyCheck => ({ t: 'ok' }),
  raises: (type: string, message?: string): PyCheck => ({ t: 'raises', type, message }),
  variable: (name: string, equals: string): PyCheck => ({ t: 'var', name, equals }),
  expr: (expr: string, equals: string): PyCheck => ({ t: 'expr', expr, equals }),
  calls: (tests: [string, string][], isolate = false): PyCheck => ({ t: 'calls', tests: tests.map(([expr, equals]) => ({ expr, equals })), isolate }),
  all: (...checks: PyCheck[]): PyCheck => ({ t: 'all', checks }),
  any: (...checks: PyCheck[]): PyCheck => ({ t: 'any', checks }),
  not: (c: PyCheck): PyCheck => ({ t: 'not', check: c }),
  uses: (feature: string, min = 1): PyCheck => ({ t: 'uses', feature, min }),
  forbids: (feature: string): PyCheck => ({ t: 'forbids', feature }),
};
