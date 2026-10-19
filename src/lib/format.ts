/** 15 → «15 min» · 60 → «1 h» · 90 → «1 h 30» · 120 → «2 h». */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}
