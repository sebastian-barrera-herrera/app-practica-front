/** apt, dpkg, systemctl, service, journalctl, crontab. */
import { C, color, isoFull, MONTHS, pad2, table } from '../format';
import { removeBinaries, pkgDef } from '../pkgdb';
import { defineCommand, parseOpts, REGISTRY, type Ctx } from '../registry';
import { SignalEx } from '../shell';
import type { ServiceEntry } from '../sys';
import { installPackage } from '../world';
import { strftime } from './system';
import { splitLines } from './util';

// ───────────────────────── apt ─────────────────────────

const lockError = (c: Ctx, what: 'install' | 'update') => {
  if (what === 'update') {
    c.err('Reading package lists... Done\nE: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/\nW: Problem unlinking the file /var/cache/apt/pkgcache.bin - RemoveCaches (13: Permission denied)\nW: Problem unlinking the file /var/cache/apt/srcpkgcache.bin - RemoveCaches (13: Permission denied)\n');
  } else {
    c.err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n');
  }
  return 100;
};

async function confirm(c: Ctx, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  c.out('Do you want to continue? [Y/n] ');
  const line = await c.stdin.readLine();
  if (line === null) {
    c.out('\nAbort.\n');
    return false;
  }
  if (c.stdin.isTTY) { /* el eco lo hace la terminal */ }
  if (/^\s*(y|yes|s|si|sí)?\s*$/i.test(line)) return true;
  c.out('Abort.\n');
  return false;
}

const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} kB`);

/** Actualizaciones pendientes simuladas tras `apt update`. [paquete, versión nueva, versión instalada] */
const UPGRADABLE: [string, string, string][] = [
  ['bash', '5.2.21-2ubuntu4.1', '5.2.21-2ubuntu4'],
  ['curl', '8.5.0-2ubuntu10.5', '8.5.0-2ubuntu10.2'],
  ['libc6', '2.39-0ubuntu8.3', '2.39-0ubuntu8.2'],
  ['libcurl4t64', '8.5.0-2ubuntu10.5', '8.5.0-2ubuntu10.2'],
  ['libssl3t64', '3.0.13-0ubuntu3.4', '3.0.13-0ubuntu3.2'],
  ['openssh-client', '1:9.6p1-3ubuntu13.5', '1:9.6p1-3ubuntu13'],
  ['openssh-server', '1:9.6p1-3ubuntu13.5', '1:9.6p1-3ubuntu13'],
  ['openssl', '3.0.13-0ubuntu3.4', '3.0.13-0ubuntu3.2'],
  ['sudo', '1.9.15p5-3ubuntu5.1', '1.9.15p5-3ubuntu5'],
  ['systemd', '255.4-1ubuntu8.4', '255.4-1ubuntu8.1'],
  ['tzdata', '2024b-0ubuntu0.24.04.1', '2024a-2ubuntu1'],
  ['vim-tiny', '2:9.1.0016-1ubuntu7.3', '2:9.1.0016-1ubuntu7'],
];

defineCommand(['apt', 'apt-get'], {
  summary: 'Gestor de paquetes de Debian/Ubuntu',
  usage: 'apt [-y] update|upgrade|install|remove|purge|autoremove|search|show|list PAQUETE...',
  category: 'paquetes',
  level: 2,
  options: [['update', 'Actualiza la lista de paquetes disponibles'], ['upgrade', 'Actualiza los paquetes instalados'], ['install P', 'Instala paquetes'], ['remove P', 'Desinstala (conserva configuración)'], ['purge P', 'Desinstala y borra configuración'], ['autoremove', 'Quita dependencias huérfanas'], ['search T', 'Busca paquetes'], ['show P', 'Información de un paquete'], ['list --installed', 'Paquetes instalados'], ['-y', 'Responde sí a todo']],
  examples: [['sudo apt update && sudo apt upgrade -y', 'Actualiza el sistema'], ['sudo apt install tree', 'Instala tree'], ['apt search web server', 'Busca'], ['apt list --installed | grep python', 'Filtra instalados']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'yqfsVd', values: 'oc', long: { '--yes': 'y', '--quiet': 'q', '--installed': 'I', '--upgradable': 'U', '--no-install-recommends': 'N', '--assume-yes': 'y', '--purge': 'P', '--fix-missing': 'f' } });
  const sub = o.rest[0];
  const pkgs = o.rest.slice(1);
  const sys = c.sh.sys;
  const root = c.cred.name === 'root';
  const yes = o.has('y');
  if (!c.io.tty && c.name === 'apt' && sub !== 'list' && sub !== 'search' && sub !== 'show') {
    c.err('\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
  } else if (!c.io.tty && c.name === 'apt') c.err('\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
  if (!sub) {
    c.out('apt 2.7.14build2 (amd64)\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  reinstall - reinstall packages\n  remove - remove packages\n  autoremove - Remove automatically all unused packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n');
    return 0;
  }
  switch (sub) {
    case 'update': {
      if (!root) return lockError(c, 'update');
      const base = 'http://archive.ubuntu.com/ubuntu';
      c.out(`Hit:1 ${base} noble InRelease\nGet:2 ${base} noble-updates InRelease [126 kB]\nGet:3 ${base} noble-backports InRelease [126 kB]\nGet:4 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nGet:5 ${base} noble-updates/main amd64 Packages [1,028 kB]\nFetched 1,406 kB in 1s (1,902 kB/s)\nReading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n`);
      sys.aptUpdated = true;
      c.out(sys.aptUpdated ? '12 packages can be upgraded. Run \'apt list --upgradable\' to see them.\n' : '');
      return 0;
    }
    case 'upgrade': case 'full-upgrade': case 'dist-upgrade': {
      if (!root) return lockError(c, 'install');
      c.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\nCalculating upgrade... Done\n');
      if (!sys.aptUpdated) {
        c.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
        return 0;
      }
      c.out(`The following packages will be upgraded:\n  ${UPGRADABLE.map((u) => u[0]).join(' ')}\n${UPGRADABLE.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\nNeed to get 12.4 MB of archives.\nAfter this operation, 0 B of additional disk space will be used.\n`);
      if (!(await confirm(c, yes))) return 1;
      c.out('Get:1 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 libc6 amd64 2.39-0ubuntu8.3 [2,906 kB]\nFetched 12.4 MB in 2s (6,200 kB/s)\n(Reading database ... 70234 files and directories currently installed.)\nPreparing to unpack .../libc6_2.39-0ubuntu8.3_amd64.deb ...\nSetting up libc6:amd64 (2.39-0ubuntu8.3) ...\nProcessing triggers for man-db (2.12.0-4build2) ...\n');
      sys.aptUpdated = false;
      return 0;
    }
    case 'install': case 'reinstall': {
      if (!pkgs.length) { c.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      if (!root) return lockError(c, 'install');
      c.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      const toInstall: string[] = [];
      for (const p of pkgs.filter((x) => !x.startsWith('-'))) {
        const e = sys.packages.get(p);
        if (!e) {
          c.err(`E: Unable to locate package ${p}\n`);
          return 100;
        }
        if (e.installed && sub === 'install') c.out(`${p} is already the newest version (${e.version}).\n`);
        else toInstall.push(p);
      }
      if (!toInstall.length) {
        c.out(`0 upgraded, 0 newly installed, 0 to remove and ${sys.aptUpdated ? 12 : 0} not upgraded.\n`);
        return 0;
      }
      const size = toInstall.reduce((s, p) => s + sys.packages.get(p)!.sizeKb, 0);
      c.out(`The following NEW packages will be installed:\n  ${toInstall.join(' ')}\n0 upgraded, ${toInstall.length} newly installed, 0 to remove and ${sys.aptUpdated ? 12 : 0} not upgraded.\nNeed to get ${kb(Math.floor(size / 3))} of archives.\nAfter this operation, ${kb(size)} of additional disk space will be used.\n`);
      if (!(await confirm(c, yes))) return 1;
      let n = 1;
      for (const p of toInstall) {
        const e = sys.packages.get(p)!;
        c.out(`Get:${n++} http://archive.ubuntu.com/ubuntu noble/universe amd64 ${p} amd64 ${e.version} [${Math.floor(e.sizeKb / 3)} kB]\n`);
      }
      c.out(`Fetched ${kb(Math.floor(size / 3))} in 1s (${Math.floor(size / 3)} kB/s)\n`);
      for (const p of toInstall) {
        const e = sys.packages.get(p)!;
        c.out(`Selecting previously unselected package ${p}.\n(Reading database ... 70234 files and directories currently installed.)\nPreparing to unpack .../${p}_${e.version}_amd64.deb ...\nUnpacking ${p} (${e.version}) ...\nSetting up ${p} (${e.version}) ...\n`);
        installPackage(sys, c.fs, p);
        if (sys.services.get(p)?.state === 'active') c.out(`Created symlink /etc/systemd/system/multi-user.target.wants/${p}.service → /usr/lib/systemd/system/${p}.service.\n`);
      }
      c.out('Processing triggers for man-db (2.12.0-4build2) ...\n');
      return 0;
    }
    case 'remove': case 'purge': case 'uninstall': {
      if (!pkgs.length) return 0;
      if (!root) return lockError(c, 'install');
      c.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n');
      const rm: string[] = [];
      for (const p of pkgs) {
        const e = sys.packages.get(p);
        if (!e) { c.err(`E: Unable to locate package ${p}\n`); return 100; }
        if (!e.installed) c.out(`Package '${p}' is not installed, so not removed\n`);
        else if (pkgDef(p)?.base) {
          c.out(`E: Removing essential system-critical packages is not permitted. ('${p}')\n`);
          return 100;
        } else rm.push(p);
      }
      if (!rm.length) { c.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      const size = rm.reduce((s, p) => s + sys.packages.get(p)!.sizeKb, 0);
      c.out(`The following packages will be REMOVED:\n  ${rm.join(' ')}\n0 upgraded, 0 newly installed, ${rm.length} to remove and 0 not upgraded.\nAfter this operation, ${kb(size)} disk space will be freed.\n`);
      if (!(await confirm(c, yes))) return 1;
      c.out('(Reading database ... 70234 files and directories currently installed.)\n');
      for (const p of rm) {
        c.out(`Removing ${p} (${sys.packages.get(p)!.version}) ...\n`);
        sys.packages.get(p)!.installed = false;
        removeBinaries(c.fs, p);
        pkgDef(p)?.onRemove?.(sys, c.fs);
        if (sub === 'purge') {
          try { c.fs.removeTree('/etc/' + p, null); } catch { /* sin config */ }
        }
      }
      return 0;
    }
    case 'autoremove': case 'clean': case 'autoclean': {
      if (!root) return lockError(c, 'install');
      c.out('Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n');
      return 0;
    }
    case 'search': {
      const term = pkgs.join(' ').toLowerCase();
      if (!term) return c.fail('You must give at least one search pattern', 100);
      if (c.io.tty) c.out('Sorting... Done\nFull Text Search... Done\n');
      let any = false;
      for (const p of [...sys.packages.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (p.name.includes(term) || p.description.toLowerCase().includes(term)) {
          any = true;
          c.out(`${c.io.tty ? color(C.boldGreen, p.name) : p.name}/noble${p.installed ? ',now' : ''} ${p.version} amd64${p.installed ? ' [installed]' : ''}\n  ${p.description}\n\n`);
        }
      }
      return any ? 0 : 0;
    }
    case 'show': case 'info': case 'policy': {
      let st = 0;
      for (const p of pkgs) {
        const e = sys.packages.get(p);
        if (!e) { c.err(`E: No packages found\nN: Unable to locate package ${p}\n`); st = 100; continue; }
        c.out(`Package: ${e.name}\nVersion: ${e.version}\nPriority: optional\nSection: universe/utils\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${e.sizeKb} kB\nDepends: libc6 (>= 2.34)\nDownload-Size: ${Math.floor(e.sizeKb / 3)} kB\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/universe amd64 Packages\nDescription: ${e.description}\n\n`);
      }
      return st;
    }
    case 'list': {
      if (c.io.tty) c.out('Listing... Done\n');
      if (o.has('U')) {
        if (sys.aptUpdated) for (const [n, v, old] of UPGRADABLE) c.out(`${n}/noble-updates ${v} amd64 [upgradable from: ${old}]\n`);
        return 0;
      }
      for (const p of [...sys.packages.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (o.has('I') && !p.installed) continue;
        if (o.has('U')) continue;
        if (pkgs.length && !pkgs.some((q) => p.name.includes(q))) continue;
        c.out(`${p.name}/noble ${p.version} amd64${p.installed ? ' [installed]' : ''}\n`);
      }
      return 0;
    }
    case 'download': case 'edit-sources': case 'moo':
      if (sub === 'moo') c.out('                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...\n');
      return 0;
    default:
      c.err(`E: Invalid operation ${sub}\n`);
      return 100;
  }
});

defineCommand('dpkg', {
  summary: 'Gestor de bajo nivel de paquetes .deb',
  usage: 'dpkg -l [PATRÓN] | -s PAQUETE | -L PAQUETE | -S ARCHIVO',
  category: 'paquetes',
  level: 3,
  options: [['-l', 'Lista paquetes'], ['-s P', 'Estado de un paquete'], ['-L P', 'Archivos que instala'], ['-S ruta', 'A qué paquete pertenece un archivo']],
  examples: [['dpkg -l | grep nginx', 'Está instalado?'], ['dpkg -L tree', 'Qué instala tree'], ['dpkg -S /bin/ls', 'coreutils: /bin/ls']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'lsLSPi', values: '' });
  const sys = c.sh.sys;
  if (o.has('l')) {
    const pat = o.rest[0];
    const rows = [['Name', 'Version', 'Architecture', 'Description']];
    for (const p of [...sys.packages.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!p.installed) continue;
      if (pat && !new RegExp('^' + pat.replace(/\*/g, '.*') + '$').test(p.name)) continue;
      rows.push([p.name, p.version, 'amd64', p.description.slice(0, 50)]);
    }
    if (pat && rows.length === 1) { c.err(`dpkg-query: no packages found matching ${pat}\n`); return 1; }
    c.out('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ ' + table(rows.map((r, i) => (i === 0 ? r : ['ii  ' + r[0], ...r.slice(1)]))).replace(/^/, '').replace(/^ii  /gm, 'ii  '));
    return 0;
  }
  if (o.has('s')) {
    for (const n of o.rest) {
      const e = sys.packages.get(n);
      if (!e || !e.installed) { c.err(`dpkg-query: package '${n}' is not installed and no information is available\n`); return 1; }
      c.out(`Package: ${n}\nStatus: install ok installed\nPriority: optional\nSection: utils\nInstalled-Size: ${e.sizeKb}\nArchitecture: amd64\nVersion: ${e.version}\nDescription: ${e.description}\n`);
    }
    return 0;
  }
  if (o.has('L')) {
    for (const n of o.rest) {
      const e = sys.packages.get(n);
      if (!e || !e.installed) { c.err(`dpkg-query: package '${n}' is not installed\n`); return 1; }
      c.out(`/.\n/usr\n/usr/bin\n/usr/bin/${n}\n/usr/share\n/usr/share/doc/${n}\n/usr/share/man/man1/${n}.1.gz\n`);
    }
    return 0;
  }
  if (o.has('S')) {
    const f = o.rest[0];
    if (!f) return c.fail('--search needs at least one file name pattern argument', 2);
    const base = f.split('/').pop()!;
    const byDef = REGISTRY.get(base)?.package ? sys.packages.get(REGISTRY.get(base)!.package!) : undefined;
    const byName = [...sys.packages.values()].find((p) => p.installed && p.name === base);
    const core = /^\/(usr\/)?s?bin\//.test(f) ? sys.packages.get('coreutils') : undefined;
    const hit = [byDef, byName].find((p) => p?.installed) ?? (core?.installed ? core : undefined);
    if (!hit) { c.err(`dpkg-query: no path found matching pattern ${f}\n`); return 1; }
    c.out(`${hit.name}: ${f}\n`);
    return 0;
  }
  c.err('dpkg: need an action option\n');
  return 2;
});

// ───────────────────────── systemctl / service ─────────────────────────

function svcName(n: string) {
  return n.replace(/\.service$/, '');
}

function statusText(c: Ctx, s: ServiceEntry, useColor: boolean): string {
  const sys = c.sh.sys;
  const now = sys.clock.now;
  const since = strftime('%a %Y-%m-%d %H:%M:%S UTC', s.since);
  const ago = (() => {
    const sec = Math.max(0, Math.floor((now - s.since) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}min ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)} days ago`;
  })();
  const dot = s.state === 'active' ? (useColor ? color(C.boldGreen, '●') : '●') : s.state === 'failed' ? (useColor ? color(C.boldRed, '●') : '●') : '○';
  let out = `${dot} ${s.name}.service - ${s.description}\n`;
  out += `     Loaded: loaded (/usr/lib/systemd/system/${s.name}.service; ${s.enabled ? 'enabled' : 'disabled'}; preset: enabled)\n`;
  if (s.state === 'active') {
    const act = useColor ? color(C.boldGreen, 'active (running)') : 'active (running)';
    out += `     Active: ${act} since ${since}; ${ago}\n`;
    out += `       Docs: man:${s.name}(8)\n`;
    if (s.pid) out += `   Main PID: ${s.pid} (${s.name === 'ssh' ? 'sshd' : s.name})\n`;
    out += `      Tasks: 3 (limit: 9300)\n     Memory: 3.4M (peak: 4.1M)\n        CPU: 18ms\n     CGroup: /system.slice/${s.name}.service\n`;
    const kids = [...sys.procs.values()].filter((p) => p.pid === s.pid || p.ppid === s.pid);
    kids.forEach((p, i) => (out += `             ${i === kids.length - 1 ? '└─' : '├─'}${p.pid} "${p.command}"\n`));
    const logs = serviceLogs(c, s).slice(-3);
    if (logs.length) out += '\n' + logs.join('\n') + '\n';
  } else if (s.state === 'failed') {
    out += `     Active: ${useColor ? color(C.boldRed, 'failed') : 'failed'} (Result: exit-code) since ${since}; ${ago}\n    Process: ${s.pid ?? 2400} ExecStart=/usr/sbin/${s.name} (code=exited, status=1/FAILURE)\n   Main PID: ${s.pid ?? 2400} (code=exited, status=1/FAILURE)\n        CPU: 9ms\n\n` + serviceLogs(c, s).slice(-3).join('\n') + '\n';
  } else {
    out += `     Active: inactive (dead)\n       Docs: man:${s.name}(8)\n`;
  }
  return out;
}

function serviceLogs(c: Ctx, s: ServiceEntry): string[] {
  const t = (ms: number) => strftime('%b %d %H:%M:%S', ms).replace(/ 0(\d)/, '  $1');
  const host = c.sh.sys.hostname;
  const lines: string[] = [];
  if (s.state === 'failed') {
    lines.push(`${t(s.since)} ${host} systemd[1]: Starting ${s.name}.service - ${s.description}...`);
    lines.push(`${t(s.since)} ${host} ${s.name}[${s.pid ?? 2400}]: bind() to 0.0.0.0:${s.port ?? 80} failed (98: Address already in use)`);
    lines.push(`${t(s.since)} ${host} systemd[1]: ${s.name}.service: Failed with result 'exit-code'.`);
    lines.push(`${t(s.since)} ${host} systemd[1]: Failed to start ${s.name}.service - ${s.description}.`);
    return lines;
  }
  lines.push(`${t(s.since)} ${host} systemd[1]: Starting ${s.name}.service - ${s.description}...`);
  lines.push(`${t(s.since)} ${host} systemd[1]: Started ${s.name}.service - ${s.description}.`);
  return lines;
}

function startService(c: Ctx, s: ServiceEntry): boolean {
  const sys = c.sh.sys;
  if (s.state === 'active') return true;
  if (s.port) {
    const conflict = [...sys.services.values()].find((o) => o !== s && o.state === 'active' && o.port === s.port);
    if (conflict) {
      s.state = 'failed';
      s.since = sys.clock.now;
      return false;
    }
  }
  s.state = 'active';
  s.since = sys.clock.now;
  // procesos
  if (!s.pid || !sys.procs.has(s.pid)) {
    const main = sys.spawn(s.name === 'ssh' ? 'root' : 'root', s.name === 'ssh' ? 'sshd: /usr/sbin/sshd -D [listener]' : `/usr/sbin/${s.name}`, { ppid: 1 });
    s.pid = main.pid;
    if (s.name === 'nginx') {
      main.command = 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;';
      sys.spawn('www-data', 'nginx: worker process', { ppid: main.pid });
      sys.spawn('www-data', 'nginx: worker process', { ppid: main.pid });
    } else if (s.name === 'apache2') {
      main.command = '/usr/sbin/apache2 -k start';
      sys.spawn('www-data', '/usr/sbin/apache2 -k start', { ppid: main.pid });
    }
  }
  return true;
}

function stopService(c: Ctx, s: ServiceEntry) {
  const sys = c.sh.sys;
  s.state = 'inactive';
  for (const p of [...sys.procs.values()]) if (p.pid === s.pid || p.ppid === s.pid) sys.killProc(p.pid);
  s.pid = undefined;
}

function resolveService(c: Ctx, name: string): ServiceEntry | null {
  return c.sh.sys.services.get(svcName(name)) ?? null;
}

defineCommand('systemctl', {
  summary: 'Controla el sistema y los servicios (systemd)',
  usage: 'systemctl start|stop|restart|reload|status|enable|disable|is-active|is-enabled SERVICIO',
  category: 'paquetes',
  level: 3,
  options: [['status S', 'Estado detallado'], ['start/stop/restart S', 'Arranca/para/reinicia (requiere sudo)'], ['enable/disable S', 'Arranque automático al iniciar'], ['enable --now S', 'Activa y arranca a la vez'], ['is-active S', 'Imprime active/inactive'], ['list-units --type=service', 'Servicios cargados'], ['daemon-reload', 'Recarga la configuración de systemd']],
  examples: [['systemctl status ssh', 'Estado del servicio SSH'], ['sudo systemctl restart nginx', 'Reinicia nginx'], ['sudo systemctl enable --now cron', 'Habilita y arranca'], ['systemctl list-units --type=service --state=running', 'Qué corre ahora']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'lqf', values: 't', long: { '--now': 'N', '--no-pager': 'P', '--no-legend': 'L', '--full': 'f', '--user': 'u', '--all': 'a', '--failed': 'F', '--type': 't', '--state': 'S', '--quiet': 'q' }, lenient: true });
  const args = c.args.filter((a) => !a.startsWith('-'));
  const sub = args[0];
  const names = args.slice(1);
  const sys = c.sh.sys;
  const useColor = c.tty;
  const root = c.cred.name === 'root';
  if (!sub) {
    return c.sh.dispatch(['systemctl', 'list-units', ...(o.has('F') ? ['--failed'] : ['--type=service'])], c.io);
  }
  const mutating = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask', 'daemon-reload', 'try-restart', 'reload-or-restart', 'kill'];
  if (mutating.includes(sub) && !root) {
    if (sub === 'daemon-reload') c.err('Failed to reload daemon: Interactive authentication required.\n');
    else c.err(`Failed to ${sub} ${names[0] ? svcName(names[0]) + '.service' : ''}: Interactive authentication required.\nSee system logs and 'systemctl status ${names[0] ? svcName(names[0]) + '.service' : ''}' for details.\n`);
    return 1;
  }
  switch (sub) {
    case 'list-units': case 'list-unit-files': case 'list-services': {
      const list = [...sys.services.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
      if (sub === 'list-unit-files') {
        const rows = [['UNIT FILE', 'STATE', 'PRESET'], ...list.map((s) => [`${s.name}.service`, s.enabled ? 'enabled' : 'disabled', 'enabled'])];
        c.out(table(rows) + `\n${list.length} unit files listed.\n`);
        return 0;
      }
      const stateFilter = c.args.find((a) => a.startsWith('--state='))?.split('=')[1];
      const sel = list.filter((s) => (o.has('F') ? s.state === 'failed' : true) && (!stateFilter || (stateFilter === 'running' ? s.state === 'active' : s.state === stateFilter)) && (o.has('a') || s.state !== 'inactive' || stateFilter === 'inactive'));
      const rows = [['UNIT', 'LOAD', 'ACTIVE', 'SUB', 'DESCRIPTION'], ...sel.map((s) => [`${s.state === 'failed' ? '●' : ' '} ${s.name}.service`, 'loaded', s.state, s.state === 'active' ? 'running' : s.state === 'failed' ? 'failed' : 'dead', s.description])];
      c.out(table(rows) + `\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n\n${sel.length} loaded units listed.\n`);
      return 0;
    }
    case 'daemon-reload': return 0;
    case 'is-system-running': c.out('running\n'); return 0;
    case 'get-default': c.out('multi-user.target\n'); return 0;
    case 'list-timers': c.out('NEXT                        LEFT       LAST                        PASSED  UNIT                         ACTIVATES\nSat 2026-03-14 12:00:00 UTC 1h 59min   Sat 2026-03-14 06:15:01 UTC 3h ago  apt-daily.timer              apt-daily.service\n\n1 timers listed.\n'); return 0;
  }
  if (!names.length) {
    c.err('Too few arguments.\n');
    return 1;
  }
  let st = 0;
  for (const nm of names) {
    const s = resolveService(c, nm);
    if (!s) {
      if (sub === 'is-active') { c.out('inactive\n'); st = 3; continue; }
      if (sub === 'is-enabled') { c.err('Failed to get unit file state for ' + svcName(nm) + '.service: No such file or directory\n'); st = 1; continue; }
      c.err(sub === 'status' ? `Unit ${svcName(nm)}.service could not be found.\n` : `Failed to ${sub} ${svcName(nm)}.service: Unit ${svcName(nm)}.service not found.\n`);
      st = sub === 'status' ? 4 : 5;
      continue;
    }
    switch (sub) {
      case 'status': {
        c.out(statusText(c, s, useColor));
        if (s.state !== 'active') st = s.state === 'failed' ? 3 : 3;
        break;
      }
      case 'start': case 'try-restart':
        if (!startService(c, s)) {
          c.err(`Job for ${s.name}.service failed because the control process exited with error code.\nSee "systemctl status ${s.name}.service" and "journalctl -xeu ${s.name}.service" for details.\n`);
          st = 1;
        }
        break;
      case 'stop': stopService(c, s); break;
      case 'restart': case 'reload-or-restart': case 'reload':
        if (sub !== 'reload') stopService(c, s);
        if (!startService(c, s)) {
          c.err(`Job for ${s.name}.service failed because the control process exited with error code.\nSee "systemctl status ${s.name}.service" and "journalctl -xeu ${s.name}.service" for details.\n`);
          st = 1;
        }
        break;
      case 'enable':
        if (!s.enabled) c.err(`Created symlink /etc/systemd/system/multi-user.target.wants/${s.name}.service → /usr/lib/systemd/system/${s.name}.service.\n`);
        s.enabled = true;
        if (o.has('N') && !startService(c, s)) st = 1;
        break;
      case 'disable':
        if (s.enabled) c.err(`Removed "/etc/systemd/system/multi-user.target.wants/${s.name}.service".\n`);
        s.enabled = false;
        if (o.has('N')) stopService(c, s);
        break;
      case 'is-active': c.out(s.state + '\n'); if (s.state !== 'active') st = 3; break;
      case 'is-enabled': c.out((s.enabled ? 'enabled' : 'disabled') + '\n'); if (!s.enabled) st = 1; break;
      case 'is-failed': c.out(s.state === 'failed' ? 'failed\n' : 'active\n'); if (s.state !== 'failed') st = 1; break;
      case 'mask': s.enabled = false; stopService(c, s); c.err(`Created symlink /etc/systemd/system/${s.name}.service → /dev/null.\n`); break;
      case 'unmask': c.err(`Removed "/etc/systemd/system/${s.name}.service".\n`); break;
      case 'show': c.out(`Id=${s.name}.service\nActiveState=${s.state}\nSubState=${s.state === 'active' ? 'running' : 'dead'}\nMainPID=${s.pid ?? 0}\nUnitFileState=${s.enabled ? 'enabled' : 'disabled'}\n`); break;
      case 'cat': c.out(`# /usr/lib/systemd/system/${s.name}.service\n[Unit]\nDescription=${s.description}\nAfter=network.target\n\n[Service]\nExecStart=/usr/sbin/${s.name}\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n`); break;
      default:
        c.err(`Unknown command verb ${sub}.\n`);
        return 1;
    }
  }
  return st;
});

defineCommand('service', {
  summary: 'Gestiona servicios (interfaz clásica)',
  usage: 'service NOMBRE start|stop|restart|status',
  category: 'paquetes',
  level: 3,
  examples: [['sudo service nginx restart', 'Reinicia nginx'], ['service ssh status', 'Estado de SSH']],
}, (c) => {
  if (c.args[0] === '--status-all') {
    for (const s of [...c.sh.sys.services.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) c.out(` [ ${s.state === 'active' ? '+' : '-'} ]  ${s.name}\n`);
    return 0;
  }
  const [name, action] = c.args;
  if (!name || !action) return c.fail('usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]', 1);
  if (!c.sh.sys.services.has(svcName(name))) { c.err(`${name}: unrecognized service\n`); return 4; }
  return c.sh.dispatch(['systemctl', action, name], c.io);
});

defineCommand('journalctl', {
  summary: 'Consulta los registros (logs) de systemd',
  usage: 'journalctl [-u UNIDAD] [-n N] [-f] [-p NIVEL] [--since TIEMPO]',
  category: 'paquetes',
  level: 3,
  options: [['-u UNIDAD', 'Registros de un servicio'], ['-n N', 'Últimas N líneas'], ['-f', 'Sigue en vivo (Ctrl+C)'], ['-p err', 'Solo errores o peores'], ['--since "1 hour ago"', 'Desde una hora'], ['-b', 'Desde el último arranque'], ['-r', 'Más recientes primero']],
  examples: [['journalctl -u ssh -n 20', 'Últimas 20 líneas de SSH'], ['sudo journalctl -p err -b', 'Errores del arranque actual'], ['journalctl -f', 'Logs en vivo']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'fbrxeklq', values: 'unpSU', long: { '--unit': 'u', '--lines': 'n', '--follow': 'f', '--priority': 'p', '--since': 'S', '--until': 'U', '--no-pager': 'q', '--reverse': 'r' }, lenient: true });
  const sys = c.sh.sys;
  if (c.cred.name !== 'root' && !c.cred.groups.includes('adm') && !c.cred.groups.includes('systemd-journal')) {
    c.out('Hint: You are currently not seeing messages from other users and the system.\n      Users in groups \'adm\', \'systemd-journal\' can see all messages.\n      Pass -q to turn off this notice.\n');
  }
  let lines: string[] = [];
  const unit = o.val('u');
  if (unit) {
    const s = sys.services.get(svcName(unit));
    if (!s) {
      c.out('-- No entries --\n');
      return 1;
    }
    lines = serviceLogs(c, s);
    if (s.name === 'ssh') {
      try {
        lines.push(...splitLines(c.fs.readFile('/var/log/auth.log', null)).filter((l) => l.includes('sshd')).slice(-6).map((l) => l.replace(/^(\S+ +\d+ \S+) (\S+) (.*)$/, '$1 $2 $3')));
      } catch { /* sin log */ }
    }
  } else {
    try {
      lines = splitLines(c.fs.readFile('/var/log/syslog', null));
    } catch { /* sin log */ }
    for (const s of sys.services.values()) if (s.state !== 'inactive') lines.push(...serviceLogs(c, s));
    lines.sort();
  }
  if (o.val('p')) {
    const lv = o.val('p')!;
    if (lv === 'err' || lv === '3') lines = lines.filter((l) => /fail|error|denied|BLOCK|refused/i.test(l));
    else if (lv === 'warning' || lv === '4') lines = lines.filter((l) => /fail|error|warn|denied|BLOCK/i.test(l));
  }
  const n = o.val('n') ? parseInt(o.val('n')!, 10) : o.has('f') ? 10 : Infinity;
  if (Number.isFinite(n)) lines = lines.slice(-n);
  if (o.has('r')) lines.reverse();
  if (!lines.length) {
    c.out('-- No entries --\n');
    return 0;
  }
  c.out(`-- Logs begin at ${strftime('%a %Y-%m-%d %H:%M:%S UTC', sys.bootTime)}. --\n`.replace('-- Logs begin at', '-- Journal begins at') + lines.join('\n') + '\n');
  if (o.has('f') && c.io.tty && !c.sh.bg) {
    for (;;) await c.sh.sleep(1000);
  }
  return 0;
});

// ───────────────────────── crontab ─────────────────────────

const CRON_TEMPLATE = `# Edit this file to introduce tasks to be run by cron.
#
# Each task to run has to be defined through a single line
# indicating with different fields when the task will be run
# and what command to run for the task
#
# To define the time you can provide concrete values for
# minute (m), hour (h), day of month (dom), month (mon),
# and day of week (dow) or use '*' in these fields (for 'any').
#
# m h  dom mon dow   command
`;

defineCommand('crontab', {
  summary: 'Gestiona tareas programadas (cron) de un usuario',
  usage: 'crontab [-l | -e | -r] [-u USUARIO] [ARCHIVO]',
  category: 'procesos',
  level: 3,
  options: [['-l', 'Lista las tareas'], ['-e', 'Edita las tareas'], ['-r', 'Borra todas las tareas'], ['-u USER', 'De otro usuario (root)'], ['ARCHIVO', 'Instala las tareas desde un archivo']],
  examples: [['crontab -l', 'Ver tareas programadas'], ['crontab -e', 'Editar (formato: m h dom mon dow comando)'], ['*/5 * * * * /home/alumno/backup.sh', 'Cada 5 minutos'], ['0 3 * * 1 apt update', 'Lunes a las 3:00']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'ler', values: 'u' });
  const user = o.val('u') ?? c.sh.user;
  if (o.val('u') && c.cred.name !== 'root' && o.val('u') !== c.sh.user) {
    c.err(`must be privileged to use -u\n`);
    return 1;
  }
  const sys = c.sh.sys;
  if (o.has('l')) {
    const t = sys.crontabs.get(user);
    if (t === undefined) {
      c.err(`no crontab for ${user}\n`);
      return 1;
    }
    c.out(t);
    return 0;
  }
  if (o.has('r')) {
    if (!sys.crontabs.delete(user)) {
      c.err(`no crontab for ${user}\n`);
      return 1;
    }
    return 0;
  }
  if (o.has('e')) {
    const editor = c.sh.rt.editor;
    const cur = sys.crontabs.get(user) ?? CRON_TEMPLATE;
    if (!editor) {
      c.err('crontab: el editor interactivo no está disponible aquí; usa: crontab archivo\n');
      return 1;
    }
    c.err(sys.crontabs.has(user) ? '' : `no crontab for ${user} - using an empty one\n`);
    const res = await editor(`/tmp/crontab.${user}`, cur, 'nano');
    if (res === null) return 0;
    sys.crontabs.set(user, res.endsWith('\n') ? res : res + '\n');
    c.err('crontab: installing new crontab\n');
    return validateCron(c, res) ? 0 : 1;
  }
  const f = o.rest[0];
  let text: string;
  if (!f || f === '-') text = await c.stdin.readAll();
  else {
    try {
      text = c.fs.readFile(c.abs(f), c.cred);
    } catch (e) {
      c.err(`${f}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  if (!validateCron(c, text)) return 1;
  sys.crontabs.set(user, text);
  return 0;
});

function validateCron(c: Ctx, text: string): boolean {
  let ok = true;
  splitLines(text).forEach((l, i) => {
    const t = l.trim();
    if (!t || t.startsWith('#') || /^[A-Z_]+=/.test(t)) return;
    const f = t.split(/\s+/);
    if (/^@(reboot|hourly|daily|weekly|monthly|yearly|annually|midnight)$/.test(f[0]) && f.length >= 2) return;
    if (f.length < 6 || !f.slice(0, 5).every((x) => /^(\*|\d+|\*\/\d+|\d+-\d+(\/\d+)?|\d+(,\d+)+|[a-zA-Z]{3})$/.test(x))) {
      c.err(`"crontab":${i + 1}: bad minute\nerrors in crontab file, can't install.\n`);
      ok = false;
    }
  });
  return ok;
}

export { SignalEx, isoFull, MONTHS, pad2 };
