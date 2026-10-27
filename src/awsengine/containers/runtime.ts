/** Ejecución de contenedores simulados: el `CMD` de la imagen se ejecuta de verdad (Python y shell) y los servidores web responden peticiones. */
import { PySession } from '../../pyengine/session';
import { awsBridge } from '../../pyengine/stdlib/aws';
import { MiniShell } from '../minish';
import type { Caller } from '../registry';
import { sdkCall } from '../sdk';
import type { Account } from '../types';
import type { ImageData } from '../types-containers';
import { PIP_MODULES } from './catalog';

export interface RunOpts {
  acct: Account;
  region: string;
  /** Variables de entorno que se suman (o pisan) a las de la imagen. */
  env: Record<string, string>;
  /** Sustituye al `CMD` de la imagen. */
  args?: string[] | null;
  /** Arquitectura del anfitrión (donde se ejecuta el contenedor). */
  hostArch: 'amd64' | 'arm64';
  /** Identidad de la que salen las llamadas de `boto3` dentro del contenedor (el rol de la tarea). */
  caller?: Caller | null;
  now: number;
}

export interface ServerInfo {
  port: number;
  /** Escucha en todas las interfaces (0.0.0.0); si no, solo dentro del propio contenedor. */
  bindAll: boolean;
  kind: 'flask' | 'gunicorn' | 'nginx';
}

export interface RunOut {
  code: number;
  lines: string[];
  server?: ServerInfo;
  /** Sigue ejecutándose sin servir nada (`sleep infinity`). */
  idle?: boolean;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000');

export const shQuote = (a: string) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

export function commandOf(img: ImageData, args?: string[] | null): string[] {
  const ep = img.config.entrypoint ?? [];
  const cmd = args ?? img.config.cmd ?? [];
  return [...ep, ...cmd];
}

export function installedModules(img: ImageData): string[] {
  const out: string[] = [];
  for (const p of img.pkgs) for (const m of PIP_MODULES[p.name] ?? []) out.push(m);
  return out;
}

const envOf = (img: ImageData, o: RunOpts): Record<string, string> => ({
  ...img.config.env,
  HOSTNAME: 'a1b2c3d4e5f6',
  AWS_REGION: o.region,
  AWS_DEFAULT_REGION: o.region,
  ...o.env,
});

function newSession(img: ImageData, o: RunOpts, env: Record<string, string>): PySession {
  const s = new PySession({ files: img.files, cwd: img.config.workdir, now: o.now, seed: 7, maxSteps: 3_000_000, installed: installedModules(img) });
  s.runSync(`import os\nos.environ.update(${JSON.stringify(env)})`);
  return s;
}

function withBridge<T>(o: RunOpts, fn: () => T): T {
  const prev = awsBridge.call;
  awsBridge.call = (service, op, params, reg) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(params) as Record<string, unknown>;
    } catch {
      return JSON.stringify({ __error: { Code: 'SerializationException', Message: 'Could not parse the request parameters.', Status: 400 } });
    }
    if (!o.caller) return JSON.stringify({ __error: { Code: 'NoCredentialsError', Message: 'Unable to locate credentials' } });
    const r = sdkCall(o.acct, reg || o.region, o.caller, service, op, parsed);
    return JSON.stringify(r.ok ? r.data : { __error: r.error });
  };
  try {
    return fn();
  } finally {
    awsBridge.call = prev;
  }
}

const lines = (s: string) => s.split('\n').filter((l, i, a) => l !== '' || i < a.length - 1).map((l) => l.replace(/\r$/, ''));

/** Dirección y puerto de un servidor de Flask según el mensaje que imprime. */
function flaskServer(out: string): ServerInfo | undefined {
  const all = /Running on all addresses \(0\.0\.0\.0\)/.test(out);
  const m = /Running on http:\/\/([0-9.]+):(\d+)/.exec(out);
  if (!m) return undefined;
  return { port: Number(m[2]), bindAll: all || m[1] === '0.0.0.0', kind: 'flask' };
}

/** Ejecuta el comando del contenedor. Si es un servidor, devuelve su puerto y sigue «en marcha». */
export function runContainer(img: ImageData, o: RunOpts): RunOut {
  const argv = commandOf(img, o.args);
  const env = envOf(img, o);
  if (!argv.length) return { code: 1, lines: ['docker: Error response from daemon: no command specified.'] };
  if (img.arch !== o.hostArch) return { code: 255, lines: [`exec ${argv[0]}: exec format error`] };
  let prog = argv[0].split('/').pop() ?? '';
  let a = argv.slice(1);
  // `/bin/sh -c "python app.py"` (forma shell) → se interpreta la orden
  if (/^(sh|bash|ash)$/.test(prog) && a[0] === '-c' && a[1]) {
    const w = a[1].trim().split(/\s+/);
    if (!/[|;&<>$`]/.test(a[1]) && w.length) {
      prog = w[0].split('/').pop() ?? '';
      a = w.slice(1);
    } else return runShell(img, o, a[1], env);
  }
  if (/^python3?$/.test(prog)) {
    const rest = a.filter((x) => x !== '-u');
    if (rest[0] === '-c') {
      return withBridge(o, () => {
        const s = newSession(img, o, env);
        const r = s.runSync(rest[1] ?? '', { filename: '<string>' });
        return { code: r.ok ? 0 : 1, lines: lines(r.stdout + r.stderr) };
      });
    }
    const script = rest.find((x) => !x.startsWith('-'));
    if (rest[0] === '-m' && rest[1] === 'http.server') return { code: 1, lines: ['ModuleNotFoundError: no hay servidor http.server en este simulador; usa Flask'] };
    if (!script) return { code: 0, lines: [] };
    const path = script.startsWith('/') ? script : `${img.config.workdir.replace(/\/$/, '')}/${script}`;
    const src = img.files[path];
    if (src === undefined) return { code: 2, lines: [`python3: can't open file '${path}': [Errno 2] No such file or directory`] };
    return withBridge(o, () => {
      const s = newSession(img, o, env);
      const r = s.runSync(src, { filename: script });
      const out = r.stdout + r.stderr;
      const server = r.ok ? flaskServer(r.stdout) : undefined;
      return { code: r.ok ? 0 : 1, lines: lines(out), ...(server ? { server } : {}) };
    });
  }
  if (prog === 'gunicorn') {
    if (!img.pkgs.some((p) => p.name === 'gunicorn')) return { code: 127, lines: ['/bin/sh: 1: gunicorn: not found'] };
    let bind = '127.0.0.1:8000';
    let target = '';
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-b' || a[i] === '--bind') bind = a[++i] ?? bind;
      else if (a[i].startsWith('--bind=')) bind = a[i].slice(7);
      else if (['-w', '--workers', '-t', '--timeout', '-k'].includes(a[i])) i++;
      else if (!a[i].startsWith('-')) target = a[i];
    }
    const [mod, variable = 'app'] = target.split(':');
    const path = `${img.config.workdir.replace(/\/$/, '')}/${mod.replace(/\./g, '/')}.py`;
    const [host, port] = bind.includes(':') ? bind.split(':') : ['0.0.0.0', bind];
    const ver = img.pkgs.find((p) => p.name === 'gunicorn')?.version ?? '22.0.0';
    const head = [`[${stamp(o.now)}] [1] [INFO] Starting gunicorn ${ver}`, `[${stamp(o.now)}] [1] [INFO] Listening at: http://${host}:${port} (1)`, `[${stamp(o.now)}] [1] [INFO] Using worker: sync`, `[${stamp(o.now)}] [7] [INFO] Booting worker with pid: 7`];
    if (img.files[path] === undefined) return { code: 3, lines: [...head.slice(0, 3), `Failed to find attribute '${variable}' in '${mod}'.`, `[${stamp(o.now)}] [1] [INFO] Shutting down: Master`, `[${stamp(o.now)}] [1] [ERROR] Reason: App failed to load.`] };
    const res = withBridge(o, () => {
      const s = newSession(img, o, env);
      return s.runSync(`import importlib\n_m = importlib.import_module('${mod}')\nassert hasattr(_m, '${variable}')`);
    });
    if (!res.ok) return { code: 3, lines: [...head.slice(0, 3), ...lines(res.stderr), `[${stamp(o.now)}] [7] [ERROR] Exception in worker process`, `[${stamp(o.now)}] [1] [ERROR] Worker (pid:7) exited with code 3`, `[${stamp(o.now)}] [1] [ERROR] Shutting down: Master`, `[${stamp(o.now)}] [1] [ERROR] Reason: Worker failed to boot.`] };
    return { code: 0, lines: head, server: { port: Number(port), bindAll: host === '0.0.0.0', kind: 'gunicorn' } };
  }
  if (prog === 'nginx') {
    if (img.runtime !== 'nginx') return { code: 127, lines: ['/bin/sh: 1: nginx: not found'] };
    const conf = Object.entries(img.files).find(([k]) => k.startsWith('/etc/nginx/') && k.endsWith('.conf'))?.[1] ?? '';
    const port = Number(/listen\s+(\d+)/.exec(conf)?.[1] ?? 80);
    const v = img.config.env.NGINX_VERSION ?? '1.27.0';
    return {
      code: 0,
      lines: ['/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration', '/docker-entrypoint.sh: Configuration complete; ready for start up', `${stamp(o.now).slice(0, 10).replace(/-/g, '/')} ${stamp(o.now).slice(11, 19)} [notice] 1#1: nginx/${v}`, `${stamp(o.now).slice(0, 10).replace(/-/g, '/')} ${stamp(o.now).slice(11, 19)} [notice] 1#1: start worker processes`],
      server: { port, bindAll: true, kind: 'nginx' },
    };
  }
  const joined = [prog, ...a].map(shQuote).join(' ');
  if (/^(sleep (infinity|[0-9]{3,})|tail -f \/dev\/null)$/.test(joined)) return { code: 0, lines: [], idle: true };
  return runShell(img, o, [argv[0], ...argv.slice(1)].map(shQuote).join(' '), env);
}

function runShell(img: ImageData, o: RunOpts, script: string, env: Record<string, string>): RunOut {
  const files = new Map(Object.entries(img.files));
  const out: string[] = [];
  const clock = o.acct.clock;
  const sh = new MiniShell({ acct: o.acct, files, vars: { ...env }, cwd: img.config.workdir, log: (l) => out.push(l) });
  let code: number;
  try {
    code = withBridge(o, () => sh.run(script));
  } finally {
    o.acct.clock = clock;
  }
  return { code, lines: out.flatMap((l) => l.split('\n')).filter((l) => l !== '') };
}

// ───────────────────────── peticiones HTTP ─────────────────────────

export interface HttpReq {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}

export interface HttpRes {
  /** El contenedor no atiende (nadie escucha en ese puerto o escucha solo en 127.0.0.1). */
  refused?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Línea de registro de acceso (para los registros del contenedor). */
  log?: string;
}

const MARK = '@@MINIWEB@@';

function nginxServe(img: ImageData, req: HttpReq, now: number): HttpRes {
  const conf = Object.entries(img.files).find(([k]) => k.startsWith('/etc/nginx/') && k.endsWith('.conf'))?.[1] ?? '';
  const root = /root\s+([^;\s]+);/.exec(conf)?.[1] ?? '/usr/share/nginx/html';
  const path = req.path.split('?')[0];
  const key = (root + (path.endsWith('/') ? path + 'index.html' : path)).replace(/\/+/g, '/');
  const body = img.files[key] ?? (img.files[key + '/index.html'] as string | undefined);
  const d = new Date(now);
  const t = `${String(d.getUTCDate()).padStart(2, '0')}/${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}/${d.getUTCFullYear()}:${d.toISOString().slice(11, 19)} +0000`;
  if (body === undefined) {
    const nf = '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.27.0</center>\r\n</body>\r\n</html>\r\n';
    return { status: 404, headers: { 'Content-Type': 'text/html', Server: 'nginx/1.27.0' }, body: nf, log: `172.17.0.1 - - [${t}] "${req.method} ${req.path} HTTP/1.1" 404 ${nf.length} "-" "curl/8.5.0" "-"` };
  }
  const type = key.endsWith('.json') ? 'application/json' : key.endsWith('.css') ? 'text/css' : key.endsWith('.js') ? 'application/javascript' : 'text/html';
  return { status: 200, headers: { 'Content-Type': type, Server: 'nginx/1.27.0' }, body, log: `172.17.0.1 - - [${t}] "${req.method} ${req.path} HTTP/1.1" 200 ${body.length} "-" "curl/8.5.0" "-"` };
}

/** Atiende una petición HTTP con el servidor del contenedor. `from` indica si llega desde fuera del contenedor. */
export function containerHttp(img: ImageData, o: RunOpts, server: ServerInfo, port: number, req: HttpReq, external = true): HttpRes {
  if (port !== server.port) return { refused: true };
  if (external && !server.bindAll) return { refused: true };
  if (server.kind === 'nginx') return nginxServe(img, req, o.now);
  const env = { ...envOf(img, o), __MINIWEB_REQ: JSON.stringify({ method: req.method, path: req.path, body: req.body ?? '', headers: req.headers ?? {} }) };
  const argv = commandOf(img, o.args);
  return withBridge(o, () => {
    const s = newSession(img, o, env);
    let r;
    if (server.kind === 'gunicorn') {
      const target = argv.find((x, i) => i > 0 && x.includes(':') && !x.startsWith('-') && !/^\d/.test(x)) ?? 'app:app';
      const [mod, variable = 'app'] = target.split(':');
      r = s.runSync(`import importlib\n_m = importlib.import_module('${mod}')\ngetattr(_m, '${variable}').__dispatch__()`);
    } else {
      const script = argv.find((x, i) => i > 0 && x.endsWith('.py')) ?? 'app.py';
      const path = script.startsWith('/') ? script : `${img.config.workdir.replace(/\/$/, '')}/${script}`;
      r = s.runSync(img.files[path] ?? '', { filename: script });
    }
    const out = r.stdout.split('\n');
    const m = out.find((l) => l.startsWith(MARK));
    const d = new Date(o.now);
    const t = `${String(d.getUTCDate()).padStart(2, '0')}/${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}/${d.getUTCFullYear()} ${d.toISOString().slice(11, 19)}`;
    const extra = out.filter((l) => l && !l.startsWith(MARK));
    if (!m) return { status: 500, headers: {}, body: 'Internal Server Error', log: [...extra, ...lines(r.stderr)].join('\n') || undefined };
    const res = JSON.parse(m.slice(MARK.length)) as { status: number; headers: Record<string, string>; body: string };
    const accessLine = server.kind === 'flask' ? `172.17.0.1 - - [${t}] "${req.method} ${req.path} HTTP/1.1" ${res.status} -` : undefined;
    return { status: res.status, headers: res.headers, body: res.body, log: [...extra, ...(accessLine ? [accessLine] : [])].join('\n') || undefined };
  });
}
