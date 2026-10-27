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
const REG = '123456789012.dkr.ecr.us-east-1.amazonaws.com';
const REPO = `${REG}/tienda`;

async function setup() {
  const t = new Terminal({ instant: true, aws: 'base', cols: 140, files: { '/home/alumno/app/Dockerfile': DOCKERFILE, '/home/alumno/app/app.py': APP, '/home/alumno/app/requirements.txt': 'flask==3.0.3\n' } });
  await t.exec('docker build -t tienda:1.0 app');
  await t.exec('aws ecr create-repository --repository-name tienda');
  await t.exec(`aws ecr get-login-password | docker login --username AWS --password-stdin ${REG}`);
  await t.exec(`docker tag tienda:1.0 ${REPO}:1.0`);
  await t.exec(`docker push ${REPO}:1.0`);
  const trust = (svc: string) => `echo '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"${svc}"},"Action":"sts:AssumeRole"}]}' > t.json`;
  await t.exec(trust('build.apprunner.amazonaws.com'));
  await t.exec('aws iam create-role --role-name ar-ecr-access --assume-role-policy-document file://t.json');
  await t.exec('aws iam attach-role-policy --role-name ar-ecr-access --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess');
  await t.exec(trust('ecs-tasks.amazonaws.com'));
  await t.exec('aws iam create-role --role-name mal-rol --assume-role-policy-document file://t.json');
  return t;
}
const out = async (t: Terminal, cmd: string) => (await t.exec(cmd)).out.trim();
const ROLE = 'arn:aws:iam::123456789012:role/ar-ecr-access';
const src = (over: Record<string, unknown> = {}, port = '5000', env: Record<string, string> = {}) => JSON.stringify({ ImageRepository: { ImageIdentifier: `${REPO}:1.0`, ImageRepositoryType: 'ECR', ImageConfiguration: { Port: port, ...(Object.keys(env).length ? { RuntimeEnvironmentVariables: env } : {}) } }, AuthenticationConfiguration: { AccessRoleArn: ROLE }, AutoDeploymentsEnabled: false, ...over });
const create = (name: string, s: string, extra = '') => `aws apprunner create-service --service-name ${name} --source-configuration '${s}' ${extra}`;

describe('App Runner', () => {
  test('validaciones al crear', async () => {
    const t = await setup();
    expect((await t.exec(create('x', src()))).err).toContain('serviceName');
    expect((await t.exec(create('tienda', src({ AuthenticationConfiguration: undefined })))).err).toContain('access role is required');
    expect((await t.exec(create('tienda', src({ AuthenticationConfiguration: { AccessRoleArn: 'arn:aws:iam::123456789012:role/mal-rol' } })))).err).toContain('Error in assuming access role');
    expect((await t.exec(create('tienda', src(), '--instance-configuration Cpu=1024,Memory=512'))).err).toContain('Invalid combination of Cpu (1024) and Memory (512)');
    expect((await t.exec(create('tienda', src({ ImageRepository: { ImageIdentifier: 'tienda:1.0', ImageRepositoryType: 'ECR' } })))).err).toContain('not a valid private ECR image URI');
    const ok = JSON.parse((await t.exec(create('tienda', src(), '--instance-configuration Cpu=1,Memory=2'.replace('Cpu=1,Memory=2', 'Cpu=1024,Memory=2048')))).out);
    expect(ok.Service.Status).toBe('OPERATION_IN_PROGRESS');
    expect(ok.Service.ServiceUrl).toMatch(/^[a-z0-9]{10}\.us-east-1\.awsapprunner\.com$/);
    expect(ok.OperationId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await t.exec(create('tienda', src()))).err).toContain('already exists');
  });

  test('se crea, sirve por HTTPS, registra en CloudWatch y se despliega una versión nueva sin cortes', async () => {
    const t = await setup();
    const c = JSON.parse((await t.exec(create('tienda', src({}, '5000', { VERSION: '1' })))).out);
    const arn = c.Service.ServiceArn;
    const url = c.Service.ServiceUrl;
    const status = async () => await out(t, `aws apprunner describe-service --service-arn ${arn} --query Service.Status --output text`);
    expect(await status()).toBe('OPERATION_IN_PROGRESS');
    expect((await t.exec(`curl -s https://${url}/`)).status).not.toBe(0);
    await t.exec('sleep 60');
    expect(await status()).toBe('OPERATION_IN_PROGRESS');
    await t.exec('sleep 150');
    expect(await status()).toBe('RUNNING');
    expect(await out(t, `curl -s https://${url}/`)).toBe('Hola desde la versión 1');
    expect((await t.exec(`curl -s http://${url}/`)).status).not.toBe(0);
    expect(await out(t, `aws apprunner list-operations --service-arn ${arn} --query "OperationSummaryList[0].[Type,Status]" --output text`)).toBe('CREATE_SERVICE\tSUCCEEDED');
    const events = await out(t, `aws logs filter-log-events --log-group-name /aws/apprunner/tienda/${c.Service.ServiceId}/service --query "events[].message" --output text`);
    expect(events).toContain('Successfully pulled your application image from ECR');
    expect(events).toContain("Health check succeeded on port '5000'");
    expect(events).toContain('Service status is set to RUNNING');
    const app = await out(t, `aws logs filter-log-events --log-group-name /aws/apprunner/tienda/${c.Service.ServiceId}/application --query "events[].message" --output text`);
    expect(app).toContain('Arrancando la versión 1');
    // nueva versión: mientras despliega, la anterior sigue respondiendo
    const up = await t.exec(`aws apprunner update-service --service-arn ${arn} --source-configuration '${src({}, '5000', { VERSION: '2' })}'`);
    expect(JSON.parse(up.out).Service.Status).toBe('OPERATION_IN_PROGRESS');
    expect((await t.exec(`aws apprunner update-service --service-arn ${arn} --health-check-configuration Protocol=HTTP,Path=/health`)).err).toContain('cannot be updated in the current state');
    await t.exec('sleep 30');
    expect(await out(t, `curl -s https://${url}/`)).toBe('Hola desde la versión 1');
    await t.exec('sleep 150');
    expect(await status()).toBe('RUNNING');
    expect(await out(t, `curl -s https://${url}/`)).toBe('Hola desde la versión 2');
    // pausa, reanuda y borra
    await t.exec(`aws apprunner pause-service --service-arn ${arn}`);
    await t.exec('sleep 30');
    expect(await status()).toBe('PAUSED');
    expect(await out(t, `curl -s -o /dev/null -w '%{http_code}' https://${url}/`)).toBe('503');
    await t.exec(`aws apprunner resume-service --service-arn ${arn}`);
    await t.exec('sleep 60');
    expect(await status()).toBe('RUNNING');
    await t.exec(`aws apprunner delete-service --service-arn ${arn}`);
    await t.exec('sleep 90');
    expect(await out(t, 'aws apprunner list-services --query "length(ServiceSummaryList)"')).toBe('0');
  });

  test('el puerto por defecto (8080) no es el de Flask (5000): la creación falla con la pista en los registros', async () => {
    const t = await setup();
    const c = JSON.parse((await t.exec(create('tienda', src({}, '8080')))).out);
    await t.exec('sleep 240');
    expect(await out(t, `aws apprunner describe-service --service-arn ${c.Service.ServiceArn} --query Service.Status --output text`)).toBe('CREATE_FAILED');
    expect(await out(t, `aws apprunner list-operations --service-arn ${c.Service.ServiceArn} --query "OperationSummaryList[0].Status" --output text`)).toBe('FAILED');
    const events = await out(t, `aws logs filter-log-events --log-group-name /aws/apprunner/tienda/${c.Service.ServiceId}/service --query "events[].message" --output text`);
    expect(events).toContain("Health check failed on port '8080'. Check your configured port number.");
    expect(events).toContain('Service creation failed. Failure reason: Health check failed.');
  });

  test('imagen que no existe o rol sin permiso de ECR: no se puede descargar', async () => {
    const t = await setup();
    const c = JSON.parse((await t.exec(create('tienda', src({ ImageRepository: { ImageIdentifier: `${REPO}:9.9`, ImageRepositoryType: 'ECR', ImageConfiguration: { Port: '5000' } } })))).out);
    await t.exec('sleep 120');
    expect(await out(t, `aws apprunner describe-service --service-arn ${c.Service.ServiceArn} --query Service.Status --output text`)).toBe('CREATE_FAILED');
    expect(await out(t, `aws logs filter-log-events --log-group-name /aws/apprunner/tienda/${c.Service.ServiceId}/service --query "events[].message" --output text`)).toContain('Failed to pull your application image');
    await t.exec('aws iam detach-role-policy --role-name ar-ecr-access --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess');
    const d = JSON.parse((await t.exec(create('otra', src()))).out);
    await t.exec('sleep 120');
    expect(await out(t, `aws apprunner describe-service --service-arn ${d.Service.ServiceArn} --query Service.Status --output text`)).toBe('CREATE_FAILED');
  });

  test('configuraciones de escalado con revisiones', async () => {
    const t = await setup();
    const a1 = JSON.parse((await t.exec('aws apprunner create-auto-scaling-configuration --auto-scaling-configuration-name pocos --max-concurrency 50 --min-size 2 --max-size 5')).out).AutoScalingConfiguration;
    expect(a1).toMatchObject({ AutoScalingConfigurationRevision: 1, MaxConcurrency: 50, MinSize: 2, MaxSize: 5, Latest: true });
    const a2 = JSON.parse((await t.exec('aws apprunner create-auto-scaling-configuration --auto-scaling-configuration-name pocos --max-concurrency 80')).out).AutoScalingConfiguration;
    expect(a2.AutoScalingConfigurationRevision).toBe(2);
    expect((await t.exec('aws apprunner create-auto-scaling-configuration --auto-scaling-configuration-name mala --min-size 5 --max-size 2')).err).toContain('MaxSize must be between MinSize and 25');
    expect(await out(t, 'aws apprunner list-auto-scaling-configurations --query "length(AutoScalingConfigurationSummaryList)"')).toBe('3');
    expect(await out(t, 'aws apprunner list-auto-scaling-configurations --latest-only --query "AutoScalingConfigurationSummaryList[].AutoScalingConfigurationName" --output text')).toContain('pocos');
    const c = JSON.parse((await t.exec(create('tienda', src(), `--auto-scaling-configuration-arn ${a2.AutoScalingConfigurationArn}`))).out);
    expect(c.Service.AutoScalingConfigurationSummary.AutoScalingConfigurationName).toBe('pocos');
    expect((await t.exec(`aws apprunner delete-auto-scaling-configuration --auto-scaling-configuration-arn ${a2.AutoScalingConfigurationArn}`)).err).toContain('in use');
  });
});
