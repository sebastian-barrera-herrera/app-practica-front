/** Dockerfile: análisis y construcción de imágenes sobre un sistema de archivos en memoria (sin Docker de verdad). */
import { stableId } from '../util';
import type { ImageCfg, ImageData } from '../types-containers';
import { baseConfig, findBase, pipResolve, pipSize, type BaseImage } from './catalog';

export interface DfInstr {
  op: string;
  args: string;
  line: number;
  flags: Record<string, string>;
}

export function parseDockerfile(text: string): { instrs: DfInstr[]; error?: string } {
  const instrs: DfInstr[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const start = i + 1;
    let line = lines[i++];
    if (/^\s*(#.*)?$/.test(line)) continue;
    // continuación con «\»
    while (/\\\s*$/.test(line) && i < lines.length) {
      line = line.replace(/\\\s*$/, ' ') + lines[i++].replace(/^\s*#.*$/, '');
    }
    const m = /^\s*([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!m) return { instrs, error: `dockerfile parse error on line ${start}: unknown instruction: ${line.trim().split(/\s+/)[0]}` };
    const op = m[1].toUpperCase();
    if (!['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL', 'MAINTAINER'].includes(op)) {
      return { instrs, error: `dockerfile parse error on line ${start}: unknown instruction: ${m[1]} (did you mean ${m[1].toUpperCase() === 'RUNN' ? 'RUN' : 'RUN'}?)` };
    }
    let args = m[2].trim();
    const flags: Record<string, string> = {};
    for (;;) {
      const f = /^--([a-z-]+)(?:=(\S+))?\s*/.exec(args);
      if (!f || op === 'CMD' || op === 'ENTRYPOINT' || op === 'ENV' || op === 'LABEL') break;
      flags[f[1]] = f[2] ?? 'true';
      args = args.slice(f[0].length);
    }
    instrs.push({ op, args, line: start, flags });
  }
  if (!instrs.some((x) => x.op === 'FROM')) return { instrs, error: 'the Dockerfile must start with FROM (at least one FROM instruction is required)' };
  return { instrs };
}

// ───────────────────────── utilidades ─────────────────────────

const norm = (p: string): string => {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return '/' + out.join('/');
};
const join = (dir: string, p: string) => (p.startsWith('/') ? norm(p) : norm(dir + '/' + p));

function globRe(g: string): RegExp {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += '.*';
        i++;
        if (g[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

/** Divide por `&&` fuera de comillas. */
function splitAnd(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '&' && text[i + 1] === '&') {
      out.push(cur.trim());
      cur = '';
      i++;
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const words = (s: string): string[] => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^(["'])(.*)\1$/, '$2'));

/** Una orden en forma `exec` (JSON) o `shell`. */
function execForm(args: string): string[] {
  const t = args.trim();
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v)) return v.map(String);
    } catch {
      /* se trata como forma shell */
    }
  }
  return ['/bin/sh', '-c', t];
}

// ───────────────────────── construcción ─────────────────────────

interface Stage {
  name?: string;
  base: string;
  arch: 'amd64' | 'arm64';
  runtime: ImageData['runtime'];
  files: Record<string, string>;
  baseFiles: Set<string>;
  cfg: ImageCfg;
  layers: { cmd: string; size: number }[];
  size: number;
  pkgs: { name: string; version: string }[];
  osName: string;
}

export interface BuildCtx {
  /** Archivos del contexto: ruta relativa → contenido. */
  files: Map<string, string>;
  dockerfile: string;
  platform: 'amd64' | 'arm64';
  buildArgs: Record<string, string>;
  /** Imágenes locales (por `repo:tag`) que se pueden usar con FROM. */
  local: (ref: string) => ImageData | undefined;
  /** Ejecuta una orden de shell sobre el sistema de archivos de la etapa (para los `RUN` que no son pip/apt). */
  shell: (script: string, files: Map<string, string>, cwd: string, env: Record<string, string>) => { code: number; out: string };
}

export interface BuildResult {
  ok: boolean;
  image?: ImageData;
  /** Líneas de salida de `docker build`. */
  log: string[];
  error?: string;
}

const subst = (s: string, vars: Record<string, string>) => s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, d, b) => vars[a ?? b] ?? d ?? '');

const dockerHub = (ref: string) => (ref.includes('/') ? ref : `docker.io/library/${ref}`);

function loadIgnore(ctx: BuildCtx): ((p: string) => boolean) {
  const text = ctx.files.get('.dockerignore');
  if (!text) return () => false;
  const pats = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^\//, '').replace(/\/$/, ''));
  const res = pats.map((p) => ({ neg: p.startsWith('!'), re: globRe(p.replace(/^!/, '')) }));
  return (path) => {
    let ignored = false;
    for (const { neg, re } of res) {
      const parts = path.split('/');
      const hit = parts.some((_x, k) => re.test(parts.slice(0, k + 1).join('/')));
      if (hit) ignored = !neg;
    }
    return ignored;
  };
}

function initStage(base: BaseImage | ImageData, name: string | undefined, ref: string, arch: 'amd64' | 'arm64'): Stage {
  if ('layers' in base) {
    return { name, base: ref, arch: base.arch, runtime: base.runtime, files: { ...base.files }, baseFiles: new Set(Object.keys(base.files)), cfg: { ...base.config, env: { ...base.config.env }, ports: [...base.config.ports] }, layers: base.layers.map((l) => ({ ...l })), size: base.size, pkgs: base.pkgs.map((p) => ({ ...p })), osName: base.base };
  }
  return { name, base: ref, arch, runtime: base.runtime, files: { ...base.files }, baseFiles: new Set(Object.keys(base.files)), cfg: baseConfig(base), layers: [{ cmd: `FROM ${dockerHub(ref)}`, size: base.size }], size: base.size, pkgs: base.pkgs.map((p) => ({ ...p })), osName: base.os };
}

function fsMap(st: Stage): Map<string, string> {
  return new Map(Object.entries(st.files));
}

function pipInstall(st: Stage, args: string[], ctx: { stage: Stage }): { code: number; out: string[]; size: number } {
  const out: string[] = [];
  if (st.runtime !== 'python') return { code: 127, out: ['/bin/sh: 1: pip: not found'], size: 0 };
  const specs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-r' || a === '--requirement') {
      const f = args[++i];
      const path = join(st.cfg.workdir, f ?? '');
      const text = st.files[path];
      if (text === undefined) return { code: 1, out: [`ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${f}'`], size: 0 };
      for (const l of text.split('\n')) {
        const t = l.replace(/#.*$/, '').trim();
        if (t && !t.startsWith('-')) specs.push(t);
      }
    } else if (!a.startsWith('-')) specs.push(a);
  }
  if (!specs.length) return { code: 1, out: ['ERROR: You must give at least one requirement to install (see "pip help install")'], size: 0 };
  void ctx;
  let size = 0;
  const installed: { name: string; version: string }[] = [];
  for (const sp of specs) {
    const m = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:(==|>=|<=|~=|>|<)\s*([A-Za-z0-9.*+_-]+))?/.exec(sp);
    if (!m) return { code: 1, out: [`ERROR: Invalid requirement: '${sp}'`], size: 0 };
    const pinned = m[2] === '==' ? m[3] : undefined;
    for (const p of pipResolve(m[1], pinned)) {
      if (!installed.some((x) => x.name === p.name)) {
        installed.push(p);
        size += pipSize(p.name);
      }
      out.push(`Collecting ${p.name}${pinned && p.name === m[1].toLowerCase() ? '==' + pinned : ''}`);
    }
  }
  for (const p of installed) {
    const k = st.pkgs.findIndex((x) => x.name === p.name);
    if (k >= 0) st.pkgs[k] = p;
    else st.pkgs.push(p);
  }
  out.push(`Successfully installed ${installed.map((p) => `${p.name}-${p.version}`).join(' ')}`);
  return { code: 0, out, size };
}

function sysInstall(st: Stage, mgr: string, args: string[]): { code: number; out: string[]; size: number } {
  const debian = /debian|ubuntu/i.test(st.osName);
  const alpine = /alpine/i.test(st.osName);
  const rpm = /amazon/i.test(st.osName);
  if ((mgr === 'apt-get' || mgr === 'apt') && !debian) return { code: 127, out: [`/bin/sh: 1: ${mgr}: not found`], size: 0 };
  if (mgr === 'apk' && !alpine) return { code: 127, out: ['/bin/sh: 1: apk: not found'], size: 0 };
  if ((mgr === 'yum' || mgr === 'dnf') && !rpm) return { code: 127, out: [`/bin/sh: 1: ${mgr}: not found`], size: 0 };
  const sub = args[0];
  if (sub === 'update') return { code: 0, out: ['Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]', 'Reading package lists...'], size: 31 * 1024 * 1024 };
  if (sub !== 'install' && sub !== 'add') return { code: 0, out: [], size: 0 };
  const pk = args.slice(1).filter((a) => !a.startsWith('-'));
  if (!pk.length) return { code: 1, out: ['E: No packages specified'], size: 0 };
  for (const p of pk) if (!st.pkgs.some((x) => x.name === p)) st.pkgs.push({ name: p, version: '1.0' });
  return { code: 0, out: [`Setting up ${pk.join(' ')} ...`], size: pk.length * 18 * 1024 * 1024 };
}

export function buildImage(ctx: BuildCtx): BuildResult {
  const log: string[] = [];
  const parsed = parseDockerfile(ctx.dockerfile);
  if (parsed.error) return { ok: false, log: [`ERROR: failed to solve: failed to read dockerfile: ${parsed.error}`], error: parsed.error };
  const instrs = parsed.instrs;
  const ignored = loadIgnore(ctx);
  const total = instrs.filter((x) => ['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR'].includes(x.op)).length;
  const stages: Stage[] = [];
  const vars: Record<string, string> = { ...ctx.buildArgs };
  let cur: Stage | undefined;
  let step = 0;
  let t = 0.4;
  const dfBytes = ctx.dockerfile.length;
  log.push(`[+] Building ${(1 + total * 0.9).toFixed(1)}s (${total + 4}/${total + 4}) FINISHED${' '.repeat(26)}docker:default`);
  log.push(` => [internal] load build definition from Dockerfile${' '.repeat(24)}0.0s`);
  log.push(` => => transferring dockerfile: ${dfBytes}B${' '.repeat(34)}0.0s`);
  const fail = (n: number, cmd: string, why: string, detail: string[]): BuildResult => {
    const out = [...log, ` => ERROR [${n}] ${cmd}${' '.repeat(10)}${t.toFixed(1)}s`, '------', ` > [${n}] ${cmd}:`, ...detail.map((d, k) => `${(0.3 + k * 0.1).toFixed(2)} ${d}`), '------', `ERROR: failed to solve: ${why}`];
    return { ok: false, log: out, error: why };
  };
  const label = (n: number) => `${n}/${total}`;
  for (const ins of instrs) {
    const args = subst(ins.args, vars);
    switch (ins.op) {
      case 'ARG': {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(args.trim());
        if (m && vars[m[1]] === undefined && m[2] !== undefined) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
        break;
      }
      case 'FROM': {
        const m = /^(\S+)(?:\s+AS\s+(\S+))?$/i.exec(args.trim());
        if (!m) return { ok: false, log: [...log, `ERROR: failed to solve: invalid FROM instruction at line ${ins.line}`], error: 'FROM' };
        const ref = m[1];
        const plat = (ins.flags.platform ?? '').includes('arm64') ? 'arm64' : (ins.flags.platform ?? '').includes('amd64') ? 'amd64' : ctx.platform;
        step++;
        const prev = stages.find((s) => s.name === ref);
        const base = prev ? undefined : (ctx.local(ref) ?? findBase(ref));
        if (!prev && !base) {
          log.push(` => ERROR [internal] load metadata for ${dockerHub(ref)}${' '.repeat(10)}0.5s`);
          log.push('------');
          log.push(` > [internal] load metadata for ${dockerHub(ref)}:`);
          log.push('------');
          const why = `${dockerHub(ref)}: failed to resolve source metadata for ${dockerHub(ref)}: ${dockerHub(ref)}: not found`;
          log.push(`ERROR: failed to solve: ${why}`);
          return { ok: false, log, error: why };
        }
        cur = prev
          ? { ...prev, name: m[2], files: { ...prev.files }, cfg: { ...prev.cfg, env: { ...prev.cfg.env }, ports: [...prev.cfg.ports] }, layers: prev.layers.map((l) => ({ ...l })), pkgs: prev.pkgs.map((p) => ({ ...p })), baseFiles: new Set(Object.keys(prev.files)) }
          : initStage(base!, m[2], ref, plat);
        stages.push(cur);
        log.push(` => [internal] load metadata for ${dockerHub(ref)}${' '.repeat(26)}${(0.4).toFixed(1)}s`);
        log.push(` => [internal] load .dockerignore${' '.repeat(40)}0.0s`);
        log.push(` => [${label(step)}] FROM ${dockerHub(ref)}${' '.repeat(10)}0.0s`);
        t += 0.4;
        break;
      }
      default: {
        if (!cur) return { ok: false, log: [...log, `ERROR: failed to solve: dockerfile parse error on line ${ins.line}: no build stage in current context`], error: 'no stage' };
        const st = cur;
        switch (ins.op) {
          case 'ENV': {
            const rest = args.trim();
            const pairs = /=/.test(rest.split(/\s+/)[0] ?? '') ? words(rest).map((w) => w.split(/=(.*)/s)) : [[rest.split(/\s+/)[0], rest.replace(/^\S+\s+/, '')]];
            for (const [k, v] of pairs) if (k) st.cfg.env[k] = (v ?? '').replace(/^["']|["']$/g, '');
            break;
          }
          case 'WORKDIR': {
            st.cfg.workdir = join(st.cfg.workdir, args.trim());
            step++;
            log.push(` => [${label(step)}] WORKDIR ${st.cfg.workdir}${' '.repeat(30)}0.0s`);
            st.layers.push({ cmd: `WORKDIR ${st.cfg.workdir}`, size: 0 });
            break;
          }
          case 'USER':
            st.cfg.user = args.trim();
            break;
          case 'EXPOSE':
            for (const p of args.split(/\s+/)) {
              const n = Number(p.replace(/\/.*$/, ''));
              if (n && !st.cfg.ports.includes(n)) st.cfg.ports.push(n);
            }
            break;
          case 'CMD':
            st.cfg.cmd = execForm(args);
            break;
          case 'ENTRYPOINT':
            st.cfg.entrypoint = execForm(args);
            break;
          case 'HEALTHCHECK': {
            if (/^NONE$/i.test(args.trim())) {
              st.cfg.health = undefined;
              break;
            }
            const f = { interval: 30, timeout: 30, retries: 3, startPeriod: 0 };
            let rest = args;
            for (const [k, v] of Object.entries(ins.flags)) {
              const n = Number(v.replace(/s$/, ''));
              if (k === 'interval') f.interval = n;
              else if (k === 'timeout') f.timeout = n;
              else if (k === 'retries') f.retries = n;
              else if (k === 'start-period') f.startPeriod = n;
            }
            rest = rest.replace(/^CMD\s+/i, '');
            st.cfg.health = { cmd: rest.trim(), ...f };
            break;
          }
          case 'COPY':
          case 'ADD': {
            step++;
            const from = ins.flags.from;
            const src: Record<string, string> = {};
            if (from) {
              const other = stages.find((s) => s.name === from || String(stages.indexOf(s)) === from);
              if (!other) return fail(step, `${ins.op} --from=${from}`, `failed to resolve source: stage ${from} not found`, []);
              for (const [k, v] of Object.entries(other.files)) src[k] = v;
            } else for (const [k, v] of ctx.files) if (!ignored(k)) src['/' + k] = v;
            const parts = args.startsWith('[') ? (JSON.parse(args) as string[]) : words(args);
            const dest = parts[parts.length - 1];
            const sources = parts.slice(0, -1);
            if (!sources.length || !dest) return fail(step, `${ins.op} ${args}`, `dockerfile parse error on line ${ins.line}: ${ins.op} requires at least two arguments`, []);
            const destDir = join(st.cfg.workdir, dest);
            let bytes = 0;
            const asDir = dest.endsWith('/') || sources.length > 1 || dest === '.' || dest === '..';
            for (const s of sources) {
              const base = from ? (s.startsWith('/') ? norm(s) : join(st.cfg.workdir, s)) : norm(s.replace(/^\.\//, ''));
              const isRoot = base === '/';
              const re = globRe(base.replace(/\/$/, ''));
              const hits = Object.entries(src).filter(([k]) => k === base || re.test(k) || isRoot || k.startsWith(base.replace(/\/$/, '') + '/'));
              if (!hits.length) {
                const label2 = from ? `${s}` : `/${s.replace(/^\.\//, '')}`;
                return fail(step, `${ins.op} ${args}`, `failed to compute cache key: failed to calculate checksum of ref ${stableId(args + ins.line, '', 12, 'hex')}::${stableId('r' + args, '', 20, 'hex')}: "${label2}": not found`, []);
              }
              const exact = hits.length === 1 && hits[0][0] === base;
              for (const [k, v] of hits) {
                const rel = exact ? k.split('/').pop()! : isRoot ? k.slice(1) : k.slice(base.replace(/\/$/, '').length + 1) || k.split('/').pop()!;
                const target = exact && !asDir ? destDir : join(destDir, rel);
                st.files[target] = v;
                bytes += v.length;
              }
            }
            st.layers.push({ cmd: `${ins.op} ${ins.args}`, size: bytes });
            st.size += bytes;
            log.push(` => [${label(step)}] ${ins.op} ${ins.args}${' '.repeat(10)}0.1s`);
            break;
          }
          case 'RUN': {
            step++;
            let size = 0;
            const outLines: string[] = [];
            let code = 0;
            const env = { ...st.cfg.env };
            for (const part of splitAnd(args.replace(/^\/bin\/sh -c\s+/, ''))) {
              const w = words(part);
              const prog = w[0] ?? '';
              let r: { code: number; out: string[]; size: number };
              if (prog === 'pip' || prog === 'pip3' || (/^python3?$/.test(prog) && w[1] === '-m' && w[2] === 'pip')) {
                const a2 = prog === 'pip' || prog === 'pip3' ? w.slice(1) : w.slice(3);
                r = a2[0] === 'install' ? pipInstall(st, a2.slice(1), { stage: st }) : { code: 0, out: [], size: 0 };
              } else if (['apt-get', 'apt', 'apk', 'yum', 'dnf'].includes(prog)) r = sysInstall(st, prog, w.slice(1));
              else {
                const files = fsMap(st);
                const before = new Map(files);
                const res = ctx.shell(part, files, st.cfg.workdir, env);
                let added = 0;
                for (const [k, v] of files) if (before.get(k) !== v) {
                  st.files[k] = v;
                  added += v.length;
                }
                for (const k of before.keys()) if (!files.has(k)) delete st.files[k];
                r = { code: res.code, out: res.out.split('\n').filter((x) => x), size: added };
              }
              outLines.push(...r.out);
              size += r.size;
              if (r.code !== 0) {
                code = r.code;
                break;
              }
            }
            if (code !== 0) return fail(step, `RUN ${ins.args}`, `process "/bin/sh -c ${args}" did not complete successfully: exit code: ${code}`, outLines.slice(-12));
            st.layers.push({ cmd: `RUN ${ins.args}`, size: Math.max(size, 1024) });
            st.size += Math.max(size, 1024);
            t += 0.8;
            log.push(` => [${label(step)}] RUN ${ins.args}${' '.repeat(10)}${(0.5 + size / 20_000_000).toFixed(1)}s`);
            break;
          }
          default:
            break;
        }
      }
    }
  }
  const last = stages[stages.length - 1];
  if (!last) return { ok: false, log: [...log, 'ERROR: failed to solve: no stages'], error: 'no stages' };
  const files: Record<string, string> = { ...last.files };
  const cfg = last.cfg;
  const id = 'sha256:' + stableId(JSON.stringify({ b: last.base, f: files, c: cfg, l: last.layers.map((l) => l.cmd), a: last.arch }), '', 64, 'hex');
  const image: ImageData = { id, arch: last.arch, base: last.base, created: 0, size: last.size, layers: last.layers, config: cfg, files, pkgs: last.pkgs, runtime: last.runtime };
  log.push(` => exporting to image${' '.repeat(40)}0.3s`);
  log.push(` => => writing image ${id}${' '.repeat(10)}0.0s`);
  return { ok: true, image, log };
}
