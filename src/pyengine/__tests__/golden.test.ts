/**
 * Pruebas «golden»: cada golden/*.py se ejecuta con el intérprete y su salida (stdout y stderr) debe ser idéntica
 * a la que dio CPython 3.13 (guardada en golden/*.expected.json con `bun tools/diff.ts --bless`).
 */
import { PySession } from '../index';
import { norm } from './tools/golden_norm';

declare const require: (m: string) => any;
declare const __dirname: string;
const { existsSync, readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const dir: string = join(__dirname, 'golden');
const files: string[] = readdirSync(dir).filter((f: string) => f.endsWith('.py')).sort();

describe('golden: el intérprete reproduce la salida de CPython', () => {
  test('todos los golden tienen su salida esperada', () => {
    expect(files.filter((f) => !existsSync(join(dir, f.replace(/\.py$/, '.expected.json'))))).toEqual([]);
  });

  test.each(files)('%s', async (f) => {
    const expected = JSON.parse(readFileSync(join(dir, f.replace(/\.py$/, '.expected.json')), 'utf8')) as { stdout: string; stderr: string };
    const inFile = join(dir, f.replace(/\.py$/, '.in'));
    const stdin = existsSync(inFile) ? readFileSync(inFile, 'utf8') : '';
    const s = new PySession({ stdin: stdin === '' ? [] : stdin.replace(/\n$/, '').split('\n') });
    const r = await s.run(readFileSync(join(dir, f), 'utf8'), { filename: f });
    expect({ stdout: norm(r.stdout), stderr: norm(r.stderr) }).toEqual(expected);
  }, 120000);
});
