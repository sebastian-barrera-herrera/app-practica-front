/** Redes de EC2: VPC, subredes, internet gateways, tablas de rutas, NAT gateways y NACL. */
import { azName, defaultNaclEntries, regional } from '../account';
import { regionInfo } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Ec2Region, NaclEntry, NatGateway, NetworkAcl, RouteTable, Subnet, Tag, Vpc } from '../types';
import { cidrCanonical, cidrOverlap, cidrWithin, ec2Id, iso, parseCidr, stableId } from '../util';
import { filterOk, refreshEc2, subnetView, tagGetter, tagsFor } from './ec2';

// ───────────────────────── errores ─────────────────────────

const E = {
  vpc: (id: string) => new AwsError('InvalidVpcID.NotFound', `The vpc ID '${id}' does not exist`),
  subnet: (id: string) => new AwsError('InvalidSubnetID.NotFound', `The subnet ID '${id}' does not exist`),
  igw: (id: string) => new AwsError('InvalidInternetGatewayID.NotFound', `The internetGateway ID '${id}' does not exist`),
  rtb: (id: string) => new AwsError('InvalidRouteTableID.NotFound', `The routeTable ID '${id}' does not exist`),
  nat: (id: string) => new AwsError('NatGatewayNotFound', `The Nat Gateway '${id}' does not exist.`),
  acl: (id: string) => new AwsError('InvalidNetworkAclID.NotFound', `The networkAcl ID '${id}' does not exist`),
  dep: (kind: string, id: string) => new AwsError('DependencyViolation', `The ${kind} '${id}' has dependencies and cannot be deleted.`),
};

const arn = (c: OpCtx, type: string, id = '*') => `arn:aws:ec2:${c.region}:${c.acct.id}:${type}/${id}`;

function vpcOf(r: Ec2Region, id: string): Vpc {
  const v = r.vpcs[id];
  if (!v) throw E.vpc(id);
  return v;
}

const dopt = (region: string) => 'dopt-' + stableId(`dopt:${region}`, '', 8);

// ───────────────────────── VPC ─────────────────────────

const vpcView = (c: OpCtx, v: Vpc, state = 'available') => ({
  OwnerId: c.acct.id,
  InstanceTenancy: 'default',
  Ipv6CidrBlockAssociationSet: [] as unknown[],
  CidrBlockAssociationSet: [{ AssociationId: stableId(`vpcassoc:${v.VpcId}`, 'vpc-cidr-assoc-', 8), CidrBlock: v.CidrBlock, CidrBlockState: { State: 'associated' } }],
  IsDefault: v.IsDefault,
  Tags: v.Tags,
  VpcId: v.VpcId,
  State: state,
  CidrBlock: v.CidrBlock,
  DhcpOptionsId: dopt(c.region),
});

/** Crea una VPC con su tabla de rutas principal, su NACL por defecto y su grupo de seguridad por defecto. */
export function ec2CreateVpc(a: Account, region: string, cidr: string, tags: Tag[] = []): Vpc {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'vpc');
  const vpc: Vpc = { VpcId: id, CidrBlock: cidr, IsDefault: false, Tags: tags, EnableDnsSupport: true, EnableDnsHostnames: false };
  r.vpcs[id] = vpc;
  const rtb = ec2Id(a, 'rtb');
  r.routeTables[rtb] = { RouteTableId: rtb, VpcId: id, routes: [{ DestinationCidrBlock: cidr, target: 'local', Origin: 'CreateRouteTable' }], associations: [{ RouteTableAssociationId: ec2Id(a, 'rtbassoc'), Main: true }], Tags: [] };
  const acl = ec2Id(a, 'acl');
  r.networkAcls[acl] = { NetworkAclId: acl, VpcId: id, IsDefault: true, Entries: defaultNaclEntries(), subnets: [], Tags: [] };
  const sg = ec2Id(a, 'sg');
  r.securityGroups[sg] = {
    GroupId: sg,
    GroupName: 'default',
    Description: 'default VPC security group',
    VpcId: id,
    IpPermissions: [{ IpProtocol: '-1', IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [{ GroupId: sg }] }],
    IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], UserIdGroupPairs: [] }],
    Tags: [],
  };
  return vpc;
}

/** Crea una subred (sin comprobar los límites: para escenarios). Se asocia a la NACL por defecto de su VPC. */
export function ec2CreateSubnet(a: Account, region: string, vpcId: string, cidr: string, azIndex = 0, o: { public?: boolean; tags?: Tag[] } = {}): Subnet {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'subnet');
  const sn: Subnet = { SubnetId: id, VpcId: vpcId, CidrBlock: cidr, AvailabilityZone: azName(region, azIndex), MapPublicIpOnLaunch: !!o.public, DefaultForAz: false, Tags: o.tags ?? [] };
  r.subnets[id] = sn;
  Object.values(r.networkAcls).find((n) => n.VpcId === vpcId && n.IsDefault)?.subnets.push(id);
  return sn;
}

export function ec2CreateIgw(a: Account, region: string, vpcId?: string, tags: Tag[] = []) {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'igw');
  r.internetGateways[id] = { InternetGatewayId: id, VpcId: vpcId, Tags: tags };
  return r.internetGateways[id];
}

export function ec2CreateRouteTable(a: Account, region: string, vpcId: string, tags: Tag[] = []): RouteTable {
  const r = regional(a, region).ec2;
  const vpc = vpcOf(r, vpcId);
  const id = ec2Id(a, 'rtb');
  r.routeTables[id] = { RouteTableId: id, VpcId: vpcId, routes: [{ DestinationCidrBlock: vpc.CidrBlock, target: 'local', Origin: 'CreateRouteTable' }], associations: [], Tags: tags };
  return r.routeTables[id];
}

op('ec2', 'create-vpc', 'cidr-block:s! tag-specifications:f instance-tenancy:s dry-run:b', 'Crea una VPC: tu red privada virtual en AWS.', { dryRun: true, res: (c) => arn(c, 'vpc') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const cidr = c.p.CidrBlock as string;
  const pc = parseCidr(cidr);
  if (!pc || !cidrCanonical(cidr)) throw new AwsError('InvalidParameterValue', `Value (${cidr}) for parameter cidrBlock is invalid. This is not a valid CIDR block.`);
  if (pc.bits < 16 || pc.bits > 28) throw new AwsError('InvalidVpcRange', `The CIDR '${cidr}' is invalid.`);
  if (Object.keys(r.vpcs).length >= 5) throw new AwsError('VpcLimitExceeded', 'The maximum number of VPCs has been reached.');
  const v = ec2CreateVpc(c.acct, c.region, cidr, tagsFor(c.p.TagSpecifications, 'vpc'));
  return { Vpc: vpcView(c, v, 'pending') };
});

op('ec2', 'delete-vpc', 'vpc-id:s! dry-run:b', 'Borra una VPC (debe estar vacía: sin subredes, gateways ni instancias).', { dryRun: true, res: (c) => arn(c, 'vpc', c.p.VpcId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const id = c.p.VpcId as string;
  vpcOf(r, id);
  const used =
    Object.values(r.subnets).some((s) => s.VpcId === id) ||
    Object.values(r.internetGateways).some((g) => g.VpcId === id) ||
    Object.values(r.natGateways).some((n) => n.VpcId === id && n.state !== 'deleted') ||
    Object.values(r.instances).some((i) => i.VpcId === id && i.state !== 'terminated') ||
    Object.values(r.routeTables).some((t) => t.VpcId === id && !t.associations.some((x) => x.Main)) ||
    Object.values(r.networkAcls).some((n) => n.VpcId === id && !n.IsDefault) ||
    Object.values(r.securityGroups).some((g) => g.VpcId === id && g.GroupName !== 'default');
  if (used) throw E.dep('vpc', id);
  for (const t of Object.values(r.routeTables)) if (t.VpcId === id) delete r.routeTables[t.RouteTableId];
  for (const n of Object.values(r.networkAcls)) if (n.VpcId === id) delete r.networkAcls[n.NetworkAclId];
  for (const g of Object.values(r.securityGroups)) if (g.VpcId === id) delete r.securityGroups[g.GroupId];
  delete r.vpcs[id];
  return undefined;
});

op('ec2', 'modify-vpc-attribute', 'vpc-id:s! enable-dns-support:b enable-dns-hostnames:b', 'Activa o desactiva el DNS (`--enable-dns-support`, `--enable-dns-hostnames`) de una VPC.', { res: (c) => arn(c, 'vpc', c.p.VpcId) }, (c) => {
  const v = vpcOf(refreshEc2(c.acct, c.region), c.p.VpcId);
  if (c.p.EnableDnsSupport !== undefined) v.EnableDnsSupport = !!c.p.EnableDnsSupport;
  if (c.p.EnableDnsHostnames !== undefined) v.EnableDnsHostnames = !!c.p.EnableDnsHostnames;
  return undefined;
});

op('ec2', 'describe-vpc-attribute', 'vpc-id:s! attribute:s!', 'Consulta un atributo de la VPC (`enableDnsSupport` o `enableDnsHostnames`).', { res: (c) => arn(c, 'vpc', c.p.VpcId) }, (c) => {
  const v = vpcOf(refreshEc2(c.acct, c.region), c.p.VpcId);
  const attr = c.p.Attribute as string;
  if (attr === 'enableDnsSupport') return { VpcId: v.VpcId, EnableDnsSupport: { Value: v.EnableDnsSupport !== false } };
  if (attr === 'enableDnsHostnames') return { VpcId: v.VpcId, EnableDnsHostnames: { Value: !!v.EnableDnsHostnames } };
  throw new AwsError('InvalidParameterValue', `Invalid value '${attr}' for attribute. Valid values: enableDnsSupport | enableDnsHostnames`);
});

// ───────────────────────── subredes ─────────────────────────

op('ec2', 'create-subnet', 'vpc-id:s! cidr-block:s availability-zone:s tag-specifications:f dry-run:b', 'Crea una subred (un trozo de la VPC) en una zona de disponibilidad.', { dryRun: true, res: (c) => arn(c, 'subnet') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const vpc = vpcOf(r, c.p.VpcId);
  const cidr = c.p.CidrBlock as string | undefined;
  if (!cidr) throw new AwsError('MissingParameter', 'The request must contain the parameter cidrBlock');
  const pc = parseCidr(cidr);
  if (!pc || !cidrCanonical(cidr)) throw new AwsError('InvalidParameterValue', `Value (${cidr}) for parameter cidrBlock is invalid. This is not a valid CIDR block.`);
  if (pc.bits < 16 || pc.bits > 28 || !cidrWithin(cidr, vpc.CidrBlock)) throw new AwsError('InvalidSubnet.Range', `The CIDR '${cidr}' is invalid.`);
  const clash = Object.values(r.subnets).find((s) => s.VpcId === vpc.VpcId && cidrOverlap(s.CidrBlock, cidr));
  if (clash) throw new AwsError('InvalidSubnet.Conflict', `The CIDR '${cidr}' conflicts with another subnet`);
  const info = regionInfo(c.region);
  let az = c.p.AvailabilityZone as string | undefined;
  if (az && !(info?.azs ?? []).some((l) => c.region + l === az)) throw new AwsError('InvalidParameterValue', `Value (${az}) for parameter availabilityZone is invalid. Subnets can currently only be created in the following availability zones: ${(info?.azs ?? []).map((l) => c.region + l).join(', ')}.`);
  az ??= azName(c.region, 0);
  const sn = ec2CreateSubnet(c.acct, c.region, vpc.VpcId, cidr, (info?.azs ?? []).findIndex((l) => c.region + l === az), { tags: tagsFor(c.p.TagSpecifications, 'subnet') });
  return { Subnet: { ...subnetView(c.acct, c.region, sn), State: 'available' } };
});

op('ec2', 'delete-subnet', 'subnet-id:s! dry-run:b', 'Borra una subred (sin instancias dentro).', { dryRun: true, res: (c) => arn(c, 'subnet', c.p.SubnetId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const id = c.p.SubnetId as string;
  if (!r.subnets[id]) throw E.subnet(id);
  if (Object.values(r.instances).some((i) => i.SubnetId === id && i.state !== 'terminated') || Object.values(r.natGateways).some((n) => n.SubnetId === id && n.state !== 'deleted')) throw E.dep('subnet', id);
  for (const n of Object.values(r.networkAcls)) n.subnets = n.subnets.filter((x) => x !== id);
  for (const t of Object.values(r.routeTables)) t.associations = t.associations.filter((x) => x.SubnetId !== id);
  delete r.subnets[id];
  return undefined;
});

op('ec2', 'modify-subnet-attribute', 'subnet-id:s! map-public-ip-on-launch:b assign-ipv6-address-on-creation:b', 'Cambia atributos de la subred (`--map-public-ip-on-launch`: las instancias nuevas reciben IP pública).', { res: (c) => arn(c, 'subnet', c.p.SubnetId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const sn = r.subnets[c.p.SubnetId];
  if (!sn) throw E.subnet(c.p.SubnetId);
  if (c.p.MapPublicIpOnLaunch !== undefined) sn.MapPublicIpOnLaunch = !!c.p.MapPublicIpOnLaunch;
  return undefined;
});

// ───────────────────────── internet gateways ─────────────────────────

const igwView = (a: Account, g: { InternetGatewayId: string; VpcId?: string; Tags: Tag[] }) => ({
  Attachments: g.VpcId ? [{ State: 'available', VpcId: g.VpcId }] : [],
  InternetGatewayId: g.InternetGatewayId,
  OwnerId: a.id,
  Tags: g.Tags,
});

op('ec2', 'create-internet-gateway', 'tag-specifications:f dry-run:b', 'Crea una internet gateway: la puerta de la VPC hacia internet (hay que conectarla a una VPC).', { dryRun: true, res: (c) => arn(c, 'internet-gateway') }, (c) => {
  const g = ec2CreateIgw(c.acct, c.region, undefined, tagsFor(c.p.TagSpecifications, 'internet-gateway'));
  return { InternetGateway: igwView(c.acct, g) };
});

op('ec2', 'describe-internet-gateways', 'internet-gateway-ids:l filters:f dry-run:b', 'Lista las internet gateways y a qué VPC están conectadas.', { dryRun: true, paginate: 'InternetGateways' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.InternetGatewayIds ?? []) if (!r.internetGateways[id]) throw E.igw(id);
  return {
    InternetGateways: Object.values(r.internetGateways)
      .filter((g) => (!c.p.InternetGatewayIds || c.p.InternetGatewayIds.includes(g.InternetGatewayId)) && filterOk(c.p.Filters, (n) => (n === 'attachment.vpc-id' ? (g.VpcId ? [g.VpcId] : []) : n === 'internet-gateway-id' ? [g.InternetGatewayId] : n === 'attachment.state' ? (g.VpcId ? ['available'] : []) : tagGetter(g.Tags)(n))))
      .map((g) => igwView(c.acct, g)),
  };
});

op('ec2', 'attach-internet-gateway', 'internet-gateway-id:s! vpc-id:s! dry-run:b', 'Conecta una internet gateway a una VPC.', { dryRun: true, res: (c) => arn(c, 'internet-gateway', c.p.InternetGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = r.internetGateways[c.p.InternetGatewayId];
  if (!g) throw E.igw(c.p.InternetGatewayId);
  vpcOf(r, c.p.VpcId);
  if (g.VpcId) throw new AwsError('Resource.AlreadyAssociated', `resource ${g.InternetGatewayId} is already attached to network ${g.VpcId}`);
  if (Object.values(r.internetGateways).some((x) => x.VpcId === c.p.VpcId)) throw new AwsError('InvalidParameterValue', `Network ${c.p.VpcId} already has an internet gateway attached`);
  g.VpcId = c.p.VpcId;
  return undefined;
});

op('ec2', 'detach-internet-gateway', 'internet-gateway-id:s! vpc-id:s! dry-run:b', 'Desconecta una internet gateway de su VPC.', { dryRun: true, res: (c) => arn(c, 'internet-gateway', c.p.InternetGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = r.internetGateways[c.p.InternetGatewayId];
  if (!g) throw E.igw(c.p.InternetGatewayId);
  if (g.VpcId !== c.p.VpcId) throw new AwsError('Gateway.NotAttached', `Resource ${g.InternetGatewayId} is not attached to network ${c.p.VpcId}`);
  if (Object.values(r.instances).some((i) => i.VpcId === g.VpcId && i.PublicIpAddress && i.state !== 'terminated')) throw new AwsError('DependencyViolation', `Network ${g.VpcId} has some mapped public address(es). Please unmap those public address(es) before detaching the gateway.`);
  g.VpcId = undefined;
  return undefined;
});

op('ec2', 'delete-internet-gateway', 'internet-gateway-id:s! dry-run:b', 'Borra una internet gateway (debe estar desconectada).', { dryRun: true, res: (c) => arn(c, 'internet-gateway', c.p.InternetGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = r.internetGateways[c.p.InternetGatewayId];
  if (!g) throw E.igw(c.p.InternetGatewayId);
  if (g.VpcId) throw E.dep('internetGateway', g.InternetGatewayId);
  delete r.internetGateways[g.InternetGatewayId];
  return undefined;
});

// ───────────────────────── tablas de rutas ─────────────────────────

const rtbView = (c: OpCtx, r: Ec2Region, t: RouteTable) => ({
  Associations: t.associations.map((x) => ({ Main: x.Main, RouteTableAssociationId: x.RouteTableAssociationId, RouteTableId: t.RouteTableId, ...(x.SubnetId ? { SubnetId: x.SubnetId } : {}), AssociationState: { State: 'associated' } })),
  PropagatingVgws: [] as unknown[],
  RouteTableId: t.RouteTableId,
  Routes: t.routes.map((x) => {
    const active = x.target === 'local' || (x.target.startsWith('igw-') ? r.internetGateways[x.target]?.VpcId === t.VpcId : x.target.startsWith('nat-') ? !!r.natGateways[x.target] && !['deleted', 'deleting'].includes(r.natGateways[x.target].state) : true);
    return {
      DestinationCidrBlock: x.DestinationCidrBlock,
      ...(x.target.startsWith('nat-') ? { NatGatewayId: x.target } : x.target.startsWith('pcx-') ? { VpcPeeringConnectionId: x.target } : x.target.startsWith('tgw-') ? { TransitGatewayId: x.target } : { GatewayId: x.target }),
      Origin: x.Origin,
      State: active ? 'active' : 'blackhole',
    };
  }),
  Tags: t.Tags,
  VpcId: t.VpcId,
  OwnerId: c.acct.id,
});

function rtbOf(r: Ec2Region, id: string): RouteTable {
  const t = r.routeTables[id];
  if (!t) throw E.rtb(id);
  return t;
}

op('ec2', 'create-route-table', 'vpc-id:s! tag-specifications:f dry-run:b', 'Crea una tabla de rutas (solo con la ruta «local»).', { dryRun: true, res: (c) => arn(c, 'route-table') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  vpcOf(r, c.p.VpcId);
  const t = ec2CreateRouteTable(c.acct, c.region, c.p.VpcId, tagsFor(c.p.TagSpecifications, 'route-table'));
  return { RouteTable: { ...rtbView(c, r, t), Associations: [] }, ClientToken: undefined };
});

op('ec2', 'describe-route-tables', 'route-table-ids:l filters:f dry-run:b', 'Lista las tablas de rutas, sus rutas y las subredes asociadas.', { dryRun: true, paginate: 'RouteTables' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.RouteTableIds ?? []) if (!r.routeTables[id]) throw E.rtb(id);
  return {
    RouteTables: Object.values(r.routeTables)
      .filter((t) => (!c.p.RouteTableIds || c.p.RouteTableIds.includes(t.RouteTableId)) && filterOk(c.p.Filters, (n) => {
        switch (n) {
          case 'vpc-id': return [t.VpcId];
          case 'route-table-id': return [t.RouteTableId];
          case 'association.subnet-id': return t.associations.flatMap((x) => (x.SubnetId ? [x.SubnetId] : []));
          case 'association.main': return t.associations.map((x) => String(x.Main));
          case 'association.route-table-association-id': return t.associations.map((x) => x.RouteTableAssociationId);
          case 'route.destination-cidr-block': return t.routes.map((x) => x.DestinationCidrBlock);
          case 'route.gateway-id': return t.routes.map((x) => x.target);
          case 'route.nat-gateway-id': return t.routes.filter((x) => x.target.startsWith('nat-')).map((x) => x.target);
          default: return tagGetter(t.Tags)(n);
        }
      }))
      .map((t) => rtbView(c, r, t)),
  };
});

op('ec2', 'delete-route-table', 'route-table-id:s! dry-run:b', 'Borra una tabla de rutas (no puede ser la principal ni tener subredes asociadas).', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const t = rtbOf(r, c.p.RouteTableId);
  if (t.associations.length) throw E.dep('routeTable', t.RouteTableId);
  delete r.routeTables[t.RouteTableId];
  return undefined;
});

/** Destino de una ruta a partir de los parámetros (`--gateway-id`, `--nat-gateway-id`…). */
function routeTarget(c: OpCtx, r: Ec2Region, t: RouteTable): string {
  const gw = c.p.GatewayId as string | undefined;
  const nat = c.p.NatGatewayId as string | undefined;
  if (gw) {
    if (gw.startsWith('igw-')) {
      const g = r.internetGateways[gw];
      if (!g) throw new AwsError('InvalidGatewayID.NotFound', `The gateway ID '${gw}' does not exist`);
      if (g.VpcId !== t.VpcId) throw new AwsError('InvalidParameterValue', `route table ${t.RouteTableId} and network gateway ${gw} belong to different networks`);
      return gw;
    }
    throw new AwsError('InvalidGatewayID.NotFound', `The gateway ID '${gw}' does not exist`);
  }
  if (nat) {
    const n = r.natGateways[nat];
    if (!n || n.state === 'deleted') throw new AwsError('InvalidNatGatewayID.NotFound', `The natGateway ID '${nat}' does not exist`);
    if (n.VpcId !== t.VpcId) throw new AwsError('InvalidParameterValue', `route table ${t.RouteTableId} and network gateway ${nat} belong to different networks`);
    return nat;
  }
  throw new AwsError('MissingParameter', 'The request must contain exactly one of the parameters: gatewayId, natGatewayId, vpcPeeringConnectionId, transitGatewayId, instanceId, networkInterfaceId');
}

const ROUTE_PARAMS = 'route-table-id:s! destination-cidr-block:s! gateway-id:s nat-gateway-id:s dry-run:b';

function checkDest(cidr: string): void {
  if (!parseCidr(cidr) || !cidr.includes('/') || !cidrCanonical(cidr)) throw new AwsError('InvalidParameterValue', `Value (${cidr}) for parameter destinationCidrBlock is invalid. This is not a valid CIDR block.`);
}

op('ec2', 'create-route', ROUTE_PARAMS, 'Añade una ruta: el tráfico hacia un CIDR irá por una gateway (internet, NAT…).', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const t = rtbOf(r, c.p.RouteTableId);
  const dst = c.p.DestinationCidrBlock as string;
  checkDest(dst);
  if (t.routes.some((x) => x.DestinationCidrBlock === dst)) throw new AwsError('RouteAlreadyExists', `The route identified by ${dst} already exists.`);
  t.routes.push({ DestinationCidrBlock: dst, target: routeTarget(c, r, t), Origin: 'CreateRoute' });
  return { Return: true };
});

op('ec2', 'replace-route', ROUTE_PARAMS, 'Cambia el destino de una ruta existente.', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const t = rtbOf(r, c.p.RouteTableId);
  const dst = c.p.DestinationCidrBlock as string;
  const cur = t.routes.find((x) => x.DestinationCidrBlock === dst);
  if (!cur) throw new AwsError('InvalidParameterValue', `no route with destination-cidr-block ${dst} exists in ${t.RouteTableId}`);
  if (cur.target === 'local') throw new AwsError('InvalidParameterValue', 'cannot replace the local route');
  cur.target = routeTarget(c, r, t);
  return undefined;
});

op('ec2', 'delete-route', 'route-table-id:s! destination-cidr-block:s! dry-run:b', 'Borra una ruta (la «local» no se puede borrar).', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const t = rtbOf(r, c.p.RouteTableId);
  const dst = c.p.DestinationCidrBlock as string;
  const cur = t.routes.find((x) => x.DestinationCidrBlock === dst);
  if (!cur) throw new AwsError('InvalidRoute.NotFound', `no route with destination-cidr-block ${dst} in route table ${t.RouteTableId}`);
  if (cur.target === 'local') throw new AwsError('InvalidParameterValue', 'cannot remove local route');
  t.routes.splice(t.routes.indexOf(cur), 1);
  return undefined;
});

op('ec2', 'associate-route-table', 'route-table-id:s! subnet-id:s dry-run:b', 'Asocia una tabla de rutas a una subred (sin asociación, la subred usa la tabla principal).', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const t = rtbOf(r, c.p.RouteTableId);
  const sn = r.subnets[c.p.SubnetId];
  if (!sn) throw E.subnet(c.p.SubnetId ?? '');
  if (sn.VpcId !== t.VpcId) throw new AwsError('InvalidParameterValue', `Route table ${t.RouteTableId} and subnet ${sn.SubnetId} belong to different networks`);
  if (Object.values(r.routeTables).some((x) => x.associations.some((a) => a.SubnetId === sn.SubnetId))) throw new AwsError('Resource.AlreadyAssociated', `The specified association for route table ${t.RouteTableId} conflicts with an existing association`);
  const id = ec2Id(c.acct, 'rtbassoc');
  t.associations.push({ RouteTableAssociationId: id, SubnetId: sn.SubnetId, Main: false });
  return { AssociationId: id, AssociationState: { State: 'associated' } };
});

op('ec2', 'disassociate-route-table', 'association-id:s! dry-run:b', 'Quita la asociación de una subred con su tabla de rutas (vuelve a la principal).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const t of Object.values(r.routeTables)) {
    const i = t.associations.findIndex((x) => x.RouteTableAssociationId === c.p.AssociationId);
    if (i < 0) continue;
    if (t.associations[i].Main) throw new AwsError('InvalidParameterValue', 'cannot disassociate the main route table association');
    t.associations.splice(i, 1);
    return undefined;
  }
  throw new AwsError('InvalidAssociationID.NotFound', `The association ID '${c.p.AssociationId}' does not exist`);
});

// ───────────────────────── NAT gateways ─────────────────────────

const natView = (n: NatGateway, state = n.state) => ({
  CreateTime: n.CreateTime,
  NatGatewayAddresses: n.ConnectivityType === 'public' ? [{ AllocationId: n.AllocationId, NetworkInterfaceId: 'eni-' + stableId(`eni:${n.NatGatewayId}`, '', 17), PrivateIp: n.PrivateIp, PublicIp: n.PublicIp }] : [{ NetworkInterfaceId: 'eni-' + stableId(`eni:${n.NatGatewayId}`, '', 17), PrivateIp: n.PrivateIp }],
  NatGatewayId: n.NatGatewayId,
  State: state,
  SubnetId: n.SubnetId,
  VpcId: n.VpcId,
  Tags: n.Tags,
  ConnectivityType: n.ConnectivityType,
});

/** Crea un NAT gateway público en una subred (para escenarios y para `create-nat-gateway`). */
export function ec2CreateNat(a: Account, region: string, subnetId: string, allocationId: string, tags: Tag[] = [], state: NatGateway['state'] = 'available'): NatGateway {
  const r = regional(a, region).ec2;
  const sn = r.subnets[subnetId];
  const addr = r.addresses[allocationId];
  const id = ec2Id(a, 'nat');
  const cidr = parseCidr(sn.CidrBlock)!;
  const used = new Set(Object.values(r.instances).map((i) => i.PrivateIpAddress));
  let off = 20 + (parseInt(stableId(id, '', 4), 16) % 30);
  const ip = (n: number) => [(cidr.base + n) >>> 24, ((cidr.base + n) >>> 16) & 255, ((cidr.base + n) >>> 8) & 255, (cidr.base + n) & 255].join('.');
  while (used.has(ip(off))) off++;
  const nat: NatGateway = { NatGatewayId: id, SubnetId: subnetId, VpcId: sn.VpcId, ConnectivityType: 'public', AllocationId: allocationId, PublicIp: addr?.PublicIp, PrivateIp: ip(off), state, CreateTime: iso(a.clock), stateAt: state === 'available' ? a.clock - 120000 : a.clock, Tags: tags };
  r.natGateways[id] = nat;
  if (addr) addr.AssociationId = 'eipassoc-' + stableId(`natassoc:${id}`, '', 17);
  return nat;
}

op('ec2', 'create-nat-gateway', 'subnet-id:s! allocation-id:s connectivity-type:s tag-specifications:f dry-run:b', 'Crea un NAT gateway: deja salir a internet a las instancias privadas (cuesta por hora y por GB).', { dryRun: true, res: (c) => arn(c, 'natgateway') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const sn = r.subnets[c.p.SubnetId];
  if (!sn) throw E.subnet(c.p.SubnetId);
  const type = (c.p.ConnectivityType ?? 'public') as 'public' | 'private';
  if (type === 'public') {
    if (!c.p.AllocationId) throw new AwsError('MissingParameter', 'The request must contain the parameter AllocationId');
    const addr = r.addresses[c.p.AllocationId];
    if (!addr) throw new AwsError('InvalidAllocationID.NotFound', `The allocation ID '${c.p.AllocationId}' does not exist`);
    if (addr.AssociationId || addr.InstanceId) throw new AwsError('Resource.AlreadyAssociated', `Elastic IP address ${c.p.AllocationId} is already associated`);
  }
  const nat = ec2CreateNat(c.acct, c.region, sn.SubnetId, c.p.AllocationId ?? '', tagsFor(c.p.TagSpecifications, 'natgateway'), 'pending');
  nat.ConnectivityType = type;
  if (type === 'private') {
    nat.PublicIp = undefined;
    nat.AllocationId = undefined;
  }
  return { NatGateway: natView(nat, 'pending') };
});

op('ec2', 'describe-nat-gateways', 'nat-gateway-ids:l filter:f dry-run:b', 'Lista los NAT gateways y su estado.', { dryRun: true, paginate: 'NatGateways' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.NatGatewayIds ?? []) if (!r.natGateways[id]) throw E.nat(id);
  return {
    NatGateways: Object.values(r.natGateways)
      .filter((n) => (!c.p.NatGatewayIds || c.p.NatGatewayIds.includes(n.NatGatewayId)) && filterOk(c.p.Filter, (f) => (f === 'vpc-id' ? [n.VpcId] : f === 'subnet-id' ? [n.SubnetId] : f === 'state' ? [n.state] : f === 'nat-gateway-id' ? [n.NatGatewayId] : tagGetter(n.Tags)(f))))
      .map((n) => natView(n)),
  };
});

op('ec2', 'delete-nat-gateway', 'nat-gateway-id:s! dry-run:b', 'Borra un NAT gateway (libera la IP elástica para que la borres: sigue cobrando si no).', { dryRun: true, res: (c) => arn(c, 'natgateway', c.p.NatGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = r.natGateways[c.p.NatGatewayId];
  if (!n) throw E.nat(c.p.NatGatewayId);
  if (n.state === 'available' || n.state === 'pending') {
    n.state = 'deleting';
    n.stateAt = c.acct.clock;
  }
  const addr = n.AllocationId ? r.addresses[n.AllocationId] : undefined;
  if (addr) addr.AssociationId = undefined;
  return { NatGatewayId: n.NatGatewayId };
});

// ───────────────────────── NACL ─────────────────────────

const PROTOS: Record<string, string> = { tcp: '6', udp: '17', icmp: '1', all: '-1', '-1': '-1', '6': '6', '17': '17', '1': '1' };

const aclView = (c: OpCtx, n: NetworkAcl) => ({
  Associations: n.subnets.map((s) => ({ NetworkAclAssociationId: stableId(`aclassoc:${n.NetworkAclId}:${s}`, 'aclassoc-', 17), NetworkAclId: n.NetworkAclId, SubnetId: s })),
  Entries: [...n.Entries].sort((a, b) => Number(b.Egress) - Number(a.Egress) || a.RuleNumber - b.RuleNumber).map((e) => ({ CidrBlock: e.CidrBlock, Egress: e.Egress, Protocol: e.Protocol, RuleAction: e.RuleAction, RuleNumber: e.RuleNumber, ...(e.PortRange ? { PortRange: e.PortRange } : {}) })),
  IsDefault: n.IsDefault,
  NetworkAclId: n.NetworkAclId,
  Tags: n.Tags,
  VpcId: n.VpcId,
  OwnerId: c.acct.id,
});

function aclOf(r: Ec2Region, id: string): NetworkAcl {
  const n = r.networkAcls[id];
  if (!n) throw E.acl(id);
  return n;
}

op('ec2', 'create-network-acl', 'vpc-id:s! tag-specifications:f dry-run:b', 'Crea una NACL: un filtro sin estado a nivel de subred (nace denegándolo todo).', { dryRun: true, res: (c) => arn(c, 'network-acl') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  vpcOf(r, c.p.VpcId);
  const id = ec2Id(c.acct, 'acl');
  const entries: NaclEntry[] = [
    { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: false, CidrBlock: '0.0.0.0/0' },
    { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: true, CidrBlock: '0.0.0.0/0' },
  ];
  r.networkAcls[id] = { NetworkAclId: id, VpcId: c.p.VpcId, IsDefault: false, Entries: entries, subnets: [], Tags: tagsFor(c.p.TagSpecifications, 'network-acl') };
  return { NetworkAcl: aclView(c, r.networkAcls[id]) };
});

op('ec2', 'describe-network-acls', 'network-acl-ids:l filters:f dry-run:b', 'Lista las NACL con sus reglas y las subredes que filtran.', { dryRun: true, paginate: 'NetworkAcls' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.NetworkAclIds ?? []) if (!r.networkAcls[id]) throw E.acl(id);
  return {
    NetworkAcls: Object.values(r.networkAcls)
      .filter((n) => (!c.p.NetworkAclIds || c.p.NetworkAclIds.includes(n.NetworkAclId)) && filterOk(c.p.Filters, (f) => {
        switch (f) {
          case 'vpc-id': return [n.VpcId];
          case 'network-acl-id': return [n.NetworkAclId];
          case 'default': return [String(n.IsDefault)];
          case 'association.subnet-id': return n.subnets;
          case 'entry.rule-action': return n.Entries.map((e) => e.RuleAction);
          default: return tagGetter(n.Tags)(f);
        }
      }))
      .map((n) => aclView(c, n)),
  };
});

op('ec2', 'delete-network-acl', 'network-acl-id:s! dry-run:b', 'Borra una NACL (no la de por defecto ni una con subredes).', { dryRun: true, res: (c) => arn(c, 'network-acl', c.p.NetworkAclId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = aclOf(r, c.p.NetworkAclId);
  if (n.IsDefault) throw new AwsError('InvalidParameterValue', `The network acl '${n.NetworkAclId}' is the default and cannot be deleted`);
  if (n.subnets.length) throw E.dep('networkAcl', n.NetworkAclId);
  delete r.networkAcls[n.NetworkAclId];
  return undefined;
});

const ACL_ENTRY_PARAMS = 'network-acl-id:s! rule-number:i! protocol:s! rule-action:s! egress:b ingress:b cidr-block:s port-range:j icmp-type-code:j dry-run:b';

function parseEntry(c: OpCtx): NaclEntry {
  const num = c.p.RuleNumber as number;
  if (num < 1 || num > 32766) throw new AwsError('InvalidParameterValue', `Value (${num}) for parameter ruleNumber is invalid. Rule number must be between 1 and 32766`);
  const proto = PROTOS[String(c.p.Protocol).toLowerCase()];
  if (!proto) throw new AwsError('InvalidParameterValue', `Value (${c.p.Protocol}) for parameter protocol is invalid.`);
  const action = String(c.p.RuleAction);
  if (action !== 'allow' && action !== 'deny') throw new AwsError('InvalidParameterValue', `Value (${action}) for parameter ruleAction is invalid. Must be one of: allow, deny`);
  if (c.p.Egress === undefined && c.p.Ingress === undefined) throw new AwsError('MissingParameter', 'The request must contain the parameter egress');
  const cidr = c.p.CidrBlock as string | undefined;
  if (!cidr) throw new AwsError('MissingParameter', 'The request must contain the parameter cidrBlock');
  if (!parseCidr(cidr) || !cidr.includes('/') || !cidrCanonical(cidr)) throw new AwsError('InvalidParameterValue', `Value (${cidr}) for parameter cidrBlock is invalid. This is not a valid CIDR block.`);
  const pr = c.p.PortRange as { From?: number | string; To?: number | string } | undefined;
  if ((proto === '6' || proto === '17') && !pr) throw new AwsError('InvalidParameterCombination', 'Protocol 6 requires PortRange');
  const entry: NaclEntry = { RuleNumber: num, Protocol: proto, RuleAction: action, Egress: c.p.Egress === true, CidrBlock: cidr };
  if (pr && (proto === '6' || proto === '17')) {
    const from = Number(pr.From);
    const to = Number(pr.To ?? pr.From);
    if (!(from >= 0 && to >= from && to <= 65535)) throw new AwsError('InvalidParameterValue', 'Invalid port range');
    entry.PortRange = { From: from, To: to };
  }
  return entry;
}

op('ec2', 'create-network-acl-entry', ACL_ENTRY_PARAMS, 'Añade una regla a una NACL (se evalúan de menor a mayor número; gana la primera que coincide).', { dryRun: true, res: (c) => arn(c, 'network-acl', c.p.NetworkAclId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = aclOf(r, c.p.NetworkAclId);
  const e = parseEntry(c);
  if (n.Entries.some((x) => x.Egress === e.Egress && x.RuleNumber === e.RuleNumber)) throw new AwsError('NetworkAclEntryAlreadyExists', `The network acl entry identified by ${e.RuleNumber} already exists.`);
  n.Entries.push(e);
  return undefined;
});

op('ec2', 'replace-network-acl-entry', ACL_ENTRY_PARAMS, 'Sustituye una regla de la NACL (mismo número).', { dryRun: true, res: (c) => arn(c, 'network-acl', c.p.NetworkAclId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = aclOf(r, c.p.NetworkAclId);
  const e = parseEntry(c);
  const i = n.Entries.findIndex((x) => x.Egress === e.Egress && x.RuleNumber === e.RuleNumber);
  if (i < 0) throw new AwsError('InvalidNetworkAclEntry.NotFound', `The network acl entry identified by ${e.RuleNumber} does not exist`);
  n.Entries[i] = e;
  return undefined;
});

op('ec2', 'delete-network-acl-entry', 'network-acl-id:s! rule-number:i! egress:b ingress:b dry-run:b', 'Borra una regla de la NACL.', { dryRun: true, res: (c) => arn(c, 'network-acl', c.p.NetworkAclId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = aclOf(r, c.p.NetworkAclId);
  const egress = c.p.Egress === true;
  const i = n.Entries.findIndex((x) => x.Egress === egress && x.RuleNumber === c.p.RuleNumber);
  if (i < 0) throw new AwsError('InvalidNetworkAclEntry.NotFound', `The network acl entry identified by ${c.p.RuleNumber} does not exist`);
  n.Entries.splice(i, 1);
  return undefined;
});

op('ec2', 'replace-network-acl-association', 'association-id:s! network-acl-id:s! dry-run:b', 'Cambia la NACL de una subred (hace falta el `NetworkAclAssociationId` de la subred).', { dryRun: true, res: (c) => arn(c, 'network-acl', c.p.NetworkAclId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const target = aclOf(r, c.p.NetworkAclId);
  for (const n of Object.values(r.networkAcls)) {
    const sn = n.subnets.find((s) => stableId(`aclassoc:${n.NetworkAclId}:${s}`, 'aclassoc-', 17) === c.p.AssociationId);
    if (!sn) continue;
    if (r.subnets[sn].VpcId !== target.VpcId) throw new AwsError('InvalidParameterValue', `Network ACL ${target.NetworkAclId} and subnet ${sn} belong to different networks`);
    n.subnets = n.subnets.filter((s) => s !== sn);
    target.subnets.push(sn);
    return { NewAssociationId: stableId(`aclassoc:${target.NetworkAclId}:${sn}`, 'aclassoc-', 17) };
  }
  throw new AwsError('InvalidAssociationID.NotFound', `The association ID '${c.p.AssociationId}' does not exist`);
});
