/**
 * Tabla de dispersión de `set`/`frozenset` con el mismo algoritmo que CPython (sondeo lineal + perturbación),
 * de modo que el orden de iteración de los conjuntos de enteros coincida con el de Python.
 */
const DUMMY = Symbol('dummy');
const LINEAR_PROBES = 9;
const MAXS = Number.MAX_SAFE_INTEGER;

export class SetTable {
  mask = 7;
  fill = 0;
  used = 0;
  /** clave canónica; undefined = libre; DUMMY = borrado */
  keys: any[] = new Array(8).fill(undefined);
  hashes: number[] = new Array(8).fill(0);
  vals: any[] = new Array(8).fill(undefined);

  clear(): void {
    this.mask = 7;
    this.fill = 0;
    this.used = 0;
    this.keys = new Array(8).fill(undefined);
    this.hashes = new Array(8).fill(0);
    this.vals = new Array(8).fill(undefined);
  }

  /** índice de la primera ranura libre (o del primer ficticio) en la secuencia de sondeo */
  private findSlot(h: number, keys: any[], mask: number, allowDummy: boolean): number {
    let i = h & mask;
    if (h >= 0 && h <= MAXS) {
      let perturb = h;
      let freeslot = -1;
      for (;;) {
        const probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
        for (let k = 0; k <= probes; k++) {
          const key = keys[i + k];
          if (key === undefined) return freeslot >= 0 ? freeslot : i + k;
          if (allowDummy && key === DUMMY && freeslot < 0) freeslot = i + k;
        }
        perturb = Math.floor(perturb / 32);
        i = (i * 5 + 1 + perturb) & mask;
      }
    }
    let perturb = BigInt.asUintN(64, BigInt(Math.trunc(h)));
    let freeslot = -1;
    for (;;) {
      const probes = i + LINEAR_PROBES <= mask ? LINEAR_PROBES : 0;
      for (let k = 0; k <= probes; k++) {
        const key = keys[i + k];
        if (key === undefined) return freeslot >= 0 ? freeslot : i + k;
        if (allowDummy && key === DUMMY && freeslot < 0) freeslot = i + k;
      }
      perturb >>= 5n;
      i = Number((BigInt(i) * 5n + 1n + perturb) & BigInt(mask));
    }
  }

  /** inserta una clave ausente (set_add_entry sin coincidencias) */
  insert(h: number, ck: any, val: any): void {
    const slot = this.findSlot(h, this.keys, this.mask, true);
    const wasUnused = this.keys[slot] === undefined;
    this.keys[slot] = ck;
    this.hashes[slot] = h;
    this.vals[slot] = val;
    this.used++;
    if (wasUnused) {
      this.fill++;
      if (this.fill * 5 >= this.mask * 3) this.resize(this.used > 50000 ? this.used * 2 : this.used * 4);
    }
  }

  insertClean(h: number, ck: any, val: any): void {
    const slot = this.findSlot(h, this.keys, this.mask, false);
    this.keys[slot] = ck;
    this.hashes[slot] = h;
    this.vals[slot] = val;
  }

  resize(minused: number): void {
    let newsize = 8;
    while (newsize <= minused) newsize <<= 1;
    const ok = this.keys;
    const oh = this.hashes;
    const ov = this.vals;
    this.keys = new Array(newsize).fill(undefined);
    this.hashes = new Array(newsize).fill(0);
    this.vals = new Array(newsize).fill(undefined);
    this.mask = newsize - 1;
    this.fill = this.used;
    for (let i = 0; i < ok.length; i++) {
      const k = ok[i];
      if (k !== undefined && k !== DUMMY) this.insertClean(oh[i], k, ov[i]);
    }
  }

  remove(h: number, ck: any): void {
    let i = h & this.mask;
    const big = !(h >= 0 && h <= MAXS);
    let perturbN = h;
    let perturbB = big ? BigInt.asUintN(64, BigInt(Math.trunc(h))) : 0n;
    for (;;) {
      const probes = i + LINEAR_PROBES <= this.mask ? LINEAR_PROBES : 0;
      for (let k = 0; k <= probes; k++) {
        const key = this.keys[i + k];
        if (key === undefined) return;
        if (key === ck && this.hashes[i + k] === h) {
          this.keys[i + k] = DUMMY;
          this.vals[i + k] = undefined;
          this.used--;
          return;
        }
      }
      if (big) {
        perturbB >>= 5n;
        i = Number((BigInt(i) * 5n + 1n + perturbB) & BigInt(this.mask));
      } else {
        perturbN = Math.floor(perturbN / 32);
        i = (i * 5 + 1 + perturbN) & this.mask;
      }
    }
  }

  /** elementos en el orden de la tabla */
  items(): any[] {
    const out: any[] = [];
    const ks = this.keys;
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k !== undefined && k !== DUMMY) out.push(this.vals[i]);
    }
    return out;
  }

  /** copia exacta de la disposición */
  cloneFrom(o: SetTable): void {
    this.mask = o.mask;
    this.fill = o.fill;
    this.used = o.used;
    this.keys = o.keys.slice();
    this.hashes = o.hashes.slice();
    this.vals = o.vals.slice();
  }

  /** entradas activas en orden: [hash, ck, val] */
  entries(): [number, any, any][] {
    const out: [number, any, any][] = [];
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[i];
      if (k !== undefined && k !== DUMMY) out.push([this.hashes[i], k, this.vals[i]]);
    }
    return out;
  }
}
