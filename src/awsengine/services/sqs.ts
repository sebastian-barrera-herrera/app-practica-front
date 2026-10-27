/** Amazon SQS: colas estándar y FIFO con visibilidad, retención, retraso, redrive (cola de mensajes muertos) y long polling. */
import { md5 } from '../../engine/commands/hash';
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, SqsMessage, SqsQueue } from '../types';
import { mkArn, newId, toArr } from '../util';

export const sqsOf = (a: Account, region: string): Record<string, SqsQueue> => {
  const r = regional(a, region);
  return (r.sqs ??= {});
};

const DEFAULTS: Record<string, string> = { VisibilityTimeout: '30', DelaySeconds: '0', MessageRetentionPeriod: '345600', MaximumMessageSize: '262144', ReceiveMessageWaitTimeSeconds: '0' };
const NUMERIC: Record<string, [number, number]> = { VisibilityTimeout: [0, 43200], DelaySeconds: [0, 900], MessageRetentionPeriod: [60, 1209600], MaximumMessageSize: [1024, 262144], ReceiveMessageWaitTimeSeconds: [0, 20] };

export const queueArn = (a: Account, region: string, name: string) => mkArn('sqs', region, a.id, name);
export const queueUrl = (a: Account, region: string, name: string) => `https://sqs.${region}.amazonaws.com/${a.id}/${name}`;

function validateAttrs(attrs: Record<string, string>, fifo: boolean): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (k in NUMERIC) {
      const [lo, hi] = NUMERIC[k];
      const n = Number(v);
      if (!Number.isInteger(n) || n < lo || n > hi) throw new AwsError('InvalidAttributeValue', `Invalid value for the parameter ${k}. Reason: Must be between ${lo} and ${hi}, if provided.`, 400);
    } else if (k === 'RedrivePolicy') {
      let j: { deadLetterTargetArn?: string; maxReceiveCount?: number | string };
      try {
        j = JSON.parse(v);
      } catch {
        throw new AwsError('InvalidParameterValue', 'Invalid value for the parameter RedrivePolicy.', 400);
      }
      if (!j.deadLetterTargetArn || j.maxReceiveCount === undefined || Number(j.maxReceiveCount) < 1 || Number(j.maxReceiveCount) > 1000) throw new AwsError('InvalidParameterValue', 'Invalid value for the parameter RedrivePolicy. Reason: Redrive policy needs deadLetterTargetArn and maxReceiveCount between 1 and 1000.', 400);
    } else if (k === 'FifoQueue' || k === 'ContentBasedDeduplication') {
      if (!fifo && k === 'ContentBasedDeduplication') throw new AwsError('InvalidAttributeName', 'Unknown Attribute ContentBasedDeduplication.', 400);
    } else if (!['Policy', 'KmsMasterKeyId', 'KmsDataKeyReusePeriodSeconds', 'SqsManagedSseEnabled', 'DeduplicationScope', 'FifoThroughputLimit', 'RedriveAllowPolicy'].includes(k)) {
      throw new AwsError('InvalidAttributeName', `Unknown Attribute ${k}.`, 400);
    }
  }
}

export function sqsCreate(a: Account, region: string, name: string, attrs: Record<string, string> = {}, tags: Record<string, string> = {}): SqsQueue {
  const fifo = name.endsWith('.fifo');
  const q: SqsQueue = { name, attrs: { ...DEFAULTS, ...attrs, ...(fifo ? { FifoQueue: 'true' } : {}) }, messages: [], created: a.clock, tags, seq: 0 };
  sqsOf(a, region)[name] = q;
  return q;
}

/** Cola por URL, nombre o ARN. */
export function findQueue(a: Account, region: string, ref: string): { q: SqsQueue; region: string } {
  let r = region;
  let name = ref;
  const url = /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d+)\/(.+)$/.exec(ref);
  if (url) {
    r = url[1];
    name = url[3];
  } else if (ref.startsWith('arn:aws:sqs:')) {
    const p = ref.split(':');
    r = p[3];
    name = p[5];
  }
  const q = regional(a, r).sqs?.[name];
  if (!q) throw new AwsError('QueueDoesNotExist', 'The specified queue does not exist.', 400);
  return { q, region: r };
}

const secs = (q: SqsQueue, k: string) => Number(q.attrs[k] ?? DEFAULTS[k] ?? 0) * 1000;
const dlqOf = (a: Account, q: SqsQueue): { dlq: SqsQueue; max: number } | null => {
  if (!q.attrs.RedrivePolicy) return null;
  try {
    const j = JSON.parse(q.attrs.RedrivePolicy) as { deadLetterTargetArn: string; maxReceiveCount: number | string };
    const p = j.deadLetterTargetArn.split(':');
    const dlq = regional(a, p[3]).sqs?.[p[5]];
    return dlq ? { dlq, max: Number(j.maxReceiveCount) } : null;
  } catch {
    return null;
  }
};

/** Retención y redrive: borra lo caducado y mueve a la cola de mensajes muertos lo que ya se recibió `maxReceiveCount` veces. */
export function sqsSweep(a: Account, q: SqsQueue): void {
  const now = a.clock;
  const ret = secs(q, 'MessageRetentionPeriod');
  q.messages = q.messages.filter((m) => now - m.sentAt < ret);
  const d = dlqOf(a, q);
  if (!d) return;
  const dead = q.messages.filter((m) => m.visibleAt <= now && m.receiveCount >= d.max);
  if (dead.length) {
    q.messages = q.messages.filter((m) => !dead.includes(m));
    for (const m of dead) d.dlq.messages.push({ ...m, receiveCount: 0, receiptHandle: undefined, visibleAt: 0, availableAt: 0, deadFrom: q.name });
  }
}

export interface SendOpts {
  attrs?: Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }>;
  delay?: number;
  group?: string;
  dedup?: string;
}

/** Encola un mensaje (lo usan SNS, EventBridge y Lambda además de `send-message`). Devuelve el mensaje (o el duplicado FIFO existente). */
export function sqsSend(a: Account, q: SqsQueue, body: string, o: SendOpts = {}): SqsMessage {
  const fifo = q.name.endsWith('.fifo');
  const dupKey = fifo ? o.dedup ?? (q.attrs.ContentBasedDeduplication === 'true' ? md5(body) : undefined) : undefined;
  if (fifo) {
    if (!o.group) throw new AwsError('MissingParameter', 'The request must contain the parameter MessageGroupId.', 400);
    if (!dupKey) throw new AwsError('InvalidParameterValue', 'The queue should either have ContentBasedDeduplication enabled or MessageDeduplicationId provided explicitly', 400);
    const dup = q.messages.find((m) => m.dedupId === dupKey && a.clock - m.sentAt < 300000);
    if (dup) return dup;
  }
  if (new TextEncoder().encode(body).length > Number(q.attrs.MaximumMessageSize)) throw new AwsError('InvalidParameterValue', `One or more parameters are invalid. Reason: Message must be shorter than ${q.attrs.MaximumMessageSize} bytes.`, 400);
  const delay = (o.delay ?? Number(q.attrs.DelaySeconds)) * 1000;
  const m: SqsMessage = { MessageId: newId(a, 'sqsmsg', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'), Body: body, attrs: o.attrs ?? {}, sentAt: a.clock, availableAt: a.clock + delay, visibleAt: 0, receiveCount: 0, groupId: o.group, dedupId: dupKey, seq: ++q.seq };
  q.messages.push(m);
  return m;
}

/** Recibe hasta `max` mensajes visibles y los oculta durante el tiempo de visibilidad. */
export function sqsReceive(a: Account, q: SqsQueue, max = 1, visibility?: number): SqsMessage[] {
  sqsSweep(a, q);
  const now = a.clock;
  const vis = (visibility ?? Number(q.attrs.VisibilityTimeout)) * 1000;
  const fifo = q.name.endsWith('.fifo');
  const blocked = new Set(q.messages.filter((m) => m.visibleAt > now && m.groupId).map((m) => m.groupId));
  const out: SqsMessage[] = [];
  for (const m of [...q.messages].sort((x, y) => x.seq - y.seq)) {
    if (out.length >= max) break;
    if (m.availableAt > now || m.visibleAt > now) continue;
    if (fifo && m.groupId && blocked.has(m.groupId) && !out.some((x) => x.groupId === m.groupId)) continue;
    m.receiveCount++;
    m.visibleAt = now + vis;
    m.receiptHandle = newId(a, 'sqsrh', '', 60, 'hex');
    if (m.receiveCount === 1) m.firstReceivedAt = now;
    out.push(m);
  }
  return out;
}

const msgView = (q: SqsQueue, m: SqsMessage, wanted: string[]) => {
  const all = wanted.includes('All');
  const sys: Record<string, string> = {};
  const want = (n: string) => all || wanted.includes(n);
  if (want('SenderId')) sys.SenderId = 'AIDAEXAMPLE0000000000';
  if (want('SentTimestamp')) sys.SentTimestamp = String(m.sentAt);
  if (want('ApproximateReceiveCount')) sys.ApproximateReceiveCount = String(m.receiveCount);
  if (want('ApproximateFirstReceiveTimestamp') && m.firstReceivedAt) sys.ApproximateFirstReceiveTimestamp = String(m.firstReceivedAt);
  if (want('MessageGroupId') && m.groupId) sys.MessageGroupId = m.groupId;
  if (want('MessageDeduplicationId') && m.dedupId) sys.MessageDeduplicationId = m.dedupId;
  if (want('DeadLetterQueueSourceArn') && m.deadFrom) sys.DeadLetterQueueSourceArn = m.deadFrom;
  void q;
  return { MessageId: m.MessageId, ReceiptHandle: m.receiptHandle, MD5OfBody: md5(m.Body), Body: m.Body, ...(Object.keys(sys).length ? { Attributes: sys } : {}), ...(Object.keys(m.attrs).length ? { MD5OfMessageAttributes: md5(JSON.stringify(m.attrs)), MessageAttributes: m.attrs } : {}) };
};

const arn = (c: Pick<OpCtx, 'acct' | 'region'>, ref: string) => {
  try {
    const { q, region } = findQueue(c.acct, c.region, ref);
    return queueArn(c.acct, region, q.name);
  } catch {
    return '*';
  }
};

const NAME_RE = /^[A-Za-z0-9_-]{1,80}(\.fifo)?$/;

op('sqs', 'create-queue', 'queue-name:s! attributes:j tags:j', 'Crea una cola (los nombres que acaban en `.fifo` son colas FIFO). Es idempotente si los atributos coinciden.', { res: (c) => queueArn(c.acct, c.region, c.p.QueueName) }, (c) => {
  const name = String(c.p.QueueName);
  const fifo = name.endsWith('.fifo');
  if (!NAME_RE.test(name)) throw new AwsError('InvalidParameterValue', `Can only include alphanumeric characters, hyphens, or underscores. 1 to 80 in length${fifo ? ' (and .fifo suffix for FIFO queues)' : ''}.`, 400);
  const attrs = (c.p.Attributes ?? {}) as Record<string, string>;
  if (attrs.FifoQueue === 'true' && !fifo) throw new AwsError('InvalidParameterValue', 'The name of a FIFO queue can only include alphanumeric characters, hyphens, or underscores, must end with .fifo suffix and be 1 to 80 in length.', 400);
  if (fifo && attrs.FifoQueue !== 'true') throw new AwsError('InvalidParameterValue', 'Queue names ending with .fifo must set the FifoQueue attribute to true.', 400);
  validateAttrs(attrs, fifo);
  const cur = sqsOf(c.acct, c.region)[name];
  if (cur) {
    for (const [k, v] of Object.entries(attrs)) if (cur.attrs[k] !== String(v) && !(k === 'FifoQueue')) throw new AwsError('QueueNameExists', `A queue already exists with the same name and a different value for attribute ${k}`, 400);
    return { QueueUrl: queueUrl(c.acct, c.region, name) };
  }
  sqsCreate(c.acct, c.region, name, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)])), (c.p.Tags ?? {}) as Record<string, string>);
  return { QueueUrl: queueUrl(c.acct, c.region, name) };
});

op('sqs', 'get-queue-url', 'queue-name:s! queue-owner-aws-account-id:s', 'Devuelve la URL de una cola a partir de su nombre.', { res: (c) => queueArn(c.acct, c.region, c.p.QueueName) }, (c) => {
  if (!sqsOf(c.acct, c.region)[c.p.QueueName]) throw new AwsError('QueueDoesNotExist', 'The specified queue does not exist.', 400);
  return { QueueUrl: queueUrl(c.acct, c.region, c.p.QueueName) };
});

op('sqs', 'list-queues', 'queue-name-prefix:s max-results:i', 'Lista las URL de las colas de la región.', { res: () => '*' }, (c) => {
  const list = Object.keys(sqsOf(c.acct, c.region)).filter((n) => !c.p.QueueNamePrefix || n.startsWith(c.p.QueueNamePrefix)).sort();
  return list.length ? { QueueUrls: list.map((n) => queueUrl(c.acct, c.region, n)) } : {};
});

op('sqs', 'delete-queue', 'queue-url:s!', 'Borra una cola y todos sus mensajes.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q, region } = findQueue(c.acct, c.region, c.p.QueueUrl);
  delete regional(c.acct, region).sqs![q.name];
  return undefined;
});

const attrView = (a: Account, region: string, q: SqsQueue, wanted: string[]) => {
  sqsSweep(a, q);
  const now = a.clock;
  const all = wanted.includes('All');
  const out: Record<string, string> = {};
  const want = (n: string) => all || wanted.includes(n);
  const visible = q.messages.filter((m) => m.availableAt <= now && m.visibleAt <= now).length;
  const inflight = q.messages.filter((m) => m.visibleAt > now).length;
  const delayed = q.messages.filter((m) => m.availableAt > now).length;
  if (want('ApproximateNumberOfMessages')) out.ApproximateNumberOfMessages = String(visible);
  if (want('ApproximateNumberOfMessagesNotVisible')) out.ApproximateNumberOfMessagesNotVisible = String(inflight);
  if (want('ApproximateNumberOfMessagesDelayed')) out.ApproximateNumberOfMessagesDelayed = String(delayed);
  if (want('CreatedTimestamp')) out.CreatedTimestamp = String(Math.floor(q.created / 1000));
  if (want('LastModifiedTimestamp')) out.LastModifiedTimestamp = String(Math.floor(q.created / 1000));
  if (want('QueueArn')) out.QueueArn = queueArn(a, region, q.name);
  for (const k of Object.keys(q.attrs)) if (want(k)) out[k] = q.attrs[k];
  return out;
};

op('sqs', 'get-queue-attributes', 'queue-url:s! attribute-names:l', 'Atributos de la cola y contadores (mensajes visibles, en vuelo y retrasados).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q, region } = findQueue(c.acct, c.region, c.p.QueueUrl);
  return { Attributes: attrView(c.acct, region, q, toArr<string>(c.p.AttributeNames ?? ['All'])) };
});

op('sqs', 'set-queue-attributes', 'queue-url:s! attributes:j!', 'Cambia atributos de la cola (visibilidad, retención, redrive, política…).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const attrs = c.p.Attributes as Record<string, string>;
  validateAttrs(attrs, q.name.endsWith('.fifo'));
  for (const [k, v] of Object.entries(attrs)) q.attrs[k] = String(v);
  return undefined;
});

op('sqs', 'send-message', 'queue-url:s! message-body:s! delay-seconds:i message-attributes:j message-group-id:s message-deduplication-id:s', 'Envía un mensaje a la cola.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  if (c.p.DelaySeconds !== undefined && (c.p.DelaySeconds < 0 || c.p.DelaySeconds > 900)) throw new AwsError('InvalidParameterValue', 'Value ' + c.p.DelaySeconds + ' for parameter DelaySeconds is invalid. Reason: DelaySeconds must be >= 0 and <= 900.', 400);
  if (q.name.endsWith('.fifo') && c.p.DelaySeconds) throw new AwsError('InvalidParameterValue', 'Value ' + c.p.DelaySeconds + ' for parameter DelaySeconds is invalid. Reason: The request include parameter that is not valid for this queue type.', 400);
  const m = sqsSend(c.acct, q, String(c.p.MessageBody), { attrs: c.p.MessageAttributes, delay: c.p.DelaySeconds, group: c.p.MessageGroupId, dedup: c.p.MessageDeduplicationId });
  return { MD5OfMessageBody: md5(m.Body), MessageId: m.MessageId, ...(q.name.endsWith('.fifo') ? { SequenceNumber: String(m.seq).padStart(18, '0') } : {}) };
});

op('sqs', 'send-message-batch', 'queue-url:s! entries:j!', 'Envía hasta 10 mensajes de golpe (`Id` y `MessageBody` en cada uno).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const entries = toArr<{ Id: string; MessageBody: string; DelaySeconds?: number; MessageAttributes?: SendOpts['attrs']; MessageGroupId?: string; MessageDeduplicationId?: string }>(c.p.Entries);
  if (!entries.length) throw new AwsError('EmptyBatchRequest', 'There should be at least one SendMessageBatchRequestEntry in the request.', 400);
  if (entries.length > 10) throw new AwsError('TooManyEntriesInBatchRequest', 'Maximum number of entries per request are 10. You have sent ' + entries.length + '.', 400);
  const ok = [];
  const failed = [];
  for (const e of entries) {
    try {
      const m = sqsSend(c.acct, q, String(e.MessageBody), { attrs: e.MessageAttributes, delay: e.DelaySeconds, group: e.MessageGroupId, dedup: e.MessageDeduplicationId });
      ok.push({ Id: e.Id, MessageId: m.MessageId, MD5OfMessageBody: md5(m.Body) });
    } catch (err) {
      if (!(err instanceof AwsError)) throw err;
      failed.push({ Id: e.Id, SenderFault: true, Code: err.code, Message: err.message });
    }
  }
  return { Successful: ok, Failed: failed };
});

op('sqs', 'receive-message', 'queue-url:s! attribute-names:l message-attribute-names:l message-system-attribute-names:l max-number-of-messages:i visibility-timeout:i wait-time-seconds:i receive-request-attempt-id:s', 'Recibe mensajes: quedan ocultos durante el tiempo de visibilidad y hay que borrarlos al terminar.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const max = c.p.MaxNumberOfMessages ?? 1;
  if (max < 1 || max > 10) throw new AwsError('InvalidParameterValue', `Value ${max} for parameter MaxNumberOfMessages is invalid. Reason: Must be between 1 and 10, if provided.`, 400);
  let got = sqsReceive(c.acct, q, max, c.p.VisibilityTimeout);
  const wait = c.p.WaitTimeSeconds ?? Number(q.attrs.ReceiveMessageWaitTimeSeconds);
  if (!got.length && wait > 0) {
    // long polling: espera (en el reloj virtual) hasta que llegue algo o se agote el tiempo
    for (let t = 0; t < wait && !got.length; t++) {
      c.acct.clock += 1000;
      got = sqsReceive(c.acct, q, max, c.p.VisibilityTimeout);
    }
  }
  const wanted = [...toArr<string>(c.p.AttributeNames), ...toArr<string>(c.p.MessageSystemAttributeNames)];
  return got.length ? { Messages: got.map((m) => msgView(q, m, wanted)) } : undefined;
});

const findByHandle = (q: SqsQueue, handle: string): SqsMessage => {
  const m = q.messages.find((x) => x.receiptHandle === handle);
  if (!m) throw new AwsError('ReceiptHandleIsInvalid', 'The input receipt handle is invalid.', 400);
  return m;
};

op('sqs', 'delete-message', 'queue-url:s! receipt-handle:s!', 'Borra un mensaje ya procesado (con el `ReceiptHandle` de la última recepción).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const m = findByHandle(q, c.p.ReceiptHandle);
  q.messages = q.messages.filter((x) => x !== m);
  return undefined;
});

op('sqs', 'delete-message-batch', 'queue-url:s! entries:j!', 'Borra varios mensajes a la vez.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const ok = [];
  const failed = [];
  for (const e of toArr<{ Id: string; ReceiptHandle: string }>(c.p.Entries)) {
    const m = q.messages.find((x) => x.receiptHandle === e.ReceiptHandle);
    if (m) {
      q.messages = q.messages.filter((x) => x !== m);
      ok.push({ Id: e.Id });
    } else failed.push({ Id: e.Id, SenderFault: true, Code: 'ReceiptHandleIsInvalid', Message: 'The input receipt handle is invalid.' });
  }
  return { Successful: ok, Failed: failed };
});

op('sqs', 'change-message-visibility', 'queue-url:s! receipt-handle:s! visibility-timeout:i!', 'Alarga o acorta el tiempo que un mensaje recibido permanece oculto (0 = vuelve a estar visible ya).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const m = findByHandle(q, c.p.ReceiptHandle);
  if (c.p.VisibilityTimeout < 0 || c.p.VisibilityTimeout > 43200) throw new AwsError('InvalidParameterValue', `Value ${c.p.VisibilityTimeout} for parameter VisibilityTimeout is invalid. Reason: Must be between 0 and 43200, if provided.`, 400);
  m.visibleAt = c.acct.clock + c.p.VisibilityTimeout * 1000;
  return undefined;
});

op('sqs', 'purge-queue', 'queue-url:s!', 'Borra todos los mensajes de la cola (pueden pasar 60 s hasta que se note).', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q } = findQueue(c.acct, c.region, c.p.QueueUrl);
  q.messages = [];
  return undefined;
});

op('sqs', 'list-dead-letter-source-queues', 'queue-url:s!', 'Colas que envían sus mensajes fallidos a esta cola de mensajes muertos.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const { q, region } = findQueue(c.acct, c.region, c.p.QueueUrl);
  const target = queueArn(c.acct, region, q.name);
  const urls = Object.values(sqsOf(c.acct, region)).filter((s) => {
    try {
      return (JSON.parse(s.attrs.RedrivePolicy ?? '{}') as { deadLetterTargetArn?: string }).deadLetterTargetArn === target;
    } catch {
      return false;
    }
  });
  return { queueUrls: urls.map((s) => queueUrl(c.acct, region, s.name)) };
});

op('sqs', 'tag-queue', 'queue-url:s! tags:j!', 'Pone etiquetas a una cola.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  Object.assign(findQueue(c.acct, c.region, c.p.QueueUrl).q.tags, c.p.Tags);
  return undefined;
});

op('sqs', 'list-queue-tags', 'queue-url:s!', 'Etiquetas de una cola.', { res: (c) => arn(c, c.p.QueueUrl) }, (c) => {
  const t = findQueue(c.acct, c.region, c.p.QueueUrl).q.tags;
  return Object.keys(t).length ? { Tags: t } : {};
});

/** ¿Permite una política de recursos (cola, tema…) que ese servicio actúe sobre ella en nombre de `sourceArn`? `action` decide qué acciones valen (en minúsculas). */
export function policyAllowsService(policy: string | undefined, action: (a: string) => boolean, service: string, sourceArn: string): boolean {
  if (!policy) return false;
  let doc: { Statement?: unknown };
  try {
    doc = JSON.parse(policy);
  } catch {
    return false;
  }
  const stmts = toArr<Record<string, unknown>>(doc.Statement as Record<string, unknown> | Record<string, unknown>[]);
  return stmts.some((s) => {
    if (s.Effect !== 'Allow') return false;
    const acts = toArr<string>(s.Action as string | string[]);
    if (!acts.some((x) => x === '*' || action(x.toLowerCase()))) return false;
    const pr = s.Principal as string | { Service?: string | string[]; AWS?: string | string[] } | undefined;
    const principalOk = pr === '*' || (typeof pr === 'object' && (toArr(pr.Service).includes(service) || toArr(pr.AWS).includes('*')));
    if (!principalOk) return false;
    const cond = s.Condition as Record<string, Record<string, string | string[]>> | undefined;
    if (!cond) return true;
    const src = Object.entries(cond).flatMap(([, v]) => Object.entries(v)).filter(([k]) => k.toLowerCase() === 'aws:sourcearn');
    if (!src.length) return true;
    return src.some(([, v]) => toArr(v).some((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$').test(sourceArn)));
  });
}

/** ¿Permite la política de la cola que ese servicio (SNS, EventBridge, S3…) le envíe mensajes en nombre de `sourceArn`? */
export const queueAllowsService = (q: SqsQueue, service: string, sourceArn: string): boolean => policyAllowsService(q.attrs.Policy, (x) => x === 'sqs:*' || x === 'sqs:sendmessage', service, sourceArn);
