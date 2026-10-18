import { mk, out, seq, sh } from './helpers';

describe('archivos y directorios', () => {
  test('ls: formatos básicos', async () => {
    const t = mk();
    expect((await out(t, 'ls -1')).split('\n').filter(Boolean)).toEqual(['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos']);
    const la = await out(t, 'ls -1a');
    expect(la).toContain('.bashrc');
    expect(la.split('\n')[0]).toBe('.');
    const l = await out(t, 'ls -l /home/alumno/Documents');
    expect(l).toBe('total 0\n');
    await sh(t, 'echo hola > Documents/a.txt');
    const ll = await out(t, 'ls -l Documents');
    expect(ll).toMatch(/^total 4\n-rw-r--r-- 1 alumno alumno 5 Mar 14 \d\d:\d\d a\.txt\n$/);
    expect(await out(t, 'ls -ld /tmp')).toMatch(/^drwxrwxrwt 2 root root 4096 /);
    expect(await out(t, 'ls -F')).toContain('Documents/');
    expect(await out(t, 'ls -1 /usr/bin | head -3')).toMatch(/\n/);
    const bad = await sh(t, 'ls /noexiste');
    expect(bad.err).toBe("ls: cannot access '/noexiste': No such file or directory\n");
    expect(bad.status).toBe(2);
  });

  test('ls -R, -t, -S, -h, -d', async () => {
    const t = mk();
    await sh(t, 'mkdir -p d/sub && touch d/a d/sub/b');
    expect(await out(t, 'ls -R d')).toBe('d:\na  sub\n\nd/sub:\nb\n');
    await sh(t, 'echo grande > grande.txt; touch -d "2020-01-01" viejo.txt; touch nuevo.txt');
    const byTime = (await out(t, 'ls -1t *.txt')).trim().split('\n');
    expect(byTime[byTime.length - 1]).toBe('viejo.txt');
    await sh(t, "head -c 3000 /dev/zero | tr '\\0' 'x' > big.dat; echo $?");
    expect(await out(t, 'ls -d */ | head -2')).toMatch(/Desktop\//);
  });

  test('mkdir, touch, cp, mv, rm', async () => {
    const t = mk();
    await sh(t, 'mkdir -p a/b/c');
    expect((await sh(t, 'mkdir a')).err).toContain('File exists');
    expect((await sh(t, 'mkdir x/y')).err).toContain('No such file or directory');
    await sh(t, 'touch a/f1 a/f2');
    await sh(t, 'cp a/f1 a/f3');
    expect(await out(t, 'ls a')).toBe('b  f1  f2  f3\n');
    expect((await sh(t, 'cp a b')).err).toContain('-r not specified');
    await sh(t, 'cp -r a z');
    expect(await out(t, 'ls z/b')).toBe('c\n');
    await sh(t, 'mv a/f1 a/renombrado');
    expect(await out(t, 'ls a')).toContain('renombrado');
    await sh(t, 'mv a/f2 z/');
    expect(await out(t, 'ls z')).toContain('f2');
    expect((await sh(t, 'rm a')).err).toContain('Is a directory');
    await sh(t, 'rm -r a');
    expect((await sh(t, 'ls a')).err).toContain('No such file');
    expect((await sh(t, 'rm noexiste')).err).toContain('No such file or directory');
    expect((await sh(t, 'rm -f noexiste')).status).toBe(0);
    expect((await sh(t, 'rmdir z')).err).toContain('Directory not empty');
    expect((await sh(t, 'rm -rf /')).err).toContain('--no-preserve-root');
  });

  test('rm -i pide confirmación', async () => {
    const t = mk();
    await sh(t, 'touch uno dos');
    const p = t.exec('rm -i uno');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('n');
    await p;
    expect(await out(t, 'ls uno')).toBe('uno\n');
    const p2 = t.exec('rm -i uno');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('y');
    await p2;
    expect((await sh(t, 'ls uno')).status).toBe(2);
  });

  test('cat, head, tail, wc', async () => {
    const t = mk();
    await sh(t, 'seq 1 20 > n.txt');
    expect(await out(t, 'head -n 3 n.txt')).toBe('1\n2\n3\n');
    expect(await out(t, 'head -3 n.txt')).toBe('1\n2\n3\n');
    expect(await out(t, 'tail -n 2 n.txt')).toBe('19\n20\n');
    expect(await out(t, 'tail -n +19 n.txt')).toBe('19\n20\n');
    expect(await out(t, 'wc -l n.txt')).toBe('20 n.txt\n');
    expect(await out(t, 'cat -n n.txt | head -2')).toBe('     1\t1\n     2\t2\n');
    expect(await out(t, 'cat n.txt n.txt | wc -l')).toBe('40\n');
    expect((await sh(t, 'cat noexiste')).err).toBe('cat: noexiste: No such file or directory\n');
    expect((await sh(t, 'cat Documents')).err).toBe('cat: Documents: Is a directory\n');
    expect(await out(t, 'wc -w <<< "uno dos tres"')).toBe('3\n');
  });

  test('stat, file, du, df, ln', async () => {
    const t = mk();
    await sh(t, "echo '#!/bin/bash' > s.sh; chmod +x s.sh");
    expect(await out(t, 'file s.sh')).toContain('Bourne-Again shell script');
    expect(await out(t, 'file Documents')).toBe('Documents: directory\n');
    expect(await out(t, 'stat -c "%a %U %s" s.sh')).toBe('755 alumno 12\n');
    expect(await out(t, 'stat s.sh')).toContain('Access: (0755/-rwxr-xr-x)');
    await sh(t, 'ln -s s.sh enlace; ln s.sh duro');
    expect(await out(t, 'ls -l enlace')).toContain('enlace -> s.sh');
    expect(await out(t, 'stat -c %h s.sh')).toBe('2\n');
    expect(await out(t, 'readlink enlace')).toBe('s.sh\n');
    expect(await out(t, 'cat enlace')).toBe('#!/bin/bash\n');
    expect(await out(t, 'du -sh Documents')).toBe('4.0K\tDocuments\n');
    expect(await out(t, 'df -h /')).toContain('/dev/vda1');
    expect(await out(t, 'basename /a/b/c.txt .txt')).toBe('c\n');
    expect(await out(t, 'dirname /a/b/c.txt')).toBe('/a/b\n');
    expect(await out(t, 'realpath Documents/..')).toBe('/home/alumno\n');
  });

  test('find', async () => {
    const t = mk({ lab: true });
    expect(await out(t, 'find projects -name "*.sh" | sort')).toBe('projects/scripts/backup.sh\nprojects/scripts/hello.sh\n');
    expect(await out(t, 'find projects -type d | sort')).toContain('projects/web');
    expect(await out(t, 'find . -maxdepth 1 -name "p*"')).toBe('./projects\n');
    expect(await out(t, 'find projects -name "*.html" -exec cat {} \\; | head -1')).toBe('<!DOCTYPE html>\n');
    expect(await out(t, 'find projects/scripts -type f -perm 755')).toBe('projects/scripts/hello.sh\n');
    expect(await out(t, 'find logs -type f -size +1k | wc -l')).toBe('2\n');
    expect(await out(t, 'find . -empty -type d | sort | head -2')).toContain('./Desktop');
    await sh(t, 'touch tmp1.tmp tmp2.tmp');
    await sh(t, 'find . -name "*.tmp" -delete');
    expect((await sh(t, 'ls *.tmp')).err).toContain('cannot access');
    expect(await out(t, 'find / -name passwd 2>/dev/null | head -3')).toContain('/etc/passwd');
    expect(await out(t, 'find projects -name "*.js" -o -name "*.css" | sort')).toBe('projects/web/app.js\nprojects/web/style.css\n');
    expect(await out(t, 'find projects -type f ! -name "*.sh" | wc -l')).toBe('5\n');
    expect(await out(t, 'find Documents -type f | xargs wc -l | tail -1')).toMatch(/total/);
  });

  test('tree (requiere instalar el paquete)', async () => {
    const t = mk({ lab: true });
    const r = await sh(t, 'tree');
    expect(r.err).toContain("Command 'tree' not found");
    expect(r.status).toBe(127);
    await sh(t, 'sudo apt install -y tree');
    const tr = await out(t, 'tree -L 1 projects');
    expect(tr).toBe('projects\n├── data\n├── scripts\n└── web\n\n3 directories, 0 files\n');
  });

  test('tar y gzip', async () => {
    const t = mk({ lab: true });
    await sh(t, 'tar -czvf proj.tar.gz projects');
    expect(await out(t, 'file proj.tar.gz')).toContain('gzip compressed data');
    const list = await out(t, 'tar -tzf proj.tar.gz');
    expect(list).toContain('projects/web/index.html');
    await sh(t, 'mkdir out && tar -xzf proj.tar.gz -C out');
    expect(await out(t, 'cat out/projects/web/README.md')).toContain('# Mi sitio');
    await sh(t, 'tar cf plano.tar Documents && tar tf plano.tar | head -1');
    expect(await out(t, 'tar tf plano.tar | head -1')).toBe('Documents/\n');
    await sh(t, 'echo hola > h.txt; gzip h.txt');
    expect(await out(t, 'ls h.txt*')).toBe('h.txt.gz\n');
    expect(await out(t, 'zcat h.txt.gz')).toBe('hola\n');
    await sh(t, 'gunzip h.txt.gz');
    expect(await out(t, 'cat h.txt')).toBe('hola\n');
    const bad = await sh(t, 'tar -xzf h.txt');
    expect(bad.err).toContain('not in gzip format');
    expect((await sh(t, 'tar -tf noexiste.tar')).err).toContain('Cannot open');
  });
});

describe('permisos', () => {
  test('chmod octal y simbólico', async () => {
    const t = mk();
    await sh(t, 'touch f');
    expect(await out(t, 'stat -c %a f')).toBe('644\n');
    await sh(t, 'chmod 755 f');
    expect(await out(t, 'stat -c %a f')).toBe('755\n');
    await sh(t, 'chmod u-x,go-rx f');
    expect(await out(t, 'stat -c %a f')).toBe('600\n');
    await sh(t, 'chmod 000 f');
    const r = await sh(t, 'cat f');
    expect(r.err).toBe('cat: f: Permission denied\n');
    await sh(t, 'chmod u+r f');
    expect(await out(t, 'ls -l f')).toMatch(/^-r-------- /);
    await sh(t, 'chmod a=rw f');
    expect(await out(t, 'ls -l f')).toMatch(/^-rw-rw-rw- /);
    await sh(t, 'chmod +x f');
    expect(await out(t, 'stat -c %a f')).toBe('777\n');
    expect((await sh(t, 'chmod 9 f')).err).toContain('invalid mode');
    expect((await sh(t, 'chmod 755 /etc/passwd')).err).toContain('Operation not permitted');
  });

  test('permisos de directorio y Permission denied', async () => {
    const t = mk();
    await sh(t, 'mkdir secreto && echo x > secreto/a && chmod 000 secreto');
    expect((await sh(t, 'ls secreto')).err).toContain("cannot open directory 'secreto': Permission denied");
    expect((await sh(t, 'cd secreto')).err).toContain('Permission denied');
    await sh(t, 'chmod 755 secreto');
    expect(await out(t, 'ls secreto')).toBe('a\n');
    expect((await sh(t, 'cat /etc/shadow')).err).toContain('Permission denied');
    expect((await sh(t, 'ls /root')).err).toContain('Permission denied');
    expect((await sh(t, 'touch /etc/nuevo')).err).toContain('Permission denied');
    expect((await sh(t, 'echo x > /etc/passwd')).err).toContain('Permission denied');
    expect((await sh(t, 'ls /home/ana')).err).toContain('Permission denied');
  });

  test('sudo, su, chown', async () => {
    const t = mk();
    expect(await out(t, 'sudo whoami')).toBe('root\n');
    expect(await out(t, 'sudo cat /etc/shadow | head -1')).toMatch(/^root:/);
    await sh(t, 'touch mio');
    expect((await sh(t, 'chown ana mio')).err).toContain('Operation not permitted');
    await sh(t, 'sudo chown ana:developers mio');
    expect(await out(t, 'ls -l mio')).toMatch(/ ana developers /);
    expect((await sh(t, 'sudo chown fantasma mio')).err).toContain('invalid user');
    await sh(t, 'sudo -i');
    expect(t.prompt()).toContain('root@dojo');
    expect(await out(t, 'whoami')).toBe('root\n');
    expect(await out(t, 'pwd')).toBe('/root\n');
    await sh(t, 'exit');
    expect(await out(t, 'whoami')).toBe('alumno\n');
    expect(await out(t, 'pwd')).toBe('/home/alumno\n');
    await sh(t, 'su - ana');
    expect(await out(t, 'whoami')).toBe('ana\n');
    await sh(t, 'exit');
    const t2 = mk({ user: 'ana' });
    expect((await sh(t2, 'sudo ls')).err).toContain('is not in the sudoers file');
    expect(await out(t, 'sudo -u ana id -un')).toBe('ana\n');
    expect(await out(t, 'sudo -l | tail -1')).toBe('    (ALL : ALL) ALL\n');
  });

  test('usuarios y grupos', async () => {
    const t = mk();
    expect(await out(t, 'id')).toMatch(/^uid=1000\(alumno\) gid=1000\(alumno\) groups=1000\(alumno\),4\(adm\),24\(cdrom\),27\(sudo\)/);
    expect(await out(t, 'groups')).toBe('alumno adm cdrom sudo dip plugdev users\n');
    expect((await sh(t, 'useradd carla')).err).toContain('Permission denied');
    await sh(t, 'sudo useradd -m -s /bin/bash -G sudo,developers carla');
    expect(await out(t, 'id carla')).toContain('carla');
    expect(await out(t, 'grep carla /etc/passwd')).toBe('carla:x:1003:1004::/home/carla:/bin/bash\n');
    expect(await out(t, 'ls -ld /home/carla')).toMatch(/carla carla/);
    await sh(t, 'sudo usermod -aG docker carla');
    expect(await out(t, 'sudo groupadd docker; sudo usermod -aG docker carla; groups carla')).toContain('docker');
    await sh(t, 'sudo userdel -r carla');
    expect((await sh(t, 'id carla')).err).toContain('no such user');
    expect(await out(t, 'getent group developers')).toBe('developers:x:1003:ana,bob\n');
    expect(await out(t, 'cut -d: -f1 /etc/passwd | head -2')).toBe('root\ndaemon\n');
  });

  test('umask', async () => {
    const t = mk();
    expect(await out(t, 'umask')).toBe('0022\n');
    await sh(t, 'umask 077; touch priv; mkdir pd');
    expect(await out(t, 'stat -c %a priv')).toBe('600\n');
    expect(await out(t, 'stat -c %a pd')).toBe('700\n');
    expect(await out(t, 'umask -S')).toBe('u=rwx,g=,o=\n');
  });
  test('find -delete borra una sola vez y sin errores', async () => {
    const t = mk();
    await sh(t, 'mkdir -p p/tmp p/vacia && touch p/tmp/a.tmp p/tmp/b.tmp && echo k > p/keep.txt');
    const r = await sh(t, "find p -name '*.tmp' -delete");
    expect(r.err).toBe('');
    expect((await out(t, 'find p')).trim().split('\n')).toEqual(['p', 'p/keep.txt', 'p/tmp', 'p/vacia']);
    expect((await sh(t, 'find p -empty -delete')).err).toBe('');
    expect((await out(t, 'find p')).trim().split('\n')).toEqual(['p', 'p/keep.txt']);
  });
});
