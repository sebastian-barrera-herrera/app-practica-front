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
