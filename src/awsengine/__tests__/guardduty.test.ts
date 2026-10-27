import { mkEnv, type TestEnv } from './helpers';

/** Consulta de solo lectura del corrector (`_check …`), que necesita el modo «dios». */
async function chk(e: TestEnv, line: string) {
  e.io.god = true;
  try {
    return await e.json(`_check ${line}`);
  } finally {
    e.io.god = false;
  }
}
const MIN = 60000;
const gd = async (e: TestEnv) => (await e.json('guardduty create-detector --enable')).DetectorId as string;
const list = async (e: TestEnv, id: string, crit = '{"Criterion":{"service.archived":{"Eq":["false"]}}}') => {
  const ids = (await e.json(`guardduty list-findings --detector-id ${id} --finding-criteria '${crit}'`)).FindingIds as string[];
  return ids.length ? ((await e.json(`guardduty get-findings --detector-id ${id} --finding-ids ${ids.join(' ')}`)).Findings as { Type: string; Severity: number; Id: string; Service: { Count: number; Archived: boolean }; Title: string }[]) : [];
};
const types = async (e: TestEnv, id: string) => (await list(e, id)).map((f) => f.Type).sort();

describe('GuardDuty: detector', () => {
  test('un detector por región; se puede suspender y borrar', async () => {
    const e = mkEnv();
    const id = await gd(e);
    expect((await e.run('guardduty create-detector --enable')).stderr).toContain('BadRequestException');
    expect((await e.json('guardduty list-detectors')).DetectorIds).toEqual([id]);
    expect((await e.json(`guardduty get-detector --detector-id ${id}`)).Status).toBe('ENABLED');
    await e.run(`guardduty update-detector --detector-id ${id} --no-enable`);
    expect((await e.json(`guardduty get-detector --detector-id ${id}`)).Status).toBe('DISABLED');
    expect((await e.run('guardduty get-detector --detector-id nadie')).stderr).toContain('BadRequestException');
    await e.run(`guardduty delete-detector --detector-id ${id}`);
    expect((await e.json('guardduty list-detectors')).DetectorIds).toEqual([]);
  });

  test('hallazgos de ejemplo: marcados como SAMPLE, con tipos válidos y filtrables', async () => {
    const e = mkEnv();
    const id = await gd(e);
    expect((await e.run(`guardduty create-sample-findings --detector-id ${id} --finding-types Inventado:EC2/Nada`)).stderr).toContain('BadRequestException');
    await e.run(`guardduty create-sample-findings --detector-id ${id} --finding-types Recon:EC2/PortProbeUnprotectedPort UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS Policy:S3/BucketAnonymousAccessGranted`);
    const all = await list(e, id);
    expect(all).toHaveLength(3);
    expect(all.every((f) => f.Title.startsWith('[SAMPLE]'))).toBe(true);
    const high = await list(e, id, '{"Criterion":{"severity":{"Gte":7}}}');
    expect(high.map((f) => f.Type)).toEqual(['UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS']);
    const stats = await e.json(`guardduty get-findings-statistics --detector-id ${id} --finding-statistic-types COUNT_BY_SEVERITY`);
    expect(stats.FindingStatistics.CountBySeverity).toEqual({ '2': 1, '5': 1, '8': 1 });
    await e.run(`guardduty archive-findings --detector-id ${id} --finding-ids ${high[0].Id}`);
    expect(await list(e, id)).toHaveLength(2);
    await e.run(`guardduty unarchive-findings --detector-id ${id} --finding-ids ${high[0].Id}`);
    expect(await list(e, id)).toHaveLength(3);
  });
});

describe('GuardDuty: detección a partir de la actividad', () => {
  test('apagar CloudTrail, usar root y atarse permisos de administrador generan hallazgos; antes de activar el detector no hay nada', async () => {
    const e = mkEnv({ scenario: 'auditoria' });
    const id = await gd(e);
    expect(await types(e, id)).toEqual([]);
    await e.run('s3 mb s3://trail-logs');
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: 'arn:aws:s3:::trail-logs' }, { Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 's3:PutObject', Resource: 'arn:aws:s3:::trail-logs/AWSLogs/123456789012/*' }] }));
    await e.run('s3api put-bucket-policy --bucket trail-logs --policy file://p.json');
    await e.run('cloudtrail create-trail --name auditoria --s3-bucket-name trail-logs');
    await e.run('cloudtrail start-logging --name auditoria');
    await e.run('cloudtrail stop-logging --name auditoria');
    await e.run('iam create-user --user-name intruso');
    await e.run('iam attach-user-policy --user-name intruso --policy-arn arn:aws:iam::aws:policy/AdministratorAccess');
    await e.run('s3api list-buckets');
    const t = await types(e, id);
    expect(t).toEqual(expect.arrayContaining(['Stealth:IAMUser/CloudTrailLoggingDisabled', 'PrivilegeEscalation:IAMUser/AdministrativePermissions']));
  });

  test('un bucket que se hace público y la protección de acceso público desactivada', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    const id = await gd(e);
    await e.run('s3api delete-public-access-block --bucket privado-demo').catch(() => undefined);
    e.write('pub.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::privado-demo/*' }] }));
    await e.run('s3api put-bucket-policy --bucket privado-demo --policy file://pub.json');
    const t = await types(e, id);
    expect(t).toContain('Policy:S3/BucketAnonymousAccessGranted');
  });

  test('un puerto SSH abierto al mundo: tras 20 minutos lo sondean y tras una hora lo atacan por fuerza bruta; si se cierra a tiempo, nada', async () => {
    const mk = async () => {
      const e = mkEnv({ scenario: 'ec2demo' });
      const id = await gd(e);
      const inst = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].[InstanceId,SecurityGroups[0].GroupId]"')) as [string, string];
      return { e, id, inst };
    };
    const a = await mk();
    await a.e.run(`ec2 authorize-security-group-ingress --group-id ${a.inst[1]} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    a.e.acct.clock += 5 * MIN;
    await a.e.run('sts get-caller-identity');
    expect(await types(a.e, a.id)).toEqual([]);
    a.e.acct.clock += 30 * MIN;
    await a.e.run('sts get-caller-identity');
    expect(await types(a.e, a.id)).toEqual(['Recon:EC2/PortProbeUnprotectedPort']);
    a.e.acct.clock += 40 * MIN;
    await a.e.run('sts get-caller-identity');
    expect(await types(a.e, a.id)).toEqual(['Recon:EC2/PortProbeUnprotectedPort', 'UnauthorizedAccess:EC2/SSHBruteForce']);
    // cerrado a tiempo: no hay hallazgos
    const b = await mk();
    await b.e.run(`ec2 authorize-security-group-ingress --group-id ${b.inst[1]} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    b.e.acct.clock += 10 * MIN;
    await b.e.run('sts get-caller-identity');
    await b.e.run(`ec2 revoke-security-group-ingress --group-id ${b.inst[1]} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    b.e.acct.clock += 120 * MIN;
    await b.e.run('sts get-caller-identity');
    expect(await types(b.e, b.id)).toEqual([]);
  });
});

describe('GuardDuty: filtros, listas de IP y alertas', () => {
  test('un filtro ARCHIVE archiva lo existente y lo nuevo que coincide; un NOOP no cambia nada', async () => {
    const e = mkEnv({ scenario: 'ec2web' });
    const id = await gd(e);
    await e.run(`guardduty create-sample-findings --detector-id ${id} --finding-types Recon:EC2/PortProbeUnprotectedPort Recon:EC2/Portscan`);
    expect(await list(e, id)).toHaveLength(2);
    expect((await e.run(`guardduty create-filter --detector-id ${id} --name vacio --action ARCHIVE --finding-criteria '{"Criterion":{}}'`)).stderr).toContain('BadRequestException');
    await e.run(`guardduty create-filter --detector-id ${id} --name sin-sondeos --action ARCHIVE --rank 1 --finding-criteria '{"Criterion":{"type":{"Eq":["Recon:EC2/PortProbeUnprotectedPort"]}}}'`);
    expect(await types(e, id)).toEqual(['Recon:EC2/Portscan']);
    expect((await e.run(`guardduty create-filter --detector-id ${id} --name sin-sondeos --finding-criteria '{"Criterion":{"severity":{"Gte":1}}}'`)).stderr).toContain('BadRequestException');
    expect((await e.json(`guardduty list-filters --detector-id ${id}`)).FilterNames).toEqual(['sin-sondeos']);
    await e.run(`guardduty delete-filter --detector-id ${id} --filter-name sin-sondeos`);
    expect((await e.json(`guardduty list-filters --detector-id ${id}`)).FilterNames).toEqual([]);
  });

  test('ataques inyectados: detecta el minero y el robo de credenciales; la lista de IP de confianza los silencia', async () => {
    const e = mkEnv({ scenario: 'ec2demo' });
    const id = await gd(e);
    expect((await chk(e, 'attack --kind cryptominer --instance web-1')).Findings).toBe(1);
    expect((await chk(e, 'attack --kind credential-exfil --role app-role')).Findings).toBe(1);
    expect(await types(e, id)).toEqual(['CryptoCurrency:EC2/BitcoinTool.B!DNS', 'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS']);
    // repetir el ataque acumula, no duplica
    await chk(e, 'attack --kind cryptominer --instance web-1');
    expect((await list(e, id)).find((f) => f.Type.startsWith('CryptoCurrency'))!.Service.Count).toBe(2);
    // lista de IP de confianza: el archivo tiene que existir en S3
    await e.run('s3 mb s3://listas');
    expect((await e.run(`guardduty create-ip-set --detector-id ${id} --name oficina --format TXT --location s3://listas/oficina.txt --activate`)).stderr).toContain('BadRequestException');
    e.write('oficina.txt', '198.51.100.0/24\n');
    await e.run('s3 cp oficina.txt s3://listas/oficina.txt');
    const set = await e.json(`guardduty create-ip-set --detector-id ${id} --name oficina --format TXT --location s3://listas/oficina.txt --activate`);
    expect((await e.json(`guardduty get-ip-set --detector-id ${id} --ip-set-id ${set.IpSetId}`)).Status).toBe('ACTIVE');
    expect((await chk(e, 'attack --kind credential-exfil --role otra-app --from-ip 198.51.100.7')).Findings).toBe(0);
    // una IP fuera de la lista sigue levantando hallazgo
    expect((await chk(e, 'attack --kind credential-exfil --role otra-app --from-ip 203.0.113.50')).Findings).toBe(1);
  });

  test('los hallazgos nuevos llegan a EventBridge y de ahí a SNS', async () => {
    const e = mkEnv({ scenario: 'ec2demo' });
    const id = await gd(e);
    const topic = (await e.json('sns create-topic --name alertas')).TopicArn as string;
    const q = (await e.json('sqs create-queue --queue-name avisos')).QueueUrl as string;
    const qarn = (await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn`)).Attributes.QueueArn as string;
    e.write('qp.json', JSON.stringify({ Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qarn }] }) }));
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes file://qp.json`);
    await e.run(`sns subscribe --topic-arn ${topic} --protocol sqs --notification-endpoint ${qarn}`);
    e.write('pat.json', JSON.stringify({ source: ['aws.guardduty'], 'detail-type': ['GuardDuty Finding'], detail: { severity: [{ numeric: ['>=', 7] }] } }));
    await e.run('events put-rule --name graves --event-pattern file://pat.json');
    e.write('policy.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sns:Publish', Resource: topic }] }));
    await e.run(`sns set-topic-attributes --topic-arn ${topic} --attribute-name Policy --attribute-value file://policy.json`).catch(() => undefined);
    await e.run(`events put-targets --rule graves --targets Id=1,Arn=${topic}`);
    await chk(e, 'attack --kind tor-login --user ana');
    expect((await e.run(`sqs receive-message --queue-url ${q}`)).stdout.trim()).toBe('');
    await chk(e, 'attack --kind cryptominer --instance web-1');
    const msgs = (await e.json(`sqs receive-message --queue-url ${q} --max-number-of-messages 10`)).Messages as { Body: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].Body).toContain('BitcoinTool');
    void id;
  });
});

describe('GuardDuty: exportación a S3', () => {
  test('el bucket y la clave de KMS tienen que dejar escribir a GuardDuty', async () => {
    const e = mkEnv({ scenario: 'ec2demo' });
    const id = await gd(e);
    await e.run('s3 mb s3://hallazgos');
    const key = (await e.json('kms create-key --query KeyMetadata.Arn')) as string;
    const cmd = `guardduty create-publishing-destination --detector-id ${id} --destination-type S3 --destination-properties DestinationArn=arn:aws:s3:::hallazgos,KmsKeyArn=${key}`;
    expect((await e.run(cmd)).stderr).toContain('bucket policy');
    e.write('bp.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'guardduty.amazonaws.com' }, Action: ['s3:GetBucketLocation', 's3:PutObject'], Resource: ['arn:aws:s3:::hallazgos', 'arn:aws:s3:::hallazgos/*'] }] }));
    await e.run('s3api put-bucket-policy --bucket hallazgos --policy file://bp.json');
    expect((await e.run(cmd)).stderr).toContain('key policy');
    const keyId = key.split('/').pop()!;
    e.write('kp.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'root', Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'kms:*', Resource: '*' }, { Sid: 'gd', Effect: 'Allow', Principal: { Service: 'guardduty.amazonaws.com' }, Action: 'kms:GenerateDataKey', Resource: '*' }] }));
    await e.run(`kms put-key-policy --key-id ${keyId} --policy-name default --policy file://kp.json`);
    expect((await e.run(cmd)).stderr).toBe('');
    await chk(e, 'attack --kind cryptominer --instance web-1');
    const objs = (await e.json('s3api list-objects-v2 --bucket hallazgos --prefix AWSLogs/')).Contents as { Key: string }[];
    expect(objs).toHaveLength(1);
    expect(objs[0].Key).toContain('/GuardDuty/us-east-1/');
  });
});

describe('GuardDuty: resumen del corrector', () => {
  test('`_check guardduty` dice los nombres de las instancias con hallazgos activos', async () => {
    const e = mkEnv({ scenario: 'sec-gd-ruido' });
    expect(await chk(e, 'guardduty --query ActiveNames')).toEqual(['bastion', 'web-1']);
    const id = (await e.json('guardduty list-detectors')).DetectorIds[0] as string;
    const bast = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=bastion --query Reservations[0].Instances[0].InstanceId')) as string;
    await e.run(`guardduty create-filter --detector-id ${id} --name bastion-esperado --action ARCHIVE --finding-criteria '{"Criterion":{"resource.instanceDetails.instanceId":{"Eq":["${bast}"]}}}'`);
    expect(await chk(e, 'guardduty --query ActiveNames')).toEqual(['web-1']);
  });
});

