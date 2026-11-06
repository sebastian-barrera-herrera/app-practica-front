/**
 * Compara el contenido de un curso (demos, «¿qué imprime?» y comprobaciones de retos) ejecutado con el intérprete
 * propio frente a CPython real (python3 con numpy/pandas/scikit-learn instalados).
 *
 *   bun src/pyengine/__tests__/tools/contentdiff.ts ia ia8            # una zona
 *   bun src/pyengine/__tests__/tools/contentdiff.ts ia ia8-3 --show   # una lección, enseñando también lo que coincide
 *
 * Sale con código 1 si hay discrepancias. Sirve para comprobar que lo que la lección AFIRMA (cifras, formas, salidas)
 * es lo que Python de verdad imprime, no solo lo que imprime el motor.
 */
import { PySession } from '../../index';
import { COURSES } from '../../../content';
import type { PyCheck } from '../../types';

declare const require: (m: string) => any;
declare const process: { argv: string[]; exit: (n: number) => never };
const { mkdtempSync, writeFileSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');
const { tmpdir } = require('os');
const { spawnSync } = require('child_process');

const [, , courseArg = 'ia', filter = '', ...flags] = process.argv;
const show = flags.includes('--show');
const course = COURSES[courseArg as keyof typeof COURSES];
if (!course) throw new Error('curso desconocido: ' + courseArg);

interface Setup {
  files?: Record<string, string>;
  stdin?: string[];
}

const real = (code: string, setup?: Setup): { out: string; err: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'cdiff-'));
  for (const [p, c] of Object.entries(setup?.files ?? {})) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  writeFileSync(join(dir, 'main.py'), code);
  const r = spawnSync('python3', ['main.py'], { cwd: dir, encoding: 'utf8', input: (setup?.stdin ?? []).join('\n'), timeout: 120000 });
  return { out: r.stdout ?? '', err: r.stderr ?? '' };
};

const mine = async (code: string, setup?: Setup): Promise<{ out: string; err: string }> => {
  const s = new PySession(setup as any);
  const r = await s.run(code, { mode: 'exec', filename: 'main.py' });
  return { out: r.stdout, err: r.stderr };
};

/** Expresión de Python que vale True cuando se cumple la comprobación (null si no se puede expresar así). */
const checkExpr = (c: PyCheck): string | null => {
  switch (c.t) {
    case 'var':
      return `(${c.name}) == (${c.equals})`;
    case 'expr':
      return `(${c.expr}) == (${c.equals})`;
    case 'true':
      return `bool(${c.expr})`;
    case 'all': {
      const parts = c.checks.map(checkExpr);
      return parts.some((p) => p === null) ? null : parts.map((p) => `(${p})`).join(' and ');
    }
    default:
      return null;
  }
};

const norm = (s: string): string => s.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');

let bad = 0;
let checked = 0;
const report = (where: string, what: string, a: string, b: string) => {
  bad++;
  console.log(`\n✗ ${where} · ${what}\n--- CPython\n${a}\n--- motor\n${b}`);
};

(async () => {
  for (const w of course.worlds) {
    if (filter && !w.id.startsWith(filter) && !filter.startsWith(w.id)) continue;
    const jobs: { lessonId: string; step: any; idx: number }[] = [];
    for (const l of w.lessons) {
      if (filter && filter.includes('-') && !l.id.startsWith(filter)) continue;
      l.steps.forEach((step, idx) => jobs.push({ lessonId: l.id, step, idx }));
    }
    if (w.boss && (!filter || !filter.includes('-'))) jobs.push({ lessonId: w.id + '-boss', step: { type: 'pypractice', challenge: w.boss }, idx: 0 });
    for (const { lessonId, step, idx } of jobs) {
      const where = `${lessonId} paso ${idx + 1}`;
      if (step.type === 'pydemo') {
        const cells = step.cells.filter((c: any) => !c.repl);
        const code = cells.map((c: any, i: number) => `${c.code}\nprint("<<<CELDA ${i}>>>")`).join('\n');
        const [a, b] = [real(code, step.setup), await mine(code, step.setup)];
        checked++;
        const hasErr = cells.some((c: any) => c.error);
        if (!hasErr && (norm(a.out) !== norm(b.out) || a.err.trim() !== '' && b.err.trim() === '')) report(where, `demo «${step.title}»`, a.out + (a.err ? '\n[stderr] ' + a.err.split('\n').slice(-3).join('\n') : ''), b.out + (b.err ? '\n[stderr] ' + b.err.split('\n').slice(-3).join('\n') : ''));
        else if (show) console.log(`✓ ${where} demo «${step.title}»\n${a.out}`);
      } else if (step.type === 'quiz' && step.q.t === 'pyout') {
        const [a, b] = [real(step.q.code, step.q.setup), await mine(step.q.code, step.q.setup)];
        checked++;
        if (norm(a.out) !== norm(b.out)) report(where, 'pyOut', a.out, b.out);
        else if (show) console.log(`✓ ${where} pyOut → ${JSON.stringify(a.out.trim())}`);
      } else if (step.type === 'pypractice' || (step.type === 'quiz' && step.q.t === 'pycode')) {
        const ch = step.type === 'pypractice' ? step.challenge : step.q;
        const e = checkExpr(ch.check);
        if (e === null) continue;
        const code = `${ch.solution}\nprint("@@RESULT", ${e})`;
        const [a, b] = [real(code, ch.setup), await mine(code, ch.setup)];
        checked++;
        const ra = a.out.split('\n').find((l) => l.startsWith('@@RESULT')) ?? `(sin resultado) ${a.err.split('\n').slice(-3).join(' | ')}`;
        const rb = b.out.split('\n').find((l) => l.startsWith('@@RESULT')) ?? `(sin resultado) ${b.err.split('\n').slice(-3).join(' | ')}`;
        if (ra !== '@@RESULT True' || rb !== '@@RESULT True') report(where, `reto «${ch.goal ?? ch.q}»`, ra, rb);
        else if (show) console.log(`✓ ${where} reto «${ch.goal ?? ''}»`);
      }
    }
  }
  console.log(`\n${checked - bad}/${checked} comprobaciones coinciden con CPython`);
  process.exit(bad ? 1 : 0);
})();
