/** Creación de la cuenta simulada y acceso a sus regiones. */
import { AWS_POLICIES, awsPolicyArn, REGIONS, regionInfo } from './catalog';
import type { Account, Ec2Region, NaclEntry, RegionalState } from './types';
import { START_CLOCK, iso, stableId } from './util';

export const ACCOUNT_ID = '123456789012';

/** Cuenta vacía: solo el usuario root, las políticas de AWS y nada más. */
export function newAccount(o: { id?: string; seed?: number } = {}): Account {
  const acct: Account = {
    id: o.id ?? ACCOUNT_ID,
    seed: o.seed ?? 1,
    clock: START_CLOCK,
    sourceIp: '203.0.113.25',
    counters: {},
    iam: { users: {}, groups: {}, roles: {}, policies: {}, instanceProfiles: {}, mfaDevices: {}, aliases: [], rootMfa: false, rootKeys: [] },
    s3: { buckets: {}, taken: ['mi-bucket', 'test', 'backup', 'logs', 'datos', 'data', 'mybucket', 'prod', 'dev', 'images', 'fotos', 'web', 'website', 'assets', 'static'] },
    budgets: {},
    regions: {},
    sessions: {},
  };
  for (const p of AWS_POLICIES) {
    const arn = awsPolicyArn(p);
    acct.iam.policies[arn] = {
      PolicyName: p.name,
      PolicyId: stableId('policy:' + p.name, 'ANPA', 17, 'up'),
      Arn: arn,
      Path: p.path,
      aws: true,
      Description: p.description,
      CreateDate: '2015-02-06T18:39:46+00:00',
      document: p.document,
      DefaultVersionId: 'v1',
      versions: {},
    };
  }
  return acct;
}

/** Zona de disponibilidad: `eu-west-1` + índice 0 → `eu-west-1a`. */
export const azName = (region: string, i: number): string => `${region}${regionInfo(region)?.azs[i] ?? 'abcdef'[i]}`;

/** Entradas de una NACL por defecto: permite todo (y una regla final que deniega lo demás). */
export const defaultNaclEntries = (): NaclEntry[] => [
  { RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: false, CidrBlock: '0.0.0.0/0' },
  { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: false, CidrBlock: '0.0.0.0/0' },
  { RuleNumber: 100, Protocol: '-1', RuleAction: 'allow', Egress: true, CidrBlock: '0.0.0.0/0' },
  { RuleNumber: 32767, Protocol: '-1', RuleAction: 'deny', Egress: true, CidrBlock: '0.0.0.0/0' },
];

/** Red de la VPC por defecto: puerta de enlace a internet, tabla de rutas principal y NACL por defecto. */
function defaultNet(acct: Account, region: string, vpcId: string, subnetIds: string[], cidr: string): Pick<Ec2Region, 'internetGateways' | 'routeTables' | 'natGateways' | 'networkAcls'> {
  const igw = stableId(`igw:${acct.id}:${region}`, 'igw-', 17);
  const rtb = stableId(`rtb:${acct.id}:${region}`, 'rtb-', 17);
  const acl = stableId(`acl:${acct.id}:${region}`, 'acl-', 17);
  return {
    internetGateways: { [igw]: { InternetGatewayId: igw, VpcId: vpcId, Tags: [] } },
    routeTables: {
      [rtb]: {
        RouteTableId: rtb,
        VpcId: vpcId,
        routes: [
          { DestinationCidrBlock: cidr, target: 'local', Origin: 'CreateRouteTable' },
          { DestinationCidrBlock: '0.0.0.0/0', target: igw, Origin: 'CreateRoute' },
        ],
        associations: [{ RouteTableAssociationId: stableId(`rtbassoc:${rtb}`, 'rtbassoc-', 17), Main: true }],
        Tags: [],
      },
    },
    natGateways: {},
    networkAcls: { [acl]: { NetworkAclId: acl, VpcId: vpcId, IsDefault: true, Entries: defaultNaclEntries(), subnets: subnetIds, Tags: [] } },
  };
}

function newEc2Region(acct: Account, region: string): Ec2Region {
  const vpcId = stableId(`vpc:${acct.id}:${region}`, 'vpc-', 17);
  const sgId = stableId(`sg:${acct.id}:${region}`, 'sg-', 17);
  const info = regionInfo(region);
  const subnets: Ec2Region['subnets'] = {};
  (info?.azs ?? ['a', 'b', 'c']).forEach((_, i) => {
    const id = stableId(`subnet:${acct.id}:${region}:${i}`, 'subnet-', 17);
    subnets[id] = { SubnetId: id, VpcId: vpcId, CidrBlock: `172.31.${16 * i}.0/20`, AvailabilityZone: azName(region, i), MapPublicIpOnLaunch: true, DefaultForAz: true, Tags: [] };
  });
  const net = defaultNet(acct, region, vpcId, Object.keys(subnets), '172.31.0.0/16');
  return {
    ...net,
    vpcs: { [vpcId]: { VpcId: vpcId, CidrBlock: '172.31.0.0/16', IsDefault: true, Tags: [], EnableDnsSupport: true, EnableDnsHostnames: true } },
    subnets,
    instances: {},
    securityGroups: {
      [sgId]: {
        GroupId: sgId,
        GroupName: 'default',
        Description: 'default VPC security group',
        VpcId: vpcId,
        IpPermissions: [{ IpProtocol: '-1', IpRanges: [], Ipv6Ranges: [], UserIdGroupPairs: [{ GroupId: sgId }] }],
        IpPermissionsEgress: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }], Ipv6Ranges: [], UserIdGroupPairs: [] }],
        Tags: [],
      },
    },
    volumes: {},
    snapshots: {},
    addresses: {},
    keyPairs: {},
  };
}

/** Cuentas guardadas antes de que existiera la red: se les añade la de la VPC por defecto. */
function backfillNet(acct: Account, region: string, e: Ec2Region): void {
  if (e.routeTables) return;
  const vpc = Object.values(e.vpcs).find((v) => v.IsDefault);
  const net = vpc ? defaultNet(acct, region, vpc.VpcId, Object.values(e.subnets).filter((x) => x.VpcId === vpc.VpcId).map((x) => x.SubnetId), vpc.CidrBlock) : { internetGateways: {}, routeTables: {}, natGateways: {}, networkAcls: {} };
  Object.assign(e, net);
}

/** Estado de una región; se crea (con su VPC por defecto) la primera vez que se usa. */
export function regional(acct: Account, region: string): RegionalState {
  let r = acct.regions[region];
  if (!r) {
    r = acct.regions[region] = { ec2: newEc2Region(acct, region), alarms: {}, sns: {} };
  }
  backfillNet(acct, region, r.ec2);
  return r;
}

export { REGIONS, iso };
