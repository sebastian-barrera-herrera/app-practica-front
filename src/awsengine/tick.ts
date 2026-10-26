/** Hace avanzar con el reloj virtual todo lo que evoluciona solo (Auto Scaling, drenaje de balanceadores…). */
import type { Account } from './types';

export const tickers: ((a: Account) => void)[] = [];

let busy = false;

/** Se llama al empezar cada operación de la CLI y cada petición web: deja la cuenta al día con el reloj. */
export function tick(a: Account): void {
  if (busy) return;
  busy = true;
  try {
    for (const t of tickers) t(a);
  } finally {
    busy = false;
  }
}
