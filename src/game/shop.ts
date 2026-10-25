/** Tienda: en qué se gastan las monedas 🪙. */
import { balance, owned } from './economy';
import type { RootState } from './root';

export type ShopId = 'shield' | 'boost' | 'pass';

export interface ShopItem {
  id: ShopId;
  emoji: string;
  title: string;
  desc: string;
  price: number;
}

export const MAX_SHIELDS = 3;
export const BOOST_MS = 30 * 60 * 1000;
/** Espera tras suspender un examen de salto (la salta un Pase sin espera). */
export const SKIP_COOLDOWN_MS = 30 * 60 * 1000;

export const SHOP: ShopItem[] = [
  { id: 'shield', emoji: '🛡️', title: 'Escudo de racha', desc: `Salva tu racha si un día no practicas. Puedes tener ${MAX_SHIELDS} como máximo.`, price: 80 },
  { id: 'boost', emoji: '⚡', title: 'XP doble · 30 min', desc: 'Todo el XP que ganes durante media hora vale el doble. Se suma si ya está activo.', price: 60 },
  { id: 'pass', emoji: '🎟️', title: 'Pase sin espera', desc: 'Si suspendes un examen de salto, lo repites al instante en vez de esperar 30 minutos.', price: 40 },
];

export const shopItem = (id: ShopId): ShopItem => SHOP.find((i) => i.id === id)!;

export function canBuy(root: RootState, id: ShopId): { ok: true } | { ok: false; reason: string } {
  const item = shopItem(id);
  if (balance(root.xp, root.extras) < item.price) return { ok: false, reason: 'No tienes monedas suficientes' };
  if (id === 'shield' && root.streak.freezes >= MAX_SHIELDS) return { ok: false, reason: `Ya tienes ${MAX_SHIELDS} escudos` };
  return { ok: true };
}

/** Compra un objeto: descuenta las monedas y aplica el efecto. */
export function buy(root: RootState, id: ShopId, now: number): { root: RootState; ok: boolean; reason?: string } {
  const can = canBuy(root, id);
  if (!can.ok) return { root, ok: false, reason: can.reason };
  const item = shopItem(id);
  let next: RootState = { ...root, extras: { ...root.extras, coinsSpent: root.extras.coinsSpent + item.price } };
  if (id === 'shield') next = { ...next, streak: { ...next.streak, freezes: next.streak.freezes + 1 } };
  else if (id === 'boost') next = { ...next, extras: { ...next.extras, boostUntil: Math.max(now, next.extras.boostUntil) + BOOST_MS } };
  else next = { ...next, extras: { ...next.extras, bought: { ...next.extras.bought, pass: (next.extras.bought.pass ?? 0) + 1 } } };
  return { root: next, ok: true };
}

/** Gasta un pase sin espera, si hay. */
export function consumePass(root: RootState): RootState | null {
  if (owned(root.extras, 'pass') < 1) return null;
  return { ...root, extras: { ...root.extras, used: { ...root.extras.used, pass: (root.extras.used.pass ?? 0) + 1 } } };
}
