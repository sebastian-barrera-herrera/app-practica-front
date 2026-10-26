import { Terminal } from '../../engine/terminal';
import { mkEnv } from './helpers';

const mk = (aws: any = 'base', extra: any = {}) => new Terminal({ instant: true, aws, ...extra });
const DNS = 'aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text';

async function dns(t: Terminal): Promise<string> {
  const r = await t.exec(DNS);
  return r.out.trim();
}

describe('ELB: crear balanceadores y grupos de destino', () => {
  test('validaciones al crear un ALB', async () => {
    const e = mkEnv({ scenario: 'ha-base' });
    const subs = await e.json('ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,publica-b --query "Subnets[].SubnetId"');
    const sg = await e.json('ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId"');
    expect((await e.run(`elbv2 create-load-balancer --name mi-alb --subnets ${subs[0]}`)).stderr).toContain('At least two subnets in two different Availability Zones');
    expect((await e.run(`elbv2 create-load-balancer --name internal-x --subnets ${subs.join(' ')}`)).stderr).toContain('can only contain characters');
    const lb = await e.json(`elbv2 create-load-balancer --name mi-alb --subnets ${subs.join(' ')} --security-groups ${sg}`);
    expect(lb.LoadBalancers[0].State.Code).toBe('provisioning');
    expect(lb.LoadBalancers[0].DNSName).toMatch(/^mi-alb-\d{9}\.us-east-1\.elb\.amazonaws\.com$/);
    expect(lb.LoadBalancers[0].AvailabilityZones.map((z: any) => z.ZoneName).sort()).toEqual(['us-east-1a', 'us-east-1b']);
    // idempotente con la misma configuración; con otra distinta, error
    expect((await e.run(`elbv2 create-load-balancer --name mi-alb --subnets ${subs.join(' ')} --security-groups ${sg}`)).code).toBe(0);
    expect((await e.run(`elbv2 create-load-balancer --name mi-alb --subnets ${subs.join(' ')} --scheme internal`)).stderr).toContain('DuplicateLoadBalancerName');
    // tras un par de minutos queda activo
    e.acct.clock += 200000;
    expect(await e.json('elbv2 describe-load-balancers --names mi-alb --query "LoadBalancers[0].State.Code"')).toBe('active');
  });

  test('grupo de destino, registro, oyente y reglas', async () => {
    const e = mkEnv({ scenario: 'ha-base' });
    const vpc = await e.json('ec2 describe-vpcs --filters Name=tag:Name,Values=tienda --query "Vpcs[0].VpcId"');
    const ids = await e.json('ec2 describe-instances --filters Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId"');
    expect((await e.run('elbv2 create-target-group --name web-tg --protocol HTTP --port 80')).stderr).toContain('A VPC ID must be specified');
    const tg = (await e.json(`elbv2 create-target-group --name web-tg --protocol HTTP --port 80 --vpc-id ${vpc} --health-check-path /health`)).TargetGroups[0];
    expect(tg.HealthCheckPath).toBe('/health');
    expect(tg.HealthyThresholdCount).toBe(5);
    expect((await e.run(`elbv2 create-target-group --name web-tg --protocol HTTP --port 8080 --vpc-id ${vpc}`)).stderr).toContain('DuplicateTargetGroupName');
    expect((await e.run(`elbv2 register-targets --target-group-arn ${tg.TargetGroupArn} --targets Id=i-00000000000000000`)).stderr).toContain('InvalidTarget');
    await e.run(`elbv2 register-targets --target-group-arn ${tg.TargetGroupArn} --targets ${ids.map((i: string) => `Id=${i}`).join(' ')}`);
    // sin oyente que lo use, los destinos no están en uso
    const h0 = await e.json(`elbv2 describe-target-health --target-group-arn ${tg.TargetGroupArn}`);
    expect(h0.TargetHealthDescriptions[0].TargetHealth).toEqual({ State: 'unused', Reason: 'Target.NotInUse', Description: 'Target group is not configured to receive traffic from the load balancer' });
    const subs = await e.json('ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,publica-b --query "Subnets[].SubnetId"');
    const sg = await e.json('ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId"');
    const lb = (await e.json(`elbv2 create-load-balancer --name mi-alb --subnets ${subs.join(' ')} --security-groups ${sg}`)).LoadBalancers[0];
    expect((await e.run(`elbv2 create-listener --load-balancer-arn ${lb.LoadBalancerArn} --protocol HTTPS --port 443 --default-actions Type=forward,TargetGroupArn=${tg.TargetGroupArn}`)).stderr).toContain('A certificate must be specified');
    const l = (await e.json(`elbv2 create-listener --load-balancer-arn ${lb.LoadBalancerArn} --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=${tg.TargetGroupArn}`)).Listeners[0];
    expect((await e.run(`elbv2 create-listener --load-balancer-arn ${lb.LoadBalancerArn} --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=${tg.TargetGroupArn}`)).stderr).toContain('DuplicateListener');
    expect((await e.run(`elbv2 delete-target-group --target-group-arn ${tg.TargetGroupArn}`)).stderr).toContain('currently in use by a listener');
    const rule = await e.json(`elbv2 create-rule --listener-arn ${l.ListenerArn} --priority 10 --conditions Field=path-pattern,Values=/api/* --actions Type=fixed-response,FixedResponseConfig={StatusCode=200,ContentType=text/plain,MessageBody=api}`);
    expect(rule.Rules[0].Conditions[0].PathPatternConfig.Values).toEqual(['/api/*']);
    expect((await e.run(`elbv2 create-rule --listener-arn ${l.ListenerArn} --priority 10 --conditions Field=path-pattern,Values=/x --actions Type=fixed-response,FixedResponseConfig={StatusCode=200}`)).stderr).toContain('PriorityInUse');
    expect(await e.json(`elbv2 describe-rules --listener-arn ${l.ListenerArn} --query "Rules[].Priority"`)).toEqual(['10', 'default']);
  });
});

describe('ELB: salud y tráfico (curl)', () => {
  test('reparte por turnos entre los servidores sanos', async () => {
    const t = mk('ha-alb');
    const d = await dns(t);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await t.exec(`curl -s http://${d}/`);
      expect(r.out).toContain('Tienda - servidor ip-10-0-');
      seen.add(r.out.trim());
    }
    expect(seen.size).toBe(2);
  });

  test('un balanceador recién creado no resuelve; los destinos tardan en estar sanos', async () => {
    const t = mk('ha-base');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const vpc = await q('aws ec2 describe-vpcs --filters Name=tag:Name,Values=tienda --query "Vpcs[0].VpcId" --output text');
    const ids = (await q('aws ec2 describe-instances --filters Name=instance-state-name,Values=running --query "Reservations[].Instances[].InstanceId" --output text')).split(/\s+/);
    const subs = await q('aws ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,publica-b --query "Subnets[].SubnetId" --output text');
    const sg = await q('aws ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId" --output text');
    const tg = await q(`aws elbv2 create-target-group --name nuevo-tg --protocol HTTP --port 80 --vpc-id ${vpc} --query "TargetGroups[0].TargetGroupArn" --output text`);
    await t.exec(`aws elbv2 register-targets --target-group-arn ${tg} --targets ${ids.map((i) => `Id=${i}`).join(' ')}`);
    const lb = await q(`aws elbv2 create-load-balancer --name nuevo-alb --subnets ${subs} --security-groups ${sg} --query "LoadBalancers[0].LoadBalancerArn" --output text`);
    await t.exec(`aws elbv2 create-listener --load-balancer-arn ${lb} --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn=${tg}`);
    const d = await q('aws elbv2 describe-load-balancers --names nuevo-alb --query "LoadBalancers[0].DNSName" --output text');
    expect((await t.exec(`curl -sS http://${d}/`)).err).toContain('Could not resolve host');
    await t.exec('sleep 160');
    // el balanceador ya está activo, pero los servidores aún no han pasado 5 comprobaciones
    expect(await q(`curl -s -o /dev/null -w '%{http_code}' http://${d}/`)).toBe('200');
    await t.exec('sleep 100');
    expect(await q(`aws elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[].TargetHealth.State" --output text`)).toBe('healthy\thealthy');
  });

  test('sin destinos sanos responde 503; con SG roto, 504', async () => {
    const t = mk('ha-asg');
    const d = await dns(t);
    const r = await t.exec(`curl -s -o /dev/null -w '%{http_code}' http://${d}/`);
    expect(r.out).toBe('503');
    const t2 = mk('ha-alb-sg');
    const d2 = await dns(t2);
    const r2 = await t2.exec(`curl -s -o /dev/null -w '%{http_code}' http://${d2}/`);
    expect(r2.out).toBe('504');
  });

  test('comprobación de salud: ruta que no existe = ResponseCodeMismatch; SG roto = Timeout', async () => {
    const e = mkEnv({ scenario: 'ha-alb-roto' });
    const tg = await e.json('elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn"');
    const h = await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[].TargetHealth"`);
    expect(h[0]).toEqual({ State: 'unhealthy', Reason: 'Target.ResponseCodeMismatch', Description: 'Health checks failed with these codes: [404]' });
    await e.run(`elbv2 modify-target-group --target-group-arn ${tg} --health-check-path /`);
    expect(await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[].TargetHealth.State"`)).toEqual(['unhealthy', 'unhealthy']);
    await e.run(`elbv2 wait target-in-service --target-group-arn ${tg}`);
    expect(await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[].TargetHealth.State"`)).toEqual(['healthy', 'healthy']);

    const s = mkEnv({ scenario: 'ha-alb-sg' });
    const tg2 = await s.json('elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn"');
    expect(await s.json(`elbv2 describe-target-health --target-group-arn ${tg2} --query "TargetHealthDescriptions[0].TargetHealth.Reason"`)).toBe('Target.Timeout');
    // arreglarlo: el servidor admite al grupo del balanceador
    const web = await s.json('ec2 describe-security-groups --filters Name=group-name,Values=web-sg --query "SecurityGroups[0].GroupId"');
    const alb = await s.json('ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query "SecurityGroups[0].GroupId"');
    await s.run(`ec2 authorize-security-group-ingress --group-id ${web} --protocol tcp --port 80 --source-group ${alb}`);
    s.acct.clock += 300000;
    expect(await s.json(`elbv2 describe-target-health --target-group-arn ${tg2} --query "TargetHealthDescriptions[].TargetHealth.State"`)).toEqual(['healthy', 'healthy']);
  });

  test('reglas por ruta y respuestas fijas; redirección', async () => {
    const t = mk('ha-alb');
    const lbArn = (await t.exec('aws elbv2 describe-load-balancers --query "LoadBalancers[0].LoadBalancerArn" --output text')).out.trim();
    const l = (await t.exec(`aws elbv2 describe-listeners --load-balancer-arn ${lbArn} --query "Listeners[0].ListenerArn" --output text`)).out.trim();
    await t.exec(`aws elbv2 create-rule --listener-arn ${l} --priority 5 --conditions Field=path-pattern,Values=/api/* --actions 'Type=fixed-response,FixedResponseConfig={StatusCode=200,ContentType=text/plain,MessageBody=hola-api}'`);
    await t.exec(`aws elbv2 create-rule --listener-arn ${l} --priority 6 --conditions Field=path-pattern,Values=/viejo --actions 'Type=redirect,RedirectConfig={Path=/,StatusCode=HTTP_301}'`);
    const d = await dns(t);
    expect((await t.exec(`curl -s http://${d}/api/x`)).out).toBe('hola-api');
    expect((await t.exec(`curl -s -o /dev/null -w '%{http_code}' http://${d}/viejo`)).out).toBe('301');
    expect((await t.exec(`curl -s -o /dev/null -w '%{http_code}' http://${d}/nada.html`)).out).toBe('404');
  });

  test('desregistrar drena y luego retira el destino', async () => {
    const e = mkEnv({ scenario: 'ha-alb' });
    const tg = await e.json('elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn"');
    const ids = await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[].Target.Id"`);
    await e.run(`elbv2 deregister-targets --target-group-arn ${tg} --targets Id=${ids[0]}`);
    expect(await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "TargetHealthDescriptions[?Target.Id=='${ids[0]}'].TargetHealth.State"`)).toEqual(['draining']);
    e.acct.clock += 301000;
    expect(await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "length(TargetHealthDescriptions)"`)).toBe(1);
  });
});
