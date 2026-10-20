/**
 * Dónde se quedó el alumno al salir a la mitad de una lección, un repaso o un examen, y el borrador de un reto.
 * Es estado de pantalla, no progreso: se guarda solo en el dispositivo (no se sincroniza con la nube).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Pasado este tiempo, lo guardado se descarta: el contenido o el progreso pueden haber cambiado demasiado. */
export const RESUME_MAX_AGE = 14 * 86_400_000;
const MAX_DRAFTS = 24;

export interface LessonStats {
  quizTotal: number;
  quizFirstTry: number;
  practices: number;
  hintsUsed: number;
}

export interface LessonResume {
  /** Número de pasos de la lección al guardar: si el contenido cambió, no se reanuda. */
  n: number;
  /** Claves de la cola: «3» es el paso 3; «3-retry», su repetición por haber fallado. */
  queue: string[];
  pos: number;
  stats: LessonStats;
  ts: number;
}

export interface RunResume {
  ids: string[];
  pos: number;
  results: { id: string; correct: boolean }[];
  /** Pendientes de repaso al empezar (para el resumen). */
  due?: number;
  ts: number;
}

export interface ExamResume {
  seed: string;
  /** Ids de las preguntas del examen al guardar: si no coinciden con el plan actual, no se reanuda. */
  qids: string[];
  phase: 'q' | 'c';
  pos: number;
  cpos: number;
  results: { id: string; correct: boolean }[];
  solved: number;
  /** Segundos que quedaban (el reloj se detiene mientras el alumno está fuera); 0 si el examen no tiene límite. */
  left: number;
  ts: number;
}

export interface Draft {
  /** Código de un reto de Python, o líneas ya ejecutadas en un reto de terminal. */
  v: string | string[];
  ts: number;
}

const fresh = (ts: number, now = Date.now()) => now - ts < RESUME_MAX_AGE;

/** La cola guardada solo sirve si encaja con la lección actual. */
export function validLesson(r: LessonResume | undefined, stepCount: number, now = Date.now()): LessonResume | undefined {
  if (!r || r.n !== stepCount || !fresh(r.ts, now)) return undefined;
  if (!Array.isArray(r.queue) || r.queue.length === 0 || !(r.pos >= 0 && r.pos < r.queue.length)) return undefined;
  for (const k of r.queue) {
    const m = /^(\d+)(-retry)?$/.exec(k);
    if (!m || Number(m[1]) >= stepCount) return undefined;
  }
  return r;
}

/** «Paso 4 de 9», si la lección tiene un avance guardado válido. */
export function lessonResumeLabel(r: LessonResume | undefined, stepCount: number): string | undefined {
  const v = validLesson(r, stepCount);
  return v ? `Paso ${v.pos + 1} de ${v.queue.length}` : undefined;
}

export function validRun(r: RunResume | undefined, ids: string[], now = Date.now()): RunResume | undefined {
  if (!r || !fresh(r.ts, now) || r.ids.length !== ids.length || r.ids.some((id, i) => id !== ids[i])) return undefined;
  return r.pos >= 0 && r.pos < ids.length && r.results.length === r.pos ? r : undefined;
}

export function validExam(r: ExamResume | undefined, qids: string[], challenges: number, now = Date.now()): ExamResume | undefined {
  if (!r || !fresh(r.ts, now) || r.qids.length !== qids.length || r.qids.some((id, i) => id !== qids[i])) return undefined;
  if (!(r.pos >= 0 && r.pos <= qids.length) || !(r.cpos >= 0 && r.cpos < Math.max(1, challenges))) return undefined;
  if (r.phase === 'q' && r.pos >= qids.length) return undefined;
  if (r.phase === 'c' && challenges === 0) return undefined;
  return r.left >= 0 ? r : undefined;
}

interface ResumeState {
  lessons: Record<string, LessonResume>;
  runs: Record<string, RunResume>;
  exams: Record<string, ExamResume>;
  drafts: Record<string, Draft>;
  setLesson: (id: string, r: LessonResume) => void;
  clearLesson: (id: string) => void;
  setRun: (key: string, r: RunResume) => void;
  clearRun: (key: string) => void;
  setExam: (key: string, r: ExamResume) => void;
  clearExam: (key: string) => void;
  setDraft: (key: string, v: string | string[]) => void;
  clearDraft: (key: string) => void;
  clearAll: () => void;
}

const without = <T,>(o: Record<string, T>, k: string): Record<string, T> => {
  if (!(k in o)) return o;
  const { [k]: _gone, ...rest } = o;
  return rest;
};

export const useResume = create<ResumeState>()(
  persist(
    (set) => ({
      lessons: {},
      runs: {},
      exams: {},
      drafts: {},
      setLesson: (id, r) => set((s) => ({ lessons: { ...s.lessons, [id]: r } })),
      clearLesson: (id) => set((s) => ({ lessons: without(s.lessons, id) })),
      setRun: (key, r) => set((s) => ({ runs: { ...s.runs, [key]: r } })),
      clearRun: (key) => set((s) => ({ runs: without(s.runs, key) })),
      setExam: (key, r) => set((s) => ({ exams: { ...s.exams, [key]: r } })),
      clearExam: (key) => set((s) => ({ exams: without(s.exams, key) })),
      setDraft: (key, v) =>
        set((s) => {
          const drafts = { ...s.drafts, [key]: { v, ts: Date.now() } };
          const keys = Object.keys(drafts);
          if (keys.length > MAX_DRAFTS) {
            keys.sort((a, b) => drafts[a].ts - drafts[b].ts);
            for (const k of keys.slice(0, keys.length - MAX_DRAFTS)) delete drafts[k];
          }
          return { drafts };
        }),
      clearDraft: (key) => set((s) => ({ drafts: without(s.drafts, key) })),
      clearAll: () => set({ lessons: {}, runs: {}, exams: {}, drafts: {} }),
    }),
    {
      name: 'dev-dojo-resume-v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ lessons: s.lessons, runs: s.runs, exams: s.exams, drafts: s.drafts }) as unknown as ResumeState,
    },
  ),
);

/** Borrador vigente de un reto (código o comandos), si lo hay. */
export function getDraft<T extends string | string[]>(key: string): T | undefined {
  const d = useResume.getState().drafts[key];
  return d && fresh(d.ts) ? (d.v as T) : undefined;
}

/** `true` cuando lo guardado ya se leyó del disco (antes de eso, no hay nada que reanudar). */
export function useResumeReady(): boolean {
  const [h, setH] = useState(useResume.persist.hasHydrated());
  useEffect(() => {
    const unsub = useResume.persist.onFinishHydration(() => setH(true));
    setH(useResume.persist.hasHydrated());
    return unsub;
  }, []);
  return h;
}
