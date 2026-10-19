import React from 'react';
import { colors } from '@/ui/theme';
import { FlowDiagram, type FlowNode, type FlowStep } from './common';

// ───────────────────────── red: de tu PC a internet ─────────────────────────

export function NetRoute() {
  const nodes: FlowNode[] = [
    { id: 'pc', label: 'Tu PC', sub: '192.168.1.50', emoji: '💻', x: 17, y: 18, color: colors.mint },
    { id: 'router', label: 'Router', sub: 'gateway .1.1', emoji: '📡', x: 50, y: 18, color: colors.cyan },
    { id: 'isp', label: 'ISP', sub: 'tu proveedor', emoji: '🏢', x: 83, y: 18, color: colors.violet },
    { id: 'web', label: 'example.com', sub: '93.184.216.34', emoji: '🖥️', x: 50, y: 82, color: colors.amber },
    { id: 'dns', label: 'DNS', sub: '8.8.8.8', emoji: '📒', x: 83, y: 82, color: colors.rose },
  ];
  const edges: [string, string][] = [['pc', 'router'], ['router', 'isp'], ['isp', 'dns'], ['isp', 'web']];
  const steps: FlowStep[] = [
    { from: 'pc', to: 'router', packet: 'example.com?', text: 'Tu PC necesita la IP de example.com. Como el DNS no está en tu red local, el paquete sale hacia la puerta de enlace: la línea «default via 192.168.1.1» de ip route.' },
    { from: 'router', to: 'isp', packet: 'example.com?', text: 'El router (gateway) lo reenvía a tu proveedor de internet.' },
    { from: 'isp', to: 'dns', packet: '¿IP?', text: 'El servidor DNS (por ejemplo 8.8.8.8) busca el nombre…' },
    { from: 'dns', to: 'pc', packet: '93.184.216.34', active: ['dns', 'isp', 'router', 'pc'], text: '…y la respuesta (93.184.216.34) vuelve por el mismo camino hasta tu PC.' },
    { from: 'pc', to: 'web', packet: 'GET /', active: ['pc', 'router', 'isp', 'web'], text: 'Ahora tu PC ya sabe a dónde ir: la petición viaja de salto en salto (PC → router → ISP → servidor). Con traceroute ves cada salto.' },
    { from: 'web', to: 'pc', packet: '200 OK', active: ['web', 'isp', 'router', 'pc'], text: 'El servidor responde. Si algo falla, pruebas por capas: ping al router, ping a 8.8.8.8 (sin DNS) y ping a un nombre.' },
  ];
  return <FlowDiagram title="Cómo sale un paquete a internet" nodes={nodes} edges={edges} steps={steps} height={240} />;
}

// ───────────────────────── DNS ─────────────────────────

export function DnsLookup() {
  const nodes: FlowNode[] = [
    { id: 'client', label: 'Tu PC', emoji: '💻', x: 17, y: 50, color: colors.mint },
    { id: 'resolver', label: 'Resolver', sub: 'caché DNS', emoji: '🧭', x: 50, y: 50, color: colors.cyan },
    { id: 'root', label: 'Raíz  .', sub: '13 grupos', emoji: '🌍', x: 83, y: 14, color: colors.violet },
    { id: 'tld', label: '.com', sub: 'servidores TLD', emoji: '🏷️', x: 83, y: 50, color: colors.amber },
    { id: 'auth', label: 'example.com', sub: 'autoritativo', emoji: '📒', x: 83, y: 86, color: colors.rose },
  ];
  const edges: [string, string][] = [['client', 'resolver'], ['resolver', 'root'], ['resolver', 'tld'], ['resolver', 'auth']];
  const steps: FlowStep[] = [
    { from: 'client', to: 'resolver', packet: 'example.com?', text: 'Tu PC le pregunta a su resolver (el que figura en /etc/resolv.conf). Si ya lo tiene en caché, responde al instante.' },
    { from: 'resolver', to: 'root', packet: '¿.com?', text: 'Si no lo sabe, empieza por arriba: los servidores raíz. Ellos no conocen example.com, pero saben quién gestiona «.com».' },
    { from: 'resolver', to: 'tld', packet: 'example.com?', text: 'La raíz le indica los servidores de .com y el resolver les pregunta a ellos.' },
    { from: 'resolver', to: 'auth', packet: 'example.com?', text: 'Los servidores .com le dicen cuál es el servidor autoritativo de example.com. Ese sí conoce la respuesta.' },
    { from: 'auth', to: 'resolver', packet: '93.184.216.34', text: 'El servidor autoritativo responde con el registro A: la dirección IP.' },
    { from: 'resolver', to: 'client', packet: '93.184.216.34', text: 'El resolver la guarda en caché (durante el TTL) y se la entrega a tu PC. Todo esto lo puedes ver con dig example.com.' },
  ];
  return <FlowDiagram title="Cómo se traduce un nombre en una IP" nodes={nodes} edges={edges} steps={steps} height={250} />;
}

// ───────────────────────── SSH ─────────────────────────

export function SshHandshake() {
  const nodes: FlowNode[] = [
    { id: 'client', label: 'Cliente', sub: 'tu terminal', emoji: '💻', x: 17, y: 40, color: colors.mint },
    { id: 'server', label: 'Servidor', sub: 'sshd :22', emoji: '🖥️', x: 83, y: 40, color: colors.cyan },
    { id: 'known', label: 'known_hosts', sub: 'servidores conocidos', emoji: '📒', x: 17, y: 85, color: colors.amber },
    { id: 'auth', label: 'authorized_keys', sub: 'claves permitidas', emoji: '🗝️', x: 83, y: 85, color: colors.violet },
  ];
  const edges: [string, string][] = [['client', 'server'], ['client', 'known'], ['server', 'auth']];
  const steps: FlowStep[] = [
    { from: 'client', to: 'server', packet: 'TCP :22', text: 'El cliente abre una conexión TCP al puerto 22 del servidor.' },
    { from: 'server', to: 'client', packet: 'SSH-2.0', text: 'Ambos anuncian su versión del protocolo y acuerdan algoritmos de cifrado.' },
    { from: 'client', to: 'server', packet: 'clave DH', active: ['client', 'server'], text: 'Intercambio de claves (Diffie-Hellman): los dos obtienen un secreto compartido sin enviarlo nunca por la red.' },
    { from: 'server', to: 'client', packet: 'huella host', active: ['client', 'server', 'known'], text: 'El servidor demuestra quién es con su clave de host. El cliente la compara con known_hosts; si es nueva, pregunta «yes/no».' },
    { from: 'client', to: 'server', packet: 'tu clave', active: ['client', 'server', 'auth'], text: 'Te autenticas: con contraseña o con tu clave privada (el servidor busca la pública en authorized_keys).' },
    { from: 'client', to: 'server', packet: '🔒 ls -l', text: 'Desde aquí todo viaja cifrado: comandos, resultados, archivos (scp, rsync). Nadie en medio puede leerlo.' },
  ];
  return <FlowDiagram title="Así se establece una conexión SSH" nodes={nodes} edges={edges} steps={steps} height={240} />;
}

// ───────────────────────── sudo ─────────────────────────

export function SudoFlow() {
  const nodes: FlowNode[] = [
    { id: 'you', label: 'Tú', sub: 'alumno', emoji: '🧑', x: 17, y: 20, color: colors.mint },
    { id: 'sudo', label: 'sudo', sub: 'el portero', emoji: '🦸', x: 50, y: 20, color: colors.violet },
    { id: 'sudoers', label: '/etc/sudoers', sub: 'quién puede', emoji: '📜', x: 83, y: 20, color: colors.cyan },
    { id: 'log', label: 'auth.log', sub: 'registro', emoji: '📓', x: 17, y: 80, color: colors.amber },
    { id: 'root', label: 'Comando', sub: 'como root', emoji: '⚙️', x: 83, y: 80, color: colors.rose },
  ];
  const edges: [string, string][] = [['you', 'sudo'], ['sudo', 'sudoers'], ['sudo', 'root'], ['sudo', 'log']];
  const steps: FlowStep[] = [
    { from: 'you', to: 'sudo', packet: 'sudo apt update', text: 'Escribes sudo delante del comando que necesita privilegios.' },
    { from: 'sudo', to: 'sudoers', packet: '¿alumno puede?', text: 'sudo consulta /etc/sudoers (y el grupo sudo): ¿este usuario tiene permiso para esto?' },
    { from: 'sudoers', to: 'sudo', packet: '✔ permitido', text: 'Sí: alumno forma parte del grupo sudo.' },
    { from: 'sudo', to: 'you', packet: 'contraseña', active: ['sudo', 'you'], text: 'Te pide TU contraseña (no la de root). Si la has dado hace poco, no vuelve a pedirla durante unos 15 minutos.' },
    { from: 'sudo', to: 'root', packet: 'UID 0', text: 'Ejecuta ESE comando con identidad de root. Al terminar, vuelves a ser un usuario normal.' },
    { from: 'sudo', to: 'log', packet: 'registro', text: 'Cada uso queda anotado en /var/log/auth.log: quién, cuándo y qué comando.' },
  ];
  return <FlowDiagram title="¿Cómo funciona sudo?" nodes={nodes} edges={edges} steps={steps} height={240} />;
}

// ───────────────────────── apt ─────────────────────────

export function AptFlow() {
  const nodes: FlowNode[] = [
    { id: 'you', label: 'apt install', sub: 'tree', emoji: '🧑', x: 17, y: 20, color: colors.mint },
    { id: 'apt', label: 'apt', sub: 'el gestor', emoji: '📦', x: 50, y: 20, color: colors.violet },
    { id: 'repo', label: 'Repositorio', sub: 'archive.ubuntu', emoji: '🌐', x: 83, y: 20, color: colors.cyan },
    { id: 'cache', label: 'Lista local', sub: 'apt update', emoji: '📚', x: 17, y: 80, color: colors.amber },
    { id: 'dpkg', label: 'dpkg', sub: 'instalador', emoji: '🔧', x: 50, y: 80, color: colors.rose },
    { id: 'disk', label: '/usr/bin/tree', sub: 'listo', emoji: '💾', x: 83, y: 80, color: colors.mint },
  ];
  const edges: [string, string][] = [['you', 'apt'], ['apt', 'repo'], ['apt', 'cache'], ['apt', 'dpkg'], ['dpkg', 'disk']];
  const steps: FlowStep[] = [
    { from: 'you', to: 'apt', packet: 'install tree', text: 'Le pides a apt que instale tree (con sudo).' },
    { from: 'apt', to: 'cache', packet: '¿tree?', text: 'apt consulta su lista local de paquetes (la que refresca apt update) y calcula las dependencias necesarias.' },
    { from: 'apt', to: 'repo', packet: 'descargar', text: 'Pide al repositorio oficial el paquete y sus dependencias.' },
    { from: 'repo', to: 'apt', packet: 'tree.deb', text: 'Llegan los archivos .deb (comprimidos y firmados: apt verifica la firma).' },
    { from: 'apt', to: 'dpkg', packet: 'tree.deb', text: 'apt se los entrega a dpkg, la herramienta de bajo nivel.' },
    { from: 'dpkg', to: 'disk', packet: 'instalar', text: 'dpkg copia los archivos a su sitio (/usr/bin/tree, el manual…) y anota el paquete como instalado.' },
  ];
  return <FlowDiagram title="Qué pasa al instalar un paquete" nodes={nodes} edges={edges} steps={steps} height={240} />;
}

// ───────────────────────── arranque ─────────────────────────

export function BootSequence() {
  const nodes: FlowNode[] = [
    { id: 'power', label: 'Encendido', emoji: '⏻', x: 17, y: 15, color: colors.rose },
    { id: 'uefi', label: 'UEFI / BIOS', sub: 'firmware', emoji: '🧬', x: 50, y: 15, color: colors.amber },
    { id: 'grub', label: 'GRUB', sub: 'cargador', emoji: '🥾', x: 83, y: 15, color: colors.orange },
    { id: 'kernel', label: 'Kernel', sub: 'Linux', emoji: '🧠', x: 83, y: 50, color: colors.violet },
    { id: 'systemd', label: 'systemd', sub: 'PID 1', emoji: '⚙️', x: 50, y: 50, color: colors.cyan },
    { id: 'services', label: 'Servicios', sub: 'ssh, cron…', emoji: '🛎️', x: 17, y: 50, color: colors.green },
    { id: 'login', label: 'Login', sub: 'tú entras', emoji: '🔑', x: 17, y: 86, color: colors.mint },
  ];
  const edges: [string, string][] = [['power', 'uefi'], ['uefi', 'grub'], ['grub', 'kernel'], ['kernel', 'systemd'], ['systemd', 'services'], ['services', 'login']];
  const steps: FlowStep[] = [
    { from: 'power', to: 'uefi', packet: 'corriente', text: 'Pulsas el botón. El firmware (UEFI/BIOS) comprueba el hardware: memoria, CPU, discos.' },
    { from: 'uefi', to: 'grub', packet: 'arranque', text: 'El firmware busca un cargador de arranque en el disco y le cede el control: GRUB (el menú de arranque).' },
    { from: 'grub', to: 'kernel', packet: 'vmlinuz', text: 'GRUB carga el kernel de Linux en memoria. Sus mensajes los puedes ver luego con dmesg.' },
    { from: 'kernel', to: 'systemd', packet: 'PID 1', text: 'El kernel detecta el hardware, monta el sistema de archivos raíz y lanza el primer proceso de espacio de usuario: systemd, el PID 1.' },
    { from: 'systemd', to: 'services', packet: 'unidades', text: 'systemd arranca, en paralelo, los servicios habilitados: red, ssh, cron, el registro… (systemctl enable los añade aquí).' },
    { from: 'services', to: 'login', packet: 'prompt', text: 'Por último aparece la pantalla de inicio de sesión o el servidor queda esperando conexiones SSH. ¡Sistema arrancado!' },
  ];
  return <FlowDiagram title="Del botón de encendido al login" nodes={nodes} edges={edges} steps={steps} height={260} />;
}
