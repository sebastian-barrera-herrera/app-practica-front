/** Lógica pura de las ilustraciones de deep learning práctico (zona 9 del curso de IA). Se prueba aparte. */

// ───────────────────────── formas de tensores ─────────────────────────

export type Shape = number[];
export type ShapeOp = 'unsqueeze0' | 'squeeze' | 'flatten' | 'moveFirstLast' | 'transpose' | 'sumFirst' | 'sumLast' | 'reshapeHalf' | 'matmulW';

export const SHAPE_OPS: Record<ShapeOp, { label: string; code: string }> = {
  unsqueeze0: { label: 'unsqueeze(0)', code: 'x.unsqueeze(0)' },
  squeeze: { label: 'squeeze()', code: 'x.squeeze()' },
  flatten: { label: 'flatten(1)', code: 'x.flatten(1)' },
  moveFirstLast: { label: 'permute (1.º al final)', code: 'x.permute(*range(1, x.ndim), 0)' },
  transpose: { label: 'transpose(-2, -1)', code: 'x.transpose(-2, -1)' },
  sumFirst: { label: 'sum(dim=0)', code: 'x.sum(dim=0)' },
  sumLast: { label: 'mean(dim=-1)', code: 'x.mean(dim=-1)' },
  reshapeHalf: { label: 'reshape(-1, 2)', code: 'x.reshape(-1, 2)' },
  matmulW: { label: '@ W  (última dim → 5)', code: 'x @ W   # W: (última, 5)' },
};

export const shapeSize = (s: Shape): number => s.reduce((a, b) => a * b, 1);
export const shapeStr = (s: Shape): string => (s.length === 0 ? 'torch.Size([])' : `torch.Size([${s.join(', ')}])`);

/** Aplica una operación y devuelve la nueva forma o el error exacto que daría PyTorch. */
export function applyShapeOp(s: Shape, op: ShapeOp): { shape: Shape } | { error: string } {
  switch (op) {
    case 'unsqueeze0':
      return { shape: [1, ...s] };
    case 'squeeze':
      return { shape: s.filter((d) => d !== 1) };
    case 'flatten':
      if (s.length < 2) return { shape: s.length === 0 ? [1] : [...s] };
      return { shape: [s[0], shapeSize(s.slice(1))] };
    case 'moveFirstLast':
      return s.length < 2 ? { shape: [...s] } : { shape: [...s.slice(1), s[0]] };
    case 'transpose':
      if (s.length < 2) return { error: `IndexError: Dimension out of range (expected to be in range of [${-s.length}, ${s.length - 1}], but got -2)` };
      return { shape: [...s.slice(0, -2), s[s.length - 1], s[s.length - 2]] };
    case 'sumFirst':
      return s.length === 0 ? { error: 'IndexError: Dimension specified as 0 but tensor has no dimensions' } : { shape: s.slice(1) };
    case 'sumLast':
      return s.length === 0 ? { error: 'IndexError: Dimension specified as -1 but tensor has no dimensions' } : { shape: s.slice(0, -1) };
    case 'reshapeHalf': {
      const n = shapeSize(s);
      return n % 2 === 0 ? { shape: [n / 2, 2] } : { error: `RuntimeError: shape '[-1, 2]' is invalid for input of size ${n}` };
    }
    case 'matmulW':
      if (s.length === 0) return { error: 'RuntimeError: both arguments to matmul need to be at least 1D, but they are 0D and 2D' };
      return { shape: [...s.slice(0, -1), 5] };
  }
}

// ───────────────────────── autograd: el laboratorio de .grad ─────────────────────────

export interface AgState {
  w: number;
  grad: number | null;
  loss: number | null;
  log: string[];
}

/** L = (3·w − 6)²  ⇒  dL/dw = 6·(3w − 6). El óptimo es w = 2. */
export const agLoss = (w: number): number => (3 * w - 6) ** 2;
export const agGrad = (w: number): number => 6 * (3 * w - 6);

export type AgAction = 'forward' | 'backward' | 'zero_grad' | 'step';

export const agInit = (w = 0): AgState => ({ w, grad: null, loss: null, log: [] });

export function agApply(s: AgState, a: AgAction, lr = 0.05): AgState {
  switch (a) {
    case 'forward':
      return { ...s, loss: agLoss(s.w), log: [`loss = ${agLoss(s.w).toFixed(2)}`, ...s.log].slice(0, 6) };
    case 'backward': {
      if (s.loss === null) return { ...s, log: ['⚠️ backward() sin loss: primero hay que calcularla (forward)', ...s.log].slice(0, 6) };
      const g = (s.grad ?? 0) + agGrad(s.w);
      return { ...s, grad: g, log: [`backward() → w.grad = ${g.toFixed(2)}${s.grad !== null ? '  (¡se ha SUMADO al anterior!)' : ''}`, ...s.log].slice(0, 6) };
    }
    case 'zero_grad':
      return { ...s, grad: null, log: ['zero_grad() → w.grad = None', ...s.log].slice(0, 6) };
    case 'step': {
      if (s.grad === null) return { ...s, log: ['step() sin gradiente: no cambia nada', ...s.log].slice(0, 6) };
      const w = s.w - lr * s.grad;
      return { ...s, w, loss: null, log: [`step() → w = ${w.toFixed(3)}`, ...s.log].slice(0, 6) };
    }
  }
}

// ───────────────────────── el bucle de entrenamiento y sus fallos típicos ─────────────────────────

export type LoopBug = 'ninguno' | 'sin_zero_grad' | 'sin_step' | 'sin_backward';

/** Ajusta w en y = 2x con descenso del gradiente. Devuelve la pérdida en cada iteración. */
export function loopSim(bug: LoopBug, iters = 30, lr = 0.1): number[] {
  const xs = [-1, -0.5, 0, 0.5, 1];
  const ys = xs.map((x) => 2 * x);
  let w = 0;
  let grad = 0;
  const out: number[] = [];
  for (let i = 0; i < iters; i++) {
    if (bug !== 'sin_zero_grad') grad = 0;
    const loss = xs.reduce((s, x, k) => s + (w * x - ys[k]) ** 2, 0) / xs.length;
    out.push(loss);
    if (bug !== 'sin_backward') grad += xs.reduce((s, x, k) => s + 2 * (w * x - ys[k]) * x, 0) / xs.length;
    if (bug !== 'sin_step') w -= lr * grad;
  }
  return out;
}

// ───────────────────────── convolución ─────────────────────────

export type Grid = number[][];

export const KERNELS: Record<string, { label: string; k: Grid; note: string }> = {
  vertical: { label: 'Borde vertical', k: [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]], note: 'Responde donde el brillo cambia de izquierda a derecha.' },
  horizontal: { label: 'Borde horizontal', k: [[-1, -1, -1], [0, 0, 0], [1, 1, 1]], note: 'Responde donde el brillo cambia de arriba abajo.' },
  desenfoque: { label: 'Desenfoque', k: [[1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9], [1 / 9, 1 / 9, 1 / 9]], note: 'Promedia los vecinos: suaviza la imagen.' },
  identidad: { label: 'Identidad', k: [[0, 0, 0], [0, 1, 0], [0, 0, 0]], note: 'Copia el píxel central: no cambia nada.' },
};

/** Imagen de 7×7 con una «L» (el mismo dibujo siempre). */
export const IMG_L: Grid = [
  [0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0],
];

export const outSize = (n: number, k: number, p = 0, s = 1): number => Math.floor((n + 2 * p - k) / s) + 1;

/** Correlación cruzada 2D (lo que hace nn.Conv2d), con relleno de ceros y paso. */
export function convolve2d(img: Grid, k: Grid, stride = 1, pad = 0): Grid {
  const h = img.length;
  const w = img[0].length;
  const kh = k.length;
  const kw = k[0].length;
  const get = (r: number, c: number): number => (r < 0 || c < 0 || r >= h || c >= w ? 0 : img[r][c]);
  const oh = outSize(h, kh, pad, stride);
  const ow = outSize(w, kw, pad, stride);
  const out: Grid = [];
  for (let i = 0; i < oh; i++) {
    const row: number[] = [];
    for (let j = 0; j < ow; j++) {
      let s = 0;
      for (let a = 0; a < kh; a++) for (let b = 0; b < kw; b++) s += get(i * stride - pad + a, j * stride - pad + b) * k[a][b];
      row.push(s);
    }
    out.push(row);
  }
  return out;
}

export function maxPool(m: Grid, size = 2): Grid {
  const oh = Math.floor(m.length / size);
  const ow = Math.floor(m[0].length / size);
  const out: Grid = [];
  for (let i = 0; i < oh; i++) {
    const row: number[] = [];
    for (let j = 0; j < ow; j++) {
      let best = -Infinity;
      for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) best = Math.max(best, m[i * size + a][j * size + b]);
      row.push(best);
    }
    out.push(row);
  }
  return out;
}

// ───────────────────────── memoria de una RNN frente a una celda con puerta ─────────────────────────

/** Estado oculto de una RNN simple: h_t = tanh(w·h_{t−1} + x_t). */
export function rnnTrace(x: number[], w: number): number[] {
  let h = 0;
  return x.map((v) => (h = Math.tanh(w * h + v)));
}

/** Estado de celda de una LSTM simplificada: c_t = f·c_{t−1} + i·x_t (sin tanh en la ruta de la celda). */
export function cellTrace(x: number[], f: number, i = 1): number[] {
  let c = 0;
  return x.map((v) => (c = f * c + i * v));
}

/** Cuánto cambia el estado final por haber visto un 1 en el primer paso (frente a un 0). */
export function memoryOfFirst(len: number, kind: 'rnn' | 'cell', param: number): number {
  const a = Array(len).fill(0) as number[];
  const b = Array(len).fill(0) as number[];
  a[0] = 1;
  const tr = (x: number[]): number[] => (kind === 'rnn' ? rnnTrace(x, param) : cellTrace(x, param));
  return Math.abs(tr(a)[len - 1] - tr(b)[len - 1]);
}

// ───────────────────────── sobreajuste, regularización y parada temprana ─────────────────────────

export interface Reg {
  capacidad: 1 | 2 | 3;
  dropout: boolean;
  decay: boolean;
}

/** Curvas sintéticas de pérdida (entrenamiento y validación) con la forma típica de los experimentos reales. */
export function overfitCurves(r: Reg, epochs = 60): { train: number[]; val: number[] } {
  const cap = r.capacidad;
  const tau = [34, 20, 12][cap - 1];
  const floor = [0.42, 0.18, 0.02][cap - 1];
  const reg = (r.dropout ? 1 : 0) + (r.decay ? 1 : 0);
  const train: number[] = [];
  const val: number[] = [];
  for (let e = 0; e < epochs; e++) {
    const slow = 1 + 0.35 * reg;
    const tr = floor * (1 + reg * 0.9) + (2.3 - floor) * Math.exp(-e / (tau * slow));
    const gap = [0.04, 0.2, 0.55][cap - 1] * (1 - 0.32 * reg);
    const rise = Math.max(0, e - tau * 1.1 * (1 + 0.6 * reg));
    const v = 0.34 + (2.3 - 0.34) * Math.exp(-e / (tau * 0.9 * slow)) + gap * (1 - Math.exp(-rise / 14)) + (cap === 1 ? 0.12 : 0);
    train.push(tr);
    val.push(v);
  }
  return { train, val };
}

export const bestEpoch = (val: number[]): number => val.reduce((b, v, i) => (v < val[b] ? i : b), 0);

/** Época en la que pararía la parada temprana con una paciencia dada (índice de la mejor época vista antes de agotarla). */
export function earlyStop(val: number[], patience: number): number {
  let best = 0;
  let wait = 0;
  for (let i = 1; i < val.length; i++) {
    if (val[i] < val[best]) {
      best = i;
      wait = 0;
    } else if (++wait >= patience) return i;
  }
  return val.length - 1;
}
