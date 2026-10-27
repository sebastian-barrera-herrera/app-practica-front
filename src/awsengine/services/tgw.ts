/** AWS Transit Gateway: un concentrador central al que se conectan VPC y VPN, con tablas de rutas propias. */
import { regional } from '../account';
import { vpnRoutes } from '../onprem';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, Tag, Tgw, TgwAttachment, TgwRoute, TgwRouteTable, TgwState } from '../types';
import { cidrWithin, ec2Id, iso, mkArn, newId, parseCidr } from '../util';
import { filterOk, tagGetter, tagsFor } from './ec2';

const READY_MS = 60000;
const ATTACH_MS = 30000;

export const tgwState = (a: Account, region: string): TgwState => {
  const r = regional(a, region);
  return (r.tgw ??= { gateways: {}, attachments: {}, routeTables: {} });
};

const arn = (c: OpCtx, id = '*') => mkArn('ec2', c.region, c.acct.id, `transit-gateway/${id}`);

export const tgwStatus = (a: Account, g: Tgw): 'pending' | 'available' | 'deleted' => (g.deleted ? 'deleted' : a.clock - g.createdAt >= READY_MS ? 'available' : 'pending');
export const attachStatus = (a: Account, x: TgwAttachment): 'pending' | 'available' | 'deleted' => (x.deleted ? 'deleted' : a.clock - x.createdAt >= ATTACH_MS ? 'available' : 'pending');

const view = (c: OpCtx, g: Tgw) => ({
  TransitGatewayId: g.TransitGatewayId,
  TransitGatewayArn: arn(c, g.TransitGatewayId),
  State: tgwStatus(c.acct, g),
  OwnerId: c.acct.id,
  Description: g.Description,
  CreationTime: iso(g.createdAt),
  Options: { AmazonSideAsn: g.AmazonSideAsn, TransitGatewayCidrBlocks: [] as string[], AutoAcceptSharedAttachments: 'disable', DefaultRouteTableAssociation: g.DefaultRouteTableAssociation ? 'enable' : 'disable', AssociationDefaultRouteTableId: g.DefaultRouteTableAssociation ? g.DefaultRouteTableId : undefined, DefaultRouteTablePropagation: g.DefaultRouteTablePropagation ? 'enable' : 'disable', PropagationDefaultRouteTableId: g.DefaultRouteTablePropagation ? g.DefaultRouteTableId : undefined, VpnEcmpSupport: 'enable', DnsSupport: 'enable', MulticastSupport: 'disable' },
  Tags: g.Tags,
});

const find = (a: Account, region: string, id: string): Tgw => {
  const g = tgwState(a, region).gateways[id];
  if (!g || g.deleted) throw new AwsError('InvalidTransitGatewayID.NotFound', `Transit Gateway ${id} was not found`, 400);
  return g;
};

export function tgwCreate(a: Account, region: string, o: { description?: string; assoc?: boolean; prop?: boolean; ready?: boolean; tags?: Tag[] } = {}): Tgw {
  const s = tgwState(a, region);
  const id = ec2Id(a, 'tgw');
  const rtb = ec2Id(a, 'tgw-rtb').replace('tgw-rtb-', 'tgw-rtb-');
  const g: Tgw = { TransitGatewayId: id, Description: o.description ?? '', AmazonSideAsn: 64512, DefaultRouteTableId: rtb, DefaultRouteTableAssociation: o.assoc ?? true, DefaultRouteTablePropagation: o.prop ?? true, createdAt: o.ready ? a.clock - 600000 : a.clock, Tags: o.tags ?? [] };
  s.gateways[id] = g;
  s.routeTables[rtb] = { TransitGatewayRouteTableId: rtb, TransitGatewayId: id, Default: true, routes: [], associations: [], propagations: [], Tags: [] };
  return g;
}

export function tgwAttachVpc(a: Account, region: string, tgwId: string, vpcId: string, subnetIds: string[], o: { ready?: boolean; tags?: Tag[] } = {}): TgwAttachment {
  const s = tgwState(a, region);
  const g = s.gateways[tgwId];
  const id = ec2Id(a, 'tgw-attach');
  const att: TgwAttachment = { TransitGatewayAttachmentId: id, TransitGatewayId: tgwId, ResourceType: 'vpc', ResourceId: vpcId, SubnetIds: subnetIds, createdAt: o.ready ? a.clock - 600000 : a.clock, Tags: o.tags ?? [] };
  s.attachments[id] = att;
  const rt = s.routeTables[g.DefaultRouteTableId];
  if (g.DefaultRouteTableAssociation) rt.associations.push(id);
  if (g.DefaultRouteTablePropagation) {
    rt.propagations.push(id);
    syncPropagation(a, region);
  }
  return att;
}

/** Recalcula las rutas «propagadas» de cada tabla: el CIDR de cada VPC adjunta cuyo adjunto propaga a esa tabla. */
export function syncPropagation(a: Account, region: string): void {
  const s = tgwState(a, region);
  const r = regional(a, region).ec2;
  for (const rt of Object.values(s.routeTables)) {
    rt.routes = rt.routes.filter((x) => x.Type !== 'propagated');
    for (const attId of rt.propagations) {
      const att = s.attachments[attId];
      if (!att || att.deleted) continue;
      if (att.ResourceType === 'vpn') {
        const v = r.vpns?.[att.ResourceId];
        if (v && !v.deleted) for (const cidr of vpnRoutes(v)) rt.routes.push({ DestinationCidrBlock: cidr, Type: 'propagated', Blackhole: false, TransitGatewayAttachmentId: attId });
        continue;
      }
      const vpc = r.vpcs[att.ResourceId];
      if (vpc) for (const cidr of [vpc.CidrBlock, ...(vpc.ExtraCidrBlocks ?? [])]) rt.routes.push({ DestinationCidrBlock: cidr, Type: 'propagated', Blackhole: false, TransitGatewayAttachmentId: attId });
    }
  }
}

op('ec2', 'create-transit-gateway', 'description:s options:j tag-specifications:f dry-run:b', 'Crea un Transit Gateway: un «router» central al que conectas varias VPC y VPN.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const o = (c.p.Options ?? {}) as Record<string, string>;
  const g = tgwCreate(c.acct, c.region, { description: c.p.Description, assoc: o.DefaultRouteTableAssociation !== 'disable', prop: o.DefaultRouteTablePropagation !== 'disable', tags: tagsFor(c.p.TagSpecifications, 'transit-gateway') });
  return { TransitGateway: view(c, g) };
});

op('ec2', 'describe-transit-gateways', 'transit-gateway-ids:l filters:f dry-run:b', 'Lista los Transit Gateway.', { dryRun: true, paginate: 'TransitGateways' }, (c) => {
  for (const id of c.p.TransitGatewayIds ?? []) find(c.acct, c.region, id);
  return { TransitGateways: Object.values(tgwState(c.acct, c.region).gateways).filter((g) => !g.deleted && (!c.p.TransitGatewayIds || c.p.TransitGatewayIds.includes(g.TransitGatewayId)) && filterOk(c.p.Filters, (n) => (n === 'transit-gateway-id' ? [g.TransitGatewayId] : n === 'state' ? [tgwStatus(c.acct, g)] : tagGetter(g.Tags)(n)))).map((g) => view(c, g)) };
});

op('ec2', 'delete-transit-gateway', 'transit-gateway-id:s! dry-run:b', 'Borra un Transit Gateway (sin adjuntos).', { dryRun: true, res: (c) => arn(c, c.p.TransitGatewayId) }, (c) => {
  const g = find(c.acct, c.region, c.p.TransitGatewayId);
  const s = tgwState(c.acct, c.region);
  if (Object.values(s.attachments).some((x) => x.TransitGatewayId === g.TransitGatewayId && !x.deleted)) throw new AwsError('IncorrectState', `The transit gateway ${g.TransitGatewayId} has attachments. Delete them first.`, 400);
  g.deleted = true;
  for (const rt of Object.values(s.routeTables)) if (rt.TransitGatewayId === g.TransitGatewayId) delete s.routeTables[rt.TransitGatewayRouteTableId];
  return { TransitGateway: { ...view(c, g), State: 'deleting' } };
});

const attView = (c: OpCtx, x: TgwAttachment) => {
  const s = tgwState(c.acct, c.region);
  const assoc = Object.values(s.routeTables).find((rt) => rt.associations.includes(x.TransitGatewayAttachmentId));
  return { TransitGatewayAttachmentId: x.TransitGatewayAttachmentId, TransitGatewayId: x.TransitGatewayId, TransitGatewayOwnerId: c.acct.id, ResourceOwnerId: c.acct.id, ResourceType: x.ResourceType, ResourceId: x.ResourceId, State: attachStatus(c.acct, x), ...(assoc ? { Association: { TransitGatewayRouteTableId: assoc.TransitGatewayRouteTableId, State: 'associated' } } : {}), CreationTime: iso(x.createdAt), Tags: x.Tags };
};

op('ec2', 'create-transit-gateway-vpc-attachment', 'transit-gateway-id:s! vpc-id:s! subnet-ids:l! options:j tag-specifications:f dry-run:b', 'Conecta una VPC a un Transit Gateway (indica una subred por zona).', { dryRun: true, res: (c) => arn(c, c.p.TransitGatewayId) }, (c) => {
  const g = find(c.acct, c.region, c.p.TransitGatewayId);
  if (tgwStatus(c.acct, g) !== 'available') throw new AwsError('IncorrectState', `Transit gateway ${g.TransitGatewayId} is not available yet (state ${tgwStatus(c.acct, g)}). Wait a minute and try again.`, 400);
  const r = regional(c.acct, c.region).ec2;
  const vpc = r.vpcs[c.p.VpcId];
  if (!vpc) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`, 400);
  const subs: string[] = c.p.SubnetIds;
  for (const id of subs) {
    const sn = r.subnets[id];
    if (!sn) throw new AwsError('InvalidSubnetID.NotFound', `The subnet ID '${id}' does not exist`, 400);
    if (sn.VpcId !== vpc.VpcId) throw new AwsError('InvalidParameterValue', `Subnet ${id} does not belong to VPC ${vpc.VpcId}`, 400);
  }
  if (new Set(subs.map((id) => r.subnets[id].AvailabilityZone)).size < subs.length) throw new AwsError('DuplicateSubnetsInSameZone', 'You can specify only one subnet per Availability Zone.', 400);
  const s = tgwState(c.acct, c.region);
  if (Object.values(s.attachments).some((x) => !x.deleted && x.TransitGatewayId === g.TransitGatewayId && x.ResourceId === vpc.VpcId)) throw new AwsError('DuplicateTransitGatewayAttachment', `Transit gateway ${g.TransitGatewayId} already has an attachment for VPC ${vpc.VpcId}.`, 400);
  for (const other of Object.values(s.attachments)) {
    if (other.deleted || other.TransitGatewayId !== g.TransitGatewayId || other.ResourceType !== 'vpc') continue;
    const ov = r.vpcs[other.ResourceId];
    if (ov && cidrWithin(ov.CidrBlock, vpc.CidrBlock) || (ov && cidrWithin(vpc.CidrBlock, ov.CidrBlock))) throw new AwsError('InvalidParameterValue', `VPC ${vpc.VpcId} (${vpc.CidrBlock}) overlaps with ${ov.VpcId} (${ov.CidrBlock}) already attached to the transit gateway.`, 400);
  }
  const att = tgwAttachVpc(c.acct, c.region, g.TransitGatewayId, vpc.VpcId, subs, { tags: tagsFor(c.p.TagSpecifications, 'transit-gateway-attachment') });
  return { TransitGatewayVpcAttachment: { TransitGatewayAttachmentId: att.TransitGatewayAttachmentId, TransitGatewayId: att.TransitGatewayId, VpcId: att.ResourceId, VpcOwnerId: c.acct.id, State: 'pending', SubnetIds: att.SubnetIds, CreationTime: iso(att.createdAt), Options: { DnsSupport: 'enable', Ipv6Support: 'disable', ApplianceModeSupport: 'disable' }, Tags: att.Tags } };
});

const vpcAttView = (c: OpCtx, x: TgwAttachment) => ({ TransitGatewayAttachmentId: x.TransitGatewayAttachmentId, TransitGatewayId: x.TransitGatewayId, VpcId: x.ResourceId, VpcOwnerId: c.acct.id, State: attachStatus(c.acct, x), SubnetIds: x.SubnetIds, CreationTime: iso(x.createdAt), Options: { DnsSupport: 'enable', Ipv6Support: 'disable', ApplianceModeSupport: 'disable' }, Tags: x.Tags });

const attFilter = (c: OpCtx, x: TgwAttachment) => (n: string): string[] | undefined => (n === 'vpc-id' || n === 'resource-id' ? [x.ResourceId] : n === 'transit-gateway-id' ? [x.TransitGatewayId] : n === 'state' ? [attachStatus(c.acct, x)] : n === 'resource-type' ? [x.ResourceType] : n === 'transit-gateway-attachment-id' ? [x.TransitGatewayAttachmentId] : tagGetter(x.Tags)(n));

op('ec2', 'describe-transit-gateway-vpc-attachments', 'transit-gateway-attachment-ids:l filters:f dry-run:b', 'Lista las VPC conectadas a Transit Gateway.', { dryRun: true, paginate: 'TransitGatewayVpcAttachments' }, (c) => ({ TransitGatewayVpcAttachments: Object.values(tgwState(c.acct, c.region).attachments).filter((x) => !x.deleted && x.ResourceType === 'vpc' && (!c.p.TransitGatewayAttachmentIds || c.p.TransitGatewayAttachmentIds.includes(x.TransitGatewayAttachmentId)) && filterOk(c.p.Filters, attFilter(c, x))).map((x) => vpcAttView(c, x)) }));

op('ec2', 'describe-transit-gateway-attachments', 'transit-gateway-attachment-ids:l filters:f dry-run:b', 'Lista todos los adjuntos (VPC y VPN).', { dryRun: true, paginate: 'TransitGatewayAttachments' }, (c) => ({ TransitGatewayAttachments: Object.values(tgwState(c.acct, c.region).attachments).filter((x) => !x.deleted && (!c.p.TransitGatewayAttachmentIds || c.p.TransitGatewayAttachmentIds.includes(x.TransitGatewayAttachmentId)) && filterOk(c.p.Filters, attFilter(c, x))).map((x) => attView(c, x)) }));

op('ec2', 'delete-transit-gateway-vpc-attachment', 'transit-gateway-attachment-id:s! dry-run:b', 'Desconecta una VPC del Transit Gateway.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const s = tgwState(c.acct, c.region);
  const x = s.attachments[c.p.TransitGatewayAttachmentId];
  if (!x || x.deleted) throw new AwsError('InvalidTransitGatewayAttachmentID.NotFound', `Transit Gateway Attachment ${c.p.TransitGatewayAttachmentId} was not found`, 400);
  x.deleted = true;
  for (const rt of Object.values(s.routeTables)) {
    rt.associations = rt.associations.filter((i) => i !== x.TransitGatewayAttachmentId);
    rt.propagations = rt.propagations.filter((i) => i !== x.TransitGatewayAttachmentId);
    rt.routes = rt.routes.map((rr) => (rr.TransitGatewayAttachmentId === x.TransitGatewayAttachmentId && rr.Type === 'static' ? { ...rr, Blackhole: true } : rr));
  }
  syncPropagation(c.acct, c.region);
  return { TransitGatewayVpcAttachment: { ...vpcAttView(c, x), State: 'deleting' } };
});

// ───────────────────────── tablas de rutas del TGW ─────────────────────────

const rtView = (g: Tgw | undefined, rt: TgwRouteTable) => ({ TransitGatewayRouteTableId: rt.TransitGatewayRouteTableId, TransitGatewayId: rt.TransitGatewayId, State: 'available', DefaultAssociationRouteTable: rt.Default && !!g?.DefaultRouteTableAssociation, DefaultPropagationRouteTable: rt.Default && !!g?.DefaultRouteTablePropagation, CreationTime: iso(g?.createdAt ?? 0), Tags: rt.Tags });

const findRt = (a: Account, region: string, id: string): TgwRouteTable => {
  const rt = tgwState(a, region).routeTables[id];
  if (!rt) throw new AwsError('InvalidRouteTableID.NotFound', `The transit gateway route table '${id}' does not exist`, 400);
  return rt;
};

op('ec2', 'describe-transit-gateway-route-tables', 'transit-gateway-route-table-ids:l filters:f dry-run:b', 'Lista las tablas de rutas de los Transit Gateway.', { dryRun: true, paginate: 'TransitGatewayRouteTables' }, (c) => {
  const s = tgwState(c.acct, c.region);
  return { TransitGatewayRouteTables: Object.values(s.routeTables).filter((rt) => (!c.p.TransitGatewayRouteTableIds || c.p.TransitGatewayRouteTableIds.includes(rt.TransitGatewayRouteTableId)) && filterOk(c.p.Filters, (n) => (n === 'transit-gateway-id' ? [rt.TransitGatewayId] : n === 'default-association-route-table' ? [String(!!s.gateways[rt.TransitGatewayId]?.DefaultRouteTableAssociation && rt.Default)] : tagGetter(rt.Tags)(n)))).map((rt) => rtView(s.gateways[rt.TransitGatewayId], rt)) };
});

op('ec2', 'create-transit-gateway-route-table', 'transit-gateway-id:s! tag-specifications:f dry-run:b', 'Crea una tabla de rutas propia (para aislar redes: p. ej. producción y desarrollo).', { dryRun: true, res: (c) => arn(c, c.p.TransitGatewayId) }, (c) => {
  const g = find(c.acct, c.region, c.p.TransitGatewayId);
  const id = ec2Id(c.acct, 'tgw-rtb');
  const rt: TgwRouteTable = { TransitGatewayRouteTableId: id, TransitGatewayId: g.TransitGatewayId, Default: false, routes: [], associations: [], propagations: [], Tags: tagsFor(c.p.TagSpecifications, 'transit-gateway-route-table') };
  tgwState(c.acct, c.region).routeTables[id] = rt;
  return { TransitGatewayRouteTable: rtView(g, rt) };
});

op('ec2', 'associate-transit-gateway-route-table', 'transit-gateway-route-table-id:s! transit-gateway-attachment-id:s! dry-run:b', 'Asocia un adjunto a una tabla: el tráfico que entra por ese adjunto se enruta con esa tabla (solo una por adjunto).', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const s = tgwState(c.acct, c.region);
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const att = s.attachments[c.p.TransitGatewayAttachmentId];
  if (!att || att.deleted) throw new AwsError('InvalidTransitGatewayAttachmentID.NotFound', `Transit Gateway Attachment ${c.p.TransitGatewayAttachmentId} was not found`, 400);
  if (att.TransitGatewayId !== rt.TransitGatewayId) throw new AwsError('InvalidParameterValue', 'The attachment and the route table belong to different transit gateways.', 400);
  if (Object.values(s.routeTables).some((x) => x.associations.includes(att.TransitGatewayAttachmentId))) throw new AwsError('Resource.AlreadyAssociated', 'The attachment is already associated with a route table. Disassociate it first.', 400);
  rt.associations.push(att.TransitGatewayAttachmentId);
  return { Association: { TransitGatewayRouteTableId: rt.TransitGatewayRouteTableId, TransitGatewayAttachmentId: att.TransitGatewayAttachmentId, ResourceId: att.ResourceId, ResourceType: att.ResourceType, State: 'associating' } };
});

op('ec2', 'disassociate-transit-gateway-route-table', 'transit-gateway-route-table-id:s! transit-gateway-attachment-id:s! dry-run:b', 'Quita la asociación de un adjunto con una tabla.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const att = tgwState(c.acct, c.region).attachments[c.p.TransitGatewayAttachmentId];
  if (!rt.associations.includes(c.p.TransitGatewayAttachmentId)) throw new AwsError('InvalidAssociation.NotFound', 'That attachment is not associated with this route table.', 400);
  rt.associations = rt.associations.filter((x) => x !== c.p.TransitGatewayAttachmentId);
  return { Association: { TransitGatewayRouteTableId: rt.TransitGatewayRouteTableId, TransitGatewayAttachmentId: c.p.TransitGatewayAttachmentId, ResourceId: att?.ResourceId, ResourceType: att?.ResourceType, State: 'disassociating' } };
});

op('ec2', 'enable-transit-gateway-route-table-propagation', 'transit-gateway-route-table-id:s! transit-gateway-attachment-id:s! dry-run:b', 'Hace que un adjunto anuncie el CIDR de su VPC en una tabla.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const att = tgwState(c.acct, c.region).attachments[c.p.TransitGatewayAttachmentId];
  if (!att || att.deleted) throw new AwsError('InvalidTransitGatewayAttachmentID.NotFound', `Transit Gateway Attachment ${c.p.TransitGatewayAttachmentId} was not found`, 400);
  if (rt.propagations.includes(att.TransitGatewayAttachmentId)) throw new AwsError('TransitGatewayRouteTablePropagation.Duplicate', 'Propagation is already enabled for this attachment and route table.', 400);
  rt.propagations.push(att.TransitGatewayAttachmentId);
  syncPropagation(c.acct, c.region);
  return { Propagation: { TransitGatewayAttachmentId: att.TransitGatewayAttachmentId, ResourceId: att.ResourceId, ResourceType: att.ResourceType, TransitGatewayRouteTableId: rt.TransitGatewayRouteTableId, State: 'enabling' } };
});

op('ec2', 'disable-transit-gateway-route-table-propagation', 'transit-gateway-route-table-id:s! transit-gateway-attachment-id:s! dry-run:b', 'Deja de anunciar el CIDR de un adjunto en una tabla.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const att = tgwState(c.acct, c.region).attachments[c.p.TransitGatewayAttachmentId];
  rt.propagations = rt.propagations.filter((x) => x !== c.p.TransitGatewayAttachmentId);
  syncPropagation(c.acct, c.region);
  return { Propagation: { TransitGatewayAttachmentId: c.p.TransitGatewayAttachmentId, ResourceId: att?.ResourceId, ResourceType: att?.ResourceType, TransitGatewayRouteTableId: rt.TransitGatewayRouteTableId, State: 'disabling' } };
});

const routeView = (r: TgwRoute) => ({ DestinationCidrBlock: r.DestinationCidrBlock, ...(r.TransitGatewayAttachmentId && !r.Blackhole ? { TransitGatewayAttachments: [{ TransitGatewayAttachmentId: r.TransitGatewayAttachmentId }] } : {}), Type: r.Type, State: r.Blackhole ? 'blackhole' : 'active' });

op('ec2', 'create-transit-gateway-route', 'destination-cidr-block:s! transit-gateway-route-table-id:s! transit-gateway-attachment-id:s blackhole:b dry-run:b', 'Añade una ruta estática a una tabla del Transit Gateway (a un adjunto o «blackhole»).', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  if (!parseCidr(c.p.DestinationCidrBlock)) throw new AwsError('InvalidParameterValue', `Value (${c.p.DestinationCidrBlock}) for parameter destinationCidrBlock is invalid. This is not a valid CIDR block.`, 400);
  if (rt.routes.some((x) => x.DestinationCidrBlock === c.p.DestinationCidrBlock && x.Type === 'static')) throw new AwsError('TransitGatewayRouteAlreadyExists', `Route ${c.p.DestinationCidrBlock} already exists in ${rt.TransitGatewayRouteTableId}.`, 400);
  if (!c.p.Blackhole && !c.p.TransitGatewayAttachmentId) throw new AwsError('MissingParameter', 'Either --transit-gateway-attachment-id or --blackhole must be specified.', 400);
  const att = c.p.TransitGatewayAttachmentId ? tgwState(c.acct, c.region).attachments[c.p.TransitGatewayAttachmentId] : undefined;
  if (c.p.TransitGatewayAttachmentId && (!att || att.deleted)) throw new AwsError('InvalidTransitGatewayAttachmentID.NotFound', `Transit Gateway Attachment ${c.p.TransitGatewayAttachmentId} was not found`, 400);
  const route: TgwRoute = { DestinationCidrBlock: c.p.DestinationCidrBlock, Type: 'static', Blackhole: !!c.p.Blackhole, TransitGatewayAttachmentId: att?.TransitGatewayAttachmentId };
  rt.routes.push(route);
  return { Route: routeView(route) };
});

op('ec2', 'delete-transit-gateway-route', 'transit-gateway-route-table-id:s! destination-cidr-block:s! dry-run:b', 'Borra una ruta estática.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const i = rt.routes.findIndex((x) => x.DestinationCidrBlock === c.p.DestinationCidrBlock && x.Type === 'static');
  if (i < 0) throw new AwsError('InvalidRoute.NotFound', `The route ${c.p.DestinationCidrBlock} was not found in ${rt.TransitGatewayRouteTableId} (propagated routes cannot be deleted: disable the propagation).`, 400);
  const [r] = rt.routes.splice(i, 1);
  return { Route: routeView(r) };
});

op('ec2', 'search-transit-gateway-routes', 'transit-gateway-route-table-id:s! filters:f! max-results:i dry-run:b', 'Busca rutas de una tabla (por tipo, estado o destino).', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  const want = (name: string) => ((c.p.Filters ?? []) as { Name: string; Values: string[] }[]).find((f) => f.Name === name)?.Values;
  const routes = rt.routes.filter((x) => {
    const t = want('type');
    const st = want('state');
    return (!t || t.includes(x.Type)) && (!st || st.includes(x.Blackhole ? 'blackhole' : 'active'));
  });
  return { Routes: routes.map(routeView), AdditionalRoutesAvailable: false };
});

op('ec2', 'get-transit-gateway-route-table-associations', 'transit-gateway-route-table-id:s! filters:f max-results:i dry-run:b', 'Qué adjuntos usan una tabla para enrutar.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const s = tgwState(c.acct, c.region);
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  return { Associations: rt.associations.map((id) => ({ TransitGatewayAttachmentId: id, ResourceId: s.attachments[id]?.ResourceId, ResourceType: s.attachments[id]?.ResourceType, State: 'associated' })) };
});

op('ec2', 'get-transit-gateway-route-table-propagations', 'transit-gateway-route-table-id:s! filters:f max-results:i dry-run:b', 'Qué adjuntos anuncian su CIDR en una tabla.', { dryRun: true, res: (c) => arn(c) }, (c) => {
  const s = tgwState(c.acct, c.region);
  const rt = findRt(c.acct, c.region, c.p.TransitGatewayRouteTableId);
  return { TransitGatewayRouteTablePropagations: rt.propagations.map((id) => ({ TransitGatewayAttachmentId: id, ResourceId: s.attachments[id]?.ResourceId, ResourceType: s.attachments[id]?.ResourceType, State: 'enabled' })) };
});

void newId;
