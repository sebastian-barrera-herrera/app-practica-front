/** Constructores de comprobaciones para los retos de Python (datos puros: no cargan el intérprete). */
import type { PyCheck, TextSpec } from '@/pyengine/types';

export const stdout = (equals: string): PyCheck => ({ t: 'stdout', equals });
export const outHas = (...s: string[]): PyCheck => ({ t: 'stdout', includes: s });
export const outAny = (...s: string[]): PyCheck => ({ t: 'stdout', includes: s, any: true });
export const outNot = (...s: string[]): PyCheck => ({ t: 'stdout', notIncludes: s });
export const outMatch = (re: string): PyCheck => ({ t: 'stdout', matches: re });
export const outLines = (n: number): PyCheck => ({ t: 'stdout', lines: n });
export const errHas = (...s: string[]): PyCheck => ({ t: 'stderr', includes: s });
export const ok = (): PyCheck => ({ t: 'ok' });
export const raises = (type: string, message?: string): PyCheck => ({ t: 'raises', type, message });
export const variable = (name: string, equals: string): PyCheck => ({ t: 'var', name, equals });
export const expr = (e: string, equals: string): PyCheck => ({ t: 'expr', expr: e, equals });
export const calls = (tests: [string, string][], isolate = false): PyCheck => ({ t: 'calls', tests: tests.map(([e, equals]) => ({ expr: e, equals })), isolate });
export const truthy = (e: string, why?: string): PyCheck => ({ t: 'true', expr: e, why });
export const file = (path: string, spec: TextSpec & { exists?: boolean } = {}): PyCheck => ({ t: 'file', path, ...spec });
export const uses = (feature: string, min = 1): PyCheck => ({ t: 'uses', feature, min });
export const forbids = (feature: string): PyCheck => ({ t: 'forbids', feature });
export const func = (name: string, params?: number): PyCheck => ({ t: 'func', name, params });
export const cls = (name: string, has?: string[]): PyCheck => ({ t: 'class', name, has });
export const all = (...checks: PyCheck[]): PyCheck => ({ t: 'all', checks });
export const any = (...checks: PyCheck[]): PyCheck => ({ t: 'any', checks });
export const not = (check: PyCheck): PyCheck => ({ t: 'not', check });
