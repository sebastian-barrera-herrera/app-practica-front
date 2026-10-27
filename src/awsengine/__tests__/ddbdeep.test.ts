import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
const S = (s: string) => ({ S: s });
const N = (n: number) => ({ N: String(n) });

const TABLE = `dynamodb create-table --table-name pedidos --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST`;
const put = (e: TestEnv, item: Record<string, unknown>, table = 'pedidos', region = 'us-east-1') => e.run(`dynamodb put-item --table-name ${table} --item '${JSON.stringify(item)}' --region ${region}`);

async function withTable(stream?: string) {
  const e = mkEnv();
  await e.json(TABLE + (stream ? ` --stream-specification StreamEnabled=true,StreamViewType=${stream}` : ''));
  e.acct.clock += 10000;
  return e;
}

describe('DynamoDB Streams', () => {
  test('activar el stream, leer registros con iteradores y ver los tipos de imagen', async () => {
    const e = await withTable();
    expect(await e.json('dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn')).toBeNull();
    expect((await e.run('dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=MAL')).stderr).toContain('StreamViewType');
    await e.run('dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES');
    const arn = await e.json('dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn');
    expect(arn).toMatch(/^arn:aws:dynamodb:us-east-1:123456789012:table\/pedidos\/stream\/\d{4}-/);
    expect(await e.json('dynamodbstreams list-streams --query "Streams[0].TableName"')).toBe('pedidos');
    await put(e, { id: S('1'), estado: S('nuevo') });
    await put(e, { id: S('1'), estado: S('enviado') });
    await e.run(`dynamodb delete-item --table-name pedidos --key '{"id":{"S":"1"}}'`);
    const shard = await e.json(`dynamodbstreams describe-stream --stream-arn ${arn} --query "StreamDescription.Shards[0].ShardId"`);
    const it = await e.json(`dynamodbstreams get-shard-iterator --stream-arn ${arn} --shard-id ${shard} --shard-iterator-type TRIM_HORIZON --query ShardIterator`);
    const r = await e.json(`dynamodbstreams get-records --shard-iterator ${it}`);
    expect(r.Records.map((x: any) => x.eventName)).toEqual(['INSERT', 'MODIFY', 'REMOVE']);
    expect(r.Records[1].dynamodb.OldImage.estado.S).toBe('nuevo');
    expect(r.Records[1].dynamodb.NewImage.estado.S).toBe('enviado');
    expect(r.Records[2].dynamodb.NewImage).toBeUndefined();
    // desde el siguiente puntero ya no hay nada nuevo
    const again = await e.json(`dynamodbstreams get-records --shard-iterator ${r.NextShardIterator}`);
    expect(again.Records).toHaveLength(0);
    // LATEST solo ve lo posterior
    const latest = await e.json(`dynamodbstreams get-shard-iterator --stream-arn ${arn} --shard-id ${shard} --shard-iterator-type LATEST --query ShardIterator`);
    await put(e, { id: S('2') });
    expect((await e.json(`dynamodbstreams get-records --shard-iterator ${latest}`)).Records).toHaveLength(1);
    // una actualización sin cambios no genera registro
    await put(e, { id: S('2') });
    expect((await e.json(`dynamodbstreams get-records --shard-iterator ${latest}`)).Records).toHaveLength(1);
  });

  test('KEYS_ONLY solo trae las claves', async () => {
    const e = await withTable('KEYS_ONLY');
    await put(e, { id: S('9'), x: S('y') });
    const arn = await e.json('dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn');
    const shard = await e.json(`dynamodbstreams describe-stream --stream-arn ${arn} --query "StreamDescription.Shards[0].ShardId"`);
    const it = await e.json(`dynamodbstreams get-shard-iterator --stream-arn ${arn} --shard-id ${shard} --shard-iterator-type TRIM_HORIZON --query ShardIterator`);
    const rec = (await e.json(`dynamodbstreams get-records --shard-iterator ${it}`)).Records[0];
    expect(rec.dynamodb.Keys).toEqual({ id: S('9') });
    expect(rec.dynamodb.NewImage).toBeUndefined();
  });
});

describe('TTL', () => {
  test('los elementos caducados se borran con retraso y generan REMOVE de servicio', async () => {
    const e = await withTable('NEW_AND_OLD_IMAGES');
    await e.run('dynamodb update-time-to-live --table-name pedidos --time-to-live-specification Enabled=true,AttributeName=caduca');
    const now = Math.floor(e.acct.clock / 1000);
    await put(e, { id: S('viejo'), caduca: N(now - 60) });
    await put(e, { id: S('futuro'), caduca: N(now + 86400) });
    // recién caducado: todavía se ve (TTL no es instantáneo)
    expect(await e.json('dynamodb scan --table-name pedidos --query Count')).toBe(2);
    e.acct.clock += 6 * 60000;
    expect(await e.json('dynamodb scan --table-name pedidos --query "Items[].id.S"')).toEqual(['futuro']);
    const arn = await e.json('dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn');
    const shard = await e.json(`dynamodbstreams describe-stream --stream-arn ${arn} --query "StreamDescription.Shards[0].ShardId"`);
    const it = await e.json(`dynamodbstreams get-shard-iterator --stream-arn ${arn} --shard-id ${shard} --shard-iterator-type TRIM_HORIZON --query ShardIterator`);
    const recs = (await e.json(`dynamodbstreams get-records --shard-iterator ${it}`)).Records;
    const rm = recs.find((x: any) => x.eventName === 'REMOVE');
    expect(rm.userIdentity).toEqual({ type: 'Service', principalId: 'dynamodb.amazonaws.com' });
  });
});

describe('Lambda ← stream', () => {
  async function setup(extra = '') {
    const e = await withTable('NEW_AND_OLD_IMAGES');
    e.write('t.json', TRUST);
    await e.run('iam create-role --role-name fn --assume-role-policy-document file://t.json');
    await e.run('iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
    e.write('f.zip', zip({ 'lambda_function.py': "import json\ndef lambda_handler(event, context):\n    for r in event['Records']:\n        d = r['dynamodb']\n        if d.get('NewImage', {}).get('id', {}).get('S') == 'malo':\n            raise ValueError('registro malo')\n        print(r['eventName'], json.dumps(d['Keys']))\n" }));
    await e.run('lambda create-function --function-name feed --runtime python3.12 --role arn:aws:iam::123456789012:role/fn --handler lambda_function.lambda_handler --zip-file fileb://f.zip');
    const arn = await e.json('dynamodb describe-table --table-name pedidos --query Table.LatestStreamArn');
    return { e, arn: arn as string, extra };
  }
  const logs = async (e: TestEnv) => (await e.run('logs filter-log-events --log-group-name /aws/lambda/feed --query "events[].message" --output text')).stdout;

  test('el rol necesita permisos sobre el stream y la función recibe los cambios', async () => {
    const { e, arn } = await setup();
    const bad = await e.run(`lambda create-event-source-mapping --function-name feed --event-source-arn ${arn} --starting-position LATEST`);
    expect(bad.stderr).toContain('Cannot access stream');
    await e.run('iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole');
    expect((await e.run(`lambda create-event-source-mapping --function-name feed --event-source-arn ${arn}`)).stderr).toContain('StartingPosition');
    await put(e, { id: S('antes') });
    expect((await e.run(`lambda create-event-source-mapping --function-name feed --event-source-arn ${arn} --starting-position LATEST`)).code).toBe(0);
    await put(e, { id: S('a1') });
    await put(e, { id: S('a2') });
    e.acct.clock += 60000;
    await e.run('lambda list-functions');
    const out = await logs(e);
    expect(out).toContain('INSERT {"id": {"S": "a1"}}');
    expect(out).toContain('INSERT {"id": {"S": "a2"}}');
    expect(out).not.toContain('antes');
  });

  test('un registro malo bloquea el fragmento hasta agotar los reintentos y se manda al destino de error', async () => {
    const { e, arn } = await setup();
    await e.run('iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaDynamoDBExecutionRole');
    await e.run('iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess');
    const q = (await e.json('sqs create-queue --queue-name fallos')).QueueUrl;
    e.write('dest.json', JSON.stringify({ OnFailure: { Destination: 'arn:aws:sqs:us-east-1:123456789012:fallos' } }));
    await e.run(`lambda create-event-source-mapping --function-name feed --event-source-arn ${arn} --starting-position TRIM_HORIZON --batch-size 1 --maximum-retry-attempts 2 --destination-config file://dest.json`);
    await put(e, { id: S('malo') });
    await put(e, { id: S('bueno') });
    // el registro malo bloquea al bueno mientras se reintenta
    for (let k = 0; k < 6; k++) {
      e.acct.clock += 60000;
      await e.run('lambda list-functions');
    }
    const out = await logs(e);
    expect(out).toContain('INSERT {"id": {"S": "bueno"}}');
    const msgs = (await e.json(`sqs receive-message --queue-url ${q}`)).Messages;
    expect(JSON.parse(msgs[0].Body).DDBStreamBatchInfo.batchSize).toBe(1);
  });
});

describe('Transacciones', () => {
  const tx = (items: unknown[]) => `dynamodb transact-write-items --transact-items '${JSON.stringify(items)}'`;
  const cuenta = (id: string, saldo: number) => ({ Put: { TableName: 'pedidos', Item: { id: S(id), saldo: N(saldo) } } });

  test('todo o nada: una condición que falla cancela todo y dice cuál', async () => {
    const e = await withTable();
    await e.run(tx([cuenta('a', 100), cuenta('b', 0)]));
    const upd = (id: string, delta: number, cond?: string) => ({ Update: { TableName: 'pedidos', Key: { id: S(id) }, UpdateExpression: 'SET saldo = saldo + :d', ...(cond ? { ConditionExpression: cond } : {}), ExpressionAttributeValues: { ':d': N(delta), ...(cond ? { ':min': N(50) } : {}) } } });
    // transferir 30 de a a b
    expect((await e.run(tx([upd('a', -30, 'saldo >= :min'), upd('b', 30)]))).code).toBe(0);
    expect(await e.json('dynamodb scan --table-name pedidos --query "Items[].saldo.N"')).toEqual(expect.arrayContaining(['70', '30']));
    // a tiene 70: restar 30 más dejaría 40 < 50 (condición min sobre el valor actual 70 sí se cumple); probamos con una condición que falla
    const fail = await e.run(tx([upd('b', 5), upd('a', -10, 'saldo >= :min AND attribute_not_exists(saldo)')]));
    expect(fail.stderr).toContain('TransactionCanceledException');
    expect(fail.stderr).toContain('[None, ConditionalCheckFailed]');
    // nada cambió
    expect(await e.json(`dynamodb get-item --table-name pedidos --key '{"id":{"S":"b"}}' --query Item.saldo.N`)).toBe('30');
  });

  test('un elemento solo puede aparecer una vez y los errores de expresión no dejan cambios a medias', async () => {
    const e = await withTable();
    const dup = await e.run(tx([cuenta('a', 1), cuenta('a', 2)]));
    expect(dup.stderr).toContain('multiple operations on one item');
    const bad = await e.run(tx([cuenta('x', 1), { Update: { TableName: 'pedidos', Key: { id: S('y') }, UpdateExpression: 'SET = nada' } }]));
    expect(bad.code).not.toBe(0);
    expect(await e.json('dynamodb scan --table-name pedidos --query Count')).toBe(0);
    // lectura transaccional
    await e.run(tx([cuenta('r', 7)]));
    const g = await e.json(`dynamodb transact-get-items --transact-items '[{"Get":{"TableName":"pedidos","Key":{"id":{"S":"r"}}}},{"Get":{"TableName":"pedidos","Key":{"id":{"S":"nada"}}}}]'`);
    expect(g.Responses[0].Item.saldo.N).toBe('7');
    expect(g.Responses[1]).toEqual({});
    // idempotencia
    const items = [cuenta('t', 1)];
    expect((await e.run(tx(items) + ' --client-request-token tok1')).code).toBe(0);
    expect((await e.run(tx(items) + ' --client-request-token tok1')).code).toBe(0);
    expect((await e.run(tx([cuenta('t', 2)]) + ' --client-request-token tok1')).stderr).toContain('IdempotentParameterMismatchException');
  });
});

describe('Tablas globales', () => {
  test('hacen falta streams con imágenes nuevas y viejas; los cambios se replican en los dos sentidos', async () => {
    const e = await withTable();
    const rep = (r: string) => `dynamodb update-table --table-name pedidos --replica-updates '[{"Create":{"RegionName":"${r}"}}]'`;
    expect((await e.run(rep('eu-west-1'))).stderr).toContain('NEW_AND_OLD_IMAGES');
    await e.run('dynamodb update-table --table-name pedidos --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES');
    expect((await e.run(rep('us-east-1'))).stderr).toContain('same region');
    expect((await e.run(rep('eu-west-1'))).code).toBe(0);
    expect((await e.run(rep('eu-west-1'))).stderr).toContain('ResourceInUseException');
    await put(e, { id: S('1'), v: S('origen') });
    e.acct.clock += 10000;
    expect(await e.json('dynamodb get-item --table-name pedidos --key \'{"id":{"S":"1"}}\' --region eu-west-1 --query Item.v.S')).toBe('origen');
    await put(e, { id: S('2'), v: S('desde-europa') }, 'pedidos', 'eu-west-1');
    expect(await e.json('dynamodb get-item --table-name pedidos --key \'{"id":{"S":"2"}}\' --query Item.v.S')).toBe('desde-europa');
    const d = await e.json('dynamodb describe-table --table-name pedidos --query "Table.Replicas[].RegionName"');
    expect(d).toEqual(['eu-west-1', 'us-east-1']);
    await e.run(`dynamodb update-table --table-name pedidos --replica-updates '[{"Delete":{"RegionName":"eu-west-1"}}]'`);
    e.acct.clock += 10000;
    expect((await e.run('dynamodb describe-table --table-name pedidos --region eu-west-1')).stderr).toContain('ResourceNotFoundException');
    await put(e, { id: S('3') });
    expect(await e.json('dynamodb describe-table --table-name pedidos --query Table.Replicas')).toBeNull();
  });

  test('con capacidad provisionada no se puede replicar', async () => {
    const e = mkEnv();
    await e.json(`dynamodb create-table --table-name prov --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 --stream-specification StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES`);
    expect((await e.run(`dynamodb update-table --table-name prov --replica-updates '[{"Create":{"RegionName":"eu-west-1"}}]'`)).stderr).toContain('on-demand');
  });
});

describe('Copias de seguridad y PITR', () => {
  test('copia bajo demanda y restauración a una tabla nueva sin TTL', async () => {
    const e = await withTable('NEW_AND_OLD_IMAGES');
    await e.run('dynamodb update-time-to-live --table-name pedidos --time-to-live-specification Enabled=true,AttributeName=caduca');
    await put(e, { id: S('1') });
    const b = await e.json('dynamodb create-backup --table-name pedidos --backup-name antes');
    expect(b.BackupDetails.BackupStatus).toBe('AVAILABLE');
    await put(e, { id: S('2') });
    await e.run('dynamodb delete-item --table-name pedidos --key \'{"id":{"S":"1"}}\'');
    await e.run(`dynamodb restore-table-from-backup --target-table-name pedidos-restaurada --backup-arn ${b.BackupDetails.BackupArn}`);
    e.acct.clock += 10000;
    expect(await e.json('dynamodb scan --table-name pedidos-restaurada --query "Items[].id.S"')).toEqual(['1']);
    expect(await e.json('dynamodb describe-time-to-live --table-name pedidos-restaurada --query TimeToLiveDescription.TimeToLiveStatus')).toBe('DISABLED');
    expect((await e.run(`dynamodb restore-table-from-backup --target-table-name pedidos --backup-arn ${b.BackupDetails.BackupArn}`)).stderr).toContain('TableAlreadyExistsException');
    expect(await e.json('dynamodb list-backups --table-name pedidos --query "BackupSummaries[].BackupName"')).toEqual(['antes']);
  });

  test('PITR: restaurar al segundo anterior a un borrado accidental', async () => {
    const e = await withTable();
    expect((await e.run('dynamodb restore-table-to-point-in-time --source-table-name pedidos --target-table-name x --use-latest-restorable-time')).stderr).toContain('PointInTimeRecoveryUnavailableException');
    await e.run('dynamodb update-continuous-backups --table-name pedidos --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true');
    expect(await e.json('dynamodb describe-continuous-backups --table-name pedidos --query ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus')).toBe('ENABLED');
    await put(e, { id: S('1'), v: S('a') });
    await put(e, { id: S('2'), v: S('b') });
    const antes = new Date(e.acct.clock + 500).toISOString();
    e.acct.clock += 60000;
    await e.run('dynamodb delete-item --table-name pedidos --key \'{"id":{"S":"1"}}\'');
    await e.run('dynamodb delete-item --table-name pedidos --key \'{"id":{"S":"2"}}\'');
    expect(await e.json('dynamodb scan --table-name pedidos --query Count')).toBe(0);
    expect((await e.run(`dynamodb restore-table-to-point-in-time --source-table-name pedidos --target-table-name x --restore-date-time ${new Date(e.acct.clock - 40 * 86400000).toISOString()}`)).stderr).toContain('InvalidRestoreTimeException');
    await e.run(`dynamodb restore-table-to-point-in-time --source-table-name pedidos --target-table-name pedidos-antes --restore-date-time ${antes}`);
    e.acct.clock += 10000;
    expect(await e.json('dynamodb scan --table-name pedidos-antes --query "Items[].id.S"')).toEqual(expect.arrayContaining(['1', '2']));
  });
});
