/**
 * Integra el motor de AWS en el shell de Linux: el comando `aws` (que solo existe en los mundos con una cuenta
 * de AWS), la creación de la cuenta y los archivos ~/.aws al crear el mundo.
 */
import { applyFiles, installPackage, worldHooks, type World, type WorldOptions } from '../engine/world';
import { defineCommand, type Ctx } from '../engine/registry';
import { FsError, type VFS } from '../engine/vfs';
import './web';
import { runAws } from './cli';
import { AWS_KEY, awsAccountOf } from './state';
import type { AwsIO } from './registry';
import { buildAccount, profileFiles, type AwsSetup } from './scenarios';
import type { Account } from './types';

export { AWS_KEY, awsAccountOf };

function listTree(fs: VFS, root: string): { rel: string; content: string; mtime: number; size: number }[] | null {
  const st = fs.stat(root);
  if (!st || st.kind !== 'dir') return null;
  const out: { rel: string; content: string; mtime: number; size: number }[] = [];
  const walk = (dir: string, rel: string) => {
    for (const n of fs.readdir(dir)) {
      const p = dir.replace(/\/$/, '') + '/' + n;
      const node = fs.stat(p);
      if (!node) continue;
      if (node.kind === 'dir') walk(p, rel + n + '/');
      else out.push({ rel: rel + n, content: node.content, mtime: node.mtime, size: fs.sizeOf(node) });
    }
  };
  walk(root, '');
  return out;
}

/** Adapta el shell y el VFS de Linux a lo que necesita la CLI de AWS. */
export function ioFromCtx(c: Ctx, acct: Account): AwsIO {
  const sh = c.sh;
  const fs = sh.fs;
  const cred = sh.cred;
  const env: Record<string, string> = {};
  for (const [k, v] of sh.exportedEnv()) env[k] = v;
  return {
    acct,
    env,
    home: sh.home(),
    cwd: sh.cwd,
    readFile: (p) => {
      try {
        return fs.readFile(p, cred);
      } catch {
        return null;
      }
    },
    writeFile: (p, content) => {
      try {
        const dir = p.slice(0, p.lastIndexOf('/')) || '/';
        if (!fs.stat(dir)) fs.mkdirp(dir, dir.endsWith('/.aws') ? 0o700 : 0o755, cred);
        fs.writeFile(p, content, { cred, mode: p.includes('/.aws/') ? 0o600 : 0o644 });
        return true;
      } catch (e) {
        if (e instanceof FsError) return false;
        throw e;
      }
    },
    removeFile: (p) => {
      try {
        fs.unlink(p, cred);
      } catch {
        /* ya no existe */
      }
    },
    listFiles: (d) => listTree(fs, d),
    isDir: (p) => fs.isDir(p),
    size: (p) => {
      const n = fs.stat(p);
      return n && n.kind === 'file' ? fs.sizeOf(n) : null;
    },
    abs: (p) => sh.abs(p),
    stdin: c.stdin.isTTY ? null : () => c.stdin.readAll(),
    prompt: async (q) => {
      c.out(q);
      const line = await c.stdin.readLine();
      return line;
    },
    cols: c.cols,
  };
}

defineCommand(
  'aws',
  {
    summary: 'CLI de AWS (simulada): gestiona tu cuenta de AWS desde la terminal',
    usage: 'aws [opciones] <servicio> <operación> [parámetros]',
    category: 'redes',
    noHelp: true,
    level: 3,
    options: [
      ['--profile', 'perfil de ~/.aws que se usa'],
      ['--region', 'región a la que se envía la petición'],
      ['--output', 'json | text | table | yaml'],
      ['--query', 'filtro JMESPath de la salida'],
    ],
    examples: [
      ['aws sts get-caller-identity', 'quién eres para AWS'],
      ['aws s3 ls', 'lista tus buckets'],
    ],
  },
  async (c) => {
    const acct = awsAccountOf(c.sh.sys);
    if (!acct) return c.fail('command not found', 127);
    // el reloj de la cuenta y el del sistema avanzan juntos
    const sysClock = c.sh.sys.clock;
    acct.clock = Math.max(acct.clock, sysClock.now);
    const res = await runAws(c.args, ioFromCtx(c, acct));
    sysClock.now = Math.max(sysClock.now, acct.clock);
    if (res.stdout) c.out(res.stdout);
    if (res.stderr) c.err(res.stderr);
    return res.code;
  },
);

const STUB = '\x7fELF\x02\x01\x01\x00@@aws@@\x00\x00';

/** Crea la cuenta y los archivos de configuración cuando el mundo lo pide con `aws:`. */
export function setupAws(w: World, o: WorldOptions): void {
  if (!o.aws) return;
  const setup: AwsSetup = o.aws === true ? {} : typeof o.aws === 'string' ? { scenario: o.aws } : o.aws;
  const acct = buildAccount(setup);
  acct.clock = Math.max(acct.clock, w.sys.clock.now);
  w.sys.ext[AWS_KEY] = acct;
  // herramientas de red que se usan con AWS: dig/nslookup (DNS) e ipcalc (subredes)
  for (const p of ['dnsutils', 'ipcalc', 'httpd-tools']) installPackage(w.sys, w.fs, p);
  const bin = w.fs.writeFile('/usr/local/bin/aws', STUB, { cred: null, mode: 0o755 });
  bin.uid = 'root';
  bin.gid = 'root';
  bin.size = 61_000_000;
  const home = w.shell.home();
  const files = profileFiles(acct, setup);
  const spec: Record<string, { content?: string; dir?: boolean; mode?: number; owner?: string }> = {};
  if (Object.keys(files).length) spec[`${home}/.aws/`] = { dir: true, mode: 0o755, owner: w.shell.user };
  for (const [rel, content] of Object.entries(files)) spec[`${home}/${rel}`] = { content, mode: rel.endsWith('credentials') ? 0o600 : 0o644, owner: w.shell.user };
  applyFiles(w.fs, spec, w.shell.user);
}

worldHooks.push(setupAws);
