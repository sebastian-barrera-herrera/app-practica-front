/**
 * Lógica de red de la VPC: tablas de rutas, NACL y grupos de seguridad.
 * Funciones puras sobre el estado de la cuenta; las usan `curl` (hacia instancias) y el trazador de paquetes.
 */
import type { Account, Ec2Instance, Ec2Region, NaclEntry, NatGateway, NetworkAcl, Route, RouteTable, SecurityGroup } from './types';
import { cidrContainsIp, parseCidr } from './util';

export type Proto = 'tcp' | 'udp' | 'icmp';

export interface Hop {
  /** Qué elemento se evalúa: «Instancia», «Tabla de rutas», «NACL de entrada»… */
  step: string;
  ok: boolean;
  detail: string;
}

export interface Trace {
  reachable: boolean;
  hops: Hop[];
  /** Elemento que corta el paso (si no llega). */
  blocker?: 'instance' | 'address' | 'igw' | 'route' | 'nacl' | 'sg' | 'nat';
  /** Una frase con la causa y la manera de arreglarlo. */
  why?: string;
}

const PROTO_NUM: Record<Proto, string> = { tcp: '6', udp: '17', icmp: '1' };

// ───────────────────────── rutas ─────────────────────────

/** Tabla de rutas que gobierna una subred: la asociada a ella o, si no hay, la principal de su VPC. */
export function routeTableFor(r: Ec2Region, subnetId: string): RouteTable | undefined {
  const sn = r.subnets[subnetId];
  if (!sn) return undefined;
  const tables = Object.values(r.routeTables);
  return tables.find((t) => t.associations.some((a) => a.SubnetId === subnetId)) ?? tables.find((t) => t.VpcId === sn.VpcId && t.associations.some((a) => a.Main));
}

/** ¿Está viva la ruta? (una puerta de enlace sin conectar o un NAT borrado dejan la ruta en `blackhole`). */
export function routeState(r: Ec2Region, rt: RouteTable, route: Route): 'active' | 'blackhole' {
  const t = route.target;
  if (t === 'local') return 'active';
  if (t.startsWith('igw-')) return r.internetGateways[t]?.VpcId === rt.VpcId ? 'active' : 'blackhole';
  if (t.startsWith('nat-')) {
    const n = r.natGateways[t];
    return n && n.state !== 'deleted' && n.state !== 'deleting' ? 'active' : 'blackhole';
  }
  return 'active';
}

/** Ruta que se aplica a un destino: la más específica (mayor prefijo) entre las que no son agujero negro. */
export function bestRoute(r: Ec2Region, rt: RouteTable, ip: string): Route | undefined {
  let best: Route | undefined;
  let bits = -1;
  for (const rr of rt.routes) {
    if (!cidrContainsIp(rr.DestinationCidrBlock, ip)) continue;
    if (routeState(r, rt, rr) !== 'active') continue;
    const b = parseCidr(rr.DestinationCidrBlock)!.bits;
    if (b > bits) {
      best = rr;
      bits = b;
    }
  }
  return best;
}

// ───────────────────────── NACL ─────────────────────────

export function naclFor(r: Ec2Region, subnetId: string): NetworkAcl | undefined {
  return Object.values(r.networkAcls).find((n) => n.subnets.includes(subnetId));
}

const entryMatches = (e: NaclEntry, proto: Proto, ip: string, port: number): boolean => {
  if (e.Protocol !== '-1' && e.Protocol !== PROTO_NUM[proto]) return false;
  if (!cidrContainsIp(e.CidrBlock, ip)) return false;
  if (e.PortRange && proto !== 'icmp' && (port < e.PortRange.From || port > e.PortRange.To)) return false;
  return true;
};

/** Evalúa la NACL por número de regla (de menor a mayor): gana la primera que coincide. Sin coincidencia: deniega. */
export function naclDecision(acl: NetworkAcl | undefined, egress: boolean, proto: Proto, ip: string, port: number): { allowed: boolean; rule?: number } {
  if (!acl) return { allowed: true };
  const rules = acl.Entries.filter((e) => e.Egress === egress).sort((a, b) => a.RuleNumber - b.RuleNumber);
  for (const e of rules) if (entryMatches(e, proto, ip, port)) return { allowed: e.RuleAction === 'allow', rule: e.RuleNumber };
  return { allowed: false };
}

// ───────────────────────── grupos de seguridad ─────────────────────────

const permMatches = (p: { IpProtocol: string; FromPort?: number; ToPort?: number }, proto: Proto, port: number): boolean => {
  if (p.IpProtocol === '-1') return true;
  if (p.IpProtocol !== proto) return false;
  if (proto === 'icmp') return true;
  return (p.FromPort ?? 0) <= port && (p.ToPort ?? 65535) >= port;
};

/** ¿Alguno de los grupos permite el tráfico? `peerIp` es el origen (entrada) o el destino (salida); `peerSgs` los grupos del otro extremo si es una instancia. */
export function sgAllows(groups: SecurityGroup[], egress: boolean, proto: Proto, port: number, peerIp: string, peerSgs: string[] = []): boolean {
  return groups.some((g) => (egress ? g.IpPermissionsEgress : g.IpPermissions).some((p) => permMatches(p, proto, port) && (p.IpRanges.some((x) => cidrContainsIp(x.CidrIp, peerIp)) || p.UserIdGroupPairs.some((u) => peerSgs.includes(u.GroupId)))));
}

const groupsOf = (r: Ec2Region, i: Ec2Instance) => i.SecurityGroupIds.map((id) => r.securityGroups[id]).filter(Boolean);

// ───────────────────────── trazado ─────────────────────────

const EPHEMERAL = 50000;

function finish(hops: Hop[], blocker?: Trace['blocker'], why?: string): Trace {
  return { reachable: !blocker, hops, ...(blocker ? { blocker, why } : {}) };
}

/** Una petición desde internet (`srcIp`) hasta una instancia con IP pública. */
export function traceFromInternet(a: Account, r: Ec2Region, inst: Ec2Instance, proto: Proto, port: number, srcIp = a.sourceIp): Trace {
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  if (inst.state !== 'running') {
    hop('Instancia', false, `La instancia está ${inst.state}.`);
    return finish(hops, 'instance', `La instancia no está en ejecución (${inst.state}).`);
  }
  if (!inst.PublicIpAddress) {
    hop('Dirección pública', false, 'La instancia solo tiene IP privada: internet no puede llegar a ella.');
    return finish(hops, 'address', 'La instancia no tiene IP pública. Asígnale una IP elástica o lánzala con una IP pública.');
  }
  hop('Dirección pública', true, `Internet → ${inst.PublicIpAddress} (la IGW la traduce a ${inst.PrivateIpAddress}).`);
  const sn = r.subnets[inst.SubnetId];
  const igw = Object.values(r.internetGateways).find((g) => g.VpcId === inst.VpcId);
  if (!igw) {
    hop('Internet gateway', false, `La VPC ${inst.VpcId} no tiene ninguna puerta de enlace a internet conectada.`);
    return finish(hops, 'igw', 'Crea una internet gateway y conéctala a la VPC.');
  }
  hop('Internet gateway', true, `${igw.InternetGatewayId} conectada a la VPC.`);
  const rt = routeTableFor(r, inst.SubnetId);
  const back = rt ? bestRoute(r, rt, srcIp) : undefined;
  if (!rt || !back || back.target !== igw.InternetGatewayId) {
    hop('Tabla de rutas', false, `La subred ${sn?.SubnetId} no tiene una ruta hacia internet (0.0.0.0/0) por ${igw.InternetGatewayId}.${back ? ` Su ruta para ${srcIp} va a «${back.target}».` : ''}`);
    return finish(hops, 'route', 'Añade en la tabla de rutas de la subred la ruta 0.0.0.0/0 → internet gateway (así la subred pasa a ser pública).');
  }
  hop('Tabla de rutas', true, `${rt.RouteTableId}: ${back.DestinationCidrBlock} → ${igw.InternetGatewayId}.`);
  const acl = naclFor(r, inst.SubnetId);
  const nin = naclDecision(acl, false, proto, srcIp, port);
  if (!nin.allowed) {
    hop('NACL (entrada)', false, `${acl?.NetworkAclId}: ${nin.rule ? `la regla ${nin.rule} deniega` : 'ninguna regla permite'} ${proto}/${port} desde ${srcIp}.`);
    return finish(hops, 'nacl', `La NACL de la subred bloquea la entrada del puerto ${port}. Las NACL no recuerdan conexiones: hay que permitirlo (y la respuesta) a mano.`);
  }
  hop('NACL (entrada)', true, `${acl?.NetworkAclId}: ${nin.rule ? `regla ${nin.rule}` : 'sin NACL'} permite.`);
  const groups = groupsOf(r, inst);
  if (!sgAllows(groups, false, proto, port, srcIp)) {
    hop('Security group (entrada)', false, `Ningún grupo (${inst.SecurityGroupIds.join(', ')}) permite ${proto}/${port} desde ${srcIp}.`);
    return finish(hops, 'sg', `El security group no tiene una regla de entrada para ${proto}/${port} desde ${srcIp}. Añádela (los grupos solo permiten; lo demás se deniega).`);
  }
  hop('Security group (entrada)', true, `Una regla de entrada permite ${proto}/${port}.`);
  hop('Respuesta (SG)', true, 'Los grupos de seguridad son con estado: la respuesta vuelve sin otra regla.');
  const nout = naclDecision(acl, true, proto, srcIp, EPHEMERAL);
  if (!nout.allowed) {
    hop('NACL (salida)', false, `${acl?.NetworkAclId}: la respuesta (puertos efímeros 1024-65535) no está permitida en la salida.`);
    return finish(hops, 'nacl', 'La NACL no deja salir la respuesta. Como las NACL no tienen estado, hay que permitir también los puertos efímeros (1024-65535) de salida.');
  }
  hop('NACL (salida)', true, `${acl?.NetworkAclId}: la respuesta puede salir.`);
  return finish(hops);
}

/** Una instancia que quiere llegar a una IP pública de internet. */
export function traceToInternet(a: Account, r: Ec2Region, inst: Ec2Instance, proto: Proto, port: number, dstIp = '93.184.216.34'): Trace {
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  if (inst.state !== 'running') {
    hop('Instancia', false, `La instancia está ${inst.state}.`);
    return finish(hops, 'instance', `La instancia no está en ejecución (${inst.state}).`);
  }
  const groups = groupsOf(r, inst);
  if (!sgAllows(groups, true, proto, port, dstIp)) {
    hop('Security group (salida)', false, `Ninguna regla de salida permite ${proto}/${port} hacia ${dstIp}.`);
    return finish(hops, 'sg', 'El security group no permite esa salida. Por defecto se permite todo: alguien la ha restringido.');
  }
  hop('Security group (salida)', true, 'Una regla de salida lo permite.');
  const acl = naclFor(r, inst.SubnetId);
  const nout = naclDecision(acl, true, proto, dstIp, port);
  if (!nout.allowed) {
    hop('NACL (salida)', false, `${acl?.NetworkAclId}: no hay regla de salida que permita ${proto}/${port}.`);
    return finish(hops, 'nacl', 'La NACL de la subred bloquea la salida.');
  }
  hop('NACL (salida)', true, `${acl?.NetworkAclId}: permite.`);
  const rt = routeTableFor(r, inst.SubnetId);
  const route = rt ? bestRoute(r, rt, dstIp) : undefined;
  if (!rt || !route || route.target === 'local') {
    hop('Tabla de rutas', false, `${rt?.RouteTableId ?? 'Sin tabla'}: no hay ruta para ${dstIp}.`);
    return finish(hops, 'route', 'No hay ruta hacia internet. Añade 0.0.0.0/0 → internet gateway (subred pública) o → NAT gateway (subred privada).');
  }
  hop('Tabla de rutas', true, `${rt.RouteTableId}: ${route.DestinationCidrBlock} → ${route.target}.`);
  if (route.target.startsWith('igw-')) {
    if (!inst.PublicIpAddress) {
      hop('Dirección pública', false, 'La IGW solo traduce direcciones de instancias con IP pública.');
      return finish(hops, 'address', 'La subred sale por la internet gateway, pero la instancia no tiene IP pública (ni elástica): sus paquetes no vuelven.');
    }
    hop('Dirección pública', true, `${inst.PrivateIpAddress} se traduce a ${inst.PublicIpAddress}.`);
  } else if (route.target.startsWith('nat-')) {
    const nat: NatGateway = r.natGateways[route.target];
    if (nat.state !== 'available') {
      hop('NAT gateway', false, `${nat.NatGatewayId} está ${nat.state}.`);
      return finish(hops, 'nat', 'El NAT gateway todavía no está disponible.');
    }
    const nrt = routeTableFor(r, nat.SubnetId);
    const nroute = nrt ? bestRoute(r, nrt, dstIp) : undefined;
    if (!nroute || !nroute.target.startsWith('igw-')) {
      hop('NAT gateway', false, `${nat.NatGatewayId} está en la subred ${nat.SubnetId}, que no tiene ruta a internet.`);
      return finish(hops, 'nat', 'El NAT gateway debe estar en una subred pública (con ruta 0.0.0.0/0 → internet gateway).');
    }
    hop('NAT gateway', true, `${nat.NatGatewayId} (${nat.PublicIp ?? 'sin IP'}) sale por ${nroute.target}.`);
  } else {
    hop('Destino de la ruta', true, `Se envía a ${route.target}.`);
  }
  const nin = naclDecision(acl, false, proto, dstIp, EPHEMERAL);
  if (!nin.allowed) {
    hop('NACL (entrada)', false, `${acl?.NetworkAclId}: la respuesta (puertos efímeros 1024-65535) no está permitida en la entrada.`);
    return finish(hops, 'nacl', 'La NACL no deja entrar la respuesta: permite los puertos efímeros 1024-65535 de entrada.');
  }
  hop('NACL (entrada)', true, 'La respuesta puede entrar.');
  return finish(hops);
}

/** Una instancia que habla con otra de la misma VPC (cualquier subred). */
export function traceBetween(a: Account, r: Ec2Region, from: Ec2Instance, to: Ec2Instance, proto: Proto, port: number): Trace {
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  if (from.VpcId !== to.VpcId) {
    hop('VPC', false, 'Están en VPC distintas: hace falta peering, Transit Gateway o una VPN.');
    return finish(hops, 'route', 'Las dos instancias están en VPC diferentes. Conecta las VPC (peering) y añade rutas.');
  }
  hop('VPC', true, `Misma VPC (${from.VpcId}): la ruta «local» las une.`);
  if (to.state !== 'running') {
    hop('Instancia', false, `El destino está ${to.state}.`);
    return finish(hops, 'instance', 'La instancia de destino no está en ejecución.');
  }
  const sgOut = sgAllows(groupsOf(r, from), true, proto, port, to.PrivateIpAddress, to.SecurityGroupIds);
  if (!sgOut) {
    hop('Security group (salida del origen)', false, 'No permite salir hacia el destino.');
    return finish(hops, 'sg', 'El security group de origen restringe la salida.');
  }
  hop('Security group (salida del origen)', true, 'Permite la salida.');
  if (from.SubnetId !== to.SubnetId) {
    const aclOut = naclFor(r, from.SubnetId);
    const d1 = naclDecision(aclOut, true, proto, to.PrivateIpAddress, port);
    if (!d1.allowed) {
      hop('NACL (salida de la subred de origen)', false, `${aclOut?.NetworkAclId} no lo permite.`);
      return finish(hops, 'nacl', 'La NACL de la subred de origen bloquea la salida.');
    }
    const aclIn = naclFor(r, to.SubnetId);
    const d2 = naclDecision(aclIn, false, proto, from.PrivateIpAddress, port);
    if (!d2.allowed) {
      hop('NACL (entrada a la subred de destino)', false, `${aclIn?.NetworkAclId} no lo permite.`);
      return finish(hops, 'nacl', 'La NACL de la subred de destino bloquea la entrada.');
    }
    hop('NACL', true, 'Las dos subredes lo permiten.');
  } else {
    hop('NACL', true, 'Misma subred: las NACL no se aplican dentro de una subred.');
  }
  if (!sgAllows(groupsOf(r, to), false, proto, port, from.PrivateIpAddress, from.SecurityGroupIds)) {
    hop('Security group (entrada del destino)', false, `Ninguna regla permite ${proto}/${port} desde ${from.PrivateIpAddress} (o desde su grupo).`);
    return finish(hops, 'sg', 'El security group de destino no admite al origen: permite el puerto desde el grupo de origen o su CIDR.');
  }
  hop('Security group (entrada del destino)', true, 'Una regla lo permite.');
  void a;
  return finish(hops);
}
