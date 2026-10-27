import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });

async function role(e: TestEnv, name = 'fn-role', policies: string[] = ['service-role/AWSLambdaBasicExecutionRole'], svc = 'lambda.amazonaws.com') {
  e.write(`${name}.json`, TRUST(svc));
  const r = await e.json(`iam create-role --role-name ${name} --assume-role-policy-document file://${name}.json`);
  for (const p of policies) await e.run(`iam attach-role-policy --role-name ${name} --policy-arn arn:aws:iam::aws:policy/${p}`);
  return r.Role.Arn as string;
}

async function fn(e: TestEnv, name: string, code: string, o: { role?: string; handler?: string; extra?: string; files?: Record<string, string> } = {}) {
  e.write(`${name}.zip`, zip({ 'lambda_function.py': code, ...(o.files ?? {}) }));
  const arn = o.role ?? (await role(e, `${name}-role`));
  return e.run(`lambda create-function --function-name ${name} --runtime python3.12 --role ${arn} --handler ${o.handler ?? 'lambda_function.lambda_handler'} --zip-file fileb://${name}.zip ${o.extra ?? ''}`);
}

/** Con `/dev/stdout` la CLI imprime la respuesta de la función y, pegado, el JSON de metadatos. */
const split = (out: string) => {
  const i = out.lastIndexOf('{\n    "StatusCode"');
  return i < 0 ? { payload: out, meta: '' } : { payload: out.slice(0, i), meta: out.slice(i) };
};
const invoke = async (e: TestEnv, name: string, payload: unknown = {}, extra = '') => {
  const r = await e.run(`lambda invoke --function-name ${name} --cli-binary-format raw-in-base64-out --payload '${JSON.stringify(payload)}' ${extra} /dev/stdout`);
  return { ...r, ...split(r.stdout) };
};

const logsOf = async (e: TestEnv, name: string) => (await e.json(`logs filter-log-events --log-group-name /aws/lambda/${name} --query "events[].message"`)) as string[];

describe('SQS', () => {
  test('envío, recepción, visibilidad y borrado', async () => {
    const e = mkEnv();
    const url = (await e.json('sqs create-queue --queue-name pedidos --attributes VisibilityTimeout=10')).QueueUrl;
    expect(url).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/pedidos');
    expect(await e.json('sqs create-queue --queue-name pedidos --attributes VisibilityTimeout=10')).toEqual({ QueueUrl: url });
    expect((await e.run('sqs create-queue --queue-name pedidos --attributes VisibilityTimeout=20')).stderr).toContain('QueueNameExists');
    expect((await e.run('sqs create-queue --queue-name malo --attributes VisibilityTimeout=99999')).stderr).toContain('Must be between 0 and 43200');
    await e.run(`sqs send-message --queue-url ${url} --message-body hola`);
    await e.run(`sqs send-message --queue-url ${url} --message-body '{"id":2}' --message-attributes '{"tipo":{"DataType":"String","StringValue":"urgente"}}'`);
    expect(await e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names ApproximateNumberOfMessages`)).toEqual({ Attributes: { ApproximateNumberOfMessages: '2' } });
    const m = (await e.json(`sqs receive-message --queue-url ${url}`)).Messages[0];
    expect(m.Body).toBe('hola');
    // en vuelo: no se ve y el contador lo refleja
    const q = await e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names All --query Attributes`);
    expect(q.ApproximateNumberOfMessages).toBe('1');
    expect(q.ApproximateNumberOfMessagesNotVisible).toBe('1');
    const m2 = (await e.json(`sqs receive-message --queue-url ${url} --message-attribute-names All --max-number-of-messages 5`)).Messages;
    expect(m2).toHaveLength(1);
    expect(m2[0].MessageAttributes.tipo.StringValue).toBe('urgente');
    // tras el tiempo de visibilidad vuelve a aparecer con el contador de recepciones aumentado
    e.acct.clock += 11000;
    const again = (await e.json(`sqs receive-message --queue-url ${url} --attribute-names ApproximateReceiveCount`)).Messages[0];
    expect(again.Body).toBe('hola');
    expect(again.Attributes.ApproximateReceiveCount).toBe('2');
    expect((await e.run(`sqs delete-message --queue-url ${url} --receipt-handle nada`)).stderr).toContain('ReceiptHandleIsInvalid');
    await e.run(`sqs delete-message --queue-url ${url} --receipt-handle ${again.ReceiptHandle}`);
    e.acct.clock += 11000;
    expect(await e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages`)).toBe('1');
    await e.run(`sqs purge-queue --queue-url ${url}`);
    expect((await e.run(`sqs receive-message --queue-url ${url}`)).stdout).toBe('');
    expect(await e.json('sqs list-queues --query "QueueUrls[]"')).toEqual([url]);
    await e.run(`sqs delete-queue --queue-url ${url}`);
    expect((await e.run(`sqs send-message --queue-url ${url} --message-body x`)).stderr).toContain('QueueDoesNotExist');
  });

  test('cola de mensajes muertos (redrive) y change-message-visibility', async () => {
    const e = mkEnv();
    const dlq = (await e.json('sqs create-queue --queue-name pedidos-dlq')).QueueUrl;
    const dlqArn = await e.json(`sqs get-queue-attributes --queue-url ${dlq} --attribute-names QueueArn --query Attributes.QueueArn`);
    const policy = JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 2 });
    const q = (await e.json(`sqs create-queue --queue-name pedidos --attributes '{"VisibilityTimeout":"5","RedrivePolicy":${JSON.stringify(policy)}}'`)).QueueUrl;
    await e.run(`sqs send-message --queue-url ${q} --message-body venenoso`);
    for (let i = 0; i < 2; i++) {
      expect((await e.json(`sqs receive-message --queue-url ${q}`)).Messages).toHaveLength(1);
      e.acct.clock += 6000;
    }
    // la tercera vez ya no está: pasó a la DLQ
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout).toBe('');
    expect((await e.json(`sqs receive-message --queue-url ${dlq}`)).Messages[0].Body).toBe('venenoso');
    expect(await e.json(`sqs list-dead-letter-source-queues --queue-url ${dlq} --query queueUrls`)).toEqual([q]);
    expect((await e.run(`sqs create-queue --queue-name x --attributes RedrivePolicy={}`)).stderr).toContain('RedrivePolicy');
    // alargar la visibilidad
    await e.run(`sqs send-message --queue-url ${q} --message-body lento`);
    const h = (await e.json(`sqs receive-message --queue-url ${q}`)).Messages[0].ReceiptHandle;
    await e.run(`sqs change-message-visibility --queue-url ${q} --receipt-handle ${h} --visibility-timeout 60`);
    e.acct.clock += 10000;
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout).toBe('');
    await e.run(`sqs change-message-visibility --queue-url ${q} --receipt-handle ${h} --visibility-timeout 0`);
    expect((await e.json(`sqs receive-message --queue-url ${q}`)).Messages[0].Body).toBe('lento');
  });

  test('retraso, long polling, lotes y colas FIFO', async () => {
    const e = mkEnv();
    const q = (await e.json('sqs create-queue --queue-name tareas')).QueueUrl;
    await e.run(`sqs send-message --queue-url ${q} --message-body tarde --delay-seconds 30`);
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout).toBe('');
    const t0 = e.acct.clock;
    expect((await e.run(`sqs receive-message --queue-url ${q} --wait-time-seconds 20`)).stdout).toBe('');
    e.acct.clock = Math.max(e.acct.clock, t0 + 31000);
    expect((await e.json(`sqs receive-message --queue-url ${q} --query "Messages[0].Body"`))).toBe('tarde');
    const batch = await e.json(`sqs send-message-batch --queue-url ${q} --entries '[{"Id":"1","MessageBody":"a"},{"Id":"2","MessageBody":"b"}]'`);
    expect(batch.Successful).toHaveLength(2);
    expect((await e.run(`sqs send-message-batch --queue-url ${q} --entries '[]'`)).stderr).toContain('EmptyBatchRequest');
    // FIFO
    expect((await e.run('sqs create-queue --queue-name fifo')).code).toBe(0);
    expect((await e.run('sqs create-queue --queue-name mal.fifo')).stderr).toContain('FifoQueue');
    const f = (await e.json('sqs create-queue --queue-name pagos.fifo --attributes FifoQueue=true')).QueueUrl;
    expect((await e.run(`sqs send-message --queue-url ${f} --message-body x`)).stderr).toContain('MessageGroupId');
    expect((await e.run(`sqs send-message --queue-url ${f} --message-body x --message-group-id g`)).stderr).toContain('ContentBasedDeduplication');
    const a = await e.json(`sqs send-message --queue-url ${f} --message-body uno --message-group-id g --message-deduplication-id d1`);
    const dup = await e.json(`sqs send-message --queue-url ${f} --message-body uno --message-group-id g --message-deduplication-id d1`);
    expect(dup.MessageId).toBe(a.MessageId);
    await e.run(`sqs send-message --queue-url ${f} --message-body dos --message-group-id g --message-deduplication-id d2`);
    // mientras el primero está en vuelo, el segundo del mismo grupo no se entrega
    expect((await e.json(`sqs receive-message --queue-url ${f} --max-number-of-messages 10`)).Messages.map((m: any) => m.Body)).toEqual(['uno', 'dos'].slice(0, 2));
  });
});

describe('SNS', () => {
  test('fan-out a dos colas con filtros, y la trampa de la política de la cola', async () => {
    const e = mkEnv();
    const topic = (await e.json('sns create-topic --name pedidos')).TopicArn;
    const qa = (await e.json('sqs create-queue --queue-name facturas')).QueueUrl;
    const qb = (await e.json('sqs create-queue --queue-name envios')).QueueUrl;
    const arnOf = (u: string) => e.json(`sqs get-queue-attributes --queue-url ${u} --attribute-names QueueArn --query Attributes.QueueArn`);
    const [aa, ab] = [await arnOf(qa), await arnOf(qb)];
    await e.run(`sns subscribe --topic-arn ${topic} --protocol sqs --notification-endpoint ${aa}`);
    await e.run(`sns subscribe --topic-arn ${topic} --protocol sqs --notification-endpoint ${ab} --attributes '{"FilterPolicy":"{\\"tipo\\":[\\"fisico\\"]}","RawMessageDelivery":"true"}'`);
    await e.run(`sns publish --topic-arn ${topic} --message '{"id":1}' --message-attributes '{"tipo":{"DataType":"String","StringValue":"fisico"}}'`);
    // sin política en la cola, SNS no puede entregar
    expect((await e.run(`sqs receive-message --queue-url ${qa}`)).stdout).toBe('');
    const pol = (arn: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: arn, Condition: { ArnEquals: { 'aws:SourceArn': topic } } }] });
    await e.run(`sqs set-queue-attributes --queue-url ${qa} --attributes '{"Policy":${JSON.stringify(pol(aa))}}'`);
    await e.run(`sqs set-queue-attributes --queue-url ${qb} --attributes '{"Policy":${JSON.stringify(pol(ab))}}'`);
    await e.run(`sns publish --topic-arn ${topic} --message hola --subject Aviso --message-attributes '{"tipo":{"DataType":"String","StringValue":"fisico"}}'`);
    await e.run(`sns publish --topic-arn ${topic} --message digital --message-attributes '{"tipo":{"DataType":"String","StringValue":"digital"}}'`);
    const a = (await e.json(`sqs receive-message --queue-url ${qa} --max-number-of-messages 10`)).Messages.map((m: any) => JSON.parse(m.Body));
    expect(a.map((x: any) => x.Message)).toEqual(['hola', 'digital']);
    expect(a[0].Type).toBe('Notification');
    expect(a[0].Subject).toBe('Aviso');
    expect(a[0].MessageAttributes.tipo).toEqual({ Type: 'String', Value: 'fisico' });
    // la segunda cola solo recibe lo «fisico» y en bruto
    expect((await e.json(`sqs receive-message --queue-url ${qb} --max-number-of-messages 10`)).Messages.map((m: any) => m.Body)).toEqual(['hola']);
    expect(await e.json(`sns list-subscriptions-by-topic --topic-arn ${topic} --query "length(Subscriptions)"`)).toBe(2);
    const sub = await e.json(`sns list-subscriptions-by-topic --topic-arn ${topic} --query "Subscriptions[1].SubscriptionArn"`);
    expect((await e.json(`sns get-subscription-attributes --subscription-arn ${sub} --query Attributes.RawMessageDelivery`))).toBe('true');
    expect((await e.run(`sns subscribe --topic-arn ${topic} --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:123456789012:no-existe`)).stderr).toContain('InvalidParameter');
    expect((await e.json(`sns subscribe --topic-arn ${topic} --protocol email --notification-endpoint yo@ejemplo.com`)).SubscriptionArn).toBe('pending confirmation');
  });
});

describe('Lambda: crear y validar', () => {
  test('validaciones del rol, el runtime y el código', async () => {
    const e = mkEnv();
    const ec2Role = await role(e, 'solo-ec2', [], 'ec2.amazonaws.com');
    e.write('f.zip', zip({ 'lambda_function.py': 'def lambda_handler(e, c): return 1' }));
    const base = `lambda create-function --function-name f --runtime python3.12 --handler lambda_function.lambda_handler --zip-file fileb://f.zip`;
    expect((await e.run(`${base} --role ${ec2Role}`)).stderr).toContain('The role defined for the function cannot be assumed by Lambda.');
    expect((await e.run(`${base} --role arn:aws:iam::123456789012:role/no-existe`)).stderr).toContain('cannot be assumed by Lambda');
    const ok = await role(e, 'ok');
    expect((await e.run(`${base.replace('python3.12', 'python3.7')} --role ${ok}`)).stderr).toContain('python3.7 is no longer supported');
    expect((await e.run(`${base.replace('python3.12', 'python9')} --role ${ok}`)).stderr).toContain('enum value set');
    expect((await e.run(`${base.replace('--function-name f', '--function-name "mala funcion"')} --role ${ok}`)).stderr).toContain('functionName');
    e.write('roto.zip', 'esto no es un zip');
    expect((await e.run(`${base.replace('f.zip', 'roto.zip')} --role ${ok}`)).stderr).toContain('Could not unzip');
    expect((await e.run(`${base} --role ${ok} --timeout 1000`)).stderr).toContain('timeout');
    expect((await e.run(`${base} --role ${ok} --memory-size 64`)).stderr).toContain('memorySize');
    const f = await e.json(`${base} --role ${ok} --timeout 10 --memory-size 256 --environment Variables={TABLA=pedidos,MODO=prod}`);
    expect(f.FunctionArn).toBe('arn:aws:lambda:us-east-1:123456789012:function:f');
    expect(f.MemorySize).toBe(256);
    expect(f.Environment.Variables).toEqual({ TABLA: 'pedidos', MODO: 'prod' });
    expect((await e.run(`${base} --role ${ok}`)).stderr).toContain('ResourceConflictException');
    expect(await e.json('lambda list-functions --query "Functions[].FunctionName"')).toEqual(['f']);
    expect((await e.run('lambda get-function --function-name nada')).stderr).toContain('Function not found: arn:aws:lambda:us-east-1:123456789012:function:nada');
    await e.run('lambda delete-function --function-name f');
    expect(await e.json('lambda list-functions --query "length(Functions)"')).toBe(0);
  });
});

describe('Lambda: ejecutar', () => {
  test('payload en base64 (CLI v2), evento, contexto, entorno y registros', async () => {
    const e = mkEnv();
    await fn(e, 'saluda', `
import os, json
print('arrancando')
def lambda_handler(event, context):
    print('evento:', event)
    return {'hola': event.get('nombre', 'mundo'), 'tabla': os.environ['TABLA'], 'fn': context.function_name, 'mem': context.memory_limit_in_mb, 'resta': context.get_remaining_time_in_millis() > 2000, 'region': os.environ['AWS_REGION']}
`, { extra: '--environment Variables={TABLA=pedidos}' });
    // sin --cli-binary-format, el JSON en crudo falla
    const bad = await e.run(`lambda invoke --function-name saluda --payload '{"nombre":"Ana"}' /dev/stdout`);
    expect(bad.stderr).toContain('Invalid base64');
    expect(bad.code).toBe(252);
    // en base64 funciona sin el flag
    const b64 = btoa('{"nombre":"Luis"}');
    const viaB64 = await e.run(`lambda invoke --function-name saluda --payload ${b64} /dev/stdout`);
    expect(JSON.parse(split(viaB64.stdout).payload).hola).toBe('Luis');
    const r = await invoke(e, 'saluda', { nombre: 'Ana' });
    const body = JSON.parse(r.payload);
    expect(body).toEqual({ hola: 'Ana', tabla: 'pedidos', fn: 'saluda', mem: '128', resta: true, region: 'us-east-1' });
    expect(r.stdout).toContain('"StatusCode": 200');
    expect(r.stdout).toContain('"ExecutedVersion": "$LATEST"');
    // los registros llegan a CloudWatch: START, prints, END y REPORT; el primero (arranque en frío) lleva Init Duration
    const logs = await logsOf(e, 'saluda');
    expect(logs.some((l) => l.startsWith('START RequestId:'))).toBe(true);
    expect(logs).toContain('arrancando');
    expect(logs.some((l) => l.includes("evento: {'nombre': 'Luis'}"))).toBe(true);
    const reports = logs.filter((l) => l.startsWith('REPORT'));
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatch(/Duration: [\d.]+ ms\tBilled Duration: \d+ ms\tMemory Size: 128 MB\tMax Memory Used: \d+ MB\tInit Duration: [\d.]+ ms/);
    expect(reports[1]).not.toContain('Init Duration');
    // --log-type Tail devuelve los registros en base64
    const tail = await e.json('lambda invoke --function-name saluda --cli-binary-format raw-in-base64-out --payload "{}" --log-type Tail /tmp/out.json');
    expect(atob(tail.LogResult)).toContain('REPORT RequestId');
    expect((await e.run('lambda invoke --function-name saluda --cli-binary-format raw-in-base64-out --payload "{no" /dev/stdout')).stderr).toContain('InvalidRequestContentException');
    expect((await e.run('lambda invoke --function-name nada --cli-binary-format raw-in-base64-out /dev/stdout')).stderr).toContain('ResourceNotFoundException');
  });

  test('errores del código, del handler y de los módulos', async () => {
    const e = mkEnv();
    await fn(e, 'falla', "def lambda_handler(event, context):\n    return event['clave']\n");
    const r = await invoke(e, 'falla', { otra: 1 });
    expect(r.stdout).toContain('"FunctionError": "Unhandled"');
    const err = JSON.parse(r.payload);
    expect(err.errorType).toBe('KeyError');
    expect(err.errorMessage).toBe("'clave'");
    expect(err.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await logsOf(e, 'falla')).some((l) => l.startsWith("[ERROR] KeyError: 'clave'"))).toBe(true);
    await fn(e, 'sin-handler', 'x = 1\n', { handler: 'lambda_function.no_existe' });
    expect((await invoke(e, 'sin-handler')).payload).toContain("Handler 'no_existe' missing on module 'lambda_function'");
    await fn(e, 'sin-modulo', 'x = 1\n', { handler: 'otro_modulo.handler' });
    expect((await invoke(e, 'sin-modulo')).payload).toContain("Unable to import module 'otro_modulo'");
    await fn(e, 'sintaxis', 'def lambda_handler(e, c)\n    return 1\n');
    expect((await invoke(e, 'sintaxis')).stdout).toContain('Runtime.UserCodeSyntaxError');
    await fn(e, 'decimal', "from decimal import Decimal\ndef lambda_handler(e, c):\n    return {'n': Decimal('1.5')}\n");
    expect((await invoke(e, 'decimal')).payload).toContain('Unable to marshal response: Object of type Decimal is not JSON serializable');
  });

  test('timeout, memoria y duración facturada', async () => {
    const e = mkEnv();
    await fn(e, 'lento', "import time\ndef lambda_handler(e, c):\n    time.sleep(5)\n    return 'ok'\n", { extra: '--timeout 3' });
    const r = await invoke(e, 'lento');
    expect(r.payload).toContain('Task timed out after 3.00 seconds');
    expect(r.stdout).toContain('"FunctionError": "Unhandled"');
    await e.run('lambda update-function-configuration --function-name lento --timeout 10');
    expect((await invoke(e, 'lento')).payload).toBe('"ok"');
    const rep = (await logsOf(e, 'lento')).filter((l) => l.startsWith('REPORT')).at(-1)!;
    expect(Number(/Duration: ([\d.]+) ms/.exec(rep)![1])).toBeGreaterThan(5000);
    // la CPU es proporcional a la memoria: el mismo trabajo tarda menos con más memoria
    const work = "def lambda_handler(e, c):\n    t = 0\n    for i in range(60000):\n        t += i * i\n    return t\n";
    await fn(e, 'calculo', work, { extra: '--timeout 60' });
    const dur = async () => Number(/Duration: ([\d.]+) ms/.exec((await logsOf(e, 'calculo')).filter((l) => l.startsWith('REPORT')).at(-1)!)![1]);
    await invoke(e, 'calculo');
    const small = await dur();
    await e.run('lambda update-function-configuration --function-name calculo --memory-size 1769');
    await invoke(e, 'calculo');
    const big = await dur();
    expect(small).toBeGreaterThan(big * 8);
    // un bucle infinito se corta por timeout
    await fn(e, 'infinito', 'def lambda_handler(e, c):\n    while True:\n        pass\n', { extra: '--timeout 1' });
    expect((await invoke(e, 'infinito')).payload).toContain('Task timed out after 1.00 seconds');
  });

  test('arranque en frío, entorno caliente y reinicio al cambiar el código', async () => {
    const e = mkEnv();
    await fn(e, 'cuenta', "n = 0\ndef lambda_handler(event, context):\n    global n\n    n += 1\n    return n\n");
    const num = async () => Number((await invoke(e, 'cuenta')).payload);
    expect(await num()).toBe(1);
    expect(await num()).toBe(2);
    // pasados 10 minutos sin uso, el entorno se descarta
    e.acct.clock += 10 * 60000;
    expect(await num()).toBe(1);
    expect(await num()).toBe(2);
    e.write('cuenta.zip', zip({ 'lambda_function.py': "n = 100\ndef lambda_handler(event, context):\n    global n\n    n += 1\n    return n\n" }));
    await e.run('lambda update-function-code --function-name cuenta --zip-file fileb://cuenta.zip');
    expect(await num()).toBe(101);
    const inits = (await logsOf(e, 'cuenta')).filter((l) => l.includes('Init Duration'));
    expect(inits).toHaveLength(3);
  });

  test('boto3 dentro de Lambda: DynamoDB con los permisos del rol', async () => {
    const e = mkEnv();
    await e.run('dynamodb create-table --table-name pedidos --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST');
    const code = `
import boto3, os, json
from decimal import Decimal
t = boto3.resource('dynamodb').Table(os.environ['TABLA'])
def lambda_handler(event, context):
    if event.get('accion') == 'leer':
        it = t.get_item(Key={'id': event['id']}).get('Item')
        return {'item': json.loads(json.dumps(it, default=str))}
    t.put_item(Item={'id': event['id'], 'total': Decimal(str(event['total']))})
    return {'guardado': event['id']}
`;
    const noPerm = await role(e, 'sin-ddb');
    await fn(e, 'pedidos-api', code, { role: noPerm, extra: '--environment Variables={TABLA=pedidos}' });
    const denied = JSON.parse((await invoke(e, 'pedidos-api', { id: 'p1', total: 9.5 })).payload);
    expect(denied.errorType).toBe('ClientError');
    expect(denied.errorMessage).toContain('is not authorized to perform: dynamodb:PutItem');
    expect(denied.errorMessage).toContain('assumed-role/sin-ddb/pedidos-api');
    await e.run('iam attach-role-policy --role-name sin-ddb --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess');
    const ok = JSON.parse((await invoke(e, 'pedidos-api', { id: 'p1', total: 9.5 })).payload);
    expect(ok).toEqual({ guardado: 'p1' });
    const rd = (await invoke(e, 'pedidos-api', { accion: 'leer', id: 'p1' })).payload;
    expect(JSON.parse(rd).item).toEqual({ id: 'p1', total: '9.5' });
    expect(await e.json('dynamodb scan --table-name pedidos --query "Items[0].total.N"')).toBe('9.5');
  });

  test('sin permisos de CloudWatch Logs no se escriben registros', async () => {
    const e = mkEnv();
    const r = await role(e, 'mudo', []);
    await fn(e, 'silencio', "def lambda_handler(e, c):\n    print('no se ve')\n    return 1\n", { role: r });
    expect((await invoke(e, 'silencio')).stdout).toContain('"StatusCode": 200');
    expect((await e.run('logs describe-log-groups --log-group-name-prefix /aws/lambda/silencio --query "length(logGroups)"')).stdout.trim()).toBe('0');
    await e.run('iam attach-role-policy --role-name mudo --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
    await invoke(e, 'silencio');
    expect((await logsOf(e, 'silencio')).some((l) => l === 'no se ve')).toBe(true);
  });
});

describe('Lambda: versiones, alias, permisos y concurrencia', () => {
  test('versiones inmutables y alias que se mueven', async () => {
    const e = mkEnv();
    await fn(e, 'v', "def lambda_handler(e, c):\n    return 'uno'\n");
    const v1 = await e.json('lambda publish-version --function-name v');
    expect(v1.Version).toBe('1');
    expect((await e.json('lambda publish-version --function-name v')).Version).toBe('1');
    e.write('v2.zip', zip({ 'lambda_function.py': "def lambda_handler(e, c):\n    return 'dos'\n" }));
    await e.run('lambda update-function-code --function-name v --zip-file fileb://v2.zip');
    expect((await e.json('lambda publish-version --function-name v')).Version).toBe('2');
    await e.run('lambda create-alias --function-name v --name prod --function-version 1');
    expect((await e.run('lambda create-alias --function-name v --name prod --function-version 2')).stderr).toContain('Alias already exists');
    expect((await invoke(e, 'v', {}, '--qualifier prod')).payload).toBe('"uno"');
    expect((await invoke(e, 'v')).payload).toBe('"dos"');
    await e.run('lambda update-alias --function-name v --name prod --function-version 2');
    expect((await invoke(e, 'v', {}, '--qualifier prod')).payload).toBe('"dos"');
    expect(await e.json('lambda list-versions-by-function --function-name v --query "Versions[].Version"')).toEqual(['$LATEST', '1', '2']);
    expect((await e.run('lambda invoke --function-name v --qualifier 9 --cli-binary-format raw-in-base64-out /dev/stdout')).stderr).toContain('Function not found');
    // concurrencia aprovisionada: solo en versiones o alias (no en $LATEST) y sin arranque en frío
    expect((await e.run('lambda put-provisioned-concurrency-config --function-name v --qualifier $LATEST --provisioned-concurrent-executions 2')).stderr).toContain('unpublished function versions');
    await e.run('lambda put-provisioned-concurrency-config --function-name v --qualifier prod --provisioned-concurrent-executions 2');
    expect(await e.json('lambda get-provisioned-concurrency-config --function-name v --qualifier prod --query Status')).toBe('READY');
  });

  test('permisos de recursos y concurrencia reservada', async () => {
    const e = mkEnv();
    await fn(e, 'p', "def lambda_handler(e, c):\n    return 1\n");
    expect((await e.run('lambda get-policy --function-name p')).stderr).toContain('ResourceNotFoundException');
    const st = await e.json('lambda add-permission --function-name p --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:us-east-1:123456789012:abc/*"');
    expect(JSON.parse(st.Statement).Principal).toEqual({ Service: 'apigateway.amazonaws.com' });
    expect((await e.run('lambda add-permission --function-name p --statement-id apigw --action lambda:InvokeFunction --principal sns.amazonaws.com')).stderr).toContain('already exists');
    expect(JSON.parse(await e.json('lambda get-policy --function-name p --query Policy')).Statement).toHaveLength(1);
    await e.run('lambda remove-permission --function-name p --statement-id apigw');
    // reservada = 0 desactiva la función (todas las invocaciones se rechazan)
    await e.run('lambda put-function-concurrency --function-name p --reserved-concurrent-executions 0');
    expect((await e.run('lambda invoke --function-name p --cli-binary-format raw-in-base64-out /dev/stdout')).stderr).toContain('TooManyRequestsException');
    await e.run('lambda delete-function-concurrency --function-name p');
    expect((await invoke(e, 'p')).stdout).toContain('"StatusCode": 200');
    expect((await e.run('lambda put-function-concurrency --function-name p --reserved-concurrent-executions 950')).stderr).toContain('UnreservedConcurrentExecution');
    expect(await e.json('lambda get-account-settings --query AccountLimit.ConcurrentExecutions')).toBe(1000);
  });
});

describe('Lambda: colas, asíncronas y destinos', () => {
  test('SQS → Lambda con lotes, fallos parciales y cola de mensajes muertos', async () => {
    const e = mkEnv();
    const dlq = (await e.json('sqs create-queue --queue-name trabajos-dlq')).QueueUrl;
    const dlqArn = await e.json(`sqs get-queue-attributes --queue-url ${dlq} --attribute-names QueueArn --query Attributes.QueueArn`);
    const rp = JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 2 });
    const q = (await e.json(`sqs create-queue --queue-name trabajos --attributes '{"VisibilityTimeout":"30","RedrivePolicy":${JSON.stringify(rp)}}'`)).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    const code = "import json\ndef lambda_handler(event, context):\n    fallos = []\n    for r in event['Records']:\n        d = json.loads(r['body'])\n        print('procesando', d['id'])\n        if d.get('roto'):\n            fallos.append({'itemIdentifier': r['messageId']})\n    return {'batchItemFailures': fallos}\n";
    const noSqs = await role(e, 'sin-sqs');
    await fn(e, 'worker', code, { role: noSqs });
    // el rol sin permisos de SQS no puede crear el mapeo
    expect((await e.run(`lambda create-event-source-mapping --function-name worker --event-source-arn ${qArn}`)).stderr).toContain('does not have permissions to call ReceiveMessage on SQS');
    await e.run('iam attach-role-policy --role-name sin-sqs --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole');
    await e.run('lambda update-function-configuration --function-name worker --timeout 60');
    expect((await e.run(`lambda create-event-source-mapping --function-name worker --event-source-arn ${qArn}`)).stderr).toContain('Queue visibility timeout: 30 seconds is less than Function timeout: 60 seconds');
    await e.run('lambda update-function-configuration --function-name worker --timeout 10');
    const m = await e.json(`lambda create-event-source-mapping --function-name worker --event-source-arn ${qArn} --batch-size 5 --function-response-types ReportBatchItemFailures`);
    expect(m.State).toBe('Creating');
    expect((await e.run(`lambda create-event-source-mapping --function-name worker --event-source-arn ${qArn}`)).stderr).toContain('already exists');
    for (const b of ['{"id":1}', '{"id":2,"roto":true}', '{"id":3}']) await e.run(`sqs send-message --queue-url ${q} --message-body '${b}'`);
    // las llamadas de la CLI hacen avanzar el reloj: Lambda ya ha leído la cola
    const logs = await logsOf(e, 'worker');
    expect(logs).toContain('procesando 1');
    expect(logs).toContain('procesando 3');
    // el mensaje roto no se borró: vuelve tras la visibilidad y acaba en la DLQ
    for (let i = 0; i < 4; i++) {
      e.acct.clock += 31000;
      await e.run('sqs list-queues');
    }
    expect((await logsOf(e, 'worker')).filter((l) => l === 'procesando 2').length).toBe(2);
    const dead = (await e.json(`sqs receive-message --queue-url ${dlq}`)).Messages;
    expect(dead).toHaveLength(1);
    expect(JSON.parse(dead[0].Body)).toEqual({ id: 2, roto: true });
    expect(await e.json('lambda list-event-source-mappings --query "EventSourceMappings[0].BatchSize"')).toBe(5);
    await e.run(`lambda delete-event-source-mapping --uuid ${m.UUID}`);
    expect(await e.json('lambda list-event-source-mappings --query "length(EventSourceMappings)"')).toBe(0);
  });

  test('invocación asíncrona: reintentos y destino de error', async () => {
    const e = mkEnv();
    const q = (await e.json('sqs create-queue --queue-name fallos')).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    await fn(e, 'asinc', "def lambda_handler(event, context):\n    print('intento')\n    raise ValueError('malo')\n");
    await e.run(`lambda put-function-event-invoke-config --function-name asinc --maximum-retry-attempts 1 --destination-config '{"OnFailure":{"Destination":"${qArn}"}}'`);
    const r = await e.run('lambda invoke --function-name asinc --invocation-type Event --cli-binary-format raw-in-base64-out --payload \'{"x":1}\' /tmp/o.json');
    expect(r.stdout).toContain('"StatusCode": 202');
    expect((await logsOf(e, 'asinc')).filter((l) => l === 'intento')).toHaveLength(2);
    const msg = JSON.parse((await e.json(`sqs receive-message --queue-url ${q}`)).Messages[0].Body);
    expect(msg.requestContext.condition).toBe('RetriesExhausted');
    expect(msg.requestPayload).toEqual({ x: 1 });
    expect(msg.responsePayload.errorType).toBe('ValueError');
    expect(await e.json('lambda get-function-event-invoke-config --function-name asinc --query MaximumRetryAttempts')).toBe(1);
    expect((await e.run('lambda put-function-event-invoke-config --function-name asinc --maximum-retry-attempts 5')).stderr).toContain('maximumRetryAttempts');
    expect((await e.run('lambda invoke --function-name asinc --invocation-type Raro --cli-binary-format raw-in-base64-out /tmp/o.json')).stderr).toContain('invocationType');
  });

  test('SNS → Lambda necesita permiso en la política de la función', async () => {
    const e = mkEnv();
    const topic = (await e.json('sns create-topic --name avisos')).TopicArn;
    await fn(e, 'oyente', "def lambda_handler(event, context):\n    print('SNS dice:', event['Records'][0]['Sns']['Message'])\n");
    await e.run(`sns subscribe --topic-arn ${topic} --protocol lambda --notification-endpoint arn:aws:lambda:us-east-1:123456789012:function:oyente`);
    await e.run(`sns publish --topic-arn ${topic} --message uno`);
    expect((await e.run('logs describe-log-groups --log-group-name-prefix /aws/lambda/oyente --query "length(logGroups)"')).stdout.trim()).toBe('0');
    await e.run(`lambda add-permission --function-name oyente --statement-id sns --action lambda:InvokeFunction --principal sns.amazonaws.com --source-arn ${topic}`);
    await e.run(`sns publish --topic-arn ${topic} --message dos`);
    expect((await logsOf(e, 'oyente'))).toContain('SNS dice: dos');
  });
});
