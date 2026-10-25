/**
 * Misiones diarias: tres por día (una fácil, una media y una difícil), siempre las mismas para el mismo día.
 * El progreso se calcula a partir de lo que ya guarda el juego (lecciones, estudio, XP y la actividad del día).
 */
import { COINS, addCoins } from './economy';
import type { RootState } from './root';
import { dayKey } from './streak';

export type MissionKind = 'lessons' | 'correct' | 'challenges' | 'reviews' | 'minutes' | 'xp';

export interface Mission {
  id: string;
  kind: MissionKind;
  target: number;
  tier: 1 | 2 | 3;
  emoji: string;
  title: string;
  coins: number;
}

const m = (kind: MissionKind, target: number, tier: 1 | 2 | 3, emoji: string, title: string): Omit<Mission, 'id' | 'coins'> => ({ kind, target, tier, emoji, title });

const POOL: Omit<Mission, 'id' | 'coins'>[] = [
  m('lessons', 1, 1, '📘', 'Completa 1 lección'),
  m('correct', 6, 1, '🎯', 'Acierta 6 preguntas'),
  m('minutes', 10, 1, '⏱️', 'Practica 10 minutos'),
  m('reviews', 5, 1, '🔁', 'Responde 5 preguntas de repaso'),
  m('lessons', 2, 2, '📚', 'Completa 2 lecciones'),
  m('correct', 12, 2, '🎯', 'Acierta 12 preguntas'),
  m('challenges', 2, 2, '🧩', 'Resuelve 2 retos prácticos'),
  m('minutes', 20, 2, '⏱️', 'Practica 20 minutos'),
  m('xp', 60, 2, '💎', 'Gana 60 XP'),
  m('lessons', 3, 3, '🏃', 'Completa 3 lecciones'),
  m('correct', 20, 3, '🔥', 'Acierta 20 preguntas'),
  m('challenges', 4, 3, '🥋', 'Resuelve 4 retos prácticos'),
  m('minutes', 35, 3, '⏳', 'Practica 35 minutos'),
  m('xp', 120, 3, '💎', 'Gana 120 XP'),
];

const REWARD: Record<1 | 2 | 3, number> = { 1: 10, 2: 15, 3: 25 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Las tres misiones de un día. */
export function missionsFor(day: string): Mission[] {
  const out: Mission[] = [];
  const used = new Set<MissionKind>();
  ([1, 2, 3] as const).forEach((tier) => {
    const options = POOL.filter((p) => p.tier === tier && !used.has(p.kind));
    const pick = options[hash(`${day}/${tier}`) % options.length];
    used.add(pick.kind);
    out.push({ ...pick, id: `${day}:${pick.kind}${pick.target}`, coins: REWARD[tier] });
  });
  return out;
}

export function missionProgress(root: RootState, mi: Mission, day: string): number {
  switch (mi.kind) {
    case 'lessons':
      return Object.values(root.courses).reduce((n, c) => n + Object.values(c.lessons).filter((l) => l.done && l.completedAt != null && dayKey(l.completedAt) === day).length, 0);
    case 'correct':
      return root.extras.act[day]?.ok ?? 0;
    case 'challenges':
      return root.extras.act[day]?.ch ?? 0;
    case 'reviews':
      return root.extras.act[day]?.rv ?? 0;
    case 'minutes':
      return Math.floor(Object.values(root.study).reduce((n, byDay) => n + (byDay[day] ?? 0), 0) / 60);
    case 'xp':
      return root.dailyXp[day] ?? 0;
  }
}

export const BONUS_ID = 'bonus';

export interface MissionState {
  mission: Mission;
  progress: number;
  done: boolean;
  claimed: boolean;
}

export function missionStates(root: RootState, day: string): { list: MissionState[]; bonusClaimed: boolean; allClaimed: boolean } {
  const claimed = root.extras.claimed[day] ?? [];
  const list = missionsFor(day).map((mission) => {
    const progress = Math.min(mission.target, missionProgress(root, mission, day));
    return { mission, progress, done: progress >= mission.target, claimed: claimed.includes(mission.id) };
  });
  return { list, bonusClaimed: claimed.includes(BONUS_ID), allClaimed: list.every((x) => x.claimed) };
}

/** Reclama una misión terminada (y el bono del día al reclamar las tres). Devuelve las monedas ganadas. */
export function claimMission(root: RootState, id: string, day: string): { root: RootState; coins: number } {
  const st = missionStates(root, day);
  const target = st.list.find((x) => x.mission.id === id);
  if (!target || !target.done || target.claimed) return { root, coins: 0 };
  let coins = target.mission.coins;
  let claimedIds = [...(root.extras.claimed[day] ?? []), id];
  const all = st.list.every((x) => x.claimed || x.mission.id === id);
  if (all && !st.bonusClaimed) {
    coins += COINS.missionsBonus;
    claimedIds = [...claimedIds, BONUS_ID];
  }
  const claimed = { ...root.extras.claimed, [day]: claimedIds };
  // se guardan 14 días
  const keys = Object.keys(claimed).sort();
  while (keys.length > 14) delete claimed[keys.shift()!];
  return { root: { ...root, extras: addCoins({ ...root.extras, claimed }, coins) }, coins };
}
