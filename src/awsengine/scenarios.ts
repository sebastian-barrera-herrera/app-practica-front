/** Cuentas de partida de las lecciones y retos. Cada escenario es una función que construye una cuenta nueva. */
import { newAccount, regional as regionalOf } from './account';
import { configSection, stringifyIni, type Ini } from './creds';
import { ec2CreateKey, ec2CreateSg, ec2CreateVolume, ec2Launch } from './services/ec2';
import { s3CreateBucket, s3Delete, s3Put } from './services/s3';
import { iamCreateGroup, iamCreatePolicy, iamCreateRole, iamCreateUser } from './services/iam';
import type { Account } from './types';
import { iso, secretFor } from './util';

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
  informes(a);
  iamCreatePolicy(a, 'LeerInformes', {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: ['s3:GetObject', 's3:ListBucket'], Resource: ['arn:aws:s3:::informes-empresa', 'arn:aws:s3:::informes-empresa/*'] }],
  });
};

/** Un bucket con algunos informes (y una carpeta privada) para practicar permisos. */
function informes(a: Account): void {
  const b = s3CreateBucket(a, 'informes-empresa', 'us-east-1');
  s3Put(a, b, 'q1.txt', 'Informe del primer trimestre\n');
  s3Put(a, b, 'q2.txt', 'Informe del segundo trimestre\n');
  s3Put(a, b, 'secreto/nomina.csv', 'nombre,sueldo\nana,2500\n');
}

/** Un servidor ya en marcha en Irlanda (y nada en Virginia): para ver que las regiones son mundos separados. */
const regiones: Scenario = (a) => {
  base(a);
  ec2Launch(a, 'eu-west-1', { type: 't3.micro', tags: [{ Key: 'Name', Value: 'web-irlanda' }] });
};

/** La cuenta con la que se abrió AWS: el root tiene una clave de acceso y no hay MFA (justo lo que NO hay que hacer). */
const rootInseguro: Scenario = (a) => {
  base(a);
  a.iam.rootKeys.push({ AccessKeyId: 'AKIAROOTKEYEXAMPLE0', Status: 'Active', CreateDate: iso(a.clock - 86400000 * 400) });
};

/** Dos usuarios sin permisos y con permisos totales de S3, y buckets sobre los que probar políticas. */
const politicas: Scenario = (a) => {
  base(a);
  informes(a);
  const o = s3CreateBucket(a, 'otros-datos', 'us-east-1');
  s3Put(a, o, 'notas.txt', 'Notas privadas\n');
  iamCreateUser(a, 'lucia', { keys: 1 });
  iamCreateUser(a, 'mario', { attached: ['AmazonS3FullAccess'], keys: 1 });
};

/** Un desarrollador con AdministratorAccess puesto «para ir más rápido» (y la política correcta ya creada). */
const exceso: Scenario = (a) => {
  equipo(a);
  a.iam.users.bob.attached.push('arn:aws:iam::aws:policy/AdministratorAccess');
};

/** Una cuenta con los fallos típicos de una auditoría (para la misión final de IAM). */
const auditoria: Scenario = (a) => {
  base(a);
  iamCreateGroup(a, 'desarrolladores', { attached: ['PowerUserAccess'] });
  iamCreateUser(a, 'dev1', { attached: ['AdministratorAccess'], keys: 1, password: true });
  iamCreateUser(a, 'exempleado', { keys: 1, password: true });
};

/** Dos servidores (uno encendido, otro parado), un par de claves y un disco de datos conectado. */
const ec2demo: Scenario = (a) => {
  base(a);
  ec2CreateKey(a, 'us-east-1', 'clave-curso');
  const web = ec2Launch(a, 'us-east-1', { type: 't3.micro', key: 'clave-curso', tags: [{ Key: 'Name', Value: 'web-1' }] });
  ec2Launch(a, 'us-east-1', { type: 't3.small', state: 'stopped', tags: [{ Key: 'Name', Value: 'batch-1' }] });
  ec2CreateVolume(a, 'us-east-1', { az: web.AvailabilityZone, size: 20, tags: [{ Key: 'Name', Value: 'datos' }], attachTo: { instanceId: web.InstanceId, device: '/dev/sdf' } });
};

const WEB_USER_DATA = '#!/bin/bash\ndnf install -y httpd\nsystemctl enable --now httpd\necho "<h1>Hola desde EC2</h1>" > /var/www/html/index.html\n';

/** Un servidor web que funciona por dentro pero cuyo grupo de seguridad no deja entrar a nadie. */
const ec2web: Scenario = (a) => {
  base(a);
  const sg = ec2CreateSg(a, 'us-east-1', 'web-cerrado', 'Servidor web (sin reglas de entrada)');
  ec2Launch(a, 'us-east-1', { type: 't3.micro', sgIds: [sg.GroupId], tags: [{ Key: 'Name', Value: 'web-cerrado' }], userData: WEB_USER_DATA });
};

/** Buckets con fotos, informes privados y registros, y un objeto archivado en Glacier. */
const s3demo: Scenario = (a) => {
  base(a);
  const f = s3CreateBucket(a, 'fotos-demo', 'us-east-1');
  for (const k of ['2025/enero/a.jpg', '2025/enero/b.jpg', '2025/febrero/c.jpg', 'portada.jpg']) s3Put(a, f, k, 'JPEGDATA', { size: 250000 });
  const p = s3CreateBucket(a, 'privado-demo', 'us-east-1');
  s3Put(a, p, 'informe.txt', 'Informe confidencial\n');
  const l = s3CreateBucket(a, 'logs-app', 'us-east-1');
  s3Put(a, l, 'app-2025-01.log', 'linea 1\nlinea 2\n');
  s3Put(a, l, 'archivo/viejo.txt', 'datos de hace años\n', { storageClass: 'GLACIER' });
  const v = s3CreateBucket(a, 'logs-viejos', 'us-east-1');
  s3Put(a, v, 'a.log', 'x\n');
  v.lifecycle = [{ ID: 'archivar', Status: 'Enabled', Filter: { Prefix: '' }, Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }, { Days: 90, StorageClass: 'GLACIER' }], Expiration: { Days: 365 } }];
};

/** Un bucket versionado donde alguien borró un contrato (queda un marcador de borrado). */
const s3versiones: Scenario = (a) => {
  base(a);
  const b = s3CreateBucket(a, 'documentos', 'us-east-1', { versioning: 'Enabled' });
  s3Put(a, b, 'contrato.pdf', 'contrato v1\n');
  a.clock += 60000;
  s3Put(a, b, 'contrato.pdf', 'contrato v2 firmado\n');
  s3Put(a, b, 'anexo.txt', 'anexo\n');
  a.clock += 60000;
  s3Delete(a, b, 'contrato.pdf');
};

/** Un bucket de RR. HH. abierto al mundo y sin versionado: lo típico de una filtración. */
const s3fugas: Scenario = (a) => {
  base(a);
  const b = s3CreateBucket(a, 'documentos-rrhh', 'us-east-1', { publicAccessBlock: null });
  s3Put(a, b, 'nominas.csv', 'nombre,sueldo\nana,2500\n');
  s3Put(a, b, 'contratos/ana.pdf', 'contrato\n');
  b.policy = { Version: '2012-10-17', Statement: [{ Sid: 'Publico', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: 'arn:aws:s3:::documentos-rrhh/*' }] };
};

/** Discos EBS sueltos que nadie usa (y siguen cobrando). */
const huerfanos: Scenario = (a) => {
  ec2demo(a);
  const az = Object.values(regionalOf(a, 'us-east-1').ec2.instances)[0].AvailabilityZone;
  ec2CreateVolume(a, 'us-east-1', { az, size: 100, tags: [{ Key: 'Name', Value: 'prueba-vieja' }] });
  ec2CreateVolume(a, 'us-east-1', { az, size: 50, tags: [{ Key: 'Name', Value: 'migracion-2024' }] });
};

export const SCENARIOS: Record<string, Scenario> = { base, empty: base, equipo, regiones, 'root-inseguro': rootInseguro, politicas, exceso, auditoria, ec2demo, ec2web, s3demo, s3versiones, s3fugas, huerfanos };

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
