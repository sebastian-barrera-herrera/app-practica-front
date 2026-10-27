/** Los tipos de recurso que CloudFormation sabe crear en el simulador: cada uno delega en las operaciones de su servicio. */
import { makeZip } from '../../engine/commands/archive';
import { sdkCall } from '../sdk';
import type { Caller } from '../registry';
import type { Account, Rec } from '../types';
import { stableId } from '../util';

/** Motivo de fallo de un recurso (sale en `ResourceStatusReason`). */
export class CfnFail extends Error {}

export interface RCtx {
  a: Account;
  region: string;
  caller: Caller | null;
  stackName: string;
  logicalId: string;
  /** Nombre físico actual (en actualizaciones y borrados). */
  call(service: string, op: string, params?: Rec): Rec;
}

export interface RType {
  /** Propiedades que el tipo admite (el resto da «Encountered unsupported property»). */
  allowed: string[];
  /** Las que se cambian sin sustituir el recurso. Cambiar cualquier otra obliga a crear uno nuevo. */
  mutable: string[];
  /** Propiedad que contiene el nombre físico (si el usuario la fija, no se puede sustituir el recurso). */
  nameProp?: string;
  /** Segundos que tarda en crearse (para los eventos). */
  secs: number;
  /** Requiere `CAPABILITY_IAM`. */
  iam?: boolean;
  /** Es un recurso «de verdad» o solo un marcador (`AWS::CDK::Metadata`). */
  create(r: RCtx, props: Rec, name: string): { id: string; attrs?: Record<string, string> };
  update?(r: RCtx, id: string, oldProps: Rec, next: Rec): void;
  delete(r: RCtx, id: string, props: Rec): void;
  /** Lo que hay ahora en la cuenta, para detectar deriva: solo las propiedades que se comparan. */
  actual?(r: RCtx, id: string, props: Rec): Rec | null;
  /** Longitud máxima del nombre generado y si va en minúsculas. */
  nameMax?: number;
  lower?: boolean;
}

const svcName = (s: string) => ({ s3api: 'S3', dynamodb: 'DynamoDb', sqs: 'Sqs', sns: 'Sns', lambda: 'Lambda', iam: 'Iam', ec2: 'Ec2', logs: 'CloudWatchLogs', apigatewayv2: 'ApiGatewayV2' })[s] ?? s;

export function makeCall(a: Account, region: string, caller: Caller | null): RCtx['call'] {
  return (service, op, params = {}) => {
    const res = sdkCall(a, region, caller, service, op, params);
    if (!res.ok) throw new CfnFail(`Resource handler returned message: "${res.error!.Message} (Service: ${svcName(service)}, Status Code: ${res.error!.Status}, Error Code: ${res.error!.Code})"`);
    return res.data ?? {};
  };
}

export const genName = (stack: string, logical: string, o: { max?: number; lower?: boolean } = {}): string => {
  const rand = stableId(`${stack}:${logical}:${Math.random()}`, '', 12, o.lower ? 'hex' : 'up');
  const max = o.max ?? 64;
  const head = `${stack}-${logical}`.slice(0, Math.max(1, max - 13));
  const n = `${head}-${rand}`;
  return o.lower ? n.toLowerCase() : n;
};

const j = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
const tagList = (v: unknown): { Key: string; Value: string }[] => (Array.isArray(v) ? (v as { Key: string; Value: string }[]).map((t) => ({ Key: String(t.Key), Value: String(t.Value) })) : []);
const tagMap = (v: unknown): Record<string, string> => Object.fromEntries(tagList(v).map((t) => [t.Key, t.Value]));
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const sortTags = (t: { Key: string; Value: string }[]) => [...t].sort((x, y) => x.Key.localeCompare(y.Key));
const accountOf = (r: RCtx) => r.a.id;

// ───────────────────────── S3 ─────────────────────────

const bucket: RType = {
  allowed: ['BucketName', 'VersioningConfiguration', 'Tags', 'PublicAccessBlockConfiguration', 'AccessControl', 'BucketEncryption', 'LifecycleConfiguration', 'NotificationConfiguration', 'CorsConfiguration', 'WebsiteConfiguration', 'OwnershipControls', 'LoggingConfiguration', 'ObjectLockEnabled'],
  mutable: ['VersioningConfiguration', 'Tags', 'PublicAccessBlockConfiguration', 'AccessControl', 'BucketEncryption', 'LifecycleConfiguration', 'NotificationConfiguration', 'CorsConfiguration', 'WebsiteConfiguration', 'OwnershipControls', 'LoggingConfiguration'],
  nameProp: 'BucketName',
  secs: 6,
  nameMax: 63,
  lower: true,
  create(r, p, name) {
    try {
      r.call('s3api', 'create-bucket', { Bucket: name });
    } catch (e) {
      if (e instanceof CfnFail && /BucketAlready/.test(e.message)) throw new CfnFail(`${name} already exists`);
      throw e;
    }
    const v = (p.VersioningConfiguration as Rec | undefined)?.Status;
    if (v) r.call('s3api', 'put-bucket-versioning', { Bucket: name, VersioningConfiguration: { Status: v } });
    if (Array.isArray(p.Tags) && p.Tags.length) r.call('s3api', 'put-bucket-tagging', { Bucket: name, Tagging: { TagSet: tagList(p.Tags) } });
    return { id: name, attrs: bucketAttrs(name, r.region) };
  },
  update(r, id, old, next) {
    const v = (next.VersioningConfiguration as Rec | undefined)?.Status;
    if (v !== (old.VersioningConfiguration as Rec | undefined)?.Status && v) r.call('s3api', 'put-bucket-versioning', { Bucket: id, VersioningConfiguration: { Status: v } });
    if (!same(old.Tags, next.Tags)) {
      if (Array.isArray(next.Tags) && next.Tags.length) r.call('s3api', 'put-bucket-tagging', { Bucket: id, Tagging: { TagSet: tagList(next.Tags) } });
      else r.call('s3api', 'delete-bucket-tagging', { Bucket: id });
    }
  },
  delete: (r, id) => void r.call('s3api', 'delete-bucket', { Bucket: id }),
  actual(r, id, p) {
    const b = r.a.s3.buckets[id];
    if (!b) return null;
    const out: Rec = {};
    if (p.VersioningConfiguration) out.VersioningConfiguration = { Status: b.versioning || 'Suspended' };
    if (p.Tags) out.Tags = sortTags(b.tags);
    return out;
  },
};
const bucketAttrs = (name: string, region: string) => ({ Arn: `arn:aws:s3:::${name}`, DomainName: `${name}.s3.amazonaws.com`, RegionalDomainName: `${name}.s3.${region}.amazonaws.com`, WebsiteURL: `http://${name}.s3-website-${region}.amazonaws.com` });

// ───────────────────────── DynamoDB ─────────────────────────

const table: RType = {
  allowed: ['TableName', 'AttributeDefinitions', 'KeySchema', 'BillingMode', 'ProvisionedThroughput', 'GlobalSecondaryIndexes', 'StreamSpecification', 'TimeToLiveSpecification', 'PointInTimeRecoverySpecification', 'DeletionProtectionEnabled', 'Tags', 'LocalSecondaryIndexes', 'SSESpecification', 'TableClass'],
  mutable: ['AttributeDefinitions', 'BillingMode', 'ProvisionedThroughput', 'GlobalSecondaryIndexes', 'StreamSpecification', 'TimeToLiveSpecification', 'PointInTimeRecoverySpecification', 'DeletionProtectionEnabled', 'Tags', 'SSESpecification', 'TableClass'],
  nameProp: 'TableName',
  secs: 14,
  create(r, p, name) {
    const billing = (p.BillingMode as string | undefined) ?? (p.ProvisionedThroughput ? 'PROVISIONED' : 'PAY_PER_REQUEST');
    const params: Rec = { TableName: name, AttributeDefinitions: p.AttributeDefinitions, KeySchema: p.KeySchema, BillingMode: billing };
    if (p.ProvisionedThroughput) params.ProvisionedThroughput = p.ProvisionedThroughput;
    if (p.GlobalSecondaryIndexes) params.GlobalSecondaryIndexes = p.GlobalSecondaryIndexes;
    if (p.LocalSecondaryIndexes) params.LocalSecondaryIndexes = p.LocalSecondaryIndexes;
    if (p.StreamSpecification) params.StreamSpecification = { StreamEnabled: true, StreamViewType: (p.StreamSpecification as Rec).StreamViewType };
    if (Array.isArray(p.Tags)) params.Tags = tagList(p.Tags);
    if (p.DeletionProtectionEnabled !== undefined) params.DeletionProtectionEnabled = p.DeletionProtectionEnabled === true || p.DeletionProtectionEnabled === 'true';
    const out = r.call('dynamodb', 'create-table', params);
    const ttl = p.TimeToLiveSpecification as Rec | undefined;
    if (ttl) r.call('dynamodb', 'update-time-to-live', { TableName: name, TimeToLiveSpecification: { Enabled: ttl.Enabled === true || ttl.Enabled === 'true', AttributeName: ttl.AttributeName } });
    const pitr = p.PointInTimeRecoverySpecification as Rec | undefined;
    if (pitr) r.call('dynamodb', 'update-continuous-backups', { TableName: name, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: pitr.PointInTimeRecoveryEnabled === true || pitr.PointInTimeRecoveryEnabled === 'true' } });
    const desc = (out.TableDescription ?? {}) as Rec;
    return { id: name, attrs: { Arn: String(desc.TableArn ?? `arn:aws:dynamodb:${r.region}:${accountOf(r)}:table/${name}`), ...(desc.LatestStreamArn ? { StreamArn: String(desc.LatestStreamArn) } : {}) } };
  },
  update(r, id, old, next) {
    const upd: Rec = { TableName: id };
    if (next.BillingMode !== old.BillingMode || !same(old.ProvisionedThroughput, next.ProvisionedThroughput)) {
      upd.BillingMode = (next.BillingMode as string | undefined) ?? (next.ProvisionedThroughput ? 'PROVISIONED' : 'PAY_PER_REQUEST');
      if (next.ProvisionedThroughput) upd.ProvisionedThroughput = next.ProvisionedThroughput;
    }
    if (!same(old.StreamSpecification, next.StreamSpecification)) upd.StreamSpecification = next.StreamSpecification ? { StreamEnabled: true, StreamViewType: (next.StreamSpecification as Rec).StreamViewType } : { StreamEnabled: false };
    if (next.DeletionProtectionEnabled !== old.DeletionProtectionEnabled) upd.DeletionProtectionEnabled = next.DeletionProtectionEnabled === true || next.DeletionProtectionEnabled === 'true';
    if (Object.keys(upd).length > 1) r.call('dynamodb', 'update-table', upd);
    // índices secundarios globales: uno cada vez
    const oldG = ((old.GlobalSecondaryIndexes as Rec[] | undefined) ?? []).map((g) => String(g.IndexName));
    const newG = (next.GlobalSecondaryIndexes as Rec[] | undefined) ?? [];
    for (const g of newG.filter((x) => !oldG.includes(String(x.IndexName)))) r.call('dynamodb', 'update-table', { TableName: id, AttributeDefinitions: next.AttributeDefinitions, GlobalSecondaryIndexUpdates: [{ Create: g }] });
    for (const n of oldG.filter((x) => !newG.some((g) => g.IndexName === x))) r.call('dynamodb', 'update-table', { TableName: id, GlobalSecondaryIndexUpdates: [{ Delete: { IndexName: n } }] });
    if (!same(old.TimeToLiveSpecification, next.TimeToLiveSpecification) && next.TimeToLiveSpecification) {
      const t = next.TimeToLiveSpecification as Rec;
      r.call('dynamodb', 'update-time-to-live', { TableName: id, TimeToLiveSpecification: { Enabled: t.Enabled === true || t.Enabled === 'true', AttributeName: t.AttributeName } });
    }
    if (!same(old.PointInTimeRecoverySpecification, next.PointInTimeRecoverySpecification) && next.PointInTimeRecoverySpecification) r.call('dynamodb', 'update-continuous-backups', { TableName: id, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: (next.PointInTimeRecoverySpecification as Rec).PointInTimeRecoveryEnabled === true || (next.PointInTimeRecoverySpecification as Rec).PointInTimeRecoveryEnabled === 'true' } });
  },
  delete: (r, id) => void r.call('dynamodb', 'delete-table', { TableName: id }),
  actual(r, id, p) {
    let d: Rec;
    try {
      d = (r.call('dynamodb', 'describe-table', { TableName: id }).Table ?? {}) as Rec;
    } catch {
      return null;
    }
    const out: Rec = {};
    if (p.BillingMode || p.ProvisionedThroughput) out.BillingMode = ((d.BillingModeSummary as Rec | undefined)?.BillingMode as string | undefined) ?? 'PROVISIONED';
    if (p.ProvisionedThroughput) {
      const t = (d.ProvisionedThroughput ?? {}) as Rec;
      out.ProvisionedThroughput = { ReadCapacityUnits: t.ReadCapacityUnits, WriteCapacityUnits: t.WriteCapacityUnits };
    }
    return out;
  },
};

// ───────────────────────── SQS / SNS ─────────────────────────

const QUEUE_ATTRS = ['VisibilityTimeout', 'MessageRetentionPeriod', 'DelaySeconds', 'ReceiveMessageWaitTimeSeconds', 'MaximumMessageSize'];
const queueAttrs = (p: Rec): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of QUEUE_ATTRS) if (p[k] !== undefined) out[k] = String(p[k]);
  if (p.RedrivePolicy) out.RedrivePolicy = j(p.RedrivePolicy);
  if (p.FifoQueue) out.FifoQueue = String(p.FifoQueue);
  if (p.ContentBasedDeduplication) out.ContentBasedDeduplication = String(p.ContentBasedDeduplication);
  return out;
};
const queue: RType = {
  allowed: [...QUEUE_ATTRS, 'QueueName', 'RedrivePolicy', 'FifoQueue', 'ContentBasedDeduplication', 'Tags', 'KmsMasterKeyId', 'SqsManagedSseEnabled', 'RedriveAllowPolicy'],
  mutable: [...QUEUE_ATTRS, 'RedrivePolicy', 'ContentBasedDeduplication', 'Tags', 'KmsMasterKeyId', 'SqsManagedSseEnabled', 'RedriveAllowPolicy'],
  nameProp: 'QueueName',
  secs: 4,
  nameMax: 80,
  create(r, p, name) {
    const n = p.FifoQueue && !name.endsWith('.fifo') ? name + '.fifo' : name;
    const out = r.call('sqs', 'create-queue', { QueueName: n, Attributes: queueAttrs(p), ...(Array.isArray(p.Tags) ? { Tags: tagMap(p.Tags) } : {}) });
    const url = String(out.QueueUrl);
    return { id: url, attrs: { Arn: `arn:aws:sqs:${r.region}:${accountOf(r)}:${n}`, QueueName: n, QueueUrl: url } };
  },
  update(r, id, _old, next) {
    r.call('sqs', 'set-queue-attributes', { QueueUrl: id, Attributes: queueAttrs(next) });
  },
  delete: (r, id) => void r.call('sqs', 'delete-queue', { QueueUrl: id }),
  actual(r, id, p) {
    let a: Record<string, string>;
    try {
      a = (r.call('sqs', 'get-queue-attributes', { QueueUrl: id, AttributeNames: ['All'] }).Attributes ?? {}) as Record<string, string>;
    } catch {
      return null;
    }
    const out: Rec = {};
    for (const k of QUEUE_ATTRS) if (p[k] !== undefined) out[k] = Number(a[k]);
    return out;
  },
};

const topic: RType = {
  allowed: ['TopicName', 'DisplayName', 'Subscription', 'Tags', 'FifoTopic', 'KmsMasterKeyId'],
  mutable: ['DisplayName', 'Subscription', 'Tags', 'KmsMasterKeyId'],
  nameProp: 'TopicName',
  secs: 3,
  nameMax: 256,
  create(r, p, name) {
    const out = r.call('sns', 'create-topic', { Name: name, ...(p.DisplayName ? { Attributes: { DisplayName: String(p.DisplayName) } } : {}) });
    const arn = String(out.TopicArn);
    for (const s of (p.Subscription as Rec[] | undefined) ?? []) r.call('sns', 'subscribe', { TopicArn: arn, Protocol: s.Protocol, NotificationEndpoint: s.Endpoint });
    return { id: arn, attrs: { TopicName: name, TopicArn: arn } };
  },
  update(r, id, old, next) {
    if (old.DisplayName !== next.DisplayName) r.call('sns', 'set-topic-attributes', { TopicArn: id, AttributeName: 'DisplayName', AttributeValue: String(next.DisplayName ?? '') });
  },
  delete: (r, id) => void r.call('sns', 'delete-topic', { TopicArn: id }),
};

const subscription: RType = {
  allowed: ['TopicArn', 'Protocol', 'Endpoint', 'FilterPolicy', 'RawMessageDelivery'],
  mutable: ['FilterPolicy', 'RawMessageDelivery'],
  secs: 3,
  create(r, p) {
    const out = r.call('sns', 'subscribe', { TopicArn: p.TopicArn, Protocol: p.Protocol, NotificationEndpoint: p.Endpoint, ReturnSubscriptionArn: true, ...(p.FilterPolicy ? { Attributes: { FilterPolicy: j(p.FilterPolicy) } } : {}) });
    return { id: String(out.SubscriptionArn) };
  },
  delete: (r, id) => void r.call('sns', 'unsubscribe', { SubscriptionArn: id }),
};

const queuePolicy: RType = {
  allowed: ['Queues', 'PolicyDocument'],
  mutable: ['PolicyDocument', 'Queues'],
  secs: 2,
  create(r, p) {
    for (const q of (p.Queues as string[]) ?? []) r.call('sqs', 'set-queue-attributes', { QueueUrl: q, Attributes: { Policy: j(p.PolicyDocument) } });
    return { id: stableId(`qp:${r.stackName}:${r.logicalId}`, 'QueuePolicy-', 10, 'up') };
  },
  update(r, _id, _old, next) {
    for (const q of (next.Queues as string[]) ?? []) r.call('sqs', 'set-queue-attributes', { QueueUrl: q, Attributes: { Policy: j(next.PolicyDocument) } });
  },
  delete(r, _id, p) {
    for (const q of (p.Queues as string[]) ?? []) {
      try {
        r.call('sqs', 'set-queue-attributes', { QueueUrl: q, Attributes: { Policy: '' } });
      } catch {
        /* la cola ya no existe */
      }
    }
  },
};

// ───────────────────────── Lambda ─────────────────────────

const codeFor = (p: Rec, runtime: string | undefined): Rec => {
  const c = (p.Code ?? {}) as Rec;
  if (typeof c.ZipFile === 'string') return { ZipFile: makeZip({ [String(runtime ?? '').startsWith('python') ? 'index.py' : 'index.js']: c.ZipFile }) };
  if (c.S3Bucket) return { Code: { S3Bucket: c.S3Bucket, S3Key: c.S3Key } };
  throw new CfnFail('Please provide a source for function code (Code: ZipFile or S3Bucket and S3Key).');
};

const fnConfig = (p: Rec): Rec => ({
  ...(p.Runtime ? { Runtime: p.Runtime } : {}),
  ...(p.Handler ? { Handler: p.Handler } : {}),
  ...(p.Role ? { Role: p.Role } : {}),
  ...(p.Timeout !== undefined ? { Timeout: Number(p.Timeout) } : {}),
  ...(p.MemorySize !== undefined ? { MemorySize: Number(p.MemorySize) } : {}),
  ...(p.Description !== undefined ? { Description: String(p.Description) } : {}),
  ...(p.Environment ? { Environment: p.Environment } : {}),
  ...(p.VpcConfig ? { VpcConfig: p.VpcConfig } : {}),
});

const fnc: RType = {
  allowed: ['FunctionName', 'Runtime', 'Handler', 'Role', 'Code', 'Timeout', 'MemorySize', 'Environment', 'Description', 'Tags', 'VpcConfig', 'Layers', 'Architectures', 'PackageType', 'TracingConfig', 'DeadLetterConfig', 'ReservedConcurrentExecutions', 'Policies'],
  mutable: ['Runtime', 'Handler', 'Role', 'Code', 'Timeout', 'MemorySize', 'Environment', 'Description', 'Tags', 'VpcConfig', 'Layers', 'TracingConfig', 'DeadLetterConfig', 'ReservedConcurrentExecutions'],
  nameProp: 'FunctionName',
  secs: 9,
  nameMax: 64,
  create(r, p, name) {
    const { Environment, ...rest } = fnConfig(p);
    const out = r.call('lambda', 'create-function', { FunctionName: name, ...rest, ...(Environment ? { Environment } : {}), ...codeFor(p, p.Runtime as string | undefined), ...(Array.isArray(p.Tags) ? { Tags: tagMap(p.Tags) } : p.Tags && typeof p.Tags === 'object' ? { Tags: p.Tags } : {}) });
    return { id: name, attrs: { Arn: String(out.FunctionArn ?? `arn:aws:lambda:${r.region}:${accountOf(r)}:function:${name}`) } };
  },
  update(r, id, old, next) {
    const cfg: Rec = {};
    for (const k of ['Runtime', 'Handler', 'Role', 'Timeout', 'MemorySize', 'Description', 'Environment', 'VpcConfig']) if (!same(old[k], next[k]) && next[k] !== undefined) cfg[k] = k === 'Timeout' || k === 'MemorySize' ? Number(next[k]) : next[k];
    if (Object.keys(cfg).length) r.call('lambda', 'update-function-configuration', { FunctionName: id, ...cfg });
    if (!same(old.Code, next.Code)) {
      const code = codeFor(next, next.Runtime as string | undefined);
      r.call('lambda', 'update-function-code', code.ZipFile ? { FunctionName: id, ZipFile: code.ZipFile } : { FunctionName: id, S3Bucket: (code.Code as Rec).S3Bucket, S3Key: (code.Code as Rec).S3Key });
    }
  },
  delete: (r, id) => void r.call('lambda', 'delete-function', { FunctionName: id }),
  actual(r, id, p) {
    let d: Rec;
    try {
      d = r.call('lambda', 'get-function-configuration', { FunctionName: id });
    } catch {
      return null;
    }
    const out: Rec = {};
    for (const k of ['Timeout', 'MemorySize', 'Handler', 'Runtime', 'Description']) if (p[k] !== undefined) out[k] = d[k];
    if (p.Environment) out.Environment = { Variables: ((d.Environment as Rec | undefined)?.Variables ?? {}) as Rec };
    return out;
  },
};

const permission: RType = {
  allowed: ['FunctionName', 'Action', 'Principal', 'SourceArn', 'SourceAccount'],
  mutable: [],
  secs: 2,
  create(r, p) {
    const sid = stableId(`perm:${r.stackName}:${r.logicalId}`, '', 16, 'hex');
    r.call('lambda', 'add-permission', { FunctionName: p.FunctionName, StatementId: sid, Action: p.Action, Principal: p.Principal, ...(p.SourceArn ? { SourceArn: p.SourceArn } : {}), ...(p.SourceAccount ? { SourceAccount: p.SourceAccount } : {}) });
    return { id: `${p.FunctionName}|${sid}` };
  },
  delete(r, id) {
    const [fn, sid] = id.split('|');
    try {
      r.call('lambda', 'remove-permission', { FunctionName: fn, StatementId: sid });
    } catch {
      /* la función ya no existe */
    }
  },
};

const version: RType = {
  allowed: ['FunctionName', 'Description'],
  mutable: [],
  secs: 3,
  create(r, p) {
    const out = r.call('lambda', 'publish-version', { FunctionName: p.FunctionName, ...(p.Description ? { Description: p.Description } : {}) });
    return { id: String(out.FunctionArn), attrs: { Version: String(out.Version) } };
  },
  delete() {
    /* las versiones de Lambda se conservan */
  },
};

const alias: RType = {
  allowed: ['FunctionName', 'FunctionVersion', 'Name', 'Description', 'RoutingConfig'],
  mutable: ['FunctionVersion', 'Description', 'RoutingConfig'],
  secs: 3,
  create(r, p) {
    const out = r.call('lambda', 'create-alias', { FunctionName: p.FunctionName, Name: p.Name, FunctionVersion: p.FunctionVersion, ...(p.Description ? { Description: p.Description } : {}), ...(p.RoutingConfig ? { RoutingConfig: p.RoutingConfig } : {}) });
    return { id: String(out.AliasArn) };
  },
  update(r, _id, _old, next) {
    r.call('lambda', 'update-alias', { FunctionName: next.FunctionName, Name: next.Name, FunctionVersion: next.FunctionVersion, ...(next.RoutingConfig ? { RoutingConfig: next.RoutingConfig } : {}) });
  },
  delete(r, id) {
    const parts = id.split(':');
    try {
      r.call('lambda', 'delete-alias', { FunctionName: parts[6], Name: parts[7] });
    } catch {
      /* ya no existe */
    }
  },
};

// ───────────────────────── IAM ─────────────────────────

const role: RType = {
  allowed: ['RoleName', 'AssumeRolePolicyDocument', 'ManagedPolicyArns', 'Policies', 'Path', 'Description', 'Tags', 'MaxSessionDuration', 'PermissionsBoundary'],
  mutable: ['AssumeRolePolicyDocument', 'ManagedPolicyArns', 'Policies', 'Description', 'Tags', 'MaxSessionDuration'],
  nameProp: 'RoleName',
  secs: 12,
  iam: true,
  nameMax: 64,
  create(r, p, name) {
    const out = r.call('iam', 'create-role', { RoleName: name, AssumeRolePolicyDocument: j(p.AssumeRolePolicyDocument), ...(p.Path ? { Path: p.Path } : {}), ...(p.Description ? { Description: p.Description } : {}), ...(p.MaxSessionDuration ? { MaxSessionDuration: Number(p.MaxSessionDuration) } : {}), ...(Array.isArray(p.Tags) ? { Tags: tagList(p.Tags) } : {}) });
    for (const arn of (p.ManagedPolicyArns as string[] | undefined) ?? []) r.call('iam', 'attach-role-policy', { RoleName: name, PolicyArn: arn });
    for (const pol of (p.Policies as Rec[] | undefined) ?? []) r.call('iam', 'put-role-policy', { RoleName: name, PolicyName: pol.PolicyName, PolicyDocument: j(pol.PolicyDocument) });
    const rr = (out.Role ?? {}) as Rec;
    return { id: name, attrs: { Arn: String(rr.Arn ?? `arn:aws:iam::${accountOf(r)}:role/${name}`), RoleId: String(rr.RoleId ?? '') } };
  },
  update(r, id, old, next) {
    const oldArns = (old.ManagedPolicyArns as string[] | undefined) ?? [];
    const newArns = (next.ManagedPolicyArns as string[] | undefined) ?? [];
    for (const a of newArns.filter((x) => !oldArns.includes(x))) r.call('iam', 'attach-role-policy', { RoleName: id, PolicyArn: a });
    for (const a of oldArns.filter((x) => !newArns.includes(x))) r.call('iam', 'detach-role-policy', { RoleName: id, PolicyArn: a });
    const oldPol = ((old.Policies as Rec[] | undefined) ?? []).map((x) => String(x.PolicyName));
    for (const pol of (next.Policies as Rec[] | undefined) ?? []) r.call('iam', 'put-role-policy', { RoleName: id, PolicyName: pol.PolicyName, PolicyDocument: j(pol.PolicyDocument) });
    for (const n of oldPol.filter((x) => !((next.Policies as Rec[] | undefined) ?? []).some((q) => q.PolicyName === x))) r.call('iam', 'delete-role-policy', { RoleName: id, PolicyName: n });
    if (!same(old.AssumeRolePolicyDocument, next.AssumeRolePolicyDocument)) r.call('iam', 'update-assume-role-policy', { RoleName: id, PolicyDocument: j(next.AssumeRolePolicyDocument) });
  },
  delete(r, id) {
    const att = (r.call('iam', 'list-attached-role-policies', { RoleName: id }).AttachedPolicies ?? []) as Rec[];
    for (const x of att) r.call('iam', 'detach-role-policy', { RoleName: id, PolicyArn: x.PolicyArn });
    const inl = (r.call('iam', 'list-role-policies', { RoleName: id }).PolicyNames ?? []) as string[];
    for (const n of inl) r.call('iam', 'delete-role-policy', { RoleName: id, PolicyName: n });
    r.call('iam', 'delete-role', { RoleName: id });
  },
  actual(r, id, p) {
    const ro = r.a.iam.roles[id];
    if (!ro) return null;
    const out: Rec = {};
    if (p.ManagedPolicyArns) out.ManagedPolicyArns = [...ro.attached].sort();
    return out;
  },
};

const managedPolicy: RType = {
  allowed: ['ManagedPolicyName', 'PolicyDocument', 'Roles', 'Description', 'Path'],
  mutable: ['Roles', 'Description'],
  nameProp: 'ManagedPolicyName',
  secs: 6,
  iam: true,
  nameMax: 128,
  create(r, p, name) {
    const out = r.call('iam', 'create-policy', { PolicyName: name, PolicyDocument: j(p.PolicyDocument), ...(p.Description ? { Description: p.Description } : {}) });
    const arn = String((out.Policy as Rec).Arn);
    for (const ro of (p.Roles as string[] | undefined) ?? []) r.call('iam', 'attach-role-policy', { RoleName: ro, PolicyArn: arn });
    return { id: arn };
  },
  update(r, id, old, next) {
    const o = (old.Roles as string[] | undefined) ?? [];
    const n = (next.Roles as string[] | undefined) ?? [];
    for (const x of n.filter((y) => !o.includes(y))) r.call('iam', 'attach-role-policy', { RoleName: x, PolicyArn: id });
    for (const x of o.filter((y) => !n.includes(y))) r.call('iam', 'detach-role-policy', { RoleName: x, PolicyArn: id });
  },
  delete(r, id, p) {
    for (const ro of (p.Roles as string[] | undefined) ?? []) {
      try {
        r.call('iam', 'detach-role-policy', { RoleName: ro, PolicyArn: id });
      } catch {
        /* el rol ya no existe */
      }
    }
    r.call('iam', 'delete-policy', { PolicyArn: id });
  },
};

// ───────────────────────── EC2 ─────────────────────────

const tagResources = (r: RCtx, id: string, tags: unknown) => {
  if (Array.isArray(tags) && tags.length) r.call('ec2', 'create-tags', { Resources: [id], Tags: tagList(tags) });
};

const vpc: RType = {
  allowed: ['CidrBlock', 'EnableDnsSupport', 'EnableDnsHostnames', 'InstanceTenancy', 'Tags'],
  mutable: ['EnableDnsSupport', 'EnableDnsHostnames', 'Tags'],
  secs: 5,
  create(r, p) {
    const out = r.call('ec2', 'create-vpc', { CidrBlock: p.CidrBlock });
    const id = String((out.Vpc as Rec).VpcId);
    tagResources(r, id, p.Tags);
    return { id, attrs: { CidrBlock: String(p.CidrBlock) } };
  },
  update: (r, id, _old, next) => tagResources(r, id, next.Tags),
  delete: (r, id) => void r.call('ec2', 'delete-vpc', { VpcId: id }),
};

const subnet: RType = {
  allowed: ['VpcId', 'CidrBlock', 'AvailabilityZone', 'MapPublicIpOnLaunch', 'Tags'],
  mutable: ['MapPublicIpOnLaunch', 'Tags'],
  secs: 5,
  create(r, p) {
    const out = r.call('ec2', 'create-subnet', { VpcId: p.VpcId, CidrBlock: p.CidrBlock, ...(p.AvailabilityZone ? { AvailabilityZone: p.AvailabilityZone } : {}) });
    const s = out.Subnet as Rec;
    tagResources(r, String(s.SubnetId), p.Tags);
    return { id: String(s.SubnetId), attrs: { AvailabilityZone: String(s.AvailabilityZone) } };
  },
  update: (r, id, _old, next) => tagResources(r, id, next.Tags),
  delete: (r, id) => void r.call('ec2', 'delete-subnet', { SubnetId: id }),
};

const igw: RType = {
  allowed: ['Tags'],
  mutable: ['Tags'],
  secs: 5,
  create(r, p) {
    const out = r.call('ec2', 'create-internet-gateway', {});
    const id = String((out.InternetGateway as Rec).InternetGatewayId);
    tagResources(r, id, p.Tags);
    return { id };
  },
  update: (r, id, _old, next) => tagResources(r, id, next.Tags),
  delete: (r, id) => void r.call('ec2', 'delete-internet-gateway', { InternetGatewayId: id }),
};

const igwAttach: RType = {
  allowed: ['InternetGatewayId', 'VpcId'],
  mutable: [],
  secs: 6,
  create(r, p) {
    r.call('ec2', 'attach-internet-gateway', { InternetGatewayId: p.InternetGatewayId, VpcId: p.VpcId });
    return { id: `${p.InternetGatewayId}|${p.VpcId}` };
  },
  delete(r, id) {
    const [g, v] = id.split('|');
    r.call('ec2', 'detach-internet-gateway', { InternetGatewayId: g, VpcId: v });
  },
};

const ingressRules = (p: Rec): Rec[] =>
  ((p.SecurityGroupIngress as Rec[] | undefined) ?? []).map((x) => ({
    IpProtocol: String(x.IpProtocol),
    ...(x.FromPort !== undefined ? { FromPort: Number(x.FromPort) } : {}),
    ...(x.ToPort !== undefined ? { ToPort: Number(x.ToPort) } : {}),
    ...(x.CidrIp ? { IpRanges: [{ CidrIp: x.CidrIp }] } : {}),
    ...(x.SourceSecurityGroupId ? { UserIdGroupPairs: [{ GroupId: x.SourceSecurityGroupId }] } : {}),
  }));

const sg: RType = {
  allowed: ['GroupName', 'GroupDescription', 'VpcId', 'SecurityGroupIngress', 'SecurityGroupEgress', 'Tags'],
  mutable: ['SecurityGroupIngress', 'SecurityGroupEgress', 'Tags'],
  nameProp: 'GroupName',
  secs: 4,
  nameMax: 255,
  create(r, p, name) {
    const out = r.call('ec2', 'create-security-group', { GroupName: name, Description: p.GroupDescription, ...(p.VpcId ? { VpcId: p.VpcId } : {}) });
    const id = String(out.GroupId);
    const rules = ingressRules(p);
    if (rules.length) r.call('ec2', 'authorize-security-group-ingress', { GroupId: id, IpPermissions: rules });
    tagResources(r, id, p.Tags);
    const vpcId = (r.a.regions[r.region]?.ec2.securityGroups[id]?.VpcId ?? '') as string;
    return { id, attrs: { GroupId: id, VpcId: vpcId } };
  },
  update(r, id, old, next) {
    const oldR = ingressRules(old);
    const newR = ingressRules(next);
    const key = (x: Rec) => JSON.stringify(x);
    const rem = oldR.filter((x) => !newR.some((y) => key(y) === key(x)));
    const add = newR.filter((x) => !oldR.some((y) => key(y) === key(x)));
    if (rem.length) r.call('ec2', 'revoke-security-group-ingress', { GroupId: id, IpPermissions: rem });
    if (add.length) r.call('ec2', 'authorize-security-group-ingress', { GroupId: id, IpPermissions: add });
    tagResources(r, id, next.Tags);
  },
  delete: (r, id) => void r.call('ec2', 'delete-security-group', { GroupId: id }),
  actual(r, id, p) {
    const g = r.a.regions[r.region]?.ec2.securityGroups[id];
    if (!g) return null;
    const out: Rec = {};
    if (p.SecurityGroupIngress) {
      out.SecurityGroupIngress = g.IpPermissions.flatMap((x) => [
        ...(x.IpRanges ?? []).map((ip) => ({ IpProtocol: x.IpProtocol, ...(x.FromPort !== undefined ? { FromPort: x.FromPort } : {}), ...(x.ToPort !== undefined ? { ToPort: x.ToPort } : {}), CidrIp: ip.CidrIp })),
        ...(x.UserIdGroupPairs ?? []).map((u) => ({ IpProtocol: x.IpProtocol, ...(x.FromPort !== undefined ? { FromPort: x.FromPort } : {}), ...(x.ToPort !== undefined ? { ToPort: x.ToPort } : {}), SourceSecurityGroupId: u.GroupId })),
      ]);
    }
    return out;
  },
};

const instance: RType = {
  allowed: ['ImageId', 'InstanceType', 'SubnetId', 'SecurityGroupIds', 'KeyName', 'UserData', 'Tags', 'IamInstanceProfile', 'SecurityGroups'],
  mutable: ['Tags'],
  secs: 35,
  create(r, p) {
    const out = r.call('ec2', 'run-instances', { ImageId: p.ImageId, InstanceType: p.InstanceType ?? 't3.micro', ...(p.SubnetId ? { SubnetId: p.SubnetId } : {}), ...(p.SecurityGroupIds ? { SecurityGroupIds: p.SecurityGroupIds } : {}), ...(p.KeyName ? { KeyName: p.KeyName } : {}), ...(p.UserData ? { UserData: p.UserData } : {}), ...(p.IamInstanceProfile ? { IamInstanceProfile: { Name: p.IamInstanceProfile } } : {}) });
    const i = ((out.Instances ?? []) as Rec[])[0];
    const id = String(i.InstanceId);
    tagResources(r, id, p.Tags);
    return { id, attrs: { PrivateIp: String(i.PrivateIpAddress ?? ''), PublicIp: String(i.PublicIpAddress ?? ''), AvailabilityZone: String(((i.Placement ?? {}) as Rec).AvailabilityZone ?? '') } };
  },
  update: (r, id, _old, next) => tagResources(r, id, next.Tags),
  delete: (r, id) => void r.call('ec2', 'terminate-instances', { InstanceIds: [id] }),
};

// ───────────────────────── otros ─────────────────────────

const logGroup: RType = {
  allowed: ['LogGroupName', 'RetentionInDays', 'Tags'],
  mutable: ['RetentionInDays', 'Tags'],
  nameProp: 'LogGroupName',
  secs: 3,
  nameMax: 512,
  create(r, p, name) {
    r.call('logs', 'create-log-group', { LogGroupName: name });
    if (p.RetentionInDays) r.call('logs', 'put-retention-policy', { LogGroupName: name, RetentionInDays: Number(p.RetentionInDays) });
    return { id: name, attrs: { Arn: `arn:aws:logs:${r.region}:${accountOf(r)}:log-group:${name}:*` } };
  },
  update(r, id, old, next) {
    if (old.RetentionInDays !== next.RetentionInDays && next.RetentionInDays) r.call('logs', 'put-retention-policy', { LogGroupName: id, RetentionInDays: Number(next.RetentionInDays) });
  },
  delete: (r, id) => void r.call('logs', 'delete-log-group', { LogGroupName: id }),
};

const httpApi: RType = {
  allowed: ['Name', 'ProtocolType', 'Description', 'Target', 'CorsConfiguration', 'Tags'],
  mutable: ['Description', 'Tags', 'CorsConfiguration'],
  secs: 4,
  create(r, p) {
    const out = r.call('apigatewayv2', 'create-api', { Name: p.Name, ProtocolType: p.ProtocolType ?? 'HTTP', ...(p.CorsConfiguration ? { CorsConfiguration: p.CorsConfiguration } : {}) });
    return { id: String(out.ApiId), attrs: { ApiEndpoint: String(out.ApiEndpoint ?? `https://${out.ApiId}.execute-api.${r.region}.amazonaws.com`), ApiId: String(out.ApiId) } };
  },
  delete: (r, id) => void r.call('apigatewayv2', 'delete-api', { ApiId: id }),
};

const apiIntegration: RType = {
  allowed: ['ApiId', 'IntegrationType', 'IntegrationUri', 'PayloadFormatVersion', 'IntegrationMethod'],
  mutable: [],
  secs: 3,
  create(r, p) {
    const out = r.call('apigatewayv2', 'create-integration', { ApiId: p.ApiId, IntegrationType: p.IntegrationType, ...(p.IntegrationUri ? { IntegrationUri: p.IntegrationUri } : {}), PayloadFormatVersion: p.PayloadFormatVersion ?? '2.0' });
    return { id: String(out.IntegrationId) };
  },
  delete(r, id, p) {
    r.call('apigatewayv2', 'delete-integration', { ApiId: p.ApiId, IntegrationId: id });
  },
};

const apiRoute: RType = {
  allowed: ['ApiId', 'RouteKey', 'Target', 'AuthorizationType', 'AuthorizerId'],
  mutable: [],
  secs: 3,
  create(r, p) {
    const out = r.call('apigatewayv2', 'create-route', { ApiId: p.ApiId, RouteKey: p.RouteKey, ...(p.Target ? { Target: p.Target } : {}), ...(p.AuthorizationType ? { AuthorizationType: p.AuthorizationType } : {}), ...(p.AuthorizerId ? { AuthorizerId: p.AuthorizerId } : {}) });
    return { id: String(out.RouteId) };
  },
  delete(r, id, p) {
    r.call('apigatewayv2', 'delete-route', { ApiId: p.ApiId, RouteId: id });
  },
};

const apiStage: RType = {
  allowed: ['ApiId', 'StageName', 'AutoDeploy', 'DefaultRouteSettings'],
  mutable: ['AutoDeploy'],
  secs: 3,
  create(r, p) {
    r.call('apigatewayv2', 'create-stage', { ApiId: p.ApiId, StageName: p.StageName, AutoDeploy: p.AutoDeploy === true || p.AutoDeploy === 'true' });
    return { id: String(p.StageName) };
  },
  delete(r, id, p) {
    r.call('apigatewayv2', 'delete-stage', { ApiId: p.ApiId, StageName: id });
  },
};

const cdkMetadata: RType = {
  allowed: ['Analytics'],
  mutable: ['Analytics'],
  secs: 1,
  create: (r) => ({ id: stableId(`cdk:${r.stackName}`, 'v2:deflate64:', 12, 'b64') }),
  delete() {
    /* marcador */
  },
};

export const RESOURCE_TYPES: Record<string, RType> = {
  'AWS::S3::Bucket': bucket,
  'AWS::DynamoDB::Table': table,
  'AWS::SQS::Queue': queue,
  'AWS::SQS::QueuePolicy': queuePolicy,
  'AWS::SNS::Topic': topic,
  'AWS::SNS::Subscription': subscription,
  'AWS::Lambda::Function': fnc,
  'AWS::Lambda::Permission': permission,
  'AWS::Lambda::Version': version,
  'AWS::Lambda::Alias': alias,
  'AWS::IAM::Role': role,
  'AWS::IAM::ManagedPolicy': managedPolicy,
  'AWS::EC2::VPC': vpc,
  'AWS::EC2::Subnet': subnet,
  'AWS::EC2::InternetGateway': igw,
  'AWS::EC2::VPCGatewayAttachment': igwAttach,
  'AWS::EC2::SecurityGroup': sg,
  'AWS::EC2::Instance': instance,
  'AWS::Logs::LogGroup': logGroup,
  'AWS::ApiGatewayV2::Api': httpApi,
  'AWS::ApiGatewayV2::Integration': apiIntegration,
  'AWS::ApiGatewayV2::Route': apiRoute,
  'AWS::ApiGatewayV2::Stage': apiStage,
  'AWS::CDK::Metadata': cdkMetadata,
};

/** Atributos de `Fn::GetAtt` de los recursos que no los guardan al crearse. */
export const defaultAttrs = (type: string, physicalId: string, a: Account, region: string): Record<string, string> => {
  if (type === 'AWS::S3::Bucket') return bucketAttrs(physicalId, region);
  return { Arn: physicalId };
};
