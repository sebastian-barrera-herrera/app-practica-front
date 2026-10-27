import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });

export const ROTATE = `import json

import boto3

sm = boto3.client('secretsmanager')


def lambda_handler(event, context):
    arn, token, step = event['SecretId'], event['ClientRequestToken'], event['Step']
    versions = sm.describe_secret(SecretId=arn)['VersionIdsToStages']
    if token not in versions:
        raise ValueError('La version %s no esta preparada para la rotacion' % token)
    if 'AWSCURRENT' in versions[token]:
        return
    if step == 'createSecret':
        actual = json.loads(sm.get_secret_value(SecretId=arn, VersionStage='AWSCURRENT')['SecretString'])
        try:
            sm.get_secret_value(SecretId=arn, VersionId=token, VersionStage='AWSPENDING')
        except sm.exceptions.ResourceNotFoundException:
            actual['password'] = sm.get_random_password(PasswordLength=24, ExcludePunctuation=True)['RandomPassword']
            sm.put_secret_value(SecretId=arn, ClientRequestToken=token, SecretString=json.dumps(actual), VersionStages=['AWSPENDING'])
    elif step == 'setSecret':
        print('Aqui se cambiaria la contrasena en la base de datos')
    elif step == 'testSecret':
        nueva = json.loads(sm.get_secret_value(SecretId=arn, VersionId=token, VersionStage='AWSPENDING')['SecretString'])
        if not nueva.get('password'):
            raise ValueError('La contrasena nueva esta vacia')
    elif step == 'finishSecret':
        actual = [v for v, st in versions.items() if 'AWSCURRENT' in st][0]
        sm.update_secret_version_stage(SecretId=arn, VersionStage='AWSCURRENT', MoveToVersionId=token, RemoveFromVersionId=actual)
`;

const day = (e: TestEnv, n: number) => {
  e.acct.clock += n * 86400000;
};

async function setup() {
  const e = mkEnv({ scenario: 'equipo' });
  await e.run(`secretsmanager create-secret --name prod/db --secret-string '{"username":"app","password":"vieja"}'`);
  e.write('rotar.zip', zip({ 'lambda_function.py': ROTATE }));
  e.write('t.json', TRUST('lambda.amazonaws.com'));
  const role = (await e.json('iam create-role --role-name rotar-rol --assume-role-policy-document file://t.json')).Role.Arn as string;
  await e.run('iam attach-role-policy --role-name rotar-rol --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
  const fn = (await e.json(`lambda create-function --function-name rotar --runtime python3.12 --role ${role} --handler lambda_function.lambda_handler --zip-file fileb://rotar.zip --timeout 10`)).FunctionArn as string;
  return { e, fn };
}
const stages = async (e: TestEnv) => (await e.json('secretsmanager describe-secret --secret-id prod/db')).VersionIdsToStages as Record<string, string[]>;

describe('Secrets Manager: rotación con Lambda', () => {
  test('la función necesita el permiso de Secrets Manager y su rol, y la rotación mueve las etiquetas', async () => {
    const { e, fn } = await setup();
    // 1) Secrets Manager no puede invocar la función
    expect((await e.run(`secretsmanager rotate-secret --secret-id prod/db --rotation-lambda-arn ${fn} --rotation-rules AutomaticallyAfterDays=30`)).stderr).toContain('Ensure that the function policy grants access to the principal secretsmanager.amazonaws.com');
    await e.run('lambda add-permission --function-name rotar --statement-id sm --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com');
    // 2) el rol de la función no puede tocar el secreto: la rotación se queda a medias
    expect((await e.run(`secretsmanager rotate-secret --secret-id prod/db --rotation-lambda-arn ${fn} --rotation-rules AutomaticallyAfterDays=30`)).code).toBe(0);
    let d = await e.json('secretsmanager describe-secret --secret-id prod/db');
    expect(d.RotationEnabled).toBe(true);
    expect(d.RotationRules).toEqual({ AutomaticallyAfterDays: 30 });
    expect(d.LastRotatedDate).toBeUndefined();
    expect(Object.values(await stages(e)).some((s) => s.includes('AWSPENDING'))).toBe(true);
    expect(JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString).password).toBe('vieja');
    // 3) con permisos, la rotación termina: nueva AWSCURRENT, la vieja AWSPREVIOUS
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:UpdateSecretVersionStage', 'secretsmanager:GetRandomPassword'], Resource: '*' }] }));
    await e.run('iam put-role-policy --role-name rotar-rol --policy-name sm --policy-document file://p.json');
    await e.run(`secretsmanager rotate-secret --secret-id prod/db --rotation-lambda-arn ${fn}`);
    d = await e.json('secretsmanager describe-secret --secret-id prod/db');
    expect(d.LastRotatedDate).toBeTruthy();
    expect(d.NextRotationDate).toBeTruthy();
    const st = Object.values(await stages(e)).map((s) => s.join('+')).sort();
    expect(st).toEqual(['AWSCURRENT', 'AWSPREVIOUS']);
    const nueva = JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString);
    expect(nueva.password).not.toBe('vieja');
    expect(nueva.password).toHaveLength(24);
    expect(nueva.username).toBe('app');
    expect(JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db --version-stage AWSPREVIOUS')).SecretString).password).toBe('vieja');
    expect((await e.json('secretsmanager list-secret-version-ids --secret-id prod/db')).Versions).toHaveLength(2);
  });

  test('rotación programada y cancelación', async () => {
    const { e, fn } = await setup();
    await e.run('lambda add-permission --function-name rotar --statement-id sm --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com');
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:*', Resource: '*' }] }));
    await e.run('iam put-role-policy --role-name rotar-rol --policy-name sm --policy-document file://p.json');
    await e.run(`secretsmanager rotate-secret --secret-id prod/db --rotation-lambda-arn ${fn} --rotation-rules AutomaticallyAfterDays=7 --no-rotate-immediately`);
    expect(Object.keys(await stages(e))).toHaveLength(1);
    day(e, 8);
    await e.run('sts get-caller-identity');
    const first = JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString).password;
    expect(first).not.toBe('vieja');
    day(e, 8);
    await e.run('sts get-caller-identity');
    expect(JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString).password).not.toBe(first);
    await e.run('secretsmanager cancel-rotate-secret --secret-id prod/db');
    expect((await e.json('secretsmanager describe-secret --secret-id prod/db')).RotationEnabled).toBe(false);
    const cur = JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString).password;
    day(e, 30);
    await e.run('sts get-caller-identity');
    expect(JSON.parse((await e.json('secretsmanager get-secret-value --secret-id prod/db')).SecretString).password).toBe(cur);
    expect((await e.run('secretsmanager cancel-rotate-secret --secret-id prod/db')).stderr).toContain('does not have rotation enabled');
    expect((await e.run('secretsmanager rotate-secret --secret-id prod/db --rotation-rules AutomaticallyAfterDays=5000 --rotation-lambda-arn arn:aws:lambda:us-east-1:123456789012:function:rotar')).stderr).toContain('between 1 and 1000');
  });
});

describe('Secrets Manager: KMS y política de recurso', () => {
  test('un secreto con clave propia exige permisos sobre la clave', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const k = (await e.json('kms create-key')).KeyMetadata as { KeyId: string; Arn: string };
    await e.run(`secretsmanager create-secret --name app/clave --secret-string hola --kms-key-id ${k.KeyId}`);
    expect((await e.json('secretsmanager describe-secret --secret-id app/clave')).KmsKeyId).toBe(k.Arn);
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:*', Resource: '*' }] }));
    await e.run('iam put-user-policy --user-name bob --policy-name sm --policy-document file://p.json');
    const r = await e.run('secretsmanager get-secret-value --secret-id app/clave --profile bob');
    expect(r.stderr).toContain('kms:Decrypt');
    expect((await e.run('secretsmanager create-secret --name app/otra --secret-string x --kms-key-id alias/no-existe')).stderr).toContain('not found');
    await e.run(`kms disable-key --key-id ${k.KeyId}`);
    expect((await e.run('secretsmanager get-secret-value --secret-id app/clave')).stderr).toContain('DecryptionFailure');
  });

  test('política de recurso: denegar o conceder', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    await e.run('secretsmanager create-secret --name app/dato --secret-string valor');
    expect((await e.run('secretsmanager get-secret-value --secret-id app/dato --profile bob')).stderr).toContain('AccessDeniedException');
    const grant = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:user/bob' }, Action: 'secretsmanager:GetSecretValue', Resource: '*' }] });
    e.write('g.json', grant);
    await e.run('secretsmanager put-resource-policy --secret-id app/dato --resource-policy file://g.json');
    expect((await e.json('secretsmanager get-secret-value --secret-id app/dato --profile bob')).SecretString).toBe('valor');
    expect(JSON.parse((await e.json('secretsmanager get-resource-policy --secret-id app/dato')).ResourcePolicy).Statement[0].Effect).toBe('Allow');
    // un Deny gana incluso al administrador
    e.write('d.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Principal: '*', Action: 'secretsmanager:GetSecretValue', Resource: '*', Condition: { StringNotEquals: { 'aws:PrincipalArn': 'arn:aws:iam::123456789012:user/carla' } } }] }));
    await e.run('secretsmanager put-resource-policy --secret-id app/dato --resource-policy file://d.json');
    expect((await e.run('secretsmanager get-secret-value --secret-id app/dato')).stderr).toContain('explicit deny in a resource-based policy');
    expect((await e.json('secretsmanager get-secret-value --secret-id app/dato --profile carla')).SecretString).toBe('valor');
    // públicas, no
    e.write('o.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: '*', Action: 'secretsmanager:GetSecretValue', Resource: '*' }] }));
    expect((await e.run('secretsmanager put-resource-policy --secret-id app/dato --resource-policy file://o.json')).stderr).toContain('unbounded principal');
    expect((await e.json('secretsmanager validate-resource-policy --resource-policy file://o.json')).PolicyValidationPassed).toBe(false);
    await e.run('secretsmanager delete-resource-policy --secret-id app/dato');
    expect((await e.json('secretsmanager get-secret-value --secret-id app/dato --profile carla')).SecretString).toBe('valor');
  });
});
