/** Escenarios de la zona «VPC avanzada y conectividad» (Z9): peering, Transit Gateway, endpoints, VPN, diagnóstico y acceso seguro. */
import { regional } from './account';
import { eniOfInstance } from './netpath';
import type { Scenario } from './scenarios';
import { ec2CreateSg, ec2Launch } from './services/ec2';
import { iamCreateRole } from './services/iam';
import { logsCreateGroup, logsPut } from './services/logs';
import { ec2CreateEndpoint, ec2CreatePeering } from './services/peering';
import { s3CreateBucket, s3Put } from './services/s3';
import { tgwAttachVpc, tgwCreate } from './services/tgw';
import { ec2CreateCgw, ec2CreateVgw, ec2CreateVpn } from './services/vpn';
import { ec2CreateIgw, ec2CreateRouteTable, ec2CreateSubnet, ec2CreateVpc } from './services/vpc';
import type { Account, Ec2Instance, Tag } from './types';
import { ec2Id, iso } from './util';

const R = 'us-east-1';
const name = (n: string): Tag[] => [{ Key: 'Name', Value: n }];
const TRUST = (service: string) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow' as const, Principal: { Service: service }, Action: 'sts:AssumeRole' }] });

interface NetVpc {
  vpcId: string;
  subnetId: string;
  /** Tabla de rutas principal (la única de la VPC en estos escenarios). */
  rtbId: string;
  igwId?: string;
}

/** VPC con una subred /24 (pública con puerta de internet, o privada sin salida). */
function netVpc(a: Account, label: string, cidr: string, o: { public?: boolean; az?: number } = {}): NetVpc {
  const vpc = ec2CreateVpc(a, R, cidr, name(label));
  const r = regional(a, R).ec2;
  const rtb = Object.values(r.routeTables).find((t) => t.VpcId === vpc.VpcId)!;
  const base = cidr.split('.').slice(0, 2).join('.');
  const sn = ec2CreateSubnet(a, R, vpc.VpcId, `${base}.1.0/24`, o.az ?? 0, { public: !!o.public, tags: name(`${label}-sub`) });
  let igwId: string | undefined;
  if (o.public) {
    igwId = ec2CreateIgw(a, R, vpc.VpcId, name(`${label}-igw`)).InternetGatewayId;
    rtb.routes.push({ DestinationCidrBlock: '0.0.0.0/0', target: igwId, Origin: 'CreateRoute' });
  }
  return { vpcId: vpc.VpcId, subnetId: sn.SubnetId, rtbId: rtb.RouteTableId, igwId };
}

/** Servidor ya en marcha en una VPC de `netVpc`. */
function netHost(a: Account, v: NetVpc, host: string, sgs: string[], o: { profile?: string; ud?: string } = {}): Ec2Instance {
  const inst = ec2Launch(a, R, { type: 't3.micro', subnetId: v.subnetId, sgIds: sgs, tags: name(host), profile: o.profile, userData: o.ud });
  inst.state = 'running';
  inst.stateAt = a.clock - 3600000;
  inst.LaunchTime = iso(a.clock - 3600000);
  return inst;
}

const sg = (a: Account, v: NetVpc, n: string, ingress: { proto: string; from?: number; to?: number; cidr: string }[] = []) => ec2CreateSg(a, R, n, `Grupo ${n}`, ingress, v.vpcId).GroupId;

const WEB = (t: string) => `#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>${t}</h1>" > /var/www/html/index.html\n`;

export function makeNetScenarios(base: Scenario): Record<string, Scenario> {
  // ───────────── peering ─────────────

  /** Dos VPC sin conexión entre ellas: `app` (con web-1) y `datos` (con db-1, base de datos). */
  const peering: Scenario = (a) => {
    base(a);
    const app = netVpc(a, 'app', '10.0.0.0/16', { public: true });
    const datos = netVpc(a, 'datos', '10.1.0.0/16');
    netHost(a, app, 'app-1', [sg(a, app, 'app-sg', [{ proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }])]);
    netHost(a, datos, 'db-1', [sg(a, datos, 'db-sg')]);
  };

  /** El peering ya está activo y las rutas de `app` también, pero `datos` no sabe devolver las respuestas. */
  const peeringRoto: Scenario = (a) => {
    peering(a);
    const r = regional(a, R).ec2;
    const [app, datos] = ['app', 'datos'].map((n) => Object.values(r.vpcs).find((v) => v.Tags.some((t) => t.Value === n))!);
    const pcx = ec2CreatePeering(a, R, app.VpcId, datos.VpcId, { active: true, tags: name('app-datos') });
    const rt = Object.values(r.routeTables).find((t) => t.VpcId === app.VpcId)!;
    rt.routes.push({ DestinationCidrBlock: datos.CidrBlock, target: pcx.VpcPeeringConnectionId, Origin: 'CreateRoute' });
    const db = Object.values(r.securityGroups).find((g) => g.GroupName === 'db-sg')!;
    db.IpPermissions.push({ IpProtocol: 'tcp', FromPort: 3306, ToPort: 3306, IpRanges: [{ CidrIp: app.CidrBlock }], Ipv6Ranges: [], UserIdGroupPairs: [] });
  };

  // ───────────── Transit Gateway ─────────────

  /** Tres VPC con un servidor cada una: aplicación, datos y herramientas. Hay que conectarlas con un Transit Gateway. */
  const tgw: Scenario = (a) => {
    base(a);
    for (const [label, cidr, host, pub] of [['app', '10.0.0.0/16', 'app-1', true], ['datos', '10.1.0.0/16', 'db-1', false], ['herramientas', '10.2.0.0/16', 'tools-1', false]] as const) {
      const v = netVpc(a, label, cidr, { public: pub });
      netHost(a, v, host, [sg(a, v, `${label}-sg`, [{ proto: 'tcp', from: 22, to: 22, cidr: '10.0.0.0/8' }, { proto: 'tcp', from: 3306, to: 3306, cidr: '10.0.0.0/8' }, { proto: 'icmp', cidr: '10.0.0.0/8' }])]);
    }
  };

  /** Transit Gateway ya creado y con las tres VPC adjuntas (listo), pero ninguna VPC tiene rutas hacia él. */
  const tgwAdjuntas: Scenario = (a) => {
    tgw(a);
    const g = tgwCreate(a, R, { description: 'red central', ready: true, tags: name('central') });
    for (const v of Object.values(regional(a, R).ec2.vpcs).filter((x) => !x.IsDefault)) {
      const sn = Object.values(regional(a, R).ec2.subnets).find((s) => s.VpcId === v.VpcId)!;
      tgwAttachVpc(a, R, g.TransitGatewayId, v.VpcId, [sn.SubnetId], { ready: true });
    }
  };

  // ───────────── endpoints ─────────────

  /** VPC con una subred privada (sin internet) y un servidor que debe leer de S3 sin salir a internet. */
  const endpoints: Scenario = (a) => {
    base(a);
    const v = netVpc(a, 'tienda', '10.0.0.0/16');
    netHost(a, v, 'app-priv', [sg(a, v, 'app-sg')]);
    const b = s3CreateBucket(a, 'tienda-datos', R);
    s3Put(a, b, 'catalogo.csv', 'sku,nombre\n1,Camiseta\n2,Taza\n');
  };

  /** Un endpoint de interfaz de SQS ya creado, pero su security group no admite el puerto 443 de la VPC. */
  const endpointsSg: Scenario = (a) => {
    endpoints(a);
    const r = regional(a, R).ec2;
    const v = Object.values(r.vpcs).find((x) => x.Tags.some((t) => t.Value === 'tienda'))!;
    const sub = Object.values(r.subnets).find((s) => s.VpcId === v.VpcId)!;
    const epsg = ec2CreateSg(a, R, 'endpoint-sg', 'Endpoint de SQS', [], v.VpcId);
    ec2CreateEndpoint(a, R, { vpcId: v.VpcId, service: `com.amazonaws.${R}.sqs`, type: 'Interface', subnets: [sub.SubnetId], sgs: [epsg.GroupId], privateDns: true, ready: true });
  };

  // ───────────── VPN ─────────────

  /** VPC con una subred privada: la oficina (192.168.0.0/16, router 203.0.113.50) debe llegar a los servidores. */
  const vpn: Scenario = (a) => {
    base(a);
    const v = netVpc(a, 'tienda', '10.0.0.0/16');
    netHost(a, v, 'app-priv', [sg(a, v, 'app-sg', [{ proto: 'tcp', from: 22, to: 22, cidr: '10.0.0.0/16' }])]);
  };

  /** La VPN ya existe y está activa, pero la tabla de rutas no aprende las rutas y el security group no admite la oficina. */
  const vpnRota: Scenario = (a) => {
    vpn(a);
    const r = regional(a, R).ec2;
    const v = Object.values(r.vpcs).find((x) => x.Tags.some((t) => t.Value === 'tienda'))!;
    const cgw = ec2CreateCgw(a, R, '203.0.113.50', 65000, name('oficina'));
    const vgw = ec2CreateVgw(a, R, v.VpcId, name('vgw-tienda'));
    ec2CreateVpn(a, R, cgw.CustomerGatewayId, { vgw: vgw.VpnGatewayId, ready: true, tags: name('vpn-oficina') });
  };

  // ───────────── diagnóstico ─────────────

  /** Tres capas: web (pública), app (privada, puerto 8080) y base de datos. La web no llega a la app. Hay un rol de flow logs mal configurado y un log de tráfico viejo. */
  const diag: Scenario = (a) => {
    base(a);
    const vpc = ec2CreateVpc(a, R, '10.0.0.0/16', name('tienda'));
    const r = regional(a, R).ec2;
    const igw = ec2CreateIgw(a, R, vpc.VpcId, name('igw-tienda'));
    const pub = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.1.0/24', 0, { public: true, tags: name('publica') });
    const priv = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.2.0/24', 1, { tags: name('privada') });
    // la subred pública tiene su propia tabla con salida a internet; la privada usa la principal (solo ruta local)
    const rtbPub = ec2CreateRouteTable(a, R, vpc.VpcId, name('rt-publica'));
    rtbPub.routes.push({ DestinationCidrBlock: '0.0.0.0/0', target: igw.InternetGatewayId, Origin: 'CreateRoute' });
    rtbPub.associations.push({ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), SubnetId: pub.SubnetId, Main: false });
    void r;
    const webSg = ec2CreateSg(a, R, 'web-sg', 'Web', [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }, { proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }], vpc.VpcId);
    const appSg = ec2CreateSg(a, R, 'app-sg', 'Aplicación', [], vpc.VpcId);
    const dbSg = ec2CreateSg(a, R, 'db-sg', 'Base de datos', [], vpc.VpcId);
    appSg.IpPermissions.push({ IpProtocol: 'tcp', FromPort: 8081, ToPort: 8081, IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [{ GroupId: webSg.GroupId }] });
    dbSg.IpPermissions.push({ IpProtocol: 'tcp', FromPort: 3306, ToPort: 3306, IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [{ GroupId: appSg.GroupId }] });
    const mk = (n: string, subnetId: string, sgId: string, ud?: string) => {
      const i = ec2Launch(a, R, { type: 't3.micro', subnetId, sgIds: [sgId], tags: name(n), userData: ud });
      i.state = 'running';
      i.stateAt = a.clock - 3600000;
      i.LaunchTime = iso(a.clock - 3600000);
      return i;
    };
    const web = mk('web', pub.SubnetId, webSg.GroupId, WEB('Tienda'));
    mk('app', priv.SubnetId, appSg.GroupId);
    mk('db', priv.SubnetId, dbSg.GroupId);
    // el rol para entregar los flow logs tiene mal la relación de confianza (confía en EC2, no en vpc-flow-logs)
    iamCreateRole(a, 'flowlogs-role', TRUST('ec2.amazonaws.com'), { attached: ['CloudWatchLogsFullAccess'], description: 'Para entregar flow logs' });
    logsCreateGroup(a, R, '/vpc/tienda/historico');
    // una semana de tráfico: algunos clientes legítimos al 80 y una IP que machaca el puerto 22
    const eni = eniOfInstance(web);
    const t0 = a.clock - 6 * 3600000;
    const line = (src: string, port: number, pk: number, by: number, act: string, k: number) => `2 ${a.id} ${eni} ${src} ${web.PrivateIpAddress} ${40000 + k * 37} ${port} 6 ${pk} ${by} ${Math.floor((t0 + k * 60000) / 1000)} ${Math.floor((t0 + k * 60000) / 1000) + 59} ${act} OK`;
    for (let k = 0; k < 60; k++) {
      logsPut(a, R, '/vpc/tienda/historico', `${eni}-all`, line('198.51.100.23', 22, 12 + (k % 5), 840 + k, 'ACCEPT', k), t0 + k * 60000);
      if (k % 4 === 0) logsPut(a, R, '/vpc/tienda/historico', `${eni}-all`, line(['203.0.113.77', '192.0.2.14', '203.0.113.9'][k % 3], 80, 20, 5100, 'ACCEPT', k), t0 + k * 60000 + 5000);
      if (k % 9 === 0) logsPut(a, R, '/vpc/tienda/historico', `${eni}-all`, line('192.0.2.200', 3389, 2, 120, 'REJECT', k), t0 + k * 60000 + 9000);
    }
  };

  // ───────────── acceso seguro ─────────────

  /** Un servidor con el puerto 22 abierto a todo internet y sin acceso por Systems Manager. */
  const ssm: Scenario = (a) => {
    base(a);
    const v = netVpc(a, 'tienda', '10.0.0.0/16', { public: true });
    netHost(a, v, 'app-1', [sg(a, v, 'app-sg', [{ proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }, { proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }])], { ud: WEB('Tienda') });
  };

  /** Igual, y además el rol y el perfil de instancia para Systems Manager ya existen (falta asociarlo). */
  const ssmRol: Scenario = (a) => {
    ssm(a);
    iamCreateRole(a, 'ssm-ec2', TRUST('ec2.amazonaws.com'), { attached: ['AmazonSSMManagedInstanceCore'], description: 'Systems Manager para EC2' });
    a.iam.instanceProfiles['ssm-ec2'] = { InstanceProfileName: 'ssm-ec2', InstanceProfileId: 'AIPAEXAMPLE0SSMEC2', Arn: `arn:aws:iam::${a.id}:instance-profile/ssm-ec2`, Path: '/', CreateDate: iso(a.clock), roles: ['ssm-ec2'] };
  };

  /** VPC sin IPv6 y con dos subredes: una pública y otra privada (para dar IPv6 y salida solo-IPv6). */
  const ipv6: Scenario = (a) => {
    base(a);
    const v = netVpc(a, 'tienda', '10.0.0.0/16', { public: true });
    ec2CreateSubnet(a, R, v.vpcId, '10.0.2.0/24', 1, { tags: name('privada') });
  };

  // ───────────── misión final ─────────────

  /** La empresa: producción y desarrollo (cada una con su servidor), una VPC compartida (directorio) y la oficina. Todo sin conectar. */
  const sede: Scenario = (a) => {
    base(a);
    iamCreateRole(a, 'ssm-ec2', TRUST('ec2.amazonaws.com'), { attached: ['AmazonSSMManagedInstanceCore'] });
    a.iam.instanceProfiles['ssm-ec2'] = { InstanceProfileName: 'ssm-ec2', InstanceProfileId: 'AIPAEXAMPLE0SSMEC2', Arn: `arn:aws:iam::${a.id}:instance-profile/ssm-ec2`, Path: '/', CreateDate: iso(a.clock), roles: ['ssm-ec2'] };
    for (const [label, cidr, host] of [['prod', '10.0.0.0/16', 'app-prod'], ['dev', '10.1.0.0/16', 'app-dev'], ['compartida', '10.2.0.0/16', 'dir-1']] as const) {
      const v = netVpc(a, label, cidr, { public: label === 'prod' });
      netHost(a, v, host, [sg(a, v, `${label}-sg`, [{ proto: 'tcp', from: 22, to: 22, cidr: '10.0.0.0/8' }, { proto: 'tcp', from: 389, to: 389, cidr: '10.0.0.0/8' }, { proto: 'icmp', cidr: '10.0.0.0/8' }])]);
    }
  };

  return {
    'net-peering': peering,
    'net-peering-roto': peeringRoto,
    'net-tgw': tgw,
    'net-tgw-adjuntas': tgwAdjuntas,
    'net-endpoints': endpoints,
    'net-endpoints-sg': endpointsSg,
    'net-vpn': vpn,
    'net-vpn-rota': vpnRota,
    'net-diag': diag,
    'net-ssm': ssm,
    'net-ssm-rol': ssmRol,
    'net-ipv6': ipv6,
    'net-sede': sede,
  };
}
