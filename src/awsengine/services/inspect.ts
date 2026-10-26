/** Herramientas internas del corrector (solo funcionan en modo «dios»; no aparecen en la CLI del alumno). */
import { AwsError, op } from '../registry';
import { traceBetween, traceFromInternet, traceToInternet, type Proto } from '../net';
import type { Account, Ec2Instance, Ec2Region } from '../types';
import { refreshEc2 } from './ec2';
import { fetchFromInternet } from '../web';
import { healthDescription } from './elb';
import { r53Lookup } from './route53';

function findInstance(a: Account, ref: string): { inst: Ec2Instance; r: Ec2Region } {
  for (const region of Object.keys(a.regions)) {
    const r = refreshEc2(a, region);
    const inst = Object.values(r.instances).find((i) => i.state !== 'terminated' && (i.InstanceId === ref || i.Tags.some((t) => t.Key === 'Name' && t.Value === ref)));
    if (inst) return { inst, r };
  }
  throw new AwsError('InvalidInstanceID.NotFound', `La instancia «${ref}» no existe`);
}

/** `_check trace --from internet --to web --port 80`: ¿llega el paquete? Devuelve Reachable, Blocker y los saltos. */
op('_check', 'trace', 'from:s! to:s! port:i protocol:s', 'Traza un paquete entre «internet» y una instancia (por nombre o id) o entre dos instancias.', { global: true, authz: false, anon: true }, (c) => {
  const proto = (c.p.Protocol ?? 'tcp') as Proto;
  const port = c.p.Port ?? 80;
  const from = String(c.p.From);
  const to = String(c.p.To);
  const net = (s: string) => s === 'internet' || s.startsWith('internet:');
  const ip = (s: string) => (s.includes(':') ? s.split(':')[1] : undefined);
  const out = (t: ReturnType<typeof traceFromInternet>) => ({ Reachable: t.reachable, Blocker: t.blocker ?? null, Why: t.why ?? null, Hops: t.hops.map((h) => `${h.ok ? 'ok' : 'FALLA'} · ${h.step}: ${h.detail}`) });
  if (net(from)) {
    const { inst, r } = findInstance(c.acct, to);
    return out(traceFromInternet(c.acct, r, inst, proto, port, ip(from)));
  }
  const src = findInstance(c.acct, from);
  if (net(to)) return out(traceToInternet(c.acct, src.r, src.inst, proto, port, ip(to)));
  const dst = findInstance(c.acct, to);
  return out(traceBetween(c.acct, src.r, src.inst, dst.inst, proto, port));
});

/** `_check dns --name www.ejemplo.com --type A`: lo que respondería Route 53 (para comprobar registros sin conocer el id de la zona). */
op('_check', 'dns', 'name:s! type:s client:s', 'Resuelve un nombre contra las zonas de Route 53 de la cuenta (desde la IP de cliente indicada).', { global: true, authz: false, anon: true }, (c) => {
  const r = r53Lookup(c.acct, c.p.Name, c.p.Type ?? 'A', 0, { clientIp: c.p.Client });
  const first = r?.answers.find((x) => x.type === 'A')?.data;
  let instance: string | null = null;
  if (first) {
    for (const reg of Object.values(c.acct.regions)) for (const i of Object.values(reg.ec2.instances)) if (i.PublicIpAddress === first) instance = i.Tags.find((t) => t.Key === 'Name')?.Value ?? i.InstanceId;
  }
  return { NxDomain: r ? r.nxdomain : true, Instance: instance, Answers: (r?.answers ?? []).map((x) => ({ name: x.name, type: x.type, data: x.data, ttl: x.ttl })) };
});

/** `_check records --name www.tienda.test`: los registros de ese nombre (con su política) en todas las zonas. */
op('_check', 'records', 'name:s!', 'Registros DNS de un nombre y su política de enrutamiento.', { global: true, authz: false, anon: true }, (c) => {
  const n = String(c.p.Name).toLowerCase().replace(/\.?$/, '.');
  const out: Record<string, unknown>[] = [];
  for (const z of Object.values(c.acct.route53?.zones ?? {})) {
    for (const r of z.records) {
      if (r.Name !== n) continue;
      out.push({ Type: r.Type, SetIdentifier: r.SetIdentifier ?? null, Weight: r.Weight ?? null, Region: r.Region ?? null, Failover: r.Failover ?? null, Geo: r.GeoLocation ? (r.GeoLocation.CountryCode ?? r.GeoLocation.ContinentCode ?? null) : null, Alias: r.AliasTarget?.DNSName ?? null, EvaluateTargetHealth: r.AliasTarget?.EvaluateTargetHealth ?? false, HasHealthCheck: !!r.HealthCheckId, Values: (r.ResourceRecords ?? []).map((v) => v.Value) });
    }
  }
  return { Records: out };
});

/** `_check org --account desarrollo`: dónde está una cuenta de la organización (por nombre): `Root` o el nombre de la OU. */
op('_check', 'org', 'account:s!', 'Unidad organizativa (o Root) de una cuenta miembro.', { global: true, authz: false, anon: true }, (c) => {
  const o = c.acct.org;
  const acc = o && Object.values(o.accounts).find((x) => x.Name === c.p.Account || x.Id === c.p.Account);
  if (!o || !acc) throw new AwsError('AccountNotFoundException', `La cuenta «${c.p.Account}» no existe`);
  return { Parent: acc.ParentId === o.rootId ? 'Root' : o.units[acc.ParentId]?.Name ?? acc.ParentId };
});

/** `_check http --url http://www.tienda.test/`: lo que respondería la web (estado, cuerpo y cabeceras) a quien llega desde internet. */
op('_check', 'http', 'url:s!', 'Pide una URL como lo haría `curl` desde fuera de AWS.', { global: true, authz: false, anon: true }, (c) => {
  // `http://lb:mi-alb/` = el balanceador con ese nombre; `http://cf:first/` = la primera distribución de CloudFront
  const url = String(c.p.Url)
    .replace(/^((?:https?:\/\/)?)lb:([^/]+)/, (_m, pre: string, name: string) => pre + (Object.values(c.acct.regions).flatMap((r) => Object.values(r.elb?.lbs ?? {})).find((l) => l.LoadBalancerName === name)?.DNSName ?? name))
    .replace(/^((?:https?:\/\/)?)cf:first/, (_m, pre: string) => pre + (Object.values(c.acct.cloudfront?.distributions ?? {})[0]?.DomainName ?? 'sin-distribucion'));
  const r = fetchFromInternet(c.acct, url);
  if (!r.ok) return { Status: 0, Error: r.error ?? `curl ${r.curlCode}`, CurlCode: r.curlCode ?? 0 };
  return { Status: r.status ?? 0, Body: (r.body ?? '').trim(), Server: r.headers?.Server ?? null, Location: r.headers?.Location ?? null, XCache: r.headers?.['X-Cache'] ?? null, Region: r.headers?.['x-amz-ga-region'] ?? null };
});

/** `_check spof`: los puntos únicos de fallo que quedan (grupos de una sola zona o de una sola instancia, bases de datos sin Multi-AZ). */
op('_check', 'spof', '', 'Lista los puntos únicos de fallo de la cuenta.', { global: true, authz: false, anon: true }, (c) => {
  const issues: string[] = [];
  for (const region of Object.keys(c.acct.regions)) {
    const r = c.acct.regions[region];
    for (const g of Object.values(r.asg?.groups ?? {})) {
      if (g.AvailabilityZones.length < 2) issues.push(`asg:${g.AutoScalingGroupName}:una-sola-zona`);
      if (g.MinSize < 2) issues.push(`asg:${g.AutoScalingGroupName}:minimo-1`);
    }
    for (const lb of Object.values(r.elb?.lbs ?? {})) {
      const azs = new Set(lb.subnetIds.map((id) => r.ec2.subnets[id]?.AvailabilityZone));
      if (lb.Type === 'application' && azs.size < 2) issues.push(`alb:${lb.LoadBalancerName}:una-sola-zona`);
    }
    for (const db of Object.values(r.rds?.instances ?? {})) if (!db.MultiAZ && !db.DBClusterIdentifier && db.status !== 'deleting') issues.push(`rds:${db.DBInstanceIdentifier}:sin-multi-az`);
  }
  return { Issues: issues.sort() };
});

/** `_check targets --group web-tg`: el estado de salud de cada destino de un grupo (por nombre). */
op('_check', 'targets', 'group:s!', 'Estado de salud de los destinos de un grupo de destino.', { global: true, authz: false, anon: true }, (c) => {
  for (const region of Object.keys(c.acct.regions)) {
    const tg = Object.values(c.acct.regions[region].elb?.tgs ?? {}).find((t) => t.TargetGroupName === c.p.Group);
    if (tg) return { States: healthDescription(c.acct, region, tg).map((d) => d.TargetHealth.State).sort(), Count: tg.targets.length };
  }
  throw new AwsError('TargetGroupNotFound', `El grupo «${c.p.Group}» no existe`);
});
