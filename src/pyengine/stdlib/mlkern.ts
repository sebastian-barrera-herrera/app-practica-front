/**
 * `_mlkern`: núcleos numéricos del curso de IA escritos en TypeScript (los usa `sklearn` en Python).
 *
 * Contiene un puerto del constructor de árboles de scikit-learn (`_tree.pyx`, `_splitter.pyx`, `_criterion.pyx`):
 * el mismo orden de visita de características (generador xorshift `rand_r`), los mismos criterios (gini, entropía,
 * error cuadrático, Friedman) y el mismo desempate, de modo que los árboles salen idénticos a los de scikit-learn.
 */
import { PyFloat, PyList, PyTuple } from '../runtime/objects';
import { registerNative } from './registry';
import { mfn } from './helpers';
import { arr, intArg, isNone, numArg } from './numpy/args';
import { flatNum, mkNum, NdArray } from './numpy/nd';

const EPSILON = 2.220446049250313e-16;
const FEATURE_THRESHOLD = 1e-7;
const RAND_R_MAX = 2147483647;

interface Rng {
  s: number;
}

function ourRandR(st: Rng): number {
  let s = st.s >>> 0;
  s = (s ^ (s << 13)) >>> 0;
  s = (s ^ (s >>> 17)) >>> 0;
  s = (s ^ (s << 5)) >>> 0;
  st.s = s;
  return s % (RAND_R_MAX + 1);
}

const randInt = (low: number, high: number, st: Rng): number => low + (ourRandR(st) % (high - low));

export interface TreeCfg {
  criterion: string;
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  minWeightLeaf: number;
  minImpurityDecrease: number;
  maxFeatures: number;
  seed: number;
}

export interface TreeOut {
  left: number[];
  right: number[];
  feature: number[];
  threshold: number[];
  impurity: number[];
  nNode: number[];
  wNode: number[];
  value: number[];
  maxC: number;
}

export function buildTree(X: Float32Array, n: number, d: number, y: Float64Array, nOut: number, nClasses: number[], w: Float64Array | null, cfg: TreeCfg): TreeOut {
  const clf = cfg.criterion === 'gini' || cfg.criterion === 'entropy' || cfg.criterion === 'log_loss';
  const entropy = cfg.criterion === 'entropy' || cfg.criterion === 'log_loss';
  const friedman = cfg.criterion === 'friedman_mse';
  const maxC = clf ? Math.max(...nClasses) : 1;
  const stride = nOut * maxC;

  const samples: number[] = [];
  let weightedNSamples = 0;
  for (let i = 0; i < n; i++) {
    if (w === null || w[i] !== 0) {
      samples.push(i);
      weightedNSamples += w === null ? 1 : w[i];
    }
  }
  const features = Int32Array.from({ length: d }, (_, i) => i);
  const constantFeatures = new Int32Array(d);
  const featureValues = new Float64Array(samples.length);
  const rng: Rng = { s: cfg.seed >>> 0 };
  if (rng.s === 0) rng.s = 1;

  // ── estado del criterio
  const sumTotal = new Float64Array(clf ? nOut * maxC : nOut);
  const sumLeft = new Float64Array(sumTotal.length);
  const sumRight = new Float64Array(sumTotal.length);
  let sqSumTotal = 0;
  let wNodeSamples = 0;
  let wLeft = 0;
  let wRight = 0;
  let cStart = 0;
  let cEnd = 0;
  let cPos = 0;

  const wi = (i: number): number => (w === null ? 1 : w[i]);

  function critInit(start: number, end: number): void {
    cStart = start;
    cEnd = end;
    wNodeSamples = 0;
    sumTotal.fill(0);
    sqSumTotal = 0;
    for (let p = start; p < end; p++) {
      const i = samples[p];
      const ww = wi(i);
      for (let k = 0; k < nOut; k++) {
        if (clf) sumTotal[k * maxC + y[i * nOut + k]] += ww;
        else {
          const yv = y[i * nOut + k];
          sumTotal[k] += ww * yv;
          sqSumTotal += ww * yv * yv;
        }
      }
      wNodeSamples += ww;
    }
    critReset();
  }

  function critReset(): void {
    cPos = cStart;
    sumLeft.fill(0);
    for (let q = 0; q < sumTotal.length; q++) sumRight[q] = sumTotal[q];
    wLeft = 0;
    wRight = wNodeSamples;
  }

  function critUpdate(newPos: number): void {
    for (let p = cPos; p < newPos; p++) {
      const i = samples[p];
      const ww = wi(i);
      for (let k = 0; k < nOut; k++) {
        if (clf) sumLeft[k * maxC + y[i * nOut + k]] += ww;
        else sumLeft[k] += ww * y[i * nOut + k];
      }
      wLeft += ww;
    }
    wRight = wNodeSamples - wLeft;
    for (let q = 0; q < sumTotal.length; q++) sumRight[q] = sumTotal[q] - sumLeft[q];
    cPos = newPos;
  }

  function nodeImpurity(): number {
    if (clf) {
      let acc = 0;
      for (let k = 0; k < nOut; k++) {
        if (entropy) {
          for (let c = 0; c < nClasses[k]; c++) {
            let cnt = sumTotal[k * maxC + c];
            if (cnt > 0) {
              cnt /= wNodeSamples;
              acc -= cnt * Math.log(cnt);
            }
          }
        } else {
          let sq = 0;
          for (let c = 0; c < nClasses[k]; c++) {
            const cnt = sumTotal[k * maxC + c];
            sq += cnt * cnt;
          }
          acc += 1.0 - sq / (wNodeSamples * wNodeSamples);
        }
      }
      return acc / nOut;
    }
    let imp = sqSumTotal / wNodeSamples;
    for (let k = 0; k < nOut; k++) imp -= Math.pow(sumTotal[k] / wNodeSamples, 2.0);
    return imp / nOut;
  }

  function childrenImpurity(): [number, number] {
    if (clf) {
      let l = 0;
      let r = 0;
      for (let k = 0; k < nOut; k++) {
        if (entropy) {
          for (let c = 0; c < nClasses[k]; c++) {
            let cl = sumLeft[k * maxC + c];
            if (cl > 0) {
              cl /= wLeft;
              l -= cl * Math.log(cl);
            }
            let cr = sumRight[k * maxC + c];
            if (cr > 0) {
              cr /= wRight;
              r -= cr * Math.log(cr);
            }
          }
        } else {
          let sl = 0;
          let sr = 0;
          for (let c = 0; c < nClasses[k]; c++) {
            const cl = sumLeft[k * maxC + c];
            const cr = sumRight[k * maxC + c];
            sl += cl * cl;
            sr += cr * cr;
          }
          l += 1.0 - sl / (wLeft * wLeft);
          r += 1.0 - sr / (wRight * wRight);
        }
      }
      return [l / nOut, r / nOut];
    }
    let sqLeft = 0;
    for (let p = cStart; p < cPos; p++) {
      const i = samples[p];
      const ww = wi(i);
      for (let k = 0; k < nOut; k++) {
        const yv = y[i * nOut + k];
        sqLeft += ww * yv * yv;
      }
    }
    const sqRight = sqSumTotal - sqLeft;
    let il = sqLeft / wLeft;
    let ir = sqRight / wRight;
    for (let k = 0; k < nOut; k++) {
      il -= Math.pow(sumLeft[k] / wLeft, 2.0);
      ir -= Math.pow(sumRight[k] / wRight, 2.0);
    }
    return [il / nOut, ir / nOut];
  }

  function proxyImprovement(): number {
    if (clf) {
      const [il, ir] = childrenImpurity();
      return -wRight * ir - wLeft * il;
    }
    if (friedman) {
      let tl = 0;
      let tr = 0;
      for (let k = 0; k < nOut; k++) {
        tl += sumLeft[k];
        tr += sumRight[k];
      }
      const diff = (wRight * tl - wLeft * tr) / nOut;
      return (diff * diff) / (wLeft * wRight);
    }
    let pl = 0;
    let pr = 0;
    for (let k = 0; k < nOut; k++) {
      pl += sumLeft[k] * sumLeft[k];
      pr += sumRight[k] * sumRight[k];
    }
    return pl / wLeft + pr / wRight;
  }

  function impurityImprovement(parent: number, il: number, ir: number): number {
    if (friedman) {
      let tl = 0;
      let tr = 0;
      for (let k = 0; k < nOut; k++) {
        tl += sumLeft[k];
        tr += sumRight[k];
      }
      const diff = (wRight * tl - wLeft * tr) / nOut;
      return (diff * diff) / (wLeft * wRight * wNodeSamples);
    }
    return (wNodeSamples / weightedNSamples) * (parent - (wRight / wNodeSamples) * ir - (wLeft / wNodeSamples) * il);
  }

  function nodeValue(dest: number[]): void {
    if (clf) {
      for (let k = 0; k < nOut; k++) for (let c = 0; c < maxC; c++) dest.push(c < nClasses[k] ? sumTotal[k * maxC + c] / wNodeSamples : 0);
    } else for (let k = 0; k < nOut; k++) dest.push(sumTotal[k] / wNodeSamples);
  }

  // ── divisor
  interface Split {
    feature: number;
    pos: number;
    threshold: number;
    improvement: number;
    impurityLeft: number;
    impurityRight: number;
  }

  const sortBuf: number[] = [];

  function sortSamples(start: number, end: number, f: number): void {
    sortBuf.length = 0;
    for (let p = start; p < end; p++) sortBuf.push(samples[p]);
    sortBuf.sort((a, b) => X[a * d + f] - X[b * d + f]);
    for (let p = start; p < end; p++) {
      const i = sortBuf[p - start];
      samples[p] = i;
      featureValues[p] = X[i * d + f];
    }
  }

  let nConstFeaturesParent = 0;

  function nodeSplitBest(start: number, end: number, impurity: number): Split {
    let best: Split = { feature: 0, pos: end, threshold: 0, improvement: -Infinity, impurityLeft: 0, impurityRight: 0 };
    let bestProxy = -Infinity;
    let fI = d;
    let nVisited = 0;
    let nFound = 0;
    let nDrawn = 0;
    const nKnown = nConstFeaturesParent;
    let nTotalConst = nKnown;
    while (fI > nTotalConst && (nVisited < cfg.maxFeatures || nVisited <= nFound + nDrawn)) {
      nVisited++;
      let fJ = randInt(nDrawn, fI - nFound, rng);
      if (fJ < nKnown) {
        const t = features[nDrawn];
        features[nDrawn] = features[fJ];
        features[fJ] = t;
        nDrawn++;
        continue;
      }
      fJ += nFound;
      const feat = features[fJ];
      sortSamples(start, end, feat);
      if (featureValues[end - 1] <= featureValues[start] + FEATURE_THRESHOLD) {
        const t = features[fJ];
        features[fJ] = features[nTotalConst];
        features[nTotalConst] = t;
        nFound++;
        nTotalConst++;
        continue;
      }
      fI--;
      const t2 = features[fI];
      features[fI] = features[fJ];
      features[fJ] = t2;
      critReset();
      let p = start;
      while (p < end) {
        // next_p: avanza hasta el siguiente valor distinto
        while (p + 1 < end && featureValues[p + 1] <= featureValues[p] + FEATURE_THRESHOLD) p++;
        const pPrev = p;
        p++;
        if (p === end) continue;
        const nLeft = p - start;
        const nRight = end - p;
        if (nLeft < cfg.minSamplesLeaf || nRight < cfg.minSamplesLeaf) continue;
        critUpdate(p);
        if (wLeft < cfg.minWeightLeaf || wRight < cfg.minWeightLeaf) continue;
        const cur = proxyImprovement();
        if (cur > bestProxy) {
          bestProxy = cur;
          best = { feature: feat, pos: p, threshold: featureValues[pPrev] / 2.0 + featureValues[p] / 2.0, improvement: 0, impurityLeft: 0, impurityRight: 0 };
        }
      }
    }
    if (best.pos < end) {
      // partición final de las muestras según la mejor división
      let p = start;
      let pe = end;
      while (p < pe) {
        if (X[samples[p] * d + best.feature] <= best.threshold) p++;
        else {
          pe--;
          const t = samples[p];
          samples[p] = samples[pe];
          samples[pe] = t;
        }
      }
      critReset();
      critUpdate(best.pos);
      const [il, ir] = childrenImpurity();
      best.impurityLeft = il;
      best.impurityRight = ir;
      best.improvement = impurityImprovement(impurity, il, ir);
    }
    for (let q = 0; q < nKnown; q++) features[q] = constantFeatures[q];
    for (let q = 0; q < nFound; q++) constantFeatures[nKnown + q] = features[nKnown + q];
    nConstFeaturesParent = nTotalConst;
    return best;
  }

  // ── constructor en profundidad
  const out: TreeOut = { left: [], right: [], feature: [], threshold: [], impurity: [], nNode: [], wNode: [], value: [], maxC };
  interface Rec {
    start: number;
    end: number;
    depth: number;
    parent: number;
    isLeft: boolean;
    impurity: number;
    nConst: number;
  }
  const stack: Rec[] = [{ start: 0, end: samples.length, depth: 0, parent: -1, isLeft: false, impurity: Infinity, nConst: 0 }];
  let first = true;
  while (stack.length) {
    const rec = stack.pop() as Rec;
    const { start, end, depth, parent, isLeft } = rec;
    let impurity = rec.impurity;
    nConstFeaturesParent = rec.nConst;
    const nNode = end - start;
    critInit(start, end);
    let isLeaf = depth >= cfg.maxDepth || nNode < cfg.minSamplesSplit || nNode < 2 * cfg.minSamplesLeaf || wNodeSamples < 2 * cfg.minWeightLeaf;
    if (first) {
      impurity = nodeImpurity();
      first = false;
    }
    isLeaf = isLeaf || impurity <= EPSILON;
    let split: Split = { feature: -2, pos: end, threshold: -2, improvement: 0, impurityLeft: 0, impurityRight: 0 };
    if (!isLeaf) {
      split = nodeSplitBest(start, end, impurity);
      isLeaf = split.pos >= end || split.improvement + EPSILON < cfg.minImpurityDecrease;
      // el divisor recorre el nodo: se vuelve a dejar el criterio en este nodo para guardar su valor
      critInit(start, end);
    }
    const id = out.left.length;
    out.left.push(-1);
    out.right.push(-1);
    out.feature.push(isLeaf ? -2 : split.feature);
    out.threshold.push(isLeaf ? -2 : split.threshold);
    out.impurity.push(impurity);
    out.nNode.push(nNode);
    out.wNode.push(wNodeSamples);
    nodeValue(out.value);
    if (parent >= 0) {
      if (isLeft) out.left[parent] = id;
      else out.right[parent] = id;
    }
    if (!isLeaf) {
      const nc = nConstFeaturesParent;
      stack.push({ start: split.pos, end, depth: depth + 1, parent: id, isLeft: false, impurity: split.impurityRight, nConst: nc });
      stack.push({ start, end: split.pos, depth: depth + 1, parent: id, isLeft: true, impurity: split.impurityLeft, nConst: nc });
    }
  }
  void stride;
  return out;
}


/**
 * Puerto de `Solver::Solve` de libsvm (SMO con selección de conjunto de trabajo de segundo orden y «shrinking»).
 * `Q` son los valores `y_i y_j K(i, j)` que libsvm guarda en `float` de 32 bits; `QD` es la diagonal en doble precisión.
 * Los vectores se indexan por posición original y `act` lleva la permutación del conjunto activo (como `active_set`).
 */
export function smoSolve(l: number, Q: Float64Array, QD: Float64Array, p: Float64Array, y: Int8Array, alpha0: Float64Array, C: Float64Array, eps: number, maxIter: number, shrinking = true): { alpha: Float64Array; rho: number; iter: number; obj: number; timedOut: boolean } {
  const TAU = 1e-12;
  const alpha = Float64Array.from(alpha0);
  const Qf = new Float32Array(Q.length);
  for (let k = 0; k < Q.length; k++) Qf[k] = Q[k];
  const act = new Int32Array(l);
  for (let k = 0; k < l; k++) act[k] = k;
  let activeSize = l;
  let unshrink = false;
  const G = Float64Array.from(p);
  const Gbar = new Float64Array(l);
  const upper = (i: number): boolean => alpha[i] >= C[i];
  const lower = (i: number): boolean => alpha[i] <= 0;
  const free = (i: number): boolean => !upper(i) && !lower(i);
  for (let i = 0; i < l; i++) {
    if (!lower(i)) {
      const a = alpha[i];
      for (let j = 0; j < l; j++) G[j] += a * Qf[i * l + j];
      if (upper(i)) for (let j = 0; j < l; j++) Gbar[j] += C[i] * Qf[i * l + j];
    }
  }
  const reconstruct = (): void => {
    if (activeSize === l) return;
    for (let j = activeSize; j < l; j++) {
      const jj = act[j];
      G[jj] = Gbar[jj] + p[jj];
    }
    let nrFree = 0;
    for (let j = 0; j < activeSize; j++) if (free(act[j])) nrFree++;
    if (nrFree * l > 2 * activeSize * (l - activeSize)) {
      for (let i = activeSize; i < l; i++) {
        const ii = act[i];
        for (let j = 0; j < activeSize; j++) {
          const jj = act[j];
          if (free(jj)) G[ii] += alpha[jj] * Qf[ii * l + jj];
        }
      }
    } else {
      for (let i = 0; i < activeSize; i++) {
        const ii = act[i];
        if (free(ii)) {
          const ai = alpha[ii];
          for (let j = activeSize; j < l; j++) {
            const jj = act[j];
            G[jj] += ai * Qf[ii * l + jj];
          }
        }
      }
    }
  };
  const beShrunk = (i: number, Gmax1: number, Gmax2: number): boolean => {
    if (upper(i)) return y[i] === 1 ? -G[i] > Gmax1 : -G[i] > Gmax2;
    if (lower(i)) return y[i] === 1 ? G[i] > Gmax2 : G[i] > Gmax1;
    return false;
  };
  const doShrinking = (): void => {
    let Gmax1 = -Infinity;
    let Gmax2 = -Infinity;
    for (let t = 0; t < activeSize; t++) {
      const i = act[t];
      if (y[i] === 1) {
        if (!upper(i) && -G[i] >= Gmax1) Gmax1 = -G[i];
        if (!lower(i) && G[i] >= Gmax2) Gmax2 = G[i];
      } else {
        if (!upper(i) && -G[i] >= Gmax2) Gmax2 = -G[i];
        if (!lower(i) && G[i] >= Gmax1) Gmax1 = G[i];
      }
    }
    if (!unshrink && Gmax1 + Gmax2 <= eps * 10) {
      unshrink = true;
      reconstruct();
      activeSize = l;
    }
    for (let t = 0; t < activeSize; t++) {
      if (beShrunk(act[t], Gmax1, Gmax2)) {
        activeSize--;
        while (activeSize > t) {
          if (!beShrunk(act[activeSize], Gmax1, Gmax2)) {
            const tmp = act[t];
            act[t] = act[activeSize];
            act[activeSize] = tmp;
            break;
          }
          activeSize--;
        }
      }
    }
  };
  let selI = -1;
  let selJ = -1;
  const select = (): boolean => {
    let Gmax = -Infinity;
    let Gmax2 = -Infinity;
    let gi = -1;
    let gj = -1;
    let objMin = Infinity;
    for (let t = 0; t < activeSize; t++) {
      const k = act[t];
      if (y[k] === 1) {
        if (!upper(k) && -G[k] >= Gmax) {
          Gmax = -G[k];
          gi = k;
        }
      } else if (!lower(k) && G[k] >= Gmax) {
        Gmax = G[k];
        gi = k;
      }
    }
    if (gi !== -1) {
      for (let t = 0; t < activeSize; t++) {
        const j = act[t];
        if (y[j] === 1) {
          if (!lower(j)) {
            const gd = Gmax + G[j];
            if (G[j] >= Gmax2) Gmax2 = G[j];
            if (gd > 0) {
              const qc = QD[gi] + QD[j] - 2.0 * y[gi] * Qf[gi * l + j];
              const od = qc > 0 ? -(gd * gd) / qc : -(gd * gd) / TAU;
              if (od <= objMin) {
                gj = j;
                objMin = od;
              }
            }
          }
        } else if (!upper(j)) {
          const gd = Gmax - G[j];
          if (-G[j] >= Gmax2) Gmax2 = -G[j];
          if (gd > 0) {
            const qc = QD[gi] + QD[j] + 2.0 * y[gi] * Qf[gi * l + j];
            const od = qc > 0 ? -(gd * gd) / qc : -(gd * gd) / TAU;
            if (od <= objMin) {
              gj = j;
              objMin = od;
            }
          }
        }
      }
    }
    if (Gmax + Gmax2 < eps || gj === -1) return false;
    selI = gi;
    selJ = gj;
    return true;
  };
  let iter = 0;
  let counter = Math.min(l, 1000) + 1;
  let timedOut = false;
  for (;;) {
    if (maxIter !== -1 && iter >= maxIter) {
      timedOut = true;
      break;
    }
    if (--counter === 0) {
      counter = Math.min(l, 1000);
      if (shrinking) doShrinking();
    }
    if (!select()) {
      reconstruct();
      activeSize = l;
      if (!select()) break;
      counter = 1;
    }
    const i = selI;
    const j = selJ;
    iter++;
    const Ci = C[i];
    const Cj = C[j];
    const oldI = alpha[i];
    const oldJ = alpha[j];
    if (y[i] !== y[j]) {
      let qc = QD[i] + QD[j] + 2 * Qf[i * l + j];
      if (qc <= 0) qc = TAU;
      const delta = (-G[i] - G[j]) / qc;
      const diff = alpha[i] - alpha[j];
      alpha[i] += delta;
      alpha[j] += delta;
      if (diff > 0) {
        if (alpha[j] < 0) {
          alpha[j] = 0;
          alpha[i] = diff;
        }
      } else if (alpha[i] < 0) {
        alpha[i] = 0;
        alpha[j] = -diff;
      }
      if (diff > Ci - Cj) {
        if (alpha[i] > Ci) {
          alpha[i] = Ci;
          alpha[j] = Ci - diff;
        }
      } else if (alpha[j] > Cj) {
        alpha[j] = Cj;
        alpha[i] = Cj + diff;
      }
    } else {
      let qc = QD[i] + QD[j] - 2 * Qf[i * l + j];
      if (qc <= 0) qc = TAU;
      const delta = (G[i] - G[j]) / qc;
      const sum = alpha[i] + alpha[j];
      alpha[i] -= delta;
      alpha[j] += delta;
      if (sum > Ci) {
        if (alpha[i] > Ci) {
          alpha[i] = Ci;
          alpha[j] = sum - Ci;
        }
      } else if (alpha[j] < 0) {
        alpha[j] = 0;
        alpha[i] = sum;
      }
      if (sum > Cj) {
        if (alpha[j] > Cj) {
          alpha[j] = Cj;
          alpha[i] = sum - Cj;
        }
      } else if (alpha[i] < 0) {
        alpha[i] = 0;
        alpha[j] = sum;
      }
    }
    const dI = alpha[i] - oldI;
    const dJ = alpha[j] - oldJ;
    for (let t = 0; t < activeSize; t++) {
      const k = act[t];
      G[k] += Qf[i * l + k] * dI + Qf[j * l + k] * dJ;
    }
    const ui = oldI >= Ci;
    const uj = oldJ >= Cj;
    if (ui !== upper(i)) {
      if (ui) for (let k = 0; k < l; k++) Gbar[k] -= Ci * Qf[i * l + k];
      else for (let k = 0; k < l; k++) Gbar[k] += Ci * Qf[i * l + k];
    }
    if (uj !== upper(j)) {
      if (uj) for (let k = 0; k < l; k++) Gbar[k] -= Cj * Qf[j * l + k];
      else for (let k = 0; k < l; k++) Gbar[k] += Cj * Qf[j * l + k];
    }
  }
  let nrFree = 0;
  let ub = Infinity;
  let lb = -Infinity;
  let sumFree = 0;
  for (let t = 0; t < activeSize; t++) {
    const i = act[t];
    const yG = y[i] * G[i];
    if (upper(i)) {
      if (y[i] === -1) ub = Math.min(ub, yG);
      else lb = Math.max(lb, yG);
    } else if (lower(i)) {
      if (y[i] === 1) ub = Math.min(ub, yG);
      else lb = Math.max(lb, yG);
    } else {
      nrFree++;
      sumFree += yG;
    }
  }
  const rho = nrFree > 0 ? sumFree / nrFree : (ub + lb) / 2;
  let v = 0;
  for (let i = 0; i < l; i++) v += alpha[i] * (G[i] + p[i]);
  return { alpha, rho, iter, obj: v / 2, timedOut };
}

const i64 = (a: number[]): NdArray => mkNum(Float64Array.from(a), [a.length], 'int64');
const f64 = (a: number[]): NdArray => mkNum(Float64Array.from(a), [a.length], 'float64');

registerNative('_mlkern', (_I, m) => {
  mfn(m, 'tree_build', 'X, y, sample_weight, n_classes, criterion, max_depth, min_samples_split, min_samples_leaf, min_weight_leaf, min_impurity_decrease, max_features, seed', (X: any, y: any, sw: any, ncl: any, crit: any, md: any, mss: any, msl: any, mwl: any, mid: any, mf: any, seed: any) => {
    const A = arr(X);
    const Y = arr(y);
    const n = A.shape[0];
    const d = A.shape[1];
    const nOut = Y.ndim === 1 ? 1 : Y.shape[1];
    const xs = Float32Array.from(flatNum(A));
    const ys = flatNum(Y);
    const w = isNone(sw) ? null : Float64Array.from(flatNum(arr(sw)));
    const classes = (ncl as PyList | PyTuple).a.map((v: any) => intArg(v));
    const res = buildTree(xs, n, d, ys, nOut, classes, w, {
      criterion: String(crit),
      maxDepth: isNone(md) ? Infinity : intArg(md),
      minSamplesSplit: intArg(mss),
      minSamplesLeaf: intArg(msl),
      minWeightLeaf: numArg(mwl),
      minImpurityDecrease: numArg(mid),
      maxFeatures: intArg(mf),
      seed: intArg(seed),
    });
    const nn = res.left.length;
    const value = mkNum(Float64Array.from(res.value), [nn, nOut, res.maxC], 'float64');
    return new PyTuple([i64(res.left), i64(res.right), i64(res.feature), f64(res.threshold), f64(res.impurity), i64(res.nNode), f64(res.wNode), value]);
  });


  mfn(m, 'svm_solve', 'Q, QD, p, y, alpha, C, eps, max_iter', (Q: any, QD: any, p: any, y: any, alpha: any, C: any, eps: any, maxIter: any) => {
    const qa = arr(Q);
    const l = qa.shape[0];
    const r = smoSolve(l, flatNum(qa) as Float64Array, Float64Array.from(flatNum(arr(QD))), Float64Array.from(flatNum(arr(p))), Int8Array.from(flatNum(arr(y))), Float64Array.from(flatNum(arr(alpha))), Float64Array.from(flatNum(arr(C))), numArg(eps), intArg(maxIter));
    return new PyTuple([f64(Array.from(r.alpha)), new PyFloat(r.rho), r.iter, new PyFloat(r.obj), r.timedOut]);
  });

  mfn(m, 'tree_apply', 'X, left, right, feature, threshold', (X: any, l: any, r: any, f: any, t: any) => {
    const A = arr(X);
    const n = A.shape[0];
    const d = A.shape[1];
    const xs = flatNum(A);
    const L = flatNum(arr(l));
    const R = flatNum(arr(r));
    const F = flatNum(arr(f));
    const T = flatNum(arr(t));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let node = 0;
      while (L[node] !== -1) node = Math.fround(xs[i * d + F[node]]) <= T[node] ? L[node] : R[node];
      out[i] = node;
    }
    return mkNum(out, [n], 'int64');
  });
});
