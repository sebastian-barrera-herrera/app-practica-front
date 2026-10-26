import type { CourseId } from '@/content/types';
import { themeName } from './theme';

/** Color de acento del curso según el tema activo (léelo siempre en render, nunca a nivel de módulo). */
export function courseColor(id: CourseId): string {
  const light = themeName() === 'light';
  if (id === 'sql') return light ? '#C2570C' : '#FB923C';
  if (id === 'aws') return light ? '#7C3AED' : '#A78BFA';
  return id === 'python' ? (light ? '#2563EB' : '#5AA9FF') : light ? '#0E9F78' : '#22D3A6';
}

/** Segundo color de la identidad del curso (detalles, degradados). */
export function courseColor2(id: CourseId): string {
  const light = themeName() === 'light';
  if (id === 'sql') return light ? '#A16207' : '#FCD34D';
  if (id === 'aws') return light ? '#C2570C' : '#FF9900';
  return id === 'python' ? (light ? '#B58900' : '#FFD43B') : light ? '#0B86C4' : '#38BDF8';
}

/** Texto sobre un fondo del color de acento del curso. */
export const onCourse = (id: CourseId): string => (id === 'python' ? '#04122B' : id === 'sql' ? '#2A1303' : id === 'aws' ? '#120A2E' : '#052018');
