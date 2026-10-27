/** Notificaciones de eventos de S3: un objeto nuevo o borrado dispara una función Lambda, una cola SQS, un tema SNS o EventBridge. */
import { regional } from '../account';
import { AwsError, op } from '../registry';
import type { Account, S3Bucket, S3NotifyConfig, S3Version } from '../types';
import { iso, newId, toArr } from '../util';
import { putEvent } from './events';
import { invokeAsync, lambdaAllows, resolveFn } from './lambda';
import { arnB, getBucket, s3Hooks } from './s3';
import { snsPublish, topicAllowsService } from './sns';
import { findQueue, queueAllowsService, sqsSend } from './sqs';

const VALID = /^s3:(ObjectCreated:(\*|Put|Post|Copy|CompleteMultipartUpload)|ObjectRemoved:(\*|Delete|DeleteMarkerCreated)|ObjectRestore:(\*|Post|Completed|Delete)|ObjectTagging:(\*|Put|Delete)|ObjectAcl:Put|LifecycleExpiration:(\*|Delete|DeleteMarkerCreated)|LifecycleTransition|IntelligentTiering|Replication:\*|ReducedRedundancyLostObject)$/;

const rules = (cfg: S3NotifyConfig, name: 'prefix' | 'suffix') => cfg.Filter?.Key?.FilterRules?.find((r) => r.Name.toLowerCase() === name)?.Value ?? '';

/** ¿Cubre el filtro de eventos `pat` (con `*` al final) a este evento concreto (`ObjectCreated:Put`)? */
const eventCovers = (pat: string, event: string) => {
  const p = pat.replace(/^s3:/, '');
  return p === event || (p.endsWith(':*') && event.startsWith(p.slice(0, -1)));
};
const eventsOverlap = (x: string, y: string) => {
  const a = x.replace(/^s3:/, '');
  const b = y.replace(/^s3:/, '');
  return a === b || (a.endsWith(':*') && b.startsWith(a.slice(0, -1))) || (b.endsWith(':*') && a.startsWith(b.slice(0, -1)));
};

type Dest = { kind: 'lambda' | 'queue' | 'topic'; arn: string; cfg: S3NotifyConfig };
const destinationsOf = (n: NonNullable<S3Bucket['notifications']>): Dest[] => [
  ...toArr<S3NotifyConfig>(n.LambdaFunctionConfigurations).map((cfg) => ({ kind: 'lambda' as const, arn: cfg.LambdaFunctionArn ?? '', cfg })),
  ...toArr<S3NotifyConfig>(n.QueueConfigurations).map((cfg) => ({ kind: 'queue' as const, arn: cfg.QueueArn ?? '', cfg })),
  ...toArr<S3NotifyConfig>(n.TopicConfigurations).map((cfg) => ({ kind: 'topic' as const, arn: cfg.TopicArn ?? '', cfg })),
];

/** S3 envía los nombres de objeto codificados como una URL (espacios como `+`): por eso las funciones usan `unquote_plus`. */
const encodeKey = (k: string) => encodeURIComponent(k).replace(/%2F/g, '/').replace(/%20/g, '+');

function record(a: Account, bucket: S3Bucket, event: string, key: string, v: S3Version | undefined, configId: string) {
  return {
    eventVersion: '2.1',
    eventSource: 'aws:s3',
    awsRegion: bucket.region,
    eventTime: iso(a.clock).replace('+00:00', '.000Z'),
    eventName: event,
    userIdentity: { principalId: `AWS:AIDA${newId(a, 's3ev-uid', '', 17, 'up')}` },
    requestParameters: { sourceIPAddress: a.sourceIp },
    responseElements: { 'x-amz-request-id': newId(a, 's3ev-req', '', 16, 'up'), 'x-amz-id-2': newId(a, 's3ev-id2', '', 40, 'b64') },
    s3: {
      s3SchemaVersion: '1.0',
      configurationId: configId,
      bucket: { name: bucket.name, ownerIdentity: { principalId: `A${newId(a, 's3ev-own', '', 13, 'up')}` }, arn: arnB(bucket.name) },
      object: { key: encodeKey(key), ...(event.startsWith('ObjectRemoved') ? {} : { size: v?.size ?? 0, eTag: v?.etag ?? '' }), ...(v && v.versionId !== 'null' ? { versionId: v.versionId } : {}), sequencer: newId(a, 's3ev-seq', '', 18, 'up') },
    },
  };
}

function emit(a: Account, bucket: S3Bucket, event: string, key: string, v?: S3Version): void {
  const n = bucket.notifications;
  if (!n) return;
  const bucketArn = arnB(bucket.name);
  for (const d of destinationsOf(n)) {
    const evs = toArr<string>(d.cfg.Events);
    if (!evs.some((p) => eventCovers(p, event))) continue;
    if (!key.startsWith(rules(d.cfg, 'prefix')) || !key.endsWith(rules(d.cfg, 'suffix'))) continue;
    const body = { Records: [record(a, bucket, event, key, v, d.cfg.Id ?? 'notif')] };
    try {
      if (d.kind === 'lambda') invokeAsync(a, bucket.region, d.arn, body, { service: 's3.amazonaws.com', sourceArn: bucketArn });
      else if (d.kind === 'queue') {
        const { q } = findQueue(a, bucket.region, d.arn);
        if (queueAllowsService(q, 's3.amazonaws.com', bucketArn)) sqsSend(a, q, JSON.stringify(body));
      } else {
        const t = regional(a, bucket.region).sns[d.arn];
        if (t && topicAllowsService(t, 's3.amazonaws.com', bucketArn)) snsPublish(a, bucket.region, t, JSON.stringify(body), { subject: 'Amazon S3 Notification' });
      }
    } catch {
      /* destino que ya no existe */
    }
  }
  if (n.EventBridgeConfiguration) {
    const created = event.startsWith('ObjectCreated');
    const detail = { version: '0', bucket: { name: bucket.name }, object: { key, ...(created ? { size: v?.size ?? 0, etag: v?.etag ?? '' } : {}), sequencer: newId(a, 's3ev-seq', '', 18, 'up') }, 'request-id': newId(a, 's3ev-req', '', 16, 'up'), requester: a.id, 'source-ip-address': a.sourceIp, reason: created ? (event.endsWith('Copy') ? 'CopyObject' : 'PutObject') : 'DeleteObject' };
    try {
      putEvent(a, bucket.region, 'default', { source: 'aws.s3', detailType: created ? 'Object Created' : 'Object Deleted', detail, resources: [bucketArn] });
    } catch {
      /* sin bus */
    }
  }
}

s3Hooks.emit = emit;

const invalid = (msg: string) => new AwsError('InvalidArgument', msg, 400);

/** Las configuraciones no pueden solaparse: mismo evento con prefijos y sufijos que se pisan es ambiguo. */
function checkOverlap(dests: Dest[]): void {
  for (let i = 0; i < dests.length; i++)
    for (let j = i + 1; j < dests.length; j++) {
      const x = dests[i].cfg;
      const y = dests[j].cfg;
      const clash = toArr<string>(x.Events).some((e) => toArr<string>(y.Events).some((f) => eventsOverlap(e, f)));
      if (!clash) continue;
      const px = rules(x, 'prefix');
      const py = rules(y, 'prefix');
      const sx = rules(x, 'suffix');
      const sy = rules(y, 'suffix');
      if ((px.startsWith(py) || py.startsWith(px)) && (sx.endsWith(sy) || sy.endsWith(sx))) throw invalid('Configuration is ambiguously defined. Cannot have overlapping suffixes in two rules if the prefixes are overlapping for the same event type.');
    }
}

op('s3api', 'put-bucket-notification-configuration', 'bucket:s! notification-configuration:j! skip-destination-validation:b', 'Configura a quién avisa el bucket cuando se crea o borra un objeto (función Lambda, cola SQS, tema SNS o EventBridge). S3 comprueba que el destino lo permite.', { res: (c) => arnB(c.p.Bucket), action: 's3:PutBucketNotification' }, (c) => {
  const b = getBucket(c.acct, c.p.Bucket);
  const conf = (c.p.NotificationConfiguration ?? {}) as NonNullable<S3Bucket['notifications']>;
  const known = ['LambdaFunctionConfigurations', 'QueueConfigurations', 'TopicConfigurations', 'EventBridgeConfiguration'];
  for (const k of Object.keys(conf)) if (!known.includes(k)) throw new AwsError('MalformedXML', `The XML you provided was not well-formed or did not validate against our published schema (unknown element ${k}).`, 400);
  const dests = destinationsOf(conf);
  for (const d of dests) {
    const evs = toArr<string>(d.cfg.Events);
    if (!evs.length) throw invalid('The notification configuration must specify at least one event.');
    for (const e of evs) if (!VALID.test(e)) throw invalid(`The event is not supported for notifications: ${e}`);
    for (const r of d.cfg.Filter?.Key?.FilterRules ?? []) if (!['prefix', 'suffix'].includes(String(r.Name).toLowerCase())) throw invalid(`filter rule name must be either prefix or suffix: ${r.Name}`);
  }
  checkOverlap(dests);
  if (!c.p.SkipDestinationValidation) {
    const bucketArn = arnB(b.name);
    const bad = dests.filter((d) => {
      try {
        if (d.kind === 'lambda') {
          const { fn } = resolveFn(c.acct, b.region, d.arn);
          return !lambdaAllows(fn, 's3.amazonaws.com', bucketArn);
        }
        if (d.kind === 'queue') return !queueAllowsService(findQueue(c.acct, b.region, d.arn).q, 's3.amazonaws.com', bucketArn);
        const t = regional(c.acct, b.region).sns[d.arn];
        return !t || !topicAllowsService(t, 's3.amazonaws.com', bucketArn);
      } catch {
        return true;
      }
    });
    if (bad.length) throw invalid('Unable to validate the following destination configurations');
  }
  const prev = b.notifications;
  b.notifications = Object.keys(conf).length ? { ...conf } : undefined;
  // S3 comprueba la entrega enviando un mensaje de prueba a las colas y a los temas nuevos
  for (const d of dests) {
    if (d.kind === 'lambda') continue;
    if (prev && destinationsOf(prev).some((x) => x.arn === d.arn)) continue;
    const test = JSON.stringify({ Service: 'Amazon S3', Event: 's3:TestEvent', Time: iso(c.acct.clock).replace('+00:00', '.000Z'), Bucket: b.name, RequestId: newId(c.acct, 's3ev-req', '', 16, 'up'), HostId: newId(c.acct, 's3ev-id2', '', 40, 'b64') });
    try {
      if (d.kind === 'queue') sqsSend(c.acct, findQueue(c.acct, b.region, d.arn).q, test);
      else snsPublish(c.acct, b.region, regional(c.acct, b.region).sns[d.arn], test, { subject: 'Amazon S3 Notification' });
    } catch {
      /* destino sin entrega */
    }
  }
  return undefined;
});

op('s3api', 'get-bucket-notification-configuration', 'bucket:s!', 'Muestra a quién avisa el bucket de sus eventos.', { res: (c) => arnB(c.p.Bucket), action: 's3:GetBucketNotification' }, (c) => ({ ...(getBucket(c.acct, c.p.Bucket).notifications ?? {}) }));
