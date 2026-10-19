/**
 * Compara el intérprete con python3 sobre los .py de __tests__/golden (o los que se indiquen).
 * Uso: bun diff.ts [filtro]   →  imprime las diferencias y un resumen.
 */
import { PySession } from '../../index';
import { spawnSync } from 'child_process';
import { readdirSync, readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = join(__dirname, '..', 'golden');
/** Normaliza lo que cambia entre ejecuciones (tiempos, direcciones de memoria). */
const norm = (t: string): string => t.replace(/(Ran \d+ tests? in )[\d.]+s/g, '$1Xs').replace(/ at 0x[0-9a-f]+>/g, ' at 0xADDR>').replace(/0x[0-9a-f]{8,}/g, '0xADDR');
const filter = process.argv[2] ?? '';
const verbose = process.argv.includes('-v');
const files = readdirSync(dir).filter((f) => f.endsWith('.py') && f.includes(filter)).sort();
let fails = 0;

async function main(): Promise<void> {
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8');
    const stdinFile = join(dir, f.replace(/\.py$/, '.in'));
    const stdin = existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '';
    // cada prueba corre en un directorio limpio (los archivos que crea no se arrastran a otras ejecuciones)
    const work = mkdtempSync(join(tmpdir(), 'pygolden-'));
    copyFileSync(join(dir, f), join(work, f));
    const py = spawnSync('python3', ['-X', 'utf8', f], { cwd: work, input: stdin, encoding: 'utf8', env: { ...process.env, PYTHONHASHSEED: '0', PYTHONDONTWRITEBYTECODE: '1' } });
    rmSync(work, { recursive: true, force: true });
    py.stdout = py.stdout.split(work + '/').join('').split(work).join('/home/alumno');
    py.stderr = py.stderr.split(work + '/').join('').split(work).join('/home/alumno');
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
    r.stdout = norm(r.stdout);
    r.stderr = norm(r.stderr);
    py.stdout = norm(py.stdout);
    py.stderr = norm(py.stderr);
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
