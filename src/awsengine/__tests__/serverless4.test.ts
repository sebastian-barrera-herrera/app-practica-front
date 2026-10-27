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
async function fn(e: TestEnv, name: string, code: string, policies = ['service-role/AWSLambdaBasicExecutionRole']) {
  e.write(`${name}.zip`, zip({ 'lambda_function.py': code }));
  const r = await role(e, `${name}-role`, 'lambda.amazonaws.com', policies);
  await e.json(`lambda create-function --function-name ${name} --runtime python3.12 --role ${r} --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip`);
  return `arn:aws:lambda:us-east-1:123456789012:function:${name}`;
}
const logs = async (e: TestEnv, name: string) => {
  const r = await e.run(`logs filter-log-events --log-group-name /aws/lambda/${name} --query "events[].message" --output text`);
  return r.code === 0 ? r.stdout : '';
};
const notif = (e: TestEnv, bucket: string, conf: unknown) => {
  e.write('n.json', JSON.stringify(conf));
  return e.run(`s3api put-bucket-notification-configuration --bucket ${bucket} --notification-configuration file://n.json`);
};

describe('Notificaciones de S3', () => {
  test('Lambda: hace falta el permiso, el nombre llega codificado y los filtros se respetan', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket fotos-tienda');
    const arn = await fn(e, 'miniatura', "import urllib.parse\ndef lambda_handler(event, context):\n    for r in event['Records']:\n        k = urllib.parse.unquote_plus(r['s3']['object']['key'])\n        print('evento', r['eventName'], k, r['s3']['object'].get('size'))\n");
    const conf = { LambdaFunctionConfigurations: [{ Id: 'jpg', LambdaFunctionArn: arn, Events: ['s3:ObjectCreated:*'], Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'subidas/' }, { Name: 'suffix', Value: '.jpg' }] } } }] };
    // sin permiso: S3 no puede validar el destino
    const bad = await notif(e, 'fotos-tienda', conf);
    expect(bad.stderr).toContain('InvalidArgument');
    expect(bad.stderr).toContain('Unable to validate the following destination configurations');
    await e.run(`lambda add-permission --function-name miniatura --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::fotos-tienda --source-account 123456789012`);
    expect((await notif(e, 'fotos-tienda', conf)).code).toBe(0);
    expect(await e.json('s3api get-bucket-notification-configuration --bucket fotos-tienda --query "LambdaFunctionConfigurations[0].Id"')).toBe('jpg');
    e.write('a.jpg', 'JPEG');
    await e.run('s3 cp a.jpg "s3://fotos-tienda/subidas/mi foto.jpg"');
    await e.run('s3 cp a.jpg s3://fotos-tienda/subidas/b.png');
    await e.run('s3 cp a.jpg s3://fotos-tienda/otra/c.jpg');
    const out = await logs(e, 'miniatura');
    expect(out).toContain('evento ObjectCreated:Put subidas/mi foto.jpg 4');
    expect(out).not.toContain('b.png');
    expect(out).not.toContain('c.jpg');
  });

  test('borrados, copias y el evento de EventBridge', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket datos-notif');
    const arn = await fn(e, 'audita', "def lambda_handler(event, context):\n    print('S3', event['Records'][0]['eventName'])\n");
    await e.run(`lambda add-permission --function-name audita --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::datos-notif`);
    const first = await notif(e, 'datos-notif', { LambdaFunctionConfigurations: [{ LambdaFunctionArn: arn, Events: ['s3:ObjectRemoved:*', 's3:ObjectCreated:Copy'] }] });
    expect(first.stderr).toBe('');
    e.write('x.txt', 'hola');
    await e.run('s3 cp x.txt s3://datos-notif/x.txt');
    expect(await logs(e, 'audita')).toBe('');
    await e.run('s3 cp s3://datos-notif/x.txt s3://datos-notif/y.txt');
    await e.run('s3 rm s3://datos-notif/x.txt');
    const out = await logs(e, 'audita');
    expect(out).toContain('S3 ObjectCreated:Copy');
    expect(out).toContain('S3 ObjectRemoved:Delete');
    // eventos inválidos y configuraciones ambiguas
    expect((await notif(e, 'datos-notif', { LambdaFunctionConfigurations: [{ LambdaFunctionArn: arn, Events: ['s3:Inventado'] }] })).stderr).toContain('InvalidArgument');
    const amb = await notif(e, 'datos-notif', { LambdaFunctionConfigurations: [{ Id: 'a', LambdaFunctionArn: arn, Events: ['s3:ObjectCreated:*'] }, { Id: 'b', LambdaFunctionArn: arn, Events: ['s3:ObjectCreated:Put'], Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'logs/' }] } } }] });
    expect(amb.stderr).toContain('ambiguously defined');
    // EventBridge: el bucket envía «Object Created» al bus por defecto
    const target = await fn(e, 'puente', "def lambda_handler(event, context):\n    print('EB', event['detail-type'], event['detail']['bucket']['name'], event['detail']['object']['key'])\n");
    await e.run('events put-rule --name objetos --event-pattern \'{"source":["aws.s3"],"detail-type":["Object Created"]}\'');
    await e.run(`events put-targets --rule objetos --targets Id=1,Arn=${target}`);
    await e.run(`lambda add-permission --function-name puente --statement-id ev --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn arn:aws:events:us-east-1:123456789012:rule/objetos`);
    await notif(e, 'datos-notif', { EventBridgeConfiguration: {} });
    await e.run('s3 cp x.txt s3://datos-notif/nuevo.txt');
    expect(await logs(e, 'puente')).toContain('EB Object Created datos-notif nuevo.txt');
  });

  test('cola SQS: política obligatoria, mensaje de prueba y mensajes de evento', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket entrada');
    const url = (await e.json('sqs create-queue --queue-name subidas')).QueueUrl as string;
    const qarn = 'arn:aws:sqs:us-east-1:123456789012:subidas';
    const conf = { QueueConfigurations: [{ QueueArn: qarn, Events: ['s3:ObjectCreated:*'] }] };
    expect((await notif(e, 'entrada', conf)).stderr).toContain('Unable to validate the following destination configurations');
    const policy = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qarn, Condition: { ArnLike: { 'aws:SourceArn': 'arn:aws:s3:::entrada' } } }] });
    e.write('attrs.json', JSON.stringify({ Policy: policy }));
    await e.run(`sqs set-queue-attributes --queue-url ${url} --attributes file://attrs.json`);
    expect((await notif(e, 'entrada', conf)).code).toBe(0);
    e.write('d.csv', 'a,b');
    await e.run('s3 cp d.csv s3://entrada/d.csv');
    const msgs = (await e.json(`sqs receive-message --queue-url ${url} --max-number-of-messages 10`)).Messages as { Body: string }[];
    expect(msgs).toHaveLength(2);
    expect(JSON.parse(msgs[0].Body).Event).toBe('s3:TestEvent');
    expect(JSON.parse(msgs[1].Body).Records[0].s3.object.key).toBe('d.csv');
  });

  test('un bucle (la función escribe en el mismo bucket) se corta a las 16 invocaciones', async () => {
    const e = mkEnv();
    await e.run('s3api create-bucket --bucket bucle');
    const polS3 = await e.run('iam create-policy --policy-name s3rw --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}\'');
    expect(polS3.code).toBe(0);
    const arn = await fn(e, 'repite', "import boto3\ndef lambda_handler(event, context):\n    k = event['Records'][0]['s3']['object']['key']\n    print('procesa', k)\n    boto3.client('s3').put_object(Bucket='bucle', Key='copia-' + k, Body='x')\n", ['service-role/AWSLambdaBasicExecutionRole', 'AmazonS3FullAccess']);
    await e.run(`lambda add-permission --function-name repite --statement-id s3 --action lambda:InvokeFunction --principal s3.amazonaws.com --source-arn arn:aws:s3:::bucle`);
    await notif(e, 'bucle', { LambdaFunctionConfigurations: [{ LambdaFunctionArn: arn, Events: ['s3:ObjectCreated:*'] }] });
    e.write('o.txt', 'x');
    await e.run('s3 cp o.txt s3://bucle/o.txt');
    const n = (await logs(e, 'repite')).split('procesa').length - 1;
    expect(n).toBe(16);
    expect(await e.json('s3api list-objects-v2 --bucket bucle --query "length(Contents)"')).toBe(17);
  });
});

describe('_check http extendido', () => {
  test('api:first con método, cuerpo y cabeceras', async () => {
    const e = mkEnv();
    e.io.god = true;
    const arn = await fn(e, 'eco', "import json\ndef lambda_handler(event, context):\n    return {'statusCode': 200, 'body': json.dumps({'m': event['requestContext']['http']['method'], 'b': event.get('body'), 'x': event['headers'].get('x-clave')})}\n");
    await e.json(`apigatewayv2 create-api --name eco --protocol-type HTTP --target ${arn}`);
    const r = await e.json(`_check http --url api:first/cualquiera --method POST --body hola --header "X-Clave: 42"`);
    expect(r.Status).toBe(200);
    expect(JSON.parse(r.Body)).toEqual({ m: 'POST', b: 'hola', x: '42' });
  });
});
