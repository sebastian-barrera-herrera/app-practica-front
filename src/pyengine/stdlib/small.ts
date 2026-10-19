/**
 * Módulos nativos pequeños: `_random` (Mersenne Twister exacto), `_weakref`, `_thread`, `errno`, `atexit`, `gc`,
 * `_string`, `unicodedata`, `_stat`-lite y `_locale`.
 */
import { PyBytes, PyFloat, PyList, PyModule, PyObject, PyTuple, PyType, PyBox } from '../runtime/objects';
import { bytesType, newNativeType, objectType, typeOf } from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { makeExc, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { intBitLength, intSign, normBig, toBig } from '../runtime/numeric';
import { asIdx, asStr } from '../runtime/util';

// ───────────────────────── _random: MT19937 ─────────────────────────

class Mt {
  mt = new Uint32Array(624);
  index = 625;

  initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.index = 624;
  }

  initByArray(key: number[]): void {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    let k = Math.max(624, key.length);
    for (; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (k = 623; k; k--) {
      const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.index = 624;
  }

  genrand(): number {
    const mt = this.mt;
    if (this.index >= 624) {
      let kk = 0;
      const mag = (y: number): number => (y & 1 ? 0x9908b0df : 0);
      for (; kk < 624 - 397; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ mag(y);
      }
      for (; kk < 623; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ mag(y);
      }
      const y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[623] = mt[396] ^ (y >>> 1) ^ mag(y);
      this.index = 0;
    }
    let y = mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
}

class RandomObj extends PyObject {
  st = new Mt();
}

function seedFromInt(st: Mt, n: bigint): void {
  if (n < 0n) n = -n;
  const key: number[] = [];
  if (n === 0n) key.push(0);
  while (n > 0n) {
    key.push(Number(n & 0xffffffffn));
    n >>= 32n;
  }
  st.initByArray(key);
}

registerNative('_random', (I: Interp, m: PyModule) => {
  const t = newNativeType('Random', '_random', [objectType]);
  t.alloc = (cls) => new RandomObj(cls);
  const R = (x: any): RandomObj => {
    if (!(x instanceof RandomObj)) throw typeError('descriptor requires a _random.Random object');
    return x;
  };
  const seed = (r: RandomObj, a: any): void => {
    if (a === undefined || a === null) {
      seedFromInt(r.st, BigInt(I.seed));
      return;
    }
    let v = ops.intValue(a);
    if (v === undefined) v = ops.hashOf(a);
    seedFromInt(r.st, toBig(v));
  };
  t.dict!.set('__new__', mkNative('__new__', 'cls, *args', (cls: any) => {
    const r = new RandomObj(cls);
    seed(r, undefined);
    return r;
  }, { owner: 'Random' }));
  t.dict!.set('__init__', mkNative('__init__', 'self, *args', (self: any, args: any) => {
    const a = args.a;
    if (a.length > 0) seed(R(self), a[0]);
    return null;
  }, { method: true, owner: 'Random' }));
  const methods: Record<string, [string, (...a: any[]) => any]> = {
    seed: ['self, n=', (self: any, n?: any) => { seed(R(self), n); return null; }],
    random: ['self', (self: any) => {
      const st = R(self).st;
      const a = st.genrand() >>> 5;
      const b = st.genrand() >>> 6;
      return new PyFloat((a * 67108864.0 + b) * (1.0 / 9007199254740992.0));
    }],
    getrandbits: ['self, k', (self: any, kk: any) => {
      const st = R(self).st;
      const k = asIdx(kk);
      if (k < 0) throw valueError('number of bits must be non-negative');
      if (k === 0) return 0;
      if (k <= 32) return st.genrand() >>> (32 - k);
      let r = 0n;
      let kk2 = k;
      for (let i = 0; kk2 > 0; i++, kk2 -= 32) {
        let w = st.genrand();
        if (kk2 < 32) w >>>= 32 - kk2;
        r |= BigInt(w) << BigInt(32 * i);
      }
      return normBig(r);
    }],
    getstate: ['self', (self: any) => {
      const st = R(self).st;
      return new PyTuple([...Array.from(st.mt), st.index]);
    }],
    setstate: ['self, state', (self: any, state: any) => {
      const st = R(self).st;
      if (!(state instanceof PyTuple) || state.a.length !== 625) throw valueError('state vector is the wrong size');
      for (let i = 0; i < 624; i++) st.mt[i] = Number(ops.toIndex(state.a[i]));
      st.index = Number(ops.toIndex(state.a[624]));
      return null;
    }],
  };
  for (const k of Object.keys(methods)) t.dict!.set(k, mkNative(k, methods[k][0], methods[k][1], { method: true, owner: 'Random' }));
  m.dict!.set('Random', t);
  I.snapHooks.push(() => {
    // el generador por defecto se restaura entre reejecuciones
    return () => undefined;
  });
});

// ───────────────────────── _weakref ─────────────────────────

registerNative('_weakref', (I: Interp, m: PyModule) => {
  const refT = newNativeType('ReferenceType', '_weakref', [objectType]);
  refT.name = 'ref';
  refT.qualname = 'ref';
  refT.alloc = (cls) => new PyObject(cls);
  refT.dict!.set('__new__', mkNative('__new__', 'cls, ob, callback=, /, *args', (cls: any, ob: any, cb?: any) => {
    const o = new PyObject(cls);
    (o as any).ref = ob;
    (o as any).cb = cb === undefined ? null : cb;
    return o;
  }, { owner: 'ref' }));
  refT.dict!.set('__init__', mkNative('__init__', 'self, *args, **kw', () => null, { method: true, owner: 'ref' }));
  const methods: Record<string, [string, (...a: any[]) => any]> = {
    __call__: ['self', (s: any) => s.ref],
    __hash__: ['self', (s: any) => ops.hashOf(s.ref)],
    __eq__: ['self, other', (a: any, b: any) => (b instanceof PyObject && b.cls.isSubtype(refT) ? ops.eqOp((a as any).ref, (b as any).ref) : (require('../runtime/builtin_types') as typeof import('../runtime/builtin_types')).NotImplemented)],
    __repr__: ['self', (s: any) => `<weakref at ${I.hexId(s)}; to '${typeOf(s.ref).name}' at ${I.hexId(s.ref)}>`],
  };
  for (const k of Object.keys(methods)) refT.dict!.set(k, mkNative(k, methods[k][0], methods[k][1], { method: true, owner: 'ref' }));
  refT.dict!.set('__callback__', null);
  m.dict!.set('ref', refT);
  m.dict!.set('ReferenceType', refT);
  m.dict!.set('ProxyType', refT);
  m.dict!.set('CallableProxyType', refT);
  mfn(m, 'proxy', 'object, callback=, /', (o: any) => o);
  mfn(m, 'getweakrefcount', 'object, /', () => 0);
  mfn(m, 'getweakrefs', 'object, /', () => new PyList([]));
  mfn(m, '_remove_dead_weakref', 'dict, key, /', () => null);
});

// ───────────────────────── _thread ─────────────────────────

registerNative('_thread', (I: Interp, m: PyModule) => {
  const lockT = newNativeType('lock', '_thread', [objectType]);
  const lm: Record<string, [string, (...a: any[]) => any]> = {
    acquire: ['self, blocking=, timeout=', (s: any, b?: any) => {
      if (s.locked) {
        if (b !== undefined && !ops.truthy(b)) return false;
        throw makeExc(E.RuntimeError, ['deadlock: lock already held (no hay otros hilos)']);
      }
      s.locked = true;
      return true;
    }],
    release: ['self', (s: any) => {
      if (!s.locked) throw makeExc(E.RuntimeError, ['release unlocked lock']);
      s.locked = false;
      return null;
    }],
    locked: ['self', (s: any) => !!s.locked],
    __enter__: ['self', (s: any) => callObj(lockT.lookup('acquire'), [s])],
    __exit__: ['self, *a', (s: any) => { s.locked = false; return null; }],
    _at_fork_reinit: ['self', (s: any) => { s.locked = false; return null; }],
  };
  for (const k of Object.keys(lm)) lockT.dict!.set(k, mkNative(k, lm[k][0], lm[k][1], { method: true, owner: 'lock' }));
  lockT.dict!.set('__new__', mkNative('__new__', 'cls, *a', (cls: any) => { const o = new PyObject(cls); (o as any).locked = false; return o; }, { owner: 'lock' }));
  m.dict!.set('LockType', lockT);
  m.dict!.set('lock', lockT);
  const rl = newNativeType('RLock', '_thread', [objectType]);
  const rm: Record<string, [string, (...a: any[]) => any]> = {
    acquire: ['self, blocking=, timeout=', (s: any) => { s.count++; return true; }],
    release: ['self', (s: any) => {
      if (s.count <= 0) throw makeExc(E.RuntimeError, ['cannot release un-acquired lock']);
      s.count--;
      return null;
    }],
    __enter__: ['self', (s: any) => { s.count++; return s; }],
    __exit__: ['self, *a', (s: any) => { s.count--; return null; }],
    _is_owned: ['self', (s: any) => s.count > 0],
  };
  for (const k of Object.keys(rm)) rl.dict!.set(k, mkNative(k, rm[k][0], rm[k][1], { method: true, owner: 'RLock' }));
  rl.dict!.set('__new__', mkNative('__new__', 'cls, *a', (cls: any) => { const o = new PyObject(cls); (o as any).count = 0; return o; }, { owner: 'RLock' }));
  m.dict!.set('RLock', rl);
  mfn(m, 'allocate_lock', '', () => callObj(lockT, []));
  mfn(m, 'get_ident', '', () => 1);
  mfn(m, 'get_native_id', '', () => 1);
  mfn(m, '_count', '', () => 0);
  mfn(m, 'start_new_thread', 'function, args, kwargs=', (f: any, args: any, kw?: any) => {
    callObj(f, args instanceof PyTuple ? args.a.slice() : []);
    void kw;
    return 1;
  });
  mconst(m, { error: E.RuntimeError, TIMEOUT_MAX: new PyFloat(9223372036.0) });
  const localT = newNativeType('_local', '_thread', [objectType]);
  localT.flags |= 16;
  localT.computeMro();
  localT.alloc = (cls) => new PyObject(cls);
  m.dict!.set('_local', localT);
  void I;
});

// ───────────────────────── errno ─────────────────────────

const ERRNOS: Record<string, number> = { EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5, ENXIO: 6, E2BIG: 7, ENOEXEC: 8, EBADF: 9, ECHILD: 10, EWOULDBLOCK: 11, EAGAIN: 11, ENOMEM: 12, EACCES: 13, EFAULT: 14, ENOTBLK: 15, EBUSY: 16, EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20, EISDIR: 21, EINVAL: 22, ENFILE: 23, EMFILE: 24, ENOTTY: 25, ETXTBSY: 26, EFBIG: 27, ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32, EDOM: 33, ERANGE: 34, EDEADLK: 35, EDEADLOCK: 35, ENAMETOOLONG: 36, ENOLCK: 37, ENOSYS: 38, ENOTEMPTY: 39, ELOOP: 40, ENOMSG: 42, EIDRM: 43, ECHRNG: 44, EL2NSYNC: 45, EL3HLT: 46, EL3RST: 47, ELNRNG: 48, EUNATCH: 49, ENOCSI: 50, EL2HLT: 51, EBADE: 52, EBADR: 53, EXFULL: 54, ENOANO: 55, EBADRQC: 56, EBADSLT: 57, EBFONT: 59, ENOSTR: 60, ENODATA: 61, ETIME: 62, ENOSR: 63, ENONET: 64, ENOPKG: 65, EREMOTE: 66, ENOLINK: 67, EADV: 68, ESRMNT: 69, ECOMM: 70, EPROTO: 71, EMULTIHOP: 72, EDOTDOT: 73, EBADMSG: 74, EOVERFLOW: 75, ENOTUNIQ: 76, EBADFD: 77, EREMCHG: 78, ELIBACC: 79, ELIBBAD: 80, ELIBSCN: 81, ELIBMAX: 82, ELIBEXEC: 83, EILSEQ: 84, ERESTART: 85, ESTRPIPE: 86, EUSERS: 87, ENOTSOCK: 88, EDESTADDRREQ: 89, EMSGSIZE: 90, EPROTOTYPE: 91, ENOPROTOOPT: 92, EPROTONOSUPPORT: 93, ESOCKTNOSUPPORT: 94, EOPNOTSUPP: 95, ENOTSUP: 95, EPFNOSUPPORT: 96, EAFNOSUPPORT: 97, EADDRINUSE: 98, EADDRNOTAVAIL: 99, ENETDOWN: 100, ENETUNREACH: 101, ENETRESET: 102, ECONNABORTED: 103, ECONNRESET: 104, ENOBUFS: 105, EISCONN: 106, ENOTCONN: 107, ESHUTDOWN: 108, ETOOMANYREFS: 109, ETIMEDOUT: 110, ECONNREFUSED: 111, EHOSTDOWN: 112, EHOSTUNREACH: 113, EALREADY: 114, EINPROGRESS: 115, ESTALE: 116, EUCLEAN: 117, ENOTNAM: 118, ENAVAIL: 119, EISNAM: 120, EREMOTEIO: 121, EDQUOT: 122, ENOMEDIUM: 123, EMEDIUMTYPE: 124, ECANCELED: 125, ENOKEY: 126, EKEYEXPIRED: 127, EKEYREVOKED: 128, EKEYREJECTED: 129, EOWNERDEAD: 130, ENOTRECOVERABLE: 131, ERFKILL: 132 };
registerNative('errno', (I: Interp, m: PyModule) => {
  const codes = new (require('../runtime/objects').PyDict)();
  for (const [k, v] of Object.entries(ERRNOS)) {
    m.dict!.set(k, v);
    codes.set(v, k);
  }
  m.dict!.set('errorcode', codes);
  void I;
});

// ───────────────────────── atexit ─────────────────────────

registerNative('atexit', (I: Interp, m: PyModule) => {
  mfn(m, 'register', 'func, /, *args, **kwargs', (f: any, args: any) => {
    I.atexit.push({ fn: f, args: args.a.slice() });
    return f;
  });
  mfn(m, 'unregister', 'func, /', (f: any) => {
    I.atexit = I.atexit.filter((h) => h.fn !== f);
    return null;
  });
  mfn(m, '_clear', '', () => { I.atexit = []; return null; });
  mfn(m, '_run_exitfuncs', '', () => {
    while (I.atexit.length) {
      const h = I.atexit.pop()!;
      callObj(h.fn, h.args.slice());
    }
    return null;
  });
  mfn(m, '_ncallbacks', '', () => I.atexit.length);
});

// ───────────────────────── gc ─────────────────────────

registerNative('gc', (I: Interp, m: PyModule) => {
  let enabled = true;
  mfn(m, 'collect', 'generation=', () => 0);
  mfn(m, 'enable', '', () => { enabled = true; return null; });
  mfn(m, 'disable', '', () => { enabled = false; return null; });
  mfn(m, 'isenabled', '', () => enabled);
  mfn(m, 'get_count', '', () => new PyTuple([0, 0, 0]));
  mfn(m, 'get_threshold', '', () => new PyTuple([700, 10, 10]));
  mfn(m, 'set_threshold', '*a', () => null);
  mfn(m, 'get_objects', 'generation=', () => new PyList([]));
  mfn(m, 'get_referrers', '*objs', () => new PyList([]));
  mfn(m, 'get_referents', '*objs', () => new PyList([]));
  m.dict!.set('garbage', new PyList([]));
  void I;
});

// ───────────────────────── _string ─────────────────────────

registerNative('_string', (I: Interp, m: PyModule) => {
  mfn(m, 'formatter_parser', 'format_string, /', (fs: any) => {
    const s = asStr(fs);
    const out: any[] = [];
    let lit = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '{') {
        if (s[i + 1] === '{') { lit += '{'; i += 2; continue; }
        let depth = 1;
        let j = i + 1;
        while (j < s.length && depth > 0) {
          if (s[j] === '{') depth++;
          else if (s[j] === '}') depth--;
          j++;
        }
        if (depth > 0) throw valueError("expected '}' before end of string");
        const inner = s.slice(i + 1, j - 1);
        let k = 0;
        let br = false;
        let end = inner.length;
        for (; k < inner.length; k++) {
          const ch = inner[k];
          if (ch === '[') br = true;
          else if (ch === ']') br = false;
          else if (!br && (ch === '!' || ch === ':')) { end = k; break; }
        }
        const field = inner.slice(0, end);
        let conv: string | null = null;
        let spec = '';
        let r = inner.slice(end);
        if (r[0] === '!') { conv = r[1] ?? null; r = r.slice(2); }
        if (r[0] === ':') spec = r.slice(1);
        out.push(new PyTuple([lit, field, spec, conv]));
        lit = '';
        i = j;
      } else if (c === '}') {
        if (s[i + 1] === '}') { lit += '}'; i += 2; continue; }
        throw valueError("Single '}' encountered in format string");
      } else { lit += c; i++; }
    }
    if (lit) out.push(new PyTuple([lit, null, null, null]));
    return new ops.ListIter(new PyList(out));
  });
  mfn(m, 'formatter_field_name_split', 'field_name, /', (fn: any) => {
    const s = asStr(fn);
    const mm = /^([^.\[]*)(.*)$/s.exec(s)!;
    const first: any = /^\d+$/.test(mm[1]) ? parseInt(mm[1], 10) : mm[1];
    const rest: any[] = [];
    let r = mm[2];
    while (r.length) {
      if (r[0] === '.') {
        const x = /^\.([^.\[]+)(.*)$/s.exec(r)!;
        rest.push(new PyTuple([true, x[1]]));
        r = x[2];
      } else {
        const close = r.indexOf(']');
        const key = r.slice(1, close);
        rest.push(new PyTuple([false, /^\d+$/.test(key) ? parseInt(key, 10) : key]));
        r = r.slice(close + 1);
      }
    }
    return new PyTuple([first, new ops.ListIter(new PyList(rest))]);
  });
  void I;
});

// ───────────────────────── unicodedata ─────────────────────────

const CATS = ['Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Mc', 'Me', 'Nd', 'Nl', 'No', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po', 'Sm', 'Sc', 'Sk', 'So', 'Zs', 'Zl', 'Zp', 'Cc', 'Cf', 'Cs', 'Co'];
const CAT_RE = CATS.map((c) => [c, new RegExp(`^\\p{${c}}$`, 'u')] as const);

registerNative('unicodedata', (I: Interp, m: PyModule) => {
  mfn(m, 'category', 'chr, /', (c: any) => {
    const s = asStr(c);
    if (Array.from(s).length !== 1) throw typeError(`category() argument must be a unicode character, not str`);
    for (const [n, re] of CAT_RE) if (re.test(s)) return n;
    return 'Cn';
  });
  mfn(m, 'normalize', 'form, unistr, /', (f: any, s: any) => {
    const form = asStr(f);
    if (!['NFC', 'NFD', 'NFKC', 'NFKD'].includes(form)) throw valueError('invalid normalization form');
    return asStr(s).normalize(form as 'NFC');
  });
  mfn(m, 'is_normalized', 'form, unistr, /', (f: any, s: any) => asStr(s).normalize(asStr(f) as 'NFC') === asStr(s));
  mfn(m, 'numeric', 'chr, default=, /', (c: any, d?: any) => {
    const s = asStr(c);
    const n = Number(s);
    if (/^\p{Nd}$/u.test(s) && !isNaN(n)) return new PyFloat(n);
    const fr: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
    if (fr[s] !== undefined) return new PyFloat(fr[s]);
    if (d !== undefined) return d;
    throw valueError('not a numeric character');
  });
  mfn(m, 'digit', 'chr, default=, /', (c: any, d?: any) => {
    const s = asStr(c);
    if (/^\p{Nd}$/u.test(s)) return parseInt(s.normalize('NFKD'), 10);
    if (d !== undefined) return d;
    throw valueError('not a digit');
  });
  mfn(m, 'decimal', 'chr, default=, /', (c: any, d?: any) => {
    const s = asStr(c);
    if (/^\p{Nd}$/u.test(s)) return parseInt(s.normalize('NFKD'), 10);
    if (d !== undefined) return d;
    throw valueError('not a decimal');
  });
  mfn(m, 'east_asian_width', 'chr, /', (c: any) => {
    const cp = asStr(c).codePointAt(0)!;
    return (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1faff) ? 'W' : 'Na';
  });
  mfn(m, 'combining', 'chr, /', (c: any) => (/^\p{Mn}$/u.test(asStr(c)) ? 230 : 0));
  mfn(m, 'name', 'chr, default=, /', (c: any, d?: any) => {
    if (d !== undefined) return d;
    throw valueError('no such name');
  });
  m.dict!.set('unidata_version', '15.1.0');
  void I;
});

registerNative('_locale', (I: Interp, m: PyModule) => {
  mfn(m, 'setlocale', 'category, locale=, /', () => 'C');
  mfn(m, 'localeconv', '', () => {
    const d = new (require('../runtime/objects').PyDict)();
    d.set('decimal_point', '.');
    d.set('thousands_sep', '');
    d.set('grouping', new PyList([]));
    return d;
  });
  mconst(m, { LC_CTYPE: 0, LC_NUMERIC: 1, LC_TIME: 2, LC_COLLATE: 3, LC_MONETARY: 4, LC_MESSAGES: 5, LC_ALL: 6, CHAR_MAX: 127 });
  void I;
});

void [PyBytes, bytesType, PyBox, PyType, intBitLength, intSign];
