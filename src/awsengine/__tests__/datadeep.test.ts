import { mkEnv, type TestEnv } from './helpers';

const DB = 'rds create-db-instance --db-instance-identifier db1 --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password Secreto123 --allocated-storage 20';
const RDSTRUST = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'rds.amazonaws.com' }, Action: 'sts:AssumeRole' }] });

async function withDb() {
  const e = mkEnv();
  const vpc = await e.json('ec2 describe-vpcs --query "Vpcs[?IsDefault].VpcId | [0]"');
  const sg = (await e.json(`ec2 create-security-group --group-name db-sg --description bd --vpc-id ${vpc}`)).GroupId;
  await e.json(`${DB} --vpc-security-group-ids ${sg}`);
  e.acct.clock += 10 * 60000;
  await e.run('rds describe-db-instances');
  return e;
}

describe('Secrets Manager', () => {
  test('crear, leer, versionar y borrar con ventana de recuperación', async () => {
    const e = mkEnv();
    const s = await e.json(`secretsmanager create-secret --name prod/db --secret-string '{"username":"admin","password":"x"}'`);
    expect(s.ARN).toMatch(/^arn:aws:secretsmanager:us-east-1:123456789012:secret:prod\/db-[a-z0-9]{6}$/);
    expect((await e.run(`secretsmanager create-secret --name prod/db --secret-string x`)).stderr).toContain('ResourceExistsException');
    expect((await e.run('secretsmanager create-secret --name otro')).stderr).toContain('SecretString or SecretBinary');
    expect(await e.json('secretsmanager get-secret-value --secret-id prod/db --query SecretString')).toBe('{"username":"admin","password":"x"}');
    await e.run(`secretsmanager put-secret-value --secret-id prod/db --secret-string '{"username":"admin","password":"y"}'`);
    const d = await e.json('secretsmanager describe-secret --secret-id prod/db --query "VersionIdsToStages"');
    expect(Object.values(d).sort()).toEqual([['AWSCURRENT'], ['AWSPREVIOUS']]);
    expect(await e.json('secretsmanager get-secret-value --secret-id prod/db --version-stage AWSPREVIOUS --query SecretString')).toContain('"x"');
    expect((await e.run('secretsmanager delete-secret --secret-id prod/db --recovery-window-in-days 3')).stderr).toContain('between 7 and 30');
    await e.run('secretsmanager delete-secret --secret-id prod/db --recovery-window-in-days 7');
    expect((await e.run('secretsmanager get-secret-value --secret-id prod/db')).stderr).toContain('marked for deletion');
    await e.run('secretsmanager restore-secret --secret-id prod/db');
    expect((await e.run('secretsmanager get-secret-value --secret-id prod/db')).code).toBe(0);
    await e.run('secretsmanager delete-secret --secret-id prod/db --force-delete-without-recovery');
    expect((await e.run('secretsmanager get-secret-value --secret-id prod/db')).stderr).toContain('ResourceNotFoundException');
    expect((await e.json('secretsmanager get-random-password --password-length 20 --exclude-punctuation')).RandomPassword).toHaveLength(20);
  });
});

describe('Parámetros de RDS', () => {
  test('los estáticos exigen reinicio y los dinámicos se aplican al momento', async () => {
    const e = await withDb();
    e.io.god = true;
    expect((await e.json('_check dbparam --instance db1 --name max_connections')).Value).toBe('85');
    e.io.god = false;
    await e.run('rds create-db-parameter-group --db-parameter-group-name mi-mysql --db-parameter-group-family mysql8.0 --description prueba');
    expect((await e.run('rds modify-db-parameter-group --db-parameter-group-name default.mysql8.0 --parameters ParameterName=max_connections,ParameterValue=200,ApplyMethod=immediate')).stderr).toContain('default parameter group');
    expect((await e.run('rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=performance_schema,ParameterValue=1,ApplyMethod=immediate')).stderr).toContain("'dynamic'");
    expect((await e.run('rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=nada,ParameterValue=1,ApplyMethod=pending-reboot')).stderr).toContain('Could not find parameter');
    await e.run('rds modify-db-parameter-group --db-parameter-group-name mi-mysql --parameters ParameterName=max_connections,ParameterValue=200,ApplyMethod=immediate ParameterName=performance_schema,ParameterValue=1,ApplyMethod=pending-reboot');
    await e.run('rds modify-db-instance --db-instance-identifier db1 --db-parameter-group-name mi-mysql');
    e.acct.clock += 60000;
    expect(await e.json('rds describe-db-instances --query "DBInstances[0].DBParameterGroups[0].ParameterApplyStatus"')).toBe('pending-reboot');
    e.io.god = true;
    expect((await e.json('_check dbparam --instance db1 --name max_connections')).Value).toBe('200');
    expect((await e.json('_check dbparam --instance db1 --name performance_schema')).Pending).toBe('1');
    e.io.god = false;
    await e.run('rds reboot-db-instance --db-instance-identifier db1');
    e.acct.clock += 60000;
    expect(await e.json('rds describe-db-instances --query "DBInstances[0].DBParameterGroups[0].ParameterApplyStatus"')).toBe('in-sync');
    expect((await e.run('rds delete-db-parameter-group --db-parameter-group-name mi-mysql')).stderr).toContain('still members');
    const p = await e.json('rds describe-db-parameters --db-parameter-group-name mi-mysql --source user --query "Parameters[].ParameterName"');
    expect(p).toEqual(['max_connections', 'performance_schema']);
  });
});

describe('Aurora Serverless v2 y recuperación', () => {
  test('la clase db.serverless exige la configuración de ACU en el clúster', async () => {
    const e = mkEnv();
    await e.json('rds create-db-cluster --db-cluster-identifier aur --engine aurora-mysql --master-username admin --master-user-password Secreto123');
    const mk = (id: string, cls: string) => `rds create-db-instance --db-instance-identifier ${id} --db-instance-class ${cls} --engine aurora-mysql --db-cluster-identifier aur`;
    expect((await e.run(mk('w1', 'db.serverless'))).stderr).toContain('ServerlessV2ScalingConfiguration');
    expect((await e.run('rds modify-db-cluster --db-cluster-identifier aur --serverless-v2-scaling-configuration MinCapacity=9,MaxCapacity=4')).stderr).toContain('MinCapacity');
    await e.run('rds modify-db-cluster --db-cluster-identifier aur --serverless-v2-scaling-configuration MinCapacity=0.5,MaxCapacity=8');
    expect((await e.run(mk('w1', 'db.serverless'))).code).toBe(0);
    expect(await e.json('rds describe-db-clusters --query "DBClusters[0].ServerlessV2ScalingConfiguration"')).toEqual({ MinCapacity: 0.5, MaxCapacity: 8 });
  });

  test('PITR de RDS: ventana, error sin copias y nueva instancia', async () => {
    const e = await withDb();
    const t = (s: string) => `rds restore-db-instance-to-point-in-time --source-db-instance-identifier db1 --target-db-instance-identifier ${s}`;
    expect((await e.run(t('r1'))).stderr).toContain('RestoreTime or UseLatestRestorableTime');
    expect((await e.run(`${t('r1')} --restore-time ${new Date(e.acct.clock + 3600000).toISOString()}`)).stderr).toContain('later than the latest restorable time');
    expect((await e.run(`${t('r1')} --restore-time ${new Date(e.acct.clock - 3 * 86400000).toISOString()}`)).stderr).toContain('earlier than the earliest restorable time');
    expect((await e.run(`${t('r1')} --restore-time ${new Date(e.acct.clock - 3600000).toISOString()}`)).code).toBe(0);
    expect(await e.json('rds describe-db-instances --db-instance-identifier r1 --query "DBInstances[0].DBInstanceStatus"')).toBe('creating');
    await e.run('rds modify-db-instance --db-instance-identifier db1 --backup-retention-period 0 --apply-immediately');
    e.acct.clock += 120000;
    await e.run('rds describe-db-instances');
    expect((await e.run(`${t('r2')} --use-latest-restorable-time`)).stderr).toContain('Backups are not enabled');
  });
});

describe('RDS Proxy', () => {
  async function setup() {
    const e = await withDb();
    e.write('t.json', RDSTRUST);
    const role = (await e.json('iam create-role --role-name proxy-role --assume-role-policy-document file://t.json')).Role.Arn as string;
    const secret = (await e.json(`secretsmanager create-secret --name prod/db --secret-string '{"username":"admin","password":"Secreto123"}'`)).ARN as string;
    const subnets = (await e.json('ec2 describe-subnets --query "Subnets[?DefaultForAz].SubnetId"')) as string[];
    return { e, role, secret, subnets };
  }
  const create = (role: string, secret: string, subnets: string[]) => `rds create-db-proxy --db-proxy-name mi-proxy --engine-family MYSQL --auth '[{"AuthScheme":"SECRETS","SecretArn":"${secret}","IAMAuth":"DISABLED"}]' --role-arn ${role} --vpc-subnet-ids ${subnets.slice(0, 2).join(' ')}`;
  const health = async (e: TestEnv) => (await e.json('rds describe-db-proxy-targets --db-proxy-name mi-proxy --query "Targets[0].TargetHealth"')) as { State: string; Reason?: string };

  test('validaciones y salud del destino: permisos del rol, credenciales y grupo de seguridad', async () => {
    const { e, role, secret, subnets } = await setup();
    expect(subnets.length).toBeGreaterThanOrEqual(2);
    // el rol debe confiar en rds.amazonaws.com
    e.write('bad.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] }));
    const bad = (await e.json('iam create-role --role-name mal-rol --assume-role-policy-document file://bad.json')).Role.Arn;
    expect((await e.run(create(bad, secret, subnets))).stderr).toContain('cannot be assumed by RDS');
    expect((await e.run(create(role, 'arn:aws:secretsmanager:us-east-1:123456789012:secret:no-existe', subnets))).stderr).toContain('could not be found');
    const px = (await e.json(create(role, secret, subnets))).DBProxy;
    expect(px.Endpoint).toMatch(/^mi-proxy\.proxy-[a-z0-9]+\.us-east-1\.rds\.amazonaws\.com$/);
    await e.run('rds register-db-proxy-targets --db-proxy-name mi-proxy --db-instance-identifiers db1');
    expect((await health(e)).State).toBe('REGISTERING');
    e.acct.clock += 4 * 60000;
    // sin permiso para leer el secreto
    let h = await health(e);
    expect(h).toMatchObject({ State: 'UNAVAILABLE', Reason: 'AUTH_FAILURE' });
    e.write('p.json', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: secret }] }));
    await e.run('iam put-role-policy --role-name proxy-role --policy-name secreto --policy-document file://p.json');
    // el grupo de seguridad de la base de datos no admite al proxy
    h = await health(e);
    expect(h).toMatchObject({ State: 'UNAVAILABLE', Reason: 'CONNECTION_FAILED' });
    const dbSg = (await e.json('rds describe-db-instances --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId"')) as string;
    const proxySg = (await e.json('rds describe-db-proxies --query "DBProxies[0].VpcSecurityGroupIds[0]"')) as string;
    if (dbSg !== proxySg) await e.run(`ec2 authorize-security-group-ingress --group-id ${dbSg} --protocol tcp --port 3306 --source-group ${proxySg}`);
    expect((await health(e)).State).toBe('AVAILABLE');
    // contraseña distinta en el secreto
    await e.run(`secretsmanager put-secret-value --secret-id prod/db --secret-string '{"username":"admin","password":"otra"}'`);
    expect(await health(e)).toMatchObject({ State: 'UNAVAILABLE', Reason: 'AUTH_FAILURE' });
    await e.run(`secretsmanager put-secret-value --secret-id prod/db --secret-string '{"username":"admin","password":"Secreto123"}'`);
    expect((await health(e)).State).toBe('AVAILABLE');
    const g = await e.json('rds modify-db-proxy-target-group --db-proxy-name mi-proxy --target-group-name default --connection-pool-config MaxConnectionsPercent=60,MaxIdleConnectionsPercent=20');
    expect(g.TargetGroup.ConnectionPoolConfig.MaxConnectionsPercent).toBe(60);
    expect((await e.run('rds modify-db-proxy-target-group --db-proxy-name mi-proxy --target-group-name default --connection-pool-config MaxConnectionsPercent=10,MaxIdleConnectionsPercent=50')).stderr).toContain('MaxIdleConnectionsPercent');
  });
});
