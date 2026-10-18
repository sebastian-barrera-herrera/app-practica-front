import { WORLDS } from './index';
import type { Challenge, LevelId, Question } from './types';
import { seededShuffle } from '@/lib/cmdnorm';

export interface QItem {
  id: string;
  q: Question;
  lessonId: string;
  worldId: string;
}

let cache: QItem[] | null = null;
let byId: Map<string, QItem> | null = null;

export function allQuestions(): QItem[] {
  if (!cache) {
    cache = [];
    for (const w of WORLDS)
      for (const l of w.lessons)
        l.steps.forEach((s, i) => {
          if (s.type === 'quiz') cache!.push({ id: `${l.id}#${i}`, q: s.q, lessonId: l.id, worldId: w.id });
        });
    byId = new Map(cache.map((x) => [x.id, x]));
  }
  return cache;
}

export function questionById(id: string): QItem | undefined {
  allQuestions();
  return byId!.get(id);
}

export const questionsOfWorld = (worldId: string) => allQuestions().filter((x) => x.worldId === worldId);

export function questionsOfLevel(level: LevelId) {
  const ids = new Set(WORLDS.filter((w) => w.level === level).map((w) => w.id));
  return allQuestions().filter((x) => ids.has(x.worldId));
}

/** Tipos adecuados para pruebas rápidas (respuesta breve). */
export const FAST_TYPES = new Set(['mc', 'tf', 'cmd', 'fill', 'order', 'output']);

/** Elige n preguntas variando tipos y lecciones. */
export function pickVaried(pool: QItem[], n: number, seed: string): QItem[] {
  const shuffled = seededShuffle(pool, seed);
  const out: QItem[] = [];
  const perLesson = new Map<string, number>();
  const cap = Math.max(2, Math.ceil(n / new Set(pool.map((p) => p.lessonId)).size) + 1);
  for (const it of shuffled) {
    if (out.length >= n) break;
    if ((perLesson.get(it.lessonId) ?? 0) >= cap) continue;
    out.push(it);
    perLesson.set(it.lessonId, (perLesson.get(it.lessonId) ?? 0) + 1);
  }
  for (const it of shuffled) {
    if (out.length >= n) break;
    if (!out.includes(it)) out.push(it);
  }
  return out;
}

export function challengesOfWorld(worldId: string): Challenge[] {
  const w = WORLDS.find((x) => x.id === worldId);
  if (!w) return [];
  const list: Challenge[] = [];
  for (const l of w.lessons) for (const s of l.steps) if (s.type === 'practice') list.push(s.challenge);
  return list;
}

export function challengesOfLevel(level: LevelId): Challenge[] {
  return WORLDS.filter((w) => w.level === level).flatMap((w) => challengesOfWorld(w.id));
}
