import type { CourseId } from '@/content/types';

/** Curso que se está practicando ahora (null = ninguno). Módulo mínimo, sin dependencias pesadas (lo usa también la tarea en segundo plano). */
let context: CourseId | null = null;

export const getStudyContext = (): CourseId | null => context;
export const setContext = (c: CourseId | null) => {
  context = c;
};
