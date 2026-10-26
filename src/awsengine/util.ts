/** Utilidades del simulador de AWS: identificadores deterministas, ARN, fechas, comodines y CIDR. */
import { hash32 } from '../engine/format';
import type { Account, Rec } from './types';

/** Inicio del reloj virtual de una cuenta. */
export const START_CLOCK = Date.UTC(2026, 2, 14, 10, 0, 0);

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export const isObj = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
export const toArr = <T>(x: T | T[] | undefined | null): T[] => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

// ───────────────────────── identificadores ─────────────────────────

const ALNUM_UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HEX = '0123456789abcdef';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cadena pseudoaleatoria pero estable para (semilla, tipo, contador). */
function pick(alphabet: string, len: number, key: string): string {
  const r = mulberry(hash32(key) ^ 0x9e3779b9);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(r() * alphabet.length)];
  return s;
}

/** Siguiente número de una secuencia de la cuenta. */
export function counter(acct: Account, kind: string): number {
  const n = (acct.counters[kind] ?? 0) + 1;
  acct.counters[kind] = n;
  return n;
}

export type IdAlphabet = 'up' | 'hex' | 'b64';
const ALPHABETS: Record<IdAlphabet, string> = { up: ALNUM_UP, hex: HEX, b64: B64 };

/** Identificador estable: `prefix` + `len` caracteres derivados de la semilla de la cuenta. */
export function newId(acct: Account, kind: string, prefix: string, len: number, alphabet: IdAlphabet = 'up'): string {
  const n = counter(acct, kind);
  return prefix + pick(ALPHABETS[alphabet], len, `${acct.seed}:${kind}:${n}`);
}

/** Identificador que depende solo de la clave (no del orden en que se creó nada). */
export function stableId(key: string, prefix: string, len: number, alphabet: IdAlphabet = 'hex'): string {
  return prefix + pick(ALPHABETS[alphabet], len, 'stable:' + key);
}

export const iamId = (acct: Account, prefix: 'AIDA' | 'AROA' | 'AGPA' | 'ANPA' | 'AIPA') => newId(acct, 'iam' + prefix, prefix, 17);
export const accessKeyId = (acct: Account) => newId(acct, 'akia', 'AKIA', 16);
export const tempKeyId = (acct: Account) => newId(acct, 'asia', 'ASIA', 16);
export const ec2Id = (acct: Account, prefix: string) => newId(acct, 'ec2' + prefix, prefix + '-', 17, 'hex');

/** Clave secreta de una clave de acceso: siempre la misma para esa clave (así se puede comprobar). */
export function secretFor(akid: string): string {
  return pick(B64 + '/+', 40, 'secret:' + akid);
}

/** Token de sesión (largo, como los reales) de una clave temporal. */
export function sessionTokenFor(akid: string): string {
  return 'IQoJb3JpZ2luX2VjE' + pick(B64, 220, 'token:' + akid);
}

// ───────────────────────── nombres y ARN ─────────────────────────

/** `user-name` → `UserName` */
export const pascal = (kebab: string): string => kebab.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join('');

export interface Arn {
  partition: string;
  service: string;
  region: string;
  account: string;
  resource: string;
}

export function parseArn(s: string): Arn | null {
  const m = /^arn:([^:]*):([^:]*):([^:]*):([^:]*):(.*)$/.exec(s);
  return m ? { partition: m[1], service: m[2], region: m[3], account: m[4], resource: m[5] } : null;
}

export const mkArn = (service: string, region: string, account: string, resource: string) => `arn:aws:${service}:${region}:${account}:${resource}`;

/** ARN de un recurso de IAM; `path` es '/' o '/equipo/'. */
export const iamArn = (acct: Account, type: string, name: string, path = '/') => `arn:aws:iam::${acct.id}:${type}${path === '/' ? '/' : path}${name}`;

// ───────────────────────── fechas ─────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0');

/** Fecha como la imprime la CLI v2 en JSON: `2025-06-15T12:00:00+00:00`. */
export function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}+00:00`;
}

/** Fecha en formato `2025-06-15T12:00:00Z` (como en políticas y CloudFormation). */
export const isoZ = (ms: number) => iso(ms).replace('+00:00', 'Z');

/** Fecha de `aws s3 ls`: `2025-06-15 12:00:00`. */
export function s3Date(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** Interpreta una fecha ISO (con o sin hora) y devuelve ms, o NaN. */
export function parseDate(s: string): number {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
  return t;
}

// ───────────────────────── comodines ─────────────────────────

const reCache = new Map<string, RegExp>();

/** `*` = cualquier cosa, `?` = un carácter (como en IAM). */
export function wildcard(pattern: string, text: string, ci = false): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return ci ? pattern.toLowerCase() === text.toLowerCase() : pattern === text;
  const key = (ci ? 'i:' : 's:') + pattern;
  let re = reCache.get(key);
  if (!re) {
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    re = new RegExp('^' + body + '$', ci ? 'is' : 's');
    reCache.set(key, re);
  }
  return re.test(text);
}

// ───────────────────────── CIDR / IPv4 ─────────────────────────

export function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

export interface Cidr {
  base: number;
  bits: number;
}

export function parseCidr(s: string): Cidr | null {
  const m = /^([\d.]+)(?:\/(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const bits = m[2] === undefined ? 32 : Number(m[2]);
  if (ip === null || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ip & mask) >>> 0, bits };
}

/** ¿El CIDR está bien escrito (sin bits de host sobrantes)? */
export function cidrCanonical(s: string): boolean {
  const c = parseCidr(s);
  if (!c) return false;
  const m = /^([\d.]+)/.exec(s)!;
  return ipToInt(m[1]) === c.base;
}

export function cidrContainsIp(cidr: string, ip: string): boolean {
  const c = parseCidr(cidr);
  const n = ipToInt(ip.split('/')[0]);
  if (!c || n === null) return false;
  const mask = c.bits === 0 ? 0 : (0xffffffff << (32 - c.bits)) >>> 0;
  return ((n & mask) >>> 0) === c.base;
}

/** ¿`inner` está contenido en `outer`? */
export function cidrWithin(inner: string, outer: string): boolean {
  const a = parseCidr(inner);
  const b = parseCidr(outer);
  if (!a || !b || a.bits < b.bits) return false;
  return cidrContainsIp(outer, intToIp(a.base));
}

export function cidrOverlap(x: string, y: string): boolean {
  return cidrWithin(x, y) || cidrWithin(y, x);
}

// ───────────────────────── varios ─────────────────────────

export function sortBy<T>(arr: T[], key: (x: T) => string | number): T[] {
  return [...arr].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Quita las claves con valor `undefined` (para que no salgan en el JSON). */
export function compact<T extends Rec>(o: T): T {
  const r: Rec = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r as T;
}

export function tagsToMap(tags: { Key: string; Value: string }[] | undefined): Record<string, string> {
  const r: Record<string, string> = {};
  for (const t of tags ?? []) r[t.Key] = t.Value;
  return r;
}

export function mergeTags(cur: { Key: string; Value: string }[], add: { Key: string; Value: string }[]): { Key: string; Value: string }[] {
  const m = new Map(cur.map((t) => [t.Key, t.Value]));
  for (const t of add) m.set(t.Key, t.Value);
  return [...m].map(([Key, Value]) => ({ Key, Value }));
}

/** Divide una línea como lo haría un shell (comillas simples y dobles, `\` para escapar). */
export function shellSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === '\\' && q === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else if (ch === '\\' && i + 1 < line.length) cur += line[++i];
    else cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}
