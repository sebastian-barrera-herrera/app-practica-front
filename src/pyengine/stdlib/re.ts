/**
 * Módulo `re`: traduce la sintaxis de expresiones regulares de Python a `RegExp` de JavaScript y ofrece la API
 * de `Pattern`/`Match` de CPython.
 */
import {
  PyBox, PyBytes, PyDict, PyList, PyModule, PyObject, PyProperty, PyTuple, PyType, F_BASETYPE, type Kw,
} from '../runtime/objects';
import {
  NotImplemented, bytesType, intType, mappingProxyType, newNativeType, objectType, propertyType, typeOf,
} from '../runtime/builtin_types';
import { E } from '../runtime/exc_types';
import { indexError, makeExc, typeError, valueError } from '../runtime/errors';
import { callObj } from '../runtime/call';
import * as ops from '../runtime/ops';
import type { Interp } from '../runtime/interp';
import { decodeUtf8 } from '../runtime/interp';
import { mkNative } from '../runtime/native';
import { registerNative } from './registry';
import { mconst, mfn } from './helpers';
import { asIdx, kwMap, tupleArr } from '../runtime/util';
import { cpIndexOf, hasAstral, utf16IndexOf } from '../runtime/pystr';
import { strRepr } from '../runtime/fmt';

// ───────────────────────── banderas ─────────────────────────

const FLAGS: [string, number, string[]][] = [
  ['NOFLAG', 0, ['NOFLAG']],
  ['TEMPLATE', 1, ['T', 'TEMPLATE']],
  ['IGNORECASE', 2, ['I', 'IGNORECASE']],
  ['LOCALE', 4, ['L', 'LOCALE']],
  ['MULTILINE', 8, ['M', 'MULTILINE']],
  ['DOTALL', 16, ['S', 'DOTALL']],
  ['UNICODE', 32, ['U', 'UNICODE']],
  ['VERBOSE', 64, ['X', 'VERBOSE']],
  ['DEBUG', 128, ['DEBUG']],
  ['ASCII', 256, ['A', 'ASCII']],
];
const F_I = 2;
const F_M = 8;
const F_S = 16;
const F_U = 32;
const F_X = 64;
const F_A = 256;

export class ReError extends Error {
  constructor(public msg: string, public pos: number | null = null) {
    super(msg);
  }
}

// ───────────────────────── traducción del patrón ─────────────────────────

interface Compiled {
  source: string;
  groups: number;
  names: Map<string, number>;
  flags: number;
}

const W = '\\p{L}\\p{N}_';
const WS = '\\s\\x1c-\\x1f\\x85';

function escLit(c: string): string {
  return /[\^$\\.*+?()[\]{}|\/]/.test(c) ? '\\' + c : c;
}

function parseQuantBrace(p: string, i: number): { text: string; end: number } | null {
  // `{m}`, `{m,}`, `{,n}`, `{m,n}`
  const m = /^\{(\d*)(?:(,)(\d*))?\}/.exec(p.slice(i));
  if (!m) return null;
  if (m[1] === '' && (m[2] === undefined || m[3] === '' && m[2] !== undefined) && m[2] === undefined) return null;
  if (m[1] === '' && m[2] === undefined) return null;
  const lo = m[1] === '' ? '0' : m[1];
  let text: string;
  if (m[2] === undefined) text = `{${lo}}`;
  else text = `{${lo},${m[3] ?? ''}}`;
  if (m[1] === '' && m[2] !== undefined && m[3] === '') text = '{0,}';
  return { text, end: i + m[0].length };
}

function translate(pattern: string, flags: number): Compiled {
  let f = flags;
  // banderas globales al comienzo `(?aiLmsux)`
  let src = pattern;
  for (;;) {
    const m = /^\(\?([aiLmsux]+)\)/.exec(src);
    if (!m) break;
    for (const c of m[1]) {
      f |= { a: F_A, i: F_I, L: 4, m: F_M, s: F_S, u: F_U, x: F_X }[c as 'a'] ?? 0;
    }
    src = src.slice(m[0].length);
  }
  const verbose = (f & F_X) !== 0;
  const multi = (f & F_M) !== 0;
  const dotall = (f & F_S) !== 0;
  const ascii = (f & F_A) !== 0;
  const d = ascii ? '0-9' : '\\p{Nd}';
  const w = ascii ? 'a-zA-Z0-9_' : W;
  const s = ascii ? ' \\t\\n\\r\\f\\v' : WS;
  let out = '';
  let groups = 0;
  const names = new Map<string, number>();
  const open: { type: string; pos: number }[] = [];
  let i = 0;
  const n = src.length;
  let lastAtom = false; // ¿hay algo repetible justo antes?
  let lastQuant = false;
  const err = (msg: string, pos: number): never => {
    throw new ReError(msg, pos);
  };
  const classEscape = (c: string, pos: number): string => {
    switch (c) {
      case 'd': return d;
      case 's': return s;
      case 'w': return w;
      case 'D': case 'S': case 'W': return '';
      case 'n': return '\\n';
      case 't': return '\\t';
      case 'r': return '\\r';
      case 'f': return '\\f';
      case 'v': return '\\v';
      case 'a': return '\\x07';
      case 'b': return '\\x08';
      case '\\': return '\\\\';
      default: break;
    }
    return '';
  };
  const wordB = `(?<=[${w}])`;
  while (i < n) {
    const c = src[i];
    if (verbose && /\s/.test(c)) { i++; continue; }
    if (verbose && c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    switch (c) {
      case '\\': {
        const e = src[i + 1];
        if (e === undefined) return err('bad escape (end of pattern)', i);
        const pos = i;
        i += 2;
        lastAtom = true;
        lastQuant = false;
        if (/[1-9]/.test(e)) {
          let num = e;
          while (i < n && /\d/.test(src[i]) && num.length < 2) num += src[i++];
          const k = parseInt(num, 10);
          if (k > groups) return err(`invalid group reference ${k}`, pos + 1);
          out += `(?:\\${k})`;
          break;
        }
        switch (e) {
          case 'd': out += `[${d}]`; break;
          case 'D': out += `[^${d}]`; break;
          case 'w': out += `[${w}]`; break;
          case 'W': out += `[^${w}]`; break;
          case 's': out += `[${s}]`; break;
          case 'S': out += `[^${s}]`; break;
          case 'b': out += `(?:(?<=[${w}])(?![${w}])|(?<![${w}])(?=[${w}]))`; lastAtom = false; break;
          case 'B': out += `(?:(?<=[${w}])(?=[${w}])|(?<![${w}])(?![${w}]))`; lastAtom = false; break;
          case 'A': out += '(?<![\\s\\S])'; lastAtom = false; break;
          case 'Z': out += '(?![\\s\\S])'; lastAtom = false; break;
          case 'n': out += '\\n'; break;
          case 't': out += '\\t'; break;
          case 'r': out += '\\r'; break;
          case 'f': out += '\\f'; break;
          case 'v': out += '\\v'; break;
          case 'a': out += '\\x07'; break;
          case '0': {
            let oct = '';
            while (i < n && /[0-7]/.test(src[i]) && oct.length < 2) oct += src[i++];
            out += `\\u{${parseInt('0' + oct, 8).toString(16)}}`;
            break;
          }
          case 'x': {
            const h = /^[0-9a-fA-F]{2}/.exec(src.slice(i));
            if (!h) return err(`incomplete escape \\x${src.slice(i, i + 2)}`, pos);
            out += `\\x${h[0]}`;
            i += 2;
            break;
          }
          case 'u': {
            const h = /^[0-9a-fA-F]{4}/.exec(src.slice(i));
            if (!h) return err(`incomplete escape \\u${src.slice(i, i + 4)}`, pos);
            out += `\\u${h[0]}`;
            i += 4;
            break;
          }
          case 'U': {
            const h = /^[0-9a-fA-F]{8}/.exec(src.slice(i));
            if (!h) return err(`incomplete escape \\U${src.slice(i, i + 8)}`, pos);
            out += `\\u{${parseInt(h[0], 16).toString(16)}}`;
            i += 8;
            break;
          }
          default:
            if (/[A-Za-z0-9]/.test(e)) return err(`bad escape \\${e}`, pos);
            out += escLit(e);
        }
        break;
      }
      case '[': {
        const start = i;
        i++;
        let neg = false;
        let body = '';
        if (src[i] === '^') { neg = true; i++; }
        let first = true;
        let closed = false;
        let prevAtom: string | null = null;
        const extras: string[] = [];
        while (i < n) {
          let ch = src[i];
          if (ch === ']' && !first) { closed = true; i++; break; }
          first = false;
          let item: string;
          let single: string | null = null;
          if (ch === '\\') {
            const e = src[i + 1];
            if (e === undefined) return err('bad escape (end of pattern)', i);
            const pos = i;
            i += 2;
            const ce = classEscape(e, pos);
            if (e === 'D' || e === 'S' || e === 'W') {
              extras.push(e === 'D' ? `[^${d}]` : e === 'S' ? `[^${s}]` : `[^${w}]`);
              continue;
            }
            if (ce !== '') {
              item = ce;
              if (/^[ntrfv]$/.test(e)) single = ({ n: '\n', t: '\t', r: '\r', f: '\f', v: '\v' } as Record<string, string>)[e];
              else if (e === 'a') single = '\x07';
              else if (e === 'b') single = '\b';
              else if (e === '\\') single = '\\';
            } else if (/[0-7]/.test(e)) {
              let oct = e;
              while (i < n && /[0-7]/.test(src[i]) && oct.length < 3) oct += src[i++];
              single = String.fromCodePoint(parseInt(oct, 8));
              item = `\\u{${single.codePointAt(0)!.toString(16)}}`;
            } else if (e === 'x') {
              const h = /^[0-9a-fA-F]{2}/.exec(src.slice(i))!;
              if (!h) return err(`incomplete escape \\x${src.slice(i, i + 2)}`, pos);
              single = String.fromCodePoint(parseInt(h[0], 16));
              item = `\\x${h[0]}`;
              i += 2;
            } else if (e === 'u') {
              const h = /^[0-9a-fA-F]{4}/.exec(src.slice(i));
              if (!h) return err(`incomplete escape \\u${src.slice(i, i + 4)}`, pos);
              single = String.fromCodePoint(parseInt(h[0], 16));
              item = `\\u${h[0]}`;
              i += 4;
            } else if (/[A-Za-z0-9]/.test(e)) {
              return err(`bad escape \\${e}`, pos);
            } else {
              single = e;
              item = /[\\\]\[\^\-]/.test(e) ? '\\' + e : e;
            }
          } else {
            single = String.fromCodePoint(src.codePointAt(i)!);
            i += single.length;
            item = /[\\\]\[\^\-]/.test(single) ? '\\' + single : single;
            ch = single;
          }
          // rango a-b
          if (single !== null && src[i] === '-' && src[i + 1] !== undefined && src[i + 1] !== ']') {
            i++;
            let hi: string;
            let hiItem: string;
            if (src[i] === '\\') {
              const e = src[i + 1];
              const pos = i;
              i += 2;
              const m2 = classEscape(e, pos);
              if (m2 !== '' && /^[dsw]$/.test(e)) return err(`bad character range ${single}-\\${e}`, start);
              if (/^[ntrfv]$/.test(e)) hi = ({ n: '\n', t: '\t', r: '\r', f: '\f', v: '\v' } as Record<string, string>)[e];
              else if (e === 'a') hi = '\x07';
              else if (e === 'x') { const h = /^[0-9a-fA-F]{2}/.exec(src.slice(i))!; hi = String.fromCodePoint(parseInt(h[0], 16)); i += 2; }
              else if (e === 'u') { const h = /^[0-9a-fA-F]{4}/.exec(src.slice(i))!; hi = String.fromCodePoint(parseInt(h[0], 16)); i += 4; }
              else hi = e;
              hiItem = hi.length === 1 && /[\\\]\[\^\-]/.test(hi) ? '\\' + hi : hi;
            } else {
              hi = String.fromCodePoint(src.codePointAt(i)!);
              i += hi.length;
              hiItem = /[\\\]\[\^\-]/.test(hi) ? '\\' + hi : hi;
            }
            if (hi.codePointAt(0)! < single.codePointAt(0)!) return err(`bad character range ${single}-${hi}`, start);
            body += item + '-' + hiItem;
            prevAtom = null;
            continue;
          }
          body += item;
          prevAtom = item;
        }
        void prevAtom;
        if (!closed) return err('unterminated character set', start);
        if (extras.length > 0) {
          const simple = body === '' ? '' : `[${body}]`;
          if (!neg) out += `(?:${[simple, ...extras].filter((x) => x).join('|')})`;
          else out += `(?:${simple ? `(?!${simple})` : ''}${extras.map((x) => `(?!${x})`).join('')}[\\s\\S])`;
        } else {
          out += `[${neg ? '^' : ''}${body}]`;
          if (body === '' && !neg) out = out.slice(0, -2) + '(?!)';
          else if (body === '' && neg) out = out.slice(0, -3) + '[\\s\\S]';
        }
        lastAtom = true;
        lastQuant = false;
        break;
      }
      case '(': {
        const pos = i;
        if (src[i + 1] === '?') {
          const k = src[i + 2];
          if (k === 'P' && src[i + 3] === '<') {
            const m = /^\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/.exec(src.slice(i));
            if (!m) return err('bad character in group name ' + ops.repr(/^\(\?P<([^>]*)>?/.exec(src.slice(i))![1]), i + 4);
            if (names.has(m[1])) return err(`redefinition of group name ${ops.repr(m[1])} as group ${groups + 1}; was group ${names.get(m[1])}`, i + 4);
            groups++;
            names.set(m[1], groups);
            out += `(?<${m[1]}>`;
            i += m[0].length;
            open.push({ type: 'cap', pos });
          } else if (k === 'P' && src[i + 3] === '=') {
            const m = /^\(\?P=([A-Za-z_][A-Za-z0-9_]*)\)/.exec(src.slice(i));
            if (!m) return err('missing ), unterminated name', i + 4);
            if (!names.has(m[1])) return err(`unknown group name ${ops.repr(m[1])}`, i + 4);
            out += `(?:\\k<${m[1]}>)`;
            i += m[0].length;
            lastAtom = true;
            lastQuant = false;
            break;
          } else if (k === ':') { out += '(?:'; i += 3; open.push({ type: 'nc', pos }); }
          else if (k === '=') { out += '(?='; i += 3; open.push({ type: 'look', pos }); }
          else if (k === '!') { out += '(?!'; i += 3; open.push({ type: 'look', pos }); }
          else if (k === '<' && (src[i + 3] === '=' || src[i + 3] === '!')) { out += `(?<${src[i + 3]}`; i += 4; open.push({ type: 'look', pos }); }
          else if (k === '#') {
            const end = src.indexOf(')', i);
            if (end < 0) return err('missing ), unterminated comment', i);
            i = end + 1;
            break;
          } else if (k === '(') {
            return err('conditional groups (?(id)yes|no) no están soportados', i);
          } else if (k === '>') {
            return err('los grupos atómicos (?>...) no están soportados', i);
          } else {
            const fm = /^\(\?([aiLmsux]*)(?:-([imsx]+))?:/.exec(src.slice(i));
            if (fm) {
              for (const ch of fm[1]) f |= { a: F_A, i: F_I, L: 4, m: F_M, s: F_S, u: F_U, x: F_X }[ch as 'a'] ?? 0;
              out += '(?:';
              i += fm[0].length;
              open.push({ type: 'nc', pos });
            } else return err(`unknown extension ?${k ?? ''}`, i + 1);
          }
          lastAtom = false;
          lastQuant = false;
          break;
        }
        groups++;
        out += '(';
        i++;
        open.push({ type: 'cap', pos });
        lastAtom = false;
        lastQuant = false;
        break;
      }
      case ')': {
        if (open.length === 0) return err('unbalanced parenthesis', i);
        open.pop();
        out += ')';
        i++;
        lastAtom = true;
        lastQuant = false;
        break;
      }
      case '*': case '+': case '?': {
        if (!lastAtom && !(lastQuant)) return err('nothing to repeat', i);
        if (lastQuant && c !== '?') return err('multiple repeat', i);
        if (lastQuant && c === '?') {
          // `*?` `+?` `??` (perezoso) — ya se añadió el cuantificador anterior
          out += '?';
          i++;
          lastQuant = false;
          lastAtom = false;
          break;
        }
        out += c;
        i++;
        if (src[i] === '+') return err('los cuantificadores posesivos no están soportados', i);
        lastQuant = true;
        break;
      }
      case '{': {
        const q = parseQuantBrace(src, i);
        if (q) {
          if (!lastAtom) return err('nothing to repeat', i);
          out += q.text;
          i = q.end;
          lastQuant = true;
          if (src[i] === '?') { out += '?'; i++; lastQuant = false; lastAtom = false; }
        } else {
          out += '\\{';
          i++;
          lastAtom = true;
          lastQuant = false;
        }
        break;
      }
      case '}': out += '\\}'; i++; lastAtom = true; lastQuant = false; break;
      case ']': out += '\\]'; i++; lastAtom = true; lastQuant = false; break;
      case '.': out += dotall ? '[\\s\\S]' : '[^\\n]'; i++; lastAtom = true; lastQuant = false; break;
      case '^': out += multi ? '(?<![^\\n])' : '(?<![\\s\\S])'; i++; lastAtom = false; lastQuant = false; break;
      case '$': out += multi ? '(?![^\\n])' : '(?=\\n?(?![\\s\\S]))'; i++; lastAtom = false; lastQuant = false; break;
      case '|': out += '|'; i++; lastAtom = false; lastQuant = false; break;
      default: {
        const cp = String.fromCodePoint(src.codePointAt(i)!);
        out += escLit(cp);
        i += cp.length;
        lastAtom = true;
        lastQuant = false;
      }
    }
  }
  if (open.length > 0) return err('missing ), unterminated subpattern', open[open.length - 1].pos);
  void wordB;
  return { source: out, groups, names, flags: f };
}

// ───────────────────────── objetos Pattern / Match ─────────────────────────

class PatternObj extends PyObject {
  re!: RegExp;
  hasIdx = true;
  info!: Compiled;
  pattern: any;
  isBytes = false;
}

class MatchObj extends PyObject {
  pat!: PatternObj;
  str!: any;
  text!: string;
  m!: RegExpExecArray;
  pos = 0;
  endpos = 0;
  /** posiciones (UTF-16) de cada grupo: [inicio, fin] o null */
  spans: ([number, number] | null)[] = [];
}

const flagValue = (n: number): any => new PyBox(flagType, n);
let flagType: PyType;
let patternType: PyType;
let matchType: PyType;
let errorType: PyType;

function reError(e: ReError, pattern: any): never {
  const x = makeExc(errorType, [e.pos === null ? e.msg : `${e.msg} at position ${e.pos}`]);
  x.extra = { msg: e.msg, pattern, pos: e.pos };
  throw x;
}

const cache = new Map<string, PatternObj>();

function textOf(x: any, what = 'first argument'): { text: string; bytes: boolean } {
  if (ops.isStr(x)) return { text: ops.strValue(x), bytes: false };
  if (x instanceof PyBytes) return { text: String.fromCharCode(...x.b), bytes: true };
  throw typeError(`${what} must be string or bytes-like`);
}

function compilePattern(I: Interp, pattern: any, flags: number): PatternObj {
  if (pattern instanceof PatternObj) {
    if (flags !== 0) throw valueError('cannot process flags argument with a compiled pattern');
    return pattern;
  }
  const { text, bytes } = textOf(pattern, 'first argument');
  const key = `${bytes ? 'b' : 's'}${flags}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let info: Compiled;
  try {
    info = translate(text, flags);
  } catch (e) {
    if (e instanceof ReError) return reError(e, pattern);
    throw e;
  }
  let jsFlags = 'u';
  if (info.flags & F_I) jsFlags += 'i';
  let re: RegExp;
  let hasIdx = true;
  try {
    re = new RegExp(info.source, jsFlags + 'dg');
  } catch {
    try {
      re = new RegExp(info.source, jsFlags + 'g');
      hasIdx = false;
    } catch (e2) {
      const x = makeExc(errorType, [String((e2 as Error).message).replace(/^Invalid regular expression: /, '')]);
      x.extra = { msg: String((e2 as Error).message), pattern, pos: null };
      throw x;
    }
  }
  const p = new PatternObj(patternType);
  p.re = re;
  p.hasIdx = hasIdx;
  p.info = info;
  p.pattern = pattern;
  p.isBytes = bytes;
  if (!bytes && !(info.flags & F_A)) p.info.flags |= F_U;
  if (cache.size > 512) cache.clear();
  cache.set(key, p);
  void I;
  return p;
}

function execAt(p: PatternObj, text: string, pos: number, endpos: number, mode: 'search' | 'match' | 'fullmatch'): MatchObj | null {
  const re = p.re;
  const sub = endpos < text.length ? text.slice(0, endpos) : text;
  re.lastIndex = pos;
  let m: RegExpExecArray | null;
  if (mode === 'search') m = re.exec(sub);
  else {
    // anclado: se busca solo en `pos` con una copia pegajosa
    const sticky = stickyOf(p);
    sticky.lastIndex = pos;
    m = sticky.exec(sub);
    if (m && mode === 'fullmatch' && m.index + m[0].length !== sub.length) {
      // reintentar exigiendo que llegue hasta el final
      const full = fullOf(p);
      full.lastIndex = pos;
      m = full.exec(sub);
    }
  }
  if (!m) return null;
  return makeMatch(p, text, m, pos, endpos);
}

const stickyCache = new WeakMap<PatternObj, RegExp>();
function stickyOf(p: PatternObj): RegExp {
  let r = stickyCache.get(p);
  if (!r) {
    r = new RegExp(p.re.source, p.re.flags.replace('g', '') + 'y');
    stickyCache.set(p, r);
  }
  return r;
}
const fullCache = new WeakMap<PatternObj, RegExp>();
function fullOf(p: PatternObj): RegExp {
  let r = fullCache.get(p);
  if (!r) {
    r = new RegExp(`(?:${p.re.source})(?![\\s\\S])`, p.re.flags.replace('g', '') + 'y');
    fullCache.set(p, r);
  }
  return r;
}

function makeMatch(p: PatternObj, text: string, m: RegExpExecArray, pos: number, endpos: number): MatchObj {
  const mo = new MatchObj(matchType);
  mo.pat = p;
  mo.text = text;
  mo.m = m;
  mo.pos = pos;
  mo.endpos = endpos;
  const ind = (m as any).indices as ([number, number] | undefined)[] | undefined;
  mo.spans = [];
  for (let g = 0; g <= p.info.groups; g++) {
    if (m[g] === undefined) mo.spans.push(null);
    else if (ind && ind[g]) mo.spans.push([ind[g]![0], ind[g]![1]]);
    else if (g === 0) mo.spans.push([m.index, m.index + m[0].length]);
    else {
      const off = m[0].indexOf(m[g]);
      mo.spans.push(off < 0 ? [m.index, m.index + m[g].length] : [m.index + off, m.index + off + m[g].length]);
    }
  }
  return mo;
}

const cp = (mo: MatchObj, i: number): number => (hasAstral(mo.text) ? cpIndexOf(mo.text, i) : i);
const u16 = (text: string, i: number): number => (hasAstral(text) ? utf16IndexOf(text, i) : i);

function groupIndex(mo: MatchObj, g: any): number {
  if (typeof g === 'string' || (g instanceof PyBox && ops.isStr(g))) {
    const name = ops.strValue(g);
    const idx = mo.pat.info.names.get(name);
    if (idx === undefined) throw indexError('no such group');
    return idx;
  }
  const iv = ops.intValue(g);
  if (iv === undefined) throw indexError('no such group');
  const k = Number(iv);
  if (k < 0 || k > mo.pat.info.groups) throw indexError('no such group');
  return k;
}

function groupValue(mo: MatchObj, idx: number, dflt: any = null): any {
  const sp = mo.spans[idx];
  if (!sp) return dflt;
  const s = mo.text.slice(sp[0], sp[1]);
  return mo.pat.isBytes ? mkBytes(s) : s;
}

function mkBytes(s: string): PyBytes {
  return new PyBytes(Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 255)), bytesType);
}

function expandTemplate(mo: MatchObj, tpl: string): string {
  return parseTemplate(mo.pat, tpl)(mo);
}

function parseTemplate(p: PatternObj, tpl: string): (mo: MatchObj) => string {
  type Part = string | number | string[];
  const parts: Part[] = [];
  let lit = '';
  let i = 0;
  const pushLit = (): void => { if (lit) { parts.push(lit); lit = ''; } };
  const bad = (m: string): never => { throw makeExc(errorType, [m]); };
  while (i < tpl.length) {
    const c = tpl[i];
    if (c !== '\\') { lit += c; i++; continue; }
    const e = tpl[i + 1];
    if (e === undefined) bad('bad escape (end of pattern)');
    i += 2;
    if (e === 'g') {
      const m = /^<([^>]*)>/.exec(tpl.slice(i));
      if (!m) { bad('missing <'); return () => ''; }
      i += m[0].length;
      pushLit();
      if (/^\d+$/.test(m[1])) {
        const k = parseInt(m[1], 10);
        if (k > p.info.groups) bad(`invalid group reference ${k}`);
        parts.push(k);
      } else {
        const idx = p.info.names.get(m[1]);
        if (idx === undefined) bad(`unknown group name '${m[1]}'`);
        parts.push(idx!);
      }
    } else if (/[0-9]/.test(e)) {
      let num = e;
      if (e === '0') {
        while (i < tpl.length && /[0-7]/.test(tpl[i]) && num.length < 3) num += tpl[i++];
        lit += String.fromCodePoint(parseInt(num, 8));
      } else {
        if (i < tpl.length && /\d/.test(tpl[i])) num += tpl[i++];
        const k = parseInt(num, 10);
        if (k > p.info.groups) bad(`invalid group reference ${k}`);
        pushLit();
        parts.push(k);
      }
    } else {
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: '\x07', b: '\b', '\\': '\\' };
      if (map[e] !== undefined) lit += map[e];
      else if (/[A-Za-z]/.test(e)) bad(`bad escape \\${e}`);
      else lit += '\\' + e;
    }
  }
  pushLit();
  return (mo) => {
    let out = '';
    for (const part of parts) {
      if (typeof part === 'string') out += part;
      else if (typeof part === 'number') {
        const sp = mo.spans[part];
        if (sp) out += mo.text.slice(sp[0], sp[1]);
      }
    }
    return out;
  };
}

function findAll(p: PatternObj, text: string, pos: number, endpos: number): MatchObj[] {
  const out: MatchObj[] = [];
  const sub = endpos < text.length ? text.slice(0, endpos) : text;
  const re = p.re;
  let idx = pos;
  let prevEnd = -1;
  let prevEmptyAt = -1;
  while (idx <= sub.length) {
    re.lastIndex = idx;
    const m = re.exec(sub);
    if (!m) break;
    const s = m.index;
    const e = s + m[0].length;
    if (e === s && s === prevEnd && prevEmptyAt !== s) {
      // coincidencia vacía pegada al final de una no vacía: Python la permite; JS ya lo hace igual
    }
    if (e === s && s === prevEmptyAt) {
      idx = s + 1;
      if (hasAstral(sub) && idx < sub.length && sub.charCodeAt(idx) >= 0xdc00 && sub.charCodeAt(idx) <= 0xdfff) idx++;
      prevEmptyAt = -1;
      continue;
    }
    out.push(makeMatch(p, text, m, pos, endpos));
    prevEnd = e;
    if (e === s) {
      prevEmptyAt = s;
      idx = s;
      // avanzar para no repetir la misma coincidencia vacía
      const m2 = nextAfterEmpty(p, sub, s);
      if (m2 === null) break;
      idx = m2;
      prevEmptyAt = -1;
    } else {
      idx = e;
      prevEmptyAt = -1;
    }
  }
  return out;
}

/** tras una coincidencia vacía en s: posición desde la que seguir buscando (Python exige avanzar) */
function nextAfterEmpty(p: PatternObj, sub: string, s: number): number | null {
  // ¿hay una coincidencia no vacía que empiece en s? (p. ej. `x*?` no; `a|` sí) — se intenta con pegajoso
  const sticky = stickyOf(p);
  sticky.lastIndex = s;
  const m = sticky.exec(sub);
  if (m && m[0].length > 0) return s;
  if (s >= sub.length) return null;
  let nx = s + 1;
  if (nx < sub.length && sub.charCodeAt(nx) >= 0xdc00 && sub.charCodeAt(nx) <= 0xdfff && sub.charCodeAt(s) >= 0xd800 && sub.charCodeAt(s) <= 0xdbff) nx++;
  return nx;
}

function doSub(p: PatternObj, repl: any, str: any, count: number): [any, number] {
  const { text } = textOf(str, 'string');
  const isFn = ops.isCallable(repl) && !ops.isStr(repl) && !(repl instanceof PyBytes);
  let fn: (mo: MatchObj) => string;
  if (isFn) {
    fn = (mo) => {
      const r = callObj(repl, [mo]);
      if (r === null) return '';
      return textOf(r, 'expected str instance').text;
    };
  } else {
    const t = textOf(repl, 'expected str instance').text;
    fn = t.indexOf('\\') < 0 ? () => t : parseTemplate(p, t);
  }
  const ms = findAll(p, text, 0, text.length);
  let out = '';
  let last = 0;
  let n = 0;
  for (const mo of ms) {
    if (count > 0 && n >= count) break;
    const sp = mo.spans[0]!;
    out += text.slice(last, sp[0]) + fn(mo);
    last = sp[1];
    n++;
  }
  out += text.slice(last);
  return [p.isBytes ? mkBytes(out) : out, n];
}

function doSplit(p: PatternObj, str: any, maxsplit: number): PyList {
  const { text } = textOf(str, 'string');
  const ms = findAll(p, text, 0, text.length);
  const out: any[] = [];
  let last = 0;
  let n = 0;
  const wrap = (s: string): any => (p.isBytes ? mkBytes(s) : s);
  for (const mo of ms) {
    if (maxsplit > 0 && n >= maxsplit) break;
    const sp = mo.spans[0]!;
    if (sp[0] === sp[1] && sp[0] === 0 && false) continue;
    out.push(wrap(text.slice(last, sp[0])));
    for (let g = 1; g <= p.info.groups; g++) {
      const gs = mo.spans[g];
      out.push(gs ? wrap(text.slice(gs[0], gs[1])) : null);
    }
    last = sp[1];
    n++;
  }
  out.push(wrap(text.slice(last)));
  return new PyList(out);
}

function flagsOf(x: any): number {
  if (x === undefined || x === null) return 0;
  const v = ops.intValue(x);
  if (v === undefined) throw typeError("'flags' must be an int");
  return Number(v);
}

function flagsRepr(n: number): string {
  if (n === 0) return 're.NOFLAG';
  const parts: string[] = [];
  let rest = n;
  for (const [name, bit] of FLAGS) {
    if (bit !== 0 && (n & bit) === bit) { parts.push('re.' + name); rest &= ~bit; }
  }
  if (rest) parts.push('0x' + rest.toString(16));
  return parts.join('|');
}

registerNative('re', (I: Interp, m: PyModule) => {
  errorType = newNativeType('error', 're', [E.Exception], F_BASETYPE);
  const errProps: [string, string][] = [['msg', 'msg'], ['pattern', 'pattern'], ['pos', 'pos']];
  for (const [nm, key] of errProps) {
    const pr = new PyProperty(propertyType);
    pr.name = nm;
    pr.fget = mkNative(nm, 'self', (e: any) => (e.extra && e.extra[key] !== undefined ? e.extra[key] : null), { method: true });
    errorType.dict!.set(nm, pr);
  }
  errorType.dict!.set('__init__', mkNative('__init__', 'self, msg, pattern=, pos=', (e: any, msg: any, pat?: any, pos?: any) => {
    e.args = [pos === undefined || pos === null ? msg : `${ops.str(msg)} at position ${ops.str(pos)}`];
    e.extra = { msg, pattern: pat === undefined ? null : pat, pos: pos === undefined ? null : pos };
    return null;
  }, { method: true, owner: 'error' }));
  m.dict!.set('error', errorType);

  // RegexFlag
  flagType = newNativeType('RegexFlag', 're', [intType], F_BASETYPE);
  const fv = (x: any): number => Number(ops.intValue(x) ?? 0);
  flagType.dict!.set('__repr__', mkNative('__repr__', 'self', (x: any) => flagsRepr(fv(x)), { method: true }));
  flagType.dict!.set('__str__', flagType.dict!.get('__repr__'));
  for (const [nm, op] of [['or', (a: number, b: number) => a | b], ['and', (a: number, b: number) => a & b], ['xor', (a: number, b: number) => a ^ b]] as const) {
    for (const pre of ['', 'r']) {
      flagType.dict!.set(`__${pre}${nm}__`, mkNative(`__${pre}${nm}__`, 'self, other', (a: any, b: any) => {
        const y = ops.intValue(b);
        if (y === undefined) return NotImplemented;
        return flagValue(op(fv(a), Number(y)));
      }, { method: true }));
    }
  }
  flagType.dict!.set('__invert__', mkNative('__invert__', 'self', (a: any) => flagValue(~fv(a) & 0x1ff), { method: true }));
  for (const [name, bit, aliases] of FLAGS) {
    const v = flagValue(bit);
    for (const a of aliases) m.dict!.set(a, v);
    flagType.dict!.set(name, v);
  }
  m.dict!.set('RegexFlag', flagType);
  const vi = (x: any) => ops.intValue(x);
  void vi;

  patternType = newNativeType('Pattern', 're', [objectType]);
  matchType = newNativeType('Match', 're', [objectType]);
  m.dict!.set('Pattern', patternType);
  m.dict!.set('Match', matchType);
  const P = (x: any): PatternObj => {
    if (!(x instanceof PatternObj)) throw typeError('descriptor requires a re.Pattern object');
    return x;
  };
  const text16 = (p: PatternObj, s: any): string => {
    const t = textOf(s, 'expected string or bytes-like object, got ' + `'${typeOf(s).name}'`);
    if (t.bytes !== p.isBytes) throw typeError(p.isBytes ? 'cannot use a bytes pattern on a string-like object' : 'cannot use a string pattern on a bytes-like object');
    return t.text;
  };
  const range = (text: string, pos: any, endpos: any): [number, number] => {
    const n = hasAstral(text) ? Array.from(text).length : text.length;
    let a = pos === undefined ? 0 : asIdx(pos);
    let b = endpos === undefined ? n : asIdx(endpos);
    a = Math.max(0, Math.min(a, n));
    b = Math.max(0, Math.min(b, n));
    if (b < a) b = a;
    return [u16(text, a), u16(text, b)];
  };
  const searchLike = (mode: 'search' | 'match' | 'fullmatch') => (p0: any, s: any, pos?: any, endpos?: any): any => {
    const p = P(p0);
    const t = text16(p, s);
    const [a, b] = range(t, pos, endpos);
    return execAt(p, t, a, b, mode);
  };
  const pm: Record<string, [string, (...a: any[]) => any]> = {
    search: ['self, string, pos=, endpos=', searchLike('search')],
    match: ['self, string, pos=, endpos=', searchLike('match')],
    fullmatch: ['self, string, pos=, endpos=', searchLike('fullmatch')],
    findall: ['self, string, pos=, endpos=', (p0: any, s: any, pos?: any, endpos?: any) => {
      const p = P(p0);
      const t = text16(p, s);
      const [a, b] = range(t, pos, endpos);
      const ms = findAll(p, t, a, b);
      const g = p.info.groups;
      return new PyList(ms.map((mo) => {
        if (g === 0) return groupValue(mo, 0);
        if (g === 1) return groupValue(mo, 1, p.isBytes ? mkBytes('') : '');
        return new PyTuple(Array.from({ length: g }, (_, i) => groupValue(mo, i + 1, p.isBytes ? mkBytes('') : '')));
      }));
    }],
    finditer: ['self, string, pos=, endpos=', (p0: any, s: any, pos?: any, endpos?: any) => {
      const p = P(p0);
      const t = text16(p, s);
      const [a, b] = range(t, pos, endpos);
      return new ops.ListIter(new PyList(findAll(p, t, a, b)));
    }],
    sub: ['self, repl, string, count=', (p0: any, repl: any, s: any, count?: any) => doSub(P(p0), repl, s, count === undefined ? 0 : asIdx(count))[0]],
    subn: ['self, repl, string, count=', (p0: any, repl: any, s: any, count?: any) => {
      const [r, n] = doSub(P(p0), repl, s, count === undefined ? 0 : asIdx(count));
      return new PyTuple([r, n]);
    }],
    split: ['self, string, maxsplit=', (p0: any, s: any, mx?: any) => doSplit(P(p0), s, mx === undefined ? 0 : asIdx(mx))],
    scanner: ['self, string, pos=, endpos=', (p0: any, s: any) => {
      const p = P(p0);
      const t = text16(p, s);
      const sc = new PyObject(scannerType);
      (sc as any).p = p;
      (sc as any).t = t;
      (sc as any).pos = 0;
      return sc;
    }],
    __repr__: ['self', (p0: any) => {
      const p = P(p0);
      const pat = ops.repr(p.pattern);
      const fl = p.info.flags & ~(p.isBytes ? 0 : F_U);
      const shown = fl & ~F_U;
      return shown ? `re.compile(${pat.length > 200 ? pat.slice(0, 200) : pat}, ${flagsRepr(shown)})` : `re.compile(${pat.length > 200 ? pat.slice(0, 200) : pat})`;
    }],
    __eq__: ['self, other', (a: any, b: any) => (b instanceof PatternObj ? ops.eqOp(a.pattern, b.pattern) && a.info.flags === b.info.flags : NotImplemented)],
    __hash__: ['self', (a: any) => ops.hashOf(a.pattern) ^ a.info.flags],
    __copy__: ['self', (a: any) => a],
    __deepcopy__: ['self, memo', (a: any) => a],
  };
  for (const k of Object.keys(pm)) patternType.dict!.set(k, mkNative(k, pm[k][0], pm[k][1], { method: true, owner: 'Pattern' }));
  const pprop = (nm: string, get: (p: PatternObj) => any): void => {
    const pr = new PyProperty(propertyType);
    pr.name = nm;
    pr.fget = mkNative(nm, 'self', (x: any) => get(P(x)), { method: true });
    patternType.dict!.set(nm, pr);
  };
  pprop('pattern', (p) => p.pattern);
  pprop('flags', (p) => p.info.flags);
  pprop('groups', (p) => p.info.groups);
  pprop('groupindex', (p) => {
    const d = new PyDict();
    for (const [k, v] of p.info.names) d.set(k, v);
    const mp = new PyObject(mappingProxyType);
    (mp as any).target = d;
    return mp;
  });

  const scannerType = newNativeType('SRE_Scanner', '_sre', [objectType]);
  for (const nm of ['match', 'search']) {
    scannerType.dict!.set(nm, mkNative(nm, 'self', (sc: any) => {
      const mo = execAt(sc.p, sc.t, sc.pos, sc.t.length, nm as 'match');
      if (!mo) return null;
      const sp = mo.spans[0]!;
      sc.pos = sp[1] === sp[0] ? sp[1] + 1 : sp[1];
      return mo;
    }, { method: true }));
  }

  const M = (x: any): MatchObj => {
    if (!(x instanceof MatchObj)) throw typeError('descriptor requires a re.Match object');
    return x;
  };
  const mm: Record<string, [string, (...a: any[]) => any]> = {
    group: ['self, *args', (mo0: any, args: any) => {
      const mo = M(mo0);
      const a = tupleArr(args);
      if (a.length === 0) return groupValue(mo, 0);
      if (a.length === 1) return groupValue(mo, groupIndex(mo, a[0]));
      return new PyTuple(a.map((g) => groupValue(mo, groupIndex(mo, g))));
    }],
    __getitem__: ['self, g', (mo0: any, g: any) => groupValue(M(mo0), groupIndex(M(mo0), g))],
    groups: ['self, default=', (mo0: any, d?: any) => {
      const mo = M(mo0);
      return new PyTuple(Array.from({ length: mo.pat.info.groups }, (_, i) => groupValue(mo, i + 1, d === undefined ? null : d)));
    }],
    groupdict: ['self, default=', (mo0: any, d?: any) => {
      const mo = M(mo0);
      const out = new PyDict();
      for (const [k, idx] of mo.pat.info.names) out.set(k, groupValue(mo, idx, d === undefined ? null : d));
      return out;
    }],
    start: ['self, group=', (mo0: any, g?: any) => {
      const mo = M(mo0);
      const sp = mo.spans[g === undefined ? 0 : groupIndex(mo, g)];
      return sp ? cp(mo, sp[0]) : -1;
    }],
    end: ['self, group=', (mo0: any, g?: any) => {
      const mo = M(mo0);
      const sp = mo.spans[g === undefined ? 0 : groupIndex(mo, g)];
      return sp ? cp(mo, sp[1]) : -1;
    }],
    span: ['self, group=', (mo0: any, g?: any) => {
      const mo = M(mo0);
      const sp = mo.spans[g === undefined ? 0 : groupIndex(mo, g)];
      return sp ? new PyTuple([cp(mo, sp[0]), cp(mo, sp[1])]) : new PyTuple([-1, -1]);
    }],
    expand: ['self, template', (mo0: any, t: any) => {
      const mo = M(mo0);
      const r = expandTemplate(mo, textOf(t, 'template').text);
      return mo.pat.isBytes ? mkBytes(r) : r;
    }],
    __repr__: ['self', (mo0: any) => {
      const mo = M(mo0);
      const sp = mo.spans[0]!;
      const s = groupValue(mo, 0);
      return `<re.Match object; span=(${cp(mo, sp[0])}, ${cp(mo, sp[1])}), match=${ops.repr(s)}>`;
    }],
    __bool__: ['self', () => true],
    __copy__: ['self', (a: any) => a],
    __deepcopy__: ['self, memo', (a: any) => a],
  };
  for (const k of Object.keys(mm)) matchType.dict!.set(k, mkNative(k, mm[k][0], mm[k][1], { method: true, owner: 'Match' }));
  const mprop = (nm: string, get: (m: MatchObj) => any): void => {
    const pr = new PyProperty(propertyType);
    pr.name = nm;
    pr.fget = mkNative(nm, 'self', (x: any) => get(M(x)), { method: true });
    matchType.dict!.set(nm, pr);
  };
  mprop('string', (mo) => (mo.pat.isBytes ? mkBytes(mo.text) : mo.text));
  mprop('re', (mo) => mo.pat);
  mprop('pos', (mo) => cp(mo, mo.pos));
  mprop('endpos', (mo) => cp(mo, mo.endpos));
  mprop('lastindex', (mo) => {
    let last: number | null = null;
    let lastEnd = -1;
    for (let g = 1; g < mo.spans.length; g++) {
      const sp = mo.spans[g];
      if (sp && sp[1] >= lastEnd) { last = g; lastEnd = sp[1]; }
    }
    return last;
  });
  mprop('lastgroup', (mo) => {
    let idx: number | null = null;
    let lastEnd = -1;
    for (let g = 1; g < mo.spans.length; g++) {
      const sp = mo.spans[g];
      if (sp && sp[1] >= lastEnd) { idx = g; lastEnd = sp[1]; }
    }
    if (idx === null) return null;
    for (const [k, v] of mo.pat.info.names) if (v === idx) return k;
    return null;
  });
  mprop('regs', (mo) => new PyTuple(mo.spans.map((sp) => (sp ? new PyTuple([cp(mo, sp[0]), cp(mo, sp[1])]) : new PyTuple([-1, -1])))));

  // funciones del módulo
  const comp = (p: any, fl: any): PatternObj => compilePattern(I, p, flagsOf(fl));
  mfn(m, 'compile', 'pattern, flags=', (p: any, f?: any) => comp(p, f));
  mfn(m, 'search', 'pattern, string, flags=', (p: any, s: any, f?: any) => searchLike('search')(comp(p, f), s));
  mfn(m, 'match', 'pattern, string, flags=', (p: any, s: any, f?: any) => searchLike('match')(comp(p, f), s));
  mfn(m, 'fullmatch', 'pattern, string, flags=', (p: any, s: any, f?: any) => searchLike('fullmatch')(comp(p, f), s));
  mfn(m, 'findall', 'pattern, string, flags=', (p: any, s: any, f?: any) => callObj(patternType.dict!.get('findall'), [comp(p, f), s]));
  mfn(m, 'finditer', 'pattern, string, flags=', (p: any, s: any, f?: any) => callObj(patternType.dict!.get('finditer'), [comp(p, f), s]));
  mfn(m, 'sub', 'pattern, repl, string, count=, flags=', (p: any, r: any, s: any, c?: any, f?: any) => doSub(comp(p, f), r, s, c === undefined ? 0 : asIdx(c))[0]);
  mfn(m, 'subn', 'pattern, repl, string, count=, flags=', (p: any, r: any, s: any, c?: any, f?: any) => {
    const [x, n] = doSub(comp(p, f), r, s, c === undefined ? 0 : asIdx(c));
    return new PyTuple([x, n]);
  });
  mfn(m, 'split', 'pattern, string, maxsplit=, flags=', (p: any, s: any, mx?: any, f?: any) => doSplit(comp(p, f), s, mx === undefined ? 0 : asIdx(mx)));
  mfn(m, 'escape', 'pattern', (p: any) => {
    if (p instanceof PyBytes) return mkBytes(String.fromCharCode(...p.b).replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, '\\$&'));
    return ops.strValue(p).replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, '\\$&');
  });
  mfn(m, 'purge', '', () => { cache.clear(); return null; });
  mconst(m, { __version__: '2.2.1' });
  void [Object.assign, strRepr, decodeUtf8, bytesType, kwMap];
});
export type { Kw };
