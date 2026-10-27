import { mkEnv, type TestEnv } from './helpers';

const ACCT = '123456789012';
const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const bucketPolicy = (b: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: `arn:aws:s3:::${b}` }, { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::${b}/AWSLogs/${ACCT}/Config/*` }] });

async function recorder(scenario?: string) {
  const e = mkEnv(scenario ? { scenario } : {});
  await e.run('s3 mb s3://cfg-logs');
  e.write('p.json', bucketPolicy('cfg-logs'));
  await e.run('s3api put-bucket-policy --bucket cfg-logs --policy file://p.json');
  e.write('t.json', trust('config.amazonaws.com'));
  const role = (await e.json('iam create-role --role-name cfg-role --assume-role-policy-document file://t.json')).Role.Arn;
  await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${role} --recording-group allSupported=true`);
  await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs');
  await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
  return e;
}
const rule = (name: string, id: string, extra: Record<string, unknown> = {}) => `configservice put-config-rule --config-rule '${JSON.stringify({ ConfigRuleName: name, Source: { Owner: 'AWS', SourceIdentifier: id }, ...extra })}'`;
const compliance = async (e: TestEnv, name: string) => (await e.json(`configservice describe-compliance-by-config-rule --config-rule-names ${name}`)).ComplianceByConfigRules[0].Compliance.ComplianceType as string;

describe('AWS Config: reglas de seguridad', () => {
  test('rotación de claves de KMS y claves programadas para borrarse', async () => {
    const e = await recorder();
    const k = (await e.json('kms create-key --description datos --query KeyMetadata.KeyId')) as string;
    await e.run(rule('rotacion', 'CMK_BACKING_KEY_ROTATION_ENABLED'));
    await e.run(rule('sin-borrado', 'KMS_CMK_NOT_SCHEDULED_FOR_DELETION'));
    expect(await compliance(e, 'rotacion')).toBe('NON_COMPLIANT');
    expect(await compliance(e, 'sin-borrado')).toBe('COMPLIANT');
    await e.run(`kms enable-key-rotation --key-id ${k}`);
    expect(await compliance(e, 'rotacion')).toBe('COMPLIANT');
    await e.run(`kms schedule-key-deletion --key-id ${k} --pending-window-in-days 7`);
    expect(await compliance(e, 'sin-borrado')).toBe('NON_COMPLIANT');
    // las claves administradas por AWS no cuentan
    const r = await e.json('configservice get-compliance-details-by-config-rule --config-rule-name rotacion');
    expect(r.EvaluationResults.every((x: { EvaluationResultIdentifier: { EvaluationResultQualifier: { ResourceId: string } } }) => x.EvaluationResultIdentifier.EvaluationResultQualifier.ResourceId === k)).toBe(true);
  });

  test('ALB sin ACL de WAF no cumple ALB_WAF_ENABLED; al asociarla, sí', async () => {
    const e = await recorder('cont-ecs');
    await e.run(rule('alb-waf', 'ALB_WAF_ENABLED'));
    expect(await compliance(e, 'alb-waf')).toBe('NON_COMPLIANT');
    const lb = (await e.json('elbv2 describe-load-balancers --names web')).LoadBalancers[0] as { LoadBalancerArn: string };
    const acl = (await e.json('wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=t')).Summary as { ARN: string };
    await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn ${lb.LoadBalancerArn}`);
    expect(await compliance(e, 'alb-waf')).toBe('COMPLIANT');
  });

  test('secretos sin rotación y certificados a punto de caducar', async () => {
    const e = await recorder();
    await e.run('secretsmanager create-secret --name db/clave --secret-string hola');
    await e.run(rule('rotacion-secretos', 'SECRETSMANAGER_ROTATION_ENABLED_CHECK'));
    expect(await compliance(e, 'rotacion-secretos')).toBe('NON_COMPLIANT');
    // un certificado importado/emitido: la regla compara los días que le quedan
    const zone = (await e.json('route53 create-hosted-zone --name tienda.test --caller-reference z1')).HostedZone.Id as string;
    const arn = (await e.json('acm request-certificate --domain-name tienda.test --validation-method DNS')).CertificateArn as string;
    const rec = (await e.json(`acm describe-certificate --certificate-arn ${arn}`)).Certificate.DomainValidationOptions[0].ResourceRecord as { Name: string; Value: string };
    e.write('b.json', JSON.stringify({ Changes: [{ Action: 'UPSERT', ResourceRecordSet: { Name: rec.Name, Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: rec.Value }] } }] }));
    await e.run(`route53 change-resource-record-sets --hosted-zone-id ${zone.replace('/hostedzone/', '')} --change-batch file://b.json`);
    await e.run(rule('caducidad', 'ACM_CERTIFICATE_EXPIRATION_CHECK', { InputParameters: '{"daysToExpiration":"30"}' }));
    expect(await compliance(e, 'caducidad')).toBe('COMPLIANT');
    e.acct.clock += 380 * 86400000;
    expect(await compliance(e, 'caducidad')).toBe('NON_COMPLIANT');
  });
});
