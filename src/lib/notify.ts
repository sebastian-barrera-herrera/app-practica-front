/** Notificaciones locales para los exámenes sorpresa. Todo falla en silencio en web. */
import { Platform } from 'react-native';
import { router } from 'expo-router';

type NotificationsModule = typeof import('expo-notifications');
let mod: NotificationsModule | null = null;

async function load(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return null;
  if (!mod) {
    try {
      mod = await import('expo-notifications');
      mod.setNotificationHandler({
        handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
      });
    } catch {
      return null;
    }
  }
  return mod;
}

export function installNotificationRouting(): () => void {
  let sub: { remove: () => void } | null = null;
  let alive = true;
  load().then((N) => {
    if (!N || !alive) return;
    sub = N.addNotificationResponseReceivedListener((resp) => {
      const route = (resp.notification.request.content.data as { route?: string } | undefined)?.route;
      if (route) setTimeout(() => router.push(route as any), 300);
    });
  });
  return () => {
    alive = false;
    sub?.remove();
  };
}

export async function ensurePermission(): Promise<boolean> {
  const N = await load();
  if (!N) return false;
  try {
    const cur = await N.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await N.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

const TITLES = [
  '¡Examen sorpresa! 🥷',
  'Alerta del dojo 🥋',
  '¿Te acuerdas de esto? 🧠',
  'Minirrepaso sorpresa ⚡',
];
const BODIES = [
  '5 preguntas rápidas. Demuestra lo que sabes.',
  'Tu sensei Pingüi tiene una pregunta para ti.',
  'Un repaso de 2 minutos mantiene tu racha viva.',
  'Los comandos se olvidan si no se practican. ¡Entra!',
];

/** Programa `perWeek` avisos en los próximos 7 días, a horas aleatorias dentro de la ventana. */
export async function scheduleSurprises(perWeek: number, startHour: number, endHour: number): Promise<number> {
  const N = await load();
  if (!N) return 0;
  try {
    await N.cancelAllScheduledNotificationsAsync();
    if (perWeek <= 0) return 0;
    const now = Date.now();
    const days = [0, 1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5).slice(0, Math.min(7, perWeek)).sort();
    let n = 0;
    for (const d of days) {
      const hour = startHour + Math.random() * Math.max(1, endHour - startHour);
      const when = new Date();
      when.setDate(when.getDate() + d);
      when.setHours(Math.floor(hour), Math.floor((hour % 1) * 60), 0, 0);
      if (when.getTime() <= now + 60000) when.setDate(when.getDate() + 7);
      await N.scheduleNotificationAsync({
        content: {
          title: TITLES[Math.floor(Math.random() * TITLES.length)],
          body: BODIES[Math.floor(Math.random() * BODIES.length)],
          data: { route: '/session/surprise' },
        },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: when },
      });
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

export async function cancelSurprises() {
  const N = await load();
  try {
    await N?.cancelAllScheduledNotificationsAsync();
  } catch {
    /* nada */
  }
}
