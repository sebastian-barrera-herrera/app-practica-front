/**
 * Formato de números y cadenas idéntico a CPython: repr de float, repr de str, mini-lenguaje de formato,
 * formato con `%`.
 */
import { valueError, typeError, overflowError } from './errors';

// ───────────────────────── float ─────────────────────────

/** dígitos más cortos que reproducen el double (como repr de CPython) y exponente decimal (decpt) */
export function shortestDigits(v: number): { digits: string; decpt: number } {
  const s = Math.abs(v).toExponential();
  const ePos = s.indexOf('e');
  const mant = s.slice(0, ePos).replace('.', '');
  const exp = parseInt(s.slice(ePos + 1), 10);
  return { digits: mant, decpt: exp + 1 };
}

export function floatRepr(v: number): string {
  if (v !== v) return 'nan';
  if (v === Infinity) return 'inf';
  if (v === -Infinity) return '-inf';
  if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
  const { digits, decpt } = shortestDigits(v);
  const sign = v < 0 ? '-' : '';
  if (decpt > 16 || decpt < -3) {
    const e = decpt - 1;
    const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    return sign + mant + 'e' + (e < 0 ? '-' : '+') + (Math.abs(e) < 10 ? '0' : '') + Math.abs(e);
  }
  if (decpt <= 0) return sign + '0.' + '0'.repeat(-decpt) + digits;
  if (decpt >= digits.length) return sign + digits + '0'.repeat(decpt - digits.length) + '.0';
  return sign + digits.slice(0, decpt) + '.' + digits.slice(decpt);
}

/** descompone un double finito no negativo en mantisa entera y exponente binario: x = m * 2^e */
export function decompose(x: number): { m: bigint; e: number } {
  if (x === 0) return { m: 0n, e: 0 };
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  const lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) {
    e = -1074;
  } else {
    m |= 1n << 52n;
    e = expBits - 1075;
  }
  return { m, e };
}

/** divide n entre d redondeando half-even (n, d > 0) */
function divRoundHalfEven(n: bigint, d: bigint): bigint {
  const q = n / d;
  const r = n - q * d;
  const twice = r * 2n;
  if (twice > d) return q + 1n;
  if (twice < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

/** x ≥ 0 finito → entero redondeado de x·10^f (half-even exacto) */
export function scaledRound(x: number, f: number): bigint {
  const { m, e } = decompose(x);
  // x * 10^f = m * 2^e * 10^f
  let num = m;
  let den = 1n;
  if (e >= 0) num <<= BigInt(e);
  else den <<= BigInt(-e);
  if (f >= 0) num *= 10n ** BigInt(f);
  else den *= 10n ** BigInt(-f);
  return divRoundHalfEven(num, den);
}

/** formato 'f' exacto: x ≥ 0 finito */
export function fixedStr(x: number, prec: number): string {
  const n = scaledRound(x, prec);
  let s = n.toString();
  if (prec === 0) return s;
  if (s.length <= prec) s = '0'.repeat(prec - s.length + 1) + s;
  return s.slice(0, s.length - prec) + '.' + s.slice(s.length - prec);
}

/** dígitos significativos exactos: devuelve (dígitos de longitud p, decpt) redondeando half-even */
function sigDigits(x: number, p: number): { digits: string; decpt: number } {
  if (x === 0) return { digits: '0'.repeat(p), decpt: 1 };
  // estimar el exponente decimal
  let dec = Math.floor(Math.log10(x));
  // n = round(x * 10^(p-1-dec))
  for (let attempt = 0; attempt < 3; attempt++) {
    const n = scaledRound(x, p - 1 - dec);
    const s = n.toString();
    if (s.length === p) return { digits: s, decpt: dec + 1 };
    if (s.length > p) dec++;
    else dec--;
  }
  const n = scaledRound(x, p - 1 - dec);
  return { digits: n.toString().slice(0, p), decpt: dec + 1 };
}

/** formato 'e' exacto */
export function expStr(x: number, prec: number, upper = false): string {
  const { digits, decpt } = sigDigits(x, prec + 1);
  const e = x === 0 ? 0 : decpt - 1;
  const mant = prec > 0 ? digits[0] + '.' + digits.slice(1) : digits;
  const r = mant + 'e' + (e < 0 ? '-' : '+') + (Math.abs(e) < 10 ? '0' : '') + Math.abs(e);
  return upper ? r.toUpperCase() : r;
}

/** formato 'g' (p ≥ 1). `alt` conserva ceros finales. `addDot0` fuerza ".0" si no hay parte decimal (formato por defecto). */
export function generalStr(x: number, p: number, alt = false, upper = false): string {
  if (p === 0) p = 1;
  const { digits, decpt } = sigDigits(x, p);
  const exp = x === 0 ? 0 : decpt - 1;
  let out: string;
  if (exp < -4 || exp >= p) {
    let d = digits;
    if (!alt) d = d.replace(/0+$/, '');
    if (d === '') d = '0';
    const mant = d.length > 1 ? d[0] + '.' + d.slice(1) : alt ? d + '.' : d;
    out = mant + 'e' + (exp < 0 ? '-' : '+') + (Math.abs(exp) < 10 ? '0' : '') + Math.abs(exp);
  } else if (decpt <= 0) {
    out = '0.' + '0'.repeat(-decpt) + digits;
    if (!alt) out = out.replace(/0+$/, '').replace(/\.$/, '');
  } else if (decpt >= digits.length) {
    out = digits + '0'.repeat(decpt - digits.length);
    if (alt) out += '.';
  } else {
    out = digits.slice(0, decpt) + '.' + digits.slice(decpt);
    if (!alt) out = out.replace(/0+$/, '').replace(/\.$/, '');
  }
  return upper ? out.toUpperCase() : out;
}

// ───────────────────────── str ─────────────────────────

let nonPrintRe: RegExp | null = null;
try {
  nonPrintRe = new RegExp('[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}\\p{Zs}]', 'u');
} catch {
  nonPrintRe = null;
}

export function isPrintableCp(cp: number): boolean {
  if (cp < 128) return cp >= 32 && cp < 127;
  if (nonPrintRe) return !nonPrintRe.test(String.fromCodePoint(cp));
  return !(cp >= 0x80 && cp <= 0xa0) && cp !== 0xad && !(cp >= 0x2000 && cp <= 0x200f) && !(cp >= 0x2028 && cp <= 0x202f);
}

export function strRepr(s: string): string {
  let quote = "'";
  if (s.indexOf("'") >= 0 && s.indexOf('"') < 0) quote = '"';
  let out = quote;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92) out += '\\\\';
    else if (c === quote.charCodeAt(0)) out += '\\' + quote;
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 32 || c === 127) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c < 127) out += s[i];
    else {
      let cp = c;
      let ch = s[i];
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          cp = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
          ch = s.slice(i, i + 2);
          i++;
        }
      }
      if (isPrintableCp(cp)) out += ch;
      else if (cp < 0x100) out += '\\x' + cp.toString(16).padStart(2, '0');
      else if (cp < 0x10000) out += '\\u' + cp.toString(16).padStart(4, '0');
      else out += '\\U' + cp.toString(16).padStart(8, '0');
    }
  }
  return out + quote;
}

export function asciiOf(r: string): string {
  let out = '';
  for (let i = 0; i < r.length; i++) {
    const c = r.charCodeAt(i);
    if (c < 128) out += r[i];
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < r.length) {
      const cp = (c - 0xd800) * 0x400 + (r.charCodeAt(i + 1) - 0xdc00) + 0x10000;
      out += '\\U' + cp.toString(16).padStart(8, '0');
      i++;
    } else if (c < 0x100) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += '\\u' + c.toString(16).padStart(4, '0');
  }
  return out;
}

export function bytesRepr(b: ArrayLike<number>): string {
  let hasSingle = false;
  let hasDouble = false;
  for (let i = 0; i < b.length; i++) {
    if (b[i] === 39) hasSingle = true;
    else if (b[i] === 34) hasDouble = true;
  }
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let out = 'b' + quote;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 92) out += '\\\\';
    else if (c === quote.charCodeAt(0)) out += '\\' + quote;
    else if (c === 9) out += '\\t';
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c < 32 || c >= 127) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += String.fromCharCode(c);
  }
  return out + quote;
}

// ───────────────────────── enteros ─────────────────────────

export function bigAbs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

export function intToBase(v: number | bigint, base: number): string {
  if (typeof v === 'number') return v.toString(base);
  return v.toString(base);
}

// ───────────────────────── mini-lenguaje de formato ─────────────────────────

export interface FormatSpec {
  fill: string;
  align: string; // '' | '<' | '>' | '^' | '='
  sign: string; // '' | '+' | '-' | ' '
  z: boolean;
  alt: boolean;
  zero: boolean;
  width: number; // -1 si no hay
  grouping: string; // '' | ',' | '_'
  precision: number; // -1 si no hay
  type: string;
}

export function parseSpec(spec: string, typeName: string): FormatSpec {
  const r: FormatSpec = { fill: ' ', align: '', sign: '', z: false, alt: false, zero: false, width: -1, grouping: '', precision: -1, type: '' };
  const cps = Array.from(spec);
  let i = 0;
  const n = cps.length;
  const isAlign = (c: string | undefined) => c === '<' || c === '>' || c === '^' || c === '=';
  if (n >= 2 && isAlign(cps[1])) {
    r.fill = cps[0];
    r.align = cps[1];
    i = 2;
  } else if (n >= 1 && isAlign(cps[0])) {
    r.align = cps[0];
    i = 1;
  }
  if (cps[i] === '+' || cps[i] === '-' || cps[i] === ' ') { r.sign = cps[i]; i++; }
  if (cps[i] === 'z') { r.z = true; i++; }
  if (cps[i] === '#') { r.alt = true; i++; }
  if (cps[i] === '0') {
    r.zero = true;
    i++;
  }
  let w = '';
  while (i < n && cps[i] >= '0' && cps[i] <= '9') w += cps[i++];
  if (w !== '') r.width = parseInt(w, 10);
  if (cps[i] === ',' || cps[i] === '_') {
    r.grouping = cps[i];
    i++;
    if (cps[i] === ',' || cps[i] === '_') {
      throw valueError("Cannot specify both ',' and '_'.");
    }
  }
  if (cps[i] === '.') {
    i++;
    let p = '';
    while (i < n && cps[i] >= '0' && cps[i] <= '9') p += cps[i++];
    if (p === '') throw valueError('Format specifier missing precision');
    r.precision = parseInt(p, 10);
  }
  if (i < n - 1) throw valueError(`Invalid format specifier '${spec}' for object of type '${typeName}'`);
  if (i === n - 1) r.type = cps[i];
  return r;
}

function groupDigits(digits: string, sep: string, size: number): string {
  if (digits.length <= size) return digits;
  const parts: string[] = [];
  let i = digits.length;
  while (i > size) {
    parts.unshift(digits.slice(i - size, i));
    i -= size;
  }
  parts.unshift(digits.slice(0, i));
  return parts.join(sep);
}

/** aplica relleno/alineación: `sign`+`prefix`+`body` con padding según la especificación */
function pad(sp: FormatSpec, sign: string, prefix: string, body: string, defaultAlign: string): string {
  let align = sp.align || defaultAlign;
  let fill = sp.fill;
  if (sp.zero && !sp.align) {
    align = '=';
    fill = '0';
  }
  const len = Array.from(sign + prefix + body).length;
  if (sp.width <= len) return sign + prefix + body;
  const padN = sp.width - len;
  switch (align) {
    case '<': return sign + prefix + body + fill.repeat(padN);
    case '^': {
      const left = Math.floor(padN / 2);
      return fill.repeat(left) + sign + prefix + body + fill.repeat(padN - left);
    }
    case '=': return sign + prefix + fill.repeat(padN) + body;
    default: return fill.repeat(padN) + sign + prefix + body;
  }
}

/** Formato con relleno cuando la agrupación está activa y se usa relleno con ceros */
function zeroPadGrouped(sp: FormatSpec, sign: string, prefix: string, intDigits: string, rest: string, groupSize: number): string {
  // con '0' y agrupación, el relleno de ceros también se agrupa
  const target = sp.width - sign.length - prefix.length - rest.length;
  let digits = intDigits;
  const sep = sp.grouping;
  let grouped = groupDigits(digits, sep, groupSize);
  while (grouped.length < target) {
    digits = '0' + digits;
    grouped = groupDigits(digits, sep, groupSize);
    if (grouped.length === target - 1 && grouped[0] === sep) { grouped = '0' + grouped; }
  }
  return sign + prefix + grouped + rest;
}

export function formatStr(s: string, spec: string): string {
  if (spec === '') return s;
  const sp = parseSpec(spec, 'str');
  if (sp.type !== '' && sp.type !== 's') throw valueError(`Unknown format code '${sp.type}' for object of type 'str'`);
  if (sp.sign !== '') throw valueError('Sign not allowed in string format specifier');
  if (sp.alt) throw valueError('Alternate form (#) not allowed in string format specifier');
  if (sp.align === '=') throw valueError("'=' alignment not allowed in string format specifier");
  if (sp.grouping !== '') throw valueError(`Cannot specify '${sp.grouping}' with 's'.`);
  if (sp.precision >= 0) s = Array.from(s).slice(0, sp.precision).join('');
  const sp2 = { ...sp, zero: sp.zero && !!sp.align };
  if (sp.zero && !sp.align) { sp2.fill = '0'; sp2.align = '<'; sp2.zero = false; }
  return pad(sp2, '', '', s, '<');
}

export function formatInt(v: number | bigint, spec: string, typeName = 'int'): string {
  const sp = parseSpec(spec, typeName);
  const t = sp.type;
  if (t === 'e' || t === 'E' || t === 'f' || t === 'F' || t === 'g' || t === 'G' || t === '%') {
    return formatFloat(typeof v === 'bigint' ? bigToDouble(v) : v, spec);
  }
  if (t !== '' && 'bcdoxXn'.indexOf(t) < 0) throw valueError(`Unknown format code '${t}' for object of type '${typeName}'`);
  if (sp.precision >= 0) throw valueError('Precision not allowed in integer format specifier');
  if (t === 'c') {
    if (sp.sign !== '') throw valueError("Sign not allowed with integer format specifier 'c'");
    if (sp.alt) throw valueError("Alternate form (#) not allowed with integer format specifier 'c'");
    if (sp.grouping !== '') throw valueError("Cannot specify ',' with 'c'.");
    const cp = Number(v);
    if (cp < 0 || cp > 0x10ffff) throw overflowError('%c arg not in range(0x110000)');
    return pad(sp, '', '', String.fromCodePoint(cp), '<');
  }
  const neg = typeof v === 'bigint' ? v < 0n : v < 0;
  const abs = typeof v === 'bigint' ? bigAbs(v) : Math.abs(v);
  let digits: string;
  let prefix = '';
  let groupSize = 3;
  switch (t) {
    case 'b': digits = abs.toString(2); prefix = sp.alt ? '0b' : ''; groupSize = 4; break;
    case 'o': digits = abs.toString(8); prefix = sp.alt ? '0o' : ''; groupSize = 4; break;
    case 'x': digits = abs.toString(16); prefix = sp.alt ? '0x' : ''; groupSize = 4; break;
    case 'X': digits = abs.toString(16).toUpperCase(); prefix = sp.alt ? '0X' : ''; groupSize = 4; break;
    default: digits = abs.toString(10);
  }
  if (sp.grouping === ',' && (t === 'b' || t === 'o' || t === 'x' || t === 'X')) throw valueError(`Cannot specify ',' with '${t}'.`);
  const sign = neg ? '-' : sp.sign === '+' ? '+' : sp.sign === ' ' ? ' ' : '';
  if (sp.grouping !== '') {
    if (sp.zero && !sp.align && sp.width > 0) return zeroPadGrouped(sp, sign, prefix, digits, '', groupSize);
    digits = groupDigits(digits, sp.grouping, groupSize);
  }
  return pad(sp, sign, prefix, digits, '>');
}

export function bigToDouble(v: bigint): number {
  const d = Number(v);
  if (!isFinite(d)) throw overflowError('int too large to convert to float');
  return d;
}

export function formatFloat(x: number, spec: string, typeName = 'float'): string {
  const sp = parseSpec(spec, typeName);
  let t = sp.type;
  if (t !== '' && 'eEfFgGn%'.indexOf(t) < 0) {
    throw valueError(`Unknown format code '${t}' for object of type '${typeName}'`);
  }
  if (sp.alt === true && false) { /* '#' admitido */ }
  let neg = x < 0 || Object.is(x, -0);
  let body: string;
  let suffix = '';
  const upper = t === 'E' || t === 'F' || t === 'G';
  if (x !== x) {
    body = upper ? 'NAN' : 'nan';
    neg = false;
  } else if (x === Infinity || x === -Infinity) {
    body = upper ? 'INF' : 'inf';
  } else {
    const a = Math.abs(x);
    if (t === '%') {
      const p = sp.precision >= 0 ? sp.precision : 6;
      body = fixedStr(a * 100 === Infinity ? a : scaleBy100(a, p), p);
      suffix = '%';
    } else if (t === 'f' || t === 'F') {
      const p = sp.precision >= 0 ? sp.precision : 6;
      body = fixedStr(a, p);
      if (sp.alt && p === 0) body += '.';
    } else if (t === 'e' || t === 'E') {
      const p = sp.precision >= 0 ? sp.precision : 6;
      body = expStr(a, p, t === 'E');
      if (sp.alt && p === 0) body = body.replace('e', '.e').replace('E', '.E');
    } else if (t === 'g' || t === 'G') {
      const p = sp.precision >= 0 ? sp.precision : 6;
      body = generalStr(a, p, sp.alt, t === 'G');
    } else if (t === 'n') {
      const p = sp.precision >= 0 ? sp.precision : 6;
      body = generalStr(a, p, sp.alt, false);
    } else {
      // sin tipo: como repr si no hay precisión; si la hay, como 'g' con ".0" si es entero
      if (sp.precision < 0) {
        body = floatRepr(a);
      } else {
        const p = sp.precision === 0 ? 1 : sp.precision;
        body = generalStr(a, p, sp.alt, false);
        if (/^\d+$/.test(body) && true) body += '.0';
        else if (/^\d+e/.test(body)) body = body;
      }
    }
  }
  if (sp.z && /^0*\.?0*([eE][+-]?\d+)?%?$/.test(body + suffix) ) neg = false;
  const sign = neg ? '-' : sp.sign === '+' ? '+' : sp.sign === ' ' ? ' ' : '';
  if (sp.grouping !== '' && isFinite(x)) {
    const m = /^(\d+)(.*)$/.exec(body);
    if (m) {
      if (sp.zero && !sp.align && sp.width > 0) return zeroPadGrouped(sp, sign, '', m[1], m[2] + suffix, 3);
      body = groupDigits(m[1], sp.grouping, 3) + m[2];
    }
  }
  t = '';
  return pad(sp, sign, '', body + suffix, '>');
}

/** a * 100 con la precisión necesaria para formatear porcentajes (escala exacta mediante decimal) */
function scaleBy100(a: number, _p: number): number {
  return a * 100;
}

// ───────────────────────── formato con % ─────────────────────────

export interface PercentHost {
  str(x: any): string;
  repr(x: any): string;
  ascii(x: any): string;
  toInt(x: any, fmt: string): number | bigint;
  toFloat(x: any, fmt: string): number;
  isMapping(x: any): boolean;
  getitem(m: any, k: any): any;
  typeName(x: any): string;
  isTuple(x: any): boolean;
  tupleItems(x: any): any[];
  isStr(x: any): boolean;
  isIntLike(x: any): boolean;
}

export function percentFormat(fmt: string, args: any, host: PercentHost): string {
  let out = '';
  const isTuple = host.isTuple(args);
  const list: any[] = isTuple ? host.tupleItems(args) : [args];
  let ai = 0;
  let usedMapping = false;
  const n = fmt.length;
  let i = 0;
  const nextArg = (): any => {
    if (ai >= list.length) throw typeError('not enough arguments for format string');
    return list[ai++];
  };
  while (i < n) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }
    i++;
    if (i >= n) throw valueError('incomplete format');
    let key: string | null = null;
    if (fmt[i] === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        if (fmt[j] === '(') depth++;
        else if (fmt[j] === ')') depth--;
        j++;
      }
      if (depth > 0) throw valueError('incomplete format key');
      key = fmt.slice(i + 1, j - 1);
      i = j;
      usedMapping = true;
    }
    let left = false, plus = false, space = false, alt = false, zero = false;
    for (; i < n; i++) {
      const f = fmt[i];
      if (f === '-') left = true;
      else if (f === '+') plus = true;
      else if (f === ' ') space = true;
      else if (f === '#') alt = true;
      else if (f === '0') zero = true;
      else break;
    }
    let width = -1;
    if (fmt[i] === '*') {
      const w = host.toInt(nextArg(), '*');
      width = Number(w);
      if (width < 0) { left = true; width = -width; }
      i++;
    } else {
      let w = '';
      while (i < n && fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
      if (w) width = parseInt(w, 10);
    }
    let prec = -1;
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') {
        prec = Number(host.toInt(nextArg(), '*'));
        if (prec < 0) prec = 0;
        i++;
      } else {
        let p = '';
        while (i < n && fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
        prec = p ? parseInt(p, 10) : 0;
      }
    }
    while (i < n && (fmt[i] === 'l' || fmt[i] === 'h' || fmt[i] === 'L')) i++;
    if (i >= n) throw valueError('incomplete format');
    const conv = fmt[i];
    i++;
    if (conv === '%') { out += '%'; continue; }
    let arg: any;
    if (key !== null) {
      if (!host.isMapping(args)) throw typeError('format requires a mapping');
      arg = host.getitem(args, key);
    } else arg = nextArg();
    let sign = '';
    let body: string;
    let numeric = false;
    switch (conv) {
      case 's': body = host.str(arg); if (prec >= 0) body = Array.from(body).slice(0, prec).join(''); break;
      case 'r': body = host.repr(arg); if (prec >= 0) body = Array.from(body).slice(0, prec).join(''); break;
      case 'a': body = host.ascii(arg); if (prec >= 0) body = Array.from(body).slice(0, prec).join(''); break;
      case 'c': {
        if (host.isStr(arg)) {
          if (Array.from(arg as string).length !== 1) throw typeError('%c requires an int or a unicode character, not str');
          body = arg;
        } else if (host.isIntLike(arg)) {
          const cp = Number(host.toInt(arg, 'c'));
          if (cp < 0 || cp > 0x10ffff) throw overflowError('%c arg not in range(0x110000)');
          body = String.fromCodePoint(cp);
        } else throw typeError(`%c requires an int or a unicode character, not ${host.typeName(arg)}`);
        break;
      }
      case 'd': case 'i': case 'u': {
        numeric = true;
        let v = host.toInt(arg, conv);
        const neg = typeof v === 'bigint' ? v < 0n : v < 0;
        let digits = (typeof v === 'bigint' ? bigAbs(v) : Math.abs(v)).toString();
        if (prec >= 0) digits = digits.padStart(prec, '0');
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        v = 0;
        break;
      }
      case 'x': case 'X': case 'o': {
        numeric = true;
        const v = host.toInt(arg, conv);
        const neg = typeof v === 'bigint' ? v < 0n : v < 0;
        const base = conv === 'o' ? 8 : 16;
        let digits = (typeof v === 'bigint' ? bigAbs(v) : Math.abs(v)).toString(base);
        if (conv === 'X') digits = digits.toUpperCase();
        if (prec >= 0) digits = digits.padStart(prec, '0');
        if (alt) digits = (conv === 'o' ? '0o' : conv === 'x' ? '0x' : '0X') + digits;
        sign = neg ? '-' : plus ? '+' : space ? ' ' : '';
        body = digits;
        break;
      }
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
        numeric = true;
        const x = host.toFloat(arg, conv);
        const neg = x < 0 || Object.is(x, -0);
        const a = Math.abs(x);
        const p = prec >= 0 ? prec : 6;
        if (x !== x) body = conv === conv.toUpperCase() ? 'NAN' : 'nan';
        else if (a === Infinity) body = conv === conv.toUpperCase() ? 'INF' : 'inf';
        else if (conv === 'f' || conv === 'F') { body = fixedStr(a, p); if (alt && p === 0) body += '.'; }
        else if (conv === 'e' || conv === 'E') body = expStr(a, p, conv === 'E');
        else body = generalStr(a, p, alt, conv === 'G');
        sign = neg && x === x ? '-' : plus ? '+' : space ? ' ' : '';
        if (x !== x) sign = plus ? '+' : space ? ' ' : '';
        break;
      }
      default: {
        const hex = conv.codePointAt(0)!.toString(16);
        throw valueError(`unsupported format character '${conv}' (0x${hex}) at index ${i - 1}`);
      }
    }
    const total = sign.length + Array.from(body).length;
    if (width > total) {
      const padN = width - total;
      if (left) out += sign + body + ' '.repeat(padN);
      else if (zero && numeric && isFinite(parseFloat(body) || 0) && !/^(nan|inf)/i.test(body)) {
        // los ceros van tras el signo (y tras 0x/0o)
        const m = /^(0[xXoO])?(.*)$/.exec(body)!;
        out += sign + (m[1] || '') + '0'.repeat(padN) + m[2];
      } else out += ' '.repeat(padN) + sign + body;
    } else out += sign + body;
  }
  if (ai < list.length && !usedMapping) {
    if (!(isTuple === false && list.length === 1 && host.isMapping(args))) throw typeError('not all arguments converted during string formatting');
  }
  return out;
}
