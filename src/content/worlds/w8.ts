import { all, any, content, exists, exitCode, mode, not, out, outEq, ran, used } from '@/engine/check';
import { demo, fill, illus, learn, lesson, match, mc, order, practice, predict, tf, typeCmd, world } from '../build';

const INFORME = 'Informe mensual\nVentas: 4200\n';
const PROYECTO = { '/home/alumno/proyecto/a.txt': 'a\n', '/home/alumno/proyecto/docs/b.txt': 'b\n' };

export const w8 = world({
  id: 'w8',
  index: 8,
  title: 'Redes',
  subtitle: 'Conéctate, diagnostica, descarga y accede remotamente',
  emoji: '🌐',
  color: '#2DD4BF',
  level: 'avanzado',
  intro:
    'Casi todos los servidores Linux se administran **a distancia**. En esta zona aprenderás a leer tu configuración de red, diagnosticar problemas de conexión, descargar cosas de internet y manejar máquinas remotas de forma segura con SSH.',
  lessons: [
    // ───────────────────────── 1 ─────────────────────────
    lesson('w8-1', { title: 'Tu red por dentro', summary: 'ip, ss y los archivos de red', emoji: '🔌', commands: ['ip', 'ss', 'hostname'], minutes: 8 }, [
      learn('Direcciones, puertas y puertos', `
Para que un equipo hable por la red necesita:

- una **dirección IP** (quién soy en la red): \`192.168.1.50\`.
- una **puerta de enlace** o _gateway_ (por dónde salgo a otras redes): normalmente el router, \`192.168.1.1\`.
- un **servidor DNS** (para traducir nombres como \`example.com\` a IPs).

Y cada servicio que escucha usa un **puerto**: SSH el **22**, HTTP el **80**, HTTPS el **443**.

| Comando | Muestra |
|---|---|
| \`ip addr\` (\`ip a\`) | Tus interfaces y sus IPs |
| \`ip -br a\` | Lo mismo, en resumen |
| \`ip route\` | La tabla de rutas y el gateway |
| \`ss -tuln\` | Puertos que **escuchan** (TCP/UDP) |
| \`hostname -I\` | Solo tus IPs |
`, '🔌'),
      illus('net-route', 'Cómo sale un paquete', 'Del equipo al router y de ahí a internet.'),
      demo('Explorando tu red', [
        ['ip -br a', 'eth0 tiene la IP 192.168.1.50'],
        ['ip route', 'default via … = tu puerta de enlace'],
        ['hostname -I', 'Solo las direcciones'],
        ['ss -tln', 'Puertos TCP escuchando (-l listen, -t tcp, -n numérico)'],
        ['cat /etc/hosts', 'Nombres locales (antes que el DNS)'],
        ['cat /etc/resolv.conf', 'Servidor DNS que se usa'],
      ], { cwd: '/home/alumno' }),
      learn('Archivos de configuración de red', `
- \`/etc/hosts\` → tabla local nombre ↔ IP. Se consulta **antes** que el DNS.
- \`/etc/resolv.conf\` → servidores DNS.
- \`/etc/hostname\` → el nombre de tu equipo.

> NOTA: En el comando \`ss\`, las opciones se pueden juntar: **-t** TCP, **-u** UDP, **-l** solo los que escuchan, **-n** números en vez de nombres, **-p** proceso (necesita sudo).
`),
      mc('¿Qué te dice la línea `default via 192.168.1.1 dev eth0` de `ip route`?', ['Tu IP es 192.168.1.1', 'Para salir a otras redes, el tráfico va al router 192.168.1.1', 'Hay un error en eth0', 'El DNS es 192.168.1.1'], 1, '`default via X` indica la **puerta de enlace**: el siguiente salto para todo lo que no sea de tu red local.'),
      match('Une cada puerto con su servicio habitual', [['22', 'SSH'], ['80', 'HTTP'], ['443', 'HTTPS'], ['53', 'DNS']], 'Reconocer los puertos comunes acelera cualquier diagnóstico.'),
      practice({
        goal: '¿Cuál es mi IP?',
        prompt: 'Muestra las **direcciones IP** de tus interfaces en formato **breve** con el comando `ip`. Debe aparecer `192.168.1.50`.',
        check: all(used('ip'), out('192.168.1.50')),
        solution: ['ip -br a'],
        hints: ['`ip` + objeto `a` (address) + opción de formato breve.', '`ip -br a`'],
        explain: '`ip -br a` resume interfaz, estado y IPs en una línea. Sustituye al antiguo `ifconfig`.',
        par: 1,
        commands: ['ip'],
      }),
      practice({
        goal: 'Encuentra el gateway',
        prompt: 'Averigua cuál es tu **puerta de enlace** (la ruta `default`). Debe verse `192.168.1.1`.',
        check: all(any(ran('^ip (r|route)'), ran('^ip -.* (r|route)')), out('default via 192.168.1.1')),
        solution: ['ip route | grep default'],
        hints: ['Consulta la tabla de rutas y filtra la ruta por defecto.', '`ip route` (puedes filtrar con `grep default`)'],
        explain: 'Si no puedes salir a internet pero sí ver tu red local, comprueba primero que exista la ruta `default`.',
        par: 1,
        commands: ['ip'],
      }),
      practice({
        goal: '¿Qué escucha en tu equipo?',
        prompt: 'Lista los **puertos TCP que están escuchando**, con números (sin nombres). Debe aparecer el puerto **22** (SSH).',
        check: all(used('ss'), out(':22')),
        solution: ['ss -tln'],
        hints: ['Combina `-t` (TCP), `-l` (listening) y `-n` (numérico).', '`ss -tln`'],
        explain: '`ss -tuln` es lo primero que miras para saber qué servicios están expuestos en un servidor.',
        par: 1,
        commands: ['ss'],
      }),
      fill('Completa: puertos que escuchan, TCP y UDP, en números', 'ss -___', ['tuln', 'tail', 'ipa', 'route'], ['tuln'], '`-t` TCP, `-u` UDP, `-l` listening, `-n` numérico.'),
    ]),

    // ───────────────────────── 2 ─────────────────────────
    lesson('w8-2', { title: 'Diagnóstico de conexión', summary: 'ping, DNS, nc y traceroute', emoji: '🩺', commands: ['ping', 'host', 'dig', 'nslookup', 'nc'], minutes: 9 }, [
      learn('Método de diagnóstico: de cerca a lejos', `
Cuando "no hay internet", prueba por capas:

1. **¿Mi red local?** → \`ping -c 3 192.168.1.1\` (el router).
2. **¿Salgo a internet?** → \`ping -c 3 8.8.8.8\` (una IP pública, sin DNS).
3. **¿Funciona el DNS?** → \`ping -c 3 example.com\` o \`host example.com\`.
4. **¿Está abierto ese puerto?** → \`nc -zv servidor 22\`.

- \`ping\` envía paquetes ICMP y mide tiempo de respuesta. En Linux sigue **hasta Ctrl+C**, por eso se usa \`-c N\`.
- \`host\`, \`dig\` y \`nslookup\` **consultan el DNS** (vienen en el paquete \`dnsutils\`).
- \`traceroute\` muestra **todos los saltos** hasta el destino.

> CLAVE: Si \`ping 8.8.8.8\` funciona pero \`ping example.com\` no, el problema es el **DNS**, no tu conexión.
`, '🩺'),
      illus('dns-lookup', 'Cómo se resuelve un nombre', 'Tu equipo pregunta al DNS y recibe la IP.'),
      demo('Probando', [
        ['ping -c 3 192.168.1.1', 'El router responde'],
        ['ping -c 2 8.8.8.8', 'Salimos a internet'],
        ['ping -c 2 example.com', 'El DNS funciona'],
        ['ping -c 1 noexiste.invalid', 'Un nombre inexistente'],
        ['host example.com', 'La IP según el DNS'],
        ['dig +short example.com', 'Solo la respuesta'],
        ['nc -zv server.local 22', 'Puerto 22 abierto'],
        ['nc -zv server.local 3306', 'Puerto cerrado'],
      ], { cwd: '/home/alumno', packages: ['dnsutils'] }),
      mc('`ping 8.8.8.8` funciona pero `ping example.com` dice "Name or service not known". ¿Dónde está el fallo?', ['En el cable', 'En el DNS', 'En el router', 'En el firewall del servidor'], 1, 'Con la IP llegas; con el nombre no: falla la resolución de nombres (DNS).'),
      predict('¿Qué responde `host example.com`?', 'host example.com', ['example.com is an alias for 93.184.216.34', '93.184.216.34', 'example.com not found'], '`host` imprime `NOMBRE has address IP`.', { packages: ['dnsutils'] }),
      practice({
        goal: 'Comprueba tu router',
        prompt: 'Envía **exactamente 3 paquetes** de ping a tu router (**192.168.1.1**).',
        check: all(ran('^ping .*-c 3'), out('3 received')),
        solution: ['ping -c 3 192.168.1.1'],
        hints: ['`-c` limita el número de paquetes.', '`ping -c 3 192.168.1.1`'],
        explain: 'Sin `-c`, ping no termina hasta que pulses Ctrl+C. Lo normal en scripts es limitar los paquetes.',
        par: 1,
        commands: ['ping'],
      }),
      practice({
        goal: 'Salgo a internet',
        prompt: 'Comprueba que tienes salida a internet pingueando a **example.com** con **2 paquetes**. Debe haber 0 % de pérdida.',
        check: all(ran('^ping .*-c 2 example.com'), out('0% packet loss')),
        solution: ['ping -c 2 example.com'],
        hints: ['Ping con nombre; limita a 2 paquetes.', '`ping -c 2 example.com`'],
        explain: 'Si esto funciona, DNS, router y salida a internet están bien.',
        par: 1,
        commands: ['ping'],
      }),
      practice({
        goal: '¿Qué IP tiene example.com?',
        prompt: 'Consulta al **DNS** la IP de **example.com** (con `host`, `dig` o `nslookup`). Debe aparecer `93.184.216.34`.',
        setup: { packages: ['dnsutils'] },
        check: all(any(used('host'), used('dig'), used('nslookup')), out('93.184.216.34')),
        solution: ['host example.com'],
        hints: ['Tres herramientas sirven: `host`, `dig` y `nslookup`.', '`host example.com`'],
        explain: '`host` es la más simple, `dig` la más detallada (`dig +short` solo da la respuesta) y `nslookup` la clásica.',
        par: 1,
        commands: ['host', 'dig'],
      }),
      practice({
        goal: '¿Está abierto el puerto 22?',
        prompt: 'Comprueba con **netcat** (`nc`, modo `-z` sin enviar datos y `-v` detallado) si el puerto **22** de **server.local** acepta conexiones.',
        check: all(ran('^nc .*-z.* server.local 22'), exitCode(0)),
        solution: ['nc -zv server.local 22'],
        hints: ['`nc -z` solo sondea; `-v` te cuenta el resultado.', '`nc -zv server.local 22`'],
        explain: 'Es la forma rápida de saber si un servicio responde, sin necesidad de abrir una sesión.',
        par: 1,
        commands: ['nc'],
      }),
      order('Ordena: 4 paquetes de ping a google.com', ['ping', '-c', '4', 'google.com'], 'ping -c 4 google.com', 'Comando, opción de cantidad, número y destino.'),
    ]),

    // ───────────────────────── 3 ─────────────────────────
    lesson('w8-3', { title: 'curl y wget', summary: 'Descarga archivos y habla con APIs', emoji: '⬇️', commands: ['curl', 'wget'], minutes: 9 }, [
      learn('Dos navegadores sin pantalla', `
- **\`curl\`** → transfiere datos desde/hacia URLs. Por defecto **imprime en pantalla**; perfecto para APIs y para tuberías.
- **\`wget\`** → **descarga archivos** y los guarda con su nombre.

| Comando | Efecto |
|---|---|
| \`curl URL\` | Muestra el contenido |
| \`curl -I URL\` | Solo las **cabeceras** (estado HTTP) |
| \`curl -s URL\` | Silencioso (sin barra de progreso) |
| \`curl -o archivo URL\` | Guarda en \`archivo\` |
| \`curl -L URL\` | Sigue las redirecciones |
| \`curl -X POST -d "a=1" URL\` | Envía datos por POST |
| \`wget URL\` | Descarga y guarda |
| \`wget -O nombre URL\` | Guarda con otro nombre |
| \`wget -q URL\` | Silencioso |

> TIP: Con \`-w "%{http_code}"\` y \`-o /dev/null\` imprimes solo el código de estado: ideal para monitorizar.
`, '⬇️'),
      demo('Peticiones', [
        ['curl -I https://example.com', 'Cabeceras: 200 OK'],
        ['curl -s https://api.github.com/zen', 'Una API sencilla'],
        ['curl -s https://jsonplaceholder.typicode.com/users/1 | grep email', 'JSON + grep'],
        ['curl -o datos.csv http://server.local/files/data.csv', 'Guardar en archivo'],
        ['cat datos.csv', 'Lo descargado'],
        ['curl -s -o /dev/null -w "%{http_code}\\n" https://httpbin.org/status/404', 'Solo el código HTTP'],
        ['wget -q http://server.local/files/data.csv', 'wget lo guarda con su nombre'],
        ['ls', 'data.csv'],
      ], { cwd: '/home/alumno' }),
      learn('Códigos de estado HTTP', `
| Código | Significa |
|---|---|
| **200** | OK |
| **301 / 302** | Redirección (usa \`curl -L\` para seguirla) |
| **403** | Prohibido (no tienes permiso) |
| **404** | No encontrado |
| **500** | Error interno del servidor |
`),
      mc('Quieres **guardar** la respuesta de una URL en un archivo con curl. ¿Qué opción usas?', ['-I', '-o', '-s', '-L'], 1, '`-o archivo` escribe la respuesta en `archivo`. `-I` pide solo cabeceras; `-s` silencia; `-L` sigue redirecciones.'),
      match('Une cada código HTTP con su significado', [['200', 'Todo correcto'], ['301', 'Redirección permanente'], ['404', 'No encontrado'], ['500', 'Error del servidor']], 'Los códigos 2xx son éxito, 3xx redirección, 4xx culpa del cliente y 5xx del servidor.'),
      practice({
        goal: 'Mira las cabeceras',
        prompt: 'Pide **solo las cabeceras** de `https://example.com` y comprueba que responde **200 OK**.',
        check: all(used('curl', ['-I']), out('200 OK')),
        solution: ['curl -I https://example.com'],
        hints: ['La opción `-I` (i mayúscula) hace una petición HEAD.', '`curl -I https://example.com`'],
        explain: '`curl -I` es el chequeo de salud más rápido de una web: ves el código sin descargar nada.',
        par: 1,
        commands: ['curl'],
      }),
      practice({
        goal: 'Pide una frase a la API de GitHub',
        prompt: 'Obtén, **en silencio** (sin barra de progreso), el texto de `https://api.github.com/zen`.',
        check: all(used('curl', ['-s']), out('Keep it logically awesome')),
        solution: ['curl -s https://api.github.com/zen'],
        hints: ['Añade la opción de silencio.', '`curl -s https://api.github.com/zen`'],
        explain: 'Muchas APIs devuelven texto o JSON que luego procesas con `grep`, `awk` o `jq`.',
        par: 1,
        commands: ['curl'],
      }),
      practice({
        goal: 'Descarga con curl',
        prompt: 'Descarga `http://server.local/files/data.csv` y guárdalo como **datos.csv** usando `curl -o`.',
        check: content('/home/alumno/datos.csv', { includes: 'alfa' }),
        solution: ['curl -o datos.csv http://server.local/files/data.csv'],
        hints: ['`-o` + nombre de archivo + URL.', '`curl -o datos.csv http://server.local/files/data.csv`'],
        explain: 'Con `-o` eliges el nombre; con `-O` (mayúscula) curl usaría el nombre original.',
        par: 1,
        commands: ['curl'],
      }),
      practice({
        goal: 'Descarga con wget',
        prompt: 'Descarga `http://server.local/files/data.csv` con **wget** en modo silencioso (`-q`). Debe quedar `data.csv` en tu carpeta.',
        check: all(used('wget'), exists('/home/alumno/data.csv', 'file')),
        solution: ['wget -q http://server.local/files/data.csv'],
        hints: ['wget guarda con el nombre original.', '`wget -q http://server.local/files/data.csv`'],
        explain: 'wget es ideal para descargas grandes: reintenta y puede reanudar con `-c`.',
        par: 1,
        commands: ['wget'],
      }),
      practice({
        goal: 'Extrae un dato de una API',
        prompt: 'Consulta `https://jsonplaceholder.typicode.com/users/1` y **filtra solo la línea del email** con `grep`.',
        check: all(used('curl'), ran('\\|\\s*grep'), out('Sincere@april.biz')),
        solution: ['curl -s https://jsonplaceholder.typicode.com/users/1 | grep email'],
        hints: ['Silencia curl y pasa la salida a grep.', '`curl -s https://jsonplaceholder.typicode.com/users/1 | grep email`'],
        explain: 'curl + grep (o `jq`) es la navaja suiza para integrar APIs en scripts.',
        par: 1,
        commands: ['curl', 'grep'],
      }),
      practice({
        goal: 'Solo el código de estado',
        prompt: 'Imprime **únicamente el código HTTP** de `https://httpbin.org/status/404` (debe salir `404`). Usa `-s`, `-o /dev/null` y `-w "%{http_code}"`.',
        check: all(ran('-w'), outEq('404')),
        solution: ['curl -s -o /dev/null -w "%{http_code}" https://httpbin.org/status/404'],
        hints: ['Tira el cuerpo a /dev/null y pide el código con `-w`.', '`curl -s -o /dev/null -w "%{http_code}" https://httpbin.org/status/404`'],
        explain: 'Esta receta es la base de muchos scripts de monitorización: `if [ "$(curl …)" != 200 ]; then alerta; fi`.',
        par: 1,
        commands: ['curl'],
      }),
      tf('`wget URL` muestra el contenido en pantalla igual que `curl URL`.', false, '`wget` **guarda** el archivo en disco; `curl` lo imprime por stdout (salvo `-o`).'),
    ]),

    // ───────────────────────── 4 ─────────────────────────
    lesson('w8-4', { title: 'SSH: acceso remoto', summary: 'Conectar, ejecutar y usar claves', emoji: '🔑', commands: ['ssh', 'ssh-keygen', 'ssh-copy-id'], minutes: 10 }, [
      learn('Una terminal en otra máquina', `
**SSH** (_Secure Shell_) te da una terminal en un equipo remoto, con la conexión **cifrada**. Es el estándar para administrar servidores.

\`\`\`
ssh servidor                  # entra como tu mismo usuario
ssh ana@servidor              # entra como ana
ssh servidor uptime           # ejecuta UN comando y vuelve
exit                          # cierra la sesión remota
\`\`\`

La **primera vez** SSH te pregunta si confías en el servidor (guarda su "huella" en \`~/.ssh/known_hosts\`). Después te pide la **contraseña**.

> NOTA: En este simulador existe el equipo remoto **server** (\`server.local\`). Su usuario es \`alumno\` y la contraseña es **alumno**.
`, '🔑'),
      illus('ssh-handshake', 'Así se establece una conexión SSH', 'Huella del servidor, autenticación y canal cifrado.'),
      learn('Entrar sin contraseña: claves', `
Las **claves SSH** son un par de archivos:

- **Privada** (\`~/.ssh/id_ed25519\`) → **nunca** se comparte (modo 600).
- **Pública** (\`~/.ssh/id_ed25519.pub\`) → se copia al servidor.

Pasos:

\`\`\`
ssh-keygen -t ed25519      # 1. crea el par
ssh-copy-id server         # 2. instala la pública en el servidor
ssh server                 # 3. entras sin contraseña
\`\`\`

El servidor guarda tu clave pública en \`~/.ssh/authorized_keys\`.

> OJO: Si alguien consigue tu clave **privada**, puede entrar donde tú entras. Por eso debe ser \`600\`: SSH se negará a usarla si otros la pueden leer.
`),
      demo('Conectando', [
        ['ssh server hostname', 'Un comando remoto (huella → "yes", contraseña → alumno)'],
        ['ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519', 'Crea tu par de claves (sin frase de paso)'],
        ['ls -l ~/.ssh', 'La privada es 600'],
        ['ssh-copy-id server', 'Instala la clave pública (pide la contraseña una vez)'],
        ['ssh server hostname', 'Ahora entra sin contraseña'],
      ], { cwd: '/home/alumno' }),
      mc('¿Qué archivo **nunca** debes compartir?', ['~/.ssh/id_ed25519.pub', '~/.ssh/id_ed25519', '~/.ssh/known_hosts', '/etc/hosts'], 1, 'La clave privada (sin `.pub`) es tu identidad. La pública sí se puede (y se debe) copiar a los servidores.'),
      mc('¿Dónde guarda el servidor las claves públicas autorizadas?', ['~/.ssh/known_hosts', '~/.ssh/authorized_keys', '/etc/passwd', '~/.ssh/config'], 1, '`authorized_keys` lista las claves que pueden entrar. `known_hosts` es del lado cliente: los servidores en los que confías.'),
      practice({
        goal: 'Un comando remoto',
        prompt: 'Ejecuta `hostname` **en el servidor** `server` sin abrir una sesión interactiva (un solo comando `ssh`). Confirma la huella con `yes` y usa la contraseña `alumno`.',
        check: all(ran('^ssh server hostname$'), outEq('server')),
        solution: ['ssh server hostname', 'yes', 'alumno'],
        hints: ['`ssh HOST COMANDO` ejecuta y vuelve.', 'Escribe `ssh server hostname`, luego `yes` y luego la contraseña `alumno`.'],
        explain: 'Verás `server` (el nombre del equipo remoto), no `dojo`. Así se automatizan tareas en varios servidores.',
        par: 1,
        commands: ['ssh'],
      }),
      practice({
        goal: 'Sesión interactiva',
        prompt: 'Entra en `server` (huella `yes`, contraseña `alumno`), ejecuta `ls` para ver sus archivos y **sal** con `exit`.',
        check: all(ran('^ssh server$'), ran('^ls$'), ran('^exit$')),
        solution: ['ssh server', 'yes', 'alumno', 'ls', 'exit'],
        hints: ['Mira cómo cambia el prompt: `alumno@server`.', '`ssh server`, `yes`, `alumno`, `ls`, `exit`'],
        explain: 'Dentro de la sesión todo lo que escribes se ejecuta en el servidor. `exit` (o Ctrl+D) vuelve a tu máquina.',
        par: 2,
        commands: ['ssh'],
      }),
      practice({
        goal: 'Crea tu par de claves',
        prompt: 'Genera un par de claves **ed25519** en `~/.ssh/id_ed25519` **sin frase de paso** (opciones `-N ""` y `-f`).',
        check: all(exists('/home/alumno/.ssh/id_ed25519', 'file'), exists('/home/alumno/.ssh/id_ed25519.pub', 'file'), mode('/home/alumno/.ssh/id_ed25519', '600')),
        solution: ['ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519'],
        hints: ['`-t` tipo, `-N` frase de paso (vacía), `-f` archivo.', '`ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`'],
        explain: 'ed25519 es el tipo moderno recomendado: claves cortas y rápidas. La privada queda en modo 600 automáticamente.',
        par: 1,
        commands: ['ssh-keygen'],
      }),
      practice({
        goal: 'Entra sin contraseña',
        prompt: 'Crea tu par de claves, **instálalo en `server`** con `ssh-copy-id` y comprueba que `ssh server hostname` ya **no pide contraseña**.',
        check: all(ran('^ssh server hostname$'), outEq('server'), not(out('password', { stderr: true }))),
        solution: ['ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519', 'ssh-copy-id server', 'yes', 'alumno', 'ssh server hostname'],
        hints: ['Orden: `ssh-keygen`, `ssh-copy-id server` (yes + contraseña) y finalmente `ssh server hostname`.', 'La última ejecución no debe pedir contraseña.'],
        explain: 'Con la clave autorizada, la autenticación es automática. Es lo que usan los scripts y `rsync`/`scp` desatendidos.',
        par: 3,
        commands: ['ssh-keygen', 'ssh-copy-id', 'ssh'],
      }),
      fill('Completa: ejecuta `uptime` en el servidor', 'ssh server ___', ['uptime', 'exit', 'logout', '-V'], ['uptime'], 'Cualquier texto tras el host se ejecuta como comando remoto.'),
      tf('El archivo `~/.ssh/id_ed25519.pub` (clave pública) puede compartirse sin riesgo.', true, 'La pública está pensada para copiarse a los servidores. Lo secreto es la privada.'),
    ]),

    // ───────────────────────── 5 ─────────────────────────
    lesson('w8-5', { title: 'Copiar por red: scp y rsync', summary: 'Sube, baja y sincroniza archivos', emoji: '📦', commands: ['scp', 'rsync'], minutes: 8 }, [
      learn('Mover archivos entre máquinas', `
Ambos usan SSH por debajo. La sintaxis remota es \`usuario@host:ruta\` (o \`host:ruta\`).

**scp** — copia simple (como \`cp\`):

\`\`\`
scp informe.txt server:/tmp/            # subir
scp server:welcome.txt .                # bajar a la carpeta actual
scp -r proyecto server:/tmp/            # carpeta completa (-r)
\`\`\`

**rsync** — **sincroniza** solo lo que cambió (mucho más eficiente en repeticiones):

\`\`\`
rsync -av proyecto/ server:/tmp/proyecto/    # -a archivo, -v detalle
rsync -avn proyecto/ server:/tmp/proyecto/   # -n SIMULACRO (no copia nada)
rsync -av --delete origen/ destino/          # espejo exacto (borra lo sobrante)
\`\`\`

> OJO: En rsync, la **barra final** importa: \`proyecto/\` copia el **contenido**; \`proyecto\` (sin barra) copia la **carpeta entera** dentro del destino.
`, '📦'),
      demo('Transferencias', [
        ['ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519', 'Una clave para no teclear contraseñas'],
        ['ssh-copy-id server', 'Pide huella y contraseña una vez'],
        ['scp informe.txt server:/tmp/', 'Sube un archivo'],
        ['ssh server ls /tmp', 'Comprobamos en el servidor'],
        ['scp server:welcome.txt .', 'Baja un archivo'],
        ['rsync -avn proyecto/ server:/tmp/proyecto/', 'Simulacro con -n'],
        ['rsync -av proyecto/ server:/tmp/proyecto/', 'Copia real'],
      ], { cwd: '/home/alumno', files: { '/home/alumno/informe.txt': INFORME, ...PROYECTO } }),
      mc('¿Qué ventaja principal tiene `rsync` sobre `scp` al repetir una copia?', ['Es más seguro', 'Solo transfiere lo que ha cambiado', 'No necesita SSH', 'Comprime las contraseñas'], 1, 'rsync compara origen y destino y copia solo las diferencias: ahorra tiempo y ancho de banda.'),
      mc('¿Qué hace la opción `-n` (`--dry-run`) de rsync?', ['Copia más rápido', 'Muestra qué haría sin copiar nada', 'Borra el origen', 'Comprime los datos'], 1, 'Un simulacro. Úsalo siempre antes de un `--delete`.'),
      practice({
        goal: 'Sube un archivo',
        prompt: 'Copia `informe.txt` al directorio **/tmp/** de `server` con `scp`. (Huella: `yes`; contraseña: `alumno`.)',
        setup: { files: { '/home/alumno/informe.txt': INFORME } },
        check: all(ran('^scp informe.txt server:/tmp/?$'), exitCode(0)),
        solution: ['scp informe.txt server:/tmp/', 'yes', 'alumno'],
        hints: ['Origen primero, `host:ruta` después.', '`scp informe.txt server:/tmp/`, luego `yes` y `alumno`.'],
        explain: 'Si el destino es una carpeta, el archivo conserva su nombre. Sin `host:` sería una copia local.',
        par: 1,
        commands: ['scp'],
      }),
      practice({
        goal: 'Descarga un archivo',
        prompt: 'Trae `welcome.txt` (de la carpeta personal de `server`) a tu carpeta actual con `scp`.',
        check: all(exists('/home/alumno/welcome.txt', 'file'), content('/home/alumno/welcome.txt', { includes: 'Bienvenido' })),
        solution: ['scp server:welcome.txt .', 'yes', 'alumno'],
        hints: ['Ahora el remoto es el **origen**. El destino es `.`', '`scp server:welcome.txt .`'],
        explain: 'Una ruta sin `/` inicial es relativa a tu carpeta personal en el servidor.',
        par: 1,
        commands: ['scp'],
      }),
      practice({
        goal: 'Sube una carpeta entera',
        prompt: 'Copia la carpeta **proyecto** (con todo su contenido) a `/tmp/` de `server`.',
        setup: { files: PROYECTO },
        check: all(ran('^scp -r proyecto server:/tmp/?$'), exitCode(0)),
        solution: ['scp -r proyecto server:/tmp/', 'yes', 'alumno'],
        hints: ['Las carpetas necesitan la opción recursiva.', '`scp -r proyecto server:/tmp/`'],
        explain: 'Igual que `cp -r`, pero hacia otra máquina.',
        par: 1,
        commands: ['scp'],
      }),
      practice({
        goal: 'Sincroniza con rsync',
        prompt: 'Sincroniza el **contenido** de `proyecto/` con `server:/tmp/proyecto/` usando `rsync -av`.',
        setup: { files: PROYECTO },
        check: all(ran('^rsync -av proyecto/ server:/tmp/proyecto/?$'), out('a.txt')),
        solution: ['rsync -av proyecto/ server:/tmp/proyecto/', 'yes', 'alumno'],
        hints: ['`-a` conserva permisos y `-v` muestra lo que hace.', '`rsync -av proyecto/ server:/tmp/proyecto/`'],
        explain: 'Ejecútalo de nuevo y verás que ya no transfiere nada: rsync detecta que no hay diferencias.',
        par: 1,
        commands: ['rsync'],
      }),
      practice({
        goal: 'Prueba antes de copiar',
        prompt: 'Haz un **simulacro** (sin copiar nada) de la sincronización de `proyecto/` hacia `server:/tmp/p2/`. Debe aparecer `DRY RUN`.',
        setup: { files: PROYECTO },
        check: all(ran('^rsync -avn'), out('DRY RUN')),
        solution: ['rsync -avn proyecto/ server:/tmp/p2/', 'yes', 'alumno'],
        hints: ['Añade la bandera `n` a `-av`.', '`rsync -avn proyecto/ server:/tmp/p2/`'],
        explain: 'El simulacro te muestra los archivos afectados. Es obligatorio antes de usar `--delete`.',
        par: 1,
        commands: ['rsync'],
      }),
      match('Une cada herramienta con su uso', [['scp', 'Copia sencilla por SSH'], ['rsync', 'Sincronización incremental'], ['ssh', 'Terminal remota'], ['ssh-copy-id', 'Instalar tu clave en el servidor']], 'Las cuatro trabajan juntas sobre el mismo canal seguro.'),
    ]),

    // ───────────────────────── 6 ─────────────────────────
    lesson('w8-6', { title: 'Cortafuegos con ufw', summary: 'Abre y cierra puertos con seguridad', emoji: '🧱', commands: ['ufw'], minutes: 7 }, [
      learn('Solo lo imprescindible', `
Un **cortafuegos** (_firewall_) decide qué tráfico entra y sale. **ufw** (_Uncomplicated Firewall_) simplifica la configuración de Linux:

| Comando | Efecto |
|---|---|
| \`sudo ufw status\` | Estado y reglas |
| \`sudo ufw enable\` / \`disable\` | Activar / desactivar |
| \`sudo ufw allow 22/tcp\` | **Permitir** el puerto 22 TCP |
| \`sudo ufw deny 23\` | **Bloquear** el puerto 23 |
| \`sudo ufw delete allow 80\` | **Borrar** una regla |
| \`sudo ufw status numbered\` | Reglas numeradas |

La política por defecto de ufw es **denegar todo lo entrante** y permitir lo saliente. Tú abres **solo** lo necesario.

> OJO: Si activas ufw en un servidor remoto **sin permitir antes SSH (22)**, te quedas fuera. Primero \`allow 22\`, después \`enable\`.
`, '🧱'),
      demo('Montando un cortafuegos', [
        ['sudo ufw status', 'Inactivo por defecto'],
        ['sudo ufw allow 22/tcp', 'Primero, SSH'],
        ['sudo ufw allow 80/tcp', 'Y la web'],
        ['sudo ufw enable', 'Ahora sí, activar'],
        ['sudo ufw status', 'Reglas activas'],
        ['sudo ufw delete allow 80/tcp', 'Quitar una regla'],
        ['sudo ufw status', 'Solo queda SSH'],
      ], { cwd: '/home/alumno', packages: ['ufw'] }),
      mc('¿Qué debes hacer **antes** de activar ufw en un servidor al que entras por SSH?', ['Reiniciar el servidor', 'Permitir el puerto 22 (`ufw allow 22/tcp`)', 'Desinstalar ssh', 'Nada'], 1, 'Si no abres el 22 antes de activar el cortafuegos, la política "denegar entrante" cortará tu propia sesión.'),
      tf('Por defecto ufw bloquea el tráfico entrante y permite el saliente.', true, 'Esa es la política segura por defecto: tú abres solo lo que necesites.'),
      practice({
        goal: 'Abre SSH y activa',
        prompt: 'Con `ufw`: **permite el puerto 22/tcp**, **activa** el cortafuegos y **muestra su estado**. Debe verse `Status: active` y la regla `22/tcp`.',
        setup: { packages: ['ufw'] },
        check: all(ran('ufw status'), out('Status: active'), out('22/tcp')),
        solution: ['sudo ufw allow 22/tcp', 'sudo ufw enable', 'sudo ufw status'],
        hints: ['Orden: allow → enable → status.', '`sudo ufw allow 22/tcp`, `sudo ufw enable`, `sudo ufw status`'],
        explain: 'Esta secuencia (permitir SSH, activar, verificar) es el primer paso de bastionado de cualquier servidor.',
        par: 3,
        commands: ['ufw'],
      }),
      practice({
        goal: 'Bloquea telnet',
        prompt: 'Activa ufw, **bloquea el puerto 23** (telnet) y comprueba la regla en el estado (`DENY`).',
        setup: { packages: ['ufw'] },
        check: all(ran('ufw status'), out('23'), out('DENY')),
        solution: ['sudo ufw enable', 'sudo ufw deny 23', 'sudo ufw status'],
        hints: ['`deny` bloquea.', '`sudo ufw enable`, `sudo ufw deny 23`, `sudo ufw status`'],
        explain: 'Telnet envía todo sin cifrar (incluidas contraseñas): ciérralo y usa SSH.',
        par: 3,
        commands: ['ufw'],
      }),
      practice({
        goal: 'Quita una regla',
        prompt: 'Activa ufw, **permite el 80**, y luego **elimina** esa regla; comprueba que ya no aparece en el estado.',
        setup: { packages: ['ufw'] },
        check: all(ran('ufw delete'), ran('ufw status'), not(out('80'))),
        solution: ['sudo ufw enable', 'sudo ufw allow 80', 'sudo ufw delete allow 80', 'sudo ufw status'],
        hints: ['La sintaxis para borrar repite la regla: `delete allow 80`.', 'Termina con `sudo ufw status` para verificar.'],
        explain: '`ufw delete` acepta la misma sintaxis con la que creaste la regla (o su número en `status numbered`).',
        par: 4,
        commands: ['ufw'],
      }),
      fill('Completa: permitir HTTPS', 'sudo ufw ___ 443/tcp', ['allow', 'deny', 'delete', 'status'], ['allow'], '`allow` abre el puerto indicado.'),
      typeCmd('Escribe el comando que **activa** el cortafuegos (con privilegios)', ['sudo ufw enable'], '`enable` activa ufw y lo deja iniciado en el arranque.'),
    ]),
  ],
  boss: {
    goal: 'Misión: acceso remoto seguro',
    prompt:
      '**Misión del dojo** 🥋\n\nPrepara el acceso al servidor:\n\n1. Crea tu par de claves **ed25519** (sin frase de paso).\n2. Instálalo en **server** (`ssh-copy-id`; huella `yes`, contraseña `alumno`).\n3. Abre **SSH (22/tcp)** en tu cortafuegos local con ufw.\n4. Descarga `welcome.txt` de `server` como **bienvenida.txt**.',
    setup: { cwd: '/home/alumno', packages: ['ufw'] },
    check: all(
      exists('/home/alumno/.ssh/id_ed25519.pub', 'file'),
      ran('ufw allow.*22'),
      content('/home/alumno/bienvenida.txt', { includes: 'Bienvenido' }),
    ),
    solution: ['ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519', 'ssh-copy-id server', 'yes', 'alumno', 'sudo ufw allow 22/tcp', 'scp server:welcome.txt bienvenida.txt'],
    hints: ['Crea la clave con `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`.', 'Instálala con `ssh-copy-id server`.', '`sudo ufw allow 22/tcp` y `scp server:welcome.txt bienvenida.txt`.'],
    explain: '¡Zona 8 completada! Sabes diagnosticar una red, descargar, entrar a servidores con claves, transferir archivos y proteger puertos.',
    par: 5,
    commands: ['ssh-keygen', 'ssh-copy-id', 'ufw', 'scp'],
  },
});

