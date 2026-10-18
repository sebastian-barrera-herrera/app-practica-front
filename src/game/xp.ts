/** Niveles y XP. XP acumulado necesario para llegar al nivel n: 50·n·(n-1). */

export const LEVEL_TITLES = [
  'Novato', 'Aprendiz', 'Explorador', 'Operador', 'Sysadmin Jr', 'Sysadmin', 'Ingeniero',
  'Arquitecto', 'Hacker', 'Maestro', 'Gran Maestro', 'Leyenda',
];

export const xpForLevel = (n: number) => 50 * n * (n - 1);

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 50)) / 2));
}

export function levelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((level - 1) / 1.2))] ?? LEVEL_TITLES[0];
}

export interface LevelProgress {
  level: number;
  title: string;
  into: number;
  need: number;
  pct: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, title: levelTitle(level), into: xp - base, need: next - base, pct: (xp - base) / (next - base) };
}

export interface XpBreakdown {
  total: number;
  parts: { label: string; xp: number }[];
}

/** XP al terminar una lección. */
export function lessonXp(o: { quizCorrectFirstTry: number; quizTotal: number; practices: number; hintsUsed: number; stars: number; firstTime: boolean }): XpBreakdown {
  const parts: { label: string; xp: number }[] = [];
  parts.push({ label: 'Preguntas acertadas', xp: o.quizCorrectFirstTry * 5 });
  parts.push({ label: 'Retos de terminal', xp: o.practices * 15 });
  if (o.stars === 3) parts.push({ label: 'Lección perfecta ⭐⭐⭐', xp: 20 });
  else if (o.stars === 2) parts.push({ label: 'Muy bien ⭐⭐', xp: 10 });
  else parts.push({ label: 'Lección completada', xp: 5 });
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
