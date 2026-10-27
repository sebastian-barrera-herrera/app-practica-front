/**
 * AWS Shield: Standard protege todo gratis y sin configurar; Advanced (3 000 $/mes, un año de compromiso) añade protecciones
 * por recurso (balanceadores, CloudFront, IP elásticas, zonas de Route 53, aceleradores), respuesta y reembolso de picos.
 */
import { AwsError, op } from '../registry';
import type { Account } from '../types';
import type { ShieldState } from '../types-sec';
import { iso, mkArn, newId } from '../util';
import { gas } from './edge';
import { elb } from './elb';

const YEAR = 365 * 86400000;

export const shieldOf = (a: Account): ShieldState => (a.shield ??= { protections: {} });

const noSub = () => new AwsError('ResourceNotFoundException', 'The subscription does not exist.', 400);

const view = (p: ShieldState['protections'][string]) => ({ Id: p.Id, Name: p.Name, ResourceArn: p.ResourceArn, HealthCheckIds: [], ProtectionArn: p.ProtectionArn });

/** ¿Existe el recurso y Shield Advanced puede protegerlo? */
function resourceExists(a: Account, arn: string): boolean {
  let m = /^arn:aws:elasticloadbalancing:([a-z0-9-]+):\d{12}:loadbalancer\/app\//.exec(arn);
  if (m) return !!elb(a, m[1]).lbs[arn];
  m = /^arn:aws:cloudfront::\d{12}:distribution\/([A-Z0-9]+)$/.exec(arn);
  if (m) return !!a.cloudfront?.distributions[m[1]];
  m = /^arn:aws:ec2:([a-z0-9-]+):\d{12}:eip-allocation\/(eipalloc-[0-9a-f]+)$/.exec(arn);
  if (m) return !!a.regions[m[1]]?.ec2.addresses[m[2]];
  m = /^arn:aws:route53:::hostedzone\/([A-Z0-9]+)$/.exec(arn);
  if (m) return !!a.route53?.zones[m[1]];
  if (arn.startsWith('arn:aws:globalaccelerator::')) return !!gas(a)[arn];
  throw new AwsError('InvalidResourceException', 'Unrecognized resource type: Shield Advanced protects Application Load Balancers, CloudFront distributions, Elastic IP addresses, Route 53 hosted zones and Global Accelerator accelerators.', 400);
}

op('shield', 'get-subscription-state', '', 'Si la cuenta tiene Shield Advanced (`ACTIVE`) o solo el Shield Standard gratuito (`INACTIVE`).', { global: true, res: () => '*' }, (c) => ({ SubscriptionState: shieldOf(c.acct).subscription ? 'ACTIVE' : 'INACTIVE' }));

op('shield', 'create-subscription', '', 'Contrata Shield Advanced: 3 000 $ al mes durante un año (se renueva solo).', { global: true, res: () => '*' }, (c) => {
  const s = shieldOf(c.acct);
  if (s.subscription) throw new AwsError('ResourceAlreadyExistsException', 'The subscription already exists.', 400);
  s.subscription = { start: c.acct.clock, end: c.acct.clock + YEAR, autoRenew: true };
  return {};
});

op('shield', 'describe-subscription', '', 'Datos de la suscripción a Shield Advanced.', { global: true, res: () => '*' }, (c) => {
  const sub = shieldOf(c.acct).subscription;
  if (!sub) throw noSub();
  return {
    Subscription: {
      StartTime: iso(sub.start),
      EndTime: iso(sub.end),
      TimeCommitmentInSeconds: 31536000,
      AutoRenew: sub.autoRenew ? 'ENABLED' : 'DISABLED',
      Limits: [
        { Type: 'ELASTIC_IP_ADDRESS', Max: 1000 },
        { Type: 'APPLICATION_LOAD_BALANCER', Max: 1000 },
        { Type: 'CLOUDFRONT_DISTRIBUTION', Max: 1000 },
      ],
      ProactiveEngagementStatus: 'DISABLED',
      SubscriptionLimits: { ProtectionLimits: { ProtectedResourceTypeLimits: [{ Type: 'APPLICATION_LOAD_BALANCER', Max: 1000 }] }, ProtectionGroupLimits: { MaxProtectionGroups: 100 } },
      SubscriptionArn: mkArn('shield', '', c.acct.id, 'subscription/' + newId(c.acct, 'shsub', '', 12, 'hex')),
    },
  };
});

op('shield', 'update-subscription', 'auto-renew:s', 'Cambia la renovación automática de la suscripción.', { global: true, res: () => '*' }, (c) => {
  const sub = shieldOf(c.acct).subscription;
  if (!sub) throw noSub();
  if (c.p.AutoRenew !== undefined) {
    if (!['ENABLED', 'DISABLED'].includes(String(c.p.AutoRenew))) throw new AwsError('InvalidParameterException', 'AutoRenew must be ENABLED or DISABLED.', 400);
    sub.autoRenew = c.p.AutoRenew === 'ENABLED';
  }
  return {};
});

op('shield', 'create-protection', 'name:s! resource-arn:s! tags:f', 'Protege un recurso con Shield Advanced.', { global: true, res: (c) => String(c.p.ResourceArn ?? '*') }, (c) => {
  const s = shieldOf(c.acct);
  if (!s.subscription) throw noSub();
  const arn = String(c.p.ResourceArn);
  if (!resourceExists(c.acct, arn)) throw new AwsError('InvalidResourceException', 'The referenced resource does not exist.', 400);
  if (Object.values(s.protections).some((p) => p.ResourceArn === arn)) throw new AwsError('ResourceAlreadyExistsException', 'The referenced protection already exists.', 400);
  const id = newId(c.acct, 'shprot', '', 8, 'hex') + '-' + newId(c.acct, 'shprot2', '', 4, 'hex') + '-' + newId(c.acct, 'shprot3', '', 4, 'hex') + '-' + newId(c.acct, 'shprot4', '', 12, 'hex');
  s.protections[id] = { Id: id, Name: String(c.p.Name), ResourceArn: arn, ProtectionArn: mkArn('shield', '', c.acct.id, `protection/${id}`), created: c.acct.clock };
  return { ProtectionId: id };
});

op('shield', 'list-protections', 'max-results:i next-token:s', 'Los recursos protegidos con Shield Advanced.', { global: true, res: () => '*' }, (c) => ({ Protections: Object.values(shieldOf(c.acct).protections).map(view) }));

op('shield', 'describe-protection', 'protection-id:s resource-arn:s', 'Una protección, por su id o por el recurso que protege.', { global: true, res: () => '*' }, (c) => {
  const s = shieldOf(c.acct);
  if (!c.p.ProtectionId && !c.p.ResourceArn) throw new AwsError('InvalidParameterException', 'You must specify either ProtectionId or ResourceArn.', 400);
  const p = Object.values(s.protections).find((x) => x.Id === c.p.ProtectionId || x.ResourceArn === c.p.ResourceArn);
  if (!p) throw new AwsError('ResourceNotFoundException', 'The referenced protection does not exist.', 400);
  return { Protection: view(p) };
});

op('shield', 'delete-protection', 'protection-id:s!', 'Quita la protección de un recurso.', { global: true, res: () => '*' }, (c) => {
  const s = shieldOf(c.acct);
  if (!s.protections[String(c.p.ProtectionId)]) throw new AwsError('ResourceNotFoundException', 'The referenced protection does not exist.', 400);
  delete s.protections[String(c.p.ProtectionId)];
  return {};
});

op('shield', 'list-attacks', 'resource-arns:l start-time:j end-time:j max-results:i next-token:s', 'Ataques DDoS detectados contra tus recursos protegidos.', { global: true, res: () => '*' }, (c) => {
  if (!shieldOf(c.acct).subscription) throw noSub();
  return { AttackSummaries: [] };
});
