/** Internet simulado: DNS, sitios web y hosts remotos para ping/curl/wget/ssh. */
import { hash32, rng } from '../format';
import type { System } from '../sys';
import type { VFS } from '../vfs';

export interface Route {
  status: number;
  type: string;
  body: string;
  headers?: Record<string, string>;
  /** Para descargas binarias simuladas */
  size?: number;
}

export interface Site {
  host: string;
  ip: string;
  ptr?: string;
  up?: boolean;
  ssh?: boolean;
  https?: boolean;
  routes: Record<string, Route>;
  latency?: number;
}

const EXAMPLE_HTML = `<!doctype html>
<html>
<head>
    <title>Example Domain</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>

<body>
<div>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents. You may use this
    domain in literature without prior coordination or asking for permission.</p>
    <p><a href="https://www.iana.org/domains/example">More information...</a></p>
</div>
</body>
</html>
`;

const json = (o: unknown): Route => ({ status: 200, type: 'application/json', body: JSON.stringify(o, null, 2) + '\n' });
const text = (s: string, type = 'text/plain'): Route => ({ status: 200, type, body: s });

export const SITES: Site[] = [
  { host: 'google.com', ip: '142.250.185.46', ptr: 'lhr25s34-in-f14.1e100.net', latency: 14, https: true, routes: { '/': { status: 301, type: 'text/html', body: '<HTML><HEAD><meta http-equiv="content-type" content="text/html;charset=utf-8">\n<TITLE>301 Moved</TITLE></HEAD><BODY>\n<H1>301 Moved</H1>\nThe document has moved\n<A HREF="http://www.google.com/">here</A>.\n</BODY></HTML>\n', headers: { Location: 'http://www.google.com/' } } } },
  { host: 'www.google.com', ip: '142.250.185.68', ptr: 'lhr25s34-in-f4.1e100.net', latency: 14, https: true, routes: { '/': text('<!doctype html><html><head><title>Google</title></head><body>…</body></html>\n', 'text/html') } },
  { host: 'example.com', ip: '93.184.216.34', latency: 38, https: true, routes: { '/': text(EXAMPLE_HTML, 'text/html'), '/index.html': text(EXAMPLE_HTML, 'text/html') } },
  { host: 'www.example.com', ip: '93.184.216.34', latency: 38, https: true, routes: { '/': text(EXAMPLE_HTML, 'text/html') } },
  { host: 'github.com', ip: '140.82.121.4', latency: 52, https: true, routes: { '/': text('<!DOCTYPE html><html><head><title>GitHub</title></head><body>…</body></html>\n', 'text/html') } },
  { host: 'api.github.com', ip: '140.82.112.5', latency: 50, https: true, routes: {
    '/zen': text('Keep it logically awesome.\n'),
    '/': json({ current_user_url: 'https://api.github.com/user', emojis_url: 'https://api.github.com/emojis' }),
    '/users/torvalds': json({ login: 'torvalds', id: 1024025, name: 'Linus Torvalds', public_repos: 7, followers: 230000 }),
  } },
  { host: 'ubuntu.com', ip: '185.125.190.20', latency: 80, https: true, routes: { '/': text('<html><head><title>Ubuntu</title></head><body>Ubuntu</body></html>\n', 'text/html') } },
  { host: 'httpbin.org', ip: '54.91.203.120', latency: 120, https: true, routes: {
    '/get': json({ args: {}, headers: { Accept: '*/*', Host: 'httpbin.org', 'User-Agent': 'curl/8.5.0' }, origin: '203.0.113.42', url: 'https://httpbin.org/get' }),
    '/ip': json({ origin: '203.0.113.42' }),
    '/status/404': { status: 404, type: 'text/html', body: '' },
    '/status/500': { status: 500, type: 'text/html', body: '' },
    '/headers': json({ headers: { Accept: '*/*', Host: 'httpbin.org', 'User-Agent': 'curl/8.5.0' } }),
  } },
  { host: 'jsonplaceholder.typicode.com', ip: '104.21.64.1', latency: 45, https: true, routes: {
    '/todos/1': json({ userId: 1, id: 1, title: 'delectus aut autem', completed: false }),
    '/users/1': json({ id: 1, name: 'Leanne Graham', username: 'Bret', email: 'Sincere@april.biz' }),
    '/posts/1': json({ userId: 1, id: 1, title: 'sunt aut facere repellat provident', body: 'quia et suscipit…' }),
  } },
  { host: 'dns.google', ip: '8.8.8.8', ptr: 'dns.google', latency: 9, routes: {} },
  { host: 'one.one.one.one', ip: '1.1.1.1', ptr: 'one.one.one.one', latency: 7, https: true, routes: { '/': text('<html><head><title>1.1.1.1</title></head><body>Cloudflare DNS</body></html>\n', 'text/html') } },
  { host: 'ifconfig.me', ip: '34.160.111.145', latency: 30, https: true, routes: { '/': text('203.0.113.42\n'), '/ip': text('203.0.113.42\n') } },
  { host: 'wttr.in', ip: '5.9.243.187', latency: 150, https: true, routes: { '/': text('Madrid: ☀️ +18°C\n') } },
  { host: 'router.local', ip: '192.168.1.1', latency: 1.2, routes: { '/': text('<html><body><h1>Router admin</h1></body></html>\n', 'text/html') } },
  { host: 'server.local', ip: '192.168.1.10', latency: 0.9, ssh: true, routes: {
    '/': text('<html><body><h1>server.local</h1><ul><li><a href="files/data.csv">data.csv</a></li><li><a href="files/report.pdf">report.pdf</a></li><li><a href="backup.tar.gz">backup.tar.gz</a></li></ul></body></html>\n', 'text/html'),
    '/files/data.csv': text('id,nombre,valor\n1,alfa,10\n2,beta,20\n3,gamma,30\n'),
    '/files/report.pdf': { status: 200, type: 'application/pdf', body: '%PDF-1.7\n', size: 512000 },
    '/backup.tar.gz': { status: 200, type: 'application/gzip', body: '\x1f\x8b\x08\x00', size: 2048000 },
  } },
  { host: 'offline.test', ip: '10.255.255.1', up: false, latency: 0, routes: {} },
];

export const BY_HOST = new Map(SITES.map((s) => [s.host, s]));

/** Resolutores de nombres extra: los registran las extensiones (p. ej. el motor de AWS para *.amazonaws.com). */
export const hostResolvers: ((sys: System, name: string) => { ip: string } | null)[] = [];

export interface DnsRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

/** Zonas DNS extra (p. ej. las de Route 53): devuelven los registros de un nombre o null si no son de su zona. */
export const dnsResolvers: ((sys: System, name: string, type: string) => { records: DnsRecord[]; nxdomain: boolean } | null)[] = [];

/** Consulta DNS «autoritativa» de las extensiones. */
export function dnsLookup(sys: System, name: string, type: string): { records: DnsRecord[]; nxdomain: boolean } | null {
  for (const h of dnsResolvers) {
    const r = h(sys, name, type);
    if (r) return r;
  }
  return null;
}

/** Servidores web extra que atienden una petición antes que los sitios fijos. Devuelven null si no la reconocen. */
export const httpHandlers: ((req: { sys: System; host: string; port: number; scheme: string; path: string; query: string; method: string; body?: string; headers?: Record<string, string> }) => Fetched | null)[] = [];

/** Una prueba de carga (`ab`): la atiende quien conozca el destino (p. ej. el balanceador de una cuenta de AWS). */
export interface LoadReq {
  sys: System;
  host: string;
  port: number;
  scheme: string;
  path: string;
  concurrency: number;
  /** Peticiones a enviar (como máximo). */
  requests: number;
  /** Duración máxima en segundos (0 = sin límite). */
  seconds: number;
}

export interface LoadRes {
  ok: boolean;
  error?: string;
  status?: number;
  server?: string;
  bodyLength?: number;
  completed: number;
  failed: number;
  non2xx: number;
  /** Segundos que ha durado la prueba. */
  duration: number;
  /** Peticiones por segundo que ha sostenido. */
  rps: number;
}

export const loadHandlers: ((req: LoadReq) => LoadRes | null)[] = [];

export function isIp(s: string) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
}

/** Resuelve un nombre usando /etc/hosts, hosts de la simulación y el DNS público falso. */
export function resolveHost(sys: System, fs: VFS, name: string): { ip: string; site?: Site } | null {
  if (isIp(name)) {
    const site = SITES.find((s) => s.ip === name);
    return { ip: name, site };
  }
  if (name === 'localhost' || name === 'ip6-localhost') return { ip: '127.0.0.1' };
  if (name === sys.hostname) return { ip: '127.0.1.1' };
  try {
    const hosts = fs.readFile('/etc/hosts', null);
    for (const line of hosts.split('\n')) {
      const l = line.replace(/#.*/, '').trim().split(/\s+/);
      if (l.length >= 2 && l.slice(1).includes(name)) {
        const site = SITES.find((s) => s.ip === l[0]);
        return { ip: l[0], site };
      }
    }
  } catch {
    /* sin /etc/hosts */
  }
  const site = BY_HOST.get(name);
  if (site) return { ip: site.ip, site };
  for (const h of hostResolvers) {
    const r = h(sys, name);
    if (r) return { ip: r.ip };
  }
  return null;
}

export function isLocal(sys: System, ip: string) {
  return ip === '127.0.0.1' || ip === '127.0.1.1' || ip === sys.ipAddr || ip === '0.0.0.0';
}

export function latencyFor(sys: System, ip: string, site: Site | undefined, rand: () => number): number {
  if (isLocal(sys, ip)) return 0.02 + rand() * 0.03;
  const base = site?.latency ?? 10 + (hash32(ip) % 60);
  return Math.max(0.3, base + (rand() - 0.5) * base * 0.12);
}

export interface Fetched {
  ok: boolean;
  /** código curl si falla */
  curlCode?: number;
  error?: string;
  status?: number;
  type?: string;
  body?: string;
  size?: number;
  headers?: Record<string, string>;
  ip?: string;
}

const nginxIndex = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

export function httpFetch(sys: System, fs: VFS, rt: { random(): number }, url: string, method = 'GET', body?: string, headers?: Record<string, string>): Fetched {
  const m = /^(?:(https?):\/\/)?([^\/:?#]+)(?::(\d+))?(\/[^?#]*)?(\?[^#]*)?/.exec(url);
  if (!m) return { ok: false, curlCode: 3, error: `URL using bad/illegal format or missing URL` };
  const scheme = m[1] ?? 'http';
  const host = m[2];
  const port = m[3] ? parseInt(m[3], 10) : scheme === 'https' ? 443 : 80;
  const path = m[4] ?? '/';
  for (const h of httpHandlers) {
    const got = h({ sys, host, port, scheme, path, query: (m[5] ?? '').replace(/^\?/, ''), method, body, headers });
    if (got) return got;
  }
  const r = resolveHost(sys, fs, host);
  if (!r) return { ok: false, curlCode: 6, error: `Could not resolve host: ${host}` };
  if (isLocal(sys, r.ip)) {
    const svc = [...sys.services.values()].find((s) => s.state === 'active' && s.port === port);
    const listener = [...sys.procs.values()].find((p) => /http\.server\s+(\d+)/.test(p.command) && parseInt(/http\.server\s+(\d+)/.exec(p.command)![1], 10) === port);
    if (svc && (svc.name === 'nginx' || svc.name === 'apache2')) {
      if (scheme === 'https') return { ok: false, curlCode: 35, error: 'OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ' + host + ':' + port };
      let content: string | null = null;
      const roots = svc.name === 'nginx' ? ['/var/www/html/index.html', '/var/www/html/index.nginx-debian.html'] : ['/var/www/html/index.html'];
      if (path === '/' || path === '/index.html') {
        for (const f of roots) {
          try {
            content = fs.readFile(f, null);
            break;
          } catch {
            /* siguiente */
          }
        }
        if (content === null) content = svc.name === 'nginx' ? nginxIndex : '<html><body>It works!</body></html>\n';
      } else {
        try {
          content = fs.readFile('/var/www/html' + path, null);
        } catch {
          return { ok: true, status: 404, type: 'text/html', body: svc.name === 'nginx' ? '<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>\r\n' : '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>\n', ip: r.ip, headers: { Server: svc.name === 'nginx' ? 'nginx/1.24.0 (Ubuntu)' : 'Apache/2.4.58 (Ubuntu)' } };
        }
      }
      return { ok: true, status: 200, type: 'text/html', body: content, ip: r.ip, headers: { Server: svc.name === 'nginx' ? 'nginx/1.24.0 (Ubuntu)' : 'Apache/2.4.58 (Ubuntu)' } };
    }
    if (listener) {
      const dir = listener.command.includes('--directory') ? listener.command.split('--directory')[1].trim().split(/\s+/)[0] : '/home/alumno';
      let content: string | null = null;
      try {
        content = path === '/' ? null : fs.readFile(dir + path, null);
      } catch {
        return { ok: true, status: 404, type: 'text/html', body: '<!DOCTYPE HTML>\n<html lang="en"><head><title>Error response</title></head><body><h1>Error response</h1><p>Error code: 404</p></body></html>\n', ip: r.ip };
      }
      if (content === null) {
        let names: string[] = [];
        try { names = fs.readdir(dir, null); } catch { /* vacío */ }
        content = `<!DOCTYPE HTML>\n<html lang="en">\n<head><title>Directory listing for /</title></head>\n<body>\n<h1>Directory listing for /</h1>\n<hr>\n<ul>\n${names.map((n) => `<li><a href="${n}">${n}</a></li>`).join('\n')}\n</ul>\n<hr>\n</body>\n</html>\n`;
      }
      return { ok: true, status: 200, type: 'text/html', body: content, ip: r.ip, headers: { Server: 'SimpleHTTP/0.6 Python/3.12.3' } };
    }
    return { ok: false, curlCode: 7, error: `Failed to connect to ${host} port ${port} after 0 ms: Couldn't connect to server` };
  }
  const site = r.site;
  if (!site || site.up === false) return { ok: false, curlCode: 28, error: `Failed to connect to ${host} port ${port} after 129023 ms: Connection timed out` };
  if (scheme === 'https' && !site.https) return { ok: false, curlCode: 35, error: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to ${host}:443` };
  if (scheme === 'http' && site.https && host === 'github.com') {
    return { ok: true, status: 301, type: 'text/html', body: '', ip: r.ip, headers: { Location: 'https://github.com/', Server: 'GitHub.com' } };
  }
  if (!site.ssh && port !== (scheme === 'https' ? 443 : 80) && !(site.ssh && port === 22)) return { ok: false, curlCode: 7, error: `Failed to connect to ${host} port ${port} after 40 ms: Couldn't connect to server` };
  const route = site.routes[path] ?? site.routes[path.replace(/\/$/, '')];
  if (method === 'POST' && site.host === 'httpbin.org' && path === '/post') {
    return { ok: true, status: 200, type: 'application/json', body: JSON.stringify({ data: body ?? '', headers: { Host: 'httpbin.org' }, json: null, url: 'https://httpbin.org/post' }, null, 2) + '\n', ip: r.ip };
  }
  if (!route) return { ok: true, status: 404, type: 'text/html', body: '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>\n', ip: r.ip, headers: { Server: 'nginx' } };
  const content = route.size ? makeBinary(route, rt) : route.body;
  return { ok: true, status: route.status, type: route.type, body: content, size: route.size ?? content.length, ip: r.ip, headers: { Server: 'nginx', ...(route.headers ?? {}) } };
}

function makeBinary(route: Route, _rt: { random(): number }): string {
  return route.body;
}

export function statusText(code: number) {
  return ({ 200: 'OK', 201: 'Created', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable' } as Record<number, string>)[code] ?? 'Unknown';
}

export function fakeRand(seed: string) {
  return rng(hash32(seed));
}
