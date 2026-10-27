/** Utilidades de las herramientas de seguridad (Macie, Access Analyzer, Security Hub): quién aparece en una política. */
import type { Account, PolicyDoc, PolicyStatement } from '../types';
import { toArr } from '../util';

export interface Grantee {
  type: 'public' | 'account' | 'service' | 'federated';
  /** `*`, el id de cuenta de 12 cifras, el servicio o el proveedor. */
  value: string;
  /** El principal tal como aparece en la política. */
  raw: string;
}

export const statementsOf = (doc: PolicyDoc | undefined): PolicyStatement[] => (doc ? toArr(doc.Statement) : []);

const accountOf = (p: string): string | undefined => /^(\d{12})$/.exec(p)?.[1] ?? /^arn:aws[a-z-]*:iam::(\d{12}):/.exec(p)?.[1];

/** A quién concede (o niega) el permiso una sentencia. */
export function granteesOf(s: PolicyStatement): Grantee[] {
  const p = s.Principal;
  if (p === '*') return [{ type: 'public', value: '*', raw: '*' }];
  if (!p) return [];
  const out: Grantee[] = [];
  for (const v of toArr<string>(p.AWS)) {
    if (v === '*') out.push({ type: 'public', value: '*', raw: '*' });
    else out.push({ type: 'account', value: accountOf(v) ?? v, raw: v });
  }
  for (const v of toArr<string>(p.Service)) out.push({ type: 'service', value: v, raw: v });
  for (const v of toArr<string>(p.Federated)) out.push({ type: 'federated', value: v, raw: v });
  return out;
}

const condValues = (s: PolicyStatement, keys: string[]): string[] => {
  const out: string[] = [];
  for (const block of Object.values(s.Condition ?? {})) for (const [k, v] of Object.entries(block)) if (keys.some((x) => x.toLowerCase() === k.toLowerCase())) out.push(...toArr(v as string | string[]).map(String));
  return out;
};

/**
 * Las entidades de fuera de la cuenta (o de la organización) a las que una sentencia Allow da acceso. Una condición que ata el acceso
 * a la propia organización (`aws:PrincipalOrgID`) o a la propia cuenta (`aws:SourceAccount`, `aws:PrincipalAccount`) lo deja dentro.
 */
export function externalGrantees(a: Account, s: PolicyStatement): Grantee[] {
  if (s.Effect !== 'Allow') return [];
  if (a.org && condValues(s, ['aws:PrincipalOrgID', 'aws:ResourceOrgID']).includes(a.org.Id)) return [];
  const own = condValues(s, ['aws:SourceAccount', 'aws:PrincipalAccount']);
  if (own.length && own.every((x) => x === a.id)) return [];
  return granteesOf(s).filter((g) => g.type === 'public' || g.type === 'federated' || (g.type === 'account' && g.value !== a.id));
}

const LIMITING = ['aws:PrincipalOrgID', 'aws:SourceAccount', 'aws:PrincipalAccount', 'aws:SourceArn', 'aws:SourceIp', 'aws:SourceVpc', 'aws:SourceVpce', 'aws:userid'];

/** ¿Concede la sentencia acceso a cualquiera (Principal `*`) sin una condición que lo limite? */
export function isPublicStatement(s: PolicyStatement): boolean {
  return s.Effect === 'Allow' && granteesOf(s).some((g) => g.type === 'public') && condValues(s, LIMITING).length === 0;
}

export const conditionKeys = (s: PolicyStatement): string[] => Object.values(s.Condition ?? {}).flatMap((b) => Object.keys(b));
