/** Escenarios de la zona «Serverless» (Z10): funciones Lambda con su código en Python, API Gateway, colas, temas, EventBridge, Step Functions y Cognito. */
import { makeZip } from '../engine/commands/archive';
import { sdkCall } from './sdk';
import type { Scenario } from './scenarios';
import { ddbCreate } from './services/dynamodb';
import { iamCreateRole } from './services/iam';
import { s3CreateBucket } from './services/s3';
import type { Account, PolicyDoc } from './types';

const R = 'us-east-1';
const ACCT = '123456789012';
const S = (s: string) => ({ S: s });
const N = (n: number) => ({ N: String(n) });

/** Código en Python de las funciones (también se deja en el directorio del alumno para que lo empaquete). */
export const SRV_CODE = {
  saludo: `def lambda_handler(event, context):
    nombre = event.get('nombre', 'mundo')
    print(f'Saludando a {nombre}')
    return {'mensaje': f'Hola, {nombre}!'}
`,
  informe: `import time


def lambda_handler(event, context):
    time.sleep(4)  # espera a un servicio externo lento
    return {'informe': 'listo', 'filas': 120}
`,
  calcula: `def lambda_handler(event, context):
    total = 0
    for i in range(200000):
        cuadrado = i * i
        resto = cuadrado % 7
        total += resto
        total %= 1000003
    return {'total': total}
`,
  confirma: `def lambda_handler(event, context):
    print('Pedido confirmado', event.get('pedido'))
    return {'confirmado': True}
`,
  catalogo: `import json
import boto3
from decimal import Decimal

tabla = boto3.resource('dynamodb').Table('productos')


def num(o):
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    raise TypeError('no se puede serializar')


def respuesta(codigo, cuerpo):
    return {'statusCode': codigo, 'headers': {'Content-Type': 'application/json'}, 'body': json.dumps(cuerpo, default=num)}


def lambda_handler(event, context):
    ruta = event.get('pathParameters') or {}
    if 'id' in ruta:
        r = tabla.get_item(Key={'id': ruta['id']})
        if 'Item' not in r:
            return respuesta(404, {'error': 'no existe'})
        return respuesta(200, r['Item'])
    return respuesta(200, tabla.scan()['Items'])
`,
  crea: `import json
import boto3

tabla = boto3.resource('dynamodb').Table('productos')


def lambda_handler(event, context):
    try:
        datos = json.loads(event.get('body') or '{}')
        nuevo = {'id': datos['id'], 'nombre': datos['nombre'], 'precio': int(datos['precio'])}
    except (ValueError, KeyError):
        return {'statusCode': 400, 'body': json.dumps({'error': 'faltan id, nombre o precio'})}
    tabla.put_item(Item=nuevo)
    return {'statusCode': 201, 'body': json.dumps(nuevo)}
`,
  worker: `import json


def lambda_handler(event, context):
    for registro in event['Records']:
        pedido = json.loads(registro['body'])
        if pedido.get('malo'):
            raise ValueError('pedido corrupto: ' + registro['messageId'])
        print('procesado', pedido['id'])
`,
  limpieza: `def lambda_handler(event, context):
    print('limpiando archivos temporales', event.get('time'))
    return {'borrados': 3}
`,
  valida: `def lambda_handler(event, context):
    resultado = dict(event)
    resultado['valido'] = event['total'] > 0
    print('validado', event['id'], resultado['valido'])
    return resultado
`,
  cobra: `def lambda_handler(event, context):
    resultado = dict(event)
    resultado['cobrado'] = True
    print('cobrado', event['id'], event['total'])
    return resultado
`,
  notifica: `def lambda_handler(event, context):
    resultado = dict(event)
    resultado['notificado'] = True
    print('notificado a', event['cliente'])
    return resultado
`,
  perfil: `import json


def lambda_handler(event, context):
    claims = event['requestContext']['authorizer']['jwt']['claims'] if 'authorizer' in event['requestContext'] else {}
    return {'statusCode': 200, 'body': json.dumps({'usuario': claims.get('email', 'anónimo')})}
`,
  miniatura: `import urllib.parse
import boto3

s3 = boto3.client('s3')


def lambda_handler(event, context):
    for r in event['Records']:
        bucket = r['s3']['bucket']['name']
        clave = urllib.parse.unquote_plus(r['s3']['object']['key'])
        original = s3.get_object(Bucket=bucket, Key=clave)['Body'].read()
        s3.put_object(Bucket='tienda-fotos-miniaturas', Key=clave, Body=original[:10])
        print('miniatura creada', clave)
`,
  recibe: `import json
import os
import uuid
import boto3

sqs = boto3.client('sqs')


def lambda_handler(event, context):
    try:
        pedido = json.loads(event.get('body') or '')
        pedido['sku']
        pedido['cantidad']
    except (ValueError, KeyError, TypeError):
        return {'statusCode': 400, 'body': json.dumps({'error': 'hace falta un JSON con sku y cantidad'})}
    pedido['id'] = str(uuid.uuid4())
    sqs.send_message(QueueUrl=os.environ['COLA_URL'], MessageBody=json.dumps(pedido))
    return {'statusCode': 202, 'body': json.dumps({'id': pedido['id']})}
`,
  procesa: `import json
import boto3

tabla = boto3.resource('dynamodb').Table('pedidos')


def lambda_handler(event, context):
    for registro in event['Records']:
        pedido = json.loads(registro['body'])
        tabla.put_item(Item={'id': pedido['id'], 'sku': pedido['sku'], 'cantidad': int(pedido['cantidad']), 'estado': 'recibido'})
        print('guardado', pedido['id'])
`,
};

export const SRV_ASL = JSON.stringify(
  {
    Comment: 'Flujo de un pedido',
    StartAt: 'Validar',
    States: {
      Validar: { Type: 'Task', Resource: `arn:aws:lambda:${R}:${ACCT}:function:valida`, Next: 'EsValido' },
      EsValido: { Type: 'Choice', Choices: [{ Variable: '$.valido', BooleanEquals: true, Next: 'Cobrar' }], Default: 'Rechazado' },
      Cobrar: { Type: 'Task', Resource: `arn:aws:lambda:${R}:${ACCT}:function:cobra`, Retry: [{ ErrorEquals: ['States.TaskFailed'], IntervalSeconds: 2, MaxAttempts: 2, BackoffRate: 2 }], Next: 'Notificar' },
      Notificar: { Type: 'Task', Resource: `arn:aws:lambda:${R}:${ACCT}:function:notifica`, End: true },
      Rechazado: { Type: 'Fail', Error: 'PedidoInvalido', Cause: 'El pedido no es válido' },
    },
  },
  null,
  2,
);

export const TRUST = (service: string): PolicyDoc => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }] });
export const policy = (statements: { Action: string | string[]; Resource: string | string[] }[]): PolicyDoc => ({ Version: '2012-10-17', Statement: statements.map((s) => ({ Effect: 'Allow' as const, ...s })) });
export const BASIC = 'service-role/AWSLambdaBasicExecutionRole';
const tableArn = (n: string) => `arn:aws:dynamodb:${R}:${ACCT}:table/${n}`;
const fnArn = (n: string) => `arn:aws:lambda:${R}:${ACCT}:function:${n}`;

/** Llama a una operación como el sistema (sin comprobar permisos) y falla ruidosamente si el escenario está mal montado. */
export function call(a: Account, service: string, op: string, params: Record<string, unknown>): Record<string, any> {
  const r = sdkCall(a, R, null, service, op, params);
  if (!r.ok) throw new Error(`escenario: ${service} ${op}: ${r.error?.Code} ${r.error?.Message}`);
  return r.data ?? {};
}

export function role(a: Account, name: string, o: { attached?: string[]; inline?: Record<string, PolicyDoc>; service?: string } = {}): string {
  return iamCreateRole(a, name, TRUST(o.service ?? 'lambda.amazonaws.com'), { attached: o.attached ?? [], inline: o.inline }).Arn;
}

export function fn(a: Account, name: string, code: string, roleArn: string, o: { handler?: string; timeout?: number; memory?: number; env?: Record<string, string>; file?: string } = {}): string {
  const file = o.file ?? 'lambda_function.py';
  call(a, 'lambda', 'create-function', {
    FunctionName: name,
    Runtime: 'python3.12',
    Role: roleArn,
    Handler: o.handler ?? `${file.replace(/\.py$/, '')}.lambda_handler`,
    ZipFile: makeZip({ [file]: code }),
    Timeout: o.timeout ?? 3,
    MemorySize: o.memory ?? 128,
    ...(o.env ? { Environment: { Variables: o.env } } : {}),
  });
  return fnArn(name);
}

function productos(a: Account): void {
  ddbCreate(a, R, 'productos', {
    pk: ['id', 'S'],
    items: [
      { id: S('p1'), nombre: S('Camiseta'), precio: N(15) },
      { id: S('p2'), nombre: S('Taza'), precio: N(8) },
      { id: S('p3'), nombre: S('Gorra'), precio: N(12) },
    ],
  });
}

/** Permiso de API Gateway para invocar una función, como el que se añade al conectarlos desde la consola. */
function apiPermission(a: Account, apiId: string, fname: string, sid = 'apigateway'): void {
  call(a, 'lambda', 'add-permission', { FunctionName: fname, StatementId: sid, Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com', SourceArn: `arn:aws:execute-api:${R}:${ACCT}:${apiId}/*/*/*` });
}

export function makeSrvScenarios(base: Scenario): Record<string, Scenario> {
  // ───────────── Lambda ─────────────

  /** Solo el rol para funciones; el alumno crea la función. */
  const lambda: Scenario = (a) => {
    base(a);
    role(a, 'lambda-basico', { attached: [BASIC] });
  };

  /** Una función ya creada (para ver su configuración y probarla). */
  const lambdaDemo: Scenario = (a) => {
    base(a);
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    fn(a, 'saludo', SRV_CODE.saludo, r);
    fn(a, 'calcula', SRV_CODE.calcula, r);
  };

  /** Dos fallos de configuración: nombre del handler mal escrito y tiempo máximo corto. */
  const lambdaRoto: Scenario = (a) => {
    base(a);
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    fn(a, 'informe', SRV_CODE.informe, r, { handler: 'lambda_function.handler', timeout: 3 });
  };

  /** Una función que necesita más CPU que la que le dan 128 MB. */
  const lambdaLenta: Scenario = (a) => {
    base(a);
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    fn(a, 'calcula', SRV_CODE.calcula, r, { timeout: 1, memory: 128 });
  };

  /** La función se ejecuta, pero su rol no puede escribir en CloudWatch Logs. */
  const lambdaSinLogs: Scenario = (a) => {
    base(a);
    const r = role(a, 'confirma-role');
    fn(a, 'confirma', SRV_CODE.confirma, r);
  };

  // ───────────── API Gateway ─────────────

  const apiRole = (a: Account) => role(a, 'api-role', { attached: [BASIC], inline: { 'lee-productos': policy([{ Action: ['dynamodb:Scan', 'dynamodb:GetItem'], Resource: tableArn('productos') }]) } });

  /** Tabla y rol listos; el alumno crea la función y la API. */
  const api: Scenario = (a) => {
    base(a);
    productos(a);
    apiRole(a);
  };

  /** La API existe y apunta a la función, pero falta el permiso de invocación (responde 500). Etapa `prod`. */
  const api500: Scenario = (a) => {
    base(a);
    productos(a);
    const r = apiRole(a);
    const arn = fn(a, 'catalogo', SRV_CODE.catalogo, r, { file: 'catalogo.py' });
    const x = call(a, 'apigatewayv2', 'create-api', { Name: 'tienda-api', ProtocolType: 'HTTP' });
    const i = call(a, 'apigatewayv2', 'create-integration', { ApiId: x.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: arn, PayloadFormatVersion: '2.0' });
    call(a, 'apigatewayv2', 'create-route', { ApiId: x.ApiId, RouteKey: 'GET /productos', Target: `integrations/${i.IntegrationId}` });
    call(a, 'apigatewayv2', 'create-stage', { ApiId: x.ApiId, StageName: 'prod', AutoDeploy: true });
  };

  /** GET funciona; POST responde 500 porque el rol de la función `crea` no puede escribir en la tabla. */
  const apiPost: Scenario = (a) => {
    base(a);
    productos(a);
    const r = apiRole(a);
    const rc = role(a, 'crea-role', { attached: [BASIC], inline: { 'lee-productos': policy([{ Action: ['dynamodb:Scan', 'dynamodb:GetItem'], Resource: tableArn('productos') }]) } });
    const cat = fn(a, 'catalogo', SRV_CODE.catalogo, r, { file: 'catalogo.py' });
    const cre = fn(a, 'crea', SRV_CODE.crea, rc, { file: 'crea.py' });
    const x = call(a, 'apigatewayv2', 'create-api', { Name: 'tienda-api', ProtocolType: 'HTTP' });
    const i1 = call(a, 'apigatewayv2', 'create-integration', { ApiId: x.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: cat, PayloadFormatVersion: '2.0' });
    const i2 = call(a, 'apigatewayv2', 'create-integration', { ApiId: x.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: cre, PayloadFormatVersion: '2.0' });
    call(a, 'apigatewayv2', 'create-route', { ApiId: x.ApiId, RouteKey: 'GET /productos', Target: `integrations/${i1.IntegrationId}` });
    call(a, 'apigatewayv2', 'create-route', { ApiId: x.ApiId, RouteKey: 'POST /productos', Target: `integrations/${i2.IntegrationId}` });
    call(a, 'apigatewayv2', 'create-stage', { ApiId: x.ApiId, StageName: '$default', AutoDeploy: true });
    apiPermission(a, x.ApiId, 'catalogo');
    apiPermission(a, x.ApiId, 'crea');
  };

  // ───────────── SQS / SNS ─────────────

  /** Un tema con dos colas sin conectar. */
  const fanout: Scenario = (a) => {
    base(a);
    call(a, 'sns', 'create-topic', { Name: 'pedidos' });
    call(a, 'sqs', 'create-queue', { QueueName: 'facturacion' });
    call(a, 'sqs', 'create-queue', { QueueName: 'envios' });
  };

  /** Una cola con un mensaje «veneno» que hace fallar siempre a su consumidor, y sin cola de mensajes muertos. */
  const veneno: Scenario = (a) => {
    base(a);
    const r = role(a, 'worker-role', { attached: [BASIC, 'service-role/AWSLambdaSQSQueueExecutionRole'] });
    fn(a, 'worker', SRV_CODE.worker, r, { timeout: 10 });
    const q = call(a, 'sqs', 'create-queue', { QueueName: 'trabajos', Attributes: { VisibilityTimeout: '30' } });
    call(a, 'lambda', 'create-event-source-mapping', { FunctionName: 'worker', EventSourceArn: `arn:aws:sqs:${R}:${ACCT}:trabajos`, BatchSize: 1 });
    for (const body of [{ id: 1 }, { id: 2 }, { malo: true }, { id: 3 }, { id: 4 }]) call(a, 'sqs', 'send-message', { QueueUrl: q.QueueUrl, MessageBody: JSON.stringify(body) });
  };

  // ───────────── EventBridge / Step Functions ─────────────

  const cron: Scenario = (a) => {
    base(a);
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    fn(a, 'limpieza', SRV_CODE.limpieza, r);
  };

  /** Una cola que ya admite eventos de la regla `pedidos-grandes` (el nombre de la regla va en la política). */
  const eventos: Scenario = (a) => {
    base(a);
    const q = call(a, 'sqs', 'create-queue', { QueueName: 'grandes' });
    const pol = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: `arn:aws:sqs:${R}:${ACCT}:grandes`, Condition: { ArnEquals: { 'aws:SourceArn': `arn:aws:events:${R}:${ACCT}:rule/pedidos-grandes` } } }] };
    call(a, 'sqs', 'set-queue-attributes', { QueueUrl: q.QueueUrl, Attributes: { Policy: JSON.stringify(pol) } });
  };

  const sfnFns = (a: Account) => {
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    for (const n of ['valida', 'cobra', 'notifica'] as const) fn(a, n, SRV_CODE[n], r);
  };

  /** Funciones y un rol que sí puede invocarlas; el alumno crea la máquina. */
  const sfn: Scenario = (a) => {
    base(a);
    sfnFns(a);
    role(a, 'sfn-role', { service: 'states.amazonaws.com', inline: { invoca: policy([{ Action: 'lambda:InvokeFunction', Resource: '*' }]) } });
  };

  /** La máquina existe, pero su rol no puede invocar las funciones: la primera ejecución falló. */
  const sfnRoto: Scenario = (a) => {
    base(a);
    sfnFns(a);
    const rr = role(a, 'sfn-role', { service: 'states.amazonaws.com' });
    const m = call(a, 'stepfunctions', 'create-state-machine', { Name: 'pedido', Definition: SRV_ASL, RoleArn: rr });
    call(a, 'stepfunctions', 'start-execution', { StateMachineArn: m.stateMachineArn, Name: 'primera', Input: JSON.stringify({ id: 1, total: 40, cliente: 'ana' }) });
  };

  // ───────────── Cognito / S3 ─────────────

  const userPool = (a: Account) => {
    const pool = call(a, 'cognito-idp', 'create-user-pool', { PoolName: 'tienda-usuarios', UsernameAttributes: ['email'], AutoVerifiedAttributes: ['email'] }).UserPool;
    const client = call(a, 'cognito-idp', 'create-user-pool-client', { UserPoolId: pool.Id, ClientName: 'web', ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'] }).UserPoolClient;
    call(a, 'cognito-idp', 'admin-create-user', { UserPoolId: pool.Id, Username: 'ana@tienda.es', UserAttributes: [{ Name: 'email', Value: 'ana@tienda.es' }] });
    call(a, 'cognito-idp', 'admin-set-user-password', { UserPoolId: pool.Id, Username: 'ana@tienda.es', Password: 'Secreto#2026', Permanent: true });
    return { pool, client };
  };

  /** Un grupo de usuarios con un cliente y una usuaria, y una API pública `GET /perfil` que el alumno debe proteger. */
  const auth: Scenario = (a) => {
    base(a);
    userPool(a);
    const r = role(a, 'lambda-basico', { attached: [BASIC] });
    const arn = fn(a, 'perfil', SRV_CODE.perfil, r);
    const x = call(a, 'apigatewayv2', 'create-api', { Name: 'perfil-api', ProtocolType: 'HTTP' });
    const i = call(a, 'apigatewayv2', 'create-integration', { ApiId: x.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: arn, PayloadFormatVersion: '2.0' });
    call(a, 'apigatewayv2', 'create-route', { ApiId: x.ApiId, RouteKey: 'GET /perfil', Target: `integrations/${i.IntegrationId}` });
    call(a, 'apigatewayv2', 'create-stage', { ApiId: x.ApiId, StageName: '$default', AutoDeploy: true });
    apiPermission(a, x.ApiId, 'perfil');
  };

  /** Dos buckets y una función que crea la miniatura de cada foto; falta conectar el bucket con la función. */
  const s3ev: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, 'tienda-fotos-originales', R);
    s3CreateBucket(a, 'tienda-fotos-miniaturas', R);
    const r = role(a, 'miniatura-role', {
      attached: [BASIC],
      inline: { s3: policy([{ Action: ['s3:GetObject'], Resource: 'arn:aws:s3:::tienda-fotos-originales/*' }, { Action: ['s3:PutObject'], Resource: 'arn:aws:s3:::tienda-fotos-miniaturas/*' }]) },
    });
    fn(a, 'miniatura', SRV_CODE.miniatura, r, { timeout: 10 });
  };

  // ───────────── misión final ─────────────

  /** Tabla `pedidos`, usuaria de Cognito y dos roles sin permisos; todo lo demás lo monta el alumno. */
  const boss: Scenario = (a) => {
    base(a);
    ddbCreate(a, R, 'pedidos', { pk: ['id', 'S'] });
    userPool(a);
    role(a, 'recibe-role', { attached: [BASIC] });
    role(a, 'procesa-role', { attached: [BASIC] });
  };

  return {
    'srv-lambda': lambda,
    'srv-lambda-demo': lambdaDemo,
    'srv-lambda-roto': lambdaRoto,
    'srv-lambda-lenta': lambdaLenta,
    'srv-lambda-sinlogs': lambdaSinLogs,
    'srv-api': api,
    'srv-api-500': api500,
    'srv-api-post': apiPost,
    'srv-fanout': fanout,
    'srv-veneno': veneno,
    'srv-cron': cron,
    'srv-eventos': eventos,
    'srv-sfn': sfn,
    'srv-sfn-roto': sfnRoto,
    'srv-auth': auth,
    'srv-s3ev': s3ev,
    'srv-boss': boss,
  };
}
