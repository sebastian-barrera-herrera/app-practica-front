import { mkEnv, type TestEnv } from './helpers';

const ACCT = '123456789012';
const policyFor = (bucket: string, prefix = '') =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Sid: 'AclCheck', Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: `arn:aws:s3:::${bucket}` },
      { Sid: 'Write', Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::${bucket}/${prefix}AWSLogs/${ACCT}/*`, Condition: { StringEquals: { 's3:x-amz-acl': 'bucket-owner-full-control' } } },
    ],
  });

async function bucket(e: TestEnv, name: string, prefix = '') {
  await e.run(`s3 mb s3://${name}`);
  e.write('pol.json', policyFor(name, prefix));
  await e.run(`s3api put-bucket-policy --bucket ${name} --policy file://pol.json`);
}
const minutes = (e: TestEnv, n: number) => {
  e.acct.clock += n * 60000;
};
const create = (extra = '') => `cloudtrail create-trail --name auditoria --s3-bucket-name logs-auditoria ${extra}`;
const lookup = async (e: TestEnv, key: string, value: string, extra = '') => (await e.json(`cloudtrail lookup-events --lookup-attributes AttributeKey=${key},AttributeValue=${value} ${extra}`)).Events as { EventName: string; Username: string; CloudTrailEvent: string; Resources: { ResourceType: string; ResourceName: string }[]; ReadOnly: string }[];
const keys = async (e: TestEnv, b: string) => (await e.json(`s3api list-objects-v2 --bucket ${b} --query Contents[].Key`).catch(() => null)) as string[] | null;

describe('CloudTrail: historial de eventos', () => {
  test('cada llamada queda registrada con quién, qué, cuándo y desde dónde', async () => {
    const e = mkEnv();
    await e.run('s3 mb s3://tienda-datos');
    await e.run('iam create-user --user-name ana');
    const ev = await lookup(e, 'EventName', 'CreateUser');
    expect(ev).toHaveLength(1);
    expect(ev[0].Username).toBe('alumno');
    expect(ev[0].ReadOnly).toBe('false');
    const rec = JSON.parse(ev[0].CloudTrailEvent);
    expect(rec).toMatchObject({ eventSource: 'iam.amazonaws.com', eventName: 'CreateUser', awsRegion: 'us-east-1', eventType: 'AwsApiCall', requestParameters: { userName: 'ana' }, readOnly: false, recipientAccountId: ACCT, managementEvent: true });
    expect(rec.userIdentity).toMatchObject({ type: 'IAMUser', userName: 'alumno', accountId: ACCT });
    expect(rec.userAgent).toContain('aws-cli/');
    expect(rec.userAgent).toContain('command/iam.create-user');
    expect(rec.eventID).toMatch(/^[0-9a-f-]{36}$/);
    // el bucket queda anotado con su nombre
    const mb = await lookup(e, 'EventName', 'CreateBucket');
    expect(mb[0].Resources.some((r) => r.ResourceName === 'tienda-datos')).toBe(true);
    expect((await lookup(e, 'ResourceName', 'tienda-datos')).length).toBeGreaterThan(0);
    // lecturas frente a escrituras
    expect((await lookup(e, 'ReadOnly', 'true')).every((x) => x.ReadOnly === 'true')).toBe(true);
    expect((await lookup(e, 'EventSource', 'iam.amazonaws.com')).map((x) => x.EventName)).toContain('CreateUser');
  });

  test('los errores quedan con errorCode y el servicio global vive en us-east-1', async () => {
    const e = mkEnv();
    await e.run('iam create-user --user-name bob');
    const k = await e.json('iam create-access-key --user-name bob');
    const admin = { ...e.env };
    e.env.AWS_ACCESS_KEY_ID = k.AccessKey.AccessKeyId;
    e.env.AWS_SECRET_ACCESS_KEY = k.AccessKey.SecretAccessKey;
    const r = await e.run('s3 ls');
    expect(r.stderr).toContain('AccessDenied');
    await e.run('iam list-users');
    for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) delete e.env[key];
    Object.assign(e.env, admin);
    const denied = await lookup(e, 'Username', 'bob');
    expect(denied.map((d) => d.EventName)).toEqual(['ListUsers', 'ListBuckets']);
    const rec = JSON.parse(denied[0].CloudTrailEvent);
    expect(rec.errorCode).toBeTruthy();
    expect(rec.errorMessage).toContain('bob');
    // IAM es global: desde otra región no se ve; en us-east-1 sí
    const other = await e.json('cloudtrail lookup-events --region eu-west-1 --lookup-attributes AttributeKey=EventName,AttributeValue=CreateUser');
    expect(other.Events).toHaveLength(0);
    const east = await e.json('cloudtrail lookup-events --region us-east-1 --lookup-attributes AttributeKey=EventName,AttributeValue=CreateUser');
    expect(east.Events).toHaveLength(1);
  });

  test('validaciones de lookup-events y paginación', async () => {
    const e = mkEnv();
    for (let i = 0; i < 6; i++) await e.run('sts get-caller-identity');
    expect((await e.run('cloudtrail lookup-events --lookup-attributes AttributeKey=Color,AttributeValue=rojo')).stderr).toContain('InvalidLookupAttributesException');
    expect((await e.run('cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=A AttributeKey=EventName,AttributeValue=B')).stderr).toContain('only one lookup attribute');
    const page = await e.json('cloudtrail lookup-events --max-results 3');
    expect(page.Events).toHaveLength(3);
    expect(page.NextToken).toBeTruthy();
    const next = await e.json(`cloudtrail lookup-events --max-results 3 --next-token ${page.NextToken}`);
    expect(next.Events[0].EventId).not.toBe(page.Events[0].EventId);
    // más reciente primero
    expect(Date.parse(page.Events[0].EventTime)).toBeGreaterThanOrEqual(Date.parse(page.Events[1].EventTime));
  });

  test('los secretos no se guardan en claro', async () => {
    const e = mkEnv();
    await e.run('iam create-user --user-name ana');
    await e.run('iam create-login-profile --user-name ana --password Secreto#12345');
    const ev = await lookup(e, 'EventName', 'CreateLoginProfile');
    expect(JSON.parse(ev[0].CloudTrailEvent).requestParameters.password).toBe('HIDDEN_DUE_TO_SECURITY_REASONS');
  });
});

describe('CloudTrail: trails', () => {

  test('create-trail exige bucket y política; no registra hasta start-logging', async () => {
    const e = mkEnv();
    expect((await e.run(create())).stderr).toContain('S3BucketDoesNotExistException');
    await e.run('s3 mb s3://logs-auditoria');
    expect((await e.run(create())).stderr).toContain('InsufficientS3BucketPolicyException');
    e.write('pol.json', policyFor('logs-auditoria'));
    await e.run('s3api put-bucket-policy --bucket logs-auditoria --policy file://pol.json');
    const t = await e.json(create('--is-multi-region-trail --enable-log-file-validation'));
    expect(t).toMatchObject({ Name: 'auditoria', S3BucketName: 'logs-auditoria', IsMultiRegionTrail: true, IncludeGlobalServiceEvents: true, LogFileValidationEnabled: true, HomeRegion: 'us-east-1', TrailARN: `arn:aws:cloudtrail:us-east-1:${ACCT}:trail/auditoria` });
    expect((await e.json('cloudtrail get-trail-status --name auditoria')).IsLogging).toBe(false);
    expect((await e.run(create())).stderr).toContain('TrailAlreadyExistsException');
    expect((await e.run('cloudtrail create-trail --name a --s3-bucket-name logs-auditoria')).stderr).toContain('InvalidTrailNameException');
    expect((await e.json('cloudtrail describe-trails')).trailList.map((x: { Name: string }) => x.Name)).toEqual(['auditoria']);
    await e.run('cloudtrail start-logging --name auditoria');
    const s = await e.json('cloudtrail get-trail-status --name auditoria');
    expect(s.IsLogging).toBe(true);
    expect(s.LatestDeliveryTime).toBeUndefined();
    await e.run('cloudtrail stop-logging --name auditoria');
    expect((await e.json('cloudtrail get-trail-status --name auditoria')).IsLogging).toBe(false);
    await e.run('cloudtrail delete-trail --name auditoria');
    expect((await e.run('cloudtrail get-trail-status --name auditoria')).stderr).toContain('TrailNotFoundException');
  });

  test('entrega archivos a S3 cada 5 minutos, solo de lo ocurrido con el trail activo', async () => {
    const e = mkEnv();
    await bucket(e, 'logs-auditoria', 'trail/');
    await e.run('iam create-user --user-name antes');
    await e.run(create('--s3-key-prefix trail'));
    await e.run('cloudtrail start-logging --name auditoria');
    await e.run('iam create-user --user-name despues');
    // todavía no hay archivos
    expect(((await keys(e, 'logs-auditoria')) ?? []).filter((k) => k.includes('CloudTrail/'))).toEqual([]);
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    const ks = ((await keys(e, 'logs-auditoria')) ?? []).filter((k) => k.includes('/CloudTrail/'));
    expect(ks.length).toBeGreaterThan(0);
    expect(ks[0]).toMatch(new RegExp(`^trail/AWSLogs/${ACCT}/CloudTrail/us-east-1/2026/03/14/${ACCT}_CloudTrail_us-east-1_20260314T\\d{4}Z_[0-9a-f]{16}\\.json\\.gz$`));
    const all = (await Promise.all(ks.map(async (k) => (await e.run(`s3 cp s3://logs-auditoria/${k} -`)).stdout))).map((t) => JSON.parse(t).Records).flat() as { eventName: string; requestParameters?: { userName?: string } }[];
    const users = all.filter((r) => r.eventName === 'CreateUser').map((r) => r.requestParameters?.userName);
    expect(users).toEqual(['despues']);
    const st = await e.json('cloudtrail get-trail-status --name auditoria');
    expect(st.LatestDeliveryTime).toBeTruthy();
    expect(st.LatestDeliveryError).toBeUndefined();
  });

  test('si cambia la política del bucket, la entrega falla con AccessDenied', async () => {
    const e = mkEnv();
    await bucket(e, 'logs-auditoria');
    await e.run(create());
    await e.run('cloudtrail start-logging --name auditoria');
    await e.run('s3api delete-bucket-policy --bucket logs-auditoria');
    await e.run('iam create-user --user-name ana');
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    const st = await e.json('cloudtrail get-trail-status --name auditoria');
    expect(st.LatestDeliveryError).toBe('AccessDenied');
    expect(st.LatestDeliveryTime).toBeUndefined();
  });

  test('eventos de datos: solo se registran si el trail los pide', async () => {
    const e = mkEnv();
    await bucket(e, 'logs-auditoria');
    await e.run('s3 mb s3://datos-clientes');
    await e.run(create());
    await e.run('cloudtrail start-logging --name auditoria');
    e.write('f.txt', 'hola');
    await e.run('s3 cp f.txt s3://datos-clientes/f.txt');
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    const read = async () => {
      const ks = ((await keys(e, 'logs-auditoria')) ?? []).filter((k) => k.includes('/CloudTrail/'));
      return (await Promise.all(ks.map(async (k) => JSON.parse((await e.run(`s3 cp s3://logs-auditoria/${k} -`)).stdout).Records))).flat() as { eventName: string; eventCategory: string }[];
    };
    expect((await read()).some((r) => r.eventName === 'PutObject')).toBe(false);
    // los de gestión sí
    await e.run('iam create-user --user-name ana');
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    expect((await read()).some((r) => r.eventName === 'CreateUser')).toBe(true);
    await e.run(`cloudtrail put-event-selectors --trail-name auditoria --event-selectors '[{"ReadWriteType":"All","IncludeManagementEvents":true,"DataResources":[{"Type":"AWS::S3::Object","Values":["arn:aws:s3:::datos-clientes/"]}]}]'`);
    expect((await e.json('cloudtrail get-event-selectors --trail-name auditoria')).EventSelectors[0].DataResources[0].Type).toBe('AWS::S3::Object');
    await e.run('s3 cp f.txt s3://datos-clientes/g.txt');
    await e.run('s3 cp s3://datos-clientes/g.txt -');
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    const data = (await read()).filter((r) => r.eventCategory === 'Data');
    expect(data.map((r) => r.eventName).sort()).toEqual(['GetObject', 'PutObject']);
    expect((await e.run(`cloudtrail put-event-selectors --trail-name auditoria --event-selectors '[{"DataResources":[{"Type":"AWS::Foo::Bar","Values":[]}]}]'`)).stderr).toContain('InvalidEventSelectorsException');
    // el historial de 90 días no incluye los de datos
    expect(await lookup(e, 'EventName', 'PutObject')).toHaveLength(0);
  });

  test('entrega a CloudWatch Logs y una alarma de accesos denegados', async () => {
    const e = mkEnv();
    await bucket(e, 'logs-auditoria');
    await e.run('logs create-log-group --log-group-name /aws/cloudtrail/auditoria');
    const grp = `arn:aws:logs:us-east-1:${ACCT}:log-group:/aws/cloudtrail/auditoria:*`;
    e.write('t.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 'sts:AssumeRole' }] }));
    const role = (await e.json('iam create-role --role-name ct-logs --assume-role-policy-document file://t.json')).Role.Arn;
    // sin permisos para escribir en los registros
    expect((await e.run(create(`--cloud-watch-logs-log-group-arn ${grp} --cloud-watch-logs-role-arn ${role}`))).stderr).toContain('InvalidCloudWatchLogsRoleArnException');
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: '*' }] }));
    await e.run('iam put-role-policy --role-name ct-logs --policy-name logs --policy-document file://p.json');
    expect((await e.run(create(`--cloud-watch-logs-log-group-arn ${grp}`))).stderr).toContain('InvalidParameterCombinationException');
    await e.run(create(`--cloud-watch-logs-log-group-arn ${grp} --cloud-watch-logs-role-arn ${role}`));
    await e.run('cloudtrail start-logging --name auditoria');
    // metric filter sobre los registros del trail
    await e.run(`logs put-metric-filter --log-group-name /aws/cloudtrail/auditoria --filter-name denegados --filter-pattern '{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }' --metric-transformations metricName=AccesosDenegados,metricNamespace=Seguridad,metricValue=1`);
    await e.run('iam create-user --user-name bob');
    const k = await e.json('iam create-access-key --user-name bob');
    const admin = { ...e.env };
    e.env.AWS_ACCESS_KEY_ID = k.AccessKey.AccessKeyId;
    e.env.AWS_SECRET_ACCESS_KEY = k.AccessKey.SecretAccessKey;
    await e.run('s3 ls');
    await e.run('ec2 describe-instances');
    delete e.env.AWS_ACCESS_KEY_ID;
    delete e.env.AWS_SECRET_ACCESS_KEY;
    Object.assign(e.env, admin);
    const found = await e.json('logs filter-log-events --log-group-name /aws/cloudtrail/auditoria --filter-pattern \'{ $.userIdentity.userName = "bob" }\'');
    expect(found.events.length).toBeGreaterThanOrEqual(2);
    const dp = (await e.json(`cloudwatch get-metric-statistics --namespace Seguridad --metric-name AccesosDenegados --start-time ${new Date(e.acct.clock - 600000).toISOString()} --end-time ${new Date(e.acct.clock + 120000).toISOString()} --period 600 --statistics Sum`)).Datapoints;
    expect(dp.reduce((n: number, x: { Sum: number }) => n + x.Sum, 0)).toBeGreaterThanOrEqual(1);
  });

  test('validate-logs detecta un archivo manipulado', async () => {
    const e = mkEnv();
    await bucket(e, 'logs-auditoria');
    await e.run(create('--enable-log-file-validation'));
    await e.run('cloudtrail start-logging --name auditoria');
    await e.run('iam create-user --user-name ana');
    minutes(e, 6);
    await e.run('sts get-caller-identity');
    const start = new Date(e.acct.clock - 3600000).toISOString();
    const ok = await e.run(`cloudtrail validate-logs --trail-arn arn:aws:cloudtrail:us-east-1:${ACCT}:trail/auditoria --start-time ${start}`);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/\d+\/\d+ digest files valid/);
    expect(ok.stdout).toMatch(/(\d+)\/\1 log files valid/);
    const ks = ((await keys(e, 'logs-auditoria')) ?? []).filter((k) => k.includes('/CloudTrail/'));
    e.write('falso.json', '{"Records":[]}');
    await e.run(`s3 cp falso.json s3://logs-auditoria/${ks[0]}`);
    const bad = await e.run(`cloudtrail validate-logs --trail-arn arn:aws:cloudtrail:us-east-1:${ACCT}:trail/auditoria --start-time ${start}`);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain("INVALID: hash value doesn't match");
    // sin validación activada
    await e.run('cloudtrail update-trail --name auditoria --no-enable-log-file-validation');
    expect((await e.run(`cloudtrail validate-logs --trail-arn arn:aws:cloudtrail:us-east-1:${ACCT}:trail/auditoria --start-time ${start}`)).stderr).toContain('does not have log file validation enabled');
  });
});

describe('CloudTrail y EventBridge', () => {
  test('una regla sobre «AWS API Call via CloudTrail» reacciona a DeleteBucket', async () => {
    const e = mkEnv();
    const q = (await e.json('sqs create-queue --queue-name alertas')).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    const rule = (await e.json(`events put-rule --name borrados --event-pattern '{"source":["aws.s3"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["s3.amazonaws.com"],"eventName":["DeleteBucket"]}}'`)).RuleArn;
    await e.run(`events put-targets --rule borrados --targets Id=q,Arn=${qArn}`);
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qArn, Condition: { ArnEquals: { 'aws:SourceArn': rule } } }] });
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes '{"Policy":${JSON.stringify(pol)}}'`);
    await e.run('s3 mb s3://temporal');
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout).toBe('');
    await e.run('s3 rb s3://temporal');
    const m = await e.json(`sqs receive-message --queue-url ${q}`);
    const ev = JSON.parse(m.Messages[0].Body);
    expect(ev.source).toBe('aws.s3');
    expect(ev.detail.eventName).toBe('DeleteBucket');
    expect(ev.detail.requestParameters.bucketName).toBe('temporal');
    expect(ev.detail.userIdentity.userName).toBe('alumno');
  });
});
