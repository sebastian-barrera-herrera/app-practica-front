/**
 * Álgebra lineal de `numpy.linalg` para matrices pequeñas: LU, inversa, determinante, sistemas, QR, Cholesky,
 * valores propios (Jacobi para simétricas, QR para el resto con autovalores reales), SVD (Jacobi unilateral)
 * y normas. Los signos de los vectores propios/singulares pueden diferir de LAPACK.
 */
import { valueError } from '../../runtime/errors';
import { copyOf, flatNum, mkNum, NdArray, reshapeTo } from './nd';

export class LinAlgFailure extends Error {}

export interface Mat {
  d: Float64Array;
  n: number;
  m: number;
}

export function toMat(a: NdArray): Mat {
  if (a.ndim !== 2) throw valueError(`${a.ndim}-dimensional array given. Array must be at least two-dimensional`);
  return { d: Float64Array.from(flatNum(a)), n: a.shape[0], m: a.shape[1] };
}

export const fromMat = (x: Mat): NdArray => mkNum(x.d, [x.n, x.m], 'float64');

const identity = (n: number): Mat => {
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) d[i * n + i] = 1;
  return { d, n, m: n };
};

function needSquare(x: Mat): void {
  if (x.n !== x.m) throw valueError('Last 2 dimensions of the array must be square');
}

// ───────────────────────── LU, inversa, determinante, sistemas ─────────────────────────

export function luDecompose(x: Mat): { lu: Float64Array; piv: number[]; sign: number; singular: boolean } {
  needSquare(x);
  const n = x.n;
  const lu = Float64Array.from(x.d);
  const piv = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  let singular = false;
  for (let c = 0; c < n; c++) {
    let p = c;
    let best = Math.abs(lu[c * n + c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(lu[r * n + c]) > best) {
      best = Math.abs(lu[r * n + c]);
      p = r;
    }
    if (best === 0) {
      singular = true;
      continue;
    }
    if (p !== c) {
      for (let k = 0; k < n; k++) {
        const t = lu[c * n + k];
        lu[c * n + k] = lu[p * n + k];
        lu[p * n + k] = t;
      }
      [piv[c], piv[p]] = [piv[p], piv[c]];
      sign = -sign;
    }
    for (let r = c + 1; r < n; r++) {
      lu[r * n + c] /= lu[c * n + c];
      const f = lu[r * n + c];
      if (f !== 0) for (let k = c + 1; k < n; k++) lu[r * n + k] -= f * lu[c * n + k];
    }
  }
  return { lu, piv, sign, singular };
}

export function det(x: Mat): number {
  const { lu, sign, singular } = luDecompose(x);
  if (singular) return 0;
  // como NumPy: signo × exp(Σ log|u_ii|), de ahí que det([[1,2],[3,4]]) dé -2.0000000000000004
  let sgn = sign;
  let logdet = 0;
  for (let i = 0; i < x.n; i++) {
    const u = lu[i * x.n + i];
    if (u < 0) sgn = -sgn;
    logdet += Math.log(Math.abs(u));
  }
  return sgn * Math.exp(logdet);
}

export function solveMat(a: Mat, b: Mat): Mat {
  const { lu, piv, singular } = luDecompose(a);
  if (singular) throw new LinAlgFailure('Singular matrix');
  const n = a.n;
  const out = new Float64Array(n * b.m);
  for (let c = 0; c < b.m; c++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = b.d[piv[i] * b.m + c];
      for (let k = 0; k < i; k++) s -= lu[i * n + k] * y[k];
      y[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= lu[i * n + k] * out[k * b.m + c];
      out[i * b.m + c] = s / lu[i * n + i];
    }
  }
  return { d: out, n, m: b.m };
}

export const inv = (a: Mat): Mat => solveMat(a, identity(a.n));

// ───────────────────────── QR, Cholesky ─────────────────────────

export function qr(x: Mat, complete: boolean): { q: Mat; r: Mat } {
  const { n: m, m: n } = x;
  const r = Float64Array.from(x.d);
  const q = identity(m).d;
  const steps = Math.min(m - 1, n);
  for (let k = 0; k < steps; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += r[i * n + k] * r[i * n + k];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = r[k * n + k] > 0 ? -norm : norm;
    const v = new Float64Array(m);
    for (let i = k; i < m; i++) v[i] = r[i * n + k];
    v[k] -= alpha;
    let vn = 0;
    for (let i = k; i < m; i++) vn += v[i] * v[i];
    if (vn === 0) continue;
    for (let c = 0; c < n; c++) {
      let dotp = 0;
      for (let i = k; i < m; i++) dotp += v[i] * r[i * n + c];
      const f = (2 * dotp) / vn;
      for (let i = k; i < m; i++) r[i * n + c] -= f * v[i];
    }
    for (let rr = 0; rr < m; rr++) {
      let dotp = 0;
      for (let i = k; i < m; i++) dotp += q[rr * m + i] * v[i];
      const f = (2 * dotp) / vn;
      for (let i = k; i < m; i++) q[rr * m + i] -= f * v[i];
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) r[i * n + j] = 0;
  const k = complete ? m : Math.min(m, n);
  const qd = new Float64Array(m * k);
  for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) qd[i * k + j] = q[i * m + j];
  const rd = new Float64Array(k * n);
  for (let i = 0; i < k; i++) for (let j = 0; j < n; j++) rd[i * n + j] = r[i * n + j];
  return { q: { d: qd, n: m, m: k }, r: { d: rd, n: k, m: n } };
}

export function cholesky(x: Mat): Mat {
  needSquare(x);
  const n = x.n;
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = x.d[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (s <= 0) throw new LinAlgFailure('Matrix is not positive definite');
        l[i * n + i] = Math.sqrt(s);
      } else l[i * n + j] = s / l[j * n + j];
    }
  return { d: l, n, m: n };
}

// ───────────────────────── valores propios y SVD ─────────────────────────

/** Jacobi para matrices simétricas: valores propios ascendentes y vectores en columnas */
export function eigh(x: Mat): { w: Float64Array; v: Mat } {
  needSquare(x);
  const n = x.n;
  const A = Float64Array.from(x.d);
  const V = identity(n).d;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (off < 1e-30) break;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p];
          const akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k];
          const aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p];
          const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[i * n + i] - A[j * n + j]);
  const w = Float64Array.from(order, (i) => A[i * n + i]);
  const vs = new Float64Array(n * n);
  order.forEach((src, dst) => {
    // signo determinista: la mayor componente en valor absoluto, positiva… como suele salir en LAPACK para casos simples
    let big = 0;
    for (let k = 0; k < n; k++) if (Math.abs(V[k * n + src]) > Math.abs(V[big * n + src])) big = k;
    const sgn = V[big * n + src] < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) vs[k * n + dst] = sgn * V[k * n + src];
  });
  return { w, v: { d: vs, n, m: n } };
}

/** valores propios reales de una matriz general por iteración QR con desplazamiento; vectores por resolución del núcleo */
export function eigGeneral(x: Mat): { w: Float64Array; v: Mat } {
  needSquare(x);
  const n = x.n;
  let sym = true;
  for (let i = 0; i < n && sym; i++) for (let j = 0; j < i; j++) if (Math.abs(x.d[i * n + j] - x.d[j * n + i]) > 1e-12 * (1 + Math.abs(x.d[i * n + j]))) sym = false;
  if (sym) return eigh(x);
  let A: Mat = { d: Float64Array.from(x.d), n, m: n };
  for (let it = 0; it < 500; it++) {
    const mu = A.d[(n - 1) * n + (n - 1)];
    const shifted = Float64Array.from(A.d);
    for (let i = 0; i < n; i++) shifted[i * n + i] -= mu;
    const { q, r } = qr({ d: shifted, n, m: n }, true);
    const next = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += r.d[i * n + k] * q.d[k * n + j];
      next[i * n + j] = s + (i === j ? mu : 0);
    }
    A = { d: next, n, m: n };
    let low = 0;
    for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) low += Math.abs(A.d[i * n + j]);
    if (low < 1e-12) break;
  }
  for (let i = 1; i < n; i++) if (Math.abs(A.d[i * n + (i - 1)]) > 1e-8 && i + 1 < n + 1 && i < n) {
    // bloque 2×2 con autovalores complejos
    const a = A.d[(i - 1) * n + (i - 1)];
    const d = A.d[i * n + i];
    const b = A.d[(i - 1) * n + i];
    const c = A.d[i * n + (i - 1)];
    if ((a - d) * (a - d) + 4 * b * c < 0) throw new LinAlgFailure('Esta matriz tiene valores propios complejos, que este entorno no admite');
  }
  const w = Float64Array.from({ length: n }, (_, i) => A.d[i * n + i]).sort((p, q) => p - q);
  const vs = new Float64Array(n * n);
  for (let k = 0; k < n; k++) {
    // vector propio: iteración inversa sobre (A - (λ+ε)I)
    const lam = w[k] + 1e-10;
    const M = Float64Array.from(x.d);
    for (let i = 0; i < n; i++) M[i * n + i] -= lam;
    let v: Mat = { d: Float64Array.from({ length: n }, (_, i) => 1 + i * 0.01), n, m: 1 };
    for (let it = 0; it < 8; it++) {
      try {
        v = solveMat({ d: M, n, m: n }, v);
      } catch {
        break;
      }
      let nr = 0;
      for (let i = 0; i < n; i++) nr += v.d[i] * v.d[i];
      nr = Math.sqrt(nr);
      for (let i = 0; i < n; i++) v.d[i] /= nr;
    }
    let big = 0;
    for (let i = 0; i < n; i++) if (Math.abs(v.d[i]) > Math.abs(v.d[big])) big = i;
    const sgn = v.d[big] < 0 ? -1 : 1;
    for (let i = 0; i < n; i++) vs[i * n + k] = sgn * v.d[i];
  }
  return { w, v: { d: vs, n, m: n } };
}

/** SVD por Jacobi unilateral. Devuelve U (m×k), S (k), Vt (k×n) con k = min(m, n) */
export function svd(x: Mat): { u: Mat; s: Float64Array; vt: Mat } {
  const { n: m, m: n } = x;
  if (m < n) {
    const t = svd(transposeMat(x));
    return { u: transposeMat(t.vt), s: t.s, vt: transposeMat(t.u) };
  }
  const U = Float64Array.from(x.d);
  const V = identity(n).d;
  for (let sweep = 0; sweep < 60; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += U[i * n + p] * U[i * n + p];
          beta += U[i * n + q] * U[i * n + q];
          gamma += U[i * n + p] * U[i * n + q];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const up = U[i * n + p];
          const uq = U[i * n + q];
          U[i * n + p] = c * up - s * uq;
          U[i * n + q] = s * up + c * uq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i * n + p];
          const vq = V[i * n + q];
          V[i * n + p] = c * vp - s * vq;
          V[i * n + q] = s * vp + c * vq;
        }
      }
    if (!rotated) break;
  }
  const sv = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += U[i * n + j] * U[i * n + j];
    sv[j] = Math.sqrt(s);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => sv[j] - sv[i]);
  const u = new Float64Array(m * n);
  const vt = new Float64Array(n * n);
  const s = new Float64Array(n);
  order.forEach((src, dst) => {
    s[dst] = sv[src];
    for (let i = 0; i < m; i++) u[i * n + dst] = sv[src] > 1e-300 ? U[i * n + src] / sv[src] : 0;
    for (let i = 0; i < n; i++) vt[dst * n + i] = V[i * n + src];
  });
  return { u: { d: u, n: m, m: n }, s, vt: { d: vt, n, m: n } };
}

export function transposeMat(x: Mat): Mat {
  const d = new Float64Array(x.d.length);
  for (let i = 0; i < x.n; i++) for (let j = 0; j < x.m; j++) d[j * x.n + i] = x.d[i * x.m + j];
  return { d, n: x.m, m: x.n };
}

/** completa U (m×k) hasta una base ortonormal m×m (para `full_matrices=True`) */
export function completeBasis(u: Mat): Mat {
  const { n: m, m: k } = u;
  const cols: Float64Array[] = [];
  for (let j = 0; j < k; j++) cols.push(Float64Array.from({ length: m }, (_, i) => u.d[i * k + j]));
  for (let e = 0; e < m && cols.length < m; e++) {
    const v = new Float64Array(m);
    v[e] = 1;
    for (const c of cols) {
      let dp = 0;
      for (let i = 0; i < m; i++) dp += c[i] * v[i];
      for (let i = 0; i < m; i++) v[i] -= dp * c[i];
    }
    let nr = 0;
    for (let i = 0; i < m; i++) nr += v[i] * v[i];
    nr = Math.sqrt(nr);
    if (nr > 1e-8) {
      for (let i = 0; i < m; i++) v[i] /= nr;
      cols.push(v);
    }
  }
  const d = new Float64Array(m * m);
  cols.forEach((c, j) => {
    for (let i = 0; i < m; i++) d[i * m + j] = c[i];
  });
  return { d, n: m, m };
}

export function pinv(x: Mat, rcond = 1e-15): Mat {
  const { u, s, vt } = svd(x);
  const cutoff = rcond * (s.length ? s[0] : 0) * Math.max(x.n, x.m);
  const k = s.length;
  const out = new Float64Array(x.m * x.n);
  for (let i = 0; i < x.m; i++) for (let j = 0; j < x.n; j++) {
    let acc = 0;
    for (let p = 0; p < k; p++) if (s[p] > cutoff) acc += (vt.d[p * x.m + i] * u.d[j * k + p]) / s[p];
    out[i * x.n + j] = acc;
  }
  return { d: out, n: x.m, m: x.n };
}

// ───────────────────────── normas ─────────────────────────

export function vectorNorm(v: Float64Array, ord: number | 'fro'): number {
  if (ord === 'fro' || ord === 2) {
    let s = 0;
    let scale = 0;
    for (const x of v) scale = Math.max(scale, Math.abs(x));
    if (scale === 0) return 0;
    for (const x of v) s += (x / scale) * (x / scale);
    return scale * Math.sqrt(s);
  }
  if (ord === Infinity) return v.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  if (ord === -Infinity) return v.reduce((m, x) => Math.min(m, Math.abs(x)), Infinity);
  if (ord === 1) return v.reduce((s, x) => s + Math.abs(x), 0);
  if (ord === 0) return v.reduce((s, x) => s + (x !== 0 ? 1 : 0), 0);
  return Math.pow(v.reduce((s, x) => s + Math.pow(Math.abs(x), ord), 0), 1 / ord);
}

export function matrixNorm(x: Mat, ord: number | 'fro' | 'nuc'): number {
  if (ord === 'fro') return vectorNorm(x.d, 'fro');
  if (ord === 'nuc') return svd(x).s.reduce((s, v) => s + v, 0);
  if (ord === 2) return svd(x).s[0] ?? 0;
  if (ord === -2) return svd(x).s[Math.min(x.n, x.m) - 1] ?? 0;
  if (ord === 1 || ord === -1) {
    const cols = Array.from({ length: x.m }, (_, j) => {
      let s = 0;
      for (let i = 0; i < x.n; i++) s += Math.abs(x.d[i * x.m + j]);
      return s;
    });
    return ord === 1 ? Math.max(...cols) : Math.min(...cols);
  }
  const rows = Array.from({ length: x.n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < x.m; j++) s += Math.abs(x.d[i * x.m + j]);
    return s;
  });
  return ord === Infinity ? Math.max(...rows) : Math.min(...rows);
}

export { copyOf, reshapeTo };
