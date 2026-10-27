/** Conectividad entre VPC: peering, endpoints (de puerta de enlace y de interfaz), PrivateLink, listas de prefijos, IPv6 y puerta de salida solo-IPv6. */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Ec2Region, EndpointService, PeeringConn, Tag, VpcEndpoint } from '../types';
import { cidrOverlap, cidrWithin, ec2Id, intToIp, iso, newId, parseCidr, stableId, toArr } from '../util';
import { filterOk, refreshEc2, tagGetter, tagsFor } from './ec2';

const arn = (c: OpCtx, type: string, id = '*') => `arn:aws:ec2:${c.region}:${c.acct.id}:${type}/${id}`;
const PENDING_MS = 20000;

// ───────────────────────── peering ─────────────────────────

const peers = (r: Ec2Region) => (r.peerings ??= {});

const peerView = (c: OpCtx, r: Ec2Region, p: PeeringConn) => {
  const side = (vpcId: string) => ({ CidrBlock: r.vpcs[vpcId]?.CidrBlock ?? '', CidrBlockSet: [{ CidrBlock: r.vpcs[vpcId]?.CidrBlock ?? '' }], OwnerId: c.acct.id, PeeringOptions: { AllowDnsResolutionFromRemoteVpc: false, AllowEgressFromLocalClassicLinkToRemoteVpc: false, AllowEgressFromLocalVpcToRemoteClassicLink: false }, VpcId: vpcId, Region: c.region });
  const msg: Record<PeeringConn['Status'], string> = { 'pending-acceptance': 'Pending Acceptance by ' + c.acct.id, active: 'Active', rejected: 'Rejected by ' + c.acct.id, deleted: 'Deleted by ' + c.acct.id, failed: 'Failed' };
  return {
    AccepterVpcInfo: side(p.AccepterVpcId),
    ...(p.Status === 'pending-acceptance' ? { ExpirationTime: iso(p.createdAt + 7 * 86400000) } : {}),
    RequesterVpcInfo: side(p.RequesterVpcId),
    Status: { Code: p.Status, Message: msg[p.Status] },
    Tags: p.Tags,
    VpcPeeringConnectionId: p.VpcPeeringConnectionId,
  };
};

export function ec2CreatePeering(a: Account, region: string, requester: string, accepter: string, o: { active?: boolean; tags?: Tag[] } = {}): PeeringConn {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'pcx');
  const p: PeeringConn = { VpcPeeringConnectionId: id, RequesterVpcId: requester, AccepterVpcId: accepter, Status: o.active ? 'active' : 'pending-acceptance', createdAt: a.clock, Tags: o.tags ?? [] };
  peers(r)[id] = p;
  return p;
}

const vpcCidrs = (r: Ec2Region, id: string) => [r.vpcs[id].CidrBlock, ...(r.vpcs[id].ExtraCidrBlocks ?? [])];

op('ec2', 'create-vpc-peering-connection', 'vpc-id:s! peer-vpc-id:s! peer-owner-id:s peer-region:s tag-specifications:f dry-run:b', 'Pide un peering: una conexión privada entre dos VPC (la otra parte debe aceptarla).', { dryRun: true, res: (c) => arn(c, 'vpc-peering-connection') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const mine = r.vpcs[c.p.VpcId];
  if (!mine) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  if (c.p.PeerRegion && c.p.PeerRegion !== c.region) throw new AwsError('UnsupportedOperation', 'This simulator only supports peering between VPCs of the same region.', 400);
  if (c.p.PeerOwnerId && c.p.PeerOwnerId !== c.acct.id) throw new AwsError('InvalidParameterValue', `Peering with another account (${c.p.PeerOwnerId}) is not available in this simulator.`, 400);
  const other = r.vpcs[c.p.PeerVpcId];
  if (!other) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.PeerVpcId}' does not exist`, 400);
  if (mine.VpcId === other.VpcId) throw new AwsError('InvalidParameterValue', 'A VPC cannot be peered with itself.', 400);
  if (Object.values(peers(r)).some((p) => (p.Status === 'active' || p.Status === 'pending-acceptance') && [p.RequesterVpcId, p.AccepterVpcId].sort().join() === [mine.VpcId, other.VpcId].sort().join())) throw new AwsError('VpcPeeringConnectionAlreadyExists', `A VpcPeeringConnection already exists between ${mine.VpcId} and ${other.VpcId}`, 400);
  for (const x of vpcCidrs(r, mine.VpcId)) for (const y of vpcCidrs(r, other.VpcId)) if (cidrOverlap(x, y)) throw new AwsError('InvalidParameterValue', `The VPCs ${mine.VpcId} (${x}) and ${other.VpcId} (${y}) have overlapping CIDR blocks. A peering connection requires non-overlapping ranges.`, 400);
  const p = ec2CreatePeering(c.acct, c.region, mine.VpcId, other.VpcId, { tags: tagsFor(c.p.TagSpecifications, 'vpc-peering-connection') });
  return { VpcPeeringConnection: peerView(c, r, p) };
});

const findPeer = (r: Ec2Region, id: string): PeeringConn => {
  const p = peers(r)[id];
  if (!p || p.Status === 'deleted') throw new AwsError('InvalidVpcPeeringConnectionID.NotFound', `The vpcPeeringConnection ID '${id}' does not exist`, 400);
  return p;
};

op('ec2', 'describe-vpc-peering-connections', 'vpc-peering-connection-ids:l filters:f dry-run:b', 'Lista los peerings y su estado.', { dryRun: true, paginate: 'VpcPeeringConnections' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.VpcPeeringConnectionIds ?? []) findPeer(r, id);
  return {
    VpcPeeringConnections: Object.values(peers(r))
      .filter((p) => (!c.p.VpcPeeringConnectionIds || c.p.VpcPeeringConnectionIds.includes(p.VpcPeeringConnectionId)) && filterOk(c.p.Filters, (n) => (n === 'status-code' ? [p.Status] : n === 'requester-vpc-info.vpc-id' ? [p.RequesterVpcId] : n === 'accepter-vpc-info.vpc-id' ? [p.AccepterVpcId] : n === 'vpc-peering-connection-id' ? [p.VpcPeeringConnectionId] : tagGetter(p.Tags)(n))))
      .map((p) => peerView(c, r, p)),
  };
});

op('ec2', 'accept-vpc-peering-connection', 'vpc-peering-connection-id:s! dry-run:b', 'Acepta un peering pendiente. Después hay que añadir las rutas en las dos VPC.', { dryRun: true, res: (c) => arn(c, 'vpc-peering-connection', c.p.VpcPeeringConnectionId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const p = findPeer(r, c.p.VpcPeeringConnectionId);
  if (p.Status !== 'pending-acceptance') throw new AwsError('InvalidStateTransition', `Peering connection ${p.VpcPeeringConnectionId} is not in the pending-acceptance state (it is ${p.Status}).`, 400);
  p.Status = 'active';
  return { VpcPeeringConnection: peerView(c, r, p) };
});

op('ec2', 'reject-vpc-peering-connection', 'vpc-peering-connection-id:s! dry-run:b', 'Rechaza un peering pendiente.', { dryRun: true, res: (c) => arn(c, 'vpc-peering-connection', c.p.VpcPeeringConnectionId) }, (c) => {
  const p = findPeer(refreshEc2(c.acct, c.region), c.p.VpcPeeringConnectionId);
  if (p.Status !== 'pending-acceptance') throw new AwsError('InvalidStateTransition', `Peering connection ${p.VpcPeeringConnectionId} is not pending acceptance.`, 400);
  p.Status = 'rejected';
  return { Return: true };
});

op('ec2', 'delete-vpc-peering-connection', 'vpc-peering-connection-id:s! dry-run:b', 'Borra un peering (las rutas que lo usaban pasan a «blackhole»).', { dryRun: true, res: (c) => arn(c, 'vpc-peering-connection', c.p.VpcPeeringConnectionId) }, (c) => {
  const p = findPeer(refreshEc2(c.acct, c.region), c.p.VpcPeeringConnectionId);
  p.Status = 'deleted';
  return { Return: true };
});

// ───────────────────────── listas de prefijos y servicios de endpoint ─────────────────────────

const GATEWAY_SERVICES = ['s3', 'dynamodb'];
const INTERFACE_SERVICES = ['sqs', 'sns', 'ssm', 'ssmmessages', 'ec2messages', 'kms', 'secretsmanager', 'logs', 'ecr.api', 'ecr.dkr', 'monitoring', 'lambda', 'execute-api', 'sts', 'elasticloadbalancing', 'events', 'states', 'kinesis-streams', 's3', 'ec2', 'ecs', 'sagemaker.api'];

export const prefixListId = (region: string, svc: string) => 'pl-' + md5(`${region}:${svc}`).slice(0, 8);
const svcName = (region: string, svc: string) => `com.amazonaws.${region}.${svc}`;

op('ec2', 'describe-prefix-lists', 'prefix-list-ids:l filters:f dry-run:b', 'Listas de prefijos gestionadas por AWS (las direcciones de S3 y DynamoDB en tu región).', { dryRun: true, paginate: 'PrefixLists' }, (c) => ({
  PrefixLists: GATEWAY_SERVICES.map((s) => ({ PrefixListId: prefixListId(c.region, s), PrefixListName: svcName(c.region, s), Cidrs: s === 's3' ? ['52.216.0.0/15', '3.5.0.0/19', '54.231.0.0/16'] : ['52.94.0.0/22', '52.119.224.0/20'] })).filter((p) => !c.p.PrefixListIds || c.p.PrefixListIds.includes(p.PrefixListId)),
}));

const services = (r: Ec2Region) => (r.endpointServices ??= {});

op('ec2', 'describe-vpc-endpoint-services', 'service-names:l filters:f', 'Servicios a los que puedes conectarte con un endpoint (los de AWS y los publicados con PrivateLink).', { paginate: 'ServiceNames' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const azs = Object.values(r.subnets).map((s) => s.AvailabilityZone).filter((v, i, l) => l.indexOf(v) === i).sort();
  const names = [...new Set([...GATEWAY_SERVICES, ...INTERFACE_SERVICES])].map((s) => svcName(c.region, s));
  const custom = Object.values(services(r)).map((x) => x.ServiceName);
  const all = [...names, ...custom].filter((n) => !c.p.ServiceNames || c.p.ServiceNames.includes(n)).sort();
  return {
    ServiceNames: all,
    ServiceDetails: all.map((n) => {
      const short = n.replace(`com.amazonaws.${c.region}.`, '');
      const types = custom.includes(n) ? [{ ServiceType: 'Interface' }] : [...(GATEWAY_SERVICES.includes(short) ? [{ ServiceType: 'Gateway' }] : []), ...(INTERFACE_SERVICES.includes(short) ? [{ ServiceType: 'Interface' }] : [])];
      return { ServiceName: n, ServiceType: types, AvailabilityZones: azs, Owner: custom.includes(n) ? c.acct.id : 'amazon', BaseEndpointDnsNames: [`${short}.${c.region}.vpce.amazonaws.com`], PrivateDnsName: custom.includes(n) ? undefined : `${short}.${c.region}.amazonaws.com`, VpcEndpointPolicySupported: true, AcceptanceRequired: false, ManagesVpcEndpoints: false };
    }),
  };
});

// ───────────────────────── endpoints ─────────────────────────

const eps = (r: Ec2Region) => (r.endpoints ??= {});

export const endpointState = (a: Account, e: VpcEndpoint): VpcEndpoint['State'] => (e.State === 'pending' && a.clock - e.createdAt >= PENDING_MS ? 'available' : e.State);

const epView = (c: OpCtx, r: Ec2Region, e: VpcEndpoint) => {
  const short = e.ServiceName.replace(`com.amazonaws.${c.region}.`, '');
  const base = `${e.VpcEndpointId}-${md5(e.VpcEndpointId).slice(0, 8)}.${short}.${c.region}.vpce.amazonaws.com`;
  return {
    VpcEndpointId: e.VpcEndpointId,
    VpcEndpointType: e.VpcEndpointType,
    VpcId: e.VpcId,
    ServiceName: e.ServiceName,
    State: e.State === 'pending' ? (endpointState(c.acct, e) === 'available' ? 'available' : 'pending') : e.State,
    PolicyDocument: JSON.stringify(e.PolicyDocument ?? { Statement: [{ Action: '*', Effect: 'Allow', Principal: '*', Resource: '*' }] }),
    RouteTableIds: e.RouteTableIds,
    SubnetIds: e.SubnetIds,
    Groups: e.SecurityGroupIds.map((GroupId) => ({ GroupId, GroupName: r.securityGroups[GroupId]?.GroupName ?? '' })),
    IpAddressType: 'ipv4',
    PrivateDnsEnabled: e.PrivateDnsEnabled,
    RequesterManaged: false,
    NetworkInterfaceIds: e.SubnetIds.map((s) => stableId(`epeni:${e.VpcEndpointId}:${s}`, 'eni-', 17)),
    DnsEntries: e.VpcEndpointType === 'Interface' ? [{ DnsName: base, HostedZoneId: 'Z7HUB22UULQXV' }, ...e.SubnetIds.map((s) => ({ DnsName: `${e.VpcEndpointId}-${md5(e.VpcEndpointId).slice(0, 8)}-${r.subnets[s]?.AvailabilityZone}.${short}.${c.region}.vpce.amazonaws.com`, HostedZoneId: 'Z7HUB22UULQXV' }))] : [],
    CreationTimestamp: iso(e.createdAt),
    Tags: e.Tags,
    OwnerId: c.acct.id,
  };
};

/** Servicio de AWS o de PrivateLink del que habla `name` (o null si no existe). */
function endpointService(r: Ec2Region, region: string, name: string): { short: string; custom?: EndpointService } | null {
  const short = name.replace(`com.amazonaws.${region}.`, '');
  if (name === `com.amazonaws.${region}.${short}` && (GATEWAY_SERVICES.includes(short) || INTERFACE_SERVICES.includes(short))) return { short };
  const custom = Object.values(services(r)).find((x) => x.ServiceName === name);
  return custom ? { short: name, custom } : null;
}

export function ec2CreateEndpoint(a: Account, region: string, o: { vpcId: string; service: string; type?: 'Gateway' | 'Interface'; routeTables?: string[]; subnets?: string[]; sgs?: string[]; privateDns?: boolean; policy?: VpcEndpoint['PolicyDocument']; ready?: boolean }): VpcEndpoint {
  const r = regional(a, region).ec2;
  const short = o.service.replace(`com.amazonaws.${region}.`, '');
  const type = o.type ?? 'Gateway';
  const id = ec2Id(a, 'vpce');
  const e: VpcEndpoint = { VpcEndpointId: id, VpcId: o.vpcId, ServiceName: o.service, VpcEndpointType: type, State: o.ready ? 'available' : 'pending', RouteTableIds: o.routeTables ?? [], SubnetIds: o.subnets ?? [], SecurityGroupIds: o.sgs ?? [], PrivateDnsEnabled: type === 'Interface' ? o.privateDns ?? true : false, PolicyDocument: o.policy, PrefixListId: type === 'Gateway' ? prefixListId(region, short) : undefined, ips: {}, createdAt: o.ready ? a.clock - 300000 : a.clock, Tags: [] };
  if (type === 'Interface') {
    for (const s of e.SubnetIds) {
      const c = parseCidr(r.subnets[s].CidrBlock)!;
      const used = new Set([...Object.values(r.instances).map((i) => i.PrivateIpAddress), ...Object.values(eps(r)).flatMap((x) => Object.values(x.ips))]);
      let off = 30 + (parseInt(md5(id + s).slice(0, 4), 16) % 40);
      while (used.has(intToIp(c.base + off))) off++;
      e.ips[s] = intToIp(c.base + off);
    }
    if (!e.SecurityGroupIds.length) e.SecurityGroupIds = [Object.values(r.securityGroups).find((g) => g.VpcId === o.vpcId && g.GroupName === 'default')!.GroupId];
  }
  eps(r)[id] = e;
  for (const rtId of e.RouteTableIds) {
    const rt = r.routeTables[rtId];
    if (rt && e.PrefixListId) rt.routes.push({ DestinationCidrBlock: '', DestinationPrefixListId: e.PrefixListId, target: id, Origin: 'CreateRoute' });
  }
  return e;
}

op('ec2', 'create-vpc-endpoint', 'vpc-id:s! vpc-endpoint-type:s service-name:s! policy-document:s route-table-ids:l subnet-ids:l security-group-ids:l client-token:s private-dns-enabled:b tag-specifications:f dry-run:b', 'Crea un endpoint: acceso privado a un servicio de AWS (o de PrivateLink) sin salir a internet.', { dryRun: true, res: (c) => arn(c, 'vpc-endpoint') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const vpc = r.vpcs[c.p.VpcId];
  if (!vpc) throw new AwsError('InvalidVpcId.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  const svc = endpointService(r, c.region, c.p.ServiceName);
  if (!svc) throw new AwsError('InvalidServiceName', `The Vpc Endpoint Service '${c.p.ServiceName}' does not exist`, 400);
  const type = (c.p.VpcEndpointType ?? (svc.custom ? 'Interface' : GATEWAY_SERVICES.includes(svc.short) ? 'Gateway' : 'Interface')) as 'Gateway' | 'Interface';
  if (!['Gateway', 'Interface', 'GatewayLoadBalancer'].includes(type)) throw new AwsError('InvalidParameter', `Unknown endpoint type ${type}`, 400);
  if (type === 'Gateway' && !GATEWAY_SERVICES.includes(svc.short)) throw new AwsError('InvalidParameter', `The VPC endpoint service ${c.p.ServiceName} does not support the Gateway endpoint type. Use Interface.`, 400);
  if (type === 'Interface' && !svc.custom && !INTERFACE_SERVICES.includes(svc.short)) throw new AwsError('InvalidParameter', `The VPC endpoint service ${c.p.ServiceName} does not support the Interface endpoint type.`, 400);
  const rts: string[] = c.p.RouteTableIds ?? [];
  const subs: string[] = c.p.SubnetIds ?? [];
  for (const id of rts) {
    const t = r.routeTables[id];
    if (!t) throw new AwsError('InvalidRouteTableId.NotFound', `The route table ID '${id}' does not exist`, 400);
    if (t.VpcId !== vpc.VpcId) throw new AwsError('InvalidParameter', `Route table ${id} does not belong to VPC ${vpc.VpcId}`, 400);
  }
  if (type === 'Gateway' && !rts.length) throw new AwsError('InvalidParameter', 'At least one route table must be specified for a Gateway endpoint (--route-table-ids).', 400);
  if (type === 'Interface') {
    if (!subs.length) throw new AwsError('InvalidParameter', 'At least one subnet must be specified for an Interface endpoint (--subnet-ids).', 400);
    for (const id of subs) {
      const sn = r.subnets[id];
      if (!sn) throw new AwsError('InvalidSubnetID.NotFound', `The subnet ID '${id}' does not exist`, 400);
      if (sn.VpcId !== vpc.VpcId) throw new AwsError('InvalidParameter', `Subnet ${id} does not belong to VPC ${vpc.VpcId}`, 400);
    }
    for (const g of c.p.SecurityGroupIds ?? []) if (!r.securityGroups[g]) throw new AwsError('InvalidGroup.NotFound', `The security group '${g}' does not exist`, 400);
    if ((c.p.PrivateDnsEnabled ?? !svc.custom) && !svc.custom && !(vpc.EnableDnsSupport !== false && vpc.EnableDnsHostnames)) throw new AwsError('InvalidParameter', 'To set PrivateDnsEnabled to true, the VPC must have DNS hostname and DNS resolution enabled (enableDnsHostnames and enableDnsSupport).', 400);
  }
  let policy: VpcEndpoint['PolicyDocument'];
  if (c.p.PolicyDocument) {
    try {
      policy = JSON.parse(c.p.PolicyDocument);
    } catch {
      throw new AwsError('InvalidPolicyDocument', 'Policy document should not specify a principal or is not valid JSON.', 400);
    }
  }
  const e = ec2CreateEndpoint(c.acct, c.region, { vpcId: vpc.VpcId, service: c.p.ServiceName, type, routeTables: rts, subnets: subs, sgs: c.p.SecurityGroupIds, privateDns: svc.custom ? false : c.p.PrivateDnsEnabled, policy });
  e.Tags = tagsFor(c.p.TagSpecifications, 'vpc-endpoint');
  if (svc.custom?.AcceptanceRequired) e.State = 'pendingAcceptance';
  return { VpcEndpoint: epView(c, r, e) };
});

op('ec2', 'describe-vpc-endpoints', 'vpc-endpoint-ids:l filters:f dry-run:b', 'Lista los endpoints de VPC.', { dryRun: true, paginate: 'VpcEndpoints' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.VpcEndpointIds ?? []) if (!eps(r)[id] || eps(r)[id].State === 'deleted') throw new AwsError('InvalidVpcEndpointId.NotFound', `The VpcEndpoint Id '${id}' does not exist`, 400);
  return {
    VpcEndpoints: Object.values(eps(r))
      .filter((e) => e.State !== 'deleted' && (!c.p.VpcEndpointIds || c.p.VpcEndpointIds.includes(e.VpcEndpointId)) && filterOk(c.p.Filters, (n) => (n === 'vpc-id' ? [e.VpcId] : n === 'service-name' ? [e.ServiceName] : n === 'vpc-endpoint-type' ? [e.VpcEndpointType] : n === 'vpc-endpoint-state' ? [endpointState(c.acct, e)] : n === 'vpc-endpoint-id' ? [e.VpcEndpointId] : tagGetter(e.Tags)(n))))
      .map((e) => epView(c, r, e)),
  };
});

op('ec2', 'modify-vpc-endpoint', 'vpc-endpoint-id:s! add-route-table-ids:l remove-route-table-ids:l add-subnet-ids:l remove-subnet-ids:l add-security-group-ids:l remove-security-group-ids:l policy-document:s private-dns-enabled:b reset-policy:b dry-run:b', 'Cambia las tablas de rutas, subredes, grupos de seguridad, política o DNS privado de un endpoint.', { dryRun: true, res: (c) => arn(c, 'vpc-endpoint', c.p.VpcEndpointId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const e = eps(r)[c.p.VpcEndpointId];
  if (!e || e.State === 'deleted') throw new AwsError('InvalidVpcEndpointId.NotFound', `The VpcEndpoint Id '${c.p.VpcEndpointId}' does not exist`, 400);
  for (const id of c.p.AddRouteTableIds ?? []) {
    const rt = r.routeTables[id];
    if (!rt || rt.VpcId !== e.VpcId) throw new AwsError('InvalidRouteTableId.NotFound', `The route table ID '${id}' does not exist in the endpoint's VPC`, 400);
    if (!e.RouteTableIds.includes(id) && e.PrefixListId) {
      e.RouteTableIds.push(id);
      rt.routes.push({ DestinationCidrBlock: '', DestinationPrefixListId: e.PrefixListId, target: e.VpcEndpointId, Origin: 'CreateRoute' });
    }
  }
  for (const id of c.p.RemoveRouteTableIds ?? []) {
    e.RouteTableIds = e.RouteTableIds.filter((x) => x !== id);
    const rt = r.routeTables[id];
    if (rt) rt.routes = rt.routes.filter((x) => x.target !== e.VpcEndpointId);
  }
  if (c.p.AddSubnetIds) for (const s of c.p.AddSubnetIds as string[]) if (!e.SubnetIds.includes(s) && r.subnets[s]) e.SubnetIds.push(s);
  if (c.p.RemoveSubnetIds) e.SubnetIds = e.SubnetIds.filter((x) => !(c.p.RemoveSubnetIds as string[]).includes(x));
  if (c.p.AddSecurityGroupIds) e.SecurityGroupIds = [...new Set([...e.SecurityGroupIds, ...(c.p.AddSecurityGroupIds as string[])])];
  if (c.p.RemoveSecurityGroupIds) e.SecurityGroupIds = e.SecurityGroupIds.filter((x) => !(c.p.RemoveSecurityGroupIds as string[]).includes(x));
  if (c.p.PolicyDocument) {
    try {
      e.PolicyDocument = JSON.parse(c.p.PolicyDocument);
    } catch {
      throw new AwsError('InvalidPolicyDocument', 'The policy document is not valid JSON.', 400);
    }
  }
  if (c.p.ResetPolicy) e.PolicyDocument = undefined;
  if (c.p.PrivateDnsEnabled !== undefined) e.PrivateDnsEnabled = !!c.p.PrivateDnsEnabled;
  return { Return: true };
});

op('ec2', 'delete-vpc-endpoints', 'vpc-endpoint-ids:l! dry-run:b', 'Borra endpoints (y quita de las tablas de rutas la ruta del endpoint).', { dryRun: true, res: (c) => (c.p.VpcEndpointIds as string[]).map((id) => arn(c, 'vpc-endpoint', id)) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const unsuccessful: unknown[] = [];
  for (const id of c.p.VpcEndpointIds as string[]) {
    const e = eps(r)[id];
    if (!e || e.State === 'deleted') {
      unsuccessful.push({ ResourceId: id, Error: { Code: 'InvalidVpcEndpoint.NotFound', Message: `The VpcEndpoint ${id} does not exist` } });
      continue;
    }
    e.State = 'deleted';
    for (const rt of Object.values(r.routeTables)) rt.routes = rt.routes.filter((x) => x.target !== id);
  }
  return { Unsuccessful: unsuccessful };
});

// ───────────────────────── PrivateLink: publicar un servicio ─────────────────────────

op('ec2', 'create-vpc-endpoint-service-configuration', 'network-load-balancer-arns:l acceptance-required:b private-dns-name:s tag-specifications:f dry-run:b', 'Publica tu servicio (detrás de un NLB) para que otras VPC se conecten con PrivateLink.', { dryRun: true, res: (c) => arn(c, 'vpc-endpoint-service') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const nlbs: string[] = c.p.NetworkLoadBalancerArns ?? [];
  if (!nlbs.length) throw new AwsError('MissingParameter', 'The request must contain the parameter NetworkLoadBalancerArns (or GatewayLoadBalancerArns)', 400);
  const lbs = regional(c.acct, c.region).elb?.lbs ?? {};
  for (const x of nlbs) {
    const lb = lbs[x];
    if (!lb) throw new AwsError('InvalidParameter', `The load balancer ${x} does not exist`, 400);
    if (lb.Type !== 'network') throw new AwsError('InvalidParameter', `The load balancer ${x} is not a Network Load Balancer: PrivateLink needs an NLB (or a GWLB).`, 400);
  }
  const id = 'vpce-svc-' + md5(newId(c.acct, 'vpcesvc', '', 8, 'hex')).slice(0, 17);
  const svc: EndpointService = { ServiceId: id, ServiceName: `com.amazonaws.vpce.${c.region}.${id}`, NetworkLoadBalancerArns: nlbs, AcceptanceRequired: c.p.AcceptanceRequired !== false && c.p.AcceptanceRequired !== undefined ? !!c.p.AcceptanceRequired : false, AllowedPrincipals: [], Tags: tagsFor(c.p.TagSpecifications, 'vpc-endpoint-service') };
  services(r)[id] = svc;
  return { ServiceConfiguration: svcView(c, svc) };
});

const svcView = (c: OpCtx, s: EndpointService) => ({ ServiceType: [{ ServiceType: 'Interface' }], ServiceId: s.ServiceId, ServiceName: s.ServiceName, ServiceState: 'Available', AvailabilityZones: [...new Set(s.NetworkLoadBalancerArns.flatMap((x) => (regional(c.acct, c.region).elb?.lbs[x]?.subnetIds ?? []).map((id) => regional(c.acct, c.region).ec2.subnets[id]?.AvailabilityZone)))], AcceptanceRequired: s.AcceptanceRequired, ManagesVpcEndpoints: false, NetworkLoadBalancerArns: s.NetworkLoadBalancerArns, BaseEndpointDnsNames: [`${s.ServiceId}.${c.region}.vpce.amazonaws.com`], Tags: s.Tags });

op('ec2', 'describe-vpc-endpoint-service-configurations', 'service-ids:l filters:f dry-run:b', 'Los servicios que has publicado con PrivateLink.', { dryRun: true, paginate: 'ServiceConfigurations' }, (c) => ({ ServiceConfigurations: Object.values(services(refreshEc2(c.acct, c.region))).filter((s) => !c.p.ServiceIds || c.p.ServiceIds.includes(s.ServiceId)).map((s) => svcView(c, s)) }));

op('ec2', 'modify-vpc-endpoint-service-permissions', 'service-id:s! add-allowed-principals:l remove-allowed-principals:l dry-run:b', 'Quién puede conectarse a tu servicio (ARN de cuentas, usuarios o roles).', { dryRun: true, res: (c) => arn(c, 'vpc-endpoint-service', c.p.ServiceId) }, (c) => {
  const s = services(refreshEc2(c.acct, c.region))[c.p.ServiceId];
  if (!s) throw new AwsError('InvalidVpcEndpointServiceId.NotFound', `The VpcEndpointService Id '${c.p.ServiceId}' does not exist`, 400);
  s.AllowedPrincipals = [...new Set([...s.AllowedPrincipals, ...toArr<string>(c.p.AddAllowedPrincipals)])].filter((x) => !toArr<string>(c.p.RemoveAllowedPrincipals).includes(x));
  return { ReturnValue: true };
});

op('ec2', 'accept-vpc-endpoint-connections', 'service-id:s! vpc-endpoint-ids:l! dry-run:b', 'Acepta las conexiones pendientes de otras VPC a tu servicio.', { dryRun: true, res: (c) => arn(c, 'vpc-endpoint-service', c.p.ServiceId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const s = services(r)[c.p.ServiceId];
  if (!s) throw new AwsError('InvalidVpcEndpointServiceId.NotFound', `The VpcEndpointService Id '${c.p.ServiceId}' does not exist`, 400);
  const bad: unknown[] = [];
  for (const id of c.p.VpcEndpointIds as string[]) {
    const e = eps(r)[id];
    if (!e || e.ServiceName !== s.ServiceName) {
      bad.push({ ResourceId: id, Error: { Code: 'InvalidVpcEndpointId.NotFound', Message: `The endpoint ${id} is not connected to this service` } });
      continue;
    }
    e.State = 'available';
    e.createdAt = c.acct.clock - PENDING_MS;
  }
  return { Unsuccessful: bad };
});

// ───────────────────────── IPv6 y salida solo-IPv6 ─────────────────────────

const ipv6Block = (id: string) => `2600:1f18:${md5(id).slice(0, 4)}:${md5(id).slice(4, 6)}00::/56`;

op('ec2', 'associate-vpc-cidr-block', 'vpc-id:s! cidr-block:s amazon-provided-ipv6-cidr-block:b', 'Añade un bloque IPv6 (de Amazon) o un CIDR IPv4 adicional a una VPC.', { res: (c) => arn(c, 'vpc', c.p.VpcId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = r.vpcs[c.p.VpcId];
  if (!v) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  if (c.p.AmazonProvidedIpv6CidrBlock) {
    if (v.Ipv6CidrBlock) throw new AwsError('CidrConflict', 'The VPC already has an IPv6 CIDR block.', 400);
    v.Ipv6CidrBlock = ipv6Block(v.VpcId);
    return { VpcId: v.VpcId, Ipv6CidrBlockAssociation: { AssociationId: stableId(`vpc-ipv6:${v.VpcId}`, 'vpc-cidr-assoc-', 17), Ipv6CidrBlock: v.Ipv6CidrBlock, Ipv6CidrBlockState: { State: 'associating' }, Ipv6Pool: 'Amazon', NetworkBorderGroup: c.region } };
  }
  const cidr = c.p.CidrBlock as string | undefined;
  if (!cidr || !parseCidr(cidr)) throw new AwsError('InvalidParameterValue', 'Specify --cidr-block or --amazon-provided-ipv6-cidr-block with a valid value.', 400);
  for (const x of vpcCidrs(r, v.VpcId)) if (cidrOverlap(x, cidr)) throw new AwsError('InvalidVpcRange', `The CIDR '${cidr}' overlaps with ${x}.`, 400);
  (v.ExtraCidrBlocks ??= []).push(cidr);
  return { VpcId: v.VpcId, CidrBlockAssociation: { AssociationId: stableId(`vpcassoc:${v.VpcId}:${cidr}`, 'vpc-cidr-assoc-', 8), CidrBlock: cidr, CidrBlockState: { State: 'associating' } } };
});

op('ec2', 'associate-subnet-cidr-block', 'subnet-id:s! ipv6-cidr-block:s!', 'Da un bloque IPv6 /64 a una subred (dentro del /56 de la VPC).', { res: (c) => arn(c, 'subnet', c.p.SubnetId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const sn = r.subnets[c.p.SubnetId];
  if (!sn) throw new AwsError('InvalidSubnetID.NotFound', `The subnet ID '${c.p.SubnetId}' does not exist`, 400);
  const v = r.vpcs[sn.VpcId];
  if (!v.Ipv6CidrBlock) throw new AwsError('InvalidParameterValue', 'The VPC has no IPv6 CIDR block. Associate one first (associate-vpc-cidr-block --amazon-provided-ipv6-cidr-block).', 400);
  const want = String(c.p.Ipv6CidrBlock);
  const vp = v.Ipv6CidrBlock.split('::')[0];
  if (!/\/64$/.test(want) || !want.toLowerCase().startsWith(vp.toLowerCase().slice(0, -2))) throw new AwsError('InvalidParameterValue', `The IPv6 CIDR ${want} must be a /64 inside the VPC block ${v.Ipv6CidrBlock}.`, 400);
  sn.Ipv6CidrBlock = want;
  return { SubnetId: sn.SubnetId, Ipv6CidrBlockAssociation: { AssociationId: stableId(`subnet-cidr-assoc:${sn.SubnetId}`, 'subnet-cidr-assoc-', 17), Ipv6CidrBlock: want, Ipv6CidrBlockState: { State: 'associating' } } };
});

const eigws = (r: Ec2Region) => (r.eigws ??= {});

op('ec2', 'create-egress-only-internet-gateway', 'vpc-id:s! tag-specifications:f dry-run:b', 'Crea una puerta de salida solo-IPv6: las instancias salen a internet por IPv6, pero nadie puede iniciar conexiones hacia ellas.', { dryRun: true, res: (c) => arn(c, 'egress-only-internet-gateway') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!r.vpcs[c.p.VpcId]) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  const id = ec2Id(c.acct, 'eigw');
  eigws(r)[id] = { EgressOnlyInternetGatewayId: id, VpcId: c.p.VpcId, Tags: tagsFor(c.p.TagSpecifications, 'egress-only-internet-gateway') };
  return { EgressOnlyInternetGateway: { Attachments: [{ State: 'attached', VpcId: c.p.VpcId }], EgressOnlyInternetGatewayId: id, Tags: eigws(r)[id].Tags } };
});

op('ec2', 'describe-egress-only-internet-gateways', 'egress-only-internet-gateway-ids:l filters:f dry-run:b', 'Lista las puertas de salida solo-IPv6.', { dryRun: true, paginate: 'EgressOnlyInternetGateways' }, (c) => ({ EgressOnlyInternetGateways: Object.values(eigws(refreshEc2(c.acct, c.region))).filter((e) => !c.p.EgressOnlyInternetGatewayIds || c.p.EgressOnlyInternetGatewayIds.includes(e.EgressOnlyInternetGatewayId)).map((e) => ({ Attachments: [{ State: 'attached', VpcId: e.VpcId }], EgressOnlyInternetGatewayId: e.EgressOnlyInternetGatewayId, Tags: e.Tags })) }));

op('ec2', 'delete-egress-only-internet-gateway', 'egress-only-internet-gateway-id:s! dry-run:b', 'Borra una puerta de salida solo-IPv6.', { dryRun: true, res: (c) => arn(c, 'egress-only-internet-gateway', c.p.EgressOnlyInternetGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!eigws(r)[c.p.EgressOnlyInternetGatewayId]) throw new AwsError('InvalidGatewayID.NotFound', `The gateway ID '${c.p.EgressOnlyInternetGatewayId}' does not exist`, 400);
  delete eigws(r)[c.p.EgressOnlyInternetGatewayId];
  return { ReturnCode: true };
});

void cidrWithin;
