/** Cola de pasos de una lección: la lección entera o, al reanudar, la guardada (con las repeticiones de lo fallado). */
import type { Step } from '@/content/types';

export interface QueueItem {
  key: string;
  step: Step;
  srsId?: string;
  retry?: boolean;
}

/** Cuántos pasos más adelante se repite una pregunta fallada. */
export const RETRY_GAP = 4;

export function buildQueue(lesson: { id: string; steps: Step[] }, keys?: string[]): QueueItem[] {
  const at = (key: string): QueueItem => {
    const i = parseInt(key, 10);
    const step = lesson.steps[i];
    return { key, step, srsId: step.type === 'quiz' ? `${lesson.id}#${i}` : undefined, retry: key.endsWith('-retry') || undefined };
  };
  return (keys ?? lesson.steps.map((_, i) => String(i))).map(at);
}

/**
 * Programa la repetición de un paso fallado unos pasos más adelante. Solo una vez por paso: si el alumno vuelve atrás
 * y falla de nuevo la misma pregunta, no se acumulan repeticiones.
 */
export function insertRetry(queue: QueueItem[], pos: number, item: QueueItem): QueueItem[] {
  const key = `${item.key}-retry`;
  if (item.retry || queue.some((q) => q.key === key)) return queue;
  const copy = [...queue];
  copy.splice(Math.min(copy.length, pos + RETRY_GAP), 0, { ...item, key, retry: true });
  return copy;
}
