/** Amazon DynamoDB: tablas, elementos, consultas y expresiones. */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { applyUpdate, canon, checkItem, checkUnused, checkValue, compare, evalCond, itemSize, mkEnv, parseCondition, parseKeyCondition, parseUpdate, project, typeOf, validation, type AV, type Item } from '../ddb';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, DdbIndex, DdbKey, DdbTable, Tag } from '../types';
import { iso, stableId } from '../util';

/** Ganchos para streams, TTL, réplicas globales y copias de seguridad (los instala `dynamodb2.ts`). */
export const ddbHooks: {
  change?: (a: Account, region: string, t: DdbTable, k: string, old: Item | undefined, next: Item | undefined, by?: 'ttl') => void;
  view?: (a: Account, region: string, t: DdbTable) => Record<string, unknown>;
  streamSpec?: (a: Account, t: DdbTable, spec: { StreamEnabled?: unknown; StreamViewType?: string }) => void;
  replicaUpdates?: (c: OpCtx, t: DdbTable, updates: { Create?: { RegionName: string }; Delete?: { RegionName: string } }[]) => void;
} = {};

/** Guarda (o borra, si `next` es undefined) un elemento y avisa a los ganchos. */
export function ddbCommit(a: Account, region: string, t: DdbTable, k: string, old: Item | undefined, next: Item | undefined, by?: 'ttl'): void {
  if (next) t.items[k] = next;
  else delete t.items[k];
  ddbHooks.change?.(a, region, t, k, old, next, by);
}

const CREATING_MS = 5000;
const DELETING_MS = 5000;

export function tablesOf(a: Account, region: string): Record<string, DdbTable> {
  const r = regional(a, region);
  r.ddb ??= {};
  const t = r.ddb;
  for (const [k, tb] of Object.entries(t)) if (tb.deleting !== undefined && a.clock - tb.deleting >= DELETING_MS) delete t[k];
  return t;
}

export const status = (a: Account, t: DdbTable) => (t.deleting !== undefined ? 'DELETING' : a.clock - t.created < CREATING_MS ? 'CREATING' : 'ACTIVE');

const notFound = () => new AwsError('ResourceNotFoundException', 'Requested resource not found');

export function tableFor(c: OpCtx, name: string): DdbTable {
  const t = tablesOf(c.acct, c.region)[name];
  if (!t || t.deleting !== undefined) throw notFound();
  return t;
}

export const arn = (c: OpCtx, name: string) => `arn:aws:dynamodb:${c.region}:${c.acct.id}:table/${name}`;
const tableArn = (c: OpCtx) => arn(c, c.p.TableName ?? '*');

// ───────────────────────── claves ─────────────────────────

const pkName = (ks: DdbKey[]) => ks.find((k) => k.KeyType === 'HASH')!.AttributeName;
const skName = (ks: DdbKey[]) => ks.find((k) => k.KeyType === 'RANGE')?.AttributeName;
const attrType = (t: DdbTable, name: string) => t.AttributeDefinitions.find((d) => d.AttributeName === name)?.AttributeType;

/** Comprueba que el elemento o la clave traiga la clave primaria con los tipos correctos. */
export function checkKey(t: DdbTable, k: Item, what: 'item' | 'key'): void {
  for (const ks of t.KeySchema) {
    const v = k[ks.AttributeName];
    if (!v) throw validation(what === 'item' ? `One or more parameter values were invalid: Missing the key ${ks.AttributeName} in the item` : 'The provided key element does not match the schema');
    const ty = typeOf(v);
    if (ty !== attrType(t, ks.AttributeName)) throw validation(`One or more parameter values were invalid: Type mismatch for key ${ks.AttributeName} expected: ${attrType(t, ks.AttributeName)} actual: ${ty}`);
    if (ty === 'S' && v.S === '') throw validation(`One or more parameter values were invalid: An AttributeValue may not contain an empty string. Key: ${ks.AttributeName}`);
  }
  if (what === 'key' && Object.keys(k).length !== t.KeySchema.length) throw validation('The provided key element does not match the schema');
}

export const keyOf = (t: DdbTable, it: Item) => t.KeySchema.map((k) => canon(it[k.AttributeName])).join('\u0001');
const keyPart = (t: DdbTable, it: Item): Item => Object.fromEntries(t.KeySchema.map((k) => [k.AttributeName, it[k.AttributeName]]));

function keyOfIndex(idx: DdbKey[], it: Item): string | null {
  const parts: string[] = [];
  for (const k of idx) {
    const v = it[k.AttributeName];
    if (!v) return null;
    parts.push(canon(v));
  }
  return parts.join('\u0001');
}

// ───────────────────────── vistas ─────────────────────────

const rcu = (bytes: number, consistent: boolean) => Math.ceil(Math.max(bytes, 1) / 4096) * (consistent ? 1 : 0.5);
const wcu = (bytes: number) => Math.ceil(Math.max(bytes, 1) / 1024);

const capacity = (c: OpCtx, table: string, units: number) => (c.p.ReturnConsumedCapacity === 'TOTAL' || c.p.ReturnConsumedCapacity === 'INDEXES' ? { ConsumedCapacity: { TableName: table, CapacityUnits: units } } : {});

const sizeOfTable = (t: DdbTable) => Object.values(t.items).reduce((n, it) => n + itemSize(it as Item), 0);

function indexView(c: OpCtx, t: DdbTable, i: DdbIndex, local: boolean) {
  const count = Object.values(t.items).filter((it) => keyOfIndex(i.KeySchema, it as Item) !== null).length;
  return {
    IndexName: i.IndexName,
    KeySchema: i.KeySchema,
    Projection: i.Projection,
    ...(local ? {} : { IndexStatus: 'ACTIVE', ProvisionedThroughput: { NumberOfDecreasesToday: 0, ReadCapacityUnits: i.ProvisionedThroughput?.ReadCapacityUnits ?? 0, WriteCapacityUnits: i.ProvisionedThroughput?.WriteCapacityUnits ?? 0 } }),
    IndexSizeBytes: Object.values(t.items).reduce((n, it) => (keyOfIndex(i.KeySchema, it as Item) !== null ? n + itemSize(it as Item) : n), 0),
    ItemCount: count,
    IndexArn: `${arn(c, t.TableName)}/index/${i.IndexName}`,
  };
}

function tableView(c: OpCtx, t: DdbTable) {
  const onDemand = t.BillingMode === 'PAY_PER_REQUEST';
  const defs = [...t.AttributeDefinitions];
  return {
    AttributeDefinitions: defs,
    TableName: t.TableName,
    KeySchema: t.KeySchema,
    TableStatus: status(c.acct, t),
    CreationDateTime: iso(t.created),
    ProvisionedThroughput: { NumberOfDecreasesToday: 0, ReadCapacityUnits: onDemand ? 0 : t.ProvisionedThroughput!.ReadCapacityUnits, WriteCapacityUnits: onDemand ? 0 : t.ProvisionedThroughput!.WriteCapacityUnits },
    TableSizeBytes: sizeOfTable(t),
    ItemCount: Object.keys(t.items).length,
    TableArn: arn(c, t.TableName),
    TableId: `${stableId('tbl:' + t.TableName + t.created, '', 8)}-${stableId('tb2:' + t.TableName, '', 4)}-${stableId('tb3:' + t.TableName, '', 4)}-${stableId('tb4:' + t.TableName, '', 4)}-${stableId('tb5:' + t.TableName, '', 12)}`,
    ...(onDemand ? { BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST', LastUpdateToPayPerRequestDateTime: iso(t.created) } } : {}),
    ...(t.LocalSecondaryIndexes.length ? { LocalSecondaryIndexes: t.LocalSecondaryIndexes.map((i) => indexView(c, t, i, true)) } : {}),
    ...(t.GlobalSecondaryIndexes.length ? { GlobalSecondaryIndexes: t.GlobalSecondaryIndexes.map((i) => indexView(c, t, i, false)) } : {}),
    ...(t.stream?.StreamEnabled ? { StreamSpecification: { StreamEnabled: true, StreamViewType: t.stream.StreamViewType } } : {}),
    ...(ddbHooks.view?.(c.acct, c.region, t) ?? {}),
    DeletionProtectionEnabled: t.DeletionProtectionEnabled,
  };
}

// ───────────────────────── tablas ─────────────────────────

const num = (x: unknown) => Number(x);

function parseKeySchema(list: unknown, what: string): DdbKey[] {
  const ks = (list as { AttributeName?: string; KeyType?: string }[]) ?? [];
  if (!ks.length || ks.length > 2 || ks.some((k) => !k.AttributeName || (k.KeyType !== 'HASH' && k.KeyType !== 'RANGE'))) throw validation(`One or more parameter values were invalid: ${what} must have 1 or 2 elements with KeyType HASH and RANGE`);
  if (ks[0].KeyType !== 'HASH' || (ks[1] && ks[1].KeyType !== 'RANGE')) throw validation('Invalid KeySchema: The first KeySchemaElement is not a HASH key type');
  return ks as DdbKey[];
}

function parseIndex(raw: unknown, throughput: boolean): DdbIndex {
  const r = raw as { IndexName?: string; KeySchema?: unknown; Projection?: { ProjectionType?: string; NonKeyAttributes?: string[] }; ProvisionedThroughput?: Record<string, unknown> };
  if (!r.IndexName) throw validation('One or more parameter values were invalid: IndexName is required');
  const proj = r.Projection;
  if (!proj || !['ALL', 'KEYS_ONLY', 'INCLUDE'].includes(String(proj.ProjectionType))) throw validation('One or more parameter values were invalid: Projection is required');
  return { IndexName: r.IndexName, KeySchema: parseKeySchema(r.KeySchema, 'KeySchema'), Projection: { ProjectionType: proj.ProjectionType as 'ALL', ...(proj.NonKeyAttributes ? { NonKeyAttributes: proj.NonKeyAttributes } : {}) }, ...(throughput && r.ProvisionedThroughput ? { ProvisionedThroughput: { ReadCapacityUnits: num(r.ProvisionedThroughput.ReadCapacityUnits), WriteCapacityUnits: num(r.ProvisionedThroughput.WriteCapacityUnits) } } : {}) };
}

/** Crea una tabla (también para escenarios). */
export function ddbCreate(a: Account, region: string, name: string, o: { pk: [string, 'S' | 'N' | 'B']; sk?: [string, 'S' | 'N' | 'B']; gsi?: { name: string; pk: [string, 'S' | 'N' | 'B']; sk?: [string, 'S' | 'N' | 'B']; projection?: 'ALL' | 'KEYS_ONLY' }[]; items?: Record<string, unknown>[]; provisioned?: [number, number]; tags?: Tag[] }): DdbTable {
  const defs = new Map<string, 'S' | 'N' | 'B'>();
  const ks: DdbKey[] = [{ AttributeName: o.pk[0], KeyType: 'HASH' }];
  defs.set(o.pk[0], o.pk[1]);
  if (o.sk) {
    ks.push({ AttributeName: o.sk[0], KeyType: 'RANGE' });
    defs.set(o.sk[0], o.sk[1]);
  }
  const gsis: DdbIndex[] = (o.gsi ?? []).map((g) => {
    defs.set(g.pk[0], g.pk[1]);
    if (g.sk) defs.set(g.sk[0], g.sk[1]);
    return { IndexName: g.name, KeySchema: [{ AttributeName: g.pk[0], KeyType: 'HASH' as const }, ...(g.sk ? [{ AttributeName: g.sk[0], KeyType: 'RANGE' as const }] : [])], Projection: { ProjectionType: g.projection ?? 'ALL' } };
  });
  const t: DdbTable = {
    TableName: name,
    KeySchema: ks,
    AttributeDefinitions: [...defs].map(([AttributeName, AttributeType]) => ({ AttributeName, AttributeType })),
    BillingMode: o.provisioned ? 'PROVISIONED' : 'PAY_PER_REQUEST',
    ...(o.provisioned ? { ProvisionedThroughput: { ReadCapacityUnits: o.provisioned[0], WriteCapacityUnits: o.provisioned[1] } } : {}),
    GlobalSecondaryIndexes: gsis,
    LocalSecondaryIndexes: [],
    items: {},
    created: a.clock - 60000,
    DeletionProtectionEnabled: false,
    Tags: o.tags ?? [],
  };
  for (const it of o.items ?? []) t.items[keyOf(t, it as Item)] = it;
  tablesOf(a, region)[name] = t;
  return t;
}

op('dynamodb', 'create-table', 'table-name:s! attribute-definitions:f! key-schema:f! billing-mode:s provisioned-throughput:j global-secondary-indexes:j local-secondary-indexes:j stream-specification:j tags:t deletion-protection-enabled:b table-class:s', 'Crea una tabla de DynamoDB (clave de partición y, opcional, de ordenación).', { res: (c) => arn(c, c.p.TableName), paginate: undefined }, (c) => {
  const name = c.p.TableName as string;
  if (name.length < 3 || name.length > 255 || !/^[A-Za-z0-9_.-]+$/.test(name)) throw validation(`1 validation error detected: Value '${name}' at 'tableName' failed to satisfy constraint: Member must have length greater than or equal to 3 and match [a-zA-Z0-9_.-]+`);
  const tables = tablesOf(c.acct, c.region);
  if (tables[name]) throw new AwsError('ResourceInUseException', `Table already exists: ${name}`);
  if (Object.keys(tables).length >= 256) throw new AwsError('LimitExceededException', 'Subscriber limit exceeded: Only 256 tables can be created at once');
  const ks = parseKeySchema(c.p.KeySchema, 'KeySchema');
  const defs = (c.p.AttributeDefinitions as { AttributeName: string; AttributeType: string }[]).map((d) => ({ AttributeName: d.AttributeName, AttributeType: d.AttributeType as 'S' | 'N' | 'B' }));
  for (const d of defs) if (!['S', 'N', 'B'].includes(d.AttributeType)) throw validation(`1 validation error detected: Value '${d.AttributeType}' at 'attributeDefinitions.1.member.attributeType' failed to satisfy constraint: Member must satisfy enum value set: [B, N, S]`);
  const billing = (c.p.BillingMode ?? 'PROVISIONED') as DdbTable['BillingMode'];
  if (billing !== 'PROVISIONED' && billing !== 'PAY_PER_REQUEST') throw validation(`1 validation error detected: Value '${billing}' at 'billingMode' failed to satisfy constraint: Member must satisfy enum value set: [PROVISIONED, PAY_PER_REQUEST]`);
  const pt = c.p.ProvisionedThroughput as { ReadCapacityUnits?: unknown; WriteCapacityUnits?: unknown } | undefined;
  if (billing === 'PROVISIONED' && (!pt || pt.ReadCapacityUnits === undefined || pt.WriteCapacityUnits === undefined)) throw validation('One or more parameter values were invalid: ReadCapacityUnits and WriteCapacityUnits must both be specified when BillingMode is PROVISIONED');
  if (billing === 'PAY_PER_REQUEST' && pt) throw validation('One or more parameter values were invalid: Neither ReadCapacityUnits nor WriteCapacityUnits can be specified when BillingMode is PAY_PER_REQUEST');
  const gsis = ((c.p.GlobalSecondaryIndexes as unknown[]) ?? []).map((g) => parseIndex(g, true));
  const lsis = ((c.p.LocalSecondaryIndexes as unknown[]) ?? []).map((g) => parseIndex(g, false));
  const needed = new Set([...ks.map((k) => k.AttributeName), ...gsis.flatMap((g) => g.KeySchema.map((k) => k.AttributeName)), ...lsis.flatMap((g) => g.KeySchema.map((k) => k.AttributeName))]);
  const have = new Set(defs.map((d) => d.AttributeName));
  if (needed.size !== have.size || [...needed].some((n) => !have.has(n))) throw validation('One or more parameter values were invalid: Number of attributes in KeySchema does not exactly match number of attributes defined in AttributeDefinitions');
  for (const l of lsis) if (l.KeySchema[0].AttributeName !== ks[0].AttributeName || !ks[1]) throw validation('One or more parameter values were invalid: Table KeySchema does not have a range key, which is required when specifying a LocalSecondaryIndex');
  const t: DdbTable = {
    TableName: name,
    KeySchema: ks,
    AttributeDefinitions: defs,
    BillingMode: billing,
    ...(billing === 'PROVISIONED' ? { ProvisionedThroughput: { ReadCapacityUnits: num(pt!.ReadCapacityUnits), WriteCapacityUnits: num(pt!.WriteCapacityUnits) } } : {}),
    GlobalSecondaryIndexes: gsis,
    LocalSecondaryIndexes: lsis,
    ...(c.p.StreamSpecification ? { stream: { StreamEnabled: c.p.StreamSpecification.StreamEnabled === true || c.p.StreamSpecification.StreamEnabled === 'true', StreamViewType: c.p.StreamSpecification.StreamViewType } } : {}),
    items: {},
    created: c.acct.clock,
    DeletionProtectionEnabled: !!c.p.DeletionProtectionEnabled,
    Tags: (c.p.Tags as Tag[]) ?? [],
  };
  tables[name] = t;
  if (c.p.StreamSpecification) ddbHooks.streamSpec?.(c.acct, t, c.p.StreamSpecification);
  return { TableDescription: tableView(c, t) };
});

op('dynamodb', 'describe-table', 'table-name:s!', 'Describe una tabla: claves, índices, capacidad y estado.', { res: tableArn }, (c) => ({ Table: tableView(c, tableFor(c, c.p.TableName)) }));

op('dynamodb', 'list-tables', 'limit:i exclusive-start-table-name:s', 'Lista los nombres de las tablas de la región.', { res: () => '*', paginate: 'TableNames' }, (c) => ({ TableNames: Object.values(tablesOf(c.acct, c.region)).filter((t) => t.deleting === undefined).map((t) => t.TableName).sort() }));

op('dynamodb', 'delete-table', 'table-name:s!', 'Borra una tabla y todos sus elementos.', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  if (t.DeletionProtectionEnabled) throw new AwsError('ValidationException', `Resource cannot be deleted as it is currently in use`);
  t.deleting = c.acct.clock;
  return { TableDescription: { ...tableView(c, t), TableStatus: 'DELETING', ItemCount: 0 } };
});

op('dynamodb', 'update-table', 'table-name:s! billing-mode:s provisioned-throughput:j attribute-definitions:f global-secondary-index-updates:j deletion-protection-enabled:b stream-specification:j replica-updates:j', 'Cambia la capacidad, el modo de facturación, los índices secundarios globales, los streams o las réplicas globales (`--replica-updates`).', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  if (c.p.BillingMode) {
    if (c.p.BillingMode !== 'PROVISIONED' && c.p.BillingMode !== 'PAY_PER_REQUEST') throw validation('Invalid BillingMode');
    t.BillingMode = c.p.BillingMode;
    if (t.BillingMode === 'PAY_PER_REQUEST') t.ProvisionedThroughput = undefined;
  }
  if (c.p.ProvisionedThroughput) {
    if (t.BillingMode === 'PAY_PER_REQUEST') throw validation('One or more parameter values were invalid: Neither ReadCapacityUnits nor WriteCapacityUnits can be specified when BillingMode is PAY_PER_REQUEST');
    t.ProvisionedThroughput = { ReadCapacityUnits: num(c.p.ProvisionedThroughput.ReadCapacityUnits), WriteCapacityUnits: num(c.p.ProvisionedThroughput.WriteCapacityUnits) };
  }
  if (t.BillingMode === 'PROVISIONED' && !t.ProvisionedThroughput) throw validation('One or more parameter values were invalid: ReadCapacityUnits and WriteCapacityUnits must both be specified when BillingMode is PROVISIONED');
  if (c.p.DeletionProtectionEnabled !== undefined) t.DeletionProtectionEnabled = !!c.p.DeletionProtectionEnabled;
  for (const d of (c.p.AttributeDefinitions as { AttributeName: string; AttributeType: 'S' | 'N' | 'B' }[]) ?? []) if (!t.AttributeDefinitions.some((x) => x.AttributeName === d.AttributeName)) t.AttributeDefinitions.push({ AttributeName: d.AttributeName, AttributeType: d.AttributeType });
  for (const u of (c.p.GlobalSecondaryIndexUpdates as { Create?: unknown; Delete?: { IndexName: string } }[]) ?? []) {
    if (u.Create) {
      const g = parseIndex(u.Create, true);
      if (t.GlobalSecondaryIndexes.some((x) => x.IndexName === g.IndexName)) throw new AwsError('ValidationException', `One or more parameter values were invalid: Index already exists: ${g.IndexName}`);
      for (const k of g.KeySchema) if (!t.AttributeDefinitions.some((x) => x.AttributeName === k.AttributeName)) throw validation(`One or more parameter values were invalid: Some index key attributes are not defined in AttributeDefinitions. Keys: [${k.AttributeName}], AttributeDefinitions: [${t.AttributeDefinitions.map((x) => x.AttributeName).join(', ')}]`);
      t.GlobalSecondaryIndexes.push(g);
    } else if (u.Delete) {
      const i = t.GlobalSecondaryIndexes.findIndex((x) => x.IndexName === u.Delete!.IndexName);
      if (i < 0) throw new AwsError('ResourceNotFoundException', `Requested resource not found: Index: ${u.Delete.IndexName} not found`);
      t.GlobalSecondaryIndexes.splice(i, 1);
    }
  }
  if (c.p.StreamSpecification) ddbHooks.streamSpec?.(c.acct, t, c.p.StreamSpecification);
  if (c.p.ReplicaUpdates) ddbHooks.replicaUpdates?.(c, t, c.p.ReplicaUpdates);
  return { TableDescription: { ...tableView(c, t), TableStatus: 'UPDATING' } };
});

op('dynamodb', 'update-time-to-live', 'table-name:s! time-to-live-specification:j!', 'Activa o desactiva el TTL: DynamoDB borra solo los elementos caducados (hasta 48 h después).', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const spec = c.p.TimeToLiveSpecification as { Enabled?: unknown; AttributeName?: string };
  const enabled = spec.Enabled === true || spec.Enabled === 'true';
  if (!spec.AttributeName) throw validation('TimeToLiveSpecification.AttributeName is required');
  t.ttl = { AttributeName: spec.AttributeName, Enabled: enabled };
  return { TimeToLiveSpecification: { Enabled: enabled, AttributeName: spec.AttributeName } };
});

op('dynamodb', 'describe-time-to-live', 'table-name:s!', 'Estado del TTL de una tabla.', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  return { TimeToLiveDescription: t.ttl?.Enabled ? { TimeToLiveStatus: 'ENABLED', AttributeName: t.ttl.AttributeName } : { TimeToLiveStatus: 'DISABLED' } };
});

op('dynamodb', 'tag-resource', 'resource-arn:s! tags:t!', 'Pone etiquetas a una tabla.', { res: (c) => c.p.ResourceArn }, (c) => {
  const t = Object.values(tablesOf(c.acct, c.region)).find((x) => arn(c, x.TableName) === c.p.ResourceArn);
  if (!t) throw notFound();
  for (const tag of c.p.Tags as Tag[]) t.Tags = [...t.Tags.filter((x) => x.Key !== tag.Key), tag];
  return undefined;
});
op('dynamodb', 'list-tags-of-resource', 'resource-arn:s!', 'Etiquetas de una tabla.', { res: (c) => c.p.ResourceArn }, (c) => {
  const t = Object.values(tablesOf(c.acct, c.region)).find((x) => arn(c, x.TableName) === c.p.ResourceArn);
  if (!t) throw notFound();
  return { Tags: t.Tags };
});

// ───────────────────────── elementos ─────────────────────────

const ITEM_PARAMS = 'table-name:s! condition-expression:s expression-attribute-names:j expression-attribute-values:j return-values:s return-consumed-capacity:s';

export function condition(c: OpCtx, cur: Item | undefined): void {
  const src = c.p.ConditionExpression as string | undefined;
  if (!src) return;
  const env = mkEnv(c.p.ExpressionAttributeNames, c.p.ExpressionAttributeValues, 'ConditionExpression');
  const node = parseCondition(src, env);
  checkUnused(env);
  if (!evalCond(node, cur ?? {})) throw new AwsError('ConditionalCheckFailedException', 'The conditional request failed');
}

const returnVals = (c: OpCtx, old: Item | undefined) => (c.p.ReturnValues === 'ALL_OLD' && old ? { Attributes: old } : {});

op('dynamodb', 'put-item', ITEM_PARAMS.replace('table-name:s!', 'table-name:s! item:j!'), 'Crea o reemplaza un elemento entero.', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const item = checkItem(c.p.Item);
  checkKey(t, item, 'item');
  for (const g of [...t.GlobalSecondaryIndexes, ...t.LocalSecondaryIndexes]) for (const k of g.KeySchema) {
    const v = item[k.AttributeName];
    if (v && typeOf(v) !== attrType(t, k.AttributeName)) throw validation(`One or more parameter values were invalid: Type mismatch for Index Key ${k.AttributeName} Expected: ${attrType(t, k.AttributeName)} Actual: ${typeOf(v)} IndexName: ${g.IndexName}`);
  }
  const key = keyOf(t, item);
  const old = t.items[key] as Item | undefined;
  condition(c, old);
  ddbCommit(c.acct, c.region, t, key, old, item);
  return { ...returnVals(c, old), ...capacity(c, t.TableName, wcu(itemSize(item))) };
});

op('dynamodb', 'get-item', 'table-name:s! key:j! consistent-read:b projection-expression:s expression-attribute-names:j return-consumed-capacity:s', 'Lee un elemento por su clave primaria.', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const key = checkItem(c.p.Key);
  checkKey(t, key, 'key');
  const it = t.items[keyOf(t, key)] as Item | undefined;
  const env = mkEnv(c.p.ExpressionAttributeNames, undefined, 'ProjectionExpression');
  const out = it ? project(it, c.p.ProjectionExpression, env) : undefined;
  checkUnused(env);
  return { ...(out ? { Item: out } : {}), ...capacity(c, t.TableName, rcu(it ? itemSize(it) : 0, !!c.p.ConsistentRead)) };
});

op('dynamodb', 'delete-item', 'table-name:s! key:j! condition-expression:s expression-attribute-names:j expression-attribute-values:j return-values:s return-consumed-capacity:s', 'Borra un elemento por su clave.', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const key = checkItem(c.p.Key);
  checkKey(t, key, 'key');
  const k = keyOf(t, key);
  const old = t.items[k] as Item | undefined;
  condition(c, old);
  ddbCommit(c.acct, c.region, t, k, old, undefined);
  return { ...returnVals(c, old), ...capacity(c, t.TableName, wcu(old ? itemSize(old) : 0)) };
});

op('dynamodb', 'update-item', 'table-name:s! key:j! update-expression:s condition-expression:s expression-attribute-names:j expression-attribute-values:j return-values:s return-consumed-capacity:s', 'Cambia atributos de un elemento (lo crea si no existe).', { res: tableArn }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const key = checkItem(c.p.Key);
  checkKey(t, key, 'key');
  const k = keyOf(t, key);
  const old = t.items[k] as Item | undefined;
  const src = c.p.UpdateExpression as string | undefined;
  // la condición y la actualización comparten los marcadores #nombre y :valor
  const env = mkEnv(c.p.ExpressionAttributeNames, c.p.ExpressionAttributeValues, 'ConditionExpression');
  const cond = c.p.ConditionExpression ? parseCondition(c.p.ConditionExpression as string, env) : null;
  env.kind = 'UpdateExpression';
  const acts = src ? parseUpdate(src, env) : [];
  for (const a of acts) if (t.KeySchema.some((x) => x.AttributeName === a.path[0])) throw validation(`One or more parameter values were invalid: Cannot update attribute ${a.path[0]}. This attribute is part of the key`);
  checkUnused(env);
  if (cond && !evalCond(cond, old ?? {})) throw new AwsError('ConditionalCheckFailedException', 'The conditional request failed');
  const next: Item = structuredClone(old ?? key);
  const touched = applyUpdate(acts, next);
  ddbCommit(c.acct, c.region, t, k, old, next);
  const rv = c.p.ReturnValues as string | undefined;
  const pick = (it: Item | undefined) => (it ? Object.fromEntries(touched.filter((n) => it[n]).map((n) => [n, it[n]])) : {});
  const attrs = rv === 'ALL_NEW' ? next : rv === 'ALL_OLD' ? old : rv === 'UPDATED_NEW' ? pick(next) : rv === 'UPDATED_OLD' ? pick(old) : undefined;
  return { ...(attrs && Object.keys(attrs).length ? { Attributes: attrs } : {}), ...capacity(c, t.TableName, wcu(itemSize(next))) };
});

// ───────────────────────── query y scan ─────────────────────────

const hashOrder = (a: Item, t: DdbTable) => md5(canon(a[pkName(t.KeySchema)]));

interface Source {
  keys: DdbKey[];
  items: Item[];
  index?: DdbIndex;
}

function sourceOf(c: OpCtx, t: DdbTable): Source {
  const name = c.p.IndexName as string | undefined;
  if (!name) return { keys: t.KeySchema, items: Object.values(t.items) as Item[] };
  const idx = [...t.GlobalSecondaryIndexes, ...t.LocalSecondaryIndexes].find((i) => i.IndexName === name);
  if (!idx) throw validation(`The table does not have the specified index: ${name}`);
  return { keys: idx.KeySchema, items: (Object.values(t.items) as Item[]).filter((it) => keyOfIndex(idx.KeySchema, it) !== null), index: idx };
}

/** Lo que devuelve un índice: todo, solo claves (de la tabla y del índice) o claves más atributos elegidos. */
function projected(t: DdbTable, s: Source, it: Item): Item {
  const p = s.index?.Projection;
  if (!p || p.ProjectionType === 'ALL') return it;
  const keep = new Set([...t.KeySchema, ...s.keys].map((k) => k.AttributeName).concat(p.ProjectionType === 'INCLUDE' ? (p.NonKeyAttributes ?? []) : []));
  return Object.fromEntries(Object.entries(it).filter(([k]) => keep.has(k)));
}

function page(c: OpCtx, t: DdbTable, s: Source, rows: Item[], matches: (it: Item) => boolean, ordered: boolean): Record<string, unknown> {
  const limit = c.p.Limit as number | undefined;
  const start = c.p.ExclusiveStartKey ? checkItem(c.p.ExclusiveStartKey) : undefined;
  let list = rows;
  if (start) {
    const sk = keyOf(t, start);
    const i = list.findIndex((it) => keyOf(t, it) === sk);
    list = i >= 0 ? list.slice(i + 1) : list;
  }
  const out: Item[] = [];
  let scanned = 0;
  let bytes = 0;
  let last: Item | undefined;
  let more = false;
  for (const it of list) {
    if (limit !== undefined && scanned >= limit) {
      more = true;
      break;
    }
    scanned++;
    bytes += itemSize(it);
    last = it;
    if (matches(it)) out.push(it);
  }
  const env = mkEnv(c.p.ExpressionAttributeNames, undefined, 'ProjectionExpression');
  const shown = c.p.Select === 'COUNT' ? [] : out.map((it) => project(projected(t, s, it), c.p.ProjectionExpression, env));
  void ordered;
  return {
    ...(c.p.Select === 'COUNT' ? {} : { Items: shown }),
    Count: out.length,
    ScannedCount: scanned,
    ...(more && last ? { LastEvaluatedKey: { ...keyPart(t, last), ...Object.fromEntries(s.keys.map((k) => [k.AttributeName, last![k.AttributeName]])) } } : {}),
    ...capacity(c, t.TableName, rcu(bytes, !!c.p.ConsistentRead && !s.index)),
  };
}

function filterNode(c: OpCtx, env: ReturnType<typeof mkEnv>) {
  const src = c.p.FilterExpression as string | undefined;
  if (!src) return null;
  env.kind = 'FilterExpression';
  return parseCondition(src, env);
}

const QUERY_PARAMS = 'table-name:s! index-name:s select:s limit:i consistent-read:b scan-index-forward:b exclusive-start-key:j projection-expression:s filter-expression:s expression-attribute-names:j expression-attribute-values:j return-consumed-capacity:s';

op('dynamodb', 'query', QUERY_PARAMS.replace('index-name:s', 'index-name:s key-condition-expression:s'), 'Busca elementos de una misma partición (opcionalmente acotados por la clave de ordenación).', { res: (c) => (c.p.IndexName ? `${arn(c, c.p.TableName)}/index/${c.p.IndexName}` : tableArn(c)), paginate: undefined }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const s = sourceOf(c, t);
  const kc = c.p.KeyConditionExpression as string | undefined;
  if (!kc) throw validation('Either the KeyConditions or KeyConditionExpression parameter must be specified in the request.');
  const env = mkEnv(c.p.ExpressionAttributeNames, c.p.ExpressionAttributeValues, 'KeyConditionExpression');
  const pk = pkName(s.keys);
  const sk = skName(s.keys);
  const { pkValue, node } = parseKeyCondition(kc, env, pk, sk);
  const filt = filterNode(c, env);
  env.kind = 'ProjectionExpression';
  checkUnused(env);
  if (typeOf(pkValue) !== attrType(t, pk)) throw validation(`One or more parameter values were invalid: Condition parameter type does not match schema type`);
  let rows = s.items.filter((it) => equalPk(it[pk], pkValue) && evalCond(node, it));
  rows.sort((a, b) => (sk ? (compare(a[sk], b[sk]) ?? 0) : 0));
  if (c.p.ScanIndexForward === false) rows = rows.reverse();
  return page(c, t, s, rows, (it) => (filt ? evalCond(filt, it) : true), true);
});

const equalPk = (a: AV | undefined, b: AV) => !!a && canon(a) === canon(b);

op('dynamodb', 'scan', QUERY_PARAMS + ' segment:i total-segments:i', 'Lee TODA la tabla (o índice) y filtra después: caro en tablas grandes.', { res: (c) => (c.p.IndexName ? `${arn(c, c.p.TableName)}/index/${c.p.IndexName}` : tableArn(c)), paginate: undefined }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const s = sourceOf(c, t);
  const env = mkEnv(c.p.ExpressionAttributeNames, c.p.ExpressionAttributeValues, 'FilterExpression');
  const filt = filterNode(c, env);
  env.kind = 'ProjectionExpression';
  checkUnused(env);
  // sin garantía de orden: se devuelven por el hash de la clave de partición, como hace DynamoDB
  const rows = [...s.items].sort((a, b) => (hashOrder(a, t) < hashOrder(b, t) ? -1 : hashOrder(a, t) > hashOrder(b, t) ? 1 : 0));
  return page(c, t, s, rows, (it) => (filt ? evalCond(filt, it) : true), false);
});

// ───────────────────────── lotes ─────────────────────────

op('dynamodb', 'batch-write-item', 'request-items:j! return-consumed-capacity:s', 'Escribe o borra hasta 25 elementos de varias tablas de una vez.', { res: () => '*', authz: (c) => Object.keys(c.p.RequestItems ?? {}).map((n) => ({ action: 'dynamodb:BatchWriteItem', resource: arn(c, n) })) }, (c) => {
  const req = c.p.RequestItems as Record<string, { PutRequest?: { Item: Item }; DeleteRequest?: { Key: Item } }[]>;
  const total = Object.values(req).reduce((n, l) => n + l.length, 0);
  if (total > 25) throw validation('Too many items requested for the BatchWriteItem call');
  for (const [name, list] of Object.entries(req)) {
    const t = tableFor(c, name);
    for (const r of list) {
      if (r.PutRequest) checkKey(t, checkItem(r.PutRequest.Item), 'item');
      else if (r.DeleteRequest) checkKey(t, checkItem(r.DeleteRequest.Key), 'key');
      else throw validation('Supplied AttributeValue has more than one datatypes set, must contain exactly one of the supported datatypes');
    }
  }
  for (const [name, list] of Object.entries(req)) {
    const t = tableFor(c, name);
    for (const r of list) {
      if (r.PutRequest) {
        const k = keyOf(t, r.PutRequest.Item);
        ddbCommit(c.acct, c.region, t, k, t.items[k] as Item | undefined, r.PutRequest.Item);
      } else {
        const k = keyOf(t, r.DeleteRequest!.Key);
        ddbCommit(c.acct, c.region, t, k, t.items[k] as Item | undefined, undefined);
      }
    }
  }
  return { UnprocessedItems: {} };
});

op('dynamodb', 'batch-get-item', 'request-items:j! return-consumed-capacity:s', 'Lee hasta 100 elementos de varias tablas de una vez.', { res: () => '*', authz: (c) => Object.keys(c.p.RequestItems ?? {}).map((n) => ({ action: 'dynamodb:BatchGetItem', resource: arn(c, n) })) }, (c) => {
  const req = c.p.RequestItems as Record<string, { Keys: Item[]; ProjectionExpression?: string; ExpressionAttributeNames?: Record<string, string> }>;
  const out: Record<string, Item[]> = {};
  for (const [name, spec] of Object.entries(req)) {
    const t = tableFor(c, name);
    out[name] = [];
    for (const k of spec.Keys) {
      checkKey(t, checkItem(k), 'key');
      const it = t.items[keyOf(t, k)] as Item | undefined;
      if (it) out[name].push(project(it, spec.ProjectionExpression, mkEnv(spec.ExpressionAttributeNames, undefined, 'ProjectionExpression')));
    }
  }
  return { Responses: out, UnprocessedKeys: {} };
});

// ───────────────────────── esperas ─────────────────────────

op('dynamodb', 'wait', 'waiter:s! table-name:s!', 'Espera a que una tabla exista (`table-exists`) o desaparezca (`table-not-exists`).', { positional: ['waiter'], res: () => '*', authz: false }, (c) => {
  const w = c.p.Waiter as string;
  if (w !== 'table-exists' && w !== 'table-not-exists') throw new AwsError('InvalidWaiter', `Invalid choice: '${w}', valid choices are: table-exists, table-not-exists`);
  for (let k = 0; k < 40; k++) {
    const t = tablesOf(c.acct, c.region)[c.p.TableName];
    if (w === 'table-exists' ? t && status(c.acct, t) === 'ACTIVE' : !t) return undefined;
    c.acct.clock += 5000;
  }
  throw new AwsError('WaiterError', `Waiter ${w} failed: Max attempts exceeded`);
});

void checkValue;
