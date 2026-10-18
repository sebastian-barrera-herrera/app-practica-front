import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

let enabled = true;
export const setHaptics = (v: boolean) => {
  enabled = v;
};

const run = (fn: () => Promise<void>) => {
  if (!enabled || Platform.OS === 'web') return;
  fn().catch(() => {});
};

export const tap = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const success = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const error = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
export const warn = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
export const select = () => run(() => Haptics.selectionAsync());
