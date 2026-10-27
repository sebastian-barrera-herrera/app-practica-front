/**
 * AWS Lambda: funciones en Python que se ejecutan de verdad sobre el intérprete de Python del simulador,
 * con eventos, contexto, variables de entorno, registros en CloudWatch, versiones, alias, permisos, concurrencia,
 * invocaciones asíncronas con reintentos y mapeos de origen de eventos (SQS).
 */
import { b64decode, b64encode, md5, sha256 } from '../../engine/commands/hash';
import { zipFiles } from '../../engine/commands/archive';
import { PySession } from '../../pyengine/session';
import { awsBridge } from '../../pyengine/stdlib/aws';
import { regional } from '../account';
import { AwsError, UsageErr, op, type OpCtx } from '../registry';
import { roleCaller, sdkCall } from '../sdk';
import { tickers } from '../tick';
import type { Account, LambdaEsm, LambdaFn, LambdaPolicyStatement, LambdaState, LambdaVersion } from '../types';
import { iso, mkArn, newId, toArr } from '../util';
import { roleCan } from './flowlogs';
import { logsCreateGroup, logsOf } from './logs';
import { findQueue, queueArn, sqsReceive, sqsSend, sqsSweep } from './sqs';

export const lambdaOf = (a: Account, region: string): LambdaState => {
  const r = regional(a, region);
  return (r.lambda ??= { functions: {}, esms: {} });
};

export const fnArn = (a: Account, region: string, name: string) => mkArn('lambda', region, a.id, `function:${name}`);

const RUNTIMES = ['python3.9', 'python3.10', 'python3.11', 'python3.12', 'python3.13', 'nodejs18.x', 'nodejs20.x', 'nodejs22.x', 'java17', 'java21', 'dotnet8', 'ruby3.3', 'provided.al2023', 'go1.x'];
const DEPRECATED = ['python3.6', 'python3.7', 'python3.8', 'nodejs12.x', 'nodejs14.x', 'nodejs16.x', 'dotnetcore3.1', 'ruby2.7'];
const NAME_RE = /^[a-zA-Z0-9-_]{1,64}$/;

/** Memoria (MB) con la que una función tiene el equivalente a una vCPU completa. */
const FULL_CPU_MB = 1769;
/** Pasos del intérprete que se consideran 1 ms de CPU con una vCPU completa. */
const STEPS_PER_MS = 2000;

const rfc = (ms: number) =>
  iso(ms)
    .replace(/\+00:00$/, '.000+0000')
    .replace(/(\.\d{3})\d*\+0000$/, '$1+0000');
const hexToB64 = (h: string) => b64encode(String.fromCharCode(...(h.match(/../g) ?? []).map((x) => parseInt(x, 16))));
const shaOf = (files: Record<string, string>) => hexToB64(sha256(JSON.stringify(Object.entries(files).sort())));
const uuid = (a: Account, k: string) => newId(a, k, '', 32, 'hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

// ───────────────────────── búsqueda ─────────────────────────

/** `nombre`, `nombre:alias`, `nombre:3`, ARN (con o sin calificador) → función y calificador. */
export function resolveFn(a: Account, region: string, ref: string): { fn: LambdaFn; qualifier?: string; region: string } {
  let r = region;
  let rest = ref;
  const m = /^arn:aws:lambda:([a-z0-9-]+):\d{12}:function:(.+)$/.exec(ref);
  if (m) {
    r = m[1];
    rest = m[2];
  } else if (/^\d{12}:function:/.test(ref)) rest = ref.replace(/^\d{12}:function:/, '');
  const [name, qualifier] = rest.split(':');
  const fn = lambdaOf(a, r).functions[name];
  if (!fn) throw new AwsError('ResourceNotFoundException', `Function not found: ${fnArn(a, r, name)}${qualifier ? ':' + qualifier : ''}`, 404);
  if (qualifier && qualifier !== '$LATEST' && !fn.aliases[qualifier] && !fn.versions.some((v) => v.Version === qualifier))
    throw new AwsError('ResourceNotFoundException', `Function not found: ${fnArn(a, r, name)}:${qualifier}`, 404);
  return { fn, qualifier, region: r };
}

/** Versión concreta (instantánea de código y configuración) a la que apunta un calificador. */
function versionFor(fn: LambdaFn, qualifier?: string): LambdaVersion {
  if (!qualifier || qualifier === '$LATEST') return fn;
  const target = fn.aliases[qualifier]?.FunctionVersion ?? qualifier;
  return target === '$LATEST' ? fn : (fn.versions.find((v) => v.Version === target) ?? fn);
}

const snapshot = (fn: LambdaFn, version: string): LambdaVersion => ({
  Version: version,
  CodeSha256: fn.CodeSha256,
  CodeSize: fn.CodeSize,
  files: { ...fn.files },
  Description: fn.Description,
  Runtime: fn.Runtime,
  Handler: fn.Handler,
  MemorySize: fn.MemorySize,
  Timeout: fn.Timeout,
  Environment: { ...fn.Environment },
  Role: fn.Role,
  LastModified: fn.LastModified,
});

// ───────────────────────── ejecución ─────────────────────────

interface Warm {
  session: PySession;
  key: string;
  lastUsed: number;
  stream: string;
}

const WARM = new WeakMap<Account, Map<string, Warm>>();

export interface InvokeOutcome {
  statusCode: number;
  functionError?: 'Unhandled' | 'Handled';
  payload: string;
  logs: string[];
  durationMs: number;
  billedMs: number;
  maxMemoryMb: number;
  initMs?: number;
  requestId: string;
  version: string;
}

const pyLit = (s: string) => JSON.stringify(s);

function initScript(v: LambdaVersion, env: Record<string, string>): string {
  const mod = v.Handler.split('.').slice(0, -1).join('.');
  return `
import os as _os, sys as _sys, json as _json, importlib as _il
_os.environ.update(_json.loads(${pyLit(JSON.stringify(env))}))
if '/var/task' not in _sys.path:
    _sys.path.insert(0, '/var/task')
__ierr__ = None
try:
    __mod__ = _il.import_module(${pyLit(mod)})
except BaseException as _e:
    _tn = type(_e).__name__
    if _tn == 'SyntaxError':
        __ierr__ = _json.dumps({'errorMessage': "Syntax error in module '" + ${pyLit(mod)} + "': " + str(_e), 'errorType': 'Runtime.UserCodeSyntaxError', 'requestId': '', 'stackTrace': []})
    elif _tn in ('ModuleNotFoundError', 'ImportError'):
        __ierr__ = _json.dumps({'errorMessage': "Unable to import module '" + ${pyLit(mod)} + "': " + str(_e), 'errorType': 'Runtime.ImportModuleError', 'requestId': '', 'stackTrace': []})
    else:
        __ierr__ = _json.dumps({'errorMessage': str(_e), 'errorType': _tn, 'requestId': '', 'stackTrace': []})
`;
}

function invokeScript(
  v: LambdaVersion,
  ctx: {
    name: string;
    arn: string;
    requestId: string;
    group: string;
    stream: string;
    deadline: number;
  },
  event: string,
): string {
  const fnName = v.Handler.split('.').slice(-1)[0];
  const mod = v.Handler.split('.').slice(0, -1).join('.');
  return `
import json as _json, traceback as _tb, _lambda_rt as _rt
from botocore.exceptions import ClientError as _CE
__out__ = None
__err__ = None
try:
    _h = getattr(__mod__, ${pyLit(fnName)}, None)
    if _h is None:
        __err__ = _json.dumps({'errorMessage': "Handler '" + ${pyLit(fnName)} + "' missing on module '" + ${pyLit(mod)} + "'", 'errorType': 'Runtime.HandlerNotFound', 'requestId': ${pyLit(ctx.requestId)}, 'stackTrace': []})
    else:
        _ctx = _rt.LambdaContext(${pyLit(ctx.name)}, ${pyLit(v.Version)}, ${pyLit(ctx.arn)}, ${v.MemorySize}, ${pyLit(ctx.requestId)}, ${pyLit(ctx.group)}, ${pyLit(ctx.stream)}, ${ctx.deadline})
        _r = _h(_json.loads(${pyLit(event)}), _ctx)
        try:
            __out__ = _json.dumps(_r)
        except BaseException as _me:
            __err__ = _json.dumps({'errorMessage': 'Unable to marshal response: ' + str(_me), 'errorType': 'Runtime.MarshalError', 'requestId': ${pyLit(ctx.requestId)}, 'stackTrace': []})
except BaseException as _e:
    _st = [ln for ln in _tb.format_exc().splitlines() if ln.strip()]
    __err__ = _json.dumps({'errorMessage': str(_e), 'errorType': 'ClientError' if isinstance(_e, _CE) else type(_e).__name__, 'requestId': ${pyLit(ctx.requestId)}, 'stackTrace': _st})
`;
}

const lines = (s: string) =>
  s
    .split('\n')
    .filter((l, i, all) => l !== '' || i < all.length - 1)
    .map((l) => l.replace(/\r$/, ''));

function logsAllowed(a: Account, region: string, fn: LambdaFn): boolean {
  const role = fn.Role;
  const g = `/aws/lambda/${fn.FunctionName}`;
  const exists = !!logsOf(a, region).groups[g];
  return roleCan(a, role, exists ? ['logs:CreateLogStream', 'logs:PutLogEvents'] : ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents']);
}

function writeLogs(a: Account, region: string, fn: LambdaFn, stream: string, evs: string[], ts: number): void {
  if (!evs.length || !logsAllowed(a, region, fn)) return;
  const g = logsCreateGroup(a, region, `/aws/lambda/${fn.FunctionName}`);
  const st = (g.streams[stream] ??= {
    logStreamName: stream,
    creationTime: a.clock,
    events: [],
  });
  evs.forEach((m, i) => st.events.push({ timestamp: ts + i, message: m, ingestionTime: a.clock }));
}

/** Profundidad de invocaciones encadenadas (una función que escribe en el bucket que la dispara, una cola que se alimenta a sí misma…). */
let DEPTH = 0;
/** Lambda detecta los bucles recursivos y corta la cadena a las 16 invocaciones. */
const MAX_DEPTH = 16;

/** Ejecuta una versión de una función. No avanza el reloj de la cuenta (lo hace quien llama con `durationMs`). */
export function runFunction(a: Account, region: string, fn: LambdaFn, qualifier: string | undefined, event: string, o: { caller?: boolean } = {}): InvokeOutcome {
  if (DEPTH >= MAX_DEPTH) {
    const v = versionFor(fn, qualifier);
    return {
      statusCode: 429,
      functionError: 'Unhandled',
      payload: JSON.stringify({
        errorType: 'RecursiveInvocationException',
        errorMessage: `Lambda detected an infinite loop: ${fn.FunctionName} was invoked ${MAX_DEPTH} times in a chain by the same event source and the chain was stopped.`,
      }),
      logs: [],
      durationMs: 0,
      billedMs: 0,
      maxMemoryMb: 0,
      requestId: uuid(a, 'lreq'),
      version: v.Version,
    };
  }
  DEPTH++;
  try {
    return runFunctionOnce(a, region, fn, qualifier, event, o);
  } finally {
    DEPTH--;
  }
}

function runFunctionOnce(a: Account, region: string, fn: LambdaFn, qualifier: string | undefined, event: string, o: { caller?: boolean } = {}): InvokeOutcome {
  const v = versionFor(fn, qualifier);
  const requestId = uuid(a, 'lreq');
  const arnQ = fnArn(a, region, fn.FunctionName) + (qualifier && qualifier !== '$LATEST' ? ':' + qualifier : '');
  const version = v.Version;
  void o;
  if (!v.Runtime.startsWith('python')) {
    return {
      statusCode: 200,
      functionError: 'Unhandled',
      payload: JSON.stringify({
        errorMessage: `Este simulador solo ejecuta funciones de Python (el runtime ${v.Runtime} se puede crear pero no ejecutar).`,
        errorType: 'Runtime.UnsupportedRuntime',
      }),
      logs: [],
      durationMs: 1,
      billedMs: 1,
      maxMemoryMb: 30,
      requestId,
      version,
    };
  }
  const key = `${fn.FunctionName}:${version}:${v.CodeSha256}:${md5(JSON.stringify([v.Handler, v.MemorySize, v.Environment, v.Role]))}`;
  const warm = WARM.get(a) ?? new Map<string, Warm>();
  WARM.set(a, warm);
  const prov = Object.entries(fn.provisioned).some(([q, n]) => n > 0 && (q === version || q === qualifier));
  let w = warm.get(key);
  const cold = !w || a.clock - w.lastUsed > 300000;
  const ts = new Date(a.clock);
  const stamp = `${ts.getUTCFullYear()}/${String(ts.getUTCMonth() + 1).padStart(2, '0')}/${String(ts.getUTCDate()).padStart(2, '0')}`;
  const group = `/aws/lambda/${fn.FunctionName}`;
  const evLogs: string[] = [];
  const memMb = v.MemorySize;
  const slow = FULL_CPU_MB / memMb;
  const fnCaller = roleCaller(a, v.Role, fn.FunctionName);
  const prevBridge = awsBridge.call;
  awsBridge.call = (service, opName, params, reg) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(params) as Record<string, unknown>;
    } catch {
      return JSON.stringify({
        __error: {
          Code: 'SerializationException',
          Message: 'Could not parse the request parameters.',
          Status: 400,
        },
      });
    }
    const r = sdkCall(a, reg || region, fnCaller, service, opName, parsed);
    return JSON.stringify(r.ok ? r.data : { __error: r.error });
  };
  let initMs: number | undefined;
  let stream = w?.stream ?? '';
  try {
    if (cold) {
      stream = `${stamp}/[${version}]${md5(key + a.clock).slice(0, 32)}`;
      const files: Record<string, string> = { ...v.files };
      const session = new PySession({
        files,
        cwd: '/var/task',
        now: a.clock,
        seed: 7,
        maxSteps: 3_000_000,
      });
      const env: Record<string, string> = {
        ...v.Environment,
        AWS_REGION: region,
        AWS_DEFAULT_REGION: region,
        AWS_LAMBDA_FUNCTION_NAME: fn.FunctionName,
        AWS_LAMBDA_FUNCTION_MEMORY_SIZE: String(memMb),
        AWS_LAMBDA_FUNCTION_VERSION: version,
        AWS_LAMBDA_LOG_GROUP_NAME: group,
        AWS_LAMBDA_LOG_STREAM_NAME: stream,
        LAMBDA_TASK_ROOT: '/var/task',
        AWS_EXECUTION_ENV: `AWS_Lambda_${v.Runtime}`,
        TZ: ':UTC',
      };
      const init = session.runSync(initScript(v, env));
      const steps = session.I.steps;
      const sizeKb = v.CodeSize / 1024;
      initMs = Math.round((95 + (steps / STEPS_PER_MS) * slow + sizeKb * 0.4 + Object.keys(files).length * 3) * 100) / 100;
      for (const l of lines(init.stdout + init.stderr)) evLogs.push(l);
      const ierr = session.I.mainGlobals!.get('__ierr__');
      w = { session, key, lastUsed: a.clock, stream };
      warm.set(key, w);
      if (typeof ierr === 'string' && ierr) {
        warm.delete(key);
        const e = JSON.parse(ierr) as {
          errorType: string;
          errorMessage: string;
        };
        const msg = `[ERROR] ${e.errorType}: ${e.errorMessage}`;
        const logs = [
          `INIT_REPORT Init Duration: ${initMs.toFixed(2)} ms\tPhase: init\tStatus: error\tError Type: ${e.errorType}`,
          msg,
          `START RequestId: ${requestId} Version: ${version}`,
          `END RequestId: ${requestId}`,
          `REPORT RequestId: ${requestId}\tDuration: 1.00 ms\tBilled Duration: 1 ms\tMemory Size: ${memMb} MB\tMax Memory Used: 31 MB`,
        ];
        writeLogs(a, region, fn, stream, logs, a.clock);
        return {
          statusCode: 200,
          functionError: 'Unhandled',
          payload: ierr.replace('"requestId": ""', `"requestId": "${requestId}"`).replace('"requestId":""', `"requestId":"${requestId}"`),
          logs,
          durationMs: 1,
          billedMs: 1,
          maxMemoryMb: 31,
          initMs,
          requestId,
          version,
        };
      }
      w = warm.get(key)!;
    }
    const session = w!.session;
    const I = session.I;
    const timeoutMs = v.Timeout * 1000;
    I.maxSteps = Math.max(2000, Math.floor((timeoutMs / slow) * STEPS_PER_MS));
    const clock0 = I.clockOffsetMs;
    I.clockBase = a.clock + (initMs ?? 0) - I.clockOffsetMs;
    const run = session.runSync(
      invokeScript(
        v,
        {
          name: fn.FunctionName,
          arn: arnQ,
          requestId,
          group,
          stream: w!.stream,
          deadline: I.readClock() + timeoutMs,
        },
        event,
      ),
    );
    const steps = I.steps;
    const slept = I.clockOffsetMs - clock0;
    const cpuMs = (steps / STEPS_PER_MS) * slow;
    let duration = Math.round((cpuMs + slept + 0.6) * 100) / 100;
    let functionError: 'Unhandled' | undefined;
    let payload = 'null';
    const out = I.mainGlobals!.get('__out__');
    const err = I.mainGlobals!.get('__err__');
    const timedOut = !!run.timedOut || duration > timeoutMs;
    const printed = lines(run.stdout + run.stderr);
    if (timedOut) {
      duration = timeoutMs;
      functionError = 'Unhandled';
      payload = JSON.stringify({
        errorMessage: `${iso(a.clock).slice(0, 19)}.000Z ${requestId} Task timed out after ${v.Timeout.toFixed(2)} seconds`,
      }).replace(/^\{"errorMessage":"[^ ]+ /, '{"errorMessage":"RequestId: ');
      payload = JSON.stringify({
        errorMessage: `RequestId: ${requestId} Error: Task timed out after ${v.Timeout.toFixed(2)} seconds`,
      });
    } else if (typeof err === 'string' && err) {
      functionError = 'Unhandled';
      payload = err;
    } else if (typeof out === 'string') payload = out;
    const billed = Math.max(1, Math.ceil(duration));
    const mem = Math.min(memMb - 2, Math.round(30 + Math.min(40, steps / 4000) + Math.min(20, v.CodeSize / 4096)));
    const logs = [...(cold ? evLogs : []), `START RequestId: ${requestId} Version: ${version}`, ...printed];
    if (functionError && !timedOut) {
      const e = JSON.parse(payload) as {
        errorType: string;
        errorMessage: string;
        stackTrace: string[];
      };
      logs.push(`[ERROR] ${e.errorType}: ${e.errorMessage}`, 'Traceback (most recent call last):', ...(e.stackTrace ?? []));
    }
    if (timedOut) logs.push(`${iso(a.clock).slice(0, 19)}.000Z ${requestId} Task timed out after ${v.Timeout.toFixed(2)} seconds`);
    logs.push(
      `END RequestId: ${requestId}`,
      `REPORT RequestId: ${requestId}\tDuration: ${duration.toFixed(2)} ms\tBilled Duration: ${billed} ms\tMemory Size: ${memMb} MB\tMax Memory Used: ${mem} MB${cold && !prov ? `\tInit Duration: ${initMs!.toFixed(2)} ms` : ''}`,
    );
    writeLogs(a, region, fn, w!.stream, logs, a.clock);
    if (timedOut) warm.delete(key);
    else w!.lastUsed = a.clock + duration;
    fn.lastInvoked = a.clock;
    return {
      statusCode: 200,
      functionError,
      payload,
      logs,
      durationMs: duration,
      billedMs: billed,
      maxMemoryMb: mem,
      initMs: cold && !prov ? initMs : undefined,
      requestId,
      version,
    };
  } finally {
    awsBridge.call = prevBridge;
  }
}

// ───────────────────────── permisos y destinos ─────────────────────────

const globToRe = (p: string) =>
  new RegExp(
    '^' +
      p
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
  );

/** ¿Permite la política de recursos de la función que `service` (apigateway, sns, s3, events…) la invoque desde `sourceArn`? */
export function lambdaAllows(fn: LambdaFn, service: string, sourceArn?: string): boolean {
  return fn.policy.some((s) => {
    if (s.Action !== 'lambda:InvokeFunction' && s.Action !== 'lambda:*') return false;
    const pr = s.Principal;
    const svc = typeof pr === 'string' ? pr : pr.Service;
    if (svc !== '*' && svc !== service) return false;
    const src = s.Condition?.ArnLike?.['AWS:SourceArn'] ?? s.Condition?.ArnEquals?.['AWS:SourceArn'];
    return !src || (!!sourceArn && globToRe(src).test(sourceArn));
  });
}

/** Servicios que reciben mensajes de las funciones (destinos): SQS y SNS. Lo rellena `sns.ts`. */
export const destinations: {
  publish?: (a: Account, topicArn: string, message: string) => void;
} = {};

function deliver(a: Account, target: string, body: string): void {
  if (target.startsWith('arn:aws:sqs:')) {
    try {
      const { q } = findQueue(a, target.split(':')[3], target);
      sqsSend(a, q, body);
    } catch {
      /* destino que no existe: se pierde */
    }
  } else if (target.startsWith('arn:aws:sns:')) destinations.publish?.(a, target, body);
}

export interface Invoker {
  /** Servicio que invoca (`apigateway`, `sns`, `events`, `s3`…) y el ARN de origen: se comprueba la política de la función. */
  service?: string;
  sourceArn?: string;
}

/** Invocación síncrona desde otro servicio. Devuelve el resultado o lanza si la función no permite al invocador. */
export function invokeSync(a: Account, region: string, ref: string, event: unknown, by: Invoker = {}): InvokeOutcome {
  const { fn, qualifier, region: r } = resolveFn(a, region, ref);
  if (by.service && !lambdaAllows(fn, by.service, by.sourceArn))
    throw new AwsError(
      'AccessDeniedException',
      `User: ${by.service} is not authorized to perform: lambda:InvokeFunction on resource: ${fnArn(a, r, fn.FunctionName)} because no resource-based policy allows the lambda:InvokeFunction action`,
      403,
    );
  if (fn.reserved === 0) throw new AwsError('TooManyRequestsException', 'Rate Exceeded.', 429);
  const out = runFunction(a, r, fn, qualifier, JSON.stringify(event));
  a.clock += Math.ceil(out.durationMs);
  return out;
}

/** Invocación asíncrona (`Event`): reintenta (2 veces por defecto) y, si sigue fallando, la envía al destino de error o a la cola de mensajes muertos. */
export function invokeAsync(a: Account, region: string, ref: string, event: unknown, by: Invoker = {}): void {
  const { fn, qualifier, region: r } = resolveFn(a, region, ref);
  if (by.service && !lambdaAllows(fn, by.service, by.sourceArn)) return;
  if (fn.reserved === 0) return;
  const text = JSON.stringify(event);
  const retries = fn.eventInvoke?.MaximumRetryAttempts ?? 2;
  let out = runFunction(a, r, fn, qualifier, text);
  let attempts = 1;
  while (out.functionError && attempts <= retries) {
    out = runFunction(a, r, fn, qualifier, text);
    attempts++;
  }
  a.clock += Math.ceil(out.durationMs);
  if (out.functionError) {
    const dest = fn.eventInvoke?.OnFailure;
    if (dest)
      deliver(
        a,
        dest,
        JSON.stringify({
          version: '1.0',
          timestamp: iso(a.clock).replace('+00:00', '.000Z'),
          requestContext: {
            requestId: out.requestId,
            functionArn: fnArn(a, r, fn.FunctionName) + ':$LATEST',
            condition: 'RetriesExhausted',
            approximateInvokeCount: attempts,
          },
          requestPayload: event,
          responseContext: {
            statusCode: 200,
            executedVersion: out.version,
            functionError: out.functionError,
          },
          responsePayload: JSON.parse(out.payload),
        }),
      );
    if (fn.deadLetter) deliver(a, fn.deadLetter, text);
  } else if (fn.eventInvoke?.OnSuccess) {
    deliver(
      a,
      fn.eventInvoke.OnSuccess,
      JSON.stringify({
        version: '1.0',
        timestamp: iso(a.clock).replace('+00:00', '.000Z'),
        requestContext: {
          requestId: out.requestId,
          functionArn: fnArn(a, r, fn.FunctionName) + ':$LATEST',
          condition: 'Success',
          approximateInvokeCount: attempts,
        },
        requestPayload: event,
        responseContext: { statusCode: 200, executedVersion: out.version },
        responsePayload: JSON.parse(out.payload),
      }),
    );
  }
}

// ───────────────────────── operaciones: funciones ─────────────────────────

const configView = (a: Account, region: string, fn: LambdaFn, v: LambdaVersion = fn) => ({
  FunctionName: fn.FunctionName,
  FunctionArn: fnArn(a, region, fn.FunctionName) + (v.Version !== '$LATEST' ? ':' + v.Version : ''),
  Runtime: v.Runtime,
  Role: v.Role,
  Handler: v.Handler,
  CodeSize: v.CodeSize,
  Description: v.Description,
  Timeout: v.Timeout,
  MemorySize: v.MemorySize,
  LastModified: rfc(v.LastModified),
  CodeSha256: v.CodeSha256,
  Version: v.Version,
  ...(Object.keys(v.Environment).length ? { Environment: { Variables: v.Environment } } : {}),
  TracingConfig: { Mode: 'PassThrough' },
  RevisionId: uuid(a, 'lrev' + fn.FunctionName + v.Version + v.CodeSha256),
  State: 'Active',
  LastUpdateStatus: 'Successful',
  PackageType: 'Zip',
  Architectures: ['x86_64'],
  EphemeralStorage: { Size: 512 },
  ...(fn.deadLetter ? { DeadLetterConfig: { TargetArn: fn.deadLetter } } : {}),
});

function codeOf(c: OpCtx): { files: Record<string, string>; size: number } {
  let text: string | undefined = c.p.ZipFile as string | undefined;
  const code = c.p.Code as { S3Bucket?: string; S3Key?: string; ZipFile?: string } | undefined;
  if (!text && code?.S3Bucket && code.S3Key) {
    const b = c.acct.s3.buckets[code.S3Bucket];
    const cur = b?.objects[code.S3Key]?.filter((x) => !x.deleteMarker).at(-1);
    if (!b) throw new AwsError('InvalidParameterValueException', `Error occurred while GetObject. S3 Error Code: NoSuchBucket. S3 Error Message: The specified bucket does not exist`, 400);
    if (!cur) throw new AwsError('InvalidParameterValueException', 'Error occurred while GetObject. S3 Error Code: NoSuchKey. S3 Error Message: The specified key does not exist.', 400);
    text = cur.body;
  }
  if (!text) throw new AwsError('InvalidParameterValueException', 'Please provide a source for function code.', 400);
  const files = zipFiles(text);
  if (!files) throw new AwsError('InvalidParameterValueException', 'Could not unzip uploaded file. Please check your file, then try to upload again.', 400);
  return {
    files,
    size: Math.max(256, Math.floor(Object.values(files).reduce((n, x) => n + x.length, 0) * 0.6) + 400 * Object.keys(files).length),
  };
}

function envOf(raw: unknown): Record<string, string> {
  const vars = (raw as { Variables?: Record<string, unknown> } | undefined)?.Variables ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!/^[a-zA-Z]([a-zA-Z0-9_])+$/.test(k))
      throw new AwsError('ValidationException', `1 validation error detected: Value '{${k}=${v}}' at 'environment.variables' failed to satisfy constraint: Map keys must satisfy constraint: [a-zA-Z]([a-zA-Z0-9_])+`, 400);
    out[k] = String(v);
  }
  if (/^AWS_/.test(Object.keys(out).find((k) => /^AWS_(REGION|DEFAULT_REGION|LAMBDA_|EXECUTION_ENV|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)/.test(k)) ?? ''))
    throw new AwsError(
      'InvalidParameterValueException',
      `Lambda was unable to configure your environment variables because the environment variables you have provided contains reserved keys that are currently not supported for modification. Reserved keys used in this request: ${Object.keys(
        out,
      )
        .filter((k) => /^AWS_/.test(k))
        .join(', ')}`,
      400,
    );
  return out;
}

function checkRole(c: OpCtx, role: string): void {
  const name = role.split('/').pop() ?? '';
  const r = c.acct.iam.roles[name];
  const trusted =
    r &&
    toArr(r.AssumeRolePolicyDocument.Statement as never).some(
      (s: { Effect?: string; Principal?: { Service?: string | string[] } }) => s.Effect === 'Allow' && toArr(s.Principal?.Service).includes('lambda.amazonaws.com'),
    );
  if (!trusted) throw new AwsError('InvalidParameterValueException', 'The role defined for the function cannot be assumed by Lambda.', 400);
}

function checkConfig(c: OpCtx): void {
  const rt = c.p.Runtime as string | undefined;
  if (rt !== undefined && !RUNTIMES.includes(rt)) {
    if (DEPRECATED.includes(rt))
      throw new AwsError(
        'InvalidParameterValueException',
        `The runtime parameter of ${rt} is no longer supported for creating or updating AWS Lambda functions. We recommend you use the new runtime (python3.12) while creating or updating functions.`,
        400,
      );
    throw new AwsError('InvalidParameterValueException', `Value ${rt} at 'runtime' failed to satisfy constraint: Member must satisfy enum value set: [${RUNTIMES.join(', ')}]`, 400);
  }
  if (c.p.Timeout !== undefined && (c.p.Timeout < 1 || c.p.Timeout > 900))
    throw new AwsError('InvalidParameterValueException', `1 validation error detected: Value '${c.p.Timeout}' at 'timeout' failed to satisfy constraint: Member must have value less than or equal to 900`, 400);
  if (c.p.MemorySize !== undefined && (c.p.MemorySize < 128 || c.p.MemorySize > 10240))
    throw new AwsError(
      'InvalidParameterValueException',
      `1 validation error detected: Value '${c.p.MemorySize}' at 'memorySize' failed to satisfy constraint: Member must have value ${c.p.MemorySize < 128 ? 'greater than or equal to 128' : 'less than or equal to 10240'}`,
      400,
    );
}

op(
  'lambda',
  'create-function',
  'function-name:s! runtime:s role:s! handler:s code:j zip-file:s description:s timeout:i memory-size:i environment:j publish:b package-type:s architectures:l tags:j dead-letter-config:j tracing-config:j layers:l',
  'Crea una función a partir de un .zip (`--zip-file fileb://function.zip`) o de un objeto de S3.',
  {
    authz: (c) => [
      {
        action: 'lambda:CreateFunction',
        resource: fnArn(c.acct, c.region, String(c.p.FunctionName)),
      },
      {
        action: 'iam:PassRole',
        resource: String(c.p.Role),
        context: { 'iam:PassedToService': 'lambda.amazonaws.com' },
      },
    ],
  },
  (c) => {
    const name = String(c.p.FunctionName);
    if (!NAME_RE.test(name))
      throw new AwsError(
        'InvalidParameterValueException',
        `1 validation error detected: Value '${name}' at 'functionName' failed to satisfy constraint: Member must satisfy regular expression pattern: (arn:(aws[a-zA-Z-]*)?:lambda:)?([a-z]{2}(-gov)?-[a-z]+-\\d{1}:)?(\\d{12}:)?(function:)?([a-zA-Z0-9-_]+)(:(\\$LATEST|[a-zA-Z0-9-_]+))?`,
        400,
      );
    if (!c.p.Runtime) throw new AwsError('InvalidParameterValueException', 'Runtime and Handler are required for Zip package types.', 400);
    if (!c.p.Handler) throw new AwsError('InvalidParameterValueException', 'Runtime and Handler are required for Zip package types.', 400);
    checkConfig(c);
    const s = lambdaOf(c.acct, c.region);
    if (s.functions[name]) throw new AwsError('ResourceConflictException', `Function already exist: ${fnArn(c.acct, c.region, name)}`, 409);
    checkRole(c, String(c.p.Role));
    const { files, size } = codeOf(c);
    const env = envOf(c.p.Environment);
    const fn: LambdaFn = {
      FunctionName: name,
      FunctionArn: fnArn(c.acct, c.region, name),
      Version: '$LATEST',
      CodeSha256: shaOf(files),
      CodeSize: size,
      files,
      Description: c.p.Description ?? '',
      Runtime: c.p.Runtime,
      Handler: c.p.Handler,
      MemorySize: c.p.MemorySize ?? 128,
      Timeout: c.p.Timeout ?? 3,
      Environment: env,
      Role: String(c.p.Role),
      LastModified: c.acct.clock,
      versions: [],
      aliases: {},
      policy: [],
      provisioned: {},
      lastInvoked: 0,
      changedAt: c.acct.clock,
      tags: (c.p.Tags ?? {}) as Record<string, string>,
      deadLetter: (c.p.DeadLetterConfig as { TargetArn?: string } | undefined)?.TargetArn,
    };
    s.functions[name] = fn;
    if (c.p.Publish) {
      fn.versions.push(snapshot(fn, '1'));
    }
    return {
      ...configView(c.acct, c.region, fn),
      State: 'Pending',
      StateReason: 'The function is being created.',
      StateReasonCode: 'Creating',
      LastUpdateStatus: 'Successful',
    };
  },
);

const findFn = (c: OpCtx, ref: string) => resolveFn(c.acct, c.region, ref);

op(
  'lambda',
  'update-function-code',
  'function-name:s! zip-file:s s3-bucket:s s3-key:s publish:b',
  'Sube un código nuevo para la función (la versión `$LATEST`).',
  {
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
  },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    const { files, size } = codeOf({
      ...c,
      p: {
        ZipFile: c.p.ZipFile,
        Code: { S3Bucket: c.p.S3Bucket, S3Key: c.p.S3Key },
      },
    } as OpCtx);
    fn.files = files;
    fn.CodeSize = size;
    fn.CodeSha256 = shaOf(files);
    fn.LastModified = c.acct.clock;
    fn.changedAt = c.acct.clock;
    if (c.p.Publish) fn.versions.push(snapshot(fn, String(fn.versions.length + 1)));
    return configView(c.acct, region, fn);
  },
);

op(
  'lambda',
  'update-function-configuration',
  'function-name:s! role:s handler:s description:s timeout:i memory-size:i environment:j runtime:s dead-letter-config:j',
  'Cambia la configuración: memoria, timeout, variables de entorno, rol, handler…',
  {
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
  },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    checkConfig(c);
    if (c.p.Role) {
      checkRole(c, c.p.Role);
      fn.Role = c.p.Role;
    }
    if (c.p.Handler) fn.Handler = c.p.Handler;
    if (c.p.Runtime) fn.Runtime = c.p.Runtime;
    if (c.p.Description !== undefined) fn.Description = c.p.Description;
    if (c.p.Timeout !== undefined) fn.Timeout = c.p.Timeout;
    if (c.p.MemorySize !== undefined) fn.MemorySize = c.p.MemorySize;
    if (c.p.Environment !== undefined) fn.Environment = envOf(c.p.Environment);
    if (c.p.DeadLetterConfig !== undefined) fn.deadLetter = (c.p.DeadLetterConfig as { TargetArn?: string }).TargetArn || undefined;
    fn.LastModified = c.acct.clock;
    fn.changedAt = c.acct.clock;
    return configView(c.acct, region, fn);
  },
);

op(
  'lambda',
  'get-function',
  'function-name:s! qualifier:s',
  'Datos de la función: configuración, ubicación del código y etiquetas.',
  {
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
  },
  (c) => {
    const { fn, region, qualifier } = findFn(c, c.p.FunctionName + (c.p.Qualifier ? ':' + c.p.Qualifier : ''));
    const v = versionFor(fn, qualifier);
    return {
      Configuration: configView(c.acct, region, fn, v),
      Code: {
        RepositoryType: 'S3',
        Location: `https://awslambda-${region}-tasks.s3.${region}.amazonaws.com/snapshots/${c.acct.id}/${fn.FunctionName}-${md5(v.CodeSha256).slice(0, 8)}`,
      },
      ...(Object.keys(fn.tags).length ? { Tags: fn.tags } : {}),
    };
  },
);

op(
  'lambda',
  'get-function-configuration',
  'function-name:s! qualifier:s',
  'Solo la configuración de la función.',
  {
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
  },
  (c) => {
    const { fn, region, qualifier } = findFn(c, c.p.FunctionName + (c.p.Qualifier ? ':' + c.p.Qualifier : ''));
    return configView(c.acct, region, fn, versionFor(fn, qualifier));
  },
);

op('lambda', 'list-functions', 'function-version:s max-items:i', 'Lista las funciones de la región.', { paginate: 'Functions', res: () => '*' }, (c) => ({
  Functions: Object.values(lambdaOf(c.acct, c.region).functions)
    .sort((x, y) => (x.FunctionName < y.FunctionName ? -1 : 1))
    .map((f) => configView(c.acct, c.region, f)),
}));

op(
  'lambda',
  'delete-function',
  'function-name:s! qualifier:s',
  'Borra la función (con todas sus versiones y alias).',
  {
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
  },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    const s = lambdaOf(c.acct, region);
    delete s.functions[fn.FunctionName];
    for (const [k, m] of Object.entries(s.esms)) if (m.FunctionArn.endsWith(':function:' + fn.FunctionName)) delete s.esms[k];
    return undefined;
  },
);

op(
  'lambda',
  'publish-version',
  'function-name:s! description:s',
  'Congela el código y la configuración actuales en una versión numerada inmutable.',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    const last = fn.versions.at(-1);
    if (last && last.CodeSha256 === fn.CodeSha256 && last.MemorySize === fn.MemorySize && last.Timeout === fn.Timeout && JSON.stringify(last.Environment) === JSON.stringify(fn.Environment) && last.Handler === fn.Handler)
      return configView(c.acct, region, fn, last);
    const v = snapshot(fn, String(Number(last?.Version ?? 0) + 1));
    if (c.p.Description) v.Description = c.p.Description;
    v.LastModified = c.acct.clock;
    fn.versions.push(v);
    return configView(c.acct, region, fn, v);
  },
);

op(
  'lambda',
  'list-versions-by-function',
  'function-name:s!',
  'Lista las versiones de la función (`$LATEST` y las publicadas).',
  {
    paginate: 'Versions',
    res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)),
  },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    return {
      Versions: [configView(c.acct, region, fn), ...fn.versions.map((v) => configView(c.acct, region, fn, v))],
    };
  },
);

const aliasView = (a: Account, region: string, fn: LambdaFn, al: LambdaFn['aliases'][string]) => ({
  AliasArn: fnArn(a, region, fn.FunctionName) + ':' + al.Name,
  Name: al.Name,
  FunctionVersion: al.FunctionVersion,
  Description: al.Description,
  RevisionId: uuid(a, 'lal' + al.Name + al.FunctionVersion),
});

op(
  'lambda',
  'create-alias',
  'function-name:s! name:s! function-version:s! description:s',
  'Crea un alias: un nombre estable (`prod`) que apunta a una versión.',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    if (fn.aliases[c.p.Name]) throw new AwsError('ResourceConflictException', `Alias already exists: ${fnArn(c.acct, region, fn.FunctionName)}:${c.p.Name}`, 409);
    if (c.p.FunctionVersion !== '$LATEST' && !fn.versions.some((v) => v.Version === c.p.FunctionVersion))
      throw new AwsError('ResourceNotFoundException', `Function not found: ${fnArn(c.acct, region, fn.FunctionName)}:${c.p.FunctionVersion}`, 404);
    fn.aliases[c.p.Name] = {
      Name: c.p.Name,
      FunctionVersion: c.p.FunctionVersion,
      Description: c.p.Description ?? '',
    };
    return aliasView(c.acct, region, fn, fn.aliases[c.p.Name]);
  },
);

op(
  'lambda',
  'update-alias',
  'function-name:s! name:s! function-version:s description:s',
  'Apunta un alias a otra versión (así se «despliega» sin cambiar el nombre que usan los demás).',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    const al = fn.aliases[c.p.Name];
    if (!al) throw new AwsError('ResourceNotFoundException', `Alias not found: ${fnArn(c.acct, region, fn.FunctionName)}:${c.p.Name}`, 404);
    if (c.p.FunctionVersion) {
      if (c.p.FunctionVersion !== '$LATEST' && !fn.versions.some((v) => v.Version === c.p.FunctionVersion))
        throw new AwsError('ResourceNotFoundException', `Function not found: ${fnArn(c.acct, region, fn.FunctionName)}:${c.p.FunctionVersion}`, 404);
      al.FunctionVersion = c.p.FunctionVersion;
    }
    if (c.p.Description !== undefined) al.Description = c.p.Description;
    return aliasView(c.acct, region, fn, al);
  },
);

op('lambda', 'get-alias', 'function-name:s! name:s!', 'Datos de un alias.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn, region } = findFn(c, c.p.FunctionName);
  const al = fn.aliases[c.p.Name];
  if (!al) throw new AwsError('ResourceNotFoundException', `Cannot find alias arn: ${fnArn(c.acct, region, fn.FunctionName)}:${c.p.Name}`, 404);
  return aliasView(c.acct, region, fn, al);
});

op('lambda', 'list-aliases', 'function-name:s!', 'Lista los alias de una función.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn, region } = findFn(c, c.p.FunctionName);
  return {
    Aliases: Object.values(fn.aliases).map((al) => aliasView(c.acct, region, fn, al)),
  };
});

op('lambda', 'delete-alias', 'function-name:s! name:s!', 'Borra un alias.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn } = findFn(c, c.p.FunctionName);
  if (!fn.aliases[c.p.Name]) throw new AwsError('ResourceNotFoundException', `Cannot find alias arn: ${fnArn(c.acct, c.region, fn.FunctionName)}:${c.p.Name}`, 404);
  delete fn.aliases[c.p.Name];
  return undefined;
});

// ───────────────────────── invocar ─────────────────────────

const isB64 = (s: string) => s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);

op(
  'lambda',
  'invoke',
  'function-name:s! invocation-type:s log-type:s client-context:s payload:s qualifier:s outfile:s!',
  'Ejecuta la función. `--payload` es el evento; la respuesta se guarda en el archivo final (`/dev/stdout` la muestra). Con `--log-type Tail` devuelve los últimos registros en base64.',
  {
    positional: ['outfile'],
    authz: (c) => [
      {
        action: 'lambda:InvokeFunction',
        resource: fnArn(c.acct, c.region, String(c.p.FunctionName).split(':').pop() ?? ''),
      },
    ],
  },
  (c) => {
    const { fn, region, qualifier } = findFn(c, c.p.FunctionName + (c.p.Qualifier ? ':' + c.p.Qualifier : ''));
    const type = (c.p.InvocationType ?? 'RequestResponse') as string;
    if (!['RequestResponse', 'Event', 'DryRun'].includes(type))
      throw new AwsError(
        'InvalidParameterValueException',
        `1 validation error detected: Value '${type}' at 'invocationType' failed to satisfy constraint: Member must satisfy enum value set: [Event, RequestResponse, DryRun]`,
        400,
      );
    let text = c.p.Payload === undefined ? '{}' : String(c.p.Payload);
    if (c.p.Payload !== undefined && c.opts.binaryFormat !== 'raw-in-base64-out') {
      // la CLI v2 espera el evento en base64 salvo que se pida `--cli-binary-format raw-in-base64-out`
      if (!isB64(text) || !(b64decode(text) ?? '').trim()) throw new UsageErr(`Invalid base64: "${text}"`, 252, false);
      text = b64decode(text) ?? '{}';
    }
    if (text.trim()) {
      try {
        JSON.parse(text);
      } catch {
        throw new AwsError('InvalidRequestContentException', 'Could not parse request body into json: Could not parse payload into json: Unrecognized token', 400);
      }
    }
    const out = c.p.Outfile as string;
    const write = (body: string) => {
      if (out === '/dev/stdout' || out === '-') return body;
      c.io.writeFile(c.io.abs(out), body);
      return undefined;
    };
    if (type === 'DryRun') return { StatusCode: 204 };
    if (fn.reserved === 0) throw new AwsError('TooManyRequestsException', 'Rate Exceeded.', 429);
    if (type === 'Event') {
      invokeAsync(c.acct, region, fn.FunctionName + (qualifier ? ':' + qualifier : ''), text.trim() ? JSON.parse(text) : {});
      const so = write('');
      return { ...(so !== undefined ? { __stdout: so } : {}), StatusCode: 202 };
    }
    const res = runFunction(c.acct, region, fn, qualifier, text.trim() || '{}');
    c.acct.clock += Math.ceil(res.durationMs);
    const so = write(res.payload);
    const tail = res.logs.join('\n') + '\n';
    return {
      ...(so !== undefined ? { __stdout: so } : {}),
      StatusCode: res.statusCode,
      ...(res.functionError ? { FunctionError: res.functionError } : {}),
      ...(c.p.LogType === 'Tail' ? { LogResult: b64encode(tail.slice(-4096)) } : {}),
      ExecutedVersion: res.version,
    };
  },
);

// ───────────────────────── permisos ─────────────────────────

op(
  'lambda',
  'add-permission',
  'function-name:s! statement-id:s! action:s! principal:s! source-arn:s source-account:s qualifier:s',
  'Da permiso a otro servicio o cuenta (API Gateway, SNS, S3, EventBridge…) para invocar la función (política de recursos).',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    if (fn.policy.some((s) => s.Sid === c.p.StatementId))
      throw new AwsError('ResourceConflictException', `The statement id (${c.p.StatementId}) provided already exists. Please provide a new statement id, or remove the existing statement.`, 409);
    if (!/^lambda:/.test(c.p.Action))
      throw new AwsError(
        'ValidationException',
        `1 validation error detected: Value '${c.p.Action}' at 'action' failed to satisfy constraint: Member must satisfy regular expression pattern: (lambda:[*]|lambda:[a-zA-Z]+|[*])`,
        400,
      );
    const principal = /\.amazonaws\.com$/.test(c.p.Principal)
      ? { Service: c.p.Principal }
      : /^\d{12}$/.test(c.p.Principal)
        ? { AWS: `arn:aws:iam::${c.p.Principal}:root` }
        : c.p.Principal === '*'
          ? '*'
          : { AWS: c.p.Principal };
    const st: LambdaPolicyStatement = {
      Sid: c.p.StatementId,
      Effect: 'Allow',
      Principal: principal,
      Action: c.p.Action,
      Resource: fnArn(c.acct, region, fn.FunctionName),
      ...(c.p.SourceArn
        ? { Condition: { ArnLike: { 'AWS:SourceArn': c.p.SourceArn } } }
        : c.p.SourceAccount
          ? {
              Condition: {
                StringEquals: { 'AWS:SourceAccount': c.p.SourceAccount },
              },
            }
          : {}),
    };
    fn.policy.push(st);
    return { Statement: JSON.stringify(st) };
  },
);

op('lambda', 'remove-permission', 'function-name:s! statement-id:s!', 'Quita un permiso de la política de recursos.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn } = findFn(c, c.p.FunctionName);
  if (!fn.policy.some((s) => s.Sid === c.p.StatementId)) throw new AwsError('ResourceNotFoundException', `No policy is associated with the given resource.`, 404);
  fn.policy = fn.policy.filter((s) => s.Sid !== c.p.StatementId);
  return undefined;
});

op('lambda', 'get-policy', 'function-name:s! qualifier:s', 'Política de recursos de la función (quién puede invocarla).', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn } = findFn(c, c.p.FunctionName);
  if (!fn.policy.length) throw new AwsError('ResourceNotFoundException', 'The resource you requested does not exist.', 404);
  return {
    Policy: JSON.stringify({
      Version: '2012-10-17',
      Id: 'default',
      Statement: fn.policy,
    }),
    RevisionId: uuid(c.acct, 'lpol' + fn.policy.length),
  };
});

// ───────────────────────── concurrencia ─────────────────────────

op(
  'lambda',
  'put-function-concurrency',
  'function-name:s! reserved-concurrent-executions:i!',
  'Reserva concurrencia para la función: es su tope y a la vez lo que garantiza que otras no se la quiten. Con 0 la función queda desactivada.',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn } = findFn(c, c.p.FunctionName);
    const n = c.p.ReservedConcurrentExecutions as number;
    if (n < 0)
      throw new AwsError(
        'InvalidParameterValueException',
        `1 validation error detected: Value '${n}' at 'reservedConcurrentExecutions' failed to satisfy constraint: Member must have value greater than or equal to 0`,
        400,
      );
    const others = Object.values(lambdaOf(c.acct, c.region).functions)
      .filter((f) => f !== fn)
      .reduce((s, f) => s + (f.reserved ?? 0), 0);
    if (others + n > 900)
      throw new AwsError('InvalidParameterValueException', "Specified ReservedConcurrentExecutions for function decreases account's UnreservedConcurrentExecution below its minimum value of [100].", 400);
    fn.reserved = n;
    return { ReservedConcurrentExecutions: n };
  },
);

op('lambda', 'get-function-concurrency', 'function-name:s!', 'Concurrencia reservada de la función.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn } = findFn(c, c.p.FunctionName);
  return fn.reserved === undefined ? {} : { ReservedConcurrentExecutions: fn.reserved };
});

op('lambda', 'delete-function-concurrency', 'function-name:s!', 'Quita la reserva de concurrencia.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  findFn(c, c.p.FunctionName).fn.reserved = undefined;
  return undefined;
});

op(
  'lambda',
  'put-provisioned-concurrency-config',
  'function-name:s! qualifier:s! provisioned-concurrent-executions:i!',
  'Mantiene N entornos de ejecución calientes en una versión o alias: sin arranques en frío (se paga por tenerlos).',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn } = findFn(c, c.p.FunctionName);
    if (c.p.Qualifier === '$LATEST') throw new AwsError('InvalidParameterValueException', 'Provisioned Concurrency Configs cannot be applied to unpublished function versions.', 400);
    const target = fn.aliases[c.p.Qualifier]?.FunctionVersion ?? c.p.Qualifier;
    if (!fn.versions.some((v) => v.Version === target)) throw new AwsError('ResourceNotFoundException', `Cannot find version ${c.p.Qualifier} for ${fn.FunctionName}`, 404);
    fn.provisioned[c.p.Qualifier] = c.p.ProvisionedConcurrentExecutions;
    return {
      RequestedProvisionedConcurrentExecutions: c.p.ProvisionedConcurrentExecutions,
      AvailableProvisionedConcurrentExecutions: 0,
      AllocatedProvisionedConcurrentExecutions: 0,
      Status: 'IN_PROGRESS',
      LastModified: rfc(c.acct.clock),
    };
  },
);

op('lambda', 'get-provisioned-concurrency-config', 'function-name:s! qualifier:s!', 'Estado de la concurrencia aprovisionada.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn } = findFn(c, c.p.FunctionName);
  const n = fn.provisioned[c.p.Qualifier];
  if (n === undefined) throw new AwsError('ProvisionedConcurrencyConfigNotFoundException', `No Provisioned Concurrency Config found for this function`, 404);
  return {
    RequestedProvisionedConcurrentExecutions: n,
    AvailableProvisionedConcurrentExecutions: n,
    AllocatedProvisionedConcurrentExecutions: n,
    Status: 'READY',
    LastModified: rfc(fn.changedAt),
  };
});

op('lambda', 'get-account-settings', '', 'Límites y uso de Lambda en la cuenta (concurrencia, tamaño de código…).', { res: () => '*' }, (c) => {
  const fns = Object.values(lambdaOf(c.acct, c.region).functions);
  return {
    AccountLimit: {
      TotalCodeSize: 80530636800,
      CodeSizeUnzipped: 262144000,
      CodeSizeZipped: 52428800,
      ConcurrentExecutions: 1000,
      UnreservedConcurrentExecutions: 1000 - fns.reduce((s, f) => s + (f.reserved ?? 0), 0),
    },
    AccountUsage: {
      TotalCodeSize: fns.reduce((s, f) => s + f.CodeSize, 0),
      FunctionCount: fns.length,
    },
  };
});

// ───────────────────────── invocación asíncrona ─────────────────────────

op(
  'lambda',
  'put-function-event-invoke-config',
  'function-name:s! maximum-retry-attempts:i maximum-event-age-in-seconds:i destination-config:j',
  'Configura las invocaciones asíncronas: reintentos (0–2) y destinos de éxito y de error (SQS o SNS).',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    if (c.p.MaximumRetryAttempts !== undefined && (c.p.MaximumRetryAttempts < 0 || c.p.MaximumRetryAttempts > 2))
      throw new AwsError(
        'InvalidParameterValueException',
        `1 validation error detected: Value '${c.p.MaximumRetryAttempts}' at 'maximumRetryAttempts' failed to satisfy constraint: Member must have value less than or equal to 2`,
        400,
      );
    const d = (c.p.DestinationConfig ?? {}) as {
      OnFailure?: { Destination?: string };
      OnSuccess?: { Destination?: string };
    };
    fn.eventInvoke = {
      MaximumRetryAttempts: c.p.MaximumRetryAttempts ?? 2,
      OnFailure: d.OnFailure?.Destination,
      OnSuccess: d.OnSuccess?.Destination,
    };
    return {
      LastModified: c.acct.clock / 1000,
      FunctionArn: fnArn(c.acct, region, fn.FunctionName) + ':$LATEST',
      MaximumRetryAttempts: fn.eventInvoke.MaximumRetryAttempts,
      DestinationConfig: {
        ...(d.OnSuccess ? { OnSuccess: d.OnSuccess } : {}),
        ...(d.OnFailure ? { OnFailure: d.OnFailure } : {}),
      },
    };
  },
);

op('lambda', 'get-function-event-invoke-config', 'function-name:s!', 'Configuración de invocaciones asíncronas.', { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) }, (c) => {
  const { fn, region } = findFn(c, c.p.FunctionName);
  if (!fn.eventInvoke) throw new AwsError('ResourceNotFoundException', `The function ${fnArn(c.acct, region, fn.FunctionName)} doesn't have an EventInvokeConfig`, 404);
  const e = fn.eventInvoke;
  return {
    LastModified: c.acct.clock / 1000,
    FunctionArn: fnArn(c.acct, region, fn.FunctionName) + ':$LATEST',
    MaximumRetryAttempts: e.MaximumRetryAttempts,
    DestinationConfig: {
      ...(e.OnSuccess ? { OnSuccess: { Destination: e.OnSuccess } } : {}),
      ...(e.OnFailure ? { OnFailure: { Destination: e.OnFailure } } : {}),
    },
  };
});

// ───────────────────────── mapeos de origen de eventos ─────────────────────────

const esmView = (a: Account, region: string, m: LambdaEsm) => ({
  UUID: m.UUID,
  BatchSize: m.BatchSize,
  MaximumBatchingWindowInSeconds: m.MaximumBatchingWindowInSeconds,
  EventSourceArn: m.EventSourceArn,
  FunctionArn: m.FunctionArn,
  LastModified: a.clock / 1000,
  State: m.State,
  StateTransitionReason: 'USER_INITIATED',
  ...(m.FunctionResponseTypes.length ? { FunctionResponseTypes: m.FunctionResponseTypes } : {}),
  ...(m.MaximumConcurrency ? { ScalingConfig: { MaximumConcurrency: m.MaximumConcurrency } } : {}),
  ...(region ? {} : {}),
});

op(
  'lambda',
  'create-event-source-mapping',
  'function-name:s! event-source-arn:s batch-size:i maximum-batching-window-in-seconds:i enabled:b function-response-types:l scaling-config:j',
  'Conecta una cola SQS con la función: Lambda lee la cola, invoca la función con lotes y borra lo que sale bien.',
  { res: (c) => fnArn(c.acct, c.region, String(c.p.FunctionName)) },
  (c) => {
    const { fn, region } = findFn(c, c.p.FunctionName);
    const src = String(c.p.EventSourceArn ?? '');
    if (!src.startsWith('arn:aws:sqs:')) throw new AwsError('InvalidParameterValueException', 'Unrecognized event source. This simulator supports Amazon SQS queues.', 400);
    let q;
    try {
      q = findQueue(c.acct, region, src).q;
    } catch {
      throw new AwsError('InvalidParameterValueException', `Error occurred while ReceiveMessage. SQS Error Code: AWS.SimpleQueueService.NonExistentQueue. SQS Error Message: The specified queue does not exist.`, 400);
    }
    if (!roleCan(c.acct, fn.Role, ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes']))
      throw new AwsError('InvalidParameterValueException', 'The provided execution role does not have permissions to call ReceiveMessage on SQS', 400);
    if (Number(q.attrs.VisibilityTimeout) < fn.Timeout)
      throw new AwsError('InvalidParameterValueException', `Queue visibility timeout: ${q.attrs.VisibilityTimeout} seconds is less than Function timeout: ${fn.Timeout} seconds`, 400);
    const s = lambdaOf(c.acct, region);
    if (Object.values(s.esms).some((m) => m.EventSourceArn === src && m.FunctionArn === fn.FunctionArn))
      throw new AwsError(
        'ResourceConflictException',
        `An event source mapping with SQS arn (" ${src} ") and function (" ${fn.FunctionName} ") already exists. Please update or delete the existing mapping with UUID ${Object.values(s.esms).find((m) => m.EventSourceArn === src)?.UUID}`,
        409,
      );
    const bs = c.p.BatchSize ?? 10;
    if (bs < 1 || bs > 10000)
      throw new AwsError('InvalidParameterValueException', `1 validation error detected: Value '${bs}' at 'batchSize' failed to satisfy constraint: Member must have value less than or equal to 10000`, 400);
    const id = uuid(c.acct, 'lesm');
    const m: LambdaEsm = {
      UUID: id,
      FunctionArn: fn.FunctionArn,
      EventSourceArn: src,
      BatchSize: bs,
      State: c.p.Enabled === false ? 'Disabled' : 'Enabled',
      FunctionResponseTypes: toArr<string>(c.p.FunctionResponseTypes),
      MaximumBatchingWindowInSeconds: c.p.MaximumBatchingWindowInSeconds ?? 0,
      LastModified: c.acct.clock,
      MaximumConcurrency: (c.p.ScalingConfig as { MaximumConcurrency?: number } | undefined)?.MaximumConcurrency,
    };
    s.esms[id] = m;
    return { ...esmView(c.acct, region, m), State: 'Creating' };
  },
);

op('lambda', 'list-event-source-mappings', 'function-name:s event-source-arn:s', 'Lista los mapeos de origen de eventos.', { paginate: 'EventSourceMappings', res: () => '*' }, (c) => ({
  EventSourceMappings: Object.values(lambdaOf(c.acct, c.region).esms)
    .filter((m) => (!c.p.FunctionName || m.FunctionArn.endsWith(':function:' + String(c.p.FunctionName).split(':').pop())) && (!c.p.EventSourceArn || m.EventSourceArn === c.p.EventSourceArn))
    .map((m) => esmView(c.acct, c.region, m)),
}));

const findEsm = (c: OpCtx, id: string): LambdaEsm => {
  const m = lambdaOf(c.acct, c.region).esms[id];
  if (!m) throw new AwsError('ResourceNotFoundException', 'The resource you requested does not exist.', 404);
  return m;
};

op('lambda', 'get-event-source-mapping', 'uuid:s!', 'Datos de un mapeo.', { res: () => '*' }, (c) => esmView(c.acct, c.region, findEsm(c, c.p.Uuid)));

op(
  'lambda',
  'update-event-source-mapping',
  'uuid:s! function-name:s batch-size:i enabled:b function-response-types:l maximum-batching-window-in-seconds:i',
  'Cambia el tamaño de lote, activa o desactiva el mapeo o activa la respuesta con fallos parciales.',
  { res: () => '*' },
  (c) => {
    const m = findEsm(c, c.p.Uuid);
    if (c.p.BatchSize !== undefined) m.BatchSize = c.p.BatchSize;
    if (c.p.Enabled !== undefined) m.State = c.p.Enabled ? 'Enabled' : 'Disabled';
    if (c.p.FunctionResponseTypes !== undefined) m.FunctionResponseTypes = toArr<string>(c.p.FunctionResponseTypes);
    if (c.p.MaximumBatchingWindowInSeconds !== undefined) m.MaximumBatchingWindowInSeconds = c.p.MaximumBatchingWindowInSeconds;
    return esmView(c.acct, c.region, m);
  },
);

op('lambda', 'delete-event-source-mapping', 'uuid:s!', 'Borra un mapeo.', { res: () => '*' }, (c) => {
  const m = findEsm(c, c.p.Uuid);
  delete lambdaOf(c.acct, c.region).esms[m.UUID];
  return { ...esmView(c.acct, c.region, m), State: 'Deleting' };
});

/** Lambda lee las colas y reparte los mensajes en lotes. */
export function pollQueues(a: Account): void {
  for (const region of Object.keys(a.regions)) {
    const s = a.regions[region].lambda;
    if (!s) continue;
    for (const m of Object.values(s.esms)) {
      if (m.State !== 'Enabled') continue;
      let found;
      try {
        found = findQueue(a, region, m.EventSourceArn);
      } catch {
        continue;
      }
      const fn = s.functions[m.FunctionArn.split(':function:')[1]];
      if (!fn) continue;
      // el sondeo es continuo: entre dos comprobaciones de la CLI Lambda ha podido leer muchos lotes
      for (let round = 0; round < 100; round++) {
        sqsSweep(a, found.q);
        const batch = sqsReceive(a, found.q, Math.min(m.BatchSize, 10));
        if (!batch.length) break;
        const event = {
          Records: batch.map((x) => ({
            messageId: x.MessageId,
            receiptHandle: x.receiptHandle,
            body: x.Body,
            attributes: {
              ApproximateReceiveCount: String(x.receiveCount),
              SentTimestamp: String(x.sentAt),
              SenderId: 'AIDAEXAMPLE0000000000',
              ApproximateFirstReceiveTimestamp: String(x.firstReceivedAt ?? a.clock),
            },
            messageAttributes: x.attrs,
            md5OfBody: md5(x.Body),
            eventSource: 'aws:sqs',
            eventSourceARN: m.EventSourceArn,
            awsRegion: region,
          })),
        };
        if (fn.reserved === 0) break;
        const out = runFunction(a, region, fn, undefined, JSON.stringify(event));
        a.clock += Math.ceil(out.durationMs);
        let failedIds: string[] | 'all' = out.functionError ? 'all' : [];
        if (!out.functionError && m.FunctionResponseTypes.includes('ReportBatchItemFailures')) {
          try {
            const r = JSON.parse(out.payload) as {
              batchItemFailures?: { itemIdentifier: string }[];
            } | null;
            failedIds = (r?.batchItemFailures ?? []).map((f) => f.itemIdentifier);
          } catch {
            failedIds = 'all';
          }
        }
        for (const x of batch) {
          if (failedIds === 'all' || failedIds.includes(x.MessageId)) continue;
          found.q.messages = found.q.messages.filter((y) => y !== x);
        }
      }
    }
  }
}

tickers.push(pollQueues);

// ───────────────────────── etiquetas y espera ─────────────────────────

op('lambda', 'tag-resource', 'resource:s! tags:j!', 'Pone etiquetas a una función.', { res: (c) => c.p.Resource }, (c) => {
  Object.assign(resolveFn(c.acct, c.region, c.p.Resource).fn.tags, c.p.Tags);
  return undefined;
});

op('lambda', 'list-tags', 'resource:s!', 'Etiquetas de una función.', { res: (c) => c.p.Resource }, (c) => ({ Tags: resolveFn(c.acct, c.region, c.p.Resource).fn.tags }));

op(
  'lambda',
  'wait',
  'waiter:s! function-name:s!',
  'Espera a que la función esté lista (`function-active`, `function-updated`, `function-exists`; en el simulador lo está siempre).',
  { positional: ['waiter'], res: () => '*', authz: false },
  (c) => {
    if (!['function-active', 'function-updated', 'function-exists', 'function-active-v2', 'function-updated-v2'].includes(c.p.Waiter))
      throw new UsageErr(`argument waiter_name: Invalid choice, valid choices are:\n\nfunction-active | function-active-v2 | function-exists | function-updated | function-updated-v2`);
    findFn(c, c.p.FunctionName);
    return undefined;
  },
);

export { queueArn };
