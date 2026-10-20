/**
 * Validación AUTOMÁTICA del curso de Python: cada solución de referencia se ejecuta con el intérprete y debe
 * superar su comprobación; cada pregunta es coherente; cada demo se ejecuta como se muestra.
 */
import { pyEngine } from '@/lib/pyrun';
import { splitReplChunks } from '@/lib/pyrepl';
import { PY_REFERENCE } from '../py/reference';
import { COURSES, allChallenges } from '../index';
import type { PyChallenge, Question } from '../types';

const PY = COURSES.python;

const run = async (code: string, setup?: PyChallenge['setup']) => {
  const s = new (pyEngine().PySession)(setup);
  const result = await s.run(code, { mode: 'exec', filename: 'main.py' });
  return { s, result };
};

const none = PY.worlds.length === 0;

describe('curso de Python: estructura', () => {
  if (none) {
    test.skip('sin contenido todavía', () => {});
    return;
  }
  test('ids con prefijo py, zonas completas y niveles válidos', () => {
    for (const w of PY.worlds) {
      expect(w.id).toMatch(/^py\d+$/);
      expect(w.course).toBe('python');
      expect(w.lessons.length).toBeGreaterThanOrEqual(4);
      expect(w.boss).toBeTruthy();
      for (const l of w.lessons) {
        expect(l.id.startsWith(w.id + '-')).toBe(true);
        expect(l.steps.length).toBeGreaterThanOrEqual(7);
        expect(l.steps.some((s) => s.type === 'pypractice')).toBe(true);
        expect(l.steps.some((s) => s.type === 'practice')).toBe(false);
        expect(l.steps.filter((s) => s.type === 'quiz').length).toBeGreaterThanOrEqual(3);
        expect(l.steps.some((s) => s.type === 'learn')).toBe(true);
        expect(l.commands.length).toBeGreaterThan(0);
      }
    }
  });

  test('los niveles tienen contenido y se reparten bien', () => {
    for (const lv of ['basico', 'intermedio', 'avanzado'] as const) expect(PY.worlds.some((w) => w.level === lv)).toBe(true);
  });

  test('toda ficha mencionada en `commands` existe en la biblioteca', () => {
    const names = new Set(PY_REFERENCE.map((r) => r.name));
    const missing: string[] = [];
    for (const w of PY.worlds) for (const l of w.lessons) for (const c of l.commands) if (!names.has(c)) missing.push(`${l.id}: ${c}`);
    expect(missing).toEqual([]);
  });
});

describe('curso de Python: retos de código', () => {
  const all = allChallenges('python').map((x) => [x.challenge.id, x.challenge as PyChallenge] as const);
  if (!all.length) {
    test.skip('sin retos todavía', () => {});
    return;
  }
  test.each(all)('%s: la solución completa el reto y el código inicial no', async (_id, ch) => {
    expect(ch.lang).toBe('py');
    const { s, result } = await run(ch.solution, ch.setup);
    expect(result.timedOut).toBeFalsy();
    const r = pyEngine().evaluate(ch.check, { session: s, code: ch.solution });
    if (!r.ok) throw new Error(`${ch.id}: ${r.why}\nstdout=${JSON.stringify(result.stdout)}\nstderr=${result.stderr}`);
    if (ch.expectInitialFail !== false) {
      const start = await run(ch.starter ?? '', ch.setup);
      const r0 = pyEngine().evaluate(ch.check, { session: start.s, code: ch.starter ?? '' });
      if (r0.ok) throw new Error(`${ch.id}: el reto ya está resuelto con el código inicial`);
    }
    expect(ch.hints.length).toBeGreaterThanOrEqual(1);
    expect(ch.explain.length).toBeGreaterThan(10);
    expect(ch.prompt.length).toBeGreaterThan(20);
    // determinismo
    const again = await run(ch.solution, ch.setup);
    expect(again.result.stdout).toBe(result.stdout);
  });
});

describe('curso de Python: preguntas', () => {
  const qs: { id: string; q: Question }[] = [];
  for (const w of PY.worlds)
    for (const l of w.lessons)
      l.steps.forEach((st, i) => {
        if (st.type === 'quiz') qs.push({ id: `${l.id}#${i}`, q: st.q });
      });
  if (!qs.length) {
    test.skip('sin preguntas todavía', () => {});
    return;
  }
  test.each(qs.map((x) => [x.id, x.q] as const))('%s es consistente', async (_id, q) => {
    switch (q.t) {
      case 'mc':
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(new Set(q.options).size).toBe(q.options.length);
        break;
      case 'multi':
        expect(q.answers.every((a) => a >= 0 && a < q.options.length)).toBe(true);
        expect(new Set(q.options).size).toBe(q.options.length);
        break;
      case 'fill':
        expect((q.template.match(/___/g) ?? []).length).toBe(q.answers.length);
        for (const a of q.answers) expect(q.options).toContain(a);
        break;
      case 'order':
        expect([...q.answer.split(' ')].sort()).toEqual([...q.pieces].sort());
        break;
      case 'match':
        expect(q.pairs.length).toBeGreaterThanOrEqual(3);
        expect(new Set(q.pairs.map((p) => p[0])).size).toBe(q.pairs.length);
        break;
      case 'pyout': {
        const { result } = await run(q.code, q.setup);
        const correct = result.stdout.trimEnd();
        expect(result.timedOut).toBeFalsy();
        expect(correct.length).toBeGreaterThan(0);
        expect(q.wrong.length).toBeGreaterThanOrEqual(2);
        for (const w of q.wrong) expect(w.trimEnd()).not.toBe(correct);
        expect(new Set(q.wrong.map((w) => w.trimEnd())).size).toBe(q.wrong.length);
        break;
      }
      case 'pycode': {
        const { s, result } = await run(q.solution, q.setup);
        const r = pyEngine().evaluate(q.check, { session: s, code: q.solution });
        if (!r.ok) throw new Error(`${r.why}\nstdout=${JSON.stringify(result.stdout)}\nstderr=${result.stderr}`);
        if (q.starter !== undefined) {
          const start = await run(q.starter, q.setup);
          expect(pyEngine().evaluate(q.check, { session: start.s, code: q.starter }).ok).toBe(false);
        }
        break;
      }
      case 'cmd':
      case 'output':
        throw new Error('Los tipos «cmd» y «output» son de Linux; en Python usa pycode y pyout');
    }
    expect(q.why.length).toBeGreaterThan(5);
  });
});

describe('curso de Python: demostraciones', () => {
  const demos: { id: string; step: Extract<import('../types').Step, { type: 'pydemo' }> }[] = [];
  for (const w of PY.worlds)
    for (const l of w.lessons)
      l.steps.forEach((st, i) => {
        if (st.type === 'pydemo') demos.push({ id: `${l.id}#${i}`, step: st });
      });
  if (!demos.length) {
    test.skip('sin demos todavía', () => {});
    return;
  }
  test.each(demos.map((d) => [d.id, d.step] as const))('%s se ejecuta como se muestra', async (_id, step) => {
    const eng = pyEngine();
    const s = new eng.PySession(step.setup);
    for (const [i, cell] of step.cells.entries()) {
      let ok = true;
      if (cell.repl) {
        for (const chunk of splitReplChunks(cell.code, eng.isIncomplete)) {
          const r = await s.run(chunk + '\n', { mode: 'repl' });
          if (!r.ok) ok = false;
        }
      } else {
        ok = (await s.run(cell.code, { mode: 'exec', filename: 'demo.py' })).ok;
      }
      if (cell.error) expect({ cell: i, ok }).toEqual({ cell: i, ok: false });
      else expect({ cell: i, ok, err: ok ? '' : s.last()?.stderr }).toEqual({ cell: i, ok: true, err: '' });
    }
  });
});
