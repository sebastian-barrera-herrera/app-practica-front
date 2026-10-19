/**
 * Estado RAÍZ de la app: lo global (XP, racha, logros, ajustes) + un trozo de progreso por curso + tiempo de estudio.
 * Las transiciones del juego (progress.ts) operan sobre la vista «plana» de un curso (`flat`); aquí se montan y desmontan.
 */
import type { CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import { allAchievements, LEGACY_ACHIEVEMENT_IDS, type Achievement } from './achievements';
import { defaultSettings, defaultStats, addXp, initialState, type ProgressState, type Settings } from './progress';
import { dayKey, emptyStreak } from './streak';

export const COURSE_KEYS: CourseId[] = ['linux', 'python'];

type GlobalKeys = 'xp' | 'streak' | 'dailyXp' | 'achievements' | 'settings' | 'surprise';
const GLOBAL_KEYS: GlobalKeys[] = ['xp', 'streak', 'dailyXp', 'achievements', 'settings', 'surprise'];

export type GlobalPart = Pick<ProgressState, GlobalKeys>;
export type SlicePart = Omit<ProgressState, GlobalKeys>;

export interface RootState extends GlobalPart {
  /** Curso en pantalla (Ruta, Practicar, Laboratorio). */
  active: CourseId;
  courses: Record<CourseId, SlicePart>;
  /** Segundos de práctica activa por curso y día («YYYY-MM-DD»). */
  study: Record<CourseId, Record<string, number>>;
  /** Cursos que cumplieron su meta diaria, por día. */
  goalDays: Record<string, CourseId[]>;
  /** Días con bono de XP ya entregado, por curso. */
  goalBonus: Record<string, CourseId[]>;
  /** Id de la cuenta a la que pertenece este progreso (null = aún sin cuenta). */
  owner: string | null;
  /** Última modificación local (ms) — para sincronizar. */
  updatedAt: number;
}

export const ROOT_VERSION = 2;

export function emptySlice(): SlicePart {
  const { xp, streak, dailyXp, achievements, settings, surprise, ...slice } = initialState();
  void xp; void streak; void dailyXp; void achievements; void settings; void surprise;
  return slice;
}

export function initialRoot(): RootState {
  const base = initialState();
  const courses = Object.fromEntries(COURSE_KEYS.map((c) => [c, emptySlice()])) as Record<CourseId, SlicePart>;
  return {
    xp: base.xp,
    streak: base.streak,
    dailyXp: base.dailyXp,
    achievements: base.achievements,
    settings: base.settings,
    surprise: base.surprise,
    active: 'linux',
    courses,
    study: { linux: {}, python: {} },
    goalDays: {},
    goalBonus: {},
    owner: null,
    updatedAt: 0,
  };
}

// ───────────────────────── vista plana ─────────────────────────

export function flat(root: RootState, course: CourseId): ProgressState {
  return {
    xp: root.xp,
    streak: root.streak,
    dailyXp: root.dailyXp,
    achievements: root.achievements,
    settings: root.settings,
    surprise: root.surprise,
    ...root.courses[course],
  };
}

export function unflat(root: RootState, course: CourseId, s: ProgressState): RootState {
  const slice = { ...s } as Partial<ProgressState>;
  for (const k of GLOBAL_KEYS) delete slice[k];
  return {
    ...root,
    xp: s.xp,
    streak: s.streak,
    dailyXp: s.dailyXp,
    achievements: s.achievements,
    settings: s.settings,
    surprise: s.surprise,
    courses: { ...root.courses, [course]: slice as SlicePart },
  };
}

/** Aplica una transición «plana» sobre un curso y devuelve el nuevo estado raíz. */
export function withCourse<R extends { state: ProgressState }>(root: RootState, course: CourseId, fn: (s: ProgressState) => R): { root: RootState; result: R } {
  const result = fn(flat(root, course));
  return { root: unflat(root, course, result.state), result };
}

// ───────────────────────── logros ─────────────────────────

export function unlockAchievements(root: RootState, now: number, courses: CourseDef[]): { root: RootState; unlocked: Achievement[] } {
  const list = allAchievements(courses);
  const unlocked: Achievement[] = [];
  let state = root;
  // las recompensas de XP pueden desbloquear otros logros: repetir hasta estabilizar
  for (let round = 0; round < 4; round++) {
    const ach = { ...state.achievements };
    const batch: Achievement[] = [];
    for (const a of list) {
      if (ach[a.id]) continue;
      const s = flat(state, a.course ?? state.active);
      if (a.check(s, state)) {
        ach[a.id] = now;
        batch.push(a);
      }
    }
    if (!batch.length) break;
    unlocked.push(...batch);
    state = { ...state, achievements: ach, xp: state.xp + batch.reduce((n, a) => n + a.xp, 0) };
  }
  return { root: state, unlocked };
}

// ───────────────────────── tiempo de estudio y metas ─────────────────────────

export const GOAL_BONUS_XP = 40;

export const goalSeconds = (root: RootState, course: CourseId) => Math.max(1, root.settings.goalMinutes[course] ?? 60) * 60;
export const studySeconds = (root: RootState, course: CourseId, day: string) => root.study[course]?.[day] ?? 0;
export const goalMet = (root: RootState, course: CourseId, day: string) => studySeconds(root, course, day) >= goalSeconds(root, course);
export const enabledCourses = (root: RootState): CourseId[] => COURSE_KEYS.filter((c) => root.settings.courseOn[c]);

/** ¿Se cumplieron las metas de todos los cursos activos en ese día? */
export function dayComplete(root: RootState, day: string): boolean {
  const on = enabledCourses(root);
  if (!on.length) return false;
  const got = root.goalDays[day] ?? [];
  return on.every((c) => got.includes(c));
}

/** Racha de días seguidos con TODAS las metas cumplidas (hoy cuenta solo si ya está completo). */
export function goalStreak(root: RootState, now: number): { current: number; best: number; todayDone: boolean } {
  const today = dayKey(now);
  const todayDone = dayComplete(root, today);
  const days = Object.keys(root.goalDays).filter((d) => dayComplete(root, d)).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    if (prev && dayDiff(prev, d) === 1) run++;
    else run = 1;
    best = Math.max(best, run);
    prev = d;
  }
  // racha actual: hacia atrás desde hoy (si hoy no está completo, desde ayer)
  let current = 0;
  let cursor = todayDone ? today : addDays(today, -1);
  while (dayComplete(root, cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best: Math.max(best, current), todayDone };
}

function dayDiff(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(Date.UTC(y, m - 1, d + n, 12));
}

export interface StudyResult {
  root: RootState;
  /** Este curso acaba de cumplir su meta de hoy. */
  reached: boolean;
  /** Con esto, todas las metas de hoy están cumplidas. */
  dayDone: boolean;
  bonusXp: number;
  levelUp: number | null;
}

/** Suma segundos de práctica activa a un curso. Al cruzar la meta: bono de XP y marca el día. */
export function addStudySeconds(root: RootState, course: CourseId, seconds: number, now: number): StudyResult {
  if (seconds <= 0) return { root, reached: false, dayDone: false, bonusXp: 0, levelUp: null };
  const day = dayKey(now);
  const before = studySeconds(root, course, day);
  const perDay = { ...(root.study[course] ?? {}), [day]: before + seconds };
  // conservar ~120 días
  const keys = Object.keys(perDay).sort();
  while (keys.length > 120) delete perDay[keys.shift()!];
  let next: RootState = { ...root, study: { ...root.study, [course]: perDay } };
  const crossed = before < goalSeconds(root, course) && before + seconds >= goalSeconds(root, course);
  let bonusXp = 0;
  let levelUp: number | null = null;
  if (crossed || (goalMet(next, course, day) && !(next.goalDays[day] ?? []).includes(course))) {
    next = { ...next, goalDays: { ...next.goalDays, [day]: [...(next.goalDays[day] ?? []).filter((c) => c !== course), course] } };
    if (!(next.goalBonus[day] ?? []).includes(course)) {
      next = { ...next, goalBonus: { ...next.goalBonus, [day]: [...(next.goalBonus[day] ?? []), course] } };
      const r = addXp(flat(next, course), GOAL_BONUS_XP, now);
      next = unflat(next, course, r.state);
      bonusXp = GOAL_BONUS_XP;
      levelUp = r.levelUp;
    }
    // limitar el histórico de metas
    const gk = Object.keys(next.goalDays).sort();
    if (gk.length > 400) {
      const goalDays = { ...next.goalDays };
      const goalBonus = { ...next.goalBonus };
      while (gk.length > 400) {
        const k = gk.shift()!;
        delete goalDays[k];
        delete goalBonus[k];
      }
      next = { ...next, goalDays, goalBonus };
    }
  }
  const reached = bonusXp > 0 || crossed;
  return { root: next, reached, dayDone: reached && dayComplete(next, day), bonusXp, levelUp };
}

// ───────────────────────── migración y fusión ─────────────────────────

export function mergeSettings(p: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  const s = p ?? {};
  return {
    ...base,
    ...s,
    goalMinutes: { ...base.goalMinutes, ...(s.goalMinutes ?? {}) },
    courseOn: { ...base.courseOn, ...(s.courseOn ?? {}) },
    reminders: { ...base.reminders, ...(s.reminders ?? {}), days: s.reminders?.days?.length === 7 ? s.reminders.days : base.reminders.days },
  };
}

function mergeSlice(p: Partial<SlicePart> | undefined): SlicePart {
  const base = emptySlice();
  return { ...base, ...(p ?? {}), stats: { ...defaultStats(), ...(p?.stats ?? {}) } };
}

/** Normaliza cualquier estado persistido (v1 de un solo curso o v2) a un RootState válido. */
export function migrateRoot(persisted: unknown): RootState {
  const base = initialRoot();
  const p = (persisted ?? {}) as Record<string, any>;
  if (!p || typeof p !== 'object') return base;
  const out: RootState = {
    ...base,
    xp: typeof p.xp === 'number' ? p.xp : 0,
    streak: { ...emptyStreak(), ...(p.streak ?? {}) },
    dailyXp: p.dailyXp ?? {},
    achievements: p.achievements ?? {},
    settings: mergeSettings(p.settings),
    surprise: { ...base.surprise, ...(p.surprise ?? {}) },
    active: p.active === 'python' ? 'python' : 'linux',
    goalDays: p.goalDays ?? {},
    goalBonus: p.goalBonus ?? {},
    study: { linux: p.study?.linux ?? {}, python: p.study?.python ?? {} },
    owner: typeof p.owner === 'string' ? p.owner : null,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    courses: base.courses,
  };
  if (p.courses && typeof p.courses === 'object') {
    out.courses = { linux: mergeSlice(p.courses.linux), python: mergeSlice(p.courses.python) };
  } else if (p.lessons) {
    // v1: todo el progreso era de Linux
    const { xp, streak, dailyXp, achievements, settings, surprise, ...slice } = p;
    void xp; void streak; void dailyXp; void achievements; void settings; void surprise;
    out.courses = { linux: mergeSlice(slice as Partial<SlicePart>), python: emptySlice() };
    const ach: Record<string, number> = {};
    for (const [id, t] of Object.entries(out.achievements)) {
      const renamed = LEGACY_ACHIEVEMENT_IDS[id] ?? (id.startsWith('world-') ? `linux:${id}` : id);
      ach[renamed] = t as number;
    }
    out.achievements = ach;
  }
  return out;
}

/** ¿Hay algo de progreso real? (para decidir si preguntar al sincronizar). */
export function hasProgress(root: RootState): boolean {
  return root.xp > 0 || COURSE_KEYS.some((c) => Object.keys(root.courses[c].lessons).length > 0 || Object.keys(root.study[c]).length > 0);
}
