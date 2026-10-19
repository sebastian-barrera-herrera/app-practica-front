/**
 * Módulo `time` sobre el reloj virtual del intérprete (zona horaria siempre UTC).
 */
import { PyFloat, PyModule, PyProperty, PyTuple } from '../runtime/objects';
import { newNativeType, propertyType, tupleType } from '../runtime/builtin_types';
import { overflowError, typeError, valueError } from '../runtime/errors';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { asFloat } from '../runtime/util';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface Tm {
  year: number; mon: number; mday: number; hour: number; min: number; sec: number; wday: number; yday: number; isdst: number;
}

const F = (v: number): PyFloat => new PyFloat(v);

/** segundos desde la época → campos (UTC) */
export function gmtimeOf(secs: number): Tm {
  const d = new Date(Math.floor(secs) * 1000);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const yday = Math.floor((d.getTime() - start) / 86400000) + 1;
  return {
    year, mon: d.getUTCMonth() + 1, mday: d.getUTCDate(), hour: d.getUTCHours(), min: d.getUTCMinutes(), sec: d.getUTCSeconds(),
    wday: (d.getUTCDay() + 6) % 7, yday, isdst: 0,
  };
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function strftime(fmt: string, t: Tm): string {
  let out = '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    i++;
    if (i >= fmt.length) { out += '%'; break; }
    let d = fmt[i];
    if (d === '-' || d === '#') { /* indicador de glibc para quitar ceros */
      const flag = d;
      i++;
      d = fmt[i];
      const base = strftime('%' + d, t);
      out += flag === '-' ? base.replace(/^[0 ]+(?=\d)/, '') : base;
      continue;
    }
    switch (d) {
      case 'Y': out += String(t.year); break;
      case 'y': out += p2(((t.year % 100) + 100) % 100); break;
      case 'C': out += p2(Math.floor(t.year / 100)); break;
      case 'm': out += p2(t.mon); break;
      case 'd': out += p2(t.mday); break;
      case 'e': out += String(t.mday).padStart(2, ' '); break;
      case 'H': out += p2(t.hour); break;
      case 'I': out += p2(t.hour % 12 === 0 ? 12 : t.hour % 12); break;
      case 'l': out += String(t.hour % 12 === 0 ? 12 : t.hour % 12).padStart(2, ' '); break;
      case 'k': out += String(t.hour).padStart(2, ' '); break;
      case 'M': out += p2(t.min); break;
      case 'S': out += p2(t.sec); break;
      case 'p': out += t.hour < 12 ? 'AM' : 'PM'; break;
      case 'P': out += t.hour < 12 ? 'am' : 'pm'; break;
      case 'A': out += DAYS[t.wday]; break;
      case 'a': out += DAYS[t.wday].slice(0, 3); break;
      case 'B': out += MONTHS[t.mon - 1]; break;
      case 'b': case 'h': out += MONTHS[t.mon - 1].slice(0, 3); break;
      case 'j': out += String(t.yday).padStart(3, '0'); break;
      case 'w': out += String((t.wday + 1) % 7); break;
      case 'u': out += String(t.wday + 1); break;
      case 'U': out += p2(Math.floor((t.yday - 1 + 7 - ((t.wday + 1) % 7)) / 7)); break;
      case 'W': out += p2(Math.floor((t.yday - 1 + 7 - t.wday) / 7)); break;
      case 'Z': out += 'UTC'; break;
      case 'z': out += '+0000'; break;
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case '%': out += '%'; break;
      case 'c': out += strftime('%a %b %e %H:%M:%S %Y', t); break;
      case 'x': out += strftime('%m/%d/%y', t); break;
      case 'X': out += strftime('%H:%M:%S', t); break;
      case 'D': out += strftime('%m/%d/%y', t); break;
      case 'F': out += strftime('%Y-%m-%d', t); break;
      case 'T': out += strftime('%H:%M:%S', t); break;
      case 'R': out += strftime('%H:%M', t); break;
      case 'r': out += strftime('%I:%M:%S %p', t); break;
      case 's': out += String(Math.floor(Date.UTC(t.year, t.mon - 1, t.mday, t.hour, t.min, t.sec) / 1000)); break;
      case 'G': case 'g': case 'V': {
        const dt = new Date(Date.UTC(t.year, t.mon - 1, t.mday));
        const dayNum = (dt.getUTCDay() + 6) % 7;
        dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
        const isoYear = dt.getUTCFullYear();
        const firstThu = new Date(Date.UTC(isoYear, 0, 4));
        const wk = 1 + Math.round(((dt.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
        out += d === 'G' ? String(isoYear) : d === 'g' ? p2(isoYear % 100) : p2(wk);
        break;
      }
      default: out += '%' + d;
    }
  }
  return out;
}

const structTimeType = newNativeType('struct_time', 'time', [tupleType]);
const TM_FIELDS = ['tm_year', 'tm_mon', 'tm_mday', 'tm_hour', 'tm_min', 'tm_sec', 'tm_wday', 'tm_yday', 'tm_isdst'];

function makeStruct(t: Tm): PyTuple {
  return new PyTuple([t.year, t.mon, t.mday, t.hour, t.min, t.sec, t.wday, t.yday, t.isdst], structTimeType);
}

function tmOf(x: any): Tm {
  if (!(x instanceof PyTuple) || x.a.length < 9) throw typeError('Tuple or struct_time argument required');
  const n = x.a.map((v: any) => Number(ops.toIndex(v)));
  return { year: n[0], mon: n[1], mday: n[2], hour: n[3], min: n[4], sec: n[5], wday: n[6], yday: n[7], isdst: n[8] };
}

TM_FIELDS.forEach((f, i) => {
  const p = new PyProperty(propertyType);
  p.name = f;
  p.fget = mkNative(f, 'self', (s: any) => s.a[i], { method: true });
  structTimeType.dict!.set(f, p);
});
for (const [name, val] of [['tm_zone', 'UTC'], ['tm_gmtoff', 0]] as const) {
  const p = new PyProperty(propertyType);
  p.name = name;
  p.fget = mkNative(name, 'self', () => val, { method: true });
  structTimeType.dict!.set(name, p);
}
structTimeType.dict!.set('__new__', mkNative('__new__', 'cls, sequence', (cls: any, seq: any) => {
  const a = ops.iterToArray(seq);
  if (a.length < 9 || a.length > 11) throw typeError(`time.struct_time() takes an at least 9-sequence (${a.length}-sequence given)`);
  return new PyTuple(a.slice(0, 9), cls);
}, { owner: 'struct_time' }));
structTimeType.dict!.set('__repr__', mkNative('__repr__', 'self', (s: any) => `time.struct_time(${TM_FIELDS.map((f, i) => `${f}=${ops.repr(s.a[i])}`).join(', ')})`, { method: true }));
structTimeType.dict!.set('__reduce__', mkNative('__reduce__', 'self', (s: any) => new PyTuple([structTimeType, new PyTuple([new PyTuple(s.a.slice())])]), { method: true }));

registerNative('time', (I: Interp, m: PyModule) => {
  mconst(m, {
    struct_time: structTimeType, timezone: 0, altzone: 0, daylight: 0, tzname: new PyTuple(['UTC', 'UTC']),
  });
  mfn(m, 'time', '', () => F(I.readClock() / 1000));
  mfn(m, 'time_ns', '', () => BigInt(Math.floor(I.readClock() * 1e6)));
  mfn(m, 'sleep', 'secs, /', (s: any) => {
    const v = asFloat(s);
    if (v < 0) throw valueError('sleep length must be non-negative');
    I.advance(v * 1000);
    return null;
  });
  const perf = (): number => {
    I.perf += 0.000001;
    return I.perf + 1000;
  };
  for (const n of ['perf_counter', 'monotonic', 'process_time', 'thread_time']) mfn(m, n, '', () => F(perf()));
  for (const n of ['perf_counter_ns', 'monotonic_ns', 'process_time_ns', 'thread_time_ns']) mfn(m, n, '', () => BigInt(Math.floor(perf() * 1e9)));
  const secsArg = (s: any): number => {
    if (s === undefined || s === null) return Math.floor(I.readClock() / 1000);
    const v = asFloat(s);
    if (!isFinite(v)) throw overflowError('timestamp out of range for platform time_t');
    return Math.floor(v);
  };
  mfn(m, 'gmtime', 'secs=, /', (s?: any) => makeStruct(gmtimeOf(secsArg(s))));
  mfn(m, 'localtime', 'secs=, /', (s?: any) => makeStruct(gmtimeOf(secsArg(s))));
  mfn(m, 'mktime', 'tuple, /', (t: any) => {
    const x = tmOf(t);
    return F(Date.UTC(x.year, x.mon - 1, x.mday, x.hour, x.min, x.sec) / 1000);
  });
  mfn(m, 'strftime', 'format, tuple=, /', (f: any, t?: any) => {
    const tm = t === undefined ? gmtimeOf(Math.floor(I.readClock() / 1000)) : tmOf(t);
    if (tm.mon < 1 || tm.mon > 12) throw valueError('month out of range');
    if (tm.mday < 1 || tm.mday > 31) throw valueError('day of month out of range');
    return strftime(ops.strValue(f), tm);
  });
  mfn(m, 'asctime', 'tuple=, /', (t?: any) => {
    const tm = t === undefined ? gmtimeOf(Math.floor(I.readClock() / 1000)) : tmOf(t);
    return `${DAYS[tm.wday].slice(0, 3)} ${MONTHS[tm.mon - 1].slice(0, 3)} ${String(tm.mday).padStart(2, ' ')} ${p2(tm.hour)}:${p2(tm.min)}:${p2(tm.sec)} ${tm.year}`;
  });
  mfn(m, 'ctime', 'secs=, /', (s?: any) => {
    const tm = gmtimeOf(secsArg(s));
    return `${DAYS[tm.wday].slice(0, 3)} ${MONTHS[tm.mon - 1].slice(0, 3)} ${String(tm.mday).padStart(2, ' ')} ${p2(tm.hour)}:${p2(tm.min)}:${p2(tm.sec)} ${tm.year}`;
  });
  mfn(m, 'strptime', 'string, format=, /', (s: any, f?: any) => {
    const sp = (require('../runtime/modules') as typeof import('../runtime/modules')).importModule(I, '_strptime');
    return ops.callMethod(sp, '_strptime_time', f === undefined ? [s] : [s, f]);
  });
  mfn(m, 'get_clock_info', 'name, /', () => null);
  mfn(m, 'tzset', '', () => null);
});
