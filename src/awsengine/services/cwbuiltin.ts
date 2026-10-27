/** Métricas que publican los servicios por su cuenta: Lambda, SQS, API Gateway y EC2 (comprobaciones de estado). */
import { regional } from '../account';
import type { Account, SqsQueue } from '../types';
import { cwPut } from './cwdata';
import { lambdaHooks } from './lambda';
import { alarmEngine, metricProviders } from './metrics';

const MIN = 60000;

// ───────────────────────── Lambda ─────────────────────────

lambdaHooks.push((a, region, fn, _q, out) => {
  const t = a.clock;
  const throttled = out.statusCode === 429;
  for (const dims of [{ FunctionName: fn.FunctionName }, {}] as Record<string, string>[]) {
    cwPut(a, region, 'AWS/Lambda', 'Invocations', dims, { t, value: 1, unit: 'Count' });
    cwPut(a, region, 'AWS/Lambda', 'Errors', dims, { t, value: out.functionError && !throttled ? 1 : 0, unit: 'Count' });
    cwPut(a, region, 'AWS/Lambda', 'Throttles', dims, { t, value: throttled ? 1 : 0, unit: 'Count' });
    if (!throttled) cwPut(a, region, 'AWS/Lambda', 'Duration', dims, { t, value: out.durationMs, unit: 'Milliseconds' });
  }
});

// ───────────────────────── SQS: se muestrea cada minuto ─────────────────────────

const lastSample = new WeakMap<Account, number>();
const lastSeq = new WeakMap<SqsQueue, number>();

function sampleQueues(a: Account): void {
  const minute = Math.floor(a.clock / MIN) * MIN;
  const prev = lastSample.get(a);
  if (prev === minute) return;
  lastSample.set(a, minute);
  for (const region of Object.keys(a.regions)) {
    for (const q of Object.values(regional(a, region).sqs ?? {})) {
      const visible = q.messages.filter((m) => m.visibleAt <= a.clock && m.availableAt <= a.clock).length;
      const hidden = q.messages.filter((m) => m.visibleAt > a.clock).length;
      const delayed = q.messages.filter((m) => m.availableAt > a.clock).length;
      const oldest = q.messages.length ? Math.max(0, Math.floor((a.clock - Math.min(...q.messages.map((m) => m.sentAt))) / 1000)) : 0;
      const sent = q.seq - (lastSeq.get(q) ?? q.seq);
      lastSeq.set(q, q.seq);
      const dims = { QueueName: q.name };
      // si el reloj saltó varios minutos, los minutos intermedios se rellenan con el último valor conocido
      const from = prev === undefined ? minute : Math.max(prev + MIN, minute - 120 * MIN);
      for (let t = from; t <= minute; t += MIN) {
        cwPut(a, region, 'AWS/SQS', 'ApproximateNumberOfMessagesVisible', dims, { t, value: visible, unit: 'Count' });
        cwPut(a, region, 'AWS/SQS', 'ApproximateNumberOfMessagesNotVisible', dims, { t, value: hidden, unit: 'Count' });
        cwPut(a, region, 'AWS/SQS', 'ApproximateNumberOfMessagesDelayed', dims, { t, value: delayed, unit: 'Count' });
        cwPut(a, region, 'AWS/SQS', 'ApproximateAgeOfOldestMessage', dims, { t, value: oldest, unit: 'Seconds' });
        cwPut(a, region, 'AWS/SQS', 'NumberOfMessagesSent', dims, { t, value: t === minute ? Math.max(0, sent) : 0, unit: 'Count' });
      }
    }
  }
}
alarmEngine.before.push(sampleQueues);

// ───────────────────────── API Gateway (HTTP) ─────────────────────────

export function apiMetrics(a: Account, host: string, status: number, ms: number): void {
  const m = /^([a-z0-9]{10})\.execute-api\.([a-z0-9-]+)\.amazonaws\.com$/.exec(host);
  if (!m) return;
  const dims = { ApiId: m[1] };
  const t = a.clock;
  cwPut(a, m[2], 'AWS/ApiGateway', 'Count', dims, { t, value: 1, unit: 'Count' });
  cwPut(a, m[2], 'AWS/ApiGateway', '4xx', dims, { t, value: status >= 400 && status < 500 ? 1 : 0, unit: 'Count' });
  cwPut(a, m[2], 'AWS/ApiGateway', '5xx', dims, { t, value: status >= 500 ? 1 : 0, unit: 'Count' });
  cwPut(a, m[2], 'AWS/ApiGateway', 'Latency', dims, { t, value: Math.max(1, ms), unit: 'Milliseconds' });
}

// ───────────────────────── EC2: comprobaciones de estado y red ─────────────────────────

metricProviders.push((a, region, q) => {
  if (q.ns !== 'AWS/EC2' || !q.dims.InstanceId) return null;
  const inst = regional(a, region).ec2.instances[q.dims.InstanceId];
  if (!inst) return null;
  const now = Math.floor(a.clock / MIN) * MIN;
  const pts = [] as { t: number; v: number }[];
  const from = Math.max(Math.ceil(Date.parse(inst.LaunchTime) / MIN) * MIN, now - 60 * MIN);
  for (let t = from; t <= now && inst.state === 'running'; t += MIN) {
    if (q.metric === 'StatusCheckFailed' || q.metric === 'StatusCheckFailed_System' || q.metric === 'StatusCheckFailed_Instance') pts.push({ t, v: 0 });
    else if (q.metric === 'NetworkIn' || q.metric === 'NetworkOut') pts.push({ t, v: 1200 + ((t / MIN) % 7) * 310 });
    else return null;
  }
  return pts;
});
