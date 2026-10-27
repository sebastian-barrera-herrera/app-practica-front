/** VPN de sitio a sitio (puerta del cliente, puerta privada virtual, conexión VPN con dos túneles) y AWS Direct Connect. */
import { regional } from '../account';
import { ON_PREM_CIDR, vpnRoutes } from '../onprem';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, CustomerGateway, DxState, Ec2Region, Tag, VpnConnection, VpnGateway } from '../types';
import { md5 as md5Hex } from '../../engine/commands/hash';
import { ec2Id, iso, mkArn, parseCidr } from '../util';
import { filterOk, refreshEc2, tagGetter, tagsFor } from './ec2';
import { syncPropagation, tgwState } from './tgw';

export { ON_PREM_CIDR, vpnRoutes };
const TUNNEL_UP_MS = 180000;

const cgws = (r: Ec2Region) => (r.cgws ??= {});
const vgws = (r: Ec2Region) => (r.vgws ??= {});
const vpns = (r: Ec2Region) => (r.vpns ??= {});
const arn = (c: OpCtx, type: string, id = '*') => mkArn('ec2', c.region, c.acct.id, `${type}/${id}`);

// ───────────────────────── puerta del cliente ─────────────────────────

const cgwView = (g: CustomerGateway) => ({ BgpAsn: String(g.BgpAsn), CustomerGatewayId: g.CustomerGatewayId, IpAddress: g.IpAddress, State: 'available', Type: g.Type, Tags: g.Tags });

export function ec2CreateCgw(a: Account, region: string, ip: string, asn = 65000, tags: Tag[] = []): CustomerGateway {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'cgw');
  cgws(r)[id] = { CustomerGatewayId: id, BgpAsn: asn, IpAddress: ip, Type: 'ipsec.1', Tags: tags };
  return cgws(r)[id];
}

op('ec2', 'create-customer-gateway', 'type:s! public-ip:s bgp-asn:i device-name:s tag-specifications:f dry-run:b', 'Registra tu router de la oficina (su IP pública y su ASN) para crear la VPN.', { dryRun: true, res: (c) => arn(c, 'customer-gateway') }, (c) => {
  if (c.p.Type !== 'ipsec.1') throw new AwsError('InvalidParameterValue', `Value (${c.p.Type}) for parameter type is invalid. Valid value: ipsec.1`, 400);
  const ip = c.p.PublicIp as string | undefined;
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some((x) => Number(x) > 255)) throw new AwsError('InvalidParameterValue', `Value (${ip ?? ''}) for parameter ipAddress is invalid. Specify a valid public IPv4 address.`, 400);
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) throw new AwsError('InvalidParameterValue', `The IP address ${ip} is private. The customer gateway needs the PUBLIC IP of your device.`, 400);
  const g = ec2CreateCgw(c.acct, c.region, ip, c.p.BgpAsn ?? 65000, tagsFor(c.p.TagSpecifications, 'customer-gateway'));
  return { CustomerGateway: cgwView(g) };
});

op('ec2', 'describe-customer-gateways', 'customer-gateway-ids:l filters:f dry-run:b', 'Lista tus puertas del cliente.', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { CustomerGateways: Object.values(cgws(r)).filter((g) => !c.p.CustomerGatewayIds || c.p.CustomerGatewayIds.includes(g.CustomerGatewayId)).map(cgwView) };
});

op('ec2', 'delete-customer-gateway', 'customer-gateway-id:s! dry-run:b', 'Borra una puerta del cliente (sin conexiones VPN).', { dryRun: true, res: (c) => arn(c, 'customer-gateway', c.p.CustomerGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!cgws(r)[c.p.CustomerGatewayId]) throw new AwsError('InvalidCustomerGatewayID.NotFound', `The customerGateway ID '${c.p.CustomerGatewayId}' does not exist`, 400);
  if (Object.values(vpns(r)).some((v) => !v.deleted && v.CustomerGatewayId === c.p.CustomerGatewayId)) throw new AwsError('IncorrectState', 'The customer gateway is in use by a VPN connection.', 400);
  delete cgws(r)[c.p.CustomerGatewayId];
  return undefined;
});

// ───────────────────────── puerta privada virtual ─────────────────────────

const vgwView = (g: VpnGateway) => ({ VpnGatewayId: g.VpnGatewayId, State: 'available', Type: g.Type, VpcAttachments: g.VpcId ? [{ State: 'attached', VpcId: g.VpcId }] : [], AmazonSideAsn: g.AmazonSideAsn, Tags: g.Tags });

export function ec2CreateVgw(a: Account, region: string, vpcId?: string, tags: Tag[] = []): VpnGateway {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'vgw');
  vgws(r)[id] = { VpnGatewayId: id, Type: 'ipsec.1', AmazonSideAsn: 64512, VpcId: vpcId, propagating: [], Tags: tags };
  return vgws(r)[id];
}

op('ec2', 'create-vpn-gateway', 'type:s! amazon-side-asn:i availability-zone:s tag-specifications:f dry-run:b', 'Crea una puerta privada virtual: el lado AWS de la VPN (hay que conectarla a una VPC).', { dryRun: true, res: (c) => arn(c, 'vpn-gateway') }, (c) => {
  if (c.p.Type !== 'ipsec.1') throw new AwsError('InvalidParameterValue', `Value (${c.p.Type}) for parameter type is invalid. Valid value: ipsec.1`, 400);
  const g = ec2CreateVgw(c.acct, c.region, undefined, tagsFor(c.p.TagSpecifications, 'vpn-gateway'));
  if (c.p.AmazonSideAsn) g.AmazonSideAsn = c.p.AmazonSideAsn;
  return { VpnGateway: vgwView(g) };
});

const findVgw = (r: Ec2Region, id: string): VpnGateway => {
  const g = vgws(r)[id];
  if (!g) throw new AwsError('InvalidVpnGatewayID.NotFound', `The vpnGateway ID '${id}' does not exist`, 400);
  return g;
};

op('ec2', 'attach-vpn-gateway', 'vpn-gateway-id:s! vpc-id:s! dry-run:b', 'Conecta la puerta privada virtual a una VPC.', { dryRun: true, res: (c) => arn(c, 'vpn-gateway', c.p.VpnGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = findVgw(r, c.p.VpnGatewayId);
  if (!r.vpcs[c.p.VpcId]) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  if (g.VpcId) throw new AwsError('InvalidParameterValue', `The vpn gateway ${g.VpnGatewayId} is already attached to ${g.VpcId}.`, 400);
  if (Object.values(vgws(r)).some((x) => x.VpcId === c.p.VpcId)) throw new AwsError('InvalidParameterValue', `VPC ${c.p.VpcId} already has a virtual private gateway attached.`, 400);
  g.VpcId = c.p.VpcId;
  return { VpcAttachment: { State: 'attaching', VpcId: c.p.VpcId } };
});

op('ec2', 'detach-vpn-gateway', 'vpn-gateway-id:s! vpc-id:s! dry-run:b', 'Desconecta la puerta privada virtual de la VPC.', { dryRun: true, res: (c) => arn(c, 'vpn-gateway', c.p.VpnGatewayId) }, (c) => {
  const g = findVgw(refreshEc2(c.acct, c.region), c.p.VpnGatewayId);
  if (g.VpcId !== c.p.VpcId) throw new AwsError('Gateway.NotAttached', `Resource ${g.VpnGatewayId} is not attached to network ${c.p.VpcId}`, 400);
  g.VpcId = undefined;
  g.propagating = [];
  return undefined;
});

op('ec2', 'describe-vpn-gateways', 'vpn-gateway-ids:l filters:f dry-run:b', 'Lista las puertas privadas virtuales.', { dryRun: true }, (c) => ({ VpnGateways: Object.values(vgws(refreshEc2(c.acct, c.region))).filter((g) => !c.p.VpnGatewayIds || c.p.VpnGatewayIds.includes(g.VpnGatewayId)).map(vgwView) }));

op('ec2', 'delete-vpn-gateway', 'vpn-gateway-id:s! dry-run:b', 'Borra una puerta privada virtual (desconectada y sin VPN).', { dryRun: true, res: (c) => arn(c, 'vpn-gateway', c.p.VpnGatewayId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = findVgw(r, c.p.VpnGatewayId);
  if (g.VpcId) throw new AwsError('IncorrectState', 'The virtual private gateway is still attached to a VPC.', 400);
  if (Object.values(vpns(r)).some((v) => !v.deleted && v.VpnGatewayId === g.VpnGatewayId)) throw new AwsError('IncorrectState', 'The virtual private gateway is used by a VPN connection.', 400);
  delete vgws(r)[g.VpnGatewayId];
  return undefined;
});

op('ec2', 'enable-vgw-route-propagation', 'gateway-id:s! route-table-id:s! dry-run:b', 'La tabla de rutas aprende sola las rutas que anuncia tu oficina por la VPN.', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const g = findVgw(r, c.p.GatewayId);
  const t = r.routeTables[c.p.RouteTableId];
  if (!t) throw new AwsError('InvalidRouteTableID.NotFound', `The routeTable ID '${c.p.RouteTableId}' does not exist`, 400);
  if (g.VpcId !== t.VpcId) throw new AwsError('InvalidParameterValue', `The gateway ${g.VpnGatewayId} is not attached to the VPC ${t.VpcId} of this route table.`, 400);
  if (!g.propagating.includes(t.RouteTableId)) g.propagating.push(t.RouteTableId);
  syncVgwRoutes(c.acct, c.region);
  return undefined;
});

op('ec2', 'disable-vgw-route-propagation', 'gateway-id:s! route-table-id:s! dry-run:b', 'Deja de propagar rutas de la VPN a esa tabla.', { dryRun: true, res: (c) => arn(c, 'route-table', c.p.RouteTableId) }, (c) => {
  const g = findVgw(refreshEc2(c.acct, c.region), c.p.GatewayId);
  g.propagating = g.propagating.filter((x) => x !== c.p.RouteTableId);
  syncVgwRoutes(c.acct, c.region);
  return undefined;
});

// ───────────────────────── conexión VPN ─────────────────────────

export const vpnState = (a: Account, v: VpnConnection): 'pending' | 'available' | 'deleted' => (v.deleted ? 'deleted' : a.clock - v.createdAt >= 60000 ? 'available' : 'pending');
export const tunnelsUp = (a: Account, v: VpnConnection): boolean => !v.deleted && a.clock - v.createdAt >= TUNNEL_UP_MS && (!v.StaticRoutesOnly || v.routes.length > 0);

const outsideIp = (id: string, n: number) => `3.${(parseInt(md5Hex(id + n).slice(0, 2), 16) % 200) + 20}.${parseInt(md5Hex(id + n).slice(2, 4), 16)}.${(parseInt(md5Hex(id + n).slice(4, 6), 16) % 250) + 2}`;

const vpnView = (c: OpCtx, v: VpnConnection) => {
  const up = tunnelsUp(c.acct, v);
  return {
    CustomerGatewayConfiguration: `<vpn_connection id="${v.VpnConnectionId}">…configuración del dispositivo (descárgala en la consola)…</vpn_connection>`,
    CustomerGatewayId: v.CustomerGatewayId,
    Category: 'VPN',
    State: vpnState(c.acct, v),
    Type: v.Type,
    VpnConnectionId: v.VpnConnectionId,
    ...(v.VpnGatewayId ? { VpnGatewayId: v.VpnGatewayId } : {}),
    ...(v.TransitGatewayId ? { TransitGatewayId: v.TransitGatewayId } : {}),
    Options: { EnableAcceleration: false, StaticRoutesOnly: v.StaticRoutesOnly, LocalIpv4NetworkCidr: '0.0.0.0/0', RemoteIpv4NetworkCidr: '0.0.0.0/0', TunnelInsideIpVersion: 'ipv4', TunnelOptions: [{ OutsideIpAddress: outsideIp(v.VpnConnectionId, 1) }, { OutsideIpAddress: outsideIp(v.VpnConnectionId, 2) }] },
    Routes: v.routes.map((DestinationCidrBlock) => ({ DestinationCidrBlock, Source: 'Static', State: 'available' })),
    Tags: v.Tags,
    VgwTelemetry: [1, 2].map((n) => ({ AcceptedRouteCount: up ? vpnRoutes(v).length : 0, LastStatusChange: iso(v.createdAt + TUNNEL_UP_MS), OutsideIpAddress: outsideIp(v.VpnConnectionId, n), Status: up ? 'UP' : 'DOWN', StatusMessage: up ? (v.StaticRoutesOnly ? '' : `${vpnRoutes(v).length} BGP ROUTES`) : v.StaticRoutesOnly && !v.routes.length ? 'No static routes configured' : 'IPSEC IS DOWN' })),
  };
};

/** Una VPN conectada a un Transit Gateway aparece como un adjunto más (de tipo `vpn`). */
export function tgwAttachVpn(a: Account, region: string, v: VpnConnection): void {
  const s = tgwState(a, region);
  const g = s.gateways[v.TransitGatewayId ?? ''];
  if (!g) return;
  const id = ec2Id(a, 'tgw-attach');
  s.attachments[id] = { TransitGatewayAttachmentId: id, TransitGatewayId: g.TransitGatewayId, ResourceType: 'vpn', ResourceId: v.VpnConnectionId, SubnetIds: [], createdAt: v.createdAt, Tags: [] };
  const rt = s.routeTables[g.DefaultRouteTableId];
  if (g.DefaultRouteTableAssociation) rt.associations.push(id);
  if (g.DefaultRouteTablePropagation) rt.propagations.push(id);
  syncPropagation(a, region);
}

export function ec2CreateVpn(a: Account, region: string, cgwId: string, o: { vgw?: string; tgw?: string; static?: boolean; routes?: string[]; ready?: boolean; tags?: Tag[] }): VpnConnection {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'vpn');
  const v: VpnConnection = { VpnConnectionId: id, CustomerGatewayId: cgwId, VpnGatewayId: o.vgw, TransitGatewayId: o.tgw, Type: 'ipsec.1', StaticRoutesOnly: !!o.static, routes: o.routes ?? [], createdAt: o.ready ? a.clock - 600000 : a.clock, Tags: o.tags ?? [] };
  vpns(r)[id] = v;
  return v;
}

op('ec2', 'create-vpn-connection', 'type:s! customer-gateway-id:s! vpn-gateway-id:s transit-gateway-id:s options:j tag-specifications:f dry-run:b', 'Crea una VPN de sitio a sitio (dos túneles IPsec) entre tu oficina y una VPC (o un Transit Gateway).', { dryRun: true, res: (c) => arn(c, 'vpn-connection') }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (c.p.Type !== 'ipsec.1') throw new AwsError('InvalidParameterValue', `Value (${c.p.Type}) for parameter type is invalid. Valid value: ipsec.1`, 400);
  if (!cgws(r)[c.p.CustomerGatewayId]) throw new AwsError('InvalidCustomerGatewayID.NotFound', `The customerGateway ID '${c.p.CustomerGatewayId}' does not exist`, 400);
  if (!c.p.VpnGatewayId && !c.p.TransitGatewayId) throw new AwsError('MissingParameter', 'Specify either --vpn-gateway-id or --transit-gateway-id.', 400);
  if (c.p.VpnGatewayId && c.p.TransitGatewayId) throw new AwsError('InvalidParameterCombination', 'Specify only one of --vpn-gateway-id or --transit-gateway-id.', 400);
  if (c.p.VpnGatewayId) findVgw(r, c.p.VpnGatewayId);
  if (c.p.TransitGatewayId && !regional(c.acct, c.region).tgw?.gateways[c.p.TransitGatewayId]) throw new AwsError('InvalidTransitGatewayID.NotFound', `Transit Gateway ${c.p.TransitGatewayId} was not found`, 400);
  const o = (c.p.Options ?? {}) as Record<string, unknown>;
  const v = ec2CreateVpn(c.acct, c.region, c.p.CustomerGatewayId, { vgw: c.p.VpnGatewayId, tgw: c.p.TransitGatewayId, static: o.StaticRoutesOnly === true || o.StaticRoutesOnly === 'true', tags: tagsFor(c.p.TagSpecifications, 'vpn-connection') });
  if (v.TransitGatewayId) tgwAttachVpn(c.acct, c.region, v);
  return { VpnConnection: vpnView(c, v) };
});

const findVpn = (r: Ec2Region, id: string): VpnConnection => {
  const v = vpns(r)[id];
  if (!v || v.deleted) throw new AwsError('InvalidVpnConnectionID.NotFound', `The vpnConnection ID '${id}' does not exist`, 400);
  return v;
};

op('ec2', 'describe-vpn-connections', 'vpn-connection-ids:l filters:f dry-run:b', 'Lista las VPN y el estado de sus dos túneles (UP/DOWN).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.VpnConnectionIds ?? []) findVpn(r, id);
  return { VpnConnections: Object.values(vpns(r)).filter((v) => !v.deleted && (!c.p.VpnConnectionIds || c.p.VpnConnectionIds.includes(v.VpnConnectionId)) && filterOk(c.p.Filters, (n) => (n === 'vpn-connection-id' ? [v.VpnConnectionId] : n === 'state' ? [vpnState(c.acct, v)] : n === 'customer-gateway-id' ? [v.CustomerGatewayId] : tagGetter(v.Tags)(n)))).map((v) => vpnView(c, v)) };
});

op('ec2', 'create-vpn-connection-route', 'destination-cidr-block:s! vpn-connection-id:s!', 'En una VPN estática, indica qué redes de tu oficina hay al otro lado.', { res: (c) => arn(c, 'vpn-connection', c.p.VpnConnectionId) }, (c) => {
  const v = findVpn(refreshEc2(c.acct, c.region), c.p.VpnConnectionId);
  if (!v.StaticRoutesOnly) throw new AwsError('InvalidParameterValue', 'This VPN connection uses dynamic routing (BGP): static routes are only for connections created with StaticRoutesOnly=true.', 400);
  if (!parseCidr(c.p.DestinationCidrBlock)) throw new AwsError('InvalidParameterValue', `Value (${c.p.DestinationCidrBlock}) for parameter destinationCidrBlock is invalid.`, 400);
  if (!v.routes.includes(c.p.DestinationCidrBlock)) v.routes.push(c.p.DestinationCidrBlock);
  syncVgwRoutes(c.acct, c.region);
  return undefined;
});

op('ec2', 'delete-vpn-connection', 'vpn-connection-id:s! dry-run:b', 'Borra una VPN (el túnel deja de existir).', { dryRun: true, res: (c) => arn(c, 'vpn-connection', c.p.VpnConnectionId) }, (c) => {
  const v = findVpn(refreshEc2(c.acct, c.region), c.p.VpnConnectionId);
  v.deleted = true;
  const ts = tgwState(c.acct, c.region);
  for (const att of Object.values(ts.attachments)) if (att.ResourceType === 'vpn' && att.ResourceId === v.VpnConnectionId) att.deleted = true;
  for (const rt of Object.values(ts.routeTables)) {
    rt.associations = rt.associations.filter((i) => !ts.attachments[i]?.deleted);
    rt.propagations = rt.propagations.filter((i) => !ts.attachments[i]?.deleted);
  }
  syncPropagation(c.acct, c.region);
  syncVgwRoutes(c.acct, c.region);
  return undefined;
});

/** Mantiene en las tablas de rutas con propagación las rutas que traen las VPN. */
export function syncVgwRoutes(a: Account, region: string): void {
  const r = regional(a, region).ec2;
  for (const g of Object.values(vgws(r))) {
    const cidrs = new Set(Object.values(vpns(r)).filter((v) => !v.deleted && v.VpnGatewayId === g.VpnGatewayId).flatMap(vpnRoutes));
    for (const rt of Object.values(r.routeTables)) {
      rt.routes = rt.routes.filter((x) => !(x.Origin === 'EnableVgwRoutePropagation' && x.target === g.VpnGatewayId));
      if (!g.propagating.includes(rt.RouteTableId)) continue;
      for (const cidr of cidrs) if (!rt.routes.some((x) => x.DestinationCidrBlock === cidr)) rt.routes.push({ DestinationCidrBlock: cidr, target: g.VpnGatewayId, Origin: 'EnableVgwRoutePropagation' });
    }
  }
}

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) if (a.regions[region].ec2.vgws) syncVgwRoutes(a, region);
});

// ───────────────────────── Direct Connect (visión general) ─────────────────────────

const LOCATIONS = [
  { locationCode: 'EqDC2', locationName: 'Equinix DC1-DC15, DC21, Ashburn, VA', region: 'us-east-1', availablePortSpeeds: ['1Gbps', '10Gbps', '100Gbps'], availableProviders: ['Equinix', 'Cologix'] },
  { locationCode: 'EqLD5', locationName: 'Equinix LD5, Slough', region: 'eu-west-2', availablePortSpeeds: ['1Gbps', '10Gbps'], availableProviders: ['Equinix', 'Colt'] },
  { locationCode: 'TCMAD1', locationName: 'Telehouse Madrid', region: 'eu-south-2', availablePortSpeeds: ['1Gbps', '10Gbps'], availableProviders: ['Telefónica'] },
];

op('directconnect', 'describe-locations', '', 'Ubicaciones físicas donde puedes conectar tu red con AWS por un cable dedicado.', { res: () => '*' }, () => ({ locations: LOCATIONS }));

const dxState = (a: Account): DxState => (a.dx ??= { conns: {}, gws: {} });

op('directconnect', 'create-connection', 'location:s! bandwidth:s! connection-name:s! tags:t', 'Pide un puerto de Direct Connect. En la vida real tarda días o semanas en llegar el cable.', { res: () => '*' }, (c) => {
  if (!LOCATIONS.some((l) => l.locationCode === c.p.Location)) throw new AwsError('DirectConnectClientException', `Invalid location code: ${c.p.Location}. Use describe-locations.`, 400);
  if (!['1Gbps', '10Gbps', '100Gbps'].includes(c.p.Bandwidth)) throw new AwsError('DirectConnectClientException', 'Invalid bandwidth. Valid values: 1Gbps, 10Gbps, 100Gbps (dedicated connections).', 400);
  const id = 'dxcon-' + md5Hex(c.acct.id + c.p.ConnectionName).slice(0, 8);
  dxState(c.acct).conns[id] = { connectionId: id, connectionName: c.p.ConnectionName, location: c.p.Location, bandwidth: c.p.Bandwidth, createdAt: c.acct.clock };
  return { ownerAccount: c.acct.id, connectionId: id, connectionName: c.p.ConnectionName, connectionState: 'ordering', region: c.region, location: c.p.Location, bandwidth: c.p.Bandwidth, vlan: 0, partnerName: '', loaIssueTime: undefined, jumboFrameCapable: true, hasLogicalRedundancy: 'unknown' };
});

op('directconnect', 'describe-connections', 'connection-id:s', 'Lista tus conexiones de Direct Connect y su estado (ordering → requested → pending → available).', { res: () => '*' }, (c) => ({ connections: Object.values(dxState(c.acct).conns).filter((x) => !c.p.ConnectionId || x.connectionId === c.p.ConnectionId).map((x) => ({ ownerAccount: c.acct.id, connectionId: x.connectionId, connectionName: x.connectionName, connectionState: c.acct.clock - x.createdAt > 604800000 ? 'available' : 'ordering', region: c.region, location: x.location, bandwidth: x.bandwidth, vlan: 0, jumboFrameCapable: true })) }));

op('directconnect', 'create-direct-connect-gateway', 'direct-connect-gateway-name:s! amazon-side-asn:i', 'Crea una puerta de Direct Connect: conecta un enlace dedicado con varias VPC o Transit Gateway de cualquier región.', { res: () => '*' }, (c) => {
  const id = md5Hex(c.acct.id + c.p.DirectConnectGatewayName).slice(0, 8) + '-0000-4000-8000-' + md5Hex(c.p.DirectConnectGatewayName).slice(0, 12);
  dxState(c.acct).gws[id] = { directConnectGatewayId: id, directConnectGatewayName: c.p.DirectConnectGatewayName, amazonSideAsn: c.p.AmazonSideAsn ?? 64512 };
  return { directConnectGateway: { directConnectGatewayId: id, directConnectGatewayName: c.p.DirectConnectGatewayName, amazonSideAsn: c.p.AmazonSideAsn ?? 64512, ownerAccount: c.acct.id, directConnectGatewayState: 'available' } };
});

op('directconnect', 'describe-direct-connect-gateways', '', 'Lista las puertas de Direct Connect.', { res: () => '*' }, (c) => ({ directConnectGateways: Object.values(dxState(c.acct).gws).map((g) => ({ ...g, ownerAccount: c.acct.id, directConnectGatewayState: 'available' })) }));
