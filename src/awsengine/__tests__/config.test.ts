import { imageId } from '../catalog';
import { mkEnv, type TestEnv } from './helpers';

const ACCT = '123456789012';
const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const bucketPolicy = (b: string) =>
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: `arn:aws:s3:::${b}` },
      { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::${b}/AWSLogs/${ACCT}/Config/*` },
    ],
  });

/** Un entorno con el grabador de Config ya encendido. */
async function recorder(global = false) {
  const e = mkEnv();
  await e.run('s3 mb s3://cfg-logs');
  e.write('p.json', bucketPolicy('cfg-logs'));
  await e.run('s3api put-bucket-policy --bucket cfg-logs --policy file://p.json');
  e.write('t.json', trust('config.amazonaws.com'));
  const role = (await e.json('iam create-role --role-name cfg-role --assume-role-policy-document file://t.json')).Role.Arn;
  await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${role} --recording-group allSupported=true,includeGlobalResourceTypes=${global}`);
  await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs');
  await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
  return { e, role };
}
const rule = (name: string, id: string, extra = '') => `configservice put-config-rule --config-rule '${JSON.stringify({ ConfigRuleName: name, Source: { Owner: 'AWS', SourceIdentifier: id }, ...(extra ? JSON.parse(extra) : {}) })}'`;
const compliance = async (e: TestEnv, name: string) => (await e.json(`configservice describe-compliance-by-config-rule --config-rule-names ${name}`)).ComplianceByConfigRules[0].Compliance.ComplianceType as string;
const details = async (e: TestEnv, name: string, types = 'NON_COMPLIANT') => (await e.json(`configservice get-compliance-details-by-config-rule --config-rule-name ${name} --compliance-types ${types}`)).EvaluationResults as { EvaluationResultIdentifier: { EvaluationResultQualifier: { ResourceId: string } }; Annotation?: string }[];
const ids = (r: Awaited<ReturnType<typeof details>>) => r.map((x) => x.EvaluationResultIdentifier.EvaluationResultQualifier.ResourceId).sort();

describe('AWS Config: preparación', () => {
  test('grabador y canal de entrega con sus validaciones', async () => {
    const e = mkEnv();
    e.write('t.json', trust('ec2.amazonaws.com'));
    const bad = (await e.json('iam create-role --role-name mal-rol --assume-role-policy-document file://t.json')).Role.Arn;
    expect((await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${bad}`)).stderr).toContain('InvalidRoleException');
    e.write('t.json', trust('config.amazonaws.com'));
    const role = (await e.json('iam create-role --role-name cfg-role --assume-role-policy-document file://t.json')).Role.Arn;
    expect((await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=arn:aws:iam::${ACCT}:role/fantasma`)).stderr).toContain('The role does not exist');
    await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${role} --recording-group allSupported=true,includeGlobalResourceTypes=true`);
    expect((await e.json('configservice describe-configuration-recorders')).ConfigurationRecorders[0]).toMatchObject({ name: 'default', roleARN: role, recordingGroup: { allSupported: true, includeGlobalResourceTypes: true } });
    // sin canal de entrega no se puede grabar
    expect((await e.run('configservice start-configuration-recorder --configuration-recorder-name default')).stderr).toContain('NoAvailableDeliveryChannelException');
    expect((await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=no-existe')).stderr).toContain('NoSuchBucketException');
    await e.run('s3 mb s3://cfg-logs');
    expect((await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs')).stderr).toContain('InsufficientDeliveryPolicyException');
    e.write('p.json', bucketPolicy('cfg-logs'));
    await e.run('s3api put-bucket-policy --bucket cfg-logs --policy file://p.json');
    await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs');
    expect((await e.json('configservice describe-configuration-recorder-status')).ConfigurationRecordersStatus[0].recording).toBe(false);
    await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
    expect((await e.json('configservice describe-configuration-recorder-status')).ConfigurationRecordersStatus[0]).toMatchObject({ recording: true, lastStatus: 'Success' });
    await e.run('configservice stop-configuration-recorder --configuration-recorder-name default');
    expect((await e.json('configservice describe-configuration-recorder-status')).ConfigurationRecordersStatus[0].recording).toBe(false);
    expect((await e.run('configservice delete-delivery-channel --delivery-channel-name default')).code).toBe(0);
  });

  test('las reglas exigen grabador y un identificador válido', async () => {
    const e = mkEnv();
    expect((await e.run(rule('r', 'S3_BUCKET_VERSIONING_ENABLED'))).stderr).toContain('NoAvailableConfigurationRecorderException');
    const { e: g } = await recorder();
    expect((await g.run(rule('r', 'NO_EXISTE'))).stderr).toContain('The sourceIdentifier NO_EXISTE is invalid');
    expect((await g.run(rule('r', 'REQUIRED_TAGS'))).stderr).toContain('needs a Scope');
    expect((await g.run(rule('r', 'REQUIRED_TAGS', JSON.stringify({ Scope: { ComplianceResourceTypes: ['AWS::EC2::Instance'] } })))).stderr).toContain('requires the parameter tag1Key');
    expect((await g.run(rule('r', 'ACCESS_KEYS_ROTATED', JSON.stringify({ InputParameters: '{"maxEdad":"30"}' })))).stderr).toContain('not valid for the rule');
    expect((await g.run(`configservice describe-config-rules --config-rule-names nada`)).stderr).toContain('NoSuchConfigRuleException');
  });
});

describe('AWS Config: reglas y cumplimiento', () => {
  test('versionado de S3: de NON_COMPLIANT a COMPLIANT al corregirlo, con su historial', async () => {
    const { e } = await recorder();
    await e.run('s3 mb s3://tienda-a');
    await e.run('s3 mb s3://tienda-b');
    await e.run('s3api put-bucket-versioning --bucket tienda-b --versioning-configuration Status=Enabled');
    await e.run(rule('versionado', 'S3_BUCKET_VERSIONING_ENABLED'));
    const r = await e.json('configservice describe-config-rules --config-rule-names versionado');
    expect(r.ConfigRules[0]).toMatchObject({ ConfigRuleName: 'versionado', Source: { Owner: 'AWS', SourceIdentifier: 'S3_BUCKET_VERSIONING_ENABLED' } });
    expect(await compliance(e, 'versionado')).toBe('NON_COMPLIANT');
    const bad = await details(e, 'versionado');
    expect(ids(bad)).toEqual(['cfg-logs', 'tienda-a']);
    expect(bad[0].Annotation).toContain('Versioning is not enabled');
    expect(ids(await details(e, 'versionado', 'COMPLIANT'))).toEqual(['tienda-b']);
    await e.run('s3api put-bucket-versioning --bucket tienda-a --versioning-configuration Status=Enabled');
    await e.run('s3api put-bucket-versioning --bucket cfg-logs --versioning-configuration Status=Enabled');
    expect(await compliance(e, 'versionado')).toBe('COMPLIANT');
    const byRes = await e.json('configservice describe-compliance-by-resource --resource-type AWS::S3::Bucket --compliance-types NON_COMPLIANT');
    expect(byRes.ComplianceByResources).toEqual([]);
    // historial del bucket: descubierto sin versionado y luego con versionado
    const h = (await e.json('configservice get-resource-config-history --resource-type AWS::S3::Bucket --resource-id tienda-a --chronological-order Forward')).configurationItems;
    expect(h).toHaveLength(2);
    expect(h[0].configurationItemStatus).toBe('ResourceDiscovered');
    expect(JSON.parse(h[0].configuration).versioning).toBe('Off');
    expect(JSON.parse(h[1].configuration).versioning).toBe('Enabled');
    expect(h[1].arn).toBe('arn:aws:s3:::tienda-a');
    const disc = await e.json('configservice list-discovered-resources --resource-type AWS::S3::Bucket');
    expect(disc.resourceIdentifiers.map((x: { resourceId: string }) => x.resourceId).sort()).toEqual(['cfg-logs', 'tienda-a', 'tienda-b']);
    const sum = await e.json('configservice get-compliance-summary-by-config-rule');
    expect(sum.ComplianceSummary.CompliantResourceCount.CappedCount).toBe(1);
    expect((await e.json('configservice get-compliance-summary-by-resource-type')).ComplianceSummariesByResourceType[0].ComplianceSummary.CompliantResourceCount.CappedCount).toBe(3);
  });

  test('grupo de seguridad con SSH abierto al mundo', async () => {
    const { e } = await recorder();
    const vpc = await e.json('ec2 describe-vpcs --query Vpcs[0].VpcId');
    const sg = (await e.json(`ec2 create-security-group --group-name web --description web --vpc-id ${vpc}`)).GroupId;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    await e.run(rule('sin-ssh', 'INCOMING_SSH_DISABLED'));
    expect(await compliance(e, 'sin-ssh')).toBe('NON_COMPLIANT');
    expect(ids(await details(e, 'sin-ssh'))).toContain(sg);
    // el SG por defecto no abre SSH
    await e.run(`ec2 revoke-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    expect(await compliance(e, 'sin-ssh')).toBe('COMPLIANT');
    await e.run(rule('restringido', 'RESTRICTED_INCOMING_TRAFFIC', JSON.stringify({ InputParameters: '{"blockedPort1":"3389","blockedPort2":"8080"}' })));
    expect(await compliance(e, 'restringido')).toBe('COMPLIANT');
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 8000-9000 --cidr 0.0.0.0/0`);
    expect(await compliance(e, 'restringido')).toBe('NON_COMPLIANT');
    expect((await details(e, 'restringido'))[0].Annotation).toContain('port 8080');
  });

  test('etiquetas obligatorias con alcance por tipo de recurso', async () => {
    const { e } = await recorder();
    const ami = imageId('us-east-1', 'al2023-x86');
    const a = (await e.json(`ec2 run-instances --image-id ${ami} --instance-type t3.micro --tag-specifications 'ResourceType=instance,Tags=[{Key=Entorno,Value=prod}]' --query Instances[0].InstanceId`)) as string;
    const b = (await e.json(`ec2 run-instances --image-id ${ami} --instance-type t3.micro --query Instances[0].InstanceId`)) as string;
    await e.run(rule('etiquetas', 'REQUIRED_TAGS', JSON.stringify({ Scope: { ComplianceResourceTypes: ['AWS::EC2::Instance'] }, InputParameters: '{"tag1Key":"Entorno","tag1Value":"prod,dev"}' })));
    expect(ids(await details(e, 'etiquetas'))).toEqual([b]);
    expect(ids(await details(e, 'etiquetas', 'COMPLIANT'))).toEqual([a]);
    await e.run(`ec2 create-tags --resources ${b} --tags Key=Entorno,Value=test`);
    expect((await details(e, 'etiquetas'))[0].Annotation).toContain('not allowed');
    await e.run(`ec2 create-tags --resources ${b} --tags Key=Entorno,Value=dev`);
    expect(await compliance(e, 'etiquetas')).toBe('COMPLIANT');
    // terminar una instancia la marca como borrada en el historial
    await e.run(`ec2 terminate-instances --instance-ids ${b}`);
    await e.run('sts get-caller-identity');
    const h = (await e.json(`configservice get-resource-config-history --resource-type AWS::EC2::Instance --resource-id ${b}`)).configurationItems;
    expect(h[0].configurationItemStatus).not.toBe('ResourceDiscovered');
  });

  test('las reglas de IAM requieren registrar los recursos globales', async () => {
    const without = await recorder(false);
    await without.e.run('iam create-user --user-name ana');
    await without.e.run(rule('mfa', 'IAM_USER_MFA_ENABLED'));
    expect(await compliance(without.e, 'mfa')).toBe('INSUFFICIENT_DATA');
    const { e } = await recorder(true);
    await e.run('iam create-user --user-name ana');
    await e.run(rule('mfa', 'IAM_USER_MFA_ENABLED'));
    expect(await compliance(e, 'mfa')).toBe('NON_COMPLIANT');
    expect(ids(await details(e, 'mfa')).length).toBeGreaterThan(0);
    const u = (await e.json('configservice list-discovered-resources --resource-type AWS::IAM::User')).resourceIdentifiers;
    expect(u.some((x: { resourceName: string }) => x.resourceName === 'ana')).toBe(true);
    await e.run(rule('sin-politicas', 'IAM_USER_NO_POLICIES_CHECK'));
    const ana = (await e.json('iam get-user --user-name ana --query User.UserId')) as string;
    expect(ids(await details(e, 'sin-politicas', 'COMPLIANT'))).toContain(ana);
    await e.run('iam attach-user-policy --user-name ana --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess');
    expect(ids(await details(e, 'sin-politicas'))).toContain(ana);
    expect(await compliance(e, 'sin-politicas')).toBe('NON_COMPLIANT');
  });

  test('parar el grabador congela el historial; borrar la regla borra sus resultados', async () => {
    const { e } = await recorder();
    await e.run('s3 mb s3://uno');
    await e.run(rule('ver', 'S3_BUCKET_VERSIONING_ENABLED'));
    await e.run('configservice stop-configuration-recorder --configuration-recorder-name default');
    await e.run('s3 mb s3://dos');
    const found = (await e.json('configservice list-discovered-resources --resource-type AWS::S3::Bucket')).resourceIdentifiers.map((x: { resourceId: string }) => x.resourceId);
    expect(found).toContain('uno');
    expect(found).not.toContain('dos');
    await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
    expect((await e.json('configservice list-discovered-resources --resource-type AWS::S3::Bucket')).resourceIdentifiers.map((x: { resourceId: string }) => x.resourceId)).toContain('dos');
    await e.run('configservice delete-config-rule --config-rule-name ver');
    expect((await e.json('configservice describe-config-rules')).ConfigRules).toEqual([]);
    expect((await e.run('configservice delete-config-rule --config-rule-name ver')).stderr).toContain('NoSuchConfigRuleException');
  });

  test('el cambio de cumplimiento llega a EventBridge', async () => {
    const { e } = await recorder();
    const q = (await e.json('sqs create-queue --queue-name cumplimiento')).QueueUrl;
    const qArn = await e.json(`sqs get-queue-attributes --queue-url ${q} --attribute-names QueueArn --query Attributes.QueueArn`);
    const r = (await e.json(`events put-rule --name cfg --event-pattern '{"source":["aws.config"],"detail-type":["Config Rules Compliance Change"],"detail":{"newEvaluationResult":{"complianceType":["NON_COMPLIANT"]}}}'`)).RuleArn;
    await e.run(`events put-targets --rule cfg --targets Id=q,Arn=${qArn}`);
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: qArn, Condition: { ArnEquals: { 'aws:SourceArn': r } } }] });
    await e.run(`sqs set-queue-attributes --queue-url ${q} --attributes '{"Policy":${JSON.stringify(pol)}}'`);
    await e.run('s3 mb s3://sin-version');
    await e.run(rule('ver', 'S3_BUCKET_VERSIONING_ENABLED'));
    await e.run('sts get-caller-identity');
    const m = await e.json(`sqs receive-message --queue-url ${q} --max-number-of-messages 10`);
    const evs = (m.Messages as { Body: string }[]).map((x) => JSON.parse(x.Body));
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0].source).toBe('aws.config');
    expect(evs[0].detail).toMatchObject({ configRuleName: 'ver', messageType: 'ComplianceChangeNotification' });
  });
});
