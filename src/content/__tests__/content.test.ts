import { evaluate } from '@/engine/check';
import { REGISTRY } from '@/engine/registry';
import { Terminal } from '@/engine/terminal';
import { WORLDS, allChallenges } from '../index';
import type { Question } from '../types';

declare const __dirname: string;
declare const require: (m: string) => any;

function mkTerm(setup: any = {}) {
  return new Terminal({ instant: true, cols: 80, ...setup });
}

async function runSolution(term: Terminal, steps: string[]) {
  const pending: Promise<unknown>[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s === '^C' || s === '^Z' || s === '^D') continue;
    const next = steps[i + 1];
    if (next === '^C' || next === '^Z') {
      term.rt.timeScale = 0.01;
      const p = term.exec(s);
      await new Promise((r) => setTimeout(r, 40));
      term.signal(next === '^C' ? 'INT' : 'TSTP');
      await p;
      term.rt.timeScale = 0;
    } else if (next === '^D') {
      const p = term.exec(s);
      await new Promise((r) => setTimeout(r, 20));
      term.signal('EOF');
      await p;
    } else {
      // Si el comando queda esperando entrada (ssh, passwd, ssh-keygen…), las siguientes líneas se le entregan.
      const r = term.exec(s);
      pending.push(r);
      for (let k = 0; k < 3000; k++) {
        await new Promise((res) => setTimeout(res, 1));
        if (!term.busy || term.awaitingInput) break;
      }
    }
  }
  await Promise.all(pending);
}

describe('ilustraciones', () => {
  test('todas las ilustraciones usadas en las lecciones están implementadas', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../../illustrations/index.tsx'), 'utf8');
    const used = new Set<string>();
    for (const w of WORLDS) for (const l of w.lessons) for (const st of l.steps) if (st.type === 'illustration') used.add(st.id);
    for (const id of used) expect(src).toMatch(new RegExp(`['"]?${id}['"]?:`));
    expect(used.size).toBeGreaterThanOrEqual(20);
  });
});

describe('estructura del contenido', () => {
  test('ids únicos y metadatos válidos', () => {
    const ids = new Set<string>();
    for (const w of WORLDS) {
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
      expect(w.lessons.length).toBeGreaterThan(0);
      for (const l of w.lessons) {
        expect(ids.has(l.id)).toBe(false);
        ids.add(l.id);
        expect(l.steps.length).toBeGreaterThanOrEqual(6);
        expect(l.steps.some((s) => s.type === 'practice')).toBe(true);
        expect(l.steps.filter((s) => s.type === 'quiz').length).toBeGreaterThanOrEqual(2);
        for (const c of l.commands) expect(REGISTRY.has(c)).toBe(true);
      }
    }
  });
});

describe('retos de terminal', () => {
  const all = allChallenges();
  test.each(all.map((x) => [x.challenge.id, x]))('%s: la solución completa el reto', async (_id, x: any) => {
    const ch = x.challenge;
    const term = mkTerm(ch.setup);
    if (ch.expectInitialFail !== false) {
      expect(evaluate(ch.check, term).ok).toBe(false);
    }
    await runSolution(term, ch.solution);
    const r = evaluate(ch.check, term);
    if (!r.ok) throw new Error(`${ch.id}: ${r.why}\nÚltima salida: ${JSON.stringify(term.last)}`);
    expect(ch.hints.length).toBeGreaterThanOrEqual(1);
    expect(ch.explain.length).toBeGreaterThan(10);
  });
});

describe('preguntas', () => {
  const qs: { id: string; q: Question }[] = [];
  for (const w of WORLDS)
    for (const l of w.lessons)
      l.steps.forEach((s, i) => {
        if (s.type === 'quiz') qs.push({ id: `${l.id}#${i}`, q: s.q });
      });
  test.each(qs.map((x) => [x.id, x]))('%s es consistente', async (_id, x: any) => {
    const q: Question = x.q;
    switch (q.t) {
      case 'mc':
        expect(q.answer).toBeGreaterThanOrEqual(0);
        expect(q.answer).toBeLessThan(q.options.length);
        expect(new Set(q.options).size).toBe(q.options.length);
        break;
      case 'multi':
        expect(q.answers.every((a) => a >= 0 && a < q.options.length)).toBe(true);
        break;
      case 'fill': {
        expect((q.template.match(/___/g) ?? []).length).toBe(q.answers.length);
        for (const a of q.answers) expect(q.options).toContain(a);
        break;
      }
      case 'order': {
        const toks = q.answer.split(' ');
        expect([...toks].sort()).toEqual([...q.pieces].sort());
        break;
      }
      case 'match':
        expect(q.pairs.length).toBeGreaterThanOrEqual(3);
        expect(new Set(q.pairs.map((p) => p[0])).size).toBe(q.pairs.length);
        break;
      case 'cmd':
        expect(q.answers.length).toBeGreaterThan(0);
        break;
      case 'output': {
        const term = mkTerm(q.setup);
        const r = await term.exec(q.cmd);
        const correct = r.text.trimEnd();
        expect(correct.length).toBeGreaterThan(0);
        for (const w of q.wrong) expect(w.trimEnd()).not.toBe(correct);
        break;
      }
    }
    expect(q.why.length).toBeGreaterThan(5);
  });
});
