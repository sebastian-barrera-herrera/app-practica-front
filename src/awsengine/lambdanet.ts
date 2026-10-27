/** Salida a internet y a los servicios de AWS de una función Lambda conectada a una VPC (sus interfaces de red nunca tienen IP pública). */
import { regional } from './account';
import { bestRoute, routeTableFor, sgAllows } from './net';
import { refreshEc2 } from './services/ec2';
import { endpointState } from './services/peering';
import type { Account } from './types';

/** Nombre del servicio en boto3 → sufijo del nombre del servicio de punto de enlace. */
const ENDPOINT_NAME: Record<string, string> = { states: 'states', events: 'events', logs: 'logs', execute: 'execute-api', 'execute-api': 'execute-api', s3api: 's3' };
const GATEWAY = ['s3', 'dynamodb'];

const probeIp = (cidr: string) => {
  const p = cidr.split('/')[0].split('.').map(Number);
  return `${p[0]}.${p[1]}.${p[2]}.${Math.min(250, p[3] + 4)}`;
};

export interface Vpc {
  SubnetIds: string[];
  SecurityGroupIds: string[];
  VpcId: string;
}

/** ¿Puede la función llamar a la API de ese servicio? Debe haber un endpoint (de puerta o de interfaz) o un NAT gateway en una subred pública. */
export function lambdaAwsReach(a: Account, region: string, vpc: Vpc, boto3Service: string): { ok: boolean; why?: string } {
  const svc = ENDPOINT_NAME[boto3Service] ?? boto3Service;
  refreshEc2(a, region);
  const r = regional(a, region).ec2;
  const endpoints = Object.values(r.endpoints ?? {}).filter((e) => e.VpcId === vpc.VpcId && endpointState(a, e) === 'available' && e.ServiceName.endsWith('.' + svc));
  for (const id of vpc.SubnetIds) {
    const rt = routeTableFor(r, id);
    const cidr = r.subnets[id]?.CidrBlock;
    if (!rt || !cidr) return { ok: false, why: `la subred ${id} no tiene tabla de rutas` };
    const gateway = GATEWAY.includes(svc) && endpoints.some((e) => e.VpcEndpointType === 'Gateway' && e.RouteTableIds.includes(rt.RouteTableId));
    const iface = endpoints.some((e) => {
      if (e.VpcEndpointType !== 'Interface' || !e.PrivateDnsEnabled) return false;
      const groups = e.SecurityGroupIds.map((g) => r.securityGroups[g]).filter(Boolean);
      return sgAllows(groups, false, 'tcp', 443, probeIp(cidr), vpc.SecurityGroupIds);
    });
    if (gateway || iface) continue;
    const def = bestRoute(r, rt, '93.184.216.34');
    if (def?.target.startsWith('nat-')) {
      const nat = r.natGateways[def.target];
      const natRt = nat ? routeTableFor(r, nat.SubnetId) : undefined;
      const natDef = natRt ? bestRoute(r, natRt, '93.184.216.34') : undefined;
      if (nat && nat.state === 'available' && natDef?.target.startsWith('igw-')) continue;
      return { ok: false, why: `la subred ${id} sale por un NAT gateway que no está disponible o no está en una subred pública` };
    }
    if (def?.target.startsWith('igw-')) return { ok: false, why: `la subred ${id} tiene ruta a una internet gateway, pero las interfaces de red de Lambda no tienen IP pública: hace falta un NAT gateway o un endpoint` };
    return { ok: false, why: `la subred ${id} no tiene salida a internet (ni NAT gateway) ni endpoint para ${svc}` };
  }
  return { ok: true };
}
