/** Información del sistema, procesos y utilidades varias. */
import { DAYS, MONTHS, C, color, humanSize, isoDate, isoFull, pad2, table, padStart, padEnd } from '../format';
import { manPage } from '../help';
import { basename } from '../path';
import { REGISTRY, defineCommand, parseOpts, type Ctx } from '../registry';
import { SignalEx, SHELL_BUILTINS, TimeoutEx, type Job } from '../shell';
import type { Proc } from '../sys';
import { globMatch } from '../regex';
import { BufferStdin } from '../registry';

// ───────────────────────── identidad ─────────────────────────

defineCommand('whoami', { summary: 'Muestra tu nombre de usuario', usage: 'whoami', category: 'usuarios', level: 1, examples: [['whoami', 'Imprime alumno']] }, (c) => {
  c.out(c.sh.user + '\n');
});

defineCommand('id', {
  summary: 'Muestra tu UID, GID y grupos',
  usage: 'id [-ugGn] [USUARIO]',
  category: 'usuarios',
  level: 2,
  options: [['-u', 'Solo el UID'], ['-g', 'Solo el GID'], ['-G', 'Todos los GID'], ['-n', 'Nombres en vez de números']],
  examples: [['id', 'uid=1000(alumno) gid=1000(alumno) groups=…'], ['id root', 'Datos de otro usuario']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'ugGnr' });
  const name = o.rest[0] ?? c.sh.user;
  const u = c.sh.sys.user(name);
  if (!u) return c.fail(`‘${name}’: no such user`);
  const groups = c.sh.sys.groupsOf(name);
  const gid = (g: string) => c.sh.sys.groups.get(g)?.gid ?? 0;
  if (o.has('u')) c.out((o.has('n') ? name : u.uid) + '\n');
  else if (o.has('g')) c.out((o.has('n') ? groups[0] : u.gid) + '\n');
  else if (o.has('G')) c.out((o.has('n') ? groups.join(' ') : groups.map(gid).join(' ')) + '\n');
  else c.out(`uid=${u.uid}(${name}) gid=${u.gid}(${groups[0]}) groups=${groups.map((g) => `${gid(g)}(${g})`).join(',')}\n`);
});

defineCommand('groups', { summary: 'Muestra los grupos a los que pertenece un usuario', usage: 'groups [USUARIO]', category: 'usuarios', level: 2, examples: [['groups', 'alumno adm cdrom sudo dip plugdev users']] }, (c) => {
  const name = c.args[0] ?? c.sh.user;
  if (!c.sh.sys.user(name)) return c.fail(`‘${name}’: no such user`);
  const g = c.sh.sys.groupsOf(name);
  c.out((c.args[0] ? `${name} : ` : '') + g.join(' ') + '\n');
});

defineCommand('hostname', {
  summary: 'Muestra o cambia el nombre del equipo',
  usage: 'hostname [-I] [NOMBRE]',
  category: 'redes',
  level: 1,
  options: [['-I', 'Muestra las direcciones IP'], ['-f', 'Nombre completo (FQDN)']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'IifsdA' });
  if (o.has('I') || o.has('i')) {
    c.out(c.sh.sys.ipAddr + ' \n');
    return 0;
  }
  if (o.rest.length) {
    if (c.cred.name !== 'root') return c.fail('you must be root to change the host name');
    c.sh.sys.hostname = o.rest[0];
    return 0;
  }
  c.out(c.sh.sys.hostname + '\n');
});

defineCommand('uname', {
  summary: 'Muestra información del sistema operativo y el kernel',
  usage: 'uname [-asrnmvo]',
  category: 'sistema',
  level: 1,
  options: [['-a', 'Todo'], ['-r', 'Versión del kernel'], ['-s', 'Nombre del kernel'], ['-n', 'Nombre del equipo'], ['-m', 'Arquitectura'], ['-o', 'Sistema operativo']],
  examples: [['uname -a', 'Linux dojo 6.8.0-45-generic … x86_64 GNU/Linux'], ['uname -r', '6.8.0-45-generic']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'asnrvmpio', long: { '--all': 'a', '--kernel-name': 's', '--kernel-release': 'r', '--nodename': 'n', '--machine': 'm', '--operating-system': 'o' } });
  const parts: string[] = [];
  const all = o.has('a');
  if (all || o.has('s') || o.flags.size === 0) parts.push('Linux');
  if (all || o.has('n')) parts.push(c.sh.sys.hostname);
  if (all || o.has('r')) parts.push('6.8.0-45-generic');
  if (all || o.has('v')) parts.push('#45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024');
  if (all || o.has('m')) parts.push('x86_64');
  if (all || o.has('p')) parts.push('x86_64');
  if (all || o.has('i')) parts.push('x86_64');
  if (all || o.has('o')) parts.push('GNU/Linux');
  c.out(parts.join(' ') + '\n');
});

defineCommand('arch', { summary: 'Muestra la arquitectura', usage: 'arch', category: 'sistema', level: 2 }, (c) => c.out('x86_64\n'));
defineCommand('nproc', { summary: 'Muestra el número de procesadores', usage: 'nproc', category: 'sistema', level: 2 }, (c) => c.out('4\n'));
defineCommand('lsb_release', { summary: 'Muestra información de la distribución', usage: 'lsb_release -a', category: 'sistema', level: 2 }, (c) => {
  c.out('No LSB modules are available.\nDistributor ID:\tUbuntu\nDescription:\tUbuntu 24.04.1 LTS\nRelease:\t24.04\nCodename:\tnoble\n');
});

// ───────────────────────── fecha ─────────────────────────

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function strftime(fmt: string, ms: number): string {
  const d = new Date(ms);
  const Y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), H = d.getUTCHours(), M = d.getUTCMinutes(), S = d.getUTCSeconds(), w = d.getUTCDay();
  const yday = Math.floor((ms - Date.UTC(Y, 0, 1)) / 86400000) + 1;
  return fmt.replace(/%([-_0^#]?)([a-zA-Z%])/g, (_x, flag: string, ch: string) => {
    let r: string;
    switch (ch) {
      case 'Y': r = String(Y); break;
      case 'y': r = pad2(Y % 100); break;
      case 'm': r = pad2(m + 1); break;
      case 'd': r = pad2(day); break;
      case 'e': r = String(day).padStart(2, ' '); break;
      case 'H': r = pad2(H); break;
      case 'I': r = pad2(H % 12 || 12); break;
      case 'M': r = pad2(M); break;
      case 'S': r = pad2(S); break;
      case 'p': r = H < 12 ? 'AM' : 'PM'; break;
      case 'a': r = DAYS[w]; break;
      case 'A': r = FULL_DAYS[w]; break;
      case 'b': case 'h': r = MONTHS[m]; break;
      case 'B': r = FULL_MONTHS[m]; break;
      case 'j': r = String(yday).padStart(3, '0'); break;
      case 'u': r = String(w || 7); break;
      case 'w': r = String(w); break;
      case 'Z': r = 'UTC'; break;
      case 'z': r = '+0000'; break;
      case 's': r = String(Math.floor(ms / 1000)); break;
      case 'N': r = '000000000'; break;
      case 'F': r = `${Y}-${pad2(m + 1)}-${pad2(day)}`; break;
      case 'T': r = `${pad2(H)}:${pad2(M)}:${pad2(S)}`; break;
      case 'R': r = `${pad2(H)}:${pad2(M)}`; break;
      case 'D': r = `${pad2(m + 1)}/${pad2(day)}/${pad2(Y % 100)}`; break;
      case 'c': r = `${DAYS[w]} ${MONTHS[m]} ${String(day).padStart(2, ' ')} ${pad2(H)}:${pad2(M)}:${pad2(S)} ${Y}`; break;
      case 'x': r = `${pad2(m + 1)}/${pad2(day)}/${pad2(Y % 100)}`; break;
      case 'X': r = `${pad2(H)}:${pad2(M)}:${pad2(S)}`; break;
      case 'n': r = '\n'; break;
      case 't': r = '\t'; break;
      case '%': r = '%'; break;
      default: return '%' + flag + ch;
    }
    if (flag === '-') r = r.replace(/^[0 ]+(?=.)/, '');
    if (flag === '^') r = r.toUpperCase();
    return r;
  });
}

function parseDateArg(s: string, now: number): number | null {
  const t = s.trim();
  if (/^@-?\d+$/.test(t)) return parseInt(t.slice(1), 10) * 1000;
  if (t === 'now' || t === '') return now;
  if (t === 'today') return Math.floor(now / 86400000) * 86400000;
  if (t === 'yesterday') return now - 86400000;
  if (t === 'tomorrow') return now + 86400000;
  let m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(t);
  if (m) return now - +m[1] * { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }[m[2] as 'day'];
  m = /^(?:\+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?$/.exec(t);
  if (m) return now + +m[1] * { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }[m[2] as 'day'];
  m = /^next\s+(day|week|month|year)$/.exec(t);
  if (m) return now + { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }[m[1] as 'day'];
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const p = Date.parse(t + ' UTC');
  return Number.isNaN(p) ? null : p;
}

defineCommand('date', {
  summary: 'Muestra o formatea la fecha y hora',
  usage: "date [OPCIÓN]... [+FORMATO]",
  category: 'sistema',
  level: 1,
  options: [['+%Y-%m-%d', 'Formato personalizado (%H hora, %M minutos, %s epoch…)'], ['-d TEXTO', 'Usa esa fecha ("yesterday", "2 days ago", "@1700000000")'], ['-u', 'Hora UTC'], ['-I', 'ISO 8601'], ['-R', 'RFC 2822']],
  examples: [['date', 'Sat Mar 14 10:00:00 UTC 2026'], ['date +%F', '2026-03-14'], ['date -d "yesterday" +%A', 'Friday'], ['date +%s', 'Segundos desde 1970']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'uIRs', values: 'drf', long: { '--date': 'd', '--utc': 'u', '--iso-8601': 'I', '--rfc-2822': 'R' } });
  const now = c.sh.sys.clock.now;
  let ms = now;
  if (o.val('d') !== undefined) {
    const p = parseDateArg(o.val('d')!, now);
    if (p === null) return c.fail(`invalid date ‘${o.val('d')}’`);
    ms = p;
  }
  const fmtArg = o.rest.find((a) => a.startsWith('+'));
  if (fmtArg) c.out(strftime(fmtArg.slice(1), ms) + '\n');
  else if (o.has('I')) c.out(isoDate(ms) + '\n');
  else if (o.has('R')) c.out(strftime('%a, %d %b %Y %H:%M:%S +0000', ms) + '\n');
  else c.out(strftime('%a %b %e %H:%M:%S UTC %Y', ms) + '\n');
});

defineCommand('cal', {
  summary: 'Muestra un calendario',
  usage: 'cal [[MES] AÑO]',
  category: 'sistema',
  level: 2,
  examples: [['cal', 'Calendario del mes actual'], ['cal 2026', 'Todo el año'], ['cal 12 2026', 'Diciembre de 2026']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'y13mjs' });
  const now = new Date(c.sh.sys.clock.now);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  const nums = o.rest.map(Number);
  if (nums.length === 1) {
    year = nums[0];
    month = -1;
  } else if (nums.length >= 2) {
    month = nums[0] - 1;
    year = nums[1];
  }
  if (o.has('y')) month = -1;
  const today = new Date(c.sh.sys.clock.now);
  const monthLines = (mo: number): string[] => {
    const title = `${FULL_MONTHS[mo]} ${year}`;
    const lines = [title.padStart(Math.floor((20 + title.length) / 2)).padEnd(20), 'Su Mo Tu We Th Fr Sa'];
    const first = new Date(Date.UTC(year, mo, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, mo + 1, 0)).getUTCDate();
    let line = '   '.repeat(first);
    for (let d = 1; d <= days; d++) {
      const isToday = year === today.getUTCFullYear() && mo === today.getUTCMonth() && d === today.getUTCDate();
      const cell = String(d).padStart(2, ' ');
      line += (isToday && c.tty ? '\x1b[7m' + cell + '\x1b[0m' : cell) + ((first + d) % 7 === 0 ? '' : ' ');
      if ((first + d) % 7 === 0) {
        lines.push(line.replace(/ $/, ''));
        line = '';
      }
    }
    if (line) lines.push(line.replace(/ $/, ''));
    return lines;
  };
  if (month >= 0) {
    c.out(monthLines(month).map((l) => l.replace(/\s+$/, '')).join('\n') + '\n');
    return 0;
  }
  c.out(`${String(year).padStart(34)}\n\n`);
  for (let r = 0; r < 4; r++) {
    const cols = [0, 1, 2].map((k) => monthLines(r * 3 + k));
    const h = Math.max(...cols.map((x) => x.length));
    for (let i = 0; i < h; i++) c.out(cols.map((col) => (col[i] ?? '').padEnd(20)).join('  ').replace(/\s+$/, '') + '\n');
    if (r < 3) c.out('\n');
  }
});

defineCommand('uptime', {
  summary: 'Muestra cuánto tiempo lleva encendido el sistema',
  usage: 'uptime [-ps]',
  category: 'sistema',
  level: 1,
  options: [['-p', 'Formato legible'], ['-s', 'Desde cuándo está encendido']],
  examples: [['uptime', ' 10:00:01 up 3 days, 4:17, 1 user, load average: 0.12, 0.20, 0.18']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'ps' });
  const now = c.sh.sys.clock.now;
  const up = Math.floor((now - c.sh.sys.bootTime) / 1000);
  const days = Math.floor(up / 86400);
  const hours = Math.floor((up % 86400) / 3600);
  const mins = Math.floor((up % 3600) / 60);
  if (o.has('s')) {
    c.out(isoFull(c.sh.sys.bootTime) + '\n');
    return;
  }
  if (o.has('p')) {
    const parts: string[] = [];
    if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
    c.out('up ' + parts.join(', ') + '\n');
    return;
  }
  const d = new Date(now);
  const upStr = days ? `${days} day${days > 1 ? 's' : ''}, ${hours}:${pad2(mins)}` : `${hours}:${pad2(mins)}`;
  c.out(` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} up ${upStr},  1 user,  load average: 0.12, 0.20, 0.18\n`);
});

// ───────────────────────── memoria / CPU / usuarios conectados ─────────────────────────

defineCommand('free', {
  summary: 'Muestra el uso de memoria',
  usage: 'free [-hmgk]',
  category: 'sistema',
  level: 1,
  options: [['-h', 'Legible (Mi, Gi)'], ['-m', 'En MiB'], ['-g', 'En GiB'], ['-t', 'Línea de totales']],
  examples: [['free -h', 'Memoria en formato legible']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'hmgkbtws', values: 'sc' });
  const total = 8029440, used = 2201220 + Math.floor((c.sh.sys.procs.size % 50) * 40), free = 3412284, shared = 1024, cache = 2260860, avail = 5601220;
  const swapT = 2097148;
  const f = (kb: number) => {
    if (o.has('h')) {
      const b = kb * 1024;
      const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti'];
      let v = b;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (i === 0 ? String(v) : v < 10 ? v.toFixed(1) : String(Math.round(v))) + units[i];
    }
    if (o.has('m')) return String(Math.floor(kb / 1024));
    if (o.has('g')) return String(Math.floor(kb / 1048576));
    return String(kb);
  };
  const rows = [
    ['', 'total', 'used', 'free', 'shared', 'buff/cache', 'available'],
    ['Mem:', f(total), f(used), f(free), f(shared), f(cache), f(avail)],
    ['Swap:', f(swapT), f(0), f(swapT)],
  ];
  if (o.has('t')) rows.push(['Total:', f(total + swapT), f(used), f(free + swapT)]);
  const w = [0, 1, 2, 3, 4, 5, 6].map((i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  c.out(rows.map((r, ri) => (ri === 0 ? ' '.repeat(7) : r[0].padEnd(7)) + r.slice(1).map((x, i) => (ri === 0 ? x.padStart(w[i + 1] + 4) : x.padStart(w[i + 1] + 4))).join('').replace(/^/, '')).join('\n') + '\n');
});

defineCommand('lscpu', { summary: 'Muestra información de la CPU', usage: 'lscpu', category: 'sistema', level: 2 }, (c) => {
  c.out('Architecture:             x86_64\n  CPU op-mode(s):         32-bit, 64-bit\n  Byte Order:             Little Endian\nCPU(s):                   4\n  On-line CPU(s) list:    0-3\nVendor ID:                GenuineIntel\n  Model name:             Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\n    Thread(s) per core:   1\n    Core(s) per socket:   4\n    Socket(s):            1\n    CPU max MHz:          2400.0000\n');
});

defineCommand('lsblk', { summary: 'Lista los dispositivos de bloque (discos)', usage: 'lsblk', category: 'sistema', level: 2 }, (c) => {
  c.out('NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nvda       8:0    0   50G  0 disk \n├─vda1    8:1    0 49.9G  0 part /\n├─vda14   8:14   0    4M  0 part \n└─vda15   8:15   0  106M  0 part /boot/efi\n');
});

defineCommand('mount', { summary: 'Lista los sistemas de archivos montados', usage: 'mount', category: 'sistema', level: 3 }, (c) => {
  c.out('/dev/vda1 on / type ext4 (rw,relatime,discard,errors=remount-ro)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\nsysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\ntmpfs on /run type tmpfs (rw,nosuid,nodev,size=785M,mode=755)\n/dev/vda15 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077)\n');
});

defineCommand('dmesg', { summary: 'Muestra los mensajes del kernel', usage: 'dmesg', category: 'sistema', sbin: false, level: 3 }, (c) => {
  c.out('[    0.000000] Linux version 6.8.0-45-generic (buildd@lcy02-amd64-103)\n[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-6.8.0-45-generic root=UUID=3f2a9c1e ro quiet splash\n[    0.412330] smpboot: CPU0: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz\n[    1.204510] EXT4-fs (vda1): mounted filesystem with ordered data mode\n[    2.890112] systemd[1]: Started Journal Service.\n[    5.113420] eth0: link up, 1000Mbps, full-duplex\n');
});

defineCommand('who', { summary: 'Muestra quién está conectado', usage: 'who', category: 'usuarios', level: 2 }, (c) => {
  c.out(`${c.sh.user.padEnd(8)} pts/0        2026-03-14 09:40 (192.168.1.77)\n`);
});

defineCommand('w', { summary: 'Muestra quién está conectado y qué hace', usage: 'w', category: 'usuarios', level: 2 }, (c) => {
  const d = new Date(c.sh.sys.clock.now);
  c.out(` ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} up 3 days,  4:17,  1 user,  load average: 0.12, 0.20, 0.18\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n${c.sh.user.padEnd(8)} pts/0    192.168.1.77     09:40    0.00s  0.04s  0.00s w\n`);
});

defineCommand('last', { summary: 'Muestra los últimos inicios de sesión', usage: 'last [-n N]', category: 'usuarios', level: 3 }, (c) => {
  c.out('alumno   pts/0        192.168.1.77     Sat Mar 14 09:40   still logged in\nalumno   pts/0        192.168.1.77     Fri Mar 13 18:02 - 19:15  (01:12)\nana      pts/1        192.168.1.80     Fri Mar 13 11:20 - 12:01  (00:41)\nreboot   system boot  6.8.0-45-generic Wed Mar 11 05:43   still running\n\nwtmp begins Wed Mar 11 05:43:01 2026\n');
});

// ───────────────────────── entorno ─────────────────────────

defineCommand(['env', 'printenv'], {
  summary: 'Muestra las variables de entorno o ejecuta un comando con un entorno modificado',
  usage: 'env [-i] [NOMBRE=VALOR]... [COMANDO [ARGS]...]',
  category: 'scripting',
  noHelp: true,
  level: 2,
  options: [['-i', 'Entorno vacío'], ['-u NOMBRE', 'Quita una variable']],
  examples: [['env', 'Lista todas las variables'], ['printenv HOME', '/home/alumno'], ['env DEBUG=1 ./script.sh', 'Ejecuta con una variable extra']],
}, async (c) => {
  if (c.name === 'printenv') {
    if (!c.args.length) {
      for (const [k, v] of c.sh.exportedEnv()) c.out(`${k}=${v}\n`);
      return 0;
    }
    let st = 0;
    for (const n of c.args) {
      const v = c.sh.vars.get(n);
      if (v?.exported) c.out((v.arr ? v.arr[0] : v.value) + '\n');
      else st = 1;
    }
    return st;
  }
  const o = parseOpts(c, c.args, { flags: 'i0', values: 'u', stopAtOperand: true });
  const sub = c.sh.clone();
  if (o.has('i')) for (const k of [...sub.vars.keys()]) sub.vars.delete(k);
  for (const u of o.all('u')) sub.vars.delete(u);
  const rest = [...o.rest];
  while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) {
    const a = rest.shift()!;
    const eq = a.indexOf('=');
    sub.setVar(a.slice(0, eq), a.slice(eq + 1), true);
  }
  if (!rest.length) {
    for (const [k, v] of sub.exportedEnv()) c.out(`${k}=${v}\n`);
    return 0;
  }
  return sub.runArgv(rest, c.io);
});

defineCommand(['clear', 'reset'], { summary: 'Limpia la pantalla de la terminal', usage: 'clear', category: 'navegacion', level: 1, examples: [['clear', 'Limpia la pantalla (también Ctrl+L)']] }, (c) => {
  c.out('\x1b[2J\x1b[H');
});

defineCommand('tput', { summary: 'Consulta o cambia capacidades de la terminal', usage: 'tput cols|lines|clear|bold|sgr0', category: 'sistema', level: 4 }, (c) => {
  switch (c.args[0]) {
    case 'cols': c.out(String(c.cols) + '\n'); break;
    case 'lines': c.out('24\n'); break;
    case 'clear': c.out('\x1b[2J\x1b[H'); break;
    case 'bold': c.out('\x1b[1m'); break;
    case 'sgr0': c.out('\x1b[0m'); break;
    case 'setaf': c.out(`\x1b[3${c.args[1] ?? 0}m`); break;
  }
});

defineCommand('stty', { summary: 'Cambia o muestra la configuración de la terminal', usage: 'stty [-a] [size]', category: 'sistema', level: 4 }, (c) => {
  if (c.args[0] === 'size') c.out(`24 ${c.cols}\n`);
  else c.out(`speed 38400 baud; rows 24; columns ${c.cols}; line = 0;\n`);
});

defineCommand('sync', { summary: 'Escribe a disco los datos pendientes', usage: 'sync', category: 'sistema', level: 3 }, () => 0);

// ───────────────────────── tiempo / ejecución ─────────────────────────

function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(s);
  if (!m) return null;
  return parseFloat(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's'] * 1000;
}

defineCommand('sleep', {
  summary: 'Espera una cantidad de tiempo',
  usage: 'sleep NÚMERO[s|m|h|d]...',
  category: 'procesos',
  level: 1,
  examples: [['sleep 5', 'Espera 5 segundos'], ['sleep 1m', 'Espera un minuto'], ['sleep 300 &', 'Espera 5 min en segundo plano']],
}, async (c) => {
  if (!c.args.length) return c.fail("missing operand\nTry 'sleep --help' for more information.");
  let total = 0;
  for (const a of c.args) {
    const d = parseDuration(a);
    if (d === null) return c.fail(`invalid time interval ‘${a}’\nTry 'sleep --help' for more information.`);
    total += d;
  }
  if (c.sh.bg && c.sh.bgJob) {
    c.sh.bgJob.endsAt += total;
    return 0;
  }
  await c.sh.sleep(total);
});

defineCommand('time', {
  summary: 'Mide cuánto tarda un comando',
  usage: 'time COMANDO [ARGS]',
  category: 'procesos',
  noHelp: true,
  level: 2,
  examples: [['time sleep 2', 'real 0m2.000s']],
}, async (c) => {
  const t0 = c.sh.sys.clock.now;
  const st = await c.sh.runArgv(c.args, c.io);
  const el = (c.sh.sys.clock.now - t0) / 1000;
  const f = (s: number) => `${Math.floor(s / 60)}m${(s % 60).toFixed(3)}s`;
  c.err(`\nreal\t${f(el)}\nuser\t0m0.001s\nsys\t0m0.002s\n`);
  return st;
});

defineCommand('timeout', {
  summary: 'Ejecuta un comando con un límite de tiempo',
  usage: 'timeout DURACIÓN COMANDO [ARGS]',
  category: 'procesos',
  noHelp: true,
  level: 3,
  examples: [['timeout 5 ping google.com', 'Lo corta a los 5 segundos'], ['timeout 2 sleep 10; echo $?', 'Devuelve 124 si agotó el tiempo']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'v', values: 'sk', stopAtOperand: true });
  if (o.rest.length < 2) return c.fail("missing operand\nTry 'timeout --help' for more information.", 125);
  const d = parseDuration(o.rest[0]);
  if (d === null) return c.fail(`invalid time interval ‘${o.rest[0]}’`, 125);
  const rt = c.sh.rt;
  const prev = rt.deadline;
  rt.deadline = c.sh.sys.clock.now + d;
  try {
    return await c.sh.runArgv(o.rest.slice(1), c.io);
  } catch (e) {
    if (e instanceof TimeoutEx) return 124;
    throw e;
  } finally {
    rt.deadline = prev;
  }
});

defineCommand('watch', {
  summary: 'Repite un comando cada cierto tiempo (Ctrl+C para salir)',
  usage: 'watch [-n SEG] COMANDO',
  category: 'procesos',
  noHelp: true,
  level: 3,
  options: [['-n SEG', 'Intervalo (por defecto 2)'], ['-d', 'Resalta cambios']],
  examples: [['watch -n 1 date', 'Reloj que se actualiza'], ['watch df -h', 'Vigila el disco']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'dtbe', values: 'n', stopAtOperand: true });
  const interval = o.val('n') ? parseFloat(o.val('n')!) : 2;
  const cmd = o.rest.join(' ');
  if (!cmd) return c.fail('no command specified');
  const max = c.io.tty ? Infinity : 1;
  for (let i = 0; i < max; i++) {
    const head = `Every ${interval.toFixed(1)}s: ${cmd}`;
    const stamp = `${c.sh.sys.hostname}: ${strftime('%a %b %e %H:%M:%S %Y', c.sh.sys.clock.now)}`;
    if (c.io.tty) c.out('\x1b[2J\x1b[H');
    c.out(head.padEnd(Math.max(head.length + 1, c.cols - stamp.length)) + stamp + '\n\n');
    await c.sh.runLine(cmd, { ...c.io });
    if (i + 1 < max) await c.sh.sleep(interval * 1000);
  }
});

defineCommand('nohup', {
  summary: 'Ejecuta un comando que ignora el cierre de la terminal',
  usage: 'nohup COMANDO [ARGS] &',
  category: 'procesos',
  noHelp: true,
  level: 3,
  examples: [['nohup ./servidor.sh &', 'Sigue corriendo al cerrar la sesión']],
}, async (c) => {
  if (!c.args.length) return c.fail('missing operand\nTry \'nohup --help\' for more information.', 125);
  let io = c.io;
  if (c.io.tty) {
    c.err("nohup: ignoring input and appending output to 'nohup.out'\n");
    const path = c.abs('nohup.out');
    try {
      c.fs.writeFile(path, '', { append: true, cred: c.cred });
    } catch {
      /* ignore */
    }
    io = { ...c.io, tty: false, out: (s) => { try { c.fs.writeFile(path, s, { append: true, cred: c.cred }); } catch { /* */ } }, err: (s) => { try { c.fs.writeFile(path, s, { append: true, cred: c.cred }); } catch { /* */ } } };
  } else if (c.sh.bg) {
    // en segundo plano sin tty: nohup.out
    const path = c.abs('nohup.out');
    try { c.fs.writeFile(path, '', { append: true, cred: c.cred }); } catch { /* */ }
    io = { ...c.io, out: (s) => { try { c.fs.writeFile(path, s, { append: true, cred: c.cred }); } catch { /* */ } } };
    c.io.err("nohup: ignoring input and appending output to 'nohup.out'\n");
  }
  return c.sh.runArgv(c.args, io);
});

defineCommand('nice', {
  summary: 'Ejecuta un comando con otra prioridad',
  usage: 'nice [-n AJUSTE] COMANDO',
  category: 'procesos',
  noHelp: true,
  level: 3,
  examples: [['nice -n 10 tar czf backup.tgz ~', 'Baja la prioridad (más amable con el resto)']],
}, async (c) => {
  const o = parseOpts(c, c.args, { values: 'n', stopAtOperand: true, numeric: true });
  if (!o.rest.length) {
    c.out('0\n');
    return 0;
  }
  return c.sh.runArgv(o.rest, c.io);
});

defineCommand('renice', {
  summary: 'Cambia la prioridad de un proceso en ejecución',
  usage: 'renice -n PRIORIDAD -p PID',
  category: 'procesos',
  level: 3,
  options: [['-n N', 'Nueva prioridad (-20 a 19)'], ['-p PID', 'Proceso']],
  examples: [['renice -n 10 -p 1234', 'Baja la prioridad del proceso 1234']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'g', values: 'npu' });
  const prio = parseInt(o.val('n') ?? o.rest[0] ?? '', 10);
  const pids = [...o.all('p'), ...o.rest.slice(o.val('n') ? 0 : 1)].map(Number).filter((x) => !Number.isNaN(x));
  if (Number.isNaN(prio) || !pids.length) return c.fail('usage: renice [-n] priority [-p] pid...');
  let st = 0;
  for (const pid of pids) {
    const p = c.sh.sys.procs.get(pid);
    if (!p) { c.err(`renice: failed to get priority for ${pid} (process ID): No such process\n`); st = 1; continue; }
    if (c.cred.name !== 'root' && (p.user !== c.cred.name || prio < p.nice)) { c.err(`renice: failed to set priority for ${pid} (process ID): Permission denied\n`); st = 1; continue; }
    c.out(`${pid} (process ID) old priority ${p.nice}, new priority ${prio}\n`);
    p.nice = prio;
  }
  return st;
});

// ───────────────────────── ayuda: which / man ─────────────────────────

defineCommand('which', {
  summary: 'Muestra la ruta de un comando',
  usage: 'which [-a] COMANDO...',
  category: 'ayuda',
  level: 1,
  options: [['-a', 'Muestra todas las coincidencias en el PATH']],
  examples: [['which python3', '/usr/bin/python3'], ['which -a ls', 'Todas las ubicaciones']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'as' });
  let st = 0;
  for (const name of o.rest) {
    let found = false;
    const path = c.sh.getVar('PATH') ?? '';
    for (const dir of path.split(':')) {
      const p = `${dir}/${name}`;
      const n = c.fs.stat(p, c.cred);
      if (n && n.kind === 'file' && (n.mode & 0o111)) {
        c.out(p + '\n');
        found = true;
        if (!o.has('a')) break;
      }
    }
    if (!found) st = 1;
  }
  return st;
});

defineCommand('whereis', { summary: 'Localiza el binario, fuentes y manual de un comando', usage: 'whereis COMANDO...', category: 'ayuda', level: 2, examples: [['whereis ls', 'ls: /usr/bin/ls /usr/share/man/man1/ls.1.gz']] }, (c) => {
  for (const name of c.args) {
    const hits: string[] = [];
    for (const d of ['/usr/bin', '/usr/sbin', '/usr/local/bin']) if (c.fs.stat(`${d}/${name}`, c.cred)) hits.push(`${d}/${name}`);
    if (REGISTRY.has(name)) hits.push(`/usr/share/man/man1/${name}.1.gz`);
    c.out(`${name}:${hits.length ? ' ' + hits.join(' ') : ''}\n`);
  }
});

defineCommand('man', {
  summary: 'Muestra el manual de un comando',
  usage: 'man [-k PALABRA] COMANDO',
  category: 'ayuda',
  level: 1,
  options: [['-k PALABRA', 'Busca en las descripciones (como apropos)']],
  examples: [['man ls', 'Manual de ls (q para salir en Linux real)'], ['man -k copy', 'Qué comandos hablan de copiar']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'af', values: 'k' });
  if (o.val('k')) return c.sh.dispatch(['apropos', o.val('k')!], c.io);
  const names = o.rest.filter((a) => !/^\d$/.test(a));
  if (!names.length) {
    c.err('What manual page do you want?\nFor example, try \'man man\'.\n');
    return 1;
  }
  let st = 0;
  for (const n of names) {
    const def = REGISTRY.get(n);
    if (!def) {
      c.err(`No manual entry for ${n}\n`);
      st = 16;
      continue;
    }
    c.out(manPage(def));
  }
  return st;
});

defineCommand(['apropos', 'whatis'], {
  summary: 'Busca comandos por descripción',
  usage: 'apropos PALABRA   |   whatis COMANDO',
  category: 'ayuda',
  level: 2,
  examples: [['apropos directory', 'Comandos relacionados con directorios'], ['whatis grep', 'grep (1) - …']],
}, (c) => {
  if (!c.args.length) return c.fail(`${c.name} what?`);
  let any = false;
  for (const kw of c.args) {
    const lo = kw.toLowerCase();
    const seen = new Set<string>();
    for (const [name, def] of [...REGISTRY].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (seen.has(name) || SHELL_BUILTINS.has(name) && !def.summary) continue;
      const hit = c.name === 'whatis' ? name === kw : name.includes(lo) || def.summary.toLowerCase().includes(lo);
      if (hit) {
        seen.add(name);
        any = true;
        c.out(`${name.padEnd(18)} (1)  - ${def.summary}\n`);
      }
    }
    if (!any && c.name === 'whatis') c.err(`${kw}: nothing appropriate.\n`);
  }
  if (!any && c.name === 'apropos') c.err(`${c.args[0]}: nothing appropriate.\n`);
  return any ? 0 : 16;
});

// ───────────────────────── procesos ─────────────────────────

function cpuTime(secs: number) {
  return `${Math.floor(secs / 60)}:${pad2(Math.floor(secs % 60))}`;
}

function startStr(p: Proc, now: number) {
  const d = new Date(p.start);
  if (now - p.start < 86400000) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return `${MONTHS[d.getUTCMonth()]}${pad2(d.getUTCDate())}`;
}

function statOf(p: Proc, shellPid: number, fg: boolean): string {
  if (p.command.startsWith('[')) return p.state === 'I' ? 'I<' : 'S';
  let s = p.state;
  if (p.pid === 1 || p.ppid === 1 || p.pid === shellPid) s += 's';
  if (p.nice < 0) s += '<';
  else if (p.nice > 0) s += 'N';
  if (fg) s += '+';
  return s;
}

function psCommandName(cmd: string) {
  if (cmd.startsWith('[')) return cmd;
  const first = cmd.split(' ')[0];
  return basename(first.replace(/:$/, '')).replace(/^-/, '');
}

defineCommand('ps', {
  summary: 'Muestra los procesos en ejecución',
  usage: 'ps [OPCIONES]',
  category: 'procesos',
  level: 1,
  options: [['aux', 'Todos los procesos con detalle (usuario, %CPU, %MEM)'], ['-ef', 'Todos los procesos, formato completo (con PPID)'], ['-u USUARIO', 'Procesos de un usuario'], ['-p PID', 'Un proceso concreto'], ['-o col,col', 'Columnas a elegir (pid,ppid,user,comm,%cpu,%mem,etime)'], ['--sort=-%cpu', 'Ordenar (prefijo - = descendente)'], ['--forest', 'Árbol de procesos']],
  examples: [['ps', 'Procesos de esta terminal'], ['ps aux | grep nginx', 'Busca un servicio'], ['ps -ef --forest', 'Árbol padre-hijo'], ['ps -o pid,comm -p 1', 'Columnas personalizadas']],
}, (c) => {
  const sort = c.args.find((a) => a.startsWith('--sort'))?.split('=')[1] ?? (c.args.includes('--sort') ? c.args[c.args.indexOf('--sort') + 1] : undefined);
  const forest = c.args.includes('--forest') || c.args.includes('f') && false;
  const args = c.args.filter((a) => !a.startsWith('--sort') && a !== '--forest' && a !== sort);
  // BSD style (aux) sin guion
  const bsd = args.length > 0 && /^[a-zA-Z]+$/.test(args[0]) && !args[0].startsWith('-') ? args.shift()! : '';
  const o = parseOpts(c, args, { flags: 'efAaxlwhH', values: 'uUpoCtsG', long: { '--no-headers': 'h' } });
  const sys = c.sh.sys;
  const now = sys.clock.now;
  // el propio ps
  const self = sys.spawn(c.sh.user, c.name === 'ps' ? 'ps ' + c.args.join(' ').trim() : c.name, { ppid: c.sh.pid, tty: 'pts/0', state: 'R', cpu: 0, mem: 0.1, rss: 3400 });
  try {
    let list = [...sys.procs.values()];
    const all = o.has('e') || o.has('A') || bsd.includes('a') && (bsd.includes('x') || bsd.includes('u')) || bsd === 'ax' || bsd.includes('x');
    const bsdAll = bsd.includes('a') || bsd.includes('x');
    if (o.val('u') || o.val('U')) {
      const u = o.val('u') ?? o.val('U')!;
      list = list.filter((p) => p.user === u);
    } else if (o.val('p')) {
      const pids = o.val('p')!.split(',').map(Number);
      list = list.filter((p) => pids.includes(p.pid));
    } else if (!all && !bsdAll) {
      // procesos de esta terminal
      list = list.filter((p) => p.tty === 'pts/0' && p.user === c.sh.user);
    } else if (bsd.includes('a') && !bsd.includes('x')) {
      list = list.filter((p) => p.tty !== '?');
    }
    list.sort((a, b) => a.pid - b.pid);
    if (sort) {
      const desc = sort.startsWith('-');
      const key = sort.replace(/^[-+]/, '');
      const val = (p: Proc) => (key === '%cpu' || key === 'pcpu' ? p.cpu : key === '%mem' || key === 'pmem' ? p.mem : key === 'rss' ? p.rss : key === 'vsz' ? p.vsz : key === 'pid' ? p.pid : key === 'ppid' ? p.ppid : 0);
      list.sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)));
    }
    const fg = (p: Proc) => p.tty === 'pts/0' && (p.pid === self.pid || sys.procs.get(p.pid)?.state === 'R');
    const shellPid = c.sh.pid;
    let rows: string[][];
    const header = !o.has('h');
    const oSpec = o.all('o').join(',');
    if (oSpec) {
      const cols = oSpec.split(',').map((x) => x.trim().replace(/=.*/, ''));
      const names: Record<string, string> = { pid: 'PID', ppid: 'PPID', user: 'USER', comm: 'COMMAND', cmd: 'CMD', args: 'COMMAND', '%cpu': '%CPU', pcpu: '%CPU', '%mem': '%MEM', pmem: '%MEM', rss: 'RSS', vsz: 'VSZ', etime: 'ELAPSED', stat: 'STAT', tty: 'TTY', nice: 'NI', ni: 'NI', time: 'TIME', start: 'STARTED', uid: 'UID', pri: 'PRI' };
      const get = (p: Proc, col: string) => {
        switch (col) {
          case 'pid': return String(p.pid);
          case 'ppid': return String(p.ppid);
          case 'user': return p.user;
          case 'uid': return String(sys.user(p.user)?.uid ?? 0);
          case 'comm': return psCommandName(p.command);
          case 'cmd': case 'args': return p.command;
          case '%cpu': case 'pcpu': return p.cpu.toFixed(1);
          case '%mem': case 'pmem': return p.mem.toFixed(1);
          case 'rss': return String(p.rss);
          case 'vsz': return String(p.vsz);
          case 'stat': return statOf(p, shellPid, fg(p));
          case 'tty': return p.tty;
          case 'nice': case 'ni': return String(p.nice);
          case 'pri': return String(20 - p.nice);
          case 'time': return '00:' + cpuTime(p.time).padStart(5, '0');
          case 'etime': { const s = Math.floor((now - p.start) / 1000); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); return `${d ? d + '-' : ''}${d || h ? pad2(h) + ':' : ''}${pad2(m)}:${pad2(s % 60)}`; }
          case 'start': return startStr(p, now);
          default: return '-';
        }
      };
      rows = list.map((p) => cols.map((col) => get(p, col)));
      if (header) rows.unshift(cols.map((col) => names[col] ?? col.toUpperCase()));
      const lastIsText = ['comm', 'cmd', 'args'].includes(cols[cols.length - 1]);
      c.out(table(rows, cols.map((col) => (['comm', 'cmd', 'args', 'user', 'stat', 'tty'].includes(col) ? 'l' : 'r') as 'l' | 'r')).replace(/^/gm, '').replace(lastIsText ? /$^/ : /$^/, ''));
      return 0;
    }
    if (bsd.includes('u') || o.has('l') && false) {
      rows = list.map((p) => [p.user.length > 8 ? p.user.slice(0, 7) + '+' : p.user, String(p.pid), p.cpu.toFixed(1), p.mem.toFixed(1), String(p.vsz), String(p.rss), p.tty, statOf(p, shellPid, fg(p)), startStr(p, now), cpuTime(p.time), p.command]);
      if (header) rows.unshift(['USER', 'PID', '%CPU', '%MEM', 'VSZ', 'RSS', 'TTY', 'STAT', 'START', 'TIME', 'COMMAND']);
      c.out(fmtPsTable(rows, [0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0], Infinity, [8, 7, 4, 4, 6, 5, 8, 4, 5, 6, 0]));
      return 0;
    }
    if (o.has('e') || o.has('f') || o.has('A')) {
      if (forest) list = treeOrder(list);
      const full = o.has('f');
      rows = list.map((p) => {
        const d = new Date(p.start);
        const stime = now - p.start < 86400000 ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : `${MONTHS[d.getUTCMonth()]}${pad2(d.getUTCDate())}`;
        const cmd = forest ? treePrefix(p, list) + p.command : p.command;
        return full
          ? [p.user.length > 8 ? p.user.slice(0, 7) + '+' : p.user, String(p.pid), String(p.ppid), '0', stime, p.tty, '00:' + cpuTime(p.time).padStart(5, '0'), cmd]
          : [String(p.pid), p.tty, '00:' + cpuTime(p.time).padStart(5, '0'), psCommandName(p.command)];
      });
      if (header) rows.unshift(full ? ['UID', 'PID', 'PPID', 'C', 'STIME', 'TTY', 'TIME', 'CMD'] : ['PID', 'TTY', 'TIME', 'CMD']);
      c.out(fmtPsTable(rows, full ? [0, 1, 1, 1, 0, 0, 1, 0] : [1, 0, 1, 0], Infinity, full ? [8, 7, 7, 2, 5, 8, 8, 0] : [7, 8, 8, 0]));
      return 0;
    }
    rows = list.map((p) => [String(p.pid), p.tty, '00:' + cpuTime(p.time).padStart(5, '0'), psCommandName(p.command)]);
    if (header) rows.unshift(['PID', 'TTY', 'TIME', 'CMD']);
    c.out(fmtPsTable(rows, [1, 0, 1, 0], Infinity, [7, 8, 8, 0]));
    return 0;
  } finally {
    sys.killProc(self.pid);
  }
});

function fmtPsTable(rows: string[][], right: number[], width: number, minW: number[] = []): string {
  const w: number[] = [];
  for (const r of rows) r.forEach((x, i) => (w[i] = Math.max(w[i] ?? 0, x.length, minW[i] ?? 0)));
  return (
    rows
      .map((r) => {
        const line = r
          .map((x, i) => {
            if (i === r.length - 1) return x;
            return right[i] ? x.padStart(w[i]) : x.padEnd(w[i]);
          })
          .join(' ');
        return line.length > width && width !== Infinity ? line.slice(0, width) : line;
      })
      .join('\n') + '\n'
  );
}

function treeOrder(list: Proc[]): Proc[] {
  const by = new Map<number, Proc[]>();
  for (const p of list) {
    const arr = by.get(p.ppid) ?? [];
    arr.push(p);
    by.set(p.ppid, arr);
  }
  const ids = new Set(list.map((p) => p.pid));
  const out: Proc[] = [];
  const walk = (p: Proc) => {
    out.push(p);
    for (const ch of by.get(p.pid) ?? []) walk(ch);
  };
  for (const p of list) if (!ids.has(p.ppid) || p.ppid === 0) walk(p);
  return out;
}

function treePrefix(p: Proc, list: Proc[]): string {
  let depth = 0;
  let cur: Proc | undefined = p;
  const map = new Map(list.map((x) => [x.pid, x]));
  while (cur && map.has(cur.ppid) && depth < 10) {
    cur = map.get(cur.ppid);
    depth++;
  }
  return depth ? '  '.repeat(depth - 1) + '\\_ ' : '';
}

defineCommand(['top', 'htop'], {
  summary: 'Monitor interactivo de procesos (q para salir)',
  usage: 'top [-bn1]',
  category: 'procesos',
  level: 1,
  options: [['-b', 'Modo por lotes (no interactivo)'], ['-n N', 'N iteraciones'], ['q', 'Salir (Linux real)'], ['k', 'Matar un proceso (Linux real)']],
  examples: [['top', 'Monitor en vivo'], ['top -bn1 | head -15', 'Una sola captura']],
  package: undefined,
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'bHi', values: 'ndpu' });
  const sys = c.sh.sys;
  const now = sys.clock.now;
  const d = new Date(now);
  const up = Math.floor((now - sys.bootTime) / 1000);
  const days = Math.floor(up / 86400);
  const hours = Math.floor((up % 86400) / 3600);
  const mins = Math.floor((up % 3600) / 60);
  const procs = [...sys.procs.values()].filter((p) => !p.command.startsWith('['));
  const running = procs.filter((p) => p.state === 'R').length + 1;
  let out = `top - ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} up ${days} days, ${hours}:${pad2(mins)},  1 user,  load average: 0.12, 0.20, 0.18\n`;
  out += `Tasks: ${String(sys.procs.size + 1).padStart(3)} total,   ${running} running, ${sys.procs.size + 1 - running} sleeping,   0 stopped,   0 zombie\n`;
  out += '%Cpu(s):  2.3 us,  0.7 sy,  0.0 ni, 96.8 id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st\n';
  out += 'MiB Mem :   7842.0 total,   3332.1 free,   2149.6 used,   2207.9 buff/cache\n';
  out += 'MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   5469.9 avail Mem \n\n';
  const rows: string[][] = [['PID', 'USER', 'PR', 'NI', 'VIRT', 'RES', 'SHR', 'S', '%CPU', '%MEM', 'TIME+', 'COMMAND']];
  const sorted = [...procs].sort((a, b) => b.cpu - a.cpu || a.pid - b.pid).slice(0, Math.max(8, c.io.tty ? 15 : 30));
  for (const p of sorted) {
    rows.push([String(p.pid), p.user.slice(0, 8), String(20 - p.nice), String(p.nice), String(p.vsz), String(p.rss), String(Math.floor(p.rss / 3)), p.state === 'I' ? 'I' : p.state, p.cpu.toFixed(1), p.mem.toFixed(1), cpuTime(p.time) + '.00', psCommandName(p.command)]);
  }
  out += table(rows, ['r', 'l', 'r', 'r', 'r', 'r', 'r', 'l', 'r', 'r', 'r', 'l']);
  c.out(out);
  if (c.io.tty && !o.has('b') && !c.sh.bg) {
    // interactivo: espera 'q'
    for (;;) {
      const line = await c.stdin.readLine();
      if (line === null || /^\s*q\s*$/i.test(line)) break;
    }
    c.out('\x1b[2J\x1b[H');
  }
});

defineCommand('pgrep', {
  summary: 'Busca procesos por nombre',
  usage: 'pgrep [-lfu] PATRÓN',
  category: 'procesos',
  level: 2,
  options: [['-l', 'Muestra también el nombre'], ['-f', 'Busca en la línea de comando completa'], ['-u USER', 'Solo de ese usuario'], ['-x', 'Coincidencia exacta']],
  examples: [['pgrep -l ssh', 'PID y nombre de procesos ssh']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'lfxia', values: 'u' });
  const pat = o.rest[0];
  if (!pat) return c.fail('no matching criteria specified\nTry `pgrep --help\' for more information.', 2);
  const re = new RegExp(pat, o.has('i') ? 'i' : '');
  const found = [...c.sh.sys.procs.values()].filter((p) => {
    if (o.val('u') && p.user !== o.val('u')) return false;
    if (p.command.startsWith('[') ) return false;
    const target = o.has('f') ? p.command : psCommandName(p.command);
    return o.has('x') ? target === pat : re.test(target);
  });
  for (const p of found) c.out(o.has('l') ? `${p.pid} ${psCommandName(p.command)}\n` : `${p.pid}\n`);
  return found.length ? 0 : 1;
});

defineCommand('pidof', { summary: 'Muestra el PID de un programa', usage: 'pidof NOMBRE', category: 'procesos', level: 2 }, (c) => {
  const pids = [...c.sh.sys.procs.values()].filter((p) => psCommandName(p.command) === c.args[0]).map((p) => p.pid).reverse();
  if (!pids.length) return 1;
  c.out(pids.join(' ') + '\n');
});

export const SIGNALS: Record<string, number> = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, SEGV: 11, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, CONT: 18, STOP: 19, TSTP: 20 };

function sendSignal(c: Ctx, pid: number, sig: number, label?: string): number {
  const sys = c.sh.sys;
  const p = sys.procs.get(pid);
  if (!p) {
    c.err(`bash: kill: (${pid}) - No such process\n`);
    return 1;
  }
  if (c.cred.name !== 'root' && p.user !== c.cred.name) {
    c.err(`bash: kill: (${pid}) - Operation not permitted\n`);
    return 1;
  }
  void label;
  if (sig === 0) return 0;
  const job = c.sh.rt.jobs.find((j) => j.pid === pid);
  if (sig === 18) {
    p.state = 'S';
    if (job && job.state === 'stopped') {
      job.state = 'running';
      job.endsAt = sys.clock.now + (job.remainingMs ?? 0);
    }
    return 0;
  }
  if (sig === 19 || sig === 20) {
    p.state = 'T';
    if (job && job.state === 'running') {
      job.state = 'stopped';
      job.remainingMs = Math.max(0, job.endsAt - sys.clock.now);
    }
    return 0;
  }
  if (pid === 1 && sig !== 9) return 0;
  if (pid === c.sh.pid && sig === 15) return 0; // el shell interactivo ignora SIGTERM
  if (pid === c.sh.pid && sig === 2) return 0;
  // terminar
  sys.killProc(pid);
  if (job) job.state = 'killed';
  for (const s of sys.services.values()) {
    if (s.pid === pid) s.state = sig === 9 || sig === 15 ? 'inactive' : s.state;
  }
  // hijos huérfanos de servicios (workers)
  for (const ch of [...sys.procs.values()]) if (ch.ppid === pid && ch.command.startsWith('nginx:')) sys.killProc(ch.pid);
  return 0;
}

defineCommand('kill', {
  summary: 'Envía una señal a un proceso (por defecto TERM)',
  usage: 'kill [-SEÑAL] PID...',
  category: 'procesos',
  level: 2,
  noHelp: true,
  options: [['-9 / -KILL', 'Terminación forzosa (no se puede ignorar)'], ['-15 / -TERM', 'Petición educada de terminar (por defecto)'], ['-STOP / -CONT', 'Pausar / reanudar'], ['-l', 'Lista las señales'], ['%N', 'Un trabajo del shell (jobs)']],
  examples: [['kill 1234', 'Pide al proceso 1234 que termine'], ['kill -9 1234', 'Lo mata sin contemplaciones'], ['kill %1', 'Mata el trabajo 1']],
}, (c) => {
  let sig = 15;
  const args = [...c.args];
  if (args[0] === '-l' || args[0] === '-L') {
    c.out(Object.entries(SIGNALS).sort((a, b) => a[1] - b[1]).map(([n, v]) => `${String(v).padStart(2)}) SIG${n}`).join('\t') + '\n');
    return 0;
  }
  if (args[0] === '-s' || args[0] === '-n') {
    const name = (args[1] ?? '').replace(/^SIG/, '');
    sig = SIGNALS[name] ?? parseInt(name, 10);
    args.splice(0, 2);
  } else if (args[0]?.startsWith('-') && args[0].length > 1) {
    const name = args[0].slice(1).replace(/^SIG/, '');
    const n = SIGNALS[name] ?? (/^\d+$/.test(name) ? parseInt(name, 10) : NaN);
    if (Number.isNaN(n)) {
      c.err(`bash: kill: ${args[0].slice(1)}: invalid signal specification\n`);
      return 1;
    }
    sig = n;
    args.shift();
  }
  if (!args.length) {
    c.err('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n');
    return 2;
  }
  let st = 0;
  for (const a of args) {
    if (a.startsWith('%')) {
      const j = c.sh.findJob(a);
      if (!j) {
        c.err(`bash: kill: ${a}: no such job\n`);
        st = 1;
        continue;
      }
      st |= sendSignal(c, j.pid, sig);
    } else if (/^-?\d+$/.test(a)) st |= sendSignal(c, parseInt(a, 10), sig);
    else {
      c.err(`bash: kill: ${a}: arguments must be process or job IDs\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand(['killall', 'pkill'], {
  summary: 'Envía una señal a procesos por nombre',
  usage: 'killall [-SEÑAL] NOMBRE   |   pkill [-SEÑAL] PATRÓN',
  category: 'procesos',
  level: 2,
  options: [['-9', 'Forzar'], ['-u USER', 'Solo de un usuario'], ['-f', 'pkill: coincidir con la línea completa']],
  examples: [['killall firefox', 'Cierra todos los procesos firefox'], ['pkill -f script.sh', 'Por línea de comando']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'fxiqvw', values: 'us', numeric: true, lenient: true });
  const sigArg = c.args.find((a) => /^-(\d+|[A-Z]+)$/.test(a));
  let sig = 15;
  if (sigArg) {
    const name = sigArg.slice(1);
    sig = SIGNALS[name.replace(/^SIG/, '')] ?? (/^\d+$/.test(name) ? parseInt(name, 10) : 15);
  }
  const names = o.rest.filter((a) => a !== sigArg);
  if (!names.length) return c.fail('no process specification');
  let any = false;
  for (const n of names) {
    const re = c.name === 'pkill' ? new RegExp(n) : null;
    for (const p of [...c.sh.sys.procs.values()]) {
      if (p.command.startsWith('[') || p.pid === c.sh.pid) continue;
      if (o.val('u') && p.user !== o.val('u')) continue;
      const nm = psCommandName(p.command);
      const hit = c.name === 'killall' ? nm === n : re!.test(o.has('f') ? p.command : nm);
      if (hit) {
        any = true;
        sendSignal(c, p.pid, sig);
      }
    }
  }
  if (!any) {
    if (c.name === 'killall') c.err(`${names[0]}: no process found\n`);
    return 1;
  }
  return 0;
});

defineCommand('lsof', {
  summary: 'Lista archivos abiertos y sockets',
  usage: 'lsof [-i[:puerto]] [-p PID]',
  category: 'procesos',
  package: 'lsof',
  level: 3,
  examples: [['lsof -i :80', 'Qué proceso usa el puerto 80']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'nPt', values: 'ipu' });
  const port = o.val('i')?.replace(/^.*:/, '');
  const rows = [['COMMAND', 'PID', 'USER', 'FD', 'TYPE', 'NODE', 'NAME']];
  for (const l of c.sh.sys.listening()) {
    if (port && String(l.port) !== port) continue;
    rows.push([l.proc, String(l.pid), l.user, '6u', 'IPv4', 'TCP', `${l.addr}:${l.port} (LISTEN)`]);
  }
  if (rows.length === 1) return 1;
  c.out(table(rows));
});

// ───────────────────────── shells y editores ─────────────────────────

defineCommand(['bash', 'sh', 'dash'], {
  summary: 'Intérprete de comandos: ejecuta scripts o líneas con -c',
  usage: "bash [-c 'COMANDO'] [SCRIPT [ARGS]]",
  category: 'scripting',
  noHelp: true,
  level: 2,
  options: [['-c TEXTO', 'Ejecuta el texto como comando'], ['-n', 'Solo comprueba la sintaxis'], ['-x', 'Muestra cada comando ejecutado']],
  examples: [['bash script.sh', 'Ejecuta un script sin necesitar permiso x'], ["bash -c 'echo $((2+3))'", 'Ejecuta una línea']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'nxevulis', values: 'c', stopAtOperand: true, lenient: true, long: { '--version': 'V' } });
  if (o.has('V')) {
    c.out('GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n');
    return 0;
  }
  const sub = c.sh.forkExec();
  if (o.has('x')) sub.opts.add('x');
  if (o.has('e')) sub.opts.add('e');
  if (o.has('u')) sub.opts.add('u');
  if (o.val('c') !== undefined) {
    sub.scriptName = o.rest[0] ?? 'bash';
    sub.positional = o.rest.slice(1);
    sub.interactive = false;
    try {
      return await sub.runLine(o.val('c')!, c.io);
    } catch (e) {
      if (e instanceof Error && e.constructor.name === 'ExitEx') return (e as any).code;
      throw e;
    }
  }
  if (!o.rest.length) {
    const text = await c.stdin.readAll();
    return sub.runScript(text, 'bash', [], c.io);
  }
  const f = o.rest[0];
  let content: string;
  try {
    content = c.fs.readFile(c.abs(f), c.cred);
  } catch (e) {
    c.err(`bash: ${f}: ${(e as Error).message}\n`);
    return 127;
  }
  if (o.has('n')) {
    const { parse } = await import('../parser');
    try {
      parse(content);
      return 0;
    } catch (e) {
      c.err(`${f}: ${(e as Error).message}\n`);
      return 2;
    }
  }
  return sub.runScript(content, f, o.rest.slice(1), c.io);
});

defineCommand(['nano', 'vi', 'vim', 'edit'], {
  summary: 'Editor de texto (en la app se abre un editor integrado)',
  usage: 'nano [ARCHIVO]',
  category: 'archivos',
  level: 1,
  options: [['Ctrl+O', 'Guardar (nano)'], ['Ctrl+X', 'Salir (nano)'], [':wq', 'Guardar y salir (vim)'], [':q!', 'Salir sin guardar (vim)']],
  examples: [['nano notas.txt', 'Abre/crea notas.txt'], ['vim script.sh', 'Editor vim']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'cwBlmiAESqzvRHg', values: 'rntFTUY+', lenient: true });
  const file = o.rest[0];
  if (c.name === 'vim' && !c.sh.sys.pkgInstalled('vim')) return c.sh.notFound('vim', c.io);
  if (!file) return 0;
  const abs = c.abs(file);
  let content = '';
  const ex = c.fs.stat(abs, c.cred);
  if (ex && ex.kind === 'dir') {
    c.err(`${c.name}: ${file}: Is a directory\n`);
    return 1;
  }
  if (ex) {
    try {
      content = c.fs.readFile(abs, c.cred);
    } catch (e) {
      c.err(`${c.name}: ${file}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  const editor = c.sh.rt.editor;
  if (!editor) {
    c.err(`${c.name}: el editor interactivo no está disponible aquí (usa echo, printf o cat > archivo)\n`);
    return 1;
  }
  const result = await editor(abs, content, c.name === 'vi' ? 'vim' : c.name);
  if (result === null) return 0;
  try {
    c.fs.writeFile(abs, result, { cred: c.cred });
  } catch (e) {
    c.err(`${c.name}: ${file}: ${(e as Error).message}\n`);
    return 1;
  }
  return 0;
});

// ───────────────────────── diversión ─────────────────────────

defineCommand('cowsay', {
  summary: 'Una vaca ASCII que dice lo que quieras',
  usage: 'cowsay TEXTO',
  category: 'sistema',
  package: 'cowsay',
  level: 1,
  examples: [['cowsay "Hola Linux"', 'La vaca habla'], ['fortune | cowsay', 'Con otro comando']],
}, async (c) => {
  const text = c.args.length ? c.args.join(' ') : (await c.stdin.readAll()).trim();
  const lines = text.split('\n').flatMap((l) => (l.length > 40 ? l.match(/.{1,40}/g)! : [l]));
  const w = Math.max(...lines.map((l) => l.length), 1);
  let out = ' ' + '_'.repeat(w + 2) + '\n';
  if (lines.length === 1) out += `< ${lines[0].padEnd(w)} >\n`;
  else lines.forEach((l, i) => (out += `${i === 0 ? '/' : i === lines.length - 1 ? '\\' : '|'} ${l.padEnd(w)} ${i === 0 ? '\\' : i === lines.length - 1 ? '/' : '|'}\n`));
  out += ' ' + '-'.repeat(w + 2) + '\n';
  out += '        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||\n';
  c.out(out);
});

defineCommand('neofetch', {
  summary: 'Muestra información del sistema con el logo de la distribución',
  usage: 'neofetch',
  category: 'sistema',
  level: 1,
}, (c) => {
  const art = ['            .-/+oossssoo+/-.', '        `:+ssssssssssssssssss+:`', '      -+ssssssssssssssssssyyssss+-', '    .ossssssssssssssssssdMMMNysssso.', '   /ssssssssssshdmmNNmmyNMMMMhssssss/', '  +ssssssssshmydMMMMMMMNddddyssssssss+'];
  const info = [`${c.sh.user}@${c.sh.sys.hostname}`, '-'.repeat(c.sh.user.length + c.sh.sys.hostname.length + 1), 'OS: Ubuntu 24.04.1 LTS x86_64', 'Kernel: 6.8.0-45-generic', 'Uptime: 3 days, 4 hours', 'Shell: bash 5.2.21', 'CPU: Intel Xeon E5-2680 v4 (4)', 'Memory: 2149MiB / 7842MiB'];
  const n = Math.max(art.length, info.length);
  let out = '';
  for (let i = 0; i < n; i++) out += `${color(C.boldYellow, (art[i] ?? '').padEnd(42))} ${info[i] ?? ''}\n`;
  c.out(out);
});

export { SignalEx, humanSize, padStart, padEnd, globMatch, BufferStdin };
export type { Job };
