import { makeZip } from '../../engine/commands/archive';
import { mkEnv, type TestEnv } from './helpers';

const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const SPEC = `version: 0.2
env:
  variables:
    ENTORNO: pruebas
phases:
  install:
    commands:
      - pip install -r requirements.txt
  pre_build:
    commands:
      - echo "Probando en $ENTORNO"
      - pytest
  build:
    commands:
      - mkdir -p dist
      - cp app.py dist/
      - echo "compilado" > dist/version.txt
  post_build:
    commands:
      - echo "fin con éxito=$CODEBUILD_BUILD_SUCCEEDING"
artifacts:
  files:
    - '**/*'
  base-directory: dist
  name: salida
`;
const APP = 'def suma(a, b):\n    return a + b\n';
const TEST = 'from app import suma\n\ndef test_suma():\n    assert suma(2, 3) == 5\n';

async function setup(files: Record<string, string> = {}, perms = true) {
  const e = mkEnv();
  const src = { 'buildspec.yml': SPEC, 'app.py': APP, 'test_app.py': TEST, 'requirements.txt': 'pytest\n', ...files };
  e.write('src.zip', makeZip(src));
  await e.run('s3 mb s3://codigo');
  await e.run('s3 mb s3://artefactos');
  await e.run('s3api put-object --bucket codigo --key src.zip --body src.zip');
  e.write('t.json', trust('codebuild.amazonaws.com'));
  await e.run('iam create-role --role-name build-role --assume-role-policy-document file://t.json');
  if (perms) {
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 'logs:*'], Resource: '*' }] }));
    await e.run('iam put-role-policy --role-name build-role --policy-name build --policy-document file://p.json');
  }
  return e;
}
const create = (e: TestEnv, extra = '') => e.run(`codebuild create-project --name tienda --source type=S3,location=codigo/src.zip --artifacts type=S3,location=artefactos,packaging=ZIP --environment type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL --service-role arn:aws:iam::123456789012:role/build-role ${extra}`);
const build = async (e: TestEnv) => {
  const r = await e.json('codebuild start-build --project-name tienda');
  return r.build.id as string;
};
const info = async (e: TestEnv, id: string) => (await e.json(`codebuild batch-get-builds --ids ${id}`)).builds[0];

describe('CodeBuild', () => {
  test('crear un proyecto valida la fuente, el contenedor y el rol', async () => {
    const e = await setup();
    expect((await e.run('codebuild create-project --name xx --source type=S3 --artifacts type=NO_ARTIFACTS --environment type=LINUX_CONTAINER,image=i,computeType=BUILD_GENERAL1_SMALL --service-role arn:aws:iam::123456789012:role/build-role')).stderr).toContain('Source location is required');
    expect((await e.run('codebuild create-project --name xx --source type=S3,location=a/b --artifacts type=NO_ARTIFACTS --environment type=LINUX_CONTAINER,image=i,computeType=GRANDE --service-role arn:aws:iam::123456789012:role/build-role')).stderr).toContain('Invalid compute type');
    e.write('t2.json', trust('ec2.amazonaws.com'));
    await e.run('iam create-role --role-name mal-rol --assume-role-policy-document file://t2.json');
    expect((await e.run('codebuild create-project --name xx --source type=S3,location=a/b --artifacts type=NO_ARTIFACTS --environment type=LINUX_CONTAINER,image=i,computeType=BUILD_GENERAL1_SMALL --service-role arn:aws:iam::123456789012:role/mal-rol')).stderr).toContain('CodeBuild is not authorized to perform: sts:AssumeRole');
    expect((await create(e)).code).toBe(0);
    expect((await create(e)).stderr).toContain('already exists');
    expect(await e.json('codebuild list-projects')).toEqual({ projects: ['tienda'] });
  });

  test('una compilación correcta: fases, registros en CloudWatch y artefacto en S3', async () => {
    const e = await setup();
    await create(e);
    const id = await build(e);
    let b = await info(e, id);
    expect(b.buildStatus).toBe('IN_PROGRESS');
    e.acct.clock += 5 * 60000;
    b = await info(e, id);
    expect(b.buildStatus).toBe('SUCCEEDED');
    expect(b.currentPhase).toBe('COMPLETED');
    expect(b.phases.map((p: any) => p.phaseType)).toEqual(['SUBMITTED', 'QUEUED', 'PROVISIONING', 'DOWNLOAD_SOURCE', 'INSTALL', 'PRE_BUILD', 'BUILD', 'POST_BUILD', 'UPLOAD_ARTIFACTS', 'FINALIZING', 'COMPLETED']);
    const logs = (await e.run(`logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name ${id.split(':')[1]} --query "events[].message" --output text`)).stdout;
    expect(logs).toContain('Running command pytest');
    expect(logs).toContain('Probando en pruebas');
    expect(logs).toContain('fin con éxito=1');
    expect(await e.json('s3api list-objects-v2 --bucket artefactos --query "Contents[].Key"')).toEqual(['salida.zip']);
    expect(await e.json('codebuild list-builds-for-project --project-name tienda --query "length(ids)"')).toBe(1);
  });

  test('si falla una prueba, la compilación falla en esa fase y post_build sigue corriendo', async () => {
    const e = await setup({ 'test_app.py': TEST.replace('== 5', '== 6') });
    await create(e);
    const id = await build(e);
    e.acct.clock += 5 * 60000;
    const b = await info(e, id);
    expect(b.buildStatus).toBe('FAILED');
    const failed = b.phases.find((p: any) => p.phaseStatus === 'FAILED');
    expect(failed.phaseType).toBe('PRE_BUILD');
    expect(failed.contexts[0]).toMatchObject({ statusCode: 'COMMAND_EXECUTION_ERROR' });
    expect(failed.contexts[0].message).toContain('Error while executing command: pytest. Reason: exit status 1');
    const logs = (await e.run(`logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name ${id.split(':')[1]} --query "events[].message" --output text`)).stdout;
    expect(logs).toContain('FAILED test_app.py::test_suma');
    expect(logs).toContain('fin con éxito=0');
    expect(logs).not.toContain('compilado');
    expect(await e.json('s3api list-buckets --query "length(Buckets)"')).toBe(2);
    expect((await e.run('s3api head-object --bucket artefactos --key salida.zip')).code).not.toBe(0);
  });

  test('errores de configuración: sin buildspec, sin permisos de S3, sin artefactos', async () => {
    let e = await setup({ 'buildspec.yml': '' });
    await e.run('s3 rm s3://codigo/src.zip');
    e.write('src2.zip', makeZip({ 'app.py': APP }));
    await e.run('s3api put-object --bucket codigo --key src.zip --body src2.zip');
    await create(e);
    let id = await build(e);
    e.acct.clock += 600000;
    let b = await info(e, id);
    expect(b.buildStatus).toBe('FAILED');
    expect(b.phases.find((p: any) => p.phaseStatus === 'FAILED').contexts[0].message).toContain('buildspec.yml: no such file or directory');
    // sin permisos de lectura de S3
    e = await setup({}, false);
    await create(e);
    id = await build(e);
    e.acct.clock += 600000;
    b = await info(e, id);
    expect(b.phases.find((p: any) => p.phaseStatus === 'FAILED').contexts[0].message).toContain('AccessDenied');
    // los artefactos no coinciden con nada
    e = await setup({ 'buildspec.yml': SPEC.replace('base-directory: dist', 'base-directory: nada') });
    await create(e);
    id = await build(e);
    e.acct.clock += 600000;
    b = await info(e, id);
    expect(b.phases.find((p: any) => p.phaseStatus === 'FAILED')).toMatchObject({ phaseType: 'UPLOAD_ARTIFACTS' });
  });

  test('los comandos aws de la compilación usan los permisos del rol del proyecto', async () => {
    const spec = 'version: 0.2\nphases:\n  build:\n    commands:\n      - aws sts get-caller-identity --query Arn --output text\n      - aws s3 mb s3://creado-por-build\n      - aws iam list-users\n';
    const e = await setup({ 'buildspec.yml': spec });
    await create(e);
    const id = await build(e);
    e.acct.clock += 600000;
    const b = await info(e, id);
    expect(b.buildStatus).toBe('FAILED');
    const logs = (await e.run(`logs get-log-events --log-group-name /aws/codebuild/tienda --log-stream-name ${id.split(':')[1]} --query "events[].message" --output text`)).stdout;
    expect(logs).toContain('assumed-role/build-role/AWSCodeBuild-');
    expect(logs).toContain('AccessDenied');
    expect(await e.json('s3api list-buckets --query "Buckets[?Name==\'creado-por-build\'] | length(@)"')).toBe(0);
  });
});
