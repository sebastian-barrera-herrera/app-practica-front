/**
 * Generadores aleatorios de NumPy:
 *  - `RandomState` (la API antigua `np.random.seed/rand/randn/randint…`): Mersenne Twister MT19937 con los mismos
 *    algoritmos que NumPy, así que `np.random.seed(0); np.random.rand(3)` da los mismos números que el NumPy real.
 *  - `Generator` (`np.random.default_rng(seed)`): PCG64 con `SeedSequence` como el real. `random()`, `integers()`,
 *    `shuffle()` y `permutation()` coinciden con NumPy; las distribuciones normales usan Box–Muller (no el zigurat).
 */

// ───────────────────────── MT19937 ─────────────────────────

export class MT19937 {
  private mt = new Uint32Array(624);
  private pos = 624;
  hasGauss = false;
  gauss = 0;

  constructor(seed = 0x5eed) {
    this.seed(seed);
  }

  seed(s: number): void {
    let seed = s >>> 0;
    for (let i = 0; i < 624; i++) {
      this.mt[i] = seed;
      seed = (Math.imul(1812433253, seed ^ (seed >>> 30)) + i + 1) >>> 0;
    }
    this.pos = 624;
    this.hasGauss = false;
    this.gauss = 0;
  }

  /** inicialización por array (como `RandomState.seed([1, 2, 3])`) */
  seedArray(key: number[]): void {
    this.seed(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.pos = 624;
  }

  private gen(): void {
    const mt = this.mt;
    let kk = 0;
    let y: number;
    for (; kk < 624 - 397; kk++) {
      y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
      mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    }
    for (; kk < 623; kk++) {
      y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
      mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    }
    y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
    mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
    this.pos = 0;
  }

  next32(): number {
    if (this.pos >= 624) this.gen();
    let y = this.mt[this.pos++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  double(): number {
    const a = this.next32() >>> 5;
    const b = this.next32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** gaussiana estándar (método polar, con caché del segundo valor, como `legacy_gauss`) */
  legacyGauss(): number {
    if (this.hasGauss) {
      this.hasGauss = false;
      const t = this.gauss;
      this.gauss = 0;
      return t;
    }
    let x1: number;
    let x2: number;
    let r2: number;
    do {
      x1 = 2 * this.double() - 1;
      x2 = 2 * this.double() - 1;
      r2 = x1 * x1 + x2 * x2;
    } while (r2 >= 1 || r2 === 0);
    const f = Math.sqrt((-2 * Math.log(r2)) / r2);
    this.gauss = f * x1;
    this.hasGauss = true;
    return f * x2;
  }

  /** entero en [0, max] por rechazo con máscara (`random_interval`) */
  interval(max: number): number {
    if (max === 0) return 0;
    let mask = max;
    mask |= mask >>> 1;
    mask |= mask >>> 2;
    mask |= mask >>> 4;
    mask |= mask >>> 8;
    mask |= mask >>> 16;
    mask >>>= 0;
    if (max <= 0xffffffff) {
      let v: number;
      do v = (this.next32() & mask) >>> 0;
      while (v > max);
      return v;
    }
    let v: number;
    do v = Number((BigInt(this.next32()) << 32n | BigInt(this.next32())) & BigInt(Math.floor(max)) );
    while (v > max);
    return v;
  }

  /** entero en [low, high) como `RandomState.randint` */
  randint(low: number, high: number): number {
    const rng = high - low - 1;
    if (rng === 0) return low;
    if (rng <= 0xffffffff) {
      if (rng === 0xffffffff) return low + this.next32();
      let mask = rng;
      mask |= mask >>> 1;
      mask |= mask >>> 2;
      mask |= mask >>> 4;
      mask |= mask >>> 8;
      mask |= mask >>> 16;
      mask >>>= 0;
      let v: number;
      do v = (this.next32() & mask) >>> 0;
      while (v > rng);
      return low + v;
    }
    const big = BigInt(rng);
    let mask = big;
    for (let s = 1n; s <= 32n; s <<= 1n) mask |= mask >> s;
    let v: bigint;
    do v = ((BigInt(this.next32()) << 32n) | BigInt(this.next32())) & mask;
    while (v > big);
    return low + Number(v);
  }
}

// ───────────────────────── PCG64 + SeedSequence ─────────────────────────

const M32 = 0xffffffff;

function hashmixMaker(init: number, mult: number) {
  let hc = init >>> 0;
  return (value: number): number => {
    value = (value ^ hc) >>> 0;
    hc = Math.imul(hc, mult) >>> 0;
    value = Math.imul(value, hc) >>> 0;
    value = (value ^ (value >>> 16)) >>> 0;
    return value;
  };
}

const mix32 = (x: number, y: number): number => {
  let r = (Math.imul(0xca01f9dd, x) - Math.imul(0x4973f715, y)) >>> 0;
  r = (r ^ (r >>> 16)) >>> 0;
  return r;
};

function entropyWords(seed: bigint): number[] {
  if (seed === 0n) return [0];
  const out: number[] = [];
  while (seed > 0n) {
    out.push(Number(seed & 0xffffffffn));
    seed >>= 32n;
  }
  return out;
}

/** `SeedSequence(seed).generate_state(n, uint64)` */
function seedState64(seed: bigint, n: number): bigint[] {
  const entropy = entropyWords(seed);
  const pool = [0, 0, 0, 0];
  const hm = hashmixMaker(0x43b0d7e5, 0x931e8875);
  for (let i = 0; i < 4; i++) pool[i] = hm(i < entropy.length ? entropy[i] : 0);
  for (let s = 0; s < 4; s++) for (let d = 0; d < 4; d++) if (s !== d) pool[d] = mix32(pool[d], hm(pool[s]));
  for (let s = 4; s < entropy.length; s++) for (let d = 0; d < 4; d++) pool[d] = mix32(pool[d], hm(entropy[s]));
  const words = n * 2;
  const st: number[] = [];
  let hc = 0x8b51f9dd >>> 0;
  for (let i = 0; i < words; i++) {
    let v = (pool[i % 4] ^ hc) >>> 0;
    hc = Math.imul(hc, 0x58f38ded) >>> 0;
    v = Math.imul(v, hc) >>> 0;
    v = (v ^ (v >>> 16)) >>> 0;
    st.push(v);
  }
  const out: bigint[] = [];
  for (let i = 0; i < n; i++) out.push(BigInt(st[2 * i]) | (BigInt(st[2 * i + 1]) << 32n));
  return out;
}

const MASK128 = (1n << 128n) - 1n;
const MASK64 = (1n << 64n) - 1n;
const PCG_MULT = 47026247687942121848144207491837523525n;

export class PCG64 {
  private state = 0n;
  private inc = 0n;
  private hasU32 = false;
  private u32 = 0;
  hasGauss = false;
  gauss = 0;

  constructor(seed: bigint) {
    const s = seedState64(seed, 4);
    const initstate = (s[0] << 64n) | s[1];
    const initseq = (s[2] << 64n) | s[3];
    this.state = 0n;
    this.inc = ((initseq << 1n) | 1n) & MASK128;
    this.step();
    this.state = (this.state + initstate) & MASK128;
    this.step();
  }

  private step(): void {
    this.state = (this.state * PCG_MULT + this.inc) & MASK128;
  }

  next64(): bigint {
    this.step();
    const st = this.state;
    const hi = st >> 64n;
    const lo = st & MASK64;
    const rot = Number(st >> 122n);
    const x = hi ^ lo;
    return rot === 0 ? x : ((x >> BigInt(rot)) | (x << BigInt(64 - rot))) & MASK64;
  }

  next32(): number {
    if (this.hasU32) {
      this.hasU32 = false;
      return this.u32;
    }
    const n = this.next64();
    this.hasU32 = true;
    this.u32 = Number(n >> 32n);
    return Number(n & 0xffffffffn);
  }

  double(): number {
    return Number(this.next64() >> 11n) / 9007199254740992;
  }

  /** gaussiana estándar por Box–Muller (con caché); NumPy usa el zigurat, así que los valores difieren */
  stdNormal(): number {
    if (this.hasGauss) {
      this.hasGauss = false;
      return this.gauss;
    }
    let u1 = this.double();
    while (u1 <= 1e-300) u1 = this.double();
    const u2 = this.double();
    const r = Math.sqrt(-2 * Math.log(u1));
    this.gauss = r * Math.sin(2 * Math.PI * u2);
    this.hasGauss = true;
    return r * Math.cos(2 * Math.PI * u2);
  }

  interval(max: number): number {
    if (max === 0) return 0;
    let mask = max;
    mask |= mask >>> 1;
    mask |= mask >>> 2;
    mask |= mask >>> 4;
    mask |= mask >>> 8;
    mask |= mask >>> 16;
    mask >>>= 0;
    let v: number;
    do v = (this.next32() & mask) >>> 0;
    while (v > max);
    return v;
  }

  /** entero en [low, high) con el método de Lemire (`Generator.integers`) */
  integers(low: number, high: number): number {
    const rng = high - low - 1;
    if (rng === 0) return low;
    if (rng <= M32) {
      if (rng === M32) return low + this.next32();
      const excl = rng + 1;
      let m = BigInt(this.next32()) * BigInt(excl);
      let leftover = Number(m & 0xffffffffn);
      if (leftover < excl) {
        const threshold = (0xffffffff - rng) % excl;
        while (leftover < threshold) {
          m = BigInt(this.next32()) * BigInt(excl);
          leftover = Number(m & 0xffffffffn);
        }
      }
      return low + Number(m >> 32n);
    }
    const excl = BigInt(rng) + 1n;
    let m = this.next64() * excl;
    let leftover = m & MASK64;
    if (leftover < excl) {
      const threshold = (MASK64 - BigInt(rng)) % excl;
      while (leftover < threshold) {
        m = this.next64() * excl;
        leftover = m & MASK64;
      }
    }
    return low + Number(m >> 64n);
  }
}

/** cualquiera de los dos generadores, con la interfaz común que necesitan las distribuciones */
export interface Bits {
  double(): number;
  interval(max: number): number;
  next32(): number;
}
