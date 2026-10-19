/**
 * Plan de notificaciones locales (función pura y testeable): recordatorios de práctica, exámenes sorpresa,
 * aviso de racha y avisos de «te echamos de menos». `notify.ts` lo aplica con expo-notifications.
 */
import type { CourseId } from '@/content/types';
import type { SoundId } from '@/game/progress';
import { COURSE_KEYS, enabledCourses, goalSeconds, goalStreak, studySeconds, dayComplete, type RootState } from '@/game/root';
import { dayKey } from '@/game/streak';

export type NotifKind = 'reminder' | 'surprise' | 'streak' | 'comeback';

export interface PlannedNotification {
  /** Identificador estable (permite reprogramar sin duplicar). */
  key: string;
  /** Instante de disparo (ms). */
  at: number;
  title: string;
  body: string;
  kind: NotifKind;
  course: CourseId | null;
  /** Día local en el que ocurre («YYYY-MM-DD»). */
  day: string;
  /** Ruta a la que lleva al tocarla. */
  route: string;
  sound: SoundId;
  category: 'study' | 'surprise';
}

export const COURSE_LABEL: Record<CourseId, string> = { linux: '🐧 Linux', python: '🐍 Python' };

const HORIZON_DAYS = 10;
const MAX_PLANNED = 56; // iOS admite 64 notificaciones pendientes

/** Pseudoaleatorio estable a partir de una cadena. */
function rnd(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
const pick = <T,>(arr: T[], seed: string): T => arr[Math.floor(rnd(seed) * arr.length) % arr.length];

const fmtMin = (sec: number) => {
  const m = Math.ceil(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

function at(base: Date, dayOffset: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h || 0, m || 0, 0, 0);
  return d;
}

function reminderText(root: RootState, course: CourseId | 'all', todayLeft: Partial<Record<CourseId, number>>, seed: string): { title: string; body: string } {
  const on = enabledCourses(root);
  const left = on.map((c) => ({ c, s: todayLeft[c] ?? goalSeconds(root, c) }));
  const name = root.settings.name ? `, ${root.settings.name.split(' ')[0]}` : '';
  if (course === 'all' || on.length > 1) {
    const parts = left.filter((x) => x.s > 0).map((x) => `${fmtMin(x.s)} de ${COURSE_LABEL[x.c].slice(3)}`);
    const title = pick([`⏱️ Hora de practicar${name}`, `🥋 Tu dojo te espera${name}`, `🔥 Un ratito de código${name}`, `🧠 Toca entrenar${name}`], seed + 't');
    const body = parts.length
      ? pick([`Hoy te faltan ${parts.join(' y ')}. ¡Empieza con una lección!`, `Meta del día: ${parts.join(' + ')}. Cada minuto cuenta.`], seed + 'b')
      : 'Hoy ya cumpliste tus metas. ¡Un repaso extra no hace daño!';
    return { title, body };
  }
  const c = left[0]?.c ?? 'linux';
  const rest = left[0]?.s ?? goalSeconds(root, c);
  return {
    title: `${COURSE_LABEL[c]} te espera${name}`,
    body: rest > 0 ? `Te faltan ${fmtMin(rest)} para tu meta de hoy. ¡Vamos!` : 'Meta cumplida hoy. ¿Un repaso rápido?',
  };
}

const SURPRISE_TITLES = ['¡Examen sorpresa! 🥷', 'Alerta del dojo 🥋', '¿Te acuerdas de esto? 🧠', 'Minirrepaso sorpresa ⚡', '¡Pop quiz! 🎯'];
const SURPRISE_BODIES = ['5 preguntas rápidas. Demuestra lo que sabes.', 'Tu sensei Pingüi tiene una pregunta para ti.', 'Dos minutos para reforzar lo aprendido.', 'Responde antes de que se te olvide.'];

export function planNotifications(root: RootState, now: number, opts: { horizonDays?: number; max?: number } = {}): PlannedNotification[] {
  const horizon = opts.horizonDays ?? HORIZON_DAYS;
  const max = opts.max ?? MAX_PLANNED;
  const out: PlannedNotification[] = [];
  const base = new Date(now);
  const today = dayKey(now);
  const set = root.settings;
  const on = enabledCourses(root);
  const minLead = now + 60_000;

  const todayLeft: Partial<Record<CourseId, number>> = {};
  for (const c of COURSE_KEYS) todayLeft[c] = Math.max(0, goalSeconds(root, c) - studySeconds(root, c, today));
  const focusToday = [...on].sort((a, b) => (todayLeft[b] ?? 0) - (todayLeft[a] ?? 0))[0] ?? null;

  // ── recordatorios de práctica ──
  if (set.reminders.enabled && on.length) {
    const times = [...set.reminders.times].sort();
    for (let d = 0; d < horizon; d++) {
      const date = at(base, d, '00:00');
      if (!set.reminders.days[date.getDay()]) continue;
      const dk = dayKey(date.getTime());
      if (d === 0 && set.reminders.skipIfDone && dayComplete(root, today)) continue;
      times.forEach((hhmm, ti) => {
        const when = at(base, d, hhmm).getTime();
        if (when < minLead) return;
        const course: CourseId = d === 0 ? (focusToday ?? on[0]) : on[(d + ti) % on.length];
        // los avisos de hoy solo mencionan lo que falta; si ya se cumplió una meta, no se la recordamos
        const left = d === 0 ? todayLeft : {};
        if (d === 0 && set.reminders.skipIfDone && on.every((c) => (todayLeft[c] ?? 0) <= 0)) return;
        const txt = reminderText(root, on.length > 1 ? 'all' : on[0], left, dk + ti);
        out.push({
          key: `rem-${dk}-${hhmm.replace(':', '')}`,
          at: when,
          ...txt,
          kind: 'reminder',
          course,
          day: dk,
          route: `/go/${course}`,
          sound: set.reminders.sound,
          category: 'study',
        });
      });
    }
    // racha en peligro: esta noche, si hay racha que proteger y aún no hay actividad hoy
    const gs = goalStreak(root, now);
    if (root.streak.current >= 2 && root.streak.lastDay !== today) {
      const when = at(base, 0, '21:00').getTime();
      if (when > minLead) {
        const course = focusToday ?? on[0];
        out.push({
          key: `streak-${today}`,
          at: when,
          title: `🔥 ¡Tu racha de ${root.streak.current} días peligra!`,
          body: gs.todayDone ? 'Una lección rápida y la salvas.' : 'Con una lección de 3 minutos la mantienes viva.',
          kind: 'streak',
          course,
          day: today,
          route: `/go/${course}`,
          sound: set.reminders.sound,
          category: 'study',
        });
      }
    }
    // «te echamos de menos» si pasan días sin abrir la app (se reprograma en cada apertura)
    if (set.reminders.comeback) {
      for (const [i, off] of [2, 4, 7].entries()) {
        const when = at(base, off, '18:30').getTime();
        const dk = dayKey(when);
        const c = on[i % on.length];
        out.push({
          key: `back-${off}`,
          at: when,
          title: pick(['Tu pingüino te echa de menos 🐧', 'El dojo está muy silencioso… 🥋', '¿Seguimos donde lo dejamos? 🚀'], 'back' + off),
          body: pick(['Vuelve con una lección corta y retoma el ritmo.', 'Cinco minutos hoy valen más que una hora que nunca llega.'], 'backb' + off),
          kind: 'comeback',
          course: c,
          day: dk,
          route: `/go/${c}`,
          sound: set.reminders.sound,
          category: 'study',
        });
      }
    }
  }

  // ── exámenes sorpresa ──
  if (set.surpriseEnabled) {
    const eligible = on.filter((c) => Object.values(root.courses[c].lessons).some((l) => l.done));
    if (eligible.length) {
      const perWeek = Math.max(0, Math.min(14, set.surprisePerWeek));
      const days: number[] = [];
      // reparte los avisos por días distintos de forma estable: ordena los 7 días con una clave pseudoaleatoria
      const order = [...Array(7).keys()].sort((a, b) => rnd(today + 'd' + a) - rnd(today + 'd' + b));
      for (let i = 0; i < perWeek; i++) days.push(order[i % 7]);
      const lo = Math.min(set.windowStart, set.windowEnd - 1);
      const hi = Math.max(set.windowEnd, lo + 1);
      days.forEach((d, i) => {
        const hour = lo + rnd(`${today}h${i}`) * (hi - lo);
        const date = at(base, d, '00:00');
        date.setHours(Math.floor(hour), Math.floor((hour % 1) * 60), 0, 0);
        let when = date.getTime();
        if (when < minLead) when += 7 * 86400000;
        const dk = dayKey(when);
        const course = eligible[(i + (rnd(today + 'c') > 0.5 ? 1 : 0)) % eligible.length];
        out.push({
          key: `sur-${dk}-${i}`,
          at: when,
          title: `${COURSE_LABEL[course].slice(0, 2)} ${pick(SURPRISE_TITLES, dk + i)}`,
          body: pick(SURPRISE_BODIES, dk + 'b' + i),
          kind: 'surprise',
          course,
          day: dk,
          route: `/session/surprise?course=${course}`,
          sound: set.surpriseSound,
          category: 'surprise',
        });
      });
    }
  }

  // evita avisos pegados (<20 min) y recorta al máximo
  out.sort((a, b) => a.at - b.at);
  const spaced: PlannedNotification[] = [];
  for (const n of out) {
    const prev = spaced[spaced.length - 1];
    if (prev && n.at - prev.at < 20 * 60_000) {
      // gana el recordatorio (más importante) sobre un aviso comeback/sorpresa pegado
      if (rank(n.kind) > rank(prev.kind)) spaced[spaced.length - 1] = n;
      continue;
    }
    spaced.push(n);
  }
  return spaced.slice(0, max);
}

const rank = (k: NotifKind) => ({ reminder: 4, streak: 3, surprise: 2, comeback: 1 })[k];
