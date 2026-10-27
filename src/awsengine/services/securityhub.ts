/**
 * AWS Security Hub: reúne en un solo sitio (formato ASFF) los hallazgos de GuardDuty, Inspector, Macie y Access Analyzer, y evalúa
 * controles de buenas prácticas (AWS Foundational Security Best Practices y CIS) sobre la cuenta. Los controles necesitan que AWS Config
 * esté grabando; sin él, los estándares quedan INCOMPLETE y no hay hallazgos de control.
 */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, IamUser, IpPermission, PolicyDoc } from '../types';
import type { HubState } from '../types-sec';
import { isoZ, mkArn, stableId, toArr } from '../util';
import { acmOf } from './acm';
import { ctOf } from './cloudtrail';
import { gdOf } from './guardduty';
import { inspFindings, inspOf } from './inspector';
import { macieOf } from './macie';
import { analyzerOf } from './analyzer';
import { elb } from './elb';
import { putEvent } from './events';
import { anonymousAllowed } from './s3';
import { statementsOf } from './secshared';
import { ssmStatus } from './ssm';

export const hubOf = (a: Account, region: string): HubState => (regional(a, region).securityhub ??= { enabled: false, since: 0, autoEnableControls: true, standards: {}, products: [], workflow: {}, controls: {}, lastEval: -1 });

const invalid = (msg: string) => new AwsError('InvalidInputException', msg, 400);
const notFound = (msg: string) => new AwsError('ResourceNotFoundException', msg, 404);
const needHub = (c: Pick<OpCtx, 'acct' | 'region'>): HubState => {
  const st = hubOf(c.acct, c.region);
  if (!st.enabled) throw new AwsError('InvalidAccessException', `Account ${c.acct.id} is not subscribed to AWS Security Hub`, 401);
  return st;
};

// ───────────────────────── estándares ─────────────────────────

type Std = 'fsbp' | 'cis';
const STD: Record<Std, { name: string; description: string; gen: string; code: string; version: string; byDefault: boolean }> = {
  fsbp: { name: 'AWS Foundational Security Best Practices v1.0.0', description: 'The AWS Foundational Security Best Practices standard is a set of automated security checks that detect when AWS accounts and deployed resources do not align with security best practices.', gen: 'aws-foundational-security-best-practices/v/1.0.0', code: 'aws-foundational-security-best-practices', version: '1.0.0', byDefault: true },
  cis: { name: 'CIS AWS Foundations Benchmark v1.2.0', description: 'The Center for Internet Security (CIS) AWS Foundations Benchmark v1.2.0 is a set of security configuration best practices for AWS.', gen: 'cis-aws-foundations-benchmark/v/1.2.0', code: 'cis-aws-foundations-benchmark', version: '1.2.0', byDefault: true },
};
const stdArn = (s: Std, region: string) => (s === 'cis' ? 'arn:aws:securityhub:::ruleset/cis-aws-foundations-benchmark/v/1.2.0' : `arn:aws:securityhub:${region}::standards/${STD[s].gen}`);
const subArn = (a: Account, s: Std, region: string) => mkArn('securityhub', region, a.id, `subscription/${STD[s].gen}`);
const ctrlArn = (a: Account, s: Std, region: string, id: string) => mkArn('securityhub', region, a.id, `control/${STD[s].gen}/${id}`);

// ───────────────────────── controles ─────────────────────────

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
interface Result {
  type: string;
  id: string;
  ok: boolean;
  why?: string;
}
interface Control {
  /** Id en cada estándar (FSBP usa `S3.2`, CIS usa `1.4`). */
  ids: Partial<Record<Std, string>>;
  title: string;
  severity: Sev;
  fix: string;
  run: (a: Account, region: string) => Result[];
}

const worldOpen = (perms: IpPermission[], port: number): boolean =>
  perms.some((p) => (p.IpRanges.some((r) => r.CidrIp === '0.0.0.0/0') || p.Ipv6Ranges.some((r) => r.CidrIpv6 === '::/0')) && (p.IpProtocol === '-1' || (p.IpProtocol === 'tcp' && (p.FromPort ?? 0) <= port && port <= (p.ToPort ?? 65535))));

const buckets = (a: Account, region: string) => Object.values(a.s3.buckets).filter((b) => b.region === region);
const age = (a: Account, d: string) => (a.clock - Date.parse(d)) / 86400000;
const noSsl = (doc: PolicyDoc | undefined) => statementsOf(doc).some((s) => s.Effect === 'Deny' && /securetransport/i.test(JSON.stringify(s.Condition ?? {})) && /false/i.test(JSON.stringify(s.Condition ?? {})));
const users = (a: Account): IamUser[] => Object.values(a.iam.users);
const full = (doc: PolicyDoc) => statementsOf(doc).some((s) => s.Effect === 'Allow' && toArr<string>(s.Action as string[]).includes('*') && toArr<string>(s.Resource as string[]).includes('*'));
const acct = (a: Account): Result => ({ type: 'AwsAccount', id: `AWS::::Account:${a.id}`, ok: true });

const CONTROLS: Control[] = [
  { ids: { fsbp: 'S3.2' }, title: 'S3 buckets should prohibit public read access', severity: 'CRITICAL', fix: 'Block public access on the bucket and remove the policy statements that allow Principal "*".', run: (a, r) => buckets(a, r).map((b) => ({ type: 'AwsS3Bucket', id: `arn:aws:s3:::${b.name}`, ok: !anonymousAllowed(b, 's3:GetObject', `arn:aws:s3:::${b.name}/x`), why: 'The bucket policy allows public read access.' })) },
  { ids: { fsbp: 'S3.8' }, title: 'S3 buckets should block public access', severity: 'HIGH', fix: 'Turn on all four Block Public Access settings for the bucket.', run: (a, r) => buckets(a, r).map((b) => ({ type: 'AwsS3Bucket', id: `arn:aws:s3:::${b.name}`, ok: !!b.publicAccessBlock && b.publicAccessBlock.BlockPublicAcls && b.publicAccessBlock.IgnorePublicAcls && b.publicAccessBlock.BlockPublicPolicy && b.publicAccessBlock.RestrictPublicBuckets, why: 'Block Public Access is not fully enabled.' })) },
  { ids: { fsbp: 'S3.5' }, title: 'S3 buckets should require requests to use Secure Socket Layer', severity: 'MEDIUM', fix: 'Add a bucket policy statement that denies requests where aws:SecureTransport is false.', run: (a, r) => buckets(a, r).map((b) => ({ type: 'AwsS3Bucket', id: `arn:aws:s3:::${b.name}`, ok: noSsl(b.policy), why: 'The bucket policy does not deny non-TLS requests.' })) },
  { ids: { fsbp: 'EC2.13', cis: '4.1' }, title: 'Security groups should not allow ingress from 0.0.0.0/0 to port 22', severity: 'HIGH', fix: 'Remove the rule or restrict the source to the addresses that need SSH.', run: (a, r) => Object.values(regional(a, r).ec2.securityGroups).map((g) => ({ type: 'AwsEc2SecurityGroup', id: mkArn('ec2', r, a.id, `security-group/${g.GroupId}`), ok: !worldOpen(g.IpPermissions, 22), why: 'The security group allows SSH from anywhere.' })) },
  { ids: { fsbp: 'EC2.14', cis: '4.2' }, title: 'Security groups should not allow ingress from 0.0.0.0/0 to port 3389', severity: 'HIGH', fix: 'Remove the rule or restrict the source to the addresses that need RDP.', run: (a, r) => Object.values(regional(a, r).ec2.securityGroups).map((g) => ({ type: 'AwsEc2SecurityGroup', id: mkArn('ec2', r, a.id, `security-group/${g.GroupId}`), ok: !worldOpen(g.IpPermissions, 3389), why: 'The security group allows RDP from anywhere.' })) },
  { ids: { fsbp: 'EC2.2', cis: '4.3' }, title: 'The VPC default security group should not allow inbound and outbound traffic', severity: 'HIGH', fix: 'Delete every inbound and outbound rule of the default security group.', run: (a, r) => Object.values(regional(a, r).ec2.securityGroups).filter((g) => g.GroupName === 'default').map((g) => ({ type: 'AwsEc2SecurityGroup', id: mkArn('ec2', r, a.id, `security-group/${g.GroupId}`), ok: !g.IpPermissions.length && !g.IpPermissionsEgress.length, why: 'The default security group has rules.' })) },
  { ids: { fsbp: 'EC2.7' }, title: 'EBS default encryption should be enabled', severity: 'MEDIUM', fix: 'Run ec2 enable-ebs-encryption-by-default in the region.', run: (a, r) => [{ type: 'AwsAccount', id: `AWS::::Account:${a.id}`, ok: !!regional(a, r).ec2.ebsDefault?.enabled, why: 'EBS encryption by default is off in this region.' }] },
  { ids: { fsbp: 'EC2.3' }, title: 'Attached EBS volumes should be encrypted at-rest', severity: 'MEDIUM', fix: 'Create an encrypted snapshot copy and replace the volume.', run: (a, r) => Object.values(regional(a, r).ec2.volumes).filter((v) => v.attachment).map((v) => ({ type: 'AwsEc2Volume', id: mkArn('ec2', r, a.id, `volume/${v.VolumeId}`), ok: v.Encrypted, why: 'The volume is not encrypted.' })) },
  { ids: { fsbp: 'SSM.1' }, title: 'Amazon EC2 instances should be managed by AWS Systems Manager', severity: 'MEDIUM', fix: 'Attach an instance profile with AmazonSSMManagedInstanceCore and make sure the agent can reach Systems Manager.', run: (a, r) => Object.values(regional(a, r).ec2.instances).filter((i) => i.state === 'running').map((i) => ({ type: 'AwsEc2Instance', id: mkArn('ec2', r, a.id, `instance/${i.InstanceId}`), ok: ssmStatus(a, r, i, { settled: true }).online, why: 'The instance is not managed by Systems Manager.' })) },
  { ids: { fsbp: 'IAM.4', cis: '1.12' }, title: 'IAM root user access key should not exist', severity: 'CRITICAL', fix: 'Delete the root user access keys and use IAM roles instead.', run: (a) => [{ ...acct(a), ok: !a.iam.rootKeys.some((k) => k.Status === 'Active'), why: 'The root user has an active access key.' }] },
  { ids: { fsbp: 'IAM.5', cis: '1.2' }, title: 'MFA should be enabled for all IAM users that have a console password', severity: 'MEDIUM', fix: 'Register an MFA device for the user.', run: (a) => users(a).filter((u) => u.loginProfile).map((u) => ({ type: 'AwsIamUser', id: u.Arn, ok: u.mfa.length > 0, why: 'The user has a console password but no MFA device.' })) },
  { ids: { fsbp: 'IAM.3', cis: '1.4' }, title: 'IAM users\' access keys should be rotated every 90 days or less', severity: 'MEDIUM', fix: 'Create a new access key, switch the application to it and delete the old one.', run: (a) => users(a).filter((u) => u.accessKeys.some((k) => k.Status === 'Active')).map((u) => ({ type: 'AwsIamUser', id: u.Arn, ok: !u.accessKeys.some((k) => k.Status === 'Active' && age(a, k.CreateDate) > 90), why: 'An active access key is older than 90 days.' })) },
  { ids: { fsbp: 'IAM.2', cis: '1.16' }, title: 'IAM users should not have IAM policies attached', severity: 'LOW', fix: 'Put the user in a group and attach the policies to the group.', run: (a) => users(a).map((u) => ({ type: 'AwsIamUser', id: u.Arn, ok: !u.attached.length && !Object.keys(u.inline).length, why: 'The user has policies attached directly.' })) },
  { ids: { fsbp: 'IAM.1', cis: '1.22' }, title: 'IAM policies should not allow full "*" administrative privileges', severity: 'HIGH', fix: 'Replace the wildcard with the specific actions and resources that are needed.', run: (a) => Object.values(a.iam.policies).filter((p) => !p.aws).map((p) => ({ type: 'AwsIamPolicy', id: p.Arn, ok: !full(p.document), why: 'The policy allows "*" on "*".' })) },
  { ids: { fsbp: 'KMS.4', cis: '2.8' }, title: 'AWS KMS key rotation should be enabled', severity: 'MEDIUM', fix: 'Run kms enable-key-rotation for the key.', run: (a, r) => Object.values(regional(a, r).kms?.keys ?? {}).filter((k) => k.manager === 'CUSTOMER' && k.State === 'Enabled' && k.Spec === 'SYMMETRIC_DEFAULT').map((k) => ({ type: 'AwsKmsKey', id: k.Arn, ok: k.rotation.enabled, why: 'Automatic rotation is off.' })) },
  { ids: { fsbp: 'KMS.3' }, title: 'AWS KMS keys should not be deleted unintentionally', severity: 'CRITICAL', fix: 'Cancel the scheduled deletion if the key is still needed.', run: (a, r) => Object.values(regional(a, r).kms?.keys ?? {}).filter((k) => k.manager === 'CUSTOMER').map((k) => ({ type: 'AwsKmsKey', id: k.Arn, ok: k.State !== 'PendingDeletion', why: 'The key is scheduled for deletion.' })) },
  { ids: { fsbp: 'CloudTrail.1', cis: '2.1' }, title: 'CloudTrail should be enabled and configured with at least one multi-Region trail', severity: 'HIGH', fix: 'Create a multi-Region trail that logs management events and start logging.', run: (a) => [{ ...acct(a), ok: Object.values(ctOf(a).trails).some((t) => t.IsMultiRegionTrail && t.logging && t.IncludeGlobalServiceEvents), why: 'There is no multi-Region trail that is logging.' }] },
  { ids: { fsbp: 'CloudTrail.2', cis: '2.7' }, title: 'CloudTrail should have encryption at-rest enabled', severity: 'MEDIUM', fix: 'Set a KMS key on the trail (update-trail --kms-key-id).', run: (a) => Object.values(ctOf(a).trails).map((t) => ({ type: 'AwsCloudTrailTrail', id: t.TrailARN, ok: !!t.KmsKeyId, why: 'The trail is not encrypted with a KMS key.' })) },
  { ids: { fsbp: 'RDS.2' }, title: 'RDS DB instances should prohibit public access', severity: 'CRITICAL', fix: 'Modify the instance with --no-publicly-accessible.', run: (a, r) => Object.values(regional(a, r).rds?.instances ?? {}).map((d) => ({ type: 'AwsRdsDbInstance', id: mkArn('rds', r, a.id, `db:${d.DBInstanceIdentifier}`), ok: !d.PubliclyAccessible, why: 'The instance is publicly accessible.' })) },
  { ids: { fsbp: 'RDS.3' }, title: 'RDS DB instances should have encryption at-rest enabled', severity: 'MEDIUM', fix: 'Restore a snapshot copy encrypted with a KMS key.', run: (a, r) => Object.values(regional(a, r).rds?.instances ?? {}).map((d) => ({ type: 'AwsRdsDbInstance', id: mkArn('rds', r, a.id, `db:${d.DBInstanceIdentifier}`), ok: d.StorageEncrypted, why: 'The storage is not encrypted.' })) },
  { ids: { fsbp: 'GuardDuty.1' }, title: 'GuardDuty should be enabled', severity: 'HIGH', fix: 'Run guardduty create-detector --enable in this region.', run: (a, r) => [{ ...acct(a), ok: Object.values(gdOf(a, r).detectors).some((d) => d.Status === 'ENABLED'), why: 'GuardDuty is not enabled in this region.' }] },
  { ids: { fsbp: 'Config.1' }, title: 'AWS Config should be enabled', severity: 'MEDIUM', fix: 'Start the configuration recorder with a delivery channel.', run: (a, r) => [{ ...acct(a), ok: !!regional(a, r).config?.recorder?.recording, why: 'AWS Config is not recording.' }] },
  { ids: { fsbp: 'SecretsManager.1' }, title: 'Secrets Manager secrets should have automatic rotation enabled', severity: 'MEDIUM', fix: 'Configure rotation with rotate-secret.', run: (a, r) => Object.values(regional(a, r).secrets ?? {}).filter((s) => s.deletedAt === undefined).map((s) => ({ type: 'AwsSecretsManagerSecret', id: s.ARN, ok: !!s.rotation?.enabled, why: 'Rotation is not enabled.' })) },
  { ids: { fsbp: 'ACM.1' }, title: 'Imported and ACM-issued certificates should be renewed after a specified time period', severity: 'MEDIUM', fix: 'Renew the certificate (or fix its validation) before it expires.', run: (a, r) => Object.values(acmOf(a, r).certs).filter((c) => c.Status === 'ISSUED' && c.notAfter).map((c) => ({ type: 'AwsCertificateManagerCertificate', id: c.Arn, ok: (c.notAfter! - a.clock) / 86400000 >= 30, why: 'The certificate expires in less than 30 days.' })) },
  { ids: { fsbp: 'ELB.1' }, title: 'Application Load Balancer should be configured to redirect all HTTP requests to HTTPS', severity: 'MEDIUM', fix: 'Change the HTTP:80 listener default action to a redirect to HTTPS.', run: (a, r) => Object.values(elb(a, r).lbs).filter((l) => l.Type === 'application').map((l) => ({ type: 'AwsElbv2LoadBalancer', id: l.LoadBalancerArn, ok: Object.values(l.listeners).filter((x) => x.Protocol === 'HTTP').every((x) => x.rules.filter((q) => q.IsDefault).every((q) => q.Actions.some((ac) => ac.Type === 'redirect'))), why: 'An HTTP listener does not redirect to HTTPS.' })) },
];

const idIn = (c: Control, s: Std) => c.ids[s];
const controlsOf = (s: Std) => CONTROLS.filter((c) => idIn(c, s));

const SEV_N: Record<string, number> = { CRITICAL: 90, HIGH: 70, MEDIUM: 40, LOW: 20, INFORMATIONAL: 0 };

// ───────────────────────── hallazgos ASFF ─────────────────────────

type Asff = Record<string, any>;

const productArn = (region: string, p: string) => `arn:aws:securityhub:${region}::product/aws/${p}`;
const PRODUCTS = ['guardduty', 'inspector', 'macie', 'access-analyzer'];

const label = (n: number) => (n >= 90 ? 'CRITICAL' : n >= 70 ? 'HIGH' : n >= 40 ? 'MEDIUM' : n >= 1 ? 'LOW' : 'INFORMATIONAL');

function ready(a: Account, region: string): boolean {
  return !!regional(a, region).config?.recorder?.recording;
}

/** Evalúa los controles y devuelve sus hallazgos; deja constancia de cuándo nació y cambió cada uno. */
function controlFindings(a: Account, region: string, st: HubState, publish: boolean): Asff[] {
  const out: Asff[] = [];
  const seenNow = new Set<string>();
  for (const s of Object.keys(st.standards) as Std[]) {
    const dis = st.standards[s].disabled;
    for (const c of controlsOf(s)) {
      const cid = idIn(c, s)!;
      if (dis[cid]) continue;
      for (const r of c.run(a, region)) {
        const key = `${s}|${cid}|${r.id}`;
        seenNow.add(key);
        const prev = st.controls[key];
        const status: 'PASSED' | 'FAILED' = r.ok ? 'PASSED' : 'FAILED';
        const changed = !prev || prev.status !== status;
        if (!prev) st.controls[key] = { created: a.clock, updated: a.clock, status, seen: a.clock };
        else {
          if (changed) prev.updated = a.clock;
          prev.status = status;
          prev.seen = a.clock;
        }
        const rec = st.controls[key];
        const id = `arn:aws:securityhub:${region}:${a.id}:subscription/${STD[s].gen}/${cid}/finding/${stableId('shf:' + key, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')}`;
        const wf = st.workflow[id];
        const f: Asff = {
          SchemaVersion: '2018-10-08',
          Id: id,
          ProductArn: productArn(region, 'securityhub'),
          ProductName: 'Security Hub',
          CompanyName: 'AWS',
          Region: region,
          GeneratorId: `${STD[s].gen}/${cid}`,
          AwsAccountId: a.id,
          Types: ['Software and Configuration Checks/Industry and Regulatory Standards'],
          CreatedAt: isoZ(rec.created),
          UpdatedAt: isoZ(rec.updated),
          Severity: { Label: wf?.Severity ?? c.severity, Normalized: SEV_N[wf?.Severity ?? c.severity] },
          Title: c.title,
          Description: r.ok ? c.title : r.why ?? c.title,
          Remediation: { Recommendation: { Text: c.fix, Url: `https://docs.aws.amazon.com/console/securityhub/${cid}/remediation` } },
          ProductFields: { StandardsArn: stdArn(s, region), StandardsSubscriptionArn: subArn(a, s, region), ControlId: cid, RecommendationUrl: `https://docs.aws.amazon.com/console/securityhub/${cid}/remediation`, StandardsControlArn: ctrlArn(a, s, region, cid) },
          Resources: [{ Type: r.type, Id: r.id, Partition: 'aws', Region: region }],
          Compliance: { Status: status },
          WorkflowState: 'NEW',
          Workflow: { Status: wf?.Status ?? (status === 'PASSED' ? 'RESOLVED' : 'NEW') },
          RecordState: 'ACTIVE',
        };
        out.push(f);
        if (publish && changed && status === 'FAILED') {
          try {
            putEvent(a, region, 'default', { source: 'aws.securityhub', detailType: 'Security Hub Findings - Imported', resources: [id], detail: { findings: [f] } });
          } catch {
            /* sin reglas */
          }
        }
      }
    }
  }
  return out;
}

const GD_TYPES: Record<string, string> = { Instance: 'AwsEc2Instance', AccessKey: 'AwsIamAccessKey', S3Bucket: 'AwsS3Bucket' };

function imported(a: Account, region: string, st: HubState): Asff[] {
  const out: Asff[] = [];
  const base = (product: string, name: string, f: Asff) => ({ SchemaVersion: '2018-10-08', ProductArn: productArn(region, product), ProductName: name, CompanyName: 'Amazon', Region: region, AwsAccountId: a.id, WorkflowState: 'NEW', ...f });
  const wf = (id: string, def = 'NEW') => st.workflow[id]?.Status ?? def;
  if (st.products.includes('guardduty')) {
    for (const d of Object.values(gdOf(a, region).detectors)) {
      for (const g of Object.values(d.findings)) {
        const n = Math.round(g.Severity * 10);
        const rid = g.Resource.InstanceDetails?.InstanceId ?? g.Resource.AccessKeyDetails?.UserName ?? g.Resource.S3BucketDetails?.[0]?.Arn ?? g.Id;
        out.push(base('guardduty', 'GuardDuty', { Id: g.Arn, GeneratorId: `arn:aws:guardduty:${region}:${a.id}:detector/${d.Id}`, Types: [`TTPs/${g.Type.split(':')[0]}`], CreatedAt: g.CreatedAt, UpdatedAt: g.UpdatedAt, Severity: { Label: label(n), Normalized: n, Product: g.Severity }, Title: g.Title, Description: g.Description, Resources: [{ Type: GD_TYPES[g.Resource.ResourceType] ?? 'Other', Id: String(rid), Partition: 'aws', Region: region }], Workflow: { Status: wf(g.Arn) }, RecordState: g.Service.Archived ? 'ARCHIVED' : 'ACTIVE' }));
      }
    }
  }
  if (st.products.includes('inspector') && (inspOf(a, region).enabled.EC2 || inspOf(a, region).enabled.ECR)) {
    for (const f of inspFindings(a, region)) {
      const n = SEV_N[f.severity] ?? 0;
      out.push(base('inspector', 'Inspector', { Id: f.findingArn, GeneratorId: 'aws/inspector2', Types: [f.type === 'PACKAGE_VULNERABILITY' ? 'Software and Configuration Checks/Vulnerabilities/CVE' : 'Effects/Data Exposure/Network Reachability'], CreatedAt: f.firstObservedAt, UpdatedAt: f.updatedAt, Severity: { Label: f.severity, Normalized: n }, Title: f.title, Description: f.description, Remediation: f.remediation, Resources: [{ Type: f.meta.resourceType === 'AWS_EC2_INSTANCE' ? 'AwsEc2Instance' : 'AwsEcrContainerImage', Id: f.meta.resourceId, Partition: 'aws', Region: region }], Workflow: { Status: wf(f.findingArn, f.status === 'SUPPRESSED' ? 'SUPPRESSED' : 'NEW') }, RecordState: f.status === 'CLOSED' ? 'ARCHIVED' : 'ACTIVE' }));
    }
  }
  if (st.products.includes('macie')) {
    for (const f of Object.values(macieOf(a, region).findings)) {
      const n = f.severity === 'High' ? 70 : f.severity === 'Medium' ? 40 : 20;
      out.push(base('macie', 'Macie', { Id: f.id, GeneratorId: f.type, Types: [`Effects/Data Exposure/${f.category === 'POLICY' ? 'Policy' : 'SensitiveData'}`], CreatedAt: isoZ(f.createdAt), UpdatedAt: isoZ(f.createdAt), Severity: { Label: label(n), Normalized: n }, Title: f.description.split('.')[0], Description: f.description, Resources: [{ Type: 'AwsS3Bucket', Id: `arn:aws:s3:::${f.bucket}`, Partition: 'aws', Region: region }], Workflow: { Status: wf(f.id) }, RecordState: f.archived ? 'ARCHIVED' : 'ACTIVE' }));
    }
  }
  if (st.products.includes('access-analyzer')) {
    for (const an of Object.values(analyzerOf(a, region))) {
      for (const f of Object.values(an.findings)) {
        const n = f.isPublic ? 70 : 40;
        out.push(base('access-analyzer', 'IAM Access Analyzer', { Id: `${an.arn}/finding/${f.id}`, GeneratorId: an.arn, Types: ['Software and Configuration Checks/AWS Security Best Practices'], CreatedAt: isoZ(f.createdAt), UpdatedAt: isoZ(f.updatedAt), Severity: { Label: label(n), Normalized: n }, Title: f.isPublic ? `${f.resourceType.split('::')[2]} allows public access` : `${f.resourceType.split('::')[2]} allows access from an external account`, Description: `${f.resource} can be accessed by ${JSON.stringify(f.principal)}.`, Resources: [{ Type: 'Other', Id: f.resource, Partition: 'aws', Region: region }], Workflow: { Status: wf(`${an.arn}/finding/${f.id}`) }, RecordState: f.status === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED' }));
      }
    }
  }
  return out;
}

export function hubFindings(a: Account, region: string, publish = false): Asff[] {
  const st = hubOf(a, region);
  if (!st.enabled) return [];
  return [...(ready(a, region) ? controlFindings(a, region, st, publish) : []), ...imported(a, region, st)];
}

tickers.push((a) => {
  for (const [region, rs] of Object.entries(a.regions)) {
    const st = rs.securityhub;
    if (!st?.enabled || a.clock - st.lastEval < 30000) continue;
    st.lastEval = a.clock;
    hubFindings(a, region, true);
  }
});

// ───────────────────────── filtros ─────────────────────────

function fields(f: Asff): Record<string, string[]> {
  return {
    Id: [f.Id],
    ProductArn: [f.ProductArn],
    ProductName: [f.ProductName],
    GeneratorId: [f.GeneratorId],
    AwsAccountId: [f.AwsAccountId],
    Region: [f.Region],
    Title: [f.Title],
    Description: [f.Description],
    SeverityLabel: [f.Severity.Label],
    ComplianceStatus: f.Compliance ? [f.Compliance.Status] : [],
    RecordState: [f.RecordState],
    WorkflowStatus: [f.Workflow.Status],
    ResourceType: f.Resources.map((r: Asff) => r.Type),
    ResourceId: f.Resources.map((r: Asff) => r.Id),
    Type: f.Types,
  };
}

type StrFilter = { Value: string; Comparison: string };

function strOk(have: string[], fs: StrFilter[] | undefined): boolean {
  if (!fs?.length) return true;
  const pos = fs.filter((x) => !x.Comparison.includes('NOT'));
  const neg = fs.filter((x) => x.Comparison.includes('NOT'));
  const test = (v: string, x: StrFilter) => (x.Comparison.includes('PREFIX') ? v.startsWith(x.Value) : x.Comparison.includes('CONTAINS') ? v.includes(x.Value) : v === x.Value);
  return (!pos.length || pos.some((x) => have.some((v) => test(v, x)))) && neg.every((x) => !have.some((v) => test(v, x)));
}

function numOk(n: number, fs: { Gte?: number; Lte?: number; Eq?: number }[] | undefined): boolean {
  return !fs?.length || fs.some((x) => (x.Gte === undefined || n >= x.Gte) && (x.Lte === undefined || n <= x.Lte) && (x.Eq === undefined || n === x.Eq));
}

function matches(f: Asff, filters: Record<string, any> | undefined): boolean {
  if (!filters) return true;
  const fl = fields(f);
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'SeverityNormalized') {
      if (!numOk(f.Severity.Normalized, v)) return false;
      continue;
    }
    if (!(k in fl)) continue;
    if (!strOk(fl[k], v)) return false;
  }
  return true;
}

// ───────────────────────── operaciones ─────────────────────────

const hubArn = (c: Pick<OpCtx, 'acct' | 'region'>) => mkArn('securityhub', c.region, c.acct.id, 'hub/default');

op('securityhub', 'enable-security-hub', 'tags:j enable-default-standards:b control-finding-generator:s', 'Activa Security Hub en la región (y, por defecto, los estándares FSBP y CIS).', { res: () => '*' }, (c) => {
  const st = hubOf(c.acct, c.region);
  if (st.enabled) throw new AwsError('ResourceConflictException', `Account ${c.acct.id} is already subscribed to Security Hub`, 409);
  st.enabled = true;
  st.since = c.acct.clock;
  st.products = [...PRODUCTS];
  if (c.p.EnableDefaultStandards !== false) for (const s of Object.keys(STD) as Std[]) st.standards[s] = { disabled: {}, enabledAt: c.acct.clock };
  return {};
});
op('securityhub', 'disable-security-hub', '', 'Desactiva Security Hub y borra sus datos.', { res: () => '*' }, (c) => {
  needHub(c);
  regional(c.acct, c.region).securityhub = { enabled: false, since: 0, autoEnableControls: true, standards: {}, products: [], workflow: {}, controls: {}, lastEval: -1 };
  return {};
});
op('securityhub', 'describe-hub', 'hub-arn:s', 'Datos de Security Hub en la región.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  return { HubArn: hubArn(c), SubscribedAt: isoZ(st.since), AutoEnableControls: st.autoEnableControls, ControlFindingGenerator: 'SECURITY_CONTROL' };
});

const stdView = (s: Std, region: string) => ({ StandardsArn: stdArn(s, region), Name: STD[s].name, Description: STD[s].description, EnabledByDefault: STD[s].byDefault });
op('securityhub', 'describe-standards', 'max-results:i next-token:s', 'Los estándares disponibles.', { res: () => '*' }, (c) => ({ Standards: (Object.keys(STD) as Std[]).map((s) => stdView(s, c.region)) }));

const bySub = (a: Account, region: string, arn: string): Std | undefined => (Object.keys(STD) as Std[]).find((s) => subArn(a, s, region) === arn);
const byStd = (region: string, arn: string): Std | undefined => (Object.keys(STD) as Std[]).find((s) => stdArn(s, region) === arn);

const subView = (c: OpCtx, st: HubState, s: Std) => {
  const ok = ready(c.acct, c.region);
  return { StandardsSubscriptionArn: subArn(c.acct, s, c.region), StandardsArn: stdArn(s, c.region), StandardsInput: {}, StandardsStatus: ok ? 'READY' : 'INCOMPLETE', ...(ok ? {} : { StandardsStatusReason: { StatusReasonCode: 'NO_AVAILABLE_CONFIGURATION_RECORDER' } }) };
};

op('securityhub', 'get-enabled-standards', 'standards-subscription-arns:l max-results:i next-token:s', 'Estándares activados y si ya evalúan (INCOMPLETE si AWS Config no está grabando).', { res: () => '*' }, (c) => {
  const st = needHub(c);
  return { StandardsSubscriptions: (Object.keys(st.standards) as Std[]).map((s) => subView(c, st, s)) };
});
op('securityhub', 'batch-enable-standards', 'standards-subscription-requests:j!', 'Activa estándares (por su ARN).', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const out: ReturnType<typeof subView>[] = [];
  for (const r of toArr<{ StandardsArn: string }>(c.p.StandardsSubscriptionRequests as { StandardsArn: string }[])) {
    const s = byStd(c.region, r.StandardsArn);
    if (!s) throw invalid(`The standards ARN ${r.StandardsArn} is not valid.`);
    st.standards[s] ??= { disabled: {}, enabledAt: c.acct.clock };
    out.push(subView(c, st, s));
  }
  return { StandardsSubscriptions: out };
});
op('securityhub', 'batch-disable-standards', 'standards-subscription-arns:l!', 'Desactiva estándares.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const out: ReturnType<typeof subView>[] = [];
  for (const arn of toArr<string>(c.p.StandardsSubscriptionArns)) {
    const s = bySub(c.acct, c.region, arn);
    if (!s || !st.standards[s]) throw notFound(`The standards subscription ${arn} does not exist.`);
    out.push(subView(c, st, s));
    delete st.standards[s];
  }
  return { StandardsSubscriptions: out };
});
op('securityhub', 'describe-standards-controls', 'standards-subscription-arn:s! next-token:s max-results:i', 'Los controles de un estándar, con su gravedad y si están activados.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const s = bySub(c.acct, c.region, String(c.p.StandardsSubscriptionArn));
  if (!s || !st.standards[s]) throw notFound(`The standards subscription ${c.p.StandardsSubscriptionArn} does not exist.`);
  return { Controls: controlsOf(s).map((k) => ({ StandardsControlArn: ctrlArn(c.acct, s, c.region, idIn(k, s)!), ControlStatus: st.standards[s].disabled[idIn(k, s)!] ? 'DISABLED' : 'ENABLED', ...(st.standards[s].disabled[idIn(k, s)!] ? { DisabledReason: st.standards[s].disabled[idIn(k, s)!] } : {}), ControlStatusUpdatedAt: isoZ(st.standards[s].enabledAt), ControlId: idIn(k, s), Title: k.title, Description: k.title, RemediationUrl: `https://docs.aws.amazon.com/console/securityhub/${idIn(k, s)}/remediation`, SeverityRating: k.severity, RelatedRequirements: [] })) };
});
op('securityhub', 'update-standards-control', 'standards-control-arn:s! control-status:s disabled-reason:s', 'Desactiva o reactiva un control (al desactivarlo hay que dar el motivo).', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const m = /control\/(.+)\/v\/([\d.]+)\/(.+)$/.exec(String(c.p.StandardsControlArn));
  const s = (Object.keys(STD) as Std[]).find((x) => m && STD[x].code === m[1]);
  const k = s && controlsOf(s).find((x) => idIn(x, s) === m![3]);
  if (!s || !k || !st.standards[s]) throw notFound(`The control ${c.p.StandardsControlArn} does not exist.`);
  const status = String(c.p.ControlStatus ?? 'ENABLED');
  if (!['ENABLED', 'DISABLED'].includes(status)) throw invalid('ControlStatus must be ENABLED or DISABLED.');
  if (status === 'DISABLED') {
    if (!c.p.DisabledReason) throw invalid('You must provide a DisabledReason when you disable a control.');
    st.standards[s].disabled[m![3]] = String(c.p.DisabledReason);
  } else delete st.standards[s].disabled[m![3]];
  return {};
});

op('securityhub', 'list-enabled-products-for-import', 'next-token:s max-results:i', 'Productos cuyos hallazgos llegan a Security Hub.', { res: () => '*' }, (c) => ({ ProductSubscriptions: needHub(c).products.map((p) => mkArn('securityhub', c.region, c.acct.id, `product-subscription/aws/${p}`)) }));
op('securityhub', 'describe-products', 'next-token:s max-results:i product-arn:s', 'Productos que pueden enviar hallazgos.', { res: () => '*' }, (c) => ({ Products: PRODUCTS.map((p) => ({ ProductArn: productArn(c.region, p), ProductName: p === 'guardduty' ? 'GuardDuty' : p === 'inspector' ? 'Inspector' : p === 'macie' ? 'Macie' : 'IAM Access Analyzer', CompanyName: 'Amazon', Description: `Findings from ${p}`, IntegrationTypes: ['SEND_FINDINGS_TO_SECURITY_HUB'] })) }));
op('securityhub', 'enable-import-findings-for-product', 'product-arn:s!', 'Activa la llegada de hallazgos de un producto.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const p = PRODUCTS.find((x) => productArn(c.region, x) === c.p.ProductArn);
  if (!p) throw invalid(`The product ARN ${c.p.ProductArn} is not valid.`);
  if (st.products.includes(p)) throw new AwsError('ResourceConflictException', 'The product is already enabled.', 409);
  st.products.push(p);
  return { ProductSubscriptionArn: mkArn('securityhub', c.region, c.acct.id, `product-subscription/aws/${p}`) };
});
op('securityhub', 'disable-import-findings-for-product', 'product-subscription-arn:s!', 'Desactiva la llegada de hallazgos de un producto.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const p = PRODUCTS.find((x) => String(c.p.ProductSubscriptionArn).endsWith(`/aws/${x}`));
  if (!p || !st.products.includes(p)) throw notFound('The product subscription does not exist.');
  st.products = st.products.filter((x) => x !== p);
  return {};
});

op('securityhub', 'get-findings', 'filters:j sort-criteria:j next-token:s max-results:i', 'Los hallazgos de Security Hub en formato ASFF (controles y productos integrados).', { res: () => '*' }, (c) => {
  needHub(c);
  let list = hubFindings(c.acct, c.region).filter((f) => matches(f, c.p.Filters as never));
  const sort = toArr<{ Field?: string; SortOrder?: string }>(c.p.SortCriteria as never)[0];
  if (sort?.Field === 'SeverityNormalized' || !sort) list = list.sort((x, y) => (sort?.SortOrder === 'asc' ? 1 : -1) * (x.Severity.Normalized - y.Severity.Normalized));
  return { Findings: list.slice(0, Number(c.p.MaxResults ?? 100)) };
});
op('securityhub', 'batch-update-findings', 'finding-identifiers:j! note:j severity:j verification-state:s confidence:i criticality:i types:l user-defined-fields:j workflow:j related-findings:j', 'Cambia el flujo de trabajo (NEW, NOTIFIED, SUPPRESSED, RESOLVED), la nota o la gravedad de hallazgos.', { res: () => '*' }, (c) => {
  const st = needHub(c);
  const ids = toArr<{ Id: string; ProductArn: string }>(c.p.FindingIdentifiers as never);
  const all = new Set(hubFindings(c.acct, c.region).map((f) => f.Id));
  const wfS = (c.p.Workflow as { Status?: string } | undefined)?.Status;
  if (wfS && !['NEW', 'NOTIFIED', 'SUPPRESSED', 'RESOLVED'].includes(wfS)) throw invalid('Workflow Status must be NEW, NOTIFIED, SUPPRESSED or RESOLVED.');
  const sev = (c.p.Severity as { Label?: string } | undefined)?.Label;
  const note = c.p.Note as { Text?: string; UpdatedBy?: string } | undefined;
  const done: { Id: string; ProductArn: string }[] = [];
  const bad: { FindingIdentifier: { Id: string; ProductArn: string }; ErrorCode: string; ErrorMessage: string }[] = [];
  for (const i of ids) {
    if (!all.has(i.Id)) {
      bad.push({ FindingIdentifier: i, ErrorCode: 'FindingNotFound', ErrorMessage: 'The finding was not found.' });
      continue;
    }
    st.workflow[i.Id] = { ...(st.workflow[i.Id] ?? { Status: 'NEW', at: 0 }), ...(wfS ? { Status: wfS } : {}), ...(sev ? { Severity: sev } : {}), ...(note ? { Note: note.Text, UpdatedBy: note.UpdatedBy } : {}), at: c.acct.clock };
    done.push({ Id: i.Id, ProductArn: i.ProductArn });
  }
  return { ProcessedFindings: done, UnprocessedFindings: bad };
});

/** `_check securityhub`: resumen para el corrector. */
op('_check', 'securityhub', 'region:s', 'Resumen de Security Hub: estado de los estándares, controles fallidos y hallazgos importados.', { global: true, authz: false, anon: true }, (c) => {
  const out: Record<string, unknown> = {};
  for (const [region, rs] of Object.entries(c.acct.regions)) {
    const st = rs.securityhub;
    if (!st?.enabled || (c.p.Region && c.p.Region !== region)) continue;
    const list = hubFindings(c.acct, region);
    const failed = list.filter((f) => f.Compliance?.Status === 'FAILED' && f.Workflow.Status !== 'SUPPRESSED');
    out[region] = { Standards: Object.keys(st.standards), Ready: ready(c.acct, region), Failed: failed.length, FailedControls: [...new Set(failed.map((f) => f.ProductFields.ControlId))].sort(), Passed: list.filter((f) => f.Compliance?.Status === 'PASSED').length, Products: st.products, Imported: list.filter((f) => !f.Compliance && f.RecordState === 'ACTIVE').length, Suppressed: list.filter((f) => f.Workflow.Status === 'SUPPRESSED').length };
  }
  return out;
});
