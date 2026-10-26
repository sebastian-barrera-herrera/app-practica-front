/** Catálogo de paquetes simulados (apt/dpkg) y sus efectos al instalar/quitar. */
import { REGISTRY } from './registry';
import type { PackageEntry, System } from './sys';
import type { VFS } from './vfs';
import { ROOT } from './vfs';
import { hash32 } from './format';

export interface PkgDef {
  name: string;
  version: string;
  description: string;
  sizeKb: number;
  /** Instalado de fábrica. */
  base?: boolean;
  deps?: string[];
  /** Se ejecuta tras instalar. */
  onInstall?(sys: System, fs: VFS): void;
  onRemove?(sys: System, fs: VFS): void;
}

const nginxIndex = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

const nginxConf = `user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
\tworker_connections 768;
}

http {
\tsendfile on;
\tkeepalive_timeout 65;
\tinclude /etc/nginx/mime.types;
\tdefault_type application/octet-stream;
\taccess_log /var/log/nginx/access.log;
\terror_log /var/log/nginx/error.log;
\tinclude /etc/nginx/sites-enabled/*;
}
`;

const nginxSite = `server {
\tlisten 80 default_server;
\troot /var/www/html;
\tindex index.html index.nginx-debian.html;
\tserver_name _;
\tlocation / {
\t\ttry_files $uri $uri/ =404;
\t}
}
`;

function ensureDir(fs: VFS, path: string) {
  fs.mkdirp(path, 0o755, null);
}

function put(fs: VFS, path: string, content: string, mode = 0o644, owner = 'root', group = 'root') {
  ensureDir(fs, path.slice(0, path.lastIndexOf('/')) || '/');
  const n = fs.writeFile(path, content, { cred: null, mode });
  n.uid = owner;
  n.gid = group;
}

function addService(
  sys: System,
  name: string,
  description: string,
  port: number | undefined,
  pkg: string,
  procs: [string, string][],
) {
  let pid: number | undefined;
  let first = true;
  for (const [user, cmd] of procs) {
    const p = sys.spawn(user, cmd, { ppid: first ? 1 : pid });
    if (first) pid = p.pid;
    first = false;
  }
  sys.services.set(name, {
    name,
    description,
    state: 'active',
    enabled: true,
    pid,
    port,
    package: pkg,
    since: sys.clock.now,
  });
}

function removeService(sys: System, name: string) {
  const s = sys.services.get(name);
  if (!s) return;
  for (const p of [...sys.procs.values()]) {
    if (p.pid === s.pid || p.ppid === s.pid) sys.killProc(p.pid);
  }
  sys.services.delete(name);
}

export const PACKAGES: PkgDef[] = [
  // ── base instalada ──
  { name: 'coreutils', version: '9.4-3ubuntu6', description: 'GNU core utilities', sizeKb: 7200, base: true },
  { name: 'bash', version: '5.2.21-2ubuntu4', description: 'GNU Bourne Again SHell', sizeKb: 1800, base: true },
  { name: 'grep', version: '3.11-4build1', description: 'GNU grep, egrep and fgrep', sizeKb: 520, base: true },
  { name: 'sed', version: '4.9-2build1', description: 'GNU stream editor', sizeKb: 310, base: true },
  { name: 'gawk', version: '1:5.2.1-2build3', description: 'GNU awk, a pattern scanning and processing language', sizeKb: 3200, base: true },
  { name: 'findutils', version: '4.9.0-5build1', description: 'utilities for finding files--find, xargs', sizeKb: 1100, base: true },
  { name: 'util-linux', version: '2.39.3-9ubuntu6', description: 'miscellaneous system utilities', sizeKb: 3500, base: true },
  { name: 'procps', version: '2:4.0.4-4ubuntu3', description: 'tools for browsing and manipulating processes (ps, top, free…)', sizeKb: 2000, base: true },
  { name: 'iproute2', version: '6.1.0-1ubuntu6', description: 'networking and traffic control tools (ip, ss)', sizeKb: 3400, base: true },
  { name: 'iputils-ping', version: '3:20240117-1build1', description: 'Tools to test the reachability of network hosts', sizeKb: 180, base: true },
  { name: 'curl', version: '8.5.0-2ubuntu10', description: 'command line tool for transferring data with URL syntax', sizeKb: 520, base: true },
  { name: 'wget', version: '1.21.4-1ubuntu4', description: 'retrieves files from the web', sizeKb: 980, base: true },
  { name: 'openssh-client', version: '1:9.6p1-3ubuntu13', description: 'secure shell (SSH) client', sizeKb: 2700, base: true },
  { name: 'openssh-server', version: '1:9.6p1-3ubuntu13', description: 'secure shell (SSH) server', sizeKb: 1500, base: true },
  { name: 'git', version: '1:2.43.0-1ubuntu7', description: 'fast, scalable, distributed revision control system', sizeKb: 30000, base: true },
  { name: 'nano', version: '7.2-2build1', description: 'small, friendly text editor', sizeKb: 2700, base: true },
  { name: 'cron', version: '3.0pl1-184ubuntu2', description: 'process scheduling daemon', sizeKb: 220, base: true },
  { name: 'sudo', version: '1.9.15p5-3ubuntu5', description: 'Provide limited super user privileges', sizeKb: 3600, base: true },
  { name: 'tar', version: '1.35+dfsg-3build1', description: 'GNU version of the tar archiving utility', sizeKb: 790, base: true },
  { name: 'gzip', version: '1.12-1ubuntu3', description: 'GNU compression utilities', sizeKb: 230, base: true },
  { name: 'bzip2', version: '1.0.8-5.1build1', description: 'high-quality block-sorting file compressor', sizeKb: 110, base: true },
  { name: 'rsync', version: '3.2.7-1ubuntu1', description: 'fast, versatile, remote (and local) file-copying tool', sizeKb: 780, base: true },
  { name: 'less', version: '590-2ubuntu2', description: 'pager program similar to more', sizeKb: 370, base: true },
  { name: 'man-db', version: '2.12.0-4build2', description: 'tools for reading manual pages', sizeKb: 3000, base: true },
  { name: 'diffutils', version: '1:3.10-1build1', description: 'File comparison utilities', sizeKb: 400, base: true },
  { name: 'passwd', version: '1:4.13+dfsg1-4ubuntu3', description: 'change and administer password and group data', sizeKb: 3300, base: true },
  { name: 'systemd', version: '255.4-1ubuntu8', description: 'system and service manager', sizeKb: 15000, base: true },
  { name: 'apt', version: '2.7.14build2', description: 'commandline package manager', sizeKb: 4000, base: true },
  { name: 'python3', version: '3.12.3-0ubuntu2', description: 'interactive high-level object-oriented language', sizeKb: 800, base: true },
  { name: 'file', version: '1:5.45-3build1', description: 'Recognize the type of data in a file using magic numbers', sizeKb: 90, base: true },

  // ── disponibles ──
  { name: 'tree', version: '2.1.1-2ubuntu3', description: 'displays an indented directory tree, in color', sizeKb: 130 },
  { name: 'htop', version: '3.3.0-4build1', description: 'interactive processes viewer', sizeKb: 420 },
  { name: 'vim', version: '2:9.1.0016-1ubuntu7', description: 'Vi IMproved - enhanced vi editor', sizeKb: 4100 },
  { name: 'zip', version: '3.0-13ubuntu0.1', description: 'Archiver for .zip files', sizeKb: 640 },
  { name: 'unzip', version: '6.0-28ubuntu4', description: 'De-archiver for .zip files', sizeKb: 390 },
  { name: 'jq', version: '1.7.1-3build1', description: 'lightweight and flexible command-line JSON processor', sizeKb: 240 },
  { name: 'ncdu', version: '1.19-0.1', description: 'ncurses disk usage viewer', sizeKb: 90 },
  { name: 'tmux', version: '3.4-1ubuntu0.1', description: 'terminal multiplexer', sizeKb: 1200 },
  { name: 'cowsay', version: '3.03+dfsg2-8', description: 'configurable talking characters in ASCII art', sizeKb: 90 },
  { name: 'figlet', version: '2.2.5-3build1', description: 'Make large character ASCII banners out of ordinary text', sizeKb: 1100 },
  { name: 'net-tools', version: '2.10-0.1ubuntu4', description: 'NET-3 networking toolkit (ifconfig, netstat)', sizeKb: 800 },
  { name: 'dnsutils', version: '1:9.18.28-0ubuntu0.24.04.1', description: 'Clients provided with BIND (dig, nslookup)', sizeKb: 300 },
  { name: 'ipcalc', version: '0.51-1', description: 'parameter calculator for IPv4 addresses', sizeKb: 40 },
  { name: 'traceroute', version: '1:2.1.5-1', description: 'Traces the route taken by packets over an IPv4/IPv6 network', sizeKb: 150 },
  { name: 'nmap', version: '7.94+git20230807.3be01efb1+dfsg-3build2', description: 'The Network Mapper', sizeKb: 5800 },
  { name: 'lsof', version: '4.95.0-1build3', description: 'utility to list open files', sizeKb: 450 },
  { name: 'bc', version: '1.07.1-3ubuntu4', description: 'GNU bc arbitrary precision calculator language', sizeKb: 220 },
  { name: 'ufw', version: '0.36.2-6', description: 'program for managing a Netfilter firewall', sizeKb: 880,
    onInstall(sys) {
      sys.services.set('ufw', { name: 'ufw', description: 'Uncomplicated firewall', state: 'inactive', enabled: false, package: 'ufw', since: sys.clock.now });
    },
    onRemove(sys) { sys.services.delete('ufw'); },
  },
  { name: 'nginx', version: '1.24.0-2ubuntu7', description: 'small, powerful, scalable web/proxy server', sizeKb: 1200,
    onInstall(sys, fs) {
      put(fs, '/etc/nginx/nginx.conf', nginxConf);
      put(fs, '/etc/nginx/mime.types', 'types {\n    text/html html htm;\n    text/css css;\n    application/javascript js;\n}\n');
      put(fs, '/etc/nginx/sites-available/default', nginxSite);
      ensureDir(fs, '/etc/nginx/sites-enabled');
      fs.symlink('/etc/nginx/sites-available/default', '/etc/nginx/sites-enabled/default', null);
      put(fs, '/var/www/html/index.nginx-debian.html', nginxIndex);
      put(fs, '/var/log/nginx/access.log', '', 0o640, 'www-data', 'adm');
      put(fs, '/var/log/nginx/error.log', '', 0o640, 'www-data', 'adm');
      addService(sys, 'nginx', 'A high performance web server and a reverse proxy server', 80, 'nginx', [
        ['root', 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;'],
        ['www-data', 'nginx: worker process'],
        ['www-data', 'nginx: worker process'],
      ]);
    },
    onRemove(sys) { removeService(sys, 'nginx'); },
  },
  { name: 'apache2', version: '2.4.58-1ubuntu8', description: 'Apache HTTP Server', sizeKb: 520,
    onInstall(sys, fs) {
      put(fs, '/etc/apache2/apache2.conf', 'ServerRoot "/etc/apache2"\nListen 80\nDocumentRoot /var/www/html\n');
      put(fs, '/var/www/html/index.html', '<html><body><h1>Apache2 Ubuntu Default Page</h1><p>It works!</p></body></html>\n');
      addService(sys, 'apache2', 'The Apache HTTP Server', 80, 'apache2', [
        ['root', '/usr/sbin/apache2 -k start'],
        ['www-data', '/usr/sbin/apache2 -k start'],
      ]);
    },
    onRemove(sys) { removeService(sys, 'apache2'); },
  },
];

const DB = new Map(PACKAGES.map((p) => [p.name, p]));

export function pkgDef(name: string): PkgDef | undefined {
  return DB.get(name);
}

export function loadPackages(sys: System) {
  for (const p of PACKAGES) {
    const e: PackageEntry = {
      name: p.name,
      version: p.version,
      description: p.description,
      installed: !!p.base,
      sizeKb: p.sizeKb,
      deps: p.deps,
    };
    sys.packages.set(p.name, e);
  }
}

/** Crea los "binarios" de un paquete dentro de /usr/bin o /usr/sbin. */
export function installBinaries(fs: VFS, pkg: string, baseInstalled: Set<string> | null = null) {
  for (const [name, def] of REGISTRY) {
    if (def.builtin) continue;
    const owner = def.package ?? null;
    if (pkg === '*') {
      if (owner && !(baseInstalled?.has(owner) ?? false)) continue;
    } else if (owner !== pkg) continue;
    writeStub(fs, name, !!def.sbin);
  }
}

export function removeBinaries(fs: VFS, pkg: string) {
  for (const [name, def] of REGISTRY) {
    if (def.package !== pkg) continue;
    for (const dir of ['/usr/bin', '/usr/sbin']) {
      try {
        fs.unlink(`${dir}/${name}`, null);
      } catch {
        /* no existía */
      }
    }
  }
}

function writeStub(fs: VFS, name: string, sbin: boolean) {
  const dir = sbin ? '/usr/sbin' : '/usr/bin';
  const n = fs.writeFile(`${dir}/${name}`, `\x7fELF\x02\x01\x01\x00@@${name}@@\x00\x00`, { cred: null, mode: 0o755 });
  n.uid = 'root';
  n.gid = 'root';
  n.size = 18000 + (hash32(name) % 180000);
}

export { ROOT };
