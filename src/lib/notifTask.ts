/**
 * Tarea en segundo plano para los botones de las notificaciones (Android): permite «aplazar» y «hoy no»
 * sin abrir la app. Se importa desde `index.ts` (punto de entrada) para que exista aunque la app esté cerrada.
 */
import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';

export const NOTIFICATION_ACTION_TASK = 'DEVDOJO-NOTIFICATION-ACTIONS';

if (Platform.OS === 'android') {
  TaskManager.defineTask(NOTIFICATION_ACTION_TASK, async ({ data }: { data: unknown }) => {
    try {
      if (data && typeof data === 'object' && 'actionIdentifier' in (data as object)) {
        const { handleNotificationResponse } = await import('./notify');
        await handleNotificationResponse(data as import('expo-notifications').NotificationResponse, false);
      }
    } catch {
      /* nada */
    }
  });
  import('expo-notifications')
    .then((N) => N.registerTaskAsync(NOTIFICATION_ACTION_TASK))
    .catch(() => {});
}
