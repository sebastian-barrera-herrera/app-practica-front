import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';

let enabled = true;
export const setHaptics = (v: boolean) => {
  enabled = v;
  if (!v && Platform.OS === 'android') Vibration.cancel();
};

const run = (fn: () => Promise<void> | void) => {
  if (!enabled || Platform.OS === 'web') return;
  try {
    const r = fn();
    if (r) r.catch(() => {});
  } catch {
    /* sin motor de vibración */
  }
};

/**
 * Patrones de Android (ms: pausa, vibra, pausa, vibra…). La respuesta háptica del sistema es muy suave en muchos móviles
 * Android, y los avisos de acierto, error y celebración tienen que notarse; por eso usan la vibración directa.
 */
const PATTERNS = {
  success: [0, 35, 55, 35, 55, 110],
  error: [0, 90, 70, 90, 70, 180],
  warn: [0, 120],
  celebrate: [0, 40, 60, 40, 60, 40, 60, 40, 60, 40, 60, 240],
};

const buzz = (name: keyof typeof PATTERNS, system: () => Promise<void>) =>
  run(() => {
    if (Platform.OS === 'android') return Vibration.vibrate(PATTERNS[name]);
    return system();
  });

export const tap = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const success = () => buzz('success', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const error = () => buzz('error', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
export const warn = () => buzz('warn', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
export const select = () => run(() => Haptics.selectionAsync());
/** Celebración: sale con el confeti (reto superado, lección completada…). */
export const celebrate = () => buzz('celebrate', () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
