/** Comprueba que el parser/compilador acepta cada módulo de la biblioteca estándar del manifiesto. */
import { readFileSync } from 'fs';
import { PySession } from '../../index';
import { compileSource } from '../../compile';
import { setActive } from '../../runtime/state';

const man = JSON.parse(readFileSync(__dirname + '/../../pylib/manifest.json', 'utf8'));
const s = new PySession({});
const prev = setActive(s.I);
let bad = 0;
for (const [name, spec] of Object.entries<string>(man.modules)) {
  const [kind, rest] = spec.split(':');
  const path = rest.replace(/!pkg$/, '');
  const file = kind === 'std' ? `/usr/lib/python3.13/${path}` : `${__dirname}/../../pylib/${path}`;
  let src: string;
  try { src = readFileSync(file, 'utf8'); } catch { console.log(name, 'NO EXISTE', file); bad++; continue; }
  const t0 = performance.now();
  try {
    compileSource(s.I, src, { filename: name, hidden: true });
    console.log('ok ', name.padEnd(24), (performance.now() - t0).toFixed(0).padStart(4), 'ms');
  } catch (e: any) {
    bad++;
    console.log('ERR', name.padEnd(24), e.msg ?? e.message, 'línea', e.line, e.notSupported ?? '');
  }
}
setActive(prev);
console.log(bad, 'con problemas');
