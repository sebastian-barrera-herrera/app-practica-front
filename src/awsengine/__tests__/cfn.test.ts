import { mkEnv, type TestEnv } from './helpers';

const BUCKET_Q = `AWSTemplateFormatVersion: 2010-09-09
Description: Cola y bucket de prueba
Parameters:
  Entorno:
    Type: String
    Default: dev
    AllowedValues: [dev, prod]
Conditions:
  EsProd: !Equals [!Ref Entorno, prod]
Resources:
  Datos:
    Type: AWS::S3::Bucket
    Properties:
      Tags:
        - Key: entorno
          Value: !Ref Entorno
  Cola:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: !If [EsProd, 120, 30]
Outputs:
  Bucket:
    Value: !Ref Datos
    Export:
      Name: !Sub "\${AWS::StackName}-bucket"
  ColaArn:
    Value: !GetAtt Cola.Arn
`;

async function stack(e: TestEnv, name: string, extra = '', file = 't.yaml') {
  return e.run(`cloudformation create-stack --stack-name ${name} --template-body file://${file} ${extra}`);
}
const status = async (e: TestEnv, name: string) => (await e.json(`cloudformation describe-stacks --stack-name ${name} --query "Stacks[0].StackStatus"`)) as string;

describe('CloudFormation: crear pilas', () => {
  test('crea los recursos, los eventos van pasando y las salidas aparecen al terminar', async () => {
    const e = mkEnv({}, { 't.yaml': BUCKET_Q });
    const r = await stack(e, 'tienda');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).StackId).toMatch(/^arn:aws:cloudformation:us-east-1:123456789012:stack\/tienda\/[0-9a-f-]{36}$/);
    expect(await status(e, 'tienda')).toBe('CREATE_IN_PROGRESS');
    expect((await e.json('cloudformation describe-stacks --stack-name tienda')).Stacks[0].Outputs).toBeUndefined();
    expect((await e.run('cloudformation wait stack-create-complete --stack-name tienda')).code).toBe(0);
    const s = (await e.json('cloudformation describe-stacks --stack-name tienda')).Stacks[0];
    expect(s.StackStatus).toBe('CREATE_COMPLETE');
    expect(s.Description).toBe('Cola y bucket de prueba');
    const out = Object.fromEntries(s.Outputs.map((o: any) => [o.OutputKey, o.OutputValue]));
    expect(out.Bucket).toMatch(/^tienda-datos-[a-z0-9]{12}$/);
    expect(out.ColaArn).toMatch(/^arn:aws:sqs:us-east-1:123456789012:tienda-Cola-[A-Z0-9]{12}$/);
    expect(await e.json('s3api get-bucket-tagging --bucket ' + out.Bucket + ' --query "TagSet[0].Value"')).toBe('dev');
    const res = (await e.json('cloudformation describe-stack-resources --stack-name tienda --query "StackResources[].[LogicalResourceId,ResourceType,ResourceStatus]"')) as string[][];
    expect(res).toEqual(expect.arrayContaining([['Datos', 'AWS::S3::Bucket', 'CREATE_COMPLETE'], ['Cola', 'AWS::SQS::Queue', 'CREATE_COMPLETE']]));
    const ev = (await e.json('cloudformation describe-stack-events --stack-name tienda --query "StackEvents[].[LogicalResourceId,ResourceStatus]"')) as string[][];
    expect(ev[0]).toEqual(['tienda', 'CREATE_COMPLETE']);
    expect(ev.at(-1)).toEqual(['tienda', 'CREATE_IN_PROGRESS']);
    expect(await e.json('cloudformation list-exports --query "Exports[0].Name"')).toBe('tienda-bucket');
  });

  test('parámetros: valores permitidos, obligatorios y condiciones', async () => {
    const e = mkEnv({}, { 't.yaml': BUCKET_Q });
    expect((await stack(e, 'x', '--parameters ParameterKey=Entorno,ParameterValue=qa')).stderr).toContain('Parameter validation failed');
    expect((await stack(e, 'x', '--parameters ParameterKey=Otro,ParameterValue=1')).stderr).toContain('Parameters: [Otro] do not exist in the template');
    await stack(e, 'pro', '--parameters ParameterKey=Entorno,ParameterValue=prod');
    await e.run('cloudformation wait stack-create-complete --stack-name pro');
    const q = await e.json('cloudformation describe-stacks --stack-name pro --query "Stacks[0].Outputs[?OutputKey==\'ColaArn\'].OutputValue | [0]"');
    const url = (await e.json('sqs list-queues --query "QueueUrls[0]"')) as string;
    expect(q).toContain('pro-Cola');
    expect(await e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names VisibilityTimeout --query Attributes.VisibilityTimeout`)).toBe('120');
    // sin valor por defecto
    e.write('p.yaml', 'Parameters:\n  Nombre:\n    Type: String\nResources:\n  C:\n    Type: AWS::SQS::Queue\n');
    expect((await stack(e, 'y', '', 'p.yaml')).stderr).toContain('Parameters: [Nombre] must have values');
  });

  test('validaciones de la plantilla antes de crear nada', async () => {
    const e = mkEnv();
    const t = (body: string) => { e.write('b.yaml', body); return stack(e, 'v', '', 'b.yaml'); };
    expect((await t('Resources:\n  A:\n    Type: AWS::Foo::Bar\n')).stderr).toContain('Unrecognized resource types: [AWS::Foo::Bar]');
    expect((await t('Resources:\n  A:\n    Properties: {}\n')).stderr).toContain('Every Resources object must contain a Type member');
    expect((await t('Resources:\n  A:\n    Type: AWS::SQS::Queue\n    Properties:\n      QueueName: !Ref Nada\n')).stderr).toContain('Unresolved resource dependencies [Nada]');
    expect((await t('Resources:\n  A:\n    Type: AWS::SQS::Queue\n    Properties:\n      QueueName: !GetAtt B.Arn\n  B:\n    Type: AWS::SQS::Queue\n    Properties:\n      QueueName: !GetAtt A.Arn\n')).stderr).toContain('Circular dependency between resources');
    expect((await t('Resources:\n  A:\n    Type: AWS::SQS::Queue\n    Properties:\n      QueueName: !GetAtt B.Nada\n  B:\n    Type: AWS::SQS::Queue\n')).stderr).toContain('does not support attribute type Nada');
    expect((await t('Resources: {}')).stderr).toContain('At least one Resources member must be defined');
    expect((await e.run('cloudformation create-stack --stack-name v --template-body "{ mal"')).stderr).toContain('JSON not well-formed');
    const ok = await e.json('cloudformation validate-template --template-body file://b.yaml').catch(() => null);
    expect(ok).toBeNull();
  });

  test('un rol de IAM exige la capacidad; los nombres propios, NAMED_IAM', async () => {
    const e = mkEnv();
    e.write('r.yaml', 'Resources:\n  R:\n    Type: AWS::IAM::Role\n    Properties:\n      AssumeRolePolicyDocument:\n        Version: "2012-10-17"\n        Statement:\n          - Effect: Allow\n            Principal: {Service: lambda.amazonaws.com}\n            Action: sts:AssumeRole\n');
    expect((await stack(e, 'r', '', 'r.yaml')).stderr).toContain('Requires capabilities : [CAPABILITY_IAM]');
    expect((await stack(e, 'r', '--capabilities CAPABILITY_IAM', 'r.yaml')).code).toBe(0);
    await e.run('cloudformation wait stack-create-complete --stack-name r');
    expect(await e.json('iam list-roles --query "Roles[?starts_with(RoleName,\'r-R-\')] | length(@)"')).toBe(1);
    e.write('n.yaml', 'Resources:\n  R:\n    Type: AWS::IAM::Role\n    Properties:\n      RoleName: mi-rol\n      AssumeRolePolicyDocument: {Version: "2012-10-17", Statement: [{Effect: Allow, Principal: {Service: ec2.amazonaws.com}, Action: sts:AssumeRole}]}\n');
    expect((await stack(e, 'n', '--capabilities CAPABILITY_IAM', 'n.yaml')).stderr).toContain('CAPABILITY_NAMED_IAM');
  });

  test('si un recurso falla, se deshace todo y la pila queda en ROLLBACK_COMPLETE; hay que borrarla', async () => {
    const e = mkEnv({}, {});
    await e.run('s3 mb s3://ocupado-123');
    e.write('f.yaml', 'Resources:\n  Cola:\n    Type: AWS::SQS::Queue\n  Bucket:\n    Type: AWS::S3::Bucket\n    DependsOn: Cola\n    Properties:\n      BucketName: ocupado-123\n');
    await stack(e, 'f', '', 'f.yaml');
    expect((await e.run('cloudformation wait stack-create-complete --stack-name f')).stderr).toContain('ROLLBACK_COMPLETE');
    expect(await status(e, 'f')).toBe('ROLLBACK_COMPLETE');
    const ev = (await e.json('cloudformation describe-stack-events --stack-name f --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].ResourceStatusReason | [0]"')) as string;
    expect(ev).toContain('ocupado-123');
    expect(ev).toContain('already exists');
    expect(await e.json('sqs list-queues --query "length(QueueUrls || `[]`)"')).toBe(0);
    expect((await e.run('cloudformation update-stack --stack-name f --template-body file://f.yaml')).stderr).toContain('is in ROLLBACK_COMPLETE state and can not be updated');
    expect((await stack(e, 'f', '', 'f.yaml')).stderr).toContain('already exists');
    await e.run('cloudformation delete-stack --stack-name f');
    await e.run('cloudformation wait stack-delete-complete --stack-name f');
    expect((await e.run('cloudformation describe-stacks --stack-name f')).stderr).toContain('does not exist');
    expect(await e.json('cloudformation list-stacks --query "StackSummaries[0].StackStatus"')).toBe('DELETE_COMPLETE');
    // con --on-failure DO_NOTHING los recursos creados se quedan
    await stack(e, 'g', '--on-failure DO_NOTHING', 'f.yaml');
    await e.run('cloudformation wait stack-create-complete --stack-name g').catch(() => null);
    e.acct.clock += 600000;
    expect(await status(e, 'g')).toBe('CREATE_FAILED');
    expect(await e.json('sqs list-queues --query "length(QueueUrls)"')).toBe(1);
  });

  test('borrar: un bucket con objetos falla; con --retain-resources se completa', async () => {
    const e = mkEnv({}, { 't.yaml': BUCKET_Q });
    await stack(e, 'tienda');
    await e.run('cloudformation wait stack-create-complete --stack-name tienda');
    const b = (await e.json('cloudformation describe-stack-resource --stack-name tienda --logical-resource-id Datos --query StackResourceDetail.PhysicalResourceId')) as string;
    await e.run(`s3api put-object --bucket ${b} --key a.txt --body t.yaml`);
    await e.run('cloudformation update-termination-protection --enable-termination-protection --stack-name tienda');
    expect((await e.run('cloudformation delete-stack --stack-name tienda')).stderr).toContain('TerminationProtection');
    await e.run('cloudformation update-termination-protection --no-enable-termination-protection --stack-name tienda');
    await e.run('cloudformation delete-stack --stack-name tienda');
    expect((await e.run('cloudformation wait stack-delete-complete --stack-name tienda')).stderr).toContain('DELETE_FAILED');
    expect(await e.json('cloudformation describe-stack-events --stack-name tienda --query "StackEvents[?ResourceStatus==\'DELETE_FAILED\' && LogicalResourceId==\'Datos\'].ResourceStatusReason | [0]"')).toContain('not empty');
    expect((await e.run('cloudformation delete-stack --stack-name tienda --retain-resources Nada')).code).toBe(0);
    e.acct.clock += 600000;
    expect(await status(e, 'tienda')).toBe('DELETE_FAILED');
    expect((await e.run('cloudformation delete-stack --stack-name tienda --retain-resources Datos')).code).toBe(0);
    expect((await e.run('cloudformation wait stack-delete-complete --stack-name tienda')).code).toBe(0);
    expect(await e.json('s3api list-buckets --query "Buckets[?Name==\'' + b + '\'] | length(@)"')).toBe(1);
  });
});
