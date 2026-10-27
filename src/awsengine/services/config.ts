/**
 * AWS Config: graba cómo cambia la configuración de los recursos (S3, EC2, IAM, RDS, Lambda), evalúa reglas de cumplimiento
 * (gestionadas de AWS) y puede remediarlas con documentos de Systems Manager Automation.
 */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, PolicyStatement } from '../types';
import type { ConfigEvaluation, ConfigItem, ConfigRule, ConfigState } from '../types-ops';
import { iso, isoZ, mkArn, newId, toArr, wildcard } from '../util';
import { putEvent } from './events';
import { roleTrusts } from './flowlogs';
import { anonymousAllowed, s3Put } from './s3';
import { ssmStatus } from './ssm';

export const configOf = (a: Account, region: string): ConfigState => {
  const r = regional(a, region);
  return (r.config ??= { rules: {}, evals: [], history: [], remediations: {}, remExec: [], last: {}, checkedAt: 0 });
};

/** Lo rellena Systems Manager Automation: ejecuta un documento con parámetros y devuelve el id de la ejecución (o lanza error). */
export const remediationRunner: { run?: (a: Account, region: string, doc: string, params: Record<string, string[]>) => string } = {};

// ───────────────────────── recursos ─────────────────────────

interface Res {
  type: string;
  id: string;
  name: string;
  arn: string;
  region: string;
  created?: string;
  tags: { Key: string; Value: string }[];
  /** Datos que ve el evaluador (los de la configuración y algo más). */
  cfg: Record<string, any>;
  az?: string;
}

const tagsOf = (t?: { Key: string; Value: string }[]) => t ?? [];

function resources(a: Account, region: string, recorder: NonNullable<ConfigState['recorder']>): Res[] {
  const out: Res[] = [];
  const want = (t: string) => recorder.recordingGroup.allSupported || recorder.recordingGroup.resourceTypes.includes(t);
  const r = regional(a, region);
  if (want('AWS::S3::Bucket'))
    for (const b of Object.values(a.s3.buckets))
      if (b.region === region) out.push({ type: 'AWS::S3::Bucket', id: b.name, name: b.name, arn: `arn:aws:s3:::${b.name}`, region, created: b.created, tags: tagsOf(b.tags), cfg: { name: b.name, versioning: b.versioning || 'Off', encryption: b.encryption.SSEAlgorithm, kmsKey: b.encryption.KMSMasterKeyID ?? null, publicAccessBlock: b.publicAccessBlock ?? null, hasPolicy: !!b.policy, loggingEnabled: !!b.logging } });
  if (want('AWS::EC2::Instance'))
    for (const i of Object.values(r.ec2.instances))
      if (i.state !== 'terminated') out.push({ type: 'AWS::EC2::Instance', id: i.InstanceId, name: i.InstanceId, arn: mkArn('ec2', region, a.id, `instance/${i.InstanceId}`), region, created: i.LaunchTime, az: i.AvailabilityZone, tags: tagsOf(i.Tags), cfg: { instanceId: i.InstanceId, imageId: i.ImageId, instanceType: i.InstanceType, state: i.state, subnetId: i.SubnetId, vpcId: i.VpcId, privateIpAddress: i.PrivateIpAddress, publicIpAddress: i.PublicIpAddress ?? null, securityGroups: i.SecurityGroupIds, monitoring: i.Monitoring, iamInstanceProfile: i.IamInstanceProfile ?? null } });
  if (want('AWS::EC2::SecurityGroup'))
    for (const g of Object.values(r.ec2.securityGroups)) out.push({ type: 'AWS::EC2::SecurityGroup', id: g.GroupId, name: g.GroupName, arn: mkArn('ec2', region, a.id, `security-group/${g.GroupId}`), region, tags: tagsOf(g.Tags), cfg: { groupId: g.GroupId, groupName: g.GroupName, description: g.Description, vpcId: g.VpcId, ipPermissions: g.IpPermissions, ipPermissionsEgress: g.IpPermissionsEgress } });
  if (want('AWS::EC2::Volume'))
    for (const v of Object.values(r.ec2.volumes)) out.push({ type: 'AWS::EC2::Volume', id: v.VolumeId, name: v.VolumeId, arn: mkArn('ec2', region, a.id, `volume/${v.VolumeId}`), region, created: v.CreateTime, az: v.AvailabilityZone, tags: tagsOf(v.Tags), cfg: { volumeId: v.VolumeId, size: v.Size, volumeType: v.VolumeType, encrypted: v.Encrypted, state: v.state, attachments: v.attachment ? [{ instanceId: v.attachment.InstanceId, device: v.attachment.Device }] : [] } });
  if (recorder.recordingGroup.includeGlobalResourceTypes && region === 'us-east-1') {
    if (want('AWS::IAM::User'))
      for (const u of Object.values(a.iam.users)) out.push({ type: 'AWS::IAM::User', id: u.UserId, name: u.UserName, arn: u.Arn, region: 'global', created: u.CreateDate, tags: tagsOf(u.Tags), cfg: { userName: u.UserName, userId: u.UserId, path: u.Path, mfaDevices: u.mfa.length, attachedManagedPolicies: u.attached, inlinePolicies: Object.keys(u.inline), groups: u.groups, accessKeys: u.accessKeys.map((k) => ({ accessKeyId: k.AccessKeyId, status: k.Status, createDate: k.CreateDate })), hasLoginProfile: u.loginProfile } });
    if (want('AWS::IAM::Role'))
      for (const ro of Object.values(a.iam.roles)) out.push({ type: 'AWS::IAM::Role', id: ro.RoleId, name: ro.RoleName, arn: ro.Arn, region: 'global', created: ro.CreateDate, tags: tagsOf(ro.Tags), cfg: { roleName: ro.RoleName, roleId: ro.RoleId, path: ro.Path, attachedManagedPolicies: ro.attached, inlinePolicies: Object.keys(ro.inline), assumeRolePolicyDocument: ro.AssumeRolePolicyDocument } });
  }
  if (want('AWS::RDS::DBInstance'))
    for (const d of Object.values(r.rds?.instances ?? {})) out.push({ type: 'AWS::RDS::DBInstance', id: d.DBInstanceIdentifier, name: d.DBInstanceIdentifier, arn: mkArn('rds', region, a.id, `db:${d.DBInstanceIdentifier}`), region, created: d.InstanceCreateTime, az: d.AvailabilityZone, tags: tagsOf(d.Tags), cfg: { dBInstanceIdentifier: d.DBInstanceIdentifier, dBInstanceClass: d.DBInstanceClass, engine: d.Engine, multiAZ: d.MultiAZ, publiclyAccessible: d.PubliclyAccessible, storageEncrypted: d.StorageEncrypted, backupRetentionPeriod: d.BackupRetentionPeriod, deletionProtection: d.DeletionProtection } });
  if (want('AWS::Lambda::Function'))
    for (const f of Object.values(r.lambda?.functions ?? {})) out.push({ type: 'AWS::Lambda::Function', id: f.FunctionName, name: f.FunctionName, arn: f.FunctionArn, region, tags: Object.entries(f.tags).map(([Key, Value]) => ({ Key, Value })), cfg: { functionName: f.FunctionName, runtime: f.Runtime, handler: f.Handler, memorySize: f.MemorySize, timeout: f.Timeout, role: f.Role, environment: Object.keys(f.Environment) } });
  return out;
}

export const CONFIG_TYPES = ['AWS::S3::Bucket', 'AWS::EC2::Instance', 'AWS::EC2::SecurityGroup', 'AWS::EC2::Volume', 'AWS::IAM::User', 'AWS::IAM::Role', 'AWS::RDS::DBInstance', 'AWS::Lambda::Function'];

// ───────────────────────── reglas gestionadas ─────────────────────────

type Verdict = { c: 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE'; why?: string };
interface Managed {
  types: string[];
  eval: (a: Account, region: string, res: Res, params: Record<string, string>) => Verdict;
  /** Parámetros que acepta (con su valor por defecto, si lo hay). */
  params?: Record<string, string | null>;
}

const open22 = (perms: { IpProtocol: string; FromPort?: number; ToPort?: number; IpRanges: { CidrIp: string }[]; Ipv6Ranges: { CidrIpv6: string }[] }[], ports: number[]): number | null => {
  for (const p of perms) {
    const world = p.IpRanges.some((r) => r.CidrIp === '0.0.0.0/0') || p.Ipv6Ranges.some((r) => r.CidrIpv6 === '::/0');
    if (!world) continue;
    if (p.IpProtocol === '-1') return ports[0];
    if (p.IpProtocol !== 'tcp') continue;
    const hit = ports.find((x) => (p.FromPort ?? 0) <= x && x <= (p.ToPort ?? 65535));
    if (hit !== undefined) return hit;
  }
  return null;
};

const MANAGED: Record<string, Managed> = {
  S3_BUCKET_PUBLIC_READ_PROHIBITED: {
    types: ['AWS::S3::Bucket'],
    eval: (a, _r, res) => (anonymousAllowed(a.s3.buckets[res.id], 's3:GetObject', `arn:aws:s3:::${res.id}/x`) ? { c: 'NON_COMPLIANT', why: 'The S3 bucket policy allows public read access.' } : { c: 'COMPLIANT' }),
  },
  S3_BUCKET_PUBLIC_WRITE_PROHIBITED: {
    types: ['AWS::S3::Bucket'],
    eval: (a, _r, res) => (anonymousAllowed(a.s3.buckets[res.id], 's3:PutObject', `arn:aws:s3:::${res.id}/x`) ? { c: 'NON_COMPLIANT', why: 'The S3 bucket policy allows public write access.' } : { c: 'COMPLIANT' }),
  },
  S3_BUCKET_VERSIONING_ENABLED: { types: ['AWS::S3::Bucket'], eval: (_a, _r, res) => (res.cfg.versioning === 'Enabled' ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'Versioning is not enabled on the bucket.' }) },
  S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED: { types: ['AWS::S3::Bucket'], eval: (_a, _r, res) => (res.cfg.encryption ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'No default server-side encryption.' }) },
  S3_DEFAULT_ENCRYPTION_KMS: { types: ['AWS::S3::Bucket'], eval: (_a, _r, res) => (res.cfg.encryption === 'aws:kms' ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The default encryption is not SSE-KMS.' }) },
  S3_BUCKET_LOGGING_ENABLED: { types: ['AWS::S3::Bucket'], eval: (_a, _r, res) => (res.cfg.loggingEnabled ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'Server access logging is not enabled.' }) },
  S3_BUCKET_SSL_REQUESTS_ONLY: {
    types: ['AWS::S3::Bucket'],
    eval: (a, _r, res) => {
      const pol = a.s3.buckets[res.id].policy;
      const ok = !!pol && toArr<PolicyStatement>(pol.Statement).some((s) => s.Effect === 'Deny' && JSON.stringify(s.Condition ?? {}).toLowerCase().includes('"aws:securetransport":"false"'));
      return ok ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The bucket policy does not deny requests made without TLS.' };
    },
  },
  INCOMING_SSH_DISABLED: {
    types: ['AWS::EC2::SecurityGroup'],
    eval: (_a, _r, res) => (open22(res.cfg.ipPermissions, [22]) !== null ? { c: 'NON_COMPLIANT', why: 'The security group allows unrestricted incoming SSH (port 22).' } : { c: 'COMPLIANT' }),
  },
  RESTRICTED_INCOMING_TRAFFIC: {
    types: ['AWS::EC2::SecurityGroup'],
    params: { blockedPort1: '20', blockedPort2: '21', blockedPort3: '3389', blockedPort4: '3306', blockedPort5: '4333' },
    eval: (_a, _r, res, p) => {
      const ports = Object.entries(p).filter(([k, v]) => k.startsWith('blockedPort') && v).map(([, v]) => Number(v));
      const hit = open22(res.cfg.ipPermissions, ports);
      return hit !== null ? { c: 'NON_COMPLIANT', why: `The security group allows unrestricted incoming traffic on port ${hit}.` } : { c: 'COMPLIANT' };
    },
  },
  EC2_INSTANCE_NO_PUBLIC_IP: { types: ['AWS::EC2::Instance'], eval: (_a, _r, res) => (res.cfg.publicIpAddress ? { c: 'NON_COMPLIANT', why: 'The instance has a public IP address.' } : { c: 'COMPLIANT' }) },
  EC2_VOLUME_INUSE_CHECK: { types: ['AWS::EC2::Volume'], eval: (_a, _r, res) => (res.cfg.state === 'in-use' ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The volume is not attached to any instance.' }) },
  ENCRYPTED_VOLUMES: { types: ['AWS::EC2::Volume'], eval: (_a, _r, res) => (res.cfg.encrypted ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The volume is not encrypted.' }) },
  EC2_INSTANCE_MANAGED_BY_SSM: {
    types: ['AWS::EC2::Instance'],
    eval: (a, region, res) => {
      const i = regional(a, region).ec2.instances[res.id];
      return i && ssmStatus(a, region, i, { settled: true }).online ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The instance is not managed by Systems Manager.' };
    },
  },
  REQUIRED_TAGS: {
    types: [],
    params: { tag1Key: null, tag1Value: '', tag2Key: '', tag2Value: '', tag3Key: '', tag3Value: '', tag4Key: '', tag4Value: '', tag5Key: '', tag5Value: '', tag6Key: '', tag6Value: '' },
    eval: (_a, _r, res, p) => {
      for (let n = 1; n <= 6; n++) {
        const k = p[`tag${n}Key`];
        if (!k) continue;
        const t = res.tags.find((x) => x.Key === k);
        const want = p[`tag${n}Value`];
        if (!t) return { c: 'NON_COMPLIANT', why: `The tag "${k}" is missing.` };
        if (want && !want.split(',').includes(t.Value)) return { c: 'NON_COMPLIANT', why: `The tag "${k}" has a value that is not allowed.` };
      }
      return { c: 'COMPLIANT' };
    },
  },
  IAM_USER_MFA_ENABLED: { types: ['AWS::IAM::User'], eval: (_a, _r, res) => (res.cfg.mfaDevices > 0 ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The user has no MFA device.' }) },
  IAM_USER_NO_POLICIES_CHECK: {
    types: ['AWS::IAM::User'],
    eval: (_a, _r, res) => (res.cfg.attachedManagedPolicies.length || res.cfg.inlinePolicies.length ? { c: 'NON_COMPLIANT', why: 'The user has policies attached directly: use groups or roles.' } : { c: 'COMPLIANT' }),
  },
  ACCESS_KEYS_ROTATED: {
    types: ['AWS::IAM::User'],
    params: { maxAccessKeyAge: '90' },
    eval: (a, _r, res, p) => {
      const max = Number(p.maxAccessKeyAge || 90) * 86400000;
      const old = (res.cfg.accessKeys as { status: string; createDate: string }[]).find((k) => k.status === 'Active' && a.clock - Date.parse(k.createDate) > max);
      return old ? { c: 'NON_COMPLIANT', why: `An active access key is older than ${p.maxAccessKeyAge || 90} days.` } : { c: 'COMPLIANT' };
    },
  },
  RDS_INSTANCE_PUBLIC_ACCESS_CHECK: { types: ['AWS::RDS::DBInstance'], eval: (_a, _r, res) => (res.cfg.publiclyAccessible ? { c: 'NON_COMPLIANT', why: 'The DB instance is publicly accessible.' } : { c: 'COMPLIANT' }) },
  RDS_STORAGE_ENCRYPTED: { types: ['AWS::RDS::DBInstance'], eval: (_a, _r, res) => (res.cfg.storageEncrypted ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The DB instance storage is not encrypted.' }) },
  RDS_MULTI_AZ_SUPPORT: { types: ['AWS::RDS::DBInstance'], eval: (_a, _r, res) => (res.cfg.multiAZ ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: 'The DB instance is not Multi-AZ.' }) },
  LAMBDA_FUNCTION_SETTINGS_CHECK: {
    types: ['AWS::Lambda::Function'],
    params: { runtime: 'python3.12', timeout: '' },
    eval: (_a, _r, res, p) => (p.runtime && p.runtime.split(',').includes(res.cfg.runtime) ? { c: 'COMPLIANT' } : { c: 'NON_COMPLIANT', why: `The runtime ${res.cfg.runtime} is not allowed.` }),
  },
};

export const MANAGED_RULES = Object.keys(MANAGED);

function evalRule(a: Account, region: string, rule: ConfigRule, res: Res[]): ConfigEvaluation[] {
  const m = MANAGED[rule.Source.SourceIdentifier];
  if (!m) return [];
  const params = { ...Object.fromEntries(Object.entries(m.params ?? {}).map(([k, v]) => [k, v ?? ''])), ...(JSON.parse(rule.InputParameters || '{}') as Record<string, string>) };
  const types = rule.Scope?.ComplianceResourceTypes?.length ? rule.Scope.ComplianceResourceTypes : m.types;
  const out: ConfigEvaluation[] = [];
  for (const r of res) {
    if (!types.includes(r.type)) continue;
    if (rule.Scope?.TagKey && !r.tags.some((t) => t.Key === rule.Scope!.TagKey && (!rule.Scope!.TagValue || t.Value === rule.Scope!.TagValue))) continue;
    const v = m.eval(a, region, r, params);
    out.push({ rule: rule.ConfigRuleName, resourceType: r.type, resourceId: r.id, compliance: v.c, ...(v.why ? { annotation: v.why } : {}), at: a.clock });
  }
  return out;
}

// ───────────────────────── el grabador y las evaluaciones ─────────────────────────

const item = (a: Account, res: Res, status: ConfigItem['status'], at: number): ConfigItem => ({ resourceType: res.type, resourceId: res.id, resourceName: res.name, arn: res.arn, at, config: JSON.stringify(res.cfg), status, region: res.region });

const sameKey = (e: ConfigEvaluation, rule: string, type: string, id: string) => e.rule === rule && e.resourceType === type && e.resourceId === id;

function complianceEvent(a: Account, region: string, rule: ConfigRule, ev: ConfigEvaluation, old?: ConfigEvaluation): void {
  try {
    const qual = (e: ConfigEvaluation) => ({ evaluationResultIdentifier: { evaluationResultQualifier: { configRuleName: rule.ConfigRuleName, resourceType: e.resourceType, resourceId: e.resourceId }, orderingTimestamp: isoZ(e.at) }, complianceType: e.compliance, resultRecordedTime: isoZ(e.at), configRuleInvokedTime: isoZ(e.at), ...(e.annotation ? { annotation: e.annotation } : {}) });
    putEvent(a, region, 'default', {
      source: 'aws.config',
      detailType: 'Config Rules Compliance Change',
      resources: [rule.ConfigRuleArn],
      detail: { resourceId: ev.resourceId, awsRegion: region, awsAccountId: a.id, configRuleName: rule.ConfigRuleName, recordVersion: '1.0', configRuleARN: rule.ConfigRuleArn, messageType: 'ComplianceChangeNotification', newEvaluationResult: qual(ev), ...(old ? { oldEvaluationResult: qual(old) } : {}), notificationCreationTime: isoZ(a.clock), resourceType: ev.resourceType },
    });
  } catch {
    /* sin reglas */
  }
}

function remediate(a: Account, region: string, st: ConfigState, rule: ConfigRule, ev: ConfigEvaluation): void {
  const rem = st.remediations[rule.ConfigRuleName];
  if (!rem || ev.compliance !== 'NON_COMPLIANT') return;
  const done = st.remExec.filter((x) => x.rule === rule.ConfigRuleName && x.resourceId === ev.resourceId);
  if (rem.Automatic && done.length >= rem.MaximumAutomaticAttempts) return;
  if (rem.Automatic && done.length && a.clock - done[done.length - 1].at < rem.RetryAttemptSeconds * 1000) return;
  const params: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rem.Parameters)) params[k] = v.ResourceValue ? [ev.resourceId] : v.StaticValue?.Values ?? [];
  const x: ConfigState['remExec'][number] = { rule: rule.ConfigRuleName, resourceType: ev.resourceType, resourceId: ev.resourceId, state: 'IN_PROGRESS', at: a.clock };
  st.remExec.push(x);
  try {
    if (!remediationRunner.run) throw new Error('Automation is not available');
    x.automationId = remediationRunner.run(a, region, rem.TargetId, params);
    x.state = 'SUCCEEDED';
  } catch (e) {
    x.state = 'FAILED';
    x.error = (e as Error).message;
  }
}

/** Evalúa una regla sobre todos los recursos y actualiza el resultado (avisando de los cambios). */
function evaluateRule(a: Account, region: string, st: ConfigState, rule: ConfigRule, res: Res[], force = false): void {
  const fresh = evalRule(a, region, rule, res);
  const keep = st.evals.filter((e) => e.rule !== rule.ConfigRuleName);
  const prev = st.evals.filter((e) => e.rule === rule.ConfigRuleName);
  st.evals = [...keep, ...fresh];
  for (const ev of fresh) {
    const old = prev.find((p) => sameKey(p, rule.ConfigRuleName, ev.resourceType, ev.resourceId));
    if (old && old.compliance === ev.compliance) {
      ev.at = old.at;
      if (force && rem(st, rule)?.Automatic) remediate(a, region, st, rule, ev);
      continue;
    }
    complianceEvent(a, region, rule, ev, old);
    if (rem(st, rule)?.Automatic) remediate(a, region, st, rule, ev);
  }
}

const rem = (st: ConfigState, rule: ConfigRule) => st.remediations[rule.ConfigRuleName];

/** En cada paso: si el grabador está activo, anota los cambios de configuración y reevalúa las reglas afectadas. */
tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    const st = a.regions[region].config;
    const rec = st?.recorder;
    if (!st || !rec?.recording) continue;
    const res = resources(a, region, rec);
    const seen = new Set<string>();
    const changedTypes = new Set<string>();
    for (const r of res) {
      const k = `${r.type}|${r.id}`;
      seen.add(k);
      const fp = JSON.stringify([r.cfg, r.tags]);
      if (st.last[k] === undefined) {
        st.history.push(item(a, r, 'ResourceDiscovered', a.clock));
        changedTypes.add(r.type);
      } else if (st.last[k] !== fp) {
        st.history.push(item(a, r, 'OK', a.clock));
        changedTypes.add(r.type);
      }
      st.last[k] = fp;
    }
    for (const k of Object.keys(st.last)) {
      if (seen.has(k)) continue;
      const [type, id] = k.split('|');
      const last = [...st.history].reverse().find((h) => h.resourceType === type && h.resourceId === id);
      st.history.push({ resourceType: type, resourceId: id, resourceName: last?.resourceName, arn: last?.arn ?? '', at: a.clock, config: '{}', status: 'ResourceDeleted', region: last?.region ?? region });
      delete st.last[k];
      changedTypes.add(type);
    }
    if (st.history.length > 600) st.history.splice(0, st.history.length - 600);
    // reglas nuevas (aún sin evaluar) o afectadas por el cambio
    for (const rule of Object.values(st.rules)) {
      const m = MANAGED[rule.Source.SourceIdentifier];
      const types = rule.Scope?.ComplianceResourceTypes?.length ? rule.Scope.ComplianceResourceTypes : m?.types ?? [];
      const fresh = rule.ConfigRuleState === 'EVALUATING' || !st.evals.some((e) => e.rule === rule.ConfigRuleName) && !evaluated.has(rule);
      if (fresh || types.some((t) => changedTypes.has(t))) {
        rule.ConfigRuleState = 'ACTIVE';
        evaluated.add(rule);
        evaluateRule(a, region, st, rule, res);
      }
    }
  }
});
const evaluated = new WeakSet<ConfigRule>();

// ───────────────────────── operaciones: grabador y canal ─────────────────────────

const recView = (r: NonNullable<ConfigState['recorder']>) => ({ name: r.name, roleARN: r.roleARN, recordingGroup: { allSupported: r.recordingGroup.allSupported, includeGlobalResourceTypes: r.recordingGroup.includeGlobalResourceTypes, resourceTypes: r.recordingGroup.resourceTypes } });

const bucketAllowsConfig = (a: Account, bucket: string, prefix?: string): boolean => {
  const b = a.s3.buckets[bucket];
  if (!b?.policy) return false;
  const stmts = toArr<PolicyStatement>(b.policy.Statement).filter((s) => s.Effect === 'Allow' && toArr<string>((s.Principal as { Service?: string | string[] } | undefined)?.Service).includes('config.amazonaws.com'));
  const acts = (s: PolicyStatement) => toArr<string>(s.Action as string | string[]).map((x) => x.toLowerCase());
  const res = (s: PolicyStatement) => toArr<string>(s.Resource as string | string[]);
  const acl = stmts.some((s) => (acts(s).includes('s3:getbucketacl') || acts(s).includes('s3:*')) && res(s).some((r) => wildcard(r, `arn:aws:s3:::${bucket}`)));
  const put = stmts.some((s) => (acts(s).includes('s3:putobject') || acts(s).includes('s3:*')) && res(s).some((r) => wildcard(r, `arn:aws:s3:::${bucket}/${prefix ? prefix + '/' : ''}AWSLogs/${a.id}/Config/${'us-east-1'}/x`)));
  return acl && put;
};

op('configservice', 'put-configuration-recorder', 'configuration-recorder:j! recording-group:j', 'Crea el grabador de Config (uno por región): qué recursos se anotan y con qué rol.', { res: () => '*', action: 'config:PutConfigurationRecorder' }, (c) => {
  const st = configOf(c.acct, c.region);
  const r = c.p.ConfigurationRecorder as { name?: string; roleARN?: string; recordingGroup?: { allSupported?: boolean; includeGlobalResourceTypes?: boolean; resourceTypes?: string[] } };
  if (!r?.roleARN) throw new AwsError('ValidationException', "1 validation error detected: Value null at 'configurationRecorder.roleARN' failed to satisfy constraint: Member must not be null", 400);
  const roleName = r.roleARN.split('/').pop() ?? '';
  if (!c.acct.iam.roles[roleName]) throw new AwsError('InvalidRoleException', `Invalid role arn: ${r.roleARN}. The role does not exist.`, 400);
  if (!roleTrusts(c.acct, r.roleARN, 'config.amazonaws.com')) throw new AwsError('InvalidRoleException', `Config cannot assume the role ${r.roleARN}: its trust policy must allow config.amazonaws.com.`, 400);
  const raw = (c.p.RecordingGroup as Record<string, unknown> | undefined) ?? (r.recordingGroup as Record<string, unknown> | undefined) ?? { allSupported: true };
  const flag = (v: unknown, d: boolean) => (v === undefined ? d : v === true || v === 'true');
  const types = toArr<string>(raw.resourceTypes as string | string[] | undefined);
  const rg = { allSupported: flag(raw.allSupported, !types.length), includeGlobalResourceTypes: flag(raw.includeGlobalResourceTypes, false), resourceTypes: types };
  for (const t of types) if (!CONFIG_TYPES.includes(t)) throw new AwsError('ValidationException', `Resource type ${t} is not supported by this simulator. Supported: ${CONFIG_TYPES.join(', ')}.`, 400);
  if (rg.allSupported && types.length) throw new AwsError('InvalidRecordingGroupException', 'allSupported and resourceTypes cannot both be set.', 400);
  const was = st.recorder;
  st.recorder = { name: r.name ?? 'default', roleARN: r.roleARN, recordingGroup: rg, recording: was?.recording ?? false, lastStartTime: was?.lastStartTime, lastStopTime: was?.lastStopTime, lastStatus: was?.lastStatus ?? 'Pending' };
  return undefined;
});

op('configservice', 'describe-configuration-recorders', 'configuration-recorder-names:l', 'El grabador de la región.', { res: () => '*', action: 'config:DescribeConfigurationRecorders' }, (c) => {
  const r = configOf(c.acct, c.region).recorder;
  return { ConfigurationRecorders: r ? [recView(r)] : [] };
});

op('configservice', 'describe-configuration-recorder-status', 'configuration-recorder-names:l', 'Si el grabador está grabando y cuándo empezó.', { res: () => '*', action: 'config:DescribeConfigurationRecorderStatus' }, (c) => {
  const r = configOf(c.acct, c.region).recorder;
  return { ConfigurationRecordersStatus: r ? [{ name: r.name, ...(r.lastStartTime ? { lastStartTime: iso(r.lastStartTime) } : {}), recording: r.recording, lastStatus: r.lastStatus, ...(r.lastStopTime ? { lastStopTime: iso(r.lastStopTime) } : {}), ...(r.recording ? { lastStatusChangeTime: iso(r.lastStartTime ?? c.acct.clock) } : {}) }] : [] };
});

op('configservice', 'start-configuration-recorder', 'configuration-recorder-name:s!', 'Empieza a grabar (hace falta un canal de entrega).', { res: () => '*', action: 'config:StartConfigurationRecorder' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.recorder || st.recorder.name !== c.p.ConfigurationRecorderName) throw new AwsError('NoSuchConfigurationRecorderException', `Cannot find configuration recorder with the specified name '${c.p.ConfigurationRecorderName}'.`, 400);
  if (!st.delivery) throw new AwsError('NoAvailableDeliveryChannelException', 'Delivery channel is not available to start configuration recorder.', 400);
  st.recorder.recording = true;
  st.recorder.lastStartTime = c.acct.clock;
  st.recorder.lastStatus = 'Success';
  return undefined;
});

op('configservice', 'stop-configuration-recorder', 'configuration-recorder-name:s!', 'Deja de grabar (lo ya grabado se conserva).', { res: () => '*', action: 'config:StopConfigurationRecorder' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.recorder || st.recorder.name !== c.p.ConfigurationRecorderName) throw new AwsError('NoSuchConfigurationRecorderException', `Cannot find configuration recorder with the specified name '${c.p.ConfigurationRecorderName}'.`, 400);
  st.recorder.recording = false;
  st.recorder.lastStopTime = c.acct.clock;
  return undefined;
});

op('configservice', 'delete-configuration-recorder', 'configuration-recorder-name:s!', 'Borra el grabador (hay que pararlo antes).', { res: () => '*', action: 'config:DeleteConfigurationRecorder' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.recorder || st.recorder.name !== c.p.ConfigurationRecorderName) throw new AwsError('NoSuchConfigurationRecorderException', `Cannot find configuration recorder with the specified name '${c.p.ConfigurationRecorderName}'.`, 400);
  st.recorder = undefined;
  return undefined;
});

op('configservice', 'put-delivery-channel', 'delivery-channel:j!', 'Crea el canal de entrega: el bucket de S3 (y el tema SNS) donde Config deja sus archivos.', { res: () => '*', action: 'config:PutDeliveryChannel' }, (c) => {
  const st = configOf(c.acct, c.region);
  const d = c.p.DeliveryChannel as { name?: string; s3BucketName?: string; s3KeyPrefix?: string; snsTopicARN?: string; configSnapshotDeliveryProperties?: { deliveryFrequency?: string } };
  if (!d?.s3BucketName) throw new AwsError('ValidationException', "1 validation error detected: Value null at 'deliveryChannel.s3BucketName' failed to satisfy constraint: Member must not be null", 400);
  if (!c.acct.s3.buckets[d.s3BucketName]) throw new AwsError('NoSuchBucketException', `Cannot find a S3 bucket with an specified bucket name ${d.s3BucketName}. Please check the bucket name and try again.`, 400);
  if (!bucketAllowsConfig(c.acct, d.s3BucketName, d.s3KeyPrefix)) throw new AwsError('InsufficientDeliveryPolicyException', `Insufficient delivery policy to s3 bucket: ${d.s3BucketName}, unable to write to bucket, provided s3 key prefix is '${d.s3KeyPrefix ?? 'null'}'.`, 400);
  st.delivery = { name: d.name ?? 'default', s3BucketName: d.s3BucketName, s3KeyPrefix: d.s3KeyPrefix, snsTopicARN: d.snsTopicARN, frequency: d.configSnapshotDeliveryProperties?.deliveryFrequency };
  return undefined;
});

op('configservice', 'describe-delivery-channels', 'delivery-channel-names:l', 'El canal de entrega de la región.', { res: () => '*', action: 'config:DescribeDeliveryChannels' }, (c) => {
  const d = configOf(c.acct, c.region).delivery;
  return { DeliveryChannels: d ? [{ name: d.name, s3BucketName: d.s3BucketName, ...(d.s3KeyPrefix ? { s3KeyPrefix: d.s3KeyPrefix } : {}), ...(d.snsTopicARN ? { snsTopicARN: d.snsTopicARN } : {}), ...(d.frequency ? { configSnapshotDeliveryProperties: { deliveryFrequency: d.frequency } } : {}) }] : [] };
});

op('configservice', 'delete-delivery-channel', 'delivery-channel-name:s!', 'Borra el canal (el grabador debe estar parado).', { res: () => '*', action: 'config:DeleteDeliveryChannel' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (st.recorder?.recording) throw new AwsError('LastDeliveryChannelDeleteFailedException', 'Failed to delete last specified delivery channel with name ' + c.p.DeliveryChannelName + ", because there, is a running configuration recorder.", 400);
  st.delivery = undefined;
  return undefined;
});

op('configservice', 'deliver-config-snapshot', 'delivery-channel-name:s!', 'Entrega ya una instantánea completa de los recursos al bucket.', { res: () => '*', action: 'config:DeliverConfigSnapshot' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.delivery) throw new AwsError('NoSuchDeliveryChannelException', 'Cannot find delivery channel with specified name.', 400);
  if (!st.recorder?.recording) throw new AwsError('NoAvailableConfigurationRecorderException', 'Configuration recorder is not available to put events.', 400);
  const b = c.acct.s3.buckets[st.delivery.s3BucketName];
  const res = resources(c.acct, c.region, st.recorder);
  const d = new Date(c.acct.clock);
  const pre = st.delivery.s3KeyPrefix ? st.delivery.s3KeyPrefix + '/' : '';
  const key = `${pre}AWSLogs/${c.acct.id}/Config/${c.region}/${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}/ConfigSnapshot/${c.acct.id}_Config_${c.region}_ConfigSnapshot_${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z_${newId(c.acct, 'cfgsnap', '', 8, 'hex')}.json.gz`;
  if (b) s3Put(c.acct, b, key, JSON.stringify({ fileVersion: '1.0', configSnapshotId: newId(c.acct, 'snapid', '', 32, 'hex'), configurationItems: res.map((r) => ({ configurationItemStatus: 'OK', resourceType: r.type, resourceId: r.id, resourceName: r.name, ARN: r.arn, awsRegion: r.region, configuration: r.cfg, tags: Object.fromEntries(r.tags.map((t) => [t.Key, t.Value])) })) }), { contentType: 'application/x-gzip' });
  return { configSnapshotId: newId(c.acct, 'snapid', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5') };
});

// ───────────────────────── reglas ─────────────────────────

const ruleArn = (c: Pick<OpCtx, 'acct' | 'region'>, id: string) => mkArn('config', c.region, c.acct.id, `config-rule/${id}`);

const ruleView = (r: ConfigRule) => ({ ConfigRuleName: r.ConfigRuleName, ConfigRuleArn: r.ConfigRuleArn, ConfigRuleId: r.ConfigRuleId, ...(r.Description ? { Description: r.Description } : {}), ...(r.Scope ? { Scope: r.Scope } : {}), Source: r.Source, ...(r.InputParameters ? { InputParameters: r.InputParameters } : {}), ...(r.MaximumExecutionFrequency ? { MaximumExecutionFrequency: r.MaximumExecutionFrequency } : {}), ConfigRuleState: r.ConfigRuleState });

op('configservice', 'put-config-rule', 'config-rule:j! tags:f', 'Crea una regla de cumplimiento (una de las gestionadas de AWS, p. ej. `S3_BUCKET_PUBLIC_READ_PROHIBITED`).', { res: (c) => ruleArn(c, '*'), action: 'config:PutConfigRule' }, (c) => {
  const st = configOf(c.acct, c.region);
  const r = c.p.ConfigRule as { ConfigRuleName?: string; Description?: string; Scope?: ConfigRule['Scope']; Source?: ConfigRule['Source']; InputParameters?: string; MaximumExecutionFrequency?: string };
  if (!r?.ConfigRuleName) throw new AwsError('ValidationException', "1 validation error detected: Value null at 'configRule.configRuleName' failed to satisfy constraint: Member must not be null", 400);
  if (!r.Source?.SourceIdentifier || r.Source.Owner !== 'AWS') throw new AwsError('ValidationException', "Source must specify Owner 'AWS' and a SourceIdentifier (custom Lambda rules are not available in this simulator).", 400);
  const m = MANAGED[r.Source.SourceIdentifier];
  if (!m) throw new AwsError('InvalidParameterValueException', `The sourceIdentifier ${r.Source.SourceIdentifier} is invalid. Please refer to the documentation for a list of valid sourceIdentifiers that can be used when AWS is the owner.`, 400);
  if (!st.recorder) throw new AwsError('NoAvailableConfigurationRecorderException', 'Configuration recorder is not available to put events.', 400);
  if (!m.types.length && !r.Scope?.ComplianceResourceTypes?.length) throw new AwsError('InvalidParameterValueException', `The rule ${r.Source.SourceIdentifier} needs a Scope with ComplianceResourceTypes.`, 400);
  const given = r.InputParameters ? (JSON.parse(r.InputParameters) as Record<string, string>) : {};
  for (const k of Object.keys(given)) if (m.params && !(k in m.params)) throw new AwsError('InvalidParameterValueException', `The parameter ${k} is not valid for the rule ${r.Source.SourceIdentifier}.`, 400);
  if (m.params && Object.entries(m.params).some(([k, d]) => d === null && !given[k])) throw new AwsError('InvalidParameterValueException', `The rule ${r.Source.SourceIdentifier} requires the parameter ${Object.entries(m.params).find(([, d]) => d === null)![0]}.`, 400);
  const old = st.rules[r.ConfigRuleName];
  const id = old?.ConfigRuleId ?? `config-rule-${newId(c.acct, 'cfgrule', '', 6, 'hex')}`;
  const rule: ConfigRule = { ConfigRuleName: r.ConfigRuleName, ConfigRuleArn: ruleArn(c, id), ConfigRuleId: id, Description: r.Description, Source: { Owner: 'AWS', SourceIdentifier: r.Source.SourceIdentifier }, InputParameters: r.InputParameters ?? '', Scope: r.Scope, MaximumExecutionFrequency: r.MaximumExecutionFrequency, ConfigRuleState: 'EVALUATING', created: c.acct.clock };
  st.rules[r.ConfigRuleName] = rule;
  return undefined;
});

op('configservice', 'describe-config-rules', 'config-rule-names:l', 'Las reglas de la región.', { paginate: 'ConfigRules', res: () => '*', action: 'config:DescribeConfigRules' }, (c) => {
  const st = configOf(c.acct, c.region);
  const names = c.p.ConfigRuleNames as string[] | undefined;
  for (const n of names ?? []) if (!st.rules[n]) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${n}' provided in the request is invalid. Please check the configRule name`, 400);
  return { ConfigRules: Object.values(st.rules).filter((r) => !names || names.includes(r.ConfigRuleName)).map(ruleView) };
});

op('configservice', 'delete-config-rule', 'config-rule-name:s!', 'Borra una regla y sus resultados.', { res: () => '*', action: 'config:DeleteConfigRule' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.rules[c.p.ConfigRuleName]) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${c.p.ConfigRuleName}' provided in the request is invalid. Please check the configRule name`, 400);
  delete st.rules[c.p.ConfigRuleName];
  delete st.remediations[c.p.ConfigRuleName];
  st.evals = st.evals.filter((e) => e.rule !== c.p.ConfigRuleName);
  return undefined;
});

op('configservice', 'start-config-rules-evaluation', 'config-rule-names:l!', 'Fuerza la reevaluación de las reglas.', { res: () => '*', action: 'config:StartConfigRulesEvaluation' }, (c) => {
  const st = configOf(c.acct, c.region);
  for (const n of c.p.ConfigRuleNames as string[]) {
    const r = st.rules[n];
    if (!r) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${n}' provided in the request is invalid. Please check the configRule name`, 400);
    if (!st.recorder?.recording) continue;
    evaluateRule(c.acct, c.region, st, r, resources(c.acct, c.region, st.recorder), true);
  }
  return {};
});

const summarize = (list: ConfigEvaluation[]): 'COMPLIANT' | 'NON_COMPLIANT' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE' => {
  if (list.some((e) => e.compliance === 'NON_COMPLIANT')) return 'NON_COMPLIANT';
  if (list.some((e) => e.compliance === 'COMPLIANT')) return 'COMPLIANT';
  return list.length ? 'NOT_APPLICABLE' : 'INSUFFICIENT_DATA';
};

const capped = (n: number) => ({ CappedCount: Math.min(n, 25), CapExceeded: n > 25 });

op('configservice', 'describe-compliance-by-config-rule', 'config-rule-names:l compliance-types:l', 'Cumplimiento de cada regla: COMPLIANT, NON_COMPLIANT o INSUFFICIENT_DATA (aún sin evaluar).', { paginate: 'ComplianceByConfigRules', res: () => '*', action: 'config:DescribeComplianceByConfigRule' }, (c) => {
  const st = configOf(c.acct, c.region);
  const names = c.p.ConfigRuleNames as string[] | undefined;
  for (const n of names ?? []) if (!st.rules[n]) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${n}' provided in the request is invalid. Please check the configRule name`, 400);
  const out = Object.values(st.rules)
    .filter((r) => !names || names.includes(r.ConfigRuleName))
    .map((r) => {
      const list = st.evals.filter((e) => e.rule === r.ConfigRuleName);
      const t = summarize(list);
      return { ConfigRuleName: r.ConfigRuleName, Compliance: { ComplianceType: t, ...(t === 'NON_COMPLIANT' ? { ComplianceContributorCount: capped(list.filter((e) => e.compliance === 'NON_COMPLIANT').length) } : {}) } };
    })
    .filter((x) => !c.p.ComplianceTypes || (c.p.ComplianceTypes as string[]).includes(x.Compliance.ComplianceType));
  return { ComplianceByConfigRules: out };
});

const evalOut = (e: ConfigEvaluation) => ({
  EvaluationResultIdentifier: { EvaluationResultQualifier: { ConfigRuleName: e.rule, ResourceType: e.resourceType, ResourceId: e.resourceId }, OrderingTimestamp: iso(e.at) },
  ComplianceType: e.compliance,
  ResultRecordedTime: iso(e.at),
  ConfigRuleInvokedTime: iso(e.at),
  ...(e.annotation ? { Annotation: e.annotation } : {}),
});

op('configservice', 'get-compliance-details-by-config-rule', 'config-rule-name:s! compliance-types:l limit:i', 'Qué recursos incumplen (o cumplen) una regla y por qué.', { paginate: 'EvaluationResults', res: () => '*', action: 'config:GetComplianceDetailsByConfigRule' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.rules[c.p.ConfigRuleName]) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${c.p.ConfigRuleName}' provided in the request is invalid. Please check the configRule name`, 400);
  const types = c.p.ComplianceTypes as string[] | undefined;
  return { EvaluationResults: st.evals.filter((e) => e.rule === c.p.ConfigRuleName && (!types || types.includes(e.compliance))).slice(0, c.p.Limit ?? 100).map((e) => evalOut(e)) };
});

op('configservice', 'describe-compliance-by-resource', 'resource-type:s resource-id:s compliance-types:l', 'Cumplimiento de cada recurso frente a todas las reglas.', { paginate: 'ComplianceByResources', res: () => '*', action: 'config:DescribeComplianceByResource' }, (c) => {
  const st = configOf(c.acct, c.region);
  const keys = new Map<string, ConfigEvaluation[]>();
  for (const e of st.evals) {
    if ((c.p.ResourceType && e.resourceType !== c.p.ResourceType) || (c.p.ResourceId && e.resourceId !== c.p.ResourceId)) continue;
    const k = `${e.resourceType}|${e.resourceId}`;
    keys.set(k, [...(keys.get(k) ?? []), e]);
  }
  const types = c.p.ComplianceTypes as string[] | undefined;
  const out = [...keys.entries()].map(([k, list]) => {
    const t = summarize(list);
    const [ResourceType, ResourceId] = k.split('|');
    return { ResourceType, ResourceId, Compliance: { ComplianceType: t, ...(t === 'NON_COMPLIANT' ? { ComplianceContributorCount: capped(list.filter((e) => e.compliance === 'NON_COMPLIANT').length) } : {}) } };
  });
  return { ComplianceByResources: out.filter((x) => !types || types.includes(x.Compliance.ComplianceType)) };
});

op('configservice', 'get-compliance-details-by-resource', 'resource-type:s resource-id:s compliance-types:l', 'Resultados de todas las reglas para un recurso.', { paginate: 'EvaluationResults', res: () => '*', action: 'config:GetComplianceDetailsByResource' }, (c) => {
  const types = c.p.ComplianceTypes as string[] | undefined;
  return { EvaluationResults: configOf(c.acct, c.region).evals.filter((e) => e.resourceType === c.p.ResourceType && e.resourceId === c.p.ResourceId && (!types || types.includes(e.compliance))).map((e) => evalOut(e)) };
});

op('configservice', 'get-compliance-summary-by-config-rule', '', 'Cuántas reglas cumplen y cuántas no.', { res: () => '*', action: 'config:GetComplianceSummaryByConfigRule' }, (c) => {
  const st = configOf(c.acct, c.region);
  const kinds = Object.values(st.rules).map((r) => summarize(st.evals.filter((e) => e.rule === r.ConfigRuleName)));
  return { ComplianceSummary: { CompliantResourceCount: capped(kinds.filter((k) => k === 'COMPLIANT').length), NonCompliantResourceCount: capped(kinds.filter((k) => k === 'NON_COMPLIANT').length), ComplianceSummaryTimestamp: iso(c.acct.clock) } };
});

op('configservice', 'get-compliance-summary-by-resource-type', 'resource-types:l', 'Cuántos recursos de cada tipo cumplen y cuántos no.', { res: () => '*', action: 'config:GetComplianceSummaryByResourceType' }, (c) => {
  const st = configOf(c.acct, c.region);
  const per = new Map<string, Map<string, ConfigEvaluation[]>>();
  for (const e of st.evals) {
    if (c.p.ResourceTypes && !(c.p.ResourceTypes as string[]).includes(e.resourceType)) continue;
    const m = per.get(e.resourceType) ?? new Map();
    m.set(e.resourceId, [...(m.get(e.resourceId) ?? []), e]);
    per.set(e.resourceType, m);
  }
  return {
    ComplianceSummariesByResourceType: [...per.entries()].map(([ResourceType, m]) => {
      const kinds = [...m.values()].map(summarize);
      return { ResourceType, ComplianceSummary: { CompliantResourceCount: capped(kinds.filter((k) => k === 'COMPLIANT').length), NonCompliantResourceCount: capped(kinds.filter((k) => k === 'NON_COMPLIANT').length), ComplianceSummaryTimestamp: iso(c.acct.clock) } };
    }),
  };
});

// ───────────────────────── historial de configuración ─────────────────────────

op('configservice', 'list-discovered-resources', 'resource-type:s! resource-ids:l resource-name:s limit:i include-deleted-resources:b', 'Recursos que Config ha descubierto de un tipo.', { paginate: 'resourceIdentifiers', res: () => '*', action: 'config:ListDiscoveredResources' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!CONFIG_TYPES.includes(c.p.ResourceType)) throw new AwsError('ValidationException', `Value '${c.p.ResourceType}' at 'resourceType' failed to satisfy constraint: Member must satisfy enum value set: [${CONFIG_TYPES.join(', ')}]`, 400);
  const latest = new Map<string, ConfigItem>();
  for (const h of st.history) if (h.resourceType === c.p.ResourceType) latest.set(h.resourceId, h);
  return {
    resourceIdentifiers: [...latest.values()]
      .filter((h) => (c.p.IncludeDeletedResources || h.status !== 'ResourceDeleted') && (!c.p.ResourceIds || (c.p.ResourceIds as string[]).includes(h.resourceId)) && (!c.p.ResourceName || h.resourceName === c.p.ResourceName))
      .map((h) => ({ resourceType: h.resourceType, resourceId: h.resourceId, ...(h.resourceName ? { resourceName: h.resourceName } : {}), ...(h.status === 'ResourceDeleted' ? { resourceDeletionTime: iso(h.at) } : {}) })),
  };
});

op('configservice', 'get-resource-config-history', 'resource-type:s! resource-id:s! later-time:s earlier-time:s chronological-order:s limit:i', 'Cómo ha cambiado un recurso: cada cambio con su fecha y su configuración (lo que responde «¿qué cambió y cuándo?»).', { paginate: 'configurationItems', res: () => '*', action: 'config:GetResourceConfigHistory' }, (c) => {
  const st = configOf(c.acct, c.region);
  let list = st.history.filter((h) => h.resourceType === c.p.ResourceType && h.resourceId === c.p.ResourceId);
  if (!list.length) throw new AwsError('ResourceNotDiscoveredException', `Resource ${c.p.ResourceId} of resourceType:${c.p.ResourceType} is unknown or has not been discovered`, 400);
  const later = c.p.LaterTime ? Date.parse(String(c.p.LaterTime)) : Infinity;
  const earlier = c.p.EarlierTime ? Date.parse(String(c.p.EarlierTime)) : -Infinity;
  list = list.filter((h) => h.at <= later && h.at >= earlier);
  if (c.p.ChronologicalOrder !== 'Forward') list = [...list].reverse();
  return {
    configurationItems: list.slice(0, c.p.Limit ?? 10).map((h) => ({
      version: '1.3',
      accountId: c.acct.id,
      configurationItemCaptureTime: iso(h.at),
      configurationItemStatus: h.status,
      configurationStateId: String(h.at),
      arn: h.arn,
      resourceType: h.resourceType,
      resourceId: h.resourceId,
      ...(h.resourceName ? { resourceName: h.resourceName } : {}),
      awsRegion: h.region,
      configuration: h.config,
      supplementaryConfiguration: {},
    })),
  };
});

// ───────────────────────── remediación ─────────────────────────

op('configservice', 'put-remediation-configurations', 'remediation-configurations:f!', 'Asocia a una regla un documento de Systems Manager Automation que corrige los recursos que incumplen.', { res: () => '*', action: 'config:PutRemediationConfigurations' }, (c) => {
  const st = configOf(c.acct, c.region);
  const failed: { FailureMessage: string; FailedItems: unknown[] }[] = [];
  for (const r of c.p.RemediationConfigurations as Record<string, any>[]) {
    if (!st.rules[r.ConfigRuleName]) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${r.ConfigRuleName}' provided in the request is invalid. Please check the configRule name`, 400);
    if (r.TargetType !== 'SSM_DOCUMENT') throw new AwsError('ValidationException', 'TargetType must be SSM_DOCUMENT.', 400);
    if (r.Automatic && (!r.MaximumAutomaticAttempts || !r.RetryAttemptSeconds)) throw new AwsError('InvalidParameterValueException', 'Automatic remediation needs MaximumAutomaticAttempts and RetryAttemptSeconds.', 400);
    const first = !st.remediations[r.ConfigRuleName];
    st.remediations[r.ConfigRuleName] = { ConfigRuleName: r.ConfigRuleName, TargetType: 'SSM_DOCUMENT', TargetId: r.TargetId, TargetVersion: r.TargetVersion, Parameters: r.Parameters ?? {}, ResourceType: r.ResourceType, Automatic: !!r.Automatic, MaximumAutomaticAttempts: r.MaximumAutomaticAttempts ?? 5, RetryAttemptSeconds: r.RetryAttemptSeconds ?? 60, Arn: mkArn('config', c.region, c.acct.id, `remediation-configuration/${r.ConfigRuleName}`) };
    // con la remediación automática recién puesta, lo que ya incumple se corrige enseguida
    if (r.Automatic && first) for (const ev of st.evals.filter((e) => e.rule === r.ConfigRuleName && e.compliance === 'NON_COMPLIANT')) remediate(c.acct, c.region, st, st.rules[r.ConfigRuleName], ev);
  }
  return { FailedBatches: failed };
});

op('configservice', 'describe-remediation-configurations', 'config-rule-names:l!', 'Remediaciones configuradas para las reglas.', { res: () => '*', action: 'config:DescribeRemediationConfigurations' }, (c) => ({
  RemediationConfigurations: (c.p.ConfigRuleNames as string[]).map((n) => configOf(c.acct, c.region).remediations[n]).filter(Boolean).map((r) => ({ ConfigRuleName: r.ConfigRuleName, TargetType: r.TargetType, TargetId: r.TargetId, ...(r.TargetVersion ? { TargetVersion: r.TargetVersion } : {}), Parameters: r.Parameters, ...(r.ResourceType ? { ResourceType: r.ResourceType } : {}), Automatic: r.Automatic, MaximumAutomaticAttempts: r.MaximumAutomaticAttempts, RetryAttemptSeconds: r.RetryAttemptSeconds, Arn: r.Arn })),
}));

op('configservice', 'delete-remediation-configuration', 'config-rule-name:s! resource-type:s', 'Quita la remediación de una regla.', { res: () => '*', action: 'config:DeleteRemediationConfiguration' }, (c) => {
  const st = configOf(c.acct, c.region);
  if (!st.remediations[c.p.ConfigRuleName]) throw new AwsError('NoSuchRemediationConfigurationException', 'No remediation configuration exists for the rule.', 400);
  delete st.remediations[c.p.ConfigRuleName];
  return {};
});

op('configservice', 'start-remediation-execution', 'config-rule-name:s! resource-keys:f!', 'Lanza la remediación a mano sobre unos recursos.', { res: () => '*', action: 'config:StartRemediationExecution' }, (c) => {
  const st = configOf(c.acct, c.region);
  const rule = st.rules[c.p.ConfigRuleName];
  if (!rule) throw new AwsError('NoSuchConfigRuleException', `The ConfigRule '${c.p.ConfigRuleName}' provided in the request is invalid. Please check the configRule name`, 400);
  if (!st.remediations[c.p.ConfigRuleName]) throw new AwsError('NoSuchRemediationConfigurationException', 'No remediation configuration exists for the rule.', 400);
  const failed: unknown[] = [];
  for (const k of c.p.ResourceKeys as { resourceType: string; resourceId: string }[]) {
    const ev = st.evals.find((e) => sameKey(e, rule.ConfigRuleName, k.resourceType, k.resourceId));
    if (!ev || ev.compliance !== 'NON_COMPLIANT') {
      failed.push({ resourceType: k.resourceType, resourceId: k.resourceId });
      continue;
    }
    remediate(c.acct, c.region, st, rule, ev);
  }
  return { FailureMessage: failed.length ? 'Remediation can only run on NON_COMPLIANT resources.' : '', FailedItems: failed };
});

op('configservice', 'describe-remediation-execution-status', 'config-rule-name:s! resource-keys:f limit:i', 'Resultado de las remediaciones lanzadas.', { res: () => '*', action: 'config:DescribeRemediationExecutionStatus' }, (c) => ({
  RemediationExecutionStatuses: configOf(c.acct, c.region).remExec.filter((x) => x.rule === c.p.ConfigRuleName).map((x) => ({ ResourceKey: { resourceType: x.resourceType, resourceId: x.resourceId }, State: x.state, StepDetails: [{ Name: 'Step1', State: x.state === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED', ...(x.error ? { ErrorMessage: x.error } : {}) }], InvocationTime: iso(x.at), LastUpdatedTime: iso(x.at) })),
}));
