import { Terminal } from '../../engine/terminal';
import { mkEnv } from './helpers';

const mk = (aws: any = 'base', extra: any = {}) => new Terminal({ instant: true, aws, ...extra });

async function zoneId(e: ReturnType<typeof mkEnv>) {
  return (await e.json('route53 list-hosted-zones --query "HostedZones[0].Id"')) as string;
}
const ips = async (e: ReturnType<typeof mkEnv>) => ({
  us: (await e.json('ec2 describe-instances --region us-east-1 --filters Name=tag:Name,Values=web-us --query "Reservations[0].Instances[0].PublicIpAddress"')) as string,
  eu: (await e.json('ec2 describe-instances --region eu-west-1 --filters Name=tag:Name,Values=web-eu --query "Reservations[0].Instances[0].PublicIpAddress"')) as string,
});

const change = (z: string, rec: Record<string, unknown>) => `route53 change-resource-record-sets --hosted-zone-id ${z} --change-batch '${JSON.stringify({ Changes: [{ Action: 'UPSERT', ResourceRecordSet: rec }] })}'`;

describe('Route 53: políticas de enrutamiento', () => {
  test('los registros con política necesitan identificador y no se mezclan', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const z = await zoneId(e);
    const { us, eu } = await ips(e);
    const base = { Name: 'www.tienda.test', Type: 'A', TTL: 60, ResourceRecords: [{ Value: us }] };
    expect((await e.run(change(z, { ...base, Weight: 10 }))).stderr).toContain("Missing field 'SetIdentifier'");
    expect((await e.run(change(z, { ...base, SetIdentifier: 'x' }))).stderr).toContain('SetIdentifier');
    expect((await e.run(change(z, { ...base, SetIdentifier: 'a', Weight: 300 }))).stderr).toContain('minInclusive');
    expect((await e.run(change(z, { ...base, SetIdentifier: 'a', Weight: 10, HealthCheckId: 'no-existe' }))).stderr).toContain('NoSuchHealthCheck');
    expect((await e.run(change(z, { ...base, SetIdentifier: 'a', Weight: 10 }))).code).toBe(0);
    expect((await e.run(change(z, { ...base, ResourceRecords: [{ Value: eu }], SetIdentifier: 'b', Region: 'eu-west-1' }))).stderr).toContain('different routing policy');
  });

  test('latencia: cada cliente va a la región más cercana', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const z = await zoneId(e);
    const { us, eu } = await ips(e);
    await e.run(change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: 'virginia', Region: 'us-east-1', ResourceRecords: [{ Value: us }] }));
    await e.run(change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: 'irlanda', Region: 'eu-west-1', ResourceRecords: [{ Value: eu }] }));
    const ask = async (ip: string) => (await e.json(`route53 test-dns-answer --hosted-zone-id ${z} --record-name www.tienda.test --record-type A --edns0-client-subnet-ip ${ip}`)).RecordData[0];
    expect(await ask('203.0.113.25')).toBe(eu); // España
    expect(await ask('198.51.100.10')).toBe(us); // Estados Unidos
    expect(await ask('192.0.2.50')).toBe(us); // Japón: Virginia (≈150 ms) está más cerca que Irlanda (≈220 ms)
  });

  test('geolocalización: país, continente y por defecto', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const z = await zoneId(e);
    const { us, eu } = await ips(e);
    const rec = (id: string, geo: Record<string, string>, ip: string) => change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: id, GeoLocation: geo, ResourceRecords: [{ Value: ip }] });
    await e.run(rec('europa', { ContinentCode: 'EU' }, eu));
    await e.run(rec('resto', { CountryCode: '*' }, us));
    const ask = async (ip: string) => (await e.json(`route53 test-dns-answer --hosted-zone-id ${z} --record-name www.tienda.test --record-type A --edns0-client-subnet-ip ${ip}`)).RecordData;
    expect(await ask('203.0.113.25')).toEqual([eu]);
    expect(await ask('198.51.100.10')).toEqual([us]);
    // sin registro por defecto, quien no encaja no recibe respuesta
    await e.run(`route53 change-resource-record-sets --hosted-zone-id ${z} --change-batch '${JSON.stringify({ Changes: [{ Action: 'DELETE', ResourceRecordSet: { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: 'resto', GeoLocation: { CountryCode: '*' }, ResourceRecords: [{ Value: us }] } }] })}'`);
    expect(await ask('198.51.100.10')).toEqual([]);
  });

  test('ponderado: reparto aproximado y peso 0 apaga el registro', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const z = await zoneId(e);
    const { us, eu } = await ips(e);
    const rec = (id: string, w: number, ip: string) => change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: id, Weight: w, ResourceRecords: [{ Value: ip }] });
    await e.run(rec('estable', 90, us));
    await e.run(rec('canario', 10, eu));
    let canario = 0;
    for (let i = 0; i < 200; i++) {
      const r = await e.json(`route53 test-dns-answer --hosted-zone-id ${z} --record-name www.tienda.test --record-type A`);
      if (r.RecordData[0] === eu) canario++;
    }
    expect(canario).toBeGreaterThan(5);
    expect(canario).toBeLessThan(45);
    await e.run(rec('canario', 0, eu));
    for (let i = 0; i < 20; i++) expect((await e.json(`route53 test-dns-answer --hosted-zone-id ${z} --record-name www.tienda.test --record-type A`)).RecordData[0]).toBe(us);
  });
});

describe('Route 53: comprobaciones de salud y failover', () => {
  test('crear y consultar una comprobación; el SG que no deja entrar a los comprobadores la tumba', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const { us } = await ips(e);
    expect((await e.run('route53 create-health-check --caller-reference a --health-check-config Type=HTTP')).stderr).toContain('IPAddress or FullyQualifiedDomainName');
    const hc = await e.json(`route53 create-health-check --caller-reference a --health-check-config IPAddress=${us},Port=80,Type=HTTP,ResourcePath=/,RequestInterval=10,FailureThreshold=2`);
    expect(hc.HealthCheck.HealthCheckConfig).toMatchObject({ Type: 'HTTP', Port: 80, ResourcePath: '/', RequestInterval: 10, FailureThreshold: 2 });
    const st = await e.json(`route53 get-health-check-status --health-check-id ${hc.HealthCheck.Id} --query "HealthCheckObservations[].StatusReport.Status"`);
    expect(st[0]).toBe('Success: HTTP Status Code 200, OK');
    // cerrar el SG a una sola IP hace que los comprobadores no lleguen
    const sg = await e.json('ec2 describe-security-groups --region us-east-1 --filters Name=group-name,Values=web-abierto --query "SecurityGroups[0].GroupId"');
    await e.run(`ec2 revoke-security-group-ingress --region us-east-1 --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    expect(await e.json(`route53 get-health-check-status --health-check-id ${hc.HealthCheck.Id} --query "HealthCheckObservations[0].StatusReport.Status"`)).toContain('Connection timed out');
    expect((await e.run(`route53 delete-health-check --health-check-id ${hc.HealthCheck.Id}`)).code).toBe(0);
  });

  test('failover: el secundario responde cuando el primario cae, con el retraso del intervalo', async () => {
    const e = mkEnv({ scenario: 'dns-ha' });
    const z = await zoneId(e);
    const { us, eu } = await ips(e);
    const hc = (await e.json(`route53 create-health-check --caller-reference f --health-check-config IPAddress=${us},Port=80,Type=HTTP,ResourcePath=/,RequestInterval=10,FailureThreshold=3`)).HealthCheck.Id;
    await e.run(change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: 'primario', Failover: 'PRIMARY', HealthCheckId: hc, ResourceRecords: [{ Value: us }] }));
    await e.run(change(z, { Name: 'www.tienda.test', Type: 'A', TTL: 60, SetIdentifier: 'secundario', Failover: 'SECONDARY', ResourceRecords: [{ Value: eu }] }));
    const answer = async () => (await e.json(`route53 test-dns-answer --hosted-zone-id ${z} --record-name www.tienda.test --record-type A`)).RecordData[0];
    expect(await answer()).toBe(us);
    // se cae el primario: el grupo de seguridad deja de admitir el puerto 80
    const sg = await e.json('ec2 describe-security-groups --region us-east-1 --filters Name=group-name,Values=web-abierto --query "SecurityGroups[0].GroupId"');
    await e.run(`ec2 revoke-security-group-ingress --region us-east-1 --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    // aún no se ha enterado (hacen falta 3 fallos seguidos de 10 s)
    expect(await answer()).toBe(us);
    e.acct.clock += 60000;
    expect(await answer()).toBe(eu);
    // el comprobador vuelve a ver el servidor
    await e.run(`ec2 authorize-security-group-ingress --region us-east-1 --group-id ${sg} --protocol tcp --port 80 --cidr 0.0.0.0/0`);
    e.acct.clock += 120000;
    expect(await answer()).toBe(us);
    expect((await e.run(`route53 delete-health-check --health-check-id ${hc}`)).stderr).toContain('HealthCheckInUse');
  });
});

describe('Route 53: alias a un balanceador', () => {
  test('curl y dig llegan al ALB; evaluar la salud del destino', async () => {
    const t = mk('ha-tienda');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    await t.exec('aws ec2 describe-vpcs --query "Vpcs[0].VpcId"');
    const vpc = await q('aws ec2 describe-vpcs --filters Name=tag:Name,Values=tienda --query "Vpcs[0].VpcId" --output text');
    const subs = await q('aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,publica-b --query "Subnets[].SubnetId" --output text');
    const sg = await q('aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId" --output text');
    const tg = await q(`aws elbv2 create-target-group --name web-tg --protocol HTTP --port 80 --vpc-id ${vpc} --health-check-path /health --query "TargetGroups[0].TargetGroupArn" --output text`);
    const lb = await q(`aws elbv2 create-load-balancer --name tienda-alb --subnets ${subs} --security-groups ${sg} --query "LoadBalancers[0].LoadBalancerArn" --output text`);
    await t.exec(`aws elbv2 create-listener --load-balancer-arn ${lb} --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=${tg}`);
    const info = JSON.parse(await q('aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].[DNSName,CanonicalHostedZoneId]"'));
    const zone = await q('aws route53 list-hosted-zones --query "HostedZones[0].Id" --output text');
    const batch = JSON.stringify({ Changes: [{ Action: 'CREATE', ResourceRecordSet: { Name: 'www.tienda.test', Type: 'A', AliasTarget: { HostedZoneId: info[1], DNSName: info[0], EvaluateTargetHealth: true } } }] });
    expect((await t.exec(`aws route53 change-resource-record-sets --hosted-zone-id ${zone} --change-batch '${batch}'`)).status).toBe(0);
    const dig = await q('dig +short www.tienda.test');
    expect(dig.split('\n').length).toBeGreaterThanOrEqual(1);
    expect(dig).toMatch(/^\d+\.\d+\.\d+\.\d+/);
    await t.exec('sleep 200');
    // sin servidores en el grupo: 503 a través del nombre
    expect(await q(`curl -s -o /dev/null -w '%{http_code}' http://www.tienda.test/`)).toBe('503');
  });
});

describe('CloudFront', () => {
  test('crear una distribución sobre un bucket privado: sin OAC da 403; con OAC y política responde y cachea', async () => {
    const t = mk('cdn');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const dist = JSON.parse(await q('aws cloudfront create-distribution --origin-domain-name tienda-estaticos.s3.amazonaws.com --default-root-object index.html --query "[Distribution.Id,Distribution.DomainName,ETag]"'));
    const [id, domain] = dist;
    expect(domain).toMatch(/^d[0-9a-f]{13}\.cloudfront\.net$/);
    expect(await q(`aws cloudfront get-distribution --id ${id} --query "Distribution.Status" --output text`)).toBe('InProgress');
    expect((await t.exec(`curl -sS http://${domain}/`)).err).toContain('Could not resolve host');
    await t.exec(`aws cloudfront wait distribution-deployed --id ${id}`);
    expect(await q(`aws cloudfront get-distribution --id ${id} --query "Distribution.Status" --output text`)).toBe('Deployed');
    // bucket privado y sin OAC → AccessDenied
    expect(await q(`curl -s -o /dev/null -w '%{http_code}' http://${domain}/`)).toBe('403');
    // OAC + política del bucket
    const oac = await q(`aws cloudfront create-origin-access-control --origin-access-control-config Name=tienda-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 --query "OriginAccessControl.Id" --output text`);
    const cfg = JSON.parse(await q(`aws cloudfront get-distribution-config --id ${id}`));
    cfg.DistributionConfig.Origins.Items[0].OriginAccessControlId = oac;
    await t.exec(`aws cloudfront update-distribution --id ${id} --if-match ${cfg.ETag} --distribution-config '${JSON.stringify(cfg.DistributionConfig)}'`);
    expect((await t.exec(`aws cloudfront update-distribution --id ${id} --if-match VIEJO --distribution-config '${JSON.stringify(cfg.DistributionConfig)}'`)).err).toContain('PreconditionFailed');
    await t.exec(`aws cloudfront wait distribution-deployed --id ${id}`);
    const policy = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::tienda-estaticos/*', Condition: { StringEquals: { 'AWS:SourceArn': `arn:aws:cloudfront::123456789012:distribution/${id}` } } }] });
    await t.exec(`aws s3api put-bucket-policy --bucket tienda-estaticos --policy '${policy}'`);
    const first = await q(`curl -si http://${domain}/`);
    expect(first).toContain('200');
    expect(first).toContain('X-Cache: Miss from cloudfront');
    expect(first).toContain('Tienda v1');
    expect(await q(`curl -si http://${domain}/`)).toContain('X-Cache: Hit from cloudfront');
  });

  test('la caché devuelve la versión vieja hasta que se invalida', async () => {
    const t = mk('cdn-vivo');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const id = await q('aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text');
    const domain = await q('aws cloudfront list-distributions --query "DistributionList.Items[0].DomainName" --output text');
    expect(await q(`curl -s http://${domain}/`)).toBe('<h1>Tienda v1</h1>');
    expect((await t.exec(`aws cloudfront create-invalidation --distribution-id ${id} --paths index.html`)).err).toContain('must start with /');
    await t.exec(`aws cloudfront create-invalidation --distribution-id ${id} --paths /index.html`);
    expect(await q(`curl -s http://${domain}/`)).toBe('<h1>Tienda v2 - rebajas</h1>');
    expect(await q(`aws cloudfront list-invalidations --distribution-id ${id} --query "InvalidationList.Quantity" --output text`)).toBe('1');
  });

  test('borrar: primero desactivar y esperar', async () => {
    const t = mk('cdn-vivo');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const id = await q('aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text');
    const cfg = JSON.parse(await q(`aws cloudfront get-distribution-config --id ${id}`));
    expect((await t.exec(`aws cloudfront delete-distribution --id ${id} --if-match ${cfg.ETag}`)).err).toContain('DistributionNotDisabled');
    cfg.DistributionConfig.Enabled = false;
    const upd = JSON.parse(await q(`aws cloudfront update-distribution --id ${id} --if-match ${cfg.ETag} --distribution-config '${JSON.stringify(cfg.DistributionConfig)}'`));
    await t.exec(`aws cloudfront wait distribution-deployed --id ${id}`);
    expect((await t.exec(`aws cloudfront delete-distribution --id ${id} --if-match ${upd.ETag}`)).status).toBe(0);
    expect(await q('aws cloudfront list-distributions --query "DistributionList.Quantity" --output text')).toBe('0');
  });
});

describe('Global Accelerator', () => {
  test('crear, escuchar y apuntar a un balanceador', async () => {
    const e = mkEnv({ scenario: 'ha-alb' });
    const lb = await e.json('elbv2 describe-load-balancers --query "LoadBalancers[0].LoadBalancerArn"');
    const acc = (await e.json('globalaccelerator create-accelerator --name tienda-ga')).Accelerator;
    expect(acc.IpSets[0].IpAddresses).toHaveLength(2);
    expect(acc.DnsName).toMatch(/^a[0-9a-f]{16}\.awsglobalaccelerator\.com$/);
    const l = (await e.json(`globalaccelerator create-listener --accelerator-arn ${acc.AcceleratorArn} --protocol TCP --port-ranges FromPort=80,ToPort=80`)).Listener;
    const g = (await e.json(`globalaccelerator create-endpoint-group --listener-arn ${l.ListenerArn} --endpoint-group-region us-east-1 --endpoint-configurations EndpointId=${lb},Weight=128`)).EndpointGroup;
    expect(g.EndpointDescriptions[0].HealthState).toBe('HEALTHY');
    expect((await e.run(`globalaccelerator delete-accelerator --accelerator-arn ${acc.AcceleratorArn}`)).stderr).toContain('must be disabled');
    const t = mk('ha-alb');
    const lb2 = (await t.exec('aws elbv2 describe-load-balancers --query "LoadBalancers[0].LoadBalancerArn" --output text')).out.trim();
    const a2 = JSON.parse((await t.exec('aws globalaccelerator create-accelerator --name ga --query "Accelerator.[AcceleratorArn,DnsName]"')).out);
    const l2 = (await t.exec(`aws globalaccelerator create-listener --accelerator-arn ${a2[0]} --protocol TCP --port-ranges FromPort=80,ToPort=80 --query "Listener.ListenerArn" --output text`)).out.trim();
    await t.exec(`aws globalaccelerator create-endpoint-group --listener-arn ${l2} --endpoint-group-region us-east-1 --endpoint-configurations EndpointId=${lb2},Weight=128`);
    const r = await t.exec(`curl -si http://${a2[1]}/`);
    expect(r.out).toContain('200');
    expect(r.out).toContain('x-amz-ga-region: us-east-1');
  });
});
