/** Herramientas internas del corrector (solo funcionan en modo «dios»; no aparecen en la CLI del alumno). */
import { AwsError, op } from '../registry';
import { type Proto } from '../net';
import { ON_PREM_CIDR } from '../onprem';
import { pathBetween, pathFromInstance, pathFromOnPrem, pathInternet, pathToEndpoint, type PathResult } from '../netpath';
import type { Account, Ec2Instance, Ec2Region } from '../types';
import { toArr } from '../util';
import { refreshEc2 } from './ec2';
import { ssmStatus } from './ssm';
import { fetchFromInternet } from '../web';
import { healthDescription } from './elb';
import { apiHost } from './apigw';
import { mintIdToken } from './cognito';
import { resolveFn, runFunction } from './lambda';
import { getBucket, s3Put } from './s3';
import { r53Lookup } from './route53';

function findInstance(a: Account, ref: string): { inst: Ec2Instance; r: Ec2Region } {
  for (const region of Object.keys(a.regions)) {
    const r = refreshEc2(a, region);
    const inst = Object.values(r.instances).find((i) => i.state !== 'terminated' && (i.InstanceId === ref || i.Tags.some((t) => t.Key === 'Name' && t.Value === ref)));
    if (inst) return { inst, r };
  }
  throw new AwsError('InvalidInstanceID.NotFound', `La instancia «${ref}» no existe`);
}

/**
 * `_check trace --from internet --to web --port 80`: ¿llega el paquete? Devuelve Reachable, Blocker, Code y los saltos.
 * Orígenes y destinos: «internet» (o `internet:IP`), una instancia (nombre o id), `onprem` (la oficina, por VPN),
 * `ip:10.1.2.3` (una IP privada de otra red) y, como destino, `vpce:s3` (un endpoint de ese servicio en la VPC del origen).
 */
op('_check', 'trace', 'from:s! to:s! port:i protocol:s', 'Traza un paquete entre «internet», la oficina (onprem) o instancias (por nombre o id).', { global: true, authz: false, anon: true }, (c) => {
  const proto = (c.p.Protocol ?? 'tcp') as Proto;
  const port = c.p.Port ?? 80;
  const from = String(c.p.From);
  const to = String(c.p.To);
  const net = (s: string) => s === 'internet' || s.startsWith('internet:');
  const ip = (s: string) => (s.includes(':') ? s.slice(s.indexOf(':') + 1) : undefined);
  const out = (t: PathResult) => ({ Reachable: t.reachable, Blocker: t.blocker ?? null, Code: t.code ?? null, Why: t.why ?? null, Hops: t.hops.map((h) => `${h.ok ? 'ok' : 'FALLA'} · ${h.step}: ${h.detail}`) });
  const regionOf = (r: Ec2Region) => Object.keys(c.acct.regions).find((k) => c.acct.regions[k].ec2 === r) ?? c.region;
  if (net(from)) {
    const { inst, r } = findInstance(c.acct, to);
    return out(pathInternet(c.acct, regionOf(r), inst, 'in', proto, port, ip(from)));
  }
  if (from === 'onprem') {
    const { inst, r } = findInstance(c.acct, to);
    return out(pathFromOnPrem(c.acct, regionOf(r), inst, proto, port));
  }
  const src = findInstance(c.acct, from);
  const region = regionOf(src.r);
  if (net(to)) return out(pathInternet(c.acct, region, src.inst, 'out', proto, port, ip(to)));
  if (to === 'onprem') return out(pathFromInstance(c.acct, region, src.inst, ON_PREM_CIDR.replace(/\.0\.0\/16$/, '.1.10'), null, proto, port));
  if (to.startsWith('ip:')) return out(pathFromInstance(c.acct, region, src.inst, ip(to)!, null, proto, port));
  if (to.startsWith('vpce:')) {
    const svc = `com.amazonaws.${region}.${to.slice(5)}`;
    const e = Object.values(src.r.endpoints ?? {}).find((x) => x.VpcId === src.inst.VpcId && x.ServiceName === svc && x.State !== 'deleted');
    if (!e) return out({ reachable: false, hops: [{ step: 'Endpoint', ok: false, detail: `No hay ningún endpoint de ${svc} en ${src.inst.VpcId}.` }], blocker: 'endpoint', why: 'Crea el endpoint de ese servicio en la VPC.', path: [], code: 'VPC_ENDPOINT_NOT_REACHABLE' });
    return out(pathToEndpoint(c.acct, region, src.inst, e.VpcEndpointId, port === 80 ? 443 : port));
  }
  const dst = findInstance(c.acct, to);
  return out(pathBetween(c.acct, region, src.inst, dst.inst, proto, port));
});

/** `_check ssm --instance web`: ¿está la instancia administrada por Systems Manager? (`Online` y, si no, el motivo). */
op('_check', 'ssm', 'instance:s!', 'Estado de una instancia en Systems Manager (Online o el motivo).', { global: true, authz: false, anon: true }, (c) => {
  const { inst } = findInstance(c.acct, String(c.p.Instance));
  const region = inst.AvailabilityZone.slice(0, -1);
  const s = ssmStatus(c.acct, region, inst, { settled: true });
  return { Online: s.online, Reason: s.reason };
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
op('_check', 'http', 'url:s! method:s body:s header:l bearer-of:s', 'Pide una URL como lo haría `curl` desde fuera de AWS (con `--method`, `--body` y `--header "Nombre: valor"` si hace falta).', { global: true, authz: false, anon: true }, (c) => {
  // `http://lb:mi-alb/` = el balanceador con ese nombre; `http://cf:first/` = la primera distribución de CloudFront; `api:first/ruta` = la primera API HTTP
  const url = String(c.p.Url)
    .replace(/^((?:https?:\/\/)?)api:first/, (_m, pre: string) => (pre || 'https://') + (Object.entries(c.acct.regions).flatMap(([region, r]) => Object.values(r.apigw?.apis ?? {}).map((x) => apiHost(x.ApiId, region)))[0] ?? 'sin-api.execute-api.us-east-1.amazonaws.com'))
    .replace(/^((?:https?:\/\/)?)lb:([^/]+)/, (_m, pre: string, name: string) => pre + (Object.values(c.acct.regions).flatMap((r) => Object.values(r.elb?.lbs ?? {})).find((l) => l.LoadBalancerName === name)?.DNSName ?? name))
    .replace(/^((?:https?:\/\/)?)cf:first/, (_m, pre: string) => pre + (Object.values(c.acct.cloudfront?.distributions ?? {})[0]?.DomainName ?? 'sin-distribucion'))
    // `https://apprunner:tienda/` = la URL del servicio de App Runner con ese nombre; `http://k8s:web/` = el balanceador del servicio `web` de Kubernetes
    .replace(/^((?:https?:\/\/)?)apprunner:([^/]+)/, (_m, pre: string, name: string) => pre + (Object.values(c.acct.regions).flatMap((r) => Object.values(r.apprunner?.services ?? {})).find((x) => x.name === name && x.status !== 'DELETED')?.url ?? name))
    .replace(/^((?:https?:\/\/)?)k8s:([^/]+)/, (_m, pre: string, name: string) => pre + (Object.values(c.acct.regions).flatMap((r) => Object.values(r.eks?.clusters ?? {})).flatMap((cl) => Object.values(cl.k8s.services)).find((x) => x.name === name && x.lb && c.acct.clock >= x.lb.readyAt)?.lb?.dns ?? name));
  const headers: Record<string, string> = Object.fromEntries(toArr<string>(c.p.Header).map((h) => [h.slice(0, h.indexOf(':')).trim().toLowerCase(), h.slice(h.indexOf(':') + 1).trim()]));
  // `--bearer-of ana@tienda.es`: pide la URL con el token de identidad de ese usuario de Cognito
  if (c.p.BearerOf) {
    const tok = mintIdToken(c.acct, c.p.BearerOf);
    if (!tok) throw new AwsError('UserNotFoundException', `No hay un usuario confirmado «${c.p.BearerOf}» en Cognito`);
    headers.authorization = `Bearer ${tok}`;
  }
  const r = fetchFromInternet(c.acct, url, { method: c.p.Method ?? (c.p.Body ? 'POST' : 'GET'), body: c.p.Body, headers });
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

/** `_check invoke --function f --payload '{}'`: ejecuta la función y devuelve su resultado (en la copia de la cuenta que usa el corrector). */
op('_check', 'invoke', 'function:s! payload:s qualifier:s', 'Ejecuta una función Lambda y devuelve estado, error, resultado y duración.', { global: true, authz: false, anon: true }, (c) => {
  const { fn, qualifier, region } = resolveFn(c.acct, c.region, c.p.Qualifier ? `${c.p.Function}:${c.p.Qualifier}` : c.p.Function);
  const out = runFunction(c.acct, region, fn, qualifier, c.p.Payload ?? '{}');
  c.acct.clock += Math.ceil(out.durationMs);
  let payload: unknown = out.payload;
  try {
    payload = JSON.parse(out.payload);
  } catch {
    /* texto */
  }
  return { StatusCode: out.statusCode, FunctionError: out.functionError ?? null, Payload: payload, DurationMs: Math.round(out.durationMs), ColdStart: out.initMs !== undefined, Logs: out.logs };
});

/** `_check put --bucket b --key k --body texto`: sube un objeto como si alguien lo hubiera subido (dispara las notificaciones del bucket). */
op('_check', 'put', 'bucket:s! key:s! body:s', 'Sube un objeto a un bucket (y dispara sus notificaciones de eventos).', { global: true, authz: false, anon: true }, (c) => {
  s3Put(c.acct, getBucket(c.acct, c.p.Bucket), c.p.Key, c.p.Body ?? '');
  return { Put: `${c.p.Bucket}/${c.p.Key}` };
});

/** `_check cognito`: resumen del primer grupo de usuarios (clientes con sus flujos y usuarios con su estado). */
op('_check', 'cognito', '', 'Resumen del primer grupo de usuarios de Cognito de la cuenta.', { global: true, authz: false, anon: true }, (c) => {
  const pool = Object.values(c.acct.regions).flatMap((r) => Object.values(r.cognito?.pools ?? {}))[0];
  if (!pool) return { Pools: 0, Clients: [], Users: [] };
  return { Pools: 1, Id: pool.Id, Clients: Object.values(pool.clients).map((k) => ({ ClientName: k.ClientName, Flows: k.ExplicitAuthFlows })), Users: Object.values(pool.users).map((u) => ({ Username: u.Username, Status: u.status, Groups: u.groups })) };
});

/** `_check load --lb web --rps 120 --minutes 20`: aplica carga sostenida a un balanceador (como lo haría `ab`) para ver cómo reacciona el escalado. */
op('_check', 'load', 'lb:s! rps:n! minutes:n', 'Carga sostenida contra un balanceador (por nombre).', { global: true, authz: false, anon: true }, (c) => {
  for (const [region, r] of Object.entries(c.acct.regions)) {
    const lb = Object.values(r.elb?.lbs ?? {}).find((l) => l.LoadBalancerName === c.p.Lb);
    if (!lb) continue;
    c.acct.loads = [...(c.acct.loads ?? []), { lbArn: lb.LoadBalancerArn, region, rps: Number(c.p.Rps), from: c.acct.clock, until: c.acct.clock + Number(c.p.Minutes ?? 10) * 60000 }];
    return { Started: true };
  }
  throw new AwsError('LoadBalancerNotFound', `El balanceador «${c.p.Lb}» no existe`);
});
