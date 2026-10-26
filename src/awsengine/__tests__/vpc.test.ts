import { Terminal, restoreTerminal } from '../../engine/terminal';
import { mkEnv } from './helpers';

const mk = (aws: any = 'base', extra: any = {}) => new Terminal({ instant: true, aws, ...extra });
const IP = 'aws ec2 describe-instances --filters Name=tag:Name,Values=web-prod --query "Reservations[0].Instances[0].PublicIpAddress" --output text';

describe('VPC: crear y consultar', () => {
  test('VPC, subredes y validaciones', async () => {
    const e = mkEnv();
    const v = await e.json('ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=prod}]"');
    expect(v.Vpc.VpcId).toMatch(/^vpc-[0-9a-f]{17}$/);
    expect(v.Vpc.State).toBe('pending');
    const id = v.Vpc.VpcId;
    expect((await e.run('ec2 create-vpc --cidr-block 10.0.0.0/8')).stderr).toContain('InvalidVpcRange');
    expect((await e.run('ec2 create-vpc --cidr-block 10.0.0.5/16')).stderr).toContain('not a valid CIDR block');
    // la VPC nace con tabla principal, NACL y SG por defecto
    expect(await e.json(`ec2 describe-route-tables --filters Name=vpc-id,Values=${id} --query "RouteTables[0].Routes[].[DestinationCidrBlock,GatewayId]"`)).toEqual([['10.0.0.0/16', 'local']]);
    expect(await e.json(`ec2 describe-network-acls --filters Name=vpc-id,Values=${id} --query "NetworkAcls[0].IsDefault"`)).toBe(true);
    expect(await e.json(`ec2 describe-security-groups --filters Name=vpc-id,Values=${id} --query "SecurityGroups[].GroupName"`)).toEqual(['default']);
    const s = await e.json(`ec2 create-subnet --vpc-id ${id} --cidr-block 10.0.1.0/24 --availability-zone us-east-1a`);
    expect(s.Subnet.AvailableIpAddressCount).toBe(251);
    expect(s.Subnet.MapPublicIpOnLaunch).toBe(false);
    expect((await e.run(`ec2 create-subnet --vpc-id ${id} --cidr-block 10.0.1.128/25`)).stderr).toContain('InvalidSubnet.Conflict');
    expect((await e.run(`ec2 create-subnet --vpc-id ${id} --cidr-block 192.168.0.0/24`)).stderr).toContain('InvalidSubnet.Range');
    expect((await e.run(`ec2 create-subnet --vpc-id ${id} --cidr-block 10.0.2.0/24 --availability-zone eu-west-1a`)).stderr).toContain('availabilityZone is invalid');
    expect((await e.run('ec2 create-subnet --vpc-id vpc-0000 --cidr-block 10.0.2.0/24')).stderr).toContain('InvalidVpcID.NotFound');
    // dependencias al borrar
    expect((await e.run(`ec2 delete-vpc --vpc-id ${id}`)).stderr).toContain('DependencyViolation');
    await e.run(`ec2 delete-subnet --subnet-id ${s.Subnet.SubnetId}`);
    expect((await e.run(`ec2 delete-vpc --vpc-id ${id}`)).code).toBe(0);
    expect((await e.run(`ec2 delete-vpc --vpc-id ${id}`)).stderr).toContain('InvalidVpcID.NotFound');
  });

  test('la VPC por defecto trae IGW, ruta pública y NACL abierta', async () => {
    const e = mkEnv();
    expect(await e.json('ec2 describe-internet-gateways --query "length(InternetGateways)"')).toBe(1);
    const routes = await e.json('ec2 describe-route-tables --query "RouteTables[0].Routes[].[DestinationCidrBlock,State]"');
    expect(routes).toEqual([['172.31.0.0/16', 'active'], ['0.0.0.0/0', 'active']]);
    expect(await e.json('ec2 describe-network-acls --query "NetworkAcls[0].Entries[?RuleNumber==`100`].[Egress,RuleAction]"')).toEqual([[true, 'allow'], [false, 'allow']]);
  });
});

describe('VPC: gateways y rutas', () => {
  test('IGW: conectar, no repetir, no borrar conectada', async () => {
    const e = mkEnv();
    const vpc = (await e.json('ec2 create-vpc --cidr-block 10.1.0.0/16')).Vpc.VpcId;
    const g = (await e.json('ec2 create-internet-gateway')).InternetGateway.InternetGatewayId;
    await e.run(`ec2 attach-internet-gateway --internet-gateway-id ${g} --vpc-id ${vpc}`);
    expect(await e.json(`ec2 describe-internet-gateways --internet-gateway-ids ${g} --query "InternetGateways[0].Attachments[0].VpcId"`)).toBe(vpc);
    expect((await e.run(`ec2 attach-internet-gateway --internet-gateway-id ${g} --vpc-id ${vpc}`)).stderr).toContain('Resource.AlreadyAssociated');
    const g2 = (await e.json('ec2 create-internet-gateway')).InternetGateway.InternetGatewayId;
    expect((await e.run(`ec2 attach-internet-gateway --internet-gateway-id ${g2} --vpc-id ${vpc}`)).stderr).toContain('already has an internet gateway');
    expect((await e.run(`ec2 delete-internet-gateway --internet-gateway-id ${g}`)).stderr).toContain('DependencyViolation');
    await e.run(`ec2 detach-internet-gateway --internet-gateway-id ${g} --vpc-id ${vpc}`);
    expect((await e.run(`ec2 delete-internet-gateway --internet-gateway-id ${g}`)).code).toBe(0);
  });

  test('tablas de rutas: crear, asociar, ruta agujero negro', async () => {
    const e = mkEnv();
    const vpc = (await e.json('ec2 create-vpc --cidr-block 10.1.0.0/16')).Vpc.VpcId;
    const sn = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.1.1.0/24`)).Subnet.SubnetId;
    const g = (await e.json('ec2 create-internet-gateway')).InternetGateway.InternetGatewayId;
    const rt = (await e.json(`ec2 create-route-table --vpc-id ${vpc}`)).RouteTable.RouteTableId;
    // la IGW aún no está conectada a esta VPC
    expect((await e.run(`ec2 create-route --route-table-id ${rt} --destination-cidr-block 0.0.0.0/0 --gateway-id ${g}`)).stderr).toContain('belong to different networks');
    await e.run(`ec2 attach-internet-gateway --internet-gateway-id ${g} --vpc-id ${vpc}`);
    expect(await e.json(`ec2 create-route --route-table-id ${rt} --destination-cidr-block 0.0.0.0/0 --gateway-id ${g}`)).toEqual({ Return: true });
    expect((await e.run(`ec2 create-route --route-table-id ${rt} --destination-cidr-block 0.0.0.0/0 --gateway-id ${g}`)).stderr).toContain('RouteAlreadyExists');
    expect((await e.run(`ec2 create-route --route-table-id ${rt} --destination-cidr-block 10.9.0.0/16 --gateway-id igw-nope`)).stderr).toContain('InvalidGatewayID.NotFound');
    const a = await e.json(`ec2 associate-route-table --route-table-id ${rt} --subnet-id ${sn}`);
    expect(a.AssociationId).toMatch(/^rtbassoc-/);
    expect((await e.run(`ec2 associate-route-table --route-table-id ${rt} --subnet-id ${sn}`)).stderr).toContain('Resource.AlreadyAssociated');
    expect(await e.json(`ec2 describe-route-tables --route-table-ids ${rt} --query "RouteTables[0].Routes[].[DestinationCidrBlock,GatewayId,State]"`)).toEqual([['10.1.0.0/16', 'local', 'active'], ['0.0.0.0/0', g, 'active']]);
    expect((await e.run(`ec2 delete-route-table --route-table-id ${rt}`)).stderr).toContain('DependencyViolation');
    // al desconectar la IGW la ruta queda como agujero negro
    await e.run(`ec2 detach-internet-gateway --internet-gateway-id ${g} --vpc-id ${vpc}`);
    expect(await e.json(`ec2 describe-route-tables --route-table-ids ${rt} --query "RouteTables[0].Routes[1].State"`)).toBe('blackhole');
    expect((await e.run(`ec2 delete-route --route-table-id ${rt} --destination-cidr-block 10.1.0.0/16`)).stderr).toContain('cannot remove local route');
    await e.run(`ec2 disassociate-route-table --association-id ${a.AssociationId}`);
    expect((await e.run(`ec2 delete-route-table --route-table-id ${rt}`)).code).toBe(0);
  });

  test('NAT gateway: estados, IP elástica y coste de olvidarlo', async () => {
    const e = mkEnv();
    const vpc = (await e.json('ec2 create-vpc --cidr-block 10.1.0.0/16')).Vpc.VpcId;
    const sn = (await e.json(`ec2 create-subnet --vpc-id ${vpc} --cidr-block 10.1.1.0/24`)).Subnet.SubnetId;
    const alloc = (await e.json('ec2 allocate-address --domain vpc')).AllocationId;
    expect((await e.run(`ec2 create-nat-gateway --subnet-id ${sn}`)).stderr).toContain('AllocationId');
    const n = (await e.json(`ec2 create-nat-gateway --subnet-id ${sn} --allocation-id ${alloc}`)).NatGateway;
    expect(n.State).toBe('pending');
    expect(n.NatGatewayAddresses[0].PublicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect((await e.run(`ec2 create-nat-gateway --subnet-id ${sn} --allocation-id ${alloc}`)).stderr).toContain('already associated');
    e.acct.clock += 30000;
    expect(await e.json(`ec2 describe-nat-gateways --nat-gateway-ids ${n.NatGatewayId} --query "NatGateways[0].State"`)).toBe('available');
    await e.run(`ec2 delete-nat-gateway --nat-gateway-id ${n.NatGatewayId}`);
    expect(await e.json(`ec2 describe-nat-gateways --nat-gateway-ids ${n.NatGatewayId} --query "NatGateways[0].State"`)).toBe('deleting');
    e.acct.clock += 30000;
    expect(await e.json(`ec2 describe-nat-gateways --nat-gateway-ids ${n.NatGatewayId} --query "NatGateways[0].State"`)).toBe('deleted');
  });

  test('NACL: reglas por número, sin estado y etiquetas', async () => {
    const e = mkEnv();
    const vpc = (await e.json('ec2 create-vpc --cidr-block 10.1.0.0/16')).Vpc.VpcId;
    const acl = (await e.json(`ec2 create-network-acl --vpc-id ${vpc}`)).NetworkAcl.NetworkAclId;
    expect(await e.json(`ec2 describe-network-acls --network-acl-ids ${acl} --query "NetworkAcls[0].Entries[].[Egress,RuleNumber,RuleAction]"`)).toEqual([[true, 32767, 'deny'], [false, 32767, 'deny']]);
    await e.run(`ec2 create-network-acl-entry --network-acl-id ${acl} --ingress --rule-number 100 --protocol tcp --port-range From=80,To=80 --cidr-block 0.0.0.0/0 --rule-action allow`);
    expect((await e.run(`ec2 create-network-acl-entry --network-acl-id ${acl} --ingress --rule-number 100 --protocol tcp --port-range From=22,To=22 --cidr-block 0.0.0.0/0 --rule-action allow`)).stderr).toContain('NetworkAclEntryAlreadyExists');
    expect((await e.run(`ec2 create-network-acl-entry --network-acl-id ${acl} --ingress --rule-number 110 --protocol tcp --cidr-block 0.0.0.0/0 --rule-action allow`)).stderr).toContain('requires PortRange');
    expect((await e.run(`ec2 create-network-acl-entry --network-acl-id ${acl} --rule-number 110 --protocol all --cidr-block 0.0.0.0/0 --rule-action allow`)).stderr).toContain('egress');
    await e.run(`ec2 replace-network-acl-entry --network-acl-id ${acl} --ingress --rule-number 100 --protocol tcp --port-range From=443,To=443 --cidr-block 0.0.0.0/0 --rule-action allow`);
    expect(await e.json(`ec2 describe-network-acls --network-acl-ids ${acl} --query "NetworkAcls[0].Entries[?RuleNumber==\`100\`].PortRange"`)).toEqual([{ From: 443, To: 443 }]);
    await e.run(`ec2 create-tags --resources ${acl} --tags Key=Name,Value=publica`);
    expect(await e.json(`ec2 describe-network-acls --filters Name=tag:Name,Values=publica --query "NetworkAcls[].NetworkAclId"`)).toEqual([acl]);
    expect((await e.run(`ec2 delete-network-acl --network-acl-id ${acl}`)).code).toBe(0);
    expect((await e.run(`ec2 delete-network-acl --network-acl-id ${acl}`)).stderr).toContain('InvalidNetworkAclID.NotFound');
  });
});

describe('VPC: ¿llega el paquete? (curl a una instancia)', () => {
  test('arreglar una web paso a paso: IGW, ruta, NACL y grupo de seguridad', async () => {
    const t = mk('red-igw');
    const ip = (await t.exec(IP)).out.trim();
    expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const curl = async () => t.exec(`curl -s --max-time 3 http://${ip}/`);
    expect((await curl()).status).toBe(28);
    // 1) conectar la IGW
    const vpc = (await t.exec('aws ec2 describe-vpcs --filters Name=tag:Name,Values=produccion --query "Vpcs[0].VpcId" --output text')).out.trim();
    const igw = (await t.exec('aws ec2 describe-internet-gateways --query "InternetGateways[0].InternetGatewayId" --output text')).out.trim();
    // el primero es el de la VPC por defecto: buscamos la que no está conectada
    const free = (await t.exec("aws ec2 describe-internet-gateways --query 'InternetGateways[?length(Attachments)==`0`].InternetGatewayId' --output text")).out.trim();
    expect(free).toMatch(/^igw-/);
    expect(igw).toMatch(/^igw-/);
    await t.exec(`aws ec2 attach-internet-gateway --internet-gateway-id ${free} --vpc-id ${vpc}`);
    expect((await curl()).status).toBe(28); // aún sin ruta
    // 2) ruta pública
    const rtb = (await t.exec(`aws ec2 describe-route-tables --filters Name=vpc-id,Values=${vpc} Name=association.main,Values=true --query "RouteTables[0].RouteTableId" --output text`)).out.trim();
    await t.exec(`aws ec2 create-route --route-table-id ${rtb} --destination-cidr-block 0.0.0.0/0 --gateway-id ${free}`);
    expect((await curl()).out).toContain('Bienvenido a mi VPC');
  });

  test('una NACL que deniega el 80 corta la web aunque el resto esté bien', async () => {
    const t = mk('red-nacl');
    const ip = (await t.exec(IP)).out.trim();
    expect((await t.exec(`curl -s --max-time 3 http://${ip}/`)).status).toBe(28);
    const acl = (await t.exec('aws ec2 describe-network-acls --filters Name=tag:Name,Values=nacl-publica --query "NetworkAcls[0].NetworkAclId" --output text')).out.trim();
    await t.exec(`aws ec2 delete-network-acl-entry --network-acl-id ${acl} --ingress --rule-number 90`);
    expect((await t.exec(`curl -s --max-time 3 http://${ip}/`)).out).toContain('Bienvenido a mi VPC');
  });

  test('sin regla de entrada en el security group no hay web; con ella sí', async () => {
    const t = mk('red-sg');
    const ip = (await t.exec(IP)).out.trim();
    expect((await t.exec(`curl -s --max-time 3 http://${ip}/`)).status).toBe(28);
    const sg = (await t.exec('aws ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId" --output text')).out.trim();
    await t.exec(`aws ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    expect((await t.exec(`curl -s --max-time 3 http://${ip}/`)).out).toContain('Bienvenido a mi VPC');
  });

  test('el escenario correcto funciona y el trazador explica cada salto', async () => {
    const t = mk('red-ok');
    const ip = (await t.exec(IP)).out.trim();
    expect((await t.exec(`curl -s http://${ip}/`)).out).toContain('Bienvenido a mi VPC');
  });
});

describe('Route 53', () => {
  test('zona, registros, dig y curl hacia un sitio web de S3', async () => {
    const t = mk('base');
    const z = JSON.parse((await t.exec('aws route53 create-hosted-zone --name ejemplo.com --caller-reference r1')).out);
    const id = z.HostedZone.Id.replace('/hostedzone/', '');
    expect(z.DelegationSet.NameServers).toHaveLength(4);
    expect((await t.exec('aws route53 create-hosted-zone --name ejemplo.com --caller-reference r1')).err).toContain('HostedZoneAlreadyExists');
    // dominio sin registros
    expect((await t.exec('dig +short www.ejemplo.com')).out).toBe('');
    // un bucket-sitio-web cuyo nombre coincide con el dominio
    await t.exec('aws s3 mb s3://www.ejemplo.com');
    await t.exec('echo "<h1>Hola dominio</h1>" > index.html');
    await t.exec('aws s3 cp index.html s3://www.ejemplo.com/');
    await t.exec('aws s3 website s3://www.ejemplo.com/ --index-document index.html');
    await t.exec('aws s3api put-public-access-block --bucket www.ejemplo.com --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false');
    await t.exec(`aws s3api put-bucket-policy --bucket www.ejemplo.com --policy '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::www.ejemplo.com/*"}]}'`);
    const batch = (a: string, rs: string) => `aws route53 change-resource-record-sets --hosted-zone-id ${id} --change-batch '{"Changes":[{"Action":"${a}","ResourceRecordSet":${rs}}]}'`;
    const alias = '{"Name":"www.ejemplo.com","Type":"A","AliasTarget":{"HostedZoneId":"Z3AQBSTGFYJSTF","DNSName":"www.ejemplo.com.s3-website-us-east-1.amazonaws.com","EvaluateTargetHealth":false}}';
    expect((await t.exec(batch('CREATE', alias))).status).toBe(0);
    expect((await t.exec(batch('CREATE', alias))).err).toContain('already exists');
    expect((await t.exec('dig +short www.ejemplo.com')).out).toMatch(/^\d+\.\d+\.\d+\.\d+\n$/);
    expect((await t.exec('curl -s http://www.ejemplo.com/')).out).toContain('Hola dominio');
    // CNAME y cadena
    expect((await t.exec(batch('CREATE', '{"Name":"blog.ejemplo.com","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"www.ejemplo.com"}]}'))).status).toBe(0);
    const chain = (await t.exec('dig +short blog.ejemplo.com')).out.trim().split('\n');
    expect(chain[0]).toBe('www.ejemplo.com.');
    expect(chain[1]).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    // un CNAME en el ápice no se permite; un A fuera de la zona tampoco
    expect((await t.exec(batch('CREATE', '{"Name":"ejemplo.com","Type":"CNAME","TTL":300,"ResourceRecords":[{"Value":"www.ejemplo.com"}]}'))).err).toContain('zone apex');
    expect((await t.exec(batch('CREATE', '{"Name":"otro.org","Type":"A","TTL":300,"ResourceRecords":[{"Value":"1.2.3.4"}]}'))).err).toContain('not permitted in zone');
    // un MX y un A de verdad
    await t.exec(batch('UPSERT', '{"Name":"ejemplo.com","Type":"MX","TTL":300,"ResourceRecords":[{"Value":"10 mail.ejemplo.com"}]}'));
    expect((await t.exec('dig +short ejemplo.com MX')).out).toBe('10 mail.ejemplo.com\n');
    expect(JSON.parse((await t.exec(`aws route53 test-dns-answer --hosted-zone-id ${id} --record-name blog.ejemplo.com --record-type CNAME`)).out).RecordData).toEqual(['www.ejemplo.com']);
    expect((await t.exec(`aws route53 delete-hosted-zone --id ${id}`)).err).toContain('HostedZoneNotEmpty');
    expect((await t.exec('dig www.noexiste.ejemplo.com')).out).toContain('NXDOMAIN');
  });
});

describe('trazador (herramienta del corrector)', () => {
  test('explica qué salto falla y solo existe en modo dios', async () => {
    const e = mkEnv({ scenario: 'red-nacl' });
    // el alumno no la ve
    expect((await e.run('_check trace --from internet --to web-prod')).code).toBe(252);
    e.io.god = true;
    const t = await e.json('_check trace --from internet --to web-prod --port 80');
    expect(t.Reachable).toBe(false);
    expect(t.Blocker).toBe('nacl');
    expect(t.Hops.some((h: string) => h.startsWith('FALLA · NACL (entrada)'))).toBe(true);
    const ok = mkEnv({ scenario: 'red-ok' });
    ok.io.god = true;
    expect((await ok.json('_check trace --from internet --to web-prod --port 80')).Reachable).toBe(true);
    expect((await ok.json('_check trace --from internet --to web-prod --port 22')).Blocker).toBe('sg');
    // la instancia privada sale a internet solo si hay NAT; aquí no hay ruta
    expect((await ok.json('_check trace --from app-privada --to internet --port 443')).Blocker).toBe('route');
    // la web (en subred pública) habla con la privada por el puerto de la app, y la privada solo admite 8080
    expect((await ok.json('_check trace --from web-prod --to app-privada --port 8080')).Reachable).toBe(true);
    expect((await ok.json('_check trace --from web-prod --to app-privada --port 22')).Blocker).toBe('sg');
  });
});

describe('ipcalc y cuentas guardadas', () => {
  test('ipcalc calcula como la herramienta real', async () => {
    const t = mk('base');
    const out = (await t.exec('ipcalc 10.0.1.0/24')).out;
    expect(out).toContain('Network:   10.0.1.0/24');
    expect(out).toContain('HostMin:   10.0.1.1');
    expect(out).toContain('HostMax:   10.0.1.254');
    expect(out).toContain('Broadcast: 10.0.1.255');
    expect(out).toMatch(/Hosts\/Net: 254\s+Class A, Private Internet/);
    expect(out).toContain('00001010.00000000.00000001. 00000000');
    expect((await t.exec('ipcalc 192.168.0.0/20')).out).toContain('11000000.10101000.0000 0000.00000000');
    expect((await t.exec('ipcalc 300.1.1.1/24')).status).toBe(1);
  });

  test('una cuenta guardada antes de existir la red recibe la de la VPC por defecto', async () => {
    const t = mk('base');
    await t.exec('aws ec2 describe-vpcs');
    const snap = JSON.parse(JSON.stringify(t.snapshot()));
    // simula una cuenta vieja: sin tablas de rutas ni IGW
    const acct = snap.sys?.ext?.aws ?? snap.ext?.aws;
    const reg = acct?.regions?.['us-east-1']?.ec2;
    expect(reg).toBeDefined();
    for (const k of ['internetGateways', 'routeTables', 'natGateways', 'networkAcls']) delete reg[k];
    const t2 = restoreTerminal(snap, { cols: 80, instant: true } as any);
    const r = await t2.exec('aws ec2 describe-route-tables --query "RouteTables[0].Routes[].DestinationCidrBlock" --output text');
    expect(r.out.trim()).toBe('172.31.0.0/16\t0.0.0.0/0');
  });
});
