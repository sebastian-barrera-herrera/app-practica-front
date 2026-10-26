/** Gobierno de la cuenta: Organizations, API de etiquetas, plan de soporte y Trusted Advisor. */
import { regional } from '../account';
import { instanceType } from '../catalog';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, OrgAccount, OrgPolicy, Organization, Tag } from '../types';
import { iso, mergeTags, newId, stableId } from '../util';
import { isPublicPolicy } from './s3';
import { PRICE, HOURS_MONTH } from '../pricing';

// ───────────────────────── Organizations ─────────────────────────

const orgArn = (a: Account, o: Organization, tail: string) => `arn:aws:organizations::${a.id}:${tail.startsWith('organization') ? tail.replace('organization/', `organization/${o.Id}`) : tail}`;
const noOrg = () => new AwsError('AWSOrganizationsNotInUseException', 'Your account is not a member of an organization.');

const orgOf = (a: Account): Organization => {
  if (!a.org) throw noOrg();
  return a.org;
};

const FULL_ACCESS: OrgPolicy = { Id: 'p-FullAWSAccess', Name: 'FullAWSAccess', Description: 'Allows access to every operation', Type: 'SERVICE_CONTROL_POLICY', Content: '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}', AwsManaged: true, targets: [] };

/** Crea la organización con la cuenta actual como administradora (también para escenarios). */
export function orgCreate(a: Account, featureSet: 'ALL' | 'CONSOLIDATED_BILLING' = 'ALL'): Organization {
  const id = newId(a, 'org', 'o-', 10, 'hex');
  const rootId = newId(a, 'orgroot', 'r-', 4, 'hex');
  const o: Organization = { Id: id, FeatureSet: featureSet, rootId, units: {}, accounts: {}, policies: { [FULL_ACCESS.Id]: { ...FULL_ACCESS, targets: [rootId] } }, policyTypes: featureSet === 'ALL' ? ['SERVICE_CONTROL_POLICY'] : [] };
  o.accounts[a.id] = { Id: a.id, Name: 'cuenta-principal', Email: 'admin@ejemplo.com', Status: 'ACTIVE', JoinedMethod: 'INVITED', JoinedTimestamp: iso(a.clock), ParentId: rootId };
  a.org = o;
  return o;
}

export function orgAddAccount(a: Account, name: string, email: string, parent?: string): OrgAccount {
  const o = orgOf(a);
  const id = String(100000000000 + (parseInt(stableId(`orgacct:${name}`, '', 7), 16) % 899999999999)).slice(0, 12);
  const acc: OrgAccount = { Id: id, Name: name, Email: email, Status: 'ACTIVE', JoinedMethod: 'CREATED', JoinedTimestamp: iso(a.clock), ParentId: parent ?? o.rootId };
  o.accounts[id] = acc;
  return acc;
}

const accountView = (a: Account, o: Organization, x: OrgAccount) => ({ Id: x.Id, Arn: `arn:aws:organizations::${a.id}:account/${o.Id}/${x.Id}`, Email: x.Email, Name: x.Name, Status: x.Status, JoinedMethod: x.JoinedMethod, JoinedTimestamp: x.JoinedTimestamp });
const ouView = (a: Account, o: Organization, u: { Id: string; Name: string }) => ({ Id: u.Id, Arn: `arn:aws:organizations::${a.id}:ou/${o.Id}/${u.Id}`, Name: u.Name });
const policyTypes = (o: Organization) => ['SERVICE_CONTROL_POLICY', 'TAG_POLICY', 'BACKUP_POLICY'].map((Type) => ({ Type, Status: o.policyTypes.includes(Type) ? 'ENABLED' : 'DISABLED' }));
const orgView = (a: Account, o: Organization) => ({ Id: o.Id, Arn: `arn:aws:organizations::${a.id}:organization/${o.Id}`, FeatureSet: o.FeatureSet, MasterAccountArn: `arn:aws:organizations::${a.id}:account/${o.Id}/${a.id}`, MasterAccountId: a.id, MasterAccountEmail: o.accounts[a.id].Email, AvailablePolicyTypes: o.FeatureSet === 'ALL' ? policyTypes(o) : [] });
const rootView = (a: Account, o: Organization) => ({ Id: o.rootId, Arn: `arn:aws:organizations::${a.id}:root/${o.Id}/${o.rootId}`, Name: 'Root', PolicyTypes: o.FeatureSet === 'ALL' ? policyTypes(o).filter((p) => p.Status === 'ENABLED') : [] });
void orgArn;

function parentExists(o: Organization, id: string) {
  if (id !== o.rootId && !o.units[id]) throw new AwsError('ParentNotFoundException', `You specified a parent that doesn't exist.`);
}

op('organizations', 'create-organization', 'feature-set:s', 'Crea una organización (esta cuenta pasa a ser la de administración).', { global: true, res: () => '*' }, (c) => {
  if (c.acct.org) throw new AwsError('AlreadyInOrganizationException', 'The AWS account is already a member of an organization.');
  const fs = (c.p.FeatureSet ?? 'ALL') as 'ALL' | 'CONSOLIDATED_BILLING';
  if (fs !== 'ALL' && fs !== 'CONSOLIDATED_BILLING') throw new AwsError('InvalidInputException', `You specified an invalid value for FeatureSet: ${fs}`);
  return { Organization: orgView(c.acct, orgCreate(c.acct, fs)) };
});
op('organizations', 'describe-organization', '', 'Datos de la organización a la que pertenece la cuenta.', { global: true, res: () => '*' }, (c) => ({ Organization: orgView(c.acct, orgOf(c.acct)) }));
op('organizations', 'delete-organization', '', 'Borra la organización (solo si no tiene cuentas miembro).', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  if (Object.keys(o.accounts).length > 1 || Object.keys(o.units).length) throw new AwsError('OrganizationNotEmptyException', 'To delete an organization you must first remove all member accounts (except the master).');
  c.acct.org = undefined;
  return undefined;
});
op('organizations', 'list-roots', '', 'La raíz de la jerarquía.', { global: true, res: () => '*' }, (c) => ({ Roots: [rootView(c.acct, orgOf(c.acct))] }));

op('organizations', 'create-organizational-unit', 'parent-id:s! name:s!', 'Crea una unidad organizativa (OU) para agrupar cuentas.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  parentExists(o, c.p.ParentId);
  if (Object.values(o.units).some((u) => u.ParentId === c.p.ParentId && u.Name === c.p.Name)) throw new AwsError('DuplicateOrganizationalUnitException', 'An OrganizationalUnit with the same name already exists.');
  const id = `ou-${o.rootId.slice(2)}-${newId(c.acct, 'orgou', '', 8, 'hex')}`;
  o.units[id] = { Id: id, Name: c.p.Name, ParentId: c.p.ParentId };
  return { OrganizationalUnit: ouView(c.acct, o, o.units[id]) };
});
op('organizations', 'list-organizational-units-for-parent', 'parent-id:s!', 'OU que cuelgan de un padre.', { global: true, res: () => '*', paginate: 'OrganizationalUnits' }, (c) => {
  const o = orgOf(c.acct);
  parentExists(o, c.p.ParentId);
  return { OrganizationalUnits: Object.values(o.units).filter((u) => u.ParentId === c.p.ParentId).map((u) => ouView(c.acct, o, u)) };
});
op('organizations', 'list-accounts', 'max-items:i', 'Lista todas las cuentas de la organización.', { global: true, res: () => '*', paginate: 'Accounts' }, (c) => {
  const o = orgOf(c.acct);
  return { Accounts: Object.values(o.accounts).map((x) => accountView(c.acct, o, x)) };
});
op('organizations', 'list-accounts-for-parent', 'parent-id:s!', 'Cuentas que cuelgan directamente de la raíz o de una OU.', { global: true, res: () => '*', paginate: 'Accounts' }, (c) => {
  const o = orgOf(c.acct);
  parentExists(o, c.p.ParentId);
  return { Accounts: Object.values(o.accounts).filter((x) => x.ParentId === c.p.ParentId).map((x) => accountView(c.acct, o, x)) };
});
op('organizations', 'describe-account', 'account-id:s!', 'Datos de una cuenta de la organización.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const x = o.accounts[c.p.AccountId];
  if (!x) throw new AwsError('AccountNotFoundException', 'You specified an account that doesn\'t exist.');
  return { Account: accountView(c.acct, o, x) };
});
op('organizations', 'move-account', 'account-id:s! source-parent-id:s! destination-parent-id:s!', 'Mueve una cuenta a otra OU (o a la raíz).', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const x = o.accounts[c.p.AccountId];
  if (!x) throw new AwsError('AccountNotFoundException', 'You specified an account that doesn\'t exist.');
  parentExists(o, c.p.SourceParentId);
  parentExists(o, c.p.DestinationParentId);
  if (x.ParentId !== c.p.SourceParentId) throw new AwsError('SourceParentNotFoundException', 'You specified a parent that doesn\'t contain the specified child.');
  x.ParentId = c.p.DestinationParentId;
  return undefined;
});
op('organizations', 'list-parents', 'child-id:s!', 'El padre (raíz u OU) de una cuenta o de una OU.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const pid = o.accounts[c.p.ChildId]?.ParentId ?? o.units[c.p.ChildId]?.ParentId;
  if (!pid) throw new AwsError('ChildNotFoundException', 'We can\'t find an organizational unit (OU) or AWS account with the ChildId that you specified.');
  return { Parents: [{ Id: pid, Type: pid === o.rootId ? 'ROOT' : 'ORGANIZATIONAL_UNIT' }] };
});
op('organizations', 'remove-account-from-organization', 'account-id:s!', 'Saca una cuenta miembro de la organización.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  if (c.p.AccountId === c.acct.id) throw new AwsError('ConstraintViolationException', 'You cannot remove the management account from its organization.');
  if (!o.accounts[c.p.AccountId]) throw new AwsError('AccountNotFoundException', 'You specified an account that doesn\'t exist.');
  delete o.accounts[c.p.AccountId];
  return undefined;
});

const createRequests: Record<string, string> = {};
op('organizations', 'create-account', 'email:s! account-name:s! role-name:s iam-user-access-to-billing:s', 'Crea una cuenta nueva dentro de la organización.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const reqId = newId(c.acct, 'orgcar', 'car-', 32, 'hex');
  const status = (state: string, extra: object = {}) => ({ CreateAccountStatus: { Id: reqId, AccountName: c.p.AccountName, State: state, RequestedTimestamp: iso(c.acct.clock), ...extra } });
  if (Object.values(o.accounts).some((x) => x.Email.toLowerCase() === String(c.p.Email).toLowerCase())) {
    createRequests[reqId] = 'FAILED:EMAIL_ALREADY_EXISTS';
    return status('IN_PROGRESS');
  }
  if (Object.keys(o.accounts).length >= 10) {
    createRequests[reqId] = 'FAILED:ACCOUNT_LIMIT_EXCEEDED';
    return status('IN_PROGRESS');
  }
  const acc = orgAddAccount(c.acct, c.p.AccountName, c.p.Email);
  createRequests[reqId] = acc.Id;
  return status('IN_PROGRESS');
});
op('organizations', 'describe-create-account-status', 'create-account-request-id:s!', 'Estado de una petición de crear cuenta.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const r = createRequests[c.p.CreateAccountRequestId];
  if (!r) throw new AwsError('CreateAccountStatusNotFoundException', 'We can\'t find an create account request with the CreateAccountRequestId that you specified.');
  const acc = o.accounts[r];
  if (r.startsWith('FAILED:')) return { CreateAccountStatus: { Id: c.p.CreateAccountRequestId, State: 'FAILED', FailureReason: r.slice(7) } };
  return { CreateAccountStatus: { Id: c.p.CreateAccountRequestId, AccountName: acc?.Name, State: 'SUCCEEDED', RequestedTimestamp: acc?.JoinedTimestamp, CompletedTimestamp: acc?.JoinedTimestamp, AccountId: r } };
});

const pView = (p: OrgPolicy) => ({ Id: p.Id, Arn: `arn:aws:organizations::aws:policy/service_control_policy/${p.Id}`, Name: p.Name, Description: p.Description, Type: p.Type, AwsManaged: p.AwsManaged });
op('organizations', 'enable-policy-type', 'root-id:s! policy-type:s!', 'Activa un tipo de política (SERVICE_CONTROL_POLICY, TAG_POLICY…) en la raíz.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  if (o.FeatureSet !== 'ALL') throw new AwsError('ConstraintViolationException', 'All features must be enabled in the organization to use policies.');
  if (!['SERVICE_CONTROL_POLICY', 'TAG_POLICY', 'BACKUP_POLICY'].includes(c.p.PolicyType)) throw new AwsError('InvalidInputException', `You specified an invalid value for PolicyType: ${c.p.PolicyType}`);
  if (o.policyTypes.includes(c.p.PolicyType)) throw new AwsError('PolicyTypeAlreadyEnabledException', 'The specified policy type is already enabled in the specified root.');
  o.policyTypes.push(c.p.PolicyType);
  return { Root: rootView(c.acct, o) };
});
op('organizations', 'create-policy', 'content:s! description:s! name:s! type:s! tags:t', 'Crea una política de organización (por ejemplo, una SCP que limita lo que se puede hacer).', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  if (!o.policyTypes.includes(c.p.Type)) throw new AwsError('PolicyTypeNotEnabledException', 'The specified policy type isn\'t currently enabled in this root. You can\'t attach policies of the specified type to entities in a root until you enable that type in the root.');
  try {
    const j = JSON.parse(c.p.Content);
    if (!j || typeof j !== 'object' || !j.Statement) throw new Error('x');
  } catch {
    throw new AwsError('MalformedPolicyDocumentException', 'The provided policy document does not meet the requirements of the specified policy type.');
  }
  if (Object.values(o.policies).some((p) => p.Name === c.p.Name)) throw new AwsError('DuplicatePolicyException', 'A policy with the specified name already exists.');
  const id = newId(c.acct, 'orgpol', 'p-', 8, 'hex');
  o.policies[id] = { Id: id, Name: c.p.Name, Description: c.p.Description, Type: c.p.Type, Content: c.p.Content, AwsManaged: false, targets: [] };
  return { Policy: { PolicySummary: pView(o.policies[id]), Content: c.p.Content } };
});
op('organizations', 'list-policies', 'filter:s!', 'Lista las políticas de un tipo.', { global: true, res: () => '*', paginate: 'Policies' }, (c) => ({ Policies: Object.values(orgOf(c.acct).policies).filter((p) => p.Type === c.p.Filter).map(pView) }));
op('organizations', 'describe-policy', 'policy-id:s!', 'Contenido de una política.', { global: true, res: () => '*' }, (c) => {
  const p = orgOf(c.acct).policies[c.p.PolicyId];
  if (!p) throw new AwsError('PolicyNotFoundException', 'You specified a policy that doesn\'t exist.');
  return { Policy: { PolicySummary: pView(p), Content: p.Content } };
});
op('organizations', 'attach-policy', 'policy-id:s! target-id:s!', 'Aplica una política a la raíz, a una OU o a una cuenta.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const p = o.policies[c.p.PolicyId];
  if (!p) throw new AwsError('PolicyNotFoundException', 'You specified a policy that doesn\'t exist.');
  if (c.p.TargetId !== o.rootId && !o.units[c.p.TargetId] && !o.accounts[c.p.TargetId]) throw new AwsError('TargetNotFoundException', 'You specified a target that doesn\'t exist.');
  if (p.targets.includes(c.p.TargetId)) throw new AwsError('DuplicatePolicyAttachmentException', 'The selected policy is already attached to the specified target.');
  p.targets.push(c.p.TargetId);
  return undefined;
});
op('organizations', 'detach-policy', 'policy-id:s! target-id:s!', 'Quita una política de un destino.', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const p = o.policies[c.p.PolicyId];
  if (!p || !p.targets.includes(c.p.TargetId)) throw new AwsError('PolicyNotAttachedException', 'The policy isn\'t attached to the specified target in the specified root.');
  const last = Object.values(o.policies).filter((x) => x.Type === p.Type && x.targets.includes(c.p.TargetId)).length === 1;
  if (last && p.Type === 'SERVICE_CONTROL_POLICY') throw new AwsError('ConstraintViolationException', 'You can\'t detach the last service control policy from a target: every target must have at least one.');
  p.targets = p.targets.filter((t) => t !== c.p.TargetId);
  return undefined;
});
op('organizations', 'list-policies-for-target', 'target-id:s! filter:s!', 'Políticas aplicadas directamente a un destino.', { global: true, res: () => '*', paginate: 'Policies' }, (c) => ({ Policies: Object.values(orgOf(c.acct).policies).filter((p) => p.Type === c.p.Filter && p.targets.includes(c.p.TargetId)).map(pView) }));
op('organizations', 'delete-policy', 'policy-id:s!', 'Borra una política (no puede estar aplicada).', { global: true, res: () => '*' }, (c) => {
  const o = orgOf(c.acct);
  const p = o.policies[c.p.PolicyId];
  if (!p) throw new AwsError('PolicyNotFoundException', 'You specified a policy that doesn\'t exist.');
  if (p.AwsManaged) throw new AwsError('ConstraintViolationException', 'You can\'t delete an AWS managed policy.');
  if (p.targets.length) throw new AwsError('PolicyInUseException', 'The policy is attached to one or more entities. You must detach it from all roots, OUs, and accounts before performing this operation.');
  delete o.policies[p.Id];
  return undefined;
});

// ───────────────────────── API de etiquetas ─────────────────────────

interface Tagged {
  arn: string;
  type: string;
  tags: () => Tag[];
  set: (t: Tag[]) => void;
}

function taggedResources(c: Pick<OpCtx, 'acct' | 'region'>): Tagged[] {
  const out: Tagged[] = [];
  const a = c.acct;
  const rs = a.regions[c.region];
  const ec2 = (type: string, kind: string, id: string, obj: { Tags: Tag[] }) => out.push({ arn: `arn:aws:ec2:${c.region}:${a.id}:${kind}/${id}`, type, tags: () => obj.Tags, set: (t) => void (obj.Tags = t) });
  if (rs) {
    const e = regional(a, c.region).ec2;
    for (const x of Object.values(e.instances)) if (x.state !== 'terminated') ec2('ec2:instance', 'instance', x.InstanceId, x);
    for (const x of Object.values(e.volumes)) ec2('ec2:volume', 'volume', x.VolumeId, x);
    for (const x of Object.values(e.snapshots)) ec2('ec2:snapshot', 'snapshot', x.SnapshotId, x);
    for (const x of Object.values(e.securityGroups)) ec2('ec2:security-group', 'security-group', x.GroupId, x);
    for (const x of Object.values(e.vpcs)) ec2('ec2:vpc', 'vpc', x.VpcId, x);
    for (const x of Object.values(e.subnets)) ec2('ec2:subnet', 'subnet', x.SubnetId, x);
    for (const x of Object.values(e.internetGateways)) ec2('ec2:internet-gateway', 'internet-gateway', x.InternetGatewayId, x);
    for (const x of Object.values(e.natGateways)) if (x.state !== 'deleted') ec2('ec2:natgateway', 'natgateway', x.NatGatewayId, x);
    for (const x of Object.values(e.routeTables)) ec2('ec2:route-table', 'route-table', x.RouteTableId, x);
    for (const x of Object.values(e.addresses)) ec2('ec2:elastic-ip', 'elastic-ip', x.AllocationId, x);
    for (const x of Object.values(rs.ddb ?? {})) out.push({ arn: `arn:aws:dynamodb:${c.region}:${a.id}:table/${x.TableName}`, type: 'dynamodb:table', tags: () => x.Tags, set: (t) => void (x.Tags = t) });
    for (const x of Object.values(rs.rds?.instances ?? {})) out.push({ arn: `arn:aws:rds:${c.region}:${a.id}:db:${x.DBInstanceIdentifier}`, type: 'rds:db', tags: () => x.Tags, set: (t) => void (x.Tags = t) });
    for (const x of Object.values(rs.rds?.snapshots ?? {})) out.push({ arn: `arn:aws:rds:${c.region}:${a.id}:snapshot:${x.DBSnapshotIdentifier}`, type: 'rds:snapshot', tags: () => x.Tags, set: (t) => void (x.Tags = t) });
  }
  for (const b of Object.values(a.s3.buckets)) if (b.region === c.region) out.push({ arn: `arn:aws:s3:::${b.name}`, type: 's3', tags: () => b.tags, set: (t) => void (b.tags = t) });
  return out;
}

interface TagFilter {
  Key: string;
  Values?: string[];
}

op('resourcegroupstaggingapi', 'get-resources', 'tag-filters:f resource-type-filters:l resources-per-page:i', 'Busca recursos de la región por etiqueta (varios servicios a la vez).', { res: () => '*', action: 'tag:GetResources', paginate: 'ResourceTagMappingList' }, (c) => {
  const filters = (c.p.TagFilters as TagFilter[]) ?? [];
  const types = (c.p.ResourceTypeFilters as string[]) ?? [];
  const list = taggedResources(c).filter((r) => {
    if (types.length && !types.some((t) => r.type === t || r.type.startsWith(t + ':'))) return false;
    const tags = r.tags();
    if (!tags.length) return false;
    return filters.every((f) => tags.some((t) => t.Key === f.Key && (!f.Values?.length || f.Values.includes(t.Value))));
  });
  return { PaginationToken: '', ResourceTagMappingList: list.map((r) => ({ ResourceARN: r.arn, Tags: r.tags() })) };
});

op('resourcegroupstaggingapi', 'get-tag-keys', '', 'Claves de etiqueta en uso en la región.', { res: () => '*', action: 'tag:GetTagKeys', paginate: 'TagKeys' }, (c) => ({ PaginationToken: '', TagKeys: [...new Set(taggedResources(c).flatMap((r) => r.tags().map((t) => t.Key)))].sort() }));

op('resourcegroupstaggingapi', 'get-tag-values', 'key:s!', 'Valores usados con una clave de etiqueta.', { res: () => '*', action: 'tag:GetTagValues', paginate: 'TagValues' }, (c) => ({ PaginationToken: '', TagValues: [...new Set(taggedResources(c).flatMap((r) => r.tags().filter((t) => t.Key === c.p.Key).map((t) => t.Value)))].sort() }));

op('resourcegroupstaggingapi', 'tag-resources', 'resource-arn-list:l! tags:j!', 'Etiqueta varios recursos (de cualquier servicio) con una sola orden.', { res: () => '*', action: 'tag:TagResources' }, (c) => {
  const all = taggedResources(c);
  const failed: Record<string, unknown> = {};
  const tags = Object.entries(c.p.Tags as Record<string, string>).map(([Key, Value]) => ({ Key, Value: String(Value) }));
  if (!tags.length) throw new AwsError('InvalidParameterException', 'Tags must not be empty');
  for (const arn of c.p.ResourceArnList as string[]) {
    const r = all.find((x) => x.arn === arn);
    if (!r) failed[arn] = { StatusCode: 400, ErrorCode: 'InvalidParameterException', ErrorMessage: `Resource ARN not found in region ${c.region}: ${arn}` };
    else r.set(mergeTags(r.tags(), tags));
  }
  return { FailedResourcesMap: failed };
});

op('resourcegroupstaggingapi', 'untag-resources', 'resource-arn-list:l! tag-keys:l!', 'Quita etiquetas de varios recursos.', { res: () => '*', action: 'tag:UntagResources' }, (c) => {
  const all = taggedResources(c);
  const failed: Record<string, unknown> = {};
  for (const arn of c.p.ResourceArnList as string[]) {
    const r = all.find((x) => x.arn === arn);
    if (!r) failed[arn] = { StatusCode: 400, ErrorCode: 'InvalidParameterException', ErrorMessage: `Resource ARN not found in region ${c.region}: ${arn}` };
    else r.set(r.tags().filter((t) => !(c.p.TagKeys as string[]).includes(t.Key)));
  }
  return { FailedResourcesMap: failed };
});

// ───────────────────────── soporte y Trusted Advisor ─────────────────────────

const needsPlan = (a: Account) => {
  if (a.supportPlan !== 'business' && a.supportPlan !== 'enterprise') throw new AwsError('SubscriptionRequiredException', 'AWS Premium Support Subscription is required to use this service.');
};

interface Check {
  id: string;
  name: string;
  description: string;
  category: 'cost_optimizing' | 'security' | 'fault_tolerance' | 'performance' | 'service_limits';
  metadata: string[];
  run: (a: Account) => { region: string; id: string; extra: string[] }[];
  savings?: (a: Account, flagged: number) => number;
}

const CHECKS: Check[] = [
  {
    id: 'Qch7DwouX1',
    name: 'Low Utilization Amazon EC2 Instances',
    description: 'Checks the Amazon EC2 instances that were running at any time during the last 14 days and alerts you if the daily CPU utilization was 10% or less and network I/O was 5 MB or less on 4 or more days.',
    category: 'cost_optimizing',
    metadata: ['Region/AZ', 'Instance ID', 'Instance Name', 'Instance Type', 'Estimated Monthly Savings'],
    run: (a) => Object.entries(a.regions).flatMap(([region, r]) => Object.values(r.ec2.instances).filter((i) => i.state === 'running' && (instanceType(i.InstanceType)?.vcpu ?? 2) >= 4).map((i) => ({ region, id: i.InstanceId, extra: [i.AvailabilityZone, i.InstanceId, i.Tags.find((t) => t.Key === 'Name')?.Value ?? '', i.InstanceType, ((instanceType(i.InstanceType)?.price ?? 0) * HOURS_MONTH).toFixed(2)] }))),
    savings: (a) => Object.values(a.regions).flatMap((r) => Object.values(r.ec2.instances)).filter((i) => i.state === 'running' && (instanceType(i.InstanceType)?.vcpu ?? 2) >= 4).reduce((n, i) => n + (instanceType(i.InstanceType)?.price ?? 0) * HOURS_MONTH, 0),
  },
  {
    id: 'Z4AUBRNSmz',
    name: 'Unassociated Elastic IP Addresses',
    description: 'Checks for Elastic IP addresses (EIPs) that are not associated with a running Amazon EC2 instance.',
    category: 'cost_optimizing',
    metadata: ['Region', 'IP Address'],
    run: (a) => Object.entries(a.regions).flatMap(([region, r]) => Object.values(r.ec2.addresses).filter((x) => !x.InstanceId && !x.AssociationId).map((x) => ({ region, id: x.PublicIp, extra: [region, x.PublicIp] }))),
    savings: (a, n) => n * PRICE.publicIpv4Hour * HOURS_MONTH,
  },
  {
    id: 'DAvU99Dc4C',
    name: 'Underutilized Amazon EBS Volumes',
    description: 'Checks Amazon Elastic Block Store (Amazon EBS) volume configurations and warns when volumes appear to be underused (for example, not attached to any instance).',
    category: 'cost_optimizing',
    metadata: ['Region', 'Volume ID', 'Volume Name', 'Volume Type', 'Volume Size', 'Monthly Storage Cost'],
    run: (a) => Object.entries(a.regions).flatMap(([region, r]) => Object.values(r.ec2.volumes).filter((v) => v.state === 'available').map((v) => ({ region, id: v.VolumeId, extra: [region, v.VolumeId, v.Tags.find((t) => t.Key === 'Name')?.Value ?? '', v.VolumeType, `${v.Size} GiB`, (v.Size * (PRICE.ebsGbMonth[v.VolumeType] ?? 0.08)).toFixed(2)] }))),
    savings: (a) => Object.values(a.regions).flatMap((r) => Object.values(r.ec2.volumes)).filter((v) => v.state === 'available').reduce((n, v) => n + v.Size * (PRICE.ebsGbMonth[v.VolumeType] ?? 0.08), 0),
  },
  {
    id: 'HCP4007jGY',
    name: 'Security Groups - Specific Ports Unrestricted',
    description: 'Checks security groups for rules that allow unrestricted access (0.0.0.0/0) to specific ports.',
    category: 'security',
    metadata: ['Region', 'Security Group Name', 'Security Group ID', 'Protocol', 'Port', 'Status', 'IP Range'],
    run: (a) => Object.entries(a.regions).flatMap(([region, r]) => Object.values(r.ec2.securityGroups).flatMap((g) => g.IpPermissions.filter((p) => p.IpRanges.some((x) => x.CidrIp === '0.0.0.0/0') && [22, 3389, 3306, 5432, 1433, 21, 23].some((port) => p.IpProtocol === '-1' || ((p.FromPort ?? 0) <= port && (p.ToPort ?? 65535) >= port))).map((p) => ({ region, id: g.GroupId, extra: [region, g.GroupName, g.GroupId, p.IpProtocol === '-1' ? 'all' : p.IpProtocol, p.FromPort === undefined ? 'all' : `${p.FromPort}`, 'Red', '0.0.0.0/0'] })))),
  },
  {
    id: '7DAFEmoDos',
    name: 'MFA on Root Account',
    description: 'Checks the root account and warns if multi-factor authentication (MFA) is not enabled.',
    category: 'security',
    metadata: [],
    run: (a) => (a.iam.rootMfa ? [] : [{ region: '-', id: 'root', extra: [] }]),
  },
  {
    id: 'Pfx0RwqBli',
    name: 'Amazon S3 Bucket Permissions',
    description: 'Checks buckets in Amazon S3 that have open access permissions.',
    category: 'security',
    metadata: ['Region Name', 'Region API Parameter', 'Bucket Name', 'ACL Allows List', 'ACL Allows Upload/Delete', 'Status', 'Policy Allows Access', 'Action'],
    run: (a) => Object.values(a.s3.buckets).filter((b) => !!b.policy && isPublicPolicy(b.policy) && !(b.publicAccessBlock?.BlockPublicPolicy && b.publicAccessBlock?.RestrictPublicBuckets)).map((b) => ({ region: b.region, id: b.name, extra: [b.region, b.region, b.name, 'No', 'No', 'Error', 'Yes', 'Block public access'] })),
  },
];

const statusOf = (c: Check, n: number) => (n === 0 ? 'ok' : c.category === 'security' ? 'error' : 'warning');

op('support', 'describe-trusted-advisor-checks', 'language:s!', 'Lista las comprobaciones de Trusted Advisor (requiere el plan Business o superior).', { global: true, res: () => '*', authz: false }, (c) => {
  needsPlan(c.acct);
  return { checks: CHECKS.map((x) => ({ id: x.id, name: x.name, description: x.description, category: x.category, metadata: x.metadata })) };
});

op('support', 'describe-trusted-advisor-check-result', 'check-id:s! language:s', 'Resultado de una comprobación: qué recursos señala y cuánto ahorrarías.', { global: true, res: () => '*', authz: false }, (c) => {
  needsPlan(c.acct);
  const ch = CHECKS.find((x) => x.id === c.p.CheckId);
  if (!ch) throw new AwsError('InvalidParameterValueException', `Invalid check id: ${c.p.CheckId}`);
  const flagged = ch.run(c.acct);
  const save = ch.savings ? ch.savings(c.acct, flagged.length) : 0;
  return {
    result: {
      checkId: ch.id,
      timestamp: iso(c.acct.clock),
      status: statusOf(ch, flagged.length),
      resourcesSummary: { resourcesProcessed: flagged.length, resourcesFlagged: flagged.length, resourcesIgnored: 0, resourcesSuppressed: 0 },
      categorySpecificSummary: ch.category === 'cost_optimizing' ? { costOptimizing: { estimatedMonthlySavings: Math.round(save * 100) / 100, estimatedPercentMonthlySavings: 0 } } : {},
      flaggedResources: flagged.map((f) => ({ status: statusOf(ch, 1), region: f.region, resourceId: f.id, isSuppressed: false, metadata: f.extra })),
    },
  };
});

void stableId;
