/** Fuente de la biblioteca y de los ejemplos para los cursos que usan el intérprete de Python (python e ia). */
import { IA_REF_CATEGORY, IA_REFERENCE } from './ia/reference';
import { IA_SAMPLES } from './ia/samples';
import { PY_REF_CATEGORY, PY_REFERENCE, type PyRef } from './py/reference';
import { PY_SAMPLES, type PySample } from './py/samples';

export type PyLikeCourse = 'python' | 'ia';

export interface PyRefSource {
  title: string;
  placeholder: string;
  categories: Record<string, string>;
  refs: PyRef<string>[];
}

export function refSource(course: PyLikeCourse): PyRefSource {
  return course === 'ia'
    ? { title: 'Biblioteca de IA', placeholder: 'Buscar función, concepto o palabra…', categories: IA_REF_CATEGORY, refs: IA_REFERENCE }
    : { title: 'Biblioteca de Python', placeholder: 'Buscar función, método o palabra…', categories: PY_REF_CATEGORY, refs: PY_REFERENCE };
}

export const refFor = (course: PyLikeCourse, name: string): PyRef<string> | undefined => refSource(course).refs.find((r) => r.name === name);

export const samplesFor = (course: PyLikeCourse): PySample[] => (course === 'ia' ? IA_SAMPLES : PY_SAMPLES);
