/** Herramientas internas del corrector (solo funcionan en modo «dios»; no aparecen en la CLI del alumno). */
import { AwsError, op } from '../registry';
import { traceBetween, traceFromInternet, traceToInternet, type Proto } from '../net';
import type { Account, Ec2Instance, Ec2Region } from '../types';
import { refreshEc2 } from './ec2';
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
op('_check', 'dns', 'name:s! type:s', 'Resuelve un nombre contra las zonas de Route 53 de la cuenta.', { global: true, authz: false, anon: true }, (c) => {
  const r = r53Lookup(c.acct, c.p.Name, c.p.Type ?? 'A');
  return { NxDomain: r ? r.nxdomain : true, Answers: (r?.answers ?? []).map((x) => ({ name: x.name, type: x.type, data: x.data, ttl: x.ttl })) };
});

/** `_check org --account desarrollo`: dónde está una cuenta de la organización (por nombre): `Root` o el nombre de la OU. */
op('_check', 'org', 'account:s!', 'Unidad organizativa (o Root) de una cuenta miembro.', { global: true, authz: false, anon: true }, (c) => {
  const o = c.acct.org;
  const acc = o && Object.values(o.accounts).find((x) => x.Name === c.p.Account || x.Id === c.p.Account);
  if (!o || !acc) throw new AwsError('AccountNotFoundException', `La cuenta «${c.p.Account}» no existe`);
  return { Parent: acc.ParentId === o.rootId ? 'Root' : o.units[acc.ParentId]?.Name ?? acc.ParentId };
});
