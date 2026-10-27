/**
 * El comando `docker` del simulador: construye imágenes a partir de un Dockerfile, las etiqueta, las sube a ECR (`docker login` con
 * `aws ecr get-login-password`) y ejecuta contenedores. Las aplicaciones Python (y los comandos de shell) se ejecutan de verdad.
 */
import { httpHandlers } from '../engine/commands/internet';
import { defineCommand, type Ctx } from '../engine/registry';
import type { System } from '../engine/sys';
import { MiniShell } from './minish';
import { ioFromCtx } from './command';
import { baseAsImage, findBase } from './containers/catalog';
import { buildImage } from './containers/dockerfile';
import { containerHttp, runContainer, shQuote, type RunOpts, type ServerInfo } from './containers/runtime';
import { AwsError } from './registry';
import { awsAccountOf } from './state';
import { ecrPull, ecrPush, parseToken } from './services/ecr';
import type { Account } from './types';
import type { DockerContainer, DockerState, ImageData } from './types-containers';
import { stableId } from './util';

export const dockerOf = (a: Account): DockerState => (a.docker ??= { images: {}, tags: [], containers: [], logins: {}, counter: 0 });

const shortId = (id: string) => id.replace('sha256:', '').slice(0, 12);
const ECR_HOST = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$/;

/** `repo[:tag]` → partes (el registro con puerto, como `localhost:5000/x`, no se confunde con la etiqueta). */
export function splitRef(ref: string): { repo: string; tag: string } {
  const at = ref.indexOf('@');
  if (at >= 0) return { repo: ref.slice(0, at), tag: ref.slice(at + 1) };
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  if (colon > slash) return { repo: ref.slice(0, colon), tag: ref.slice(colon + 1) };
  return { repo: ref, tag: 'latest' };
}

const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)}GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)}MB` : b >= 1e3 ? `${(b / 1e3).toFixed(1)}kB` : `${b}B`);
const ago = (now: number, t: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
};

const NAMES = ['quirky_turing', 'happy_hopper', 'sleepy_lovelace', 'brave_ritchie', 'eager_knuth', 'calm_torvalds', 'wizardly_hamilton', 'jolly_lamport'];

const find = (d: DockerState, ref: string): { image: ImageData; repo: string; tag: string } | undefined => {
  const { repo, tag } = splitRef(ref);
  const hit = d.tags.find((t) => (t.repo === repo || t.repo === `docker.io/library/${repo}`) && t.tag === tag);
  if (hit) return { image: d.images[hit.id], repo: hit.repo, tag: hit.tag };
  const byId = Object.values(d.images).find((i) => i.id.replace('sha256:', '').startsWith(ref.replace('sha256:', '')) && ref.length >= 4);
  return byId ? { image: byId, repo: ref, tag: '' } : undefined;
};

function addTag(d: DockerState, repo: string, tag: string, id: string) {
  d.tags = d.tags.filter((t) => !(t.repo === repo && t.tag === tag));
  d.tags.push({ repo, tag, id });
}

const fromBase = (name: string, now: number): ImageData | undefined => {
  const b = findBase(name);
  return b ? baseAsImage(b, now) : undefined;
};

const runOpts = (a: Account, env: Record<string, string> = {}, args?: string[] | null): RunOpts => ({ acct: a, region: 'us-east-1', env, args, hostArch: 'amd64', caller: null, now: a.clock });

function parseOpts(args: string[], withValue: string[], flags: string[]): { vals: Record<string, string[]>; flags: Set<string>; rest: string[] } {
  const vals: Record<string, string[]> = {};
  const fl = new Set<string>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-') || a === '-') {
      rest.push(...args.slice(i));
      break;
    }
    const eq = a.indexOf('=');
    const key = eq > 0 ? a.slice(0, eq) : a;
    if (withValue.includes(key)) {
      (vals[key] ??= []).push(eq > 0 ? a.slice(eq + 1) : (args[++i] ?? ''));
    } else if (flags.includes(a)) fl.add(a);
    else if (/^-[a-z]{2,}$/.test(a) && [...a.slice(1)].every((ch) => flags.includes('-' + ch))) for (const ch of a.slice(1)) fl.add('-' + ch);
    else if (withValue.includes(a.slice(0, 2)) && a.length > 2 && !a.startsWith('--')) (vals[a.slice(0, 2)] ??= []).push(a.slice(2));
    else fl.add(a);
  }
  return { vals, flags: fl, rest };
}

const first = (v: string[] | undefined) => v?.[0];

function shellRunner(a: Account) {
  return (script: string, files: Map<string, string>, cwd: string, env: Record<string, string>) => {
    const out: string[] = [];
    const clock = a.clock;
    const sh = new MiniShell({ acct: a, files, vars: { ...env }, cwd, log: (l) => out.push(l) });
    let code = 1;
    try {
      code = sh.run(script);
    } finally {
      a.clock = clock;
    }
    return { code, out: out.join('\n') };
  };
}

async function cmdBuild(c: Ctx, a: Account, args: string[]): Promise<number> {
  const d = dockerOf(a);
  const o = parseOpts(args, ['-t', '--tag', '-f', '--file', '--platform', '--build-arg', '--progress', '--target'], ['--no-cache', '--pull', '-q', '--quiet', '--rm']);
  const tags = [...(o.vals['-t'] ?? []), ...(o.vals['--tag'] ?? [])];
  const path = o.rest[0];
  if (!path) {
    c.err('ERROR: "docker buildx build" requires 1 argument\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n');
    return 1;
  }
  const io = ioFromCtx(c, a);
  const dir = io.abs(path).replace(/\/$/, '');
  if (!io.isDir(dir)) {
    c.err(`ERROR: unable to prepare context: path "${dir}" not found\n`);
    return 1;
  }
  const dfPath = first(o.vals['-f']) ?? first(o.vals['--file']) ?? `${dir}/Dockerfile`;
  const dfText = io.readFile(io.abs(dfPath));
  if (dfText === null) {
    c.err(`ERROR: failed to solve: failed to read dockerfile: open ${io.abs(dfPath).split('/').pop()}: no such file or directory\n`);
    return 1;
  }
  const files = new Map<string, string>();
  for (const f of io.listFiles(dir) ?? []) files.set(f.rel, f.content);
  const platform = (first(o.vals['--platform']) ?? '').includes('arm64') ? 'arm64' : 'amd64';
  const buildArgs: Record<string, string> = {};
  for (const b of o.vals['--build-arg'] ?? []) {
    const [k, ...v] = b.split('=');
    buildArgs[k] = v.join('=');
  }
  const res = buildImage({
    files,
    dockerfile: dfText,
    platform,
    buildArgs,
    local: (ref) => find(d, ref)?.image,
    shell: shellRunner(a),
  });
  a.clock += 4000;
  if (!res.ok || !res.image) {
    c.err(res.log.join('\n') + '\n');
    return 1;
  }
  const img = { ...res.image, created: a.clock };
  d.images[img.id] = img;
  const named = tags.length ? tags : [];
  for (const t of named) {
    const { repo, tag } = splitRef(t);
    addTag(d, repo, tag, img.id);
  }
  const quiet = o.flags.has('-q') || o.flags.has('--quiet');
  if (quiet) c.out(img.id + '\n');
  else {
    const log = [...res.log];
    for (const t of named) {
      const { repo, tag } = splitRef(t);
      log.push(` => => naming to ${repo.includes('/') ? repo : 'docker.io/library/' + repo}:${tag}${' '.repeat(20)}0.0s`);
    }
    c.err(log.join('\n') + '\n');
  }
  return 0;
}

function cmdImages(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const o = parseOpts(args, ['--format'], ['-q', '-a', '--no-trunc']);
  const rows = d.tags.filter((t) => !o.rest[0] || t.repo === o.rest[0]);
  if (o.flags.has('-q')) {
    c.out([...new Set(rows.map((t) => shortId(t.id)))].join('\n') + (rows.length ? '\n' : ''));
    return 0;
  }
  const table: string[][] = [['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']];
  for (const t of rows) {
    const im = d.images[t.id];
    table.push([t.repo, t.tag, shortId(t.id), ago(a.clock, im.created), fmtSize(im.size)]);
  }
  c.out(columns(table));
  return 0;
}

const columns = (rows: string[][]): string => {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((x, i) => (i === r.length - 1 ? x : x.padEnd(w[i] + 3))).join('')).join('\n') + '\n';
};

async function cmdLogin(c: Ctx, a: Account, args: string[]): Promise<number> {
  const d = dockerOf(a);
  const o = parseOpts(args, ['-u', '--username', '-p', '--password'], ['--password-stdin']);
  const host = o.rest[0];
  const user = first(o.vals['-u']) ?? first(o.vals['--username']);
  let pw = first(o.vals['-p']) ?? first(o.vals['--password']);
  if (o.flags.has('--password-stdin')) pw = (await c.stdin.readAll()).trim();
  if (!user || pw === undefined) {
    c.err(user ? 'Error: Cannot perform an interactive login from a non TTY device\n' : 'Error: Cannot perform an interactive login from a non TTY device\n');
    return 1;
  }
  if (!host) {
    c.err('Error response from daemon: Get "https://registry-1.docker.io/v2/": unauthorized: incorrect username or password\n');
    return 1;
  }
  const h = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const m = ECR_HOST.exec(h);
  if (!m) {
    c.err(`Error response from daemon: Get "https://${h}/v2/": dial tcp: lookup ${h}: no such host\n`);
    return 1;
  }
  if (m[1] !== a.id) {
    c.err(`Error response from daemon: Get "https://${h}/v2/": denied: Your authorization token has expired. Reauthenticate and try again.\n`);
    return 1;
  }
  const tok = parseToken(a, pw);
  if (user !== 'AWS' || !tok) {
    c.err(`Error response from daemon: Get "https://${h}/v2/": denied: Your authorization token has expired. Reauthenticate and try again.\n`);
    return 1;
  }
  if (a.clock > tok.issuedAt + 12 * 3600000) {
    c.err(`Error response from daemon: Get "https://${h}/v2/": denied: Your authorization token has expired. Reauthenticate and try again.\n`);
    return 1;
  }
  d.logins[h] = { principal: tok.principal, expiresAt: tok.issuedAt + 12 * 3600000 };
  c.err('WARNING! Your password will be stored unencrypted in /root/.docker/config.json.\nConfigure a credential helper to remove this warning. See\nhttps://docs.docker.com/engine/reference/commandline/login/#credentials-store\n\n');
  c.out('Login Succeeded\n');
  return 0;
}

function cmdPush(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const ref = args.filter((x) => !x.startsWith('-'))[0];
  if (!ref) {
    c.err('"docker push" requires exactly 1 argument.\nSee \'docker push --help\'.\n\nUsage:  docker push [OPTIONS] NAME[:TAG]\n');
    return 1;
  }
  const { repo, tag } = splitRef(ref);
  const hit = find(d, ref);
  if (!hit) {
    c.err(`The push refers to repository [${repo}]\nAn image does not exist locally with the tag: ${repo}\n`);
    return 1;
  }
  const host = repo.split('/')[0];
  const m = ECR_HOST.exec(host);
  c.err(`The push refers to repository [${repo}]\n`);
  if (!m) {
    c.err(`denied: requested access to the resource is denied\n`);
    return 1;
  }
  const login = d.logins[host];
  if (!login) {
    c.err('no basic auth credentials\n');
    return 1;
  }
  if (a.clock > login.expiresAt) {
    c.err('denied: Your authorization token has expired. Reauthenticate and try again.\n');
    return 1;
  }
  try {
    const name = repo.slice(host.length + 1);
    const r = ecrPush(a, m[2], login.principal, name, tag, hit.image);
    const layers = hit.image.layers.filter((l) => l.size > 0);
    for (let k = 0; k < layers.length; k++) c.out(`${stableId(`l:${hit.image.id}:${k}`, '', 12, 'hex')}: ${r.newLayers ? 'Pushed' : 'Layer already exists'}\n`);
    c.out(`${tag}: digest: ${r.digest} size: ${1200 + layers.length * 120}\n`);
    return 0;
  } catch (e) {
    if (e instanceof AwsError) {
      c.err(`${e.code === 'RepositoryNotFound' ? e.message : e.message}\n`);
      return 1;
    }
    throw e;
  }
}

function cmdPull(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const ref = args.filter((x) => !x.startsWith('-'))[0];
  if (!ref) {
    c.err('"docker pull" requires exactly 1 argument.\n');
    return 1;
  }
  const r = pullImage(c, a, d, ref);
  return r ? 0 : 1;
}

/** Baja una imagen (de ECR si hay sesión, o una pública conocida) y la deja en el almacén local. */
function pullImage(c: Ctx, a: Account, d: DockerState, ref: string): ImageData | undefined {
  const { repo, tag } = splitRef(ref);
  const host = repo.split('/')[0];
  const m = ECR_HOST.exec(host);
  if (m) {
    const login = d.logins[host];
    if (!login) {
      c.err(`Error response from daemon: Head "https://${host}/v2/${repo.slice(host.length + 1)}/manifests/${tag}": no basic auth credentials\n`);
      return undefined;
    }
    try {
      const img = ecrPull(a, m[2], login.principal, repo.slice(host.length + 1), tag);
      d.images[img.id] = { ...img };
      addTag(d, repo, tag, img.id);
      c.out(`${tag}: Pulling from ${repo.slice(host.length + 1)}\nDigest: sha256:${stableId('pull:' + img.id, '', 64, 'hex')}\nStatus: Downloaded newer image for ${repo}:${tag}\n${repo}:${tag}\n`);
      return img;
    } catch (e) {
      if (e instanceof AwsError) {
        c.err(`Error response from daemon: ${e.message}\n`);
        return undefined;
      }
      throw e;
    }
  }
  const base = fromBase(ref, a.clock);
  if (!base) {
    c.err(`Error response from daemon: pull access denied for ${repo}, repository does not exist or may require 'docker login': denied: requested access to the resource is denied\n`);
    return undefined;
  }
  d.images[base.id] = base;
  addTag(d, repo, tag, base.id);
  c.out(`${tag}: Pulling from library/${repo}\nDigest: sha256:${stableId('pull:' + base.id, '', 64, 'hex')}\nStatus: Downloaded newer image for ${repo}:${tag}\ndocker.io/library/${repo}:${tag}\n`);
  return base;
}

function newContainer(a: Account, d: DockerState, o: { name?: string; image: string; img: ImageData; ports: { host: number; container: number }[]; env: Record<string, string>; args: string[] | null }): DockerContainer | string {
  const name = o.name ?? NAMES[d.counter % NAMES.length] + (d.counter >= NAMES.length ? String(d.counter) : '');
  const clash = d.containers.find((x) => x.name === name);
  if (clash) return `Conflict. The container name "/${name}" is already in use by container "${clash.id}". You have to remove (or rename) that container to be able to reuse that name.`;
  for (const p of o.ports) {
    const used = d.containers.find((x) => x.status === 'running' && x.ports.some((y) => y.host === p.host));
    if (used) return `driver failed programming external connectivity on endpoint ${name} (${stableId('ep' + name, '', 64, 'hex')}): Bind for 0.0.0.0:${p.host} failed: port is already allocated.`;
  }
  d.counter++;
  const id = stableId(`ctr:${a.id}:${d.counter}:${o.image}`, '', 64, 'hex');
  const r = runContainer(o.img, runOpts(a, o.env, o.args));
  const cmd = [...(o.img.config.entrypoint ?? []), ...(o.args ?? o.img.config.cmd ?? [])].map(shQuote).join(' ');
  const running = !!r.server || !!r.idle;
  return { id, name, image: o.image, imageId: o.img.id, createdAt: a.clock, status: running ? 'running' : 'exited', ...(running ? {} : { exitCode: r.code }), ports: o.ports, logs: r.lines, env: o.env, command: cmd, ...(r.server ? { serverPort: r.server.port, bindAll: r.server.bindAll, kind: r.server.kind } : {}) };
}

function cmdRun(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const o = parseOpts(args, ['-p', '--publish', '-e', '--env', '--name', '--platform', '--entrypoint', '-v', '--volume', '-w', '--workdir', '--network', '-m', '--memory'], ['-d', '--detach', '--rm', '-i', '-t', '-it', '--init']);
  const rest = o.rest;
  const ref = rest[0];
  if (!ref) {
    c.err('docker: "docker run" requires at least 1 argument.\nSee \'docker run --help\'.\n');
    return 125;
  }
  let hit = find(d, ref);
  let img = hit?.image;
  if (!img) {
    c.err(`Unable to find image '${ref.includes(':') || ref.includes('@') ? ref : ref + ':latest'}' locally\n`);
    img = pullImage(c, a, d, ref);
    if (!img) {
      c.err(`docker: ${'pull access denied'} for ${splitRef(ref).repo}, repository does not exist or may require 'docker login'.\nSee 'docker run --help'.\n`);
      return 125;
    }
    hit = find(d, ref);
  }
  const ports: { host: number; container: number }[] = [];
  for (const p of [...(o.vals['-p'] ?? []), ...(o.vals['--publish'] ?? [])]) {
    const m = /^(?:[0-9.]+:)?(\d+):(\d+)(?:\/\w+)?$/.exec(p);
    if (!m) {
      c.err(`docker: invalid published port specification: ${p}\n`);
      return 125;
    }
    ports.push({ host: Number(m[1]), container: Number(m[2]) });
  }
  const env: Record<string, string> = {};
  for (const e of [...(o.vals['-e'] ?? []), ...(o.vals['--env'] ?? [])]) {
    const [k, ...v] = e.split('=');
    env[k] = v.length ? v.join('=') : ([...c.sh.exportedEnv()].find(([x]) => x === k)?.[1] ?? '');
  }
  let image = img;
  const ep = first(o.vals['--entrypoint']);
  if (ep) image = { ...img, config: { ...img.config, entrypoint: [ep] } };
  const platform = first(o.vals['--platform']);
  if (platform && platform.includes('arm64') !== (img.arch === 'arm64')) {
    c.err(`WARNING: The requested image's platform (linux/${img.arch}) does not match the detected host platform (linux/${platform.includes('arm64') ? 'arm64' : 'amd64'}) and no specific platform was requested\n`);
  } else if (img.arch !== 'amd64') c.err(`WARNING: The requested image's platform (linux/${img.arch}) does not match the detected host platform (linux/amd64/v3) and no specific platform was requested\n`);
  const cmdArgs = rest.length > 1 ? rest.slice(1) : null;
  const ctr = newContainer(a, d, { name: first(o.vals['--name']), image: ref, img: image, ports, env, args: cmdArgs });
  if (typeof ctr === 'string') {
    c.err(`docker: Error response from daemon: ${ctr}\n`);
    return 125;
  }
  d.containers.push(ctr);
  const detach = o.flags.has('-d') || o.flags.has('--detach');
  if (detach) c.out(ctr.id + '\n');
  else {
    if (ctr.logs.length) c.out(ctr.logs.join('\n') + '\n');
    if (o.flags.has('--rm') && ctr.status === 'exited') d.containers = d.containers.filter((x) => x !== ctr);
  }
  return detach ? 0 : (ctr.exitCode ?? 0);
}

function cmdPs(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const o = parseOpts(args, ['--format', '--filter', '-f'], ['-a', '--all', '-q', '--quiet']);
  const all = o.flags.has('-a') || o.flags.has('--all');
  const rows = d.containers.filter((x) => all || x.status === 'running');
  if (o.flags.has('-q') || o.flags.has('--quiet')) {
    c.out(rows.map((x) => x.id.slice(0, 12)).join('\n') + (rows.length ? '\n' : ''));
    return 0;
  }
  const table: string[][] = [['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']];
  for (const x of rows) {
    const status = x.status === 'running' ? `Up ${ago(a.clock, x.createdAt).replace(' ago', '')}` : `Exited (${x.exitCode ?? 0}) ${ago(a.clock, x.createdAt)}`;
    const ports = x.ports.map((p) => `0.0.0.0:${p.host}->${p.container}/tcp`).join(', ');
    table.push([x.id.slice(0, 12), x.image, `"${x.command.length > 18 ? x.command.slice(0, 17) + '…' : x.command}"`, ago(a.clock, x.createdAt), status, ports, x.name]);
  }
  c.out(columns(table));
  return 0;
}

const byName = (d: DockerState, ref: string) => d.containers.find((x) => x.name === ref || x.id.startsWith(ref));

function cmdLogs(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const o = parseOpts(args, ['--tail', '-n', '--since'], ['-f', '--follow', '-t', '--timestamps']);
  const x = byName(d, o.rest[0] ?? '');
  if (!x) {
    c.err(`Error response from daemon: No such container: ${o.rest[0] ?? ''}\n`);
    return 1;
  }
  const tail = Number(first(o.vals['--tail']) ?? first(o.vals['-n']) ?? 'all');
  const l = Number.isFinite(tail) ? x.logs.slice(-tail) : x.logs;
  if (l.length) c.out(l.join('\n') + '\n');
  return 0;
}

function cmdStop(c: Ctx, a: Account, args: string[], kill = false): number {
  const d = dockerOf(a);
  let rc = 0;
  for (const r of args.filter((x) => !x.startsWith('-'))) {
    const x = byName(d, r);
    if (!x) {
      c.err(`Error response from daemon: No such container: ${r}\n`);
      rc = 1;
      continue;
    }
    if (x.status === 'running') {
      x.status = 'exited';
      x.exitCode = kill ? 137 : 0;
    }
    c.out(r + '\n');
  }
  return rc;
}

function cmdRm(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const force = args.includes('-f') || args.includes('--force');
  let rc = 0;
  for (const r of args.filter((x) => !x.startsWith('-'))) {
    const x = byName(d, r);
    if (!x) {
      c.err(`Error response from daemon: No such container: ${r}\n`);
      rc = 1;
      continue;
    }
    if (x.status === 'running' && !force) {
      c.err(`Error response from daemon: cannot remove container "/${x.name}": container is running: stop the container before removing or force remove\n`);
      rc = 1;
      continue;
    }
    d.containers = d.containers.filter((y) => y !== x);
    c.out(r + '\n');
  }
  return rc;
}

function cmdRmi(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  let rc = 0;
  for (const r of args.filter((x) => !x.startsWith('-'))) {
    const hit = find(d, r);
    if (!hit) {
      c.err(`Error response from daemon: No such image: ${r}\n`);
      rc = 1;
      continue;
    }
    const { repo, tag } = splitRef(r);
    const used = d.containers.find((x) => x.imageId === hit.image.id);
    if (used && !args.includes('-f')) {
      c.err(`Error response from daemon: conflict: unable to remove repository reference "${r}" (must force) - container ${used.id.slice(0, 12)} is using its referenced image ${shortId(hit.image.id)}\n`);
      rc = 1;
      continue;
    }
    if (hit.tag === '') {
      const names = d.tags.filter((t) => t.id === hit.image.id);
      for (const t of names) c.out(`Untagged: ${t.repo}:${t.tag}\n`);
      d.tags = d.tags.filter((t) => t.id !== hit.image.id);
    } else {
      d.tags = d.tags.filter((t) => !(t.repo === hit.repo && t.tag === hit.tag));
      c.out(`Untagged: ${repo}:${tag}\n`);
    }
    if (!d.tags.some((t) => t.id === hit.image.id)) {
      delete d.images[hit.image.id];
      c.out(`Deleted: ${hit.image.id}\n`);
    }
  }
  return rc;
}

function cmdTag(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const [src, dst] = args.filter((x) => !x.startsWith('-'));
  if (!src || !dst) {
    c.err('"docker tag" requires exactly 2 arguments.\nSee \'docker tag --help\'.\n\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]\n');
    return 1;
  }
  const hit = find(d, src);
  if (!hit) {
    c.err(`Error response from daemon: No such image: ${src.includes(':') ? src : src + ':latest'}\n`);
    return 1;
  }
  const { repo, tag } = splitRef(dst);
  addTag(d, repo, tag, hit.image.id);
  return 0;
}

function cmdHistory(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const hit = find(d, args.filter((x) => !x.startsWith('-'))[0] ?? '');
  if (!hit) {
    c.err(`Error response from daemon: No such image: ${args[0] ?? ''}\n`);
    return 1;
  }
  const rows: string[][] = [['IMAGE', 'CREATED', 'CREATED BY', 'SIZE']];
  [...hit.image.layers].reverse().forEach((l, k) => rows.push([k === 0 ? shortId(hit.image.id) : '<missing>', ago(a.clock, hit.image.created), `/bin/sh -c ${l.cmd.slice(0, 44)}`, fmtSize(l.size)]));
  c.out(columns(rows));
  return 0;
}

function cmdInspect(c: Ctx, a: Account, args: string[]): number {
  const d = dockerOf(a);
  const ref = args.filter((x) => !x.startsWith('-'))[0] ?? '';
  const ctr = byName(d, ref);
  if (ctr) {
    const ports: Record<string, unknown> = {};
    for (const p of ctr.ports) ports[`${p.container}/tcp`] = [{ HostIp: '0.0.0.0', HostPort: String(p.host) }];
    c.out(JSON.stringify([{ Id: ctr.id, Name: '/' + ctr.name, State: { Status: ctr.status, Running: ctr.status === 'running', ExitCode: ctr.exitCode ?? 0 }, Config: { Image: ctr.image, Cmd: ctr.command.split(' '), Env: Object.entries(ctr.env).map(([k, v]) => `${k}=${v}`) }, NetworkSettings: { Ports: ports, IPAddress: '172.17.0.2' } }], null, 4) + '\n');
    return 0;
  }
  const hit = find(d, ref);
  if (!hit) {
    c.err(`Error: No such object: ${ref}\n`);
    return 1;
  }
  const im = hit.image;
  c.out(JSON.stringify([{ Id: im.id, RepoTags: d.tags.filter((t) => t.id === im.id).map((t) => `${t.repo}:${t.tag}`), Architecture: im.arch, Os: 'linux', Size: im.size, Config: { Env: Object.entries(im.config.env).map(([k, v]) => `${k}=${v}`), Cmd: im.config.cmd, Entrypoint: im.config.entrypoint, WorkingDir: im.config.workdir, User: im.config.user, ExposedPorts: Object.fromEntries(im.config.ports.map((p) => [`${p}/tcp`, {}])), ...(im.config.health ? { Healthcheck: { Test: ['CMD-SHELL', im.config.health.cmd], Interval: im.config.health.interval * 1e9, Retries: im.config.health.retries } } : {}) }, RootFS: { Type: 'layers', Layers: im.layers.filter((l) => l.size > 0).map((_l, k) => 'sha256:' + stableId(`rl:${im.id}:${k}`, '', 64, 'hex')) } }], null, 4) + '\n');
  return 0;
}

const USAGE = `Usage:  docker [OPTIONS] COMMAND

A self-sufficient runtime for containers

Common Commands:
  run         Create and run a new container from an image
  build       Build an image from a Dockerfile
  images      List images
  ps          List containers
  login       Authenticate to a registry
  pull        Download an image from a registry
  push        Upload an image to a registry
  tag         Create a tag TARGET_IMAGE that refers to SOURCE_IMAGE
  logs        Fetch the logs of a container
  stop        Stop one or more running containers
  rm          Remove one or more containers
  rmi         Remove one or more images
  history     Show the history of an image
  inspect     Return low-level information on Docker objects
`;

defineCommand(
  'docker',
  {
    summary: 'Docker (simulado): construye, etiqueta, sube y ejecuta imágenes de contenedores',
    usage: 'docker <orden> [opciones]',
    category: 'redes',
    noHelp: true,
    level: 3,
    examples: [['docker build -t tienda:1.0 .', 'construye una imagen con el Dockerfile del directorio'], ['docker run -d -p 8080:5000 tienda:1.0', 'arranca un contenedor']],
  },
  async (c) => {
    const acct = awsAccountOf(c.sh.sys);
    if (!acct) return c.fail('command not found', 127);
    const sysClock = c.sh.sys.clock;
    acct.clock = Math.max(acct.clock, sysClock.now);
    const [sub, ...rest] = c.args;
    let rc: number;
    switch (sub) {
      case undefined:
      case '--help':
      case 'help':
        c.out(USAGE);
        rc = 0;
        break;
      case '--version':
      case '-v':
        c.out('Docker version 26.1.4, build 5650f9b\n');
        rc = 0;
        break;
      case 'version':
        c.out('Client:\n Version:           26.1.4\n API version:       1.45\n OS/Arch:           linux/amd64\n\nServer: Docker Engine - Community\n Engine:\n  Version:          26.1.4\n');
        rc = 0;
        break;
      case 'build':
        rc = await cmdBuild(c, acct, rest);
        break;
      case 'buildx':
        rc = rest[0] === 'build' ? await cmdBuild(c, acct, rest.slice(1)) : 0;
        break;
      case 'images':
      case 'image':
        rc = sub === 'image' && rest[0] === 'rm' ? cmdRmi(c, acct, rest.slice(1)) : cmdImages(c, acct, sub === 'image' ? rest.slice(1) : rest);
        break;
      case 'login':
        rc = await cmdLogin(c, acct, rest);
        break;
      case 'logout':
        delete dockerOf(acct).logins[rest[0] ?? ''];
        c.out(`Removing login credentials for ${rest[0] ?? 'https://index.docker.io/v1/'}\n`);
        rc = 0;
        break;
      case 'push':
        rc = cmdPush(c, acct, rest);
        break;
      case 'pull':
        rc = cmdPull(c, acct, rest);
        break;
      case 'tag':
        rc = cmdTag(c, acct, rest);
        break;
      case 'run':
        rc = cmdRun(c, acct, rest);
        break;
      case 'ps':
      case 'container':
        rc = sub === 'container' && rest[0] === 'rm' ? cmdRm(c, acct, rest.slice(1)) : cmdPs(c, acct, sub === 'container' ? rest.slice(1) : rest);
        break;
      case 'logs':
        rc = cmdLogs(c, acct, rest);
        break;
      case 'stop':
        rc = cmdStop(c, acct, rest);
        break;
      case 'kill':
        rc = cmdStop(c, acct, rest, true);
        break;
      case 'rm':
        rc = cmdRm(c, acct, rest);
        break;
      case 'rmi':
        rc = cmdRmi(c, acct, rest);
        break;
      case 'history':
        rc = cmdHistory(c, acct, rest);
        break;
      case 'inspect':
        rc = cmdInspect(c, acct, rest);
        break;
      default:
        c.err(`docker: '${sub}' is not a docker command.\nSee 'docker --help'\n`);
        rc = 1;
    }
    sysClock.now = Math.max(sysClock.now, acct.clock);
    return rc;
  },
);

// ───────────────────────── curl a un contenedor publicado ─────────────────────────

httpHandlers.push((req) => {
  if (!['localhost', '127.0.0.1', '0.0.0.0'].includes(req.host)) return null;
  const a = awsAccountOf(req.sys as System);
  if (!a) return null;
  const d = a.docker;
  const ctr = d?.containers.find((x) => x.status === 'running' && x.ports.some((p) => p.host === req.port));
  if (!ctr || !d) return null;
  const mapping = ctr.ports.find((p) => p.host === req.port)!;
  const img = d.images[ctr.imageId];
  if (ctr.serverPort === undefined || !img) return { ok: false, curlCode: 52, error: 'Empty reply from server' };
  const server: ServerInfo = { port: ctr.serverPort, bindAll: ctr.bindAll ?? true, kind: ctr.kind ?? 'flask' };
  const out = containerHttp(img, runOpts(a, ctr.env), server, mapping.container, { method: req.method, path: req.path + (req.query ? '?' + req.query : ''), body: req.body, headers: req.headers });
  if (out.refused) return { ok: false, curlCode: 52, error: 'Empty reply from server' };
  if (out.log) ctr.logs.push(...out.log.split('\n'));
  return { ok: true, status: out.status, type: out.headers?.['Content-Type'] ?? 'text/html', body: out.body ?? '', size: (out.body ?? '').length, headers: out.headers };
});

