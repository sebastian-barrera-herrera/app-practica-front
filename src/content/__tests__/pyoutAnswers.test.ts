import { COURSE_LIST } from '@/content';
import { allQuestions } from '@/content/pool';
import { pythonStdout } from '@/lib/pyrun';
import { PYOUT } from '../pyoutAnswers.generated';
import { knownPyout, pyoutKey } from '../pyoutAnswers';

// el proyecto no incluye los tipos de Node: solo hacen falta estas dos funciones
declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeFileSync } = require('fs') as { writeFileSync: (path: string, data: string) => void };

/** Cada pregunta «pyout» con su salida real, calculada por el intérprete. */
async function compute() {
  const out: Record<string, string> = {};
  for (const c of COURSE_LIST)
    for (const it of allQuestions(c.id))
      if (it.q.t === 'pyout') out[pyoutKey(it.q.code, it.q.setup)] = await pythonStdout(it.q.code, it.q.setup);
  return out;
}

const pyouts = COURSE_LIST.flatMap((c) => allQuestions(c.id)).filter((it) => it.q.t === 'pyout');

describe('salidas precalculadas de las preguntas pyout', () => {
  it('hay preguntas pyout', () => {
    expect(pyouts.length).toBeGreaterThan(0);
  });

  it('coinciden con lo que imprime el intérprete (si no: UPDATE_PYOUT=1 npx jest pyoutAnswers)', async () => {
    const now = await compute();
    if (process.env.UPDATE_PYOUT) {
      // el cálculo tiene que ser estable: dos pasadas iguales
      expect(await compute()).toEqual(now);
      const body = Object.keys(now)
        .sort()
        .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(now[k])},`)
        .join('\n');
      writeFileSync(
        `${__dirname}/../pyoutAnswers.generated.ts`,
        `// GENERADO por src/content/__tests__/pyoutAnswers.test.ts: no editar a mano.\nexport const PYOUT: Record<string, string> = {\n${body}\n};\n`,
      );
      return;
    }
    expect(PYOUT).toEqual(now);
  }, 120000);

  it('knownPyout encuentra cada pregunta', () => {
    for (const it of pyouts) if (it.q.t === 'pyout') expect(knownPyout(it.q.code, it.q.setup)).toBeDefined();
  });

  it('la clave cambia si cambia el código o la entrada', () => {
    expect(pyoutKey('print(1)')).not.toBe(pyoutKey('print(2)'));
    expect(pyoutKey('print(1)')).not.toBe(pyoutKey('print(1)', { stdin: ['a'] }));
  });
});
