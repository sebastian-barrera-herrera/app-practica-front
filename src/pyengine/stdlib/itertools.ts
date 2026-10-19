/**
 * Módulo `itertools` (iteradores nativos con la misma semántica que CPython).
 */
import { PyIter, PyModule, PyTuple, PyType, PyObject, PyClassMethod } from '../runtime/objects';
import { classMethodType, newNativeType, objectType } from '../runtime/builtin_types';
import { stopIteration, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { intAdd, intCmp, intSign, type PyInt } from '../runtime/numeric';
import { defMethods, mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst } from './helpers';
import { asIdx, tupleArr } from '../runtime/util';

type It = ops.JsIter;

function iterDunders(t: PyType): void {
  defMethods(t, {
    __iter__: ['self', (it: any) => it],
    __next__: ['self', (it: any) => {
      const v = (it as PyIter).next();
      if (v === undefined) throw stopIteration();
      return v;
    }],
  });
}

function mkType(m: PyModule, name: string, sig: string, make: (cls: PyType, ...a: any[]) => PyIter): PyType {
  const t = newNativeType(name, 'itertools', [objectType]);
  t.dict!.set('__new__', mkNative('__new__', sig, make as any, { owner: name }));
  iterDunders(t);
  m.dict!.set(name, t);
  return t;
}

registerNative('itertools', (I: Interp, m: PyModule) => {
  // ───────── count ─────────
  class Count extends PyIter {
    cur: any;
    constructor(cls: PyType, start: any, public step: any) {
      super(cls);
      this.cur = start;
    }
    next(): any {
      const v = this.cur;
      this.cur = ops.opAdd(v, this.step);
      return v;
    }
  }
  const countT = mkType(m, 'count', 'cls, start=, step=', (cls, start?: any, step?: any) => {
    const s = start === undefined ? 0 : start;
    const st = step === undefined ? 1 : step;
    for (const x of [s, st]) if (ops.intValue(x) === undefined && ops.floatValue(x) === undefined && typeof (x as any) !== 'object') throw typeError('a number is required');
    return new Count(cls, s, st);
  });
  defMethods(countT, {
    __repr__: ['self', (c: any) => (ops.intValue(c.step) === 1 ? `count(${ops.repr(c.cur)})` : `count(${ops.repr(c.cur)}, ${ops.repr(c.step)})`)],
  });

  // ───────── cycle ─────────
  class Cycle extends PyIter {
    saved: any[] = [];
    idx = 0;
    first = true;
    it: It;
    constructor(cls: PyType, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      if (this.first) {
        const v = this.it.next();
        if (v !== undefined) { this.saved.push(v); return v; }
        this.first = false;
      }
      if (this.saved.length === 0) return undefined;
      const v = this.saved[this.idx];
      this.idx = (this.idx + 1) % this.saved.length;
      return v;
    }
  }
  mkType(m, 'cycle', 'cls, iterable', (cls, it) => new Cycle(cls, it));

  // ───────── repeat ─────────
  class Repeat extends PyIter {
    constructor(cls: PyType, public obj: any, public times: number) {
      super(cls);
    }
    next(): any {
      if (this.times === 0) return undefined;
      if (this.times > 0) this.times--;
      return this.obj;
    }
  }
  const repeatT = mkType(m, 'repeat', 'cls, object, times=', (cls, o, t?: any) => new Repeat(cls, o, t === undefined ? -1 : Math.max(0, asIdx(t))));
  defMethods(repeatT, {
    __repr__: ['self', (r: any) => (r.times < 0 ? `repeat(${ops.repr(r.obj)})` : `repeat(${ops.repr(r.obj)}, ${r.times})`)],
    __length_hint__: ['self', (r: any) => {
      if (r.times < 0) throw typeError('len() of unsized object');
      return r.times;
    }],
  });

  // ───────── accumulate ─────────
  class Accumulate extends PyIter {
    total: any = undefined;
    started = false;
    it: It;
    constructor(cls: PyType, iterable: any, public func: any, public initial: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      if (!this.started) {
        this.started = true;
        if (this.initial !== undefined) { this.total = this.initial; return this.total; }
        const v = this.it.next();
        if (v === undefined) return undefined;
        this.total = v;
        return v;
      }
      const v = this.it.next();
      if (v === undefined) return undefined;
      this.total = this.func === null || this.func === undefined ? ops.opAdd(this.total, v) : callObj(this.func, [this.total, v]);
      return this.total;
    }
  }
  mkType(m, 'accumulate', 'cls, iterable, func=, *, initial=', (cls, it, f?: any, init?: any) => new Accumulate(cls, it, f, init === null ? undefined : init));

  // ───────── chain ─────────
  class Chain extends PyIter {
    cur: It | null = null;
    constructor(cls: PyType, public src: It) {
      super(cls);
    }
    next(): any {
      for (;;) {
        if (this.cur === null) {
          const nx = this.src.next();
          if (nx === undefined) return undefined;
          this.cur = ops.getIter(nx);
        }
        const v = this.cur.next();
        if (v !== undefined) return v;
        this.cur = null;
      }
    }
  }
  const chainT = mkType(m, 'chain', 'cls, *iterables', (cls, its) => new Chain(cls, new ops.TupleIter(tupleArr(its))));
  chainT.dict!.set('from_iterable', new PyClassMethod(classMethodType, mkNative('from_iterable', 'cls, iterable', (cls: any, it: any) => new Chain(cls, ops.getIter(it)), { owner: 'chain' })));

  // ───────── compress / dropwhile / takewhile / filterfalse ─────────
  class Compress extends PyIter {
    d: It;
    s: It;
    constructor(cls: PyType, data: any, sel: any) {
      super(cls);
      this.d = ops.getIter(data);
      this.s = ops.getIter(sel);
    }
    next(): any {
      for (;;) {
        const v = this.d.next();
        const s = this.s.next();
        if (v === undefined || s === undefined) return undefined;
        if (ops.truthy(s)) return v;
      }
    }
  }
  mkType(m, 'compress', 'cls, data, selectors', (cls, d, s) => new Compress(cls, d, s));

  class DropWhile extends PyIter {
    dropping = true;
    it: It;
    constructor(cls: PyType, public pred: any, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      for (;;) {
        const v = this.it.next();
        if (v === undefined) return undefined;
        if (this.dropping && ops.truthy(callObj(this.pred, [v]))) continue;
        this.dropping = false;
        return v;
      }
    }
  }
  mkType(m, 'dropwhile', 'cls, predicate, iterable', (cls, p, it) => new DropWhile(cls, p, it));

  class TakeWhile extends PyIter {
    done = false;
    it: It;
    constructor(cls: PyType, public pred: any, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      if (this.done) return undefined;
      const v = this.it.next();
      if (v === undefined) return undefined;
      if (!ops.truthy(callObj(this.pred, [v]))) { this.done = true; return undefined; }
      return v;
    }
  }
  mkType(m, 'takewhile', 'cls, predicate, iterable', (cls, p, it) => new TakeWhile(cls, p, it));

  class FilterFalse extends PyIter {
    it: It;
    constructor(cls: PyType, public pred: any, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      for (;;) {
        const v = this.it.next();
        if (v === undefined) return undefined;
        const t = this.pred === null ? ops.truthy(v) : ops.truthy(callObj(this.pred, [v]));
        if (!t) return v;
      }
    }
  }
  mkType(m, 'filterfalse', 'cls, function, iterable', (cls, p, it) => new FilterFalse(cls, p, it));

  // ───────── islice ─────────
  class ISlice extends PyIter {
    pos = 0;
    nextIdx: number;
    it: It;
    constructor(cls: PyType, iterable: any, public start: number, public stop: number | null, public step: number) {
      super(cls);
      this.it = ops.getIter(iterable);
      this.nextIdx = start;
    }
    next(): any {
      if (this.stop !== null && this.nextIdx >= this.stop) {
        // consume hasta stop para respetar efectos laterales como CPython
        return undefined;
      }
      let v: any;
      while (this.pos <= this.nextIdx) {
        v = this.it.next();
        if (v === undefined) { this.nextIdx = this.stop ?? Infinity; this.stop = 0; return undefined; }
        this.pos++;
      }
      this.nextIdx += this.step;
      return v;
    }
  }
  mkType(m, 'islice', 'cls, iterable, *args', (cls, it, args) => {
    const a = tupleArr(args);
    if (a.length < 1 || a.length > 3) throw typeError(`islice expected at most 4 arguments, got ${a.length + 1}`);
    const conv = (x: any, what: string): number | null => {
      if (x === null) return null;
      const iv = ops.intValue(x);
      if (iv === undefined) throw valueError(what);
      const n = Number(iv);
      if (n < 0) throw valueError(what);
      return n;
    };
    let start = 0;
    let stop: number | null;
    let step = 1;
    if (a.length === 1) stop = conv(a[0], 'Stop argument for islice() must be None or an integer: 0 <= x <= sys.maxsize.');
    else {
      start = conv(a[0], 'Indices for islice() must be None or an integer: 0 <= x <= sys.maxsize.') ?? 0;
      stop = conv(a[1], 'Stop argument for islice() must be None or an integer: 0 <= x <= sys.maxsize.');
      if (a.length === 3) {
        const s = a[2] === null ? 1 : conv(a[2], 'Step for islice() must be a positive integer or None.');
        if (s === null || s < 1) throw valueError('Step for islice() must be a positive integer or None.');
        step = s;
      }
    }
    return new ISlice(cls, it, start, stop, step);
  });

  // ───────── pairwise / starmap / zip_longest / batched ─────────
  class Pairwise extends PyIter {
    prev: any = undefined;
    started = false;
    it: It;
    constructor(cls: PyType, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      if (!this.started) {
        this.started = true;
        this.prev = this.it.next();
        if (this.prev === undefined) return undefined;
      }
      if (this.prev === undefined) return undefined;
      const v = this.it.next();
      if (v === undefined) { this.prev = undefined; return undefined; }
      const r = new PyTuple([this.prev, v]);
      this.prev = v;
      return r;
    }
  }
  mkType(m, 'pairwise', 'cls, iterable', (cls, it) => new Pairwise(cls, it));

  class StarMap extends PyIter {
    it: It;
    constructor(cls: PyType, public f: any, iterable: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      const v = this.it.next();
      if (v === undefined) return undefined;
      return callObj(this.f, ops.iterToArray(v));
    }
  }
  mkType(m, 'starmap', 'cls, function, iterable', (cls, f, it) => new StarMap(cls, f, it));

  class ZipLongest extends PyIter {
    its: (It | null)[];
    active: number;
    constructor(cls: PyType, its: any[], public fill: any) {
      super(cls);
      this.its = its.map((x) => ops.getIter(x));
      this.active = this.its.length;
    }
    next(): any {
      if (this.its.length === 0 || this.active === 0) return undefined;
      const out: any[] = [];
      for (let i = 0; i < this.its.length; i++) {
        const it = this.its[i];
        if (it === null) { out.push(this.fill); continue; }
        const v = it.next();
        if (v === undefined) {
          this.active--;
          this.its[i] = null;
          if (this.active === 0) return undefined;
          out.push(this.fill);
        } else out.push(v);
      }
      return new PyTuple(out);
    }
  }
  mkType(m, 'zip_longest', 'cls, *iterables, fillvalue=', (cls, its, fv?: any) => new ZipLongest(cls, tupleArr(its), fv === undefined ? null : fv));

  class Batched extends PyIter {
    it: It;
    constructor(cls: PyType, iterable: any, public n: number, public strict: boolean) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    next(): any {
      const out: any[] = [];
      for (let i = 0; i < this.n; i++) {
        const v = this.it.next();
        if (v === undefined) break;
        out.push(v);
      }
      if (out.length === 0) return undefined;
      if (this.strict && out.length < this.n) throw valueError('batched(): incomplete batch');
      return new PyTuple(out);
    }
  }
  mkType(m, 'batched', 'cls, iterable, n, *, strict=', (cls, it, n, strict?: any) => {
    const k = asIdx(n);
    if (k < 1) throw valueError('n must be at least one');
    return new Batched(cls, it, k, strict !== undefined && ops.truthy(strict));
  });

  // ───────── groupby ─────────
  class GroupBy extends PyIter {
    it: It;
    tgtkey: any = undefined;
    currkey: any = undefined;
    currvalue: any = undefined;
    currgrouper: Grouper | null = null;
    constructor(cls: PyType, iterable: any, public keyf: any) {
      super(cls);
      this.it = ops.getIter(iterable);
    }
    step(): boolean {
      const v = this.it.next();
      if (v === undefined) return false;
      this.currvalue = v;
      this.currkey = this.keyf === null ? v : callObj(this.keyf, [v]);
      return true;
    }
    next(): any {
      this.currgrouper = null;
      for (;;) {
        if (this.currkey === undefined) { /* pasar */ }
        else if (this.tgtkey === undefined) break;
        else if (!(this.tgtkey === this.currkey || ops.eqOp(this.tgtkey, this.currkey))) break;
        if (!this.step()) return undefined;
      }
      this.tgtkey = this.currkey;
      const g = new Grouper(grouperT, this, this.tgtkey);
      this.currgrouper = g;
      return new PyTuple([this.currkey, g]);
    }
  }
  class Grouper extends PyIter {
    constructor(cls: PyType, public parent: GroupBy, public tgt: any) {
      super(cls);
    }
    next(): any {
      const p = this.parent;
      if (p.currgrouper !== this) return undefined;
      if (p.currvalue === undefined) {
        if (!p.step()) return undefined;
      }
      if (!(this.tgt === p.currkey || ops.eqOp(this.tgt, p.currkey))) return undefined;
      const r = p.currvalue;
      p.currvalue = undefined;
      return r;
    }
  }
  const grouperT = newNativeType('_grouper', 'itertools', [objectType]);
  iterDunders(grouperT);
  mkType(m, 'groupby', 'cls, iterable, key=', (cls, it, k?: any) => new GroupBy(cls, it, k === undefined ? null : k));

  // ───────── tee ─────────
  class TeeData {
    buf: any[] = [];
    done = false;
    constructor(public it: It) {}
    get(i: number): any {
      while (this.buf.length <= i) {
        if (this.done) return undefined;
        const v = this.it.next();
        if (v === undefined) { this.done = true; return undefined; }
        this.buf.push(v);
      }
      return this.buf[i];
    }
  }
  class TeeIter extends PyIter {
    constructor(cls: PyType, public data: TeeData, public pos = 0) {
      super(cls);
    }
    next(): any {
      const v = this.data.get(this.pos);
      if (v === undefined) return undefined;
      this.pos++;
      return v;
    }
  }
  const teeObjT = newNativeType('_tee', 'itertools', [objectType]);
  iterDunders(teeObjT);
  defMethods(teeObjT, {
    __copy__: ['self', (t: any) => new TeeIter(teeObjT, t.data, t.pos)],
  });
  m.dict!.set('tee', mkNative('tee', 'iterable, n=2, /', (iterable: any, n?: any) => {
    const k = n === undefined ? 2 : asIdx(n);
    if (k < 0) throw valueError('n must be >= 0');
    const src = iterable instanceof TeeIter ? iterable : null;
    const data = src ? src.data : new TeeData(ops.getIter(iterable));
    const out: any[] = [];
    for (let i = 0; i < k; i++) out.push(new TeeIter(teeObjT, data, src ? src.pos : 0));
    return new PyTuple(out);
  }, { module: 'itertools' }));

  // ───────── product / permutations / combinations ─────────
  class Product extends PyIter {
    idx: number[];
    done = false;
    started = false;
    constructor(cls: PyType, public pools: any[][]) {
      super(cls);
      this.idx = pools.map(() => 0);
      if (pools.some((p) => p.length === 0)) this.done = true;
    }
    next(): any {
      if (this.done) return undefined;
      if (!this.started) {
        this.started = true;
        return new PyTuple(this.pools.map((p, i) => p[this.idx[i]]));
      }
      let i = this.pools.length - 1;
      for (; i >= 0; i--) {
        this.idx[i]++;
        if (this.idx[i] < this.pools[i].length) break;
        this.idx[i] = 0;
      }
      if (i < 0) { this.done = true; return undefined; }
      return new PyTuple(this.pools.map((p, j) => p[this.idx[j]]));
    }
  }
  mkType(m, 'product', 'cls, *iterables, repeat=', (cls, its, rep?: any) => {
    const r = rep === undefined ? 1 : asIdx(rep);
    if (r < 0) throw valueError('repeat argument cannot be negative');
    const pools = tupleArr(its).map((x) => ops.iterToArray(x));
    const all: any[][] = [];
    for (let i = 0; i < r; i++) for (const p of pools) all.push(p);
    const pr = new Product(cls, all);
    if (all.length === 0) {
      // product() → una tupla vacía
      (pr as any).pools = [];
      pr.done = false;
    }
    return pr;
  });

  class Permutations extends PyIter {
    indices: number[];
    cycles: number[];
    done = false;
    started = false;
    constructor(cls: PyType, public pool: any[], public r: number) {
      super(cls);
      const n = pool.length;
      this.indices = Array.from({ length: n }, (_, i) => i);
      this.cycles = Array.from({ length: r }, (_, i) => n - i);
      if (r > n) this.done = true;
    }
    next(): any {
      if (this.done) return undefined;
      const n = this.pool.length;
      if (!this.started) {
        this.started = true;
        return new PyTuple(this.indices.slice(0, this.r).map((i) => this.pool[i]));
      }
      let i = this.r - 1;
      for (; i >= 0; i--) {
        this.cycles[i]--;
        if (this.cycles[i] === 0) {
          const x = this.indices[i];
          for (let j = i; j < n - 1; j++) this.indices[j] = this.indices[j + 1];
          this.indices[n - 1] = x;
          this.cycles[i] = n - i;
        } else {
          const j = n - this.cycles[i];
          [this.indices[i], this.indices[j]] = [this.indices[j], this.indices[i]];
          return new PyTuple(this.indices.slice(0, this.r).map((k) => this.pool[k]));
        }
      }
      this.done = true;
      return undefined;
    }
  }
  mkType(m, 'permutations', 'cls, iterable, r=', (cls, it, r?: any) => {
    const pool = ops.iterToArray(it);
    const rr = r === undefined || r === null ? pool.length : asIdx(r);
    if (rr < 0) throw valueError('r must be non-negative');
    return new Permutations(cls, pool, rr);
  });

  class Combinations extends PyIter {
    indices: number[];
    done = false;
    started = false;
    constructor(cls: PyType, public pool: any[], public r: number, public repl: boolean) {
      super(cls);
      this.indices = repl ? new Array(r).fill(0) : Array.from({ length: r }, (_, i) => i);
      if (!repl && r > pool.length) this.done = true;
      if (repl && pool.length === 0 && r > 0) this.done = true;
    }
    next(): any {
      if (this.done) return undefined;
      const n = this.pool.length;
      if (!this.started) {
        this.started = true;
        return new PyTuple(this.indices.map((i) => this.pool[i]));
      }
      let i = this.r - 1;
      if (this.repl) {
        for (; i >= 0; i--) if (this.indices[i] !== n - 1) break;
        if (i < 0) { this.done = true; return undefined; }
        const v = this.indices[i] + 1;
        for (let j = i; j < this.r; j++) this.indices[j] = v;
      } else {
        for (; i >= 0; i--) if (this.indices[i] !== i + n - this.r) break;
        if (i < 0) { this.done = true; return undefined; }
        this.indices[i]++;
        for (let j = i + 1; j < this.r; j++) this.indices[j] = this.indices[j - 1] + 1;
      }
      return new PyTuple(this.indices.map((k) => this.pool[k]));
    }
  }
  mkType(m, 'combinations', 'cls, iterable, r', (cls, it, r) => {
    const rr = asIdx(r);
    if (rr < 0) throw valueError('r must be non-negative');
    return new Combinations(cls, ops.iterToArray(it), rr, false);
  });
  mkType(m, 'combinations_with_replacement', 'cls, iterable, r', (cls, it, r) => {
    const rr = asIdx(r);
    if (rr < 0) throw valueError('r must be non-negative');
    return new Combinations(cls, ops.iterToArray(it), rr, true);
  });

  mconst(m, {});
  void [PyObject, intAdd, intCmp, intSign, I];
});
export type { PyInt };
