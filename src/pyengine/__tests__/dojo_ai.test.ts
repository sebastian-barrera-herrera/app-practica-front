/**
 * El módulo `dojo_ai` (embeddings de juguete, tokenizador BPE, índices vectoriales y modelo de lenguaje) es Python puro
 * con NumPy, así que se ejecuta igual con CPython: la salida esperada de cada script (selfcheck/dojo_*.expected.txt) es
 * la que da CPython real con NumPy real, y el intérprete propio debe reproducirla exactamente.
 */
import { PySession } from '../index';

declare const require: (m: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');

const dir: string = join(__dirname, 'selfcheck');
const scripts = ['dojo_embeddings', 'dojo_tokenizer', 'dojo_vectordb', 'dojo_lm', 'dojo_llm'];

describe('dojo_ai: idéntico a CPython', () => {
  test.each(scripts)('%s', async (name) => {
    const s = new PySession({ stdin: [] });
    const r = await s.run(readFileSync(join(dir, name + '.py'), 'utf8'), { filename: name + '.py' });
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(readFileSync(join(dir, name + '.expected.txt'), 'utf8'));
  }, 120000);
});
