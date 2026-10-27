/**
 * Llamadas «de SDK» al motor: lo que hace `boto3` dentro de una función Lambda (o cualquier servicio que actúe con un rol).
 * Pasa por la misma autorización que la CLI, con la identidad del rol, y no avanza el reloj (la CLI sí avanza 1,5 s por orden).
 */
import { authorize } from './authz';
import { AwsError, OPS, defaultTargets, type AwsIO, type Caller, type GlobalOpts, type OpCtx } from './registry';
import type { Account } from './types';

/** Nombre de servicio de `boto3` → servicio de la CLI. */
const SERVICE: Record<string, string> = { s3: 's3api', states: 'stepfunctions', 'execute-api': 'apigatewayv2' };

/** Identidad de un rol asumido por un servicio (la sesión lleva el nombre de la función, como en Lambda). */
export function roleCaller(a: Account, roleArn: string, session: string): Caller {
  const name = roleArn.split('/').pop() ?? '';
  const role = a.iam.roles[name];
  return { arn: `arn:aws:sts::${a.id}:assumed-role/${name}/${session}`, account: a.id, type: 'AssumedRole', userId: `${role?.RoleId ?? 'AROAXXXXXXXXXXXXXXXXX'}:${session}`, root: false, mfa: false, accessKeyId: 'ASIAROLESESSION000000', roleName: name, sessionName: session };
}

export interface SdkResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { Code: string; Message: string; Status: number };
}

const memIo = (files: Map<string, string>): AwsIO =>
  ({
    acct: undefined as unknown as Account,
    env: {},
    home: '/tmp',
    cwd: '/tmp',
    readFile: (p: string) => files.get(p) ?? null,
    writeFile: (p: string, c: string) => (files.set(p, c), true),
    removeFile: (p: string) => void files.delete(p),
    listFiles: () => null,
    isDir: () => false,
    size: (p: string) => files.get(p)?.length ?? null,
    abs: (p: string) => p,
    stdin: null,
    cols: 100,
  }) as AwsIO;

/** Ejecuta una operación como `caller`. `caller === null` = sin comprobar permisos (acciones internas del servicio). */
export function sdkCall(a: Account, region: string, caller: Caller | null, service: string, opName: string, params: Record<string, unknown>): SdkResult {
  const svc = SERVICE[service] ?? service;
  const o = OPS.get(`${svc}/${opName}`);
  if (!o) return { ok: false, error: { Code: 'UnknownOperationException', Message: `The operation ${opName} is not available for service ${service} in this simulator.`, Status: 400 } };
  const files = new Map<string, string>();
  const p: Record<string, unknown> = { ...params };
  // boto3 usa `camelCase` en algunos servicios (CodeBuild, CodeDeploy…): se acepta también aquí
  for (const k of Object.keys(p)) {
    if (o.params.some((x) => x.key === k)) continue;
    const up = k[0].toUpperCase() + k.slice(1);
    if (o.params.some((x) => x.key === up)) {
      p[up] = p[k];
      delete p[k];
    }
  }
  const missing = o.params.filter((x) => x.required && !x.name.startsWith('outfile') && p[x.key] === undefined);
  if (missing.length) return { ok: false, error: { Code: 'ParamValidationError', Message: missing.map((x) => `Missing required parameter in input: "${x.key}"`).join('\n'), Status: 400 } };
  // `put-object` recibe el contenido en `Body` (en la CLI es un archivo) y `get-object` lo devuelve en `Body` (en la CLI, un archivo de salida)
  const isPut = svc === 's3api' && opName === 'put-object';
  const isGet = svc === 's3api' && opName === 'get-object';
  if (isPut && p.Body !== undefined) {
    files.set('/tmp/__body', String(p.Body));
    p.Body = '/tmp/__body';
  }
  const isInvoke = svc === 'lambda' && opName === 'invoke';
  if (isGet || isInvoke) p.Outfile = '/tmp/__out';
  const io = memIo(files);
  io.acct = a;
  const opts: GlobalOpts = { region, profile: 'lambda', output: 'json', query: null, maxItems: null, startingToken: null, dryRun: false, noPaginate: true, binaryFormat: 'raw-in-base64-out' };
  const c: OpCtx = { acct: a, region, io, caller: (caller ?? { arn: `arn:aws:iam::${a.id}:root`, account: a.id, type: 'Account', userId: a.id, root: true, mfa: true, accessKeyId: 'AKIASERVICE' }) as Caller, p, opts, service: svc, op: o };
  try {
    if (caller) authorize(c, defaultTargets(o, c));
    const out = o.handler(c);
    if (out instanceof Promise) throw new Error('operación asíncrona en una llamada de SDK');
    let data = (out ?? {}) as Record<string, unknown>;
    if (isGet) {
      const { __stdout, ...rest } = data as Record<string, unknown>;
      void __stdout;
      data = { ...rest, Body: files.get('/tmp/__out') ?? '' };
    }
    if (isInvoke) {
      const { __stdout, ...rest } = data as Record<string, unknown>;
      void __stdout;
      data = { ...rest, Payload: files.get('/tmp/__out') ?? '' };
    }
    return { ok: true, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> };
  } catch (e) {
    if (e instanceof AwsError) return { ok: false, error: { Code: e.code, Message: e.message, Status: e.status ?? 400 } };
    throw e;
  }
}
