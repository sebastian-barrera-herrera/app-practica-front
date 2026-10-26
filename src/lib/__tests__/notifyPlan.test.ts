import { finishLesson } from '@/game/progress';
import { addStudySeconds, initialRoot, withCourse, type RootState } from '@/game/root';
import { planNotifications } from '../notifyPlan';

// sábado 14 de marzo de 2026, 09:00 (hora local)
const NOW = new Date(2026, 2, 14, 9, 0, 0).getTime();
const DAY = 86400000;

function base(over: Partial<RootState['settings']> = {}): RootState {
  const r = initialRoot();
  return { ...r, settings: { ...r.settings, name: 'Seb', ...over, reminders: { ...r.settings.reminders, ...(over.reminders ?? {}) } } };
}
const withLesson = (r: RootState, course: 'linux' | 'python') =>
  withCourse(r, course, (s) => finishLesson(s, { lessonId: `${course}-x`, quizTotal: 1, quizFirstTry: 1, practices: 0, hintsUsed: 0 }, NOW - DAY)).root;

describe('plan de notificaciones', () => {
  test('recordatorios diarios a las horas elegidas, en el futuro y ordenados', () => {
    const plan = planNotifications(base({ surpriseEnabled: false, reminders: { ...base().settings.reminders, comeback: false, times: ['08:00', '19:30'] } }), NOW);
    const rem = plan.filter((p) => p.kind === 'reminder');
    // hoy 08:00 ya pasó ⇒ hoy solo 19:30; 9 días más con dos avisos
    expect(rem.length).toBe(1 + 9 * 2);
    expect(rem[0].at).toBe(new Date(2026, 2, 14, 19, 30).getTime());
    expect(rem.every((p) => p.at > NOW)).toBe(true);
    expect([...rem].sort((a, b) => a.at - b.at)).toEqual(rem);
    expect(rem[0].title).toContain('Seb');
    expect(rem[0].route).toMatch(/^\/go\/(linux|python)$/);
  });

  test('respeta los días de la semana', () => {
    const days = [false, false, false, false, false, false, true]; // solo sábados
    const plan = planNotifications(base({ surpriseEnabled: false, reminders: { ...base().settings.reminders, days, comeback: false, times: ['20:00'] } }), NOW);
    const rem = plan.filter((p) => p.kind === 'reminder');
    expect(rem.length).toBe(2); // hoy y el sábado siguiente (dentro de 10 días)
    expect(rem.every((p) => new Date(p.at).getDay() === 6)).toBe(true);
  });

  test('si hoy ya cumpliste todas las metas, hoy no se avisa', () => {
    let r = base({ surpriseEnabled: false, goalMinutes: { linux: 1, python: 1, sql: 1, aws: 1 }, reminders: { ...base().settings.reminders, comeback: false, times: ['19:30'] } });
    r = addStudySeconds(r, 'linux', 90, NOW).root;
    r = addStudySeconds(r, 'python', 90, NOW).root;
    const rem = planNotifications(r, NOW).filter((p) => p.kind === 'reminder');
    expect(rem.some((p) => p.day === '2026-03-14')).toBe(false);
    expect(rem.length).toBe(9);
    // con la opción desactivada, sí avisa
    const r2 = { ...r, settings: { ...r.settings, reminders: { ...r.settings.reminders, skipIfDone: false } } };
    expect(planNotifications(r2, NOW).filter((p) => p.kind === 'reminder').length).toBe(10);
  });

  test('los exámenes sorpresa solo se programan para cursos con lecciones hechas y son estables', () => {
    const none = planNotifications(base({ surpriseEnabled: true, surprisePerWeek: 4, reminders: { ...base().settings.reminders, enabled: false } }), NOW);
    expect(none.filter((p) => p.kind === 'surprise')).toHaveLength(0);
    const r = withLesson(base({ surpriseEnabled: true, surprisePerWeek: 4, windowStart: 10, windowEnd: 21, reminders: { ...base().settings.reminders, enabled: false } }), 'python');
    const a = planNotifications(r, NOW).filter((p) => p.kind === 'surprise');
    const b = planNotifications(r, NOW + 3600_000).filter((p) => p.kind === 'surprise');
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.every((p) => p.course === 'python' && p.route === '/session/surprise?course=python')).toBe(true);
    for (const p of a) {
      const h = new Date(p.at).getHours();
      expect(h).toBeGreaterThanOrEqual(10);
      expect(h).toBeLessThan(21);
    }
    // reprogramar una hora después mantiene las mismas horas (salvo las ya pasadas)
    const keysB = new Set(b.map((p) => p.key));
    expect(a.filter((p) => p.at > NOW + 3600_000).every((p) => keysB.has(p.key))).toBe(true);
  });

  test('avisa de la racha en peligro y nunca deja avisos pegados', () => {
    let r = base({ surpriseEnabled: true, surprisePerWeek: 7 });
    r = withLesson(r, 'linux');
    r = { ...r, streak: { current: 5, best: 5, lastDay: '2026-03-13', freezes: 1 } };
    const plan = planNotifications(r, NOW);
    expect(plan.some((p) => p.kind === 'streak')).toBe(true);
    for (let i = 1; i < plan.length; i++) expect(plan[i].at - plan[i - 1].at).toBeGreaterThanOrEqual(20 * 60_000);
    expect(plan.length).toBeLessThanOrEqual(56);
  });

  test('sin recordatorios ni sorpresas no hay nada que programar', () => {
    const plan = planNotifications(base({ surpriseEnabled: false, reminders: { ...base().settings.reminders, enabled: false } }), NOW);
    expect(plan).toHaveLength(0);
  });
});
