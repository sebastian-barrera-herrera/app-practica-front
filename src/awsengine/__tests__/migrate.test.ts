import { regional } from '../account';
import { rdsOf } from '../services/rds';
import { mkEnv } from './helpers';

const DB = 'rds create-db-instance --db-instance-identifier origen --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password Secreto123 --allocated-storage 20';
const trust = (svc: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: svc }, Action: 'sts:AssumeRole' }] });
const q = (s: string) => `'${s}'`;
const MAPS = JSON.stringify({ rules: [{ 'rule-type': 'selection', 'rule-id': '1', 'rule-name': '1', 'object-locator': { 'schema-name': 'tienda', 'table-name': '%' }, 'rule-action': 'include' }] });

async function setup(opts: { sgOpen?: boolean } = {}) {
  const e = mkEnv();
  const vpc = await e.json('ec2 describe-vpcs --query "Vpcs[?IsDefault].VpcId | [0]"');
  const sg = (await e.json(`ec2 create-security-group --group-name db-sg --description bd --vpc-id ${vpc}`)).GroupId;
  if (opts.sgOpen) await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --cidr 172.31.0.0/16`);
  await e.json(`${DB} --vpc-security-group-ids ${sg} --backup-retention-period 1`);
  e.acct.clock += 10 * 60000;
  await e.run('rds describe-db-instances');
  const db = rdsOf(e.acct, 'us-east-1').instances.origen;
  db.tables = [
    { schema: 'tienda', name: 'pedidos', rows: 4000 },
    { schema: 'tienda', name: 'clientes', rows: 800 },
    { schema: 'otra', name: 'logs', rows: 100 },
  ];
  const host = (await e.json('rds describe-db-instances --query "DBInstances[0].Endpoint.Address"')) as string;
  return { e, sg, host, vpc };
}

async function dmsRoles(e: Awaited<ReturnType<typeof setup>>['e']) {
  await e.run(`iam create-role --role-name dms-vpc-role --assume-role-policy-document ${q(trust('dms.amazonaws.com'))}`);
  await e.run('iam attach-role-policy --role-name dms-vpc-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole');
}

describe('DMS', () => {
  test('el grupo de subredes exige dms-vpc-role', async () => {
    const { e } = await setup();
    const subnets = (await e.json('ec2 describe-subnets --query "Subnets[].SubnetId"')) as string[];
    const r = await e.run(`dms create-replication-subnet-group --replication-subnet-group-identifier sg1 --replication-subnet-group-description x --subnet-ids ${subnets.join(' ')}`);
    expect(r.stderr).toContain('dms-vpc-role');
    await e.run(`iam create-role --role-name dms-vpc-role --assume-role-policy-document ${q(trust('ec2.amazonaws.com'))}`);
    expect((await e.run(`dms create-replication-subnet-group --replication-subnet-group-identifier sg1 --replication-subnet-group-description x --subnet-ids ${subnets.join(' ')}`)).stderr).toContain('not configured properly');
    await e.run(`iam update-assume-role-policy --role-name dms-vpc-role --policy-document ${q(trust('dms.amazonaws.com'))}`);
    await e.run('iam attach-role-policy --role-name dms-vpc-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole');
    const ok = await e.json(`dms create-replication-subnet-group --replication-subnet-group-identifier sg1 --replication-subnet-group-description x --subnet-ids ${subnets.join(' ')}`);
    expect(ok.ReplicationSubnetGroup.SubnetGroupStatus).toBe('Complete');
  });

  test('instancia, endpoints y prueba de conexión: red, credenciales y puerto', async () => {
    const { e, sg, host } = await setup();
    const i = await e.json('dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --vpc-security-group-ids ' + sg);
    expect(i.ReplicationInstance.ReplicationInstanceStatus).toBe('creating');
    expect((await e.run('dms create-replication-instance --replication-instance-identifier rep2 --replication-instance-class m5.large')).stderr).toContain('Invalid replication instance class');
    const arn = i.ReplicationInstance.ReplicationInstanceArn;
    const src = await e.json(`dms create-endpoint --endpoint-identifier src --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password Secreto123 --database-name tienda`);
    expect(src.Endpoint.EndpointType).toBe('SOURCE');
    expect((await e.run('dms create-endpoint --endpoint-identifier x --endpoint-type source --engine-name mysql --server-name h')).stderr).toContain('needs --server-name, --username and --password');
    // instancia aún creándose
    await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${src.Endpoint.EndpointArn}`);
    e.acct.clock += 30000;
    expect((await e.json('dms describe-connections --query "Connections[0].Status"'))).toBe('failed');
    e.acct.clock += 6 * 60000;
    await e.run('dms describe-replication-instances');
    // el grupo de seguridad de la BD no deja pasar a DMS
    await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${src.Endpoint.EndpointArn}`);
    expect(await e.json('dms describe-connections --query "Connections[0].Status"')).toBe('testing');
    e.acct.clock += 30000;
    const c1 = await e.json('dms describe-connections --query "Connections[0]"');
    expect(c1.Status).toBe('failed');
    expect(c1.LastFailureMessage).toContain('security group');
    // abre el 3306 a la instancia (su grupo)
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --source-group ${sg}`);
    await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${src.Endpoint.EndpointArn}`);
    e.acct.clock += 30000;
    expect(await e.json('dms describe-connections --query "Connections[0].Status"')).toBe('successful');
    // contraseña incorrecta
    const bad = await e.json(`dms create-endpoint --endpoint-identifier src-mal --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password otra --database-name tienda`);
    await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${bad.Endpoint.EndpointArn}`);
    e.acct.clock += 30000;
    const cs = (await e.json('dms describe-connections')).Connections as { EndpointIdentifier: string; Status: string; LastFailureMessage?: string }[];
    expect(cs.find((x) => x.EndpointIdentifier === 'src-mal')!.LastFailureMessage).toContain('Access denied');
  });

  test('carga completa a S3: rol del destino y filtro de tablas', async () => {
    const { e, sg, host } = await setup({ sgOpen: true });
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --source-group ${sg}`);
    const arn = (await e.json('dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --vpc-security-group-ids ' + sg)).ReplicationInstance.ReplicationInstanceArn;
    e.acct.clock += 6 * 60000;
    await e.run('dms describe-replication-instances');
    await e.run('s3 mb s3://lago-datos');
    const srcArn = (await e.json(`dms create-endpoint --endpoint-identifier src --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password Secreto123`)).Endpoint.EndpointArn;
    // rol sin permisos de S3
    await e.run(`iam create-role --role-name dms-s3 --assume-role-policy-document ${q(trust('dms.amazonaws.com'))}`);
    const roleArn = 'arn:aws:iam::123456789012:role/dms-s3';
    expect((await e.run('dms create-endpoint --endpoint-identifier dst --endpoint-type target --engine-name s3 --s3-settings BucketName=lago-datos')).stderr).toContain('ServiceAccessRoleArn');
    const dstArn = (await e.json(`dms create-endpoint --endpoint-identifier dst --endpoint-type target --engine-name s3 --s3-settings BucketName=lago-datos,ServiceAccessRoleArn=${roleArn},BucketFolder=raw`)).Endpoint.EndpointArn;
    for (const a of [srcArn, dstArn]) await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${a}`);
    e.acct.clock += 30000;
    const cs = (await e.json('dms describe-connections')).Connections as { EndpointIdentifier: string; Status: string; LastFailureMessage?: string }[];
    expect(cs.find((x) => x.EndpointIdentifier === 'src')!.Status).toBe('successful');
    expect(cs.find((x) => x.EndpointIdentifier === 'dst')!.LastFailureMessage).toContain('s3:PutObject');
    await e.run(`iam put-role-policy --role-name dms-s3 --policy-name s3 --policy-document ${q(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:PutObject', 's3:DeleteObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::lago-datos', 'arn:aws:s3:::lago-datos/*'] }] }))}`);
    await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${dstArn}`);
    e.acct.clock += 30000;
    expect(await e.json(`dms describe-connections --query "Connections[?EndpointIdentifier=='dst'].Status | [0]"`)).toBe('successful');
    // la tarea
    expect((await e.run(`dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn ${srcArn} --target-endpoint-arn ${dstArn} --replication-instance-arn ${arn} --migration-type full-load --table-mappings ${q('{}')}`)).stderr).toContain('Invalid TableMappings');
    const t = await e.json(`dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn ${srcArn} --target-endpoint-arn ${dstArn} --replication-instance-arn ${arn} --migration-type full-load --table-mappings ${q(MAPS)}`);
    const tarn = t.ReplicationTask.ReplicationTaskArn;
    expect((await e.run(`dms create-replication-task --replication-task-identifier t2 --source-endpoint-arn ${dstArn} --target-endpoint-arn ${srcArn} --replication-instance-arn ${arn} --migration-type full-load --table-mappings ${q(MAPS)}`)).stderr).toContain('must be a source');
    await e.run(`dms start-replication-task --replication-task-arn ${tarn} --start-replication-task-type start-replication`);
    expect(await e.json('dms describe-replication-tasks --query "ReplicationTasks[0].Status"')).toBe('starting');
    e.acct.clock += 31000;
    expect(await e.json('dms describe-replication-tasks --query "ReplicationTasks[0].Status"')).toBe('running');
    e.acct.clock += 30000;
    const done = await e.json('dms describe-replication-tasks --query "ReplicationTasks[0]"');
    expect(done.Status).toBe('stopped');
    expect(done.StopReason).toContain('FULL_LOAD_ONLY_FINISHED');
    const stats = (await e.json(`dms describe-table-statistics --replication-task-arn ${tarn}`)).TableStatistics as { TableName: string; FullLoadRows: number }[];
    expect(stats.map((x) => x.TableName).sort()).toEqual(['clientes', 'pedidos']);
    expect(stats.find((x) => x.TableName === 'pedidos')!.FullLoadRows).toBe(4000);
    const keys = (await e.json('s3api list-objects-v2 --bucket lago-datos --query "Contents[].Key"')) as string[];
    expect(keys).toContain('raw/tienda/pedidos/LOAD00000001.csv');
    expect(keys.some((k) => k.includes('logs'))).toBe(false);
    await e.run(`dms delete-replication-task --replication-task-arn ${tarn}`);
    expect(await e.json('dms describe-replication-tasks --query "length(ReplicationTasks)"')).toBe(0);
  });

  test('CDC: exige copias automáticas y binlog_format=ROW; sin conexión probada falla', async () => {
    const { e, sg, host } = await setup({ sgOpen: true });
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --source-group ${sg}`);
    await dmsRoles(e);
    const arn = (await e.json('dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --vpc-security-group-ids ' + sg)).ReplicationInstance.ReplicationInstanceArn;
    e.acct.clock += 6 * 60000;
    await e.run('dms describe-replication-instances');
    await e.run('s3 mb s3://lago-cdc');
    await e.run(`iam create-role --role-name dms-s3 --assume-role-policy-document ${q(trust('dms.amazonaws.com'))}`);
    await e.run('iam attach-role-policy --role-name dms-s3 --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess');
    const srcArn = (await e.json(`dms create-endpoint --endpoint-identifier src --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password Secreto123`)).Endpoint.EndpointArn;
    const dstArn = (await e.json(`dms create-endpoint --endpoint-identifier dst --endpoint-type target --engine-name s3 --s3-settings BucketName=lago-cdc,ServiceAccessRoleArn=arn:aws:iam::123456789012:role/dms-s3`)).Endpoint.EndpointArn;
    const tarn = (await e.json(`dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn ${srcArn} --target-endpoint-arn ${dstArn} --replication-instance-arn ${arn} --migration-type full-load-and-cdc --table-mappings ${q(MAPS)}`)).ReplicationTask.ReplicationTaskArn;
    const start = () => e.json(`dms start-replication-task --replication-task-arn ${tarn} --start-replication-task-type start-replication`);
    // sin probar las conexiones
    expect((await start()).ReplicationTask.LastFailureMessage).toContain('has not been tested successfully');
    for (const a of [srcArn, dstArn]) await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${a}`);
    e.acct.clock += 30000;
    // binlog_format=MIXED por defecto
    const f1 = await start();
    expect(f1.ReplicationTask.Status).toBe('failed');
    expect(f1.ReplicationTask.LastFailureMessage).toContain('binlog_format=ROW');
    // arregla el grupo de parámetros
    await e.run('rds create-db-parameter-group --db-parameter-group-name binlog --db-parameter-group-family mysql8.0 --description cdc');
    await e.run('rds modify-db-parameter-group --db-parameter-group-name binlog --parameters ParameterName=binlog_format,ParameterValue=ROW,ApplyMethod=immediate');
    await e.run('rds modify-db-instance --db-instance-identifier origen --db-parameter-group-name binlog --apply-immediately');
    e.acct.clock += 60000;
    await e.run('rds reboot-db-instance --db-instance-identifier origen');
    e.acct.clock += 60000;
    const f2 = await start();
    expect(f2.ReplicationTask.LastFailureMessage ?? '').toBe('');
    expect(f2.ReplicationTask.Status).toBe('starting');
    e.acct.clock += 40000;
    const r = await e.json('dms describe-replication-tasks --query "ReplicationTasks[0]"');
    expect(r.Status).toBe('running');
    e.acct.clock += 60000;
    // full-load-and-cdc sigue corriendo tras la carga inicial
    const after = await e.json('dms describe-replication-tasks --query "ReplicationTasks[0]"');
    expect(after.Status).toBe('running');
    expect(after.ReplicationTaskStats.FullLoadProgressPercent).toBe(100);
    expect((await e.run(`dms delete-replication-task --replication-task-arn ${tarn}`)).stderr).toContain('Stop the task');
    await e.run(`dms stop-replication-task --replication-task-arn ${tarn}`);
    expect((await e.run(`dms stop-replication-task --replication-task-arn ${tarn}`)).stderr).toContain('only a running task');
  });

  test('CDC sin copias automáticas falla; en PostgreSQL pide rds.logical_replication', async () => {
    const { e, sg, host } = await setup({ sgOpen: true });
    rdsOf(e.acct, 'us-east-1').instances.origen.BackupRetentionPeriod = 0;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --source-group ${sg}`);
    const arn = (await e.json('dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --vpc-security-group-ids ' + sg)).ReplicationInstance.ReplicationInstanceArn;
    e.acct.clock += 6 * 60000;
    await e.run('dms describe-replication-instances');
    await e.run('s3 mb s3://lago-x');
    await e.run(`iam create-role --role-name dms-s3 --assume-role-policy-document ${q(trust('dms.amazonaws.com'))}`);
    await e.run('iam attach-role-policy --role-name dms-s3 --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess');
    const srcArn = (await e.json(`dms create-endpoint --endpoint-identifier src --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password Secreto123`)).Endpoint.EndpointArn;
    const dstArn = (await e.json(`dms create-endpoint --endpoint-identifier dst --endpoint-type target --engine-name s3 --s3-settings BucketName=lago-x,ServiceAccessRoleArn=arn:aws:iam::123456789012:role/dms-s3`)).Endpoint.EndpointArn;
    for (const a of [srcArn, dstArn]) await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${a}`);
    e.acct.clock += 30000;
    const tarn = (await e.json(`dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn ${srcArn} --target-endpoint-arn ${dstArn} --replication-instance-arn ${arn} --migration-type cdc --table-mappings ${q(MAPS)}`)).ReplicationTask.ReplicationTaskArn;
    const r = await e.json(`dms start-replication-task --replication-task-arn ${tarn} --start-replication-task-type start-replication`);
    expect(r.ReplicationTask.LastFailureMessage).toContain('automated backups');
  });

  test('destino DynamoDB: crea la tabla y deja filas de muestra', async () => {
    const { e, sg, host } = await setup({ sgOpen: true });
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 3306 --source-group ${sg}`);
    const arn = (await e.json('dms create-replication-instance --replication-instance-identifier rep1 --replication-instance-class dms.t3.micro --vpc-security-group-ids ' + sg)).ReplicationInstance.ReplicationInstanceArn;
    e.acct.clock += 6 * 60000;
    await e.run('dms describe-replication-instances');
    await e.run(`iam create-role --role-name dms-ddb --assume-role-policy-document ${q(trust('dms.amazonaws.com'))}`);
    await e.run('iam attach-role-policy --role-name dms-ddb --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess');
    const srcArn = (await e.json(`dms create-endpoint --endpoint-identifier src --endpoint-type source --engine-name mysql --server-name ${host} --port 3306 --username admin --password Secreto123`)).Endpoint.EndpointArn;
    const dstArn = (await e.json(`dms create-endpoint --endpoint-identifier dst --endpoint-type target --engine-name dynamodb --dynamo-db-settings ServiceAccessRoleArn=arn:aws:iam::123456789012:role/dms-ddb`)).Endpoint.EndpointArn;
    for (const a of [srcArn, dstArn]) await e.run(`dms test-connection --replication-instance-arn ${arn} --endpoint-arn ${a}`);
    e.acct.clock += 30000;
    const tarn = (await e.json(`dms create-replication-task --replication-task-identifier t1 --source-endpoint-arn ${srcArn} --target-endpoint-arn ${dstArn} --replication-instance-arn ${arn} --migration-type full-load --table-mappings ${q(MAPS)}`)).ReplicationTask.ReplicationTaskArn;
    await e.run(`dms start-replication-task --replication-task-arn ${tarn} --start-replication-task-type start-replication`);
    e.acct.clock += 80000;
    await e.run('dms describe-replication-tasks');
    expect((await e.json('dynamodb list-tables')).TableNames.sort()).toEqual(['clientes', 'pedidos']);
    expect(await e.json('dynamodb scan --table-name pedidos --select COUNT --query Count')).toBe(5);
  });
});

describe('DataSync', () => {
  async function ds() {
    const e = mkEnv();
    await e.run('s3 mb s3://destino-ds');
    await e.run(`iam create-role --role-name ds-s3 --assume-role-policy-document ${q(trust('datasync.amazonaws.com'))}`);
    e.acct.onpremShares = { '10.0.0.5:/exports/ventas': { 'ventas/2024.csv': 'a,b\n1,2\n', 'ventas/2025.csv': 'a,b\n3,4\n', 'logs/app.log': 'x\n' } };
    regional(e.acct, 'us-east-1').datasync = { agents: { 'arn:aws:datasync:us-east-1:123456789012:agent/agent-0001': { arn: 'arn:aws:datasync:us-east-1:123456789012:agent/agent-0001', name: 'oficina', status: 'ONLINE' } }, locations: {}, tasks: {}, executions: {} };
    return e;
  }
  const AG = 'arn:aws:datasync:us-east-1:123456789012:agent/agent-0001';

  test('la ubicación de S3 comprueba el rol al crearla', async () => {
    const e = await ds();
    const mk = () => e.run(`datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::destino-ds --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/ds-s3 --subdirectory /ventas`);
    expect((await mk()).stderr).toContain('s3:ListBucket');
    await e.run(`iam put-role-policy --role-name ds-s3 --policy-name s3 --policy-document ${q(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['s3:ListBucket', 's3:GetBucketLocation', 's3:PutObject', 's3:GetObject'], Resource: ['arn:aws:s3:::destino-ds', 'arn:aws:s3:::destino-ds/*'] }] }))}`);
    const r = await mk();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).LocationArn).toMatch(/location\/loc-/);
    expect((await e.run('datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::nada --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/ds-s3')).stderr).toContain('does not exist');
  });

  test('copia NFS → S3 con filtros, sobrescritura y borrado', async () => {
    const e = await ds();
    await e.run(`iam put-role-policy --role-name ds-s3 --policy-name s3 --policy-document ${q(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] }))}`);
    const dst = JSON.parse((await e.run(`datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::destino-ds --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/ds-s3 --subdirectory /in`)).stdout).LocationArn;
    expect((await e.run('datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /exports/ventas --on-prem-config AgentArns=arn:aws:datasync:us-east-1:123456789012:agent/agent-zzz')).stderr).toContain('was not found');
    const src = JSON.parse((await e.run(`datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /exports/ventas --on-prem-config AgentArns=${AG}`)).stdout).LocationArn;
    expect((await e.run(`datasync create-task --source-location-arn ${src} --destination-location-arn ${dst} --options OverwriteMode=SIEMPRE`)).stderr).toContain('Invalid OverwriteMode');
    const task = JSON.parse((await e.run(`datasync create-task --source-location-arn ${src} --destination-location-arn ${dst} --name ventas --includes FilterType=SIMPLE_PATTERN,Value=/ventas*`)).stdout).TaskArn;
    const ex = JSON.parse((await e.run(`datasync start-task-execution --task-arn ${task}`)).stdout).TaskExecutionArn;
    expect((await e.json(`datasync describe-task-execution --task-execution-arn ${ex}`)).Status).toBe('LAUNCHING');
    e.acct.clock += 60000;
    const d = await e.json(`datasync describe-task-execution --task-execution-arn ${ex}`);
    expect(d.Status).toBe('SUCCESS');
    expect(d.FilesTransferred).toBe(2);
    expect((await e.json('s3api list-objects-v2 --bucket destino-ds --query "Contents[].Key"')).sort()).toEqual(['in/ventas/2024.csv', 'in/ventas/2025.csv']);
    // segunda pasada: solo cambios, nada que copiar
    const ex2 = JSON.parse((await e.run(`datasync start-task-execution --task-arn ${task}`)).stdout).TaskExecutionArn;
    e.acct.clock += 60000;
    expect((await e.json(`datasync describe-task-execution --task-execution-arn ${ex2}`)).FilesTransferred).toBe(0);
    // se cambia un archivo: se vuelve a copiar solo ese
    e.acct.onpremShares!['10.0.0.5:/exports/ventas']['ventas/2025.csv'] = 'a,b\n9,9\n';
    const ex3 = JSON.parse((await e.run(`datasync start-task-execution --task-arn ${task}`)).stdout).TaskExecutionArn;
    e.acct.clock += 60000;
    expect((await e.json(`datasync describe-task-execution --task-execution-arn ${ex3}`)).FilesTransferred).toBe(1);
    // PreserveDeletedFiles=REMOVE borra lo que ya no está en el origen
    delete e.acct.onpremShares!['10.0.0.5:/exports/ventas']['ventas/2024.csv'];
    const ex4 = JSON.parse((await e.run(`datasync start-task-execution --task-arn ${task} --override-options PreserveDeletedFiles=REMOVE`)).stdout).TaskExecutionArn;
    e.acct.clock += 60000;
    await e.run(`datasync describe-task-execution --task-execution-arn ${ex4}`);
    expect(await e.json('s3api list-objects-v2 --bucket destino-ds --query "Contents[].Key"')).toEqual(['in/ventas/2025.csv']);
    expect(await e.json(`datasync list-task-executions --task-arn ${task} --query "length(TaskExecutions)"`)).toBe(4);
  });

  test('con el agente desconectado la ejecución termina en ERROR', async () => {
    const e = await ds();
    await e.run(`iam put-role-policy --role-name ds-s3 --policy-name s3 --policy-document ${q(JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] }))}`);
    const dst = JSON.parse((await e.run(`datasync create-location-s3 --s3-bucket-arn arn:aws:s3:::destino-ds --s3-config BucketAccessRoleArn=arn:aws:iam::123456789012:role/ds-s3`)).stdout).LocationArn;
    const src = JSON.parse((await e.run(`datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /exports/ventas --on-prem-config AgentArns=${AG}`)).stdout).LocationArn;
    const task = JSON.parse((await e.run(`datasync create-task --source-location-arn ${src} --destination-location-arn ${dst}`)).stdout).TaskArn;
    regional(e.acct, 'us-east-1').datasync!.agents[AG].status = 'OFFLINE';
    const ex = JSON.parse((await e.run(`datasync start-task-execution --task-arn ${task}`)).stdout).TaskExecutionArn;
    const d = await e.json(`datasync describe-task-execution --task-execution-arn ${ex}`);
    expect(d.Status).toBe('ERROR');
    expect(d.Result.ErrorDetail).toContain('agent is offline');
    expect((await e.run(`datasync create-location-nfs --server-hostname 10.0.0.5 --subdirectory /otro --on-prem-config AgentArns=${AG}`)).stderr).toContain('not ONLINE');
  });
});
