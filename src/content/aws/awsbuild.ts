/** Constructores para las lecciones de AWS: comprobaciones del estado de la cuenta y mundos de práctica. */
import type { AwsSetup } from '@/awsengine/scenarios';
import type { AwsCheckSpec } from '@/awsengine/check';
import type { WorldOptions } from '@/engine/world';
import { world, type PracticeInput } from '../build';
import type { WorldDef } from '../types';

export { demo, fill, illus, learn, lesson, match, mc, multi, order, practice, predict, tf, typeCmd } from '../build';
export { all, any, content, exists, missing, not, out, outEq, outRe, ran, exitCode } from '@/engine/check';

/** Mundo de práctica con una cuenta de AWS: nombre de escenario o configuración completa. */
export const A = (aws: string | AwsSetup = 'base', extra: Omit<WorldOptions, 'aws'> = {}): WorldOptions => ({ aws, hostname: 'aws-lab', ...extra });

const spec = (cmd: string, o: Omit<AwsCheckSpec, 't' | 'cmd'>): AwsCheckSpec => ({ t: 'aws', cmd, ...o });

/** El resultado de la consulta (JSON) es exactamente `json`. */
export const awsIs = (cmd: string, json: unknown, want?: string) => spec(cmd, { json, want });
/** La salida de la consulta contiene el texto. */
export const awsHas = (cmd: string, includes: string | string[], want?: string) => spec(cmd, { includes, want });
/** La consulta no devuelve nada (lista vacía, null…). */
export const awsEmpty = (cmd: string, want?: string) => spec(cmd, { empty: true, want });
/** La consulta devuelve algo. */
export const awsAny = (cmd: string, want?: string) => spec(cmd, { empty: false, want });
/** El comando tiene que fallar (opcionalmente con este texto de error). */
export const awsFails = (cmd: string, includes?: string, want?: string) => spec(cmd, { fails: true, includes, want });
/** La salida cumple la expresión regular. */
export const awsMatches = (cmd: string, matches: string, want?: string) => spec(cmd, { matches, want });

/** Zona de AWS. Igual que `world` de Linux, pero fija el curso. */
export function awsWorld(w: Omit<WorldDef, 'boss' | 'course'> & { boss?: PracticeInput }): WorldDef {
  return world({ ...w, course: 'aws' });
}
