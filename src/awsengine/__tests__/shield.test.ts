import { Terminal } from '../../engine/terminal';
import { mkEnv, type TestEnv } from './helpers';

/** Consulta de solo lectura del corrector (`_check …`), que necesita el modo «dios». */
async function chk(e: TestEnv, line: string) {
  e.io.god = true;
  try {
    return await e.json(`_check ${line}`);
  } finally {
    e.io.god = false;
  }
}

describe('Shield', () => {
  test('sin suscripción solo hay Shield Standard; Advanced cuesta 3 000 $/mes y protege recursos concretos', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    expect((await e.json('shield get-subscription-state')).SubscriptionState).toBe('INACTIVE');
    expect((await e.run('shield describe-subscription')).stderr).toContain('ResourceNotFoundException');
    const lb = (await e.json('elbv2 describe-load-balancers --names web')).LoadBalancers[0] as { LoadBalancerArn: string };
    expect((await e.run(`shield create-protection --name alb --resource-arn ${lb.LoadBalancerArn}`)).stderr).toContain('ResourceNotFoundException');
    const burn0 = (await chk(e, 'burn')).Monthly as number;
    expect((await e.run('shield create-subscription')).stderr).toBe('');
    expect((await e.run('shield create-subscription')).stderr).toContain('ResourceAlreadyExistsException');
    expect((await e.json('shield get-subscription-state')).SubscriptionState).toBe('ACTIVE');
    expect((await e.json('shield describe-subscription')).Subscription.TimeCommitmentInSeconds).toBe(31536000);
    expect((await chk(e, 'burn')).Monthly).toBeCloseTo(burn0 + 3000, 1);
    const p = await e.json(`shield create-protection --name alb --resource-arn ${lb.LoadBalancerArn}`);
    expect((await e.run(`shield create-protection --name otra --resource-arn ${lb.LoadBalancerArn}`)).stderr).toContain('ResourceAlreadyExistsException');
    expect((await e.json('shield list-protections')).Protections).toHaveLength(1);
    expect((await e.json(`shield describe-protection --resource-arn ${lb.LoadBalancerArn}`)).Protection.Id).toBe(p.ProtectionId);
    expect((await e.run('shield create-protection --name x --resource-arn arn:aws:s3:::bucket')).stderr).toContain('InvalidResourceException');
    expect((await e.run('shield create-protection --name x --resource-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/no/abc')).stderr).toContain('InvalidResourceException');
    expect((await e.run(`shield delete-protection --protection-id ${p.ProtectionId}`)).stderr).toBe('');
    expect((await e.json('shield list-protections')).Protections).toHaveLength(0);
    expect((await e.json('shield list-attacks')).AttackSummaries).toEqual([]);
  });
});

describe('_check http con origen y ráfaga', () => {
  test('--from-ip cambia el origen y --count devuelve cuántas respuestas hubo de cada estado', async () => {
    const e = mkEnv({ scenario: 'cont-ecs' });
    const lb = (await e.json('elbv2 describe-load-balancers --names web')).LoadBalancers[0] as { LoadBalancerArn: string };
    e.write('r.json', JSON.stringify([{ Name: 'Limite', Priority: 1, Statement: { RateBasedStatement: { Limit: 100, AggregateKeyType: 'IP', EvaluationWindowSec: 60 } }, Action: { Block: {} }, VisibilityConfig: { SampledRequestsEnabled: true, CloudWatchMetricsEnabled: true, MetricName: 'Limite' } }]));
    const acl = (await e.json('wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --rules file://r.json --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=t')).Summary as { ARN: string };
    await e.run(`wafv2 associate-web-acl --web-acl-arn ${acl.ARN} --resource-arn ${lb.LoadBalancerArn}`);
    const flood = await chk(e, 'http --url http://lb:web/ --count 150');
    expect(flood.Sent).toBe(150);
    expect(flood.Statuses['403']).toBe(50);
    const other = await chk(e, 'http --url http://lb:web/ --from-ip 198.51.100.9 --count 20');
    expect(other.Statuses['403']).toBeUndefined();
  });

  test('ab pasa la ráfaga por la ACL: lo que supera el límite cuenta como respuestas no 2xx', async () => {
    const t = new Terminal({ instant: true, aws: 'ha-alb' });
    const q = async (c: string) => (await t.exec(c)).out.trim();
    const dns = await q('aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].DNSName" --output text');
    const arn = await q('aws elbv2 describe-load-balancers --names tienda-alb --query "LoadBalancers[0].LoadBalancerArn" --output text');
    await t.exec(`echo '[{"Name":"Limite","Priority":1,"Statement":{"RateBasedStatement":{"Limit":100,"AggregateKeyType":"IP","EvaluationWindowSec":60}},"Action":{"Block":{}},"VisibilityConfig":{"SampledRequestsEnabled":false,"CloudWatchMetricsEnabled":false,"MetricName":"Limite"}}]' > r.json`);
    const acl = await q('aws wafv2 create-web-acl --name t --scope REGIONAL --default-action Allow={} --rules file://r.json --visibility-config SampledRequestsEnabled=false,CloudWatchMetricsEnabled=false,MetricName=t --query Summary.ARN --output text');
    await t.exec(`aws wafv2 associate-web-acl --web-acl-arn ${acl} --resource-arn ${arn}`);
    expect(await q(`curl -s -o /dev/null -w '%{http_code}' http://${dns}/`)).toBe('200');
    const out = await q(`ab -n 300 -c 10 http://${dns}/`);
    expect(out).toMatch(/Non-2xx responses:\s+20\d/);
  });
});
