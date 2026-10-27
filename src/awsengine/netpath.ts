/**
 * Buscador de caminos de red entre recursos de una VPC y del resto del mundo: instancias (en la misma VPC, en otra por
 * peering o por Transit Gateway), internet, endpoints de VPC y la red de la oficina por VPN.
 * Lo usan el corrector (`_check trace`) y el Reachability Analyzer.
 */
import { regional } from './account';
import { bestRoute, naclDecision, naclFor, routeState, routeTableFor, sgAllows, traceBetween, traceFromInternet, traceToInternet, type Hop, type Proto, type Trace } from './net';
import { prefixListId } from './services/peering';
import { tgwState, attachStatus } from './services/tgw';
import { tunnelsUp } from './services/vpn';
import { ON_PREM_CIDR, vpnRoutes } from './onprem';
import type { Account, Ec2Instance, Ec2Region } from './types';
import { cidrContainsIp, stableId } from './util';

export interface PathResult extends Trace {
  /** Componentes que atraviesa, de origen a destino. */
  path: string[];
  /** Código de explicación del primer obstáculo (como los del Reachability Analyzer). */
  code?: string;
  /** Recurso que lo causa. */
  component?: string;
}

const groupsOf = (r: Ec2Region, i: Ec2Instance) => i.SecurityGroupIds.map((id) => r.securityGroups[id]).filter(Boolean);

const CODE: Record<NonNullable<Trace['blocker']>, string> = {
  instance: 'INSTANCE_NOT_RUNNING',
  address: 'NO_PUBLIC_IP_ADDRESS',
  igw: 'IGW_NOT_ATTACHED',
  route: 'NO_ROUTE_TO_DESTINATION',
  nacl: 'SUBNET_ACL_RESTRICTION',
  sg: 'ENI_SG_RULES_MISMATCH',
  nat: 'NAT_GATEWAY_NOT_AVAILABLE',
  peering: 'VPC_PEERING_CONNECTION_NOT_ACTIVE',
  tgw: 'TRANSIT_GATEWAY_ROUTE_MISSING',
  endpoint: 'VPC_ENDPOINT_NOT_REACHABLE',
  vpn: 'VPN_TUNNEL_DOWN',
};

const fromTrace = (t: Trace, path: string[], component?: string): PathResult => ({ ...t, path, ...(t.blocker ? { code: CODE[t.blocker], component } : {}) });

/** Encuentra una instancia (o una interfaz de red) por su id. */
export function instanceById(a: Account, id: string): { inst: Ec2Instance; region: string; r: Ec2Region } | null {
  for (const region of Object.keys(a.regions)) {
    const r = a.regions[region].ec2;
    for (const i of Object.values(r.instances)) {
      if (i.InstanceId === id || eniOfInstance(i) === id) return { inst: i, region, r };
    }
  }
  return null;
}

export const eniOfInstance = (i: Ec2Instance) => stableId(`eni:${i.InstanceId}`, 'eni-', 17);

function fail(hops: Hop[], blocker: NonNullable<Trace['blocker']>, why: string, path: string[], component?: string): PathResult {
  return { reachable: false, hops, blocker, why, path, code: CODE[blocker], component };
}

/** Camino de una instancia hacia una IP privada de otra red (peering, Transit Gateway, VPN) o hacia otra instancia de la misma VPC. */
export function pathFromInstance(a: Account, region: string, src: Ec2Instance, dstIp: string, dstInst: Ec2Instance | null, proto: Proto, port: number, opts: { returnPath?: boolean } = {}): PathResult {
  const r = regional(a, region).ec2;
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  const path: string[] = [src.InstanceId];
  if (src.state !== 'running') {
    hop('Origen', false, `La instancia de origen está ${src.state}.`);
    return fail(hops, 'instance', 'La instancia de origen no está en ejecución.', path);
  }
  if (dstInst && dstInst.state !== 'running') {
    hop('Destino', false, `La instancia de destino está ${dstInst.state}.`);
    return fail(hops, 'instance', 'La instancia de destino no está en ejecución.', path);
  }
  if (!sgAllows(groupsOf(r, src), true, proto, port, dstIp, dstInst?.SecurityGroupIds)) {
    hop('Security group (salida del origen)', false, `Ninguna regla de salida permite ${proto}/${port} hacia ${dstIp}.`);
    return fail(hops, 'sg', 'El security group del origen no permite la salida a ese destino.', path, src.SecurityGroupIds[0]);
  }
  hop('Security group (salida del origen)', true, 'Una regla de salida lo permite.');
  const rt = routeTableFor(r, src.SubnetId);
  const route = rt ? bestRoute(r, rt, dstIp) : undefined;
  if (!rt || !route) {
    // quizá la ruta existe pero es un agujero negro
    const dead = rt?.routes.find((x) => cidrContainsIp(x.DestinationCidrBlock, dstIp) && routeState(r, rt, x) !== 'active');
    hop('Tabla de rutas', false, dead ? `La ruta ${dead.DestinationCidrBlock} → ${dead.target} existe pero está en «blackhole» (su destino ya no existe).` : `${rt?.RouteTableId ?? 'Sin tabla'}: ninguna ruta lleva a ${dstIp}.`);
    return fail(hops, 'route', dead ? 'La ruta hacia ese destino es un agujero negro: recréala hacia un destino que exista.' : `Añade en la tabla de rutas de la subred de origen una ruta hacia ${dstIp} (peering, Transit Gateway, VPN…).`, [...path, rt?.RouteTableId ?? ''], rt?.RouteTableId);
  }
  path.push(rt.RouteTableId);
  const target = route.target;
  hop('Tabla de rutas', true, `${rt.RouteTableId}: ${route.DestinationCidrBlock} → ${target}.`);

  // el destino está en la misma VPC (ruta local) o detrás de un peering o un Transit Gateway
  let backTarget = 'local';
  let tgwBack: { srcAttId: string; dstAttId: string } | undefined;
  if (target === 'local') {
    if (!dstInst) return fail(hops, 'route', `${dstIp} pertenece a esta VPC pero no hay ninguna instancia con esa IP.`, path);
  } else if (target.startsWith('pcx-')) {
    const pc = r.peerings?.[target];
    if (!pc || pc.Status !== 'active') {
      hop('Peering', false, `${target} está ${pc?.Status ?? 'borrado'}.`);
      return fail(hops, 'peering', 'El peering no está activo: la otra parte debe aceptarlo.', [...path, target], target);
    }
    const dstVpc = dstInst?.VpcId ?? Object.values(r.vpcs).find((v) => [v.CidrBlock, ...(v.ExtraCidrBlocks ?? [])].some((c) => cidrContainsIp(c, dstIp)))?.VpcId;
    if (!dstVpc || ![pc.RequesterVpcId, pc.AccepterVpcId].includes(dstVpc) || dstVpc === src.VpcId) {
      hop('Peering', false, `${target} no conecta esta VPC con la VPC del destino.`);
      return fail(hops, 'peering', 'Ese peering une otras dos VPC. Las rutas deben apuntar al peering que conecta ambas.', [...path, target], target);
    }
    hop('Peering', true, `${target} activo entre ${pc.RequesterVpcId} y ${pc.AccepterVpcId}.`);
    path.push(target);
    backTarget = target;
  } else if (target.startsWith('tgw-')) {
    const s = tgwState(a, region);
    const g = s.gateways[target];
    const srcAtt = Object.values(s.attachments).find((x) => x.TransitGatewayId === target && x.ResourceId === src.VpcId && !x.deleted);
    const dstVpc = dstInst?.VpcId ?? Object.values(r.vpcs).find((v) => [v.CidrBlock, ...(v.ExtraCidrBlocks ?? [])].some((c) => cidrContainsIp(c, dstIp)))?.VpcId;
    const dstAtt = Object.values(s.attachments).find((x) => x.TransitGatewayId === target && x.ResourceId === dstVpc && !x.deleted);
    if (!g || g.deleted || !srcAtt || attachStatus(a, srcAtt) !== 'available') {
      hop('Transit Gateway', false, `La VPC de origen no tiene un adjunto disponible en ${target}.`);
      return fail(hops, 'tgw', 'Conecta la VPC al Transit Gateway (create-transit-gateway-vpc-attachment) y espera a que esté disponible.', [...path, target], target);
    }
    const srcRt = Object.values(s.routeTables).find((x) => x.associations.includes(srcAtt.TransitGatewayAttachmentId));
    if (!srcRt) {
      hop('Tabla de rutas del TGW', false, 'El adjunto de origen no está asociado a ninguna tabla de rutas del Transit Gateway.');
      return fail(hops, 'tgw', 'Asocia el adjunto a una tabla de rutas del Transit Gateway.', [...path, target], srcAtt.TransitGatewayAttachmentId);
    }
    const hit = srcRt.routes.filter((x) => cidrContainsIp(x.DestinationCidrBlock, dstIp)).sort((x, y) => Number(y.DestinationCidrBlock.split('/')[1]) - Number(x.DestinationCidrBlock.split('/')[1]))[0];
    const hitAtt = hit && !hit.Blackhole && hit.TransitGatewayAttachmentId ? s.attachments[hit.TransitGatewayAttachmentId] : undefined;
    if (hitAtt?.ResourceType === 'vpn') {
      const vpn = r.vpns?.[hitAtt.ResourceId];
      if (!vpn || !tunnelsUp(a, vpn)) {
        hop('VPN', false, 'El adjunto VPN existe, pero ningún túnel está activo (UP).');
        return fail(hops, 'vpn', 'Los túneles de la VPN no están activos: revisa el router de la oficina y las rutas.', [...path, target, hitAtt.TransitGatewayAttachmentId], vpn?.VpnConnectionId);
      }
      hop('Transit Gateway', true, `${target}: ${srcRt.TransitGatewayRouteTableId} lleva ${hit!.DestinationCidrBlock} al adjunto VPN ${hitAtt.TransitGatewayAttachmentId}.`);
      return { reachable: true, hops, path: [...path, target, hitAtt.TransitGatewayAttachmentId, dstIp] };
    }
    if (!hit || hit.Blackhole || !dstAtt || hit.TransitGatewayAttachmentId !== dstAtt.TransitGatewayAttachmentId) {
      hop('Tabla de rutas del TGW', false, hit?.Blackhole ? `${srcRt.TransitGatewayRouteTableId}: ${hit.DestinationCidrBlock} es un agujero negro.` : `${srcRt.TransitGatewayRouteTableId}: no hay ruta hacia ${dstIp} (¿falta propagar el adjunto de destino o añadir una ruta estática?).`);
      return fail(hops, 'tgw', 'La tabla de rutas del Transit Gateway asociada al adjunto de origen no sabe llegar al destino: habilita la propagación del adjunto de destino en esa tabla o crea una ruta estática.', [...path, target, srcRt.TransitGatewayRouteTableId], srcRt.TransitGatewayRouteTableId);
    }
    if (attachStatus(a, dstAtt) !== 'available') {
      hop('Transit Gateway', false, 'El adjunto de destino todavía no está disponible.');
      return fail(hops, 'tgw', 'Espera a que el adjunto de la VPC de destino esté disponible.', [...path, target], dstAtt.TransitGatewayAttachmentId);
    }
    hop('Transit Gateway', true, `${target}: ${srcRt.TransitGatewayRouteTableId} lleva ${hit.DestinationCidrBlock} al adjunto ${dstAtt.TransitGatewayAttachmentId}.`);
    path.push(target);
    backTarget = target;
    tgwBack = { srcAttId: srcAtt.TransitGatewayAttachmentId, dstAttId: dstAtt.TransitGatewayAttachmentId };
  } else if (target.startsWith('vgw-')) {
    const g = r.vgws?.[target];
    const vpns = Object.values(r.vpns ?? {}).filter((v) => !v.deleted && v.VpnGatewayId === target);
    if (!g || g.VpcId !== src.VpcId || !vpns.length) {
      hop('VPN', false, 'La puerta privada virtual no está conectada a la VPC o no tiene ninguna VPN.');
      return fail(hops, 'vpn', 'Conecta la puerta privada virtual a la VPC y crea una conexión VPN.', [...path, target], target);
    }
    if (!vpns.some((v) => tunnelsUp(a, v) && vpnRoutes(v).some((c) => cidrContainsIp(c, dstIp)))) {
      hop('VPN', false, 'Ningún túnel está activo (UP) con una ruta hacia ese destino.');
      return fail(hops, 'vpn', 'La VPN no tiene túneles activos hacia ese destino: revisa el router de la oficina y las rutas estáticas.', [...path, target], vpns[0].VpnConnectionId);
    }
    hop('VPN', true, `${target}: túnel IPsec activo hacia la red de la oficina.`);
    path.push(target);
    return { reachable: true, hops, path: [...path, dstIp] };
  } else if (target.startsWith('igw-') || target.startsWith('nat-')) {
    hop('Destino de la ruta', false, `La ruta lleva ${dstIp} hacia ${target}: es una dirección privada, no sale a internet.`);
    return fail(hops, 'route', 'Una dirección privada no se enruta por internet: necesitas peering, Transit Gateway o VPN.', path, target);
  }
  // NACL del origen (salida) y del destino (entrada)
  if (dstInst) {
    if (dstInst.SubnetId !== src.SubnetId) {
      const o = naclDecision(naclFor(r, src.SubnetId), true, proto, dstIp, port);
      if (!o.allowed) {
        hop('NACL (salida de la subred de origen)', false, 'No permite la salida hacia el destino.');
        return fail(hops, 'nacl', 'La NACL de la subred de origen bloquea la salida.', path, naclFor(r, src.SubnetId)?.NetworkAclId);
      }
      const i = naclDecision(naclFor(r, dstInst.SubnetId), false, proto, src.PrivateIpAddress, port);
      if (!i.allowed) {
        hop('NACL (entrada a la subred de destino)', false, 'No permite la entrada desde el origen.');
        return fail(hops, 'nacl', 'La NACL de la subred de destino bloquea la entrada.', [...path, dstInst.SubnetId], naclFor(r, dstInst.SubnetId)?.NetworkAclId);
      }
      hop('NACL', true, 'Las dos subredes lo permiten.');
    }
    if (!sgAllows(groupsOf(r, dstInst), false, proto, port, src.PrivateIpAddress, src.SecurityGroupIds)) {
      hop('Security group (entrada del destino)', false, `Ninguna regla permite ${proto}/${port} desde ${src.PrivateIpAddress}${target.startsWith('pcx-') || target.startsWith('tgw-') ? ' (con peering o Transit Gateway la regla debe usar el CIDR del origen)' : ''}.`);
      return fail(hops, 'sg', 'El security group de destino no admite al origen. Permite el puerto desde el CIDR de la VPC de origen.', [...path, dstInst.InstanceId], dstInst.SecurityGroupIds[0]);
    }
    hop('Security group (entrada del destino)', true, 'Una regla lo permite.');
    path.push(dstInst.InstanceId);
  }
  // camino de vuelta: la tabla de rutas del destino tiene que saber volver al origen
  if (opts.returnPath !== false && dstInst && backTarget !== 'local') {
    const drt = routeTableFor(r, dstInst.SubnetId);
    const back = drt ? bestRoute(r, drt, src.PrivateIpAddress) : undefined;
    if (!drt || !back || back.target !== backTarget) {
      hop('Ruta de vuelta', false, `La tabla de rutas del destino (${drt?.RouteTableId ?? '—'}) no tiene una ruta hacia ${src.PrivateIpAddress} por ${backTarget}: la respuesta no puede volver.`);
      return fail(hops, 'route', `Falta la ruta de vuelta: en la tabla de rutas de la subred de destino añade una ruta hacia el CIDR del origen por ${backTarget}. Las rutas se declaran en los dos lados.`, path, drt?.RouteTableId);
    }
    hop('Ruta de vuelta', true, `${drt.RouteTableId}: ${back.DestinationCidrBlock} → ${backTarget}.`);
    if (tgwBack) {
      // la respuesta entra al Transit Gateway por el adjunto de destino: su tabla de rutas también debe saber volver
      const s = tgwState(a, region);
      const dRt = Object.values(s.routeTables).find((x) => x.associations.includes(tgwBack!.dstAttId));
      const bHit = dRt?.routes.filter((x) => cidrContainsIp(x.DestinationCidrBlock, src.PrivateIpAddress)).sort((x, y) => Number(y.DestinationCidrBlock.split('/')[1]) - Number(x.DestinationCidrBlock.split('/')[1]))[0];
      if (!dRt || !bHit || bHit.Blackhole || bHit.TransitGatewayAttachmentId !== tgwBack.srcAttId) {
        hop('Tabla de rutas del TGW (vuelta)', false, `${dRt?.TransitGatewayRouteTableId ?? 'El adjunto de destino no tiene tabla'}: no sabe llegar a ${src.PrivateIpAddress}, la respuesta se pierde.`);
        return fail(hops, 'tgw', 'La tabla de rutas asociada al adjunto de destino no tiene ruta de vuelta hacia el origen: propaga el adjunto de origen en esa tabla.', path, dRt?.TransitGatewayRouteTableId);
      }
      hop('Tabla de rutas del TGW (vuelta)', true, `${dRt.TransitGatewayRouteTableId} devuelve la respuesta por ${bHit.TransitGatewayAttachmentId}.`);
    }
  }
  return { reachable: true, hops, path };
}

/** Camino de una instancia a un endpoint de VPC (de puerta de enlace o de interfaz). */
export function pathToEndpoint(a: Account, region: string, src: Ec2Instance, vpceId: string, port = 443): PathResult {
  const r = regional(a, region).ec2;
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  const path = [src.InstanceId];
  const e = r.endpoints?.[vpceId];
  if (!e || e.State === 'deleted') {
    hop('Endpoint', false, `${vpceId} no existe.`);
    return fail(hops, 'endpoint', 'El endpoint no existe.', path, vpceId);
  }
  if (e.State === 'pendingAcceptance') {
    hop('Endpoint', false, 'El dueño del servicio todavía no ha aceptado la conexión (pendingAcceptance).');
    return fail(hops, 'endpoint', 'El dueño del servicio debe aceptar la conexión del endpoint (accept-vpc-endpoint-connections).', path, vpceId);
  }
  if (e.VpcId !== src.VpcId) {
    hop('Endpoint', false, 'El endpoint está en otra VPC.');
    return fail(hops, 'endpoint', 'El endpoint pertenece a otra VPC.', path, vpceId);
  }
  const rt = routeTableFor(r, src.SubnetId);
  if (e.VpcEndpointType === 'Gateway') {
    const has = rt?.routes.some((x) => x.target === e.VpcEndpointId && x.DestinationPrefixListId === (e.PrefixListId ?? prefixListId(region, e.ServiceName.split('.').pop() ?? '')));
    if (!rt || !has) {
      hop('Tabla de rutas', false, `${rt?.RouteTableId ?? 'Sin tabla'}: no tiene la ruta de la lista de prefijos hacia ${vpceId}.`);
      return fail(hops, 'endpoint', 'La subred del origen no usa el endpoint: añade su tabla de rutas al endpoint (modify-vpc-endpoint --add-route-table-ids).', [...path, rt?.RouteTableId ?? ''], rt?.RouteTableId);
    }
    hop('Tabla de rutas', true, `${rt.RouteTableId}: lista de prefijos ${e.PrefixListId} → ${vpceId}.`);
    return { reachable: true, hops, path: [...path, rt.RouteTableId, vpceId] };
  }
  // de interfaz: una interfaz de red con IP privada dentro de la VPC; manda el security group del endpoint
  const sgs = e.SecurityGroupIds.map((id) => r.securityGroups[id]).filter(Boolean);
  const ip = Object.values(e.ips)[0];
  if (!ip) {
    hop('Endpoint', false, 'El endpoint no tiene interfaces de red (subredes).');
    return fail(hops, 'endpoint', 'Añade subredes al endpoint.', path, vpceId);
  }
  if (!sgAllows(sgs, false, 'tcp', port, src.PrivateIpAddress, src.SecurityGroupIds)) {
    hop('Security group del endpoint', false, `Ninguna regla de entrada permite tcp/${port} desde ${src.PrivateIpAddress}.`);
    return fail(hops, 'sg', 'El security group del endpoint (de interfaz) no admite al origen: permite el puerto 443 desde el CIDR de la VPC.', [...path, e.VpcEndpointId], e.SecurityGroupIds[0]);
  }
  hop('Security group del endpoint', true, 'Admite el puerto 443 desde el origen.');
  return { reachable: true, hops, path: [...path, vpceId] };
}

/** Camino entre dos instancias (en cualquier VPC de la región). */
export function pathBetween(a: Account, region: string, src: Ec2Instance, dst: Ec2Instance, proto: Proto, port: number, opts: { returnPath?: boolean } = {}): PathResult {
  const r = regional(a, region).ec2;
  if (src.VpcId === dst.VpcId) return fromTrace(traceBetween(a, r, src, dst, proto, port), [src.InstanceId, dst.InstanceId]);
  return pathFromInstance(a, region, src, dst.PrivateIpAddress, dst, proto, port, opts);
}

/** Camino de una instancia a internet o desde internet. */
export function pathInternet(a: Account, region: string, inst: Ec2Instance, direction: 'out' | 'in', proto: Proto, port: number, ip?: string): PathResult {
  const r = regional(a, region).ec2;
  return direction === 'out' ? fromTrace(traceToInternet(a, r, inst, proto, port, ip), [inst.InstanceId, 'internet']) : fromTrace(traceFromInternet(a, r, inst, proto, port, ip), ['internet', inst.InstanceId]);
}

/** Camino desde la oficina (por VPN) hasta una instancia: la VPN tiene que estar activa y la VPC sabe volver a la oficina. */
export function pathFromOnPrem(a: Account, region: string, dst: Ec2Instance, proto: Proto, port: number, srcIp = '192.168.1.10'): PathResult {
  const r = regional(a, region).ec2;
  const hops: Hop[] = [];
  const hop = (step: string, ok: boolean, detail: string) => hops.push({ step, ok, detail });
  const path = ['oficina'];
  if (dst.state !== 'running') {
    hop('Destino', false, `La instancia está ${dst.state}.`);
    return fail(hops, 'instance', 'La instancia de destino no está en ejecución.', path);
  }
  const rt = routeTableFor(r, dst.SubnetId);
  const route = rt ? bestRoute(r, rt, srcIp) : undefined;
  if (!rt || !route || !(route.target.startsWith('vgw-') || route.target.startsWith('tgw-'))) {
    hop('Tabla de rutas', false, `${rt?.RouteTableId ?? 'Sin tabla'}: no tiene una ruta hacia ${ON_PREM_CIDR} por la VPN (puerta privada virtual o Transit Gateway): la respuesta no podría volver.`);
    return fail(hops, 'route', 'Añade la ruta hacia la red de la oficina (o activa la propagación de rutas de la puerta privada virtual) en la tabla de la subred.', path, rt?.RouteTableId);
  }
  hop('Tabla de rutas', true, `${rt.RouteTableId}: ${route.DestinationCidrBlock} → ${route.target}.`);
  const viaVgw = route.target.startsWith('vgw-');
  const tgwOf = (att: { ResourceType: string; ResourceId: string }) => r.vpns?.[att.ResourceId];
  let vpnUp = false;
  if (viaVgw) {
    vpnUp = Object.values(r.vpns ?? {}).some((v) => !v.deleted && v.VpnGatewayId === route.target && r.vgws?.[route.target]?.VpcId === dst.VpcId && tunnelsUp(a, v) && vpnRoutes(v).some((c) => cidrContainsIp(c, srcIp)));
  } else {
    const s = tgwState(a, region);
    const vpnAtt = Object.values(s.attachments).find((x) => !x.deleted && x.TransitGatewayId === route.target && x.ResourceType === 'vpn' && (() => { const v = tgwOf(x); return !!v && tunnelsUp(a, v) && vpnRoutes(v).some((c) => cidrContainsIp(c, srcIp)); })());
    const dstAtt = Object.values(s.attachments).find((x) => !x.deleted && x.TransitGatewayId === route.target && x.ResourceType === 'vpc' && x.ResourceId === dst.VpcId);
    vpnUp = !!vpnAtt;
    if (vpnAtt && dstAtt) {
      // entrada: la tabla del adjunto VPN debe llevar al adjunto de la VPC; vuelta: la tabla del adjunto de la VPC debe llevar al VPN
      const best = (rtId: string | undefined, ip: string) => {
        const t = Object.values(s.routeTables).find((x) => x.associations.includes(rtId ?? ''));
        return t?.routes.filter((x) => cidrContainsIp(x.DestinationCidrBlock, ip)).sort((x, y) => Number(y.DestinationCidrBlock.split('/')[1]) - Number(x.DestinationCidrBlock.split('/')[1]))[0];
      };
      const inHit = best(vpnAtt.TransitGatewayAttachmentId, dst.PrivateIpAddress);
      const outHit = best(dstAtt.TransitGatewayAttachmentId, srcIp);
      if (!inHit || inHit.Blackhole || inHit.TransitGatewayAttachmentId !== dstAtt.TransitGatewayAttachmentId || !outHit || outHit.Blackhole || outHit.TransitGatewayAttachmentId !== vpnAtt.TransitGatewayAttachmentId) {
        hop('Tabla de rutas del TGW', false, 'Las tablas de rutas del Transit Gateway no conectan el adjunto VPN con la VPC en los dos sentidos (propaga cada adjunto en la tabla del otro).');
        return fail(hops, 'tgw', 'Revisa asociaciones y propagaciones del Transit Gateway: la tabla del adjunto VPN debe conocer la VPC y la de la VPC debe conocer la oficina.', [...path, route.target], route.target);
      }
    }
  }
  if (!vpnUp) {
    hop('VPN', false, 'Ningún túnel está activo (UP) con una ruta hacia la oficina.');
    return fail(hops, 'vpn', 'La VPN no tiene túneles activos: revisa el router de la oficina y las rutas estáticas.', [...path, route.target], route.target);
  }
  hop('VPN', true, 'Túnel IPsec activo.');
  const acl = naclFor(r, dst.SubnetId);
  if (!naclDecision(acl, false, proto, srcIp, port).allowed) {
    hop('NACL (entrada)', false, `${acl?.NetworkAclId} no permite ${proto}/${port} desde ${srcIp}.`);
    return fail(hops, 'nacl', 'La NACL de la subred bloquea el tráfico de la oficina.', path, acl?.NetworkAclId);
  }
  if (!sgAllows(groupsOf(r, dst), false, proto, port, srcIp)) {
    hop('Security group (entrada)', false, `Ninguna regla permite ${proto}/${port} desde ${srcIp}. Permite el CIDR de la oficina.`);
    return fail(hops, 'sg', 'El security group no admite el CIDR de la oficina (192.168.0.0/16).', [...path, route.target], dst.SecurityGroupIds[0]);
  }
  hop('Security group (entrada)', true, 'Una regla lo permite.');
  return { reachable: true, hops, path: [...path, route.target, dst.InstanceId] };
}
