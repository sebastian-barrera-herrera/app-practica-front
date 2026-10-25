import { mergeRoots } from '@/cloud/merge';
import { addCoins, balance, bumpAct, levelCoins, levelReward, owned } from '../economy';
import { BONUS_ID, claimMission, missionProgress, missionsFor, missionStates } from '../missions';
import { answer, finishLesson, initialState, recordExam, solveChallenge } from '../progress';
import { flat, initialRoot, unflat } from '../root';
import { MAX_SHIELDS, buy, canBuy, consumePass } from '../shop';
import { levelFromXp, levelProgress, levelRank, xpForLevel } from '../xp';

const NOW = new Date('2026-10-26T10:00:00').getTime();
const DAY = '2026-10-26';

describe('niveles', () => {
  test('cada nivel tiene rango e insignia, y el último se repite', () => {
    expect(levelRank(1).title).toBe('Novato');
    expect(levelRank(8).title).toBe('Arquitecto');
    expect(levelRank(12).title).toBe('Leyenda');
    expect(levelRank(40).title).toBe('Leyenda');
    expect(levelProgress(xpForLevel(8)).emoji).toBe(levelRank(8).emoji);
  });

  test('las recompensas de nivel se acumulan y no se guardan', () => {
    expect(levelReward(1)).toBe(0);
    expect(levelReward(2)).toBe(14);
    expect(levelCoins(1)).toBe(0);
    expect(levelCoins(8)).toBe(140);
    const ex = initialRoot().extras;
    expect(balance(xpForLevel(8), ex)).toBe(140);
    expect(balance(0, addCoins(ex, 25))).toBe(25);
  });
});

describe('misiones diarias', () => {
  test('siempre las mismas tres para el mismo día: una fácil, una media y una difícil, de tipos distintos', () => {
    const a = missionsFor(DAY);
    expect(missionsFor(DAY)).toEqual(a);
    expect(a.map((m) => m.tier)).toEqual([1, 2, 3]);
    expect(new Set(a.map((m) => m.kind)).size).toBe(3);
    expect(a.map((m) => m.coins)).toEqual([10, 15, 25]);
    const days = Array.from({ length: 40 }, (_, i) => missionsFor(`2026-11-${String((i % 28) + 1).padStart(2, '0')}`).map((m) => m.id).join());
    expect(new Set(days).size).toBeGreaterThan(5);
  });

  test('el progreso sale de lo que ya guarda el juego y se reclama una sola vez', () => {
    let root = initialRoot();
    const ms = missionsFor(DAY);
    // sin actividad no se puede reclamar
    expect(claimMission(root, ms[0].id, DAY).coins).toBe(0);
    // se simula un día muy completo
    const s0 = flat(root, 'linux');
    const lessons: Record<string, any> = {};
    for (let i = 0; i < 4; i++) lessons[`l${i}`] = { done: true, stars: 3, bestAccuracy: 1, plays: 1, completedAt: NOW };
    root = unflat(root, 'linux', { ...s0, lessons });
    root = { ...root, extras: bumpAct(root.extras, DAY, { q: 40, ok: 30, ch: 6, rv: 12 }), dailyXp: { [DAY]: 500 }, study: { ...root.study, linux: { [DAY]: 3000 } } };
    for (const m of ms) expect(missionProgress(root, m, DAY)).toBeGreaterThanOrEqual(m.target);
    let total = 0;
    for (const [i, m] of ms.entries()) {
      const r = claimMission(root, m.id, DAY);
      expect(r.coins).toBe(m.coins + (i === 2 ? 30 : 0)); // la tercera cobra además el bono del día
      total += r.coins;
      root = r.root;
      expect(claimMission(root, m.id, DAY).coins).toBe(0);
    }
    expect(total).toBe(10 + 15 + 25 + 30);
    expect(root.extras.coinsEarned).toBe(80);
    const st = missionStates(root, DAY);
    expect(st.allClaimed && st.bonusClaimed).toBe(true);
    expect(root.extras.claimed[DAY]).toContain(BONUS_ID);
  });
});

describe('monedas y XP', () => {
  test('terminar una lección da monedas según las estrellas, y repetirla casi nada', () => {
    const s = initialState();
    const r = { lessonId: 'l1', quizTotal: 5, quizFirstTry: 5, practices: 1, hintsUsed: 0 };
    const a = finishLesson(s, r, NOW);
    expect(a.stars).toBe(3);
    expect(a.coins).toBe(11);
    expect(a.state.extras.coinsEarned).toBe(11);
    const b = finishLesson(a.state, r, NOW + 1000);
    expect(b.coins).toBe(1);
  });

  test('el combo da XP extra y se recuerda el mejor', () => {
    const base = { lessonId: 'l1', quizTotal: 10, quizFirstTry: 10, practices: 0, hintsUsed: 0 };
    const plain = finishLesson(initialState(), base, NOW);
    const combo = finishLesson(initialState(), { ...base, combo: 10 }, NOW);
    expect(combo.xp.total - plain.xp.total).toBe(10);
    expect(combo.xp.parts.some((p) => p.label.includes('Combo ×10'))).toBe(true);
    expect(combo.state.extras.bestCombo).toBe(10);
  });

  test('con la poción de XP doble todo el XP vale el doble y se ve en el desglose', () => {
    const s0 = initialState();
    const s = { ...s0, extras: { ...s0.extras, boostUntil: NOW + 60000 } };
    const r = { lessonId: 'l1', quizTotal: 4, quizFirstTry: 4, practices: 0, hintsUsed: 0 };
    const plain = finishLesson(s0, r, NOW);
    const boosted = finishLesson(s, r, NOW);
    expect(boosted.xp.total).toBe(plain.xp.total * 2);
    expect(boosted.state.xp).toBe(plain.state.xp * 2);
    expect(boosted.xp.parts.some((p) => p.label.includes('XP doble'))).toBe(true);
    // caducada, ya no cuenta
    expect(finishLesson(s, r, NOW + 120000).xp.total).toBe(plain.xp.total);
  });

  test('responder y resolver retos alimenta la actividad del día; el reto da monedas una sola vez', () => {
    let s = initialState();
    s = answer(s, 'q1', true, NOW, { review: true });
    s = answer(s, 'q2', false, NOW);
    expect(s.extras.act[DAY]).toEqual({ q: 2, ok: 1, ch: 0, rv: 1 });
    s = solveChallenge(s, 'c1', 3, NOW);
    s = solveChallenge(s, 'c1', 2, NOW + 5);
    expect(s.extras.act[DAY].ch).toBe(1);
    expect(s.extras.coinsEarned).toBe(10);
  });

  test('aprobar un examen da monedas solo la primera vez (distintas según el tipo)', () => {
    let s = initialState();
    s = recordExam(s, 'exam-w1', 0.9, 0.7, NOW);
    s = recordExam(s, 'exam-w1', 0.95, 0.7, NOW);
    expect(s.extras.coinsEarned).toBe(30);
    s = recordExam(s, 'cert-basico', 0.9, 0.75, NOW);
    s = recordExam(s, 'skip-w4', 0.9, 0.85, NOW);
    expect(s.extras.coinsEarned).toBe(30 + 100 + 40);
    s = recordExam(s, 'exam-w2', 0.3, 0.7, NOW);
    expect(s.extras.coinsEarned).toBe(170);
  });
});

describe('tienda', () => {
  const rich = () => ({ ...initialRoot(), extras: addCoins(initialRoot().extras, 500) });

  test('sin monedas no se compra', () => {
    const r = initialRoot();
    expect(canBuy(r, 'shield').ok).toBe(false);
    expect(buy(r, 'shield', NOW).ok).toBe(false);
  });

  test('el escudo de racha suma uno y tiene un máximo', () => {
    let r = rich();
    const start = r.streak.freezes;
    for (let i = start; i < MAX_SHIELDS; i++) {
      const b = buy(r, 'shield', NOW);
      expect(b.ok).toBe(true);
      r = b.root;
    }
    expect(r.streak.freezes).toBe(MAX_SHIELDS);
    expect(buy(r, 'shield', NOW).ok).toBe(false);
    expect(balance(r.xp, r.extras)).toBe(500 - 80 * (MAX_SHIELDS - start));
  });

  test('la poción de XP doble se suma si ya está activa', () => {
    let r = buy(rich(), 'boost', NOW).root;
    expect(r.extras.boostUntil).toBe(NOW + 30 * 60 * 1000);
    r = buy(r, 'boost', NOW).root;
    expect(r.extras.boostUntil).toBe(NOW + 60 * 60 * 1000);
  });

  test('un pase sin espera se compra una vez y se gasta una vez', () => {
    let r = buy(rich(), 'pass', NOW).root;
    expect(owned(r.extras, 'pass')).toBe(1);
    const used = consumePass(r)!;
    expect(owned(used.extras, 'pass')).toBe(0);
    expect(consumePass(used)).toBeNull();
    r = used;
    expect(balance(r.xp, r.extras)).toBe(460);
  });
});

describe('sincronización de monedas', () => {
  test('dos copias se fusionan sin perder monedas, compras ni misiones reclamadas', () => {
    const a = initialRoot();
    const b = initialRoot();
    const ra = { ...a, extras: { ...a.extras, coinsEarned: 100, coinsSpent: 20, bought: { pass: 2 }, used: { pass: 1 }, claimed: { [DAY]: ['m1'] }, bestCombo: 6, boostUntil: 5 }, updatedAt: 10 };
    const rb = { ...b, extras: { ...b.extras, coinsEarned: 80, coinsSpent: 50, bought: { pass: 1 }, used: {}, claimed: { [DAY]: ['m2'] }, bestCombo: 9, boostUntil: 9 }, updatedAt: 20 };
    const m = mergeRoots(ra, rb);
    expect(m.extras.coinsEarned).toBe(100);
    expect(m.extras.coinsSpent).toBe(50);
    expect(m.extras.bought.pass).toBe(2);
    expect(m.extras.claimed[DAY].sort()).toEqual(['m1', 'm2']);
    expect(m.extras.bestCombo).toBe(9);
    expect(m.extras.boostUntil).toBe(9);
    expect(levelFromXp(0)).toBe(1);
  });
});
