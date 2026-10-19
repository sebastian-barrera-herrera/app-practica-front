import { cancelAllNotifications } from '@/lib/notify';
import { useGame } from '@/game/store';
import { logout } from './auth';
import { syncNow } from './sync';

/**
 * Cierra la sesión y deja el dispositivo limpio (el progreso queda en la nube). Antes sincroniza para no perder nada;
 * si no hay conexión devuelve 'unsynced' para que la interfaz pregunte (con `force` se cierra igualmente).
 */
export async function signOutAndWipe(opts: { force?: boolean } = {}): Promise<'ok' | 'unsynced'> {
  const r = await syncNow();
  if (r !== 'ok' && !opts.force) return 'unsynced';
  await cancelAllNotifications();
  await logout();
  useGame.getState().resetAll();
  useGame.getState().setOwner(null);
  return 'ok';
}
