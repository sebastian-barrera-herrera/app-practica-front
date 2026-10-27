/** Escenarios de la zona «IaC y CI/CD» (Z12): CloudFormation, SAM, CDK, CodeBuild, CodePipeline y CodeDeploy. */
import { makeZip } from '../engine/commands/archive';
import type { Scenario } from './scenarios';
import { BASIC, TRUST, call, fn, policy, role } from './scenarios-srv';
import { iamCreateRole } from './services/iam';
import { s3CreateBucket, s3Put } from './services/s3';
import type { Account } from './types';

const R = 'us-east-1';
const H = '/home/alumno';
const ACCT = '123456789012';
const arnRole = (n: string) => `arn:aws:iam::${ACCT}:role/${n}`;

// ───────────────────────── archivos del alumno ─────────────────────────

const PILAS_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Description: Catálogo de la tienda
Resources:
  Fotos:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: catalogo-prod-${ACCT}
  Pedidos:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: pedidos-catalogo
Outputs:
  Cubo:
    Value: !Ref Fotos
`;

const WEB_PARAMS_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Description: Web de la tienda
Parameters:
  Entorno:
    Type: String
    AllowedValues: [dev, prod]
    Default: dev
Mappings:
  Tamanos:
    dev:
      Tiempo: 30
    prod:
      Tiempo: 120
Conditions:
  EsProd: !Equals [!Ref Entorno, prod]
Resources:
  Fotos:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub tienda-\${Entorno}-\${AWS::AccountId}
  Pedidos:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: !FindInMap [Tamanos, !Ref Entorno, Tiempo]
  Copia:
    Type: AWS::S3::Bucket
    Condition: EsProd
Outputs:
  Cubo:
    Value: !Ref Fotos
  ColaArn:
    Value: !GetAtt Pedidos.Arn
`;

const ROTA_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Description: Plantilla con una referencia mal escrita
Resources:
  Cola:
    Type: AWS::SQS::Queue
    Properties:
      VisibilityTimeout: 45
Outputs:
  Url:
    Value: !Ref Colas
`;

const TIENDA_V1 = `AWSTemplateFormatVersion: '2010-09-09'
Description: Tienda
Resources:
  Archivos:
    Type: AWS::S3::Bucket
  Ventas:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ventas
      VisibilityTimeout: 30
`;
const TIENDA_V2 = TIENDA_V1.replace('QueueName: ventas', 'QueueName: ventas-2026').replace('VisibilityTimeout: 30', 'VisibilityTimeout: 60');

const WEB_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Description: Web de la tienda
Resources:
  Datos:
    Type: AWS::S3::Bucket
    Properties:
      VersioningConfiguration:
        Status: Enabled
  Avisos:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: avisos-web
      VisibilityTimeout: 45
`;

const SAM_YAML = `AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: API de saludos
Globals:
  Function:
    Runtime: python3.12
    Timeout: 5
Resources:
  Visitas:
    Type: AWS::Serverless::SimpleTable
  Saludo:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: saludo
      Handler: app.handler
      CodeUri: src/
      Environment:
        Variables:
          TABLA: !Ref Visitas
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref Visitas
      Events:
        Raiz:
          Type: HttpApi
          Properties:
            Path: /saludo
            Method: get
Outputs:
  Url:
    Value: !Sub "https://\${ServerlessHttpApi}.execute-api.\${AWS::Region}.amazonaws.com/saludo"
`;
const SAM_APP = `import json
import os

import boto3


def handler(event, context):
    tabla = boto3.resource('dynamodb').Table(os.environ['TABLA'])
    r = tabla.update_item(Key={'id': 'visitas'}, UpdateExpression='ADD n :uno', ExpressionAttributeValues={':uno': 1}, ReturnValues='UPDATED_NEW')
    return {'statusCode': 200, 'body': json.dumps({'mensaje': 'Hola desde SAM', 'visitas': int(r['Attributes']['n'])})}
`;

const CDK_TEMPLATE = JSON.stringify(
  {
    Resources: {
      Archivo: { Type: 'AWS::S3::Bucket', UpdateReplacePolicy: 'Retain', DeletionPolicy: 'Retain', Metadata: { 'aws:cdk:path': 'DatosStack/Archivo/Resource' } },
      Cola: { Type: 'AWS::SQS::Queue', UpdateReplacePolicy: 'Delete', DeletionPolicy: 'Delete', Metadata: { 'aws:cdk:path': 'DatosStack/Cola/Resource' } },
      CDKMetadata: { Type: 'AWS::CDK::Metadata', Properties: { Analytics: 'v2:deflate64:H4sIAAAAAAAA/yvJLC4pys9NTUlN1c0pys9LLCrWS87P1dc3NNEzMNCNLS7JzM3WrywuzcvJL0nVq8zL1M/MS9W3NNAzNdQvLsnMS9YPKM3Jz8lO1c3Pz9a3NDTWzwUA' } },
    },
    Outputs: { Cubo: { Value: { Ref: 'Archivo' } }, Cola: { Value: { Ref: 'Cola' } } },
  },
  null,
  2,
);

const BUILD_SRC: Record<string, string> = {
  'buildspec.yml': `version: 0.2
phases:
  install:
    commands:
      - pip install pytest
  pre_build:
    commands:
      - pytest -q
  build:
    commands:
      - echo "Empaquetando la aplicación"
      - mkdir -p dist
      - cp app.py dist/
artifacts:
  files:
    - '**/*'
  base-directory: dist
  name: tienda
`,
  'app.py': 'def precio_final(precio, descuento):\n    """Aplica un descuento (en porcentaje) al precio."""\n    return precio - descuento\n',
  'test_app.py': 'from app import precio_final\n\n\ndef test_descuento():\n    assert precio_final(200, 10) == 180\n\n\ndef test_sin_descuento():\n    assert precio_final(50, 0) == 50\n',
};

const WEB_SRC: Record<string, string> = {
  'buildspec.yml': 'version: 0.2\nphases:\n  build:\n    commands:\n      - mkdir -p sitio\n      - cp index.html sitio/\nartifacts:\n  files:\n    - "**/*"\n  base-directory: sitio\n',
  'index.html': '<h1>Tienda · versión 1</h1>\n',
};

const action = (category: string, provider: string, name: string, configuration: Record<string, string>, ins: string[] = [], outs: string[] = []) => ({
  name,
  actionTypeId: { category, owner: 'AWS', provider, version: '1' },
  configuration,
  inputArtifacts: ins.map((n) => ({ name: n })),
  outputArtifacts: outs.map((n) => ({ name: n })),
});

const webStages = (approval = false) => [
  { name: 'Origen', actions: [action('Source', 'S3', 'Codigo', { S3Bucket: 'codigo', S3ObjectKey: 'web.zip', PollForSourceChanges: 'false' }, [], ['Codigo'])] },
  { name: 'Compilar', actions: [action('Build', 'CodeBuild', 'Compilar', { ProjectName: 'web-build' }, ['Codigo'], ['Sitio'])] },
  ...(approval ? [{ name: 'Aprobar', actions: [action('Approval', 'Manual', 'Revision', { CustomData: 'Revisa la versión en pruebas antes de publicar' })] }] : []),
  { name: 'Publicar', actions: [action('Deploy', 'S3', 'Sitio', { BucketName: 'sitio', Extract: 'true' }, ['Sitio'])] },
];
const webPipeline = (approval = false) => ({ pipeline: { name: 'web', roleArn: arnRole('web-pipe-role'), artifactStore: { type: 'S3', location: 'artefactos' }, stages: webStages(approval) } });

const BOSS_SRC: Record<string, string> = {
  'buildspec.yml': 'version: 0.2\nphases:\n  build:\n    commands:\n      - aws cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml\nartifacts:\n  files:\n    - empaquetada.yaml\n',
  'plantilla.yaml': SAM_YAML.replace('FunctionName: saludo', 'FunctionName: tienda').replace('/saludo', '/tienda').replace('/saludo', '/tienda'),
  'src/app.py': SAM_APP,
};
const bossPipeline = {
  pipeline: {
    name: 'tienda',
    roleArn: arnRole('pipe-role'),
    artifactStore: { type: 'S3', location: 'artefactos' },
    stages: [
      { name: 'Origen', actions: [action('Source', 'S3', 'Codigo', { S3Bucket: 'codigo', S3ObjectKey: 'tienda.zip' }, [], ['Codigo'])] },
      { name: 'Compilar', actions: [action('Build', 'CodeBuild', 'Package', { ProjectName: 'tienda-build' }, ['Codigo'], ['Paquete'])] },
      { name: 'Desplegar', actions: [action('Deploy', 'CloudFormation', 'Pila', { ActionMode: 'CREATE_UPDATE', StackName: 'tienda-api', TemplatePath: 'Paquete::empaquetada.yaml', RoleArn: arnRole('cfn-role') }, ['Paquete'])] },
    ],
  },
};

const REVISION = JSON.stringify({
  revisionType: 'AppSpecContent',
  appSpecContent: { content: 'version: 0.0\nResources:\n  - tienda:\n      Type: AWS::Lambda::Function\n      Properties:\n        Name: tienda\n        Alias: live\n        CurrentVersion: "1"\n        TargetVersion: "2"\n' },
});

/** Archivos que se dejan en el directorio del alumno en cada ejercicio. */
export const IAC_FILES = {
  plantilla: { [`${H}/web.yaml`]: WEB_PARAMS_YAML },
  rota: { [`${H}/rota.yaml`]: ROTA_YAML },
  pilas: { [`${H}/catalogo.yaml`]: PILAS_YAML },
  cambios: { [`${H}/tienda-v2.yaml`]: TIENDA_V2 },
  deriva: { [`${H}/web.yaml`]: WEB_YAML },
  sam: { [`${H}/plantilla.yaml`]: SAM_YAML, [`${H}/src/app.py`]: SAM_APP },
  cdk: { [`${H}/cdk.out/DatosStack.template.json`]: CDK_TEMPLATE },
  build: Object.fromEntries(Object.entries(BUILD_SRC).map(([k, v]) => [`${H}/tienda/${k}`, v])),
  pipeline: { [`${H}/pipeline.json`]: JSON.stringify(webPipeline(), null, 2) + '\n' },
  deploy: { [`${H}/revision.json`]: REVISION + '\n' },
  boss: { [`${H}/pipeline.json`]: JSON.stringify(bossPipeline, null, 2) + '\n', [`${H}/permisos-build.json`]: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'], Resource: '*' }] }, null, 2) + '\n' },
} as const;

// ───────────────────────── escenarios ─────────────────────────

const bucketWith = (a: Account, name: string, files: Record<string, string>, key: string, versioning = false) => {
  const b = s3CreateBucket(a, name, R, versioning ? { versioning: 'Enabled' } : {});
  s3Put(a, b, key, makeZip(files));
  return b;
};

const buildRole = (a: Account, name: string) =>
  iamCreateRole(a, name, TRUST('codebuild.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: ['s3:*', 'logs:*'], Resource: '*' }]) } }).Arn;

const buildProject = (a: Account, name: string, serviceRole: string, src: Record<string, unknown>, art: Record<string, unknown>) =>
  call(a, 'codebuild', 'create-project', { name, source: src, artifacts: art, environment: { type: 'LINUX_CONTAINER', image: 'aws/codebuild/standard:7.0', computeType: 'BUILD_GENERAL1_SMALL' }, serviceRole });

export function makeIacScenarios(base: Scenario): Record<string, Scenario> {
  /** Una pila creada con un nombre de bucket que ya existe: se queda en ROLLBACK_COMPLETE. */
  const pilas: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, `catalogo-prod-${ACCT}`, R);
    call(a, 'cloudformation', 'create-stack', { StackName: 'catalogo', TemplateBody: PILAS_YAML });
    a.clock += 10 * 60000;
  };

  /** La pila `tienda` en producción, con tres pedidos en la cola `ventas`. */
  const cambios: Scenario = (a) => {
    base(a);
    call(a, 'cloudformation', 'create-stack', { StackName: 'tienda', TemplateBody: TIENDA_V1 });
    a.clock += 5 * 60000;
    const url = `https://sqs.${R}.amazonaws.com/${ACCT}/ventas`;
    for (const m of ['pedido-1', 'pedido-2', 'pedido-3']) call(a, 'sqs', 'send-message', { QueueUrl: url, MessageBody: m });
  };

  /** La pila `web` con dos recursos modificados a mano desde la consola. */
  const deriva: Scenario = (a) => {
    base(a);
    call(a, 'cloudformation', 'create-stack', { StackName: 'web', TemplateBody: WEB_YAML });
    a.clock += 5 * 60000;
    const bucket = call(a, 'cloudformation', 'describe-stack-resource', { StackName: 'web', LogicalResourceId: 'Datos' }).StackResourceDetail.PhysicalResourceId as string;
    call(a, 's3api', 'put-bucket-versioning', { Bucket: bucket, VersioningConfiguration: { Status: 'Suspended' } });
    call(a, 'sqs', 'set-queue-attributes', { QueueUrl: `https://sqs.${R}.amazonaws.com/${ACCT}/avisos-web`, Attributes: { VisibilityTimeout: '5' } });
  };

  const sam: Scenario = (a) => {
    base(a);
    s3CreateBucket(a, 'artefactos', R);
  };

  /** CodeBuild con un proyecto cuyo código fuente (en S3) tiene un error. */
  const build: Scenario = (a) => {
    base(a);
    bucketWith(a, 'codigo', BUILD_SRC, 'tienda.zip');
    s3CreateBucket(a, 'artefactos', R);
    buildProject(a, 'tienda', buildRole(a, 'build-role'), { type: 'S3', location: 'codigo/tienda.zip' }, { type: 'S3', location: 'artefactos', packaging: 'ZIP' });
  };

  /** Una canalización sin crear: el origen no tiene versiones y el rol no puede lanzar CodeBuild. */
  const pipeline: Scenario = (a) => {
    base(a);
    bucketWith(a, 'codigo', WEB_SRC, 'web.zip');
    s3CreateBucket(a, 'artefactos', R);
    s3CreateBucket(a, 'sitio', R);
    buildProject(a, 'web-build', buildRole(a, 'web-build-role'), { type: 'CODEPIPELINE' }, { type: 'CODEPIPELINE' });
    iamCreateRole(a, 'web-pipe-role', TRUST('codepipeline.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: 's3:*', Resource: '*' }]) } });
  };

  /** Una canalización completa parada en la aprobación manual. */
  const aprobacion: Scenario = (a) => {
    base(a);
    bucketWith(a, 'codigo', WEB_SRC, 'web.zip', true);
    s3CreateBucket(a, 'artefactos', R);
    s3CreateBucket(a, 'sitio', R);
    buildProject(a, 'web-build', buildRole(a, 'web-build-role'), { type: 'CODEPIPELINE' }, { type: 'CODEPIPELINE' });
    iamCreateRole(a, 'web-pipe-role', TRUST('codepipeline.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: ['s3:*', 'codebuild:StartBuild', 'codebuild:BatchGetBuilds'], Resource: '*' }]) } });
    call(a, 'codepipeline', 'create-pipeline', webPipeline(true));
    a.clock += 10 * 60000;
  };

  /** La función `tienda` con la versión 1 en producción y la 2 publicada; un alarma de errores y los roles de CodeDeploy. */
  const deploy: Scenario = (a) => {
    base(a);
    const r = role(a, 'tienda-role', { attached: [BASIC] });
    fn(a, 'tienda', "def lambda_handler(event, context):\n    return {'version': 1, 'mensaje': 'Tienda estable'}\n", r);
    call(a, 'lambda', 'publish-version', { FunctionName: 'tienda' });
    call(a, 'lambda', 'update-function-code', { FunctionName: 'tienda', ZipFile: makeZip({ 'lambda_function.py': "def lambda_handler(event, context):\n    return {'version': 2, 'mensaje': 'Tienda con novedades'}\n" }) });
    call(a, 'lambda', 'publish-version', { FunctionName: 'tienda' });
    call(a, 'lambda', 'create-alias', { FunctionName: 'tienda', Name: 'live', FunctionVersion: '1' });
    iamCreateRole(a, 'cd-role', TRUST('codedeploy.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: ['lambda:*', 'cloudwatch:DescribeAlarms'], Resource: '*' }]) } });
    call(a, 'deploy', 'create-application', { ApplicationName: 'tienda', ComputePlatform: 'Lambda' });
    call(a, 'cloudwatch', 'put-metric-alarm', { AlarmName: 'errores-tienda', Namespace: 'AWS/Lambda', MetricName: 'Errors', Statistic: 'Sum', Period: 60, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', Dimensions: [{ Name: 'FunctionName', Value: 'tienda' }] });
  };

  /** Misión final: el código de la tienda en S3, CodeBuild y los roles listos, pero la canalización no puede desplegar. */
  const boss: Scenario = (a) => {
    base(a);
    bucketWith(a, 'codigo', BOSS_SRC, 'tienda.zip', true);
    s3CreateBucket(a, 'artefactos', R);
    buildProject(a, 'tienda-build', buildRole(a, 'build-role'), { type: 'CODEPIPELINE' }, { type: 'CODEPIPELINE' });
    iamCreateRole(a, 'pipe-role', TRUST('codepipeline.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: 's3:*', Resource: '*' }]) } });
    iamCreateRole(a, 'cfn-role', TRUST('cloudformation.amazonaws.com'), { attached: [], inline: { permisos: policy([{ Action: ['lambda:*', 'iam:*', 'dynamodb:*', 'apigateway:*', 's3:*', 'logs:*'], Resource: '*' }]) } });
  };

  return {
    'iac-pilas': pilas,
    'iac-cambios': cambios,
    'iac-deriva': deriva,
    'iac-sam': sam,
    'iac-build': build,
    'iac-pipeline': pipeline,
    'iac-aprobacion': aprobacion,
    'iac-deploy': deploy,
    'iac-boss': boss,
  };
}
