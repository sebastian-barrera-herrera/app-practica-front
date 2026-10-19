/** Compara ast.dump(include_attributes=True) de archivos de la biblioteca estándar entre python3 y el motor. Uso: bun astcorpus.ts [máx KB] [n] */
import { PySession } from '../../index';
import { spawnSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const maxKB = Number(process.argv[2] ?? 20);
const count = Number(process.argv[3] ?? 40);
const root = spawnSync('python3', ['-c', 'import os;print(os.path.dirname(os.__file__))'], { encoding: 'utf8' }).stdout.trim();
const files = readdirSync(root).filter((f) => f.endsWith('.py')).map((f) => join(root, f)).filter((f) => statSync(f).size < maxKB * 1024).sort().slice(0, count);

async function main(): Promise<void> {
  let bad = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const code = `import ast, hashlib\nsrc = ${JSON.stringify(src).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))}\nt = ast.parse(src)\nprint(hashlib.md5(ast.dump(t, include_attributes=True).encode()).hexdigest())\n`;
    const py = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    const s = new PySession({});
    const t0 = Date.now();
    const r = await s.run(code, { filename: 'a.py' });
    const ok = r.stdout === py.stdout && r.stderr === '';
    if (!ok) { bad++; console.log('✗', f, r.stderr.split('\n').slice(-3).join(' | ')); }
    else console.log('✓', f, Date.now() - t0, 'ms');
  }
  console.log(`${files.length - bad}/${files.length}`);
}
main();
