/** Enganches de ACM con los servicios que usan certificados (balanceadores) y con la capa HTTP del simulador. */
import type { Account } from '../types';

export interface AcmHooks {
  /** Lanza el error del servicio si el certificado no existe en la región o no está emitido. */
  require?: (a: Account, region: string, arn: string) => void;
  /** ¿Cubre el certificado este nombre de host? (con comodines de un solo nivel) */
  covers?: (a: Account, region: string, arn: string, host: string) => boolean;
}

export const acmHooks: AcmHooks = {};
