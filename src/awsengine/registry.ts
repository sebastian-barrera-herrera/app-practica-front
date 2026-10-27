/** Registro de operaciones de la CLI de AWS simulada: definiciones, parámetros y errores. */
import type { Context } from './policy';
import type { Account, Rec } from './types';
import { pascal } from './util';

// ───────────────────────── errores ─────────────────────────

export class AwsError extends Error {
  /** Código de la API (`AccessDenied`, `NoSuchEntity`…). */
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

/** Error de uso de la CLI (argumentos incorrectos): sale con código 252 y sin «An error occurred». */
export class UsageErr extends Error {
  constructor(message: string, public code = 252, public showUsage = true) {
    super(message);
  }
}

// ───────────────────────── E/S del sistema anfitrión ─────────────────────────

export interface LocalFile {
  rel: string;
  content: string;
  mtime: number;
  size: number;
}

/** Lo que la CLI necesita del «ordenador» del alumno (el sistema de archivos virtual y el entorno). */
export interface AwsIO {
  acct: Account;
  env: Record<string, string>;
  home: string;
  /** Directorio actual del shell. */
  cwd: string;
  readFile(path: string): string | null;
  writeFile(path: string, content: string): boolean;
  removeFile(path: string): void;
  /** Lista archivos de un directorio (recursivo) o null si no es un directorio. */
  listFiles(dir: string): LocalFile[] | null;
  isDir(path: string): boolean;
  /** Tamaño en bytes (si es un archivo) o null si no existe. */
  size(path: string): number | null;
  abs(path: string): string;
  /** Entrada estándar si viene por una tubería (o null). */
  stdin: (() => Promise<string | null>) | null;
  /** Pregunta interactiva (`aws configure`). */
  prompt?: (question: string) => Promise<string | null>;
  /** Modo corrector: ejecuta con permisos totales y sin credenciales (solo para las comprobaciones de los retos). */
  god?: boolean;
  cols: number;
}

// ───────────────────────── identidad ─────────────────────────

export interface Caller {
  arn: string;
  account: string;
  type: 'User' | 'AssumedRole' | 'Account';
  /** Nombre de usuario IAM (si es un usuario). */
  userName?: string;
  userId: string;
  root: boolean;
  mfa: boolean;
  accessKeyId: string;
  /** Rol asumido (nombre) y sesión. */
  roleName?: string;
  sessionName?: string;
}

// ───────────────────────── parámetros ─────────────────────────

/** s=texto, i=entero, b=bandera, l=lista de textos, j=estructura/JSON, t=lista de etiquetas, f=lista de estructuras, n=número decimal, r=texto repetible (--exclude a --exclude b) */
export type ParamType = 's' | 'i' | 'b' | 'l' | 'j' | 't' | 'f' | 'n' | 'r';

export interface ParamSpec {
  name: string;
  key: string;
  type: ParamType;
  required: boolean;
}

export type Params = Record<string, any>;

export interface GlobalOpts {
  region: string;
  profile: string;
  output: string;
  query: string | null;
  maxItems: number | null;
  startingToken: string | null;
  dryRun: boolean;
  noPaginate: boolean;
  /** `--cli-binary-format` (o la configuración): `raw-in-base64-out` deja pasar JSON sin base64 en `--payload`. */
  binaryFormat?: string;
}

/** Salida directa de texto (comandos como `aws s3 ls`, que no producen JSON). */
export class Raw {
  constructor(public text: string, public stderr = '', public code = 0) {}
}

export interface OpCtx {
  acct: Account;
  region: string;
  io: AwsIO;
  caller: Caller;
  p: Params;
  opts: GlobalOpts;
  service: string;
  op: OpDef;
}

export interface AuthzTarget {
  action: string;
  resource: string;
  context?: Context;
}

/** Contexto que se pasa a `authorize` desde dentro de un manejador. */
export type AuthzCtx = Pick<OpCtx, 'acct' | 'caller' | 'region' | 'service'>;

export interface OpDef {
  service: string;
  name: string;
  /** Nombre de la API en PascalCase (el que sale en los mensajes de error). */
  api: string;
  params: ParamSpec[];
  summary: string;
  /** Permisos que hay que tener (a mano). Por defecto: `prefijo:Api` sobre `res(c)`. */
  authz?: ((c: OpCtx) => AuthzTarget[]) | false;
  /** Recurso(s) sobre los que actúa (ARN) para el permiso por defecto. */
  res?: (c: OpCtx) => string | string[];
  /** Acción de IAM si no coincide con el nombre de la API (p. ej. `list-objects-v2` → `s3:ListBucket`). */
  action?: string;
  /** Claves de condición extra para este permiso. */
  ctx?: (c: OpCtx) => Context;
  /** El servicio no es regional (IAM, STS, S3 global, Budgets): no exige región. */
  global?: boolean;
  handler: (c: OpCtx) => unknown | Promise<unknown>;
  /** Campo de la respuesta que es la lista paginada (para `--max-items`). */
  paginate?: string;
  /** Soporta `--dry-run`. */
  dryRun?: boolean;
  /** No necesita credenciales (p. ej. `aws configure`). */
  anon?: boolean;
  /** Ejemplos para la ayuda. */
  examples?: string[];
  /** Parámetros que se rellenan con argumentos sueltos, en orden (el último puede ser una lista). */
  positional?: string[];
}

export const OPS = new Map<string, OpDef>();
export const SERVICE_PREFIX: Record<string, string> = { s3api: 's3', s3: 's3', cloudwatch: 'cloudwatch', budgets: 'budgets', elbv2: 'elasticloadbalancing', elb: 'elasticloadbalancing', stepfunctions: 'states', apigatewayv2: 'apigateway', dynamodbstreams: 'dynamodb', deploy: 'codedeploy' };
export const SERVICE_SUMMARY: Record<string, string> = {
  sts: 'AWS Security Token Service',
  iam: 'AWS Identity and Access Management',
  s3: 'Comandos de alto nivel de Amazon S3 (mb, ls, cp, sync…)',
  s3api: 'Amazon S3 (API completa)',
  ec2: 'Amazon Elastic Compute Cloud',
  route53: 'Amazon Route 53 (DNS)',
  dynamodb: 'Amazon DynamoDB',
  dynamodbstreams: 'Amazon DynamoDB Streams',
  secretsmanager: 'AWS Secrets Manager',
  elasticache: 'Amazon ElastiCache',
  dms: 'AWS Database Migration Service',
  datasync: 'AWS DataSync',
  cloudformation: 'AWS CloudFormation',
  codebuild: 'AWS CodeBuild',
  deploy: 'AWS CodeDeploy',
  codepipeline: 'AWS CodePipeline',
  ecr: 'Amazon Elastic Container Registry',
  ecs: 'Amazon Elastic Container Service',
  'application-autoscaling': 'Application Auto Scaling',
  apprunner: 'AWS App Runner',
  eks: 'Amazon Elastic Kubernetes Service',
  ce: 'AWS Cost Explorer',
  organizations: 'AWS Organizations',
  resourcegroupstaggingapi: 'AWS Resource Groups Tagging API',
  support: 'AWS Support (y Trusted Advisor)',
  rds: 'Amazon Relational Database Service',
  budgets: 'AWS Budgets',
  cloudwatch: 'Amazon CloudWatch',
  sns: 'Amazon Simple Notification Service',
  ssm: 'AWS Systems Manager (parámetros, Run Command y Session Manager)',
  elbv2: 'Elastic Load Balancing (ALB, NLB y GWLB)',
  autoscaling: 'Amazon EC2 Auto Scaling',
  cloudfront: 'Amazon CloudFront (CDN)',
  globalaccelerator: 'AWS Global Accelerator',
  directconnect: 'AWS Direct Connect',
  logs: 'Amazon CloudWatch Logs',
  lambda: 'AWS Lambda',
  sqs: 'Amazon Simple Queue Service',
  events: 'Amazon EventBridge',
  stepfunctions: 'AWS Step Functions',
  apigatewayv2: 'Amazon API Gateway (APIs HTTP)',
  'cognito-idp': 'Amazon Cognito (grupos de usuarios)',
  configure: 'Configura la CLI (credenciales, región, formato)',
};

export function parseParams(dsl: string): ParamSpec[] {
  return dsl
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^([a-z0-9-]+):([sibljtfnr])(!?)$/.exec(tok);
      if (!m) throw new Error(`Parámetro mal definido: ${tok}`);
      return { name: m[1], key: pascal(m[1]), type: m[2] as ParamType, required: m[3] === '!' };
    });
}

export type OpOptions = Partial<Pick<OpDef, 'authz' | 'global' | 'paginate' | 'dryRun' | 'anon' | 'examples' | 'api' | 'positional' | 'res' | 'action' | 'ctx'>>;

/** Define una operación. `params` usa el mini-lenguaje `nombre:tipo[!]` separado por espacios. */
/** Servicios que no exigen una región configurada. */
const GLOBAL_SERVICES = new Set(['iam', 'sts', 's3', 's3api', 'budgets', 'configure', 'route53', 'ce', 'organizations', 'support', 'cloudfront', 'globalaccelerator']);

export function op(service: string, name: string, params: string, summary: string, options: OpOptions, handler: OpDef['handler']): void {
  const def: OpDef = { service, name, api: options.api ?? pascal(name), params: parseParams(params), summary, handler, global: GLOBAL_SERVICES.has(service), ...options };
  OPS.set(`${service}/${name}`, def);
}

export const opsOf = (service: string): OpDef[] => [...OPS.values()].filter((o) => o.service === service && !o.name.startsWith('$')).sort((a, b) => (a.name < b.name ? -1 : 1));
/** Servicios visibles en la CLI (los que empiezan por `_` son herramientas internas del corrector). */
export const servicesList = (): string[] => [...new Set([...OPS.values()].map((o) => o.service))].filter((s) => !s.startsWith('_')).sort();

/** Autorización típica: `servicio:Api` sobre el recurso dado. */
export const iamAction = (service: string, api: string) => `${SERVICE_PREFIX[service] ?? service}:${api}`;

export type { Rec };

/** Permisos que exige una operación por defecto (o los suyos propios, si los declara). */
export function defaultTargets(o: OpDef, c: OpCtx): AuthzTarget[] {
  if (o.authz === false) return [];
  if (o.authz) return o.authz(c);
  const action = o.action ?? iamAction(o.service, o.api);
  const res = o.res ? o.res(c) : '*';
  const context = o.ctx?.(c);
  return (Array.isArray(res) ? res : [res]).map((resource) => ({ action, resource, context }));
}
