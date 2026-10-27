import { makeZip } from '../../engine/commands/archive';
import { IAC_FILES } from '../scenarios-iac';
import { mkEnv, type TestEnv } from './helpers';

const SC = ['iac-pilas', 'iac-cambios', 'iac-deriva', 'iac-sam', 'iac-build', 'iac-pipeline', 'iac-aprobacion', 'iac-deploy', 'iac-boss'];
const env = (scenario: string, files: Record<string, string> = {}) => mkEnv({ scenario }, files);
const later = (e: TestEnv, min: number) => {
  e.acct.clock += min * 60000;
};
const status = (e: TestEnv, stack: string) => e.json(`cloudformation describe-stacks --stack-name ${stack} --query "Stacks[0].StackStatus"`);

describe('escenarios de IaC y CI/CD', () => {
  test.each(SC)('%s se construye', (s) => {
    expect(() => env(s)).not.toThrow();
  });


  test('plantilla: parámetros, mapas, condiciones y salidas', async () => {
    const e = env('base', IAC_FILES.plantilla);
    expect(await e.json('cloudformation validate-template --template-body file://web.yaml --query "Parameters[].ParameterKey"')).toEqual(['Entorno']);
    expect((await e.run('cloudformation create-stack --stack-name x --template-body file://web.yaml --parameters ParameterKey=Entorno,ParameterValue=test')).stderr).toContain('not an allowed value');
    expect((await e.run('cloudformation create-stack --stack-name web-prod --template-body file://web.yaml --parameters ParameterKey=Entorno,ParameterValue=prod')).code).toBe(0);
    await e.run('cloudformation wait stack-create-complete --stack-name web-prod');
    expect(await status(e, 'web-prod')).toBe('CREATE_COMPLETE');
    expect(await e.json('cloudformation list-stack-resources --stack-name web-prod --query "length(StackResourceSummaries)"')).toBe(3);
    expect(await e.json('cloudformation describe-stacks --stack-name web-prod --query "Stacks[0].Outputs[?OutputKey==\'Cubo\'].OutputValue | [0]"')).toBe('tienda-prod-123456789012');
    expect((await e.run('cloudformation create-stack --stack-name web-dev --template-body file://web.yaml')).code).toBe(0);
    await e.run('cloudformation wait stack-create-complete --stack-name web-dev');
    expect(await e.json('cloudformation list-stack-resources --stack-name web-dev --query "length(StackResourceSummaries)"')).toBe(2);
  });

  test('rota: validate-template explica la referencia que no existe', async () => {
    const e = env('base', IAC_FILES.rota);
    const r = await e.run('cloudformation validate-template --template-body file://rota.yaml');
    expect(r.stderr).toContain('Unresolved resource dependencies [Colas] in the Outputs block');
    e.write('rota.yaml', IAC_FILES.rota['/home/alumno/rota.yaml'].replace('Colas', 'Cola'));
    expect((await e.run('cloudformation validate-template --template-body file://rota.yaml')).code).toBe(0);
    expect((await e.run('cloudformation create-stack --stack-name reparada --template-body file://rota.yaml')).code).toBe(0);
  });

  test('pilas: la pila fallida se explica en los eventos y se arregla borrándola y creándola de nuevo', async () => {
    const e = env('iac-pilas', IAC_FILES.pilas);
    expect(await status(e, 'catalogo')).toBe('ROLLBACK_COMPLETE');
    const why = (await e.run('cloudformation describe-stack-events --stack-name catalogo --query "StackEvents[?ResourceStatus==\'CREATE_FAILED\'].ResourceStatusReason" --output text')).stdout;
    expect(why).toContain('already exists');
    expect((await e.run('cloudformation create-stack --stack-name catalogo --template-body file://catalogo.yaml')).stderr).toContain('AlreadyExists');
    expect((await e.run('cloudformation delete-stack --stack-name catalogo')).code).toBe(0);
    expect((await e.run('cloudformation wait stack-delete-complete --stack-name catalogo')).code).toBe(0);
    e.write('catalogo.yaml', IAC_FILES.pilas[`/home/alumno/catalogo.yaml`].replace(/\n\s+BucketName:.*/, ''));
    expect((await e.run('cloudformation create-stack --stack-name catalogo --template-body file://catalogo.yaml')).code).toBe(0);
    expect((await e.run('cloudformation wait stack-create-complete --stack-name catalogo')).code).toBe(0);
    expect(await status(e, 'catalogo')).toBe('CREATE_COMPLETE');
  });

  test('cambios: el conjunto de cambios avisa de la sustitución y la actualización segura conserva los mensajes', async () => {
    const e = env('iac-cambios', IAC_FILES.cambios);
    expect(await status(e, 'tienda')).toBe('CREATE_COMPLETE');
    expect((await e.run('cloudformation create-change-set --stack-name tienda --change-set-name v2 --template-body file://tienda-v2.yaml')).code).toBe(0);
    await e.run('cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v2');
    const ch = await e.json('cloudformation describe-change-set --stack-name tienda --change-set-name v2 --query "Changes[].ResourceChange.[LogicalResourceId,Action,Replacement]"');
    expect(ch).toEqual([['Ventas', 'Modify', 'True']]);
    await e.run('cloudformation delete-change-set --stack-name tienda --change-set-name v2');
    e.write('tienda-v2.yaml', IAC_FILES.cambios['/home/alumno/tienda-v2.yaml'].replace('ventas-2026', 'ventas'));
    await e.run('cloudformation create-change-set --stack-name tienda --change-set-name v2b --template-body file://tienda-v2.yaml');
    await e.run('cloudformation wait change-set-create-complete --stack-name tienda --change-set-name v2b');
    expect(await e.json('cloudformation describe-change-set --stack-name tienda --change-set-name v2b --query "Changes[].ResourceChange.Replacement"')).toEqual(['False']);
    expect((await e.run('cloudformation execute-change-set --stack-name tienda --change-set-name v2b')).code).toBe(0);
    await e.run('cloudformation wait stack-update-complete --stack-name tienda');
    expect(await status(e, 'tienda')).toBe('UPDATE_COMPLETE');
    expect(await e.json('sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/ventas --attribute-names VisibilityTimeout ApproximateNumberOfMessages --query Attributes')).toEqual({ VisibilityTimeout: '60', ApproximateNumberOfMessages: '3' });
  });

  test('deriva: la detección encuentra los dos cambios manuales y al revertirlos la pila vuelve a estar sincronizada', async () => {
    const e = env('iac-deriva', IAC_FILES.deriva);
    const id = await e.json('cloudformation detect-stack-drift --stack-name web --query StackDriftDetectionId');
    expect(await e.json(`cloudformation describe-stack-drift-detection-status --stack-drift-detection-id ${id} --query StackDriftStatus`)).toBe('DRIFTED');
    const d = await e.json('cloudformation describe-stack-resource-drifts --stack-name web --stack-resource-drift-status-filters MODIFIED --query "StackResourceDrifts[].LogicalResourceId"');
    expect(d.sort()).toEqual(['Avisos', 'Datos']);
    const bucket = await e.json('cloudformation describe-stack-resource --stack-name web --logical-resource-id Datos --query StackResourceDetail.PhysicalResourceId');
    await e.run(`s3api put-bucket-versioning --bucket ${bucket} --versioning-configuration Status=Enabled`);
    await e.run('sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/avisos-web --attributes VisibilityTimeout=45');
    await e.run('cloudformation detect-stack-drift --stack-name web');
    expect(await e.json('cloudformation describe-stacks --stack-name web --query "Stacks[0].DriftInformation.StackDriftStatus"')).toBe('IN_SYNC');
  });

  test('sam: package y deploy crean la API y la función responde', async () => {
    const e = env('iac-sam', IAC_FILES.sam);
    const bad = await e.run('cloudformation deploy --template-file plantilla.yaml --stack-name saludos --capabilities CAPABILITY_IAM');
    expect(bad.code).not.toBe(0);
    expect((await e.run('cloudformation package --template-file plantilla.yaml --s3-bucket artefactos --output-template-file empaquetada.yaml')).code).toBe(0);
    const d = await e.run('cloudformation deploy --template-file empaquetada.yaml --stack-name saludos --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND');
    expect(d.code).toBe(0);
    e.io.god = true;
    const r = await e.json(`_check invoke --function saludo --payload '{}' --query Payload`);
    expect(JSON.stringify(r)).toContain('Hola desde SAM');
  });

  test('cdk: la plantilla sintetizada se despliega y al destruir la pila el bucket se conserva', async () => {
    const e = env('base', IAC_FILES.cdk);
    expect((await e.run('cloudformation deploy --template-file cdk.out/DatosStack.template.json --stack-name DatosStack')).code).toBe(0);
    expect(await e.json('s3api list-buckets --query "length(Buckets)"')).toBe(1);
    expect((await e.run('cloudformation delete-stack --stack-name DatosStack')).code).toBe(0);
    await e.run('cloudformation wait stack-delete-complete --stack-name DatosStack');
    expect(await e.json('s3api list-buckets --query "length(Buckets)"')).toBe(1);
    expect(await e.json('sqs list-queues --query "length(QueueUrls || `[]`)"')).toBe(0);
  });

  test('build: la compilación falla por la prueba y al corregirlo sale el artefacto', async () => {
    const e = env('iac-build', IAC_FILES.build);
    const id = await e.json('codebuild start-build --project-name tienda --query build.id');
    later(e, 5);
    const b = (await e.json(`codebuild batch-get-builds --ids ${id}`)).builds[0];
    expect(b.buildStatus).toBe('FAILED');
    expect(b.phases.find((p: any) => p.phaseStatus === 'FAILED').phaseType).toBe('PRE_BUILD');
    const logs = (await e.run(`logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name ${id.split(':')[1]} --query "events[].message" --output text`)).stdout;
    expect(logs).toContain('FAILED test_app.py::test_descuento');
    const fixed = IAC_FILES.build['/home/alumno/tienda/app.py'].replace('precio - descuento', 'precio * (100 - descuento) / 100');
    e.write('tienda/app.py', fixed);
    e.write('tienda.zip', makeZip({ 'buildspec.yml': IAC_FILES.build['/home/alumno/tienda/buildspec.yml'], 'app.py': fixed, 'test_app.py': IAC_FILES.build['/home/alumno/tienda/test_app.py'] }));
    await e.run('s3api put-object --bucket codigo --key tienda.zip --body tienda.zip');
    const id2 = await e.json('codebuild start-build --project-name tienda --query build.id');
    later(e, 5);
    expect((await e.json(`codebuild batch-get-builds --ids ${id2} --query "builds[0].buildStatus"`))).toBe('SUCCEEDED');
    expect(await e.json('s3api list-objects-v2 --bucket artefactos --query "Contents[].Key"')).toEqual(['tienda.zip']);
  });

  test('pipeline: sin versiones falla el origen, sin permisos falla la compilación y al arreglar ambos se publica el sitio', async () => {
    const e = env('iac-pipeline', IAC_FILES.pipeline);
    expect((await e.run('codepipeline create-pipeline --cli-input-json file://pipeline.json')).code).toBe(0);
    later(e, 3);
    let st = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]"');
    expect(st[0]).toEqual(['Origen', 'Failed']);
    expect(await e.json('codepipeline get-pipeline-state --name web --query "stageStates[0].actionStates[0].latestExecution.errorDetails.message"')).toContain('versioning');
    await e.run('s3api put-bucket-versioning --bucket codigo --versioning-configuration Status=Enabled');
    later(e, 1);
    await e.run('codepipeline start-pipeline-execution --name web');
    later(e, 5);
    st = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]"');
    expect(st.slice(0, 2)).toEqual([['Origen', 'Succeeded'], ['Compilar', 'Failed']]);
    const msg = await e.json('codepipeline list-action-executions --pipeline-name web --query "actionExecutionDetails[?status==\'Failed\'].output.executionResult.errorDetails.message | [0]"');
    expect(msg).toContain('codebuild:StartBuild');
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:*', 'codebuild:StartBuild', 'codebuild:BatchGetBuilds'], Resource: '*' }] }));
    await e.run('iam put-role-policy --role-name web-pipe-role --policy-name permisos --policy-document file://p.json');
    await e.run('codepipeline start-pipeline-execution --name web');
    later(e, 10);
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('Succeeded');
    expect((await e.run('s3 ls s3://sitio/')).stdout).toContain('index.html');
  });

  test('aprobacion: la canalización espera y al aprobar se publica', async () => {
    const e = env('iac-aprobacion');
    const st = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[].[stageName,latestExecution.status]"');
    expect(st).toEqual([['Origen', 'Succeeded'], ['Compilar', 'Succeeded'], ['Aprobar', 'InProgress'], ['Publicar', null]]);
    const token = await e.json('codepipeline get-pipeline-state --name web --query "stageStates[?stageName==\'Aprobar\'].actionStates[0].latestExecution.token | [0]"');
    expect((await e.run(`codepipeline put-approval-result --pipeline-name web --stage-name Aprobar --action-name Revision --result summary=Listo,status=Approved --token ${token}`)).code).toBe(0);
    later(e, 5);
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name web --query "pipelineExecutionSummaries[0].status"')).toBe('Succeeded');
    expect((await e.run('s3 ls s3://sitio/')).stdout).toContain('index.html');
  });

  test('deploy: con canario y alarma el despliegue vuelve atrás solo', async () => {
    const e = env('iac-deploy', IAC_FILES.deploy);
    expect((await e.run('deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaCanary10Percent10Minutes --alarm-configuration enabled=true,alarms=[{name=errores-tienda}] --auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM')).code).toBe(0);
    const r = await e.run('deploy create-deployment --application-name tienda --deployment-group-name prod --revision file://revision.json');
    expect(r.code).toBe(0);
    later(e, 1);
    expect(await e.json('lambda get-alias --function-name tienda --name live --query RoutingConfig.AdditionalVersionWeights')).toEqual({ '2': 0.1 });
    await e.run('cloudwatch set-alarm-state --alarm-name errores-tienda --state-value ALARM --state-reason prueba');
    later(e, 4);
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('1');
    expect(await e.json('deploy list-deployments --query "length(deployments)"')).toBe(1);
  });

  test('boss: tres fallos seguidos de la canalización hasta que la pila se despliega', async () => {
    const e = env('iac-boss', IAC_FILES.boss);
    await e.run('codepipeline create-pipeline --cli-input-json file://pipeline.json');
    later(e, 8);
    let msg = await e.json('codepipeline list-action-executions --pipeline-name tienda --query "actionExecutionDetails[?status==\'Failed\'].output.executionResult.errorDetails.message | [0]"');
    expect(msg).toContain('codebuild:StartBuild');
    await e.run('iam put-role-policy --role-name pipe-role --policy-name build --policy-document file://permisos-build.json');
    await e.run('iam put-role-policy --role-name pipe-role --policy-name s3 --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:*","Resource":"*"}]}\'');
    await e.run('codepipeline start-pipeline-execution --name tienda');
    later(e, 8);
    msg = await e.json('codepipeline list-action-executions --pipeline-name tienda --query "actionExecutionDetails[?status==\'Failed\'].output.executionResult.errorDetails.message | [0]"');
    expect(msg).toContain('cloudformation:DescribeStacks');
    await e.run('iam put-role-policy --role-name pipe-role --policy-name cfn --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["cloudformation:*","iam:PassRole"],"Resource":"*"}]}\'');
    await e.run('codepipeline start-pipeline-execution --name tienda');
    later(e, 8);
    msg = await e.json('codepipeline list-action-executions --pipeline-name tienda --query "actionExecutionDetails[?status==\'Failed\'].output.executionResult.errorDetails.message | [0]"');
    expect(msg).toMatch(/CAPABILITY/);
    e.write('pipeline.json', e.files.get('/home/alumno/pipeline.json')!.replace('"ActionMode": "CREATE_UPDATE",', '"ActionMode": "CREATE_UPDATE", "Capabilities": "CAPABILITY_IAM,CAPABILITY_AUTO_EXPAND",'));
    expect((await e.run('codepipeline update-pipeline --cli-input-json file://pipeline.json')).code).toBe(0);
    await e.run('codepipeline start-pipeline-execution --name tienda');
    later(e, 10);
    expect(await e.json('codepipeline list-pipeline-executions --pipeline-name tienda --query "pipelineExecutionSummaries[0].status"')).toBe('Succeeded');
    expect(await status(e, 'tienda-api')).toBe('CREATE_COMPLETE');
    e.io.god = true;
    expect(JSON.stringify(await e.json(`_check invoke --function tienda --payload '{}' --query Payload`))).toContain('Hola desde SAM');
  });
});
