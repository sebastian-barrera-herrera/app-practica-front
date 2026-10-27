import { mkEnv, type TestEnv } from './helpers';

async function chk(e: TestEnv, line: string) {
  e.io.god = true;
  try {
    return await e.json(`_check ${line}`);
  } finally {
    e.io.god = false;
  }
}
const MIN = 60000;

describe('Inspector', () => {
  const findings = async (e: TestEnv, crit = '{"findingStatus":[{"comparison":"EQUALS","value":"ACTIVE"}]}') => (await e.json(`inspector2 list-findings --filter-criteria '${crit}'`)).findings as { title: string; severity: string; type: string; status: string; resources: { id: string }[]; fixAvailable?: string }[];

  test('sin activar no hay hallazgos; al activarlo, aparecen las vulnerabilidades de las instancias gestionadas por SSM', async () => {
    const e = mkEnv({ scenario: 'ops-ssm-parches' });
    expect((await e.run('inspector2 list-findings')).stderr).toContain('AccessDeniedException');
    const on = await e.json('inspector2 enable --resource-types EC2 ECR');
    expect(on.accounts[0].resourceState.ec2.status).toBe('ENABLED');
    const f = await findings(e);
    // 6 CVE por servidor
    expect(f.filter((x) => x.type === 'PACKAGE_VULNERABILITY')).toHaveLength(12);
    expect(f.some((x) => x.title === 'CVE-2026-0910 - openssl' && x.severity === 'CRITICAL')).toBe(true);
    const crit = await findings(e, '{"severity":[{"comparison":"EQUALS","value":"CRITICAL"}]}');
    expect(crit.map((x) => x.title).sort()).toEqual(['CVE-2026-0910 - openssl', 'CVE-2026-0910 - openssl', 'CVE-2026-1402 - sudo', 'CVE-2026-1402 - sudo']);
    const agg = await e.json('inspector2 list-finding-aggregations --aggregation-type AWS_EC2_INSTANCE');
    expect(agg.responses).toHaveLength(2);
    expect(agg.responses[0].ec2InstanceAggregation.severityCounts.critical).toBe(2);
    const titles = await e.json('inspector2 list-finding-aggregations --aggregation-type TITLE');
    expect(titles.responses.find((x: { titleAggregation: { vulnerabilityId: string } }) => x.titleAggregation.vulnerabilityId === 'CVE-2026-0910').titleAggregation.severityCounts.all).toBe(2);
    expect((await e.run('inspector2 list-finding-aggregations --aggregation-type RARO')).stderr).toContain('ValidationException');
  });

  test('parchear cierra los hallazgos; un filtro SUPPRESS los oculta; una instancia sin agente aparece sin cobertura de paquetes', async () => {
    const e = mkEnv({ scenario: 'ops-ssm-parches' });
    await e.run('inspector2 enable --resource-types EC2');
    const ids = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[].Instances[].InstanceId"')) as string[];
    // suprimir un CVE
    await e.run(`inspector2 create-filter --name sin-curl --action SUPPRESS --filter-criteria '{"vulnerabilityId":[{"comparison":"EQUALS","value":"CVE-2026-1230"}]}'`);
    expect((await findings(e)).some((x) => x.title.startsWith('CVE-2026-1230'))).toBe(false);
    const sup = await findings(e, '{"findingStatus":[{"comparison":"EQUALS","value":"SUPPRESSED"}]}');
    expect(sup).toHaveLength(2);
    // parchear web-1
    const r = await e.json(`ssm send-command --document-name AWS-RunPatchBaseline --parameters Operation=Install,RebootOption=NoReboot --instance-ids ${ids[0]}`);
    e.acct.clock += 5 * MIN;
    void r;
    const after = await findings(e);
    // la línea base aprueba los parches a los 7 días: el de sudo (publicado hace 4) sigue pendiente, y Inspector lo sigue viendo
    expect(after.filter((x) => x.resources[0].id === ids[0]).map((x) => x.title)).toEqual(['CVE-2026-1402 - sudo']);
    const closed = await findings(e, '{"findingStatus":[{"comparison":"EQUALS","value":"CLOSED"}]}');
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((x) => x.status === 'CLOSED' && x.resources[0].id === ids[0])).toBe(true);
    // cobertura
    const cov = await e.json('inspector2 list-coverage');
    expect(cov.coveredResources.filter((x: { scanType: string; scanStatus: { statusCode: string } }) => x.scanType === 'PACKAGE' && x.scanStatus.statusCode === 'ACTIVE')).toHaveLength(2);
  });

  test('un puerto SSH abierto al mundo es un hallazgo de alcanzabilidad de red; sin agente de SSM no hay hallazgos de paquetes', async () => {
    const e = mkEnv({ scenario: 'ec2demo' });
    await e.run('inspector2 enable --resource-types EC2');
    const sg = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId"')) as string;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    const f = await findings(e);
    expect(f.map((x) => x.title)).toEqual(['Port 22 is reachable from an Internet Gateway - TCP']);
    expect(f[0].type).toBe('NETWORK_REACHABILITY');
    const cov = await e.json('inspector2 list-coverage --filter-criteria \'{"scanType":[{"comparison":"EQUALS","value":"PACKAGE"}]}\'');
    expect(cov.coveredResources[0].scanStatus).toEqual({ statusCode: 'INACTIVE', reason: 'UNMANAGED_EC2_INSTANCE' });
    await e.run(`ec2 revoke-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    expect(await findings(e)).toHaveLength(0);
  });

  test('los hallazgos nuevos llegan a EventBridge', async () => {
    const e = mkEnv({ scenario: 'ops-ssm-parches' });
    const q = (await e.json('sqs create-queue --queue-name insp')).QueueUrl as string;
    const qarn = (await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn`)).Attributes.QueueArn as string;
    e.write('qp.json', JSON.stringify({ Policy: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qarn }] }) }));
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes file://qp.json`);
    e.write('pat.json', JSON.stringify({ source: ['aws.inspector2'], 'detail-type': ['Inspector2 Finding'], detail: { severity: ['CRITICAL'] } }));
    await e.run('events put-rule --name criticos --event-pattern file://pat.json');
    await e.run(`events put-targets --rule criticos --targets Id=1,Arn=${qarn}`);
    await e.run('inspector2 enable --resource-types EC2');
    e.acct.clock += 2 * MIN;
    await e.run('sts get-caller-identity');
    const msgs = (await e.json(`sqs receive-message --queue-url ${q} --max-number-of-messages 10`)).Messages as unknown[];
    expect(msgs).toHaveLength(4);
  });
});

describe('Macie', () => {
  const put = async (e: TestEnv, bucket: string, key: string, body: string) => {
    e.write('f.tmp', body);
    await e.run(`s3 cp f.tmp s3://${bucket}/${key}`);
  };
  const open = async (e: TestEnv) => chk(e, 'macie');

  test('sin activar no hay sesión; un trabajo encuentra tarjetas, claves de AWS y DNI en los objetos de texto y los clasifica', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    expect((await e.run('macie2 get-macie-session')).stderr).toContain('AccessDeniedException');
    await e.run('macie2 enable-macie');
    expect((await e.json('macie2 get-macie-session')).status).toBe('ENABLED');
    expect((await e.run('macie2 enable-macie')).stderr).toContain('ConflictException');
    await put(e, 'privado-demo', 'clientes.csv', 'nombre,dni,tarjeta\nAna,12345678Z,4111 1111 1111 1111\nLuis,87654321X,5500 0000 0000 0004\n');
    await put(e, 'privado-demo', 'claves.txt', 'aws_access_key_id=AKIAIOSFODNN7EXAMPLE\n');
    await put(e, 'privado-demo', 'recibo.txt', 'DNI 12345678Z y nada más\n');
    await put(e, 'privado-demo', 'foto.jpg', 'JPEGDATA 4111 1111 1111 1111');
    await put(e, 'privado-demo', 'sin-nada.txt', 'hola mundo\n');
    const job = await e.json(`macie2 create-classification-job --job-type ONE_TIME --name revisar --s3-job-definition '{"bucketDefinitions":[{"accountId":"123456789012","buckets":["privado-demo"]}]}'`);
    expect((await e.json(`macie2 describe-classification-job --job-id ${job.jobId}`)).jobStatus).toBe('RUNNING');
    e.acct.clock += 5 * MIN;
    await e.run('sts get-caller-identity');
    const d = await e.json(`macie2 describe-classification-job --job-id ${job.jobId}`);
    expect(d.jobStatus).toBe('COMPLETE');
    const ids = (await e.json('macie2 list-findings --finding-criteria \'{"criterion":{"category":{"eq":["CLASSIFICATION"]}}}\'')).findingIds as string[];
    expect(ids).toHaveLength(3);
    const fs = (await e.json(`macie2 get-findings --finding-ids ${ids.join(' ')}`)).findings as { type: string; severity: { description: string }; resourcesAffected: { s3Object: { key: string } } }[];
    const by = Object.fromEntries(fs.map((f) => [f.resourcesAffected.s3Object.key, f]));
    expect(by['clientes.csv'].type).toBe('SensitiveData:S3Object/Multiple');
    expect(by['claves.txt']).toMatchObject({ type: 'SensitiveData:S3Object/Credentials', severity: { description: 'High' } });
    expect(by['recibo.txt']).toMatchObject({ type: 'SensitiveData:S3Object/Personal', severity: { description: 'Medium' } });
    expect(by['foto.jpg']).toBeUndefined();
  });

  test('identificadores propios con palabras clave, muestreo y errores', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    await e.run('macie2 enable-macie');
    expect((await e.json('macie2 test-custom-data-identifier --regex "PED-[0-9]{6}" --sample-text "pedido PED-123456 y PED-654321"')).matchCount).toBe(2);
    expect((await e.json('macie2 test-custom-data-identifier --regex "PED-[0-9]{6}" --keywords contrato --sample-text "pedido PED-123456"')).matchCount).toBe(0);
    expect((await e.run('macie2 create-custom-data-identifier --name mal --regex "("')).stderr).toContain('ValidationException');
    const cdi = (await e.json('macie2 create-custom-data-identifier --name pedido --regex "PED-[0-9]{6}"')).customDataIdentifierId as string;
    await put(e, 'privado-demo', 'pedidos.txt', 'PED-111111\n');
    const job = await e.json(`macie2 create-classification-job --job-type ONE_TIME --name p --custom-data-identifier-ids ${cdi} --s3-job-definition '{"bucketDefinitions":[{"accountId":"123456789012","buckets":["privado-demo"]}]}'`);
    e.acct.clock += 5 * MIN;
    await e.run('sts get-caller-identity');
    expect((await open(e)).Types).toContain('SensitiveData:S3Object/CustomIdentifier');
    expect((await e.run(`macie2 create-classification-job --job-type ONE_TIME --name p2 --s3-job-definition '{"bucketDefinitions":[{"accountId":"123456789012","buckets":["no-existe"]}]}'`)).stderr).toContain('ValidationException');
    expect((await e.run(`macie2 create-classification-job --job-type ONE_TIME --name p3 --sampling-percentage 0 --s3-job-definition '{"bucketDefinitions":[{"accountId":"123456789012","buckets":["privado-demo"]}]}'`)).stderr).toContain('ValidationException');
    expect((await e.run(`macie2 update-classification-job --job-id ${job.jobId} --job-status CANCELLED`)).stderr).toContain('ConflictException');
  });

  test('hallazgos de política: bucket público, compartido y sin bloqueo de acceso; se archivan al corregirlos; el filtro ARCHIVE los suprime', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    await e.run('macie2 enable-macie');
    e.write('pub.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::privado-demo/*' }] }));
    await e.run('s3api delete-public-access-block --bucket privado-demo');
    await e.run('s3api put-bucket-policy --bucket privado-demo --policy file://pub.json');
    await e.run('sts get-caller-identity');
    expect((await open(e)).Types).toEqual(expect.arrayContaining(['Policy:IAMUser/S3BucketPublic', 'Policy:IAMUser/S3BlockPublicAccessDisabled']));
    const inv = await e.json('macie2 describe-buckets');
    expect(inv.buckets.find((b: { bucketName: string }) => b.bucketName === 'privado-demo').publicAccess.effectivePermission).toBe('PUBLIC');
    expect((await e.json('macie2 get-bucket-statistics')).bucketCountByEffectivePermission.publiclyAccessible).toBe(1);
    await e.run('s3api delete-bucket-policy --bucket privado-demo');
    await e.run('sts get-caller-identity');
    expect((await open(e)).Types).not.toContain('Policy:IAMUser/S3BucketPublic');
    // regla de supresión
    await e.run(`macie2 create-findings-filter --name sin-bloqueo --action ARCHIVE --finding-criteria '{"criterion":{"type":{"eq":["Policy:IAMUser/S3BlockPublicAccessDisabled"]}}}'`);
    expect((await open(e)).Types).not.toContain('Policy:IAMUser/S3BlockPublicAccessDisabled');
    // bucket compartido con otra cuenta
    e.write('ext.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::999999999999:root' }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::privado-demo/*' }] }));
    await e.run('s3api put-bucket-policy --bucket privado-demo --policy file://ext.json');
    await e.run('sts get-caller-identity');
    expect((await open(e)).Types).toContain('Policy:IAMUser/S3BucketSharedExternally');
  });
});
