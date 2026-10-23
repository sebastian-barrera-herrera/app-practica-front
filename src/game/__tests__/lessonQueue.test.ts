import type { Step } from '@/content/types';
import { buildQueue, insertRetry, RETRY_GAP } from '../lessonQueue';

const quiz = (q: string): Step => ({ type: 'quiz', q: { t: 'tf', q, answer: true, why: '' } as never });
const lesson = { id: 'w1-1', steps: [{ type: 'learn', body: 'a' } as Step, quiz('1'), quiz('2'), quiz('3'), quiz('4'), quiz('5'), quiz('6'), { type: 'learn', body: 'z' } as Step] };

describe('cola de pasos de una lección', () => {
  test('construye la lección entera o la guardada, con las repeticiones', () => {
    const q = buildQueue(lesson);
    expect(q.map((i) => i.key)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(q[1].srsId).toBe('w1-1#1');
    expect(q[0].srsId).toBeUndefined();
    const saved = buildQueue(lesson, ['0', '1', '2', '1-retry', '3']);
    expect(saved[3]).toMatchObject({ key: '1-retry', retry: true, srsId: 'w1-1#1' });
  });

  test('una pregunta fallada se repite unos pasos más adelante', () => {
    const q = buildQueue(lesson);
    const out = insertRetry(q, 2, q[2]);
    expect(out).toHaveLength(q.length + 1);
    expect(out[2 + RETRY_GAP].key).toBe('2-retry');
    expect(out[2 + RETRY_GAP].retry).toBe(true);
  });

  test('al volver atrás y fallar otra vez no se acumulan repeticiones', () => {
    const q = buildQueue(lesson);
    const once = insertRetry(q, 2, q[2]);
    const twice = insertRetry(once, 2, once[2]);
    expect(twice).toBe(once);
    expect(twice.filter((i) => i.key === '2-retry')).toHaveLength(1);
  });

  test('una repetición no genera otra repetición, y cerca del final se coloca al final', () => {
    const q = buildQueue(lesson, ['0', '1', '1-retry']);
    expect(insertRetry(q, 2, q[2])).toBe(q);
    const near = insertRetry(buildQueue(lesson), 7, buildQueue(lesson)[7]);
    expect(near[near.length - 1].key).toBe('7-retry');
  });
});
