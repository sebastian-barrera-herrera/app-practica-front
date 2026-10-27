/**
 * AWS CloudTrail: historial de eventos de la cuenta (cada llamada a la API), trails que los entregan a S3 y a CloudWatch Logs,
 * y los eventos «AWS API Call via CloudTrail» que reciben las reglas de EventBridge.
 */
import { regional } from '../account';
import { sha256 } from '../../engine/commands/hash';
import { AwsError, op, opHooks, Raw, SERVICE_PREFIX, type OpCtx, type OpOutcome } from '../registry';
import { tickers } from '../tick';
import type { Account, PolicyStatement } from '../types';
import type { CtEvent, CtSelector, CtState, CtTrail } from '../types-ops';
import { iso, isoZ, mkArn, newId, toArr, wildcard } from '../util';
import { putEvent } from './events';
import { roleCan, roleTrusts } from './flowlogs';
import { logsPut } from './logs';
import { s3Current, s3Put } from './s3';

export const ctOf = (a: Account): CtState => (a.ct ??= { events: [], trails: {}, seq: 0 });

const MAX_EVENTS = 800;
const WINDOW = 5 * 60000;
const HIDDEN = 'HIDDEN_DUE_TO_SECURITY_REASONS';

// ───────────────────────── clasificación de los eventos ─────────────────────────

/** `eventSource` de un servicio de la CLI (`cloudwatch` → `monitoring.amazonaws.com`). */
const SOURCE: Record<string, string> = { cloudwatch: 'monitoring', stepfunctions: 'states', apigatewayv2: 'apigateway', 's3api': 's3', elbv2: 'elasticloadbalancing', elb: 'elasticloadbalancing', 'cognito-idp': 'cognito-idp', deploy: 'codedeploy', ce: 'ce', resourcegroupstaggingapi: 'tagging' };
export const eventSourceOf = (service: string) => `${SOURCE[service] ?? SERVICE_PREFIX[service] ?? service}.amazonaws.com`;

const READ_ONLY = /^(Describe|List|Get|Head|Lookup|BatchGet|Query|Scan|Search|Select|Check|Validate|Test|Preview|Simulate|Decrypt|Encrypt|GenerateDataKey|GenerateRandom|Verify|ReEncrypt)/;
const GLOBAL = new Set(['iam', 'sts', 'organizations', 'route53', 'cloudfront', 'budgets', 'ce', 'support', 'globalaccelerator', 'configure']);

const S3_DATA = new Set(['get-object', 'put-object', 'delete-object', 'delete-objects', 'head-object', 'copy-object', 'upload-part', 'upload-part-copy', 'create-multipart-upload', 'complete-multipart-upload', 'abort-multipart-upload', 'get-object-acl', 'put-object-acl', 'get-object-tagging', 'put-object-tagging', 'restore-object', 'select-object-content']);
const DDB_DATA = new Set(['get-item', 'put-item', 'update-item', 'delete-item', 'batch-get-item', 'batch-write-item', 'query', 'scan', 'transact-get-items', 'transact-write-items']);

/** Nombre de la API tal como la registra CloudTrail (`s3 cp` no es una API: es `PutObject`, `GetObject`…). */
function eventName(c: OpCtx): string {
  if (c.service === 's3') {
    const paths = toArr<string>(c.p.Paths);
    const s3 = paths.filter((x) => x.startsWith('s3://'));
    switch (c.op.name) {
      case 'mb':
        return 'CreateBucket';
      case 'rb':
        return 'DeleteBucket';
      case 'ls':
        return s3.length ? 'ListObjects' : 'ListBuckets';
      case 'rm':
        return 'DeleteObject';
      case 'cp':
      case 'sync':
      case 'mv':
        return paths.length > 1 && s3.length === 1 && !paths[0].startsWith('s3://') ? 'PutObject' : paths[0]?.startsWith('s3://') && !paths[1]?.startsWith('s3://') ? 'GetObject' : 'CopyObject';
      default:
        return c.op.api;
    }
  }
  if (c.service === 's3api' && c.op.name === 'list-objects-v2') return 'ListObjects';
  if (c.service === 'lambda' && c.op.name === 'invoke') return 'Invoke';
  return c.op.api;
}

function dataResource(c: OpCtx, name: string): { type: string; arn: string } | null {
  if (c.service === 's3api' && S3_DATA.has(c.op.name)) return { type: 'AWS::S3::Object', arn: `arn:aws:s3:::${c.p.Bucket}/${c.p.Key ?? ''}` };
  if (c.service === 's3' && ['cp', 'mv', 'sync', 'rm'].includes(c.op.name)) {
    const p = toArr<string>(c.p.Paths).find((x) => x.startsWith('s3://'));
    if (p) return { type: 'AWS::S3::Object', arn: `arn:aws:s3:::${p.slice(5)}` };
  }
  if (c.service === 'lambda' && name === 'Invoke') {
    const fnName = String(c.p.FunctionName ?? '');
    return { type: 'AWS::Lambda::Function', arn: fnName.startsWith('arn:') ? fnName : mkArn('lambda', c.region, c.acct.id, `function:${fnName}`) };
  }
  if (c.service === 'dynamodb' && DDB_DATA.has(c.op.name)) return { type: 'AWS::DynamoDB::Table', arn: mkArn('dynamodb', c.region, c.acct.id, `table/${c.p.TableName ?? ''}`) };
  return null;
}

const TYPE_OF: Record<string, string> = {
  's3:': 'AWS::S3::Bucket',
  'ec2:instance': 'AWS::EC2::Instance',
  'ec2:volume': 'AWS::EC2::Volume',
  'ec2:security-group': 'AWS::EC2::SecurityGroup',
  'ec2:vpc': 'AWS::EC2::VPC',
  'ec2:subnet': 'AWS::EC2::Subnet',
  'ec2:image': 'AWS::EC2::AMI',
  'ec2:snapshot': 'AWS::EC2::Snapshot',
  'iam:user': 'AWS::IAM::User',
  'iam:role': 'AWS::IAM::Role',
  'iam:policy': 'AWS::IAM::Policy',
  'iam:group': 'AWS::IAM::Group',
  'lambda:function': 'AWS::Lambda::Function',
  'dynamodb:table': 'AWS::DynamoDB::Table',
  'sns:': 'AWS::SNS::Topic',
  'sqs:': 'AWS::SQS::Queue',
  'rds:db': 'AWS::RDS::DBInstance',
  'kms:key': 'AWS::KMS::Key',
  'logs:log-group': 'AWS::Logs::LogGroup',
  'secretsmanager:secret': 'AWS::SecretsManager::Secret',
  'cloudtrail:trail': 'AWS::CloudTrail::Trail',
};

function describeArn(arn: string): { type: string; name: string } | null {
  const m = /^arn:aws[a-z-]*:([a-z0-9-]+):[^:]*:[^:]*:(.*)$/.exec(arn);
  if (!m) return null;
  const [svc, rest] = [m[1], m[2]];
  if (rest === '*' || !rest) return null;
  if (svc === 's3') {
    const [bucket, ...key] = rest.split('/');
    return key.length ? { type: 'AWS::S3::Object', name: `${bucket}/${key.join('/')}` } : { type: 'AWS::S3::Bucket', name: bucket };
  }
  const [kind, ...tail] = rest.split(/[/:]/);
  const name = tail.length ? tail[tail.length - 1] : kind;
  const type = TYPE_OF[`${svc}:${tail.length ? kind : ''}`] ?? `AWS::${svc.toUpperCase()}::${tail.length ? kind[0].toUpperCase() + kind.slice(1) : 'Resource'}`;
  return { type, name: name.replace(/:\*$/, '') };
}

// ───────────────────────── el registro ─────────────────────────

const camel = (s: string) => s[0].toLowerCase() + s.slice(1);
const SENSITIVE = /password|secretstring|secretbinary|sessiontoken|securitytoken|privatekey|clientsecret/i;

function scrub(v: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE.test(key)) return HIDDEN;
  if (typeof v === 'string') return v.length > 400 ? v.slice(0, 200) + '…' : v;
  if (Array.isArray(v)) return depth > 4 ? [] : v.slice(0, 20).map((x) => scrub(x, key, depth + 1));
  if (v && typeof v === 'object') {
    if (depth > 4) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [camel(k), scrub(x, k, depth + 1)]));
  }
  return v;
}

const uuid = (a: Account, kind: string) => newId(a, kind, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

function identity(c: OpCtx): Record<string, unknown> {
  const k = c.caller;
  const a = c.acct;
  if (k.root || k.type === 'Account') return { type: 'Root', principalId: a.id, arn: `arn:aws:iam::${a.id}:root`, accountId: a.id, accessKeyId: k.accessKeyId };
  if (k.type === 'AssumedRole') {
    const role = k.roleName ?? k.arn.split('/')[1];
    return {
      type: 'AssumedRole',
      principalId: k.userId,
      arn: k.arn,
      accountId: a.id,
      accessKeyId: k.accessKeyId,
      sessionContext: { sessionIssuer: { type: 'Role', principalId: a.iam.roles[role]?.RoleId ?? k.userId.split(':')[0], arn: `arn:aws:iam::${a.id}:role/${role}`, accountId: a.id, userName: role }, attributes: { creationDate: isoZ(a.clock - 60000), mfaAuthenticated: String(k.mfa) } },
    };
  }
  return { type: 'IAMUser', principalId: k.userId, arn: k.arn, accountId: a.id, accessKeyId: k.accessKeyId, userName: k.userName };
}

const usernameOf = (c: OpCtx): string => (c.caller.root || c.caller.type === 'Account' ? 'root' : c.caller.type === 'AssumedRole' ? c.caller.sessionName ?? c.caller.arn.split('/').pop() ?? '' : c.caller.userName ?? '');

let depth = 0;

function record(c: OpCtx, o0: OpOutcome): void {
  const a = c.acct;
  let o = o0;
  // los comandos de alto nivel (`aws s3 …`) imprimen el error en lugar de lanzarlo
  if (!o.error && o.out instanceof Raw && o.out.code !== 0) {
    const m = /\((\w+)\) when calling the (\w+) operation: ([^\n]*)/.exec(o.out.stderr);
    if (m) o = { ...o, error: new AwsError(m[1], m[3].trim(), 403) };
  }
  const st = ctOf(a);
  const name = eventName(c);
  const source = eventSourceOf(c.service);
  const readOnly = READ_ONLY.test(name);
  const data = dataResource(c, name);
  // región donde queda anotado: los buckets, la suya; los servicios globales, us-east-1
  let region = c.region;
  if (GLOBAL.has(c.service) || (c.service !== 's3' && c.service !== 's3api' && c.op.global && c.service !== 'dynamodb')) region = 'us-east-1';
  const bucketName = c.service === 's3api' ? c.p.Bucket : c.service === 's3' ? toArr<string>(c.p.Paths).find((x) => x.startsWith('s3://'))?.slice(5).split('/')[0] : undefined;
  if (bucketName && a.s3.buckets[bucketName]) region = a.s3.buckets[bucketName].region;
  // recursos afectados
  let arns: string[] = [];
  try {
    const r = c.op.res?.(c);
    arns = r === undefined ? [] : toArr(r);
  } catch {
    arns = [];
  }
  if (!arns.length && bucketName) arns = [`arn:aws:s3:::${bucketName}`];
  const resources = [...(data ? [{ type: data.type, name: data.arn.replace(/^arn:aws:[a-z0-9]+:[^:]*:[^:]*:/, '') }] : []), ...arns.map(describeArn).filter((x): x is { type: string; name: string } => !!x)].slice(0, 5);
  const params = scrub(Object.fromEntries(Object.entries(c.p).filter(([k]) => !k.startsWith('$') && k !== 'Outfile'))) as Record<string, unknown>;
  if (c.service === 's3api' || c.service === 's3') {
    if ('bucket' in params) {
      params.bucketName = params.bucket;
      delete params.bucket;
      params.Host = `${params.bucketName}.s3.${region}.amazonaws.com`;
    }
    if (c.service === 's3') {
      const p = toArr<string>(c.p.Paths).find((x) => x.startsWith('s3://'));
      if (p) Object.assign(params, { bucketName: p.slice(5).split('/')[0], ...(p.slice(5).includes('/') ? { key: p.slice(5).split('/').slice(1).join('/') } : {}) });
      delete params.paths;
    }
  }
  if (c.service === 'ssm' && c.op.name === 'put-parameter' && 'value' in params) params.value = HIDDEN;
  let response: unknown = null;
  if (!readOnly && !o.error && o.out && typeof o.out === 'object') {
    const s = JSON.stringify(scrub(o.out));
    response = s.length <= 1200 ? JSON.parse(s) : null;
  }
  const sdk = o.via === 'sdk';
  const rec: Record<string, unknown> = {
    eventVersion: '1.10',
    userIdentity: identity(c),
    eventTime: isoZ(a.clock),
    eventSource: source,
    eventName: name,
    awsRegion: region,
    sourceIPAddress: sdk ? '3.236.12.45' : a.sourceIp,
    userAgent: sdk
      ? 'Boto3/1.34.144 md/Botocore#1.34.144 ua/2.0 os/linux#5.10.218 md/arch#x86_64 lang/python#3.12.3 md/pyimpl#CPython cfg/retry-mode#legacy Botocore/1.34.144 exec-env/AWS_Lambda_python3.12'
      : `aws-cli/2.17.5 md/awscrt#0.20.11 ua/2.0 os/linux#6.1.102 md/arch#x86_64 lang/python#3.11.9 md/pyimpl#CPython cfg/retry-mode#standard md/installer#exe md/distrib#amzn.2023 prompt/off command/${c.service}.${c.op.name}`,
    requestParameters: Object.keys(params).length ? params : null,
    responseElements: response,
    requestID: uuid(a, 'ctreq'),
    eventID: uuid(a, 'ctev'),
    readOnly,
    ...(data ? { resources: [{ accountId: a.id, type: data.type, ARN: data.arn }] } : {}),
    eventType: 'AwsApiCall',
    managementEvent: !data,
    recipientAccountId: a.id,
    eventCategory: data ? 'Data' : 'Management',
    tlsDetails: { tlsVersion: 'TLSv1.3', cipherSuite: 'TLS_AES_128_GCM_SHA256', clientProvidedHostHeader: `${(SOURCE[c.service] ?? SERVICE_PREFIX[c.service] ?? c.service)}.${region}.amazonaws.com` },
    ...(o.error ? { errorCode: o.error.code, errorMessage: o.error.message } : {}),
  };
  const ev: CtEvent = { id: String(rec.eventID), t: a.clock, region, source, name, readOnly, user: usernameOf(c), accessKeyId: c.caller.accessKeyId, resources, record: rec, ...(data ? { data: true } : {}) };
  st.events.push(ev);
  if (st.events.length > MAX_EVENTS) st.events.splice(0, st.events.length - MAX_EVENTS);
  deliver(a, ev, data?.type, data?.arn);
  // EventBridge solo recibe los eventos de gestión que escriben
  if (!readOnly && !data && depth < 2) {
    depth++;
    try {
      putEvent(a, region, 'default', { source: `aws.${source.replace('.amazonaws.com', '')}`, detailType: 'AWS API Call via CloudTrail', detail: rec });
    } catch {
      /* sin reglas */
    } finally {
      depth--;
    }
  }
}

opHooks.push(record);

// ───────────────────────── trails ─────────────────────────

const trailKey = (home: string, name: string) => `${home}|${name}`;
const trailArn = (a: Account, region: string, name: string) => mkArn('cloudtrail', region, a.id, `trail/${name}`);

const DEFAULT_SELECTOR: CtSelector = { ReadWriteType: 'All', IncludeManagementEvents: true, DataResources: [] };

function matchesTrail(t: CtTrail, ev: CtEvent, dataType?: string, dataArn?: string): boolean {
  if (!t.logging) return false;
  const isGlobal = ev.region === 'us-east-1' && GLOBAL.has(ev.source.replace('.amazonaws.com', '')) || ['iam.amazonaws.com', 'sts.amazonaws.com', 'organizations.amazonaws.com', 'route53.amazonaws.com', 'cloudfront.amazonaws.com'].includes(ev.source);
  if (isGlobal) {
    if (!t.IncludeGlobalServiceEvents) return false;
    if (!(t.IsMultiRegionTrail || t.HomeRegion === 'us-east-1')) return false;
  } else if (!t.IsMultiRegionTrail && ev.region !== t.HomeRegion) return false;
  const sels = t.selectors.length ? t.selectors : [DEFAULT_SELECTOR];
  return sels.some((s) => {
    const rw = s.ReadWriteType === 'All' || (s.ReadWriteType === 'ReadOnly') === ev.readOnly;
    if (!rw) return false;
    if (!dataType) return s.IncludeManagementEvents;
    return s.DataResources.some((d) => d.Type === dataType && d.Values.some((v) => dataArn!.startsWith(v === 'arn:aws:s3' ? 'arn:aws:s3:::' : v)));
  });
}

function deliver(a: Account, ev: CtEvent, dataType?: string, dataArn?: string): void {
  const st = ctOf(a);
  for (const t of Object.values(st.trails)) {
    if (!matchesTrail(t, ev, dataType, dataArn)) continue;
    t.pending.push(JSON.stringify(ev.record));
    if (t.CloudWatchLogsLogGroupArn) {
      const m = /^arn:aws:logs:([^:]+):\d+:log-group:(.+?)(?::\*)?$/.exec(t.CloudWatchLogsLogGroupArn);
      if (m) {
        logsPut(a, m[1], m[2], `${a.id}_CloudTrail_${ev.region}`, JSON.stringify(ev.record), ev.t);
        t.latestCloudWatchLogsDeliveryTime = a.clock;
      }
    }
  }
}

function policyStatements(doc: unknown): PolicyStatement[] {
  const s = (doc as { Statement?: PolicyStatement | PolicyStatement[] } | undefined)?.Statement;
  return s ? toArr(s) : [];
}

/** ¿Deja la política del bucket que CloudTrail lea la ACL y escriba en `AWSLogs/<cuenta>/`? */
export function bucketAllowsCloudTrail(a: Account, bucketName: string, prefix: string | undefined): boolean {
  const b = a.s3.buckets[bucketName];
  if (!b?.policy) return false;
  const stmts = policyStatements(b.policy).filter((s) => s.Effect === 'Allow' && toArr<string>((s.Principal as { Service?: string | string[] } | undefined)?.Service).includes('cloudtrail.amazonaws.com'));
  const acts = (s: PolicyStatement) => toArr<string>(s.Action as string | string[]).map((x) => x.toLowerCase());
  const res = (s: PolicyStatement) => toArr<string>(s.Resource as string | string[]);
  const acl = stmts.some((s) => (acts(s).includes('s3:getbucketacl') || acts(s).includes('s3:*')) && res(s).some((r) => wildcard(r, `arn:aws:s3:::${bucketName}`)));
  const target = `arn:aws:s3:::${bucketName}/${prefix ? prefix.replace(/\/$/, '') + '/' : ''}AWSLogs/${a.id}/x`;
  const put = stmts.some((s) => (acts(s).includes('s3:putobject') || acts(s).includes('s3:*')) && res(s).some((r) => wildcard(r, target)));
  return acl && put;
}

const trailView = (t: CtTrail) => ({
  Name: t.Name,
  S3BucketName: t.S3BucketName,
  ...(t.S3KeyPrefix ? { S3KeyPrefix: t.S3KeyPrefix } : {}),
  ...(t.SnsTopicName ? { SnsTopicName: t.SnsTopicName } : {}),
  IncludeGlobalServiceEvents: t.IncludeGlobalServiceEvents,
  IsMultiRegionTrail: t.IsMultiRegionTrail,
  HomeRegion: t.HomeRegion,
  TrailARN: t.TrailARN,
  LogFileValidationEnabled: t.LogFileValidationEnabled,
  ...(t.CloudWatchLogsLogGroupArn ? { CloudWatchLogsLogGroupArn: t.CloudWatchLogsLogGroupArn, CloudWatchLogsRoleArn: t.CloudWatchLogsRoleArn } : {}),
  ...(t.KmsKeyId ? { KmsKeyId: t.KmsKeyId } : {}),
  HasCustomEventSelectors: t.selectors.length > 0,
  HasInsightSelectors: !!t.insightSelectors?.length,
  IsOrganizationTrail: false,
});

function findTrail(c: OpCtx, ref: string): CtTrail {
  const st = ctOf(c.acct);
  const name = ref.startsWith('arn:') ? ref.split('/').pop()! : ref;
  const home = ref.startsWith('arn:') ? ref.split(':')[3] : c.region;
  const t = st.trails[trailKey(home, name)] ?? Object.values(st.trails).find((x) => x.Name === name && x.IsMultiRegionTrail);
  if (!t) throw new AwsError('TrailNotFoundException', `Unknown trail: ${ref} for the user: ${c.acct.id}`, 400);
  return t;
}

const trailRes = (c: OpCtx) => trailArn(c.acct, c.region, String(c.p.Name ?? '').split('/').pop()!);

op(
  'cloudtrail',
  'create-trail',
  'name:s! s3-bucket-name:s! s3-key-prefix:s sns-topic-name:s include-global-service-events:b is-multi-region-trail:b enable-log-file-validation:b cloud-watch-logs-log-group-arn:s cloud-watch-logs-role-arn:s kms-key-id:s is-organization-trail:b tags-list:f',
  'Crea un trail: entrega a un bucket de S3 (y opcionalmente a CloudWatch Logs) los eventos de la cuenta. No empieza a registrar hasta `start-logging`.',
  { res: trailRes, action: 'cloudtrail:CreateTrail' },
  (c) => {
    const st = ctOf(c.acct);
    const name = String(c.p.Name);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(name) || /[._-]{2}/.test(name)) throw new AwsError('InvalidTrailNameException', `Trail name is invalid: ${name}. It must be between 3 and 128 characters, start with a letter or number and contain only letters, numbers, periods, underscores and dashes.`, 400);
    if (st.trails[trailKey(c.region, name)] || Object.values(st.trails).some((t) => t.Name === name && t.IsMultiRegionTrail)) throw new AwsError('TrailAlreadyExistsException', `Trail ${name} already exists for customer: ${c.acct.id}`, 400);
    if (Object.values(st.trails).filter((t) => t.HomeRegion === c.region).length >= 5) throw new AwsError('MaximumNumberOfTrailsExceededException', 'Maximum number of trails exceeded: you can have up to 5 trails per region.', 400);
    const bucket = String(c.p.S3BucketName);
    const b = c.acct.s3.buckets[bucket];
    if (!b) throw new AwsError('S3BucketDoesNotExistException', `S3 bucket ${bucket} does not exist.`, 400);
    if (!bucketAllowsCloudTrail(c.acct, bucket, c.p.S3KeyPrefix)) throw new AwsError('InsufficientS3BucketPolicyException', `Incorrect S3 bucket policy is detected for bucket: ${bucket}`, 400);
    const grp = c.p.CloudWatchLogsLogGroupArn as string | undefined;
    const role = c.p.CloudWatchLogsRoleArn as string | undefined;
    if (!!grp !== !!role) throw new AwsError('InvalidParameterCombinationException', 'Both CloudWatchLogsLogGroupArn and CloudWatchLogsRoleArn must be specified together.', 400);
    if (grp && role) {
      const m = /^arn:aws:logs:([^:]+):\d+:log-group:(.+?)(?::\*)?$/.exec(grp);
      if (!m) throw new AwsError('InvalidCloudWatchLogsLogGroupArnException', `Access denied. Check the permissions of the role. The log group ARN is not valid: ${grp}`, 400);
      if (!regional(c.acct, m[1]).logs?.groups[m[2]]) throw new AwsError('InvalidCloudWatchLogsLogGroupArnException', `The log group ${m[2]} does not exist.`, 400);
      if (!roleTrusts(c.acct, role, 'cloudtrail.amazonaws.com') || !roleCan(c.acct, role, ['logs:CreateLogStream', 'logs:PutLogEvents'])) throw new AwsError('InvalidCloudWatchLogsRoleArnException', 'Access denied. Check the permissions of the role: it must trust cloudtrail.amazonaws.com and allow logs:CreateLogStream and logs:PutLogEvents.', 400);
    }
    const t: CtTrail = {
      Name: name,
      TrailARN: trailArn(c.acct, c.region, name),
      S3BucketName: bucket,
      ...(c.p.S3KeyPrefix ? { S3KeyPrefix: String(c.p.S3KeyPrefix).replace(/\/$/, '') } : {}),
      IncludeGlobalServiceEvents: c.p.IncludeGlobalServiceEvents !== false,
      IsMultiRegionTrail: c.p.IsMultiRegionTrail === true,
      HomeRegion: c.region,
      LogFileValidationEnabled: c.p.EnableLogFileValidation === true,
      ...(c.p.KmsKeyId ? { KmsKeyId: String(c.p.KmsKeyId) } : {}),
      ...(grp ? { CloudWatchLogsLogGroupArn: grp, CloudWatchLogsRoleArn: role } : {}),
      ...(c.p.SnsTopicName ? { SnsTopicName: String(c.p.SnsTopicName) } : {}),
      logging: false,
      pending: [],
      selectors: [],
      tags: Object.fromEntries(toArr<{ Key: string; Value: string }>(c.p.TagsList).map((x) => [x.Key, x.Value])),
      created: c.acct.clock,
    };
    st.trails[trailKey(c.region, name)] = t;
    return trailView(t);
  },
);

op('cloudtrail', 'start-logging', 'name:s!', 'Empieza a registrar eventos en el trail.', { res: trailRes, action: 'cloudtrail:StartLogging' }, (c) => {
  const t = findTrail(c, c.p.Name);
  if (!t.logging) {
    t.logging = true;
    t.startLoggingTime = c.acct.clock;
    t.latestDeliveryError = undefined;
  }
  return {};
});

op('cloudtrail', 'stop-logging', 'name:s!', 'Deja de registrar eventos en el trail (los ya entregados se quedan).', { res: trailRes, action: 'cloudtrail:StopLogging' }, (c) => {
  const t = findTrail(c, c.p.Name);
  if (t.logging) {
    t.logging = false;
    t.stopLoggingTime = c.acct.clock;
  }
  return {};
});

op('cloudtrail', 'delete-trail', 'name:s!', 'Borra un trail (no borra los registros que ya entregó).', { res: trailRes, action: 'cloudtrail:DeleteTrail' }, (c) => {
  const t = findTrail(c, c.p.Name);
  delete ctOf(c.acct).trails[trailKey(t.HomeRegion, t.Name)];
  return {};
});

op('cloudtrail', 'describe-trails', 'trail-name-list:l include-shadow-trails:b', 'Lista los trails de la región (y las réplicas de trails multirregión).', { res: () => '*', action: 'cloudtrail:DescribeTrails' }, (c) => {
  const list = Object.values(ctOf(c.acct).trails).filter((t) => (t.HomeRegion === c.region || (c.p.IncludeShadowTrails !== false && t.IsMultiRegionTrail)) && (!c.p.TrailNameList || (c.p.TrailNameList as string[]).some((n) => n === t.Name || n === t.TrailARN)));
  return { trailList: list.map((t) => trailView(t)) };
});

op('cloudtrail', 'list-trails', '', 'Lista los trails de la cuenta con su región de origen.', { res: () => '*', action: 'cloudtrail:ListTrails' }, (c) => ({ Trails: Object.values(ctOf(c.acct).trails).map((t) => ({ TrailARN: t.TrailARN, Name: t.Name, HomeRegion: t.HomeRegion })) }));

op('cloudtrail', 'get-trail-status', 'name:s!', 'Estado del trail: si registra y cuándo entregó por última vez (o por qué falla).', { res: trailRes, action: 'cloudtrail:GetTrailStatus' }, (c) => {
  const t = findTrail(c, c.p.Name);
  return {
    IsLogging: t.logging,
    ...(t.latestDeliveryTime ? { LatestDeliveryTime: iso(t.latestDeliveryTime), LatestNotificationTime: iso(t.latestDeliveryTime) } : {}),
    ...(t.latestDeliveryError ? { LatestDeliveryError: t.latestDeliveryError, LatestDeliveryAttemptTime: iso(c.acct.clock) } : {}),
    ...(t.latestCloudWatchLogsDeliveryTime ? { LatestCloudWatchLogsDeliveryTime: iso(t.latestCloudWatchLogsDeliveryTime) } : {}),
    ...(t.startLoggingTime ? { StartLoggingTime: iso(t.startLoggingTime), TimeLoggingStarted: isoZ(t.startLoggingTime) } : {}),
    ...(t.stopLoggingTime ? { StopLoggingTime: iso(t.stopLoggingTime), TimeLoggingStopped: isoZ(t.stopLoggingTime) } : {}),
    ...(t.LogFileValidationEnabled && t.latestDeliveryTime ? { LatestDigestDeliveryTime: iso(t.latestDeliveryTime) } : {}),
  };
});

op(
  'cloudtrail',
  'update-trail',
  'name:s! s3-bucket-name:s s3-key-prefix:s include-global-service-events:b is-multi-region-trail:b enable-log-file-validation:b cloud-watch-logs-log-group-arn:s cloud-watch-logs-role-arn:s kms-key-id:s',
  'Cambia la configuración de un trail.',
  { res: trailRes, action: 'cloudtrail:UpdateTrail' },
  (c) => {
    const t = findTrail(c, c.p.Name);
    if (c.p.S3BucketName) {
      const prefix = c.p.S3KeyPrefix ?? t.S3KeyPrefix;
      if (!c.acct.s3.buckets[c.p.S3BucketName]) throw new AwsError('S3BucketDoesNotExistException', `S3 bucket ${c.p.S3BucketName} does not exist.`, 400);
      if (!bucketAllowsCloudTrail(c.acct, c.p.S3BucketName, prefix)) throw new AwsError('InsufficientS3BucketPolicyException', `Incorrect S3 bucket policy is detected for bucket: ${c.p.S3BucketName}`, 400);
      t.S3BucketName = c.p.S3BucketName;
    }
    if (c.p.S3KeyPrefix !== undefined) t.S3KeyPrefix = String(c.p.S3KeyPrefix).replace(/\/$/, '') || undefined;
    if (c.p.IncludeGlobalServiceEvents !== undefined) t.IncludeGlobalServiceEvents = c.p.IncludeGlobalServiceEvents;
    if (c.p.IsMultiRegionTrail !== undefined) t.IsMultiRegionTrail = c.p.IsMultiRegionTrail;
    if (c.p.EnableLogFileValidation !== undefined) t.LogFileValidationEnabled = c.p.EnableLogFileValidation;
    if (c.p.KmsKeyId !== undefined) t.KmsKeyId = c.p.KmsKeyId || undefined;
    if (c.p.CloudWatchLogsLogGroupArn) {
      t.CloudWatchLogsLogGroupArn = c.p.CloudWatchLogsLogGroupArn;
      t.CloudWatchLogsRoleArn = c.p.CloudWatchLogsRoleArn;
    }
    return trailView(t);
  },
);

const selectorView = (s: CtSelector) => ({ ReadWriteType: s.ReadWriteType, IncludeManagementEvents: s.IncludeManagementEvents, DataResources: s.DataResources, ExcludeManagementEventSources: [] as string[] });

op('cloudtrail', 'get-event-selectors', 'trail-name:s!', 'Qué eventos registra el trail: gestión (lectura/escritura) y de datos (objetos de S3, funciones Lambda…).', { res: (c) => trailArn(c.acct, c.region, String(c.p.TrailName).split('/').pop()!), action: 'cloudtrail:GetEventSelectors' }, (c) => {
  const t = findTrail(c, c.p.TrailName);
  return { TrailARN: t.TrailARN, EventSelectors: (t.selectors.length ? t.selectors : [DEFAULT_SELECTOR]).map(selectorView) };
});

op('cloudtrail', 'put-event-selectors', 'trail-name:s! event-selectors:f!', 'Define qué eventos registra el trail, incluidos los de datos (cuestan aparte).', { res: (c) => trailArn(c.acct, c.region, String(c.p.TrailName).split('/').pop()!), action: 'cloudtrail:PutEventSelectors' }, (c) => {
  const t = findTrail(c, c.p.TrailName);
  const sels = (c.p.EventSelectors as Record<string, any>[]).map((s) => {
    const rw = s.ReadWriteType ?? 'All';
    if (!['All', 'ReadOnly', 'WriteOnly'].includes(rw)) throw new AwsError('InvalidEventSelectorsException', `ReadWriteType must be one of All, ReadOnly or WriteOnly: ${rw}`, 400);
    for (const d of s.DataResources ?? []) if (!['AWS::S3::Object', 'AWS::Lambda::Function', 'AWS::DynamoDB::Table'].includes(d.Type)) throw new AwsError('InvalidEventSelectorsException', `Unsupported data resource type: ${d.Type}`, 400);
    return { ReadWriteType: rw, IncludeManagementEvents: s.IncludeManagementEvents !== false, DataResources: (s.DataResources ?? []).map((d: { Type: string; Values?: string[] }) => ({ Type: d.Type, Values: d.Values ?? [] })) } as CtSelector;
  });
  if (!sels.length) throw new AwsError('InvalidEventSelectorsException', 'At least one event selector is required.', 400);
  t.selectors = sels;
  return { TrailARN: t.TrailARN, EventSelectors: sels.map(selectorView) };
});

// ───────────────────────── historial de eventos ─────────────────────────

const KEYS = ['EventId', 'EventName', 'ReadOnly', 'Username', 'ResourceType', 'ResourceName', 'EventSource', 'AccessKeyId'];

op('cloudtrail', 'lookup-events', 'lookup-attributes:f start-time:s end-time:s event-category:s max-results:i next-token:s', 'Busca en el historial de 90 días: quién hizo qué y cuándo (por nombre de evento, usuario, recurso…).', { paginate: 'Events', res: () => '*', action: 'cloudtrail:LookupEvents' }, (c) => {
  const attrs = (c.p.LookupAttributes ?? []) as { AttributeKey: string; AttributeValue: string }[];
  if (attrs.length > 1) throw new AwsError('InvalidLookupAttributesException', 'Please specify only one lookup attribute.', 400);
  const at = attrs[0];
  if (at) {
    if (!KEYS.includes(at.AttributeKey)) throw new AwsError('InvalidLookupAttributesException', `Invalid lookup attribute key: ${at.AttributeKey}. Valid keys: ${KEYS.join(', ')}.`, 400);
    if (at.AttributeValue === undefined || at.AttributeValue === '') throw new AwsError('InvalidLookupAttributesException', 'AttributeValue must be specified.', 400);
  }
  if (c.p.EventCategory && c.p.EventCategory !== 'insight' && c.p.EventCategory !== 'management') throw new AwsError('InvalidEventCategoryException', `Invalid event category: ${c.p.EventCategory}.`, 400);
  const from = c.p.StartTime ? Date.parse(String(c.p.StartTime)) : -Infinity;
  const to = c.p.EndTime ? Date.parse(String(c.p.EndTime)) : Infinity;
  if (from > to) throw new AwsError('InvalidTimeRangeException', 'Start time must be before end time.', 400);
  if (c.p.EventCategory === 'insight') return { Events: [] };
  const match = (e: CtEvent): boolean => {
    if (!at) return true;
    const v = at.AttributeValue;
    switch (at.AttributeKey) {
      case 'EventId':
        return e.id === v;
      case 'EventName':
        return e.name === v;
      case 'ReadOnly':
        return String(e.readOnly) === v.toLowerCase();
      case 'Username':
        return e.user === v;
      case 'ResourceType':
        return e.resources.some((r) => r.type === v);
      case 'ResourceName':
        return e.resources.some((r) => r.name === v);
      case 'EventSource':
        return e.source === v;
      default:
        return e.accessKeyId === v;
    }
  };
  const all = ctOf(c.acct).events.filter((e) => !e.data && e.region === c.region && e.t >= from && e.t <= to && match(e)).reverse();
  const start = c.p.NextToken ? Number(atob(String(c.p.NextToken))) || 0 : 0;
  const size = Math.min(50, c.p.MaxResults ?? 50);
  const page = all.slice(start, start + size);
  return {
    Events: page.map((e) => ({
      EventId: e.id,
      EventName: e.name,
      ReadOnly: String(e.readOnly),
      AccessKeyId: e.accessKeyId,
      EventTime: iso(e.t),
      EventSource: e.source,
      Username: e.user,
      Resources: e.resources.map((r) => ({ ResourceType: r.type, ResourceName: r.name })),
      CloudTrailEvent: JSON.stringify(e.record),
    })),
    ...(start + size < all.length ? { NextToken: btoa(String(start + size)) } : {}),
  };
});

// ───────────────────────── entrega a S3 ─────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`;
};

/** Cada 5 minutos de reloj virtual, los eventos acumulados se vuelcan en el bucket del trail. */
tickers.push((a) => {
  const st = a.ct;
  if (!st) return;
  for (const t of Object.values(st.trails)) {
    if (!t.pending.length) continue;
    const groups = new Map<string, { region: string; end: number; recs: string[] }>();
    const rest: string[] = [];
    for (const raw of t.pending) {
      const rec = JSON.parse(raw) as { eventTime: string; awsRegion: string };
      const when = Date.parse(rec.eventTime);
      const end = (Math.floor(when / WINDOW) + 1) * WINDOW;
      if (end > a.clock) {
        rest.push(raw);
        continue;
      }
      const key = `${rec.awsRegion}|${end}`;
      if (!groups.has(key)) groups.set(key, { region: rec.awsRegion, end, recs: [] });
      groups.get(key)!.recs.push(raw);
    }
    if (!groups.size) continue;
    const bucket = a.s3.buckets[t.S3BucketName];
    t.pending = rest;
    if (!bucket || !bucketAllowsCloudTrail(a, t.S3BucketName, t.S3KeyPrefix)) {
      t.latestDeliveryError = bucket ? 'AccessDenied' : 'NoSuchBucket';
      continue;
    }
    t.latestDeliveryError = undefined;
    const pre = t.S3KeyPrefix ? `${t.S3KeyPrefix}/` : '';
    for (const g of [...groups.values()].sort((x, y) => x.end - y.end)) {
      const d = new Date(g.end);
      const dir = `${pre}AWSLogs/${a.id}/CloudTrail/${g.region}/${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}`;
      const key = `${dir}/${a.id}_CloudTrail_${g.region}_${stamp(g.end)}_${sha256(t.Name + g.end + g.region).slice(0, 16)}.json.gz`;
      const body = JSON.stringify({ Records: g.recs.map((r) => JSON.parse(r)) });
      s3Put(a, bucket, key, body, { contentType: 'application/x-gzip', mtime: g.end });
      t.latestDeliveryTime = g.end;
      if (t.LogFileValidationEnabled) {
        const dig = `${pre}AWSLogs/${a.id}/CloudTrail-Digest/${g.region}/${d.getUTCFullYear()}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCDate())}/${a.id}_CloudTrail-Digest_${g.region}_${t.Name}_${g.region}_${stamp(g.end)}.json.gz`;
        const digest = {
          awsAccountId: a.id,
          digestStartTime: isoZ(g.end - WINDOW),
          digestEndTime: isoZ(g.end),
          digestS3Bucket: t.S3BucketName,
          digestS3Object: dig,
          digestPublicKeyFingerprint: '4d8c6a29b5e1f0a3c7d2e9b8a1f6c0d3',
          digestSignatureAlgorithm: 'SHA256withRSA',
          newestEventTime: isoZ(g.end - 1000),
          oldestEventTime: isoZ(g.end - WINDOW),
          previousDigestS3Bucket: null,
          logFiles: [{ s3Bucket: t.S3BucketName, s3Object: key, hashValue: sha256(body), hashAlgorithm: 'SHA-256', newestEventTime: isoZ(g.end - 1000), oldestEventTime: isoZ(g.end - WINDOW) }],
        };
        s3Put(a, bucket, dig, JSON.stringify(digest), { contentType: 'application/x-gzip', mtime: g.end });
      }
    }
  }
});

// ───────────────────────── validate-logs ─────────────────────────

op('cloudtrail', 'validate-logs', 'trail-arn:s! start-time:s! end-time:s verbose:b', 'Comprueba con los resúmenes (digest) que nadie ha tocado los archivos de log entregados.', { res: () => '*', action: 'cloudtrail:GetTrail' }, (c) => {
  const t = findTrail(c, c.p.TrailArn);
  const from = Date.parse(String(c.p.StartTime));
  if (Number.isNaN(from)) return new Raw('', `\nInvalid value for --start-time: ${c.p.StartTime}\n`, 255);
  const to = c.p.EndTime ? Date.parse(String(c.p.EndTime)) : c.acct.clock;
  if (!t.LogFileValidationEnabled) return new Raw('', `\nTrail ${t.TrailARN} does not have log file validation enabled: nothing to validate.\n`, 255);
  const bucket = c.acct.s3.buckets[t.S3BucketName];
  const lines: string[] = [`Validating log files for trail ${t.TrailARN} between ${isoZ(from)} and ${isoZ(to)}`, '', `Results requested for ${isoZ(from)} to ${isoZ(to)}`];
  let digests = 0;
  let valid = 0;
  let logs = 0;
  const bad: string[] = [];
  const missing: string[] = [];
  for (const [key, versions] of Object.entries(bucket?.objects ?? {})) {
    if (!key.includes('/CloudTrail-Digest/')) continue;
    const cur = versions[versions.length - 1];
    if (!cur || cur.deleteMarker) continue;
    const dg = JSON.parse(cur.body ?? '{}') as { digestEndTime: string; logFiles: { s3Object: string; hashValue: string }[] };
    const end = Date.parse(dg.digestEndTime);
    if (end < from || end > to) continue;
    digests++;
    for (const lf of dg.logFiles) {
      logs++;
      const obj = bucket ? s3Current(bucket, lf.s3Object) : undefined;
      if (!obj) missing.push(`Log file\ts3://${t.S3BucketName}/${lf.s3Object}\tINVALID: not found`);
      else if (sha256(obj.body ?? '') !== lf.hashValue) bad.push(`Log file\ts3://${t.S3BucketName}/${lf.s3Object}\tINVALID: hash value doesn't match`);
      else valid++;
    }
  }
  if (!digests) lines.push('No digest files found in the requested time range.');
  else lines.push(`Results found for ${isoZ(from)} to ${isoZ(to)}:`, '', `${digests}/${digests} digest files valid`, `${valid}/${logs} log files valid`, ...(bad.length || missing.length ? [`${bad.length + missing.length}/${logs} log files INVALID`] : []), ...bad, ...missing);
  return new Raw(lines.join('\n') + '\n', '', bad.length || missing.length ? 1 : 0);
});
