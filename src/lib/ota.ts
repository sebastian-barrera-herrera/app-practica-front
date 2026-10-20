/**
 * Actualizaciones por internet (EAS Update): el contenido, las pantallas y los arreglos llegan sin reinstalar la app.
 * Solo funcionan en la app instalada (APK de EAS), no en desarrollo ni en web. Los cambios que tocan código nativo
 * (permisos, librerías nuevas) sí necesitan una versión nueva de la app.
 */
import { Platform } from 'react-native';

type UpdatesModule = typeof import('expo-updates');

async function updates(): Promise<UpdatesModule | null> {
  if (Platform.OS === 'web') return null;
  try {
    const U = await import('expo-updates');
    return U.isEnabled ? U : null;
  } catch {
    return null;
  }
}

export interface OtaInfo {
  enabled: boolean;
  runtimeVersion: string | null;
  channel: string | null;
  /** Primeros caracteres del identificador de la actualización en uso (vacío si es la que venía de fábrica). */
  updateId: string | null;
  createdAt: Date | null;
  embedded: boolean;
}

export async function otaInfo(): Promise<OtaInfo> {
  const U = await updates();
  if (!U) return { enabled: false, runtimeVersion: null, channel: null, updateId: null, createdAt: null, embedded: true };
  return { enabled: true, runtimeVersion: U.runtimeVersion, channel: U.channel, updateId: U.updateId?.slice(0, 8) ?? null, createdAt: U.createdAt, embedded: U.isEmbeddedLaunch };
}

export type OtaCheck = 'disabled' | 'none' | 'ready' | 'error';

/** Busca una actualización y, si la hay, la descarga. `ready` ⇒ se aplica al reiniciar (ver `applyOta`). */
export async function checkOta(): Promise<OtaCheck> {
  const U = await updates();
  if (!U) return 'disabled';
  try {
    const r = await U.checkForUpdateAsync();
    if (!r.isAvailable) return 'none';
    const f = await U.fetchUpdateAsync();
    return f.isNew ? 'ready' : 'none';
  } catch {
    return 'error';
  }
}

/** Reinicia la app para usar la actualización ya descargada. */
export async function applyOta(): Promise<void> {
  const U = await updates();
  await U?.reloadAsync().catch(() => {});
}
