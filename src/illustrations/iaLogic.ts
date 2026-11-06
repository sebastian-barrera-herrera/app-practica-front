/** Lógica pura de las ilustraciones del curso de IA (se prueba aparte; los componentes solo la dibujan). */

// ───────────────────────── IA ⊃ ML ⊃ DL ⊃ IA generativa ─────────────────────────

export interface Layer {
  id: 'ia' | 'ml' | 'dl' | 'gen';
  title: string;
  what: string;
  example: string;
  needs: string;
}

export const AI_LAYERS: Layer[] = [
  { id: 'ia', title: 'Inteligencia artificial', what: 'Cualquier técnica que haga que una máquina parezca inteligente, aprenda o no.', example: 'Un buscador de rutas, un sistema experto con reglas, un programa de ajedrez clásico.', needs: 'Reglas escritas a mano o datos.' },
  { id: 'ml', title: 'Aprendizaje automático (ML)', what: 'La parte de la IA que aprende patrones a partir de datos en lugar de reglas fijas.', example: 'Un filtro de spam, la predicción del precio de una casa, recomendaciones de series.', needs: 'Ejemplos (datos) y un algoritmo de entrenamiento.' },
  { id: 'dl', title: 'Aprendizaje profundo (DL)', what: 'ML con redes neuronales de muchas capas que aprenden sus propias características.', example: 'Reconocimiento facial, traducción automática, transcripción de voz.', needs: 'Muchos datos y mucha potencia de cálculo (GPU).' },
  { id: 'gen', title: 'IA generativa', what: 'Modelos profundos que crean contenido nuevo: texto, imágenes, audio o código.', example: 'Asistentes de chat (LLM), generadores de imágenes, copilotos de programación.', needs: 'Enormes colecciones de texto o imágenes y semanas de entrenamiento.' },
];

// ───────────────────────── tipos de aprendizaje ─────────────────────────

export interface LearningType {
  id: 'sup' | 'uns' | 'rl';
  title: string;
  teacher: string;
  data: string;
  output: string;
  example: string;
  algos: string[];
}

export const LEARNING_TYPES: LearningType[] = [
  { id: 'sup', title: 'Supervisado', teacher: 'Un «profesor» da la respuesta correcta de cada ejemplo.', data: 'Ejemplos con etiqueta (X, y).', output: 'Un modelo que predice la etiqueta de datos nuevos.', example: 'Dado el historial del cliente, ¿se dará de baja? ¿Cuánto vale esta casa?', algos: ['regresión lineal', 'regresión logística', 'árboles', 'redes neuronales'] },
  { id: 'uns', title: 'No supervisado', teacher: 'Nadie da respuestas: el algoritmo busca estructura por sí solo.', data: 'Ejemplos sin etiqueta (solo X).', output: 'Grupos, anomalías o una representación más compacta de los datos.', example: 'Agrupar clientes con hábitos parecidos o detectar un pago raro.', algos: ['k-means', 'PCA', 'clustering jerárquico', 'detección de anomalías'] },
  { id: 'rl', title: 'Por refuerzo', teacher: 'El entorno responde con recompensas o castigos tras cada acción.', data: 'Experiencia: estados, acciones y recompensas.', output: 'Una política: qué hacer en cada situación para ganar más a largo plazo.', example: 'Un robot que aprende a caminar o un programa que aprende a jugar.', algos: ['Q-learning', 'bandidos', 'políticas con gradiente', 'RLHF en los LLM'] },
];

// ───────────────────────── mínimos cuadrados (polinomios) ─────────────────────────

/** Resuelve min‖A·c − b‖ con transformaciones de Householder (estable incluso con matrices casi singulares). */
export function lstsq(A: number[][], b: number[]): number[] {
  const m = A.length;
  const n = A[0].length;
  const R = A.map((r) => r.slice());
  const y = b.slice();
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = R[k][k] > 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = R[i][k];
    v[k] -= alpha;
    let vn = 0;
    for (let i = k; i < m; i++) vn += v[i] * v[i];
    if (vn === 0) continue;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i] * R[i][j];
      const f = (2 * dot) / vn;
      for (let i = k; i < m; i++) R[i][j] -= f * v[i];
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += v[i] * y[i];
    const f = (2 * dot) / vn;
    for (let i = k; i < m; i++) y[i] -= f * v[i];
  }
  const c = new Array<number>(n).fill(0);
  for (let i = Math.min(n, m) - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= R[i][j] * c[j];
    c[i] = Math.abs(R[i][i]) < 1e-12 ? 0 : s / R[i][i];
  }
  return c;
}

/** Coeficientes (de mayor a menor grado, como `np.polyfit`) del polinomio de grado `deg` que mejor ajusta (xs, ys). */
export function polyFit(xs: number[], ys: number[], deg: number): number[] {
  const A = xs.map((x) => Array.from({ length: deg + 1 }, (_, k) => Math.pow(x, deg - k)));
  return lstsq(A, ys);
}

export const polyEval = (c: number[], x: number): number => c.reduce((acc, k) => acc * x + k, 0);

export const mse = (pred: number[], y: number[]): number => pred.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / Math.max(1, y.length);

// ───────────────────────── curva con ruido ─────────────────────────

/** Ruido fijo (para que la ilustración sea idéntica cada vez). */
const NOISE = [0.12, -0.18, 0.2, -0.08, 0.25, -0.22, 0.1, 0.18, -0.26, 0.05, -0.14, 0.22, -0.1, 0.16, -0.24, 0.08, 0.2, -0.15, 0.12, -0.05];

export interface FitData {
  xt: number[];
  yt: number[];
  xs: number[];
  ys: number[];
}

export function fitData(): FitData {
  const x = Array.from({ length: 20 }, (_, i) => i / 19);
  const y = x.map((v, i) => Math.sin(2 * Math.PI * v) + NOISE[i]);
  return { xt: x.filter((_, i) => i % 2 === 0), yt: y.filter((_, i) => i % 2 === 0), xs: x.filter((_, i) => i % 2 === 1), ys: y.filter((_, i) => i % 2 === 1) };
}

export interface FitResult {
  deg: number;
  coef: number[];
  trainErr: number;
  testErr: number;
  curve: { x: number[]; y: number[] };
  verdict: 'infraajuste' | 'bien' | 'sobreajuste';
}

export function fitDegree(d: FitData, deg: number): FitResult {
  const coef = polyFit(d.xt, d.yt, deg);
  const trainErr = mse(d.xt.map((x) => polyEval(coef, x)), d.yt);
  const testErr = mse(d.xs.map((x) => polyEval(coef, x)), d.ys);
  const cx = Array.from({ length: 101 }, (_, i) => i / 100);
  const verdict: FitResult['verdict'] = testErr > Math.max(0.2, trainErr * 8) ? 'sobreajuste' : trainErr > 0.08 ? 'infraajuste' : 'bien';
  return { deg, coef, trainErr, testErr, curve: { x: cx, y: cx.map((x) => polyEval(coef, x)) }, verdict };
}

// ───────────────────────── entrenar / probar: memoria contra regla ─────────────────────────

export interface SplitPoint {
  x: number;
  label: 0 | 1;
}

/** 30 puntos con etiqueta «x > 5» pero con algunos errores de etiquetado (ruido). Orden fijo y barajado. */
export const SPLIT_POINTS: SplitPoint[] = [
  [7.9, 1], [2.1, 0], [5.6, 1], [8.8, 1], [1.2, 0], [4.4, 0], [6.3, 1], [3.1, 0], [9.5, 1], [5.2, 0],
  [0.7, 0], [6.9, 1], [4.1, 1], [8.1, 1], [2.9, 0], [7.2, 1], [5.9, 1], [3.6, 0], [9.1, 1], [1.8, 0],
  [6.1, 0], [4.8, 0], [7.6, 1], [2.5, 0], [8.4, 1], [5.4, 1], [3.9, 0], [9.8, 1], [1.5, 0], [6.6, 1],
].map(([x, label]) => ({ x: x as number, label: label as 0 | 1 }));

export interface SplitResult {
  nTrain: number;
  nTest: number;
  threshold: number;
  memTrain: number;
  memTest: number;
  ruleTrain: number;
  ruleTest: number;
}

const acc = (pred: number[], pts: SplitPoint[]) => (pts.length ? pred.reduce((s, p, i) => s + (p === pts[i].label ? 1 : 0), 0) / pts.length : 0);

/** Entrena en los primeros `nTrain` puntos y prueba en el resto, con dos modelos: «memoria» (1-NN) y «regla» (umbral). */
export function splitDemo(nTrain: number): SplitResult {
  const n = Math.max(2, Math.min(SPLIT_POINTS.length - 2, Math.round(nTrain)));
  const train = SPLIT_POINTS.slice(0, n);
  const test = SPLIT_POINTS.slice(n);
  const nearest = (x: number) => train.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best), train[0]).label;
  const cands = [...new Set(train.map((p) => p.x))].sort((a, b) => a - b);
  let threshold = cands[0];
  let best = -1;
  for (const t of cands) {
    const a = acc(train.map((p) => (p.x >= t ? 1 : 0)), train);
    if (a > best) {
      best = a;
      threshold = t;
    }
  }
  return {
    nTrain: n,
    nTest: test.length,
    threshold,
    memTrain: acc(train.map((p) => nearest(p.x)), train),
    memTest: acc(test.map((p) => nearest(p.x)), test),
    ruleTrain: acc(train.map((p) => (p.x >= threshold ? 1 : 0)), train),
    ruleTest: acc(test.map((p) => (p.x >= threshold ? 1 : 0)), test),
  };
}

// ───────────────────────── broadcasting ─────────────────────────

export interface BroadcastStep {
  /** posición contada desde la derecha (0 = última dimensión) */
  axis: number;
  a: number | null;
  b: number | null;
  out: number | null;
  ok: boolean;
  note: string;
}

export interface BroadcastResult {
  ok: boolean;
  shape: number[];
  steps: BroadcastStep[];
  error?: string;
}

export const fmtShape = (s: number[]): string => `(${s.join(', ')}${s.length === 1 ? ',' : ''})`;

/** Aplica las reglas de difusión de NumPy a dos formas y explica cada dimensión (de derecha a izquierda). */
export function broadcast(a: number[], b: number[]): BroadcastResult {
  const n = Math.max(a.length, b.length);
  const steps: BroadcastStep[] = [];
  const shape: number[] = new Array(n).fill(0);
  let ok = true;
  for (let k = 0; k < n; k++) {
    const x = k < a.length ? a[a.length - 1 - k] : null;
    const y = k < b.length ? b[b.length - 1 - k] : null;
    let out: number | null = null;
    let good = true;
    let note: string;
    if (x === null || y === null) {
      out = (x ?? y) as number;
      note = 'una de las formas no tiene esta dimensión: se añade con tamaño 1 y se estira';
    } else if (x === y) {
      out = x;
      note = 'iguales: encajan';
    } else if (x === 1) {
      out = y;
      note = `el 1 se estira hasta ${y}`;
    } else if (y === 1) {
      out = x;
      note = `el 1 se estira hasta ${x}`;
    } else {
      good = false;
      note = `${x} y ${y} no son iguales ni ninguno es 1`;
    }
    if (!good) ok = false;
    steps.push({ axis: k, a: x, b: y, out, ok: good, note });
    shape[n - 1 - k] = out ?? 0;
  }
  return ok
    ? { ok, shape, steps }
    : { ok, shape: [], steps, error: `ValueError: operands could not be broadcast together with shapes ${fmtShape(a)} ${fmtShape(b)}` };
}

export const SHAPE_CHOICES: number[][] = [[3, 4], [4], [3, 1], [1, 4], [5, 1], [2, 3, 4], [3], [1], [2, 1, 4]];

// ───────────────────────── vectores en el plano ─────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export const vecFrom = (angleDeg: number, len: number): Vec2 => ({ x: len * Math.cos((angleDeg * Math.PI) / 180), y: len * Math.sin((angleDeg * Math.PI) / 180) });

export interface VecStats {
  dot: number;
  normA: number;
  normB: number;
  cos: number;
  angle: number;
  dist: number;
  kind: 'misma dirección' | 'casi igual' | 'perpendiculares' | 'sentidos opuestos' | 'de direcciones distintas';
}

export function vecStats(a: Vec2, b: Vec2): VecStats {
  const dot = a.x * b.x + a.y * b.y;
  const na = Math.hypot(a.x, a.y);
  const nb = Math.hypot(b.x, b.y);
  const cos = na && nb ? Math.max(-1, Math.min(1, dot / (na * nb))) : 0;
  const kind: VecStats['kind'] = cos > 0.999 ? 'misma dirección' : cos > 0.9 ? 'casi igual' : Math.abs(cos) < 0.05 ? 'perpendiculares' : cos < -0.999 ? 'sentidos opuestos' : 'de direcciones distintas';
  return { dot, normA: na, normB: nb, cos, angle: (Math.acos(cos) * 180) / Math.PI, dist: Math.hypot(a.x - b.x, a.y - b.y), kind };
}

// ───────────────────────── Monte Carlo (π) ─────────────────────────

/** Generador congruencial sencillo y reproducible (solo para la ilustración). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface MonteCarlo {
  pts: { x: number; y: number; inside: boolean }[];
  inside: number;
  pi: number;
}

export function monteCarloPi(n: number, seed = 7): MonteCarlo {
  const r = lcg(seed);
  const pts: MonteCarlo['pts'] = [];
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const x = r();
    const y = r();
    const ok = x * x + y * y <= 1;
    if (ok) inside++;
    pts.push({ x, y, inside: ok });
  }
  return { pts, inside, pi: n ? (4 * inside) / n : 0 };
}

// ───────────────────────── descenso del gradiente 1-D ─────────────────────────

/** f(x) = (x − 3)² + 1  ⇒  f'(x) = 2(x − 3). */
export const gdF = (x: number): number => (x - 3) ** 2 + 1;
export const gdGrad = (x: number): number => 2 * (x - 3);

export interface GdStep {
  x: number;
  f: number;
  grad: number;
}

export function gdPath(x0: number, lr: number, steps: number): GdStep[] {
  const out: GdStep[] = [];
  let x = x0;
  for (let i = 0; i <= steps; i++) {
    out.push({ x, f: gdF(x), grad: gdGrad(x) });
    x = x - lr * gdGrad(x);
  }
  return out;
}

export type GdVerdict = 'converge' | 'zigzag' | 'diverge' | 'lento';

export function gdVerdict(path: GdStep[], lr: number): GdVerdict {
  const last = path[path.length - 1];
  if (!Number.isFinite(last.f) || last.f > path[0].f * 1.5 + 5) return 'diverge';
  if (lr > 0.95) return 'zigzag';
  if (Math.abs(last.x - 3) > 0.3) return 'lento';
  return 'converge';
}

// ───────────────────────── histograma: el número de intervalos ─────────────────────────

/** Dos grupos de clientes (ingresos en miles): datos fijos y reproducibles. */
export function histData(): number[] {
  const r = lcg(11);
  const normal = (mu: number, sd: number): number => {
    const u = Math.max(r(), 1e-9);
    const v = r();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return [...Array.from({ length: 70 }, () => normal(30, 4)), ...Array.from({ length: 50 }, () => normal(48, 5))];
}

export interface Hist {
  edges: number[];
  counts: number[];
}

export function histogram(data: number[], bins: number): Hist {
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const w = (hi - lo) / bins || 1;
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * w);
  const counts = new Array<number>(bins).fill(0);
  for (const v of data) counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  return { edges, counts };
}

/** Picos «reales» (máximos locales con altura relevante). */
export function countPeaks(counts: number[]): number {
  const max = Math.max(...counts);
  let peaks = 0;
  for (let i = 0; i < counts.length; i++) {
    const l = i > 0 ? counts[i - 1] : -1;
    const rr = i < counts.length - 1 ? counts[i + 1] : -1;
    if (counts[i] > l && counts[i] >= rr && counts[i] >= max * 0.5) peaks++;
  }
  return peaks;
}

export function histVerdict(bins: number): { kind: 'pocas' | 'bien' | 'muchas'; text: string } {
  if (bins <= 3) return { kind: 'pocas', text: 'Con tan pocas barras los dos grupos se funden en un bloque: la forma real queda escondida.' };
  if (bins <= 18) return { kind: 'bien', text: 'Se distinguen claramente dos grupos de clientes: uno en torno a 30 y otro en torno a 48.' };
  return { kind: 'muchas', text: 'Con demasiadas barras casi todas valen 0, 1 o 2: dibujas el ruido de la muestra, no la forma.' };
}

// ───────────────────────── fuga de datos ─────────────────────────

export const LEAK_TRAIN = [10, 12, 11, 13, 12, 14, 11, 13];
export const LEAK_TEST = [12, 60];

const meanOf = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const stdOf = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + (x - meanOf(v)) ** 2, 0) / v.length);

export interface LeakResult {
  mean: number;
  std: number;
  z: number[];
  fitted: number[];
}

/** Estandariza el conjunto de prueba con las estadísticas de `todo` (fuga) o solo de entrenamiento (correcto). */
export function leakDemo(fitOn: 'todo' | 'train'): LeakResult {
  const fitted = fitOn === 'todo' ? [...LEAK_TRAIN, ...LEAK_TEST] : LEAK_TRAIN;
  const mean = meanOf(fitted);
  const std = stdOf(fitted);
  return { mean, std, z: LEAK_TEST.map((x) => (x - mean) / std), fitted };
}
