import { runAws, type AwsResult } from '../cli';
import type { AwsIO } from '../registry';
import { buildAccount, profileFiles, type AwsSetup } from '../scenarios';
import type { Account } from '../types';
import { shellSplit } from '../util';

export { shellSplit };

export interface TestEnv {
  acct: Account;
  files: Map<string, string>;
  /** Escribe un archivo local actualizando su fecha de modificación. */
  write: (path: string, content: string) => void;
  env: Record<string, string>;
  io: AwsIO;
  /** Ejecuta `aws …` (acepta la línea con o sin la palabra aws). */
  run: (line: string) => Promise<AwsResult>;
  /** Como run pero devuelve el JSON de la salida. */
  json: (line: string) => Promise<any>;
}

export function mkEnv(setup: AwsSetup = {}, extraFiles: Record<string, string> = {}): TestEnv {
  const acct = buildAccount(setup);
  const files = new Map<string, string>();
  const mtimes = new Map<string, number>();
  const home = '/home/alumno';
  for (const [k, v] of Object.entries(profileFiles(acct, setup))) files.set(`${home}/${k}`, v);
  for (const [k, v] of Object.entries(extraFiles)) files.set(k.startsWith('/') ? k : `${home}/${k}`, v);
  for (const k of files.keys()) mtimes.set(k, acct.clock);
  const env: Record<string, string> = {};
  const abs = (p: string) => (p.startsWith('/') ? p : `${home}/${p.replace(/^\.\//, '')}`);
  const io: AwsIO = {
    acct,
    env,
    home,
    cwd: home,
    readFile: (p) => files.get(abs(p)) ?? null,
    writeFile: (p, c) => (files.set(abs(p), c), mtimes.set(abs(p), acct.clock), true),
    removeFile: (p) => void files.delete(abs(p)),
    listFiles: (d) => {
      const dir = abs(d).replace(/\/$/, '') + '/';
      const l = [...files.entries()].filter(([k]) => k.startsWith(dir)).map(([k, v]) => ({ rel: k.slice(dir.length), content: v, mtime: mtimes.get(k) ?? 0, size: v.length }));
      return l.length ? l : null;
    },
    isDir: (p) => [...files.keys()].some((k) => k.startsWith(abs(p).replace(/\/$/, '') + '/')),
    size: (p) => (files.has(abs(p)) ? files.get(abs(p))!.length : null),
    abs,
    stdin: null,
    cols: 80,
  };
  const run = (line: string) => {
    const argv = shellSplit(line);
    if (argv[0] === 'aws') argv.shift();
    return runAws(argv, io);
  };
  const json = async (line: string) => {
    const r = await run(line);
    if (r.code !== 0) throw new Error(`código ${r.code}: ${r.stderr}`);
    return JSON.parse(r.stdout);
  };
  const write = (p: string, c: string) => void io.writeFile(p, c);
  return { acct, files, write, env, io, run, json };
}
