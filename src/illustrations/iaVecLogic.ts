/** Lógica pura de las ilustraciones de la zona 10 (vectores, embeddings, búsqueda, índices aproximados y chunking). Se prueba aparte. */
import { gaussian } from './iaMlLogic';

// ───────────────────────── espacio de características: animales ─────────────────────────

export interface Item2 {
  name: string;
  x: number;
  y: number;
}

/** (tamaño, velocidad) en una escala 0–10. */
export const ANIMALS: Item2[] = [
  { name: 'ratón', x: 1, y: 3 },
  { name: 'conejo', x: 1.5, y: 6 },
  { name: 'gato', x: 2, y: 5 },
  { name: 'perro', x: 3, y: 6 },
  { name: 'lobo', x: 5, y: 8 },
  { name: 'guepardo', x: 5, y: 10 },
  { name: 'caballo', x: 8, y: 9 },
  { name: 'vaca', x: 8, y: 3 },
  { name: 'elefante', x: 10, y: 2 },
  { name: 'tortuga', x: 1.5, y: 0.5 },
];

export type Metric = 'euclidea' | 'coseno' | 'producto';

export const dot2 = (a: Item2, b: { x: number; y: number }): number => a.x * b.x + a.y * b.y;
export const norm2 = (a: { x: number; y: number }): number => Math.hypot(a.x, a.y);

/** Puntuación de cercanía (mayor = más parecido) de cada animal con la consulta. */
export function score2(item: Item2, q: { x: number; y: number }, m: Metric): number {
  if (m === 'euclidea') return -Math.hypot(item.x - q.x, item.y - q.y);
  if (m === 'producto') return dot2(item, q);
  const d = norm2(item) * norm2(q);
  return d === 0 ? 0 : dot2(item, q) / d;
}

export function rank2(items: Item2[], q: { x: number; y: number }, m: Metric): { item: Item2; score: number }[] {
  return items.map((item) => ({ item, score: score2(item, q, m) })).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
}

// ───────────────────────── búsqueda aproximada (IVF) en 2D ─────────────────────────

export interface P2 {
  x: number;
  y: number;
}

/** Nube de puntos con varios grupos (reproducible). */
export function cloud(n = 160, seed = 11): P2[] {
  const g = gaussian(seed);
  const centers: P2[] = [{ x: 0.2, y: 0.25 }, { x: 0.75, y: 0.2 }, { x: 0.5, y: 0.55 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.5, y: 0.9 }];
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const c = centers[i % centers.length];
    out.push({ x: Math.min(1, Math.max(0, c.x + 0.085 * g())), y: Math.min(1, Math.max(0, c.y + 0.085 * g())) });
  }
  return out;
}

const d2 = (a: P2, b: P2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export function kmeans2(pts: P2[], k: number, iters = 12): { centers: P2[]; label: number[] } {
  const step = Math.max(1, Math.floor(pts.length / k));
  let centers = Array.from({ length: k }, (_, i) => ({ ...pts[(i * step) % pts.length] }));
  let label = pts.map(() => 0);
  for (let it = 0; it < iters; it++) {
    label = pts.map((p) => centers.reduce((best, c, j) => (d2(p, c) < d2(p, centers[best]) ? j : best), 0));
    centers = centers.map((c, j) => {
      const m = pts.filter((_, i) => label[i] === j);
      return m.length ? { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length } : c;
    });
  }
  return { centers, label };
}

export interface AnnResult {
  searchedCells: number[];
  candidates: number[];
  found: number[];
  exact: number[];
  recall: number;
  comparisons: number;
  exactComparisons: number;
}

/** Búsqueda IVF: mira solo las `nprobe` celdas más cercanas a la consulta. */
export function annSearch(pts: P2[], km: { centers: P2[]; label: number[] }, q: P2, k: number, nprobe: number): AnnResult {
  const order = (arr: number[], key: (i: number) => number): number[] => [...arr].sort((a, b) => key(a) - key(b) || a - b);
  const exact = order(pts.map((_, i) => i), (i) => d2(pts[i], q)).slice(0, k);
  const cells = order(km.centers.map((_, j) => j), (j) => d2(km.centers[j], q)).slice(0, nprobe);
  const candidates = pts.map((_, i) => i).filter((i) => cells.includes(km.label[i]));
  const found = order(candidates, (i) => d2(pts[i], q)).slice(0, k);
  return {
    searchedCells: cells,
    candidates,
    found,
    exact,
    recall: exact.filter((i) => found.includes(i)).length / k,
    comparisons: km.centers.length + candidates.length,
    exactComparisons: pts.length,
  };
}

// ───────────────────────── chunking ─────────────────────────

/** Fragmentos de `size` caracteres con un solape de `overlap` entre uno y el siguiente (como `trocear` de la lección). */
export function chunkRanges(len: number, size: number, overlap: number): [number, number][] {
  const out: [number, number][] = [];
  const step = Math.max(1, size - overlap);
  for (let s = 0; s < len; s += step) {
    out.push([s, Math.min(len, s + size)]);
    if (s + size >= len) break;
  }
  return out;
}

export interface ChunkInfo {
  ranges: [number, number][];
  /** índices de los fragmentos que contienen entera la frase de la respuesta */
  complete: number[];
  /** ¿la respuesta aparece partida entre fragmentos y no entera en ninguno? */
  cut: boolean;
}

export function chunkInfo(len: number, size: number, overlap: number, ans: [number, number]): ChunkInfo {
  const ranges = chunkRanges(len, size, overlap);
  const complete = ranges.map((r, i) => (r[0] <= ans[0] && r[1] >= ans[1] ? i : -1)).filter((i) => i >= 0);
  return { ranges, complete, cut: complete.length === 0 };
}
