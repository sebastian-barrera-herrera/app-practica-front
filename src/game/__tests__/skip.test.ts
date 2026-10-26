import { COURSES } from '@/content';
import { allQuestions } from '@/content/pool';
import { skipExam, skippedWorlds, skipWait, SKIP_PASS_MARK } from '../exams';
import { initialState, lessonUnlocked, nextLesson, openedBySkip, worldUnlocked } from '../progress';

const linux = COURSES.linux;
const worlds = linux.worlds;
const doneLessons = (n: number) => Object.fromEntries(worlds.slice(0, n).flatMap((w) => w.lessons.map((l) => [l.id, { done: true, stars: 3, bestAccuracy: 1, plays: 1 }])));

describe('examen de salto', () => {
  test('sin examen, una zona lejana está cerrada', () => {
    const s = initialState();
    expect(worldUnlocked(s, worlds, 0)).toBe(true);
    expect(worldUnlocked(s, worlds, 1)).toBe(false);
    expect(worldUnlocked(s, worlds, 4)).toBe(false);
  });

  test('aprobarlo abre esa zona y las anteriores, con todas sus lecciones', () => {
    const s = { ...initialState(), skipTo: 4 };
    for (let i = 0; i <= 4; i++) expect(worldUnlocked(s, worlds, i)).toBe(true);
    expect(worldUnlocked(s, worlds, 5)).toBe(false);
    // en una zona abierta por salto no hace falta ir lección a lección
    expect(lessonUnlocked(s, worlds, 4, worlds[4].lessons.length - 1)).toBe(true);
    // la siguiente sigue cerrada
    expect(lessonUnlocked(s, worlds, 5, 0)).toBe(false);
    expect(openedBySkip(s, worlds, 4)).toBe(true);
    expect(openedBySkip(s, worlds, 0)).toBe(false);
    expect(openedBySkip(s, worlds, 5)).toBe(false);
  });

  test('una zona que se abrió "de verdad" no cuenta como saltada', () => {
    // la zona anterior está superada del todo (lecciones + misión final + examen)
    const challenges = Object.fromEntries(worlds.slice(0, 2).map((w) => [w.boss!.id, { solved: true, bestCommands: 1 }]));
    const exams = Object.fromEntries(worlds.slice(0, 2).map((w) => [`exam-${w.id}`, { best: 0.9, passed: true, attempts: 1 }]));
    const s = { ...initialState(), skipTo: 2, lessons: doneLessons(2), challenges, exams };
    expect(openedBySkip(s, worlds, 2)).toBe(false);
  });

  test('la ruta continúa desde la zona a la que se saltó', () => {
    const s0 = initialState();
    expect(nextLesson(s0, worlds)?.world.id).toBe(worlds[0].id);
    const s = { ...s0, skipTo: 3 };
    expect(nextLesson(s, worlds)?.world.id).toBe(worlds[3].id);
  });

  test('cubre solo las zonas anteriores que faltan por completar', () => {
    const s = { ...initialState(), lessons: doneLessons(2) };
    const covered = skippedWorlds(linux, worlds[4], (w) => w.lessons.every((l) => s.lessons[l.id]?.done));
    expect(covered.map((w) => w.id)).toEqual([worlds[2].id, worlds[3].id]);
  });

  test('es difícil: 85 %, preguntas solo de las zonas que se saltan, tipos que no se aciertan por azar y dos retos', () => {
    const covered = worlds.slice(0, 4);
    const plan = skipExam(linux, worlds[4], covered, 'semilla');
    expect(plan.id).toBe(`skip-${worlds[4].id}`);
    expect(plan.passMark).toBe(SKIP_PASS_MARK);
    expect(plan.passMark).toBeGreaterThan(0.8);
    expect(plan.unlocks).toEqual({ worldIndex: 4, worldTitle: worlds[4].title });
    expect(plan.questions.length).toBe(20);
    expect(new Set(plan.questions.map((q) => q.id)).size).toBe(20);
    const ok = new Set(covered.map((w) => w.id));
    for (const q of plan.questions) expect(ok.has(q.worldId)).toBe(true);
    expect(plan.challenges.length).toBe(2);
    const active = plan.questions.filter((q) => ['cmd', 'order', 'fill', 'output', 'pycode', 'pyout', 'match', 'multi'].includes(q.q.t)).length;
    expect(active).toBeGreaterThanOrEqual(12);
  });

  test('la misma semilla da el mismo examen y otra semilla, otro', () => {
    const covered = worlds.slice(0, 3);
    const a = skipExam(linux, worlds[3], covered, 'a');
    expect(skipExam(linux, worlds[3], covered, 'a').questions.map((q) => q.id)).toEqual(a.questions.map((q) => q.id));
    expect(skipExam(linux, worlds[3], covered, 'b').questions.map((q) => q.id)).not.toEqual(a.questions.map((q) => q.id));
    expect(allQuestions('linux').length).toBeGreaterThan(100);
  });

  test('tras suspender hay que esperar; aprobado o sin intentos previos, no', () => {
    const now = 1_000_000;
    const cd = 30 * 60 * 1000;
    expect(skipWait(undefined, undefined, now, cd)).toBe(0);
    expect(skipWait(now - 1000, false, now, cd)).toBe(cd - 1000);
    expect(skipWait(now - cd - 1, false, now, cd)).toBe(0);
    expect(skipWait(now - 1000, true, now, cd)).toBe(0);
  });
});
