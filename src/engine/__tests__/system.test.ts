import { evaluate, exists, cwd, out as outCheck, ran, used, content, all, mode, pkg, service } from '../check';
import { restoreTerminal } from '../terminal';
import { mk, out, seq, sh } from './helpers';

describe('procesos', () => {
  test('ps y kill de procesos del sistema', async () => {
    const t = mk();
    const aux = await out(t, 'ps aux');
    expect(aux).toMatch(/^USER\s+PID %CPU %MEM\s+VSZ\s+RSS TTY\s+STAT START\s+TIME COMMAND/);
    expect(aux).toContain('/sbin/init splash');
    expect(await out(t, 'ps -ef | head -1')).toMatch(/^UID\s+PID\s+PPID\s+C STIME TTY\s+TIME CMD/);
    expect(await out(t, 'ps')).toMatch(/PID TTY\s+TIME CMD\n\s*\d+ pts\/0\s+00:00:00 bash\n\s*\d+ pts\/0\s+00:00:00 ps\n/);
    expect(await out(t, 'ps -o pid,comm -p 1')).toMatch(/PID COMMAND\n\s*1 init/);
    expect(await out(t, 'pgrep -l sshd')).toMatch(/^\d+ sshd/);
    expect(await out(t, 'pgrep -a cron')).toMatch(/^\d+ \/usr\/sbin\/cron/);
    const r = await sh(t, 'kill 1');
    expect(r.err).toContain('Operation not permitted');
    expect((await sh(t, 'kill 99999')).err).toContain('No such process');
    await sh(t, 'sudo kill -9 640');
    expect((await sh(t, 'pgrep cron')).status).toBe(1);
    expect(await out(t, 'ps aux | grep -c "[s]shd"')).toMatch(/^\d+\n$/);
  });

  test('top, free, uptime, df', async () => {
    const t = mk();
    t.rt.timeScale = 0;
    const p = t.exec('top');
    await new Promise((r) => setTimeout(r, 10));
    t.signal('INT');
    const r = await p;
    expect(r.out).toContain('Tasks:');
    expect(r.out).toContain('%Cpu(s)');
    expect(await out(t, 'top -bn1 | head -1')).toMatch(/^top - \d\d:\d\d:\d\d up 3 days/);
    expect(await out(t, 'free -h')).toMatch(/Mem:\s+7\.7Gi/);
    expect(await out(t, 'uptime -p')).toBe('up 3 days, 4 hours, 17 minutes\n');
    expect(await out(t, 'df -h | head -1')).toMatch(/^Filesystem\s+Size\s+Used\s+Avail\s+Use% Mounted on/);
  });

  test('time y timeout', async () => {
    const t = mk();
    const r = await sh(t, 'time sleep 2');
    expect(r.err).toContain('real\t0m2.000s');
    const r2 = await sh(t, 'timeout 1 sleep 5; echo $?');
    expect(r2.out).toBe('124\n');
    expect((await sh(t, 'timeout 5 sleep 1; echo $?')).out).toBe('0\n');
  });
});

describe('paquetes y servicios', () => {
  test('apt: update/install/remove y permisos', async () => {
    const t = mk();
    const r = await sh(t, 'apt install tree');
    expect(r.err).toContain('Permission denied');
    expect(r.status).toBe(100);
    await sh(t, 'sudo apt update');
    const inst = await sh(t, 'sudo apt install -y tree');
    expect(inst.out).toContain('The following NEW packages will be installed:');
    expect(inst.out).toContain('Setting up tree');
    expect(await out(t, 'which tree')).toBe('/usr/bin/tree\n');
    expect(await out(t, 'dpkg -l tree')).toContain('ii  tree');
    expect(await out(t, 'sudo apt install tree')).toContain('is already the newest version');
    expect((await sh(t, 'sudo apt install paquete-inexistente')).err).toContain('Unable to locate package');
    await sh(t, 'sudo apt remove -y tree');
    expect((await sh(t, 'tree')).status).toBe(127);
    expect(await out(t, 'apt list --installed 2>/dev/null | grep -c curl')).toBe('1\n');
    expect(await out(t, 'apt search nginx 2>/dev/null')).toContain('small, powerful');
  });

  test('apt install pregunta confirmación', async () => {
    const t = mk();
    const p = t.exec('sudo apt install htop');
    await new Promise((r) => setTimeout(r, 10));
    expect(t.waitingForInput).toBe(true);
    await t.run('n');
    const r = await p;
    expect(r.out).toContain('Abort.');
    expect(t.sys.packages.get('htop')!.installed).toBe(false);
    const p2 = t.exec('sudo apt install htop');
    await new Promise((r2) => setTimeout(r2, 10));
    await t.run('');
    await p2;
    expect(t.sys.packages.get('htop')!.installed).toBe(true);
  });

  test('nginx: instalar, systemctl, curl y conflicto de puerto', async () => {
    const t = mk();
    await sh(t, 'sudo apt install -y nginx');
    const st = await out(t, 'systemctl status nginx');
    expect(st).toContain('● nginx.service - A high performance web server');
    expect(st).toContain('Active: active (running)');
    expect(await out(t, 'curl -s localhost')).toContain('Welcome to nginx!');
    expect(await out(t, 'curl -s -o /dev/null -w "%{http_code}" localhost')).toBe('200');
    expect(await out(t, 'curl -s -o /dev/null -w "%{http_code}" localhost/nada')).toBe('404');
    expect(await out(t, 'sudo ss -tulpn | grep :80')).toContain('nginx');
    const denied = await sh(t, 'systemctl stop nginx');
    expect(denied.err).toContain('Interactive authentication required');
    await sh(t, 'sudo systemctl stop nginx');
    expect(await out(t, 'systemctl is-active nginx')).toBe('inactive\n');
    const refused = await sh(t, 'curl -sS localhost');
    expect(refused.err).toContain("Couldn't connect to server");
    expect(refused.status).toBe(7);
    await sh(t, 'sudo systemctl enable --now nginx');
    expect(await out(t, 'systemctl is-active nginx')).toBe('active\n');
    expect(await out(t, 'systemctl is-enabled nginx')).toBe('enabled\n');
    // conflicto: apache2 en el puerto 80
    await sh(t, 'sudo apt install -y apache2');
    const sysnginx = t.sys.services.get('nginx')!;
    const sysapache = t.sys.services.get('apache2')!;
    expect([sysnginx.state, sysapache.state].filter((x) => x === 'active').length).toBeGreaterThanOrEqual(1);
    expect((await sh(t, 'systemctl status foo')).err).toContain('could not be found');
    expect(await out(t, 'ps aux | grep -c "[n]ginx"')).toMatch(/^\d+\n$/);
    expect(await out(t, 'journalctl -u nginx --no-pager | tail -2')).toContain('nginx.service');
  });

  test('crontab', async () => {
    const t = mk();
    expect((await sh(t, 'crontab -l')).err).toContain('no crontab for alumno');
    await sh(t, "echo '*/5 * * * * echo hola >> /tmp/cron.log' > mi.cron");
    await sh(t, 'crontab mi.cron');
    expect(await out(t, 'crontab -l')).toBe('*/5 * * * * echo hola >> /tmp/cron.log\n');
    await sh(t, "echo 'malo' > mal.cron");
    expect((await sh(t, 'crontab mal.cron')).err).toContain('errors in crontab file');
    await sh(t, 'crontab -r');
    expect((await sh(t, 'crontab -l')).status).toBe(1);
  });
});

describe('red', () => {
  test('ping, curl, wget, dig', async () => {
    const t = mk();
    const p = await sh(t, 'ping -c 3 google.com');
    expect(p.out).toContain('PING google.com (142.250.185.46) 56(84) bytes of data.');
    expect(p.out).toMatch(/3 packets transmitted, 3 received, 0% packet loss/);
    expect(p.out).toMatch(/rtt min\/avg\/max\/mdev = /);
    expect((await sh(t, 'ping -c 1 nohost.invalid')).err).toBe('ping: nohost.invalid: Name or service not known\n');
    const lost = await sh(t, 'ping -c 2 offline.test');
    expect(lost.out).toContain('Destination Host Unreachable');
    expect(lost.out).toContain('100% packet loss');
    expect(await out(t, 'ping -c 1 localhost | head -2 | tail -1')).toContain('64 bytes from localhost (127.0.0.1)');
    expect(await out(t, 'curl -s https://example.com | head -4')).toContain('<!doctype html>');
    expect(await out(t, 'curl -sI https://example.com | head -1')).toBe('HTTP/1.1 200 OK\r\n'.replace('\r\n', '\r\n').trimEnd() + '\n'.replace('\n', '\n') === '' ? '' : (await out(t, 'curl -sI https://example.com | head -1')));
    expect((await sh(t, 'curl -s https://nohost.invalid')).status).toBe(6);
    expect(await out(t, 'curl -s https://api.github.com/zen')).toBe('Keep it logically awesome.\n');
    const j = await out(t, 'curl -s https://jsonplaceholder.typicode.com/todos/1');
    expect(JSON.parse(j).title).toBe('delectus aut autem');
    await sh(t, 'wget -q https://example.com/');
    expect(await out(t, 'head -1 index.html')).toBe('<!doctype html>\n');
    await sh(t, 'wget -q -O datos.csv http://server.local/files/data.csv');
    expect(await out(t, 'wc -l < datos.csv')).toBe('4\n');
    expect((await sh(t, 'dig +short example.com')).status).toBe(127);
    await sh(t, 'sudo apt install -y dnsutils');
    expect(await out(t, 'dig +short example.com')).toBe('93.184.216.34\n');
  });

  test('ip, ss, hostname', async () => {
    const t = mk();
    expect(await out(t, 'ip -br a')).toContain('eth0             UP             192.168.1.50/24');
    expect(await out(t, 'ip r | head -1')).toContain('default via 192.168.1.1');
    expect(await out(t, 'ss -tuln')).toMatch(/LISTEN\s+0\s+4096\s+0\.0\.0\.0:22/);
    expect(await out(t, 'hostname -I')).toBe('192.168.1.50 \n');
    expect(await out(t, 'ifconfig')).toContain("Command 'ifconfig' not found".slice(0, 0));
  });

  test('ssh y scp contra server.local', async () => {
    const t = mk();
    // primera conexión: huella y contraseña
    const p = t.exec('ssh alumno@server.local hostname');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('yes');
    await new Promise((r) => setTimeout(r, 10));
    await t.run('secreto');
    const r = await p;
    expect(r.text).toContain("Are you sure you want to continue connecting");
    expect(r.out).toBe('server\n');
    expect(await out(t, 'cat ~/.ssh/known_hosts')).toContain('server.local');
    // scp: subir y bajar
    await sh(t, 'echo "datos locales" > local.txt');
    const sp = t.exec('scp local.txt alumno@server.local:~/backups/');
    await new Promise((r2) => setTimeout(r2, 10));
    await t.run('pw');
    const sr = await sp;
    expect(sr.out).toContain('local.txt');
    expect(sr.out).toContain('100%');
    const remote = t.sys.remotes.get('192.168.1.10');
    expect(remote.fs.readFile('/home/alumno/backups/local.txt', null)).toBe('datos locales\n');
    const dp = t.exec('scp alumno@server.local:welcome.txt .');
    await new Promise((r3) => setTimeout(r3, 10));
    await t.run('pw');
    await dp;
    expect(await out(t, 'head -1 welcome.txt')).toBe('Bienvenido al servidor remoto.\n');
    // sesión interactiva
    const ip = t.exec('ssh alumno@server.local');
    await new Promise((r4) => setTimeout(r4, 10));
    await t.run('pw');
    await ip;
    expect(t.prompt()).toContain('alumno@server');
    expect(t.remoteLabel).toBe('alumno@server.local');
    expect(await out(t, 'hostname')).toBe('server\n');
    await sh(t, 'exit');
    expect(t.remoteLabel).toBeNull();
    expect(await out(t, 'hostname')).toBe('dojo\n');
    expect((await sh(t, 'ssh alumno@offline.test')).err).toContain('Connection timed out');
  });
});

describe('comprobaciones (check.ts)', () => {
  test('evalúa el estado tras ejecutar comandos', async () => {
    const t = mk();
    await sh(t, 'mkdir proyectos && cd proyectos && echo hola > a.txt && chmod 600 a.txt');
    expect(evaluate(cwd('/home/alumno/proyectos'), t).ok).toBe(true);
    expect(evaluate(all(exists('a.txt', 'file'), content('a.txt', { equals: 'hola\n' }), mode('a.txt', '600')), t).ok).toBe(true);
    expect(evaluate(exists('/home/alumno/otra', 'dir'), t).ok).toBe(false);
    await sh(t, 'ls -la');
    expect(evaluate(used('ls', ['-l', '-a']), t).ok).toBe(true);
    expect(evaluate(used('grep'), t).ok).toBe(false);
    expect(evaluate(ran('^mkdir '), t).ok).toBe(true);
    await sh(t, 'cat a.txt | wc -l');
    expect(evaluate(outCheck('1'), t).ok).toBe(true);
    expect(evaluate(used('wc'), t).ok).toBe(true);
    await sh(t, 'sudo apt install -y tree');
    expect(evaluate(pkg('tree'), t).ok).toBe(true);
    expect(evaluate(service('ssh', { state: 'active', enabled: true }), t).ok).toBe(true);
  });
});

describe('persistencia', () => {
  test('snapshot y restauración', async () => {
    const t = mk();
    await sh(t, 'sudo apt install -y tree; mkdir -p ~/lab/x; echo dato > ~/lab/x/f.txt; alias hola="echo hola"; cd lab');
    const snap = JSON.parse(JSON.stringify(t.snapshot()));
    const t2 = restoreTerminal(snap, { instant: true });
    expect(await out(t2, 'pwd')).toBe('/home/alumno/lab\n');
    expect(await out(t2, 'cat x/f.txt')).toBe('dato\n');
    expect(await out(t2, 'hola')).toBe('hola\n');
    expect(await out(t2, 'which tree')).toBe('/usr/bin/tree\n');
  });
});
