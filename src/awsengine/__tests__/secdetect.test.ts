import { mkEnv, type TestEnv } from './helpers';

async function chk(e: TestEnv, line: string) {
  e.io.god = true;
  try {
    return await e.json(`_check ${line}`);
  } finally {
    e.io.god = false;
  }
}
const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const ACCT = '123456789012';
const bucketPolicy = (b: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:GetBucketAcl', Resource: `arn:aws:s3:::${b}` }, { Effect: 'Allow', Principal: { Service: 'config.amazonaws.com' }, Action: 's3:PutObject', Resource: `arn:aws:s3:::${b}/AWSLogs/${ACCT}/Config/*` }] });
async function configOn(e: TestEnv) {
  await e.run('s3 mb s3://cfg-logs');
  e.write('p.json', bucketPolicy('cfg-logs'));
  await e.run('s3api put-bucket-policy --bucket cfg-logs --policy file://p.json');
  e.write('t.json', trust('config.amazonaws.com'));
  const role = (await e.json('iam create-role --role-name cfg-role --assume-role-policy-document file://t.json')).Role.Arn;
  await e.run(`configservice put-configuration-recorder --configuration-recorder name=default,roleARN=${role} --recording-group allSupported=true`);
  await e.run('configservice put-delivery-channel --delivery-channel name=default,s3BucketName=cfg-logs');
  await e.run('configservice start-configuration-recorder --configuration-recorder-name default');
}

describe('IAM Access Analyzer', () => {
  const list = async (e: TestEnv, arn: string, filter = '') => (await e.json(`accessanalyzer list-findings --analyzer-arn ${arn} ${filter}`)).findings as { id: string; resource: string; resourceType: string; isPublic: boolean; status: string; principal: Record<string, string>; action: string[] }[];

  test('un bucket público, un bucket compartido con otra cuenta y un rol que confía en otra cuenta son hallazgos; al corregirlos pasan a RESOLVED', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    const an = (await e.json('accessanalyzer create-analyzer --analyzer-name cuenta --type ACCOUNT')).arn as string;
    expect(await list(e, an)).toHaveLength(0);
    e.write('pub.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::fotos-demo/*' }] }));
    e.write('ext.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::999999999999:root' }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::privado-demo/*' }] }));
    e.write('org.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::logs-app/*', Condition: { StringEquals: { 'aws:PrincipalOrgID': 'o-1234567890' } } }] }));
    await e.run('s3api delete-public-access-block --bucket fotos-demo');
    await e.run('s3api put-bucket-policy --bucket fotos-demo --policy file://pub.json');
    await e.run('s3api put-bucket-policy --bucket privado-demo --policy file://ext.json');
    e.write('trust.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: '999999999999' }, Action: 'sts:AssumeRole' }] }));
    await e.run('iam create-role --role-name auditor-externo --assume-role-policy-document file://trust.json');
    const f = await list(e, an);
    const by = Object.fromEntries(f.map((x) => [x.resource.replace(/^.*[:/]/, ''), x]));
    expect(by['fotos-demo']).toMatchObject({ resourceType: 'AWS::S3::Bucket', isPublic: true, principal: { AWS: '*' }, status: 'ACTIVE' });
    expect(by['privado-demo']).toMatchObject({ isPublic: false, principal: { AWS: '999999999999' } });
    expect(by['auditor-externo']).toMatchObject({ resourceType: 'AWS::IAM::Role', action: ['sts:AssumeRole'] });
    expect(f).toHaveLength(3);
    // el detalle
    expect((await e.json(`accessanalyzer get-finding --analyzer-arn ${an} --id ${by['fotos-demo'].id}`)).finding.resource).toBe('arn:aws:s3:::fotos-demo');
    // corregir
    await e.run('s3api delete-bucket-policy --bucket fotos-demo');
    const after = await list(e, an);
    expect(after.find((x) => x.resource.endsWith('fotos-demo'))!.status).toBe('RESOLVED');
    expect(await list(e, an, '--filter \'{"status":{"eq":["ACTIVE"]}}\'')).toHaveLength(2);
  });

  test('archivar, reglas de archivo, un solo analizador de cuenta por región', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    const an = (await e.json('accessanalyzer create-analyzer --analyzer-name cuenta --type ACCOUNT')).arn as string;
    expect((await e.run('accessanalyzer create-analyzer --analyzer-name otro --type ACCOUNT')).stderr).toContain('ServiceQuotaExceededException');
    expect((await e.run('accessanalyzer create-analyzer --analyzer-name org --type ORGANIZATION')).stderr).toContain('ValidationException');
    e.write('ext.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: ['arn:aws:iam::999999999999:root', 'arn:aws:iam::888888888888:root'] }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::privado-demo/*' }] }));
    await e.run('s3api put-bucket-policy --bucket privado-demo --policy file://ext.json');
    const f = await list(e, an);
    expect(f).toHaveLength(2);
    await e.run(`accessanalyzer update-findings --analyzer-arn ${an} --status ARCHIVED --ids ${f[0].id}`);
    expect(await list(e, an, '--filter \'{"status":{"eq":["ACTIVE"]}}\'')).toHaveLength(1);
    await e.run(`accessanalyzer create-archive-rule --analyzer-name cuenta --rule-name socio --filter '{"principal.AWS":{"eq":["888888888888"]}}'`);
    expect(await list(e, an, '--filter \'{"status":{"eq":["ACTIVE"]}}\'')).toHaveLength(0);
    expect((await e.json('accessanalyzer list-archive-rules --analyzer-name cuenta')).archiveRules[0].ruleName).toBe('socio');
    // un acceso futuro de la misma cuenta ya nace archivado
    e.write('ext2.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: '888888888888' }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::fotos-demo/*' }] }));
    await e.run('s3api put-bucket-policy --bucket fotos-demo --policy file://ext2.json');
    expect(await list(e, an, '--filter \'{"status":{"eq":["ACTIVE"]}}\'')).toHaveLength(0);
  });

  test('validate-policy: errores, avisos de seguridad y sugerencias', async () => {
    const e = mkEnv();
    const v = async (doc: unknown, type = 'IDENTITY_POLICY') => {
      e.write('d.json', JSON.stringify(doc));
      return (await e.json(`accessanalyzer validate-policy --policy-document file://d.json --policy-type ${type}`)).findings as { issueCode: string; findingType: string }[];
    };
    const codes = (l: { issueCode: string }[]) => l.map((x) => x.issueCode).sort();
    expect(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::b/*' }] })).toEqual([]);
    expect(codes(await v({ Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] }))).toEqual(['MISSING_VERSION']);
    expect(codes(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Permit', Action: 's3:GetObjects', Resource: '*' }] }))).toEqual(['INVALID_ACTION', 'INVALID_EFFECT']);
    const pr = await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'iam:PassRole', Resource: '*' }] });
    expect(pr).toEqual([expect.objectContaining({ issueCode: 'PASS_ROLE_WITH_STAR_IN_RESOURCE', findingType: 'SECURITY_WARNING' })]);
    expect(codes(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 's3:GetObject'], Resource: '*' }] }))).toEqual(['REDUNDANT_ACTION']);
    expect(codes(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject' }] }))).toEqual(['MISSING_RESOURCE']);
    expect(codes(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }] }, 'RESOURCE_POLICY'))).toEqual(['MISSING_PRINCIPAL']);
    expect(codes(await v({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', NotAction: 'iam:*', Resource: '*' }] }))).toEqual(['ALLOW_WITH_NOT_ACTION']);
    e.write('bad.json', '{ no es json');
    expect((await e.run('accessanalyzer validate-policy --policy-document file://bad.json --policy-type IDENTITY_POLICY')).stderr).toContain('ValidationException');
  });
});

describe('Security Hub', () => {
  const failed = async (e: TestEnv) => (await chk(e, 'securityhub'))['us-east-1'].FailedControls as string[];

  test('sin AWS Config los estándares quedan INCOMPLETE y no hay hallazgos de control; al encenderlo, se evalúan', async () => {
    const e = mkEnv({ scenario: 's3demo' });
    expect((await e.run('securityhub describe-hub')).stderr).toContain('InvalidAccessException');
    await e.run('securityhub enable-security-hub');
    expect((await e.run('securityhub enable-security-hub')).stderr).toContain('ResourceConflictException');
    const std = (await e.json('securityhub get-enabled-standards')).StandardsSubscriptions as { StandardsStatus: string; StandardsStatusReason?: { StatusReasonCode: string } }[];
    expect(std).toHaveLength(2);
    expect(std[0]).toMatchObject({ StandardsStatus: 'INCOMPLETE', StandardsStatusReason: { StatusReasonCode: 'NO_AVAILABLE_CONFIGURATION_RECORDER' } });
    expect((await e.json('securityhub get-findings --filters \'{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}]}\'')).Findings).toHaveLength(0);
    await configOn(e);
    expect(((await e.json('securityhub get-enabled-standards')).StandardsSubscriptions as { StandardsStatus: string }[])[0].StandardsStatus).toBe('READY');
    const f = (await e.json('securityhub get-findings --filters \'{"ComplianceStatus":[{"Value":"FAILED","Comparison":"EQUALS"}],"SeverityLabel":[{"Value":"HIGH","Comparison":"EQUALS"}]}\'')).Findings as { Title: string; ProductFields: { ControlId: string }; Compliance: { Status: string }; Severity: { Label: string } }[];
    expect(f.map((x) => x.ProductFields.ControlId)).toEqual(expect.arrayContaining(['EC2.2', 'GuardDuty.1', 'CloudTrail.1']));
    expect(f.every((x) => x.Severity.Label === 'HIGH' && x.Compliance.Status === 'FAILED')).toBe(true);
  });

  test('arreglar el recurso pone el control en PASSED; desactivar un control lo quita; las SG abiertas y las claves sin rotación se detectan', async () => {
    const e = mkEnv({ scenario: 'ec2demo' });
    await configOn(e);
    await e.run('securityhub enable-security-hub');
    const sg = (await e.json('ec2 describe-instances --filters Name=tag:Name,Values=web-1 --query "Reservations[0].Instances[0].SecurityGroups[0].GroupId"')) as string;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    expect(await failed(e)).toEqual(expect.arrayContaining(['EC2.13', '4.1']));
    const k = (await e.json('kms create-key --query KeyMetadata.KeyId')) as string;
    expect(await failed(e)).toContain('KMS.4');
    await e.run(`kms enable-key-rotation --key-id ${k}`);
    expect(await failed(e)).not.toContain('KMS.4');
    await e.run(`ec2 revoke-security-group-ingress --group-id ${sg} --protocol tcp --port 22 --cidr 0.0.0.0/0`);
    expect(await failed(e)).not.toContain('EC2.13');
    // desactivar un control exige motivo
    const subs = (await e.json('securityhub get-enabled-standards')).StandardsSubscriptions as { StandardsSubscriptionArn: string }[];
    const fsbp = subs.find((s) => s.StandardsSubscriptionArn.includes('aws-foundational'))!.StandardsSubscriptionArn;
    const ctl = ((await e.json(`securityhub describe-standards-controls --standards-subscription-arn ${fsbp}`)).Controls as { ControlId: string; StandardsControlArn: string }[]).find((c) => c.ControlId === 'GuardDuty.1')!;
    expect((await e.run(`securityhub update-standards-control --standards-control-arn ${ctl.StandardsControlArn} --control-status DISABLED`)).stderr).toContain('DisabledReason');
    expect(await failed(e)).toContain('GuardDuty.1');
    await e.run(`securityhub update-standards-control --standards-control-arn ${ctl.StandardsControlArn} --control-status DISABLED --disabled-reason "Lo gestiona el equipo de seguridad"`);
    expect(await failed(e)).not.toContain('GuardDuty.1');
  });

  test('integra los hallazgos de GuardDuty, Inspector y Access Analyzer; se pueden suprimir con batch-update-findings', async () => {
    const e = mkEnv({ scenario: 'ops-ssm-parches' });
    await e.run('securityhub enable-security-hub --no-enable-default-standards');
    const id = (await e.json('guardduty create-detector --enable')).DetectorId as string;
    await e.run('inspector2 enable --resource-types EC2');
    await e.run(`guardduty create-sample-findings --detector-id ${id} --finding-types UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS`);
    const q = async (p: string) => (await e.json(`securityhub get-findings --filters '{"ProductName":[{"Value":"${p}","Comparison":"EQUALS"}]}'`)).Findings as { Id: string; ProductArn: string; Severity: { Label: string }; Workflow: { Status: string } }[];
    const gd = await q('GuardDuty');
    expect(gd).toHaveLength(1);
    expect(gd[0].Severity.Label).toBe('HIGH');
    expect((await q('Inspector')).length).toBe(12);
    // suprimir
    const r = await e.json(`securityhub batch-update-findings --finding-identifiers Id=${gd[0].Id},ProductArn=${gd[0].ProductArn} --workflow Status=SUPPRESSED --note Text=falso-positivo,UpdatedBy=ana`);
    expect(r.ProcessedFindings).toHaveLength(1);
    expect((await q('GuardDuty'))[0].Workflow.Status).toBe('SUPPRESSED');
    expect((await e.run('securityhub batch-update-findings --finding-identifiers Id=nada,ProductArn=x --workflow Status=SUPPRESSED')).stdout).toContain('FindingNotFound');
    await e.run(`securityhub disable-import-findings-for-product --product-subscription-arn arn:aws:securityhub:us-east-1:123456789012:product-subscription/aws/guardduty`);
    expect(await q('GuardDuty')).toHaveLength(0);
  });
});

describe('SCP', () => {
  async function org() {
    const e = mkEnv();
    await e.run('organizations create-organization --feature-set ALL');
    const root = (await e.json('organizations list-roots --query Roots[0].Id')) as string;
    const ou = (await e.json(`organizations create-organizational-unit --parent-id ${root} --name Produccion --query OrganizationalUnit.Id`)) as string;
    const req = (await e.json(`organizations create-account --email dev@ejemplo.com --account-name desarrollo --query CreateAccountStatus.Id`)) as string;
    void req;
    const id = (await e.json('organizations list-accounts --query "Accounts[?Name==`desarrollo`].Id | [0]"')) as string;
    return { e, root, ou, id };
  }
  test('una SCP de denegación bloquea la acción en las cuentas debajo; un Allow en un nivel no basta si otro nivel no lo permite; la cuenta de administración queda fuera', async () => {
    const { e, root, ou, id } = await org();
    const q = async (a: string, extra = '') => chk(e, `scp --account desarrollo --action ${a} ${extra}`);
    expect((await q('ec2:RunInstances')).Allowed).toBe(true);
    const deny = '{"Version":"2012-10-17","Statement":[{"Effect":"Deny","Action":["ec2:RunInstances"],"Resource":"*","Condition":{"StringNotEquals":{"aws:RequestedRegion":["eu-west-1"]}}}]}';
    const pid = (await e.json(`organizations create-policy --name solo-irlanda --description x --type SERVICE_CONTROL_POLICY --content '${deny}' --query Policy.PolicySummary.Id`)) as string;
    await e.run(`organizations attach-policy --policy-id ${pid} --target-id ${root}`);
    expect((await q('ec2:RunInstances', '--context aws:RequestedRegion=us-east-1')).Allowed).toBe(false);
    const r = await q('ec2:RunInstances', '--context aws:RequestedRegion=us-east-1');
    expect(r).toMatchObject({ Reason: 'explicitDeny', Level: 'Root', Policy: 'solo-irlanda' });
    expect((await q('ec2:RunInstances', '--context aws:RequestedRegion=eu-west-1')).Allowed).toBe(true);
    // mover la cuenta a una OU y aplicarle una lista de permitidos: lo que no está en la lista, no se puede
    await e.run(`organizations move-account --account-id ${id} --source-parent-id ${root} --destination-parent-id ${ou}`);
    const allow = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*","dynamodb:*"],"Resource":"*"}]}';
    const aid = (await e.json(`organizations create-policy --name solo-datos --description x --type SERVICE_CONTROL_POLICY --content '${allow}' --query Policy.PolicySummary.Id`)) as string;
    await e.run(`organizations attach-policy --policy-id ${aid} --target-id ${ou}`);
    // la OU nace con FullAWSAccess: para que sea una lista de permitidos hay que quitársela
    expect((await q('ec2:DescribeInstances')).Allowed).toBe(true);
    const full = ((await e.json('organizations list-policies --filter SERVICE_CONTROL_POLICY')).Policies as { Id: string; Name: string }[]).find((p) => p.Name === 'FullAWSAccess')!.Id;
    await e.run(`organizations detach-policy --policy-id ${full} --target-id ${ou}`);
    expect(await q('s3:GetObject')).toMatchObject({ Allowed: true });
    expect(await q('ec2:DescribeInstances')).toMatchObject({ Allowed: false, Reason: 'noAllow', Level: 'Produccion' });
    // y si se la quitas a la raíz teniendo solo una SCP de denegación, nadie puede hacer nada: una SCP de Deny no concede
    await e.run(`organizations detach-policy --policy-id ${full} --target-id ${root}`);
    expect(await q('s3:GetObject')).toMatchObject({ Allowed: false, Reason: 'noAllow', Level: 'Root' });
    expect((await chk(e, 'scp --account cuenta-principal --action ec2:RunInstances')).Reason).toBe('management');
    expect((await q('s3:GetObject')).Chain.map((c: { Level: string }) => c.Level)).toEqual(['Root', 'Produccion', 'desarrollo']);
  });
});
