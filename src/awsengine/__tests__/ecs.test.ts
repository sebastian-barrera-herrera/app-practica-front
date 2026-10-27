import { Terminal } from '../../engine/terminal';

const APP = `import os
from flask import Flask, jsonify

app = Flask(__name__)
VERSION = os.environ.get('VERSION', '1')


@app.route('/')
def home():
    return 'Hola desde la versión ' + VERSION


@app.route('/health')
def health():
    return jsonify(status='ok')


if __name__ == '__main__':
    print('Arrancando la versión', VERSION)
    app.run(host='0.0.0.0', port=5000)
`;
const DOCKERFILE = `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "app.py"]
`;
const REPO = '123456789012.dkr.ecr.us-east-1.amazonaws.com/tienda';
const login = 'aws ecr get-login-password | docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com';

const td = (over: Record<string, unknown> = {}, cont: Record<string, unknown> = {}) =>
  JSON.stringify({
    family: 'tienda',
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: '256',
    memory: '512',
    executionRoleArn: 'arn:aws:iam::123456789012:role/ecsTaskExecutionRole',
    containerDefinitions: [
      {
        name: 'web',
        image: `${REPO}:1.0`,
        essential: true,
        portMappings: [{ containerPort: 5000 }],
        environment: [{ name: 'VERSION', value: '1' }],
        logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/tienda', 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'web' } },
        ...cont,
      },
    ],
    ...over,
  });

async function setup(files: Record<string, string> = {}) {
  const t = new Terminal({
    instant: true,
    aws: 'base',
    cols: 140,
    files: { '/home/alumno/app/Dockerfile': DOCKERFILE, '/home/alumno/app/app.py': APP, '/home/alumno/app/requirements.txt': 'flask==3.0.3\n', ...files },
  });
  await t.exec('docker build -t tienda:1.0 app');
  await t.exec('aws ecr create-repository --repository-name tienda');
  await t.exec(login);
  await t.exec(`docker tag tienda:1.0 ${REPO}:1.0`);
  await t.exec(`docker push ${REPO}:1.0`);
  await t.exec(`echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' > trust.json`);
  await t.exec('aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document file://trust.json');
  await t.exec('aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy');
  await t.exec('aws logs create-log-group --log-group-name /ecs/tienda');
  await t.exec('aws ecs create-cluster --cluster-name demo');
  await t.exec(`echo '${td()}' > td.json`);
  await t.exec('aws ecs register-task-definition --cli-input-json file://td.json');
  await t.exec('SUBNET=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[0].SubnetId" --output text)');
  await t.exec('VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query "Vpcs[0].VpcId" --output text)');
  await t.exec('SG=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values=$VPC Name=group-name,Values=default --query "SecurityGroups[0].GroupId" --output text)');
  return t;
}
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();
const NET = '--network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=ENABLED}"';

describe('ECS: definiciones de tarea', () => {
  test('validaciones al registrar', async () => {
    const t = await setup();
    const bad = async (cfg: string) => (await t.exec(`echo '${cfg}' > x.json && aws ecs register-task-definition --cli-input-json file://x.json`)).err;
    expect(await bad(td({ cpu: '256', memory: '4096' }))).toContain('No Fargate configuration exists for given values');
    expect(await bad(td({ networkMode: 'bridge' }))).toContain("Fargate only supports network mode 'awsvpc'");
    expect(await bad(td({ executionRoleArn: undefined }))).toContain('execution role ARN');
    expect(await bad(td({}, { image: '' }))).toContain('Container.image should not be null or empty');
    expect(await bad(td({}, { logConfiguration: { logDriver: 'awslogs', options: {} } }))).toContain('Log driver awslogs requires options');
    expect(await bad(td({ family: 'mala familia' }))).toContain('Family should satisfy');
    const ok = JSON.parse((await t.exec('aws ecs register-task-definition --cli-input-json file://td.json')).out);
    expect(ok.taskDefinition.revision).toBe(2);
    expect(await out(t, 'aws ecs list-task-definitions --family-prefix tienda --query "length(taskDefinitionArns)"')).toBe('2');
    expect((await t.exec('aws ecs describe-task-definition --task-definition tienda:1 --query taskDefinition.cpu --output text')).out.trim()).toBe('256');
  });
});

describe('ECS: tareas sueltas', () => {
  test('ciclo de vida: PROVISIONING → PENDING → RUNNING y registros en CloudWatch', async () => {
    const t = await setup();
    const r = JSON.parse((await t.exec(`aws ecs run-task --cluster demo --task-definition tienda:1 --launch-type FARGATE ${NET}`)).out);
    expect(r.failures).toEqual([]);
    const arn = r.tasks[0].taskArn;
    expect(r.tasks[0].lastStatus).toBe('PROVISIONING');
    const status = async () => await out(t, `aws ecs describe-tasks --cluster demo --tasks ${arn} --query "tasks[0].lastStatus" --output text`);
    await t.exec('sleep 5');
    expect(await status()).toBe('PENDING');
    await t.exec('sleep 60');
    expect(await status()).toBe('RUNNING');
    expect(await out(t, `aws ecs describe-tasks --cluster demo --tasks ${arn} --query "tasks[0].attachments[0].details[?name=='privateIPv4Address'].value | [0]" --output text`)).toMatch(/^172\.31\./);
    const logs = await out(t, 'aws logs filter-log-events --log-group-name /ecs/tienda --query "events[].message" --output text');
    expect(logs).toContain('Arrancando la versión 1');
    expect(logs).toContain('Running on all addresses');
    expect(await out(t, 'aws ecs list-tasks --cluster demo --query "length(taskArns)"')).toBe('1');
    await t.exec(`aws ecs stop-task --cluster demo --task ${arn} --reason "prueba"`);
    await t.exec('sleep 60');
    expect(await status()).toBe('STOPPED');
    expect(await out(t, `aws ecs describe-tasks --cluster demo --tasks ${arn} --query "tasks[0].[stopCode,stoppedReason]" --output text`)).toBe('UserInitiated\tprueba');
    expect(await out(t, 'aws ecs list-tasks --cluster demo --desired-status STOPPED --query "length(taskArns)"')).toBe('1');
  });

  test('errores clásicos al arrancar: etiqueta que no existe, rol sin permisos, grupo de logs inexistente y sin salida a ECR', async () => {
    const t = await setup();
    const why = async (arn: string) => await out(t, `aws ecs describe-tasks --cluster demo --tasks ${arn} --query "tasks[0].[lastStatus,stopCode,stoppedReason]" --output text`);
    const run = async (family: string) => JSON.parse((await t.exec(`aws ecs run-task --cluster demo --task-definition ${family} --launch-type FARGATE ${NET}`)).out).tasks[0].taskArn as string;
    // etiqueta inexistente
    await t.exec(`echo '${td({ family: 'badtag' }, { image: `${REPO}:9.9` })}' > x.json && aws ecs register-task-definition --cli-input-json file://x.json`);
    let arn = await run('badtag');
    await t.exec('sleep 60');
    let r = await why(arn);
    expect(r).toContain('STOPPED\tTaskFailedToStart');
    expect(r).toContain('CannotPullContainerError');
    expect(r).toContain('9.9: not found');
    // grupo de logs inexistente
    await t.exec(`echo '${td({ family: 'nolog' }, { logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/otro', 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'web' } } })}' > x.json && aws ecs register-task-definition --cli-input-json file://x.json`);
    arn = await run('nolog');
    await t.exec('sleep 60');
    expect(await why(arn)).toContain('The specified log group does not exist');
    // rol de ejecución sin permisos
    await t.exec('aws iam detach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy');
    arn = await run('tienda:1');
    await t.exec('sleep 60');
    r = await why(arn);
    expect(r).toContain('ResourceInitializationError');
    expect(r).toContain('ecr:GetAuthorizationToken');
    // sin IP pública y sin NAT ni endpoints: no llega a ECR
    await t.exec('aws iam attach-role-policy --role-name ecsTaskExecutionRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy');
    const priv = JSON.parse((await t.exec(`aws ecs run-task --cluster demo --task-definition tienda:1 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SG],assignPublicIp=DISABLED}"`)).out).tasks[0].taskArn as string;
    await t.exec('sleep 200');
    r = await why(priv);
    expect(r).toContain('unable to pull secrets or registry auth');
    expect(r).toContain('i/o timeout');
  });

  test('validaciones de run-task', async () => {
    const t = await setup();
    expect((await t.exec('aws ecs run-task --cluster nada --task-definition tienda:1 --launch-type FARGATE')).err).toContain('ClusterNotFoundException');
    expect((await t.exec('aws ecs run-task --cluster demo --task-definition tienda:1 --launch-type FARGATE')).err).toContain("Network Configuration must be provided when networkMode 'awsvpc'");
    const r = JSON.parse((await t.exec(`aws ecs run-task --cluster demo --task-definition tienda:1 ${NET}`)).out);
    expect(r.failures[0].reason).toContain('No Container Instances were found in your cluster');
    expect((await t.exec(`aws ecs run-task --cluster demo --task-definition tienda:1 --launch-type FARGATE --count 11 ${NET}`)).err).toContain('Count must be between 1 and 10');
  });

  test('si el contenedor falla, la tarea se detiene con su código de salida y el traceback va a los registros', async () => {
    const t = await setup({ '/home/alumno/app2/app.py': 'import os\nraise RuntimeError("falta la configuración " + os.environ["DB_HOST"])\n', '/home/alumno/app2/Dockerfile': 'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python", "app.py"]\n' });
    await t.exec('docker build -t tienda:2.0 app2');
    await t.exec(`docker tag tienda:2.0 ${REPO}:2.0`);
    await t.exec(`docker push ${REPO}:2.0`);
    await t.exec(`echo '${td({ family: 'crash' }, { image: `${REPO}:2.0` })}' > x.json && aws ecs register-task-definition --cli-input-json file://x.json`);
    const arn = JSON.parse((await t.exec(`aws ecs run-task --cluster demo --task-definition crash --launch-type FARGATE ${NET}`)).out).tasks[0].taskArn as string;
    await t.exec('sleep 90');
    const d = JSON.parse((await t.exec(`aws ecs describe-tasks --cluster demo --tasks ${arn}`)).out).tasks[0];
    expect(d.lastStatus).toBe('STOPPED');
    expect(d.stopCode).toBe('EssentialContainerExited');
    expect(d.stoppedReason).toBe('Essential container in task exited');
    expect(d.containers[0].exitCode).toBe(1);
    const logs = await out(t, 'aws logs filter-log-events --log-group-name /ecs/tienda --query "events[].message" --output text');
    expect(logs).toContain('KeyError');
  });
});

async function withAlb(t: Terminal, extra = '') {
  await t.exec('S1=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[0].SubnetId" --output text)');
  await t.exec('S2=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query "Subnets[1].SubnetId" --output text)');
  await t.exec('ASG=$(aws ec2 create-security-group --group-name alb-sg --description alb --vpc-id $VPC --query GroupId --output text)');
  await t.exec('aws ec2 authorize-security-group-ingress --group-id $ASG --protocol tcp --port 80 --cidr 0.0.0.0/0');
  await t.exec('TSG=$(aws ec2 create-security-group --group-name task-sg --description tareas --vpc-id $VPC --query GroupId --output text)');
  await t.exec('aws ec2 authorize-security-group-ingress --group-id $TSG --protocol tcp --port 5000 --source-group $ASG');
  await t.exec('LB=$(aws elbv2 create-load-balancer --name web --subnets $S1 $S2 --security-groups $ASG --query "LoadBalancers[0].LoadBalancerArn" --output text)');
  await t.exec('DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns $LB --query "LoadBalancers[0].DNSName" --output text)');
  await t.exec(`TG=$(aws elbv2 create-target-group --name web-tg --protocol HTTP --port 5000 --target-type ip --vpc-id $VPC --health-check-path /health --health-check-interval-seconds 10 --healthy-threshold-count 2 --unhealthy-threshold-count 2 --query "TargetGroups[0].TargetGroupArn" --output text)`);
  await t.exec('aws elbv2 create-listener --load-balancer-arn $LB --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=$TG');
  await t.exec('sleep 200');
  const cb = extra;
  const cs = await t.exec(`aws ecs create-service --cluster demo --service-name web --task-definition tienda:1 --desired-count 2 --launch-type FARGATE --network-configuration "awsvpcConfiguration={subnets=[$S1,$S2],securityGroups=[$TSG],assignPublicIp=ENABLED}" --load-balancers targetGroupArn=$TG,containerName=web,containerPort=5000 --health-check-grace-period-seconds 30 ${cb}`);
  if (cs.status !== 0) throw new Error('create-service: ' + cs.err);
}

describe('ECS: servicios con balanceador', () => {
  test('el servicio llega a un estado estable, el balanceador reparte y las tareas se registran', async () => {
    const t = await setup();
    await withAlb(t);
    const w = await t.exec('aws ecs wait services-stable --cluster demo --services web');
    expect(w.status).toBe(0);
    await t.exec('sleep 60');
    const s = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    expect(s.runningCount).toBe(2);
    expect(s.deployments).toHaveLength(1);
    expect(s.deployments[0].rolloutState).toBe('COMPLETED');
    const msgs = s.events.map((e: any) => e.message).join('\n');
    expect(msgs).toContain('has started 2 tasks');
    expect(msgs).toContain('registered 1 targets in (target-group');
    expect(msgs).toContain('has reached a steady state');
    const h = JSON.parse((await t.exec('aws elbv2 describe-target-health --target-group-arn $TG')).out).TargetHealthDescriptions;
    expect(h).toHaveLength(2);
    expect(h.every((x: any) => x.TargetHealth.State === 'healthy')).toBe(true);
    expect((await t.exec('curl -s http://$DNS/')).out).toBe('Hola desde la versión 1');
    expect((await t.exec('curl -s http://$DNS/health')).out).toContain('"status":"ok"');
    // dos tareas en zonas distintas
    expect(await out(t, 'aws ecs list-tasks --cluster demo --service-name web --query "length(taskArns)"')).toBe('2');
    // los accesos del balanceador están en los registros del contenedor
    const logs = await out(t, 'aws logs filter-log-events --log-group-name /ecs/tienda --filter-pattern "GET" --query "length(events)"');
    expect(Number(logs)).toBeGreaterThan(1);
  });

  test('despliegue por tandas: la versión nueva sustituye a la vieja sin cortar el servicio', async () => {
    const t = await setup();
    await withAlb(t);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec(`echo '${td({}, { environment: [{ name: 'VERSION', value: '2' }] })}' > td2.json`);
    expect((await t.exec('aws ecs register-task-definition --cli-input-json file://td2.json')).status).toBe(0);
    await t.exec('aws ecs update-service --cluster demo --service web --task-definition tienda:2');
    const mid = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    expect(mid.deployments.map((d: any) => d.status).sort()).toEqual(['ACTIVE', 'PRIMARY']);
    await t.exec('sleep 60');
    // en mitad del despliegue el servicio sigue respondiendo
    expect((await t.exec('curl -s http://$DNS/')).out).toMatch(/Hola desde la versión [12]/);
    const w = await t.exec('aws ecs wait services-stable --cluster demo --services web');
    expect(w.status).toBe(0);
    const s = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    expect(s.deployments).toHaveLength(1);
    expect(s.taskDefinition).toContain('tienda:2');
    expect(s.runningCount).toBe(2);
    for (let i = 0; i < 4; i++) expect((await t.exec('curl -s http://$DNS/')).out).toBe('Hola desde la versión 2');
  });

  test('una ruta de salud equivocada: el balanceador marca las tareas como no sanas y ECS las sustituye sin parar', async () => {
    const t = await setup();
    await withAlb(t);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec('aws elbv2 modify-target-group --target-group-arn $TG --health-check-path /salud');
    await t.exec('sleep 120');
    const s = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    const msgs = s.events.map((e: any) => e.message).join('\n');
    expect(msgs).toContain('is unhealthy in (target-group');
    expect(msgs).toContain('Health checks failed with these codes: [404]');
    const stopped = JSON.parse((await t.exec('aws ecs describe-tasks --cluster demo --tasks $(aws ecs list-tasks --cluster demo --desired-status STOPPED --query "taskArns" --output text | cut -f1)')).out).tasks[0];
    expect(stopped.stoppedReason).toContain('Task failed ELB health checks in (target-group');
    expect(s.deployments[0].failedTasks).toBeGreaterThan(0);
  });

  test('interruptor automático: una imagen que no existe hace fallar el despliegue y vuelve a la versión buena', async () => {
    const t = await setup();
    await withAlb(t, '--deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100"');
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec('sleep 60');
    await t.exec(`echo '${td({}, { image: `${REPO}:9.9` })}' > td3.json`);
    await t.exec('aws ecs register-task-definition --cli-input-json file://td3.json');
    await t.exec('aws ecs update-service --cluster demo --service web --task-definition tienda:2');
    await t.exec('sleep 400');
    const s = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    const msgs = s.events.map((e: any) => e.message).join('\n');
    expect(msgs).toContain('deployment failed: tasks failed to start');
    expect(msgs).toContain('rolling back to deployment');
    await t.exec('sleep 200');
    const done = JSON.parse((await t.exec('aws ecs describe-services --cluster demo --services web')).out).services[0];
    expect(done.deployments).toHaveLength(1);
    expect(done.deployments[0].rolloutState).toBe('COMPLETED');
    expect(done.deployments[0].taskDefinition).toContain('tienda:1');
    expect(done.runningCount).toBe(2);
    expect((await t.exec('curl -s http://$DNS/')).out).toBe('Hola desde la versión 1');
  });

  test('escalar a 4 tareas, bajar a 0 y borrar el servicio', async () => {
    const t = await setup();
    await withAlb(t);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec('aws ecs update-service --cluster demo --service web --desired-count 4');
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services web --query "services[0].runningCount"')).toBe('4');
    expect((await t.exec('aws ecs delete-service --cluster demo --service web')).err).toContain('scaled above 0');
    await t.exec('aws ecs delete-service --cluster demo --service web --force');
    await t.exec('aws ecs wait services-inactive --cluster demo --services web');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services web --query "services[0].status" --output text')).toBe('INACTIVE');
    expect((await t.exec('aws ecs delete-cluster --cluster demo')).status).toBe(0);
  });
});

describe('Application Auto Scaling para ECS', () => {
  const REG = 'aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/web';
  const RID = '--service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/web';
  const CPU = (v: number, extra = '') => `{"TargetValue":${v},"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"},"ScaleOutCooldown":60,"ScaleInCooldown":60${extra}}`;

  test('validaciones: registrar primero, límites coherentes, servicio existente y métricas conocidas', async () => {
    const t = await setup();
    await withAlb(t);
    const pol = (cfg: string) => `aws application-autoscaling put-scaling-policy --policy-name cpu ${RID} --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration '${cfg}'`;
    expect((await t.exec(pol(CPU(50)))).err).toContain('ObjectNotFoundException');
    expect((await t.exec(`${REG} --min-capacity 5 --max-capacity 2`)).err).toContain('MinCapacity cannot be greater than MaxCapacity');
    expect((await t.exec(`${REG} --min-capacity 1`)).err).toContain('MinCapacity and MaxCapacity are required');
    expect((await t.exec(`aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/nada --min-capacity 1 --max-capacity 3`)).err).toContain("ECS service doesn't exist");
    expect((await t.exec(`aws application-autoscaling register-scalable-target --service-namespace ecs --scalable-dimension ecs:service:cpu --resource-id service/demo/web --min-capacity 1 --max-capacity 3`)).err).toContain('Unsupported service namespace, resource type or scalable dimension');
    expect((await t.exec(`aws application-autoscaling register-scalable-target --service-namespace ecz --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/web --min-capacity 1 --max-capacity 3`)).err).toContain('Member must satisfy enum value set');
    const ok = JSON.parse((await t.exec(`${REG} --min-capacity 2 --max-capacity 6`)).out);
    expect(ok.ScalableTargetARN).toContain('arn:aws:application-autoscaling:us-east-1:123456789012:scalable-target/');
    expect(await out(t, 'aws application-autoscaling describe-scalable-targets --service-namespace ecs --query "ScalableTargets[0].[MinCapacity,MaxCapacity,ResourceId]" --output text')).toBe('2\t6\tservice/demo/web');
    expect((await t.exec(pol('{"TargetValue":50}'))).err).toContain('PredefinedMetricSpecification is required');
    expect((await t.exec(pol('{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"}}'))).err).toContain('Unsupported predefined metric type');
    expect((await t.exec(pol('{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ALBRequestCountPerTarget"}}'))).err).toContain('ResourceLabel is required');
    const p = JSON.parse((await t.exec(pol(CPU(50)))).out);
    expect(p.PolicyARN).toContain(':resource/ecs/service/demo/web:policyName/cpu');
    expect(p.Alarms.map((x: any) => x.AlarmName.replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}$/, ''))).toEqual(['TargetTracking-service/demo/web-AlarmHigh', 'TargetTracking-service/demo/web-AlarmLow']);
    expect(await out(t, 'aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking --query "length(MetricAlarms)"')).toBe('2');
    await t.exec(`aws application-autoscaling delete-scaling-policy --policy-name cpu ${RID}`);
    expect(await out(t, 'aws cloudwatch describe-alarms --alarm-name-prefix TargetTracking --query "length(MetricAlarms)"')).toBe('0');
  });

  test('seguimiento de objetivo por CPU: la carga sube las tareas y, al acabar, vuelven al mínimo', async () => {
    const t = await setup();
    await withAlb(t);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec(`${REG} --min-capacity 2 --max-capacity 8`);
    await t.exec(`aws application-autoscaling put-scaling-policy --policy-name cpu50 ${RID} --policy-type TargetTrackingScaling --target-tracking-scaling-policy-configuration '${CPU(50)}'`);
    await t.exec('sleep 120');
    const count = async () => Number(await out(t, 'aws ecs describe-services --cluster demo --services web --query "services[0].desiredCount"'));
    expect(await count()).toBe(2);
    const ab = await out(t, 'ab -n 2000000 -c 2 -t 600 http://$DNS/');
    expect(ab).toContain('Requests per second');
    await t.exec('sleep 420');
    const n = await count();
    expect(n).toBeGreaterThan(2);
    expect(n).toBeLessThanOrEqual(8);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    expect(Number(await out(t, 'aws ecs describe-services --cluster demo --services web --query "services[0].runningCount"'))).toBe(n);
    const act = JSON.parse((await t.exec(`aws application-autoscaling describe-scaling-activities --service-namespace ecs --resource-id service/demo/web`)).out).ScalingActivities;
    expect(act[act.length - 1].Description).toMatch(/^Setting desired count to \d+\.$/);
    expect(act[act.length - 1].Cause).toContain('monitor alarm TargetTracking-service/demo/web-AlarmHigh');
    expect(act[act.length - 1].Cause).toContain('triggered policy cpu50');
    expect(act[0].StatusCode).toBe('Successful');
    // las métricas de ECS reflejan la carga
    const cpu = JSON.parse((await t.exec(`aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name CPUUtilization --dimensions Name=ClusterName,Value=demo Name=ServiceName,Value=web --start-time 2026-03-14T10:00:00Z --end-time 2026-03-14T23:00:00Z --period 300 --statistics Maximum`)).out);
    expect(cpu.Datapoints.length).toBeGreaterThan(1);
    // 15 minutos sin carga (más allá del enfriamiento): vuelve al mínimo
    await t.exec('sleep 1800');
    expect(await count()).toBe(2);
  });

  test('acción programada: sube el mínimo a una hora fija y el servicio sigue', async () => {
    const t = await setup();
    await withAlb(t);
    await t.exec('aws ecs wait services-stable --cluster demo --services web');
    await t.exec(`${REG} --min-capacity 1 --max-capacity 6`);
    const bad = await t.exec(`aws application-autoscaling put-scheduled-action --service-namespace ecs --scheduled-action-name pico --resource-id service/demo/web --scalable-dimension ecs:service:DesiredCount --schedule "cada hora" --scalable-target-action MinCapacity=4,MaxCapacity=6`);
    expect(bad.err).toContain('Schedule is invalid');
    await t.exec(`aws application-autoscaling put-scheduled-action --service-namespace ecs --scheduled-action-name pico --resource-id service/demo/web --scalable-dimension ecs:service:DesiredCount --schedule "rate(5 minutes)" --scalable-target-action MinCapacity=4,MaxCapacity=6`);
    expect(await out(t, 'aws application-autoscaling describe-scheduled-actions --service-namespace ecs --query "ScheduledActions[0].ScalableTargetAction.MinCapacity"')).toBe('4');
    await t.exec('sleep 420');
    expect(await out(t, 'aws ecs describe-services --cluster demo --services web --query "services[0].desiredCount"')).toBe('4');
    expect(await out(t, 'aws application-autoscaling describe-scalable-targets --service-namespace ecs --query "ScalableTargets[0].MinCapacity"')).toBe('4');
    const a = await out(t, 'aws application-autoscaling describe-scaling-activities --service-namespace ecs --query "ScalingActivities[].Cause" --output text');
    expect(a).toContain('scheduled action pico');
    await t.exec('aws application-autoscaling deregister-scalable-target --service-namespace ecs --scalable-dimension ecs:service:DesiredCount --resource-id service/demo/web');
    expect(await out(t, 'aws application-autoscaling describe-scalable-targets --service-namespace ecs --query "length(ScalableTargets)"')).toBe('0');
  });
});
