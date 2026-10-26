import { mkEnv } from './helpers';
import { imageId } from '../catalog';

const AMI = imageId('us-east-1', 'al2023-x86');

describe('EC2: catálogos', () => {
  test('regiones y zonas', async () => {
    const e = mkEnv();
    const regs = await e.json('ec2 describe-regions --query "Regions[].RegionName"');
    expect(regs).toContain('eu-west-1');
    expect(regs).not.toContain('af-south-1');
    expect(await e.json('ec2 describe-regions --all-regions --query "Regions[?OptInStatus==\'not-opted-in\'].RegionName"')).toEqual(['af-south-1', 'ap-east-1']);
    const az = await e.json('ec2 describe-availability-zones --query "AvailabilityZones[].ZoneName" --region eu-west-1');
    expect(az).toEqual(['eu-west-1a', 'eu-west-1b', 'eu-west-1c']);
    const bad = await e.run('ec2 describe-regions --region-names mars-1');
    expect(bad.stderr).toContain('Invalid region');
  });

  test('imágenes y tipos de instancia', async () => {
    const e = mkEnv();
    const imgs = await e.json('ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-2023*-x86_64" --query "Images[].ImageId"');
    expect(imgs).toEqual([AMI]);
    const t = await e.json('ec2 describe-instance-types --instance-types t3.micro --query "InstanceTypes[0].[InstanceType,VCpuInfo.DefaultVCpus,MemoryInfo.SizeInMiB]"');
    expect(t).toEqual(['t3.micro', 2, 1024]);
    const free = await e.json('ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query "InstanceTypes[].InstanceType"');
    expect(free).toEqual(expect.arrayContaining(['t2.micro', 't3.micro']));
    expect((await e.run('ec2 describe-instance-types --instance-types t9.mega')).stderr).toContain('InvalidInstanceType');
  });
});

describe('EC2: instancias', () => {
  test('lanzar, esperar, consultar y terminar', async () => {
    const e = mkEnv();
    const r = await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=web}]"`);
    const id = r.Instances[0].InstanceId;
    expect(id).toMatch(/^i-[0-9a-f]{17}$/);
    expect(r.Instances[0].State.Name).toBe('pending');
    expect(r.Instances[0].PublicIpAddress).toBeUndefined();
    expect(r.Instances[0].Tags).toEqual([{ Key: 'Name', Value: 'web' }]);
    // todavía pending
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].State.Name"`)).toBe('pending');
    const w = await e.run(`ec2 wait instance-running --instance-ids ${id}`);
    expect(w.code).toBe(0);
    const d = await e.json(`ec2 describe-instances --instance-ids ${id}`);
    const inst = d.Reservations[0].Instances[0];
    expect(inst.State.Name).toBe('running');
    expect(inst.PublicIpAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(inst.PublicDnsName).toMatch(/^ec2-\d+-\d+-\d+-\d+\.compute-1\.amazonaws\.com$/);
    expect(inst.PrivateIpAddress).toMatch(/^172\.31\./);
    expect(inst.BlockDeviceMappings[0].DeviceName).toBe('/dev/xvda');
    // filtros
    expect(await e.json('ec2 describe-instances --filters Name=tag:Name,Values=web Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId"')).toEqual([id]);
    expect(await e.json('ec2 describe-instances --filters Name=instance-state-name,Values=stopped --query "Reservations[].Instances[].InstanceId"')).toEqual([]);
    // parar
    const stop = await e.json(`ec2 stop-instances --instance-ids ${id}`);
    expect(stop.StoppingInstances[0]).toEqual({ InstanceId: id, CurrentState: { Code: 64, Name: 'stopping' }, PreviousState: { Code: 16, Name: 'running' } });
    await e.run(`ec2 wait instance-stopped --instance-ids ${id}`);
    const st = (await e.json(`ec2 describe-instances --instance-ids ${id}`)).Reservations[0].Instances[0];
    expect(st.State.Name).toBe('stopped');
    expect(st.PublicIpAddress).toBeUndefined();
    // cambiar de tipo (parada) y arrancar
    await e.run(`ec2 modify-instance-attribute --instance-id ${id} --instance-type "{\\"Value\\": \\"t3.small\\"}"`);
    expect(await e.json(`ec2 describe-instance-attribute --instance-id ${id} --attribute instanceType --query InstanceType.Value`)).toBe('t3.small');
    await e.run(`ec2 start-instances --instance-ids ${id}`);
    await e.run(`ec2 wait instance-running --instance-ids ${id}`);
    // terminar
    const t = await e.json(`ec2 terminate-instances --instance-ids ${id}`);
    expect(t.TerminatingInstances[0].CurrentState.Name).toBe('shutting-down');
    await e.run(`ec2 wait instance-terminated --instance-ids ${id}`);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].State.Name"`)).toBe('terminated');
    // el disco raíz se borra con la instancia
    expect(await e.json('ec2 describe-volumes --query "Volumes[].VolumeId"')).toEqual([]);
  });

  test('errores habituales al lanzar', async () => {
    const e = mkEnv();
    let r = await e.run('ec2 run-instances --image-id ami-00000000000000000 --instance-type t3.micro');
    expect(r.stderr).toContain('(InvalidAMIID.NotFound)');
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t9.mega`);
    expect(r.stderr).toContain("Invalid value 't9.mega' for InstanceType");
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t4g.micro`);
    expect(r.stderr).toContain("The architecture 'arm64' of the specified instance type does not match the architecture 'x86_64'");
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --key-name no-existe`);
    expect(r.stderr).toContain("(InvalidKeyPair.NotFound) when calling the RunInstances operation: The key pair 'no-existe' does not exist");
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --security-group-ids sg-0123456789abcdef0`);
    expect(r.stderr).toContain('InvalidGroup.NotFound');
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --iam-instance-profile Name=nada`);
    expect(r.stderr).toContain('Invalid IAM Instance Profile name');
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --dry-run`);
    expect(r.stderr).toContain('(DryRunOperation) when calling the RunInstances operation: Request would have succeeded, but DryRun flag is set.');
    r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type m5.xlarge --count 9`);
    expect(r.stderr).toContain('VcpuLimitExceeded');
  });

  test('protección contra terminación y estados incorrectos', async () => {
    const e = mkEnv();
    const id = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --disable-api-termination`)).Instances[0].InstanceId;
    expect((await e.run(`ec2 terminate-instances --instance-ids ${id}`)).stderr).toContain('(OperationNotPermitted)');
    await e.run(`ec2 modify-instance-attribute --instance-id ${id} --no-disable-api-termination`);
    expect((await e.run(`ec2 terminate-instances --instance-ids ${id}`)).code).toBe(0);
    expect((await e.run(`ec2 start-instances --instance-ids i-0123456789abcdef0`)).stderr).toContain('InvalidInstanceID.NotFound');
    // cambiar de tipo con la instancia encendida
    const id2 = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro`)).Instances[0].InstanceId;
    expect((await e.run(`ec2 modify-instance-attribute --instance-id ${id2} --instance-type Value=t3.large`)).stderr).toContain('IncorrectInstanceState');
  });

  test('varias instancias con --count y reservación común', async () => {
    const e = mkEnv();
    const r = await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --count 3`);
    expect(r.Instances).toHaveLength(3);
    expect(new Set(r.Instances.map((i: any) => i.InstanceId)).size).toBe(3);
    const all = await e.json('ec2 describe-instances');
    expect(all.Reservations).toHaveLength(1);
    expect(await e.json('ec2 describe-instances --query "length(Reservations[].Instances[])"')).toBe(3);
  });

  test('region distinta: cada región tiene su propio estado', async () => {
    const e = mkEnv();
    await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro`);
    expect(await e.json('ec2 describe-instances --query "length(Reservations)" --region eu-west-1')).toBe(0);
    // la AMI de Virginia no existe en Irlanda
    const r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --region eu-west-1`);
    expect(r.stderr).toContain('InvalidAMIID.NotFound');
    const eu = imageId('eu-west-1', 'al2023-x86');
    expect(eu).not.toBe(AMI);
    expect((await e.run(`ec2 run-instances --image-id ${eu} --instance-type t3.micro --region eu-west-1`)).code).toBe(0);
  });
});

describe('EC2: claves y grupos de seguridad', () => {
  test('pares de claves', async () => {
    const e = mkEnv();
    const k = await e.json('ec2 create-key-pair --key-name mi-clave');
    expect(k.KeyMaterial).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n[\s\S]+\n-----END RSA PRIVATE KEY-----$/);
    expect(k.KeyName).toBe('mi-clave');
    expect((await e.run('ec2 create-key-pair --key-name mi-clave')).stderr).toContain('InvalidKeyPair.Duplicate');
    const text = await e.run('ec2 create-key-pair --key-name otra --query KeyMaterial --output text');
    expect(text.stdout.startsWith('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(await e.json('ec2 describe-key-pairs --query "KeyPairs[].KeyName"')).toEqual(['mi-clave', 'otra']);
    const d = await e.json('ec2 describe-key-pairs --key-names mi-clave');
    expect(d.KeyPairs[0]).not.toHaveProperty('KeyMaterial');
    await e.run('ec2 delete-key-pair --key-name otra');
    expect(await e.json('ec2 describe-key-pairs --query "KeyPairs[].KeyName"')).toEqual(['mi-clave']);
  });

  test('crear un grupo y abrir SSH', async () => {
    const e = mkEnv();
    const g = await e.json('ec2 create-security-group --group-name web --description "Servidor web"');
    expect(g.GroupId).toMatch(/^sg-[0-9a-f]{17}$/);
    expect((await e.run('ec2 create-security-group --group-name web --description x')).stderr).toContain('InvalidGroup.Duplicate');
    const rule = await e.json(`ec2 authorize-security-group-ingress --group-id ${g.GroupId} --protocol tcp --port 22 --cidr 203.0.113.0/24`);
    expect(rule.Return).toBe(true);
    expect(rule.SecurityGroupRules[0]).toMatchObject({ IsEgress: false, IpProtocol: 'tcp', FromPort: 22, ToPort: 22, CidrIpv4: '203.0.113.0/24' });
    const dup = await e.run(`ec2 authorize-security-group-ingress --group-id ${g.GroupId} --protocol tcp --port 22 --cidr 203.0.113.0/24`);
    expect(dup.stderr).toContain('(InvalidPermission.Duplicate)');
    expect(dup.stderr).toContain('peer: 203.0.113.0/24, TCP, from port: 22, to port: 22, ALLOW');
    await e.run(`ec2 authorize-security-group-ingress --group-id ${g.GroupId} --ip-permissions IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges="[{CidrIp=0.0.0.0/0,Description=http}]"`);
    const sg = await e.json(`ec2 describe-security-groups --group-ids ${g.GroupId}`);
    expect(sg.SecurityGroups[0].IpPermissions.map((p: any) => p.FromPort).sort()).toEqual([22, 80]);
    expect(await e.json(`ec2 describe-security-groups --filters Name=ip-permission.from-port,Values=22 --query "SecurityGroups[].GroupName"`)).toEqual(['web']);
    expect((await e.run(`ec2 authorize-security-group-ingress --group-id ${g.GroupId} --protocol tcp --port 22 --cidr 999.1.1.1/24`)).stderr).toContain('Invalid CIDR');
    await e.run(`ec2 revoke-security-group-ingress --group-id ${g.GroupId} --protocol tcp --port 22 --cidr 203.0.113.0/24`);
    expect((await e.run(`ec2 revoke-security-group-ingress --group-id ${g.GroupId} --protocol tcp --port 22 --cidr 203.0.113.0/24`)).stderr).toContain('InvalidPermission.NotFound');
    // usarlo al lanzar
    const i = await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --security-group-ids ${g.GroupId}`);
    expect(i.Instances[0].SecurityGroups).toEqual([{ GroupName: 'web', GroupId: g.GroupId }]);
    expect((await e.run(`ec2 delete-security-group --group-id ${g.GroupId}`)).stderr).toContain('(DependencyViolation)');
    const def = await e.json('ec2 describe-security-groups --filters Name=group-name,Values=default --query "SecurityGroups[0].GroupId"');
    expect((await e.run(`ec2 delete-security-group --group-id ${def}`)).stderr).toContain('(CannotDelete)');
  });
});

describe('EC2: discos, snapshots e IP elásticas', () => {
  test('volúmenes: crear, adjuntar en la misma zona, ampliar, snapshot', async () => {
    const e = mkEnv();
    const i = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro`)).Instances[0];
    await e.run(`ec2 wait instance-running --instance-ids ${i.InstanceId}`);
    const az = i.Placement.AvailabilityZone;
    const other = az === 'us-east-1a' ? 'us-east-1b' : 'us-east-1a';
    const bad = await e.json(`ec2 create-volume --availability-zone ${other} --size 10 --volume-type gp3`);
    await e.run(`ec2 wait volume-available --volume-ids ${bad.VolumeId}`);
    expect((await e.run(`ec2 attach-volume --volume-id ${bad.VolumeId} --instance-id ${i.InstanceId} --device /dev/sdf`)).stderr).toContain('InvalidVolume.ZoneMismatch');
    const v = await e.json(`ec2 create-volume --availability-zone ${az} --size 20 --volume-type gp3`);
    await e.run(`ec2 wait volume-available --volume-ids ${v.VolumeId}`);
    const at = await e.json(`ec2 attach-volume --volume-id ${v.VolumeId} --instance-id ${i.InstanceId} --device /dev/sdf`);
    expect(at.State).toBe('attaching');
    expect((await e.run(`ec2 attach-volume --volume-id ${v.VolumeId} --instance-id ${i.InstanceId} --device /dev/sdg`)).stderr).toContain('VolumeInUse');
    expect((await e.run(`ec2 delete-volume --volume-id ${v.VolumeId}`)).stderr).toContain('(VolumeInUse)');
    expect((await e.json(`ec2 modify-volume --volume-id ${v.VolumeId} --size 40`)).VolumeModification.TargetSize).toBe(40);
    expect((await e.run(`ec2 modify-volume --volume-id ${v.VolumeId} --size 10`)).stderr).toContain('smaller');
    const snap = await e.json(`ec2 create-snapshot --volume-id ${v.VolumeId} --description copia`);
    expect(snap.SnapshotId).toMatch(/^snap-/);
    expect(snap.VolumeSize).toBe(40);
    await e.run(`ec2 detach-volume --volume-id ${v.VolumeId}`);
    expect((await e.run(`ec2 delete-volume --volume-id ${v.VolumeId}`)).code).toBe(0);
    // restaurar desde el snapshot
    const back = await e.json(`ec2 create-volume --availability-zone ${az} --snapshot-id ${snap.SnapshotId}`);
    expect(back.Size).toBe(40);
    expect((await e.run(`ec2 create-volume --availability-zone ${az} --size 20000 --volume-type gp3`)).stderr).toContain('too large');
    expect((await e.run(`ec2 create-volume --availability-zone ${az} --size 10 --volume-type io1`)).stderr).toContain('iops');
    expect((await e.run(`ec2 create-volume --availability-zone eu-west-1a --size 10`)).stderr).toContain('availabilityZone');
  });

  test('IP elástica: sobrevive a parar la instancia', async () => {
    const e = mkEnv();
    const id = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro`)).Instances[0].InstanceId;
    await e.run(`ec2 wait instance-running --instance-ids ${id}`);
    const eip = await e.json('ec2 allocate-address');
    const as = await e.json(`ec2 associate-address --allocation-id ${eip.AllocationId} --instance-id ${id}`);
    expect(as.AssociationId).toMatch(/^eipassoc-/);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].PublicIpAddress"`)).toBe(eip.PublicIp);
    await e.run(`ec2 stop-instances --instance-ids ${id}`);
    await e.run(`ec2 wait instance-stopped --instance-ids ${id}`);
    await e.run(`ec2 start-instances --instance-ids ${id}`);
    await e.run(`ec2 wait instance-running --instance-ids ${id}`);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].PublicIpAddress"`)).toBe(eip.PublicIp);
    expect((await e.run(`ec2 release-address --allocation-id ${eip.AllocationId}`)).stderr).toContain('InvalidIPAddress.InUse');
    await e.run(`ec2 disassociate-address --association-id ${as.AssociationId}`);
    expect((await e.run(`ec2 release-address --allocation-id ${eip.AllocationId}`)).code).toBe(0);
  });

  test('etiquetas', async () => {
    const e = mkEnv();
    const id = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro`)).Instances[0].InstanceId;
    await e.run(`ec2 create-tags --resources ${id} --tags Key=Name,Value=api Key=entorno,Value=prueba`);
    expect(await e.json(`ec2 describe-instances --instance-ids ${id} --query "Reservations[0].Instances[0].Tags[?Key=='Name'].Value"`)).toEqual(['api']);
    await e.run(`ec2 delete-tags --resources ${id} --tags Key=entorno`);
    expect(await e.json('ec2 describe-tags --query "Tags[].Key"')).toEqual(['Name']);
    expect((await e.run('ec2 create-tags --resources i-0123456789abcdef0 --tags Key=a,Value=b')).stderr).toContain('InvalidInstanceID.NotFound');
  });
});

describe('EC2: permisos', () => {
  test('RunInstances necesita permisos sobre varios recursos y respeta ec2:InstanceType', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const only = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: 'ec2:RunInstances', Resource: ['arn:aws:ec2:*:*:instance/*'], Condition: { StringEquals: { 'ec2:InstanceType': 't3.micro' } } },
      ],
    });
    await e.run(`iam put-user-policy --user-name bob --policy-name solo-instancia --policy-document '${only}'`);
    // faltan imagen, volumen y red: se deniega aunque el tipo sea el permitido
    const r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --profile bob`);
    expect(r.stderr).toContain('(UnauthorizedOperation) when calling the RunInstances operation: You are not authorized to perform this operation.');
    expect(r.stderr).toContain('Encoded authorization failure message');
    const full = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: 'ec2:RunInstances', Resource: ['arn:aws:ec2:*:*:instance/*'], Condition: { StringEquals: { 'ec2:InstanceType': 't3.micro' } } },
        { Effect: 'Allow', Action: 'ec2:RunInstances', Resource: ['arn:aws:ec2:*::image/*', 'arn:aws:ec2:*:*:network-interface/*', 'arn:aws:ec2:*:*:volume/*', 'arn:aws:ec2:*:*:security-group/*', 'arn:aws:ec2:*:*:subnet/*', 'arn:aws:ec2:*:*:key-pair/*'] },
      ],
    });
    await e.run(`iam put-user-policy --user-name bob --policy-name solo-instancia --policy-document '${full}'`);
    expect((await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --profile bob`)).code).toBe(0);
    const big = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type m5.large --profile bob`);
    expect(big.stderr).toContain('UnauthorizedOperation');
    // las lecturas siguen denegadas: no tiene ec2:Describe*
    expect((await e.run('ec2 describe-instances --profile bob')).stderr).toContain('UnauthorizedOperation');
    // y el mensaje se puede descifrar
    const enc = /Encoded authorization failure message: (\S+)/.exec((await e.run('ec2 describe-instances --profile bob')).stderr)![1];
    const dec = await e.json(`sts decode-authorization-message --encoded-message ${enc}`);
    expect(JSON.parse(dec.DecodedMessage).context.action).toBe('ec2:DescribeInstances');
  });

  test('perfil de instancia: hace falta iam:PassRole', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    await e.run('iam create-instance-profile --instance-profile-name ServidorWeb');
    await e.run('iam add-role-to-instance-profile --instance-profile-name ServidorWeb --role-name ServidorWeb');
    const ec2only = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ec2:*', Resource: '*' }] });
    await e.run(`iam put-user-policy --user-name bob --policy-name ec2 --policy-document '${ec2only}'`);
    const r = await e.run(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --iam-instance-profile Name=ServidorWeb --profile bob`);
    expect(r.stderr).toContain('iam:PassRole');
    const pass = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'iam:PassRole', Resource: 'arn:aws:iam::123456789012:role/ServidorWeb' }] });
    await e.run(`iam put-user-policy --user-name bob --policy-name pass --policy-document '${pass}'`);
    const ok = await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --iam-instance-profile Name=ServidorWeb --profile bob`);
    expect(ok.Instances[0].IamInstanceProfile.Arn).toBe('arn:aws:iam::123456789012:instance-profile/ServidorWeb');
  });

  test('condición por etiqueta: solo parar instancias propias', async () => {
    const e = mkEnv({ scenario: 'equipo' });
    const a = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --tag-specifications "ResourceType=instance,Tags=[{Key=equipo,Value=web}]"`)).Instances[0].InstanceId;
    const b = (await e.json(`ec2 run-instances --image-id ${AMI} --instance-type t3.micro --tag-specifications "ResourceType=instance,Tags=[{Key=equipo,Value=datos}]"`)).Instances[0].InstanceId;
    const pol = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: ['ec2:StopInstances', 'ec2:StartInstances'], Resource: '*', Condition: { StringEquals: { 'ec2:ResourceTag/equipo': '${aws:PrincipalTag/equipo}' } } }] });
    await e.run(`iam put-user-policy --user-name ana --policy-name mi-equipo --policy-document '${pol}'`);
    await e.run(`ec2 wait instance-running --instance-ids ${a} ${b}`);
    expect((await e.run(`ec2 stop-instances --instance-ids ${a} --profile ana`)).code).toBe(0);
    expect((await e.run(`ec2 stop-instances --instance-ids ${b} --profile ana`)).stderr).toContain('UnauthorizedOperation');
  });
});
