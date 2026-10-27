import { makeZip } from '../../engine/commands/archive';
import { mkEnv, type TestEnv } from './helpers';

const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const SPEC = `version: 0.2
phases:
  build:
    commands:
      - pytest
      - mkdir -p out
      - cp index.html out/
      - cp template.yaml out/
artifacts:
  files:
    - '**/*'
  base-directory: out
`;
const TEMPLATE = `Resources:
  Datos:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: datos-del-pipeline
`;
const APP = { 'buildspec.yml': SPEC, 'index.html': '<h1>v1</h1>', 'template.yaml': TEMPLATE, 'test_a.py': 'def test_a():\n    assert 1 + 1 == 2\n' };
const ROLE_POLICY = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'codebuild:StartBuild', 'codebuild:BatchGetBuilds', 'cloudformation:*', 'sqs:*', 'iam:PassRole', 'codedeploy:*'], Resource: '*' }] };

const action = (category: string, provider: string, name: string, configuration: Record<string, string>, ins: string[] = [], outs: string[] = [], extra: Record<string, unknown> = {}) => ({
  name,
  actionTypeId: { category, owner: 'AWS', provider, version: '1' },
  configuration,
  inputArtifacts: ins.map((n) => ({ name: n })),
  outputArtifacts: outs.map((n) => ({ name: n })),
  ...extra,
});
const SOURCE = action('Source', 'S3', 'Origen', { S3Bucket: 'codigo', S3ObjectKey: 'src.zip' }, [], ['Codigo']);
const BUILD = action('Build', 'CodeBuild', 'Compilar', { ProjectName: 'web' }, ['Codigo'], ['Compilado']);
const DEPLOY_S3 = action('Deploy', 'S3', 'Publicar', { BucketName: 'sitio', Extract: 'true' }, ['Compilado']);
const def = (stages: unknown[], over: Record<string, unknown> = {}) => ({ pipeline: { name: 'web', roleArn: 'arn:aws:iam::123456789012:role/pipe-role', artifactStore: { type: 'S3', location: 'artefactos' }, stages, ...over } });
const STAGES = [
  { name: 'Source', actions: [SOURCE] },
  { name: 'Build', actions: [BUILD] },
  { name: 'Deploy', actions: [DEPLOY_S3] },
];

async function setup(o: { versioning?: boolean; policy?: object | null; files?: Record<string, string> } = {}) {
  const e = mkEnv();
  await e.run('s3 mb s3://codigo');
  if (o.versioning !== false) await e.run('s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled');
  await e.run('s3 mb s3://artefactos');
  await e.run('s3 mb s3://sitio');
  e.write('src.zip', makeZip({ ...APP, ...(o.files ?? {}) }));
  await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
  e.write('cb.json', trust('codebuild.amazonaws.com'));
  await e.run('iam create-role --role-name build-role --assume-role-policy-document file://cb.json');
  e.write('bp.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'logs:*'], Resource: '*' }] }));
  await e.run('iam put-role-policy --role-name build-role --policy-name b --policy-document file://bp.json');
  await e.run('codebuild create-project --name web --source type=CODEPIPELINE --artifacts type=CODEPIPELINE --environment type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL --service-role arn:aws:iam::123456789012:role/build-role');
  e.write('cp.json', trust('codepipeline.amazonaws.com'));
  await e.run('iam create-role --role-name pipe-role --assume-role-policy-document file://cp.json');
  if (o.policy !== null) {
    e.write('pp.json', JSON.stringify(o.policy ?? ROLE_POLICY));
    await e.run('iam put-role-policy --role-name pipe-role --policy-name p --policy-document file://pp.json');
  }
  return e;
}
const create = (e: TestEnv, stages: unknown[] = STAGES, over: Record<string, unknown> = {}) => {
  e.write('pipeline.json', JSON.stringify(def(stages, over)));
  return e.run('codepipeline create-pipeline --cli-input-json file://pipeline.json');
};
const states = async (e: TestEnv) => {
  const r = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]"');
  return Object.fromEntries(r as [string, string][]);
};
const failures = async (e: TestEnv) => {
  const r = await e.json('codepipeline get-pipeline-state --name web');
  return r.stageStates.flatMap((s: any) => s.actionStates.filter((a: any) => a.latestExecution?.status === 'Failed').map((a: any) => `${s.stageName}/${a.actionName}: ${a.latestExecution.errorDetails.message}`));
};
const later = (e: TestEnv, min: number) => {
  e.acct.clock += min * 60000;
};

describe('CodePipeline', () => {
  test('una canalización completa: origen S3 → compilación → despliegue en S3', async () => {
    const e = await setup();
    const r = await create(e);
    expect(r.code).toBe(0);
    expect(await states(e)).toEqual({ Source: 'InProgress', Build: null, Deploy: null });
    later(e, 10);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Deploy: 'Succeeded' });
    expect((await e.run('s3 cp s3://sitio/index.html -')).stdout).toContain('<h1>v1</h1>');
    const execs = await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[].[status,trigger.triggerType]"');
    expect(execs).toEqual([['Succeeded', 'CreatePipeline']]);
    expect(await e.json('codepipeline list-pipelines --query "pipelines[].name"')).toEqual(['web']);
    expect(await e.json('codepipeline get-pipeline --name web --query "pipeline.stages[].name"')).toEqual(['Source', 'Build', 'Deploy']);
    // la compilación quedó registrada en CodeBuild, lanzada por la canalización
    const ids = await e.json('codebuild list-builds-for-project --project-name web --query "ids"');
    expect(ids).toHaveLength(1);
    const b = (await e.json(`codebuild batch-get-builds --ids ${ids[0]}`)).builds[0];
    expect(b.buildStatus).toBe('SUCCEEDED');
    expect(b.initiator).toBe('codepipeline/web');
    // y el almacén de artefactos guarda cada artefacto
    const keys = await e.json('s3api list-objects-v2 --bucket artefactos --query "Contents[].Key"');
    expect(keys.some((k: string) => k.startsWith('web/Codigo/'))).toBe(true);
    expect(keys.some((k: string) => k.startsWith('web/Compilado/'))).toBe(true);
  });

  test('validaciones de la definición', async () => {
    const e = await setup();
    expect((await create(e, [{ name: 'Source', actions: [SOURCE] }])).stderr).toContain('must have at least 2 stages');
    expect((await create(e, [{ name: 'Build', actions: [BUILD] }, { name: 'Source', actions: [SOURCE] }])).stderr).toContain('first stage');
    expect((await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Source', actions: [BUILD] }])).stderr).toContain('duplicated');
    expect((await create(e, [{ name: 'Source', actions: [{ ...SOURCE, configuration: { S3Bucket: 'codigo' } }] }, { name: 'Build', actions: [BUILD] }])).stderr).toContain("missing required configuration 'S3ObjectKey'");
    expect((await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Build', actions: [{ ...BUILD, inputArtifacts: [{ name: 'Fantasma' }] }] }])).stderr).toContain("input artifact 'Fantasma'");
    expect((await create(e, STAGES, { artifactStore: { type: 'S3', location: 'no-existe' } })).stderr).toContain('does not exist');
    expect((await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Test', actions: [action('Test', 'Jenkins', 'Prueba', {}, ['Codigo'])] }])).stderr).toContain('ActionTypeNotFound');
    // el rol debe poder asumirlo codepipeline.amazonaws.com
    expect((await create(e, STAGES, { roleArn: 'arn:aws:iam::123456789012:role/build-role' })).stderr).toContain('not authorized to perform AssumeRole');
    expect((await create(e, STAGES, { roleArn: 'arn:aws:iam::123456789012:role/no-existe' })).stderr).toContain('not authorized to perform AssumeRole');
    expect((await create(e)).code).toBe(0);
    expect((await create(e)).stderr).toContain('already exists');
  });

  test('el origen S3 exige un bucket con versiones', async () => {
    const e = await setup({ versioning: false });
    await create(e);
    later(e, 5);
    expect(await states(e)).toMatchObject({ Source: 'Failed' });
    expect((await failures(e))[0]).toContain('versioning of the bucket');
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('Failed');
    await e.run('s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled');
    e.write('src.zip', makeZip(APP));
    await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
    later(e, 1);
    // al haber una versión nueva (con el bucket ya versionado) la canalización arranca sola
    await e.run('codepipeline list-pipelines');
    later(e, 10);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Deploy: 'Succeeded' });
  });

  test('si el rol no puede iniciar la compilación, falla con el permiso que falta y se reintenta la etapa', async () => {
    const e = await setup({ policy: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*'], Resource: '*' }] } });
    await create(e);
    later(e, 10);
    expect(await states(e)).toMatchObject({ Source: 'Succeeded', Build: 'Failed' });
    expect((await failures(e))[0]).toContain('codebuild:StartBuild');
    const detail = await e.json('codepipeline list-action-executions --pipeline-name web --query "actionExecutionDetails[?status==\'Failed\'].output.executionResult.errorDetails.message | [0]"');
    expect(detail).toContain('pipe-role is not authorized to perform: codebuild:StartBuild');
    e.write('pp.json', JSON.stringify(ROLE_POLICY));
    await e.run('iam put-role-policy --role-name pipe-role --policy-name p --policy-document file://pp.json');
    const id = await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].pipelineExecutionId"');
    const retry = await e.run(`codepipeline retry-stage-execution --pipeline-name web --stage-name Build --pipeline-execution-id ${id} --retry-mode FAILED_ACTIONS`);
    expect(retry.code).toBe(0);
    later(e, 10);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Deploy: 'Succeeded' });
  });

  test('si falla una prueba de la compilación, la etapa falla y no se despliega nada', async () => {
    const e = await setup({ files: { 'test_a.py': 'def test_a():\n    assert 1 + 1 == 3\n' } });
    await create(e);
    later(e, 10);
    expect(await states(e)).toMatchObject({ Build: 'Failed', Deploy: null });
    expect((await failures(e))[0]).toContain('Build/Compilar: Error in the BUILD phase');
    expect((await e.run('s3api head-object --bucket sitio --key index.html')).code).not.toBe(0);
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('Failed');
  });

  test('aprobación manual: la canalización espera y se reanuda al aprobar; rechazar la detiene', async () => {
    const e = await setup();
    const approval = action('Approval', 'Manual', 'Revisar', { CustomData: 'Revisa la versión antes de publicar' });
    await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Build', actions: [BUILD] }, { name: 'Aprobar', actions: [approval] }, { name: 'Deploy', actions: [DEPLOY_S3] }]);
    later(e, 10);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Aprobar: 'InProgress', Deploy: null });
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('InProgress');
    later(e, 60);
    expect((await states(e)).Aprobar).toBe('InProgress');
    const token = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[?stageName==\'Aprobar\'].actionStates[0].latestExecution.token | [0]"');
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await e.run('codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revisar --result summary=ok,status=Approved --token 00000000-0000-0000-0000-000000000000')).stderr).toContain('InvalidApprovalTokenException');
    expect((await e.run('codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revisar --result summary=ok,status=Quizas --token ' + token)).stderr).toContain('Approved or Rejected');
    expect((await e.run(`codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revisar --result summary=todo-bien,status=Approved --token ${token}`)).code).toBe(0);
    later(e, 5);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Aprobar: 'Succeeded', Deploy: 'Succeeded' });
    expect((await e.run('s3 ls s3://sitio/')).stdout).toContain('index.html');
    expect((await e.run(`codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revisar --result summary=ok,status=Approved --token ${token}`)).stderr).toContain('ApprovalAlreadyCompleted');
    // un rechazo: la ejecución falla y no se despliega
    await e.run('s3 rm s3://sitio --recursive');
    await e.run('codepipeline start-pipeline-execution --name web');
    later(e, 10);
    const t2 = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[?stageName==\'Aprobar\'].actionStates[0].latestExecution.token | [0]"');
    await e.run(`codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revisar --result summary=no,status=Rejected --token ${t2}`);
    later(e, 5);
    expect(await states(e)).toMatchObject({ Aprobar: 'Failed', Deploy: null });
    expect((await e.run('s3 ls s3://sitio/')).stdout).toBe('');
  });

  test('un cambio en el objeto de origen lanza la canalización sola', async () => {
    const e = await setup();
    await create(e);
    later(e, 10);
    e.write('src.zip', makeZip({ ...APP, 'index.html': '<h1>v2</h1>' }));
    await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
    later(e, 2);
    await e.run('codepipeline list-pipelines');
    later(e, 10);
    const execs = await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[].[status,trigger.triggerType]"');
    expect(execs).toEqual([['Succeeded', 'PollForSourceChanges'], ['Succeeded', 'CreatePipeline']]);
    expect((await e.run('s3 cp s3://sitio/index.html -')).stdout).toContain('<h1>v2</h1>');
    // sin cambios no se vuelve a ejecutar
    later(e, 20);
    await e.run('codepipeline list-pipelines');
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "length(pipelineExecutionSummaries)"')).toBe(2);
  });

  test('despliegue con CloudFormation: crea la pila y la actualiza en la siguiente ejecución', async () => {
    const e = await setup();
    const cfn = action('Deploy', 'CloudFormation', 'Pila', { ActionMode: 'CREATE_UPDATE', StackName: 'infra', TemplatePath: 'Compilado::template.yaml', Capabilities: 'CAPABILITY_IAM' }, ['Compilado']);
    await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Build', actions: [BUILD] }, { name: 'Infra', actions: [cfn] }]);
    later(e, 10);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Infra: 'Succeeded' });
    expect(await e.json('cloudformation describe-stacks --stack-name infra --query "Stacks[0].StackStatus"')).toBe('CREATE_COMPLETE');
    expect((await e.run('s3api head-bucket --bucket datos-del-pipeline')).code).toBe(0);
    // plantilla con un recurso más → UPDATE_COMPLETE
    e.write('src.zip', makeZip({ ...APP, 'template.yaml': TEMPLATE + '  Cola:\n    Type: AWS::SQS::Queue\n' }));
    await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
    later(e, 3);
    await e.run('codepipeline list-pipelines');
    later(e, 10);
    expect(await e.json('cloudformation describe-stacks --stack-name infra --query "Stacks[0].StackStatus"')).toBe('UPDATE_COMPLETE');
    expect(await e.json('sqs list-queues --query "length(QueueUrls)"')).toBe(1);
    // una plantilla rota hace fallar la acción con el motivo
    e.write('src.zip', makeZip({ ...APP, 'template.yaml': 'Resources:\n  Mala:\n    Type: AWS::No::Existe\n' }));
    await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
    later(e, 3);
    await e.run('codepipeline list-pipelines');
    later(e, 10);
    expect(await states(e)).toMatchObject({ Infra: 'Failed' });
    expect((await failures(e))[0]).toContain('Infra/Pila');
  });

  test('CloudFormation en el pipeline necesita permisos y el rol pasado', async () => {
    const e = await setup({ policy: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'codebuild:*'], Resource: '*' }] } });
    const cfn = action('Deploy', 'CloudFormation', 'Pila', { ActionMode: 'CREATE_UPDATE', StackName: 'infra', TemplatePath: 'Compilado::template.yaml' }, ['Compilado']);
    await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Build', actions: [BUILD] }, { name: 'Infra', actions: [cfn] }]);
    later(e, 10);
    expect(await states(e)).toMatchObject({ Infra: 'Failed' });
    expect((await failures(e))[0]).toContain('cloudformation:DescribeStacks');
  });

  test('acción CodeDeploy: publica una versión nueva de Lambda con el appspec del artefacto', async () => {
    const files = {
      'buildspec.yml': 'version: 0.2\nphases:\n  build:\n    commands:\n      - mkdir -p out\n      - cp appspec.yml out/\nartifacts:\n  files:\n    - appspec.yml\n  base-directory: out\n',
      'appspec.yml': 'version: 0.0\nResources:\n  - miFuncion:\n      Type: AWS::Lambda::Function\n      Properties:\n        Name: tienda\n        Alias: live\n        CurrentVersion: "1"\n        TargetVersion: "2"\n',
      'test_a.py': '',
    };
    const e = await setup({ files });
    e.write('lam.json', trust('lambda.amazonaws.com'));
    await e.run('iam create-role --role-name fn-role --assume-role-policy-document file://lam.json');
    const mk = async (v: string) => {
      e.write('fn.zip', makeZip({ 'lambda_function.py': `def lambda_handler(event, context):\n    return '${v}'\n` }));
      return v;
    };
    await mk('v1');
    await e.run('lambda create-function --function-name tienda --runtime python3.12 --role arn:aws:iam::123456789012:role/fn-role --handler lambda_function.lambda_handler --zip-file fileb://fn.zip');
    await e.run('lambda publish-version --function-name tienda');
    await mk('v2');
    await e.run('lambda update-function-code --function-name tienda --zip-file fileb://fn.zip');
    await e.run('lambda publish-version --function-name tienda');
    await e.run('lambda create-alias --function-name tienda --name live --function-version 1');
    e.write('cd.json', trust('codedeploy.amazonaws.com'));
    await e.run('iam create-role --role-name cd-role --assume-role-policy-document file://cd.json');
    await e.run('iam put-role-policy --role-name cd-role --policy-name l --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:*","cloudwatch:DescribeAlarms"],"Resource":"*"}]}\'');
    await e.run('deploy create-application --application-name tienda --compute-platform Lambda');
    await e.run('deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaAllAtOnce');
    const cd = action('Deploy', 'CodeDeploy', 'Lambda', { ApplicationName: 'tienda', DeploymentGroupName: 'prod' }, ['Compilado']);
    await create(e, [{ name: 'Source', actions: [SOURCE] }, { name: 'Build', actions: [BUILD] }, { name: 'Release', actions: [cd] }]);
    later(e, 15);
    expect(await states(e)).toEqual({ Source: 'Succeeded', Build: 'Succeeded', Release: 'Succeeded' });
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('2');
    expect(await e.json('deploy list-deployments --query "length(deployments)"')).toBe(1);
  });

  test('stop, update y delete', async () => {
    const e = await setup();
    await create(e);
    const id = await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].pipelineExecutionId"');
    expect((await e.run(`codepipeline stop-pipeline-execution --pipeline-name web --pipeline-execution-id ${id} --reason pruebas`)).code).toBe(0);
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('Stopped');
    e.write('pipeline.json', JSON.stringify(def([STAGES[0], STAGES[1]])));
    expect((await e.run('codepipeline update-pipeline --cli-input-json file://pipeline.json')).code).toBe(0);
    expect(await e.json('codepipeline get-pipeline --name web --query "pipeline.version"')).toBe(2);
    expect(await e.json('codepipeline get-pipeline --name web --query "length(pipeline.stages)"')).toBe(2);
    expect((await e.run('codepipeline delete-pipeline --name web')).code).toBe(0);
    expect((await e.run('codepipeline get-pipeline --name web')).stderr).toContain('PipelineNotFoundException');
  });
});
