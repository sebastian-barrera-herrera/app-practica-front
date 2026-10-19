/**
 * Notificaciones locales de Dev Dojo: recordatorios de práctica, exámenes sorpresa, racha y «te echamos de menos».
 * Todo falla en silencio en web. Las notificaciones llevan botones (categorías):
 *  · study:    ▶️ Empezar · ⏰ En 30 min · 🙈 Hoy no
 *  · surprise: ⚡ Responder · ⏰ En 1 h · 🔕 Silenciar hoy
 * En Android, «aplazar» y «hoy no» se resuelven sin abrir la app (tarea en segundo plano, ver `notifTask.ts`).
 */
import { Platform } from 'react-native';
import type { CourseId } from '@/content/types';
import type { SoundId } from '@/game/progress';
import type { RootState } from '@/game/root';
import { dayKey } from '@/game/streak';
import { getStudyContext } from './studyContext';
import { planNotifications, type NotifKind, type PlannedNotification } from './notifyPlan';

type NotificationsModule = typeof import('expo-notifications');
let mod: NotificationsModule | null = null;
let ready: Promise<NotificationsModule | null> | null = null;

export const SOUNDS: { id: SoundId; label: string; desc: string }[] = [
  { id: 'campana', label: 'Campana', desc: 'Clara y alegre' },
  { id: 'gota', label: 'Gota', desc: 'Suave, como agua' },
  { id: 'zen', label: 'Zen', desc: 'Cuenco tibetano, relajante' },
  { id: 'pulso', label: 'Pulso', desc: 'Dos pitidos cortos' },
  { id: 'arcade', label: 'Arcade', desc: 'Retro, para despertar' },
  { id: 'silencio', label: 'Silencio', desc: 'Solo vibración' },
];

export interface NotifData {
  kind: NotifKind;
  course: CourseId | null;
  day: string;
  route: string;
  sound: SoundId;
  channel: string;
  vibrate: boolean;
  [k: string]: unknown;
}

const CAT_STUDY = 'study';
const CAT_SURPRISE = 'surprise';

function load(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      try {
        mod = await import('expo-notifications');
        mod.setNotificationHandler({
          handleNotification: async (n) => {
            const kind = (n.request.content.data as Partial<NotifData> | undefined)?.kind;
            // si estás practicando, no molestamos con recordatorios; la sorpresa sí se muestra
            const busy = getStudyContext() !== null && kind !== 'surprise';
            return { shouldPlaySound: !busy, shouldSetBadge: false, shouldShowBanner: !busy, shouldShowList: true };
          },
        });
        return mod;
      } catch {
        return null;
      }
    })();
  }
  return ready;
}

/** Canal de Android (el sonido y la vibración son inmutables por canal ⇒ un canal por combinación). */
function channelId(kind: 'study' | 'surprise', sound: SoundId, vibrate: boolean) {
  return `${kind === 'study' ? 'practica' : 'sorpresa'}-${sound}-${vibrate ? 'v' : 'n'}`;
}

async function ensureChannel(N: NotificationsModule, id: string, kind: 'study' | 'surprise', sound: SoundId, vibrate: boolean) {
  if (Platform.OS !== 'android') return;
  const label = SOUNDS.find((s) => s.id === sound)?.label ?? sound;
  try {
    await N.setNotificationChannelAsync(id, {
      name: `${kind === 'study' ? 'Recordatorios de práctica' : 'Exámenes sorpresa'} · ${label}`,
      importance: N.AndroidImportance.HIGH,
      sound: sound === 'silencio' ? null : `${sound}.wav`,
      vibrationPattern: vibrate ? [0, 250, 150, 250] : [0],
      enableVibrate: vibrate,
      lightColor: '#22D3A6',
      lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    /* nada */
  }
}

/** Registra las categorías (botones). Idempotente. */
export async function setupNotifications(): Promise<void> {
  const N = await load();
  if (!N) return;
  const bg = Platform.OS !== 'android'; // fuera de Android, los botones abren la app para poder gestionarlos
  try {
    await N.setNotificationCategoryAsync(CAT_STUDY, [
      { identifier: 'start', buttonTitle: '▶️ Empezar', options: { opensAppToForeground: true } },
      { identifier: 'snooze', buttonTitle: '⏰ En 30 min', options: { opensAppToForeground: bg } },
      { identifier: 'skip', buttonTitle: '🙈 Hoy no', options: { opensAppToForeground: bg } },
    ]);
    await N.setNotificationCategoryAsync(CAT_SURPRISE, [
      { identifier: 'answer', buttonTitle: '⚡ Responder', options: { opensAppToForeground: true } },
      { identifier: 'later', buttonTitle: '⏰ En 1 h', options: { opensAppToForeground: bg } },
      { identifier: 'mute', buttonTitle: '🔕 Silenciar hoy', options: { opensAppToForeground: bg } },
    ]);
  } catch {
    /* nada */
  }
}

export async function ensurePermission(): Promise<boolean> {
  const N = await load();
  if (!N) return false;
  try {
    const cur = await N.getPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain === false) return false;
    const req = await N.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

export async function permissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unsupported'> {
  const N = await load();
  if (!N) return 'unsupported';
  try {
    const cur = await N.getPermissionsAsync();
    return cur.granted ? 'granted' : cur.canAskAgain === false ? 'denied' : 'undetermined';
  } catch {
    return 'unsupported';
  }
}

async function scheduleOne(N: NotificationsModule, p: PlannedNotification, vibrate: boolean, atMs = p.at, identifier = p.key) {
  const ch = channelId(p.category, p.sound, vibrate);
  await ensureChannel(N, ch, p.category, p.sound, vibrate);
  const data: NotifData = { kind: p.kind, course: p.course, day: p.day, route: p.route, sound: p.sound, channel: ch, vibrate };
  await N.scheduleNotificationAsync({
    identifier,
    content: {
      title: p.title,
      body: p.body,
      data,
      categoryIdentifier: p.category,
      sound: p.sound === 'silencio' ? false : Platform.OS === 'ios' ? `${p.sound}.wav` : 'default',
      color: '#22D3A6',
    },
    trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(atMs), channelId: ch },
  });
}

let lastSignature = '';

/** Cancela todo y vuelve a programar según el estado actual. Devuelve cuántos avisos quedaron. */
export async function rescheduleAll(root: RootState, now = Date.now()): Promise<number> {
  const N = await load();
  if (!N) return 0;
  try {
    const granted = (await N.getPermissionsAsync()).granted;
    if (!granted) return 0;
    const plan = planNotifications(root, now);
    const sig = JSON.stringify(plan.map((p) => [p.key, p.at, p.title, p.body, p.sound])) + root.settings.reminders.vibrate;
    if (sig === lastSignature) return plan.length;
    await N.cancelAllScheduledNotificationsAsync();
    for (const p of plan) await scheduleOne(N, p, root.settings.reminders.vibrate);
    lastSignature = sig;
    return plan.length;
  } catch {
    return 0;
  }
}

export async function cancelAllNotifications() {
  const N = await load();
  lastSignature = '';
  try {
    await N?.cancelAllScheduledNotificationsAsync();
  } catch {
    /* nada */
  }
}

/** Cancela lo que queda por sonar hoy (p. ej. al cumplir la meta o al pulsar «Hoy no»). */
export async function cancelTodayReminders(kinds: NotifKind[] = ['reminder', 'surprise', 'streak']) {
  const N = await load();
  if (!N) return;
  try {
    const today = dayKey(Date.now());
    const all = await N.getAllScheduledNotificationsAsync();
    for (const n of all) {
      const d = n.content.data as Partial<NotifData> | undefined;
      if (d?.day === today && d.kind && kinds.includes(d.kind)) await N.cancelScheduledNotificationAsync(n.identifier);
    }
    lastSignature = '';
  } catch {
    /* nada */
  }
}

/** Vuelve a avisar dentro de `minutes` con el mismo contenido (aplazar). */
async function snooze(N: NotificationsModule, content: { title: string | null; body: string | null; data: Partial<NotifData> }, minutes: number) {
  const d = content.data;
  if (!d.kind) return;
  const p: PlannedNotification = {
    key: `snooze-${d.kind}-${d.course ?? 'x'}`,
    at: Date.now() + minutes * 60_000,
    title: content.title ?? 'Dev Dojo',
    body: content.body ?? '',
    kind: d.kind,
    course: d.course ?? null,
    day: dayKey(Date.now() + minutes * 60_000),
    route: d.route ?? '/',
    sound: d.sound ?? 'campana',
    category: d.kind === 'surprise' ? 'surprise' : 'study',
  };
  await scheduleOne(N, p, d.vibrate ?? true, p.at, p.key);
}

let pendingRoute: string | null = null;
let routerReady = false;

async function flushRoute() {
  if (!routerReady || !pendingRoute) return;
  const r = pendingRoute;
  pendingRoute = null;
  try {
    const { router } = await import('expo-router');
    setTimeout(() => router.push(r as never), 250);
  } catch {
    /* nada */
  }
}

/** La raíz de la app avisa cuando ya se puede navegar (cuenta iniciada y datos cargados). */
export function setNotificationRouterReady(v: boolean) {
  routerReady = v;
  if (v) void flushRoute();
}

/** Procesa una respuesta (toque o botón). `navigate=false` ⇒ solo acciones sin abrir la app (tarea en segundo plano). */
export async function handleNotificationResponse(resp: import('expo-notifications').NotificationResponse, navigate = true): Promise<void> {
  const N = await load();
  if (!N) return;
  const req = resp.notification.request;
  const data = (req.content.data ?? {}) as Partial<NotifData>;
  const action = resp.actionIdentifier;
  try {
    if (action === 'snooze') await snooze(N, { title: req.content.title, body: req.content.body, data }, 30);
    else if (action === 'later') await snooze(N, { title: req.content.title, body: req.content.body, data }, 60);
    else if (action === 'skip' || action === 'mute') await cancelTodayReminders();
    else if (navigate && data.route) {
      pendingRoute = data.route;
      void flushRoute();
    }
    if (action !== N.DEFAULT_ACTION_IDENTIFIER) await N.dismissNotificationAsync(req.identifier).catch(() => {});
  } catch {
    /* nada */
  }
}

/** Escucha toques y botones con la app abierta + el que abrió la app en frío. */
export function installNotificationRouting(): () => void {
  let sub: { remove: () => void } | null = null;
  let alive = true;
  load().then(async (N) => {
    if (!N || !alive) return;
    sub = N.addNotificationResponseReceivedListener((resp) => void handleNotificationResponse(resp, true));
    try {
      const last = await N.getLastNotificationResponseAsync();
      if (last && alive) await handleNotificationResponse(last, true);
    } catch {
      /* nada */
    }
  });
  return () => {
    alive = false;
    sub?.remove();
  };
}

/** Programa una notificación de prueba para dentro de unos segundos (Ajustes ▸ Probar). */
export async function sendTestNotification(sound: SoundId, kind: 'study' | 'surprise', vibrate: boolean): Promise<boolean> {
  const N = await load();
  if (!N) return false;
  if (!(await ensurePermission())) return false;
  const now = Date.now();
  const p: PlannedNotification = {
    key: 'test',
    at: now + 4000,
    title: kind === 'study' ? '⏱️ Así sonará tu recordatorio' : '¡Examen sorpresa! 🥷',
    body: kind === 'study' ? 'Con botones para empezar, aplazar o saltarte el día.' : 'Con botones para responder, aplazar o silenciar.',
    kind: kind === 'study' ? 'reminder' : 'surprise',
    course: null,
    day: dayKey(now),
    route: '/',
    sound,
    category: kind,
  };
  try {
    await setupNotifications();
    await scheduleOne(N, p, vibrate);
    return true;
  } catch {
    return false;
  }
}
