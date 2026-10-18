import type { LevelDef, Lesson, WorldDef, Challenge, Step } from './types';
import { w1 } from './worlds/w1';
import { w2 } from './worlds/w2';
import { w3 } from './worlds/w3';
import { w4 } from './worlds/w4';
import { w5 } from './worlds/w5';
import { w6 } from './worlds/w6';
import { w7 } from './worlds/w7';
import { w8 } from './worlds/w8';
import { w9 } from './worlds/w9';
import { w10 } from './worlds/w10';
import { w11 } from './worlds/w11';
import { w12 } from './worlds/w12';

export const LEVELS: LevelDef[] = [
  { id: 'basico', title: 'Nivel Básico', subtitle: 'Cinturón blanco', color: '#22D3A6', emoji: '🥋' },
  { id: 'intermedio', title: 'Nivel Intermedio', subtitle: 'Cinturón azul', color: '#38BDF8', emoji: '🔷' },
  { id: 'avanzado', title: 'Nivel Avanzado', subtitle: 'Cinturón negro', color: '#A78BFA', emoji: '⚫' },
];

export const WORLDS: WorldDef[] = [w1, w2, w3, w4, w5, w6, w7, w8, w9, w10, w11, w12];

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
