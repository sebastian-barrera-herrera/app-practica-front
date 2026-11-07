/**
 * Pruebas de autocomprobación del «torch en miniatura» (no hay PyTorch real para comparar):
 *  - gradientes de cada operación contra diferencias finitas,
 *  - capas (Conv2d, LSTM, GRU, BatchNorm…) contra implementaciones de referencia en NumPy,
 *  - entrenamiento de una red pequeña, repr de módulos y API de optim/scheduler/autograd,
 *  - `torch_api.py`: una batería de ~150 salidas (repr, formas, errores, optimizadores…) contrastada con PyTorch 2.x real.
 * La salida esperada de cada script está en selfcheck/*.expected.txt (BLESS=1 para regenerarla).
 */
import { PySession } from '../index';

declare const require: (m: string) => any;
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const dir: string = join(__dirname, 'selfcheck');
const scripts = ['torch_grads', 'torch_layers', 'torch_train', 'torch_api'];

describe('torch mini: autocomprobaciones', () => {
  test.each(scripts)('%s', async (name) => {
    const s = new PySession({ stdin: [] });
    const r = await s.run(readFileSync(join(dir, name + '.py'), 'utf8'), { filename: name + '.py' });
    expect(r.stderr).toBe('');
    r.stdout = r.stdout.replace(/ object at 0x[0-9a-f]+/g, ' object');
    const exp = join(dir, name + '.expected.txt');
    if (process.env.BLESS === '1' || !existsSync(exp)) writeFileSync(exp, r.stdout);
    expect(r.stdout).toBe(readFileSync(exp, 'utf8'));
    if (name === 'torch_grads') {
      const bad = r.stdout.split('\n').filter((l: string) => l && l !== 'DONE' && !l.endsWith(' OK'));
      expect(bad).toEqual([]);
      expect(r.stdout.trim().endsWith('DONE')).toBe(true);
    }
  }, 120000);
});
