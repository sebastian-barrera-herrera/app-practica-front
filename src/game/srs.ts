/** Repaso espaciado tipo Leitner. */

export const DAY = 86400000;
/** Intervalo (en días) por caja. La caja 0 son 10 minutos. */
export const INTERVALS = [10 / 1440, 1, 3, 7, 14, 30, 60];

export interface SrsItem {
  box: number;
  due: number;
  seen: number;
  correct: number;
  wrong: number;
  last: number;
}

export const newItem = (now: number): SrsItem => ({ box: 0, due: now, seen: 0, correct: 0, wrong: 0, last: now });

export function review(item: SrsItem | undefined, correct: boolean, now: number): SrsItem {
  const it = item ?? newItem(now);
  const box = correct ? Math.min(INTERVALS.length - 1, it.box + 1) : 0;
  return {
    box,
    due: now + INTERVALS[box] * DAY,
    seen: it.seen + 1,
    correct: it.correct + (correct ? 1 : 0),
    wrong: it.wrong + (correct ? 0 : 1),
    last: now,
  };
}

export function dueItems(srs: Record<string, SrsItem>, now: number): string[] {
  return Object.entries(srs)
    .filter(([, it]) => it.due <= now)
    .sort((a, b) => a[1].due - b[1].due || a[1].box - b[1].box)
    .map(([id]) => id);
}

/** Dominio 0..1 de un conjunto de elementos. */
export function mastery(srs: Record<string, SrsItem>, ids: string[]): number {
  if (!ids.length) return 0;
  let s = 0;
  for (const id of ids) {
    const it = srs[id];
    if (it) s += it.box / (INTERVALS.length - 1);
  }
  return s / ids.length;
}

export function nextDue(srs: Record<string, SrsItem>): number | null {
  const v = Object.values(srs).map((i) => i.due);
  return v.length ? Math.min(...v) : null;
}
