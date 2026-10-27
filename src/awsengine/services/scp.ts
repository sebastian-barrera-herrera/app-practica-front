/**
 * Evaluación de políticas de control de servicios (SCP): para una cuenta miembro, la petición tiene que estar permitida en CADA nivel
 * del camino (raíz → unidades organizativas → cuenta) y no negada en ninguno. Una SCP nunca concede permisos: solo fija el techo.
 * No se aplican a la cuenta de administración.
 */
import { AwsError, op } from '../registry';
import { evaluate, type PolicySource } from '../policy';
import type { Account, OrgPolicy, Organization } from '../types';

export interface ScpLevel {
  /** `Root`, el nombre de la unidad o el de la cuenta. */
  name: string;
  id: string;
  policies: OrgPolicy[];
}

/** Los niveles, de la raíz a la cuenta, con las SCP aplicadas directamente en cada uno. */
export function scpChain(o: Organization, accountId: string): ScpLevel[] {
  const acc = o.accounts[accountId];
  if (!acc) return [];
  const path: { id: string; name: string }[] = [{ id: acc.Id, name: acc.Name }];
  let parent = acc.ParentId;
  while (parent) {
    if (parent === o.rootId) {
      path.push({ id: o.rootId, name: 'Root' });
      break;
    }
    const u = o.units[parent];
    if (!u) break;
    path.push({ id: u.Id, name: u.Name });
    parent = u.ParentId;
  }
  return path.reverse().map((p) => ({ name: p.name, id: p.id, policies: Object.values(o.policies).filter((x) => x.Type === 'SERVICE_CONTROL_POLICY' && x.targets.includes(p.id)) }));
}

export interface ScpVerdict {
  allowed: boolean;
  /** Dónde se decide: el nivel que niega o el primero que no permite. */
  level?: string;
  reason: 'allowed' | 'explicitDeny' | 'noAllow' | 'management';
  policy?: string;
}

/** Evalúa `action` sobre `resource` para una cuenta miembro (o para su usuario root: las SCP también lo limitan). */
export function scpEvaluate(a: Account, accountId: string, action: string, resource = '*', context: Record<string, string | number | boolean> = {}): ScpVerdict {
  const o = a.org;
  if (!o) throw new AwsError('AWSOrganizationsNotInUseException', 'Your account is not a member of an organization.');
  if (accountId === a.id) return { allowed: true, reason: 'management' };
  const chain = scpChain(o, accountId);
  for (const lv of chain) {
    const sources: PolicySource[] = lv.policies.map((p) => ({ name: p.Name, kind: 'scp' as const, doc: JSON.parse(p.Content) }));
    // un nivel sin ninguna SCP no permite nada (siempre debe haber al menos una; por defecto, FullAWSAccess)
    if (!sources.length) return { allowed: false, level: lv.name, reason: 'noAllow' };
    // una identidad con permiso total deja que solo decida la SCP (que nunca concede, solo limita)
    const everything: PolicySource = { name: 'identidad', kind: 'identity', doc: { Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] } };
    const r = evaluate({ action, resource, principalArn: `arn:aws:iam::${accountId}:user/x`, principalAccount: accountId, policies: [...sources, everything], context });
    if (r.decision === 'explicitDeny') return { allowed: false, level: lv.name, reason: 'explicitDeny', policy: r.matched[0]?.source };
    if (r.decision !== 'allowed') return { allowed: false, level: lv.name, reason: 'noAllow' };
  }
  return { allowed: true, reason: 'allowed' };
}

/** `_check scp --account desarrollo --action ec2:RunInstances --resource '*'`: ¿pueden las SCP actuales con esa acción en esa cuenta? */
op('_check', 'scp', 'account:s! action:s! resource:s context:f', 'Evalúa las SCP del camino (raíz → unidades → cuenta) para una acción en una cuenta miembro.', { global: true, authz: false, anon: true }, (c) => {
  const o = c.acct.org;
  if (!o) throw new AwsError('AWSOrganizationsNotInUseException', 'Your account is not a member of an organization.');
  const acc = Object.values(o.accounts).find((x) => x.Name === c.p.Account || x.Id === c.p.Account);
  if (!acc) throw new AwsError('AccountNotFoundException', `La cuenta «${c.p.Account}» no existe`);
  const ctx = Object.fromEntries(Object.entries(Object.assign({}, ...(Array.isArray(c.p.Context) ? c.p.Context : c.p.Context ? [c.p.Context] : [])) as Record<string, string>).map(([k, v]) => [k, v]));
  const v = scpEvaluate(c.acct, acc.Id, String(c.p.Action), String(c.p.Resource ?? '*'), ctx);
  return { Allowed: v.allowed, Reason: v.reason, Level: v.level ?? null, Policy: v.policy ?? null, Chain: scpChain(o, acc.Id).map((l) => ({ Level: l.name, Policies: l.policies.map((p) => p.Name) })) };
});
