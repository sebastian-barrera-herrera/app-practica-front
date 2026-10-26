/** Amazon EC2: instancias, imágenes, claves, grupos de seguridad, volúmenes, snapshots e IP elásticas. */
import { md5 } from '../../engine/commands/hash';
import { azName, regional } from '../account';
import { IMAGES, INSTANCE_TYPES, REGIONS, findImage, imageId, instanceType, isRegion, regionInfo } from '../catalog';
import { AwsError, op, type AuthzTarget, type OpCtx } from '../registry';
import type { Account, Ec2Address, Ec2Instance, Ec2Region, Ec2Snapshot, Ec2Volume, IpPermission, SecurityGroup, Subnet, Tag } from '../types';
import { cidrContainsIp, ec2Id, intToIp, iso, mergeTags, parseCidr, stableId, wildcard } from '../util';

// ───────────────────────── estados y relojes ─────────────────────────

const CODE: Record<Ec2Instance['state'], number> = { pending: 0, running: 16, 'shutting-down': 32, terminated: 48, stopping: 64, stopped: 80 };
const PENDING_MS = 10000;
const STOPPING_MS = 8000;
const SHUTDOWN_MS = 8000;

const stateView = (s: Ec2Instance['state']) => ({ Code: CODE[s], Name: s });

/** Hace avanzar los estados transitorios según el reloj virtual. */
export function refreshEc2(a: Account, region: string): Ec2Region {
  const r = regional(a, region).ec2;
  for (const i of Object.values(r.instances)) {
    const age = a.clock - i.stateAt;
    const next = i.state === 'pending' && age >= PENDING_MS ? 'running' : i.state === 'stopping' && age >= STOPPING_MS ? 'stopped' : i.state === 'shutting-down' && age >= SHUTDOWN_MS ? 'terminated' : null;
    if (next) {
      i.state = next;
      i.stateAt = a.clock;
    }
  }
  for (const n of Object.values(r.natGateways)) {
    const age = a.clock - n.stateAt;
    if (n.state === 'pending' && age >= PENDING_MS) {
      n.state = 'available';
      n.stateAt = a.clock;
    } else if (n.state === 'deleting' && age >= STOPPING_MS) {
      n.state = 'deleted';
      n.stateAt = a.clock;
    }
  }
  for (const v of Object.values(r.volumes)) if (v.state === 'creating' && a.clock - Date.parse(v.CreateTime) >= 2000) v.state = 'available';
  return r;
}

/** Deja asentadas todas las transiciones (para comprobar el estado final de un reto). */
export function settleEc2(a: Account): void {
  for (const reg of Object.keys(a.regions)) {
    a.clock += 120000;
    refreshEc2(a, reg);
  }
}

// ───────────────────────── nombres y direcciones ─────────────────────────

const DNS_SUFFIX = (region: string) => (region === 'us-east-1' ? 'ec2.internal' : `${region}.compute.internal`);
const PUB_SUFFIX = (region: string) => (region === 'us-east-1' ? 'compute-1.amazonaws.com' : `${region}.compute.amazonaws.com`);

export function publicIpFor(key: string): string {
  const h = md5(key);
  const o = (n: number) => (parseInt(h.slice(n * 2, n * 2 + 2), 16) % 200) + 20;
  return `${[3, 13, 18, 34, 35, 44, 52, 54][parseInt(h.slice(8, 10), 16) % 8]}.${o(1)}.${o(2)}.${o(3)}`;
}

const dashed = (ip: string) => ip.replace(/\./g, '-');

export function privateIpIn(r: Ec2Region, subnetId: string, seed: string): string {
  const sn = r.subnets[subnetId];
  const c = parseCidr(sn.CidrBlock)!;
  const used = new Set(Object.values(r.instances).map((i) => i.PrivateIpAddress));
  const size = 2 ** (32 - c.bits);
  let off = 4 + (parseInt(md5(seed).slice(0, 4), 16) % (size - 10));
  let ip = intToIp(c.base + off);
  while (used.has(ip)) {
    off++;
    ip = intToIp(c.base + off);
  }
  return ip;
}

// ───────────────────────── etiquetas y filtros ─────────────────────────

export type TagSpec = { ResourceType: string; Tags: Tag[] };

export function tagsFor(specs: TagSpec[] | undefined, type: string): Tag[] {
  return (specs ?? []).filter((s) => s.ResourceType === type).flatMap((s) => (Array.isArray(s.Tags) ? s.Tags : []));
}

export function filterOk(filters: { Name: string; Values: string[] }[] | undefined, get: (name: string) => string[] | undefined): boolean {
  for (const f of filters ?? []) {
    const vals = (Array.isArray(f.Values) ? f.Values : [f.Values]).map(String);
    let have: string[];
    if (f.Name.startsWith('tag:')) have = get(f.Name) ?? [];
    else if (f.Name === 'tag-key') have = get('tag-key') ?? [];
    else have = get(f.Name) ?? [];
    if (!have.some((h) => vals.some((v) => wildcard(v, h)))) return false;
  }
  return true;
}

export const tagGetter = (tags: Tag[]) => (name: string): string[] | undefined => {
  if (name.startsWith('tag:')) {
    const t = tags.find((x) => x.Key === name.slice(4));
    return t ? [t.Value] : [];
  }
  if (name === 'tag-key') return tags.map((t) => t.Key);
  if (name === 'tag-value') return tags.map((t) => t.Value);
  return undefined;
};

const NOT_FOUND = {
  instance: (id: string) => new AwsError('InvalidInstanceID.NotFound', `The instance ID '${id}' does not exist`, 400),
  sg: (id: string) => new AwsError('InvalidGroup.NotFound', `The security group '${id}' does not exist`, 400),
  vol: (id: string) => new AwsError('InvalidVolume.NotFound', `The volume '${id}' does not exist.`, 400),
  snap: (id: string) => new AwsError('InvalidSnapshot.NotFound', `The snapshot '${id}' does not exist.`, 400),
  key: (n: string) => new AwsError('InvalidKeyPair.NotFound', `The key pair '${n}' does not exist`, 400),
  subnet: (id: string) => new AwsError('InvalidSubnetID.NotFound', `The subnet ID '${id}' does not exist`, 400),
  alloc: (id: string) => new AwsError('InvalidAllocationID.NotFound', `The allocation ID '${id}' does not exist`, 400),
};

// ───────────────────────── vistas ─────────────────────────

function instanceView(a: Account, region: string, r: Ec2Region, i: Ec2Instance) {
  const it = instanceType(i.InstanceType);
  const publicDns = i.PublicIpAddress ? `ec2-${dashed(i.PublicIpAddress)}.${PUB_SUFFIX(region)}` : '';
  const sgs = i.SecurityGroupIds.map((id) => ({ GroupName: r.securityGroups[id]?.GroupName ?? '', GroupId: id }));
  const vol = r.volumes[i.rootVolumeId];
  const img = findImage(region, i.ImageId);
  const eni = stableId(`eni:${i.InstanceId}`, 'eni-', 17);
  const o: Record<string, unknown> = {
    AmiLaunchIndex: 0,
    ImageId: i.ImageId,
    InstanceId: i.InstanceId,
    InstanceType: i.InstanceType,
    ...(i.KeyName ? { KeyName: i.KeyName } : {}),
    LaunchTime: iso(Date.parse(i.LaunchTime)),
    Monitoring: { State: i.Monitoring },
    Placement: { AvailabilityZone: i.AvailabilityZone, GroupName: '', Tenancy: i.Tenancy },
    PrivateDnsName: `ip-${dashed(i.PrivateIpAddress)}.${DNS_SUFFIX(region)}`,
    PrivateIpAddress: i.PrivateIpAddress,
    ProductCodes: [],
    PublicDnsName: publicDns,
    ...(i.PublicIpAddress ? { PublicIpAddress: i.PublicIpAddress } : {}),
    State: stateView(i.state),
    StateTransitionReason: i.state === 'stopped' ? 'User initiated' : '',
    SubnetId: i.SubnetId,
    VpcId: i.VpcId,
    Architecture: it?.arch ?? 'x86_64',
    BlockDeviceMappings: vol?.attachment ? [{ DeviceName: vol.attachment.Device, Ebs: { AttachTime: vol.attachment.AttachTime, DeleteOnTermination: vol.attachment.DeleteOnTermination, Status: 'attached', VolumeId: vol.VolumeId } }] : [],
    ClientToken: stableId(`token:${i.InstanceId}`, '', 36),
    EbsOptimized: i.EbsOptimized,
    EnaSupport: true,
    Hypervisor: 'xen',
    ...(i.IamInstanceProfile ? { IamInstanceProfile: { Arn: `arn:aws:iam::${a.id}:instance-profile/${i.IamInstanceProfile}`, Id: a.iam.instanceProfiles[i.IamInstanceProfile]?.InstanceProfileId ?? '' } } : {}),
    NetworkInterfaces: [
      {
        Attachment: { AttachTime: i.LaunchTime, AttachmentId: stableId(`att:${i.InstanceId}`, 'eni-attach-', 17), DeleteOnTermination: true, DeviceIndex: 0, Status: 'attached', NetworkCardIndex: 0 },
        Description: '',
        Groups: sgs,
        Ipv6Addresses: [],
        MacAddress: '0a:' + md5(i.InstanceId).slice(0, 10).replace(/(..)(?=.)/g, '$1:'),
        NetworkInterfaceId: eni,
        OwnerId: a.id,
        PrivateDnsName: `ip-${dashed(i.PrivateIpAddress)}.${DNS_SUFFIX(region)}`,
        PrivateIpAddress: i.PrivateIpAddress,
        PrivateIpAddresses: [{ Primary: true, PrivateDnsName: `ip-${dashed(i.PrivateIpAddress)}.${DNS_SUFFIX(region)}`, PrivateIpAddress: i.PrivateIpAddress }],
        SourceDestCheck: true,
        Status: 'in-use',
        SubnetId: i.SubnetId,
        VpcId: i.VpcId,
        InterfaceType: 'interface',
      },
    ],
    RootDeviceName: img?.rootDevice ?? '/dev/xvda',
    RootDeviceType: 'ebs',
    SecurityGroups: sgs,
    SourceDestCheck: true,
    StateReason: i.state === 'stopped' ? { Code: 'Client.UserInitiatedShutdown', Message: 'Client.UserInitiatedShutdown: User initiated shutdown' } : i.state === 'terminated' ? { Code: 'Client.UserInitiatedShutdown', Message: 'Client.UserInitiatedShutdown: User initiated shutdown' } : i.state === 'pending' ? { Code: 'pending', Message: 'pending' } : undefined,
    Tags: i.Tags,
    VirtualizationType: 'hvm',
    CpuOptions: { CoreCount: Math.max(1, Math.floor((it?.vcpu ?? 2) / 2)), ThreadsPerCore: 2 },
    MetadataOptions: { State: 'applied', HttpTokens: img?.key.startsWith('al2023') ? 'required' : 'optional', HttpPutResponseHopLimit: 2, HttpEndpoint: 'enabled' },
    PlatformDetails: img?.platform === 'windows' ? 'Windows' : 'Linux/UNIX',
    UsageOperation: img?.platform === 'windows' ? 'RunInstances:0002' : 'RunInstances',
    ...(i.market === 'spot' ? { InstanceLifecycle: 'spot' } : {}),
  };
  if (o.StateReason === undefined) delete o.StateReason;
  return o;
}

const volumeView = (v: Ec2Volume) => ({
  Iops: v.Iops ?? (v.VolumeType === 'gp3' ? 3000 : v.VolumeType === 'gp2' ? Math.max(100, v.Size * 3) : undefined),
  VolumeType: v.VolumeType,
  MultiAttachEnabled: false,
  ...(v.VolumeType === 'gp3' ? { Throughput: 125 } : {}),
  VolumeId: v.VolumeId,
  Size: v.Size,
  SnapshotId: v.SnapshotId ?? '',
  AvailabilityZone: v.AvailabilityZone,
  State: v.state,
  CreateTime: v.CreateTime,
  Attachments: v.attachment ? [{ DeleteOnTermination: v.attachment.DeleteOnTermination, VolumeId: v.VolumeId, InstanceId: v.attachment.InstanceId, Device: v.attachment.Device, State: 'attached', AttachTime: v.attachment.AttachTime }] : [],
  Encrypted: v.Encrypted,
  Tags: v.Tags,
});

const snapView = (a: Account, s: Ec2Snapshot) => ({ Tags: s.Tags, StorageTier: 'standard', TransferType: undefined, OwnerId: a.id, SnapshotId: s.SnapshotId, VolumeId: s.VolumeId, State: 'completed', VolumeSize: s.VolumeSize, StartTime: s.StartTime, Progress: '100%', Description: s.Description, Encrypted: s.Encrypted });

function ruleView(sg: SecurityGroup, egress: boolean, p: IpPermission) {
  const out: Record<string, unknown>[] = [];
  const base = (extra: Record<string, unknown>) => ({
    SecurityGroupRuleId: stableId(`sgr:${sg.GroupId}:${egress}:${p.IpProtocol}:${p.FromPort}:${p.ToPort}:${JSON.stringify(extra)}`, 'sgr-', 17),
    GroupId: sg.GroupId,
    GroupOwnerId: '',
    IsEgress: egress,
    IpProtocol: p.IpProtocol,
    FromPort: p.FromPort ?? -1,
    ToPort: p.ToPort ?? -1,
    ...extra,
  });
  for (const r of p.IpRanges) out.push(base({ CidrIpv4: r.CidrIp, ...(r.Description ? { Description: r.Description } : {}) }));
  for (const r of p.Ipv6Ranges) out.push(base({ CidrIpv6: r.CidrIpv6 }));
  for (const g of p.UserIdGroupPairs) out.push(base({ ReferencedGroupInfo: { GroupId: g.GroupId, UserId: '' } }));
  return out;
}

const sgView = (a: Account, sg: SecurityGroup) => ({
  Description: sg.Description,
  GroupName: sg.GroupName,
  IpPermissions: sg.IpPermissions,
  OwnerId: a.id,
  GroupId: sg.GroupId,
  IpPermissionsEgress: sg.IpPermissionsEgress,
  VpcId: sg.VpcId,
  ...(sg.Tags.length ? { Tags: sg.Tags } : {}),
});

// ───────────────────────── recursos: creación directa (usada por escenarios) ─────────────────────────

export interface LaunchOpts {
  imageId?: string;
  imageKey?: string;
  type?: string;
  key?: string;
  sgIds?: string[];
  subnetId?: string;
  tags?: Tag[];
  userData?: string;
  profile?: string;
  size?: number;
  volumeType?: string;
  state?: 'running' | 'stopped';
  encrypted?: boolean;
}

export function ec2Launch(a: Account, region: string, o: LaunchOpts = {}): Ec2Instance {
  const r = regional(a, region).ec2;
  const subnets = Object.values(r.subnets);
  const sn = o.subnetId ? r.subnets[o.subnetId] : subnets[0];
  const defSg = Object.values(r.securityGroups).find((g) => g.GroupName === 'default' && g.VpcId === sn.VpcId)!;
  const id = ec2Id(a, 'i');
  const vid = ec2Id(a, 'vol');
  const imgKey = o.imageKey ?? 'al2023-x86';
  const ami = o.imageId ?? imageId(region, imgKey);
  const inst: Ec2Instance = {
    InstanceId: id,
    ImageId: ami,
    InstanceType: o.type ?? 't3.micro',
    KeyName: o.key,
    LaunchTime: iso(a.clock),
    AvailabilityZone: sn.AvailabilityZone,
    SubnetId: sn.SubnetId,
    VpcId: sn.VpcId,
    PrivateIpAddress: privateIpIn(r, sn.SubnetId, id),
    PublicIpAddress: sn.MapPublicIpOnLaunch ? publicIpFor(id + a.clock) : undefined,
    state: o.state === 'stopped' ? 'stopped' : 'running',
    SecurityGroupIds: o.sgIds?.length ? o.sgIds : [defSg.GroupId],
    Tags: o.tags ?? [],
    rootVolumeId: vid,
    UserData: o.userData,
    Monitoring: 'disabled',
    IamInstanceProfile: o.profile,
    Tenancy: 'default',
    market: 'on-demand',
    DisableApiTermination: false,
    EbsOptimized: false,
    stateAt: a.clock - 120000,
    ReservationId: ec2Id(a, 'r'),
  };
  if (inst.state === 'stopped') inst.PublicIpAddress = undefined;
  r.instances[id] = inst;
  r.volumes[vid] = {
    VolumeId: vid,
    Size: o.size ?? 8,
    VolumeType: o.volumeType ?? 'gp3',
    AvailabilityZone: sn.AvailabilityZone,
    CreateTime: iso(a.clock),
    state: 'in-use',
    Encrypted: o.encrypted ?? false,
    attachment: { InstanceId: id, Device: findImage(region, ami)?.rootDevice ?? '/dev/xvda', AttachTime: iso(a.clock), DeleteOnTermination: true },
    Tags: [],
  };
  return inst;
}

export function ec2CreateSg(a: Account, region: string, name: string, description: string, ingress: { proto: string; from?: number; to?: number; cidr: string }[] = [], vpcId?: string): SecurityGroup {
  const r = regional(a, region).ec2;
  const vpc = vpcId ? r.vpcs[vpcId] : Object.values(r.vpcs).find((v) => v.IsDefault)!;
  const id = ec2Id(a, 'sg');
  const sg: SecurityGroup = {
    GroupId: id,
    GroupName: name,
    Description: description,
    VpcId: vpc.VpcId,
    IpPermissions: ingress.map((x) => ({ IpProtocol: x.proto, FromPort: x.from, ToPort: x.to, IpRanges: [{ CidrIp: x.cidr }], Ipv6Ranges: [], UserIdGroupPairs: [] })),
    IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], UserIdGroupPairs: [] }],
    Tags: [],
  };
  r.securityGroups[id] = sg;
  return sg;
}

// ───────────────────────── regiones y catálogos ─────────────────────────

const REGION_CODE: Record<string, string> = { 'us-east-1': 'use1', 'us-east-2': 'use2', 'us-west-1': 'usw1', 'us-west-2': 'usw2', 'eu-west-1': 'euw1', 'eu-west-2': 'euw2', 'eu-west-3': 'euw3', 'eu-central-1': 'euc1', 'eu-north-1': 'eun1', 'eu-south-2': 'eus2', 'ca-central-1': 'cac1', 'sa-east-1': 'sae1', 'ap-south-1': 'aps1', 'ap-southeast-1': 'apse1', 'ap-southeast-2': 'apse2', 'ap-northeast-1': 'apne1', 'ap-northeast-2': 'apne2', 'af-south-1': 'afs1', 'ap-east-1': 'ape1' };

op('ec2', 'describe-regions', 'region-names:l filters:f all-regions:b dry-run:b', 'Regiones de AWS disponibles para tu cuenta.', { dryRun: true, global: true }, (c) => {
  const list = REGIONS.filter((r) => (c.p.AllRegions || !r.optIn) && (!c.p.RegionNames || c.p.RegionNames.includes(r.code)) && filterOk(c.p.Filters, (n) => (n === 'region-name' ? [r.code] : n === 'endpoint' ? [`ec2.${r.code}.amazonaws.com`] : undefined)));
  for (const n of c.p.RegionNames ?? []) if (!isRegion(n)) throw new AwsError('InvalidParameterValue', `Invalid region: ${n}`);
  return { Regions: list.map((r) => ({ OptInStatus: r.optIn ? 'not-opted-in' : 'opt-in-not-required', Endpoint: `ec2.${r.code}.amazonaws.com`, RegionName: r.code })) };
});

op('ec2', 'describe-availability-zones', 'zone-names:l zone-ids:l filters:f all-availability-zones:b dry-run:b', 'Zonas de disponibilidad de la región.', { dryRun: true }, (c) => {
  const info = regionInfo(c.region);
  if (!info) throw new AwsError('InvalidParameterValue', `Invalid region: ${c.region}`);
  const zones = info.azs.map((l, i) => ({ OptInStatus: 'opt-in-not-required', Messages: [], RegionName: c.region, ZoneName: `${c.region}${l}`, ZoneId: `${REGION_CODE[c.region] ?? 'xx1'}-az${i + 1}`, GroupName: c.region, NetworkBorderGroup: c.region, ZoneType: 'availability-zone', State: 'available' }));
  return { AvailabilityZones: zones.filter((z) => (!c.p.ZoneNames || c.p.ZoneNames.includes(z.ZoneName)) && (!c.p.ZoneIds || c.p.ZoneIds.includes(z.ZoneId)) && filterOk(c.p.Filters, (n) => (n === 'zone-name' ? [z.ZoneName] : n === 'state' ? [z.State] : n === 'region-name' ? [z.RegionName] : undefined))) };
});

op('ec2', 'describe-images', 'image-ids:l owners:l filters:f include-deprecated:b dry-run:b', 'Busca AMI (imágenes de máquina).', { dryRun: true, paginate: 'Images' }, (c) => {
  const imgs = IMAGES.filter((i) => {
    const owners = c.p.Owners as string[] | undefined;
    if (owners && !owners.some((o) => o === i.owner || (o === 'amazon' && i.ownerAlias === 'amazon') || (o === 'self' && false))) return false;
    const id = imageId(c.region, i.key);
    if (c.p.ImageIds && !c.p.ImageIds.includes(id)) return false;
    return filterOk(c.p.Filters, (n) => {
      switch (n) {
        case 'name': return [i.name];
        case 'architecture': return [i.arch];
        case 'image-id': return [id];
        case 'owner-alias': return i.ownerAlias ? [i.ownerAlias] : [];
        case 'platform': return i.platform ? [i.platform] : [];
        case 'state': return ['available'];
        case 'root-device-type': return ['ebs'];
        case 'virtualization-type': return ['hvm'];
        case 'description': return [i.description];
        default: return undefined;
      }
    });
  });
  for (const id of c.p.ImageIds ?? []) if (!findImage(c.region, id)) throw new AwsError('InvalidAMIID.NotFound', `The image id '[${id}]' does not exist`);
  return {
    Images: imgs
      .sort((x, y) => (x.created < y.created ? -1 : 1))
      .map((i) => ({
        Architecture: i.arch,
        CreationDate: i.created.replace('+00:00', '.000Z'),
        ImageId: imageId(c.region, i.key),
        ImageLocation: `${i.ownerAlias === 'amazon' ? 'amazon' : i.owner}/${i.name}`,
        ImageType: 'machine',
        Public: true,
        OwnerId: i.owner,
        PlatformDetails: i.platform === 'windows' ? 'Windows' : 'Linux/UNIX',
        UsageOperation: i.platform === 'windows' ? 'RunInstances:0002' : 'RunInstances',
        State: 'available',
        BlockDeviceMappings: [{ DeviceName: i.rootDevice, Ebs: { DeleteOnTermination: true, SnapshotId: stableId(`snap:${i.key}`, 'snap-', 17), VolumeSize: 8, VolumeType: 'gp3', Encrypted: false } }],
        Description: i.description,
        EnaSupport: true,
        Hypervisor: 'xen',
        Name: i.name,
        RootDeviceName: i.rootDevice,
        RootDeviceType: 'ebs',
        VirtualizationType: 'hvm',
      })),
  };
});

op('ec2', 'describe-instance-types', 'instance-types:l filters:f dry-run:b', 'Características de los tipos de instancia (vCPU, memoria, red…).', { dryRun: true, paginate: 'InstanceTypes' }, (c) => {
  for (const t of c.p.InstanceTypes ?? []) if (!instanceType(t)) throw new AwsError('InvalidInstanceType', `The following supplied instance types do not exist: [${t}]`);
  const list = INSTANCE_TYPES.filter((t) => (!c.p.InstanceTypes || c.p.InstanceTypes.includes(t.type)) && filterOk(c.p.Filters, (n) => {
    switch (n) {
      case 'instance-type': return [t.type];
      case 'vcpu-info.default-vcpus': return [String(t.vcpu)];
      case 'memory-info.size-in-mib': return [String(t.mem)];
      case 'processor-info.supported-architecture': return [t.arch];
      case 'burstable-performance-supported': return [String(!!t.burst)];
      case 'free-tier-eligible': return [String(!!t.freeTier)];
      case 'instance-storage-supported': return [String(!!t.store)];
      default: return undefined;
    }
  }));
  return {
    InstanceTypes: list.map((t) => ({
      InstanceType: t.type,
      CurrentGeneration: !t.type.startsWith('t2'),
      FreeTierEligible: !!t.freeTier,
      SupportedUsageClasses: ['on-demand', 'spot'],
      SupportedRootDeviceTypes: ['ebs'],
      BareMetal: false,
      Hypervisor: 'nitro',
      ProcessorInfo: { SupportedArchitectures: [t.arch], SustainedClockSpeedInGhz: 2.5 },
      VCpuInfo: { DefaultVCpus: t.vcpu, DefaultCores: Math.max(1, t.vcpu / 2), DefaultThreadsPerCore: 2 },
      MemoryInfo: { SizeInMiB: t.mem },
      InstanceStorageSupported: !!t.store,
      ...(t.store ? { InstanceStorageInfo: { TotalSizeInGB: t.store, Disks: [{ SizeInGB: t.store, Count: 1, Type: 'ssd' }] } } : {}),
      EbsInfo: { EbsOptimizedSupport: 'default' },
      NetworkInfo: { NetworkPerformance: t.net },
      ...(t.gpu ? { GpuInfo: { Gpus: [{ Name: 'GPU', Count: t.gpu }] } } : {}),
      BurstablePerformanceSupported: !!t.burst,
    })),
  };
});

op('ec2', 'describe-spot-price-history', 'instance-types:l product-descriptions:l availability-zone:s start-time:s', 'Precio actual del mercado Spot.', { paginate: 'SpotPriceHistory' }, (c) => {
  const info = regionInfo(c.region);
  const out: Record<string, unknown>[] = [];
  for (const t of INSTANCE_TYPES.filter((x) => !c.p.InstanceTypes || c.p.InstanceTypes.includes(x.type))) {
    (info?.azs ?? []).forEach((l, i) => {
      const az = `${c.region}${l}`;
      if (c.p.AvailabilityZone && c.p.AvailabilityZone !== az) return;
      const pct = 0.28 + (parseInt(md5(t.type + az).slice(0, 2), 16) % 30) / 100;
      out.push({ AvailabilityZone: az, InstanceType: t.type, ProductDescription: 'Linux/UNIX', SpotPrice: (t.price * pct).toFixed(6), Timestamp: iso(c.acct.clock - i * 60000) });
    });
  }
  return { SpotPriceHistory: out };
});

// ───────────────────────── pares de claves ─────────────────────────

function pem(name: string): string {
  const h = (n: number) => md5(`${name}:${n}`);
  const body = Array.from({ length: 12 }, (_, i) => (h(i) + h(i + 50)).replace(/[0-9a-f]/g, (ch, p) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(parseInt(ch, 16) * 4 + p) % 64]).slice(0, 64));
  return `-----BEGIN RSA PRIVATE KEY-----\n${body.join('\n')}\n-----END RSA PRIVATE KEY-----`;
}

const fingerprint = (name: string) => md5(name + ':fp').replace(/(..)(?=.)/g, '$1:');

/** Crea un par de claves en la región (la clave privada es siempre la misma para ese nombre). */
export function ec2CreateKey(a: Account, region: string, name: string): { KeyFingerprint: string; KeyMaterial: string; KeyName: string; KeyPairId: string } {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'key');
  r.keyPairs[name] = { KeyName: name, KeyPairId: id, KeyFingerprint: fingerprint(name), CreateTime: iso(a.clock), Tags: [] };
  return { KeyFingerprint: fingerprint(name), KeyMaterial: pem(name), KeyName: name, KeyPairId: id };
}

/** Crea un volumen EBS ya disponible (o conectado a una instancia). */
export function ec2CreateVolume(a: Account, region: string, o: { az: string; size: number; type?: string; tags?: Tag[]; attachTo?: { instanceId: string; device: string } }): Ec2Volume {
  const r = regional(a, region).ec2;
  const id = ec2Id(a, 'vol');
  const v: Ec2Volume = { VolumeId: id, Size: o.size, VolumeType: o.type ?? 'gp3', AvailabilityZone: o.az, CreateTime: iso(a.clock), state: o.attachTo ? 'in-use' : 'available', Encrypted: false, Tags: o.tags ?? [] };
  if (o.attachTo) v.attachment = { InstanceId: o.attachTo.instanceId, Device: o.attachTo.device, AttachTime: iso(a.clock), DeleteOnTermination: false };
  r.volumes[id] = v;
  return v;
}

op('ec2', 'create-key-pair', 'key-name:s! key-type:s key-format:s tag-specifications:f dry-run:b', 'Crea un par de claves: te devuelve la clave privada UNA sola vez.', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const n = c.p.KeyName as string;
  if (r.keyPairs[n]) throw new AwsError('InvalidKeyPair.Duplicate', `The keypair '${n}' already exists.`);
  const k = ec2CreateKey(c.acct, c.region, n);
  const created = refreshEc2(c.acct, c.region).keyPairs[n];
  created.Tags = tagsFor(c.p.TagSpecifications, 'key-pair');
  return k;
});
op('ec2', 'describe-key-pairs', 'key-names:l key-pair-ids:l filters:f include-public-key:b dry-run:b', 'Lista los pares de claves (solo la huella, nunca la privada).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const n of c.p.KeyNames ?? []) if (!r.keyPairs[n]) throw NOT_FOUND.key(n);
  return { KeyPairs: Object.values(r.keyPairs).filter((k) => (!c.p.KeyNames || c.p.KeyNames.includes(k.KeyName)) && filterOk(c.p.Filters, (n) => (n === 'key-name' ? [k.KeyName] : tagGetter(k.Tags)(n)))).map((k) => ({ KeyPairId: k.KeyPairId, KeyType: 'rsa', Tags: k.Tags, CreateTime: k.CreateTime, KeyName: k.KeyName, KeyFingerprint: k.KeyFingerprint })) };
});
op('ec2', 'delete-key-pair', 'key-name:s key-pair-id:s dry-run:b', 'Borra un par de claves (las instancias ya lanzadas siguen funcionando).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const name = c.p.KeyName ?? Object.values(r.keyPairs).find((k) => k.KeyPairId === c.p.KeyPairId)?.KeyName;
  if (name && r.keyPairs[name]) {
    delete r.keyPairs[name];
    return c.opts.output === 'json' ? { Return: true, KeyPairId: '' } : { Return: true };
  }
  return { Return: true };
});

// ───────────────────────── grupos de seguridad ─────────────────────────

function sgOf(r: Ec2Region, id: string): SecurityGroup {
  const g = r.securityGroups[id];
  if (!g) throw NOT_FOUND.sg(id);
  return g;
}

function parsePerms(c: OpCtx): IpPermission[] {
  const p = c.p;
  if (p.IpPermissions) {
    return (p.IpPermissions as any[]).map((x) => ({
      IpProtocol: String(x.IpProtocol),
      ...(x.FromPort !== undefined ? { FromPort: Number(x.FromPort) } : {}),
      ...(x.ToPort !== undefined ? { ToPort: Number(x.ToPort) } : {}),
      IpRanges: (x.IpRanges ?? []).map((r: any) => ({ CidrIp: r.CidrIp, ...(r.Description ? { Description: r.Description } : {}) })),
      Ipv6Ranges: (x.Ipv6Ranges ?? []).map((r: any) => ({ CidrIpv6: r.CidrIpv6 })),
      UserIdGroupPairs: (x.UserIdGroupPairs ?? []).map((g: any) => ({ GroupId: g.GroupId })),
    }));
  }
  const proto = String(p.Protocol ?? '-1').replace('all', '-1');
  let from: number | undefined;
  let to: number | undefined;
  if (p.Port !== undefined) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(String(p.Port));
    if (!m) throw new AwsError('InvalidParameterValue', `Invalid value '${p.Port}' for portRange.`);
    from = Number(m[1]);
    to = m[2] ? Number(m[2]) : from;
  } else if (proto === 'icmp') {
    from = -1;
    to = -1;
  }
  const perm: IpPermission = { IpProtocol: proto, ...(from !== undefined ? { FromPort: from, ToPort: to } : {}), IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [] };
  if (p.Cidr) perm.IpRanges.push({ CidrIp: p.Cidr });
  if (p.SourceGroup) perm.UserIdGroupPairs.push({ GroupId: p.SourceGroup });
  if (!perm.IpRanges.length && !perm.UserIdGroupPairs.length) throw new AwsError('MissingParameter', 'The request must contain the parameter CidrIp or SourceGroup');
  return [perm];
}

const samePerm = (a: IpPermission, b: IpPermission) => a.IpProtocol === b.IpProtocol && (a.FromPort ?? -1) === (b.FromPort ?? -1) && (a.ToPort ?? -1) === (b.ToPort ?? -1);

function describeRule(p: IpPermission, peer: string): string {
  const proto = p.IpProtocol === '-1' ? 'ALL' : p.IpProtocol.toUpperCase();
  return `peer: ${peer}, ${proto}, from port: ${p.FromPort ?? -1}, to port: ${p.ToPort ?? -1}, ALLOW`;
}

function addRule(c: OpCtx, egress: boolean) {
  const r = refreshEc2(c.acct, c.region);
  const sg = sgOf(r, c.p.GroupId);
  const perms = parsePerms(c);
  const list = egress ? sg.IpPermissionsEgress : sg.IpPermissions;
  const added: Record<string, unknown>[] = [];
  for (const np of perms) {
    for (const rg of np.IpRanges) if (!parseCidr(rg.CidrIp)) throw new AwsError('InvalidParameterValue', `Invalid CIDR address: ${rg.CidrIp}`);
    for (const rg of np.IpRanges) {
      const cur = list.find((x) => samePerm(x, np));
      if (cur?.IpRanges.some((x) => x.CidrIp === rg.CidrIp)) throw new AwsError('InvalidPermission.Duplicate', `the specified rule "${describeRule(np, rg.CidrIp)}" already exists`);
    }
    for (const gp of np.UserIdGroupPairs) {
      const cur = list.find((x) => samePerm(x, np));
      if (cur?.UserIdGroupPairs.some((x) => x.GroupId === gp.GroupId)) throw new AwsError('InvalidPermission.Duplicate', `the specified rule "${describeRule(np, gp.GroupId)}" already exists`);
      if (!r.securityGroups[gp.GroupId]) throw NOT_FOUND.sg(gp.GroupId);
    }
    let cur = list.find((x) => samePerm(x, np));
    if (!cur) {
      cur = { IpProtocol: np.IpProtocol, ...(np.FromPort !== undefined ? { FromPort: np.FromPort, ToPort: np.ToPort } : {}), IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [] };
      list.push(cur);
    }
    cur.IpRanges.push(...np.IpRanges);
    cur.Ipv6Ranges.push(...np.Ipv6Ranges);
    cur.UserIdGroupPairs.push(...np.UserIdGroupPairs);
    added.push(...ruleView(sg, egress, np).map((x) => ({ ...x, GroupOwnerId: c.acct.id })));
  }
  return { Return: true, SecurityGroupRules: added };
}

function removeRule(c: OpCtx, egress: boolean) {
  const r = refreshEc2(c.acct, c.region);
  const sg = sgOf(r, c.p.GroupId);
  const perms = parsePerms(c);
  const list = egress ? sg.IpPermissionsEgress : sg.IpPermissions;
  let hit = false;
  for (const np of perms) {
    const cur = list.find((x) => samePerm(x, np));
    if (!cur) continue;
    for (const rg of np.IpRanges) {
      const n = cur.IpRanges.length;
      cur.IpRanges = cur.IpRanges.filter((x) => x.CidrIp !== rg.CidrIp);
      if (cur.IpRanges.length !== n) hit = true;
    }
    for (const gp of np.UserIdGroupPairs) {
      const n = cur.UserIdGroupPairs.length;
      cur.UserIdGroupPairs = cur.UserIdGroupPairs.filter((x) => x.GroupId !== gp.GroupId);
      if (cur.UserIdGroupPairs.length !== n) hit = true;
    }
    if (!cur.IpRanges.length && !cur.Ipv6Ranges.length && !cur.UserIdGroupPairs.length) list.splice(list.indexOf(cur), 1);
  }
  if (!hit) throw new AwsError('InvalidPermission.NotFound', 'The specified rule does not exist in this security group.');
  return { Return: true };
}

const SG_RULE_PARAMS = 'group-id:s! protocol:s port:s cidr:s source-group:s ip-permissions:f dry-run:b';
const sgArn = (c: OpCtx) => `arn:aws:ec2:${c.region}:${c.acct.id}:security-group/${c.p.GroupId}`;

op('ec2', 'create-security-group', 'group-name:s! description:s! vpc-id:s tag-specifications:f dry-run:b', 'Crea un grupo de seguridad (un firewall virtual para instancias).', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}:${c.acct.id}:security-group/*` }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const vpc = c.p.VpcId ? r.vpcs[c.p.VpcId] : Object.values(r.vpcs).find((v) => v.IsDefault);
  if (!vpc) throw new AwsError('InvalidVpcID.NotFound', `The vpc ID '${c.p.VpcId}' does not exist`);
  const name = c.p.GroupName as string;
  if (name.startsWith('sg-')) throw new AwsError('InvalidParameterValue', 'Group names may not be in the format sg-*');
  if (Object.values(r.securityGroups).some((g) => g.GroupName === name && g.VpcId === vpc.VpcId)) throw new AwsError('InvalidGroup.Duplicate', `The security group '${name}' already exists for VPC '${vpc.VpcId}'`);
  const id = ec2Id(c.acct, 'sg');
  r.securityGroups[id] = { GroupId: id, GroupName: name, Description: c.p.Description, VpcId: vpc.VpcId, IpPermissions: [], IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], UserIdGroupPairs: [] }], Tags: tagsFor(c.p.TagSpecifications, 'security-group') };
  return { GroupId: id, ...(r.securityGroups[id].Tags.length ? { Tags: r.securityGroups[id].Tags } : {}) };
});
op('ec2', 'describe-security-groups', 'group-ids:l group-names:l filters:f dry-run:b', 'Lista los grupos de seguridad y sus reglas.', { dryRun: true, paginate: 'SecurityGroups' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.GroupIds ?? []) if (!r.securityGroups[id]) throw NOT_FOUND.sg(id);
  return {
    SecurityGroups: Object.values(r.securityGroups)
      .filter((g) => (!c.p.GroupIds || c.p.GroupIds.includes(g.GroupId)) && (!c.p.GroupNames || c.p.GroupNames.includes(g.GroupName)) && filterOk(c.p.Filters, (n) => {
        switch (n) {
          case 'group-name': return [g.GroupName];
          case 'group-id': return [g.GroupId];
          case 'vpc-id': return [g.VpcId];
          case 'description': return [g.Description];
          case 'ip-permission.cidr': return g.IpPermissions.flatMap((p) => p.IpRanges.map((x) => x.CidrIp));
          case 'ip-permission.from-port': return g.IpPermissions.map((p) => String(p.FromPort ?? -1));
          case 'ip-permission.to-port': return g.IpPermissions.map((p) => String(p.ToPort ?? -1));
          case 'ip-permission.protocol': return g.IpPermissions.map((p) => p.IpProtocol);
          default: return tagGetter(g.Tags)(n);
        }
      }))
      .map((g) => sgView(c.acct, g)),
  };
});
op('ec2', 'describe-security-group-rules', 'filters:f security-group-rule-ids:l dry-run:b', 'Reglas de los grupos de seguridad, una por línea.', { dryRun: true, paginate: 'SecurityGroupRules' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const rules = Object.values(r.securityGroups).flatMap((g) => [...g.IpPermissions.flatMap((p) => ruleView(g, false, p)), ...g.IpPermissionsEgress.flatMap((p) => ruleView(g, true, p))]);
  return { SecurityGroupRules: rules.filter((x: any) => filterOk(c.p.Filters, (n) => (n === 'group-id' ? [x.GroupId] : undefined))).map((x: any) => ({ ...x, GroupOwnerId: c.acct.id })) };
});
op('ec2', 'authorize-security-group-ingress', SG_RULE_PARAMS, 'Añade una regla de entrada a un grupo de seguridad.', { dryRun: true, res: sgArn }, (c) => addRule(c, false));
op('ec2', 'revoke-security-group-ingress', SG_RULE_PARAMS, 'Quita una regla de entrada.', { dryRun: true, res: sgArn }, (c) => removeRule(c, false));
op('ec2', 'authorize-security-group-egress', SG_RULE_PARAMS, 'Añade una regla de salida.', { dryRun: true, res: sgArn }, (c) => addRule(c, true));
op('ec2', 'revoke-security-group-egress', SG_RULE_PARAMS, 'Quita una regla de salida.', { dryRun: true, res: sgArn }, (c) => removeRule(c, true));
op('ec2', 'delete-security-group', 'group-id:s group-name:s dry-run:b', 'Borra un grupo de seguridad (no puede estar en uso).', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}:${c.acct.id}:security-group/${c.p.GroupId ?? '*'}` }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const sg = c.p.GroupId ? sgOf(r, c.p.GroupId) : Object.values(r.securityGroups).find((g) => g.GroupName === c.p.GroupName);
  if (!sg) throw NOT_FOUND.sg(c.p.GroupName ?? '');
  if (sg.GroupName === 'default') throw new AwsError('CannotDelete', `the specified group: "${sg.GroupId}" name: "default" cannot be deleted by a user`);
  if (Object.values(r.instances).some((i) => i.state !== 'terminated' && i.SecurityGroupIds.includes(sg.GroupId))) throw new AwsError('DependencyViolation', `resource ${sg.GroupId} has a dependent object`);
  if (Object.values(r.securityGroups).some((g) => g !== sg && [...g.IpPermissions, ...g.IpPermissionsEgress].some((p) => p.UserIdGroupPairs.some((x) => x.GroupId === sg.GroupId)))) throw new AwsError('DependencyViolation', `resource ${sg.GroupId} has a dependent object`);
  delete r.securityGroups[sg.GroupId];
  return {};
});

// ───────────────────────── VPC (solo lectura en esta fase) ─────────────────────────

op('ec2', 'describe-vpcs', 'vpc-ids:l filters:f dry-run:b', 'Lista las VPC (redes virtuales).', { dryRun: true, paginate: 'Vpcs' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return {
    Vpcs: Object.values(r.vpcs)
      .filter((v) => (!c.p.VpcIds || c.p.VpcIds.includes(v.VpcId)) && filterOk(c.p.Filters, (n) => (n === 'is-default' ? [String(v.IsDefault)] : n === 'vpc-id' ? [v.VpcId] : n === 'cidr' ? [v.CidrBlock] : tagGetter(v.Tags)(n))))
      .map((v) => ({ OwnerId: c.acct.id, InstanceTenancy: 'default', CidrBlockAssociationSet: [{ AssociationId: stableId(`vpcassoc:${v.VpcId}`, 'vpc-cidr-assoc-', 8), CidrBlock: v.CidrBlock, CidrBlockState: { State: 'associated' } }], IsDefault: v.IsDefault, Tags: v.Tags, VpcId: v.VpcId, State: 'available', CidrBlock: v.CidrBlock, DhcpOptionsId: 'dopt-' + stableId(`dopt:${c.region}`, '', 8) })),
  };
});

export function subnetView(a: Account, region: string, s: Subnet) {
  const cidr = parseCidr(s.CidrBlock)!;
  return { AvailabilityZoneId: `${REGION_CODE[region] ?? 'xx1'}-az${(regionInfo(region)?.azs.indexOf(s.AvailabilityZone.slice(-1)) ?? 0) + 1}`, MapCustomerOwnedIpOnLaunch: false, OwnerId: a.id, AssignIpv6AddressOnCreation: false, Ipv6CidrBlockAssociationSet: [], Tags: s.Tags, SubnetArn: `arn:aws:ec2:${region}:${a.id}:subnet/${s.SubnetId}`, EnableDns64: false, Ipv6Native: false, PrivateDnsNameOptionsOnLaunch: { HostnameType: 'ip-name', EnableResourceNameDnsARecord: false, EnableResourceNameDnsAAAARecord: false }, SubnetId: s.SubnetId, State: 'available', VpcId: s.VpcId, CidrBlock: s.CidrBlock, AvailableIpAddressCount: 2 ** (32 - cidr.bits) - 5, AvailabilityZone: s.AvailabilityZone, DefaultForAz: s.DefaultForAz, MapPublicIpOnLaunch: s.MapPublicIpOnLaunch };
}

op('ec2', 'describe-subnets', 'subnet-ids:l filters:f dry-run:b', 'Lista las subredes.', { dryRun: true, paginate: 'Subnets' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.SubnetIds ?? []) if (!r.subnets[id]) throw NOT_FOUND.subnet(id);
  return {
    Subnets: Object.values(r.subnets)
      .filter((s) => (!c.p.SubnetIds || c.p.SubnetIds.includes(s.SubnetId)) && filterOk(c.p.Filters, (n) => {
        switch (n) {
          case 'vpc-id': return [s.VpcId];
          case 'availability-zone': return [s.AvailabilityZone];
          case 'default-for-az': return [String(s.DefaultForAz)];
          case 'subnet-id': return [s.SubnetId];
          case 'cidr-block': case 'cidrBlock': return [s.CidrBlock];
          default: return tagGetter(s.Tags)(n);
        }
      }))
      .map((s) => subnetView(c.acct, c.region, s)),
  };
});

// ───────────────────────── instancias ─────────────────────────

const instArn = (c: OpCtx, id: string) => `arn:aws:ec2:${c.region}:${c.acct.id}:instance/${id}`;

function instFor(r: Ec2Region, id: string): Ec2Instance {
  const i = r.instances[id];
  if (!i) throw NOT_FOUND.instance(id);
  return i;
}

function iamPassRole(c: OpCtx, profile: string): AuthzTarget[] {
  const ip = c.acct.iam.instanceProfiles[profile];
  return ip?.roles.length ? [{ action: 'iam:PassRole', resource: `arn:aws:iam::${c.acct.id}:role/${ip.roles[0]}`, context: { 'iam:PassedToService': 'ec2.amazonaws.com' } }] : [];
}

function parseProfile(v: any): string | undefined {
  if (!v) return undefined;
  if (v.Name) return v.Name;
  if (v.Arn) return String(v.Arn).split('/').pop();
  return undefined;
}

op('ec2', 'run-instances', 'image-id:s! instance-type:s key-name:s security-group-ids:l security-groups:l subnet-id:s count:s user-data:s tag-specifications:f iam-instance-profile:j block-device-mappings:f associate-public-ip-address:b monitoring:j disable-api-termination:b instance-initiated-shutdown-behavior:s instance-market-options:j placement:j ebs-optimized:b dry-run:b client-token:s', 'Lanza una o más instancias EC2.', {
  dryRun: true,
  authz: (c) => {
    const t = c.p.InstanceType ?? 'm1.small';
    const ctx = { 'ec2:InstanceType': t, 'ec2:Region': c.region, 'ec2:Tenancy': 'default' };
    const reg = c.region;
    const acct = c.acct.id;
    const out: AuthzTarget[] = [
      { action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:instance/*`, context: { ...ctx, ...Object.fromEntries(tagsFor(c.p.TagSpecifications, 'instance').map((x) => [`aws:RequestTag/${x.Key}`, x.Value])) } },
      { action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}::image/${c.p.ImageId}`, context: ctx },
      { action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:network-interface/*`, context: ctx },
      { action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:volume/*`, context: ctx },
    ];
    for (const g of c.p.SecurityGroupIds ?? []) out.push({ action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:security-group/${g}`, context: ctx });
    if (c.p.SubnetId) out.push({ action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:subnet/${c.p.SubnetId}`, context: ctx });
    if (c.p.KeyName) out.push({ action: 'ec2:RunInstances', resource: `arn:aws:ec2:${reg}:${acct}:key-pair/${c.p.KeyName}`, context: ctx });
    const prof = parseProfile(c.p.IamInstanceProfile);
    if (prof) out.push(...iamPassRole(c, prof));
    if (c.p.TagSpecifications) out.push({ action: 'ec2:CreateTags', resource: `arn:aws:ec2:${reg}:${acct}:instance/*`, context: { 'ec2:CreateAction': 'RunInstances' } });
    return out;
  },
}, (c) => {
  const a = c.acct;
  const r = refreshEc2(a, c.region);
  const type = c.p.InstanceType ?? 'm1.small';
  const it = instanceType(type);
  if (!it) throw new AwsError('InvalidParameterValue', `Invalid value '${type}' for InstanceType.`);
  const img = findImage(c.region, c.p.ImageId);
  if (!img) throw new AwsError('InvalidAMIID.NotFound', `The image id '[${c.p.ImageId}]' does not exist`);
  if (img.arch !== it.arch) throw new AwsError('InvalidParameterValue', `The architecture '${it.arch}' of the specified instance type does not match the architecture '${img.arch}' of the specified AMI. Specify an instance type and an AMI that have matching architectures, or use the default instance type.`);
  if (c.p.KeyName && !r.keyPairs[c.p.KeyName]) throw NOT_FOUND.key(c.p.KeyName);
  let subnet = c.p.SubnetId ? r.subnets[c.p.SubnetId] : undefined;
  if (c.p.SubnetId && !subnet) throw NOT_FOUND.subnet(c.p.SubnetId);
  const az = c.p.Placement?.AvailabilityZone as string | undefined;
  if (!subnet) subnet = Object.values(r.subnets).find((s) => !az || s.AvailabilityZone === az) ?? Object.values(r.subnets)[0];
  let sgIds: string[] = c.p.SecurityGroupIds ?? [];
  if (c.p.SecurityGroups) sgIds = (c.p.SecurityGroups as string[]).map((n) => Object.values(r.securityGroups).find((g) => g.GroupName === n || g.GroupId === n)?.GroupId ?? (() => { throw NOT_FOUND.sg(n); })());
  for (const id of sgIds) {
    const g = r.securityGroups[id];
    if (!g) throw NOT_FOUND.sg(id);
    if (g.VpcId !== subnet.VpcId) throw new AwsError('InvalidParameter', 'Security group and subnet belong to different VPCs');
  }
  if (!sgIds.length) sgIds = [Object.values(r.securityGroups).find((g) => g.GroupName === 'default' && g.VpcId === subnet!.VpcId)!.GroupId];
  const profile = parseProfile(c.p.IamInstanceProfile);
  if (profile && !a.iam.instanceProfiles[profile]) throw new AwsError('InvalidParameterValue', `Value (${profile}) for parameter iamInstanceProfile.name is invalid. Invalid IAM Instance Profile name`);
  const cm = /^(\d+)(?::(\d+))?$/.exec(String(c.p.Count ?? '1'));
  if (!cm) throw new AwsError('InvalidParameterValue', `Invalid value '${c.p.Count}' for count`);
  const min = Number(cm[1]);
  const max = cm[2] ? Number(cm[2]) : min;
  if (min < 1) throw new AwsError('InvalidParameterValue', 'Value (0) for parameter MinCount is invalid. Min count must be greater than 0.');
  // límite de vCPU (cuenta nueva): 32 en la familia estándar
  const running = Object.values(r.instances).filter((i) => i.state !== 'terminated' && i.state !== 'shutting-down').reduce((n, i) => n + (instanceType(i.InstanceType)?.vcpu ?? 2), 0);
  const n = Math.max(min, Math.min(max, Math.floor((32 - running) / it.vcpu)));
  if (running + min * it.vcpu > 32) throw new AwsError('VcpuLimitExceeded', 'You have requested more vCPU capacity than your current vCPU limit of 32 allows for the instance bucket that the specified instance type belongs to. Please visit http://aws.amazon.com/contact-us/ec2-request to request an adjustment to this limit.');
  const tags = tagsFor(c.p.TagSpecifications, 'instance');
  const reservation = ec2Id(a, 'r');
  const bd = (c.p.BlockDeviceMappings ?? [])[0];
  const out: Ec2Instance[] = [];
  const noPublic = c.p.AssociatePublicIpAddress === false;
  const forcePublic = c.p.AssociatePublicIpAddress === true;
  for (let k = 0; k < n; k++) {
    const inst = ec2Launch(a, c.region, { imageId: c.p.ImageId, type, key: c.p.KeyName, sgIds, subnetId: subnet.SubnetId, tags, userData: c.p.UserData, profile, size: bd?.Ebs?.VolumeSize ? Number(bd.Ebs.VolumeSize) : 8, volumeType: bd?.Ebs?.VolumeType, encrypted: bd?.Ebs?.Encrypted === true || bd?.Ebs?.Encrypted === 'true' });
    inst.state = 'pending';
    inst.stateAt = a.clock;
    inst.ReservationId = reservation;
    if (noPublic) inst.PublicIpAddress = undefined;
    else if (forcePublic && !inst.PublicIpAddress) inst.PublicIpAddress = publicIpFor(inst.InstanceId + a.clock);
    inst.Monitoring = c.p.Monitoring?.Enabled === true || c.p.Monitoring?.Enabled === 'true' ? 'enabled' : 'disabled';
    inst.DisableApiTermination = !!c.p.DisableApiTermination;
    inst.EbsOptimized = !!c.p.EbsOptimized;
    if (c.p.InstanceMarketOptions?.MarketType === 'spot') inst.market = 'spot';
    r.volumes[inst.rootVolumeId].Tags = tagsFor(c.p.TagSpecifications, 'volume');
    out.push(inst);
  }
  // la respuesta de run-instances todavía no trae la IP pública (la instancia está arrancando)
  const views = out.map((i) => {
    const v = instanceView(a, c.region, r, i);
    delete v.PublicIpAddress;
    v.PublicDnsName = '';
    return v;
  });
  return { ReservationId: reservation, OwnerId: a.id, Groups: [], Instances: views };
});

op('ec2', 'describe-instances', 'instance-ids:l filters:f dry-run:b max-results:i', 'Lista las instancias (agrupadas en reservaciones).', { dryRun: true, paginate: 'Reservations', res: () => '*' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.InstanceIds ?? []) if (!r.instances[id]) throw NOT_FOUND.instance(id);
  const insts = Object.values(r.instances).filter((i) => (!c.p.InstanceIds || c.p.InstanceIds.includes(i.InstanceId)) && filterOk(c.p.Filters, (n) => {
    const sgs = i.SecurityGroupIds.map((id) => r.securityGroups[id]).filter(Boolean);
    switch (n) {
      case 'instance-state-name': return [i.state];
      case 'instance-state-code': return [String(CODE[i.state])];
      case 'instance-id': return [i.InstanceId];
      case 'instance-type': return [i.InstanceType];
      case 'image-id': return [i.ImageId];
      case 'availability-zone': return [i.AvailabilityZone];
      case 'subnet-id': return [i.SubnetId];
      case 'vpc-id': return [i.VpcId];
      case 'key-name': return i.KeyName ? [i.KeyName] : [];
      case 'private-ip-address': return [i.PrivateIpAddress];
      case 'ip-address': return i.PublicIpAddress ? [i.PublicIpAddress] : [];
      case 'instance.group-id': case 'group-id': return i.SecurityGroupIds;
      case 'instance.group-name': case 'group-name': return sgs.map((g) => g.GroupName);
      case 'instance-lifecycle': return [i.market === 'spot' ? 'spot' : 'normal'];
      case 'iam-instance-profile.arn': return i.IamInstanceProfile ? [`arn:aws:iam::${c.acct.id}:instance-profile/${i.IamInstanceProfile}`] : [];
      case 'monitoring-state': return [i.Monitoring];
      default: return tagGetter(i.Tags)(n);
    }
  }));
  const groups = new Map<string, Ec2Instance[]>();
  for (const i of insts) groups.set(i.ReservationId, [...(groups.get(i.ReservationId) ?? []), i]);
  return { Reservations: [...groups].map(([rid, l]) => ({ ReservationId: rid, OwnerId: c.acct.id, Groups: [], Instances: l.map((i) => instanceView(c.acct, c.region, r, i)) })) };
});

op('ec2', 'describe-instance-status', 'instance-ids:l filters:f include-all-instances:b dry-run:b', 'Estado y comprobaciones de estado de las instancias.', { dryRun: true, paginate: 'InstanceStatuses' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const list = Object.values(r.instances).filter((i) => (!c.p.InstanceIds || c.p.InstanceIds.includes(i.InstanceId)) && (c.p.IncludeAllInstances || i.state === 'running'));
  return {
    InstanceStatuses: list.map((i) => ({
      AvailabilityZone: i.AvailabilityZone,
      InstanceId: i.InstanceId,
      InstanceState: stateView(i.state),
      InstanceStatus: i.state === 'running' ? { Details: [{ Name: 'reachability', Status: a_ok(c, i) ? 'passed' : 'initializing' }], Status: a_ok(c, i) ? 'ok' : 'initializing' } : { Status: 'not-applicable' },
      SystemStatus: i.state === 'running' ? { Details: [{ Name: 'reachability', Status: a_ok(c, i) ? 'passed' : 'initializing' }], Status: a_ok(c, i) ? 'ok' : 'initializing' } : { Status: 'not-applicable' },
    })),
  };
});
const a_ok = (c: OpCtx, i: Ec2Instance) => c.acct.clock - i.stateAt >= 60000 || i.stateAt < Date.parse(i.LaunchTime) + 30000;

function transition(c: OpCtx, verb: 'start' | 'stop' | 'terminate' | 'reboot') {
  const a = c.acct;
  const r = refreshEc2(a, c.region);
  const out: any[] = [];
  for (const id of c.p.InstanceIds as string[]) {
    const i = instFor(r, id);
    const prev = stateView(i.state);
    if (verb === 'start') {
      if (i.state === 'running' || i.state === 'pending') {
        out.push({ InstanceId: id, CurrentState: stateView(i.state), PreviousState: prev });
        continue;
      }
      if (i.state !== 'stopped') throw new AwsError('IncorrectInstanceState', `The instance '${id}' is not in a state from which it can be started.`);
      i.state = 'pending';
      i.stateAt = a.clock;
      const sn = r.subnets[i.SubnetId];
      if (sn?.MapPublicIpOnLaunch) i.PublicIpAddress = Object.values(r.addresses).find((ad) => ad.InstanceId === id)?.PublicIp ?? publicIpFor(id + a.clock);
    } else if (verb === 'stop') {
      if (i.state === 'stopped' || i.state === 'stopping') {
        out.push({ InstanceId: id, CurrentState: stateView(i.state), PreviousState: prev });
        continue;
      }
      if (i.state !== 'running' && i.state !== 'pending') throw new AwsError('IncorrectInstanceState', `The instance '${id}' is not in a state from which it can be stopped.`);
      if (i.market === 'spot') throw new AwsError('UnsupportedOperation', 'You can\'t stop the Spot Instance \'' + id + '\' because it is associated with a one-time Spot Instance request.');
      i.state = 'stopping';
      i.stateAt = a.clock;
      if (!Object.values(r.addresses).some((ad) => ad.InstanceId === id)) i.PublicIpAddress = undefined;
    } else if (verb === 'terminate') {
      if (i.state === 'terminated' || i.state === 'shutting-down') {
        out.push({ InstanceId: id, CurrentState: stateView(i.state), PreviousState: prev });
        continue;
      }
      if (i.DisableApiTermination) throw new AwsError('OperationNotPermitted', `The instance '${id}' may not be terminated. Modify its 'disableApiTermination' instance attribute and try again.`);
      i.state = 'shutting-down';
      i.stateAt = a.clock;
      i.PublicIpAddress = undefined;
      const v = r.volumes[i.rootVolumeId];
      if (v?.attachment?.DeleteOnTermination) delete r.volumes[v.VolumeId];
      for (const vol of Object.values(r.volumes)) {
        if (vol.attachment?.InstanceId !== id) continue;
        vol.attachment = undefined;
        vol.state = 'available';
      }
      for (const ad of Object.values(r.addresses)) {
        if (ad.InstanceId !== id) continue;
        ad.InstanceId = undefined;
        ad.AssociationId = undefined;
      }
    } else {
      if (i.state !== 'running') throw new AwsError('IncorrectInstanceState', `The instance '${id}' is not in a state from which it can be rebooted.`);
      continue;
    }
    out.push({ InstanceId: id, CurrentState: stateView(i.state), PreviousState: prev });
  }
  return out;
}

const idsArn = (c: OpCtx) => (c.p.InstanceIds as string[]).map((id) => instArn(c, id));
const tagCtx = (c: OpCtx): Record<string, string> => {
  const r = regional(c.acct, c.region).ec2;
  const out: Record<string, string> = {};
  for (const id of (c.p.InstanceIds as string[] | undefined) ?? []) for (const t of r.instances[id]?.Tags ?? []) out[`ec2:ResourceTag/${t.Key}`] = t.Value;
  return out;
};

op('ec2', 'start-instances', 'instance-ids:l! dry-run:b', 'Arranca instancias paradas.', { dryRun: true, res: idsArn, ctx: tagCtx }, (c) => ({ StartingInstances: transition(c, 'start') }));
op('ec2', 'stop-instances', 'instance-ids:l! force:b hibernate:b dry-run:b', 'Para instancias (no pagas cómputo mientras están paradas).', { dryRun: true, res: idsArn, ctx: tagCtx }, (c) => ({ StoppingInstances: transition(c, 'stop') }));
op('ec2', 'terminate-instances', 'instance-ids:l! dry-run:b', 'Termina instancias: se borran para siempre.', { dryRun: true, res: idsArn, ctx: tagCtx }, (c) => ({ TerminatingInstances: transition(c, 'terminate') }));
op('ec2', 'reboot-instances', 'instance-ids:l! dry-run:b', 'Reinicia instancias.', { dryRun: true, res: idsArn, ctx: tagCtx }, (c) => (transition(c, 'reboot'), undefined));

op('ec2', 'modify-instance-attribute', 'instance-id:s! instance-type:j disable-api-termination:b groups:l user-data:j ebs-optimized:b source-dest-check:b dry-run:b', 'Cambia un atributo de una instancia (tipo, grupos, protección contra terminación…).', { dryRun: true, res: (c) => instArn(c, c.p.InstanceId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const i = instFor(r, c.p.InstanceId);
  if (c.p.InstanceType) {
    const t = c.p.InstanceType.Value ?? c.p.InstanceType;
    if (i.state !== 'stopped') throw new AwsError('IncorrectInstanceState', `The instance '${i.InstanceId}' is not in the 'stopped' state.`);
    const it = instanceType(String(t));
    if (!it) throw new AwsError('InvalidParameterValue', `Invalid value '${t}' for InstanceType. Instance type not supported.`);
    if (it.arch !== instanceType(i.InstanceType)?.arch) throw new AwsError('InvalidParameterCombination', 'The instance type is incompatible with the architecture of the current AMI.');
    i.InstanceType = String(t);
  }
  if (c.p.DisableApiTermination !== undefined) i.DisableApiTermination = !!c.p.DisableApiTermination;
  if (c.p.Groups) {
    for (const g of c.p.Groups) sgOf(r, g);
    i.SecurityGroupIds = c.p.Groups;
  }
  if (c.p.EbsOptimized !== undefined) i.EbsOptimized = !!c.p.EbsOptimized;
  return undefined;
});
op('ec2', 'describe-instance-attribute', 'instance-id:s! attribute:s!', 'Lee un atributo de una instancia.', { dryRun: true, res: (c) => instArn(c, c.p.InstanceId) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const i = instFor(r, c.p.InstanceId);
  switch (c.p.Attribute) {
    case 'instanceType': return { InstanceId: i.InstanceId, InstanceType: { Value: i.InstanceType } };
    case 'disableApiTermination': return { InstanceId: i.InstanceId, DisableApiTermination: { Value: i.DisableApiTermination } };
    case 'userData': return { InstanceId: i.InstanceId, UserData: i.UserData ? { Value: btoaSafe(i.UserData) } : {} };
    case 'groupSet': return { InstanceId: i.InstanceId, Groups: i.SecurityGroupIds.map((GroupId) => ({ GroupId })) };
    default: throw new AwsError('InvalidParameterValue', `Invalid value '${c.p.Attribute}' for attribute`);
  }
});
const btoaSafe = (s: string) => {
  const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = Array.from(unescape(encodeURIComponent(s))).map((ch) => ch.charCodeAt(0));
  let out = '';
  for (let k = 0; k < bytes.length; k += 3) {
    const n = (bytes[k] << 16) | ((bytes[k + 1] ?? 0) << 8) | (bytes[k + 2] ?? 0);
    out += B[(n >> 18) & 63] + B[(n >> 12) & 63] + (k + 1 < bytes.length ? B[(n >> 6) & 63] : '=') + (k + 2 < bytes.length ? B[n & 63] : '=');
  }
  return out;
};

// ───────────────────────── etiquetas ─────────────────────────

const taggedResource = (r: Ec2Region, id: string): { Tags: Tag[] } | undefined =>
  (r.instances[id] ?? r.volumes[id] ?? r.snapshots[id] ?? r.securityGroups[id] ?? r.vpcs[id] ?? r.subnets[id] ?? r.internetGateways[id] ?? r.routeTables[id] ?? r.natGateways[id] ?? r.networkAcls[id] ?? Object.values(r.addresses).find((x) => x.AllocationId === id) ?? Object.values(r.keyPairs).find((x) => x.KeyPairId === id)) as { Tags: Tag[] } | undefined;
const TAG_TYPES: [string, string][] = [['i-', 'instance'], ['vol-', 'volume'], ['snap-', 'snapshot'], ['sg-', 'security-group'], ['vpc-', 'vpc'], ['subnet-', 'subnet'], ['igw-', 'internet-gateway'], ['rtb-', 'route-table'], ['nat-', 'natgateway'], ['acl-', 'network-acl'], ['eipalloc-', 'elastic-ip']];
const tagType = (id: string) => TAG_TYPES.find(([p]) => id.startsWith(p))?.[1] ?? 'key-pair';

function taggable(r: Ec2Region, id: string): { Tags: Tag[]; type: string } | null {
  const hit = taggedResource(r, id);
  return hit ? { Tags: hit.Tags, type: tagType(id) } : null;
}
const setTags = (r: Ec2Region, id: string, fn: (t: Tag[]) => Tag[]) => {
  const hit = taggedResource(r, id)!;
  hit.Tags = fn(hit.Tags);
};

op('ec2', 'create-tags', 'resources:l! tags:t! dry-run:b', 'Pone etiquetas a recursos de EC2 (instancias, volúmenes, grupos…).', { dryRun: true, res: (c) => (c.p.Resources as string[]).map((id) => `arn:aws:ec2:${c.region}:${c.acct.id}:${tagType(id)}/${id}`) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.Resources as string[]) {
    if (!taggable(r, id)) throw new AwsError(id.startsWith('i-') ? 'InvalidInstanceID.NotFound' : 'InvalidID', `The ${id.startsWith('i-') ? 'instance ID' : 'ID'} '${id}' does not exist`);
    setTags(r, id, (t) => mergeTags(t, c.p.Tags));
  }
  return undefined;
});
op('ec2', 'delete-tags', 'resources:l! tags:t dry-run:b', 'Quita etiquetas de recursos.', { dryRun: true, res: (c) => (c.p.Resources as string[]).map((id) => `arn:aws:ec2:${c.region}:${c.acct.id}:resource/${id}`) }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.Resources as string[]) {
    if (!taggable(r, id)) throw new AwsError('InvalidID', `The ID '${id}' is not valid`);
    setTags(r, id, (cur) => (c.p.Tags ? cur.filter((t) => !(c.p.Tags as Tag[]).some((d) => d.Key === t.Key && (d.Value === undefined || d.Value === t.Value))) : []));
  }
  return undefined;
});
op('ec2', 'describe-tags', 'filters:f dry-run:b', 'Lista las etiquetas de todos los recursos.', { dryRun: true, paginate: 'Tags' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const ids = [...Object.keys(r.instances), ...Object.keys(r.volumes), ...Object.keys(r.snapshots), ...Object.keys(r.securityGroups), ...Object.keys(r.vpcs), ...Object.keys(r.subnets), ...Object.keys(r.internetGateways), ...Object.keys(r.routeTables), ...Object.keys(r.natGateways), ...Object.keys(r.networkAcls)];
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const t = taggable(r, id);
    for (const tg of t?.Tags ?? []) {
      const row = { Key: tg.Key, ResourceId: id, ResourceType: t!.type, Value: tg.Value };
      if (filterOk(c.p.Filters, (n) => (n === 'resource-id' ? [id] : n === 'key' ? [tg.Key] : n === 'value' ? [tg.Value] : n === 'resource-type' ? [t!.type] : undefined))) out.push(row);
    }
  }
  return { Tags: out };
});

// ───────────────────────── volúmenes y snapshots ─────────────────────────

const VOL_TYPES = ['gp2', 'gp3', 'io1', 'io2', 'st1', 'sc1', 'standard'];

op('ec2', 'create-volume', 'availability-zone:s! size:i volume-type:s iops:i encrypted:b snapshot-id:s tag-specifications:f dry-run:b', 'Crea un volumen EBS (un disco) en una zona de disponibilidad.', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}:${c.acct.id}:volume/*` }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const az = c.p.AvailabilityZone as string;
  if (!c.region || !az.startsWith(c.region)) throw new AwsError('InvalidParameterValue', `Value (${az}) for parameter availabilityZone is invalid. Subnets can currently only be created in the following availability zones: ${(regionInfo(c.region)?.azs ?? []).map((l) => c.region + l).join(', ')}.`);
  const snap = c.p.SnapshotId ? r.snapshots[c.p.SnapshotId] : undefined;
  if (c.p.SnapshotId && !snap) throw NOT_FOUND.snap(c.p.SnapshotId);
  const size = c.p.Size ?? snap?.VolumeSize;
  if (!size) throw new AwsError('MissingParameter', 'The request must contain the parameter size or snapshotId');
  const vt = c.p.VolumeType ?? 'gp3';
  if (!VOL_TYPES.includes(vt)) throw new AwsError('InvalidParameterValue', `Invalid value '${vt}' for VolumeType`);
  const lim: Record<string, [number, number]> = { gp2: [1, 16384], gp3: [1, 16384], io1: [4, 16384], io2: [4, 65536], st1: [125, 16384], sc1: [125, 16384], standard: [1, 1024] };
  if (size < lim[vt][0] || size > lim[vt][1]) throw new AwsError('InvalidParameterValue', `Volume of ${size}GiB is too ${size < lim[vt][0] ? 'small' : 'large'} for volume type ${vt}; the minimum is ${lim[vt][0]}GiB and the maximum is ${lim[vt][1]}GiB`);
  if ((vt === 'io1' || vt === 'io2') && !c.p.Iops) throw new AwsError('MissingParameter', 'The request must contain the parameter iops');
  const id = ec2Id(c.acct, 'vol');
  const v: Ec2Volume = { VolumeId: id, Size: size, VolumeType: vt, AvailabilityZone: az, CreateTime: iso(c.acct.clock), state: 'creating', Iops: c.p.Iops, Encrypted: !!c.p.Encrypted || !!snap?.Encrypted, SnapshotId: c.p.SnapshotId, Tags: tagsFor(c.p.TagSpecifications, 'volume') };
  r.volumes[id] = v;
  return { ...volumeView(v), State: 'creating' };
});
const volArn = (c: OpCtx) => `arn:aws:ec2:${c.region}:${c.acct.id}:volume/${c.p.VolumeId}`;
function volFor(r: Ec2Region, id: string): Ec2Volume {
  const v = r.volumes[id];
  if (!v) throw NOT_FOUND.vol(id);
  return v;
}
op('ec2', 'describe-volumes', 'volume-ids:l filters:f dry-run:b', 'Lista los volúmenes EBS.', { dryRun: true, paginate: 'Volumes' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.VolumeIds ?? []) volFor(r, id);
  return {
    Volumes: Object.values(r.volumes)
      .filter((v) => (!c.p.VolumeIds || c.p.VolumeIds.includes(v.VolumeId)) && filterOk(c.p.Filters, (n) => {
        switch (n) {
          case 'status': return [v.state];
          case 'volume-type': return [v.VolumeType];
          case 'size': return [String(v.Size)];
          case 'availability-zone': return [v.AvailabilityZone];
          case 'attachment.instance-id': return v.attachment ? [v.attachment.InstanceId] : [];
          case 'attachment.status': return v.attachment ? ['attached'] : [];
          case 'encrypted': return [String(v.Encrypted)];
          case 'volume-id': return [v.VolumeId];
          default: return tagGetter(v.Tags)(n);
        }
      }))
      .map(volumeView),
  };
});
op('ec2', 'attach-volume', 'volume-id:s! instance-id:s! device:s! dry-run:b', 'Conecta un volumen a una instancia (misma zona de disponibilidad).', { dryRun: true, res: volArn }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = volFor(r, c.p.VolumeId);
  const i = instFor(r, c.p.InstanceId);
  if (v.AvailabilityZone !== i.AvailabilityZone) throw new AwsError('InvalidVolume.ZoneMismatch', `The volume '${v.VolumeId}' is not in the same availability zone as instance '${i.InstanceId}'`);
  if (v.state === 'creating') throw new AwsError('IncorrectState', `Volume ${v.VolumeId} is not 'available'.`);
  if (v.attachment) throw new AwsError('VolumeInUse', `${v.VolumeId} is already attached to an instance`);
  if (i.state === 'terminated' || i.state === 'shutting-down') throw new AwsError('IncorrectState', `Instance '${i.InstanceId}' is not in a valid state for this operation.`);
  const dev = c.p.Device as string;
  if (!/^\/dev\/(sd[f-p]|xvd[b-z]|nvme\d.*)$/.test(dev) && !/^\/dev\/sd[a-z]$/.test(dev)) throw new AwsError('InvalidParameterValue', `Invalid value '${dev}' for unixDevice. Attachment point ${dev} is invalid`);
  if (Object.values(r.volumes).some((x) => x.attachment?.InstanceId === i.InstanceId && x.attachment.Device === dev)) throw new AwsError('InvalidParameterValue', `Invalid value '${dev}' for unixDevice. Attachment point ${dev} is already in use`);
  v.attachment = { InstanceId: i.InstanceId, Device: dev, AttachTime: iso(c.acct.clock), DeleteOnTermination: false };
  v.state = 'in-use';
  return { AttachTime: v.attachment.AttachTime, Device: dev, InstanceId: i.InstanceId, State: 'attaching', VolumeId: v.VolumeId };
});
op('ec2', 'detach-volume', 'volume-id:s! instance-id:s device:s force:b dry-run:b', 'Desconecta un volumen (desmóntalo antes en el sistema).', { dryRun: true, res: volArn }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = volFor(r, c.p.VolumeId);
  if (!v.attachment) throw new AwsError('IncorrectState', `Volume '${v.VolumeId}' is in the 'available' state.`);
  if (v.attachment.Device === instFor(r, v.attachment.InstanceId).rootVolumeId || r.instances[v.attachment.InstanceId]?.rootVolumeId === v.VolumeId) throw new AwsError('OperationNotPermitted', `Unable to detach root volume '${v.VolumeId}' from instance '${v.attachment.InstanceId}'.`);
  const a = v.attachment;
  v.attachment = undefined;
  v.state = 'available';
  return { AttachTime: a.AttachTime, Device: a.Device, InstanceId: a.InstanceId, State: 'detaching', VolumeId: v.VolumeId };
});
op('ec2', 'delete-volume', 'volume-id:s! dry-run:b', 'Borra un volumen (tiene que estar desconectado).', { dryRun: true, res: volArn }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = volFor(r, c.p.VolumeId);
  if (v.attachment) throw new AwsError('VolumeInUse', `Volume ${v.VolumeId} is currently attached to ${v.attachment.InstanceId}`);
  delete r.volumes[v.VolumeId];
  return undefined;
});
op('ec2', 'modify-volume', 'volume-id:s! size:i volume-type:s iops:i dry-run:b', 'Amplía un volumen o cambia su tipo sin pararlo.', { dryRun: true, res: volArn }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = volFor(r, c.p.VolumeId);
  const before = { Size: v.Size, VolumeType: v.VolumeType };
  if (c.p.Size !== undefined) {
    if (c.p.Size < v.Size) throw new AwsError('InvalidParameterValue', `Invalid value '${c.p.Size}' for size. New size cannot be smaller than existing size`);
    v.Size = c.p.Size;
  }
  if (c.p.VolumeType) {
    if (!VOL_TYPES.includes(c.p.VolumeType)) throw new AwsError('InvalidParameterValue', `Invalid value '${c.p.VolumeType}' for VolumeType`);
    v.VolumeType = c.p.VolumeType;
  }
  return { VolumeModification: { VolumeId: v.VolumeId, ModificationState: 'modifying', TargetSize: v.Size, TargetVolumeType: v.VolumeType, OriginalSize: before.Size, OriginalVolumeType: before.VolumeType, Progress: 0, StartTime: iso(c.acct.clock) } };
});
op('ec2', 'create-snapshot', 'volume-id:s! description:s tag-specifications:f dry-run:b', 'Hace una copia (snapshot) de un volumen, guardada en S3.', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}::snapshot/*` }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const v = volFor(r, c.p.VolumeId);
  const id = ec2Id(c.acct, 'snap');
  const s: Ec2Snapshot = { SnapshotId: id, VolumeId: v.VolumeId, VolumeSize: v.Size, StartTime: iso(c.acct.clock), Description: c.p.Description ?? '', Encrypted: v.Encrypted, Tags: tagsFor(c.p.TagSpecifications, 'snapshot') };
  r.snapshots[id] = s;
  return { ...snapView(c.acct, s), State: 'pending', Progress: '' };
});
op('ec2', 'describe-snapshots', 'snapshot-ids:l owner-ids:l filters:f dry-run:b', 'Lista los snapshots.', { dryRun: true, paginate: 'Snapshots' }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  for (const id of c.p.SnapshotIds ?? []) if (!r.snapshots[id]) throw NOT_FOUND.snap(id);
  return { Snapshots: Object.values(r.snapshots).filter((s) => (!c.p.SnapshotIds || c.p.SnapshotIds.includes(s.SnapshotId)) && filterOk(c.p.Filters, (n) => (n === 'volume-id' ? [s.VolumeId] : n === 'status' ? ['completed'] : n === 'description' ? [s.Description] : tagGetter(s.Tags)(n)))).map((s) => snapView(c.acct, s)) };
});
op('ec2', 'delete-snapshot', 'snapshot-id:s! dry-run:b', 'Borra un snapshot.', { dryRun: true, res: (c) => `arn:aws:ec2:${c.region}::snapshot/${c.p.SnapshotId}` }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  if (!r.snapshots[c.p.SnapshotId]) throw NOT_FOUND.snap(c.p.SnapshotId);
  delete r.snapshots[c.p.SnapshotId];
  return undefined;
});

// ───────────────────────── IP elásticas ─────────────────────────

op('ec2', 'allocate-address', 'domain:s tag-specifications:f dry-run:b', 'Reserva una IP elástica (se cobra si no está en uso).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const id = ec2Id(c.acct, 'eipalloc');
  const ip = publicIpFor(id + 'eip');
  r.addresses[id] = { AllocationId: id, PublicIp: ip, Tags: tagsFor(c.p.TagSpecifications, 'elastic-ip') };
  return { PublicIp: ip, AllocationId: id, PublicIpv4Pool: 'amazon', NetworkBorderGroup: c.region, Domain: 'vpc' };
});
const addrView = (c: OpCtx, a: Ec2Address) => ({ ...(a.InstanceId ? { InstanceId: a.InstanceId } : {}), PublicIp: a.PublicIp, AllocationId: a.AllocationId, ...(a.AssociationId ? { AssociationId: a.AssociationId } : {}), Domain: 'vpc', NetworkBorderGroup: c.region, ...(a.Tags.length ? { Tags: a.Tags } : {}) });
op('ec2', 'describe-addresses', 'allocation-ids:l public-ips:l filters:f dry-run:b', 'Lista las IP elásticas.', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  return { Addresses: Object.values(r.addresses).filter((a) => (!c.p.AllocationIds || c.p.AllocationIds.includes(a.AllocationId)) && (!c.p.PublicIps || c.p.PublicIps.includes(a.PublicIp))).map((a) => addrView(c, a)) };
});
op('ec2', 'associate-address', 'allocation-id:s! instance-id:s! dry-run:b', 'Asocia una IP elástica a una instancia.', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const ad = r.addresses[c.p.AllocationId];
  if (!ad) throw NOT_FOUND.alloc(c.p.AllocationId);
  const i = instFor(r, c.p.InstanceId);
  if (i.state === 'terminated' || i.state === 'shutting-down') throw new AwsError('IncorrectInstanceState', `The instance '${i.InstanceId}' is not in a valid state for this operation.`);
  for (const o of Object.values(r.addresses)) {
    if (o.InstanceId !== i.InstanceId || o === ad) continue;
    o.InstanceId = undefined;
    o.AssociationId = undefined;
  }
  ad.InstanceId = i.InstanceId;
  ad.AssociationId = ec2Id(c.acct, 'eipassoc');
  if (i.state !== 'stopped') i.PublicIpAddress = ad.PublicIp;
  return { AssociationId: ad.AssociationId };
});
op('ec2', 'disassociate-address', 'association-id:s! dry-run:b', 'Desasocia una IP elástica.', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const ad = Object.values(r.addresses).find((x) => x.AssociationId === c.p.AssociationId);
  if (!ad) throw new AwsError('InvalidAssociationID.NotFound', `The association ID '${c.p.AssociationId}' does not exist`);
  const i = ad.InstanceId ? r.instances[ad.InstanceId] : undefined;
  if (i) i.PublicIpAddress = undefined;
  ad.InstanceId = undefined;
  ad.AssociationId = undefined;
  return undefined;
});
op('ec2', 'release-address', 'allocation-id:s! dry-run:b', 'Devuelve una IP elástica a AWS (si no la sueltas, pagas por ella).', { dryRun: true }, (c) => {
  const r = refreshEc2(c.acct, c.region);
  const ad = r.addresses[c.p.AllocationId];
  if (!ad) throw NOT_FOUND.alloc(c.p.AllocationId);
  if (ad.AssociationId) throw new AwsError('InvalidIPAddress.InUse', `The address '${ad.PublicIp}' is in use.`);
  delete r.addresses[ad.AllocationId];
  return undefined;
});

// ───────────────────────── wait ─────────────────────────

const WAITERS: Record<string, (c: OpCtx) => boolean> = {
  'instance-running': (c) => (c.p.InstanceIds as string[]).every((id) => regional(c.acct, c.region).ec2.instances[id]?.state === 'running'),
  'instance-stopped': (c) => (c.p.InstanceIds as string[]).every((id) => regional(c.acct, c.region).ec2.instances[id]?.state === 'stopped'),
  'instance-terminated': (c) => (c.p.InstanceIds as string[]).every((id) => regional(c.acct, c.region).ec2.instances[id]?.state === 'terminated'),
  'instance-exists': (c) => (c.p.InstanceIds as string[]).every((id) => !!regional(c.acct, c.region).ec2.instances[id]),
  'instance-status-ok': (c) => (c.p.InstanceIds as string[]).every((id) => regional(c.acct, c.region).ec2.instances[id]?.state === 'running'),
  'volume-available': (c) => (c.p.VolumeIds as string[]).every((id) => regional(c.acct, c.region).ec2.volumes[id]?.state === 'available'),
  'volume-in-use': (c) => (c.p.VolumeIds as string[]).every((id) => regional(c.acct, c.region).ec2.volumes[id]?.state === 'in-use'),
  'snapshot-completed': () => true,
  'nat-gateway-available': (c) => ((c.p.NatGatewayIds as string[]) ?? []).every((id) => regional(c.acct, c.region).ec2.natGateways[id]?.state === 'available'),
};

op('ec2', 'wait', 'waiter:s! instance-ids:l volume-ids:l snapshot-ids:l nat-gateway-ids:l filters:f dry-run:b', 'Espera a que se cumpla una condición (instance-running, instance-stopped, volume-available, nat-gateway-available…).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = WAITERS[c.p.Waiter];
  if (!w) throw new AwsError('InvalidWaiter', `Invalid choice: '${c.p.Waiter}', valid choices are: ${Object.keys(WAITERS).join(', ')}`);
  if (c.p.Waiter.startsWith('instance') && !c.p.InstanceIds) throw new AwsError('MissingParameter', 'The request must contain the parameter InstanceIds');
  for (let k = 0; k < 40; k++) {
    refreshEc2(c.acct, c.region);
    if (w(c)) return undefined;
    c.acct.clock += 15000;
  }
  throw new AwsError('WaiterError', `Waiter ${c.p.Waiter} failed: Max attempts exceeded`);
});

export { azName, cidrContainsIp };
