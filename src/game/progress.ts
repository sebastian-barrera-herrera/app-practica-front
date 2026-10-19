/**
 * Estado de progreso del jugador y transiciones puras (testeables).
 * La store de zustand solo envuelve estas funciones y persiste el resultado.
 */
import type { CourseId, WorldDef } from '@/content/types';
import { dayKey, emptyStreak, touchStreak, type Streak } from './streak';
import { review, type SrsItem } from './srs';
import { levelFromXp, lessonXp, starsFor, type XpBreakdown } from './xp';

export interface LessonRecord {
  done: boolean;
  stars: number;
  bestAccuracy: number;
  plays: number;
  completedAt?: number;
}

export interface ChallengeRecord {
  solved: boolean;
  bestCommands: number;
  solvedAt?: number;
}

export interface ExamRecord {
  best: number;
  passed: boolean;
  attempts: number;
  lastAt?: number;
}

export type SoundId = 'campana' | 'gota' | 'zen' | 'pulso' | 'arcade' | 'silencio';
export type ThemePref = 'system' | 'light' | 'dark';

export interface ReminderSettings {
  enabled: boolean;
  /** Horas del recordatorio diario, "HH:MM" (24 h). */
  times: string[];
  /** Días de la semana activos, 0 = domingo … 6 = sábado. */
  days: boolean[];
  sound: SoundId;
  vibrate: boolean;
  /** No avisar si ya cumpliste la meta de hoy. */
  skipIfDone: boolean;
  /** Avisos suaves tras varios días sin entrar. */
  comeback: boolean;
}

export interface Settings {
  name: string;
  /** Meta de XP diaria (secundaria; la meta principal es el tiempo). */
  dailyGoal: number;
  haptics: boolean;
  /** Efectos de sonido dentro de la app. */
  sfx: boolean;
  theme: ThemePref;
  /** Minutos diarios de práctica por curso. */
  goalMinutes: Record<CourseId, number>;
  /** Cursos que cuentan para la meta diaria. */
  courseOn: Record<CourseId, boolean>;
  reminders: ReminderSettings;
  surpriseEnabled: boolean;
  surprisePerWeek: number;
  windowStart: number;
  windowEnd: number;
  surpriseSound: SoundId;
  fontScale: number;
  unlockAll: boolean;
  onboarded: boolean;
  terminalCols: number;
}

export interface Stats {
  questions: number;
  correct: number;
  challenges: number;
  commands: number;
  pipes: number;
  sudo: number;
  sandboxCommands: number;
  blitzBest: number;
  ctrlC: number;
  reviews: number;
  surprises: number;
  libraryViews: number;
  dailySolved: number;
  nightSessions: number;
  earlySessions: number;
  examsPassed: number;
}

/**
 * Estado de juego «plano» de UN curso: lo global (xp, racha, logros, ajustes…) más el progreso del curso.
 * La store guarda un estado raíz con un trozo por curso (`root.ts`) y construye esta vista para operar.
 */
export interface ProgressState {
  xp: number;
  streak: Streak;
  dailyXp: Record<string, number>;
  lessons: Record<string, LessonRecord>;
  challenges: Record<string, ChallengeRecord>;
  exams: Record<string, ExamRecord>;
  srs: Record<string, SrsItem>;
  achievements: Record<string, number>;
  stats: Stats;
  settings: Settings;
  surprise: { lastShown: number; scheduledUntil: number };
  daily: { day: string; done: boolean };
  sandbox: unknown | null;
  seenCommands: Record<string, number>;
}

export const defaultReminders = (): ReminderSettings => ({
  enabled: true,
  times: ['08:00', '19:30'],
  days: [true, true, true, true, true, true, true],
  sound: 'campana',
  vibrate: true,
  skipIfDone: true,
  comeback: true,
});

export const defaultSettings = (): Settings => ({
  name: '',
  dailyGoal: 50,
  haptics: true,
  sfx: true,
  theme: 'system',
  goalMinutes: { linux: 60, python: 60 },
  courseOn: { linux: true, python: true },
  reminders: defaultReminders(),
  surpriseEnabled: true,
  surprisePerWeek: 4,
  windowStart: 10,
  windowEnd: 21,
  surpriseSound: 'arcade',
  fontScale: 1,
  unlockAll: false,
  onboarded: false,
  terminalCols: 44,
});

export const defaultStats = (): Stats => ({
  questions: 0, correct: 0, challenges: 0, commands: 0, pipes: 0, sudo: 0, sandboxCommands: 0, blitzBest: 0,
  ctrlC: 0, reviews: 0, surprises: 0, libraryViews: 0, dailySolved: 0, nightSessions: 0, earlySessions: 0, examsPassed: 0,
});

export const initialState = (): ProgressState => ({
  xp: 0,
  streak: emptyStreak(),
  dailyXp: {},
  lessons: {},
  challenges: {},
  exams: {},
  srs: {},
  achievements: {},
  stats: defaultStats(),
  settings: defaultSettings(),
  surprise: { lastShown: 0, scheduledUntil: 0 },
  daily: { day: '', done: false },
  sandbox: null,
  seenCommands: {},
});

// ───────────────────────── consultas ─────────────────────────

export const lessonDone = (s: ProgressState, id: string) => !!s.lessons[id]?.done;

export function worldProgress(s: ProgressState, w: WorldDef): { done: number; total: number; pct: number } {
  const done = w.lessons.filter((l) => lessonDone(s, l.id)).length;
  return { done, total: w.lessons.length, pct: done / w.lessons.length };
}

export function worldComplete(s: ProgressState, w: WorldDef) {
  return w.lessons.every((l) => lessonDone(s, l.id));
}

export function worldUnlocked(s: ProgressState, worlds: WorldDef[], index: number): boolean {
  if (s.settings.unlockAll || index === 0) return true;
  return worldComplete(s, worlds[index - 1]);
}

/** ¿La lección está disponible? (la primera de cada mundo siempre que el mundo esté abierto) */
export function lessonUnlocked(s: ProgressState, worlds: WorldDef[], worldIndex: number, lessonIndex: number): boolean {
  if (!worldUnlocked(s, worlds, worldIndex)) return false;
  if (s.settings.unlockAll || lessonIndex === 0) return true;
  return lessonDone(s, worlds[worldIndex].lessons[lessonIndex - 1].id);
}

export function nextLesson(s: ProgressState, worlds: WorldDef[]): { world: WorldDef; lessonIndex: number } | null {
  for (const w of worlds) {
    for (let i = 0; i < w.lessons.length; i++) {
      if (!lessonDone(s, w.lessons[i].id)) return { world: w, lessonIndex: i };
    }
  }
  return null;
}

export const todayXp = (s: ProgressState, now: number) => s.dailyXp[dayKey(now)] ?? 0;

// ───────────────────────── transiciones ─────────────────────────

export function addXp(s: ProgressState, amount: number, now: number): { state: ProgressState; levelUp: number | null; streakExtended: boolean } {
  const before = levelFromXp(s.xp);
  const day = dayKey(now);
  const t = touchStreak(s.streak, now);
  const dailyXp = { ...s.dailyXp, [day]: (s.dailyXp[day] ?? 0) + Math.max(0, amount) };
  // conservar solo 90 días
  const keys = Object.keys(dailyXp).sort();
  while (keys.length > 90) delete dailyXp[keys.shift()!];
  const xp = Math.max(0, s.xp + amount);
  const hour = new Date(now).getHours();
  const stats = { ...s.stats };
  if (t.extended) {
    if (hour >= 23 || hour < 4) stats.nightSessions += 1;
    if (hour >= 4 && hour < 7) stats.earlySessions += 1;
  }
  const after = levelFromXp(xp);
  return { state: { ...s, xp, dailyXp, streak: t.streak, stats }, levelUp: after > before ? after : null, streakExtended: t.extended };
}

export interface LessonResult {
  lessonId: string;
  quizTotal: number;
  quizFirstTry: number;
  practices: number;
  hintsUsed: number;
}

export interface LessonOutcome {
  state: ProgressState;
  xp: XpBreakdown;
  stars: number;
  accuracy: number;
  firstTime: boolean;
  levelUp: number | null;
  streak: Streak;
  usedFreeze: boolean;
}

export function finishLesson(s: ProgressState, r: LessonResult, now: number): LessonOutcome {
  const prev = s.lessons[r.lessonId];
  const accuracy = r.quizTotal ? r.quizFirstTry / r.quizTotal : 1;
  const stars = starsFor(accuracy, r.hintsUsed);
  const firstTime = !prev?.done;
  const xp = lessonXp({ quizCorrectFirstTry: r.quizFirstTry, quizTotal: r.quizTotal, practices: r.practices, hintsUsed: r.hintsUsed, stars, firstTime });
  const rec: LessonRecord = {
    done: true,
    stars: Math.max(prev?.stars ?? 0, stars),
    bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, accuracy),
    plays: (prev?.plays ?? 0) + 1,
    completedAt: now,
  };
  let state: ProgressState = { ...s, lessons: { ...s.lessons, [r.lessonId]: rec } };
  const prevStreak = state.streak;
  const added = addXp(state, xp.total, now);
  state = added.state;
  const t = touchStreak(prevStreak, now);
  return { state, xp, stars, accuracy, firstTime, levelUp: added.levelUp, streak: state.streak, usedFreeze: t.usedFreeze };
}

export function answer(s: ProgressState, itemId: string, correct: boolean, now: number, opts: { review?: boolean } = {}): ProgressState {
  const stats = { ...s.stats, questions: s.stats.questions + 1, correct: s.stats.correct + (correct ? 1 : 0), reviews: s.stats.reviews + (opts.review ? 1 : 0) };
  return { ...s, srs: { ...s.srs, [itemId]: review(s.srs[itemId], correct, now) }, stats };
}

export function solveChallenge(s: ProgressState, id: string, commands: number, now: number): ProgressState {
  const prev = s.challenges[id];
  return {
    ...s,
    challenges: { ...s.challenges, [id]: { solved: true, bestCommands: prev ? Math.min(prev.bestCommands, commands) : commands, solvedAt: prev?.solvedAt ?? now } },
    stats: { ...s.stats, challenges: s.stats.challenges + (prev?.solved ? 0 : 1) },
  };
}

export function trackCommands(s: ProgressState, lines: string[], opts: { sandbox: boolean }): ProgressState {
  if (!lines.length) return s;
  let pipes = 0;
  let sudo = 0;
  const seen = { ...s.seenCommands };
  for (const l of lines) {
    if (/\|/.test(l)) pipes++;
    if (/(^|[;&|]\s*)sudo\b/.test(l)) sudo++;
    const first = l.trim().split(/\s+/)[0]?.replace(/^sudo$/, l.trim().split(/\s+/)[1] ?? 'sudo');
    if (first) seen[first] = (seen[first] ?? 0) + 1;
  }
  return {
    ...s,
    seenCommands: seen,
    stats: { ...s.stats, commands: s.stats.commands + lines.length, pipes: s.stats.pipes + pipes, sudo: s.stats.sudo + sudo, sandboxCommands: s.stats.sandboxCommands + (opts.sandbox ? lines.length : 0) },
  };
}

export function recordExam(s: ProgressState, id: string, score: number, passMark: number, now: number): ProgressState {
  const prev = s.exams[id];
  const passed = score >= passMark;
  return {
    ...s,
    exams: { ...s.exams, [id]: { best: Math.max(prev?.best ?? 0, score), passed: passed || !!prev?.passed, attempts: (prev?.attempts ?? 0) + 1, lastAt: now } },
    stats: { ...s.stats, examsPassed: s.stats.examsPassed + (passed && !prev?.passed ? 1 : 0) },
  };
}
