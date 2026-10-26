/** Partes sincronizables del progreso y fusión determinista de dos copias (dispositivo ↔ nube). */
import type { CourseId } from '@/content/types';
import { byCourse, COURSE_KEYS, initialRoot, mergeSettings, migrateRoot, type RootState, type SlicePart } from '@/game/root';
import type { LessonRecord, ChallengeRecord, ExamRecord, ProgressState } from '@/game/progress';
import type { DayAct, Extras } from '@/game/economy';
import type { SrsItem } from '@/game/srs';

export type Scope = 'global' | CourseId;
export type Parts = Partial<Record<Scope, any>>;

/** Divide la raíz en filas por ámbito (el laboratorio no se sincroniza). */
export function splitRoot(root: RootState): Record<Scope, any> {
  const slice = (c: CourseId) => {
    const { sandbox, ...rest } = root.courses[c];
    void sandbox;
    return rest;
  };
  return {
    global: {
      xp: root.xp,
      streak: root.streak,
      dailyXp: root.dailyXp,
      achievements: root.achievements,
      settings: root.settings,
      surprise: root.surprise,
      extras: root.extras,
      study: root.study,
      goalDays: root.goalDays,
      goalBonus: root.goalBonus,
      active: root.active,
    },
    ...(Object.fromEntries(COURSE_KEYS.map((c) => [c, slice(c)])) as Record<CourseId, any>),
  };
}

/** Reconstruye una raíz desde las filas de la nube (lo que falte queda en blanco). */
export function joinRoot(parts: Parts, owner: string | null, updatedAt: number): RootState {
  const raw = { ...(parts.global ?? {}), courses: Object.fromEntries(COURSE_KEYS.map((c) => [c, parts[c] ?? {}])), owner, updatedAt };
  return migrateRoot(raw);
}

const maxBy = <T,>(a: T | undefined, b: T | undefined, score: (x: T) => number): T | undefined => (a === undefined ? b : b === undefined ? a : score(a) >= score(b) ? a : b);

function mergeRecords<T>(a: Record<string, T>, b: Record<string, T>, pick: (x: T, y: T) => T): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}

const lessonScore = (l: LessonRecord) => (l.done ? 1000 : 0) + l.stars * 100 + l.plays;

function mergeSlice(a: SlicePart, b: SlicePart): SlicePart {
  const stats = { ...a.stats } as Record<string, number>;
  for (const [k, v] of Object.entries(b.stats)) stats[k] = Math.max(stats[k] ?? 0, v as number);
  return {
    lessons: mergeRecords<LessonRecord>(a.lessons, b.lessons, (x, y) => (lessonScore(x) >= lessonScore(y) ? { ...x, stars: Math.max(x.stars, y.stars), bestAccuracy: Math.max(x.bestAccuracy, y.bestAccuracy), plays: Math.max(x.plays, y.plays) } : { ...y, stars: Math.max(x.stars, y.stars), bestAccuracy: Math.max(x.bestAccuracy, y.bestAccuracy), plays: Math.max(x.plays, y.plays) })),
    challenges: mergeRecords<ChallengeRecord>(a.challenges, b.challenges, (x, y) => ({ solved: x.solved || y.solved, bestCommands: Math.min(x.bestCommands, y.bestCommands), solvedAt: Math.min(x.solvedAt ?? Infinity, y.solvedAt ?? Infinity) === Infinity ? undefined : Math.min(x.solvedAt ?? Infinity, y.solvedAt ?? Infinity) })),
    exams: mergeRecords<ExamRecord>(a.exams, b.exams, (x, y) => ({ best: Math.max(x.best, y.best), passed: x.passed || y.passed, attempts: Math.max(x.attempts, y.attempts), lastAt: Math.max(x.lastAt ?? 0, y.lastAt ?? 0) || undefined })),
    srs: mergeRecords<SrsItem>(a.srs, b.srs, (x, y) => (x.last >= y.last ? x : y)),
    stats: stats as unknown as ProgressState['stats'],
    daily: a.daily.day >= b.daily.day ? a.daily : b.daily,
    sandbox: a.sandbox ?? b.sandbox ?? null,
    seenCommands: mergeRecords<number>(a.seenCommands, b.seenCommands, (x, y) => Math.max(x, y)),
    skipTo: Math.max(a.skipTo ?? -1, b.skipTo ?? -1),
  };
}

const mergeDayMap = (a: Record<string, number>, b: Record<string, number>) => mergeRecords<number>(a, b, (x, y) => Math.max(x, y));

/** Las monedas, compras y la actividad del día solo crecen: se fusionan por máximo (o por unión). */
function mergeExtrasOf(a: Extras, b: Extras): Extras {
  return {
    coinsEarned: Math.max(a.coinsEarned, b.coinsEarned),
    coinsSpent: Math.max(a.coinsSpent, b.coinsSpent),
    boostUntil: Math.max(a.boostUntil, b.boostUntil),
    bought: mergeDayMap(a.bought, b.bought),
    used: mergeDayMap(a.used, b.used),
    claimed: mergeRecords<string[]>(a.claimed, b.claimed, (x, y) => [...new Set([...x, ...y])]),
    act: mergeRecords<DayAct>(a.act, b.act, (x, y) => ({ q: Math.max(x.q, y.q), ok: Math.max(x.ok, y.ok), ch: Math.max(x.ch, y.ch), rv: Math.max(x.rv, y.rv) })),
    bestCombo: Math.max(a.bestCombo, b.bestCombo),
    // lo que lleva puesto lo decide quien lo cambió el último (mergeRoots lo corrige con la copia más reciente)
    look: a.look,
  };
}
const unionMap = <T,>(a: Record<string, T[]>, b: Record<string, T[]>) => mergeRecords<T[]>(a, b, (x, y) => [...new Set([...x, ...y])]);

/**
 * Fusiona dos copias del progreso sin perder nada: lecciones/retos/exámenes por el mejor resultado, SRS por la
 * repetición más reciente, contadores por máximo, XP por máximo (ambas copias comparten historia), logros por unión.
 * Los ajustes y el curso activo los decide la copia modificada más recientemente.
 */
export function mergeRoots(a: RootState, b: RootState): RootState {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const older = newer === a ? b : a;
  const base = initialRoot();
  const streak = maxBy(a.streak, b.streak, (s) => (s.lastDay ? Date.parse(s.lastDay) : 0) * 1000 + s.current) ?? base.streak;
  const achievements = mergeRecords<number>(a.achievements, b.achievements, (x, y) => Math.min(x, y));
  const out: RootState = {
    ...base,
    xp: Math.max(a.xp, b.xp),
    streak: { ...streak, best: Math.max(a.streak.best, b.streak.best), freezes: Math.max(a.streak.freezes, b.streak.freezes) },
    dailyXp: mergeDayMap(a.dailyXp, b.dailyXp),
    achievements,
    // lo ya configurado no se «des-configura»: una copia recién borrada (ajustes por defecto) no puede quitar
    // el onboarding ni el nombre que ya había en la otra
    settings: mergeSettings({ ...newer.settings, onboarded: newer.settings.onboarded || older.settings.onboarded, name: newer.settings.name || older.settings.name }),
    surprise: { lastShown: Math.max(a.surprise.lastShown, b.surprise.lastShown), scheduledUntil: Math.max(a.surprise.scheduledUntil, b.surprise.scheduledUntil) },
    extras: { ...mergeExtrasOf(a.extras, b.extras), look: newer.extras.look },
    active: newer.active,
    courses: Object.fromEntries(COURSE_KEYS.map((c) => [c, mergeSlice(a.courses[c], b.courses[c])])) as RootState['courses'],
    study: byCourse((c) => mergeDayMap(a.study[c] ?? {}, b.study[c] ?? {})),
    goalDays: unionMap(a.goalDays, b.goalDays),
    goalBonus: unionMap(a.goalBonus, b.goalBonus),
    owner: a.owner ?? b.owner,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
  // el XP no baja nunca: si los logros desbloqueados sumaron XP en una copia, la otra los reconoce al comprobar
  return out;
}

/** Dos raíces con el mismo contenido sincronizable. */
export function sameProgress(a: RootState, b: RootState): boolean {
  return canonical(splitRoot(a)) === canonical(splitRoot(b));
}

/** JSON con las claves ordenadas (para comparar sin depender del orden de inserción). */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) : val,
  );
}
