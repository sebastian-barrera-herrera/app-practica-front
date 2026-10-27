/** Imágenes base, paquetes y vulnerabilidades conocidas del simulador de contenedores (datos inventados pero verosímiles). */
import { stableId } from '../util';
import type { EcrFinding, ImageCfg, ImageData } from '../types-containers';

const MB = 1024 * 1024;

export interface BaseImage {
  name: string;
  os: string;
  size: number;
  cmd: string[] | null;
  entrypoint: string[] | null;
  env: Record<string, string>;
  ports: number[];
  runtime: ImageData['runtime'];
  pkgs: { name: string; version: string }[];
  files: Record<string, string>;
  user: string;
  workdir: string;
}

const PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const NGINX_HTML = '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and working.</p>\n</body>\n</html>\n';

const py = (name: string, size: number, os: string, pkgs: { name: string; version: string }[], version: string): BaseImage => ({
  name,
  os,
  size: size * MB,
  cmd: ['python3'],
  entrypoint: null,
  env: { PATH, PYTHON_VERSION: version, LANG: 'C.UTF-8' },
  ports: [],
  runtime: 'python',
  pkgs: [...pkgs, { name: 'python', version }, { name: 'pip', version: '24.0' }],
  files: {},
  user: 'root',
  workdir: '/',
});

const nginx = (name: string, size: number, os: string): BaseImage => ({
  name,
  os,
  size: size * MB,
  cmd: ['nginx', '-g', 'daemon off;'],
  entrypoint: null,
  env: { PATH, NGINX_VERSION: '1.27.0' },
  ports: [80],
  runtime: 'nginx',
  pkgs: [{ name: os.split(' ')[0].toLowerCase(), version: os.split(' ')[1] ?? '1' }, { name: 'nginx', version: '1.27.0' }],
  files: { '/usr/share/nginx/html/index.html': NGINX_HTML },
  user: 'root',
  workdir: '/',
});

const plain = (name: string, size: number, os: string, pkgs: { name: string; version: string }[], runtime: ImageData['runtime'] = 'shell'): BaseImage => ({
  name,
  os,
  size: size * MB,
  cmd: ['/bin/sh'],
  entrypoint: null,
  env: { PATH },
  ports: [],
  runtime,
  pkgs,
  files: {},
  user: 'root',
  workdir: '/',
});

const DEBIAN12 = [
  { name: 'zlib', version: '1.2.13' },
  { name: 'openssl', version: '3.0.13' },
  { name: 'coreutils', version: '9.1' },
  { name: 'perl-base', version: '5.36.0' },
];
const DEBIAN11_OLD = [
  { name: 'zlib', version: '1.2.11' },
  { name: 'curl', version: '7.74.0' },
  { name: 'openssl', version: '1.1.1k' },
  { name: 'coreutils', version: '8.32' },
  { name: 'perl-base', version: '5.32.1' },
];

export const BASES: Record<string, BaseImage> = {
  'python:3.12-slim': py('python:3.12-slim', 131, 'Debian 12', DEBIAN12, '3.12.4'),
  'python:3.12': py('python:3.12', 1020, 'Debian 12', [...DEBIAN12, { name: 'curl', version: '7.88.1' }], '3.12.4'),
  'python:3.12-alpine': py('python:3.12-alpine', 52, 'Alpine 3.20', [{ name: 'musl', version: '1.2.5' }], '3.12.4'),
  'python:3.8': py('python:3.8', 996, 'Debian 11', DEBIAN11_OLD, '3.8.19'),
  'nginx:alpine': nginx('nginx:alpine', 48, 'Alpine 3.20'),
  'nginx:latest': nginx('nginx:latest', 192, 'Debian 12'),
  'alpine:3.20': plain('alpine:3.20', 8, 'Alpine 3.20', [{ name: 'musl', version: '1.2.5' }]),
  'ubuntu:24.04': plain('ubuntu:24.04', 78, 'Ubuntu 24.04', [{ name: 'zlib', version: '1.3' }, { name: 'coreutils', version: '9.4' }]),
  'busybox:1.36': plain('busybox:1.36', 4, 'Busybox 1.36', []),
  'amazonlinux:2023': plain('amazonlinux:2023', 160, 'Amazon Linux 2023', [{ name: 'zlib', version: '1.2.11' }, { name: 'openssl', version: '3.0.8' }]),
  'node:20-alpine': { ...plain('node:20-alpine', 135, 'Alpine 3.20', [{ name: 'musl', version: '1.2.5' }], 'none'), cmd: ['node'], env: { PATH, NODE_VERSION: '20.15.0' } },
};

const ALIASES: Record<string, string> = {
  python: 'python:3.12',
  'python:latest': 'python:3.12',
  'python:3.12-slim-bookworm': 'python:3.12-slim',
  'python:3.8-slim': 'python:3.8',
  nginx: 'nginx:latest',
  alpine: 'alpine:3.20',
  'alpine:latest': 'alpine:3.20',
  ubuntu: 'ubuntu:24.04',
  'ubuntu:latest': 'ubuntu:24.04',
  busybox: 'busybox:1.36',
  'busybox:latest': 'busybox:1.36',
  amazonlinux: 'amazonlinux:2023',
  'amazonlinux:latest': 'amazonlinux:2023',
  node: 'node:20-alpine',
};

/** Normaliza el nombre de una imagen pública (`docker.io/library/python:3.12-slim` → `python:3.12-slim`) y busca su definición. */
export function findBase(ref: string): BaseImage | undefined {
  const name = ref
    .replace(/^(?:public\.ecr\.aws\/docker\/library|docker\.io\/library|registry-1\.docker\.io\/library|docker\.io|index\.docker\.io\/library)\//, '')
    .replace(/@sha256:.*$/, '');
  const full = name.includes(':') ? name : `${name}:latest`;
  const key = BASES[full] ? full : (ALIASES[full] ?? ALIASES[name]);
  return key ? BASES[key] : undefined;
}

/** Una imagen base pública como imagen completa (la que se descarga con `docker pull` o con una tarea de ECS). */
export function baseAsImage(b: BaseImage, now: number): ImageData {
  return { id: 'sha256:' + stableId('base:' + b.name, '', 64, 'hex'), arch: 'amd64', base: b.name, created: now - 86400000 * 14, size: b.size, layers: [{ cmd: `FROM ${b.name}`, size: b.size }], config: baseConfig(b), files: { ...b.files }, pkgs: b.pkgs.map((p) => ({ ...p })), runtime: b.runtime };
}

export const baseConfig = (b: BaseImage): ImageCfg => ({ env: { ...b.env }, cmd: b.cmd ? [...b.cmd] : null, entrypoint: b.entrypoint ? [...b.entrypoint] : null, workdir: b.workdir, user: b.user, ports: [...b.ports] });

// ───────────────────────── paquetes de pip ─────────────────────────

/** Versión «actual» de los paquetes más comunes (la que se instala si no se fija ninguna). */
export const PIP_LATEST: Record<string, string> = {
  flask: '3.0.3',
  werkzeug: '3.0.3',
  jinja2: '3.1.4',
  markupsafe: '2.1.5',
  itsdangerous: '2.2.0',
  click: '8.1.7',
  blinker: '1.8.2',
  requests: '2.32.3',
  urllib3: '2.2.2',
  idna: '3.7',
  certifi: '2024.7.4',
  'charset-normalizer': '3.3.2',
  boto3: '1.34.144',
  botocore: '1.34.144',
  s3transfer: '0.10.2',
  jmespath: '1.0.1',
  redis: '5.0.7',
  gunicorn: '22.0.0',
  pyyaml: '6.0.1',
  pillow: '10.4.0',
  numpy: '1.26.4',
  pandas: '2.2.2',
  pytest: '8.2.2',
  psycopg2: '2.9.9',
  'psycopg2-binary': '2.9.9',
  sqlalchemy: '2.0.31',
};

const PIP_SIZE_MB: Record<string, number> = { numpy: 62, pandas: 90, boto3: 1, botocore: 70, pillow: 9, sqlalchemy: 12, 'psycopg2-binary': 6, flask: 1, werkzeug: 3, jinja2: 3, requests: 1, urllib3: 2, redis: 2, gunicorn: 3, pyyaml: 2, pytest: 5 };

export const pipSize = (name: string): number => (PIP_SIZE_MB[name] ?? 3) * MB;

/** Dependencias que arrastra cada paquete (con la versión «antigua» que se instalaría junto a una versión vieja del paquete). */
const DEPS: Record<string, { name: string; old?: string }[]> = {
  flask: [{ name: 'werkzeug', old: '2.0.3' }, { name: 'jinja2', old: '3.0.3' }, { name: 'itsdangerous' }, { name: 'click' }, { name: 'markupsafe' }, { name: 'blinker' }],
  requests: [{ name: 'urllib3', old: '1.25.11' }, { name: 'idna' }, { name: 'certifi' }, { name: 'charset-normalizer' }],
  boto3: [{ name: 'botocore' }, { name: 's3transfer' }, { name: 'jmespath' }],
  gunicorn: [],
};

/** Versión por encima de la cual un paquete y sus dependencias ya son «modernos». */
const MODERN_FROM: Record<string, string> = { flask: '2.2.5', requests: '2.31.0' };

export function cmpVer(a: string, b: string): number {
  const pa = a.split(/[.+_-]/);
  const pb = b.split(/[.+_-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Paquetes que quedan instalados al pedir `name` (con `version` si se fijó) y sus dependencias. */
export function pipResolve(name: string, version?: string): { name: string; version: string }[] {
  const n = name.toLowerCase().replace(/_/g, '-');
  const v = version ?? PIP_LATEST[n] ?? '1.0.0';
  const out = [{ name: n, version: v }];
  const old = version !== undefined && MODERN_FROM[n] !== undefined && cmpVer(v, MODERN_FROM[n]) < 0;
  for (const d of DEPS[n] ?? []) out.push({ name: d.name, version: old && d.old ? d.old : (PIP_LATEST[d.name] ?? '1.0.0') });
  return out;
}

/** Módulos de Python que solo existen si se instaló el paquete (el nombre del módulo no siempre coincide con el del paquete). */
export const PIP_MODULES: Record<string, string[]> = {
  flask: ['flask'],
  requests: ['requests'],
  boto3: ['boto3', 'botocore'],
  redis: ['redis'],
  pyyaml: ['yaml'],
  pillow: ['PIL'],
  numpy: ['numpy'],
  pandas: ['pandas'],
  gunicorn: ['gunicorn'],
};

// ───────────────────────── vulnerabilidades ─────────────────────────

interface Vuln {
  pkg: string;
  lt: string;
  cve: string;
  sev: EcrFinding['severity'];
  desc: string;
  fixed: string;
}

const VULNS: Vuln[] = [
  { pkg: 'zlib', lt: '1.2.13', cve: 'CVE-2022-37434', sev: 'CRITICAL', desc: 'zlib through 1.2.12 has a heap-based buffer over-read or buffer overflow in inflate in inflate.c via a large gzip header extra field.', fixed: '1.2.13' },
  { pkg: 'curl', lt: '8.4.0', cve: 'CVE-2023-38545', sev: 'HIGH', desc: 'This flaw makes curl overflow a heap based buffer in the SOCKS5 proxy handshake.', fixed: '8.4.0' },
  { pkg: 'openssl', lt: '1.1.1n', cve: 'CVE-2022-0778', sev: 'HIGH', desc: 'The BN_mod_sqrt() function can be tricked into an infinite loop when parsing certificates.', fixed: '1.1.1n' },
  { pkg: 'coreutils', lt: '99', cve: 'CVE-2016-2781', sev: 'LOW', desc: 'chroot in GNU coreutils, when used with --userspec, allows local users to escape to the parent session via a crafted TIOCSTI ioctl call.', fixed: '' },
  { pkg: 'perl-base', lt: '99', cve: 'CVE-2011-4116', sev: 'LOW', desc: '_is_safe in the File::Temp module for Perl does not properly handle symlinks.', fixed: '' },
  { pkg: 'flask', lt: '2.2.5', cve: 'CVE-2023-30861', sev: 'HIGH', desc: 'When all of the following conditions are met, a response containing data intended for one client may be cached and subsequently sent by the proxy to other clients.', fixed: '2.2.5' },
  { pkg: 'werkzeug', lt: '2.2.3', cve: 'CVE-2023-25577', sev: 'HIGH', desc: 'Werkzeug multipart data parser needs to parse a large number of parts, which can cause excessive resource consumption (DoS).', fixed: '2.2.3' },
  { pkg: 'requests', lt: '2.31.0', cve: 'CVE-2023-32681', sev: 'MEDIUM', desc: 'Requests forwards Proxy-Authorization headers to destination servers when following HTTPS redirects.', fixed: '2.31.0' },
  { pkg: 'urllib3', lt: '1.26.5', cve: 'CVE-2021-33503', sev: 'HIGH', desc: 'An issue was discovered in urllib3: catastrophic backtracking in the URL authority parser.', fixed: '1.26.5' },
  { pkg: 'pyyaml', lt: '5.4', cve: 'CVE-2020-14343', sev: 'CRITICAL', desc: 'A vulnerability was discovered in the PyYAML library: it is susceptible to arbitrary code execution when it processes untrusted YAML files through the full_load method.', fixed: '5.4' },
  { pkg: 'jinja2', lt: '3.1.3', cve: 'CVE-2024-22195', sev: 'MEDIUM', desc: 'The xmlattr filter in Jinja2 accepts keys with spaces, which allows injecting attributes.', fixed: '3.1.3' },
  { pkg: 'pillow', lt: '10.0.1', cve: 'CVE-2023-4863', sev: 'HIGH', desc: 'Heap buffer overflow in libwebp: a crafted WebP image can cause arbitrary code execution.', fixed: '10.0.1' },
];

/** Hallazgos de un escaneo básico de ECR: cada paquete instalado frente a la tabla de vulnerabilidades. */
export function scanPackages(pkgs: { name: string; version: string }[]): EcrFinding[] {
  const out: EcrFinding[] = [];
  for (const p of pkgs) {
    for (const v of VULNS) {
      if (v.pkg === p.name && cmpVer(p.version, v.lt) < 0) out.push({ name: v.cve, severity: v.sev, description: v.desc, package: p.name, version: p.version, ...(v.fixed ? { fixedIn: v.fixed } : {}) });
    }
  }
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || x.name.localeCompare(y.name));
}
