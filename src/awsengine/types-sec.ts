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
