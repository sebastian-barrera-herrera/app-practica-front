/** Amazon SNS: temas, suscripciones (SQS, Lambda, correo…), políticas de filtro y reparto («fan-out»). */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, SnsSub, SnsTopic } from '../types';
import { iso, mkArn, newId, toArr } from '../util';
import { destinations, invokeAsync, resolveFn } from './lambda';
import { findQueue, policyAllowsService, queueAllowsService, sqsSend } from './sqs';

export const topicArn = (a: Account, region: string, name: string) => mkArn('sns', region, a.id, name);
const uuidOf = (a: Account, k: string) => newId(a, k, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

type Attrs = Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }>;

/** ¿Cumple el mensaje la política de filtro de la suscripción? (atributos del mensaje: igualdad, prefijo, numéricos, anything-but, exists). */
export function filterMatches(policy: string | undefined, attrs: Attrs): boolean {
  if (!policy) return true;
  let p: Record<string, unknown[]>;
  try {
    p = JSON.parse(policy) as Record<string, unknown[]>;
  } catch {
    return true;
  }
  return Object.entries(p).every(([key, rules]) => {
    const a = attrs[key];
    const vals: string[] = a ? (a.DataType.startsWith('String.Array') ? (JSON.parse(a.StringValue ?? '[]') as unknown[]).map(String) : [String(a.StringValue ?? '')]) : [];
    return toArr(rules as unknown[]).some((r) => {
      if (typeof r === 'string' || typeof r === 'number') return vals.includes(String(r));
      const o = r as Record<string, unknown>;
      if ('exists' in o) return (vals.length > 0) === !!o.exists;
      if ('prefix' in o) return vals.some((v) => v.startsWith(String(o.prefix)));
      if ('suffix' in o) return vals.some((v) => v.endsWith(String(o.suffix)));
      if ('anything-but' in o) return vals.length > 0 && !vals.some((v) => toArr(o['anything-but'] as unknown[]).map(String).includes(v));
      if ('numeric' in o) {
        const n = (o.numeric as (string | number)[]);
        return vals.some((v) => {
          const x = Number(v);
          for (let i = 0; i + 1 < n.length; i += 2) {
            const t = Number(n[i + 1]);
            const ok = n[i] === '=' ? x === t : n[i] === '>' ? x > t : n[i] === '>=' ? x >= t : n[i] === '<' ? x < t : n[i] === '<=' ? x <= t : false;
            if (!ok) return false;
          }
          return true;
        });
      }
      return false;
    });
  });
}

const attrsOut = (attrs: Attrs) => Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { Type: v.DataType, Value: v.StringValue ?? v.BinaryValue ?? '' }]));

/** Reparte un mensaje a las suscripciones confirmadas del tema. */
export function snsPublish(a: Account, region: string, t: SnsTopic, message: string, o: { subject?: string; attrs?: Attrs } = {}): string {
  const id = uuidOf(a, 'snsmsg');
  const attrs = o.attrs ?? {};
  t.messages.push(message);
  for (const sub of t.subscriptions) {
    if (!sub.confirmed || !filterMatches(sub.attrs?.FilterPolicy, attrs)) continue;
    const raw = sub.attrs?.RawMessageDelivery === 'true';
    const env = { Type: 'Notification', MessageId: id, TopicArn: t.TopicArn, ...(o.subject ? { Subject: o.subject } : {}), Message: message, Timestamp: iso(a.clock).replace('+00:00', 'Z').replace(/Z$/, '.000Z'), SignatureVersion: '1', Signature: 'EXAMPLEpH+..', SigningCertURL: `https://sns.${region}.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem`, UnsubscribeURL: `https://sns.${region}.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=${sub.SubscriptionArn}`, ...(Object.keys(attrs).length ? { MessageAttributes: attrsOut(attrs) } : {}) };
    if (sub.Protocol === 'sqs') {
      try {
        const { q } = findQueue(a, region, sub.Endpoint);
        // sin una política en la cola que permita al tema, SNS no puede escribir y el mensaje se pierde sin avisar
        if (!queueAllowsService(q, 'sns.amazonaws.com', t.TopicArn)) continue;
        sqsSend(a, q, raw ? message : JSON.stringify(env, null, 2), { attrs: raw ? attrs : {} });
      } catch {
        /* cola inexistente */
      }
    } else if (sub.Protocol === 'lambda') {
      try {
        const rec = { EventVersion: '1.0', EventSubscriptionArn: sub.SubscriptionArn, EventSource: 'aws:sns', Sns: { SignatureVersion: '1', Timestamp: env.Timestamp, Signature: env.Signature, SigningCertUrl: env.SigningCertURL, MessageId: id, Message: message, MessageAttributes: attrsOut(attrs), Type: 'Notification', UnsubscribeUrl: env.UnsubscribeURL, TopicArn: t.TopicArn, Subject: o.subject ?? null } };
        invokeAsync(a, region, sub.Endpoint, { Records: [rec] }, { service: 'sns.amazonaws.com', sourceArn: t.TopicArn });
      } catch {
        /* función inexistente */
      }
    }
  }
  return id;
}

/** ¿Permite la política del tema que ese servicio (EventBridge, S3, CloudWatch…) publique en nombre de `sourceArn`? */
export const topicAllowsService = (t: SnsTopic, service: string, sourceArn: string): boolean => policyAllowsService(t.attrs?.Policy, (x) => x === 'sns:*' || x === 'sns:publish', service, sourceArn);

/** Publica en un tema por su ARN (lo usan EventBridge, Step Functions y los destinos de Lambda). */
export function snsPublishByArn(a: Account, arn: string, message: string): void {
  const region = arn.split(':')[3];
  const t = regional(a, region).sns[arn];
  if (t) snsPublish(a, region, t, message);
}

destinations.publish = snsPublishByArn;

const find = (c: OpCtx, arn: string): SnsTopic => {
  const t = regional(c.acct, c.region).sns[arn];
  if (!t) throw new AwsError('NotFound', 'Topic does not exist', 404);
  return t;
};

op('sns', 'create-topic', 'name:s! attributes:j tags:j', 'Crea un tema de notificaciones (idempotente). Los que acaban en `.fifo` son FIFO.', { res: (c) => topicArn(c.acct, c.region, c.p.Name) }, (c) => {
  if (!/^[\w-]{1,256}(\.fifo)?$/.test(c.p.Name)) throw new AwsError('InvalidParameter', 'Invalid parameter: Topic Name');
  const r = regional(c.acct, c.region);
  const arn = topicArn(c.acct, c.region, c.p.Name);
  r.sns[arn] ??= { TopicArn: arn, subscriptions: [], messages: [], attrs: (c.p.Attributes ?? {}) as Record<string, string>, tags: (c.p.Tags ?? {}) as Record<string, string> };
  return { TopicArn: arn };
});

op('sns', 'list-topics', '', 'Lista los temas.', { paginate: 'Topics', res: () => '*' }, (c) => ({ Topics: Object.keys(regional(c.acct, c.region).sns).sort().map((TopicArn) => ({ TopicArn })) }));

op('sns', 'delete-topic', 'topic-arn:s!', 'Borra un tema (y sus suscripciones).', { res: (c) => c.p.TopicArn }, (c) => {
  delete regional(c.acct, c.region).sns[c.p.TopicArn];
  return undefined;
});

op('sns', 'get-topic-attributes', 'topic-arn:s!', 'Atributos del tema y número de suscripciones.', { res: (c) => c.p.TopicArn }, (c) => {
  const t = find(c, c.p.TopicArn);
  return { Attributes: { TopicArn: t.TopicArn, Owner: c.acct.id, SubscriptionsConfirmed: String(t.subscriptions.filter((s) => s.confirmed).length), SubscriptionsPending: String(t.subscriptions.filter((s) => !s.confirmed).length), SubscriptionsDeleted: '0', DisplayName: '', EffectiveDeliveryPolicy: '{}', ...(t.attrs ?? {}) } };
});

op('sns', 'set-topic-attributes', 'topic-arn:s! attribute-name:s! attribute-value:s', 'Cambia un atributo del tema (`DisplayName`, `Policy`…).', { res: (c) => c.p.TopicArn }, (c) => {
  const t = find(c, c.p.TopicArn);
  (t.attrs ??= {})[c.p.AttributeName] = c.p.AttributeValue ?? '';
  return undefined;
});

const PROTOCOLS = ['http', 'https', 'email', 'email-json', 'sms', 'sqs', 'application', 'lambda', 'firehose'];

op('sns', 'subscribe', 'topic-arn:s! protocol:s! notification-endpoint:s attributes:j return-subscription-arn:b', 'Suscribe un correo, SMS, cola SQS o función Lambda a un tema. `--attributes FilterPolicy=…,RawMessageDelivery=true`.', { res: (c) => c.p.TopicArn }, (c) => {
  const t = find(c, c.p.TopicArn);
  const proto = String(c.p.Protocol);
  if (!PROTOCOLS.includes(proto)) throw new AwsError('InvalidParameter', `Invalid parameter: Amazon SNS does not support this protocol string: ${proto}`);
  const endpoint = String(c.p.NotificationEndpoint ?? '');
  if (proto === 'sqs') {
    try {
      findQueue(c.acct, c.region, endpoint);
    } catch {
      throw new AwsError('InvalidParameter', `Invalid parameter: SQS endpoint ARN`, 400);
    }
  }
  if (proto === 'lambda') resolveFn(c.acct, c.region, endpoint);
  const attrs = Object.fromEntries(Object.entries((c.p.Attributes ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  if (attrs.FilterPolicy) {
    try {
      JSON.parse(attrs.FilterPolicy);
    } catch {
      throw new AwsError('InvalidParameter', 'Invalid parameter: FilterPolicy: failed to parse JSON.', 400);
    }
  }
  const existing = t.subscriptions.find((s) => s.Protocol === proto && s.Endpoint === endpoint);
  if (existing) {
    existing.attrs = { ...(existing.attrs ?? {}), ...attrs };
    return { SubscriptionArn: existing.SubscriptionArn };
  }
  const confirmed = !['email', 'email-json', 'http', 'https'].includes(proto);
  const arn = `${c.p.TopicArn}:${uuidOf(c.acct, 'snssub')}`;
  const sub: SnsSub = { SubscriptionArn: confirmed ? arn : 'pending confirmation', Protocol: proto, Endpoint: endpoint, confirmed, attrs };
  t.subscriptions.push(sub);
  return { SubscriptionArn: sub.SubscriptionArn };
});

const subView = (c: OpCtx, t: SnsTopic, s: SnsSub) => ({ SubscriptionArn: s.SubscriptionArn, Owner: c.acct.id, Protocol: s.Protocol, Endpoint: s.Endpoint, TopicArn: t.TopicArn });

op('sns', 'list-subscriptions-by-topic', 'topic-arn:s!', 'Suscripciones de un tema.', { paginate: 'Subscriptions', res: (c) => c.p.TopicArn }, (c) => {
  const t = find(c, c.p.TopicArn);
  return { Subscriptions: t.subscriptions.map((s) => subView(c, t, s)) };
});

op('sns', 'list-subscriptions', '', 'Todas las suscripciones de la región.', { paginate: 'Subscriptions', res: () => '*' }, (c) => ({ Subscriptions: Object.values(regional(c.acct, c.region).sns).flatMap((t) => t.subscriptions.map((s) => subView(c, t, s))) }));

const findSub = (c: OpCtx, arn: string): { t: SnsTopic; s: SnsSub } => {
  for (const t of Object.values(regional(c.acct, c.region).sns)) {
    const s = t.subscriptions.find((x) => x.SubscriptionArn === arn);
    if (s) return { t, s };
  }
  throw new AwsError('NotFound', 'Subscription does not exist', 404);
};

op('sns', 'get-subscription-attributes', 'subscription-arn:s!', 'Atributos de una suscripción (política de filtro, entrega en bruto…).', { res: () => '*' }, (c) => {
  const { t, s } = findSub(c, c.p.SubscriptionArn);
  return { Attributes: { SubscriptionArn: s.SubscriptionArn, TopicArn: t.TopicArn, Owner: c.acct.id, Protocol: s.Protocol, Endpoint: s.Endpoint, ConfirmationWasAuthenticated: 'true', PendingConfirmation: String(!s.confirmed), RawMessageDelivery: 'false', ...(s.attrs ?? {}) } };
});

op('sns', 'set-subscription-attributes', 'subscription-arn:s! attribute-name:s! attribute-value:s', 'Cambia un atributo de la suscripción (`FilterPolicy`, `RawMessageDelivery`).', { res: () => '*' }, (c) => {
  const { s } = findSub(c, c.p.SubscriptionArn);
  if (!['FilterPolicy', 'FilterPolicyScope', 'RawMessageDelivery', 'RedrivePolicy', 'DeliveryPolicy'].includes(c.p.AttributeName)) throw new AwsError('InvalidParameter', `Invalid parameter: AttributeName`, 400);
  (s.attrs ??= {})[c.p.AttributeName] = c.p.AttributeValue ?? '';
  return undefined;
});

op('sns', 'unsubscribe', 'subscription-arn:s!', 'Borra una suscripción.', { res: () => '*' }, (c) => {
  const { t, s } = findSub(c, c.p.SubscriptionArn);
  t.subscriptions = t.subscriptions.filter((x) => x !== s);
  return undefined;
});

op('sns', 'publish', 'topic-arn:s! message:s! subject:s message-attributes:j message-group-id:s message-deduplication-id:s', 'Publica un mensaje en un tema: se entrega una copia a cada suscripción cuyo filtro lo admita.', { res: (c) => c.p.TopicArn }, (c) => {
  const t = find(c, c.p.TopicArn);
  if (String(c.p.Message).length === 0) throw new AwsError('InvalidParameter', 'Invalid parameter: Empty message', 400);
  const id = snsPublish(c.acct, c.region, t, String(c.p.Message), { subject: c.p.Subject, attrs: (c.p.MessageAttributes ?? {}) as Attrs });
  return { MessageId: id };
});
