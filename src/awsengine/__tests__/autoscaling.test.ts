import { Terminal } from '../../engine/terminal';
import { mkEnv } from './helpers';

const mk = (aws: any = 'base', extra: any = {}) => new Terminal({ instant: true, aws, ...extra });

describe('Auto Scaling: plantillas y grupos', () => {
  test('plantilla de lanzamiento: versiones inmutables y valores por defecto', async () => {
    const e = mkEnv({ scenario: 'ha-base' });
    const ami = await e.json('ec2 describe-images --owners amazon --filters Name=name,Values=al2023-ami-2023* --query "Images[0].ImageId"');
    expect((await e.run('ec2 create-launch-template --launch-template-name xyz --launch-template-data \'{"ImageId":"ami-00000000"}\'')).stderr).toContain('InvalidAMIID.NotFound');
    const lt = await e.json(`ec2 create-launch-template --launch-template-name web-v --launch-template-data '{"ImageId":"${ami}","InstanceType":"t3.micro"}'`);
    expect(lt.LaunchTemplate).toMatchObject({ LaunchTemplateName: 'web-v', DefaultVersionNumber: 1, LatestVersionNumber: 1 });
    expect((await e.run(`ec2 create-launch-template --launch-template-name web-v --launch-template-data '{"ImageId":"${ami}"}'`)).stderr).toContain('AlreadyExists');
    const v2 = await e.json(`ec2 create-launch-template-version --launch-template-name web-v --source-version 1 --launch-template-data '{"InstanceType":"t3.small"}'`);
    expect(v2.LaunchTemplateVersion.LaunchTemplateData).toMatchObject({ ImageId: ami, InstanceType: 't3.small' });
    expect(await e.json('ec2 describe-launch-template-versions --launch-template-name web-v --versions 1 --query "LaunchTemplateVersions[0].LaunchTemplateData.InstanceType"')).toBe('t3.micro');
    await e.run('ec2 modify-launch-template --launch-template-name web-v --default-version 2');
    expect(await e.json('ec2 describe-launch-templates --query "LaunchTemplates[0].DefaultVersionNumber"')).toBe(2);
  });

  test('crear el grupo: validaciones, reparto por zonas y registro en el balanceador', async () => {
    const e = mkEnv({ scenario: 'ha-asg' });
    const subs = (await e.json('ec2 describe-subnets --filters Name=tag:Name,Values=publica-a,publica-b --query "Subnets[].SubnetId"')) as string[];
    const tg = await e.json('elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn"');
    const base = `autoscaling create-auto-scaling-group --auto-scaling-group-name web --launch-template LaunchTemplateName=web-lt,Version='$Default' --vpc-zone-identifier ${subs.join(',')} --target-group-arns ${tg}`;
    expect((await e.run(`${base} --min-size 3 --max-size 2`)).stderr).toContain('Minimum capacity 3 must be less than or equal to maximum capacity 2');
    expect((await e.run(`${base} --min-size 1 --max-size 3 --desired-capacity 5`)).stderr).toContain('Desired capacity:5 must be between the specified min size:1 and max size:3');
    expect((await e.run('autoscaling create-auto-scaling-group --auto-scaling-group-name x --launch-template LaunchTemplateName=nada --min-size 1 --max-size 2 --vpc-zone-identifier ' + subs[0])).stderr).toContain('does not exist');
    expect((await e.run(`${base} --min-size 2 --max-size 4 --health-check-type ELB --health-check-grace-period 60`)).code).toBe(0);
    expect((await e.run(`${base} --min-size 2 --max-size 4`)).stderr).toContain('AlreadyExists');
    const g = (await e.json('autoscaling describe-auto-scaling-groups --auto-scaling-group-names web --query "AutoScalingGroups[0]"')) as any;
    expect(g).toMatchObject({ MinSize: 2, MaxSize: 4, DesiredCapacity: 2, HealthCheckType: 'ELB' });
    expect(g.AvailabilityZones.sort()).toEqual(['us-east-1a', 'us-east-1b']);
    expect(g.Instances.map((i: any) => i.AvailabilityZone).sort()).toEqual(['us-east-1a', 'us-east-1b']);
    expect(g.Instances.every((i: any) => i.LifecycleState === 'Pending')).toBe(true);
    // pasados unos minutos entran en servicio y se registran en el grupo de destino
    e.acct.clock += 240000;
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].Instances[].LifecycleState"')).toEqual(['InService', 'InService']);
    expect(await e.json(`elbv2 describe-target-health --target-group-arn ${tg} --query "length(TargetHealthDescriptions)"`)).toBe(2);
    expect(await e.json('ec2 describe-instances --filters Name=tag:aws:autoscaling:groupName,Values=web Name=instance-state-name,Values=running --query "length(Reservations[].Instances[])"')).toBe(2);
    expect(await e.json('autoscaling describe-scaling-activities --auto-scaling-group-name web --query "length(Activities)"')).toBe(2);
  });

  test('si una instancia se termina, el grupo la repone; con Launch suspendido no', async () => {
    const e = mkEnv({ scenario: 'ha-asg-vivo' });
    const ids = (await e.json('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].Instances[].InstanceId"')) as string[];
    expect(ids).toHaveLength(2);
    await e.run(`ec2 terminate-instances --instance-ids ${ids[0]}`);
    e.acct.clock += 130000;
    const after = (await e.json('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].Instances[].InstanceId"')) as string[];
    expect(after).toHaveLength(2);
    expect(after).not.toContain(ids[0]);
    expect(after).toContain(ids[1]);
    // con el proceso Launch suspendido ya no se repone
    await e.run('autoscaling suspend-processes --auto-scaling-group-name web --scaling-processes Launch');
    await e.run(`ec2 terminate-instances --instance-ids ${ids[1]}`);
    e.acct.clock += 400000;
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "length(AutoScalingGroups[0].Instances)"')).toBe(1);
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].SuspendedProcesses[].ProcessName"')).toEqual(['Launch']);
    await e.run('autoscaling resume-processes --auto-scaling-group-name web');
    e.acct.clock += 130000;
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "length(AutoScalingGroups[0].Instances)"')).toBe(2);
  });

  test('capacidad deseada: límites, protección y terminar con decremento', async () => {
    const e = mkEnv({ scenario: 'ha-asg-vivo' });
    expect((await e.run('autoscaling set-desired-capacity --auto-scaling-group-name web --desired-capacity 9')).stderr).toContain('above max value 6');
    expect((await e.run('autoscaling set-desired-capacity --auto-scaling-group-name web --desired-capacity 1')).stderr).toContain('below min value 2');
    await e.run('autoscaling set-desired-capacity --auto-scaling-group-name web --desired-capacity 4');
    e.acct.clock += 200000;
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].Instances[?LifecycleState==`InService`] | length(@)"')).toBe(4);
    // se reparte entre las dos zonas
    expect(await e.json('autoscaling describe-auto-scaling-instances --query "AutoScalingInstances[].AvailabilityZone"').then((x: string[]) => x.sort())).toEqual(['us-east-1a', 'us-east-1a', 'us-east-1b', 'us-east-1b']);
    await e.run('autoscaling update-auto-scaling-group --auto-scaling-group-name web --min-size 1 --desired-capacity 2');
    e.acct.clock += 200000;
    expect(await e.json('autoscaling describe-auto-scaling-groups --query "length(AutoScalingGroups[0].Instances)"')).toBe(2);
    expect((await e.run('autoscaling delete-auto-scaling-group --auto-scaling-group-name web')).stderr).toContain('ResourceInUse');
    expect((await e.run('autoscaling delete-auto-scaling-group --auto-scaling-group-name web --force-delete')).code).toBe(0);
  });

  test('políticas: validaciones y alarmas de seguimiento de objetivo', async () => {
    const e = mkEnv({ scenario: 'ha-asg-sin-politica' });
    expect((await e.run('autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name p --policy-type SimpleScaling --adjustment-type ChangeInCapacity')).stderr).toContain('ScalingAdjustment is required');
    const pol = await e.json('autoscaling put-scaling-policy --auto-scaling-group-name web --policy-name cpu50 --policy-type TargetTrackingScaling --target-tracking-configuration \'{"PredefinedMetricSpecification":{"PredefinedMetricType":"ASGAverageCPUUtilization"},"TargetValue":50}\'');
    expect(pol.PolicyARN).toContain('policyName/cpu50');
    expect(pol.Alarms.map((a: any) => a.AlarmName.split('-')[2])).toEqual(['AlarmHigh', 'AlarmLow']);
    expect(await e.json('cloudwatch describe-alarms --query "MetricAlarms[?contains(AlarmName, `AlarmHigh`)].[Namespace,MetricName,Threshold,ComparisonOperator]"')).toEqual([['AWS/EC2', 'CPUUtilization', 50, 'GreaterThanThreshold']]);
    expect(await e.json('autoscaling describe-policies --query "ScalingPolicies[].PolicyName"')).toEqual(['cpu50']);
    await e.run('autoscaling delete-policy --auto-scaling-group-name web --policy-name cpu50');
    expect(await e.json('cloudwatch describe-alarms --query "length(MetricAlarms)"')).toBe(0);
  });
});

describe('Auto Scaling: bajo carga (ab)', () => {
  test('la carga sube la CPU, el grupo escala y luego vuelve a reducir', async () => {
    const t = mk('ha-asg-vivo');
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const dns = await q('aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text');
    const tg = await q('aws elbv2 describe-target-groups --names web-tg --query "TargetGroups[0].TargetGroupArn" --output text');
    // la política del escenario no está atada al balanceador: se atan el grupo y el destino
    await t.exec(`aws autoscaling attach-load-balancer-target-groups --auto-scaling-group-name web --target-group-arns ${tg}`);
    await t.exec('sleep 300');
    expect(await q(`curl -s -o /dev/null -w '%{http_code}' http://${dns}/`)).toBe('200');
    const out = await q(`ab -n 2000000 -c 200 -t 600 http://${dns}/`);
    expect(out).toContain('Requests per second');
    expect(out).toContain('Concurrency Level:      200');
    // tras 10 minutos de carga el grupo ha crecido
    const n1 = Number(await q('aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].DesiredCapacity" --output text'));
    expect(n1).toBeGreaterThan(2);
    expect(n1).toBeLessThanOrEqual(6);
    const cpu = JSON.parse(await q(`aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=AutoScalingGroupName,Value=web --start-time 2026-03-14T10:00:00Z --end-time 2026-03-14T11:00:00Z --period 300 --statistics Average`));
    expect(cpu.Datapoints.length).toBeGreaterThan(1);
    expect(Math.max(...cpu.Datapoints.map((d: any) => d.Average))).toBeGreaterThan(60);
    const acts = await q('aws autoscaling describe-scaling-activities --auto-scaling-group-name web --query "length(Activities)" --output text');
    expect(Number(acts)).toBeGreaterThan(2);
    // sin carga, tras un buen rato vuelve al mínimo
    await t.exec('sleep 3600');
    await t.exec('aws autoscaling describe-auto-scaling-groups');
    await t.exec('sleep 1200');
    expect(Number(await q('aws autoscaling describe-auto-scaling-groups --query "AutoScalingGroups[0].DesiredCapacity" --output text'))).toBe(2);
  });

  test('ab: errores de uso y destino inexistente', async () => {
    const t = mk('ha-alb');
    expect((await t.exec('ab')).err).toContain('wrong number of arguments');
    expect((await t.exec('ab -n 10 -c 50 http://x.test/')).err).toContain('concurrency level greater');
    expect((await t.exec('ab -n 10 -c 2 http://nada.test/')).err).toContain('Connection refused');
  });
});
