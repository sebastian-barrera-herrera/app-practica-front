/**
 * Niveles y XP. XP acumulado necesario para llegar al nivel n: 50·n·(n-1).
 * El nivel es GLOBAL: suma el XP de todos los cursos (no confundir con las etapas de cada curso: Básico, Intermedio y Avanzado).
 */

export interface LevelRank {
  title: string;
  /** Insignia que acompaña al título. */
  emoji: string;
}

/** Un rango por nivel hasta el 12; del 13 en adelante se sigue siendo «Leyenda». */
export const LEVEL_RANKS: LevelRank[] = [
  { title: 'Novato', emoji: '🌱' },
  { title: 'Aprendiz', emoji: '📘' },
  { title: 'Explorador', emoji: '🧭' },
  { title: 'Practicante', emoji: '⌨️' },
  { title: 'Junior', emoji: '🛠️' },
  { title: 'Desarrollador', emoji: '💻' },
  { title: 'Ingeniero', emoji: '⚙️' },
  { title: 'Arquitecto', emoji: '🏛️' },
  { title: 'Hacker', emoji: '🥷' },
  { title: 'Maestro', emoji: '🥋' },
  { title: 'Gran Maestro', emoji: '🏯' },
  { title: 'Leyenda', emoji: '👑' },
];

export const xpForLevel = (n: number) => 50 * n * (n - 1);

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 50)) / 2));
}

export const levelRank = (level: number): LevelRank => LEVEL_RANKS[Math.min(LEVEL_RANKS.length, Math.max(1, level)) - 1];

export function levelTitle(level: number): string {
  return levelRank(level).title;
}

export interface LevelProgress {
  level: number;
  title: string;
  emoji: string;
  into: number;
  need: number;
  pct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const rank = levelRank(level);
  return { level, title: rank.title, emoji: rank.emoji, into: xp - base, need: next - base, pct: (xp - base) / (next - base) };
}

export interface XpBreakdown {
  total: number;
  parts: { label: string; xp: number }[];
}

/** XP extra por acertar varias seguidas a la primera dentro de una lección o un repaso (el combo). */
export function comboXp(combo: number): number {
  return combo >= 12 ? 15 : combo >= 8 ? 10 : combo >= 5 ? 5 : 0;
}

/** XP al terminar una lección. */
export function lessonXp(o: { quizCorrectFirstTry: number; quizTotal: number; practices: number; hintsUsed: number; stars: number; firstTime: boolean; combo?: number }): XpBreakdown {
  const parts: { label: string; xp: number }[] = [];
  parts.push({ label: 'Preguntas acertadas', xp: o.quizCorrectFirstTry * 5 });
  parts.push({ label: 'Retos prácticos', xp: o.practices * 15 });
  if (o.stars === 3) parts.push({ label: 'Lección perfecta ⭐⭐⭐', xp: 20 });
  else if (o.stars === 2) parts.push({ label: 'Muy bien ⭐⭐', xp: 10 });
  else parts.push({ label: 'Lección completada', xp: 5 });
  const bonus = comboXp(o.combo ?? 0);
  if (bonus > 0) parts.push({ label: `🔥 Combo ×${o.combo}`, xp: bonus });
  if (o.hintsUsed > 0) parts.push({ label: `Pistas usadas (${o.hintsUsed})`, xp: -Math.min(10, o.hintsUsed * 2) });
  let total = parts.reduce((s, p) => s + p.xp, 0);
  if (!o.firstTime) {
    // repetir una lección da menos XP
    total = Math.round(total * 0.4);
    return { total: Math.max(2, total), parts: [{ label: 'Repaso de lección', xp: Math.max(2, total) }] };
  }
  return { total: Math.max(5, total), parts };
}

export function starsFor(accuracy: number, hintsUsed: number): 1 | 2 | 3 {
  if (accuracy >= 0.9 && hintsUsed === 0) return 3;
  if (accuracy >= 0.7) return 2;
  return 1;
}
