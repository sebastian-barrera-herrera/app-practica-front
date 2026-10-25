/** Store global (zustand) con persistencia en AsyncStorage. Guarda el estado raíz (global + un trozo por curso). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { COURSE_LIST, courseDef, type CourseDef } from '@/content';
import type { CourseId } from '@/content/types';
import type { Achievement } from './achievements';
import {
  addXp, answer as answerFn, finishLesson as finishLessonFn, recordExam as recordExamFn,
  solveChallenge as solveChallengeFn, trackCommands as trackCommandsFn,
  type LessonOutcome, type LessonResult, type ProgressState, type Settings,
} from './progress';
import { addCoins } from './economy';
import { claimMission as claimMissionFn } from './missions';
import { useResume } from './resume';
import { buy as buyFn, consumePass as consumePassFn, type ShopId } from './shop';
import { dayKey } from './streak';
import {
  addStudySeconds, flat, initialRoot, mergeSettings, migrateRoot, ROOT_VERSION, setCourseOn as setCourseOnFn, unflat, unlockAchievements, withCourse,
  type RootState, type StudyResult,
} from './root';

export type FinishOutcome = LessonOutcome & { newAchievements: Achievement[] };
export type StudyOutcome = StudyResult & { newAchievements: Achievement[] };

export interface Actions {
  setActive: (course: CourseId) => void;
  finishLesson: (course: CourseId, r: LessonResult) => FinishOutcome;
  answer: (course: CourseId, itemId: string, correct: boolean, opts?: { review?: boolean }) => void;
  solveChallenge: (course: CourseId, id: string, commands: number) => void;
  trackCommands: (course: CourseId, lines: string[], sandbox: boolean) => void;
  awardXp: (course: CourseId, n: number) => { levelUp: number | null };
  recordExam: (course: CourseId, id: string, score: number, passMark: number, bonusXp: number) => { passed: boolean; newAchievements: Achievement[]; levelUp: number | null };
  setSettings: (patch: Partial<Settings>) => void;
  /** Añade o quita un curso de «Mis cursos»; devuelve false si no se pudo (siempre debe quedar uno). */
  setCourseOn: (course: CourseId, on: boolean) => boolean;
  /** Abre una zona (y las anteriores) tras aprobar su examen de salto. */
  unlockZone: (course: CourseId, worldIndex: number) => void;
  /** Suma monedas 🪙 (repasos, etc.). */
  giveCoins: (n: number) => void;
  /** Anota el mejor combo de aciertos. */
  noteCombo: (n: number) => void;
  /** Reclama una misión diaria terminada; devuelve las monedas ganadas (0 si no se pudo). */
  claimMission: (id: string) => number;
  /** Compra un objeto de la tienda. */
  buyItem: (id: ShopId) => { ok: boolean; reason?: string };
  /** Gasta un pase sin espera, si hay, y quita la espera del examen de salto indicado. */
  spendPass: (course: CourseId, examId: string) => boolean;
  bump: (course: CourseId, patch: Partial<ProgressState['stats']>) => Achievement[];
  setStat: (course: CourseId, key: keyof ProgressState['stats'], value: number) => Achievement[];
  checkAchievements: () => Achievement[];
  setSandbox: (course: CourseId, snap: unknown | null) => void;
  setDaily: (course: CourseId, day: string, done: boolean) => void;
  markSurprise: (patch: Partial<ProgressState['surprise']>) => void;
  addStudy: (course: CourseId, seconds: number) => StudyOutcome;
  /** Sustituye el progreso (sincronización con la nube). */
  replaceRoot: (root: RootState) => void;
  setOwner: (owner: string | null) => void;
  resetAll: () => void;
}

export type Store = RootState & Actions;

/** Lee el progreso de la versión de un solo curso («linux-dojo-progress-v1») la primera vez. */
const legacyAwareStorage: StateStorage = {
  getItem: async (name) => {
    const v = await AsyncStorage.getItem(name);
    if (v !== null) return v;
    return AsyncStorage.getItem('linux-dojo-progress-v1');
  },
  setItem: (name, value) => AsyncStorage.setItem(name, value),
  removeItem: (name) => AsyncStorage.removeItem(name),
};

const ROOT_KEYS = Object.keys(initialRoot()) as (keyof RootState)[];

const now = () => Date.now();

export const useGame = create<Store>()(
  persist(
    (set, get) => {
      /** Aplica una transición sobre la raíz, desbloquea logros y marca la modificación. */
      const commit = (root: RootState, touch = true): Achievement[] => {
        const u = unlockAchievements(root, now(), COURSE_LIST);
        set({ ...u.root, updatedAt: touch ? now() : u.root.updatedAt });
        return u.unlocked;
      };
      const state = (): RootState => get();

      return {
        ...initialRoot(),

        // solo se puede estar en un curso de «Mis cursos»
        setActive: (course) => {
          if (get().settings.courseOn[course]) set({ active: course });
        },

        unlockZone: (course, worldIndex) => {
          const root = state();
          const s = flat(root, course);
          if (worldIndex <= s.skipTo) return;
          commit(unflat(root, course, { ...s, skipTo: worldIndex }));
        },

        giveCoins: (n) => {
          const root = state();
          set({ extras: addCoins(root.extras, n), updatedAt: now() });
        },

        noteCombo: (n) => {
          const ex = state().extras;
          if (n > ex.bestCombo) commit({ ...state(), extras: { ...ex, bestCombo: n } });
        },

        claimMission: (id) => {
          const r = claimMissionFn(state(), id, dayKey(now()));
          if (r.coins > 0) commit(r.root);
          return r.coins;
        },

        buyItem: (id) => {
          const r = buyFn(state(), id, now());
          if (r.ok) set({ xp: r.root.xp, streak: r.root.streak, extras: r.root.extras, updatedAt: now() });
          return { ok: r.ok, reason: r.reason };
        },

        spendPass: (course, examId) => {
          const root = state();
          const next = consumePassFn(root);
          if (!next) return false;
          const s = flat(next, course);
          const ex = s.exams[examId];
          const exams = ex ? { ...s.exams, [examId]: { ...ex, lastAt: undefined } } : s.exams;
          set({ ...unflat(next, course, { ...s, exams }), updatedAt: now() });
          return true;
        },

        setCourseOn: (course, on) => {
          const before = get();
          const next = setCourseOnFn(before, course, on);
          if (next === before) return false;
          set({ settings: next.settings, active: next.active, updatedAt: now() });
          return true;
        },

        finishLesson: (course, r) => {
          const t = now();
          const { root, result } = withCourse(state(), course, (s) => finishLessonFn(s, r, t));
          const newAchievements = commit(root);
          return { ...result, newAchievements };
        },

        answer: (course, itemId, correct, opts) => {
          const { root } = withCourse(state(), course, (s) => ({ state: answerFn(s, itemId, correct, now(), opts) }));
          commit(root);
        },

        solveChallenge: (course, id, commands) => {
          const { root } = withCourse(state(), course, (s) => ({ state: solveChallengeFn(s, id, commands, now()) }));
          commit(root);
        },

        trackCommands: (course, lines, sandbox) => {
          const { root } = withCourse(state(), course, (s) => ({ state: trackCommandsFn(s, lines, { sandbox }) }));
          commit(root);
        },

        awardXp: (course, n) => {
          const t = now();
          const { root, result } = withCourse(state(), course, (s) => {
            const r = addXp(s, n, t);
            return { state: r.state, levelUp: r.levelUp };
          });
          commit(root);
          return { levelUp: result.levelUp };
        },

        recordExam: (course, id, score, passMark, bonusXp) => {
          const t = now();
          const { root, result } = withCourse(state(), course, (s) => {
            let st = recordExamFn(s, id, score, passMark, t);
            const passed = score >= passMark;
            const r = addXp(st, passed ? bonusXp : Math.round(bonusXp * 0.15), t);
            st = r.state;
            return { state: st, passed, levelUp: r.levelUp };
          });
          const newAchievements = commit(root);
          return { passed: result.passed, newAchievements, levelUp: result.levelUp };
        },

        setSettings: (patch) => {
          const cur = get().settings;
          set({ settings: mergeSettings({ ...cur, ...patch }), updatedAt: now() });
        },

        bump: (course, patch) => {
          const root = state();
          const s = flat(root, course);
          const st = { ...s.stats };
          for (const [k, v] of Object.entries(patch)) (st as any)[k] += v as number;
          return commit(unflat(root, course, { ...s, stats: st }));
        },

        setStat: (course, key, value) => {
          const root = state();
          const s = flat(root, course);
          const st = { ...s.stats, [key]: Math.max(s.stats[key], value) };
          return commit(unflat(root, course, { ...s, stats: st }));
        },

        checkAchievements: () => {
          const u = unlockAchievements(state(), now(), COURSE_LIST);
          if (u.unlocked.length) set({ ...u.root, updatedAt: now() });
          return u.unlocked;
        },

        // el laboratorio se guarda a menudo y no se sincroniza: no cuenta como modificación
        setSandbox: (course, snap) => {
          const root = state();
          set({ courses: { ...root.courses, [course]: { ...root.courses[course], sandbox: snap } } });
        },

        setDaily: (course, day, done) => {
          const root = state();
          set({ courses: { ...root.courses, [course]: { ...root.courses[course], daily: { day, done } } }, updatedAt: now() });
        },

        markSurprise: (patch) => set({ surprise: { ...get().surprise, ...patch }, updatedAt: now() }),

        addStudy: (course, seconds) => {
          const r = addStudySeconds(state(), course, seconds, now());
          const newAchievements = commit(r.root);
          return { ...r, newAchievements };
        },

        replaceRoot: (root) => set({ ...root }),
        setOwner: (owner) => set({ owner }),
        resetAll: () => {
          useResume.getState().clearAll();
          set({ ...initialRoot(), updatedAt: now() });
        },
      };
    },
    {
      name: 'dev-dojo-progress-v2',
      version: ROOT_VERSION,
      storage: createJSONStorage(() => legacyAwareStorage),
      partialize: (s) => Object.fromEntries(ROOT_KEYS.map((k) => [k, s[k]])) as unknown as Store,
      migrate: (persisted) => migrateRoot(persisted) as unknown as Store,
      merge: (persisted, current) => ({ ...current, ...migrateRoot(persisted) }),
    },
  ),
);

export function useHydrated(): boolean {
  const [h, setH] = useState(useGame.persist.hasHydrated());
  useEffect(() => {
    const unsub = useGame.persist.onFinishHydration(() => setH(true));
    setH(useGame.persist.hasHydrated());
    return unsub;
  }, []);
  return h;
}

/**
 * Vista plana del curso activo (o del indicado) + su definición. Es la forma habitual de leer el juego desde las pantallas:
 * `const { s, course } = useCourse()` → `s.lessons`, `s.settings`, `course.worlds`…
 */
export function useCourse(id?: CourseId): { id: CourseId; course: CourseDef; s: ProgressState; root: RootState } {
  const root = useGame();
  const cid = id ?? root.active;
  return useMemo(() => ({ id: cid, course: courseDef(cid), s: flat(root, cid), root }), [root, cid]);
}
