/** Lógica pura de las ilustraciones de redes neuronales (zona 8 del curso de IA). Se prueba aparte. */
import { gaussian } from './iaMlLogic';

// ───────────────────────── la neurona y las puertas lógicas ─────────────────────────

export type Act = 'paso' | 'sigmoide' | 'tanh' | 'relu' | 'leaky' | 'softplus';
export type Gate = 'AND' | 'OR' | 'XOR';

export const ACT_NAMES: Record<Act, string> = { paso: 'Paso', sigmoide: 'Sigmoide', tanh: 'tanh', relu: 'ReLU', leaky: 'Leaky ReLU', softplus: 'Softplus' };

export function act(name: Act, z: number): number {
  switch (name) {
    case 'paso': return z >= 0 ? 1 : 0;
    case 'sigmoide': return 1 / (1 + Math.exp(-z));
    case 'tanh': return Math.tanh(z);
    case 'relu': return Math.max(0, z);
    case 'leaky': return z > 0 ? z : 0.1 * z;
    case 'softplus': return Math.log1p(Math.exp(z));
  }
}

/** Derivada de la activación (la del paso se toma 0: es la razón por la que no se entrena con gradiente). */
export function dact(name: Act, z: number): number {
  switch (name) {
    case 'paso': return 0;
    case 'sigmoide': { const s = act('sigmoide', z); return s * (1 - s); }
    case 'tanh': return 1 - Math.tanh(z) ** 2;
    case 'relu': return z > 0 ? 1 : 0;
    case 'leaky': return z > 0 ? 1 : 0.1;
    case 'softplus': return 1 / (1 + Math.exp(-z));
  }
}

export const GATE_INPUTS: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]];
export const GATE_TARGETS: Record<Gate, number[]> = { AND: [0, 0, 0, 1], OR: [0, 1, 1, 1], XOR: [0, 1, 1, 0] };

/** Salida de una neurona de dos entradas. */
export const neuron = (w1: number, w2: number, b: number, a: Act, x1: number, x2: number): number => act(a, w1 * x1 + w2 * x2 + b);

/** Cuántas de las 4 combinaciones acierta (la salida se redondea al lado más cercano de 0 y 1; tanh: el signo). */
export function gateScore(w1: number, w2: number, b: number, a: Act, gate: Gate): number {
  let ok = 0;
  GATE_INPUTS.forEach(([x1, x2], i) => {
    const out = neuron(w1, w2, b, a, x1, x2);
    const pred = a === 'tanh' ? (out > 0 ? 1 : 0) : out >= 0.5 ? 1 : 0;
    if (pred === GATE_TARGETS[gate][i]) ok++;
  });
  return ok;
}

/** Mejor puntuación posible con una sola neurona en una rejilla de pesos (para demostrar que XOR no se puede). */
export function bestGateScore(gate: Gate, a: Act = 'paso'): number {
  let best = 0;
  for (let w1 = -2; w1 <= 2; w1 += 0.5) for (let w2 = -2; w2 <= 2; w2 += 0.5) for (let b = -2; b <= 2; b += 0.25) best = Math.max(best, gateScore(w1, w2, b, a, gate));
  return best;
}

// ───────────────────────── propagación hacia delante (XOR a mano) ─────────────────────────

export interface FwdXor {
  h1: number;
  h2: number;
  out: number;
}

/** Red 2-2-1 con pesos elegidos a mano: h1 = OR-ish, h2 = AND-ish, salida = h1 − 2·h2. Sin activación no resuelve XOR. */
export function forwardXor(x1: number, x2: number, mode: 'relu' | 'lineal'): FwdXor {
  const f = (z: number): number => (mode === 'relu' ? Math.max(0, z) : z);
  const h1 = f(x1 + x2);
  const h2 = f(x1 + x2 - 1);
  return { h1, h2, out: h1 - 2 * h2 };
}

// ───────────────────────── activaciones: curvas ─────────────────────────

export function curve(name: Act, lo = -6, hi = 6, n = 60): { x: number; y: number; d: number }[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / n;
    return { x, y: act(name, x), d: dact(name, x) };
  });
}

export function softmax(z: number[], T = 1): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp((v - m) / T));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

// ───────────────────────── retropropagación en una neurona ─────────────────────────

export interface Bp {
  z: number;
  a: number;
  loss: number;
  dLda: number;
  dadz: number;
  dzdw: number;
  dLdz: number;
  dLdw: number;
  dLdb: number;
}

/** z = w·x + b → a = σ(z) → L = (a − y)². Devuelve el paso hacia delante y todas las derivadas locales. */
export function bpGraph(w: number, b: number, x: number, y: number): Bp {
  const z = w * x + b;
  const a = 1 / (1 + Math.exp(-z));
  const loss = (a - y) ** 2;
  const dLda = 2 * (a - y);
  const dadz = a * (1 - a);
  const dzdw = x;
  const dLdz = dLda * dadz;
  return { z, a, loss, dLda, dadz, dzdw, dLdz, dLdw: dLdz * dzdw, dLdb: dLdz };
}

// ───────────────────────── entrenar una red 2-H-1 sobre dos lunas ─────────────────────────

export interface Pt {
  x: number;
  y: number;
  c: 0 | 1;
}

/** Dos medias lunas con ruido (reproducible). Coordenadas aproximadas en [-1.2, 2.2] × [-0.7, 1.2]. */
export function moonsData(n = 60, seed = 3): Pt[] {
  const g = gaussian(seed);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (Math.PI * (i % (n / 2))) / (n / 2);
    const c: 0 | 1 = i < n / 2 ? 0 : 1;
    const x = c === 0 ? Math.cos(t) : 1 - Math.cos(t);
    const y = c === 0 ? Math.sin(t) : 0.5 - Math.sin(t);
    out.push({ x: x + 0.12 * g(), y: y + 0.12 * g(), c });
  }
  return out;
}

export interface Net {
  h: number;
  W1: number[][]; // 2 × h
  b1: number[];
  W2: number[]; // h
  b2: number;
  epoch: number;
}

export function makeNet(h: number, seed = 5): Net {
  const g = gaussian(seed);
  return { h, W1: [0, 1].map(() => Array.from({ length: h }, () => 0.5 * g())), b1: Array(h).fill(0), W2: Array.from({ length: h }, () => 0.5 * g()), b2: 0, epoch: 0 };
}

export function predict(net: Net, x: number, y: number): number {
  let z2 = net.b2;
  for (let j = 0; j < net.h; j++) z2 += net.W2[j] * Math.tanh(x * net.W1[0][j] + y * net.W1[1][j] + net.b1[j]);
  return 1 / (1 + Math.exp(-z2));
}

export function lossOf(net: Net, data: Pt[]): number {
  let s = 0;
  for (const p of data) {
    const a = Math.min(1 - 1e-9, Math.max(1e-9, predict(net, p.x, p.y)));
    s -= p.c * Math.log(a) + (1 - p.c) * Math.log(1 - a);
  }
  return s / data.length;
}

export const accuracyOf = (net: Net, data: Pt[]): number => data.filter((p) => (predict(net, p.x, p.y) >= 0.5 ? 1 : 0) === p.c).length / data.length;

/** Descenso del gradiente por lotes completos (la misma retropropagación de la lección 5). Devuelve la pérdida de cada época. */
export function trainEpochs(net: Net, data: Pt[], lr: number, epochs: number): number[] {
  const n = data.length;
  const hist: number[] = [];
  for (let e = 0; e < epochs; e++) {
    const gW1 = [Array(net.h).fill(0), Array(net.h).fill(0)];
    const gb1 = Array(net.h).fill(0);
    const gW2 = Array(net.h).fill(0);
    let gb2 = 0;
    let loss = 0;
    for (const p of data) {
      const a1 = net.W2.map((_, j) => Math.tanh(p.x * net.W1[0][j] + p.y * net.W1[1][j] + net.b1[j]));
      let z2 = net.b2;
      for (let j = 0; j < net.h; j++) z2 += net.W2[j] * a1[j];
      const a2 = 1 / (1 + Math.exp(-z2));
      const aa = Math.min(1 - 1e-9, Math.max(1e-9, a2));
      loss -= p.c * Math.log(aa) + (1 - p.c) * Math.log(1 - aa);
      const dz2 = (a2 - p.c) / n;
      gb2 += dz2;
      for (let j = 0; j < net.h; j++) {
        gW2[j] += dz2 * a1[j];
        const dz1 = dz2 * net.W2[j] * (1 - a1[j] ** 2);
        gW1[0][j] += dz1 * p.x;
        gW1[1][j] += dz1 * p.y;
        gb1[j] += dz1;
      }
    }
    for (let j = 0; j < net.h; j++) {
      net.W1[0][j] -= lr * gW1[0][j];
      net.W1[1][j] -= lr * gW1[1][j];
      net.b1[j] -= lr * gb1[j];
      net.W2[j] -= lr * gW2[j];
    }
    net.b2 -= lr * gb2;
    net.epoch++;
    hist.push(loss / n);
  }
  return hist;
}

// ───────────────────────── optimizadores en un valle alargado ─────────────────────────

export type Opt = 'sgd' | 'momento' | 'adam';
export const OPT_NAMES: Record<Opt, string> = { sgd: 'SGD', momento: 'Momento', adam: 'Adam' };

/** f(x, y) = ½ (x² + 25 y²): un valle estrecho. */
export const valley = (x: number, y: number): number => 0.5 * (x * x + 25 * y * y);

export function optPath(kind: Opt, lr: number, steps: number, start: [number, number] = [4, 1]): { path: [number, number][]; loss: number } {
  let p: [number, number] = [...start];
  let v: [number, number] = [0, 0];
  let m: [number, number] = [0, 0];
  let s: [number, number] = [0, 0];
  const path: [number, number][] = [[...p]];
  for (let t = 1; t <= steps; t++) {
    const g: [number, number] = [p[0], 25 * p[1]];
    if (kind === 'sgd') p = [p[0] - lr * g[0], p[1] - lr * g[1]];
    else if (kind === 'momento') {
      v = [0.9 * v[0] - lr * g[0], 0.9 * v[1] - lr * g[1]];
      p = [p[0] + v[0], p[1] + v[1]];
    } else {
      m = [0.9 * m[0] + 0.1 * g[0], 0.9 * m[1] + 0.1 * g[1]];
      s = [0.999 * s[0] + 0.001 * g[0] ** 2, 0.999 * s[1] + 0.001 * g[1] ** 2];
      const mh = [m[0] / (1 - 0.9 ** t), m[1] / (1 - 0.9 ** t)];
      const sh = [s[0] / (1 - 0.999 ** t), s[1] / (1 - 0.999 ** t)];
      p = [p[0] - (lr * mh[0]) / (Math.sqrt(sh[0]) + 1e-8), p[1] - (lr * mh[1]) / (Math.sqrt(sh[1]) + 1e-8)];
    }
    path.push([...p]);
  }
  return { path, loss: valley(p[0], p[1]) };
}
