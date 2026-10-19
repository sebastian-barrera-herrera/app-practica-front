/** Ejecuta un archivo .py con el intérprete (uso: bun run.ts archivo.py). Imprime stdout/stderr tal cual. */
import { PySession } from '../../index';

const file = process.argv[2];
const src = require('fs').readFileSync(file, 'utf8');
const s = new PySession({ stdin: [] });
s.run(src, { filename: file.split('/').pop() }).then((r) => {
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.ok ? 0 : r.exitCode || 1);
});
