/** Estado de los servicios de seguridad de la zona «Seguridad en profundidad» (Z15). */
import type { PolicyDoc, Tag } from './types';

// ───────────────────────── KMS ─────────────────────────

export interface KmsGrant {
  GrantId: string;
  Name?: string;
  GranteePrincipal: string;
  RetiringPrincipal?: string;
  IssuingAccount: string;
  Operations: string[];
  Constraints?: { EncryptionContextSubset?: Record<string, string>; EncryptionContextEquals?: Record<string, string> };
  created: number;
}

export interface KmsKey {
  KeyId: string;
  Arn: string;
  Description: string;
  Usage: 'ENCRYPT_DECRYPT' | 'SIGN_VERIFY' | 'GENERATE_VERIFY_MAC';
  Spec: string;
  State: 'Enabled' | 'Disabled' | 'PendingDeletion';
  manager: 'CUSTOMER' | 'AWS';
  created: number;
  /** Cuándo se borra de verdad (solo en `PendingDeletion`). */
  deletion?: number;
  deletionWindow?: number;
  policy: PolicyDoc;
  grants: KmsGrant[];
  rotation: { enabled: boolean; days: number; /** versiones del material de clave (1 = la original) */ versions: number; last?: number; next?: number; onDemand?: number };
  Tags: Tag[];
  multiRegion?: boolean;
}

export interface KmsState {
  keys: Record<string, KmsKey>;
  /** Nombre del alias (`alias/mi-clave`) → id de la clave. */
  aliases: Record<string, { target: string; created: number }>;
}

// ───────────────────────── ACM ─────────────────────────

export interface AcmCert {
  Arn: string;
  Domain: string;
  Sans: string[];
  Validation: 'DNS' | 'EMAIL';
  Status: 'PENDING_VALIDATION' | 'ISSUED' | 'INACTIVE' | 'EXPIRED' | 'VALIDATION_TIMED_OUT' | 'REVOKED' | 'FAILED';
  Type: 'AMAZON_ISSUED' | 'IMPORTED';
  created: number;
  issued?: number;
  notBefore?: number;
  notAfter?: number;
  renewal?: { status: 'PENDING_AUTO_RENEWAL' | 'PENDING_VALIDATION' | 'SUCCESS' | 'FAILED'; updated: number };
  keyAlgorithm: string;
  token?: string;
  transparency: 'ENABLED' | 'DISABLED';
  Tags: { Key: string; Value: string }[];
}

export interface AcmState {
  certs: Record<string, AcmCert>;
}

// ───────────────────────── WAFv2 y Shield ─────────────────────────

export type WafScope = 'REGIONAL' | 'CLOUDFRONT';

export interface WafVisibility {
  SampledRequestsEnabled: boolean;
  CloudWatchMetricsEnabled: boolean;
  MetricName: string;
}

export interface WafRule {
  Name: string;
  Priority: number;
  /** La condición (`ByteMatchStatement`, `RateBasedStatement`, `ManagedRuleGroupStatement`…), tal cual la escribe el alumno. */
  Statement: Record<string, any>;
  /** `{ Allow: {} }`, `{ Block: {} }`, `{ Count: {} }`… En las reglas normales. */
  Action?: Record<string, any>;
  /** `{ None: {} }` o `{ Count: {} }`. En los grupos de reglas. */
  OverrideAction?: Record<string, any>;
  VisibilityConfig: WafVisibility;
}

export interface WafAcl {
  Id: string;
  Name: string;
  ARN: string;
  Scope: WafScope;
  Description: string;
  DefaultAction: Record<string, any>;
  Rules: WafRule[];
  VisibilityConfig: WafVisibility;
  Capacity: number;
  LockToken: string;
  CustomResponseBodies?: Record<string, { ContentType: string; Content: string }>;
  Tags: { Key: string; Value: string }[];
  created: number;
}

export interface WafIpSet {
  Id: string;
  Name: string;
  ARN: string;
  Scope: WafScope;
  Description: string;
  IPAddressVersion: 'IPV4' | 'IPV6';
  Addresses: string[];
  LockToken: string;
  Tags: { Key: string; Value: string }[];
}

export interface WafSample {
  t: number;
  acl: string;
  rule: string;
  metric: string;
  action: 'ALLOW' | 'BLOCK' | 'COUNT';
  ip: string;
  country: string;
  uri: string;
  args: string;
  method: string;
  headers: { Name: string; Value: string }[];
}

export interface WafLogging {
  ResourceArn: string;
  LogDestinationConfigs: string[];
  RedactedFields?: Record<string, any>[];
  LoggingFilter?: Record<string, any>;
}

export interface WafState {
  acls: Record<string, WafAcl>;
  ipSets: Record<string, WafIpSet>;
  /** ARN del recurso protegido (balanceador, grupo de usuarios…) → ARN de la ACL. */
  associations: Record<string, string>;
  /** ARN de la ACL → configuración de registros. */
  logging: Record<string, WafLogging>;
  samples: WafSample[];
  /** `idAcl|regla|ip` → instantes de las peticiones recientes (para las reglas por tasa). */
  rate: Record<string, number[]>;
}

export interface ShieldProtection {
  Id: string;
  Name: string;
  ResourceArn: string;
  ProtectionArn: string;
  created: number;
}

export interface ShieldState {
  subscription?: { start: number; end: number; autoRenew: boolean };
  protections: Record<string, ShieldProtection>;
}

// ───────────────────────── GuardDuty ─────────────────────────

export interface GdFinding {
  Id: string;
  Arn: string;
  Type: string;
  Severity: number;
  Title: string;
  Description: string;
  Resource: Record<string, any>;
  Service: { Action: Record<string, any>; Archived: boolean; Count: number; DetectorId: string; EventFirstSeen: string; EventLastSeen: string; ResourceRole: string; ServiceName: 'guardduty'; AdditionalInfo?: Record<string, any>; Feedback?: string };
  CreatedAt: string;
  UpdatedAt: string;
  /** Clave de agrupación: el mismo tipo sobre el mismo recurso se acumula en un solo hallazgo. */
  key: string;
  sample?: boolean;
  /** Última vez (ms) que se avisó a EventBridge de este hallazgo. */
  sentAt?: number;
}

export interface GdFilter {
  Name: string;
  Description: string;
  Action: 'ARCHIVE' | 'NOOP';
  Rank: number;
  FindingCriteria: { Criterion: Record<string, Record<string, any>> };
  Tags: Record<string, string>;
}

export interface GdListSet {
  Id: string;
  Name: string;
  Format: string;
  Location: string;
  Activate: boolean;
  Kind: 'ip' | 'threat';
  Tags: Record<string, string>;
}

export interface GdDestination {
  DestinationId: string;
  DestinationArn: string;
  KmsKeyArn: string;
}

export interface GdDetector {
  Id: string;
  Status: 'ENABLED' | 'DISABLED';
  created: number;
  updated: number;
  Frequency: string;
  Features: Record<string, 'ENABLED' | 'DISABLED'>;
  Tags: Record<string, string>;
  findings: Record<string, GdFinding>;
  filters: Record<string, GdFilter>;
  sets: Record<string, GdListSet>;
  destinations: Record<string, GdDestination>;
  /** Hasta qué instante (ms) de CloudTrail se han leído eventos. */
  scanned: number;
  /** Eventos del instante `scanned` que ya se leyeron (en ese instante pueden llegar más). */
  boundary: string[];
  /** Desde cuándo está expuesto cada puerto (`instancia|puerto` → instante). */
  exposed: Record<string, number>;
}

export interface GdState {
  detectors: Record<string, GdDetector>;
}

// ───────────────────────── Inspector ─────────────────────────

export interface InspFilter {
  arn: string;
  name: string;
  action: 'NONE' | 'SUPPRESS';
  description: string;
  criteria: Record<string, any>;
  created: number;
}

export interface InspState {
  enabled: { EC2: boolean; ECR: boolean; LAMBDA: boolean };
  since: number;
  filters: Record<string, InspFilter>;
  /** Cuándo vio por primera vez cada hallazgo (clave estable) y cuándo dejó de verse (se cerró). */
  seen: Record<string, { first: number; last: number; closed?: number; /** Última copia del hallazgo, para mostrarlo como CLOSED cuando desaparece. */ snap?: Record<string, any> }>;
  lastScan: number;
}

// ───────────────────────── Macie ─────────────────────────

export interface MacieJob {
  jobId: string;
  jobArn: string;
  name: string;
  jobType: 'ONE_TIME' | 'SCHEDULED';
  status: 'RUNNING' | 'COMPLETE' | 'CANCELLED' | 'PAUSED';
  buckets: string[];
  created: number;
  finishedAt?: number;
  customIdentifierIds: string[];
  stats: { objects: number; classified: number; bytes: number };
  samplingPercentage: number;
  description: string;
}

export interface MacieFinding {
  id: string;
  type: string;
  category: 'CLASSIFICATION' | 'POLICY';
  severity: 'Low' | 'Medium' | 'High';
  bucket: string;
  key?: string;
  count: number;
  description: string;
  detections: { type: string; count: number }[];
  archived: boolean;
  createdAt: number;
  jobId?: string;
}

export interface MacieCustomId {
  Id: string;
  Name: string;
  Regex: string;
  Keywords: string[];
  Description: string;
  created: number;
}

export interface MacieState {
  enabled: boolean;
  since: number;
  frequency: string;
  jobs: Record<string, MacieJob>;
  findings: Record<string, MacieFinding>;
  customIds: Record<string, MacieCustomId>;
  filters: Record<string, { id: string; name: string; action: 'ARCHIVE' | 'NOOP'; position: number; description: string; criteria: Record<string, any> }>;
}

// ───────────────────────── Security Hub ─────────────────────────

export interface HubState {
  enabled: boolean;
  since: number;
  autoEnableControls: boolean;
  /** Estándares activados: id corto (`fsbp`, `cis`) → controles desactivados con su motivo. */
  standards: Record<string, { disabled: Record<string, string>; enabledAt: number }>;
  products: string[];
  workflow: Record<string, { Status: string; Note?: string; Severity?: string; UpdatedBy?: string; at: number }>;
}

// ───────────────────────── IAM Access Analyzer ─────────────────────────

export interface AnalyzerFinding {
  id: string;
  key: string;
  resourceType: string;
  resource: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'RESOLVED';
  principal: Record<string, string>;
  action: string[];
  condition: Record<string, any>;
  isPublic: boolean;
  createdAt: number;
  analyzedAt: number;
  updatedAt: number;
}

export interface Analyzer {
  arn: string;
  name: string;
  type: 'ACCOUNT' | 'ORGANIZATION';
  created: number;
  archiveRules: Record<string, { ruleName: string; filter: Record<string, any>; created: number }>;
  findings: Record<string, AnalyzerFinding>;
  tags: Record<string, string>;
}

export interface AnalyzerState {
  analyzers: Record<string, Analyzer>;
}
