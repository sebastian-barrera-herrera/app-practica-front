/** Compara columnas numéricas de la salida de un script entre python3 y el motor. Uso: bun cmpcols.ts script.py name1,name2,... */
import { PySession } from '../../index';
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

async function main(): Promise<void> {
  const file = process.argv[2];
  const names = (process.argv[3] ?? '').split(',');
  const src = readFileSync(file, 'utf8');
  const py = spawnSync('python3', [file], { encoding: 'utf8' });
  const s = new PySession({});
  const r = await s.run(src, { filename: 'm.py' });
  const a = py.stdout.trim().split('\n');
  const b = r.stdout.trim().split('\n');
  if (r.stderr) console.log(r.stderr);
  const stats: Record<string, { n: number; bad: number; max: number; ex: string }> = {};
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const ca = a[i].split(' ');
    const cb = b[i].split(' ');
    for (let j = 1; j < ca.length; j++) {
      const k = names[j - 1] ?? String(j);
      const st = (stats[k] ??= { n: 0, bad: 0, max: 0, ex: '' });
      st.n++;
      if (ca[j] !== cb[j]) {
        st.bad++;
        const x = parseFloat(ca[j]);
        const y = parseFloat(cb[j]);
        const rel = isNaN(x) || isNaN(y) ? Infinity : Math.abs(x - y) / Math.max(Math.abs(x), 1e-300);
        if (rel > st.max) { st.max = rel; st.ex = `x=${ca[0]} py=${ca[j]} js=${cb[j]}`; }
      }
    }
  }
  for (const [k, v] of Object.entries(stats)) console.log(k.padEnd(8), `${v.bad}/${v.n}`, 'maxrel', v.max.toExponential(2), v.ex);
}
main();
