/** Construcción de sesiones de práctica de UN curso: repaso, sorpresa, prueba rápida, reto diario. */
import { allChallenges, type CourseDef } from '@/content';
import { FAST_TYPES, allQuestions, pickVaried, questionById, type QItem } from '@/content/pool';
import type { AnyChallenge } from '@/content/types';
import { seededShuffle } from '@/lib/cmdnorm';
import type { ProgressState } from './progress';
import { dueItems } from './srs';
import { dayKey } from './streak';

/** Preguntas de lecciones ya completadas (o de la primera lección si no hay ninguna). */
export function learnedQuestions(s: ProgressState, course: CourseDef): QItem[] {
  const done = new Set(Object.entries(s.lessons).filter(([, l]) => l.done).map(([id]) => id));
  const all = allQuestions(course.id);
  const learned = all.filter((q) => done.has(q.lessonId));
  if (learned.length) return learned;
  const first = course.worlds[0]?.id;
  return all.filter((q) => q.worldId === first).slice(0, 12);
}

export function reviewSession(s: ProgressState, now: number, course: CourseDef, max = 10): { items: QItem[]; due: number; fresh: boolean } {
  const ids = dueItems(s.srs, now);
  const items = ids.map((id) => questionById(id)).filter((x): x is QItem => !!x && x.course === course.id);
  if (items.length >= 3) return { items: items.slice(0, max), due: items.length, fresh: false };
  // nada vencido: repaso libre de lo aprendido, priorizando lo más flojo
  const learned = learnedQuestions(s, course);
  const weak = [...learned].sort((a, b) => (s.srs[a.id]?.box ?? -1) - (s.srs[b.id]?.box ?? -1));
  const merged = [...items, ...weak.filter((w) => !items.includes(w))].slice(0, max);
  return { items: merged, due: items.length, fresh: true };
}

export function surpriseSession(s: ProgressState, now: number, course: CourseDef): QItem[] {
  const pool = learnedQuestions(s, course).filter((q) => FAST_TYPES.has(q.q.t));
  return pickVaried(pool, 5, 'surprise-' + now);
}

export function blitzPool(s: ProgressState, scope: string, course: CourseDef): QItem[] {
  let pool: QItem[];
  if (scope === 'all') pool = allQuestions(course.id);
  else if (scope === 'learned') pool = learnedQuestions(s, course);
  else pool = allQuestions(course.id).filter((q) => q.worldId === scope);
  pool = pool.filter((q) => FAST_TYPES.has(q.q.t));
  return seededShuffle(pool, 'blitz-' + Date.now());
}

export function dailyChallenge(s: ProgressState, now: number, course: CourseDef): { challenge: AnyChallenge; worldId: string } | null {
  const all = allChallenges(course.id);
  const done = new Set(Object.entries(s.lessons).filter(([, l]) => l.done).map(([id]) => id));
  let pool = all.filter((c) => c.lessonId && done.has(c.lessonId));
  if (!pool.length) pool = all.filter((c) => c.worldId === course.worlds[0]?.id && c.lessonId);
  if (!pool.length) return null;
  const pick = seededShuffle(pool, dayKey(now) + course.id)[0];
  return { challenge: pick.challenge, worldId: pick.worldId };
}

/** ¿Toca ofrecer un examen sorpresa dentro de la app? */
export function shouldOfferSurprise(s: ProgressState, now: number): boolean {
  if (!s.settings.surpriseEnabled) return false;
  const learnedAny = Object.values(s.lessons).some((l) => l.done);
  if (!learnedAny) return false;
  const hours = (now - s.surprise.lastShown) / 3600000;
  if (hours < 20) return false;
  const h = new Date(now).getHours();
  return h >= s.settings.windowStart && h < s.settings.windowEnd;
}
