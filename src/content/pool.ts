import { COURSES, COURSE_LIST } from './index';
import type { AnyChallenge, CourseId, LevelId, Question } from './types';
import { seededShuffle } from '@/lib/cmdnorm';

export interface QItem {
  id: string;
  q: Question;
  lessonId: string;
  worldId: string;
  course: CourseId;
}

const caches = new Map<CourseId, QItem[]>();
let byId: Map<string, QItem> | null = null;

export function allQuestions(course: CourseId): QItem[] {
  let list = caches.get(course);
  if (!list) {
    list = [];
    for (const w of COURSES[course].worlds)
      for (const l of w.lessons)
        l.steps.forEach((s, i) => {
          if (s.type === 'quiz') list!.push({ id: `${l.id}#${i}`, q: s.q, lessonId: l.id, worldId: w.id, course });
        });
    caches.set(course, list);
  }
  return list;
}

/** Busca una pregunta por id en cualquier curso. */
export function questionById(id: string): QItem | undefined {
  if (!byId) {
    const m = new Map<string, QItem>();
    for (const c of COURSE_LIST) for (const q of allQuestions(c.id)) m.set(q.id, q);
    byId = m;
  }
  return byId.get(id);
}

export const questionsOfWorld = (course: CourseId, worldId: string) => allQuestions(course).filter((x) => x.worldId === worldId);

export function questionsOfLevel(course: CourseId, level: LevelId) {
  const ids = new Set(COURSES[course].worlds.filter((w) => w.level === level).map((w) => w.id));
  return allQuestions(course).filter((x) => ids.has(x.worldId));
}

/** Tipos adecuados para pruebas rápidas (respuesta breve). */
export const FAST_TYPES = new Set(['mc', 'tf', 'cmd', 'fill', 'order', 'output', 'pyout']);

/** Elige n preguntas variando tipos y lecciones. */
export function pickVaried(pool: QItem[], n: number, seed: string): QItem[] {
  const shuffled = seededShuffle(pool, seed);
  const out: QItem[] = [];
  const perLesson = new Map<string, number>();
  const cap = Math.max(2, Math.ceil(n / Math.max(1, new Set(pool.map((p) => p.lessonId)).size)) + 1);
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

export function challengesOfWorld(course: CourseId, worldId: string): AnyChallenge[] {
  const w = COURSES[course].worlds.find((x) => x.id === worldId);
  if (!w) return [];
  const list: AnyChallenge[] = [];
  for (const l of w.lessons) for (const s of l.steps) if (s.type === 'practice' || s.type === 'pypractice') list.push(s.challenge);
  return list;
}

export function challengesOfLevel(course: CourseId, level: LevelId): AnyChallenge[] {
  return COURSES[course].worlds.filter((w) => w.level === level).flatMap((w) => challengesOfWorld(course, w.id));
}
