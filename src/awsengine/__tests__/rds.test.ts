import { mkEnv } from './helpers';

const CREATE = 'rds create-db-instance --db-instance-identifier tienda-db --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password Secreta123 --allocated-storage 20';

describe('RDS: instancias', () => {
  test('crear, esperar y consultar el endpoint', async () => {
    const e = mkEnv();
    const c = (await e.json(CREATE)).DBInstance;
    expect(c.DBInstanceStatus).toBe('creating');
    expect(c.Endpoint).toBeUndefined();
    expect(c.BackupRetentionPeriod).toBe(1);
    expect(c.MultiAZ).toBe(false);
    expect(c.PubliclyAccessible).toBe(true); // VPC por defecto
    expect((await e.run(CREATE)).stderr).toContain('DBInstanceAlreadyExists');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const d = (await e.json('rds describe-db-instances --db-instance-identifier tienda-db')).DBInstances[0];
    expect(d.DBInstanceStatus).toBe('available');
    expect(d.Endpoint.Address).toMatch(/^tienda-db\.c[0-9a-f]{11}\.us-east-1\.rds\.amazonaws\.com$/);
    expect(d.Endpoint.Port).toBe(3306);
    expect(d.DBSubnetGroup.DBSubnetGroupName).toBe('default');
    expect((await e.run('rds describe-db-instances --db-instance-identifier nada')).stderr).toContain('DBInstanceNotFound');
  });

  test('validaciones de los parámetros', async () => {
    const e = mkEnv();
    const run = (extra: string) => e.run(`rds create-db-instance --db-instance-identifier x1 --db-instance-class db.t3.micro --engine mysql --master-username admin --master-user-password Secreta123 --allocated-storage 20 ${extra}`);
    expect((await e.run(CREATE.replace('Secreta123', 'corta'))).stderr).toContain('shorter than 8 characters');
    expect((await e.run(CREATE.replace('Secreta123', 'con/barra123'))).stderr).toContain("besides '/', '@'");
    expect((await e.run(CREATE.replace('tienda-db', '1tienda'))).stderr).toContain('Invalid DB Instance identifier');
    expect((await e.run(CREATE.replace('allocated-storage 20', 'allocated-storage 5'))).stderr).toContain('Invalid storage size');
    expect((await e.run(CREATE.replace('db.t3.micro', 'db.x9.mega'))).stderr).toContain('does not support creating a DB instance');
    expect((await e.run(CREATE.replace('mysql', 'oracle'))).stderr).toContain('Invalid DB engine');
    expect((await e.run(CREATE.replace('mysql', 'postgres'))).stderr).toContain("reserved word used by the engine");
    expect((await e.run(CREATE.replace(' --allocated-storage 20', ''))).stderr).toContain('AllocatedStorage');
    expect((await e.run(CREATE.replace('--master-user-password Secreta123', ''))).stderr).toContain('MasterUserPassword');
    expect((await run('--db-subnet-group-name nada')).stderr).toContain('DBSubnetGroup');
    expect((await run('--vpc-security-group-ids sg-000')).stderr).toContain('Invalid security group');
    expect((await run('--multi-az')).code).toBe(0);
    const m = (await e.json('rds describe-db-instances --db-instance-identifier x1')).DBInstances[0];
    expect(m.MultiAZ).toBe(true);
    expect(m.SecondaryAvailabilityZone).toBeTruthy();
    expect(m.SecondaryAvailabilityZone).not.toBe(m.AvailabilityZone);
  });

  test('modify: clase, disco que no se reduce, Multi-AZ y cambios pendientes', async () => {
    const e = mkEnv();
    await e.run(CREATE);
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    expect((await e.run('rds modify-db-instance --db-instance-identifier tienda-db --allocated-storage 10 --apply-immediately')).stderr).toContain('storage can\'t be reduced');
    // sin --apply-immediately el cambio queda pendiente
    const p = (await e.json('rds modify-db-instance --db-instance-identifier tienda-db --db-instance-class db.t3.small')).DBInstance;
    expect(p.PendingModifiedValues.DBInstanceClass).toBe('db.t3.small');
    expect(p.DBInstanceClass).toBe('db.t3.micro');
    // con --apply-immediately: modifying → available con el cambio aplicado
    const m = (await e.json('rds modify-db-instance --db-instance-identifier tienda-db --multi-az --allocated-storage 50 --apply-immediately')).DBInstance;
    expect(m.DBInstanceStatus).toBe('modifying');
    expect((await e.run('rds modify-db-instance --db-instance-identifier tienda-db --multi-az')).stderr).toContain('not in available state');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const d = (await e.json('rds describe-db-instances --db-instance-identifier tienda-db')).DBInstances[0];
    expect([d.MultiAZ, d.AllocatedStorage, d.DBInstanceClass]).toEqual([true, 50, 'db.t3.small']);
  });

  test('reinicio con failover cambia de zona (solo Multi-AZ)', async () => {
    const e = mkEnv();
    await e.run(CREATE + ' --multi-az');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const before = (await e.json('rds describe-db-instances --db-instance-identifier tienda-db')).DBInstances[0];
    await e.run('rds reboot-db-instance --db-instance-identifier tienda-db --force-failover');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const after = (await e.json('rds describe-db-instances --db-instance-identifier tienda-db')).DBInstances[0];
    expect(after.AvailabilityZone).toBe(before.SecondaryAvailabilityZone);
    expect(after.SecondaryAvailabilityZone).toBe(before.AvailabilityZone);
    await e.run('rds modify-db-instance --db-instance-identifier tienda-db --no-multi-az --apply-immediately');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    expect((await e.run('rds reboot-db-instance --db-instance-identifier tienda-db --force-failover')).stderr).toContain('Non-MultiAZ');
  });

  test('parar, arrancar y borrar con copia final', async () => {
    const e = mkEnv();
    await e.run(CREATE);
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    await e.run('rds stop-db-instance --db-instance-identifier tienda-db');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db').catch(() => undefined);
    e.acct.clock += 30000;
    expect((await e.json('rds describe-db-instances --db-instance-identifier tienda-db --query DBInstances[0].DBInstanceStatus')) as string).toBe('stopped');
    await e.run('rds start-db-instance --db-instance-identifier tienda-db');
    e.acct.clock += 60000;
    // borrar: hay que elegir la copia final
    expect((await e.run('rds delete-db-instance --db-instance-identifier tienda-db')).stderr).toContain('FinalDBSnapshotIdentifier is required');
    expect((await e.run('rds delete-db-instance --db-instance-identifier tienda-db --skip-final-snapshot --final-db-snapshot-identifier x')).stderr).toContain('can not be specified');
    await e.run('rds modify-db-instance --db-instance-identifier tienda-db --deletion-protection');
    expect((await e.run('rds delete-db-instance --db-instance-identifier tienda-db --skip-final-snapshot')).stderr).toContain('deletion protection');
    await e.run('rds modify-db-instance --db-instance-identifier tienda-db --no-deletion-protection');
    await e.run('rds delete-db-instance --db-instance-identifier tienda-db --final-db-snapshot-identifier tienda-final');
    await e.run('rds wait db-instance-deleted --db-instance-identifier tienda-db');
    expect(await e.json('rds describe-db-instances --query "length(DBInstances)"')).toBe(0);
    e.acct.clock += 60000;
    expect(await e.json('rds describe-db-snapshots --query "DBSnapshots[].[DBSnapshotIdentifier,Status,SnapshotType]"')).toEqual([['tienda-final', 'available', 'manual']]);
  });
});

describe('RDS: copias, réplicas y subredes', () => {
  test('snapshot y restauración crean una instancia nueva', async () => {
    const e = mkEnv();
    await e.run(CREATE);
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const sn = (await e.json('rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier antes-del-cambio')).DBSnapshot;
    expect(sn.Status).toBe('creating');
    expect((await e.run('rds create-db-snapshot --db-instance-identifier tienda-db --db-snapshot-identifier antes-del-cambio')).stderr).toContain('DBSnapshotAlreadyExists');
    expect((await e.run('rds restore-db-instance-from-db-snapshot --db-instance-identifier copia --db-snapshot-identifier antes-del-cambio')).stderr).toContain('InvalidDBSnapshotState');
    await e.run('rds wait db-snapshot-available --db-snapshot-identifier antes-del-cambio');
    const r = (await e.json('rds restore-db-instance-from-db-snapshot --db-instance-identifier copia --db-snapshot-identifier antes-del-cambio --db-instance-class db.t3.small')).DBInstance;
    expect([r.DBInstanceIdentifier, r.DBInstanceClass, r.DBInstanceStatus]).toEqual(['copia', 'db.t3.small', 'creating']);
    expect(await e.json('rds describe-db-instances --query "length(DBInstances)"')).toBe(2);
    await e.run('rds delete-db-snapshot --db-snapshot-identifier antes-del-cambio');
    expect((await e.run('rds delete-db-snapshot --db-snapshot-identifier antes-del-cambio')).stderr).toContain('DBSnapshotNotFound');
  });

  test('réplicas de lectura: requisitos, promoción', async () => {
    const e = mkEnv();
    await e.run(CREATE + ' --backup-retention-period 0');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    expect((await e.run('rds create-db-instance-read-replica --db-instance-identifier lectura --source-db-instance-identifier tienda-db')).stderr).toContain('Automated backups are not enabled');
    await e.run('rds modify-db-instance --db-instance-identifier tienda-db --backup-retention-period 7 --apply-immediately');
    await e.run('rds wait db-instance-available --db-instance-identifier tienda-db');
    const r = (await e.json('rds create-db-instance-read-replica --db-instance-identifier lectura --source-db-instance-identifier tienda-db')).DBInstance;
    expect(r.ReadReplicaSourceDBInstanceIdentifier).toBe('tienda-db');
    expect((await e.json('rds describe-db-instances --db-instance-identifier tienda-db --query "DBInstances[0].ReadReplicaDBInstanceIdentifiers"'))).toEqual(['lectura']);
    await e.run('rds wait db-instance-available --db-instance-identifier lectura');
    expect((await e.run('rds stop-db-instance --db-instance-identifier tienda-db')).stderr).toContain('read replica');
    await e.run('rds promote-read-replica --db-instance-identifier lectura');
    await e.run('rds wait db-instance-available --db-instance-identifier lectura');
    expect((await e.json('rds describe-db-instances --db-instance-identifier lectura --query "DBInstances[0].ReadReplicaSourceDBInstanceIdentifier"'))).toBeNull();
  });

  test('grupo de subredes: necesita 2 zonas', async () => {
    const e = mkEnv();
    const vpc = (await e.json('ec2 create-vpc --cidr-block 10.0.0.0/16')).Vpc.VpcId;
    const a = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.0.1.0/24 --availability-zone us-east-1a`)).Subnet.SubnetId;
    const b = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.0.2.0/24 --availability-zone us-east-1a`)).Subnet.SubnetId;
    const c = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.0.3.0/24 --availability-zone us-east-1b`)).Subnet.SubnetId;
    expect((await e.run(`rds create-db-subnet-group --db-subnet-group-name datos --db-subnet-group-description x --subnet-ids ${a} ${b}`)).stderr).toContain('DBSubnetGroupDoesNotCoverEnoughAZs');
    expect((await e.run(`rds create-db-subnet-group --db-subnet-group-name datos --db-subnet-group-description x --subnet-ids ${a} ${c}`)).code).toBe(0);
    const sg = (await e.json(`ec2 create-security-group --group-name db-sg --description x --vpc-id ${vpc}`)).GroupId;
    const r = (await e.json(`rds create-db-instance --db-instance-identifier privada --db-instance-class db.t3.micro --engine postgres --master-username dba --master-user-password Secreta123 --allocated-storage 20 --db-subnet-group-name datos --vpc-security-group-ids ${sg} --no-publicly-accessible --multi-az`)).DBInstance;
    expect(r.PubliclyAccessible).toBe(false);
    expect(r.DBSubnetGroup.VpcId).toBe(vpc);
    expect((await e.run('rds delete-db-subnet-group --db-subnet-group-name datos')).stderr).toContain('still using it');
    // el grupo de seguridad tiene que ser de la misma VPC
    const other = (await e.json('ec2 describe-security-groups --filters Name=group-name,Values=default --query "SecurityGroups[0].GroupId"')) as string;
    expect((await e.run(`rds create-db-instance --db-instance-identifier otra --db-instance-class db.t3.micro --engine mysql --master-username dba --master-user-password Secreta123 --allocated-storage 20 --db-subnet-group-name datos --vpc-security-group-ids ${other}`)).stderr).toMatch(/does not belong to the VPC|Invalid security group/);
  });
});

describe('Aurora', () => {
  test('clúster con escritor y lector, endpoints y failover', async () => {
    const e = mkEnv();
    expect((await e.run('rds create-db-instance --db-instance-identifier a1 --db-instance-class db.r5.large --engine aurora-mysql --master-username admin --master-user-password Secreta123')).stderr).toContain('DB cluster identifier is required');
    const k = (await e.json('rds create-db-cluster --db-cluster-identifier miaurora --engine aurora-mysql --master-username admin --master-user-password Secreta123')).DBCluster;
    expect(k.Status).toBe('creating');
    await e.run('rds create-db-instance --db-instance-identifier aurora-1 --db-instance-class db.r5.large --engine aurora-mysql --db-cluster-identifier miaurora');
    await e.run('rds create-db-instance --db-instance-identifier aurora-2 --db-instance-class db.r5.large --engine aurora-mysql --db-cluster-identifier miaurora');
    await e.run('rds wait db-cluster-available --db-cluster-identifier miaurora');
    const d = (await e.json('rds describe-db-clusters --db-cluster-identifier miaurora')).DBClusters[0];
    expect(d.Endpoint).toMatch(/^miaurora\.cluster-/);
    expect(d.ReaderEndpoint).toMatch(/^miaurora\.cluster-ro-/);
    expect(d.DBClusterMembers.map((m: any) => [m.DBInstanceIdentifier, m.IsClusterWriter])).toEqual([['aurora-1', true], ['aurora-2', false]]);
    await e.run('rds failover-db-cluster --db-cluster-identifier miaurora');
    expect((await e.json('rds describe-db-clusters --db-cluster-identifier miaurora --query "DBClusters[0].DBClusterMembers[?IsClusterWriter].DBInstanceIdentifier"'))).toEqual(['aurora-2']);
    expect((await e.run('rds delete-db-cluster --db-cluster-identifier miaurora --skip-final-snapshot')).stderr).toContain('still contains DB instances');
  });
});
