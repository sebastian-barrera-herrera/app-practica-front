/** Lógica pura de las ilustraciones de aprendizaje automático (zonas 4–7 del curso de IA). Se prueba aparte. */
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
