import { evaluate } from '@/engine/check';
import { Terminal } from '@/engine/terminal';
import { AWS_REFERENCE, awsRefByName } from '../aws/reference';
import { COURSES, allChallenges } from '../index';
import type { Question } from '../types';

const WORLDS = COURSES.aws.worlds;

declare const __dirname: string;
declare const require: (m: string) => any;

const mkTerm = (setup: any = {}) => new Terminal({ instant: true, cols: 100, ...setup });

/** Ejecuta la solución línea a línea (los comandos interactivos reciben las siguientes líneas como entrada). */
async function runSolution(term: Terminal, steps: string[]) {
  const pending: Promise<unknown>[] = [];
  for (const s of steps) {
    const r = term.exec(s);
    pending.push(r);
    for (let k = 0; k < 3000; k++) {
      await new Promise((res) => setTimeout(res, 1));
      if (!term.busy || term.awaitingInput) break;
    }
  }
  await Promise.all(pending);
}

describe('estructura del curso de AWS', () => {
  test('ids únicos, lecciones completas y fichas para cada tema', () => {
    const ids = new Set<string>();
    for (const w of WORLDS) {
      expect(w.course).toBe('aws');
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
      expect(w.lessons).toHaveLength(5);
      expect(w.boss).toBeTruthy();
      for (const l of w.lessons) {
        expect(ids.has(l.id)).toBe(false);
        ids.add(l.id);
        expect(l.steps.length).toBeGreaterThanOrEqual(8);
        expect(l.steps.some((s) => s.type === 'practice')).toBe(true);
        expect(l.steps.filter((s) => s.type === 'quiz').length).toBeGreaterThanOrEqual(3);
        expect(l.commands.length).toBeGreaterThan(0);
        for (const c of l.commands) {
          if (!awsRefByName(c)) throw new Error(`${l.id}: falta la ficha «${c}» en la biblioteca`);
        }
      }
    }
  });

  test('las ilustraciones usadas están implementadas', () => {
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../../illustrations/index.tsx'), 'utf8');
    for (const w of WORLDS) for (const l of w.lessons) for (const st of l.steps) if (st.type === 'illustration') expect(src).toMatch(new RegExp(`['"]?${st.id}['"]?:`));
  });
});

describe('retos de AWS', () => {
  const all = allChallenges('aws');
  test.each(all.map((x) => [x.challenge.id, x]))('%s: la solución completa el reto', async (_id, x: any) => {
    const ch = x.challenge;
    const term = mkTerm(ch.setup);
    if (ch.expectInitialFail !== false) {
      const before = evaluate(ch.check, term);
      if (before.ok) throw new Error(`${ch.id}: el reto ya está cumplido antes de empezar`);
    }
    await runSolution(term, ch.solution);
    const r = evaluate(ch.check, term);
    if (!r.ok) throw new Error(`${ch.id}: ${r.why}\nÚltima salida: ${JSON.stringify(term.last)}`);
    expect(ch.hints.length).toBeGreaterThanOrEqual(1);
    expect(ch.explain.length).toBeGreaterThan(10);
    // ninguna orden de la solución puede fallar (salvo que el reto lo busque)
    for (const run of term.runs) if (run.status !== 0 && !/^(cat|ls)\b/.test(run.line)) throw new Error(`${ch.id}: «${run.line}» terminó con ${run.status}: ${run.stderr.slice(0, 200)}`);
  });
});

describe('demos de AWS', () => {
  const demos: { id: string; step: any }[] = [];
  for (const w of WORLDS) for (const l of w.lessons) l.steps.forEach((s, i) => s.type === 'demo' && demos.push({ id: `${l.id}#${i}`, step: s }));
  test.each(demos.map((d) => [d.id, d]))('%s: todas las líneas funcionan', async (_id, d: any) => {
    const term = mkTerm(d.step.setup);
    for (const line of d.step.lines) {
      const r = await term.exec(line.cmd);
      if (line.error) expect(r.status).not.toBe(0);
      else if (r.status !== 0) throw new Error(`«${line.cmd}» terminó con ${r.status}: ${r.err}`);
    }
  });
});

describe('preguntas de AWS', () => {
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
        expect(q.answers.length).toBeGreaterThan(1);
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
        expect(new Set(q.pairs.map((p) => p[1])).size).toBe(q.pairs.length);
        break;
      case 'cmd': {
        expect(q.answers.length).toBeGreaterThan(0);
        if (q.check) {
          // la respuesta de referencia debe cumplir la comprobación
          const term = mkTerm(q.setup);
          expect(evaluate(q.check, term).ok).toBe(false);
          await runSolution(term, [q.answers[0]]);
          const r = evaluate(q.check, term);
          if (!r.ok) throw new Error(`${r.why} :: ${JSON.stringify(term.last)}`);
        }
        break;
      }
      case 'output': {
        const term = mkTerm(q.setup);
        const r = await term.exec(q.cmd);
        const correct = r.text.trimEnd();
        expect(r.status).toBe(0);
        expect(correct.length).toBeGreaterThan(0);
        for (const w of q.wrong) expect(w.trimEnd()).not.toBe(correct);
        break;
      }
    }
    expect(q.why.length).toBeGreaterThan(5);
  });
});

describe('biblioteca de AWS', () => {
  test('nombres únicos y ejemplos que funcionan', async () => {
    const seen = new Set<string>();
    for (const r of AWS_REFERENCE) {
      expect(seen.has(r.name)).toBe(false);
      seen.add(r.name);
      expect(r.summary.length).toBeGreaterThan(10);
      for (const s of r.seeAlso ?? []) if (!awsRefByName(s)) throw new Error(`${r.name}: «${s}» no existe`);
      const term = r.examples?.length ? mkTerm({ aws: r.scenario ?? 'base', packages: ['zip', 'unzip'] }) : null;
      for (const [cmd, , kind] of r.examples ?? []) {
        const res = await term!.exec(cmd);
        if (kind === 'error') {
          if (res.status === 0) throw new Error(`${r.name}: «${cmd}» debería fallar`);
        } else if (res.status !== 0) throw new Error(`${r.name}: «${cmd}» falló: ${res.err}`);
      }
    }
  });
});
