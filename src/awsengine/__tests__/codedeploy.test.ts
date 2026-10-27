import { makeZip } from '../../engine/commands/archive';
import { mkEnv, type TestEnv } from './helpers';

const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const code = (v: string) => `def lambda_handler(event, context):\n    return '${v}'\n`;
const HOOK = `import boto3

def lambda_handler(event, context):
    cd = boto3.client('codedeploy')
    cd.put_lifecycle_event_hook_execution_status(deploymentId=event['DeploymentId'], lifecycleEventHookExecutionId=event['LifecycleEventHookExecutionId'], status='Succeeded')
`;
const spec = (fn = 'tienda', hooks = '') => `version: 0.0\nResources:\n  - miFuncion:\n      Type: AWS::Lambda::Function\n      Properties:\n        Name: ${fn}\n        Alias: live\n        CurrentVersion: "1"\n        TargetVersion: "2"\n${hooks}`;

async function setup(extra: (e: TestEnv) => Promise<void> = async () => undefined) {
  const e = mkEnv();
  e.write('t.json', trust('lambda.amazonaws.com'));
  await e.run('iam create-role --role-name fn-role --assume-role-policy-document file://t.json');
  await e.run('iam attach-role-policy --role-name fn-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
  const mk = async (name: string, src: string) => {
    e.write(`${name}.zip`, makeZip({ 'lambda_function.py': src }));
    await e.run(`lambda create-function --function-name ${name} --runtime python3.12 --role arn:aws:iam::123456789012:role/fn-role --handler lambda_function.lambda_handler --zip-file fileb://${name}.zip`);
  };
  await mk('tienda', code('v1'));
  await e.run('lambda publish-version --function-name tienda');
  e.write('v2.zip', makeZip({ 'lambda_function.py': code('v2') }));
  await e.run('lambda update-function-code --function-name tienda --zip-file fileb://v2.zip');
  await e.run('lambda publish-version --function-name tienda');
  await e.run('lambda create-alias --function-name tienda --name live --function-version 1');
  e.write('cd.json', trust('codedeploy.amazonaws.com'));
  await e.run('iam create-role --role-name cd-role --assume-role-policy-document file://cd.json');
  await e.run('iam put-role-policy --role-name cd-role --policy-name lambda --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:*","cloudwatch:DescribeAlarms"],"Resource":"*"}]}\'');
  await e.run('deploy create-application --application-name tienda --compute-platform Lambda');
  await extra(e);
  return e;
}
const group = (e: TestEnv, cfg: string, extra = '') => e.run(`deploy create-deployment-group --application-name tienda --deployment-group-name prod --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name ${cfg} ${extra}`);
const deploy = async (e: TestEnv, s = spec()) => {
  e.write('appspec.yml', s);
  const r = await e.run(`deploy create-deployment --application-name tienda --deployment-group-name prod --revision '{"revisionType":"AppSpecContent","appSpecContent":{"content":${JSON.stringify(s)}}}'`);
  return r;
};
const invokes = async (e: TestEnv, n = 100) => {
  const seen: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const r = await e.json(`lambda invoke --function-name tienda --qualifier live out.json --query ExecutedVersion`);
    seen[r] = (seen[r] ?? 0) + 1;
  }
  return seen;
};
const state = async (e: TestEnv, id: string) => (await e.json(`deploy get-deployment --deployment-id ${id} --query deploymentInfo.status`)) as string;

describe('CodeDeploy para Lambda', () => {
  test('canario: un 10 % del tráfico va a la versión nueva durante 5 minutos y luego todo', async () => {
    const e = await setup();
    expect((await group(e, 'CodeDeployDefault.LambdaNada')).stderr).toContain('DeploymentConfigDoesNotExist');
    e.write('mal.json', trust('ec2.amazonaws.com'));
    await e.run('iam create-role --role-name mal-cd --assume-role-policy-document file://mal.json');
    expect((await e.run('deploy create-deployment-group --application-name tienda --deployment-group-name x --service-role-arn arn:aws:iam::123456789012:role/mal-cd')).stderr).toContain('codedeploy.amazonaws.com');
    expect((await group(e, 'CodeDeployDefault.LambdaCanary10Percent5Minutes')).code).toBe(0);
    const id = JSON.parse((await deploy(e)).stdout).deploymentId as string;
    expect(id).toMatch(/^d-[A-Z0-9]{9}$/);
    e.acct.clock += 20000;
    expect(await state(e, id)).toBe('InProgress');
    const mid = await invokes(e);
    expect(mid['2']).toBeGreaterThan(5);
    expect(mid['2']).toBeLessThan(15);
    expect(mid['1']).toBeGreaterThan(85);
    expect(await e.json('lambda get-alias --function-name tienda --name live --query RoutingConfig.AdditionalVersionWeights')).toEqual({ '2': 0.1 });
    e.acct.clock += 6 * 60000;
    expect(await state(e, id)).toBe('Succeeded');
    expect(await invokes(e, 5)).toEqual({ '2': 5 });
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('2');
    expect((await e.run('deploy wait deployment-successful --deployment-id ' + id)).code).toBe(0);
  });

  test('lineal: sube un 10 % cada minuto', async () => {
    const e = await setup();
    await group(e, 'CodeDeployDefault.LambdaLinear10PercentEvery1Minute');
    const id = JSON.parse((await deploy(e)).stdout).deploymentId as string;
    e.acct.clock += 12000 + 2 * 60000;
    expect(await e.json('lambda get-alias --function-name tienda --name live --query \'RoutingConfig.AdditionalVersionWeights."2"\'')).toBeCloseTo(0.3, 5);
    expect((await e.run(`deploy wait deployment-successful --deployment-id ${id}`)).code).toBe(0);
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('2');
  });

  test('un gancho que valida y uno que falla; con retroceso automático el alias vuelve a la versión anterior', async () => {
    const e = await setup(async (x) => {
      x.write('hook.zip', makeZip({ 'lambda_function.py': HOOK }));
      await x.run('lambda create-function --function-name validar --runtime python3.12 --role arn:aws:iam::123456789012:role/fn-role --handler lambda_function.lambda_handler --zip-file fileb://hook.zip');
    });
    await group(e, 'CodeDeployDefault.LambdaAllAtOnce', '--auto-rollback-configuration enabled=true,events=DEPLOYMENT_FAILURE');
    // el gancho no tiene permiso para avisar a CodeDeploy: el despliegue falla antes de mover tráfico
    const hooks = '\nHooks:\n  - BeforeAllowTraffic: validar\n';
    const id = JSON.parse((await deploy(e, spec('tienda', hooks))).stdout).deploymentId as string;
    expect(await state(e, id)).toBe('Failed');
    const err = await e.json(`deploy get-deployment --deployment-id ${id} --query deploymentInfo.errorInformation`);
    expect(err.code).toBe('SCRIPT_FAILED');
    expect(err.message).toContain('validar');
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('1');
    // con el permiso, el despliegue termina
    await e.run('iam put-role-policy --role-name fn-role --policy-name cd --policy-document \'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"codedeploy:PutLifecycleEventHookExecutionStatus","Resource":"*"}]}\'');
    const id2 = JSON.parse((await deploy(e, spec('tienda', hooks))).stdout).deploymentId as string;
    e.acct.clock += 60000;
    expect(await state(e, id2)).toBe('Succeeded');
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('2');
  });

  test('una alarma activa detiene el despliegue y, con retroceso automático, devuelve el tráfico', async () => {
    const e = await setup();
    await e.run('cloudwatch put-metric-alarm --alarm-name errores --namespace AWS/Lambda --metric-name Errors --statistic Sum --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold');
    await group(e, 'CodeDeployDefault.LambdaCanary10Percent10Minutes', '--alarm-configuration enabled=true,alarms=[{name=errores}] --auto-rollback-configuration enabled=true,events=DEPLOYMENT_STOP_ON_ALARM');
    const id = JSON.parse((await deploy(e)).stdout).deploymentId as string;
    e.acct.clock += 20000;
    expect(await state(e, id)).toBe('InProgress');
    await e.run('cloudwatch set-alarm-state --alarm-name errores --state-value ALARM --state-reason prueba');
    e.acct.clock += 60000;
    expect(await state(e, id)).toBe('Failed');
    expect(await e.json(`deploy get-deployment --deployment-id ${id} --query deploymentInfo.errorInformation.code`)).toBe('ALARM_ACTIVE');
    expect(await e.json('lambda get-alias --function-name tienda --name live --query "[FunctionVersion,RoutingConfig.AdditionalVersionWeights]"')).toEqual(['1', {}]);
    expect(await invokes(e, 5)).toEqual({ '1': 5 });
  });

  test('validaciones: versión actual distinta, permisos del rol y otro despliegue en curso', async () => {
    const e = await setup();
    await group(e, 'CodeDeployDefault.LambdaCanary10Percent5Minutes');
    const bad = JSON.parse((await deploy(e, spec().replace('"1"', '"3"'))).stdout).deploymentId as string;
    expect(await state(e, bad)).toBe('Failed');
    expect(await e.json(`deploy get-deployment --deployment-id ${bad} --query deploymentInfo.errorInformation.message`)).toContain('points to version 1');
    const ok = JSON.parse((await deploy(e)).stdout).deploymentId as string;
    e.acct.clock += 20000;
    expect((await deploy(e)).stderr).toContain('DeploymentLimitExceededException');
    // otro grupo sobre la misma función: el alias ya está repartiendo tráfico
    await e.run('deploy create-deployment-group --application-name tienda --deployment-group-name prod2 --service-role-arn arn:aws:iam::123456789012:role/cd-role --deployment-config-name CodeDeployDefault.LambdaCanary10Percent5Minutes');
    const other = JSON.parse((await e.run(`deploy create-deployment --application-name tienda --deployment-group-name prod2 --revision '{"revisionType":"AppSpecContent","appSpecContent":{"content":${JSON.stringify(spec())}}}'`)).stdout).deploymentId as string;
    expect(await e.json(`deploy get-deployment --deployment-id ${other} --query deploymentInfo.errorInformation.message`)).toContain('another deployment is in progress');
    await e.run(`deploy stop-deployment --deployment-id ${ok} --auto-rollback-enabled`);
    expect(await state(e, ok)).toBe('Stopped');
    expect(await e.json('lambda get-alias --function-name tienda --name live --query FunctionVersion')).toBe('1');
    // sin permisos de Lambda en el rol
    await e.run('iam delete-role-policy --role-name cd-role --policy-name lambda');
    const noPerm = JSON.parse((await deploy(e)).stdout).deploymentId as string;
    expect(await e.json(`deploy get-deployment --deployment-id ${noPerm} --query deploymentInfo.errorInformation.code`)).toBe('IAM_ROLE_PERMISSIONS');
  });
});
