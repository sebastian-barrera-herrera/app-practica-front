/** AWS Step Functions: máquinas de estados (Amazon States Language) que se ejecutan de verdad sobre Lambda, SQS, SNS y DynamoDB. */
import { regional } from '../account';
import { AwsError, op, type OpCtx } from '../registry';
import { roleCaller, sdkCall } from '../sdk';
import type { Account, SfnEvent, SfnExecution, SfnMachine, SfnState } from '../types';
import { iso, mkArn } from '../util';
import { roleCan, roleTrusts } from './flowlogs';
import { fnArn, resolveFn, runFunction } from './lambda';

export const sfnOf = (a: Account, region: string): SfnState => {
  const r = regional(a, region);
  return (r.sfn ??= { machines: {} });
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Def = { Comment?: string; StartAt: string; States: Record<string, State> };
interface State {
  Type: 'Task' | 'Pass' | 'Choice' | 'Wait' | 'Succeed' | 'Fail' | 'Parallel' | 'Map';
  Next?: string;
  End?: boolean;
  Resource?: string;
  Parameters?: Json;
  ResultSelector?: Json;
  ResultPath?: string | null;
  InputPath?: string | null;
  OutputPath?: string | null;
  Result?: Json;
  Retry?: { ErrorEquals: string[]; IntervalSeconds?: number; MaxAttempts?: number; BackoffRate?: number }[];
  Catch?: { ErrorEquals: string[]; ResultPath?: string | null; Next: string }[];
  Choices?: Choice[];
  Default?: string;
  Seconds?: number;
  SecondsPath?: string;
  Timestamp?: string;
  Error?: string;
  Cause?: string;
  Branches?: Def[];
  ItemsPath?: string;
  ItemProcessor?: Def;
  Iterator?: Def;
  MaxConcurrency?: number;
}
type Choice = Record<string, unknown> & { Next?: string };

class SfnFail extends Error {
  constructor(public error: string, public cause: string) {
    super(error);
  }
}

// ───────────────────────── JSONPath mínimo ─────────────────────────

const parts = (path: string): string[] => path.replace(/^\$\.?/, '').split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== '');
const getPath = (obj: unknown, path: string | null | undefined): unknown => {
  if (path === undefined || path === '$') return obj;
  if (path === null) return {};
  let cur: unknown = obj;
  for (const p of parts(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

function setPath(obj: unknown, path: string | null | undefined, value: unknown): unknown {
  if (path === undefined || path === '$') return value;
  if (path === null) return obj;
  const base = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...(obj as Record<string, unknown>) } : {};
  const ps = parts(path);
  let cur = base as Record<string, unknown>;
  ps.forEach((p, i) => {
    if (i === ps.length - 1) cur[p] = value;
    else {
      const nx = cur[p] && typeof cur[p] === 'object' ? { ...(cur[p] as Record<string, unknown>) } : {};
      cur[p] = nx;
      cur = nx;
    }
  });
  return base;
}

/** Aplica `Parameters`/`ResultSelector`: las claves `x.$` se sustituyen por el valor de la ruta (`$.a`, `$$.Execution.Id`). */
function template(t: Json | undefined, data: unknown, ctxObj: unknown): unknown {
  if (Array.isArray(t)) return t.map((x) => template(x, data, ctxObj));
  if (t && typeof t === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(t)) {
      if (k.endsWith('.$') && typeof v === 'string') out[k.slice(0, -2)] = v.startsWith('$$') ? getPath(ctxObj, v.slice(1)) : intrinsic(v, data, ctxObj);
      else out[k] = template(v, data, ctxObj);
    }
    return out;
  }
  return t;
}

function intrinsic(expr: string, data: unknown, ctxObj: unknown): unknown {
  const f = /^States\.(\w+)\((.*)\)$/.exec(expr);
  if (!f) return getPath(data, expr);
  const args = f[2] ? f[2].split(/,\s*(?![^()]*\))/).map((x) => x.trim()) : [];
  const val = (x: string) => (x.startsWith('$') ? getPath(data, x) : x.startsWith("'") ? x.slice(1, -1) : x);
  if (f[1] === 'Format') {
    const vals = args.slice(1).map(val);
    let i = 0;
    return String(val(args[0])).replace(/\{\}/g, () => String(vals[i++]));
  }
  if (f[1] === 'JsonToString') return JSON.stringify(val(args[0]));
  if (f[1] === 'StringToJson') return JSON.parse(String(val(args[0])));
  if (f[1] === 'Array') return args.map(val);
  if (f[1] === 'ArrayLength') return (val(args[0]) as unknown[]).length;
  if (f[1] === 'UUID') return '00000000-0000-4000-8000-000000000000';
  void ctxObj;
  return undefined;
}

// ───────────────────────── Choice ─────────────────────────

function evalChoice(rule: Choice, data: unknown): boolean {
  if (rule.And) return (rule.And as Choice[]).every((r) => evalChoice(r, data));
  if (rule.Or) return (rule.Or as Choice[]).some((r) => evalChoice(r, data));
  if (rule.Not) return !evalChoice(rule.Not as Choice, data);
  const v = getPath(data, rule.Variable as string);
  for (const [k, exp] of Object.entries(rule)) {
    if (k === 'Variable' || k === 'Next') continue;
    const cmp = (kind: string, a: unknown, b: unknown): boolean | undefined => {
      switch (kind) {
        case 'Equals': return a === b;
        case 'LessThan': return (a as number) < (b as number);
        case 'GreaterThan': return (a as number) > (b as number);
        case 'LessThanEquals': return (a as number) <= (b as number);
        case 'GreaterThanEquals': return (a as number) >= (b as number);
        default: return undefined;
      }
    };
    if (k === 'IsPresent') return (v !== undefined) === exp;
    if (k === 'IsNull') return (v === null) === exp;
    if (k === 'IsString') return (typeof v === 'string') === exp;
    if (k === 'IsNumeric') return (typeof v === 'number') === exp;
    if (k === 'IsBoolean') return (typeof v === 'boolean') === exp;
    const m = /^(String|Numeric|Boolean|Timestamp)(\w+?)(Path)?$/.exec(k);
    if (m) {
      const rhs = m[3] ? getPath(data, exp as string) : exp;
      if (v === undefined) return false;
      if (m[1] === 'String' && m[2] === 'Matches') return new RegExp('^' + String(rhs).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(String(v));
      const r = cmp(m[2], m[1] === 'Timestamp' ? Date.parse(String(v)) : v, m[1] === 'Timestamp' ? Date.parse(String(rhs)) : rhs);
      if (r !== undefined) return r;
    }
  }
  return false;
}

// ───────────────────────── ejecución ─────────────────────────

interface Run {
  a: Account;
  region: string;
  m: SfnMachine;
  caller: ReturnType<typeof roleCaller>;
  roleArn: string;
  events: SfnEvent[];
  t: number;
  t0: number;
  execArn: string;
  steps: number;
}

const SERVICE_OPS: Record<string, [string, string]> = { 'sqs:sendMessage': ['sqs', 'send-message'], 'sns:publish': ['sns', 'publish'], 'dynamodb:putItem': ['dynamodb', 'put-item'], 'dynamodb:getItem': ['dynamodb', 'get-item'], 'dynamodb:updateItem': ['dynamodb', 'update-item'], 'dynamodb:deleteItem': ['dynamodb', 'delete-item'], 'events:putEvents': ['events', 'put-events'] };
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function ev(r: Run, type: string, details?: Record<string, unknown>): void {
  r.events.push({ id: r.events.length + 1, timestamp: r.t0 + r.t, type, previousEventId: Math.max(0, r.events.length), ...(details ? { details } : {}) });
}

function callTask(r: Run, s: State, input: unknown): unknown {
  const res = s.Resource ?? '';
  if (res.startsWith('arn:aws:lambda:') || res === 'arn:aws:states:::lambda:invoke') {
    const direct = res !== 'arn:aws:states:::lambda:invoke';
    const target = direct ? res : String((input as { FunctionName?: string }).FunctionName ?? '');
    const payload = direct ? input : (input as { Payload?: unknown }).Payload ?? {};
    if (!roleCan(r.a, r.roleArn, ['lambda:InvokeFunction'], target.startsWith('arn:') ? target.split(':').slice(0, 7).join(':') : fnArn(r.a, r.region, target.split(':')[0]))) throw new SfnFail('States.TaskFailed', `User: ${r.caller.arn} is not authorized to perform: lambda:InvokeFunction on resource: ${target} because no identity-based policy allows the lambda:InvokeFunction action (Service: AWSLambda; Status Code: 403; Error Code: AccessDeniedException)`);
    let found;
    try {
      found = resolveFn(r.a, r.region, target);
    } catch {
      throw new SfnFail('Lambda.ResourceNotFoundException', `Function not found: ${target}`);
    }
    if (found.fn.reserved === 0) throw new SfnFail('Lambda.TooManyRequestsException', 'Rate Exceeded.');
    const out = runFunction(r.a, found.region, found.fn, found.qualifier, JSON.stringify(payload));
    r.t += Math.ceil(out.durationMs);
    ev(r, 'LambdaFunctionScheduled', { resource: fnArn(r.a, found.region, found.fn.FunctionName) });
    if (out.functionError) {
      let e: { errorType?: string; errorMessage?: string } = {};
      try {
        e = JSON.parse(out.payload) as typeof e;
      } catch {
        /* sin formato */
      }
      ev(r, 'LambdaFunctionFailed', { error: e.errorType ?? 'Lambda.Unknown', cause: out.payload });
      throw new SfnFail(e.errorType ?? 'Lambda.Unknown', out.payload);
    }
    ev(r, 'LambdaFunctionSucceeded', { output: out.payload });
    const body = out.payload === '' ? null : (JSON.parse(out.payload) as unknown);
    return direct ? body : { ExecutedVersion: out.version, Payload: body, SdkHttpMetadata: { HttpStatusCode: 200 }, SdkResponseMetadata: {}, StatusCode: 200 };
  }
  const m = /^arn:aws:states:::(aws-sdk:)?([a-z0-9-]+):(\w+)(?:\.\w+)?$/.exec(res);
  if (!m) throw new SfnFail('States.Runtime', `The Resource provided ${res} is not recognized.`);
  const [svc, opName] = m[1] ? [m[2], kebab(m[3])] : (SERVICE_OPS[`${m[2]}:${m[3]}`] ?? [m[2], kebab(m[3])]);
  const out = sdkCall(r.a, r.region, r.caller, svc, opName, (input ?? {}) as Record<string, unknown>);
  if (!out.ok) throw new SfnFail(out.error!.Code.includes('.') ? out.error!.Code : `${svc[0].toUpperCase()}${svc.slice(1)}.${out.error!.Code}`, out.error!.Message);
  return out.data;
}

function runStates(r: Run, def: Def, input: unknown, ctxObj: unknown): unknown {
  let name = def.StartAt;
  let data = input;
  for (;;) {
    if (++r.steps > 500) throw new SfnFail('States.Runtime', 'The execution exceeded 500 state transitions in the simulator.');
    const s = def.States[name];
    if (!s) throw new SfnFail('States.Runtime', `State ${name} does not exist.`);
    ev(r, `${s.Type}StateEntered`, { name, input: JSON.stringify(data) });
    const afterInput = s.InputPath !== undefined ? getPath(data, s.InputPath) : data;
    const finish = (res: unknown, next?: string, end?: boolean): void => {
      let out: unknown;
      if (s.Type === 'Task' || s.Type === 'Parallel' || s.Type === 'Map' || s.Type === 'Pass') {
        const sel = s.ResultSelector ? template(s.ResultSelector, res, ctxObj) : res;
        out = setPath(data, s.ResultPath === undefined ? '$' : s.ResultPath, sel);
      } else out = res;
      if (s.OutputPath !== undefined) out = getPath(out, s.OutputPath);
      ev(r, `${s.Type}StateExited`, { name, output: JSON.stringify(out) });
      data = out;
      if (end) name = '';
      else name = next ?? '';
    };
    switch (s.Type) {
      case 'Succeed': {
        ev(r, 'SucceedStateExited', { name, output: JSON.stringify(afterInput) });
        return s.OutputPath !== undefined ? getPath(afterInput, s.OutputPath) : afterInput;
      }
      case 'Fail':
        throw new SfnFail(s.Error ?? 'States.Fail', s.Cause ?? '');
      case 'Pass': {
        const res = s.Result !== undefined ? s.Result : s.Parameters !== undefined ? template(s.Parameters, afterInput, ctxObj) : afterInput;
        finish(res, s.Next, s.End);
        break;
      }
      case 'Wait': {
        const secs = s.Seconds ?? (s.SecondsPath ? Number(getPath(afterInput, s.SecondsPath)) : s.Timestamp ? Math.max(0, (Date.parse(s.Timestamp) - (r.t0 + r.t)) / 1000) : 0);
        r.t += secs * 1000;
        finish(afterInput, s.Next, s.End);
        break;
      }
      case 'Choice': {
        const hit = (s.Choices ?? []).find((c) => evalChoice(c, afterInput));
        const next = hit?.Next ?? s.Default;
        if (!next) throw new SfnFail('States.NoChoiceMatched', `State '${name}' failed to find a matching choice and has no Default.`);
        finish(afterInput, next);
        break;
      }
      case 'Parallel': {
        const eff = s.Parameters !== undefined ? template(s.Parameters, afterInput, ctxObj) : afterInput;
        const res = (s.Branches ?? []).map((b) => runStates(r, b, eff, ctxObj));
        finish(res, s.Next, s.End);
        break;
      }
      case 'Map': {
        const items = (s.ItemsPath ? getPath(afterInput, s.ItemsPath) : afterInput) as unknown[];
        if (!Array.isArray(items)) throw new SfnFail('States.Runtime', 'The ItemsPath did not return an array.');
        const proc = s.ItemProcessor ?? s.Iterator!;
        const res = items.map((it, i) => runStates(r, proc, s.Parameters !== undefined ? template(s.Parameters, afterInput, { ...(ctxObj as object), Map: { Item: { Index: i, Value: it } } }) : it, ctxObj));
        finish(res, s.Next, s.End);
        break;
      }
      case 'Task': {
        const eff = s.Parameters !== undefined ? template(s.Parameters, afterInput, ctxObj) : afterInput;
        let attempt = 0;
        const retry = s.Retry ?? [];
        const counts = retry.map(() => 0);
        for (;;) {
          try {
            ev(r, 'TaskScheduled', { resource: s.Resource });
            const res = callTask(r, s, eff);
            finish(res, s.Next, s.End);
            break;
          } catch (e) {
            if (!(e instanceof SfnFail)) throw e;
            ev(r, 'TaskFailed', { error: e.error, cause: e.cause });
            const ri = retry.findIndex((x) => x.ErrorEquals.includes(e.error) || x.ErrorEquals.includes('States.ALL') || (x.ErrorEquals.includes('States.TaskFailed') && e.error !== 'States.Timeout'));
            if (ri >= 0 && counts[ri] < (retry[ri].MaxAttempts ?? 3)) {
              r.t += (retry[ri].IntervalSeconds ?? 1) * 1000 * Math.pow(retry[ri].BackoffRate ?? 2, counts[ri]);
              counts[ri]++;
              attempt++;
              ev(r, 'TaskStateRetried', { attempt });
              continue;
            }
            const ci = (s.Catch ?? []).find((x) => x.ErrorEquals.includes(e.error) || x.ErrorEquals.includes('States.ALL') || (x.ErrorEquals.includes('States.TaskFailed') && e.error !== 'States.Timeout'));
            if (!ci) throw e;
            const out = setPath(data, ci.ResultPath === undefined ? '$' : ci.ResultPath, { Error: e.error, Cause: e.cause });
            ev(r, 'TaskStateExited', { name, output: JSON.stringify(out) });
            data = out;
            name = ci.Next;
            break;
          }
        }
        break;
      }
      default:
        throw new SfnFail('States.Runtime', `Unsupported state type ${(s as State).Type}`);
    }
    if (!name) return data;
  }
}

const execArn = (a: Account, region: string, m: SfnMachine, name: string) => mkArn('states', region, a.id, `execution:${m.name}:${name}`);

/** Ejecuta la máquina entera (en el reloj virtual) y guarda la ejecución; el estado visible depende de la hora. */
export function runMachine(a: Account, region: string, m: SfnMachine, input: string, name: string): SfnExecution {
  const def = JSON.parse(m.definition) as Def;
  const r: Run = { a, region, m, caller: roleCaller(a, m.roleArn, `${m.name}`), roleArn: m.roleArn, events: [], t: 0, t0: a.clock, execArn: execArn(a, region, m, name), steps: 0 };
  ev(r, 'ExecutionStarted', { input, roleArn: m.roleArn });
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new AwsError('InvalidExecutionInput', 'Invalid State Machine Execution Input: \'Unrecognized token\'', 400);
  }
  const exec: SfnExecution = { name, stateMachineArn: m.arn, input, startDate: a.clock, stopDate: a.clock, status: 'SUCCEEDED', events: r.events };
  const ctxObj = { Execution: { Id: r.execArn, Input: parsed, Name: name, StartTime: iso(a.clock) }, StateMachine: { Id: m.arn, Name: m.name } };
  try {
    const out = runStates(r, def, parsed, ctxObj);
    exec.output = JSON.stringify(out);
    ev(r, 'ExecutionSucceeded', { output: exec.output });
  } catch (e) {
    if (!(e instanceof SfnFail)) throw e;
    exec.status = 'FAILED';
    exec.error = e.error;
    exec.cause = e.cause;
    ev(r, 'ExecutionFailed', { error: e.error, cause: e.cause });
  }
  exec.stopDate = a.clock + Math.round(r.t);
  return exec;
}

/** Inicia una ejecución desde otro servicio (EventBridge). */
export function sfnStart(a: Account, region: string, arn: string, input: string, o: { by?: string } = {}): void {
  const m = sfnOf(a, arn.split(':')[3] || region).machines[arn.split(':').pop()!];
  if (!m) return;
  const name = `${o.by ?? 'auto'}-${Object.keys(m.executions).length + 1}`;
  m.executions[name] = runMachine(a, region, m, input, name);
}

// ───────────────────────── operaciones ─────────────────────────

const machineArn = (c: Pick<OpCtx, 'acct' | 'region'>, name: string) => mkArn('states', c.region, c.acct.id, `stateMachine:${name}`);

function findMachine(c: OpCtx, arn: string): SfnMachine {
  const m = sfnOf(c.acct, c.region).machines[String(arn).split(':').pop() ?? ''];
  if (!m || m.arn !== arn) throw new AwsError('StateMachineDoesNotExist', `State Machine Does Not Exist: '${arn}'`, 400);
  return m;
}

function validate(def: string): Def {
  let d: Def;
  try {
    d = JSON.parse(def) as Def;
  } catch (e) {
    throw new AwsError('InvalidDefinition', `Invalid State Machine Definition: 'SCHEMA_VALIDATION_FAILED: ${(e as Error).message}'`, 400);
  }
  const check = (x: Def, path: string): void => {
    if (!x.StartAt || !x.States) throw new AwsError('InvalidDefinition', `Invalid State Machine Definition: 'SCHEMA_VALIDATION_FAILED: Missing 'StartAt' or 'States' at ${path}'`, 400);
    if (!x.States[x.StartAt]) throw new AwsError('InvalidDefinition', `Invalid State Machine Definition: 'MISSING_TRANSITION_TARGET: StartAt refers to an undefined state: ${x.StartAt} at /StartAt'`, 400);
    for (const [n, s] of Object.entries(x.States)) {
      const targets = [s.Next, s.Default, ...(s.Choices ?? []).map((c) => c.Next), ...(s.Catch ?? []).map((c) => c.Next)].filter(Boolean) as string[];
      for (const t of targets) if (!x.States[t]) throw new AwsError('InvalidDefinition', `Invalid State Machine Definition: 'MISSING_TRANSITION_TARGET: State '${n}' has a transition to an undefined state: ${t} at /States/${n}'`, 400);
      if (!s.Next && !s.End && !['Succeed', 'Fail', 'Choice'].includes(s.Type)) throw new AwsError('InvalidDefinition', `Invalid State Machine Definition: 'SCHEMA_VALIDATION_FAILED: State '${n}' must have either Next or End set to true at /States/${n}'`, 400);
      for (const b of s.Branches ?? []) check(b, `/States/${n}`);
      if (s.ItemProcessor ?? s.Iterator) check((s.ItemProcessor ?? s.Iterator)!, `/States/${n}`);
    }
  };
  check(d, '/');
  return d;
}

op('stepfunctions', 'create-state-machine', 'name:s! definition:s! role-arn:s! type:s tags:f', 'Crea una máquina de estados (definición en Amazon States Language). Su rol debe confiar en `states.amazonaws.com`.', { authz: (c) => [{ action: 'states:CreateStateMachine', resource: machineArn(c, String(c.p.Name)) }, { action: 'iam:PassRole', resource: String(c.p.RoleArn), context: { 'iam:PassedToService': 'states.amazonaws.com' } }] }, (c) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(c.p.Name)) throw new AwsError('InvalidName', `Invalid Name: '${c.p.Name}' (Service: AWSStepFunctions; Status Code: 400; Error Code: InvalidName)`, 400);
  validate(c.p.Definition);
  const role = c.acct.iam.roles[String(c.p.RoleArn).split('/').pop() ?? ''];
  if (!role || !roleTrusts(c.acct, role.Arn, 'states.amazonaws.com')) throw new AwsError('InvalidArn', `Invalid Arn: 'Role ${c.p.RoleArn} does not trust states.amazonaws.com'`, 400);
  const s = sfnOf(c.acct, c.region);
  if (s.machines[c.p.Name]) throw new AwsError('StateMachineAlreadyExists', `State Machine Already Exists: '${machineArn(c, c.p.Name)}'`, 400);
  s.machines[c.p.Name] = { name: c.p.Name, arn: machineArn(c, c.p.Name), definition: c.p.Definition, roleArn: role.Arn, type: c.p.Type === 'EXPRESS' ? 'EXPRESS' : 'STANDARD', creationDate: c.acct.clock, executions: {} };
  return { stateMachineArn: machineArn(c, c.p.Name), creationDate: c.acct.clock / 1000 };
});

op('stepfunctions', 'update-state-machine', 'state-machine-arn:s! definition:s role-arn:s', 'Cambia la definición o el rol de la máquina.', { res: (c) => c.p.StateMachineArn }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  if (c.p.Definition) {
    validate(c.p.Definition);
    m.definition = c.p.Definition;
  }
  if (c.p.RoleArn) m.roleArn = c.p.RoleArn;
  return { updateDate: c.acct.clock / 1000 };
});

op('stepfunctions', 'describe-state-machine', 'state-machine-arn:s!', 'Datos de la máquina de estados.', { res: (c) => c.p.StateMachineArn }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  return { stateMachineArn: m.arn, name: m.name, status: 'ACTIVE', definition: m.definition, roleArn: m.roleArn, type: m.type, creationDate: m.creationDate / 1000 };
});

op('stepfunctions', 'list-state-machines', '', 'Lista las máquinas de estados.', { paginate: 'stateMachines', res: () => '*' }, (c) => ({ stateMachines: Object.values(sfnOf(c.acct, c.region).machines).map((m) => ({ stateMachineArn: m.arn, name: m.name, type: m.type, creationDate: m.creationDate / 1000 })) }));

op('stepfunctions', 'delete-state-machine', 'state-machine-arn:s!', 'Borra la máquina de estados.', { res: (c) => c.p.StateMachineArn }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  delete sfnOf(c.acct, c.region).machines[m.name];
  return {};
});

/** Estado visible de la ejecución según la hora virtual: sigue «en marcha» mientras haya esperas pendientes. */
const statusOf = (a: Account, e: SfnExecution) => (a.clock < e.stopDate ? 'RUNNING' : e.status);

op('stepfunctions', 'start-execution', 'state-machine-arn:s! name:s input:s trace-header:s', 'Inicia una ejecución con un JSON de entrada. Las esperas (`Wait`) hacen que siga `RUNNING` hasta que pase el tiempo.', { res: (c) => String(c.p.StateMachineArn).replace(':stateMachine:', ':execution:') + ':*' }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  if (m.type === 'EXPRESS') throw new AwsError('StateMachineTypeNotSupported', 'This operation is not supported by this type of state machine', 400);
  const name = c.p.Name ?? `ejecucion-${Object.keys(m.executions).length + 1}`;
  if (m.executions[name]) throw new AwsError('ExecutionAlreadyExists', `Execution Already Exists: '${execArn(c.acct, c.region, m, name)}'`, 400);
  m.executions[name] = runMachine(c.acct, c.region, m, c.p.Input ?? '{}', name);
  return { executionArn: execArn(c.acct, c.region, m, name), startDate: c.acct.clock / 1000 };
});

op('stepfunctions', 'start-sync-execution', 'state-machine-arn:s! name:s input:s', 'Ejecuta una máquina EXPRESS y espera el resultado.', { res: (c) => c.p.StateMachineArn }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  if (m.type !== 'EXPRESS') throw new AwsError('StateMachineTypeNotSupported', 'This operation is not supported by this type of state machine', 400);
  const name = c.p.Name ?? `sync-${Object.keys(m.executions).length + 1}`;
  const e = runMachine(c.acct, c.region, m, c.p.Input ?? '{}', name);
  m.executions[name] = e;
  return { executionArn: execArn(c.acct, c.region, m, name), stateMachineArn: m.arn, name, startDate: e.startDate / 1000, stopDate: e.stopDate / 1000, status: e.status, ...(e.output ? { output: e.output } : {}), ...(e.error ? { error: e.error } : {}), ...(e.cause ? { cause: e.cause } : {}), input: e.input };
});

function findExecution(c: OpCtx, arn: string): { m: SfnMachine; e: SfnExecution } {
  const p = String(arn).split(':');
  const m = sfnOf(c.acct, c.region).machines[p[6]];
  const e = m?.executions[p[7]];
  if (!m || !e) throw new AwsError('ExecutionDoesNotExist', `Execution Does Not Exist: '${arn}'`, 400);
  return { m, e };
}

op('stepfunctions', 'describe-execution', 'execution-arn:s!', 'Estado, entrada y salida de una ejecución.', { res: (c) => c.p.ExecutionArn }, (c) => {
  const { m, e } = findExecution(c, c.p.ExecutionArn);
  const st = statusOf(c.acct, e);
  return { executionArn: c.p.ExecutionArn, stateMachineArn: m.arn, name: e.name, status: st, startDate: e.startDate / 1000, ...(st !== 'RUNNING' ? { stopDate: e.stopDate / 1000 } : {}), input: e.input, ...(st !== 'RUNNING' && e.output ? { output: e.output } : {}), ...(st !== 'RUNNING' && e.error ? { error: e.error, cause: e.cause } : {}) };
});

op('stepfunctions', 'list-executions', 'state-machine-arn:s! status-filter:s', 'Lista las ejecuciones de una máquina (con `--status-filter FAILED` solo las fallidas).', { paginate: 'executions', res: (c) => c.p.StateMachineArn }, (c) => {
  const m = findMachine(c, c.p.StateMachineArn);
  return { executions: Object.values(m.executions).filter((e) => !c.p.StatusFilter || statusOf(c.acct, e) === c.p.StatusFilter).map((e) => ({ executionArn: execArn(c.acct, c.region, m, e.name), stateMachineArn: m.arn, name: e.name, status: statusOf(c.acct, e), startDate: e.startDate / 1000, ...(statusOf(c.acct, e) !== 'RUNNING' ? { stopDate: e.stopDate / 1000 } : {}) })) };
});

op('stepfunctions', 'stop-execution', 'execution-arn:s! error:s cause:s', 'Detiene una ejecución en marcha.', { res: (c) => c.p.ExecutionArn }, (c) => {
  const { e } = findExecution(c, c.p.ExecutionArn);
  if (statusOf(c.acct, e) === 'RUNNING') {
    e.status = 'ABORTED';
    e.stopDate = c.acct.clock;
    e.error = c.p.Error;
    e.cause = c.p.Cause;
  }
  return { stopDate: e.stopDate / 1000 };
});

op('stepfunctions', 'get-execution-history', 'execution-arn:s! reverse-order:b', 'Historial de eventos de la ejecución (qué estado se ejecutó, con qué entrada y qué salió).', { paginate: 'events', res: (c) => c.p.ExecutionArn }, (c) => {
  const { e } = findExecution(c, c.p.ExecutionArn);
  let list = e.events.filter((x) => x.timestamp <= c.acct.clock);
  if (c.p.ReverseOrder) list = [...list].reverse();
  return { events: list.map((x) => ({ timestamp: x.timestamp / 1000, type: x.type, id: x.id, previousEventId: x.previousEventId, ...(x.details ? { [`${x.type.charAt(0).toLowerCase()}${x.type.slice(1)}Details`]: x.details } : {}) })) };
});

