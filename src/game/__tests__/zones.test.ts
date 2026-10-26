import { COURSES } from '@/content';
import { initialState, nextLesson, nextStep, openedBySkip, stepRoute, worldCleared, worldMissing, worldUnlocked, type ProgressState } from '../progress';

const worlds = COURSES.linux.worlds;
const lessonsOf = (n: number) => Object.fromEntries(worlds.slice(0, n).flatMap((w) => w.lessons.map((l) => [l.id, { done: true, stars: 3, bestAccuracy: 1, plays: 1 }])));
const bossOf = (...idx: number[]) => Object.fromEntries(idx.map((i) => [worlds[i].boss!.id, { solved: true, bestCommands: 1 }]));
const examOf = (...idx: number[]) => Object.fromEntries(idx.map((i) => [`exam-${worlds[i].id}`, { best: 0.9, passed: true, attempts: 1 }]));
const st = (p: Partial<ProgressState>): ProgressState => ({ ...initialState(), ...p });

describe('una zona solo se abre al superar la anterior (lecciones + misión final + examen)', () => {
  test('terminar las lecciones ya no basta', () => {
    const s = st({ lessons: lessonsOf(1) });
    expect(worldUnlocked(s, worlds, 1)).toBe(false);
    expect(worldMissing(s, worlds[0])).toEqual({ lessons: 0, boss: true, exam: true });
  });

  test('con la misión pero sin el examen sigue cerrada, y al revés', () => {
    expect(worldUnlocked(st({ lessons: lessonsOf(1), challenges: bossOf(0) }), worlds, 1)).toBe(false);
    expect(worldUnlocked(st({ lessons: lessonsOf(1), exams: examOf(0) }), worlds, 1)).toBe(false);
  });

  test('lecciones + misión + examen la abren', () => {
    const s = st({ lessons: lessonsOf(1), challenges: bossOf(0), exams: examOf(0) });
    expect(worldCleared(s, worlds[0])).toBe(true);
    expect(worldUnlocked(s, worlds, 1)).toBe(true);
    expect(worldUnlocked(s, worlds, 2)).toBe(false);
  });

  test('misión y examen sin las lecciones tampoco', () => {
    expect(worldUnlocked(st({ challenges: bossOf(0), exams: examOf(0) }), worlds, 1)).toBe(false);
  });

  test('una zona que ya se había empezado no se vuelve a cerrar (progreso anterior a la regla)', () => {
    const s = st({ lessons: { ...lessonsOf(2) } });
    expect(worldUnlocked(s, worlds, 1)).toBe(true);
    // la tercera sigue cerrada: la segunda no tiene misión ni examen
    expect(worldUnlocked(s, worlds, 2)).toBe(false);
  });

  test('el examen de salto y «desbloquearlo todo» siguen funcionando', () => {
    expect(worldUnlocked(st({ skipTo: 3 }), worlds, 3)).toBe(true);
    expect(openedBySkip(st({ skipTo: 3 }), worlds, 3)).toBe(true);
    expect(openedBySkip(st({ skipTo: 1, lessons: lessonsOf(1), challenges: bossOf(0), exams: examOf(0) }), worlds, 1)).toBe(false);
    const all = st({});
    all.settings = { ...all.settings, unlockAll: true };
    expect(worldUnlocked(all, worlds, 5)).toBe(true);
  });
});

describe('lo siguiente que toca en la ruta', () => {
  test('lecciones → misión final → examen → primera lección de la zona siguiente', () => {
    const base = st({ lessons: lessonsOf(1) });
    expect(nextStep(st({}), worlds)).toMatchObject({ kind: 'lesson', lessonIndex: 0 });
    expect(nextStep(base, worlds)).toMatchObject({ kind: 'boss', world: { id: worlds[0].id } });
    const conMision = { ...base, challenges: bossOf(0) };
    expect(nextStep(conMision, worlds)).toMatchObject({ kind: 'exam', world: { id: worlds[0].id } });
    const completa = { ...conMision, exams: examOf(0) };
    expect(nextStep(completa, worlds)).toMatchObject({ kind: 'lesson', world: { id: worlds[1].id }, lessonIndex: 0 });
  });

  test('nextLesson solo devuelve lecciones', () => {
    expect(nextLesson(st({ lessons: lessonsOf(1) }), worlds)).toBeNull();
    expect(nextLesson(st({}), worlds)?.world.id).toBe(worlds[0].id);
  });

  test('si ya se avanzó a la zona siguiente, la misión y el examen anteriores no se imponen', () => {
    const s = st({ lessons: lessonsOf(2) });
    expect(nextStep(s, worlds)).toMatchObject({ kind: 'boss', world: { id: worlds[1].id } });
  });

  test('las rutas de cada paso', () => {
    expect(stepRoute({ kind: 'boss', world: worlds[2] }, 'linux')).toEqual({ pathname: '/session/[mode]', params: { mode: `boss-${worlds[2].id}`, course: 'linux' } });
    expect(stepRoute({ kind: 'exam', world: worlds[2] }, 'linux').params).toEqual({ mode: `exam-${worlds[2].id}`, course: 'linux' });
    expect(stepRoute({ kind: 'lesson', world: worlds[0], lessonIndex: 1 }, 'linux')).toEqual({ pathname: '/lesson/[id]', params: { id: worlds[0].lessons[1].id } });
  });
});
