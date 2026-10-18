/** Racha diaria con "escudos" que salvan un día perdido. */

export interface Streak {
  current: number;
  best: number;
  lastDay: string | null;
  freezes: number;
}

export const emptyStreak = (): Streak => ({ current: 0, best: 0, lastDay: null, freezes: 1 });

export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** Registra actividad hoy. Devuelve la nueva racha y si se usó un escudo. */
export function touchStreak(s: Streak, now: number): { streak: Streak; extended: boolean; usedFreeze: boolean } {
  const today = dayKey(now);
  if (s.lastDay === today) return { streak: s, extended: false, usedFreeze: false };
  let current = s.current;
  let freezes = s.freezes;
  let usedFreeze = false;
  if (s.lastDay === null) current = 1;
  else {
    const gap = daysBetween(s.lastDay, today);
    if (gap === 1) current += 1;
    else if (gap === 2 && freezes > 0) {
      freezes -= 1;
      current += 1;
      usedFreeze = true;
    } else current = 1;
  }
  // un escudo nuevo cada 7 días de racha (máx. 3)
  if (current > 0 && current % 7 === 0 && freezes < 3) freezes += 1;
  return { streak: { current, best: Math.max(s.best, current), lastDay: today, freezes }, extended: true, usedFreeze };
}

/** ¿La racha sigue viva hoy (para mostrarla apagada o encendida)? */
export function streakAlive(s: Streak, now: number): boolean {
  if (!s.lastDay) return false;
  const gap = daysBetween(s.lastDay, dayKey(now));
  return gap <= 1 || (gap === 2 && s.freezes > 0);
}
