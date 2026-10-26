/** Constructores compactos para escribir lecciones. */
import type { AnyChallenge, Challenge, CourseId, DemoLine, IllustrationId, Lesson, PyChallenge, Question, SqlChallenge, Step, WorldDef, LevelId } from './types';
import type { SqlSetup } from '@/sqlengine/judge';
import type { WorldOptions } from '@/engine/world';
import type { Check } from '@/engine/check';

export const learn = (title: string, body: string, emoji?: string): Step => ({ type: 'learn', title, body: body.trim(), emoji });

export const demo = (title: string, lines: (string | [string] | [string, string] | [string, string, 'error'])[], setup?: WorldOptions, intro?: string): Step => ({
  type: 'demo',
  title,
  intro,
  setup,
  lines: lines.map((l): DemoLine => (typeof l === 'string' ? { cmd: l } : { cmd: l[0], note: l[1], ...(l[2] === 'error' ? { error: true } : {}) })),
});

export const illus = (id: IllustrationId, title?: string, caption?: string): Step => ({ type: 'illustration', id, title, caption });

export const quiz = (q: Question): Step => ({ type: 'quiz', q });

export const mc = (q: string, options: string[], answer: number, why: string, code?: string): Step => quiz({ t: 'mc', q, options, answer, why, code });
export const multi = (q: string, options: string[], answers: number[], why: string): Step => quiz({ t: 'multi', q, options, answers, why });
export const tf = (q: string, answer: boolean, why: string): Step => quiz({ t: 'tf', q, answer, why });
export const typeCmd = (q: string, answers: string[], why: string, o: { hint?: string; regex?: string; setup?: WorldOptions; check?: Check } = {}): Step =>
  quiz({ t: 'cmd', q, answers, why, ...o });
export const order = (q: string, pieces: string[], answer: string, why: string, alt?: string[]): Step => quiz({ t: 'order', q, pieces, answer, why, alt });
export const match = (q: string, pairs: [string, string][], why: string): Step => quiz({ t: 'match', q, pairs, why });
export const fill = (q: string, template: string, options: string[], answers: string[], why: string): Step => quiz({ t: 'fill', q, template, options, answers, why });
export const predict = (q: string, cmd: string, wrong: string[], why: string, setup?: WorldOptions): Step => quiz({ t: 'output', q, cmd, wrong, why, setup });

export type PracticeInput = Omit<Challenge, 'id'> & { id?: string };
export const practice = (c: PracticeInput): Step => ({ type: 'practice', challenge: { ...c, id: c.id ?? '' } });

export function lesson(
  id: string,
  o: { title: string; summary: string; emoji: string; commands: string[]; minutes?: number },
  steps: Step[],
): Lesson {
  let p = 0;
  const fixed = steps.map((s) => {
    if (s.type === 'practice') {
      p++;
      return { ...s, challenge: { ...s.challenge, id: s.challenge.id || `${id}-p${p}` } };
    }
    if (s.type === 'pypractice' || s.type === 'sqlpractice') {
      p++;
      return { ...s, challenge: { ...s.challenge, id: s.challenge.id || `${id}-p${p}` } } as Step;
    }
    return s;
  });
  return { id, title: o.title, summary: o.summary, emoji: o.emoji, commands: o.commands, steps: fixed, minutes: o.minutes ?? Math.max(4, Math.round(steps.length * 0.8)) };
}

export type PyPracticeInput = Omit<PyChallenge, 'id' | 'lang'> & { id?: string };
export type SqlPracticeInput = Omit<SqlChallenge, 'id' | 'lang' | 'setup'> & { id?: string; setup: SqlSetup | string };

export function world(
  w: Omit<WorldDef, 'boss' | 'course'> & { course?: CourseId; boss?: PracticeInput | PyPracticeInput | SqlPracticeInput },
): WorldDef {
  const course: CourseId = w.course ?? 'linux';
  const sqlSetup = (s: SqlSetup | string): SqlSetup => (typeof s === 'string' ? { db: s } : s);
  const boss: AnyChallenge | undefined = w.boss
    ? course === 'python'
      ? ({ ...(w.boss as PyPracticeInput), lang: 'py', id: w.boss.id ?? `${w.id}-boss` } as PyChallenge)
      : course === 'sql'
        ? ({ ...(w.boss as SqlPracticeInput), lang: 'sql', setup: sqlSetup((w.boss as SqlPracticeInput).setup), id: w.boss.id ?? `${w.id}-boss` } as SqlChallenge)
        : ({ ...(w.boss as PracticeInput), id: w.boss.id ?? `${w.id}-boss` } as Challenge)
    : undefined;
  return { ...w, course, boss };
}

export type { LevelId };
