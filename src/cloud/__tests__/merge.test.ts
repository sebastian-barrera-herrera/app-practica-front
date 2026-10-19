import { addStudySeconds, initialRoot, withCourse } from '@/game/root';
import { finishLesson } from '@/game/progress';
import { joinRoot, mergeRoots, sameProgress, splitRoot } from '../merge';

const T0 = new Date(2026, 2, 14, 12, 0, 0).getTime();
const DAY = 86400000;

function withLesson(id: string, at = T0) {
  return withCourse(initialRoot(), 'linux', (s) => finishLesson(s, { lessonId: id, quizTotal: 4, quizFirstTry: 4, practices: 1, hintsUsed: 0 }, at)).root;
}

describe('sincronización: partes y fusión', () => {
  test('split/join son inversas (salvo el laboratorio)', () => {
    let root = withLesson('w1-1');
    root = { ...root, updatedAt: 123, owner: 'u1' };
    const parts = splitRoot(root);
    expect(Object.keys(parts).sort()).toEqual(['global', 'linux', 'python']);
    expect(parts.linux.sandbox).toBeUndefined();
    const back = joinRoot(parts, 'u1', 123);
    expect(sameProgress(root, back)).toBe(true);
    expect(back.owner).toBe('u1');
  });

  test('fusiona lecciones de dos dispositivos sin perder nada', () => {
    const a = { ...withLesson('w1-1', T0), updatedAt: 10 };
    const b = { ...withLesson('w1-2', T0 + DAY), updatedAt: 20 };
    const m = mergeRoots(a, b);
    expect(m.courses.linux.lessons['w1-1'].done).toBe(true);
    expect(m.courses.linux.lessons['w1-2'].done).toBe(true);
    expect(m.xp).toBe(Math.max(a.xp, b.xp));
    expect(m.updatedAt).toBe(20);
    // conmutativa en el contenido
    expect(sameProgress(mergeRoots(a, b), mergeRoots(b, a))).toBe(true);
    // idempotente
    expect(sameProgress(mergeRoots(m, m), m)).toBe(true);
  });

  test('tiempo de estudio por máximo y metas por unión; ajustes de la copia más reciente', () => {
    let a = initialRoot();
    a = addStudySeconds(a, 'python', 100, T0).root;
    let b = initialRoot();
    b = addStudySeconds(b, 'python', 250, T0).root;
    b = addStudySeconds(b, 'linux', 70, T0 + DAY).root;
    a = { ...a, updatedAt: 5, settings: { ...a.settings, name: 'viejo' } };
    b = { ...b, updatedAt: 9, settings: { ...b.settings, name: 'nuevo' } };
    const m = mergeRoots(a, b);
    expect(Object.values(m.study.python)[0]).toBe(250);
    expect(Object.values(m.study.linux)[0]).toBe(70);
    expect(m.settings.name).toBe('nuevo');
  });
});
