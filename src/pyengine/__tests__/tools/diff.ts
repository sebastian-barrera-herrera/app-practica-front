/**
 * Compara el intérprete con python3 sobre los .py de __tests__/golden (o los que se indiquen).
 * Uso: bun diff.ts [filtro]   →  imprime las diferencias y un resumen.
 */
import { PySession } from '../../index';
import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'golden');
const filter = process.argv[2] ?? '';
const verbose = process.argv.includes('-v');
const files = readdirSync(dir).filter((f) => f.endsWith('.py') && f.includes(filter)).sort();
let fails = 0;

async function main(): Promise<void> {
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    const stdinFile = join(dir, f.replace(/\.py$/, '.in'));
    const stdin = existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '';
    const py = spawnSync('python3', ['-X', 'utf8', f], { cwd: dir, input: stdin, encoding: 'utf8', env: { ...process.env, PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' } });
    py.stdout = py.stdout.split(dir + '/').join('');
    py.stderr = py.stderr.split(dir + '/').join('');
    const s = new PySession({ stdin: stdin === '' ? [] : stdin.replace(/\n$/, '').split('\n') });
    const t0 = Date.now();
    let r: any;
    try {
      r = await s.run(src, { filename: f });
    } catch (e: any) {
      fails++;
      console.log(`✗ ${f}: EXCEPCIÓN INTERNA ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n    ')}`);
      continue;
    }
    const ms = Date.now() - t0;
    const same = r.stdout === py.stdout && r.stderr === py.stderr;
    if (!same) {
      fails++;
      console.log(`✗ ${f} (${ms} ms)`);
      const show = (label: string, a: string, b: string): void => {
        if (a === b) return;
        const al = a.split('\n');
        const bl = b.split('\n');
        for (let i = 0; i < Math.max(al.length, bl.length); i++) {
          if (al[i] !== bl[i]) {
            console.log(`  ${label} línea ${i + 1}:\n    python: ${JSON.stringify(bl[i])}\n    motor : ${JSON.stringify(al[i])}`);
            break;
          }
        }
      };
      show('stdout', r.stdout, py.stdout);
      show('stderr', r.stderr, py.stderr);
    } else if (verbose) console.log(`✓ ${f} (${ms} ms)`);
  }
  console.log(`\n${files.length - fails}/${files.length} iguales`);
}
main();
