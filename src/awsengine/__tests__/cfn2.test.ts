import { mkEnv, type TestEnv } from './helpers';

const V1 = `Resources:
  Cola:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 30
  Tabla:
    Type: AWS::DynamoDB::Table
    Properties:
      AttributeDefinitions:
        - {AttributeName: id, AttributeType: S}
      KeySchema:
        - {AttributeName: id, KeyType: HASH}
      BillingMode: PAY_PER_REQUEST
  Rol:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - {Effect: Allow, Principal: {Service: lambda.amazonaws.com}, Action: "sts:AssumeRole"}
      ManagedPolicyArns: [arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]
  Funcion:
    Type: AWS::Lambda::Function
    DependsOn: Cola
    Properties:
      Runtime: python3.12
      Handler: index.lambda_handler
      Role: !GetAtt Rol.Arn
      Timeout: 3
      Environment:
        Variables:
          TABLA: !Ref Tabla
      Code:
        ZipFile: |
          import os
          def lambda_handler(event, context):
              return os.environ['TABLA']
`;
const CAPS = '--capabilities CAPABILITY_IAM';
const create = async (e: TestEnv, name = 's', file = 'v1.yaml') => {
  await e.run(`cloudformation create-stack --stack-name ${name} --template-body file://${file} ${CAPS}`);
  return e.run(`cloudformation wait stack-create-complete --stack-name ${name}`);
};
const update = (e: TestEnv, file: string, name = 's') => e.run(`cloudformation update-stack --stack-name ${name} --template-body file://${file} ${CAPS}`);
const phys = async (e: TestEnv, id: string, name = 's') => (await e.json(`cloudformation describe-stack-resource --stack-name ${name} --logical-resource-id ${id} --query StackResourceDetail.PhysicalResourceId`)) as string;
const status = async (e: TestEnv, name = 's') => (await e.json(`cloudformation describe-stacks --stack-name ${name} --query "Stacks[0].StackStatus"`)) as string;
const queueAttr = async (e: TestEnv) => {
  const url = (await e.json('sqs list-queues --query "QueueUrls[0]"')) as string;
  return e.json(`sqs get-queue-attributes --queue-url ${url} --attribute-names VisibilityTimeout --query Attributes.VisibilityTimeout`);
};

describe('CloudFormation: actualizar', () => {
  test('cambio en el sitio, sustitución del recurso con nombre generado y propagación a quien lo usa', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    expect((await create(e)).code).toBe(0);
    const tabla1 = await phys(e, 'Tabla');
    const fn = await phys(e, 'Funcion');
    expect(await e.json(`lambda get-function-configuration --function-name ${fn} --query Environment.Variables.TABLA`)).toBe(tabla1);
    // 1) cambio que no sustituye
    e.write('v2.yaml', V1.replace('VisibilityTimeout: 30', 'VisibilityTimeout: 60'));
    expect((await update(e, 'v2.yaml')).code).toBe(0);
    expect(await status(e)).toBe('UPDATE_IN_PROGRESS');
    await e.run('cloudformation wait stack-update-complete --stack-name s');
    expect(await queueAttr(e)).toBe('60');
    expect(await phys(e, 'Cola')).toBe(await phys(e, 'Cola'));
    // 2) sin cambios
    expect((await update(e, 'v2.yaml')).stderr).toContain('No updates are to be performed');
    // 3) la clave de la tabla obliga a sustituirla: nombre nuevo, la función recibe el nombre nuevo y la vieja se borra
    e.write('v3.yaml', V1.replace('VisibilityTimeout: 30', 'VisibilityTimeout: 60').replace('{AttributeName: id, AttributeType: S}', '{AttributeName: pk, AttributeType: S}').replace('{AttributeName: id, KeyType: HASH}', '{AttributeName: pk, KeyType: HASH}'));
    expect((await update(e, 'v3.yaml')).code).toBe(0);
    await e.run('cloudformation wait stack-update-complete --stack-name s');
    const tabla2 = await phys(e, 'Tabla');
    expect(tabla2).not.toBe(tabla1);
    expect(await e.json(`lambda get-function-configuration --function-name ${fn} --query Environment.Variables.TABLA`)).toBe(tabla2);
    expect((await e.json('dynamodb list-tables')).TableNames).toEqual([tabla2]);
    const ev = (await e.json('cloudformation describe-stack-events --stack-name s --query "StackEvents[?LogicalResourceId==\'Tabla\'].ResourceStatus"')) as string[];
    expect(ev).toEqual(expect.arrayContaining(['UPDATE_COMPLETE', 'DELETE_COMPLETE']));
  });

  test('si falla una actualización se deshacen los cambios anteriores', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    await create(e);
    // la cola se cambia bien y después la función falla (timeout fuera de rango)
    e.write('mal.yaml', V1.replace('VisibilityTimeout: 30', 'VisibilityTimeout: 99').replace('Timeout: 3', 'Timeout: 99999'));
    expect((await update(e, 'mal.yaml')).code).toBe(0);
    const w = await e.run('cloudformation wait stack-update-complete --stack-name s');
    expect(w.stderr).toContain('UPDATE_ROLLBACK_COMPLETE');
    expect(await status(e)).toBe('UPDATE_ROLLBACK_COMPLETE');
    expect(await queueAttr(e)).toBe('30');
    const reason = await e.json('cloudformation describe-stack-events --stack-name s --query "StackEvents[?ResourceStatus==\'UPDATE_FAILED\'].ResourceStatusReason | [0]"');
    expect(reason).toContain('timeout');
    // una pila en UPDATE_ROLLBACK_COMPLETE se puede volver a actualizar
    e.write('bien.yaml', V1.replace('VisibilityTimeout: 30', 'VisibilityTimeout: 45'));
    expect((await update(e, 'bien.yaml')).code).toBe(0);
  });

  test('un recurso con nombre propio no se puede sustituir: pide cambiar el nombre', async () => {
    const e = mkEnv({}, {});
    e.write('a.yaml', 'Resources:\n  T:\n    Type: AWS::DynamoDB::Table\n    Properties:\n      TableName: pedidos\n      AttributeDefinitions: [{AttributeName: id, AttributeType: S}]\n      KeySchema: [{AttributeName: id, KeyType: HASH}]\n      BillingMode: PAY_PER_REQUEST\n');
    await create(e, 's', 'a.yaml');
    e.write('b.yaml', 'Resources:\n  T:\n    Type: AWS::DynamoDB::Table\n    Properties:\n      TableName: pedidos\n      AttributeDefinitions: [{AttributeName: pk, AttributeType: S}]\n      KeySchema: [{AttributeName: pk, KeyType: HASH}]\n      BillingMode: PAY_PER_REQUEST\n');
    await update(e, 'b.yaml');
    expect((await e.run('cloudformation wait stack-update-complete --stack-name s')).stderr).toContain('UPDATE_ROLLBACK_COMPLETE');
    expect(await e.json('cloudformation describe-stack-events --stack-name s --query "StackEvents[?ResourceStatus==\'UPDATE_FAILED\'].ResourceStatusReason | [0]"')).toContain('custom-named resource requires replacing. Rename pedidos');
    expect(await e.json('dynamodb describe-table --table-name pedidos --query Table.KeySchema[0].AttributeName')).toBe('id');
  });

  test('actualizar quitando un recurso lo borra; Retain lo deja', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    e.write('r.yaml', 'Resources:\n  A:\n    Type: AWS::SQS::Queue\n  B:\n    Type: AWS::SNS::Topic\n    DeletionPolicy: Retain\n');
    await create(e, 's', 'r.yaml');
    e.write('r2.yaml', 'Resources:\n  A:\n    Type: AWS::SQS::Queue\n');
    await update(e, 'r2.yaml');
    await e.run('cloudformation wait stack-update-complete --stack-name s');
    expect(await e.json('sns list-topics --query "length(Topics)"')).toBe(1);
    e.write('r3.yaml', 'Resources:\n  C:\n    Type: AWS::SNS::Topic\n');
    await update(e, 'r3.yaml');
    await e.run('cloudformation wait stack-update-complete --stack-name s');
    expect(await e.json('sqs list-queues')).toEqual({});
  });
});

describe('CloudFormation: conjuntos de cambios', () => {
  test('describe lo que cambiaría (incluida la sustitución) y solo se aplica al ejecutarlo', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    await create(e);
    const tabla1 = await phys(e, 'Tabla');
    e.write('v3.yaml', V1.replace('VisibilityTimeout: 30', 'VisibilityTimeout: 60').replace('{AttributeName: id, AttributeType: S}', '{AttributeName: pk, AttributeType: S}').replace('{AttributeName: id, KeyType: HASH}', '{AttributeName: pk, KeyType: HASH}'));
    expect((await e.run(`cloudformation create-change-set --stack-name s --change-set-name cambios --template-body file://v3.yaml ${CAPS}`)).code).toBe(0);
    await e.run('cloudformation wait change-set-create-complete --stack-name s --change-set-name cambios');
    const cs = await e.json('cloudformation describe-change-set --stack-name s --change-set-name cambios');
    expect(cs.Status).toBe('CREATE_COMPLETE');
    expect(cs.ExecutionStatus).toBe('AVAILABLE');
    const rows = Object.fromEntries(cs.Changes.map((c: any) => [c.ResourceChange.LogicalResourceId, c.ResourceChange]));
    expect(rows.Cola.Action).toBe('Modify');
    expect(rows.Cola.Replacement).toBe('False');
    expect(rows.Tabla.Replacement).toBe('True');
    expect(rows.Tabla.Details.some((d: any) => d.Target.Name === 'KeySchema' && d.Target.RequiresRecreation === 'Always')).toBe(true);
    expect(rows.Funcion.Action).toBe('Modify');
    expect(rows.Funcion.Replacement).toBe('False');
    expect(rows.Rol).toBeUndefined();
    // aún no ha cambiado nada
    expect(await phys(e, 'Tabla')).toBe(tabla1);
    expect(await queueAttr(e)).toBe('30');
    await e.run('cloudformation execute-change-set --stack-name s --change-set-name cambios');
    await e.run('cloudformation wait stack-update-complete --stack-name s');
    expect(await phys(e, 'Tabla')).not.toBe(tabla1);
    expect(await queueAttr(e)).toBe('60');
  });

  test('sin cambios el conjunto falla; tipo CREATE deja la pila en REVIEW_IN_PROGRESS hasta ejecutarlo', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    await create(e);
    await e.run(`cloudformation create-change-set --stack-name s --change-set-name igual --template-body file://v1.yaml ${CAPS}`);
    e.acct.clock += 10000;
    const cs = await e.json('cloudformation describe-change-set --stack-name s --change-set-name igual');
    expect(cs.Status).toBe('FAILED');
    expect(cs.StatusReason).toContain("didn't contain changes");
    // CREATE
    await e.run(`cloudformation create-change-set --stack-name nueva --change-set-name inicial --change-set-type CREATE --template-body file://v1.yaml ${CAPS}`);
    expect(await status(e, 'nueva')).toBe('REVIEW_IN_PROGRESS');
    const d = await e.json('cloudformation describe-change-set --stack-name nueva --change-set-name inicial --query "Changes[].ResourceChange.Action"');
    expect(d).toEqual(['Add', 'Add', 'Add', 'Add']);
    expect(await e.json('sqs list-queues --query "length(QueueUrls)"')).toBe(1);
    await e.run('cloudformation execute-change-set --stack-name nueva --change-set-name inicial');
    await e.run('cloudformation wait stack-create-complete --stack-name nueva');
    expect(await e.json('sqs list-queues --query "length(QueueUrls)"')).toBe(2);
  });
});

describe('CloudFormation: deriva', () => {
  test('detecta lo que alguien cambió a mano y dice qué esperaba la plantilla', async () => {
    const e = mkEnv({}, { 'v1.yaml': V1 });
    await create(e);
    expect(await e.json('cloudformation describe-stacks --stack-name s --query "Stacks[0].DriftInformation.StackDriftStatus"')).toBe('NOT_CHECKED');
    const id = await e.json('cloudformation detect-stack-drift --stack-name s --query StackDriftDetectionId');
    expect(await e.json(`cloudformation describe-stack-drift-detection-status --stack-drift-detection-id ${id} --query StackDriftStatus`)).toBe('IN_SYNC');
    // cambios manuales: tiempo de la función y visibilidad de la cola
    const fn = await phys(e, 'Funcion');
    await e.run(`lambda update-function-configuration --function-name ${fn} --timeout 30`);
    const url = (await e.json('sqs list-queues --query "QueueUrls[0]"')) as string;
    await e.run(`sqs set-queue-attributes --queue-url ${url} --attributes VisibilityTimeout=120`);
    const id2 = await e.json('cloudformation detect-stack-drift --stack-name s --query StackDriftDetectionId');
    expect(await e.json(`cloudformation describe-stack-drift-detection-status --stack-drift-detection-id ${id2}`)).toMatchObject({ StackDriftStatus: 'DRIFTED', DriftedStackResourceCount: 2, DetectionStatus: 'DETECTION_COMPLETE' });
    const d = (await e.json('cloudformation describe-stack-resource-drifts --stack-name s --stack-resource-drift-status-filters MODIFIED')).StackResourceDrifts as any[];
    expect(d.map((x) => x.LogicalResourceId).sort()).toEqual(['Cola', 'Funcion']);
    const f = d.find((x) => x.LogicalResourceId === 'Funcion');
    expect(f.PropertyDifferences).toEqual([{ PropertyPath: '/Timeout', ExpectedValue: '3', ActualValue: '30', DifferenceType: 'NOT_EQUAL' }]);
    expect(await e.json('cloudformation describe-stacks --stack-name s --query "Stacks[0].DriftInformation.StackDriftStatus"')).toBe('DRIFTED');
    // un recurso borrado a mano
    await e.run(`sqs delete-queue --queue-url ${url}`);
    const id3 = await e.json('cloudformation detect-stack-drift --stack-name s --query StackDriftDetectionId');
    await e.json(`cloudformation describe-stack-drift-detection-status --stack-drift-detection-id ${id3}`);
    expect(await e.json('cloudformation describe-stack-resource-drifts --stack-name s --query "StackResourceDrifts[?StackResourceDriftStatus==\'DELETED\'].LogicalResourceId"')).toEqual(['Cola']);
  });
});

describe('CloudFormation: exportar e importar', () => {
  test('ImportValue, nombres únicos y no se puede borrar lo que otro usa', async () => {
    const e = mkEnv({}, {});
    e.write('base.yaml', 'Resources:\n  T:\n    Type: AWS::SNS::Topic\nOutputs:\n  Tema:\n    Value: !Ref T\n    Export:\n      Name: red-tema\n');
    e.write('uso.yaml', 'Resources:\n  Q:\n    Type: AWS::SNS::Subscription\n    Properties:\n      TopicArn: !ImportValue red-tema\n      Protocol: email\n      Endpoint: a@b.es\n');
    expect((await e.run('cloudformation create-stack --stack-name uso --template-body file://uso.yaml')).code).toBe(0);
    expect((await e.run('cloudformation wait stack-create-complete --stack-name uso')).stderr).toContain('ROLLBACK_COMPLETE');
    expect(await e.json('cloudformation describe-stack-events --stack-name uso --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].ResourceStatusReason | [0]"')).toContain('No export named red-tema found');
    await e.run('cloudformation delete-stack --stack-name uso');
    await e.run('cloudformation create-stack --stack-name base --template-body file://base.yaml');
    await e.run('cloudformation wait stack-create-complete --stack-name base');
    expect((await e.run('cloudformation create-stack --stack-name base2 --template-body file://base.yaml')).stderr).toBeDefined();
    await e.run('cloudformation wait stack-create-complete --stack-name base2').catch(() => null);
    expect(await status(e, 'base2')).toMatch(/ROLLBACK/);
    expect((await e.run('cloudformation create-stack --stack-name uso2 --template-body file://uso.yaml')).code).toBe(0);
    await e.run('cloudformation wait stack-create-complete --stack-name uso2');
    expect(await e.json('cloudformation list-imports --export-name red-tema')).toEqual({ Imports: ['uso2'] });
    expect((await e.run('cloudformation delete-stack --stack-name base')).stderr).toContain('Export red-tema cannot be deleted as it is in use by uso2');
  });
});
