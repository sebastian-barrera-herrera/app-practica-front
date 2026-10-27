/** Puntos de enganche entre servicios que usan claves de KMS (Parameter Store, Secrets Manager, S3…) y el propio KMS (zona de seguridad). */
import type { OpCtx } from '../registry';
import type { Account } from '../types';

export interface KmsHooks {
  /** Resuelve un id, ARN o alias a su ARN de clave; null si no existe (o no está activa). */
  resolve?: (a: Account, region: string, keyId: string) => string | null;
  /** Cifra un texto con la clave y devuelve el blob (base64). */
  encrypt?: (a: Account, region: string, keyId: string, plain: string, context?: Record<string, string>) => string;
  /** Exige a quien llama el permiso `kms:Decrypt` sobre la clave (lanza AccessDenied si no lo tiene). */
  requireDecrypt?: (c: OpCtx, keyId: string, context?: Record<string, string>) => void;
  /** Exige `kms:GenerateDataKey`/`kms:Encrypt` para escribir con la clave. */
  requireEncrypt?: (c: OpCtx, keyId: string, context?: Record<string, string>) => void;
}

export const kmsHooks: KmsHooks = {};
