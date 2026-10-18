/** Construcción de sesiones de práctica: repaso, sorpresa, prueba rápida, reto diario. */
import { WORLDS, allChallenges } from '@/content';
import { FAST_TYPES, allQuestions, pickVaried, questionById, type QItem } from '@/content/pool';
import type { Challenge } from '@/content/types';
import { seededShuffle } from '@/lib/cmdnorm';
import type { ProgressState } from './progress';
import { dueItems } from './srs';
import { dayKey } from './streak';

/** Preguntas de lecciones ya completadas (o de la primera lección si no hay ninguna). */
export function learnedQuestions(s: ProgressState): QItem[] {
  const done = new Set(Object.entries(s.lessons).filter(([, l]) => l.done).map(([id]) => id));
  const learned = allQuestions().filter((q) => done.has(q.lessonId));
  if (learned.length) return learned;
  return allQuestions().filter((q) => q.worldId === WORLDS[0].id).slice(0, 12);
}

export function reviewSession(s: ProgressState, now: number, max = 10): { items: QItem[]; due: number; fresh: boolean } {
  const ids = dueItems(s.srs, now);
  const items = ids.map((id) => questionById(id)).filter((x): x is QItem => !!x);
  if (items.length >= 3) return { items: items.slice(0, max), due: items.length, fresh: false };
  // nada vencido: repaso libre de lo aprendido, priorizando lo más flojo
  const learned = learnedQuestions(s);
  const weak = [...learned].sort((a, b) => (s.srs[a.id]?.box ?? -1) - (s.srs[b.id]?.box ?? -1));
  const merged = [...items, ...weak.filter((w) => !items.includes(w))].slice(0, max);
  return { items: merged, due: items.length, fresh: true };
}

export function surpriseSession(s: ProgressState, now: number): QItem[] {
  const pool = learnedQuestions(s).filter((q) => FAST_TYPES.has(q.q.t));
  return pickVaried(pool, 5, 'surprise-' + now);
}

export function blitzPool(s: ProgressState, scope: string): QItem[] {
  let pool: QItem[];
  if (scope === 'all') pool = allQuestions();
  else if (scope === 'learned') pool = learnedQuestions(s);
  else pool = allQuestions().filter((q) => q.worldId === scope);
  pool = pool.filter((q) => FAST_TYPES.has(q.q.t));
  return seededShuffle(pool, 'blitz-' + Date.now());
}

export function dailyChallenge(s: ProgressState, now: number): { challenge: Challenge; worldId: string } {
  const all = allChallenges();
  const done = new Set(Object.entries(s.lessons).filter(([, l]) => l.done).map(([id]) => id));
  let pool = all.filter((c) => c.lessonId && done.has(c.lessonId));
  if (!pool.length) pool = all.filter((c) => c.worldId === WORLDS[0].id && c.lessonId);
  const pick = seededShuffle(pool, dayKey(now))[0];
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
