import type { LevelDef, Lesson, WorldDef, Challenge, Step } from './types';
import { w1 } from './worlds/w1';

export const LEVELS: LevelDef[] = [
  { id: 'basico', title: 'Nivel Básico', subtitle: 'Cinturón blanco', color: '#22D3A6', emoji: '🥋' },
  { id: 'intermedio', title: 'Nivel Intermedio', subtitle: 'Cinturón azul', color: '#38BDF8', emoji: '🔷' },
  { id: 'avanzado', title: 'Nivel Avanzado', subtitle: 'Cinturón negro', color: '#A78BFA', emoji: '⚫' },
];

export const WORLDS: WorldDef[] = [w1];

export const LESSONS: Lesson[] = WORLDS.flatMap((w) => w.lessons);

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);
export const worldById = (id: string): WorldDef | undefined => WORLDS.find((w) => w.id === id);
export const worldOfLesson = (lessonId: string): WorldDef | undefined => WORLDS.find((w) => w.lessons.some((l) => l.id === lessonId));

export function allChallenges(): { challenge: Challenge; lessonId: string | null; worldId: string }[] {
  const out: { challenge: Challenge; lessonId: string | null; worldId: string }[] = [];
  for (const w of WORLDS) {
    for (const l of w.lessons) for (const s of l.steps) if (s.type === 'practice') out.push({ challenge: s.challenge, lessonId: l.id, worldId: w.id });
    if (w.boss) out.push({ challenge: w.boss, lessonId: null, worldId: w.id });
  }
  return out;
}

export function stepKey(lessonId: string, index: number) {
  return `${lessonId}#${index}`;
}

export type { Step };
