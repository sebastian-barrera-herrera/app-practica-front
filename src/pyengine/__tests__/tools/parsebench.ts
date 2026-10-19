import { parseSource } from '../../parser';
import { readFileSync } from 'fs';
for (const f of ['typing', 'enum', 'dataclasses', 'functools', 'collections/__init__', 'random', '_pydatetime', 'heapq', 'contextlib', 'statistics', 'unittest/case']) {
  const src = readFileSync(`/usr/lib/python3.13/${f}.py`, 'utf8');
  const t0 = performance.now();
  try {
    parseSource(src, 'exec');
    console.log(f, src.length, 'bytes', (performance.now() - t0).toFixed(0), 'ms');
  } catch (e: any) {
    console.log(f, 'ERROR', e.msg ?? e.message, e.line);
  }
}
