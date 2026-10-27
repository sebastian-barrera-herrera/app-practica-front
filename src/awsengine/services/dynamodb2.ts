/** DynamoDB a fondo: streams (y su disparador de Lambda), TTL real, transacciones, tablas globales y copias de seguridad / recuperación a un momento dado. */
import { b64decode, b64encode, md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { isRegion } from '../catalog';
import { checkItem, evalCond, itemSize, mkEnv, parseCondition, project, validation, type Item } from '../ddb';
import { AwsError, OPS, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, DdbBackup, DdbStreamRecord, DdbTable, LambdaEsm, LambdaFn } from '../types';
import { iso } from '../util';
import { arn, checkKey, ddbCommit, ddbHooks, keyOf, tableFor, tablesOf } from './dynamodb';
import { roleCan } from './flowlogs';
import { deliver, esmHooks, runFunction } from './lambda';

const TTL_LAG_MS = 5 * 60000;
const STREAM_RETENTION_S = 24 * 3600;
const PITR_WINDOW_MS = 35 * 86400000;

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const keyOfItem = (t: DdbTable, it: Item) => Object.fromEntries(t.KeySchema.map((k) => [k.AttributeName, it[k.AttributeName]]));

// ───────────────────────── streams ─────────────────────────

const streamArn = (a: Account, region: string, t: DdbTable) => `arn:aws:dynamodb:${region}:${a.id}:table/${t.TableName}/stream/${t.stream?.label ?? ''}`;

function record(a: Account, region: string, t: DdbTable, old: Item | undefined, next: Item | undefined, by?: 'ttl'): void {
  const st = t.stream;
  if (!st?.StreamEnabled) return;
  const type = st.StreamViewType ?? 'NEW_AND_OLD_IMAGES';
  const seq = (st.seq ?? 0) + 1;
  st.seq = seq;
  const img = (it: Item | undefined) => (it ? structuredClone(it) : undefined);
  const rec: DdbStreamRecord = {
    eventID: md5(`${t.TableName}${st.label}${seq}`).slice(0, 32),
    eventName: !old ? 'INSERT' : !next ? 'REMOVE' : 'MODIFY',
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: region,
    dynamodb: {
      ApproximateCreationDateTime: Math.floor(a.clock / 1000),
      Keys: keyOfItem(t, (next ?? old)!),
      ...(next && (type === 'NEW_IMAGE' || type === 'NEW_AND_OLD_IMAGES') ? { NewImage: img(next) } : {}),
      ...(old && (type === 'OLD_IMAGE' || type === 'NEW_AND_OLD_IMAGES') ? { OldImage: img(old) } : {}),
      SequenceNumber: String(seq).padStart(21, '0'),
      SizeBytes: itemSize((next ?? old)!) + 20,
      StreamViewType: type,
    },
    ...(by === 'ttl' ? { userIdentity: { type: 'Service', principalId: 'dynamodb.amazonaws.com' } } : {}),
  };
  (st.records ??= []).push(rec);
  const cutoff = a.clock / 1000 - STREAM_RETENTION_S;
  while (st.records.length && st.records[0].dynamodb.ApproximateCreationDateTime < cutoff) st.records.shift();
}

ddbHooks.streamSpec = (a, t, spec) => {
  const enabled = spec.StreamEnabled === true || spec.StreamEnabled === 'true';
  if (enabled) {
    const view = spec.StreamViewType;
    if (!view || !['KEYS_ONLY', 'NEW_IMAGE', 'OLD_IMAGE', 'NEW_AND_OLD_IMAGES'].includes(view)) throw validation('One or more parameter values were invalid: StreamViewType must be one of KEYS_ONLY, NEW_IMAGE, OLD_IMAGE or NEW_AND_OLD_IMAGES');
    if (t.stream?.StreamEnabled && t.stream.label) throw validation('One or more parameter values were invalid: Table already has an enabled stream');
    t.stream = { StreamEnabled: true, StreamViewType: view, label: new Date(a.clock).toISOString().replace('Z', ''), seq: 0, records: [] };
  } else {
    if (!t.stream?.StreamEnabled) throw validation('One or more parameter values were invalid: Table does not have an enabled stream');
    if (t.replicas?.length) throw validation('One or more parameter values were invalid: Streams cannot be disabled on a table that has global replicas');
    t.stream = { ...t.stream, StreamEnabled: false };
  }
};

// ───────────────────────── cambios: stream, réplicas y recuperación ─────────────────────────

let replicating = false;

ddbHooks.change = (a, region, t, k, old, next, by) => {
  if (!old && !next) return;
  if (old && next && same(old, next)) return;
  record(a, region, t, old, next, by);
  if (t.pitr) t.pitr.log.push({ at: a.clock, k, next: next ? structuredClone(next) : undefined });
  if (!replicating && t.replicas?.length) {
    replicating = true;
    try {
      for (const r of t.replicas) {
        const rt = tablesOf(a, r)[t.TableName];
        if (rt) ddbCommit(a, r, rt, k, rt.items[k] as Item | undefined, next ? structuredClone(next) : undefined);
      }
    } finally {
      replicating = false;
    }
  }
};

ddbHooks.view = (a, region, t) => ({
  ...(t.stream?.label && t.stream.StreamEnabled ? { LatestStreamArn: streamArn(a, region, t), LatestStreamLabel: t.stream.label } : {}),
  ...(t.replicas?.length ? { GlobalTableVersion: '2019.11.21', Replicas: [...t.replicas, region].sort().map((r) => ({ RegionName: r, ReplicaStatus: 'ACTIVE' })) } : {}),
  ...(t.globalOrigin ? { TableClassSummary: { TableClass: 'STANDARD' } } : {}),
});

ddbHooks.replicaUpdates = (c, t, updates) => {
  for (const u of updates) {
    if (u.Create) {
      const r = u.Create.RegionName;
      if (!isRegion(r)) throw validation(`One or more parameter values were invalid: Region ${r} is not a valid region`);
      if (r === c.region) throw validation('One or more parameter values were invalid: Cannot create a replica in the same region as the source table');
      if (t.stream?.StreamViewType !== 'NEW_AND_OLD_IMAGES' || !t.stream.StreamEnabled) throw validation('One or more parameter values were invalid: Table must have DynamoDB Streams enabled with StreamViewType NEW_AND_OLD_IMAGES to create replicas');
      if (t.BillingMode !== 'PAY_PER_REQUEST') throw validation('One or more parameter values were invalid: Replicas require on-demand capacity (PAY_PER_REQUEST) or auto scaling on the write capacity; this simulator supports on-demand');
      const target = tablesOf(c.acct, r);
      if (target[t.TableName]) throw new AwsError('ResourceInUseException', `Table already exists: ${t.TableName} in region ${r}`);
      const members = [c.region, ...(t.replicas ?? [])];
      const rep: DdbTable = structuredClone({ ...t, stream: undefined, replicas: undefined, pitr: undefined, ttl: undefined });
      rep.created = c.acct.clock;
      rep.globalOrigin = t.globalOrigin ?? c.region;
      rep.stream = { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES', label: new Date(c.acct.clock).toISOString().replace('Z', ''), seq: 0, records: [] };
      rep.replicas = members;
      target[t.TableName] = rep;
      for (const m of members) {
        const mt = m === c.region ? t : tablesOf(c.acct, m)[t.TableName];
        if (mt) mt.replicas = [...new Set([...(mt.replicas ?? []), r])].filter((x) => x !== m);
      }
    } else if (u.Delete) {
      const r = u.Delete.RegionName;
      const target = tablesOf(c.acct, r);
      if (!t.replicas?.includes(r) || !target[t.TableName]) throw new AwsError('ReplicaNotFoundException', `Replica not found for table ${t.TableName} in region ${r}`);
      delete target[t.TableName];
      for (const m of [c.region, ...t.replicas]) {
        const mt = m === c.region ? t : tablesOf(c.acct, m)[t.TableName];
        if (mt) mt.replicas = (mt.replicas ?? []).filter((x) => x !== r);
      }
    }
  }
  for (const m of [c.region]) {
    const mt = tablesOf(c.acct, m)[t.TableName];
    if (mt && !mt.replicas?.length) mt.replicas = undefined;
  }
};

// ───────────────────────── TTL ─────────────────────────

tickers.push((a) => {
  for (const [region, r] of Object.entries(a.regions)) {
    for (const t of Object.values(r.ddb ?? {})) {
      if (!t.ttl?.Enabled || t.deleting !== undefined) continue;
      const attr = t.ttl.AttributeName;
      for (const [k, it] of Object.entries(t.items)) {
        const v = (it as Item)[attr];
        if (v?.N !== undefined && Number(v.N) * 1000 + TTL_LAG_MS <= a.clock) ddbCommit(a, region, t, k, it as Item, undefined, 'ttl');
      }
    }
  }
});

// ───────────────────────── API de streams ─────────────────────────

function findStream(c: Pick<OpCtx, 'acct' | 'region'>, streamArnText: string): DdbTable | undefined {
  const m = /^arn:aws:dynamodb:([a-z0-9-]+):\d+:table\/([^/]+)\/stream\/(.+)$/.exec(streamArnText);
  if (!m) return undefined;
  const t = tablesOf(c.acct, m[1])[m[2]];
  return t?.stream?.label === m[3] ? t : undefined;
}

const shardId = (t: DdbTable) => `shardId-${String(Date.parse(t.stream?.label ?? '') || 0).padStart(20, '0')}-${md5(t.TableName).slice(0, 8)}`;
const notFound = (arnText: string) => new AwsError('ResourceNotFoundException', `Requested resource not found: Stream: ${arnText} not found`, 400);

op('dynamodbstreams', 'list-streams', 'table-name:s limit:i exclusive-start-stream-arn:s', 'Lista los streams de la región (uno por cada tabla con streams activados).', { res: () => '*', action: 'dynamodb:ListStreams', paginate: 'Streams' }, (c) => ({
  Streams: Object.values(tablesOf(c.acct, c.region))
    .filter((t) => t.stream?.label && (!c.p.TableName || t.TableName === c.p.TableName))
    .map((t) => ({ StreamArn: streamArn(c.acct, c.region, t), TableName: t.TableName, StreamLabel: t.stream!.label })),
}));

op('dynamodbstreams', 'describe-stream', 'stream-arn:s! limit:i exclusive-start-shard-id:s', 'Describe un stream: tabla, tipo de imágenes y fragmentos (shards).', { res: (c) => c.p.StreamArn, action: 'dynamodb:DescribeStream' }, (c) => {
  const t = findStream(c, c.p.StreamArn);
  if (!t) throw notFound(c.p.StreamArn);
  const first = t.stream!.records?.[0]?.dynamodb.SequenceNumber ?? String((t.stream!.seq ?? 0) + 1).padStart(21, '0');
  return {
    StreamDescription: {
      StreamArn: c.p.StreamArn,
      StreamLabel: t.stream!.label,
      StreamStatus: t.stream!.StreamEnabled ? 'ENABLED' : 'DISABLED',
      StreamViewType: t.stream!.StreamViewType,
      CreationRequestDateTime: iso(Date.parse(t.stream!.label ?? '') || c.acct.clock),
      TableName: t.TableName,
      KeySchema: t.KeySchema,
      Shards: [{ ShardId: shardId(t), SequenceNumberRange: { StartingSequenceNumber: first } }],
    },
  };
});

op('dynamodbstreams', 'get-shard-iterator', 'stream-arn:s! shard-id:s! shard-iterator-type:s! sequence-number:s', 'Devuelve un puntero para leer un fragmento: `TRIM_HORIZON` (desde el principio), `LATEST` (solo lo nuevo) o desde un número de secuencia.', { res: (c) => c.p.StreamArn, action: 'dynamodb:GetShardIterator' }, (c) => {
  const t = findStream(c, c.p.StreamArn);
  if (!t) throw notFound(c.p.StreamArn);
  if (c.p.ShardId !== shardId(t)) throw new AwsError('ResourceNotFoundException', `Requested resource not found: Shard does not exist`, 400);
  const type = c.p.ShardIteratorType as string;
  let after: number;
  if (type === 'TRIM_HORIZON') after = 0;
  else if (type === 'LATEST') after = t.stream!.seq ?? 0;
  else if (type === 'AT_SEQUENCE_NUMBER' || type === 'AFTER_SEQUENCE_NUMBER') {
    if (!c.p.SequenceNumber) throw validation('SequenceNumber is required for AT_SEQUENCE_NUMBER and AFTER_SEQUENCE_NUMBER iterators');
    after = Number(c.p.SequenceNumber) - (type === 'AT_SEQUENCE_NUMBER' ? 1 : 0);
  } else throw validation(`1 validation error detected: Value '${type}' at 'shardIteratorType' failed to satisfy constraint: Member must satisfy enum value set: [AFTER_SEQUENCE_NUMBER, LATEST, AT_SEQUENCE_NUMBER, TRIM_HORIZON]`);
  return { ShardIterator: b64encode(JSON.stringify({ s: c.p.StreamArn, after })) };
});

op('dynamodbstreams', 'get-records', 'shard-iterator:s! limit:i', 'Lee los registros del fragmento a partir del puntero y devuelve el siguiente.', { res: () => '*', action: 'dynamodb:GetRecords' }, (c) => {
  let it: { s: string; after: number };
  try {
    it = JSON.parse(b64decode(c.p.ShardIterator) ?? '') as typeof it;
  } catch {
    throw new AwsError('ValidationException', 'Invalid ShardIterator.', 400);
  }
  const t = findStream(c, it.s);
  if (!t) throw notFound(it.s);
  const recs = (t.stream!.records ?? []).filter((r) => Number(r.dynamodb.SequenceNumber) > it.after).slice(0, c.p.Limit ?? 1000);
  const last = recs.length ? Number(recs[recs.length - 1].dynamodb.SequenceNumber) : it.after;
  return { Records: recs, NextShardIterator: b64encode(JSON.stringify({ s: it.s, after: last })) };
});

// ───────────────────────── Lambda ← stream ─────────────────────────

esmHooks.validateStream = (c, fn, src) => {
  const t = findStream(c, src);
  if (!t || !t.stream?.StreamEnabled) throw new AwsError('InvalidParameterValueException', `Stream not found: ${src}`, 400);
  if (!roleCan(c.acct, fn.Role, ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'], src))
    throw new AwsError('InvalidParameterValueException', `Cannot access stream ${src}. Please ensure the role can perform the GetRecords, GetShardIterator, DescribeStream, ListShards, and ListStreams Actions on your stream in IAM.`, 400);
};

esmHooks.streamHead = (a, src) => findStream({ acct: a, region: '' }, src)?.stream?.seq ?? 0;

esmHooks.pollStream = (a: Account, region: string, m: LambdaEsm, fn: LambdaFn) => {
  const t = findStream({ acct: a, region }, m.EventSourceArn);
  if (!t?.stream) return;
  const invoke = (recs: DdbStreamRecord[]): { ok: boolean; upTo: number } => {
    const out = runFunction(a, region, fn, undefined, JSON.stringify({ Records: recs.map((r) => ({ ...r, eventSourceARN: m.EventSourceArn })) }));
    a.clock += Math.ceil(out.durationMs);
    if (out.functionError) return { ok: false, upTo: Number(recs[0].dynamodb.SequenceNumber) - 1 };
    if (m.FunctionResponseTypes.includes('ReportBatchItemFailures')) {
      try {
        const bad = ((JSON.parse(out.payload) as { batchItemFailures?: { itemIdentifier: string }[] } | null)?.batchItemFailures ?? []).map((x) => Number(x.itemIdentifier));
        if (bad.length) return { ok: false, upTo: Math.min(...bad) - 1 };
      } catch {
        return { ok: false, upTo: Number(recs[0].dynamodb.SequenceNumber) - 1 };
      }
    }
    return { ok: true, upTo: Number(recs[recs.length - 1].dynamodb.SequenceNumber) };
  };
  for (let round = 0; round < 50; round++) {
    const recs = (t.stream.records ?? []).filter((r) => Number(r.dynamodb.SequenceNumber) > (m.afterSeq ?? 0)).slice(0, Math.min(m.BatchSize, 1000));
    if (!recs.length) return;
    // con «bisect», un lote que falla se parte en mitades para aislar el registro malo
    const process = (list: DdbStreamRecord[]): boolean => {
      const r = invoke(list);
      m.afterSeq = Math.max(m.afterSeq ?? 0, r.upTo);
      if (r.ok) return true;
      if (m.BisectBatchOnFunctionError && list.length > 1) {
        const rest = list.filter((x) => Number(x.dynamodb.SequenceNumber) > r.upTo);
        const half = Math.ceil(rest.length / 2);
        return process(rest.slice(0, half)) && process(rest.slice(half));
      }
      return false;
    };
    if (process(recs)) {
      m.failures = 0;
      continue;
    }
    m.failures = (m.failures ?? 0) + 1;
    const max = m.MaximumRetryAttempts ?? -1;
    if (max >= 0 && m.failures > max) {
      const failed = (t.stream.records ?? []).filter((r) => Number(r.dynamodb.SequenceNumber) > (m.afterSeq ?? 0)).slice(0, Math.min(m.BatchSize, 1000));
      if (m.OnFailure && failed.length)
        deliver(
          a,
          m.OnFailure,
          JSON.stringify({
            version: '1.0',
            timestamp: iso(a.clock).replace('+00:00', '.000Z'),
            requestContext: { requestId: md5(m.UUID + a.clock).slice(0, 32), functionArn: m.FunctionArn, condition: 'RetryAttemptsExhausted', approximateInvokeCount: m.failures },
            responseContext: { statusCode: 200, executedVersion: '$LATEST', functionError: 'Unhandled' },
            DDBStreamBatchInfo: { shardId: shardId(t), startSequenceNumber: failed[0].dynamodb.SequenceNumber, endSequenceNumber: failed[failed.length - 1].dynamodb.SequenceNumber, approximateArrivalOfFirstRecord: iso(failed[0].dynamodb.ApproximateCreationDateTime * 1000), approximateArrivalOfLastRecord: iso(failed[failed.length - 1].dynamodb.ApproximateCreationDateTime * 1000), batchSize: failed.length, streamArn: m.EventSourceArn },
          }),
        );
      if (failed.length) m.afterSeq = Number(failed[failed.length - 1].dynamodb.SequenceNumber);
      m.failures = 0;
      continue;
    }
    return; // el lote sigue atascado: Lambda lo reintenta en la siguiente vuelta, y el resto del fragmento espera
  }
};

// ───────────────────────── transacciones ─────────────────────────

type TxItem = { Put?: Record<string, unknown>; Update?: Record<string, unknown>; Delete?: Record<string, unknown>; ConditionCheck?: Record<string, unknown> };
const TX_KINDS = ['Put', 'Update', 'Delete', 'ConditionCheck'] as const;
const TX_ACTION = { Put: 'dynamodb:PutItem', Update: 'dynamodb:UpdateItem', Delete: 'dynamodb:DeleteItem', ConditionCheck: 'dynamodb:ConditionCheckItem' };
const TX_OP = { Put: 'put-item', Update: 'update-item', Delete: 'delete-item' } as const;

const txKind = (it: TxItem): (typeof TX_KINDS)[number] => {
  const kinds = TX_KINDS.filter((k) => it[k] !== undefined);
  if (kinds.length !== 1) throw validation('TransactItems can only contain one of Check, Put, Update or Delete');
  return kinds[0];
};

const tokens = new WeakMap<Account, Map<string, { sig: string; at: number }>>();

op(
  'dynamodb',
  'transact-write-items',
  'transact-items:j! client-request-token:s return-consumed-capacity:s',
  'Hasta 100 escrituras (Put, Update, Delete y ConditionCheck) que se aplican TODAS o NINGUNA, incluso entre tablas distintas.',
  { res: () => '*', authz: (c) => ((c.p.TransactItems as TxItem[]) ?? []).map((it) => { const k = txKind(it); return { action: TX_ACTION[k], resource: arn(c, String((it[k] as { TableName?: string }).TableName)) }; }) },
  (c) => {
    const items = (c.p.TransactItems ?? []) as TxItem[];
    if (!items.length) throw validation("1 validation error detected: Value '[]' at 'transactItems' failed to satisfy constraint: Member must have length greater than or equal to 1");
    if (items.length > 100) throw validation(`1 validation error detected: Value '${JSON.stringify(items).slice(0, 40)}…' at 'transactItems' failed to satisfy constraint: Member must have length less than or equal to 100`);
    const sig = md5(JSON.stringify(items));
    if (c.p.ClientRequestToken) {
      const seen = tokens.get(c.acct)?.get(c.p.ClientRequestToken);
      if (seen && c.acct.clock - seen.at < 10 * 60000) {
        if (seen.sig === sig) return {};
        throw new AwsError('IdempotentParameterMismatchException', 'Specified token has already been used for a different request.', 400);
      }
    }
    const touched = new Set<string>();
    const involved = new Map<string, DdbTable>();
    const prepared = items.map((it) => {
      const kind = txKind(it);
      const spec = it[kind] as Record<string, unknown> & { TableName: string; Item?: Item; Key?: Item };
      const t = tableFor(c, spec.TableName);
      involved.set(t.TableName, t);
      let k: string;
      if (kind === 'Put') {
        const item = checkItem(spec.Item);
        checkKey(t, item, 'item');
        k = keyOf(t, item);
      } else {
        const key = checkItem(spec.Key);
        checkKey(t, key, 'key');
        k = keyOf(t, key);
      }
      if (touched.has(t.TableName + '\u0002' + k)) throw validation('Transaction request cannot include multiple operations on one item');
      touched.add(t.TableName + '\u0002' + k);
      return { kind, spec, t, k };
    });
    // 1. todas las condiciones antes de tocar nada
    const reasons = prepared.map((p) => {
      const cond = p.spec.ConditionExpression as string | undefined;
      if (!cond) return 'None';
      // los marcadores de la condición y los de la actualización comparten el mismo mapa: aquí no se exige que todos se usen
      const env = mkEnv(p.spec.ExpressionAttributeNames, p.spec.ExpressionAttributeValues, 'ConditionExpression');
      return evalCond(parseCondition(cond, env), (p.t.items[p.k] as Item | undefined) ?? {}) ? 'None' : 'ConditionalCheckFailed';
    });
    if (reasons.some((r) => r !== 'None')) throw new AwsError('TransactionCanceledException', `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.join(', ')}]`, 400);
    // 2. aplicarlas; si algo falla (p. ej. una expresión de actualización inválida) se deshace todo
    const snap = [...involved.values()].map((t) => ({ t, items: structuredClone(t.items), seq: t.stream?.seq, recs: t.stream?.records?.length }));
    try {
      for (const p of prepared) {
        if (p.kind === 'ConditionCheck') continue;
        const o = OPS.get(`dynamodb/${TX_OP[p.kind]}`)!;
        o.handler({ ...c, p: { ...p.spec }, op: o } as OpCtx);
      }
    } catch (e) {
      for (const s of snap) {
        s.t.items = s.items;
        if (s.t.stream && s.recs !== undefined) {
          s.t.stream.seq = s.seq;
          s.t.stream.records = (s.t.stream.records ?? []).slice(0, s.recs);
        }
      }
      throw e;
    }
    if (c.p.ClientRequestToken) {
      const m = tokens.get(c.acct) ?? new Map();
      m.set(c.p.ClientRequestToken, { sig, at: c.acct.clock });
      tokens.set(c.acct, m);
    }
    return c.p.ReturnConsumedCapacity === 'TOTAL' ? { ConsumedCapacity: [...involved.keys()].map((TableName) => ({ TableName, CapacityUnits: items.length * 2 })) } : {};
  },
);

op(
  'dynamodb',
  'transact-get-items',
  'transact-items:j! return-consumed-capacity:s',
  'Hasta 100 lecturas coherentes entre tablas, todas de un mismo instante.',
  { res: () => '*', authz: (c) => ((c.p.TransactItems as { Get: { TableName: string } }[]) ?? []).map((it) => ({ action: 'dynamodb:GetItem', resource: arn(c, it.Get.TableName) })) },
  (c) => {
    const items = (c.p.TransactItems ?? []) as { Get?: { TableName: string; Key: Item; ProjectionExpression?: string; ExpressionAttributeNames?: Record<string, string> } }[];
    if (!items.length || items.length > 100) throw validation('1 validation error detected: transactItems must have between 1 and 100 elements');
    return {
      Responses: items.map((it) => {
        if (!it.Get) throw validation('TransactItems can only contain Get');
        const t = tableFor(c, it.Get.TableName);
        const key = checkItem(it.Get.Key);
        checkKey(t, key, 'key');
        const found = t.items[keyOf(t, key)] as Item | undefined;
        return found ? { Item: project(found, it.Get.ProjectionExpression, mkEnv(it.Get.ExpressionAttributeNames, undefined, 'ProjectionExpression')) } : {};
      }),
      ...(c.p.ReturnConsumedCapacity === 'TOTAL' ? { ConsumedCapacity: [] } : {}),
    };
  },
);

// ───────────────────────── copias de seguridad y recuperación a un momento dado ─────────────────────────

const backups = (a: Account, region: string): Record<string, DdbBackup> => (regional(a, region).ddbBackups ??= {});
const backupArn = (c: OpCtx, table: string, at: number) => `arn:aws:dynamodb:${c.region}:${c.acct.id}:table/${table}/backup/${String(at).padStart(14, '0')}-${md5(table + at).slice(0, 8)}`;
const backupView = (b: DdbBackup) => ({ BackupArn: b.BackupArn, BackupName: b.BackupName, BackupStatus: 'AVAILABLE', BackupType: 'USER', BackupCreationDateTime: iso(b.BackupCreationDateTime), BackupSizeBytes: Object.values(b.table.items).reduce((n, it) => n + itemSize(it as Item), 0) });

op('dynamodb', 'create-backup', 'table-name:s! backup-name:s!', 'Hace una copia de seguridad bajo demanda de la tabla (sin afectar a su rendimiento). Se conserva hasta que la borres.', { res: (c) => arn(c, c.p.TableName), action: 'dynamodb:CreateBackup' }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const at = c.acct.clock;
  const b: DdbBackup = { BackupArn: backupArn(c, t.TableName, at), BackupName: c.p.BackupName, TableName: t.TableName, BackupCreationDateTime: at, table: structuredClone({ ...t, stream: undefined, replicas: undefined, pitr: undefined }) };
  backups(c.acct, c.region)[b.BackupArn] = b;
  return { BackupDetails: backupView(b) };
});

op('dynamodb', 'list-backups', 'table-name:s backup-type:s', 'Lista las copias de seguridad de una tabla o de toda la región.', { res: () => '*', action: 'dynamodb:ListBackups' }, (c) => ({
  BackupSummaries: Object.values(backups(c.acct, c.region))
    .filter((b) => !c.p.TableName || b.TableName === c.p.TableName)
    .map((b) => ({ TableName: b.TableName, BackupArn: b.BackupArn, BackupName: b.BackupName, BackupCreationDateTime: iso(b.BackupCreationDateTime), BackupStatus: 'AVAILABLE', BackupType: 'USER', BackupSizeBytes: backupView(b).BackupSizeBytes })),
}));

const findBackup = (c: OpCtx, id: string) => {
  const b = backups(c.acct, c.region)[id];
  if (!b) throw new AwsError('BackupNotFoundException', `Backup not found: ${id}`, 400);
  return b;
};

op('dynamodb', 'describe-backup', 'backup-arn:s!', 'Datos de una copia de seguridad.', { res: (c) => c.p.BackupArn, action: 'dynamodb:DescribeBackup' }, (c) => {
  const b = findBackup(c, c.p.BackupArn);
  return { BackupDescription: { BackupDetails: backupView(b), SourceTableDetails: { TableName: b.TableName, KeySchema: b.table.KeySchema, TableCreationDateTime: iso(b.table.created), BillingMode: b.table.BillingMode, ItemCount: Object.keys(b.table.items).length } } };
});

op('dynamodb', 'delete-backup', 'backup-arn:s!', 'Borra una copia de seguridad.', { res: (c) => c.p.BackupArn, action: 'dynamodb:DeleteBackup' }, (c) => {
  const b = findBackup(c, c.p.BackupArn);
  delete backups(c.acct, c.region)[b.BackupArn];
  return { BackupDescription: { BackupDetails: { ...backupView(b), BackupStatus: 'DELETED' } } };
});

/** Una tabla nueva a partir de un estado guardado: se restauran claves, índices y facturación; NO el TTL, los streams, las etiquetas ni los permisos. */
function restoreInto(c: OpCtx, src: DdbTable, items: Record<string, Record<string, unknown>>, target: string): DdbTable {
  const tables = tablesOf(c.acct, c.region);
  if (tables[target]) throw new AwsError('TableAlreadyExistsException', `Table already exists: ${target}`, 400);
  const t: DdbTable = structuredClone({ ...src, TableName: target, items, ttl: undefined, stream: undefined, replicas: undefined, pitr: undefined, globalOrigin: undefined, Tags: [] });
  t.created = c.acct.clock;
  t.deleting = undefined;
  tables[target] = t;
  return t;
}

op('dynamodb', 'restore-table-from-backup', 'target-table-name:s! backup-arn:s! billing-mode-override:s', 'Crea una tabla NUEVA a partir de una copia de seguridad (nunca sobrescribe la original). No restaura TTL, streams, etiquetas ni permisos.', { res: () => '*', action: 'dynamodb:RestoreTableFromBackup' }, (c) => {
  const b = findBackup(c, c.p.BackupArn);
  const t = restoreInto(c, b.table, structuredClone(b.table.items), c.p.TargetTableName);
  if (c.p.BillingModeOverride === 'PAY_PER_REQUEST') {
    t.BillingMode = 'PAY_PER_REQUEST';
    t.ProvisionedThroughput = undefined;
  }
  return { TableDescription: { TableName: t.TableName, TableStatus: 'CREATING', KeySchema: t.KeySchema, TableArn: arn(c, t.TableName), RestoreSummary: { SourceBackupArn: b.BackupArn, SourceTableArn: arn(c, b.TableName), RestoreDateTime: iso(c.acct.clock), RestoreInProgress: true } } };
});

const pitrDesc = (a: Account, t: DdbTable) => ({
  ContinuousBackupsStatus: 'ENABLED',
  PointInTimeRecoveryDescription: t.pitr ? { PointInTimeRecoveryStatus: 'ENABLED', EarliestRestorableDateTime: iso(Math.max(t.pitr.since, a.clock - PITR_WINDOW_MS)), LatestRestorableDateTime: iso(a.clock) } : { PointInTimeRecoveryStatus: 'DISABLED' },
});

op('dynamodb', 'update-continuous-backups', 'table-name:s! point-in-time-recovery-specification:j!', 'Activa o desactiva la recuperación a un momento dado (PITR): permite restaurar la tabla a cualquier segundo de los últimos 35 días.', { res: (c) => arn(c, c.p.TableName), action: 'dynamodb:UpdateContinuousBackups' }, (c) => {
  const t = tableFor(c, c.p.TableName);
  const on = c.p.PointInTimeRecoverySpecification?.PointInTimeRecoveryEnabled;
  if (on === undefined) throw validation('PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled is required');
  if (on === true || on === 'true') t.pitr ??= { since: c.acct.clock, base: structuredClone(t.items), log: [] };
  else t.pitr = undefined;
  return { ContinuousBackupsDescription: pitrDesc(c.acct, t) };
});

op('dynamodb', 'describe-continuous-backups', 'table-name:s!', 'Estado de las copias continuas y de la recuperación a un momento dado.', { res: (c) => arn(c, c.p.TableName), action: 'dynamodb:DescribeContinuousBackups' }, (c) => ({ ContinuousBackupsDescription: pitrDesc(c.acct, tableFor(c, c.p.TableName)) }));

op('dynamodb', 'restore-table-to-point-in-time', 'source-table-name:s! target-table-name:s! use-latest-restorable-time:b restore-date-time:s billing-mode-override:s', 'Crea una tabla NUEVA con el contenido que tenía la original en un momento dado (hace falta tener PITR activado). Se restaura la tabla entera, no un elemento.', { res: () => '*', action: 'dynamodb:RestoreTableToPointInTime' }, (c) => {
  const src = tableFor(c, c.p.SourceTableName);
  if (!src.pitr) throw new AwsError('PointInTimeRecoveryUnavailableException', `Point in time recovery is not enabled for table '${src.TableName}'`, 400);
  let at = c.acct.clock;
  if (!c.p.UseLatestRestorableTime) {
    if (!c.p.RestoreDateTime) throw new AwsError('InvalidRestoreTimeException', 'Either RestoreDateTime or UseLatestRestorableTime must be specified.', 400);
    const raw = String(c.p.RestoreDateTime);
    at = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw);
    if (Number.isNaN(at)) throw new AwsError('InvalidRestoreTimeException', `Invalid restore time: ${raw}`, 400);
  }
  const earliest = Math.max(src.pitr.since, c.acct.clock - PITR_WINDOW_MS);
  if (at < earliest || at > c.acct.clock) throw new AwsError('InvalidRestoreTimeException', `An error occurred (InvalidRestoreTimeException): Time ${iso(at)} is not within the restorable window [${iso(earliest)}, ${iso(c.acct.clock)}]`, 400);
  const items = structuredClone(src.pitr.base);
  for (const ch of src.pitr.log) {
    if (ch.at > at) break;
    if (ch.next) items[ch.k] = structuredClone(ch.next);
    else delete items[ch.k];
  }
  const t = restoreInto(c, src, items, c.p.TargetTableName);
  if (c.p.BillingModeOverride === 'PAY_PER_REQUEST') {
    t.BillingMode = 'PAY_PER_REQUEST';
    t.ProvisionedThroughput = undefined;
  }
  return { TableDescription: { TableName: t.TableName, TableStatus: 'CREATING', KeySchema: t.KeySchema, TableArn: arn(c, t.TableName), RestoreSummary: { SourceTableArn: arn(c, src.TableName), RestoreDateTime: iso(at), RestoreInProgress: true } } };
});

