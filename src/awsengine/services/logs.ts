/** Amazon CloudWatch Logs: grupos y flujos de registros. Otros servicios (flow logs, Lambda…) escriben aquí. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import type { Account, LogEvent, LogGroup, LogStream, LogsState } from '../types';
import { mkArn } from '../util';

export const logsOf = (a: Account, region: string): LogsState => {
  const r = regional(a, region);
  return (r.logs ??= { groups: {} });
};

const arn = (c: Pick<OpCtx, 'acct' | 'region'>, g: string) => mkArn('logs', c.region, c.acct.id, `log-group:${g}:*`);
const RETENTION = [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653];

export function logsCreateGroup(a: Account, region: string, name: string, retention?: number): LogGroup {
  const s = logsOf(a, region);
  s.groups[name] ??= { logGroupName: name, creationTime: a.clock, retentionInDays: retention, streams: {}, tags: {} };
  return s.groups[name];
}

/** Escribe un registro (crea el grupo y el flujo si hace falta). */
export function logsPut(a: Account, region: string, group: string, stream: string, message: string, ts = a.clock): void {
  const g = logsCreateGroup(a, region, group);
  const st = (g.streams[stream] ??= { logStreamName: stream, creationTime: a.clock, events: [] });
  st.events.push({ timestamp: ts, message, ingestionTime: a.clock });
  if (g.retentionInDays) {
    const cut = a.clock - g.retentionInDays * 86400000;
    st.events = st.events.filter((e) => e.timestamp >= cut);
  }
}

const findGroup = (a: Account, region: string, name: string): LogGroup => {
  const g = logsOf(a, region).groups[name];
  if (!g) throw new AwsError('ResourceNotFoundException', 'The specified log group does not exist.', 400);
  return g;
};
const findStream = (g: LogGroup, name: string): LogStream => {
  const s = g.streams[name];
  if (!s) throw new AwsError('ResourceNotFoundException', 'The specified log stream does not exist.', 400);
  return s;
};

const bytes = (g: LogGroup) => Object.values(g.streams).reduce((n, s) => n + s.events.reduce((m, e) => m + e.message.length + 26, 0), 0);

const groupView = (c: OpCtx, g: LogGroup) => ({ logGroupName: g.logGroupName, creationTime: g.creationTime, ...(g.retentionInDays ? { retentionInDays: g.retentionInDays } : {}), metricFilterCount: 0, arn: arn(c, g.logGroupName), storedBytes: bytes(g), logGroupClass: 'STANDARD', logGroupArn: mkArn('logs', c.region, c.acct.id, `log-group:${g.logGroupName}`) });

op('logs', 'create-log-group', 'log-group-name:s! tags:j', 'Crea un grupo de registros (un contenedor de flujos con la misma retención y permisos).', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const n = String(c.p.LogGroupName);
  if (!/^[\w./#-]{1,512}$/.test(n)) throw new AwsError('InvalidParameterException', `1 validation error detected: Value '${n}' at 'logGroupName' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\.\\-_/#A-Za-z0-9]+`, 400);
  if (logsOf(c.acct, c.region).groups[n]) throw new AwsError('ResourceAlreadyExistsException', 'The specified log group already exists', 400);
  const g = logsCreateGroup(c.acct, c.region, n);
  if (c.p.Tags && typeof c.p.Tags === 'object') g.tags = c.p.Tags as Record<string, string>;
  return undefined;
});

op('logs', 'describe-log-groups', 'log-group-name-prefix:s log-group-name-pattern:s', 'Lista los grupos de registros.', { paginate: 'logGroups', res: () => '*', action: 'logs:DescribeLogGroups' }, (c) => ({ logGroups: Object.values(logsOf(c.acct, c.region).groups).filter((g) => (!c.p.LogGroupNamePrefix || g.logGroupName.startsWith(c.p.LogGroupNamePrefix)) && (!c.p.LogGroupNamePattern || g.logGroupName.includes(c.p.LogGroupNamePattern))).sort((x, y) => (x.logGroupName < y.logGroupName ? -1 : 1)).map((g) => groupView(c, g)) }));

op('logs', 'delete-log-group', 'log-group-name:s!', 'Borra un grupo con todos sus registros.', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  findGroup(c.acct, c.region, c.p.LogGroupName);
  delete logsOf(c.acct, c.region).groups[c.p.LogGroupName];
  return undefined;
});

op('logs', 'put-retention-policy', 'log-group-name:s! retention-in-days:i!', 'Define cuántos días se conservan los registros (por defecto, para siempre: y se paga el almacenamiento).', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  if (!RETENTION.includes(c.p.RetentionInDays)) throw new AwsError('InvalidParameterException', `Invalid retention: ${c.p.RetentionInDays}. Allowed values: ${RETENTION.join(', ')}.`, 400);
  g.retentionInDays = c.p.RetentionInDays;
  return undefined;
});

op('logs', 'delete-retention-policy', 'log-group-name:s!', 'Vuelve a conservar los registros para siempre.', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  findGroup(c.acct, c.region, c.p.LogGroupName).retentionInDays = undefined;
  return undefined;
});

op('logs', 'create-log-stream', 'log-group-name:s! log-stream-name:s!', 'Crea un flujo dentro de un grupo (una fuente de registros: una instancia, un contenedor…).', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  if (g.streams[c.p.LogStreamName]) throw new AwsError('ResourceAlreadyExistsException', 'The specified log stream already exists', 400);
  g.streams[c.p.LogStreamName] = { logStreamName: c.p.LogStreamName, creationTime: c.acct.clock, events: [] };
  return undefined;
});

op('logs', 'describe-log-streams', 'log-group-name:s! log-stream-name-prefix:s order-by:s descending:b', 'Lista los flujos de un grupo.', { paginate: 'logStreams', res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  let list = Object.values(g.streams).filter((s) => !c.p.LogStreamNamePrefix || s.logStreamName.startsWith(c.p.LogStreamNamePrefix));
  list = list.sort((x, y) => (c.p.OrderBy === 'LastEventTime' ? (x.events.at(-1)?.timestamp ?? 0) - (y.events.at(-1)?.timestamp ?? 0) : x.logStreamName < y.logStreamName ? -1 : 1));
  if (c.p.Descending) list.reverse();
  return { logStreams: list.map((s) => ({ logStreamName: s.logStreamName, creationTime: s.creationTime, ...(s.events.length ? { firstEventTimestamp: s.events[0].timestamp, lastEventTimestamp: s.events.at(-1)!.timestamp, lastIngestionTime: s.events.at(-1)!.ingestionTime } : {}), uploadSequenceToken: String(s.events.length).padStart(20, '0'), arn: mkArn('logs', c.region, c.acct.id, `log-group:${g.logGroupName}:log-stream:${s.logStreamName}`), storedBytes: 0 })) };
});

op('logs', 'delete-log-stream', 'log-group-name:s! log-stream-name:s!', 'Borra un flujo.', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  findStream(g, c.p.LogStreamName);
  delete g.streams[c.p.LogStreamName];
  return undefined;
});

op('logs', 'put-log-events', 'log-group-name:s! log-stream-name:s! log-events:f! sequence-token:s', 'Escribe registros en un flujo (cada uno con su marca de tiempo en milisegundos).', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  const s = findStream(g, c.p.LogStreamName);
  const evs = c.p.LogEvents as { timestamp: number; message: string }[];
  if (!evs.length) throw new AwsError('InvalidParameterException', '1 validation error detected: Value \'[]\' at \'logEvents\' failed to satisfy constraint: Member must have length greater than or equal to 1', 400);
  const sorted = [...evs].sort((x, y) => Number(x.timestamp) - Number(y.timestamp));
  let rejected = 0;
  for (const e of sorted) {
    const ts = Number(e.timestamp);
    if (ts < c.acct.clock - 14 * 86400000) {
      rejected++;
      continue;
    }
    s.events.push({ timestamp: ts, message: String(e.message), ingestionTime: c.acct.clock });
  }
  s.events.sort((x, y) => x.timestamp - y.timestamp);
  return { nextSequenceToken: String(s.events.length).padStart(20, '0'), ...(rejected ? { rejectLogEventsInfo: { tooOldLogEventEndIndex: rejected } } : {}) };
});

const evView = (e: LogEvent) => ({ timestamp: e.timestamp, message: e.message, ingestionTime: e.ingestionTime });

op('logs', 'get-log-events', 'log-group-name:s! log-stream-name:s! start-time:i end-time:i limit:i start-from-head:b', 'Lee los registros de un flujo.', { res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const s = findStream(findGroup(c.acct, c.region, c.p.LogGroupName), c.p.LogStreamName);
  let evs = s.events.filter((e) => (c.p.StartTime === undefined || e.timestamp >= c.p.StartTime) && (c.p.EndTime === undefined || e.timestamp < c.p.EndTime));
  const lim = c.p.Limit ?? 10000;
  evs = c.p.StartFromHead ? evs.slice(0, lim) : evs.slice(-lim);
  return { events: evs.map(evView), nextForwardToken: 'f/' + String(s.events.length), nextBackwardToken: 'b/0' };
});

/** Patrón de filtro sencillo: `ERROR`, `"dos palabras"`, `?ERROR ?WARN`, `-DEBUG` y varios términos (todos deben aparecer). */
export function matchPattern(pattern: string | undefined, message: string): boolean {
  if (!pattern || !pattern.trim()) return true;
  const toks = pattern.match(/"[^"]*"|\S+/g) ?? [];
  const ors = toks.filter((t) => t.startsWith('?')).map((t) => t.slice(1).replace(/^"|"$/g, ''));
  const ands = toks.filter((t) => !t.startsWith('?') && !t.startsWith('-')).map((t) => t.replace(/^"|"$/g, ''));
  const nots = toks.filter((t) => t.startsWith('-')).map((t) => t.slice(1).replace(/^"|"$/g, ''));
  if (ors.length && !ors.some((t) => message.includes(t))) return false;
  if (!ands.every((t) => message.includes(t))) return false;
  return !nots.some((t) => message.includes(t));
}

op('logs', 'filter-log-events', 'log-group-name:s! log-stream-names:l filter-pattern:s start-time:i end-time:i limit:i', 'Busca registros en todos los flujos de un grupo con un patrón (`ERROR`, `?ERROR ?WARN`, `"texto exacto"`).', { paginate: 'events', res: (c) => arn(c, c.p.LogGroupName) }, (c) => {
  const g = findGroup(c.acct, c.region, c.p.LogGroupName);
  const out: { logStreamName: string; ev: LogEvent }[] = [];
  for (const s of Object.values(g.streams)) {
    if (c.p.LogStreamNames && !(c.p.LogStreamNames as string[]).includes(s.logStreamName)) continue;
    for (const e of s.events) if ((c.p.StartTime === undefined || e.timestamp >= c.p.StartTime) && (c.p.EndTime === undefined || e.timestamp < c.p.EndTime) && matchPattern(c.p.FilterPattern, e.message)) out.push({ logStreamName: s.logStreamName, ev: e });
  }
  out.sort((x, y) => x.ev.timestamp - y.ev.timestamp);
  return { events: out.slice(0, c.p.Limit ?? 10000).map((x, i) => ({ logStreamName: x.logStreamName, timestamp: x.ev.timestamp, message: x.ev.message, ingestionTime: x.ev.ingestionTime, eventId: String(i).padStart(56, '0') })), searchedLogStreams: Object.values(g.streams).map((s) => ({ logStreamName: s.logStreamName, searchedCompletely: true })) };
});
