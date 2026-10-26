/** Cuentas de partida de las lecciones y retos. Cada escenario es una función que construye una cuenta nueva. */
import { newAccount } from './account';
import { configSection, stringifyIni, type Ini } from './creds';
import { iamCreateGroup, iamCreatePolicy, iamCreateRole, iamCreateUser } from './services/iam';
import type { Account } from './types';
import { secretFor } from './util';

export interface AwsSetup {
  /** Escenario de partida (por defecto `base`). */
  scenario?: string;
  /** Usuario cuyas credenciales usa el perfil `default` (por defecto `alumno`). */
  as?: string;
  /** Región por defecto de la CLI (por defecto `us-east-1`; `''` = sin región configurada). */
  region?: string;
  /** Sin credenciales configuradas (para practicar `aws configure`). */
  noCredentials?: boolean;
  /** Formato de salida por defecto. */
  output?: string;
  /** Ajustes sobre la cuenta ya construida. */
  tweak?: (a: Account) => void;
}

export type Scenario = (a: Account) => void;

const TRUST_ACCOUNT = (id: string) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow' as const, Principal: { AWS: `arn:aws:iam::${id}:root` }, Action: 'sts:AssumeRole' }] });
const TRUST_EC2 = { Version: '2012-10-17', Statement: [{ Effect: 'Allow' as const, Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] };

/** Una cuenta con un único usuario administrador, `alumno`, y una clave de acceso. */
const base: Scenario = (a) => {
  iamCreateUser(a, 'alumno', { attached: ['AdministratorAccess'], keys: 1, password: true });
};

/** Un equipo pequeño: grupos de desarrollo y administración, un auditor y un rol. */
const equipo: Scenario = (a) => {
  base(a);
  iamCreateGroup(a, 'desarrolladores', { attached: ['AmazonS3ReadOnlyAccess'] });
  iamCreateGroup(a, 'admins', { attached: ['AdministratorAccess'] });
  iamCreateUser(a, 'ana', { groups: ['desarrolladores'], keys: 1, password: true, tags: [{ Key: 'equipo', Value: 'web' }] });
  iamCreateUser(a, 'bob', { groups: ['desarrolladores'], keys: 1, tags: [{ Key: 'equipo', Value: 'datos' }] });
  iamCreateUser(a, 'carla', { groups: ['admins'], keys: 1, password: true, mfa: true });
  iamCreateRole(a, 'Auditor', TRUST_ACCOUNT(a.id), { attached: ['SecurityAudit'], description: 'Solo lectura para auditorías' });
  iamCreateRole(a, 'ServidorWeb', TRUST_EC2, { attached: ['AmazonS3ReadOnlyAccess'], description: 'Para instancias EC2' });
  iamCreatePolicy(a, 'LeerInformes', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::informes-empresa', 'arn:aws:s3:::informes-empresa/*'] }],
  });
};

export const SCENARIOS: Record<string, Scenario> = { base, empty: base, equipo };

export function registerScenario(id: string, fn: Scenario): void {
  SCENARIOS[id] = fn;
}

export function buildAccount(setup: AwsSetup = {}): Account {
  const a = newAccount();
  const fn = SCENARIOS[setup.scenario ?? 'base'];
  if (!fn) throw new Error(`Escenario de AWS desconocido: ${setup.scenario}`);
  fn(a);
  setup.tweak?.(a);
  return a;
}

/** Archivos `~/.aws/credentials` y `~/.aws/config` para que cada usuario con clave tenga su perfil. */
export function profileFiles(a: Account, setup: AwsSetup = {}): Record<string, string> {
  const who = setup.as ?? 'alumno';
  const creds: Ini = {};
  const config: Ini = {};
  const region = setup.region ?? 'us-east-1';
  const cfg = (extra: Record<string, string> = {}) => ({ ...(region ? { region } : {}), output: setup.output ?? 'json', ...extra });
  const entry = (u: string) => {
    const k = a.iam.users[u]?.accessKeys[0];
    return k ? { aws_access_key_id: k.AccessKeyId, aws_secret_access_key: secretFor(k.AccessKeyId) } : null;
  };
  if (!setup.noCredentials) {
    const d = entry(who) ?? (Object.keys(a.iam.users).map(entry).find(Boolean) as ReturnType<typeof entry>);
    if (d) creds.default = d;
    for (const u of Object.keys(a.iam.users)) {
      const e = entry(u);
      if (e && u !== who) creds[u] = e;
    }
  }
  if (!setup.noCredentials || region) config[configSection('default')] = cfg();
  if (!setup.noCredentials) for (const u of Object.keys(creds)) if (u !== 'default') config[configSection(u)] = cfg();
  const out: Record<string, string> = {};
  if (Object.keys(creds).length) out['.aws/credentials'] = stringifyIni(creds);
  if (Object.keys(config).length) out['.aws/config'] = stringifyIni(config);
  return out;
}
