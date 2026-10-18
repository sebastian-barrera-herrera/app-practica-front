/**
 * Construcción del "mundo": sistema + sistema de archivos base + shell.
 * Los escenarios (lecciones, sandbox) añaden archivos encima de la base.
 */
import { hash32, isoFull, rng, MONTHS, pad2 } from './format';
import { installBinaries, loadPackages, pkgDef } from './pkgdb';
import { Runtime, Shell } from './shell';
import { START_TIME, System } from './sys';
import { type Clock, VFS } from './vfs';

export interface FileSpec {
  content?: string;
  mode?: number;
  owner?: string;
  group?: string;
  dir?: boolean;
  /** Enlace simbólico a esta ruta. */
  link?: string;
  /** Antigüedad en días (para mtime). */
  ago?: number;
  size?: number;
}
export type Files = Record<string, string | FileSpec>;

export interface WorldOptions {
  files?: Files;
  cwd?: string;
  user?: string;
  /** Paquetes extra instalados al empezar. */
  packages?: string[];
  /** Servicios en estado distinto del por defecto. */
  services?: Record<string, { state?: 'active' | 'inactive' | 'failed'; enabled?: boolean }>;
  /** Usuarios adicionales: nombre → grupos suplementarios. */
  users?: Record<string, string[]>;
  /** Variables de entorno extra. */
  env?: Record<string, string>;
  /** Procesos extra: [usuario, comando, %cpu?, %mem?] */
  procs?: [string, string, number?, number?][];
  /** Sin tiempo real de espera para sleep (tests). */
  instant?: boolean;
  /** Incluir el laboratorio completo (sandbox). */
  lab?: boolean;
  hostname?: string;
}

export interface World {
  sys: System;
  fs: VFS;
  rt: Runtime;
  shell: Shell;
}

const DAY = 86400000;

// ───────────────────────── generadores de datos ─────────────────────────

export function genAccessLog(n: number, seed = 7): string {
  const r = rng(seed);
  const ips = ['192.168.1.23', '10.0.0.5', '203.0.113.9', '198.51.100.44', '192.168.1.77', '172.16.0.3', '203.0.113.200'];
  const paths = ['/', '/index.html', '/about', '/contact', '/api/users', '/api/login', '/images/logo.png', '/css/style.css', '/js/app.js', '/admin', '/wp-login.php', '/api/orders', '/favicon.ico'];
  const weights = [200, 200, 200, 200, 200, 200, 304, 304, 404, 404, 500, 301, 403];
  const agents = ['Mozilla/5.0 (X11; Linux x86_64)', 'curl/8.5.0', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Googlebot/2.1'];
  const base = Date.UTC(2026, 2, 13, 8, 0, 0);
  let t = base;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 90000) + 1000;
    const d = new Date(t);
    const ts = `${pad2(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} +0000`;
    const ip = ips[Math.floor(r() * ips.length)];
    const path = paths[Math.floor(r() * paths.length)];
    const status = weights[Math.floor(r() * weights.length)];
    const size = status === 304 ? 0 : Math.floor(r() * 9000) + 200;
    const method = path.startsWith('/api') && r() > 0.5 ? 'POST' : 'GET';
    lines.push(`${ip} - - [${ts}] "${method} ${path} HTTP/1.1" ${status} ${size} "-" "${agents[Math.floor(r() * agents.length)]}"`);
  }
  return lines.join('\n') + '\n';
}

export function genAppLog(n: number, seed = 11): string {
  const r = rng(seed);
  const msgs: [string, string][] = [
    ['INFO', 'Server started on port 8080'],
    ['INFO', 'User login: ana'],
    ['INFO', 'User login: bob'],
    ['INFO', 'Request GET /api/users completed in 45ms'],
    ['INFO', 'Cache refreshed (128 entries)'],
    ['WARN', 'Slow query detected (1250ms): SELECT * FROM orders'],
    ['WARN', 'Disk usage at 82%'],
    ['WARN', 'Retrying connection to payment gateway'],
    ['ERROR', 'Database connection timeout'],
    ['ERROR', 'Failed to send email to carlos@example.com'],
    ['ERROR', 'NullPointerException at OrderService.java:88'],
    ['DEBUG', 'Loaded config from /etc/app/app.conf'],
  ];
  let t = Date.UTC(2026, 2, 13, 6, 0, 0);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 600000) + 5000;
    const [lvl, msg] = msgs[Math.floor(r() * msgs.length)];
    lines.push(`${isoFull(t)} [${lvl}] ${msg}`);
  }
  return lines.join('\n') + '\n';
}

export function genAuthLog(n: number, seed = 5): string {
  const r = rng(seed);
  const ips = ['203.0.113.9', '198.51.100.44', '192.168.1.77', '45.155.205.12'];
  let t = Date.UTC(2026, 2, 13, 0, 5, 0);
  const lines: string[] = [];
  const stamp = (ms: number) => {
    const d = new Date(ms);
    return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  };
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 1500000) + 20000;
    const k = r();
    const ip = ips[Math.floor(r() * ips.length)];
    const pid = 1000 + Math.floor(r() * 8000);
    if (k < 0.35)
      lines.push(`${stamp(t)} dojo sshd[${pid}]: Failed password for invalid user admin from ${ip} port ${30000 + Math.floor(r() * 30000)} ssh2`);
    else if (k < 0.55)
      lines.push(`${stamp(t)} dojo sshd[${pid}]: Failed password for root from ${ip} port ${30000 + Math.floor(r() * 30000)} ssh2`);
    else if (k < 0.75)
      lines.push(`${stamp(t)} dojo sshd[${pid}]: Accepted publickey for alumno from 192.168.1.77 port ${30000 + Math.floor(r() * 30000)} ssh2`);
    else if (k < 0.9)
      lines.push(`${stamp(t)} dojo sudo:   alumno : TTY=pts/0 ; PWD=/home/alumno ; USER=root ; COMMAND=/usr/bin/apt update`);
    else lines.push(`${stamp(t)} dojo CRON[${pid}]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)`);
  }
  return lines.join('\n') + '\n';
}

export function genSyslog(n: number, seed = 3): string {
  const r = rng(seed);
  const msgs = [
    'systemd[1]: Started Daily apt download activities.',
    'kernel: [UFW BLOCK] IN=eth0 OUT= SRC=45.155.205.12 DST=192.168.1.50 PROTO=TCP DPT=23',
    'systemd[1]: Starting Daily man-db regeneration...',
    'CRON[2210]: (root) CMD (   cd / && run-parts --report /etc/cron.hourly)',
    'systemd-resolved[455]: Using degraded feature set UDP instead of UDP+EDNS0',
    'NetworkManager[610]: <info> dhcp4 (eth0): state changed bound',
    'systemd[1]: Finished Rotate log files.',
    'kernel: EXT4-fs (vda1): re-mounted. Opts: errors=remount-ro',
    'rsyslogd: [origin software="rsyslogd"] rsyslogd was HUPed',
  ];
  let t = Date.UTC(2026, 2, 13, 0, 1, 0);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(r() * 900000) + 10000;
    const d = new Date(t);
    lines.push(`${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} dojo ${msgs[Math.floor(r() * msgs.length)]}`);
  }
  return lines.join('\n') + '\n';
}

export function genSalesCsv(n: number, seed = 9): string {
  const r = rng(seed);
  const products = ['Laptop', 'Mouse', 'Teclado', 'Monitor', 'Webcam', 'Auriculares'];
  const regions = ['Norte', 'Sur', 'Este', 'Oeste'];
  const prices: Record<string, number> = { Laptop: 899, Mouse: 25, Teclado: 59, Monitor: 249, Webcam: 79, Auriculares: 119 };
  const lines = ['fecha,producto,region,cantidad,precio'];
  for (let i = 0; i < n; i++) {
    const p = products[Math.floor(r() * products.length)];
    const day = 1 + Math.floor(r() * 28);
    lines.push(`2026-03-${pad2(day)},${p},${regions[Math.floor(r() * regions.length)]},${1 + Math.floor(r() * 5)},${prices[p]}`);
  }
  return lines.join('\n') + '\n';
}

// ───────────────────────── aplicar archivos ─────────────────────────

export function applyFiles(fs: VFS, files: Files, defaultOwner = 'alumno', clock?: Clock) {
  const now = clock?.now ?? fs.clock.now;
  const keys = Object.keys(files).sort((a, b) => a.split('/').length - b.split('/').length);
  const ownerFor = (path: string) => (path.startsWith('/root') || path.startsWith('/etc') || path.startsWith('/var') || path.startsWith('/usr') || path.startsWith('/opt') ? 'root' : defaultOwner);
  for (const key of keys) {
    const raw = files[key];
    const spec: FileSpec = typeof raw === 'string' ? { content: raw } : raw;
    const isDir = key.endsWith('/') || spec.dir;
    const path = key.replace(/\/+$/, '') || '/';
    const owner = spec.owner ?? ownerFor(path);
    const group = spec.group ?? (owner === 'root' ? 'root' : owner);
    // crear padres
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!fs.exists(parent)) {
      fs.mkdirp(parent, 0o755, null);
      // propietario de los padres recién creados
      const comps = parent.split('/').filter(Boolean);
      let cur = '';
      for (const c of comps) {
        cur += '/' + c;
        const n = fs.stat(cur);
        if (n && n.uid === 'root' && !cur.startsWith('/etc') && !cur.startsWith('/var') && !cur.startsWith('/usr') && !cur.startsWith('/opt') && !cur.startsWith('/root') && !cur.startsWith('/srv') && !cur.startsWith('/tmp') && !cur.startsWith('/home')) {
          /* mantener */
        }
        if (n && cur.startsWith('/home/' + defaultOwner) && cur !== '/home/' + defaultOwner) {
          n.uid = defaultOwner;
          n.gid = defaultOwner;
        }
      }
    }
    let node;
    if (spec.link !== undefined) {
      if (fs.lstat(path)) fs.removeTree(path, null);
      node = fs.symlink(spec.link, path, null);
      node.uid = owner;
      node.gid = group;
    } else if (isDir) {
      node = fs.stat(path) ?? fs.mkdirp(path, spec.mode ?? 0o755, null);
      if (spec.mode !== undefined) node.mode = spec.mode;
      node.uid = owner;
      node.gid = group;
    } else {
      node = fs.writeFile(path, spec.content ?? '', { cred: null, mode: spec.mode ?? 0o644 });
      node.uid = owner;
      node.gid = group;
      if (spec.size !== undefined) node.size = spec.size;
    }
    node.mtime = now - (spec.ago ?? 2) * DAY - (hash32(path) % 80000) * 1000;
  }
}

// ───────────────────────── mundo base ─────────────────────────

const SYSTEM_USERS: [string, number, number, string, string, string][] = [
  ['root', 0, 0, 'root', '/root', '/bin/bash'],
  ['daemon', 1, 1, 'daemon', '/usr/sbin', '/usr/sbin/nologin'],
  ['bin', 2, 2, 'bin', '/bin', '/usr/sbin/nologin'],
  ['sys', 3, 3, 'sys', '/dev', '/usr/sbin/nologin'],
  ['sync', 4, 65534, 'sync', '/bin', '/bin/sync'],
  ['games', 5, 60, 'games', '/usr/games', '/usr/sbin/nologin'],
  ['man', 6, 12, 'man', '/var/cache/man', '/usr/sbin/nologin'],
  ['lp', 7, 7, 'lp', '/var/spool/lpd', '/usr/sbin/nologin'],
  ['mail', 8, 8, 'mail', '/var/mail', '/usr/sbin/nologin'],
  ['www-data', 33, 33, 'www-data', '/var/www', '/usr/sbin/nologin'],
  ['backup', 34, 34, 'backup', '/var/backups', '/usr/sbin/nologin'],
  ['nobody', 65534, 65534, 'nobody', '/nonexistent', '/usr/sbin/nologin'],
  ['systemd-resolve', 996, 996, 'systemd Resolver', '/', '/usr/sbin/nologin'],
  ['messagebus', 100, 104, '', '/nonexistent', '/usr/sbin/nologin'],
  ['syslog', 101, 102, '', '/nonexistent', '/usr/sbin/nologin'],
  ['sshd', 102, 65534, '', '/run/sshd', '/usr/sbin/nologin'],
];

const SYSTEM_GROUPS: [string, number, string[]][] = [
  ['root', 0, []], ['daemon', 1, []], ['bin', 2, []], ['sys', 3, []],
  ['adm', 4, ['syslog', 'alumno']], ['tty', 5, []], ['disk', 6, []], ['lp', 7, []],
  ['mail', 8, []], ['man', 12, []], ['kmem', 15, []], ['dialout', 20, []],
  ['cdrom', 24, ['alumno']], ['sudo', 27, ['alumno']], ['audio', 29, []], ['dip', 30, ['alumno']],
  ['www-data', 33, []], ['backup', 34, []], ['shadow', 42, []], ['video', 44, []],
  ['plugdev', 46, ['alumno']], ['staff', 50, []], ['games', 60, []], ['users', 100, ['alumno', 'ana', 'bob']],
  ['nogroup', 65534, []], ['syslog', 102, []], ['messagebus', 104, []],
];

function writeEtc(sys: System, fs: VFS) {
  const passwd = [...sys.users.values()]
    .sort((a, b) => a.uid - b.uid)
    .map((u) => `${u.name}:x:${u.uid}:${u.gid}:${u.gecos}:${u.home}:${u.shell}`)
    .join('\n') + '\n';
  const group = [...sys.groups.values()]
    .sort((a, b) => a.gid - b.gid)
    .map((g) => `${g.name}:x:${g.gid}:${[...g.members].join(',')}`)
    .join('\n') + '\n';
  const shadow = [...sys.users.values()]
    .sort((a, b) => a.uid - b.uid)
    .map((u) => `${u.name}:${u.shell.includes('nologin') ? '*' : '$y$j9T$' + hash32(u.name).toString(36) + '$hashedpassword'}:20150:0:99999:7:::`)
    .join('\n') + '\n';
  const w = (path: string, content: string, mode: number, grp = 'root') => {
    const n = fs.writeFile(path, content, { cred: null, mode });
    n.uid = 'root';
    n.gid = grp;
  };
  w('/etc/passwd', passwd, 0o644);
  w('/etc/group', group, 0o644);
  w('/etc/shadow', shadow, 0o640, 'shadow');
}

export function syncEtc(sys: System, fs: VFS) {
  writeEtc(sys, fs);
}

function createBase(sys: System, fs: VFS) {
  const clock = sys.clock;
  // directorios del sistema
  for (const d of [
    '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc', '/root',
    '/run', '/sbin', '/srv', '/sys', '/tmp', '/usr', '/var',
  ]) {
    fs.mkdirp(d, 0o755, null);
  }
  fs.stat('/root')!.mode = 0o700;
  fs.stat('/tmp')!.mode = 0o1777;
  for (const d of ['/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share', '/usr/local/bin', '/usr/local/sbin', '/usr/local/lib', '/usr/games', '/usr/include', '/usr/src', '/var/log', '/var/tmp', '/var/cache', '/var/lib', '/var/spool', '/var/backups', '/var/mail', '/var/www/html', '/var/run', '/etc/ssh', '/etc/apt', '/etc/cron.d', '/etc/cron.daily', '/etc/systemd/system', '/etc/default', '/proc/sys', '/sys/class', '/boot/grub', '/run/user', '/dev/pts']) {
    fs.mkdirp(d, 0o755, null);
  }
  fs.stat('/var/tmp')!.mode = 0o1777;

  // /bin → usr/bin (como en distros modernas)
  fs.removeTree('/bin', null);
  fs.removeTree('/sbin', null);
  fs.removeTree('/lib', null);
  fs.symlink('usr/bin', '/bin', null);
  fs.symlink('usr/sbin', '/sbin', null);
  fs.symlink('usr/lib', '/lib', null);

  // usuarios y grupos
  for (const [name, gid, members] of SYSTEM_GROUPS) sys.addGroup(name, members, gid);
  for (const [name, uid, gid, gecos, home, shell] of SYSTEM_USERS)
    sys.users.set(name, { name, uid, gid, gecos, home, shell });
  sys.addGroup('alumno', [], 1000);
  sys.addGroup('ana', [], 1001);
  sys.addGroup('bob', [], 1002);
  sys.addGroup('developers', ['ana', 'bob'], 1003);
  sys.users.set('alumno', { name: 'alumno', uid: 1000, gid: 1000, gecos: 'Alumno Linux,,,', home: '/home/alumno', shell: '/bin/bash' });
  sys.users.set('ana', { name: 'ana', uid: 1001, gid: 1001, gecos: 'Ana García,,,', home: '/home/ana', shell: '/bin/bash' });
  sys.users.set('bob', { name: 'bob', uid: 1002, gid: 1002, gecos: 'Bob Pérez,,,', home: '/home/bob', shell: '/bin/bash' });
  sys.nextUid = 1003;
  sys.nextGid = 1004;
  writeEtc(sys, fs);

  // paquetes y binarios
  loadPackages(sys);
  const installed = new Set([...sys.packages.values()].filter((p) => p.installed).map((p) => p.name));
  installBinaries(fs, '*', installed);

  // /etc
  const etc: Files = {
    '/etc/hostname': 'dojo\n',
    '/etc/hosts': '127.0.0.1 localhost\n127.0.1.1 dojo\n192.168.1.10 server.local server\n192.168.1.1 router.local\n\n# The following lines are desirable for IPv6 capable hosts\n::1 ip6-localhost ip6-loopback\n',
    '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://www.ubuntu.com/"\n',
    '/etc/issue': 'Ubuntu 24.04.1 LTS \\n \\l\n\n',
    '/etc/resolv.conf': 'nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n',
    '/etc/shells': '# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n/bin/dash\n',
    '/etc/environment': 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n',
    '/etc/fstab': '# <file system> <mount point> <type> <options> <dump> <pass>\nUUID=3f2a9c1e-77aa-4c0b-9d3e-0a1b2c3d4e5f / ext4 errors=remount-ro 0 1\nUUID=A1B2-C3D4 /boot/efi vfat umask=0077 0 1\n/swap.img none swap sw 0 0\n',
    '/etc/crontab': '# /etc/crontab: system-wide crontab\nSHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n\n# m h dom mon dow user  command\n17 *\t* * *\troot    cd / && run-parts --report /etc/cron.hourly\n25 6\t* * *\troot\ttest -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )\n',
    '/etc/ssh/sshd_config': '# This is the sshd server system-wide configuration file.\nInclude /etc/ssh/sshd_config.d/*.conf\n\nPort 22\n#AddressFamily any\n#ListenAddress 0.0.0.0\n\nPermitRootLogin prohibit-password\nPubkeyAuthentication yes\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nAcceptEnv LANG LC_*\nSubsystem sftp /usr/lib/openssh/sftp-server\n',
    '/etc/apt/sources.list': 'deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse\ndeb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse\ndeb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse\n',
    '/etc/sudoers': { content: '# This file MUST be edited with the \'visudo\' command as root.\nDefaults\tenv_reset\nDefaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n\nroot\tALL=(ALL:ALL) ALL\n%sudo\tALL=(ALL:ALL) ALL\n', mode: 0o440, owner: 'root', group: 'root' },
    '/etc/motd': '',
    '/etc/timezone': 'UTC\n',
    '/etc/default/locale': 'LANG=en_US.UTF-8\n',
    '/etc/mtab': { link: '../proc/self/mounts' },
    '/etc/skel/.bashrc': '# ~/.bashrc: executed by bash(1) for non-login shells.\n',
  };
  applyFiles(fs, etc, 'root');

  // /proc
  const up = Math.floor((clock.now - sys.bootTime) / 1000);
  applyFiles(fs, {
    '/proc/version': 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-103) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC\n',
    '/proc/uptime': `${up}.52 ${Math.floor(up * 3.7)}.11\n`,
    '/proc/loadavg': '0.12 0.20 0.18 1/312 2051\n',
    '/proc/cpuinfo': Array.from({ length: 4 }, (_, i) => `processor\t: ${i}\nvendor_id\t: GenuineIntel\nmodel name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\ncpu MHz\t\t: 2399.998\ncache size\t: 35840 KB\ncpu cores\t: 4\n`).join('\n'),
    '/proc/meminfo': 'MemTotal:        8029440 kB\nMemFree:         3412284 kB\nMemAvailable:    5601220 kB\nBuffers:          212648 kB\nCached:          2048236 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n',
    '/proc/mounts': '/dev/vda1 / ext4 rw,relatime,errors=remount-ro 0 0\nproc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\ntmpfs /run tmpfs rw,nosuid,nodev 0 0\n',
  }, 'root');
  fs.symlink('/proc/mounts', '/proc/self_mounts', null);

  // dispositivos
  for (const [d, m] of [['null', 0o666], ['zero', 0o666], ['random', 0o666], ['urandom', 0o666], ['tty', 0o666]] as [string, number][]) {
    const n = fs.writeFile('/dev/' + d, '', { cred: null, mode: m });
    n.uid = 'root';
    n.gid = 'root';
  }

  // logs
  applyFiles(fs, {
    '/var/log/syslog': { content: genSyslog(60), owner: 'syslog', group: 'adm', mode: 0o640 },
    '/var/log/auth.log': { content: genAuthLog(40), owner: 'syslog', group: 'adm', mode: 0o640 },
    '/var/log/dpkg.log': { content: '2026-03-10 09:12:01 status installed curl:amd64 8.5.0-2ubuntu10\n2026-03-10 09:12:05 status installed git:amd64 1:2.43.0-1ubuntu7\n2026-03-11 14:02:44 status installed nano:amd64 7.2-2build1\n', owner: 'root', group: 'adm' },
    '/var/log/kern.log': { content: 'Mar 13 07:01:12 dojo kernel: [    0.000000] Linux version 6.8.0-45-generic\nMar 13 07:01:13 dojo kernel: [    1.204510] EXT4-fs (vda1): mounted filesystem with ordered data mode\n', owner: 'syslog', group: 'adm', mode: 0o640 },
    '/var/log/btmp': { content: '', owner: 'root', group: 'utmp', mode: 0o660 },
  }, 'root');

  // /usr/share y otros
  applyFiles(fs, {
    '/usr/share/dict/words': 'apple\nbanana\ncherry\ndate\nelderberry\nfig\ngrape\n',
    '/opt/': { dir: true },
    '/srv/shared/': { dir: true, owner: 'root', group: 'developers', mode: 0o2775 },
  }, 'root');

  // home de usuarios
  applyHome(fs, 'alumno', 0o755);
  applyHome(fs, 'ana', 0o750);
  applyHome(fs, 'bob', 0o750);
  fs.stat('/root')!.uid = 'root';
}

function applyHome(fs: VFS, user: string, mode: number) {
  const home = '/home/' + user;
  const files: Files = {
    [home + '/']: { dir: true, mode, owner: user, group: user },
    [home + '/.bashrc']: { content: '# ~/.bashrc: executed by bash(1) for non-login shells.\n\n# alias de ejemplo\nalias ll=\'ls -alF\'\nalias la=\'ls -A\'\nalias l=\'ls -CF\'\n\nexport EDITOR=nano\n', owner: user },
    [home + '/.profile']: { content: '# ~/.profile: executed by the command interpreter for login shells.\nif [ -n "$BASH_VERSION" ]; then\n    if [ -f "$HOME/.bashrc" ]; then\n        . "$HOME/.bashrc"\n    fi\nfi\n', owner: user },
    [home + '/.bash_logout']: { content: '# ~/.bash_logout: executed by bash(1) when login shell exits.\n', owner: user },
    [home + '/.bash_history']: { content: user === 'alumno' ? 'ls\ncd Documents\npwd\nclear\n' : '', owner: user, mode: 0o600 },
    [home + '/Desktop/']: { dir: true, owner: user },
    [home + '/Documents/']: { dir: true, owner: user },
    [home + '/Downloads/']: { dir: true, owner: user },
    [home + '/Music/']: { dir: true, owner: user },
    [home + '/Pictures/']: { dir: true, owner: user },
    [home + '/Videos/']: { dir: true, owner: user },
  };
  for (const [k, v] of Object.entries(files)) {
    applyFiles(fs, { [k]: v }, user);
  }
}

/** Laboratorio completo para el modo libre. */
export const LAB_FILES: Files = {
  '/home/alumno/Documents/report.txt': 'Informe trimestral\n==================\nVentas del primer trimestre: 1250 unidades.\nObjetivo del segundo trimestre: 1500 unidades.\nResponsable: Ana García\n',
  '/home/alumno/Documents/notes.txt': 'Linux es un sistema operativo libre.\nEl kernel fue creado por Linus Torvalds en 1991.\nUbuntu es una distribución basada en Debian.\nLa terminal permite controlar el sistema con comandos.\nAprender comandos es como aprender un idioma nuevo.\nCada comando hace una cosa y la hace bien.\n',
  '/home/alumno/Documents/todo.md': '# Tareas\n- [x] Instalar Linux\n- [x] Abrir la terminal\n- [ ] Aprender grep\n- [ ] Dominar los pipes\n- [ ] Escribir un script\n',
  '/home/alumno/Documents/budget.csv': 'concepto,monto\nalquiler,600\ncomida,250\ntransporte,80\nocio,120\nahorro,300\n',
  '/home/alumno/Downloads/setup.sh': { content: '#!/bin/bash\necho "Instalando..."\nsleep 1\necho "Listo"\n', mode: 0o644 },
  '/home/alumno/Downloads/photo.jpg': { content: '\xff\xd8\xff\xe0JFIF', size: 482113 },
  '/home/alumno/projects/web/index.html': '<!DOCTYPE html>\n<html>\n<head>\n  <title>Mi sitio</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hola Linux</h1>\n  <script src="app.js"></script>\n</body>\n</html>\n',
  '/home/alumno/projects/web/style.css': 'body {\n  font-family: sans-serif;\n  background: #0b1020;\n  color: #e6edf3;\n}\nh1 { color: #22d3a6; }\n',
  '/home/alumno/projects/web/app.js': 'console.log("Hola desde app.js");\n// TODO: añadir interactividad\n',
  '/home/alumno/projects/web/README.md': '# Mi sitio\n\nUn sitio de prueba para practicar comandos.\n',
  '/home/alumno/projects/scripts/hello.sh': { content: '#!/bin/bash\nname=${1:-mundo}\necho "Hola, $name!"\n', mode: 0o755 },
  '/home/alumno/projects/scripts/backup.sh': { content: '#!/bin/bash\n# Copia de seguridad sencilla\nsrc=~/Documents\ndest=~/backup\nmkdir -p "$dest"\ncp -r "$src"/* "$dest"/\necho "Backup completado en $dest"\n', mode: 0o644 },
  '/home/alumno/projects/data/sales.csv': genSalesCsv(24),
  '/home/alumno/logs/access.log': genAccessLog(60),
  '/home/alumno/logs/app.log': genAppLog(50),
  '/home/alumno/.ssh/config': { content: 'Host server\n    HostName 192.168.1.10\n    User alumno\n    Port 22\n', mode: 0o600 },
  '/home/alumno/.ssh/': { dir: true, mode: 0o700 },
};

export function createWorld(opts: WorldOptions = {}): World {
  const clock: Clock = { now: START_TIME };
  const sys = new System(clock);
  if (opts.hostname) sys.hostname = opts.hostname;
  const fs = new VFS(clock);
  createBase(sys, fs);
  if (opts.hostname) {
    fs.writeFile('/etc/hostname', opts.hostname + '\n', { cred: null });
    fs.writeFile('/etc/hosts', fs.readFile('/etc/hosts', null).replace('127.0.1.1 dojo', `127.0.1.1 ${opts.hostname}`), { cred: null });
  }

  // servicios base
  const svc = (name: string, description: string, state: 'active' | 'inactive', enabled: boolean, port?: number, pid?: number) =>
    sys.services.set(name, { name, description, state, enabled, port, pid, since: clock.now - 3 * DAY });
  svc('ssh', 'OpenBSD Secure Shell server', 'active', true, 22, 812);
  svc('cron', 'Regular background program processing daemon', 'active', true, undefined, 640);
  svc('rsyslog', 'System Logging Service', 'active', true, undefined, 648);
  svc('systemd-resolved', 'Network Name Resolution', 'active', true, undefined, 455);
  svc('cups', 'CUPS Scheduler', 'inactive', false);

  // procesos base
  const P = (pid: number, ppid: number, user: string, cmd: string, o: Partial<import('./sys').Proc> = {}) =>
    sys.spawn(user, cmd, { pid, ppid, start: sys.bootTime + pid * 1000, ...o });
  P(1, 0, 'root', '/sbin/init splash', { mem: 0.4, rss: 13400, vsz: 168000 });
  P(2, 0, 'root', '[kthreadd]', { mem: 0, rss: 0, vsz: 0 });
  P(3, 2, 'root', '[rcu_gp]', { mem: 0, rss: 0, vsz: 0, state: 'I' });
  P(15, 2, 'root', '[ksoftirqd/0]', { mem: 0, rss: 0, vsz: 0 });
  P(412, 1, 'root', '/lib/systemd/systemd-journald', { mem: 0.6, rss: 52000, vsz: 80000 });
  P(455, 1, 'systemd-resolve', '/lib/systemd/systemd-resolved', { mem: 0.3, rss: 24000, vsz: 25000 });
  P(640, 1, 'root', '/usr/sbin/cron -f -P', { mem: 0.1, rss: 3100, vsz: 8500 });
  P(648, 1, 'syslog', '/usr/sbin/rsyslogd -n -iNONE', { mem: 0.2, rss: 5200, vsz: 222000 });
  P(812, 1, 'root', 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', { mem: 0.2, rss: 7100, vsz: 15400 });
  P(1560, 812, 'root', 'sshd: alumno [priv]', { mem: 0.3, rss: 9000, vsz: 17200 });
  P(1640, 1560, 'alumno', 'sshd: alumno@pts/0', { mem: 0.2, rss: 6100, vsz: 17500, tty: '?' });
  for (const [u, cmd, cpu, mem] of opts.procs ?? [])
    sys.spawn(u, cmd, { cpu: cpu ?? 0.5, mem: mem ?? 0.5, ppid: 1 });

  // usuarios extra
  for (const [name, groups] of Object.entries(opts.users ?? {})) {
    if (!sys.users.has(name)) {
      sys.addUser(name);
      fs.mkdirp('/home/' + name, 0o755, null);
      const n = fs.stat('/home/' + name)!;
      n.uid = name;
      n.gid = name;
    }
    for (const g of groups) {
      if (!sys.groups.has(g)) sys.addGroup(g);
      sys.groups.get(g)!.members.add(name);
    }
  }
  syncEtc(sys, fs);

  // paquetes extra
  for (const p of opts.packages ?? []) installPackage(sys, fs, p);

  // laboratorio / archivos
  if (opts.lab) applyFiles(fs, LAB_FILES, 'alumno');
  if (opts.files) applyFiles(fs, opts.files, 'alumno');

  for (const [name, st] of Object.entries(opts.services ?? {})) {
    const s = sys.services.get(name);
    if (s) {
      if (st.state) s.state = st.state;
      if (st.enabled !== undefined) s.enabled = st.enabled;
    }
  }

  const rt = new Runtime();
  if (opts.instant) rt.timeScale = 0;
  const shell = new Shell(sys, fs, rt, opts.user ?? 'alumno');
  for (const [k, v] of Object.entries(opts.env ?? {})) shell.setVar(k, v, true);
  if (opts.cwd) shell.cwd = opts.cwd.replace(/^~/, shell.home());
  shell.setVar('PWD', shell.cwd, true);
  // el propio shell en la tabla de procesos
  sys.spawn(shell.user, '-bash', { pid: shell.pid, ppid: 1640, tty: 'pts/0', mem: 0.2, rss: 5400, vsz: 11000 });
  // historial inicial
  shell.history = ['ls', 'cd Documents', 'pwd', 'clear'];
  return { sys, fs, rt, shell };
}

/** Instala un paquete: estado + binarios + efectos. */
export function installPackage(sys: System, fs: VFS, name: string): boolean {
  const e = sys.packages.get(name);
  if (!e) return false;
  if (e.installed) return true;
  e.installed = true;
  installBinaries(fs, name);
  pkgDef(name)?.onInstall?.(sys, fs);
  return true;
}
