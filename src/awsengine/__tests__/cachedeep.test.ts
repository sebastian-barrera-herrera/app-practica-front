import { mkEnv, type TestEnv } from './helpers';

const ZIP = 'PK\x03\x04@@ZIP@@';
const zip = (files: Record<string, string>) => ZIP + JSON.stringify(Object.entries(files).map(([path, content]) => ({ path, kind: 'file', mode: 0o644, mtime: 0, uid: 'a', gid: 'a', content })));
const TRUST = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] });

async function net() {
  const e = mkEnv({ scenario: 'net-peering' });
  const vpc = (await e.json('ec2 describe-vpcs --filters Name=tag:Name,Values=app --query "Vpcs[0].VpcId"')) as string;
  const s1 = (await e.json('ec2 describe-subnets --filters Name=tag:Name,Values=app-sub --query "Subnets[0].SubnetId"')) as string;
  const s2 = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.0.2.0/24 --availability-zone us-east-1b --query Subnet.SubnetId`)) as string;
  const appSg = (await e.json('ec2 describe-security-groups --filters Name=group-name,Values=app-sg --query "SecurityGroups[0].GroupId"')) as string;
  return { e, vpc, s1, s2, appSg };
}

describe('ElastiCache: grupos de replicación', () => {
  const create = (extra = '') => `elasticache create-replication-group --replication-group-id sesiones --replication-group-description sesiones --engine redis --cache-node-type cache.t4g.micro ${extra}`;

  test('validaciones, endpoints estables y prueba de conmutación', async () => {
    const { e, vpc, s1, s2 } = await net();
    await e.run(`elasticache create-cache-subnet-group --cache-subnet-group-name sg-cache --cache-subnet-group-description x --subnet-ids ${s1} ${s2}`);
    const base = `--cache-subnet-group-name sg-cache`;
    expect((await e.run(create(`${base} --num-cache-clusters 1 --automatic-failover-enabled`))).stderr).toContain('at least one replica');
    expect((await e.run(create(`${base} --num-cache-clusters 2 --multi-az-enabled`))).stderr).toContain('Multi-AZ requires automatic failover');
    expect((await e.run(create(`${base} --auth-token 0123456789abcdef`))).stderr).toContain('in-transit encryption');
    expect((await e.run(create(`${base} --cache-node-type cache.nada`).replace('--cache-node-type cache.t4g.micro', ''))).stderr).toContain('Invalid cache node type');
    const g = (await e.json(create(`${base} --num-cache-clusters 2 --automatic-failover-enabled --multi-az-enabled`))).ReplicationGroup;
    expect(g.Status).toBe('creating');
    expect(g.NodeGroups[0].PrimaryEndpoint).toBeUndefined();
    e.acct.clock += 7 * 60000;
    const d = (await e.json('elasticache describe-replication-groups --replication-group-id sesiones')).ReplicationGroups[0];
    expect(d.Status).toBe('available');
    const primary = d.NodeGroups[0].PrimaryEndpoint.Address as string;
    expect(primary).toMatch(/^sesiones\.[a-z0-9]{6}\.ng\.0001\.use1\.cache\.amazonaws\.com$/);
    const roles = d.NodeGroups[0].NodeGroupMembers.map((m: any) => `${m.CacheClusterId}:${m.CurrentRole}:${m.PreferredAvailabilityZone}`);
    expect(roles[0]).toMatch(/sesiones-001:primary:us-east-1[ab]/);
    await e.run('elasticache test-failover --replication-group-id sesiones --node-group-id 0001');
    e.acct.clock += 2 * 60000;
    const after = (await e.json('elasticache describe-replication-groups --replication-group-id sesiones')).ReplicationGroups[0];
    expect(after.NodeGroups[0].PrimaryEndpoint.Address).toBe(primary);
    expect(after.NodeGroups[0].NodeGroupMembers.find((m: any) => m.CurrentRole === 'primary').CacheClusterId).toBe('sesiones-002');
    expect(vpc).toBeTruthy();
    // memcached: sin réplicas ni conmutación
    await e.run(`elasticache create-cache-cluster --cache-cluster-id mc --engine memcached --num-cache-nodes 3 --cache-subnet-group-name sg-cache`);
    e.acct.clock += 7 * 60000;
    const m = (await e.json('elasticache describe-cache-clusters --cache-cluster-id mc')).CacheClusters[0];
    expect(m.ConfigurationEndpoint.Port).toBe(11211);
    expect((await e.run('elasticache modify-cache-cluster --cache-cluster-id mc --num-cache-nodes 2 --apply-immediately')).code).toBe(0);
    expect((await e.run('elasticache create-cache-cluster --cache-cluster-id r1 --engine redis --num-cache-nodes 2')).stderr).toContain('exactly one node');
  });
});

describe('Lambda en una VPC', () => {
  async function fnSetup(code: string, extra = '', policies = ['service-role/AWSLambdaVPCAccessExecutionRole']) {
    const n = await net();
    const { e, s1, s2, appSg } = n;
    e.write('t.json', TRUST);
    const role = (await e.json('iam create-role --role-name fn --assume-role-policy-document file://t.json')).Role.Arn as string;
    for (const p of policies) await e.run(`iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/${p}`);
    e.write('f.zip', zip({ 'lambda_function.py': code }));
    const mk = (vpc: string) => `lambda create-function --function-name f --runtime python3.12 --role ${role} --handler lambda_function.lambda_handler --zip-file fileb://f.zip --timeout 10 ${vpc} ${extra}`;
    return { ...n, role, mk, vpcCfg: `--vpc-config SubnetIds=${s1},${s2},SecurityGroupIds=${appSg}` };
  }
  const run = async (e: TestEnv, payload = '{}') => {
    e.io.god = true;
    const r = await e.json(`_check invoke --function f --payload '${payload}'`);
    e.io.god = false;
    return r as { FunctionError: string | null; Payload: any; DurationMs: number; Logs: string[] };
  };

  test('el rol necesita permisos de interfaces de red y los datos tienen que ser coherentes', async () => {
    const { e, mk, vpcCfg, s1 } = await fnSetup("def lambda_handler(event, context):\n    return 'ok'\n", '', ['service-role/AWSLambdaBasicExecutionRole']);
    expect((await e.run(mk(vpcCfg))).stderr).toContain('CreateNetworkInterface');
    await e.run('iam attach-role-policy --role-name fn --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole');
    expect((await e.run(mk('--vpc-config SubnetIds=subnet-0000000000000000,SecurityGroupIds=sg-0'))).stderr).toContain('does not exist');
    const r = await e.json(mk(vpcCfg));
    expect(r.VpcConfig.SubnetIds).toHaveLength(2);
    expect(r.VpcConfig.VpcId).toMatch(/^vpc-/);
    expect(s1).toBeTruthy();
  });

  test('sin NAT ni endpoint, boto3 no llega a DynamoDB: Task timed out; con un endpoint de puerta funciona', async () => {
    const code = "import boto3\ndef lambda_handler(event, context):\n    t = boto3.client('dynamodb')\n    return t.list_tables()['TableNames']\n";
    const { e, mk, vpcCfg, vpc, s1 } = await fnSetup(code, '', ['service-role/AWSLambdaVPCAccessExecutionRole', 'AmazonDynamoDBFullAccess']);
    await e.run(mk(vpcCfg));
    // el timeout de 10 s no alcanza al connect timeout de 60 s
    const slow = await run(e);
    expect(slow.FunctionError).toBe('Unhandled');
    expect(JSON.stringify(slow.Payload)).toContain('Task timed out after 10.00 seconds');
    // una ruta a una internet gateway NO sirve (las ENI de Lambda no tienen IP pública)
    const rtbs = (await e.json(`ec2 describe-route-tables --filters Name=vpc-id,Values=${vpc} --query "RouteTables[].RouteTableId"`)) as string[];
    const routes = await e.json(`ec2 describe-route-tables --filters Name=vpc-id,Values=${vpc} --query "RouteTables[].Routes[].GatewayId"`);
    expect(routes.some((g: string) => g?.startsWith('igw-'))).toBe(true);
    expect(JSON.stringify((await run(e)).Payload)).toContain('Task timed out');
    // endpoint de puerta de DynamoDB asociado a la tabla de rutas
    await e.run(`ec2 create-vpc-endpoint --vpc-id ${vpc} --service-name com.amazonaws.us-east-1.dynamodb --route-table-ids ${rtbs.join(' ')}`);
    e.acct.clock += 60000;
    const ok = await run(e);
    expect(ok.FunctionError).toBeNull();
    expect(ok.Payload).toEqual([]);
    expect(s1).toBeTruthy();
  });

  test('el cliente redis: red, TLS, caché de lectura y caducidad', async () => {
    const code = `import os, time, redis
r = redis.Redis(host=os.environ['CACHE'], port=6379, decode_responses=True, ssl=os.environ.get('SSL') == '1', socket_connect_timeout=2)

def lambda_handler(event, context):
    k = 'prod:' + event['id']
    v = r.get(k)
    if v:
        return {'origen': 'cache', 'v': v, 'ttl': r.ttl(k)}
    time.sleep(0.4)
    v = 'datos-' + event['id']
    r.setex(k, 60, v)
    return {'origen': 'db', 'v': v}
`;
    const { e, mk, vpcCfg, vpc, s1, s2, appSg } = await fnSetup(code);
    await e.run(`elasticache create-cache-subnet-group --cache-subnet-group-name sg-cache --cache-subnet-group-description x --subnet-ids ${s1} ${s2}`);
    const cacheSg = (await e.json(`ec2 create-security-group --group-name cache-sg --description cache --vpc-id ${vpc} --query GroupId`)) as string;
    await e.run(`elasticache create-replication-group --replication-group-id sesiones --replication-group-description s --engine redis --cache-node-type cache.t4g.micro --num-cache-clusters 2 --automatic-failover-enabled --cache-subnet-group-name sg-cache --security-group-ids ${cacheSg}`);
    const host = (await e.json('elasticache describe-replication-groups --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address"').catch(() => null)) as string | null;
    expect(host).toBeNull(); // todavía se está creando
    e.acct.clock += 7 * 60000;
    const primary = (await e.json('elasticache describe-replication-groups --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address"')) as string;
    // 1. función fuera de la VPC: se queda esperando
    await e.run(mk('').replace('--timeout 10', `--timeout 10 --environment Variables={CACHE=${primary}}`));
    expect(JSON.stringify((await run(e, '{"id":"1"}')).Payload)).toContain('TimeoutError');
    // 2. en la VPC pero el grupo de seguridad del caché no la admite
    await e.run(`lambda update-function-configuration --function-name f ${vpcCfg}`);
    const t2 = await run(e, '{"id":"1"}');
    expect(JSON.stringify(t2.Payload)).toMatch(/TimeoutError|Timeout connecting to server/);
    // 3. se abre el puerto 6379 al grupo de la función
    await e.run(`ec2 authorize-security-group-ingress --group-id ${cacheSg} --protocol tcp --port 6379 --source-group ${appSg}`);
    const first = await run(e, '{"id":"1"}');
    expect(first.Payload.origen).toBe('db');
    expect(first.DurationMs).toBeGreaterThan(400);
    // 4. segunda petición: viene de la caché y es mucho más rápida
    const second = await run(e, '{"id":"1"}');
    expect(second.Payload).toMatchObject({ origen: 'cache', v: 'datos-1' });
    expect(second.DurationMs).toBeLessThan(100);
    expect(second.Payload.ttl).toBeLessThanOrEqual(60);
    // 5. TLS: si el grupo exige cifrado en tránsito y el cliente no lo usa, el servidor cierra la conexión
    await e.run(`elasticache create-replication-group --replication-group-id seguro --replication-group-description s --engine redis --cache-node-type cache.t4g.micro --transit-encryption-enabled --auth-token abcdefghijklmnop1234 --cache-subnet-group-name sg-cache --security-group-ids ${cacheSg} --num-cache-clusters 1`);
    e.acct.clock += 7 * 60000;
    const sec = (await e.json('elasticache describe-replication-groups --replication-group-id seguro --query "ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address"')) as string;
    await e.run(`lambda update-function-configuration --function-name f --environment Variables={CACHE=${sec}}`);
    expect(JSON.stringify((await run(e, '{"id":"2"}')).Payload)).toContain('Connection closed by server');
    await e.run(`lambda update-function-configuration --function-name f --environment Variables={CACHE=${sec},SSL=1}`);
    expect(JSON.stringify((await run(e, '{"id":"2"}')).Payload)).toContain('NOAUTH');
  });
});
