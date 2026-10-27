/** Escenarios de la zona «Observabilidad y operaciones» (Z14): CloudWatch, Logs, CloudTrail, Config, Systems Manager, X-Ray y respuesta a incidentes. */
import { sdkCall, userCaller } from './sdk';
import type { Scenario } from './scenarios';
import { BASIC, TRUST, call, fn, policy, role } from './scenarios-srv';
import { cwPut } from './services/cwdata';
import { ddbCreate } from './services/dynamodb';
import { ec2CreateSg, ec2Launch } from './services/ec2';
import { iamCreateRole, iamCreateUser } from './services/iam';
import { logsPut } from './services/logs';
import { s3CreateBucket, s3Put } from './services/s3';
import type { Account } from './types';

const R = 'us-east-1';
const ACCT = '123456789012';
const MIN = 60000;
const HOUR = 3600000;

/** Datos de la tienda que usan varios escenarios (también los consulta el test de contenido). */
export const OPS = {
  grupo: '/tienda/api',
  pedidoRechazado: 'P-4821',
  rutaLenta: '/api/informes',
  dbHost: 'db-prod.interno',
} as const;

// ───────────────────────── piezas ─────────────────────────

/** Un tema SNS (`alertas`) con una cola SQS (`guardia`) suscrita: así se ve si la alarma avisó. */
function alertas(a: Account, topic = 'alertas', queue = 'guardia'): string {
  const t = call(a, 'sns', 'create-topic', { Name: topic }).TopicArn as string;
  call(a, 'sqs', 'create-queue', { QueueName: queue });
  call(a, 'sns', 'subscribe', { TopicArn: t, Protocol: 'sqs', NotificationEndpoint: `arn:aws:sqs:${R}:${ACCT}:${queue}` });
  return t;
}

/** Una llamada a la API hecha por un usuario de la cuenta (con sus permisos): queda en CloudTrail con su nombre. */
function act(a: Account, user: string, service: string, op: string, params: Record<string, unknown>, region = R): Record<string, any> {
  const r = sdkCall(a, region, userCaller(a, user), service, op, params);
  if (!r.ok) throw new Error(`escenario: ${user} ${service} ${op}: ${r.error?.Code} ${r.error?.Message}`);
  return r.data ?? {};
}

/** Como `act`, pero admite que la llamada falle (queda en CloudTrail con su `errorCode`). */
function tryAct(a: Account, user: string, service: string, op: string, params: Record<string, unknown>): void {
  sdkCall(a, R, userCaller(a, user), service, op, params);
}

const WEB_UD = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Tienda</h1>" > /var/www/html/index.html\n';

/** El rol y el perfil de instancia para que Systems Manager administre las instancias. */
function ssmProfile(a: Account): void {
  iamCreateRole(a, 'ssm-ec2', TRUST('ec2.amazonaws.com'), { attached: ['AmazonSSMManagedInstanceCore'], description: 'Systems Manager para EC2' });
  a.iam.instanceProfiles['ssm-ec2'] = { InstanceProfileName: 'ssm-ec2', InstanceProfileId: 'AIPAEXAMPLE0SSMEC2', Arn: `arn:aws:iam::${a.id}:instance-profile/ssm-ec2`, Path: '/', CreateDate: new Date(a.clock).toISOString(), roles: ['ssm-ec2'] };
}

const admin = (a: Account, name: string) => iamCreateUser(a, name, { attached: ['AdministratorAccess'], keys: 1 });

// ───────────────────────── registros de la tienda ─────────────────────────

/** Generador pseudoaleatorio fijo: los mismos registros en cada partida. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const RUTAS: { ruta: string; peso: number; min: number; max: number }[] = [
  { ruta: '/api/catalogo', peso: 40, min: 80, max: 160 },
  { ruta: '/api/pedidos', peso: 30, min: 120, max: 260 },
  { ruta: '/api/pago', peso: 15, min: 200, max: 400 },
  { ruta: OPS.rutaLenta, peso: 10, min: 1800, max: 2600 },
  { ruta: '/api/login', peso: 5, min: 60, max: 140 },
];

/** 400 líneas de registro en JSON de las últimas tres horas: casi todo va bien, hay tres 500 en pedidos y un pago rechazado. */
function tiendaLogs(a: Account): void {
  const rnd = lcg(42);
  const n = 400;
  const total = RUTAS.reduce((s, r) => s + r.peso, 0);
  for (let k = 0; k < n; k++) {
    let x = rnd() * total;
    const r = RUTAS.find((q) => (x -= q.peso) < 0) ?? RUTAS[0];
    const latency = Math.round(r.min + rnd() * (r.max - r.min));
    const ts = a.clock - 3 * HOUR + k * Math.floor((3 * HOUR) / n);
    let line: Record<string, unknown> = { ts: new Date(ts).toISOString(), level: 'INFO', route: r.ruta, status: 200, latency, pedido: `P-${1000 + k}` };
    // un valor atípico suelto en el catálogo: no es el problema real
    if (k === 123) line = { ...line, route: '/api/catalogo', latency: 3100 };
    if (k === 150 || k === 260 || k === 333) line = { ...line, level: 'ERROR', route: '/api/pedidos', status: 500, error: 'DbTimeout', latency: 5000 };
    if (k === 211) line = { ts: line.ts, level: 'ERROR', route: '/api/pago', status: 502, error: 'PaymentDeclined', latency: 380, pedido: OPS.pedidoRechazado };
    logsPut(a, R, OPS.grupo, k % 2 ? 'api-2' : 'api-1', JSON.stringify(line), ts);
  }
}


// ───────────────────────── código de las funciones ─────────────────────────

export const OPS_CODE = {
  config: `import boto3

ssm = boto3.client('ssm')


def lambda_handler(event, context):
    r = ssm.get_parameters_by_path(Path='/tienda/prod', WithDecryption=True)
    cfg = {p['Name'].split('/')[-1]: p['Value'] for p in r['Parameters']}
    return {'host': cfg['db-host'], 'puerto': cfg['db-port'], 'clave_ok': len(cfg['db-password']) > 0}
`,
  inventario: `import time


def lambda_handler(event, context):
    time.sleep(2)  # consulta lenta al almacén
    return {'stock': 12}
`,
  checkout: `import json

import boto3
from aws_xray_sdk.core import patch_all

patch_all()
lam = boto3.client('lambda')
ddb = boto3.client('dynamodb')


def lambda_handler(event, context):
    r = lam.invoke(FunctionName='inventario', Payload=json.dumps({'sku': event.get('sku', 'p1')}))
    stock = json.loads(r['Payload'].read())['stock']
    ddb.put_item(TableName='pedidos', Item={'id': {'S': event.get('id', 'x')}, 'stock': {'N': str(stock)}})
    return {'estado': 'ok', 'stock': stock}
`,
  pedidos: `import os

HOSTS_VALIDOS = ['db-prod.interno']


def lambda_handler(event, context):
    host = os.environ.get('DB_HOST', '')
    if host not in HOSTS_VALIDOS:
        print('ERROR no se puede conectar con la base de datos en', host)
        raise RuntimeError('DbConnectionError: ' + host)
    return {'estado': 'ok', 'host': host}
`,
} as const;

const TRACE_POLICIES = ['AWSXRayDaemonWriteAccess'];

/** Las dos funciones de la tienda (`checkout` llama a `inventario` y guarda en DynamoDB). */
function tienda(a: Account, o: { tracing: boolean }): void {
  ddbCreate(a, R, 'pedidos', { pk: ['id', 'S'] });
  const rInv = role(a, 'inventario-rol', { attached: [BASIC, ...(o.tracing ? TRACE_POLICIES : [])] });
  const rChk = role(a, 'checkout-rol', {
    attached: [BASIC, ...(o.tracing ? TRACE_POLICIES : [])],
    inline: { acceso: policy([{ Action: 'lambda:InvokeFunction', Resource: `arn:aws:lambda:${R}:${ACCT}:function:inventario` }, { Action: 'dynamodb:PutItem', Resource: `arn:aws:dynamodb:${R}:${ACCT}:table/pedidos` }]) },
  });
  fn(a, 'inventario', OPS_CODE.inventario, rInv, { timeout: 5 });
  fn(a, 'checkout', OPS_CODE.checkout, rChk, { timeout: 10 });
  if (o.tracing) for (const f of ['inventario', 'checkout']) call(a, 'lambda', 'update-function-configuration', { FunctionName: f, TracingConfig: { Mode: 'Active' } });
}

// ───────────────────────── escenarios ─────────────────────────

export function makeOpsScenarios(base: Scenario): Record<string, Scenario> {
  /** Un tema (`alertas`) con una cola (`guardia`) suscrita; todo lo demás está por hacer. */
  const metricas: Scenario = (a) => {
    base(a);
    alertas(a);
  };

  /** Dos alarmas que avisan cada una por su cuenta (latencia y errores): demasiado ruido. */
  const compuesta: Scenario = (a) => {
    base(a);
    const t = alertas(a);
    call(a, 'cloudwatch', 'put-metric-alarm', { AlarmName: 'latencia-alta', Namespace: 'Tienda', MetricName: 'LatenciaMs', Statistic: 'Average', Period: 60, EvaluationPeriods: 1, Threshold: 800, ComparisonOperator: 'GreaterThanThreshold', AlarmActions: [t] });
    call(a, 'cloudwatch', 'put-metric-alarm', { AlarmName: 'errores-altos', Namespace: 'Tienda', MetricName: 'Errores', Statistic: 'Sum', Period: 60, EvaluationPeriods: 1, Threshold: 10, ComparisonOperator: 'GreaterThanThreshold', AlarmActions: [t] });
  };

  /** La alarma `latencia-checkout` nunca avisa: no tiene la dimensión de la métrica y apunta a un tema que no existe. */
  const alarmaMuda: Scenario = (a) => {
    base(a);
    alertas(a);
    for (let k = 20; k >= 1; k--) {
      cwPut(a, R, 'Tienda', 'LatenciaMs', { Servicio: 'checkout' }, { value: 280 + (k % 5) * 20, t: a.clock - k * MIN });
      cwPut(a, R, 'Tienda', 'LatenciaMs', { Servicio: 'catalogo' }, { value: 90 + (k % 4) * 10, t: a.clock - k * MIN });
    }
    call(a, 'cloudwatch', 'put-metric-alarm', { AlarmName: 'latencia-checkout', Namespace: 'Tienda', MetricName: 'LatenciaMs', Statistic: 'Average', Period: 60, EvaluationPeriods: 1, Threshold: 800, ComparisonOperator: 'GreaterThanThreshold', AlarmActions: [`arn:aws:sns:${R}:${ACCT}:alertas-prod`] });
  };

  /** Los registros de la API de la tienda (400 líneas JSON) y el tema `alertas` con su cola. */
  const logs: Scenario = (a) => {
    base(a);
    alertas(a);
    tiendaLogs(a);
  };

  /** Una auditoría: alguien abrió el puerto 22 de `web-sg` a todo internet y hay que saber quién. */
  const auditoria: Scenario = (a) => {
    base(a);
    admin(a, 'ana');
    admin(a, 'carlos');
    iamCreateUser(a, 'lucia', { attached: ['ReadOnlyAccess'], keys: 1 });
    a.clock += 2 * HOUR;
    const sg = act(a, 'ana', 'ec2', 'create-security-group', { GroupName: 'web-sg', Description: 'Servidor web de la tienda' }).GroupId as string;
    a.clock += 5 * MIN;
    act(a, 'ana', 'ec2', 'authorize-security-group-ingress', { GroupId: sg, IpPermissions: [{ IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] });
    ec2Launch(a, R, { type: 't3.micro', sgIds: [sg], tags: [{ Key: 'Name', Value: 'web' }] });
    a.clock += 3 * HOUR;
    act(a, 'ana', 'ec2', 'describe-instances', {});
    act(a, 'lucia', 'ec2', 'describe-security-groups', {});
    tryAct(a, 'lucia', 'ec2', 'delete-security-group', { GroupId: sg });
    a.clock += 2 * HOUR;
    act(a, 'carlos', 'ec2', 'authorize-security-group-ingress', { GroupId: sg, IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'solo un momento' }] }] });
    a.clock += 90 * MIN;
    act(a, 'ana', 'ec2', 'describe-instances', {});
    act(a, 'carlos', 'ec2', 'describe-security-groups', {});
    act(a, 'carlos', 'sts', 'get-caller-identity', {});
    a.clock += 40 * MIN;
  };

  /** Un bucket vacío (`auditoria-logs`) sin política y dos usuarios que ya han hecho cosas: falta el trail. */
  const trail: Scenario = (a) => {
    base(a);
    admin(a, 'ana');
    admin(a, 'carlos');
    s3CreateBucket(a, 'auditoria-logs', R);
    act(a, 'ana', 'ec2', 'describe-instances', {});
    act(a, 'carlos', 'iam', 'list-users', {});
  };

  /** AWS Config apagado: un SG con SSH abierto, un bucket público, y el bucket de entrega y los roles ya preparados. */
  const config: Scenario = (a) => {
    base(a);
    admin(a, 'carlos');
    const b = s3CreateBucket(a, 'config-logs', R);
    b.policy = {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::config-logs' },
        { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::config-logs/AWSLogs/${ACCT}/Config/*` },
      ],
    };
    iamCreateRole(a, 'config-rol', TRUST('config.amazonaws.com'), { attached: ['service-role/AWS_ConfigRole'] });
    iamCreateRole(a, 'remediacion', TRUST('ssm.amazonaws.com'), { attached: ['AmazonEC2FullAccess'] });
    ec2CreateSg(a, R, 'web-sg', 'Servidor web de la tienda', [{ proto: 'tcp', from: 80, to: 80, cidr: '0.0.0.0/0' }, { proto: 'tcp', from: 22, to: 22, cidr: '0.0.0.0/0' }]);
    const datos = s3CreateBucket(a, 'datos-clientes', R, { publicAccessBlock: null });
    s3Put(a, datos, 'clientes.csv', 'nombre,email\nana,ana@tienda.es\n');
    datos.policy = { Version: '2012-10-17', Statement: [{ Sid: 'Publico', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::datos-clientes/*' }] };
  };


  /** Una función que lee su configuración de Parameter Store: faltan los parámetros y el permiso de su rol. */
  const ssmParams: Scenario = (a) => {
    base(a);
    const r = role(a, 'pedidos-rol', { attached: [BASIC] });
    fn(a, 'pedidos', OPS_CODE.config, r, { timeout: 5 });
  };

  /** Tres servidores de producción administrados por Systems Manager; uno de ellos no tiene servidor web. */
  const ssmRun: Scenario = (a) => {
    base(a);
    ssmProfile(a);
    for (const n of [1, 2, 3]) ec2Launch(a, R, { type: 't3.micro', profile: 'ssm-ec2', userData: n === 3 ? '#!/bin/bash\necho "sin web"\n' : WEB_UD, tags: [{ Key: 'Name', Value: `web-${n}` }, { Key: 'Env', Value: 'prod' }] });
    a.clock += 10 * MIN;
  };

  /** Dos servidores de producción administrados, sin etiqueta de grupo de parches ni ventana de mantenimiento. */
  const ssmParches: Scenario = (a) => {
    base(a);
    ssmProfile(a);
    for (const n of [1, 2]) ec2Launch(a, R, { type: 't3.micro', profile: 'ssm-ec2', userData: WEB_UD, tags: [{ Key: 'Name', Value: `web-${n}` }, { Key: 'Env', Value: 'prod' }] });
    a.clock += 10 * MIN;
  };

  /** `checkout` llama a `inventario` (lento) y a DynamoDB; ninguna tiene el rastreo activado ni permisos de X-Ray. */
  const trazas: Scenario = (a) => {
    base(a);
    tienda(a, { tracing: false });
  };

  /** Lo mismo, con el rastreo activado y varias peticiones ya registradas. */
  const trazasOk: Scenario = (a) => {
    base(a);
    tienda(a, { tracing: true });
    for (let k = 0; k < 6; k++) {
      call(a, 'lambda', 'invoke', { FunctionName: 'checkout', Payload: JSON.stringify({ id: `P-${k}` }) });
      a.clock += 20000;
    }
  };

  /** Una alarma de latencia sin acciones, un servidor y los roles para reiniciarlo con Systems Manager desde EventBridge. */
  const eventos: Scenario = (a) => {
    base(a);
    alertas(a);
    ec2Launch(a, R, { type: 't3.micro', userData: WEB_UD, tags: [{ Key: 'Name', Value: 'web-1' }] });
    iamCreateRole(a, 'auto-rol', TRUST('ssm.amazonaws.com'), { attached: ['AmazonEC2FullAccess'] });
    const r = iamCreateRole(a, 'eventos-rol', TRUST('events.amazonaws.com'), { inline: { automatizacion: policy([{ Action: 'ssm:StartAutomationExecution', Resource: '*' }, { Action: 'iam:PassRole', Resource: `arn:aws:iam::${ACCT}:role/auto-rol` }]) } });
    void r;
    call(a, 'cloudwatch', 'put-metric-alarm', { AlarmName: 'web-lenta', Namespace: 'Tienda', MetricName: 'LatenciaMs', Statistic: 'Average', Period: 60, EvaluationPeriods: 1, Threshold: 800, ComparisonOperator: 'GreaterThanThreshold' });
  };

  /** La noche de guardia: `pedidos` falla desde que `becario` cambió su configuración; sin alarmas, sin trail y con la causa en CloudTrail. */
  const boss: Scenario = (a) => {
    base(a);
    admin(a, 'becario');
    admin(a, 'carlos');
    alertas(a, 'alertas', 'guardia');
    const b = s3CreateBucket(a, 'auditoria-logs', R);
    b.policy = {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::auditoria-logs' },
        { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::auditoria-logs/AWSLogs/${ACCT}/*`, Condition: { StringEquals: { 's3:x-amz-acl': 'bucket-owner-full-control' } } },
      ],
    };
    call(a, 'ssm', 'put-parameter', { Name: '/tienda/prod/db-host', Value: OPS.dbHost, Type: 'String' });
    const r = role(a, 'pedidos-rol', { attached: [BASIC] });
    fn(a, 'pedidos', OPS_CODE.pedidos, r, { timeout: 5, env: { DB_HOST: OPS.dbHost } });
    call(a, 'lambda', 'invoke', { FunctionName: 'pedidos', Payload: '{}' });
    a.clock += 3 * HOUR;
    act(a, 'carlos', 'lambda', 'list-functions', {});
    a.clock += 40 * MIN;
    act(a, 'becario', 'lambda', 'update-function-configuration', { FunctionName: 'pedidos', Environment: { Variables: { DB_HOST: 'db-vieja.interno' } } });
    for (let k = 0; k < 5; k++) {
      a.clock += 7 * MIN;
      call(a, 'lambda', 'invoke', { FunctionName: 'pedidos', Payload: '{}' });
    }
    a.clock += 10 * MIN;
  };

  return { 'ops-ssm-params': ssmParams, 'ops-ssm-run': ssmRun, 'ops-ssm-parches': ssmParches, 'ops-trazas': trazas, 'ops-trazas-ok': trazasOk, 'ops-eventos': eventos, 'ops-boss': boss, 'ops-metricas': metricas, 'ops-compuesta': compuesta, 'ops-alarma-muda': alarmaMuda, 'ops-logs': logs, 'ops-auditoria': auditoria, 'ops-trail': trail, 'ops-config': config };
}
