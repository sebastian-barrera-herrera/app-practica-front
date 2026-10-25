import { COURSES } from '@/content';
import { addXp, finishLesson, initialState, lessonUnlocked, nextLesson, worldUnlocked, answer, recordExam } from '../progress';
import { addStudySeconds, dayComplete, flat, goalStreak, hasProgress, initialRoot, migrateRoot, unflat, unlockAchievements, withCourse } from '../root';
import { emptyStreak, touchStreak, dayKey, streakAlive } from '../streak';
import { review, dueItems, mastery, INTERVALS, DAY } from '../srs';
import { levelFromXp, levelProgress, xpForLevel, starsFor, lessonXp } from '../xp';

import { blitzPool, dailyChallenge, learnedQuestions, reviewSession, shouldOfferSurprise, surpriseSession } from '../sessions';
import { certExam, worldExam } from '../exams';

const LINUX = COURSES.linux;
const WORLDS = LINUX.worlds;
const T0 = new Date(2026, 2, 14, 12, 0, 0).getTime();

describe('xp y niveles', () => {
  test('umbrales coherentes', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(300)).toBe(3);
    for (let n = 1; n < 30; n++) expect(levelFromXp(xpForLevel(n))).toBe(n);
    const p = levelProgress(150);
    expect(p.level).toBe(2);
    expect(p.pct).toBeCloseTo(0.25);
  });
  test('estrellas y xp de lección', () => {
    expect(starsFor(1, 0)).toBe(3);
    expect(starsFor(1, 1)).toBe(2);
    expect(starsFor(0.5, 0)).toBe(1);
    const first = lessonXp({ quizCorrectFirstTry: 6, quizTotal: 6, practices: 2, hintsUsed: 0, stars: 3, firstTime: true });
    expect(first.total).toBe(6 * 5 + 2 * 15 + 20);
    const again = lessonXp({ quizCorrectFirstTry: 6, quizTotal: 6, practices: 2, hintsUsed: 0, stars: 3, firstTime: false });
    expect(again.total).toBeLessThan(first.total / 2);
  });
});

describe('racha', () => {
  test('crece, se rompe y usa escudos', () => {
    let s = emptyStreak();
    const day = (n: number) => T0 + n * DAY;
    s = touchStreak(s, day(0)).streak;
    expect(s.current).toBe(1);
    expect(touchStreak(s, day(0) + 1000).extended).toBe(false);
    s = touchStreak(s, day(1)).streak;
    expect(s.current).toBe(2);
    const skip = touchStreak(s, day(3));
    expect(skip.usedFreeze).toBe(true);
    expect(skip.streak.current).toBe(3);
    expect(skip.streak.freezes).toBe(0);
    const broken = touchStreak(skip.streak, day(7));
    expect(broken.streak.current).toBe(1);
    expect(broken.streak.best).toBe(3);
    expect(streakAlive(s, day(1))).toBe(true);
    expect(streakAlive({ ...s, freezes: 0 }, day(5))).toBe(false);
    expect(dayKey(T0)).toBe('2026-03-14');
  });
});

describe('repaso espaciado', () => {
  test('cajas y vencimientos', () => {
    let it = review(undefined, true, T0);
    expect(it.box).toBe(1);
    expect(it.due).toBe(T0 + INTERVALS[1] * DAY);
    it = review(it, true, T0);
    expect(it.box).toBe(2);
    it = review(it, false, T0);
    expect(it.box).toBe(0);
    expect(it.wrong).toBe(1);
    const srs = { a: review(undefined, false, T0), b: review(undefined, true, T0) };
    expect(dueItems(srs, T0 + 11 * 60000)).toEqual(['a']);
    expect(dueItems(srs, T0 + 2 * DAY)).toEqual(['a', 'b']);
    expect(mastery(srs, ['a', 'b'])).toBeGreaterThan(0);
  });
});

describe('progreso', () => {
  test('desbloqueo de lecciones y mundos', () => {
    let s = initialState();
    expect(worldUnlocked(s, WORLDS, 0)).toBe(true);
    expect(lessonUnlocked(s, WORLDS, 0, 0)).toBe(true);
    expect(lessonUnlocked(s, WORLDS, 0, 1)).toBe(false);
    const r = finishLesson(s, { lessonId: 'w1-1', quizTotal: 6, quizFirstTry: 6, practices: 2, hintsUsed: 0 }, T0);
    expect(r.stars).toBe(3);
    expect(r.xp.total).toBeGreaterThan(40);
    expect(r.state.lessons['w1-1'].done).toBe(true);
    expect(lessonUnlocked(r.state, WORLDS, 0, 1)).toBe(true);
    const ach = unlockAchievements(unflat(initialRoot(), 'linux', r.state), T0, [LINUX]);
    expect(ach.unlocked.map((a) => a.id)).toEqual(expect.arrayContaining(['linux:first-step', 'linux:perfect']));
    expect(r.state.streak.current).toBe(1);
    expect(nextLesson(r.state, WORLDS)?.lessonIndex).toBe(1);
    // repetir da menos xp
    const again = finishLesson(r.state, { lessonId: 'w1-1', quizTotal: 6, quizFirstTry: 6, practices: 2, hintsUsed: 0 }, T0 + 1000);
    expect(again.xp.total).toBeLessThan(r.xp.total);
    expect(again.firstTime).toBe(false);
  });

  test('respuestas, exámenes y logros', () => {
    let s = initialState();
    s = answer(s, 'q1', true, T0);
    s = answer(s, 'q2', false, T0, { review: true });
    expect(s.stats.questions).toBe(2);
    expect(s.stats.reviews).toBe(1);
    expect(s.srs.q1.box).toBe(1);
    s = recordExam(s, 'w1', 0.9, 0.7, T0);
    expect(s.exams.w1.passed).toBe(true);
    expect(s.stats.examsPassed).toBe(1);
    const u = unlockAchievements(unflat(initialRoot(), 'linux', s), T0, [LINUX]);
    expect(u.unlocked.map((a) => a.id)).toContain('linux:exam-pass');
    const x = addXp(s, 120, T0);
    expect(x.levelUp).toBe(2);
  });
});

describe('sesiones', () => {
  test('repaso, sorpresa, blitz, diario', () => {
    let s = initialState();
    const base = learnedQuestions(s, LINUX);
    expect(base.length).toBeGreaterThan(0);
    const r0 = reviewSession(s, T0, LINUX);
    expect(r0.items.length).toBeGreaterThan(0);
    expect(r0.fresh).toBe(true);
    s = answer(s, base[0].id, false, T0);
    s = answer(s, base[1].id, false, T0);
    s = answer(s, base[2].id, false, T0);
    const r1 = reviewSession(s, T0 + 3600000, LINUX);
    expect(r1.fresh).toBe(false);
    expect(r1.due).toBe(3);
    expect(surpriseSession(s, T0, LINUX).length).toBe(5);
    expect(blitzPool(s, 'all', LINUX).length).toBeGreaterThan(5);
    const d = dailyChallenge(s, T0, LINUX)!;
    expect(d.challenge.id).toBeTruthy();
    expect(dailyChallenge(s, T0, LINUX)!.challenge.id).toBe(d.challenge.id);
    expect(shouldOfferSurprise(s, T0)).toBe(false);
  });

  test('exámenes', () => {
    const w = WORLDS[0];
    const e = worldExam(LINUX, w, 'x');
    expect(e.questions.length).toBeGreaterThan(5);
    expect(e.challenges.length).toBe(1);
    const c = certExam(LINUX, 'basico', 'x');
    expect(c.questions.length).toBeGreaterThan(8);
    expect(c.id).toBe('cert-basico');
  });
});


describe('estado raíz y multi-curso', () => {
  test('vista plana por curso y logros por curso', () => {
    let root = initialRoot();
    const r = withCourse(root, 'linux', (s) => finishLesson(s, { lessonId: 'w1-1', quizTotal: 4, quizFirstTry: 4, practices: 1, hintsUsed: 0 }, T0));
    root = r.root;
    expect(flat(root, 'linux').lessons['w1-1'].done).toBe(true);
    expect(flat(root, 'python').lessons['w1-1']).toBeUndefined();
    // el XP y la racha son globales
    expect(flat(root, 'python').xp).toBe(root.xp);
    expect(root.xp).toBeGreaterThan(0);
    const u = unlockAchievements(root, T0, [LINUX, COURSES.python]);
    const ids = u.unlocked.map((a) => a.id);
    expect(ids).toContain('linux:first-step');
    expect(ids).not.toContain('python:first-step');
    expect(hasProgress(root)).toBe(true);
    expect(hasProgress(initialRoot())).toBe(false);
  });

  test('tiempo de estudio, meta diaria y racha de metas', () => {
    let root = initialRoot();
    root = { ...root, settings: { ...root.settings, goalMinutes: { linux: 1, python: 1, sql: 1 } } };
    const a = addStudySeconds(root, 'linux', 30, T0);
    expect(a.reached).toBe(false);
    const b = addStudySeconds(a.root, 'linux', 40, T0);
    expect(b.reached).toBe(true);
    expect(b.bonusXp).toBeGreaterThan(0);
    expect(dayComplete(b.root, dayKey(T0))).toBe(false); // falta Python
    // no repite el bono el mismo día
    const again = addStudySeconds(b.root, 'linux', 40, T0 + 1000);
    expect(again.bonusXp).toBe(0);
    const c = addStudySeconds(b.root, 'python', 61, T0);
    expect(c.dayDone).toBe(true);
    expect(goalStreak(c.root, T0).current).toBe(1);
    // días consecutivos
    let r2 = c.root;
    for (const n of [1, 2]) {
      r2 = addStudySeconds(r2, 'linux', 61, T0 + n * DAY).root;
      r2 = addStudySeconds(r2, 'python', 61, T0 + n * DAY).root;
    }
    expect(goalStreak(r2, T0 + 2 * DAY).current).toBe(3);
    // si hoy aún no está completo, la racha se mide desde ayer
    expect(goalStreak(r2, T0 + 3 * DAY).current).toBe(3);
    expect(goalStreak(r2, T0 + 4 * DAY).current).toBe(0);
  });

  test('migración desde el estado de un solo curso (v1)', () => {
    const v1 = {
      xp: 120,
      streak: { current: 2, best: 4, lastDay: '2026-03-13', freezes: 1 },
      dailyXp: {},
      lessons: { 'w1-1': { done: true, stars: 3, bestAccuracy: 1, plays: 1 } },
      challenges: {},
      exams: {},
      srs: {},
      achievements: { 'first-step': 1, 'world-w1': 2, 'streak-3': 3 },
      stats: { questions: 5 },
      settings: { name: 'Seb', onboarded: true },
      surprise: { lastShown: 0, scheduledUntil: 0 },
      daily: { day: '', done: false },
      sandbox: null,
      seenCommands: {},
    };
    const root = migrateRoot(v1);
    expect(root.courses.linux.lessons['w1-1'].done).toBe(true);
    expect(root.courses.python.lessons).toEqual({});
    expect(root.achievements['linux:first-step']).toBe(1);
    expect(root.achievements['linux:world-w1']).toBe(2);
    expect(root.achievements['streak-3']).toBe(3);
    expect(root.settings.name).toBe('Seb');
    expect(root.settings.goalMinutes).toEqual({ linux: 60, python: 60, sql: 60 });
    expect(root.settings.reminders.times.length).toBeGreaterThan(0);
    // idempotente
    expect(migrateRoot(root).courses.linux.lessons['w1-1'].done).toBe(true);
    expect(migrateRoot(undefined).active).toBe('linux');
  });
});
