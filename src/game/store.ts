/** Store global (zustand) con persistencia en AsyncStorage. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LEVELS, WORLDS } from '@/content';
import {
  addXp, answer as answerFn, finishLesson as finishLessonFn, initialState, recordExam as recordExamFn,
  solveChallenge as solveChallengeFn, trackCommands as trackCommandsFn, unlockAchievements,
  type Ctx, type LessonOutcome, type LessonResult, type ProgressState, type Settings,
} from './progress';
import type { Achievement } from './achievements';

const ctx = (): Ctx => ({ worlds: WORLDS, levels: LEVELS });

export interface Actions {
  finishLesson: (r: LessonResult) => LessonOutcome;
  answer: (itemId: string, correct: boolean, opts?: { review?: boolean }) => void;
  solveChallenge: (id: string, commands: number) => void;
  trackCommands: (lines: string[], sandbox: boolean) => void;
  awardXp: (n: number) => { levelUp: number | null };
  recordExam: (id: string, score: number, passMark: number, bonusXp: number) => { passed: boolean; newAchievements: Achievement[]; levelUp: number | null };
  setSettings: (patch: Partial<Settings>) => void;
  bump: (patch: Partial<ProgressState['stats']>) => Achievement[];
  setStat: (key: keyof ProgressState['stats'], value: number) => Achievement[];
  checkAchievements: () => Achievement[];
  setSandbox: (snap: unknown | null) => void;
  setDaily: (day: string, done: boolean) => void;
  markSurprise: (patch: Partial<ProgressState['surprise']>) => void;
  resetAll: () => void;
}

export type Store = ProgressState & Actions;

export const useGame = create<Store>()(
  persist(
    (set, get) => ({
      ...initialState(),
      finishLesson: (r) => {
        const out = finishLessonFn(get(), r, Date.now(), ctx());
        set(out.state);
        return out;
      },
      answer: (itemId, correct, opts) => set(answerFn(get(), itemId, correct, Date.now(), opts)),
      solveChallenge: (id, commands) => set(solveChallengeFn(get(), id, commands, Date.now())),
      trackCommands: (lines, sandbox) => set(trackCommandsFn(get(), lines, { sandbox })),
      awardXp: (n) => {
        const r = addXp(get(), n, Date.now());
        const u = unlockAchievements(r.state, Date.now(), ctx());
        set(u.state);
        return { levelUp: r.levelUp };
      },
      recordExam: (id, score, passMark, bonusXp) => {
        const now = Date.now();
        let s = recordExamFn(get(), id, score, passMark, now);
        const passed = score >= passMark;
        const r = addXp(s, passed ? bonusXp : Math.round(bonusXp * 0.15), now);
        s = r.state;
        const u = unlockAchievements(s, now, ctx());
        set(u.state);
        return { passed, newAchievements: u.unlocked, levelUp: r.levelUp };
      },
      setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      bump: (patch) => {
        const st = { ...get().stats };
        for (const [k, v] of Object.entries(patch)) (st as any)[k] += v as number;
        const u = unlockAchievements({ ...get(), stats: st }, Date.now(), ctx());
        set(u.state);
        return u.unlocked;
      },
      setStat: (key, value) => {
        const st = { ...get().stats, [key]: Math.max(get().stats[key], value) };
        const u = unlockAchievements({ ...get(), stats: st }, Date.now(), ctx());
        set(u.state);
        return u.unlocked;
      },
      checkAchievements: () => {
        const u = unlockAchievements(get(), Date.now(), ctx());
        if (u.unlocked.length) set(u.state);
        return u.unlocked;
      },
      setSandbox: (snap) => set({ sandbox: snap }),
      setDaily: (day, done) => set({ daily: { day, done } }),
      markSurprise: (patch) => set({ surprise: { ...get().surprise, ...patch } }),
      resetAll: () => set({ ...initialState() }),
    }),
    {
      name: 'linux-dojo-progress-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (s) => {
        const { finishLesson, answer, solveChallenge, trackCommands, awardXp, recordExam, setSettings, bump, setStat, checkAchievements, setSandbox, setDaily, markSurprise, resetAll, ...data } = s;
        void finishLesson; void answer; void solveChallenge; void trackCommands; void awardXp; void recordExam; void setSettings; void bump; void setStat; void checkAchievements; void setSandbox; void setDaily; void markSurprise; void resetAll;
        return data;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProgressState>;
        const base = initialState();
        return {
          ...current,
          ...p,
          settings: { ...base.settings, ...(p.settings ?? {}) },
          stats: { ...base.stats, ...(p.stats ?? {}) },
          streak: { ...base.streak, ...(p.streak ?? {}) },
          surprise: { ...base.surprise, ...(p.surprise ?? {}) },
        };
      },
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
