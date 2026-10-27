/** Interfaces de red (una por instancia y una por subred de cada endpoint de interfaz) y perfiles de instancia asociados a instancias. */
import { eniOfInstance } from '../netpath';
import { AwsError, op, type OpCtx } from '../registry';
import type { Ec2Instance } from '../types';
import { stableId } from '../util';
import { filterOk, parseProfile, refreshEc2, tagGetter } from './ec2';

const arn = (c: OpCtx, id = '*') => `arn:aws:ec2:${c.region}:${c.acct.id}:instance/${id}`;
const assocId = (i: Ec2Instance) => stableId(`iipa:${i.InstanceId}:${i.IamInstanceProfile ?? ''}`, 'iip-assoc-', 17);

const assocView = (c: OpCtx, i: Ec2Instance) => ({
  AssociationId: assocId(i),
  InstanceId: i.InstanceId,
  IamInstanceProfile: { Arn: `arn:aws:iam::${c.acct.id}:instance-profile/${i.IamInstanceProfile}`, Id: c.acct.iam.instanceProfiles[i.IamInstanceProfile ?? '']?.InstanceProfileId ?? '' },
  State: 'associated',
});

const findInst = (c: OpCtx, id: string): Ec2Instance => {
  const i = refreshEc2(c.acct, c.region).instances[id];
  if (!i || i.state === 'terminated') throw new AwsError('InvalidInstanceID.NotFound', `The instance ID '${id}' does not exist`, 400);
  return i;
};

op('ec2', 'associate-iam-instance-profile', 'instance-id:s! iam-instance-profile:j!', 'Asocia un perfil de instancia (un rol) a una instancia que ya existe.', { res: (c) => arn(c, c.p.InstanceId), authz: (c) => {
  const n = parseProfile(c.p.IamInstanceProfile);
  const role = n ? c.acct.iam.instanceProfiles[n]?.roles[0] : undefined;
  return [{ action: 'ec2:AssociateIamInstanceProfile', resource: arn(c, c.p.InstanceId) }, ...(role ? [{ action: 'iam:PassRole', resource: `arn:aws:iam::${c.acct.id}:role/${role}`, context: { 'iam:PassedToService': 'ec2.amazonaws.com' } }] : [])];
} }, (c) => {
  const i = findInst(c, c.p.InstanceId);
  const n = parseProfile(c.p.IamInstanceProfile);
  if (!n || !c.acct.iam.instanceProfiles[n]) throw new AwsError('InvalidParameterValue', `Value (${n ?? ''}) for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name`, 400);
  if (i.IamInstanceProfile) throw new AwsError('IncorrectState', `There is an existing association for instance ${i.InstanceId}. Use replace-iam-instance-profile-association or disassociate it first.`, 400);
  i.IamInstanceProfile = n;
  return { IamInstanceProfileAssociation: { ...assocView(c, i), State: 'associating' } };
});

op('ec2', 'describe-iam-instance-profile-associations', 'association-ids:l filters:f', 'Qué perfil tiene cada instancia.', { paginate: 'IamInstanceProfileAssociations' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { IamInstanceProfileAssociations: Object.values(r.instances).filter((i) => i.IamInstanceProfile && i.state !== 'terminated' && (!c.p.AssociationIds || c.p.AssociationIds.includes(assocId(i))) && filterOk(c.p.Filters, (n) => (n === 'instance-id' ? [i.InstanceId] : n === 'state' ? ['associated'] : undefined))).map((i) => assocView(c, i)) };
});

op('ec2', 'disassociate-iam-instance-profile', 'association-id:s!', 'Quita el perfil de una instancia.', { res: () => '*' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const i = Object.values(r.instances).find((x) => x.IamInstanceProfile && assocId(x) === c.p.AssociationId);
  if (!i) throw new AwsError('InvalidAssociationID.NotFound', `The association ID '${c.p.AssociationId}' does not exist`, 400);
  const view = { ...assocView(c, i), State: 'disassociating' };
  i.IamInstanceProfile = undefined;
  return { IamInstanceProfileAssociation: view };
});

op('ec2', 'replace-iam-instance-profile-association', 'association-id:s! iam-instance-profile:j!', 'Cambia el perfil de una instancia por otro.', { res: () => '*' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const i = Object.values(r.instances).find((x) => x.IamInstanceProfile && assocId(x) === c.p.AssociationId);
  if (!i) throw new AwsError('InvalidAssociationID.NotFound', `The association ID '${c.p.AssociationId}' does not exist`, 400);
  const n = parseProfile(c.p.IamInstanceProfile);
  if (!n || !c.acct.iam.instanceProfiles[n]) throw new AwsError('InvalidParameterValue', `Value (${n ?? ''}) for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name`, 400);
  i.IamInstanceProfile = n;
  return { IamInstanceProfileAssociation: { ...assocView(c, i), State: 'associating' } };
});

// ───────────────────────── interfaces de red ─────────────────────────

op('ec2', 'describe-network-interfaces', 'network-interface-ids:l filters:f dry-run:b', 'Lista las interfaces de red (la de cada instancia y las de los endpoints de interfaz).', { dryRun: true, paginate: 'NetworkInterfaces' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const list: Record<string, unknown>[] = [];
  const sgs = (ids: string[]) => ids.map((id) => ({ GroupId: id, GroupName: r.securityGroups[id]?.GroupName ?? '' }));
  for (const i of Object.values(r.instances)) {
    if (i.state === 'terminated' || i.state === 'stopped') continue;
    const id = eniOfInstance(i);
    list.push({ NetworkInterfaceId: id, Description: '', InterfaceType: 'interface', Status: 'in-use', VpcId: i.VpcId, SubnetId: i.SubnetId, AvailabilityZone: i.AvailabilityZone, OwnerId: c.acct.id, PrivateIpAddress: i.PrivateIpAddress, PrivateIpAddresses: [{ Primary: true, PrivateIpAddress: i.PrivateIpAddress }], Groups: sgs(i.SecurityGroupIds), Attachment: { InstanceId: i.InstanceId, DeviceIndex: 0, Status: 'attached' }, ...(i.PublicIpAddress ? { Association: { PublicIp: i.PublicIpAddress, IpOwnerId: 'amazon' } } : {}), SourceDestCheck: true, TagSet: [], _vpc: i.VpcId, _sub: i.SubnetId, _inst: i.InstanceId });
  }
  for (const e of Object.values(r.endpoints ?? {})) {
    if (e.State === 'deleted' || e.VpcEndpointType !== 'Interface') continue;
    for (const [sub, ip] of Object.entries(e.ips)) list.push({ NetworkInterfaceId: stableId(`eni:${e.VpcEndpointId}:${sub}`, 'eni-', 17), Description: `VPC Endpoint Interface ${e.VpcEndpointId}`, InterfaceType: 'vpc_endpoint', Status: 'in-use', VpcId: e.VpcId, SubnetId: sub, AvailabilityZone: r.subnets[sub]?.AvailabilityZone, OwnerId: c.acct.id, PrivateIpAddress: ip, PrivateIpAddresses: [{ Primary: true, PrivateIpAddress: ip }], Groups: sgs(e.SecurityGroupIds), SourceDestCheck: true, TagSet: [], _vpc: e.VpcId, _sub: sub });
  }
  const strip = (x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('_')));
  return {
    NetworkInterfaces: list
      .filter((x) => (!c.p.NetworkInterfaceIds || c.p.NetworkInterfaceIds.includes(x.NetworkInterfaceId)) && filterOk(c.p.Filters, (n) => (n === 'vpc-id' ? [x._vpc as string] : n === 'subnet-id' ? [x._sub as string] : n === 'attachment.instance-id' ? [x._inst as string] : n === 'network-interface-id' ? [x.NetworkInterfaceId as string] : n === 'description' ? [x.Description as string] : n === 'private-ip-address' ? [x.PrivateIpAddress as string] : tagGetter([])(n))))
      .map(strip),
  };
});
