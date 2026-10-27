import { mkEnv } from './helpers';

const SC = ['data-ddb-tienda', 'data-ddb-eventos', 'data-rds', 'data-cache', 'data-dms', 'data-sync', 'data-boss'];

describe('escenarios de datos', () => {
  test.each(SC)('%s se construye', (s) => {
    expect(() => mkEnv({ scenario: s })).not.toThrow();
  });

  test('la función de caché falla sin la variable CACHE', async () => {
    const e = mkEnv({ scenario: 'data-cache' });
    e.io.god = true;
    const r = await e.json(`_check invoke --function catalogo --payload '{"id":"1"}'`);
    expect(r.FunctionError).toBe('Unhandled');
    expect(JSON.stringify(r.Payload)).toContain('CACHE');
  });

  test('el rol de la función no puede ponerla en la VPC hasta tener la política de red', async () => {
    const e = mkEnv({ scenario: 'data-cache' });
    const vpc = await e.json('ec2 describe-vpcs --filters Name=tag:Name,Values=app --query "Vpcs[0].VpcId"');
    const subnets = (await e.json(`ec2 describe-subnets --filters Name=vpc-id,Values=${vpc} --query "Subnets[].SubnetId"`)) as string[];
    const sg = await e.json('ec2 describe-security-groups --filters Name=group-name,Values=app-sg --query "SecurityGroups[0].GroupId"');
    const cmd = `lambda update-function-configuration --function-name catalogo --vpc-config SubnetIds=${subnets.join(',')},SecurityGroupIds=${sg}`;
    expect((await e.run(cmd)).stderr).toContain('CreateNetworkInterface');
    await e.run('iam attach-role-policy --role-name catalogo-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole');
    expect((await e.run(cmd)).code).toBe(0);
  });

  test('el grupo sesiones empieza con un solo nodo y sin failover', async () => {
    const e = mkEnv({ scenario: 'data-cache' });
    const g = (await e.json('elasticache describe-replication-groups --replication-group-id sesiones')).ReplicationGroups[0];
    expect(g.Status).toBe('available');
    expect(g.AutomaticFailover).toBe('disabled');
    expect(g.NodeGroups[0].NodeGroupMembers).toHaveLength(1);
  });

  test('el rol de DMS al principio no puede escribir en el lago ni la base admite a la instancia', async () => {
    const e = mkEnv({ scenario: 'data-dms' });
    expect(await e.json('iam list-attached-role-policies --role-name dms-s3-role --query "length(AttachedPolicies)"')).toBe(0);
    expect(await e.json('ec2 describe-security-groups --filters Name=group-name,Values=legado-sg --query "length(SecurityGroups[0].IpPermissions)"')).toBe(0);
  });
});
