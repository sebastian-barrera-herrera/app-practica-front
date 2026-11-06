/**
 * `numpy.random`: funciones globales (generador MT19937 como la API antigua), `RandomState` y `Generator`/`default_rng`.
 */
import { PyFloat, PyList, PyModule, PyObject, PyTuple, PyType } from '../../runtime/objects';
import { newNativeType, objectType } from '../../runtime/builtin_types';
import { E } from '../../runtime/exc_types';
import { makeExc, valueError } from '../../runtime/errors';
import * as ops from '../../runtime/ops';
import { mkNative } from '../../runtime/native';
import { mfn } from '../helpers';
import { axisArg, bool, intArg, isNone, numArg, shapeArg } from './args';
import * as nd from './nd';
import { NdArray, flatNum, mkNum, scalarToPy, sizeOf, type DType } from './nd';
import { MT19937, PCG64 } from './rng';

interface Ctx {
  arr: (x: any) => NdArray;
  ret: (r: NdArray) => any;
  fromPy: (x: any, dt?: DType) => NdArray;
}

interface Sampler {
  double(): number;
  gauss(): number;
  /** entero en [lo, hi) */
  randint(lo: number, hi: number): number;
  interval(max: number): number;
}

class RS extends PyObject {
  mt = new MT19937(12345);
  s: Sampler;
  constructor(cls: PyType) {
    super(cls);
    this.s = {
      double: () => this.mt.double(),
      gauss: () => this.mt.legacyGauss(),
      randint: (lo, hi) => this.mt.randint(lo, hi),
      interval: (max) => this.mt.interval(max),
    };
  }
}

class GenObj extends PyObject {
  pcg: PCG64;
  s: Sampler;
  constructor(cls: PyType, seed: bigint) {
    super(cls);
    this.pcg = new PCG64(seed);
    this.s = {
      double: () => this.pcg.double(),
      gauss: () => this.pcg.stdNormal(),
      randint: (lo, hi) => this.pcg.integers(lo, hi),
      interval: (max) => this.pcg.interval(max),
    };
  }
}

let rsType: PyType | null = null;
let genType: PyType | null = null;
let globalRS: RS | null = null;

const sizeArg = (v: any): number[] | null => (isNone(v) ? null : shapeArg(v));

function fill(size: number[] | null, f: () => number, dtype: DType = 'float64'): any {
  if (size === null) return scalarToPy(dtype, f());
  const n = sizeOf(size);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = f();
  return mkNum(out, size, dtype);
}


/**
 * Como `fill`, pero los parámetros de la distribución pueden ser escalares o array-like (se difunden entre sí y con `size`),
 * igual que en NumPy: `rng.normal([0, 3], 0.5, size=(100, 2))`.
 */
function fillN(ctx: Ctx, size: number[] | null, params: any[], defs: number[], f: (v: number[]) => number, dtype: DType = 'float64'): any {
  const isArr = (p: any) => p instanceof NdArray || p instanceof PyList || p instanceof PyTuple;
  const scal: (number | null)[] = [];
  const arrs: (NdArray | null)[] = [];
  let shape: number[] = size ?? [];
  params.forEach((p, i) => {
    if (isNone(p)) {
      scal.push(defs[i]);
      arrs.push(null);
    } else if (isArr(p)) {
      const A = ctx.arr(p);
      if (A.ndim === 0) {
        scal.push(flatNum(A)[0]);
        arrs.push(null);
      } else {
        scal.push(null);
        arrs.push(A);
        shape = nd.broadcastShapes(shape, A.shape);
      }
    } else {
      scal.push(numArg(p));
      arrs.push(null);
    }
  });
  if (!arrs.some((a) => a !== null)) return fill(size, () => f(scal as number[]), dtype);
  if (size !== null && (shape.length !== size.length || shape.some((d, i) => d !== size[i]))) throw valueError(`shape mismatch: objects cannot be broadcast to a single shape.  Mismatch is between arg 0 with shape (${shape.join(', ')}) and arg 1 with shape (${size.join(', ')}).`);
  const flat = arrs.map((a) => (a ? flatNum(nd.broadcastTo(a, shape)) : null));
  const n = sizeOf(shape);
  const out = new Float64Array(n);
  const vals = new Array<number>(params.length);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < vals.length; k++) vals[k] = flat[k] ? flat[k]![i] : (scal[k] as number);
    out[i] = f(vals);
  }
  return mkNum(out, shape, dtype);
}

function seedOf(v: any): bigint {
  if (isNone(v)) return 0x5eedn;
  const n = ops.intValue(v);
  if (n === undefined) throw makeExc(E.TypeError, ['SeedSequence expects int or sequence of ints for entropy not ' + ops.repr(v)]);
  const b = BigInt(n);
  if (b < 0n) throw valueError('expected non-negative integer');
  return b;
}

/** baraja una lista de Python o un array a lo largo del primer eje con Fisher–Yates como NumPy */
function shuffleInPlace(x: any, s: Sampler): void {
  if (x instanceof PyList) {
    for (let i = x.a.length - 1; i >= 1; i--) {
      const j = s.interval(i);
      [x.a[i], x.a[j]] = [x.a[j], x.a[i]];
    }
    return;
  }
  if (x instanceof NdArray) {
    const n = x.ndim === 0 ? 0 : x.shape[0];
    if (x.ndim === 0) throw makeExc(E.TypeError, ['shuffle() argument must be a sequence']);
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i >= 1; i--) {
      const j = s.interval(i);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const shuffled = nd.getItem(x, mkNum(Float64Array.from(perm), [n], 'int64'));
    nd.setItem(x, new PyTuple([ops.makeSlice(null, null, null)]), shuffled);
    return;
  }
  throw makeExc(E.TypeError, ['shuffle() argument must be a mutable sequence']);
}

function choice(ctx: Ctx, s: Sampler, a: any, size: any, replace: boolean, p: any, legacy: boolean): any {
  const A = ctx.arr(a);
  const shape = sizeArg(size);
  const pop = A.ndim === 0 ? intArg(itemOfScalar(A)) : A.shape[0];
  if (A.ndim === 0 && pop <= 0) throw valueError('a must be a positive integer unless no samples are taken');
  const count = shape === null ? 1 : sizeOf(shape);
  let idx: number[];
  let probs: Float64Array | null = null;
  if (!isNone(p)) {
    probs = Float64Array.from(flatNum(ctx.arr(p)));
    if (probs.length !== pop) throw valueError('a and p must have same size');
    const tot = probs.reduce((acc, v) => acc + v, 0);
    if (Math.abs(tot - 1) > 1e-8) throw valueError('probabilities do not sum to 1');
  }
  const cdfOf = (pr: Float64Array): Float64Array => {
    const c = new Float64Array(pr.length);
    let acc = 0;
    for (let i = 0; i < pr.length; i++) {
      acc += pr[i];
      c[i] = acc;
    }
    for (let i = 0; i < c.length; i++) c[i] /= c[c.length - 1];
    return c;
  };
  const search = (c: Float64Array, u: number): number => {
    let lo = 0;
    let hi = c.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  if (replace) {
    if (probs) {
      const c = cdfOf(probs);
      idx = Array.from({ length: count }, () => search(c, s.double()));
    } else idx = Array.from({ length: count }, () => s.randint(0, pop));
  } else {
    if (count > pop) throw valueError("Cannot take a larger sample than population when 'replace=False'");
    if (probs) {
      if (probs.filter((v) => v > 0).length < count) throw valueError('Fewer non-zero entries in p than size');
      const found: number[] = [];
      const pr = Float64Array.from(probs);
      while (found.length < count) {
        const need = count - found.length;
        for (const f of found) pr[f] = 0;
        const c = cdfOf(pr);
        const xs = Array.from({ length: need }, () => s.double());
        const news = xs.map((u) => search(c, u));
        const seen = new Set<number>();
        const uniq: number[] = [];
        for (const v of news) if (!seen.has(v)) {
          seen.add(v);
          uniq.push(v);
        }
        found.push(...uniq);
      }
      idx = found;
    } else {
      const perm = Array.from({ length: pop }, (_, i) => i);
      if (legacy) {
        for (let i = pop - 1; i >= 1; i--) {
          const j = s.interval(i);
          [perm[i], perm[j]] = [perm[j], perm[i]];
        }
        idx = perm.slice(0, count);
      } else {
        if (pop > 10000 && count > Math.floor(pop / 50)) {
          // barajado de la cola
          for (let i = pop - 1; i >= pop - count && i >= 1; i--) {
            const j = s.interval(i);
            [perm[i], perm[j]] = [perm[j], perm[i]];
          }
          idx = perm.slice(pop - count);
        } else {
          // algoritmo de Floyd y barajado final del resultado (como Generator.choice)
          const chosen = new Set<number>();
          idx = new Array<number>(count);
          for (let j = pop - count; j < pop; j++) {
            const val = s.randint(0, j + 1);
            const k = j - (pop - count);
            if (!chosen.has(val)) {
              chosen.add(val);
              idx[k] = val;
            } else {
              chosen.add(j);
              idx[k] = j;
            }
          }
          for (let i = count - 1; i >= 1; i--) {
            const j = s.randint(0, i + 1);
            [idx[i], idx[j]] = [idx[j], idx[i]];
          }
        }
      }
    }
  }
  const ia = mkNum(Float64Array.from(idx), shape === null ? [] : shape, 'int64');
  if (A.ndim === 0) return ctx.ret(ia);
  if (shape === null) return nd.getItem(A, idx[0]);
  return nd.getItem(A, ia);
}

const itemOfScalar = (a: NdArray): any => nd.itemOf(a);

function permutation(ctx: Ctx, s: Sampler, x: any): any {
  if (x instanceof NdArray || x instanceof PyList || x instanceof PyTuple) {
    const A = nd.copyOf(ctx.arr(x));
    shuffleInPlace(A, s);
    return A;
  }
  const n = intArg(x);
  const a = mkNum(Float64Array.from({ length: n }, (_, i) => i), [n], 'int64');
  shuffleInPlace(a, s);
  return a;
}

function cholLower(cov: NdArray): Float64Array {
  const n = cov.shape[0];
  const c = flatNum(cov);
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let sum = c[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      if (i === j) l[i * n + i] = Math.sqrt(Math.max(sum, 0));
      else l[i * n + j] = l[j * n + j] === 0 ? 0 : sum / l[j * n + j];
    }
  return l;
}

/** métodos comunes a RandomState y Generator, vinculados a un `Sampler` */
function distributions(ctx: Ctx, get: (self: any) => Sampler, legacy: boolean): Record<string, [string, (...a: any[]) => any]> {
  const g = get;
  const r: Record<string, [string, (...a: any[]) => any]> = {};
  r.uniform = ['self, low=, high=, size=', (self: any, lo: any, hi: any, size: any) =>
    fillN(ctx, sizeArg(size), [lo, hi], [0, 1], ([l, h]) => l + (h - l) * g(self).double())];
  r.normal = ['self, loc=, scale=, size=', (self: any, loc: any, scale: any, size: any) =>
    fillN(ctx, sizeArg(size), [loc, scale], [0, 1], ([mu, sd]) => mu + sd * g(self).gauss())];
  r.standard_normal = ['self, size=', (self: any, size: any) => fill(sizeArg(size), () => g(self).gauss())];
  r.exponential = ['self, scale=, size=', (self: any, scale: any, size: any) =>
    fillN(ctx, sizeArg(size), [scale], [1], ([sc]) => -sc * Math.log(1 - g(self).double()))];
  r.lognormal = ['self, mean=, sigma=, size=', (self: any, mean: any, sigma: any, size: any) =>
    fillN(ctx, sizeArg(size), [mean, sigma], [0, 1], ([mu, sd]) => Math.exp(mu + sd * g(self).gauss()))];
  r.laplace = ['self, loc=, scale=, size=', (self: any, loc: any, scale: any, size: any) =>
    fillN(ctx, sizeArg(size), [loc, scale], [0, 1], ([mu, sc]) => {
      const u = g(self).double() - 0.5;
      return mu - sc * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    })];
  r.binomial = ['self, n, p, size=', (self: any, n: any, p: any, size: any) =>
    fillN(ctx, sizeArg(size), [n, p], [0, 0], ([nn, pp]) => {
      let k = 0;
      for (let i = 0; i < nn; i++) if (g(self).double() < pp) k++;
      return k;
    }, 'int64')];
  r.poisson = ['self, lam=, size=', (self: any, lam: any, size: any) =>
    fillN(ctx, sizeArg(size), [lam], [1], ([l]) => {
      const L = Math.exp(-l);
      let k = 0;
      let pr = 1;
      do {
        k++;
        pr *= g(self).double();
      } while (pr > L);
      return k - 1;
    }, 'int64')];
  r.geometric = ['self, p, size=', (self: any, p: any, size: any) =>
    fillN(ctx, sizeArg(size), [p], [0.5], ([pp]) => Math.ceil(Math.log(1 - g(self).double()) / Math.log(1 - pp)), 'int64')];
  r.choice = ['self, a, size=, replace=, p=', (self: any, a: any, size: any, replace: any, p: any) => choice(ctx, g(self), a, size, bool(replace, true), p, legacy)];
  r.permutation = ['self, x', (self: any, x: any) => permutation(ctx, g(self), x)];
  r.shuffle = ['self, x', (self: any, x: any) => {
    shuffleInPlace(x, g(self));
    return null;
  }];
  r.multivariate_normal = ['self, mean, cov, size=, check_valid=, tol=, method=', (self: any, mean: any, cov: any, size: any) => {
    const mu = flatNum(ctx.arr(mean));
    const n = mu.length;
    const l = cholLower(ctx.arr(cov));
    const sh = sizeArg(size);
    const count = sh === null ? 1 : sizeOf(sh);
    const out = new Float64Array(count * n);
    for (let k = 0; k < count; k++) {
      const z = Array.from({ length: n }, () => g(self).gauss());
      for (let i = 0; i < n; i++) {
        let sum = mu[i];
        for (let j = 0; j <= i; j++) sum += l[i * n + j] * z[j];
        out[k * n + i] = sum;
      }
    }
    return mkNum(out, sh === null ? [n] : [...sh, n], 'float64');
  }];
  return r;
}

export function installRandom(m: PyModule, ctx: Ctx): void {
  if (!rsType) {
    rsType = newNativeType('RandomState', 'numpy.random', [objectType]);
    genType = newNativeType('Generator', 'numpy.random', [objectType]);
    const meth = (t: PyType, spec: Record<string, [string, (...a: any[]) => any]>, owner: string): void => {
      for (const k of Object.keys(spec)) t.dict!.set(k, mkNative(k, spec[k][0], spec[k][1], { method: true, owner }));
    };
    const rsGet = (self: RS): Sampler => self.s;
    const dist = distributions(ctx, rsGet, true);
    const rsDim = (dims: PyTuple): number[] | null => (dims.a.length === 0 ? null : dims.a.map((x: any) => intArg(x)));
    meth(rsType, {
      ...dist,
      seed: ['self, seed=', (self: RS, seed: any) => {
        if (seed instanceof PyList || seed instanceof PyTuple) self.mt.seedArray(seed.a.map((x: any) => intArg(x)));
        else self.mt.seed(isNone(seed) ? 0x5eed : intArg(seed));
        return null;
      }],
      rand: ['self, *dims', (self: RS, dims: PyTuple) => fill(rsDim(dims), () => self.mt.double())],
      randn: ['self, *dims', (self: RS, dims: PyTuple) => fill(rsDim(dims), () => self.mt.legacyGauss())],
      random_sample: ['self, size=', (self: RS, size: any) => fill(sizeArg(size), () => self.mt.double())],
      random: ['self, size=', (self: RS, size: any) => fill(sizeArg(size), () => self.mt.double())],
      sample: ['self, size=', (self: RS, size: any) => fill(sizeArg(size), () => self.mt.double())],
      randint: ['self, low, high=, size=, dtype=', (self: RS, low: any, high: any, size: any) => {
        const lo = isNone(high) ? 0 : intArg(low);
        const hi = isNone(high) ? intArg(low) : intArg(high);
        if (lo >= hi) throw valueError('low >= high');
        return fill(sizeArg(size), () => self.mt.randint(lo, hi), 'int64');
      }],
    }, 'RandomState');
    rsType.dict!.set('__init__', mkNative('__init__', 'self, seed=', (self: RS, seed: any) => {
      if (!isNone(seed)) self.mt.seed(intArg(seed));
      return null;
    }, { method: true, owner: 'RandomState' }));
    rsType.dict!.set('__new__', mkNative('__new__', 'cls, *args, **kw', (cls: PyType) => new RS(cls), { owner: 'RandomState' }));
    const genGet = (self: GenObj): Sampler => self.s;
    const gdist = distributions(ctx, genGet, false);
    meth(genType, {
      ...gdist,
      random: ['self, size=, dtype=, out=', (self: GenObj, size: any) => fill(sizeArg(size), () => self.pcg.double())],
      integers: ['self, low, high=, size=, dtype=, endpoint=', (self: GenObj, low: any, high: any, size: any, _dt: any, endpoint: any) => {
        const lo = isNone(high) ? 0 : intArg(low);
        const hi = (isNone(high) ? intArg(low) : intArg(high)) + (bool(endpoint) ? 1 : 0);
        if (lo >= hi) throw valueError('low >= high');
        return fill(sizeArg(size), () => self.pcg.integers(lo, hi), 'int64');
      }],
    }, 'Generator');
    genType.dict!.set('__new__', mkNative('__new__', 'cls, *args, **kw', (cls: PyType, args: PyTuple) => new GenObj(cls, seedOf(args.a[0])), { owner: 'Generator' }));
  }
  globalRS ??= new RS(rsType);
  const gl = globalRS;
  const f = (name: string, sig: string, impl: (...a: any[]) => any): void => mfn(m, name, sig, impl);
  m.dict!.set('RandomState', rsType);
  m.dict!.set('Generator', genType);
  const bound = (name: string, spec: [string, (...a: any[]) => any]): void => {
    const sig = spec[0].replace(/^self,?\s*/, '');
    f(name, sig, (...a: any[]) => spec[1](gl, ...a));
  };
  const rsDims = (dims: PyTuple): number[] | null => (dims.a.length === 0 ? null : dims.a.map((x: any) => intArg(x)));
  const dist = distributions(ctx, () => gl.s, true);
  for (const k of Object.keys(dist)) bound(k, dist[k]);
  f('seed', 'seed=', (seed: any) => {
    if (seed instanceof PyList || seed instanceof PyTuple) gl.mt.seedArray(seed.a.map((x: any) => intArg(x)));
    else gl.mt.seed(isNone(seed) ? 0x5eed : intArg(seed));
    return null;
  });
  f('rand', '*dims', (dims: PyTuple) => fill(rsDims(dims), () => gl.mt.double()));
  f('randn', '*dims', (dims: PyTuple) => fill(rsDims(dims), () => gl.mt.legacyGauss()));
  f('random', 'size=', (size: any) => fill(sizeArg(size), () => gl.mt.double()));
  f('random_sample', 'size=', (size: any) => fill(sizeArg(size), () => gl.mt.double()));
  f('ranf', 'size=', (size: any) => fill(sizeArg(size), () => gl.mt.double()));
  f('sample', 'size=', (size: any) => fill(sizeArg(size), () => gl.mt.double()));
  f('randint', 'low, high=, size=, dtype=', (low: any, high: any, size: any) => {
    const lo = isNone(high) ? 0 : intArg(low);
    const hi = isNone(high) ? intArg(low) : intArg(high);
    if (lo >= hi) throw valueError('low >= high');
    return fill(sizeArg(size), () => gl.mt.randint(lo, hi), 'int64');
  });
  f('default_rng', 'seed=', (seed: any) => new GenObj(genType as PyType, seedOf(seed)));
  f('get_state', '', () => new PyTuple(['MT19937']));
  void axisArg;
  void PyFloat;
}
