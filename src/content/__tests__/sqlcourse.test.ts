/**
 * Validación AUTOMÁTICA del curso de SQL: cada demo se ejecuta como se muestra, cada solución de referencia supera su
 * corrección, el código inicial no resuelve el reto, las opciones de «¿qué devuelve?» son coherentes y todo ejemplo
 * de la biblioteca y del laboratorio funciona.
 */
import { newSqlSession, sqlEngine, sqlJudge } from '@/lib/sqlrun';
import { DATASETS } from '../sql/datasets';
import { SQL_SAMPLES } from '../sql/samples';
import { SQL_REFERENCE } from '../sql/reference';
import { COURSES, allChallenges } from '../index';
import type { Question, SqlChallenge } from '../types';

declare const __dirname: string;
declare const require: (m: string) => any;

const SQL = COURSES.sql;
const none = SQL.worlds.length === 0;
const SLOW_MS = 2500;

describe('curso de SQL: estructura', () => {
  if (none) {
    test.skip('sin contenido todavía', () => {});
    return;
  }
  test('ids con prefijo s, zonas completas y niveles válidos', () => {
    for (const w of SQL.worlds) {
      expect(w.id).toMatch(/^s\d+$/);
      expect(w.course).toBe('sql');
      expect(w.lessons.length).toBeGreaterThanOrEqual(4);
      expect(w.boss).toBeTruthy();
      expect(w.intro.length).toBeGreaterThan(80);
      for (const l of w.lessons) {
        expect(l.id.startsWith(w.id + '-')).toBe(true);
        expect(l.steps.length).toBeGreaterThanOrEqual(8);
        expect(l.steps.some((s) => s.type === 'sqlpractice')).toBe(true);
        expect(l.steps.some((s) => s.type === 'sqldemo')).toBe(true);
        expect(l.steps.some((s) => s.type === 'practice' || s.type === 'pypractice')).toBe(false);
        expect(l.steps.filter((s) => s.type === 'quiz').length).toBeGreaterThanOrEqual(3);
        expect(l.steps.some((s) => s.type === 'learn')).toBe(true);
        expect(l.commands.length).toBeGreaterThan(0);
      }
    }
  });

  test('ids únicos y zonas consecutivas', () => {
    const ids = new Set<string>();
    SQL.worlds.forEach((w, i) => {
      expect(w.index).toBe(i + 1);
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
      for (const l of w.lessons) {
        expect(ids.has(l.id)).toBe(false);
        ids.add(l.id);
      }
    });
  });

  test('los niveles tienen contenido y van en orden', () => {
    const order = ['basico', 'intermedio', 'avanzado'];
    let last = 0;
    for (const w of SQL.worlds) {
      const i = order.indexOf(w.level);
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
    for (const lv of order) expect(SQL.worlds.some((w) => w.level === lv)).toBe(true);
  });

  test('toda ficha mencionada en `commands` existe en la biblioteca', () => {
    const names = new Set(SQL_REFERENCE.map((r) => r.name));
    const missing: string[] = [];
    for (const w of SQL.worlds) for (const l of w.lessons) for (const c of l.commands) if (!names.has(c)) missing.push(`${l.id}: ${c}`);
    expect(missing).toEqual([]);
  });

  test('las ilustraciones usadas están implementadas', () => {
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../../illustrations/index.tsx'), 'utf8');
    for (const w of SQL.worlds) for (const l of w.lessons) for (const st of l.steps) if (st.type === 'illustration') expect(src).toMatch(new RegExp(`['"]?${st.id}['"]?:`));
  });
});

describe('curso de SQL: demos', () => {
  const demos: [string, (typeof SQL.lessons)[number]['steps'][number] & { type: 'sqldemo' }][] = [];
  for (const w of SQL.worlds)
    for (const l of w.lessons)
      l.steps.forEach((st, i) => {
        if (st.type === 'sqldemo') demos.push([`${l.id}#${i} ${st.title ?? ''}`, st]);
      });
  if (!demos.length) {
    test.skip('sin demos todavía', () => {});
    return;
  }
  test.each(demos)('%s se ejecuta como se muestra', (_id, d) => {
    expect(DATASETS[d.setup.db]).toBeTruthy();
    expect(d.cells.length).toBeGreaterThanOrEqual(1);
    const s = newSqlSession(d.setup);
    d.cells.forEach((c, i) => {
      const out = s.exec(c.sql);
      if (c.error) {
        if (!out.error) throw new Error(`celda ${i} debía fallar y no falló: ${c.sql}`);
      } else if (out.error) {
        throw new Error(`celda ${i} falla: ${out.error.error.message}\n${c.sql}`);
      }
    });
  });
});

describe('curso de SQL: retos', () => {
  const all = allChallenges('sql').map((x) => [x.challenge.id, x.challenge as SqlChallenge] as const);
  if (!all.length) {
    test.skip('sin retos todavía', () => {});
    return;
  }
  test('ids de retos únicos', () => {
    expect(new Set(all.map((a) => a[0])).size).toBe(all.length);
  });
  test.each(all)('%s: la solución completa el reto y el código inicial no', (_id, ch) => {
    expect(ch.lang).toBe('sql');
    expect(DATASETS[ch.setup.db]).toBeTruthy();
    const t0 = Date.now();
    const j = sqlJudge();
    const r = j.judge(() => newSqlSession(ch.setup), ch.solution, ch.solution, ch.check);
    if (!r.ok) throw new Error(`${ch.id}: ${r.why}\n${ch.solution}`);
    expect(Date.now() - t0).toBeLessThan(SLOW_MS);
    if (ch.expectInitialFail !== false) {
      const r0 = j.judge(() => newSqlSession(ch.setup), ch.starter ?? '', ch.solution, ch.check);
      if (r0.ok) throw new Error(`${ch.id}: el reto ya está resuelto con el código inicial`);
    }
    expect(ch.hints.length).toBeGreaterThanOrEqual(1);
    expect(ch.explain.length).toBeGreaterThan(10);
    expect(ch.prompt.length).toBeGreaterThan(20);
    // las comprobaciones de «state» deben decir qué tablas mirar (se enseñan al alumno)
    if (ch.check.mode === 'state' || ch.check.mode === 'both') expect(ch.check.tables?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('curso de SQL: preguntas', () => {
  const qs: { id: string; q: Question }[] = [];
  for (const w of SQL.worlds)
    for (const l of w.lessons)
      l.steps.forEach((st, i) => {
        if (st.type === 'quiz') qs.push({ id: `${l.id}#${i}`, q: st.q });
      });
  if (!qs.length) {
    test.skip('sin preguntas todavía', () => {});
    return;
  }
  test.each(qs.map((x) => [x.id, x.q] as const))('%s es consistente', (_id, q) => {
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
      case 'sqlout': {
        const s = newSqlSession(q.setup);
        const out = s.exec(q.sql);
        if (out.error) throw new Error(`${out.error.error.message}\n${q.sql}`);
        const correct = sqlEngine().renderRows(out.results[out.results.length - 1]);
        expect(correct.length).toBeGreaterThan(0);
        expect(correct.split('\n').length).toBeLessThanOrEqual(10);
        expect(q.wrong.length).toBeGreaterThanOrEqual(2);
        for (const w of q.wrong) expect(w.trimEnd()).not.toBe(correct);
        expect(new Set(q.wrong.map((w) => w.trimEnd())).size).toBe(q.wrong.length);
        break;
      }
      case 'sqlcode': {
        const j = sqlJudge();
        const r = j.judge(() => newSqlSession(q.setup), q.solution, q.solution, q.check);
        if (!r.ok) throw new Error(`${r.why}\n${q.solution}`);
        if (q.starter !== undefined) expect(j.judge(() => newSqlSession(q.setup), q.starter, q.solution, q.check).ok).toBe(false);
        break;
      }
      case 'cmd':
      case 'output':
      case 'pycode':
      case 'pyout':
        throw new Error(`El tipo «${q.t}» no es de SQL; usa sqlcode y sqlout`);
    }
    expect(q.why.length).toBeGreaterThan(5);
  });
});

describe('biblioteca y laboratorio de SQL', () => {
  test('nombres de fichas únicos', () => {
    const names = SQL_REFERENCE.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
  const refs = SQL_REFERENCE.map((r) => [r.name, r] as const);
  if (!refs.length) test.skip('sin fichas todavía', () => {});
  else
  test.each(refs)('ficha %s: ejemplos válidos', (_n, r) => {
    expect(DATASETS[r.db]).toBeTruthy();
    expect(r.examples.length).toBeGreaterThanOrEqual(1);
    expect(r.summary.length).toBeGreaterThan(5);
    for (const [sql] of r.examples) {
      const out = newSqlSession({ db: r.db }).exec(sql);
      if (out.error) throw new Error(`${r.name}: ${out.error.error.message}\n${sql}`);
    }
    const names = new Set(SQL_REFERENCE.map((x) => x.name));
    for (const s of r.seeAlso ?? []) expect(names.has(s)).toBe(true);
  });
  test.each(SQL_SAMPLES.map((s) => [s.id, s] as const))('ejemplo del laboratorio «%s» funciona', (_id, s) => {
    expect(DATASETS[s.db]).toBeTruthy();
    const out = newSqlSession({ db: s.db }).exec(s.sql);
    if (out.error) throw new Error(`${out.error.error.message}\n${s.sql}`);
  });
});
