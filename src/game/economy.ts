/**
 * Economía del juego: monedas 🪙, inventario de la tienda y actividad diaria (para las misiones).
 * Todo es global (no pertenece a un curso) y cada contador solo crece, así que dos dispositivos se fusionan sin perder nada.
 *
 * Saldo = monedas ganadas + recompensas de nivel (derivadas del XP, no se guardan) − monedas gastadas.
 */
import { levelFromXp } from './xp';

/** Actividad de un día: preguntas respondidas, acertadas, retos resueltos y preguntas de repaso. */
export interface DayAct {
  q: number;
  ok: number;
  ch: number;
  rv: number;
}

export interface Extras {
  coinsEarned: number;
  coinsSpent: number;
  /** XP doble hasta este instante (ms). */
  boostUntil: number;
  /** Compras y usos por objeto de la tienda (el que tienes = comprados − usados). */
  bought: Record<string, number>;
  used: Record<string, number>;
  /** Ids de misiones reclamadas por día. */
  claimed: Record<string, string[]>;
  act: Record<string, DayAct>;
  /** Mejor combo (aciertos seguidos a la primera) alcanzado. */
  bestCombo: number;
}

export const initialExtras = (): Extras => ({ coinsEarned: 0, coinsSpent: 0, boostUntil: 0, bought: {}, used: {}, claimed: {}, act: {}, bestCombo: 0 });

/** Completa un `extras` leído de disco o de la nube con lo que falte. */
export function mergeExtras(p: Partial<Extras> | undefined): Extras {
  const b = initialExtras();
  const x = p ?? {};
  const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : d);
  return {
    coinsEarned: num(x.coinsEarned),
    coinsSpent: num(x.coinsSpent),
    boostUntil: num(x.boostUntil),
    bought: { ...b.bought, ...(x.bought ?? {}) },
    used: { ...b.used, ...(x.used ?? {}) },
    claimed: { ...b.claimed, ...(x.claimed ?? {}) },
    act: { ...b.act, ...(x.act ?? {}) },
    bestCombo: num(x.bestCombo),
  };
}

// ───────────────────────── niveles ─────────────────────────

/** Monedas que se ganan al llegar a un nivel (el nivel 1 no da nada). */
export const levelReward = (level: number): number => (level <= 1 ? 0 : 10 + 2 * level);

/** Total de recompensas de nivel acumuladas hasta `level`. */
export function levelCoins(level: number): number {
  let n = 0;
  for (let l = 2; l <= level; l++) n += levelReward(l);
  return n;
}

// ───────────────────────── monedas ─────────────────────────

/** Cuánto se gana por cada cosa (una sola tabla para que la tienda y los textos no se desincronicen). */
export const COINS = {
  lessonFirst: (stars: number) => 2 + 3 * stars,
  lessonRepeat: 1,
  challenge: 10,
  review: (correct: number) => Math.min(10, correct),
  examPass: 30,
  skipPass: 40,
  certPass: 100,
  goal: 10,
  achievement: (xp: number) => Math.max(1, Math.round(xp / 4)),
  missionsBonus: 30,
};

export const balance = (xp: number, ex: Extras): number => ex.coinsEarned + levelCoins(levelFromXp(xp)) - ex.coinsSpent;

export const addCoins = (ex: Extras, n: number): Extras => (n > 0 ? { ...ex, coinsEarned: ex.coinsEarned + Math.round(n) } : ex);

export const owned = (ex: Extras, id: string): number => Math.max(0, (ex.bought[id] ?? 0) - (ex.used[id] ?? 0));

export const boostActive = (ex: Extras, now: number): boolean => now < ex.boostUntil;

// ───────────────────────── actividad diaria ─────────────────────────

const ACT_DAYS = 21;

export function bumpAct(ex: Extras, day: string, patch: Partial<DayAct>): Extras {
  const cur = ex.act[day] ?? { q: 0, ok: 0, ch: 0, rv: 0 };
  const next: DayAct = { q: cur.q + (patch.q ?? 0), ok: cur.ok + (patch.ok ?? 0), ch: cur.ch + (patch.ch ?? 0), rv: cur.rv + (patch.rv ?? 0) };
  const act = { ...ex.act, [day]: next };
  const keys = Object.keys(act).sort();
  while (keys.length > ACT_DAYS) delete act[keys.shift()!];
  return { ...ex, act };
}
