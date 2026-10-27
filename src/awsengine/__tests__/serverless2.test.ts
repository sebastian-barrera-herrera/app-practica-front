import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });

async function role(e: TestEnv, name: string, svc: string, policies: string[] = []) {
  e.write(`${name}.json`, TRUST(svc));
  const r = await e.json(`iam create-role --role-name ${name} --assume-role-policy-document file://${name}.json`);
  for (const p of policies) await e.run(`iam attach-role-policy --role-name ${name} --policy-arn arn:aws:iam::aws:policy/${p}`);
  return r.Role.Arn as string;
}
async function fn(e: TestEnv, name: string, code: string) {
  e.write(`${name}.zip`, zip({ 'lambda_function.py': code }));
  const r = await role(e, `${name}-role`, 'lambda.amazonaws.com', ['service-role/AWSLambdaBasicExecutionRole']);
  await e.json(`lambda create-function --function-name ${name} --runtime python3.12 --role ${r} --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip`);
  return `arn:aws:lambda:us-east-1:123456789012:function:${name}`;
}
const logsOf = async (e: TestEnv, name: string) => (await e.json(`logs filter-log-events --log-group-name /aws/lambda/${name} --query "events[].message"`)) as string[];
const hasLog = async (e: TestEnv, name: string, text: string) => {
  const r = await e.run(`logs filter-log-events --log-group-name /aws/lambda/${name} --query "events[].message"`);
  return r.code === 0 && r.stdout.includes(text);
};

describe('EventBridge', () => {
  test('patrones: igualdad, prefijo, numéricos, anything-but y exists', async () => {
    const e = mkEnv();
    const ev = (d: unknown, src = 'tienda.pedidos', type = 'PedidoCreado') => JSON.stringify({ source: src, 'detail-type': type, detail: d, region: 'us-east-1' });
    const t = async (pat: unknown, event: string) => (await e.json(`events test-event-pattern --event-pattern '${JSON.stringify(pat)}' --event '${event}' --query Result`)) as boolean;
    expect(await t({ source: ['tienda.pedidos'] }, ev({}))).toBe(true);
    expect(await t({ source: ['otra'] }, ev({}))).toBe(false);
    expect(await t({ detail: { total: [{ numeric: ['>', 100] }] } }, ev({ total: 150 }))).toBe(true);
    expect(await t({ detail: { total: [{ numeric: ['>', 100, '<=', 200] }] } }, ev({ total: 250 }))).toBe(false);
    expect(await t({ detail: { pais: [{ 'anything-but': ['ES'] }] } }, ev({ pais: 'FR' }))).toBe(true);
    expect(await t({ detail: { pais: [{ 'anything-but': ['ES'] }] } }, ev({ pais: 'ES' }))).toBe(false);
    expect(await t({ detail: { cliente: { vip: [true] } } }, ev({ cliente: { vip: true } }))).toBe(true);
    expect(await t({ detail: { cupon: [{ exists: false }] } }, ev({ total: 1 }))).toBe(true);
    expect(await t({ 'detail-type': [{ prefix: 'Pedido' }] }, ev({}))).toBe(true);
    expect((await e.run(`events test-event-pattern --event-pattern '[1]' --event '{}'`)).stderr).toContain('InvalidEventPatternException');
  });

  test('regla → Lambda: necesita permiso; put-events solo entrega lo que coincide', async () => {
    const e = mkEnv();
    const arn = await fn(e, 'procesa', "def lambda_handler(event, context):\n    print('recibido', event['detail']['id'], event['source'])\n");
    const rule = (await e.json(`events put-rule --name pedidos-grandes --event-pattern '{"source":["tienda.pedidos"],"detail":{"total":[{"numeric":[">",100]}]}}'`)).RuleArn;
    expect(rule).toBe('arn:aws:events:us-east-1:123456789012:rule/pedidos-grandes');
    await e.run(`events put-targets --rule pedidos-grandes --targets Id=1,Arn=${arn}`);
    const put = (id: number, total: number) => e.json(`events put-events --entries '[{"Source":"tienda.pedidos","DetailType":"PedidoCreado","Detail":"{\\"id\\":${id},\\"total\\":${total}}"}]'`);
    const r1 = await put(1, 500);
    expect(r1.FailedEntryCount).toBe(0);
    // sin permiso en la política de la función, EventBridge no puede invocarla
    expect(await hasLog(e, 'procesa', 'recibido')).toBe(false);
    await e.run(`lambda add-permission --function-name procesa --statement-id eventos --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn ${rule}`);
    await put(2, 500);
    await put(3, 20);
    expect(await hasLog(e, 'procesa', 'recibido 2 tienda.pedidos')).toBe(true);
    expect(await hasLog(e, 'procesa', 'recibido 3')).toBe(false);
    expect((await e.json('events put-events --entries \'[{"Source":"x","DetailType":"y","Detail":"{no"}]\'')).FailedEntryCount).toBe(1);
    expect((await e.run('events delete-rule --name pedidos-grandes')).stderr).toContain("Rule can't be deleted since it has targets");
    await e.run('events disable-rule --name pedidos-grandes');
    await put(4, 900);
    expect(await hasLog(e, 'procesa', 'recibido 4')).toBe(false);
    await e.run('events remove-targets --rule pedidos-grandes --ids 1');
    await e.run('events delete-rule --name pedidos-grandes');
    expect(await e.json('events list-rules --query "length(Rules)"')).toBe(0);
  });

  test('reglas con programación y destinos SQS con InputTransformer', async () => {
    const e = mkEnv();
    const arn = await fn(e, 'cada5', "def lambda_handler(event, context):\n    print('tic', event['detail-type'])\n");
    expect((await e.run("events put-rule --name mala --schedule-expression 'rate(1 minutes)'")).stderr).toContain('ScheduleExpression is not valid');
    expect((await e.run('events put-rule --name vacia')).stderr).toContain('EventPattern or ScheduleExpression');
    const rule = (await e.json("events put-rule --name cada5 --schedule-expression 'rate(5 minutes)'")).RuleArn;
    await e.run(`events put-targets --rule cada5 --targets Id=1,Arn=${arn}`);
    await e.run(`lambda add-permission --function-name cada5 --statement-id ev --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn ${rule}`);
    e.acct.clock += 16 * 60000;
    await e.run('events list-rules');
    const tics = (await logsOf(e, 'cada5')).filter((l) => l === 'tic Scheduled Event');
    expect(tics).toHaveLength(3);
    // cola como destino: necesita política que admita a EventBridge
    const q = (await e.json('sqs create-queue --queue-name avisos')).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    const r2 = (await e.json(`events put-rule --name altas --event-pattern '{"source":["app"]}'`)).RuleArn;
    await e.run(`events put-targets --rule altas --targets '[{"Id":"q","Arn":"${qArn}","InputTransformer":{"InputPathsMap":{"quien":"$.detail.usuario"},"InputTemplate":"{\\"hola\\":\\"<quien>\\"}"}}]'`);
    await e.run(`events put-events --entries '[{"Source":"app","DetailType":"Alta","Detail":"{\\"usuario\\":\\"ana\\"}"}]'`);
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout).toBe('');
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qArn, Condition: { ArnEquals: { 'aws:SourceArn': r2 } } }] });
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes '{"Policy":${JSON.stringify(pol)}}'`);
    await e.run(`events put-events --entries '[{"Source":"app","DetailType":"Alta","Detail":"{\\"usuario\\":\\"luis\\"}"}]'`);
    expect(JSON.parse((await e.json(`sqs receive-message --queue-url ${q}`)).Messages[0].Body)).toEqual({ hola: 'luis' });
  });
});

describe('Step Functions', () => {
  const MACHINE = (arnA: string, arnB: string) =>
    JSON.stringify({
      Comment: 'pedido',
      StartAt: 'Validar',
      States: {
        Validar: { Type: 'Task', Resource: arnA, ResultPath: '$.validacion', Retry: [{ ErrorEquals: ['ValueError'], IntervalSeconds: 1, MaxAttempts: 2 }], Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'Rechazar' }], Next: 'Decidir' },
        Decidir: { Type: 'Choice', Choices: [{ Variable: '$.total', NumericGreaterThan: 100, Next: 'Esperar' }], Default: 'Cobrar' },
        Esperar: { Type: 'Wait', Seconds: 30, Next: 'Cobrar' },
        Cobrar: { Type: 'Task', Resource: arnB, Parameters: { 'total.$': '$.total', 'cliente.$': '$.cliente', fijo: 'x' }, ResultPath: '$.cobro', End: true },
        Rechazar: { Type: 'Fail', Error: 'PedidoRechazado', Cause: 'Datos no válidos' },
      },
    });

  test('Task, Choice, Wait, Retry/Catch y el estado RUNNING mientras espera', async () => {
    const e = mkEnv();
    const validar = await fn(e, 'validar', "def lambda_handler(event, context):\n    if event['total'] < 0:\n        raise ValueError('total negativo')\n    return {'ok': True}\n");
    const cobrar = await fn(e, 'cobrar', "def lambda_handler(event, context):\n    return {'cobrado': event['total'], 'a': event['cliente'], 'fijo': event['fijo']}\n");
    const sfnRole = await role(e, 'sfn-role', 'states.amazonaws.com', ['service-role/AWSLambdaRole']);
    const badRole = await role(e, 'rol-malo', 'lambda.amazonaws.com');
    expect((await e.run(`stepfunctions create-state-machine --name x --definition '{"StartAt":"A"}' --role-arn ${sfnRole}`)).stderr).toContain('InvalidDefinition');
    expect((await e.run(`stepfunctions create-state-machine --name x --definition '{"StartAt":"A","States":{"A":{"Type":"Pass","Next":"B"}}}' --role-arn ${sfnRole}`)).stderr).toContain('MISSING_TRANSITION_TARGET');
    expect((await e.run(`stepfunctions create-state-machine --name x --definition '${MACHINE(validar, cobrar)}' --role-arn ${badRole}`)).stderr).toContain('does not trust states.amazonaws.com');
    const sm = (await e.json(`stepfunctions create-state-machine --name pedido --definition '${MACHINE(validar, cobrar)}' --role-arn ${sfnRole}`)).stateMachineArn;
    expect(sm).toBe('arn:aws:states:us-east-1:123456789012:stateMachine:pedido');
    // total pequeño: sin espera
    const ex1 = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"total":50,"cliente":"ana"}'`)).executionArn;
    const d1 = await e.json(`stepfunctions describe-execution --execution-arn ${ex1}`);
    expect(d1.status).toBe('SUCCEEDED');
    expect(JSON.parse(d1.output).cobro).toEqual({ cobrado: 50, a: 'ana', fijo: 'x' });
    expect(JSON.parse(d1.output).validacion).toEqual({ ok: true });
    // total grande: pasa por Wait y está RUNNING hasta que pasen 30 s
    const ex2 = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"total":500,"cliente":"luis"}'`)).executionArn;
    expect((await e.json(`stepfunctions describe-execution --execution-arn ${ex2}`)).status).toBe('RUNNING');
    e.acct.clock += 31000;
    expect((await e.json(`stepfunctions describe-execution --execution-arn ${ex2} --query status`))).toBe('SUCCEEDED');
    // error: Retry (2 reintentos con ValueError) y luego Catch → estado Fail
    const ex3 = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"total":-1,"cliente":"x"}'`)).executionArn;
    e.acct.clock += 10000;
    const d3 = await e.json(`stepfunctions describe-execution --execution-arn ${ex3}`);
    expect(d3.status).toBe('FAILED');
    expect(d3.error).toBe('PedidoRechazado');
    const hist = await e.json(`stepfunctions get-execution-history --execution-arn ${ex3} --query "events[].type"`);
    expect(hist.filter((t: string) => t === 'TaskStateRetried')).toHaveLength(2);
    expect(hist[0]).toBe('ExecutionStarted');
    expect(hist.at(-1)).toBe('ExecutionFailed');
    expect(await e.json(`stepfunctions list-executions --state-machine-arn ${sm} --status-filter FAILED --query "length(executions)"`)).toBe(1);
    expect((await e.run(`stepfunctions start-execution --state-machine-arn ${sm} --name ${ex3.split(':').pop()} --input '{}'`)).stderr).toContain('ExecutionAlreadyExists');
    expect((await e.run(`stepfunctions describe-execution --execution-arn ${sm.replace('stateMachine', 'execution')}:nada`)).stderr).toContain('ExecutionDoesNotExist');
  });

  test('permisos del rol, Parallel, Map y la integración con SQS/DynamoDB', async () => {
    const e = mkEnv();
    const doble = await fn(e, 'doble', "def lambda_handler(event, context):\n    return event * 2\n");
    await e.run('dynamodb create-table --table-name registros --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST');
    const q = (await e.json('sqs create-queue --queue-name salida')).QueueUrl;
    const def = JSON.stringify({
      StartAt: 'EnParalelo',
      States: {
        EnParalelo: {
          Type: 'Parallel',
          Branches: [
            { StartAt: 'Dobles', States: { Dobles: { Type: 'Map', ItemsPath: '$.numeros', ItemProcessor: { StartAt: 'D', States: { D: { Type: 'Task', Resource: doble, End: true } } }, End: true } } },
            { StartAt: 'Guardar', States: { Guardar: { Type: 'Task', Resource: 'arn:aws:states:::dynamodb:putItem', Parameters: { TableName: 'registros', Item: { 'id': { 'S.$': '$.id' } } }, ResultPath: null, End: true } } },
          ],
          ResultPath: '$.res',
          Next: 'Avisar',
        },
        Avisar: { Type: 'Task', Resource: 'arn:aws:states:::sqs:sendMessage', Parameters: { QueueUrl: q, 'MessageBody.$': 'States.JsonToString($.res[0])' }, ResultPath: null, End: true },
      },
    });
    const rolSolo = await role(e, 'sfn-solo-lambda', 'states.amazonaws.com', ['service-role/AWSLambdaRole']);
    const sm = (await e.json(`stepfunctions create-state-machine --name multi --definition '${def}' --role-arn ${rolSolo}`)).stateMachineArn;
    const ex = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"numeros":[1,2,3],"id":"r1"}'`)).executionArn;
    const d = await e.json(`stepfunctions describe-execution --execution-arn ${ex}`);
    // el rol solo puede invocar Lambda: DynamoDB falla con AccessDenied
    expect(d.status).toBe('FAILED');
    expect(d.cause).toContain('is not authorized to perform: dynamodb:PutItem');
    await e.run('iam attach-role-policy --role-name sfn-solo-lambda --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess');
    await e.run('iam attach-role-policy --role-name sfn-solo-lambda --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess');
    const ex2 = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"numeros":[1,2,3],"id":"r1"}'`)).executionArn;
    const d2 = await e.json(`stepfunctions describe-execution --execution-arn ${ex2}`);
    expect(d2.status).toBe('SUCCEEDED');
    expect(JSON.parse(d2.output).res[0]).toEqual([2, 4, 6]);
    expect(await e.json('dynamodb scan --table-name registros --query "Items[0].id.S"')).toBe('r1');
    expect(JSON.parse((await e.json(`sqs receive-message --queue-url ${q}`)).Messages[0].Body)).toEqual([2, 4, 6]);
    // quitar el permiso de invocar Lambda
    await e.run('iam detach-role-policy --role-name sfn-solo-lambda --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaRole');
    const ex3 = (await e.json(`stepfunctions start-execution --state-machine-arn ${sm} --input '{"numeros":[1],"id":"r2"}'`)).executionArn;
    expect((await e.json(`stepfunctions describe-execution --execution-arn ${ex3}`)).cause).toContain('lambda:InvokeFunction');
  });
});
