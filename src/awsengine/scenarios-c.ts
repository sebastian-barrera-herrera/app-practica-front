/** Escenarios de la Fase C (nivel intermedio): alta disponibilidad, redes avanzadas, serverless, datos, IaC, contenedores, operaciones y seguridad. */
import { regional } from './account';
import { imageId } from './catalog';
import { asgCreate, launchFromTemplate } from './services/autoscaling';
import { cfCreate } from './services/edge';
import { elbCreateLb, elbCreateListener, elbCreateTg } from './services/elb';
import { ec2CreateSg, ec2Launch } from './services/ec2';
import { r53CreateZone } from './services/route53';
import { rdsCreate } from './services/rds';
import { s3CreateBucket, s3Put } from './services/s3';
import { ec2CreateIgw, ec2CreateRouteTable, ec2CreateSubnet, ec2CreateVpc } from './services/vpc';
import type { Scenario } from './scenarios';
import type { Account, LaunchTemplate, Tag } from './types';
import { ec2Id, iso } from './util';

const R = 'us-east-1';
const name = (n: string): Tag[] => [{ Key: 'Name', Value: n }];

const WEB_UD = (extra = 'echo "ok" > /var/www/html/health') => `#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Tienda - servidor $(hostname -f)</h1>" > /var/www/html/index.html\n${extra}\n`;

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

interface HaOpts {
  /** Usa la VPC por defecto en lugar de una VPC propia. */
  defaultVpc?: boolean;
  /** Lanza dos servidores web (uno por zona). */
  servers?: boolean;
  /** Crea el balanceador con su grupo de destino y oyente. */
  alb?: boolean;
  /** Ruta de la comprobación de salud (por defecto `/`). */
  hcPath?: string;
  /** El user data no crea `/health`. */
  noHealthFile?: boolean;
  /** El grupo de seguridad de los servidores NO admite al balanceador. */
  brokenSg?: boolean;
  /** Crea la plantilla de lanzamiento `web-lt`. */
  template?: boolean;
  /** Crea el grupo de Auto Scaling `web` (ya en marcha). */
  asg?: { min: number; max: number; desired: number; zones?: 1 | 2; policy?: boolean };
  /** Balanceador sin servidores registrados (para crear el ASG encima). */
  emptyTg?: boolean;
}

/** VPC `tienda` (o la por defecto) con dos subredes públicas, grupos de seguridad y, según se pida, servidores, balanceador y Auto Scaling. */
function haWorld(a: Account, o: HaOpts) {
  let vpcId: string;
  let subA: string;
  let subB: string;
  if (o.defaultVpc) {
    const r = regional(a, R).ec2;
    const v = Object.values(r.vpcs).find((x) => x.IsDefault)!;
    vpcId = v.VpcId;
    const subs = Object.values(r.subnets).filter((s) => s.VpcId === vpcId).sort((x, y) => (x.AvailabilityZone < y.AvailabilityZone ? -1 : 1));
    subA = subs[0].SubnetId;
    subB = subs[1].SubnetId;
  } else {
    const vpc = ec2CreateVpc(a, R, '10.0.0.0/16', name('tienda'));
    vpcId = vpc.VpcId;
    const igw = ec2CreateIgw(a, R, vpc.VpcId, name('igw-tienda'));
    const pa = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.1.0/24', 0, { public: true, tags: name('publica-a') });
    const pb = ec2CreateSubnet(a, R, vpc.VpcId, '10.0.2.0/24', 1, { public: true, tags: name('publica-b') });
    const rt = ec2CreateRouteTable(a, R, vpc.VpcId, name('rt-publica'));
    rt.routes.push({ DestinationCidrBlock: '0.0.0.0/0', target: igw.InternetGatewayId, Origin: 'CreateRoute' });
    for (const s of [pa, pb]) rt.associations.push({ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), SubnetId: s.SubnetId, Main: false });
    subA = pa.SubnetId;
    subB = pb.SubnetId;
  }
  const albSg = ec2CreateSg(a, R, 'alb-sg', 'Balanceador de la tienda', [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }], vpcId);
  const webSg = ec2CreateSg(a, R, 'web-sg', 'Servidores web de la tienda', [], vpcId);
  if (!o.brokenSg) webSg.IpPermissions.push({ IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [{ GroupId: albSg.GroupId }] });
  const ud = WEB_UD(o.noHealthFile ? '' : undefined);
  const servers: string[] = [];
  if (o.servers) {
    for (const [sub, n] of [[subA, 'web-a'], [subB, 'web-b']] as const) {
      const inst = ec2Launch(a, R, { type: 't3.micro', subnetId: sub, sgIds: [webSg.GroupId], tags: name(n), userData: ud });
      inst.LaunchTime = iso(a.clock - 3600000);
      servers.push(inst.InstanceId);
    }
  }
  let tgArn = '';
  let lbArn = '';
  if (o.alb) {
    const tg = elbCreateTg(a, R, { name: 'web-tg', vpcId, path: o.hcPath, targets: o.emptyTg ? [] : servers });
    tgArn = tg.TargetGroupArn;
    const lb = elbCreateLb(a, R, { name: 'tienda-alb', subnets: [subA, subB], sgs: [albSg.GroupId], age: 600000 });
    lbArn = lb.LoadBalancerArn;
    elbCreateListener(a, R, lb, { port: 80, protocol: 'HTTP', actions: [{ Type: 'forward', TargetGroupArn: tg.TargetGroupArn }] });
  }
  let lt: LaunchTemplate | undefined;
  if (o.template || o.asg) {
    const id = ec2Id(a, 'lt');
    const data = { ImageId: imageId(R, 'al2023-x86'), InstanceType: 't3.micro', SecurityGroupIds: [webSg.GroupId], UserData: b64(ud), TagSpecifications: [{ ResourceType: 'instance', Tags: name('web-asg') }] };
    lt = { LaunchTemplateId: id, LaunchTemplateName: 'web-lt', CreateTime: iso(a.clock), DefaultVersionNumber: 1, LatestVersionNumber: 1, versions: [{ VersionNumber: 1, VersionDescription: 'primera versión', LaunchTemplateData: data, CreateTime: iso(a.clock) }], Tags: [] };
    (regional(a, R).launchTemplates ??= {})[id] = lt;
  }
  return { vpcId, subA, subB, albSg, webSg, servers, tgArn, lbArn, lt };
}

/** Lanza ya en marcha las instancias de un grupo de Auto Scaling (para no tener que esperar al arrancar la práctica). */
function seedAsg(a: Account, w: ReturnType<typeof haWorld>, o: NonNullable<HaOpts['asg']>) {
  const subnets = o.zones === 1 ? [w.subA] : [w.subA, w.subB];
  const g = asgCreate(a, R, { name: 'web', lt: w.lt!, min: o.min, max: o.max, desired: o.desired, subnetIds: subnets, tgs: w.tgArn ? [w.tgArn] : [], hc: w.tgArn ? 'ELB' : 'EC2', grace: 60, tags: [{ Key: 'Name', Value: 'web-asg', PropagateAtLaunch: true }], launch: false });
  const r = regional(a, R).ec2;
  const tg = w.tgArn ? regional(a, R).elb!.tgs[w.tgArn] : undefined;
  for (let k = 0; k < o.desired; k++) {
    const sub = subnets[k % subnets.length];
    const inst = launchFromTemplate(a, R, w.lt!, '$Default', sub, [{ Key: 'aws:autoscaling:groupName', Value: 'web' }, { Key: 'Name', Value: 'web-asg' }]);
    inst.state = 'running';
    inst.stateAt = a.clock - 900000;
    inst.LaunchTime = iso(a.clock - 900000);
    g.instances.push({ InstanceId: inst.InstanceId, AvailabilityZone: r.subnets[sub].AvailabilityZone, LifecycleState: 'InService', HealthStatus: 'Healthy', since: a.clock - 900000, ProtectedFromScaleIn: false });
    tg?.targets.push({ Id: inst.InstanceId, Port: tg.Port, registeredAt: a.clock - 900000 });
  }
  g.lastEval = a.clock;
  if (o.policy) {
    const arn = `arn:aws:autoscaling:${R}:${a.id}:scalingPolicy:seed:autoScalingGroupName/web:policyName/cpu50`;
    g.policies.cpu50 = { PolicyName: 'cpu50', PolicyARN: arn, PolicyType: 'TargetTrackingScaling', TargetTrackingConfiguration: { PredefinedMetricSpecification: { PredefinedMetricType: 'ASGAverageCPUUtilization' }, TargetValue: 50 }, Enabled: true };
  }
  return g;
}

export function makeCScenarios(base: Scenario): Record<string, Scenario> {
  // ───────────── Z8: alta disponibilidad ─────────────

  /** Dos servidores web (uno por zona) detrás de nada: todavía sin balanceador. */
  const haBase: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true });
  };

  /** Todo funciona: balanceador, grupo de destino con los dos servidores y oyente en el 80. */
  const haAlb: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true, alb: true });
  };

  /** La comprobación de salud pide `/estado`, una página que los servidores no tienen. */
  const haAlbRoto: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true, alb: true, hcPath: '/estado' });
  };

  /** Los servidores no admiten al grupo de seguridad del balanceador (Target.Timeout). */
  const haAlbSg: Scenario = (a) => {
    base(a);
    haWorld(a, { servers: true, alb: true, brokenSg: true });
  };

  /** Balanceador y plantilla de lanzamiento listos, sin servidores ni grupo: falta crear el Auto Scaling. */
  const haAsg: Scenario = (a) => {
    base(a);
    haWorld(a, { alb: true, emptyTg: true, template: true });
  };

  /** Un grupo de Auto Scaling ya en marcha (2 instancias en 2 zonas) con política de CPU al 50 %. */
  const haAsgVivo: Scenario = (a) => {
    base(a);
    const w = haWorld(a, { alb: true, emptyTg: true, template: true });
    seedAsg(a, w, { min: 2, max: 6, desired: 2, policy: true });
  };

  /** Grupo en marcha sin política de escalado (para crearla y probarla con carga). */
  const haAsgSinPolitica: Scenario = (a) => {
    base(a);
    const w = haWorld(a, { alb: true, emptyTg: true, template: true });
    seedAsg(a, w, { min: 2, max: 6, desired: 2 });
  };

  /** Una arquitectura con tres puntos únicos de fallo: grupo de una sola zona con mínimo 1 y base de datos sin Multi-AZ. */
  const haSpof: Scenario = (a) => {
    base(a);
    const w = haWorld(a, { defaultVpc: true, alb: true, emptyTg: true, template: true });
    seedAsg(a, w, { min: 1, max: 3, desired: 1, zones: 1 });
    rdsCreate(a, R, 'tienda-db', { engine: 'mysql', cls: 'db.t3.micro', multiAz: false });
  };

  /** Misión final: VPC, grupos de seguridad y plantilla; hay que montar balanceador, Auto Scaling y DNS. */
  const haTienda: Scenario = (a) => {
    base(a);
    haWorld(a, { template: true });
    r53CreateZone(a, 'tienda.test', { comment: 'Zona de la tienda' });
  };

  /** Dos servidores en regiones distintas (Virginia e Irlanda) y una zona DNS: para practicar políticas de enrutamiento. */
  const dnsHa: Scenario = (a) => {
    base(a);
    r53CreateZone(a, 'tienda.test');
    for (const [region, label, key] of [['us-east-1', 'Virginia', 'web-us'], ['eu-west-1', 'Irlanda', 'web-eu']] as const) {
      const r = regional(a, region).ec2;
      const vpc = Object.values(r.vpcs).find((x) => x.IsDefault)!;
      const sg = ec2CreateSg(a, region, 'web-abierto', 'HTTP para todos', [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }], vpc.VpcId);
      const inst = ec2Launch(a, region, { type: 't3.micro', sgIds: [sg.GroupId], tags: name(key), userData: `#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Hola desde ${label}</h1>" > /var/www/html/index.html\n` });
      inst.LaunchTime = iso(a.clock - 3600000);
    }
  };

  /** Failover ya montado, pero el grupo de seguridad del primario solo admite la IP del alumno: los comprobadores de Route 53 no llegan. */
  const dnsFailover: Scenario = (a) => {
    dnsHa(a);
    const z = Object.values(a.route53!.zones)[0];
    const find = (region: string, key: string) => Object.values(regional(a, region).ec2.instances).find((i) => i.Tags.some((t) => t.Key === 'Name' && t.Value === key))!;
    const us = find('us-east-1', 'web-us');
    const eu = find('eu-west-1', 'web-eu');
    const sg = Object.values(regional(a, 'us-east-1').ec2.securityGroups).find((g) => g.GroupName === 'web-abierto')!;
    sg.IpPermissions = [{ IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '203.0.113.25/32' }], Ipv6Ranges: [], UserIdGroupPairs: [] }];
    const hcId = 'a1b2c3d4-0000-4000-8000-0000000000aa';
    (a.route53!.healthChecks ??= {})[hcId] = { Id: hcId, CallerReference: 'seed', HealthCheckConfig: { Type: 'HTTP', IPAddress: us.PublicIpAddress, Port: 80, ResourcePath: '/', RequestInterval: 10, FailureThreshold: 3 }, HealthCheckVersion: 1, Tags: [], state: { probe: false, reported: false, since: a.clock - 3600000, lastEval: a.clock } };
    z.records.push({ Name: 'www.tienda.test.', Type: 'A', TTL: 60, SetIdentifier: 'primario', Failover: 'PRIMARY', HealthCheckId: hcId, ResourceRecords: [{ Value: us.PublicIpAddress! }] });
    z.records.push({ Name: 'www.tienda.test.', Type: 'A', TTL: 60, SetIdentifier: 'secundario', Failover: 'SECONDARY', ResourceRecords: [{ Value: eu.PublicIpAddress! }] });
  };

  /** Un bucket privado con la web de la tienda: falta ponerle CloudFront delante. */
  const cdn: Scenario = (a) => {
    base(a);
    const b = s3CreateBucket(a, 'tienda-estaticos', R);
    s3Put(a, b, 'index.html', '<h1>Tienda v1</h1>\n');
    s3Put(a, b, 'css/estilo.css', 'body { font-family: sans-serif }\n');
  };

  /** Distribución ya desplegada que tiene en caché una versión vieja de la portada (hay que invalidar). */
  const cdnVivo: Scenario = (a) => {
    base(a);
    const b = s3CreateBucket(a, 'tienda-estaticos', R, { publicAccessBlock: null });
    b.policy = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::tienda-estaticos/*' }] };
    s3Put(a, b, 'index.html', '<h1>Tienda v1</h1>\n');
    const d = cfCreate(a, { Origins: [{ Id: 'bucket', DomainName: 'tienda-estaticos.s3.amazonaws.com' }], DefaultCacheBehavior: { TargetOriginId: 'bucket', ViewerProtocolPolicy: 'allow-all' }, DefaultRootObject: 'index.html', Enabled: true, Comment: 'Web de la tienda' });
    d.deployedAt = a.clock - 600000;
    d.cache['/index.html'] = { at: a.clock - 3600000, status: 200, type: 'text/html', body: '<h1>Tienda v1</h1>\n', headers: { ETag: '"v1"', Server: 'AmazonS3' } };
    // el equipo ya ha publicado la v2 en el bucket, pero la caché de borde sigue con la v1
    s3Put(a, b, 'index.html', '<h1>Tienda v2 - rebajas</h1>\n');
  };

  return {
    'ha-base': haBase,
    'ha-alb': haAlb,
    'ha-alb-roto': haAlbRoto,
    'ha-alb-sg': haAlbSg,
    'ha-asg': haAsg,
    'ha-asg-vivo': haAsgVivo,
    'ha-asg-sin-politica': haAsgSinPolitica,
    'ha-spof': haSpof,
    'ha-tienda': haTienda,
    'dns-ha': dnsHa,
    'dns-failover': dnsFailover,
    cdn,
    'cdn-vivo': cdnVivo,
  };
}

