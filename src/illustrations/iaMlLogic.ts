/** Lógica pura de las ilustraciones de aprendizaje automático (zonas 4–7 del curso de IA). Se prueba aparte. */
import { smoSolve } from '@/pyengine/stdlib/mlkern';
import { lcg } from './iaLogic';

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

/** Normal estándar reproducible (Box–Muller sobre el generador congruencial). */
export function gaussian(seed: number): () => number {
  const r = lcg(seed);
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
}

// ───────────────────────── Z4 · la recta de mínimos cuadrados ─────────────────────────

export const LR_POINTS: [number, number][] = [[1, 2.3], [2, 3.1], [3, 5.4], [4, 5.9], [5, 8.2], [6, 8.8], [7, 11.1], [8, 11.6], [9, 14.2], [10, 14.4]];

export interface Line {
  w: number;
  b: number;
}

/** Pendiente y ordenada que minimizan la suma de errores al cuadrado. */
export function lrBest(pts: [number, number][] = LR_POINTS): Line {
  const mx = mean(pts.map((p) => p[0]));
  const my = mean(pts.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  const w = sxy / sxx;
  return { w, b: my - w * mx };
}

export const lrResiduals = (l: Line, pts: [number, number][] = LR_POINTS): number[] => pts.map(([x, y]) => y - (l.w * x + l.b));
export const lrMse = (l: Line, pts: [number, number][] = LR_POINTS): number => mean(lrResiduals(l, pts).map((e) => e * e));

// ───────────────────────── Z4 · efecto de cada característica ─────────────────────────

export interface HouseFeat {
  id: 'superficie' | 'habitaciones' | 'antiguedad' | 'distancia';
  label: string;
  unit: string;
  coef: number;
  min: number;
  max: number;
  step: number;
  start: number;
}

/** Coeficientes de `LinearRegression` ajustada al CSV de casas de la zona (precio en miles de €). */
export const HOUSE_INTERCEPT = 39.3;
export const HOUSE_FEATS: HouseFeat[] = [
  { id: 'superficie', label: 'Superficie', unit: 'm²', coef: 2.166, min: 40, max: 160, step: 10, start: 100 },
  { id: 'habitaciones', label: 'Habitaciones', unit: '', coef: 9.262, min: 1, max: 6, step: 1, start: 3 },
  { id: 'antiguedad', label: 'Antigüedad', unit: 'años', coef: -1.163, min: 0, max: 40, step: 5, start: 10 },
  { id: 'distancia', label: 'Distancia al centro', unit: 'km', coef: -2.355, min: 1, max: 20, step: 1, start: 5 },
];

export interface HousePrediction {
  parts: { id: string; label: string; value: number }[];
  total: number;
}

export function housePredict(vals: Record<string, number>): HousePrediction {
  const parts = HOUSE_FEATS.map((f) => ({ id: f.id, label: f.label, value: f.coef * (vals[f.id] ?? f.start) }));
  return { parts, total: HOUSE_INTERCEPT + parts.reduce((s, p) => s + p.value, 0) };
}

// ───────────────────────── Z4 · métricas de regresión ─────────────────────────

export const METRIC_Y = [20, 24, 29, 33, 38, 41, 47, 50, 56, 60];
export const METRIC_E = [3, -4, 2, -1, 5, -3, 2, -2, 4, -5];

export interface RegMetrics {
  mae: number;
  mse: number;
  rmse: number;
  r2: number;
  worst: number;
}

/** Métricas con un último punto cuyo error vale `outlier` (los demás errores son fijos). */
export function regMetrics(outlier: number): RegMetrics {
  const err = METRIC_E.slice(0, -1).concat([outlier]);
  const y = METRIC_Y;
  const pred = y.map((v, i) => v - err[i]);
  const my = mean(y);
  const ssRes = err.reduce((s, e) => s + e * e, 0);
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const mseV = ssRes / y.length;
  void pred;
  return { mae: mean(err.map(Math.abs)), mse: mseV, rmse: Math.sqrt(mseV), r2: 1 - ssRes / ssTot, worst: Math.max(...err.map(Math.abs)) };
}

// ───────────────────────── Z4 · Ridge y Lasso ─────────────────────────

export const PATH_NAMES = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
export const PATH_TRUE = [4, -3, 2, 0, 0, 0];

/** Conjunto fijo de 6 características estandarizadas (solo las tres primeras importan). */
export function pathData(): { X: number[][]; y: number[] } {
  const g = gaussian(21);
  const n = 40;
  const X = Array.from({ length: n }, () => PATH_NAMES.map(() => g()));
  for (let j = 0; j < 6; j++) {
    const m = mean(X.map((r) => r[j]));
    const sd = Math.sqrt(mean(X.map((r) => (r[j] - m) ** 2)));
    X.forEach((r) => (r[j] = (r[j] - m) / sd));
  }
  const y = X.map((r) => r.reduce((s, v, j) => s + v * PATH_TRUE[j], 0) + 2.5 * g());
  const my = mean(y);
  return { X, y: y.map((v) => v - my) };
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

/** Ridge en forma cerrada: (XᵀX + αI)⁻¹ Xᵀy. */
export function ridgeCoefs(alpha: number): number[] {
  const { X, y } = pathData();
  const p = X[0].length;
  const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? alpha : 0)));
  const b = Array.from({ length: p }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  return solve(A, b);
}

const soft = (z: number, t: number): number => Math.sign(z) * Math.max(Math.abs(z) - t, 0);

/** Lasso por descenso de coordenadas (mismo objetivo que scikit-learn: 1/(2n)·‖y−Xw‖² + α‖w‖₁). */
export function lassoCoefs(alpha: number): number[] {
  const { X, y } = pathData();
  const n = X.length;
  const p = X[0].length;
  const w = new Array<number>(p).fill(0);
  for (let it = 0; it < 500; it++) {
    for (let j = 0; j < p; j++) {
      let rho = 0;
      let zz = 0;
      for (let i = 0; i < n; i++) {
        let r = y[i];
        for (let k = 0; k < p; k++) if (k !== j) r -= X[i][k] * w[k];
        rho += X[i][j] * r;
        zz += X[i][j] ** 2;
      }
      w[j] = soft(rho / n, alpha) / (zz / n);
    }
  }
  return w;
}

export const PATH_ALPHAS = [0, 0.1, 0.3, 1, 3, 10, 30];

// ───────────────────────── Z4 · tres regresores en una curva ─────────────────────────

export interface Curve1D {
  train: [number, number][];
  test: [number, number][];
}

export function curveData(): Curve1D {
  const g = gaussian(5);
  const pts: [number, number][] = Array.from({ length: 36 }, (_, i) => {
    const x = (i / 35) * 6;
    return [x, Math.sin(x) + 0.25 * g()];
  });
  return { train: pts.filter((_, i) => i % 3 !== 2), test: pts.filter((_, i) => i % 3 === 2) };
}

export type ModelKind = 'lineal' | 'knn' | 'arbol';

type Fn = (x: number) => number;

function linearFn(pts: [number, number][]): Fn {
  const { w, b } = lrBest(pts);
  return (x) => w * x + b;
}

function knnFn(pts: [number, number][], k: number): Fn {
  return (x) => {
    const idx = pts.map((p, i) => ({ d: Math.abs(p[0] - x), i })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, k);
    return mean(idx.map((o) => pts[o.i][1]));
  };
}

interface TreeNode {
  leaf?: number;
  thr?: number;
  l?: TreeNode;
  r?: TreeNode;
}

function growTree(pts: [number, number][], depth: number): TreeNode {
  const ys = pts.map((p) => p[1]);
  if (depth === 0 || pts.length < 2) return { leaf: mean(ys) };
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  let best = Infinity;
  let thr = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] === sorted[i - 1][0]) continue;
    const l = sorted.slice(0, i).map((p) => p[1]);
    const r = sorted.slice(i).map((p) => p[1]);
    const ml = mean(l);
    const mr = mean(r);
    const sse = l.reduce((s, v) => s + (v - ml) ** 2, 0) + r.reduce((s, v) => s + (v - mr) ** 2, 0);
    if (sse < best) {
      best = sse;
      thr = (sorted[i][0] + sorted[i - 1][0]) / 2;
    }
  }
  if (!isFinite(best)) return { leaf: mean(ys) };
  return { thr, l: growTree(sorted.filter((p) => p[0] <= thr), depth - 1), r: growTree(sorted.filter((p) => p[0] > thr), depth - 1) };
}

const treeEval = (t: TreeNode, x: number): number => (t.leaf !== undefined ? t.leaf : treeEval(x <= (t.thr as number) ? (t.l as TreeNode) : (t.r as TreeNode), x));

export interface Reg1DResult {
  curve: [number, number][];
  trainRmse: number;
  testRmse: number;
  verdict: 'infraajuste' | 'bien' | 'sobreajuste';
}

export function fitRegressor1D(kind: ModelKind, param: number, d: Curve1D = curveData()): Reg1DResult {
  const f: Fn = kind === 'lineal' ? linearFn(d.train) : kind === 'knn' ? knnFn(d.train, Math.max(1, param)) : ((t) => (x: number) => treeEval(t, x))(growTree(d.train, Math.max(1, param)));
  const rmse = (pts: [number, number][]): number => Math.sqrt(mean(pts.map(([x, y]) => (f(x) - y) ** 2)));
  const curve: [number, number][] = Array.from({ length: 61 }, (_, i) => [(i / 60) * 6, f((i / 60) * 6)]);
  const tr = rmse(d.train);
  const te = rmse(d.test);
  return { curve, trainRmse: tr, testRmse: te, verdict: tr > 0.38 ? 'infraajuste' : te > Math.max(tr * 1.8, tr + 0.12) ? 'sobreajuste' : 'bien' };
}

// ───────────────────────── Z5 · regresión logística ─────────────────────────

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** Llamadas al servicio de soporte del último año y si el cliente se dio de baja (1) o no (0). */
export const SIG_POINTS: [number, 0 | 1][] = [[0, 0], [0, 0], [1, 0], [1, 0], [1, 1], [2, 0], [2, 0], [3, 0], [3, 1], [4, 1], [4, 0], [5, 1], [5, 1], [6, 1], [7, 1], [8, 1]];

export interface SigmoidView {
  accuracy: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  boundary: number | null;
  probs: number[];
}

/** Evalúa el modelo p(x) = σ(w·x + b) con un umbral de decisión `t`. */
export function sigmoidView(w: number, b: number, t: number): SigmoidView {
  const probs = SIG_POINTS.map(([x]) => sigmoid(w * x + b));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  SIG_POINTS.forEach(([, y], i) => {
    const pred = probs[i] >= t ? 1 : 0;
    if (pred && y) tp++;
    else if (pred && !y) fp++;
    else if (!pred && y) fn++;
    else tn++;
  });
  const logit = Math.log(t / (1 - t));
  return { accuracy: (tp + tn) / SIG_POINTS.length, tp, fp, fn, tn, boundary: Math.abs(w) < 1e-9 ? null : (logit - b) / w, probs };
}

// ───────────────────────── Z5 · impureza de Gini ─────────────────────────

/** Impureza de Gini de un nodo con `a` ejemplos de una clase y `b` de la otra. */
export function gini(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 0;
  const pa = a / n;
  const pb = b / n;
  return 1 - pa * pa - pb * pb;
}

export interface SplitScore {
  left: [number, number];
  right: [number, number];
  giniL: number;
  giniR: number;
  weighted: number;
  gain: number;
}

export function giniSplit(pts: [number, 0 | 1][], thr: number): SplitScore {
  const l: [number, number] = [0, 0];
  const r: [number, number] = [0, 0];
  for (const [x, y] of pts) (x <= thr ? l : r)[y]++;
  const n = pts.length;
  const total: [number, number] = [l[0] + r[0], l[1] + r[1]];
  const giniL = gini(l[0], l[1]);
  const giniR = gini(r[0], r[1]);
  const weighted = ((l[0] + l[1]) / n) * giniL + ((r[0] + r[1]) / n) * giniR;
  return { left: l, right: r, giniL, giniR, weighted, gain: gini(total[0], total[1]) - weighted };
}

export const bestThreshold = (pts: [number, 0 | 1][]): number => {
  const xs = [...new Set(pts.map((p) => p[0]))].sort((a, b) => a - b);
  let best = xs[0];
  let g = -Infinity;
  for (let i = 0; i < xs.length - 1; i++) {
    const t = (xs[i] + xs[i + 1]) / 2;
    const s = giniSplit(pts, t).gain;
    if (s > g + 1e-12) {
      g = s;
      best = t;
    }
  }
  return best;
};

// ───────────────────────── Z5 · vecinos y regiones ─────────────────────────

export interface P2 {
  x: number;
  y: number;
  c: 0 | 1;
}

/** Dos «lunas» con ruido, 44 puntos fijos en [0, 1]². */
export function moons2D(): P2[] {
  const g = gaussian(9);
  const pts: P2[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 21) * Math.PI;
    pts.push({ x: 0.5 + 0.34 * Math.cos(a) - 0.12 + 0.06 * g(), y: 0.38 + 0.3 * Math.sin(a) + 0.06 * g(), c: 0 });
    pts.push({ x: 0.5 - 0.34 * Math.cos(a) + 0.12 + 0.06 * g(), y: 0.62 - 0.3 * Math.sin(a) + 0.06 * g(), c: 1 });
  }
  return pts.map((p) => ({ ...p, x: Math.max(0.02, Math.min(0.98, p.x)), y: Math.max(0.02, Math.min(0.98, p.y)) }));
}

/** Clase mayoritaria (y fracción de la clase 1) entre los k vecinos más cercanos. */
export function knnVote(pts: P2[], x: number, y: number, k: number): number {
  const idx = pts.map((p, i) => ({ d: (p.x - x) ** 2 + (p.y - y) ** 2, i })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, k);
  return idx.reduce((s, o) => s + pts[o.i].c, 0) / idx.length;
}

export function knnGrid(pts: P2[], k: number, nx = 22, ny = 16): { cells: number[][]; acc: number } {
  const cells = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => knnVote(pts, (i + 0.5) / nx, (j + 0.5) / ny, k)));
  const acc = pts.filter((p) => (knnVote(pts, p.x, p.y, k) >= 0.5 ? 1 : 0) === p.c).length / pts.length;
  return { cells, acc };
}

// ───────────────────────── Z5 · SVM ─────────────────────────

export type SvmKernel = 'lineal' | 'rbf';

export interface SvmResult {
  cells: number[][];
  sv: number[];
  acc: number;
}

/** Entrena una SVM con el mismo SMO que usa la mini-librería de Python (kernel lineal o RBF) sobre `pts`. */
export function svmFit(pts: P2[], kernel: SvmKernel, C: number, gamma: number, nx = 22, ny = 16): SvmResult {
  const n = pts.length;
  const k = (a: P2, b: { x: number; y: number }): number => (kernel === 'lineal' ? a.x * b.x + a.y * b.y : Math.exp(-gamma * ((a.x - b.x) ** 2 + (a.y - b.y) ** 2)));
  const y = Int8Array.from(pts.map((p) => (p.c === 1 ? 1 : -1)));
  const Q = new Float64Array(n * n);
  const QD = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Q[i * n + j] = y[i] * y[j] * k(pts[i], pts[j]);
    QD[i] = k(pts[i], pts[i]);
  }
  const r = smoSolve(n, Q, QD, new Float64Array(n).fill(-1), y, new Float64Array(n), new Float64Array(n).fill(C), 1e-3, 100000);
  const decide = (x: number, yy: number): number => {
    let s = -r.rho;
    for (let i = 0; i < n; i++) if (r.alpha[i] > 0) s += r.alpha[i] * y[i] * k(pts[i], { x, y: yy });
    return s;
  };
  const cells = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => decide((i + 0.5) / nx, (j + 0.5) / ny)));
  const sv = pts.map((_, i) => i).filter((i) => r.alpha[i] > 1e-9);
  const acc = pts.filter((p) => (decide(p.x, p.y) > 0 ? 1 : 0) === p.c).length / n;
  return { cells, sv, acc };
}

/** Dos nubes que se solapan un poco (24 puntos). */
export function blobs2D(): P2[] {
  const g = gaussian(4);
  const pts: P2[] = [];
  for (let i = 0; i < 14; i++) {
    pts.push({ x: 0.3 + 0.13 * g(), y: 0.35 + 0.13 * g(), c: 0 });
    pts.push({ x: 0.68 + 0.13 * g(), y: 0.62 + 0.13 * g(), c: 1 });
  }
  return pts.map((p) => ({ ...p, x: Math.max(0.03, Math.min(0.97, p.x)), y: Math.max(0.03, Math.min(0.97, p.y)) }));
}

// ───────────────────────── Z5 · el voto del conjunto ─────────────────────────

/** P(más de la mitad de n votantes independientes, cada uno con acierto p, acierta). n impar. */
export function majorityAccuracy(n: number, p: number): number {
  let total = 0;
  let logC = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    if (k > n / 2) total += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return total;
}

/** Con correlación ρ: con probabilidad ρ todos los modelos coinciden (votan lo mismo), si no son independientes. */
export const ensembleAccuracy = (n: number, p: number, rho: number): number => rho * p + (1 - rho) * majorityAccuracy(n, p);

// ───────────────────────── Z6 · matriz de confusión y umbral ─────────────────────────

/** Función de distribución de la normal estándar (aproximación de Abramowitz-Stegun, error < 1e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export const SCORE_SEP = 1.8;

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Puntuaciones normales: los negativos N(0, 1) y los positivos N(sep, 1). Con `n` casos y una `prevalence` de positivos,
 * devuelve el reparto esperado en la matriz de confusión al decidir «positivo» si la puntuación ≥ `thr`.
 */
export function confusionAt(thr: number, prevalence: number, n = 1000, sep = SCORE_SEP): Confusion {
  const pos = n * prevalence;
  const neg = n - pos;
  const tp = pos * (1 - normCdf(thr - sep));
  const fn = pos - tp;
  const fp = neg * (1 - normCdf(thr));
  const tn = neg - fp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = pos > 0 ? tp / pos : 0;
  return { tp, fp, fn, tn, accuracy: (tp + tn) / n, precision, recall, f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0 };
}

// ───────────────────────── Z6 · curva ROC ─────────────────────────

export interface RocPoint {
  fpr: number;
  tpr: number;
  thr: number;
}

/** Curva ROC de dos normales separadas `d` desviaciones típicas (negativos N(0,1), positivos N(d,1)). */
export function rocCurve(d: number, steps = 60): RocPoint[] {
  const out: RocPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const thr = 5 - (i / steps) * (5 + d + 3);
    out.push({ thr, fpr: 1 - normCdf(thr), tpr: 1 - normCdf(thr - d) });
  }
  return out;
}

/** AUC exacto: P(puntuación de un positivo > puntuación de un negativo) = Φ(d / √2). */
export const rocAuc = (d: number): number => normCdf(d / Math.SQRT2);

// ───────────────────────── Z6 · validación cruzada ─────────────────────────

export interface Fold {
  index: number;
  test: number[];
  score: number;
}

/** Reparte `n` filas en `k` bloques consecutivos y asigna a cada uno una puntuación fija (para la ilustración). */
export function kfoldDemo(n: number, k: number): Fold[] {
  const g = gaussian(30 + k);
  const base = 0.8;
  const sizes = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
  let start = 0;
  return sizes.map((sz, i) => {
    const test = Array.from({ length: sz }, (_, j) => start + j);
    start += sz;
    return { index: i, test, score: Math.max(0.5, Math.min(0.97, base + 0.07 * g())) };
  });
}

export const foldStats = (f: Fold[]): { mean: number; std: number } => {
  const m = f.reduce((s, x) => s + x.score, 0) / f.length;
  return { mean: m, std: Math.sqrt(f.reduce((s, x) => s + (x.score - m) ** 2, 0) / f.length) };
};

// ───────────────────────── Z6 · sesgo y varianza ─────────────────────────

export interface BiasVar {
  complexity: number;
  bias2: number;
  variance: number;
  noise: number;
  train: number;
  test: number;
  verdict: 'sesgo alto' | 'equilibrio' | 'varianza alta';
}

/** Curvas de juguete: el sesgo² baja con la complejidad; la varianza sube con ella y baja al tener más datos `n`. */
export function biasVariance(complexity: number, n: number): BiasVar {
  const noise = 0.1;
  const bias2 = 1.2 / (complexity * complexity);
  const variance = (0.012 * complexity * complexity) / (n / 30);
  const test = bias2 + variance + noise;
  const train = Math.max(0.01, bias2 + noise - variance * 0.9);
  const verdict: BiasVar['verdict'] = bias2 > variance * 3 && complexity <= 3 ? 'sesgo alto' : variance > bias2 * 2 ? 'varianza alta' : 'equilibrio';
  return { complexity, bias2, variance, noise, train, test, verdict };
}

// ───────────────────────── Z6 · búsqueda de hiperparámetros ─────────────────────────

/** Superficie de rendimiento: muy sensible al parámetro X (el que importa) y casi plana en Y. */
export const searchScore = (x: number, y: number): number => 0.55 + 0.4 * Math.exp(-((x - 0.62) ** 2) / 0.012) * (0.9 + 0.1 * Math.exp(-((y - 0.3) ** 2) / 0.4));

export interface Trial {
  x: number;
  y: number;
  score: number;
}

export function gridTrials(side: number): Trial[] {
  const vals = Array.from({ length: side }, (_, i) => (i + 0.5) / side);
  return vals.flatMap((x) => vals.map((y) => ({ x, y, score: searchScore(x, y) })));
}

export function randomTrials(n: number, seed = 5): Trial[] {
  const r = lcg(seed);
  return Array.from({ length: n }, () => {
    const x = r();
    const y = r();
    return { x, y, score: searchScore(x, y) };
  });
}

export const bestTrial = (t: Trial[]): Trial => t.reduce((a, b) => (b.score > a.score ? b : a));
