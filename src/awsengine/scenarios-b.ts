/** Escenarios de la Fase B: redes (VPC), bases de datos y costes. Se registran desde `scenarios.ts`. */
import { regional } from './account';
import { ddbCreate } from './services/dynamodb';
import { r53CreateZone, r53Put } from './services/route53';
import { seedBilling } from './services/billing';
import { orgAddAccount, orgCreate } from './services/govern';
import { rdsCreate } from './services/rds';
import { s3CreateBucket, s3Put } from './services/s3';
import { ec2CreateKey, ec2CreateSg, ec2CreateVolume, ec2Launch, publicIpFor } from './services/ec2';
import { ec2CreateIgw, ec2CreateNat, ec2CreateRouteTable, ec2CreateSubnet, ec2CreateVpc } from './services/vpc';
import type { Scenario } from './scenarios';
import type { Account, Tag } from './types';
import { ec2Id } from './util';

const R = 'us-east-1';
const name = (n: string): Tag[] => [{ Key: 'Name', Value: n }];
const WEB_UD = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Bienvenido a mi VPC</h1>" > /var/www/html/index.html\n';

interface NetOpts {
  /** La internet gateway está conectada a la VPC. */
  attach?: boolean;
  /** Hay una tabla de rutas pública (0.0.0.0/0 → IGW) asociada a la subred pública. */
  route?: boolean;
  /** NACL de la subred pública: por defecto (todo permitido) o una que deniega el puerto 80. */
  nacl?: 'default' | 'deny80';
  /** El grupo de seguridad de la web deja entrar el puerto 80 a todo el mundo. */
  sg?: 'open' | 'closed';
  /** Segunda subred pública y servidor de aplicación privado. */
  full?: boolean;
}

/** VPC `produccion` (10.0.0.0/16) con una subred pública, una privada y un servidor web. */
function webVpc(a: Account, o: NetOpts) {
  const vpc = ec2CreateVpc(a, R, '10.0.0.0/16', name('produccion'));
  const r = regional(a, R).ec2;
  const pubA = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.1.0/24', 0, { public: true, tags: name('publica-a') });
  const priv = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.2.0/24', 0, { tags: name('privada-a') });
  const igw = ec2CreateIgw(a, R, o.attach ? vpc.VpcId : undefined, name('igw-produccion'));
  let pubRt;
  if (o.route) {
    pubRt = ec2CreateRouteTable(a, R, vpc.VpcId, name('rt-publica'));
    pubRt.routes.push({ DestinationCidrBlock: '0.0.0.0/0', target: igw.InternetGatewayId, Origin: 'CreateRoute' });
    pubRt.associations.push({ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), SubnetId: pubA.SubnetId, Main: false });
  }
  if (o.full) {
    const pubB = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.3.0/24', 1, { public: true, tags: name('publica-b') });
    pubRt?.associations.push({ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), SubnetId: pubB.SubnetId, Main: false });
  }
  if (o.nacl === 'deny80') {
    const id = ec2Id(a, 'acl');
    r.networkAcls[id] = {
      NetworkAclId: id,
      VpcId: vpc.VpcId,
      IsDefault: false,
      Entries: [
        { RuleNumber: 90, Protocol: '6', RuleAction: 'deny', Egress: false, CidrBlock: '0.0.0.0/0', PortRange: { From: 80, To: 80 } },
        { RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: false, CidrBlock: '0.0.0.0/0' },
        { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: false, CidrBlock: '0.0.0.0/0' },
        { RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: true, CidrBlock: '0.0.0.0/0' },
        { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: true, CidrBlock: '0.0.0.0/0' },
      ],
      subnets: [pubA.SubnetId],
      Tags: name('nacl-publica'),
    };
    for (const n of Object.values(r.networkAcls)) if (n.IsDefault && n.VpcId === vpc.VpcId) n.subnets = n.subnets.filter((s) => s !== pubA.SubnetId);
  }
  const sg = ec2CreateSg(a, R, 'web-sg', 'Servidor web de produccion', o.sg === 'closed' ? [] : [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }], vpc.VpcId);
  const web = ec2Launch(a, R, { type: 't3.micro', subnetId: pubA.SubnetId, sgIds: [sg.GroupId], tags: name('web-prod'), userData: WEB_UD });
  if (o.full) {
    const appSg = ec2CreateSg(a, R, 'app-sg', 'Aplicacion privada', [{ proto: 'tcp', from: 8080, to: 8080, cidr: '10.0.1.0/24' }], vpc.VpcId);
    ec2Launch(a, R, { type: 't3.micro', subnetId: priv.SubnetId, sgIds: [appSg.GroupId], tags: name('app-privada') });
  }
  return { vpc, pubA, priv, igw, web, sg };
}

const S = (v: string) => ({ S: v });
const N = (v: number) => ({ N: String(v) });

export function makeBScenarios(base: Scenario): Record<string, Scenario> {
/** Una web que funciona de principio a fin (para ver cómo debe quedar). */
const redOk: Scenario = (a) => {
  base(a);
  webVpc(a, { attach: true, route: true, full: true });
};

/** La web no responde: hay una internet gateway, pero ni siquiera está conectada a la VPC. */
const redIgw: Scenario = (a) => {
  base(a);
  webVpc(a, { attach: false, route: false });
};

/** La IGW ya está conectada, pero la subred no tiene ruta hacia ella. */
const redRuta: Scenario = (a) => {
  base(a);
  webVpc(a, { attach: true, route: false });
};

/** Red y rutas bien, pero una NACL deniega el puerto 80. */
const redNacl: Scenario = (a) => {
  base(a);
  webVpc(a, { attach: true, route: true, nacl: 'deny80' });
};

/** Todo bien salvo el grupo de seguridad (sin regla de entrada). */
const redSg: Scenario = (a) => {
  base(a);
  webVpc(a, { attach: true, route: true, sg: 'closed' });
};

/** Misión final: web sin salida, sin ruta pública, con el grupo cerrado y el NAT puesto en la subred privada. */
const redDosCapas: Scenario = (a) => {
  base(a);
  const { vpc, priv } = webVpc(a, { attach: false, route: false, sg: 'closed', full: true });
  const r = regional(a, R).ec2;
  const alloc = ec2Id(a, 'eipalloc');
  r.addresses[alloc] = { AllocationId: alloc, PublicIp: publicIpFor(alloc), Tags: [] };
  const nat = ec2CreateNat(a, R, priv.SubnetId, alloc, name('nat-mal-puesto'));
  const rt = ec2CreateRouteTable(a, R, vpc.VpcId, name('rt-privada'));
  rt.routes.push({ DestinationCidrBlock: '0.0.0.0/0', target: nat.NatGatewayId, Origin: 'CreateRoute' });
  rt.associations.push({ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), SubnetId: priv.SubnetId, Main: false });
};

/** Una tabla de pedidos con datos y un índice por estado. */
const ddbPedidos: Scenario = (a) => {
  base(a);
  ddbCreate(a, 'us-east-1', 'Pedidos', {
    pk: ['cliente', 'S'],
    sk: ['fecha', 'S'],
    gsi: [{ name: 'por-estado', pk: ['estado', 'S'], sk: ['fecha', 'S'] }],
    items: [
      { cliente: S('ana'), fecha: S('2026-01-05'), estado: S('enviado'), importe: N(30), articulos: { L: [S('teclado'), S('ratón')] } },
      { cliente: S('ana'), fecha: S('2026-02-10'), estado: S('pendiente'), importe: N(12.5) },
      { cliente: S('ana'), fecha: S('2026-03-01'), estado: S('pendiente'), importe: N(99) },
      { cliente: S('bob'), fecha: S('2026-01-20'), estado: S('enviado'), importe: N(7) },
      { cliente: S('carla'), fecha: S('2026-02-14'), estado: S('cancelado'), importe: N(45) },
    ],
  });
};

/** Sin índice secundario: para añadirlo después. */
const ddbSimple: Scenario = (a) => {
  base(a);
  ddbCreate(a, 'us-east-1', 'Pedidos', {
    pk: ['cliente', 'S'],
    sk: ['fecha', 'S'],
    items: [
      { cliente: S('ana'), fecha: S('2026-01-05'), estado: S('enviado'), importe: N(30) },
      { cliente: S('ana'), fecha: S('2026-02-10'), estado: S('pendiente'), importe: N(12.5) },
      { cliente: S('bob'), fecha: S('2026-01-20'), estado: S('enviado'), importe: N(7) },
      { cliente: S('carla'), fecha: S('2026-02-14'), estado: S('pendiente'), importe: N(45) },
    ],
  });
};

/** Sesiones de usuario con caducidad (para el TTL). */
const ddbSesiones: Scenario = (a) => {
  base(a);
  ddbCreate(a, 'us-east-1', 'Sesiones', {
    pk: ['sesion', 'S'],
    items: [
      { sesion: S('s-1001'), usuario: S('ana'), expira: N(1773500000) },
      { sesion: S('s-1002'), usuario: S('bob'), expira: N(1773503600) },
    ],
  });
};

/** Una base de datos «de producción» que nació sin cuidados: un solo servidor, sin copias y abierta a internet. */
const rdsProd: Scenario = (a) => {
  base(a);
  rdsCreate(a, 'us-east-1', 'prod-db', { cls: 'db.t3.small', engine: 'mysql', storage: 50, backup: 0, public: true, tags: [{ Key: 'Entorno', Value: 'prod' }] });
};

/** Una base ya protegida y una réplica por crear. */
const rdsBase: Scenario = (a) => {
  base(a);
  rdsCreate(a, 'us-east-1', 'tienda-db', { cls: 'db.t3.micro', engine: 'mysql', storage: 20, backup: 7, tags: [{ Key: 'Entorno', Value: 'prod' }] });
};

/** Una factura de verdad: servidores sin etiquetar, discos huérfanos, un NAT que nadie usa, una base Multi-AZ de desarrollo… */
const factura: Scenario = (a) => {
  base(a);
  const R1 = 'us-east-1';
  ec2CreateKey(a, R1, 'clave-curso');
  const web = ec2Launch(a, R1, { type: 't3.small', tags: [{ Key: 'Name', Value: 'web-prod' }, { Key: 'Proyecto', Value: 'tienda' }, { Key: 'Entorno', Value: 'prod' }] });
  ec2Launch(a, R1, { type: 'm5.xlarge', tags: [{ Key: 'Name', Value: 'batch-olvidado' }] });
  ec2Launch(a, R1, { type: 't3.micro', state: 'stopped', tags: [{ Key: 'Name', Value: 'pruebas' }, { Key: 'Proyecto', Value: 'tienda' }, { Key: 'Entorno', Value: 'dev' }] });
  ec2CreateVolume(a, R1, { az: web.AvailabilityZone, size: 200, tags: [{ Key: 'Name', Value: 'copia-vieja' }] });
  const vpc = ec2CreateVpc(a, R1, '10.9.0.0/16', [{ Key: 'Name', Value: 'tienda-vpc' }, { Key: 'Proyecto', Value: 'tienda' }]);
  const sn = ec2CreateSubnet(a, R1, vpc.VpcId, '10.9.1.0/24', 0, { public: true, tags: [{ Key: 'Name', Value: 'publica' }] });
  const r = regional(a, R1).ec2;
  const alloc = ec2Id(a, 'eipalloc');
  r.addresses[alloc] = { AllocationId: alloc, PublicIp: publicIpFor(alloc), Tags: [{ Key: 'Name', Value: 'nat-eip' }] };
  ec2CreateNat(a, R1, sn.SubnetId, alloc, [{ Key: 'Name', Value: 'nat-dev' }, { Key: 'Proyecto', Value: 'tienda' }, { Key: 'Entorno', Value: 'dev' }]);
  const idle = ec2Id(a, 'eipalloc');
  r.addresses[idle] = { AllocationId: idle, PublicIp: publicIpFor(idle), Tags: [] };
  rdsCreate(a, R1, 'tienda-prod', { cls: 'db.m5.large', storage: 100, multiAz: true, tags: [{ Key: 'Proyecto', Value: 'tienda' }, { Key: 'Entorno', Value: 'prod' }] });
  rdsCreate(a, R1, 'tienda-dev', { cls: 'db.r5.large', storage: 100, multiAz: true, tags: [{ Key: 'Proyecto', Value: 'tienda' }, { Key: 'Entorno', Value: 'dev' }] });
  const b = s3CreateBucket(a, 'tienda-medios', R1);
  s3Put(a, b, 'catalogo/todo.zip', 'x', { size: 800_000_000_000 });
  b.tags = [{ Key: 'Proyecto', Value: 'tienda' }];
  seedBilling(a, 45, [{ service: 'AWS Support (Business)', usageType: 'Support', monthly: 100 }]);
};

/** Una organización con dos cuentas miembro. */
const orgDemo: Scenario = (a) => {
  base(a);
  orgCreate(a, 'ALL');
  orgAddAccount(a, 'desarrollo', 'dev@ejemplo.com');
  orgAddAccount(a, 'produccion', 'prod@ejemplo.com');
};

/** Plan Business con cosas que Trusted Advisor señala. */
const soporte: Scenario = (a) => {
  base(a);
  a.supportPlan = 'business';
  const sg = ec2CreateSg(a, 'us-east-1', 'ssh-abierto', 'SSH para todos', [{ proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }]);
  ec2Launch(a, 'us-east-1', { type: 't3.micro', sgIds: [sg.GroupId], tags: [{ Key: 'Name', Value: 'bastion' }] });
  ec2Launch(a, 'us-east-1', { type: 'm5.xlarge', tags: [{ Key: 'Name', Value: 'sobredimensionado' }] });
  const r = regional(a, 'us-east-1').ec2;
  const alloc = ec2Id(a, 'eipalloc');
  r.addresses[alloc] = { AllocationId: alloc, PublicIp: publicIpFor(alloc), Tags: [] };
  const b = s3CreateBucket(a, 'datos-publicos', 'us-east-1', { publicAccessBlock: null });
  s3Put(a, b, 'a.txt', 'a');
  b.policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::datos-publicos/*' }] };
};

/** Una zona DNS con su web y su correo (para practicar registros). */
const dnsDemo: Scenario = (a) => {
  base(a);
  r53CreateZone(a, 'ejemplo.com', { comment: 'Zona de demostración' });
  r53Put(a, 'ejemplo.com', 'ejemplo.com', 'A', '203.0.113.10');
  r53Put(a, 'ejemplo.com', 'www.ejemplo.com', 'A', '203.0.113.10');
  r53Put(a, 'ejemplo.com', 'ejemplo.com', 'MX', '10 correo.ejemplo.com', 3600);
};

return {
  'ddb-simple': ddbSimple,
  'ddb-sesiones': ddbSesiones,
  'dns-demo': dnsDemo,
  'ddb-pedidos': ddbPedidos,
  'rds-prod': rdsProd,
  'rds-base': rdsBase,
  factura,
  'org-demo': orgDemo,
  soporte,
  'red-ok': redOk,
  'red-igw': redIgw,
  'red-ruta': redRuta,
  'red-nacl': redNacl,
  'red-sg': redSg,
  'red-dos-capas': redDosCapas,
};
}
