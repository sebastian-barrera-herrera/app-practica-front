/** Amazon EventBridge: buses, reglas (patrones de eventos y programaciones), destinos y `put-events`. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { tickers } from '../tick';
import type { Account, EventRule, EventsState, EventTarget } from '../types';
import { iso, mkArn, newId, toArr } from '../util';
import { invokeAsync } from './lambda';
import { findQueue, queueAllowsService, sqsSend } from './sqs';
import { sfnStart } from './sfn';
import { snsPublish, topicAllowsService } from './sns';
import { logsPut, logsOf } from './logs';

export const eventsOf = (a: Account, region: string): EventsState => {
  const r = regional(a, region);
  r.events ??= { buses: {}, log: [] };
  r.events.buses.default ??= { name: 'default', rules: {} };
  return r.events;
};

const ruleArn = (a: Account, region: string, rule: EventRule) => mkArn('events', region, a.id, `rule/${rule.EventBusName === 'default' ? '' : rule.EventBusName + '/'}${rule.Name}`);
const busArn = (a: Account, region: string, name: string) => mkArn('events', region, a.id, `event-bus/${name}`);
const evId = (a: Account) => newId(a, 'evid', '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

// ───────────────────────── patrones ─────────────────────────

/** ¿Cumple el evento el patrón? (igualdad, `prefix`, `suffix`, `anything-but`, `numeric`, `exists`, `equals-ignore-case`, objetos anidados). */
export function patternMatches(pattern: unknown, event: unknown): boolean {
  if (pattern === null || typeof pattern !== 'object' || Array.isArray(pattern)) return false;
  const e = (event ?? {}) as Record<string, unknown>;
  for (const [k, rule] of Object.entries(pattern as Record<string, unknown>)) {
    if (k === '$or' && Array.isArray(rule)) {
      if (!rule.some((r) => patternMatches(r, event))) return false;
      continue;
    }
    const v = e[k];
    if (Array.isArray(rule)) {
      const vals = Array.isArray(v) ? v : v === undefined ? [] : [v];
      const ok = rule.some((r) => {
        if (r === null) return vals.some((x) => x === null);
        if (typeof r !== 'object') return vals.some((x) => x === r);
        const o = r as Record<string, unknown>;
        if ('exists' in o) return (v !== undefined) === !!o.exists;
        if ('prefix' in o) return vals.some((x) => typeof x === 'string' && x.startsWith(String(o.prefix)));
        if ('suffix' in o) return vals.some((x) => typeof x === 'string' && x.endsWith(String(o.suffix)));
        if ('equals-ignore-case' in o) return vals.some((x) => typeof x === 'string' && x.toLowerCase() === String(o['equals-ignore-case']).toLowerCase());
        if ('anything-but' in o) {
          const ban = toArr(o['anything-but'] as unknown[]);
          return vals.length > 0 && !vals.some((x) => ban.includes(x as never));
        }
        if ('numeric' in o) {
          const n = o.numeric as (string | number)[];
          return vals.some((x) => {
            if (typeof x !== 'number') return false;
            for (let i = 0; i + 1 < n.length; i += 2) {
              const t = Number(n[i + 1]);
              const ok2 = n[i] === '=' ? x === t : n[i] === '>' ? x > t : n[i] === '>=' ? x >= t : n[i] === '<' ? x < t : n[i] === '<=' ? x <= t : false;
              if (!ok2) return false;
            }
            return true;
          });
        }
        return false;
      });
      if (!ok) return false;
    } else if (rule && typeof rule === 'object') {
      if (v === undefined || v === null || typeof v !== 'object') return false;
      if (!patternMatches(rule, v)) return false;
    } else return false;
  }
  return true;
}

const getPath = (obj: unknown, path: string): unknown => {
  let cur: unknown = obj;
  for (const part of path.replace(/^\$\.?/, '').split('.').filter(Boolean)) {
    const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(part);
    if (!m) return undefined;
    cur = (cur as Record<string, unknown> | undefined)?.[m[1]];
    if (m[2] !== undefined) cur = (cur as unknown[] | undefined)?.[Number(m[2])];
  }
  return cur;
};

function targetInput(t: EventTarget, event: Record<string, unknown>): unknown {
  if (t.Input) return JSON.parse(t.Input);
  if (t.InputPath) return getPath(event, t.InputPath);
  if (t.InputTransformer) {
    const vals: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(t.InputTransformer.InputPathsMap ?? {})) vals[k] = getPath(event, p);
    const text = t.InputTransformer.InputTemplate.replace(/<([A-Za-z0-9_-]+)>/g, (_m, k: string) => {
      const v = vals[k];
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return event;
}

/** Otros servicios (Systems Manager…) aportan sus tipos de destino: devuelven true si el ARN era suyo. */
export const targetHooks: ((a: Account, region: string, t: EventTarget, input: unknown, ruleArn: string) => boolean)[] = [];

/** Entrega el evento a los destinos de una regla. */
function fire(a: Account, region: string, rule: EventRule, event: Record<string, unknown>): void {
  const arn = ruleArn(a, region, rule);
  for (const t of rule.targets) {
    const input = targetInput(t, event);
    try {
      if (targetHooks.some((h) => h(a, region, t, input, arn))) continue;
      if (t.Arn.startsWith('arn:aws:logs:')) {
        const g = /^arn:aws:logs:([^:]+):\d+:log-group:(.+?)(?::\*)?$/.exec(t.Arn);
        if (g && logsOf(a, g[1]).groups[g[2]]) logsPut(a, g[1], g[2], `${new Date(a.clock).toISOString().slice(0, 10).replace(/-/g, '/')}/[$LATEST]${t.Id}`, typeof input === 'string' ? input : JSON.stringify(input));
      } else if (t.Arn.startsWith('arn:aws:lambda:')) invokeAsync(a, region, t.Arn, input, { service: 'events.amazonaws.com', sourceArn: arn });
      else if (t.Arn.startsWith('arn:aws:sqs:')) {
        const { q } = findQueue(a, region, t.Arn);
        if (queueAllowsService(q, 'events.amazonaws.com', arn)) sqsSend(a, q, typeof input === 'string' ? input : JSON.stringify(input), { group: q.name.endsWith('.fifo') ? 'eventbridge' : undefined, dedup: q.name.endsWith('.fifo') ? String(event.id) : undefined });
      } else if (t.Arn.startsWith('arn:aws:sns:')) {
        const topic = regional(a, t.Arn.split(':')[3]).sns[t.Arn];
        if (topic && topicAllowsService(topic, 'events.amazonaws.com', arn)) snsPublish(a, t.Arn.split(':')[3], topic, typeof input === 'string' ? input : JSON.stringify(input));
      }
      else if (t.Arn.startsWith('arn:aws:states:')) sfnStart(a, region, t.Arn, JSON.stringify(input), { by: 'events' });
    } catch {
      /* destino que no existe o sin permiso: EventBridge lo reintenta y acaba descartándolo */
    }
  }
}

function envelope(a: Account, region: string, o: { source: string; detailType: string; detail: unknown; resources?: string[]; account?: string }): Record<string, unknown> {
  return { version: '0', id: evId(a), 'detail-type': o.detailType, source: o.source, account: o.account ?? a.id, time: iso(a.clock).replace('+00:00', 'Z'), region, resources: o.resources ?? [], detail: o.detail };
}

/** Publica un evento en un bus (lo usan `put-events`, S3 y otros servicios). Devuelve el id y las reglas que coincidieron. */
export function putEvent(a: Account, region: string, bus: string, o: { source: string; detailType: string; detail: unknown; resources?: string[] }): { id: string; matched: string[] } {
  const st = eventsOf(a, region);
  const ev = envelope(a, region, o);
  const matched: string[] = [];
  for (const rule of Object.values(st.buses[bus]?.rules ?? {})) {
    if (rule.State !== 'ENABLED' || !rule.EventPattern) continue;
    let pat: unknown;
    try {
      pat = JSON.parse(rule.EventPattern);
    } catch {
      continue;
    }
    if (patternMatches(pat, ev)) {
      matched.push(rule.Name);
      fire(a, region, rule, ev);
    }
  }
  st.log.push({ id: String(ev.id), time: a.clock, source: o.source, detailType: o.detailType, matched });
  return { id: String(ev.id), matched };
}

// ───────────────────────── programaciones ─────────────────────────

export function parseRate(expr: string): number | null {
  const m = /^rate\((\d+) (minute|minutes|hour|hours|day|days)\)$/.exec(expr);
  if (!m) return null;
  const n = Number(m[1]);
  return n * (m[2].startsWith('minute') ? 60000 : m[2].startsWith('hour') ? 3600000 : 86400000);
}

const cronField = (f: string, v: number): boolean => {
  if (f === '*' || f === '?') return true;
  return f.split(',').some((part) => {
    const step = /^(\*|\d+)\/(\d+)$/.exec(part);
    if (step) return v >= (step[1] === '*' ? 0 : Number(step[1])) && (v - (step[1] === '*' ? 0 : Number(step[1]))) % Number(step[2]) === 0;
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return v >= Number(range[1]) && v <= Number(range[2]);
    return Number(part) === v;
  });
};

export function cronMatches(expr: string, ms: number): boolean {
  const m = /^cron\((.+)\)$/.exec(expr);
  if (!m) return false;
  const [min, hour, dom, mon, dow] = m[1].trim().split(/\s+/);
  const d = new Date(ms);
  const wd = d.getUTCDay() + 1;
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dowOk = dow === '*' || dow === '?' || dow.split(',').some((x) => (names.indexOf(x.toUpperCase()) >= 0 ? names.indexOf(x.toUpperCase()) + 1 === wd : cronField(x, wd)));
  const dowRange = /^([A-Z]{3})-([A-Z]{3})$/i.exec(dow);
  const rangeOk = dowRange ? wd >= names.indexOf(dowRange[1].toUpperCase()) + 1 && wd <= names.indexOf(dowRange[2].toUpperCase()) + 1 : false;
  return cronField(min, d.getUTCMinutes()) && cronField(hour, d.getUTCHours()) && cronField(dom, d.getUTCDate()) && cronField(mon, d.getUTCMonth() + 1) && (dowOk || rangeOk);
}

export function validSchedule(expr: string): boolean {
  if (/^rate\(/.test(expr)) {
    const m = /^rate\((\d+) (minute|minutes|hour|hours|day|days)\)$/.exec(expr);
    if (!m) return false;
    const singular = Number(m[1]) === 1;
    return singular ? /^(minute|hour|day)$/.test(m[2]) : /^(minutes|hours|days)$/.test(m[2]);
  }
  return /^cron\((\S+\s+){5}\S+\)$/.test(expr);
}

tickers.push((a) => {
  for (const region of Object.keys(a.regions)) {
    const st = a.regions[region].events;
    if (!st) continue;
    for (const bus of Object.values(st.buses)) {
      for (const rule of Object.values(bus.rules)) {
        if (!rule.ScheduleExpression || rule.State !== 'ENABLED') {
          rule.checkedAt = a.clock;
          continue;
        }
        const period = parseRate(rule.ScheduleExpression);
        const fires: number[] = [];
        if (period) {
          let t = rule.checkedAt + period;
          while (t <= a.clock && fires.length < 100) {
            fires.push(t);
            t += period;
          }
          rule.checkedAt = fires.length ? fires[fires.length - 1] : rule.checkedAt;
        } else {
          let t = Math.floor(rule.checkedAt / 60000) * 60000 + 60000;
          let n = 0;
          while (t <= a.clock && n++ < 2000) {
            if (cronMatches(rule.ScheduleExpression, t)) fires.push(t);
            t += 60000;
          }
          rule.checkedAt = Math.max(rule.checkedAt, Math.floor(a.clock / 60000) * 60000);
        }
        for (const t of fires.slice(-20)) {
          const was = a.clock;
          a.clock = t;
          fire(a, region, rule, envelope(a, region, { source: 'aws.events', detailType: 'Scheduled Event', detail: {}, resources: [ruleArn(a, region, rule)] }));
          a.clock = Math.max(was, a.clock);
        }
      }
    }
  }
});

// ───────────────────────── operaciones ─────────────────────────

const busOf = (c: OpCtx, name = 'default') => {
  const b = eventsOf(c.acct, c.region).buses[name];
  if (!b) throw new AwsError('ResourceNotFoundException', `Event bus ${name} does not exist.`, 400);
  return b;
};

const ruleOf = (c: OpCtx, name: string, bus?: string): EventRule => {
  const r = busOf(c, bus ?? 'default').rules[name];
  if (!r) throw new AwsError('ResourceNotFoundException', `Rule ${name} does not exist${bus && bus !== 'default' ? ` on EventBus ${bus}` : ''}.`, 400);
  return r;
};

const ruleView = (c: OpCtx, r: EventRule) => ({ Name: r.Name, Arn: ruleArn(c.acct, c.region, r), ...(r.EventPattern ? { EventPattern: r.EventPattern } : {}), ...(r.ScheduleExpression ? { ScheduleExpression: r.ScheduleExpression } : {}), State: r.State, ...(r.Description ? { Description: r.Description } : {}), EventBusName: r.EventBusName });

op('events', 'create-event-bus', 'name:s! tags:f', 'Crea un bus de eventos propio (además del `default`).', { res: (c) => busArn(c.acct, c.region, c.p.Name) }, (c) => {
  const st = eventsOf(c.acct, c.region);
  if (st.buses[c.p.Name]) throw new AwsError('ResourceAlreadyExistsException', `Event bus ${c.p.Name} already exists.`, 400);
  st.buses[c.p.Name] = { name: c.p.Name, rules: {} };
  return { EventBusArn: busArn(c.acct, c.region, c.p.Name) };
});

op('events', 'list-event-buses', 'name-prefix:s', 'Lista los buses de eventos.', { res: () => '*' }, (c) => ({ EventBuses: Object.values(eventsOf(c.acct, c.region).buses).filter((b) => !c.p.NamePrefix || b.name.startsWith(c.p.NamePrefix)).map((b) => ({ Name: b.name, Arn: busArn(c.acct, c.region, b.name) })) }));

op('events', 'delete-event-bus', 'name:s!', 'Borra un bus de eventos (el `default` no se puede borrar).', { res: (c) => busArn(c.acct, c.region, c.p.Name) }, (c) => {
  if (c.p.Name === 'default') throw new AwsError('ValidationException', 'Cannot delete event bus default.', 400);
  delete eventsOf(c.acct, c.region).buses[c.p.Name];
  return undefined;
});

op('events', 'put-rule', 'name:s! schedule-expression:s event-pattern:s state:s description:s event-bus-name:s tags:f', 'Crea o actualiza una regla: o un patrón de eventos o una programación (`rate(5 minutes)`, `cron(0 12 * * ? *)`).', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Name}`) }, (c) => {
  if (!c.p.EventPattern && !c.p.ScheduleExpression) throw new AwsError('ValidationException', 'Parameter(s) EventPattern or ScheduleExpression must be specified.', 400);
  if (!/^[\.\-_A-Za-z0-9]{1,64}$/.test(c.p.Name)) throw new AwsError('ValidationException', `1 validation error detected: Value '${c.p.Name}' at 'name' failed to satisfy constraint: Member must satisfy regular expression pattern: [\\.\\-_A-Za-z0-9]+`, 400);
  if (c.p.ScheduleExpression && !validSchedule(c.p.ScheduleExpression)) throw new AwsError('ValidationException', 'Parameter ScheduleExpression is not valid.', 400);
  if (c.p.EventPattern) {
    try {
      const j = JSON.parse(c.p.EventPattern);
      if (typeof j !== 'object' || Array.isArray(j)) throw new Error('x');
    } catch {
      throw new AwsError('InvalidEventPatternException', 'Event pattern is not valid. Reason: Filter is not an object', 400);
    }
  }
  const bus = busOf(c, c.p.EventBusName);
  const cur = bus.rules[c.p.Name];
  bus.rules[c.p.Name] = { Name: c.p.Name, EventBusName: bus.name, Description: c.p.Description ?? cur?.Description, EventPattern: c.p.EventPattern, ScheduleExpression: c.p.ScheduleExpression, State: c.p.State ?? cur?.State ?? 'ENABLED', targets: cur?.targets ?? [], checkedAt: c.acct.clock };
  return { RuleArn: ruleArn(c.acct, c.region, bus.rules[c.p.Name]) };
});

op('events', 'describe-rule', 'name:s! event-bus-name:s', 'Datos de una regla.', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Name}`) }, (c) => ruleView(c, ruleOf(c, c.p.Name, c.p.EventBusName)));

op('events', 'list-rules', 'name-prefix:s event-bus-name:s', 'Lista las reglas de un bus.', { res: () => '*' }, (c) => ({ Rules: Object.values(busOf(c, c.p.EventBusName).rules).filter((r) => !c.p.NamePrefix || r.Name.startsWith(c.p.NamePrefix)).map((r) => ruleView(c, r)) }));

op('events', 'enable-rule', 'name:s! event-bus-name:s', 'Activa una regla.', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Name}`) }, (c) => {
  const r = ruleOf(c, c.p.Name, c.p.EventBusName);
  r.State = 'ENABLED';
  r.checkedAt = c.acct.clock;
  return undefined;
});

op('events', 'disable-rule', 'name:s! event-bus-name:s', 'Desactiva una regla (deja de enviar eventos a sus destinos).', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Name}`) }, (c) => {
  ruleOf(c, c.p.Name, c.p.EventBusName).State = 'DISABLED';
  return undefined;
});

op('events', 'delete-rule', 'name:s! event-bus-name:s force:b', 'Borra una regla (primero hay que quitar sus destinos).', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Name}`) }, (c) => {
  const r = ruleOf(c, c.p.Name, c.p.EventBusName);
  if (r.targets.length) throw new AwsError('ValidationException', 'Rule can\'t be deleted since it has targets.', 400);
  delete busOf(c, c.p.EventBusName).rules[r.Name];
  return undefined;
});

op('events', 'put-targets', 'rule:s! event-bus-name:s targets:j!', 'Añade destinos (Lambda, SQS, SNS, Step Functions…) a una regla: `Id`, `Arn` y, opcionalmente, `Input`, `InputPath` o `InputTransformer`.', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Rule}`) }, (c) => {
  const r = ruleOf(c, c.p.Rule, c.p.EventBusName);
  const list = toArr<EventTarget>(c.p.Targets);
  if (r.targets.length + list.length > 5) throw new AwsError('LimitExceededException', 'The requested resource exceeds the maximum number allowed.', 400);
  for (const t of list) {
    if (!t.Id || !t.Arn) throw new AwsError('ValidationException', 'Parameter Id and Arn are required for each target.', 400);
    r.targets = [...r.targets.filter((x) => x.Id !== t.Id), t];
  }
  return { FailedEntryCount: 0, FailedEntries: [] };
});

op('events', 'list-targets-by-rule', 'rule:s! event-bus-name:s', 'Destinos de una regla.', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Rule}`) }, (c) => ({ Targets: ruleOf(c, c.p.Rule, c.p.EventBusName).targets }));

op('events', 'remove-targets', 'rule:s! event-bus-name:s ids:l!', 'Quita destinos de una regla.', { res: (c) => mkArn('events', c.region, c.acct.id, `rule/${c.p.Rule}`) }, (c) => {
  const r = ruleOf(c, c.p.Rule, c.p.EventBusName);
  r.targets = r.targets.filter((t) => !toArr<string>(c.p.Ids).includes(t.Id));
  return { FailedEntryCount: 0, FailedEntries: [] };
});

op('events', 'put-events', 'entries:j!', 'Publica eventos en un bus: `Source`, `DetailType` y `Detail` (JSON en texto). Cada regla cuyo patrón coincida los envía a sus destinos.', { res: (c) => busArn(c.acct, c.region, 'default') }, (c) => {
  const entries = toArr<{ Source?: string; DetailType?: string; Detail?: string; EventBusName?: string; Resources?: string[] }>(c.p.Entries);
  if (entries.length > 10) throw new AwsError('ValidationException', 'Too many entries: maximum is 10.', 400);
  const out = entries.map((e) => {
    if (!e.Source || !e.DetailType || e.Detail === undefined) return { ErrorCode: 'MalformedDetail', ErrorMessage: 'Source, DetailType and Detail are required.' };
    let detail: unknown;
    try {
      detail = JSON.parse(e.Detail);
    } catch {
      return { ErrorCode: 'MalformedDetail', ErrorMessage: 'Detail is malformed.' };
    }
    const bus = e.EventBusName ?? 'default';
    if (!eventsOf(c.acct, c.region).buses[bus]) return { ErrorCode: 'InvalidArgument', ErrorMessage: `Event bus ${bus} does not exist.` };
    return { EventId: putEvent(c.acct, c.region, bus, { source: e.Source, detailType: e.DetailType, detail, resources: e.Resources }).id };
  });
  return { FailedEntryCount: out.filter((x) => 'ErrorCode' in x).length, Entries: out };
});

op('events', 'test-event-pattern', 'event-pattern:s! event:s!', 'Comprueba si un evento (JSON) cumple un patrón, sin crear nada.', { res: () => '*', authz: false }, (c) => {
  let pat: unknown;
  let ev: unknown;
  try {
    pat = JSON.parse(c.p.EventPattern);
    if (typeof pat !== 'object' || pat === null || Array.isArray(pat)) throw new Error('x');
  } catch {
    throw new AwsError('InvalidEventPatternException', 'Event pattern is not valid. Reason: Filter is not an object', 400);
  }
  try {
    ev = JSON.parse(c.p.Event);
  } catch {
    throw new AwsError('ValidationException', 'Event is not valid JSON.', 400);
  }
  return { Result: patternMatches(pat, ev) };
});

