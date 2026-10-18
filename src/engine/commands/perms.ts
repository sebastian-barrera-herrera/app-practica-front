/** Permisos, propietarios, sudo/su y gestión de usuarios y grupos. */
import { modeString, table } from '../format';
import { basename } from '../path';
import { REGISTRY, defineCommand, parseOpts, type Ctx } from '../registry';
import { FsError, type FsNode } from '../vfs';
import { syncEtc, applyFiles } from '../world';
import { applyMode } from './util';

// ───────────────────────── chmod ─────────────────────────

function walkTargets(c: Ctx, path: string, recursive: boolean, fn: (p: string, n: FsNode) => void) {
  const l = c.fs.lstat(path, c.cred);
  if (!l) throw new FsError('ENOENT', path);
  if (recursive) {
    c.fs.walkTree(path, (p, n) => {
      if (n.kind !== 'symlink') fn(p, n);
    }, c.cred);
  } else fn(path, c.fs.stat(path, c.cred) ?? l);
}

defineCommand('chmod', {
  summary: 'Cambia los permisos de archivos y directorios',
  usage: 'chmod [-R] MODO ARCHIVO...',
  category: 'permisos',
  level: 2,
  options: [['-R', 'Recursivo'], ['-v', 'Explica cada cambio'], ['u+x', 'Da permiso de ejecución al dueño'], ['go-w', 'Quita escritura a grupo y otros'], ['755', 'Octal: rwxr-xr-x'], ['644', 'Octal: rw-r--r--'], ['a=r', 'Todos solo lectura']],
  examples: [['chmod +x script.sh', 'Hazlo ejecutable'], ['chmod 600 clave.pem', 'Solo el dueño lee/escribe'], ['chmod -R go-rwx privado/', 'Cierra un directorio entero'], ['chmod u=rwx,g=rx,o= archivo', 'Notación simbólica completa']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'RvcfH', values: '', lenient: true, long: { '--recursive': 'R', '--verbose': 'v' } });
  // el modo puede empezar con '-' (ej. -w): se trata como operando
  const rest = o.rest;
  const refIdx = c.args.findIndex((a) => a.startsWith('--reference='));
  let modeSpec: string | undefined;
  let files: string[];
  let refMode: number | undefined;
  if (refIdx >= 0) {
    const ref = c.fs.stat(c.abs(c.args[refIdx].split('=')[1]), c.cred);
    if (!ref) return c.fail(`failed to get attributes of '${c.args[refIdx].split('=')[1]}': No such file or directory`);
    refMode = ref.mode & 0o7777;
    files = rest.filter((a) => !a.startsWith('--reference='));
  } else {
    modeSpec = rest[0];
    files = rest.slice(1);
  }
  if (modeSpec === undefined && refMode === undefined) return c.fail("missing operand\nTry 'chmod --help' for more information.");
  if (!files.length) return c.fail(`missing operand after ‘${modeSpec}’\nTry 'chmod --help' for more information.`);
  let st = 0;
  for (const f of files) {
    const abs = c.abs(f);
    try {
      walkTargets(c, abs, o.has('R'), (p, n) => {
        const newMode = refMode ?? applyMode(modeSpec!, n.mode & 0o7777, n.kind === 'dir', c.sh.umask);
        if (newMode === null) throw new Error('INVALID_MODE');
        if (c.cred.name !== 'root' && c.cred.name !== n.uid) throw new FsError('EPERM', p);
        const old = n.mode & 0o7777;
        n.mode = (n.mode & ~0o7777) | (newMode & 0o7777);
        if (o.has('v')) {
          const shown = o.has('R') ? f + p.slice(abs.length) : f;
          if (old === (newMode & 0o7777)) c.out(`mode of '${shown}' retained as ${old.toString(8).padStart(4, '0')} (${modeString(n.kind, old).slice(1)})\n`);
          else c.out(`mode of '${shown}' changed from ${old.toString(8).padStart(4, '0')} (${modeString(n.kind, old).slice(1)}) to ${(newMode & 0o7777).toString(8).padStart(4, '0')} (${modeString(n.kind, newMode).slice(1)})\n`);
        }
      });
    } catch (e) {
      if ((e as Error).message === 'INVALID_MODE') return c.fail(`invalid mode: ‘${modeSpec}’\nTry 'chmod --help' for more information.`);
      if (e instanceof FsError && e.code === 'ENOENT') c.err(`chmod: cannot access '${f}': No such file or directory\n`);
      else c.err(`chmod: changing permissions of '${f}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

// ───────────────────────── chown / chgrp ─────────────────────────

function parseOwner(c: Ctx, spec: string): { user: string | null; group: string | null } | string {
  const m = /^([^:.]*)(?:[:.](.*))?$/.exec(spec);
  if (!m) return `invalid spec: ‘${spec}’`;
  let user: string | null = null;
  let group: string | null = null;
  if (m[1]) {
    if (c.sh.sys.user(m[1])) user = m[1];
    else if (/^\d+$/.test(m[1]) && c.sh.sys.userByUid(parseInt(m[1], 10))) user = c.sh.sys.userByUid(parseInt(m[1], 10))!.name;
    else return `invalid user: ‘${spec}’`;
  }
  if (m[2]) {
    if (c.sh.sys.groups.has(m[2])) group = m[2];
    else return `invalid group: ‘${spec}’`;
  } else if (spec.includes(':') && m[1]) {
    group = c.sh.sys.groupsOf(m[1])[0] ?? m[1];
  }
  return { user, group };
}

defineCommand('chown', {
  summary: 'Cambia el propietario y/o el grupo de un archivo',
  usage: 'chown [-R] [USUARIO][:GRUPO] ARCHIVO...',
  category: 'permisos',
  level: 3,
  options: [['-R', 'Recursivo'], ['-v', 'Explica los cambios']],
  examples: [['sudo chown ana archivo', 'Nuevo dueño: ana'], ['sudo chown ana:developers proyecto/', 'Dueño y grupo'], ['sudo chown -R www-data: /var/www', 'Recursivo (y grupo por defecto del usuario)']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'RvcfhH', long: { '--recursive': 'R', '--verbose': 'v' } });
  if (o.rest.length < 2) return c.fail(o.rest.length ? `missing operand after ‘${o.rest[0]}’\nTry 'chown --help' for more information.` : "missing operand\nTry 'chown --help' for more information.");
  const spec = parseOwner(c, o.rest[0]);
  if (typeof spec === 'string') return c.fail(spec);
  let st = 0;
  for (const f of o.rest.slice(1)) {
    try {
      walkTargets(c, c.abs(f), o.has('R'), (p, n) => {
        if (c.cred.name !== 'root') throw new FsError('EPERM', p);
        if (spec.user) n.uid = spec.user;
        if (spec.group) n.gid = spec.group;
        if (o.has('v')) c.out(`changed ownership of '${f}' to ${spec.user ?? n.uid}:${spec.group ?? n.gid}\n`);
      });
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT') c.err(`chown: cannot access '${f}': No such file or directory\n`);
      else c.err(`chown: changing ownership of '${f}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

defineCommand('chgrp', {
  summary: 'Cambia el grupo de un archivo',
  usage: 'chgrp [-R] GRUPO ARCHIVO...',
  category: 'permisos',
  level: 3,
  examples: [['sudo chgrp developers proyecto/', 'Asigna el grupo developers']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'RvcfhH', long: { '--recursive': 'R' } });
  if (o.rest.length < 2) return c.fail("missing operand\nTry 'chgrp --help' for more information.");
  const g = o.rest[0];
  if (!c.sh.sys.groups.has(g)) return c.fail(`invalid group: ‘${g}’`);
  let st = 0;
  for (const f of o.rest.slice(1)) {
    try {
      walkTargets(c, c.abs(f), o.has('R'), (p, n) => {
        if (c.cred.name !== 'root' && !(c.cred.name === n.uid && c.cred.groups.includes(g))) throw new FsError('EPERM', p);
        n.gid = g;
      });
    } catch (e) {
      if (e instanceof FsError && e.code === 'ENOENT') c.err(`chgrp: cannot access '${f}': No such file or directory\n`);
      else c.err(`chgrp: changing group of '${f}': ${(e as Error).message}\n`);
      st = 1;
    }
  }
  return st;
});

// ───────────────────────── sudo / su ─────────────────────────

defineCommand('sudo', {
  summary: 'Ejecuta un comando como otro usuario (normalmente root)',
  usage: 'sudo [-u USUARIO] [-i|-s] COMANDO [ARGS]',
  category: 'permisos',
  noHelp: true,
  level: 1,
  options: [['-u USER', 'Ejecutar como otro usuario'], ['-i', 'Shell de login como root'], ['-s', 'Shell como root'], ['-l', 'Lista lo que puedes ejecutar'], ['-k', 'Olvida las credenciales'], ['-E', 'Conserva el entorno']],
  examples: [['sudo apt update', 'Actualiza índices con privilegios'], ['sudo !!', 'Repite el último comando con sudo'], ['sudo -u ana ls /home/ana', 'Como otro usuario'], ['sudo -i', 'Pasa a ser root']],
}, async (c) => {
  if (c.args[0] === '--help') {
    c.out('Uso: sudo [-u USUARIO] [-i|-s] COMANDO\nEjecuta un comando como root (o como otro usuario).\n');
    return 0;
  }
  const o = parseOpts(c, c.args, { flags: 'ilsvkKEHnSbA', values: 'ugCpr', stopAtOperand: true, long: { '--user': 'u', '--login': 'i', '--list': 'l', '--shell': 's' } });
  const sys = c.sh.sys;
  const me = c.sh.user;
  if (!sys.isSudoer(me)) {
    c.err(`${me} is not in the sudoers file.\n`);
    return 1;
  }
  if (o.has('k') || o.has('K')) return 0;
  if (o.has('v')) return 0;
  if (o.has('l')) {
    c.out(`Matching Defaults entries for ${me} on ${sys.hostname}:\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\n\nUser ${me} may run the following commands on ${sys.hostname}:\n    (ALL : ALL) ALL\n`);
    return 0;
  }
  const target = o.val('u') ?? 'root';
  if (!sys.user(target)) {
    c.err(`sudo: unknown user ${target}\nsudo: error initializing audit plugin sudoers_audit\n`);
    return 1;
  }
  if (o.has('i') || o.has('s')) {
    if (o.rest.length === 0 || o.has('i')) {
      if (o.rest.length) {
        const sub = c.sh.clone();
        sub.setUser(target);
        sub.cwd = sys.user(target)!.home;
        return sub.runLine(o.rest.join(' '), c.io);
      }
      // sesión interactiva: cambia el usuario del shell actual
      c.sh.userStack.push(c.sh.user);
      c.sh.savedCwd.push(c.sh.cwd);
      c.sh.setUser(target);
      if (o.has('i')) c.sh.cwd = sys.user(target)!.home;
      c.sh.setVar('PWD', c.sh.cwd, true);
      return 0;
    }
  }
  if (!o.rest.length) {
    c.err('usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\n');
    return 1;
  }
  const sub = c.sh.clone();
  const prevHome = c.sh.home();
  sub.setUser(target);
  if (!o.has('E')) sub.setVar('HOME', sys.user(target)?.home ?? prevHome, true);
  sub.setVar('SUDO_USER', me, true);
  sub.setVar('SUDO_UID', String(sys.user(me)!.uid), true);
  sub.cwd = c.sh.cwd;
  const r = o.rest;
  // sudo con un comando que no existe
  const first = r[0];
  const resolved = sub.resolveCommand(first);
  if (resolved.kind === 'none' && !first.includes('/')) {
    c.err(`sudo: ${first}: command not found\n`);
    return 1;
  }
  return sub.runArgv(r, c.io);
});

defineCommand('su', {
  summary: 'Cambia de usuario',
  usage: 'su [-] [USUARIO]',
  category: 'permisos',
  level: 2,
  options: [['-', 'Shell de login (cambia al HOME del usuario)'], ['-c CMD', 'Ejecuta un comando']],
  examples: [['su - ana', 'Entra como ana (con su entorno)'], ['su -', 'Entra como root'], ['exit', 'Vuelve al usuario anterior']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'lmpsx', values: 'cs', long: { '--login': 'l', '--command': 'c' } });
  const login = c.args.includes('-') || o.has('l');
  const rest = o.rest.filter((a) => a !== '-');
  const target = rest[0] ?? 'root';
  const u = c.sh.sys.user(target);
  if (!u) {
    c.err(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`);
    return 1;
  }
  if (u.shell.includes('nologin') && c.sh.user !== 'root') {
    c.err('This account is currently not available.\n');
    return 1;
  }
  if (o.val('c')) {
    const sub = c.sh.clone();
    sub.setUser(target);
    if (login) sub.cwd = u.home;
    return sub.runLine(o.val('c')!, c.io);
  }
  c.sh.userStack.push(c.sh.user);
  c.sh.savedCwd.push(c.sh.cwd);
  c.sh.setUser(target);
  if (login) c.sh.cwd = u.home;
  c.sh.setVar('PWD', c.sh.cwd, true);
  return 0;
});

// ───────────────────────── usuarios y grupos ─────────────────────────

const needRoot = (c: Ctx, what: string): boolean => {
  if (c.cred.name === 'root') return false;
  c.err(`${what}: Permission denied.\n${what}: cannot lock /etc/passwd; try again later.\n`);
  return true;
};

defineCommand('useradd', {
  summary: 'Crea un usuario nuevo',
  usage: 'useradd [-m] [-s SHELL] [-G GRUPOS] [-c COMENTARIO] USUARIO',
  category: 'usuarios',
  sbin: true,
  level: 3,
  options: [['-m', 'Crea el directorio personal'], ['-s SHELL', 'Shell de login'], ['-G g1,g2', 'Grupos adicionales'], ['-g GRUPO', 'Grupo principal'], ['-u UID', 'UID concreto'], ['-d DIR', 'Directorio personal'], ['-c TEXTO', 'Nombre completo']],
  examples: [['sudo useradd -m -s /bin/bash -G sudo carla', 'Usuario con home, bash y sudo']],
}, (c) => {
  if (needRoot(c, 'useradd')) return 1;
  const o = parseOpts(c, c.args, { flags: 'mMrUN', values: 'sGgucdp' });
  const name = o.rest[0];
  if (!name) return c.fail('usage: useradd [options] LOGIN', 2);
  if (!/^[a-z_][a-z0-9_-]*$/.test(name)) return c.fail(`invalid user name '${name}'`, 3);
  const sys = c.sh.sys;
  if (sys.users.has(name)) return c.fail(`user '${name}' already exists`, 9);
  const uid = o.val('u') ? parseInt(o.val('u')!, 10) : undefined;
  let gid: number | undefined;
  if (o.val('g')) {
    const g = sys.groups.get(o.val('g')!);
    if (!g) return c.fail(`group '${o.val('g')}' does not exist`, 6);
    gid = g.gid;
  }
  const home = o.val('d') ?? '/home/' + name;
  const u = sys.addUser(name, { uid, gid, gecos: o.val('c') ?? '', home, shell: o.val('s') ?? '/bin/sh' });
  for (const g of (o.val('G') ?? '').split(',').filter(Boolean)) {
    if (!sys.groups.has(g)) {
      c.err(`useradd: group '${g}' does not exist\n`);
      sys.users.delete(name);
      return 6;
    }
    sys.groups.get(g)!.members.add(name);
  }
  if (o.has('m')) {
    c.fs.mkdirp(home, 0o755, null);
    const h = c.fs.stat(home)!;
    h.uid = name;
    h.gid = sys.groupsOf(name)[0];
    h.mode = 0o755;
    for (const f of ['.bashrc', '.profile', '.bash_logout']) {
      const n = c.fs.writeFile(`${home}/${f}`, c.fs.stat(`/home/alumno/${f}`)?.content ?? '', { cred: null, mode: 0o644 });
      n.uid = name;
      n.gid = h.gid;
    }
  }
  void u;
  syncEtc(sys, c.fs);
  return 0;
});

defineCommand('adduser', {
  summary: 'Crea un usuario de forma amistosa (Debian/Ubuntu)',
  usage: 'adduser USUARIO',
  category: 'usuarios',
  sbin: true,
  level: 3,
  examples: [['sudo adduser carla', 'Crea usuario con home y bash']],
}, (c) => {
  if (c.cred.name !== 'root') return c.fail('Only root may add a user or group to the system.', 1);
  const name = c.args.filter((a) => !a.startsWith('-'))[0];
  if (!name) return c.fail('Only one or two names allowed.', 1);
  if (c.sh.sys.users.has(name)) return c.fail(`The user ‘${name}’ already exists.`, 1);
  const sys = c.sh.sys;
  sys.addUser(name, { shell: '/bin/bash', gecos: ',,,' });
  const home = '/home/' + name;
  c.fs.mkdirp(home, 0o750, null);
  const h = c.fs.stat(home)!;
  h.uid = name;
  h.gid = name;
  h.mode = 0o750;
  sys.groups.get('users')?.members.add(name);
  syncEtc(sys, c.fs);
  c.out(`info: Adding user \`${name}' ...\ninfo: Selecting UID/GID from range 1000 to 59999 ...\ninfo: Adding new group \`${name}' (${sys.groups.get(name)!.gid}) ...\ninfo: Adding new user \`${name}' (${sys.users.get(name)!.uid}) with group \`${name}' ...\ninfo: Creating home directory \`${home}' ...\ninfo: Copying files from \`/etc/skel' ...\n`);
});

defineCommand('userdel', {
  summary: 'Elimina un usuario',
  usage: 'userdel [-r] USUARIO',
  category: 'usuarios',
  sbin: true,
  level: 3,
  options: [['-r', 'Borra también su directorio personal']],
}, (c) => {
  if (needRoot(c, 'userdel')) return 1;
  const o = parseOpts(c, c.args, { flags: 'rf' });
  const name = o.rest[0];
  const sys = c.sh.sys;
  const u = sys.users.get(name);
  if (!name || !u) return c.fail(`user '${name}' does not exist`, 6);
  if ([...sys.procs.values()].some((p) => p.user === name && p.command !== '-bash' && !p.command.startsWith('['))) {
    /* en Linux real falla si hay procesos del usuario; aquí avisamos pero seguimos */
  }
  if (o.has('r')) {
    try {
      c.fs.removeTree(u.home, null);
    } catch {
      /* sin home */
    }
  }
  sys.users.delete(name);
  for (const g of sys.groups.values()) g.members.delete(name);
  if (sys.groups.get(name) && sys.groups.get(name)!.members.size === 0 && sys.groups.get(name)!.gid >= 1000) sys.groups.delete(name);
  syncEtc(sys, c.fs);
});

defineCommand('usermod', {
  summary: 'Modifica un usuario existente',
  usage: 'usermod [-aG GRUPOS] [-s SHELL] [-l NUEVO] [-L|-U] USUARIO',
  category: 'usuarios',
  sbin: true,
  level: 3,
  options: [['-aG g1,g2', 'Añade a grupos (sin -a los reemplaza)'], ['-s SHELL', 'Cambia la shell'], ['-l NUEVO', 'Renombra el usuario'], ['-L / -U', 'Bloquea / desbloquea la cuenta']],
  examples: [['sudo usermod -aG sudo carla', 'Dale permisos de sudo'], ['sudo usermod -s /bin/zsh carla', 'Cambia su shell']],
}, (c) => {
  if (needRoot(c, 'usermod')) return 1;
  const o = parseOpts(c, c.args, { flags: 'aLUm', values: 'GsldcuPg' });
  const name = o.rest[0];
  const sys = c.sh.sys;
  const u = sys.users.get(name);
  if (!name || !u) return c.fail(`user '${name}' does not exist`, 6);
  if (o.val('G') !== undefined) {
    const groups = o.val('G')!.split(',').filter(Boolean);
    for (const g of groups) if (!sys.groups.has(g)) return c.fail(`group '${g}' does not exist`, 6);
    if (!o.has('a')) for (const g of sys.groups.values()) g.members.delete(name);
    for (const g of groups) sys.groups.get(g)!.members.add(name);
  }
  if (o.val('s')) u.shell = o.val('s')!;
  if (o.val('c')) u.gecos = o.val('c')!;
  if (o.has('L')) u.locked = true;
  if (o.has('U')) u.locked = false;
  if (o.val('l')) {
    sys.users.delete(name);
    u.name = o.val('l')!;
    sys.users.set(u.name, u);
    for (const g of sys.groups.values()) if (g.members.delete(name)) g.members.add(u.name);
  }
  syncEtc(sys, c.fs);
});

defineCommand('groupadd', { summary: 'Crea un grupo', usage: 'groupadd GRUPO', category: 'usuarios', sbin: true, level: 3, examples: [['sudo groupadd devs', 'Crea el grupo devs']] }, (c) => {
  if (needRoot(c, 'groupadd')) return 1;
  const o = parseOpts(c, c.args, { flags: 'r', values: 'g' });
  const name = o.rest[0];
  if (!name) return c.fail('usage: groupadd [options] GROUP', 2);
  if (c.sh.sys.groups.has(name)) return c.fail(`group '${name}' already exists`, 9);
  c.sh.sys.addGroup(name, [], o.val('g') ? parseInt(o.val('g')!, 10) : undefined);
  syncEtc(c.sh.sys, c.fs);
});

defineCommand('groupdel', { summary: 'Elimina un grupo', usage: 'groupdel GRUPO', category: 'usuarios', sbin: true, level: 3 }, (c) => {
  if (needRoot(c, 'groupdel')) return 1;
  const name = c.args[0];
  if (!c.sh.sys.groups.has(name)) return c.fail(`group '${name}' does not exist`, 6);
  c.sh.sys.groups.delete(name);
  syncEtc(c.sh.sys, c.fs);
});

defineCommand('gpasswd', { summary: 'Administra miembros de grupos', usage: 'gpasswd -a|-d USUARIO GRUPO', category: 'usuarios', sbin: true, level: 4 }, (c) => {
  const o = parseOpts(c, c.args, { values: 'ad' });
  if (c.cred.name !== 'root') return c.fail('Permission denied.', 1);
  const g = c.sh.sys.groups.get(o.rest[0]);
  if (!g) return c.fail(`group '${o.rest[0]}' does not exist`, 3);
  if (o.val('a')) { g.members.add(o.val('a')!); c.out(`Adding user ${o.val('a')} to group ${g.name}\n`); }
  if (o.val('d')) { g.members.delete(o.val('d')!); c.out(`Removing user ${o.val('d')} from group ${g.name}\n`); }
  syncEtc(c.sh.sys, c.fs);
});

defineCommand('passwd', {
  summary: 'Cambia la contraseña de un usuario',
  usage: 'passwd [-l|-u] [USUARIO]',
  category: 'usuarios',
  level: 2,
  options: [['-l', 'Bloquea la cuenta'], ['-u', 'Desbloquea'], ['-S', 'Estado de la contraseña'], ['-e', 'Caduca la contraseña']],
  examples: [['passwd', 'Cambia tu contraseña'], ['sudo passwd ana', 'Cambia la de ana']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'luSed' });
  const target = o.rest[0] ?? c.sh.user;
  const u = c.sh.sys.user(target);
  if (!u) return c.fail(`user '${target}' does not exist`);
  if (target !== c.sh.user && c.cred.name !== 'root') {
    c.err(`passwd: You may not view or modify password information for ${target}.\n`);
    return 1;
  }
  if (o.has('S')) {
    c.out(`${target} ${u.locked ? 'L' : 'P'} 03/10/2026 0 99999 7 -1\n`);
    return 0;
  }
  if (o.has('l')) { u.locked = true; c.out(`passwd: password expiry information changed.\n`); return 0; }
  if (o.has('u')) { u.locked = false; c.out(`passwd: password expiry information changed.\n`); return 0; }
  if (target === c.sh.user && c.cred.name !== 'root') {
    c.err(`Changing password for ${target}.\nCurrent password: `);
    if ((await c.stdin.readLine()) === null) return 10;
  } else c.err(`New password: `);
  const p1 = await c.stdin.readLine();
  c.err(`\nRetype new password: `);
  const p2 = await c.stdin.readLine();
  if (p1 === null || p2 === null) {
    c.err('\npasswd: Authentication token manipulation error\npasswd: password unchanged\n');
    return 10;
  }
  if (p1 !== p2) {
    c.err('\nSorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n');
    return 10;
  }
  c.err('\npasswd: password updated successfully\n');
  return 0;
});

defineCommand('getent', { summary: 'Consulta bases de datos del sistema (passwd, group…)', usage: 'getent passwd|group [CLAVE]', category: 'usuarios', level: 3 }, (c) => {
  const [db, key] = c.args;
  const sys = c.sh.sys;
  if (db === 'passwd') {
    const list = key ? [sys.users.get(key)].filter(Boolean) : [...sys.users.values()];
    if (key && !list.length) return 2;
    for (const u of list) c.out(`${u!.name}:x:${u!.uid}:${u!.gid}:${u!.gecos}:${u!.home}:${u!.shell}\n`);
  } else if (db === 'group') {
    const list = key ? [sys.groups.get(key)].filter(Boolean) : [...sys.groups.values()];
    if (key && !list.length) return 2;
    for (const g of list) c.out(`${g!.name}:x:${g!.gid}:${[...g!.members].join(',')}\n`);
  } else if (db === 'hosts') {
    c.out(`${sys.hosts.get(key)?.ip ?? '127.0.0.1'}       ${key ?? 'localhost'}\n`);
  } else return c.fail('Unknown database: ' + db, 1);
});

defineCommand('chage', { summary: 'Muestra o cambia la caducidad de contraseñas', usage: 'chage -l USUARIO', category: 'usuarios', level: 4 }, (c) => {
  const name = c.args.find((a) => !a.startsWith('-')) ?? c.sh.user;
  c.out(`Last password change\t\t\t\t\t: Mar 10, 2026\nPassword expires\t\t\t\t\t: never\nPassword inactive\t\t\t\t\t: never\nAccount expires\t\t\t\t\t\t: never\nMinimum number of days between password change\t\t: 0\nMaximum number of days between password change\t\t: 99999\nNumber of days of warning before password expires\t: 7\n`);
  void name;
});

defineCommand('visudo', { summary: 'Edita el archivo sudoers de forma segura', usage: 'sudo visudo', category: 'permisos', sbin: true, level: 4 }, async (c) => {
  if (c.cred.name !== 'root') return c.fail('/etc/sudoers: Permission denied', 1);
  c.out('visudo: edita /etc/sudoers con el editor integrado (nano /etc/sudoers en este simulador)\n');
});

defineCommand('getfacl', { summary: 'Muestra listas de control de acceso (ACL)', usage: 'getfacl ARCHIVO', category: 'permisos', level: 4 }, (c) => {
  for (const f of c.args.filter((a) => !a.startsWith('-'))) {
    const n = c.fs.stat(c.abs(f), c.cred);
    if (!n) { c.err(`getfacl: ${f}: No such file or directory\n`); continue; }
    const s = modeString(n.kind, n.mode);
    c.out(`# file: ${f}\n# owner: ${n.uid}\n# group: ${n.gid}\nuser::${s.slice(1, 4)}\ngroup::${s.slice(4, 7)}\nother::${s.slice(7, 10)}\n\n`);
  }
});

export { REGISTRY, basename, applyFiles, table };
