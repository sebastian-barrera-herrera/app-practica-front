/** Red: ping, curl, wget, ip, ss, dig, ssh, scp, rsync, ufw… */
import { C, color, isoFull, padStart, table, humanSize } from '../format';
import { basename, dirname } from '../path';
import { defineCommand, parseOpts, type Ctx } from '../registry';
import { SignalEx } from '../shell';
import { FsError } from '../vfs';
import { createWorld, type World } from '../world';
import { fakeRand, httpFetch, isIp, isLocal, latencyFor, resolveHost, SITES, statusText } from './internet';
import { strftime } from './system';
import { formatPrintf, splitLines } from './util';

// ───────────────────────── ping ─────────────────────────

defineCommand('ping', {
  summary: 'Comprueba si un equipo responde en la red',
  usage: 'ping [-c N] [-i S] [-W S] DESTINO',
  category: 'redes',
  level: 1,
  options: [['-c N', 'Envía N paquetes y termina'], ['-i S', 'Intervalo entre paquetes'], ['-W S', 'Tiempo máximo de espera'], ['-q', 'Solo el resumen'], ['-s N', 'Tamaño del paquete']],
  examples: [['ping -c 4 google.com', '4 paquetes a Google'], ['ping 192.168.1.1', 'A tu router (Ctrl+C para parar)'], ['ping -c 1 localhost', 'Prueba local']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'q4n', values: 'ciWwsIt', long: { '--count': 'c' } });
  const host = o.rest[0];
  if (!host) {
    c.err('ping: usage error: Destination address required\n');
    return 2;
  }
  const sys = c.sh.sys;
  const r = resolveHost(sys, c.fs, host);
  if (!r) {
    c.err(`ping: ${host}: Name or service not known\n`);
    return 2;
  }
  const rand = fakeRand(host + sys.clock.now);
  const size = o.val('s') ? parseInt(o.val('s')!, 10) : 56;
  const name = isIp(host) ? host : host;
  const shown = r.site?.ptr && !isIp(host) ? r.ip : r.ip;
  c.out(`PING ${host} (${r.ip}) ${size}(${size + 28}) bytes of data.\n`);
  const interactive = c.io.tty && !c.sh.bg && o.val('c') === undefined;
  const count = o.val('c') ? parseInt(o.val('c')!, 10) : interactive ? Infinity : 4;
  const interval = o.val('i') ? parseFloat(o.val('i')!) * 1000 : 1000;
  const up = isLocal(sys, r.ip) || (r.site ? r.site.up !== false : r.ip.startsWith('192.168.1.') ? false : false);
  const times: number[] = [];
  let sent = 0;
  const t0 = sys.clock.now;
  const stats = () => {
    const lost = sent - times.length;
    const total = Math.max(0, Math.round(sys.clock.now - t0));
    c.out(`\n--- ${host} ping statistics ---\n${sent} packets transmitted, ${times.length} received, ${sent ? Math.round((lost / sent) * 100) : 0}% packet loss, time ${(sent - 1) * (interval) + (up ? 0 : 0)}ms\n`.replace(/time \d+ms/, `time ${Math.max(0, total)}ms`));
    if (times.length) {
      const min = Math.min(...times), max = Math.max(...times), avg = times.reduce((a, b) => a + b, 0) / times.length;
      const mdev = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length);
      c.out(`rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms\n`);
    }
  };
  try {
    for (let i = 1; i <= count; i++) {
      sent = i;
      if (up) {
        const t = latencyFor(sys, r.ip, r.site, rand);
        times.push(t);
        const from = isLocal(sys, r.ip) ? `${host === 'localhost' ? 'localhost' : name} (${r.ip})` : r.site?.ptr ? `${r.site.ptr} (${r.ip})` : r.ip;
        c.out(`${size + 8} bytes from ${from}: icmp_seq=${i} ttl=${isLocal(sys, r.ip) ? 64 : 117} time=${t.toFixed(t < 1 ? 3 : 1)} ms\n`);
      } else {
        c.out(`From ${sys.ipAddr} icmp_seq=${i} Destination Host Unreachable\n`);
      }
      if (i < count) await c.sh.sleep(interval);
    }
  } catch (e) {
    if (e instanceof SignalEx && e.sig === 'INT') {
      stats();
      return times.length ? 0 : 1;
    }
    throw e;
  }
  stats();
  return times.length ? 0 : 1;
});

// ───────────────────────── curl ─────────────────────────

function progressMeter(c: Ctx, size: number) {
  c.err('  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n');
  c.err(`100 ${String(size).padStart(5)}  100 ${String(size).padStart(5)}    0     0  ${String(Math.max(size * 7, 1000)).padStart(6)}      0 --:--:-- --:--:-- --:--:-- ${String(Math.max(size * 7, 1000)).padStart(6)}\n`);
}

defineCommand('curl', {
  summary: 'Transfiere datos desde o hacia un servidor (HTTP, HTTPS…)',
  usage: 'curl [OPCIONES] URL',
  category: 'redes',
  level: 2,
  options: [['-I', 'Solo las cabeceras (HEAD)'], ['-i', 'Incluye cabeceras en la salida'], ['-s', 'Silencioso (sin progreso)'], ['-o ARCHIVO', 'Guarda en un archivo'], ['-O', 'Guarda con el nombre remoto'], ['-L', 'Sigue redirecciones'], ['-X MÉTODO', 'Método HTTP (POST, PUT…)'], ['-d DATOS', 'Cuerpo de la petición'], ['-H CABECERA', 'Añade una cabecera'], ['-w FORMATO', 'Formato de salida (%{http_code})'], ['-f', 'Falla si el servidor responde con error']],
  examples: [['curl https://example.com', 'Descarga la página'], ['curl -I https://example.com', 'Solo cabeceras'], ['curl -s https://api.github.com/zen', 'Respuesta de una API'], ['curl -o /dev/null -s -w "%{http_code}\\n" https://example.com', 'Solo el código de estado'], ['curl -X POST -d "a=1" https://httpbin.org/post', 'Petición POST']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'IisSLkvfOsRgGN#', values: 'oXdHwuAmeb', long: { '--head': 'I', '--include': 'i', '--silent': 's', '--location': 'L', '--output': 'o', '--request': 'X', '--data': 'd', '--header': 'H', '--write-out': 'w', '--fail': 'f', '--remote-name': 'O', '--verbose': 'v', '--insecure': 'k', '--max-time': 'm', '--user': 'u', '--user-agent': 'A', '--data-raw': 'd', '--show-error': 'S' } });
  let url = o.rest[0];
  if (!url) {
    c.err("curl: try 'curl --help' or 'curl --manual' for more information\n");
    return 2;
  }
  const sys = c.sh.sys;
  const method = o.val('X') ?? (o.has('I') ? 'HEAD' : o.val('d') ? 'POST' : 'GET');
  let hops = 0;
  let final: ReturnType<typeof httpFetch>;
  const verbose: string[] = [];
  for (;;) {
    final = httpFetch(sys, c.fs, c.sh.rt, url, method, o.val('d'));
    if (o.has('v')) {
      verbose.push(`*   Trying ${final.ip ?? '…'}:${/^https/.test(url) ? 443 : 80}...`, `* Connected to ${url.replace(/^https?:\/\//, '').split('/')[0]} (${final.ip}) port ${/^https/.test(url) ? 443 : 80}`, `> ${method} ${/^https?:\/\/[^/]+(\/.*)?$/.exec(url)?.[1] ?? '/'} HTTP/1.1`, `> Host: ${url.replace(/^https?:\/\//, '').split('/')[0]}`, `> User-Agent: curl/8.5.0`, `> Accept: */*`, '>');
    }
    if (!final.ok || !o.has('L') || ![301, 302, 307, 308].includes(final.status ?? 0) || !final.headers?.Location) break;
    if (++hops > 10) {
      c.err('curl: (47) Maximum (10) redirects followed\n');
      return 47;
    }
    const loc = final.headers.Location;
    url = /^https?:/.test(loc) ? loc : url.replace(/^(https?:\/\/[^/]+).*/, '$1') + loc;
  }
  if (!final.ok) {
    if (!o.has('s') || o.has('S')) c.err(`curl: (${final.curlCode}) ${final.error}\n`);
    if (o.val('w')) c.out(o.val('w')!.replace(/%\{http_code\}/g, '000'));
    return final.curlCode ?? 1;
  }
  const status = final.status!;
  const hdrs = [`HTTP/1.1 ${status} ${statusText(status)}`, `Server: ${final.headers?.Server ?? 'nginx'}`, `Date: ${strftime('%a, %d %b %Y %H:%M:%S GMT', sys.clock.now)}`, `Content-Type: ${final.type ?? 'text/html'}${final.type?.startsWith('text') ? '; charset=UTF-8' : ''}`, `Content-Length: ${final.size ?? final.body?.length ?? 0}`, ...Object.entries(final.headers ?? {}).filter(([k]) => k !== 'Server').map(([k, v]) => `${k}: ${v}`), 'Connection: keep-alive'];
  if (o.has('v')) {
    c.err(verbose.join('\n') + '\n' + hdrs.map((h) => '< ' + h).join('\n') + '\n<\n');
  }
  if (o.has('f') && status >= 400) {
    if (!o.has('s') || o.has('S')) c.err(`curl: (22) The requested URL returned error: ${status}\n`);
    return 22;
  }
  let out = '';
  if (o.has('I')) out += hdrs.join('\r\n') + '\r\n\r\n';
  else {
    if (o.has('i')) out += hdrs.join('\r\n') + '\r\n\r\n';
    out += final.body ?? '';
  }
  const outFile = o.val('o') ?? (o.has('O') ? basename(url.split('?')[0]) || 'index.html' : undefined);
  if (outFile) {
    if (outFile !== '/dev/null') {
      try {
        const n = c.fs.writeFile(c.abs(outFile), out, { cred: c.cred });
        if (final.size && final.size > out.length) n.size = final.size;
      } catch (e) {
        c.err(`curl: (23) Failure writing output to destination\ncurl: Failed writing body\n`);
        void e;
        return 23;
      }
    }
    if (!o.has('s')) progressMeter(c, final.size ?? out.length);
  } else {
    c.out(out);
    if (!c.io.tty && !o.has('s') && !o.has('S') && false) progressMeter(c, out.length);
  }
  if (o.val('w')) {
    c.out(o.val('w')!.replace(/%\{http_code\}/g, String(status)).replace(/%\{size_download\}/g, String(final.size ?? out.length)).replace(/%\{url_effective\}/g, url).replace(/%\{time_total\}/g, '0.083').replace(/%\{content_type\}/g, final.type ?? '').replace(/\\n/g, '\n'));
  }
  return 0;
});

// ───────────────────────── wget ─────────────────────────

defineCommand('wget', {
  summary: 'Descarga archivos de la web',
  usage: 'wget [-O ARCHIVO] [-q] [-c] URL',
  category: 'redes',
  level: 2,
  options: [['-O ARCHIVO', 'Guarda con otro nombre (- para stdout)'], ['-q', 'Silencioso'], ['-P DIR', 'Directorio de destino'], ['-c', 'Continúa una descarga'], ['--spider', 'Solo comprueba que existe']],
  examples: [['wget https://example.com/index.html', 'Descarga un archivo'], ['wget -O datos.csv http://server.local/files/data.csv', 'Con otro nombre'], ['wget -q -O - https://ifconfig.me', 'Imprime en pantalla']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'qcnvrdN', values: 'OPoUt', long: { '--quiet': 'q', '--output-document': 'O', '--directory-prefix': 'P', '--continue': 'c', '--spider': 'n', '--no-verbose': 'v' }, lenient: true });
  const url = o.rest.find((a) => !a.startsWith('-'));
  if (!url) {
    c.err('wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help\' for more options.\n');
    return 1;
  }
  const sys = c.sh.sys;
  const full = /^https?:\/\//.test(url) ? url : 'http://' + url;
  const f = httpFetch(sys, c.fs, c.sh.rt, full);
  const quiet = o.has('q');
  const stamp = strftime('%Y-%m-%d %H:%M:%S', sys.clock.now);
  const host = full.replace(/^https?:\/\//, '').split(/[/:]/)[0];
  const https = full.startsWith('https');
  if (!quiet) c.err(`--${stamp}--  ${full}\n`);
  if (!f.ok) {
    if (f.curlCode === 6) {
      if (!quiet) c.err(`Resolving ${host} (${host})... failed: Name or service not known.\nwget: unable to resolve host address ‘${host}’\n`);
      return 4;
    }
    if (!quiet) c.err(`Resolving ${host} (${host})... ${sys.ipAddr}\nConnecting to ${host} (${host})|${sys.ipAddr}|:${https ? 443 : 80}... failed: Connection refused.\n`);
    return 4;
  }
  if (!quiet) c.err(`Resolving ${host} (${host})... ${f.ip}\nConnecting to ${host} (${host})|${f.ip}|:${https ? 443 : 80}... connected.\nHTTP request sent, awaiting response... ${f.status} ${statusText(f.status!)}\n`);
  if (f.status! >= 400) {
    if (!quiet) c.err(`${stamp}  ERROR ${f.status}: ${statusText(f.status!)}.\n`);
    return 8;
  }
  const body = f.body ?? '';
  const size = f.size ?? body.length;
  if (o.has('n')) {
    if (!quiet) c.err('Remote file exists.\n');
    return 0;
  }
  const urlPath = full.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  const base = !urlPath || urlPath.endsWith('/') ? 'index.html' : basename(urlPath);
  const target = o.val('O') ?? base;
  if (target === '-') {
    c.out(body);
    return 0;
  }
  let dest = target;
  if (o.val('P')) dest = o.val('P')!.replace(/\/$/, '') + '/' + target;
  if (!o.val('O')) {
    // wget evita sobrescribir: añade .1, .2…
    let n = 0;
    let cand = dest;
    while (c.fs.exists(c.abs(cand))) cand = `${dest}.${++n}`;
    dest = cand;
  }
  try {
    if (o.val('P')) c.fs.mkdirp(c.abs(o.val('P')!), 0o755, c.cred);
    const node = c.fs.writeFile(c.abs(dest), body, { cred: c.cred });
    if (f.size && f.size > body.length) node.size = f.size;
  } catch (e) {
    c.err(`${dest}: ${(e as Error).message}\n\nCannot write to ‘${dest}’ (${(e as Error).message}).\n`);
    return 3;
  }
  if (!quiet) {
    c.err(`Length: ${size} (${humanSize(size)}) [${f.type}]\nSaving to: ‘${dest}’\n\n${dest.padEnd(20)} 100%[===================>] ${humanSize(size).padStart(6)}  --.-KB/s    in 0s\n\n${stamp} (${(size / 1024 / 0.02 / 1024).toFixed(1)} MB/s) - ‘${dest}’ saved [${size}/${size}]\n\n`);
  }
  return 0;
});

// ───────────────────────── ip / ifconfig / ss / netstat ─────────────────────────

defineCommand('ip', {
  summary: 'Muestra y configura interfaces, direcciones y rutas de red',
  usage: 'ip [-br] addr|link|route|neigh',
  category: 'redes',
  level: 2,
  options: [['a / addr', 'Direcciones IP de cada interfaz'], ['r / route', 'Tabla de rutas'], ['link', 'Interfaces físicas'], ['neigh', 'Tabla ARP'], ['-br', 'Salida breve']],
  examples: [['ip a', 'Mis direcciones'], ['ip -br a', 'Resumen compacto'], ['ip r', 'Ruta por defecto']],
}, (c) => {
  const brief = c.args.includes('-br') || c.args.includes('-brief') || c.args.includes('-b');
  const args = c.args.filter((a) => !a.startsWith('-'));
  const obj = args[0] ?? 'addr';
  const sys = c.sh.sys;
  if ('address'.startsWith(obj) && obj.length >= 1 && ['a', 'ad', 'add', 'addr', 'addre', 'addres', 'address'].includes(obj)) {
    if (brief) {
      c.out(`lo               UNKNOWN        127.0.0.1/8 ::1/128 \neth0             UP             ${sys.ipAddr}/24 fe80::42:acff:fe11:2/64 \n`);
      return 0;
    }
    const only4 = c.args.includes('-4');
    const only6 = c.args.includes('-6');
    const dev = args.slice(1).find((a) => a !== 'show' && a !== 'list' && a !== 'dev');
    const ifaces = [
      { name: 'lo', head: '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000', link: '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00', v4: '    inet 127.0.0.1/8 scope host lo', v6: '    inet6 ::1/128 scope host noprefixroute ', life4: 'forever preferred_lft forever', life6: 'forever preferred_lft forever' },
      { name: 'eth0', head: '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000', link: `    link/ether ${sys.mac} brd ff:ff:ff:ff:ff:ff`, v4: `    inet ${sys.ipAddr}/24 brd 192.168.1.255 scope global dynamic eth0`, v6: '    inet6 fe80::42:acff:fe11:2/64 scope link ', life4: '84321sec preferred_lft 84321sec', life6: 'forever preferred_lft forever' },
    ].filter((i) => !dev || i.name === dev);
    if (dev && !ifaces.length) {
      c.err(`Device "${dev}" does not exist.\n`);
      return 1;
    }
    const lines: string[] = [];
    for (const i of ifaces) {
      lines.push(i.head, i.link);
      if (!only6) lines.push(i.v4, `       valid_lft ${i.life4}`);
      if (!only4) lines.push(i.v6, `       valid_lft ${i.life6}`);
    }
    c.out(lines.join('\n') + '\n');
    return 0;
  }
  if (['r', 'ro', 'route'].includes(obj)) {
    c.out(`default via ${sys.gateway} dev eth0 proto dhcp src ${sys.ipAddr} metric 100 \n192.168.1.0/24 dev eth0 proto kernel scope link src ${sys.ipAddr} metric 100 \n`);
    return 0;
  }
  if (['l', 'li', 'link'].includes(obj)) {
    if (brief) c.out(`lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> \neth0             UP             ${sys.mac} <BROADCAST,MULTICAST,UP,LOWER_UP> \n`);
    else c.out(`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether ${sys.mac} brd ff:ff:ff:ff:ff:ff\n`);
    return 0;
  }
  if (['n', 'neigh', 'neighbour', 'neighbor'].includes(obj)) {
    c.out(`${sys.gateway} dev eth0 lladdr 52:54:00:12:35:02 REACHABLE \n192.168.1.10 dev eth0 lladdr 52:54:00:ab:cd:ef STALE \n`);
    return 0;
  }
  c.err(`Object "${obj}" is unknown, try "ip help".\n`);
  return 1;
});

defineCommand('ifconfig', {
  summary: 'Muestra la configuración de las interfaces (comando clásico)',
  usage: 'ifconfig [INTERFAZ]',
  category: 'redes',
  package: 'net-tools',
  level: 2,
  examples: [['ifconfig eth0', 'Datos de eth0']],
}, (c) => {
  const sys = c.sh.sys;
  c.out(`eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet ${sys.ipAddr}  netmask 255.255.255.0  broadcast 192.168.1.255\n        inet6 fe80::42:acff:fe11:2  prefixlen 64  scopeid 0x20<link>\n        ether ${sys.mac}  txqueuelen 1000  (Ethernet)\n        RX packets 184220  bytes 201447123 (201.4 MB)\n        RX errors 0  dropped 0  overruns 0  frame 0\n        TX packets 91022  bytes 12011042 (12.0 MB)\n        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        inet6 ::1  prefixlen 128  scopeid 0x10<host>\n        loop  txqueuelen 1000  (Local Loopback)\n        RX packets 2210  bytes 190122 (190.1 KB)\n        TX packets 2210  bytes 190122 (190.1 KB)\n\n`);
});

function socketRows(c: Ctx, showProc: boolean, tcp: boolean, udp: boolean, listenOnly: boolean) {
  const sys = c.sh.sys;
  const root = c.cred.name === 'root';
  const rows: { proto: string; state: string; local: string; peer: string; proc: string; pid: number; port: number }[] = [];
  if (udp) rows.push({ proto: 'udp', state: 'UNCONN', local: '127.0.0.53%lo:53', peer: '0.0.0.0:*', proc: 'systemd-resolve', pid: 455, port: 53 });
  if (tcp) {
    for (const l of sys.listening()) rows.push({ proto: 'tcp', state: 'LISTEN', local: `${l.addr}${l.addr === '127.0.0.53' ? '%lo' : ''}:${l.port}`, peer: '0.0.0.0:*', proc: l.proc, pid: l.pid, port: l.port });
    for (const p of sys.procs.values()) {
      const m = /http\.server\s+(\d+)/.exec(p.command);
      if (m) rows.push({ proto: 'tcp', state: 'LISTEN', local: `0.0.0.0:${m[1]}`, peer: '0.0.0.0:*', proc: 'python3', pid: p.pid, port: parseInt(m[1], 10) });
    }
    if (!listenOnly) rows.push({ proto: 'tcp', state: 'ESTAB', local: `${sys.ipAddr}:22`, peer: '192.168.1.77:51234', proc: 'sshd', pid: 1560, port: 22 });
  }
  void showProc;
  void root;
  return rows;
}

defineCommand('ss', {
  summary: 'Muestra los sockets (conexiones y puertos en escucha)',
  usage: 'ss [-tulnp]',
  category: 'redes',
  level: 3,
  options: [['-t', 'TCP'], ['-u', 'UDP'], ['-l', 'Solo los que escuchan'], ['-n', 'Números, sin resolver nombres'], ['-p', 'Muestra el proceso (requiere sudo)'], ['-a', 'Todos']],
  examples: [['ss -tuln', 'Puertos en escucha'], ['sudo ss -tulpn', 'Con el proceso dueño de cada puerto']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'tulnpaesrH4' });
  const tcp = o.has('t') || (!o.has('u'));
  const udp = o.has('u') || (!o.has('t'));
  const rows = socketRows(c, o.has('p'), tcp && (o.has('t') || !o.has('u')), udp && (o.has('u') || !o.has('t') && false), o.has('l'));
  const t: string[][] = [['Netid', 'State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', ...(o.has('p') ? ['Process'] : [])]];
  const root = c.cred.name === 'root';
  const sel = o.has('t') || o.has('u') ? rows : rows;
  for (const r of sel) {
    t.push([r.proto, r.state, '0', r.state === 'LISTEN' ? '4096' : '0', r.local, r.peer, ...(o.has('p') ? [root ? `users:(("${r.proc}",pid=${r.pid},fd=3))` : ''] : [])]);
  }
  c.out(table(t, ['l', 'l', 'r', 'r', 'r', 'r', 'l']).replace(/^(\S+\s+\S+)\s+(\d+)\s+(\d+)\s+/gm, (_m, a, b, d) => `${a} ${b.padStart(6)} ${d.padStart(6)} `));
});

defineCommand('netstat', {
  summary: 'Muestra conexiones de red y puertos (comando clásico)',
  usage: 'netstat [-tulnp]',
  category: 'redes',
  package: 'net-tools',
  level: 3,
  examples: [['sudo netstat -tulpn', 'Puertos y procesos']],
}, (c) => {
  const o = parseOpts(c, c.args, { flags: 'tulnpaerc' });
  const rows = socketRows(c, o.has('p'), true, true, o.has('l'));
  const root = c.cred.name === 'root';
  const t: string[][] = [['Proto', 'Recv-Q', 'Send-Q', 'Local Address', 'Foreign Address', 'State', ...(o.has('p') ? ['PID/Program name'] : [])]];
  for (const r of rows) {
    if (r.proto === 'udp' && !o.has('u')) continue;
    t.push([r.proto, '0', '0', r.local.replace('%lo', ''), r.peer === '0.0.0.0:*' ? '0.0.0.0:*' : r.peer, r.proto === 'udp' ? '' : r.state, ...(o.has('p') ? [root ? `${r.pid}/${r.proc}` : '-'] : [])]);
  }
  c.out('Active Internet connections (only servers)\n' + table(t));
});

// ───────────────────────── DNS ─────────────────────────

defineCommand('dig', {
  summary: 'Consulta registros DNS',
  usage: 'dig [@servidor] NOMBRE [TIPO] [+short]',
  category: 'redes',
  package: 'dnsutils',
  level: 3,
  options: [['+short', 'Solo la respuesta'], ['MX / TXT / NS', 'Tipo de registro']],
  examples: [['dig example.com', 'Consulta completa'], ['dig +short example.com', 'Solo la IP'], ['dig MX gmail.com', 'Servidores de correo']],
}, (c) => {
  const short = c.args.includes('+short');
  const args = c.args.filter((a) => !a.startsWith('+') && !a.startsWith('@'));
  const name = args.find((a) => !/^(A|AAAA|MX|TXT|NS|CNAME|SOA|ANY)$/i.test(a));
  const type = (args.find((a) => /^(A|AAAA|MX|TXT|NS|CNAME|SOA|ANY)$/i.test(a)) ?? 'A').toUpperCase();
  if (!name) return 0;
  const r = resolveHost(c.sh.sys, c.fs, name);
  if (short) {
    if (type === 'MX') c.out('10 aspmx.l.google.com.\n20 alt1.aspmx.l.google.com.\n');
    else if (r) c.out(r.ip + '\n');
    return 0;
  }
  const status = r ? 'NOERROR' : 'NXDOMAIN';
  c.out(`\n; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> ${name}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: 38211\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${r ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${name}.\t\t\tIN\t${type}\n\n`);
  if (r) c.out(`;; ANSWER SECTION:\n${name}.\t\t300\tIN\t${type === 'MX' ? 'MX\t10 aspmx.l.google.com.' : 'A\t' + r.ip}\n\n`);
  c.out(`;; Query time: 23 msec\n;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)\n;; WHEN: ${strftime('%a %b %e %H:%M:%S UTC %Y', c.sh.sys.clock.now)}\n;; MSG SIZE  rcvd: 56\n\n`);
  return 0;
});

defineCommand('nslookup', { summary: 'Consulta DNS interactiva (modo simple)', usage: 'nslookup NOMBRE', category: 'redes', package: 'dnsutils', level: 3, examples: [['nslookup google.com', 'IP de Google']] }, (c) => {
  const name = c.args[0];
  if (!name) return 0;
  const r = resolveHost(c.sh.sys, c.fs, name);
  c.out('Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\n');
  if (!r) {
    c.out(`** server can't find ${name}: NXDOMAIN\n\n`);
    return 1;
  }
  c.out(`Non-authoritative answer:\nName:\t${name}\nAddress: ${r.ip}\n\n`);
});

defineCommand('host', { summary: 'Resuelve nombres DNS de forma sencilla', usage: 'host NOMBRE', category: 'redes', package: 'dnsutils', level: 3, examples: [['host google.com', 'google.com has address …']] }, (c) => {
  const name = c.args[0];
  if (!name) return 1;
  const r = resolveHost(c.sh.sys, c.fs, name);
  if (!r) {
    c.out(`Host ${name} not found: 3(NXDOMAIN)\n`);
    return 1;
  }
  c.out(isIp(name) ? `${name.split('.').reverse().join('.')}.in-addr.arpa domain name pointer ${r.site?.host ?? 'unknown'}.\n` : `${name} has address ${r.ip}\n`);
});

defineCommand('traceroute', { summary: 'Muestra la ruta que siguen los paquetes hasta un destino', usage: 'traceroute DESTINO', category: 'redes', package: 'traceroute', level: 3, examples: [['traceroute google.com', 'Saltos hasta Google']] }, (c) => {
  const o = parseOpts(c, c.args, { flags: 'nIT', values: 'mqwf' });
  const host = o.rest[0];
  const r = host ? resolveHost(c.sh.sys, c.fs, host) : null;
  if (!r) {
    c.err(`${host}: Name or service not known\nCannot handle "host" cmdline arg \`${host}' on position 1 (argc 1)\n`);
    return 2;
  }
  c.out(`traceroute to ${host} (${r.ip}), 30 hops max, 60 byte packets\n 1  router.local (192.168.1.1)  1.2 ms  1.1 ms  1.0 ms\n 2  10.20.0.1 (10.20.0.1)  8.4 ms  8.2 ms  8.9 ms\n 3  core1.isp.net (81.34.12.5)  12.3 ms  12.1 ms  12.7 ms\n 4  ${host} (${r.ip})  ${(r.site?.latency ?? 20).toFixed(1)} ms  ${(r.site?.latency ?? 20).toFixed(1)} ms  ${(r.site?.latency ?? 20).toFixed(1)} ms\n`);
});

defineCommand('nc', { summary: 'Abre conexiones TCP/UDP (netcat); útil para probar puertos', usage: 'nc -zv HOST PUERTO', category: 'redes', level: 4, examples: [['nc -zv server.local 22', 'Comprueba si el puerto 22 está abierto']] }, (c) => {
  const o = parseOpts(c, c.args, { flags: 'zvulkn', values: 'wp' });
  const [host, port] = o.rest;
  if (!host || !port) return c.fail('usage: nc [-options] hostname port[s]', 1);
  const r = resolveHost(c.sh.sys, c.fs, host);
  if (!r) {
    c.err(`nc: getaddrinfo for host "${host}" port ${port}: Name or service not known\n`);
    return 1;
  }
  const p = parseInt(port, 10);
  const open = isLocal(c.sh.sys, r.ip) ? c.sh.sys.listening().some((l) => l.port === p) : !!r.site && r.site.up !== false && ((p === 22 && !!r.site.ssh) || p === 80 || (p === 443 && !!r.site.https));
  if (open) {
    if (o.has('v')) c.err(`Connection to ${host} ${port} port [tcp/*] succeeded!\n`);
    return 0;
  }
  if (o.has('v')) c.err(`nc: connect to ${host} port ${port} (tcp) failed: Connection refused\n`);
  return 1;
});

defineCommand('nmap', { summary: 'Escáner de puertos y servicios', usage: 'nmap [HOST]', category: 'redes', package: 'nmap', level: 4, examples: [['nmap localhost', 'Puertos abiertos locales']] }, (c) => {
  const host = c.args.filter((a) => !a.startsWith('-'))[0] ?? 'localhost';
  const r = resolveHost(c.sh.sys, c.fs, host);
  if (!r) return c.fail(`Failed to resolve "${host}".`);
  const ports = isLocal(c.sh.sys, r.ip) ? c.sh.sys.listening().filter((l) => l.port !== 53).map((l) => l.port) : r.site?.ssh ? [22, 80] : r.site ? [80, 443] : [];
  c.out(`Starting Nmap 7.94 ( https://nmap.org ) at ${strftime('%Y-%m-%d %H:%M UTC', c.sh.sys.clock.now)}\nNmap scan report for ${host} (${r.ip})\nHost is up (0.00012s latency).\n${ports.length ? 'PORT   STATE SERVICE\n' + ports.map((p) => `${String(p) + '/tcp'.padEnd(0)}`.padEnd(7) + 'open  ' + ({ 22: 'ssh', 80: 'http', 443: 'https' } as Record<number, string>)[p]).join('\n') + '\n' : 'All 1000 scanned ports are closed\n'}\nNmap done: 1 IP address (1 host up) scanned in 0.05 seconds\n`);
});

// ───────────────────────── ssh / scp / rsync ─────────────────────────

function remoteWorld(c: Ctx, host: string, ip: string): World {
  const sys = c.sh.sys;
  let w = sys.remotes.get(ip) as World | undefined;
  if (!w) {
    w = createWorld({
      hostname: host.split('.')[0],
      instant: c.sh.rt.timeScale === 0,
      files: {
        '/home/alumno/welcome.txt': 'Bienvenido al servidor remoto.\nAquí puedes practicar ssh, scp y rsync.\n',
        '/home/alumno/backups/': { dir: true },
        '/home/alumno/notes.txt': 'Notas del servidor\n',
        '/var/www/html/index.html': '<h1>server.local</h1>\n',
        '/srv/data/inventario.csv': 'item,cantidad\ntornillos,120\ntuercas,80\n',
      },
    });
    w.rt.editor = c.sh.rt.editor;
    sys.remotes.set(ip, w);
  }
  return w;
}

async function knownHostsCheck(c: Ctx, host: string, ip: string): Promise<boolean> {
  const kh = `${c.sh.home()}/.ssh/known_hosts`;
  let content = '';
  try {
    content = c.fs.readFile(kh, null);
  } catch { /* nuevo */ }
  if (content.includes(host) || content.includes(ip)) return true;
  c.err(`The authenticity of host '${host} (${ip})' can't be established.\nED25519 key fingerprint is SHA256:Yk3pGq0mY7VnQf1xT8b2uJ9eH4sLwZaD6cRoNtXvIeM.\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `);
  const ans = await c.stdin.readLine();
  if (ans === null || !/^(yes|y)$/i.test(ans.trim())) {
    c.err('Host key verification failed.\n');
    return false;
  }
  c.err(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`);
  try {
    c.fs.mkdirp(`${c.sh.home()}/.ssh`, 0o700, c.cred);
    c.fs.writeFile(kh, `${host},${ip} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk3pGq0mY7VnQf1xT8b2uJ9eH4sLwZaD6cRoNtXvIeM\n`, { append: true, cred: c.cred, mode: 0o600 });
  } catch { /* sin permiso */ }
  return true;
}

/** ¿Alguna clave pública local está autorizada para ese usuario en el servidor? */
function keyAuth(c: Ctx, w: World, user: string): boolean {
  let pubs: string[] = [];
  try {
    const dir = `${c.sh.home()}/.ssh`;
    pubs = c.fs
      .readdir(dir, c.cred)
      .filter((f) => f.endsWith('.pub'))
      .map((f) => c.fs.readFile(`${dir}/${f}`, c.cred).trim().split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    return false;
  }
  const home = w.sys.user(user)?.home;
  if (!pubs.length || !home) return false;
  try {
    const ak = w.fs.readFile(`${home}/.ssh/authorized_keys`, null);
    return pubs.some((k) => ak.includes(k));
  } catch {
    return false;
  }
}

defineCommand('ssh', {
  summary: 'Conecta de forma segura a otro equipo (Secure Shell)',
  usage: 'ssh [-p PUERTO] [USUARIO@]HOST [COMANDO]',
  category: 'redes',
  noHelp: true,
  level: 2,
  options: [['-p N', 'Puerto'], ['-i CLAVE', 'Archivo de clave privada'], ['-l USER', 'Usuario'], ['-v', 'Detallado'], ['exit', 'Cierra la sesión remota']],
  examples: [['ssh alumno@server.local', 'Entra al servidor'], ['ssh server.local "uptime"', 'Ejecuta un comando remoto'], ['ssh-keygen -t ed25519', 'Crea un par de claves']],
}, async (c) => {
  if (c.args.includes('-V')) {
    c.err('OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13 30 Jan 2024\n');
    return 0;
  }
  const o = parseOpts(c, c.args, { flags: 'vqtTNfnxXACgy46', values: 'pilojFLRDEJbcmeBOS', stopAtOperand: true });
  let target = o.rest[0];
  if (!target) {
    c.err('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file] [-e escape_char]\n           [-F configfile] [-I pkcs11] [-i identity_file] [-J destination]\n           [-L address] [-l login_name] [-m mac_spec] [-O ctl_cmd] [-o option]\n           [-p port] [-Q query_option] [-R address] [-S ctl_path] [-W host:port]\n           [-w local_tun[:remote_tun]] destination [command [argument ...]]\n');
    return 255;
  }
  let user = o.val('l') ?? c.sh.user;
  const at = target.lastIndexOf('@');
  if (at >= 0) {
    user = target.slice(0, at);
    target = target.slice(at + 1);
  }
  // alias de ~/.ssh/config
  let hostname = target;
  let port = o.val('p') ? parseInt(o.val('p')!, 10) : 22;
  try {
    const cfg = c.fs.readFile(`${c.sh.home()}/.ssh/config`, c.cred);
    const blocks = cfg.split(/^Host\s+/m).slice(1);
    for (const b of blocks) {
      const [names, ...rest] = b.split('\n');
      if (names.trim().split(/\s+/).includes(target)) {
        for (const l of rest) {
          const m = /^\s*(\w+)\s+(.+)$/.exec(l);
          if (!m) continue;
          if (m[1] === 'HostName') hostname = m[2].trim();
          if (m[1] === 'User' && at < 0) user = m[2].trim();
          if (m[1] === 'Port' && !o.val('p')) port = parseInt(m[2], 10);
        }
      }
    }
  } catch { /* sin config */ }
  const sys = c.sh.sys;
  const r = resolveHost(sys, c.fs, hostname);
  if (!r) {
    c.err(`ssh: Could not resolve hostname ${hostname}: Name or service not known\n`);
    return 255;
  }
  if (isLocal(sys, r.ip)) {
    if (!sys.listening().some((l) => l.port === port)) {
      c.err(`ssh: connect to host ${hostname} port ${port}: Connection refused\n`);
      return 255;
    }
    c.err('(la conexión a tu propia máquina no está soportada en el simulador)\n');
    return 255;
  }
  if (!r.site || r.site.up === false) {
    c.err(`ssh: connect to host ${hostname} port ${port}: Connection timed out\n`);
    return 255;
  }
  if (!r.site.ssh || port !== 22) {
    c.err(`ssh: connect to host ${hostname} port ${port}: Connection refused\n`);
    return 255;
  }
  if (!(await knownHostsCheck(c, hostname, r.ip))) return 255;
  const w = remoteWorld(c, hostname, r.ip);
  if (!w.sys.users.has(user)) {
    // pedir contraseña igualmente y fallar
    c.err(`${user}@${hostname}'s password: `);
    await c.stdin.readLine();
    c.err('\nPermission denied, please try again.\n');
    c.err(`${user}@${hostname}: Permission denied (publickey,password).\n`);
    return 255;
  }
  if (!keyAuth(c, w, user)) {
    c.err(`${user}@${hostname}'s password: `);
    const pw = await c.stdin.readLine();
    if (pw === null) return 255;
    c.err('\n');
  }
  const cmd = o.rest.slice(1).join(' ');
  const shell = w.shell.clone();
  shell.setUser(user);
  shell.cwd = w.sys.user(user)!.home;
  shell.setVar('PWD', shell.cwd, true);
  if (cmd) {
    return shell.runLine(cmd, { ...c.io, stdin: c.stdin });
  }
  c.out(`Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n * Documentation:  https://help.ubuntu.com\n * Management:     https://landscape.canonical.com\n\nLast login: ${strftime('%a %b %e %H:%M:%S %Y', c.sh.sys.clock.now - 86400000)} from ${sys.ipAddr}\n`);
  c.sh.rt.pendingSession = { shell, host: hostname, user };
  return 0;
});

defineCommand('sshd', {
  summary: 'Servidor SSH (demonio); con -t comprueba la configuración',
  usage: 'sudo sshd -t',
  category: 'redes',
  sbin: true,
  level: 4,
  options: [['-t', 'Comprueba la validez del archivo de configuración y sale']],
  examples: [['sudo sshd -t', 'Valida /etc/ssh/sshd_config antes de reiniciar el servicio']],
}, (c) => {
  if (c.cred.name !== 'root') return c.fail('sshd re-exec requires execution with an absolute path', 1);
  if (!c.args.includes('-t')) return c.fail('use "systemctl start ssh" para arrancar el servicio', 1);
  let cfg = '';
  try {
    cfg = c.fs.readFile('/etc/ssh/sshd_config', null);
  } catch {
    c.err('sshd: /etc/ssh/sshd_config: No such file or directory\n');
    return 255;
  }
  const bad = cfg.split('\n').findIndex((l) => /^\s*PermitRootLogin\s+(?!yes$|no$|prohibit-password$|forced-commands-only$)\S+/.test(l));
  if (bad >= 0) {
    c.err(`/etc/ssh/sshd_config line ${bad + 1}: unsupported option or value\n`);
    return 255;
  }
  return 0;
});

defineCommand('ssh-keygen', {
  summary: 'Genera pares de claves SSH',
  usage: 'ssh-keygen [-t tipo] [-C comentario] [-f archivo]',
  category: 'redes',
  level: 3,
  examples: [['ssh-keygen -t ed25519 -C "mi@correo"', 'Crea ~/.ssh/id_ed25519 y .pub']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'qNy', values: 'tCfbNP' });
  const type = o.val('t') ?? 'ed25519';
  const dir = `${c.sh.home()}/.ssh`;
  const file = o.val('f') ?? `${dir}/id_${type}`;
  c.out(`Generating public/private ${type} key pair.\n`);
  if (!o.val('f')) c.out(`Enter file in which to save the key (${file}): `);
  if (!o.val('f')) c.out('\n');
  if (c.fs.exists(c.abs(file))) {
    c.out(`${file} already exists.\nOverwrite (y/n)? `);
    const a = await c.stdin.readLine();
    if (a === null || !/^y/i.test(a)) return 1;
  }
  if (o.val('N') === undefined) {
    c.out('Enter passphrase (empty for no passphrase): \nEnter same passphrase again: \n');
    if (c.stdin.isTTY) { await c.stdin.readLine(); await c.stdin.readLine(); }
  }
  const rnd = fakeRand(file + c.sh.sys.clock.now);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const rs = (n: number) => Array.from({ length: n }, () => chars[Math.floor(rnd() * 64)]).join('');
  try {
    c.fs.mkdirp(dirname(c.abs(file)), 0o700, c.cred);
    c.fs.writeFile(c.abs(file), `-----BEGIN OPENSSH PRIVATE KEY-----\n${rs(70)}\n${rs(70)}\n${rs(44)}\n-----END OPENSSH PRIVATE KEY-----\n`, { cred: c.cred, mode: 0o600 });
    c.fs.writeFile(c.abs(file + '.pub'), `ssh-${type} AAAAC3NzaC1lZDI1NTE5AAAAI${rs(43)} ${o.val('C') ?? `${c.sh.user}@${c.sh.sys.hostname}`}\n`, { cred: c.cred, mode: 0o644 });
  } catch (e) {
    return c.fsfail(e, file);
  }
  c.out(`Your identification has been saved in ${file}\nYour public key has been saved in ${file}.pub\nThe key fingerprint is:\nSHA256:${rs(43)} ${o.val('C') ?? `${c.sh.user}@${c.sh.sys.hostname}`}\nThe key's randomart image is:\n+--[ED25519 256]--+\n|   .o+=*+.       |\n|    ..o+= .      |\n|   o . =.* .     |\n+----[SHA256]-----+\n`);
  return 0;
});

defineCommand('ssh-copy-id', { summary: 'Instala tu clave pública en un servidor', usage: 'ssh-copy-id USER@HOST', category: 'redes', level: 3, examples: [['ssh-copy-id alumno@server.local', 'Permite entrar sin contraseña']] }, async (c) => {
  const target = c.args.filter((a) => !a.startsWith('-')).pop();
  if (!target) return c.fail('usage: ssh-copy-id [-h|-?|-f|-n|-s] [-i [identity_file]] [-p port] [-F alternative ssh_config_file] [[-o <ssh -o options>] ...] [user@]hostname');
  const pubs = (() => {
    try { return c.fs.readdir(`${c.sh.home()}/.ssh`, c.cred).filter((f) => f.endsWith('.pub')); } catch { return []; }
  })();
  if (!pubs.length) {
    c.err('/usr/bin/ssh-copy-id: ERROR: No identities found\n');
    return 1;
  }
  const host = target.split('@').pop()!;
  const user = target.includes('@') ? target.split('@')[0] : c.sh.user;
  const r = resolveHost(c.sh.sys, c.fs, host);
  if (!r?.site?.ssh) { c.err(`ssh: connect to host ${host} port 22: Connection refused\n`); return 1; }
  c.out(`/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "${c.sh.home()}/.ssh/${pubs[0]}"\n`);
  if (!(await knownHostsCheck(c, host, r.ip))) return 1;
  const w = remoteWorld(c, host, r.ip);
  if (!w.sys.users.has(user)) { c.err(`${user}@${host}: Permission denied (publickey,password).\n`); return 1; }
  if (keyAuth(c, w, user)) {
    c.out('/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed\n/usr/bin/ssh-copy-id: WARNING: All keys were skipped because they already exist on the remote system.\n\t\t(if you think this is a mistake, you may want to use -f option)\n\n');
    return 0;
  }
  c.err(`${user}@${host}'s password: `);
  const pw = await c.stdin.readLine();
  if (pw === null) return 1;
  c.err('\n');
  const rhome = w.sys.user(user)!.home;
  const rcred = w.sys.cred(user);
  const pub = c.fs.readFile(`${c.sh.home()}/.ssh/${pubs[0]}`, c.cred);
  try {
    w.fs.mkdirp(`${rhome}/.ssh`, 0o700, rcred);
    w.fs.writeFile(`${rhome}/.ssh/authorized_keys`, pub.endsWith('\n') ? pub : pub + '\n', { append: true, cred: rcred, mode: 0o600 });
  } catch { /* sin permiso */ }
  c.out(`\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh '${target}'"\nand check to make sure that only the key(s) you wanted were added.\n\n`);
});

function parseRemote(spec: string): { user?: string; host?: string; path: string } {
  const m = /^(?:([^@:/]+)@)?([^:/]+):(.*)$/.exec(spec);
  if (!m) return { path: spec };
  return { user: m[1], host: m[2], path: m[3] || '.' };
}

function copyNodeBetween(src: Ctx, sfs: import('../vfs').VFS, spath: string, dfs: import('../vfs').VFS, dpath: string, recursive: boolean, owner: string, cred: import('../vfs').Cred | null, log: (name: string, size: number) => void): number {
  const n = sfs.stat(spath, null);
  if (!n) return 1;
  if (n.kind === 'dir') {
    if (!recursive) return 2;
    if (!dfs.exists(dpath)) dfs.mkdir(dpath, n.mode, cred);
    for (const name of sfs.readdir(spath, null)) copyNodeBetween(src, sfs, `${spath}/${name}`, dfs, `${dpath}/${name}`, recursive, owner, cred, log);
    return 0;
  }
  const w = dfs.writeFile(dpath, n.content, { cred, mode: n.mode });
  w.size = n.size;
  log(dpath, sfs.sizeOf(n));
  void owner;
  return 0;
}

defineCommand('scp', {
  summary: 'Copia archivos de forma segura entre equipos',
  usage: 'scp [-r] ORIGEN DESTINO   (usuario@host:ruta)',
  category: 'redes',
  level: 3,
  options: [['-r', 'Recursivo'], ['-P N', 'Puerto'], ['-q', 'Silencioso']],
  examples: [['scp informe.txt alumno@server.local:~/', 'Sube un archivo'], ['scp alumno@server.local:welcome.txt .', 'Descarga un archivo'], ['scp -r proyecto alumno@server.local:backups/', 'Sube una carpeta']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'rqCpv346B', values: 'PiFoJl' });
  if (o.rest.length < 2) {
    c.err('usage: scp [-346ABCOpqRrsTv] [-c cipher] [-D sftp_server_path] [-F ssh_config]\n           [-i identity_file] [-J destination] [-l limit] [-o ssh_option]\n           [-P port] [-S program] [-X sftp_option] source ... target\n');
    return 1;
  }
  const dest = parseRemote(o.rest[o.rest.length - 1]);
  const sources = o.rest.slice(0, -1).map(parseRemote);
  const remoteSide = dest.host ? dest : sources.find((s) => s.host);
  if (!remoteSide || (dest.host && sources.some((s) => s.host))) {
    if (!remoteSide) {
      // local a local
      return c.sh.runArgv(['cp', ...(o.has('r') ? ['-r'] : []), ...o.rest], c.io);
    }
    c.err('scp: remote to remote copy is not supported\n');
    return 1;
  }
  const r = resolveHost(c.sh.sys, c.fs, remoteSide.host!);
  if (!r) { c.err(`ssh: Could not resolve hostname ${remoteSide.host}: Name or service not known\n`); return 255; }
  if (!r.site?.ssh) { c.err(`ssh: connect to host ${remoteSide.host} port 22: Connection refused\nscp: Connection closed\n`); return 255; }
  if (!(await knownHostsCheck(c, remoteSide.host!, r.ip))) return 255;
  const w = remoteWorld(c, remoteSide.host!, r.ip);
  const user = remoteSide.user ?? c.sh.user;
  if (!w.sys.users.has(user)) { c.err(`${user}@${remoteSide.host}: Permission denied (publickey,password).\nscp: Connection closed\n`); return 255; }
  if (!keyAuth(c, w, user)) {
    c.err(`${user}@${remoteSide.host}'s password: `);
    await c.stdin.readLine();
    c.err('\n');
  }
  const rcred = w.sys.cred(user);
  const rhome = w.sys.user(user)!.home;
  const rpath = (p: string) => (p.startsWith('/') ? p : p === '~' || p === '.' ? rhome : p.startsWith('~/') ? `${rhome}/${p.slice(2)}` : `${rhome}/${p}`);
  let st = 0;
  const progress = (name: string, size: number) => {
    if (!o.has('q')) c.out(`${basename(name).padEnd(32)}100% ${String(size).padStart(5)}     ${(size / 1024 / 0.1).toFixed(1)}KB/s   00:00    \n`);
  };
  if (dest.host) {
    // subir
    for (const s of sources) {
      const abs = c.abs(s.path);
      const node = c.fs.stat(abs, c.cred);
      if (!node) { c.err(`scp: ${s.path}: No such file or directory\n`); st = 1; continue; }
      if (node.kind === 'dir' && !o.has('r')) { c.err(`scp: ${s.path}: not a regular file\n`); st = 1; continue; }
      let target = rpath(dest.path);
      const tn = w.fs.stat(target, null);
      if (tn?.kind === 'dir' || dest.path.endsWith('/') || sources.length > 1) target = `${target.replace(/\/$/, '')}/${basename(abs)}`;
      try {
        const rc = copyNodeBetween(c, c.fs, abs, w.fs, target, o.has('r'), user, rcred, progress);
        if (rc) st = 1;
      } catch (e) {
        c.err(`scp: ${dest.path}: ${(e as Error).message}\n`);
        st = 1;
      }
    }
  } else {
    // bajar
    for (const s of sources) {
      const rabs = rpath(s.path);
      const node = w.fs.stat(rabs, rcred);
      if (!node) { c.err(`scp: ${s.path}: No such file or directory\n`); st = 1; continue; }
      if (node.kind === 'dir' && !o.has('r')) { c.err(`scp: ${s.path}: not a regular file\n`); st = 1; continue; }
      let target = c.abs(dest.path);
      const tn = c.fs.stat(target, c.cred);
      if (tn?.kind === 'dir' || dest.path.endsWith('/')) target = `${target.replace(/\/$/, '')}/${basename(rabs)}`;
      try {
        copyNodeBetween(c, w.fs, rabs, c.fs, target, o.has('r'), c.sh.user, c.cred, progress);
      } catch (e) {
        c.err(`scp: ${dest.path}: ${(e as Error).message}\n`);
        st = 1;
      }
    }
  }
  return st;
});

defineCommand('rsync', {
  summary: 'Sincroniza archivos y directorios de forma eficiente',
  usage: 'rsync [-avz] ORIGEN/ DESTINO/',
  category: 'redes',
  level: 3,
  options: [['-a', 'Modo archivo (recursivo, conserva permisos y fechas)'], ['-v', 'Detallado'], ['-z', 'Comprime'], ['-n', 'Simulación (--dry-run)'], ['--delete', 'Borra en destino lo que no está en origen'], ['--progress', 'Muestra progreso']],
  examples: [['rsync -av proyecto/ respaldo/', 'Copia incremental local'], ['rsync -avz carpeta/ alumno@server.local:backups/', 'Hacia el servidor'], ['rsync -avn origen/ destino/', 'Probar sin copiar']],
}, async (c) => {
  const o = parseOpts(c, c.args, { flags: 'avzrnhuPtpgoDlc', values: 'eE', long: { '--dry-run': 'n', '--delete': 'X', '--progress': 'P', '--archive': 'a', '--verbose': 'v', '--compress': 'z', '--human-readable': 'h' }, lenient: true });
  const specs = o.rest.filter((a) => !a.startsWith('--'));
  if (specs.length < 2) return c.fail('syntax or usage error (code 1)', 1);
  const dest = parseRemote(specs[specs.length - 1]);
  const srcs = specs.slice(0, -1).map(parseRemote);
  const remote = dest.host ? dest : srcs.find((s) => s.host);
  let dfs = c.fs, sfs = c.fs;
  let dcred = c.cred, scred = c.cred;
  let destBase = c.abs(dest.path);
  let rhome = '';
  if (remote) {
    const r = resolveHost(c.sh.sys, c.fs, remote.host!);
    if (!r?.site?.ssh) { c.err(`ssh: connect to host ${remote.host} port 22: Connection refused\nrsync: connection unexpectedly closed (0 bytes received so far) [sender]\nrsync error: unexplained error (code 255) at io.c(231) [sender=3.2.7]\n`); return 255; }
    if (!(await knownHostsCheck(c, remote.host!, r.ip))) return 255;
    const w = remoteWorld(c, remote.host!, r.ip);
    const user = remote.user ?? c.sh.user;
    if (!w.sys.users.has(user)) { c.err(`${user}@${remote.host}: Permission denied (publickey,password).\n`); return 255; }
    if (!keyAuth(c, w, user)) {
      c.err(`${user}@${remote.host}'s password: `);
      await c.stdin.readLine();
      c.err('\n');
    }
    rhome = w.sys.user(user)!.home;
    const rpath = (p: string) => (p.startsWith('/') ? p : p === '~' || p === '.' ? rhome : `${rhome}/${p.replace(/^~\//, '')}`);
    if (dest.host) { dfs = w.fs; dcred = w.sys.cred(user); destBase = rpath(dest.path); }
    else { sfs = w.fs; scred = w.sys.cred(user); }
  }
  const sent: string[] = [];
  let total = 0;
  const dry = o.has('n');
  const verbose = o.has('v');
  const syncTree = (spath: string, dpath: string, rel: string) => {
    const n = sfs.stat(spath, scred);
    if (!n) return;
    if (n.kind === 'dir') {
      if (!dfs.exists(dpath) && !dry) dfs.mkdirp(dpath, n.mode, dcred);
      sent.push(rel ? rel + '/' : './');
      for (const name of sfs.readdir(spath, scred)) syncTree(`${spath}/${name}`, `${dpath}/${name}`, rel ? `${rel}/${name}` : name);
      if (o.has('X') && dfs.exists(dpath)) {
        for (const name of dfs.readdir(dpath, dcred)) if (!sfs.exists(`${spath}/${name}`)) { if (!dry) dfs.removeTree(`${dpath}/${name}`, dcred); sent.push(`deleting ${rel ? rel + '/' : ''}${name}`); }
      }
    } else {
      const ex = dfs.stat(dpath, dcred);
      if (ex && ex.content === n.content && ex.kind === 'file') return;
      if (!dry) {
        const w2 = dfs.writeFile(dpath, n.content, { cred: dcred, mode: n.mode });
        w2.mtime = n.mtime;
        w2.size = n.size;
      }
      total += sfs.sizeOf(n);
      sent.push(rel);
    }
  };
  for (const s of srcs) {
    const sp = s.host ? (s.path.startsWith('/') ? s.path : `${rhome}/${s.path.replace(/^~\//, '')}`) : c.abs(s.path);
    const trailing = s.path.endsWith('/');
    const base = basename(sp);
    if (!sfs.exists(sp)) { c.err(`rsync: [sender] link_stat "${sp}" failed: No such file or directory (2)\nrsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1338) [sender=3.2.7]\n`); return 23; }
    const sn = sfs.stat(sp, scred)!;
    if (sn.kind === 'dir') {
      if (!(o.has('a') || o.has('r'))) { c.err(`skipping directory ${s.path}\n`); continue; }
      const dp = trailing ? destBase : `${destBase.replace(/\/$/, '')}/${base}`;
      syncTree(sp.replace(/\/$/, ''), dp.replace(/\/$/, ''), trailing ? '' : base);
    } else {
      const dnode = dfs.stat(destBase, dcred);
      const dp = dnode?.kind === 'dir' || dest.path.endsWith('/') ? `${destBase.replace(/\/$/, '')}/${base}` : destBase;
      if (!dfs.exists(dirname(dp)) && !dry) dfs.mkdirp(dirname(dp), 0o755, dcred);
      syncTree(sp, dp, base);
    }
  }
  c.out(`${dry ? 'sending incremental file list\n' : 'sending incremental file list\n'}${verbose || o.has('v') ? sent.join('\n') + (sent.length ? '\n' : '') : ''}\nsent ${total + 120 * sent.length} bytes  received ${40 + sent.length * 20} bytes  ${Math.round((total + 160) / 2)}.00 bytes/sec\ntotal size is ${total}  speedup is ${total ? (total / (total + 160)).toFixed(2) : '0.00'}${dry ? ' (DRY RUN)' : ''}\n`);
  return 0;
});

// ───────────────────────── ufw ─────────────────────────

const UFW_SERVICES: Record<string, string> = { ssh: '22/tcp', http: '80/tcp', https: '443/tcp', dns: '53', ftp: '21/tcp', smtp: '25/tcp', mysql: '3306/tcp', postgresql: '5432/tcp' };

/** Normaliza una regla de ufw a `destino|ACCIÓN|origen`. Acepta `22/tcp`, `ssh`, `from IP [to any port N] [proto tcp]`… */
function parseUfwRule(action: string, tokens: string[]): string | null {
  let from = 'Anywhere';
  let dest = '';
  let port = '';
  let proto = '';
  let short = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'from') from = tokens[++i] === 'any' ? 'Anywhere' : tokens[i] ?? from;
    else if (t === 'to') dest = tokens[++i] ?? '';
    else if (t === 'port') port = tokens[++i] ?? '';
    else if (t === 'proto') proto = tokens[++i] ?? '';
    else if (t === 'in' || t === 'out') continue;
    else if (!short) short = t;
  }
  let to = '';
  if (short) {
    to = UFW_SERVICES[short.toLowerCase()] ?? short;
    if (proto && !to.includes('/') && /^\d/.test(to)) to += `/${proto}`;
  } else if (port) {
    to = proto ? `${port}/${proto}` : port;
    if (dest && dest !== 'any') to = `${dest} ${to}`;
  } else if (dest && dest !== 'any') to = dest;
  else if (from === 'Anywhere') return null;
  else to = 'Anywhere';
  return `${to}|${action}|${from}`;
}

function ufwRow(rule: string): { to: string; action: string; from: string } {
  const [to, action, from] = rule.split('|');
  return { to, action, from: from ?? 'Anywhere' };
}

defineCommand('ufw', {
  summary: 'Cortafuegos sencillo (Uncomplicated Firewall)',
  usage: 'sudo ufw enable|disable|status|allow|deny|delete REGLA',
  category: 'redes',
  package: 'ufw',
  sbin: true,
  level: 3,
  examples: [['sudo ufw allow 22/tcp', 'Permite SSH'], ['sudo ufw enable', 'Activa el cortafuegos'], ['sudo ufw status numbered', 'Reglas numeradas']],
}, (c) => {
  const sys = c.sh.sys;
  const sub = c.args[0];
  if (c.cred.name !== 'root') {
    c.err('ERROR: You need to be root to run this script\n');
    return 1;
  }
  switch (sub) {
    case 'enable': sys.ufwEnabled = true; c.out('Firewall is active and enabled on system startup\n'); if (sys.services.get('ufw')) { sys.services.get('ufw')!.state = 'active'; sys.services.get('ufw')!.enabled = true; } return 0;
    case 'disable': sys.ufwEnabled = false; c.out('Firewall stopped and disabled on system startup\n'); if (sys.services.get('ufw')) { sys.services.get('ufw')!.state = 'inactive'; } return 0;
    case 'status': {
      if (!sys.ufwEnabled) { c.out('Status: inactive\n'); return 0; }
      const numbered = c.args.includes('numbered');
      const rows = sys.ufwRules.map(ufwRow);
      const head = `To${' '.repeat(25)}Action      From\n--${' '.repeat(25)}------      ----\n`;
      c.out('Status: active\n\n' + (rows.length ? head + rows.map((r, i) => `${numbered ? `[${String(i + 1).padStart(2)}] ` : ''}${r.to.padEnd(numbered ? 22 : 27)}${r.action.padEnd(12)}${r.from}`).join('\n') + '\n' : ''));
      return 0;
    }
    case 'allow': case 'deny': case 'reject': case 'limit': {
      const rule = parseUfwRule(sub.toUpperCase(), c.args.slice(1));
      if (!rule) return c.fail('ERROR: Need to give a rule', 1);
      if (sys.ufwRules.includes(rule)) {
        c.out('Skipping adding existing rule\nSkipping adding existing rule (v6)\n');
        return 0;
      }
      sys.ufwRules.push(rule);
      c.out(sys.ufwEnabled ? 'Rule added\nRule added (v6)\n' : 'Rules updated\nRules updated (v6)\n');
      return 0;
    }
    case 'delete': {
      const arg = c.args[1];
      let idx = -1;
      if (/^\d+$/.test(arg ?? '')) idx = parseInt(arg, 10) - 1;
      else if (['allow', 'deny', 'reject', 'limit'].includes(arg ?? '')) {
        const rule = parseUfwRule(arg.toUpperCase(), c.args.slice(2));
        idx = rule ? sys.ufwRules.indexOf(rule) : -1;
      }
      if (idx < 0 || idx >= sys.ufwRules.length) {
        c.err('Could not delete non-existent rule\n');
        return 0;
      }
      sys.ufwRules.splice(idx, 1);
      c.out('Rule deleted\nRule deleted (v6)\n');
      return 0;
    }
    case 'reset': sys.ufwRules = []; sys.ufwEnabled = false; c.out('Resetting all rules to installed defaults.\n'); return 0;
    default:
      c.out('Usage: ufw COMMAND\n\nCommands:\n enable                 enables the firewall\n disable                disables the firewall\n allow ARGS             add allow rule\n deny ARGS              add deny rule\n delete RULE|NUM        delete RULE\n status                 show firewall status\n');
      return sub ? 1 : 0;
  }
});

defineCommand('python3', {
  summary: 'Intérprete de Python (versión mínima del simulador)',
  usage: "python3 [--version] [-m http.server PUERTO] [-c 'print(...)']",
  category: 'scripting',
  noHelp: true,
  level: 3,
  examples: [['python3 --version', 'Python 3.12.3'], ['python3 -m http.server 8000 &', 'Servidor web en el puerto 8000'], ["python3 -c 'print(2**10)'", '1024']],
}, async (c) => {
  if (c.args[0] === '--version' || c.args[0] === '-V') {
    c.out('Python 3.12.3\n');
    return 0;
  }
  if (c.args[0] === '-m' && c.args[1] === 'http.server') {
    const port = c.args[2] && /^\d+$/.test(c.args[2]) ? parseInt(c.args[2], 10) : 8000;
    const sys = c.sh.sys;
    if (sys.listening().some((l) => l.port === port)) {
      c.err(`OSError: [Errno 98] Address already in use\n`);
      return 1;
    }
    const dir = c.args.includes('--directory') ? c.abs(c.args[c.args.indexOf('--directory') + 1]) : c.sh.cwd;
    c.out(`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...\n`);
    if (c.sh.bg && c.sh.bgJob) {
      c.sh.bgJob.endsAt = Infinity;
      const proc = sys.procs.get(c.sh.bgJob.pid);
      if (proc) proc.command = `python3 -m http.server ${port} --directory ${dir}`;
      return 0;
    }
    const p = sys.spawn(c.sh.user, `python3 -m http.server ${port} --directory ${dir}`, { ppid: c.sh.pid, tty: 'pts/0' });
    // primer plano: bloquea hasta Ctrl+C
    try {
      for (;;) await c.sh.sleep(1000);
    } catch (e) {
      sys.killProc(p.pid);
      if (e instanceof SignalEx && e.sig === 'INT') {
        c.err('\nKeyboard interrupt received, exiting.\n');
        return 0;
      }
      throw e;
    }
  }
  if (c.args[0] === '-c' && c.args[1]) {
    const m = /^\s*print\((.*)\)\s*$/s.exec(c.args[1]);
    if (m) {
      const expr = m[1].trim();
      const sm = /^(["'])(.*)\1$/s.exec(expr);
      if (sm) { c.out(sm[2] + '\n'); return 0; }
      if (/^[\d\s+\-*/().%]+$/.test(expr.replace(/\*\*/g, '^'))) {
        try {
          // eslint-disable-next-line no-new-func
          c.out(String(Function(`"use strict"; return (${expr})`)()) + '\n');
          return 0;
        } catch { /* sigue */ }
      }
    }
    c.err('  File "<string>", line 1\nSyntaxError: invalid syntax\n');
    return 1;
  }
  if (c.args[0] && !c.args[0].startsWith('-')) {
    let src: string;
    try { src = c.fs.readFile(c.abs(c.args[0]), c.cred); } catch (e) { c.err(`python3: can't open file '${c.abs(c.args[0])}': [Errno 2] No such file or directory\n`); void e; return 2; }
    for (const line of splitLines(src)) {
      const m = /^\s*print\((["'])(.*)\1\)\s*$/.exec(line);
      if (m) c.out(m[2] + '\n');
    }
    return 0;
  }
  c.out('Python 3.12.3 (main, Sep 11 2024, 14:17:37) [GCC 13.2.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n(el modo interactivo no está disponible en el simulador)\n');
  return 0;
});

export { isoFull, color, C, padStart, FsError, formatPrintf, SITES };
