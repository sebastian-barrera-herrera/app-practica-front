import { WORLDS, LEVELS } from '@/content';
import { addXp, finishLesson, initialState, lessonUnlocked, nextLesson, worldUnlocked, unlockAchievements, answer, recordExam, type Ctx } from '../progress';
import { emptyStreak, touchStreak, dayKey, streakAlive } from '../streak';
import { review, dueItems, mastery, INTERVALS, DAY } from '../srs';
import { levelFromXp, levelProgress, xpForLevel, starsFor, lessonXp } from '../xp';

import { blitzPool, dailyChallenge, learnedQuestions, reviewSession, shouldOfferSurprise, surpriseSession } from '../sessions';
import { certExam, worldExam } from '../exams';

const ctx: Ctx = { worlds: WORLDS, levels: LEVELS };
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
    const r = finishLesson(s, { lessonId: 'w1-1', quizTotal: 6, quizFirstTry: 6, practices: 2, hintsUsed: 0 }, T0, ctx);
    expect(r.stars).toBe(3);
    expect(r.xp.total).toBeGreaterThan(40);
    expect(r.state.lessons['w1-1'].done).toBe(true);
    expect(lessonUnlocked(r.state, WORLDS, 0, 1)).toBe(true);
    expect(r.newAchievements.map((a) => a.id)).toEqual(expect.arrayContaining(['first-step', 'perfect']));
    expect(r.state.streak.current).toBe(1);
    expect(nextLesson(r.state, WORLDS)?.lessonIndex).toBe(1);
    // repetir da menos xp
    const again = finishLesson(r.state, { lessonId: 'w1-1', quizTotal: 6, quizFirstTry: 6, practices: 2, hintsUsed: 0 }, T0 + 1000, ctx);
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
    const u = unlockAchievements(s, T0, ctx);
    expect(u.unlocked.map((a) => a.id)).toContain('exam-pass');
    const x = addXp(s, 120, T0);
    expect(x.levelUp).toBe(2);
  });
});

describe('sesiones', () => {
  test('repaso, sorpresa, blitz, diario', () => {
    let s = initialState();
    const base = learnedQuestions(s);
    expect(base.length).toBeGreaterThan(0);
    const r0 = reviewSession(s, T0);
    expect(r0.items.length).toBeGreaterThan(0);
    expect(r0.fresh).toBe(true);
    s = answer(s, base[0].id, false, T0);
    s = answer(s, base[1].id, false, T0);
    s = answer(s, base[2].id, false, T0);
    const r1 = reviewSession(s, T0 + 3600000);
    expect(r1.fresh).toBe(false);
    expect(r1.due).toBe(3);
    expect(surpriseSession(s, T0).length).toBe(5);
    expect(blitzPool(s, 'all').length).toBeGreaterThan(5);
    const d = dailyChallenge(s, T0);
    expect(d.challenge.id).toBeTruthy();
    expect(dailyChallenge(s, T0).challenge.id).toBe(d.challenge.id);
    expect(shouldOfferSurprise(s, T0)).toBe(false);
  });

  test('exámenes', () => {
    const w = WORLDS[0];
    const e = worldExam(w, 'x');
    expect(e.questions.length).toBeGreaterThan(5);
    expect(e.challenges.length).toBe(1);
    const c = certExam('basico', 'x');
    expect(c.questions.length).toBeGreaterThan(8);
    expect(c.id).toBe('cert-basico');
  });
});
