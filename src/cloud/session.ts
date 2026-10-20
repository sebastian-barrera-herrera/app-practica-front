import { cancelAllNotifications } from '@/lib/notify';
import { initialRoot } from '@/game/root';
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
  // dispositivo limpio y SIN fecha de modificación (updatedAt 0): al volver a entrar manda la copia de la nube entera
  // (ajustes, onboarding hecho…) en vez de que unos ajustes por defecto «recientes» la pisen
  useGame.getState().resetAll();
  useGame.getState().replaceRoot(initialRoot());
  return 'ok';
}
