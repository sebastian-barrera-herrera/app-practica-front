import { mkEnv, type TestEnv } from './helpers';

const SAM = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Globals:
  Function:
    Runtime: python3.12
    Timeout: 5
Resources:
  Tabla:
    Type: AWS::Serverless::SimpleTable
  Hola:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.handler
      CodeUri: src/
      Environment:
        Variables:
          TABLA: !Ref Tabla
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref Tabla
      Events:
        Raiz:
          Type: HttpApi
          Properties:
            Path: /hola
            Method: get
Outputs:
  Url:
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/hola"
`;
const APP = `import os, json
import boto3

def handler(event, context):
    t = boto3.resource('dynamodb').Table(os.environ['TABLA'])
    t.put_item(Item={'id': 'visita', 'n': 1})
    return {'statusCode': 200, 'body': json.dumps({'tabla': os.environ['TABLA'], 'ruta': event.get('rawPath')})}
`;

const files = { 'plantilla.yaml': SAM, 'src/app.py': APP };
const CAPS = '--capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND';
const pack = (e: TestEnv) => e.run('cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml');

describe('SAM: package y deploy', () => {
  test('la plantilla local no se puede desplegar sin empaquetar y exige las capacidades', async () => {
    const e = mkEnv({}, files);
    await e.run('s3 mb s3://artefactos');
    expect((await e.run('cloudformation deploy --template-file plantilla.yaml --stack-name api --capabilities CAPABILITY_IAM')).stderr).toContain('CAPABILITY_AUTO_EXPAND');
    const r = await e.run(`cloudformation deploy --template-file plantilla.yaml --stack-name api ${CAPS}`);
    expect(r.stderr).toContain("'CodeUri' is not a valid S3 Uri");
  });

  test('package sube el código, deploy crea la pila y la función responde por HTTP', async () => {
    const e = mkEnv({}, files);
    await e.run('s3 mb s3://artefactos');
    const p = await pack(e);
    expect(p.code).toBe(0);
    expect(p.stdout).toContain('Successfully packaged artifacts');
    const out = e.files.get('/home/alumno/empaquetada.yaml')!;
    expect(out).toMatch(/CodeUri: s3:\/\/artefactos\/[0-9a-f]{32}/);
    expect(await e.json('s3api list-objects-v2 --bucket artefactos --query "length(Contents)"')).toBe(1);
    const d = await e.run(`cloudformation deploy --template-file empaquetada.yaml --stack-name api ${CAPS}`);
    expect(d.stderr + d.stdout).toContain('Successfully created/updated stack - api');
    expect(await e.json('cloudformation describe-stacks --stack-name api --query "Stacks[0].StackStatus"')).toBe('CREATE_COMPLETE');
    const resources = (await e.json('cloudformation list-stack-resources --stack-name api --query "StackResourceSummaries[].ResourceType"')) as string[];
    expect(resources).toEqual(expect.arrayContaining(['AWS::DynamoDB::Table', 'AWS::Lambda::Function', 'AWS::IAM::Role', 'AWS::ApiGatewayV2::Api', 'AWS::ApiGatewayV2::Route', 'AWS::Lambda::Permission']));
    const url = (await e.json('cloudformation describe-stacks --stack-name api --query "Stacks[0].Outputs[0].OutputValue"')) as string;
    expect(url).toMatch(/^https:\/\/[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com\/hola$/);
    e.io.god = true;
    const h = await e.json(`_check http --url ${url}`);
    expect(h.Status).toBe(200);
    expect(JSON.stringify(h)).toContain('api-Tabla');
    e.io.god = false;
    // volver a desplegar lo mismo: sin cambios
    const again = await e.run(`cloudformation deploy --template-file empaquetada.yaml --stack-name api ${CAPS}`);
    expect(again.code).toBe(255);
    expect(again.stderr).toContain('No changes to deploy. Stack api is up to date');
    expect((await e.run(`cloudformation deploy --template-file empaquetada.yaml --stack-name api ${CAPS} --no-fail-on-empty-changeset`)).code).toBe(0);
    // la plantilla procesada incluye lo que SAM generó
    const proc = await e.json('cloudformation get-template --stack-name api --template-stage Processed --query "keys(TemplateBody.Resources)"');
    expect(proc).toEqual(expect.arrayContaining(['HolaRole', 'ServerlessHttpApi', 'HolaRaizRoute']));
    // cambiar el código: nuevo paquete y deploy actualizan la función
    e.write('src/app.py', APP.replace("'n': 1", "'n': 2"));
    await pack(e);
    const up = await e.run(`cloudformation deploy --template-file empaquetada.yaml --stack-name api ${CAPS}`);
    expect(up.stdout).toContain('Successfully created/updated');
    expect(await e.json('cloudformation describe-stacks --stack-name api --query "Stacks[0].StackStatus"')).toBe('UPDATE_COMPLETE');
  });

  test('package falla si el bucket no existe o la carpeta no está', async () => {
    const e = mkEnv({}, files);
    expect((await pack(e)).stderr).toContain('NoSuchBucket');
    await e.run('s3 mb s3://artefactos');
    e.write('mala.yaml', SAM.replace('src/', 'nada/'));
    expect((await e.run('cloudformation package --template-file mala.yaml --s3-bucket artefactos')).stderr).toContain('does not exist');
  });
});

describe('Conjuntos de pilas', () => {
  const BASE = 'Resources:\n  Cola:\n    Type: AWS::SQS::Queue\n';
  const trust = (p: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: p.startsWith('arn') ? { AWS: p } : { Service: p }, Action: 'sts:AssumeRole' }] });

  test('hacen falta los roles de administración y ejecución; luego se despliega en varias regiones', async () => {
    const e = mkEnv({}, { 'c.yaml': BASE });
    await e.run('cloudformation create-stack-set --stack-set-name colas --template-body file://c.yaml');
    expect((await e.run('cloudformation create-stack-instances --stack-set-name colas --accounts 123456789012 --regions us-east-1 eu-west-1')).stderr).toContain(AdminRole);
    e.write('adm.json', trust('cloudformation.amazonaws.com'));
    await e.run('iam create-role --role-name AWSCloudFormationStackSetAdministrationRole --assume-role-policy-document file://adm.json');
    const exec = await e.run('cloudformation create-stack-instances --stack-set-name colas --accounts 123456789012 --regions us-east-1 eu-west-1');
    expect(exec.stderr).toContain("should have 'AWSCloudFormationStackSetExecutionRole' role");
    e.write('exe.json', trust('arn:aws:iam::123456789012:role/AWSCloudFormationStackSetAdministrationRole'));
    await e.run('iam create-role --role-name AWSCloudFormationStackSetExecutionRole --assume-role-policy-document file://exe.json');
    const ok = await e.run('cloudformation create-stack-instances --stack-set-name colas --accounts 123456789012 --regions us-east-1 eu-west-1');
    expect(ok.code).toBe(0);
    expect(await e.json('cloudformation list-stack-instances --stack-set-name colas --query "Summaries[].Region"')).toEqual(['us-east-1', 'eu-west-1']);
    e.acct.clock += 600000;
    expect(await e.json('sqs list-queues --region eu-west-1 --query "length(QueueUrls)"')).toBe(1);
    expect(await e.json('cloudformation list-stacks --region eu-west-1 --query "StackSummaries[0].StackName"')).toMatch(/^StackSet-colas-/);
    // actualizar el conjunto propaga el cambio
    e.write('c2.yaml', BASE + '    Properties:\n      VisibilityTimeout: 77\n');
    await e.run('cloudformation update-stack-set --stack-set-name colas --template-body file://c2.yaml');
    const url = (await e.json('sqs list-queues --region eu-west-1 --query "QueueUrls[0]"')) as string;
    expect(await e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names VisibilityTimeout --region eu-west-1 --query Attributes.VisibilityTimeout`)).toBe('77');
    expect((await e.run('cloudformation delete-stack-set --stack-set-name colas')).stderr).toContain('StackSetNotEmpty');
    await e.run('cloudformation delete-stack-instances --stack-set-name colas --accounts 123456789012 --regions us-east-1 eu-west-1 --no-retain-stacks');
    expect((await e.run('cloudformation delete-stack-set --stack-set-name colas')).code).toBe(0);
  });
});
const AdminRole = 'AWSCloudFormationStackSetAdministrationRole';
