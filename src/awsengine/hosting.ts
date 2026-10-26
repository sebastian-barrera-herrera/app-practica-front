/**
 * Lo que sirve una instancia EC2 por HTTP, deducido de su user data: instala Apache/Nginx y escribe archivos en
 * `/var/www/html`. Lo usan `curl` (directo), los balanceadores y las comprobaciones de salud.
 */
import type { Ec2Instance } from './types';

export interface InstancePage {
  status: number;
  type: string;
  body: string;
  headers: Record<string, string>;
}

const APACHE = { Server: 'Apache/2.4.62 (Amazon Linux)' };

/** Nombre DNS privado de una instancia (`ip-10-0-1-23.ec2.internal`). */
export function privateDns(region: string, ip: string): string {
  return `ip-${ip.replace(/\./g, '-')}.${region === 'us-east-1' ? 'ec2.internal' : `${region}.compute.internal`}`;
}

/** ¿Instala y arranca un servidor web? */
export function runsWebServer(inst: Ec2Instance): boolean {
  const ud = inst.UserData ?? '';
  return /(httpd|nginx|apache2)/.test(ud) && /(install|systemctl|service)/.test(ud);
}

/** Sustituye lo que el script calcularía al arrancar: nombre de la máquina, id de instancia, zona… */
function expand(text: string, inst: Ec2Instance): string {
  const region = inst.AvailabilityZone.slice(0, -1);
  const meta: Record<string, string> = {
    'instance-id': inst.InstanceId,
    'placement/availability-zone': inst.AvailabilityZone,
    'local-ipv4': inst.PrivateIpAddress,
    'public-ipv4': inst.PublicIpAddress ?? '',
    'instance-type': inst.InstanceType,
    hostname: privateDns(region, inst.PrivateIpAddress),
  };
  return text
    .replace(/\$\(\s*curl[^)]*?meta-data\/([a-z0-9\-/]+)[^)]*\)/g, (_m, k: string) => meta[k] ?? '')
    .replace(/\$\(\s*hostname(?:\s+-f)?\s*\)|`\s*hostname(?:\s+-f)?\s*`/g, meta.hostname)
    .replace(/\$\(\s*hostname\s+-i\s*\)/g, inst.PrivateIpAddress);
}

/** Archivos de `/var/www/html` que crea el user data (`echo … > archivo`, `cat > archivo <<EOF`). */
export function webFiles(inst: Ec2Instance): Record<string, string> {
  const ud = inst.UserData ?? '';
  const files: Record<string, string> = {};
  for (const m of ud.matchAll(/echo\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(>>?)\s*\/var\/www\/html\/([\w./-]+)/g)) {
    const text = expand(m[1] ?? m[2] ?? '', inst).replace(/\\"/g, '"');
    files[m[4]] = m[3] === '>>' && files[m[4]] !== undefined ? files[m[4]] + text + '\n' : text + '\n';
  }
  for (const m of ud.matchAll(/cat\s*>\s*\/var\/www\/html\/([\w./-]+)\s*<<-?\s*'?"?(\w+)'?"?\n([\s\S]*?)\n\2/g)) files[m[1]] = expand(m[3], inst) + '\n';
  return files;
}

/** La respuesta de la instancia a una petición HTTP, o null si no hay servidor web. */
export function instancePage(inst: Ec2Instance, path: string): InstancePage | null {
  if (!runsWebServer(inst)) return null;
  const files = webFiles(inst);
  const clean = path.split('?')[0];
  const key = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
  const body = files[key] ?? (key === 'index.html' ? '<html><body><h1>It works!</h1></body></html>\n' : undefined);
  if (body === undefined) {
    return { status: 404, type: 'text/html', body: '<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">\n<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>\n', headers: APACHE };
  }
  return { status: 200, type: 'text/html; charset=UTF-8', body, headers: APACHE };
}
