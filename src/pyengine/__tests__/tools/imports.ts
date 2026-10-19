/** Intenta importar cada módulo del manifiesto (y algunos nativos) y muestra los fallos. */
import { readFileSync } from 'fs';
import { PySession } from '../../index';

const man = JSON.parse(readFileSync(__dirname + '/../../pylib/manifest.json', 'utf8'));
const extra = ['binascii', 'struct', 're', 'io', 'posix', 'math', 'itertools', 'time', 'hashlib', 'sys', 'atexit', 'errno', 'gc', 'unicodedata', '_string'];
const only = process.argv[2];
async function main(): Promise<void> {
  const names = [...Object.keys(man.modules), ...extra].filter((n) => !only || n === only);
  let bad = 0;
  for (const n of names) {
    const s = new PySession({});
    const t0 = performance.now();
    const r = await s.run(`import ${n}`, { filename: 'imp.py' });
    const ms = (performance.now() - t0).toFixed(0);
    if (!r.ok) {
      bad++;
      const lines = r.stderr.trimEnd().split('\n');
      console.log(`✗ ${n} (${ms} ms): ${lines.slice(-3).join(' | ')}`);
    } else console.log(`✓ ${n} (${ms} ms)`);
  }
  console.log(bad, 'fallos de', names.length);
}
main();
